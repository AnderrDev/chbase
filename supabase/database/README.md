# Base de Datos - Estructura Organizada

Esta carpeta contiene todos los elementos de base de datos organizados por tipo.

## Estructura

```
database/
├── functions/          # RPCs y funciones de base de datos
├── triggers/           # Triggers y funciones de trigger
├── views/              # Vistas de base de datos
└── README.md          # Este archivo
```

## Funciones (RPCs)

### `create_product_with_variants.sql`

- **Propósito**: Crear producto con variantes en una transacción
- **Parámetros**: `p_payload (jsonb)` - `{ product: {...}, variants: [...] }`
- **Retorna**: `{ product_id: uuid, variant_ids: uuid[] }`
- **Uso**: Endpoint POST /products

### `product_upsert_full.sql`

- **Propósito**: Upsert completo de producto con variantes
- **Parámetros**: `p_payload (jsonb)`, `p_prune_missing (boolean)`
- **Retorna**: `uuid (product_id)`
- **Uso**: Actualización masiva de productos

### `decrement_inventory_safe.sql`

- **Propósito**: Decrementar inventario de forma segura
- **Parámetros**: `p_variant_id (uuid)`, `p_qty (int)`
- **Retorna**: `void`
- **Uso**: Procesamiento de órdenes

## Triggers

### `normalize_slug.sql`

- **Tabla**: `products`
- **Propósito**: Normalizar slugs (lowercase, guiones)
- **Evento**: BEFORE INSERT/UPDATE

### `normalize_sku.sql`

- **Tabla**: `product_variants`
- **Propósito**: Normalizar SKUs (uppercase, guiones)
- **Evento**: BEFORE INSERT/UPDATE

### `set_updated_at.sql`

- **Tablas**: `products`, `product_variants`, `orders`
- **Propósito**: Actualizar automáticamente `updated_at`
- **Evento**: BEFORE UPDATE

### `uppercase_code.sql`

- **Tabla**: `discount_codes`
- **Propósito**: Convertir códigos a mayúsculas
- **Evento**: BEFORE INSERT/UPDATE

### `validate_discount_code.sql`

- **Tabla**: `discount_codes`
- **Propósito**: Validar consistencia de campos de descuento y scope de productos
- **Evento**: BEFORE INSERT/UPDATE
- **Validaciones**:
  - Tipos de descuento (PERCENT, FIXED, FREE_SHIPPING)
  - Scope de productos: si `applies_to_all_products=true`, arrays deben ser NULL/vacíos
  - Scope de productos: si `applies_to_all_products=false`, al menos un array debe tener valores

### `sync_total_cents.sql`

- **Tabla**: `orders`
- **Propósito**: Calcular automáticamente el total de la orden
- **Evento**: BEFORE INSERT/UPDATE

## Vistas

### `catalog.sql`

- **Propósito**: Vista principal del catálogo
- **Incluye**: Productos, variantes, categorías, precios, stock
- **Uso**: Frontend, API de catálogo

## Sistema de Cupones

### Estructura de `discount_codes`

La tabla `discount_codes` soporta cupones con diferentes alcances:

#### Campos de Scope

- `applies_to_all_products` (boolean): Si aplica a todos los productos
- `applicable_product_ids` (uuid[]): Array de IDs de productos específicos
- `applicable_category_ids` (uuid[]): Array de IDs de categorías específicas

#### Tipos de Cupones

1. **Globales**: `applies_to_all_products = true`
   - Aplican a todos los productos del carrito
   - Arrays de productos/categorías deben ser NULL o vacíos

2. **Específicos**: `applies_to_all_products = false`
   - Aplican solo a productos/categorías seleccionados
   - Al menos un array (productos o categorías) debe tener valores

#### Validación de Cupones

La función `validate-coupon` Edge Function:

- Recibe `cartItems` con información de productos del carrito
- Calcula `applicableSubtotalCents` basado en productos aplicables
- Valida mínimo de compra solo sobre productos aplicables
- Retorna información detallada del scope y descuento aplicable

#### Control de Usos de Cupones

**Sistema de Reserva Temporal:**

La función `create-preference` Edge Function:

- **Valida disponibilidad**: Cuenta usos confirmados + reservas activas
- **Crea reserva temporal**: No descuenta uso hasta confirmar pago
- **Expira en 30 minutos**: Las reservas se liberan automáticamente
- **Previene agotamiento**: Rechaza órdenes si se alcanzó el límite

**Flujo de Confirmación:**

1. **`create-preference`**: Crea reserva temporal en `coupon_reservations`
2. **`mp-webhook` (APPROVED)**: Confirma reserva → mueve a `order_discounts`
3. **`mp-webhook` (REJECTED/CANCELLED)**: **Mantiene reserva** para reintentos
4. **`cancel-order`**: Libera reserva solo al cancelar orden manualmente
5. **`cleanup-reservations`**: Limpia reservas expiradas automáticamente (30 min)

**Casos de Uso:**

- ✅ **Pago exitoso**: Reserva → Confirmada (descuenta uso)
- ❌ **Pago fallido**: Reserva → Mantenida (para reintentos)
- 🔄 **Reintento pago**: Reutiliza reserva existente
- ⏰ **Reserva expira**: Se libera automáticamente
- 🚫 **Orden cancelada**: Se libera manualmente

**Tablas involucradas:**

- `coupon_reservations`: Reservas temporales (30 min)
- `order_discounts`: Usos confirmados (permanentes)

#### Ejemplo de Uso

```typescript
// Validar cupón con carrito
const response = await fetch('/functions/v1/validate-coupon', {
  method: 'POST',
  body: JSON.stringify({
    code: 'DESCUENTO10',
    cartItems: [
      {
        variant_id: 'uuid1',
        product_id: 'uuid1',
        quantity: 2,
        unit_price_cents: 50000,
      },
      {
        variant_id: 'uuid2',
        product_id: 'uuid2',
        quantity: 1,
        unit_price_cents: 30000,
      },
    ],
  }),
});

// Respuesta incluye:
// - applicableSubtotalCents: subtotal de productos aplicables
// - applicableItemIds: IDs de variantes que aplican
// - scopeMessage: descripción del alcance
```

## Cómo usar

### Para aplicar todo:

```sql
-- Aplicar todas las funciones
\i functions/create_product_with_variants.sql
\i functions/product_upsert_full.sql
\i functions/decrement_inventory_safe.sql

-- Aplicar todos los triggers
\i triggers/normalize_slug.sql
\i triggers/normalize_sku.sql
\i triggers/set_updated_at.sql
\i triggers/uppercase_code.sql
\i triggers/validate_discount_code.sql
\i triggers/sync_total_cents.sql

-- Aplicar todas las vistas
\i views/catalog.sql
```

### Para aplicar individualmente:

```sql
\i database/functions/create_product_with_variants.sql
```

## Notas importantes

1. **Campo `store`**: Todas las funciones han sido actualizadas para manejar el campo `store`
2. **Permisos**: Todas las funciones tienen permisos para `service_role`
3. **Transacciones**: Las funciones están diseñadas para ser atómicas
4. **Validaciones**: Incluyen validaciones de datos y consistencia

## Mantenimiento

- **Agregar nueva función**: Crear archivo en `functions/`
- **Agregar nuevo trigger**: Crear archivo en `triggers/`
- **Agregar nueva vista**: Crear archivo en `views/`
- **Actualizar documentación**: Modificar este README
