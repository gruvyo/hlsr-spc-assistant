# SPC Member Assistant — infrastructure summary

A high-level technical overview of the Souvenir Program Committee Member Assistant, written for a webmaster evaluating where it should be hosted (including a possible move onto the `rodeospc.com` infrastructure).

**Purpose:** a web-based Q&A assistant that answers committee members' questions from the committee knowledge base, with grounded, cited answers.

**Current status:** live proof of concept, deployed from one public GitHub repository to two hosts with Git-based continuous deployment:
- Vercel — `https://hlsr-spc-assistant.vercel.app`, running Google Gemini.
- Netlify — `https://hlsr-spc-assistant.netlify.app`, running OpenAI.

## Architecture at a glance

A static frontend, two small serverless functions, and an external AI API. There is no database, no server to maintain, and no user accounts.

| Layer | What it is | Notes |
|---|---|---|
| Frontend | Plain HTML, CSS, JavaScript (no framework) | Renders the chat UI. Markdown rendered client-side via marked and DOMPurify. Fully static, hostable anywhere. |
| Backend | Two Node.js serverless functions | `ask` (retrieval and answer) and `summarize` (transcript summary for the captain email). Stateless. On Vercel these are thin `api/` adapters that reuse the same handlers, with a `vercel.json` rewrite so the frontend is identical on both hosts. |
| Retrieval data | ~25 Markdown KB documents, split into ~290 section-level chunks, plus their vector embeddings | Each doc is chunked on its headings so a query matches the relevant section, not a whole document. Bundled with the function as JSON. Not a database. |
| AI provider | Swappable, OpenAI-compatible | Set by env (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBED_MODEL`). Today: Vercel uses Google Gemini (`gemini-2.5-flash` + `gemini-embedding-001`); Netlify uses OpenAI (`gpt-4o-mini` + `text-embedding-3-small`). Low volume, cents-scale or free-tier. |
| Hosting | Vercel and Netlify (static hosting plus serverless functions) | Both auto-deploy from GitHub on every push. |

## How a request flows

1. The browser sends the member's question to the `ask` function.
2. The function embeds the question, cosine-ranks the KB chunks, injects the top matches, and asks the model to answer only from them (grounded, with citations back to the parent documents).
3. The answer returns to the browser. The provider API key never reaches the browser.

## Embeddings: build-time or precomputed

Controlled by env:
- **Build-time (default).** `scripts/build-embeddings.mjs` chunks and embeds the KB at deploy, using the host's configured model. Netlify does this.
- **Precomputed and committed.** Embed once locally, commit `netlify/functions/embeddings.json`, and set `USE_COMMITTED_EMBEDDINGS=1` so the build uses the committed index as-is (no re-embed). Vercel does this, serving a precomputed Gemini index. A committed index is model-specific, so the host's runtime query-embed model must match the model that produced it.

## Requirements the host must provide

- **Static file hosting** for the frontend (any web server or CDN).
- **A Node.js serverless or function runtime** for the two endpoints.
- **Server-side secret storage** for the provider key (`OPENAI_API_KEY`), never exposed to the browser.
- **A build step** (Node) that regenerates the embeddings, or commit the prebuilt index and set `USE_COMMITTED_EMBEDDINGS`.
- **Outbound HTTPS** to the provider (`api.openai.com` or `generativelanguage.googleapis.com`).
- No database, no session store, no personal-data persistence. Interaction logs go only to the function log stream.

## Migration paths to rodeospc.com

The right path depends on what `rodeospc.com` runs today. Three options, from least to most effort:

1. **Embed only (lowest effort).** Keep the backend functions where they are and embed the chat widget into `rodeospc.com` pages (script or iframe), pointed at the function endpoint with CORS allowed.
2. **Re-host on a serverless platform.** Move the static site and functions to another serverless host. Standard static files plus Node functions, so it is portable; this repo already runs on both Netlify and Vercel unchanged.
3. **Self-host on existing infrastructure.** If `rodeospc.com` is traditional hosting (for example WordPress on a LAMP stack), the static files serve fine; the two functions need a Node runtime added (a small service, or reimplemented in the host's language), plus secret management and the embeddings step.

## Notes for production

- **Source links.** Each KB doc carries a `source_url` pointing at its real document on the dashboard, so the Sources shown with an answer open the actual file (members-only links).
- **Contact-captain email** currently uses Netlify Forms delivering to a single inbox (Netlify only; a no-op on the Vercel copy). Routing to real captains and copying the member needs a mail service with a verified sending domain (for example Resend) and the private captain roster, which is confidential and deliberately not in this repository.
- **Knowledge-base updates** are made to the source documents and redeployed. With build-time embeddings they rebuild automatically; with a committed index, re-embed locally and commit.

## Repository layout

```
public/                Static frontend (index.html, styles.css, app.js, logo, og image)
netlify/functions/     ask.js, summarize.js, embeddings.json (committed index)
api/                   ask.js, summarize.js  (Vercel adapters reusing the handlers)
scripts/               build-embeddings.mjs  (chunk + embed)
kb/docs/               Knowledge-base source documents (Markdown)
netlify.toml, vercel.json   Per-host build and deploy config
```
