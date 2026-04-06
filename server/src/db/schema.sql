-- ============================================================================
-- Food schema
-- ============================================================================
-- Design notes:
--   * Three-level tenancy: Platform → Tenant (restaurant brand) → Outlet.
--     Every business table carries BOTH tenant_id AND outlet_id. tenant_id is
--     denormalized from outlets.tenant_id but carried directly so queries can
--     filter without a join and Postgres RLS policies have a direct column to
--     gate on. outlet_id stays because operations, uniqueness, and numbering
--     are per-outlet (each outlet runs its own kitchen and bill counter).
--   * Money is integer paise. Tax rates are basis points (500 = 5%).
--   * Menu entities use is_active (soft) rather than hard delete, to preserve
--     referential integrity with historical orders.
--   * audit_log captures every mutation for billing-critical entities.
--   * Timestamps are TIMESTAMPTZ. created_at/updated_at are always UTC.
--
-- Phase 1 status (2026-04-05): new tenant layer added as additive-only.
-- tenant_id columns are NULLABLE until Phase 2 updates every INSERT path.
-- Do not remove the backfill block at the bottom — it keeps existing data
-- valid after the schema is reapplied.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- tenants (restaurant brands — the top of the tenancy tree)
-- ----------------------------------------------------------------------------
-- A tenant is your customer: one restaurant brand or company. It owns one or
-- more outlets. Users belong to exactly one tenant. Data isolation between
-- tenants is enforced at both the application layer (every query scoped by
-- tenant_id) and the database layer (Postgres RLS policies, added in Phase 3).
--
-- slug is the URL handle used in /t/:slug/login. Globally unique, lowercase,
-- no spaces. Immutable once created — changing it would break saved links and
-- the audit trail.
--
-- status 'trial' means the tenant is active but on a time-limited trial;
-- 'active' is a paying/onboarded tenant; 'suspended' blocks all logins and
-- API access; 'cancelled' is tombstoned data retained for audit/restore.
--
-- plan is a placeholder for future billing integration. v2 ships with it as
-- a nullable string — no enum, no constraint — so we can wire billing later
-- without a schema change.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'suspended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  status         tenant_status NOT NULL DEFAULT 'trial',
  plan           TEXT,
  trial_ends_at  TIMESTAMPTZ,
  -- created_by references platform_users(id) and is NULL for self-serve
  -- signups. We cannot forward-reference platform_users here because it is
  -- declared immediately below — the FK is added after both tables exist.
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' AND length(slug) BETWEEN 3 AND 63)
);

-- ----------------------------------------------------------------------------
-- platform_users (YOU — the SaaS operators)
-- ----------------------------------------------------------------------------
-- Lives entirely outside the tenant tree. A platform_user has no tenant_id
-- and cannot be reached from any tenant-scoped query. The login endpoint
-- for this pool is /platform/login, distinct from /t/:slug/login, and the
-- JWTs carry aud='platform' vs aud='tenant' so the two token pools cannot
-- be confused by middleware.
--
-- Why a separate table and not a role flag on users: a bug that promotes a
-- tenant user to super-admin would be catastrophic. A separate table with
-- a separate login endpoint makes that escalation impossible by construction.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Now that platform_users exists, wire the tenants.created_by FK.
DO $$ BEGIN
  ALTER TABLE tenants
    ADD CONSTRAINT tenants_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES platform_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- outlets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outlets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  legal_name     TEXT,
  gstin          TEXT,                       -- basic GST, no IRN in v1
  fssai_no       TEXT,
  address        TEXT,
  phone          TEXT,
  email          TEXT,
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- users (staff who log in)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'manager', 'staff', 'kitchen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role           user_role NOT NULL DEFAULT 'staff',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, email)
);

-- ----------------------------------------------------------------------------
-- user_outlet_access (many-to-many: which outlets a user can work at)
-- ----------------------------------------------------------------------------
-- Phase 2 replaces the single users.outlet_id binding with this table, so a
-- user can be granted access to one, several, or all outlets within their
-- tenant. Role is OUTLET-scoped: the same person can be 'manager' at one
-- outlet and 'staff' at another. Tenant owners do NOT need rows here — their
-- is_tenant_owner flag on users grants implicit access to every outlet in
-- their tenant.
--
-- Phase 1 creates the table but leaves it empty. The backfill block at the
-- bottom of this file populates it for existing users to keep backward
-- compat during the transition.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_outlet_access (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id   UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, outlet_id)
);

CREATE INDEX IF NOT EXISTS idx_user_outlet_access_outlet
  ON user_outlet_access (outlet_id);

