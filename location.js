// Ubicación (fotos, momentos, restaurantes, mapa): se toma sola de la foto (si el teléfono la guardó), o se busca, se pega un
// enlace de Google Maps/Waze, «Estoy aquí» (lugares cercanos) o se pone a mano en el mapa.
// Uso en un formulario: placeField('id') en el HTML, después initPlace('id', lugarInicial) y al guardar getPlace('id').
import { $, S, esc, expose, toast, openSheet, closeSheet, syncBack, auth } from './core.js';
import { PUSH } from './push-config.js';

const state = {}; // id -> { place, open, results }

/* ---------- Leer el GPS guardado en la foto (EXIF de JPG) ---------- */
export async function readExifGps(file) {
  try {
    if (!file || !/jpe?g/i.test(file.type || file.name || '')) return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off), size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      off += 2 + size;
    }
  } catch {}
  return null;
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const ifd = o => { const n = u16(o), tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 }; } return tags; };
  const gpsPtr = ifd(u32(4))[0x8825];
  if (!gpsPtr) return null;
  const g = ifd(u32(gpsPtr.at));
  const ref = tag => tag ? String.fromCharCode(v.getUint8(t + tag.at)) : '';
  const deg = tag => { if (!tag) return NaN; const o = u32(tag.at), r = i => u32(o + i * 8) / u32(o + i * 8 + 4); return r(0) + r(1) / 60 + r(2) / 3600; };
  let lat = deg(g[2]), lng = deg(g[4]);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (ref(g[1]) === 'S') lat = -lat;
  if (ref(g[3]) === 'W') lng = -lng;
  return { lat, lng };
}

