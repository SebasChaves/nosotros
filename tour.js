// Guía de bienvenida: aparece la primera vez que cada uno entra (y se puede repetir desde Ajustes).
import { $, S, esc, icon, expose, go, write, ref, profile, myName, uid } from './core.js';
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const STEPS = () => [
  { emoji: '💞', title: `¡Bienvenido${myName() ? ', ' + myName() : ''}!`,
    text: 'Esta es su app de pareja. Todo lo que hagan aquí lo ven los dos al instante. Te muestro lo principal en un minuto.' },
  { tab: 'home', screen: 's-home', emoji: '🏠', title: 'Inicio',
    text: 'Su día a día juntos:', list: ['El contador de días juntos', '¿Cómo te sientes hoy? y la pregunta del día', 'El reto de la semana', 'Próximos momentos y fechas especiales'] },
  { tab: 'decide', screen: 's-decide', emoji: '🎲', title: 'Decidir',
    text: '¿No se ponen de acuerdo? Arman una lista y eligen:', list: ['Al azar', 'Eliminando por turnos', 'Match: cada uno vota en su teléfono y solo quedan las coincidencias', 'Además, más de 100 ideas de citas'] },
  { tab: 'moments', screen: 's-moments', emoji: '📸', title: 'Momentos',
    text: 'Su historia con fotos, ordenada por año. Arriba está la galería con todas las fotos.' },
  { tab: 'love', screen: 's-love', emoji: '💌', title: 'Detalles',
    text: 'Para consentirse:', list: ['Frasco de notas: escribes para tu pareja y ella saca una cuando quiera', 'Cupones canjeables: "vale por un masaje"…'] },
  { tab: 'more', screen: 's-more', emoji: '✨', title: 'Más',
    text: 'Todo lo demás: súper, gastos compartidos, viajes con búsqueda de hospedaje, pelis y series, calendario, juego de retos, gustos y regalos, quiz y el resumen del año.' },
  { emoji: '🔴', title: 'Los puntitos',
    text: `Cuando hay algo pendiente para ti (una nota nueva, un voto, un cupón canjeado) aparece un puntito en la barra de abajo. Y con la lupa ${icon('search')} de arriba encuentras cualquier cosa.` },
  standalone()
    ? { emoji: '⚙️', title: '¡Listo!', text: 'Empieza poniendo tu nombre, la fecha en que empezaron y tu foto en Ajustes.', final: true }
    : { emoji: '📲', title: 'Instálala en tu teléfono', final: true,
        text: isIOS() ? 'En Safari toca el botón Compartir y luego "Agregar a pantalla de inicio". Así se abre como una app y funciona sin internet.'
                      : 'En Chrome toca el menú ⋮ y luego "Instalar app" o "Agregar a pantalla principal". Así se abre como una app y funciona sin internet.' },
];

let i = 0, steps = [];
function show() {
  const s = steps[i];
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('spot', !!s.tab && b.dataset.tab === s.tab));
  if (s.screen) go(s.screen);
  let el = $('tour');
  if (!el) { el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; document.body.appendChild(el); }
  el.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
    <div class="emoji">${s.emoji}</div><h2 id="tourTitle">${esc(s.title)}</h2><p>${s.text}</p>
    ${s.list ? `<ul>${s.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="steps">${steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="grid2">${i === 0 ? `<button class="btn ghost" onclick="tourEnd()">Saltar</button>` : `<button class="btn ghost" onclick="tourGo(-1)">Atrás</button>`}
      <button class="btn" onclick="${s.final ? 'tourEnd(true)' : 'tourGo(1)'}">${s.final ? (myName() ? '¡A usarla!' : 'Ir a Ajustes') : 'Siguiente'}</button></div></div>`;
  el.querySelector('.card .btn:not(.ghost)').focus({ preventScroll: true });
}
export function startTour() { steps = STEPS(); i = 0; show(); }
function tourGo(d) { i = Math.max(0, Math.min(steps.length - 1, i + d)); show(); }
function tourEnd(finished) {
  $('tour')?.remove();
  document.querySelectorAll('.tabbar .spot').forEach(b => b.classList.remove('spot'));
  try { localStorage.setItem('nosotros-tour', '1'); } catch {}
  write(setDoc(ref('profiles', uid()), { prefs: { tour: true } }, { merge: true }));
  go(finished && !myName() ? 's-settings' : 's-home');
}
// Se llama cuando ya cargó el perfil: si nunca vio la guía (ni en este ni en otro teléfono), la muestra.
let checked = false;
export function maybeStartTour() {
  if (checked || !S.me) return;
  checked = true;
  let seen = false; try { seen = localStorage.getItem('nosotros-tour') === '1'; } catch {}
  if (!seen && !profile(uid()).prefs?.tour) setTimeout(startTour, 400);
}
export function resetTourCheck() { checked = false; }

expose({ startTour, tourGo, tourEnd });
