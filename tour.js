// Guía de bienvenida: aparece la primera vez que cada uno entra (y se puede repetir desde Ajustes).
import { $, S, esc, icon, expose, go, write, ref, profile, myName, uid } from './core.js';
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// Versión de la guía: si alguien ya vio una anterior, le sale una vez «Lo nuevo» (NEW_STEPS) en vez de la completa.
const TOUR_VERSION = 3;
const PET = { screen: 's-home', tab: 'home', emoji: '🐣', title: 'Su mascota',
  text: 'Adopten un huevo en Inicio. Come cada día que <b>los dos</b> hacen algo en Futari:', list: ['Nace a los 3 días y crece hasta leyenda 👑', 'Si un día no come se pone triste, pero no pierde lo que creció', 'Ganan monedas 🪙 para comprarle ropa y detalles', '4 juegos para competir por el récord'] };
const SNAPS = { screen: 's-home', tab: 'home', emoji: '📸', title: 'Instantáneas',
  text: 'Fotos rápidas para tu pareja, con texto encima si quieres. Duran 24 horas.', list: ['Se toman con la cámara de Futari, al instante', 'Reaccionen con ❤️😂😍🥺🔥 o respondan con otra foto', 'Guarden en Momentos las que quieran conservar'] };
const GUESS = { screen: 's-home', tab: 'home', emoji: '🔮', title: '¿Qué respondería tu pareja?',
  text: 'Cada día una pregunta con 4 opciones: respondes por ti y adivinas qué eligió tu pareja. Cuando responden los dos, se ve quién acertó (y la mascota gana monedas).' };
const WEEK = { emoji: '📊', title: 'Su semana', text: 'Los domingos en la noche les llega el resumen de la semana: días juntos, corazones, fotos y cómo les fue comparado con la semana anterior.' };
const NOTIFS = { emoji: '🔔', title: 'Notificaciones',
  text: 'Actívalas en <b>Ajustes → Notificaciones</b> y Futari te avisa aunque esté cerrada:', list: ['Cuando tu pareja te manda algo', 'Tus recordatorios, a su hora', 'En la noche, si la racha o la mascota están en peligro', 'Tú eliges qué avisos recibir'] };
const GESTURES = { emoji: '👆', title: 'Atajos', text: 'Para moverte más rápido:', list: ['Desliza a los lados para cambiar de pestaña', 'Arrastra hacia abajo las ventanas para cerrarlas', 'En Android, el botón atrás cierra ventanas y regresa', 'Mantén presionado el ícono de Futari para mandar una instantánea (Android)'] };

const CRAVINGS = { screen: 's-cravings', emoji: '🍓', title: 'Antojos',
  text: '¿Se te antojó algo? Pídeselo a tu pareja en dos toques:', list: ['😌 Cuando se pueda o 🔥 ¡Ya! (le llega un aviso llamativo)', 'Quien lo cumple puede mandar una foto de prueba 📸 y gana monedas para la mascota', '«Algún día»: antojos sin prisa que pasan al calendario', 'Ruleta para cuando no saben qué comer'] };
const MENU = { screen: 's-more', tab: 'more', emoji: '🧩', title: 'Tu menú',
  text: 'Arma tu barra de abajo con lo que más usas: en <b>Ajustes → Tu menú</b> eliges hasta 4 secciones para la barra, el orden de todo y qué esconder de Más. Cada uno tiene el suyo.' };

