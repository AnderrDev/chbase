-- =====================================================
-- SCRIPT MAESTRO: Aplicar toda la estructura de BD
-- =====================================================
-- Este script aplica todas las funciones, triggers y vistas
-- Ejecutar en orden para evitar dependencias
-- =====================================================

-- =====================================================
-- 1. FUNCIONES (RPCs)
-- =====================================================

\echo 'Aplicando funciones...'

-- Crear producto con variantes
\i functions/create_product_with_variants.sql

-- Upsert completo de productos
\i functions/product_upsert_full.sql

-- Decrementar inventario seguro
\i functions/decrement_inventory_safe.sql

\echo 'Funciones aplicadas correctamente.'

-- =====================================================
-- 2. TRIGGERS
-- =====================================================

\echo 'Aplicando triggers...'

-- Normalizar slugs
\i triggers/normalize_slug.sql

-- Normalizar SKUs
\i triggers/normalize_sku.sql

-- Actualizar timestamp automáticamente
\i triggers/set_updated_at.sql

-- Convertir códigos a mayúsculas
\i triggers/uppercase_code.sql

-- Validar códigos de descuento
\i triggers/validate_discount_code.sql

-- Sincronizar total de órdenes
\i triggers/sync_total_cents.sql

\echo 'Triggers aplicados correctamente.'

-- =====================================================
-- 3. VISTAS
-- =====================================================

\echo 'Aplicando vistas...'

-- Vista del catálogo
\i views/catalog.sql

\echo 'Vistas aplicadas correctamente.'

-- =====================================================
-- 4. VERIFICACIÓN
-- =====================================================

\echo 'Verificando instalación...'

-- Verificar funciones
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN ('create_product_with_variants', 'product_upsert_full', 'decrement_inventory_safe')
ORDER BY routine_name;

-- Verificar triggers
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name IN ('normalize_slug_trigger', 'normalize_sku_trigger', 'set_updated_at_products', 'uppercase_code_trigger', 'validate_discount_code_trigger', 'sync_total_cents_trigger')
ORDER BY trigger_name;

-- Verificar vistas
SELECT table_name, table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'catalog';

\echo '¡Instalación completada exitosamente!'
