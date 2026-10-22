// supabase/functions/order-status/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

function cors(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors({ ok: true });

  console.log('🚀 [ORDER-STATUS] Iniciando función order-status');
  console.log('📥 [ORDER-STATUS] Método:', req.method);
  console.log('📥 [ORDER-STATUS] URL:', req.url);

  try {
    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("order_number") ?? url.searchParams.get("order");
    const email = url.searchParams.get("email");
    
    console.log('🔍 [ORDER-STATUS] Parámetros recibidos:', {
      orderNumber,
      email: email ? '***@' + email.split('@')[1] : null
    });

    // El email es la prueba de propiedad: sin él cualquiera podría leer datos
    // personales enumerando order_number (que es CH + timestamp).
    if (!orderNumber || !email) {
      console.log('❌ [ORDER-STATUS] order_number y email requeridos');
      return cors({ error: "order_number and email required" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log('✅ [ORDER-STATUS] Cliente Supabase creado');

    console.log('🔍 [ORDER-STATUS] Buscando orden en BD...');
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .maybeSingle();

    console.log('📊 [ORDER-STATUS] Resultado búsqueda orden:', {
      found: !!order,
      error: oErr?.message || null,
      orderId: order?.id
    });

    if (oErr) {
      console.log('❌ [ORDER-STATUS] Error en consulta de orden:', oErr.message);
      throw oErr;
    }
    if (!order) {
      console.log('❌ [ORDER-STATUS] Orden no encontrada:', orderNumber);
      return cors({ error: "Order not found" }, 404);
    }
    if (String(order.email).trim().toLowerCase() !== email.trim().toLowerCase()) {
      // Misma respuesta que "no existe" para no revelar qué pedidos existen
      console.log('❌ [ORDER-STATUS] Email no coincide para la orden');
      return cors({ error: "Order not found" }, 404);
    }

    console.log('🔍 [ORDER-STATUS] Buscando items de la orden...');
    const { data: items, error: iErr } = await supabase
      .from("order_items")
      .select("product_id, variant_id, name_snapshot, variant_label, unit_price_cents, quantity")
      .eq("order_id", order.id);

    console.log('📊 [ORDER-STATUS] Resultado búsqueda items:', {
      found: items?.length || 0,
      error: iErr?.message || null
    });

    if (iErr) {
      console.log('❌ [ORDER-STATUS] Error en consulta de items:', iErr.message);
      throw iErr;
    }

    console.log('🔍 [ORDER-STATUS] Buscando descuentos de la orden...');
    const { data: discounts, error: dErr } = await supabase
      .from("order_discounts")
      .select("code_snapshot, type_snapshot, amount_applied_cents, created_at")
      .eq("order_id", order.id);

    console.log('📊 [ORDER-STATUS] Resultado búsqueda descuentos:', {
      found: discounts?.length || 0,
      error: dErr?.message || null
    });

    if (dErr) {
      console.log('❌ [ORDER-STATUS] Error en consulta de descuentos:', dErr.message);
      throw dErr;
    }

    console.log('✅ [ORDER-STATUS] Preparando respuesta con datos de la orden:', {
      order_number: order.order_number,
      status: order.status,
      payment_status: order.payment_status,
      itemsCount: items?.length || 0,
      discountsCount: discounts?.length || 0
    });

    return cors({
      order: {
        id: order.id,
        order_number: order.order_number,
        email: order.email,
        status: order.status,
        payment_status: order.payment_status,
        subtotal_cents: order.subtotal_cents,
        shipping_cents: order.shipping_cents,
        discount_cents: order.discount_cents,
        total_cents: order.total_cents,
        currency: order.currency,
        shipping_address: order.shipping_address,
        billing_address: order.billing_address,
        payment_provider: order.payment_provider,
        payment_preference_id: order.payment_preference_id,
        payment_id: order.payment_id,
        payment_external_reference: order.payment_external_reference,
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
      items,
      discounts,
    });
  } catch (e) {
    console.log('💥 [ORDER-STATUS] Error no manejado:', {
      error: String(e),
      stack: e instanceof Error ? e.stack : null
    });
    return cors({ error: String(e) }, 400);
  }
});
