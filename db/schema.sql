CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  tag TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price_label TEXT,
  price_tbd BOOLEAN DEFAULT true,
  features JSONB DEFAULT '[]'::jsonb,
  featured BOOLEAN DEFAULT false,
  cta_text TEXT,
  cta_href TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  featured BOOLEAN DEFAULT false,
  tag TEXT,
  title TEXT NOT NULL,
  blurb TEXT,
  amazon_url TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO site_content (id, data)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;