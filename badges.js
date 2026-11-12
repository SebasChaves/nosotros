// Logros: medallas que se desbloquean solas según lo que hacen en la app.
import { $, S, esc, paint, on, onShow, expose, toast, celebrate, parseDate, today, daysBetween, partnerUid, plural, uid } from './core.js';
import { backBar } from './lists.js';
import { bestStreak } from './home.js';
import { dailyBothDays } from './daily.js';
import { cookedCount } from './recipes.js';

const D = () => S.data;
const p = () => partnerUid();
const bothAnswered = () => D().answers.filter(a => a.answers?.[uid()] && p() && a.answers?.[p()]).length;
const matches = () => D().lists.filter(l => { const v = l.votes || {}, a = v[uid()], b = p() && v[p()]; return a && b && (l.options || []).some(o => a[o] && b[o]); }).length;
const quizDone = () => D().quiz.filter(r => Object.keys(r.guesses?.[uid()] || {}).length >= r.qs.length && p() && Object.keys(r.guesses?.[p()] || {}).length >= r.qs.length);
const visits = () => D().places.reduce((s, x) => s + (x.visits || []).length, 0);
const daysTogether = () => S.settings.start ? daysBetween(parseDate(S.settings.start), today()) : 0;
const hearts = () => D().thinks.reduce((s, t) => s + Object.entries(t).filter(([k]) => k !== 'id').reduce((a, [, v]) => a + (Number(v) || 0), 0), 0);
const countries = () => new Set(D().pins.map(x => x.country).filter(Boolean)).size;

// [id, emoji, nombre, descripción, progreso(), meta]
const BADGES = [
  ['note-1', '💌', 'Primera nota', 'Escribir la primera nota de amor', () => D().notes.length, 1],
  ['note-50', '💌', 'Cartero del amor', '50 notas en el frasco', () => D().notes.length, 50],
  ['heart-100', '❤️', '100 corazones', 'Mandar 100 "pensando en ti" entre los dos', hearts, 100],
  ['streak-7', '🔥', 'Una semana juntos', 'Racha de 7 días', bestStreak, 7],
  ['streak-30', '🔥', 'Un mes sin fallar', 'Racha de 30 días', bestStreak, 30],
  ['streak-100', '☄️', 'Imparables', 'Racha de 100 días', bestStreak, 100],
  ['q-10', '💬', 'Buenas pláticas', '10 preguntas del día respondidas por los dos', bothAnswered, 10],
  ['q-100', '🗣️', 'Se lo saben todo', '100 preguntas del día respondidas por los dos', bothAnswered, 100],
  ['daily-7', '📷', 'Una semana en fotos', '7 días con foto del día de los dos', dailyBothDays, 7],
  ['daily-30', '🎞️', 'Álbum de un mes', '30 días con foto del día de los dos', dailyBothDays, 30],
  ['moment-1', '📸', 'Primer recuerdo', 'Guardar el primer momento', () => D().moments.length, 1],
  ['moment-25', '📚', 'Historia larga', '25 momentos guardados', () => D().moments.length, 25],
  ['match-1', '💞', 'Pensamos igual', 'Coincidir en un match de Decidir', matches, 1],
  ['quiz-5', '🧠', 'Se conocen', 'Jugar 5 rondas del quiz', () => quizDone().length, 5],
  ['coupon-1', '🎟️', 'Vale cumplido', 'Canjear el primer cupón', () => D().coupons.filter(c => c.redeemedAt).length, 1],
  ['coupon-10', '🎁', 'Consentidos', '10 cupones canjeados', () => D().coupons.filter(c => c.redeemedAt).length, 10],
  ['bucket-1', '✅', 'Sueño cumplido', 'Tachar el primer sueño de la bucket list', () => D().bucket.filter(b => b.done).length, 1],
  ['bucket-10', '🌟', 'Soñadores', '10 sueños cumplidos', () => D().bucket.filter(b => b.done).length, 10],
  ['challenge-10', '🏆', 'Retadores', 'Cumplir 10 retos de la semana', () => D().challenges.filter(c => c.doneAt).length, 10],
  ['game-10', '🎭', 'Fiesteros', 'Jugar 10 partidas del juego de retos', () => D().games.length, 10],
  ['trip-1', '✈️', 'Primer viaje', 'Planear el primer viaje juntos', () => D().trips.length, 1],
  ['trip-3', '🧳', 'Trotamundos', '3 viajes juntos', () => D().trips.length, 3],
  ['map-10', '🗺️', 'Exploradores', '10 lugares en el mapa', () => D().pins.length, 10],
  ['country-3', '🌎', 'Internacionales', 'Lugares en 3 países', countries, 3],
  ['food-10', '🍽️', 'Foodies', '10 salidas a comer registradas', visits, 10],
  ['cook-10', '👩‍🍳', 'Chefs en casa', '10 recetas en el menú', cookedCount, 10],
  ['shows-25', '🍿', 'Cinéfilos', '25 pelis o series vistas', () => D().shows.filter(s => s.status === 'seen').length, 25],
  ['songs-10', '🎵', 'Su banda sonora', '10 canciones en la playlist', () => D().songs.length, 10],
  ['plans-10', '🗓️', 'Agenda llena', '10 planes en el calendario', () => D().events.length, 10],
  ['days-365', '💍', 'Un año juntos', '365 días juntos', daysTogether, 365],
  ['days-1000', '🎉', 'Mil días', '1.000 días juntos', daysTogether, 1000],
];
export const badgeState = () => BADGES.map(([id, e, name, desc, fn, goal]) => { let n = 0; try { n = Number(fn()) || 0; } catch {} return { id, e, name, desc, n: Math.min(n, goal), goal, done: n >= goal }; });
export const badgeCount = () => { const s = badgeState(); return [s.filter(b => b.done).length, s.length]; };

