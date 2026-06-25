/**
 * api/client-data.js
 * ---------------------------------------------------------------------------
 * Returns the logged-in client's own dashboard data (profile + milestones).
 *
 * GET /api/client-data
 *   Requires a valid client session cookie (see api/client-auth.js).
 *   Returns { client, milestones } for the SESSION'S OWN client id —
 *   never an id supplied by the request itself. This is the actual
 *   access-control guarantee: even if a request tried to pass a
 *   different clientId as a query param or body field, this route
 *   ignores that entirely and only ever uses the id baked into the
 *   verified session token. There is no code path here that lets one
 *   client fetch another client's data.
 */

const db = require('./_db');
const { verifySessionFromRequest } = require('./_client-auth-helpers');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const session = verifySessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated. Please log in.' });
      return;
    }

    const dashboard = await db.getClientDashboard(session.clientId);
    if (!dashboard) {
      // The session is validly signed, but the client it points to no
      // longer exists (e.g. an admin deleted the account after this
      // session was issued). Treat this as "not authenticated" rather
      // than a server error — from the visitor's perspective, they
      // should just be asked to log in again.
      res.status(401).json({ error: 'This account no longer exists. Please log in again.' });
      return;
    }

    res.status(200).json(dashboard);
  } catch (err) {
    console.error('[api/client-data.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
