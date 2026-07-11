-- Analytics (page views), stock tracking, and payment plumbing.

-- ---------------------------------------------------------------------------
-- Page views: lightweight self-hosted analytics for the admin dashboard.
-- No cookies, no third parties: the client generates a random session id per
-- browser session and records route changes.
-- ---------------------------------------------------------------------------
CREATE TABLE public.page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  path text NOT NULL,
  referrer text,
  device text, -- 'mobile' | 'desktop'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_views_created_at_idx ON public.page_views (created_at);
CREATE INDEX page_views_session_idx ON public.page_views (session_id);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a page view"
  ON public.page_views FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read page views"
  ON public.page_views FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Orders: payment metadata. status flows pending -> paid -> fulfilled
-- (or cancelled). Manual (no-payment) orders stay usable as before.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payment_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- ---------------------------------------------------------------------------
-- Settings: switch online payments on/off (off = current "we'll contact you"
-- checkout).
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS payments_enabled boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Stock lives inside products.variants (jsonb) as a per-variant "stock"
-- integer. This function atomically decrements stock for one variant and
-- flips the variant (and product, when everything is gone) to unavailable at
-- zero. SECURITY DEFINER so the storefront/webhook can call it without a
-- blanket UPDATE grant on products.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_stock(p_product_id uuid, p_variant_id text, p_qty integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variants jsonb;
  v_new jsonb := '[]'::jsonb;
  v_item jsonb;
  v_found boolean := false;
  v_stock integer;
  v_any_available boolean := false;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN false;
  END IF;

  SELECT variants INTO v_variants FROM products WHERE id = p_product_id FOR UPDATE;
  IF v_variants IS NULL THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_variants)
  LOOP
    IF v_item->>'id' = p_variant_id THEN
      v_found := true;
      v_stock := COALESCE((v_item->>'stock')::integer, NULL);
      IF v_stock IS NOT NULL THEN
        IF v_stock < p_qty THEN
          RETURN false; -- not enough stock
        END IF;
        v_stock := v_stock - p_qty;
        v_item := jsonb_set(v_item, '{stock}', to_jsonb(v_stock));
        v_item := jsonb_set(v_item, '{available}', to_jsonb(v_stock > 0));
      END IF;
    END IF;
    IF COALESCE((v_item->>'available')::boolean, false) THEN
      v_any_available := true;
    END IF;
    v_new := v_new || jsonb_build_array(v_item);
  END LOOP;

  IF NOT v_found THEN
    RETURN false;
  END IF;

  UPDATE products
  SET variants = v_new,
      available = v_any_available
  WHERE id = p_product_id;

  RETURN true;
END;
$$;

-- The function is called by the payment webhook (service role) and by
-- place_order below — not directly by browsers. PUBLIC must be revoked too:
-- Postgres grants EXECUTE to PUBLIC on new functions by default.
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- place_order: atomic "validate stock -> decrement -> create order" for the
-- manual (no online payment) checkout, so two buyers can't oversell the last
-- item and stock can't be drained without creating a real order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_items jsonb,           -- [{product_id, variant_id, title, variantTitle, selectedOptions, price, quantity, image}]
  p_subtotal numeric,
  p_currency text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_order_id uuid;
  v_ok boolean;
BEGIN
  IF p_customer_name IS NULL OR btrim(p_customer_name) = ''
     OR p_customer_email IS NULL OR btrim(p_customer_email) = '' THEN
    RAISE EXCEPTION 'Name and email are required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order has no items';
  END IF;

  -- Decrement stock for manual-catalog items that carry a product_id.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'product_id') IS NOT NULL THEN
      v_ok := decrement_stock(
        (v_item->>'product_id')::uuid,
        v_item->>'variant_id',
        COALESCE((v_item->>'quantity')::integer, 1)
      );
      IF NOT v_ok THEN
        RAISE EXCEPTION 'Item "%" is no longer available in the requested quantity', v_item->>'title';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO orders (items, subtotal, currency, customer_name, customer_email,
                      customer_phone, shipping_address, notes, status, payment_provider)
  VALUES (p_items, COALESCE(p_subtotal, 0), COALESCE(p_currency, 'USD'),
          btrim(p_customer_name), btrim(p_customer_email),
          NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
          NULLIF(btrim(COALESCE(p_shipping_address, '')), ''),
          NULLIF(btrim(COALESCE(p_notes, '')), ''),
          'pending', 'none')
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, numeric, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, numeric, text, text, text, text, text, text) TO anon, authenticated;
