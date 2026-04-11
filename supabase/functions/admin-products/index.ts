// supabase/functions/admin-products/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, PostgrestError } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, origin, x-requested-with",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const err = (message: string, status = 400, extra?: Record<string, unknown>) =>
  json({ ok: false, error: message, ...extra }, status);

function mapPgErr(e: PostgrestError) {
  if (e.code === "23505") return err("Conflicto: valor único ya existe (slug/sku).", 409, { code: e.code, details: e.message });
  if (e.code === "22P02") return err("Dato inválido (UUID/número).", 400, { code: e.code, details: e.message });
  if (e.code === "PGRST116") return err("Recurso no encontrado.", 404, { code: e.code, details: e.message });
  return err("Error de base de datos.", 400, { code: e.code, details: e.message });
}

function pathParts(u: URL) {
  const segs = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const i = segs.findIndex(s => s === "products" || s === "variants");
  if (i >= 0) return segs.slice(i);
  return segs;
}

function sb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Garantiza exactamente 1 variante default — 1 sola llamada al servidor
async function ensureSingleDefault(supabase: ReturnType<typeof sb>, productId: string) {
  const { error } = await supabase.rpc("ensure_single_default_variant", {
    p_product_id: productId,
  });
  if (error) throw error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const parts = pathParts(url);
  const method = req.method;
  const s = sb();

  try {
    // ---------------- PRODUCTS ----------------

    // GET /products/list?page=1&pageSize=20
    if (method === "GET" && parts[0] === "products" && parts[1] === "list") {
      const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
      const pageSize = Math.min(Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")), 100);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await s
        .from("products")
        .select(
          `id, name, slug, images, is_active, store, created_at,
           category:categories(id, name),
           default_variant:product_variants(price_cents)`,
          { count: "exact" },
        )
        .is("deleted_at", null)
        .eq("product_variants.is_default", true)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) return mapPgErr(error);

      const mapped = data.map(p => ({
        ...p,
        category_id: p.category?.id || null,
        category_name: p.category?.name || null,
        category: undefined,
        default_price_cents: p.default_variant?.[0]?.price_cents ?? null,
      }));

      return json({ ok: true, page, pageSize, total: count ?? 0, data: mapped });
    }

    // GET /products/:id
    if (method === "GET" && parts[0] === "products" && parts[1] && parts[1] !== "list" && parts[2] !== "variants") {
      const productId = parts[1];
      const { data, error } = await s
        .from("products")
        .select(`id, name, slug, description, long_description, images, features, ingredients,
                 nutrition_facts, tags, seo_title, seo_description, is_featured, is_active, store,
                 created_at, updated_at, deleted_at,
                 category:categories(id, name)`)
        .eq("id", productId)
        .maybeSingle();

      if (error) return mapPgErr(error);
      if (!data) return err("Producto no encontrado", 404);
      return json({ ok: true, data });
    }

    // POST /products  (crea producto + variantes vía RPC)
    if (method === "POST" && parts[0] === "products" && parts.length === 1) {
      const payload = await req.json().catch(() => null);
      if (!payload || !payload.product || !Array.isArray(payload.variants)) {
        return err("Payload inválido: se requiere { product, variants[] }", 400);
      }

      const name = String(payload.product?.name ?? "").trim();
      const slug = String(payload.product?.slug ?? "").trim();
      const store = String(payload.product?.store ?? "CH+").trim();

      if (!name || !slug) return err("name y slug son obligatorios en product", 400);
      if (payload.variants.length < 1) return err("Se requiere al menos una variante", 400);
      if (store !== "CH+" && store !== "MoveOn") return err("store debe ser 'CH+' o 'MoveOn'", 400);

      const { data, error } = await s.rpc("create_product_with_variants", { p_payload: payload });
      if (error) return mapPgErr(error);
      return json({ ok: true, data }, 201);
    }

    // PUT /products/:id
    if (method === "PUT" && parts[0] === "products" && parts[1] && parts[2] !== "variants") {
      const productId = parts[1];
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return err("JSON inválido", 400);

      if (body.store !== undefined) {
        const store = String(body.store ?? "").trim();
        if (store !== "CH+" && store !== "MoveOn") return err("store debe ser 'CH+' o 'MoveOn'", 400);
      }

      const { data, error } = await s
        .from("products")
        .update(body)
        .eq("id", productId)
        .select(`id, name, slug, description, long_description, images, features, ingredients,
                 nutrition_facts, tags, seo_title, seo_description, is_featured, is_active, store,
                 created_at, updated_at, deleted_at,
                 category:categories(id, name)`)
        .maybeSingle();

      if (error) return mapPgErr(error);
      if (!data) return err("Producto no encontrado", 404);
      return json({ ok: true, data });
    }

    // DELETE /products/:id  (soft delete)
    if (method === "DELETE" && parts[0] === "products" && parts[1]) {
      const productId = parts[1];
      const { error } = await s
        .from("products")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", productId);

      if (error) return mapPgErr(error);
      return json({ ok: true });
    }

    // ---------------- VARIANTS ----------------

    // GET /products/:id/variants
    if (method === "GET" && parts[0] === "products" && parts[1] && parts[2] === "variants") {
      const productId = parts[1];
      const { data, error } = await s
        .from("product_variants")
        .select("id, product_id, sku, label, flavor, size, options, price_cents, compare_at_price_cents, currency, in_stock, low_stock_threshold, weight_grams, dimensions, images, position, is_default, is_active, created_at, updated_at, deleted_at")
        .eq("product_id", productId)
        .is("deleted_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) return mapPgErr(error);
      return json({ ok: true, data });
    }

    // POST /products/:id/variants
    if (method === "POST" && parts[0] === "products" && parts[1] && parts[2] === "variants" && parts.length === 3) {
      const productId = parts[1];
      const variant = await req.json().catch(() => null);
      if (!variant || typeof variant !== "object") return err("JSON inválido", 400);

      const sku = String(variant.sku ?? "").trim();
      const label = String(variant.label ?? "").trim();
      const price = Number(variant.price_cents ?? -1);
      const stock = Number(variant.in_stock ?? 0);

      if (!sku || !label) return err("sku y label son obligatorios", 400);
      if (price < 0) return err("price_cents debe ser >= 0", 400);
      if (stock < 0) return err("in_stock debe ser >= 0", 400);

      // Si is_default=true, desmarcar otras del producto
      if (variant.is_default === true) {
        const { error: uAllErr } = await s
          .from("product_variants")
          .update({ is_default: false })
          .eq("product_id", productId)
          .is("deleted_at", null);
        if (uAllErr) return mapPgErr(uAllErr);
      }

      const { data, error } = await s
        .from("product_variants")
        .insert([{ ...variant, product_id: productId }])
        .select("*")
        .maybeSingle();

      if (error) return mapPgErr(error);
      if (!data) return err("No se pudo crear la variante", 400);

      await ensureSingleDefault(s, productId);
      return json({ ok: true, data }, 201);
    }

    // PUT /variants/:variantId
    if (method === "PUT" && parts[0] === "variants" && parts[1]) {
      const variantId = parts[1];
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return err("JSON inválido", 400);

      const { data: prev, error: prevErr } = await s
        .from("product_variants")
        .select("product_id")
        .eq("id", variantId)
        .maybeSingle();
      if (prevErr) return mapPgErr(prevErr);
      if (!prev) return err("Variante no encontrada", 404);

      const productId = prev.product_id as string;

      if (body.is_default === true) {
        const { error: uAllErr } = await s
          .from("product_variants")
          .update({ is_default: false })
          .eq("product_id", productId)
          .is("deleted_at", null);
        if (uAllErr) return mapPgErr(uAllErr);
      }

      const { data, error } = await s
        .from("product_variants")
        .update(body)
        .eq("id", variantId)
        .select("*")
        .maybeSingle();

      if (error) return mapPgErr(error);
      if (!data) return err("Variante no encontrada", 404);

      await ensureSingleDefault(s, productId);
      return json({ ok: true, data });
    }

    // DELETE /variants/:variantId  (soft delete)
    if (method === "DELETE" && parts[0] === "variants" && parts[1]) {
      const variantId = parts[1];

      const { data: prev, error: prevErr } = await s
        .from("product_variants")
        .select("product_id, is_default")
        .eq("id", variantId)
        .maybeSingle();
      if (prevErr) return mapPgErr(prevErr);
      if (!prev) return err("Variante no encontrada", 404);

      const productId = prev.product_id as string;

      const { error } = await s
        .from("product_variants")
        .update({ deleted_at: new Date().toISOString(), is_active: false, is_default: false })
        .eq("id", variantId);
      if (error) return mapPgErr(error);

      await ensureSingleDefault(s, productId);
      return json({ ok: true });
    }

    return err(`Ruta no soportada: ${method} ${url.pathname}`, 405, {
      supported: [
        "GET /products/list",
        "GET /products/:id",
        "POST /products",
        "PUT /products/:id",
        "DELETE /products/:id",
        "GET /products/:id/variants",
        "POST /products/:id/variants",
        "PUT /variants/:variantId",
        "DELETE /variants/:variantId",
      ],
    });
  } catch (e) {
    console.error("Unexpected error:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Error interno del servidor", timestamp: new Date().toISOString() }, 500);
  }
}, { onError: (e) => console.error("Server error:", e) });
