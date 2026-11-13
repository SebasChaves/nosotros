// Mapa de nosotros: pines de los lugares donde han estado. Mapa de OpenStreetMap con Leaflet (sin claves).
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, go, toast, openSheet, closeSheet, write, ref, newRef, ask, celebrate,
         todayKey, parseDate, fmtShort, nameOf, plural, uid } from './core.js';
import { backBar } from './lists.js';
import { myDailyDone } from './daily.js';

export const PIN_KINDS = [['📍', 'Lugar'], ['💞', 'Especial'], ['✈️', 'Viaje'], ['🍽️', 'Restaurante'], ['📸', 'Momento'], ['🏨', 'Hospedaje'], ['🌋', 'Naturaleza']];
let map = null, layer = null, leaflet = null, filter = '', picking = false, draft = null, flyNext = null;
// Fotos con ubicación (momentos y fotos del día). La foto del día de la pareja de hoy no se muestra hasta subir la propia.
const photoSpots = () => {
  const out = [], tk = todayKey();
  for (const m of S.data.moments) if (m.place && m.hasPhoto) out.push({ id: m.id, title: m.title, date: m.date, ...m.place });
  for (const d of S.data.daily) for (const [who, e] of Object.entries(d)) {
    if (who === 'id' || !e?.place) continue;
    if (d.id === tk && who !== uid() && !myDailyDone()) continue;
    out.push({ id: e.photo, title: e.caption || "Foto del día de ${nameOf(who)}", date: d.id, ...e.place });
  }
  return out;
};
const countries = () => [...new Set(S.data.pins.map(p => p.country).filter(Boolean))];

