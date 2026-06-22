// ---------------------------------------------------------------------------
// Beds24 API V2 client (SERVER-SIDE ONLY).
//
// AUTH: refresh-token flow. BEDS24_REFRESH_TOKEN is long-lived and reusable
// (Beds24's GET /authentication/token returns only { token, expiresIn } and
// does NOT rotate the refresh token), so we exchange it for short-lived ~24h
// access tokens on demand and cache them in memory per warm instance. On a
// 401/403 we force one refresh and retry, covering tokens invalidated early.
//
// If no refresh token is configured we fall back to a static BEDS24_ACCESS_TOKEN
// (the original test-phase behaviour) so existing setups keep working.
//
// To (re)issue a refresh token, run scripts/beds24-refresh.sh with an invite
// code — that bootstrap is the only step that still rotates the refresh token.
//
// SECURITY: tokens never leave the server. Only the /api functions import this
// file; the browser only ever talks to our own /api routes.
// ---------------------------------------------------------------------------

const BASE = 'https://beds24.com/api/v2';

const PROPERTY_ID = process.env.BEDS24_PROPERTY_ID || '335864';
const ROOM_ID = process.env.BEDS24_ROOM_ID || '694923';

// ---------------------------------------------------------------------------
// ROOM CATALOG — the single source of truth for which rooms are bookable.
// To add a room: create it in Beds24, then add one entry here with its Beds24
// roomId. It then appears in the booking dropdown (via /api/rooms) and is
// accepted by the availability/booking endpoints automatically. List order =
// dropdown order. maxAdult caps the guest selector and must not exceed the
// room's Beds24 maxPeople.
// ---------------------------------------------------------------------------
export const ROOMS = [
  { roomId: '696184', nameTh: 'ห้องเตียงเดี่ยว', nameEn: 'Standard Double', maxAdult: 2 },
  { roomId: '694923', nameTh: 'ห้องเตียงคู่', nameEn: 'Standard Twin', maxAdult: 2 },
  { roomId: '696185', nameTh: 'ห้องแฟมิลี่', nameEn: 'Family Room', maxAdult: 4 },
];

/** True if `id` is a known, bookable room. */
export function isValidRoom(id) {
  return ROOMS.some((r) => r.roomId === String(id));
}

/** Public room list for the frontend dropdown — no secrets, safe to expose. */
export function roomCatalog() {
  return ROOMS.map((r) => ({ ...r }));
}

// Refresh tokens this many ms before the access token's stated expiry, so an
// in-flight request never races the deadline.
const EXPIRY_BUFFER_MS = 60_000;

