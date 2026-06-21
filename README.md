# Avant-Garde Coach — Website + AI Booking Assistant

This repo contains the full Avant-Garde Coach site: the landing page, the
discovery-call booking page (with a live Cal.com calendar embed), and a
client dashboard mockup. Two pages include an AI chat assistant powered by
Claude, routed through a small serverless function so the real API key
never reaches the browser.

## Files

- `index.html` — the main landing page (manifesto-style design, embedded
  AI intake assistant under "Find Your Fit")
- `booking.html` — discovery-call booking page (AI context chat + live
  Cal.com calendar embed)
- `dashboard.html` — client dashboard mockup (no real backend/auth yet —
  this is a visual prototype, not a real login system)
- `api/chat.js` — Vercel serverless function. This is the *only* place the
  real Anthropic API key is used. It receives requests from the two chat
  assistants and forwards them to Anthropic's API server-side.
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

### 3. Add your Anthropic API key as an environment variable

This is the step that keeps your key safe. **Never paste your API key into
any HTML or JS file.**

1. In your Vercel project, go to **Settings → Environment Variables**.
2. Add a new variable:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your real API key (starts with `sk-ant-...`)
   - **Environment:** check Production (and Preview/Development too, if
     you want preview deployments to also have working AI chat)
3. Save, then go to the **Deployments** tab and **redeploy** — Vercel only
   picks up new environment variables on a fresh deployment, so if you
   already deployed once before adding the key, you need to redeploy.

### 4. Connect your real domain

1. In your Vercel project, go to **Settings → Domains**.
2. Add `avant-gardecoach.ca` (and `www.avant-gardecoach.ca` if you want
   both to work).
3. Vercel will show you DNS records to add. Go to wherever your domain is
   registered (GoDaddy, Namecheap, etc.) and add those records under DNS
   settings.
4. DNS changes can take anywhere from a few minutes to a few hours to
   take effect.

### 5. Test it for real

Once deployed, visit your live Vercel URL (something like
`your-project.vercel.app`) before the domain finishes propagating:

- Try the "Find Your Fit" assistant on the landing page.
- Try the discovery-call assistant on the booking page, and confirm the
  Cal.com calendar appears.
- If the AI chat shows a "having trouble connecting" message, double-check
  the environment variable name is exactly `ANTHROPIC_API_KEY` and that you
  redeployed after adding it.

## Things to revisit later

- **Cal.com booking window** — set the 14-day future-booking limit on the
  Discovery Call event type in your Cal.com dashboard (Event Types →
  Discovery Call → Limits tab). This isn't controlled from the code.
- **Dashboard is a visual mockup only** — there's no real login, no real
  data storage. Building real client accounts and persisted data is a
  separate, larger project.
- **Pricing** — every program card currently says "PRICE TBD" on purpose.
  Update those once pricing is finalized.
