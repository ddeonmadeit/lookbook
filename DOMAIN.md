# Connecting knotsss.com (GoDaddy → GitHub Pages)

The site is built and deployed to GitHub Pages with `knotsss.com` set as its
custom domain (see `public/CNAME`). The only remaining step is pointing your
GoDaddy DNS at GitHub — I can't do this part; it requires logging into your
GoDaddy account.

## What to add in GoDaddy (DNS → knotsss.com → DNS Management)

**Apex domain (`knotsss.com`) — four A records:**

| Type | Name | Value |
|------|------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

GoDaddy usually ships a default `@` A record pointing at a parking page —
edit that one to the first IP above, then add three more `@` A records for
the rest. (If GoDaddy only allows one `@` A record in your account's UI,
delete the default first, then add all four.)

**`www` subdomain — one CNAME record** (recommended, so `www.knotsss.com`
also resolves):

| Type | Name | Value |
|------|------|-------|
| CNAME | www | ddeonmadeit.github.io |

## After saving DNS changes

1. DNS propagation is usually fast (minutes) but can take up to a few hours
   depending on GoDaddy/ISP caching.
2. Once `knotsss.com` resolves to GitHub's IPs, check
   **github.com/ddeonmadeit/lookbook → Settings → Pages**: it should show
   "knotsss.com" as the custom domain with a green "DNS check successful"
   status, and an **Enforce HTTPS** checkbox that becomes available once
   GitHub issues the certificate (can take up to ~1 hour after DNS
   verifies). Turn that on once it appears.
3. Once live: `https://knotsss.com` shows the AW26 countdown page, and
   `https://knotsss.com/admin` is your dashboard (products, orders, early
   access signups, and the site-visibility toggle).

## Note on the old preview link

`https://ddeonmadeit.github.io/lookbook/` no longer renders correctly — the
build now targets the custom domain's root path instead of that `/lookbook/`
subpath, which was necessary for `knotsss.com` to work correctly. There's no
usable preview link until DNS above is set up; after that, `knotsss.com` (or
`www.knotsss.com`) is the real one.
