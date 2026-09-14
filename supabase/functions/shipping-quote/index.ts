// Live shipping quote for the checkout page.
//
// Given a cart and a destination (country + postcode), returns what each
// service level costs so the shopper sees real totals before they pay. Prices
// and weights are read server-side; the browser only sends ids, quantities and
// a destination.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, loadShippingConfig, priceCart, type CartLine } from "../_shared/cart.ts";
import { quoteAllServices, totalWeightGrams, ZONE_LABELS } from "../_shared/shipping.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { items, country, postcode } = (await req.json()) as {
      items: CartLine[];
      country: string;
      postcode?: string;
    };

    const priced = await priceCart(supabase, items);
    if (!priced.ok) return json({ error: priced.error }, priced.status);

    const config = await loadShippingConfig(supabase);
    const weightGrams = totalWeightGrams(priced.lines, config.defaultItemWeight);

    const options = quoteAllServices({
      country,
      postcode,
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
        weight_grams: weightGrams,
        zone: options[0].zone,
        zone_label: ZONE_LABELS[options[0].zone],
        options: options.map((o) => ({
          service: o.service,
          cost: o.cost,
          total: Math.round((priced.subtotal + o.cost) * 100) / 100,
          label: o.label,
          eta: o.eta,
          free: o.free,
          parcels: o.parcels,
        })),
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: "Could not calculate shipping." }, 500);
  }
});
