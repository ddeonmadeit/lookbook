import { describe, expect, it } from "vitest";
import {
  imageExtension,
  planImport,
  storageFolderFor,
  toImportRow,
  withPositions,
  type ShopifyImportNode,
} from "@/lib/shopifyImport";
import { SHOPIFY_HANDLE_ORDER } from "@/lib/products";
import recovered from "@/data/recoveredShopifyCatalogue.json";

type VariantSpec = { values: Array<[string, string]>; price: string; available?: boolean };

function node(
  handle: string,
  opts: {
    title?: string;
    createdAt?: string;
    variants?: VariantSpec[];
    options?: Array<{ name: string; values: string[] }>;
    images?: string[];
  } = {},
): ShopifyImportNode {
  const variants: VariantSpec[] = opts.variants ?? [
    { values: [["Title", "Default Title"]], price: "120.0", available: true },
  ];
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: opts.title ?? handle,
    description: `About ${handle}`,
    descriptionHtml: `<p>About ${handle}</p>`,
    createdAt: opts.createdAt ?? "2025-01-01T00:00:00Z",
    availableForSale: variants.some((v) => v.available !== false),
    images: { edges: (opts.images ?? [`https://cdn.shopify.com/${handle}.jpg`]).map((url) => ({ node: { url, altText: null } })) },
    options: opts.options ?? [{ name: "Title", values: ["Default Title"] }],
    variants: {
      edges: variants.map((v) => ({
        node: {
          title: v.values.map(([, val]) => val).join(" / "),
          availableForSale: v.available !== false,
          price: { amount: v.price, currencyCode: "AUD" },
          selectedOptions: v.values.map(([name, value]) => ({ name, value })),
        },
      })),
    },
  };
}

const hoodie = node("palm-hoodie", {
  title: "Palm Hoodie",
  options: [
    { name: "Size", values: ["S", "M", "L"] },
    { name: "Colour", values: ["Black"] },
  ],
  variants: [
    { values: [["Size", "S"], ["Colour", "Black"]], price: "180.0" },
    { values: [["Size", "M"], ["Colour", "Black"]], price: "180.0", available: false },
    { values: [["Size", "L"], ["Colour", "Black"]], price: "195.0" },
  ],
  images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
});

describe("toImportRow", () => {
  it("stores a product with no real options the way ProductForm does: no options, no variants", () => {
    const row = toImportRow(node("tan-jorts"), 7);
    expect(row.options).toEqual([]);
    expect(row.variants).toEqual([]);
    expect(row.available).toBe(true);
    expect(row.price).toBe(120);
    expect(row.currency).toBe("AUD");
    expect(row.sort_order).toBe(7);
  });

  it("marks a sold-out simple product unavailable at product level", () => {
    const row = toImportRow(node("x", { variants: [{ values: [["Title", "Default Title"]], price: "50", available: false }] }), 1);
    expect(row.available).toBe(false);
    expect(row.variants).toEqual([]);
  });

  it("uses ProductForm's variant id and title conventions", () => {
    const row = toImportRow(hoodie, 3);
    expect(row.variants.map((v) => v.id)).toEqual([
      "palm-hoodie::S/Black",
      "palm-hoodie::M/Black",
      "palm-hoodie::L/Black",
    ]);
    expect(row.variants.map((v) => v.title)).toEqual(["S / Black", "M / Black", "L / Black"]);
    expect(row.options).toEqual([
      { name: "Size", values: ["S", "M", "L"] },
      { name: "Colour", values: ["Black"] },
    ]);
  });

  it("keeps per-variant prices and prices the product at the cheapest variant", () => {
    const row = toImportRow(hoodie, 3);
    expect(row.variants.map((v) => v.price)).toEqual([180, 180, 195]);
    expect(row.price).toBe(180);
  });

  it("records sold-out sizes as stock 0 so a later edit can't flip them back in stock", () => {
    const row = toImportRow(hoodie, 3);
    const m = row.variants.find((v) => v.title === "M / Black")!;
    expect(m).toMatchObject({ available: false, stock: 0 });
    const s = row.variants.find((v) => v.title === "S / Black")!;
    expect(s).toMatchObject({ available: true, stock: null });
    expect(row.available).toBe(true);
  });

  it("is unavailable when every variant is sold out", () => {
    const soldOut = node("gone", {
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { values: [["Size", "S"]], price: "10", available: false },
        { values: [["Size", "M"]], price: "10", available: false },
      ],
    });
    const row = toImportRow(soldOut, 1);
    expect(row.available).toBe(false);
    expect(row.variants.every((v) => v.stock === 0)).toBe(true);
  });

  it("keeps every image, both descriptions, and the original handle (so old product URLs still work)", () => {
    const row = toImportRow(node("the-shoodie®", { images: ["https://cdn.shopify.com/1.jpg", "https://cdn.shopify.com/2.jpg"] }), 5);
    expect(row.handle).toBe("the-shoodie®");
    expect(row.images).toHaveLength(2);
    expect(row.description).toBe("About the-shoodie®");
    expect(row.description_html).toBe("<p>About the-shoodie®</p>");
  });
});

