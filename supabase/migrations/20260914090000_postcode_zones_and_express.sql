-- Domestic shipping priced by destination postcode rather than just "Australia",
-- plus a Standard/Express choice on every zone.
--
-- Australia Post prices a domestic parcel on the origin→destination postcode
-- pair, so a Sydney→Newtown parcel is not the same price as Sydney→Broome.
-- City names don't determine postage (and aren't unique), so the postcode is
-- what we resolve a zone from.

-- ---------------------------------------------------------------------------
-- Service level. Existing rows are the standard service.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shipping_rates
  ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT 'standard';

ALTER TABLE public.shipping_rates
  DROP CONSTRAINT IF EXISTS shipping_rates_service_check;
ALTER TABLE public.shipping_rates
  ADD CONSTRAINT shipping_rates_service_check CHECK (service IN ('standard', 'express'));

-- ---------------------------------------------------------------------------
-- Zones: the single "AU" bucket becomes four postcode-derived zones.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shipping_rates
  DROP CONSTRAINT IF EXISTS shipping_rates_zone_check;

-- Clear the old flat "AU" rows first: they're superseded by the four postcode
-- zones below, and would fail the new constraint.
DELETE FROM public.shipping_rates WHERE zone = 'AU';

ALTER TABLE public.shipping_rates
  ADD CONSTRAINT shipping_rates_zone_check
  CHECK (zone IN ('AU_SYD', 'AU_NSW', 'AU_INTER', 'AU_REMOTE', 'NZ', 'ASIA', 'NA_ME', 'ROW'));

-- One rate per zone + weight tier + service.
ALTER TABLE public.shipping_rates
  DROP CONSTRAINT IF EXISTS shipping_rates_zone_max_weight_grams_key;
ALTER TABLE public.shipping_rates
  DROP CONSTRAINT IF EXISTS shipping_rates_zone_weight_service_key;
ALTER TABLE public.shipping_rates
  ADD CONSTRAINT shipping_rates_zone_weight_service_key
  UNIQUE (zone, max_weight_grams, service);

