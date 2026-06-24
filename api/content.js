/**
 * api/content.js
 * ---------------------------------------------------------------------------
 * Serverless function: content read/write API for the CMS.
 *
 * GET  /api/content
 *   Public. No authentication required. Returns everything the live site
 *   needs to render: { programs, books, siteContent }.
 *
 * POST /api/content   { resource: "program" | "book", item: {...} }
 *   Admin-only. Upserts a program or book (create if id is new, update if
 *   id exists). Requires a valid session cookie (see api/auth.js).
 *
 * DELETE /api/content   { resource: "program" | "book", id: "..." }
 *   Admin-only. Deletes a program or book by id.
 *
 * PUT /api/content   { siteContent: { ...partial fields... } }
 *   Admin-only. Merges the given fields into the singleton siteContent
 *   object (founder bio, contact info, etc.) and saves it.
 *
 * All admin-only operations check the session cookie set by api/auth.js.
 * See requireSession() below.
 */

const db = require('./_db');
const { verifySessionFromRequest } = require('./_auth-helpers');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const all = await db.getAllContent();
      res.status(200).json(all);
      return;
    }

    // Every other method below mutates content — require a valid session.
    const session = verifySessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated. Please log in to the admin panel.' });
      return;
    }

    if (req.method === 'POST') {
      const { resource, item } = req.body || {};
      if (!resource || !item || !item.id) {
        res.status(400).json({ error: 'Request must include { resource, item } and item.id.' });
        return;
      }
      if (resource === 'program') {
        const saved = await db.saveProgram(item);
        res.status(200).json({ saved });
        return;
      }
      if (resource === 'book') {
        const saved = await db.saveBook(item);
        res.status(200).json({ saved });
        return;
      }
      res.status(400).json({ error: 'resource must be "program" or "book".' });
      return;
    }

    if (req.method === 'DELETE') {
      const { resource, id } = req.body || {};
      if (!resource || !id) {
        res.status(400).json({ error: 'Request must include { resource, id }.' });
        return;
      }
      if (resource === 'program') {
        const deleted = await db.deleteProgram(id);
        res.status(200).json({ deleted });
        return;
      }
      if (resource === 'book') {
        const deleted = await db.deleteBook(id);
        res.status(200).json({ deleted });
        return;
      }
      res.status(400).json({ error: 'resource must be "program" or "book".' });
      return;
    }

    if (req.method === 'PUT') {
      const { siteContent } = req.body || {};
      if (!siteContent || typeof siteContent !== 'object') {
        res.status(400).json({ error: 'Request must include a siteContent object.' });
        return;
      }
      const updated = await db.updateSiteContent(siteContent);
      res.status(200).json({ siteContent: updated });
      return;
    }

    res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('[api/content.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