describe("planImport", () => {
  const oldGrid = ["palm-hoodie", "tan-jorts", "pearl-jorts"];
  const nodes = [
    node("pearl-jorts", { createdAt: "2025-03-01T00:00:00Z" }),
    node("palm-hoodie", { title: "Palm Hoodie", createdAt: "2025-01-01T00:00:00Z" }),
    node("secret-sample", { createdAt: "2025-02-01T00:00:00Z" }),
    node("tan-jorts", { createdAt: "2025-04-01T00:00:00Z" }),
  ];

  it("numbers every Shopify product by creation date, like the old storefront", () => {
    const plan = planImport(nodes, [], oldGrid);
    const numbers = Object.fromEntries(plan.map((c) => [c.row.handle, c.row.sort_order]));
    expect(numbers).toEqual({ "palm-hoodie": 1, "secret-sample": 2, "pearl-jorts": 3, "tan-jorts": 4 });
  });

  it("orders the old storefront grid first, then anything else by creation date", () => {
    const plan = planImport(nodes, [], oldGrid);
    expect(plan.map((c) => c.row.handle)).toEqual(["palm-hoodie", "tan-jorts", "pearl-jorts", "secret-sample"]);
  });

  it("never imports a handle that's already in the store", () => {
    const existing = [{ handle: "tan-jorts", title: "Tan Jorts (edited)", sort_order: 30 }];
    const tan = planImport(nodes, existing, oldGrid).find((c) => c.row.handle === "tan-jorts")!;
    expect(tan.status).toBe("exists");
    expect(tan.selectedByDefault).toBe(false);
  });

  it("flags a likely hand-made re-creation (same title, different handle) and leaves it unticked", () => {
    const existing = [{ handle: "palm-hoodie-v2", title: "  palm HOODIE ", sort_order: 25 }];
    const palm = planImport(nodes, existing, oldGrid).find((c) => c.row.handle === "palm-hoodie")!;
    expect(palm.status).toBe("title-match");
    expect(palm.selectedByDefault).toBe(false);
  });

  it("ticks new old-storefront products by default but not ones that weren't on the grid", () => {
    const plan = planImport(nodes, [], oldGrid);
    const ticked = plan.filter((c) => c.selectedByDefault).map((c) => c.row.handle);
    expect(ticked).toEqual(["palm-hoodie", "tan-jorts", "pearl-jorts"]);
    const extra = plan.find((c) => c.row.handle === "secret-sample")!;
    expect(extra.onOldStorefront).toBe(false);
    expect(extra.status).toBe("new");
  });

  it("reports when an imported product's number is already used by a current product", () => {
    const existing = [{ handle: "new-drop", title: "New Drop", sort_order: 1 }];
    const plan = planImport(nodes, existing, oldGrid);
    expect(plan.find((c) => c.row.handle === "palm-hoodie")!.numberTakenBy).toBe("New Drop");
    expect(plan.find((c) => c.row.handle === "tan-jorts")!.numberTakenBy).toBeNull();
  });
});

describe("withPositions", () => {
  it("appends after the current products without renumbering them", () => {
    const rows = planImport([node("a"), node("b")], [], ["a", "b"]).map((c) => c.row);
    expect(withPositions(rows, 26).map((r) => [r.handle, r.position])).toEqual([
      ["a", 26],
      ["b", 27],
    ]);
  });
});

describe("image storage paths", () => {
  it("strips characters Supabase Storage rejects in keys", () => {
    expect(storageFolderFor("the-shoodie®")).toBe("the-shoodie");
    expect(storageFolderFor("Flared 1:1 Jeans")).toBe("flared-1-1-jeans");
    expect(storageFolderFor("®®")).toBe("product");
  });

  it("picks the extension from the content type, then the URL", () => {
    expect(imageExtension("image/webp", "https://cdn.shopify.com/x.jpg")).toBe("webp");
    expect(imageExtension("image/jpeg; charset=binary", "https://x/y")).toBe("jpg");
    expect(imageExtension(null, "https://cdn.shopify.com/files/a.PNG?v=123")).toBe("png");
    expect(imageExtension("application/octet-stream", "https://cdn.shopify.com/a.jpeg")).toBe("jpg");
    expect(imageExtension(null, "not a url")).toBe("jpg");
  });
});

