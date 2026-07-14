-- Separate grid layout order from the user-facing display number. "sort_order"
-- stays exactly what it was (the fixed 001/002/... product number, set once per
-- product and otherwise untouched). "position" is a new, independent field that
-- drag-and-drop reordering and preset sorts (price high/low, etc.) can freely
-- rewrite in the admin dashboard without ever disturbing the numbering scheme.
ALTER TABLE public.products ADD COLUMN position integer NOT NULL DEFAULT 0;

-- Backfill: preserve the exact current storefront order (same ORDER BY the
-- storefront already uses) as the initial position values.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY sort_order ASC, created_at ASC) AS rn
  FROM public.products
)
UPDATE public.products
SET position = ordered.rn
FROM ordered
WHERE products.id = ordered.id;

CREATE INDEX IF NOT EXISTS products_position_idx ON public.products (position);