// Avisos de logros nuevos. Se empieza a vigilar unos segundos después de entrar, cuando ya llegaron los datos.
let ready = false;
const key = () => `futari-badges-${uid()}`;
function check() {
  if (!ready || !S.me) return;
  const done = badgeState().filter(b => b.done);
  let seen = null; try { seen = JSON.parse(localStorage.getItem(key())); } catch {}
  if (!seen) { try { localStorage.setItem(key(), JSON.stringify(done.map(b => b.id))); } catch {} return; }
  const fresh = done.filter(b => !seen.includes(b.id));
  if (!fresh.length) return;
  try { localStorage.setItem(key(), JSON.stringify([...seen, ...fresh.map(b => b.id)])); } catch {}
  toast(`🏅 Logro: ${fresh[0].e} ${fresh[0].name}${fresh.length > 1 ? ` y ${fresh.length - 1} más` : ''}`);
  celebrate();
}
let timer = null;
export function startBadgeWatch() { ready = false; clearTimeout(timer); timer = setTimeout(() => { ready = true; check(); }, 4000); }
const debounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(check, 800); }; })();

function render() {
  const s = badgeState(), done = s.filter(b => b.done).length;
  paint('s-badges', `${backBar('Logros')}
    <div class="glass center stack"><div class="money grad-text">${done} de ${s.length}</div><div class="progress"><i style="width:${Math.round(done / s.length * 100)}%"></i></div>
      <span class="small muted">Se desbloquean solos mientras usan la app</span></div>
    <div class="badges">${[...s].sort((a, b) => b.done - a.done || (b.n / b.goal) - (a.n / a.goal)).map(b => `
      <div class="badge-card ${b.done ? 'on' : ''}"><div class="be">${b.e}</div><b>${esc(b.name)}</b><span class="tiny muted">${esc(b.desc)}</span>
        ${b.done ? '<span class="pill ok">Desbloqueado</span>' : `<div class="progress" style="height:6px"><i style="width:${Math.round(b.n / b.goal * 100)}%"></i></div><span class="tiny muted">${b.n} / ${b.goal}</span>`}</div>`).join('')}</div>`);
}

on('notes thinks answers daily moments lists quiz coupons bucket challenges games trips pins places menu shows songs events moods', debounced);
on('notes thinks answers daily moments lists quiz coupons bucket challenges games trips pins places menu shows songs events', () => { if ($('s-badges').classList.contains('active')) render(); });
onShow('s-badges', render);
expose({});
