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
    scrollDown();
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderAnswer(bubble, data.reply);
      history.push({ role: 'assistant', content: data.reply || '' });
    } catch (err) {
      bubble.textContent =
        'The assistant is unavailable right now. Please try again shortly.';
    }
    anchorQuestion(userEl);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text);
  });

  document.querySelectorAll('.starter').forEach((b) => {
    b.addEventListener('click', () => ask(b.textContent));
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
    modal.hidden = false;
    nameEl.focus();
  }
  function closeModal() { modal.hidden = true; }

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
  document.getElementById('captain-done').addEventListener('click', closeModal);

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
