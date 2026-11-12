// Restaurantes: a dónde quieren ir, dónde ya fueron, calificaciones y qué pidieron.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go,
         parseDate, fmtShort, todayKey, nameOf, partnerUid, uid } from './core.js';
import { backBar } from './lists.js';
import { createList } from './decide.js';

let tab = 'want';
const avg = p => { const v = Object.values(p.ratings || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const starsView = n => `<span class="stars" aria-label="${n.toFixed(1)} de 5">${[1, 2, 3, 4, 5].map(i => `<span style="color:${i <= Math.round(n) ? 'var(--g2)' : 'var(--line)'}">${icon('star')}</span>`).join('')}</span>`;

function render() {
  const want = S.data.places.filter(p => p.status !== 'been').sort((a, b) => b.createdAt - a.createdAt);
  const been = S.data.places.filter(p => p.status === 'been').sort((a, b) => avg(b) - avg(a));
  const list = tab === 'want' ? want : been;
  const pu = partnerUid();
  paint('s-places', `${backBar('Restaurantes', 's-more', `<button class="btn small" onclick="openPlace()">${icon('plus')} Agregar</button>`)}
    <div class="seg"><button class="${tab === 'want' ? 'on' : ''}" onclick="placesTab('want')">Queremos ir · ${want.length}</button>
      <button class="${tab === 'been' ? 'on' : ''}" onclick="placesTab('been')">Ya fuimos · ${been.length}</button></div>
    ${S.data.places.length ? `<button class="btn ghost" onclick="placesToDecide()">${icon('dice')} Elegir uno en Decidir</button>` : ''}
    ${list.length ? list.map(p => {
      const mine = p.ratings?.[uid()] || 0, theirs = pu ? p.ratings?.[pu] : null;
      const visits = [...(p.visits || [])].sort((a, b) => b.date.localeCompare(a.date));
      return `<div class="glass stack">
        <div class="row"><div><h2>${esc(p.name)}</h2><span class="small muted">${esc(p.kind || '')}</span></div>
          <button class="del" aria-label="Borrar" onclick="delPlace('${p.id}')">${icon('trash')}</button></div>
        ${p.status === 'been' ? `
          <div class="row"><span class="small muted">Tu nota</span><span class="stars">${[1, 2, 3, 4, 5].map(i =>
            `<button class="${i <= mine ? 'on' : ''}" aria-label="${i} estrellas" onclick="ratePlace('${p.id}',${i})">${icon('star')}</button>`).join('')}</span></div>
          ${theirs ? `<div class="row"><span class="small muted">Nota de ${esc(nameOf(pu))}</span>${starsView(theirs)}</div>` : ''}
          ${visits.length ? `<ul class="list">${visits.slice(0, 3).map(v => `<li><div class="txt">${fmtShort(parseDate(v.date))}${v.note ? ` · ${esc(v.note)}` : ''}</div></li>`).join('')}</ul>` : ''}
          <button class="btn ghost small" style="width:100%" onclick="openVisit('${p.id}')">${icon('plus')} Fuimos otra vez</button>`
        : `<button class="btn small" style="width:100%" onclick="openVisit('${p.id}')">${icon('check')} Ya fuimos</button>`}
      </div>`;
    }).join('') : `<div class="glass center"><p class="muted" style="margin:0">${tab === 'want' ? 'Anoten lugares que quieren probar' : 'Cuando vayan a uno, márquenlo como visitado'}</p></div>`}`);
}
function placesTab(t) { tab = t; render(); }
function openPlace() {
  openSheet(`<div class="stack"><h2>Nuevo restaurante</h2>
    <input id="plName" placeholder="Nombre" maxlength="50" aria-label="Nombre">
    <input id="plKind" placeholder="Tipo de comida (opcional)" maxlength="40" aria-label="Tipo de comida">
    <label class="check"><input type="checkbox" id="plBeen"> Ya fuimos</label>
    <button class="btn" onclick="savePlace()">Guardar</button></div>`);
}
function savePlace() {
  const name = $('plName').value.trim(); if (!name) return toast('Pon el nombre');
  const been = $('plBeen').checked;
  write(setDoc(newRef('places'), { name, kind: $('plKind').value.trim(), status: been ? 'been' : 'want', ratings: {},
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
function delPlace(id) { if (confirm('¿Borrar este restaurante?')) write(deleteDoc(ref('places', id))); }
// Crea (o actualiza) una lista en Decidir con los lugares pendientes y los mejor calificados.
function placesToDecide() {
  const opts = [...new Set(S.data.places.filter(p => p.status !== 'been' || avg(p) >= 3.5).map(p => p.name))].slice(0, 30);
  if (opts.length < 2) return toast('Necesitan al menos 2 lugares (pendientes o con 4★ o más)');
  const existing = S.data.lists.find(l => l.name === 'Nuestros restaurantes');
  if (existing) { write(updateDoc(ref('lists', existing.id), { options: opts, votes: {} })); window.selectList(existing.id); }
  else createList('Nuestros restaurantes', '🍽️', opts);
  window.decideTab('lists');
  go('s-decide');
  toast('Lista lista en Decidir');
}

on('places', render);
expose({ placesTab, openPlace, savePlace, openVisit, saveVisit, ratePlace, delPlace, placesToDecide });