/* ---------- Nombres de lugares (OpenStreetMap) ---------- */
const short = a => a ? [a.city || a.town || a.village || a.county, a.state].filter(Boolean)[0] || '' : '';
export async function placeFromPoint(lat, lng) {
  let info = {};
  try { info = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&accept-language=es&lat=${lat}&lon=${lng}`)).json(); } catch {}
  const a = info.address || {};
  const name = info.name || a.road || short(a) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const area = short(a);
  return { name: area && area !== name ? `${name}, ${area}` : name, lat, lng, country: a.country || '', _a: a };
}

/* ---------- Buscar lugares ----------
   OpenStreetMap tiene pocos negocios de Costa Rica y pide el nombre casi exacto, así que se combinan varias cosas:
   1. Lo que ya guardaron (restaurantes, mapa, momentos y fotos del día) sale primero.
   2. Photon (komoot, OpenStreetMap): busca mientras escriben, tolera errores y da prioridad a lo cercano (o a Costa Rica).
   3. Nominatim (OpenStreetMap) al tocar 🔎 (no permite buscar letra por letra).
   4. Enlaces de Google Maps y Waze pegados (o compartidos a Futari en Android): se saca la ubicación del enlace; los
      cortos (maps.app.goo.gl) los abre el Worker de avisos (/link).
   5. «Estoy aquí»: restaurantes, cafés, bares… a unos 250 m (Overpass API) y «Ajustar en el mapa» con un pin. */
const COUNTRY = { CRC: 'cr', MXN: 'mx', COP: 'co', GTQ: 'gt', PEN: 'pe', ARS: 'ar', CLP: 'cl', EUR: 'es', USD: '' };
const BBOX = { cr: '-86.1,7.9,-82.4,11.3' };
const cc = () => COUNTRY[S.settings.currency] ?? 'cr';
let lastPos = null; // última posición conocida (solo si ya la dieron, para no pedir permiso por buscar)
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FOOD = /restaurant|cafe|bar|fast_food|pub|ice_cream|food_court|bakery|biergarten/;
const emojiFor = (k = '', v = '') => FOOD.test(v) ? (v === 'cafe' ? '☕' : v === 'bar' || v === 'pub' ? '🍻' : v === 'ice_cream' ? '🍦' : '🍽️') : /beach/.test(v) ? '🏖️' : /hotel|hostel|guest/.test(v) ? '🏨' : /park|garden/.test(v) ? '🌳' : /nature|peak|volcano/.test(v) ? '🌋' : k === 'place' || k === 'boundary' ? '🏙️' : '📍';
const mk = o => ({ ...o, name: o.area && o.area !== o.title && !norm(o.title).includes(norm(o.area)) ? `${o.title}, ${o.area}` : o.title });
// Lo que ya guardaron, por nombre (todas las palabras)
function savedPlaces(q) {
  const words = norm(q).split(/\s+/).filter(Boolean), out = [], seen = new Set();
  const add = (title, loc, e) => { if (!loc?.lat || !title) return; const k = norm(title) + Math.round(loc.lat * 1e3); if (seen.has(k)) return; seen.add(k); if (words.every(w => norm(title + ' ' + loc.name).includes(w))) out.push(mk({ title, area: (loc.name || '').split(',').slice(1).join(',').trim(), lat: loc.lat, lng: loc.lng, country: loc.country || '', e, sub: 'Ya lo tienen guardado', saved: true })); };
  for (const p of S.data.places || []) add(p.name, p.loc, '🍽️');
  for (const p of S.data.pins || []) add(p.title, { name: p.place, lat: p.lat, lng: p.lng, country: p.country }, p.kind || '📍');
  for (const m of S.data.moments || []) if (m.place) add(m.place.name.split(',')[0], m.place, '📸');
  return out.slice(0, 4);
}
async function photon(q, { country = cc(), limit = 8 } = {}) {
  const pos = lastPos || (country === 'cr' ? { lat: 9.93, lng: -84.08 } : null);
  const u = new URLSearchParams({ q, limit: String(limit) });
  if (pos) { u.set('lat', pos.lat); u.set('lon', pos.lng); u.set('location_bias_scale', '0.4'); }
  if (country && BBOX[country]) u.set('bbox', BBOX[country]);
  const r = await (await fetch('https://photon.komoot.io/api/?' + u)).json();
  return (r.features || []).filter(f => !country || BBOX[country] || (f.properties.countrycode || '').toLowerCase() === country).map(f => {
    const p = f.properties, [lng, lat] = f.geometry.coordinates;
    const area = [p.district || p.locality, p.city || p.county, p.state].filter((x, i, a) => x && a.indexOf(x) === i && x !== p.name).slice(0, 2).join(', ');
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    return mk({ title: p.name || street || p.city || 'Lugar', area: (p.city || p.county || p.state || ''), lat, lng, country: p.country || '', e: emojiFor(p.osm_key, p.osm_value), sub: [street, area, p.country !== 'Costa Rica' ? p.country : ''].filter(Boolean).join(' · ') });
  });
}
async function nominatim(q, country = cc()) {
  const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&accept-language=es${country ? '&countrycodes=' + country : ''}&q=${encodeURIComponent(q)}`)).json();
  return r.map(x => mk({ title: x.name || x.display_name.split(',')[0], area: short(x.address), lat: +x.lat, lng: +x.lon, country: x.address?.country || '', e: emojiFor(x.class, x.type), sub: x.display_name.split(',').slice(1, 4).join(',').trim() }));
}
// Junta resultados sin repetir (mismo nombre a menos de 80 m)
function merge(...lists) {
  const out = [];
  for (const r of lists.flat()) if (!out.some(o => norm(o.title) === norm(r.title) && distKm(o, r) < 0.08)) out.push(r);
  return out;
}
export async function searchPlaces(q, { full = false, world = false } = {}) {
  const country = world ? '' : cc();
  const [ph, no] = await Promise.all([photon(q, { country }).catch(() => []), full ? nominatim(q, country).catch(() => []) : []]);
  return merge(world ? [] : savedPlaces(q), ph, no).slice(0, 10);
}
// Lugares a unos 250 m (comida primero) — Overpass API, datos de OpenStreetMap
export async function nearbyPlaces(pos) {
  const a = `around:250,${pos.lat},${pos.lng}`;
  const q = `[out:json][timeout:12];(nwr(${a})[amenity~"^(restaurant|cafe|bar|fast_food|pub|ice_cream|food_court|biergarten)$"][name];nwr(${a})[shop~"^(bakery|pastry|deli|coffee)$"][name];nwr(around:150,${pos.lat},${pos.lng})[tourism~"^(hotel|attraction|museum|viewpoint|guest_house)$"][name];nwr(around:150,${pos.lat},${pos.lng})[leisure~"^(park|beach_resort)$"][name];);out center 40;`;
  const r = await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).json();
  return (r.elements || []).map(e => {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon, t = e.tags || {};
    return mk({ title: t.name, area: t['addr:city'] || '', lat, lng, country: '', e: emojiFor('', t.amenity || t.shop || t.tourism || t.leisure), food: !!(t.amenity && FOOD.test(t.amenity)) || !!t.shop,
      sub: [t.cuisine?.replace(/_/g, ' ').replace(/;/g, ', '), t['addr:street']].filter(Boolean).join(' · ') });
  }).filter(p => p.lat && p.title).map(p => ({ ...p, d: distKm(pos, p) })).sort((a, b) => (b.food - a.food) || a.d - b.d).slice(0, 25);
}

