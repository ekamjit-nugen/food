# Roles & Permissions

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
