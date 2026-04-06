# POS Blocker Fixes — Implementation Summary

> All 10 blockers from `pos-blocker-fix-prompts.md` implemented on 2026-04-06.
> Both `server/` and `web/` type-check clean (`tsc --noEmit` passes).

---

## Blocker 10: Standard Error Response Format

**Status**: Done

**Problem**: Different endpoints returned errors in different shapes (`{ message }`, `{ error }`, plain strings). Frontend had to guess.

**What changed**:

- `server/src/utils/errors.ts` — All error codes upgraded to UPPER_SNAKE_CASE. Added `ErrorCode` registry with every known code (`VALIDATION_ERROR`, `TOKEN_EXPIRED`, `TENANT_SUSPENDED`, `SLUG_ALREADY_TAKEN`, `BILL_EXISTS`, `DRAFT_ITEMS_EXIST`, `ORDER_NOT_OPEN`, `INVALID_KOT_TRANSITION`, `TABLE_CODE_EXISTS`, `TABLE_HAS_ORDER`, `EMAIL_ALREADY_EXISTS`, `INVITE_EXPIRED`, `ACCOUNT_DEACTIVATED`, `RATE_LIMITED`, etc.). Added `ValidationError` factory.
- `server/src/middleware/error.ts` — Uses `ErrorCode.INTERNAL_ERROR` and `ErrorCode.NOT_FOUND` for fallback/404 responses.
- `server/src/middleware/validate.ts` — Zod validation errors now return code `VALIDATION_ERROR` with `{ fields, formErrors }` in details.
- `server/src/middleware/auth.ts` — Distinguishes `TOKEN_EXPIRED` vs generic `UNAUTHORIZED`. Returns `TENANT_SUSPENDED` for suspended tenants.
- `server/src/modules/auth/auth.service.ts` — Login returns `INVALID_CREDENTIALS`. Deactivated accounts return `ACCOUNT_DEACTIVATED`. Signup slug conflict returns `SLUG_ALREADY_TAKEN`. Duplicate email returns `EMAIL_ALREADY_EXISTS`. Expired invites return `INVITE_EXPIRED`.
- `server/src/modules/orders/orders.service.ts` — Uses `ORDER_NOT_OPEN`, `INVALID_KOT_TRANSITION`.
- `server/src/modules/billing/billing.service.ts` — Uses `BILL_EXISTS`, `DRAFT_ITEMS_EXIST`.
- `server/src/modules/tables/tables.service.ts` — Uses `TABLE_CODE_EXISTS`, `TABLE_HAS_ORDER`.
- `server/src/modules/users/users.service.ts` — Uses `EMAIL_ALREADY_EXISTS`.
- `server/src/modules/auth/auth.routes.ts` — All rate-limit messages use `RATE_LIMITED` code.

**Response shape (always)**:
```json
{ "error": { "code": "UPPER_SNAKE_CASE", "message": "Human-readable.", "details": {} } }
```

---

## Blocker 1: Password Validation Mismatch

**Status**: Done

**Problem**: Client validated min 8 chars; server enforced min 10 + letter + digit. Users passed client validation but failed server validation.

**What changed**:

- `web/src/lib/password.ts` — **New file**. Shared `validatePassword()` function and `PASSWORD_HINT` constant. Rules: min 10 chars, at least one letter, at least one digit, max 128 chars. Mirrors the server's `PasswordSchema` in `auth.schemas.ts`.
- `web/src/pages/signup.tsx` — Replaced `password.length < 8` check with `validatePassword()`. Updated `minLength` attribute to 10. Helper text now reads "At least 10 characters with a letter and a number."
- `web/src/pages/accept-invite.tsx` — Same changes as signup.

**No server changes needed** — the server already enforced the correct rules.

---

## Blocker 7: Tenant Settings Page

**Status**: Done

**Problem**: No settings page existed. GSTIN, address, FSSAI, tax rates, KDS thresholds, and other configurations had nowhere to be managed.

**What changed**:

