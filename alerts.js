// Avisos (1.15.0): UNA sola lista con todo lo que espera a cada uno (lo que hizo su pareja o lo que le toca hacer).
// De aquí salen la campana 🔔 de Inicio (con la hoja «Avisos»), los puntitos de la barra de abajo y de Más, los
// mosaicos de Más y las filas de avisos de la tarjeta «Hoy». Así nunca dicen cosas distintas.
// Cada aviso: { key, sec, e, text, short, n, run }
//   sec   = pantalla dueña del aviso (su puntito va en ese botón de la barra, o en Más si no está en la barra;
//           's-home' = puntito de Inicio)
//   text  = frase completa (HTML ya escapado) para la campana y «Hoy»; short = frase corta para el mosaico de Más
//   n     = cuánto suma al puntito; run = lo que hace al tocarlo (lleva a la pestaña exacta)
// Para agregar un aviso nuevo: una línea add(...) en alertItems(). Ver docs/ARQUITECTURA.md.
import { S, esc, icon, uid, partnerUid, partnerName, plural, todayKey, openSheet, closeSheet, expose, go, toast } from './core.js';
import { listNeedsMyVote, openVote } from './decide.js';
import { unreadNotes } from './love.js';
import { unseenSnaps, newChats } from './snaps.js';
import { frutaAlerts } from './fruta.js';
import { quizWaiting } from './quiz.js';
import { partnerCravings } from './cravings.js';
import { arrowsAlerts } from './arrows.js';
import { busAlerts } from './bus.js';
import { adventToday } from './advent.js';
import { guessWaiting } from './guess.js';
import { urgentReminders } from './reminders.js';
import { myDailyDone, partnerDailyDone } from './daily.js';
import { sectionName } from './menu.js';
import { vacAlerts } from './vacations.js';
import { regalitoAlerts } from './advent-gifts.js';
import { sorpresaAlerts } from './sorpresa.js';
import { diaryAlerts } from './diary.js';
import { mejengaAlerts } from './mejengas.js';

const later = f => setTimeout(f, 320); // después de cambiar de pantalla
const focusHome = sel => () => { go('s-home'); later(() => { const el = document.querySelector(sel); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (el?.tagName === 'TEXTAREA') el.focus(); }); };

export function alertItems() {
  if (!S.me || !uid()) return [];
  const p = partnerUid(), pn = esc(partnerName()), out = [];
  const add = (key, sec, e, text, short, run, n = 1) => { if (n > 0) out.push({ key, sec, e, text, short, run, n }); };

  // Inicio
  for (const r of urgentReminders()) add('urg-' + r.id, 's-home', '🔴', `<b>Urgente:</b> ${esc(r.text)}`, 'Recordatorio urgente', () => { go('s-reminders'); later(() => window.openReminder?.(r.id)); });
  const ans = S.data.answers.find(a => a.id === todayKey());
  if (p && ans?.answers?.[p] && !ans.answers[uid()]) add('question', 's-home', '💬', `${pn} ya respondió la pregunta del día: responde para ver qué dijo`, 'Pregunta del día', focusHome('#answerText'));
  for (const a of sorpresaAlerts()) add(a.key, 's-home', a.e, a.text, a.short, focusHome('.sp-card'));
  if (guessWaiting()) add('guess', 's-home', '🔮', `${pn} ya respondió «¿Qué respondería ${pn}?»: adivina qué dijo`, '¿Qué respondería?', focusHome('.guess-card'));

  // Decidir
  const vl = S.data.lists.filter(listNeedsMyVote);
  add('vote', 's-decide', '🎲', vl.length === 1 ? `${pn} quiere decidir contigo: «${esc(vl[0].name)}». Te toca votar` : `${pn} quiere decidir contigo en ${plural(vl.length, 'lista', 'listas')}: te toca votar`,
    'Te toca votar', () => openVote(vl.length === 1 ? vl[0].id : ''), vl.length);

  // Detalles (notas y cupones)
  const loveAt = t => () => { go('s-love'); window.loveTab?.(t); };
  const notes = unreadNotes();
  add('notes', 's-love', '💌', `Tienes ${plural(notes, 'nota nueva', 'notas nuevas')} en el frasco`, plural(notes, 'nota nueva', 'notas nuevas'), loveAt('notes'), notes);
  const toDo = S.data.coupons.filter(c => c.fromUid === uid() && c.redeemedAt && !c.doneAt).length;
  add('coupons-do', 's-love', '🎟️', `${pn} canjeó ${plural(toDo, 'cupón', 'cupones')}: te toca cumplir`, 'Cupón por cumplir', loveAt('coupons'), toDo);
  const fresh = S.data.coupons.filter(c => c.fromUid !== uid() && !c.seenAt).length;
  add('coupons-new', 's-love', '🎁', `${pn} te regaló ${plural(fresh, 'cupón', 'cupones')}`, plural(fresh, 'cupón nuevo', 'cupones nuevos'), loveAt('coupons'), fresh);

  // Momentos
  const snaps = unseenSnaps();
  add('snaps', 's-moments', '📸', `${pn} subió ${plural(snaps.length, 'historia nueva', 'historias nuevas')}`, plural(snaps.length, 'historia nueva', 'historias nuevas'), () => window.openSnaps?.(snaps[0]?.id), snaps.length);
  const chats = newChats();
  add('chats', 's-moments', '💬', `${pn} te escribió en ${chats.length === 1 ? (chats[0].by === uid() ? 'tu historia' : 'su historia') : plural(chats.length, 'historia', 'historias')}`, 'Mensaje en una historia', () => window.openSnaps?.(chats[chats.length - 1]?.id), chats.length);
  if (!myDailyDone() && partnerDailyDone()) add('daily', 's-moments', '📷', `${pn} ya subió su foto del día: sube la tuya para verla`, 'Foto del día', () => { go('s-moments'); window.momTab?.('daily'); });

  // Diario de los dos
  for (const a of diaryAlerts()) add(a.key, 's-diary', a.e, a.text, a.short, () => go('s-diary'));

  // Mejengas
  for (const a of mejengaAlerts()) add(a.key, 's-mejengas', a.e, a.text, a.short, a.run);

  // Antojos
  const crav = partnerCravings().filter(c => !c.seen?.[uid()]);
  add('crav-new', 's-cravings', crav[0]?.emoji || '🍓', crav.length === 1 ? `${pn} tiene un antojo: ${esc(crav[0].text)}` : `${pn} tiene ${plural(crav.length, 'antojo nuevo', 'antojos nuevos')}`,
    plural(crav.length, 'antojo nuevo', 'antojos nuevos'), () => window.openCravings?.('now'), crav.length);
  const thanked = S.data.cravings.filter(c => !c.fav && c.done && c.by === uid() && !c.doneSeen);
  add('crav-done', 's-cravings', '🎉', `${pn} cumplió ${thanked.length === 1 ? 'tu antojo: ' + esc(thanked[0].text) : plural(thanked.length, 'antojo tuyo', 'antojos tuyos')}`,
    'Te cumplieron un antojo', () => window.openCravings?.('done'), thanked.length);

  // Quiz, calendario de adviento y juegos
  if (quizWaiting()) add('quiz', 's-quiz', '🧠', `${pn} ya jugó el quiz: te toca`, 'Te toca el quiz', () => go('s-quiz'));
  if (adventToday()) add('advent', 's-advent', '🎄', 'Ya puedes abrir la casilla de hoy del calendario de adviento', 'Casilla de hoy', () => window.openAdvent?.('mine'));
  for (const a of regalitoAlerts()) add(a.key, 's-advent', a.e, a.text, a.short, a.run);
  if (frutaAlerts()) add('fruta', 's-fruta', '🍍', `${pn} te espera en un duelo de Pura fruta`, 'Duelo pendiente', () => go('s-fruta'));
  if (arrowsAlerts()) add('arrows', 's-arrows', '🏹', `${pn} te retó a un duelo de Flechas`, 'Te retaron', () => go('s-arrows'));
  if (busAlerts()) add('bus', 's-bus', '🚌', `${pn} te retó a un duelo en La parada`, 'Te retaron', () => go('s-bus'));

  // Vacaciones (solo si ya la ve: gates['s-vac'])
  for (const a of vacAlerts()) add(a.key, 's-vac', a.e, a.text, a.short, a.run);
  return out;
}

