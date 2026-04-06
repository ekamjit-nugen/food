# Security Architecture

## Authentication

| Mechanism | Details |
|-----------|---------|
| JWT | Stateless tokens, configurable expiry (default 12h) |
| Password hashing | bcrypt cost 12 (~300ms per hash) |
| Password policy | 10-128 chars, must contain letter + digit |
| Device tokens | `<device_id>.<secret>` format, bcrypt-hashed secret |
| Pairing codes | 8-char code, SHA256 hashed, 10-min TTL |
| Token storage | Frontend: localStorage; Mobile: Expo Secure Store |
| Dual auth pools | Tenant JWT and Platform JWT are completely separate |

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Signup | 5 requests | per hour |
| Login | 10 requests | per 15 min |
| Device pairing | 20 requests | per 15 min |
| Device login | 60 requests | per 15 min |
| Accept invite | 20 requests | per 15 min |
| Change password | 5 requests | per 15 min |
| Platform login | 10 requests | per 15 min |

**Note:** In-memory rate limiters (process-local). Needs Redis for multi-instance deployments.

## Multi-Tenancy Isolation

```
Layer 1: Application → Every query filtered by tenant_id/outlet_id
Layer 2: Middleware  → tenantDb sets session GUC per request
Layer 3: PostgreSQL  → RLS policies enforce tenant_id match
Layer 4: In-Memory   → O(1) suspension check (no DB hit)
Layer 5: Startup     → Rejects connections if DB role has BYPASSRLS
```

**RLS Policy:**
```sql
(app.current_tenant_id = '' OR app.is_platform = 'on' OR tenant_id = app.current_tenant_id)
```

## Input Validation

- Zod schemas on every endpoint (body, query, params)
- Type coercion + narrowing
- UUID shape guards in middleware
- Money values as integers (never floats)
- No raw SQL interpolation (parameterized queries)

## HTTP Security

- **Helmet.js:** Security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CORS:** Strict origin checking (no wildcard in production)
- **Request IDs:** X-Request-Id for correlation (UUID format validated)

## Logging & Redaction

- **Structured JSON logs** via Pino
- **Redacted fields:** Authorization headers, passwords, secrets, PII in nested objects
- **Audit trail:** Immutable append-only log (RLS enforced, no UPDATE/DELETE)
- **Request correlation:** Every log entry tagged with request ID

## Database-Level Safeguards

| Safeguard | Purpose |
|-----------|---------|
| Foreign keys with ON DELETE RESTRICT | Prevent cascading deletes on critical data |
| Unique constraints per-outlet | Prevent duplicate categories, tables, etc. |
| No-double-billing trigger | Prevent same order item billed twice |
| CHECK constraints | Non-negative money values, max bounds |
| RLS FORCE on all tables | Even table owner is restricted |
| Audit log append-only | RLS + REVOKE prevents modification |

## Data Integrity

| Pattern | Implementation |
|---------|---------------|
| Optimistic locking | FOR UPDATE on concurrent-risk rows (draft items before KOT) |
| Snapshot isolation | Menu details frozen in order_items at order time |
| Soft deletes | is_active, is_void, revoked_at (preserves referential integrity) |
| Idempotent payments | idempotency_key UUID deduplicates retries |
| Append-only audit | Every mutation explicitly logged with before/after state |

## Graceful Shutdown

```
1. /readyz → 503 (load balancer drains traffic)
2. Close all WebSocket connections
3. server.close() (stop accepting new TCP connections)
4. Destroy idle keep-alive sockets, set Connection: close on in-flight
5. Wait for drain (10s hard timeout)
6. Close DB pool & exit
```