### Schema
- `server/src/db/schema.sql` — Added 13 columns to `outlets` table: `address_line1`, `address_line2`, `city`, `state`, `pincode`, `default_tax_rate_bps` (default 500 = 5%), `bill_number_prefix`, `receipt_footer_text`, `max_discount_bps`, `kot_warning_minutes` (default 5), `kot_urgent_minutes` (default 10), `auto_restock` (default false), `auto_restock_time` (default '06:00').

### Server (new module: `server/src/modules/settings/`)
- `settings.schemas.ts` — Zod schemas for 4 PATCH sections: business, tax, billing, operations. Includes Indian GSTIN regex, FSSAI 14-digit validation, PIN code validation, Indian states list.
- `settings.repository.ts` — `getSettings()` reads all outlet columns. `updateOutlet()` generic partial-update helper with camelCase→snake_case conversion.
- `settings.service.ts` — `getSettings`, `updateBusiness`, `updateTax`, `updateBilling`, `updateOperations`.
- `settings.controller.ts` — Express handlers for GET and 4 PATCH endpoints.
- `settings.routes.ts` — Mounted at `/api/v1/settings`. GET open to admin/manager. PATCH restricted to admin.
- `server/src/app.ts` — Mounted `settingsRouter`.

### Frontend
- `web/src/lib/settings.ts` — **New file**. `useSettings()` query hook. `useUpdateBusiness/Tax/Billing/Operations` mutation hooks. `INDIAN_STATES` array. `OutletSettings` type.
- `web/src/pages/admin/settings.tsx` — **New file**. Full settings page with 4 independent sections, each with its own save button: Business Details (name, address, phone, email), Tax & Compliance (GSTIN, FSSAI, default tax rate), Billing & Receipts (prefix, footer, max discount), Operations (KOT timing, auto-restock).
- `web/src/pages/admin/index.tsx` — Added `/admin/settings` route. Added "Settings" link to sidebar (admin only).

---

## Blocker 6: Receipt Missing Legally Required Fields (India)

**Status**: Done

**Problem**: Tax invoices were missing GSTIN, restaurant address, FSSAI license, and phone — all legally required in India.

**What changed**:

- `web/src/pages/pos/receipt.tsx` — Fetches outlet settings via `useSettings()`. Added business header above "Tax Invoice" title showing: restaurant name (bold, centered), structured address, phone, GSTIN, FSSAI. All fields are conditional — if not configured, the line is omitted. Added customer name/phone display for takeaway orders. Added Original/Duplicate support via `?copy=original|duplicate` query param. Footer now uses `receiptFooterText` from settings instead of hardcoded string.

---

## Blocker 2: Token Expiry & Session Lifecycle

**Status**: Done

**Problem**: No documented JWT TTL, no refresh token, WebSocket dies on token expiry. Staff had to re-login mid-shift.

**What changed**:

### Schema
- `server/src/db/schema.sql` — New `refresh_tokens` table with: `token_hash` (sha256), `user_id`, `tenant_id`, `expires_at`, `is_revoked`, `revoked_at`, `revoked_reason`. Indexes on hash (partial: not revoked), user, and tenant. RLS policy for tenant isolation.

### Server
- `server/src/modules/auth/auth.service.ts` — Role-based access token TTLs: 12h for `staff`/`kitchen`, 2h for `admin`/`manager`. Refresh token TTL: 7 days. New functions: `createRefreshToken()` (generates 32-byte token, stores sha256 hash), `refreshSession()` (validates token, revokes old, issues new pair with rotation, checks user active status), `revokeAllRefreshTokens()` (per user), `revokeAllTenantRefreshTokens()` (per tenant). Login, signup, and accept-invite all return `refreshToken` alongside the access token.
- `server/src/modules/auth/auth.types.ts` — `LoginResult` now includes `refreshToken`.
- `server/src/modules/auth/auth.controller.ts` — New `refresh()` handler (POST `/auth/refresh`). New `logout()` handler (POST `/auth/logout`, revokes refresh tokens). `changePassword()` now revokes all refresh tokens.
- `server/src/modules/auth/auth.routes.ts` — Added `/auth/refresh` (rate-limited: 30/15min) and `/auth/logout` endpoints.
- `server/src/modules/devices/devices.service.ts` — Device login now also returns a refresh token.

