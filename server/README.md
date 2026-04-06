# food — server

Backend API for the restaurant management system. v1 scope: menu module (this iteration), with order/KOT/bill/reporting modules to follow.

## Stack

- Node 20+, TypeScript (strict)
- Express 4
- PostgreSQL 14+ via `node-postgres` (raw SQL, no ORM)
- Zod for input validation
- Pino for structured logging
- Vitest for tests

## Layout

```
src/
  config/env.ts            # validated env loader
  db/
    index.ts               # shared pg pool + withTransaction
    schema.sql             # authoritative v1 schema
    migrate.ts             # applies schema.sql
  middleware/
    auth.ts                # JWT bearer + requireRole
    validate.ts            # zod request validation
    error.ts               # terminal error handler
    audit.ts               # explicit audit_log writer
    requestContext.ts      # x-request-id
  modules/
    tables/
      tables.types.ts       # domain type
      tables.schemas.ts     # zod input schemas
      tables.repository.ts  # all SQL
      tables.service.ts     # transactions, audit, business rules
      tables.controller.ts  # thin HTTP handlers
      tables.routes.ts      # router + per-route middleware
    orders/
      orders.types.ts       # Order / OrderItem / Kot / KotWithItems
      orders.schemas.ts     # zod input schemas
      orders.repository.ts  # all SQL (orders, order_items, kots)
      orders.service.ts     # draft → KOT flow, pricing snapshot, audit
      orders.controller.ts  # thin HTTP handlers
      orders.routes.ts      # ordersRouter + kotsRouter
    billing/
      billing.engine.ts     # pure functions: tax, discount, rounding
      billing.types.ts      # Bill / BillItem / Payment
      billing.schemas.ts    # zod input schemas
      billing.repository.ts # all SQL (bills, bill_items, payments)
      billing.service.ts    # generate / update discount / record payment / void
      billing.controller.ts # thin HTTP handlers
      billing.routes.ts     # billingOrdersRouter + billsRouter
    reports/
      reports.schemas.ts    # zod date-range + filter schemas
      reports.repository.ts # aggregation SQL (all read-only)
      reports.service.ts    # range resolution + envelope
      reports.controller.ts # JSON + CSV output
      reports.routes.ts     # admin/mgr only
    users/
      users.schemas.ts      # zod input schemas (create/update/reset)
      users.repository.ts   # user CRUD SQL (sees inactive users too)
      users.service.ts      # last-admin + self-deactivation guards, audit
      users.controller.ts   # thin HTTP handlers
      users.routes.ts       # admin-only writes; admin+mgr reads
    menu/
      menu.types.ts        # domain types
      menu.schemas.ts      # zod input schemas
      menu.repository.ts   # all SQL
      menu.service.ts      # transactions, audit, business rules
      menu.controller.ts   # thin HTTP handlers
      menu.routes.ts       # router + per-route middleware
      *.test.ts            # unit + integration tests
  utils/
    errors.ts              # AppError + factories
    logger.ts              # pino instance
    money.ts               # integer-paise helpers
  app.ts                   # Express app factory
  index.ts                 # entry point + graceful shutdown
```

## Setup

```bash
cd server
cp .env.example .env
# edit .env — at minimum set DATABASE_URL and JWT_SECRET (>=32 chars)
npm install
docker compose up -d            # starts Postgres on localhost:5433
npm run db:migrate              # apply schema
SEED_DEMO=1 npm run db:seed     # admin + demo menu + demo tables (recommended for dev)
npm run dev
```

If you already have Postgres running locally, skip `docker compose up -d` and point `DATABASE_URL` at your instance instead.

### Demo data

`SEED_DEMO=1 npm run db:seed` additionally loads 3 categories, 7 menu items (with one variation and one add-on wired up), and 6 tables across two sections. Idempotent — re-running converges. Omit the flag if you want a pristine outlet with no menu.

Server listens on `http://localhost:4000`. Health check: `GET /healthz`.

### Seeding the first outlet

The `db:seed` script creates one outlet and one admin user. On first run it prints a randomly-generated password to stdout — **save it immediately**, there is no self-service password reset in v1.

Override defaults with env vars:

```bash
SEED_OUTLET_NAME="Mira's Cafe" \
SEED_ADMIN_EMAIL="mira@example.com" \
SEED_ADMIN_FULL_NAME="Mira" \
npm run db:seed
```

