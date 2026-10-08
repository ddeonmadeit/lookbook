import type { ManualImage } from "@/lib/products";
import { storageFolderFor, webSizedImageUrl } from "@/lib/shopifyImport";

/**
 * Follow-up to the catalogue restore: the restored products' photos still load
 * from Shopify's CDN, which can drop the closed store's files at any time. Each
 * photo is either replaced with a background-removed cut-out (product shots,
 * prepared offline and shipped with the site) or moved into our own storage
 * unchanged (campaign shots, close-ups, size charts).
 *
 * Pure logic lives here; the dashboard dialog does the downloads and uploads.
 */

/** One restored photo and what happens to it. */
export interface PhotoUpdate {
  /** The photo's URL as the restore stored it (on Shopify's CDN). */
  from: string;
  /** Site-relative path of its background-removed version, if it has one. */
  cutout?: string;
  /** Whether the photo has transparency, so a fallback re-encode keeps it. */
  transparent?: boolean;
}

/** Updates by product handle, in the product's original photo order. */
export type PhotoManifest = Record<string, PhotoUpdate[]>;

export type FallbackType = "image/png" | "image/jpeg";

export interface PlannedPhoto {
  /** Position in the product's images array. */
  index: number;
  kind: "cutout" | "copy";
  /** Where to download the new version from. */
  source: string;
  /** Format to re-encode to if storage refuses WebP. */
  fallbackType: FallbackType;
}

/**
 * Match a product's current photos to its updates by URL. A photo whose URL no
 * longer matches (replaced or edited since the restore) is left alone, as is
 * any photo that isn't in the manifest.
 */
export function planPhotoUpdates(images: ManualImage[], updates: PhotoUpdate[] | undefined, base = "/"): PlannedPhoto[] {
  if (!updates) return [];
  const byUrl = new Map(updates.map((u) => [u.from, u]));
  const planned: PlannedPhoto[] = [];
  images.forEach((img, index) => {
    const u = byUrl.get(img.url);
    if (!u) return;
    planned.push(
      u.cutout
        ? { index, kind: "cutout", source: base + u.cutout, fallbackType: "image/png" }
        : { index, kind: "copy", source: webSizedImageUrl(u.from, 1500), fallbackType: u.transparent ? "image/png" : "image/jpeg" },
    );
  });
  return planned;
}

/** The photo list with new URLs swapped in; order, alt text and every other photo unchanged. */
export function withReplacedImages(images: ManualImage[], replaced: Map<number, string>): ManualImage[] {
  return images.map((img, i) => (replaced.has(i) ? { ...img, url: replaced.get(i)! } : img));
}

/**
 * A fresh storage key for every upload, like the product editor uses, so an
 * upload never needs permission to overwrite an existing file.
 */
export function uniqueImagePath(handle: string, index: number, ext: string, now = Date.now(), rand = Math.random()): string {
  return `${storageFolderFor(handle)}/${now}-${index + 1}-${Math.floor(rand * 36 ** 4).toString(36)}.${ext}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Upload a blob; if that fails for a WebP, re-encode it to the fallback format
 * and try once more. Storage buckets can be limited to particular image types,
 * and the store's own uploads have only ever been PNG.
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