describe("explicit display numbers", () => {
  it("keeps a product's own number and numbers the rest after everything already in use", () => {
    const nodes = [
      { ...node("old-a", { createdAt: "2025-01-01T00:00:00Z" }), displayNumber: 2 },
      { ...node("old-b", { createdAt: "2025-02-01T00:00:00Z" }), displayNumber: 1 },
      node("gone-1", { createdAt: "2024-06-01T00:00:00Z" }),
      node("gone-2", { createdAt: "2024-07-01T00:00:00Z" }),
    ];
    const existing = [{ handle: "current", title: "Current", sort_order: 30 }];
    const numbers = Object.fromEntries(planImport(nodes, existing, ["old-a", "old-b"]).map((c) => [c.row.handle, c.row.sort_order]));
    expect(numbers).toEqual({ "old-a": 2, "old-b": 1, "gone-1": 31, "gone-2": 32 });
  });

  it("passes a source caveat through to the preview", () => {
    const [c] = planImport([{ ...node("x"), archiveNote: "price estimated" }], [], ["x"]);
    expect(c.note).toBe("price estimated");
    expect(planImport([node("y")], [], ["y"])[0].note).toBeNull();
  });

  it("uses the source's shipping weight when it has one", () => {
    expect(toImportRow({ ...node("w"), weightGrams: 300 }, 1).weight_grams).toBe(300);
    expect(toImportRow(node("w"), 1).weight_grams).toBe(0);
  });
});

describe("recovered catalogue data", () => {
  const catalogue = recovered as unknown as ShopifyImportNode[];
  // The store's products when the catalogue was recovered (numbers 025-030).
  const current = [
    ["stitch-canvas-shorts", 25], ["stamp-tee", 26], ["rtt-trucker-cap", 27],
    ["spine-henley", 28], ["spine-hoodie", 29], ["ripple-button-up", 30],
  ].map(([handle, sort_order]) => ({ handle: handle as string, title: handle as string, sort_order: sort_order as number }));

  it("has every old storefront product, numbered 001-024 exactly once", () => {
    const handles = catalogue.map((n) => n.handle);
    expect(new Set(handles).size).toBe(handles.length);
    for (const h of SHOPIFY_HANDLE_ORDER) expect(handles).toContain(h);
    const numbered = catalogue.filter((n) => n.displayNumber != null);
    expect(numbered.map((n) => n.handle).sort()).toEqual([...SHOPIFY_HANDLE_ORDER].sort());
    expect(numbered.map((n) => n.displayNumber).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("prices everything in AUD, matching prices read straight from the archive", () => {
    const price = (h: string) => toImportRow(catalogue.find((n) => n.handle === h)!, 0).price;
    for (const n of catalogue) {
      for (const e of n.variants.edges) {
        expect(e.node.price.currencyCode).toBe("AUD");
        expect(Number.isFinite(parseFloat(e.node.price.amount))).toBe(true);
      }
    }
    expect(price("sttu-teeshirt")).toBe(55);
    expect(price("the-magnum-opus-leather-jacket")).toBe(748);
    expect(price("camo-jersey")).toBe(49.99);
    expect(price("squid-ink-thermal")).toBe(48);
  });

  it("loads every image from Shopify's CDN, since knotsss.com no longer serves them", () => {
    for (const n of catalogue) {
      for (const e of n.images.edges) expect(e.node.url).toMatch(/^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0596\/8343\/8628\/files\//);
    }
  });

  it("flags exactly the three products whose price had to be estimated", () => {
    expect(catalogue.filter((n) => n.archiveNote).map((n) => n.handle).sort()).toEqual(
      ["bleko-x-knots-tee", "the-shoodie®", "untitled-oct1_21-14"].sort(),
    );
  });

  it("restores the old grid without touching or clashing with the current products", () => {
    const plan = planImport(catalogue, current, SHOPIFY_HANDLE_ORDER);
    const ticked = plan.filter((c) => c.selectedByDefault);
    expect(ticked.map((c) => c.row.handle)).toEqual(SHOPIFY_HANDLE_ORDER);
    expect(plan.every((c) => c.status === "new")).toBe(true);
    expect(ticked.every((c) => c.numberTakenBy === null)).toBe(true);
    // They come back with the numbers the old storefront showed.
    expect(ticked.map((c) => c.row.sort_order).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const numberOf = (h: string) => plan.find((c) => c.row.handle === h)!.row.sort_order;
    expect(numberOf("sttu-teeshirt")).toBe(1);
    expect(numberOf("the-shoodie®")).toBe(23);
    // Products that left the store before it closed are numbered after the current ones.
    expect(Math.min(...plan.filter((c) => !c.onOldStorefront).map((c) => c.row.sort_order))).toBe(31);
    for (const c of plan) {
      const ids = c.row.variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
