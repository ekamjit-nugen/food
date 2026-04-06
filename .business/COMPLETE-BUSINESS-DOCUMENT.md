# Food — Comprehensive Business & Technical Document

**Product:** Multi-Tenant Restaurant POS & Management Platform
**Date:** 2026-04-06
**Surfaces:** Web (React SPA) · Server (Express/PostgreSQL) · Mobile (Expo/React Native)

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Product Features](#2-product-features)
3. [API Endpoints](#3-api-endpoints)
4. [Workflows & Flows](#4-workflows--flows)
5. [Database Schema](#5-database-schema)
6. [Roles & Permissions](#6-roles--permissions)
7. [Security Architecture](#7-security-architecture)
8. [Mobile App](#8-mobile-app--food-staff)
9. [Integrations & External Systems](#9-integrations--external-systems)
10. [Architecture Overview](#10-architecture-overview)

---

# 1. Technology Stack

## Server

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | ES modules, TypeScript |
| Language | TypeScript | 5.5.4 | Strict mode, fully typed |
| Framework | Express.js | 4.19.2 | HTTP server |
| Database | PostgreSQL | 16 | Primary data store with RLS |
| Auth | JWT + bcrypt | 9.0.2 / 5.1.1 | Stateless auth, cost-12 hashing |
| Validation | Zod | 3.23.8 | Schema parsing & validation |
| Real-time | ws | 8.18.0 | WebSocket for KDS |
| Logging | Pino | 9.3.2 | Structured JSON logging with redaction |
| Security | Helmet | 7.1.0 | HTTP security headers |
| Rate Limiting | express-rate-limit | 7.4.0 | Per-IP throttling |
| PDF | pdfkit | — | Bill & KOT PDF generation |
| Testing | Vitest + Supertest | 2.0.4 / 7.0.0 | Unit + integration tests |
| Dev Tools | tsx + dotenv | 4.16.2 / 16.4.5 | TS execution, env config |

## Web (Frontend)

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | React | 18.3.1 | UI framework |
| Language | TypeScript | 5.5.4 | Strict mode |
| Build Tool | Vite | 5.4.6 | Dev server, bundling |
| Routing | React Router DOM | 6.26.2 | Client-side routing |
| Data Fetching | TanStack React Query | 5.56.2 | Server state management |
| Styling | Tailwind CSS | 3.4.12 | Utility-first CSS (no component library) |
| QR Codes | QRCode.react | 4.2.0 | Device pairing QR generation |
| State | React Context | — | Auth state only; React Query for everything else |

## Mobile

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Expo + React Native | ~51.0.28 / 0.74.5 | Cross-platform mobile |
| Language | TypeScript | ~5.3.3 | Type safety |
| Data Fetching | TanStack React Query | — | Server state management |
| Navigation | React Navigation | — | Native stack navigation |
| Camera | Expo Camera | — | QR code scanning for device pairing |
| Secure Storage | Expo Secure Store | — | Credential storage |
| Build | EAS (Expo Application Services) | — | iOS & Android builds |

## Infrastructure

| Component | Technology | Details |
|-----------|-----------|---------|
| Database | PostgreSQL 16 | Row Level Security, triggers, custom functions, GUCs |
| Containerization | Docker Compose | Local dev environment |
| Money Model | BIGINT paise | 1 INR = 100 paise, tax in basis points (bps) |
| Multi-tenancy | RLS + Session GUCs | `app.current_tenant_id` per request |
| Audit | Append-only audit_log | RLS-enforced immutability |

## Architecture Pattern

```
Server: Layered Architecture
  Controllers → Services → Repositories → PostgreSQL (RLS)
  Middleware: auth, tenantDb, validate, audit, error, requestContext

Web: Single Page Application (SPA)
  React + React Query (no Redux/Zustand)
  Role-based route guards → Feature pages → API hooks → REST/WS backend

Mobile: Expo React Native
  Native stack navigation → Screens → API hooks → REST backend
```

---

# 2. Product Features

## 2.1 Multi-Tenant SaaS Platform

- **Three-level hierarchy:** Platform → Tenant (restaurant brand) → Outlet (physical location)
- **Self-serve signup:** Restaurant owners create workspace with unique slug
- **Tenant isolation:** PostgreSQL Row Level Security enforces strict data separation
- **Tenant statuses:** trial → active → suspended → cancelled
- **Platform admin dashboard:** Super-admin can manage all tenants, view stats, suspend/reactivate

## 2.2 Authentication & Authorization

- **Tenant user auth:** Email + password login scoped to workspace slug
- **JWT-based:** Stateless tokens (configurable expiry, default 12h)
- **Role-based access control:** admin, manager, staff, kitchen
- **Staff invitation system:** Owner/manager invites staff via token-based flow
- **Device pairing:** QR code + 8-char token for mobile app pairing (bcrypt-hashed)
- **Password management:** Change password, admin reset for staff
- **Platform admin auth:** Completely separate auth pool from tenant users
- **Rate limiting:** Per-endpoint throttling (signup: 5/hr, login: 10/15min)

## 2.3 Menu Management

- **Categories:** CRUD with activation/deactivation (soft delete)
- **Menu items:** Name, price (paise), tax rate (bps), description, category assignment
- **Variations:** Size/option variants with price deltas (Small -50, Large +100)
- **Addons:** Reusable toppings/extras (many-to-many with items)
- **In-stock toggle:** Runtime availability control (separate from deactivation)
- **Service menu:** Single API call returns complete active menu for POS display

## 2.4 Table Management

- **Dining tables:** Code, label, section, seats, display order
- **Bulk creation:** Create multiple tables at once (used in onboarding)
- **Active/inactive:** Soft delete for tables no longer in use
- **Table grid:** POS home shows all tables with order status indicators

## 2.5 Order Management

- **Order types:** Dine-in (linked to table) and takeaway
- **Order lifecycle:** open → closed → cancelled
- **Draft items:** Items added to order but not yet sent to kitchen
- **Menu snapshots:** Price, tax, variation, addons frozen at order time (immutable history)
- **Send to kitchen:** Batches draft items into a Kitchen Order Ticket (KOT)
- **Item voiding:** Remove individual items from order
- **Order cancellation:** Cancel entire order with all items

## 2.6 Kitchen Display System (KDS)

- **Real-time WebSocket feed:** `kot.created`, `kot.updated`, `alert.created`, `alert.acked`
- **3-column Kanban board:** New → In Progress → Ready
- **KOT state machine:** new → in_progress → ready → served (or void at any point)
- **No backward transitions:** Cannot go from ready back to in_progress
- **Auto-reconnect:** WebSocket reconnects with 3s backoff, REST refetch on reconnect
- **Per-outlet rooms:** Each outlet has isolated WebSocket channel

## 2.7 Billing & Payments

- **Bill generation:** Creates bill from order items with full tax breakdown
- **Split bills:** Multiple bills per order for group dining
- **Two-stage discount stacking:**
  - Stage 1: Per-line discounts (flat or percentage)
  - Stage 2: Bill-level discount pro-rated across lines
- **Tax calculation:** CGST/SGST split 50/50, computed at line level
- **Rounding:** Nearest rupee with `round_off_paise` tracking
- **Payment methods:** Cash, UPI, Card, Other
- **Idempotent payments:** `idempotency_key` prevents duplicate charges
- **Payment void:** Soft-delete individual payments, bill reverts to open
- **Bill void:** Cancel unpaid bill with reason
- **Bill refund:** Refund paid bill (full amount)
- **PDF generation:** Bill and KOT PDFs for printing/reprinting

## 2.8 Service Alerts

- **Alert types:** Call Waiter, Call Kitchen, Call Manager
- **Real-time broadcast:** Alerts pushed via WebSocket to all connected clients
- **Acknowledgement flow:** Any staff can acknowledge an alert
- **No role gate:** Open to all staff for maximum flexibility
- **Audit trail:** Created by, acknowledged by, timestamps tracked

## 2.9 Reports & Analytics

| Report | Description | Export |
|--------|------------|--------|
| Daily Sales | Revenue breakdown by date | — |
| Item-wise Sales | Revenue by menu item | — |
| Category-wise Sales | Revenue by category | — |
| Tax Summary | CGST/SGST breakdown | — |
| Order Master | Detailed order log | CSV |

- **Scope:** Single outlet or entire tenant (all outlets)
- **Date range:** Configurable from/to dates
- **Admin/manager only:** Reports restricted to management roles

## 2.10 Staff Management

- **Staff roster:** List all team members (active + inactive)
- **Create staff:** Admin creates user with role and outlet access
- **Edit staff:** Update name, role, active status
- **Password reset:** Admin can reset staff passwords
- **Multi-outlet access:** Staff can be granted access to specific outlets
- **Device management:** View paired devices, revoke access

## 2.11 Onboarding Wizard

- **3-step guided setup** for new restaurant owners:
  1. Create first category
  2. Create first menu item
  3. Create dining tables
- **Gate:** Main admin UI unlocks after all 3 steps complete

## 2.12 Mobile App (Staff-Facing)

- **App name:** "Food Staff"
- **QR code pairing:** Scan code from admin panel to authenticate
- **Screens:** Tables, Orders, Billing, Stock management
- **Secure storage:** Credentials stored via Expo Secure Store
- **Platforms:** iOS (com.food.staff) and Android (com.food.staff)

## 2.13 Platform Administration

- **Tenant directory:** List, search, filter all tenants
- **Tenant details:** Outlets, recent users, payment history
- **Status management:** Activate, suspend, cancel tenants
- **Platform stats:** Aggregate statistics across all tenants
- **Suspension enforcement:** Blocked logins, WebSocket kicks, RLS gate

---

# 3. API Endpoints

Base URL: `/api/v1`

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | None | Liveness probe |
| GET | `/readyz` | None | Readiness probe (includes DB check) |

## Auth (Tenant Users)

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| POST | `/auth/signup` | None | 5/hr | Self-serve tenant creation |
| POST | `/auth/login` | None | 10/15min | Tenant user login |
| GET | `/auth/me` | JWT | — | Current user profile |
| POST | `/auth/change-password` | JWT | 5/15min | Change own password |
| POST | `/auth/invite` | JWT (admin/manager) | — | Invite staff member |
| POST | `/auth/accept-invite` | None | 20/15min | Accept invite & set password |

## Device Pairing

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| POST | `/auth/pair` | None | 20/15min | Consume pairing code → device token |
| POST | `/auth/device-login` | None | 60/15min | Device token login |
| POST | `/users/:id/pairing-codes` | JWT (admin) | — | Create pairing code for user |
| GET | `/users/:id/devices` | JWT (admin) | — | List user's paired devices |
| DELETE | `/users/:id/devices/:deviceId` | JWT (admin) | — | Revoke device |

## Users (Staff Management)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | JWT (admin/manager) | List all staff |
| GET | `/users/:id` | JWT (admin/manager) | Get staff details |
| POST | `/users` | JWT (admin) | Create staff member |
| PATCH | `/users/:id` | JWT (admin) | Update staff |
| POST | `/users/:id/reset-password` | JWT (admin) | Reset staff password |

## Menu — Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/menu` | JWT | Service menu (full active menu for POS) |
| GET | `/menu/categories` | JWT | List categories |
| GET | `/menu/categories/:id` | JWT | Get category |
| POST | `/menu/categories` | JWT (admin/manager) | Create category |
| PATCH | `/menu/categories/:id` | JWT (admin/manager) | Update category |
| DELETE | `/menu/categories/:id` | JWT (admin/manager) | Deactivate category |

## Menu — Items

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/menu/items` | JWT | List items |
| GET | `/menu/items/:id` | JWT | Get item |
| POST | `/menu/items` | JWT (admin/manager) | Create item |
| PATCH | `/menu/items/:id` | JWT (admin/manager) | Update item |
| DELETE | `/menu/items/:id` | JWT (admin/manager) | Deactivate item |
| POST | `/menu/items/:id/in-stock` | JWT (admin/manager) | Toggle stock status |

## Menu — Addons

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/menu/addons` | JWT | List addons |
| GET | `/menu/addons/:id` | JWT | Get addon |
| POST | `/menu/addons` | JWT (admin/manager) | Create addon |
| PATCH | `/menu/addons/:id` | JWT (admin/manager) | Update addon |
| DELETE | `/menu/addons/:id` | JWT (admin/manager) | Deactivate addon |

## Tables

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tables` | JWT | List tables |
| GET | `/tables/:id` | JWT | Get table |
| POST | `/tables` | JWT (admin/manager) | Create table |
| POST | `/tables/bulk` | JWT (admin/manager) | Bulk create tables |
| PATCH | `/tables/:id` | JWT (admin/manager) | Update table |
| DELETE | `/tables/:id` | JWT (admin/manager) | Deactivate table |

## Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/orders` | JWT | List orders (filterable by status) |
| GET | `/orders/:id` | JWT | Get order with items & KOTs |
| POST | `/orders` | JWT (admin/manager/staff) | Create order (dine-in or takeaway) |
| POST | `/orders/:id/items` | JWT (admin/manager/staff) | Add draft items to order |
| POST | `/orders/:id/items/send` | JWT (admin/manager/staff) | Send draft items to kitchen (creates KOT) |
| DELETE | `/orders/:id/items/:itemId` | JWT (admin/manager/staff) | Void order item |
| POST | `/orders/:id/cancel` | JWT (admin/manager/staff) | Cancel entire order |

## KOTs (Kitchen Order Tickets)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/kots` | JWT | List KOTs (filterable by status) |
| PATCH | `/kots/:id/status` | JWT (all roles) | Update KOT status |

## Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/orders/:id/bill` | JWT (admin/manager/staff) | Generate single bill |
| POST | `/orders/:id/bills/split` | JWT (admin/manager/staff) | Generate split bills |
| GET | `/orders/:id/bill` | JWT | Get singular bill for order |
| GET | `/orders/:id/bills` | JWT | Get all bills for order |
| GET | `/bills` | JWT | List bills (dashboard) |
| GET | `/bills/:id` | JWT | Get bill with items & payments |
| PATCH | `/bills/:id/discount` | JWT (admin/manager) | Apply bill-level discount |
| POST | `/bills/:id/payments` | JWT (admin/manager/staff) | Record payment |
| POST | `/bills/:id/void` | JWT (admin/manager) | Void unpaid bill |
| POST | `/bills/:id/refund` | JWT (admin/manager) | Refund paid bill |
| POST | `/bills/:id/payments/:paymentId/void` | JWT (admin/manager) | Void single payment |

## PDF

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/bills/:id/pdf` | JWT | Download bill PDF |
| GET | `/kots/:id/pdf` | JWT | Download KOT PDF |

## Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reports/daily-sales` | JWT (admin/manager) | Daily revenue breakdown |
| GET | `/reports/item-wise` | JWT (admin/manager) | Sales by item |
| GET | `/reports/category-wise` | JWT (admin/manager) | Sales by category |
| GET | `/reports/tax-summary` | JWT (admin/manager) | CGST/SGST breakdown |
| GET | `/reports/order-master` | JWT (admin/manager) | Detailed order log (CSV export) |

## Service Alerts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/alerts` | JWT | List active alerts |
| POST | `/alerts` | JWT (any role) | Raise alert |
| POST | `/alerts/:id/ack` | JWT (any role) | Acknowledge alert |

## Platform Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/platform/auth/login` | None (10/15min) | Platform admin login |
| GET | `/platform/auth/me` | Platform JWT | Platform user profile |
| GET | `/platform/stats` | Platform JWT | Platform-wide statistics |
| GET | `/platform/tenants` | Platform JWT | List all tenants |
| GET | `/platform/tenants/:id` | Platform JWT | Get tenant details |
| PATCH | `/platform/tenants/:id/status` | Platform JWT | Update tenant status |

## WebSocket

| Protocol | Path | Auth | Description |
|----------|------|------|-------------|
| WS | `/ws/kds?token=...` | JWT (query param) | Kitchen Display System real-time feed |

**Events:** `kot.created`, `kot.updated`, `alert.created`, `alert.acked`
**Delivery:** Best-effort (REST is source of truth)
**Heartbeat:** 30s ping/pong
**Rooms:** Per-outlet isolation

---

# 4. Workflows & Flows (Complete)

Every flow documents: exact fields, buttons, modals, validations, API payloads, server logic, error states, and navigation across Web, Mobile, and Server.

---

## 4.1 Tenant Signup Flow

**Surface:** Web (`/signup`)
**Auth:** None required

### Page: Signup Form

**Fields:**

| # | Field | Type | Required | Placeholder | Validation | Notes |
|---|-------|------|----------|-------------|------------|-------|
| 1 | Restaurant name | text | Yes | "Dosa Point" | 2-120 chars | Auto-fills "First outlet" and "Workspace URL" until user edits them |
| 2 | Workspace URL | text (prefix "/t/") | Yes | "dosa-point" | 2-40 chars, lowercase kebab-case (`/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`) | Auto-slugified from restaurant name until user touches field |
| 3 | First outlet | text | Yes | {restaurantName} or "Main branch" | 1-120 chars | Helper: "You can add more outlets later." |
| 4 | Your name | text | Yes | — | 1-120 chars | autocomplete="name" |
| 5 | Email | email | Yes | — | Valid email, max 254 chars | autocomplete="email" |
| 6 | Password | password | Yes | — | Min 8 chars (client), min 10 + letter + digit (server) | Helper: "At least 8 characters." autocomplete="new-password" |

**Buttons:**

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Create workspace" | `busy` is true | "Creating workspace…" |

**Link:** "Already have an account? Sign in" → `/login`

**Client Validation Errors:**
- "workspace URL must be at least 2 characters"
- "password must be at least 8 characters"

### API Call

```
POST /api/v1/auth/signup
{
  restaurantName: string,
  slug: string,
  firstOutletName: string,
  ownerFullName: string,
  email: string,
  password: string
}
```

### Server Logic (Atomic Transaction)

1. Pre-check slug uniqueness (re-checked inside tx for TOCTOU safety)
2. Create tenant (status: `active`, email verification deferred in v1)
3. Create first outlet (name from `firstOutletName`)
4. Create owner user (role: `admin`, `is_tenant_owner: true`, bcrypt cost 12)
5. Sign JWT with claims: `{ tenantId, outletId, isTenantOwner, email, role }`
6. Return `{ token, expiresIn, user }`

**Server Errors:**
- 409 Conflict: slug already taken

### Post-Success

1. Token stored in `localStorage['food.token']`
2. Hard reload to `/admin` → OnboardingGate redirects to `/admin/welcome`

---

## 4.2 Onboarding Wizard

**Surface:** Web (`/admin/welcome`)
**Auth:** Required (admin)
**Gate:** Redirects here if categories AND items AND tables are all empty. Auto-redirects to `/admin` once all 3 populated.

### Page Header

- Title: "Welcome, {user.fullName}"
- Subtitle: "Three quick steps and you can take your first order. You can edit everything later from the admin pages."

### Step 1: Add a Category

**Card:** Index "1", title "Add a category", hint "Group items together (e.g. Starters, Mains, Drinks)."
**Badge:** Green checkmark when done, dark circle with "1" when pending.

| Field | Type | Required | Placeholder |
|-------|------|----------|-------------|
| Category name | text | Yes | "e.g. Mains" |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Add" | mutation pending | "Adding…" |

```
POST /api/v1/menu/categories
{ name: string }
```

### Step 2: Add Your First Item

**Card:** Index "2", title "Add your first item", hint "One menu item is enough — add the rest later."
**Locked:** Grayed out (opacity-60) until Step 1 complete.

| Field | Type | Required | Placeholder |
|-------|------|----------|-------------|
| Item name | text | Yes | "e.g. Paneer Tikka" |
| Price | text (inputMode: decimal, ₹ prefix) | Yes | "120" |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Add" | mutation pending | "Adding…" |

**Validation:** "name required", "enter a price in rupees (e.g. 120 or 99.50)"

```
POST /api/v1/menu/items
{ categoryId: string, name: string, pricePaise: number }
```
(No description, variations, addons, or tax rate in onboarding — defaults to 5% tax)

### Step 3: Set Up Tables

**Card:** Index "3", title "Set up tables", hint "We'll create them as T1, T2, … — you can rename them later."

| Field | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| How many tables? | number | Yes | 8 | Integer 1-200 |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Create" | mutation pending | "Creating…" |

**Auto-generates:** T1, T2, … TN with 2 seats each, displayOrder 0-indexed.

```
POST /api/v1/tables/bulk
{ tables: [{ code: "T1", seats: 2, displayOrder: 0 }, ...] }
```

### Completion

| Button | Label | Action | Shows When |
|--------|-------|--------|-----------|
| Final | "Start using the POS" | Navigate to `/admin` (replace) | All 3 steps complete |

---

## 4.3 Tenant Login Flow

**Surface:** Web (`/login` or `/t/:slug/login`)
**Auth:** None required. If already logged in, redirects to `/`.

### Page: Login Form

**Header:** "Restaurant POS" (with "· {slug}" if slug in URL)

| # | Field | Type | Required | Shown When | Autocomplete |
|---|-------|------|----------|-----------|--------------|
| 1 | Workspace | text | Yes | No slug in URL (bare `/login`) | organization |
| 2 | Email | email | Yes | Always | username |
| 3 | Password | password | Yes | Always | current-password |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Sign in" | `busy` is true | "Signing in…" |

**Link:** "New here? Create a workspace" → `/signup`

### API Call

```
POST /api/v1/auth/login
{ tenantSlug: string, email: string, password: string }
```

### Server Logic

1. Find tenant by slug (NotFound if missing)
2. Find user by (tenantId, email)
3. **Timing-safe:** Always runs bcrypt even for missing users (DUMMY_HASH prevents enumeration)
4. Validate: tenant.status === 'active', user exists, password correct, user.isActive
5. Update `last_login_at`
6. Return `{ token, expiresIn, user }`

**Server Errors:**
- 401 Unauthorized: Generic message for wrong slug/email/password/disabled account (prevents enumeration)

### Post-Success

1. Token stored in `localStorage['food.token']`
2. AuthProvider calls `GET /auth/me` to validate
3. Redirect based on role:
   - `kitchen` → `/kds`
   - `staff` → `/pos`
   - `admin` or `manager` → `/admin`

---

## 4.4 Staff Invitation Flow

**Surface:** Web (`/admin/staff`)
**Auth:** Required (admin only can see "Invite teammate" button)

### Step A: Admin Creates Invite

**Trigger:** Click **"Invite teammate"** button (top-right, only visible to admin role)

**InviteModal opens:**

| # | Field | Type | Required | Placeholder/Options | Notes |
|---|-------|------|----------|---------------------|-------|
| 1 | Email | email | Yes | — | autofocus, trimmed + lowercased |
| 2 | Full name (optional) | text | No | "They can set this themselves" | — |
| 3 | Role | select | Yes | "Staff (POS, order taking)" / "Kitchen (KDS only)" / "Manager (staff + reports, no role edits)" | Default: "staff". Helper: "Only owners can promote another user to admin; use the database CLI." |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Cancel | "Cancel" | Never | — |
| Submit | "Create invite" | mutation pending | "Creating invite…" |

```
POST /api/v1/auth/invite
{
  email: string,
  role: "staff" | "kitchen" | "manager",
  outletIds: [string],           // current outlet auto-populated
  fullName?: string
}
```

**Server Logic:**
1. Validate: actor is `isTenantOwner` OR `role === 'manager'`
2. Validate: outletIds belong to actor's tenant
3. Reject if email already exists as user
4. Generate 32-byte base64url token (7-day TTL)
5. Insert `staff_invites` row
6. Queue email in `email_outbox`
7. Return `{ token, expiresAt }` (token only in dev mode)

**Server Errors:** 403 Forbidden (not manager/owner), 400 BadRequest (invalid outlet), 409 Conflict (email exists)

### Post-Invite: InviteSuccessCard

- **Background:** Emerald theme
- **Title:** "Invite created for {email}"
- **Expiry:** "Expires {expiresOn}. Single use."
- **Link display (dev mode):** Read-only input with URL + **Copy** button
  - Format: `{origin}/accept-invite?token={encodeURIComponent(token)}`
  - Helper: "Share this link with them (WhatsApp, in person). They'll set a password and join your team."
- **No link (prod):** "An invitation email will be sent to {email}."
- **Button:** **"Dismiss"** (closes card)

### Step B: Invitee Accepts

**Surface:** Web (`/accept-invite?token=X`)
**Auth:** None required

**Missing token error:** "Invalid invite link" + "This link is missing the invite token. Ask the admin who invited you to resend the full link."

| # | Field | Type | Required | Autocomplete | Validation |
|---|-------|------|----------|-------------|------------|
| 1 | Full name | text | Yes | name | autofocus |
| 2 | Password | password | Yes | new-password | Min 8 (client), min 10 + letter + digit (server) |

**Helper:** "Set your name and a password to finish joining the team."

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Submit | "Join team" | `busy` is true | "Joining…" |

```
POST /api/v1/auth/accept-invite
{ token: string, fullName: string, password: string }
```

**Server Logic (Atomic Transaction):**
1. Validate token exists, not consumed, not expired
2. Race condition check: user not already created
3. Create user with role from invite
4. Create `user_outlet_access` rows for all invited outlets
5. Mark invite consumed
6. Sign JWT
7. Return `{ token, expiresIn, user }`

**Server Errors:** 404 NotFound (token), 400 BadRequest (expired/used), 409 Conflict (user exists)

**Post-Success:** Token stored → hard reload to role landing:
- `kitchen` → `/kds`
- `staff` → `/pos`
- `admin`/`manager` → `/admin`

---

## 4.5 Device Pairing Flow (Mobile App)

### Step A: Admin Creates Pairing Code (Web)

**Surface:** Web (`/admin/staff`) → click **"Manage"** button on staff row → DevicesModal

**DevicesModal title:** "Devices for {user.fullName}"

**Trigger:** Click **"Pair a new device"** button (dark style)

```
POST /api/v1/users/:id/pairing-codes
{} // empty body, server generates code
```

**Server:** Generates 8-char alphanumeric code (SHA256 hashed), 10-min TTL, returns `{ qrPayload, code, expiresAt }`

**PairingCodeCard appears:**
- Title: "Pairing code ready — have them scan within 10 minutes"
- Expiry: "Expires {expiresAt}. Single use. This is the only time this code is shown."
- QR Code: SVG (168px, level M) encoding `{ v:1, kind:'food.pair', code:'ABC12345' }`
- Manual code: Large monospace text, tracking-widest, selectable
- Button: **"Done"** (closes card)

**Active Devices Section:**
- Header: "ACTIVE ({count})"
- Each row: device label, platform, last seen date
- **"Revoke"** button per device → confirmation: "Revoke this device? The app on that phone will be signed out immediately." → `DELETE /api/v1/users/:id/devices/:deviceId`

**Revoked Devices Section:**
- Header: "REVOKED ({count})"
- Grayed out styling, revoke button disabled

### Step B: Staff Scans Code (Mobile)

**Surface:** Mobile (`PairScreen`)

**Two pairing paths:**

**Path 1: QR Code Scan (preferred)**
- Expo Camera opens on mount (requests permission if needed)
- Scans QR, validates payload: `{ v:1, kind:'food.pair', code: 8-char alphanumeric }`
- `scannedOnce` flag prevents duplicate scans

**Path 2: Manual Entry (fallback — camera blocked or admin reads code aloud)**

| Field | Type | Required | Max | Validation |
|-------|------|----------|-----|------------|
| Device label | text | No | — | Placeholder: "e.g. Counter iPad", defaults to "Staff device" |
| Code | text (uppercase) | Yes | 8 chars | Regex: `/^[A-Z0-9]{8}$/` |

| Button | Label | Enabled When |
|--------|-------|-------------|
| Pair | "Pair" | Valid 8-char code + not busy |

**Busy overlay:** Activity indicator during API call

```
POST /api/v1/auth/pair
{ code: string, label: string, platform: "ios" | "android" | undefined }
```

**Server Logic:**
1. Find pairing by code hash (SHA256)
2. Validate: not consumed, not expired
3. Create `user_devices` row (token = `<device_id>.<secret>`, secret bcrypt-hashed)
4. Mark pairing consumed
5. Return `{ deviceToken: string, device: PairedDevice }`

**Mobile then:**
1. Stores deviceToken in Expo SecureStore (encrypted)
2. Calls `POST /api/v1/auth/device-login { deviceToken }` → gets JWT
3. Auth state → `authenticated`, navigates to TablesScreen

### Subsequent Cold Starts

```
App boots → AuthProvider retrieves deviceToken from SecureStore
  → POST /api/v1/auth/device-login { deviceToken }
  → Server: lookup by device_id prefix → bcrypt.compare secret → sign JWT
  → If 401: Token cleared, drop to PairScreen (device was revoked)
  → If success: Navigate to TablesScreen
  → Token auto-expires after 1 year
```

---

## 4.6 POS Order Flow — Dine-In (Web)

**Surface:** Web

### 6a. Table Selection (`/pos`)

**Page title:** "Tables"

**Layout:** Grid of table cards (2→3→4→5 columns responsive)

**Each table card shows:**
- Table code (large, bold): e.g. "T1"
- Seats (small, muted): "4 seats"
- Label (if set): e.g. "Window"
- Status:
  - Free: Green badge "Free" → Click navigates to `/pos/order/new?tableId={id}`
  - Occupied: Amber badge "Order #{N}" → Click navigates to `/pos/order/{orderId}`

**Top button:** **"+ New takeaway"** (dark, bg-slate-900) → navigates to `/pos/order/new?type=takeaway`

**Open Takeaway Section** (shows only if open takeaways exist):
- Header: "Open takeaway orders"
- Grid of cards with order number, customer name, "TAKEAWAY" badge (violet)
- Click → `/pos/order/{orderId}`

### 6b. New Order — Create & Add Items (`/pos/order/new?tableId=...`)

**Page title:** "New order" (or "New takeaway order")

**Takeaway-only fields** (top of page, only when `type=takeaway`):

| Field | Type | Required | Placeholder | Max |
|-------|------|----------|-------------|-----|
| Customer name | text | No | "e.g. Raj" | 120 |
| Phone | tel | No | "e.g. 9876543210" | 32 |

**Navigation:** **"← Back to tables"** link → `/pos`

**Menu Picker (two-column layout):**

**Left: Category buttons** (12rem width, vertical stack)
- All categories from service menu
- Selected: dark bg (bg-slate-900, white text)
- Unselected: white bg, slate border
- Click: switches active category

**Right: Item grid** (2-column)
- Each card: item name (bold), price (₹ formatted, muted)
- "Options" badge (if item has variations or addons)
- Disabled: opacity-50, cursor-not-allowed if `!inStock`
- **Click (simple item, no options):** Directly adds to cart via `upsertLine()` (merges quantity if same signature)
- **Click (item with options):** Opens **LineEditor modal**

### 6c. LineEditor Modal

**Trigger:** Clicking item card with variations or addons

**Modal content:**

| Section | Field | Type | Details |
|---------|-------|------|---------|
| Header | Item name | display | h2 bold + base price "{formatPaise} base" |
| VARIATION | Variation picker | button grid (2-col) | Shows name + price delta (+/-). Selected: dark bg. Click: `setVariationId()` |
| ADD-ONS | Addon checkboxes | checkbox list | Each: checkbox + name + "+{price}". Toggle: `toggleAddon()` |
| NOTES (OPTIONAL) | Notes | textarea | 2 rows, max 500 chars, placeholder "e.g. no onions" |
| QUANTITY | Quantity spinner | −/+/display | Min 1, max 999. Buttons: "−" and "+" (w-8 h-8) |
| Line total | Computed | display | "Line total: {formatPaise(unitPrice × qty)}" (lg, bold) |

| Button | Label | Action |
|--------|-------|--------|
| Cancel | "Cancel" | Close modal |
| Submit | "Add to cart" | Create CartLine, call `onConfirm(line)`, close modal |

**CartLine signature** (for deduplication):
```
[menuItemId, variationId || '', sortedAddonIds.join(','), notes || ''].join('|')
```
Same signature → merge quantities. Different → separate cart lines.

### 6d. Cart Panel (right sidebar, sticky)

**Sections (in order):**

1. **ALREADY SENT** (existing order only): List of items with kotId
2. **PENDING DRAFTS** (existing order, if unsent server drafts exist):
   - Amber background, header "PENDING DRAFTS" + "not yet sent"
   - Button: **"Send pending drafts to kitchen"** (amber-600) → `sendDrafts.mutateAsync(orderId)`
3. **NEW ITEMS**: Local cart lines
   - Empty: "Tap menu items to add."
   - Each line: name, variation, addons ("+cheese, sauce"), notes (italic amber), price × qty
   - Per-line: **"−"** and **"+"** buttons (w-7 h-7) to adjust quantity (removes at 0)
4. **Subtotal row**: "New items subtotal: {formatPaise}" (bold)
5. **Button:** **"Send to kitchen"** (full-width, bg-slate-900, white text)
   - Disabled: `busy || !canSend` (no cart items)
   - Loading: "Sending…"

### 6e. Send to Kitchen — API Flow

**New order mode:**
```
Step 1: POST /api/v1/orders
{
  orderType: "dine_in",
  tableId: string,
  items: [{ menuItemId, quantity, variationId?, addonIds?, notes? }, ...]
}
→ Returns OrderDetail (items have kotId = null)

Step 2: POST /api/v1/orders/:id/items/send
→ Server (transaction):
   1. FOR UPDATE locks draft items (prevents ghost-KOT race)
   2. Creates KOT row (status: 'new')
   3. Sets kotId on all draft items
   4. Broadcasts "kot.created" via WebSocket
→ Returns Kot

Step 3: Clear cart, navigate to /pos/order/:id (replace)
```

**Existing order mode:**
```
Step 1: POST /api/v1/orders/:id/items
{ items: [{ menuItemId, quantity, variationId?, addonIds?, notes? }, ...] }

Step 2: POST /api/v1/orders/:id/items/send
→ Same server logic as above

Step 3: Clear local cart, order detail refetches
```

**Server validation (insertResolvedItems):**
- Client sends `menuItemId + variationId + addonIds + quantity` — **prices are NEVER from client**
- Server loads current menu snapshot, validates:
  - Item exists, is active, belongs to outlet
  - Variation belongs to item (if provided)
  - Each addon exists, is active, is allowed on this item
  - `unitPricePaise = basePricePaise + variationDeltaPaise` (must be ≥ 0)
- Snapshots menuItemName, variationName, unitPricePaise, taxRateBps, addon details into order_items

**Server errors:** 400 BadRequest (item/variation/addon not found, addon not allowed, negative price), 404 NotFound (order), 409 Conflict (order not open, table has open order, no draft items)

### 6f. Bill Link (Existing Order Header)

**Button:** **"Bill"** (border button, slate-300) → `/pos/order/:id/bill`
- Only visible in existing order mode

---

## 4.7 POS Order Flow — Takeaway (Web)

Same as Dine-In (Flow 4.6) except:
- Triggered by **"+ New takeaway"** button on table grid
- URL: `/pos/order/new?type=takeaway`
- Shows Customer Name + Phone fields (both optional)
- No `tableId` in API payload
- `orderType: "takeaway"` in create request
- Order appears in "Open takeaway orders" section on table grid

---

## 4.8 POS Order Flow — Mobile App

**Surface:** Mobile (`OrderScreen`)

### 8a. Entry Points (from TablesScreen)

- **Tap free table** → `navigate('Order', { tableId, tableCode })` (new dine-in)
- **Tap occupied table** → `navigate('Order', { orderId, tableCode })` (existing order)
- **Tap "+" New takeaway** → `navigate('Order', { orderType: 'takeaway' })` (new takeaway)
- **Tap open takeaway card** → `navigate('Order', { orderId })` (existing takeaway)

### 8b. TablesScreen

**Header:** Title "Tables", user name, "Stock" link (owner/admin/manager only), **"Sign out"** (red)

**Alert bar** (3 buttons, full-width row):

| Button | Color | Action | Confirmation |
|--------|-------|--------|-------------|
| "Call manager" | Blue (#2563eb) | `POST /alerts { kind: 'call_manager' }` | "Manager has been notified" |
| "Call kitchen" | Amber (#b45309) | `POST /alerts { kind: 'call_kitchen' }` | "Kitchen has been notified" |
| "Call waiter" | Teal (#0f766e) | `POST /alerts { kind: 'call_waiter' }` | "Waiter has been notified" |

**Table grid** (2 columns):
- Each card: code, seats, label, status (Free=green / "Order #N"=amber)

**Sign out flow:** **"Sign out"** → Alert: "This will unpair the device. Continue?" → clears deviceToken from SecureStore → PairScreen

### 8c. OrderScreen (Mobile)

**Header:** "New · {tableCode}" (new) or "Order #{N} (TA)" (existing)
**Header right:** **"Bill"** button (existing orders only) → `navigate('Bill', { orderId })`

**Category picker:** Horizontal scroll of category chips (first selected by default)

**Item grid** (2 columns):
- Card: name + price + "Options" badge (if variations/addons) + "Out of stock" (disabled, opacity 0.4)
- Tap simple item → add directly to cart
- Tap options item → opens LineEditor modal (bottom sheet, maxHeight 85%)

**LineEditor modal (mobile):**

| Section | Type | Details |
|---------|------|---------|
| Variation | Chip selection | Single choice, shows price delta |
| Add-ons | Checkbox list | Multiple, shows price per addon |
| Notes | TextInput | Max 500, placeholder "e.g. no onions" |
| Quantity | ± spinner | 30×30 buttons, min 1, max 999 |

| Button | Label | Action |
|--------|-------|--------|
| Cancel | "Cancel" | Close modal |
| Submit | "Add to cart" | Add CartLine, close |

**Cart panel** (bottom, dark bg #020617):
- Sections: "Already sent" (last 4, "+N more"), "Pending drafts" (orange, with "Send pending" button), "New items" with ± controls
- **"Send to kitchen"** button (blue, full width, disabled if empty, shows "Sending…")
- Error alerts: "Empty cart", "Missing table"

**API flow:** Same as web (create → send, or add → send)

---

## 4.9 Kitchen Display System (KDS) Flow

**Surface:** Web (`/kds`), roles: admin, manager, kitchen

### Page Layout

**Header:**
- Left: "{N} active" KOT count
- Right: Connection indicator — Green dot "Live" (connected) / Amber dot "Reconnecting…" (disconnected)

**3-column Kanban:**

| Column | Title | Color | Badge |
|--------|-------|-------|-------|
| 1 | New | Slate (slate-100 bg) | "New ({N})" |
| 2 | In progress | Amber (amber-100 bg) | "In progress ({N})" |
| 3 | Ready | Emerald (emerald-100 bg) | "Ready ({N})" |

Empty column: "No KOTs"

### KOT Card

**Content:**
- Header: "KOT #{kotNumber}" + table/order info
- Elapsed timer: "mm:ss" (updates every second)
- Items: "{qty}× {name}" with variation (slate-500), addons (slate-500), notes (italic, amber-700)

**Buttons per card:**

| Button | Label | Shown When | Action |
|--------|-------|-----------|--------|
| Progress | "Start" | status = `new` | `PATCH /kots/:id/status { status: "in_progress" }` |
| Progress | "Ready" | status = `in_progress` | `PATCH /kots/:id/status { status: "ready" }` |
| Progress | "Served" | status = `ready` | `PATCH /kots/:id/status { status: "served" }` → removes from board |
| Void | "Void" | Supervisor only (admin/manager) | Opens void modal |

### Void Modal

| Field | Type | Required | Details |
|-------|------|----------|---------|
| Reason | textarea | Yes | 2 rows, max 200, placeholder "e.g. wrong order, customer cancelled", autofocus |

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Cancel | "Cancel" | Never | — |
| Submit | "Confirm void" | No reason entered or pending | "Voiding…" |

```
PATCH /api/v1/kots/:id/status
{ status: "void", reason: string }
```

**Server:** Voids all items on KOT, broadcasts `kot.updated` via WebSocket.

### State Machine (Server-Enforced)

```
new → in_progress → ready → served
  \         \           \
   -------→ void ←--------  (any state → void)
```
**No backward transitions.** Server returns 409 Conflict on invalid transition.

### Data Flow

- **Initial:** REST fetch via `useActiveKots()` seeds the board
- **Live:** WebSocket `ws/kds?token=...` pushes `kot.created`, `kot.updated` events
- **Reconnect:** 3s backoff, REST refetch on reconnect to catch missed events
- **Heartbeat:** 30s ping/pong
- **Rooms:** Per-outlet isolation (each outlet's KDS is independent)

---

## 4.10 Billing Flow (Web)

**Surface:** Web (`/pos/order/:id/bill`)
**Entry:** Click **"Bill"** button on order page header

### 10a. No Bill Yet

**Display:** "No bill has been generated for this order yet."

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Generate | "Generate bill" | mutation pending | "Generating…" |

```
POST /api/v1/orders/:id/bill
{ discount?: null, lineDiscounts?: [] }
```

**Server validation:**
- Order exists, status = 'open'
- No bills exist for this order
- No draft items remain (all must be sent to kitchen)
- At least one non-void item
- **Error:** 409 Conflict (order not open, bill exists, draft items remain), 400 BadRequest (no items)

### 10b. Bill View (Left Column)

**Header:** "Bill #{billNumber}" + "Status: {status}"
**Link:** **"Print receipt"** → `/pos/order/:id/receipt`

**Items Table:**

| Column | Align | Content |
|--------|-------|---------|
| Item | Left | Name (+ variation in parentheses). Line discount below if > 0: "Line discount: −{amount} · {reason}" |
| Qty | Right | Integer |
| Unit | Right | ₹ formatted (tabular-nums) |
| Total | Right | ₹ formatted (tabular-nums) |

**Totals:**
- Subtotal
- Line discounts (if > 0): "−{amount}"
- Bill discount (if > 0): "−{amount}" with reason
- Taxable
- CGST, SGST
- Round off (if ≠ 0)
- **Total** (bold, border-top)
- Paid (if > 0)
- **Outstanding** (bold, if unpaid)

### 10c. Record Payment (Right Sidebar)

**Shows when:** Bill not settled AND not voided AND outstanding > 0

**Title:** "RECORD PAYMENT"

| # | Field | Type | Required | Details |
|---|-------|------|----------|---------|
| 1 | Method | 4-button grid | Yes | "cash" / "upi" / "card" / "other". Selected: dark bg. Default: cash |
| 2 | Amount (₹) | text (inputMode: decimal) | Yes | Pre-filled with outstanding balance. Tabular-nums |
| 3 | Reference (optional) | text | No | Only shown for upi/card/other. Placeholder: "UPI txn id" (upi), "Auth code / last 4" (card) |

**Client Validation:**
- "enter a valid amount" (can't parse)
- "amount must be greater than zero"
- "amount exceeds outstanding balance of {outstanding}"

| Button | Label | Loading Label |
|--------|-------|---------------|
| Submit | "Record {formatPaise(amount)}" | "Recording…" |

### 10d. Payment Confirmation Modal

**Trigger:** Clicking "Record..." button opens this modal.

**Display fields:** Method (capitalized), Amount (lg bold), Reference (if exists)

| Button | Label | Disabled When | Loading Label |
|--------|-------|---------------|---------------|
| Cancel | "Cancel" | `busy` | — |
| Confirm | "Confirm" | `busy` | "Recording…" |

```
POST /api/v1/bills/:id/payments
{
  idempotencyKey: UUID,     // generated per confirmation, reused on retry
  method: "cash" | "upi" | "card" | "other",
  amountPaise: number,
  reference: string | null
}
```

**Server Logic:**
1. Idempotency check: if key exists, return existing payment
2. Validate: bill status = 'open', amount ≤ outstanding
3. Insert payment row
4. Increment `bill.paid_paise`
5. If `paid_paise >= total_paise`: bill.status → 'paid', order.status → 'closed'
   (For split bills: only close order if ALL sibling bills settled + at least one paid)

### 10e. Payments List

**Shows when:** Payments recorded

**Each payment:** Method (capitalized), amount. Voided: strikethrough styling.

**Void Payment** (supervisor only, per non-void payment):
- Button: **"Void"** (xs, red-600)
- Opens PromptModal:
  - Title: "Void payment"
  - Field: Reason textarea (3 rows, max 200, placeholder "Why is this payment being voided?")
  - Confirm: **"Void payment"** (red-600, disabled if no reason)
- API: `POST /bills/:id/payments/:paymentId/void { reason }`
- Server: Soft-deletes payment, decrements `paid_paise`, reopens bill + order if was paid

### 10f. Supervisor Actions

**Shows when:** User is admin/manager AND bill not voided

| Button | Label | Shows When | Action |
|--------|-------|-----------|--------|
| Discount | "Apply discount" or "Edit discount" | Always | Opens discount editor |
| Void | "Void bill" | !settled AND no payments | Opens void prompt |
| Refund | "Refund bill" | settled (paid) | Opens refund prompt |

### 10g. Discount Editor

**Fields:**

| # | Field | Type | Details |
|---|-------|------|---------|
| 1 | Type | 2-button toggle | "Flat (₹)" / "Percent (%)" |
| 2 | Value | text (inputMode: decimal) | Label changes: "Amount (₹)" or "Percent" |
| 3 | Reason | text | Max 200, required |

**Validation:** "reason is required", "enter a valid amount", "enter a percentage between 0 and 100"

| Button | Label | Action |
|--------|-------|--------|
| Cancel | "Cancel" | Close editor |
| Remove | "Remove" (only if discount exists) | `PATCH /bills/:id/discount { discount: null }` |
| Save | "Save" / "Saving…" | `PATCH /bills/:id/discount { discount: { type, valuePaise/valueBps, reason } }` |

**Server:** Recomputes all bill_items with new discount distribution. Deletes + re-inserts bill_items.

### 10h. Void / Refund Prompts

**Void Bill:**
- Title: "Void bill #{billNumber}"
- Reason textarea (3 rows, max 200, placeholder "Why is this bill being voided?")
- Button: **"Void bill"** (red-600)
- API: `POST /bills/:id/void { reason }`
- Server: Validates status = 'open', no payments exist. Marks bill void + all items void.

**Refund Bill:**
- Title: "Refund bill #{billNumber}"
- Reason textarea (3 rows, max 200)
- Button: **"Refund bill"** (red-600)
- API: `POST /bills/:id/refund { reason }`
- Server: Validates status = 'paid'. Voids ALL non-void payments. Forces bill void. Cancels order if all sibling bills void.

### 10i. Settled State

**Display:** Green message "Bill paid in full."
**Button:** **"Back to tables"** → navigates to `/pos`

---

## 4.11 Billing Flow (Mobile)

**Surface:** Mobile (`BillScreen`)
**Entry:** Tap **"Bill"** in order header → `navigate('Bill', { orderId })`

### Three States

**State 1: No bill**
- **"Generate bill"** button (blue) → `POST /orders/:id/bill`

**State 2: Bill exists**
- Bill header: "Bill #{N}" + status badge (OPEN/PAID/VOID)
- Items table: name + qty × unit = total
- Totals: subtotal, discounts, taxable, CGST, SGST, round-off, **Total**, paid, **Outstanding** (amber)
- Payments list (if any, voided ones strikethrough)
- PDF button: **"View / share PDF"** → downloads bill PDF, opens share sheet (shows "Opening PDF…")

**Payment form:**

| Field | Type | Required | Details |
|-------|------|----------|---------|
| Method | 4 chips | Yes | CASH / UPI / CARD / OTHER. Default: cash |
| Amount (₹) | text (decimal-pad) | Yes | Pre-filled with outstanding |
| Reference | text | No | Only for upi ("UPI txn id") / card ("Last 4 digits") |

**Button:** **"Record payment"** → confirmation alert: "Record {amount} via {METHOD}?" → confirms → `POST /bills/:id/payments`

**If bill settled:** Alert "Bill paid", pops to TablesScreen

**State 3: Paid**
- Success box (dark green): "Bill paid in full."
- **"Back to tables"** button → `popToTop()`

---

## 4.12 Receipt / Print Flow

**Surface:** Web (`/pos/order/:id/receipt`)
**Entry:** Click **"Print receipt"** link on bill page

**No Shell wrapper** (minimal chrome for printing)

**Action bar** (hidden when printing via `print:hidden`):
- **"← Back to bill"** link → `/pos/order/:id/bill`
- **"Print / Save as PDF"** button → `window.print()` (browser native dialog)
- Auto-triggers print if `?print=1` query param

**Receipt layout (A5/thermal optimized):**
- "Tax Invoice" (h1)
- "Bill #{N} · Order #{N}" (xs)
- Metadata: Date, Type (dine_in/takeaway), Table code, Status
- Items table: Item, Qty, Unit, Total (with line discount rows)
- Totals: Subtotal through Total (bold)
- Payments (non-voided): method + reference + amount
- Footer: "Thank you for your visit."

---

## 4.13 Menu Management Flow

**Surface:** Web (`/admin` for items, `/admin/categories` for categories)
**Auth:** Required (admin/manager)

### 13a. Category Management (`/admin/categories`)

**Page title:** "Categories"
**Button:** **"New category"** → opens CategoryFormModal (create)

**Table columns:** Name | Description | Order | Active | Actions

**Per-row actions:**
- **"Edit"** → opens CategoryFormModal (edit, pre-filled)
- **"Deactivate"** (only if active) → `confirm("Deactivate '{name}'?")` → mutation

**CategoryFormModal:**

| # | Field | Type | Required | Details |
|---|-------|------|----------|---------|
| 1 | Name | text | Yes | autofocus, 1-120 chars |
| 2 | Description (optional) | textarea (2 rows) | No | Max 1000 |
| 3 | Display order | number | Yes | Min 0, default 0 |
| 4 | Active | checkbox | Edit only | — |

| Button | Label | Loading Label |
|--------|-------|---------------|
| Cancel | "Cancel" | — |
| Save | "Save" | "Saving…" |

```
// Create:
POST /api/v1/menu/categories
{ name, description?, displayOrder }

// Update:
PATCH /api/v1/menu/categories/:id
{ name?, description?, displayOrder?, isActive? }
```

### 13b. Item Management (`/admin`)

**Page title:** "Menu items"
**Button:** **"New item"** (disabled + tooltip "Create a category first" if no active categories)

**Table columns:** Name | Category | Price | Active | In stock | Actions

**In-stock toggle:**
- Green badge "In stock" or red badge "Out of stock"
- Click toggles via `POST /menu/items/:id/in-stock { inStock: boolean }`
- Disabled if item is inactive or mutation pending

**Per-row actions:**
- **"Edit"** → ItemFormModal (edit)
- **"Deactivate"** (if active) → `confirm("Deactivate '{name}'?")` → mutation

**ItemFormModal:**

| # | Field | Type | Required | Details |
|---|-------|------|----------|---------|
| 1 | Category | select | Yes | All active categories |
| 2 | Name | text | Yes | 1-120 chars |
| 3 | Description (optional) | textarea (2 rows) | No | Max 1000 |
| 4 | Price (₹) | text (inputMode: decimal) | Yes | Placeholder "120 or 99.50". Converted to paise |
| 5 | Tax rate (%) | number | Yes | 0-100, step 0.01, default 5. Converted to bps (×100) |
| 6 | In stock | checkbox | Yes | Default: checked |
| 7 | Active | checkbox | Edit only | — |

**Variations section:**
- Header: "VARIATIONS"
- **"+ add"** button to add row
- Per variation:
  - Name (text, placeholder "Name (e.g. Half)")
  - Price Delta (text, placeholder "Δ ₹ (signed)", w-32)
  - **"×"** remove button
- Validation: name required, valid signed price delta

**Add-ons section:**
- Header: "ADD-ONS"
- 2-column grid, max-h-40, scrollable
- Checkboxes for each active addon: "{name} {price}"
- Empty state: "No add-ons seeded yet. Create via the API to attach them here."

```
// Create:
POST /api/v1/menu/items
{
  categoryId, name, description?, pricePaise, taxRateBps,
  inStock, variations: [{ name, priceDeltaPaise, displayOrder }],
  addonIds: [string]
}

// Update (full replacement for variations/addons):
PATCH /api/v1/menu/items/:id
{
  categoryId?, name?, description?, pricePaise?, taxRateBps?,
  inStock?, isActive?, variations?, addonIds?
}
```

---

## 4.14 Stock Management (Mobile)

**Surface:** Mobile (`StockScreen`)
**Auth:** Owner/admin/manager only (hidden from staff/kitchen)

**Header:** "Stock · 86 items"

| Field | Type | Details |
|-------|------|---------|
| Search items | text | Live filter by name (case-insensitive). **"Clear"** button when non-empty |

**Per-item row:**
- Item name + price (muted gray)
- "86'd" badge (red, if out-of-stock)
- Toggle switch: green (in stock) / red (out of stock)
  - `POST /menu/items/:id/in-stock { inStock: boolean }`
  - Optimistic update with rollback on error

---

## 4.15 Staff Management Flow

**Surface:** Web (`/admin/staff`)
**Auth:** Required (admin/manager can view; admin can invite/manage)

**Page title:** "Staff"

**Table columns:** Name (+ "owner" badge) | Email | Role | Active | Last login | Devices

**Table sorting:** Owners first → role order (admin > manager > staff > kitchen) → name alpha

**Invite flow:** See Flow 4.4 above.

**Device management:** See Flow 4.5 (Step A) above. **"Manage"** button per staff row → DevicesModal.

---

## 4.16 Reports Flow

**Surface:** Web (`/admin/reports`)
**Auth:** Required (admin/manager)

### Controls

**Scope toggle** (2 buttons):
- **"This outlet"** (scope: 'outlet')
- **"All outlets"** (scope: 'tenant')

**Date range:**

| Field | Type | Default |
|-------|------|---------|
| From | date (HTML5) | Today |
| To | date (HTML5) | Today |

### 5 Tab Panels

| Tab | Title | Stat Cards | Table Columns | Notes |
|-----|-------|-----------|---------------|-------|
| daily | "Daily sales" | Bills, Revenue, Tax, Discount | By Outlet (if multi), By Order Type, By Payment Method | — |
| item | "Item-wise" | — | Item, Qty, Gross, Discount, Tax, Net | Variation shown in parentheses |
| category | "Category-wise" | — | Category, Qty, Net | "(uncategorised)" if null |
| tax | "Tax summary" | — | Rate (%), Taxable base, CGST, SGST, Total tax | Rate formatted "5.00%" |
| orders | "Order master" | — | #, Type, Status, Table, Bill, Total, Opened | Multi-outlet adds "Outlet" column |

**Order Master CSV:**
- **"Download CSV"** button (top right, border style)
- Loading: "Downloading…"
- Triggers browser download via `downloadOrderMasterCsv(query, token)`

**All reports aggregate from paid bills, not orders.**

---

## 4.17 Service Alert Flow

**Surface:** Mobile (TablesScreen), Web (KDS receives via WebSocket)

### Raise Alert (Mobile)

Three buttons on TablesScreen (full-width row):

| Button | Label | Color | API |
|--------|-------|-------|-----|
| 1 | "Call manager" | Blue | `POST /alerts { kind: "call_manager" }` |
| 2 | "Call kitchen" | Amber | `POST /alerts { kind: "call_kitchen" }` |
| 3 | "Call waiter" | Teal | `POST /alerts { kind: "call_waiter" }` |

**No role gate** — any paired device can summon help.
**Confirmation:** "{Role} has been notified"

### Server Logic
1. Validate tableId if provided (must belong to outlet)
2. Insert `service_alerts` row
3. Broadcast `alert.created` via WebSocket to all outlet connections
4. If broadcast fails: REST list is source of truth

### Acknowledge Alert (Web KDS or API)

```
POST /api/v1/alerts/:id/ack
```
Server: Sets `acked_at = NOW()`, `acked_by = actor.userId`, broadcasts `alert.acked`

---

## 4.18 Platform Admin Flow

**Surface:** Web (`/platform/*`)
**Auth:** Platform JWT (completely separate from tenant auth)

### 18a. Platform Login (`/platform/login`)

**Dark theme** (bg: slate-950)

| Field | Type | Required | Autocomplete |
|-------|------|----------|-------------|
| Email | email | Yes | username |
| Password | password | Yes | current-password |

| Button | Label | Loading Label |
|--------|-------|---------------|
| Submit | "Sign in" | "Signing in…" |

```
POST /api/v1/platform/auth/login
{ email, password }
→ Returns platform JWT (audience: 'platform')
→ Stored in localStorage['food.platform.token']
→ Redirect to /platform/tenants
```

### 18b. Tenant List (`/platform/tenants`)

- List of all tenants with filtering/sorting
- Click → `/platform/tenants/:id`

### 18c. Tenant Detail (`/platform/tenants/:id`)

**Header:** Tenant name, slug, created date, status chip
**Back:** **"← All tenants"** → `/platform/tenants`

**Summary stats** (4 cards): Outlets | Users | Paid bills | Lifetime revenue

**Status Controls:**
- Helper: "Suspending blocks new logins immediately. Existing tokens remain valid until they expire — this is a v1 limitation."

| Button | Label | Style | Disabled When |
|--------|-------|-------|---------------|
| 1 | "Mark active" | Default | status = 'active' or pending |
| 2 | "Mark trial" | Default | status = 'trial' or pending |
| 3 | "Suspend" | Danger | status = 'suspended' or pending |
| 4 | "Cancel" | Danger | status = 'cancelled' or pending |

**Suspend confirmation:** `confirm("Suspend '{name}'? Their users will be blocked from signing in.")`

```
PATCH /api/v1/platform/tenants/:id/status
{ status: "trial" | "active" | "suspended" | "cancelled" }
```

**Outlets table:** Name | Status | Created
**Recent Users table:** Email | Name | Role | Last login

### 18d. Suspension Enforcement (Server-Side)

```
Platform admin patches status → "suspended"
  ↓
Layer 1: In-memory tenant gate updated (O(1) check, no DB)
Layer 2: Auth middleware rejects all REST requests (403 Forbidden)
Layer 3: WebSocket server kicks all connected clients (close code 4001)
Layer 4: RLS policies prevent data access at DB level
Layer 5: Startup rejects connections if DB role has BYPASSRLS

Reactivation:
  → Patch status → "active"
  → In-memory gate cleared
  → New logins and requests proceed normally
```

---

## 4.19 Password Management Flow

### 19a. Change Own Password (Web)

```
POST /api/v1/auth/change-password
{ currentPassword: string, newPassword: string }
```
**Server:** Verifies current password (bcrypt), validates new ≠ current, hashes new (cost 12), updates. Returns 204.

### 19b. Admin Resets Staff Password (Web)

Available via Users module (admin only):
```
POST /api/v1/users/:id/reset-password
{ newPassword: string }
```
**Server:** No current password needed (admin trusted). Hashes new password, updates. Audit logged as `password_reset` event. Returns 204.

---

## 4.20 Item Void / Order Cancel Flow

### Void Single Item (Server)

```
DELETE /api/v1/orders/:id/items/:itemId
{ reason: string (1-200 chars) }
```
**Server:** Validates item exists, not already void, belongs to order. Marks void, stores reason + actor. If item had KOT, broadcasts KDS update. Returns 200.

### Cancel Entire Order (Server)

```
POST /api/v1/orders/:id/cancel
{ reason: string (1-200 chars) }
```
**Server:** Validates order exists, status = 'open'. Voids every active KOT (new/in_progress/ready) with cancellation reason. Marks order status = 'cancelled'. Broadcasts KDS updates for each voided KOT. Returns 200.

---

# 5. Database Schema

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

---

# 6. Roles & Permissions

## Role Hierarchy

| Role | Level | Description |
|------|-------|-------------|
| Platform Admin | Super | SaaS operator, manages all tenants |
| Tenant Owner | Tenant | Restaurant owner (admin + is_tenant_owner flag) |
| Admin | Outlet | Full outlet management access |
| Manager | Outlet | Operational management, reports |
| Staff | Outlet | POS operations, order taking |
| Kitchen | Outlet | KDS only, food preparation |

## Permission Matrix

| Feature | Platform | Admin | Manager | Staff | Kitchen |
|---------|----------|-------|---------|-------|---------|
| **Platform tenants** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tenant settings** | ✅ | ✅ (owner) | ❌ | ❌ | ❌ |
| **Invite staff** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Manage staff** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Reset passwords** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Device pairing** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Menu CRUD** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **In-stock toggle** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Table CRUD** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Create orders** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Add/send items** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Void items** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Cancel orders** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Update KOT status** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Generate bills** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Record payments** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Apply discounts** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Void bills** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Refund bills** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Void payments** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **View reports** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Export CSV** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Service alerts** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **View service menu** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **KDS board** | ❌ | ✅ | ✅ | ❌ | ✅ |
| **POS** | ❌ | ✅ | ✅ | ✅ | ❌ |

## Frontend Route Access

| Route | Allowed Roles |
|-------|--------------|
| `/pos/*` | admin, manager, staff |
| `/kds/*` | admin, manager, kitchen |
| `/admin/*` | admin, manager |
| `/platform/*` | platform admin only |
| `/login`, `/signup`, `/accept-invite` | public |

## Role-Based Landing Pages

| Role | Redirect To |
|------|------------|
| kitchen | `/kds` |
| staff | `/pos` |
| admin | `/admin` |
| manager | `/admin` |

## Multi-Outlet Access

- **Tenant owners:** Automatic access to all outlets (bypass)
- **Other users:** Explicit grants via `user_outlet_access` table
- **Request context:** `X-Outlet-Id` header selects active outlet
- **Server validates:** User has access to requested outlet before processing

---

# 7. Security Architecture

## Authentication

| Mechanism | Details |
|-----------|---------|
| JWT | Stateless tokens, configurable expiry (default 12h) |
| Password hashing | bcrypt cost 12 (~300ms per hash) |
| Password policy | 10-128 chars, must contain letter + digit |
| Device tokens | `<device_id>.<secret>` format, bcrypt-hashed secret |
| Pairing codes | 8-char code, SHA256 hashed, 10-min TTL |
| Token storage | Frontend: localStorage; Mobile: Expo Secure Store |
| Dual auth pools | Tenant JWT and Platform JWT are completely separate |

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Signup | 5 requests | per hour |
| Login | 10 requests | per 15 min |
| Device pairing | 20 requests | per 15 min |
| Device login | 60 requests | per 15 min |
| Accept invite | 20 requests | per 15 min |
| Change password | 5 requests | per 15 min |
| Platform login | 10 requests | per 15 min |

**Note:** In-memory rate limiters (process-local). Needs Redis for multi-instance deployments.

## Multi-Tenancy Isolation

```
Layer 1: Application → Every query filtered by tenant_id/outlet_id
Layer 2: Middleware  → tenantDb sets session GUC per request
Layer 3: PostgreSQL  → RLS policies enforce tenant_id match
Layer 4: In-Memory   → O(1) suspension check (no DB hit)
Layer 5: Startup     → Rejects connections if DB role has BYPASSRLS
```

**RLS Policy:**
```sql
(app.current_tenant_id = '' OR app.is_platform = 'on' OR tenant_id = app.current_tenant_id)
```

## Input Validation

- Zod schemas on every endpoint (body, query, params)
- Type coercion + narrowing
- UUID shape guards in middleware
- Money values as integers (never floats)
- No raw SQL interpolation (parameterized queries)

## HTTP Security

- **Helmet.js:** Security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CORS:** Strict origin checking (no wildcard in production)
- **Request IDs:** X-Request-Id for correlation (UUID format validated)

## Logging & Redaction

- **Structured JSON logs** via Pino
- **Redacted fields:** Authorization headers, passwords, secrets, PII in nested objects
- **Audit trail:** Immutable append-only log (RLS enforced, no UPDATE/DELETE)
- **Request correlation:** Every log entry tagged with request ID

## Database-Level Safeguards

| Safeguard | Purpose |
|-----------|---------|
| Foreign keys with ON DELETE RESTRICT | Prevent cascading deletes on critical data |
| Unique constraints per-outlet | Prevent duplicate categories, tables, etc. |
| No-double-billing trigger | Prevent same order item billed twice |
| CHECK constraints | Non-negative money values, max bounds |
| RLS FORCE on all tables | Even table owner is restricted |
| Audit log append-only | RLS + REVOKE prevents modification |

## Data Integrity

| Pattern | Implementation |
|---------|---------------|
| Optimistic locking | FOR UPDATE on concurrent-risk rows (draft items before KOT) |
| Snapshot isolation | Menu details frozen in order_items at order time |
| Soft deletes | is_active, is_void, revoked_at (preserves referential integrity) |
| Idempotent payments | idempotency_key UUID deduplicates retries |
| Append-only audit | Every mutation explicitly logged with before/after state |

## Graceful Shutdown

```
1. /readyz → 503 (load balancer drains traffic)
2. Close all WebSocket connections
3. server.close() (stop accepting new TCP connections)
4. Destroy idle keep-alive sockets, set Connection: close on in-flight
5. Wait for drain (10s hard timeout)
6. Close DB pool & exit
```

---

# 8. Mobile App — Food Staff

## Overview

Staff-facing mobile application for restaurant floor operations. Enables waiters and kitchen staff to manage tables, take orders, process billing, and manage stock from their mobile devices.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Expo + React Native | ~51.0.28 / 0.74.5 |
| Language | TypeScript | ~5.3.3 |
| Data Fetching | TanStack React Query | — |
| Navigation | React Navigation (native stack) | — |
| Camera | Expo Camera | QR code scanning |
| Secure Storage | Expo Secure Store | Credential persistence |
| Build System | EAS (Expo Application Services) | — |

## App Identity

- **App Name:** Food Staff
- **Bundle ID (iOS):** com.food.staff
- **Package (Android):** com.food.staff
- **Version:** 0.1.0

## Build Profiles

| Profile | Platform | API Target |
|---------|----------|-----------|
| Development | Android emulator | `http://10.0.2.2:4000` |
| Preview | iOS + Android | `https://app.example.com` |
| Production | iOS + Android | `https://app.example.com` |

## Screens

| Screen | Purpose |
|--------|---------|
| PairScreen | QR code scanning for device authentication |
| TablesScreen | View and manage dining tables |
| OrderScreen | Take and manage orders |
| BillScreen | Process billing and payments |
| StockScreen | Manage item stock/availability |

## Authentication Flow

```
1. Admin creates pairing code in web admin panel
2. QR code displayed on admin screen
3. Staff scans QR with mobile app camera
4. POST /api/v1/auth/pair → receives device token
5. Token stored in Expo Secure Store (encrypted)
6. Subsequent launches: POST /api/v1/auth/device-login
7. Token auto-expires after 1 year
8. Admin can revoke device from web panel
```

## Project Structure

```
mobile/
├── src/
│   ├── screens/
│   │   ├── PairScreen.tsx
│   │   ├── TablesScreen.tsx
│   │   ├── OrderScreen.tsx
│   │   ├── BillScreen.tsx
│   │   └── StockScreen.tsx
│   └── lib/
│       ├── api.ts (HTTP client)
│       ├── auth.ts (device token management)
│       ├── billing.ts (billing hooks)
│       ├── navigation.ts (stack config)
│       └── ... (other utilities)
├── app.json / app.config.js
├── eas.json
├── package.json
└── tsconfig.json
```

## Status

The mobile app exists in the codebase but is noted as "explicitly out of v1 scope" in the main README. It appears to be an active development effort beyond the documented v1 milestone.

---

# 9. Integrations & External Systems

## Current Integrations

### 9.1 WebSocket (Real-time Communication)

- **Protocol:** WS at `/ws/kds?token=...`
- **Purpose:** Kitchen Display System live updates
- **Events:** `kot.created`, `kot.updated`, `alert.created`, `alert.acked`
- **Architecture:** Per-outlet rooms, best-effort delivery
- **Heartbeat:** 30s ping/pong
- **Fallback:** REST is source of truth; clients refetch on reconnect

### 9.2 PDF Generation (pdfkit)

- **Bill PDFs:** Line items, tax breakdown, totals, payment method
- **KOT PDFs:** Order number, items, table, special instructions
- **Endpoints:** `GET /api/v1/bills/:id/pdf`, `GET /api/v1/kots/:id/pdf`

### 9.3 CSV Export

- **Order Master report:** RFC 4180 compliant CSV
- **Features:** Field escaping, CRLF line endings, proper null handling
- **Endpoint:** `GET /api/v1/reports/order-master` (with Accept header)

## Planned / Stubbed Integrations

### 9.4 Email Service (Deferred)

- **Current state:** `email_outbox` table queues emails but no provider integration
- **Templates defined:** signup_verify, staff_invite, password_reset
- **Schema:** to_email, template, payload (JSONB), status, attempts, last_error
- **Status tracking:** pending → sent → failed

### 9.5 POS Receipt Printer

- **Current state:** Print-optimized receipt page at `/pos/order/:id/receipt`
- **Design:** A5/thermal width, no browser chrome (`@media print`)
- **Gap:** No direct printer integration (browser print dialog only)

## NOT Integrated (Known Gaps)

| Integration | Status | Notes |
|-------------|--------|-------|
| Payment gateway (Razorpay, Stripe) | Not built | Payments are manual cash/upi/card recording |
| SMS/WhatsApp notifications | Not built | No customer notification system |
| GST return filing | Not built | Tax summary exists, no export to GSTN |
| Inventory management | Not built | Only in-stock boolean flag on items |
| Accounting software (Tally, etc.) | Not built | No export format for accounting |
| Delivery platforms (Zomato, Swiggy) | Not built | No marketplace integration |
| Loyalty/rewards program | Not built | No customer identity or rewards |
| Table reservation system | Not built | Tables have no booking/reservation flow |
| Cloud printing (thermal printers) | Not built | Browser print only |
| Push notifications | Not built | Mobile app has no push setup |
| Redis (caching/pub-sub) | Not built | In-memory stores are process-local |
| CDN / Object storage | Not built | No image uploads for menu items |

---

# 10. Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENTS                                 │
├─────────────┬──────────────────┬────────────────────────────┤
│  Web SPA    │  Mobile App      │  Platform Admin SPA        │
│  (React)    │  (Expo/RN)       │  (React, same codebase)    │
│  /pos       │  Food Staff      │  /platform                 │
│  /kds       │  QR Pairing      │  Tenant Management         │
│  /admin     │  Tables/Orders   │  Stats & Monitoring        │
└──────┬──────┴────────┬─────────┴──────────────┬─────────────┘
       │ REST          │ REST                    │ REST
       │ WebSocket     │                         │
       ▼               ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER                             │
├─────────────────────────────────────────────────────────────┤
│  Middleware Pipeline:                                        │
│  requestContext → helmet → cors → rateLimit → auth →        │
│  tenantDb → validate → [handler] → audit → error            │
├─────────────────────────────────────────────────────────────┤
│  Modules:                                                    │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌─────────┐     │
│  │ Auth │ │ Menu │ │ Tables │ │ Orders  │ │ Billing │     │
│  └──────┘ └──────┘ └────────┘ └─────────┘ └─────────┘     │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌─────────┐     │
│  │Users │ │ KDS  │ │Alerts  │ │Reports  │ │Platform │     │
│  └──────┘ └──────┘ └────────┘ └─────────┘ └─────────┘     │
│  ┌──────┐ ┌──────────┐                                      │
│  │ PDF  │ │ Devices  │                                      │
│  └──────┘ └──────────┘                                      │
├─────────────────────────────────────────────────────────────┤
│  WebSocket Server (KDS + Alerts)                             │
│  Per-outlet rooms │ Best-effort delivery │ 30s heartbeat     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    POSTGRESQL 16                              │
├─────────────────────────────────────────────────────────────┤
│  Row Level Security (RLS) per tenant                         │
│  Session GUCs: app.current_tenant_id, app.current_outlet_id │
│  Triggers: no-double-billing, tenant_id backfill            │
│  Audit log: append-only (RLS enforced)                       │
│  BIGINT paise for all money │ BPS for all tax rates          │
└─────────────────────────────────────────────────────────────┘
```

## Module Architecture (Server)

Each module follows a consistent layered pattern:

```
module/
├── *.types.ts        → Domain models & TypeScript types
├── *.schemas.ts      → Zod validation schemas
├── *.routes.ts       → Express route definitions (HTTP verbs + middleware)
├── *.controller.ts   → Request handlers (parse → delegate → respond)
├── *.service.ts      → Business logic (rules, state machines, orchestration)
└── *.repository.ts   → Data access (SQL queries, transactions)
```

**Data flow:** Route → Controller → Service → Repository → PostgreSQL

## Multi-Tenancy Architecture

```
Request arrives
  │
  ├── requireAuth middleware
  │   ├── Verify JWT
  │   ├── Check in-memory tenant suspension gate (O(1))
  │   ├── Resolve outlet from X-Outlet-Id header
  │   └── Populate req.auth { userId, tenantId, outletId, role }
  │
  ├── tenantDb middleware
  │   ├── Checkout PoolClient from pg pool
  │   ├── SET app.current_tenant_id = req.auth.tenantId
  │   ├── SET app.current_outlet_id = req.auth.outletId
  │   ├── Wrap in AsyncLocalStorage
  │   └── RLS policies auto-filter all queries
  │
  └── Handler executes (tenant-scoped automatically)
```

## Frontend Architecture (Web)

```
React SPA
├── AuthProvider (React Context)
│   └── JWT token management, login/logout
├── QueryClient (TanStack React Query)
│   └── All server state (no Redux/Zustand)
├── Router (React Router DOM)
│   ├── Public routes: /login, /signup, /accept-invite
│   ├── RequireAuth wrapper (role-based gate)
│   │   ├── /pos/* (admin, manager, staff)
│   │   ├── /kds/* (admin, manager, kitchen)
│   │   └── /admin/* (admin, manager)
│   └── RequirePlatformAuth wrapper
│       └── /platform/* (platform admins)
└── Feature modules (src/lib/*.ts)
    └── Hooks: queries + mutations + types per domain
```

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| PostgreSQL RLS over application-only tenancy | Defense in depth; even if app layer has bugs, DB prevents cross-tenant leaks |
| BIGINT paise over decimal/float | Eliminates floating-point rounding errors in financial calculations |
| Snapshot pattern for order items | Menu price changes don't retroactively alter historical orders |
| WebSocket for KDS + REST fallback | Real-time UX with reliability guarantee (REST is source of truth) |
| Zod over class-validator | Co-location of types + validation, better TypeScript inference |
| React Query over Redux | Server state doesn't need client-side store; Query handles cache, revalidation, optimistic updates |
| No component library | Tailwind utility classes, no abstraction overhead for small team |
| Separate platform auth pool | Platform admins can't accidentally access tenant data and vice versa |
| In-memory tenant gate | O(1) suspension checks without DB roundtrip (trade-off: single-process only) |
| Append-only audit log | Compliance requirement; RLS + REVOKE ensures immutability |
