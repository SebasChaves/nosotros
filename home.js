// Inicio: contador, ánimo del día, pregunta del día, reto de la semana, próximas fechas y "un día como hoy".
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, coupleRef, loadPhotos, profile,
  parseDate, today, daysBetween, fmtDate, fmtShort, dayKey, todayKey, whenText, addMonths, weekKey, epochDay, DAY,
  nameOf, partnerUid, partnerName, myName, plural, uid, avatar, ask } from './core.js';
import { QUESTIONS, MOODS, CHALLENGES, DATE_KINDS } from './data.js';

/* ---------- Fechas especiales ---------- */
export function nextOccurrence(f) {
  const d = parseDate(f.date), now = today();
  if (!f.yearly) return d >= now ? d : null;
  let n = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (n < now) n = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return n;
}
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
  for (const ev of S.data.events) if (ev.date && parseDate(ev.date) >= now) list.push({ label: `📌 ${ev.title}${ev.time ? ' · ' + ev.time : ''}`, date: parseDate(ev.date) });
  return list.sort((a, b) => a.date - b.date);
}
function openFechas() {
  const items = [...S.data.dates].sort((a, b) => (nextOccurrence(a) || 9e15) - (nextOccurrence(b) || 9e15));
  openSheet(`<div class="stack">
    <h2>Fechas especiales</h2>
    <ul class="list">${items.length ? items.map(f => {
      const occ = nextOccurrence(f);
      return `<li><div class="txt">${esc(f.emoji)} ${esc(f.title)}<span class="sub">${fmtDate(parseDate(f.date))}${f.yearly ? ' · cada año' : ''} · ${occ ? whenText(daysBetween(today(), occ)) : 'ya pasó'}</span></div>
        <button class="del" aria-label="Borrar" onclick="delFecha('${f.id}')">${icon('trash')}</button></li>`;
    }).join('') : '<li class="empty">Aún no hay fechas</li>'}</ul>
    <h2 style="margin-top:6px">Agregar</h2>
    <div class="grid2">
      <select id="fechaKind" aria-label="Tipo" onchange="document.getElementById('fechaYearly').checked=['🎂','💍'].includes(this.value)">
        ${DATE_KINDS.map(([e, l]) => `<option value="${e}">${e} ${l}</option>`).join('')}</select>
      <input type="date" id="fechaDate" aria-label="Fecha">
    </div>
    <input id="fechaTitle" placeholder="Ej: Cumpleaños de mamá" maxlength="60" aria-label="Nombre">
    <label class="check"><input type="checkbox" id="fechaYearly" checked> Se repite cada año</label>
    <button class="btn" onclick="addFecha()">Guardar fecha</button>
  </div>`);
}
function addFecha() {
  const title = $('fechaTitle').value.trim(), date = $('fechaDate').value;
  if (!title || !date) return toast('Pon un nombre y una fecha');
  write(setDoc(newRef('dates'), { title, date, emoji: $('fechaKind').value, yearly: $('fechaYearly').checked, by: uid() }));
  closeSheet(); toast('Fecha guardada');
}
async function delFecha(id) { if (await ask('¿Borrar esta fecha?')) { write(deleteDoc(ref('dates', id))); closeSheet(); } }

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
  toast('¡Reto cumplido! 🏆');
}

/* ---------- Un día como hoy ---------- */
function memoryCard() {
  const now = today(), md = dayKey(now).slice(5);
  const m = S.data.moments.filter(x => x.date?.slice(5) === md && Number(x.date.slice(0, 4)) < now.getFullYear()).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!m) return '';
  const years = now.getFullYear() - Number(m.date.slice(0, 4));
  return `<div class="glass"><span class="label">${icon('spark')} Un día como hoy</span>
    <div class="memory" style="margin-top:10px">${m.hasPhoto ? `<img data-photo="${m.id}" alt="">` : ''}
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
  } else {
    const start = parseDate(S.settings.start), now = today(), days = daysBetween(start, now);
    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (addMonths(start, months) > now) months--;
    months = Math.max(0, months);
    const bg = profile(uid()).prefs?.bg;
    hero = `<div class="glass hero">${bg ? `<img class="bgimg" data-photo="bg-${uid()}" alt=""><div class="bgshade"></div>` : ''}
      <div class="in"><div class="big grad-text">${days.toLocaleString('es')}</div>
      <div class="muted">días juntos · desde el ${fmtDate(start)}</div>
      <div class="parts"><span><b>${Math.floor(months / 12)}</b>años</span><span><b>${months % 12}</b>meses</span><span><b>${Math.max(0, daysBetween(addMonths(start, months), now))}</b>días</span></div></div></div>`;
  }
  const up = upcoming().slice(0, 5);
  paint('s-home', `
    <div class="topbar"><div class="title"><span class="hi">Hola${myName() ? ', ' + esc(myName()) : ''}</span><h1>Nosotros</h1></div>
      <div class="row" style="gap:10px"><div class="avatars">${names.map(([id]) => avatar(id, 36)).join('')}</div>
      <button class="icon-btn" onclick="go('s-settings')" aria-label="Ajustes">${icon('gear')}</button></div></div>
    ${hero}
    ${memoryCard()}
    ${moodCard()}
    ${questionCard()}
    ${challengeCard()}
    <div class="glass"><div class="row"><span class="label">${icon('cal')} Próximos momentos</span>
      <div class="row" style="gap:0"><button class="link" onclick="go('s-cal')">Calendario</button><button class="link" onclick="openFechas()">Fechas</button></div></div>
      <div style="margin-top:6px">${up.length ? up.map(m => `<div class="event"><div>${esc(m.label)}<div class="tiny muted">${fmtDate(m.date)}</div></div>
        <span class="when">${whenText(daysBetween(today(), m.date))}</span></div>`).join('') : '<p class="empty">Agreguen cumpleaños, viajes o eventos</p>'}</div></div>
  `);
  loadPhotos($('s-home'));
}

on('dates moments moods answers challenges trips profiles events', renderHome);
expose({ openFechas, addFecha, delFecha, answerQuestion, openAnswers, setMood, skipChallenge, doneChallenge });
