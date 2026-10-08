import { describe, expect, it, vi } from "vitest";
import { planPhotoUpdates, uniqueImagePath, uploadWithFallback, withReplacedImages, type PhotoUpdate } from "@/lib/photoUpdates";

const CDN = "https://cdn.shopify.com/s/files/1/0596/8343/8628/files/";
const images = [
  { url: `${CDN}front.png?v=1`, altText: "Front" },
  { url: `${CDN}campaign.jpg?v=2`, altText: "Campaign" },
  { url: `${CDN}cutout-already.png?v=3`, altText: "Already transparent" },
  { url: "https://example.supabase.co/storage/v1/object/public/product-images/x/new.png", altText: "Uploaded since" },
];
const updates: PhotoUpdate[] = [
  { from: `${CDN}front.png?v=1`, cutout: "restored-photos/tee/01.webp" },
  { from: `${CDN}campaign.jpg?v=2` },
  { from: `${CDN}cutout-already.png?v=3`, transparent: true },
  { from: `${CDN}replaced-by-owner.png?v=4`, cutout: "restored-photos/tee/04.webp" },
];

describe("planPhotoUpdates", () => {
  it("swaps product shots for their cut-outs and moves the rest as they are", () => {
    const plan = planPhotoUpdates(images, updates, "/");
    expect(plan).toEqual([
      { index: 0, kind: "cutout", source: "/restored-photos/tee/01.webp", fallbackType: "image/png" },
      { index: 1, kind: "copy", source: `${CDN}campaign.jpg?v=2&width=1500`, fallbackType: "image/jpeg" },
      { index: 2, kind: "copy", source: `${CDN}cutout-already.png?v=3&width=1500`, fallbackType: "image/png" },
    ]);
  });

  it("leaves alone any photo the owner has replaced since the restore", () => {
    const plan = planPhotoUpdates(images, updates, "/");
    expect(plan.map((p) => p.index)).not.toContain(3);
    expect(plan.some((p) => p.source.includes("04.webp"))).toBe(false);
  });

  it("resolves cut-outs against the site's base path", () => {
    expect(planPhotoUpdates(images, updates, "/shop/")[0].source).toBe("/shop/restored-photos/tee/01.webp");
  });

  it("does nothing for a product with no updates", () => {
    expect(planPhotoUpdates(images, undefined)).toEqual([]);
  });
});

describe("withReplacedImages", () => {
  it("swaps only the replaced URLs, keeping order and alt text", () => {
    const out = withReplacedImages(images, new Map([[0, "https://s/new-0.webp"], [2, "https://s/new-2.png"]]));
    expect(out.map((i) => i.url)).toEqual(["https://s/new-0.webp", images[1].url, "https://s/new-2.png", images[3].url]);
    expect(out.map((i) => i.altText)).toEqual(images.map((i) => i.altText));
  });
});

describe("uniqueImagePath", () => {
  it("uses a fresh name in the product's folder, like the product editor", () => {
    expect(uniqueImagePath("the-shoodie®", 0, "webp", 1700000000000, 0.5)).toBe("the-shoodie/1700000000000-1-i000.webp");
  });

  it("never repeats for different uploads", () => {
    const a = uniqueImagePath("tee", 0, "webp", 1, 0.1);
    expect(uniqueImagePath("tee", 0, "webp", 2, 0.1)).not.toBe(a);
    expect(uniqueImagePath("tee", 0, "webp", 1, 0.2)).not.toBe(a);
    expect(uniqueImagePath("tee", 1, "webp", 1, 0.1)).not.toBe(a);
  });
});

describe("uploadWithFallback", () => {
  const webp = new Blob(["w"], { type: "image/webp" });
  const png = new Blob(["p"], { type: "image/png" });

  it("uploads as is when storage accepts it", async () => {
    const reencode = vi.fn();
    await expect(uploadWithFallback(webp, "image/png", async () => "url-webp", reencode)).resolves.toBe("url-webp");
    expect(reencode).not.toHaveBeenCalled();
  });

  it("retries a refused WebP in the fallback format", async () => {
    const attempt = vi.fn(async (b: Blob) => {
      if (b.type === "image/webp") throw new Error("mime type image/webp is not supported");
      return "url-png";
    });
    const reencode = vi.fn(async () => png);
    await expect(uploadWithFallback(webp, "image/png", attempt, reencode)).resolves.toBe("url-png");
    expect(reencode).toHaveBeenCalledWith(webp, "image/png");
  });

  it("doesn't retry a format that isn't WebP", async () => {
    const reencode = vi.fn();
    await expect(uploadWithFallback(png, "image/png", async () => { throw new Error("denied"); }, reencode)).rejects.toThrow("denied");
    expect(reencode).not.toHaveBeenCalled();
  });

  it("reports both errors when the retry fails too", async () => {
    let n = 0;
    const attempt = async () => { throw new Error(n++ === 0 ? "first problem" : "second problem"); };
    await expect(uploadWithFallback(webp, "image/jpeg", attempt, async () => png)).rejects.toThrow(
      "first problem (retried as JPEG: second problem)",
    );
  });
});
