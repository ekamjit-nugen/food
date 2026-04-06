# API Endpoints

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
