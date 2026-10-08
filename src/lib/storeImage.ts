import { supabase } from "@/integrations/supabase/client";
import { imageExtension } from "@/lib/shopifyImport";
import { type FallbackType, uniqueImagePath, uploadWithFallback } from "@/lib/photoUpdates";

/** Browser side of saving product photos into the product-images bucket. */

const BUCKET = "product-images";

/** Download an image; `preferWebp` asks Shopify's CDN for its web-sized WebP. */
export async function downloadImage(url: string, preferWebp: boolean): Promise<Blob> {
  const res = await fetch(url, preferWebp ? { headers: { Accept: "image/webp,*/*" } } : undefined);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const type = (res.headers.get("content-type") || blob.type).split(";")[0].trim();
  return blob.type === type ? blob : new Blob([blob], { type });
}

async function reencode(blob: Blob, type: FallbackType): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser can't convert images");
  if (type === "image/jpeg") {
    // JPEG has no transparency; only opaque photos fall back to it.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't convert the image"))), type, 0.92),
  );
}

/**
 * Save a photo the way the product editor does: a new file under a fresh name,
 * never overwriting (the combination proven to work on this store's storage).
 * Returns its public URL; throws with storage's own message on failure.
 */
export async function storeProductImage(blob: Blob, handle: string, index: number, fallbackType: FallbackType): Promise<string> {
  return uploadWithFallback(
    blob,
    fallbackType,
    async (b) => {
      const path = uniqueImagePath(handle, index, imageExtension(b.type, ""));
      const { error } = await supabase.storage.from(BUCKET).upload(path, b, {
        // Names are never reused, so browsers and the CDN can keep a copy for a year.
        cacheControl: "31536000",
        upsert: false,
        contentType: b.type || undefined,
      });
      if (error) throw new Error(error.message);
      return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    reencode,
  );
}

/** Save an optimised photo and its thumbnail; returns both public URLs. */
export async function storeOptimisedPhoto(
  full: Blob,
  thumb: Blob,
  handle: string,
  index: number,
  fallbackType: FallbackType,
): Promise<{ url: string; thumb: string }> {
  const [url, thumbUrl] = await Promise.all([
    storeProductImage(full, handle, index, fallbackType),
    storeProductImage(thumb, handle, index, fallbackType),
  ]);
  return { url, thumb: thumbUrl };
}
