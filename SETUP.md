# Turning on accounts, coins and payments

Accounts (email sign-in), coins, the free daily spin, the coin shop and cloud saves are built in but **off** until the
server has the env vars below. With none of them set, `/api/config` answers `{"accounts":false}`, every other `/api`
route answers 503, the menu shows no sign-in panel and the game plays exactly as it did before.

You need about 20 minutes. Do it all in **test mode** first; no real money moves until you swap in live Stripe keys.

| Env var | Where it comes from | Secret? |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase: project URL, `https://<ref>.supabase.co` | no |
| `SUPABASE_ANON_KEY` | Supabase: the publishable key (`sb_publishable_...`) or the legacy `anon` key | no, it is sent to browsers |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase: the secret key (`sb_secret_...`) or the legacy `service_role` key | **yes**, server only |
| `STRIPE_SECRET_KEY` | Stripe: test secret key `sk_test_...` | **yes** |
| `STRIPE_WEBHOOK_SECRET` | Stripe: the webhook's signing secret `whsec_...` | **yes** |
| `SITE_URL` (optional) | `https://spud-brawl.onrender.com`; pins Stripe's return links instead of using the request's host | no |

Accounts switch on when all three `SUPABASE_*` vars are set. Coin packs show only when accounts are on **and** both
Stripe vars are set, so nobody can pay without the webhook that credits them.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com/dashboard) (free tier is fine). Pick a region near your
   Render region and save the database password somewhere; the game never needs it.
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and run it. It makes the
   `profiles` and `purchases` tables, the signup trigger, row level security (players can read only their own profile and
   write nothing), and the spin, buy and credit functions that only the server can call. Running it twice is safe.
3. **Authentication → Sign In / Providers**: make sure **Email** is enabled. Magic links need no passwords; leave
   "Confirm email" on.
4. **Authentication → URL Configuration**:
   - Site URL: `https://spud-brawl.onrender.com`
   - Redirect URLs: add `https://spud-brawl.onrender.com/**` (and `http://localhost:3000/**` if you want to test
     locally).
5. **Project Settings → API Keys**: copy the project URL, the publishable key and the secret key (the "Legacy" tab's
   `anon` and `service_role` keys work too). Never put the secret key anywhere but Render's environment.
6. Email: Supabase's built-in mailer only sends a few emails an hour, and only to addresses on your Supabase team,
   which is fine for testing with your own email. Before strangers can sign in, set up custom SMTP under
   **Authentication → Emails → SMTP Settings** (Resend, Postmark, SES, ...).

## 2. Stripe (test mode)

1. In the [Stripe dashboard](https://dashboard.stripe.com), switch on **Test mode**.
2. **Developers → API keys**: copy the **Secret key** (`sk_test_...`). No products or prices are needed: the three coin
   packs (500 / 1,200 / 3,000 coins at $0.99 / $1.99 / $4.99, placeholders) are defined in `public/economy.js` and sent
   to Checkout as `price_data`.
3. **Developers → Webhooks → Add endpoint** (newer dashboards call it **Add destination**, "Webhook endpoint", "Your
   account"):
   - Endpoint URL: `https://spud-brawl.onrender.com/api/stripe/webhook`
   - Events: `checkout.session.completed` (also add `checkout.session.async_payment_succeeded` in case you later enable
     delayed payment methods like bank debits)
   - Save, then reveal and copy the **Signing secret** (`whsec_...`).

## 3. Render

1. Open the **spud-brawl** service → **Environment** → add the five vars (six with `SITE_URL`) → **Save changes**.
   Render redeploys by itself.
2. Check: `https://spud-brawl.onrender.com/api/config` should now show `"accounts":true,"payments":true,"testMode":true`
   and never any secret key.

## 4. Try it

1. Open the site. The menu shows a sign-in panel under your level. Type your email, press **Email me a link**, open the
   link from the email in the same browser. The panel now shows your callsign, email, coin balance (0) and Sign out.
2. **Free spin**: spin the wheel; the server picks the prize and credits it. The button then counts down 24 hours.
3. **Get coins** → pick a pack → Stripe Checkout → card `4242 4242 4242 4242`, any future date, any CVC, any postcode.
   You come back to the game and the coins land a few seconds later (the webhook credits them). In Stripe, the webhook's
   page should show a `200` delivery.
4. **Armory → Soldier** (or a weapon tab): shop looks show a price. Click one, then **Buy**. It is equipped and saved.
   Friends in your room see it.
5. Cloud save: play a match, then sign in from another browser. The save with more XP wins on both sides.

If something fails, Render's **Logs** show `api ...` and `webhook ...` lines; Stripe's webhook page shows each
delivery and lets you resend it (crediting is idempotent, so resending never pays twice).

## Going live (later, not tonight)

- **Keys**: in Stripe, leave test mode, finish account activation, create a **live** webhook endpoint (same URL and
  events; it has its own `whsec_`), then put the live `sk_live_...` and the live `whsec_...` into Render. Set real pack
  prices in `public/economy.js`.
- **Tax**: digital goods are taxable in many places (EU/UK VAT, many US states). Turn on Stripe Tax or check with an
  accountant before selling.
- **Terms**: publish terms of service, a privacy policy (you store emails), and a refund policy. Say clearly that coins
  have no cash value, can't be transferred or cashed out, and are only spent on cosmetic items. EU/UK buyers have a
  14-day withdrawal right for digital content unless they explicitly waive it at purchase.
- **Age**: the game is open to anyone with a browser. In the US, collecting a child's email (under 13) triggers COPPA;
  the simplest path is to state the game is for 13+ and add an age confirmation before sign-in and checkout. Some
  countries set the age of digital consent at 16.
- **Loot boxes**: the spin is free only and never sold for money or coins, and its odds are shown on the wheel. Keep it
  that way: selling spins or any random reward would bring loot-box rules (Belgium, the Netherlands, app stores, and
  more) into play. Coins buy only specific, named items.
- **Email**: custom SMTP (step 1.6) with your own domain, so sign-in links don't land in spam.
- **Account deletion**: deleting a user in Supabase **Authentication → Users** also deletes their profile and purchase
  records (cascade). Keep Stripe's own records for accounting.

## What the server trusts

Nothing from the client touches money. The server checks the caller's Supabase access token on every `/api` call, picks
spin prizes and prices itself, and writes through single-statement Postgres functions, so two clicks can't double-spin
or double-spend. Stripe credits come only from signature-checked webhooks, once per Checkout Session.

Looks are cosmetic and, like the rest of the netcode, drawn by each client: a modified client could show itself wearing
a shop look it doesn't own. That costs nobody money.
