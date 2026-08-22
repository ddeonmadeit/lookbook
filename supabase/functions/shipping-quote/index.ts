// Live shipping quote for the checkout page.
//
// Given a cart and a destination country, returns what shipping will cost so
// the shopper sees the real total before they pay. Prices and weights are read
// server-side; the browser only sends ids, quantities and a country code.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, loadShippingConfig, priceCart, type CartLine } from "../_shared/cart.ts";
import { quoteShipping, totalWeightGrams } from "../_shared/shipping.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { items, country } = (await req.json()) as {
      items: CartLine[];
      country: string;
    };

    const priced = await priceCart(supabase, items);
    if (!priced.ok) return json({ error: priced.error }, priced.status);

    const config = await loadShippingConfig(supabase);
    const weightGrams = totalWeightGrams(priced.lines, config.defaultItemWeight);

    const quote = quoteShipping({
      country,
      weightGrams,
      subtotal: priced.subtotal,
      rates: config.rates,
      handlingFee: config.handlingFee,
      freeThreshold: config.freeThreshold,
      flatRateFallback: config.flatRateFallback,
    });

    return json(
      {
        currency: priced.currency.toUpperCase(),
        subtotal: priced.subtotal,
        shipping: quote.cost,
        total: Math.round((priced.subtotal + quote.cost) * 100) / 100,
        zone: quote.zone,
        label: quote.label,
        free: quote.free,
        weight_grams: quote.weightGrams,
        parcels: quote.parcels,
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: "Could not calculate shipping." }, 500);
  }
});
