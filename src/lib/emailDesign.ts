// The data model behind the drag-and-drop email designer, and the compiler that
// turns it into email-safe HTML.
//
// The design is stored as JSON so the editor can round-trip it, and compiled to
// HTML on every save. The send path only ever reads the compiled HTML, so a
// template that was hand-written before the designer existed — or edited by
// hand afterwards — keeps working untouched.
//
// Compiled output is deliberately old-fashioned: nested tables, inline styles,
// no flexbox, no classes. Outlook still renders with Word's engine and Gmail
// strips <style> blocks, so anything more modern breaks somewhere.

export type BlockType =
  | "logo"
  | "heading"
  | "text"
  | "items"
  | "totals"
  | "address"
  | "tracking"
  | "button"
  | "image"
  | "divider"
  | "spacer"
  | "footer";

export type Align = "left" | "center" | "right";

export interface Block {
  id: string;
  type: BlockType;
  /** Free text, with {{placeholders}} allowed. */
  text?: string;
  url?: string;
  href?: string;
  align?: Align;
  size?: number;
  color?: string;
  background?: string;
  /** Width in px for logo/image blocks. */
  width?: number;
  height?: number;
  uppercase?: boolean;
  tracking?: number;
  bold?: boolean;
  paddingTop?: number;
  paddingBottom?: number;
  radius?: number;
}

export interface EmailTheme {
  background: string;
  contentBackground: string;
  text: string;
  muted: string;
  faint: string;
  rule: string;
  accent: string;
  accentText: string;
  fontFamily: string;
  contentWidth: number;
}

export interface EmailDesign {
  version: 1;
  theme: EmailTheme;
  blocks: Block[];
}

export const DEFAULT_THEME: EmailTheme = {
  background: "#faf4ef",
  contentBackground: "#faf4ef",
  text: "#2b1d14",
  muted: "#6b5647",
  faint: "#9b8878",
  rule: "#e3d8cd",
  accent: "#2b1d14",
  accentText: "#faf4ef",
  fontFamily: "Helvetica, Arial, sans-serif",
  contentWidth: 520,
};

