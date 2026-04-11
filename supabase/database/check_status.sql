-- =====================================================
-- SCRIPT: Verificar estado de la base de datos
-- =====================================================
-- Este script verifica qué funciones, triggers y vistas están instalados
-- =====================================================

\echo '=== VERIFICACIÓN DE FUNCIONES ==='

SELECT 
    routine_name as "Función",
    routine_type as "Tipo",
    data_type as "Retorna"
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
    'create_product_with_variants', 
    'product_upsert_full', 
    'decrement_inventory_safe'
)
ORDER BY routine_name;

\echo ''
\echo '=== VERIFICACIÓN DE TRIGGERS ==='

SELECT 
    trigger_name as "Trigger",
    event_object_table as "Tabla",
    action_timing as "Momento",
    event_manipulation as "Evento"
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name IN (
    'normalize_slug_trigger', 
    'normalize_sku_trigger', 
    'set_updated_at_products',
    'set_updated_at_product_variants',
    'set_updated_at_orders',
    'uppercase_code_trigger', 
    'validate_discount_code_trigger', 
    'sync_total_cents_trigger'
)
ORDER BY trigger_name;

\echo ''
\echo '=== VERIFICACIÓN DE VISTAS ==='

SELECT 
    table_name as "Vista",
    table_type as "Tipo"
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'catalog';

\echo ''
\echo '=== VERIFICACIÓN DE PERMISOS ==='

SELECT 
    routine_name as "Función",
    grantee as "Usuario",
    privilege_type as "Permiso"
FROM information_schema.routine_privileges 
WHERE routine_schema = 'public'
AND routine_name IN (
    'create_product_with_variants',
    'product_upsert_full',
    'decrement_inventory_safe'
)
ORDER BY routine_name, grantee;

\echo ''
\echo '=== VERIFICACIÓN DE CAMPOS STORE ==='

SELECT 
    column_name as "Campo",
    data_type as "Tipo",
    is_nullable as "Nullable",
    column_default as "Default"
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'products' 
AND column_name = 'store';

\echo ''
\echo 'Verificación completada.'