The script is idempotent on outlet name (reuses an existing one) and refuses to overwrite an existing admin email.

## Money & taxes

- **Money is integer paise.** 1 INR = 100 paise. Never a float. See `src/utils/money.ts`.
- **Tax rates are basis points.** 500 = 5%, 1800 = 18%. Stored per item.

Catch yourself doing `price * 1.05` and stop. Use `applyBps`.

## Authorisation model

- Every mutating endpoint requires a JWT with `sub`, `outletId`, `email`, `role`.
- `outletId` is taken from the token. Never from the request body. Never.
- Menu reads: any authenticated role (admin, manager, staff, kitchen).
- Menu writes: `admin` or `manager` only.

## Auth API

All routes mounted at `/api/v1/auth`.

| Method | Path               | Auth | Purpose |
|--------|--------------------|------|---------|
| POST   | `/login`           | none | Body `{ email, password }`. Returns `{ token, expiresIn, user }`. Rate-limited: 10 attempts / 15 min / IP. |
| GET    | `/me`              | JWT  | Returns the current `PublicUser` (no password hash). |
| POST   | `/change-password` | JWT  | Body `{ currentPassword, newPassword }`. Returns 204. |

### Login example

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"YOUR_SEED_PASSWORD"}'
```

Response:

```json
{
  "token": "eyJhbGciOi...",
  "expiresIn": "12h",
  "user": { "id": "...", "email": "admin@example.com", "role": "admin", ... }
}
```

Use the token as `Authorization: Bearer <token>` on every subsequent request.

### Password policy

- Minimum 10 characters (NIST-aligned length-first policy)
- Must contain at least one letter and one digit
- Max 128 characters (bcrypt DoS guard)
- No symbol or mixed-case requirement — these encourage predictable substitutions

### Why no refresh tokens in v1

Stateless JWT with a 12h TTL is enough for a staff-only POS. Refresh tokens add revocation complexity we do not need yet. When we eventually need server-side revocation, we will add a `token_version` column on users and bump it on forced logout.

## Users API

All routes mounted at `/api/v1/users`. Admin-only for writes; managers can read the roster.

| Method | Path                     | Role         | Purpose |
|--------|--------------------------|--------------|---------|
| GET    | `/`                      | admin, mgr   | List users. Query: `role`, `includeInactive=true`. |
| GET    | `/:id`                   | admin, mgr   | Single user. |
| POST   | `/`                      | admin        | Create. Body `{ email, password, fullName, role }`. |
| PATCH  | `/:id`                   | admin        | Update. Body may include `{ fullName?, role?, isActive? }`. Email is not editable (see below). |
| POST   | `/:id/reset-password`    | admin        | Body `{ newPassword }`. No "current password" — admin is trusted. Returns 204. |

### Invariants

- **Email is immutable.** Changing the login identifier is a phishing vector; deactivate the old user and create a new one instead.
- **Last-admin lockout is refused.** Demoting or deactivating the final active admin in an outlet is blocked with a 400.
- **Self-deactivation is refused.** An admin cannot flip their own `isActive` to false in one call (still allowed to demote themselves if another admin exists).
- **Passwords follow the same policy as the auth module**: 10+ chars, at least one letter, at least one digit, max 128.
- **Audit:** every create/update/reset writes an `audit_log` row. Password resets record only that a reset happened — never the hash, never the plaintext.

### Example: create a staff user

```bash
curl -X POST http://localhost:4000/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "riya@example.com",
    "password": "welcome-aboard-1",
    "fullName": "Riya Sharma",
    "role": "staff"
  }'
