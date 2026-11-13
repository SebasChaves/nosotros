// Antojos: cada uno pide lo que se le antoja (comida, un lugar, un abrazo…) y el otro lo cumple.
// - «Ahora»: antojos de hoy, normales (😌 cuando se pueda) o urgentes (🔥 ¡ya!: aviso llamativo y tarjeta en Inicio).
// - «Algún día»: lista sin prisa; desde ahí se pasan al calendario como plan.
// - «Cumplidos»: historial con foto opcional del antojo cumplido, ❤️ de agradecimiento y «Guardar en Momentos».
// - «Ruleta»: «¿qué comemos?» entre los antojos pendientes y una lista fija de favoritos de los dos.
// Datos: cravings/<id> (ver docs/DATOS.md). Fotos en photos/crave-<id> (la del pedido) y photos/craved-<id> (cumplido).
import { setDoc, updateDoc, deleteDoc, writeBatch, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos, cachePhoto,
         getPhoto, compressImage, makeThumb, thumbId, photoError, dayKey, todayKey, parseDate, fmtShort, nameOf, partnerUid,
         partnerName, plural, uid, ask, celebrate, animatePick, markActive, countStat } from './core.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';
import { pet } from './pet.js';

export const CRAVE_COINS = 10; // monedas para la mascota cada vez que se cumple un antojo
export const CRAVE_EMOJIS = ['🍓', '🍕', '🍔', '🌮', '🍣', '🍜', '🍟', '🍦', '🍫', '🍩', '🧁', '☕', '🧋', '🍷', '🍿', '🤗', '💆', '🎬', '🛍️', '✨'];
const DEFAULT_FAVS = [['🍕', 'Pizza'], ['🍔', 'Hamburguesas'], ['🌮', 'Tacos'], ['🍣', 'Sushi'], ['🍗', 'Pollo frito'], ['🍜', 'Ramen'], ['🥗', 'Algo sano'], ['🍝', 'Pasta']];
export const cravePhotoId = id => `crave-${id}`, cravedPhotoId = id => `craved-${id}`;

const all = () => S.data.cravings || [];
const favs = () => all().filter(c => c.fav).sort((a, b) => (a.at || 0) - (b.at || 0));
const items = () => all().filter(c => !c.fav);
export const pendingCravings = (kind = 'now') => items().filter(c => !c.done && (c.kind || 'now') === kind).sort((a, b) => (b.urgent - a.urgent) || b.at - a.at);
// De mi pareja, sin cumplir
export const partnerCravings = () => pendingCravings().filter(c => c.by !== uid());
export const urgentForMe = () => partnerCravings().filter(c => c.urgent);
// Puntito: antojos nuevos de mi pareja que no he visto + los míos que me cumplieron y no he visto
export const cravingAlerts = () => partnerCravings().filter(c => !c.seen?.[uid()]).length + items().filter(c => c.done && c.by === uid() && !c.doneSeen).length;
export const cravingsDoneBetween = (from, to) => items().filter(c => c.done && c.doneAt && (k => k >= from && k <= to)(dayKey(new Date(c.doneAt)))).length;

