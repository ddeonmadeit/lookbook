-- Flat-rate shipping, calculated at checkout (Stripe shipping_options) instead
-- of being handled over email. NULL threshold means free shipping is never
-- auto-applied; 0 means always free.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS shipping_flat_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_shipping_threshold numeric;
