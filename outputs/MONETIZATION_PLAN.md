# Monetization Plan — Premium Gates (6.4) + Stripe Checkout (6.5)

Status: design only. No app code changed. No keys committed.
Price: $49/yr per family, recurring annual. Web-only Stripe checkout.

## 0. Principles
- Free forever (the growth loop): live game scoring and the live spectator share
  link. These are never gated, on the client or the server.
- Paid tier gates DEPTH: score/game history beyond the live game plus the last
  game, the Season in Review recap, per-goalie season analytics, and CSV/JSON
  export.
- Never trust a client-side premium flag for anything that protects paid value.
  The client flag drives UI only. Every gated server operation re-checks the
  entitlement server-side using the Firebase-verified uid.
- Entitlement is SET only by the Stripe webhook, server-side. Nothing the client
  sends can grant premium.

## 1. Entitlement model

New Supabase table, keyed by Firebase uid (same identity used everywhere else).

    CREATE TABLE IF NOT EXISTS entitlements (
      uid                    TEXT PRIMARY KEY,   -- Firebase payload.sub
      status                 TEXT NOT NULL DEFAULT 'free',
                             -- 'active' | 'comp' | 'past_due' | 'canceled' | 'free'
                             -- 'comp' = manually granted free premium (no Stripe sub)
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      price_id               TEXT,
      current_period_end     TIMESTAMPTZ,
      last_event_at          TIMESTAMPTZ,        -- for idempotency ordering
      created_at             TIMESTAMPTZ DEFAULT now(),
      updated_at             TIMESTAMPTZ DEFAULT now()
    );

Definition of premium (server-side): isPremium = status == 'comp', OR
(status == 'active' AND current_period_end is in the future, allowing a short
grace, e.g. 1 day). 'past_due' keeps access during a short grace window before
locking. 'comp' has no Stripe subscription and no expiry (manual grant).

How it is SET: only `api/stripe-webhook.js` writes 'active' / 'past_due' /
'canceled'. The checkout endpoint may pre-create the row with the
stripe_customer_id but must not set 'active'.

How it is READ:
- Server: a shared helper `api/_entitlement.js` exports `getEntitlement(uid)`
  returning `{ status, isPremium, currentPeriodEnd }`, fetched from the
  entitlements table with the anon key (mirrors `_rate-limit.js`). Every gated
  endpoint calls this with the verified uid.
- Client: a read-only endpoint `GET /api/entitlement` (auth required) returns
  `{ status, isPremium, currentPeriodEnd }` for the signed-in uid. `app.js`
  calls it on auth ready and stores the result in the existing
  `window._subscriptionPlan` / `window._subscriptionFeatures` globals so the UI
  can gate. Guests are always non-premium.

Mapping Stripe events back to uid: at checkout we set
`client_reference_id = uid`, `subscription_data.metadata.uid = uid`, and store
`metadata.uid` on the Stripe customer. The webhook reads uid from these fields so
it never has to guess.

## 2. Gating map