/* ---------- Enlaces de Google Maps y Waze ---------- */
const URL_RE = /https?:\/\/[^\s<>"']+/i;
export const looksLikeMapLink = t => /(google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|waze\.com)/i.test(t || '');
function geohash(h) {
  const B = '0123456789bcdefghjkmnpqrstuvwxyz'; let even = true, la = [-90, 90], lo = [-180, 180];
  for (const ch of h) { const n = B.indexOf(ch); if (n < 0) break; for (let i = 4; i >= 0; i--) { const r = even ? lo : la, m = (r[0] + r[1]) / 2; if ((n >> i) & 1) r[0] = m; else r[1] = m; even = !even; } }
  return { lat: (la[0] + la[1]) / 2, lng: (lo[0] + lo[1]) / 2 };
}
export function parseMapsUrl(u) {
  let s = u; try { s = decodeURIComponent(u.replace(/\+/g, ' ')); } catch {}
  const num = '(-?\\d{1,3}\\.\\d+)';
  const out = {};
  const name = /\/maps\/place\/([^/@?]+)/.exec(s); if (name) out.name = name[1].trim();
  let m = new RegExp(`!3d${num}!4d${num}`).exec(s) || new RegExp(`@${num},${num}`).exec(s) || new RegExp(`[?&](?:q|query|ll|center|daddr|destination|sll)=${num}\\s*,\\s*${num}`).exec(s);
  if (m) { out.lat = +m[1]; out.lng = +m[2]; }
  const wz = /waze\.com\/ul\/h([0-9a-z]+)/i.exec(s); if (!m && wz) Object.assign(out, geohash(wz[1]));
  if (out.lat == null) { const q = /[?&](?:q|query)=([^&]+)/.exec(s); if (q && !/^-?\d/.test(q[1])) out.query = q[1].trim(); }
  return out.lat != null || out.name || out.query ? out : null;
}
async function resolveLink(u) {
  if (!PUSH?.url || !auth.currentUser) return null;
  const r = await fetch(PUSH.url.replace(/\/$/, '') + '/link', { method: 'POST', headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) });
  if (r.status === 404) throw new Error('old-worker');
  if (!r.ok) return null;
  return (await r.json()).url || null;
}
// Texto pegado o compartido (puede traer el nombre en la primera línea y el enlace después) → lugar
export async function placeFromLink(text) {
  const m = URL_RE.exec(text || ''); if (!m) return null;
  let p = parseMapsUrl(m[0]);
  if ((!p || p.lat == null) && /goo\.gl|g\.co\//i.test(m[0])) { const fin = await resolveLink(m[0]); if (fin) p = parseMapsUrl(fin) || p; }
  const hint = (text.replace(m[0], '').split('\n').map(x => x.trim()).filter(x => x && !URL_RE.test(x))[0] || '').slice(0, 60);
  const title = p?.name || hint;
  if (p?.lat != null) {
    if (title) { const area = await placeFromPoint(p.lat, p.lng).catch(() => null); return mk({ title, area: area ? short(area._a) : '', lat: p.lat, lng: p.lng, country: area?.country || '' }); }
    const pt = await placeFromPoint(p.lat, p.lng); return { ...pt, title: pt.name.split(',')[0] };
  }
  const q = p?.query || title;
  if (q) { const r = await searchPlaces(q, { full: true }); if (r[0]) return { ...r[0], title: title || r[0].title }; }
  return null;
}

/* ---------- Campo de ubicación ---------- */
export const placeField = id => `<div id="${id}" class="place-field"></div>`;
// opts.query(): texto para buscar al abrir (p. ej. el nombre del restaurante). opts.onPick(lugar, detalle): al elegir uno.
// opts.label: texto del botón. opts.open: empieza abierto (con el buscador).
export function initPlace(id, place = null, opts = {}) { state[id] = { place, open: !!opts.open, results: [], opts }; draw(id); }
export const getPlace = id => { const p = state[id]?.place; return p ? { name: p.name, lat: p.lat, lng: p.lng, country: p.country || '' } : null; };
export function setPlace(id, place) { if (!state[id]) return; state[id].place = place; state[id].open = false; draw(id); }
function draw(id) {
  const el = $(id), s = state[id]; if (!el || !s) return;
  if (s.place) {
    el.innerHTML = `<div class="place-chip"><span>📍</span><span class="grow">${esc(s.place.name)}</span><button type="button" class="link small" onclick="plAdjust('${id}')">Ajustar</button><button type="button" class="del" aria-label="Quitar ubicación" onclick="plClear('${id}')">✕</button></div>`;
  } else if (!s.open) {
    el.innerHTML = `<button type="button" class="link" style="padding:0;text-align:left" onclick="plOpen('${id}')">${esc(s.opts?.label || '📍 Agregar ubicación')}</button>`;
  } else {
    el.innerHTML = `<div class="stack" style="gap:8px">
      <div class="add-row"><input id="${id}Q" placeholder="Nombre del lugar o pega un enlace de Google Maps" aria-label="Buscar lugar" autocomplete="off" oninput="plType('${id}')" onkeydown="if(event.key==='Enter'){event.preventDefault();plSearch('${id}')}">
        <button type="button" class="btn" aria-label="Buscar" onclick="plSearch('${id}')">🔎</button></div>
      <div id="${id}R" class="stack" style="gap:2px"></div>
      <div class="pl-tools"><button type="button" class="btn ghost small" onclick="plHere('${id}')">📍 Estoy aquí</button>
        <button type="button" class="btn ghost small" onclick="plPaste('${id}')">🔗 Pegar enlace</button>
        <button type="button" class="btn ghost small" onclick="plMap('${id}')">🗺️ En el mapa</button></div>
      <p class="tiny muted" style="margin:0">¿No aparece? En Google Maps o Waze busca el lugar → <b>Compartir</b> → <b>Copiar enlace</b> y pégalo arriba.</p></div>`;
    const q = s.opts?.query?.() || '';
    if (q) { $(`${id}Q`).value = q; plSearch(id); } else setTimeout(() => $(`${id}Q`)?.focus(), 50);
  }
}
const resultsHtml = (id, r, empty) => r.length ? r.map((x, i) => `<button type="button" class="result-row" onclick="plChoose('${id}',${i})"><span class="e">${x.e || '📍'}</span>
  <span class="grow small" style="min-width:0"><b style="display:block">${esc(x.title)}</b><span class="tiny muted">${esc([x.sub || x.area, x.d != null ? fmtKm(x.d) : lastPos && x.lat ? fmtKm(distKm(lastPos, x)) : ''].filter(Boolean).join(' · '))}</span></span></button>`).join('')
  : `<p class="small muted center" style="margin:0">${empty}</p>`;
function plOpen(id) { state[id].open = true; draw(id); }
function plClear(id) { state[id].place = null; state[id].open = true; draw(id); }
// Mientras escriben: lo guardado al instante y Photon con una pausa. Si pegan un enlace, se usa el enlace.
let typeTimer = null;
function plType(id) {
  const q = $(`${id}Q`)?.value.trim() || '';
  clearTimeout(typeTimer);
  if (URL_RE.test(q)) return plLink(id, q);
  if (q.length < 3) return;
  const box = $(`${id}R`), saved = savedPlaces(q);
  state[id].results = saved; box.innerHTML = saved.length ? resultsHtml(id, saved, '') : '';
  typeTimer = setTimeout(async () => {
    try { const r = await searchPlaces(q); if ($(`${id}Q`)?.value.trim() !== q) return; state[id].results = r; box.innerHTML = resultsHtml(id, r, 'Sigue escribiendo o toca 🔎'); } catch {}
  }, 450);
}
async function plSearch(id, world = false) {
  const q = $(`${id}Q`)?.value.trim(); if (!q || q.length < 2) return;
  if (URL_RE.test(q)) return plLink(id, q);
  clearTimeout(typeTimer);
  const box = $(`${id}R`); box.innerHTML = '<p class="small muted center" style="margin:0">Buscando…</p>';
  try {
    let r = await searchPlaces(q, { full: true, world }), local = !world && !!cc();
    if (!r.length && local) { r = await searchPlaces(q, { full: true, world: true }); local = false; }
    state[id].results = r;
    box.innerHTML = resultsHtml(id, r, 'Sin resultados. Prueba con «Pegar enlace» de Google Maps, «Estoy aquí» o «En el mapa».')
      + (local && r.length ? `<button type="button" class="link small" style="padding:4px 0" onclick="plSearch('${id}',true)">¿No es ninguno? Buscar en otros países</button>` : '');
  } catch { box.innerHTML = '<p class="small muted center" style="margin:0">No se pudo buscar. Revisa la conexión.</p>'; }
}
async function plLink(id, text) {
  const box = $(`${id}R`); if (box) box.innerHTML = '<p class="small muted center" style="margin:0">Leyendo el enlace…</p>';
  try {
    const p = await placeFromLink(text);
    if (!p) { if (box) box.innerHTML = '<p class="small muted center" style="margin:0">No encontré la ubicación en ese enlace. Prueba copiándolo otra vez desde «Compartir».</p>'; return; }
    choose(id, p);
  } catch (e) { if (box) box.innerHTML = `<p class="small muted center" style="margin:0">${e.message === 'old-worker' ? 'Para leer enlaces cortos de Google (maps.app.goo.gl) falta actualizar el servicio de avisos en Cloudflare. Mientras tanto, prueba con el enlace de Waze o busca por nombre.' : 'No se pudo leer el enlace. Revisa la conexión.'}</p>`; }
}
async function plPaste(id) {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch {}
  if (t && URL_RE.test(t)) { $(`${id}Q`).value = t; return plLink(id, t); }
  $(`${id}Q`).value = ''; $(`${id}Q`).placeholder = 'Mantén presionado aquí → Pegar'; $(`${id}Q`).focus();
  toast('Pega aquí el enlace que copiaste de Google Maps o Waze');
}
function choose(id, p) {
  setPlace(id, { name: p.name, lat: p.lat, lng: p.lng, country: p.country || '' });
  state[id].opts?.onPick?.(state[id].place, p);
}
function plChoose(id, i) { const x = state[id].results[i]; if (x) choose(id, x); }
async function plHere(id) {
  const box = $(`${id}R`); box.innerHTML = '<p class="small muted center" style="margin:0">Buscando dónde estás…</p>';
  let pos;
  try { pos = await myPosition(true); } catch { box.innerHTML = '<p class="small muted center" style="margin:0">No se pudo obtener la ubicación. Revisa el permiso de ubicación.</p>'; return; }
  let near = [];
  try { near = await nearbyPlaces(pos); } catch {}
  const here = { ...(await placeFromPoint(pos.lat, pos.lng)), e: '📍', sub: 'Tu ubicación exacta (sin nombre de lugar)' };
  here.title = here.name; state[id].results = [...near, here];
  box.innerHTML = `${near.length ? '<p class="tiny muted" style="margin:0">Lugares cerca de ti:</p>' : '<p class="tiny muted" style="margin:0">No encontré lugares con nombre aquí cerca.</p>'}${resultsHtml(id, state[id].results, '')}`;
}
async function plMap(id) {
  const q = $(`${id}Q`)?.value.trim();
  let start = lastPos || (cc() === 'cr' ? { lat: 9.93, lng: -84.08, zoom: 9 } : { lat: 20, lng: -40, zoom: 2 });
  if (q && !URL_RE.test(q)) { const r = await searchPlaces(q).catch(() => []); if (r[0]) start = { lat: r[0].lat, lng: r[0].lng, zoom: 15 }; }
  const pt = await pickPoint(start, q ? `Mueve el pin hasta «${q}»` : 'Mueve el pin al lugar exacto');
  if (!pt) return;
  const p = await placeFromPoint(pt.lat, pt.lng);
  choose(id, { ...p, name: q && !URL_RE.test(q) ? `${q}${p.name.includes(',') ? ', ' + p.name.split(',').slice(-1)[0].trim() : ''}` : p.name, title: q || p.name.split(',')[0] });
}
async function plAdjust(id) {
  const cur = state[id]?.place; if (!cur) return;
  const pt = await pickPoint({ ...cur, zoom: 17 }, 'Mueve el pin al punto exacto');
  if (pt) { state[id].place = { ...cur, lat: pt.lat, lng: pt.lng }; draw(id); toast('Ubicación ajustada 📍'); }
}

// Si la foto trae ubicación y todavía no se eligió una, se pone sola.
export async function placeFromPhoto(id, file) {
  const gps = await readExifGps(file);
  if (!gps || getPlace(id)) return;
  const place = await placeFromPoint(gps.lat, gps.lng);
  if (!getPlace(id)) { setPlace(id, place); toast('Ubicación tomada de la foto'); }
}

/* ---------- Mapa para mover un pin ---------- */
let leaflet = null;
export function loadLeaflet() {
  if (leaflet) return leaflet;
  leaflet = new Promise((ok, bad) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => ok(window.L); s.onerror = () => { leaflet = null; bad(); }; document.head.appendChild(s);
  });
  return leaflet;
}
// Pantalla con un mapa y un pin que se arrastra (o se toca el mapa). Devuelve { lat, lng } o null.
export function pickPoint(start, title = 'Mueve el pin al lugar exacto') {
  return new Promise(async done => {
    const el = document.createElement('div'); el.className = 'dialog pick-view'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
    el.innerHTML = `<div class="mt-top"><b>${esc(title)}</b><button class="link" data-x>Cancelar</button></div><div class="pick-map map-box noswipe"></div>
      <p class="tiny muted center" style="margin:0">Arrastra el pin o toca el mapa. Pellizca para acercar.</p><button class="btn" data-ok>Usar este punto</button>`;
    document.body.appendChild(el); syncBack();
    const close = v => { el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); done(v); };
    el.querySelector('[data-x]').onclick = () => close(null);
    let L; try { L = await loadLeaflet(); } catch { toast('No se pudo cargar el mapa'); return close(null); }
    const m = L.map(el.querySelector('.pick-map'), { zoomControl: false, attributionControl: false }).setView([start.lat, start.lng], start.zoom || 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    const pin = L.marker([start.lat, start.lng], { draggable: true, icon: L.divIcon({ className: 'pick-pin', html: '📍', iconSize: [36, 36], iconAnchor: [18, 34] }) }).addTo(m);
    m.on('click', e => pin.setLatLng(e.latlng));
    setTimeout(() => m.invalidateSize(), 200);
    el.querySelector('[data-ok]').onclick = () => { const ll = pin.getLatLng(); close({ lat: ll.lat, lng: ll.lng }); };
  });
}

