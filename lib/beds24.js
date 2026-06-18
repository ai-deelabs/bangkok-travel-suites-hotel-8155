// ---------------------------------------------------------------------------
// Beds24 API V2 client (SERVER-SIDE ONLY).
//
// ⚠️  TEMPORARY TOKEN — TEST PHASE ONLY.
// This module authenticates with a single long-lived "token" header read from
// BEDS24_ACCESS_TOKEN. That value is a TEMPORARY access token that expires in
// ~24h. There is intentionally NO refresh-token logic in this phase.
// Before production you MUST replace this with the Beds24 refresh-token flow
// (exchange a refresh token for short-lived access tokens automatically).
//
// SECURITY: the token never leaves the server. Only the /api functions import
// this file; the browser only ever talks to our own /api routes.
// ---------------------------------------------------------------------------

const BASE = 'https://beds24.com/api/v2';

const PROPERTY_ID = process.env.BEDS24_PROPERTY_ID || '335864';
const ROOM_ID = process.env.BEDS24_ROOM_ID || '694923';

// Loud, one-time reminder in the server logs that this is a throwaway token.
console.warn(
  '[Beds24] Using TEMPORARY 24h access token — replace with a refresh-token flow before production.'
);

// Tagged errors so the API handlers can map them to clean HTTP responses
// without ever leaking the raw Beds24 body or the token to the client.
export class Beds24Error extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'Beds24Error';
    this.code = code; // 'missing_token' | 'token_expired' | 'unavailable' | 'upstream'
    this.detail = detail; // server-side logging only — never returned to client
  }
}

function token() {
  const t = process.env.BEDS24_ACCESS_TOKEN;
  if (!t) {
    throw new Beds24Error('missing_token', 'Beds24 access token is not configured.');
  }
  return t;
}

function authHeaders() {
  return { token: token(), 'Content-Type': 'application/json', accept: 'application/json' };
}

/** Whole nights between two YYYY-MM-DD dates. */
export function nightsBetween(arrival, departure) {
  const a = new Date(arrival + 'T00:00:00Z');
  const d = new Date(departure + 'T00:00:00Z');
  return Math.round((d - a) / 86400000);
}

// Pull the first sensible numeric value out of a few candidate fields. The
// exact offers schema isn't published; this stays defensive across shapes.
function pickNumber(...vals) {
  for (const v of vals) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n === 'number' && !Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * GET /inventory/rooms/offers — live availability + price for our Deluxe room.
 * Returns { available, pricePerStay, currency, nights }.
 */
export async function getOffers({ arrival, departure, numAdults }) {
  const nights = nightsBetween(arrival, departure);
  const qs = new URLSearchParams({
    propertyId: String(PROPERTY_ID),
    arrival,
    departure,
    numAdults: String(numAdults),
  });

  let res, body;
  try {
    res = await fetch(`${BASE}/inventory/rooms/offers?${qs}`, { headers: authHeaders() });
    body = await res.json().catch(() => null);
  } catch (e) {
    throw new Beds24Error('upstream', 'Could not reach the availability service.', e?.message);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Beds24Error('token_expired', 'Beds24 token expired.', body);
  }
  if (!res.ok) {
    throw new Beds24Error('upstream', 'Availability service error.', { status: res.status, body });
  }

  // TEMP build aid: log the raw shape once so we can lock the parser against
  // the live response, then this can be removed. Server-side log only.
  console.log('[Beds24] offers raw response:', JSON.stringify(body));

  const offer = findRoomOffer(body, ROOM_ID);
  if (!offer) {
    return { available: false, pricePerStay: null, currency: 'THB', nights };
  }

  const pricePerStay = pickNumber(
    offer.price,
    offer.totalPrice,
    offer.priceTotal,
    offer?.offers?.[0]?.price,
    offer?.offers?.[0]?.totalPrice
  );
  const currency = offer.currency || offer?.offers?.[0]?.currency || 'THB';

  return {
    available: pricePerStay != null && pricePerStay > 0,
    pricePerStay,
    currency,
    nights,
  };
}

// Walk the (array-ish) offers payload and return the node matching our roomId.
function findRoomOffer(body, roomId) {
  const rid = String(roomId);
  const rooms = Array.isArray(body) ? body : body?.data || [];
  for (const entry of rooms) {
    // Common shapes: { roomId, ... } at top, or nested under propertyId → roomTypes/rooms.
    if (String(entry?.roomId) === rid) return entry;
    const nested = entry?.roomTypes || entry?.rooms || entry?.offers || [];
    for (const r of nested) {
      if (String(r?.roomId) === rid) return r;
    }
  }
  return null;
}

/**
 * POST /bookings — create a request-to-book. Body is an ARRAY of bookings.
 * Returns { bookingId }.
 */
export async function createBooking({
  arrival,
  departure,
  numAdult,
  firstName,
  lastName,
  email,
  phone,
}) {
  const payload = [
    {
      roomId: Number(ROOM_ID),
      status: 'confirmed',
      arrival,
      departure,
      numAdult: Number(numAdult),
      firstName,
      lastName,
      email,
      phone,
    },
  ];

  let res, body;
  try {
    res = await fetch(`${BASE}/bookings`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    throw new Beds24Error('upstream', 'Could not reach the booking service.', e?.message);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Beds24Error('token_expired', 'Beds24 token expired.', body);
  }
  if (!res.ok) {
    throw new Beds24Error('upstream', 'Booking service error.', { status: res.status, body });
  }

  console.log('[Beds24] bookings raw response:', JSON.stringify(body));

  // Response is an array of per-booking results. Accept a few field shapes.
  const first = Array.isArray(body) ? body[0] : body?.data?.[0] || body;
  const ok = first?.success !== false; // absent => assume success
  const bookingId = first?.id || first?.new?.id || first?.bookingId || first?.modified?.id || null;

  if (!ok || !bookingId) {
    throw new Beds24Error('unavailable', 'The booking could not be created.', body);
  }

  return { bookingId };
}