-- ----------------------------------------------------------------------------
-- signup_tokens (self-serve tenant signup — email verification)
-- ----------------------------------------------------------------------------
-- A visitor fills the signup form; we write one row here and one row to
-- email_outbox. The verification link carries the token. Clicking it consumes
-- the token, creates the tenant + first user + first outlet, and logs the
-- user in. Unconsumed tokens expire (cleaned up by a background job later).
--
-- payload is a JSONB blob of the pending signup data (restaurant name, slug,
-- full name, hashed password, first outlet name, timezone). We keep it here
-- rather than creating a half-built tenant row because an abandoned signup
-- should leave zero trace in the tenants table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signup_tokens (
  token        TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signup_tokens_email
  ON signup_tokens (email)
  WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- staff_invites (tenant owners/managers inviting staff)
-- ----------------------------------------------------------------------------
-- A tenant owner or manager invites a staff member by email, selecting a
-- role and which outlets the invitee should have access to. We write a row
-- here and an email_outbox row; the invitee clicks the link, sets a password,
-- and becomes a user + user_outlet_access rows in one transaction.
--
-- outlet_ids is a UUID[] — intentional denormalization to keep the invite as
-- a single row. The service validates that every id in the array belongs to
-- the inviter's tenant before writing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_invites (
  token        TEXT PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  full_name    TEXT,
  invited_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role         user_role NOT NULL,
  outlet_ids   UUID[] NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_invites_role_not_owner CHECK (role IN ('manager', 'staff', 'kitchen')),
  CONSTRAINT staff_invites_outlets_nonempty CHECK (array_length(outlet_ids, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_tenant_email
  ON staff_invites (tenant_id, email)
  WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- email_outbox (provider-agnostic email queue)
-- ----------------------------------------------------------------------------
-- Every outbound email (signup verification, staff invite, password reset)
-- lands here as a pending row. A worker picks them up and hands them to
-- whichever provider is configured (Postmark, Resend, SES, or — in dev —
-- a console logger that just prints the payload).
--
-- template is a string key, not an enum, so new templates can be added
-- without a migration. payload carries the template variables. last_error
-- holds the most recent provider failure for retry debugging.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
  ON email_outbox (created_at)
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- menu: categories
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  description    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, name)
);

CREATE INDEX IF NOT EXISTS idx_menu_categories_outlet
  ON menu_categories (outlet_id, display_order)
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- menu: items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id       UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  category_id     UUID NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  description     TEXT,
  -- Base price in integer paise. Variations add/subtract deltas.
  price_paise     BIGINT NOT NULL CHECK (price_paise >= 0),
  -- Tax rate in basis points. 500 = 5%, 1800 = 18%. Stored per-item so we
  -- can support mixed-rate menus without a separate tax_classes table in v1.
  tax_rate_bps    INTEGER NOT NULL DEFAULT 500 CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000),
  -- in_stock is the runtime availability toggle. Separate from is_active
  -- (which is "does this item exist at all").
  in_stock        BOOLEAN NOT NULL DEFAULT TRUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_menu_items_outlet_category
  ON menu_items (outlet_id, category_id, display_order)
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- menu: variations (e.g., Small/Medium/Large, Half/Full)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_item_variations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  -- Delta to apply to the item's base price. Can be negative if a smaller
  -- size is cheaper than the base.
  price_delta_paise  BIGINT NOT NULL DEFAULT 0,
  display_order      INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, name)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_variations_item
  ON menu_item_variations (item_id, display_order)
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- menu: add-ons (reusable — "extra cheese", "extra spicy")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_addons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  price_paise    BIGINT NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, name)
);

-- Many-to-many: which add-ons can be applied to which items.
CREATE TABLE IF NOT EXISTS menu_item_addons (
  item_id        UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  addon_id       UUID NOT NULL REFERENCES menu_addons(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, addon_id)
);

-- ----------------------------------------------------------------------------
-- dining tables (the physical tables in the restaurant)
-- ----------------------------------------------------------------------------
-- Design notes:
--   * `code` is a short identifier the staff uses ("T1", "B4"). It is
--     unique per outlet and stable — do not renumber tables once live
--     orders reference them.
--   * `label` is a longer human-facing name ("Window seat", "Garden 3").
--     Optional.
--   * `section` is a free-text grouping (Main / Garden / Bar / Terrace).
--     v1 does NOT normalize sections into their own table — most outlets
--     have 2-4 sections and a varchar is faster to ship. Promote to a
--     table the day an outlet asks for per-section permissions.
--   * `seats` is capacity. Used later for pax-aware reporting.
--   * Live occupancy state (free / occupied / reserved) is NOT stored here.
--     It is derived from whether an open order references the table. A
--     stored status column would go stale the first time someone forgets
--     to update it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dining_tables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL,
  label          TEXT,
  section        TEXT,
  seats          INTEGER NOT NULL DEFAULT 2 CHECK (seats > 0 AND seats <= 100),
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, code)
);

CREATE INDEX IF NOT EXISTS idx_dining_tables_outlet_section
  ON dining_tables (outlet_id, section, display_order)
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- orders (the "session" at a table or a takeaway ticket)
-- ----------------------------------------------------------------------------
-- Design notes:
--   * An `order` is the table session, not a single item punch. It opens when
--     staff seats guests, accumulates items across multiple KOTs ("first course
--     now, dessert later"), and closes when the bill is paid (billing module,
--     next iteration).
--   * `order_items` are the things the guest actually ordered. Each item is
--     born as a DRAFT (kot_id IS NULL). When staff hits "send", a KOT row is
--     created and draft items are attached to it. Kitchen never sees drafts.
--   * Items snapshot menu data (name, unit_price_paise, tax_rate_bps, addons)
--     at order time. Menu edits must not retroactively change old orders.
--   * Add-ons are stored as JSONB on the order item rather than a separate
--     table. v1 reports do not break down by add-on; promote to a table when
--     they do.
--   * Live occupancy (which tables are free) is derived: a table is occupied
--     if an order with status='open' references it. No stored flag to go stale.
--   * order_number is BIGSERIAL — globally unique, not per-outlet. v1 is
--     single outlet; when a second outlet lands, a per-outlet counter table
--     can back-populate without schema changes.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('dine_in', 'takeaway');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('open', 'closed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id         UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  order_number      BIGSERIAL,
  order_type        order_type NOT NULL DEFAULT 'dine_in',
  table_id          UUID REFERENCES dining_tables(id) ON DELETE RESTRICT,
  status            order_status NOT NULL DEFAULT 'open',
  customer_name     TEXT,
  customer_phone    TEXT,
  pax               INTEGER CHECK (pax IS NULL OR pax > 0),
  notes             TEXT,
  opened_by         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancelled_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Dine-in must have a table; takeaway must not.
  CONSTRAINT orders_table_matches_type CHECK (
    (order_type = 'dine_in'  AND table_id IS NOT NULL) OR
    (order_type = 'takeaway' AND table_id IS NULL)
  )
);

