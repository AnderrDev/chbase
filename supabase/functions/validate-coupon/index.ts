// supabase/functions/validate-coupon/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const { code, subtotalCents, cartItems } = body;

    if (!code) {
      return cors({ error: 'Código de cupón requerido' }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const couponCode = String(code).toUpperCase();

    // Buscar el cupón con información de scope
    const { data: coupon, error } = await supabase
      .from('discount_codes')
      .select(
        `
        *,
        applicable_product_ids,
        applicable_category_ids,
        applies_to_all_products
      `
      )
      .eq('code', couponCode)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return cors(
        { error: 'Error de base de datos', detail: error.message },
        400
      );
    }

    if (!coupon) {
      return cors({
        valid: false,
        message: 'Código de cupón no válido',
      });
    }

    // Validar fecha de expiración
    const now = new Date();
    if (coupon.end_at && new Date(coupon.end_at) < now) {
      return cors({
        valid: false,
        message: 'Cupón expirado',
      });
    }

    if (coupon.start_at && new Date(coupon.start_at) > now) {
      return cors({
        valid: false,
        message: 'Cupón aún no está disponible',
      });
    }

    // Determinar subtotal aplicable basado en scope del cupón
    let applicableSubtotalCents = subtotalCents || 0;
    let applicableItemIds: string[] = [];
    let scopeMessage = '';

    if (!coupon.applies_to_all_products) {
      // Cupón para productos específicos - validar scope
      if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
        return cors({
          valid: false,
          message: 'Este cupón requiere información de productos del carrito',
        });
      }

      // Obtener información de productos y categorías del carrito
      const variantIds = cartItems
        .map((item: any) => item.variant_id)
        .filter(Boolean);

      if (variantIds.length === 0) {
        return cors({
          valid: false,
          message: 'No se encontraron productos válidos en el carrito',
        });
      }

      // Consultar productos y categorías de los items del carrito
      const { data: cartProducts, error: cartError } = await supabase
        .from('product_variants')
        .select(
          `
          id,
          product_id,
          products!inner(
            id,
            category_id,
            name
          )
        `
        )
        .in('id', variantIds);

      if (cartError) {
        return cors(
          {
            error: 'Error al validar productos del carrito',
            detail: cartError.message,
          },
          400
        );
      }

      // Filtrar items aplicables
      const applicableItems =
        cartProducts?.filter((item: any) => {
          const productId = item.product_id;
          const categoryId = item.products?.category_id;

          // Verificar si aplica por producto específico
          if (
            coupon.applicable_product_ids &&
            coupon.applicable_product_ids.length > 0
          ) {
            if (coupon.applicable_product_ids.includes(productId)) {
              return true;
            }
          }

          // Verificar si aplica por categoría
          if (
            coupon.applicable_category_ids &&
            coupon.applicable_category_ids.length > 0
          ) {
            if (
              categoryId &&
              coupon.applicable_category_ids.includes(categoryId)
            ) {
              return true;
            }
          }

          return false;
        }) || [];

      if (applicableItems.length === 0) {
        return cors({
          valid: false,
          message: 'Este cupón no aplica a ningún producto en tu carrito',
        });
      }

      // Calcular subtotal solo de productos aplicables
      applicableItemIds = applicableItems.map((item: any) => item.id);
      applicableSubtotalCents = cartItems
        .filter((item: any) => applicableItemIds.includes(item.variant_id))
        .reduce(
          (sum: number, item: any) =>
            sum + item.unit_price_cents * item.quantity,
          0
        );

      scopeMessage = `Aplica a ${applicableItems.length} producto${applicableItems.length > 1 ? 's' : ''}`;
    } else {
      // Cupón para todos los productos
      scopeMessage = 'Aplica a todos los productos';
    }

    // Validar mínimo de compra sobre el subtotal aplicable
    if (
      coupon.min_order_cents &&
      applicableSubtotalCents < coupon.min_order_cents
    ) {
      return cors({
        valid: false,
        message: `Mínimo de compra: $${(coupon.min_order_cents / 100).toLocaleString('es-CO')} (en productos aplicables)`,
        minOrderCents: coupon.min_order_cents,
        applicableSubtotalCents,
      });
    }

    // Calcular descuento sobre el subtotal aplicable
    let discountCents = 0;
    let discountMessage = '';

    if (coupon.type === 'PERCENT') {
      discountCents = Math.floor(
        (applicableSubtotalCents *
          Math.max(0, Math.min(100, coupon.value_percent ?? 0))) /
          100
      );
      discountMessage = `${coupon.value_percent}% de descuento`;
    } else if (coupon.type === 'FIXED') {
      discountCents = Math.max(
        0,
        Math.min(coupon.value_cents ?? 0, applicableSubtotalCents)
      );
      discountMessage = `$${(coupon.value_cents / 100).toLocaleString('es-CO')} de descuento`;
    } else if (coupon.type === 'FREE_SHIPPING') {
      discountMessage = 'Envío gratis';
    }

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
      discountCents,
      discountMessage,
      applicableSubtotalCents,
      applicableItemIds,
      scopeMessage,
      message: `Cupón válido: ${discountMessage} (${scopeMessage})`,
    });
  } catch (e: unknown) {
    const msg = e && (e as Error).message ? (e as Error).message : String(e);
    return cors({ error: 'Error interno', detail: msg }, 400);
  }
});
