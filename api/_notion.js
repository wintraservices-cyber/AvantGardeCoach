/**
 * api/_notion.js
 * ---------------------------------------------------------------------------
 * Helper for writing to and updating rows in the Notion "Coaching Leads"
 * data source. Handles both new bookings (BOOKING_CREATED) and reschedules
 * (BOOKING_RESCHEDULED) — see api/notion-lead.js for how these connect to
 * Cal.com's webhooks.
 *
 * REQUIRED ENV VARS
 *   NOTION_API_KEY        — internal integration token from notion.so/my-integrations.
 *                          Starts with "secret_" (or "ntn_" on newer integrations).
 *   NOTION_DATA_SOURCE_ID — the data source ID *inside* the database (see below).
 *                          NOT the same as the database ID from the page URL.
 *
 * BEFORE THIS WORKS, IN NOTION ITSELF (one-time setup, not code):
 *   1. Create the integration at notion.so/my-integrations (Internal type).
 *   2. Open the actual Leads database in Notion.
 *   3. Click "..." (top right) → Connections → add the integration by name.
 *      Skipping this is the single most common failure mode — the token
 *      alone is not sufficient. Requests fail with "Could not find object"
 *      if the database hasn't been explicitly shared with the integration,
 *      even though the token itself is valid.
 *   4. Get the DATA SOURCE ID (not the database ID):
 *        curl -s -X GET "https://api.notion.com/v1/databases/<DATABASE_ID>" \
 *          -H "Authorization: Bearer <TOKEN>" \
 *          -H "Notion-Version: 2025-09-03"
 *      The response includes a "data_sources" array — copy the "id" value
 *      from there. This is a DIFFERENT id than the one in the database's
 *      page URL, and as of Notion API version 2025-09-03 it's what page
 *      creation actually requires as the parent — see WHY DATA_SOURCE_ID
 *      below for the full explanation.
 *   5. Add a "Booking UID" column to the data source, type Text (rich_text).
 *      This stores Cal.com's booking uid so a later reschedule webhook can
 *      find the right row to update — without it, reschedules have no way
 *      to know which Notion row corresponds to which Cal.com booking.
 *
 * WHY DATA_SOURCE_ID, NOT DATABASE_ID
 *   Notion's API version 2025-09-03 restructured databases into containers
 *   that hold one or more "data sources" — the actual table of properties
 *   (columns) lives on the data source, not on the database object itself.
 *   Calling GET /v1/databases/{id} returns metadata about the container
 *   only (title, icon, the list of data sources it holds) — it does NOT
 *   return a `properties` field, and POST /v1/pages with
 *   `parent: { database_id: ... }` now fails as a result. The fix is to
 *   target the data source directly: `parent: { data_source_id: ... }`.
 *   This is a genuine, documented breaking change (see Notion's own
 *   2025-09-03 upgrade guide) — not a mistake specific to this project,
 *   and it's the exact failure mode this comment is here to prevent
 *   re-discovering the hard way if this file is ever copied elsewhere.
 *
 * WHY RESCHEDULES NEED A LOOKUP, NOT JUST AN UPDATE
 *   Cal.com assigns a NEW uid to a booking every time it's rescheduled —
 *   the OLD uid (the one this row was originally saved under) shows up in
 *   the BOOKING_RESCHEDULED webhook's `rescheduleUid` field, not `uid`.
 *   So finding the right row means searching by `rescheduleUid`, then,
 *   once found, updating that row's Booking UID to the NEW uid — so that
 *   if the booking is rescheded *again* later, the next lookup still
 *   finds it correctly via the chain of updates.
 *
 * NOTION_VERSION
 *   Notion requires a Notion-Version header on every request. Pinned here
 *   to a specific dated version (current at time of writing) rather than
 *   always "latest", since Notion's versioning is explicitly designed so
 *   that pinning is the stable, intentional choice — an unpinned/old
 *   integration does not silently break when Notion ships a new version.
 *
 * PROPERTY NAME MATCHING
 *   The keys below ("Name", "Email", "Call Date", etc.) MUST exactly match
 *   the property names in your actual Notion data source, including case
 *   AND spacing — Notion's API treats property names as case-sensitive.
 *   If you rename a column in Notion, update the matching key here. (This
 *   bit us once already during setup: the column was accidentally created
 *   as "Call date" with a lowercase d, not "Call Date" — double-check
 *   yours matches exactly via the data source GET request above before
 *   assuming this code is wrong if you hit a similar error again.)
 */