| Feature (paid) | Trigger point | Free-user experience |
|---|---|---|
| History depth beyond live + last game | `fetchScopedGames()` js/app.js:5641 -> `/api/games` GET (api/games/index.js) | Server returns the single most recent saved game plus a `premiumRequired:true` flag. History panel shows the last game, then a paywall row. |
| Season dashboard | `#btnSeason` js/app.js:6486 -> `loadSeasonPanel()` js/app.js:5804 -> `renderSeasonDashboard()` js/app.js:7022 | Dashboard body replaced with the paywall card. Also fire the "season dashboard opened" upgrade prompt. |
| Per-goalie season analytics | "By Goalie" block inside renderSeasonDashboard js/app.js:7158-7208 | Rendered only when premium; otherwise omitted (it lives inside the gated dashboard). |
| Season in Review recap | `openSeasonRecap()` js/app.js:7630; entries at js/app.js:7223 and js/app.js:7659 | Recap CTA still shows, but tapping it opens the paywall for free users. The archive auto-offer likewise routes to the paywall. |
| CSV export | `exportGameCSV()` js/app.js:3226 (#btnExportGameCSV js/app.js:5154) | Button routes to paywall for free users. See note. |
| JSON export | `exportAllData()` js/app.js:3935 (#acctExportAll js/app.js:3877) | Button routes to paywall for free users. See note. |

Never gated, verified untouched:
- Live scoring engine (js/app.js ~1100+). No premium read.
- Live share: startLiveShare js/app.js:8028, #btnShareLive js/app.js:8104,
  #btnCopyShareLink js/app.js:8113, and the public spectator read
  `api/live-game` GET (no auth). Spectator pages require no login. All stay free.

Server enforcement (the real protection):
- `api/games` GET: after resolving uid and calling getEntitlement, if not
  premium, clamp `limit` to 1 (the last saved game), ignore any past-season
  filter, and return `{ success, games, truncated:true, premiumRequired:true }`.
  The live game itself is in-progress client state, not a DB row, so it is
  unaffected. This is the single chokepoint that protects history and the season
  dashboard and the recap, since all three read through it.
- Export note: single-game CSV of the currently open game is derived from data
  the free user can already see (live/last game), so gating it is a UX choice,
  not a data-protection one. Any bulk or multi-game/season export must go through
  a server endpoint that re-checks entitlement, because that is where paid data
  would actually leave. Recommendation: gate the export buttons in the UI for
  polish, and if a bulk-history export is ever added, put it behind a
  server-enforced endpoint.

Upgrade-prompt moments (wire the dormant `maybeShowUpgradePrompt`):
- Game saved: js/app.js:3073-3076, call `maybeShowUpgradePrompt('game_saved')`.
- Season dashboard opened: js/app.js:6486.
- Share link opened by 3+ viewers: NOT currently measurable. `api/live-game` GET
  has no viewer counter. Building it means counting distinct spectators per
  share_code server-side and surfacing that count back to the coach's live push
  response. Treat as separate work, or drop this trigger for v1.

Paywall / upgrade copy (plain, functional, no em dashes):
- Paywall title: "Unlock your full season"
- Paywall body: "Premium keeps your whole game history, the Season in Review
  recap, per goalie season stats, and CSV and JSON export. Live scoring and the
  live share link stay free. $49 per year for your family."
- Primary button: "Go Premium, $49/yr"
- Secondary: "Not now"
- Game-saved nudge: "Game saved. Premium keeps every game and unlocks your
  season recap."
- Season-dashboard nudge: "See your full season with Premium. Ratings, trends,
  and per goalie stats across every game."

## 3. Stripe flow end to end

Client "Go Premium" button
  -> POST /api/create-checkout-session (with authHeaders)
  -> server returns { url }
  -> window.location = url  (Stripe-hosted Checkout; no publishable key needed
     client-side because we redirect to session.url)
  -> user pays on Stripe
  -> Stripe redirects to success_url (/?checkout=success) or cancel_url
  -> in parallel, Stripe calls POST /api/stripe-webhook
  -> webhook verifies signature and upserts the entitlements row to 'active'
  -> on return, app.js sees ?checkout=success, shows "Activating your account"
     and polls GET /api/entitlement until status becomes 'active' (webhook may
     lag a second or two), then unlocks the UI.

Endpoints to add (all Vercel serverless, ESM, raw fetch, matching house style):

`api/create-checkout-session.js` (POST, auth required):
  - authenticateRequest -> uid. Reject guests (uid null) with a message telling
    them to create an account first. Guest-to-account migration
    (js/app.js:4222-4288) is the conversion path.
  - Rate-limit with checkRateLimit (e.g. 10/min per uid).
  - Ensure a Stripe customer: reuse entitlements.stripe_customer_id if present,
    else create one with metadata.uid = uid, then upsert it into entitlements.
  - Create a Checkout Session: mode=subscription,
    line_items=[{ price: STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id = uid, subscription_data[metadata][uid] = uid,
    allow_promotion_codes = true (so comped users can redeem a 100%-off code),
    success_url = <origin>/?checkout=success,
    cancel_url = <origin>/?checkout=cancel.
  - Implementation: POST to https://api.stripe.com/v1/checkout/sessions with
    Authorization: Bearer STRIPE_SECRET_KEY and an
    application/x-www-form-urlencoded body (nested keys like
    line_items[0][price]). This keeps the no-SDK style used for Supabase and
    Firebase. Adding the official `stripe` npm package is the alternative, but
    would introduce the repo's first package.json and node_modules build step.
  - Return { url: session.url }.

Client button: add a "Go Premium" control (account modal is the natural home,
next to the plan line at js/app.js:3930). On click, fetch the endpoint and
redirect.

`api/stripe-webhook.js` (POST, no Firebase auth; Stripe authenticates via
signature):
  - Read the RAW request body (do not JSON-parse before verifying). This repo's
    handlers already read raw via req.on('data'); reuse that. If Vercel body
    parsing interferes, add `export const config = { api: { bodyParser: false } }`.
  - Verify the Stripe-Signature header: parse t and v1, compute
    HMAC-SHA256(secret = STRIPE_WEBHOOK_SECRET, message = `${t}.${rawBody}`)
    using node:crypto, constant-time compare against v1, and reject if the
    timestamp is older than ~5 minutes. No SDK required.
  - Handle events:
      checkout.session.completed  -> read uid from client_reference_id, read
        subscription + customer ids, fetch the subscription for
        current_period_end and price, upsert entitlements: status 'active'.
      customer.subscription.updated -> upsert status ('active','past_due',
        'canceled') and current_period_end from the event.
      customer.subscription.deleted -> set status 'canceled' (or 'free').
      (optional) invoice.payment_failed -> mark 'past_due'.
  - Idempotent: upsert by uid; ignore stale events by comparing event timestamp
    to last_event_at. Return 200 fast.

`api/entitlement.js` (GET, auth required): returns
`{ status, isPremium, currentPeriodEnd }` for the signed-in uid.

Serverless blind spot: dev_server.py does not run any api/*.js and will not
emulate these three endpoints. Coverage plan:
  - Add contract checks to scripts/api-smoke.mjs READ_CHECKS:
      /api/create-checkout-session  -> 401 (no auth) and 405 for GET
      /api/stripe-webhook           -> 400 (missing/invalid signature) for POST,
                                       405 for GET
      /api/entitlement              -> 401 (no auth)
  - Staging test after deploy: point a Vercel preview at Stripe TEST keys, run
    Checkout with card 4242 4242 4242 4242, and confirm the webhook writes the
    entitlements row (use the Stripe CLI `stripe listen`/`stripe trigger` or the
    dashboard's webhook test). Then run scripts/api-smoke.mjs against the preview.

## 4. Security checklist
- Webhook signature verified with STRIPE_WEBHOOK_SECRET over the raw body;
  reject unverified or stale (>5 min) requests.
- Entitlement is written only by the webhook. The checkout endpoint may store the
  customer id but never sets 'active'.
- Every gated server op (api/games depth, any future export endpoint) re-checks
  getEntitlement(uid) with the Firebase-verified uid. Client flags are UI only.
- Idempotent webhook handling: upsert by uid, ignore out-of-order events via
  last_event_at.
- STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are server-only. Never referenced
  in js/*, never returned to the client. Redirecting to session.url means the
  client needs no Stripe key at all.
- Checkout requires an authenticated (non-guest) uid, and is rate-limited.
- Do not put any personal data or ids in URLs beyond the opaque Stripe session.

## 5. OWNER SETUP CHECKLIST (only Jamie can do these), in order
1. Create a Stripe account at stripe.com and verify your email. Stay in TEST mode
   first (toggle at top right of the dashboard).
2. Create the product and price: Product catalog -> Add product. Name it
   "Smart Team Tracker Premium (Family)". Pricing: Recurring, $49.00, billing
   period Yearly, your currency. Save, then copy the Price ID (starts with
   price_...). This is STRIPE_PRICE_ID (test value).
3. Get API keys: Developers -> API keys. Copy the Publishable key (pk_test_...)
   and the Secret key (sk_test_...). The secret key is STRIPE_SECRET_KEY.
4. Register the webhook: Developers -> Webhooks -> Add endpoint. URL is
   https://YOURDOMAIN/api/stripe-webhook. Select events:
   checkout.session.completed, customer.subscription.updated,
   customer.subscription.deleted (optionally invoice.payment_failed). Save, then
   copy the Signing secret (whsec_...). This is STRIPE_WEBHOOK_SECRET.
5. Set Vercel environment variables: Vercel project -> Settings -> Environment
   Variables. Add these for Preview and Production:
     STRIPE_SECRET_KEY      = sk_test_... (test on Preview)
     STRIPE_WEBHOOK_SECRET  = whsec_...   (from step 4)
     STRIPE_PRICE_ID        = price_...   (from step 2)
   Optional: APP_BASE_URL (else the server uses the request origin).
   Redeploy so the new variables take effect.
6. Create the Supabase entitlements table using the SQL in section 1
   (Supabase -> SQL editor).
7. Test end to end in TEST mode with card 4242 4242 4242 4242, any future expiry,
   any CVC. Confirm the entitlements row flips to 'active'.
8. Go live: flip Stripe to LIVE mode and repeat steps 2 through 4 to get a LIVE
   price id, live keys (sk_live_..., pk_live_...), and a live webhook signing
   secret. Update the Vercel PRODUCTION env vars with the live values. Keep test
   values on Preview.

Env var names this design uses: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_PRICE_ID, and optionally STRIPE_PUBLISHABLE_KEY and APP_BASE_URL.
(SUPABASE_URL and SUPABASE_ANON_KEY already exist.)

## 6. Decisions locked (Jamie, 2026-07-21)
- No free trial. The free tier (live scoring and live share, always free) is the
  trial. Straight to paid.
- Annual only, $49/yr. No monthly plan.
- On lapse or cancel: never delete data. Keep it stored, re-lock behind the
  paywall, restore on resubscribe. Short past_due grace (a few days) before
  locking.
- Grandfather all pre-launch users as premium (via the comp grant in section 7).
  Currently that is just Jamie.
- v1 is one account per subscription (single Firebase uid). Multi-parent shared
  access is a later feature; the "family" wording is marketing, not a seat model.
- Drop the "3+ viewers" upgrade trigger for v1. Use only game-saved and
  season-dashboard-opened.
- Refunds, receipts, and tax: Stripe dashboard settings, tuned as needed.

## 7. Comp / free-access grants (Jamie wants to hand out premium for free)

Two mechanisms, both land the user in the same entitled state.

1. Self-serve promo codes (primary, recommended, near-zero extra code).
   The Checkout Session sets allow_promotion_codes = true. Jamie creates a
   100%-off coupon in Stripe once (Product catalog -> Coupons: 100% off,
   duration "forever" for a permanent comp, or a set number of months for a
   temporary one), then generates promotion codes to share. A comped person
   signs up, taps Go Premium, enters the code, and checks out at $0. Stripe
   creates a free subscription and the webhook sets status='active' exactly like
   a paid one. Fully tracked in Stripe, revocable there, and no backend work
   beyond the one allow_promotion_codes flag. For a "forever" 100%-off coupon
   Stripe does not require a card.

2. Direct grant via 'comp' status (for grandfathering, and for flipping a
   specific account without any checkout). getEntitlement treats status='comp'
   as premium. Grant it by upserting an entitlements row for that person's uid.
   For v1 this is a documented Supabase SQL upsert (Jamie needs the person's
   uid, which is visible in Firebase Auth once they have signed up). A small
   admin-only grant endpoint or UI is a later nicety if manual grants get
   frequent.

Grandfathering: seed a status='comp' row for each known pre-launch user
(currently just Jamie's uid).

## 8. Owner Stripe action beyond section 5 (for comps)
After the section 5 setup, also create one 100%-off coupon in Stripe (duration
"forever"), and generate a promotion code from it to share when you want to comp
someone. That is all that is needed for the self-serve path.
