/**
 * db/seed-demo-client.js
 * ---------------------------------------------------------------------------
 * One-time script: creates a sample client account so you can test the
 * real dashboard (and the "View demo dashboard" button) before the admin
 * UI for managing clients exists.
 *
 * CREDENTIALS THIS CREATES (also referenced in dashboard.html's demo button)
 *   email:    demo@avant-gardecoach.ca
 *   password: DemoClient2026!
 *
 * Change this password later via the admin Clients tab once it exists, or
 * by re-running this script with a different PASSWORD constant below and
 * using the admin reset-password action — this script itself is safe to
 * re-run (it upserts by email), but re-running with the SAME password
 * obviously won't change anything.
 *
 * USAGE
 *   node db/seed-demo-client.js
 *
 * Requires the same setup as the earlier seed scripts: DATABASE_URL
 * available via `vercel env pull .env.local --environment=production`
 * (or set manually), and `npm install` already run.
 */

require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run `vercel env pull .env.local --environment=production` first.'
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const EMAIL = 'demo@avant-gardecoach.ca';
const PASSWORD = 'DemoClient2026!';

// Mirrors hashPassword() in api/_client-auth-helpers.js exactly — duplicated
// here rather than imported, since this script runs standalone via `node`
// outside of Vercel's function environment, and importing across that
// boundary isn't worth the complexity for a one-time seed script.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const clientId = crypto.randomUUID();
  const passwordHash = hashPassword(PASSWORD);

  console.log(`Creating/updating demo client (${EMAIL})...`);

  // Upsert by email so re-running this script doesn't create duplicates.
  const existing = await sql`SELECT id FROM clients WHERE lower(email) = lower(${EMAIL})`;
  let actualClientId;

  if (existing[0]) {
    actualClientId = existing[0].id;
    await sql`
      UPDATE clients SET
        display_name = 'Jordan Avery',
        session_count = 3,
        hero_headline = 'Three sessions in. The thread is coming back.',
        next_session_at = NOW() + INTERVAL '2 days',
        next_session_with = 'Mahal Hudson',
        next_session_format = 'Video call',
        reschedule_url = 'https://cal.com/wintra-services-mkzw1b/appointment'
      WHERE id = ${actualClientId}
    `;
    console.log(`  ✓ Updated existing client (id: ${actualClientId})`);
  } else {
    actualClientId = clientId;
    await sql`
      INSERT INTO clients (id, email, password_hash, display_name, session_count, hero_headline, next_session_at, next_session_with, next_session_format, reschedule_url)
      VALUES (
        ${actualClientId}, ${EMAIL}, ${passwordHash}, 'Jordan Avery', 3,
        'Three sessions in. The thread is coming back.',
        NOW() + INTERVAL '2 days', 'Mahal Hudson', 'Video call',
        'https://cal.com/wintra-services-mkzw1b/appointment'
      )
    `;
    console.log(`  ✓ Created new client (id: ${actualClientId})`);
  }

  console.log('Creating milestones...');

  const milestones = [
    {
      id: `${actualClientId}-m1`,
      tag: 'Standing Question I',
      title: "Naming the decision you've been circling",
      description: "Get the decision out of your head and onto the table — what it actually is, and what's been making it hard to trust your own read on it.",
      status: 'complete',
      reflectionPrompt: '"What did you decide, and what finally made it clear?"',
      sortOrder: 1,
    },
    {
      id: `${actualClientId}-m2`,
      tag: 'Standing Question II',
      title: "Having the conversation you've been avoiding",
      description: "Map out what you actually need to say, separate from how you're afraid it'll land — then plan when and how to say it.",
      status: 'active',
      reflectionPrompt: '"What\'s the one sentence you keep avoiding saying out loud?"',
      sortOrder: 2,
    },
    {
      id: `${actualClientId}-m3`,
      tag: 'Standing Question III',
      title: 'Picking the thread back up',
      description: 'Reconnect with the version of yourself that had a clear sense of direction — and figure out what\'s worth carrying forward.',
      status: 'locked',
      lockedReason: 'Unlocks after Session 4',
      sortOrder: 3,
    },
    {
      id: `${actualClientId}-m4`,
      tag: 'Standing Question IV',
      title: "Catching up to who you've become",
      description: 'Name the transformation that\'s already happened, and build the version of your routine that actually fits it.',
      status: 'locked',
      lockedReason: 'Unlocks after Session 4',
      sortOrder: 4,
    },
  ];

  for (const m of milestones) {
    await sql`
      INSERT INTO milestones (id, client_id, tag, title, description, status, locked_reason, reflection_prompt, sort_order)
      VALUES (
        ${m.id}, ${actualClientId}, ${m.tag}, ${m.title}, ${m.description},
        ${m.status}, ${m.lockedReason || null}, ${m.reflectionPrompt || null}, ${m.sortOrder}
      )
      ON CONFLICT (id) DO UPDATE SET
        tag = EXCLUDED.tag, title = EXCLUDED.title, description = EXCLUDED.description,
        status = EXCLUDED.status, locked_reason = EXCLUDED.locked_reason,
        reflection_prompt = EXCLUDED.reflection_prompt, sort_order = EXCLUDED.sort_order
    `;
    console.log(`  ✓ ${m.id} (${m.status})`);
  }

  console.log();
  console.log('Demo client seeded successfully.');
  console.log(`Login at /dashboard with: ${EMAIL} / ${PASSWORD}`);
  console.log('(Same credentials the "View demo dashboard" button uses.)');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
