// RAG endpoint. Embeds the question, retrieves the most relevant KB docs,
// and asks OpenAI to answer ONLY from those docs, with citations. The key
// lives in OPENAI_API_KEY (Netlify env), never in the browser.

let KB = { docs: [] };
try {
  KB = require('./embeddings.json');
} catch (e) {
  // Built at deploy time; if missing, KB stays empty and we report not-ready.
}

const KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const TOP_K = 5;

const SYSTEM = `You are the assistant for the Houston Livestock Show and Rodeo (HLSR) Souvenir Program Committee.
Answer questions from committee members using ONLY the CONTEXT documents provided.
Rules:
- If the answer is in the context, answer concisely and name the document title(s) you used.
- If the context does not cover it, say you don't have that information and suggest they check the committee portal or contact committee leadership. Do not guess.
- Never invent dates, prices, names, or deadlines that are not in the context.`;

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!KEY) return json(500, { error: 'Server is missing OPENAI_API_KEY.' });
  if (!KB.docs.length) return json(503, { error: 'Knowledge base is not built yet.' });

  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch (e) {
    return json(400, { error: 'Bad request.' });
  }

  const question = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim();
  if (!question) return json(400, { error: 'No question.' });

  try {
    const qVec = await embed(question);
    const ranked = KB.docs
      .map((d) => ({ d, score: cosine(qVec, d.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const context = ranked
      .map((r, i) => `[Doc ${i + 1}] ${r.d.title}\n${r.d.content}`)
      .join('\n\n---\n\n');

    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM },
          ...messages.slice(-6, -1),
          { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
        ],
      }),
    });
    if (!chatRes.ok) return json(502, { error: 'Provider error.', detail: await chatRes.text() });

    const data = await chatRes.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    const sources = ranked
      .filter((r) => r.score > 0.2)
      .map((r) => ({ title: r.d.title, url: r.d.source_url }));

    return json(200, { reply, sources });
  } catch (e) {
    return json(500, { error: 'Request failed.' });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
