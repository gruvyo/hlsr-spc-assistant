// Vercel adapter for the transcript-summary function. Same pattern as
// api/ask.js: reuses netlify/functions/summarize.js so the logic stays in one
// place. Vercel serves this at /api/summarize.
const { handler } = require('../netlify/functions/summarize.js');

module.exports = async (req, res) => {
  const raw = req.body;
  const body = Buffer.isBuffer(raw)
    ? raw.toString('utf8')
    : typeof raw === 'string'
      ? raw
      : JSON.stringify(raw ?? {});

  const result = await handler({ httpMethod: req.method, body });

  res.status(result.statusCode || 200);
  for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
  res.send(result.body);
};
