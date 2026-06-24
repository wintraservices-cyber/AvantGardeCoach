/**
 * api/_notion.js
 * ---------------------------------------------------------------------------
 * Minimal helper for writing a new row into the Notion "Leads" database.
 *
 * REQUIRED ENV VARS
 *   NOTION_API_KEY       — internal integration token from notion.so/my-integrations.
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

/**
 * Creates a new page (row) in the configured Notion data source.
 * @param {Object} lead
 * @param {string} lead.name
 * @param {string} lead.email
 * @param {string} lead.callDateIso - ISO 8601 timestamp of the booked call
 * @param {string} [lead.source] - defaults to "Website — Discovery Call"
 * @param {string} [lead.status] - defaults to "New"
 * @returns {Promise<Object>} the created Notion page object
 */
async function createLeadPage(lead) {
  const apiKey = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;

  if (!apiKey || !dataSourceId) {
    throw new Error(
      'NOTION_API_KEY and NOTION_DATA_SOURCE_ID must both be set as environment variables.'
    );
  }

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

module.exports = { createLeadPage };

