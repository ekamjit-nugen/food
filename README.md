# food — multi-tenant restaurant management SaaS

A narrowly-scoped PetPooja-style billing/KDS/ordering system for Indian
restaurants, built to ship to one friend's restaurant first and grow from
there. Multi-tenant from day one so the second customer doesn't require a
rewrite.

```
food/
├── server/   Node 20 + Express + Postgres (raw SQL) + Zod + JWT auth
├── web/      React 18 + Vite + TanStack Query + Tailwind
└── DEPLOY.md production deploy runbook — read this before shipping
```

## Scope (v1)

**Two surfaces**, one codebase:
- **POS/Admin** — responsive web app: login, menu CRUD, tables, order
  taking, billing with discounts + split bills, five reports
- **KDS** — kitchen display: real-time KOT stream via WebSocket, state
  transitions `new → in_progress → ready → served`

**Explicitly in scope:** multi-tenant (tenants → outlets), self-serve
signup, staff invites, cross-outlet reports, platform super-admin console,
INR-only billing with CGST/SGST per line, split bills, refunds, audit log.

**Explicitly out of v1:** aggregators, inventory, loyalty, gift cards,
native mobile apps, offline mode, e-invoicing/IRN, delivery tracking,
customer-facing app, AI anything. Every one of these was considered and cut
— see the plan that drove this.

## Architecture at a glance

- **Three levels:** platform → tenant → outlet. Every business row carries
  both `tenant_id` and `outlet_id`. The JWT's `outletId` is the authority
  for row-scoped queries; nothing trusts `req.body.outletId`, ever.
- **Two mutually-exclusive auth pools:** tenant users (`aud: 'tenant'`) and
  platform super-admins (`aud: 'platform'`). Same JWT secret, enforced
  audiences, separate login pages, separate localStorage keys on the web.
- **Money is integer paise.** Never a float. See `server/src/utils/money.ts`.
- **Tax is per line, 50/50 CGST+SGST split with exact-rounding.** Aggregate
  reports reconcile to bills line-by-line.
- **Soft delete everything.** Historical bills reference menu items by id.
- **Audit log on every mutation.** Explicit writes from service layer —
  triggers can't see the request id or authenticated actor.

## Getting started (dev)

```bash
# Backend
cd server
cp .env.example .env   # edit JWT_SECRET to >=32 chars
npm install
docker compose up -d   # Postgres on :5433
npm run db:migrate
SEED_DEMO=1 npm run db:seed   # optional: demo menu + tables
npm run dev            # :4000

# Frontend, in another terminal
cd web
npm install
npm run dev            # :5173
```

Visit `http://localhost:5173/signup` to create your first tenant.

## Going to production

See [DEPLOY.md](./DEPLOY.md). Short version:

1. Node VPS + managed Postgres
2. `npm run db:migrate`
3. `npm run platform:create-admin` — creates your ops login
4. Reverse-proxy to the Node server, serve `web/dist/` as static
5. Friend signs up at `/signup` → onboarding wizard → live

## Tests

```bash
cd server
npm test                                             # unit only, no DB
docker compose up -d
docker compose exec postgres psql -U food -c 'CREATE DATABASE food_test;'
TEST_DATABASE_URL=postgres://food:food@localhost:5433/food_test npm test
```

219 tests across unit + integration + cross-tenant isolation + end-to-end
happy path. The e2e test wipes the target database on every run — never
point `TEST_DATABASE_URL` at something you care about.

## License

Private — not yet licensed for redistribution.
