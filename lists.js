// Bucket list y lista del súper.
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, expose, toast, write, ref, newRef, fmtDate, nameOf, uid } from './core.js';
import { GROCERY_TPL } from './data.js';

export const backBar = (title, to = 's-more', extra = '') =>
  `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('${to}')">${icon('back')}</button><h1>${title}</h1></div>${extra}</div>`;

/* ---------- Bucket list ---------- */
function renderBucket() {
  const items = [...S.data.bucket].sort((a, b) => (a.done - b.done) || (b.createdAt || 0) - (a.createdAt || 0));
  const done = S.data.bucket.filter(b => b.done).length, total = S.data.bucket.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  paint('s-bucket', `${backBar('Bucket list')}
    <div class="glass stack"><div class="row"><b>${done} de ${total} cumplidas</b><span class="small muted">${pct}%</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div></div>
    <div class="glass"><div class="add-row"><input id="newBucket" placeholder="Algo que queremos hacer juntos…" maxlength="120" aria-label="Nuevo sueño" onkeydown="if(event.key==='Enter')addBucket()">
      <button class="btn" aria-label="Agregar" onclick="addBucket()">${icon('plus')}</button></div></div>
    <div class="glass"><ul class="list">${items.length ? items.map(b => `
      <li class="${b.done ? 'done' : ''}"><button class="check-btn" aria-label="${b.done ? 'Desmarcar' : 'Marcar cumplida'}" onclick="toggleBucket('${b.id}')">${b.done ? icon('check') : ''}</button>
        <div class="txt"><span class="main">${esc(b.text)}</span><span class="sub">${b.doneAt ? `Cumplida el ${fmtDate(new Date(b.doneAt))}` : `Agregado por ${esc(nameOf(b.by))}`}</span></div>
        <button class="del" aria-label="Borrar" onclick="delBucket('${b.id}')">${icon('trash')}</button></li>`).join('')
      : '<li class="empty">Agreguen su primer sueño juntos</li>'}</ul></div>`);
}
function addBucket() {
  const t = $('newBucket').value.trim(); if (!t) return;
  write(setDoc(newRef('bucket'), { text: t, done: false, doneAt: null, createdAt: Date.now(), by: uid() }));
  $('newBucket').value = '';
}
function toggleBucket(id) {
  const b = S.data.bucket.find(x => x.id === id); if (!b) return;
  write(updateDoc(ref('bucket', id), { done: !b.done, doneAt: b.done ? null : Date.now() }));
  if (!b.done) toast('¡Una menos!');
}
function delBucket(id) { if (confirm('¿Borrar este elemento? Se borra para los dos.')) write(deleteDoc(ref('bucket', id))); }

/* ---------- Súper ---------- */
export const groceryPending = () => S.data.groceries.filter(g => !g.done).length;
function renderGrocery() {
  const pending = S.data.groceries.filter(g => !g.done).sort((a, b) => b.createdAt - a.createdAt);
  const bought = S.data.groceries.filter(g => g.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const names = new Set(pending.map(g => g.text.toLowerCase()));
  paint('s-grocery', `${backBar('Súper')}
    <div class="glass stack"><div class="add-row"><input id="newGrocery" placeholder="¿Qué hace falta?" maxlength="60" aria-label="Producto" onkeydown="if(event.key==='Enter')addGrocery()">
      <button class="btn" aria-label="Agregar" onclick="addGrocery()">${icon('plus')}</button></div>
      <div class="chips scroll">${GROCERY_TPL.filter(t => !names.has(t.toLowerCase())).map(t => `<button class="chip" onclick="addGrocery('${esc(t)}')">${icon('plus')} ${esc(t)}</button>`).join('')}</div></div>
    <div class="glass"><div class="row"><h2>Por comprar</h2><span class="pill">${pending.length}</span></div>
      <ul class="list" style="margin-top:6px">${pending.length ? pending.map(g => `<li><button class="check-btn" aria-label="Marcar comprado" onclick="toggleGrocery('${g.id}')"></button>
        <div class="txt"><span class="main">${esc(g.text)}</span><span class="sub">${esc(nameOf(g.by))}</span></div>
        <button class="del" aria-label="Borrar" onclick="delGrocery('${g.id}')">${icon('x')}</button></li>`).join('') : '<li class="empty">¡Nada pendiente!</li>'}</ul></div>
    ${bought.length ? `<div class="glass"><div class="row"><h2>En el carrito</h2><button class="link" onclick="clearBought()">Vaciar</button></div>
      <ul class="list" style="margin-top:6px">${bought.map(g => `<li class="done"><button class="check-btn" aria-label="Desmarcar" onclick="toggleGrocery('${g.id}')">${icon('check')}</button>
        <div class="txt"><span class="main">${esc(g.text)}</span></div></li>`).join('')}</ul></div>` : ''}`);
}
function addGrocery(text) {
  const t = (text ?? $('newGrocery').value).trim(); if (!t) return;
  write(setDoc(newRef('groceries'), { text: t, done: false, by: uid(), createdAt: Date.now() }));
  if (text === undefined) $('newGrocery').value = '';
}
function toggleGrocery(id) {
  const g = S.data.groceries.find(x => x.id === id); if (!g) return;
  write(updateDoc(ref('groceries', id), { done: !g.done, doneAt: g.done ? null : Date.now() }));
}
function delGrocery(id) { write(deleteDoc(ref('groceries', id))); }
function clearBought() {
  const batch = writeBatch(db);
  S.data.groceries.filter(g => g.done).forEach(g => batch.delete(ref('groceries', g.id)));
  write(batch.commit());
}

on('bucket', renderBucket);
on('groceries', renderGrocery);
expose({ addBucket, toggleBucket, delBucket, addGrocery, toggleGrocery, delGrocery, clearBought });
