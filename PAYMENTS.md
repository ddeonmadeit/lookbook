# Secure payments (Stripe)

The payment rails are fully built and deployed. Customers check out on
**Stripe's hosted payment page** — the industry standard used by millions of
stores:

- Card details **never touch this website** (they're entered on stripe.com's
  encrypted page), so there's nothing for an attacker to steal here.
- Prices are **re-validated server-side** on every checkout — a tampered
  browser can't change what gets charged.
- An order is only marked **paid** (and stock only decremented) when Stripe's
  signed webhook confirms the money was actually collected.

What's live already:

| Piece | Status |
|---|---|
| `create-checkout` edge function (server-validated prices + stock) | deployed |
| `stripe-webhook` edge function (marks paid, decrements stock) | deployed |
| Checkout page switches to "Pay securely" when payments are on | done |
| `/checkout/success` thank-you page | done |
| Admin → Settings → "Online payments" toggle | done |

## What only you can do: create the Stripe account

1. Sign up at **https://stripe.com** — it will ask for your business details
   and the bank account where payouts should land. (This is the legal/KYC part
   no one can do for you.)
2. Once in the Stripe Dashboard, go to **Developers → API keys** and copy the
   **Secret key** (starts `sk_live_…`, or `sk_test_…` for test mode).

## Then either

**Option A — hand me the key** (fastest): paste the secret key in chat and
I'll set both function secrets and create the webhook endpoint via Stripe's
API. (Like the Supabase token: revoke/rotate it after if you prefer — rolling
the key in the Stripe dashboard takes one click.)

**Option B — do it yourself:**

1. In the Stripe Dashboard: **Developers → Webhooks → Add endpoint**
   - Endpoint URL: `https://yutmjcyqfxekooqplcqb.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed` and `checkout.session.expired`
   - After creating it, copy the **Signing secret** (`whsec_…`).
2. In the Supabase Dashboard: **Edge Functions → Secrets** (or
   `supabase secrets set` via CLI), add:
   - `STRIPE_SECRET_KEY` = your `sk_…` key
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_…` signing secret

## Switch it on

In your admin dashboard → **Settings → Online payments → On** → Save.
Checkout immediately starts sending customers to Stripe.

## Test it before going live

Use Stripe **test mode** keys first: checkout with card number
`4242 4242 4242 4242`, any future expiry, any CVC. The order should appear in
your admin → Orders as **paid**, and the item's stock should drop. Then swap
in the live keys.