### Frontend
- `web/src/lib/api.ts` — Auto-refresh interceptor: on `TOKEN_EXPIRED` (401), calls `/auth/refresh` with stored refresh token, retries original request. Deduplicates concurrent refresh attempts.
- `web/src/lib/auth.tsx` — Stores both `food.token` and `food.refreshToken` in localStorage. Login stores both. Logout clears both + calls server-side `/auth/logout`. New `readRefreshToken()`, `writeTokens()` helpers.
- `web/src/pages/signup.tsx` — Stores refresh token on signup.
- `web/src/pages/accept-invite.tsx` — Stores refresh token on invite acceptance.
- `web/src/lib/kds.ts` — WebSocket reconnect now reads fresh token from localStorage (may have been refreshed by the API interceptor). Auth-failure close codes (4001/1008) trigger faster reconnect.

---

## Blocker 8: Tenant Suspension Doesn't Invalidate Tokens

**Status**: Done

**Problem**: Suspended tenants could keep operating with existing JWTs until expiry.

**What changed**:

- `server/src/db/schema.sql` — Added `suspended_at TIMESTAMPTZ` column on `tenants`.
- `server/src/modules/platform/platform.repository.ts` — `updateTenantStatus()` sets `suspended_at = NOW()` on suspension/cancellation, clears to `NULL` on reactivation.
- `server/src/modules/platform/platform.service.ts` — On suspension, calls `revokeAllTenantRefreshTokens()` to immediately invalidate all refresh tokens for the tenant.
- Auth middleware (from Blocker 10) already returns `TENANT_SUSPENDED` (403) via the in-memory tenant gate — existing access tokens are rejected immediately.
- WebSocket connections are kicked via `kickTenant()` (already existed).

**Net effect**: Suspended tenant's existing access tokens are rejected by the in-memory gate (immediate). Refresh tokens are revoked in DB (no new access tokens can be issued). WebSocket connections are forcibly closed.

---

## Blocker 3: Staff Deactivation Flow

**Status**: Done

**Problem**: No way to disable a staff member's access. No deactivation UI, no device revocation.

**What changed**:

### Server
- `server/src/modules/users/users.service.ts` — `updateUser()` now revokes all refresh tokens (`revokeAllRefreshTokens`) and all paired devices (`UPDATE user_devices SET revoked_at`) when deactivating a user. Self-deactivation and last-admin guards already existed.
- `refreshSession()` (from Blocker 2) checks `is_active` on every refresh attempt — a deactivated user's refresh tokens are revoked, and even if somehow a token survives, the refresh will be rejected.

### Frontend
- `web/src/lib/staff.ts` — New `useToggleUserActive()` mutation hook (PATCH `/users/:id` with `{ isActive }`).
- `web/src/pages/admin/staff.tsx` — Added "Deactivate" button (red text) on active staff rows and "Reactivate" button (green text) on inactive rows. Deactivation shows a confirmation dialog: "They will be immediately signed out and all their devices will be unpaired." Cannot deactivate yourself or the tenant owner. Added "Actions" column to staff table (admin only).

---

## Blocker 4: Cancelled Order Doesn't Free Table

**Status**: Done

**Problem**: When an order was cancelled, the table remained "Occupied".

**What changed**:

- **No server-side fix needed** — table occupancy is derived, not stored. The `dining_tables` table has no status column. The POS grid derives occupancy by checking if any open order references the table (`useOpenOrders()` → `openByTable` map). When an order is cancelled (status changes from `open` to `cancelled`), it no longer appears in the open orders list, so the table automatically shows as free.
- `web/src/lib/orders.ts` — Added `useCancelOrder()` mutation hook that invalidates both `orderKeys.detail` and `orderKeys.open` queries on success, ensuring the POS table grid updates immediately after cancellation (not waiting for the 5-second stale poll).

---

## Blocker 5: Bill With Partial Payment Can't Be Voided

