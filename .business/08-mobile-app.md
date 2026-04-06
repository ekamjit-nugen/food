# Mobile App — Food Staff

## Overview

Staff-facing mobile application for restaurant floor operations. Enables waiters and kitchen staff to manage tables, take orders, process billing, and manage stock from their mobile devices.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Expo + React Native | ~51.0.28 / 0.74.5 |
| Language | TypeScript | ~5.3.3 |
| Data Fetching | TanStack React Query | — |
| Navigation | React Navigation (native stack) | — |
| Camera | Expo Camera | QR code scanning |
| Secure Storage | Expo Secure Store | Credential persistence |
| Build System | EAS (Expo Application Services) | — |

## App Identity

- **App Name:** Food Staff
- **Bundle ID (iOS):** com.food.staff
- **Package (Android):** com.food.staff
- **Version:** 0.1.0

## Build Profiles

| Profile | Platform | API Target |
|---------|----------|-----------|
| Development | Android emulator | `http://10.0.2.2:4000` |
| Preview | iOS + Android | `https://app.example.com` |
| Production | iOS + Android | `https://app.example.com` |

## Screens

| Screen | Purpose |
|--------|---------|
| PairScreen | QR code scanning for device authentication |
| TablesScreen | View and manage dining tables |
| OrderScreen | Take and manage orders |
| BillScreen | Process billing and payments |
| StockScreen | Manage item stock/availability |

## Authentication Flow

```
1. Admin creates pairing code in web admin panel
2. QR code displayed on admin screen
3. Staff scans QR with mobile app camera
4. POST /api/v1/auth/pair → receives device token
5. Token stored in Expo Secure Store (encrypted)
6. Subsequent launches: POST /api/v1/auth/device-login
7. Token auto-expires after 1 year
8. Admin can revoke device from web panel
```

## Project Structure

```
mobile/
├── src/
│   ├── screens/
│   │   ├── PairScreen.tsx
│   │   ├── TablesScreen.tsx
│   │   ├── OrderScreen.tsx
│   │   ├── BillScreen.tsx
│   │   └── StockScreen.tsx
│   └── lib/
│       ├── api.ts (HTTP client)
│       ├── auth.ts (device token management)
│       ├── billing.ts (billing hooks)
│       ├── navigation.ts (stack config)
│       └── ... (other utilities)
├── app.json / app.config.js
├── eas.json
├── package.json
└── tsconfig.json
```

## Status

The mobile app exists in the codebase but is noted as "explicitly out of v1 scope" in the main README. It appears to be an active development effort beyond the documented v1 milestone.
