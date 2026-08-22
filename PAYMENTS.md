# Payments & shipping

Checkout now runs **entirely on knotsss.com**. Stripe's payment form is
embedded in our own checkout page — the shopper is never redirected to
stripe.com and never has to complete anything by email.

The flow:

1. Shopper picks a delivery country on our checkout page.
2. We quote real shipping from Sydney (see below) and show
   subtotal / shipping / total before they commit.
3. They pay inline. Card details go straight to Stripe — they never touch our
   servers.
4. Stripe's signed webhook marks the order paid and decrements stock.

Prices, weights and the shipping charge are all recalculated server-side, so a
tampered browser can't change what it gets charged.

## What's live already

| Piece | Status |
|---|---|
| Weight + destination based shipping (`shipping-quote`) | deployed |
| `create-checkout` — embedded Stripe session, server-priced | deployed |
| `checkout-status` — confirms payment before we claim success | deployed |
| `stripe-webhook` — marks paid, decrements stock, mirrors refunds | deployed |
| `refund-order` — refund from the dashboard (admin only) | deployed |
| Shipping rate card + handling fee, editable in Settings | deployed |
| Order fulfilment: tracking, search, CSV export, refunds | deployed |

## What only you can do: connect Stripe

Until this is done, checkout falls back to the old "we'll contact you" order
form. Nothing else breaks.

1. Sign up at **https://stripe.com** and complete the business/bank details.
2. **Developers → API keys** — copy both:
   - **Publishable key** (`pk_live_…` / `pk_test_…`)
   - **Secret key** (`sk_live_…` / `sk_test_…`)
3. **Developers → Webhooks → Add endpoint**
   - URL: `https://yutmjcyqfxekooqplcqb.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`,
     `charge.refunded`
   - Copy the **signing secret** (`whsec_…`).
4. In the Supabase dashboard → **Edge Functions → Secrets**, add all three:
   - `STRIPE_SECRET_KEY` = `sk_…`
   - `STRIPE_PUBLISHABLE_KEY` = `pk_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…`
5. Dashboard → **Settings → Online payments → On** → Save.

Test with card `4242 4242 4242 4242` (any future expiry/CVC) in test mode
first: the order should appear under Orders as **paid**, with the shipping
amount broken out, and stock should drop.

To match the site's look, set your brand colours under Stripe Dashboard →
**Settings → Branding** — that's what the embedded form uses.

## Shipping

Shipping is priced per parcel from **destination zone × total weight**, then
the **handling fee** is added on top.

- **Zones** follow Australia Post: Australia, New Zealand, Asia & Pacific,
  North America & Middle East, Rest of world.
- **Weight** is the sum of each product's *Shipping weight (g)* × quantity.
  Products without a weight use the *Default item weight* from Settings.
- **Handling fee** defaults to **$8.40** and is added once per order.
- Parcels heavier than the largest tier are billed as multiple parcels.
- Set *Free over ($)* to give free shipping above a subtotal.

### The rate card

Seeded with **indicative Australia Post rates ex-Sydney** — domestic Parcel
Post and International Standard (tracked). Every cell is editable in
**Settings → Rate card**, so correct them against
[auspost.com.au](https://auspost.com.au/business/shipping/compare-postage-options)
before going live, and whenever Australia Post reprices. No redeploy needed.

Worked example with the seeded rates, a 400 g cap:

| Destination | Carrier | + handling | Charged |
|---|---|---|---|
| Australia | $10.95 | $8.40 | **$19.35** |
| New Zealand | $16.85 | $8.40 | **$25.25** |
| Japan | $21.55 | $8.40 | **$29.95** |
| United States | $27.20 | $8.40 | **$35.60** |
| United Kingdom | $30.75 | $8.40 | **$39.15** |

**Set a weight on every product** (Products → edit → Shipping weight). Until
you do, everything quotes at the 400 g default, which will undercharge on
heavier items like jackets and jeans.

If you'd rather pull live rates straight from Australia Post instead of a rate
card, that needs an AusPost developer API key — the quote function is written
so only its price lookup would need swapping.
