// Detalles: frasco de notas y cupones canjeables.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, pick,
         fmtDate, fmtShort, nameOf, partnerName, myName, plural, uid, avatar, loadPhotos, ask, celebrate, markActive, mainTop, todayKey, parseDate } from './core.js';
import { COUPON_TEMPLATES } from './data.js';
import { notify, meForPartner } from './push.js';

let tab = 'notes';
const arrived = n => !n.showAt || n.showAt <= Date.now();
export const unreadNotes = () => S.data.notes.filter(n => n.fromUid !== uid() && !n.readAt && arrived(n)).length;
export const couponAlerts = () =>
  S.data.coupons.filter(c => c.fromUid === uid() && c.redeemedAt && !c.doneAt).length +
  S.data.coupons.filter(c => c.fromUid !== uid() && !c.seenAt).length;

function render() {
  if (!$('loveBody')) $('s-love').innerHTML = `<div id="loveTop"></div><div id="loveHead"></div><div id="loveBody" class="stack" style="gap:14px"></div>`;
  paint('loveTop', mainTop('s-love', 'Detalles'));
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
  const forMe = S.data.notes.filter(n => n.fromUid !== uid() && arrived(n));
  const unread = forMe.filter(n => !n.readAt).length;
  const read = forMe.filter(n => n.readAt).sort((a, b) => b.readAt - a.readAt);
  const mine = S.data.notes.filter(n => n.fromUid === uid()).sort((a, b) => b.createdAt - a.createdAt);
  paint('loveBody', `
    <div class="glass center stack"><div class="jar" role="button" tabindex="0" aria-label="Sacar una nota" onclick="drawNote()">🫙</div>
      <p class="muted" style="margin:0">${forMe.length ? `${plural(unread, 'nota sin leer', 'notas sin leer')} para ti` : `El frasco está vacío. Pídele a ${pn} que te escriba una`}</p>
      <button class="btn" onclick="drawNote()">${icon('heart-f')} Sacar una nota</button></div>
    <div class="glass stack"><h2>Escribirle una nota a ${pn}</h2>
      <textarea id="newNote" placeholder="Algo bonito para leer en un día difícil…" maxlength="500" aria-label="Nota"></textarea>
      <details class="note-when"><summary class="small">⏰ Que le llegue en una fecha (opcional)</summary>
        <div class="grid2" style="margin-top:8px"><input type="date" id="noteDay" min="${todayKey()}" aria-label="Día"><input type="time" id="noteTime" value="08:00" aria-label="Hora"></div>
        <p class="tiny muted" style="margin:4px 0 0">No la verá hasta ese momento; ese día le llega un aviso. Ideal para su cumpleaños o un examen.</p></details>
      <button class="btn ghost" onclick="addNote()">Guardar en el frasco</button></div>
    <div class="glass"><div class="row"><h2>Notas que ya leíste</h2><span class="small muted">${read.length || ''}</span></div>
      <ul class="list" style="margin-top:6px">${read.length ? read.map(n => `<li>${avatar(n.fromUid, 30)}<div class="txt">${esc(n.text)}<span class="sub">De ${esc(fromLabel(n))} · ${fmtDate(new Date(n.createdAt))}</span></div></li>`).join('')
        : '<li class="empty">Aún no has sacado notas</li>'}</ul></div>
    <div class="glass"><h2>Notas que escribiste</h2>
      <ul class="list" style="margin-top:6px">${mine.length ? mine.map(n => `<li><div class="txt">${esc(n.text)}<span class="sub">${fmtDate(new Date(n.createdAt))}${n.showAt ? ` · le llega el ${new Date(n.showAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
        <span class="pill ${n.readAt ? 'ok' : ''}">${n.readAt ? 'Leída' : arrived(n) ? 'Sin leer' : '⏰ Programada'}</span>
        <button class="del" aria-label="Borrar nota" onclick="delNote('${n.id}')">${icon('trash')}</button></li>`).join('')
        : '<li class="empty">Todavía no escribes ninguna</li>'}</ul></div>`);
  loadPhotos($('loveBody'));
}
function addNote() {
  const t = $('newNote').value.trim();
  if (!t) return toast('Escribe algo bonito primero');
  const day = $('noteDay')?.value, showAt = day ? new Date(`${day}T${$('noteTime').value || '08:00'}`).getTime() : 0;
  if (day && showAt <= Date.now()) return toast('Elige una fecha y hora que todavía no haya pasado');
  // showDay: el servicio de avisos busca por día las notas programadas y avisa a su hora
  write(setDoc(newRef('notes'), { text: t, fromUid: uid(), fromName: myName(), createdAt: Date.now(), readAt: null, ...(showAt ? { showAt, showDay: day, showTime: $('noteTime').value || '08:00' } : {}) }));
  markActive();
  if (!showAt) notify('notes', { title: `💌 ${meForPartner()} dejó una nota en el frasco`, body: 'Ábrela cuando quieras', url: './?open=notes', tag: 'notes' });
  $('newNote').value = ''; toast(showAt ? `Nota programada: le llega el ${new Date(showAt).toLocaleString('es', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} ⏰` : 'Nota guardada en el frasco');
}
function drawNote() {
  const forMe = S.data.notes.filter(n => n.fromUid !== uid() && arrived(n));
  if (!forMe.length) return toast('No hay notas para ti todavía');
  const unread = forMe.filter(n => !n.readAt), n = pick(unread.length ? unread : forMe);
  if (!n.readAt) { write(updateDoc(ref('notes', n.id), { readAt: Date.now() })); celebrate('hearts'); }
  openSheet(`<div class="stack center"><div style="font-size:40px">💌</div><div class="note-paper">${esc(n.text)}</div>
    <p class="small muted" style="margin:0">De ${esc(fromLabel(n))} · escrita el ${fmtDate(new Date(n.createdAt))}${unread.length ? '' : ' · ya leíste todas, esta es repetida'}</p>
    <button class="btn" onclick="closeSheet()">${icon('heart-f')} Gracias</button></div>`);
}
async function delNote(id) { if (await ask('¿Borrar esta nota?')) write(deleteDoc(ref('notes', id))); }

/* ---------- Cupones ---------- */
const expired = c => c.expires && !c.redeemedAt && c.expires < todayKey();
export const couponsExpiring = () => S.data.coupons.filter(c => c.fromUid !== uid() && c.expires && !c.redeemedAt && !expired(c) && (parseDate(c.expires) - parseDate(todayKey())) / 864e5 <= 3);
function couponStatus(c) {
  if (c.doneAt) return `Cumplido el ${fmtShort(new Date(c.doneAt))}`;
  if (expired(c)) return `Venció el ${fmtShort(parseDate(c.expires))}`;
  if (c.expires && !c.redeemedAt) return `Vence el ${fmtShort(parseDate(c.expires))}`;
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
      <div class="row" style="gap:8px"><label class="small muted" for="couponExp" style="white-space:nowrap">Vence (opcional)</label><input type="date" id="couponExp" min="${todayKey()}" aria-label="Fecha de vencimiento"></div>
      <button class="btn" onclick="addCoupon()">${icon('gift')} Regalar cupón</button></div>
    <div class="glass stack"><h2>Cupones de ${pn} para ti</h2>
      ${forMe.length ? forMe.map(c => `<div class="ticket ${c.doneAt ? 'used' : ''}"><div class="e">${esc(c.emoji)}</div>
        <div class="txt">${esc(c.text)}<small>${c.redeemedAt && !c.doneAt ? `Canjeado, esperando a que ${pn} cumpla` : couponStatus(c)}</small></div>
        ${!c.redeemedAt && !expired(c) ? `<button class="btn small" onclick="redeemCoupon('${c.id}')">Canjear</button>` : ''}</div>`).join('')
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
  const emoji = $('couponEmoji').value.trim() || '🎟️';
  const expires = $('couponExp')?.value || null;
  write(setDoc(newRef('coupons'), { text, emoji, fromUid: uid(), createdAt: Date.now(), seenAt: null, redeemedAt: null, doneAt: null, ...(expires ? { expires } : {}) }));
  markActive();
  notify('coupons', { title: `🎟️ ${meForPartner()} te regaló un cupón`, body: `${emoji} ${text}${expires ? ` · vence el ${fmtShort(parseDate(expires))}` : ''}`, url: './?open=coupons', tag: 'coupons' });
  $('couponText').value = ''; toast(`Cupón regalado a ${partnerName()}`);
}
async function redeemCoupon(id) {
  if (!await ask('¿Canjear este cupón ahora?')) return;
  write(updateDoc(ref('coupons', id), { redeemedAt: Date.now(), seenAt: Date.now() })); toast('¡Canjeado!'); celebrate('hearts');
  const c = S.data.coupons.find(x => x.id === id);
  notify('coupons', { title: `🎟️ ${meForPartner()} canjeó tu cupón`, body: c ? `${c.emoji || ''} ${c.text}`.trim() : '', url: './?open=coupons', tag: 'coupon-' + id });
}
function fulfillCoupon(id) {
  write(updateDoc(ref('coupons', id), { doneAt: Date.now() })); toast('¡Cumplido!'); celebrate('hearts');
  const c = S.data.coupons.find(x => x.id === id);
  notify('coupons', { title: `✅ ${meForPartner()} cumplió el cupón`, body: c ? `${c.emoji || ''} ${c.text}`.trim() : '', url: './?open=coupons', tag: 'coupon-' + id });
}
async function delCoupon(id) { if (await ask('¿Borrar este cupón?')) write(deleteDoc(ref('coupons', id))); }
function markCouponsSeen() {
  for (const c of S.data.coupons) if (c.fromUid !== uid() && !c.seenAt) write(updateDoc(ref('coupons', c.id), { seenAt: Date.now() }));
}

on('notes coupons profiles', render);
onShow('s-love', () => { if (tab === 'coupons') markCouponsSeen(); });
expose({ loveTab, drawNote, addNote, delNote, useCouponTpl, addCoupon, redeemCoupon, fulfillCoupon, delCoupon });
