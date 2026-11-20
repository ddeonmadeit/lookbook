// NYE tickets: what's left, starting a payment, and confirming it, for the
// unlisted /nye page.
//
// Self-contained (no ../_shared imports) so it can be pasted straight into the
// Supabase dashboard's function editor as well as deployed with the CLI.
//
// Tickets are stored as orders (items[0].kind = "ticket"), so buyers land in
// Contacts and refunds work like any order — but they never touch stock or
// shipping. The store's stripe-webhook ignores them: their Checkout sessions
// carry `ticket_order_id` rather than `order_id`. A ticket is marked paid here
// instead, after asking Stripe, either when the buyer's page confirms it or —
// for someone who paid and closed the tab straight away — the next time
// anyone loads the page after their hold runs out.
//
// The browser only ever sends a quantity. The price, the cap and every count
// are decided here.

import Stripe from "npm:stripe@17";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const EVENT = {
  id: "nye-2026",
  name: "KNOTS New Year's Eve",
  ticket: "KNOTS NYE — Entry",
  /** AUD per ticket. */
  price: 30,
  currency: "aud",
  /** Total tickets, ever. */
  capacity: 100,
  maxPerOrder: 10,
  /** Sales close at midnight on New Year's Eve, Sydney time. */
  salesEnd: "2027-01-01T00:00:00+11:00",
};

