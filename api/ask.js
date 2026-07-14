// Vercel streaming endpoint for the RAG-less grounded chat. Reuses the shared
// prompt builder + provider config from the Netlify handler so the KB/system
// prompt live in one place, then streams the model's reply to the browser as
// plain text (token by token) for a faster-feeling answer. vercel.json rewrites
// the front end's /.netlify/functions/ask here.
const { PROVIDER, buildOutgoing, straighten } = require('../netlify/functions/ask.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { KEY, BASE, MODEL } = PROVIDER;
  if (!KEY) return res.status(503).json({ error: 'The assistant is not connected yet. Please check back soon.' });

  let messages;
  try {
    const raw = req.body;
    const body = typeof raw === 'string' ? JSON.parse(raw)
      : Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8'))
      : (raw || {});
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch (e) {
    return res.status(400).json({ error: 'Bad request.' });
  }
  if (!messages.length) return res.status(400).json({ error: 'No question.' });
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim();
  if (!question) return res.status(400).json({ error: 'No question.' });

  let upstream;
  try {
    upstream = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages: buildOutgoing(messages), temperature: 0.2, stream: true }),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Request failed. Try again in a moment.' });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return res.status(502).json({ error: 'The assistant had trouble answering. Try again in a moment.', detail });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no'); // ask proxies not to buffer the stream

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const piece = JSON.parse(data).choices?.[0]?.delta?.content;
          if (piece) { const out = straighten(piece); full += out; res.write(out); }
        } catch (e) { /* ignore keep-alive / partial JSON */ }
      }
    }
  } catch (e) {
    // Stream broke mid-answer; end with whatever arrived.
  }

  // Interaction log (read-only signal for later KB review).
  try {
    const disposition = /\?\s*$/.test(full.trim()) ? 'clarify'
      : /don'?t have (that|it)|not (in|covered|something)|can'?t find|couldn'?t find/i.test(full) ? 'decline'
      : 'answered';
    console.log('INTERACTION ' + JSON.stringify({ ts: new Date().toISOString(), q: question, disposition, reply: full.slice(0, 500) }));
  } catch (e) {}

  res.end();
};
