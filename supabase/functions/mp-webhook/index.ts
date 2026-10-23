// supabase/functions/mp-webhook/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
// WEBHOOK_SECRET: nombre con el que se guardó la clave en el proyecto actual
const WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET') ?? Deno.env.get('WEBHOOK_SECRET');

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
  // Falla cerrado: sin secreto no se acepta ninguna notificación
  if (!WEBHOOK_SECRET) {
    console.error('mp-webhook: MP_WEBHOOK_SECRET no está configurado');
    return false;
  }

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

  return timingSafeEqual(expectedHash, receivedHash.toLowerCase());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
      // 404: pago inexistente, reintentar no sirve. Otros: que MP reintente.
      return r.status === 404 ? plain('ok') : plain('mp api error', 502);
    }

    const mp = await r.json();
    const extRef = String(mp.external_reference || '');
    if (!extRef) return plain('ok');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Una sola transacción con la orden bloqueada: idempotente ante
    // notificaciones duplicadas/concurrentes, verifica importe y moneda, y
    // aplica stock + cupón + PAID juntos (ver migración 012).
    const paidCents = Math.round(Number(mp.transaction_amount ?? 0) * 100);
    const { data: outcome, error: rpcErr } = await supabase.rpc('apply_mp_payment', {
      p_order_number: extRef,
      p_payment_id: String(mp.id),
      p_mp_status: String(mp.status || ''),
      p_paid_cents: paidCents,
      p_currency: String(mp.currency_id || ''),
      // MP cobra en pesos enteros y cada ítem se redondea: 1 peso por línea
      p_tolerance_cents: 100 * (Array.isArray(mp.additional_info?.items) ? mp.additional_info.items.length : 1),
      p_raw: mp,
    });

    if (rpcErr) {
      // Error transitorio de BD: 500 para que Mercado Pago reintente
      console.error(`mp-webhook: apply_mp_payment failed for ${extRef}:`, rpcErr.message);
      return plain('error', 500);
    }

    if (['NOT_PAYABLE', 'AMOUNT_MISMATCH', 'OUT_OF_STOCK', 'PAYMENT_REVERSED'].includes(String(outcome))) {
      // Requiere revisión manual (posible reembolso); reintentar no lo arregla
      console.error(`mp-webhook: ATENCIÓN orden ${extRef} pago ${mp.id}: ${outcome}`, {
        mp_status: mp.status,
        paid_cents: paidCents,
        currency: mp.currency_id,
      });
    } else {
      console.log(`mp-webhook: orden ${extRef} pago ${mp.id}: ${outcome}`);
    }

    return plain('ok');
  } catch (error) {
    console.error('mp-webhook unexpected error:', error instanceof Error ? error.message : error);
    return plain('error', 500);
  }
});
