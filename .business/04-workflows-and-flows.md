# Workflows & Flows (Complete)

Every flow documents: exact fields, buttons, modals, validations, API payloads, server logic, error states, and navigation across Web, Mobile, and Server.

---

## 1. Tenant Signup Flow

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

## 2. Onboarding Wizard

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

## 3. Tenant Login Flow

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

## 4. Staff Invitation Flow

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

## 5. Device Pairing Flow (Mobile App)

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

## 6. POS Order Flow — Dine-In (Web)

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

## 7. POS Order Flow — Takeaway (Web)

Same as Dine-In (Flow 6) except:
- Triggered by **"+ New takeaway"** button on table grid
- URL: `/pos/order/new?type=takeaway`
- Shows Customer Name + Phone fields (both optional)
- No `tableId` in API payload
- `orderType: "takeaway"` in create request
- Order appears in "Open takeaway orders" section on table grid

---

## 8. POS Order Flow — Mobile App

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

## 9. Kitchen Display System (KDS) Flow

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

## 10. Billing Flow (Web)

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

## 11. Billing Flow (Mobile)

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

## 12. Receipt / Print Flow

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

## 13. Menu Management Flow

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

## 14. Stock Management (Mobile)

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

## 15. Staff Management Flow

**Surface:** Web (`/admin/staff`)
**Auth:** Required (admin/manager can view; admin can invite/manage)

**Page title:** "Staff"

**Table columns:** Name (+ "owner" badge) | Email | Role | Active | Last login | Devices

**Table sorting:** Owners first → role order (admin > manager > staff > kitchen) → name alpha

**Invite flow:** See Flow 4 above.

**Device management:** See Flow 5 (Step A) above. **"Manage"** button per staff row → DevicesModal.

---

## 16. Reports Flow

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

## 17. Service Alert Flow

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

## 18. Platform Admin Flow

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

## 19. Password Management Flow

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

## 20. Item Void / Order Cancel Flow

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
