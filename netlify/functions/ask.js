// RAG endpoint. Embeds the question, retrieves the most relevant KB docs,
// and asks OpenAI to answer ONLY from those docs, with citations. The key
// lives in OPENAI_API_KEY (Netlify env), never in the browser.

let KB = { chunks: [] };
try {
  KB = require('./embeddings.json');
} catch (e) {
  // Built at deploy time; if missing, KB stays empty and we report not-ready.
}

const KEY = process.env.OPENAI_API_KEY;
// Base URL is swappable so the app can point at any OpenAI-compatible endpoint
// (e.g. Google's Gemini API) without code changes. Defaults to OpenAI.
const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const TOP_K = 6;

const SYSTEM = `You are the Member Assistant for the Houston Livestock Show and Rodeo (HLSR) Souvenir Program Committee. You help committee members in a friendly chat. You draw on two things:

1. THE COMMITTEE KNOWLEDGE BASE. Each question arrives with CONTEXT: relevant excerpts. Answer committee questions (forms, deadlines, ad ordering, dues, procedures) from these excerpts.

2. THE APP YOU LIVE IN. You are the assistant inside the SPC Member Assistant web app. At the top of this chat there is a "Contact captain" button. It lets a member message their team captain: they enter their team number, type a message, optionally add their email for a copy, and this chat transcript is attached automatically. When a member asks how to reach their captain, how to get more help, or about that button, tell them to use the Contact captain button at the top and walk them through it. This is something you already know, not something to look up.

How to talk (this is what makes you feel human, not like an answering machine):
- Sound like a warm, helpful colleague. Never say "the context," "the provided context," or "the knowledge base excerpts" to the member. Those are internal words. Speak naturally.
- Never repeat the same fallback sentence twice. If you already said you couldn't find something, do not say it again the same way. Move the member forward: point them to the Contact captain button, a specific place to look, or committee leadership.
- Read the whole conversation. A follow-up like "how do I do that?" refers to what you were just discussing. Do not jump to an unrelated topic.
- If a member sounds frustrated or says you are repeating yourself, acknowledge it directly and change your approach. Do not just apologize and repeat.

Staying honest:
- Answer committee questions only from what the excerpts give you. Never invent dates, prices, names, deadlines, or procedures.
- If a question is ambiguous or could mean two different things, ask one short clarifying question first.
- Do not simply agree when a member asserts something. Check it. If the materials support them, confirm; if not, say what you can actually confirm and note the uncertainty.
- If you genuinely do not have an answer, say so the way a person would, then offer the Contact captain button or committee leadership. No robotic phrasing.

Format:
- Concise, clean markdown: short paragraphs, bullet lists for steps, a table for structured data like prices.
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
  const res = await fetch(`${BASE}/embeddings`, {
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
  if (!KB.chunks.length) return json(503, { error: 'Knowledge base is not built yet.' });

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
    const ranked = KB.chunks
      .map((c) => ({ c, score: cosine(qVec, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const context = ranked
      .map((r) => `[${r.c.title}${r.c.heading ? ' — ' + r.c.heading : ''}]\n${r.c.content}`)
      .join('\n\n---\n\n');

    const chatRes = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM },
          ...messages.slice(-6, -1),
          { role: 'user', content: `CONTEXT:\n${context}\n\nToday's date is ${new Date().toISOString().slice(0, 10)}. For "next meeting" or upcoming-deadline questions, compare the dates against today and pick the next one still to come.\n\nQUESTION: ${question}` },
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
    // Surface parent docs of the strong chunks, deduped (several chunks can come
    // from one doc), and only when the answer wasn't a clarify or a decline.
    let sources = [];
    if (answered) {
      const seen = new Set();
      for (const r of ranked) {
        if (r.score < 0.35 || r.score < topScore - 0.1) continue;
        const key = `${r.c.title}|${r.c.source_url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push({ title: r.c.title, url: r.c.source_url });
        if (sources.length >= 3) break;
      }
    }

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
            top: ranked.slice(0, 6).map((r) => ({ id: r.c.doc_id, h: r.c.heading, s: Math.round(r.score * 1000) / 1000 })),
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