/* ---------- Compartir a Futari (Android: Google Maps → Compartir → Futari) ---------- */
// manifest.json → share_target abre ./?title=…&text=…&url=… (Google Maps manda el nombre y el enlace en «text»)
export function shareShortcut() {
  const qs = new URLSearchParams(location.search);
  if (!qs.has('share') && !qs.has('text') && !qs.has('url')) return;
  const text = ['title', 'text', 'url'].map(k => qs.get(k) || '').filter(Boolean).join('\n');
  ['share', 'title', 'text', 'url'].forEach(k => qs.delete(k));
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString().replace(/=(&|$)/g, '$1') : ''));
  let tries = 0;
  const run = async () => {
    if ($('lockScreen') || !S.me || !document.body.classList.contains('in')) { if (++tries < 120) setTimeout(run, 400); return; }
    if (!URL_RE.test(text) || !looksLikeMapLink(text)) return toast('Futari no reconoció lo que compartiste. Comparte un lugar de Google Maps o Waze');
    toast('Leyendo el lugar…');
    let p = null; try { p = await placeFromLink(text); } catch (e) { return toast(e.message === 'old-worker' ? 'Falta actualizar el servicio de avisos para leer enlaces de Google' : 'No se pudo leer el enlace'); }
    if (!p) return toast('No encontré la ubicación en lo que compartiste');
    window.__sharedPlace = p;
    openSheet(`<div class="stack"><h2>📍 ${esc(p.title || p.name)}</h2><p class="small muted" style="margin:0">${esc(p.name)}</p>
      <button class="btn" onclick="sharedTo('place')">🍽️ Guardar en Restaurantes</button>
      <button class="btn ghost" onclick="sharedTo('pin')">🗺️ Guardar en Nuestro mapa</button></div>`);
  };
  setTimeout(run, 300);
}
function sharedTo(where) {
  const p = window.__sharedPlace; if (!p) return;
  closeSheet();
  setTimeout(() => {
    if (where === 'place') { window.go('s-places'); window.openPlace(); setTimeout(() => { $('plName').value = (p.title || p.name.split(',')[0]).slice(0, 50); setPlace('plLoc', { name: p.name, lat: p.lat, lng: p.lng, country: p.country || '' }); }, 80); }
    else { window.go('s-map'); window.pinFromPlace?.(p); }
  }, 200);
}

/* ---------- Distancias ---------- */
export function distKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const fmtKm = k => k < 1 ? `${Math.round(k * 1000 / 50) * 50} m` : `${k < 10 ? k.toFixed(1).replace('.', ',') : Math.round(k)} km`;
export const myPosition = (precise = false) => new Promise((ok, bad) => {
  if (!navigator.geolocation) return bad(new Error('nogeo'));
  navigator.geolocation.getCurrentPosition(p => { lastPos = { lat: p.coords.latitude, lng: p.coords.longitude }; ok(lastPos); }, bad,
    { enableHighAccuracy: precise, timeout: 12000, maximumAge: precise ? 30000 : 300000 });
});
// Enlaces para llegar con Google Maps o Waze.
export const mapsUrl = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const wazeUrl = p => `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;

expose({ plOpen, plClear, plSearch, plChoose, plHere, plType, plPaste, plMap, plAdjust, sharedTo });
