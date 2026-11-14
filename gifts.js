// Juegos sorpresa que el dueño regala desde Administración (Flechas, La parada…).
// - couples/nosotros.features.<clave> = { on, at, by, msg }. El dueño (isOwner) ve el juego siempre; la pareja solo si on.
// - Mientras la pareja no lo abre, le aparece envuelto (Inicio, Más y juegos de la mascota) y al abrirlo queda
//   profiles/<uid>.prefs.unwrapped.<clave>. La sección y su aviso se esconden con gates (core.js).
// Para agregar un juego sorpresa: súmalo a GIFTS y registra su sección en SECTIONS (core.js).
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, esc, icon, expose, toast, write, ref, coupleRef, profile, uid, partnerUid, nameOf, celebrate, syncBack, gates, ask } from './core.js';
import { isTester } from './testing.js';
import { notify } from './push.js';

export const GIFTS = {
  arrows: { name: 'Flechas', e: '🏹', screen: 's-arrows', notif: 'arrows', desc: 'Un juego hecho para ti: saca todas las flechas del tablero sin que choquen.' },
  bus: { name: 'La parada', e: '🚏', screen: 's-bus', notif: 'bus', desc: 'Saca los vehículos del estacionamiento y llévalos a la parada para que suban todos los pasajeros de su color.' },
};
// El dueño (TESTERS). En el emulador los dos son «testers», así que ahí el dueño es quien entró primero a la pareja.
export const isOwner = () => {
  if (!EMU) return isTester();
  const m = Object.entries(S.settings.members || {}).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0));
  return !m.length || m[0][0] === uid();
};
export const giftInfo = k => S.settings.features?.[k] || {};
export const giftVisible = k => isOwner() || !!giftInfo(k).on;
// Puesto para la pareja, pero todavía envuelto (no lo ha abierto)
export const giftWrapped = k => !isOwner() && !!giftInfo(k).on && !profile(uid()).prefs?.unwrapped?.[k];
for (const [k, g] of Object.entries(GIFTS)) { gates[g.screen] = () => giftVisible(k) && !giftWrapped(k); gates['notif:' + g.notif] = () => giftVisible(k); }
const wrappedList = () => Object.keys(GIFTS).filter(giftWrapped);

// Tarjeta de Inicio y mosaico de Más mientras haya algo envuelto
export const giftCard = () => { const w = wrappedList(); return !w.length ? '' : `<button class="glass gift-card" onclick="unwrapGift('${w[0]}')" aria-label="Abrir regalo">
    <span class="gift-box" aria-hidden="true"><i></i></span><span class="stack" style="gap:2px;text-align:left"><b>Tienes ${w.length > 1 ? 'regalos' : 'un regalo'} 🎁</b><span class="small muted">Tócalo para abrirlo</span></span></button>`; };
export const giftTile = () => wrappedList().map(k => `<button class="tile gift-tile" onclick="unwrapGift('${k}')"><span class="gift-bow" aria-hidden="true">🎀</span>
    <div><b>Un regalo para ti</b></div><span class="sub">Tócalo para abrirlo</span></button>`).join('');
