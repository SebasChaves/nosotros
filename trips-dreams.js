// Viajes → «Por conocer» (1.3.0): destinos soñados fuera de cualquier viaje. Colección "dreams":
// { name, place?{name,lat,lng,country}, url?, kind, abroad, cost?, days?, season?, note?, by, at, votes{uid: 1|-1},
//   photo? (true: foto en photos/dream-<id> + miniatura), tripId? (cuando se convirtió en viaje), went? (ya fueron) }
// Salen como pines ✨ en Nuestro mapa. «¿A dónde vamos?» elige al azar entre los que caben en presupuesto y días.
import { setDoc, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, expose, toast, openSheet, closeSheet, write, ref, newRef, fmtMoney, nameOf, partnerUid, plural, uid,
         loadPhotos, compressImage, makeThumb, thumbId, cachePhoto, photoError, softDelete, animatePick, celebrate } from './core.js';
import { placeField, initPlace, getPlace } from './location.js';
import { parseAmount } from './money.js';
import { notify, meForPartner } from './push.js';

export const DREAM_KINDS = [['🏖️', 'Playa'], ['⛰️', 'Montaña'], ['🏙️', 'Ciudad'], ['🌿', 'Naturaleza'], ['🏰', 'Cultura'], ['🎢', 'Diversión'], ['📍', 'Otro']];
const dPhoto = id => `dream-${id}`;
let fKind = '', fWhere = '', fMax = 0, fDays = 0;
const score = d => Object.values(d.votes || {}).reduce((s, v) => s + (v || 0), 0);
const safeUrl = u => /^https?:\/\//i.test(u || '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const dreamsPending = () => S.data.dreams.filter(d => !d.went && d.by !== uid() && d.votes?.[uid()] === undefined).length;

