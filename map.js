// Mapa de nosotros: pines de los lugares donde han estado. Mapa de OpenStreetMap con Leaflet (sin claves).
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, go, toast, openSheet, closeSheet, write, ref, newRef, ask, celebrate,
         todayKey, parseDate, fmtShort, nameOf, plural, uid } from './core.js';
import { backBar } from './lists.js';
import { myDailyDone } from './daily.js';
import { loadLeaflet, placeField, initPlace } from './location.js';

export const PIN_KINDS = [['📍', 'Lugar'], ['💞', 'Especial'], ['✈️', 'Viaje'], ['🍽️', 'Restaurante'], ['📸', 'Momento'], ['🏨', 'Hospedaje'], ['🌋', 'Naturaleza']];
let year = '', map = null, layer = null, filter = '', picking = false, draft = null, flyNext = null;
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
  const years = [...new Set(pins.map(p => (p.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const list = pins.filter(p => (!filter || p.kind === filter) && (!year || (p.date || '').startsWith(year))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  paint('mapInfo', `
    ${picking ? '<div class="glass center small">Toca en el mapa el lugar exacto · <button class="link" onclick="cancelPick()">Cancelar</button></div>' : ''}
    <div class="grid2"><div class="glass center"><div class="money grad-text">${pins.length}</div><div class="small muted">${pins.length === 1 ? 'lugar' : 'lugares'}</div></div>
      <div class="glass center"><div class="money grad-text">${c.length}</div><div class="small muted">${c.length === 1 ? 'país' : 'países'}</div></div></div>
    ${years.length > 1 || year ? `<div class="chips scroll"><button class="chip ${!year ? 'on' : ''}" onclick="pinYear('')">Todos los años</button>${years.map(y => `<button class="chip ${year === y ? 'on' : ''}" onclick="pinYear('${y}')">${y}</button>`).join('')}</div>` : ''}
    ${year ? (() => { const yp = pins.filter(p => (p.date || '').startsWith(year)), yc = new Set(yp.map(p => p.country).filter(Boolean)); return `<div class="glass small center">📅 En ${year} fueron a <b>${yp.length} ${yp.length === 1 ? 'lugar' : 'lugares'}</b>${yc.size ? ` en <b>${yc.size} ${yc.size === 1 ? 'país' : 'países'}</b> (${[...yc].map(esc).join(', ')})` : ''}</div>`; })() : ''}
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
      map.on('zoomend', () => drawPins(false));
      drawPins(true);
    } else drawPins(false);
    setTimeout(() => { map.invalidateSize(); if (flyNext) { map.setView(flyNext, 15); flyNext = null; } }, 60);
  } catch { $('mapBox').innerHTML = '<p class="empty">No se pudo cargar el mapa. Revisa la conexión.</p>'; }
}
// Los pines cercanos (a menos de ~44 px en pantalla) se juntan en un círculo con el número; al tocarlo, acerca.
function drawPins(fit) {
  if (!map) return;
  const L = window.L; layer.clearLayers();
  const inYear = d => !year || (d || '').startsWith(year);
  const marks = [];
  for (const p of S.data.pins.filter(p => (!filter || p.kind === filter) && inYear(p.date)))
    marks.push({ lat: p.lat, lng: p.lng, html: `<div class="map-pin"><span>${esc(p.kind)}</span></div>`, popup: `<b>${esc(p.title)}</b><br>${p.date ? fmtShort(parseDate(p.date)) : ''}${p.note ? '<br>' + esc(p.note) : ''}<br><a href="#" onclick="delPin('${p.id}');return false">Quitar</a>` });
  if (!filter || filter === '📸') for (const p of photoSpots().filter(p => inYear(p.date)))
    marks.push({ lat: p.lat, lng: p.lng, html: '<div class="map-pin photo"><span>📷</span></div>', popup: `<b>${esc(p.title)}</b><br>${p.date ? fmtShort(parseDate(p.date)) : ''} · ${esc(p.name)}<br><a href="#" onclick="viewPhoto({src:'',dataset:{thumb:'${p.id}'}});return false">Ver foto</a>` });
  // Restaurantes con ubicación (de la sección Restaurantes)
  if (!filter || filter === '🍽️') for (const p of S.data.places.filter(p => p.loc)) {
    const st = Object.values(p.ratings || {}), avgR = st.length ? (st.reduce((a, b) => a + b, 0) / st.length).toFixed(1) : '';
    marks.push({ lat: p.loc.lat, lng: p.loc.lng, html: `<div class="map-pin food"><span>🍽️</span></div>`, popup: `<b>${esc(p.name)}</b><br>${esc(p.status === 'been' ? 'Ya fueron' : 'Quieren ir')}${p.kind ? ' · ' + esc(p.kind) : ''}${avgR ? ` · ★ ${avgR}` : ''}<br><a href="#" onclick="go('s-places');return false">Ver en Restaurantes</a>` });
  }
  const groups = [];
  if (map.getZoom() < 15) {
    for (const m of marks) {
      const pt = map.latLngToLayerPoint([m.lat, m.lng]), g = groups.find(g => g.pt.distanceTo(pt) < 44);
      if (g) g.items.push(m); else groups.push({ pt, items: [m] });
    }
  } else for (const m of marks) groups.push({ items: [m] });
  for (const g of groups) {
    if (g.items.length === 1) { const m = g.items[0]; L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: m.html, iconSize: [34, 34], iconAnchor: [17, 34] }) }).bindPopup(m.popup).addTo(layer); continue; }
    const lat = g.items.reduce((s, m) => s + m.lat, 0) / g.items.length, lng = g.items.reduce((s, m) => s + m.lng, 0) / g.items.length;
    L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="map-cluster">${g.items.length}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }) })
      .on('click', () => map.fitBounds(g.items.map(m => [m.lat, m.lng]), { padding: [50, 50], maxZoom: 16 })).addTo(layer);
  }
  if (fit && marks.length) map.fitBounds(marks.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 13 });
}
function pinYear(y) { year = y; render(); drawPins(true); }
function flyPin(id) { const p = S.data.pins.find(x => x.id === id); if (p && map) { map.flyTo([p.lat, p.lng], 14); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
function pinFilter(k) { filter = k; render(); }
// Abre el mapa centrado en un punto (p. ej. al tocar el lugar de un momento).
function showOnMap(lat, lng) { flyNext = [lat, lng]; if (map && $('s-map').classList.contains('active')) { map.setView(flyNext, 15); flyNext = null; } else go('s-map'); }

/* ---------- Agregar ---------- */
function addPin() {
  openSheet(`<div class="stack"><h2>Agregar un lugar</h2>${placeField('pinPl')}
    <button class="btn ghost small" style="width:100%" onclick="pickOnMap()">🗺️ Tocar el mapa grande</button></div>`);
  initPlace('pinPl', null, { open: true, onPick: (_, x) => pinFromPlace(x) });
}
// Desde el buscador de lugares (o compartido a Futari): abre el formulario del pin con ese lugar
function pinFromPlace(x) {
  pinForm({ lat: x.lat, lng: x.lng, title: x.title || x.name.split(',')[0], place: x.area || x.name.split(',').slice(1).join(',').trim(), country: x.country || '' });
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

on('pins moments daily places', () => { if ($('mapBox') && $('s-map').classList.contains('active')) render(); });
onShow('s-map', render);
expose({ pinYear, showOnMap, addPin, pinFromPlace, myLocation, pickOnMap, cancelPick, savePin, delPin, flyPin, pinFilter });