-- ---------------------------------------------------------------------------
-- Rate card: indicative Australia Post prices ex-Sydney, in AUD.
--   AU_SYD    Sydney metro            AU_NSW     rest of NSW + ACT
--   AU_INTER  VIC/QLD/SA/TAS          AU_REMOTE  WA + NT
-- Domestic = Parcel Post / Express Post. International = International
-- Standard / International Express. Verify at auspost.com.au and correct in
-- the dashboard — these are a starting point, not gospel.
-- ---------------------------------------------------------------------------
INSERT INTO public.shipping_rates (zone, max_weight_grams, price, service) VALUES
  -- Sydney metro — standard
  ('AU_SYD',     500,   9.70, 'standard'),
  ('AU_SYD',    1000,  11.20, 'standard'),
  ('AU_SYD',    2000,  13.40, 'standard'),
  ('AU_SYD',    5000,  17.80, 'standard'),
  ('AU_SYD',   10000,  24.30, 'standard'),
  ('AU_SYD',   20000,  33.60, 'standard'),
  -- Sydney metro — express
  ('AU_SYD',     500,  13.90, 'express'),
  ('AU_SYD',    1000,  16.10, 'express'),
  ('AU_SYD',    2000,  19.30, 'express'),
  ('AU_SYD',    5000,  25.60, 'express'),
  ('AU_SYD',   10000,  35.00, 'express'),
  ('AU_SYD',   20000,  48.40, 'express'),

  -- Rest of NSW + ACT — standard
  ('AU_NSW',     500,  10.95, 'standard'),
  ('AU_NSW',    1000,  12.70, 'standard'),
  ('AU_NSW',    2000,  15.10, 'standard'),
  ('AU_NSW',    5000,  20.65, 'standard'),
  ('AU_NSW',   10000,  27.75, 'standard'),
  ('AU_NSW',   20000,  38.20, 'standard'),
  -- Rest of NSW + ACT — express
  ('AU_NSW',     500,  15.60, 'express'),
  ('AU_NSW',    1000,  18.30, 'express'),
  ('AU_NSW',    2000,  21.70, 'express'),
  ('AU_NSW',    5000,  29.70, 'express'),
  ('AU_NSW',   10000,  39.90, 'express'),
  ('AU_NSW',   20000,  55.00, 'express'),

  -- VIC / QLD / SA / TAS — standard
  ('AU_INTER',   500,  12.30, 'standard'),
  ('AU_INTER',  1000,  15.10, 'standard'),
  ('AU_INTER',  2000,  19.20, 'standard'),
  ('AU_INTER',  5000,  27.40, 'standard'),
  ('AU_INTER', 10000,  39.60, 'standard'),
  ('AU_INTER', 20000,  58.40, 'standard'),
  -- VIC / QLD / SA / TAS — express
  ('AU_INTER',   500,  17.50, 'express'),
  ('AU_INTER',  1000,  21.70, 'express'),
  ('AU_INTER',  2000,  27.60, 'express'),
  ('AU_INTER',  5000,  39.40, 'express'),
  ('AU_INTER', 10000,  57.00, 'express'),
  ('AU_INTER', 20000,  84.10, 'express'),

  -- WA / NT — standard
  ('AU_REMOTE',   500, 14.50, 'standard'),
  ('AU_REMOTE',  1000, 18.60, 'standard'),
  ('AU_REMOTE',  2000, 24.80, 'standard'),
  ('AU_REMOTE',  5000, 36.20, 'standard'),
  ('AU_REMOTE', 10000, 54.80, 'standard'),
  ('AU_REMOTE', 20000, 82.50, 'standard'),
  -- WA / NT — express
  ('AU_REMOTE',   500, 20.60, 'express'),
  ('AU_REMOTE',  1000, 26.70, 'express'),
  ('AU_REMOTE',  2000, 35.60, 'express'),
  ('AU_REMOTE',  5000, 52.00, 'express'),
  ('AU_REMOTE', 10000, 78.90, 'express'),
  ('AU_REMOTE', 20000, 118.80, 'express'),

  -- International Express (standard rows already exist from the first seed)
  ('NZ',     500,  28.65, 'express'),
  ('NZ',    1000,  36.70, 'express'),
  ('NZ',    2000,  52.00, 'express'),
  ('NZ',    5000,  97.90, 'express'),
  ('NZ',   10000, 170.20, 'express'),
  ('NZ',   20000, 314.70, 'express'),

  ('ASIA',   500,  36.65, 'express'),
  ('ASIA',  1000,  49.65, 'express'),
  ('ASIA',  2000,  75.40, 'express'),
  ('ASIA',  5000, 152.75, 'express'),
  ('ASIA', 10000, 281.10, 'express'),
  ('ASIA', 20000, 537.80, 'express'),

  ('NA_ME',   500,  46.25, 'express'),
  ('NA_ME',  1000,  65.70, 'express'),
  ('NA_ME',  2000, 102.35, 'express'),
  ('NA_ME',  5000, 212.25, 'express'),
  ('NA_ME', 10000, 397.10, 'express'),
  ('NA_ME', 20000, 766.90, 'express'),

  ('ROW',   500,  52.30, 'express'),
  ('ROW',  1000,  76.60, 'express'),
  ('ROW',  2000, 123.15, 'express'),
  ('ROW',  5000, 262.90, 'express'),
  ('ROW', 10000, 495.80, 'express'),
  ('ROW', 20000, 961.60, 'express')
ON CONFLICT (zone, max_weight_grams, service) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Orders: which service the customer actually chose, and their postcode, so
-- the packing slip has everything needed to ship.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_postcode text,
  ADD COLUMN IF NOT EXISTS shipping_city text,
  ADD COLUMN IF NOT EXISTS shipping_state text,
  ADD COLUMN IF NOT EXISTS shipping_line1 text,
  ADD COLUMN IF NOT EXISTS shipping_line2 text,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
