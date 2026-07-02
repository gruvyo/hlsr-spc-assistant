// Build-time step: turn kb/docs/*.md into embeddings the function can search.
// Runs on Netlify with OPENAI_API_KEY in the build environment. Writes
// netlify/functions/embeddings.json so it ships inside the function bundle
// (never served publicly). If the key is missing, writes an empty file so
// the deploy still succeeds and the bot reports it's not ready.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'kb', 'docs');
const OUT = join(ROOT, 'netlify', 'functions', 'embeddings.json');

const KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

// Pull the frontmatter fields we need, without a YAML dependency.
function parseDoc(raw, filename) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const front = m ? m[1] : '';
  const body = (m ? m[2] : raw).trim();
  const field = (name) => {
    const line = front.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
    return line ? line[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return {
    id: field('id') || filename.replace(/\.md$/, ''),
    title: field('title') || filename,
    category: field('category'),
    source_url: field('source_url'),
    portal_location: field('portal_location'),
    body,
  };
}

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function main() {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
  const docs = files.map((f) => parseDoc(readFileSync(join(DOCS_DIR, f), 'utf8'), f));

  if (!KEY) {
    console.warn('OPENAI_API_KEY not set. Writing empty embeddings.json.');
    writeFileSync(OUT, JSON.stringify({ model: EMBED_MODEL, docs: [] }));
    return;
  }

  // Embed title + body (capped) so retrieval matches on both.
  const inputs = docs.map((d) => `${d.title}\n\n${d.body}`.slice(0, 8000));

  const embeddings = [];
  const BATCH = 32;
  for (let i = 0; i < inputs.length; i += BATCH) {
    const vecs = await embedBatch(inputs.slice(i, i + BATCH));
    embeddings.push(...vecs);
    console.log(`Embedded ${Math.min(i + BATCH, inputs.length)}/${inputs.length}`);
  }

  const out = {
    model: EMBED_MODEL,
    docs: docs.map((d, i) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      source_url: d.source_url,
      portal_location: d.portal_location,
      content: d.body.slice(0, 4000),
      embedding: embeddings[i],
    })),
  };

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${out.docs.length} docs to embeddings.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
