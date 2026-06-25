/**
 * api/_db.js
 * ---------------------------------------------------------------------------
 * Data-access layer for the Avant-Garde Coach CMS.
 *
 * BACKEND: Neon Postgres, connected via Vercel's Marketplace integration,
 * queried with the @neondatabase/serverless driver over HTTP. This is the
 * recommended driver for Vercel serverless functions — it doesn't need a
 * persistent TCP/WebSocket connection, so there's no pool lifecycle to
 * manage across invocations.
 *
 * REQUIRED ENV VAR
 *   DATABASE_URL — set automatically by Vercel when you connect the
 *   database from the Storage tab. No manual setup needed.
 *
 * SCHEMA
 *   See db/schema.sql for the table definitions. Run that file once
 *   against your database (via the Neon console's SQL editor, or `psql`)
 *   before using this module.
 *
 * WHY THIS FILE'S SHAPE MATTERS
 * Every route handler (api/content.js, api/auth.js) calls these exported
 * functions instead of writing SQL directly. That isolation is what made
 * the original swap from a placeholder JSON file to this real database
 * possible without touching any other file — and it's what would let a
 * future swap to a different database happen the same way.
 *
 * NAMING CONVENTION NOTE
 * The JS objects used throughout the app (and sent to/from the frontend)
 * use camelCase (priceLabel, amazonUrl, sortOrder). SQL columns use
 * snake_case (price_label, amazon_url, sort_order), per normal Postgres
 * convention. The mapping happens at the edges of this file only — see
 * rowToProgram/programToRow etc. below — so nothing outside this file
 * needs to know or care about the column-naming difference.
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Row <-> JS object mapping helpers
// ---------------------------------------------------------------------------

function rowToProgram(row) {
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    description: row.description,
    priceLabel: row.price_label,
    priceTbd: row.price_tbd,
    features: row.features || [],
    featured: row.featured,
    ctaText: row.cta_text,
    ctaHref: row.cta_href,
    sortOrder: row.sort_order,
  };
}

function rowToBook(row) {
  return {
    id: row.id,
    featured: row.featured,
    tag: row.tag,
    title: row.title,
    blurb: row.blurb,
    amazonUrl: row.amazon_url,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------

/**
 * Returns all programs, sorted by sortOrder ascending.
 * @returns {Promise<Array<Object>>}
 */
async function getPrograms() {
  const rows = await sql`SELECT * FROM programs ORDER BY sort_order ASC`;
  return rows.map(rowToProgram);
}

/**
 * Creates or updates a program by id (upsert).
 * @param {Object} program - must include an `id` field.
 * @returns {Promise<Object>} the saved program
 */
async function saveProgram(program) {
  if (!program || !program.id) {
    throw new Error('saveProgram requires a program object with an "id" field.');
  }

  // Fetch the existing row (if any) so partial updates merge correctly,
  // matching the upsert-merge behavior the JSON-file version had.
  const existingRows = await sql`SELECT * FROM programs WHERE id = ${program.id}`;
  const existing = existingRows[0] ? rowToProgram(existingRows[0]) : {};
  const merged = { ...existing, ...program };

  const rows = await sql`
    INSERT INTO programs (id, tag, name, description, price_label, price_tbd, features, featured, cta_text, cta_href, sort_order)
    VALUES (
      ${merged.id},
      ${merged.tag ?? null},
      ${merged.name ?? null},
      ${merged.description ?? null},
      ${merged.priceLabel ?? null},
      ${merged.priceTbd ?? true},
      ${JSON.stringify(merged.features ?? [])}::jsonb,
      ${merged.featured ?? false},
      ${merged.ctaText ?? null},
      ${merged.ctaHref ?? null},
      ${merged.sortOrder ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      tag = EXCLUDED.tag,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price_label = EXCLUDED.price_label,
      price_tbd = EXCLUDED.price_tbd,
      features = EXCLUDED.features,
      featured = EXCLUDED.featured,
      cta_text = EXCLUDED.cta_text,
      cta_href = EXCLUDED.cta_href,
      sort_order = EXCLUDED.sort_order
    RETURNING *
  `;
  return rowToProgram(rows[0]);
}

/**
 * Deletes a program by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a program was removed
 */
