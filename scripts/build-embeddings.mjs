// Build-time step: turn kb/docs/*.md into SECTION-LEVEL embeddings the function
// can search. Each doc is split into chunks on its markdown headings so a query
// matches the specific relevant section, not a blurred whole-doc vector.
//
// Runs at deploy with OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_EMBED_MODEL in
// the build env. Writes netlify/functions/embeddings.json (bundled with the
// function, never served). If USE_COMMITTED_EMBEDDINGS is set and a committed
// embeddings.json exists, it is used as-is with no re-embedding. That lets one
// host serve a precomputed index (e.g. Gemini) while another re-embeds with its
// own model at build.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'kb', 'docs');
const OUT = join(ROOT, 'netlify', 'functions', 'embeddings.json');

const KEY = process.env.OPENAI_API_KEY;
const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const MAX_CHUNK = 3500; // chars per chunk; keep sections focused

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

// Split a doc body into section chunks on ## / ### headings. Content before the
// first heading rides as its own chunk (the quick-answer/intro). Over-long
// sections are hard-split on paragraph boundaries.
function chunkDoc(doc) {
  const sections = [];
  let cur = { heading: '', lines: [] };
  for (const line of doc.body.split('\n')) {
    if (/^#{2,3}\s+/.test(line)) {
      if (cur.heading || cur.lines.join('\n').trim()) sections.push(cur);
      cur = { heading: line.replace(/^#{1,6}\s+/, '').trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.heading || cur.lines.join('\n').trim()) sections.push(cur);

  const chunks = [];
  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (!text && !s.heading) continue;
    if (text.length <= MAX_CHUNK) {
      chunks.push({ heading: s.heading, content: text });
      continue;
    }
    let buf = '';
    for (const para of text.split(/\n\n+/)) {
      if (buf && (buf + '\n\n' + para).length > MAX_CHUNK) { chunks.push({ heading: s.heading, content: buf }); buf = para; }
      else buf = buf ? buf + '\n\n' + para : para;
    }
    if (buf) chunks.push({ heading: s.heading, content: buf });
  }
  if (!chunks.length) chunks.push({ heading: '', content: doc.body.slice(0, MAX_CHUNK) });
  return chunks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Embed one chunk, retrying on rate limits (429) and transient 5xx with backoff.
async function embedOne(text) {
  const waits = [3000, 6000, 12000, 24000, 48000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
    if (res.ok) return (await res.json()).data[0].embedding;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= waits.length) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`);
    console.log(`  throttled (${res.status}), waiting ${waits[attempt] / 1000}s...`);
    await sleep(waits[attempt]);
  }
}

async function main() {
  if (process.env.USE_COMMITTED_EMBEDDINGS && existsSync(OUT)) {
    console.log('USE_COMMITTED_EMBEDDINGS set; using the committed embeddings.json as-is (no re-embed).');
    return;
  }

  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
  const docs = files.map((f) => parseDoc(readFileSync(join(DOCS_DIR, f), 'utf8'), f));

  if (!KEY) {
    console.warn('OPENAI_API_KEY not set. Writing empty embeddings.json.');
    writeFileSync(OUT, JSON.stringify({ model: EMBED_MODEL, chunks: [] }));
    return;
  }

  const chunks = [];
  for (const d of docs) {
    for (const c of chunkDoc(d)) {
      chunks.push({
        doc_id: d.id,
        title: d.title,
        category: d.category,
        source_url: d.source_url,
        portal_location: d.portal_location,
        heading: c.heading,
        content: c.content,
      });
    }
  }

  console.log(`Embedding ${chunks.length} chunks from ${docs.length} docs (${EMBED_MODEL})...`);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Embed title + heading + content so retrieval matches on all three.
    const text = `${c.title}\n${c.heading ? c.heading + '\n' : ''}${c.content}`.slice(0, 8000);
    c.embedding = await embedOne(text);
    if ((i + 1) % 10 === 0 || i + 1 === chunks.length) console.log(`  embedded ${i + 1}/${chunks.length}`);
    await sleep(200);
  }

  writeFileSync(OUT, JSON.stringify({ model: EMBED_MODEL, chunks }));
  console.log(`Wrote ${chunks.length} chunks to embeddings.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
