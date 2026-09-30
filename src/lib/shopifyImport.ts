import type { ManualImage, ManualOption, ManualVariant } from "@/lib/products";

/**
 * One-off migration of the old Shopify catalogue into the manual (Supabase)
 * product tables. Pure planning/mapping lives here so it can be unit tested;
 * the dashboard dialog does the network work (image copies, inserts).
 *
 * The Shopify store itself is closed, so the source is a catalogue recovered
 * from Common Crawl's archived copies of its pages (src/data), kept in the
 * Storefront API's product shape so this mapping stays the same either way.
 *
 * Imported rows are shaped exactly like ones ProductForm creates, so editing an
 * imported product later behaves the same as editing a hand-made one.
 */

export interface ShopifyImportNode {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  createdAt: string;
  availableForSale: boolean;
  images: { edges: Array<{ node: { url: string; altText: string | null } }> };
  options: Array<{ name: string; values: string[] }>;
  variants: {
    edges: Array<{
      node: {
        title: string;
        availableForSale: boolean;
        price: { amount: string; currencyCode: string };
        selectedOptions: Array<{ name: string; value: string }>;
      };
    }>;
  };
  /** Number the old storefront displayed (e.g. 7 -> "007"). Absent = number it on import. */
  displayNumber?: number;
  /** Shipping weight in grams, where the source had one. */
  weightGrams?: number;
  /** Caveat to show before importing (e.g. an estimated price). */
  archiveNote?: string;
}

/** Insert payload for public.products (minus `position`, assigned at import time). */
export interface ImportRow {
  handle: string;
  title: string;
  description: string | null;
  description_html: string | null;
  price: number;
  currency: string;
  images: ManualImage[];
  options: ManualOption[];
  variants: ManualVariant[];
  available: boolean;
  sort_order: number;
  weight_grams: number;
}

/** The fields of an existing store product that planning needs. */
export interface ExistingProduct {
  handle: string;
  title: string;
  sort_order: number;
}

export type CandidateStatus =
  /** Not in the store yet — safe to import. */
  | "new"
  /** Same handle already in the store; never imported, never overwritten. */
  | "exists"
  /** Different handle but same title as a store product — likely a re-creation. */
  | "title-match";

export interface ImportCandidate {
  row: ImportRow;
  status: CandidateStatus;
  /** Was shown on the old storefront grid (in its curated handle list). */
  onOldStorefront: boolean;
  selectedByDefault: boolean;
  /** Title of the existing product already using this display number, if any. */
  numberTakenBy: string | null;
  /** Caveat about the recovered data for this product, if any. */
  note: string | null;
}

// Shopify's placeholder for a product with no real options (no sizes/colours).
const DEFAULT_TITLE = "Default Title";

function isDefaultOnly(node: ShopifyImportNode): boolean {
  const variants = node.variants.edges;
  return (
    variants.length === 1 &&
    variants[0].node.selectedOptions.every((o) => o.value === DEFAULT_TITLE)
  );
}

/**
 * Map one Shopify product to a products row, mirroring ProductForm:
 * variant ids are `handle::Value/Value`, titles are "Value / Value", and a
 * product without real options stores no variants (availability then comes
 * from the product-level `available` flag).
 *
 * The source has no stock counts, so in-stock variants are left untracked
 * (stock null). Sold-out variants get stock 0 rather than only
 * `available: false`: ProductForm derives untracked variants' availability
 * from the product switch on save, so without a 0 an edit would quietly mark
 * sold-out sizes as in stock again.
 */
export function toImportRow(node: ShopifyImportNode, displayNumber: number): ImportRow {
  const variantNodes = node.variants.edges.map((e) => e.node);
  const prices = variantNodes.map((v) => parseFloat(v.price.amount)).filter((n) => !Number.isNaN(n));
  const currency = variantNodes[0]?.price.currencyCode || "USD";
  const anyAvailable = variantNodes.some((v) => v.availableForSale);

  const base = {
    handle: node.handle,
    title: node.title.trim(),
    description: node.description.trim() || null,
    description_html: node.descriptionHtml.trim() || null,
    price: prices.length ? Math.min(...prices) : 0,
    currency,
    images: node.images.edges.map((e) => ({ url: e.node.url, altText: e.node.altText ?? node.title })),
    available: anyAvailable,
    sort_order: displayNumber,
    // 0 = use the store default.
    weight_grams: Math.max(0, Math.round(node.weightGrams ?? 0)),
  };

  if (isDefaultOnly(node)) {
    return { ...base, options: [], variants: [] };
  }

  const options: ManualOption[] = node.options
    .filter((o) => !(o.values.length === 1 && o.values[0] === DEFAULT_TITLE))
    .map((o) => ({ name: o.name, values: [...o.values] }));

  const variants: ManualVariant[] = variantNodes.map((v) => {
    const values = v.selectedOptions.map((s) => s.value);
    return {
      id: `${node.handle}::${values.join("/")}`,
      title: values.join(" / "),
      price: parseFloat(v.price.amount) || 0,
      available: v.availableForSale,
      stock: v.availableForSale ? null : 0,
      selectedOptions: v.selectedOptions.map((s) => ({ name: s.name, value: s.value })),
    };
  });

  return { ...base, options, variants };
}

