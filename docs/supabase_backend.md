# Documentación del Backend: Supabase

El sistema completo usa **Supabase** como infraestructura backend as a service, unificando la base de datos PostgreSQL, autenticación, almacenamiento y las Funciones Edge. Toda su configuración está auto-contenida en el directorio `chmarket/supabase/` del repositorio, permitiendo desplegar de manera unificada mediante la CLI oficial de Supabase.

## 1. Topología del Directorio y Componentes

La carpeta `chmarket/supabase/` encapsula toda la vida del backend.

```text
chmarket/supabase/
├── config.toml           # Configuración maestra para CLI, puertos, auth, funciones
├── migrations_dev/       # Historial de migraciones oficiales para levantar el esquema
├── database/             # Scripts avanzados e independientes de estructura SQL
│   ├── apply_all.sql
│   ├── check_status.sql
│   ├── functions/        # Procedimientos almacenados puramente en base de datos
│   ├── triggers/         # Triggers de Postgres
│   ├── views/            # Vistas definidas manualmente
│   └── prod_hardening/   # Scripts de especialización y seguridad para producción
├── functions/            # Edge functions desarrolladas en TypeScript (Deno)
└── functions_not_deployed/ # Backup o estacionamiento de edge functions antes de liberar
```

## 2. Bases de Datos y Estructura SQL

La construcción de la base de datos no es solo migraciones crudas (`migrations_dev/`). El equipo ha estructurado la carpeta `database/` como un módulo complejo y fuertemente documentado de scripts para abstraer lógica pesada directo en PostgreSQL mediante:
- **Procedimientos Almacenados y Triggers**: Ubicados ordenadamente bajo `database/functions` y `database/triggers`.
- **Rutinas de Validación**: Scripts de utilidad para monitoreo y administración base del estado del esquema (`apply_all.sql`, `check_status.sql`).
- **Hardening de Producción**: Existen lógicas y scripts segregados dentro de `prod_hardening/` para auditar/mejorar políticas de seguridad RLS sin alterar el desarrollo base.

## 3. Runtime de Edge Functions (Deno)

Las Edge functions encapsulan la capa lógica del negocio más protegida y se alojan en `/functions/`. Algunas configuraciones pre-establecidas en `config.toml` indican que ciertas funciones son estrictamente protegidas del cliente mediante Autenticación mediante JWT, y otras son abiertas para webhooks o consultas públicas:

### Clasificación de Funciones

**1. Flujo de Pagos (Mercado Pago)**:
- `create-preference`: **Requiere JWT** (`verify_jwt = true`). Se llama desde el carrito para iniciar la orden y emitir la redirección al pago en MP.
- `order-status`: **Sin requerimiento de JWT** (`verify_jwt = false`). Utilizado posiblemente para polling pasivo y validaciones posteriores.
- `mp-webhook`: **Sin requerimiento de JWT** (`verify_jwt = false`). Recibe y actualiza los estatus de forma autónoma con los callbacks asíncronos de MP.

**2. Panel de Administración / Dashboard**:
Requieren que su contexto envíe la **Service Role Key** o un token Admin para saltarse validaciones RLS, pues efectúan mutaciones pesadas que el cliente no puede hacer:
- `admin-products`, `admin-orders`, `admin-categories`, `admin-discounts`, `admin-images`, `upload` (subida persistente de assets/media).

**3. Operaciones de Checkout & Sistema**:
- `validate-coupon`: Validaciones lógicas on-demand del carrito.
- `validate-cart-stock`: Bloquea inventario de ser necesario en tiempo real.
- `cancel-order` & `cleanup-reservations`: Cronjobs o llamadas que limpian el inventario no pagado y cancelan las órdenes huérfanas tras periodo inactivo.

## 4. Configuración Base (`config.toml`) e Infraestructura Local

Cuando se usa Local Development de Supabase (`supabase start`), las reglas base del proyecto estipuladas dictan que:

1. **Local Ports**: 
   - `54321` (API REST/GraphQL)
   - `54322` (DB Postgres)
   - `54323` (Studio)
   - `54324` (Inbucket correos)
   - `8083` (Edge Deno Runtime Inspector).
2. **Postgres**: Versión definida explícita apuntando en el major a la **v17**.
3. **Autenticación Estricta Limitada (`auth.rate_limit`)**:
   - Tiene protección de *spam* habilitada por IP en emails y sms, tokens de refresco (1h defecto) preconfigurados.
   - Emails confirmatorios manejados de manera *mocking* a través de inbucket en dev.
4. **Almacenamiento (Storage)**: Limite explícito de subida estandarizado para los archivos a **50 MiB** (`file_size_limit`).

## Notas Finales para el Desarrollo

- Siempre que se modifique la base de datos o se deba iterar esquemas, se espera que el SQL sea agregado en `migrations_dev/`.
- Cualquier lógica de negocio compleja que exponga *secretos de terceros (como MP)* debe crearse indiscutiblemente como una **Edge Function** invocada por medio de los DataSources (chmarket/src/data o admin-panel/src/data), jamás desde los `pages` o `hooks` y jamás ejecutado localmente, siempre a traves de los `Clients` del container.
- La ejecución en el Administrador utiliza Edge Functions para bypasear RLS y mantener estricta seguridad de quién borra o genera información de catálogo desde el Frontend Admin.

---

## 5. Administración Visual con Supabase Studio (MCP) en el proyecto chdev

### 5.1 ¿Qué es el MCP/Supabase Studio?

