// NYE tickets: what's left, starting a payment, and confirming it, for the
// unlisted /nye page.
//
// Self-contained (no ../_shared imports) so it can be pasted straight into the
// Supabase dashboard's function editor as well as deployed with the CLI.
//
// Tickets are stored as orders (each item has kind "ticket" and its release),
// so buyers land in Contacts and refunds work like any order — but they never
// touch stock or shipping. The store's stripe-webhook ignores them: their
// Checkout sessions carry `ticket_order_id` rather than `order_id`. A ticket is
// marked paid here instead, after asking Stripe, either when the buyer's page
// confirms it or — for someone who paid and closed the tab straight away — the
// next time anyone loads the page after their hold runs out.
//
// Releases sell in order: each opens once the one before is gone. An order
// that crosses over is split between them, so every release sells exactly its
// own number. The browser only ever sends a quantity; prices, caps and every
// count are decided here — and stay here: the page is only ever told what's
// on sale, at what price, and what's sold out, never how many.
//
// The owner can also mark any release sold out by hand, whatever's left:
// https://knotsss.com/nye/controls.json (in the repo at public/nye/controls.json)
// lists the releases to switch off. Those switches can only stop sales —
// prices and sizes stay here — so the file can never make a ticket cheaper.

import Stripe from "npm:stripe@17";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const EVENT = {
  id: "nye-2026",
  name: "KNOTS NYE Rooftop Party",
  currency: "aud",
  maxPerOrder: 10,
  /** Shown on Stripe's form and in the email. */
  details: "175 Cathedral St, Woolloomooloo · 31 Dec 2026, 6pm–1am",
  /** Sales close at midnight on New Year's Eve, Sydney time. */
  salesEnd: "2027-01-01T00:00:00+11:00",
};

/** In the order they sell. Prices in AUD. */
const TIERS = [
  { id: "first", name: "First release", price: 15, capacity: 34 },
  { id: "second", name: "Second release", price: 20, capacity: 33 },
  { id: "final", name: "Final release", price: 30, capacity: 33 },
] as const;
/** Lets the dashboard tell this version from older ones. */
const VERSION = 5;

/** The owner's sold-out switches, published with the site. */
const CONTROLS_URL = "https://knotsss.com/nye/controls.json";
const CONTROLS_TTL = 15_000;

/**
 * The site's own domains. Apple Pay (and Google Pay) only show in an embedded
 * Checkout on a domain registered with Stripe — Stripe then handles Apple's
 * merchant validation itself.
 */
const WALLET_DOMAINS = ["knotsss.com", "www.knotsss.com"];
type TierId = (typeof TIERS)[number]["id"];

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

interface TicketItem {
  tier?: string;
  quantity?: number;
}

interface TicketOrder {
  id: string;
  items: TicketItem[];
  status: string;
  created_at: string;
  payment_id: string | null;
}

type Usage = Record<TierId, number>;
const emptyUsage = (): Usage => Object.fromEntries(TIERS.map((t) => [t.id, 0])) as Usage;
const tierOf = (it: TicketItem): TierId =>
  (TIERS.find((t) => t.id === it.tier)?.id ?? TIERS[TIERS.length - 1].id) as TierId;

/** Tickets per release across some orders. */
function usage(orders: TicketOrder[]): Usage {
  const used = emptyUsage();
  for (const o of orders) for (const it of o.items) used[tierOf(it)] += Number(it.quantity) || 0;
  return used;
}

const isSold = (o: TicketOrder) => o.status === "paid" || o.status === "fulfilled";
const isFreshHold = (o: TicketOrder, now: number) =>
  o.status === "pending" && now - Date.parse(o.created_at) < HOLD_MS;

/** Places a release has left for sale: none if it's full or switched off. */
const openPlaces = (tier: (typeof TIERS)[number], used: Usage, off: Set<string>) =>
  off.has(tier.id) ? 0 : Math.max(0, tier.capacity - used[tier.id]);

/** Fills an order from the earliest release with places left. Null if it doesn't fit. */
function allocate(quantity: number, used: Usage, off: Set<string>) {
  const lines: Array<{ tier: (typeof TIERS)[number]; quantity: number }> = [];
  let left = quantity;
  for (const tier of TIERS) {
    const take = Math.min(left, openPlaces(tier, used, off));
    if (take > 0) lines.push({ tier, quantity: take });
    left -= take;
  }
  return left > 0 ? null : lines;
}

let controls: { at: number; off: Set<string> } | null = null;

