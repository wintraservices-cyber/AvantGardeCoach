/**
 * api/_admin-users.js
 * ---------------------------------------------------------------------------
 * The small, known set of people allowed to log into the admin panel.
 *
 * Each entry is { email, passwordHash }. passwordHash is generated with
 * hashPassword() from api/_auth-helpers.js — never store a plaintext
 * password here.
 *
 * TO ADD OR CHANGE A USER
 * Run this once (e.g. `node -e "..."` from the project root, or a small
 * throwaway script) to generate a hash for a new password:
 *
 *   const { hashPassword } = require('./api/_auth-helpers');
 *   console.log(hashPassword('the-new-password'));
 *
 * Then paste the printed "salt:hash" string in as passwordHash below.
 *
 * SEED CREDENTIALS (placeholder — change before sharing access)
 *   email:    you@avant-gardecoach.ca
 *   password: change-me-immediately
 *
 * This file intentionally lives in source rather than the database, since
 * it's just two people gating access to a CMS, not a general user system.
 * If this ever needs to grow past a handful of known users, move it into
 * the same database as the rest of the content and look users up by email
 * instead of scanning a static array.
 */

const ADMIN_USERS = [
  {
    email: 'you@avant-gardecoach.ca',
    // Hash of the placeholder password "change-me-immediately".
    // CHANGE THIS before sharing the admin URL with anyone.
    passwordHash:
      '5a929c052ba50adc8441a989990e43cb:b978ac111655b6107c254bdd968f3c206650044a06b44d3032facd3153f344896fa2ee976a368008ccc4ab7208b8b83635f043d5c98daa8a2f7836c9062d6aa6',
  },
  // Add Mahal's account here once you've generated her own password hash:
  // {
  //   email: 'mahal@avant-gardecoach.ca',
  //   passwordHash: '...',
  // },
];

/**
 * Finds an admin user by email (case-insensitive).
 * @param {string} email
 * @returns {{email: string, passwordHash: string} | undefined}
 */
function findAdminUser(email) {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  return ADMIN_USERS.find((u) => u.email.toLowerCase() === normalized);
}

module.exports = { ADMIN_USERS, findAdminUser };
