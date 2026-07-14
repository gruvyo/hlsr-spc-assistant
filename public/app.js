// SPC Member Assistant. Renders answers as sanitized markdown so tables,
// lists, and paragraphs display properly.
(function () {
  const log = document.getElementById('chat-log');
  const form = document.getElementById('composer');
  const input = document.getElementById('composer-input');
  const starters = document.getElementById('starters');

  const history = [];

  marked.setOptions({ breaks: true, gfm: true });

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  // Scroll the log so the user's question sits at the top, so the answer that
  // follows reads from its beginning and the reader doesn't have to scroll back
  // up. Explicit math (not scrollIntoView, which is unreliable in a flex column).
  function anchorQuestion(el) {
    log.scrollTop += el.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
  }

  function addUser(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function addBotShell() {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    wrap.appendChild(bubble);
    log.appendChild(wrap);
    scrollDown();
    return bubble;
  }

  function renderAnswer(bubble, reply) {
    bubble.innerHTML = DOMPurify.sanitize(marked.parse(reply || ''));
  }

  // Safety net: strip a stray "[Name]" that isn't followed by "(url)" so a model
  // slip never renders as broken link text. Applied only to the finished reply
  // (not mid-stream, where the "(url)" may not have arrived yet).
  function tidyLinks(md) {
    return md.replace(/\[([^\]\n]+)\](?!\()/g, '$1');
  }

  async function ask(text) {
    if (starters) starters.remove();
    const userEl = addUser(text);
    history.push({ role: 'user', content: text });
    const bubble = addBotShell();

    try {
      const res = await fetch('/.netlify/functions/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        let msg = 'Request failed';
        try { msg = (await res.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      // Stream the reply in, rendering markdown as it grows. Anchor the question
      // to the top on the first tokens so the answer reads from its beginning.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        renderAnswer(bubble, full);
        // Keep the question pinned to the top as the answer grows, so it reads
        // from the beginning (once the content is tall enough to scroll).
        anchorQuestion(userEl);
      }
      renderAnswer(bubble, full ? tidyLinks(full) : 'Sorry — I could not generate a reply. Please try again.');
      anchorQuestion(userEl);
      history.push({ role: 'assistant', content: full });
    } catch (err) {
      bubble.textContent =
        'The assistant is unavailable right now. Please try again shortly.';
      anchorQuestion(userEl);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text);
  });

  document.querySelectorAll('.starter').forEach((b) => {
    b.addEventListener('click', () => ask(b.dataset.query || b.textContent));
  });

  // ---- Shared dialog behavior: focus save/restore, Escape-to-close, focus trap ----
  let openDialogEl = null;
  let dialogPrevFocus = null;
  function openDialog(el, focusEl) {
    dialogPrevFocus = document.activeElement;
    openDialogEl = el;
    el.hidden = false;
    (focusEl || el.querySelector('input:not([tabindex="-1"]), textarea, button')).focus();
  }
  function closeDialog(el) {
    el.hidden = true;
    if (openDialogEl === el) openDialogEl = null;
    if (dialogPrevFocus && dialogPrevFocus.focus) dialogPrevFocus.focus();
    dialogPrevFocus = null;
  }
  document.addEventListener('keydown', (e) => {
    if (!openDialogEl) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(openDialogEl); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(openDialogEl.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---- Contact Admin ----
  // Sends the member's message (and optionally the chat transcript) to a
  // committee administrator over email, via the /contact serverless function.
  const modal = document.getElementById('captain-modal');
  const capForm = document.getElementById('captain-form');
  const capSent = document.getElementById('captain-sent');
  const nameEl = document.getElementById('cap-name');
  const previewEl = document.getElementById('cap-preview');

  function openModal() {
    capForm.hidden = false;
    capSent.hidden = true;
    capForm.reset();
    openDialog(modal, nameEl);
  }
  function closeModal() { closeDialog(modal); }

  function transcript() {
    if (!history.length) return '(No conversation yet.)';
    return history
      .map((m) => (m.role === 'user' ? 'You: ' : 'Assistant: ') + m.content)
      .join('\n\n');
  }

  capForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim();
    const email = document.getElementById('cap-email').value.trim();
    const message = document.getElementById('cap-message').value.trim();
    const includeTx = document.getElementById('cap-transcript').checked;
    const botcheck = document.getElementById('cap-botcheck').value;
    if (!name || !message) { nameEl.focus(); return; }
    const tx = includeTx ? transcript() : '';

    const banner = document.getElementById('cap-banner');
    const btn = capForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    // Preview of what's being sent.
    let preview = `From: ${name}${email ? ` <${email}>` : ''}\n\n${message}`;
    if (tx) preview += `\n\n--- Assistant chat transcript ---\n${tx}`;
    previewEl.textContent = preview;

    let ok = false;
    try {
      const res = await fetch('/.netlify/functions/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, transcript: tx, botcheck }),
      });
      ok = res.ok && (await res.json()).success === true;
    } catch (err) {}

    banner.textContent = ok
      ? 'Sent. A committee administrator will follow up.'
      : 'Sending failed. Here is what would have been sent; please try again.';

    capForm.hidden = true;
    capSent.hidden = false;
  });

  document.getElementById('captain-open').addEventListener('click', openModal);
  document.getElementById('captain-close').addEventListener('click', closeModal);
  document.getElementById('captain-overlay').addEventListener('click', closeModal);
  document.getElementById('captain-cancel').addEventListener('click', closeModal);
  document.getElementById('captain-done').addEventListener('click', closeModal);

  // ---- Submit a bug ----
  // Sends a bug report (and optionally the chat transcript) to the inbox via the
  // same /contact function with kind:'bug' (which skips the chairman CC).
  const bugModal = document.getElementById('bug-modal');
  const bugForm = document.getElementById('bug-form');
  const bugSent = document.getElementById('bug-sent');
  const bugMsgEl = document.getElementById('bug-message');
  const bugPreviewEl = document.getElementById('bug-preview');

  function openBug() {
    bugForm.hidden = false;
    bugSent.hidden = true;
    bugForm.reset();
    openDialog(bugModal, bugMsgEl);
  }
  function closeBug() { closeDialog(bugModal); }

  bugForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = bugMsgEl.value.trim();
    const email = document.getElementById('bug-email').value.trim();
    const includeTx = document.getElementById('bug-transcript').checked;
    const botcheck = document.getElementById('bug-botcheck').value;
    if (!message) { bugMsgEl.focus(); return; }
    const tx = includeTx ? transcript() : '';

    const banner = document.getElementById('bug-banner');
    const btn = bugForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    let preview = email ? `Reply to: ${email}\n\n${message}` : message;
    if (tx) preview += `\n\n--- Assistant chat transcript ---\n${tx}`;
    bugPreviewEl.textContent = preview;

    let ok = false;
    try {
      const res = await fetch('/.netlify/functions/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'bug', email, message, transcript: tx, botcheck }),
      });
      ok = res.ok && (await res.json()).success === true;
    } catch (err) {}

    banner.textContent = ok
      ? 'Thanks — your bug report was sent.'
      : 'Sending failed. Here is what would have been sent; please try again.';

    bugForm.hidden = true;
    bugSent.hidden = false;
  });

  // A confirm step before the bug form opens, so the small link isn't acted on
  // by accident.
  const bugConfirm = document.getElementById('bugconfirm-modal');
  const closeBugConfirm = () => { closeDialog(bugConfirm); };
  document.getElementById('bug-open').addEventListener('click', () => { openDialog(bugConfirm); });
  document.getElementById('bugconfirm-close').addEventListener('click', closeBugConfirm);
  document.getElementById('bugconfirm-overlay').addEventListener('click', closeBugConfirm);
  document.getElementById('bugconfirm-cancel').addEventListener('click', closeBugConfirm);
  document.getElementById('bugconfirm-yes').addEventListener('click', () => { closeBugConfirm(); openBug(); });
  document.getElementById('bug-close').addEventListener('click', closeBug);
  document.getElementById('bug-overlay').addEventListener('click', closeBug);
  document.getElementById('bug-cancel').addEventListener('click', closeBug);
  document.getElementById('bug-done').addEventListener('click', closeBug);

  // ---- Theme: default to the system setting, allow an in-app override ----
  // The override is saved in localStorage and pre-applied in <head> to avoid a
  // flash. The button shows the theme you'd switch TO.
  const root = document.documentElement;
  const themeBtn = document.getElementById('theme-toggle');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function saved() {
    try { return localStorage.getItem('spc-theme'); } catch (e) { return null; }
  }
  function effective() {
    const s = saved();
    if (s === 'dark' || s === 'light') return s;
    return media.matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const s = saved();
    if (s === 'dark' || s === 'light') root.setAttribute('data-theme', s);
    else root.removeAttribute('data-theme'); // fall back to the system setting
    const eff = effective();
    themeBtn.innerHTML = eff === 'dark' ? SUN : MOON;
    themeBtn.setAttribute('aria-label', eff === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  themeBtn.addEventListener('click', () => {
    try { localStorage.setItem('spc-theme', effective() === 'dark' ? 'light' : 'dark'); } catch (e) {}
    applyTheme();
  });
  // If the user hasn't overridden, follow live system changes.
  media.addEventListener('change', () => { if (!saved()) applyTheme(); });
  applyTheme();
})();
