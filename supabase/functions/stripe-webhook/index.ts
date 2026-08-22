// Stripe webhook: the only place an order becomes "paid" and stock is
// decremented — after Stripe has actually collected the money. Deployed with
// verify_jwt=false (Stripe authenticates via its signature header instead).

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response("not configured", { status: 503 });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-02-24.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    console.error("signature verification failed:", err);
    return new Response("bad signature", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (!orderId) return new Response("no order id", { status: 200 });

    const { data: order } = await supabase
      .from("orders")
      .select("id,items,status")
      .eq("id", orderId)
      .single();
    if (!order) return new Response("order not found", { status: 200 });

    // Idempotency: Stripe retries webhooks; only process the first delivery.
    if (order.status === "paid" || order.status === "fulfilled") {
      return new Response("already processed", { status: 200 });
    }

    const shipping =
      session.collected_information?.shipping_details ??
      // deno-lint-ignore no-explicit-any
      (session as any).shipping_details ??
      null;
    const addr = shipping?.address;
    const addressText = addr
      ? [shipping?.name, addr.line1, addr.line2, `${addr.city ?? ""} ${addr.postal_code ?? ""}`.trim(), addr.state, addr.country]
          .filter(Boolean)
          .join("\n")
      : null;

    // Trust Stripe's figures for what was actually collected, rather than the
    // amounts we quoted when the session was created.
    const shippingCharged = (session.total_details?.amount_shipping ?? 0) / 100;
    const totalCharged = (session.amount_total ?? 0) / 100;

    await supabase
      .from("orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_id: String(session.payment_intent ?? session.id),
        customer_name: session.customer_details?.name ?? shipping?.name ?? "Stripe customer",
        customer_email: session.customer_details?.email ?? "(not provided)",
        customer_phone: session.customer_details?.phone ?? null,
        shipping_address: addressText,
        shipping_cost: shippingCharged,
        shipping_country: addr?.country ?? null,
        total: totalCharged,
      })
      .eq("id", orderId);

    // Decrement stock now that payment is confirmed.
    for (const it of (order.items as Array<Record<string, unknown>>) || []) {
      if (it.product_id && it.variant_id) {
        const { error } = await supabase.rpc("decrement_stock", {
          p_product_id: it.product_id,
          p_variant_id: it.variant_id,
          p_qty: Number(it.quantity) || 1,
        });
        if (error) console.error("stock decrement failed:", error.message);
      }
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      await supabase
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", orderId)
        .eq("status", "pending");
    }
  }

  // Refunds can also be issued from the Stripe dashboard, so mirror them back
  // here rather than only tracking the ones started from our own dashboard.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = String(charge.payment_intent ?? "");
    if (paymentIntentId) {
      const refunded = (charge.amount_refunded ?? 0) / 100;
      const fully = charge.amount_refunded >= charge.amount;
      await supabase
        .from("orders")
        .update({
          refunded_amount: refunded,
          refunded_at: new Date().toISOString(),
          ...(fully ? { status: "refunded" } : {}),
        })
        .eq("payment_id", paymentIntentId);
    }
  }

  return new Response("ok", { status: 200 });
});
