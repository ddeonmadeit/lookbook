// Server-side cart pricing, shared by the shipping quote and checkout
// functions.
//
// The browser only ever sends product ids, variant ids and quantities. Every
// price, title and weight is read back from the database here, so a tampered
// client cannot change what it gets charged or how much shipping it pays.

/** The slice of the Supabase client these helpers actually use. */
interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface Filterable<T> {
  in(column: string, values: readonly string[]): Promise<QueryResult<T[]>>;
  eq(column: string, value: unknown): Filterable<T> & { maybeSingle(): Promise<QueryResult<T>> };
}
export interface DbClient {
  from(table: string): {
    select(columns?: string): Filterable<Record<string, unknown>> &
      Promise<QueryResult<Record<string, unknown>[]>>;
  };
}

export interface CartLine {
  product_id: string;
  variant_id: string;
  quantity: number;
}

export interface PricedLine {
  product_id: string;
  variant_id: string;
  title: string;
  variantTitle: string;
  selectedOptions: unknown;
  unitPrice: number;
  quantity: number;
  image: string | null;
  weight_grams: number;
}

interface ProductRecord {
  id: string;
  title: string;
  price: number;
  currency: string;
  variants: unknown;
  images: unknown;
  weight_grams: number;
}

export type PriceCartResult =
  | { ok: true; lines: PricedLine[]; subtotal: number; currency: string }
  | { ok: false; error: string; status: number };

export async function priceCart(
  supabase: DbClient,
  items: CartLine[],
): Promise<PriceCartResult> {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Your bag is empty.", status: 400 };
  }

  const ids = [...new Set(items.map((i) => i.product_id))];
  const { data: products, error } = await supabase
    .from("products")
    .select("id,title,price,currency,variants,images,weight_grams")
    .in("id", ids);
  if (error) throw error;

  const lines: PricedLine[] = [];
  let subtotal = 0;
  let currency = "aud";

  for (const line of items) {
    const qty = Math.max(1, Math.min(99, Math.floor(line.quantity || 1)));
    const product = products?.find((p) => p.id === line.product_id) as ProductRecord | undefined;
    if (!product) {
      return { ok: false, error: "A product in your bag no longer exists.", status: 409 };
    }

    const variants = (product.variants as Array<Record<string, unknown>>) || [];
    const variant = variants.find((v) => v.id === line.variant_id);
    if (!variant || variant.available === false) {
      return { ok: false, error: `"${product.title}" is no longer available.`, status: 409 };
    }

    const stock = variant.stock as number | null | undefined;
    if (stock !== null && stock !== undefined && stock < qty) {
      return { ok: false, error: `Not enough stock left for "${product.title}".`, status: 409 };
    }

    const unitPrice = Number(variant.price ?? product.price) || 0;
    currency = String(product.currency || "AUD").toLowerCase();
    subtotal += unitPrice * qty;

    const variantTitle = String(variant.title ?? "");
    const image = (product.images as Array<{ url?: string }>)?.[0]?.url ?? null;

    lines.push({
      product_id: product.id,
      variant_id: line.variant_id,
      title: product.title,
      variantTitle,
      selectedOptions: variant.selectedOptions ?? [],
      unitPrice,
      quantity: qty,
      image,
      weight_grams: Number(product.weight_grams) || 0,
    });
  }

  return { ok: true, lines, subtotal: Math.round(subtotal * 100) / 100, currency };
}

/** Shipping configuration + rate card, read once per request. */
export async function loadShippingConfig(supabase: DbClient) {
  const [{ data: settings }, { data: rates }] = await Promise.all([
    supabase
      .from("store_settings")
      .select(
        "shipping_handling_fee,default_item_weight_grams,shipping_flat_rate,free_shipping_threshold",
      )
      .eq("id", 1)
      .maybeSingle(),
    supabase.from("shipping_rates").select("zone,max_weight_grams,price"),
  ]);

  return {
    handlingFee: Number(settings?.shipping_handling_fee ?? 8.4),
    defaultItemWeight: Number(settings?.default_item_weight_grams ?? 400),
    flatRateFallback: Number(settings?.shipping_flat_rate ?? 0),
    freeThreshold:
      settings?.free_shipping_threshold === null || settings?.free_shipping_threshold === undefined
        ? null
        : Number(settings.free_shipping_threshold),
    rates: (rates ?? []) as Array<{ zone: string; max_weight_grams: number; price: number }>,
  };
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
