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

const SYSTEM = `You are the assistant for the Houston Livestock Show and Rodeo (HLSR) Souvenir Program Committee, helping committee members. Each question comes with CONTEXT: excerpts retrieved from the committee knowledge base.

Behave like a careful, honest guide, not an eager one.

Grounding:
- Base every claim on the CONTEXT. If the context does not clearly support an answer, say so plainly and point the member to the committee portal or committee leadership. Do not fill gaps with guesses.
- Never invent dates, prices, names, deadlines, or procedures that are not in the context.

Ambiguity (ask before answering):
- If the question is ambiguous, or the context contains more than one distinct topic that could be what they mean, ask ONE short clarifying question instead of picking one silently. Example: if "sizes" could mean advertisement page sizes or physical frame sizes, ask which they mean before answering.

Do not just agree:
- When a member asserts something ("I thought I do this in my membership profile"), do not simply agree to be polite. Check it against the context. If the context supports them, confirm and explain. If it contradicts them or does not cover it, say what the knowledge base actually shows and flag the uncertainty. A careful "here is what I can confirm" is better than an agreeable wrong answer.

Limits:
- The knowledge base is imperfect and may be incomplete or out of date. When the context is thin, conflicting, or you are unsure, say so rather than sounding confident.

Format:
- Answer concisely in clean markdown: short paragraphs, bullet lists for steps or options, a table for structured data like prices.
- Do not list sources yourself; the app shows them separately.`;

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

  const userTurns = messages.filter((m) => m.role === 'user').map((m) => m.content.trim());
  const question = userTurns[userTurns.length - 1];
  if (!question) return json(400, { error: 'No question.' });

  // Embed recent user turns together so follow-ups ("where do I do this?")
  // retrieve against the topic being discussed, not just the bare words.
  const queryText = userTurns.slice(-3).join('\n');

  try {
    const qVec = await embed(queryText);
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

    // Only surface genuinely relevant docs, and only when the answer wasn't a
    // clarifying question or a "don't have that" response.
    const topScore = ranked[0]?.score ?? 0;
    const answered = !/\?\s*$/.test(reply.trim()) && !/don'?t have (that|it)|not (in|covered)/i.test(reply);
    const sources = answered
      ? ranked
          .filter((r) => r.score >= 0.35 && r.score >= topScore - 0.08)
          .slice(0, 3)
          .map((r) => ({ title: r.d.title, url: r.d.source_url }))
      : [];

    // Interaction log (read-only signal for later KB review). Never edits the
    // KB. Wrapped so logging can never affect the response.
    try {
      const disposition = /\?\s*$/.test(reply.trim()) ? 'clarify' : answered ? 'answered' : 'decline';
      console.log(
        'INTERACTION ' +
          JSON.stringify({
            ts: new Date().toISOString(),
            q: question,
            disposition,
            top: ranked.slice(0, 5).map((r) => ({ id: r.d.id, s: Math.round(r.score * 1000) / 1000 })),
            reply: reply.slice(0, 500),
          })
      );
    } catch (e) {}

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
