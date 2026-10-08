import { describe, expect, it, vi } from "vitest";
import {
  fitWithin,
  needsOptimising,
  planPhotoUpdates,
  rewriteDescription,
  uniqueImagePath,
  uploadWithFallback,
  withReplacedImages,
  type PhotoMap,
} from "@/lib/photoUpdates";

const CDN = "https://cdn.shopify.com/s/files/1/0596/8343/8628/files/";
const STORE = "https://abc.supabase.co/storage/v1/object/public/product-images/";
const images = [
  { url: `${CDN}front.png?v=1`, altText: "Front" },                                   // staged cut-out
  { url: `${CDN}campaign.jpg?v=2`, altText: "Campaign" },                             // staged copy
  { url: `${STORE}tee/123.png`, altText: "Uploaded before optimisation" },          // in storage, no thumb
  { url: `${STORE}tee/456.webp`, altText: "Already optimised", thumb: `${STORE}tee/456-t.webp` },
  { url: "https://elsewhere.example/photo.jpg", altText: "Linked from elsewhere" },
  { url: `${CDN}replaced-by-owner.png?v=4`, altText: "Not in the map" },
];
const photos: PhotoMap = {
  [`${CDN}front.png?v=1`]: { full: "product-photos/tee/01.webp", thumb: "product-photos/tee/01-thumb.webp", alpha: true, cutout: true },
  [`${CDN}campaign.jpg?v=2`]: { full: "product-photos/tee/02.webp", thumb: "product-photos/tee/02-thumb.webp", alpha: false },
};

describe("planPhotoUpdates", () => {
  it("swaps in staged pairs and re-encodes storage photos that have no thumbnail", () => {
    expect(planPhotoUpdates(images, photos, "/")).toEqual([
      { index: 0, kind: "staged", full: "/product-photos/tee/01.webp", thumb: "/product-photos/tee/01-thumb.webp", cutout: true, fallbackType: "image/png" },
      { index: 1, kind: "staged", full: "/product-photos/tee/02.webp", thumb: "/product-photos/tee/02-thumb.webp", cutout: false, fallbackType: "image/jpeg" },
      { index: 2, kind: "reencode", source: `${STORE}tee/123.png` },
    ]);
  });

  it("leaves optimised photos, photos hosted elsewhere and unmapped photos alone", () => {
    const touched = planPhotoUpdates(images, photos).map((p) => p.index);
    expect(touched).not.toContain(3);
    expect(touched).not.toContain(4);
    expect(touched).not.toContain(5);
  });

  it("does nothing on a second run", () => {
    const after = withReplacedImages(images.slice(0, 3), new Map([
      [0, { url: `${STORE}tee/a.webp`, thumb: `${STORE}tee/a-t.webp` }],
      [1, { url: `${STORE}tee/b.webp`, thumb: `${STORE}tee/b-t.webp` }],
      [2, { url: `${STORE}tee/c.webp`, thumb: `${STORE}tee/c-t.webp` }],
    ]));
    expect(planPhotoUpdates(after, photos)).toEqual([]);
  });

  it("resolves staged files against the site's base path", () => {
    expect(planPhotoUpdates(images, photos, "/shop/")[0]).toMatchObject({ full: "/shop/product-photos/tee/01.webp" });
  });
});

describe("withReplacedImages", () => {
  it("swaps URLs and adds thumbnails, keeping order and alt text", () => {
    const out = withReplacedImages(images, new Map([[1, { url: "https://s/b.webp", thumb: "https://s/b-t.webp" }]]));
    expect(out[1]).toEqual({ url: "https://s/b.webp", thumb: "https://s/b-t.webp", altText: "Campaign" });
    expect(out.filter((_, i) => i !== 1)).toEqual(images.filter((_, i) => i !== 1));
  });
});

describe("rewriteDescription", () => {
  const media = { "https://cdn.shopify.com/videos/c/o/v/abc.mov": "product-media/sand-jorts.mp4" };
  it("points Shopify-hosted media at the self-hosted copy, every occurrence", () => {
    const html = '<video><source src="https://cdn.shopify.com/videos/c/o/v/abc.mov" type="video/mp4"></video> <a href="https://cdn.shopify.com/videos/c/o/v/abc.mov">x</a>';
    expect(rewriteDescription(html, media, "/")).toBe(
      '<video><source src="/product-media/sand-jorts.mp4" type="video/mp4"></video> <a href="/product-media/sand-jorts.mp4">x</a>',
    );
  });
  it("returns the description unchanged when there's nothing to rewrite", () => {
    expect(rewriteDescription("<p>Plain</p>", media)).toBe("<p>Plain</p>");
    expect(rewriteDescription(null, media)).toBeNull();
  });
});

describe("needsOptimising", () => {
  it("flags Shopify-hosted photos and storage photos without a thumbnail, nothing else", () => {
    expect(images.map(needsOptimising)).toEqual([true, true, true, false, false, true]);
  });
});

describe("fitWithin", () => {
  it("shrinks to fit the longest side without enlarging", () => {
    expect(fitWithin(3000, 2000, 1500)).toEqual({ width: 1500, height: 1000 });
    expect(fitWithin(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
    expect(fitWithin(800, 600, 1500)).toEqual({ width: 800, height: 600 });
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
    await expect(uploadWithFallback(webp, "image/jpeg", attempt, async () => png)).rejects.toThrow("first problem (retried as JPEG: second problem)");
  });
});
