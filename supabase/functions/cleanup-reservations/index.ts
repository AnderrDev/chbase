// supabase/functions/cleanup-reservations/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function cors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors({ ok: true });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
      'cleanup_expired_reservations'
    );

    if (cleanupError) {
      console.error('cleanup-reservations error:', cleanupError.message);
      return cors(
        { error: 'Error limpiando reservas expiradas', detail: cleanupError.message },
        500
      );
    }

    return cors({
      success: true,
      cleaned: cleanupResult ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('cleanup-reservations unexpected error:', error instanceof Error ? error.message : error);
    return cors(
      {
        error: 'Error interno del servidor',
        detail: error instanceof Error ? error.message : 'Error desconocido',
      },
      500
    );
  }
});
