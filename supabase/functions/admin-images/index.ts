import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ADMIN_ALLOWED_ORIGIN, requireAdmin } from '../_shared/admin-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': ADMIN_ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, origin, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const admin = await requireAdmin(req, corsHeaders)
  if (admin instanceof Response) return admin

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: 'Configuración de Supabase incompleta',
          details:
            'Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const { method } = req

    // Upload image
    if (method === 'POST') {
      const formData = await req.formData()
      const file = formData.get('file') as File
      const folder = formData.get('folder') as string || ''

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
      if (!allowedTypes.includes(file.type)) {
        return new Response(
          JSON.stringify({
            error: 'Tipo de archivo no permitido. Solo se permiten: JPG, PNG, WebP'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024
      if (file.size > maxSize) {
        return new Response(
          JSON.stringify({ error: 'El archivo es demasiado grande. Máximo 5MB' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }

      try {
        // Generate unique filename
        const timestamp = Date.now()
        const randomString = Math.random().toString(36).substring(2, 15)
        const extension = file.name.split('.').pop()
        const fileName = `${timestamp}_${randomString}.${extension}`
        const filePath = folder ? `${folder}/${fileName}` : fileName

        // Upload to Supabase Storage
        const { data, error } = await supabaseClient.storage
          .from('product-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          })

        if (error) {
          throw new Error(`Error al subir imagen: ${error.message}`)
        }

        // Get public URL
        const { data: urlData } = supabaseClient.storage
          .from('product-images')
          .getPublicUrl(data.path)

        return new Response(
          JSON.stringify({
            url: urlData.publicUrl,
            name: fileName,
            path: data.path,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        )
      }
    }

    // Delete image
    if (method === 'DELETE') {
      const { imagePath } = await req.json()

      if (!imagePath) {
        return new Response(
          JSON.stringify({ error: 'No image path provided' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }

      try {
        const { error } = await supabaseClient.storage
          .from('product-images')
          .remove([imagePath])

        if (error) {
          throw new Error(`Error al eliminar imagen: ${error.message}`)
        }

        return new Response(
          JSON.stringify({ success: true }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        )
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
        details: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