const NOTION_VERSION = '2025-09-03';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// Maps a short, readable key to the env var holding that data source's ID.
// Every new data source this project adds gets one more entry here, rather
// than each function hardcoding its own process.env lookup — keeps the
// "which env var holds which ID" mapping in exactly one place.
const DATA_SOURCE_ENV_VARS = {
  leads: 'NOTION_DATA_SOURCE_ID',
  clients: 'NOTION_CLIENTS_DATA_SOURCE_ID',
  milestones: 'NOTION_MILESTONES_DATA_SOURCE_ID',
  sessions: 'NOTION_SESSIONS_DATA_SOURCE_ID',
  resources: 'NOTION_RESOURCES_DATA_SOURCE_ID',
};

/**
 * @param {string} [dataSourceKey='leads'] - one of the keys in DATA_SOURCE_ENV_VARS
 */
function getCredentials(dataSourceKey = 'leads') {
  const apiKey = process.env.NOTION_API_KEY;
  const envVarName = DATA_SOURCE_ENV_VARS[dataSourceKey];
  if (!envVarName) {
    throw new Error(`Unknown Notion data source key "${dataSourceKey}". Valid keys: ${Object.keys(DATA_SOURCE_ENV_VARS).join(', ')}`);
  }
  const dataSourceId = process.env[envVarName];
  if (!apiKey || !dataSourceId) {
    throw new Error(
      `NOTION_API_KEY and ${envVarName} must both be set as environment variables.`
    );
  }
  return { apiKey, dataSourceId };
}

/**
 * Creates a new page (row) in the configured Notion data source.
 * @param {Object} lead
 * @param {string} lead.name
 * @param {string} lead.email
 * @param {string} lead.callDateIso - ISO 8601 timestamp of the booked call
 * @param {string} [lead.source] - defaults to "Website — Discovery Call"
 * @param {string} [lead.status] - defaults to "New"
 * @param {string} [lead.bookingUid] - Cal.com's booking uid, for later reschedule lookups
 * @returns {Promise<Object>} the created Notion page object
 */
async function createLeadPage(lead) {
  const { apiKey, dataSourceId } = getCredentials();

  const properties = {
    Name: {
      title: [{ text: { content: lead.name || 'Unknown' } }],
    },
    Email: {
      email: lead.email || null,
    },
    'Call Date': {
      date: { start: lead.callDateIso },
    },
    Source: {
      select: { name: lead.source || 'Website — Discovery Call' },
    },
    Status: {
      select: { name: lead.status || 'New' },
    },
    'Booking UID': {
      rich_text: lead.bookingUid
        ? [{ text: { content: lead.bookingUid } }]
        : [],
    },
    // Created is intentionally omitted here — if it's configured in Notion
    // as a "Created time" property, Notion fills it automatically and
    // rejects any value sent for it from the API.
  };

  const response = await fetch(`${NOTION_API_BASE}/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { data_source_id: dataSourceId },
      properties,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Notion API request failed (${response.status}): ${errorBody}`
    );
  }

  return response.json();
}

/**
 * Finds the lead page whose "Booking UID" matches the given Cal.com uid.
 * @param {string} bookingUid
 * @returns {Promise<Object|null>} the matching page object, or null if none found
 */
