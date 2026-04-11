// supabase/functions/create-preference/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;

type CartItem = { variant_id: string; quantity: number };
type Payload = {
  email: string;
  items: CartItem[];
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  couponCode?: string;
  shippingCents?: number;
  currency?: string;
};

const mpFetch = (path: string, init?: RequestInit) =>
  fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

function cors(json: unknown, status = 200) {
  // Asegúrate de no devolver objetos crudos en "error"
  const body =
    typeof json === 'object'
      ? JSON.stringify(json, (_k, v) =>
          v instanceof Error ? String(v.message) : v
        )
      : String(json);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors({ ok: true });

  console.log('🚀 [CREATE-PREFERENCE] Iniciando función create-preference');
  console.log('📥 [CREATE-PREFERENCE] Método:', req.method);
  console.log('📥 [CREATE-PREFERENCE] URL:', req.url);

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log('✅ [CREATE-PREFERENCE] Cliente Supabase creado');

    // Obtener el origen de manera más robusta
    const origin = (() => {
      // 1. Intentar desde headers (más confiable en producción)
      const forwardedHost = req.headers.get('x-forwarded-host');
      const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
      if (forwardedHost && !forwardedHost.includes('edge-runtime')) {
        return `${forwardedProto}://${forwardedHost}`;
      }

      // 2. Intentar desde el host header
      const host = req.headers.get('host');
      if (host && !host.includes('edge-runtime')) {
        return `https://${host}`;
      }

      // 3. Usar variable de entorno si está disponible
      const envOrigin = Deno.env.get('VITE_APP_URL') || Deno.env.get('APP_URL');
      if (envOrigin) {
        return envOrigin.replace(/\/+$/, ''); // Remover trailing slashes
      }

      // 4. Fallback a la URL de la request (solo si no es edge-runtime)
      const requestOrigin = new URL(req.url).origin;
      if (!requestOrigin.includes('edge-runtime')) {
        return requestOrigin;
      }

      // 5. Último fallback - usar un dominio por defecto
      console.warn(
        '⚠️ No se pudo detectar el origin correcto, usando fallback'
      );
      return 'https://uxhzkpcmufatvrzzuskq.supabase.co'; // URL de Supabase
    })();

    const body = (await req.json().catch(() => null)) as Payload | null;
    console.log('📦 [CREATE-PREFERENCE] Payload recibido:', {
      hasEmail: !!body?.email,
      itemsCount: body?.items?.length || 0,
      hasShippingAddress: !!body?.shippingAddress,
      hasBillingAddress: !!body?.billingAddress,
      couponCode: body?.couponCode,
      currency: body?.currency
    });

    if (!body?.email || !Array.isArray(body.items) || body.items.length === 0) {
      console.log('❌ [CREATE-PREFERENCE] Payload inválido:', {
        hasEmail: !!body?.email,
        hasItems: Array.isArray(body?.items),
        itemsLength: body?.items?.length || 0
      });
      return cors(
        { error: 'Invalid payload', detail: 'email e items[] son requeridos' },
        400
      );
    }

    const currency = body.currency ?? 'COP';
    const shippingCents = Math.max(0, body.shippingCents ?? 0);

    // 1) Variantes activas/no borradas
    const variantIds = body.items.map(i => i.variant_id);
    console.log('🔍 [CREATE-PREFERENCE] Buscando variantes:', {
      variantIds,
      itemsCount: body.items.length
    });

    const { data: rows, error: rowsErr } = await supabase
      .from('product_variants')
      .select('id, label, price_cents, in_stock, product_id, products(name)')
      .in('id', variantIds)
      .eq('is_active', true)
      .is('deleted_at', null);

    console.log('📊 [CREATE-PREFERENCE] Resultado consulta variantes:', {
      found: rows?.length || 0,
      requested: variantIds.length,
      error: rowsErr?.message || null
    });

    if (rowsErr) {
      return cors(
        {
          error: 'DB error (variants)',
          detail: rowsErr.message || String(rowsErr),
        },
        400
      );
    }

    if (!rows || rows.length !== variantIds.length) {
      const foundIds = rows?.map(r => r.id) || [];
      const missingIds = variantIds.filter(id => !foundIds.includes(id));
      return cors(
        {
          error: 'Some variants not found',
          detail: `Missing variants: ${missingIds.join(', ')}`,
          requested: variantIds,
          found: foundIds,
        },
        400
      );
    }
    const mapVariant = new Map(rows.map(r => [r.id, r]));

    // 2) Subtotal + stock
    let subtotal = 0;
    console.log('💰 [CREATE-PREFERENCE] Calculando subtotal y validando stock...');
    
    for (const it of body.items) {
      const v = mapVariant.get(it.variant_id);
      console.log(`🔍 [CREATE-PREFERENCE] Procesando item:`, {
        variant_id: it.variant_id,
        quantity: it.quantity,
        variant: v ? { label: v.label, price_cents: v.price_cents, in_stock: v.in_stock } : null
      });

      if (!v) {
        console.log(`❌ [CREATE-PREFERENCE] Variante no encontrada: ${it.variant_id}`);
        return cors({ error: `Variant not found: ${it.variant_id}` }, 400);
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        console.log(`❌ [CREATE-PREFERENCE] Cantidad inválida:`, {
          variant_id: it.variant_id,
          quantity: it.quantity
        });
        return cors(
          {
            error: 'Invalid quantity',
            detail: `variant_id=${it.variant_id}, qty=${it.quantity}`,
          },
          400
        );
      }
      if (v.in_stock < it.quantity) {
        console.log(`❌ [CREATE-PREFERENCE] Stock insuficiente:`, {
          label: v.label,
          in_stock: v.in_stock,
          requested: it.quantity
        });
        return cors(
          {
            error: 'Insufficient stock',
            detail: `${v.label}: ${v.in_stock} < ${it.quantity}`,
          },
          400
        );
      }
      subtotal += v.price_cents * it.quantity;
    }

    console.log('✅ [CREATE-PREFERENCE] Subtotal calculado:', {
      subtotal,
      currency,
      shippingCents
    });

    // 3) Cupón
    let discountCents = 0;
    let finalShipping = shippingCents;
    let discountRow: {
      id: string;
      code: string;
      discount_percentage: number;
      discount_amount_cents: number;
      is_active: boolean;
    } | null = null;

    if (body.couponCode) {
      const code = String(body.couponCode).toUpperCase();
      console.log('🎫 [CREATE-PREFERENCE] Validando cupón:', { code });
      
      const { data: dc, error: dcErr } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .maybeSingle();

      console.log('🎫 [CREATE-PREFERENCE] Resultado validación cupón:', {
        found: !!dc,
        error: dcErr?.message || null,
        code
      });
      if (dcErr)
        return cors(
          {
            error: 'DB error (discount)',
            detail: dcErr.message || String(dcErr),
          },
          400
        );

      if (dc) {
        // Validar límite de usos totales del cupón (incluyendo reservas activas)
        if (dc.max_redemptions_total) {
          const { data: availability, error: availabilityError } =
            await supabase.rpc('check_coupon_availability', {
              p_discount_id: dc.id,
              p_max_redemptions_total: dc.max_redemptions_total,
            });

          if (availabilityError) {
            return cors(
              {
                error: 'Error verificando disponibilidad del cupón',
                detail: availabilityError.message || String(availabilityError),
              },
              400
            );
          }

          if (!availability) {
            return cors(
              {
                error: 'Cupón agotado',
                message: `Este cupón ya alcanzó el máximo de ${dc.max_redemptions_total} usos`,
                code: 'COUPON_EXHAUSTED',
              },
              400
            );
          }
        }

        discountRow = dc;
        if (dc.type === 'PERCENT') {
          discountCents = Math.floor(
            (subtotal * Math.max(0, Math.min(100, dc.value_percent ?? 0))) / 100
          );
        } else if (dc.type === 'FIXED') {
          discountCents = Math.max(0, Math.min(dc.value_cents ?? 0, subtotal));
        } else if (dc.type === 'FREE_SHIPPING') {
          finalShipping = 0;
        }
      }
    }

    const total = Math.max(0, subtotal + finalShipping - discountCents);
    const orderNumber = `CH${Date.now()}`;

    console.log('🧮 [CREATE-PREFERENCE] Totales calculados:', {
      subtotal,
      shipping: finalShipping,
      discount: discountCents,
      total,
      currency,
      orderNumber
    });

    // 4) Orden
    console.log('📝 [CREATE-PREFERENCE] Creando orden en BD...');
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        email: body.email,
        status: 'CREATED',
        subtotal_cents: subtotal,
        shipping_cents: finalShipping,
        discount_cents: discountCents,
        total_cents: total,
        currency,
        shipping_address: body.shippingAddress ?? null,
        billing_address: body.billingAddress ?? null,
        payment_provider: 'MERCADO_PAGO',
        payment_status: 'PENDING',
        payment_external_reference: orderNumber,
      })
      .select('id')
      .single();

    console.log('📝 [CREATE-PREFERENCE] Resultado creación orden:', {
      success: !!order,
      orderId: order?.id,
      error: oErr?.message || null
    });
    if (oErr)
      return cors(
        {
          error: 'DB error (order insert)',
          detail: oErr.message || String(oErr),
        },
        400
      );

    // 5) Items
    const itemsToInsert = body.items.map(it => {
      const v = mapVariant.get(it.variant_id)!;
      const name = v.products?.name ?? '';
      return {
        order_id: order.id,
        product_id: v.product_id,
        variant_id: v.id,
        name_snapshot: name,
        variant_label: v.label,
        unit_price_cents: v.price_cents,
        quantity: it.quantity,
      };
    });
    const { error: oiErr } = await supabase
      .from('order_items')
      .insert(itemsToInsert);
    if (oiErr)
      return cors(
        {
          error: 'DB error (order_items)',
          detail: oiErr.message || String(oiErr),
        },
        400
      );

    // 6) Crear reserva temporal del cupón (no se descuenta hasta confirmar pago)
    if (discountRow) {
      // Verificar si ya existe una reserva para esta orden y cupón
      const { data: existingReservation } = await supabase
        .from('coupon_reservations')
        .select('id')
        .eq('order_id', order.id)
        .eq('discount_id', discountRow.id)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (!existingReservation) {
        // Solo crear reserva si no existe una activa
        const { data: reservationId, error: reservationError } =
          await supabase.rpc('create_coupon_reservation', {
            p_order_id: order.id,
            p_discount_id: discountRow.id,
            p_code_snapshot: discountRow.code,
            p_type_snapshot: discountRow.type,
            p_value_percent_snapshot: discountRow.value_percent ?? null,
            p_value_cents_snapshot: discountRow.value_cents ?? null,
            p_amount_applied_cents: discountCents,
            p_currency: currency,
          });

        if (reservationError) {
          return cors(
            {
              error: 'Error creando reserva del cupón',
              detail: reservationError.message || String(reservationError),
            },
            400
          );
        }
      } else {
        console.log(
          '🎫 Reserva ya existe para esta orden y cupón, reutilizando'
        );
      }
    }

    // 7) Preferencia MP
    let mpItems;

    if (discountCents > 0) {
      // Si hay descuento, crear un item consolidado con el precio final
      // MercadoLibre requiere unit_price como entero en pesos

      mpItems = [
        {
          title: `Compra con descuento ${discountRow?.code || 'Cupón'} aplicado`,
          quantity: 1,
          unit_price: Math.round(total / 100), // Convertir centavos a pesos y redondear a entero
          currency_id: currency,
        },
      ];
    } else {
      // Sin descuento, usar precios originales por item
      mpItems = body.items.map(it => {
        const v = mapVariant.get(it.variant_id)!;
        return {
          title: v.label,
          quantity: it.quantity,
          unit_price: Math.round(v.price_cents / 100), // Convertir centavos a pesos y redondear a entero
          currency_id: currency,
        };
      });
    }

    // Construir URLs de retorno
    const backUrls = {
      success: `${origin}/success?external_reference=${orderNumber}&email=${encodeURIComponent(body.email)}`,
      pending: `${origin}/pending?external_reference=${orderNumber}&email=${encodeURIComponent(body.email)}`,
      failure: `${origin}/failure?external_reference=${orderNumber}&email=${encodeURIComponent(body.email)}`,
    };

    const notificationUrl = `${SUPABASE_URL}/functions/v1/mp-webhook`;

    // Log para debug (remover en producción)
    console.log('🔍 [CREATE-PREFERENCE] Headers recibidos:', {
      'x-forwarded-host': req.headers.get('x-forwarded-host'),
      'x-forwarded-proto': req.headers.get('x-forwarded-proto'),
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
    });

    console.log('🔗 [CREATE-PREFERENCE] MercadoPago URLs configuradas:', {
      origin,
      backUrls,
      notificationUrl,
      orderNumber,
    });

    // Log antes de enviar a MercadoPago
    console.log('📤 [CREATE-PREFERENCE] Enviando preferencia a MercadoPago:', {
      items: mpItems,
      external_reference: orderNumber,
      back_urls: backUrls,
      notification_url: notificationUrl,
      auto_return: 'approved',
      binary_mode: true,
    });

    const prefRes = await mpFetch('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: mpItems,
        external_reference: orderNumber,
        back_urls: backUrls,
        notification_url: notificationUrl,
        auto_return: 'approved', // Habilitar autoreturn para pagos aprobados
        binary_mode: true, // Evitar estados intermedios
      }),
    });
    if (!prefRes.ok) {
      const t = await prefRes.text().catch(() => '');
      console.log('❌ [CREATE-PREFERENCE] Error de MercadoPago:', {
        status: prefRes.status,
        statusText: prefRes.statusText,
        response: t,
      });
      return cors(
        { error: 'MercadoPago error', detail: t || 'HTTP ' + prefRes.status },
        400
      );
    }
    const pref = await prefRes.json();
    console.log('✅ [CREATE-PREFERENCE] Preferencia creada exitosamente:', {
      preference_id: pref.id,
      init_point: pref.init_point,
      sandbox_init_point: pref.sandbox_init_point,
    });

    // 8) Guardar preference_id
    console.log('💾 [CREATE-PREFERENCE] Guardando preference_id en BD...');
    const { error: upErr } = await supabase
      .from('orders')
      .update({ payment_preference_id: pref.id })
      .eq('id', order.id);

    console.log('💾 [CREATE-PREFERENCE] Resultado guardado preference_id:', {
      success: !upErr,
      error: upErr?.message || null
    });

    if (upErr)
      return cors(
        {
          error: 'DB error (update preference_id)',
          detail: upErr.message || String(upErr),
        },
        400
      );

    console.log('🎉 [CREATE-PREFERENCE] Función completada exitosamente:', {
      order_number: orderNumber,
      preference_id: pref.id,
      total_cents: total,
      currency
    });

    return cors({
      order_number: orderNumber,
      preference_id: pref.id,
      init_point: pref.init_point ?? null,
      sandbox_init_point: pref.sandbox_init_point ?? null,
      total_cents: total,
      currency,
    });
  } catch (e: unknown) {
    // Asegura strings en error/detail
    const msg = e && (e as Error).message ? (e as Error).message : String(e);
    console.log('💥 [CREATE-PREFERENCE] Error no manejado:', {
      error: msg,
      stack: e instanceof Error ? e.stack : null
    });
    return cors({ error: 'Unhandled error', detail: msg }, 400);
  }
});
