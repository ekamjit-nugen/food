# POS Blocker Fixes — Claude Prompts

## How to Use

Each prompt below is a self-contained instruction for Claude. Copy the full prompt (everything inside the code fence) and paste it into Claude Code or Claude chat with your codebase attached. Run them in order — some fixes depend on earlier ones.

---

## Blocker 1: Password Validation Mismatch

**Gap**: Client validates min 8 chars, server enforces min 10 + letter + digit. Users pass client validation but fail server validation with no clear message.

**Files likely affected**: Signup page, accept-invite page, change-password form, server auth validation

```
I need you to fix a password validation mismatch across my entire codebase.

PROBLEM:
- Client-side password validation currently says "min 8 characters"
- Server-side enforces "min 10 characters + at least one letter + at least one digit"
- Users pass client validation, submit the form, and get a confusing server error

WHAT TO DO:

1. Find every file that has client-side password validation (search for password length checks, "8 characters", "min 8", password helper text, password placeholder text). This includes:
   - Signup page/form
   - Accept-invite page/form  
   - Change-password form
   - Any shared password validation utility

2. For each file found, update the client-side validation to match the server:
   - Minimum length: 10 characters
   - Must contain at least one letter (a-z or A-Z)
   - Must contain at least one digit (0-9)

3. Update all helper text / placeholder text next to password fields to say:
   "At least 10 characters with a letter and a number."

4. Update client-side error messages:
   - If < 10 chars: "Password must be at least 10 characters"
   - If no letter: "Password must contain at least one letter"  
   - If no digit: "Password must contain at least one number"

5. Find the server-side password validation and confirm it enforces the same rules. If the server uses a shared validation function, make sure the client mirrors it exactly. If the server validation is inline, extract it into a shared validation utility that both client and server can reference.

6. Create or update a shared password validation function if one doesn't exist:
   ```typescript
   function validatePassword(password: string): { valid: boolean; error?: string } {
     if (password.length < 10) return { valid: false, error: 'Password must be at least 10 characters' };
     if (!/[a-zA-Z]/.test(password)) return { valid: false, error: 'Password must contain at least one letter' };
     if (!/\d/.test(password)) return { valid: false, error: 'Password must contain at least one number' };
     return { valid: true };
   }
   ```

Do NOT change the server-side minimum — 10 chars with letter + digit is the correct policy. Only the client needs to be updated to match.

After making changes, list every file you modified and what you changed.
```

---

## Blocker 2: Token Expiry & Session Lifecycle

**Gap**: Token TTL is unspecified. No refresh token flow. No handling when token expires mid-shift. WebSocket dies on token expiry.

**Files likely affected**: Auth service (JWT signing), auth middleware, frontend AuthProvider, WebSocket connection handlers

```
I need you to implement a complete token lifecycle for this POS system. Currently the JWT token has no documented TTL, there's no refresh token, and when the token expires the app silently breaks.

CONTEXT:
- This is a restaurant POS system where shifts last 8-12 hours
- Staff (POS, kitchen) cannot be interrupted with login prompts during service
- Admins/managers can have shorter sessions
- The KDS (Kitchen Display System) uses a WebSocket that authenticates with the JWT
- Mobile devices authenticate via a device token that gets exchanged for a JWT

WHAT TO DO:

1. DEFINE TOKEN TTL (update the JWT signing logic in the auth service):
   - Access token: 12 hours for roles `staff` and `kitchen` (they work full shifts)
   - Access token: 2 hours for roles `admin` and `manager`
   - Refresh token: 7 days for all roles
   - The JWT `sign()` call should use the role to determine `expiresIn`

2. IMPLEMENT REFRESH TOKEN:
   a. When a user logs in (POST /auth/login), return both:
      - `accessToken` (short-lived JWT)
      - `refreshToken` (long-lived, opaque or JWT, stored in DB)
   b. Create a `refresh_tokens` table/collection:
      ```
      {
        token: string (hashed),
        userId: string,
        tenantId: string,
        expiresAt: Date,
        isRevoked: boolean,
        createdAt: Date
      }
      ```
   c. Add endpoint: `POST /api/v1/auth/refresh`
      - Accepts: `{ refreshToken }`
      - Validates: token exists, not expired, not revoked, user still active, tenant still active
      - Returns: new `{ accessToken, refreshToken }` (rotate refresh token — old one invalidated)
   d. On logout: revoke the refresh token
   e. On user deactivation: revoke all refresh tokens for that user
   f. On tenant suspension: revoke all refresh tokens for that tenant

3. UPDATE FRONTEND AUTH PROVIDER:
   a. Store both tokens: `localStorage['food.token']` (access) and `localStorage['food.refreshToken']` (refresh)
   b. Add an Axios/fetch interceptor that:
      - On 401 response: attempt token refresh using the refresh token
      - If refresh succeeds: retry the original request with the new access token
      - If refresh fails (refresh token also expired/revoked): clear both tokens, redirect to login
   c. Add a proactive refresh: check the access token's `exp` claim. If it expires within the next 5 minutes, refresh it in the background before it actually expires. This prevents any 401s during normal operation.

4. UPDATE WEBSOCKET CONNECTIONS (KDS, any real-time features):
   a. When the WebSocket connection is rejected with an auth error (close code 4001 or similar), trigger a token refresh
   b. If refresh succeeds: reconnect the WebSocket with the new token
   c. If refresh fails: redirect to login
   d. The KDS page should handle this transparently — the cook should never see a login prompt unless the refresh token has truly expired (after 7 days of no use)

5. UPDATE DEVICE LOGIN FLOW (mobile):
   - `POST /auth/device-login` should also return both accessToken and refreshToken
   - Mobile should store refreshToken in SecureStore alongside deviceToken
   - Same refresh logic applies on mobile

6. UPDATE ALL TOKEN STORAGE to include both tokens:
   - Login: store both
   - Signup: store both  
   - Accept-invite: store both
   - Device-login: store both
   - Logout: clear both + revoke refresh on server
   - Token refresh: update both

After implementing, list every file modified and verify that:
- A staff member can work a 12-hour shift without being logged out
- An admin gets refreshed transparently every 2 hours
- KDS WebSocket survives token refresh without disconnecting the cook
- Logging out invalidates the refresh token server-side
```

