// Serverless function for the "Contact Admin" form.
// Vercel builds any file in a root /api folder into a serverless function; the
// front end posts to /.netlify/functions/contact, which vercel.json rewrites to
// /api/contact, so the same call works on either host.
//
// It sends each message through Joe's own Google Workspace over SMTP
// (authenticated as GMAIL_USER with a Google App Password) — the same pattern as
// the gruvyo.com contact form. The mail is From/To joe@gruvyo.com and Reply-To
// the member (when they give an email), so a reply goes straight back to them.
//
// Required Vercel env vars (Production):
//   GMAIL_USER          the Workspace account that logs in, e.g. joe@gruvyo.com
//   GMAIL_APP_PASSWORD  a 16-char Google App Password for that account
const nodemailer = require('nodemailer');

const TO = 'joe@gruvyo.com';
const FROM = 'SPC Member Assistant <joe@gruvyo.com>';
// Optional CC (e.g. the committee chairman), kept in an env var so a personal
// address never lands in this public repo. Set CONTACT_CC in the host env.
const CC = (process.env.CONTACT_CC && process.env.CONTACT_CC.trim()) || undefined;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const {
    name = '', email = '', message = '', transcript = '', botcheck,
  } = body;

  // Honeypot: a real person never fills the hidden botcheck field.
  if (botcheck) return res.status(200).json({ success: true });

  if (!name.trim() || !message.trim()) {
    return res.status(400).json({ error: 'Please add your name and a short message.' });
  }
  if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }

  const user = process.env.GMAIL_USER && process.env.GMAIL_USER.trim();
  // Google shows the App Password in four space-separated groups; the real
  // secret is the 16 chars with no spaces. Strip whitespace so a paste-with-
  // spaces still works.
  const pass = process.env.GMAIL_APP_PASSWORD && process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '');
  if (!user || !pass) {
    console.error('contact: missing GMAIL_USER or GMAIL_APP_PASSWORD');
    return res.status(500).json({ error: 'Messaging is not set up yet. Please try again later.' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // implicit TLS
    auth: { user, pass },
  });

  const lines = [
    `From:    ${name.trim()}${email.trim() ? ` <${email.trim()}>` : ''}`,
    '',
    'Message:',
    message.trim(),
  ];
  if (transcript && transcript.trim() && !/^\(No conversation/i.test(transcript.trim())) {
    lines.push('', '--- Assistant chat transcript ---', transcript.trim());
  }
  const text = lines.join('\n');

  try {
    await transporter.sendMail({
      from: FROM,
      to: TO,
      cc: CC,
      replyTo: email.trim() ? `${name.trim()} <${email.trim()}>` : undefined,
      subject: `SPC Assistant — message from ${name.trim()}`,
      text,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('contact: sendMail failed:', err);
    return res.status(502).json({ error: 'Could not send right now. Please try again shortly.' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