El **Panel de Control Visual de Supabase ("MCP" o "Studio")** es la consola de administración visual para gestionar el proyecto chdev de Supabase. Desde aquí puedes, sin conocimientos avanzados de SQL, manejar tablas, usuarios, relaciones, storage, funciones Edge, logs, políticas de seguridad (RLS), extensiones, triggers y migraciones. Es esencial para el diagnóstico, operación y expansión del backend del sistema CH+ Market.

### 5.2 Acceso

- Accede en: [https://supabase.com/dashboard](https://supabase.com/dashboard)
- Elige el proyecto: **chdev** (o el nombre correspondiente de tu instancia).
- Navega entre las secciones laterales: Database, Authentication, Storage, Edge Functions, Logs, Settings, etc.

### 5.3 Operaciones clave y mejores prácticas

#### **A. Tablas y Datos**
- Puedes crear, borrar y editar tablas con interfaz de hoja de cálculo.  
- Ejemplo para buscar productos:  
  - Navega a **Database > Tables** → elige `products`.
  - Filtra, edita o exporta registros.
- Para relaciones y FKs, puedes “drillear” conectando tablas con clics, útil para órdenes que referencian usuarios/productos.
- La clonación de tablas permite sandboxing para pruebas (ej: `products_test`).

#### **B. Editor SQL**
- Herramienta avanzada para consultas, migraciones manuales, carga masiva (`COPY`), creación de vistas o materialized views.
- **Guardar queries favoritos** para repetir procesos rutinarios.
- Ejemplo: crear vista consolidada de órdenes (`orders_plus`) para el dashboard admin.

#### **C. Políticas RLS y Seguridad**
- Navega a **Database > Policies**.
- Crea/borrra/modifica restricciones (RLS) visualmente para controlar acceso granular.
- El MCP muestra sugerencias y problemas comunes.
- Revisa que tablas “de sistema” (órdenes, usuarios, medios) siempre tengan RLS activado.

#### **D. Autenticación y Usuarios**
- **Authentication > Users** para gestionar usuarios, reactivar, banear, crear manualmente, etc.
- Es útil para debuggear flows de login del storefront y panel de administración.
- Puedes resetear passwords, enviar enlaces de magic link, etc.

#### **E. Storage (Almacenamiento de Archivos)**
- **Storage** para revisar imágenes de productos, comprobantes de pago, etc.
- Puedes subir, mover, borrar archivos y administrar buckets.
- Asigna reglas RLS a buckets si manejas información sensible.

#### **F. Edge Functions**
- **Edge Functions** te permite revisar, desplegar y testear manualmente funciones como `create-preference`, `mp-webhook`, `admin-products`, etc.
- Puedes lanzar tests de funciones desde el panel, ver respuestas y detectar errores de integración.

#### **G. Logs y Auditar**
- El panel de **Logs** te permite auditar actividad: acceso, fallos de autenticación, invocaciones a funciones Edge, errores de seguridad y uso del storage.
- Es clave para troubleshooting cuando detectas errores en la tienda/admin que no son visibles desde el frontend.

#### **H. Extensiones y Avanzado**
- Puedes habilitar extensiones de Postgres desde el panel (ej: para geolocalización, full-text search, etc).
- Solo activa extensiones tras consulta/validación técnica porque pueden impactar el costo y performance.

#### **I. Backup y restauración**
- El MCP permite crear snapshots de tu base de datos (no del storage). Descarga backups regulares, antes de grandes cambios o migraciones.

### 5.4 Ejemplo de flujo típico de troubleshooting usando MCP

1. Un admin (desde `chmarket-admin-panel`) reporta que no puede agregar productos.
2. Entra al **MCP** y revisa **Edge Functions** → testea `admin-products` con parámetros ficticios.
3. Si falla: revisa **Logs de funciones Edge**.
4. Si el error es de privilegios/verificación, entra a **Policies** y verifica reglas RLS para la tabla `products`.
5. Ajusta la política correspondiente, guarda y vuelve a probar la función.
6. Si el problema es de estructura, usa el **Editor SQL** para revisar columnas adicionales o migraciones pendientes.
7. Si carga imágenes falla, revisa permisos y existencia del bucket en **Storage**.

### 5.5 Recursos y enlaces

- [Supabase Studio: Admin Quickstart](https://supabase.com/docs/guides/database/tables)
- [Supabase - Storage](https://supabase.com/docs/guides/storage)
- [SQL Editor](https://supabase.com/docs/guides/database)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Policies/RLS Management](https://supabase.com/docs/guides/auth/row-level-security)
- [Gestión avanzada y extensiones](https://supabase.com/docs/guides/database/extensions)

### 5.6 Buenas prácticas para el equipo

- Nunca borres tablas o datos desde el MCP sin comunicarlo al equipo.
- Antes de cambiar RLS o migrar tablas, saca backup (el snapshot incluye solo datos, no Storage).
- Centraliza pruebas de funciones Edge desde el panel, no desde frontend, para aislar bugs.
- Cuando edites Storage, confirma reglas para evitar filtraciones (testea con usuario restrictivo).
- Usa siempre nombres descriptivos y minúsculas para nuevas tablas y vistas.

### 5.7 Onboarding rápido para devs/admins nuevos

1. Pide acceso al equipo a [https://supabase.com/dashboard](https://supabase.com/dashboard), proyecto `chdev`.
2. Explora las tablas importantes (products, orders, users) desde **Database**.
3. Estudia y ensaya las funciones Edge críticas desde su sección.
4. Practica cambios en entorno de test/sandbox antes de escribir en producción.
5. Lee esta sección y la documentación general para dominar las convenciones y el workflow MCP.

---
