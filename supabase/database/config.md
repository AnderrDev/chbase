# Configuración de Base de Datos

## Estructura del Proyecto

```
supabase/
├── config.toml                    # Configuración principal de Supabase
├── functions/                     # Edge Functions (Deno)
│   ├── admin-products/
│   ├── create-preference/
│   └── ...
├── database/                      # Estructura de base de datos organizada
│   ├── functions/                 # RPCs y funciones
│   ├── triggers/                  # Triggers y funciones de trigger
│   ├── views/                     # Vistas de base de datos
│   ├── apply_all.sql             # Script maestro para aplicar todo
│   ├── check_status.sql          # Script para verificar estado
│   └── README.md                 # Documentación
└── migrations_dev/               # Migraciones de desarrollo
    ├── 001_core.sql.sql
    ├── 002_rls.sql
    └── ...
```

## Comandos Útiles

### Aplicar toda la estructura:
```bash
# Desde el directorio supabase/
psql -h localhost -p 54322 -U postgres -d postgres -f database/apply_all.sql
```

### Verificar estado:
```bash
psql -h localhost -p 54322 -U postgres -d postgres -f database/check_status.sql
```

### Aplicar migraciones:
```bash
supabase db reset
```

## Configuración de Desarrollo

### Variables de Entorno
```bash
# .env.local
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

### Docker (Requerido)
```bash
# Iniciar Docker Desktop
open -a Docker

# Iniciar Supabase local
supabase start
```

## Funciones Principales

### 1. `create_product_with_variants`
- **Uso**: Crear productos con variantes
- **Endpoint**: POST /admin-products/products
- **Campo store**: ✅ Soportado

### 2. `product_upsert_full`
- **Uso**: Actualización masiva de productos
- **Campo store**: ✅ Soportado

### 3. `decrement_inventory_safe`
- **Uso**: Decrementar inventario de forma segura
- **Endpoint**: Procesamiento de órdenes

## Triggers Importantes

### Normalización
- `normalize_slug`: Convierte slugs a formato estándar
- `normalize_sku`: Convierte SKUs a formato estándar

### Automatización
- `set_updated_at`: Actualiza timestamps automáticamente
- `sync_total_cents`: Calcula totales de órdenes

### Validación
- `validate_discount_code`: Valida códigos de descuento
- `uppercase_code`: Convierte códigos a mayúsculas

## Vistas

### `catalog`
- Vista principal del catálogo
- Incluye productos, variantes, categorías
- Optimizada para el frontend

## Mantenimiento

### Agregar nueva función:
1. Crear archivo en `database/functions/`
2. Actualizar `apply_all.sql`
3. Actualizar documentación

### Agregar nuevo trigger:
1. Crear archivo en `database/triggers/`
2. Actualizar `apply_all.sql`
3. Actualizar documentación

### Actualizar función existente:
1. Modificar archivo correspondiente
2. Aplicar cambios
3. Verificar funcionamiento

## Troubleshooting

### Error: "function does not exist"
```sql
-- Verificar si la función existe
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'nombre_funcion';
```

### Error: "permission denied"
```sql
-- Verificar permisos
SELECT grantee, privilege_type 
FROM information_schema.routine_privileges 
WHERE routine_name = 'nombre_funcion';
```

### Error: "column does not exist"
```sql
-- Verificar estructura de tabla
\d products
```
