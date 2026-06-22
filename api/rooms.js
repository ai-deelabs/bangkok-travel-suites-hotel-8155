// GET /api/rooms
// Public room catalog for the booking dropdown. No token, no secrets — just the
// bookable rooms (id, bilingual name, max guests) sourced from the ROOMS catalog
// in _lib/beds24.js. Add a room there and it shows up here automatically.
import { roomCatalog } from './_lib/beds24.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Small, stable list — let the CDN cache it briefly.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
  return res.status(200).json({ rooms: roomCatalog() });
}
