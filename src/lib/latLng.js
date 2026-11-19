/* A NELOS CASE'S LOCATION, AS A COORDINATE.

   Optional on the raise form: Detect asks the phone, and the box takes the
   same two numbers typed or pasted. The columns arrive with
   shared/RUN_ME_nelos_case_location.sql in the office repository, and the
   box is not drawn until the database has them — a box that takes a
   coordinate and loses it at the insert is worse than no box.

   SHARED RULE, FOUR COPIES. This file is in Barcode_Counter and in Mobile,
   word for word, and parseLatLng is also MJMNelos.parseLatLng in
   mjm-ai-system/shared/shared_nelos.js and parseLatLng in
   shared/shared_nelos_dock.js. Different repositories cannot import from
   each other. Change one, change the others. */

/* "4.123456, 117.123456" → { lat, lng }. Three answers and all three are
   used: NULL is an empty box (no location, which is allowed), FALSE is
   something typed that is not a coordinate (refused, by name), and an
   object is a position. Comma, space or semicolon between the two and
   brackets ignored, so a pair pasted out of a map app goes straight in.
   Six decimals is about eleven centimetres. */
export function parseLatLng(text) {
  const s = String(text == null ? '' : text).replace(/[()[\]]/g, ' ').trim();
  if (!s) return null;
  const p = s.split(/[\s,;]+/).filter(Boolean);
  if (p.length !== 2) return false;
  const lat = Number(p[0]);
  const lng = Number(p[1]);
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export function fmtLatLng(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return '';
  const a = Number(lat);
  const b = Number(lng);
  if (!isFinite(a) || !isFinite(b)) return '';
  return `${a.toFixed(6)}, ${b.toFixed(6)}`;
}

export function mapsHref(lat, lng) {
  return 'https://www.google.com/maps?q=' + encodeURIComponent(`${Number(lat)},${Number(lng)}`);
}

/* OPEN IT IN GAIA GPS, which is the map the nursery walks by.

   On a PHONE this is the app's own link, which opens Gaia GPS on the spot
   if it is installed and does nothing at all if it is not — which is why
   the Maps link always stands beside it and is never replaced by it. On a
   desk there is no app to open, so it is the Gaia web map, where the
   address is zoom / longitude / latitude, in that order.

   It CENTRES the map on the spot. It does not drop a waypoint: the link
   has no word for one. */
export function gaiaHref(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return `gaiagps://map?lat=${a}&lng=${b}&z=17`;
  return `https://www.gaiagps.com/map/?loc=17.0/${b}/${a}`;
}

/* Ask the device once. Resolves { lat, lng, accuracy }; rejects with an
   Error whose `reason` is one of unsupported / denied / timeout / failed,
   so the form can say what to do instead — which is always to key it in. */
export function detectLatLng() {
  return new Promise((resolve, reject) => {
    const fail = (reason) => { const e = new Error(reason); e.reason = reason; reject(e); };
    if (typeof navigator === 'undefined' || !navigator.geolocation) return fail('unsupported');
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (e) => fail(e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'failed'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/* Does this database have the two columns? YES only on a read that came
   back clean. A missing column, a refusal and no signal all answer no:
   with no signal the insert is not going anywhere either, and the box
   appearing over a database that would refuse it is the one outcome worth
   avoiding. Only a real answer is remembered. */
let _has = null;
export async function hasLocationColumns(supabase) {
  if (_has !== null) return _has;
  try {
    const { error } = await supabase.from('nelos_cases').select('location_lat,location_lng').limit(1);
    if (!error) { _has = true; return true; }
    if (error.code === '42703' || /location_l(at|ng)/.test(error.message || '')) _has = false;
    return false;
  } catch {
    return false;
  }
}