---

## Blocker 3: Staff Deactivation Flow

**Gap**: No way to disable a staff member's access. No deactivation UI, no reactivation, no device revocation on deactivation.

**Files likely affected**: Staff management page, users API controller, users service, auth middleware

```
I need you to implement a staff deactivation and reactivation flow. Currently there's no way for an admin to disable a former employee's access.

WHAT TO DO:

1. ADD API ENDPOINTS:

   a. POST /api/v1/users/:id/deactivate
      - Auth: admin or tenant owner only
      - Server logic:
        1. Validate user exists and belongs to actor's tenant
        2. Cannot deactivate yourself
        3. Cannot deactivate the tenant owner
        4. Set user.isActive = false
        5. Revoke ALL paired devices for this user (set all user_devices to revoked)
        6. Revoke ALL refresh tokens for this user
        7. Log audit event: { action: 'user.deactivated', actorId, targetUserId }
      - Return: 200 with updated user object

   b. POST /api/v1/users/:id/reactivate
      - Auth: admin or tenant owner only
      - Server logic:
        1. Validate user exists, belongs to tenant, isActive === false
        2. Set user.isActive = true
        3. Log audit event: { action: 'user.reactivated', actorId, targetUserId }
      - Return: 200 with updated user object
      - Note: Devices are NOT automatically re-paired. The user needs a new pairing code.

2. UPDATE AUTH MIDDLEWARE:
   - On every authenticated request, check that the user's isActive === true
   - If isActive === false: return 403 with { error: { code: 'ACCOUNT_DEACTIVATED', message: 'Your account has been deactivated. Contact your admin.' } }
   - This check should happen AFTER JWT validation but BEFORE any route handler
   - For performance: cache the isActive status in the JWT claims, but also do a DB check on sensitive operations (or periodically — e.g., every 5 minutes via a lightweight check)

3. UPDATE THE STAFF MANAGEMENT PAGE (frontend):

   In the staff table, for each row add:
   
   a. If user is active:
      - Show a "Deactivate" button (red text, only visible to admin)
      - Clicking opens a confirmation dialog: "Deactivate {name}? They will be immediately signed out and all their devices will be unpaired."
      - On confirm: call POST /users/:id/deactivate → refetch staff list
      - The deactivated user's row should now show a red "Deactivated" badge instead of green "Active"

   b. If user is deactivated:
      - Show a "Reactivate" button (green text, only visible to admin)
      - Clicking opens a confirmation: "Reactivate {name}? They will be able to log in again but will need to re-pair their devices."
      - On confirm: call POST /users/:id/reactivate → refetch staff list

   c. The tenant owner row should NOT show a deactivate button (can't deactivate yourself or the owner)

   d. Add a filter toggle at the top of the staff table: "Show deactivated" (off by default). When on, deactivated users appear with grayed-out styling and the red badge.

4. HANDLE EDGE CASES:
   - If a deactivated user tries to log in: the auth middleware catches it and returns 403
   - If a deactivated user's device tries device-login: same 403
   - If a deactivated user has a WebSocket connection: on next message/heartbeat, the server should reject and close the connection with code 4001

After implementing, verify:
- Admin can deactivate a staff member
- Deactivated member can't log in (web)
- Deactivated member's devices stop working (mobile)
- Admin can reactivate the member
- Reactivated member can log in again
- Tenant owner can't be deactivated
```

---

## Blocker 4: Cancelled Order Doesn't Free Table

