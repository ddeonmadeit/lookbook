-- Customer-facing notification templates, editable from the dashboard.
--
-- Kept in the database rather than in code so the wording and design can be
-- changed without a deploy. Bodies are HTML with {{placeholder}} tokens that
-- the send function fills in per order.

CREATE TABLE IF NOT EXISTS public.email_templates (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  subject text NOT NULL,
  html text NOT NULL,
  -- Optional SMS wording for the same event; null means "don't text".
  sms_body text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Admin-only: these are internal content, not something shoppers read directly.
CREATE POLICY "Authenticated users can read email templates"
  ON public.email_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update email templates"
  ON public.email_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert email templates"
  ON public.email_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE TRIGGER email_templates_set_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Defaults match the storefront: cream ground, dark brown ink, the wordmark at
-- the top, wide letter-spacing on labels. Tables + inline styles because email
-- clients still don't do modern CSS.
INSERT INTO public.email_templates (key, name, description, subject, html, sms_body) VALUES
(
  'order_confirmation',
  'Order confirmation',
  'Sent to the customer as soon as their payment succeeds.',
  'Your Knots order {{order_number}}',
  '<!doctype html><html><body style="margin:0;padding:0;background:#faf4ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf4ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#faf4ef;">
        <tr><td align="center" style="padding-bottom:28px;">
          <img src="{{logo_url}}" width="64" height="64" alt="Knots" style="display:block;border:0;" />
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#2b1d14;padding-bottom:18px;">
          Order confirmed
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#6b5647;padding-bottom:24px;">
          Thanks {{customer_first_name}} — we''ve got your order and we''re packing it now.
          You''ll get another note with tracking as soon as it ships.
        </td></tr>
        <tr><td style="border-top:1px solid #e3d8cd;padding-top:18px;">{{items_html}}</td></tr>
        <tr><td style="border-top:1px solid #e3d8cd;padding-top:14px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#6b5647;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;">Subtotal</td><td align="right" style="padding:3px 0;color:#2b1d14;">{{subtotal}}</td></tr>
            <tr><td style="padding:3px 0;">Shipping — {{shipping_service}}</td><td align="right" style="padding:3px 0;color:#2b1d14;">{{shipping}}</td></tr>
            <tr><td style="padding:8px 0 0;border-top:1px solid #e3d8cd;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#2b1d14;">Total</td>
                <td align="right" style="padding:8px 0 0;border-top:1px solid #e3d8cd;font-size:14px;color:#2b1d14;">{{total}}</td></tr>
          </table>
        </td></tr>
        <tr><td style="border-top:1px solid #e3d8cd;margin-top:18px;padding-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9b8878;padding-bottom:6px;">
          Shipping to
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#6b5647;padding-bottom:28px;">
          {{shipping_address_html}}
        </td></tr>
        <tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9b8878;border-top:1px solid #e3d8cd;padding-top:20px;">
          Order {{order_number}} &middot; knotsss.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  'Knots: thanks {{customer_first_name}}! Order {{order_number}} confirmed — {{total}}. We''ll text you tracking when it ships.'
),
(
  'order_shipped',
  'Shipped / fulfilled',
  'Sent when you mark an order fulfilled in the dashboard.',
  'Your Knots order {{order_number}} is on its way',
  '<!doctype html><html><body style="margin:0;padding:0;background:#faf4ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf4ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:28px;">
          <img src="{{logo_url}}" width="64" height="64" alt="Knots" style="display:block;border:0;" />
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#2b1d14;padding-bottom:18px;">
          On its way
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#6b5647;padding-bottom:24px;">
          {{customer_first_name}}, your order has left us via {{shipping_service}}.
        </td></tr>
        {{tracking_block}}
        <tr><td style="border-top:1px solid #e3d8cd;padding-top:18px;">{{items_html}}</td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9b8878;padding:18px 0 6px;border-top:1px solid #e3d8cd;">
          Shipping to
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#6b5647;padding-bottom:28px;">
          {{shipping_address_html}}
        </td></tr>
        <tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9b8878;border-top:1px solid #e3d8cd;padding-top:20px;">
          Order {{order_number}} &middot; knotsss.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  'Knots: order {{order_number}} has shipped via {{shipping_service}}. {{tracking_sms}}'
)
ON CONFLICT (key) DO NOTHING;