const ago = at => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${plural(Math.floor(m / 60), 'hora', 'horas')}` : fmtShort(new Date(at)); };
const who = id => id === uid() ? 'Tú' : esc(nameOf(id));

/* ---------- Pantalla ---------- */
let tab = 'now', emoji = '🍓', spinOnlyFavs = false, lastSpin = '';
function render() {
  if (!$('craveBody')) $('s-cravings').innerHTML = `<div id="craveHead" class="stack"></div><div id="craveBody" class="stack" style="gap:14px"></div>`;
  const nNew = partnerCravings().filter(c => !c.seen?.[uid()]).length, nDone = items().filter(c => c.done && c.by === uid() && !c.doneSeen).length;
  const dot = n => n ? `<b class="dot">${n}</b>` : '';
  paint('craveHead', `${backBar('Antojos', 's-more', `<button class="btn small" onclick="openCraving()">${icon('plus')} Antojo</button>`)}
    <div class="seg"><button class="${tab === 'now' ? 'on' : ''}" onclick="craveTab('now')">Ahora${dot(nNew)}</button>
      <button class="${tab === 'someday' ? 'on' : ''}" onclick="craveTab('someday')">Algún día</button>
      <button class="${tab === 'done' ? 'on' : ''}" onclick="craveTab('done')">Cumplidos${dot(nDone)}</button>
      <button class="${tab === 'spin' ? 'on' : ''}" onclick="craveTab('spin')">Ruleta</button></div>`);
  ({ now: renderNow, someday: renderSomeday, done: renderDone, spin: renderSpin })[tab]();
  loadPhotos($('craveBody'));
  if ($('s-cravings').classList.contains('active')) markSeen();
}
function craveTab(t) { tab = t; render(); }
// Al ver la pantalla: los antojos nuevos de mi pareja quedan vistos; los míos cumplidos, vistos al entrar a Cumplidos
function markSeen() {
  for (const c of partnerCravings().filter(c => !c.seen?.[uid()])) write(updateDoc(ref('cravings', c.id), { [`seen.${uid()}`]: Date.now() }));
  if (tab === 'done') for (const c of items().filter(c => c.done && c.by === uid() && !c.doneSeen)) write(updateDoc(ref('cravings', c.id), { doneSeen: Date.now() }));
}

function quickAdd() {
  return `<div class="glass stack crave-add">
    <div class="chips scroll" role="radiogroup" aria-label="Emoji">${CRAVE_EMOJIS.map(e => `<button class="chip ${e === emoji ? 'on' : ''}" role="radio" aria-checked="${e === emoji}" aria-label="${e}" onclick="craveEmoji('${e}')">${e}</button>`).join('')}</div>
    <input id="craveText" maxlength="80" placeholder="¿Qué se te antoja?" aria-label="¿Qué se te antoja?" onkeydown="if(event.key==='Enter')addCraving(false)">
    <div class="grid2"><button class="btn ghost" onclick="addCraving(false)">😌 Cuando se pueda</button><button class="btn crave-urgent-btn" onclick="addCraving(true)">🔥 ¡Ya!</button></div>
    <div class="row" style="justify-content:center;gap:18px"><button class="link" onclick="openCraving()">📷 Con foto</button><button class="link" onclick="addCraving(false,'someday')">🌙 Para algún día</button></div></div>`;
}
function craveEmoji(e) { emoji = e; document.querySelectorAll('.crave-add .chip').forEach(b => { const on = b.textContent === e; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }

function card(c) {
  const mine = c.by === uid(), photo = c.photo ? `<img class="crave-photo" data-thumb="${cravePhotoId(c.id)}" alt="" onclick="viewPhoto(this)">` : '';
  const plan = c.plan?.date ? `<span class="pill">📅 ${fmtShort(parseDate(c.plan.date))}${c.plan.time ? ' ' + esc(c.plan.time) : ''}</span>` : '';
  return `<div class="glass stack crave ${c.urgent && !c.done ? 'urgent' : ''}" style="gap:8px">
    <div class="row start" style="gap:12px;align-items:flex-start"><span class="crave-e">${esc(c.emoji || '🍓')}</span>
      <div class="grow"><b>${esc(c.text)}</b><div class="tiny muted">${mine ? 'Tu antojo' : `Antojo de ${esc(nameOf(c.by))}`} · ${ago(c.at)}${c.note ? ' · ' + esc(c.note) : ''}</div>
        <div class="row start" style="gap:6px;margin-top:4px;flex-wrap:wrap">${c.urgent ? '<span class="pill hot">🔥 ¡Ya!</span>' : ''}${plan}${mine && !c.urgent && c.seen?.[partnerUid()] ? '<span class="pill">👀 Visto</span>' : ''}</div></div>
      ${photo}</div>
    <div class="row" style="gap:8px">${mine
      ? `${(c.kind || 'now') === 'someday' ? `<button class="btn ghost small" style="flex:1" onclick="planCraving('${c.id}')">📅 Planear</button>` : ''}<button class="btn ghost small" style="flex:1" onclick="fulfillCraving('${c.id}')">✅ Cumplido</button><button class="del" aria-label="Editar antojo" onclick="openCraving('${c.id}')">${icon('edit')}</button>`
      : `<button class="btn small" style="flex:1" onclick="fulfillCraving('${c.id}')">✅ Cumplido</button><button class="btn ghost small" style="flex:1" onclick="planCraving('${c.id}')">📅 Planear</button>`}
      <button class="del" aria-label="Borrar antojo" onclick="delCraving('${c.id}')">${icon('trash')}</button></div></div>`;
}
function renderNow() {
  const theirs = pendingCravings().filter(c => c.by !== uid()), mine = pendingCravings().filter(c => c.by === uid()), pn = esc(partnerName());
  paint('craveBody', `${quickAdd()}
    ${theirs.length ? `<span class="label">${icon('heart')} Lo que se le antoja a ${pn}</span>${theirs.map(card).join('')}` : `<p class="small muted center" style="margin:0">${pn} no tiene antojos pendientes 😌</p>`}
    ${mine.length ? `<span class="label">${icon('user')} Tus antojos</span>${mine.map(card).join('')}` : ''}`);
}
function renderSomeday() {
  const list = pendingCravings('someday');
  paint('craveBody', `<div class="glass stack"><p class="small muted" style="margin:0">Antojos sin prisa: ese restaurante, una comida especial, un paseo… Pásenlos al calendario cuando tengan fecha.</p>
    <div class="add-row"><input id="craveText" maxlength="80" placeholder="Algún día quiero…" aria-label="Antojo para algún día" onkeydown="if(event.key==='Enter')addCraving(false,'someday')">
      <button class="btn" aria-label="Agregar" onclick="addCraving(false,'someday')">${icon('plus')}</button></div></div>
    ${list.length ? list.map(card).join('') : '<p class="empty">Todavía no hay antojos para algún día</p>'}`);
}
function renderDone() {
  const list = items().filter(c => c.done).sort((a, b) => b.doneAt - a.doneAt), p = partnerUid();
  const count = id => list.filter(c => c.doneBy === id).length;
  paint('craveBody', `${list.length ? `<div class="glass row" style="justify-content:space-around;text-align:center">
      <div><b class="num">${count(uid())}</b><div class="tiny muted">cumpliste tú</div></div>
      ${p ? `<div><b class="num">${count(p)}</b><div class="tiny muted">cumplió ${esc(nameOf(p))}</div></div>` : ''}
      <div><b class="num">${list.length}</b><div class="tiny muted">en total</div></div></div>` : ''}
    ${list.length ? list.slice(0, 60).map(c => {
      const mine = c.by === uid();
      return `<div class="glass stack crave done" style="gap:8px"><div class="row start" style="gap:12px;align-items:flex-start"><span class="crave-e">${esc(c.emoji || '🍓')}</span>
        <div class="grow"><b>${esc(c.text)}</b><div class="tiny muted">${mine ? 'Tu antojo' : `Antojo de ${esc(nameOf(c.by))}`} · cumplido por ${who(c.doneBy)} el ${fmtShort(new Date(c.doneAt))}</div>
          ${c.thanks ? `<div class="tiny" style="margin-top:3px">❤️ ${mine ? 'Le diste las gracias' : `${esc(nameOf(c.by))} te dio las gracias`}</div>` : ''}</div>
        ${c.donePhoto ? `<img class="crave-photo" data-thumb="${cravedPhotoId(c.id)}" alt="" onclick="viewPhoto(this)">` : ''}</div>
        <div class="row" style="gap:8px">${mine && !c.thanks && c.doneBy !== uid() ? `<button class="btn small" style="flex:1" onclick="thankCraving('${c.id}')">❤️ Gracias</button>` : ''}
          ${c.donePhoto && !c.savedMoment ? `<button class="btn ghost small" style="flex:1" onclick="saveCravingMoment('${c.id}')">Guardar en Momentos</button>` : ''}
          ${c.savedMoment ? '<span class="pill ok">✓ En Momentos</span>' : ''}<span class="grow"></span>
          <button class="del" aria-label="Borrar del historial" onclick="delCraving('${c.id}')">${icon('trash')}</button></div></div>`;
    }).join('') : '<p class="empty">Aquí van a quedar los antojos cumplidos</p>'}`);
}
function spinOptions() {
  const pend = spinOnlyFavs ? [] : [...pendingCravings(), ...pendingCravings('someday')].map(c => `${c.emoji || '🍓'} ${c.text}`);
  return [...new Set([...pend, ...favs().map(f => `${f.emoji || '🍽️'} ${f.text}`)])];
}
function renderSpin() {
  const opts = spinOptions(), f = favs();
  paint('craveBody', `<div class="glass wheel" id="cWheel"><div class="emoji">🎡</div><div class="txt" id="cTxt">${esc(lastSpin || '¿Qué comemos?')}</div>
      <p class="tiny muted" style="margin:6px 0 12px">${opts.length ? `Entre ${plural(opts.length, 'opción', 'opciones')}` : 'Agreguen favoritos o antojos para girar'}</p>
      <button class="btn" id="cSpin" ${opts.length < 2 ? 'disabled' : ''} onclick="spinCravings()">Girar la ruleta</button>
      <label class="row" style="justify-content:center;gap:8px;margin-top:12px"><input type="checkbox" ${spinOnlyFavs ? 'checked' : ''} onchange="craveSpinFavs(this.checked)"><span class="small">Solo favoritos (sin los antojos pendientes)</span></label></div>
    <div class="glass stack"><div class="row"><span class="label">⭐ Sus favoritos</span>${f.length ? '' : `<button class="link" onclick="craveDefaultFavs()">Poner unos de ejemplo</button>`}</div>
      <p class="tiny muted" style="margin:0">Lo que siempre les gusta pedir. Son de los dos.</p>
      <div class="chips">${f.map(x => `<span class="chip">${esc(x.emoji || '🍽️')} ${esc(x.text)}<button class="chip-x" aria-label="Quitar ${esc(x.text)}" onclick="delCraving('${x.id}', true)">×</button></span>`).join('') || '<span class="small muted">Aún no hay favoritos</span>'}</div>
      <div class="add-row"><input id="favText" maxlength="40" placeholder="Ej: 🍕 Pizza" aria-label="Nuevo favorito" onkeydown="if(event.key==='Enter')addFav()"><button class="btn" aria-label="Agregar favorito" onclick="addFav()">${icon('plus')}</button></div></div>`);
}
function craveSpinFavs(v) { spinOnlyFavs = v; render(); }
function spinCravings() {
  const opts = spinOptions(); if (opts.length < 2) return;
  $('cSpin').disabled = true; $('cWheel').classList.add('spinning');
  animatePick(opts, o => { const t = $('cTxt'); if (t) t.textContent = o; }, o => {
    lastSpin = o; $('cWheel')?.classList.remove('spinning'); const b = $('cSpin'); if (b) b.disabled = false; toast(`¡${o}!`); celebrate();
  });
}
// «🍕 Pizza» → emoji + texto
const splitEmoji = t => { const m = t.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u); return m ? [m[1], m[2].trim()] : ['', t]; };
function addFav() {
  const raw = $('favText').value.trim(); if (!raw) return;
  const [e, text] = splitEmoji(raw); if (!text) return toast('Escribe el nombre');
  if (favs().some(f => f.text.toLowerCase() === text.toLowerCase())) return toast('Ese ya está');
  write(setDoc(newRef('cravings'), { fav: true, emoji: e || '🍽️', text, by: uid(), at: Date.now() }));
  $('favText').value = '';
}
function craveDefaultFavs() {
  const b = writeBatch(db), t = Date.now();
  DEFAULT_FAVS.forEach(([e, text], i) => b.set(newRef('cravings'), { fav: true, emoji: e, text, by: uid(), at: t + i }));
  write(b.commit());
}

/* ---------- Pedir un antojo ---------- */
function addCraving(urgent, kind = 'now') {
  const t = $('craveText')?.value.trim();
  if (!t) { $('craveText')?.focus(); return toast('Escribe qué se te antoja'); }
  save({ text: t, emoji: tab === 'someday' ? '🌙' : emoji, urgent, kind });
  $('craveText').value = '';
}
function save({ text, emoji: e, urgent, kind, note = '', photo = null }) {
  if (kind === 'someday') { const [e2, t2] = splitEmoji(text); if (e2) { e = e2; text = t2 || text; } }
  const r = newRef('cravings'), b = writeBatch(db);
  if (photo) {
    b.set(ref('photos', cravePhotoId(r.id)), { data: photo.full }); cachePhoto(cravePhotoId(r.id), photo.full);
    if (photo.thumb) { b.set(ref('photos', thumbId(cravePhotoId(r.id))), { data: photo.thumb }); cachePhoto(thumbId(cravePhotoId(r.id)), photo.thumb); }
  }
  b.set(r, { text, emoji: e || '🍓', note, urgent: !!urgent && kind !== 'someday', kind, photo: !!photo, by: uid(), at: Date.now(), done: false, seen: {} });
  write(b.commit()); markActive();
  const me = meForPartner();
  if (kind === 'someday') notify('cravings', { title: `🌙 ${me} agregó un antojo para algún día`, body: `${e || '🍓'} ${text}`, url: './?open=cravings', tag: 'crave-' + r.id });
  else if (urgent) notify('cravings', { title: `🚨 ¡Antojo urgente de ${me}!`, body: `🔥 ${e || '🍓'} ${text} — ¡lo quiere YA!`, url: './?open=cravings', tag: 'urgente-crave-' + r.id });
  else notify('cravings', { title: `${e || '🍓'} ${me} tiene un antojo`, body: text, url: './?open=cravings', tag: 'crave-' + r.id });
  if (urgent && kind !== 'someday') { navigator.vibrate?.([30, 40, 30]); toast(`🔥 Antojo urgente enviado a ${partnerName()}`); }
  else toast(kind === 'someday' ? 'Guardado para algún día 🌙' : 'Antojo enviado 🍓');
  if (kind !== tab && tab !== 'spin' && tab !== 'done') { tab = kind; render(); }
}

// Hoja completa: con foto y nota, o para editar uno
let pendingPhoto = null, editingId = null, sheetUrgent = false, sheetKind = 'now', sheetEmoji = '🍓';
function openCraving(id) {
  const c = id ? all().find(x => x.id === id) : null;
  editingId = c?.id || null; pendingPhoto = null;
  sheetUrgent = !!c?.urgent; sheetKind = c?.kind || (tab === 'someday' ? 'someday' : 'now'); sheetEmoji = c?.emoji || emoji;
  openSheet(`<div class="stack"><h2>${c ? 'Editar antojo' : 'Nuevo antojo'}</h2>
    <div class="chips scroll" id="csEmoji">${CRAVE_EMOJIS.map(e => `<button class="chip ${e === sheetEmoji ? 'on' : ''}" aria-label="${e}" onclick="craveSheetEmoji('${e}')">${e}</button>`).join('')}</div>
    <input id="csText" maxlength="80" placeholder="¿Qué se te antoja?" aria-label="¿Qué se te antoja?" value="${esc(c?.text || $('craveText')?.value || '')}">
    <input id="csNote" maxlength="120" placeholder="Detalles (opcional): de dónde, de qué sabor…" aria-label="Detalles" value="${esc(c?.note || '')}">
    <div class="seg" id="csKind"><button class="${sheetKind === 'now' && !sheetUrgent ? 'on' : ''}" onclick="craveSheetKind('now',false)">😌 Cuando se pueda</button>
      <button class="${sheetUrgent ? 'on' : ''}" onclick="craveSheetKind('now',true)">🔥 ¡Ya!</button>
      <button class="${sheetKind === 'someday' ? 'on' : ''}" onclick="craveSheetKind('someday',false)">🌙 Algún día</button></div>
    ${c ? '' : `<label class="btn ghost">${icon('photo')} <span id="csPhotoTxt">Agregar una foto (opcional)</span><input type="file" accept="image/*" hidden onchange="cravePhoto(this)"></label>
    <img id="csPreview" class="crave-preview" alt="" hidden>`}
    <button class="btn" onclick="saveCravingSheet()">${c ? 'Guardar cambios' : 'Pedir antojo'}</button></div>`);
}
function craveSheetEmoji(e) { sheetEmoji = e; document.querySelectorAll('#csEmoji .chip').forEach(b => b.classList.toggle('on', b.textContent === e)); }
function craveSheetKind(k, u) {
  sheetKind = k; sheetUrgent = u;
  document.querySelectorAll('#csKind button').forEach((b, i) => b.classList.toggle('on', i === (k === 'someday' ? 2 : u ? 1 : 0)));
}
async function cravePhoto(input) {
  const f = input.files?.[0]; if (!f) return;
  try { const full = await compressImage(f, 1080); pendingPhoto = { full, thumb: await makeThumb(full).catch(() => null) }; }
  catch (e) { return photoError(e); }
  const p = $('csPreview'); if (p) { p.src = pendingPhoto.full; p.hidden = false; }
  const t = $('csPhotoTxt'); if (t) t.textContent = 'Cambiar la foto';
}
function saveCravingSheet() {
  const text = $('csText').value.trim(), note = $('csNote').value.trim();
  if (!text) return toast('Escribe qué se te antoja');
  if (editingId) {
    write(updateDoc(ref('cravings', editingId), { text, note, emoji: sheetEmoji, kind: sheetKind, urgent: sheetUrgent && sheetKind !== 'someday' }));
    closeSheet(); return toast('Antojo actualizado');
  }
  save({ text, note, emoji: sheetEmoji, urgent: sheetUrgent, kind: sheetKind, photo: pendingPhoto });
  pendingPhoto = null; const q = $('craveText'); if (q) q.value = '';
  closeSheet();
}

/* ---------- Cumplir ---------- */
let doneId = null, donePhoto = null;
function fulfillCraving(id) {
  const c = all().find(x => x.id === id); if (!c) return;
  doneId = id; donePhoto = null;
  const mine = c.by === uid();
  openSheet(`<div class="stack"><h2>${esc(c.emoji || '🍓')} ${mine ? '¿Ya se cumplió?' : '¡Antojo cumplido!'}</h2>
    <p class="muted" style="margin:0">«${esc(c.text)}»</p>
    <label class="btn ghost">${icon('photo')} <span id="cdPhotoTxt">Agregar una foto de prueba 📸 (opcional)</span><input type="file" accept="image/*" hidden onchange="cravedPhoto(this)"></label>
    <img id="cdPreview" class="crave-preview" alt="" hidden>
    ${!mine && pet()?.hatchedAt ? `<p class="tiny muted center" style="margin:0">+${CRAVE_COINS} 🪙 para su mascota</p>` : ''}
    <button class="btn" onclick="confirmFulfill()">${mine ? '✅ Sí, ya se cumplió' : '✅ Marcar cumplido'}</button></div>`);
}
async function cravedPhoto(input) {
  const f = input.files?.[0]; if (!f) return;
  try { const full = await compressImage(f, 1080); donePhoto = { full, thumb: await makeThumb(full).catch(() => null) }; }
  catch (e) { return photoError(e); }
  const p = $('cdPreview'); if (p) { p.src = donePhoto.full; p.hidden = false; }
  const t = $('cdPhotoTxt'); if (t) t.textContent = 'Cambiar la foto';
}
function confirmFulfill() {
  const c = all().find(x => x.id === doneId); if (!c) return closeSheet();
  const mine = c.by === uid(), b = writeBatch(db), pid = cravedPhotoId(c.id);
  if (donePhoto) {
    b.set(ref('photos', pid), { data: donePhoto.full }); cachePhoto(pid, donePhoto.full);
    if (donePhoto.thumb) { b.set(ref('photos', thumbId(pid)), { data: donePhoto.thumb }); cachePhoto(thumbId(pid), donePhoto.thumb); }
  }
  b.update(ref('cravings', c.id), { done: true, doneBy: uid(), doneAt: Date.now(), donePhoto: !!donePhoto, ...(mine ? { doneSeen: Date.now() } : {}) });
  const p = pet(); if (!mine && p?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(CRAVE_COINS) });
  write(b.commit()); markActive(); countStat('acts', 'craving');
  if (!mine) notify('cravings', { title: `🎉 ${meForPartner()} cumplió tu antojo`, body: `${c.emoji || '🍓'} ${c.text}${donePhoto ? ' · 📸 con foto' : ''}`, url: './?open=cravings-done', tag: 'crave-' + c.id });
  closeSheet(); celebrate(mine ? 'confetti' : 'hearts');
  toast(mine ? 'Antojo cumplido 🎉' : `¡Cumpliste el antojo de ${partnerName()}! 💕`);
  donePhoto = null; doneId = null;
}
function thankCraving(id) {
  const c = all().find(x => x.id === id); if (!c) return;
  write(updateDoc(ref('cravings', id), { thanks: Date.now() })); celebrate('hearts');
  notify('cravings', { title: `❤️ ${meForPartner()} te da las gracias`, body: `Por cumplir su antojo: ${c.emoji || '🍓'} ${c.text}`, url: './?open=cravings-done', tag: 'crave-' + id });
}
async function saveCravingMoment(id) {
  const c = all().find(x => x.id === id); if (!c) return;
  const pid = cravedPhotoId(id), full = await getPhoto(pid);
  if (!full) return toast('Esa foto ya no está');
  const thumb = await getPhoto(thumbId(pid)) || await makeThumb(full).catch(() => null);
  const r = newRef('moments'), b = writeBatch(db);
  b.set(ref('photos', r.id), { data: full }); cachePhoto(r.id, full);
  if (thumb) { b.set(ref('photos', thumbId(r.id)), { data: thumb }); cachePhoto(thumbId(r.id), thumb); }
  b.set(r, { title: `${c.emoji || '🍓'} ${c.text}`, date: dayKey(new Date(c.doneAt || Date.now())), note: 'Antojo cumplido', hasPhoto: true, place: null, by: uid(), createdAt: Date.now(), fromCraving: true });
  b.update(ref('cravings', id), { savedMoment: r.id });
  write(b.commit()); toast('Guardado en Momentos 📚');
}
async function delCraving(id, quiet) {
  const c = all().find(x => x.id === id); if (!c) return;
  if (!quiet && !(await ask(c.done ? '¿Borrar este antojo del historial?' : '¿Borrar este antojo?'))) return;
  const b = writeBatch(db);
  b.delete(ref('cravings', id));
  for (const pid of [cravePhotoId(id), cravedPhotoId(id)]) { b.delete(ref('photos', pid)); b.delete(ref('photos', thumbId(pid))); }
  write(b.commit());
}

/* ---------- Planear: pasarlo al calendario ---------- */
let planId = null;
function planCraving(id) {
  const c = all().find(x => x.id === id); if (!c) return;
  planId = id;
  openSheet(`<div class="stack"><h2>📅 Planear antojo</h2><p class="muted" style="margin:0">${esc(c.emoji || '🍓')} ${esc(c.text)}</p>
    <div class="grid2"><div><label class="f" for="cpDate">Día</label><input type="date" id="cpDate" value="${esc(c.plan?.date || todayKey())}"></div>
      <div><label class="f" for="cpTime">Hora (opcional)</label><input type="time" id="cpTime" value="${esc(c.plan?.time || '')}"></div></div>
    <button class="btn" onclick="savePlanCraving()">Agregar al calendario</button>
    <p class="tiny muted center" style="margin:0">Queda como plan de los dos en el Calendario.</p></div>`);
}
function savePlanCraving() {
  const c = all().find(x => x.id === planId), date = $('cpDate').value, time = $('cpTime').value || '';
  if (!c || !date) return toast('Elige el día');
  const b = writeBatch(db), title = `${c.emoji || '🍓'} ${c.text}`;
  const ev = c.plan?.eventId && S.data.events.some(e => e.id === c.plan.eventId) ? ref('events', c.plan.eventId) : newRef('events');
  b.set(ev, { title, date, time, who: 'ambos', note: c.note || 'Antojo', repeat: 'none', until: '', by: uid(), createdAt: Date.now(), craving: c.id }, { merge: true });
  b.update(ref('cravings', c.id), { plan: { date, time, eventId: ev.id } });
  write(b.commit()); closeSheet(); toast('Agregado al calendario 📅');
  notify('cravings', { title: `📅 ${meForPartner()} planeó un antojo`, body: `${title} · ${fmtShort(parseDate(date))}${time ? ' ' + time : ''}`, url: './?open=cal', tag: 'crave-plan-' + c.id });
}

/* ---------- Inicio: tarjeta de antojos urgentes ---------- */
export function cravingsCard() {
  const list = urgentForMe(); if (!list.length) return '';
  return `<div class="glass stack crave-home" style="gap:8px"><div class="row"><span class="label">🚨 Antojo urgente</span><button class="link" onclick="go('s-cravings')">Ver</button></div>
    ${list.slice(0, 3).map(c => `<div class="row start" style="gap:10px"><span class="crave-e">${esc(c.emoji || '🍓')}</span><div class="grow"><b>${esc(c.text)}</b><div class="tiny muted">${esc(nameOf(c.by))} · ${ago(c.at)}</div></div>
      <button class="btn small" onclick="fulfillCraving('${c.id}')">✅ Cumplido</button></div>`).join('')}</div>`;
}

// Al abrir la app: si mi pareja pidió un antojo urgente que no he visto, se avisa una vez con un diálogo
let asking = false;
async function urgentPopup() {
  if (asking || !S.me || !document.body.classList.contains('in') || $('lockScreen') || document.querySelector('.tour, .dialog:not(.out)') || $('sheet')?.classList.contains('show')) return;
  const c = urgentForMe().find(x => !x.seen?.[uid()] && !shown.has(x.id)); if (!c) return;
  asking = true; shown.add(c.id); navigator.vibrate?.([200, 80, 200]);
  const go2 = await ask(`🚨 ¡${nameOf(c.by)} tiene un antojo urgente! ${c.emoji || '🍓'} ${c.text}`, { ok: 'Ver antojo', cancel: 'Luego' });
  asking = false;
  write(updateDoc(ref('cravings', c.id), { [`seen.${uid()}`]: Date.now() }));
  if (go2) { tab = 'now'; window.go('s-cravings'); }
}
const shown = new Set();
on('cravings', () => setTimeout(urgentPopup, 1200));
on('cravings events pet', () => { if ($('s-cravings').classList.contains('active')) render(); });
onShow('s-cravings', render);
window.openCravings = t => { if (t) tab = t; window.go('s-cravings'); };
expose({ craveTab, craveEmoji, addCraving, openCraving, craveSheetEmoji, craveSheetKind, cravePhoto, saveCravingSheet, fulfillCraving, cravedPhoto,
  confirmFulfill, thankCraving, saveCravingMoment, delCraving, planCraving, savePlanCraving, spinCravings, craveSpinFavs, addFav, craveDefaultFavs });