```

## Menu API

All routes mounted at `/api/v1/menu`. Bearer token required on every request.

| Method | Path                       | Role   | Purpose |
|--------|----------------------------|--------|---------|
| GET    | `/`                        | any    | Service menu (categories → items → variations + addons). The POS's main query. |
| GET    | `/categories`              | any    | List categories. `?includeInactive=true` to see soft-deleted. |
| POST   | `/categories`              | edit   | Create category. |
| GET    | `/categories/:id`          | any    | Get one. |
| PATCH  | `/categories/:id`          | edit   | Partial update. |
| DELETE | `/categories/:id`          | edit   | Soft-delete (`is_active = false`). |
| GET    | `/items`                   | any    | List. `?categoryId=&includeInactive=`. |
| POST   | `/items`                   | edit   | Create item, optionally with variations and addon ids. |
| GET    | `/items/:id`               | any    | Get one (hydrated). |
| PATCH  | `/items/:id`               | edit   | Partial update. `variations` and `addonIds` are full replacements when present. |
| DELETE | `/items/:id`               | edit   | Soft-delete. |
| POST   | `/items/:id/in-stock`      | edit   | Body `{ inStock: boolean }`. Fast toggle for the POS. |
| GET    | `/addons`                  | any    | List addons. |
| POST   | `/addons`                  | edit   | Create addon. |
| GET    | `/addons/:id`              | any    | Get one. |
| PATCH  | `/addons/:id`              | edit   | Partial update. |
| DELETE | `/addons/:id`              | edit   | Soft-delete. |

### Example: create an item

```bash
curl -X POST http://localhost:4000/api/v1/menu/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "categoryId": "11111111-1111-1111-1111-111111111111",
    "name": "Paneer Tikka",
    "pricePaise": 25000,
    "taxRateBps": 500,
    "variations": [
      { "name": "Half", "priceDeltaPaise": -5000 },
      { "name": "Full", "priceDeltaPaise": 0 }
    ],
    "addonIds": []
  }'
```

## Tables API

All routes mounted at `/api/v1/tables`. Bearer token required on every request.

| Method | Path         | Role | Purpose |
|--------|--------------|------|---------|
| GET    | `/`          | any  | List tables. `?includeInactive=true&section=Patio`. Ordered by section, display order, code. |
| GET    | `/:id`       | any  | Get one. |
| POST   | `/`          | edit | Create a single table. |
| POST   | `/bulk`      | edit | Create 1..200 tables in one transaction (onboarding path). |
| PATCH  | `/:id`       | edit | Partial update (code, label, section, seats, displayOrder, isActive). |
| DELETE | `/:id`       | edit | Soft-delete (`is_active = false`). Will eventually refuse if an open order references the table. |

`code` is uppercased on input so `t1` and `T1` collapse to the same table; `(outlet_id, code)` is unique.

### Example: bulk-create 20 tables

```bash
curl -X POST http://localhost:4000/api/v1/tables/bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tables": [
      { "code": "T1", "seats": 4, "section": "Indoor" },
      { "code": "T2", "seats": 4, "section": "Indoor" },
      { "code": "P1", "seats": 2, "section": "Patio" }
    ]
  }'
```

The whole batch is wrapped in a single transaction — any duplicate code rolls everything back so you never end up with a half-seeded floor plan.

## Orders API

Mounted at `/api/v1/orders`. Bearer token required.

| Method | Path                          | Role          | Purpose |
|--------|-------------------------------|---------------|---------|
| GET    | `/`                           | any           | List orders. `?status=open&tableId=...`. |
| GET    | `/:id`                        | any           | Hydrated order (items + kots). |
| POST   | `/`                           | admin/mgr/staff | Open an order. Dine-in requires `tableId`; takeaway rejects one. Optional initial draft `items`. |
| POST   | `/:id/items`                  | admin/mgr/staff | Add more draft items (not yet dispatched). |
| POST   | `/:id/items/send`             | admin/mgr/staff | Dispatch all current drafts as a new KOT. Returns the hydrated KOT. Emits `kot.created` to KDS. |
| DELETE | `/:id/items/:itemId`          | admin/mgr/staff | Void an item (body `{ reason }`). If already on a KOT, emits `kot.updated`. |
| POST   | `/:id/cancel`                 | admin/mgr/staff | Cancel an open order (body `{ reason }`). |

### Pricing rule

**The client never sends prices.** A draft item is `{ menuItemId, variationId?, addonIds[], quantity, notes? }`. The server resolves names, base price, variation delta, addon prices, and tax rate from the current menu inside the same transaction, and snapshots them onto `order_items`. Later menu edits never retroactively change a live order.

### Draft → KOT flow

1. `POST /orders` (optionally with initial `items[]`) — items are drafts, kitchen does not see them.
2. `POST /orders/:id/items` — add more drafts.
3. `POST /orders/:id/items/send` — atomically creates a KOT, assigns all drafts to it, broadcasts to KDS.
4. Kitchen transitions KOT through `new → in_progress → ready → served` via `PATCH /kots/:id/status`.
5. Additional courses: add more drafts → send → new KOT. One order, many KOTs.

### Example: open an order at a table

```bash
curl -X POST http://localhost:4000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tableId": "TABLE_UUID",
    "pax": 2,
    "items": [
      { "menuItemId": "ITEM_UUID", "quantity": 1 },
      { "menuItemId": "ITEM_UUID_2", "variationId": "VAR_UUID", "addonIds": ["AD_UUID"], "quantity": 2, "notes": "no onions" }
    ]
  }'
