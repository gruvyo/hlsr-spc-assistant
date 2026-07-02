// SPC Member Assistant. Renders answers as sanitized markdown (so tables,
// lists, and paragraphs display properly) and tucks sources into a
// collapsible dropdown with links back to each doc.
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

  function addUser(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    log.appendChild(wrap);
    scrollDown();
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

  function renderAnswer(bubble, reply, sources) {
    bubble.innerHTML = DOMPurify.sanitize(marked.parse(reply || ''));

    const named = (sources || []).filter((s) => s.title);
    if (named.length) {
      const details = document.createElement('details');
      details.className = 'sources';
      const summary = document.createElement('summary');
      summary.textContent = `Sources (${named.length})`;
      details.appendChild(summary);
      const ul = document.createElement('ul');
      named.forEach((s) => {
        const li = document.createElement('li');
        if (s.url) {
          const a = document.createElement('a');
          a.href = s.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = s.title;
          li.appendChild(a);
        } else {
          li.textContent = s.title;
        }
        ul.appendChild(li);
      });
      details.appendChild(ul);
      bubble.appendChild(details);
    }
    scrollDown();
  }

  async function ask(text) {
    if (starters) starters.remove();
    addUser(text);
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
      renderAnswer(bubble, data.reply, data.sources);
      history.push({ role: 'assistant', content: data.reply || '' });
    } catch (err) {
      bubble.textContent =
        'The assistant is unavailable right now. Please try again shortly.';
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
    b.addEventListener('click', () => ask(b.textContent));
  });
})();
