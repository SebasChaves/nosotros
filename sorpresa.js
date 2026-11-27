// ⚡ Momento sorpresa (1.19.0): cada día, a una hora al azar entre las 10:00 y las 21:00 (la misma para los dos,
// surpriseMin en core.js), los dos tienen 10 minutos para subir una foto de lo que están haciendo. La foto del otro se
// ve cuando subes la tuya. Se puede subir tarde (queda marcada). El Worker manda el aviso a esa hora (Worker v17).
// Datos: sorpresa/<día> = { <uid>: { photo, at, late, caption? } }; foto en photos/sp-<día>-<uid> (+ miniatura).
// Cuenta para la racha (home.js didSomething) y para la Liga del mes (2 puntos a tiempo, 1 tarde).
// En el emulador: ?emu&sorpHora=HH:MM pone la hora de hoy.
import { writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, expose, toast, openSheet, closeSheet, write, ref, cachePhoto, compressImage, photoError, makeThumb, thumbId,
         todayKey, parseDate, nameOf, partnerUid, partnerName, uid, celebrate, markActive, surpriseMin, EMU, rerender } from './core.js';
import { notify, meForPartner } from './push.js';

export const WINDOW_MIN = 10;
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const override = EMU && new URLSearchParams(location.search).get('sorpHora');
export function spMin(day = todayKey()) {
  if (override && day === todayKey()) { const [h, m] = override.split(':').map(Number); return h * 60 + (m || 0); }
  return surpriseMin(day);
}
export const spTime = (day = todayKey()) => hhmm(spMin(day));
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
// before = todavía no llega; open = están los 10 minutos; after = ya pasó
export function spPhase() { const n = nowMin(), t = spMin(); return n < t ? 'before' : n < t + WINDOW_MIN ? 'open' : 'after'; }
const entry = (day, who) => S.data.sorpresa?.find(d => d.id === day)?.[who];
export const mySpDone = (day = todayKey()) => !!entry(day, uid());
export const partnerSpDone = (day = todayKey()) => { const p = partnerUid(); return !!p && !!entry(day, p); };
export const spEntry = entry;

// Avisos para la campana (alerts.js)
export function sorpresaAlerts() {
  const out = [], ph = spPhase(), pn = esc(partnerName());
  if (mySpDone()) return out;
  if (ph === 'open') out.push({ key: 'sorpresa', e: '⚡', text: `<b>¡Momento sorpresa!</b> Te quedan ${Math.max(1, Math.ceil(spMin() + WINDOW_MIN - nowMin()))} minutos para tu foto`, short: '¡Momento sorpresa!' });
  else if (ph === 'after' && partnerSpDone()) out.push({ key: 'sorpresa', e: '⚡', text: `${pn} ya subió su momento sorpresa: sube el tuyo para verlo`, short: 'Momento sorpresa' });
  return out;
}

const slot = (day, who, revealed) => {
  const e = entry(day, who), me = who === uid();
  if (!e) return `<div class="daily-slot empty"><span class="small muted">${me ? 'Aún no subes la tuya' : `${esc(nameOf(who))} aún no sube la suya`}</span></div>`;
  if (!revealed) return `<div class="daily-slot locked"><span style="font-size:28px">🔒</span><span class="small">${esc(nameOf(who))} ya subió la suya</span><span class="tiny muted">Sube la tuya para verla</span></div>`;
  const at = new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `<button class="daily-slot" onclick="viewPhoto(this.querySelector('img'))" aria-label="Momento sorpresa de ${esc(nameOf(who))}">
    <img data-thumb="${e.photo}" alt=""><span class="daily-cap"><b>${esc(nameOf(who))}</b>${e.caption ? ' · ' + esc(e.caption) : ''}<span class="tiny"> · ${at}${e.late ? ' ⏰ tarde' : ' ⚡'}</span></span></button>`;
};
const pickBtn = (label, ghost = false) => `<label class="btn ${ghost ? 'ghost' : ''}">${icon('photo')} ${label}<input type="file" accept="image/*" hidden onchange="pickSorpresa(this)"></label>`;

