# Integrations & External Systems

## Current Integrations

### 1. WebSocket (Real-time Communication)

- **Protocol:** WS at `/ws/kds?token=...`
- **Purpose:** Kitchen Display System live updates
- **Events:** `kot.created`, `kot.updated`, `alert.created`, `alert.acked`
- **Architecture:** Per-outlet rooms, best-effort delivery
- **Heartbeat:** 30s ping/pong
- **Fallback:** REST is source of truth; clients refetch on reconnect

### 2. PDF Generation (pdfkit)

- **Bill PDFs:** Line items, tax breakdown, totals, payment method
- **KOT PDFs:** Order number, items, table, special instructions
- **Endpoints:** `GET /api/v1/bills/:id/pdf`, `GET /api/v1/kots/:id/pdf`

### 3. CSV Export

- **Order Master report:** RFC 4180 compliant CSV
- **Features:** Field escaping, CRLF line endings, proper null handling
- **Endpoint:** `GET /api/v1/reports/order-master` (with Accept header)

## Planned / Stubbed Integrations

### 4. Email Service (Deferred)

- **Current state:** `email_outbox` table queues emails but no provider integration
- **Templates defined:** signup_verify, staff_invite, password_reset
- **Schema:** to_email, template, payload (JSONB), status, attempts, last_error
- **Status tracking:** pending → sent → failed

### 5. POS Receipt Printer

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
