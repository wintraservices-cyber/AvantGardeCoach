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
      const users = await db.getUsers();
      res.status(200).json({ users });
      return;
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'create') {
        const { email, password } = req.body || {};
        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'A valid email is required.' });
          return;
        }
        if (!password || password.length < 8) {
          res.status(400).json({ error: 'Password must be at least 8 characters.' });
          return;
        }

        const existing = await db.getUserWithPasswordHash(email);
        if (existing) {
          res.status(409).json({ error: 'An admin with this email already exists.' });
          return;
        }

        const newUser = await db.createUser({
          id: crypto.randomUUID(),
          email: email.trim(),
          passwordHash: hashPassword(password),
        });
        res.status(200).json({ user: newUser });
        return;
      }

      if (action === 'reset-password') {
        const { id, newPassword } = req.body || {};
        if (!id || !newPassword || newPassword.length < 8) {
          res.status(400).json({ error: 'A user id and a password of at least 8 characters are required.' });
          return;
        }

        const updated = await db.updateUserPassword(id, hashPassword(newPassword));
        if (!updated) {
          res.status(404).json({ error: 'No user found with that id.' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'action must be "create" or "reset-password".' });
      return;
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        res.status(400).json({ error: 'A user id is required.' });
        return;
      }

      const allUsers = await db.getUsers();
      if (allUsers.length <= 1) {
        res.status(400).json({ error: 'Cannot delete the only remaining admin account.' });
        return;
      }

      const deleted = await db.deleteUser(id);
      res.status(200).json({ deleted });
      return;
    }

    res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('[api/users.js] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};