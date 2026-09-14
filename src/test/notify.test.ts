import { describe, expect, it } from "vitest";
import {
  orderNumber,
  renderTemplate,
  withEmailHead,
  type OrderForNotify,
} from "../../supabase/functions/_shared/notify";

const ORDER: OrderForNotify = {
  id: "3f9a12c4-55de-4f0a-9e7b-1122334455aa",
  currency: "AUD",
  customer_name: "Alex Rivera",
  customer_email: "alex@example.com",
  customer_phone: "+61400000000",
  items: [
    { title: "Cable Knit Vest", variantTitle: "Ecru / M", price: "180", quantity: 1 },
    { title: "Wool Scarf", variantTitle: "Default Title", price: "60", quantity: 2 },
  ],
  subtotal: 300,
  shipping_cost: 18.1,
  total: 318.1,
  shipping_service: "express",
  shipping_address: "Alex Rivera\n12 Renwick Street\nRedfern NSW 2016\nAU",
};

describe("orderNumber", () => {
  it("makes a short quotable reference from the order id", () => {
    expect(orderNumber(ORDER.id)).toBe("KN-3F9A12C4");
  });
});

describe("renderTemplate", () => {
  it("fills the customer and money placeholders", () => {
    const out = renderTemplate(
      "{{customer_first_name}} · {{order_number}} · {{subtotal}} / {{shipping}} / {{total}}",
      ORDER,
    );
    expect(out).toBe("Alex · KN-3F9A12C4 · AUD 300.00 / AUD 18.10 / AUD 318.10");
  });

  it("shows the service the customer actually chose, capitalised", () => {
    expect(renderTemplate("{{shipping_service}}", ORDER)).toBe("Express");
    expect(renderTemplate("{{shipping_service}}", { ...ORDER, shipping_service: null }))
      .toBe("Standard");
  });

  it("calls free shipping free rather than showing a zero", () => {
    expect(renderTemplate("{{shipping}}", { ...ORDER, shipping_cost: 0 })).toBe("Free");
  });

  it("lists items with quantities and line totals, hiding 'Default Title'", () => {
    const html = renderTemplate("{{items_html}}", ORDER);
    expect(html).toContain("1 &times; Cable Knit Vest");
    expect(html).toContain("Ecru / M");
    expect(html).toContain("AUD 180.00");
    expect(html).toContain("2 &times; Wool Scarf");
    expect(html).toContain("AUD 120.00"); // 60 × 2
    expect(html).not.toContain("Default Title");
  });

  it("escapes item titles so a product name can't break the email", () => {
    const html = renderTemplate("{{items_html}}", {
      ...ORDER,
      items: [{ title: '<script>alert("x")</script>', quantity: 1, price: "10" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("turns the address into HTML lines and a single-line string", () => {
    expect(renderTemplate("{{shipping_address_html}}", ORDER)).toContain(
      "12 Renwick Street<br />",
    );
    expect(renderTemplate("{{shipping_address_text}}", ORDER)).toBe(
      "Alex Rivera, 12 Renwick Street, Redfern NSW 2016, AU",
    );
  });

  it("leaves the tracking block empty until there's a tracking number", () => {
    expect(renderTemplate("{{tracking_block}}{{tracking_sms}}", ORDER)).toBe("");
    const shipped = renderTemplate("{{tracking_block}}|{{tracking_sms}}", {
      ...ORDER,
      tracking_number: "33ABC123",
      tracking_carrier: "Australia Post",
    });
    expect(shipped).toContain("33ABC123");
    expect(shipped).toContain("Tracking: 33ABC123 (Australia Post)");
  });

  it("falls back to 'there' rather than an empty greeting", () => {
    expect(renderTemplate("Hi {{customer_first_name}}", { ...ORDER, customer_name: null }))
      .toBe("Hi there");
  });

  it("drops placeholders it doesn't know instead of printing the token", () => {
    expect(renderTemplate("a{{nonsense}}b", ORDER)).toBe("ab");
  });
});

describe("withEmailHead (deliverability)", () => {
  const bare = "<html><body><h1>Order confirmed</h1></body></html>";

  it("adds a doctype, so clients don't fall back to quirks mode", () => {
    expect(withEmailHead(bare, ORDER).toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("adds the meta tags mail clients and filters look for", () => {
    const out = withEmailHead(bare, ORDER);
    expect(out).toContain('<meta charset="utf-8" />');
    expect(out).toContain('name="viewport"');
    expect(out).toContain("x-apple-disable-message-reformatting");
    expect(out).toContain('name="color-scheme"');
    expect(out).toContain('name="supported-color-schemes"');
    expect(out).toContain('name="format-detection"');
  });

  it("gives the document a language and a title", () => {
    const out = withEmailHead(bare, ORDER);
    expect(out).toContain('<html lang="en"');
    expect(out).toContain("<title>Knots order KN-3F9A12C4</title>");
  });

  it("adds a preheader so the inbox preview reads like a receipt", () => {
    const out = withEmailHead(bare, ORDER);
    expect(out).toContain("Order KN-3F9A12C4 confirmed");
    expect(out).toContain("AUD 318.10");
    expect(out).toContain("display:none");
    // Must sit before anything visible, or the client previews the wrong text.
    expect(out.indexOf("Order KN-3F9A12C4 confirmed")).toBeLessThan(out.indexOf("<h1>"));
  });

  it("previews tracking instead when the order has shipped", () => {
    const out = withEmailHead(bare, { ...ORDER, tracking_number: "33ABC999" }, true);
    expect(out).toContain("has shipped");
    expect(out).toContain("33ABC999");
  });

  it("doesn't duplicate anything the template already has", () => {
    const full =
      '<!doctype html><html lang="fr"><head><meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width" /><title>Mine</title></head>' +
      "<body><p>Hi</p></body></html>";
    const out = withEmailHead(full, ORDER);
    expect(out.match(/charset/gi)?.length).toBe(1);
    expect(out.match(/name="viewport"/gi)?.length).toBe(1);
    expect(out).toContain("<title>Mine</title>");
    expect(out).toContain('lang="fr"'); // an explicit choice is left alone
  });

  it("wraps a fragment that has no html/body of its own", () => {
    const out = withEmailHead("<table><tr><td>Hi</td></tr></table>", ORDER);
    expect(out).toContain("<html lang=\"en\"");
    expect(out).toContain("<head>");
    expect(out).toContain("</body></html>");
    expect(out).toContain("<table>");
  });

  it("is idempotent — re-running adds nothing", () => {
    const once = withEmailHead(bare, ORDER);
    expect(withEmailHead(once, ORDER)).toBe(once);
  });
});
