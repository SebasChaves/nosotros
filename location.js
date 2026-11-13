// Ubicación para fotos: se toma sola de la foto (si el teléfono la guardó), o se busca, o "Dónde estoy".
// Uso en un formulario: placeField('id') en el HTML, después initPlace('id', lugarInicial) y al guardar getPlace('id').
import { $, esc, expose, toast } from './core.js';

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
  return { name: area && area !== name ? `${name}, ${area}` : name, lat, lng, country: a.country || '' };
}

/* ---------- Campo de ubicación ---------- */
export const placeField = id => `<div id="${id}" class="place-field"></div>`;
export function initPlace(id, place = null) { state[id] = { place, open: false, results: [] }; draw(id); }
export const getPlace = id => state[id]?.place || null;
export function setPlace(id, place) { if (!state[id]) return; state[id].place = place; state[id].open = false; draw(id); }
function draw(id) {
  const el = $(id), s = state[id]; if (!el || !s) return;
  if (s.place) {
    el.innerHTML = `<div class="place-chip"><span>📍</span><span class="grow">${esc(s.place.name)}</span><button type="button" class="del" aria-label="Quitar ubicación" onclick="plClear('${id}')">✕</button></div>`;
  } else if (!s.open) {
    el.innerHTML = `<button type="button" class="link" style="padding:0;text-align:left" onclick="plOpen('${id}')">📍 Agregar ubicación</button>`;
  } else {
    el.innerHTML = `<div class="stack" style="gap:8px">
      <div class="add-row"><input id="${id}Q" placeholder="Busca el lugar: un restaurante, una playa, una ciudad…" aria-label="Buscar lugar" onkeydown="if(event.key==='Enter'){event.preventDefault();plSearch('${id}')}">
        <button type="button" class="btn" aria-label="Buscar" onclick="plSearch('${id}')">🔎</button></div>
      <div id="${id}R" class="stack" style="gap:2px"></div>
      <button type="button" class="btn ghost small" onclick="plHere('${id}')">📍 Dónde estoy</button></div>`;
    setTimeout(() => $(`${id}Q`)?.focus(), 50);
  }
}
function plOpen(id) { state[id].open = true; draw(id); }
function plClear(id) { state[id].place = null; state[id].open = false; draw(id); }
async function plSearch(id) {
  const q = $(`${id}Q`)?.value.trim(); if (!q || q.length < 2) return;
  const box = $(`${id}R`); box.innerHTML = '<p class="small muted center" style="margin:0">Buscando…</p>';
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&accept-language=es&q=${encodeURIComponent(q)}`)).json();
    state[id].results = r;
    box.innerHTML = r.length ? r.map((x, i) => `<button type="button" class="result-row" onclick="plChoose('${id}',${i})"><span class="e">📍</span><span class="grow small">${esc(x.display_name)}</span></button>`).join('')
      : '<p class="small muted center" style="margin:0">Sin resultados. Prueba con otro nombre.</p>';
  } catch { box.innerHTML = '<p class="small muted center" style="margin:0">No se pudo buscar. Revisa la conexión.</p>'; }
}
function plChoose(id, i) {
  const x = state[id].results[i]; if (!x) return;
  const name = x.name || x.display_name.split(',')[0], area = short(x.address);
  setPlace(id, { name: area && area !== name ? `${name}, ${area}` : name, lat: +x.lat, lng: +x.lon, country: x.address?.country || '' });
}
function plHere(id) {
  if (!navigator.geolocation) return toast('Este teléfono no permite ubicación');
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(async p => setPlace(id, await placeFromPoint(p.coords.latitude, p.coords.longitude)),
    () => toast('No se pudo obtener la ubicación'), { enableHighAccuracy: true, timeout: 10000 });
}
// Si la foto trae ubicación y todavía no se eligió una, se pone sola.
export async function placeFromPhoto(id, file) {
  const gps = await readExifGps(file);
  if (!gps || getPlace(id)) return;
  const place = await placeFromPoint(gps.lat, gps.lng);
  if (!getPlace(id)) { setPlace(id, place); toast('Ubicación tomada de la foto'); }
}

expose({ plOpen, plClear, plSearch, plChoose, plHere });
