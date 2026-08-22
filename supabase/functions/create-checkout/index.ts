// Creates a Stripe Embedded Checkout session for the cart.
//
// Embedded (rather than hosted) mode keeps the shopper on knotsss.com: Stripe
// renders the payment form inside our own page, so there is no redirect out to
// stripe.com and back.
//
// Security model: the browser sends only product ids, variant ids, quantities
// and a destination country. Titles, prices, weights and the shipping charge
// are all computed server-side, so a tampered client can never change what it
// gets charged. Stock is validated here and only decremented by the
// stripe-webhook function once payment actually succeeds.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, loadShippingConfig, priceCart, type CartLine } from "../_shared/cart.ts";
import { quoteShipping, totalWeightGrams } from "../_shared/shipping.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY");
    if (!stripeKey || !publishableKey) {
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

    const { items, country, return_url } = (await req.json()) as {
      items: CartLine[];
      country: string;
      return_url: string;
    };

    // Only ever return the shopper to our own site.
    const origin = req.headers.get("origin");
    if (!return_url || !origin || new URL(return_url).origin !== origin) {
      return json({ error: "Invalid return URL." }, 400);
    }

    const destination = String(country || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(destination)) {
      return json({ error: "Choose a delivery country first." }, 400);
    }

    const priced = await priceCart(supabase, items);
    if (!priced.ok) return json({ error: priced.error }, priced.status);

    const config = await loadShippingConfig(supabase);
    const weightGrams = totalWeightGrams(priced.lines, config.defaultItemWeight);
    const quote = quoteShipping({
      country: destination,
      weightGrams,
      subtotal: priced.subtotal,
      rates: config.rates,
      handlingFee: config.handlingFee,
      freeThreshold: config.freeThreshold,
      flatRateFallback: config.flatRateFallback,
    });

    const currency = priced.currency;
    const total = Math.round((priced.subtotal + quote.cost) * 100) / 100;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priced.lines.map((l) => ({
      quantity: l.quantity,
      price_data: {
        currency,
        unit_amount: Math.round(l.unitPrice * 100),
        product_data: {
          name:
            l.variantTitle && l.variantTitle !== "Default Title"
              ? `${l.title} — ${l.variantTitle}`
              : l.title,
          ...(l.image ? { images: [l.image] } : {}),
        },
      },
    }));

    // Record the order as pending first, so a payment can always be traced
    // back to an order even if the browser dies mid-flow.
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        items: priced.lines.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id,
          title: l.title,
          variantTitle: l.variantTitle,
          selectedOptions: l.selectedOptions,
          price: String(l.unitPrice),
          quantity: l.quantity,
          image: l.image,
        })),
        subtotal: priced.subtotal,
        shipping_cost: quote.cost,
        shipping_country: destination,
        total,
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
      ui_mode: "embedded",
      line_items: lineItems,
      return_url: `${return_url}?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { order_id: order.id, shipping_zone: quote.zone },
      // Locked to the country the shopper already picked, so the shipping we
      // quoted can't be invalidated by changing the address inside Stripe.
      shipping_address_collection: { allowed_countries: [destination as never] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: Math.round(quote.cost * 100), currency },
            display_name: quote.free ? "Free shipping" : quote.label,
          },
        },
      ],
      phone_number_collection: { enabled: true },
    });

    await supabase.from("orders").update({ payment_id: session.id }).eq("id", order.id);

    return json(
      {
        client_secret: session.client_secret,
        publishable_key: publishableKey,
        order_id: order.id,
        subtotal: priced.subtotal,
        shipping: quote.cost,
        total,
        currency: currency.toUpperCase(),
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: "Could not start checkout." }, 500);
  }
});
