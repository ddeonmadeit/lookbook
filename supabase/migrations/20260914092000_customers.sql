-- Customers section for the dashboard.
--
-- Deliberately a view over `orders` rather than a synced table: the numbers a
-- storefront cares about (orders placed, lifetime spend, last seen) are all
-- derivable from the orders themselves, and a separate table would drift the
-- first time an order was edited or refunded from the Stripe dashboard.
--
-- People are keyed on lowercased email, which is what Stripe collects on every
-- checkout. Rows still awaiting payment carry the "(pending payment)"
-- placeholder written by create-checkout and are excluded.

CREATE OR REPLACE VIEW public.customers AS
SELECT
  lower(trim(o.customer_email))                                   AS email,
  -- Most recent non-empty name/phone/address wins: people correct their own
  -- details between orders, and the latest is the one to ship to.
  (array_agg(o.customer_name  ORDER BY o.created_at DESC)
     FILTER (WHERE nullif(trim(o.customer_name), '') IS NOT NULL))[1]  AS name,
  (array_agg(o.customer_phone ORDER BY o.created_at DESC)
     FILTER (WHERE nullif(trim(o.customer_phone), '') IS NOT NULL))[1] AS phone,
  (array_agg(o.shipping_address ORDER BY o.created_at DESC)
     FILTER (WHERE o.shipping_address IS NOT NULL))[1]                 AS shipping_address,
  (array_agg(o.shipping_city ORDER BY o.created_at DESC)
     FILTER (WHERE o.shipping_city IS NOT NULL))[1]                    AS city,
  (array_agg(o.shipping_state ORDER BY o.created_at DESC)
     FILTER (WHERE o.shipping_state IS NOT NULL))[1]                   AS state,
  (array_agg(o.shipping_postcode ORDER BY o.created_at DESC)
     FILTER (WHERE o.shipping_postcode IS NOT NULL))[1]                AS postcode,
  (array_agg(o.shipping_country ORDER BY o.created_at DESC)
     FILTER (WHERE o.shipping_country IS NOT NULL))[1]                 AS country,
  max(o.currency)                                                      AS currency,
  count(*) FILTER (WHERE o.status IN ('paid', 'fulfilled'))            AS orders_count,
  -- Lifetime spend is net of refunds, so a refunded order doesn't inflate it.
  coalesce(sum(
    CASE WHEN o.status IN ('paid', 'fulfilled', 'refunded')
      THEN o.total - coalesce(o.refunded_amount, 0) ELSE 0 END
  ), 0)                                                                AS total_spent,
  coalesce(sum(
    CASE WHEN o.status IN ('paid', 'fulfilled') THEN 1 ELSE 0 END
  ), 0)                                                                AS paid_orders,
  min(o.created_at) FILTER (WHERE o.status IN ('paid', 'fulfilled'))    AS first_order_at,
  max(o.created_at)                                                     AS last_order_at
FROM public.orders o
WHERE o.customer_email IS NOT NULL
  AND trim(o.customer_email) <> ''
  AND o.customer_email <> '(pending payment)'
  AND o.customer_email <> '(not provided)'
GROUP BY lower(trim(o.customer_email));

-- Views run with the definer's rights, so the underlying orders RLS is what
-- protects this; keep it readable only by signed-in dashboard users.
REVOKE ALL ON public.customers FROM anon;
GRANT SELECT ON public.customers TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leads: everyone who handed over a contact detail without (yet) buying.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.customer_leads AS
SELECT
  'early_access'::text            AS source,
  s.id                            AS id,
  NULL::text                      AS email,
  s.phone                         AS phone,
  NULL::text                      AS detail,
  s.created_at                    AS created_at
FROM public.phone_signups s
UNION ALL
SELECT
  'restock'::text                 AS source,
  r.id                            AS id,
  NULL::text                      AS email,
  r.phone                         AS phone,
  r.product_title                 AS detail,
  r.created_at                    AS created_at
FROM public.restock_reminders r;

REVOKE ALL ON public.customer_leads FROM anon;
GRANT SELECT ON public.customer_leads TO authenticated, service_role;
