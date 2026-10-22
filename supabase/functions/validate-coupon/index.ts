// supabase/functions/validate-coupon/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluateCoupon, loadCartLines } from '../_shared/coupons.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors({ ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const { code, cartItems } = body;

    if (!code) {
      return cors({ error: 'Código de cupón requerido' }, 400);
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return cors({
        valid: false,
        message: 'Este cupón requiere información de productos del carrito',
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Precios desde la BD (se ignora unit_price_cents del cliente) y mismas
    // reglas que create-preference, para que el descuento mostrado sea el cobrado.
    const items = cartItems
      .map((i: { variant_id?: unknown; quantity?: unknown }) => ({
        variant_id: String(i?.variant_id ?? ''),
        quantity: Number(i?.quantity),
      }))
      .filter(
        (i: { variant_id: string; quantity: number }) =>
          i.variant_id && Number.isInteger(i.quantity) && i.quantity > 0
      );
    const { lines } = await loadCartLines(supabase, items);

    if (lines.length === 0) {
      return cors({
        valid: false,
        message: 'No se encontraron productos válidos en el carrito',
      });
    }

    const result = await evaluateCoupon(supabase, String(code), lines);

    if (!result.valid) {
      return cors({
        valid: false,
        code: result.code,
        message: result.message,
        ...result.extra,
      });
    }

    const { coupon } = result;
    return cors({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value_percent: coupon.value_percent,
        value_cents: coupon.value_cents,
        min_order_cents: coupon.min_order_cents,
        applies_to_all_products: coupon.applies_to_all_products,
        applicable_product_ids: coupon.applicable_product_ids,
        applicable_category_ids: coupon.applicable_category_ids,
      },
      discountCents: result.discountCents,
      discountMessage: result.discountMessage,
      applicableSubtotalCents: result.applicableSubtotalCents,
      applicableItemIds: result.applicableItemIds,
      scopeMessage: result.scopeMessage,
      message: `Cupón válido: ${result.discountMessage} (${result.scopeMessage})`,
    });
  } catch (e: unknown) {
    const msg = e && (e as Error).message ? (e as Error).message : String(e);
    return cors({ error: 'Error interno', detail: msg }, 400);
  }
});
