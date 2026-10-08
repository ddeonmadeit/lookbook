import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import optimisationsJson from "@/data/photoOptimisations.json";
import catalogueJson from "@/data/recoveredShopifyCatalogue.json";
import { rewriteDescription, type MediaMap, type PhotoMap } from "@/lib/photoUpdates";
import type { ShopifyImportNode } from "@/lib/shopifyImport";

const { photos, media } = optimisationsJson as { photos: PhotoMap; media: MediaMap };
const catalogue = catalogueJson as unknown as ShopifyImportNode[];

/** Width, height and alpha flag from a WebP file's header. */
function webpInfo(file: Buffer) {
  expect(file.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(file.subarray(8, 12).toString("latin1")).toBe("WEBP");
  const chunk = file.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X") {
    return { width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1, alpha: (file[20] & 0x10) !== 0 };
  }
  if (chunk === "VP8 ") return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff, alpha: false };
  throw new Error(`unexpected WebP chunk ${chunk}`);
}

describe("staged photo copies", () => {
  it("has a saved copy of every recovered photo, so restoring never touches Shopify", () => {
    for (const n of catalogue) for (const e of n.images.edges) expect(photos[e.node.url], e.node.url).toBeDefined();
  });

  it("stores each as a ≤1500px WebP with a ≤640px thumbnail, transparent where it should be", () => {
    for (const [url, p] of Object.entries(photos)) {
      const full = webpInfo(readFileSync(`public/${p.full}`));
      const thumb = webpInfo(readFileSync(`public/${p.thumb}`));
      expect(Math.max(full.width, full.height), url).toBeLessThanOrEqual(1500);
      expect(Math.max(thumb.width, thumb.height), url).toBeLessThanOrEqual(640);
      expect(full.alpha, url).toBe(p.alpha);
      expect(thumb.alpha, url).toBe(p.alpha);
    }
  });

  it("removed the background from exactly the 89 product shots, all transparent", () => {
    const cutouts = Object.values(photos).filter((p) => p.cutout);
    expect(cutouts).toHaveLength(89);
    expect(cutouts.every((p) => p.alpha)).toBe(true);
  });

  it("never cut out a size chart", () => {
    const url = (h: string, n: number) => catalogue.find((x) => x.handle === h)!.images.edges[n - 1].node.url;
    expect(photos[url("sttu-teeshirt", 7)].cutout).toBeUndefined();
    expect(photos[url("totem-tee-reversible", 10)].cutout).toBeUndefined();
  });
});

describe("self-hosted description media", () => {
  it("leaves no Shopify links in any recovered description once rewritten", () => {
    for (const n of catalogue) expect(rewriteDescription(n.descriptionHtml, media, "/") ?? "").not.toContain("cdn.shopify.com");
  });

  it("has every file, with videos ready to start playing before they finish downloading", () => {
    for (const path of new Set(Object.values(media))) {
      const file = readFileSync(`public/${path}`);
      if (!path.endsWith(".mp4")) {
        webpInfo(file);
        continue;
      }
      // top-level MP4 boxes: "moov" (the index) must come before "mdat" (the frames)
      const boxes: string[] = [];
      for (let at = 0; at + 8 <= file.length; ) {
        const size = file.readUInt32BE(at);
        boxes.push(file.subarray(at + 4, at + 8).toString("latin1"));
        if (size < 8) break;
        at += size;
      }
      expect(boxes[0], path).toBe("ftyp");
      expect(boxes.indexOf("moov"), path).toBeLessThan(boxes.indexOf("mdat"));
    }
  });
});
