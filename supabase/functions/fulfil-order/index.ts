// Marks an order fulfilled from the admin dashboard, optionally recording a
// tracking number, and tells the customer it's on its way.
//
// Admin-only: the caller must present a logged-in user's access token. The anon
// key alone is a valid project JWT, so we resolve the user explicitly rather
// than relying on Supabase's JWT verification by itself.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cart.ts";
import { sendOrderNotification, type OrderForNotify } from "../_shared/notify.ts";

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const {
      order_id,
      tracking_number,
      tracking_carrier,
      notify_email = true,
      notify_sms = false,
    } = (await req.json()) as {
      order_id: string;
      tracking_number?: string | null;
      tracking_carrier?: string | null;
      notify_email?: boolean;
      notify_sms?: boolean;
    };
    if (!order_id) return json({ error: "Missing order id." }, 400);

    const { data: order, error: readErr } = await admin
      .from("orders")
      .select(
        "id,currency,customer_name,customer_email,customer_phone,items,subtotal," +
          "shipping_cost,total,shipping_service,shipping_address,status",
      )
      .eq("id", order_id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!order) return json({ error: "Order not found." }, 404);

    const tracking = (tracking_number ?? "").trim() || null;
    const carrier = tracking ? ((tracking_carrier ?? "").trim() || "Australia Post") : null;

    const { error: updateErr } = await admin
      .from("orders")
      .update({
        status: "fulfilled",
        shipped_at: new Date().toISOString(),
        tracking_number: tracking,
        tracking_carrier: carrier,
      })
      .eq("id", order_id);
    if (updateErr) throw updateErr;

    // The order is fulfilled either way — a notification that couldn't go out
    // is reported back, not treated as a failure to fulfil.
    const notify: OrderForNotify = {
      ...(order as unknown as OrderForNotify),
      id: order_id,
      tracking_number: tracking,
      tracking_carrier: carrier,
    };
    const sent = await sendOrderNotification(admin, "order_shipped", notify, {
      email: Boolean(notify_email),
      sms: Boolean(notify_sms),
    });

    return json({ ok: true, tracking_number: tracking, notification: sent }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: "Could not mark the order as fulfilled." }, 500);
  }
});
