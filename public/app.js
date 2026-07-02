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

  // ---- Contact captain (simulated) ----
  // Sample names only. Real captain contacts are confidential member data
  // and would come from a private source, not this public repo. For the POC
  // the team field accepts anything and always resolves to a captain.
  const CAPTAIN_NAMES = [
    'Luke Combs', 'Jelly Roll', 'Carrie Underwood', 'Morgan Wallen', 'Lainey Wilson',
    'Chris Stapleton', 'Miranda Lambert', 'Cody Johnson', 'Kacey Musgraves', 'George Strait',
  ];
  function captainFor(team) {
    const t = String(team).trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    let idx;
    if (Number.isInteger(n) && n >= 1 && n <= CAPTAIN_NAMES.length) {
      idx = n - 1; // teams 1-10 map directly
    } else {
      let h = 0;
      for (const c of t) h = (h + c.charCodeAt(0)) % CAPTAIN_NAMES.length;
      idx = h; // any other input still resolves deterministically
    }
    const name = CAPTAIN_NAMES[idx];
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
    return { name, email };
  }

  const modal = document.getElementById('captain-modal');
  const capForm = document.getElementById('captain-form');
  const capSent = document.getElementById('captain-sent');
  const teamEl = document.getElementById('cap-team');
  const matchEl = document.getElementById('cap-match');
  const previewEl = document.getElementById('cap-preview');

  function openModal() {
    capForm.hidden = false;
    capSent.hidden = true;
    capForm.reset();
    matchEl.textContent = '';
    matchEl.className = 'cap-match';
    modal.hidden = false;
    teamEl.focus();
  }
  function closeModal() { modal.hidden = true; }

  function transcript() {
    if (!history.length) return '(No conversation yet.)';
    return history
      .map((m) => (m.role === 'user' ? 'You: ' : 'Assistant: ') + m.content)
      .join('\n\n');
  }

  teamEl.addEventListener('input', () => {
    const cap = captainFor(teamEl.value);
    if (!cap) {
      matchEl.textContent = '';
      matchEl.className = 'cap-match';
    } else {
      matchEl.textContent = 'Captain: ' + cap.name;
      matchEl.className = 'cap-match found';
    }
  });

  capForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const team = teamEl.value.trim();
    const cap = captainFor(team);
    if (!cap) { teamEl.focus(); return; }

    const email = document.getElementById('cap-email').value.trim();
    const message = document.getElementById('cap-message').value.trim();
    const includeTx = document.getElementById('cap-transcript').checked;
    const tx = includeTx ? transcript() : '(transcript not included)';

    // Fill hidden fields so the Netlify submission carries them.
    document.getElementById('cap-captain').value = `${cap.name} <${cap.email}>`;
    document.getElementById('cap-transcript-field').value = tx;

    let body = `To: ${cap.name} <${cap.email}>\n`;
    body += `Cc: ${email || '(none)'}\n`;
    body += `Subject: Question for the Team ${team} captain — via SPC Assistant\n\n`;
    body += message;
    if (includeTx) body += `\n\n--- Chat transcript ---\n${tx}`;
    previewEl.textContent = body;

    const banner = document.getElementById('cap-banner');
    const btn = capForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      // Netlify Forms captures this and emails it to the configured inbox.
      await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(capForm)).toString(),
      });
      banner.textContent = 'Sent. The committee has been notified by email.';
    } catch (err) {
      banner.textContent = 'Sending failed. Here is what would have been sent; please try again.';
    }

    capForm.hidden = true;
    capSent.hidden = false;
  });

  document.getElementById('captain-open').addEventListener('click', openModal);
  document.getElementById('captain-close').addEventListener('click', closeModal);
  document.getElementById('captain-overlay').addEventListener('click', closeModal);
  document.getElementById('captain-done').addEventListener('click', closeModal);
})();
