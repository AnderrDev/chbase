# Documentación del Proyecto: CH+ Market

Este documento describe la estructura global del repositorio, los proyectos que lo componen, cómo se relacionan y la arquitectura utilizada. El objetivo es servir como punto de referencia para entender rápidamente dónde buscar o colocar el nuevo código.

## 1. Visión General y Objetivos

El repositorio contiene la plataforma de e-commerce de suplementos deportivos **CH+ Market**. Está dividido en dos proyectos principales:

- **`chmarket/`**: Es la tienda en línea (Storefront). Aplicación de página única (SPA) orientada al cliente final para explorar productos, gestionar el carrito y realizar compras.
- **`chmarket-admin-panel/`**: Es el panel de administración (Dashboard). Aplicación orientada a los administradores de la tienda para la gestión de productos, órdenes, descuentos, categorías, etc.

## 2. Relación y Backend Compartido

Ambos proyectos se relacionan al compartir el **mismo proyecto de Supabase** como backend:
- **Base de Datos**: PostgreSQL alojada en Supabase.
- **Autenticación**: Supabase Auth.
- **Edge Functions**: Las funciones de servidor residen temporalmente dentro del proyecto `chmarket/supabase/functions/` (incluyendo las funciones para el admin panel) pero dan servicio a ambos frontends.
- **Migraciones**: Se encuentran en `chmarket/supabase/migrations_dev/`.

Las interacciones que requieren privilegios de administrador se ejecutan a través de Edge Functions (las cuales usan la llave `service_role` para saltarse las políticas RLS).

## 3. Arquitectura Base: Domain-Driven Design (DDD)

Tanto `chmarket` como `chmarket-admin-panel` siguen un patrón de arquitectura en cuatro capas (DDD):

```
domain/          ← Interfaces abstractas (contratos de repositorios y casos de uso)
data/            ← Implementaciones concretas (conexión a Supabase, Edge Functions)
container.ts     ← Inyección de dependencias (vincula data con domain)
app/ o pages/    ← Capa de Presentación (React UI interactuando con hooks)
```

### Capas en Detalle:
1. **`domain/repositories/` y `domain/usecases/`**: Contienen interfaces TypeScript que dictan cómo la aplicación debe comportarse ignorando la base de datos o el UI.
2. **`data/datasources/` y `data/repositories/`**: Contienen la integración directa con Supabase Client, Mercado Pago y Edge Functions, cumpliendo las interfaces de `domain`.
3. **`container.ts`**: Fichero clave que une las implementaciones de `data` con las abstracciones de `domain`.
4. **Capa UI (`src/pages`, `src/app`, `src/hooks`)**: Los componentes UI son delgados y consumen hooks. Los hooks obtienen los casos de uso a través del `container.ts`.

## 4. Detalles de chmarket (Storefront)

- **Comando principal**: `npm run dev` (Puerto 3000).
- **Gestión de Estado**:
  - Servidor: **TanStack React Query** (caché inteligente, background refetches).
  - Cliente: React Context API (`CartContext` usando localStorage, `ToastContext`).
- **Componentes / Hooks**:
  - `src/hooks/`: Toda la lógica reside aquí.
  - `src/services//:` Funciones extra (ej: Mercado Pago SDK, Edge Functions extras).
- **Pagos**: Integración con Mercado Pago mediante Edge Functions (`create-preference`, webhook `mp-webhook`, pooling con `order-status`).
- **Navegación**: React Router DOM v7. Bootstrap principal en `src/main.tsx` -> `src/app/providers.tsx` -> `src/app/AppRoutes.tsx`.
- **Testing**: Jest y React Testing Library. Cobertura obligatoria del 80%.

### Estructura de Carpetas (`chmarket/src/`)

```text
chmarket/src/
├── app/                  # Configuración de base (Providers, AppRoutes)
├── components/           # Componentes de UI (common, cart, home, layout, products)
├── context/              # Contextos de React (CartContext, ToastContext)
├── data/                 # Capa de datos (datasources, entities, repositories)
├── domain/               # Capa de dominio (repositories, usecases)
├── hooks/                # Hooks personalizados con lógica de negocio principal
├── lib/                  # Utilidades y configuración de librerías ext (Supabase)
├── pages/                # Componentes a nivel de ruta (Vistas principales)
├── services/             # Integraciones directas (Mercado Pago, Cupones)
└── utils/                # Helpers genéricos
```

## 5. Detalles de chmarket-admin-panel (Dashboard Admin)

- **Comando principal**: `npm run dev` (Puerto 3001).
- **Gestión de Estado**: Principalmente **React Context** (no se usa React Query). `AuthContext` envuelve toda la app manejando la sesión.
- **Autenticación**: `AuthContext` se encarga del login vía Supabase. `ProtectedRoute` bloquea las páginas privadas.
- **Operaciones Admin**: Las mutaciones de datos se realizan siempre a través de **Edge Functions** (`admin-products`, `admin-orders`, `admin-categories`, etc.) en vez de escribir directo sobre el Supabase Client desde el frontend.
- **Navegación**: Routing perezoso (lazy-loaded routes) con Suspense a través de React Router DOM v7.
- **Calidad de código**: Uso fuerte de Prettier y ESLint, aunque no cuenta con tests completos integrados aún.

### Estructura de Carpetas (`chmarket-admin-panel/src/`)

```text
chmarket-admin-panel/src/
├── application/          # Servicios y utilidades específicos de la app Admin
├── components/           # Componentes UI (formularios, modales, tablas)
├── context/              # Contextos de React (AuthContext)
├── data/                 # Capa de datos (datasources, entities, repositories)
├── domain/               # Capa de dominio (repositories, usecases)
├── hooks/                # Hooks de React específicos del dashboard
├── lib/                  # Utilidades y configuración
├── pages/                # Vistas principales del panel (Productos, Órdenes, etc)
├── presentation/         # Capas visuales extra (viewmodels)
├── types/                # Declaraciones de tipos TypeScript
└── utils/                # Utilidades comunes compartidas
```

## 6. Estructura Backend (Supabase y Edge Functions)

Ubicación principal: `chmarket/supabase/`

- **Edge Functions**:
  - Flujo de Pagos: `create-preference`, `order-status`, `mp-webhook`.
  - Carrito: `validate-coupon`, `validate-cart-stock`.
  - Órdenes: `cancel-order`, `cleanup-reservations`.
  - Panel Administrativo (`service_role`): `admin-products`, `admin-orders`, `admin-discounts`, `admin-categories`, `upload`.

### Estructura de Carpetas (`chmarket/supabase/`)

```text
chmarket/supabase/
├── database/             # Definiciones SQL, views, triggers, functions de BD
├── functions/            # Edge functions activas y desplegadas
├── functions_not_deployed/ # Funciones en desarrollo o deprecadas
└── migrations_dev/       # Archivos SQL de migraciones principales (cambios en tablas)
```

## 7. Reglas de Estilo y Convenciones Generales

- **CSS/Estilos**: Uso exclusivo de **Tailwind CSS**. No hay CSS Modules ni styled-components.
- **Iconos**: `lucide-react`.
- **Alertas/Notificaciones**: `react-hot-toast`.
- **Estructura de imports**:
  - `chmarket` usa rutas relativas `../../`
  - `chmarket-admin-panel` utiliza alias `@/` dirigiendo a `./src/`.

---
*Nota para asistentes IA: Esta documentación debe ser leída sistemáticamente como fuente principal para conocer la organización del proyecto y mantener la consistencia al agregar código.*
