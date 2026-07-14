// Serverless function for the "Contact Admin" and "Submit a bug" forms.
// Vercel builds any file in a root /api folder into a serverless function; the
// front end posts to /.netlify/functions/contact, which vercel.json rewrites to
// /api/contact, so the same call works on either host.
//
// It sends each message through Joe's own Google Workspace over SMTP
// (authenticated as GMAIL_USER with a Google App Password) — the same pattern as
// the gruvyo.com contact form. Reply-To is the sender (when given).
//
// Two kinds:
//   kind: 'admin' (default) — a member message; CC's the chairman (CONTACT_CC).
//   kind: 'bug'             — a bug report; goes to the inbox only, no CC.
//
// Required Vercel env vars (Production):
//   GMAIL_USER          the Workspace account that logs in, e.g. joe@gruvyo.com
//   GMAIL_APP_PASSWORD  a 16-char Google App Password for that account
//   CONTACT_CC          optional CC for admin messages (e.g. the chairman)
const nodemailer = require('nodemailer');

const TO = 'joe@gruvyo.com';
const FROM = 'SPC Member Assistant <joe@gruvyo.com>';
// Optional CC (e.g. the committee chairman), kept in an env var so a personal
// address never lands in this public repo. Applied to admin messages only.
const CC = (process.env.CONTACT_CC && process.env.CONTACT_CC.trim()) || undefined;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const {
    kind = 'admin', name = '', email = '', message = '', transcript = '', botcheck,
  } = body;
  const isBug = kind === 'bug';

  // Honeypot: a real person never fills the hidden botcheck field.
  if (botcheck) return res.status(200).json({ success: true });

  if (!message.trim()) {
    return res.status(400).json({ error: 'Please add a short message.' });
  }
  if (!isBug && !name.trim()) {
    return res.status(400).json({ error: 'Please add your name.' });
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

  const who = name.trim() ? `${name.trim()}${email.trim() ? ` <${email.trim()}>` : ''}` : (email.trim() || 'anonymous');
  const lines = [
    `From:    ${who}`,
    '',
    isBug ? 'Bug report:' : 'Message:',
    message.trim(),
  ];
  if (transcript && transcript.trim() && !/^\(No conversation/i.test(transcript.trim())) {
    lines.push('', '--- Assistant chat transcript ---', transcript.trim());
  }
  const text = lines.join('\n');

  const subject = isBug
    ? `SPC Assistant — BUG REPORT${name.trim() ? ` from ${name.trim()}` : ''}`
    : `SPC Assistant — message from ${name.trim()}`;

  try {
    await transporter.sendMail({
      from: FROM,
      to: TO,
      cc: isBug ? undefined : CC, // chairman is not CC'd on bug reports
      replyTo: email.trim() ? `${name.trim() || 'Member'} <${email.trim()}>` : undefined,
      subject,
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
