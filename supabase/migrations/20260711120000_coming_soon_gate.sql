-- "Coming soon" gate for the AW26 countdown/early-access landing page, and a
-- table to collect early-access phone signups (replaces the standalone
-- knots-aw26 Node/SQLite app's /submit + /dash flow with Supabase-backed
-- storage viewable from the existing admin dashboard).

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS site_mode text NOT NULL DEFAULT 'coming_soon'
    CHECK (site_mode IN ('coming_soon', 'live'));

-- Ensure the existing singleton settings row starts gated.
UPDATE public.store_settings SET site_mode = 'coming_soon' WHERE id = 1;

CREATE TABLE public.phone_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit their phone number"
  ON public.phone_signups FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read phone signups"
  ON public.phone_signups FOR SELECT
  TO authenticated
  USING (true);
