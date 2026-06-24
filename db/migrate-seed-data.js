require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run `vercel env pull .env.local` first, ' +
    'or set DATABASE_URL in your shell before running this script.'
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const dataPath = path.join(__dirname, '..', 'data', 'content.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  console.log(`Migrating ${data.programs.length} programs...`);
  for (const p of data.programs) {
    await sql`
      INSERT INTO programs (id, tag, name, description, price_label, price_tbd, features, featured, cta_text, cta_href, sort_order)
      VALUES (
        ${p.id}, ${p.tag ?? null}, ${p.name ?? null}, ${p.description ?? null},
        ${p.priceLabel ?? null}, ${p.priceTbd ?? true},
        ${JSON.stringify(p.features ?? [])}::jsonb, ${p.featured ?? false},
        ${p.ctaText ?? null}, ${p.ctaHref ?? null}, ${p.sortOrder ?? 0}
      )
      ON CONFLICT (id) DO UPDATE SET
        tag = EXCLUDED.tag, name = EXCLUDED.name, description = EXCLUDED.description,
        price_label = EXCLUDED.price_label, price_tbd = EXCLUDED.price_tbd,
        features = EXCLUDED.features, featured = EXCLUDED.featured,
        cta_text = EXCLUDED.cta_text, cta_href = EXCLUDED.cta_href, sort_order = EXCLUDED.sort_order
    `;
    console.log(`  ✓ ${p.id}`);
  }

  console.log(`Migrating ${data.books.length} books...`);
  for (const b of data.books) {
    await sql`
      INSERT INTO books (id, featured, tag, title, blurb, amazon_url, sort_order)
      VALUES (
        ${b.id}, ${b.featured ?? false}, ${b.tag ?? null}, ${b.title ?? null},
        ${b.blurb ?? null}, ${b.amazonUrl ?? null}, ${b.sortOrder ?? 0}
      )
      ON CONFLICT (id) DO UPDATE SET
        featured = EXCLUDED.featured, tag = EXCLUDED.tag, title = EXCLUDED.title,
        blurb = EXCLUDED.blurb, amazon_url = EXCLUDED.amazon_url, sort_order = EXCLUDED.sort_order
    `;
    console.log(`  ✓ ${b.id}`);
  }

  console.log('Migrating site content...');
  await sql`
    INSERT INTO site_content (id, data)
    VALUES (1, ${JSON.stringify(data.siteContent)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
  `;
  console.log('  ✓ site content');

  console.log();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});