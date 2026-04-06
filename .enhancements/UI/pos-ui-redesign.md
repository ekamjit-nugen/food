# Restaurant POS — Complete UI Redesign

## Document Info

| Field | Value |
|---|---|
| Version | 1.0.0 |
| Date | April 6, 2026 |
| Scope | Full visual redesign — Web (Next.js/React) + Mobile (React Native/Expo) |
| Goal | Modern, fast, restaurant-grade UI that staff love using under pressure |

---

## Table of Contents

1. [Design Direction](#1-design-direction)
2. [Design System Foundation](#2-design-system-foundation)
3. [Prompt 1: Design Tokens & Global Styles](#3-prompt-1-design-tokens--global-styles)
4. [Prompt 2: Auth Pages (Signup, Login, Accept Invite)](#4-prompt-2-auth-pages)
5. [Prompt 3: Onboarding Wizard](#5-prompt-3-onboarding-wizard)
6. [Prompt 4: POS Table Grid](#6-prompt-4-pos-table-grid)
7. [Prompt 5: POS Order Page & Cart](#7-prompt-5-pos-order-page--cart)
8. [Prompt 6: Kitchen Display System (KDS)](#8-prompt-6-kds)
9. [Prompt 7: Billing & Receipt](#9-prompt-7-billing--receipt)
10. [Prompt 8: Admin Layout & Sidebar](#10-prompt-8-admin-layout--sidebar)
11. [Prompt 9: Admin — Menu Management](#11-prompt-9-admin-menu-management)
12. [Prompt 10: Admin — Staff, Tables, Settings, Reports](#12-prompt-10-admin-staff-tables-settings-reports)
13. [Prompt 11: Platform Admin](#13-prompt-11-platform-admin)
14. [Prompt 12: Mobile — Pairing & Tables](#14-prompt-12-mobile-pairing--tables)
15. [Prompt 13: Mobile — Order & Bill](#15-prompt-13-mobile-order--bill)
16. [Prompt 14: Mobile — Stock Management](#16-prompt-14-mobile-stock)
17. [Execution Order](#17-execution-order)

---

## 1. Design Direction

### Who Uses This and When

This is NOT a marketing site or a dashboard viewed at leisure. This is a tool used by:

- **Waitstaff** standing at a table, taking orders on a tablet or phone, during a loud, hot, rushed dinner service. They need to tap 20 items in 30 seconds without misclicks.
- **Kitchen cooks** glancing at a screen mounted 3 feet away through steam and grease, needing to instantly see what to cook next and how long each ticket has been waiting.
- **Restaurant owners** checking end-of-day reports at midnight on their phone, tired, wanting to see revenue in 2 seconds and go to bed.
- **Admins** managing menus, staff, and settings in the morning before the restaurant opens, typically on a laptop.

### Design Principles

1. **Speed over beauty** — Every tap must feel instant. No gratuitous animations on POS/KDS screens. Transitions should be < 150ms. The system should feel like an extension of the user's hand.

2. **Readability at distance** — KDS text must be legible from 3-4 feet away. POS item names must be scannable at a glance. High contrast everywhere. No light gray text on white backgrounds.

3. **Touch-first, cursor-second** — All interactive elements minimum 44px touch target (Apple HIG). Generous spacing between tappable items. No hover-only interactions (everything must work on touch).

4. **Calm under pressure** — The UI should reduce stress, not add to it. Clear visual hierarchy. Obvious state changes. No ambiguity about what something does. Colors used for meaning (status), not decoration.

5. **Dark mode for KDS, Light mode for POS** — Kitchen screens need dark backgrounds (reduce glare, save energy on screens, easier on eyes in dim kitchens). POS and admin use light mode (readability in bright restaurants, matches paper receipts).

### Aesthetic

**Modern utilitarian with warmth.** Think: Square POS meets Linear meets a well-designed Japanese restaurant interior. Clean lines, purposeful whitespace, warm neutrals (not cold grays), pops of color only for status and actions. Typography that's confident and readable, not trendy.

**NOT**: Rounded candy-colored buttons (Toast POS), heavy gradients (generic SaaS), brutalist/raw (inappropriate for service industry), skeuomorphic (dated).

---

## 2. Design System Foundation

### Color Palette

```
— Brand —
Primary:        #E85D2A (warm orange — confident, appetizing, distinct)
Primary hover:  #D14E1E
Primary light:  #FFF3EE (for backgrounds, badges)

— Neutrals (warm-tinted, not cold gray) —
Gray 950:       #1A1814 (deepest — KDS background, dark UI)
Gray 900:       #262420 (dark surfaces)
Gray 800:       #3D3A35 (dark borders, secondary text on dark)
Gray 700:       #5C5850 (muted text on dark)
Gray 600:       #7A756C (disabled text)
Gray 500:       #9C9588 (placeholder text)
Gray 400:       #B5AFA5 (borders on light)
Gray 300:       #D4CFC7 (dividers)
Gray 200:       #E8E4DE (subtle backgrounds)
Gray 100:       #F4F2EE (page backgrounds)
Gray 50:        #FAF9F7 (card backgrounds)
White:          #FFFFFF

— Status —
Green:          #1A8F4A (free, success, in-stock, active)
Green light:    #ECFDF3
Amber:          #C27A15 (occupied, warning, in-progress, pending)
Amber light:    #FEF9EC
Red:            #D93025 (void, error, urgent, out-of-stock)
Red light:      #FEF2F1
Blue:           #2563EB (info, links, call-manager alert)
Blue light:     #EFF6FF
Violet:         #7C3AED (takeaway badge)
Violet light:   #F5F3FF

— KDS Column Colors (dark mode) —
KDS New:        #2A2520 (warm dark brown)
KDS Progress:   #2A2415 (warm dark amber tint)
KDS Ready:      #1A2A1E (warm dark green tint)
```

### Typography

```
— Web —
Headings:       "DM Sans", sans-serif (geometric, confident, excellent readability)
Body:           "DM Sans", sans-serif (same family for consistency in a utilitarian UI)
Mono:           "JetBrains Mono", monospace (for prices, codes, bill numbers)

— Mobile (React Native) —
Primary:        System default (San Francisco on iOS, Roboto on Android — best native feel)
Mono:           "JetBrains Mono" (for prices, codes)

— Scale (Web) —
xs:   0.75rem / 12px    (labels, badges)
sm:   0.8125rem / 13px  (secondary text, table cells)
base: 0.9375rem / 15px  (body text — slightly larger than default for readability)
lg:   1.125rem / 18px   (section headers, prominent text)
xl:   1.375rem / 22px   (page titles)
2xl:  1.75rem / 28px    (dashboard stat numbers)
3xl:  2.25rem / 36px    (KDS item text — readable from 3ft)

— KDS Scale (larger for distance reading) —
KDS body:    1.125rem / 18px
KDS heading: 1.375rem / 22px
KDS item:    1.25rem / 20px
KDS qty:     1.5rem / 24px (bold)
KDS timer:   1rem / 16px (mono)
```

### Spacing & Layout

```
— Base unit: 4px —
1:  4px     (micro gaps)
2:  8px     (tight padding)
3:  12px    (compact elements)
4:  16px    (standard padding)
5:  20px    (comfortable padding)
6:  24px    (section gaps)
8:  32px    (large gaps)
10: 40px    (section separation)
12: 48px    (page padding)
16: 64px    (major sections)

— Border radius —
sm:   6px   (buttons, inputs, badges)
md:   8px   (cards)
lg:   12px  (modals, larger cards)
xl:   16px  (page-level containers)
full: 9999px (pills, avatars)

— Shadows —
sm:   0 1px 2px rgba(26,24,20,0.05)
md:   0 2px 8px rgba(26,24,20,0.08)
lg:   0 4px 16px rgba(26,24,20,0.10)
xl:   0 8px 32px rgba(26,24,20,0.12)
focus: 0 0 0 3px rgba(232,93,42,0.25)  (focus ring — brand orange)
```

### Component Patterns

```
— Buttons —
Primary:     bg #E85D2A, text white, hover #D14E1E, rounded-sm, px-5 py-2.5, font-medium
             Active: scale(0.98) for tactile press feedback
Secondary:   bg white, border gray-300, text gray-900, hover bg gray-100
Danger:      bg white, border red-300, text red-700, hover bg red-50
Ghost:       bg transparent, text gray-700, hover bg gray-100
Icon button: w-10 h-10 (44px touch target), rounded-sm, flex center

— Inputs —
Height: 44px (touch-friendly)
Border: 1.5px gray-300, focus: border brand + focus ring
Background: white
Text: gray-900, placeholder gray-500
Label: sm, font-medium, gray-700, mb-1.5
Error: sm, red-600, mt-1

— Cards —
Background: white (light mode), gray-900 (dark mode)
Border: 1px gray-200 (light), gray-800 (dark)
Padding: 16-20px
Radius: md (8px)
Hover (if interactive): shadow-md, border-gray-300 transition

— Badges —
Padding: px-2.5 py-0.5
Font: xs, font-medium
Radius: full (pill)
Variants: green/amber/red/blue/violet/gray (bg light + text dark of each color)

— Tables (data) —
Header: bg gray-100, text gray-600, font-medium, uppercase, xs tracking-wide
Row: border-b gray-200, py-3
Hover: bg gray-50
Text: sm, gray-900

— Modals —
Overlay: bg black/50, backdrop-blur-sm
Container: max-w-md, bg white, rounded-lg, shadow-xl, p-6
Close: top-right icon button
Animation: fade-in + slight scale-up (150ms ease-out)

— Toast notifications —
Position: top-right, 16px from edge
Width: max-w-sm
Variants: success (green-left-border), error (red), info (blue), warning (amber)
Auto-dismiss: 4 seconds (with progress bar)
Animation: slide-in from right (200ms)
```

---

## 3. Prompt 1: Design Tokens & Global Styles

```
I need you to set up the design foundation for a Restaurant POS application. This is a complete visual overhaul — the current UI looks outdated and generic.

TECH STACK: Next.js with Tailwind CSS (web), React Native with Expo (mobile)

DESIGN DIRECTION: Modern utilitarian with warmth. Think Square POS meets Linear. Clean, fast, confident. NOT candy-colored, NOT brutalist, NOT generic SaaS.

STEP 1: TAILWIND CONFIGURATION

Update tailwind.config.ts with this custom theme (extend, don't replace):

Colors:
- brand: { DEFAULT: '#E85D2A', hover: '#D14E1E', light: '#FFF3EE', ring: 'rgba(232,93,42,0.25)' }
- surface: { page: '#F4F2EE', card: '#FAF9F7', white: '#FFFFFF' }
- warm: {
    50: '#FAF9F7', 100: '#F4F2EE', 200: '#E8E4DE', 300: '#D4CFC7',
    400: '#B5AFA5', 500: '#9C9588', 600: '#7A756C', 700: '#5C5850',
    800: '#3D3A35', 900: '#262420', 950: '#1A1814'
  }
- status: {
    green: '#1A8F4A', 'green-light': '#ECFDF3',
    amber: '#C27A15', 'amber-light': '#FEF9EC',
    red: '#D93025', 'red-light': '#FEF2F1',
    blue: '#2563EB', 'blue-light': '#EFF6FF',
    violet: '#7C3AED', 'violet-light': '#F5F3FF'
  }
- kds: { bg: '#1A1814', new: '#2A2520', progress: '#2A2415', ready: '#1A2A1E' }

Font family:
- sans: ['DM Sans', 'system-ui', 'sans-serif']
- mono: ['JetBrains Mono', 'monospace']

Font size: override defaults with the scale from the design system (base = 15px)

Border radius: sm: 6px, md: 8px, lg: 12px, xl: 16px

Box shadow: add 'focus-brand': '0 0 0 3px rgba(232,93,42,0.25)'

STEP 2: GOOGLE FONTS

Add DM Sans (400, 500, 600, 700) and JetBrains Mono (400, 500) via Google Fonts. Load in the Next.js layout or _app file. Use `next/font/google` for optimal loading:

```tsx
import { DM_Sans, JetBrains_Mono } from 'next/font/google';
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
```

STEP 3: GLOBAL CSS

Update globals.css:
- Set body: bg-surface-page, text-warm-900, font-sans, text-[15px], antialiased
- Selection color: brand-light bg with brand text
- Scrollbar styling: thin, warm-300 thumb, transparent track (webkit + firefox)
- Focus-visible: outline-none, ring with brand-ring color (all interactive elements)
- Smooth scroll only if user hasn't set prefers-reduced-motion
- Print styles: hide non-essential UI

STEP 4: BASE COMPONENT CLASSES

Create a utility layer in globals.css with @apply shortcuts (or just document the Tailwind classes to use — don't over-abstract):

- .btn-primary: bg-brand text-white font-medium px-5 py-2.5 rounded-sm hover:bg-brand-hover active:scale-[0.98] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50 disabled:cursor-not-allowed
- .btn-secondary: bg-white border border-warm-300 text-warm-900 font-medium px-5 py-2.5 rounded-sm hover:bg-warm-100 active:scale-[0.98] transition-all duration-150
- .btn-danger: bg-white border border-status-red/30 text-status-red font-medium px-5 py-2.5 rounded-sm hover:bg-status-red-light
- .btn-ghost: bg-transparent text-warm-700 font-medium px-4 py-2 rounded-sm hover:bg-warm-100
- .input-base: w-full h-11 px-3.5 border-[1.5px] border-warm-300 rounded-sm bg-white text-warm-900 placeholder:text-warm-500 focus:border-brand focus:ring-2 focus:ring-brand-ring transition-colors
- .badge: inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium

STEP 5: LAYOUT SHELL

Create or update the root layout component:
- Page background: bg-surface-page (warm off-white, NOT pure white, NOT cold gray)
- Content max-width: 1440px, centered, with responsive padding
- Transition between pages: subtle fade (opacity 0→1, 150ms)

After implementing, the entire app should have:
- Warm neutral tones instead of cold grays
- DM Sans typography everywhere
- JetBrains Mono for all prices, bill numbers, table codes, and timestamps
- Consistent focus rings (brand orange)
- 44px minimum touch targets on all interactive elements
- The "feel" of a premium, thoughtfully designed tool — not a generic Bootstrap app
```

---

## 4. Prompt 2: Auth Pages

```
Redesign all authentication pages for the Restaurant POS system. These are the first screens users see — they set the tone for the entire product.

PAGES TO REDESIGN:
1. /signup — Tenant signup
2. /login — Tenant login  
3. /accept-invite — Staff invitation acceptance

DESIGN DIRECTION: 
- Split layout: left side = form (white card on warm background), right side = brand illustration/gradient area (decorative, hidden on mobile)
- The form side should feel calm, spacious, and premium
- No clutter — only the fields that matter
- The brand side should feel warm and appetizing — use the brand orange (#E85D2A) as the dominant color with subtle patterns or a warm gradient

SIGNUP PAGE (/signup):

Layout:
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   ┌──────────────────┐  ┌────────────────────────┐  │
│   │                  │  │                        │  │
│   │   Logo (small)   │  │                        │  │
│   │                  │  │   Brand gradient area   │  │
│   │   "Create your   │  │   with subtle pattern  │  │
│   │    workspace"    │  │                        │  │
│   │                  │  │   Tagline:             │  │
│   │   [Form fields]  │  │   "Your restaurant,    │  │
│   │                  │  │    your way."          │  │
│   │   [Create btn]   │  │                        │  │
│   │                  │  │                        │  │
│   │   "Already have  │  │                        │  │
│   │    an account?"  │  │                        │  │
│   │                  │  │                        │  │
│   └──────────────────┘  └────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Form details:
- Card: bg-white, rounded-xl, shadow-lg, p-8 on desktop, full-width on mobile
- Logo: your app logo or just the app name in DM Sans 700
- Title: "Create your workspace" — text-xl, font-semibold, warm-900
- Subtitle: "Set up your restaurant in 2 minutes" — text-sm, warm-600
- Fields: use .input-base class, labels above fields (font-medium, text-sm, warm-700)
- Workspace URL field: show "/t/" prefix as a non-editable prepend inside the input (bg-warm-100 segment)
- Password: show/hide toggle icon inside the input
- Submit button: full-width .btn-primary, h-12 (larger than default for primary actions)
- "Already have an account? Sign in" — centered below form, text-sm, warm-600, with brand-colored link
- Field spacing: space-y-5 between fields

Brand side (right, hidden below lg breakpoint):
- Background: gradient from #E85D2A (top-left) to #D14E1E (bottom-right)
- Subtle food-related pattern overlay (very low opacity — think subtle geometric shapes or dots, NOT clip-art food images)
- Center-aligned tagline in white: "Your restaurant, your way." — text-2xl, font-semibold
- Optional: 3-4 small feature pills below tagline: "Menu setup in minutes", "Real-time KDS", "Works on any device"

Mobile (below lg):
- Form takes full width, no brand side
- Warm-100 background
- Brand color accent as a top bar or logo color

LOGIN PAGE (/login):
- Same split layout as signup
- Title: "Welcome back" 
- Subtitle: "Sign in to your workspace"
- Fields: Workspace URL (with /t/ prefix, only shown if no slug in URL), Email, Password
- Submit: "Sign in" — full-width .btn-primary
- "New here? Create a workspace" link below
- If slug is in URL: show "{slug}" as a badge above the form: "Signing in to {slug}"

ACCEPT INVITE PAGE (/accept-invite):
- Same split layout
- Title: "Join {tenantName}" (or "Join your team" if name not available)
- Subtitle: "Set your name and password to get started"
- Brand side: slightly different — show "You've been invited!" messaging
- Fields: Full name, Password
- Submit: "Join team"
- Error states: expired invite shows a distinct card (amber border, amber icon) with message and "Request a new invite" suggestion

TRANSITIONS & POLISH:
- Form fields should stagger-animate on page load (opacity 0→1, translateY 8px→0, 100ms delay between each)
- Submit button press: scale(0.98) for 100ms, then loading spinner replaces text
- Error messages: slide-in below the field (150ms, red text with red-light background pill)
- Success: brief checkmark animation before redirect

ACCESSIBILITY:
- All inputs have visible labels (not just placeholders)
- Focus order follows visual order
- Error messages linked to inputs via aria-describedby
- Submit button shows loading state with aria-busy
- Color contrast meets WCAG AA on all text

Don't just restyle — rebuild these pages with the new design system. Replace the existing page files entirely.
```

---

## 5. Prompt 3: Onboarding Wizard

```
Redesign the onboarding wizard at /admin/welcome. This is the user's first experience after signup — it should feel guided, encouraging, and fast.

CURRENT STATE: Three steps (Add Category, Add Item, Set Up Tables) shown as sequential cards.

NEW DESIGN:

Layout: centered single column, max-w-xl, with a progress indicator at top.

```
┌────────────────────────────────────────────┐
│                                            │
│   ● ─── ○ ─── ○       Step 1 of 3         │
│                                            │
│   "Welcome, Alex 👋"                       │
│   "Three quick steps to your first order." │
│                                            │
│   ┌────────────────────────────────────┐   │
│   │  ① Add a category                 │   │
│   │                                    │   │
│   │  Group your menu items             │   │
│   │  (e.g. Starters, Mains, Drinks)   │   │
│   │                                    │   │
│   │  [Category name          ]         │   │
│   │                     [Add →]        │   │
│   │                                    │   │
│   │  ✓ "Starters" added               │   │
│   │  ✓ "Mains" added                  │   │
│   │                                    │   │
│   │            [Continue →]            │   │
│   └────────────────────────────────────┘   │
│                                            │
│   "You can always edit everything later."  │
│                                            │
└────────────────────────────────────────────┘
```

PROGRESS INDICATOR:
- Three dots connected by lines at the top
- Current step: filled dot (brand orange), completed: filled dot (green), upcoming: hollow dot (warm-400)
- Step label: "Step 1 of 3" right-aligned, text-sm, warm-500
- The dots should have a subtle connecting line that fills with color as steps complete

STEP CARDS:
- Each step is a card that expands when active and collapses when complete
- Active card: white bg, border-brand (left border accent, 3px), shadow-md, p-6
- Completed card: warm-50 bg, no shadow, p-4, checkmark icon, collapsed to single line showing "✓ Category added: Starters"
- Locked card: warm-100 bg, opacity-60, lock icon, "Complete the step above first"

STEP 1 — CATEGORY:
- Inline form: text input + "Add" button in a row
- After adding: show the added category as a small chip below (green-light bg, green text, "✕" to remove)
- Allow adding multiple categories (unlike current single-add)
- "Continue" button appears after at least 1 category added
- Animation: chip slides in from left when added

STEP 2 — FIRST ITEM:
- Category dropdown (from step 1 categories), Item name, Price (with ₹ prefix)
- Price input: monospace font (JetBrains Mono), right-aligned text
- "Add" button
- After adding: show the item as a small card (name + price)
- "Continue" button after at least 1 item

STEP 3 — TABLES:
- "How many tables?" number input with large +/- buttons (easy touch targets)
- Default: 8
- Preview text: "We'll create T1 through T{N} — you can rename them later."
- "Create {N} tables" button

COMPLETION:
- All three steps collapse to show checkmarks
- Confetti-like particle burst (subtle, 1-second, CSS only — brand orange + green particles)
- Large "Start using the POS →" button (brand, h-14, rounded-lg)
- The button should have a subtle shimmer/glow animation to draw attention

Make this feel like a 60-second setup that respects the user's time.
```

---

## 6. Prompt 4: POS Table Grid

```
Redesign the POS table selection page at /pos. This is the most-used screen — staff open it dozens of times per shift to see which tables are free and where to seat guests.

DESIGN GOALS:
- Instant visual scan: staff must see table status in < 1 second
- Large touch targets: each table card must be easy to tap on a tablet
- Status jumps out: Free (green) and Occupied (amber) must be unmistakable

LAYOUT:

```
┌──────────────────────────────────────────────────────┐
│  Tables                        [+ New takeaway]      │
│                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  T1     │ │  T2     │ │  T3     │ │  T4     │   │
│  │         │ │         │ │         │ │         │   │
│  │  Free   │ │ Ord #12 │ │  Free   │ │ Ord #15 │   │
│  │  4 seats│ │  4 seats│ │  2 seats│ │  6 seats│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  T5     │ │  T6     │ │  T7     │ │  T8     │   │
│  │         │ │         │ │         │ │         │   │
│  │  Free   │ │  Free   │ │ Ord #18 │ │  Free   │   │
│  │  2 seats│ │  4 seats│ │  4 seats│ │  2 seats│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│                                                      │
│  ── Open takeaway orders ──                          │
│  ┌──────────┐ ┌──────────┐                           │
│  │ #14 Raj  │ │ #16 Priya│                           │
│  │ TAKEAWAY │ │ TAKEAWAY │                           │
│  └──────────┘ └──────────┘                           │
└──────────────────────────────────────────────────────┘
```

HEADER:
- Title: "Tables" — text-xl, font-semibold
- Right side: "+ New takeaway" button — .btn-primary with a subtle violet accent (since takeaway uses violet badges)
- Below title (optional): live clock showing current time (useful for shift context)

TABLE CARDS:
- Grid: responsive — 2 cols on phone, 3 on tablet, 4 on small desktop, 5 on wide
- Card size: aspect-square (1:1 ratio on mobile/tablet) or fixed height (120px) on desktop
- Min card width: 140px
- Card padding: 16px

Free table card:
- Background: white with a LEFT BORDER accent (4px, status-green)
- Table code: text-lg, font-bold, warm-900 (e.g., "T1")
- Label (if set): text-xs, warm-500 (e.g., "Window")
- Status: "Free" — badge, green-light bg, green text
- Seats: text-xs, warm-500, "4 seats"
- Hover: shadow-md, border-warm-300
- Click: navigate to new order

Occupied table card:
- Background: white with LEFT BORDER accent (4px, status-amber)
- Table code: text-lg, font-bold
- Order badge: "Order #12" — amber-light bg, amber text
- Timer (optional, nice touch): how long the table has been occupied — "45m" in warm-500
- Seats: text-xs, warm-500
- Hover: shadow-md
- Click: navigate to existing order

TAKEAWAY SECTION:
- Only visible if open takeaway orders exist
- Section header: "Open takeaway orders" — text-sm, font-medium, warm-600, with a thin divider line
- Cards: similar to table cards but with violet left border and "TAKEAWAY" badge (violet-light bg, violet text)
- Show: order number + customer name (if provided)

"+ NEW TAKEAWAY" BUTTON:
- Position: top-right in the header
- Style: .btn-primary but consider using a slightly different color (violet-600?) to visually separate from table actions. Or keep brand orange but add a takeaway icon.

EMPTY STATE:
- If no tables exist: centered message "No tables set up yet" with a link to /admin/tables
- If all tables free and no takeaways: just show the grid (no special state needed)

REAL-TIME UPDATES:
- When a table status changes (via order creation/completion), the card should transition smoothly:
  - Free → Occupied: left border color animates green → amber (300ms), badge fades in
  - Occupied → Free: reverse animation
- No jarring full-page rerender

POLISH:
- Cards should have a very subtle entrance animation on page load (stagger, fade-up, 30ms delay between each)
- The entire page should feel like a "mission control" — calm, organized, everything visible at once
- No scrolling on a standard tablet in landscape with 8-12 tables (cards must be compact enough)
```

---

## 7. Prompt 5: POS Order Page & Cart

```
Redesign the POS order page at /pos/order/new and /pos/order/:id. This is where staff spend 80% of their time during service — adding items, adjusting quantities, and sending to kitchen.

DESIGN GOALS:
- Speed: adding an item to the cart should take exactly 1 tap (simple items) or 3 taps (item with options)
- Visibility: the cart must always be visible alongside the menu (split view)
- Clarity: the cart must clearly separate "already sent" from "new items"

LAYOUT (Desktop/Tablet landscape — 2-column):

```
┌──────────────────────────────────────────────────────────────┐
│  ← Tables    New order · T3 (Window)              [Bill]    │
├────────────────────────────────┬─────────────────────────────┤
│                                │                             │
│  [Search items...        🔍]   │  CART                       │
│                                │                             │
│  ┌──────┐┌──────┐┌──────┐     │  ── Already sent ──         │
│  │Start-││Mains ││Drinks│     │  2× Paneer Tikka    ₹240   │
│  │ers   ││ ●    ││      │     │  1× Dal Makhani     ₹180   │
│  └──────┘└──────┘└──────┘     │                             │
│                                │  ── New items ──            │
│  ┌────────────┐┌────────────┐ │  1× Butter Naan      ₹60   │
│  │            ││            │ │     [−] [1] [+]             │
│  │ Paneer     ││ Butter     │ │  2× Masala Chai      ₹80   │
│  │ Tikka      ││ Chicken    │ │     [−] [2] [+]             │
│  │ ₹240       ││ ₹320       │ │                             │
│  │            ││  OPTIONS   │ │  ─────────────────────       │
│  └────────────┘└────────────┘ │  New items: ₹200            │
│                                │                             │
│  ┌────────────┐┌────────────┐ │  [  Send to kitchen  ]      │
│  │ Dal        ││ Garlic     │ │                             │
│  │ Makhani    ││ Naan       │ │                             │
│  │ ₹180       ││ ₹50        │ │                             │
│  └────────────┘└────────────┘ │                             │
│                                │                             │
└────────────────────────────────┴─────────────────────────────┘
```

LEFT COLUMN — MENU PICKER:

Header bar:
- Back link: "← Tables" (warm-600, hover underline)
- Title: "New order · T3" or "Order #12 · T3 (Window)" — font-semibold
- "Bill" button: right side, .btn-secondary (only for existing orders)

Search bar:
- Full width of left column
- Height: 44px, rounded-sm, warm icon
- Placeholder: "Search items..."
- Live filter across all categories
- When active: show results below, hiding category tabs temporarily
- Clear button (×) on right when text entered

Category tabs:
- Horizontal scrollable row of pill buttons (NOT vertical stack — horizontal is faster for scanning)
- Selected: bg-warm-900, text-white
- Unselected: bg-white, border-warm-300, text-warm-700
- Height: 40px, px-4
- Scroll behavior: smooth horizontal scroll with no scrollbar visible
- First category auto-selected on load

Item grid:
- 2 columns (tablet), 3 columns (desktop wide)
- Card: bg-white, border-warm-200, rounded-md, p-3
- Item name: font-medium, text-sm, warm-900 (2 lines max, truncate)
- Price: font-mono (JetBrains Mono), text-sm, warm-600, "₹240"
- "OPTIONS" badge: tiny pill (text-[10px]) in amber if item has variations/addons
- Out of stock: opacity-40, "Out of stock" overlay text, cursor-not-allowed
- Tap on simple item: instantly adds to cart (no modal). Brief green flash on the card (150ms) as feedback.
- Tap on item with options: opens LineEditor modal

Takeaway fields (only for takeaway orders):
- Above the search bar: compact row with "Customer" and "Phone" inputs side by side
- Smaller inputs (h-9) to save space
- Optional fields — no asterisks

RIGHT COLUMN — CART:

Width: 320px (fixed) on desktop, slides up as bottom sheet on mobile portrait

Background: white, left border: 1px warm-200

Section: "Already sent" (existing orders only):
- Header: "ALREADY SENT" — text-xs, uppercase, tracking-wide, warm-500
- Items: compact list, text-sm, warm-600 (muted — these are done)
- No quantity controls (can't modify sent items from here)

Section: "Pending drafts" (if unsent server drafts exist):
- Background: amber-light, left border: 3px amber
- Header: "PENDING DRAFTS · not yet sent" — text-xs, amber-700
- "Send pending" button: .btn-secondary with amber accent

Section: "New items" (local cart):
- Header: "NEW ITEMS" — text-xs, uppercase, tracking-wide, warm-500
- Empty state: "Tap menu items to add." — text-sm, warm-400, italic
- Each line:
  - Name: text-sm, font-medium, warm-900
  - Variation (if any): text-xs, warm-500, "(Half)"
  - Addons (if any): text-xs, warm-500, "+cheese, +sauce"
  - Notes (if any): text-xs, italic, amber-700, "no onions"
  - Price: font-mono, text-sm, warm-900, right-aligned, "₹240"
  - Quantity controls: [−] [qty] [+] — compact inline (h-7 w-7 buttons), warm-900 text
  - Tap on the line item text to edit (reopen LineEditor)
  - Removing last quantity (−) removes the line with a slide-out animation

Subtotal:
- Divider line (warm-200)
- "New items subtotal" — text-sm, warm-600
- Amount — font-mono, font-semibold, warm-900
- Right-aligned

Send button:
- Full width of cart column
- .btn-primary, h-12, rounded-sm
- "Send to kitchen" with a small arrow or kitchen icon
- Disabled state: opacity-50, "Add items to send"
- Loading state: spinner + "Sending..."
- After successful send: brief green checkmark flash, then button resets

LINE EDITOR MODAL:

Trigger: tap on item card with variations/addons

Modal: slide-up from bottom (mobile) or center modal (desktop)
- Max-height: 85vh (mobile), max-w-md (desktop)
- Header: item name (font-semibold, text-lg) + base price (font-mono, warm-500)

Sections:
- VARIATION (if any): horizontal chips, single-select. Selected: bg-warm-900, text-white. Show price delta: "+₹40" or "−₹20"
- ADD-ONS (if any): checkbox list, each with name + "+₹30" (font-mono)
- NOTES: textarea, 2 rows, placeholder "e.g. no onions"
- QUANTITY: large ± buttons (h-10 w-10), number display (text-xl, font-mono, font-bold)
- LINE TOTAL: text-lg, font-bold, font-mono, right-aligned

Footer buttons:
- "Cancel" (.btn-ghost) | "Add to cart" (.btn-primary)

MOBILE (portrait — single column with bottom sheet):
- Menu picker takes full screen
- Cart is a persistent bottom bar showing: "{N} items · ₹{total}" with "View cart ↑" button
- Tapping "View cart" slides up a bottom sheet with the full cart
- "Send to kitchen" button at bottom of the sheet
```

---

## 8. Prompt 6: KDS

```
Redesign the Kitchen Display System at /kds. This screen runs on a wall-mounted display or a tablet propped up in the kitchen. Cooks glance at it from 3-4 feet away through steam and chaos.

DESIGN GOALS:
- DARK MODE (reduces glare, saves energy on displays, easier on eyes in dim kitchens)
- LARGE TEXT (readable from 3+ feet away)
- OBVIOUS STATUS (new = urgent, in-progress = being made, ready = pick up)
- MINIMAL CHROME (no sidebar, no header navigation — just the board)

LAYOUT:

```
┌──────────────────────────────────────────────────────────────┐
│  ● Live    5 active                           Fri 9:42 PM   │
├──────────────────┬──────────────────┬────────────────────────┤
│  NEW (2)         │  IN PROGRESS (2) │  READY (1)            │
│  ┌────────────┐  │  ┌────────────┐  │  ┌────────────────┐   │
│  │ KOT #24    │  │  │ KOT #22    │  │  │ KOT #21        │   │
│  │ T3 · #12   │  │  │ T1 · #10   │  │  │ T5 · #15       │   │
│  │ ⏱ 02:34   │  │  │ ⏱ 08:12   │  │  │ ⏱ 12:45       │   │
│  │            │  │  │            │  │  │                │   │
│  │ 2× Pan Tik │  │  │ 1× Butter  │  │  │ 3× Masala Chai │   │
│  │ 1× Dal Mak │  │  │    Chicken │  │  │                │   │
│  │   +cheese  │  │  │    Half    │  │  │  [ Served ✓ ]  │   │
│  │   no onion │  │  │ 2× Naan   │  │  │                │   │
│  │            │  │  │            │  │  └────────────────┘   │
│  │ [ Start → ]│  │  │ [Ready ✓] │  │                        │
│  └────────────┘  │  └────────────┘  │                        │
│                  │                  │                        │
│  ┌────────────┐  │  ┌────────────┐  │                        │
│  │ KOT #25    │  │  │ KOT #23    │  │                        │
│  │ TA · #14   │  │  │ T7 · #18   │  │                        │
│  │ ⏱ 00:45   │  │  │ ⏱ 05:20   │  │                        │
│  │ ...        │  │  │ ...        │  │                        │
│  └────────────┘  └──────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

OVERALL:
- Background: kds-bg (#1A1814 — warm black)
- No sidebar, no navigation links, no user avatar — this is a dedicated display
- Full viewport height, no scrolling on the overall page (columns scroll independently)
- Header: minimal, single row

HEADER:
- Left: connection indicator — green dot + "Live" (green text) or amber dot + "Reconnecting..." (amber text)
- Left: "{N} active" — count of non-served KOTs
- Right: current time (updates every second) — font-mono, warm-400
- Background: warm-950, border-b warm-800
- Height: 48px

THREE COLUMNS:
- Equal width (33.33%)
- Each column scrolls independently (overflow-y: auto, custom scrollbar: thin, warm-800)
- Column headers: sticky top, inside the column

Column header style:
- "NEW (2)" — uppercase, tracking-wide, font-semibold
- NEW column header: text-warm-300
- IN PROGRESS header: text-amber (status-amber)  
- READY header: text-green (status-green)
- Subtle bottom border in the column's accent color
- Count in parentheses updates live

KOT CARDS:
- Background: kds-new (#2A2520) for New, kds-progress (#2A2415) for In Progress, kds-ready (#1A2A1E) for Ready
- Border: 1px warm-800 (subtle), left border accent: 3px in column color (warm-400 for new, amber for progress, green for ready)
- Border-radius: 8px
- Padding: 16px
- Margin-bottom: 12px
- Width: fill column minus padding

Card header:
- "KOT #24" — font-semibold, text-lg, warm-100
- "T3 · Order #12" — text-sm, warm-400 (table + order context)
- "TA · Order #14" for takeaway — with violet badge "TAKEAWAY" (text-[10px])
- Timer: "⏱ 02:34" — font-mono, text-sm
  - < 5 min (or kotWarningMinutes): text-warm-400 (normal)
  - 5-10 min: text-amber (warning, slightly pulsing glow)
  - > 10 min: text-red (urgent, pulsing glow, more prominent)
  - Timer colors should use the KOT timing settings from tenant settings

Card items:
- Each item: "{qty}× {name}" — text-base (18px), warm-100
- Quantity: font-bold, font-mono
- Variation: text-sm, warm-400, indented, "(Half)"
- Addons: text-sm, warm-400, indented, "+cheese"
- Notes: text-sm, italic, amber-300, indented, "no onions"
- Voided items: strikethrough, opacity-40

Card action button:
- Full width of card, at bottom
- NEW column: "Start →" — bg-warm-800, text-warm-200, hover:bg-warm-700
- IN PROGRESS column: "Ready ✓" — bg-amber/20, text-amber, hover:bg-amber/30
- READY column: "Served ✓" — bg-green/20, text-green, hover:bg-green/30
- All buttons: h-11, rounded-sm, font-medium, active:scale-[0.97]

VOID BUTTON:
- Only visible to admin/manager roles
- Small text button below the action button: "Void" — text-xs, text-red/60, hover:text-red
- Opens void modal (dark-themed modal matching KDS aesthetic)

EMPTY COLUMN:
- Centered text: "No tickets" — text-warm-600, italic

NEW KOT ALERT:
- When a new KOT arrives via WebSocket:
  1. Brief screen-edge flash (brand-orange glow around the entire viewport border, 500ms)
  2. Alert sound (Web Audio API — short bell chime)
  3. New card slides in from top with a brief highlight animation (warm-700 bg → normal bg, 1 second)
- If KOTs sit in "NEW" for > 2 minutes without being started: repeat the alert sound every 60 seconds

STATUS TRANSITION ANIMATION:
- When "Start" is clicked: card slides out of NEW column (fade + slide right), appears in IN PROGRESS (fade + slide in from left)
- When "Ready" is clicked: same animation between columns
- When "Served" is clicked: card fades out and slides down (removed from board)
- All transitions: 300ms ease

RESPONSIVE:
- On a tablet: 3 columns still fit (smaller padding)
- On a phone (unlikely but possible): switch to a single column with tabs: "New | In Progress | Ready"

Make the KDS feel like a live mission control board. Every KOT is a mission. The timer creates gentle urgency. The cook should never have to think about what to do next.
```

---

## 9. Prompt 7: Billing & Receipt

```
Redesign the billing page at /pos/order/:id/bill and the receipt page at /pos/order/:id/receipt.

BILLING PAGE:

Layout: 2-column on desktop, single column on mobile

Left column — Bill view:
- Header: "Bill #42" with status badge (OPEN=amber, PAID=green, VOID=red strikethrough)
- "Print receipt" link: text-sm, brand color, with printer icon

Items table:
- Clean table with warm-100 header row
- Columns: Item (left), Qty (center), Unit (right, mono), Total (right, mono)
- Variation shown in parentheses after item name, warm-500
- Line discounts: shown below the item in amber text, "−₹20 · loyalty discount"
- Voided items: strikethrough, opacity-40
- Table rows: compact (py-2.5), border-b warm-100

Totals section:
- Right-aligned, below items table
- Each line: label (warm-600) .... amount (mono, warm-900)
- Discount lines: in red, "−₹50"
- Tax lines: CGST and SGST separately
- Round off: only if non-zero
- TOTAL: larger text (text-lg), font-bold, border-t-2 warm-300
- Paid: green text
- OUTSTANDING: if unpaid — large, font-bold, amber text, with amber-light bg pill

Right column — Record Payment (only when outstanding > 0):
- Card with warm-50 bg, border-warm-200
- Title: "Record payment" — font-semibold
- Method selector: 4 cards in a 2×2 grid (not buttons — cards with icon + label)
  - Cash (banknote icon), UPI (phone icon), Card (credit-card icon), Other (dots icon)
  - Selected: border-brand, bg-brand-light
  - Unselected: border-warm-200, bg-white
- Amount field: large input (h-14), font-mono, text-xl, pre-filled with outstanding, ₹ prefix
- Reference field: only shown for UPI/Card/Other, smaller input
- "Record ₹{amount}" button: .btn-primary, full width, h-12

Payment confirmation modal:
- Clean, centered, max-w-sm
- Show: method icon, amount (large, mono, bold), reference (if any)
- "Cancel" and "Confirm" buttons

Payments list (below bill or in a section):
- Each payment: method badge + amount (mono) + reference (if any)
- Voided payments: strikethrough, red text

Settled state:
- Green success card: "✓ Bill paid in full" — bg-green-light, border-green, green text
- "Back to tables" button: .btn-primary

Supervisor actions (admin/manager only):
- Below the bill, separated by a divider
- Buttons: "Apply discount" (.btn-ghost), "Void bill" (.btn-danger), "Refund" (.btn-danger)
- Each opens the respective modal

RECEIPT PAGE:
- Minimal chrome — designed for printing
- "← Back to bill" and "Print / Save PDF" buttons in a top bar (hidden in print)
- Receipt content: thermal-printer optimized (narrow width, monospace alignment for numbers)
- Use the new header format with GSTIN, address, FSSAI from settings
- Clean alignment: item names left, prices right, using dots or spaces for alignment
- Total section: bold, larger text, separated by dashes
- Footer: receipt footer text from settings, "Thank you"
```

---

## 10. Prompt 8: Admin Layout & Sidebar

```
Redesign the admin layout shell — the sidebar navigation and page container that wraps all /admin/* pages.

DESIGN:

SIDEBAR:
- Width: 240px (desktop), collapsible to 64px (icon only) with a toggle button
- Background: white, right border: 1px warm-200
- Position: fixed left, full height

Sidebar header:
- Restaurant name (truncated if long), font-semibold, text-sm
- Outlet name below (if multi-outlet), text-xs, warm-500
- Outlet switcher dropdown (if multi-outlet)

Navigation links:
- Each link: h-10, px-3, rounded-sm, text-sm, font-medium
- Icon (20px) + label
- Default: text-warm-600, hover: bg-warm-100, text-warm-900
- Active: bg-brand-light, text-brand, font-semibold, with a left border accent (3px brand)
- Transition: bg-color 150ms

Link groups:
```
POS
  → Tables (grid icon)
  → Orders (list icon) [if order history page exists]

MENU
  → Items (utensils icon)
  → Categories (folder icon)

TEAM
  → Staff (users icon)

REPORTS
  → Reports (chart icon)

SETTINGS (bottom section, separated by divider)
  → Tables (layout icon)
  → Settings (gear icon)
```

- Divider between groups: 1px warm-200 with 12px vertical margin
- Settings group: pushed to bottom of sidebar with a divider

Sidebar footer:
- User section: avatar (initials circle, 32px, bg-warm-200) + name + role badge
- "Sign out" link: text-xs, red-600, hover:text-red-700

Collapsed state:
- Only icons visible, centered
- Tooltip on hover showing the label
- Toggle button: small arrow icon at the bottom of sidebar

CONTENT AREA:
- Left padding: sidebar width (240px or 64px)
- Top padding: 0 (no top bar — sidebar handles navigation)
- Page padding: px-8 py-6 (comfortable spacing)
- Max content width: 1200px for admin pages (not full-width — too wide is hard to read)
- Background: surface-page (#F4F2EE)

PAGE HEADER PATTERN:
- Every admin page follows: Title (text-xl, font-semibold) + optional subtitle (text-sm, warm-500) + action button (top-right)
- Consistent spacing below header: mb-6

RESPONSIVE:
- Below lg: sidebar becomes a top navigation bar or hamburger menu
- Mobile: full-width content, hamburger icon top-left opens slide-out sidebar overlay

Apply this layout to ALL /admin/* pages. The POS pages (/pos/*) and KDS (/kds) should NOT have this sidebar — they have their own minimal chrome.
```

---

## 11. Prompt 9: Admin — Menu Management

```
Redesign the menu management pages: /admin (items) and /admin/categories.

CATEGORIES PAGE (/admin/categories):

- Page title: "Categories" + "+ New category" button (top-right, .btn-primary)
- Data table with columns: Name, Description (truncated), Display order, Status (Active/Inactive badge), Actions
- Table style: clean, warm-100 header, hover rows, compact
- Actions: "Edit" (ghost button), "Deactivate" (ghost button, red text)
- Empty state: centered illustration + "No categories yet" + "Create your first category" button

Category modal (create/edit):
- Clean modal, max-w-md
- Fields: Name (autofocus), Description (textarea, 2 rows), Display order (number)
- Edit mode adds: Active toggle switch
- Save button: .btn-primary

ITEMS PAGE (/admin):

- Page title: "Menu items" + "+ New item" button (disabled with tooltip if no categories)
- Filter bar: category dropdown filter + search input + status filter (All/Active/Inactive)
- Data table: Name, Category (badge), Price (mono), Status (Active/Inactive), In stock (toggle), Actions

In-stock toggle:
- Custom toggle switch (not a checkbox): green = in stock, red = out of stock
- Optimistic update — toggles immediately, rolls back on error
- Small "In stock" / "Out of stock" label next to the toggle

Item modal (create/edit):
- Larger modal: max-w-lg (more fields)
- Organized in sections with subtle dividers:
  1. BASIC INFO: Category dropdown, Name, Description, Price (₹ prefix, mono), Tax rate (%)
  2. VARIATIONS: repeatable rows (name + price delta), "+ Add variation" link
  3. ADD-ONS: checkbox grid of available addons with prices
  4. STATUS: In stock toggle, Active toggle (edit only)
- Price input: right-aligned, mono font, ₹ prefix as input prepend
- Tax rate: show helper "Common: 5% (non-AC), 18% (AC dining)"
- Variations: compact rows with "×" remove button per row
- Addons: 2-column grid of checkboxes with addon name + price

Make the menu management feel organized and fast. Restaurant owners often update 20+ items in one sitting (price changes, stock updates, new seasonal items).
```

---

## 12. Prompt 10: Admin — Staff, Tables, Settings, Reports

```
Redesign the remaining admin pages. Follow the same admin layout and design patterns established in the previous prompts.

STAFF PAGE (/admin/staff):

- Page title: "Staff" + "Invite teammate" button (top-right, .btn-primary, admin only)
- Data table: Name (with "Owner" badge if applicable), Email, Role (badge: admin=warm-900, manager=blue, staff=green, kitchen=amber), Status (Active/Deactivated), Last login (relative time), Devices (count), Actions
- Sort: owners first, then by role weight, then alphabetical
- Actions column (admin only): "Manage devices" (ghost), "Deactivate"/"Reactivate" (ghost, red/green)
- Deactivated rows: warm-200 bg, muted text
- "Show deactivated" toggle filter at top

Invite modal:
- Fields: Email (autofocus), Full name (optional), Role (3 cards: Staff, Kitchen, Manager — each with icon + description)
- Role cards: single-select, selected: border-brand + bg-brand-light
  - Staff: "POS access, order taking" 
  - Kitchen: "Kitchen display only"
  - Manager: "Staff management + reports"
- Submit: "Create invite"

Invite success card:
- Replaces the modal content (don't close and open a new thing)
- Green-tinted card with: "Invite created for {email}", expiry date, invite link (in dev mode) with copy button
- "Done" button dismisses

Devices modal:
- Title: "Devices for {name}"
- "Pair a new device" button → shows QR code + manual code in a card
- Active devices list: device label, platform icon (phone), last seen (relative)
- "Revoke" button per device (red ghost, confirmation dialog)
- Revoked devices: grayed section below

TABLES PAGE (/admin/tables):

- Page title: "Tables" + "+ Add table" button
- "Show deactivated" toggle
- Data table: Code (mono, bold), Label, Seats, Status (Active/Inactive badge), Current order (link or "—"), Actions
- Actions: "Edit" (ghost), "Deactivate"/"Activate" (ghost)
- Add/Edit modal: Code (mono input), Label, Seats, Display order

SETTINGS PAGE (/admin/settings):

- Already built in Blocker 7, but apply the new design system:
- Sections with clear headings, descriptions, and independent save buttons
- Inputs: use .input-base class
- GSTIN/FSSAI/PIN fields: mono font
- Indian states dropdown: searchable
- Save buttons: .btn-primary per section, not one giant save at bottom
- Section cards: bg-white, rounded-lg, p-6, shadow-sm

REPORTS PAGE (/admin/reports):

- Page title: "Reports"
- Scope toggle: 2 segment buttons ("This outlet" / "All outlets") — same style as category tabs
- Date range: from/to date inputs, side by side, with quick presets: "Today", "Yesterday", "This week", "This month", "Last month"
- Quick presets: small ghost buttons above the date inputs

Tab navigation:
- 5 tabs: Daily sales, Item-wise, Category-wise, Tax summary, Order master
- Tab style: bottom-border active indicator (2px brand), not filled tabs
- Active: font-semibold, brand color border
- Inactive: warm-600, hover: warm-900

Stat cards (Daily sales tab):
- 4 cards in a row: Bills count, Revenue, Tax collected, Discounts
- Each card: bg-white, rounded-md, p-4, shadow-sm
- Big number (text-2xl, mono, font-bold) + label below (text-xs, warm-500)
- Revenue: green text. Discounts: red text.

Data tables:
- Same clean table style as other admin pages
- "Download CSV" button (per tab, top-right): .btn-secondary with download icon
- Numbers: right-aligned, mono font
- Totals row: font-bold, bg-warm-50, border-t-2 warm-300
```

---

## 13. Prompt 11: Platform Admin

```
Redesign the platform admin pages at /platform/*. This is an internal tool used by your team to manage tenants. It should feel professional and efficient — a control panel, not a consumer product.

DESIGN: Dark theme (bg: warm-950). This visually separates it from the tenant-facing app and signals "superadmin territory."

LOGIN PAGE (/platform/login):
- Centered card on dark background
- Card: bg-warm-900, border warm-800, rounded-lg, p-8, max-w-sm
- Title: "Platform Admin" — text-lg, warm-100
- Fields: Email, Password — dark-themed inputs (bg-warm-800, border-warm-700, text-warm-100)
- Submit: .btn-primary ("Sign in")
- No signup link (platform admins are created via CLI)

TENANT LIST (/platform/tenants):
- Dark sidebar (warm-900) with minimal nav: "Tenants" (active), future: "Analytics", "Settings"
- Content area: warm-950 bg
- Search + status filter bar at top
- Tenant table: dark themed
  - Columns: Name, Slug, Plan (badge), Status (color-coded badge), Created, Actions
  - Status badges: active=green, trial=blue, suspended=red, cancelled=warm-600
  - Hover: warm-900 bg
  - Click row: navigate to detail

TENANT DETAIL (/platform/tenants/:id):
- Header: tenant name (text-xl) + status badge + slug (mono, warm-500)
- "← All tenants" back link
- 4 stat cards: Outlets, Users, Paid bills, Lifetime revenue
- Status controls: 4 buttons in a row (Mark active, Mark trial, Suspend, Cancel)
  - Active/trial: default style (dark themed)
  - Suspend/Cancel: red-themed with confirmation dialog
- Outlets table: name, status, created
- Recent users table: email, name, role, last login
```

---

## 14. Prompt 12: Mobile — Pairing & Tables

```
Redesign the React Native mobile screens: PairScreen and TablesScreen.

DESIGN DIRECTION: Clean, high-contrast, touch-optimized. The mobile app is used on iPads (tablets) and phones in a restaurant environment — bright lights, greasy fingers, constant movement.

PAIR SCREEN:

Layout: centered, full screen, brand-colored top section

```
┌────────────────────────┐
│    ████████████████     │  ← Brand gradient top section (20% of screen)
│    Restaurant POS       │     Logo + app name, white text
│                         │
│  ┌──────────────────┐   │
│  │                  │   │
│  │   Scan QR Code   │   │  ← Camera viewfinder (rounded-xl, 280px square)
│  │                  │   │     With corner bracket decorations
│  │   [  📷 ]        │   │
│  │                  │   │
│  └──────────────────┘   │
│                         │
│  ── or enter code ──    │  ← Divider with "or" text
│                         │
│  Device label (optional)│
│  [Counter iPad        ] │
│                         │
│  Pairing code           │
│  [A B C 1 2 3 4 5     ] │  ← Large monospace input, letter-spaced
│                         │
│  [     Pair device     ]│  ← Brand button, full width
│                         │
└────────────────────────┘
```

- Camera permission: if denied, hide the camera section and show only the manual entry
- QR viewfinder: rounded corners, subtle animated scanning line (moves top to bottom slowly)
- Code input: large, mono font, uppercase, letter-spacing wide, centered
- Pair button: bg-brand, white text, h-14, rounded-md, full width
- Loading: overlay with activity indicator, "Pairing..."
- Error: red toast at bottom, "Invalid code" or "Code expired"
- Success: brief green checkmark animation → auto-navigate to TablesScreen

TABLES SCREEN:

Layout:
```
┌────────────────────────┐
│  Tables        Alex ▾  │  ← Header with user menu
│                        │
│ [Call Mgr][Kitchen][⚡] │  ← Alert buttons (compact, icon + short label)
│                        │
│ ┌──────┐ ┌──────┐     │
│ │  T1  │ │  T2  │     │  ← 2-column grid
│ │ Free │ │#12 ⏱│     │
│ │ 4s   │ │ 4s   │     │
│ └──────┘ └──────┘     │
│ ┌──────┐ ┌──────┐     │
│ │  T3  │ │  T4  │     │
│ │ Free │ │ Free │     │
│ └──────┘ └──────┘     │
│                        │
│ ── Takeaway ──         │
│ ┌──────────────────┐   │
│ │ #14 Raj  TAKEAWAY│   │
│ └──────────────────┘   │
│                        │
│    [+ New takeaway]    │  ← Floating action button or bottom bar
│                        │
│ [Stock]    [Sign out]  │  ← Bottom bar (stock: owner/admin/manager only)
└────────────────────────┘
```

Header:
- Title: "Tables" — font-semibold
- Right: user name with dropdown arrow (tap: shows "Stock" link + "Sign out")
- Or: separate header actions

Alert buttons:
- Compact row, 3 buttons
- Each: h-10, rounded-sm, font-medium, text-sm
- "Manager" = blue bg, "Kitchen" = amber bg, "Waiter" = teal bg
- White text, icon on left
- Press feedback: scale(0.95)
- After press: brief checkmark + toast "Manager notified"

Table cards:
- 2 columns, square aspect ratio
- Card height: responsive (fill available space)
- Free: white bg, green left border (4px), green "Free" text
- Occupied: white bg, amber left border, amber "Order #12" badge + elapsed time
- Code: large, bold (text-xl), centered
- Seats: small, bottom of card
- Touch feedback: scale(0.97) on press, subtle shadow increase
- Pull-to-refresh: standard pull-to-refresh indicator

Takeaway section:
- Below table grid, separated by a label
- Horizontal scroll of takeaway cards (if many) or vertical list (if few)

New takeaway button:
- Floating action button (bottom-right, 56px circle, brand bg, white "+" icon) OR
- Full-width button at bottom of screen (better for tablets)

Sign out:
- Bottom of screen, small text, red color
- Confirmation alert: "This will unpair the device. Continue?"
```

---

## 15. Prompt 13: Mobile — Order & Bill

```
Redesign the React Native OrderScreen and BillScreen.

ORDER SCREEN:

Layout: full screen, split into menu area (top 65%) and cart summary (bottom 35%)

Header:
- "New · T3" or "Order #12 · T3 (Window)" — font-semibold
- Back arrow (left) — navigates to TablesScreen
- "Bill" button (right) — only for existing orders, .btn-secondary style

Category picker:
- Horizontal scroll of chips/pills
- Selected: bg-warm-900, text-white
- Unselected: bg-white, border-warm-300
- Height: 40px
- Smooth horizontal scroll

Item grid:
- 2 columns
- Card: white bg, rounded-md, p-3, border warm-200
- Name: font-medium, text-sm (2 lines max)
- Price: mono, text-sm, warm-600
- "OPTIONS" mini badge (amber, if variations/addons)
- "Out of stock" overlay: semi-transparent dark overlay + "Out of stock" text
- Tap feedback: brief brand-light bg flash

LineEditor (bottom sheet):
- Slides up from bottom, max 85% height
- Handle bar at top (grab indicator)
- Sections: Variation chips, Addon checkboxes, Notes input, Quantity ± spinner
- Quantity buttons: large (44×44px), rounded, brand border
- "Add to cart" button: full width, brand bg, h-14

Cart panel (bottom):
- Persistent bottom bar: dark bg (warm-950)
- Collapsed state: single row showing "{N} items · ₹{total}" + "View cart ↑" button
- Expanded state (tap to expand): slides up, shows full cart with sections

Cart sections (expanded):
- "Already sent": compact list, muted text
- "New items": each with ± controls, swipe-left to remove
- Subtotal: bold, mono
- "Send to kitchen" button: full width, brand bg, h-14, at bottom

BILL SCREEN:

Layout: scrollable single column

Bill header:
- "Bill #42" with status badge
- Items list: compact table (name, qty, price)
- Totals: right-aligned, mono
- Outstanding: large, amber, prominent

Payment form:
- Method: 4 chip buttons in a row (Cash, UPI, Card, Other)
- Amount: large mono input, pre-filled
- Reference: conditional input
- "Record payment" button: brand, full width

Paid state:
- Green card: "✓ Paid in full"
- "Back to tables" button

PDF button:
- "View / share PDF" — opens share sheet
```

---

## 16. Prompt 14: Mobile — Stock Management

```
Redesign the React Native StockScreen.

Layout:

Header: "Stock · 86 items"

Search bar:
- Sticky at top below header
- Full width, h-44px, rounded-md, warm border
- Search icon left, clear button right when text entered
- Placeholder: "Search items..."

Category filter:
- Horizontal scroll of category chips below search bar
- "All" selected by default
- Same chip style as order screen categories

Item list:
- FlatList for performance (important with 100+ items)
- Each row: 
  - Left: Item name (font-medium) + price below (mono, text-sm, warm-500)
  - Right: toggle switch (green = in stock, red = out of stock)
  - If out of stock: show "86'd" badge (red, small, next to name)
- Row height: 56px (comfortable touch target)
- Row divider: 1px warm-200

Toggle switch:
- Custom toggle (not default React Native Switch)
- Green (#1A8F4A) when in stock, Red (#D93025) when out of stock
- Haptic feedback on toggle (light impact)
- Optimistic update — toggles immediately, subtle error toast if API fails

Pull-to-refresh: standard refresh indicator

Empty search state: "No items matching '{query}'" — centered, warm-500
```

---

## 17. Execution Order

Run these prompts in this order:

```
Phase 1: Foundation (do first — everything else depends on it)
  1. Prompt 1: Design tokens, fonts, Tailwind config, global styles

Phase 2: High-traffic screens (these are used every minute during service)
  2. Prompt 4: POS Table Grid
  3. Prompt 5: POS Order Page & Cart
  4. Prompt 6: KDS (Kitchen Display)
  5. Prompt 7: Billing & Receipt

Phase 3: Auth & Onboarding (first impression, used less often but sets tone)
  6. Prompt 2: Auth Pages
  7. Prompt 3: Onboarding Wizard

Phase 4: Admin (used daily but not during service rush)
  8. Prompt 8: Admin Layout & Sidebar
  9. Prompt 9: Menu Management
  10. Prompt 10: Staff, Tables, Settings, Reports

Phase 5: Platform Admin (internal only, lowest priority)
  11. Prompt 11: Platform Admin

Phase 6: Mobile (parallel track if 2nd developer available)
  12. Prompt 12: Mobile — Pairing & Tables
  13. Prompt 13: Mobile — Order & Bill
  14. Prompt 14: Mobile — Stock Management
```

**Estimated effort**: 
- Phase 1: 1 day
- Phase 2: 3-4 days (these are the most complex screens)
- Phase 3: 1-2 days
- Phase 4: 2-3 days
- Phase 5: 0.5-1 day
- Phase 6: 2-3 days (parallel)
- **Total: ~10-14 days for 1 developer, ~7-9 days for 2 developers**

---

**Document End**
**Version 1.0.0 — April 6, 2026**
