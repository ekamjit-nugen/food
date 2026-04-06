# Product Features

## 1. Multi-Tenant SaaS Platform

- **Three-level hierarchy:** Platform → Tenant (restaurant brand) → Outlet (physical location)
- **Self-serve signup:** Restaurant owners create workspace with unique slug
- **Tenant isolation:** PostgreSQL Row Level Security enforces strict data separation
- **Tenant statuses:** trial → active → suspended → cancelled
- **Platform admin dashboard:** Super-admin can manage all tenants, view stats, suspend/reactivate

## 2. Authentication & Authorization

- **Tenant user auth:** Email + password login scoped to workspace slug
- **JWT-based:** Stateless tokens (configurable expiry, default 12h)
- **Role-based access control:** admin, manager, staff, kitchen
- **Staff invitation system:** Owner/manager invites staff via token-based flow
- **Device pairing:** QR code + 8-char token for mobile app pairing (bcrypt-hashed)
- **Password management:** Change password, admin reset for staff
- **Platform admin auth:** Completely separate auth pool from tenant users
- **Rate limiting:** Per-endpoint throttling (signup: 5/hr, login: 10/15min)

## 3. Menu Management

- **Categories:** CRUD with activation/deactivation (soft delete)
- **Menu items:** Name, price (paise), tax rate (bps), description, category assignment
- **Variations:** Size/option variants with price deltas (Small -50, Large +100)
- **Addons:** Reusable toppings/extras (many-to-many with items)
- **In-stock toggle:** Runtime availability control (separate from deactivation)
- **Service menu:** Single API call returns complete active menu for POS display

## 4. Table Management

- **Dining tables:** Code, label, section, seats, display order
- **Bulk creation:** Create multiple tables at once (used in onboarding)
- **Active/inactive:** Soft delete for tables no longer in use
- **Table grid:** POS home shows all tables with order status indicators

## 5. Order Management

- **Order types:** Dine-in (linked to table) and takeaway
- **Order lifecycle:** open → closed → cancelled
- **Draft items:** Items added to order but not yet sent to kitchen
- **Menu snapshots:** Price, tax, variation, addons frozen at order time (immutable history)
- **Send to kitchen:** Batches draft items into a Kitchen Order Ticket (KOT)
- **Item voiding:** Remove individual items from order
- **Order cancellation:** Cancel entire order with all items

## 6. Kitchen Display System (KDS)

- **Real-time WebSocket feed:** `kot.created`, `kot.updated`, `alert.created`, `alert.acked`
- **3-column Kanban board:** New → In Progress → Ready
- **KOT state machine:** new → in_progress → ready → served (or void at any point)
- **No backward transitions:** Cannot go from ready back to in_progress
- **Auto-reconnect:** WebSocket reconnects with 3s backoff, REST refetch on reconnect
- **Per-outlet rooms:** Each outlet has isolated WebSocket channel

## 7. Billing & Payments

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

## 8. Service Alerts

- **Alert types:** Call Waiter, Call Kitchen, Call Manager
- **Real-time broadcast:** Alerts pushed via WebSocket to all connected clients
- **Acknowledgement flow:** Any staff can acknowledge an alert
- **No role gate:** Open to all staff for maximum flexibility
- **Audit trail:** Created by, acknowledged by, timestamps tracked

## 9. Reports & Analytics

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

## 10. Staff Management

- **Staff roster:** List all team members (active + inactive)
- **Create staff:** Admin creates user with role and outlet access
- **Edit staff:** Update name, role, active status
- **Password reset:** Admin can reset staff passwords
- **Multi-outlet access:** Staff can be granted access to specific outlets
- **Device management:** View paired devices, revoke access

## 11. Onboarding Wizard

- **3-step guided setup** for new restaurant owners:
  1. Create first category
  2. Create first menu item
  3. Create dining tables
- **Gate:** Main admin UI unlocks after all 3 steps complete

## 12. Mobile App (Staff-Facing)

- **App name:** "Food Staff"
- **QR code pairing:** Scan code from admin panel to authenticate
- **Screens:** Tables, Orders, Billing, Stock management
- **Secure storage:** Credentials stored via Expo Secure Store
- **Platforms:** iOS (com.food.staff) and Android (com.food.staff)

## 13. Platform Administration

- **Tenant directory:** List, search, filter all tenants
- **Tenant details:** Outlets, recent users, payment history
- **Status management:** Activate, suspend, cancel tenants
- **Platform stats:** Aggregate statistics across all tenants
- **Suspension enforcement:** Blocked logins, WebSocket kicks, RLS gate
