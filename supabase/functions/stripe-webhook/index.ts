// Stripe webhook: the only place an order becomes "paid" and stock is
// decremented — after Stripe has actually collected the money. Deployed with
// verify_jwt=false (Stripe authenticates via its signature header instead).

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendOrderNotification, type OrderForNotify } from "../_shared/notify.ts";

/**
 * Which service the customer actually picked inside Stripe. The rate objects
 * are created inline by create-checkout with `metadata.service`, so read that
 * back; if the lookup fails, infer from the display name rather than losing it.
 */
async function chosenService(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const rate = session.shipping_cost?.shipping_rate;
  if (!rate) return null;
  try {
    const full = typeof rate === "string" ? await stripe.shippingRates.retrieve(rate) : rate;
    const fromMeta = full.metadata?.service;
    if (fromMeta) return fromMeta;
    return /express/i.test(full.display_name ?? "") ? "express" : "standard";
  } catch (err) {
    console.error("could not read shipping rate:", err);
    return null;
  }
}

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
      .select("id,items,status,currency")
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
    const service = await chosenService(stripe, session);

    // Everything needed to pick, pack and post the order, kept in its own
    // columns as well as the printable address block.
    const details = {
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_id: String(session.payment_intent ?? session.id),
      customer_name: session.customer_details?.name ?? shipping?.name ?? "Stripe customer",
      customer_email: session.customer_details?.email ?? "(not provided)",
      customer_phone: session.customer_details?.phone ?? null,
      shipping_address: addressText,
      shipping_line1: addr?.line1 ?? null,
      shipping_line2: addr?.line2 ?? null,
      shipping_city: addr?.city ?? null,
      shipping_state: addr?.state ?? null,
      shipping_postcode: addr?.postal_code ?? null,
      shipping_country: addr?.country ?? null,
      shipping_service: service,
      shipping_cost: shippingCharged,
      subtotal: (session.amount_subtotal ?? 0) / 100,
      total: totalCharged,
    };

    await supabase.from("orders").update(details).eq("id", orderId);

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

    // Confirmation to the customer. Never allowed to fail the webhook: Stripe
    // would retry and we'd decrement stock twice for a mail server hiccup.
    try {
      const notify: OrderForNotify = {
        id: orderId,
        currency: (order.currency as string) ?? "AUD",
        customer_name: details.customer_name,
        customer_email: details.customer_email,
        customer_phone: details.customer_phone,
        items: order.items as Array<Record<string, unknown>>,
        subtotal: details.subtotal,
        shipping_cost: details.shipping_cost,
        total: details.total,
        shipping_service: details.shipping_service,
        shipping_address: details.shipping_address,
      };
      const sent = await sendOrderNotification(supabase, "order_confirmation", notify, {
        email: true,
        sms: true,
      });
      await supabase
        .from("orders")
        .update({
          confirmation_sent_at:
            sent.email === "sent" || sent.sms === "sent" ? new Date().toISOString() : null,
        })
        .eq("id", orderId);
      if (sent.reason) console.log("confirmation:", JSON.stringify(sent));
    } catch (err) {
      console.error("confirmation send failed:", err);
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
