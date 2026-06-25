/**
 * api/client-auth.js
 * ---------------------------------------------------------------------------
 * Serverless function: client login, logout, and session check. Mirrors
 * api/auth.js's shape exactly, but for client accounts instead of admins —
 * see api/_client-auth-helpers.js for why this is a separate cookie/secret
 * namespace rather than reusing the admin one.
 *
 * POST /api/client-auth   { action: "login", email, password }
 *   Verifies credentials against the clients table. On success, sets a
 *   signed session cookie and returns { ok: true, clientId, email }.
 *
 * POST /api/client-auth   { action: "logout" }
 *   Clears the session cookie.
 *
 * GET  /api/client-auth
 *   Returns { authenticated: true, clientId, email } if the request has a
 *   valid client session cookie, or { authenticated: false } otherwise.
 */

const db = require('./_db');
const {
  verifyPassword,
  createSessionToken,
  verifySessionFromRequest,
  buildLoginCookie,
  buildLogoutCookie,
} = require('./_client-auth-helpers');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const session = verifySessionFromRequest(req);
      if (session) {
        res.status(200).json({ authenticated: true, clientId: session.clientId, email: session.email });
      } else {
        res.status(200).json({ authenticated: false });
      }
      return;
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'logout') {
        res.setHeader('Set-Cookie', buildLogoutCookie());
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'login') {
        const { email, password } = req.body || {};
        if (!email || !password) {
          res.status(400).json({ error: 'Email and password are required.' });
          return;
        }

        const client = await db.getClientWithPasswordHash(email);
        const valid = client && verifyPassword(password, client.passwordHash);

        if (!valid) {
          // Deliberately generic: don't reveal whether the email exists.
          res.status(401).json({ error: 'Incorrect email or password.' });
          return;
        }

        const token = createSessionToken(client.id, client.email);
        res.setHeader('Set-Cookie', buildLoginCookie(token));
        res.status(200).json({ ok: true, clientId: client.id, email: client.email });
        return;
      }

      res.status(400).json({ error: 'action must be "login" or "logout".' });
      return;
    }

    res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('[api/client-auth.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
