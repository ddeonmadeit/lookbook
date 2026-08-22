// Confirms the outcome of an embedded Checkout session.
//
// The shopper lands back on /checkout/success with a session id. Never trust
// that as proof of payment — ask Stripe what actually happened before telling
// someone their order went through.

import Stripe from "npm:stripe@17";
import { corsHeaders, json } from "../_shared/cart.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Payments are not configured." }, 503);

    const { session_id } = (await req.json()) as { session_id: string };
    if (!session_id) return json({ error: "Missing session id." }, 400);

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    return json(
      {
        status: session.status, // 'complete' | 'open' | 'expired'
        payment_status: session.payment_status,
        email: session.customer_details?.email ?? null,
        total: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? "aud").toUpperCase(),
      },
      200,
    );
  } catch (err) {
    console.error(err);
    return json({ error: "Could not confirm the payment." }, 500);
  }
});
