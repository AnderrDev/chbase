import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, origin, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate required environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ 
          error: 'Configuración de Supabase incompleta',
          details: 'Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      )
    }

    // Create Supabase client with service role key
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const { method, url } = req
    const urlObj = new URL(url)
    const path = urlObj.pathname.split('/').pop()

    // Get all categories
    if (method === 'GET' && path === 'list') {
      try {
        const { data, error } = await supabaseClient
          .from('categories')
          .select('*')
          .order('name', { ascending: true })

        if (error) {
          console.error('Error fetching categories:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al obtener categorías',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        return new Response(
          JSON.stringify({ data, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (fetchError) {
        console.error('Unexpected error fetching categories:', fetchError)
        return new Response(
          JSON.stringify({ 
            error: 'Error inesperado al obtener categorías',
            details: fetchError instanceof Error ? fetchError.message : 'Error desconocido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        )
      }
    }

    // Get category by ID
    if (method === 'GET' && path !== 'list' && path !== 'stats') {
      try {
        const categoryId = path
        if (!categoryId || categoryId === '') {
          return new Response(
            JSON.stringify({ 
              error: 'ID de categoría requerido',
              details: 'El ID de la categoría no puede estar vacío'
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        const { data, error } = await supabaseClient
          .from('categories')
          .select('*')
          .eq('id', categoryId)
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            return new Response(
              JSON.stringify({ 
                error: 'Categoría no encontrada',
                details: `No se encontró una categoría con el ID: ${categoryId}`,
                code: error.code 
              }),
              { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404 
              }
            )
          }
          
          console.error('Error fetching category:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al obtener categoría',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        return new Response(
          JSON.stringify({ data, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (fetchError) {
        console.error('Unexpected error fetching category:', fetchError)
        return new Response(
          JSON.stringify({ 
            error: 'Error inesperado al obtener categoría',
            details: fetchError instanceof Error ? fetchError.message : 'Error desconocido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        )
      }
    }

    // Create category
    if (method === 'POST' && path === 'create') {
      try {
        const categoryData = await req.json()
        
        if (!categoryData || !categoryData.name) {
          return new Response(
            JSON.stringify({ 
              error: 'Datos de categoría requeridos',
              details: 'El nombre de la categoría es obligatorio'
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        // Check if category name already exists
        const { data: existingCategory } = await supabaseClient
          .from('categories')
          .select('id')
          .eq('name', categoryData.name)
          .single()

        if (existingCategory) {
          return new Response(
            JSON.stringify({ 
              error: 'Categoría ya existe',
              details: `Ya existe una categoría con el nombre: ${categoryData.name}`
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 409 
            }
          )
        }

        const { data, error } = await supabaseClient
          .from('categories')
          .insert([{
            name: categoryData.name.trim()
          }])
          .select()
          .single()

        if (error) {
          console.error('Error creating category:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al crear categoría',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        return new Response(
          JSON.stringify({ data, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 201 
          }
        )
      } catch (parseError) {
        console.error('Error parsing request body:', parseError)
        return new Response(
          JSON.stringify({ 
            error: 'Error al procesar datos de la solicitud',
            details: 'El cuerpo de la solicitud no es un JSON válido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }
    }

    // Update category
    if (method === 'PUT') {
      try {
        const body = await req.json()
        const { categoryId, categoryData } = body
        
        if (!categoryId || !categoryData || !categoryData.name) {
          return new Response(
            JSON.stringify({ 
              error: 'Datos requeridos faltantes',
              details: 'Se requiere categoryId y categoryData con nombre para actualizar la categoría'
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        // Check if category name already exists (excluding current category)
        const { data: existingCategory } = await supabaseClient
          .from('categories')
          .select('id')
          .eq('name', categoryData.name)
          .neq('id', categoryId)
          .single()

        if (existingCategory) {
          return new Response(
            JSON.stringify({ 
              error: 'Categoría ya existe',
              details: `Ya existe otra categoría con el nombre: ${categoryData.name}`
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 409 
            }
          )
        }

        const { data, error } = await supabaseClient
          .from('categories')
          .update({
            name: categoryData.name.trim(),
            updated_at: new Date().toISOString()
          })
          .eq('id', categoryId)
          .select()
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            return new Response(
              JSON.stringify({ 
                error: 'Categoría no encontrada',
                details: `No se encontró una categoría con el ID: ${categoryId}`,
                code: error.code 
              }),
              { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404 
              }
            )
          }
          
          console.error('Error updating category:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al actualizar categoría',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        return new Response(
          JSON.stringify({ data, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (parseError) {
        console.error('Error parsing request body:', parseError)
        return new Response(
          JSON.stringify({ 
            error: 'Error al procesar datos de la solicitud',
            details: 'El cuerpo de la solicitud no es un JSON válido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }
    }

    // Delete category
    if (method === 'DELETE') {
      try {
        const body = await req.json()
        const { categoryId } = body
        
        if (!categoryId) {
          return new Response(
            JSON.stringify({ 
              error: 'ID de categoría requerido',
              details: 'Se requiere categoryId para eliminar la categoría'
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        // Check if category has associated products
        const { data: products, error: productsError } = await supabaseClient
          .from('products')
          .select('id')
          .eq('category_id', categoryId)
          .limit(1)

        if (productsError) {
          console.error('Error checking category products:', productsError)
          return new Response(
            JSON.stringify({ 
              error: 'Error al verificar productos asociados',
              details: productsError.message
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        if (products && products.length > 0) {
          return new Response(
            JSON.stringify({ 
              error: 'Categoría tiene productos asociados',
              details: 'No se puede eliminar una categoría que tiene productos asociados. Primero reasigne o elimine los productos.'
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 409 
            }
          )
        }

        const { error } = await supabaseClient
          .from('categories')
          .delete()
          .eq('id', categoryId)

        if (error) {
          console.error('Error deleting category:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al eliminar categoría',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        return new Response(
          JSON.stringify({ data: { success: true }, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (parseError) {
        console.error('Error parsing request body:', parseError)
        return new Response(
          JSON.stringify({ 
            error: 'Error al procesar datos de la solicitud',
            details: 'El cuerpo de la solicitud no es un JSON válido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }
    }

    // Get category statistics (product count)
    if (method === 'GET' && path === 'stats') {
      try {
        const { data, error } = await supabaseClient
          .from('categories')
          .select(`
            id,
            name,
            created_at,
            updated_at,
            products:products(count)
          `)
          .order('name', { ascending: true })

        if (error) {
          console.error('Error fetching category stats:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Error al obtener estadísticas de categorías',
              details: error.message,
              code: error.code 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          )
        }

        // Transform the data to include product count
        const categoriesWithStats = data.map(category => ({
          ...category,
          product_count: category.products?.[0]?.count || 0,
          products: undefined // Remove the nested products object
        }))

        return new Response(
          JSON.stringify({ data: categoriesWithStats, error: null }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      } catch (fetchError) {
        console.error('Unexpected error fetching category stats:', fetchError)
        return new Response(
          JSON.stringify({ 
            error: 'Error inesperado al obtener estadísticas de categorías',
            details: fetchError instanceof Error ? fetchError.message : 'Error desconocido'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
          }
        )
      }
    }

    return new Response(
      JSON.stringify({ 
        error: 'Método no permitido',
        details: `El método ${method} no está soportado para esta ruta`,
        supportedMethods: ['GET', 'POST', 'PUT', 'DELETE']
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405 
      }
    )

  } catch (error) {
    console.error('Unexpected server error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Error interno del servidor',
        details: error instanceof Error ? error.message : 'Error desconocido',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
