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

## NYE tickets (knotsss.com/nye)

An unlisted page selling entry to the New Year's Eve rooftop party (175
Cathedral St, Woolloomooloo, 6pm–1am): nothing links to it, search engines are
told not to list it, and its only link goes back to the countdown.

Three releases, sold in order: **first release $15 (34 tickets)**, **second
release $20 (33)**, then **final release $30 (33)** — each opens once the one
before sells out. An order that crosses over is split (3 tickets with one $15
left = 1 × $15 + 2 × $20), and the buyer sees the exact split before paying.
The page never shows — or is even sent — how many tickets there are or how
many are left: just each release's price and whether it's on sale, still to
come, or sold out. Buyers can take as many as they like in one order (up to
every ticket there is); sales close at midnight. Releases,
prices and sizes live at the top of `supabase/functions/nye-tickets/index.ts`
(the dashboard's copy of the sizes is in `NyeTicketsPanel.tsx`); the wording
on the page in `src/lib/nye.ts`.

- Buyers pay inside the page with the same embedded Stripe form as the store —
  card, Apple Pay or Google Pay, no address, no shipping.
- **Apple Pay / Google Pay** show in the payment form only on a domain
  registered with Stripe. `nye-tickets` registers knotsss.com (and www) itself
  the first time it runs — Stripe then handles Apple's verification — and
  the dashboard's NYE panel says when Apple Pay is ready. Apple Pay must also
  be switched on in Stripe → Settings → Payment methods (it is by default).
- Places are held while someone pays (30 minutes, or until they close the
  form), so two people can never buy the last ticket.
- Each ticket is an order (marked as a ticket), so buyers land in Contacts and
  refunds work as usual, but tickets stay out of the store's order list and the
  "to ship" badge. **Orders → NYE tickets** shows sales, the guest list (CSV
  export) and a check-in button for the door.
- The store's `stripe-webhook` ignores ticket payments; `nye-tickets` asks
  Stripe directly and records them. If Resend is set up, the buyer also gets a
  ticket email.

**Marking releases sold out by hand:** `public/nye/controls.json` lists
releases to switch off (`"sold_out": ["first"]`), or `"all_sold_out": true`
for everything. A switched-off release shows as sold out and can't be bought,
however many are left, and the next one goes on sale. Push the change to the
live branch and it applies within about a minute (the function re-reads it
every 15 seconds; if the site can't be reached it keeps the last switches it
saw). The switches can only stop sales — prices and sizes stay in the
function — so the file can never make a ticket cheaper. The dashboard's NYE
panel shows what's switched off.

**Switching it on:** deploy the `nye-tickets` function once. The dashboard
walks you through it (Orders → NYE tickets → Copy code → paste into Supabase →
Deploy), or with the CLI: `supabase functions deploy nye-tickets`. It uses the
Stripe keys already set for the store.

**The flyer** is an animated image, `src/assets/nye/flyer.webp`, so it loops
forever exactly like a GIF: no autoplay rules, never paused by Low Power Mode
or switching apps, never a play button. `flyer-poster.jpg` shows while it
loads. To swap the flyer, make a new animated WebP from the video (810×1080,
24 fps, e.g. `ffmpeg -i flyer.mp4 -an -vf "fps=24,scale=810:1080" -c:v
libwebp_anim -loop 0 -quality 82 flyer.webp`), replace those two files and
`public/nye/og.png`, the link preview.

**The rooftop clip** under the tickets is `src/assets/nye/rooftop.mp4` (silent,
720 px wide, 30 fps, ~750 KB), downloaded into memory as soon as the page has
loaded so it plays the moment anyone scrolls to it; the store's loading spinner
(`src/assets/loading-spinner.gif`, turned bone) shows over the dimmed
`rooftop-poster.jpg` until it's ready. Phones that won't play video by
themselves (iPhone Low Power Mode, some in-app browsers) get the same clip as
30 fps stills drawn on a canvas by the clock (`rooftop-frames.bin`: WebP stills
back to back), so it always runs at true speed (an animated image would play in
slow motion on a throttled phone); the first tap anywhere on the page switches
them to the real video. To swap the clip, replace all three: e.g.
`ffmpeg -i clip.mov -an -vf "fps=30,scale=720:-2" -c:v libx264 -crf 28 -preset
veryslow -movflags +faststart rooftop.mp4`; for the stills,
`ffmpeg -i rooftop.mp4 -vf "fps=30,scale=540:-2" -c:v libwebp -quality 72 f%04d.webp`
then `cat f*.webp > rooftop-frames.bin`. Playing a clip from memory needs
`media-src 'self' blob:` in the CSP in `index.html`.