async function findLeadPageByBookingUid(bookingUid) {
  const { apiKey, dataSourceId } = getCredentials();

  if (!bookingUid) return null;

  const response = await fetch(`${NOTION_API_BASE}/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'Booking UID',
        rich_text: { equals: bookingUid },
      },
      page_size: 1,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Notion query failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();
  return (data.results && data.results[0]) || null;
}

/**
 * Updates an existing lead page's Call Date and Booking UID — used when a
 * booking is rescheduled, so the row reflects the new time and can still
 * be found correctly if it's rescheduled again later.
 * @param {string} pageId
 * @param {Object} updates
 * @param {string} updates.callDateIso
 * @param {string} updates.newBookingUid
 * @returns {Promise<Object>} the updated page object
 */
async function updateLeadOnReschedule(pageId, updates) {
  const { apiKey } = getCredentials();

  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        'Call Date': {
          date: { start: updates.callDateIso },
        },
        'Booking UID': {
          rich_text: [{ text: { content: updates.newBookingUid } }],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Notion update failed (${response.status}): ${errorBody}`
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// TWO-WAY SYNC: clients, milestones, sessions, resources
//
// Each of these four follows the same shape: find-by-Postgres-ID (to check
// whether a Notion page already exists for a given row), create, and
// update. Rather than writing four near-identical copies of each
// operation, the generic helpers below take the data source key and a
// property-builder function, and the typed wrappers underneath just
// supply the right shape for their own type. This keeps the actual HTTP
// request logic in one place — a bug fix there fixes all four types at
// once, instead of needing to be repeated four times correctly.
// ---------------------------------------------------------------------------

/**
 * Finds a page in the given data source whose "Postgres ID" property
 * equals the given id. Every synced table's Notion database has this
 * column specifically so this lookup is possible — see db/schema-notion-sync.sql.
 * @param {string} dataSourceKey
 * @param {string} postgresId
 * @returns {Promise<Object|null>}
 */
async function findPageByPostgresId(dataSourceKey, postgresId) {
  const { apiKey, dataSourceId } = getCredentials(dataSourceKey);
  if (!postgresId) return null;

  const response = await fetch(`${NOTION_API_BASE}/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'Postgres ID',
        rich_text: { equals: postgresId },
      },
      page_size: 1,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Notion query failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return (data.results && data.results[0]) || null;
}

/**
 * Creates a new page in the given data source.
 * @param {string} dataSourceKey
 * @param {Object} properties - already-built Notion property objects
 * @returns {Promise<Object>} the created page
 */
async function createPage(dataSourceKey, properties) {
  const { apiKey, dataSourceId } = getCredentials(dataSourceKey);

  const response = await fetch(`${NOTION_API_BASE}/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { data_source_id: dataSourceId },
      properties,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Notion API request failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

/**
 * Updates an existing page by its Notion page ID.
 * @param {string} dataSourceKey - only used to resolve apiKey; pageId already identifies the exact page
 * @param {string} pageId
 * @param {Object} properties - already-built Notion property objects (only the ones to change)
 * @returns {Promise<Object>} the updated page
 */
async function updatePage(dataSourceKey, pageId, properties) {
  const { apiKey } = getCredentials(dataSourceKey);

  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Notion update failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

/**
 * Fetches a single page by its Notion page ID, in full — used by the
 * inbound webhook, which only receives a page ID and an event type, not
 * the page's actual current field values. Notion's page-update webhook
 * payload is intentionally sparse (it tells you THAT something changed,
 * not WHAT changed to), so every inbound sync has to make this follow-up
 * call to get the real, current property values.
 * @param {string} dataSourceKey - only used to resolve apiKey
 * @param {string} pageId
 * @returns {Promise<Object>}
 */
async function getPageById(dataSourceKey, pageId) {
  const { apiKey } = getCredentials(dataSourceKey);

  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Notion fetch-page failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ---------- CLIENTS ----------

function buildClientProperties(client) {
  const props = {
    Name: { title: [{ text: { content: client.displayName || 'Unknown' } }] },
    Email: { email: client.email || null },
    'Session Count': { number: client.sessionCount ?? 0 },
    'Hero Headline': { rich_text: client.heroHeadline ? [{ text: { content: client.heroHeadline } }] : [] },
    'Next Session With': { rich_text: client.nextSessionWith ? [{ text: { content: client.nextSessionWith } }] : [] },
    'Next Session Format': { rich_text: client.nextSessionFormat ? [{ text: { content: client.nextSessionFormat } }] : [] },
    'Reschedule URL': { url: client.rescheduleUrl || null },
    'Postgres ID': { rich_text: [{ text: { content: client.id } }] },
  };
  // next_session_at can legitimately be null (no session scheduled yet) —
  // Notion's date property accepts { date: null } for "no date set", but
  // NOT a key that's simply missing, so this needs to be explicit either way.
  props['Next Session At'] = { date: client.nextSessionAt ? { start: client.nextSessionAt } : null };
  return props;
}

async function findClientPage(postgresId) {
  return findPageByPostgresId('clients', postgresId);
}

async function createClientPage(client) {
  return createPage('clients', buildClientProperties(client));
}

async function updateClientPage(pageId, client) {
  return updatePage('clients', pageId, buildClientProperties(client));
}

async function getClientPage(pageId) {
  return getPageById('clients', pageId);
}

// ---------- MILESTONES ----------

function buildMilestoneProperties(milestone, clientNotionPageId) {
  const props = {
    Title: { title: [{ text: { content: milestone.title || 'Untitled milestone' } }] },
    Tag: { rich_text: milestone.tag ? [{ text: { content: milestone.tag } }] : [] },
    Description: { rich_text: milestone.description ? [{ text: { content: milestone.description } }] : [] },
    Status: { select: { name: capitalizeStatus(milestone.status) } },
    'Locked Reason': { rich_text: milestone.lockedReason ? [{ text: { content: milestone.lockedReason } }] : [] },
    'Reflection Prompt': { rich_text: milestone.reflectionPrompt ? [{ text: { content: milestone.reflectionPrompt } }] : [] },
    'Sort Order': { number: milestone.sortOrder ?? 0 },
    'Postgres ID': { rich_text: [{ text: { content: milestone.id } }] },
  };
  // The Client relation needs the CLIENT's Notion page id, not the
  // client's Postgres id — these are different values, and mixing them up
  // would silently create a relation pointing at nothing (Notion accepts
  // an unrecognized page id in a relation array without erroring, it just
  // doesn't resolve to anything visible).
  if (clientNotionPageId) {
    props.Client = { relation: [{ id: clientNotionPageId }] };
  }
  return props;
}

// Postgres stores status as lowercase ('complete', 'active', 'locked');
// the Notion Select options were created as Title Case ('Complete',
// 'Active', 'Locked') to read better in the UI. Notion's Select match is
// exact-string, so this conversion has to happen on every write or every
// status would silently fail to match an existing option (and Notion
// would just create a new, differently-cased option instead of erroring,
// which is a worse failure mode — duplicate options that look almost the
// same starts accumulating silently over time).
function capitalizeStatus(status) {
  if (!status) return 'Locked';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

async function findMilestonePage(postgresId) {
  return findPageByPostgresId('milestones', postgresId);
}

async function createMilestonePage(milestone, clientNotionPageId) {
  return createPage('milestones', buildMilestoneProperties(milestone, clientNotionPageId));
}

async function updateMilestonePage(pageId, milestone, clientNotionPageId) {
  return updatePage('milestones', pageId, buildMilestoneProperties(milestone, clientNotionPageId));
}

async function getMilestonePage(pageId) {
  return getPageById('milestones', pageId);
}

// ---------- SESSIONS ----------

function buildSessionProperties(session, clientNotionPageId) {
  const props = {
    Topic: { title: [{ text: { content: session.topic || 'Untitled session' } }] },
    'Session Date': { date: session.sessionDate ? { start: session.sessionDate } : null },
    'Sort Order': { number: session.sortOrder ?? 0 },
    'Postgres ID': { rich_text: [{ text: { content: session.id } }] },
  };
  if (clientNotionPageId) {
    props.Client = { relation: [{ id: clientNotionPageId }] };
  }
  return props;
}

async function findSessionPage(postgresId) {
  return findPageByPostgresId('sessions', postgresId);
}

async function createSessionPage(session, clientNotionPageId) {
  return createPage('sessions', buildSessionProperties(session, clientNotionPageId));
}

async function updateSessionPage(pageId, session, clientNotionPageId) {
  return updatePage('sessions', pageId, buildSessionProperties(session, clientNotionPageId));
}

async function getSessionPage(pageId) {
  return getPageById('sessions', pageId);
}

// ---------- RESOURCES ----------

function buildResourceProperties(resource, clientNotionPageId) {
  const props = {
    Heading: { title: [{ text: { content: resource.heading || 'Untitled' } }] },
    Body: { rich_text: resource.body ? [{ text: { content: resource.body } }] : [] },
    'Sort Order': { number: resource.sortOrder ?? 0 },
    'Postgres ID': { rich_text: [{ text: { content: resource.id } }] },
  };
  if (clientNotionPageId) {
    props.Client = { relation: [{ id: clientNotionPageId }] };
  }
  return props;
}

async function findResourcePage(postgresId) {
  return findPageByPostgresId('resources', postgresId);
}

async function createResourcePage(resource, clientNotionPageId) {
  return createPage('resources', buildResourceProperties(resource, clientNotionPageId));
}

async function updateResourcePage(pageId, resource, clientNotionPageId) {
  return updatePage('resources', pageId, buildResourceProperties(resource, clientNotionPageId));
}

async function getResourcePage(pageId) {
  return getPageById('resources', pageId);
}

module.exports = {
  createLeadPage,
  findLeadPageByBookingUid,
  updateLeadOnReschedule,
  findClientPage,
  createClientPage,
  updateClientPage,
  getClientPage,
  findMilestonePage,
  createMilestonePage,
  updateMilestonePage,
  getMilestonePage,
  findSessionPage,
  createSessionPage,
  updateSessionPage,
  getSessionPage,
  findResourcePage,
  createResourcePage,
  updateResourcePage,
  getResourcePage,
};