**Gap**: When an order is cancelled, the order status changes to "cancelled" but the table remains "Occupied". Staff can't seat new guests.

**Files likely affected**: Order cancel endpoint/service, table status logic, WebSocket broadcast

```
I need you to fix the order cancellation flow so that cancelling an order also frees the associated table.

CURRENT BEHAVIOR:
- POST /api/v1/orders/:id/cancel sets order.status = 'cancelled' and voids all KOTs
- But the table status is NOT updated — it stays "Occupied" with a cancelled order
- The POS table grid still shows the table as occupied

WHAT TO DO:

1. In the order cancellation logic (wherever POST /orders/:id/cancel is handled):
   
   After setting order.status = 'cancelled' and voiding KOTs, add:

   a. If the order has a tableId (it's a dine-in order):
      - Check if there are any OTHER open orders on this table (edge case: shouldn't happen normally, but be safe)
      - If no other open orders: free the table
        - This might mean clearing the order association on the table record
        - Or setting the table status to 'free'
        - Depends on how your table-order relationship works — check if the table has an `currentOrderId` field or if the "occupied" status is derived from having an open order with that tableId
      - If there are other open orders on the same table (shouldn't happen): leave table occupied

   b. Broadcast a WebSocket event so the POS table grid updates in real-time:
      - If you have a table status WebSocket channel: emit the table status change
      - If the POS grid polls or refetches: this happens on next fetch, but real-time is better
      - If you have an order-related WebSocket event: include the table status change in the payload

2. Also check: what happens when a bill is voided (POST /bills/:id/void)?
   - If voiding a bill reopens the order: table should stay occupied (correct)
   - If voiding a bill on a cancelled order: table should stay free
   
3. Also check: what happens when an order is closed (all bills paid)?
   - The table should be freed when the order closes
   - Verify this already works — if not, apply the same fix

After implementing:
- Cancel a dine-in order → verify the table shows as "Free" on the POS grid immediately
- Cancel a takeaway order → no table to free, should work without error
- Cancel an order that somehow has no table (edge case) → should work without error
```

---

## Blocker 5: Bill With Partial Payment Can't Be Voided

**Gap**: A bill with status "open" and partial payments can't be voided (void requires no payments) and can't be refunded (refund requires status "paid"). Staff is stuck.

**Files likely affected**: Bill void endpoint, bill service

