// supabase/functions/related-products/index.ts
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

interface RelatedProductsRequest {
  product_id?: string;
  category_name?: string;
  exclude_slug?: string;
  limit?: number;
  store?: string;
}

interface RelatedProduct {
  product_id: string;
  name: string;
  slug: string;
  description: string;
  images: string[];
  category_name: string;
  store: string;
  is_featured: boolean;
  default_price_cents: number;
  currency: string;
  in_stock: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors({ ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const { 
      product_id, 
      category_name, 
      exclude_slug, 
      limit = 6,
      store 
    } = body as RelatedProductsRequest;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Query optimizado para productos relacionados
    // Solo campos necesarios para cards de productos
    let query = supabase
      .from("catalog")
      .select(`
        product_id,
        name,
        slug,
        description,
        product_images,
        default_images,
        category_name,
        store,
        is_featured,
        default_price_cents,
        default_sku,
        default_variant_label,
        variants
      `)
      .eq("is_active", true)
      .limit(limit);

    // Filtrar por categoría si se especifica
    if (category_name) {
      query = query.eq("category_name", category_name);
    }

    // Filtrar por tienda si se especifica
    if (store) {
      query = query.eq("store", store);
    }

    // Excluir producto específico
    if (exclude_slug) {
      query = query.neq("slug", exclude_slug);
    }

    // Ordenar por featured primero, luego por nombre
    query = query.order("is_featured", { ascending: false })
                 .order("name", { ascending: true });

    const { data: products, error } = await query;

    if (error) {
      return cors({ error: "Error de base de datos", detail: error.message }, 400);
    }

    // Procesar datos para extraer información de variantes
    const processedProducts = (products || []).map((product: any) => {
      // Extraer currency y stock del primer variant activo
      const firstVariant = product.variants?.[0];
      const currency = firstVariant?.currency || 'COP';
      const inStock = firstVariant?.stock > 0 || false;
      
      // Usar default_images si está disponible, sino product_images
      const images = product.default_images || product.product_images || [];
      
      return {
        product_id: product.product_id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        images: images,
        category_name: product.category_name,
        store: product.store,
        is_featured: product.is_featured,
        default_price_cents: product.default_price_cents,
        currency: currency,
        in_stock: inStock
      } as RelatedProduct;
    });

    return cors({
      success: true,
      data: processedProducts,
      count: processedProducts.length,
      filters: {
        category_name,
        store,
        exclude_slug,
        limit
      }
    });

  } catch (e: unknown) {
    const msg = (e && (e as Error).message) ? (e as Error).message : String(e);
    return cors({ error: "Error interno", detail: msg }, 500);
  }
});
