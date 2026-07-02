# SPC Member Assistant — infrastructure summary

A high-level technical overview of the Souvenir Program Committee Member Assistant, written for a webmaster evaluating where it should be hosted (including a possible move onto the `rodeospc.com` infrastructure).

**Purpose:** a web-based Q&A assistant that answers committee members' questions from the committee knowledge base, with grounded, cited answers.

**Current status:** live proof of concept at `https://hlsr-spc-assistant.netlify.app`. Public GitHub repository with Git-based continuous deployment.

## Architecture at a glance

A static frontend, two small serverless functions, and an external AI API. There is no database, no server to maintain, and no user accounts.

| Layer | What it is | Notes |
|---|---|---|
| Frontend | Plain HTML, CSS, JavaScript (no framework) | Renders the chat UI. Markdown is rendered client-side via marked and DOMPurify (loaded from a CDN). Fully static and hostable anywhere. |
| Backend | Two Node.js serverless functions | `ask` (retrieval and answer) and `summarize` (transcript summary for the captain email). Stateless. |
| Retrieval data | ~40 Markdown knowledge-base documents plus their vector embeddings | Embeddings are generated from the documents at deploy time and bundled with the function. This is not a database. |
| AI provider | OpenAI API | `text-embedding-3-small` for retrieval, `gpt-4o-mini` for answers and summaries. Pay-per-use, low volume, cents-scale cost. |
| Hosting (current) | Netlify (static hosting plus Functions) | Auto-deploys from GitHub on every push. |

## How a request flows

1. The browser sends the member's question to the `ask` function.
2. The function embeds the question, finds the most relevant knowledge-base documents by vector similarity, and asks the model to answer only from those documents (grounded, with citations).
3. The answer returns to the browser. The OpenAI key never reaches the browser.

## Requirements the host must provide

- **Static file hosting** for the frontend (any web server or CDN).
- **A Node.js serverless or function runtime** for the two backend endpoints, or a small always-on Node service equivalent.
- **Server-side secret storage** for one value, `OPENAI_API_KEY`. It must never be exposed to the browser.
- **A build step** (Node) that regenerates the embeddings from the knowledge base, or commit the prebuilt embeddings file and skip the build.
- **Outbound HTTPS** access to `api.openai.com`.
- No database, no session store, and no personal-data persistence. Interaction logs currently go only to the function log stream.

## Migration paths to rodeospc.com

The right path depends on what `rodeospc.com` runs today. Three options, from least to most effort:

1. **Embed only (lowest effort).** Keep the backend functions on their current serverless host and embed the chat widget into `rodeospc.com` pages (as a script or iframe), pointed at the function endpoint with CORS allowed. The portal owns the interface and the AI backend stays where it is.
2. **Re-host on a serverless platform.** Move both the static site and the functions to another serverless host (for example Vercel, Cloudflare Pages with Workers, AWS S3/CloudFront with Lambda, or Azure Static Web Apps). This is portable because it is standard static files plus Node functions.
3. **Self-host on existing infrastructure.** If `rodeospc.com` is traditional hosting (for example WordPress on a LAMP stack), the static files serve fine from the existing web server, but the two functions need a Node runtime added (a small Node service, or reimplemented in the host's language), plus secret management and the embeddings build.

The frontend is trivially portable. The only real migration question is where the two Node functions run and how the OpenAI key is stored server-side.

## Notes for production

- **Contact-captain email** currently uses Netlify Forms delivering to a single inbox. Routing to real captains and copying the member needs a mail service with a verified sending domain (for example Resend) and the private captain roster. That roster is confidential member data and is deliberately not in this repository.
- **Knowledge-base updates** are made to the source documents and redeployed. The embeddings rebuild automatically.

## Repository layout

```
public/                Static frontend (index.html, styles.css, app.js, logo, og image)
netlify/functions/     ask.js, summarize.js  (Node serverless functions)
scripts/               build-embeddings.mjs  (deploy-time embedding build)
kb/docs/               Knowledge-base source documents (Markdown)
netlify.toml           Build and functions configuration
```
