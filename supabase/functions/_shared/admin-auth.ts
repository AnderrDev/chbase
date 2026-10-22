// supabase/functions/_shared/admin-auth.ts
// Autorización para las Edge Functions de administración.
//
// `verify_jwt` acepta la anon key (es un JWT válido y viaja en el bundle del
// storefront), así que no basta para proteger funciones que usan service_role.
// Aquí validamos el token del usuario contra Supabase Auth y exigimos
// `app_metadata.role === 'admin'`. `app_metadata` solo puede escribirse con
// service_role, por lo que un usuario no puede auto-asignarse el rol.
//
// Para dar acceso a un administrador (SQL editor):
//   update auth.users
//   set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
//   where email = 'admin@ejemplo.com';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Origen permitido del panel (p. ej. https://admin.chmas.com.co).
// Si no está configurado se mantiene "*": la seguridad la da requireAdmin, no CORS.
export const ADMIN_ALLOWED_ORIGIN = Deno.env.get("ADMIN_ALLOWED_ORIGIN") ?? "*";

export interface AdminUser {
  id: string;
  email: string | undefined;
}

/**
 * Devuelve el usuario admin, o una Response 401/403 lista para retornar.
 */
export async function requireAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AdminUser | Response> {
  const deny = (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny("No autenticado", 401);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return deny("Faltan SUPABASE_URL o SUPABASE_ANON_KEY", 500);
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Con la anon key (sin usuario) getUser falla, así que esto también la rechaza.
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return deny("Sesión inválida o expirada", 401);

  if (data.user.app_metadata?.role !== "admin") {
    return deny("No autorizado", 403);
  }

  return { id: data.user.id, email: data.user.email };
}
