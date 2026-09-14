// Confirms the outcome of an embedded Checkout session, and returns everything
// the confirmation page shows.
//
// The shopper lands back on /checkout/success with a session id. Never trust
// that as proof of payment — ask Stripe what actually happened before telling
// someone their order went through. The reply is built from Stripe's own record
// of the session rather than our database, so it's correct even in the seconds
// before the webhook lands.

import Stripe from "npm:stripe@17";
import { corsHeaders, json } from "../_shared/cart.ts";
import { orderNumber } from "../_shared/notify.ts";

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

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["line_items", "shipping_cost.shipping_rate"],
    });

    const shipping =
      session.collected_information?.shipping_details ??
      // deno-lint-ignore no-explicit-any
      (session as any).shipping_details ??
      null;
    const addr = shipping?.address;

    const rate = session.shipping_cost?.shipping_rate;
    const rateObject = rate && typeof rate !== "string" ? rate : null;
    const service = rateObject?.metadata?.service
      ?? (/express/i.test(rateObject?.display_name ?? "") ? "express" : "standard");

    const orderId = session.metadata?.order_id ?? null;

    return json(
      {
        status: session.status, // 'complete' | 'open' | 'expired'
        payment_status: session.payment_status,
        order_number: orderId ? orderNumber(orderId) : null,
        name: session.customer_details?.name ?? shipping?.name ?? null,
        email: session.customer_details?.email ?? null,
        phone: session.customer_details?.phone ?? null,
        items: (session.line_items?.data ?? []).map((li) => ({
          title: li.description,
          quantity: li.quantity ?? 1,
          amount: (li.amount_total ?? 0) / 100,
        })),
        shipping_service: service,
        shipping_label: rateObject?.display_name ?? null,
        address: addr
          ? {
              line1: addr.line1 ?? null,
              line2: addr.line2 ?? null,
              city: addr.city ?? null,
              state: addr.state ?? null,
              postcode: addr.postal_code ?? null,
              country: addr.country ?? null,
            }
          : null,
        subtotal: (session.amount_subtotal ?? 0) / 100,
        shipping: (session.total_details?.amount_shipping ?? 0) / 100,
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
