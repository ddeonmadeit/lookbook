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
import { quoteAllServices, totalWeightGrams } from "../_shared/shipping.ts";

interface ShippingIn {
  name?: unknown;
  address?: { line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; postal_code?: unknown; country?: unknown };
}

/**
 * The delivery address the shopper picked on our checkout page, tidied, or null if it's not a
 * complete address in the country we're quoting for. It's only ever used to fill in Stripe's form
 * ahead of time; the shopper can still change it there.
 */
function cleanShipping(input: ShippingIn | undefined, country: string) {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (!input || typeof input !== "object") return null;
  const a = input.address ?? {};
  const name = text(input.name, 120);
  const line1 = text(a.line1, 200);
  const city = text(a.city, 100);
  if (!name || !line1 || !city || text(a.country, 2).toUpperCase() !== country) return null;
  const line2 = text(a.line2, 200);
  const state = text(a.state, 100);
  const postal_code = text(a.postal_code, 20);
  return {
    name,
    address: {
      line1,
      city,
      country,
      ...(line2 ? { line2 } : {}),
      ...(state ? { state } : {}),
      ...(postal_code ? { postal_code } : {}),
    },
  };
}

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

    const { items, country, postcode, return_url, shipping } = (await req.json()) as {
      items: CartLine[];
      country: string;
      postcode?: string;
      return_url: string;
      shipping?: ShippingIn;
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
    // Both service levels are offered inside Stripe so the customer picks the
    // one they want at the moment they pay; the webhook records which.
    const options = quoteAllServices({
      country: destination,
      postcode,
      weightGrams,
      subtotal: priced.subtotal,
      rates: config.rates,
      handlingFee: config.handlingFee,
      freeThreshold: config.freeThreshold,
      flatRateFallback: config.flatRateFallback,
    });
    const cheapest = options[0];

    const currency = priced.currency;
    const total = Math.round((priced.subtotal + cheapest.cost) * 100) / 100;

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
        shipping_cost: cheapest.cost,
        shipping_country: destination,
        shipping_postcode: postcode ?? null,
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

    // The address picked on our page goes on a Stripe customer, which is how Checkout knows to
    // open with the shipping address already filled in: the shopper doesn't type it twice.
    const prefill = cleanShipping(shipping, destination);
    let customer: string | undefined;
    if (prefill) {
      try {
        const created = await stripe.customers.create({
          name: prefill.name,
          shipping: prefill,
          metadata: { order_id: order.id, source: "store-checkout" },
        });
        customer = created.id;
      } catch (err) {
        // Not worth failing checkout over: they'd just type the address in Stripe instead.
        console.error("Couldn't prefill the address:", err);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      line_items: lineItems,
      return_url: `${return_url}?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { order_id: order.id, shipping_zone: cheapest.zone },
      ...(customer ? { customer } : {}),
      // Locked to the country the shopper already picked, so the shipping we
      // quoted can't be invalidated by changing the address inside Stripe.
      // (Stripe types this as a union of literal country codes; ours is only
      // known at runtime, hence the cast.)
      shipping_address_collection: {
        allowed_countries: [
          destination as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
        ],
      },
      shipping_options: options.map((o) => ({
        shipping_rate_data: {
          type: "fixed_amount" as const,
          fixed_amount: { amount: Math.round(o.cost * 100), currency },
          display_name: o.free ? "Free standard shipping" : `${o.label} (${o.eta})`,
          metadata: { service: o.service },
        },
      })),
      phone_number_collection: { enabled: true },
    });

    await supabase.from("orders").update({ payment_id: session.id }).eq("id", order.id);

    return json(
      {
        client_secret: session.client_secret,
        publishable_key: publishableKey,
        order_id: order.id,
        subtotal: priced.subtotal,
        shipping: cheapest.cost,
        total,
        currency: currency.toUpperCase(),
        options: options.map((o) => ({ service: o.service, cost: o.cost, label: o.label, eta: o.eta })),
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: "Could not start checkout." }, 500);
  }
});
