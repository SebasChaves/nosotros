// Resumen del año: sus números juntos, al estilo de una historia.
import { $, S, esc, icon, paint, on, onShow, expose, loadPhotos, parseDate, today, daysBetween,
         fmtMoney, nameOf, partnerUid, partnerName, myName, plural, uid } from './core.js';
import { backBar } from './lists.js';

let year = new Date().getFullYear();
const inYear = (ms, y) => ms && new Date(ms).getFullYear() === y;
const dIn = (s, y) => s && s.startsWith(String(y));

function stats(y) {
  const D = S.data, me = uid(), p = partnerUid();
  const start = S.settings.start ? parseDate(S.settings.start) : null;
  const yStart = new Date(y, 0, 1), yEnd = y === today().getFullYear() ? today() : new Date(y, 11, 31);
  const from = start && start > yStart ? start : yStart;
  const together = start && start <= yEnd ? daysBetween(from, yEnd) + 1 : 0;
  const moments = D.moments.filter(m => dIn(m.date, y));
  const moodCount = who => { const c = {}; D.moods.filter(m => dIn(m.id, y)).forEach(m => { const e = m[who]?.e; if (e) c[e] = (c[e] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const quizRounds = D.quiz.filter(r => inYear(r.createdAt, y) && Object.keys(r.guesses?.[me] || {}).length && Object.keys(r.guesses?.[p] || {}).length);
  return {
    together, moments: moments.length, photos: moments.filter(m => m.hasPhoto),
    notesMe: D.notes.filter(n => n.fromUid === me && inYear(n.createdAt, y)).length,
    notesThem: D.notes.filter(n => n.fromUid !== me && inYear(n.createdAt, y)).length,
    coupons: D.coupons.filter(c => inYear(c.redeemedAt, y)).length,
    answers: D.answers.filter(a => dIn(a.id, y) && a.answers?.[me] && p && a.answers?.[p]).length,
    challenges: D.challenges.filter(c => c.doneAt && inYear(c.doneAt, y)).length,
    bucket: D.bucket.filter(b => b.done && inYear(b.doneAt, y)).length,
    places: D.places.reduce((s, pl) => s + (pl.visits || []).filter(v => dIn(v.date, y)).length, 0),
    trips: D.trips.filter(t => dIn(t.start, y)),
    spent: D.expenses.filter(e => e.type !== 'settle' && dIn(e.date, y)).reduce((s, e) => s + e.amount, 0),
    moodMe: moodCount(me), moodThem: p && moodCount(p),
    quiz: quizRounds.length,
  };
}

function render() {
  const years = new Set([today().getFullYear()]);
  if (S.settings.start) for (let y = parseDate(S.settings.start).getFullYear(); y <= today().getFullYear(); y++) years.add(y);
  const s = stats(year), pn = esc(partnerName()), mn = esc(myName() || 'Tú');
  const cover = s.photos.sort((a, b) => b.date.localeCompare(a.date))[0];
  const card = (big, text, extra = '') => `<div class="glass story"><div class="big grad-text">${big}</div><p class="muted" style="margin:6px 0 0">${text}</p>${extra}</div>`;
  const parts = [];
  parts.push(card(s.together.toLocaleString('es'), `días juntos en ${year}`));
  if (cover) parts.push(`<div class="glass story"><span class="label" style="justify-content:center">${icon('photo')} El momento del año</span>
    <img data-photo="${cover.id}" alt=""><h2 style="margin-top:12px">${esc(cover.title)}</h2></div>`);
  if (s.moments) parts.push(card(s.moments, `${s.moments === 1 ? 'momento guardado' : 'momentos guardados'}, ${plural(s.photos.length, 'con foto', 'con foto')}`));
  if (s.notesMe + s.notesThem) parts.push(card(s.notesMe + s.notesThem, `notas de amor: ${mn} escribió ${s.notesMe} y ${pn} ${s.notesThem}`));
  if (s.answers) parts.push(card(s.answers, 'preguntas del día respondidas por los dos'));
  if (s.trips.length) parts.push(card(s.trips.length, `${s.trips.length === 1 ? 'viaje' : 'viajes'}: ${s.trips.map(t => esc(t.name)).join(', ')}`));
  if (s.places) parts.push(card(s.places, 'salidas a comer registradas'));
  const small = [
    [s.challenges, 'retos cumplidos'], [s.bucket, 'sueños de la bucket list cumplidos'], [s.coupons, 'cupones canjeados'], [s.quiz, 'rondas del quiz'],
  ].filter(x => x[0]);
  if (small.length) parts.push(`<div class="grid2">${small.map(([n, t]) => `<div class="glass center"><div class="money grad-text">${n}</div><div class="small muted">${t}</div></div>`).join('')}</div>`);
  if (s.moodMe || s.moodThem) parts.push(`<div class="glass story"><span class="label" style="justify-content:center">Su ánimo más frecuente</span>
    <div class="grid2" style="margin-top:12px"><div><div style="font-size:46px">${s.moodMe || '·'}</div><div class="small muted">${mn}</div></div>
    <div><div style="font-size:46px">${s.moodThem || '·'}</div><div class="small muted">${pn}</div></div></div></div>`);
  if (s.spent) parts.push(card(fmtMoney(s.spent), 'gastados juntos (según Gastos)'));
  paint('s-summary', `${backBar(`Su ${year}`)}
    <div class="chips scroll">${[...years].sort((a, b) => b - a).map(y => `<button class="chip ${y === year ? 'on' : ''}" onclick="setYear(${y})">${y}</button>`).join('')}</div>
    ${parts.join('')}
    <p class="small muted center" style="margin:0">Mientras más usen la app, más completo queda su resumen.</p>`);
  loadPhotos($('s-summary'));
}
function setYear(y) { year = y; render(); }

on('moments notes coupons answers challenges bucket places trips expenses moods quiz', () => { if ($('s-summary').classList.contains('active')) render(); });
onShow('s-summary', render);
expose({ setYear });
