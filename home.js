// Inicio: contador, ánimo del día, pregunta del día, reto de la semana, próximas fechas y "un día como hoy".
import { setDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, coupleRef, loadPhotos, profile,
  parseDate, today, daysBetween, fmtDate, fmtShort, dayKey, todayKey, whenText, addMonths, weekKey, epochDay, DAY,
  nameOf, partnerUid, partnerName, myName, plural, uid, avatar, ask, celebrate } from './core.js';
import { QUESTIONS, MOODS, CHALLENGES } from './data.js';
import { itemsFor, nextEventDate, nextOccurrence } from './calendar.js';
import { unreadNotes } from './love.js';
import { listNeedsMyVote } from './decide.js';
import { quizWaiting } from './quiz.js';
import { myDailyDone, partnerDailyDone } from './daily.js';
import { dueReminders, urgentReminders, whenTxt } from './reminders.js';
import { songDedication } from './music.js';
import { snapsCard } from './snaps.js';

/* ---------- Racha y "Pensando en ti" ---------- */
// Un día cuenta para la racha si los dos hicieron algo: marcar ánimo, responder la pregunta o mandar un "pensando en ti".
const didSomething = (key, who) => !!(S.data.moods.find(x => x.id === key)?.[who] || S.data.answers.find(x => x.id === key)?.answers?.[who] || S.data.thinks.find(x => x.id === key)?.[who] || S.data.daily.find(x => x.id === key)?.[who]);
const bothDid = key => { const p = partnerUid(); return !!p && didSomething(key, uid()) && didSomething(key, p); };
const prevDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
export function streak() {
  let d = today(), n = 0;
  if (!bothDid(dayKey(d))) d = prevDay(d); // hoy todavía cuenta si lo completan más tarde
  while (n < 3660 && bothDid(dayKey(d))) { n++; d = prevDay(d); }
  return n;
}
export function bestStreak() {
  const keys = [...new Set([...S.data.moods, ...S.data.answers, ...S.data.thinks].map(x => x.id))].filter(bothDid).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) { run = prev && dayKey(new Date(parseDate(prev).getFullYear(), parseDate(prev).getMonth(), parseDate(prev).getDate() + 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return best;
}
const thinksToday = who => S.data.thinks.find(x => x.id === todayKey())?.[who] || 0;
function sendThink() {
  write(setDoc(ref('thinks', todayKey()), { [uid()]: increment(1) }, { merge: true }));
  celebrate('hearts');
}
// Aviso cuando llega un "pensando en ti" con la app abierta
let lastPartnerThinks = null;
function checkIncomingThink() {
  const p = partnerUid(); if (!p) return;
  const n = thinksToday(p);
  if (lastPartnerThinks !== null && n > lastPartnerThinks) { toast(`💗 ${partnerName()} está pensando en ti`); celebrate('hearts'); }
  lastPartnerThinks = n;
}

/* ---------- Tarjeta "Hoy" ---------- */
// Recordatorios urgentes: tarjeta arriba de todo, con check para marcarlos como hechos ahí mismo.
function urgentCard() {
  const list = urgentReminders(); if (!list.length) return '';
  return `<div class="glass urgent-card stack" style="gap:4px"><div class="row"><span class="label" style="color:#FF7A9C">🔴 Urgente</span><button class="link" onclick="go('s-reminders')">Ver todos</button></div>
    <ul class="list">${list.slice(0, 5).map(r => `<li><button class="check-btn" aria-label="Marcar hecho" onclick="toggleReminder('${r.id}')"></button>
      <div class="txt" role="button" tabindex="0" style="cursor:pointer" onclick="go('s-reminders');openReminder('${r.id}')"><b>${esc(r.text)}</b><span class="sub">${esc(whenTxt(r))}${r.note ? ' · ' + esc(r.note) : ''}</span></div></li>`).join('')}</ul>${list.length > 5 ? `<p class="tiny muted" style="margin:0">y ${list.length - 5} más</p>` : ''}</div>`;
}
function todayCard() {
  const p = partnerUid(), pn = esc(partnerName()), tk = todayKey();
  const tomorrow = dayKey(new Date(today().getFullYear(), today().getMonth(), today().getDate() + 1));
  const rows = [];
  const row = (e, text, action) => rows.push(`<button class="result-row" onclick="${action}"><span class="e">${e}</span><span class="grow">${text}</span>${icon('send')}</button>`);
  for (const it of itemsFor(tk)) row(it.kind === 'plan' ? '📌' : it.kind === 'trip' ? '✈️' : '🎉', `<b>Hoy:</b> ${esc(it.label)}${it.time ? ' · ' + esc(it.time) : ''}`, `go('s-cal');calPick('${tk}')`);
  for (const it of itemsFor(tomorrow).filter(i => i.kind !== 'trip')) row('⏰', `<b>Mañana:</b> ${esc(it.label)}`, `go('s-cal');calPick('${tomorrow}')`);
  for (const r of dueReminders().slice(0, 4)) row('🔔', `<b>${r.date < tk ? 'Pendiente' : 'Recordar'}:</b> ${esc(r.text)}${r.time ? ' · ' + esc(r.time) : ''}`, "go('s-reminders')");
  const ded = songDedication(); if (ded) row('💌', `<b>${esc(nameOf(ded.dedication.by))}</b> te dedicó una canción: ${esc(ded.title)}`, 'openDedication()');
  const ans = todayAnswers();
  if (!ans?.answers?.[uid()]) row('💬', p && ans?.answers?.[p] ? `Responde la pregunta del día (${pn} ya respondió)` : 'Responde la pregunta del día', `document.getElementById('answerText')?.scrollIntoView({block:'center'});document.getElementById('answerText')?.focus()`);
  if (!myDailyDone()) row('📷', partnerDailyDone() ? `${pn} ya subió su foto del día: sube la tuya para verla` : 'Sube tu foto del día', `go('s-moments');momTab('daily')`);
  const lb = S.settings.lastBackup, dataCount = S.data.notes.length + S.data.moments.length + S.data.bucket.length;
  if (dataCount > 10 && (!lb || Date.now() - lb > 30 * 864e5)) row('💾', lb ? `Hace ${Math.round((Date.now() - lb) / 864e5)} días que no descargan un respaldo` : 'Descarguen su primer respaldo', 'exportData()');
  const notes = unreadNotes(); if (notes) row('💌', `Tienes ${plural(notes, 'nota nueva', 'notas nuevas')} en el frasco`, `go('s-love');loveTab('notes')`);
  const toDo = S.data.coupons.filter(c => c.fromUid === uid() && c.redeemedAt && !c.doneAt).length; if (toDo) row('🎟️', `${pn} canjeó ${plural(toDo, 'cupón', 'cupones')}: te toca cumplir`, `go('s-love');loveTab('coupons')`);
  const fresh = S.data.coupons.filter(c => c.fromUid !== uid() && !c.seenAt).length; if (fresh) row('🎁', `${pn} te regaló ${plural(fresh, 'cupón', 'cupones')}`, `go('s-love');loveTab('coupons')`);
  const votes = S.data.lists.filter(listNeedsMyVote).length; if (votes) row('🎲', `${pn} ya votó en ${plural(votes, 'lista', 'listas')}: falta tu voto`, `go('s-decide');decideTab('lists')`);
  if (quizWaiting()) row('🧠', `${pn} ya jugó el quiz: te toca`, `go('s-quiz')`);
  const tripVotes = S.data.trips.filter(t => [...(t.stays || []), ...(t.flights || [])].some(o => o.votes?.[uid()] === undefined)); if (tripVotes.length) row('🏨', `Hay opciones nuevas para votar en ${esc(tripVotes[0].name)}`, `openTrip('${tripVotes[0].id}')`);

  const s = streak(), best = bestStreak(), meDone = didSomething(tk, uid()), themDone = p && didSomething(tk, p);
  const mine = thinksToday(uid()), theirs = p ? thinksToday(p) : 0;
  return `<div class="glass stack">
    <div class="row"><span class="label">${icon('cal')} Hoy</span>
      <span class="pill ${s ? 'hot' : ''}" title="Días seguidos en que los dos usaron la app">🔥 ${plural(s, 'día', 'días')}${best > s ? ` · récord ${best}` : ''}</span></div>
    ${!meDone && p ? `<p class="small muted" style="margin:0">${s ? 'Para no perder la racha' : 'Para empezar una racha'}: marca tu ánimo, responde la pregunta o manda un corazón.${themDone ? `  ${pn} ya hizo lo suyo.` : ''}</p>` : ''}
    <div class="row">
      <button class="btn" style="flex:1" onclick="sendThink()">${icon('heart-f')} Pensando en ti</button>
      ${p ? `<span class="small muted" style="text-align:right;line-height:1.35">${theirs ? `<b style="color:var(--text)">${pn}</b> pensó en ti ${plural(theirs, 'vez', 'veces')}` : `Aún no llegan corazones`}<br>tú: ${mine}</span>` : ''}
    </div>
    ${rows.length ? `<div>${rows.join('')}</div>` : '<p class="small muted center" style="margin:0">Todo al día ✨</p>'}
  </div>`;
}

/* ---------- Fechas especiales ---------- */
function fechaLabel(f, occ) {
  const years = occ.getFullYear() - parseDate(f.date).getFullYear();
  if (f.yearly && f.emoji === '🎂' && years > 0) return `${f.emoji} ${f.title} (cumple ${years})`;
  if (f.yearly && f.emoji === '💍' && years > 0) return `${f.emoji} ${f.title} (${years} años)`;
  return `${f.emoji} ${f.title}`;
}
export function upcoming() {
  const now = today(), list = [];
  if (S.settings.start) {
    const start = parseDate(S.settings.start), days = daysBetween(start, now);
    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (addMonths(start, months) > now) months--;
    months = Math.max(0, months);
    const next100 = (Math.floor(days / 100) + 1) * 100;
    list.push({ label: `💯 ${next100.toLocaleString('es')} días juntos`, date: new Date(start.getTime() + next100 * DAY) });
    const next1000 = (Math.floor(days / 1000) + 1) * 1000;
    if (next1000 !== next100) list.push({ label: `🎉 ${next1000.toLocaleString('es')} días juntos`, date: new Date(start.getTime() + next1000 * DAY) });
    const total = months + 1;
    if (total % 12 === 0) list.push({ label: `💍 Aniversario #${total / 12}`, date: addMonths(start, total) });
    else {
      list.push({ label: `🗓️ Mesiversario #${total}`, date: addMonths(start, total) });
      const y = Math.floor(months / 12) + 1;
      list.push({ label: `💍 Aniversario #${y}`, date: addMonths(start, y * 12) });
    }
  }
  for (const f of S.data.dates) { const occ = nextOccurrence(f); if (occ) list.push({ label: fechaLabel(f, occ), date: occ }); }
  for (const t of S.data.trips) if (t.start && parseDate(t.start) >= now) list.push({ label: `✈️ ${t.name}`, date: parseDate(t.start) });
  for (const ev of S.data.events) { const k = ev.date && nextEventDate(ev); if (k) list.push({ label: `📌 ${ev.title}${ev.time ? ' · ' + ev.time : ''}`, date: parseDate(k) }); }
  return list.sort((a, b) => a.date - b.date);
}
function openFechas() {
  const items = [...S.data.dates].sort((a, b) => (nextOccurrence(a) || 9e15) - (nextOccurrence(b) || 9e15));
  openSheet(`<div class="stack">
    <h2>Fechas especiales</h2>
    <ul class="list">${items.length ? items.map(f => {
      const occ = nextOccurrence(f);
      return `<li><div class="txt" role="button" tabindex="0" style="cursor:pointer" aria-label="Editar ${esc(f.title)}" onclick="openFecha(null,'${f.id}')">${esc(f.emoji)} ${esc(f.title)}<span class="sub">${fmtDate(parseDate(f.date))}${f.yearly ? ' · cada año' : ''} · ${occ ? whenText(daysBetween(today(), occ)) : 'ya pasó'}</span></div>
        <button class="del" aria-label="Borrar" onclick="delFecha('${f.id}')">${icon('trash')}</button></li>`;
    }).join('') : '<li class="empty">Aún no hay fechas</li>'}</ul>
    <p class="tiny muted center" style="margin:0">Toca una fecha para editarla o pasarla al calendario del teléfono.</p>
    <button class="btn" onclick="openFecha('${todayKey()}')">${icon('plus')} Agregar fecha</button>
  </div>`);
}

/* ---------- Pregunta del día ---------- */
export const todayQuestion = () => QUESTIONS[epochDay() % QUESTIONS.length];
export const todayAnswers = () => S.data.answers.find(a => a.id === todayKey());
function questionCard() {
  const ans = todayAnswers(), q = ans?.q || todayQuestion();
  const p = partnerUid(), pn = esc(partnerName());
  const mine = ans?.answers?.[uid()], theirs = p && ans?.answers?.[p];
  let body;
  if (!mine) {
    body = `<textarea id="answerText" maxlength="500" placeholder="Tu respuesta…" style="min-height:70px" aria-label="Tu respuesta"></textarea>
      <button class="btn" style="margin-top:10px" onclick="answerQuestion()">Responder</button>
      <p class="small muted" style="margin:10px 0 0">${theirs ? `${icon('lock')} ${pn} ya respondió. Responde para ver su respuesta.` : `${pn} aún no responde.`}</p>`;
  } else {
    body = `<div class="answer"><b class="who">${avatar(uid(), 22)}Tú</b>${esc(mine.text)}</div>` +
      (theirs ? `<div class="answer"><b class="who">${avatar(p, 22)}${pn}</b>${esc(theirs.text)}</div>` : `<p class="small muted" style="margin:10px 0 0">Esperando la respuesta de ${pn}…</p>`);
  }
  return `<div class="glass"><div class="row"><span class="label">${icon('chat')} Pregunta del día</span>
    <button class="link" onclick="openAnswers()">Anteriores</button></div><div class="q">${esc(q)}</div>${body}</div>`;
}
function answerQuestion() {
  const text = $('answerText').value.trim();
  if (!text) return toast('Escribe tu respuesta');
  write(setDoc(ref('answers', todayKey()), { q: todayAnswers()?.q || todayQuestion(), answers: { [uid()]: { text, at: Date.now() } } }, { merge: true }));
  $('answerText').value = '';
}
function openAnswers() {
  const p = partnerUid(), pn = esc(partnerName());
  const past = S.data.answers.filter(a => a.id !== todayKey() && a.answers?.[uid()]).sort((a, b) => b.id.localeCompare(a.id));
  openSheet(`<div class="stack"><h2>Respuestas anteriores</h2>${past.length ? past.map(a => `
    <div><div class="tiny muted">${fmtDate(parseDate(a.id))}</div><div style="font-weight:600;margin:4px 0">${esc(a.q)}</div>
    <div class="answer"><b>Tú</b>${esc(a.answers[uid()].text)}</div>
    ${p && a.answers[p] ? `<div class="answer"><b>${pn}</b>${esc(a.answers[p].text)}</div>` : `<p class="small muted">${pn} no respondió</p>`}</div>`).join('')
    : '<p class="empty">Aquí aparecerán las preguntas que ya respondiste.</p>'}
    <button class="btn ghost" onclick="closeSheet()">Cerrar</button></div>`);
}

/* ---------- Ánimo del día ---------- */
function moodCard() {
  const day = S.data.moods.find(m => m.id === todayKey()) || {};
  const p = partnerUid(), mine = day[uid()]?.e, theirs = p && day[p]?.e;
  const days = [...Array(7)].map((_, i) => { const d = new Date(today()); d.setDate(d.getDate() - (6 - i)); return d; });
  const cell = (d, who) => S.data.moods.find(m => m.id === dayKey(d))?.[who]?.e || '·';
  return `<div class="glass">
    <div class="row"><span class="label">${icon('heart')} ¿Cómo te sientes hoy?</span>
      <span class="small muted">${p ? `${esc(partnerName())}: ${theirs || 'aún no'}` : ''}</span></div>
    <div class="moods">${MOODS.map(e => `<button class="${mine === e ? 'on' : ''}" onclick="setMood('${e}')" aria-label="Ánimo ${e}">${e}</button>`).join('')}</div>
    <div class="week" aria-label="Últimos 7 días">
      <span></span>${days.map(d => `<span class="d">${d.toLocaleDateString('es', { weekday: 'narrow' })}</span>`).join('')}
      <span class="who">${avatar(uid(), 24)}</span>${days.map(d => `<span>${cell(d, uid())}</span>`).join('')}
      ${p ? `<span class="who">${avatar(p, 24)}</span>${days.map(d => `<span>${cell(d, p)}</span>`).join('')}` : ''}
    </div></div>`;
}
function setMood(e) { write(setDoc(ref('moods', todayKey()), { [uid()]: { e, at: Date.now() } }, { merge: true })); }

/* ---------- Reto de la semana ---------- */
export const thisWeekChallenge = () => {
  const wk = weekKey(), doc = S.data.challenges.find(c => c.id === wk) || {};
  const n = Number(wk.slice(0, 4)) * 53 + Number(wk.slice(6));
  return { wk, doc, text: CHALLENGES[(n + (doc.offset || 0)) % CHALLENGES.length] };
};
function challengeCard() {
  const { doc, text } = thisWeekChallenge();
  const total = S.data.challenges.filter(c => c.doneAt).length;
  return `<div class="glass"><div class="row"><span class="label">${icon('trophy')} Reto de la semana</span>
    <span class="pill ${doc.doneAt ? 'ok' : ''}">${doc.doneAt ? 'Cumplido' : plural(total, 'cumplido', 'cumplidos')}</span></div>
    <div class="q">${esc(doc.text || text)}</div>
    ${doc.doneAt ? `<p class="small muted" style="margin:0">Lo cumplieron el ${fmtShort(new Date(doc.doneAt))}. ¡Bien!</p>`
      : `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="skipChallenge()">Otro reto</button>
         <button class="btn small" style="width:100%" onclick="doneChallenge()">${icon('check')} Lo hicimos</button></div>`}</div>`;
}
function skipChallenge() { const { wk, doc } = thisWeekChallenge(); write(setDoc(ref('challenges', wk), { offset: (doc.offset || 0) + 1 }, { merge: true })); }
function doneChallenge() {
  const { wk, text } = thisWeekChallenge();
  write(setDoc(ref('challenges', wk), { doneAt: Date.now(), by: uid(), text }, { merge: true }));
  toast('¡Reto cumplido! 🏆'); celebrate();
}

/* ---------- Un día como hoy ---------- */
function memoryCard() {
  const now = today(), md = dayKey(now).slice(5);
  const m = S.data.moments.filter(x => x.date?.slice(5) === md && Number(x.date.slice(0, 4)) < now.getFullYear()).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!m) return '';
  const years = now.getFullYear() - Number(m.date.slice(0, 4));
  return `<div class="glass"><span class="label">${icon('spark')} Un día como hoy</span>
    <div class="memory" style="margin-top:10px">${m.hasPhoto ? `<img data-thumb="${m.id}" alt="">` : ''}
    <div><div style="font-weight:700">${esc(m.title)}</div><div class="small muted">Hace ${plural(years, 'año', 'años')}</div></div></div></div>`;
}

/* ---------- Pantalla ---------- */
function renderHome() {
  const ready = S.settings.start && myName();
  const names = Object.entries(S.settings.members || {}).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0));
  let hero;
  if (!ready) {
    hero = `<div class="glass center stack"><div style="font-size:42px">💞</div>
      <h2>${S.settings.start ? '¡Hola!' : '¡Bienvenido!'}</h2>
      <p class="muted" style="margin:0">${S.settings.start ? 'Solo falta que pongas tu nombre.' : 'Pon tu nombre y el día en que empezaron para activar el contador.'}</p>
      <button class="btn" onclick="go('s-settings')">Configurar</button></div>`;
  } else hero = counterCard();
  const up = upcoming().slice(0, 5);
  const cards = {
    urgent: urgentCard, counter: () => hero, snaps: snapsCard, today: todayCard, memory: memoryCard, mood: moodCard, question: questionCard, challenge: challengeCard,
    upcoming: () => `<div class="glass"><div class="row"><span class="label">${icon('cal')} Próximos momentos</span>
      <div class="row" style="gap:0"><button class="link" onclick="go('s-cal')">Calendario</button><button class="link" onclick="openFechas()">Fechas</button></div></div>
      <div style="margin-top:6px">${up.length ? up.map(m => `<div class="event"><div>${esc(m.label)}<div class="tiny muted">${fmtDate(m.date)}</div></div>
        <span class="when">${whenText(daysBetween(today(), m.date))}</span></div>`).join('') : '<p class="empty">Agreguen cumpleaños, viajes o eventos</p>'}</div></div>`,
  };
  // Orden y tarjetas visibles que eligió cada uno en Ajustes (si aún no configuran, sale la tarjeta de bienvenida igual).
  const layout = homeLayout().filter(c => c.on || (c.id === 'counter' && !ready));
  paint('s-home', `
    <div class="topbar"><div class="title"><span class="hi">Hola${greetName() ? ', ' + esc(greetName()) : ''}</span><h1 class="brand grad-text" style="font-size:30px">Futari</h1></div>
      <div class="row" style="gap:10px"><div class="avatars">${names.map(([id]) => avatar(id, 36)).join('')}</div>
      <button class="icon-btn" onclick="openSearch()" aria-label="Buscar">${icon('search')}</button>
      <button class="icon-btn" onclick="go('s-settings')" aria-label="Ajustes">${icon('gear')}</button></div></div>
    ${layout.map(c => cards[c.id]?.() || '').join('\n')}
    ${layout.length < 3 ? '<p class="tiny muted center" style="margin:0">Puedes mostrar más tarjetas en Ajustes → Tu Inicio</p>' : ''}
  `);
  loadPhotos($('s-home'));
}

