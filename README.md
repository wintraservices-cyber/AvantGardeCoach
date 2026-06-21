# Avant-Garde Coach — Website + AI Booking Assistant

This repo contains the full Avant-Garde Coach site: the landing page, the
discovery-call booking page (with a live Cal.com calendar embed), and a
client dashboard mockup. Two pages include an AI chat assistant powered by
Google's Gemini API (free tier), routed through a small serverless
function so the real API key never reaches the browser.

## Files

- `index.html` — the main landing page (manifesto-style design, embedded
  AI intake assistant under "Find Your Fit")
- `booking.html` — discovery-call booking page (AI context chat + live
  Cal.com calendar embed)
- `dashboard.html` — client dashboard mockup (no real backend/auth yet —
  this is a visual prototype, not a real login system)
- `api/chat.js` — Vercel serverless function. This is the *only* place the
  real Gemini API key is used. It receives requests from the two chat
  assistants, forwards them to Google's Gemini API, and reshapes the
  response so the frontend code didn't need to change.
- `vercel.json` — tells Vercel to serve `index.html` at the root URL
- `package.json` — minimal project file so Vercel recognizes this as a
  Node-based project (needed for the `api/` function to run)

## Deploying — step by step

### 1. Push this folder to GitHub

If you don't already have a repo:

```bash
cd avant-garde-deploy
git init
git add .
git commit -m "Initial deploy: Avant-Garde Coach site + AI booking assistant"
```

Create a new repository on github.com (no need to add a README/license
there — you already have one here), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

### 2. Connect the repo to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (you can sign in
   directly with your GitHub account).
2. Click **"Add New..." → "Project"**.
3. Select the GitHub repo you just pushed. Vercel will detect it
   automatically — no special build settings needed, since this is static
   HTML plus one serverless function.
4. **Before clicking Deploy**, add your environment variable (next step) —
   or add it right after and redeploy.

### 3. Get a free Gemini API key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   and sign in with any Google account.
2. Click **"Create API Key"**. No credit card or billing setup is required
   for the free tier.
3. Copy the key (starts with `AIza...`).

This free tier currently allows roughly 1,500 requests per day on the
`gemini-2.5-flash` model this project uses — far more than a single
coaching site's chat traffic will realistically need. One thing worth
knowing: on the free tier, Google's terms allow your API inputs/outputs to
be used to improve their models. If that matters for your use case,
revisit this once the site has real traffic.

### 4. Add the API key to Vercel

This is the step that keeps your key safe. **Never paste your API key into
any HTML or JS file.**

1. In your Vercel project, go to **Settings → Environment Variables**.
2. Add a new variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** the key you copied from Google AI Studio
   - **Environment:** check Production (and Preview/Development too, if
     you want preview deployments to also have working AI chat)
3. Save, then go to the **Deployments** tab and **redeploy** — Vercel only
   picks up new environment variables on a fresh deployment, so if you
   already deployed once before adding the key, you need to redeploy.

### 4b. Set up automatic email sending (Resend)

The booking page can send the AI chat's context note directly to Mahal by
email — but only after the visitor reviews the exact text and clicks
"Send." Nothing sends automatically without that approval step.

1. Create a free account at [resend.com](https://resend.com).
2. Go to **API Keys** in the Resend dashboard and create a new key.
3. In Vercel, add another environment variable:
   - **Name:** `RESEND_API_KEY`
   - **Value:** the key from Resend
4. Redeploy.

**Important — domain verification:** Resend's free tier requires a
verified sending domain to deliver to arbitrary recipients (like Mahal's
real inbox). Until you verify a domain, `api/send-context.js` is set up to
send from Resend's shared test address (`onboarding@resend.dev`), which
only reliably delivers to the email on your own Resend account — fine for
testing, not yet for real visitors.

**To verify your domain (do this before relying on this in production):**
1. In Resend, go to **Domains → Add Domain**, enter `avant-gardecoach.ca`
   (or a subdomain like `mail.avant-gardecoach.ca`).
2. Add the DNS records Resend gives you, at wherever your domain is
   registered (same place you added the Vercel records).
3. Once verified, open `api/send-context.js` and change the
   `FROM_ADDRESS` constant near the top from
   `'Avant-Garde Coach <onboarding@resend.dev>'` to something like
   `'Avant-Garde Coach <hello@avant-gardecoach.ca>'`.
4. Commit, push, and redeploy.

### 5. Connect your real domain

1. In your Vercel project, go to **Settings → Domains**.
2. Add `avant-gardecoach.ca` (and `www.avant-gardecoach.ca` if you want
   both to work).
3. Vercel will show you DNS records to add. Go to wherever your domain is
   registered (GoDaddy, Namecheap, etc.) and add those records under DNS
   settings.
4. DNS changes can take anywhere from a few minutes to a few hours to
   take effect.

### 6. Test it for real

Once deployed, visit your live Vercel URL (something like
`your-project.vercel.app`) before the domain finishes propagating:

- Try the "Find Your Fit" assistant on the landing page.
- Try the discovery-call assistant on the booking page, and confirm the
  Cal.com calendar appears.
- Try the "Review & send this context to Mahal too" flow — you should see
  the exact email text before anything sends. Until your domain is
  verified in Resend, this will only actually deliver to the email address
  on your own Resend account, which is fine for confirming it works.
- If the AI chat shows a "having trouble connecting" message, double-check
  the environment variable name is exactly `GEMINI_API_KEY` and that you
  redeployed after adding it. The Vercel function logs (Deployments → your
  deployment → Functions → chat.js) will show the exact error if it's
  still failing.

## Things to revisit later

- **Cal.com booking window** — set the 14-day future-booking limit on the
  Discovery Call event type in your Cal.com dashboard (Event Types →
  Discovery Call → Limits tab). This isn't controlled from the code.
- **Dashboard is a visual mockup only** — there's no real login, no real
  data storage. Building real client accounts and persisted data is a
  separate, larger project.
- **Pricing** — every program card currently says "PRICE TBD" on purpose.
  Update those once pricing is finalized.
- **AI provider** — this project currently uses Gemini's free tier to
  avoid upfront cost. If you later want to switch to Anthropic's Claude
  (e.g. for higher quality responses or to avoid Google's free-tier data
  terms), `api/chat.js` is the only file that needs to change — it's
  written so the frontend pages don't care which provider is behind it.
