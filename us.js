// Gustos de cada uno (compartidos) e ideas de regalo (privadas: solo las ve quien las escribe).
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, write, ref, privRef, newPrivRef,
         nameOf, partnerUid, partnerName, profile, uid } from './core.js';
import { LIKE_FIELDS } from './data.js';
import { backBar } from './lists.js';

let tab = 'likes', editing = false;

function render() {
  if (!$('usBody')) $('s-us').innerHTML = `<div id="usHead" class="stack"></div><div id="usBody" class="stack" style="gap:14px"></div>`;
  paint('usHead', `${backBar('Gustos y regalos')}
    <div class="seg"><button class="${tab === 'likes' ? 'on' : ''}" onclick="usTab('likes')">Gustos</button>
      <button class="${tab === 'gifts' ? 'on' : ''}" onclick="usTab('gifts')">${icon('lock')} Ideas de regalo</button></div>`);
  tab === 'likes' ? renderLikes() : renderGifts();
}
function usTab(t) { tab = t; editing = false; render(); }

function renderLikes() {
  const p = partnerUid(), theirs = p ? profile(p).likes || {} : {}, mine = profile(uid()).likes || {};
  const filled = LIKE_FIELDS.filter(([k]) => theirs[k]);
  paint('usBody', `
    <div class="glass stack"><span class="label">${icon('heart')} Lo que le gusta a ${esc(partnerName())}</span>
      ${filled.length ? `<ul class="list">${filled.map(([k, l]) => `<li><div class="txt"><span class="sub" style="margin:0 0 2px">${l}</span>${esc(theirs[k])}</div></li>`).join('')}</ul>`
        : `<p class="small muted" style="margin:0">${esc(partnerName())} todavía no llena sus gustos.</p>`}</div>
    <div class="glass stack"><div class="row"><span class="label">${icon('user')} Tus gustos</span>
      ${editing ? '' : `<button class="link" onclick="editLikes()">Editar</button>`}</div>
      ${editing ? `${LIKE_FIELDS.map(([k, l]) => `<div><label class="f" for="like-${k}">${l}</label><input id="like-${k}" maxlength="120" value="${esc(mine[k] || '')}"></div>`).join('')}
        <button class="btn" onclick="saveLikes()">Guardar</button>`
      : LIKE_FIELDS.some(([k]) => mine[k]) ? `<ul class="list">${LIKE_FIELDS.filter(([k]) => mine[k]).map(([k, l]) => `<li><div class="txt"><span class="sub" style="margin:0 0 2px">${l}</span>${esc(mine[k])}</div></li>`).join('')}</ul>`
      : `<p class="small muted" style="margin:0">Llénalos para que ${esc(partnerName())} nunca falle con un regalo.</p><button class="btn ghost" onclick="editLikes()">Llenar mis gustos</button>`}</div>`);
}
function editLikes() { editing = true; renderLikes(); }
function saveLikes() {
  const likes = Object.fromEntries(LIKE_FIELDS.map(([k]) => [k, $('like-' + k).value.trim()]));
  write(setDoc(ref('profiles', uid()), { likes }, { merge: true }));
  editing = false; toast('Gustos guardados');
}

function renderGifts() {
  const gifts = [...S.priv.gifts].sort((a, b) => (a.done - b.done) || b.createdAt - a.createdAt);
  paint('usBody', `
    <div class="glass stack"><p class="small muted" style="margin:0">${icon('lock')} Solo tú ves esta lista. Anota lo que ${esc(partnerName())} menciona que quiere, para cumpleaños y sorpresas.</p>
      <div class="add-row"><input id="newGift" placeholder="Ej: los audífonos que vio en la tienda" maxlength="120" aria-label="Idea de regalo" onkeydown="if(event.key==='Enter')addGift()">
        <button class="btn" aria-label="Agregar" onclick="addGift()">${icon('plus')}</button></div></div>
    <div class="glass"><ul class="list">${gifts.length ? gifts.map(g => `<li class="${g.done ? 'done' : ''}">
      <button class="check-btn" aria-label="${g.done ? 'Desmarcar' : 'Marcar como regalado'}" onclick="toggleGift('${g.id}')">${g.done ? icon('check') : ''}</button>
      <div class="txt"><span class="main">${esc(g.text)}</span>${g.done ? '<span class="sub">Ya se lo regalaste</span>' : ''}</div>
      <button class="del" aria-label="Borrar" onclick="delGift('${g.id}')">${icon('trash')}</button></li>`).join('') : '<li class="empty">Aún no hay ideas</li>'}</ul></div>`);
}
function addGift() {
  const t = $('newGift').value.trim(); if (!t) return;
  write(setDoc(newPrivRef('gifts'), { text: t, done: false, createdAt: Date.now() }));
  $('newGift').value = '';
}
function toggleGift(id) { const g = S.priv.gifts.find(x => x.id === id); if (g) write(updateDoc(privRef('gifts', id), { done: !g.done })); }
function delGift(id) { if (confirm('¿Borrar esta idea?')) write(deleteDoc(privRef('gifts', id))); }

on('profiles gifts', render);
expose({ usTab, editLikes, saveLikes, addGift, toggleGift, delGift });
