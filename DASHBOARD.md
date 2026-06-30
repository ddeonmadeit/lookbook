# Backend Product Dashboard

This storefront can source products two ways:

- **Manual** (default) — you add/manage products yourself in an admin dashboard,
  backed by Supabase. Checkout records orders for you to fulfil.
- **Shopify** — the storefront pulls products from the Shopify Storefront API and
  uses Shopify's hosted checkout (the original behaviour).

You switch between them in the dashboard (**Settings → Product source**). It ships
set to **manual**, so Shopify is optional and off by default.

## How it works

- `src/lib/products.ts` is a single product source used by the storefront. It
  reads the active source from `store_settings` and returns products in the same
  shape regardless of source, so the storefront UI is unchanged.
- `src/stores/settingsStore.ts` loads/saves store settings (source + Shopify
  connection).
- Manual products, store settings, and orders live in Supabase
  (`supabase/migrations/20260630120000_manual_products_dashboard.sql`).
- The cart (`src/stores/cartStore.ts`) is source-aware: in manual mode it's a
  local cart and checkout goes to `/checkout`; in Shopify mode it uses Shopify's
  cart + checkout.

## One-time setup

1. **Apply the database migration** to your Supabase project. Either:
   - Supabase CLI: `supabase db push`, or
   - Paste the SQL from
     `supabase/migrations/20260630120000_manual_products_dashboard.sql` into the
     Supabase SQL editor and run it.

   This creates the `products`, `store_settings`, and `orders` tables (with row
   level security), seeds the settings row to `manual`, and creates a public
   `product-images` storage bucket.

2. **Create your admin account.** In the Supabase dashboard go to
   **Authentication → Users → Add user**, and create your owner email/password.

3. **Disable public sign-ups** so nobody else can reach the dashboard:
   **Authentication → Providers → Email → turn off "Allow new users to sign up"**.
   (RLS already restricts all product/settings/order writes to authenticated
   users; disabling sign-ups means only accounts you create can write.)

## Using the dashboard

Go to `/admin` (you'll be redirected to `/admin/login` if signed out).

- **Products** — add, edit, delete products. Each product has a title, handle,
  price, description, images (paste a URL or upload a file to Supabase Storage),
  and optional options like Size/Color (comma-separated values). Variants are
  generated automatically from the options. Toggle **In stock** to mark a product
  sold out.
- **Orders** — every manual checkout shows up here with the customer's details
  and items.
- **Settings** — switch between Manual and Shopify, and enter Shopify connection
  details (store domain, Storefront access token, API version) if/when you want
  to use Shopify.

## Switching to Shopify later

In **Settings**, set product source to **Shopify** and fill in your store domain,
Storefront access token, and API version, then save. The storefront immediately
starts reading products from Shopify and checkout switches to Shopify's hosted
checkout. Switch back to **Manual** at any time.

## Notes

- The Supabase publishable (anon) key in `.env` is a public client key by design;
  data is protected by row level security, not by hiding the key.
- Manual checkout does not process payment — it records the order and tells the
  customer you'll reach out to arrange payment/shipping. Wire in a payment
  provider later if you need online payment.
