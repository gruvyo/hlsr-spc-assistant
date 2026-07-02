// Floating SPC assistant. Sends the conversation to the ask function and
// shows the answer plus the KB sources it drew from.
(function () {
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');

  const history = [];

  const open = () => {
    panel.hidden = false;
    input.focus();
  };
  const close = () => (panel.hidden = true);

  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = 'chat-msg ' + who;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function addSources(sources) {
    const named = sources.filter((s) => s.title);
    if (!named.length) return;
    const el = document.createElement('div');
    el.className = 'chat-sources';
    el.innerHTML =
      'Sources: ' +
      named
        .map((s) => (s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>` : s.title))
        .join(' · ');
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    addMsg(text, 'user');
    history.push({ role: 'user', content: text });
    input.value = '';
    const thinking = addMsg('…', 'bot');

    try {
      const res = await fetch('/.netlify/functions/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      thinking.textContent = data.reply || 'No reply came back.';
      history.push({ role: 'assistant', content: data.reply || '' });
      if (Array.isArray(data.sources)) addSources(data.sources);
    } catch (err) {
      thinking.textContent =
        'The assistant is unavailable right now. Please try again shortly.';
    }
  });
})();
