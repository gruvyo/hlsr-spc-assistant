# HLSR Souvenir Program Committee — Assistant (proof of concept)

A floating assistant that answers committee members' questions from the SPC
knowledge base, using retrieval-augmented generation (RAG). It retrieves the
most relevant KB docs for each question and answers only from them, with
citations, and says "I don't know" when the KB doesn't cover it.

## How it works

1. `scripts/build-embeddings.mjs` runs at deploy time and turns `kb/docs/*.md`
   into vector embeddings (`netlify/functions/embeddings.json`, bundled with the
   function, never served publicly).
2. `netlify/functions/ask.js` embeds the question, finds the top matching docs
   by cosine similarity, and asks OpenAI to answer only from those docs.
3. `public/` holds the demo page and the floating widget.

The OpenAI key never reaches the browser. It lives only in Netlify env vars.

## Deploy

1. In Netlify, add this repo as a site.
2. Netlify reads `netlify.toml` (build command, publish dir, functions).
3. Set one environment variable:
   - `OPENAI_API_KEY` = your OpenAI key (used at build time for embeddings and
     at runtime for query embedding + answering).
   - Optional: `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`),
     `OPENAI_EMBED_MODEL` (default `text-embedding-3-small`).
4. Deploy. The build embeds the KB, then the assistant is live.

## Updating the KB

Replace the files in `kb/docs/` and redeploy. Embeddings rebuild automatically.
This copy mirrors the canonical KB in the vault at
`workspaces/gruvyo/hlsr/souvenir-program-committee/faq-chatbot/kb/docs`.
