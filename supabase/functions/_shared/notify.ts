// Customer notifications: renders a dashboard-editable template for an order
// and sends it by email (Resend) and/or SMS (Twilio).
//
// Both providers are optional. With neither configured this is a no-op that
// reports what it skipped, so the rest of checkout and fulfilment keeps working
// and the dashboard can say plainly why nothing went out.

const SITE = "https://knotsss.com";
// Composited onto the email background: the source logo has no alpha channel.
const LOGO_URL = `${SITE}/logo-email.png`;

export interface OrderForNotify {
  id: string;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  items: Array<Record<string, unknown>> | null;
  subtotal: number | string;
  shipping_cost: number | string;
  total: number | string;
  shipping_service: string | null;
  shipping_address: string | null;
  tracking_number?: string | null;
  tracking_carrier?: string | null;
}

export interface NotifyResult {
  email: "sent" | "skipped" | "failed";
  sms: "sent" | "skipped" | "failed";
  reason?: string;
}

/** First 8 characters of the uuid, e.g. "KN-3F9A12C4" — short enough to quote. */
export function orderNumber(id: string) {
  return `KN-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** "express" as stored → "Express" as read by a customer. */
function serviceLabel(service: string | null | undefined) {
  const s = (service ?? "").trim();
  if (!s) return "Standard";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function money(currency: string, amount: number | string) {
  return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function itemsHtml(order: OrderForNotify) {
  const rows = (order.items ?? []).map((it) => {
    const title = escapeHtml(String(it.title ?? ""));
    const variant = String(it.variantTitle ?? "");
    const qty = Number(it.quantity) || 1;
    const line = (Number(it.price) || 0) * qty;
    // Colours inherit from the surrounding template rather than being fixed
    // here, so a dark or recoloured design doesn't end up unreadable.
    const sub = variant && variant !== "Default Title"
      ? `<div style="font-size:11px;opacity:0.65;">${escapeHtml(variant)}</div>`
      : "";
    return `<tr>
      <td style="padding:6px 0;font-size:12px;color:inherit;">
        ${qty} &times; ${title}${sub}
      </td>
      <td align="right" style="padding:6px 0;font-size:12px;color:inherit;">
        ${money(order.currency, line)}
      </td>
    </tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
}

function itemsText(order: OrderForNotify) {
  return (order.items ?? [])
    .map((it) => `${Number(it.quantity) || 1} x ${String(it.title ?? "")}`)
    .join(", ");
}

function addressHtml(order: OrderForNotify) {
  if (!order.shipping_address) return "<em>No address on file</em>";
  return escapeHtml(order.shipping_address).replace(/\n/g, "<br />");
}

function trackingBlock(order: OrderForNotify) {
  if (!order.tracking_number) return "";
  const carrier = escapeHtml(order.tracking_carrier ?? "");
  const num = escapeHtml(order.tracking_number);
  return `<tr><td style="padding-bottom:22px;color:inherit;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid currentColor;">
      <tr><td style="padding:14px 16px;color:inherit;">
        <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;opacity:0.65;padding-bottom:5px;">
          Tracking${carrier ? ` &middot; ${carrier}` : ""}
        </div>
        <div style="font-size:15px;letter-spacing:0.06em;">${num}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * Meta tags every one of our emails needs, whatever the dashboard author does
 * to the template. Missing ones are injected rather than enforced by rejecting
 * the template, so editing the design can never quietly break rendering (or
 * deliverability) in a mail client.
 *
 * - charset: without it, non-ASCII in a name or address renders as mojibake,
 *   which spam filters treat as an obfuscation signal.
 * - viewport: stops mobile Gmail shrinking the whole email to unreadable.
 * - x-apple-disable-message-reformatting: stops Apple Mail re-flowing it.
 * - color-scheme/supported-color-schemes: renders correctly in dark mode
 *   instead of Gmail force-inverting the palette.
 * - format-detection: stops iOS turning the order number into a fake phone link.
 */
const REQUIRED_META = [
  ['<meta charset="utf-8" />', /<meta[^>]+charset/i],
  ['<meta name="viewport" content="width=device-width, initial-scale=1" />', /<meta[^>]+name=["']viewport/i],
  ['<meta name="x-apple-disable-message-reformatting" />', /x-apple-disable-message-reformatting/i],
  ['<meta name="color-scheme" content="light dark" />', /name=["']color-scheme/i],
  ['<meta name="supported-color-schemes" content="light dark" />', /name=["']supported-color-schemes/i],
  ['<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />', /name=["']format-detection/i],
] as const;

/**
 * The inbox preview line. Without one, clients scrape the first visible text —
 * usually the logo's alt text or a bare "Order confirmed" — which reads like
 * bulk mail. Hidden in the body itself via zero size + preheader padding.
 */
function preheader(order: OrderForNotify, shipped: boolean) {
  const n = orderNumber(order.id);
  const text = shipped
    ? `Order ${n} has shipped${order.tracking_number ? ` — tracking ${order.tracking_number}` : ""}.`
    : `Order ${n} confirmed — ${money(order.currency, order.total)}. Packing it now.`;
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:#faf4ef;opacity:0;">${escapeHtml(text)}` +
    "&#8203;".repeat(60) +
    "</div>"
  );
}