function filtered() {
  return S.data.dreams.filter(d => !d.went && (!fKind || d.kind === fKind) && (!fWhere || (fWhere === 'fuera') === !!d.abroad) && (!fMax || !d.cost || d.cost <= fMax) && (!fDays || !d.days || d.days <= fDays));
}
export function dreamsHTML() {
  const list = filtered().sort((a, b) => score(b) - score(a) || b.at - a.at), went = S.data.dreams.filter(d => d.went), p = partnerUid();
  const card = d => {
    const mine = d.votes?.[uid()], theirs = p ? d.votes?.[p] : undefined;
    return `<div class="glass dream">
      ${d.photo ? `<img data-thumb="${dPhoto(d.id)}" alt="" onclick="viewPhoto(this)">` : `<div class="dream-e">${esc(d.kind || '📍')}</div>`}
      <div class="dream-b"><div class="row"><b>${esc(d.name)}</b>${score(d) > 1 ? '<span class="pill hot">💞 A los dos</span>' : ''}</div>
        <span class="tiny muted">${[d.place?.country || (d.abroad ? 'Afuera' : 'En el país'), d.cost ? `≈ ${fmtMoney(d.cost)}` : '', d.days ? plural(d.days, 'día', 'días') : '', d.season ? `mejor: ${d.season}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        ${d.note ? `<span class="small" style="display:block;margin-top:4px">${esc(d.note)}</span>` : ''}
        ${safeUrl(d.url) ? `<a class="small" href="${esc(d.url)}" target="_blank" rel="noopener">🔗 ${esc(host(d.url))}</a>` : ''}
        <span class="tiny muted" style="display:block;margin-top:4px">Lo propuso ${esc(nameOf(d.by))}${theirs === 1 ? ` · a ${esc(nameOf(p))} le encanta` : theirs === -1 ? ` · ${esc(nameOf(p))} no está tan seguro` : ''}</span>
        <div class="row" style="gap:6px;margin-top:8px">
          <button class="icon-btn sm ${mine === 1 ? 'on' : ''}" aria-label="Me encanta" onclick="voteDream('${d.id}',1)">👍</button>
          <button class="icon-btn sm ${mine === -1 ? 'on' : ''}" aria-label="No tanto" onclick="voteDream('${d.id}',-1)">👎</button>
          <span class="grow"></span>
          ${d.tripId && S.data.trips.some(t => t.id === d.tripId) ? `<button class="btn small ghost" onclick="openTrip('${d.tripId}')">Ver viaje</button>` : `<button class="btn small" onclick="dreamToTrip('${d.id}')" style="white-space:nowrap">✈️ Planear</button>`}
          <button class="del" aria-label="Más" onclick="dreamMenu('${d.id}')">⋯</button></div></div></div>`;
  };
  return `<div class="glass stack"><div class="grid2"><button class="btn" onclick="dreamForm()">${icon('plus')} Lugar por conocer</button><button class="btn ghost" onclick="dreamSpin()" ${filtered().length < 2 ? 'disabled' : ''}>🎲 ¿A dónde vamos?</button></div>
      <div class="chips scroll">${[['', 'Todos'], ...DREAM_KINDS].map(([e, l]) => `<button class="chip ${fKind === e ? 'on' : ''}" onclick="dreamF('k','${e}')">${e} ${l}</button>`).join('')}</div>
      <div class="row" style="gap:8px"><div class="seg grow" style="margin:0">${[['', 'Todo'], ['pais', 'En el país'], ['fuera', 'Afuera']].map(([k, l]) => `<button class="${fWhere === k ? 'on' : ''}" onclick="dreamF('w','${k}')">${l}</button>`).join('')}</div></div>
      ${fDays ? `<button class="chip on" style="align-self:flex-start" onclick="dreamF('d','')">🗓️ Que quepan en ${plural(fDays, 'día', 'días')} ✕</button>` : ''}
      <input id="drMax" inputmode="numeric" placeholder="Presupuesto máximo (opcional)" aria-label="Presupuesto máximo" value="${fMax || ''}" onchange="dreamF('m', this.value)"></div>
    ${list.length ? list.map(card).join('') : `<div class="glass center stack"><div style="font-size:42px">🗺️</div><p class="muted" style="margin:0">${S.data.dreams.length ? 'Ningún lugar con ese filtro' : 'Guarden aquí los lugares a los que quieren ir algún día: el que vieron en TikTok, el que les recomendaron, el de siempre.'}</p></div>`}
    ${went.length ? `<span class="label">✅ Ya fueron</span><div class="glass"><ul class="list">${went.map(d => `<li><span style="font-size:20px">${esc(d.kind || '📍')}</span><div class="txt">${esc(d.name)}</div>${d.tripId && S.data.trips.some(t => t.id === d.tripId) ? `<button class="link" onclick="openTrip('${d.tripId}')">Ver viaje</button>` : ''}</li>`).join('')}</ul></div>` : ''}`;
}
export function afterDreams(el) { loadPhotos(el); }
function dreamF(k, v) {
  if (k === 'k') fKind = fKind === v ? '' : v; else if (k === 'w') fWhere = v; else if (k === 'd') fDays = Number(v) || 0; else fMax = parseAmount(v) || 0;
  window.renderTripsList?.();
}

/* ---------- Agregar / editar ---------- */
let pic = null, editId = null;
function dreamForm(id) {
  const d = id ? S.data.dreams.find(x => x.id === id) : {}; editId = id || null; pic = null;
  openSheet(`<div class="stack"><h2>${id ? 'Editar lugar' : 'Lugar por conocer'}</h2>
    <input id="drName" maxlength="60" placeholder="Ej: Bocas del Toro" value="${esc(d.name || '')}" aria-label="Nombre">
    ${placeField('drPlace')}
    <label class="photo-pick" id="drPick">${d.photo ? `<img data-thumb="${dPhoto(d.id)}" alt="">` : `${icon('photo', 'ic lg')}<span>Foto (opcional)</span>`}<input type="file" accept="image/*" hidden onchange="dreamPhoto(this)"></label>
    <input id="drUrl" type="url" placeholder="Enlace (TikTok, Instagram, Airbnb…) opcional" value="${esc(d.url || '')}" aria-label="Enlace">
    <div class="chips scroll" id="drKinds">${DREAM_KINDS.map(([e, l]) => `<button class="chip ${(d.kind || '🏖️') === e ? 'on' : ''}" data-k="${e}" onclick="dreamKind(this)">${e} ${l}</button>`).join('')}</div>
    <div class="seg" id="drWhere"><button class="${d.abroad ? '' : 'on'}" onclick="dreamWhere(false)">🇨🇷 En el país</button><button class="${d.abroad ? 'on' : ''}" onclick="dreamWhere(true)">🌎 Afuera</button></div>
    <div class="grid2"><div><label class="f" for="drCost">¿Cuánto creen que cuesta?</label><input id="drCost" inputmode="numeric" placeholder="Opcional" value="${d.cost || ''}"></div>
      <div><label class="f" for="drDays">¿Cuántos días?</label><input id="drDays" type="number" min="1" max="60" inputmode="numeric" placeholder="Opcional" value="${d.days || ''}"></div></div>
    <input id="drSeason" maxlength="40" placeholder="Mejor época (ej. verano, diciembre)" value="${esc(d.season || '')}" aria-label="Mejor época">
    <textarea id="drNote" rows="2" maxlength="240" placeholder="¿Por qué quieren ir? ¿Qué harían?" aria-label="Nota">${esc(d.note || '')}</textarea>
    <button class="btn" id="drSave" onclick="saveDream()">${id ? 'Guardar cambios' : 'Guardar'}</button></div>`);
  initPlace('drPlace', d.place || null, { onPick: (_, x) => { if (!$('drName').value.trim()) $('drName').value = (x.title || x.name.split(',')[0]).slice(0, 60); if (x.country && !/costa rica/i.test(x.country)) dreamWhere(true); } });
  if (d.photo) loadPhotos($('drPick'));
  window.__drAbroad = !!d.abroad;
}
function dreamKind(b) { document.querySelectorAll('#drKinds .chip').forEach(x => x.classList.toggle('on', x === b)); }
function dreamWhere(v) { window.__drAbroad = v; document.querySelectorAll('#drWhere button').forEach((b, i) => b.classList.toggle('on', i === (v ? 1 : 0))); }
async function dreamPhoto(input) {
  const f = input.files?.[0]; input.value = ''; if (!f) return;
  const btn = $('drSave'); if (btn) btn.disabled = true;
  try {
    const full = await compressImage(f, 1080); pic = { full, thumb: await makeThumb(full).catch(() => null) };
    const box = $('drPick'); box.querySelectorAll('svg,span,img').forEach(x => x.remove());
    const img = document.createElement('img'); img.src = full; img.alt = ''; box.prepend(img);
  } catch (e) { photoError(e); }
  finally { if (btn) btn.disabled = false; }
}
function saveDream() {
  const name = $('drName').value.trim(); if (!name) return toast('Ponle nombre al lugar');
  const url = $('drUrl').value.trim(); if (url && !safeUrl(url)) return toast('El enlace debe empezar con https://');
  const r = editId ? ref('dreams', editId) : newRef('dreams'), b = writeBatch(db);
  const fields = { name, place: getPlace('drPlace'), url, kind: document.querySelector('#drKinds .chip.on')?.dataset.k || '📍', abroad: !!window.__drAbroad,
    cost: parseAmount($('drCost').value) || 0, days: Math.min(60, parseInt($('drDays').value, 10) || 0), season: $('drSeason').value.trim(), note: $('drNote').value.trim() };
  if (pic) {
    b.set(ref('photos', dPhoto(r.id)), { data: pic.full }); cachePhoto(dPhoto(r.id), pic.full);
    if (pic.thumb) { b.set(ref('photos', thumbId(dPhoto(r.id))), { data: pic.thumb }); cachePhoto(thumbId(dPhoto(r.id)), pic.thumb); }
    fields.photo = true;
  }
  if (editId) b.update(r, fields); else b.set(r, { ...fields, by: uid(), at: Date.now(), votes: { [uid()]: 1 } });
  write(b.commit()); pic = null;
  if (!editId) notify('trips', { title: `🗺️ ${meForPartner()} quiere ir a ${name}`, body: 'Vótalo en Viajes → Por conocer', url: './?open=dreams', tag: 'dream' });
  closeSheet(); toast(editId ? 'Cambios guardados' : 'Guardado en «Por conocer» 🗺️'); editId = null;
}
function voteDream(id, v) {
  const d = S.data.dreams.find(x => x.id === id); if (!d) return;
  write(updateDoc(ref('dreams', id), { [`votes.${uid()}`]: d.votes?.[uid()] === v ? 0 : v }));
  if (v === 1 && d.votes?.[uid()] !== 1 && Object.entries(d.votes || {}).some(([u, x]) => u !== uid() && x === 1)) { celebrate('hearts'); toast('¡A los dos les encanta! 💞'); }
}
function dreamMenu(id) {
  const d = S.data.dreams.find(x => x.id === id); if (!d) return;
  openSheet(`<div class="stack"><h2>${esc(d.kind)} ${esc(d.name)}</h2>
    ${d.place ? `<button class="btn ghost" onclick="closeSheet();showOnMap(${d.place.lat},${d.place.lng})">🗺️ Ver en el mapa</button>` : ''}
    <button class="btn ghost" onclick="dreamForm('${id}')">${icon('edit')} Editar</button>
    <button class="btn ghost" onclick="dreamWent('${id}')">✅ Ya fuimos</button>
    <button class="btn ghost danger" onclick="delDream('${id}')">${icon('trash')} Borrar</button></div>`);
}
function dreamWent(id) { write(updateDoc(ref('dreams', id), { went: Date.now() })); closeSheet(); celebrate(); toast('¡Uno menos de la lista! 🎉'); }
function delDream(id) { const d = S.data.dreams.find(x => x.id === id); softDelete('dreams', id, 'el lugar', { photos: d?.photo ? [dPhoto(id), thumbId(dPhoto(id))] : [], after: closeSheet }); }
// Crea el viaje con el destino puesto y lo marca como convertido
function dreamToTrip(id) {
  const d = S.data.dreams.find(x => x.id === id); if (!d) return;
  window.newTripFrom?.({ name: d.name, dest: d.place?.name || d.name, budget: d.cost || 0, dreamId: d.id, geo: d.place ? { lat: d.place.lat, lng: d.place.lng, name: d.place.name, country: d.place.country || '' } : null });
}

/* ---------- ¿A dónde vamos? ---------- */
function dreamSpin() {
  const pool = filtered().filter(d => score(d) >= 0); if (pool.length < 2) return toast('Necesitan al menos 2 lugares con ese filtro');
  openSheet(`<div class="stack center"><span class="label">¿A dónde vamos?</span><div class="dream-spin" id="drSpin">🎲</div><p class="small muted" id="drSpinSub" style="margin:0">Entre ${plural(pool.length, 'lugar', 'lugares')}${fMax ? ` de hasta ${fmtMoney(fMax)}` : ''}</p><div id="drSpinBtns"></div></div>`);
  animatePick(pool, d => { const el = $('drSpin'); if (el) el.textContent = `${d.kind} ${d.name}`; }, d => {
    celebrate(); const s = $('drSpinSub'); if (s) s.textContent = [d.cost ? `≈ ${fmtMoney(d.cost)}` : '', d.days ? plural(d.days, 'día', 'días') : '', d.season ? `mejor en ${d.season}` : ''].filter(Boolean).join(' · ') || '¡Listo!';
    const b = $('drSpinBtns'); if (b) b.innerHTML = `<div class="grid2"><button class="btn ghost" onclick="dreamSpin()">Otra vez</button><button class="btn" onclick="dreamToTrip('${d.id}')">✈️ ¡Vamos!</button></div>`;
  });
}

window.dreamsForDays = n => dreamF('d', n);
expose({ dreamF, dreamForm, dreamKind, dreamWhere, dreamPhoto, saveDream, voteDream, dreamMenu, dreamWent, delDream, dreamToTrip, dreamSpin });
