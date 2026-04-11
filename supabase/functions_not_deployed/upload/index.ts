// src/lib/upload.ts
import { supabase } from '@/lib/supabase'

export type UploadedImage = { url: string; path: string; alt?: string }

/** Bucket por defecto para imágenes de productos/variantes */
export const DEFAULT_BUCKET = 'product-images'

/** Extrae la extensión de un nombre de archivo. */
function fileExt(name: string) {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : 'jpg'
}

/** Asegura que el prefijo no tenga "/" duplicadas ni termine en "/". */
function normalizePrefix(prefix: string) {
  return prefix.replace(/\/+/g, '/').replace(/\/$/, '')
}

/**
 * Sube archivos al bucket indicado bajo un prefijo dado.
 * Devuelve [{ url, path }] con URL pública (asumiendo bucket público).
 *
 * @param bucket      Nombre del bucket (ej: 'product-images')
 * @param files       Archivos a subir
 * @param pathPrefix  Carpeta destino (ej: 'products/<productId>' o 'variants/<variantId>')
 */
export async function uploadImagesToBucket(
  bucket: string = DEFAULT_BUCKET,
  files: File[],
  pathPrefix: string, // 'products/<id>' | 'variants/<id>'
): Promise<UploadedImage[]> {
  const results: UploadedImage[] = []
  const base = normalizePrefix(pathPrefix)

  for (const f of files) {
    const ext = fileExt(f.name)
    const filename = `${crypto.randomUUID()}.${ext}`
    const path = `${base}/${filename}`

    const { error } = await supabase.storage.from(bucket).upload(path, f, {
      upsert: false,
      contentType: f.type || undefined,
    })
    if (error) throw error

    // Si el bucket es público, publicURL basta:
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    results.push({ url: data.publicUrl, path })
  }
  return results
}

/**
 * Borra rutas exactas del bucket.
 * @param bucket Nombre del bucket (ej: 'product-images')
 * @param paths  Rutas internas a borrar (ej: 'variants/123/abc.jpg')
 */
export async function removeImagesFromBucket(
  bucket: string = DEFAULT_BUCKET,
  paths: string[],
): Promise<void> {
  if (!paths?.length) return
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw error
}

/**
 * Dado un publicUrl de Supabase Storage, devuelve el path interno dentro del bucket.
 * Útil para poder remover archivos con removeImagesFromBucket.
 *
 * @param publicUrl URL pública del archivo
 * @param bucket    Bucket esperado (default 'product-images')
 * @returns path interno o null si no se pudo derivar
 */
export function derivePathFromPublicUrl(
  publicUrl: string,
  bucket: string = DEFAULT_BUCKET,
): string | null {
  // https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const marker = `/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return publicUrl.slice(idx + marker.length)
}