/**
 * The releases the owner has switched off. Read from the site at most every
 * 15 seconds; if it can't be reached, the last switches seen still apply.
 */
async function switchedOff(now = Date.now()): Promise<Set<string>> {
  if (controls && now - controls.at < CONTROLS_TTL) return controls.off;
  try {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 3000);
    const res = await fetch(`${CONTROLS_URL}?t=${Math.floor(now / CONTROLS_TTL)}`, {
      signal: timeout.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    clearTimeout(timer);
    let off = new Set<string>();
    if (res.ok) {
      const raw = (await res.json()) as { sold_out?: unknown; all_sold_out?: unknown };
      const ids = TIERS.map((t) => t.id as string);
      if (raw?.all_sold_out === true) off = new Set(ids);
      else if (Array.isArray(raw?.sold_out)) off = new Set(raw.sold_out.filter((x): x is string => ids.includes(x as string)));
    } else if (res.status !== 404) {
      throw new Error(`controls: HTTP ${res.status}`);
    }
    controls = { at: now, off };
    return off;
  } catch (err) {
    console.error("could not read the sold-out switches:", err);
    return controls?.off ?? new Set();
  }
}

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

interface PaidOrder {
  id: string;
  items: Array<TicketItem & { title?: string }>;
  customer_name: string;
  customer_email: string;
  total: number;
}

/** Records a completed payment against its order. Returns the order only for the call that did it. */
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
  return data as PaidOrder | null;
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

/**
 * What the page may know: each release's price and whether it's on sale,
 * still to come, or sold out. No counts — not even in the response.
 */
function availability(orders: TicketOrder[], now: number, off: Set<string>) {
  // An unsettled hold still counts: better a place waits than gets sold twice.
  const taken = usage(orders);
  const current = TIERS.find((t) => openPlaces(t, taken, off) > 0) ?? null;
  const at = current ? TIERS.indexOf(current) : TIERS.length;
  return {
    version: VERSION,
    name: EVENT.name,
    currency: EVENT.currency.toUpperCase(),
    /** The price of the next ticket. */
    price: (current ?? TIERS[TIERS.length - 1]).price,
    current: current?.id ?? null,
    sold_out: current === null,
    max_per_order: EVENT.maxPerOrder,
    tiers: TIERS.map((t, i) => ({
      id: t.id,
      name: t.name,
      price: t.price,
      status: i < at || off.has(t.id) ? "sold-out" : i === at ? "on-sale" : "next",
    })),
    on_sale: now < Date.parse(EVENT.salesEnd),
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "2 × First release, 1 × Second release" */
function tierSummary(items: TicketItem[]) {
  return TIERS.map((t) => {
    const n = items.filter((it) => tierOf(it) === t.id).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    return n ? `${n} × ${t.name}` : "";
  })
    .filter(Boolean)
    .join(", ");
}

/** The ticket, by email. Optional: without Resend set up, the page is the ticket. */
async function sendTicketEmail(db: SupabaseClient, order: PaidOrder) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = (order.customer_email ?? "").trim();
  if (!apiKey || !to.includes("@")) return;
  const from = Deno.env.get("ORDER_FROM_EMAIL") || "Knots <onboarding@resend.dev>";
  const replyTo = Deno.env.get("ORDER_REPLY_TO") || from;
  const qty = order.items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
  const ref = ticketRef(order.id);
  const first = (order.customer_name ?? "").trim().split(/\s+/)[0] || "there";
  const plural = qty === 1 ? "ticket" : "tickets";
  const releases = tierSummary(order.items);
  const cell = "font-family:Helvetica,Arial,sans-serif;";
  const label = `${cell}font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#8a8a8a;`;
  const value = `${cell}font-size:16px;color:#fff;`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Your NYE ${plural}</title></head>
<body style="margin:0;padding:0;background:#000;">
<div style="display:none;max-height:0;overflow:hidden;">You're in. ${qty} ${plural} for the KNOTS NYE Rooftop Party, ref ${ref}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;border:1px solid #2a2a2a;">
<tr><td style="${cell}padding:28px 28px 8px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#8a8a8a;">KNOTS presents</td></tr>
<tr><td style="${cell}padding:0 28px 6px;font-size:34px;line-height:1.05;font-weight:bold;letter-spacing:0.02em;text-transform:uppercase;color:#fff;">NYE Rooftop Party</td></tr>
<tr><td style="${cell}padding:0 28px 22px;font-size:12px;line-height:1.6;color:#8a8a8a;">${escapeHtml(EVENT.details)}</td></tr>
<tr><td style="${cell}padding:0 28px 26px;font-size:14px;line-height:1.7;color:#cfcfcf;">You're in, ${escapeHtml(first)}. Show this email or give your name at the door.</td></tr>
<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #444;border-bottom:1px dashed #444;">
<tr><td style="${label}padding:16px 0 4px;">Name</td><td align="right" style="${label}padding:16px 0 4px;">Admits</td></tr>
<tr><td style="${value}padding:0 0 14px;">${escapeHtml(order.customer_name || "Ticket holder")}</td><td align="right" style="${value}padding:0 0 14px;">${qty}</td></tr>
<tr><td style="${label}padding:0 0 4px;">Date</td><td align="right" style="${label}padding:0 0 4px;">Ref</td></tr>
<tr><td style="${value}padding:0 0 16px;">31.12.2026</td><td align="right" style="${value}padding:0 0 16px;font-family:Menlo,Consolas,monospace;">${ref}</td></tr>
</table></td></tr>
<tr><td style="${cell}padding:18px 28px 28px;font-size:12px;line-height:1.7;color:#8a8a8a;">${escapeHtml(releases)} · paid AUD ${(Number(order.total) || 0).toFixed(2)}. Your ticket is also at <a href="https://knotsss.com/nye" style="color:#fff;">knotsss.com/nye</a> on the device you bought it on.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `You're in, ${first}.\n\nKNOTS NYE Rooftop Party\n${EVENT.details}\n\nName: ${order.customer_name}\nAdmits: ${qty} (${releases})\nRef: ${ref}\nPaid: AUD ${(Number(order.total) || 0).toFixed(2)}\n\nShow this email or give your name at the door.`;
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

/**
 * Holds `quantity` places and returns the hold, or why it couldn't. The hold
 * is written first and checked after, against everything sold or held before
 * it — so two people can never both get the last place in a release. Losing
 * that race just means trying again against the new numbers.
 */
async function hold(db: SupabaseClient, stripe: Stripe, quantity: number, now: number, off: Set<string>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await ticketOrders(db);
    await settleStaleHolds(db, stripe, before, now);
    const live = before.filter((o) => o.status !== "cancelled");
    const used = usage(live);
    const lines = allocate(quantity, used, off);
    if (!lines) {
      // Never say how many are left.
      const left = TIERS.reduce((n, t) => n + openPlaces(t, used, off), 0);
      return { error: left === 0 ? "Sold out." : "There aren't that many tickets left — try fewer." } as const;
    }

    const total = lines.reduce((n, l) => n + l.tier.price * l.quantity, 0);
    const { data: order, error } = await db
      .from("orders")
      .insert({
        items: lines.map((l) => ({
          kind: "ticket",
          event: EVENT.id,
          tier: l.tier.id,
          title: `KNOTS NYE — ${l.tier.name}`,
          variantTitle: "",
          price: String(l.tier.price),
          quantity: l.quantity,
        })),
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
    if (error) throw error;

    const mine = { at: Date.parse(order.created_at), id: order.id as string };
    const ahead = (await ticketOrders(db)).filter((o) => {
      if (o.id === mine.id) return false;
      if (isSold(o)) return true;
      const at = Date.parse(o.created_at);
      return o.status === "pending" && (at < mine.at || (at === mine.at && o.id < mine.id));
    });
    const usedAhead = usage(ahead);
    if (lines.every((l) => usedAhead[l.tier.id] + l.quantity <= l.tier.capacity)) {
      return { order: order as { id: string }, lines, total } as const;
    }
    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
  }
  return { error: "Tickets are going fast — please try again." } as const;
}

interface WalletStatus {
  domain: string;
  registered: boolean;
  apple_pay: string | null;
  google_pay: string | null;
}

/**
 * Makes sure the site's domains are registered for wallets, so Apple Pay
 * shows in the payment form. Safe to repeat: it only adds what's missing.
 */
async function ensureWalletDomains(stripe: Stripe): Promise<WalletStatus[]> {
  const out: WalletStatus[] = [];
  for (const domain of WALLET_DOMAINS) {
    try {
      const { data } = await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 });
      let pmd = data[0];
      if (!pmd) pmd = await stripe.paymentMethodDomains.create({ domain_name: domain, enabled: true });
      else if (!pmd.enabled) pmd = await stripe.paymentMethodDomains.update(pmd.id, { enabled: true });
      if (pmd.apple_pay?.status !== "active") pmd = await stripe.paymentMethodDomains.validate(pmd.id);
      out.push({
        domain,
        registered: true,
        apple_pay: pmd.apple_pay?.status ?? null,
        google_pay: pmd.google_pay?.status ?? null,
      });
    } catch (err) {
      console.error("wallet domain", domain, err);
      out.push({ domain, registered: false, apple_pay: null, google_pay: null });
    }
  }
  return out;
}

// Once per running instance is plenty.
let walletsReady: Promise<WalletStatus[]> | null = null;
const wallets = (stripe: Stripe) => (walletsReady ??= ensureWalletDomains(stripe).catch(() => ((walletsReady = null), [])));

/** Whether Apple Pay is switched on in the account's payment methods (null if it can't tell). */
async function applePayOn(stripe: Stripe): Promise<boolean | null> {
  try {
    const { data } = await stripe.paymentMethodConfigurations.list({ limit: 100 });
    const config = data.find((c) => c.is_default && !c.parent) ?? data.find((c) => c.is_default) ?? data[0];
    return config ? Boolean(config.apple_pay?.available) : null;
  } catch (err) {
    console.error("payment method configuration", err);
    return null;
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
      // Register the domain for Apple Pay in the background, well before anyone pays.
      const registering = wallets(stripe);
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (runtime) runtime.waitUntil(registering);
      const [orders, off] = await Promise.all([ticketOrders(db), switchedOff(now)]);
      await settleStaleHolds(db, stripe, orders, now);
      return json(availability(orders.filter((o) => o.status !== "cancelled"), now, off));
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

      const [off] = await Promise.all([switchedOff(now), wallets(stripe)]);
      const held = await hold(db, stripe, quantity, now, off);
      if ("error" in held) return json({ error: held.error }, 409);
      const { order, lines, total } = held;

      const metadata = { ticket_order_id: order.id, event: EVENT.id, kind: "ticket" };
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          ui_mode: "embedded",
          redirect_on_completion: "if_required",
          return_url: `${body.return_url}?session_id={CHECKOUT_SESSION_ID}`,
          line_items: lines.map((l) => ({
            quantity: l.quantity,
            price_data: {
              currency: EVENT.currency,
              unit_amount: Math.round(l.tier.price * 100),
              product_data: { name: `KNOTS NYE — ${l.tier.name}`, description: EVENT.details },
            },
          })),
          submit_type: "pay",
          expires_at: Math.floor(now / 1000) + SESSION_MINUTES * 60,
          metadata,
          // Card statements read "KNOTS* NYE TICKETS", so buyers recognise the charge.
          payment_intent_data: { metadata, description: `KNOTS NYE × ${quantity}`, statement_descriptor_suffix: "NYE TICKETS" },
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
        lines: lines.map((l) => ({ tier: l.tier.id, name: l.tier.name, price: l.tier.price, quantity: l.quantity })),
        total,
      });
    }

    if (body.action === "confirm") {
      const sessionId = String(body.session_id ?? "");
      if (!sessionId.startsWith("cs_")) return json({ error: "Missing session id." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata?.ticket_order_id;
      if (!orderId || session.metadata?.event !== EVENT.id) return json({ error: "Not a ticket." }, 404);

      const paid = session.status === "complete" && session.payment_status !== "unpaid";
      if (!paid) return json({ status: session.status, ticket: null });

      const flipped = await markPaid(db, orderId, session);
      if (flipped) await sendTicketEmail(db, flipped);
      const { data: row } = await db.from("orders").select("items").eq("id", orderId).maybeSingle();
      const items = ((row?.items ?? []) as TicketItem[]);
      return json({
        status: "paid",
        ticket: {
          ref: ticketRef(orderId),
          name: session.customer_details?.name ?? null,
          email: session.customer_details?.email ?? null,
          quantity: items.reduce((n, it) => n + (Number(it.quantity) || 0), 0),
          releases: tierSummary(items),
          total: (session.amount_total ?? 0) / 100,
          currency: (session.currency ?? EVENT.currency).toUpperCase(),
        },
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

    // For the dashboard: is Apple Pay ready to show?
    if (body.action === "wallets") {
      walletsReady = null; // check afresh
      const [domains, enabled] = await Promise.all([wallets(stripe), applePayOn(stripe)]);
      return json({ domains, apple_pay_enabled: enabled });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong — please try again." }, 500);
  }
});
