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

    // Cancela en una transacción con la orden bloqueada: devuelve el stock
    // reservado y libera los cupones. Si el webhook la marcó como pagada entre
    // tanto, cancel_order responde NOT_CANCELLABLE.
    const { data: result, error: cancelError } = await supabase.rpc('cancel_order', {
      p_order_id: order_id,
      p_only_pending: true,
    });

    if (cancelError) {
      return cors({ error: 'Error cancelando orden', detail: cancelError.message }, 500);
    }

    if (result !== 'CANCELLED') {
      return cors(
        { error: 'Orden no cancelable', detail: 'La orden cambió de estado' },
        409
      );
    }

    return cors({
      success: true,
      message: 'Orden cancelada exitosamente',
      order_id,
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
