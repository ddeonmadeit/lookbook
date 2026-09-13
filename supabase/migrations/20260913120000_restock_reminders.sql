-- "Remind me" phone captures from sold-out product pages.
--
-- Kept separate from phone_signups (the AW26 early-access list) because these
-- are per-product restock requests, not a general mailing list — mixing them
-- would make both lists useless.

CREATE TABLE IF NOT EXISTS public.restock_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored as text, not a FK: the storefront can run off Shopify ids too, and
  -- a reminder should outlive the product row being edited or replaced.
  product_id text,
  product_handle text NOT NULL,
  product_title text NOT NULL,
  phone text NOT NULL,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One reminder per person per product; re-submitting is a no-op, not a dupe.
  UNIQUE (product_handle, phone)
);

CREATE INDEX IF NOT EXISTS restock_reminders_handle_idx
  ON public.restock_reminders (product_handle);

ALTER TABLE public.restock_reminders ENABLE ROW LEVEL SECURITY;

-- Shoppers can only add themselves; the list itself is admin-only.
CREATE POLICY "Anyone can request a restock reminder"
  ON public.restock_reminders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read restock reminders"
  ON public.restock_reminders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update restock reminders"
  ON public.restock_reminders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete restock reminders"
  ON public.restock_reminders FOR DELETE
  TO authenticated
  USING (true);