**Status**: Done

**Problem**: Bills with partial payments couldn't be voided (void required no payments) or refunded (refund required status "paid"). Staff was stuck.

**What changed**:

### Server
- `server/src/modules/billing/billing.service.ts` — `voidBill()` no longer rejects bills with payments. When a bill has partial payments, it first calls `voidAllPaymentsForBill()` to void every active payment, then `decrementBillPaid()` to reset the paid amount, then voids the bill itself. All within a single transaction. Audit log includes `voidedPaymentCount` and `voidedPaymentTotalPaise`.

### Frontend
- `web/src/pages/pos/bill.tsx` — `VoidBillPrompt` now shows a warning when the bill has payments: "This bill has N payment(s) totaling X. Voiding will also reverse all payments." Confirm button text changes to "Void bill and reverse payments". Added `warning` prop to `PromptModal` component (renders as amber alert box).

---

## Blocker 9: No Table Management After Onboarding

**Status**: Done

**Problem**: Tables could only be created during onboarding wizard. No way to add, edit, rename, or deactivate tables after that.

**What changed**:

### Server
- **No server changes needed** — full CRUD already existed: `POST /tables` (create), `PATCH /tables/:id` (update), `DELETE /tables/:id` (deactivate). `GET /tables?includeInactive=true` already supported. Deactivation guard (can't deactivate table with open order) already existed.

### Frontend
- `web/src/lib/tables.ts` — `useTables()` now accepts `{ includeInactive?: boolean }` option. Added `useCreateTable()`, `useUpdateTable()`, `useDeactivateTable()` mutation hooks with proper cache invalidation.
- `web/src/pages/admin/tables.tsx` — **New file**. Full table management page with: sortable table listing (code, label, seats, active status, current order), "Show deactivated" toggle, "+ Add table" button with modal (code, seats, label), "Edit" button with modal (code, seats, label, display order, code-change warning), "Deactivate"/"Activate" toggle buttons.
- `web/src/pages/admin/index.tsx` — Added `/admin/tables` route and "Tables" sidebar link (between Categories and Staff).
- POS grid already only shows active tables (default `useTables()` call doesn't pass `includeInactive`).

---

## Files Created (8)

| File | Purpose |
|------|---------|
| `web/src/lib/password.ts` | Shared password validation |
| `server/src/modules/settings/settings.schemas.ts` | Settings Zod schemas |
| `server/src/modules/settings/settings.repository.ts` | Settings DB access |
| `server/src/modules/settings/settings.service.ts` | Settings business logic |
| `server/src/modules/settings/settings.controller.ts` | Settings Express handlers |
| `server/src/modules/settings/settings.routes.ts` | Settings route definitions |
| `web/src/lib/settings.ts` | Settings React Query hooks |
| `web/src/pages/admin/settings.tsx` | Settings admin page |
| `web/src/pages/admin/tables.tsx` | Table management admin page |

## Files Modified (~25)

### Server
- `src/utils/errors.ts`, `src/middleware/error.ts`, `src/middleware/validate.ts`, `src/middleware/auth.ts`
- `src/modules/auth/auth.service.ts`, `auth.controller.ts`, `auth.routes.ts`, `auth.types.ts`
- `src/modules/billing/billing.service.ts`
- `src/modules/orders/orders.service.ts`
- `src/modules/tables/tables.service.ts`
- `src/modules/users/users.service.ts`
- `src/modules/devices/devices.service.ts`
- `src/modules/platform/platform.service.ts`, `platform.repository.ts`
- `src/db/schema.sql`, `src/app.ts`

### Web
- `src/lib/api.ts`, `src/lib/auth.tsx`, `src/lib/kds.ts`, `src/lib/orders.ts`, `src/lib/staff.ts`, `src/lib/tables.ts`
- `src/pages/signup.tsx`, `src/pages/accept-invite.tsx`
- `src/pages/pos/receipt.tsx`, `src/pages/pos/bill.tsx`
- `src/pages/admin/index.tsx`, `src/pages/admin/staff.tsx`
