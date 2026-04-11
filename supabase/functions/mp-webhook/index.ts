// supabase/functions/mp-webhook/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET');

const mpFetch = (path: string, init?: RequestInit) =>
  fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

function plain(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

/** Verifica la firma HMAC-SHA256 de MercadoPago.
 *  Formato header: "ts=<timestamp>,v1=<hex_hash>"
 *  Mensaje firmado: "id:<data_id>;request-id:<x-request-id>;ts:<timestamp>"
 */
async function verifyHmac(req: Request, dataId: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true; // Si no está configurado, no verificamos

  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id') ?? '';

  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => p.split('=') as [string, string])
  );
  const timestamp = parts['ts'];
  const receivedHash = parts['v1'];

  if (!timestamp || !receivedHash) return false;

  const message = `id:${dataId};request-id:${xRequestId};ts:${timestamp}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const expectedHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expectedHash === receivedHash;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return plain('ok');

  // Endpoint de prueba
  const url = new URL(req.url);
  if (url.pathname.endsWith('/test') || url.searchParams.get('test') === 'true') {
    return plain('Webhook funcionando correctamente', 200);
  }

  try {
    const body = await req.json().catch(() => ({}));

    if (
      !body?.type ||
      String(body.type).toLowerCase() !== 'payment' ||
      !body?.data?.id
    ) {
      return plain('ok');
    }

    const payId = String(body.data.id);

    // Verificar firma HMAC real
    const valid = await verifyHmac(req, payId);
    if (!valid) {
      console.error('mp-webhook: HMAC signature verification failed');
      return plain('unauthorized', 401);
    }

    const r = await mpFetch(`/v1/payments/${payId}`);
    if (!r.ok) {
      console.error(`mp-webhook: MP API error ${r.status} for payment ${payId}`);
      return plain('ok');
    }

    const mp = await r.json();
    const status = String(mp.status || '').toUpperCase(); // APPROVED | PENDING | REJECTED...
    const extRef = String(mp.external_reference || '');
    const payIdStr = String(mp.id);

    if (!extRef) return plain('ok');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Actualiza pago en la orden
    const { data: order, error: updErr } = await supabase
      .from('orders')
      .update({
        payment_status: status,
        payment_id: payIdStr,
        payment_raw: mp,
      })
      .eq('order_number', extRef)
      .select('id, status')
      .maybeSingle();

    if (updErr || !order) {
      console.error(`mp-webhook: order update failed for ${extRef}:`, updErr?.message);
      return plain('ok');
    }

    // APPROVED → decrementar stock + confirmar cupones + marcar PAID
    if (status === 'APPROVED' && order.status !== 'PAID') {
      const { data: items } = await supabase
        .from('order_items')
        .select('variant_id, quantity')
        .eq('order_id', order.id);

      // Decrementar stock en paralelo
      if (items && items.length > 0) {
        const stockResults = await Promise.allSettled(
          items.map(it =>
            supabase.rpc('decrement_inventory_safe', {
              p_variant_id: it.variant_id,
              p_qty: it.quantity,
            })
          )
        );
        const failedStock = stockResults.filter(r => r.status === 'rejected');
        if (failedStock.length > 0) {
          console.error(`mp-webhook: ${failedStock.length} stock decrement(s) failed for order ${order.id}`);
        }
      }

      // Confirmar reservas de cupones en paralelo
      const { data: reservations } = await supabase
        .from('coupon_reservations')
        .select('discount_id')
        .eq('order_id', order.id);

      if (reservations && reservations.length > 0) {
        const couponResults = await Promise.allSettled(
          reservations.map(r =>
            supabase.rpc('confirm_coupon_reservation', {
              p_order_id: order.id,
              p_discount_id: r.discount_id,
            })
          )
        );
        const failedCoupons = couponResults.filter(r => r.status === 'rejected');
        if (failedCoupons.length > 0) {
          console.error(`mp-webhook: ${failedCoupons.length} coupon confirm(s) failed for order ${order.id}`);
        }
      }

      await supabase
        .from('orders')
        .update({ status: 'PAID' })
        .eq('id', order.id);
    }

    return plain('ok');
  } catch (error) {
    console.error('mp-webhook unexpected error:', error instanceof Error ? error.message : error);
    return plain('ok');
  }
});
