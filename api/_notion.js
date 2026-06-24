/**
 * api/_notion.js
 * ---------------------------------------------------------------------------
 * Minimal helper for writing a new row into the Notion "Leads" database.
 *
 * REQUIRED ENV VARS
 *   NOTION_API_KEY      — internal integration token from notion.so/my-integrations.
 *                          Starts with "secret_" (or "ntn_" on newer integrations).
 *   NOTION_DATABASE_ID  — the 32-character ID from the database's URL.
 *
 * BEFORE THIS WORKS, IN NOTION ITSELF (one-time setup, not code):
 *   1. Create the integration at notion.so/my-integrations (Internal type).
 *   2. Open the actual Leads database in Notion.
 *   3. Click "..." (top right) → Connections → add the integration by name.
 *   Skipping step 3 is the single most common failure mode for this kind
 *   of integration — the token alone is not sufficient. Requests will fail
 *   with "Could not find object" if the database hasn't been explicitly
 *   shared with the integration, even though the token itself is valid.
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
 *   the property names in your actual Notion database, including case —
 *   Notion's API treats property names as case-sensitive. If you rename a
 *   column in Notion, update the matching key here.
 */

const NOTION_VERSION = '2025-09-03';
const NOTION_API_BASE = 'https://api.notion.com/v1';

/**
 * Creates a new page (row) in the configured Notion database.
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
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !databaseId) {
    throw new Error(
      'NOTION_API_KEY and NOTION_DATABASE_ID must both be set as environment variables.'
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
      parent: { database_id: databaseId },
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