/* ---------- Personalización de Inicio ---------- */
export const HOME_CARDS = [['urgent', '🔴 Recordatorios urgentes'], ['counter', '💞 Contador'], ['snaps', '📸 Instantáneas'], ['today', '📌 Hoy'], ['memory', '📸 Un día como hoy'],
  ['mood', '🙂 ¿Cómo te sientes?'], ['question', '💬 Pregunta del día'], ['challenge', '🏆 Reto de la semana'], ['upcoming', '🗓️ Próximos momentos']];
// [{ id, on }] en el orden elegido; las tarjetas nuevas que no estén guardadas se agregan visibles, detrás de la
// tarjeta que tienen antes en HOME_CARDS (por ejemplo, Instantáneas queda debajo del contador).
export function homeLayout() {
  const out = (profile(uid()).prefs?.home || []).filter(c => HOME_CARDS.some(([id]) => id === c.id));
  HOME_CARDS.forEach(([id], k) => {
    if (out.some(c => c.id === id)) return;
    const prev = k > 0 ? out.findIndex(c => c.id === HOME_CARDS[k - 1][0]) : -1;
    out.splice(prev >= 0 ? prev + 1 : (k === 0 ? 0 : out.length), 0, { id, on: true });
  });
  return out;
}
const greetName = () => profile(uid()).prefs?.myNick || myName();

