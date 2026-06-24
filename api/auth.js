/**
 * api/auth.js
 * ---------------------------------------------------------------------------
 * Serverless function: admin login, logout, and session check.
 *
 * POST /api/auth   { action: "login", email, password }
 *   Verifies credentials against api/_admin-users.js. On success, sets a
 *   signed session cookie and returns { ok: true, email }.
 *   On failure, returns 401 with a generic error (doesn't reveal whether
 *   the email or password was wrong, to avoid leaking which emails are
 *   valid admin accounts).
 *
 * POST /api/auth   { action: "logout" }
 *   Clears the session cookie.
 *
 * GET  /api/auth
 *   Returns { authenticated: true, email } if the request has a valid
 *   session cookie, or { authenticated: false } otherwise. The admin UI
 *   calls this on load to decide whether to show the login screen or the
 *   editor.
 */

const { findAdminUser } = require('./_admin-users');
const {
  verifyPassword,
  createSessionToken,
  verifySessionFromRequest,
  buildLoginCookie,
  buildLogoutCookie,
} = require('./_auth-helpers');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const session = verifySessionFromRequest(req);
      if (session) {
        res.status(200).json({ authenticated: true, email: session.email });
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

        const user = findAdminUser(email);
        const valid = user && verifyPassword(password, user.passwordHash);

        if (!valid) {
          // Deliberately generic: don't reveal whether the email exists.
          res.status(401).json({ error: 'Incorrect email or password.' });
          return;
        }

        const token = createSessionToken(user.email);
        res.setHeader('Set-Cookie', buildLoginCookie(token));
        res.status(200).json({ ok: true, email: user.email });
        return;
      }

      res.status(400).json({ error: 'action must be "login" or "logout".' });
      return;
    }

    res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('[api/auth.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
