/**
 * api/_client-auth-helpers.js
 * ---------------------------------------------------------------------------
 * Session helpers for CLIENT accounts — structurally separate from
 * api/_auth-helpers.js (which is for admins only).
 *
 * WHY THIS IS A SEPARATE FILE, NOT A SHARED ONE
 * Clients and admins are different identity spaces with different
 * privileges: a client should only ever be able to see their own
 * dashboard data, while an admin can edit anyone's. Using the exact same
 * cookie name and secret for both would create a real risk — a sloppy
 * check somewhere down the line (`if (session) { ...admin stuff... }`
 * without confirming *which kind* of session) could accidentally treat a
 * client session as an admin session. Giving clients their own cookie
 * name (agc_client_session) and their own secret (CLIENT_SESSION_SECRET)
 * makes that class of mistake structurally impossible — checking for an
 * admin session and finding a client cookie (or vice versa) simply finds
 * nothing, by construction, not by remembering to check carefully every
 * time. The underlying crypto logic mirrors api/_auth-helpers.js closely,
 * since that pattern is already correct and tested — this isn't a
 * different design, just a separate namespace for it.
 *
 * REQUIRED ENV VAR
 *   CLIENT_SESSION_SECRET — a long random string, DIFFERENT from
 *   ADMIN_SESSION_SECRET. Set this in Vercel's environment variables
 *   before deploying. In local dev, falls back to a fixed (insecure)
 *   string so the flow is testable without extra setup — this fallback
 *   must NEVER be relied on in production.
 *
 * USER STORE
 * Unlike admins (a small static list in _admin-users.js), clients live
 * in the `clients` database table, since this needs to support an
 * arbitrary, growing number of real coaching clients — see api/_db.js.
 */

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'agc_client_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — clients log in less often than admins editing content

function getSecret() {
  const secret = process.env.CLIENT_SESSION_SECRET;
  if (!secret) {
    if (process.env.VERCEL === '1') {
      throw new Error(
        'CLIENT_SESSION_SECRET is not set. Set it in Vercel project ' +
        'environment variables before using client login in production.'
      );
    }
    return 'local-dev-insecure-client-fallback-secret-do-not-use-in-production';
  }
  return secret;
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('hex');
}

/**
 * Hashes a plaintext password with a random salt using PBKDF2. Same
 * algorithm/parameters as the admin version in _auth-helpers.js — not
 * shared code, but deliberately identical so client and admin password
 * security is equally strong, just stored in different tables.
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string.
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
function verifyPassword(password, stored) {
  const [salt, originalHash] = (stored || '').split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Creates a signed session token for the given client id + email.
 * @param {string} clientId
 * @param {string} email
 * @returns {string} the cookie value to set
 */
function createSessionToken(clientId, email) {
  const payload = JSON.stringify({ clientId, email, issuedAt: Date.now() });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64');
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a session token string. Returns the decoded payload if valid
 * and not expired, or null otherwise.
 * @param {string} token
 * @returns {{clientId: string, email: string, issuedAt: number} | null}
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  const expectedSignature = sign(payloadB64);

  const sigBuf = Buffer.from(signature || '', 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
  } catch (e) {
    return null;
  }

  if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_MAX_AGE_MS) {
    return null; // expired
  }
  if (!payload.clientId) {
    return null; // malformed — every valid client session must carry a clientId
  }

  return payload;
}

/**
 * Parses the client session cookie out of a request's Cookie header.
 * @param {import('http').IncomingMessage} req
 * @returns {string | null}
 */
function getSessionTokenFromRequest(req) {
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const c of cookies) {
    if (c.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return decodeURIComponent(c.slice(SESSION_COOKIE_NAME.length + 1));
    }
  }
  return null;
}

/**
 * Convenience: given a request, returns the verified client session
 * payload or null.
 * @param {import('http').IncomingMessage} req
 * @returns {{clientId: string, email: string, issuedAt: number} | null}
 */
function verifySessionFromRequest(req) {
  const token = getSessionTokenFromRequest(req);
  return verifySessionToken(token);
}

/**
 * Builds the Set-Cookie header value for logging in.
 * @param {string} token
 * @returns {string}
 */
function buildLoginCookie(token) {
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * Builds the Set-Cookie header value for logging out (clears the cookie).
 * @returns {string}
 */
function buildLogoutCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  verifySessionFromRequest,
  buildLoginCookie,
  buildLogoutCookie,
};
