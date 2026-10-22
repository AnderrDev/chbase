// supabase/functions/_shared/coupons.ts
// Reglas de cupones compartidas por validate-coupon y create-preference, para
// que lo que el cliente ve como descuento sea exactamente lo que se cobra.
// Los precios siempre salen de la BD, nunca del cliente.
//
// El límite por cliente (max_redemptions_per_customer) y el límite total
// definitivo se aplican de forma atómica en el RPC reserve_coupon al crear la
// orden; aquí solo se hace una comprobación previa del límite total.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type CartLine = {
  variant_id: string;
  product_id: string;
  category_id: string | null;
  unit_price_cents: number;
  quantity: number;
};

export type DiscountCode = {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
  value_percent: number | null;
  value_cents: number | null;
  min_order_cents: number | null;
  max_redemptions_total: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  applies_to_all_products: boolean | null;
  applicable_product_ids: string[] | null;
  applicable_category_ids: string[] | null;
};

export type CouponResult =
  | {
      valid: true;
      coupon: DiscountCode;
      discountCents: number;
      freeShipping: boolean;
      applicableSubtotalCents: number;
      applicableItemIds: string[];
      discountMessage: string;
      scopeMessage: string;
    }
  | {
      valid: false;
      code: string;
      message: string;
      extra?: Record<string, unknown>;
    };

const invalid = (
  code: string,
  message: string,
  extra?: Record<string, unknown>
): CouponResult => ({ valid: false, code, message, extra });

/** Carga variantes activas con precio y categoría desde la BD. */
export async function loadCartLines(
  supabase: SupabaseClient,
  items: { variant_id: string; quantity: number }[]
): Promise<{ lines: CartLine[]; missing: string[] }> {
  const ids = [...new Set(items.map(i => i.variant_id).filter(Boolean))];
  if (ids.length === 0) return { lines: [], missing: [] };

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, price_cents, product_id, products!inner(category_id)')
    .in('id', ids)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (error) throw error;

  // deno-lint-ignore no-explicit-any
  const byId = new Map((data ?? []).map((v: any) => [v.id, v]));
  const missing = ids.filter(id => !byId.has(id));
  const lines: CartLine[] = [];
  for (const it of items) {
    // deno-lint-ignore no-explicit-any
    const v: any = byId.get(it.variant_id);
    if (!v) continue;
    lines.push({
      variant_id: v.id,
      product_id: v.product_id,
      category_id: v.products?.category_id ?? null,
      unit_price_cents: v.price_cents,
      quantity: it.quantity,
    });
  }
  return { lines, missing };
}

function lineApplies(coupon: DiscountCode, line: CartLine): boolean {
  if (coupon.applies_to_all_products !== false) return true;
  if (coupon.applicable_product_ids?.includes(line.product_id)) return true;
  if (line.category_id && coupon.applicable_category_ids?.includes(line.category_id)) {
    return true;
  }
  return false;
}

/** Evalúa un cupón contra las líneas del carrito (precios de la BD). */
export async function evaluateCoupon(
  supabase: SupabaseClient,
  rawCode: string,
  lines: CartLine[]
): Promise<CouponResult> {
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return invalid('COUPON_INVALID', 'Código de cupón no válido');

  const { data, error } = await supabase
    .from('discount_codes')
    .select('*')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return invalid('COUPON_INVALID', 'Código de cupón no válido');
  const coupon = data as DiscountCode;

  const now = new Date();
  if (coupon.end_at && new Date(coupon.end_at) < now) {
    return invalid('COUPON_EXPIRED', 'Cupón expirado');
  }
  if (coupon.start_at && new Date(coupon.start_at) > now) {
    return invalid('COUPON_NOT_STARTED', 'Cupón aún no está disponible');
  }

  const applicable = lines.filter(l => lineApplies(coupon, l));
  if (coupon.applies_to_all_products === false && applicable.length === 0) {
    return invalid(
      'COUPON_NOT_APPLICABLE',
      'Este cupón no aplica a ningún producto en tu carrito'
    );
  }

  const applicableSubtotalCents = applicable.reduce(
    (sum, l) => sum + l.unit_price_cents * l.quantity,
    0
  );

  if (coupon.min_order_cents && applicableSubtotalCents < coupon.min_order_cents) {
    return invalid(
      'COUPON_MIN_ORDER',
      `Mínimo de compra: $${(coupon.min_order_cents / 100).toLocaleString('es-CO')} (en productos aplicables)`,
      { minOrderCents: coupon.min_order_cents, applicableSubtotalCents }
    );
  }

  if (coupon.max_redemptions_total) {
    const { data: available, error: availErr } = await supabase.rpc(
      'check_coupon_availability',
      {
        p_discount_id: coupon.id,
        p_max_redemptions_total: coupon.max_redemptions_total,
      }
    );
    if (availErr) throw availErr;
    if (!available) {
      return invalid(
        'COUPON_EXHAUSTED',
        `Este cupón ya alcanzó el máximo de ${coupon.max_redemptions_total} usos`
      );
    }
  }

  let discountCents = 0;
  let freeShipping = false;
  let discountMessage = '';
  if (coupon.type === 'PERCENT') {
    const pct = Math.max(0, Math.min(100, coupon.value_percent ?? 0));
    discountCents = Math.floor((applicableSubtotalCents * pct) / 100);
    discountMessage = `${pct}% de descuento`;
  } else if (coupon.type === 'FIXED') {
    discountCents = Math.max(
      0,
      Math.min(coupon.value_cents ?? 0, applicableSubtotalCents)
    );
    discountMessage = `$${((coupon.value_cents ?? 0) / 100).toLocaleString('es-CO')} de descuento`;
  } else if (coupon.type === 'FREE_SHIPPING') {
    freeShipping = true;
    discountMessage = 'Envío gratis';
  }

  const scopeMessage =
    coupon.applies_to_all_products === false
      ? `Aplica a ${applicable.length} producto${applicable.length > 1 ? 's' : ''}`
      : 'Aplica a todos los productos';

  return {
    valid: true,
    coupon,
    discountCents,
    freeShipping,
    applicableSubtotalCents,
    applicableItemIds: applicable.map(l => l.variant_id),
    discountMessage,
    scopeMessage,
  };
}

/** Envío calculado en servidor. Configurable con SHIPPING_FLAT_CENTS y
 *  FREE_SHIPPING_MIN_CENTS (por defecto 0: envío gratis, como muestra la tienda). */
export function computeShippingCents(subtotalCents: number): number {
  const flat = Math.max(0, Number(Deno.env.get('SHIPPING_FLAT_CENTS') ?? '0') || 0);
  const freeFrom = Number(Deno.env.get('FREE_SHIPPING_MIN_CENTS') ?? '');
  if (Number.isFinite(freeFrom) && freeFrom > 0 && subtotalCents >= freeFrom) return 0;
  return flat;
}
