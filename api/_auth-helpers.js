/**
 * api/_auth-helpers.js
 * ---------------------------------------------------------------------------
 * Shared helpers used by api/auth.js (login) and api/content.js (checking
 * whether a request is authenticated before allowing a write).
 *
 * SESSION MODEL
 * On successful login, the server signs a small JSON payload
 * ({ email, issuedAt }) with HMAC-SHA256 using a secret, base64-encodes it,
 * and sets it as an HTTP-only cookie. On each subsequent request, the
 * server re-verifies the signature and checks expiry. No session store is
 * needed — the cookie IS the session, similar in spirit to a JWT but
 * deliberately simpler since this only ever needs to support two known
 * users (you and Mahal), not a general-purpose identity system.
 *
 * REQUIRED ENV VAR
 *   ADMIN_SESSION_SECRET — a long random string. Set this in Vercel's
 *   environment variables before deploying. In local dev, falls back to a
 *   fixed (insecure) string so the flow is testable without extra setup —
 *   this fallback must NEVER be relied on in production.
 *
 * USER STORE
 * For now, valid admin users live in api/_admin-users.js as a small static
 * list of { email, passwordHash } pairs (see that file for how to add or
 * change a password). This avoids needing a database table just to gate
 * two known people behind a login screen. If this ever needs to support
 * self-serve signup or more than a handful of people, move this to the
 * same database as the rest of the content.
 */

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'agc_admin_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    if (process.env.VERCEL === '1') {
      // Loud failure in production rather than silently using an insecure
      // fallback secret that anyone could forge a session against.
      throw new Error(
        'ADMIN_SESSION_SECRET is not set. Set it in Vercel project ' +
        'environment variables before using the admin panel in production.'
      );
    }
    return 'local-dev-insecure-fallback-secret-do-not-use-in-production';
  }
  return secret;
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('hex');
}

/**
 * Hashes a plaintext password with a random salt using PBKDF2.
 * Returns a single string "salt:hash" suitable for storing.
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
  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Creates a signed session token string for the given email.
 * @param {string} email
 * @returns {string} the cookie value to set
 */
function createSessionToken(email) {
  const payload = JSON.stringify({ email, issuedAt: Date.now() });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64');
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a session token string. Returns the decoded payload if valid
 * and not expired, or null otherwise.
 * @param {string} token
 * @returns {{email: string, issuedAt: number} | null}
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

  return payload;
}

/**
 * Parses the session cookie out of a request's Cookie header.
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
 * Convenience: given a request, returns the verified session payload or
 * null. Use this in any route that needs to gate on "is someone logged in".
 * @param {import('http').IncomingMessage} req
 * @returns {{email: string, issuedAt: number} | null}
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
