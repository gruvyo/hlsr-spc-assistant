# HLSR Souvenir Program Committee — Assistant (proof of concept)

A floating assistant that answers committee members' questions from the SPC
knowledge base, using retrieval-augmented generation (RAG). It ranks the most
relevant KB sections for each question and answers only from them, with
citations, and says "I don't know" when the KB doesn't cover it.

Live on two hosts from this one repo: Vercel (Google Gemini) and Netlify (OpenAI).

## How it works

1. `scripts/build-embeddings.mjs` splits each `kb/docs/*.md` file into section
   chunks (on its headings) and turns them into vector embeddings
   (`netlify/functions/embeddings.json`, bundled with the function, never served).
2. `netlify/functions/ask.js` embeds the question, cosine-ranks the chunks, and
   asks the model to answer only from the top matches, citing the parent
   documents. On Vercel, `api/ask.js` is a thin adapter over the same handler,
   with a `vercel.json` rewrite so the front end is unchanged.
3. `public/` holds the demo page and the floating widget.

The provider API key never reaches the browser. It lives only in host env vars.

## Configuration (env vars)

The provider is OpenAI-compatible and swappable:

- `OPENAI_API_KEY` — the provider key (used at build for embeddings and at runtime).
- `OPENAI_BASE_URL` — default `https://api.openai.com/v1`. For Google Gemini:
  `https://generativelanguage.googleapis.com/v1beta/openai`.
- `OPENAI_CHAT_MODEL` — default `gpt-4o-mini`. Gemini: `gemini-2.5-flash`.
- `OPENAI_EMBED_MODEL` — default `text-embedding-3-small`. Gemini: `gemini-embedding-001`.
- `USE_COMMITTED_EMBEDDINGS` — set to `1` to skip the build-time embed and serve
  the committed `embeddings.json` as-is (used on Vercel with a precomputed Gemini
  index). The runtime embed model must match the committed index.

## Deploy

Add the repo as a site on Netlify and/or Vercel; each reads its config
(`netlify.toml` / `vercel.json`) and auto-deploys on push. Set the env vars
above. On deploy the build chunks and embeds the KB (or uses the committed
index), then the assistant is live.

## Updating the KB

Edit the files in `kb/docs/` and redeploy. With build-time embeddings they
rebuild automatically; with a committed index (`USE_COMMITTED_EMBEDDINGS`),
re-embed locally and commit `netlify/functions/embeddings.json`. This copy
mirrors the canonical KB in the vault at
`workspaces/gruvyo/hlsr/souvenir-program-committee/faq-chatbot/kb/docs`.
