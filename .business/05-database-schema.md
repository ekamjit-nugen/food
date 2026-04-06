# Database Schema

## Entity Relationship Overview

```
Platform
  └── platform_users (super-admins)

Tenant (restaurant brand)
  ├── outlets (physical locations)
  ├── users (staff)
  │   ├── user_outlet_access (many-to-many)
  │   ├── user_devices (mobile pairings)
  │   └── device_pairings (QR codes)
  ├── menu_categories
  │   └── menu_items
  │       ├── menu_item_variations
  │       └── menu_item_addons → menu_addons
  ├── dining_tables
  ├── orders
  │   ├── order_items (snapshots)
  │   └── kots (kitchen order tickets)
  ├── bills
  │   ├── bill_items (tax breakdown)
  │   └── payments
  ├── service_alerts
  ├── staff_invites
  ├── signup_tokens
  ├── email_outbox
  └── audit_log (append-only)
```

## Core Tables

### Tenants & Platform

| Table | Key Columns | Notes |
|-------|------------|-------|
| `tenants` | id, name, slug, status, owner_email | Statuses: trial, active, suspended, cancelled |
| `platform_users` | id, email, password_hash, full_name | Separate from tenant users |
| `outlets` | id, tenant_id, name, code | Physical restaurant locations |

### Users & Auth

| Table | Key Columns | Notes |
|-------|------------|-------|
| `users` | id, tenant_id, email, password_hash, full_name, role, is_tenant_owner, is_active | Roles: admin, manager, staff, kitchen |
| `user_outlet_access` | user_id, outlet_id | Many-to-many outlet access |
| `user_devices` | id, user_id, device_id, token_hash, expires_at, revoked_at, last_seen_at | Bcrypt-hashed device tokens |
| `device_pairings` | id, user_id, code_hash, expires_at, consumed_at | SHA256-hashed 8-char codes, 10-min TTL |
| `staff_invites` | id, tenant_id, email, full_name, role, token, outlet_ids, consumed_at | Token-based invite flow |
| `signup_tokens` | id, tenant_id, email, token, verified_at | Email verification (deferred) |
| `email_outbox` | id, tenant_id, template, to_email, payload, status, attempts, last_error | Provider-agnostic email queue |

### Menu

| Table | Key Columns | Notes |
|-------|------------|-------|
| `menu_categories` | id, tenant_id, outlet_id, name, display_order, is_active | Soft delete via is_active |
| `menu_items` | id, category_id, name, price_paise, tax_rate_bps, description, is_active, in_stock | BIGINT paise, tax in basis points |
| `menu_item_variations` | id, item_id, name, price_delta_paise | Size/option variants |
| `menu_addons` | id, tenant_id, outlet_id, name, price_paise, is_active | Reusable across items |
| `menu_item_addons` | item_id, addon_id | Many-to-many junction |

### Orders & Kitchen

| Table | Key Columns | Notes |
|-------|------------|-------|
| `dining_tables` | id, tenant_id, outlet_id, code, label, section, seats, display_order, is_active | Physical tables |
| `orders` | id, tenant_id, outlet_id, order_number, type, table_id, status, created_by | Statuses: open, closed, cancelled |
| `order_items` | id, order_id, menu_item_id, kot_id, name, unit_price_paise, tax_rate_bps, qty, notes, variation_snapshot, addon_snapshot, is_void | Menu snapshots frozen at order time |
| `kots` | id, order_id, status, created_at | Kitchen Order Tickets. Statuses: new, in_progress, ready, served, void |

### Billing & Payments

| Table | Key Columns | Notes |
|-------|------------|-------|
| `bills` | id, order_id, status, subtotal_paise, discount_paise, discount_type, discount_value, tax_paise, total_paise, round_off_paise, paid_paise, line_discount_total_paise | Statuses: open, paid, void, refunded |
| `bill_items` | id, bill_id, order_item_id, subtotal_paise, line_discount_paise, bill_discount_share_paise, taxable_paise, tax_paise, cgst_paise, sgst_paise, total_paise | Full per-line tax breakdown |
| `payments` | id, bill_id, method, amount_paise, idempotency_key, is_void | Methods: cash, upi, card, other. Idempotent via key |

### Alerts & Audit

| Table | Key Columns | Notes |
|-------|------------|-------|
| `service_alerts` | id, tenant_id, outlet_id, type, created_by, acknowledged_by, acknowledged_at | Types: call_waiter, call_kitchen, call_manager |
| `audit_log` | id, tenant_id, outlet_id, actor_id, actor_email, entity_type, entity_id, action, before, after, request_id, created_at | Append-only (RLS enforced), JSONB before/after |

## Money Model

- **All monetary values:** BIGINT paise (1 INR = 100 paise)
- **Tax rates:** Integer basis points (500 bps = 5%, 1800 bps = 18%)
- **No floating point:** Pure integer arithmetic throughout
- **CGST/SGST split:** cgst = floor(tax/2), sgst = tax - cgst
- **Rounding:** Nearest rupee with `round_off_paise` tracking

## Key Constraints & Indexes

- **Foreign keys:** ON DELETE RESTRICT on critical tables (no cascading deletes)
- **Unique indexes:** Per-outlet uniqueness (category name, table code, etc.)
- **Partial indexes:** On active/unacked rows for efficient queries
- **CHECK constraints:** Non-negative money values, max bounds
- **No-double-billing trigger:** Prevents same order_item appearing in multiple bills
- **RLS policies:** `app.current_tenant_id` session variable enforcement on all tables
- **Audit log protection:** RLS append-only (no UPDATE/DELETE) + REVOKE

## Multi-Tenancy (Database Level)

```
Per-request middleware:
  1. Check out PoolClient from connection pool
  2. SET app.current_tenant_id = '<tenant-uuid>' (session GUC)
  3. SET app.current_outlet_id = '<outlet-uuid>'
  4. Run request inside AsyncLocalStorage scope
  5. RLS policies automatically filter all queries
  6. Reset GUCs on response finish

RLS Policy Pattern:
  (app.current_tenant_id = '' OR app.is_platform = 'on' OR tenant_id = app.current_tenant_id)
```
