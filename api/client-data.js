/**
 * api/client-data.js
 * ---------------------------------------------------------------------------
 * Returns the logged-in client's own dashboard data (profile + milestones),
 * and lets them save or delete their own reflection on a milestone.
 *
 * GET /api/client-data
 *   Requires a valid client session cookie (see api/client-auth.js).
 *   Returns { client, milestones, sessions, resources } for the SESSION'S
 *   OWN client id — never an id supplied by the request itself. This is
 *   the actual access-control guarantee: even if a request tried to pass
 *   a different clientId as a query param or body field, this route
 *   ignores that entirely and only ever uses the id baked into the
 *   verified session token. There is no code path here that lets one
 *   client fetch another client's data.
 *
 * POST /api/client-data   { action: "save-reflection", milestoneId, reflectionText, reflectionFollowup }
 *   Saves the client's reflection and the AI's follow-up question on one
 *   of their own milestones. Same ownership guarantee as GET: the
 *   milestone must belong to a client this client owns (verified by
 *   fetching the milestone via db.getMilestonesForClient(session.clientId)
 *   and confirming the given milestoneId is actually in that list —
 *   never trusting the milestoneId alone, since a malicious request
 *   could supply any other client's milestone id otherwise).
 *
 * DELETE /api/client-data   { milestoneId }
 *   Clears the client's own reflection on one of their own milestones —
 *   same ownership check as POST. Does not delete the milestone itself,
 *   only the reflection text/follow-up on it.
 *
 * PRIVACY NOTE: reflection content is intentionally NOT editable by
 * admins (see api/_db.js's saveClientReflection/deleteClientReflection —
 * the only functions that touch these columns, called only from here)
 * and NOT synced to Notion (see api/_notion.js's buildMilestoneProperties,
 * which never references these fields). A client's reflection is theirs
 * to write and remove; an admin can read it to prepare for a session,
 * but this route is the only place it can be created, changed, or
 * deleted.
 */

const db = require('./_db');
const { verifySessionFromRequest } = require('./_client-auth-helpers');

/**
 * Confirms the given milestoneId actually belongs to this client, by
 * checking it against their own real milestone list — never trusting a
 * milestoneId supplied in a request body on its own. Returns the
 * milestone if owned, or null if not (not found, or belongs to someone
 * else — both are treated identically, so a malicious request can't
 * distinguish "wrong id" from "someone else's id" through the response).
 * @param {string} clientId
 * @param {string} milestoneId
 * @returns {Promise<Object|null>}
 */
async function findOwnedMilestone(clientId, milestoneId) {
  const milestones = await db.getMilestonesForClient(clientId);
  return milestones.find((m) => m.id === milestoneId) || null;
}

module.exports = async function handler(req, res) {
  try {
    const session = verifySessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated. Please log in.' });
      return;
    }

    if (req.method === 'GET') {
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
      return;
    }

    if (req.method === 'POST') {
      const { action, milestoneId, reflectionText, reflectionFollowup } = req.body || {};

      if (action !== 'save-reflection') {
        res.status(400).json({ error: 'Unrecognized action.' });
        return;
      }
      if (!milestoneId) {
        res.status(400).json({ error: 'A milestoneId is required.' });
        return;
      }

      const owned = await findOwnedMilestone(session.clientId, milestoneId);
      if (!owned) {
        // Deliberately the same generic error whether the milestone
        // doesn't exist or belongs to someone else — not distinguishing
        // the two avoids leaking which milestone ids are valid at all.
        res.status(404).json({ error: 'Milestone not found.' });
        return;
      }

      const saved = await db.saveClientReflection(milestoneId, reflectionText || '', reflectionFollowup || '');
      res.status(200).json({ milestone: saved });
      return;
    }

    if (req.method === 'DELETE') {
      const { milestoneId } = req.body || {};
      if (!milestoneId) {
        res.status(400).json({ error: 'A milestoneId is required.' });
        return;
      }

      const owned = await findOwnedMilestone(session.clientId, milestoneId);
      if (!owned) {
        res.status(404).json({ error: 'Milestone not found.' });
        return;
      }

      const updated = await db.deleteClientReflection(milestoneId);
      res.status(200).json({ milestone: updated });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('[api/client-data.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
