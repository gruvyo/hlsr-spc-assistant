# HLSR Souvenir Program Committee — Assistant (proof of concept)

A floating assistant that answers committee members' questions from the SPC
knowledge base. The whole knowledge base (~25 docs, ~45k tokens) fits in the
model's context window, so there is no retrieval and no embeddings — the KB
rides in the system prompt and the model answers only from it, saying "I don't
know" when the KB doesn't cover something.

Live on **Vercel** (`https://hlsr-spc-assistant.vercel.app`), running on **Poe**
(an OpenAI-compatible model router). The Netlify URL is retired and 301-redirects
here.

## How it works

1. `scripts/build-kb.mjs` bundles every `kb/docs/*.md` file into one grounding
   module (`netlify/functions/kb.js`), committed to the repo.
2. `netlify/functions/ask.js` puts that KB in the system prompt and asks the
   model (via Poe) to answer only from it. On Vercel, `api/ask.js` is a thin
   adapter over the same handler, with a `vercel.json` rewrite so the front end
   is unchanged.
3. `api/contact.js` sends the "Contact Admin" message (and optional chat
   transcript) to a committee administrator over Google Workspace SMTP.
4. `public/` holds the demo page and the floating widget.

The provider key never reaches the browser. It lives only in host env vars.

## Configuration (env vars)

The provider is OpenAI-compatible and swappable:

- `POE_API_KEY` — the Poe API key (server-side only).
- `POE_BASE_URL` — default `https://api.poe.com/v1`.
- `POE_MODEL` — a Poe model handle. Default `Gemini-2.5-Flash`.
- `GMAIL_USER` — the Workspace account that sends the contact email, e.g. `joe@gruvyo.com`.
- `GMAIL_APP_PASSWORD` — a 16-char Google App Password for that account.

The `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_CHAT_MODEL` names still work as
a fallback, so the same code can point at any OpenAI-compatible provider.

## Deploy

Add the repo as a site on Vercel; it reads `vercel.json`, installs
`nodemailer`, and auto-deploys on push. Set the env vars above. There is no
build step to run on the host — `kb.js` is generated locally and committed.

## Updating the KB

Edit the files in `kb/docs/`, run `node scripts/build-kb.mjs` to regenerate
`netlify/functions/kb.js`, and redeploy. This copy mirrors the canonical KB in
the vault at `workspaces/gruvyo/hlsr/souvenir-program-committee/faq-chatbot/kb/docs`.
