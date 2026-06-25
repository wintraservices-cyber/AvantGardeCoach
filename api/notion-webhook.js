/**
 * api/notion-webhook.js
 * ---------------------------------------------------------------------------
 * Receives Notion's native API webhooks and syncs changes back into
 * Postgres — the inbound half of two-way sync (the outbound half lives in
 * api/_notion-sync.js, called from api/clients.js). Together these let an
 * admin manage clients/milestones/sessions/resources from either the
 * Control Panel or Notion directly.
 *
 * SETUP (in Notion, via the integration's Webhooks tab — NOT code):
 *   1. Go to your integration at notion.so/my-integrations → Webhooks tab.
 *   2. Click "+ Create a subscription".
 *   3. Subscriber URL: https://avant-garde-coach.vercel.app/api/notion-webhook
 *   4. Choose event types: at minimum "Page properties updated" for each
 *      of the Clients, Milestones, Sessions, Resources databases — adjust
 *      to whichever event types your Notion integration UI exposes for
 *      "a database row's properties changed".
 *   5. Click "Create subscription". Notion sends a verification_token to
 *      this exact endpoint as a POST request — THIS HANDLER MUST ALREADY
 *      BE DEPLOYED before you do this step, or the verification request
 *      will fail with nothing there to receive it.
 *   6. Copy the verification_token from Vercel's function logs for this
 *      route (it's logged once, deliberately, specifically so you can
 *      retrieve it for this one-time step — see the comment further down
 *      for why logging it is safe here and not a credential leak).
 *   7. Back in Notion's Webhooks tab, click "Verify", paste the token,
 *      and confirm. The subscription is now active.
 *   8. Save that SAME verification_token as the NOTION_WEBHOOK_SECRET
 *      environment variable in Vercel — it becomes the long-term signing
 *      secret for every subsequent webhook event, not just a one-time
 *      handshake value.
 *
 * WHY THE VERIFICATION TOKEN IS LOGGED (NOT A SECURITY ISSUE)
 * Notion's verification handshake works by sending the token to this
 * endpoint and expecting you to read it from THIS side and submit it back
 * THROUGH NOTION'S OWN UI — there's no API call that returns it to you
 * after the fact, and no way to complete setup without retrieving it from
 * somewhere. Logging it once, specifically during this one-time setup
 * flow, is the documented mechanism for retrieving it — Notion's own
 * setup instructions describe doing exactly this. It is sensitive
 * (treat the Vercel log entry the same as any other credential, and
 * avoid leaving it visible longer than needed) but logging it briefly
 * during setup is not a bug.
 *
 * VERIFICATION DETECTION — A REAL-WORLD CORRECTION TO NOTION'S OWN DOCS
 * Notion's documentation describes the verification handshake request as
 * having no X-Notion-Signature header, since no secret exists yet to
 * sign it with. In practice, during this project's actual setup, Notion
 * sent a signature header on the verification request anyway — confirmed
 * via direct curl testing against a deployed diagnostic build, not
 * assumed. This handler therefore detects the verification handshake by
 * the presence of `verification_token` in the body ALONE, not by also
 * requiring the signature header to be absent. If you're debugging this
 * again later and verification still isn't completing, check the
 * function logs for the literal body Notion sent — don't trust the
 * documented shape over what's actually arriving.
 *
 * SIGNATURE VERIFICATION — DIFFERENT FROM CAL.COM'S, ON PURPOSE
 * Notion's signature header is X-Notion-Signature (not x-cal-signature-256)
 * and its value is prefixed "sha256=<hex_digest>" — WITH the prefix,
 * unlike Cal.com's bare hex digest. These two providers chose opposite
 * conventions; copying the Cal.com verification logic here without
 * adjusting for the prefix would make every signature check fail. Like
 * Cal.com, the HMAC is computed over the raw, unparsed request body, so
 * bodyParser is disabled here too — see api/notion-lead.js for the fuller
 * explanation of why that matters.
 *
 * WHY waitUntil IS USED HERE BUT NOT IN api/clients.js's OUTBOUND SYNC
 * Notion imposes its OWN short response-time window on webhook delivery
 * (documented around 3 seconds) — this is an external constraint we don't
 * control, unlike an admin clicking "save" in the Control Panel, where the
 * "deadline" is just UX preference and a slightly slower response is a
 * fine tradeoff. Here, doing the real sync work (fetch the full page,
 * look up the Postgres row, compare timestamps, write) before responding
 * would risk exceeding Notion's window on any non-trivial case. So this
 * handler verifies the signature fast, responds 200 immediately, and does
 * the actual sync work via waitUntil — which keeps the function alive
 * after the response is sent, specifically for this kind of
 * non-critical-to-the-response background work.
 *
 * SPARSE PAYLOAD → FOLLOW-UP FETCH
 * Notion's webhook event tells us a page changed and its id — not what it
 * changed to. Every event triggers a getPageById call to retrieve the
 * actual current property values before any comparison or write happens.
 *
 * LAST-WRITE-WINS
 * Every synced table has an updated_at column (auto-maintained by a
 * Postgres trigger — see db/schema-notion-sync.sql) and Notion pages have
 * their own last_edited_time. Before writing a Notion-side change into
 * Postgres, this handler compares the two and only proceeds if Notion's
 * edit is actually newer — preventing an out-of-order or duplicate
 * webhook delivery from clobbering a more recent Postgres-side edit.
 *
 * REQUIRED ENV VARS
 *   NOTION_WEBHOOK_SECRET — the verification_token from setup step 8 above.
 *   NOTION_API_KEY — see api/_notion.js.
 *   NOTION_CLIENTS_DATABASE_ID, NOTION_MILESTONES_DATABASE_ID,
 *   NOTION_SESSIONS_DATABASE_ID, NOTION_RESOURCES_DATABASE_ID — the
 *   DATABASE page-URL IDs (NOT the *_DATA_SOURCE_ID vars used elsewhere
 *   in api/_notion.js for reads/writes). A Notion page's `parent` field
 *   only exposes a database_id, never a data_source_id — see the comment
 *   above identifyTableFromPage for the full explanation of why this
 *   webhook needs a second, different set of ID env vars rather than
 *   reusing the data source ones.
 */

