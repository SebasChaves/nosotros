// Guía de Gastos: pantallas con ejemplos (y una práctica para anotar un gasto «de mentira»). Sale sola la primera vez que
// cada uno entra a Gastos (profiles/<uid>.prefs.moneyTour) y se puede volver a ver con «📖 Cómo funciona» (en Gastos,
// en la tarjeta de Inicio y en el buscador). No guarda nada más que eso.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, esc, expose, write, ref, uid, profile, onShow, syncBack, fmtMoney, partnerName, S } from './core.js';

const C = () => (S.settings.currency || 'USD') === 'CRC';
const m = n => fmtMoney(C() ? n : Math.round(n / 500)); // montos de ejemplo razonables en colones o en dólares
const pn = () => esc(partnerName() || 'tu pareja');
// Pedacitos de interfaz de ejemplo (con las mismas clases de la app, para que se vea igual)
const thermo = (spent, budget, days) => {
  const pct = spent / budget, t = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok', left = budget - spent;
  return `<div class="mt-demo"><div class="thermo ${t}"><i style="width:${Math.min(100, Math.round(pct * 100))}%"></i></div>
    <div class="row small"><span><b>${m(spent)}</b> <span class="muted">de ${m(budget)}</span></span><span class="${left < 0 ? 'bad' : 'muted'}">${left >= 0 ? `quedan <b>${m(left)}</b>` : `se pasaron <b>${m(-left)}</b>`} · faltan ${days} días</span></div></div>`;
};
const chip = t => `<span class="chip">${t}</span>`;
const ex = (title, html) => `<div class="mt-ex"><span class="mt-ex-t">💡 ${title}</span>${html}</div>`;

