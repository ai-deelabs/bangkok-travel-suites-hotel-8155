// api/send.js — generic contact/booking form → email, via Resend REST API.
//
// Zero-dependency: uses Node's built-in global fetch. No SDK, no npm packages.
// Reusable across sites unchanged — everything site-specific comes from env vars:
//
//   RESEND_API_KEY   (required)  server-side only — NEVER expose to the browser
//   MAIL_TO          (required)  where notifications are sent (site owner)
//   MAIL_FROM        (required)  "Name <sender@your-domain.com>"
//   MAIL_SUBJECT     (optional)  default: "New form submission"
//   AUTO_REPLY       (optional)  "true" | "false" — default true
//
// PREREQUISITE: sends only succeed once the MAIL_FROM domain is verified in
// Resend (add the DNS records Resend gives you at your domain's DNS host).
// Until then Resend rejects the request and this function returns 502.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_BODY_BYTES = 10 * 1024; // ~10 KB anti-abuse cap
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Human-friendly labels for known fields; unknown fields fall back to the raw key.
const FIELD_LABELS = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  room_type: 'Room type',
  checkin: 'Check-in',
  checkout: 'Check-out',
  guests: 'Guests',
  rooms: 'Rooms',
  message: 'Message',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFor(key) {
  return FIELD_LABELS[key] || key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build a clean HTML table from ALL submitted fields (skips blanks).
function buildTable(fields) {
  const rows = Object.keys(fields)
    .filter((k) => fields[k] != null && String(fields[k]).trim() !== '')
    .map((k) => {
      const label = escapeHtml(labelFor(k));
      const value = escapeHtml(fields[k]).replace(/\n/g, '<br>');
      return `<tr>
        <td style="padding:8px 14px;border:1px solid #e5e0d8;font-weight:600;background:#faf7f2;white-space:nowrap;vertical-align:top">${label}</td>
        <td style="padding:8px 14px;border:1px solid #e5e0d8">${value}</td>
      </tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1410">${rows}</table>`;
}

function notificationHtml(fields) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1410">
    <h2 style="margin:0 0 14px;font-size:18px">New booking request</h2>
    ${buildTable(fields)}
  </div>`;
}

function autoReplyHtml(fields) {
  const name = escapeHtml((fields.name || '').trim());
  const greetTh = name ? `เรียน คุณ${name}` : 'เรียน ท่านผู้เข้าพัก';
  const greetEn = name ? `Dear ${name}` : 'Dear guest';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1a1410">
    <p>${greetTh},</p>
    <p>ขอบคุณสำหรับคำขอจองของคุณ เราได้รับข้อมูลเรียบร้อยแล้ว และทีมงานจะติดต่อกลับโดยเร็วที่สุดเพื่อยืนยันห้องว่างและอัตราค่าห้อง</p>
    <hr style="border:none;border-top:1px solid #e5e0d8;margin:18px 0">
    <p>${greetEn},</p>
    <p>Thank you for your booking request — we've received it and our team will get back to you shortly to confirm availability and rates.</p>
    <p style="margin-top:20px;color:#8a7e72">Bangkok Travel Suites Hotel</p>
  </div>`;
}

async function sendEmail(payload, apiKey) {
  const resp = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const err = new Error(`Resend responded ${resp.status}`);
    err.detail = detail;
    err.status = resp.status;
    throw err;
  }
  return resp.json().catch(() => ({}));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Parse body — Vercel auto-parses JSON, but guard for string / missing.
  let fields = req.body;
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields);
    } catch {
      return res.status(400).json({ error: 'invalid_input' });
    }
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  // Anti-abuse: payload size cap + reject empty submissions.
  const serialized = JSON.stringify(fields);
  if (serialized.length > MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const hasContent = Object.values(fields).some((v) => v != null && String(v).trim() !== '');
  if (!hasContent) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  // Require at least one way to contact the guest back: a valid email OR a phone.
  // Email, when present, is used for reply_to + auto-reply; phone alone is also fine.
  const visitorEmail = String(fields.email || '').trim();
  const visitorPhone = String(fields.phone || '').trim();
  const emailValid = visitorEmail !== '' && EMAIL_RE.test(visitorEmail);
  if (!emailValid && !visitorPhone) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  // If an email was supplied, it must be a valid format.
  if (visitorEmail !== '' && !emailValid) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  // Env config — nothing hardcoded.
  const { RESEND_API_KEY, MAIL_TO, MAIL_FROM } = process.env;
  const MAIL_SUBJECT = process.env.MAIL_SUBJECT || 'New form submission';
  const autoReplyEnabled = process.env.AUTO_REPLY !== 'false';

  if (!RESEND_API_KEY || !MAIL_TO || !MAIL_FROM) {
    console.error(
      '[api/send] Missing required env vars. Need RESEND_API_KEY, MAIL_TO, MAIL_FROM. ' +
        'Set them in the Vercel project environment variables.'
    );
    return res.status(502).json({ error: 'send_failed', message: 'Could not send, please try again.' });
  }

  try {
    // 1) Owner notification. Set reply_to to the visitor only when we have a valid email,
    //    so the owner can reply directly; otherwise they contact via the phone in the body.
    const notify = {
      from: MAIL_FROM,
      to: MAIL_TO,
      subject: MAIL_SUBJECT,
      html: notificationHtml(fields),
    };
    if (emailValid) notify.reply_to = visitorEmail;
    await sendEmail(notify, RESEND_API_KEY);

    // 2) Optional auto-reply to the visitor. Only when we have a valid email.
    //    Failure here must NOT fail the request.
    if (autoReplyEnabled && emailValid) {
      try {
        await sendEmail(
          {
            from: MAIL_FROM,
            to: visitorEmail,
            reply_to: MAIL_TO,
            subject: 'เราได้รับคำขอจองของคุณแล้ว / We received your request',
            html: autoReplyHtml(fields),
          },
          RESEND_API_KEY
        );
      } catch (autoErr) {
        console.error('[api/send] auto-reply failed:', autoErr.status || '', autoErr.detail || autoErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Full detail server-side only. If the MAIL_FROM domain is not yet verified in
    // Resend, this is where the rejection surfaces. Never leak key/raw error to client.
    console.error('[api/send] Resend send failed:', err.status || '', err.detail || err.message);
    return res.status(502).json({ error: 'send_failed', message: 'Could not send, please try again.' });
  }
}
