# Deploying for free

This app is a **static Vite SPA** (the frontend) plus **Supabase** (database,
admin auth, image storage). So a live site needs two free things:

1. Your own **Supabase project** (the backend).
2. A **static host** for the frontend.

Total cost: $0.

> Why not Railway alone? Railway has no built-in auth/storage, so you'd still
> need Supabase anyway — and Railway isn't truly free (trial credit, then usage
> billing). For a static SPA, Vercel/Netlify/Cloudflare Pages are simpler and
> free. Railway steps are included at the bottom if you specifically want it.

---

## Step 1 — Create your Supabase backend

You can't use the original Lovable project's Supabase (no access), so make your
own — the free tier is enough.

1. Sign up at https://supabase.com and create a new project. Save the database
   password.
2. **Run the migrations** (creates all tables, RLS, and the image bucket). In the
   Supabase dashboard open **SQL Editor**, then paste and run, in order:
   - `supabase/migrations/20260310035724_*.sql`
   - `supabase/migrations/20260310040457_*.sql`
   - `supabase/migrations/20260630120000_manual_products_dashboard.sql`

   (Or, with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Create your admin account**: Authentication → Users → Add user (your email +
   password).
4. **Disable public sign-ups**: Authentication → Providers → Email → turn off
   "Allow new users to sign up". (Writes are already locked to authenticated
   users by RLS; this ensures only your account can get in.)
5. Grab your API values from **Project Settings → API**:
   - Project URL  → `VITE_SUPABASE_URL`
   - `anon` / publishable key → `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Project ref/ID → `VITE_SUPABASE_PROJECT_ID`

See `DASHBOARD.md` for how to use the dashboard once it's live.

---

## Step 2 — Deploy the frontend

Set these env vars on the host (from Step 1, Vite needs them **at build time**):

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Config files for SPA routing are already in the repo, so deep links like `/admin`
and `/product/...` won't 404. Pick one host:

### Vercel (recommended)
1. https://vercel.com → New Project → import this GitHub repo.
2. Framework preset: **Vite** (build `npm run build`, output `dist` — auto-detected;
   `vercel.json` also pins it).
3. Add the three env vars → Deploy.

### Netlify
1. https://app.netlify.com → Add new site → import this repo.
2. Build settings come from `netlify.toml` (build `npm run build`, publish `dist`).
3. Add the three env vars → Deploy.

### Cloudflare Pages
1. https://dash.cloudflare.com → Workers & Pages → Pages → connect this repo.
2. Build command `npm run build`, output directory `dist`.
3. Add the three env vars → Deploy. (`public/_redirects` handles SPA routing.)

---

## After it's live

- Visit `/admin`, sign in with the user you created, add products under
  **Products**. The storefront defaults to the **manual** source, so products you
  add show up immediately.
- To use Shopify instead, go to **Settings**, switch source to Shopify, and enter
  your store domain + Storefront token.

---

## Optional — Railway instead of a static host

Railway can serve the built site, but you still need the Supabase project above.
1. https://railway.app → New Project → Deploy from this GitHub repo.
2. Set the build to `npm run build` and serve `dist/` with a static server, e.g.
   add a start command: `npx serve -s dist -l $PORT` (add `serve` as a dependency
   or use `npx`). A SPA-aware static server is required so routes fall back to
   `index.html` (`serve -s` does this).
3. Add the same three `VITE_SUPABASE_*` env vars.

This costs money once the trial credit runs out, which is why a static host is the
recommended free option.
