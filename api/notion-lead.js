/**
 * api/notion-lead.js
 * ---------------------------------------------------------------------------
 * Receives Cal.com's BOOKING_CREATED webhook and writes a new row into the
 * Notion Leads database. Cal.com → Google Calendar still does the actual
 * scheduling; this is a one-way log, not a calendar replacement.
 *
 * SETUP (in Cal.com's dashboard, not code):
 *   1. Go to /settings/developer/webhooks → Add webhook.
 *   2. Subscriber URL: https://avant-garde-coach.vercel.app/api/notion-lead
 *   3. Event trigger: Booking Created (only — leave others unchecked for now).
 *   4. Set a Secret (any long random string) and save it as the
 *      CAL_WEBHOOK_SECRET environment variable in Vercel — it must match
 *      exactly what you entered in Cal.com.
 *
 * REQUIRED ENV VARS
 *   CAL_WEBHOOK_SECRET — the secret configured in step 4 above.
 *   NOTION_API_KEY, NOTION_DATABASE_ID — see api/_notion.js.
 *
 * WHY bodyParser IS DISABLED FOR THIS ROUTE SPECIFICALLY
 * Every other API route in this project (auth.js, content.js, users.js)
 * relies on Vercel's automatic req.body JSON parsing — that's the right
 * default and those routes should keep using it. This route is the one
 * deliberate exception: Cal.com's signature is an HMAC computed over the
 * exact raw bytes of the request body. If Vercel parses the JSON first
 * (the normal/default behavior), those original bytes are gone by the
 * time this handler runs, and re-serializing the parsed object back to a
 * string produces a BYTE-FOR-BYTE DIFFERENT string (different whitespace,
 * possible key reordering) — so any signature check against that
 * re-serialized version would silently and permanently fail, even for
 * genuine, unmodified Cal.com requests. Disabling the parser here and
 * reading the raw stream ourselves is what makes verification possible
 * at all, not just a style preference.
 */

const crypto = require('crypto');
const { createLeadPage } = require('./_notion');

// Disables Vercel's automatic body parsing for this route only. See the
// comment above for why this matters.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Reads the raw request body as a single Buffer, before any parsing.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verifies Cal.com's webhook signature.
 *
 * Cal.com sends the signature in the x-cal-signature-256 header as a raw
 * hex digest — NOT prefixed with "sha256=" the way some other providers
 * (e.g. GitHub) format theirs. Mixing up these two formats is a common,
 * easy mistake; this implementation matches Cal.com's documented format
 * specifically, not a generic "looks like the others" assumption.
 *
 * @param {Buffer} rawBody
 * @param {string} signatureHeader
 * @param {string} secret
 * @returns {boolean}
 */
function verifyCalSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const receivedBuf = Buffer.from(signatureHeader, 'utf8');

  // Constant-time comparison — a plain === here would leak timing
  // information that could theoretically help an attacker guess a valid
  // signature one byte at a time.
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[api/notion-lead.js] Failed to read request body:', err);
    res.status(400).json({ error: 'Could not read request body.' });
    return;
  }

  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) {
    // Loud failure, same pattern as the rest of this project's auth code —
    // refuse to silently accept unverifiable webhooks rather than fall
    // back to "trust everything" if the env var is missing.
    console.error('[api/notion-lead.js] CAL_WEBHOOK_SECRET is not set.');
    res.status(500).json({ error: 'Server is not configured to receive this webhook yet.' });
    return;
  }

  const signatureHeader = req.headers['x-cal-signature-256'];
  const isValid = verifyCalSignature(rawBody, signatureHeader, secret);

  if (!isValid) {
    console.warn('[api/notion-lead.js] Rejected webhook with invalid or missing signature.');
    res.status(401).json({ error: 'Invalid signature.' });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'Body is not valid JSON.' });
    return;
  }

  const { triggerEvent, payload } = body || {};

  if (triggerEvent !== 'BOOKING_CREATED') {
    // We only subscribed to this one trigger in Cal.com's dashboard, so
    // this shouldn't normally happen — but if the webhook subscription
    // ever gets edited to include more triggers, fail safe by ignoring
    // anything we don't explicitly handle, rather than guessing at a
    // different payload shape.
    res.status(200).json({ ok: true, skipped: `Unhandled trigger: ${triggerEvent}` });
    return;
  }

  const attendee = (payload && payload.attendees && payload.attendees[0]) || {};

  if (!attendee.email) {
    // A booking with no attendee email is unusual enough to be worth
    // logging rather than silently writing an empty row to Notion.
    console.warn('[api/notion-lead.js] BOOKING_CREATED payload had no attendee email:', JSON.stringify(payload));
  }

  try {
    await createLeadPage({
      name: attendee.name || 'Unknown',
      email: attendee.email || '',
      callDateIso: payload.startTime,
      source: 'Website — Discovery Call',
      status: 'New',
    });
  } catch (err) {
    console.error('[api/notion-lead.js] Failed to create Notion page:', err);
    // Still return 200 — Cal.com may retry on non-2xx responses, and a
    // Notion outage shouldn't repeatedly hammer the booking flow. The
    // error is logged for manual follow-up instead.
    res.status(200).json({ ok: false, error: 'Logged locally; Notion write failed.' });
    return;
  }

  res.status(200).json({ ok: true });
};
