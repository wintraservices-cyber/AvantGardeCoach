/**
 * api/_db.js
 * ---------------------------------------------------------------------------
 * Data-access layer for the Avant-Garde Coach CMS.
 *
 * WHY THIS FILE EXISTS
 * Every route handler (api/content.js, api/auth.js) calls the functions
 * exported here instead of touching storage directly. That means swapping
 * the placeholder JSON-file backend for a real database later is a change
 * confined entirely to this one file — no route handler, no admin UI code,
 * and no public-site fetch logic needs to change.
 *
 * CURRENT BACKEND: a JSON file on disk (../data/content.json).
 *
 * IMPORTANT PRODUCTION CAVEAT — READ BEFORE DEPLOYING
 * Vercel serverless functions run on an ephemeral filesystem in production.
 * Writes made by one invocation are NOT guaranteed to be visible to the next
 * invocation, and may vanish entirely on redeploy or cold start. This
 * JSON-file backend is suitable for:
 *   - local development (`vercel dev` / `node`), where the filesystem is
 *     the same process and writes persist normally
 *   - exercising the full CMS flow (admin login, edit, save, public fetch)
 *     end-to-end before a real database is provisioned
 * It is NOT suitable for production use once this site has real visitors
 * or a real client editing content live. Calling write operations in a
 * deployed Vercel environment will log a loud warning (see WRITE_GUARD
 * below) rather than fail silently, so a stale or lost write is obvious
 * during testing rather than discovered later as a confusing bug.
 *
 * SWAPPING IN A REAL DATABASE LATER
 * Once Vercel Postgres (or Neon, or any other DB) is provisioned:
 *   1. Add the DB connection env vars in Vercel (e.g. POSTGRES_URL).
 *   2. Replace the function bodies below with SQL queries using the same
 *      function signatures and return shapes documented above each one.
 *   3. Delete the JSON-file read/write helpers and WRITE_GUARD.
 *   4. Nothing in api/content.js, api/auth.js, or any HTML file needs to
 *      change — they only ever call getPrograms(), saveProgram(), etc.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'content.json');

// True when running on Vercel's deployed infrastructure (set automatically
// by Vercel at build/runtime). False in local dev (`vercel dev`, `node`,
// or any environment where you haven't set VERCEL yourself).
const IS_DEPLOYED = process.env.VERCEL === '1';

function warnIfDeployedWrite(operation) {
  if (IS_DEPLOYED) {
    // Intentionally loud. This is not an error we want to silently log and
    // move on from — the write the caller just made may not persist.
    console.warn(
      `[api/_db.js] WRITE_GUARD: "${operation}" was just called against the ` +
      `placeholder JSON-file backend while running on deployed Vercel ` +
      `infrastructure. This write is NOT guaranteed to persist — Vercel's ` +
      `serverless filesystem is ephemeral. Provision a real database and ` +
      `update api/_db.js before relying on saved content in production.`
    );
  }
}

function readAll() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeAll(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------

/**
 * Returns all programs, sorted by sortOrder ascending.
 * @returns {Promise<Array<Object>>}
 */
async function getPrograms() {
  const data = readAll();
  return [...data.programs].sort((a, b) => a.sortOrder - b.sortOrder);
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
  warnIfDeployedWrite('saveProgram');

  const data = readAll();
  const idx = data.programs.findIndex((p) => p.id === program.id);
  if (idx === -1) {
    data.programs.push(program);
  } else {
    data.programs[idx] = { ...data.programs[idx], ...program };
  }
  writeAll(data);
  return program;
}

/**
 * Deletes a program by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a program was removed
 */
async function deleteProgram(id) {
  warnIfDeployedWrite('deleteProgram');
  const data = readAll();
  const before = data.programs.length;
  data.programs = data.programs.filter((p) => p.id !== id);
  writeAll(data);
  return data.programs.length < before;
}

// ---------------------------------------------------------------------------
// BOOKS
// ---------------------------------------------------------------------------

/**
 * Returns all books, sorted by sortOrder ascending.
 * @returns {Promise<Array<Object>>}
 */
async function getBooks() {
  const data = readAll();
  return [...data.books].sort((a, b) => a.sortOrder - b.sortOrder);
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
  warnIfDeployedWrite('saveBook');

  const data = readAll();
  const idx = data.books.findIndex((b) => b.id === book.id);
  if (idx === -1) {
    data.books.push(book);
  } else {
    data.books[idx] = { ...data.books[idx], ...book };
  }
  writeAll(data);
  return book;
}

/**
 * Deletes a book by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a book was removed
 */
async function deleteBook(id) {
  warnIfDeployedWrite('deleteBook');
  const data = readAll();
  const before = data.books.length;
  data.books = data.books.filter((b) => b.id !== id);
  writeAll(data);
  return data.books.length < before;
}

// ---------------------------------------------------------------------------
// SITE CONTENT (singleton key/value content: founder bio, contact info, etc.)
// ---------------------------------------------------------------------------

/**
 * Returns the full siteContent object.
 * @returns {Promise<Object>}
 */
async function getSiteContent() {
  const data = readAll();
  return data.siteContent;
}

/**
 * Merges the given partial object into siteContent and saves it.
 * @param {Object} partial
 * @returns {Promise<Object>} the full, updated siteContent object
 */
async function updateSiteContent(partial) {
  warnIfDeployedWrite('updateSiteContent');
  const data = readAll();
  data.siteContent = { ...data.siteContent, ...partial };
  writeAll(data);
  return data.siteContent;
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
  getSiteContent,
  updateSiteContent,
  getAllContent,
};
