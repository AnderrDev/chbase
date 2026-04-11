import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, PostgrestError } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, origin, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const err = (message: string, status = 400, extra?: Record<string, unknown>) =>
  json({ error: message, ...extra }, status);

function mapPgErr(e: PostgrestError) {
  if (e.code === 'PGRST116') return err('Recurso no encontrado.', 404, { code: e.code });
  if (e.code === '23505') return err('Conflicto: valor único ya existe.', 409, { code: e.code });
  if (e.code === '22P02') return err('Dato inválido (UUID/número).', 400, { code: e.code });
  return err('Error de base de datos.', 400, { code: e.code, details: e.message });
}

function sb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function lastSegment(url: URL): string {
  return url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = lastSegment(url);
  const method = req.method;
  const s = sb();

  try {
    // GET /list
    if (method === 'GET' && path === 'list') {
      const { data, error } = await s
        .from('discount_codes')
        .select(
          `id, code, type, value_percent, value_cents, currency, min_order_cents,
           max_redemptions_total, max_redemptions_per_customer, combinable,
           is_active, start_at, end_at, created_at, updated_at, deleted_at,
           applies_to_all_products, applicable_product_ids, applicable_category_ids,
           order_discounts(count)`
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) return mapPgErr(error);
      return json({ data, error: null });
    }

    // GET /active  — must be BEFORE /:id
    if (method === 'GET' && path === 'active') {
      const { data, error } = await s
        .from('discount_codes')
        .select(
          `id, code, type, value_percent, value_cents, currency, min_order_cents,
           max_redemptions_total, max_redemptions_per_customer, combinable,
           is_active, start_at, end_at, created_at, updated_at,
           applies_to_all_products, applicable_product_ids, applicable_category_ids`
        )
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) return mapPgErr(error);
      return json({ data, error: null });
    }

    // GET /:id
    if (method === 'GET' && path && path !== 'list' && path !== 'active') {
      const { data, error } = await s
        .from('discount_codes')
        .select('*')
        .eq('id', path)
        .single();

      if (error) return mapPgErr(error);
      return json({ data, error: null });
    }

    // POST /create
    if (method === 'POST' && path === 'create') {
      const discountData = await req.json().catch(() => null);
      if (!discountData || Object.keys(discountData).length === 0) {
        return err('El cuerpo de la solicitud debe contener los datos del cupón.', 400);
      }

      const { data, error } = await s
        .from('discount_codes')
        .insert([discountData])
        .select()
        .single();

      if (error) return mapPgErr(error);
      return json({ data, error: null }, 201);
    }

    // PUT (update)
    if (method === 'PUT') {
      const body = await req.json().catch(() => null);
      if (!body?.discountId || !body?.discountData) {
        return err('Se requiere discountId y discountData.', 400);
      }

      const { data, error } = await s
        .from('discount_codes')
        .update(body.discountData)
        .eq('id', body.discountId)
        .select()
        .single();

      if (error) return mapPgErr(error);
      return json({ data, error: null });
    }

    // DELETE
    if (method === 'DELETE') {
      const body = await req.json().catch(() => null);
      if (!body?.discountId) return err('Se requiere discountId.', 400);

      const { error } = await s
        .from('discount_codes')
        .delete()
        .eq('id', body.discountId);

      if (error) return mapPgErr(error);
      return json({ data: { success: true }, error: null });
    }

    // PATCH /toggle-status
    if (method === 'PATCH' && path === 'toggle-status') {
      const body = await req.json().catch(() => null);
      if (!body?.discountId || body?.isActive === undefined) {
        return err('Se requiere discountId e isActive.', 400);
      }

      const { data, error } = await s
        .from('discount_codes')
        .update({ is_active: body.isActive })
        .eq('id', body.discountId)
        .select()
        .single();

      if (error) return mapPgErr(error);
      return json({ data, error: null });
    }

    return err(`Ruta no soportada: ${method} ${url.pathname}`, 405, {
      supported: [
        'GET /list',
        'GET /active',
        'GET /:id',
        'POST /create',
        'PUT (body: discountId, discountData)',
        'DELETE (body: discountId)',
        'PATCH /toggle-status',
      ],
    });
  } catch (e) {
    console.error('Unexpected error:', e instanceof Error ? e.message : e);
    return json(
      { error: 'Error interno del servidor', timestamp: new Date().toISOString() },
      500
    );
  }
});