const SLIDES = () => [
  { e: '💸', t: 'Gastos, en 3 segundos', body: `<p>Esta sección es para saber <b>en qué se va la plata</b> (sobre todo comida, salidas y fiestas) y gastar menos sin que sea un castigo.</p>
    <ul class="mt-list"><li>⌨️ <b>Anotar rápido</b>: el monto y un toque</li><li>🎉 <b>Salimos</b>: todo lo de una salida, junto</li><li>📊 <b>Presupuesto de la semana</b> con termómetro</li><li>🐷 <b>Alcancías</b>: lo que sobra se ahorra solo</li><li>🏦 <b>Desde el aviso del banco</b>: casi sin escribir</li></ul>
    <p class="tiny muted">Te lo muestro con ejemplos. Son ${SLIDES_N} pasos cortos.</p>` },
  { e: '⌨️', t: 'Anotar un gasto', body: `<p>Toca <b>«+ Anotar gasto»</b> (en Inicio o en Gastos). Escribes el monto y <b>tocas la categoría: eso ya guarda</b>. No hay botón de guardar.</p>
    ${ex('Ejemplo', `<p>Se tomaron un café de ${m(2500)}:</p><ol class="mt-ol"><li>Toca <b>2 · 5 · 0 · 0</b></li><li>Toca <b>🍽️ Comida</b></li><li>¡Listo! Quedó anotado a medias, pagado por ti, con fecha de hoy.</li></ol>`)}
    <div class="mt-practice" id="mtPractice"></div>` , practice: true },
  { e: '⚡', t: 'Todavía más rápido', body: `<p>Arriba del teclado aparecen atajos:</p>
    <div class="mt-demo qs-chips">${chip('↺ Repetir: Uber ' + m(3800))}${chip('☕ Café ' + m(2500))}${chip('🍕 Pizza ' + m(9000))}</div>
    <ul class="mt-list"><li><b>Repetir el último</b>: el mismo gasto otra vez, con un toque.</li><li><b>Frecuentes</b>: lo que anotan seguido (mismo lugar y monto) aparece solo como botón.</li><li><b>+1.000 / +5.000 / +10.000</b>: para ir sumando sin escribir.</li><li><b>«¿En qué?»</b> es opcional: si no escribes nada, queda el nombre de la categoría.</li></ul>
    ${ex('Ejemplos', `<ul class="mt-list"><li>En la fiesta pagaste una ronda de ${m(10000)}: toca <b>+10.000</b> y <b>🎉 Fiestas</b>. Dos toques.</li><li>Todos los viernes piden pizza de ${m(9000)}: después de la segunda vez aparece el botón <b>🍕 Pizza ${m(9000)}</b> y con un toque queda anotada.</li><li>Otro Uber igual al de hace un rato: <b>↺ Repetir</b>.</li></ul>`)}` },
  { e: '➗', t: '¿Quién pagó y cómo se divide?', body: `<p>Abajo hay tres botones que vienen ya puestos. Solo los tocas si es distinto:</p>
    <div class="mt-demo qs-opts">${chip('💳 Pagó yo')}${chip('➗ A medias')}${chip('📅 Hoy')}</div>
    <ul class="mt-list"><li><b>💳 Pagó</b>: cambia entre tú y ${pn()}.</li><li><b>➗</b> dice claro cómo quedan las cuentas: <b>«${pn()} te debe la mitad»</b>, <b>«${pn()} te debe todo»</b> o <b>«Nadie debe nada»</b> (cada quien paga lo suyo). Lo que elijas queda como el de siempre en tu teléfono.</li><li><b>📅</b> cambia entre hoy, ayer y antier (por si se te olvidó).</li></ul>
    ${ex('Ejemplos', `<ul class="mt-list"><li>Cena de ${m(18000)} que pagaste tú y van a medias: <b>➗ ${pn()} te debe la mitad</b> → te debe ${m(9000)}.</li><li>${pn()} te compró un helado de ${m(1500)}: <b>💳 Pagó ${pn()}</b> y <b>➗ Le debes todo</b> → le debes ${m(1500)}.</li><li>Cada quien paga lo suyo (por ejemplo una camisa): <b>➗ Nadie debe nada</b> → se ve en el gasto del mes, pero no cambia el balance.</li></ul>`)}
    <p class="tiny muted">El balance de «quién le debe a quién» está más abajo en Gastos, con el botón «Saldar cuentas».</p>` },
  { e: '↩️', t: '¿Te equivocaste?', body: `<p>Después de anotar sale esta barra unos segundos. Toca <b>Deshacer</b> y es como si no hubiera pasado:</p>
    <div class="mt-demo"><div class="undo-bar mt-static"><span>Anotado ${m(12500)} en Salidas</span><button tabindex="-1">Deshacer</button></div></div>
    <p>Si ya pasó la barra, en Gastos → <b>Movimientos</b> cada gasto tiene su 🗑️ para borrarlo.</p>
    <p class="tiny muted">Para algo con más detalle (como un gasto de un viaje), en Movimientos está «Con más detalle».</p>` },
  { e: '🎉', t: 'Salimos', body: `<p>Antes de una salida o fiesta toca <b>«🎉 Salimos»</b>. Todo lo que anoten <b>los dos</b> mientras esté activa se suma ahí, y pueden ponerle un <b>límite</b>.</p>
    ${ex('Ejemplo: sábado en el bar', `<p>Empiezan «Salida del sábado» con límite de ${m(25000)}. Durante la noche anotan cerveza ${m(6000)}, nachos ${m(8500)} y el Uber ${m(4200)}:</p>
      <div class="outing"><div class="row"><b>🎉 Salida del sábado</b><span><b>${m(18700)}</b> <span class="muted">de ${m(25000)}</span></span></div><div class="row"><span class="tiny muted">3 gastos · lo que anoten se suma aquí</span><span class="link">Terminar</span></div></div>
      <p>Si pasan de ${m(25000)}, a los dos les llega un aviso suave 🙈. Al final tocan <b>Terminar</b> y en Movimientos queda <b>una sola fila</b> con el total (y el detalle adentro).</p>`)}` },
  { e: '📊', t: 'Presupuesto de la semana', body: `<p>En Gastos toca <b>«Poner presupuesto»</b>: cuánto quieren gastar <b>por semana</b> (lunes a domingo) en gustos (🍽️ Comida, 🎬 Salidas y 🎉 Fiestas, o las que elijan). En Inicio verán el termómetro:</p>
    ${ex(`Ejemplo con ${m(50000)} por semana`, `<p class="small">Lunes, van bien:</p>${thermo(20000, 50000, 7)}<p class="small">Miércoles, ojo (al 80 % les llega un aviso):</p>${thermo(42000, 50000, 5)}<p class="small">Sábado, se pasaron:</p>${thermo(56000, 50000, 2)}`)}
    <p class="tiny muted">Semanal es más fácil de cumplir que mensual: si una semana se pasan, la siguiente empieza de cero.</p>` },
  { e: '🐷', t: 'Alcancías', body: `<p>Creen metas de ahorro en Gastos → <b>Alcancías → + Nueva</b> (un viaje, algo para la casa…). Pueden <b>aportar</b> cuando quieran.</p>
    <p>Y lo mejor: <b>lo que les sobre del presupuesto de la semana cae solo</b> en la alcancía marcada «aquí va lo que sobra», cada lunes.</p>
    ${ex('Ejemplo', `<p>Presupuesto de ${m(50000)}; la semana pasada gastaron ${m(38000)}. El lunes caen <b>${m(12000)}</b> en «Viaje a la playa»:</p>
      <div class="goal mt-demo"><div class="row"><span><span style="font-size:20px">🏖️</span> <b>Viaje a la playa</b> <span class="pill tiny">aquí va lo que sobra</span></span><span class="small"><b>${m(87000)}</b> <span class="muted">/ ${m(300000)}</span></span></div><div class="progress"><i style="width:29%"></i></div></div>`)}
    <p class="tiny muted">El dinero no se mueve de verdad: es para que vean cuánto llevan. Apártenlo también en su cuenta de ahorro 😉.</p>` },
  { e: '🔔', t: 'Avisos y resumen del domingo', body: `<p>Si tienen las notificaciones activadas, Futari les avisa (pueden apagar cada tipo en Ajustes → Notificaciones → «💸 Gastos»):</p>
    <div class="mt-notifs">${['🟡 Van por el 80 % del presupuesto de la semana', `🎉 ${pn()} empezó «Salida del sábado»`, `🙈 Ya van ${m(28000)} en Salida del sábado`, `🐷 ¡Les sobraron ${m(12000)} esta semana!`].map(t => `<div class="mt-notif"><b>Futari</b><span>${t}</span></div>`).join('')}</div>
    <p>Cada <b>domingo en la noche</b> llega el resumen: cuánto gastaron en gustos, comparado con su presupuesto y con la semana anterior. En Gastos también está la tarjeta «Esta semana vs. la pasada», y con el ícono <b>📈</b> de arriba ven sus semanas, en qué se va la plata, mes contra mes y qué días gastan más.</p>` },
  { e: '🏦', t: 'Desde el aviso del banco', body: `<p>Si su banco les manda un SMS, correo o notificación con cada compra, el teléfono puede <b>abrir Futari con el monto y el lugar ya puestos</b>: solo tocas la categoría.</p>
    ${ex('Ejemplo', `<div class="mt-notif"><b>Banco</b><span>Compra aprobada por CRC 18,750.00 en AUTOMERCADO el 14/11</span></div><p style="margin:8px 0 0">↓ se abre Futari con <b>${fmtMoney(C() ? 18750 : 37.5)}</b> y «AUTOMERCADO» → tocas 🛒 Súper. Listo.</p>`)}
    <p>Se configura una vez en cada teléfono. Hay un paso a paso para iPhone y Samsung:</p>
    <button class="btn ghost" onclick="moneyTourBank()">⚡ Ver el paso a paso</button>` },
  { e: '💡', t: 'Ideas para gastar menos', body: `<ul class="mt-list"><li>🎉 Antes de salir, pongan el <b>límite</b> en «Salimos». Ponerlo antes hace que lo cumplan.</li><li>🍳 Si el termómetro está amarillo, cocinen en casa: en <b>Recetas</b> hay ideas.</li><li>🎲 Busquen planes gratis o baratos en <b>¿Qué hacemos?</b>.</li><li>📅 Anoten en el momento: con el atajo del ícono o el del banco toma segundos.</li><li>🐷 Celebren cuando la alcancía crezca: el ahorro es de los dos.</li></ul>
    <p class="tiny muted">Esta guía se puede volver a ver cuando quieran: en Gastos, botón <b>📖 Cómo funciona</b>.</p>`, last: true },
];
const SLIDES_N = 11;

