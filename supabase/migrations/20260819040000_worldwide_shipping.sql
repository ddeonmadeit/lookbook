-- Weight-based worldwide shipping calculated from Sydney, plus the order
-- fulfilment/refund fields the dashboard needs.
--
-- Rates live in a table (not in code) so they can be corrected from the
-- dashboard whenever Australia Post changes its pricing, without a redeploy.

-- ---------------------------------------------------------------------------
-- Per-product shipping weight. 0 means "unknown" and falls back to the
-- store-wide default so a product without a weight still quotes sensibly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_grams integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Store-wide shipping settings. handling_fee is added on top of every quote
-- (packaging, insurance, transaction overhead).
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS shipping_handling_fee numeric NOT NULL DEFAULT 8.40,
  ADD COLUMN IF NOT EXISTS default_item_weight_grams integer NOT NULL DEFAULT 400;

UPDATE public.store_settings SET shipping_handling_fee = 8.40 WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Carrier rate card: one row per (zone, weight tier). A quote picks the
-- cheapest tier whose max_weight_grams covers the parcel, then adds the
-- handling fee. Zones follow Australia Post's international zoning.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text NOT NULL CHECK (zone IN ('AU', 'NZ', 'ASIA', 'NA_ME', 'ROW')),
  max_weight_grams integer NOT NULL CHECK (max_weight_grams > 0),
  price numeric NOT NULL CHECK (price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone, max_weight_grams)
);

ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

-- Readable by shoppers (it is a public price list, like product prices);
-- only the admin can change it.
CREATE POLICY "Shipping rates are publicly readable"
  ON public.shipping_rates FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert shipping rates"
  ON public.shipping_rates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update shipping rates"
  ON public.shipping_rates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shipping rates"
  ON public.shipping_rates FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER shipping_rates_set_updated_at
  BEFORE UPDATE ON public.shipping_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed: indicative Australia Post rates ex-Sydney in AUD — domestic Parcel
-- Post, and International Standard (tracked) for the four overseas zones.
-- Verify against auspost.com.au and correct in the dashboard as needed.
INSERT INTO public.shipping_rates (zone, max_weight_grams, price) VALUES
  ('AU',      500,  10.95),
  ('AU',     1000,  12.70),
  ('AU',     2000,  15.10),
  ('AU',     5000,  20.65),
  ('AU',    10000,  27.75),
  ('AU',    20000,  38.20),

  ('NZ',      500,  16.85),
  ('NZ',     1000,  21.60),
  ('NZ',     2000,  30.60),
  ('NZ',     5000,  57.60),
  ('NZ',    10000, 100.10),
  ('NZ',    20000, 185.10),

  ('ASIA',    500,  21.55),
  ('ASIA',   1000,  29.20),
  ('ASIA',   2000,  44.35),
  ('ASIA',   5000,  89.85),
  ('ASIA',  10000, 165.35),
  ('ASIA',  20000, 316.35),

  ('NA_ME',   500,  27.20),
  ('NA_ME',  1000,  38.65),
  ('NA_ME',  2000,  60.20),
  ('NA_ME',  5000, 124.85),
  ('NA_ME', 10000, 233.60),
  ('NA_ME', 20000, 451.10),

  ('ROW',     500,  30.75),
  ('ROW',    1000,  45.05),
  ('ROW',    2000,  72.45),
  ('ROW',    5000, 154.65),
  ('ROW',   10000, 291.65),
  ('ROW',   20000, 565.65)
ON CONFLICT (zone, max_weight_grams) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Orders: what was actually charged for shipping, plus fulfilment and refund
-- tracking so the dashboard can run the whole post-purchase flow.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_country text,
  ADD COLUMN IF NOT EXISTS total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_carrier text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Backfill total for pre-existing orders (they had no separate shipping).
UPDATE public.orders SET total = subtotal WHERE total = 0 AND subtotal > 0;