function loadLeaflet() {
  if (leaflet) return leaflet;
  leaflet = new Promise((ok, bad) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => ok(window.L); s.onerror = bad; document.head.appendChild(s);
  });
  return leaflet;
}
// Mapas de OpenStreetMap (libres, con atribución). En modo oscuro se oscurecen con un filtro (ver .map-box en styles.css).
const tileUrl = () => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function skeleton() {
  if ($('mapBox')) return;
  $('s-map').innerHTML = `<div id="mapHead"></div><div id="mapBox" class="map-box" role="application" aria-label="Mapa de lugares"></div><div id="mapInfo" class="stack" style="gap:12px"></div>`;
}
async function render() {
  skeleton();
  const pins = S.data.pins, c = countries();
  paint('mapHead', backBar('Nuestro mapa', 's-more', `<button class="btn small" onclick="addPin()">${icon('plus')} Lugar</button>`));
  const list = pins.filter(p => !filter || p.kind === filter).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  paint('mapInfo', `
    ${picking ? '<div class="glass center small">Toca en el mapa el lugar exacto · <button class="link" onclick="cancelPick()">Cancelar</button></div>' : ''}
    <div class="grid2"><div class="glass center"><div class="money grad-text">${pins.length}</div><div class="small muted">${pins.length === 1 ? 'lugar' : 'lugares'}</div></div>
      <div class="glass center"><div class="money grad-text">${c.length}</div><div class="small muted">${c.length === 1 ? 'país' : 'países'}</div></div></div>
    <div class="chips scroll"><button class="chip ${!filter ? 'on' : ''}" onclick="pinFilter('')">Todos</button>${PIN_KINDS.map(([e, l]) => `<button class="chip ${filter === e ? 'on' : ''}" onclick="pinFilter('${e}')">${e} ${l}</button>`).join('')}</div>
    <div class="glass" style="padding:6px 14px">${list.length ? list.map(p => `<button class="result-row" onclick="flyPin('${p.id}')"><span class="e">${esc(p.kind)}</span>
      <span class="grow" style="min-width:0"><b style="display:block">${esc(p.title)}</b><span class="tiny muted">${[p.date ? fmtShort(parseDate(p.date)) : '', p.place, nameOf(p.by)].filter(Boolean).map(esc).join(' · ')}</span></span></button>`).join('')
      : '<p class="empty">Agreguen el primer lugar donde han estado juntos</p>'}</div>
    <p class="tiny muted center" style="margin:0">Mapa: © colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:inherit">OpenStreetMap</a></p>`);
  try {
    const L = await loadLeaflet();
    if (!map) {
      map = L.map('mapBox', { zoomControl: false, attributionControl: false }).setView([9.93, -84.08], 7);
      L.tileLayer(tileUrl(), { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on('click', e => { if (picking) { picking = false; usePoint(e.latlng.lat, e.latlng.lng); } });
      drawPins(true);
    } else drawPins(false);
    setTimeout(() => { map.invalidateSize(); if (flyNext) { map.setView(flyNext, 15); flyNext = null; } }, 60);
  } catch { $('mapBox').innerHTML = '<p class="empty">No se pudo cargar el mapa. Revisa la conexión.</p>'; }
}
function drawPins(fit) {
  if (!map) return;
  const L = window.L; layer.clearLayers();
  const pins = S.data.pins.filter(p => !filter || p.kind === filter);
  for (const p of pins) {
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="map-pin"><span>${esc(p.kind)}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }) })
      .bindPopup(`<b>${esc(p.title)}</b><br>${p.date ? fmtShort(parseDate(p.date)) : ''}${p.note ? '<br>' + esc(p.note) : ''}<br><a href="#" onclick="delPin('${p.id}');return false">Quitar</a>`)
      .addTo(layer);
  }
  const photos = !filter || filter === '📸' ? photoSpots() : [];
  for (const p of photos) {
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="map-pin photo"><span>📷</span></div>', iconSize: [34, 34], iconAnchor: [17, 34] }) })
      .bindPopup(`<b>${esc(p.title)}</b><br>${p.date ? fmtShort(parseDate(p.date)) : ''} · ${esc(p.name)}<br><a href="#" onclick="viewPhoto({src:'',dataset:{thumb:'${p.id}'}});return false">Ver foto</a>`)
      .addTo(layer);
  }
  const all = [...pins, ...photos];
  if (fit && all.length) map.fitBounds(all.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 13 });
}
function flyPin(id) { const p = S.data.pins.find(x => x.id === id); if (p && map) { map.flyTo([p.lat, p.lng], 14); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
function pinFilter(k) { filter = k; render(); }
// Abre el mapa centrado en un punto (p. ej. al tocar el lugar de un momento).
function showOnMap(lat, lng) { flyNext = [lat, lng]; if (map && $('s-map').classList.contains('active')) { map.setView(flyNext, 15); flyNext = null; } else go('s-map'); }

/* ---------- Agregar ---------- */
function addPin() {
  openSheet(`<div class="stack"><h2>Agregar un lugar</h2>
    <div class="add-row"><input id="pinQ" placeholder="Busca: Playa Tamarindo, París, un restaurante…" aria-label="Buscar lugar" onkeydown="if(event.key==='Enter')searchPlace()">
      <button class="btn" aria-label="Buscar" onclick="searchPlace()">${icon('search')}</button></div>
    <div id="pinResults" class="stack" style="gap:2px"></div>
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="myLocation()">📍 Dónde estoy</button>
      <button class="btn ghost small" style="width:100%" onclick="pickOnMap()">🗺️ Tocar el mapa</button></div></div>`);
}
async function searchPlace() {
  const qv = $('pinQ').value.trim(); if (qv.length < 2) return;
  $('pinResults').innerHTML = '<p class="small muted center">Buscando…</p>';
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&accept-language=es&q=${encodeURIComponent(qv)}`)).json();
    window.__pinResults = r;
    $('pinResults').innerHTML = r.length ? r.map((x, i) => `<button class="result-row" onclick="choosePlace(${i})"><span class="e">📍</span><span class="grow small">${esc(x.display_name)}</span></button>`).join('')
      : '<p class="small muted center">Sin resultados. Prueba con otro nombre o toca el mapa.</p>';
  } catch { $('pinResults').innerHTML = '<p class="small muted center">No se pudo buscar. Revisa la conexión.</p>'; }
}
function choosePlace(i) {
  const x = window.__pinResults[i];
  pinForm({ lat: +x.lat, lng: +x.lon, title: x.name || x.display_name.split(',')[0], place: placeName(x.address), country: x.address?.country || '' });
}
const placeName = a => a ? [a.city || a.town || a.village || a.county, a.state].filter(Boolean)[0] || '' : '';
function myLocation() {
  if (!navigator.geolocation) return toast('Este teléfono no permite ubicación');
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(p => usePoint(p.coords.latitude, p.coords.longitude), () => toast('No se pudo obtener la ubicación'), { enableHighAccuracy: true, timeout: 10000 });
}
function pickOnMap() { closeSheet(); picking = true; render(); toast('Toca el lugar en el mapa'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function cancelPick() { picking = false; render(); }
async function usePoint(lat, lng) {
  let info = {};
  try { info = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&accept-language=es&lat=${lat}&lon=${lng}`)).json(); } catch {}
  pinForm({ lat, lng, title: info.name || info.address?.road || '', place: placeName(info.address), country: info.address?.country || '' });
}
function pinForm(d) {
  draft = d;
  openSheet(`<div class="stack"><h2>Nuevo lugar</h2>
    <p class="small muted" style="margin:0">${esc([d.place, d.country].filter(Boolean).join(', ') || `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`)}</p>
    <input id="pinTitle" placeholder="Nombre del lugar" maxlength="60" value="${esc(d.title)}" aria-label="Nombre">
    <div class="grid2"><select id="pinKind" aria-label="Tipo">${PIN_KINDS.map(([e, l]) => `<option value="${e}">${e} ${l}</option>`).join('')}</select>
      <input type="date" id="pinDate" value="${todayKey()}" aria-label="Fecha"></div>
    <input id="pinNote" placeholder="Nota (opcional)" maxlength="120" aria-label="Nota">
    <button class="btn" onclick="savePin()">Guardar en el mapa</button></div>`);
}
function savePin() {
  const title = $('pinTitle').value.trim(); if (!title || !draft) return toast('Ponle nombre al lugar');
  const newCountry = draft.country && !countries().includes(draft.country);
  write(setDoc(newRef('pins'), { title, kind: $('pinKind').value, lat: draft.lat, lng: draft.lng, place: draft.place || '', country: draft.country || '',
    date: $('pinDate').value || todayKey(), note: $('pinNote').value.trim(), by: uid(), createdAt: Date.now() }));
  closeSheet(); toast(newCountry && countries().length ? `¡Nuevo país: ${draft.country}!` : 'Lugar guardado');
  if (newCountry) celebrate();
  setTimeout(() => map?.flyTo([draft.lat, draft.lng], 13), 300);
}
async function delPin(id) { if (await ask('¿Quitar este lugar del mapa?')) { write(deleteDoc(ref('pins', id))); map?.closePopup(); } }

on('pins moments daily', () => { if ($('mapBox') && $('s-map').classList.contains('active')) render(); });
onShow('s-map', render);
expose({ showOnMap, addPin, searchPlace, choosePlace, myLocation, pickOnMap, cancelPick, savePin, delPin, flyPin, pinFilter });