let i = 0, view = null, P = '';
function show() {
  const s = SLIDES(), sl = s[i];
  view ??= Object.assign(document.createElement('div'), { className: 'dialog mt-view' });
  view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Cómo funciona Gastos');
  if (!view.isConnected) { document.body.appendChild(view); syncBack(); }
  view.innerHTML = `<div class="mt-top"><span class="tiny muted">Gastos · ${i + 1} de ${s.length}</span><button class="link" onclick="moneyTourEnd()">${sl.last ? 'Cerrar' : 'Saltar'}</button></div>
    <div class="mt-body"><div class="mt-emoji">${sl.e}</div><h2>${esc(sl.t)}</h2>${sl.body}</div>
    <div class="mt-dots">${s.map((_, k) => `<i class="${k === i ? 'on' : ''}" onclick="moneyTourGo(${k - i})"></i>`).join('')}</div>
    <div class="grid2 mt-nav">${i ? '<button class="btn ghost" onclick="moneyTourGo(-1)">Atrás</button>' : '<button class="btn ghost" onclick="moneyTourEnd()">Ahora no</button>'}
      <button class="btn" onclick="${sl.last ? 'moneyTourEnd(true)' : 'moneyTourGo(1)'}">${sl.last ? '¡A anotar! 💸' : 'Siguiente'}</button></div>`;
  view.querySelector('.mt-body').scrollTop = 0;
  if (sl.practice) practice();
}
// Práctica: un teclado chiquito que no guarda nada
function practice(msg = '') {
  const box = $('mtPractice'); if (!box) return;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', C() ? '000' : '.', '0', '⌫'];
  box.innerHTML = `<span class="mt-ex-t">✍️ Pruébalo aquí (es de práctica, no se guarda)</span>
    <div class="qs-amt mt-amt">${P ? fmtMoney(Number(P)) : fmtMoney(0)}</div>
    <div class="qs-keys mt-keys">${keys.map(k => `<button onclick="moneyTourKey('${k}')">${k}</button>`).join('')}</div>
    <div class="qs-cats">${[['🍽️', 'Comida'], ['🎬', 'Salidas'], ['🎉', 'Fiestas']].map(([e, l]) => `<button class="btn" onclick="moneyTourCat('${l}')">${e}<small>${l}</small></button>`).join('')}</div>
    ${msg ? `<p class="small center mt-ok" style="margin:0">${msg}</p>` : ''}`;
  if (msg) box.querySelector('.mt-ok').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function moneyTourKey(k) {
  if (k === '⌫') P = P.slice(0, -1); else if (k === '.') { if (!P.includes('.')) P = (P || '0') + '.'; } else if ((P + k).length <= 9) P += k;
  navigator.vibrate?.(5); practice();
}
function moneyTourCat(l) {
  if (!(Number(P) > 0)) return practice('Primero escribe un monto con los números 👆');
  const msg = `✅ ¡Así de fácil! Se habría anotado <b>${fmtMoney(Number(P))}</b> en ${l}. En la app de verdad aparece «Deshacer» por si te equivocas.`;
  P = ''; navigator.vibrate?.(12); practice(msg);
}
export function moneyTour() { i = 0; P = ''; show(); }
function moneyTourGo(d) { i = Math.max(0, Math.min(SLIDES().length - 1, i + d)); show(); }
function moneyTourEnd() {
  if (view) { const el = view; view = null; el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); }
  if (!profile(uid()).prefs?.moneyTour) write(setDoc(ref('profiles', uid()), { prefs: { moneyTour: 1 } }, { merge: true }));
}
function moneyTourBank() { moneyTourEnd(); setTimeout(() => window.bankTutorial?.(), 200); }
// La primera vez que cada uno entra a Gastos
onShow('s-money', () => { if (S.me && profile(uid()).prefs && !profile(uid()).prefs.moneyTour && !view) setTimeout(() => { if (!view && document.getElementById('s-money').classList.contains('active')) moneyTour(); }, 500); });
expose({ moneyTour, moneyTourGo, moneyTourEnd, moneyTourKey, moneyTourCat, moneyTourBank });
