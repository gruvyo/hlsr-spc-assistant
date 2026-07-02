// Vercel adapter for the RAG endpoint. Reuses the exact Netlify handler so the
// retrieval/answer logic lives in one place. Vercel serves this at /api/ask;
// vercel.json rewrites the front end's /.netlify/functions/ask calls here, so
// no front-end change is needed. Runs with OPENAI_API_KEY in the Vercel env.
const { handler } = require('../netlify/functions/ask.js');

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
