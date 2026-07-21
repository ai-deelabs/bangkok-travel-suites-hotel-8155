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

// Thai labels for the known booking fields; unknown fields fall back to the raw key.
const FIELD_LABELS = {
  name: 'ชื่อผู้จอง',
  email: 'อีเมล',
  phone: 'เบอร์โทร',
  room_type: 'ประเภทห้องพัก',
  checkin: 'วันเช็คอิน',
  checkout: 'วันเช็คเอาต์',
  guests: 'จำนวนผู้เข้าพัก',
  rooms: 'จำนวนห้อง',
  message: 'คำขอพิเศษ',
};

// Friendlier Thai rendering for a few known values.
const ROOM_TYPE_TH = {
  'No preference': 'ไม่ระบุ (ให้ทางโรงแรมแนะนำ)',
  'Standard Double': 'ห้องเตียงเดี่ยว (Standard Double)',
  'Standard Twin': 'ห้องเตียงคู่ (Standard Twin)',
};

const FONT_STACK = "'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Thai',sans-serif";
const BASE_FONT = `font-family:${FONT_STACK}`;

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

// YYYY-MM-DD -> DD/MM/YYYY (leaves other strings untouched).
function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

// Render a submitted value in a friendlier Thai form where we recognise the field.
function formatValue(key, value) {
  const v = String(value);
  if (key === 'checkin' || key === 'checkout') return formatDate(v);
  if (key === 'room_type') return ROOM_TYPE_TH[v] || v;
  if (key === 'guests') return `${v} ท่าน`;
  if (key === 'rooms') return `${v} ห้อง`;
  return v;
}

// The domain guests booked from (derived from MAIL_FROM), for the "from your website" line.
function siteDomain() {
  const m = /@([^\s>]+)/.exec(String(process.env.MAIL_FROM || ''));
  return m ? m[1] : '';
}

// Build a clean two-column list from ALL submitted fields (skips blanks).
function buildTable(fields) {
  const rows = Object.keys(fields)
    .filter((k) => fields[k] != null && String(fields[k]).trim() !== '')
    .map((k) => {
      const label = escapeHtml(labelFor(k));
      const value = escapeHtml(formatValue(k, fields[k])).replace(/\n/g, '<br>');
      return `<tr>
        <td style="padding:11px 16px;border-bottom:1px solid #efe9df;color:#8a7e72;font-size:13px;white-space:nowrap;vertical-align:top;width:38%">${label}</td>
        <td style="padding:11px 16px;border-bottom:1px solid #efe9df;color:#1a1410;font-size:15px;font-weight:600">${value}</td>
      </tr>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse;${BASE_FONT}">${rows}</table>`;
}

function notificationHtml(fields) {
  const domain = siteDomain();
  const fromLine = domain ? `เว็บไซต์ ${escapeHtml(domain)}` : 'เว็บไซต์ของโรงแรม';
  const guestEmail = String(fields.email || '').trim();
  const replyHint = EMAIL_RE.test(guestEmail)
    ? `<p style="margin:18px 0 0;font-size:13px;color:#8a7e72">💬 ตอบกลับอีเมลฉบับนี้เพื่อติดต่อผู้จองได้โดยตรง</p>`
    : '';
  return `<div style="background:#ece7de;padding:24px 12px;${BASE_FONT}">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(26,20,16,.10)">
      <div style="background:#9B1B30;color:#F5EFE4;padding:20px 24px">
        <div style="font-size:19px;font-weight:700;letter-spacing:.02em">Bangkok Travel Suites</div>
        <div style="font-size:12px;opacity:.85;margin-top:2px">คำขอจองห้องพักใหม่</div>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#1a1410">มีคำขอจองใหม่เข้ามา 🎉</p>
        <p style="margin:0 0 18px;font-size:13px;color:#8a7e72">ส่งมาจาก${fromLine}</p>
        ${buildTable(fields)}
        ${replyHint}
      </div>
      <div style="padding:14px 24px;background:#faf7f2;border-top:1px solid #efe9df;font-size:11px;color:#a99f92">
        อีเมลอัตโนมัติจาก${fromLine} — ไม่ต้องตั้งค่าใด ๆ เพิ่มเติม
      </div>
    </div>
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
