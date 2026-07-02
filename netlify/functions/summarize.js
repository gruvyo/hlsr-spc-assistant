// Brief summary of a chat transcript, for the captain-contact email.
const KEY = process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!KEY) return json(500, { error: 'Server is missing OPENAI_API_KEY.' });

  let transcript = '';
  try {
    transcript = (JSON.parse(event.body || '{}').transcript || '').trim();
  } catch (e) {
    return json(400, { error: 'Bad request.' });
  }
  if (!transcript || /^\(No conversation/i.test(transcript)) {
    return json(200, { summary: 'No prior conversation with the assistant.' });
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Summarize, in one or two plain sentences, what this committee member was asking the assistant about and whether it was resolved. Write it for their team captain. No preamble.',
          },
          { role: 'user', content: transcript },
        ],
      }),
    });
    if (!res.ok) return json(200, { summary: '' });
    const data = await res.json();
    return json(200, { summary: (data.choices?.[0]?.message?.content || '').trim() });
  } catch (e) {
    return json(200, { summary: '' });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
