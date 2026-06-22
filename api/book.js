// POST /api/book
// Body: { fullName, email, phone, arrival, departure, numAdult }
// Server-side proxy that creates a Beds24 booking. Returns { ok, bookingId }.
// Never leaks the token or raw upstream errors to the client.
import { createBooking, isValidRoom, Beds24Error } from './_lib/beds24.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Vercel parses JSON bodies automatically; guard for the raw/string case too.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_input', message: 'Missing request body.' });
  }

  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const { arrival, departure, roomId } = body;
  const numAdult = parseInt(body.numAdult, 10);

  if (roomId != null && !isValidRoom(roomId)) {
    return res.status(400).json({ error: 'invalid_input', message: 'Unknown room type.' });
  }
  if (!fullName) {
    return res.status(400).json({ error: 'invalid_input', message: 'Full name is required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_input', message: 'A valid email is required.' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'invalid_input', message: 'Phone number is required.' });
  }
  if (!DATE_RE.test(arrival || '') || !DATE_RE.test(departure || '') || departure <= arrival) {
    return res.status(400).json({ error: 'invalid_input', message: 'Valid arrival and departure dates are required.' });
  }
  if (!Number.isInteger(numAdult) || numAdult < 1 || numAdult > 10) {
    return res.status(400).json({ error: 'invalid_input', message: 'Guests must be between 1 and 10.' });
  }

  // Split "Full Name" into first / last for Beds24.
  const parts = fullName.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '-';

  try {
    const { bookingId } = await createBooking({
      arrival,
      departure,
      numAdult,
      firstName,
      lastName,
      email,
      phone,
      roomId,
    });
    return res.status(200).json({ ok: true, bookingId });
  } catch (err) {
    console.error('[api/book] error:', err?.code || '', err?.message || err, err?.detail || '');
    if (err instanceof Beds24Error) {
      if (err.code === 'token_expired') {
        return res.status(401).json({ error: 'token_expired', message: 'Beds24 token expired — please regenerate it.' });
      }
      if (err.code === 'unavailable') {
        return res.status(409).json({ error: 'unavailable', message: 'Sorry, those dates are no longer available.' });
      }
      if (err.code === 'missing_token') {
        return res.status(500).json({ error: 'not_configured', message: 'Booking is not configured.' });
      }
    }
    return res.status(502).json({ error: 'upstream', message: 'Booking service is temporarily unavailable. Please try again.' });
  }
}
