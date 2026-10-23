# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This workspace contains two related projects for the **CH+ Market** sports supplements e-commerce platform:

- **`chmarket/`** — Customer-facing storefront (SPA)
- **`chmarket-admin-panel/`** — Admin dashboard for store management

Both share the same Supabase backend and follow Domain-Driven Design (DDD) principles.

---

## Commands

### chmarket (storefront)

```bash
cd chmarket
npm run dev           # Dev server on port 3000
npm run build         # Production build
npm run build:staging # Staging build
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run type-check    # TypeScript check (no emit)
npm run test          # Jest tests
npm run test:watch    # Jest in watch mode
npm run test:coverage # Jest with coverage (85% threshold)
```

For Netlify deployment: `npm run deploy:netlify` (generates sitemap → build → pre-deploy checks). Do **not** use plain `npm run build` for production — use `npm run build:seo` or the deploy script.

### chmarket-admin-panel

```bash
cd chmarket-admin-panel
npm run dev           # Dev server on port 3001
npm run build         # Production build
npm run lint          # ESLint check
npm run type-check    # TypeScript check
npm run format        # Prettier format
npm run format:check  # Prettier check (CI)
npm run check         # type-check + lint + format:check combined
```

---

## Architecture

### Shared DDD Layer Pattern

Both projects follow the same four-layer architecture:

```
domain/          ← Interfaces only (repositories, use case contracts)
data/            ← Implementations (datasources → repositories → entities)
container.ts     ← Manual dependency injection wiring
app/ or pages/   ← React UI layer
```

- **`domain/repositories/`**: TypeScript interfaces for data access
- **`domain/usecases/`**: Business logic contracts
- **`data/datasources/`**: Supabase client calls and Edge Function calls
- **`data/repositories/`**: Concrete implementations of domain interfaces
- **`container.ts`**: Wires datasources → repositories → use cases; import from here in hooks/components

### chmarket Architecture

**App bootstrap**: `src/main.tsx` → `src/app/providers.tsx` (React Query, CartContext, ToastContext, Google Analytics) → `src/app/AppRoutes.tsx`

**State management**:
- Server state: TanStack React Query (caching, background refetch)
- Client state: React Context API — `CartContext` (localStorage-persisted), `ToastContext`

**Key directories**:
- `src/hooks/` — 20+ custom hooks encapsulate all business logic; components stay thin
- `src/services/` — `coupon.ts` (Edge Function calls), `mp.ts` (Mercado Pago SDK)
- `src/pages/` — 13 route-level components

**Edge Function resolution order** (set via `VITE_FUNCTIONS_BASE_URL`):
1. `VITE_FUNCTIONS_BASE_URL` env var
2. `VITE_SUPABASE_URL/functions/v1`
3. `/api` fallback

**Payments**: Mercado Pago via Edge Function `create-preference`; polling order status via `order-status` Edge Function (no JWT required on this function).

**Testing**: Jest 30 + React Testing Library. Test files live alongside source in `src/**/__tests__/` or as `*.test.ts(x)`; shared helpers in `src/test/`. Coverage threshold: 85%.

**Project rules**: `chmarket/CLAUDE.md` holds the mandatory architecture, theme, component, SOLID, testing and accessibility rules for the storefront. Read it before changing anything in `chmarket/`.

### chmarket-admin-panel Architecture

**App bootstrap**: `src/main.tsx` → `src/App.tsx` (AuthContext, lazy-loaded routes with Suspense)

**State management**: React Query for products and orders (`useProducts`, `useOrders`, Dashboard); categories and discounts still use `useState`/`useEffect`. `AuthContext` wraps the entire app and manages the Supabase session; admin access requires `app_metadata.role = 'admin'`.

**Auth flow**: Email/password via Supabase Auth → `AuthContext` → `ProtectedRoute` wrapper on all non-login pages.

**Edge Functions**: Admin functions use `service_role` key to bypass RLS — all mutations go through Edge Functions (`admin-products`, `admin-orders`, `admin-discounts`, `admin-categories`, `admin-images`), not direct Supabase client writes.

**Tests**: Vitest + React Testing Library (`npm test`). Prettier is enforced (`.prettierrc`; 2-space indent, single quotes, trailing commas, 80-char lines).

---

## Backend: Supabase

Both projects share one Supabase project. The canonical backend source lives at **`/supabase/`** (workspace root). Do **not** edit `chmarket/supabase/` or `chmarket-admin-panel/supabase/` — those are deprecated and contain redirect READMEs.

```
supabase/
├── config.toml
├── migrations_dev/        # SQL migrations (001–010)
├── database/              # RPCs, triggers, views, hardening scripts
├── functions/             # 13 deployed Edge Functions
└── functions_not_deployed/  # upload/ (client-side code, not a valid EF)
```

Key Edge Functions (13 deployed):
- `create-preference` — Mercado Pago checkout (JWT required)
- `order-status`, `mp-webhook` — order lifecycle (no JWT)
- `validate-coupon`, `validate-cart-stock` — cart validation
- `cancel-order`, `cleanup-reservations` — order management
- `admin-products`, `admin-orders`, `admin-discounts`, `admin-categories`, `admin-images` — admin CRUD
- `related-products` — storefront product recommendations

Not deployed: `supabase/functions_not_deployed/upload/` (client-side only)

### Deploy Edge Functions

```bash
# From workspace root /ch/
supabase functions deploy <function-name> --project-ref <project-ref>
```

---

## Environment Variables

**chmarket** (`.env` based on `env.example`):
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_FUNCTIONS_BASE_URL   # optional, falls back to SUPABASE_URL/functions/v1
VITE_APP_URL
VITE_WHATSAPP_NUMBER
```

**chmarket-admin-panel**:
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

---

## Key Conventions

- **Tailwind only** — no CSS modules or styled-components; custom CH+ brand tokens defined in `tailwind.config.js`
- **Path alias `@`** maps to `./src` in admin panel; chmarket uses relative imports
- **Lucide React** for all icons
- **React Hot Toast** for notifications
- **React Router DOM v7** for routing in both projects
- When adding a new domain feature, follow the pattern: add interface to `domain/`, implement in `data/`, wire in `container.ts`, consume via a hook in `hooks/`
