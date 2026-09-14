# Order emails and texts

Customers get an email (and optionally a text) when they pay, and again when
you mark the order fulfilled. Both are edited in **Dashboard → Settings →
Automatic emails & texts**, either by dragging blocks around or by writing the
HTML directly.

---

## 1. Making the emails land in the inbox, not spam or Promotions

The HTML side is already handled — every send is a complete document with a
charset, viewport, colour-scheme and format-detection meta tags, a real
`text/plain` alternative, a preheader, a reply-to address and transactional
headers. **None of that matters if the domain isn't authenticated.** That part
needs DNS records only you can add.

### Set up the sending domain (required)

1. In [Resend](https://resend.com) → **Domains** → **Add Domain**, enter
   `knotsss.com`.
2. Resend shows three records. Add all of them at your DNS host:

   | Type | Purpose | Notes |
   |------|---------|-------|
   | `TXT` (`send.knotsss.com`) | **SPF** | Authorises Resend to send as you |
   | `TXT` (`resend._domainkey`) | **DKIM** | Cryptographically signs each mail |
   | `MX` (`send.knotsss.com`) | Bounce handling | Feedback loop for failures |

3. Wait for Resend to show the domain as **Verified** (usually minutes, up to
   a few hours).
4. Add a **DMARC** record yourself — Resend doesn't create this one, and Gmail
   and Yahoo both now require it:

   ```
   Host:  _dmarc.knotsss.com
   Type:  TXT
   Value: v=DMARC1; p=none; rua=mailto:dmarc@knotsss.com
   ```

   Start at `p=none` (monitor only). Once you've seen a week of clean reports,
   tighten to `p=quarantine`, and later `p=reject`.

### Then set the secrets

In Supabase → Project Settings → **Edge Functions → Secrets**:

| Secret | Example | Notes |
|--------|---------|-------|
| `RESEND_API_KEY` | `re_…` | From Resend → API Keys |
| `ORDER_FROM_EMAIL` | `Knots <orders@knotsss.com>` | **Must** be on the verified domain |
| `ORDER_REPLY_TO` | `Knots <hello@knotsss.com>` | A mailbox you actually read |

Until `ORDER_FROM_EMAIL` is set, mail goes out from Resend's shared
`onboarding@resend.dev` domain, which is not authenticated as you and will be
filtered. The dashboard says so when you fulfil an order.

### Why these land in Primary rather than Promotions

Gmail sorts on content and behaviour, not a setting you can toggle. What keeps
a receipt in Primary:

- **It's specific to one person.** Their name, their order number, their
  address, their items. Already the case.
- **No marketing furniture.** No "unsubscribe" footer, no discount codes, no
  banner images, no social icons. If you add a promotional block to the
  confirmation email, expect it to move to Promotions — keep that content for a
  separate newsletter.
- **Text outweighs images.** Keep at least a few lines of real text per image.
  An image-only email is the single strongest spam signal there is.
- **Links point at your own domain.** Avoid link shorteners entirely.
- **The subject describes the transaction.** "Your Knots order KN-3F9A12C4",
  not "Thanks for shopping with us 🎉". Emoji, ALL CAPS and "free" in a subject
  line all push toward Promotions.

### Check it before you rely on it

Send yourself a real order, then:

- Open the mail in Gmail → ⋮ → **Show original**. You want `SPF: PASS`,
  `DKIM: PASS`, `DMARC: PASS`.
- Paste the same mail into [mail-tester.com](https://www.mail-tester.com) for a
  score out of 10. Anything below 8 has a named reason attached.

---

## 2. Texts (optional)

Set these three secrets to turn SMS on; leave them unset and the SMS half is
skipped with a reason instead of failing:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (E.164, e.g. `+61480000000`)

Australian numbers need sender registration before Twilio will deliver to
local handsets — check Twilio's current AU requirements.

---

## 3. The designer

**Design** builds the email from blocks: drag to reorder, click to style,
and a live preview updates with sample order details.

**HTML** is the same email as raw markup. Editing here detaches the block
layout (the designer then offers to rebuild it), so hand-written markup is
never silently overwritten.

Blocks available: logo, heading, text, order items, totals, shipping address,
tracking, button, image, divider, spacer, footer.

### Placeholders

Anything in `{{double braces}}` is filled per order:

`logo_url`, `site_url`, `order_number`, `customer_name`,
`customer_first_name`, `customer_email`, `customer_phone`, `items_html`,
`items_text`, `subtotal`, `shipping`, `total`, `shipping_service`,
`shipping_address_html`, `shipping_address_text`, `tracking_number`,
`tracking_carrier`, `tracking_block`, `tracking_sms`.

`tracking_block` renders nothing until the order has a tracking number, so it's
safe to leave in a template permanently.

### Fonts

Only fonts already installed on the reader's device. Email clients don't load
web fonts reliably, so the designer offers the handful that are safe everywhere.
