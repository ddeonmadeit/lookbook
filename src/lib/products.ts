import { type ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { supabase } from "@/integrations/supabase/client";
import { ensureSettings } from "@/stores/settingsStore";

/**
 * Unified product source. The storefront talks to this module instead of Shopify
 * directly, so it works identically whether products come from Shopify or from
 * the manual (Supabase) catalog. Everything is normalised to the `ShopifyProduct`
 * shape the UI already understands.
 */

// Manual product row shape (mirrors public.products).
export interface ManualImage {
  url: string;
  altText?: string | null;
}
export interface ManualOption {
  name: string;
  values: string[];
}
export interface ManualVariant {
  id: string;
  title: string;
  price: number;
  available: boolean;
  /** Remaining units; null = not tracked (availability driven by `available` alone). */
  stock?: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
}
export interface ProductRow {
  id: string;
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
  created_at: string;
}

// Original storefront ordering for the Shopify source (from knotsss.com/collections/all).
const SHOPIFY_HANDLE_ORDER = [
  "untitled-oct1_21-14",
  "sttu-teeshirt",
  "crescent-raw-denim",
  "palm-hoodie",
  "the-shoodie®",
  "bulletproof-vest",
  "squid-ink-thermal",
  "the-magnum-opus-leather-jacket",
  "camo-mohair-sweater",
  "crescent-washed-straight-leg-jeans",
  "sea-reactive-hoodies",
  "sea-washed-sweatpants-unisex",
  "cactus-button-up",
  "tan-jorts",
  "pearl-jorts",
  "totem-tee-reversible",
  "flared-1-1-jeans",
  "mohair-knit",
  "patch-switch-hoodie",
  "bleko-x-knots-tee",
  "patch-switch-trucker-hat",
  "camo-jersey",
  "tropic-thunder-t-shirt",
  "rippleshorts",
];

export interface StorefrontData {
  products: ShopifyProduct[];
  /** handle -> display number (e.g. "001") shown under each product in the grid */
  displayNumbers: Record<string, string>;
}

/** Convert a manual product row into the ShopifyProduct shape used across the UI. */
function manualRowToProduct(row: ProductRow): ShopifyProduct {
  const currency = row.currency || "USD";
  const images = (row.images || []).map((img) => ({
    node: { url: img.url, altText: img.altText ?? null },
  }));

  let variants = row.variants || [];
  if (variants.length === 0) {
    // Guarantee at least one purchasable variant.
    variants = [
      {
        id: `${row.id}:default`,
        title: "Default Title",
        price: row.price,
        available: row.available,
        selectedOptions: [],
      },
    ];
  }

  return {
    node: {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      descriptionHtml: row.description_html ?? undefined,
      handle: row.handle,
      createdAt: row.created_at,
      priceRange: {
        minVariantPrice: { amount: String(row.price), currencyCode: currency },
      },
      images: { edges: images },
      variants: {
        edges: variants.map((v) => ({
          node: {
            id: v.id,
            title: v.title,
            price: { amount: String(v.price), currencyCode: currency },
            availableForSale: v.available,
            stock: v.stock ?? null,
            selectedOptions: v.selectedOptions || [],
          },
        })),
      },
      options: row.options || [],
    },
  };
}

async function getManualStorefront(): Promise<StorefrontData> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load manual products:", error);
    return { products: [], displayNumbers: {} };
  }

  const rows = (data as unknown as ProductRow[]) || [];
  const products = rows.map(manualRowToProduct);

  const displayNumbers: Record<string, string> = {};
  products.forEach((p, i) => {
    displayNumbers[p.node.handle] = String(i + 1).padStart(3, "0");
  });

  return { products, displayNumbers };
}

async function getShopifyStorefront(): Promise<StorefrontData> {
  const data = await storefrontApiRequest(PRODUCTS_QUERY, { first: 50 });
  const edges = data?.data?.products?.edges || [];
  const allProducts: ShopifyProduct[] = edges.map((edge: { node: ShopifyProduct["node"] }) => ({
    node: edge.node,
  }));

  // Global creation-order map: sort ALL products by createdAt, assign 001, 002, ...
  const sorted = [...allProducts].sort((a, b) =>
    (a.node.createdAt || "").localeCompare(b.node.createdAt || ""),
  );
  const displayNumbers: Record<string, string> = {};
  sorted.forEach((p, i) => {
    displayNumbers[p.node.handle] = String(i + 1).padStart(3, "0");
  });

  // Filter to the curated handle order.
  const handleSet = new Set(SHOPIFY_HANDLE_ORDER);
  const products = allProducts
    .filter((p) => handleSet.has(p.node.handle))
    .sort(
      (a, b) =>
        SHOPIFY_HANDLE_ORDER.indexOf(a.node.handle) -
        SHOPIFY_HANDLE_ORDER.indexOf(b.node.handle),
    );

  return { products, displayNumbers };
}

/** Storefront product list + display numbers, from whichever source is active. */
export async function getStorefront(): Promise<StorefrontData> {
  const { productSource } = await ensureSettings();
  return productSource === "shopify" ? getShopifyStorefront() : getManualStorefront();
}

/** Just the ordered product list (used by the product detail navigation). */
export async function getProducts(): Promise<ShopifyProduct[]> {
  return (await getStorefront()).products;
}
