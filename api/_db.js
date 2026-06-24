const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function rowToProgram(row) {
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    description: row.description,
    priceLabel: row.price_label,
    priceTbd: row.price_tbd,
    features: row.features || [],
    featured: row.featured,
    ctaText: row.cta_text,
    ctaHref: row.cta_href,
    sortOrder: row.sort_order,
  };
}

function rowToBook(row) {
  return {
    id: row.id,
    featured: row.featured,
    tag: row.tag,
    title: row.title,
    blurb: row.blurb,
    amazonUrl: row.amazon_url,
    sortOrder: row.sort_order,
  };
}

async function getPrograms() {
  const rows = await sql`SELECT * FROM programs ORDER BY sort_order ASC`;
  return rows.map(rowToProgram);
}

async function saveProgram(program) {
  if (!program || !program.id) {
    throw new Error('saveProgram requires a program object with an "id" field.');
  }

  const existingRows = await sql`SELECT * FROM programs WHERE id = ${program.id}`;
  const existing = existingRows[0] ? rowToProgram(existingRows[0]) : {};
  const merged = { ...existing, ...program };

  const rows = await sql`
    INSERT INTO programs (id, tag, name, description, price_label, price_tbd, features, featured, cta_text, cta_href, sort_order)
    VALUES (
      ${merged.id},
      ${merged.tag ?? null},
      ${merged.name ?? null},
      ${merged.description ?? null},
      ${merged.priceLabel ?? null},
      ${merged.priceTbd ?? true},
      ${JSON.stringify(merged.features ?? [])}::jsonb,
      ${merged.featured ?? false},
      ${merged.ctaText ?? null},
      ${merged.ctaHref ?? null},
      ${merged.sortOrder ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      tag = EXCLUDED.tag,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price_label = EXCLUDED.price_label,
      price_tbd = EXCLUDED.price_tbd,
      features = EXCLUDED.features,
      featured = EXCLUDED.featured,
      cta_text = EXCLUDED.cta_text,
      cta_href = EXCLUDED.cta_href,
      sort_order = EXCLUDED.sort_order
    RETURNING *
  `;
  return rowToProgram(rows[0]);
}

async function deleteProgram(id) {
  const rows = await sql`DELETE FROM programs WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function getBooks() {
  const rows = await sql`SELECT * FROM books ORDER BY sort_order ASC`;
  return rows.map(rowToBook);
}

async function saveBook(book) {
  if (!book || !book.id) {
    throw new Error('saveBook requires a book object with an "id" field.');
  }

  const existingRows = await sql`SELECT * FROM books WHERE id = ${book.id}`;
  const existing = existingRows[0] ? rowToBook(existingRows[0]) : {};
  const merged = { ...existing, ...book };

  const rows = await sql`
    INSERT INTO books (id, featured, tag, title, blurb, amazon_url, sort_order)
    VALUES (
      ${merged.id},
      ${merged.featured ?? false},
      ${merged.tag ?? null},
      ${merged.title ?? null},
      ${merged.blurb ?? null},
      ${merged.amazonUrl ?? null},
      ${merged.sortOrder ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      featured = EXCLUDED.featured,
      tag = EXCLUDED.tag,
      title = EXCLUDED.title,
      blurb = EXCLUDED.blurb,
      amazon_url = EXCLUDED.amazon_url,
      sort_order = EXCLUDED.sort_order
    RETURNING *
  `;
  return rowToBook(rows[0]);
}

async function deleteBook(id) {
  const rows = await sql`DELETE FROM books WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function getSiteContent() {
  const rows = await sql`SELECT data FROM site_content WHERE id = 1`;
  return rows[0] ? rows[0].data : {};
}

async function updateSiteContent(partial) {
  const current = await getSiteContent();
  const merged = { ...current, ...partial };

  const rows = await sql`
    INSERT INTO site_content (id, data)
    VALUES (1, ${JSON.stringify(merged)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    RETURNING data
  `;
  return rows[0].data;
}

async function getAllContent() {
  const [programs, books, siteContent] = await Promise.all([
    getPrograms(),
    getBooks(),
    getSiteContent(),
  ]);
  return { programs, books, siteContent };
}

module.exports = {
  getPrograms,
  saveProgram,
  deleteProgram,
  getBooks,
  saveBook,
  deleteBook,
  getSiteContent,
  updateSiteContent,
  getAllContent,
};