// Abrirlo (preview = solo verlo, desde Administración, sin guardar nada). Sin clave: el primero envuelto.
export function unwrapGift(k, preview) {
  k = k || wrappedList()[0]; const G = GIFTS[k];
  if (!G || (!preview && !giftWrapped(k))) return;
  const el = document.createElement('div');
  el.className = 'dialog gift-open'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Regalo');
  el.innerHTML = `<button class="icon-btn gift-x" data-v="0" aria-label="Cerrar">${icon('x')}</button>
    <div class="gift-stage"><button class="gift-big" aria-label="Abrir el regalo"><span class="lid"></span><span class="box"></span></button><p class="gift-hint">Toca para abrirlo</p></div>`;
  document.body.appendChild(el); syncBack();
  const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); };
  el.querySelector('.gift-x').onclick = close;
  let taps = 0;
  el.querySelector('.gift-big').onclick = e => {
    const g = e.currentTarget; navigator.vibrate?.(15);
    if (++taps < 3) { g.classList.remove('wiggle'); void g.offsetWidth; g.classList.add('wiggle'); el.querySelector('.gift-hint').textContent = taps === 1 ? '¡Otra vez!' : '¡Una más!'; return; }
    g.classList.add('open'); celebrate(); setTimeout(() => celebrate('hearts'), 500);
    if (!preview) write(setDoc(ref('profiles', uid()), { prefs: { unwrapped: { [k]: Date.now() } } }, { merge: true }));
    const m = giftInfo(k).msg;
    setTimeout(() => {
      el.querySelector('.gift-stage').innerHTML = `<div class="gift-reveal"><div style="font-size:64px">${G.e}</div><h2>${esc(G.name)}</h2>
        <p class="muted" style="margin:0">${esc(G.desc)}</p>
        ${m ? `<p class="gift-msg">«${esc(m)}»</p>` : ''}
        <button class="btn" id="giftPlay">¡A jugar!</button>${preview ? '<p class="tiny muted" style="margin:0">(Vista previa: no se guardó nada)</p>' : ''}</div>`;
      el.querySelector('#giftPlay').onclick = () => { close(); window.go(G.screen); };
    }, 700);
  };
}

/* ---------- Administración: una tarjeta por juego sorpresa ---------- */
const when = t => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function giftAdminCard(k) {
  const G = GIFTS[k], g = giftInfo(k), p = partnerUid(), opened = p && profile(p).prefs?.unwrapped?.[k];
  // Ya regalado: solo queda el registro
  if (g.on) return `<div class="glass stack"><span class="label">🎁 ${esc(G.name)}</span>
    <p class="small" style="margin:0">Regalado el ${when(g.at)}. ${opened ? `${esc(nameOf(p))} lo abrió el ${when(opened)} 💝` : `${esc(nameOf(p) || 'Tu pareja')} todavía no lo abre.`}</p></div>`;
  return `<div class="glass stack" style="border-color:rgba(255,181,71,.5)"><span class="label">🎁 Sorpresa: ${esc(G.name)}</span>
    <p class="small" style="margin:0">🔒 Escondido: solo tú lo ves (Más → ${esc(G.name)}). Tu pareja no ve nada: ni la sección, ni en el buscador, ni el aviso en Ajustes.</p>
    <div><label class="f" for="giftMsg-${k}">Mensaje al abrirlo (opcional)</label><textarea id="giftMsg-${k}" maxlength="200" placeholder="Ej: Para que juegues a lo que te gusta, pero aquí 💕">${esc(g.msg || '')}</textarea></div>
    <label class="check"><input type="checkbox" id="giftNotify-${k}" checked> Avisarle con una notificación («🎁 Tienes un regalo en Futari»)</label>
    <button class="btn" onclick="giftGive('${k}')">🎁 Envolver y regalar</button>
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="unwrapGift('${k}', true)">👀 Ver cómo se abre</button><button class="btn ghost small" style="width:100%" onclick="go('${G.screen}')">${G.e} Probar el juego</button></div></div>`;
}
export const giftAdminCards = () => !isOwner() ? '' : Object.keys(GIFTS).map(giftAdminCard).join('');
async function giftGive(k) {
  const G = GIFTS[k];
  if (!(await ask(`¿Regalar ${G.name} ahora? A tu pareja le aparece envuelto en Inicio y en Más.`, { ok: 'Regalar' }))) return;
  const n = $('giftNotify-' + k)?.checked;
  write(setDoc(coupleRef, { features: { [k]: { ...giftInfo(k), on: true, at: Date.now(), by: uid(), msg: $('giftMsg-' + k)?.value.trim() || '' } } }, { merge: true }));
  if (n) notify('surprise', { title: '🎁 Tienes un regalo en Futari', body: 'Ábrelo cuando quieras 💝', url: './?open=gift', tag: 'gift-' + k });
  celebrate(); toast('¡Regalo envuelto y entregado! 🎁');
}
expose({ unwrapGift, giftGive });
