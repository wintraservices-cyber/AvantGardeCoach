require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { ADMIN_USERS } = require('../api/_admin-users');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run `vercel env pull .env.local --environment=production` first.'
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log(`Migrating ${ADMIN_USERS.length} seed admin account(s)...`);

  for (const user of ADMIN_USERS) {
    await sql`
      INSERT INTO users (id, email, password_hash)
      VALUES (${crypto.randomUUID()}, ${user.email}, ${user.passwordHash})
      ON CONFLICT (email) DO NOTHING
    `;
    console.log(`  ✓ ${user.email}`);
  }

  console.log();
  console.log('Migration complete. You can now log in using the database-backed');
  console.log('auth system. Remember to change the seed password if you have not already.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});