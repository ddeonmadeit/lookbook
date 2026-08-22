// Refunds a Stripe-paid order from the admin dashboard.
//
// Admin-only: the caller must present a logged-in user's access token. The
// anon key alone is a valid project JWT, so we explicitly resolve the user
// rather than relying on Supabase's JWT verification by itself.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cart.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user) return json({ error: "Not authorised." }, 401);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Payments are not configured." }, 503);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { order_id, amount } = (await req.json()) as {
      order_id: string;
      amount?: number; // omit for a full refund
    };
    if (!order_id) return json({ error: "Missing order id." }, 400);

    const { data: order } = await admin
      .from("orders")
      .select("id,payment_id,payment_provider,total,subtotal,refunded_amount,currency")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return json({ error: "Order not found." }, 404);
    if (order.payment_provider !== "stripe" || !order.payment_id) {
      return json({ error: "This order wasn't paid through Stripe." }, 409);
    }
    if (!String(order.payment_id).startsWith("pi_")) {
      return json({ error: "This order has no completed payment to refund." }, 409);
    }

    const paid = Number(order.total) || Number(order.subtotal) || 0;
    const alreadyRefunded = Number(order.refunded_amount) || 0;
    const remaining = Math.round((paid - alreadyRefunded) * 100) / 100;
    if (remaining <= 0) return json({ error: "This order is already fully refunded." }, 409);

    const requested = amount === undefined || amount === null ? remaining : Number(amount);
    if (!Number.isFinite(requested) || requested <= 0) {
      return json({ error: "Enter a valid refund amount." }, 400);
    }
    if (requested > remaining) {
      return json({ error: `Only ${remaining.toFixed(2)} is left to refund.` }, 400);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const refund = await stripe.refunds.create({
      payment_intent: String(order.payment_id),
      amount: Math.round(requested * 100),
    });

    // The charge.refunded webhook also writes these, but update now so the
    // dashboard reflects the refund immediately.
    const totalRefunded = Math.round((alreadyRefunded + requested) * 100) / 100;
    await admin
      .from("orders")
      .update({
        refunded_amount: totalRefunded,
        refunded_at: new Date().toISOString(),
        ...(totalRefunded >= paid ? { status: "refunded" } : {}),
      })
      .eq("id", order_id);

    return json({ ok: true, refunded: totalRefunded, refund_id: refund.id }, 200);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Refund failed.";
    return json({ error: message }, 500);
  }
});
