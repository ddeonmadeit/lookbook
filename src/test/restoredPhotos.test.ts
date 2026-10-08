import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifestJson from "@/data/restoredPhotoUpdates.json";
import catalogueJson from "@/data/recoveredShopifyCatalogue.json";
import { SHOPIFY_HANDLE_ORDER } from "@/lib/products";
import type { PhotoManifest } from "@/lib/photoUpdates";
import type { ShopifyImportNode } from "@/lib/shopifyImport";

const manifest = manifestJson as PhotoManifest;
const catalogue = catalogueJson as unknown as ShopifyImportNode[];

describe("restored photo manifest", () => {
  it("covers exactly the products the restore added", () => {
    expect(Object.keys(manifest).sort()).toEqual([...SHOPIFY_HANDLE_ORDER].sort());
  });

  it("matches each product's photos, in order, as the restore stored them", () => {
    for (const [handle, updates] of Object.entries(manifest)) {
      const node = catalogue.find((n) => n.handle === handle)!;
      expect(updates.map((u) => u.from)).toEqual(node.images.edges.map((e) => e.node.url));
    }
  });

  it("has a transparent WebP cut-out on disk for every product shot", () => {
    const cutouts = Object.values(manifest).flat().filter((u) => u.cutout);
    expect(cutouts).toHaveLength(89);
    for (const u of cutouts) {
      const file = readFileSync(`public/${u.cutout}`);
      expect(file.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(file.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(file.subarray(12, 16).toString("latin1")).toBe("VP8X");
      expect(file[20] & 0x10).toBe(0x10); // alpha flag
    }
  });

  it("never cuts out size charts or text graphics", () => {
    const at = (handle: string, n: number) => manifest[handle][n - 1];
    for (const [h, n] of [["sttu-teeshirt", 7], ["totem-tee-reversible", 10], ["sttu-teeshirt", 8], ["the-magnum-opus-leather-jacket", 4]] as const) {
      expect(at(h, n).cutout).toBeUndefined();
    }
  });
});