const normTitle = (t: string) => t.trim().toLowerCase();

/**
 * Decide what to import and in which order.
 *
 * - Display numbers: a product carrying the number the old storefront showed
 *   keeps it. The rest are numbered in creation order, from 1 when nothing
 *   carries a number (how the old storefront computed them), otherwise after
 *   the highest number already in use so they can't collide.
 * - Order: products from the old storefront grid first, in that grid's order,
 *   then any others by creation date.
 * - A handle already in the store is never imported (existing products are
 *   kept untouched). A matching title with a different handle is flagged and
 *   left unticked, since it's probably the same item re-created by hand.
 * - Products that weren't on the old storefront grid start unticked.
 */
export function planImport(
  nodes: ShopifyImportNode[],
  existing: ExistingProduct[],
  oldStorefrontOrder: string[],
): ImportCandidate[] {
  const byCreation = [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const numberOf = new Map<string, number>();
  const explicit = byCreation.filter((n) => n.displayNumber != null);
  explicit.forEach((n) => numberOf.set(n.handle, n.displayNumber!));
  let next = explicit.length
    ? Math.max(...explicit.map((n) => n.displayNumber!), ...existing.map((p) => p.sort_order)) + 1
    : 1;
  byCreation.filter((n) => n.displayNumber == null).forEach((n) => numberOf.set(n.handle, next++));

  const rank = new Map(oldStorefrontOrder.map((h, i) => [h, i]));
  const ordered = [...byCreation].sort((a, b) => {
    const ra = rank.get(a.handle) ?? Infinity;
    const rb = rank.get(b.handle) ?? Infinity;
    return ra === rb ? 0 : ra - rb; // stable sort keeps creation order among the rest
  });

  const existingHandles = new Set(existing.map((p) => p.handle));
  const existingTitles = new Set(existing.map((p) => normTitle(p.title)));
  const numberOwner = new Map(existing.map((p) => [p.sort_order, p.title]));

  return ordered.map((node) => {
    const row = toImportRow(node, numberOf.get(node.handle)!);
    const onOldStorefront = rank.has(node.handle);
    const status: CandidateStatus = existingHandles.has(node.handle)
      ? "exists"
      : existingTitles.has(normTitle(node.title))
        ? "title-match"
        : "new";
    return {
      row,
      status,
      onOldStorefront,
      selectedByDefault: status === "new" && onOldStorefront,
      numberTakenBy: status === "exists" ? null : (numberOwner.get(row.sort_order) ?? null),
      note: node.archiveNote ?? null,
    };
  });
}

/** Grid positions for the chosen rows: appended after the current products, in plan order. */
export function withPositions(rows: ImportRow[], nextPosition: number): Array<ImportRow & { position: number }> {
  return rows.map((row, i) => ({ ...row, position: nextPosition + i }));
}

/**
 * Storage folder for a product's images. Handles can hold characters that
 * Supabase Storage rejects in object keys (e.g. "the-shoodie®"), so keep only
 * a safe subset.
 */
export function storageFolderFor(handle: string): string {
  const safe = handle
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "product";
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** File extension for a downloaded image, from its content type or else its URL. */
export function imageExtension(contentType: string | null, url: string): string {
  const fromType = contentType ? EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()] : undefined;
  if (fromType) return fromType;
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  } catch {
    // fall through
  }
  return "jpg";
}

/**
 * The web-sized version of a Shopify CDN image: at most `maxWidth` pixels wide
 * (the CDN never upscales). Request it with `Accept: image/webp` and the CDN
 * answers with WebP, keeping transparency: the same versions the Shopify
 * storefront served to browsers, and a fraction of the originals' size.
 */
export function webSizedImageUrl(url: string, maxWidth = 2048): string {
  const u = new URL(url);
  u.searchParams.set("width", String(maxWidth));
  return u.toString();
}

/**
 * Object key for an imported image. Deterministic, so re-running an import
 * after a partial failure overwrites the same files instead of piling up
 * copies.
 */
export function importedImagePath(handle: string, index: number, ext: string): string {
  return `${storageFolderFor(handle)}/shopify-${index + 1}.${ext}`;
}