// Tarjeta de Inicio: no sale antes de la hora (es sorpresa); durante los 10 minutos con cuenta regresiva; después,
// las fotos del día (o subirla tarde).
export function sorpresaCard() {
  const p = partnerUid(); if (!p) return '';
  const ph = spPhase(), tk = todayKey(), mine = mySpDone(), theirs = partnerSpDone();
  if (ph === 'before') return '';
  const head = `<div class="row"><span class="label">⚡ Momento sorpresa</span><span class="pill ${ph === 'open' ? 'hot' : ''}">${ph === 'open' ? `<span id="spCount">${countTxt()}</span>` : `fue a las ${spTime()}`}</span></div>`;
  if (ph === 'open' && !mine) return `<div class="glass stack sp-card sp-live">${head}
    <p class="small" style="margin:0"><b>¡Ahora!</b> Toma una foto de lo que estás haciendo en este momento. ${theirs ? `${esc(partnerName())} ya subió la suya 👀` : ''}</p>
    ${pickBtn('Tomar mi foto')}</div>`;
  return `<div class="glass stack sp-card">${head}
    <div class="daily-pair">${slot(tk, uid(), true)}${slot(tk, p, mine)}</div>
    ${!mine ? `${pickBtn(ph === 'open' ? 'Tomar mi foto' : 'Subirla tarde', ph !== 'open')}` : ''}
    ${!mine && ph === 'after' ? '<p class="tiny muted center" style="margin:0">Todavía cuenta para la racha; en la Liga vale menos que a tiempo.</p>' : ''}</div>`;
}
const countTxt = () => { const s = Math.max(0, Math.round((spMin() + WINDOW_MIN - nowMin()) * 60)); return `quedan ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Álbum (Momentos → Foto del día, abajo)
export function sorpresaAlbumHTML() {
  const p = partnerUid(), tk = todayKey();
  const past = (S.data.sorpresa || []).filter(d => d.id < tk && (d[uid()] || (p && d[p]))).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
  if (!past.length) return '';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return `<span class="label">⚡ Momentos sorpresa</span>${past.map(d => `<div class="glass stack" style="gap:8px">
    <span class="small muted">${cap(parseDate(d.id).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))} · a las ${spTime(d.id)}</span>
    <div class="daily-pair">${slot(d.id, uid(), true)}${p ? slot(d.id, p, true) : ''}</div></div>`).join('')}`;
}

let pending = null;
async function pickSorpresa(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try { pending = await compressImage(f, 1080); } catch (e) { return photoError(e); }
  const late = spPhase() === 'after';
  openSheet(`<div class="stack"><h2>⚡ Tu momento sorpresa</h2><img src="${pending}" alt="" style="width:100%;max-height:50vh;object-fit:cover;border-radius:18px">
    <input id="spCap" placeholder="¿Qué estabas haciendo? (opcional)" maxlength="80" aria-label="Descripción">
    ${late ? '<p class="tiny muted" style="margin:0">⏰ Ya pasaron los 10 minutos: queda marcada como tarde.</p>' : ''}
    <button class="btn" id="spBtn" onclick="saveSorpresa()">Publicar</button></div>`);
}
async function saveSorpresa() {
  if (!pending) return;
  $('spBtn').disabled = true;
  const day = todayKey(), id = `sp-${day}-${uid()}`, late = spPhase() === 'after', first = !mySpDone();
  const thumb = await makeThumb(pending).catch(() => null);
  const batch = writeBatch(db);
  batch.set(ref('photos', id), { data: pending }); cachePhoto(id, pending);
  if (thumb) { batch.set(ref('photos', thumbId(id)), { data: thumb }); cachePhoto(thumbId(id), thumb); }
  batch.set(ref('sorpresa', day), { [uid()]: { photo: id, caption: $('spCap').value.trim(), at: Date.now(), late } }, { merge: true });
  write(batch.commit());
  pending = null; closeSheet(); markActive();
  toast(partnerSpDone() ? `¡Listo! Ya puedes ver la de ${partnerName()}` : late ? 'Publicada (tarde)' : '¡A tiempo! ⚡');
  if (first) {
    if (!late) celebrate();
    notify('sorpresa', { title: `⚡ ${meForPartner()} ya subió su momento sorpresa`, body: partnerSpDone() ? 'Ya pueden ver las dos fotos 👀' : late ? 'Sube la tuya para verla' : 'Sube la tuya para verla: ¡corre!', url: './?open=sorpresa', tag: 'sorpresa-' + day });
  }
}

// Con la app abierta: al llegar la hora se avisa y se repinta Inicio; durante los 10 minutos corre la cuenta regresiva
let lastPhase = null;
setInterval(() => {
  if (!S.me) return;
  const ph = spPhase();
  if (lastPhase && ph !== lastPhase) {
    if (ph === 'open' && !mySpDone()) { toast('⚡ ¡Momento sorpresa! Tienes 10 minutos para tu foto'); navigator.vibrate?.([120, 60, 120]); }
    rerender('sorpresa');
  }
  lastPhase = ph;
  const c = document.getElementById('spCount'); if (c) c.textContent = countTxt();
}, 1000);

expose({ pickSorpresa, saveSorpresa });
