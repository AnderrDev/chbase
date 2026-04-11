# Supabase — Fuente única de verdad

Este directorio (`/supabase/`) es la fuente canónica para todo el backend compartido entre
`chmarket/` (storefront) y `chmarket-admin-panel/` (admin dashboard).

## Estructura

```
supabase/
├── config.toml                  # Configuración del proyecto Supabase
├── migrations_dev/              # Migraciones SQL (aplicar en orden)
├── database/                    # Scripts de base de datos (RPCs, triggers, vistas)
├── functions/                   # Edge Functions desplegadas (13)
│   ├── admin-categories/
│   ├── admin-discounts/
│   ├── admin-images/
│   ├── admin-orders/
│   ├── admin-products/
│   ├── cancel-order/
│   ├── cleanup-reservations/
│   ├── create-preference/
│   ├── mp-webhook/
│   ├── order-status/
│   ├── related-products/
│   ├── validate-cart-stock/
│   └── validate-coupon/
└── functions_not_deployed/      # NO desplegadas
    └── upload/                  # Código cliente — no es Edge Function válida
```

## Deploy de funciones

```bash
# Desde la raíz del workspace /ch/
supabase functions deploy <nombre-función> --project-ref <project-ref>

# Ejemplo: desplegar todas
for fn in admin-categories admin-discounts admin-images admin-orders admin-products \
           cancel-order cleanup-reservations create-preference mp-webhook order-status \
           related-products validate-cart-stock validate-coupon; do
  supabase functions deploy $fn --project-ref <project-ref>
done
```

## Variables de entorno requeridas en Edge Functions

| Variable                    | Funciones que la usan          |
|-----------------------------|-------------------------------|
| `SUPABASE_URL`              | Todas                          |
| `SUPABASE_SERVICE_ROLE_KEY` | Todas las `admin-*`, webhooks  |
| `MP_ACCESS_TOKEN`           | `create-preference`, `mp-webhook` |
| `MP_WEBHOOK_SECRET`         | `mp-webhook`                   |

## Notas

- Los directorios `chmarket/supabase/` y `chmarket-admin-panel/supabase/` apuntan a este directorio.
- Cualquier cambio en funciones o migraciones debe hacerse aquí.