async function deleteProgram(id) {
  const rows = await sql`DELETE FROM programs WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// BOOKS
// ---------------------------------------------------------------------------

/**
 * Returns all books, sorted by sortOrder ascending.
 * @returns {Promise<Array<Object>>}
 */
async function getBooks() {
  const rows = await sql`SELECT * FROM books ORDER BY sort_order ASC`;
  return rows.map(rowToBook);
}

/**
 * Creates or updates a book by id (upsert).
 * @param {Object} book - must include an `id` field.
 * @returns {Promise<Object>} the saved book
 */
async function saveBook(book) {
  if (!book || !book.id) {
    throw new Error('saveBook requires a book object with an "id" field.');
  }

  const existingRows = await sql`SELECT * FROM books WHERE id = ${book.id}`;
  const existing = existingRows[0] ? rowToBook(existingRows[0]) : {};
  const merged = { ...existing, ...book };

  const rows = await sql`
    INSERT INTO books (id, featured, tag, title, blurb, amazon_url, sort_order)
    VALUES (
      ${merged.id},
      ${merged.featured ?? false},
      ${merged.tag ?? null},
      ${merged.title ?? null},
      ${merged.blurb ?? null},
      ${merged.amazonUrl ?? null},
      ${merged.sortOrder ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      featured = EXCLUDED.featured,
      tag = EXCLUDED.tag,
      title = EXCLUDED.title,
      blurb = EXCLUDED.blurb,
      amazon_url = EXCLUDED.amazon_url,
      sort_order = EXCLUDED.sort_order
    RETURNING *
  `;
  return rowToBook(rows[0]);
}

/**
 * Deletes a book by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a book was removed
 */
async function deleteBook(id) {
  const rows = await sql`DELETE FROM books WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// USERS (admin accounts — see api/_auth-helpers.js for password hashing)
// ---------------------------------------------------------------------------

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    // passwordHash is intentionally NOT included here — callers that need
    // it for verification use getUserWithPasswordHash() instead, so it's
    // never accidentally returned to the frontend.
  };
}

/**
 * Returns all admin users (without password hashes), sorted by creation date.
 * @returns {Promise<Array<{id, email, createdAt}>>}
 */
async function getUsers() {
  const rows = await sql`SELECT id, email, created_at FROM users ORDER BY created_at ASC`;
  return rows.map(rowToUser);
}

/**
 * Looks up a single user by email, INCLUDING their password hash. Used only
 * by the login flow to verify a password — never returned to the frontend.
 * @param {string} email
 * @returns {Promise<{id, email, passwordHash, createdAt} | null>}
 */
async function getUserWithPasswordHash(email) {
  if (!email) return null;
  const rows = await sql`SELECT * FROM users WHERE lower(email) = lower(${email})`;
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    email: rows[0].email,
    passwordHash: rows[0].password_hash,
    createdAt: rows[0].created_at,
  };
}

/**
 * Creates a new admin user.
 * @param {{id: string, email: string, passwordHash: string}} user
 * @returns {Promise<{id, email, createdAt}>}
 */
async function createUser(user) {
  if (!user || !user.id || !user.email || !user.passwordHash) {
    throw new Error('createUser requires { id, email, passwordHash }.');
  }
  const rows = await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${user.id}, ${user.email}, ${user.passwordHash})
    RETURNING id, email, created_at
  `;
  return rowToUser(rows[0]);
}

/**
 * Updates a user's password hash (used for both self password-changes and
 * one admin resetting another's password).
 * @param {string} id
 * @param {string} passwordHash
 * @returns {Promise<boolean>} true if a user was updated
 */
async function updateUserPassword(id, passwordHash) {
  const rows = await sql`
    UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Deletes a user by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a user was removed
 */
