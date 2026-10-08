import type { ManualImage } from "@/lib/products";
import { storageFolderFor } from "@/lib/shopifyImport";

/**
 * Moving product photos off Shopify and making them load fast. Every product
 * photo should end up in our own storage as a WebP of at most 1500px plus a
 * 640px thumbnail for grid tiles.
 *
 * Photos recovered from the old Shopify store, and the current products'
 * original PNGs, were optimised offline (product shots also had their
 * backgrounds removed) and ship with the site as staged files; the photo map
 * says which staged pair replaces which current URL. Any other photo already
 * in our storage without a thumbnail is optimised in the browser instead.
 *
 * Pure logic lives here; the dashboard dialogs do the downloads and uploads.
 */

export interface StagedPhoto {
  /** Site-relative paths of the optimised full photo and its thumbnail. */
  full: string;
  thumb: string;
  /** Whether it has transparency (decides the fallback format). */
  alpha: boolean;
  /** Background removed. */
  cutout?: boolean;
}

/** Staged replacements by the URL they replace. */
export type PhotoMap = Record<string, StagedPhoto>;
/** Self-hosted copies of media linked from product descriptions, by the URL they replace. */
export type MediaMap = Record<string, string>;

export type FallbackType = "image/png" | "image/jpeg";

export type PlannedPhoto =
  | { index: number; kind: "staged"; full: string; thumb: string; cutout: boolean; fallbackType: FallbackType }
  | { index: number; kind: "reencode"; source: string };

const OWN_STORAGE = "/storage/v1/object/public/product-images/";

/**
 * What to do with each of a product's photos: swap in its staged pair, or
 * optimise it in the browser if it's in our storage without a thumbnail.
 * Anything else (already optimised, or hosted elsewhere) is left alone, so a
 * second run does nothing.
 */
export function planPhotoUpdates(images: ManualImage[], photos: PhotoMap, base = "/"): PlannedPhoto[] {
  const planned: PlannedPhoto[] = [];
  images.forEach((img, index) => {
    const staged = photos[img.url];
    if (staged) {
      planned.push({
        index,
        kind: "staged",
        full: base + staged.full,
        thumb: base + staged.thumb,
        cutout: !!staged.cutout,
        fallbackType: staged.alpha ? "image/png" : "image/jpeg",
      });
    } else if (img.url.includes(OWN_STORAGE) && !img.thumb) {
      planned.push({ index, kind: "reencode", source: img.url });
    }
  });
  return planned;
}

/** The photo list with new URLs (and thumbnails) swapped in; order and alt text unchanged. */
export function withReplacedImages(images: ManualImage[], replaced: Map<number, { url: string; thumb: string }>): ManualImage[] {
  return images.map((img, i) => (replaced.has(i) ? { ...img, ...replaced.get(i)! } : img));
}

/** A description with links to Shopify-hosted media pointed at their self-hosted copies. */
export function rewriteDescription(html: string | null, media: MediaMap, base = "/"): string | null {
  if (!html) return html;
  let out = html;
  for (const [from, to] of Object.entries(media)) out = out.split(from).join(base + to);
  return out;
}

/** Whether a photo would load faster once optimised (still on Shopify, or in our storage without a thumbnail). */
export function needsOptimising(img: ManualImage): boolean {
  return img.url.includes("cdn.shopify.com") || (img.url.includes(OWN_STORAGE) && !img.thumb);
}

/**
 * A fresh storage key for every upload, like the product editor uses, so an
 * upload never needs permission to overwrite an existing file.
 */
export function uniqueImagePath(handle: string, index: number, ext: string, now = Date.now(), rand = Math.random()): string {
  return `${storageFolderFor(handle)}/${now}-${index + 1}-${Math.floor(rand * 36 ** 4).toString(36)}.${ext}`;
}

/** Largest size that fits within `max` on both sides without enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Upload a blob; if that fails for a WebP, re-encode it to the fallback format
 * and try once more. Storage buckets can be limited to particular image types,
 * and the store's own uploads were only ever PNG.
 */
export async function uploadWithFallback(
  blob: Blob,
  fallbackType: FallbackType,
  attempt: (b: Blob) => Promise<string>,
  reencode: (b: Blob, type: FallbackType) => Promise<Blob>,
): Promise<string> {
  try {
    return await attempt(blob);
  } catch (first) {
    if (blob.type !== "image/webp") throw first;
    try {
      return await attempt(await reencode(blob, fallbackType));
    } catch (second) {
      throw new Error(`${message(first)} (retried as ${fallbackType === "image/png" ? "PNG" : "JPEG"}: ${message(second)})`);
    }
  }
}