// A ticket is held for whoever is paying for it until their Checkout session
// expires. 31 minutes is the shortest Stripe allows (30), plus slack for clocks.
const SESSION_MINUTES = 31;
const HOLD_MS = (SESSION_MINUTES + 2) * 60_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** First 8 characters of the uuid, e.g. "KN-3F9A12C4" — the same as store orders. */
function ticketRef(id: string) {
  return `KN-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

interface TicketOrder {
  id: string;
  items: Array<{ quantity?: number }>;
  status: string;
  created_at: string;
  payment_id: string | null;
}

const qtyOf = (o: TicketOrder) => o.items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
const isSold = (o: TicketOrder) => o.status === "paid" || o.status === "fulfilled";
const isFreshHold = (o: TicketOrder, now: number) =>
  o.status === "pending" && now - Date.parse(o.created_at) < HOLD_MS;

async function ticketOrders(db: SupabaseClient): Promise<TicketOrder[]> {
  const { data, error } = await db
    .from("orders")
    .select("id,items,status,created_at,payment_id")
    // As a JSON string: supabase-js would turn an array into a Postgres array literal.
    .contains("items", JSON.stringify([{ event: EVENT.id }]))
    .in("status", ["pending", "paid", "fulfilled"]);
  if (error) throw error;
  return (data ?? []) as TicketOrder[];
}

/** Records a completed payment against its order. True only for the call that did it. */
async function markPaid(db: SupabaseClient, orderId: string, session: Stripe.Checkout.Session) {
  const { data } = await db
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_id: String(session.payment_intent ?? session.id),
      customer_name: session.customer_details?.name || "Ticket holder",
      customer_email: session.customer_details?.email || "(not provided)",
      customer_phone: session.customer_details?.phone ?? null,
      subtotal: (session.amount_subtotal ?? 0) / 100,
      total: (session.amount_total ?? 0) / 100,
    })
    .eq("id", orderId)
    .in("status", ["pending", "cancelled"])
    .select("id,items,customer_name,customer_email,total")
    .maybeSingle();
  return data as { id: string; items: TicketOrder["items"]; customer_name: string; customer_email: string; total: number } | null;
}

/**
 * Holds past their Checkout session: ask Stripe how each ended. A paid one
 * becomes a ticket (and gets its email); anything else frees its places.
 */
async function settleStaleHolds(db: SupabaseClient, stripe: Stripe, orders: TicketOrder[], now: number) {
  const stale = orders.filter((o) => o.status === "pending" && !isFreshHold(o, now)).slice(0, 5);
  for (const o of stale) {
    try {
      if (!o.payment_id?.startsWith("cs_")) {
        // The payment never got as far as Stripe.
        await db.from("orders").update({ status: "cancelled" }).eq("id", o.id).eq("status", "pending");
        o.status = "cancelled";
        continue;
      }
      const session = await stripe.checkout.sessions.retrieve(o.payment_id);
      if (session.status === "complete" && session.payment_status !== "unpaid") {
        const paid = await markPaid(db, o.id, session);
        if (paid) await sendTicketEmail(db, paid);
        o.status = "paid";
      } else if (session.status === "expired") {
        await db.from("orders").update({ status: "cancelled" }).eq("id", o.id).eq("status", "pending");
        o.status = "cancelled";
      }
    } catch (err) {
      console.error("could not settle hold", o.id, err);
    }
  }
}

function availability(orders: TicketOrder[], now: number) {
  const sold = orders.filter(isSold).reduce((n, o) => n + qtyOf(o), 0);
  // An unsettled hold still counts: better a place waits than gets sold twice.
  const held = orders.filter((o) => o.status === "pending").reduce((n, o) => n + qtyOf(o), 0);
  const remaining = Math.max(0, EVENT.capacity - sold - held);
  return {
    name: EVENT.name,
    price: EVENT.price,
    currency: EVENT.currency.toUpperCase(),
    capacity: EVENT.capacity,
    max_per_order: EVENT.maxPerOrder,
    sold,
    held,
    remaining,
    on_sale: now < Date.parse(EVENT.salesEnd),
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The ticket, by email. Optional: without Resend set up, the page is the ticket. */
async function sendTicketEmail(
  db: SupabaseClient,
  order: { id: string; items: TicketOrder["items"]; customer_name: string; customer_email: string; total: number },
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = (order.customer_email ?? "").trim();
  if (!apiKey || !to.includes("@")) return;
  const from = Deno.env.get("ORDER_FROM_EMAIL") || "Knots <onboarding@resend.dev>";
  const replyTo = Deno.env.get("ORDER_REPLY_TO") || from;
  const qty = order.items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
  const ref = ticketRef(order.id);
  const first = (order.customer_name ?? "").trim().split(/\s+/)[0] || "there";
  const plural = qty === 1 ? "ticket" : "tickets";
  const cell = "font-family:Helvetica,Arial,sans-serif;";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Your NYE ${plural}</title></head>
<body style="margin:0;padding:0;background:#000;">
<div style="display:none;max-height:0;overflow:hidden;">You're in. ${qty} ${plural} for KNOTS NYE, ref ${ref}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;border:1px solid #2a2a2a;">
<tr><td style="${cell}padding:28px 28px 8px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#8a8a8a;">KNOTS presents</td></tr>
<tr><td style="${cell}padding:0 28px 22px;font-size:34px;line-height:1.05;font-weight:bold;letter-spacing:0.02em;text-transform:uppercase;color:#fff;">New Year's Eve</td></tr>
<tr><td style="${cell}padding:0 28px 26px;font-size:14px;line-height:1.7;color:#cfcfcf;">You're in, ${escapeHtml(first)}. Show this email or give your name at the door.</td></tr>
<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #444;border-bottom:1px dashed #444;">
<tr><td style="${cell}padding:16px 0 4px;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#8a8a8a;">Name</td><td align="right" style="${cell}padding:16px 0 4px;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#8a8a8a;">Admits</td></tr>
<tr><td style="${cell}padding:0 0 14px;font-size:16px;color:#fff;">${escapeHtml(order.customer_name || "Ticket holder")}</td><td align="right" style="${cell}padding:0 0 14px;font-size:16px;color:#fff;">${qty}</td></tr>
<tr><td style="${cell}padding:0 0 4px;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#8a8a8a;">Date</td><td align="right" style="${cell}padding:0 0 4px;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#8a8a8a;">Ref</td></tr>
<tr><td style="${cell}padding:0 0 16px;font-size:16px;color:#fff;">31.12.2026</td><td align="right" style="${cell}padding:0 0 16px;font-size:16px;color:#fff;font-family:Menlo,Consolas,monospace;">${ref}</td></tr>
</table></td></tr>
<tr><td style="${cell}padding:18px 28px 28px;font-size:12px;line-height:1.7;color:#8a8a8a;">Paid AUD ${(Number(order.total) || 0).toFixed(2)}. Your ticket is also at <a href="https://knotsss.com/nye" style="color:#fff;">knotsss.com/nye</a> on the device you bought it on.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `You're in, ${first}.\n\nKNOTS New Year's Eve, 31.12.2026\nName: ${order.customer_name}\nAdmits: ${qty}\nRef: ${ref}\nPaid: AUD ${(Number(order.total) || 0).toFixed(2)}\n\nShow this email or give your name at the door.`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject: `Your NYE ${plural} — ${ref}`,
        html,
        text,
        headers: { "X-Entity-Ref-ID": `nye-ticket-${order.id}` },
        tags: [{ name: "type", value: "nye-ticket" }],
      }),
    });
    if (res.ok) {
      await db.from("orders").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", order.id);
    } else {
      console.error("ticket email failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("ticket email failed:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY");
    if (!stripeKey || !publishableKey) return json({ error: "Payments are not configured yet." }, 503);
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      quantity?: number;
      return_url?: string;
      session_id?: string;
    };
    const now = Date.now();

    if (!body.action || body.action === "availability") {
      const orders = await ticketOrders(db);
      await settleStaleHolds(db, stripe, orders, now);
      return json(availability(orders.filter((o) => o.status !== "cancelled"), now));
    }

    if (body.action === "checkout") {
      if (now >= Date.parse(EVENT.salesEnd)) return json({ error: "Ticket sales have closed." }, 410);
      const quantity = Math.floor(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > EVENT.maxPerOrder) {
        return json({ error: `Choose between 1 and ${EVENT.maxPerOrder} tickets.` }, 400);
      }
      // Only ever send the buyer back to our own site.
      const origin = req.headers.get("origin");
      if (!body.return_url || !origin || new URL(body.return_url).origin !== origin) {
        return json({ error: "Invalid return URL." }, 400);
      }

      // Hold the places first, then check the hold fits. Every request sees
      // every hold made before it, so two people can't both take the last one.
      const total = EVENT.price * quantity;
      const { data: order, error: insertErr } = await db
        .from("orders")
        .insert({
          items: [
            {
              kind: "ticket",
              event: EVENT.id,
              title: EVENT.ticket,
              variantTitle: "",
              price: String(EVENT.price),
              quantity,
            },
          ],
          subtotal: total,
          shipping_cost: 0,
          total,
          currency: EVENT.currency.toUpperCase(),
          customer_name: "(pending payment)",
          customer_email: "(pending payment)",
          notes: "NYE ticket",
          status: "pending",
          payment_provider: "stripe",
        })
        .select("id,created_at")
        .single();
      if (insertErr) throw insertErr;

      const orders = await ticketOrders(db);
      await settleStaleHolds(db, stripe, orders, now);
      const mine = { at: Date.parse(order.created_at), id: order.id as string };
      const ahead = orders
        .filter((o) => o.id !== mine.id && o.status !== "cancelled")
        .filter((o) => {
          if (isSold(o)) return true;
          const at = Date.parse(o.created_at);
          return o.status === "pending" && (at < mine.at || (at === mine.at && o.id < mine.id));
        })
        .reduce((n, o) => n + qtyOf(o), 0);
      if (ahead + quantity > EVENT.capacity) {
        await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
        const left = Math.max(0, EVENT.capacity - ahead);
        return json(
          {
            error: left === 0 ? "Sold out." : `Only ${left} ticket${left === 1 ? "" : "s"} left.`,
            remaining: left,
          },
          409,
        );
      }

      const metadata = { ticket_order_id: order.id, event: EVENT.id, kind: "ticket" };
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          ui_mode: "embedded",
          redirect_on_completion: "if_required",
          return_url: `${body.return_url}?session_id={CHECKOUT_SESSION_ID}`,
          line_items: [
            {
              quantity,
              price_data: {
                currency: EVENT.currency,
                unit_amount: Math.round(EVENT.price * 100),
                product_data: { name: EVENT.ticket, description: "31 December 2026 · Sydney" },
              },
            },
          ],
          submit_type: "pay",
          expires_at: Math.floor(now / 1000) + SESSION_MINUTES * 60,
          metadata,
          payment_intent_data: { metadata, description: `${EVENT.ticket} × ${quantity}` },
        });
      } catch (err) {
        await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
        throw err;
      }
      await db.from("orders").update({ payment_id: session.id }).eq("id", order.id);

      return json({
        client_secret: session.client_secret,
        publishable_key: publishableKey,
        session_id: session.id,
      });
    }

    if (body.action === "confirm") {
      const sessionId = String(body.session_id ?? "");
      if (!sessionId.startsWith("cs_")) return json({ error: "Missing session id." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata?.ticket_order_id;
      if (!orderId || session.metadata?.event !== EVENT.id) return json({ error: "Not a ticket." }, 404);

      const paid = session.status === "complete" && session.payment_status !== "unpaid";
      if (paid) {
        const flipped = await markPaid(db, orderId, session);
        if (flipped) await sendTicketEmail(db, flipped);
      }
      const quantity = (session.amount_subtotal ?? 0) / 100 / EVENT.price;
      return json({
        status: paid ? "paid" : session.status,
        ticket: paid
          ? {
              ref: ticketRef(orderId),
              name: session.customer_details?.name ?? null,
              email: session.customer_details?.email ?? null,
              quantity: Math.round(quantity),
              total: (session.amount_total ?? 0) / 100,
              currency: (session.currency ?? EVENT.currency).toUpperCase(),
            }
          : null,
      });
    }

    // The buyer closed the payment form: give their places back straight away
    // rather than holding them for the rest of the session.
    if (body.action === "release") {
      const sessionId = String(body.session_id ?? "");
      if (!sessionId.startsWith("cs_")) return json({ error: "Missing session id." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata?.ticket_order_id;
      if (!orderId || session.metadata?.event !== EVENT.id) return json({ error: "Not a ticket." }, 404);
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(sessionId);
        await db.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("status", "pending");
        return json({ released: true });
      }
      return json({ released: false, status: session.status });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong — please try again." }, 500);
  }
});