const STEPS = () => [
  { emoji: '💞', title: `¡Bienvenido${myName() ? ', ' + myName() : ''}!`,
    text: 'Esta es Futari (二人, «los dos» en japonés), su app de pareja. Todo lo que hagan aquí lo ven los dos al instante. Te muestro lo principal en un minuto.' },
  { tab: 'home', screen: 's-home', emoji: '🏠', title: 'Inicio',
    text: 'Su día a día juntos:', list: ['El contador de días juntos y su mascota', 'Hoy: lo pendiente de los dos y su racha 🔥', '¿Cómo te sientes?, la pregunta del día y ¿Qué respondería tu pareja?', 'Instantáneas, próximos momentos y fechas especiales'] },
  { tab: 'decide', screen: 's-decide', emoji: '🎲', title: 'Decidir',
    text: '¿No se ponen de acuerdo? Arman una lista y eligen:', list: ['Al azar', 'Eliminando por turnos', 'Match: cada uno vota en su teléfono y solo quedan las coincidencias', 'Además, más de 100 ideas de citas'] },
  { tab: 'moments', screen: 's-moments', emoji: '📸', title: 'Momentos',
    text: 'Su historia con fotos:', list: ['Línea de tiempo con los momentos importantes', 'Foto del día: cada uno sube una foto diaria; la de tu pareja se revela cuando subes la tuya', 'Instantáneas de las últimas 24 horas', 'Galería con todas las fotos'] },
  { tab: 'love', screen: 's-love', emoji: '💌', title: 'Detalles',
    text: 'Para consentirse:', list: ['Frasco de notas: escribes para tu pareja y ella saca una cuando quiera', 'Cupones canjeables: "vale por un masaje"…'] },
  { tab: 'more', screen: 's-more', emoji: '✨', title: 'Más',
    text: 'Todo lo demás (y puedes ordenarlo o pasar lo que más usas a la barra de abajo):', list: ['Antojos, súper, gastos y viajes con búsqueda de hospedaje', 'Calendario con fechas especiales y recordatorios con aviso', 'Recetas, nuestro mapa, su playlist y pelis por ver', 'Juego de retos, quiz, gustos y regalos', 'Logros y el resumen del año'] },
  PET, SNAPS, GUESS, CRAVINGS, MENU, WEEK, NOTIFS, GESTURES,
  { emoji: '🔴', title: 'Los puntitos',
    text: `Cuando hay algo pendiente para ti (una nota nueva, una instantánea, un voto) aparece un puntito en la barra de abajo. Y con la lupa ${icon('search')} de arriba encuentras cualquier cosa.` },
  standalone()
    ? { emoji: '⚙️', title: '¡Listo!', text: 'Empieza poniendo tu nombre, la fecha en que empezaron y tu foto en Ajustes. Ahí también activas las notificaciones y un PIN para proteger la app.', final: true }
    : { emoji: '📲', title: 'Instálala en tu teléfono', final: true,
        text: isIOS() ? 'En Safari toca el botón Compartir y luego "Agregar a pantalla de inicio". Así se abre como una app, funciona sin internet y puede mandarte notificaciones.'
                      : 'En Chrome toca el menú ⋮ y luego "Instalar app" o "Agregar a pantalla principal". Así se abre como una app, funciona sin internet y puede mandarte notificaciones.' },
];
// Solo lo nuevo, para quien ya conocía la app
// Lo nuevo de cada versión de la guía; a quien se saltó varias le salen todas las que no vio
const NEW_BY_VERSION = { 2: [PET, SNAPS, GUESS, WEEK, NOTIFS, GESTURES], 3: [CRAVINGS, MENU] };
const NEW_STEPS = seenV => [
  { emoji: '✨', title: 'Lo nuevo en Futari', text: `${myName() ? esc(myName()) + ', a' : 'A'}gregamos ${seenV >= TOUR_VERSION - 1 ? 'algo' : 'varias cosas'}. Te ${seenV >= TOUR_VERSION - 1 ? 'lo' : 'las'} muestro en un minuto.` },
  ...Object.entries(NEW_BY_VERSION).filter(([v]) => Number(v) > seenV).flatMap(([, s]) => s),
  { emoji: '💞', title: '¡Eso es todo!', text: 'La guía completa siempre está en Ajustes → «Ver la guía otra vez».', final: true },
];

let i = 0, steps = [];
function show() {
  const s = steps[i];
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('spot', !!s.screen && b.dataset.tab === s.screen));
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
export function startTour(onlyNew = false, seenV = 1) { steps = onlyNew === true ? NEW_STEPS(seenV) : STEPS(); i = 0; show(); }
function tourGo(d) { i = Math.max(0, Math.min(steps.length - 1, i + d)); show(); }
function tourEnd(finished) {
  $('tour')?.remove();
  document.querySelectorAll('.tabbar .spot').forEach(b => b.classList.remove('spot'));
  try { localStorage.setItem('nosotros-tour', '1'); localStorage.setItem('futari-tour-v', String(TOUR_VERSION)); } catch {}
  write(setDoc(ref('profiles', uid()), { prefs: { tour: true, tourV: TOUR_VERSION } }, { merge: true }));
  go(finished && !myName() ? 's-settings' : 's-home');
}
// Se llama cuando ya cargó el perfil: si nunca vio la guía (ni en este ni en otro teléfono), la muestra.
let checked = false;
export function maybeStartTour() {
  if (checked || !S.me) return;
  checked = true;
  let seen = false, seenV = 0; try { seen = localStorage.getItem('nosotros-tour') === '1'; seenV = Number(localStorage.getItem('futari-tour-v')) || 0; } catch {}
  const prefs = profile(uid()).prefs || {};
  if (!seen && !prefs.tour) return setTimeout(startTour, 400);
  // Ya conocía la app: mostrar una vez lo nuevo, cuando no haya otra ventana abierta (por ejemplo las Novedades)
  const v = Math.max(seenV, prefs.tourV || 1);
  if (v < TOUR_VERSION) {
    let tries = 0;
    const later = () => { if ($('sheet')?.classList.contains('show') || $('lockScreen') || document.querySelector('.dialog')) { if (++tries < 120) setTimeout(later, 1000); return; } startTour(true, v); };
    setTimeout(later, 1500);
  }
}
export function resetTourCheck() { checked = false; }

expose({ startTour, tourGo, tourEnd });