-- Only one OPEN order per table at a time. Closed/cancelled orders are
-- exempt so historical rows don't block reseating.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_one_open_per_table
  ON orders (table_id)
  WHERE status = 'open' AND table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_outlet_status
  ON orders (outlet_id, status, opened_at DESC);

-- ----------------------------------------------------------------------------
-- kots (Kitchen Order Tickets — one per "send to kitchen" action)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE kot_status AS ENUM ('new', 'in_progress', 'ready', 'served', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS kots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id         UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  kot_number        BIGSERIAL,
  status            kot_status NOT NULL DEFAULT 'new',
  sent_by           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  ready_at          TIMESTAMPTZ,
  served_at         TIMESTAMPTZ,
  voided_at         TIMESTAMPTZ,
  void_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kots_outlet_status
  ON kots (outlet_id, status, sent_at);
CREATE INDEX IF NOT EXISTS idx_kots_order
  ON kots (order_id, sent_at);

-- ----------------------------------------------------------------------------
-- order_items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id         UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  -- NULL = draft (still in POS, not yet dispatched to kitchen).
  kot_id            UUID REFERENCES kots(id) ON DELETE RESTRICT,
  menu_item_id      UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  menu_item_name    TEXT NOT NULL,
  variation_id      UUID REFERENCES menu_item_variations(id) ON DELETE RESTRICT,
  variation_name    TEXT,
  unit_price_paise  BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  tax_rate_bps      INTEGER NOT NULL CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000),
  -- [{ id, name, price_paise }]  — snapshot of chosen add-ons at order time.
  addons            JSONB NOT NULL DEFAULT '[]'::jsonb,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  notes             TEXT,
  is_void           BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason       TEXT,
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_kot
  ON order_items (kot_id)
  WHERE kot_id IS NOT NULL;
-- Fast "draft items on this order" lookup.
CREATE INDEX IF NOT EXISTS idx_order_items_drafts
  ON order_items (order_id)
  WHERE kot_id IS NULL AND is_void = FALSE;

