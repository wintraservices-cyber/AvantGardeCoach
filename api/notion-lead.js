/**
 * api/notion-lead.js
 * ---------------------------------------------------------------------------
 * Receives Cal.com's BOOKING_CREATED and BOOKING_RESCHEDULED webhooks and
 * keeps two things in sync: the Notion Coaching Leads database, AND — for
 * anyone who already has a client account on this site — their dashboard's
 * "next session" date. Cal.com → Google Calendar still does the actual
 * scheduling; this function just relays what already happened there.
 *
 * CLIENT MATCHING
 * There's no built-in link between a Cal.com booking and a client account
 * — the only signal we have is email. If the booking's attendee email
 * matches an existing client's email (case-insensitively), that client's
 * next_session_at is updated to the new time. If it doesn't match anyone
 * — most bookings won't, since most bookers aren't existing clients yet —
 * that's expected, not an error, and is logged at most as informational,
 * never as a warning or failure.
 *
 * SETUP (in Cal.com's dashboard, not code):
 *   1. Go to /settings/developer/webhooks → Add webhook (or edit the
 *      existing one from initial setup).
 *   2. Subscriber URL: https://avant-garde-coach.vercel.app/api/notion-lead
 *   3. Event triggers: check BOTH "Booking Created" AND "Booking Rescheduled".
 *   4. Set a Secret (any long random string) and save it as the
 *      CAL_WEBHOOK_SECRET environment variable in Vercel — it must match
 *      exactly what you entered in Cal.com.
 *
 * REQUIRED ENV VARS
 *   CAL_WEBHOOK_SECRET — the secret configured in step 4 above.
 *   NOTION_API_KEY, NOTION_DATA_SOURCE_ID — see api/_notion.js.
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
 *
 * RESCHEDULE LOOKUP LOGIC (for Notion)
 * Cal.com assigns a brand-new `uid` to a booking every time it's
 * rescheduled. The OLD uid (the one the Notion row was originally saved
 * under) appears in the BOOKING_RESCHEDULED payload's `rescheduleUid`
 * field, not `uid`. So handling a reschedule means: look up the Notion
 * row by `rescheduleUid`, then update that row's Call Date AND its
 * Booking UID (to the new `uid`) — so a second reschedule later can still
 * find the row via the same lookup. The client-sync logic doesn't need
 * this same uid-chasing, since it looks up by email every time, not by a
 * stored booking identifier.
 */

const crypto = require('crypto');
const db = require('./_db');
const { createLeadPage, findLeadPageByBookingUid, updateLeadOnReschedule } = require('./_notion');

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

/**
 * If the booking's attendee email matches an existing client account,
 * updates that client's next_session_at to the given time. Silent no-op
 * if there's no match — most bookings won't be from existing clients,
 * and that's the normal case, not a failure.
 * @param {string} email
 * @param {string} startTimeIso
 */
async function syncClientNextSession(email, startTimeIso) {
  if (!email) return;

  const client = await db.getClientByEmail(email);
  if (!client) {
    // Expected for most bookings — not every booker is an existing
    // client. Logging this at all is just for visibility during early
    // testing; remove or downgrade further if it gets noisy in practice.
    console.log(`[api/notion-lead.js] No client account matches "${email}" — skipping dashboard sync (this is normal for new/non-client bookings).`);
    return;
  }

  await db.updateClient({ id: client.id, nextSessionAt: startTimeIso });
  console.log(`[api/notion-lead.js] Synced next session for client ${client.id} (${email}).`);
}

/**
 * Handles a new booking: creates a fresh Notion row, storing the booking's
 * uid so a later reschedule can find it. Also syncs the client's dashboard
 * if the attendee email matches an existing client account.
 * @param {Object} payload - the Cal.com webhook payload
 */
async function handleBookingCreated(payload) {
  const attendee = (payload && payload.attendees && payload.attendees[0]) || {};

  if (!attendee.email) {
    // A booking with no attendee email is unusual enough to be worth
    // logging rather than silently writing an empty row to Notion.
    console.warn('[api/notion-lead.js] BOOKING_CREATED payload had no attendee email:', JSON.stringify(payload));
  }

  await createLeadPage({
    name: attendee.name || 'Unknown',
    email: attendee.email || '',
    callDateIso: payload.startTime,
    source: 'Website — Discovery Call',
    status: 'New',
    bookingUid: payload.uid,
  });

  await syncClientNextSession(attendee.email, payload.startTime);
}

/**
 * Handles a reschedule: finds the existing Notion row by the OLD booking
 * uid (rescheduleUid) and updates its Call Date + Booking UID to reflect
 * the new time and new uid. Also syncs the client's dashboard if the
 * attendee email matches an existing client account.
 * @param {Object} payload - the Cal.com webhook payload
 */
async function handleBookingRescheduled(payload) {
  const oldUid = payload.rescheduleUid;
  const newUid = payload.uid;
  const attendee = (payload && payload.attendees && payload.attendees[0]) || {};

  if (!oldUid) {
    console.warn('[api/notion-lead.js] BOOKING_RESCHEDULED payload had no rescheduleUid — cannot find the original row:', JSON.stringify(payload));
  } else {
    const existingPage = await findLeadPageByBookingUid(oldUid);

    if (!existingPage) {
      // The original booking may predate this feature (created before the
      // Booking UID column existed), or may have been created by a Notion
      // write that failed silently at the time. Either way, there's no row
      // to update — log it for manual follow-up rather than erroring loudly,
      // since this isn't something the visitor did wrong.
      console.warn(`[api/notion-lead.js] No Notion row found for rescheduleUid "${oldUid}" — original booking may predate Booking UID tracking.`);
    } else {
      await updateLeadOnReschedule(existingPage.id, {
        callDateIso: payload.startTime,
        newBookingUid: newUid,
      });
    }
  }

  // The dashboard sync runs regardless of whether the Notion lookup above
  // found a row — these are two independent systems, and a gap in one
  // (e.g. a pre-existing booking with no Notion row) shouldn't block the
  // other from working correctly.
  await syncClientNextSession(attendee.email, payload.startTime);
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

  try {
    if (triggerEvent === 'BOOKING_CREATED') {
      await handleBookingCreated(payload);
    } else if (triggerEvent === 'BOOKING_RESCHEDULED') {
      await handleBookingRescheduled(payload);
    } else {
      // We only subscribed to these two triggers in Cal.com's dashboard,
      // so this shouldn't normally happen — but if the webhook
      // subscription is ever edited to include more triggers, fail safe
      // by ignoring anything we don't explicitly handle, rather than
      // guessing at a different payload shape.
      res.status(200).json({ ok: true, skipped: `Unhandled trigger: ${triggerEvent}` });
      return;
    }
  } catch (err) {
    console.error(`[api/notion-lead.js] Failed to process ${triggerEvent}:`, err);
    // Still return 200 — Cal.com may retry on non-2xx responses, and a
    // Notion outage shouldn't repeatedly hammer the booking flow. The
    // error is logged for manual follow-up instead.
    res.status(200).json({ ok: false, error: 'Logged locally; Notion write failed.' });
    return;
  }

  res.status(200).json({ ok: true });
};