```

Then dispatch to the kitchen:

```bash
curl -X POST http://localhost:4000/api/v1/orders/$ORDER_ID/items/send \
  -H "Authorization: Bearer $TOKEN"
```

## KOTs API + KDS WebSocket

Mounted at `/api/v1/kots`.

| Method | Path              | Role                  | Purpose |
|--------|-------------------|-----------------------|---------|
| GET    | `/`               | any                   | List KOTs. `?active=true` returns `new|in_progress|ready`. Use on KDS connect. |
| PATCH  | `/:id/status`     | admin/mgr/staff/kitchen | Body `{ status, reason? }`. Allowed: `in_progress`, `ready`, `served`, `void`. `void` requires reason. |

### KDS WebSocket

Connect at `ws://HOST/ws/kds?token=YOUR_JWT` (or send `Authorization: Bearer ...` header). On connect the server sends `{ type: "hello", outletId }`. Every subsequent message is one of:

```jsonc
{ "type": "kot.created", "kot": { /* KotWithItems */ } }
{ "type": "kot.updated", "kot": { /* KotWithItems */ } }
```

Reconnect strategy: the WS stream is best-effort. On reconnect, the client should call `GET /api/v1/kots?active=true` to resync — the REST endpoint is the source of truth, WS just reduces latency.

State transitions are enforced server-side:

```
new → in_progress → ready → served
  \     \           /
   \---> void <----/
```

## Billing API

Mounted at `/api/v1/orders/:id/bill` (generation + fetch hanging off the order) and `/api/v1/bills` (everything else).

| Method | Path                          | Role          | Purpose |
|--------|-------------------------------|---------------|---------|
| POST   | `/api/v1/orders/:id/bill`     | admin/mgr/staff | Generate a single bill. Body `{ discount?, lineDiscounts?: [{ orderItemId, discount }] }`. Fails if drafts exist, no billable items, or any bill already exists. |
| POST   | `/api/v1/orders/:id/bills/split` | admin/mgr/staff | Generate N bills atomically. Body `{ splits: [{ orderItemIds, discount?, lineDiscounts? }, ...] }`. Every non-void order item must appear in exactly one split. |
| GET    | `/api/v1/orders/:id/bill`     | any           | Fetch the bill for an order (404 until generated; 409 if the order has been split — use the plural form). |
| GET    | `/api/v1/orders/:id/bills`    | any           | List every bill on an order, hydrated. Safe for both single and split orders. |
| GET    | `/api/v1/bills`               | any           | List bills. `?status=open|paid|void&from=ISO&to=ISO`. |
| GET    | `/api/v1/bills/:id`           | any           | Hydrated bill (items + payments). |
| PATCH  | `/api/v1/bills/:id/discount`  | admin/mgr     | Set/update/clear discounts. Body `{ discount: null | {...}, lineDiscounts?: [...] }`. Omitting `lineDiscounts` leaves existing line discounts untouched; passing `[]` clears them all. Only while bill is `open`. |
| POST   | `/api/v1/bills/:id/payments`  | admin/mgr/staff | Record a payment. Body `{ method, amountPaise, reference?, note? }`. Closes the parent order on full settlement. |
| POST   | `/api/v1/bills/:id/void`      | admin/mgr     | Void an unpaid bill. Body `{ reason }`. Bills with any recorded payment cannot be voided in v1. |

### How the math works (v1, hardcoded)