// Puntitos por sección (sin Inicio): { 's-love': 3, ... }
export function sectionAlerts(items = alertItems()) {
  const m = {};
  for (const a of items) if (a.sec !== 's-home') m[a.sec] = (m[a.sec] || 0) + a.n;
  return m;
}
export const homeAlerts = (items = alertItems()) => items.filter(a => a.sec === 's-home').reduce((s, a) => s + a.n, 0);
export const alertTotal = (items = alertItems()) => items.reduce((s, a) => s + a.n, 0);
// Frase corta del primer aviso de una sección (mosaicos de Más)
export const sectionAlertText = (sec, items = alertItems()) => items.find(a => a.sec === sec)?.short || '';

// Fila de un aviso (campana y «Hoy»): emoji, frase y de dónde viene
export const alertRow = (a, where = true) => `<button class="result-row" onclick="alertOpen('${a.key}')"><span class="e">${a.e}</span>
  <span class="grow">${a.text}${where ? `<span class="tiny muted alert-where">${a.sec === 's-home' ? 'En Inicio' : 'En ' + esc(sectionName(a.sec))}</span>` : ''}</span>${icon('send')}</button>`;

// La campana: botón con su número (lo pinta Inicio; app.js lo actualiza con cada cambio)
export const bellButton = () => { const n = alertTotal(); return `<button class="icon-btn bell-btn" onclick="openAlerts()" aria-label="Avisos${n ? `: ${n}` : ''}">${icon('bell')}<b class="dot" id="dot-bell" ${n ? '' : 'hidden'}>${n > 9 ? '9+' : n}</b></button>`; };

function openAlerts() {
  const items = alertItems();
  openSheet(`<div class="stack"><h2>🔔 Avisos</h2>
    ${items.length ? `<p class="small muted" style="margin:0">Toca uno para ir directo a donde está.</p><div class="alert-list">${items.map(a => alertRow(a)).join('')}</div>`
      : '<p class="empty">Todo al día ✨<br>No tienes nada pendiente.</p>'}
    <button class="btn ghost" onclick="closeSheet()">Cerrar</button></div>`);
}
function alertOpen(key) {
  const a = alertItems().find(x => x.key === key);
  closeSheet();
  if (a) a.run(); else toast('Eso ya no está pendiente ✨');
}
expose({ openAlerts, alertOpen });
