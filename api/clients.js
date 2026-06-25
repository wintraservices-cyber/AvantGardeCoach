/**
 * api/clients.js
 * ---------------------------------------------------------------------------
 * Admin-only management of client accounts and their milestones. Gated by
 * the ADMIN session (see api/_auth-helpers.js) — this is distinct from
 * api/client-auth.js / api/client-data.js, which are what clients themselves
 * use to log in and see their own dashboard. An admin uses THIS route to
 * set up and edit any client's data.
 *
 * GET /api/clients
 *   Admin-only. Returns the list of all clients (id, email, displayName,
 *   etc. — never password hashes).
 *
 * GET /api/clients?id=<clientId>
 *   Admin-only. Returns one client's full dashboard data (profile +
 *   milestones) — the same shape a client would see via /api/client-data,
 *   so the admin can preview exactly what a client sees.
 *
 * POST /api/clients   { action: "create-client", email, password, displayName, ... }
 *   Admin-only. Creates a new client account.
 *
 * POST /api/clients   { action: "update-client", id, ...fields }
 *   Admin-only. Updates a client's profile fields (not password).
 *
 * POST /api/clients   { action: "reset-client-password", id, newPassword }
 *   Admin-only. Sets a new password for a client.
 *
 * POST /api/clients   { action: "save-milestone", id, clientId, ...fields }
 *   Admin-only. Creates or updates a milestone (upsert by id).
 *
 * DELETE /api/clients   { resource: "client", id }
 * DELETE /api/clients   { resource: "milestone", id }
 *   Admin-only. Deletes a client (cascades to their milestones) or a
 *   single milestone.
 */

const crypto = require('crypto');
const db = require('./_db');
const { hashPassword, verifySessionFromRequest } = require('./_auth-helpers');

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async function handler(req, res) {
  try {
    const session = verifySessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated. Please log in to the admin panel.' });
      return;
    }

    if (req.method === 'GET') {
      const { id } = req.query || {};
      if (id) {
        const dashboard = await db.getClientDashboard(id);
        if (!dashboard) {
          res.status(404).json({ error: 'No client found with that id.' });
          return;
        }
        res.status(200).json(dashboard);
        return;
      }
      const clients = await db.getClients();
      res.status(200).json({ clients });
      return;
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'create-client') {
        const { email, password, displayName, sessionCount, heroHeadline, nextSessionAt, nextSessionWith, nextSessionFormat, rescheduleUrl } = req.body || {};

        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'A valid email is required.' });
          return;
        }
        if (!password || password.length < 8) {
          res.status(400).json({ error: 'Password must be at least 8 characters.' });
          return;
        }
        if (!displayName || !displayName.trim()) {
          res.status(400).json({ error: 'A display name is required.' });
          return;
        }

        const existing = await db.getClientWithPasswordHash(email);
        if (existing) {
          res.status(409).json({ error: 'A client with this email already exists.' });
          return;
        }

        const newClient = await db.createClient({
          id: crypto.randomUUID(),
          email: email.trim(),
          passwordHash: hashPassword(password),
          displayName: displayName.trim(),
          sessionCount: sessionCount ?? 0,
          heroHeadline: heroHeadline || null,
          nextSessionAt: nextSessionAt || null,
          nextSessionWith: nextSessionWith || 'Mahal Hudson',
          nextSessionFormat: nextSessionFormat || 'Video call',
          rescheduleUrl: rescheduleUrl || null,
        });
        res.status(200).json({ client: newClient });
        return;
      }

      if (action === 'update-client') {
        const { id } = req.body || {};
        if (!id) {
          res.status(400).json({ error: 'A client id is required.' });
          return;
        }
        try {
          const updated = await db.updateClient(req.body);
          res.status(200).json({ client: updated });
        } catch (err) {
          res.status(404).json({ error: err.message });
        }
        return;
      }

      if (action === 'reset-client-password') {
        const { id, newPassword } = req.body || {};
        if (!id || !newPassword || newPassword.length < 8) {
          res.status(400).json({ error: 'A client id and a password of at least 8 characters are required.' });
          return;
        }
        const updated = await db.updateClientPassword(id, hashPassword(newPassword));
        if (!updated) {
          res.status(404).json({ error: 'No client found with that id.' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'save-milestone') {
        const { id, clientId } = req.body || {};
        if (!id || !clientId) {
          res.status(400).json({ error: 'A milestone id and clientId are required.' });
          return;
        }
        const saved = await db.saveMilestone(req.body);
        res.status(200).json({ milestone: saved });
        return;
      }

      if (action === 'save-session') {
        const { id, clientId, sessionDate, topic } = req.body || {};
        if (!id || !clientId) {
          res.status(400).json({ error: 'A session id and clientId are required.' });
          return;
        }
        if (!sessionDate) {
          res.status(400).json({ error: 'A session date is required.' });
          return;
        }
        const saved = await db.saveSession(req.body);
        res.status(200).json({ session: saved });
        return;
      }

      if (action === 'save-resource') {
        const { id, clientId, heading } = req.body || {};
        if (!id || !clientId) {
          res.status(400).json({ error: 'A resource id and clientId are required.' });
          return;
        }
        if (!heading || !heading.trim()) {
          res.status(400).json({ error: 'A heading is required.' });
          return;
        }
        const saved = await db.saveResource(req.body);
        res.status(200).json({ resource: saved });
        return;
      }

      res.status(400).json({ error: 'Unrecognized action.' });
      return;
    }

    if (req.method === 'DELETE') {
      const { resource, id } = req.body || {};
      if (!resource || !id) {
        res.status(400).json({ error: 'Both resource (one of "client", "milestone", "session", "resource") and id are required.' });
        return;
      }

      if (resource === 'client') {
        const deleted = await db.deleteClient(id);
        res.status(200).json({ deleted });
        return;
      }

      if (resource === 'milestone') {
        const deleted = await db.deleteMilestone(id);
        res.status(200).json({ deleted });
        return;
      }

      if (resource === 'session') {
        const deleted = await db.deleteSession(id);
        res.status(200).json({ deleted });
        return;
      }

      if (resource === 'resource') {
        const deleted = await db.deleteResource(id);
        res.status(200).json({ deleted });
        return;
      }

      res.status(400).json({ error: 'resource must be "client", "milestone", "session", or "resource".' });
      return;
    }

    res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('[api/clients.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
