# Architecture Overview

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