async function deleteUser(id) {
  const rows = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// CLIENTS (real coaching-client accounts — separate identity space from
// admin `users`. A client logs in to see their own dashboard only.)
// ---------------------------------------------------------------------------

function rowToClient(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    sessionCount: row.session_count,
    heroHeadline: row.hero_headline,
    nextSessionAt: row.next_session_at,
    nextSessionWith: row.next_session_with,
    nextSessionFormat: row.next_session_format,
    rescheduleUrl: row.reschedule_url,
    createdAt: row.created_at,
    notionPageId: row.notion_page_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns all clients (without password hashes), sorted by creation date.
 * @returns {Promise<Array<Object>>}
 */
async function getClients() {
  const rows = await sql`SELECT * FROM clients ORDER BY created_at ASC`;
  return rows.map(rowToClient);
}

/**
 * Returns a single client's full profile (without password hash) by id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getClientById(id) {
  const rows = await sql`SELECT * FROM clients WHERE id = ${id}`;
  return rows[0] ? rowToClient(rows[0]) : null;
}

/**
 * Looks up a client by email, WITHOUT their password hash — safe to call
 * from any context that has no business handling credentials (e.g. the
 * Cal.com webhook matching a booking's attendee email to a client record).
 * Deliberately separate from getClientWithPasswordHash, which exists only
 * for the login flow — keeping them apart means a future caller can't
 * accidentally end up with a password hash in scope just because it
 * needed a basic email lookup for something unrelated to authentication.
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
async function getClientByEmail(email) {
  if (!email) return null;
  const rows = await sql`SELECT * FROM clients WHERE lower(email) = lower(${email})`;
  return rows[0] ? rowToClient(rows[0]) : null;
}

/**
 * Looks up a client by email, INCLUDING their password hash. Used only by
 * the client login flow to verify a password — never returned to the
 * frontend as-is.
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
async function getClientWithPasswordHash(email) {
  if (!email) return null;
  const rows = await sql`SELECT * FROM clients WHERE lower(email) = lower(${email})`;
  if (!rows[0]) return null;
  return { ...rowToClient(rows[0]), passwordHash: rows[0].password_hash };
}

/**
 * Creates a new client account.
 * @param {Object} client - must include id, email, passwordHash, displayName
 * @returns {Promise<Object>} the created client (without password hash)
 */
async function createClient(client) {
  if (!client || !client.id || !client.email || !client.passwordHash || !client.displayName) {
    throw new Error('createClient requires { id, email, passwordHash, displayName }.');
  }
  const rows = await sql`
    INSERT INTO clients (id, email, password_hash, display_name, session_count, hero_headline, next_session_at, next_session_with, next_session_format, reschedule_url, notion_page_id)
    VALUES (
      ${client.id}, ${client.email}, ${client.passwordHash}, ${client.displayName},
      ${client.sessionCount ?? 0}, ${client.heroHeadline ?? null},
      ${client.nextSessionAt ?? null}, ${client.nextSessionWith ?? 'Mahal Hudson'},
      ${client.nextSessionFormat ?? 'Video call'}, ${client.rescheduleUrl ?? null},
      ${client.notionPageId ?? null}
    )
    RETURNING *
  `;
  return rowToClient(rows[0]);
}

/**
 * Updates an existing client's profile fields (not password — see
 * updateClientPassword for that). Merges partial updates onto the existing
 * row, same upsert-merge pattern as saveProgram/saveBook.
 * @param {Object} client - must include id; other fields are optional
 * @returns {Promise<Object>} the updated client
 */
async function updateClient(client) {
  if (!client || !client.id) {
    throw new Error('updateClient requires a client object with an "id" field.');
  }
  const existing = await getClientById(client.id);
  if (!existing) {
    throw new Error(`No client found with id "${client.id}".`);
  }
  const merged = { ...existing, ...client };

  const rows = await sql`
    UPDATE clients SET
      email = ${merged.email},
      display_name = ${merged.displayName},
      session_count = ${merged.sessionCount},
      hero_headline = ${merged.heroHeadline},
      next_session_at = ${merged.nextSessionAt},
      next_session_with = ${merged.nextSessionWith},
      next_session_format = ${merged.nextSessionFormat},
      reschedule_url = ${merged.rescheduleUrl},
      notion_page_id = ${merged.notionPageId}
    WHERE id = ${client.id}
    RETURNING *
  `;
  return rowToClient(rows[0]);
}

/**
 * Updates a client's password hash.
 * @param {string} id
 * @param {string} passwordHash
 * @returns {Promise<boolean>} true if a client was updated
 */
async function updateClientPassword(id, passwordHash) {
  const rows = await sql`
    UPDATE clients SET password_hash = ${passwordHash} WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Deletes a client (and, via ON DELETE CASCADE, all of their milestones).
 * @param {string} id
 * @returns {Promise<boolean>} true if a client was removed
 */
async function deleteClient(id) {
  const rows = await sql`DELETE FROM clients WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// MILESTONES (belong to a single client; flexible count per client)
// ---------------------------------------------------------------------------

function rowToMilestone(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    tag: row.tag,
    title: row.title,
    description: row.description,
    status: row.status,
    lockedReason: row.locked_reason,
    reflectionPrompt: row.reflection_prompt,
    sortOrder: row.sort_order,
    notionPageId: row.notion_page_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns all milestones for a given client, sorted by sortOrder.
 * @param {string} clientId
 * @returns {Promise<Array<Object>>}
 */
async function getMilestonesForClient(clientId) {
  const rows = await sql`
    SELECT * FROM milestones WHERE client_id = ${clientId} ORDER BY sort_order ASC
  `;
  return rows.map(rowToMilestone);
}

/**
 * Creates or updates a milestone (upsert by id).
 * @param {Object} milestone - must include id and clientId
 * @returns {Promise<Object>} the saved milestone
 */
async function saveMilestone(milestone) {
  if (!milestone || !milestone.id || !milestone.clientId) {
    throw new Error('saveMilestone requires a milestone object with "id" and "clientId" fields.');
  }

  const existingRows = await sql`SELECT * FROM milestones WHERE id = ${milestone.id}`;
  const existing = existingRows[0] ? rowToMilestone(existingRows[0]) : {};
  const merged = { ...existing, ...milestone };

  const rows = await sql`
    INSERT INTO milestones (id, client_id, tag, title, description, status, locked_reason, reflection_prompt, sort_order, notion_page_id)
    VALUES (
      ${merged.id}, ${merged.clientId}, ${merged.tag ?? null}, ${merged.title ?? null},
      ${merged.description ?? null}, ${merged.status ?? 'locked'}, ${merged.lockedReason ?? null},
      ${merged.reflectionPrompt ?? null}, ${merged.sortOrder ?? 0}, ${merged.notionPageId ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      tag = EXCLUDED.tag,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      locked_reason = EXCLUDED.locked_reason,
      reflection_prompt = EXCLUDED.reflection_prompt,
      sort_order = EXCLUDED.sort_order,
      notion_page_id = EXCLUDED.notion_page_id
    RETURNING *
  `;
  return rowToMilestone(rows[0]);
}

/**
 * Deletes a milestone by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a milestone was removed
 */
async function deleteMilestone(id) {
  const rows = await sql`DELETE FROM milestones WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// SESSIONS (past session history for a client — flexible count, same
// per-client pattern as milestones)
// ---------------------------------------------------------------------------

function rowToSession(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    sessionDate: row.session_date,
    topic: row.topic,
    sortOrder: row.sort_order,
    notionPageId: row.notion_page_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns all sessions for a client, most recent first.
 * @param {string} clientId
 * @returns {Promise<Array<Object>>}
 */
async function getSessionsForClient(clientId) {
  const rows = await sql`
    SELECT * FROM sessions WHERE client_id = ${clientId} ORDER BY session_date DESC, sort_order DESC
  `;
  return rows.map(rowToSession);
}

/**
 * Creates or updates a session record (upsert by id).
 * @param {Object} session - must include id and clientId
 * @returns {Promise<Object>} the saved session
 */
async function saveSession(session) {
  if (!session || !session.id || !session.clientId) {
    throw new Error('saveSession requires a session object with "id" and "clientId" fields.');
  }

  const existingRows = await sql`SELECT * FROM sessions WHERE id = ${session.id}`;
  const existing = existingRows[0] ? rowToSession(existingRows[0]) : {};
  const merged = { ...existing, ...session };

  const rows = await sql`
    INSERT INTO sessions (id, client_id, session_date, topic, sort_order, notion_page_id)
    VALUES (${merged.id}, ${merged.clientId}, ${merged.sessionDate}, ${merged.topic ?? null}, ${merged.sortOrder ?? 0}, ${merged.notionPageId ?? null})
    ON CONFLICT (id) DO UPDATE SET
      session_date = EXCLUDED.session_date,
      topic = EXCLUDED.topic,
      sort_order = EXCLUDED.sort_order,
      notion_page_id = EXCLUDED.notion_page_id
    RETURNING *
  `;
  return rowToSession(rows[0]);
}

/**
 * Deletes a session by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a session was removed
 */
async function deleteSession(id) {
  const rows = await sql`DELETE FROM sessions WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// RESOURCES (the "From Mahal" panel items — flexible count per client)
// ---------------------------------------------------------------------------

function rowToResource(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    heading: row.heading,
    body: row.body,
    sortOrder: row.sort_order,
    notionPageId: row.notion_page_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns all resources for a client, sorted by sortOrder.
 * @param {string} clientId
 * @returns {Promise<Array<Object>>}
 */
async function getResourcesForClient(clientId) {
  const rows = await sql`
    SELECT * FROM resources WHERE client_id = ${clientId} ORDER BY sort_order ASC
  `;
  return rows.map(rowToResource);
}

/**
 * Creates or updates a resource (upsert by id).
 * @param {Object} resource - must include id and clientId
 * @returns {Promise<Object>} the saved resource
 */
async function saveResource(resource) {
  if (!resource || !resource.id || !resource.clientId) {
    throw new Error('saveResource requires a resource object with "id" and "clientId" fields.');
  }

  const existingRows = await sql`SELECT * FROM resources WHERE id = ${resource.id}`;
  const existing = existingRows[0] ? rowToResource(existingRows[0]) : {};
  const merged = { ...existing, ...resource };

  const rows = await sql`
    INSERT INTO resources (id, client_id, heading, body, sort_order, notion_page_id)
    VALUES (${merged.id}, ${merged.clientId}, ${merged.heading ?? null}, ${merged.body ?? null}, ${merged.sortOrder ?? 0}, ${merged.notionPageId ?? null})
    ON CONFLICT (id) DO UPDATE SET
      heading = EXCLUDED.heading,
      body = EXCLUDED.body,
      sort_order = EXCLUDED.sort_order,
      notion_page_id = EXCLUDED.notion_page_id
    RETURNING *
  `;
  return rowToResource(rows[0]);
}

/**
 * Deletes a resource by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a resource was removed
 */
async function deleteResource(id) {
  const rows = await sql`DELETE FROM resources WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/**
 * Returns a client's full dashboard data in one call: profile, milestones,
 * sessions, and resources.
 * @param {string} clientId
 * @returns {Promise<{client: Object, milestones: Array, sessions: Array, resources: Array}|null>}
 */
async function getClientDashboard(clientId) {
  const client = await getClientById(clientId);
  if (!client) return null;
  const [milestones, sessions, resources] = await Promise.all([
    getMilestonesForClient(clientId),
    getSessionsForClient(clientId),
    getResourcesForClient(clientId),
  ]);
  return { client, milestones, sessions, resources };
}

// ---------------------------------------------------------------------------
// SITE CONTENT (singleton key/value content: founder bio, contact info, etc.)
// ---------------------------------------------------------------------------

/**
 * Returns the full siteContent object.
 * @returns {Promise<Object>}
 */
async function getSiteContent() {
  const rows = await sql`SELECT data FROM site_content WHERE id = 1`;
  return rows[0] ? rows[0].data : {};
}

/**
 * Merges the given partial object into siteContent and saves it.
 * @param {Object} partial
 * @returns {Promise<Object>} the full, updated siteContent object
 */
async function updateSiteContent(partial) {
  const current = await getSiteContent();
  const merged = { ...current, ...partial };

  const rows = await sql`
    INSERT INTO site_content (id, data)
    VALUES (1, ${JSON.stringify(merged)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    RETURNING data
  `;
  return rows[0].data;
}

// ---------------------------------------------------------------------------
// COMBINED FETCH (what the public site calls on page load)
// ---------------------------------------------------------------------------

/**
 * Returns everything the public site needs in one call: programs, books,
 * and siteContent, each already sorted where applicable.
 * @returns {Promise<{programs: Array, books: Array, siteContent: Object}>}
 */
async function getAllContent() {
  const [programs, books, siteContent] = await Promise.all([
    getPrograms(),
    getBooks(),
    getSiteContent(),
  ]);
  return { programs, books, siteContent };
}

module.exports = {
  getPrograms,
  saveProgram,
  deleteProgram,
  getBooks,
  saveBook,
  deleteBook,
  getUsers,
  getUserWithPasswordHash,
  createUser,
  updateUserPassword,
  deleteUser,
  getClients,
  getClientById,
  getClientByEmail,
  getClientWithPasswordHash,
  createClient,
  updateClient,
  updateClientPassword,
  deleteClient,
  getMilestonesForClient,
  saveMilestone,
  deleteMilestone,
  getSessionsForClient,
  saveSession,
  deleteSession,
  getResourcesForClient,
  saveResource,
  deleteResource,
  getClientDashboard,
  getSiteContent,
  updateSiteContent,
  getAllContent,
};
