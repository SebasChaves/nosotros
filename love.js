// Detalles: frasco de notas y cupones canjeables.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, pick,
         fmtDate, fmtShort, nameOf, partnerName, myName, plural, uid } from './core.js';
import { COUPON_TEMPLATES } from './data.js';

let tab = 'notes';
export const unreadNotes = () => S.data.notes.filter(n => n.fromUid !== uid() && !n.readAt).length;
export const couponAlerts = () =>
  S.data.coupons.filter(c => c.fromUid === uid() && c.redeemedAt && !c.doneAt).length +
  S.data.coupons.filter(c => c.fromUid !== uid() && !c.seenAt).length;

function render() {
  if (!$('loveBody')) $('s-love').innerHTML = `<div class="topbar"><h1>Detalles</h1></div><div id="loveHead"></div><div id="loveBody" class="stack" style="gap:14px"></div>`;
  const n = unreadNotes(), c = couponAlerts();
  paint('loveHead', `<div class="seg"><button class="${tab === 'notes' ? 'on' : ''}" onclick="loveTab('notes')">Notas${n ? `<b class="dot">${n}</b>` : ''}</button>
    <button class="${tab === 'coupons' ? 'on' : ''}" onclick="loveTab('coupons')">Cupones${c ? `<b class="dot">${c}</b>` : ''}</button></div>`);
  tab === 'notes' ? renderNotes() : renderCoupons();
}
function loveTab(t) { tab = t; render(); if (t === 'coupons') markCouponsSeen(); }

/* ---------- Notas ---------- */
const fromLabel = n => n.fromName || nameOf(n.fromUid);
function renderNotes() {
  const pn = esc(partnerName());
  const forMe = S.data.notes.filter(n => n.fromUid !== uid());
  const unread = forMe.filter(n => !n.readAt).length;
  const read = forMe.filter(n => n.readAt).sort((a, b) => b.readAt - a.readAt);
  const mine = S.data.notes.filter(n => n.fromUid === uid()).sort((a, b) => b.createdAt - a.createdAt);
  paint('loveBody', `
    <div class="glass center stack"><div class="jar" role="button" tabindex="0" aria-label="Sacar una nota" onclick="drawNote()">🫙</div>
      <p class="muted" style="margin:0">${forMe.length ? `${plural(unread, 'nota sin leer', 'notas sin leer')} para ti` : `El frasco está vacío. Pídele a ${pn} que te escriba una`}</p>
      <button class="btn" onclick="drawNote()">${icon('heart-f')} Sacar una nota</button></div>
    <div class="glass stack"><h2>Escribirle una nota a ${pn}</h2>
      <textarea id="newNote" placeholder="Algo bonito para leer en un día difícil…" maxlength="500" aria-label="Nota"></textarea>
      <button class="btn ghost" onclick="addNote()">Guardar en el frasco</button></div>
    <div class="glass"><div class="row"><h2>Notas que ya leíste</h2><span class="small muted">${read.length || ''}</span></div>
      <ul class="list" style="margin-top:6px">${read.length ? read.map(n => `<li><div class="txt">${esc(n.text)}<span class="sub">De ${esc(fromLabel(n))} · ${fmtDate(new Date(n.createdAt))}</span></div></li>`).join('')
        : '<li class="empty">Aún no has sacado notas</li>'}</ul></div>
    <div class="glass"><h2>Notas que escribiste</h2>
      <ul class="list" style="margin-top:6px">${mine.length ? mine.map(n => `<li><div class="txt">${esc(n.text)}<span class="sub">${fmtDate(new Date(n.createdAt))}</span></div>
        <span class="pill ${n.readAt ? 'ok' : ''}">${n.readAt ? 'Leída' : 'Sin leer'}</span>
        <button class="del" aria-label="Borrar nota" onclick="delNote('${n.id}')">${icon('trash')}</button></li>`).join('')
        : '<li class="empty">Todavía no escribes ninguna</li>'}</ul></div>`);
}
function addNote() {
  const t = $('newNote').value.trim();
  if (!t) return toast('Escribe algo bonito primero');
  write(setDoc(newRef('notes'), { text: t, fromUid: uid(), fromName: myName(), createdAt: Date.now(), readAt: null }));
  $('newNote').value = ''; toast('Nota guardada en el frasco');
}
function drawNote() {
  const forMe = S.data.notes.filter(n => n.fromUid !== uid());
  if (!forMe.length) return toast('No hay notas para ti todavía');
  const unread = forMe.filter(n => !n.readAt), n = pick(unread.length ? unread : forMe);
  if (!n.readAt) write(updateDoc(ref('notes', n.id), { readAt: Date.now() }));
  openSheet(`<div class="stack center"><div style="font-size:40px">💌</div><div class="note-paper">${esc(n.text)}</div>
    <p class="small muted" style="margin:0">De ${esc(fromLabel(n))} · escrita el ${fmtDate(new Date(n.createdAt))}${unread.length ? '' : ' · ya leíste todas, esta es repetida'}</p>
    <button class="btn" onclick="closeSheet()">${icon('heart-f')} Gracias</button></div>`);
}
function delNote(id) { if (confirm('¿Borrar esta nota?')) write(deleteDoc(ref('notes', id))); }

