// supabase/functions/validate-cart-stock/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

interface StockValidationRequest {
  variant_ids: string[];
}

interface StockValidationResponse {
  variant_id: string;
  stock: number;
  is_active: boolean;
  low_stock_threshold: number | null;
  price_cents: number;
  currency: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors({ ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const { variant_ids } = body as StockValidationRequest;

    if (!variant_ids || !Array.isArray(variant_ids) || variant_ids.length === 0) {
      return cors({ error: "variant_ids array requerido" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Query optimizado: solo campos necesarios para validación de stock
    const { data: variants, error } = await supabase
      .from("product_variants")
      .select(`
        id,
        in_stock,
        is_active,
        low_stock_threshold,
        price_cents,
        currency
      `)
      .in("id", variant_ids);

    if (error) {
      return cors({ error: "Error de base de datos", detail: error.message }, 400);
    }

    // Crear mapa para respuesta rápida
    const stockMap = new Map<string, StockValidationResponse>();
    
    variants?.forEach((variant) => {
      stockMap.set(variant.id, {
        variant_id: variant.id,
        stock: variant.in_stock || 0,
        is_active: variant.is_active || false,
        low_stock_threshold: variant.low_stock_threshold,
        price_cents: variant.price_cents || 0,
        currency: variant.currency || 'COP'
      });
    });

    // Retornar solo los datos solicitados
    const response = variant_ids.map(variant_id => 
      stockMap.get(variant_id) || {
        variant_id,
        stock: 0,
        is_active: false,
        low_stock_threshold: null,
        price_cents: 0,
        currency: 'COP'
      }
    );

    return cors({
      success: true,
      data: response,
      count: response.length
    });

  } catch (e: unknown) {
    const msg = (e && (e as Error).message) ? (e as Error).message : String(e);
    return cors({ error: "Error interno", detail: msg }, 500);
  }
});