-- ----------------------------------------------------------------------------
-- billing: bills, bill_items, payments
-- ----------------------------------------------------------------------------
-- Design notes:
--   * One bill per order (enforced by UNIQUE on bills.order_id). Split bills
--     are NOT in v1; promote to a `bill_groups` row when we add them.
--   * Every monetary column is BIGINT paise. Never float, never decimal.
--   * Taxes are computed per LINE (on bill_items), not just per bill. This is
--     the only way the tax-summary report can reconcile to individual items.
--   * GST is split into CGST/SGST 50/50 at the line level. The split rounds
--     the CGST half down and gives any odd paisa to SGST so cgst + sgst
--     always equals the total line tax, exactly.
--   * bills.round_off_paise carries the nearest-rupee rounding delta so the
--     printed total is a whole rupee figure but the breakdown still reconciles.
--   * Payments are multi-row: a bill can be paid across cash + UPI. When the
--     sum of payments.amount_paise reaches bills.total_paise the service flips
--     status to 'paid' and closes the parent order.
--   * Voiding a bill is only allowed while status='open' and no payments exist.
--     Refund workflow (voiding a paid bill) is explicitly out of v1.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE bill_status AS ENUM ('open', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE discount_type AS ENUM ('flat', 'percent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'upi', 'card', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS bills (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id           UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  bill_number         BIGSERIAL,
  -- All amounts in paise.
  subtotal_paise      BIGINT NOT NULL CHECK (subtotal_paise >= 0),
  discount_type       discount_type,
  -- For 'flat' this is the paise amount of the discount (informational — the
  -- computed paise value goes in discount_paise). For 'percent' this is bps
  -- (500 = 5%). NULL when no discount. This column represents the BILL-LEVEL
  -- discount only; per-line discounts live on bill_items and their total is
  -- denormalized into line_discount_total_paise below.
  discount_value      BIGINT,
  discount_paise      BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  discount_reason     TEXT,
  -- Denormalized sum of bill_items.line_discount_paise. Kept on bills so the
  -- daily-sales report can read "total discount applied" in a single column
  -- without joining back to bill_items.
  line_discount_total_paise BIGINT NOT NULL DEFAULT 0 CHECK (line_discount_total_paise >= 0),
  taxable_paise       BIGINT NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise          BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise          BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  total_tax_paise     BIGINT NOT NULL DEFAULT 0 CHECK (total_tax_paise >= 0),
  round_off_paise     BIGINT NOT NULL DEFAULT 0,
  total_paise         BIGINT NOT NULL CHECK (total_paise >= 0),
  paid_paise          BIGINT NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  status              bill_status NOT NULL DEFAULT 'open',
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  voided_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No UNIQUE (order_id): an order can carry multiple bills when the guests
  -- split the cheque. Each split is a full first-class bill. Enforcement of
  -- "no double-billing the same order_item" lives in the service layer
  -- (generateSplitBillsForOrder validates disjoint orderItemId sets).
);

CREATE INDEX IF NOT EXISTS idx_bills_outlet_status
  ON bills (outlet_id, status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_outlet_generated_at
  ON bills (outlet_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS bill_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id             UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  bill_id               UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  order_item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  -- Snapshot again at bill time so reports can run off bill_items alone.
  menu_item_name        TEXT NOT NULL,
  variation_name        TEXT,
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise      BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  addons_paise          BIGINT NOT NULL DEFAULT 0 CHECK (addons_paise >= 0),
  line_subtotal_paise   BIGINT NOT NULL CHECK (line_subtotal_paise >= 0),
  -- Per-line discount. Applied BEFORE any bill-level discount so the bill-level
  -- discount pro-rates over already-discounted lines (matches how real POS
  -- systems stack "10% off this item + 5% loyalty on the whole bill").
  -- line_discount_value is paise for 'flat', bps for 'percent'. NULL = no line
  -- discount on this row.
  line_discount_type    discount_type,
  line_discount_value   BIGINT,
  line_discount_paise   BIGINT NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0),
  line_discount_reason  TEXT,
  tax_rate_bps          INTEGER NOT NULL CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000),
  cgst_paise            BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise            BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  line_total_paise      BIGINT NOT NULL CHECK (line_total_paise >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_outlet_date
  ON bill_items (outlet_id, created_at DESC);
-- Fast lookup for the no-double-billing trigger below.
CREATE INDEX IF NOT EXISTS idx_bill_items_order_item
  ON bill_items (order_item_id);

-- ----------------------------------------------------------------------------
-- Trigger: prevent the same order_item from being billed on two non-void
-- bills. The service layer validates this during split-bill generation, but
-- a DB-level guard ensures a race or code bug can never silently double-bill
-- a line item. Voided bills are excluded so re-billing after a void works.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_no_double_billing()
  RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
     WHERE bi.order_item_id = NEW.order_item_id
       AND b.status <> 'void'
       AND bi.bill_id <> NEW.bill_id
  ) THEN
    RAISE EXCEPTION 'order_item % is already billed on a non-void bill',
      NEW.order_item_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_double_billing ON bill_items;
CREATE TRIGGER trg_no_double_billing
  BEFORE INSERT ON bill_items
  FOR EACH ROW
  EXECUTE FUNCTION check_no_double_billing();

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id       UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  method          payment_method NOT NULL,
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  reference       TEXT,
  note            TEXT,
  received_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Client-generated UUID. Staff app sends this on every recordPayment call;
  -- if the network retries or the user double-taps, the UNIQUE constraint
  -- deduplicates so the bill is credited exactly once.
  idempotency_key UUID,
  -- A voided payment is soft-deleted: the row is preserved for audit but
  -- its amount is excluded from bill.paid_paise and from revenue reports.
  -- Two cases produce voids: (a) an individual payment correction (staff
  -- recorded the wrong method/amount) and (b) a bill refund (all payments
  -- on the bill are voided in one operation as part of the refund flow).
  is_void         BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason     TEXT,
  voided_at       TIMESTAMPTZ,
  voided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent ALTERs for databases that were migrated before the void columns
-- existed. CREATE TABLE IF NOT EXISTS is a no-op on already-created tables,
-- so we need these to catch upgraded schemas.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_void     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key UUID;

-- Idempotency: at most one non-void payment per key per outlet. The partial
-- index excludes NULLs (legacy rows without a key) and voided payments (so a
-- voided payment's key can be reused if the staff retries).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON payments (outlet_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND is_void = FALSE;

-- ----------------------------------------------------------------------------
-- Phase 1: tenant_id on every business table (NULLABLE until Phase 2)
-- ----------------------------------------------------------------------------
-- These columns are added NULLABLE so that existing INSERT statements (which
-- don't yet supply tenant_id) continue to work through the Phase 1 window.
-- Phase 2 updates every repository to set tenant_id on insert, then flips
-- these columns to NOT NULL. Phase 3 adds RLS policies keyed on tenant_id.
--
-- The backfill block at the bottom of this file populates these on any rows
-- that predate Phase 1.
-- ----------------------------------------------------------------------------
ALTER TABLE outlets              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE users                ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE users                ADD COLUMN IF NOT EXISTS is_tenant_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE menu_categories      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE menu_items           ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE menu_item_variations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE menu_addons          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE dining_tables        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE orders               ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE order_items          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE kots                 ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE bills                ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE bill_items           ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE payments             ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

-- Fast per-tenant scans. Once Phase 2 makes tenant_id NOT NULL these become
-- the primary filter index for every read path.
CREATE INDEX IF NOT EXISTS idx_outlets_tenant         ON outlets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant           ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_tenant ON menu_categories (tenant_id);

-- Category hierarchy support
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES menu_categories(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_menu_categories_parent ON menu_categories (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_items_tenant      ON menu_items (tenant_id);

-- CSV import fields on menu_items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS food_type TEXT NOT NULL DEFAULT 'veg';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS short_code TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS hsn_code TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS packing_charge_paise BIGINT NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS online_name TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS goods_or_services TEXT NOT NULL DEFAULT 'goods';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allow_decimal_qty BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_food_type_check') THEN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_food_type_check CHECK (food_type IN ('veg', 'non-veg', 'egg'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_packing_charge_paise_check') THEN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_packing_charge_paise_check CHECK (packing_charge_paise >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_goods_or_services_check') THEN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_goods_or_services_check CHECK (goods_or_services IN ('goods', 'services'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_short_code
  ON menu_items (outlet_id, short_code) WHERE short_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_addons_tenant     ON menu_addons (tenant_id);

-- Addon groups with selection constraints
CREATE TABLE IF NOT EXISTS menu_addon_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id       UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  selection_type  TEXT NOT NULL DEFAULT 'multi' CHECK (selection_type IN ('single', 'multi')),
  min_selections  INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections  INTEGER NOT NULL DEFAULT 0 CHECK (max_selections >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, name)
);

ALTER TABLE menu_addon_groups ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_menu_addon_groups_tenant ON menu_addon_groups (tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_addon_groups_outlet ON menu_addon_groups (outlet_id, display_order) WHERE is_active = TRUE;

ALTER TABLE menu_addons ADD COLUMN IF NOT EXISTS addon_group_id UUID REFERENCES menu_addon_groups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS menu_item_addon_groups (
  item_id         UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  addon_group_id  UUID NOT NULL REFERENCES menu_addon_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, addon_group_id)
);

CREATE INDEX IF NOT EXISTS idx_dining_tables_tenant   ON dining_tables (tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant          ON orders (tenant_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_kots_tenant            ON kots (tenant_id, status, sent_at);
CREATE INDEX IF NOT EXISTS idx_bills_tenant           ON bills (tenant_id, generated_at DESC);

-- Line-level discount columns on bill_items + denormalized total on bills.
-- Added in the item-level-discount iteration; same idempotent pattern.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS line_discount_total_paise
  BIGINT NOT NULL DEFAULT 0 CHECK (line_discount_total_paise >= 0);
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS line_discount_type   discount_type;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS line_discount_value  BIGINT;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS line_discount_paise
  BIGINT NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0);
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS line_discount_reason TEXT;

-- Split-bills migration: drop the UNIQUE(order_id) constraint on bills so an
-- order can carry multiple bills. pgcrypto doesn't auto-name constraints
-- predictably across major versions, so scrub any constraint whose definition
-- pins (order_id) as a unique key.
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bills'::regclass
       AND contype  = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (order_id)'
  LOOP
    EXECUTE format('ALTER TABLE bills DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;
-- Lookup index for "all bills on this order" — previously covered by the
-- unique constraint, now explicit.
CREATE INDEX IF NOT EXISTS idx_bills_order ON bills (order_id);

CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments (bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_outlet_date
  ON payments (outlet_id, received_at DESC);

-- ----------------------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------------------
-- Every mutation to a business-critical entity writes a row here.
-- `before` and `after` are JSONB snapshots; for INSERTs, `before` is NULL;
-- for DELETEs (which we avoid), `after` is NULL.
--
-- We do NOT use triggers for this; the middleware layer writes audit rows
-- explicitly, because it has access to the authenticated actor, request id,
-- and HTTP context that triggers don't.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email    TEXT,                       -- snapshot in case user deleted
  entity_type    TEXT NOT NULL,              -- e.g. 'menu_item'
  entity_id      TEXT NOT NULL,              -- stringified id (UUID or int)
  action         TEXT NOT NULL,              -- 'create' | 'update' | 'delete'
  before         JSONB,
  after          JSONB,
  request_id     TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log (outlet_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log (actor_id, created_at DESC);

-- tenant_id on audit_log (added here because audit_log is defined after the tenant ALTER block)
ALTER TABLE audit_log            ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant       ON audit_log (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- user_devices (long-lived tokens for paired staff phones / tablets)
-- ----------------------------------------------------------------------------
-- Created when a staff member successfully consumes a pairing code with the
-- mobile app. One row per installed app; revoking the row kills the app's
-- ability to login without touching the user's password.
--
-- Token format is `<device_id>.<secret>` where secret is 32 bytes of base64url
-- entropy. We store bcrypt(secret) in token_hash so the DB dump alone is not
-- enough to impersonate a device. The device_id prefix is a plain UUID so the
-- server can look the row up in O(1) before running bcrypt — without the
-- prefix we would have to bcrypt-compare against every active row.
--
-- revoked_at is a soft-delete. Once set, device-login short-circuits. We keep
-- the row for audit ("which device/IP logged in when").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,                  -- e.g. "Riya's iPhone" — staff-visible
  platform       TEXT,                           -- 'ios' | 'android' | NULL (self-reported)
  token_hash     TEXT NOT NULL,                  -- bcrypt of the opaque device secret
  -- Auto-expiry: devices that haven't re-paired after this timestamp are
  -- rejected at login even if not explicitly revoked. Default 1 year from
  -- creation. Admins can adjust per-device if needed.
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year'),
  last_seen_at   TIMESTAMPTZ,
  last_ip        TEXT,
  revoked_at     TIMESTAMPTZ,
  revoked_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user
  ON user_devices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_devices_outlet_active
  ON user_devices (outlet_id) WHERE revoked_at IS NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year');

-- ----------------------------------------------------------------------------
-- device_pairings (short-lived codes for the QR pairing flow)
-- ----------------------------------------------------------------------------
-- An admin clicks "Pair device" on a user's page → a row lands here with a
-- 10-minute TTL and a random 8-char code. The code is hashed (SHA-256, not
-- bcrypt — we need to look up by exact match, and 8 chars has enough entropy
-- for the 10-minute window as long as we rate-limit the consume endpoint).
--
-- Single-use: consumed_at flips when the mobile app exchanges the code for a
-- device token. The row is preserved for audit. An attacker who steals the
-- QR AFTER consumption finds the code already burned.
--
-- Why hash at all for such a short-lived code: defence in depth against a
-- DB-read attacker racing a still-valid code, and it costs nothing — SHA-256
-- on 8 chars is a microsecond.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_pairings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id             UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  code_hash             TEXT NOT NULL,                 -- sha256 hex of the 8-char code
  created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  consumed_device_id    UUID REFERENCES user_devices(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active-code lookup path. Partial index so the hot path is tiny even as
-- consumed rows accumulate.
CREATE INDEX IF NOT EXISTS idx_device_pairings_active_code
  ON device_pairings (code_hash)
  WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- service_alerts (floor ↔ kitchen call buttons)
-- ----------------------------------------------------------------------------
-- A small, bounded stream of "human needs attention here" events. Raised by
-- staff on the floor (call the kitchen, call a manager) or by kitchen staff
-- (call a waiter to table 5). Acknowledged by whoever picks it up.
--
-- Intentionally NOT a queue, not a chat, not a notification system. Every
-- alert is one row with a kind, an optional table, an optional note, and a
-- nullable acknowledged_at. That's the entire data model. Anything more
-- (replies, priorities, SLAs) belongs in v2.
--
-- Kind enum:
--   'call_waiter'   — kitchen pressed "waiter needed", optionally for a table
--   'call_kitchen'  — floor pressed "need the kitchen", e.g. for a modification
--   'call_manager'  — floor pressed "need a manager" (comps, complaints, etc.)
--
-- Real-time delivery is via the existing /ws/kds channel (now a general
-- outlet event bus). The DB row is the source of truth; WS is latency glue.
-- Clients fetch the unacked list on reconnect via GET /alerts?active=true.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE service_alert_kind AS ENUM ('call_waiter', 'call_kitchen', 'call_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS service_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id           UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  kind                service_alert_kind NOT NULL,
  table_id            UUID REFERENCES dining_tables(id) ON DELETE SET NULL,
  note                TEXT,
  raised_by           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  acknowledged_at     TIMESTAMPTZ,
  acknowledged_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "show me every open alert for this outlet, newest first."
-- Partial index keeps the working set to unacked rows only.
CREATE INDEX IF NOT EXISTS idx_service_alerts_active_outlet
  ON service_alerts (outlet_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Blocker 8: suspendedAt on tenants for token invalidation
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- refresh_tokens (Blocker 2 — token lifecycle)
-- ----------------------------------------------------------------------------
-- Long-lived tokens for session continuity. Staff and kitchen roles get 12h
-- access tokens (no login prompt during a full shift); admin/manager get 2h.
-- The refresh token extends the session up to 7 days. Token rotation: each
-- refresh invalidates the old token and issues a new pair.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL,                  -- sha256 hex of the opaque token
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
  ON refresh_tokens (token_hash) WHERE is_revoked = FALSE;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON refresh_tokens (user_id) WHERE is_revoked = FALSE;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_tenant
  ON refresh_tokens (tenant_id) WHERE is_revoked = FALSE;

-- RLS for refresh_tokens
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refresh_tokens;
CREATE POLICY tenant_isolation ON refresh_tokens
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );

-- ----------------------------------------------------------------------------
-- Outlet settings columns (Blocker 7 — tenant settings)
-- ----------------------------------------------------------------------------
-- These live on outlets because each physical location can have different
-- GSTIN, address, tax rates, and operational settings. The existing gstin,
-- fssai_no, address, phone, email columns are retained; structured address
-- fields are added alongside the legacy single-text `address` column.
-- ----------------------------------------------------------------------------
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS address_line1       TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS address_line2       TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS city                TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS state               TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS pincode             TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS default_tax_rate_bps INTEGER NOT NULL DEFAULT 500;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS bill_number_prefix  TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_footer_text TEXT NOT NULL DEFAULT 'Thank you for your visit.';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS max_discount_bps    INTEGER;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS kot_warning_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS kot_urgent_minutes  INTEGER NOT NULL DEFAULT 10;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS auto_restock        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS auto_restock_time   TEXT NOT NULL DEFAULT '06:00';

-- ----------------------------------------------------------------------------
-- updated_at auto-bump trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants',
      'platform_users',
      'outlets', 'users',
      'menu_categories', 'menu_items',
      'menu_item_variations', 'menu_addons',
      'menu_addon_groups',
      'dining_tables',
      'orders', 'kots', 'order_items',
      'bills'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;
       CREATE TRIGGER trg_%I_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================================
-- Phase 1 backfill: wire pre-tenant data into a default tenant
-- ============================================================================
-- This block runs every time schema.sql is applied but is a no-op unless
-- there is data that predates the tenant layer. The check is "any outlet
-- row with NULL tenant_id" — if there isn't one, nothing happens.
--
-- Strategy:
--   1. If any outlet has NULL tenant_id AND no tenants row exists, create a
--      'Default Tenant'. This is the one-time upgrade path from v1 → v2 on
--      the existing dev/demo database. For a fresh install (no outlets at
--      all), this is a no-op — the first real tenant is created by the
--      signup flow in Phase 2.
--   2. Backfill tenant_id on every business table using the single tenant.
--      Uses `WHERE tenant_id IS NULL` so rows that already have a tenant
--      are untouched. Safe to re-run.
--   3. For existing users, populate user_outlet_access so they retain the
--      ability to work at their outlet after Phase 2 removes users.outlet_id.
--      Pre-Phase-2 admins get is_tenant_owner=TRUE so their owner powers
--      survive the transition. Everyone else (manager/staff/kitchen) gets
--      a user_outlet_access row with their current role.
-- ============================================================================
DO $$
DECLARE
  default_tenant_id UUID;
BEGIN
  -- Only act if there is unbackfilled data
  IF NOT EXISTS (SELECT 1 FROM outlets WHERE tenant_id IS NULL) THEN
    RETURN;
  END IF;

  -- Pick or create the tenant to backfill against. If a tenant already
  -- exists (e.g., manual provision happened out-of-band), use the oldest
  -- one. Otherwise create 'Default Tenant'.
  SELECT id INTO default_tenant_id
    FROM tenants
    ORDER BY created_at
    LIMIT 1;

  IF default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, slug, status)
    VALUES ('Default Tenant', 'default', 'active')
    RETURNING id INTO default_tenant_id;
  END IF;

  -- Backfill every business table. Order doesn't matter for correctness
  -- since these are independent UPDATEs filtered by IS NULL.
  UPDATE outlets              SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE users                SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE menu_categories      SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE menu_items           SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE menu_item_variations SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE menu_addons          SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE dining_tables        SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE orders               SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE order_items          SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE kots                 SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE bills                SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE bill_items           SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE payments             SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE audit_log            SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Promote pre-Phase-1 admins to tenant_owner. The old 'admin' role was
  -- tenant-owner-equivalent in a single-outlet world; carry that forward.
  UPDATE users SET is_tenant_owner = TRUE
   WHERE role = 'admin' AND is_tenant_owner = FALSE;

  -- Populate user_outlet_access for existing non-owner users so they still
  -- have an outlet binding after Phase 2 drops users.outlet_id. ON CONFLICT
  -- makes this safe to re-run.
  INSERT INTO user_outlet_access (user_id, outlet_id, role)
  SELECT u.id, u.outlet_id, u.role
    FROM users u
   WHERE u.is_tenant_owner = FALSE
     AND u.outlet_id IS NOT NULL
  ON CONFLICT (user_id, outlet_id) DO NOTHING;
END $$;

-- ============================================================================
-- Phase 3c: Row Level Security
-- ============================================================================
-- Defence-in-depth on top of the application-layer WHERE-clause discipline.
-- Every authenticated HTTP request runs inside a transaction that first sets
-- a session variable `app.current_tenant_id` to the caller's tenant. The
-- policies below evaluate against that setting and block any row whose
-- tenant_id doesn't match, regardless of what the query's WHERE clause says.
--
-- Escape hatches:
--   * Empty / missing `app.current_tenant_id` → policy is permissive. This
--     preserves the old behaviour for background jobs, the migrate script,
--     the seed script, and the test harness, which do NOT go through the
--     request middleware. Trusting these contexts is acceptable because they
--     run operator code, not untrusted HTTP input.
--   * `app.is_platform='on'` → policy is permissive. Set by the platform
--     super-admin middleware so /api/v1/platform endpoints can read and
--     write any tenant's rows.
--
-- The threat model this closes:
--   An HTTP request authenticated as tenant A runs a buggy query (missing
--   WHERE tenant_id clause, mis-joined id, sloppy string concat) that would
--   otherwise return tenant B's rows. RLS blocks it at the storage layer.
--
-- Prerequisite: every row we want to protect must have a non-NULL tenant_id.
-- The core business tables (orders/bills/payments/...) still get inserted
-- without a tenant_id by several repositories. Rather than touching all of
-- them, we install a BEFORE INSERT trigger that populates tenant_id from
-- outlets.tenant_id when left NULL. Idempotent — if the caller supplied
-- tenant_id explicitly, the trigger leaves it alone.
-- ----------------------------------------------------------------------------

-- BEFORE INSERT trigger: fill tenant_id from outlet_id when the caller left
-- it NULL. This is what lets us enable RLS without touching every repository.
CREATE OR REPLACE FUNCTION fill_tenant_id_from_outlet() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.outlet_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM outlets WHERE id = NEW.outlet_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users',
      'menu_categories', 'menu_items', 'menu_addons', 'menu_addon_groups',
      'dining_tables',
      'orders', 'order_items', 'kots',
      'bills', 'bill_items', 'payments',
      'audit_log',
      'user_devices', 'device_pairings', 'service_alerts'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_fill_tenant ON %I;
       CREATE TRIGGER trg_%I_fill_tenant
         BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION fill_tenant_id_from_outlet();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- menu_item_variations has no outlet_id — derive tenant_id from the parent
-- menu_items row instead. Separate trigger because the lookup path is different.
CREATE OR REPLACE FUNCTION fill_variation_tenant_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.item_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM menu_items WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_menu_item_variations_fill_tenant ON menu_item_variations;
CREATE TRIGGER trg_menu_item_variations_fill_tenant
  BEFORE INSERT ON menu_item_variations
  FOR EACH ROW EXECUTE FUNCTION fill_variation_tenant_id();

-- Final backfill pass — any row still NULL gets its tenant_id from the
-- denormalization path. Safe to re-run. Covers the narrow window where a
-- row was inserted between the Phase 1 backfill and this trigger landing.
UPDATE orders        o SET tenant_id = out.tenant_id FROM outlets out WHERE o.outlet_id = out.id AND o.tenant_id IS NULL;
UPDATE order_items   oi SET tenant_id = out.tenant_id FROM outlets out WHERE oi.outlet_id = out.id AND oi.tenant_id IS NULL;
UPDATE kots          k SET tenant_id = out.tenant_id FROM outlets out WHERE k.outlet_id = out.id AND k.tenant_id IS NULL;
UPDATE bills         b SET tenant_id = out.tenant_id FROM outlets out WHERE b.outlet_id = out.id AND b.tenant_id IS NULL;
UPDATE bill_items    bi SET tenant_id = out.tenant_id FROM outlets out WHERE bi.outlet_id = out.id AND bi.tenant_id IS NULL;
UPDATE payments      p SET tenant_id = out.tenant_id FROM outlets out WHERE p.outlet_id = out.id AND p.tenant_id IS NULL;
UPDATE audit_log     a SET tenant_id = out.tenant_id FROM outlets out WHERE a.outlet_id = out.id AND a.tenant_id IS NULL;
UPDATE menu_categories m SET tenant_id = out.tenant_id FROM outlets out WHERE m.outlet_id = out.id AND m.tenant_id IS NULL;
UPDATE menu_items    mi SET tenant_id = out.tenant_id FROM outlets out WHERE mi.outlet_id = out.id AND mi.tenant_id IS NULL;
UPDATE menu_addons   ma SET tenant_id = out.tenant_id FROM outlets out WHERE ma.outlet_id = out.id AND ma.tenant_id IS NULL;
UPDATE dining_tables d SET tenant_id = out.tenant_id FROM outlets out WHERE d.outlet_id = out.id AND d.tenant_id IS NULL;
UPDATE menu_item_variations v
   SET tenant_id = mi.tenant_id
  FROM menu_items mi
 WHERE v.item_id = mi.id AND v.tenant_id IS NULL;
UPDATE users         u SET tenant_id = out.tenant_id FROM outlets out WHERE u.outlet_id = out.id AND u.tenant_id IS NULL;

-- ----------------------------------------------------------------------------
-- Enable RLS + install tenant-isolation policies
-- ----------------------------------------------------------------------------
-- Pattern for each table:
--   ENABLE + FORCE RLS (FORCE so the table owner is also restricted — without
--   it, the app user would bypass policies if it happened to own the tables).
--   Single policy `tenant_isolation` covering ALL command types. USING is the
--   read/delete/update-existing predicate; WITH CHECK is the insert/update-new
--   predicate. Making them the same eliminates a class of bugs where reads
--   are gated but writes aren't.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
  tenant_col TEXT := 'tenant_id';
  policy_expr TEXT;
BEGIN
  -- Predicate: allow when session var is empty (trusted context), when the
  -- platform-admin flag is on, or when the row's tenant_id matches the
  -- current_setting. `true` as second arg = missing_ok, returns '' on unset.
  policy_expr :=
    $P$(
      coalesce(current_setting('app.current_tenant_id', true), '') = ''
      OR current_setting('app.is_platform', true) = 'on'
      OR tenant_id::text = current_setting('app.current_tenant_id', true)
    )$P$;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'outlets', 'users',
      'menu_categories', 'menu_items', 'menu_item_variations', 'menu_addons', 'menu_addon_groups',
      'dining_tables',
      'orders', 'order_items', 'kots',
      'bills', 'bill_items', 'payments',
      -- audit_log handled separately below (append-only: SELECT + INSERT only)
      'user_devices', 'device_pairings', 'service_alerts',
      'staff_invites'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING %s
         WITH CHECK %s',
      tbl, policy_expr, policy_expr
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- audit_log: append-only — tenants may SELECT and INSERT but NEVER UPDATE or
-- DELETE. This is a security-critical invariant: if a compromised tenant
-- session could DELETE/UPDATE audit rows it could erase evidence of its own
-- actions. We enforce this at two layers:
--   1. RLS policies: only FOR SELECT and FOR INSERT (no UPDATE/DELETE policy)
--   2. REVOKE: if the food_app role exists, strip UPDATE/DELETE table privs
-- ----------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit_log;
DROP POLICY IF EXISTS audit_log_select ON audit_log;
DROP POLICY IF EXISTS audit_log_insert ON audit_log;

CREATE POLICY audit_log_select ON audit_log
  FOR SELECT
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );

-- Defense-in-depth: REVOKE UPDATE/DELETE at the privilege level so even if
-- someone accidentally adds a permissive UPDATE policy in the future, the
-- role still can't run the statement. Guarded by role existence check so the
-- schema works in dev environments without the production role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_log FROM food_app';
  END IF;
END $$;

-- Join tables without their own tenant_id column — policy joins through the
-- parent. menu_item_addons gates on menu_items, user_outlet_access gates on
-- users. When users / menu_items are themselves RLS-protected, the subquery
-- inside the policy runs under the same session context, so it naturally
-- inherits the tenant filter.
ALTER TABLE menu_item_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_addons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_item_addons;
CREATE POLICY tenant_isolation ON menu_item_addons
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id = menu_item_addons.item_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id = menu_item_addons.item_id)
  );

ALTER TABLE menu_item_addon_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_addon_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_item_addon_groups;
CREATE POLICY tenant_isolation ON menu_item_addon_groups
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id = menu_item_addon_groups.item_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id = menu_item_addon_groups.item_id)
  );

ALTER TABLE user_outlet_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_outlet_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_outlet_access;
CREATE POLICY tenant_isolation ON user_outlet_access
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_outlet_access.user_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_outlet_access.user_id)
  );

-- tenants: top-level table, no tenant_id column. Policy: platform bypass, or
-- the row's own id matches the session tenant. This lets a tenant-authenticated
-- request read/update only its own tenants row (e.g. for the settings page).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR id::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.current_tenant_id', true), '') = ''
    OR current_setting('app.is_platform', true) = 'on'
    OR id::text = current_setting('app.current_tenant_id', true)
  );

-- platform_users, signup_tokens, email_outbox: intentionally NOT RLS-protected.
-- platform_users is the isolated operator pool, reached only via platform auth.
-- signup_tokens is pre-auth (the visitor has no tenant yet).
-- email_outbox is a system-level queue touched by the worker, not user code.

-- ----------------------------------------------------------------------------
-- Phase 2/3c finalization: tenant_id NOT NULL
-- ----------------------------------------------------------------------------
-- Every tenant-scoped table now has a BEFORE INSERT trigger that populates
-- tenant_id from the parent (outlet or menu_item), and the Phase 1 backfill
-- + final pass above cleared any historical NULLs. Tightening the column to
-- NOT NULL turns any future code path that bypasses the trigger (e.g. a COPY
-- import that disables triggers, or a raw INSERT that explicitly sets
-- tenant_id=NULL) into a loud constraint violation instead of a silent
-- RLS-invisible row.
--
-- Uses an idempotent DO block with pg_attribute lookups so re-applying the
-- schema on an already-tightened DB is a no-op.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'outlets', 'users',
      'menu_categories', 'menu_items', 'menu_item_variations', 'menu_addons', 'menu_addon_groups',
      'dining_tables',
      'orders', 'order_items', 'kots',
      'bills', 'bill_items', 'payments',
      'audit_log'
    ])
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = tbl::regclass
         AND attname = 'tenant_id'
         AND attnotnull = FALSE
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