console.log(
  `[Beds24] Auth mode: ${process.env.BEDS24_REFRESH_TOKEN ? 'refresh-token (auto)' : 'static access token (fallback)'}`
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

// In-memory access-token cache, scoped to this (warm) function instance.
let cachedToken = null; // { value, expiresAt }
let refreshInFlight = null; // de-dupes concurrent refreshes on a cold instance

// Exchange the refresh token for a fresh access token and cache it.
async function refreshAccessToken() {
  const rt = process.env.BEDS24_REFRESH_TOKEN;
  if (!rt) {
    throw new Beds24Error('missing_token', 'Beds24 refresh token is not configured.');
  }
  let res, body;
  try {
    res = await fetch(`${BASE}/authentication/token`, {
      headers: { refreshToken: rt, accept: 'application/json' },
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    throw new Beds24Error('upstream', 'Could not reach the Beds24 auth service.', e?.message);
  }
  if (!res.ok || !body?.token) {
    // The refresh token itself is invalid/expired — needs a manual re-bootstrap
    // via scripts/beds24-refresh.sh (invite code). Surface as token_expired.
    throw new Beds24Error('token_expired', 'Beds24 refresh token is invalid or expired.', body);
  }
  const ttlMs = (Number(body.expiresIn) || 86400) * 1000;
  cachedToken = { value: body.token, expiresAt: Date.now() + ttlMs };
  return cachedToken.value;
}

// Return a usable access token: cached when fresh, otherwise refreshed.
// `force` skips the cache (used to recover from an unexpected 401).
async function getAccessToken({ force = false } = {}) {
  if (process.env.BEDS24_REFRESH_TOKEN) {
    if (!force && cachedToken && cachedToken.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
      return cachedToken.value;
    }
    if (force) cachedToken = null;
    // Coalesce concurrent refreshes so a burst of requests triggers one exchange.
    if (!refreshInFlight) {
      refreshInFlight = refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }
  // Fallback: static access token (no refresh token configured).
  const t = process.env.BEDS24_ACCESS_TOKEN;
  if (!t) {
    throw new Beds24Error('missing_token', 'Beds24 access token is not configured.');
  }
  return t;
}

async function authHeaders({ force = false } = {}) {
  const token = await getAccessToken({ force });
  return { token, 'Content-Type': 'application/json', accept: 'application/json' };
}

// Fetch a Beds24 endpoint with auth. On 401/403 in refresh mode, force one
// token refresh and retry once before giving up. Returns { res, body }.
async function beds24Fetch(path, init, label) {
  const canRetry = !!process.env.BEDS24_REFRESH_TOKEN;
  const attempt = async (force) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...(await authHeaders({ force })), ...(init.headers || {}) } });

  let res;
  try {
    res = await attempt(false);
    if ((res.status === 401 || res.status === 403) && canRetry) {
      res = await attempt(true); // token may have been invalidated early — refresh & retry
    }
  } catch (e) {
    if (e instanceof Beds24Error) throw e;
    throw new Beds24Error('upstream', `Could not reach the ${label} service.`, e?.message);
  }

  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    throw new Beds24Error('token_expired', 'Beds24 token expired.', body);
  }
  return { res, body };
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
export async function getOffers({ arrival, departure, numAdults, roomId = ROOM_ID }) {
  const nights = nightsBetween(arrival, departure);
  const qs = new URLSearchParams({
    propertyId: String(PROPERTY_ID),
    arrival,
    departure,
    numAdults: String(numAdults),
  });

  const { res, body } = await beds24Fetch(
    `/inventory/rooms/offers?${qs}`,
    { method: 'GET' },
    'availability'
  );
  if (!res.ok) {
    throw new Beds24Error('upstream', 'Availability service error.', { status: res.status, body });
  }

  // Confirmed shape: { data: [ { roomId, propertyId, offers: [ { price, unitsAvailable } ] } ] }
  const room = findRoomOffer(body, roomId);
  const offer = room?.offers?.[0] || room; // tolerate flatter shapes too
  if (!offer) {
    return { available: false, pricePerStay: null, currency: 'THB', nights };
  }

  const pricePerStay = pickNumber(offer.price, offer.totalPrice, offer.priceTotal);
  const units = pickNumber(offer.unitsAvailable, offer.available, offer.quantity);
  const currency = offer.currency || room?.currency || 'THB';

  // Available only when there's a positive price AND (units unknown OR units > 0).
  const available = pricePerStay != null && pricePerStay > 0 && (units == null || units > 0);

  return { available, pricePerStay, currency, nights };
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
  roomId = ROOM_ID,
}) {
  const payload = [
    {
      roomId: Number(roomId),
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

  const { res, body } = await beds24Fetch(
    '/bookings',
    { method: 'POST', body: JSON.stringify(payload) },
    'booking'
  );
  if (!res.ok) {
    throw new Beds24Error('upstream', 'Booking service error.', { status: res.status, body });
  }

  // Response is an array of per-booking results. Accept a few field shapes.
  const first = Array.isArray(body) ? body[0] : body?.data?.[0] || body;
  const ok = first?.success !== false; // absent => assume success
  const bookingId = first?.id || first?.new?.id || first?.bookingId || first?.modified?.id || null;

  if (!ok || !bookingId) {
    throw new Beds24Error('unavailable', 'The booking could not be created.', body);
  }

  return { bookingId };
}
