import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, origin, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

serve(async req => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate required environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: 'Configuración de Supabase incompleta',
          details:
            'Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    // Create Supabase client with service role key
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { method, url } = req;
    const urlObj = new URL(url);
    const path = urlObj.pathname.split('/').pop();

    // Get all orders (paginado: ?page=1&pageSize=50)
    if (method === 'GET' && path === 'list') {
      try {
        const page = Math.max(1, Number(urlObj.searchParams.get('page') ?? '1'));
        const pageSize = Math.min(
          Math.max(1, Number(urlObj.searchParams.get('pageSize') ?? '50')),
          200
        );
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await supabaseClient
          .from('orders')
          .select(
            `
            id, order_number, email, status, payment_status,
            subtotal_cents, discount_cents, shipping_cents, total_cents,
            currency, created_at, updated_at,
            shipping_address, payment_provider,
            order_discounts(
              id,
              code_snapshot,
              type_snapshot,
              value_percent_snapshot,
              value_cents_snapshot,
              amount_applied_cents,
              applies_to_all_products_snapshot,
              applicable_product_ids_snapshot,
              applicable_category_ids_snapshot
            )
          `,
            { count: 'exact' }
          )
          .order('created_at', { ascending: false })
          .range(from, to);

        if (error) {
          console.error('Error fetching orders:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al obtener órdenes',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        return new Response(
          JSON.stringify({ data, total: count ?? 0, page, pageSize, error: null }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      } catch (fetchError) {
        console.error('Unexpected error fetching orders:', fetchError);
        return new Response(
          JSON.stringify({
            error: 'Error inesperado al obtener órdenes',
            details:
              fetchError instanceof Error
                ? fetchError.message
                : 'Error desconocido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          }
        );
      }
    }

    // Get order items (debe ir ANTES que "Get order by ID" para evitar conflictos)
    if (method === 'GET' && path && path.includes('-items')) {
      try {
        // Extract order ID by removing the '-items' suffix
        const orderId = path.replace('-items', '');

        if (!orderId || orderId === '') {
          return new Response(
            JSON.stringify({
              error: 'ID de orden requerido',
              details: 'El ID de la orden no puede estar vacío',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        // Validate UUID format
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(orderId)) {
          return new Response(
            JSON.stringify({
              error: 'ID de orden inválido',
              details: `El ID de la orden debe ser un UUID válido, recibido: ${orderId}`,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        const { data, error } = await supabaseClient
          .from('order_items')
          .select(
            `
            *,
            products:product_id(id, name, slug),
            variants:variant_id(id, label, sku)
          `
          )
          .eq('order_id', orderId);

        if (error) {
          console.error('Error fetching order items:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al obtener items de la orden',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        return new Response(JSON.stringify({ data, error: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (fetchError) {
        console.error('Unexpected error fetching order items:', fetchError);
        return new Response(
          JSON.stringify({
            error: 'Error inesperado al obtener items de la orden',
            details:
              fetchError instanceof Error
                ? fetchError.message
                : 'Error desconocido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          }
        );
      }
    }

    // Get orders statistics (debe ir ANTES que "Get order by ID" para evitar conflictos)
    if (method === 'GET' && path === 'stats') {
      try {
        const { data, error } = await supabaseClient
          .from('orders')
          .select('status, total_cents');

        if (error) {
          console.error('Error fetching order stats:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al obtener estadísticas de órdenes',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        const stats = {
          totalOrders: data?.length || 0,
          totalRevenue:
            data?.reduce((sum, order) => sum + order.total_cents, 0) || 0,
          pendingOrders:
            data?.filter(o => o.status === 'CREATED').length || 0,
          paidOrders:
            data?.filter(o => o.status === 'PAID').length || 0,
        };

        return new Response(JSON.stringify({ data: stats, error: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (fetchError) {
        console.error('Unexpected error fetching order stats:', fetchError);
        return new Response(
          JSON.stringify({
            error: 'Error inesperado al obtener estadísticas de órdenes',
            details:
              fetchError instanceof Error
                ? fetchError.message
                : 'Error desconocido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          }
        );
      }
    }

    // Get order by ID (debe ir DESPUÉS de todas las rutas específicas para evitar conflictos)
    if (
      method === 'GET' &&
      path !== 'list' &&
      !path.includes('-items') &&
      path !== 'stats'
    ) {
      try {
        const orderId = path;
        if (!orderId || orderId === '') {
          return new Response(
            JSON.stringify({
              error: 'ID de orden requerido',
              details: 'El ID de la orden no puede estar vacío',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        const { data, error } = await supabaseClient
          .from('orders')
          .select(
            `
            *,
            order_discounts(
              id,
              code_snapshot,
              type_snapshot,
              value_percent_snapshot,
              value_cents_snapshot,
              amount_applied_cents,
              applies_to_all_products_snapshot,
              applicable_product_ids_snapshot,
              applicable_category_ids_snapshot
            )
          `
          )
          .eq('id', orderId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return new Response(
              JSON.stringify({
                error: 'Orden no encontrada',
                details: `No se encontró una orden con el ID: ${orderId}`,
                code: error.code,
              }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404,
              }
            );
          }

          console.error('Error fetching order:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al obtener orden',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        return new Response(JSON.stringify({ data, error: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (fetchError) {
        console.error('Unexpected error fetching order:', fetchError);
        return new Response(
          JSON.stringify({
            error: 'Error inesperado al obtener orden',
            details:
              fetchError instanceof Error
                ? fetchError.message
                : 'Error desconocido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          }
        );
      }
    }

    // Update order status
    if (method === 'PATCH') {
      try {
        const body = await req.json();
        const { orderId, status } = body;

        if (!orderId || !status) {
          return new Response(
            JSON.stringify({
              error: 'Datos requeridos faltantes',
              details: 'Se requiere orderId y status para actualizar la orden',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        const { data, error } = await supabaseClient
          .from('orders')
          .update({ status })
          .eq('id', orderId)
          .select()
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return new Response(
              JSON.stringify({
                error: 'Orden no encontrada',
                details: `No se encontró una orden con el ID: ${orderId}`,
                code: error.code,
              }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404,
              }
            );
          }

          console.error('Error updating order status:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al actualizar estado de la orden',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        return new Response(JSON.stringify({ data, error: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (parseError) {
        console.error('Error parsing request body:', parseError);
        return new Response(
          JSON.stringify({
            error: 'Error al procesar datos de la solicitud',
            details: 'El cuerpo de la solicitud no es un JSON válido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
          }
        );
      }
    }

    // Get orders by status
    if (method === 'POST' && path === 'by-status') {
      try {
        const body = await req.json();
        const { status } = body;

        if (!status) {
          return new Response(
            JSON.stringify({
              error: 'Estado requerido',
              details: 'Se requiere el estado para filtrar órdenes',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        const { data, error } = await supabaseClient
          .from('orders')
          .select('*')
          .eq('status', status)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching orders by status:', error);
          return new Response(
            JSON.stringify({
              error: 'Error al obtener órdenes por estado',
              details: error.message,
              code: error.code,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }

        return new Response(JSON.stringify({ data, error: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (parseError) {
        console.error('Error parsing request body:', parseError);
        return new Response(
          JSON.stringify({
            error: 'Error al procesar datos de la solicitud',
            details: 'El cuerpo de la solicitud no es un JSON válido',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: 'Método no permitido',
        details: `El método ${method} no está soportado para esta ruta`,
        supportedMethods: ['GET', 'POST', 'PATCH'],
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405,
      }
    );
  } catch (error) {
    console.error('Unexpected server error:', error);
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
        details: error instanceof Error ? error.message : 'Error desconocido',
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
