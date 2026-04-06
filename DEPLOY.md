# Deploy runbook — shipping v1 to the first restaurant

This is the **minimum viable ship**: bring a production Postgres + server + web
online, create the platform super-admin, and hand the friend's restaurant a
signup URL. No Kubernetes, no CI/CD pipeline, no autoscaling. One VPS, one
database, one web bundle served by any static host.

If this page feels too bare — good. v1 ships on the fewest moving parts that
can possibly work.

## Prerequisites

- A Linux VPS with Node 20+ installed (1 vCPU / 2 GB RAM is plenty for one
  restaurant)
- A managed Postgres instance (RDS, Neon, Railway, Supabase, or
  docker-compose on the same VPS — pick what you can restore from backup).
  **The DATABASE_URL role MUST NOT have the `BYPASSRLS` attribute.** Superusers
  silently skip every row-level security policy in `schema.sql`, turning the
  entire multi-tenant isolation layer into theatre. See "Provisioning the
  database role" below.
- A domain you control (e.g. `app.example.com`), with TLS terminated by
  nginx / Caddy / the VPS platform
- A password manager to store the platform admin and friend's tenant owner
  credentials

## One-time setup

### 1. Clone and build

```bash
git clone <repo> /srv/food
cd /srv/food/server && npm ci
cd /srv/food/web    && npm ci && npm run build
# web/dist/ is now a static bundle. Point nginx / Caddy at it.
```

### 2. Configure the server

Create `/srv/food/server/.env`:

```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info

# Managed Postgres connection string. Must be reachable from the VPS.
DATABASE_URL=postgres://user:pass@host:5432/food_prod

# 32+ random chars. Generate with: openssl rand -base64 48
JWT_SECRET=<paste-48-random-bytes-here>
JWT_EXPIRES_IN=12h

# Exact origin the browser will send. No trailing slash, no wildcards.
CORS_ORIGIN=https://app.example.com
```

The server refuses to boot if `JWT_SECRET` is shorter than 32 chars or
`DATABASE_URL` is malformed — that guard is in `src/config/env.ts` and it
catches a lot of foot-guns.

### 3. Provisioning the database role (READ THIS)

Create the application role as a plain, non-superuser. The app connects as
this role via `DATABASE_URL`; every tenant-scoped query is gated by
`app.current_tenant_id` through RLS policies, and those policies are only
enforced when the connecting role lacks `BYPASSRLS`.

```sql
-- Run as a DBA role on the freshly provisioned database:
CREATE ROLE food_app LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE food_prod TO food_app;
GRANT USAGE ON SCHEMA public TO food_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO food_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO food_app;
-- audit_log is append-only: strip UPDATE/DELETE so even a compromised session
-- cannot tamper with the audit trail. (schema.sql also does this idempotently.)
REVOKE UPDATE, DELETE ON audit_log FROM food_app;
-- Future tables/sequences get the same grants automatically:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO food_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO food_app;
-- Verify: the following must print {f}, not {t}.
SELECT rolbypassrls FROM pg_roles WHERE rolname = 'food_app';
```

The schema is applied as the DBA role (next step), because DDL and RLS
policy creation require owner/superuser privileges. The running server
then uses `food_app` for every request.

Managed-Postgres shortcuts:
- **Neon / Supabase**: create a "read/write" or "app" role in the UI and
  verify it is not the owner/superuser. Default Neon roles are safe.
- **RDS**: the master user has `rds_superuser`, not `BYPASSRLS`, and is
  safe in a pinch, but still prefer a dedicated non-owner role.
- **Docker-compose**: the default `food` role in `docker-compose.yml` is a
  superuser. That is fine for dev, never for production.

### 4. Apply the schema

```bash
cd /srv/food/server
# Run this with DATABASE_URL temporarily pointed at the OWNER/DBA role,
# not food_app — DDL and CREATE POLICY require ownership. Flip the env var
# back to food_app before starting the server.
DATABASE_URL=postgres://owner:pass@host:5432/food_prod npm run db:migrate
```

Idempotent. Re-running is safe. It creates the `tenants`, `platform_users`,
and all business tables, enables row-level security, and backfills
`tenant_id` on any legacy rows.

### 5. Create the platform super-admin

This is **you**, the SaaS operator — not the restaurant.

```bash
npm run platform:create-admin -- \
  --email ops@example.com \
  --name "Ops"
```

The script prints a generated 24-char password **once**. Copy it into your
password manager immediately; there is no reset flow in v1.

You can now sign into the platform console at
`https://app.example.com/platform/login` and see an empty tenant list.

> The platform admin pool is deliberately isolated — no HTTP endpoint creates
> platform admins. If you need a second operator, SSH into the VPS and run
> this script again. Treat DB shell access and platform admin creation as the
> same privilege boundary.

### 6. Start the server

Pick any process supervisor. Systemd unit:

```ini
# /etc/systemd/system/food-server.service
[Unit]
Description=food server
After=network.target

[Service]
Type=simple
User=food
WorkingDirectory=/srv/food/server
EnvironmentFile=/srv/food/server/.env
ExecStart=/usr/bin/node --enable-source-maps dist/index.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

```bash
cd /srv/food/server && npm run build
sudo systemctl enable --now food-server
curl http://localhost:4000/healthz   # → {"status":"ok"}  (liveness)
curl http://localhost:4000/readyz    # → {"status":"ok"}  (readiness — DB probe)
```

### 7. Reverse proxy

Whatever you use (Caddy is the shortest path):

```caddy
app.example.com {
  encode gzip
  # `handle` (not `handle_path`) preserves the `/api` and `/ws` prefixes.
  # The server registers routes at `/api/v1/...` and `/ws/kds` literally;
  # stripping the prefix turns every request into a 404.
  handle /api/* {
    reverse_proxy localhost:4000
  }
  handle /ws/* {
    reverse_proxy localhost:4000
  }
  handle {
    root * /srv/food/web/dist
    try_files {path} /index.html
    file_server
  }
}
```

- `/api/v1/*` → Node server (prefix preserved)
- `/ws/kds`   → Node server, KDS WebSocket (prefix preserved)
- everything else → SPA shell, fall through to `index.html`

## Onboarding the friend's restaurant

### 1. Send them the signup URL

```
https://app.example.com/signup
```

On that page they fill in:
- Restaurant name (becomes the tenant name)
- Workspace slug (becomes `/t/<slug>/login` — auto-suggested from the name)
- Owner name, email, password
- First outlet name

Submitting creates the tenant + outlet + owner user in one transaction and
logs them in. They land on `/admin/welcome` — the onboarding wizard.

### 2. Walk them through the wizard

Do this over a voice call the first time. Three steps with live checkmarks:

1. **Create a category** (e.g. "Starters")
2. **Add an item** (e.g. "Paneer Tikka", ₹240, 5% GST)
3. **Add tables** (bulk: enter a count, hit go — creates `T1..TN`)

As soon as they have ≥ 1 category, ≥ 1 item, and ≥ 1 table, the gate opens
and they can access POS / KDS / admin. The gate is in `OnboardingGate` in
`web/src/pages/admin/index.tsx` — if any of those three checks fails it
keeps redirecting back to `/admin/welcome`.

### 3. Verify end-to-end in their actual kitchen

Per the locked decisions, this is non-negotiable:

- Take a real order on a tablet → KOT appears on the KDS screen within 1s
- Kitchen moves the KOT through states → POS reflects it live
- Generate a bill, apply a discount, collect cash + UPI, bill closes, order
  closes, table frees
- Open reports → the sale is visible in daily-sales, item-wise, tax-summary

Do one full service shift sitting in the corner watching. Don't leave until
you've seen at least 30 orders go through without staff calling you.

## Shipping the staff mobile app

The React Native app in `mobile/` ships via Expo Application Services (EAS).
It is the surface staff actually touch during service — the web app is for
admin work only. Every paired device runs the same binary; tenant isolation
happens at login time.

### One-time setup (per platform operator)

```bash
npm install -g eas-cli
cd /srv/food/mobile
npx expo login                 # or: eas login
npx expo install               # hydrates node_modules
eas init                       # writes extra.eas.projectId into app.json
```

`eas init` binds this source tree to an EAS project. Commit the resulting
`projectId` so subsequent builds on other machines don't create duplicate
projects.

### Point the build at your real API

`mobile/eas.json` sets `FOOD_API_BASE_URL` per profile. Edit the
`preview` and `production` entries to your actual origin (the same
`https://app.example.com` you configured for the web app) before building.
The value is baked into the bundle at build time via `app.config.js` — you
cannot change it after the fact without a new build.

### Build a preview APK for Android (friend's day-one path)

```bash
cd /srv/food/mobile
eas build --profile preview --platform android
```

EAS runs the build in the cloud and hands back a signed APK URL. Download
the APK, side-load it onto the friend's Android tablet (enable "install
from unknown sources" first), and you're done. No Play Store account
required for this flow.

### Build for TestFlight (iOS)

```bash
eas build --profile production --platform ios
eas submit --profile production --platform ios --latest
```

Requires an Apple Developer account ($99/yr) tied to the operator account
you logged in with. First submission takes ~24h of Apple review for
"TestFlight internal" distribution (internal testers skip external review);
after that, updates propagate in minutes.

### Pairing flow (for the manager, once the app is installed)

1. Manager opens the admin console on the web → Staff → click **Pair
   device** next to the staff member
2. A modal pops up with a QR code and an 8-character backup code; both
   expire in 10 minutes and can only be used once
3. Staff opens the mobile app (unpaired → Pair screen), scans the QR with
   the rear camera, or types the code manually
4. App labels itself ("Counter iPad"), stores a long-lived device token in
   the platform keychain, and calls `/auth/device-login` to mint a
   short-lived tenant JWT
5. On subsequent cold starts the app auto-logs-in from the stored device
   token — no re-pairing unless the admin revokes it

If a device is lost or stolen, the admin opens Staff → Devices → Revoke.
The next `/auth/device-login` call from that device returns 401 and the
app wipes its stored token and bounces back to the pair screen.

### App updates after the first build

Two choices:

- **Rebuild and resubmit** (safest): bump `expo.version` in `app.json`,
  run `eas build --profile production`, resubmit. Use this for any change
  that touches native code or `expo install`'d modules.
- **OTA update via EAS Update**: for pure JS/asset changes, `eas update
  --channel preview` (or `production`) pushes a new bundle to already-
  installed apps within seconds. Configure `eas update` separately — it's
  not wired in by default because we prefer explicit rebuilds for v1.

### Mobile smoke test before handing over

- Pair the device using a QR code from the web admin
- Pick a table, punch an order with variations + add-ons + notes, send to
  kitchen — KOT appears on the KDS within a second
- Generate the bill, record a cash payment, table frees up, order closes
- Open the bill PDF via the "View / share PDF" button, confirm it renders
  correctly in the system preview
- Tap "Call manager" — verify it arrives on the web admin (Phase B+ UI)
- (Manager/admin role only) open Stock → toggle an item to out of stock →
  confirm it disappears from the OrderScreen item grid

## Operating the SaaS

### Suspending a tenant

From the platform console → click the tenant → Suspend. Their users cannot
sign in after that point. Existing JWTs remain valid until they expire
(12h) — v1 has no server-side revocation. If you need immediate hard-kill,
rotate `JWT_SECRET` and restart the server, but that logs **everyone** out
including other tenants. Use suspend for normal cases.

### Backups

This is the **only** thing that matters operationally. A day of lost bills
is a day your friend stops speaking to you.

- Managed Postgres: turn on automated daily backups + point-in-time recovery
- Self-hosted Postgres: `pg_dump -Fc` on cron, ship to object storage,
  test restore once a month on a throwaway database

Everything else in this deployment is reproducible from source. The
database is not.

### Logs

Pino writes JSON to stdout. Either tail with journalctl (`journalctl -u
food-server -f`) or ship to a log collector. Every log line and every
`audit_log` row carries the `requestId` so you can trace a user-reported
issue back to the exact request.

### Upgrades

```bash
cd /srv/food
git pull
cd server && npm ci && npm run build && npm run db:migrate
cd ../web && npm ci && npm run build
sudo systemctl restart food-server
```

`schema.sql` must stay backward-compatible (additive migrations only) as
long as there is live tenant data. The migrate script applies the whole
file with `ON CONFLICT DO NOTHING` where idempotence matters; read
`src/db/migrate.ts` before shipping a schema change.

## Rollback

If v1 is wedged and you need to go back:

1. `systemctl stop food-server`
2. `git checkout <previous-tag>`
3. `cd server && npm ci && npm run build`
4. **Do not roll the database back.** Forward-compatible schema changes
   must keep working against the old binary. If they don't, restore from
   the last backup — that's why step 1 of this section exists.
5. `systemctl start food-server`

## Known v1 limitations (tell the friend before go-live)

- No printed bills or KOT printers — kitchen uses a tablet/monitor (KDS)
- No offline mode — the outlet needs reliable internet. A "last synced"
  indicator warns when connectivity drops.
- No self-service password reset — admin resets from the users page; if the
  owner is locked out, you (platform admin) reset via the `/users/:id/reset-password`
  endpoint after logging in as any other admin, or run a one-off SQL update
  against `users.password_hash`
- Payment gateway not integrated — UPI and card payments are marked "paid"
  manually. The friend reconciles UPI against their bank statement.
- No e-invoice/IRN — under ₹5 Cr turnover this is fine; over, we need a GSP
- Paid bills cannot be voided, only refunded. Refund marks the bill void and
  cancels the order (freeing the table). This is a deliberate audit choice.
- Reports are UTC — for late-night shifts that cross midnight, send explicit
  local-time ranges from the client. Timezone-aware boundaries are a
  follow-up.

## Provisioning checklist (print this)

- [ ] VPS up, Node 20, firewall allows 443 only
- [ ] Managed Postgres reachable, automated backups on
- [ ] `food_app` role created, `SELECT rolbypassrls FROM pg_roles WHERE rolname='food_app'` returns `f`
- [ ] `.env` populated, `DATABASE_URL` points at `food_app`, `JWT_SECRET` from `openssl rand -base64 48`
- [ ] `npm run db:migrate` succeeded (run as the DBA role, not `food_app`)
- [ ] `npm run platform:create-admin` run, password in password manager
- [ ] Signed into `/platform/login` successfully
- [ ] Systemd unit installed, `curl /healthz` → ok, `curl /readyz` → ok
- [ ] Caddy/nginx proxying `/api`, `/ws`, and serving `web/dist`
- [ ] TLS cert issued and auto-renewing
- [ ] Friend's tenant signed up via `/signup`
- [ ] Onboarding wizard completed with live data (not demo)
- [ ] `eas init` run in `mobile/`, projectId committed
- [ ] `FOOD_API_BASE_URL` in `mobile/eas.json` points at the real origin
- [ ] Preview APK built and installed on the friend's staff tablet
- [ ] Device paired end-to-end via QR from admin console
- [ ] One full service shift observed without incident
- [ ] Backup restore tested on a throwaway DB