/* ---------- Cupones ---------- */
function couponStatus(c) {
  if (c.doneAt) return `Cumplido el ${fmtShort(new Date(c.doneAt))}`;
  if (c.redeemedAt) return `Canjeado el ${fmtShort(new Date(c.redeemedAt))}`;
  return `Regalado el ${fmtShort(new Date(c.createdAt))}`;
}
function renderCoupons() {
  const pn = esc(partnerName());
  const order = c => c.doneAt ? 2 : c.redeemedAt ? 1 : 0;
  const sort = arr => arr.sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt);
  const forMe = sort(S.data.coupons.filter(c => c.fromUid !== uid()));
  const mine = sort(S.data.coupons.filter(c => c.fromUid === uid()));
  paint('loveBody', `
    <div class="glass stack"><h2>Regalarle un cupón a ${pn}</h2>
      <div class="chips scroll">${COUPON_TEMPLATES.map(([e, t], i) => `<button class="chip" onclick="useCouponTpl(${i})">${e} ${esc(t.replace('Vale por ', ''))}</button>`).join('')}</div>
      <div class="add-row"><input id="couponEmoji" style="flex:0 0 60px;text-align:center" value="🎟️" maxlength="4" aria-label="Emoji">
        <input id="couponText" placeholder="Vale por…" maxlength="90" aria-label="Cupón"></div>
      <button class="btn" onclick="addCoupon()">${icon('gift')} Regalar cupón</button></div>
    <div class="glass stack"><h2>Cupones de ${pn} para ti</h2>
      ${forMe.length ? forMe.map(c => `<div class="ticket ${c.doneAt ? 'used' : ''}"><div class="e">${esc(c.emoji)}</div>
        <div class="txt">${esc(c.text)}<small>${c.redeemedAt && !c.doneAt ? `Canjeado, esperando a que ${pn} cumpla` : couponStatus(c)}</small></div>
        ${!c.redeemedAt ? `<button class="btn small" onclick="redeemCoupon('${c.id}')">Canjear</button>` : ''}</div>`).join('')
        : `<p class="empty">Aún no tienes cupones. Quizás ${pn} debería regalarte uno</p>`}</div>
    <div class="glass stack"><h2>Cupones que regalaste</h2>
      ${mine.length ? mine.map(c => `<div class="ticket ${c.doneAt ? 'used' : ''}"><div class="e">${esc(c.emoji)}</div>
        <div class="txt">${esc(c.text)}<small>${c.redeemedAt && !c.doneAt ? `¡${pn} lo canjeó! Te toca cumplir` : couponStatus(c)}</small></div>
        ${c.redeemedAt && !c.doneAt ? `<button class="btn small" onclick="fulfillCoupon('${c.id}')">${icon('check')} Cumplido</button>` : ''}
        ${!c.redeemedAt ? `<button class="del" aria-label="Borrar cupón" onclick="delCoupon('${c.id}')">${icon('trash')}</button>` : ''}</div>`).join('')
        : '<p class="empty">Todavía no regalas cupones</p>'}</div>`);
}
function useCouponTpl(i) { const [e, t] = COUPON_TEMPLATES[i]; $('couponEmoji').value = e; $('couponText').value = t; }
function addCoupon() {
  const text = $('couponText').value.trim();
  if (!text) return toast('Escribe el cupón');
  write(setDoc(newRef('coupons'), { text, emoji: $('couponEmoji').value.trim() || '🎟️', fromUid: uid(), createdAt: Date.now(), seenAt: null, redeemedAt: null, doneAt: null }));
  $('couponText').value = ''; toast(`Cupón regalado a ${partnerName()}`);
}
function redeemCoupon(id) {
  if (!confirm('¿Canjear este cupón ahora?')) return;
  write(updateDoc(ref('coupons', id), { redeemedAt: Date.now(), seenAt: Date.now() })); toast('¡Canjeado!');
}
function fulfillCoupon(id) { write(updateDoc(ref('coupons', id), { doneAt: Date.now() })); toast('¡Cumplido!'); }
function delCoupon(id) { if (confirm('¿Borrar este cupón?')) write(deleteDoc(ref('coupons', id))); }
function markCouponsSeen() {
  for (const c of S.data.coupons) if (c.fromUid !== uid() && !c.seenAt) write(updateDoc(ref('coupons', c.id), { seenAt: Date.now() }));
}

on('notes coupons', render);
onShow('s-love', () => { if (tab === 'coupons') markCouponsSeen(); });
expose({ loveTab, drawNote, addNote, delNote, useCouponTpl, addCoupon, redeemCoupon, fulfillCoupon, delCoupon });
