import { type FallbackType, fitWithin } from "@/lib/photoUpdates";

/** Browser-side photo optimisation for uploads: a ≤1500px full photo and a 640px thumbnail. */

export const FULL_SIZE = 1500;
export const THUMB_SIZE = 640;

let webpEncoding: Promise<boolean> | null = null;

/** Safari decodes WebP but can't encode it from a canvas (it silently hands back a PNG). */
function canEncodeWebp(): Promise<boolean> {
  webpEncoding ??= new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    c.toBlob((b) => resolve(b?.type === "image/webp"), "image/webp");
  });
  return webpEncoding;
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true; // every 4th pixel is plenty
  return false;
}

function draw(bitmap: ImageBitmap, max: number) {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("this browser can't process images");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx, width, height };
}

async function encode(canvas: HTMLCanvasElement, alpha: boolean, quality: number): Promise<Blob> {
  const type = (await canEncodeWebp()) ? "image/webp" : alpha ? "image/png" : "image/jpeg";
  if (type === "image/jpeg") {
    // JPEG has no transparency; flatten onto white (only reached for opaque photos).
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode the image"))), type, quality),
  );
}

/** Resize and re-encode a photo; `alpha` says whether it has transparency. */
export async function optimizeImage(source: Blob): Promise<{ full: Blob; thumb: Blob; alpha: boolean; fallbackType: FallbackType }> {
  const bitmap = await createImageBitmap(source); // applies EXIF orientation (phone photos)
  try {
    const full = draw(bitmap, FULL_SIZE);
    const alpha = hasTransparency(full.ctx, full.width, full.height);
    const thumb = draw(bitmap, THUMB_SIZE);
    return {
      full: await encode(full.canvas, alpha, 0.82),
      thumb: await encode(thumb.canvas, alpha, 0.8),
      alpha,
      fallbackType: alpha ? "image/png" : "image/jpeg",
    };
  } finally {
    bitmap.close();
  }
}
