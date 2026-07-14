// SPC Member Assistant — grounded chat proxy.
//
// The browser calls THIS function, never the model provider, so the API key
// never reaches the client. The key lives in a host environment variable.
//
// This is the simple-proxy shape shared with the Nice Vibe and HEB Prep apps:
// the whole committee knowledge base fits in the prompt (~45k tokens), so there
// is no retrieval and no embeddings. The KB is bundled in ./kb.js, regenerated
// from kb/docs by scripts/build-kb.mjs.
//
// Provider is env-driven. This app runs on Poe (an OpenAI-compatible router):
//   POE_API_KEY  = <your Poe API key>       (set in the host UI, never in code)
//   POE_BASE_URL = https://api.poe.com/v1
//   POE_MODEL    = Gemini-2.5-Flash         (a Poe model handle)
// The OPENAI_* names still work as a fallback, so the same code can point at any
// OpenAI-compatible provider without an edit.

const { KB_TEXT } = require('./kb.js');

const KEY = process.env.POE_API_KEY || process.env.OPENAI_API_KEY;
const BASE = process.env.POE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.poe.com/v1';
const MODEL = process.env.POE_MODEL || process.env.OPENAI_CHAT_MODEL || 'Gemini-2.5-Flash';

const SYSTEM = `You are the Member Assistant for the Houston Livestock Show and Rodeo (HLSR) Souvenir Program Committee. You help committee members in a friendly chat. You draw on two things:

1. THE COMMITTEE KNOWLEDGE BASE (below). Answer committee questions (forms, deadlines, ad ordering, dues, donor benefits, procedures) only from this knowledge. Never invent dates, prices, names, deadlines, or procedures. If the knowledge does not cover something, say so plainly rather than guessing.

2. THE APP YOU LIVE IN. You are the assistant inside the SPC Member Assistant web app. At the top of this chat there is a "Contact Admin" button. It lets a member send a message to a committee administrator: they enter their name, type a message, optionally add their email for a reply, and can attach this chat transcript. When a member asks how to get more help, reach a person, or about that button, tell them to use the Contact Admin button at the top and walk them through it. This is something you already know, not something to look up.

How to talk (this is what makes you feel human, not like an answering machine):
- Sound like a warm, helpful colleague. Never say "the knowledge base," "the context," "the provided text," or "the source documents" to the member. Those are internal words. Speak naturally.
- When it helps, you may name the committee document an answer comes from (e.g. "the 2027 Artwork Specs"), but never paste URLs or internal ids.
- Never repeat the same fallback sentence twice. If you already said you couldn't find something, do not say it again the same way. Move the member forward: point them to the Contact Admin button, a specific place to look, or committee leadership.
- Read the whole conversation. A follow-up like "how do I do that?" refers to what you were just discussing. Do not jump to an unrelated topic.
- If a member sounds frustrated or says you are repeating yourself, acknowledge it directly and change your approach. Do not just apologize and repeat.

Staying honest:
- If a question is ambiguous or could mean two different things, ask one short clarifying question first.
- Do not simply agree when a member asserts something. Check it against the knowledge. If the materials support them, confirm; if not, say what you can actually confirm and note the uncertainty.
- If you genuinely do not have an answer, say so the way a person would, then offer the Contact Admin button or committee leadership. No robotic phrasing.

Format:
- Concise, clean markdown: short paragraphs, bullet lists for steps, a table for structured data like prices.

KNOWLEDGE BASE
==============
${KB_TEXT}`;

// Curly quotes to straight, so replies read clean.
const straighten = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!KEY) return json(503, { error: 'The assistant is not connected yet. Please check back soon.' });

  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch (e) {
    return json(400, { error: 'Bad request.' });
  }
  if (!messages.length) return json(400, { error: 'No question.' });

  const question = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim();
  if (!question) return json(400, { error: 'No question.' });

  // Keep the last few turns so a follow-up stays on topic without a huge prompt.
  const trimmed = messages.slice(-8).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));
  const today = new Date().toISOString().slice(0, 10);
  const dateNote = {
    role: 'user',
    content: `(Today's date is ${today}. For "next meeting" or upcoming-deadline questions, compare dates against today and pick the next one still to come.)`,
  };
  const outgoing = [{ role: 'system', content: SYSTEM }, dateNote, ...trimmed];

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages: outgoing, temperature: 0.2 }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json(502, { error: 'The assistant had trouble answering. Try again in a moment.', detail });
    }
    const data = await res.json();
    const reply = straighten(data.choices?.[0]?.message?.content ?? '');

    // Interaction log (read-only signal for later KB review). Never edits the
    // KB. Wrapped so logging can never affect the response.
    try {
      const disposition = /\?\s*$/.test(reply.trim())
        ? 'clarify'
        : /don'?t have (that|it)|not (in|covered|something)|can'?t find|couldn'?t find/i.test(reply)
          ? 'decline'
          : 'answered';
      console.log('INTERACTION ' + JSON.stringify({ ts: new Date().toISOString(), q: question, disposition, reply: reply.slice(0, 500) }));
    } catch (e) {}

    return json(200, { reply });
  } catch (e) {
    return json(500, { error: 'Request failed. Try again in a moment.' });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
