# SPC Member Assistant — infrastructure summary

A high-level technical overview of the Souvenir Program Committee Member Assistant, written for a webmaster evaluating where it should be hosted (including a possible move onto the `rodeospc.com` infrastructure).

**Purpose:** a web-based Q&A assistant that answers committee members' questions from the committee knowledge base, with grounded answers.

**Current status:** live proof of concept, deployed from one public GitHub repository to Vercel with Git-based continuous deployment:
- Vercel — `https://hlsr-spc-assistant.vercel.app` (the live app).
- Netlify — `https://hlsr-spc-assistant.netlify.app` (retired; 301-redirects to the Vercel URL so the original link keeps working).

## Architecture at a glance

A static frontend, two small serverless functions, and an external AI API. There is no database, no server to maintain, no vector index, and no user accounts.

| Layer | What it is | Notes |
|---|---|---|
| Frontend | Plain HTML, CSS, JavaScript (no framework) | Renders the chat UI. Markdown rendered client-side via marked and DOMPurify. Fully static, hostable anywhere. |
| Backend | Two Node.js serverless functions | `ask` (grounded answer) and `contact` (sends the member's message to a committee administrator by email). Stateless. On Vercel a `vercel.json` rewrite maps the frontend's `/.netlify/functions/*` calls to `/api/*`, so the same frontend works on either host. |
| Knowledge | ~25 Markdown KB documents (~45k tokens total) | Small enough to fit entirely in the model's context window, so there is **no retrieval and no embeddings**. The docs are bundled into one grounding module (`netlify/functions/kb.js`, generated from `kb/docs/` by `scripts/build-kb.mjs`) and placed in the system prompt. Not a database. |
| AI provider | Poe (an OpenAI-compatible model router) | Set by env (`POE_API_KEY`, `POE_BASE_URL`, `POE_MODEL`). Today the answer model is `Gemini-2.5-Flash` via Poe. The `OPENAI_*` names are accepted as a fallback, so the app can point at any OpenAI-compatible endpoint without a code change. Low volume, subscription- or cents-scale. |
| Email | Google Workspace SMTP (Nodemailer) | The `contact` function sends over `smtp.gmail.com` authenticated with a Google App Password. No third-party form relay. |
| Hosting | Vercel (static hosting plus serverless functions) | Auto-deploys from GitHub on every push. |

## How a request flows

1. The browser sends the member's question to the `ask` function.
2. The function puts the full knowledge base and the assistant's instructions in the system prompt and asks the model to answer only from that knowledge. The provider API key never reaches the browser.
3. The answer returns to the browser and is rendered as Markdown.

Because the whole KB fits in the prompt, there is no separate retrieval/embedding step to build or maintain — updating the assistant is just editing Markdown and regenerating one bundle file.

## Requirements the host must provide

- **Static file hosting** for the frontend (any web server or CDN).
- **A Node.js serverless or function runtime** for the two endpoints, with `nodemailer` installed (see `package.json`).
- **Server-side secret storage** for the provider key (`POE_API_KEY`) and the mail credentials (`GMAIL_USER`, `GMAIL_APP_PASSWORD`), never exposed to the browser.
- **Outbound HTTPS** to the AI provider (`api.poe.com`) and to Google SMTP (`smtp.gmail.com:465`).
- No database, no session store, no personal-data persistence. Interaction logs go only to the function log stream.
- No build step is required on the host: `kb.js` is generated locally and committed, so deploys are instant.

## Environment variables

| Variable | Purpose |
|---|---|
| `POE_API_KEY` | The Poe API key. Server-side only. |
| `POE_BASE_URL` | `https://api.poe.com/v1` (default). |
| `POE_MODEL` | The Poe model handle, e.g. `Gemini-2.5-Flash`. |
| `GMAIL_USER` | The Workspace account that sends the contact email. |
| `GMAIL_APP_PASSWORD` | A 16-char Google App Password for that account. |

## Migration paths to rodeospc.com

The right path depends on what `rodeospc.com` runs today. Three options, from least to most effort:

1. **Embed only (lowest effort).** Keep the backend functions where they are and embed the chat widget into `rodeospc.com` pages (script or iframe), pointed at the function endpoint with CORS allowed.
2. **Re-host on a serverless platform.** Move the static site and functions to another serverless host. Standard static files plus Node functions, so it is portable.
3. **Self-host on existing infrastructure.** If `rodeospc.com` is traditional hosting (for example WordPress on a LAMP stack), the static files serve fine; the two functions need a Node runtime added (a small service, or reimplemented in the host's language), plus secret management.

## Notes for production

- **Contact routing.** The `contact` function currently emails a single committee administrator inbox. Routing to a specific person per member, or copying the member, is a small change to that function.
- **Knowledge-base updates.** Edit the Markdown in `kb/docs/`, run `node scripts/build-kb.mjs` to regenerate `netlify/functions/kb.js`, and redeploy.
- **Scale.** The no-retrieval design sends the full KB on every request. That is fine at committee scale and for a KB this size; if the KB grows well beyond a context window, add lightweight retrieval back.

## Repository layout

```
public/                Static frontend (index.html, styles.css, app.js, logo, og image, _redirects)
netlify/functions/     ask.js (grounded answer), kb.js (generated KB bundle)
api/                   ask.js (Vercel adapter for ask), contact.js (email via Gmail SMTP)
scripts/               build-kb.mjs  (bundles kb/docs into kb.js)
kb/docs/               Knowledge-base source documents (Markdown)
netlify.toml, vercel.json   Per-host deploy config
package.json           nodemailer dependency
```