- **Tax is exclusive.** Menu prices are pre-tax; the engine adds CGST + SGST on top.
- **Tax rate per line** comes from the menu item snapshot on `order_items.tax_rate_bps`. `tax_rate_bps` is the TOTAL GST rate in basis points (e.g. `500` = 5% total). It is split **50/50** into CGST and SGST at the line level. `cgst = floor(tax/2)`, `sgst = tax - cgst`, so `cgst + sgst` always equals `lineTax`, exactly — never an off-by-one paisa.
- **Discounts stack in two stages.** Per-line discounts apply first (capped at that line's own subtotal). The bill-level discount then applies to the **sum of post-line-discount remainders** and is pro-rated back across lines by each line's post-line-discount share, using largest-remainder rounding. Tax is computed on the final per-line taxable, so the tax-summary report reconciles line-by-line. A line that is fully zeroed by its own discount absorbs none of the bill-level discount — the remaining lines absorb it all.
- **Flat discount is capped at its base.** Per-line flats cap at the line subtotal; the bill-level flat caps at the post-line-discount subtotal. You cannot owe a negative total.
- **Final total is rounded to the nearest rupee.** The delta is stored in `round_off_paise` (can be negative). The breakdown still reconciles: `taxable + tax + roundOff = total`.
- **Payments are additive.** A bill can be settled across cash + UPI; when `paid_paise` ≥ `total_paise` the bill flips to `paid` and the parent order flips to `closed`, atomically.

### Example: bill a table, apply a discount, settle in mixed cash + UPI

```bash
# Generate the bill with no discount
BILL=$(curl -sX POST http://localhost:4000/api/v1/orders/$ORDER_ID/bill \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
BILL_ID=$(echo "$BILL" | jq -r .id)

# Apply a 10% loyalty discount (manager approval = admin/manager role)
curl -X PATCH http://localhost:4000/api/v1/bills/$BILL_ID/discount \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discount":{"type":"percent","valueBps":1000,"reason":"10% loyalty"}}'

# Or stack a per-line comp with a bill-level loyalty discount. The 50% off on
# the starter applies first, then 5% comes off whatever remains.
curl -X PATCH http://localhost:4000/api/v1/bills/$BILL_ID/discount \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "discount":{"type":"percent","valueBps":500,"reason":"5% loyalty"},
        "lineDiscounts":[
          {"orderItemId":"'"$STARTER_ORDER_ITEM_ID"'",
           "discount":{"type":"percent","valueBps":5000,"reason":"chef comp"}}
        ]
      }'

# Half in cash
curl -X POST http://localhost:4000/api/v1/bills/$BILL_ID/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"cash","amountPaise":15000}'

# Remainder in UPI — this one closes the bill and the order
curl -X POST http://localhost:4000/api/v1/bills/$BILL_ID/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"upi","amountPaise":11000,"reference":"UPI/ABC123"}'
```

### Splitting a bill

Two friends at one table, they each want their own bill. The client decides the grouping — "these three items on Alice's bill, these two on Bob's" — and posts it in one call.

```bash
# After the order has been sent to the kitchen and KOTs are out, instead of
# POST /orders/:id/bill, split it:
curl -X POST http://localhost:4000/api/v1/orders/$ORDER_ID/bills/split \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "splits": [
          {
            "orderItemIds": ["'"$ALICE_ITEM_1"'", "'"$ALICE_ITEM_2"'", "'"$ALICE_ITEM_3"'"],
            "discount": {"type": "percent", "valueBps": 1000, "reason": "Alice loyalty"}
          },
          {
            "orderItemIds": ["'"$BOB_ITEM_1"'", "'"$BOB_ITEM_2"'"]
          }
        ]
      }'
# → 201 { data: [BillDetail, BillDetail] } — two fully-hydrated bills.

# Each bill is then addressable at /bills/:id for payment. Alice pays hers
# in UPI — her bill flips to paid but the ORDER stays open because Bob's
# bill is still outstanding. Only when both bills settle (or get voided)
# does the order close and the table free up.
curl -X POST http://localhost:4000/api/v1/bills/$ALICE_BILL_ID/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"upi","amountPaise":27000,"reference":"UPI/ALICE"}'
```

Validation: every non-void `order_item` on the order MUST appear in exactly one split. Missing items → 400 (`split would leave N item(s) unbilled`). Duplicate items → 400 (`item X appears in more than one split`). Unknown ids → 400. You cannot split an order that already has a bill (even a single non-split one); decide up front.

Refunding one sub-bill: voids only that bill and its payments. The order is NOT cancelled unless every sibling bill is also void. If refunding the last paid bill leaves open siblings behind, the order reopens so staff can collect on those.

### Voiding, refunding, and correcting payments

Three different operations with three different intents. Pick carefully.

| Endpoint                                         | Role        | When to use | End state |
|--------------------------------------------------|-------------|-------------|-----------|
| `POST /api/v1/bills/:id/void`                    | admin, mgr  | An **unpaid** bill is wrong (wrong order, wrong items) and needs to be discarded. | Bill `void`. Order stays `open` — regenerate a bill from the same order. |
| `POST /api/v1/bills/:id/payments/:paymentId/void`| admin, mgr  | A single **payment was mis-recorded** (wrong method, wrong amount). Correction flow. | Payment `is_void = true`. `bill.paid_paise` decremented. If the bill had flipped to `paid`, it reverts to `open` and the order re-opens so staff can record the correct payment. |
| `POST /api/v1/bills/:id/refund`                  | admin, mgr  | A **paid** bill needs to be reversed (guest dispute, food issue). | All payments voided, bill `void`, order `cancelled` with reason `"refund: <reason>"`. Table is freed. |

Voiding a payment on a `void` bill is refused — voided bills are immutable. Voiding an already-voided payment is refused. Voiding a bill with active payments is refused (use refund or void the payments first). Reason is mandatory on all three.

**Audit:** every void/refund writes an `audit_log` row. Voided payments are never hard-deleted — the row is preserved (`is_void = true`, `void_reason`, `voided_by`, `voided_at`) and `listPayments` returns it so the UI can render the history with strikethrough.

**Reports interaction:** a refund flips the bill to `void`, so it drops out of daily-sales, item-wise, category, and tax reports automatically. The `byPaymentMethod` breakdown also filters `payments.is_void = FALSE` as defence in depth.

```bash
# Correct a wrong cash payment on an otherwise-unsettled bill
curl -X POST http://localhost:4000/api/v1/bills/$BILL_ID/payments/$PAYMENT_ID/void \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"recorded wrong amount, re-taking payment"}'

# Refund a paid bill
curl -X POST http://localhost:4000/api/v1/bills/$BILL_ID/refund \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"customer complaint — food returned"}'
```

## Reports API

Mounted at `/api/v1/reports`. **Admin and manager only** — staff and kitchen never see revenue data.

| Method | Path                       | Purpose |
|--------|----------------------------|---------|
| GET    | `/daily-sales`             | Total revenue, tax, combined discount (bill-level + per-line), round-off. Broken down by order type and payment method. |
| GET    | `/item-wise`               | Per-item quantity, gross, discount share, tax, net. Sorted by net DESC. |
| GET    | `/category-wise`           | Per-category quantity and net revenue. |
| GET    | `/tax-summary`             | CGST/SGST/total by tax slab (`tax_rate_bps`). |
| GET    | `/order-master`            | Flat list of orders with customer/table/bill fields. Supports `?format=csv`. |

### Query parameters

All reports accept `?from=ISO&to=ISO`. Both are optional; if omitted the range defaults to **today in UTC**. Range semantics: `from` is inclusive, `to` is exclusive. Send explicit boundaries in the client's local timezone — the server does not apply outlet-timezone rewriting in v1.

`/order-master` additionally supports:
- `?status=open|closed|cancelled`
- `?orderType=dine_in|takeaway`
- `?format=json|csv` (default `json`)

### What counts

- **Revenue reports** (daily-sales, item-wise, category-wise, tax-summary) only count bills with `status='paid'`. Open and voided bills are excluded. This is deliberate — an unpaid bill is not revenue.
- **Order master** lists every order in the window regardless of status, so cancelled and takeaway-in-progress orders still show up on the shift log.

### Example

```bash
# Today's sales (defaults to today UTC)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/reports/daily-sales

# Item-wise for April
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/v1/reports/item-wise?from=2026-04-01&to=2026-05-01"

# Order master as CSV download
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/v1/reports/order-master?from=2026-04-01&to=2026-04-06&format=csv" \
  -o orders.csv
```

### CSV format

UTF-8, CRLF line endings (Excel-safe), RFC 4180 quoting. Money columns are rendered as rupee strings (e.g. `262.50`), not paise integers, because that's what the accountant expects when they open the file.

## Design decisions worth knowing

- **Soft-delete, never hard-delete** menu entities. Historical bills reference them by id; dropping rows corrupts reports.
- **Variations identify by `(item_id, name)`** on upsert. Rename = delete + add. Keeps ids stable when you merely adjust price/order.
- **Addon assignments are outlet-scoped at the repository level.** An outlet cannot attach another outlet's addon — enforced with a pre-insert count check.
- **`in_stock` vs `is_active`.** `in_stock` flips on/off during service; `is_active` is a lifecycle state (was the item ever real). They map to two different UI flows.
- **Audit log is written explicitly from services**, not via DB triggers. Triggers can't see the request id or authenticated actor. Greppable > clever.
- **BIGINT money comes back as strings from node-postgres** by default. The repository converts once, at the mapping boundary. Don't let string-paise leak into the service layer.
- **Order items snapshot menu data.** `menu_item_name`, `unit_price_paise`, `tax_rate_bps`, and the `addons` JSONB are all frozen at order time. Editing the menu never changes a past order.
- **One open order per table, enforced in SQL** via a unique partial index (`WHERE status='open'`). Two POS sessions racing to seat the same table can't both win.
- **KOT state transitions are enforced in SQL** (`WHERE status = ANY($allowed_from)`). The service layer computes the allowed-from set; the DB is the final gate so a double-click on "mark ready" can't skip past `in_progress`.
- **KDS WebSocket is best-effort**. The REST endpoint (`GET /api/v1/kots?active=true`) is the source of truth. Clients resync on reconnect rather than replaying a persistent event log.
- **Billing math lives in one pure module** (`billing/billing.engine.ts`). No DB, no I/O, no types from outside its own file. This is the trust-critical path — it's unit-tested in isolation and can be reasoned about without spinning up a database.
- **Tax is computed per line, not just per bill.** Aggregates are sums of line values. This is the only way item-wise and tax-summary reports can reconcile to the bill.
- **Discounts stack line-first, then bill-level.** Per-line discounts land on `bill_items.line_discount_paise` (stage 1). The bill-level discount is then pro-rated across the *post-line-discount* line weights using largest-remainder rounding (stage 2), so `sum(line.billDiscountShare) === bill.discountPaise` always — no stray paisa. `bills.line_discount_total_paise` is denormalized for the daily-sales report so it doesn't have to join back through `bill_items`.
- **Split bills are first-class: multiple bills per order.** The `UNIQUE (order_id)` constraint was dropped. A split is N bills on the same order with disjoint `order_item_id` subsets (validated in the service, since SQL can't express "every non-void item appears in exactly one bill" cleanly). Each sub-bill behaves identically to a non-split bill downstream — discount, payment, void, refund all address the bill id. Order closure is sibling-aware: the order closes only when every bill on it is in a terminal state (paid or void) and at least one is paid.
- **Paid bills cannot be voided in v1.** No refund workflow. Document this with the friend before going live so there's no day-one surprise.
- **Revenue reports only count paid bills.** An unpaid/void bill is not revenue. Order-master lists everything regardless of status because it's an operational log, not a financial report.
- **Reports are UTC in v1.** The `outlets.timezone` column is stored but not applied to range boundaries. Clients send explicit ISO timestamps in local TZ and the server treats them as absolute instants. Promote to proper timezone-aware ranges the day reports start looking wrong at midnight.

## Tests

```bash
npm test                                               # unit tests only (no DB required)

# End-to-end smoke test — requires a disposable Postgres database:
docker compose up -d
docker compose exec postgres psql -U food -c 'CREATE DATABASE food_test;'
TEST_DATABASE_URL=postgres://food:food@localhost:5433/food_test npm test
```

Unit tests cover schemas, pure functions, and the billing engine in isolation. They run against no database and are the fast feedback loop.

The E2E smoke test (`src/test/e2e.test.ts`) auto-skips when `TEST_DATABASE_URL` is unset. When it runs, it applies the schema, TRUNCATEs every business table, and walks the full v1 happy path: login → menu → create dine-in order → send to kitchen → KOT new → in_progress → ready → served → generate bill → record payment → order auto-closes → reports reflect the sale. **Never point `TEST_DATABASE_URL` at a real database** — the test wipes it on every run.

## What's NOT in this iteration

Deliberately out of scope (not forgotten):
- Self-service password reset and email delivery (admin-initiated reset exists)
- Outlet CRUD (seed covers the first one; multi-outlet deferred until a second customer)
- File upload for `image_url` (clients pass a URL they host)
- Rate-limit store backed by Redis (in-memory is fine single-instance)

These will land in subsequent iterations, building on the same schema and middleware.

## Operational notes

- Graceful shutdown on SIGINT/SIGTERM drains in-flight requests and closes the pg pool, with a 10s hard timeout fallback.
- `x-request-id` is accepted from upstream if well-formed, otherwise generated. Every log line and audit row carries it.
- CORS is strict — exactly the origin in `CORS_ORIGIN`. No wildcards.
- `helmet` sets the usual security headers. JSON body limit is 256KB.