const crypto = require('crypto');
const { waitUntil } = require('@vercel/functions');
const db = require('./_db');
const notion = require('./_notion');

module.exports.config = {
  api: {
    bodyParser: false, // see header comment — signature is computed over raw bytes
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verifies Notion's webhook signature. Notion's format is
 * "sha256=<hex_digest>" — WITH the prefix, the opposite convention from
 * Cal.com's bare hex digest elsewhere in this project. Mixing these two
 * up is the single easiest mistake to make when copying the Cal.com
 * verification code as a starting point — this implementation matches
 * Notion's documented format specifically, not a generic "looks similar
 * to Cal.com's" assumption.
 * @param {Buffer} rawBody
 * @param {string} signatureHeader
 * @param {string} secret
 * @returns {boolean}
 */
function verifyNotionSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const receivedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'utf8');
  const expectedBuf = Buffer.from(expectedHex, 'utf8');

  if (receivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Reads a plain string value out of a Notion rich_text or title property.
 * Returns '' if the property is empty or missing — Notion represents
 * "no text entered" as an empty array, not null, so this normalizes that.
 * @param {Object} property - a Notion property object (e.g. page.properties['Postgres ID'])
 * @returns {string}
 */
function readPlainText(property) {
  const arr = (property && (property.rich_text || property.title)) || [];
  return arr.map((t) => t.plain_text || '').join('');
}

/**
 * Determines which of our four synced tables a Notion page belongs to.
 *
 * IMPORTANT: a page object's `parent` field exposes `database_id` (the
 * database/container), NOT `data_source_id` — that's only present on
 * data source objects (the response from GET /v1/databases/{id}), not
 * on individual pages. This function therefore matches against each
 * database's own page URL ID (the same one used to look up its data
 * source earlier during setup), not the data source ID used elsewhere
 * in api/_notion.js for read/write operations. These are two different,
 * easily-confused IDs for the same database — getting this distinction
 * wrong here would make every webhook event silently fail to match any
 * table, since page.parent never contains a data_source_id to compare.
 *
 * Each of our four databases has exactly one data source (we never
 * created multiple data sources per database), so matching on
 * database_id is unambiguous for this project's actual setup.
 * @param {Object} page - a full Notion page object (from getPageById)
 * @returns {'clients'|'milestones'|'sessions'|'resources'|null}
 */
function identifyTableFromPage(page) {
  const databaseId = page.parent && page.parent.database_id;
  if (!databaseId) return null;

  const mapping = {
    [process.env.NOTION_CLIENTS_DATABASE_ID]: 'clients',
    [process.env.NOTION_MILESTONES_DATABASE_ID]: 'milestones',
    [process.env.NOTION_SESSIONS_DATABASE_ID]: 'sessions',
    [process.env.NOTION_RESOURCES_DATABASE_ID]: 'resources',
  };
  return mapping[databaseId] || null;
}

/**
 * Applies a Notion-side client page's current properties to Postgres,
 * if Notion's edit is actually newer than what's already stored
 * (last-write-wins). No-ops safely if the page has no Postgres ID yet
 * (e.g. a page Mahal created directly in Notion, not yet linked to any
 * Postgres row — that's a real, expected case, not an error).
 * @param {Object} page
 */
async function applyClientPageToPostgres(page) {
  const postgresId = readPlainText(page.properties['Postgres ID']);
  if (!postgresId) return; // page not yet linked to a Postgres row

  const existing = await db.getClientById(postgresId);
  if (!existing) {
    console.warn(`[notion-webhook] Notion client page references unknown Postgres id "${postgresId}" — skipping.`);
    return;
  }

  const notionEditedAt = new Date(page.last_edited_time);
  const postgresUpdatedAt = new Date(existing.updatedAt);
  if (notionEditedAt <= postgresUpdatedAt) {
    return; // Postgres already has the newer (or same) version — nothing to do
  }

  const props = page.properties;
  await db.updateClient({
    id: postgresId,
    displayName: readPlainText(props.Name) || existing.displayName,
    email: (props.Email && props.Email.email) || existing.email,
    sessionCount: (props['Session Count'] && props['Session Count'].number) ?? existing.sessionCount,
    heroHeadline: readPlainText(props['Hero Headline']),
    nextSessionAt: (props['Next Session At'] && props['Next Session At'].date && props['Next Session At'].date.start) || null,
    nextSessionWith: readPlainText(props['Next Session With']) || existing.nextSessionWith,
    nextSessionFormat: readPlainText(props['Next Session Format']) || existing.nextSessionFormat,
    rescheduleUrl: (props['Reschedule URL'] && props['Reschedule URL'].url) || existing.rescheduleUrl,
    notionPageId: page.id,
  });
}

/**
 * Same pattern as applyClientPageToPostgres, for a milestone page.
 * @param {Object} page
 */
async function applyMilestonePageToPostgres(page) {
  const postgresId = readPlainText(page.properties['Postgres ID']);
  if (!postgresId) return;

  const clientRelation = page.properties.Client && page.properties.Client.relation;
  const clientNotionPageId = clientRelation && clientRelation[0] && clientRelation[0].id;
  if (!clientNotionPageId) {
    console.warn(`[notion-webhook] Milestone page ${page.id} has no Client relation set — skipping (cannot determine which client this belongs to).`);
    return;
  }

  const clientPage = await notion.getClientPage(clientNotionPageId);
  const clientPostgresId = readPlainText(clientPage.properties['Postgres ID']);
  if (!clientPostgresId) {
    console.warn(`[notion-webhook] Milestone ${page.id}'s linked client page has no Postgres ID — skipping.`);
    return;
  }

  const milestones = await db.getMilestonesForClient(clientPostgresId);
  const existing = milestones.find((m) => m.id === postgresId);
  if (!existing) {
    console.warn(`[notion-webhook] Notion milestone page references unknown Postgres id "${postgresId}" — skipping.`);
    return;
  }

  const notionEditedAt = new Date(page.last_edited_time);
  const postgresUpdatedAt = new Date(existing.updatedAt);
  if (notionEditedAt <= postgresUpdatedAt) return;

  const props = page.properties;
  await db.saveMilestone({
    id: postgresId,
    clientId: clientPostgresId,
    tag: readPlainText(props.Tag),
    title: readPlainText(props.Title) || existing.title,
    description: readPlainText(props.Description),
    status: ((props.Status && props.Status.select && props.Status.select.name) || 'Locked').toLowerCase(),
    lockedReason: readPlainText(props['Locked Reason']),
    reflectionPrompt: readPlainText(props['Reflection Prompt']),
    sortOrder: (props['Sort Order'] && props['Sort Order'].number) ?? existing.sortOrder,
    notionPageId: page.id,
  });
}

/**
 * Same pattern, for a session page.
 * @param {Object} page
 */
async function applySessionPageToPostgres(page) {
  const postgresId = readPlainText(page.properties['Postgres ID']);
  if (!postgresId) return;

  const clientRelation = page.properties.Client && page.properties.Client.relation;
  const clientNotionPageId = clientRelation && clientRelation[0] && clientRelation[0].id;
  if (!clientNotionPageId) {
    console.warn(`[notion-webhook] Session page ${page.id} has no Client relation set — skipping.`);
    return;
  }

  const clientPage = await notion.getClientPage(clientNotionPageId);
  const clientPostgresId = readPlainText(clientPage.properties['Postgres ID']);
  if (!clientPostgresId) {
    console.warn(`[notion-webhook] Session ${page.id}'s linked client page has no Postgres ID — skipping.`);
    return;
  }

  const sessions = await db.getSessionsForClient(clientPostgresId);
  const existing = sessions.find((s) => s.id === postgresId);
  if (!existing) {
    console.warn(`[notion-webhook] Notion session page references unknown Postgres id "${postgresId}" — skipping.`);
    return;
  }

  const notionEditedAt = new Date(page.last_edited_time);
  const postgresUpdatedAt = new Date(existing.updatedAt);
  if (notionEditedAt <= postgresUpdatedAt) return;

  const props = page.properties;
  await db.saveSession({
    id: postgresId,
    clientId: clientPostgresId,
    topic: readPlainText(props.Topic) || existing.topic,
    sessionDate: (props['Session Date'] && props['Session Date'].date && props['Session Date'].date.start) || existing.sessionDate,
    sortOrder: (props['Sort Order'] && props['Sort Order'].number) ?? existing.sortOrder,
    notionPageId: page.id,
  });
}

/**
 * Same pattern, for a resource page.
 * @param {Object} page
 */
async function applyResourcePageToPostgres(page) {
  const postgresId = readPlainText(page.properties['Postgres ID']);
  if (!postgresId) return;

  const clientRelation = page.properties.Client && page.properties.Client.relation;
  const clientNotionPageId = clientRelation && clientRelation[0] && clientRelation[0].id;
  if (!clientNotionPageId) {
    console.warn(`[notion-webhook] Resource page ${page.id} has no Client relation set — skipping.`);
    return;
  }

  const clientPage = await notion.getClientPage(clientNotionPageId);
  const clientPostgresId = readPlainText(clientPage.properties['Postgres ID']);
  if (!clientPostgresId) {
    console.warn(`[notion-webhook] Resource ${page.id}'s linked client page has no Postgres ID — skipping.`);
    return;
  }

  const resources = await db.getResourcesForClient(clientPostgresId);
  const existing = resources.find((r) => r.id === postgresId);
  if (!existing) {
    console.warn(`[notion-webhook] Notion resource page references unknown Postgres id "${postgresId}" — skipping.`);
    return;
  }

  const notionEditedAt = new Date(page.last_edited_time);
  const postgresUpdatedAt = new Date(existing.updatedAt);
  if (notionEditedAt <= postgresUpdatedAt) return;

  const props = page.properties;
  await db.saveResource({
    id: postgresId,
    clientId: clientPostgresId,
    heading: readPlainText(props.Heading) || existing.heading,
    body: readPlainText(props.Body),
    sortOrder: (props['Sort Order'] && props['Sort Order'].number) ?? existing.sortOrder,
    notionPageId: page.id,
  });
}

/**
 * Fetches the full page for a webhook event and routes it to the right
 * apply* function based on which data source it belongs to. All errors
 * are caught and logged, never thrown — this runs inside waitUntil,
 * after the response has already been sent, so there's no request left
 * to fail even if something goes wrong here.
 * @param {string} pageId
 */
async function processPageChange(pageId) {
  try {
    // getPageById's dataSourceKey argument only matters for resolving
    // which API key to use, and all four data sources share the same
    // NOTION_API_KEY — so 'clients' here is an arbitrary valid choice for
    // that lookup, not a claim that this IS a client page. We don't yet
    // know what kind of page this is; that's determined right after, by
    // identifyTableFromPage.
    const page = await notion.getPageById('clients', pageId);
    const table = identifyTableFromPage(page);

    if (!table) {
      console.log(`[notion-webhook] Page ${pageId} doesn't belong to a synced database — ignoring.`);
      return;
    }

    if (table === 'clients') await applyClientPageToPostgres(page);
    else if (table === 'milestones') await applyMilestonePageToPostgres(page);
    else if (table === 'sessions') await applySessionPageToPostgres(page);
    else if (table === 'resources') await applyResourcePageToPostgres(page);
  } catch (err) {
    console.error(`[notion-webhook] Failed to process change for page ${pageId}:`, err);
  }
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
    res.status(400).json({ error: 'Could not read request body.' });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'Body is not valid JSON.' });
    return;
  }

  // The ONE-TIME verification handshake (setup step 5/6 in the header
  // comment) arrives as a POST with a verification_token. Documentation
  // describes this request as having no signature header (since no
  // secret exists yet to sign it with) — but real-world testing during
  // this project's setup showed Notion sends one anyway on at least some
  // verification attempts. Rather than rely on signature-ABSENCE to
  // detect this case (which real traffic contradicted), detect it purely
  // by the presence of verification_token in the body — that field is
  // unique to this one handshake request and never appears on a normal
  // event payload, so checking for it alone is sufficient and more
  // robust than also requiring a specific header state we can't fully
  // rely on.
  if (body && body.verification_token) {
    console.log('[notion-webhook] Verification token received (copy this into Notion to complete setup):', body.verification_token);
    res.status(200).json({ ok: true });
    return;
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[notion-webhook] NOTION_WEBHOOK_SECRET is not set.');
    res.status(500).json({ error: 'Server is not configured to receive this webhook yet.' });
    return;
  }

  const signatureHeader = req.headers['x-notion-signature'];
  if (!verifyNotionSignature(rawBody, signatureHeader, secret)) {
    console.warn('[notion-webhook] Rejected webhook with invalid or missing signature.');
    res.status(401).json({ error: 'Invalid signature.' });
    return;
  }

  const pageId = body && body.data && body.data.page_id;
  if (!pageId) {
    // Some event types (schema changes, comments) don't carry a page_id
    // the way page-property-update events do — nothing for us to sync.
    res.status(200).json({ ok: true, skipped: 'No page_id in this event.' });
    return;
  }

  // Respond immediately — Notion's own delivery window is short (see
  // header comment) — then do the actual fetch-and-sync work via
  // waitUntil, which keeps this function alive after the response is
  // sent specifically for work like this that the response doesn't
  // depend on.
  waitUntil(processPageChange(pageId));
  res.status(200).json({ ok: true });
};