/**
 * Make a template body into a complete, well-formed HTML email. A body that
 * arrives without a doctype and head is the single most common reason a
 * perfectly ordinary receipt gets scored as spam.
 */
export function withEmailHead(html: string, order: OrderForNotify, shipped = false): string {
  let out = html.trim();

  if (!/<!doctype/i.test(out)) {
    out = '<!doctype html>\n' + out;
  }
  if (!/<html[\s>]/i.test(out)) {
    out = out.replace(
      /(<!doctype[^>]*>)?/i,
      (m) => `${m}\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><body>`,
    ) + "</body></html>";
  }
  // A <html> with no lang is a small but real spam signal.
  out = out.replace(/<html(?![^>]*\blang=)/i, '<html lang="en"');

  if (!/<head[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, "<html$1><head></head>");
  }

  const missing = REQUIRED_META.filter(([, present]) => !present.test(out)).map(([tag]) => tag);
  if (missing.length) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${missing.join("")}`);
  }
  if (!/<title[\s>]/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `<title>${escapeHtml(`Knots order ${orderNumber(order.id)}`)}</title></head>`,
    );
  }

  // Preheader goes first inside <body>, before anything visible.
  if (!/data-preheader/i.test(out)) {
    out = out.replace(
      /<body([^>]*)>/i,
      (_m, attrs) => `<body${attrs}><span data-preheader="1"></span>${preheader(order, shipped)}`,
    );
  }

  return out;
}

/** Fill {{placeholders}} in a template body for this order. */
export function renderTemplate(body: string, order: OrderForNotify): string {
  const name = (order.customer_name ?? "").trim();
  const vars: Record<string, string> = {
    logo_url: LOGO_URL,
    site_url: SITE,
    order_number: orderNumber(order.id),
    customer_name: name || "there",
    customer_first_name: (name.split(" ")[0] || "there"),
    customer_email: order.customer_email ?? "",
    customer_phone: order.customer_phone ?? "",
    items_html: itemsHtml(order),
    items_text: itemsText(order),
    subtotal: money(order.currency, order.subtotal),
    shipping: Number(order.shipping_cost) > 0 ? money(order.currency, order.shipping_cost) : "Free",
    total: money(order.currency, order.total),
    shipping_service: serviceLabel(order.shipping_service),
    shipping_address_html: addressHtml(order),
    shipping_address_text: (order.shipping_address ?? "").replace(/\n/g, ", "),
    tracking_number: order.tracking_number ?? "",
    tracking_carrier: order.tracking_carrier ?? "",
    tracking_block: trackingBlock(order),
    tracking_sms: order.tracking_number
      ? `Tracking: ${order.tracking_number}${order.tracking_carrier ? ` (${order.tracking_carrier})` : ""}`
      : "",
  };

  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/** Strip tags for the plain-text part of the email. */
function toPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/&times;/g, "x")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

interface TemplateRow {
  subject: string;
  html: string;
  sms_body: string | null;
  enabled: boolean;
}

/** The one query this module makes, rather than the whole Supabase client. */
export interface TemplateReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/**
 * Send one template for one order. `channels` narrows what goes out — the
 * dashboard offers email, SMS or both.
 */
export async function sendOrderNotification(
  supabase: TemplateReader,
  templateKey: string,
  order: OrderForNotify,
  channels: { email: boolean; sms: boolean },
): Promise<NotifyResult> {
  const { data: template } = await supabase
    .from("email_templates")
    .select("subject,html,sms_body,enabled")
    .eq("key", templateKey)
    .maybeSingle();

  const tpl = template as TemplateRow | null;
  if (!tpl || !tpl.enabled) {
    return { email: "skipped", sms: "skipped", reason: "Template missing or disabled." };
  }

  const result: NotifyResult = { email: "skipped", sms: "skipped" };
  const reasons: string[] = [];

  // --- Email via Resend -----------------------------------------------------
  if (channels.email) {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    // Both of these must be on a domain verified in Resend with SPF, DKIM and
    // DMARC published, or the mail is unauthenticated and Gmail will junk it
    // however clean the HTML is. The resend.dev sender is a shared testing
    // domain — fine for a smoke test, never for real customers.
    const from = Deno.env.get("ORDER_FROM_EMAIL") || "Knots <onboarding@resend.dev>";
    const replyTo = Deno.env.get("ORDER_REPLY_TO") || from;
    const to = (order.customer_email ?? "").trim();

    if (apiKey && !Deno.env.get("ORDER_FROM_EMAIL")) {
      reasons.push("ORDER_FROM_EMAIL not set — sending from the shared resend.dev domain, which will land in spam");
    }

    if (!apiKey) {
      reasons.push("RESEND_API_KEY not set");
    } else if (!to || !to.includes("@")) {
      reasons.push("no customer email on the order");
    } else {
      try {
        // Head/meta are injected here rather than trusted from the template, so
        // a hand-edited design can't cost us the inbox.
        const html = withEmailHead(
          renderTemplate(tpl.html, order),
          order,
          templateKey === "order_shipped",
        );
        const text = toPlainText(html);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from,
            to: [to],
            // A monitored reply address is a strong "real mail" signal, and
            // customers do reply to order confirmations.
            reply_to: replyTo,
            subject: renderTemplate(tpl.subject, order),
            html,
            // Always send a real text/plain alternative. HTML-only mail is one
            // of the oldest and most reliable spam signals there is.
            text,
            headers: {
              // Stops Gmail collapsing separate orders into one thread, which
              // is what makes a run of receipts look like a bulk campaign.
              "X-Entity-Ref-ID": `${templateKey}-${order.id}`,
              // Marks the mail as a one-to-one response to the customer's own
              // action rather than a campaign send.
              "X-Auto-Response-Suppress": "OOF, AutoReply",
            },
            tags: [{ name: "type", value: templateKey.replace(/_/g, "-") }],
          }),
        });
        if (res.ok) {
          result.email = "sent";
        } else {
          result.email = "failed";
          reasons.push(`email: ${(await res.text()).slice(0, 140)}`);
        }
      } catch (err) {
        result.email = "failed";
        reasons.push(`email: ${err instanceof Error ? err.message : "send failed"}`);
      }
    }
  }

  // --- SMS via Twilio -------------------------------------------------------
  if (channels.sms) {
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
    const to = (order.customer_phone ?? "").trim();

    if (!sid || !token || !fromNumber) {
      reasons.push("Twilio not configured");
    } else if (!to) {
      reasons.push("no customer phone on the order");
    } else if (!tpl.sms_body) {
      reasons.push("template has no SMS wording");
    } else {
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: to,
              From: fromNumber,
              Body: renderTemplate(tpl.sms_body, order),
            }),
          },
        );
        if (res.ok) {
          result.sms = "sent";
        } else {
          result.sms = "failed";
          reasons.push(`sms: ${(await res.text()).slice(0, 140)}`);
        }
      } catch (err) {
        result.sms = "failed";
        reasons.push(`sms: ${err instanceof Error ? err.message : "send failed"}`);
      }
    }
  }

  if (reasons.length) result.reason = reasons.join("; ");
  return result;
}
