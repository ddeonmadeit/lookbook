import { describe, expect, it } from "vitest";
import {
  compileDesign,
  defaultDesign,
  newBlock,
  DEFAULT_THEME,
  type EmailDesign,
} from "../lib/emailDesign";

function design(blocks: EmailDesign["blocks"], theme = {}): EmailDesign {
  return { version: 1, theme: { ...DEFAULT_THEME, ...theme }, blocks };
}

describe("compileDesign", () => {
  it("emits a complete document with the deliverability meta tags", () => {
    const html = compileDesign(defaultDesign("order_confirmation"));
    expect(html.toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("x-apple-disable-message-reformatting");
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('name="format-detection"');
  });

  it("builds with tables and inline styles, not modern CSS", () => {
    const html = compileDesign(defaultDesign("order_confirmation"));
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
  });

  it("keeps the placeholders the send function fills in", () => {
    const html = compileDesign(defaultDesign("order_confirmation"));
    for (const token of ["{{logo_url}}", "{{items_html}}", "{{subtotal}}", "{{total}}", "{{shipping_address_html}}"]) {
      expect(html).toContain(token);
    }
  });

  it("renders blocks in order, so dragging changes the email", () => {
    const a = newBlock("heading");
    const b = newBlock("text");
    a.text = "FIRST";
    b.text = "SECOND";
    const forward = compileDesign(design([a, b]));
    const reversed = compileDesign(design([b, a]));
    expect(forward.indexOf("FIRST")).toBeLessThan(forward.indexOf("SECOND"));
    expect(reversed.indexOf("SECOND")).toBeLessThan(reversed.indexOf("FIRST"));
  });

  it("applies the theme to the page and the content table", () => {
    const html = compileDesign(design([newBlock("items")], { background: "#101010", text: "#ffffff" }));
    expect(html).toContain("background:#101010");
    expect(html).toContain("color:#ffffff");
  });

  it("carries per-block styling into the markup", () => {
    const b = { ...newBlock("heading"), text: "Hi", size: 22, color: "#ff0000", align: "right" as const, uppercase: true, tracking: 0.3 };
    const html = compileDesign(design([b]));
    expect(html).toContain("font-size:22px");
    expect(html).toContain("color:#ff0000");
    expect(html).toContain("text-align:right");
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("letter-spacing:0.3em");
  });

  it("renders a button as a real link", () => {
    const b = { ...newBlock("button"), text: "Track", href: "https://auspost.com.au/track" };
    const html = compileDesign(design([b]));
    expect(html).toContain('href="https://auspost.com.au/track"');
    expect(html).toContain(">Track</a>");
  });

  it("refuses a javascript: URL rather than putting it in the email", () => {
    const b = { ...newBlock("button"), text: "Bad", href: "javascript:alert(1)" };
    const html = compileDesign(design([b]));
    expect(html).not.toContain("javascript:");
    expect(html).toContain("{{site_url}}"); // falls back to our own site
  });

  it("drops an image block with no URL instead of emitting a broken tag", () => {
    expect(compileDesign(design([{ ...newBlock("image"), url: "" }]))).not.toContain("<img");
    expect(compileDesign(design([{ ...newBlock("image"), url: "https://x.test/a.jpg" }])))
      .toContain('src="https://x.test/a.jpg"');
  });

  it("escapes a subject before putting it in the title", () => {
    const html = compileDesign(defaultDesign("order_confirmation"), "<script>x</script>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("gives the shipped template its tracking block and the other its totals", () => {
    expect(compileDesign(defaultDesign("order_shipped"))).toContain("{{tracking_block}}");
    expect(compileDesign(defaultDesign("order_confirmation"))).toContain("{{subtotal}}");
  });

  it("compiles an empty design without throwing", () => {
    expect(() => compileDesign(design([]))).not.toThrow();
  });
});