```
I need you to fix the bill void logic so that bills with partial payments can be voided.

CURRENT BEHAVIOR:
- Void bill: validates status = 'open' AND no payments exist → if there are partial payments, void fails
- Refund bill: validates status = 'paid' → if bill is partially paid (still 'open'), refund fails
- Result: a bill with partial payments (e.g., ₹300 paid on ₹500) is stuck — can't void, can't refund

WHAT TO DO:

1. Update the bill void logic (POST /bills/:id/void):

   CURRENT validation:
   ```
   if (bill.status !== 'open') throw 409
   if (bill has payments) throw 409
   ```

   NEW validation:
   ```
   if (bill.status !== 'open') throw 409
   // Remove the "no payments" check — allow voiding with partial payments
   ```

   NEW server logic when voiding a bill that has payments:
   ```
   1. Void all non-void payments on this bill:
      - For each payment where status !== 'void':
        - Set payment.status = 'void'
        - Set payment.voidedAt = now
        - Set payment.voidedBy = actorId
        - Set payment.voidReason = same reason as the bill void
      - Decrement bill.paid_paise back to 0

   2. Then void the bill itself:
      - bill.status = 'void'
      - bill.voidedAt = now
      - bill.voidedBy = actorId
      - bill.voidReason = reason from request

   3. Reopen the order if needed:
      - If order.status was still 'open': leave it open
      - If order was 'closed' (shouldn't be if bill was open, but be safe): reopen it

   4. Log: action 'bill.voided' with details including payment count voided and total amount reversed
   ```

   All of this should be in a single database transaction.

2. Update the void confirmation UI:

   Currently the void button shows: "Void bill" with a reason prompt.
   
   If the bill has payments, update the confirmation to warn:
   
   Title: "Void bill #{billNumber}"
   Warning (only shown if payments exist): 
   "⚠️ This bill has {N} payment(s) totaling ₹{amount}. Voiding will also reverse all payments."
   
   Reason field: same as before (textarea, required)
   Button: "Void bill and reverse payments" (instead of just "Void bill")

3. The refund flow should remain unchanged — it's for fully paid bills where the customer wants money back. The void flow now handles the "cancel this bill entirely" use case regardless of payment state.

After implementing:
- Create an order, generate a bill for ₹500
- Record a partial payment of ₹300 (outstanding: ₹200)
- Void the bill → should succeed
- Verify: payment is voided, bill is voided, order is back to open
- Verify: table is still occupied (order is open, not closed)
```

---

## Blocker 6: Receipt Missing Legally Required Fields (India)

**Gap**: Tax invoice receipts are missing GSTIN, restaurant address, FSSAI license, and phone — all legally required in India.

**Files likely affected**: Receipt page component, receipt layout, bill PDF template (if exists)

**Depends on**: Blocker 7 (tenant settings) — these fields need to come from somewhere. If blocker 7 isn't done yet, hardcode placeholder values and add TODO comments.

```
I need you to add legally required fields to the receipt/tax invoice page.

CONTEXT:
In India, a tax invoice for a food establishment must include:
- Business name (restaurant name)
- GSTIN (GST Identification Number)
- FSSAI license number
- Registered address
- Phone number
- Bill number and date (already present)
- Customer details for takeaway (name, phone — already captured but might not be on receipt)

CURRENT RECEIPT LOCATION: /pos/order/:id/receipt (web) and Bill PDF (mobile)

WHAT TO DO:

1. Update the receipt layout to add a header section ABOVE the current "Tax Invoice" title:

   ```
   ┌──────────────────────────────────────┐
   │         {Restaurant Name}            │  ← bold, centered, large
   │      {Address Line 1}               │  ← centered, small
   │      {City, State - PIN}            │
   │   Phone: {phone}                    │  ← centered, small
   │   GSTIN: {gstin}                    │  ← centered, small
   │   FSSAI: {fssaiLicense}            │  ← centered, small
   ├──────────────────────────────────────┤
   │           TAX INVOICE                │
   │  Bill #{N} · Order #{N}             │
   │  Date: {date}  Type: {type}         │
   │  Table: {code}  Status: {status}    │
   │  Customer: {name}  Ph: {phone}      │  ← only for takeaway orders with customer info
   ├──────────────────────────────────────┤
   │  Items table...                      │
   │  Totals...                           │
   │  Payments...                         │
   ├──────────────────────────────────────┤
   │  Thank you for your visit.           │
   └──────────────────────────────────────┘
   ```

2. These fields need to come from tenant/outlet configuration. Check if there's a tenant settings object or outlet record that has these fields. 

   If the fields DON'T exist on any model yet:
   a. Add these fields to the tenant or outlet schema:
      - gstin: String (15 chars, optional — not all restaurants are GST registered)
      - fssaiLicense: String (14 digits, optional)
      - address: { line1: String, line2: String, city: String, state: String, pincode: String }
      - phone: String
   b. Add a TODO comment: "These fields need a settings UI — see Blocker 7"
   c. For now, make the receipt gracefully handle missing values — if GSTIN is not set, don't show the "GSTIN:" line at all

   If the fields DO exist somewhere: wire them into the receipt page.

3. Update the receipt API or data fetching:
   - The receipt page likely fetches bill + order data
   - Also fetch tenant/outlet data for the header fields
   - If there's a bill PDF endpoint: update the PDF template too

4. For takeaway orders: show customer name and phone on the receipt if they were provided during order creation.

5. Add "Original" / "Duplicate" support:
   - Accept a query param: /pos/order/:id/receipt?copy=original (default)
   - Show "ORIGINAL FOR CUSTOMER" or "DUPLICATE FOR BUSINESS" text at the bottom
   - When printing via window.print(), the browser's "copies" setting handles multiple prints

6. Make sure the thermal printer layout still works:
   - Keep text-heavy, minimal margins
   - Use monospace-friendly alignment for the items table
   - Test at a narrow width (58mm or 80mm thermal paper equivalent)

After implementing, the receipt should look like a proper Indian tax invoice that satisfies GST compliance requirements.
```

---

## Blocker 7: Tenant Settings Page

**Gap**: No settings page exists. Multiple features need tenant-level configuration: GSTIN, address, FSSAI, tax rates, KDS thresholds, receipt footer text, etc.

**Files likely affected**: New page to create, new API endpoints, tenant/outlet schema update

```
I need you to create a Tenant Settings page in the admin panel. Multiple features across the app need tenant-level configuration but there's nowhere to manage it.

WHAT TO BUILD:

1. NEW PAGE: /admin/settings (admin role only)

   Page title: "Settings"
   Layout: Single column with sections separated by dividers. Each section has a heading, description, and form fields. One "Save" button per section (not one giant form).

2. SECTION 1: BUSINESS INFORMATION
   
   Heading: "Business details"
   Description: "This information appears on receipts and tax invoices."

   | # | Field | Type | Required | Placeholder | Validation |
   |---|-------|------|----------|-------------|------------|
   | 1 | Restaurant name | text | Yes | — | Pre-filled from tenant.name, 2-120 chars |
   | 2 | Address line 1 | text | No | "123 Main Street" | Max 200 |
   | 3 | Address line 2 | text | No | "Floor 2, Near Park" | Max 200 |
   | 4 | City | text | No | "Mumbai" | Max 100 |
   | 5 | State | dropdown | No | Select state | Indian states list |
   | 6 | PIN code | text | No | "400001" | 6 digits, regex: /^[1-9][0-9]{5}$/ |
   | 7 | Phone | tel | No | "+91 98765 43210" | Max 15 chars |
   | 8 | Email | email | No | "info@restaurant.com" | Valid email format |

   Button: "Save business details" / "Saving..."

3. SECTION 2: TAX & COMPLIANCE

   Heading: "Tax & compliance"
   Description: "GST registration and food safety license details."

   | # | Field | Type | Required | Placeholder | Validation |
   |---|-------|------|----------|-------------|------------|
   | 1 | GSTIN | text (uppercase) | No | "22AAAAA0000A1Z5" | 15 chars, regex: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/ or empty |
   | 2 | FSSAI license | text | No | "10012345000123" | 14 digits or empty |
   | 3 | Default tax rate (%) | number | Yes | "5" | 0-28, step 0.01. Default: 5. Helper: "Applied to new menu items. Common rates: 5% (restaurants without AC), 18% (AC restaurants), 28% (5-star)." |

   Button: "Save tax settings" / "Saving..."

4. SECTION 3: BILLING

   Heading: "Billing & receipts"
   Description: "Customize how bills and receipts look."

   | # | Field | Type | Required | Placeholder | Validation |
   |---|-------|------|----------|-------------|------------|
   | 1 | Bill number prefix | text | No | "INV" | Max 10 chars, alphanumeric. Helper: "Bills will be numbered as {prefix}/001, {prefix}/002, etc. Leave empty for plain numbers." |
   | 2 | Receipt footer text | text | No | "Thank you for your visit." | Max 200 chars |
   | 3 | Max discount (%) | number | No | "50" | 0-100. Helper: "Maximum discount a manager can apply. Leave empty for no limit." |

   Button: "Save billing settings" / "Saving..."

5. SECTION 4: OPERATIONS

   Heading: "Operations"
   Description: "Kitchen and service configuration."

   | # | Field | Type | Required | Placeholder | Validation |
   |---|-------|------|----------|-------------|------------|
   | 1 | KOT warning time (minutes) | number | No | "5" | 1-60. Helper: "KOT cards turn amber after this many minutes." |
   | 2 | KOT urgent time (minutes) | number | No | "10" | 1-60, must be > warning time. Helper: "KOT cards turn red after this many minutes." |
   | 3 | Auto-restock daily | checkbox | No | — | Default: off. Helper: "Automatically mark all items as 'In stock' every day at the time below." |
   | 4 | Auto-restock time | time | Conditional | "06:00" | Only shown if auto-restock is checked. HH:MM format. |

   Button: "Save operations settings" / "Saving..."

6. API ENDPOINTS:

   GET /api/v1/settings
   - Auth: admin/manager (read)
   - Returns all settings for the current tenant

   PATCH /api/v1/settings/business
   - Auth: admin only
   - Body: { name?, address?, phone?, email? }
   - Updates tenant business info

   PATCH /api/v1/settings/tax
   - Auth: admin only
   - Body: { gstin?, fssaiLicense?, defaultTaxRateBps? }

   PATCH /api/v1/settings/billing
   - Auth: admin only
   - Body: { billNumberPrefix?, receiptFooterText?, maxDiscountBps? }

   PATCH /api/v1/settings/operations
   - Auth: admin only
   - Body: { kotWarningMinutes?, kotUrgentMinutes?, autoRestock?, autoRestockTime? }

7. DATA MODEL:

   Add these fields to the tenant record (or create a separate `tenant_settings` table/subdocument):

   ```
   {
     business: {
       address: { line1, line2, city, state, pincode },
       phone: String,
       email: String
     },
     tax: {
       gstin: String,
       fssaiLicense: String,
       defaultTaxRateBps: Number  // basis points, default 500 (5%)
     },
     billing: {
       billNumberPrefix: String,
       receiptFooterText: String,  // default "Thank you for your visit."
       maxDiscountBps: Number      // basis points, null = no limit
     },
     operations: {
       kotWarningMinutes: Number,  // default 5
       kotUrgentMinutes: Number,   // default 10
       autoRestock: Boolean,       // default false
       autoRestockTime: String     // HH:MM, default "06:00"
     }
   }
   ```

8. NAVIGATION:
   - Add "Settings" to the admin sidebar navigation (gear icon)
   - Position: at the bottom of the nav, above any logout link
   - Only visible to admin role

9. SAVE BEHAVIOR:
   - Each section saves independently (not one giant form)
   - On save: show success toast "Settings saved"
   - On error: show error toast with the server error message
   - Unsaved changes: if the user navigates away with unsaved changes, show browser confirmation dialog

After implementing:
- Admin can see and edit all settings
- Manager can view settings but not edit (or hide the page from managers — your choice, but document it)
- Settings values are available to the receipt page (Blocker 6), KDS (urgency colors), and billing (discount cap, bill number prefix)
```

---

## Blocker 8: Tenant Suspension Doesn't Invalidate Tokens

**Gap**: Platform admin suspends a tenant, but existing JWTs remain valid until they expire. Suspended tenant can keep operating.

**Files likely affected**: Platform admin status change endpoint, auth middleware, tenant model

```
I need you to fix tenant suspension so that it immediately invalidates all existing sessions.

CURRENT BEHAVIOR:
- Platform admin patches tenant status to "suspended"
- New logins are blocked
- BUT existing JWT tokens are still valid until they expire
- A suspended tenant can keep using the system for hours

WHAT TO DO:

1. Add a `suspendedAt` field to the tenant model:
   - Type: Date, nullable
   - Set to `new Date()` when status changes to 'suspended'
   - Set to `null` when status changes back to 'active' or 'trial'

2. Update the platform admin status change endpoint:
   When changing status TO 'suspended':
   ```
   tenant.status = 'suspended'
   tenant.suspendedAt = new Date()
   await tenant.save()
   ```
   
   When changing status FROM 'suspended' to anything else:
   ```
   tenant.status = newStatus
   tenant.suspendedAt = null
   await tenant.save()
   ```

3. Update the auth middleware (the middleware that runs on every authenticated request):

   After validating the JWT signature and extracting the claims:
   ```
   // Check if tenant was suspended AFTER this token was issued
   const tenant = await getTenantById(tokenClaims.tenantId)  // cache this lookup
   
   if (tenant.status === 'suspended') {
     return res.status(403).json({
       error: {
         code: 'TENANT_SUSPENDED',
         message: 'This workspace has been suspended. Contact support.'
       }
     })
   }
   ```

   PERFORMANCE NOTE: This adds a DB lookup per request. To mitigate:
   - Cache the tenant status in memory (Redis or in-process) with a 30-second TTL
   - On suspension: publish a Redis event that invalidates the cache
   - Alternative: include `tenantStatus` in the JWT claims and check `suspendedAt > token.iat` — this avoids any DB lookup but requires the `suspendedAt` timestamp comparison

   The fastest approach with no DB lookup:
   ```
   // In auth middleware, after JWT validation:
   const tenant = await getCachedTenant(tokenClaims.tenantId) // 30-second cache
   
   if (tenant.suspendedAt && new Date(tenant.suspendedAt) > new Date(tokenClaims.iat * 1000)) {
     // Tenant was suspended AFTER this token was issued
     return 403 TENANT_SUSPENDED
   }
   ```

4. Also handle WebSocket connections:
   - On suspension, broadcast a 'force_disconnect' event to all WebSocket connections for that tenant
   - WebSocket auth should also check tenant status on connection and periodically (every heartbeat)

5. Also revoke all refresh tokens for the tenant on suspension:
   ```
   await RefreshToken.updateMany(
     { tenantId, isRevoked: false },
     { isRevoked: true, revokedAt: new Date(), revokedReason: 'tenant_suspended' }
   )
   ```

6. Update the platform admin UI:
   - When suspension is confirmed, show: "Tenant suspended. All active sessions have been invalidated."
   - On reactivation: "Tenant reactivated. Users can now log in again."

After implementing:
- Suspend a tenant → all existing sessions immediately stop working (within 30 seconds if using cache)
- Users see a clear "workspace suspended" error, not a generic 401
- Reactivate → users can log in again normally
- Refresh tokens are revoked on suspension, so even stored tokens can't be used
```

---

## Blocker 9: No Table Management After Onboarding

**Gap**: Tables are created in the onboarding wizard but there's no way to add, edit, rename, reorder, or deactivate tables after that.

**Files likely affected**: New admin page, new or existing API endpoints, table schema

```
I need you to create a Table Management page in the admin panel. Currently tables can only be created during onboarding and cannot be modified afterward.

WHAT TO BUILD:

1. NEW PAGE: /admin/tables (admin/manager role)

   Page title: "Tables"
   
   Top-right button: "+ Add table" (opens form modal)
   
   Table/grid showing all tables:

   | Column | Content |
   |--------|---------|
   | Code | "T1", "T5", etc. (bold) |
   | Label | "Window", "Patio", or "—" if not set |
   | Seats | Number |
   | Status | Green "Active" or Red "Inactive" badge |
   | Current order | "Order #12" link or "—" if free |
   | Actions | "Edit" button, "Deactivate"/"Activate" button |

   Sort: by displayOrder, then by code alphabetically

2. ADD TABLE MODAL:

   | # | Field | Type | Required | Placeholder | Validation |
   |---|-------|------|----------|-------------|------------|
   | 1 | Table code | text | Yes | "T10" | 1-20 chars, unique within outlet. Uppercase automatically. |
   | 2 | Label | text | No | "Window seat" | Max 50 chars |
   | 3 | Number of seats | number | Yes | "4" | 1-50 |
   | 4 | Display order | number | No | Auto (max existing + 1) | 0-999 |

   Buttons: "Cancel" / "Add table" (loading: "Adding...")

   API: POST /api/v1/tables
   Body: { code, label?, seats, displayOrder? }
   
   Server validation:
   - Code unique within outlet (case-insensitive)
   - Seats > 0
   - If code already exists: 409 "A table with code '{code}' already exists"

3. EDIT TABLE MODAL:

   Same fields as Add, but pre-filled with current values.
   Code field: editable BUT warn if changing: "Changing the code will update how this table appears on the POS."
   
   Additional field (edit only):
   - Active: checkbox (default: checked)

   API: PATCH /api/v1/tables/:id
   Body: { code?, label?, seats?, displayOrder?, isActive? }

   Server validation:
   - If deactivating: check no open order on this table. If there is: 409 "Cannot deactivate table with an open order. Close or cancel the order first."
   - If changing code: check uniqueness

4. DEACTIVATE/ACTIVATE (also accessible as a quick action from the table row):
   
   Deactivate: 
   - Confirmation: "Deactivate {code}? It will be hidden from the POS table grid."
   - API: PATCH /api/v1/tables/:id { isActive: false }
   - Server: reject if table has open order
   
   Activate:
   - No confirmation needed
   - API: PATCH /api/v1/tables/:id { isActive: true }

5. REORDER (optional but useful):
   - Drag-and-drop rows to reorder, or manual displayOrder numbers
   - API: PATCH /api/v1/tables/reorder { tableIds: ['id1', 'id2', ...] }
   - Server: sets displayOrder 0, 1, 2... in the order provided

6. UPDATE POS TABLE GRID:
   - The POS page (/pos) should only show tables where isActive === true
   - If it currently fetches all tables, add a filter: GET /api/v1/tables?active=true
   - Deactivated tables should NOT appear on the POS grid or mobile TablesScreen

7. NAVIGATION:
   - Add "Tables" to the admin sidebar (icon: grid or table icon)
   - Position: after "Categories" and before "Staff" in the nav order

After implementing:
- Admin can add tables beyond onboarding
- Admin can rename table codes and add labels
- Admin can change seat counts
- Admin can deactivate tables (hides from POS)
- Admin can reactivate tables
- POS only shows active tables
- Can't deactivate a table with an open order
```

---

## Blocker 10: No Standard Error Response Format

**Gap**: Different endpoints return errors in different shapes. Frontend has to guess the structure.

**Files likely affected**: Error handling middleware/filter, all controllers (indirectly)

```
I need you to standardize the error response format across the entire API.

PROBLEM:
Different endpoints return errors in different shapes:
- Some return: { message: "..." }
- Some return: { error: "..." }
- Some return: { error: { code: "...", message: "..." } }
- Some return plain strings
The frontend has to handle all these formats with messy try/catch logic.

WHAT TO DO:

1. Define THE standard error format (every error response from every endpoint must use this):

   ```json
   {
     "error": {
       "code": "MACHINE_READABLE_CODE",
       "message": "Human-readable description.",
       "details": {}
     }
   }
   ```

   - `code`: UPPER_SNAKE_CASE string. Always present. Used by frontend for conditional logic.
   - `message`: Human-readable English string. Always present. Shown to users.
   - `details`: Optional object with additional context (field errors, retry timing, etc.)

2. Define the error code registry (map every known error to a code):

   | HTTP Status | Code | Message | Used By |
   |---|---|---|---|
   | 400 | VALIDATION_ERROR | "Validation failed" | Any invalid input |
   | 400 | INVALID_PRICE | "Price must be greater than zero" | Menu items |
   | 400 | MISSING_REASON | "A reason is required" | Voids, refunds |
   | 401 | INVALID_CREDENTIALS | "Invalid email or password" | Login |
   | 401 | TOKEN_EXPIRED | "Your session has expired. Please sign in again." | Auth middleware |
   | 403 | FORBIDDEN | "You don't have permission to perform this action" | Role checks |
   | 403 | ACCOUNT_DEACTIVATED | "Your account has been deactivated. Contact your admin." | Auth middleware |
   | 403 | TENANT_SUSPENDED | "This workspace has been suspended. Contact support." | Auth middleware |
   | 404 | NOT_FOUND | "Resource not found" | Any missing resource |
   | 404 | TENANT_NOT_FOUND | "Workspace not found" | Login |
   | 409 | SLUG_ALREADY_TAKEN | "This workspace URL is already taken" | Signup |
   | 409 | EMAIL_ALREADY_EXISTS | "An account with this email already exists" | Signup, invite |
   | 409 | DUPLICATE_CATEGORY | "A category with this name already exists" | Menu |
   | 409 | TABLE_CODE_EXISTS | "A table with this code already exists" | Tables |
   | 409 | ORDER_NOT_OPEN | "This order is not open" | Order operations |
   | 409 | BILL_EXISTS | "A bill already exists for this order" | Billing |
   | 409 | DRAFT_ITEMS_EXIST | "Send all items to kitchen before generating a bill" | Billing |
   | 409 | TABLE_HAS_ORDER | "This table has an open order" | Table deactivation |
   | 409 | INVALID_KOT_TRANSITION | "This KOT status change is not allowed" | KDS |
   | 410 | INVITE_EXPIRED | "This invite has expired. Ask your admin for a new one." | Accept invite |
   | 429 | RATE_LIMITED | "Too many attempts. Please try again later." | Login, signup |
   | 429 | ACCOUNT_LOCKED | "Account locked due to too many failed attempts. Try again in 15 minutes." | Login |
   | 500 | INTERNAL_ERROR | "Something went wrong. Please try again." | Fallback |

3. Create a global error handler (NestJS exception filter or Express error middleware):

   ```typescript
   // This catches ALL errors and formats them consistently
   
   function errorHandler(err, req, res, next) {
     // If it's already a structured AppError, use it directly
     if (err instanceof AppError) {
       return res.status(err.statusCode).json({
         error: {
           code: err.code,
           message: err.message,
           details: err.details || undefined
         }
       });
     }

     // If it's a validation error (from your validation library)
     if (err.name === 'ValidationError' || err.status === 422) {
       return res.status(400).json({
         error: {
           code: 'VALIDATION_ERROR',
           message: 'Validation failed',
           details: {
             fields: formatValidationErrors(err)  // { fieldName: "error message" }
           }
         }
       });
     }

     // If it's a known HTTP error (manually thrown)
     if (err.statusCode && err.statusCode < 500) {
       return res.status(err.statusCode).json({
         error: {
           code: err.code || httpStatusToCode(err.statusCode),
           message: err.message
         }
       });
     }

     // Unknown error — don't leak details
     console.error('Unhandled error:', err);
     return res.status(500).json({
       error: {
         code: 'INTERNAL_ERROR',
         message: 'Something went wrong. Please try again.'
       }
     });
   }
   ```

4. Create an AppError class for throwing structured errors:

   ```typescript
   class AppError extends Error {
     constructor(
       public statusCode: number,
       public code: string,
       message: string,
       public details?: Record<string, any>
     ) {
       super(message);
     }
   }

   // Usage:
   throw new AppError(409, 'SLUG_ALREADY_TAKEN', 'This workspace URL is already taken');
   throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed', { fields: { email: 'Invalid email format' } });
   ```

5. Find every place in the codebase where errors are returned or thrown, and update them to use AppError or the standard format. Search for:
   - `res.status(4xx).json(`
   - `res.status(5xx).json(`
   - `throw new HttpException`
   - `throw new Error`
   - `new BadRequestException`
   - `new NotFoundException`
   - `new ConflictException`
   - `new ForbiddenException`
   - `new UnauthorizedException`

   For NestJS: you might need to update the exception filter rather than every individual throw. NestJS built-in exceptions (BadRequestException, etc.) should be caught by the filter and reformatted.

6. Update the frontend API client to expect this format:

   ```typescript
   // api.ts or wherever API calls are made
   
   async function handleApiError(response) {
     const body = await response.json();
     const error = body.error;
     
     // Now we can always rely on error.code and error.message existing
     if (error.code === 'TOKEN_EXPIRED') {
       // Trigger token refresh
     } else if (error.code === 'TENANT_SUSPENDED') {
       // Show suspension message
     } else if (error.code === 'VALIDATION_ERROR') {
       // Show field-level errors from error.details.fields
     } else {
       // Show error.message as a toast
     }
   }
   ```

After implementing:
- Every API error follows the same { error: { code, message, details? } } format
- Frontend can rely on error.code for programmatic handling
- Frontend can rely on error.message for display to users
- No more guessing the error shape
- Validation errors include field-level details
```

---

## Execution Order

Run these prompts in this order for the cleanest implementation:

```
1. Blocker 10: Error response format    (foundation — every other fix returns errors)
2. Blocker 1:  Password validation       (quick fix, no dependencies)
3. Blocker 7:  Tenant settings page      (Blocker 6 depends on this)
4. Blocker 6:  Receipt legal fields      (depends on Blocker 7)
5. Blocker 2:  Token lifecycle           (Blocker 8 depends on refresh tokens)
6. Blocker 8:  Suspension invalidation   (depends on Blocker 2's refresh tokens)
7. Blocker 3:  Staff deactivation        (uses patterns from Blocker 8)
8. Blocker 4:  Cancel order frees table  (standalone, quick)
9. Blocker 5:  Partial payment void      (standalone)
10. Blocker 9: Table management          (standalone, largest)
```

Estimated total: ~10 working days for 1 developer, ~6 days for 2 developers working in parallel (pairs 1+10, 2+4, 7→6, 2→8→3, 5+9).