export const FONT_CHOICES = [
  { label: "Helvetica / Arial", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Courier (mono)", value: "'Courier New', Courier, monospace" },
  { label: "Trebuchet", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
];

/** What each block is called, and the one-liner shown when adding it. */
export const BLOCK_META: Record<BlockType, { label: string; hint: string }> = {
  logo: { label: "Logo", hint: "Your wordmark, centred" },
  heading: { label: "Heading", hint: "A short line of display type" },
  text: { label: "Text", hint: "A paragraph — placeholders allowed" },
  items: { label: "Order items", hint: "What they bought, with prices" },
  totals: { label: "Totals", hint: "Subtotal, shipping and total" },
  address: { label: "Shipping address", hint: "Where it's going" },
  tracking: { label: "Tracking", hint: "Carrier and number, when there is one" },
  button: { label: "Button", hint: "A link styled as a button" },
  image: { label: "Image", hint: "Any image by URL" },
  divider: { label: "Divider", hint: "A horizontal rule" },
  spacer: { label: "Spacer", hint: "Vertical breathing room" },
  footer: { label: "Footer", hint: "Small print at the bottom" },
};

export const ADDABLE: BlockType[] = [
  "heading", "text", "items", "totals", "address", "tracking",
  "button", "image", "logo", "divider", "spacer", "footer",
];

let idCounter = 0;
export function newId() {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newBlock(type: BlockType): Block {
  const base: Block = { id: newId(), type, align: "left", paddingTop: 0, paddingBottom: 16 };
  switch (type) {
    case "logo":
      return { ...base, align: "center", width: 64, paddingBottom: 28 };
    case "heading":
      return {
        ...base, text: "Order confirmed", size: 13, uppercase: true,
        tracking: 0.2, paddingBottom: 18,
      };
    case "text":
      return {
        ...base,
        text: "Thanks {{customer_first_name}} — we've got your order and we're packing it now.",
        size: 13, paddingBottom: 24,
      };
    case "button":
      return {
        ...base, text: "Track your order", href: "{{site_url}}", align: "center",
        size: 12, radius: 0, paddingTop: 4, paddingBottom: 24,
      };
    case "image":
      return { ...base, url: "", width: 520, align: "center", paddingBottom: 20 };
    case "divider":
      return { ...base, paddingTop: 4, paddingBottom: 18 };
    case "spacer":
      return { ...base, height: 24, paddingBottom: 0 };
    case "footer":
      return {
        ...base, text: "Order {{order_number}} &middot; knotsss.com",
        align: "center", size: 11, paddingTop: 20, paddingBottom: 0,
      };
    case "tracking":
      return { ...base, paddingBottom: 22 };
    default:
      return { ...base, paddingBottom: 18 };
  }
}

/* -------------------------------------------------------------------------- */
/* Compiler                                                                    */
/* -------------------------------------------------------------------------- */

function esc(s: string) {
  return String(s)
    .replace(/&(?!(?:[a-zA-Z]+|#\d+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Attribute-safe: URLs go into href/src, so quotes and javascript: must not. */
function safeUrl(raw: string | undefined) {
  const url = String(raw ?? "").trim();
  if (!url) return "";
  if (/^(https?:|mailto:|tel:|\{\{)/i.test(url)) {
    return url.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
  }
  return "";
}

function pad(b: Block) {
  return `padding-top:${b.paddingTop ?? 0}px;padding-bottom:${b.paddingBottom ?? 0}px;`;
}

function typeStyle(b: Block, t: EmailTheme, fallbackColor: string) {
  return (
    `font-family:${t.fontFamily};` +
    `font-size:${b.size ?? 13}px;` +
    `color:${b.color || fallbackColor};` +
    `text-align:${b.align ?? "left"};` +
    (b.bold ? "font-weight:bold;" : "") +
    (b.uppercase ? "text-transform:uppercase;" : "") +
    (b.tracking ? `letter-spacing:${b.tracking}em;` : "")
  );
}

function renderBlock(b: Block, t: EmailTheme): string {
  const cell = (inner: string, extra = "") =>
    `<tr><td style="${pad(b)}${extra}">${inner}</td></tr>`;

  switch (b.type) {
    case "logo": {
      const w = b.width ?? 64;
      return cell(
        `<img src="{{logo_url}}" width="${w}" height="${w}" alt="Knots" ` +
          `style="display:block;border:0;outline:none;text-decoration:none;margin:${
            b.align === "center" ? "0 auto" : b.align === "right" ? "0 0 0 auto" : "0"
          };" />`,
        `text-align:${b.align ?? "center"};`,
      );
    }

    case "heading":
    case "text":
      return cell(
        `<div style="${typeStyle(b, t, b.type === "heading" ? t.text : t.muted)}line-height:1.7;">` +
          `${b.text ?? ""}</div>`,
      );

    case "footer":
      return cell(
        `<div style="${typeStyle(b, t, t.faint)}line-height:1.7;">${b.text ?? ""}</div>`,
        `border-top:1px solid ${t.rule};`,
      );

    case "items":
      return cell("{{items_html}}", `border-top:1px solid ${t.rule};`);

    case "totals":
      return cell(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
          `style="font-family:${t.fontFamily};font-size:12px;color:${t.muted};">` +
          `<tr><td style="padding:3px 0;">Subtotal</td>` +
          `<td align="right" style="padding:3px 0;color:${t.text};">{{subtotal}}</td></tr>` +
          `<tr><td style="padding:3px 0;">Shipping &mdash; {{shipping_service}}</td>` +
          `<td align="right" style="padding:3px 0;color:${t.text};">{{shipping}}</td></tr>` +
          `<tr><td style="padding:9px 0 0;border-top:1px solid ${t.rule};font-size:13px;` +
          `letter-spacing:0.1em;text-transform:uppercase;color:${t.text};">Total</td>` +
          `<td align="right" style="padding:9px 0 0;border-top:1px solid ${t.rule};` +
          `font-size:14px;color:${t.text};">{{total}}</td></tr></table>`,
        `border-top:1px solid ${t.rule};`,
      );

    case "address":
      return cell(
        `<div style="font-family:${t.fontFamily};font-size:11px;letter-spacing:0.15em;` +
          `text-transform:uppercase;color:${t.faint};padding-bottom:6px;">Shipping to</div>` +
          `<div style="font-family:${t.fontFamily};font-size:12px;line-height:1.7;color:${t.muted};">` +
          `{{shipping_address_html}}</div>`,
        `border-top:1px solid ${t.rule};`,
      );

    // Renders to nothing until the order actually has a tracking number.
    case "tracking":
      return "{{tracking_block}}";

    case "button": {
      const href = safeUrl(b.href) || "{{site_url}}";
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
          `style="margin:${b.align === "center" ? "0 auto" : b.align === "right" ? "0 0 0 auto" : "0"};">` +
          `<tr><td style="background:${b.background || t.accent};border-radius:${b.radius ?? 0}px;">` +
          `<a href="${href}" style="display:inline-block;padding:13px 26px;` +
          `font-family:${t.fontFamily};font-size:${b.size ?? 12}px;letter-spacing:0.15em;` +
          `text-transform:uppercase;color:${b.color || t.accentText};text-decoration:none;">` +
          `${b.text ?? "View order"}</a></td></tr></table>`,
        `text-align:${b.align ?? "center"};`,
      );
    }

    case "image": {
      const src = safeUrl(b.url);
      if (!src) return "";
      const img =
        `<img src="${src}" width="${b.width ?? 520}" alt="" ` +
        `style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;margin:${
          b.align === "center" ? "0 auto" : b.align === "right" ? "0 0 0 auto" : "0"
        };" />`;
      const href = safeUrl(b.href);
      return cell(href ? `<a href="${href}">${img}</a>` : img, `text-align:${b.align ?? "center"};`);
    }

    case "divider":
      return cell(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
          `<tr><td style="border-top:1px solid ${b.color || t.rule};font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
      );

    case "spacer":
      return `<tr><td style="height:${b.height ?? 24}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

    default:
      return "";
  }
}

/**
 * Design → complete HTML email. The send function still injects the head and
 * meta tags, but a compiled design carries its own so the HTML tab and the
 * preview show the real thing.
 */
export function compileDesign(design: EmailDesign, subjectHint = "Knots"): string {
  const t = { ...DEFAULT_THEME, ...design.theme };
  const body = design.blocks.map((b) => renderBlock(b, t)).join("\n        ");

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>${esc(subjectHint)}</title>
</head>
<body style="margin:0;padding:0;background:${t.background};-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.background};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${t.contentWidth}px;background:${t.contentBackground};font-family:${t.fontFamily};color:${t.text};">
        ${body}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* Starting points                                                             */
/* -------------------------------------------------------------------------- */

function block(type: BlockType, over: Partial<Block> = {}): Block {
  return { ...newBlock(type), ...over };
}

/** Matches the seeded HTML, so opening the designer changes nothing by itself. */
export function defaultDesign(key: string): EmailDesign {
  if (key === "order_shipped") {
    return {
      version: 1,
      theme: { ...DEFAULT_THEME },
      blocks: [
        block("logo"),
        block("heading", { text: "On its way" }),
        block("text", {
          text: "{{customer_first_name}}, your order has left us via {{shipping_service}}.",
        }),
        block("tracking"),
        block("items"),
        block("address"),
        block("footer"),
      ],
    };
  }
  return {
    version: 1,
    theme: { ...DEFAULT_THEME },
    blocks: [
      block("logo"),
      block("heading", { text: "Order confirmed" }),
      block("text", {
        text:
          "Thanks {{customer_first_name}} — we've got your order and we're packing it now. " +
          "You'll get another note with tracking as soon as it ships.",
      }),
      block("items"),
      block("totals"),
      block("address"),
      block("footer"),
    ],
  };
}
