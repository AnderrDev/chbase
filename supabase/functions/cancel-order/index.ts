// supabase/functions/cancel-order/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors({ ok: true });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const orderNumber = typeof body?.order_number === 'string' ? body.order_number : '';
    const email = typeof body?.email === 'string' ? body.email : '';

    // Prueba de propiedad: order_number + email del comprador (igual que order-status).
    // Antes bastaba con order_id, y order-status lo devolvía a cualquiera.
    if (!orderNumber || !email) {
      return cors(
        { error: 'Datos requeridos', detail: 'Se requieren order_number y email' },
        400
      );
    }

    // Verificar que la orden existe, pertenece al email y puede cancelarse
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, email, status, payment_status')
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (
      orderError ||
      !order ||
      String(order.email).trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      return cors({ error: 'Orden no encontrada', detail: 'La orden especificada no existe' }, 404);
    }

    const order_id = order.id;

    if (order.status !== 'CREATED') {
      return cors(
        {
          error: 'Orden no cancelable',
          detail: `No se puede cancelar una orden en estado ${order.status}`,
        },
        400
      );
    }

    // Marcar orden como cancelada primero: el filtro por status evita pisar un
    // pago que el webhook haya confirmado entre la lectura y este update.
    const { data: cancelled, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'CANCELLED',
        payment_status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id)
      .eq('status', 'CREATED')
      .select('id');

    if (updateError) {
      return cors({ error: 'Error cancelando orden', detail: updateError.message }, 500);
    }

    if (!cancelled || cancelled.length === 0) {
      return cors(
        { error: 'Orden no cancelable', detail: 'La orden cambió de estado' },
        409
      );
    }

    // Liberar reservas de cupones en paralelo
    const { data: reservations } = await supabase
      .from('coupon_reservations')
      .select('discount_id')
      .eq('order_id', order_id);

    if (reservations && reservations.length > 0) {
      const results = await Promise.allSettled(
        reservations.map(r =>
          supabase.rpc('release_coupon_reservation', {
            p_order_id: order_id,
            p_discount_id: r.discount_id,
          })
        )
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(`cancel-order: ${failed.length} coupon release(s) failed for order ${order_id}`);
      }
    }

    return cors({
      success: true,
      message: 'Orden cancelada exitosamente',
      order_id,
      reservations_released: reservations?.length || 0,
    });
  } catch (error) {
    console.error('cancel-order unexpected error:', error instanceof Error ? error.message : error);
    return cors(
      {
        error: 'Error interno del servidor',
        detail: error instanceof Error ? error.message : 'Error desconocido',
      },
      500
    );
  }
});
