// Resumen de la semana (lunes a domingo): tarjeta en Inicio los domingos (semana actual) y lunes (la que terminó),
// y una hoja con los números, la comparación con la semana anterior y un mosaico de sus fotos.
// El Worker manda el aviso los domingos a las 19:00 (notificaciones/worker.js → runSchedule).
import { S, esc, openSheet, loadPhotos, today, dayKey, parseDate, nameOf, partnerUid, uid, $ } from './core.js';
import { bothDid } from './home.js';
import { guessScore } from './guess.js';
import { dailyPhotoId } from './daily.js';
import { cravingsDoneBetween } from './cravings.js';

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Lunes de la semana de esa fecha
export const weekStart = (d = today()) => addDays(d, -((d.getDay() + 6) % 7));
// Semana a mostrar: el domingo la actual; el lunes la que acaba de terminar
export const shownWeek = () => { const d = today(); return d.getDay() === 1 ? addDays(weekStart(d), -7) : weekStart(d); };
export const showWeekCard = () => [0, 1].includes(today().getDay());

export function weekStats(start = shownWeek()) {
  const days = [...Array(7)].map((_, i) => dayKey(addDays(start, i))), from = days[0], to = days[6];
  const inWeek = k => k >= from && k <= to, msIn = ms => ms && inWeek(dayKey(new Date(ms)));
  const p = partnerUid(), D = S.data, ids = [uid(), p].filter(Boolean);
  const per = f => Object.fromEntries(ids.map(id => [id, f(id)]));
  const hearts = per(id => D.thinks.filter(t => inWeek(t.id)).reduce((s, t) => s + (Number(t[id]) || 0), 0));
  const moods = per(id => { const c = {}; for (const m of D.moods) if (inWeek(m.id) && m[id]?.e) c[m[id].e] = (c[m[id].e] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; });
  return {
    days, from, to,
    together: days.filter(k => k <= dayKey(today()) && bothDid(k)).length,
    hearts, heartsTotal: Object.values(hearts).reduce((a, b) => a + b, 0),
    answers: D.answers.filter(a => inWeek(a.id) && ids.every(id => a.answers?.[id])).length,
    guesses: per(id => guessScore(id, from) - guessScore(id, dayKey(addDays(start, 7)))),
    notes: D.notes.filter(n => msIn(n.createdAt)).length,
    dailies: D.daily.filter(d => inWeek(d.id)).reduce((s, d) => s + ids.filter(id => d[id]).length, 0),
    moments: D.moments.filter(m => msIn(m.createdAt)).length,
    cravings: cravingsDoneBetween(from, to),
    moods,
    photos: D.daily.filter(d => inWeek(d.id)).flatMap(d => ids.filter(id => d[id]).map(id => dailyPhotoId(d.id, id))).slice(0, 9),
  };
}
const fmtRange = (a, b) => `${parseDate(a).toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${parseDate(b).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`;
const delta = (now, before) => now === before ? '' : `<span class="tiny ${now > before ? 'up' : 'down'}">${now > before ? '▲' : '▼'} ${Math.abs(now - before)}</span>`;

export function weekCard() {
  if (!showWeekCard() || !partnerUid()) return '';
  const w = weekStats(), mon = today().getDay() === 1;
  return `<div class="glass stack week-card"><div class="row"><span class="label">📊 ${mon ? 'Su semana pasada' : 'Su semana'}</span><span class="tiny muted">${fmtRange(w.from, w.to)}</span></div>
    <div class="week-kpis"><div><b class="num">${w.together}/7</b><span class="tiny muted">días juntos 🔥</span></div><div><b class="num">${w.heartsTotal}</b><span class="tiny muted">corazones ❤️</span></div><div><b class="num">${w.answers}</b><span class="tiny muted">preguntas 💬</span></div></div>
    <button class="btn ghost small" onclick="openWeek()">Ver el resumen completo</button></div>`;
}
export function openWeek() {
  const start = shownWeek(), w = weekStats(start), prev = weekStats(addDays(start, -7)), p = partnerUid(), pn = esc(nameOf(p));
  const row = (e, label, now, before) => `<div class="week-row"><span>${e} ${label}</span><b class="num">${now}</b>${typeof now === 'number' ? delta(now, before) : '<span></span>'}</div>`;
  openSheet(`<div class="stack"><h2>📊 Su semana en Futari</h2><p class="small muted" style="margin:0">${fmtRange(w.from, w.to)} · comparado con la semana anterior</p>
    ${w.photos.length ? `<div class="week-mosaic">${w.photos.map(id => `<img data-thumb="${id}" alt="">`).join('')}</div>` : ''}
    <div class="stack" style="gap:6px">
      ${row('🔥', 'Días que los dos cumplieron', w.together, prev.together)}
      ${row('❤️', 'Corazones', w.heartsTotal, prev.heartsTotal)}
      ${row('💬', 'Preguntas respondidas por los dos', w.answers, prev.answers)}
      ${row('🔮', `Aciertos (tú · ${pn})`, `${w.guesses[uid()] || 0} · ${w.guesses[p] || 0}`, `${prev.guesses[uid()] || 0} · ${prev.guesses[p] || 0}`)}
      ${row('📷', 'Fotos del día', w.dailies, prev.dailies)}
      ${row('💌', 'Notas', w.notes, prev.notes)}
      ${row('📚', 'Momentos guardados', w.moments, prev.moments)}
      ${row('🍓', 'Antojos cumplidos', w.cravings, prev.cravings)}
    </div>
    <p class="small" style="margin:0">❤️ Corazones: tú ${w.hearts[uid()] || 0} · ${pn} ${w.hearts[p] || 0}${w.moods[uid()] || w.moods[p] ? ` · Ánimo más común: tú ${w.moods[uid()] || '—'} · ${pn} ${w.moods[p] || '—'}` : ''}</p>
    <p class="small center" style="margin:0">${w.together >= 6 ? '¡Semana increíble! 🏆' : w.together >= 4 ? '¡Buena semana! Sigan así 💪' : 'La próxima semana le ponemos más ganas 💕'}</p></div>`);
  loadPhotos($('sheet'));
}
window.openWeek = openWeek;
