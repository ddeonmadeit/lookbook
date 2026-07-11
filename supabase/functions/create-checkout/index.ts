// Creates a Stripe Checkout Session for the cart.
//
// Security model: the browser sends only product ids, variant ids, and
// quantities. Titles, prices, and currency are looked up server-side from the
// products table, so a tampered client can never change what gets charged.
// Stock is validated here and decremented by the stripe-webhook function only
// after payment actually succeeds.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CartLine {
  product_id: string;
  variant_id: string;
  quantity: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return json({ error: "Payments are not configured yet." }, 503);
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { items, success_url, cancel_url } = (await req.json()) as {
      items: CartLine[];
      success_url: string;
      cancel_url: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "Cart is empty." }, 400);
    }
    // Only allow redirecting back to our own site.
    const origin = new URL(req.headers.get("origin") ?? success_url).origin;
    for (const u of [success_url, cancel_url]) {
      if (!u || new URL(u).origin !== origin) {
        return json({ error: "Invalid redirect URL." }, 400);
      }
    }

    // Server-side price + stock lookup.
    const ids = [...new Set(items.map((i) => i.product_id))];
    const { data: products, error } = await supabase
      .from("products")
      .select("id,title,price,currency,variants,images")
      .in("id", ids);
    if (error) throw error;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const orderItems: Record<string, unknown>[] = [];
    let subtotal = 0;
    let currency = "usd";

    for (const line of items) {
      const qty = Math.max(1, Math.min(99, Math.floor(line.quantity || 1)));
      const product = products?.find((p) => p.id === line.product_id);
      if (!product) return json({ error: "A product in your bag no longer exists." }, 409);

      const variants = (product.variants as Array<Record<string, unknown>>) || [];
      const variant = variants.find((v) => v.id === line.variant_id);
      if (!variant || variant.available === false) {
        return json({ error: `"${product.title}" is no longer available.` }, 409);
      }
      const stock = variant.stock as number | null | undefined;
      if (stock !== null && stock !== undefined && stock < qty) {
        return json({ error: `Not enough stock left for "${product.title}".` }, 409);
      }

      const unitPrice = Number(variant.price ?? product.price) || 0;
      currency = String(product.currency || "USD").toLowerCase();
      subtotal += unitPrice * qty;

      const variantTitle = String(variant.title ?? "");
      const displayName =
        variantTitle && variantTitle !== "Default Title"
          ? `${product.title} — ${variantTitle}`
          : product.title;
      const image = (product.images as Array<{ url?: string }>)?.[0]?.url;

      lineItems.push({
        quantity: qty,
        price_data: {
          currency,
          unit_amount: Math.round(unitPrice * 100),
          product_data: { name: displayName, ...(image ? { images: [image] } : {}) },
        },
      });
      orderItems.push({
        product_id: product.id,
        variant_id: line.variant_id,
        title: product.title,
        variantTitle,
        selectedOptions: variant.selectedOptions ?? [],
        price: String(unitPrice),
        quantity: qty,
        image: image ?? null,
      });
    }

    // Record the order first (pending), then hand off to Stripe.
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        items: orderItems,
        subtotal,
        currency: currency.toUpperCase(),
        customer_name: "(pending payment)",
        customer_email: "(pending payment)",
        status: "pending",
        payment_provider: "stripe",
      })
      .select("id")
      .single();
    if (orderErr) throw orderErr;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      metadata: { order_id: order.id },
      shipping_address_collection: {
        allowed_countries: [
          "US", "CA", "GB", "AU", "NZ", "IE", "DE", "FR", "NL", "BE", "ES", "IT",
          "PT", "AT", "CH", "SE", "NO", "DK", "FI", "PL", "CZ", "JP", "KR", "SG",
          "HK", "AE", "MX", "BR",
        ],
      },
      phone_number_collection: { enabled: true },
    });

    await supabase.from("orders").update({ payment_id: session.id }).eq("id", order.id);

    return json({ url: session.url }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: "Could not start checkout." }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
