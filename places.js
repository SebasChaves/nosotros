// Restaurantes: a dónde quieren ir, dónde ya fueron, calificaciones, qué pidieron, ubicación y "cerca de mí".
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go,
         parseDate, fmtShort, todayKey, nameOf, partnerUid, uid, ask } from './core.js';
import { backBar } from './lists.js';
import { createList } from './decide.js';
import { placeField, initPlace, getPlace, distKm, fmtKm, myPosition, mapsUrl, wazeUrl } from './location.js';

let tab = 'want', kindF = '', near = null, editingId = null; // near = mi posición cuando se ordena por cercanía
const PRICES = ['', '$', '$$', '$$$', '$$$$'];
const avg = p => { const v = Object.values(p.ratings || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const starsView = n => `<span class="stars" aria-label="${n.toFixed(1)} de 5">${[1, 2, 3, 4, 5].map(i => `<span style="color:${i <= Math.round(n) ? 'var(--g2)' : 'var(--line)'}">${icon('star')}</span>`).join('')}</span>`;
const dist = p => near && p.loc ? distKm(near, p.loc) : null;
const kinds = () => [...new Set(S.data.places.map(p => (p.kind || '').trim()).filter(Boolean).map(k => k[0].toUpperCase() + k.slice(1).toLowerCase()))].sort();
const kindOk = p => !kindF || (p.kind || '').trim().toLowerCase() === kindF.toLowerCase();

function render() {
  const sortFn = near ? (a, b) => (dist(a) ?? 1e9) - (dist(b) ?? 1e9) : null;
  const want = S.data.places.filter(p => p.status !== 'been' && kindOk(p)).sort(sortFn || ((a, b) => b.createdAt - a.createdAt));
  const been = S.data.places.filter(p => p.status === 'been' && kindOk(p)).sort(sortFn || ((a, b) => avg(b) - avg(a)));
  const list = tab === 'want' ? want : been;
  const pu = partnerUid(), ks = kinds();
  paint('s-places', `${backBar('Restaurantes', 's-more', `<button class="btn small" onclick="openPlace()">${icon('plus')} Agregar</button>`)}
    <div class="seg"><button class="${tab === 'want' ? 'on' : ''}" onclick="placesTab('want')">Queremos ir · ${want.length}</button>
      <button class="${tab === 'been' ? 'on' : ''}" onclick="placesTab('been')">Ya fuimos · ${been.length}</button></div>
    <div class="chips scroll"><button class="chip ${near ? 'on' : ''}" onclick="placesNear()">📍 Cerca de mí</button>
      ${ks.length > 1 ? `<button class="chip ${!kindF ? 'on' : ''}" onclick="placesKind(-1)">Todo</button>${ks.map((k, i) => `<button class="chip ${kindF.toLowerCase() === k.toLowerCase() ? 'on' : ''}" onclick="placesKind(${i})">${esc(k)}</button>`).join('')}` : ''}</div>
    ${S.data.places.length ? `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="placesToDecide()">${icon('dice')} Elegir en Decidir</button>
      <button class="btn ghost small" style="width:100%" onclick="placesMap()">🗺️ Ver en el mapa</button></div>` : ''}
    ${list.length ? list.map(p => {
      const mine = p.ratings?.[uid()] || 0, theirs = pu ? p.ratings?.[pu] : null, d = dist(p);
      const visits = [...(p.visits || [])].sort((a, b) => b.date.localeCompare(a.date));
      return `<div class="glass stack">
        <div class="row" style="align-items:flex-start"><div style="min-width:0"><h2>${esc(p.name)}</h2>
          <span class="small muted">${[p.kind, PRICES[p.price || 0], d != null ? `a ${fmtKm(d)}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
          ${p.loc ? `<button class="link place-link" onclick="showOnMap(${p.loc.lat},${p.loc.lng})">📍 ${esc(p.loc.name)}</button>` : ''}</div>
          <button class="del" aria-label="Editar" onclick="openPlace('${p.id}')">✎</button></div>
        ${p.loc ? `<div class="grid2"><a class="btn ghost small" style="width:100%;text-decoration:none" href="${mapsUrl(p.loc)}" target="_blank" rel="noopener">Google Maps</a>
          <a class="btn ghost small" style="width:100%;text-decoration:none" href="${wazeUrl(p.loc)}" target="_blank" rel="noopener">Waze</a></div>` : ''}
        ${p.status === 'been' ? `
          <div class="row"><span class="small muted">Tu nota</span><span class="stars">${[1, 2, 3, 4, 5].map(i =>
            `<button class="${i <= mine ? 'on' : ''}" aria-label="${i} estrellas" onclick="ratePlace('${p.id}',${i})">${icon('star')}</button>`).join('')}</span></div>
          ${theirs ? `<div class="row"><span class="small muted">Nota de ${esc(nameOf(pu))}</span>${starsView(theirs)}</div>` : ''}
          ${visits.length ? `<ul class="list">${visits.slice(0, 3).map(v => `<li><div class="txt">${fmtShort(parseDate(v.date))}${v.note ? ` · ${esc(v.note)}` : ''}</div></li>`).join('')}</ul>` : ''}
          <button class="btn ghost small" style="width:100%" onclick="openVisit('${p.id}')">${icon('plus')} Fuimos otra vez</button>`
        : `<button class="btn small" style="width:100%" onclick="openVisit('${p.id}')">${icon('check')} Ya fuimos</button>`}
      </div>`;
    }).join('') : `<div class="glass center"><p class="muted" style="margin:0">${kindF ? 'Ninguno de ese tipo aquí' : tab === 'want' ? 'Anoten lugares que quieren probar' : 'Cuando vayan a uno, márquenlo como visitado'}</p></div>`}
    ${near && list.some(p => !p.loc) ? '<p class="tiny muted center" style="margin:0">Los que no tienen ubicación quedan al final. Edítenlos (✎) para agregarla.</p>' : ''}`);
}
function placesTab(t) { tab = t; render(); }
function placesKind(i) { kindF = i < 0 ? '' : kinds()[i] || ''; render(); }
async function placesNear() {
  if (near) { near = null; return render(); }
  toast('Buscando tu ubicación…');
  try { near = await myPosition(); render(); } catch { toast('No se pudo obtener la ubicación'); }
}
function placesMap() { window.pinFilter?.('🍽️'); go('s-map'); }

/* ---------- Agregar / editar ---------- */
function openPlace(id) {
  const p = id ? S.data.places.find(x => x.id === id) : null;
  editingId = p ? p.id : null;
  openSheet(`<div class="stack"><h2>${p ? 'Editar restaurante' : 'Nuevo restaurante'}</h2>
    <input id="plName" placeholder="Nombre" maxlength="50" aria-label="Nombre" value="${esc(p?.name || '')}">
    ${placeField('plLoc')}
    <div class="grid2"><input id="plKind" placeholder="Tipo: sushi, pizza…" maxlength="40" aria-label="Tipo de comida" value="${esc(p?.kind || '')}">
      <select id="plPrice" aria-label="Precio">${PRICES.map((x, i) => `<option value="${i}" ${(p?.price || 0) === i ? 'selected' : ''}>${x || 'Precio'}</option>`).join('')}</select></div>
    ${p ? '' : '<label class="check"><input type="checkbox" id="plBeen"> Ya fuimos</label>'}
    <button class="btn" onclick="savePlace()">${p ? 'Guardar cambios' : 'Guardar'}</button>
    ${p ? `<button class="btn ghost danger" onclick="delPlace('${p.id}')">${icon('trash')} Borrar restaurante</button>` : ''}</div>`);
  initPlace('plLoc', p?.loc || null, {
    label: '📍 Buscar dónde queda',
    query: () => $('plName')?.value.trim(),
    onPick: (place, x) => { if (!$('plName').value.trim()) $('plName').value = (x.name || place.name.split(',')[0]).slice(0, 50); },
  });
}
function savePlace() {
  const name = $('plName').value.trim(); if (!name) return toast('Pon el nombre');
  const data = { name, kind: $('plKind').value.trim(), price: Number($('plPrice').value) || 0, loc: getPlace('plLoc') };
  if (editingId && S.data.places.some(p => p.id === editingId)) {
    write(updateDoc(ref('places', editingId), data)); closeSheet(); toast('Cambios guardados'); editingId = null; return;
  }
  const been = $('plBeen').checked;
  write(setDoc(newRef('places'), { ...data, status: been ? 'been' : 'want', ratings: {},
    visits: been ? [{ date: todayKey(), note: '', by: uid() }] : [], createdAt: Date.now(), by: uid() }));
  tab = been ? 'been' : 'want';
  closeSheet();
}
function openVisit(id) {
  const p = S.data.places.find(x => x.id === id);
  openSheet(`<div class="stack"><h2>${esc(p.name)}</h2>
    <div><label class="f" for="vDate">¿Cuándo fueron?</label><input type="date" id="vDate" value="${todayKey()}"></div>
    <div><label class="f" for="vNote">¿Qué pidieron? (opcional)</label><input id="vNote" maxlength="120" placeholder="Ej: la pizza de la casa, muy rica"></div>
    <button class="btn" onclick="saveVisit('${id}')">Guardar visita</button></div>`);
}
function saveVisit(id) {
  const p = S.data.places.find(x => x.id === id); if (!p) return;
  const visits = [...(p.visits || []), { date: $('vDate').value || todayKey(), note: $('vNote').value.trim(), by: uid() }];
  write(updateDoc(ref('places', id), { status: 'been', visits }));
  tab = 'been'; closeSheet(); toast('¡Visita guardada! Califíquenlo');
}
function ratePlace(id, n) { write(updateDoc(ref('places', id), { [`ratings.${uid()}`]: n })); }
async function delPlace(id) { if (await ask('¿Borrar este restaurante?')) { write(deleteDoc(ref('places', id))); closeSheet(); } }
// Crea (o actualiza) una lista en Decidir con los lugares pendientes y los mejor calificados.
// Con "Cerca de mí" activo, solo entran los que están a menos de 10 km.
function placesToDecide() {
  let pool = S.data.places.filter(p => (p.status !== 'been' || avg(p) >= 3.5) && kindOk(p));
  if (near) pool = pool.filter(p => (dist(p) ?? 1e9) <= 10);
  const opts = [...new Set(pool.map(p => p.name))].slice(0, 30);
  if (opts.length < 2) return toast(near ? 'Hay menos de 2 lugares a menos de 10 km' : 'Necesitan al menos 2 lugares (pendientes o con 4★ o más)');
  const name = near ? 'Restaurantes cerca' : 'Nuestros restaurantes';
  const existing = S.data.lists.find(l => l.name === name);
  if (existing) { write(updateDoc(ref('lists', existing.id), { options: opts, votes: {} })); window.selectList(existing.id); }
  else createList(name, near ? '📍' : '🍽️', opts);
  window.decideTab('lists');
  go('s-decide');
  toast('Lista lista en Decidir');
}

on('places', render);
expose({ placesTab, placesKind, placesNear, placesMap, openPlace, savePlace, openVisit, saveVisit, ratePlace, delPlace, placesToDecide });
