import { describe, expect, it } from "vitest";
import catalogueJson from "@/data/recoveredShopifyCatalogue.json";
import optimisationsJson from "@/data/photoOptimisations.json";
import revisionsJson from "@/data/recoveredRevisions.json";
import type { PhotoMap } from "@/lib/photoUpdates";
import { type RevisableRow, type Revisions, planRevision, revisionParts, sameJson } from "@/lib/recoveredRevisions";
import { type ShopifyImportNode, toImportRow } from "@/lib/shopifyImport";

const catalogue = catalogueJson as unknown as ShopifyImportNode[];
const revisions = revisionsJson as unknown as Revisions;
const { photos } = optimisationsJson as { photos: PhotoMap };
const node = (handle: string) => catalogue.find((n) => n.handle === handle)!;
const latestOf = (handle: string) => toImportRow(node(handle), node(handle).displayNumber ?? 0);

/** A product exactly as the first restore stored it. */
function asRestored(handle: string): RevisableRow {
  const latest = latestOf(handle);
  const { previous } = revisions[handle];
  return {
    images: previous.images ? previous.images.map((url) => ({ url, altText: latest.title })) : latest.images,
    description_html: previous.description_html !== undefined ? previous.description_html : latest.description_html,
    options: previous.sizes?.options ?? latest.options,
    variants: previous.sizes?.variants ?? latest.variants,
    weight_grams: previous.weight_grams ?? latest.weight_grams,
  };
}

describe("newer versions of restored products", () => {
  it("covers the products the April 2026 archive shows were changed", () => {
    expect(Object.keys(revisions).sort()).toEqual([
      "camo-mohair-sweater",
      "crescent-raw-denim",
      "crescent-washed-straight-leg-jeans",
      "the-magnum-opus-leather-jacket",
      "untitled-oct1_21-14",
    ]);
  });

  it("each recorded part really differs from the newer version", () => {
    for (const handle of Object.keys(revisions)) {
      const latest = latestOf(handle);
      const { previous } = revisions[handle];
      if (previous.images) expect(previous.images, handle).not.toEqual(latest.images.map((i) => i.url));
      if (previous.description_html !== undefined) expect(previous.description_html, handle).not.toBe(latest.description_html);
      if (previous.sizes) expect(sameJson(previous.sizes.variants, latest.variants), handle).toBe(false);
      if (previous.weight_grams !== undefined) expect(previous.weight_grams, handle).not.toBe(latest.weight_grams);
    }
  });

  it("brings an untouched restored product fully up to the newer version", () => {
    for (const handle of Object.keys(revisions)) {
      const latest = latestOf(handle);
      const { patch, applied } = planRevision(asRestored(handle), revisions[handle], latest);
      expect(applied, handle).toEqual(revisionParts(revisions[handle]));
      if (applied.includes("photos")) expect(patch.images, handle).toEqual(latest.images);
      if (applied.includes("description")) {
        expect(patch.description_html, handle).toBe(latest.description_html);
        expect(patch.description, handle).toBe(latest.description);
      }
      if (applied.includes("sizes")) expect([patch.options, patch.variants], handle).toEqual([latest.options, latest.variants]);
    }
  });

  it("matches what the database returns, whatever order it puts jsonb keys in", () => {
    const row = asRestored("crescent-raw-denim");
    const reordered = {
      ...row,
      variants: row.variants.map((v) => Object.fromEntries(Object.entries(v).reverse())) as typeof row.variants,
    };
    expect(planRevision(reordered, revisions["crescent-raw-denim"], latestOf("crescent-raw-denim")).applied).toContain("sizes");
  });

  it("leaves parts the owner has edited, and still applies the rest", () => {
    const row = asRestored("untitled-oct1_21-14");
    row.images = [...row.images, { url: "https://abc.supabase.co/storage/v1/object/public/product-images/x/1.png" }];
    row.options = [{ name: "Size", values: ["One size"] }]; // owner set up their own sizes
    row.variants = [];
    const { patch, applied } = planRevision(row, revisions["untitled-oct1_21-14"], latestOf("untitled-oct1_21-14"));
    expect(applied).toEqual(["description", "weight"]);
    expect(patch.images).toBeUndefined();
    expect(patch.variants).toBeUndefined();
    expect(patch.weight_grams).toBe(5000);
  });

  it("does nothing once applied, so running the tool again is safe", () => {
    for (const handle of Object.keys(revisions)) {
      const latest = latestOf(handle);
      const updated: RevisableRow = { ...latest };
      expect(planRevision(updated, revisions[handle], latest).applied, handle).toEqual([]);
    }
  });

  it("swaps the Magnum Opus 3D renders for the flat lays, background removed", () => {
    const urls = latestOf("the-magnum-opus-leather-jacket").images.map((i) => i.url);
    expect(urls[0]).toContain("/IMG-4794.jpg");
    expect(urls[1]).toContain("/IMG-4793.jpg");
    expect(photos[urls[0]].cutout).toBe(true);
    for (const old of revisions["the-magnum-opus-leather-jacket"].previous.images!.slice(0, 4)) {
      expect(urls.map((u) => u.split("?")[0])).not.toContain(old.split("?")[0]);
    }
    expect(latestOf("crescent-washed-straight-leg-jeans").images[0].url).toContain("/IMG-4803.jpg");
  });

  it("still has staged copies of the restored photos, for a product whose photos were edited", () => {
    for (const { previous } of Object.values(revisions)) for (const url of previous.images ?? []) expect(photos[url], url).toBeDefined();
  });
});

describe("sameJson", () => {
  it("ignores key order but not values or array order", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson({ a: null }, { a: undefined })).toBe(false);
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
