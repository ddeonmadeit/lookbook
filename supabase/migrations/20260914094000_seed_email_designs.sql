-- Seed the two stock templates as block layouts, so the drag-and-drop designer
-- opens them ready to edit instead of offering to replace hand-written markup.
--
-- The HTML here is the compiled output of the same design, produced by
-- src/lib/emailDesign.ts, so the stored copy and the layout agree from the
-- start. Only untouched templates are rewritten: a row someone has already
-- customised keeps whatever they made.

UPDATE public.email_templates
SET design = '{"version": 1, "theme": {"background": "#faf4ef", "contentBackground": "#faf4ef", "text": "#2b1d14", "muted": "#6b5647", "faint": "#9b8878", "rule": "#e3d8cd", "accent": "#2b1d14", "accentText": "#faf4ef", "fontFamily": "Helvetica, Arial, sans-serif", "contentWidth": 520}, "blocks": [{"id": "bmu0hn3sl1", "type": "logo", "align": "center", "paddingTop": 0, "paddingBottom": 28, "width": 64}, {"id": "bmu0hn3sl2", "type": "heading", "align": "left", "paddingTop": 0, "paddingBottom": 18, "text": "Order confirmed", "size": 13, "uppercase": true, "tracking": 0.2}, {"id": "bmu0hn3sl3", "type": "text", "align": "left", "paddingTop": 0, "paddingBottom": 24, "text": "Thanks {{customer_first_name}} \u2014 we''ve got your order and we''re packing it now. You''ll get another note with tracking as soon as it ships.", "size": 13}, {"id": "bmu0hn3sl4", "type": "items", "align": "left", "paddingTop": 0, "paddingBottom": 18}, {"id": "bmu0hn3sl5", "type": "totals", "align": "left", "paddingTop": 0, "paddingBottom": 18}, {"id": "bmu0hn3sl6", "type": "address", "align": "left", "paddingTop": 0, "paddingBottom": 18}, {"id": "bmu0hn3sl7", "type": "footer", "align": "center", "paddingTop": 20, "paddingBottom": 0, "text": "Order {{order_number}} &middot; knotsss.com", "size": 11}]}'::jsonb,
    html = '<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>Your Knots order</title>
</head>
<body style="margin:0;padding:0;background:#faf4ef;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf4ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#faf4ef;font-family:Helvetica, Arial, sans-serif;color:#2b1d14;">
        <tr><td style="padding-top:0px;padding-bottom:28px;text-align:center;"><img src="{{logo_url}}" width="64" height="64" alt="Knots" style="display:block;border:0;outline:none;text-decoration:none;margin:0 auto;" /></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:13px;color:#2b1d14;text-align:left;text-transform:uppercase;letter-spacing:0.2em;line-height:1.7;">Order confirmed</div></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:24px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:13px;color:#6b5647;text-align:left;line-height:1.7;">Thanks {{customer_first_name}} — we''ve got your order and we''re packing it now. You''ll get another note with tracking as soon as it ships.</div></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;border-top:1px solid #e3d8cd;">{{items_html}}</td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;border-top:1px solid #e3d8cd;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica, Arial, sans-serif;font-size:12px;color:#6b5647;"><tr><td style="padding:3px 0;">Subtotal</td><td align="right" style="padding:3px 0;color:#2b1d14;">{{subtotal}}</td></tr><tr><td style="padding:3px 0;">Shipping &mdash; {{shipping_service}}</td><td align="right" style="padding:3px 0;color:#2b1d14;">{{shipping}}</td></tr><tr><td style="padding:9px 0 0;border-top:1px solid #e3d8cd;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#2b1d14;">Total</td><td align="right" style="padding:9px 0 0;border-top:1px solid #e3d8cd;font-size:14px;color:#2b1d14;">{{total}}</td></tr></table></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;border-top:1px solid #e3d8cd;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9b8878;padding-bottom:6px;">Shipping to</div><div style="font-family:Helvetica, Arial, sans-serif;font-size:12px;line-height:1.7;color:#6b5647;">{{shipping_address_html}}</div></td></tr>
        <tr><td style="padding-top:20px;padding-bottom:0px;border-top:1px solid #e3d8cd;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:11px;color:#9b8878;text-align:center;line-height:1.7;">Order {{order_number}} &middot; knotsss.com</div></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'
WHERE key = 'order_confirmation' AND design IS NULL;

UPDATE public.email_templates
SET design = '{"version": 1, "theme": {"background": "#faf4ef", "contentBackground": "#faf4ef", "text": "#2b1d14", "muted": "#6b5647", "faint": "#9b8878", "rule": "#e3d8cd", "accent": "#2b1d14", "accentText": "#faf4ef", "fontFamily": "Helvetica, Arial, sans-serif", "contentWidth": 520}, "blocks": [{"id": "bmu0hn3sl8", "type": "logo", "align": "center", "paddingTop": 0, "paddingBottom": 28, "width": 64}, {"id": "bmu0hn3sl9", "type": "heading", "align": "left", "paddingTop": 0, "paddingBottom": 18, "text": "On its way", "size": 13, "uppercase": true, "tracking": 0.2}, {"id": "bmu0hn3sla", "type": "text", "align": "left", "paddingTop": 0, "paddingBottom": 24, "text": "{{customer_first_name}}, your order has left us via {{shipping_service}}.", "size": 13}, {"id": "bmu0hn3slb", "type": "tracking", "align": "left", "paddingTop": 0, "paddingBottom": 22}, {"id": "bmu0hn3slc", "type": "items", "align": "left", "paddingTop": 0, "paddingBottom": 18}, {"id": "bmu0hn3sld", "type": "address", "align": "left", "paddingTop": 0, "paddingBottom": 18}, {"id": "bmu0hn3sle", "type": "footer", "align": "center", "paddingTop": 20, "paddingBottom": 0, "text": "Order {{order_number}} &middot; knotsss.com", "size": 11}]}'::jsonb,
    html = '<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>Your Knots order is on its way</title>
</head>
<body style="margin:0;padding:0;background:#faf4ef;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf4ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#faf4ef;font-family:Helvetica, Arial, sans-serif;color:#2b1d14;">
        <tr><td style="padding-top:0px;padding-bottom:28px;text-align:center;"><img src="{{logo_url}}" width="64" height="64" alt="Knots" style="display:block;border:0;outline:none;text-decoration:none;margin:0 auto;" /></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:13px;color:#2b1d14;text-align:left;text-transform:uppercase;letter-spacing:0.2em;line-height:1.7;">On its way</div></td></tr>
        <tr><td style="padding-top:0px;padding-bottom:24px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:13px;color:#6b5647;text-align:left;line-height:1.7;">{{customer_first_name}}, your order has left us via {{shipping_service}}.</div></td></tr>
        {{tracking_block}}
        <tr><td style="padding-top:0px;padding-bottom:18px;border-top:1px solid #e3d8cd;">{{items_html}}</td></tr>
        <tr><td style="padding-top:0px;padding-bottom:18px;border-top:1px solid #e3d8cd;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9b8878;padding-bottom:6px;">Shipping to</div><div style="font-family:Helvetica, Arial, sans-serif;font-size:12px;line-height:1.7;color:#6b5647;">{{shipping_address_html}}</div></td></tr>
        <tr><td style="padding-top:20px;padding-bottom:0px;border-top:1px solid #e3d8cd;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:11px;color:#9b8878;text-align:center;line-height:1.7;">Order {{order_number}} &middot; knotsss.com</div></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'
WHERE key = 'order_shipped' AND design IS NULL;
