// GET /api/availability?arrival=YYYY-MM-DD&departure=YYYY-MM-DD&numAdults=N
// Server-side proxy to Beds24 offers. Returns clean JSON; never leaks the token
// or raw upstream errors.
import { getOffers, isValidRoom, Beds24Error } from './_lib/beds24.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { arrival, departure, roomId } = req.query;
  const numAdults = parseInt(req.query.numAdults, 10);

  if (!DATE_RE.test(arrival || '') || !DATE_RE.test(departure || '')) {
    return res.status(400).json({ error: 'invalid_input', message: 'Valid arrival and departure dates are required.' });
  }
  if (departure <= arrival) {
    return res.status(400).json({ error: 'invalid_input', message: 'Departure must be after arrival.' });
  }
  if (!Number.isInteger(numAdults) || numAdults < 1 || numAdults > 10) {
    return res.status(400).json({ error: 'invalid_input', message: 'Guests must be between 1 and 10.' });
  }
  if (roomId != null && !isValidRoom(roomId)) {
    return res.status(400).json({ error: 'invalid_input', message: 'Unknown room type.' });
  }

  try {
    const offer = await getOffers({ arrival, departure, numAdults, roomId });
    return res.status(200).json(offer);
  } catch (err) {
    return handleError(res, err, 'availability');
  }
}

function handleError(res, err, scope) {
  // Full detail stays server-side only.
  console.error(`[api/${scope}] error:`, err?.code || '', err?.message || err, err?.detail || '');
  if (err instanceof Beds24Error) {
    if (err.code === 'token_expired') {
      return res.status(401).json({ error: 'token_expired', message: 'Beds24 token expired — please regenerate it.' });
    }
    if (err.code === 'missing_token') {
      return res.status(500).json({ error: 'not_configured', message: 'Booking is not configured.' });
    }
  }
  return res.status(502).json({ error: 'upstream', message: 'Availability service is temporarily unavailable.' });
}
