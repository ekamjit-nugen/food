# Technology Stack

## Server

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | ES modules, TypeScript |
| Language | TypeScript | 5.5.4 | Strict mode, fully typed |
| Framework | Express.js | 4.19.2 | HTTP server |
| Database | PostgreSQL | 16 | Primary data store with RLS |
| Auth | JWT + bcrypt | 9.0.2 / 5.1.1 | Stateless auth, cost-12 hashing |
| Validation | Zod | 3.23.8 | Schema parsing & validation |
| Real-time | ws | 8.18.0 | WebSocket for KDS |
| Logging | Pino | 9.3.2 | Structured JSON logging with redaction |
| Security | Helmet | 7.1.0 | HTTP security headers |
| Rate Limiting | express-rate-limit | 7.4.0 | Per-IP throttling |
| PDF | pdfkit | — | Bill & KOT PDF generation |
| Testing | Vitest + Supertest | 2.0.4 / 7.0.0 | Unit + integration tests |
| Dev Tools | tsx + dotenv | 4.16.2 / 16.4.5 | TS execution, env config |

## Web (Frontend)

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | React | 18.3.1 | UI framework |
| Language | TypeScript | 5.5.4 | Strict mode |
| Build Tool | Vite | 5.4.6 | Dev server, bundling |
| Routing | React Router DOM | 6.26.2 | Client-side routing |
| Data Fetching | TanStack React Query | 5.56.2 | Server state management |
| Styling | Tailwind CSS | 3.4.12 | Utility-first CSS (no component library) |
| QR Codes | QRCode.react | 4.2.0 | Device pairing QR generation |
| State | React Context | — | Auth state only; React Query for everything else |

## Mobile

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Expo + React Native | ~51.0.28 / 0.74.5 | Cross-platform mobile |
| Language | TypeScript | ~5.3.3 | Type safety |
| Data Fetching | TanStack React Query | — | Server state management |
| Navigation | React Navigation | — | Native stack navigation |
| Camera | Expo Camera | — | QR code scanning for device pairing |
| Secure Storage | Expo Secure Store | — | Credential storage |
| Build | EAS (Expo Application Services) | — | iOS & Android builds |

## Infrastructure

| Component | Technology | Details |
|-----------|-----------|---------|
| Database | PostgreSQL 16 | Row Level Security, triggers, custom functions, GUCs |
| Containerization | Docker Compose | Local dev environment |
| Money Model | BIGINT paise | 1 INR = 100 paise, tax in basis points (bps) |
| Multi-tenancy | RLS + Session GUCs | `app.current_tenant_id` per request |
| Audit | Append-only audit_log | RLS-enforced immutability |

## Architecture Pattern

```
Server: Layered Architecture
  Controllers → Services → Repositories → PostgreSQL (RLS)
  Middleware: auth, tenantDb, validate, audit, error, requestContext

Web: Single Page Application (SPA)
  React + React Query (no Redux/Zustand)
  Role-based route guards → Feature pages → API hooks → REST/WS backend

Mobile: Expo React Native
  Native stack navigation → Screens → API hooks → REST backend
```