// Contador: cada uno elige desde qué fecha cuenta y en qué unidad (días, semanas, meses u horas).
export const COUNTER_UNITS = [['days', 'Días'], ['weeks', 'Semanas'], ['months', 'Meses'], ['hours', 'Horas']];
function counterFrom() {
  const c = profile(uid()).prefs?.counter || {};
  return c.from === 'custom' && c.date ? { date: c.date, label: c.label || 'desde nuestra fecha', unit: c.unit || 'days' }
    : { date: S.settings.start, label: 'juntos', unit: c.unit || 'days' };
}
function counterCard() {
  const { date, label, unit } = counterFrom();
  const start = parseDate(date), now = today(), days = Math.max(0, daysBetween(start, now));
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (addMonths(start, months) > now) months--;
  months = Math.max(0, months);
  const restDays = Math.max(0, daysBetween(addMonths(start, months), now));
  const ymd = `<span><b>${Math.floor(months / 12)}</b>años</span><span><b>${months % 12}</b>meses</span><span><b>${restDays}</b>días</span>`;
  const mins = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
  const [big, word, parts] = unit === 'weeks' ? [Math.floor(days / 7), Math.floor(days / 7) === 1 ? 'semana' : 'semanas', `<span><b>${Math.floor(days / 7)}</b>semanas</span><span><b>${days % 7}</b>días</span><span><b>${days.toLocaleString('es')}</b>días en total</span>`]
    : unit === 'months' ? [months, months === 1 ? 'mes' : 'meses', ymd]
    : unit === 'hours' ? [Math.floor(mins / 60), 'horas', `<span><b>${days.toLocaleString('es')}</b>días</span><span><b>${Math.floor(mins / 60) % 24}</b>horas</span><span id="heroMin"><b>${mins % 60}</b>minutos</span>`]
    : [days, days === 1 ? 'día' : 'días', ymd];
  const bg = profile(uid()).prefs?.bg;
  return `<div class="glass hero">${bg ? `<img class="bgimg" data-photo="bg-${uid()}" alt=""><div class="bgshade"></div>` : ''}
    <div class="in"><div class="big grad-text" id="heroBig">${big.toLocaleString('es')}</div>
    <div class="muted">${word} ${esc(label)} · ${label === 'juntos' ? 'desde el ' : ''}${fmtDate(start)}</div>
    <div class="parts">${parts}</div></div></div>`;
}
// En modo "horas" el contador avanza solo mientras Inicio está abierto.
setInterval(() => {
  if (document.hidden || !S.me || counterFrom().unit !== 'hours' || !$('heroBig') || !$('s-home').classList.contains('active')) return;
  const mins = Math.max(0, Math.floor((Date.now() - parseDate(counterFrom().date).getTime()) / 60000));
  $('heroBig').textContent = Math.floor(mins / 60).toLocaleString('es');
  const m = $('heroMin'); if (m) m.innerHTML = `<b>${mins % 60}</b>minutos`;
}, 20000);

on('dates moments moods answers challenges trips profiles events thinks notes coupons lists quiz daily reminders songs snaps', renderHome);
on('thinks', checkIncomingThink);
expose({ sendThink, openFechas, answerQuestion, openAnswers, setMood, skipChallenge, doneChallenge });
