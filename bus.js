// La parada: saca los vehículos del estacionamiento y llévalos a la parada para que suban los pasajeros de su color.
// - Estacionamiento en 3D: autos (4 asientos, también en diagonal), busetas (6) y buses (10). Al tocarlos salen si su
//   camino hasta el borde está libre (si chocan, regresan), rodean por la calle y se estacionan en la parada.
// - La parada tiene 7 lugares: 4 abiertos y 3 con candado 🔒 que se abren solo durante ese nivel mandándole una foto a la
//   pareja (llega como instantánea) o con monedas.
// - La fila de pasajeros sube sola, en orden, al vehículo de su color que llegó primero. Lleno = se va y libera el lugar.
//   Si la parada se llena y el siguiente de la fila no tiene vehículo de su color, se pierde.
// - Ayudas con monedas de la mascota: acomodar la fila y grúa (saca un vehículo bloqueado). 💀 Experto: sin ayudas de monedas.
// - 100 niveles, reto del día (el mismo para los dos) y duelo en vivo. Siempre tiene solución (generateLot).
// - Sorpresa (gifts.js, clave «bus»): hasta que el dueño la regale, solo él la ve.
// Datos: bus/p-<uid> { lv, ls{n: estrellas}, lx{n: experto}, dw } · bus/d-<día> { <uid>: { ms, moves, help, at } } ·
//   bus/duel { did, seed, size, from, to, state, at, startAt, p{uid:{n,total,done,ms,gaveUp,fails}}, winner, counted }.
import { setDoc, updateDoc, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, db, esc, icon, on, onShow, expose, toast, write, ref, uid, partnerUid, nameOf, partnerName,
         todayKey, celebrate, syncBack, markActive, countStat, ask, takePhoto, nativePick, compressImage, photoError, ANDROID, IOS } from './core.js';
import { sendPhotoSnap } from './snaps.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';
import { pet, coins } from './pet.js';
import { isOwner, giftInfo, giftVisible, giftWrapped } from './gifts.js';

export const busVisible = () => giftVisible('bus');
export const busWrapped = () => giftWrapped('bus');

/* ---------- Generador (siempre tiene solución) ----------
   Vehículos: auto (2 casillas, 4 asientos), buseta (3, 6), bus (4, 10) y auto en diagonal (ocupa 2×2 casillas, 4).
   Cada uno tiene una huella (sus casillas) y un camino: el barrido de la huella hacia adelante hasta salir del
   estacionamiento. Se colocan con el truco de Flechas (orden de salida «o»: uno nuevo solo entra si su camino solo tiene
   vehículos que salen antes y no pisa el camino de uno que sale después), así que siempre hay un orden para sacarlos
   todos. La fila se arma simulando a alguien que los saca en ese orden con slotsGen lugares de espera; cada pasajero que
   se agrega es del color de un vehículo que esa persona tiene en la parada. Como el jugador tiene ≥ slotsGen lugares
   abiertos, sacando en ese orden nunca se traba. */
const DIR8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
export const KINDS = [{ len: 2, cap: 4, name: 'Auto' }, { len: 3, cap: 6, name: 'Buseta' }, { len: 4, cap: 10, name: 'Bus' }, { len: 2, cap: 4, name: 'Auto', diag: true }];
export const COLORS = ['#F0465A', '#2F7DF0', '#F5B92E', '#25B36B', '#9B5CF0', '#FF8A2E'];
const COLOR_NAMES = ['rojo', 'azul', 'amarillo', 'verde', 'morado', 'naranja'];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function generateLot({ seed, w, h, count, colors, slotsGen, mix = [0.6, 0.3, 0.1], diag = 0, bias = 0.4 }) {
  const R = rng(seed), occ = new Int32Array(w * h).fill(-1), cover = new Float64Array(w * h).fill(-Infinity), list = [];
  const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const pickKind = () => { if (R() < diag) return 3; const r = R(); return r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2; };
  for (let tries = 0; list.length < count && tries < count * 500; tries++) {
    const kind = pickKind(), K = KINDS[kind];
    let cells, d;
    if (K.diag) { const x = Math.floor(R() * (w - 1)), y = Math.floor(R() * (h - 1)); d = 4 + Math.floor(R() * 4); cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]; }
    else { const x = Math.floor(R() * w), y = Math.floor(R() * h); d = Math.floor(R() * 4); const [dx, dy] = DIR8[d]; cells = []; for (let i = 0; i < K.len; i++) cells.push([x - dx * i, y - dy * i]); }
    if (cells.some(([cx, cy]) => !inB(cx, cy) || occ[cy * w + cx] >= 0)) continue;
    // barrido: la huella avanza un paso a la vez hasta salir del todo (el camino queda en orden de cercanía)
    const own = new Set(cells.map(([cx, cy]) => cy * w + cx)), ray = [], seen = new Set(), [dx, dy] = DIR8[d]; let hi = Infinity;
    for (let k = 1; k < w + h + 4; k++) {
      let any = false;
      for (const [cx, cy] of cells) { const nx = cx + dx * k, ny = cy + dy * k; if (!inB(nx, ny)) continue; any = true; const kk = ny * w + nx; if (own.has(kk) || seen.has(kk)) continue; seen.add(kk); ray.push(kk); if (occ[kk] >= 0) hi = Math.min(hi, list[occ[kk]].o); }
      if (!any) break;
    }
    let lo = -Infinity; for (const [cx, cy] of cells) lo = Math.max(lo, cover[cy * w + cx]);
    if (!(lo < hi)) continue;
    const o = hi === Infinity ? (lo === -Infinity ? 0 : lo + 1) : lo === -Infinity ? hi - 1 : lo + (hi - lo) * (0.25 + R() * 0.5);
    const id = list.length;
    for (const [cx, cy] of cells) occ[cy * w + cx] = id;
    for (const k of ray) cover[k] = Math.max(cover[k], o);
    list.push({ id, cells, d, kind, cap: K.cap, o, ray });
  }
  const order = [...list].sort((a, b) => b.o - a.o);
  list.forEach((v, i) => { v.color = i < colors ? i : Math.floor(R() * colors); });
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i].color, list[j].color] = [list[j].color, list[i].color]; }
  const queue = [], slots = []; let next = 0;
  while (next < order.length || slots.length) {
    while (slots.length < slotsGen && next < order.length) { const v = order[next++]; slots.push({ v, rem: v.cap }); }
    const colorsIn = [...new Set(slots.map(s => s.v.color))];
    const c = R() < bias ? slots[slots.length - 1].v.color : colorsIn[Math.floor(R() * colorsIn.length)];
    const s = slots.find(x => x.v.color === c);
    queue.push(c); s.rem--;
    if (!s.rem) slots.splice(slots.indexOf(s), 1);
  }
  return { w, h, list, queue, order: order.map(v => v.id) };
}

/* ---------- Niveles ---------- */
// 7 lugares en la parada: 4 abiertos y 3 con candado (se abren solo durante ese nivel mandando una foto o con monedas)
export const LEVELS = 100, SLOTS = 4, BAYS = 7;
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
export const isBoss = L => L % 10 === 0;
// Dificultad que sube rápido: tamaño, vehículos, colores, diagonales, lugares que usa la solución (slotsGen: 3 = un lugar
// de margen, solo al principio) y qué tan «encadenada» es la fila (bias)
export function levelSpec(L) {
  const t = (L - 1) / (LEVELS - 1), boss = isBoss(L);
  const count = Math.round(L <= 3 ? [6, 8, 10][L - 1] : lerp(12, 56, Math.pow(t, 0.7)) * (boss ? 1.1 : 1));
  const w = Math.round(lerp(5, 11, Math.pow(t, 0.6))), h = Math.round(lerp(6, 15, Math.pow(t, 0.6)));
  const colors = L <= 2 ? 2 : L <= 6 ? 3 : L <= 15 ? 4 : L <= 35 ? 5 : 6;
  return { key: 'l' + L, num: L, title: `${boss ? '👑 ' : ''}Nivel ${L}`, seed: hash('parada-' + L), w, h, count, colors, slotsGen: L <= 8 ? 3 : 4, slots: SLOTS, boss,
    diag: L < 6 ? 0 : lerp(0.3, 0.55, t), bias: lerp(0.25, 0.7, t), mix: L <= 4 ? [1, 0, 0] : L <= 12 ? [0.7, 0.3, 0] : [0.5, 0.3, 0.2] };
}
// Reto del día: el mismo para los dos; más grande hacia el fin de semana
const DAY_LEVEL = [80, 30, 40, 50, 60, 70, 90]; // domingo..sábado → tamaño como ese nivel
export const dailySpec = (day = todayKey()) => { const w = new Date(day + 'T12:00').getDay(), base = levelSpec(DAY_LEVEL[w]); return { ...base, key: 'd' + day, title: 'Reto del día', seed: hash('parada-dia-' + day), day: true, boss: false }; };
const DUEL_SIZES = { rapido: [25, 'Rápido'], normal: [50, 'Normal'], largo: [75, 'Largo'] };
const duelSpec = d => ({ ...levelSpec(DUEL_SIZES[d.size]?.[0] || 50), key: 'duel' + d.did, title: '⚔️ Duelo', seed: d.seed, duel: d.did, boss: false });


/* ---------- Datos ---------- */
const progress = (id = uid()) => S.data.bus.find(d => d.id === 'p-' + id) || {};
const myLevel = () => progress().lv || 1;
const daily = (day = todayKey()) => S.data.bus.find(d => d.id === 'd-' + day) || {};
const duelDoc = () => S.data.bus.find(d => d.id === 'duel') || null;
const fmtMs = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const expertOn = () => { try { return localStorage.getItem('futari-bus-expert') === '1'; } catch { return false; } };
// Puntaje del reto y duelo: tiempo + 20 s por ayuda + 15 s por cada vez que se llenó la parada (menos es mejor)
const score = r => r.ms + (r.help || 0) * 20000 + (r.fails || 0) * 15000;
const UNLOCK_COST = 15; // abrir un lugar 🔒 con monedas (con una foto es gratis)
const HELP = { sort: [20, '🔀', 'Acomodar la fila', 'Pasa adelante a los pasajeros de los colores que ya están en la parada'], tow: [25, '🏗️', 'Grúa', 'Saca cualquier vehículo, aunque esté bloqueado'] };
export const busAlerts = () => { const d = duelDoc(); return busVisible() && !busWrapped() && d?.state === 'invite' && d.to === uid() && Date.now() - d.at < 3600e3 ? 1 : 0; };

/* ---------- Pantalla ---------- */
function render() {
  if (!busVisible()) { $('s-bus').innerHTML = `${backBar('La parada')}<p class="empty">Todavía no 😉</p>`; return; }
  const L = Math.min(myLevel(), LEVELS), pr = progress(), st = pr.ls || {}, lx = pr.lx || {}, done = myLevel() > LEVELS;
  const total = Object.values(st).reduce((a, b) => a + b, 0), sp = levelSpec(L);
  const d = daily(), me = d[uid()], p = partnerUid(), them = p && d[p], ds = dailySpec();
  const surprise = isOwner() && !giftInfo('bus').on;
  const dayRow = (who, r) => `<div class="row"><span>${who}</span><span class="small">${r ? `${r.expert ? '💀 ' : ''}<b>${fmtMs(r.ms)}</b> · ${r.moves} ${r.moves === 1 ? 'toque' : 'toques'}${r.help ? ` · ${r.help} ayuda${r.help > 1 ? 's' : ''}` : ''}` : '<span class="muted">sin terminar</span>'}</span></div>`;
  const winner = me && them ? (score(me) === score(them) ? '¡Empate! 🤝' : score(me) < score(them) ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`) : '';
  const lvBtn = n => n > myLevel() ? `<button disabled aria-label="Nivel ${n} bloqueado"><b>${n}</b><small>${isBoss(n) ? '👑' : '🔒'}</small></button>`
    : `<button class="${n === myLevel() ? 'cur' : ''}${isBoss(n) ? ' boss' : ''}" onclick="playBus('l${n}')" aria-label="Nivel ${n}"><b>${lx[n] ? '💀' : ''}${n}</b><small>${st[n] ? stars(st[n]) : n === myLevel() ? 'nuevo' : isBoss(n) ? '👑' : ''}</small></button>`;
  $('s-bus').innerHTML = `${backBar('La parada', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${surprise ? `<div class="glass small" style="border-color:rgba(255,181,71,.5)">🔒 <b>Sorpresa:</b> solo tú lo ves. Cuando quieras regalarlo: Administración → Pruebas → 🎁 Sorpresa: La parada.</div>` : ''}
    ${isOwner() ? `<details class="glass stack ar-test"><summary class="label">🧪 Zona de pruebas · solo tú</summary>
      <div class="add-row" style="margin-top:8px"><input id="busTestLv" type="number" min="1" max="${LEVELS}" inputmode="numeric" placeholder="Ir al nivel (1-${LEVELS})" aria-label="Nivel a probar" onkeydown="if(event.key==='Enter')busTestLevel()"><button class="btn small" onclick="busTestLevel()">Probar</button></div>
      <div class="bus-presets">${[[1, 'Fácil'], [6, 'Diagonales'], [15, 'Medio'], [30, 'Difícil'], [60, 'Muy difícil'], [100, '👑 El último']].map(([n, l]) => `<button class="chip" onclick="playBus('t${n}')">${l}<small> · ${n}</small></button>`).join('')}<button class="chip" onclick="playBus('tday')">🗓️ Reto de hoy</button></div>
      <p class="tiny muted" style="margin:0">Se ve tal cual, sin desbloquear ni guardar nada; las ayudas y los lugares 🔒 son gratis (con foto se prueba sin mandarla).</p></details>` : ''}
    ${duelCard()}
    <div class="glass stack ar-hero ${sp.boss ? 'boss' : 'hard'}"><div class="ar-hero-ic">${done ? '🏆' : sp.boss ? '👑' : '🚏'}</div>
      <div class="stack" style="gap:2px;align-items:center"><span class="label">${done ? `¡Completaste los ${LEVELS} niveles!` : `Nivel ${L} de ${LEVELS}${sp.boss ? ' · jefe' : ''}`}</span>
      <span class="tiny muted">${sp.count} vehículos · ${sp.colors} colores</span></div>
      <button class="btn" onclick="playBus('l${L}')">${done ? `Repetir el ${L}` : `Jugar nivel ${L}`}</button>
      <div class="ar-bar"><i style="width:${Math.min(100, (myLevel() - 1) / LEVELS * 100)}%"></i></div>
      <label class="row ar-xp"><input type="checkbox" ${expertOn() ? 'checked' : ''} onchange="busExpert(this.checked)"><span class="small">💀 Modo experto: sin ayudas</span></label></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo para los dos</span></div>
      <p class="tiny muted" style="margin:0">Hoy: ${ds.count} vehículos · ${ds.colors} colores. Más grande hacia el fin de semana.</p>
      ${dayRow('Tú', me)}${p ? dayRow(esc(nameOf(p)), them) : ''}
      ${winner ? `<p class="small center" style="margin:0"><b>${winner}</b></p>` : ''}
      ${me ? '<p class="tiny muted center" style="margin:0">Mañana hay otro 😉</p>' : `<button class="btn ghost" onclick="playBus('day')">Jugar el reto de hoy</button>`}</div>
    <div class="glass stack"><span class="label">🗺️ Niveles</span><div class="ar-levels">${Array.from({ length: LEVELS }, (_, i) => lvBtn(i + 1)).join('')}</div></div>
    <p class="tiny muted center" style="margin:0 8px">Toca un vehículo: sale si su camino está libre y se va a la parada. Los pasajeros suben solos al vehículo de su color. Si la parada se llena y el siguiente no tiene vehículo, pierdes: piensa qué sacar primero. Los lugares 🔒 se abren mandando una foto 📸. Ayudas con las monedas de su mascota 🪙.</p>`;
}
function busExpert(v) { try { localStorage.setItem('futari-bus-expert', v ? '1' : '0'); } catch {} render(); }
function busTestLevel() { const n = Number($('busTestLv')?.value); if (!(n >= 1 && n <= LEVELS)) return toast(`Escribe un nivel del 1 al ${LEVELS}`); playBus('t' + n); }

/* ---------- Duelo en vivo ---------- */
function duelCard() {
  const d = duelDoc(), p = partnerUid(), pn = esc(partnerName()); if (!p) return '';
  const wins = `<span class="tiny muted">Duelos ganados: tú ${progress().dw || 0} · ${pn} ${progress(p).dw || 0}</span>`;
  const fresh = d && Date.now() - d.at < 3600e3, mine = d?.p?.[uid()] || {}, theirs = d?.p?.[p] || {};
  let body;
  if (fresh && d.state === 'invite' && d.from === uid()) body = `<p class="small" style="margin:0">Esperando a que ${pn} acepte el duelo (${DUEL_SIZES[d.size][1]})… ⏳</p><button class="btn ghost small" onclick="busDuel('cancel')">Cancelar</button>`;
  else if (fresh && d.state === 'invite' && d.to === uid()) body = `<p style="margin:0"><b>${esc(nameOf(d.from))} te reta a un duelo</b> (${DUEL_SIZES[d.size][1]}). El mismo estacionamiento, al mismo tiempo.</p>
    <div class="grid2"><button class="btn ghost" onclick="busDuel('decline')">Ahora no</button><button class="btn" onclick="busDuel('accept')">⚔️ Aceptar</button></div>`;
  else if (d?.state === 'live' && [d.from, d.to].includes(uid()) && Date.now() - d.startAt < 3 * 3600e3) body = mine.done || mine.gaveUp
    ? `<p class="small" style="margin:0">${mine.gaveUp ? 'Te rendiste' : `Terminaste en ${fmtMs(mine.ms)}`}. ${theirs.done ? '' : `${pn} lleva ${theirs.n || 0} de ${theirs.total || '?'} pasajeros…`}</p>`
    : `<p class="small" style="margin:0">Duelo en curso: ${pn} lleva ${theirs.n || 0} de ${theirs.total || '?'} pasajeros.</p><button class="btn" onclick="busDuel('enter')">Volver al duelo</button>`;
  else body = `${d?.state === 'done' && d.winner ? `<p class="small" style="margin:0">Último duelo: ${d.winner === uid() ? 'ganaste tú 🏆' : `ganó ${esc(nameOf(d.winner))}`}</p>` : ''}
    <p class="tiny muted" style="margin:0">Reta a ${pn}: el mismo estacionamiento al mismo tiempo, viendo cómo va el otro. Gana quien suba a todos primero.</p>
    <div class="grid3">${Object.entries(DUEL_SIZES).map(([k, [, l]]) => `<button class="btn ghost small" onclick="busDuel('invite','${k}')">${l}</button>`).join('')}</div>`;
  return `<div class="glass stack ar-duel"><div class="row"><span class="label">⚔️ Duelo en vivo</span>${wins}</div>${body}</div>`;
}
let duelStarted = '', lastPush = 0, pushLater = null;
function busDuel(what, size) {
  const d = duelDoc(), p = partnerUid(); if (!p) return;
  if (what === 'invite') {
    if (d && ['invite', 'live'].includes(d.state) && Date.now() - (d.startAt || d.at) < 3600e3 && !(d.state === 'live' && Object.values(d.p || {}).filter(x => x.done || x.gaveUp).length === 2)) return toast('Ya hay un duelo pendiente');
    write(setDoc(ref('bus', 'duel'), { did: String(Date.now()), seed: Math.floor(Math.random() * 2 ** 31), size, from: uid(), to: p, state: 'invite', at: Date.now(), p: {} }));
    notify('bus', { title: `⚔️ ${meForPartner()} te reta a un duelo de La parada`, body: `${DUEL_SIZES[size][1]}: el mismo estacionamiento, al mismo tiempo. ¡Acepta!`, url: './?open=bus', tag: 'bus-duel' });
    return toast('Reto enviado ⚔️');
  }
  if (!d) return;
  if (what === 'accept' && d.state === 'invite' && d.to === uid()) { write(updateDoc(ref('bus', 'duel'), { state: 'live', startAt: Date.now() + 5000 })); notify('bus', { title: `⚔️ ${meForPartner()} aceptó el duelo`, body: '¡Empieza ya! Entra a La parada', url: './?open=bus', tag: 'bus-duel' }); }
  if (what === 'decline') write(updateDoc(ref('bus', 'duel'), { state: 'declined' }));
  if (what === 'cancel') write(updateDoc(ref('bus', 'duel'), { state: 'cancelled' }));
  if (what === 'enter' && d.state === 'live') startDuel(d);
}
function startDuel(d) {
  duelStarted = d.did;
  const wait = (d.startAt || 0) - Date.now();
  if (wait > 400) {
    const el = document.createElement('div'); el.className = 'dialog ar-count'; el.innerHTML = '<b id="busCount"></b>'; document.body.appendChild(el); syncBack();
    const tick = () => { const s = Math.ceil(((d.startAt || 0) - Date.now()) / 1000); if (s > 0) { $('busCount').textContent = s; navigator.vibrate?.(20); setTimeout(tick, 250); } else { el.remove(); syncBack(); playBus('duel'); } };
    tick();
  } else playBus('duel');
}
function duelPush(force) {
  if (!G?.spec.duel) return;
  clearTimeout(pushLater);
  if (!force && Date.now() - lastPush < 1500) { pushLater = setTimeout(() => duelPush(true), 1500 - (Date.now() - lastPush)); return; }
  lastPush = Date.now();
  write(updateDoc(ref('bus', 'duel'), { [`p.${uid()}`]: { n: G.qi, total: G.board.queue.length, fails: G.fails, at: Date.now(), ...(G.duelEnd || {}) } }));
}
async function busGiveUp() {
  if (!(await ask('¿Rendirte en este duelo?', { ok: 'Rendirme', danger: true }))) return;
  G.duelEnd = { gaveUp: true }; duelPush(true); G.over = true; closeBus();
}
function duelWatch() {
  const d = duelDoc(); if (!d || !S.me || !busVisible() || busWrapped()) return;
  const p = partnerUid(), mine = d.p?.[uid()] || {}, theirs = d.p?.[p] || {};
  if (d.state === 'live' && [d.from, d.to].includes(uid()) && !mine.done && !mine.gaveUp && !G && duelStarted !== d.did && !document.hidden && !$('lockScreen') && Date.now() - d.startAt < 3600e3) startDuel(d);
  if (G?.spec.duel === d.did) {
    const o = $('busOpp'); if (o) { o.querySelector('i').style.width = ((theirs.n || 0) / (theirs.total || G.board.queue.length) * 100) + '%'; o.querySelector('.n').textContent = theirs.gaveUp ? 'se rindió' : theirs.done ? '¡terminó!' : `${theirs.n || 0}/${theirs.total || G.board.queue.length}`; }
    if (G.over && view?.querySelector('.ar-duel-res')) view.querySelector('.ar-duel-res').innerHTML = duelResultTxt(d);
  }
  const fin = x => x.done || x.gaveUp;
  if (d.state === 'live' && fin(mine) && fin(theirs)) {
    const w = mine.gaveUp && theirs.gaveUp ? '' : mine.gaveUp ? p : theirs.gaveUp ? uid() : score(mine) <= score(theirs) ? uid() : p;
    write(updateDoc(ref('bus', 'duel'), { state: 'done', winner: w || null }));
  }
  if (d.state === 'done' && d.winner === uid() && !d.counted) {
    write(updateDoc(ref('bus', 'duel'), { counted: true }));
    write(setDoc(ref('bus', 'p-' + uid()), { dw: increment(1) }, { merge: true }));
  }
}
function duelResultTxt(d) {
  const p = partnerUid(), mine = d.p?.[uid()] || {}, theirs = d.p?.[p] || {}, pn = esc(nameOf(p));
  if (theirs.gaveUp) return `🏆 ¡Ganaste! ${pn} se rindió`;
  if (!theirs.done) return `Esperando a ${pn}: lleva ${theirs.n || 0} de ${theirs.total || '?'}… ⏳`;
  const a = score(mine), b = score(theirs);
  return `${a < b ? '🏆 ¡Ganaste!' : a === b ? '🤝 ¡Empate!' : `😅 Ganó ${pn}`}<br><span class="small">Tú ${fmtMs(a)} · ${pn} ${fmtMs(b)}</span>`;
}

/* ---------- Jugar (3D) ----------
   Todo se dibuja en un «plano» de CSS 3D inclinado y recto (rotateX ~30°, sin girar: el estacionamiento se ve de frente). Arriba la fila de pasajeros (figuritas
   paradas), luego los 7 lugares de la parada, la calle y el estacionamiento. Los vehículos son capas apiladas con esquinas
   redondas (carrocería → vidrio → techo). La cámara se ajusta sola (fit) para que se vea todo el tablero en el teléfono.
   Las animaciones van con requestAnimationFrame: salen derecho, rodean por la calle y entran de frente a su lugar. */
let G = null, view = null, timer = null;
const C = 34, LANE = 22, ROAD = 36, BAY_P = 46, BAY_L = 146, BY0 = 104, LY0 = 288;
function specOf(what) {
  if (what === 'day') return dailySpec();
  if (what === 'duel') { const d = duelDoc(); return d ? duelSpec(d) : null; }
  if (what === 'tday') return isOwner() ? { ...dailySpec(), test: true, day: false, title: '🧪 Reto de hoy' } : null;
  const t = /^t(\d+)$/.exec(String(what)); if (t) return isOwner() ? { ...levelSpec(Math.max(1, Math.min(LEVELS, Number(t[1])))), test: true, title: '🧪 Nivel ' + t[1] } : null;
  const m = /^l(\d+)$/.exec(String(what)); return levelSpec(Math.max(1, Math.min(LEVELS, m ? Number(m[1]) : myLevel())));
}
// Medidas del plano (en px del plano, antes de la cámara)
function layout(b) {
  const lotW = b.w * C, lotH = b.h * C, span = (BAYS - 1) * BAY_P + 40;
  const inner = Math.max(lotW + 2 * ROAD, span + 40), PW = inner + 120, LX0 = (PW - lotW) / 2, LX1 = LX0 + lotW, LY1 = LY0 + lotH;
  const bx = Array.from({ length: BAYS }, (_, i) => PW / 2 + (i - (BAYS - 1) / 2) * BAY_P);
  const qa = bx[0] - 14, qb = bx[BAYS - 1] + 14;
  const path = [[PW / 2 - 10, 96], [qa, 96], [qa, 16], [qb, 16], [qb, 82]];
  const X0 = Math.min(bx[0] - 34, LX0 - ROAD), X1 = Math.max(bx[BAYS - 1] + 34, LX1 + ROAD);
  return { PW, PH: LY1 + ROAD + 110, LX0, LX1, LY1, lotW, lotH, bx, byc: BY0 + BAY_L / 2, path, X0, X1, Y1: LY1 + ROAD };
}
const vehLen = v => KINDS[v.kind].len * C - 6;
function startPose(v) {
  const xs = v.cells.map(c => c[0]), ys = v.cells.map(c => c[1]), [dx, dy] = DIR8[v.d];
  return { x: G.lay.LX0 + ((Math.min(...xs) + Math.max(...xs)) / 2 + 0.5) * C, y: LY0 + ((Math.min(...ys) + Math.max(...ys)) / 2 + 0.5) * C, ang: Math.atan2(dy, dx) * 180 / Math.PI };
}
function playBus(what) {
  if (!busVisible() || busWrapped()) return;
  const spec = specOf(what); if (!spec) return;
  if (spec.day && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  const board = spec.board ??= generateLot(spec), occ = new Int32Array(board.w * board.h).fill(-1);
  for (const v of board.list) for (const [x, y] of v.cells) occ[y * board.w + x] = v.id;
  const keep = G && G.spec.key === spec.key && G.spec.duel ? { fails: G.fails + 1, t0: G.t0 } : null; // en el duelo, reintentar no reinicia el reloj
  G = { spec, what, board, occ, lay: layout(board), V: [], bays: Array(BAYS).fill(-1), open: new Set([...Array(SLOTS).keys()]), qi: 0, moves: 0, help: 0, photos: 0,
    fails: keep?.fails || 0, t0: keep?.t0 || (spec.duel ? duelDoc()?.startAt || Date.now() : Date.now()), over: false, tow: false, pp: new Map(),
    expert: !spec.test && !spec.duel && expertOn(), queue: [...board.queue] };
  G.V = board.list.map(v => ({ ...v, ...startPose(v), lean: 0, op: 1, phase: 'lot', bay: -1, at: 0, filled: 0, L: vehLen(v), el: null }));
  view?.remove();
  view = document.createElement('div');
  view.className = 'dialog ar-view bus-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'La parada');
  document.body.appendChild(view); syncBack();
  paint();
  clearInterval(timer); timer = setInterval(() => { const t = $('busTime'); if (t && G && !G.over) t.textContent = fmtMs(Date.now() - G.t0); }, 500);
  if (spec.duel) { duelPush(true); duelWatch(); }
}
// Modelo redondo: capas apiladas (carrocería → cintura → vidrio → techo). Pocas capas para que vaya fluido en el teléfono.
const LAYERS = {};
function layers(k) {
  if (LAYERS[k]) return LAYERS[k];
  const out = [], add = (z, [t, r, b, l], rad, cls) => out.push(`<i class="ly ${cls}" style="left:${l}px;right:${r}px;top:${t}px;bottom:${b}px;border-radius:${rad};transform:translateZ(${z}px)"></i>`);
  const R = k === 2 ? '9px' : '11px / 12px';
  [[2, 'b0'], [4.5, 'b1'], [7, 'b2'], [9, 'b3']].forEach(([z, c]) => add(z, [0, 0, 0, 0], R, c));
  add(10.5, [0, 0, 0, 0], R, 'bt');
  if (k === 0) { [12.5, 14.5].forEach(z => add(z, [3, 15, 3, 9], '8px', 'gl')); add(16.5, [3.5, 16, 3.5, 10], '8px', 'rf'); }
  else if (k === 1) { [12.5, 14.5, 16.5].forEach(z => add(z, [2.5, 9, 2.5, 4], '8px', 'gl')); add(18, [3, 10, 3, 4.5], '8px', 'rf'); }
  else { [12.5, 15, 17.5].forEach(z => add(z, [1.5, 3, 1.5, 2], '7px', 'gl')); add(19.5, [1.5, 3, 1.5, 2], '8px', 'rf'); }
  return (LAYERS[k] = out.join(''));
}
const MODEL = ['car', 'van', 'bus', 'car'], ROOF = [17.5, 19, 20.5, 17.5];
function vehHTML(v) {
  const m = v.kind === 3 ? 0 : v.kind;
  return `<button class="v3 ${MODEL[v.kind]}" data-v="${v.id}" style="width:${v.L + 6}px;height:${C}px;--c:${COLORS[v.color]}" aria-label="${KINDS[v.kind].name} ${COLOR_NAMES[v.color]}, ${v.cap} asientos">
    <div class="body3"><i class="shadow"></i><i class="whl w1"></i><i class="whl w2"></i><i class="whl w3"></i><i class="whl w4"></i>${layers(m)}
    <i class="lamp hl1"></i><i class="lamp hl2"></i><i class="lamp tl1"></i><i class="lamp tl2"></i>
    <div class="badge" style="transform:translateZ(${ROOF[v.kind]}px)"><i class="ac"></i><span class="num">${v.cap}</span></div></div></button>`;
}
function place(v) {
  const el = v.el; if (!el) return;
  el.style.transform = `translate(${(v.x - (v.L + 6) / 2).toFixed(1)}px,${(v.y - C / 2).toFixed(1)}px) rotateZ(${v.ang.toFixed(1)}deg)`;
  el.style.opacity = v.op;
  el.firstElementChild.style.transform = v.lean ? `translateX(${v.lean.toFixed(2)}px)` : '';
  const n = el.querySelector('.num'); n.style.transform = `translateZ(2px) rotateZ(${(-v.ang).toFixed(0)}deg)`;
  n.textContent = v.phase === 'lot' || v.phase === 'drive' ? v.cap : `${v.filled}/${v.cap}`;
}
// Candado dibujado (no emoji): candado blanco en una ficha dorada y una camarita para decir «con una foto»
const LOCK_SVG = `<span class="lk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><rect x="5" y="10" width="14" height="10.5" rx="3" fill="#fff"/><circle cx="12" cy="14.6" r="1.7" fill="#E2A21A"/><path d="M12 15.5v2.2" stroke="#E2A21A" stroke-width="1.8" stroke-linecap="round"/></svg></span>
  <span class="lk-cam"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.4-2h5.2l1.4 2h2a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#2F7DF0"/><circle cx="12" cy="12.6" r="3.4" fill="#fff"/><circle cx="12" cy="12.6" r="1.8" fill="#2F7DF0"/></svg></span>`;
function bayHTML(i) {
  const x = G.lay.bx[i] - 20, open = G.open.has(i);
  return open ? `<div class="bay" data-b="${i}" style="left:${x}px;top:${BY0}px">P</div>`
    : `<button class="bay locked" data-b="${i}" style="left:${x}px;top:${BY0}px" onclick="busBay(${i})" aria-label="Lugar con candado: ábrelo con una foto">${LOCK_SVG}</button>`;
}
function paint() {
  const sp = G.spec, Y = G.lay, b = G.board;
  const mk = [[Y.X0, 0], [Y.X1, 0], [Y.X0, Y.Y1], [Y.X1, Y.Y1]].flatMap(([x, y]) => [0, 34].map(z => `<i class="mk" style="left:${x}px;top:${y}px;transform:translateZ(${z}px)"></i>`)).join('');
  view.innerHTML = `<div class="ar-top"><button class="icon-btn" data-v="0" aria-label="Salir" onclick="closeBus()">${icon('x')}</button>
      <div class="ar-title"><b>${G.expert ? '💀 ' : ''}${esc(sp.title)}</b><span class="tiny muted"><span id="busLeft"></span> · <span id="busTime">0:00</span></span></div>
      ${sp.duel || G.expert ? '' : `<span class="pill" id="busCoins"></span>`}</div>
    ${sp.duel ? `<div class="ar-opp" id="busOpp"><span>${esc(nameOf(partnerUid()))}</span><div><i></i></div><span class="n">0</span></div>` : ''}
    <div class="bus-scene" id="busScene"><div class="bus-plane" id="busPlane" style="width:${Y.PW}px;height:${Y.PH}px">
      <div class="bg-ground"></div>
      <div class="bg-walk" style="left:${Y.bx[0] - 34}px;width:${Y.bx[BAYS - 1] - Y.bx[0] + 68}px"></div>
      <div class="bg-plaza" style="left:${Y.bx[0] + 4}px;width:${Y.bx[BAYS - 1] - Y.bx[0] - 8}px"></div>
      <div class="bg-road" style="left:${Y.LX0 - ROAD}px;top:${LY0 - ROAD}px;width:${Y.lotW + 2 * ROAD}px;height:${Y.lotH + 2 * ROAD}px"></div>
      <div class="bg-road top" style="left:${Math.min(Y.X0, Y.LX0 - ROAD)}px;top:${LY0 - ROAD}px;width:${Math.max(Y.X1, Y.LX1 + ROAD) - Math.min(Y.X0, Y.LX0 - ROAD)}px;height:${ROAD}px"></div>
      <div id="busBays">${Array.from({ length: BAYS }, (_, i) => bayHTML(i)).join('')}</div>
      <div class="bg-lot" style="left:${Y.LX0}px;top:${LY0}px;width:${Y.lotW}px;height:${Y.lotH}px"></div>
      ${mk}<div id="busPeople"></div><div id="busCars"></div></div></div>
    ${sp.duel ? `<div class="ar-bottom"><button class="btn ghost small" onclick="busGiveUp()">🏳️ Rendirme</button></div>`
      : `<div class="bus-help">${G.expert ? '' : Object.entries(HELP).map(([k, [cost, e, name]]) => `<button class="btn ghost small" onclick="busHelp('${k}')" aria-label="${name}">${e} ${name}<small>${sp.test ? 'gratis' : cost + ' 🪙'}</small></button>`).join('')}
        <p class="tiny muted center" style="margin:0;grid-column:1/-1" id="busHint">🔒 ¿Te faltan lugares? Toca uno con candado y ábrelo mandando una foto${partnerUid() ? ` a ${esc(partnerName())}` : ''}.</p></div>`}`;
  const cars = $('busCars');
  cars.innerHTML = G.V.map(vehHTML).join('');
  for (const v of G.V) { v.el = cars.querySelector(`.v3[data-v="${v.id}"]`); place(v); }
  cars.onclick = e => { const el = e.target.closest?.('.v3'); if (el) tapVeh(Number(el.dataset.v)); };
  paintPeople(); hud(); fit();
  requestAnimationFrame(fit);
}
// Cámara: escala y centra el plano para que quepa todo (se mide con marcas invisibles en las esquinas, ya en 3D). En los
// tableros altos se inclina un poco menos para aprovechar la pantalla y que los vehículos se vean más grandes.
function fitAt(tilt) {
  const sc = $('busScene'), pl = $('busPlane'), W = sc.clientWidth, H = sc.clientHeight, mks = [...pl.querySelectorAll('.mk')];
  let s = 0.8, tx = 0, ty = 0;
  for (let it = 0; it < 7; it++) {
    pl.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale3d(${s},${s},${s}) rotateX(${tilt}deg)`;
    const sr = sc.getBoundingClientRect(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of mks) { const r = m.getBoundingClientRect(); x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); y0 = Math.min(y0, r.top); y1 = Math.max(y1, r.bottom); }
    if (it % 2 === 0) s *= Math.min((W - 8) / (x1 - x0), (H - 8) / (y1 - y0));
    else { tx += sr.left + W / 2 - (x0 + x1) / 2; ty += sr.top + H / 2 - (y0 + y1) / 2; }
  }
  return s;
}
function fit() {
  const sc = $('busScene'), pl = $('busPlane'); if (!sc || !pl || !G) return;
  const W = sc.clientWidth, H = sc.clientHeight; if (!W || !H) return;
  const Y = G.lay, fx = (Y.X0 + Y.X1) / 2, fy = Y.Y1 / 2;
  pl.style.left = `${W / 2 - fx}px`; pl.style.top = `${H / 2 - fy}px`; pl.style.transformOrigin = `${fx}px ${fy}px`;
  let best = 30, bs = fitAt(30);
  for (const t of [26, 22]) { const s = fitAt(t); if (s > bs * 1.04) { bs = s; best = t; } else break; }
  G.cam = fitAt(best); G.tilt = best;
}
// Fila de pasajeros: figuritas en una U arriba de la parada; las de adelante caminan a su vehículo
function queueSpot(r) {
  const P = G.lay.path; let tot = 0; const seg = [];
  for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push([P[i - 1], P[i], l]); tot += l; }
  const show = Math.floor(tot / 12); if (r >= show) return null;
  let d = r * tot / (show - 1);
  for (const [a, b, l] of seg) { if (d <= l) return [a[0] + (b[0] - a[0]) * d / l, a[1] + (b[1] - a[1]) * d / l]; d -= l; }
  return P[P.length - 1];
}
function personEl(c) { const el = document.createElement('div'); el.className = 'pp'; el.innerHTML = `<div class="fig"><i></i><b style="background:${COLORS[c]}"></b></div>`; return el; }
function paintPeople() {
  const box = $('busPeople'); if (!box) return;
  for (let r = 0; ; r++) {
    const i = G.qi + r; if (i >= G.queue.length) break;
    const at = queueSpot(r); if (!at) break;
    let el = G.pp.get(i);
    if (!el) { el = personEl(G.queue[i]); el.style.left = at[0] + 'px'; el.style.top = at[1] + 'px'; el.style.opacity = 0; box.appendChild(el); G.pp.set(i, el); requestAnimationFrame(() => { el.style.opacity = 1; }); }
    el.style.left = at[0].toFixed(1) + 'px'; el.style.top = at[1].toFixed(1) + 'px'; el.classList.toggle('first', r === 0);
  }
}
function hud() {
  const n = G.queue.length, l = $('busLeft'); if (l) l.textContent = `${G.qi} de ${n} pasajeros`;
  const c = $('busCoins'); if (c) { const p = pet(); c.textContent = G.spec.test ? '🪙 ∞' : `🪙 ${p?.hatchedAt ? coins(p) : 0}`; }
  const h = $('busHint'); if (h) h.hidden = G.open.size >= BAYS;
}
// Animación con requestAnimationFrame; se corta sola si se cierra o reinicia el juego
function animate(ms, step) {
  const g0 = G;
  return new Promise((ok, no) => { const t0 = performance.now(); const tick = now => { if (G !== g0 || !view) return no('fin'); const p = Math.min(1, (now - t0) / ms); step(p); if (p < 1) requestAnimationFrame(tick); else ok(); }; requestAnimationFrame(tick); });
}
const wait = ms => { const g0 = G; return new Promise((ok, no) => setTimeout(() => (G === g0 && view ? ok() : no('fin')), ms)); };
const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
// Recorrido suave: polilínea con esquinas redondeadas y muestreada
function smooth(raw) {
  const pts = raw.filter((p, i) => !i || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.5), out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by), r = Math.min(30, l1 / 2, l2 / 2);
    const p1 = [bx - (bx - ax) / l1 * r, by - (by - ay) / l1 * r], p2 = [bx + (cx - bx) / l2 * r, by + (cy - by) / l2 * r];
    out.push(p1);
    for (let t = 0.125; t < 1; t += 0.125) { const u = 1 - t; out.push([u * u * p1[0] + 2 * u * t * bx + t * t * p2[0], u * u * p1[1] + 2 * u * t * by + t * t * p2[1]]); }
    out.push(p2);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  const acc = [0]; for (let i = 1; i < out.length; i++) acc.push(acc[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { pts: out, acc, len: acc[acc.length - 1] };
}
function pointAt(P, d) {
  let i = 1; while (i < P.acc.length - 1 && P.acc[i] < d) i++;
  const a = P.pts[i - 1], b = P.pts[i] || a, seg = P.acc[i] - P.acc[i - 1] || 1, f = Math.max(0, Math.min(1, (d - P.acc[i - 1]) / seg));
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, b === a ? null : Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI];
}
const turnTo = (from, to) => from + ((((to - from) % 360) + 540) % 360 - 180);
// Camino a la parada: sigue derecho (también en diagonal) hasta la calle que rodea el estacionamiento, la recorre hasta la
// calle de arriba y entra de frente a su lugar
function route(v, bay) {
  const Y = G.lay, [dx, dy] = DIR8[v.d], n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
  const rx0 = Y.LX0 - LANE, rx1 = Y.LX1 + LANE, ry0 = LY0 - LANE, ry1 = Y.LY1 + LANE;
  let t = Infinity;
  if (ux > 0) t = Math.min(t, (rx1 - v.x) / ux); if (ux < 0) t = Math.min(t, (rx0 - v.x) / ux);
  if (uy > 0) t = Math.min(t, (ry1 - v.y) / uy); if (uy < 0) t = Math.min(t, (ry0 - v.y) / uy);
  const E = [v.x + ux * t, v.y + uy * t], wp = [[v.x, v.y], E], bx = Y.bx[bay];
  if (E[1] <= ry0 + 1) { /* ya está en la calle de arriba */ }
  else if (E[0] >= rx1 - 1) wp.push([rx1, ry0]);
  else if (E[0] <= rx0 + 1) wp.push([rx0, ry0]);
  else { const side = E[0] < (Y.LX0 + Y.LX1) / 2 ? rx0 : rx1; wp.push([side, ry1], [side, ry0]); }
  wp.push([bx, ry0], [bx, Y.byc]);
  return wp;
}
async function drive(v, wp) {
  const P = smooth(wp), T = Math.max(700, Math.min(2300, P.len / 0.42));
  await animate(150, p => { v.lean = -Math.sin(p * Math.PI) * 2.5; place(v); }); // arranca: se hunde un poquito hacia atrás
  await animate(T, p => { const [x, y, a] = pointAt(P, ease(p) * P.len); v.x = x; v.y = y; if (a != null) v.ang = turnTo(v.ang, a); v.lean = 0; place(v); });
  await animate(300, p => { v.lean = Math.sin(p * Math.PI) * 3 * (1 - p); place(v); }); // llega: rebote suave al frenar
  v.lean = 0; place(v);
}
// Choca: avanza hasta el que estorba y regresa
async function bump(v, blocker) {
  const [dx, dy] = DIR8[v.d], n = Math.hypot(dx, dy), b = G.board, k = v.ray.find(kk => G.occ[kk] === blocker);
  const cx = G.lay.LX0 + (k % b.w + 0.5) * C, cy = LY0 + (Math.floor(k / b.w) + 0.5) * C;
  const dist = Math.max(5, Math.min(170, ((cx - v.x) * dx + (cy - v.y) * dy) / n - v.L / 2 - C * 0.42)), x0 = v.x, y0 = v.y;
  v.bumping = true;
  const T = 240 + dist * 2.4; let hit = false;
  try {
    await animate(T, p => {
      const e = p < 0.55 ? ease(p / 0.55) : 1 - ease((p - 0.55) / 0.45), kx = e * dist;
      v.x = x0 + dx / n * kx; v.y = y0 + dy / n * kx; place(v);
      if (!hit && p >= 0.55) { hit = true; const bl = G.V[blocker].el; bl?.classList.add('hit'); setTimeout(() => bl?.classList.remove('hit'), 450); navigator.vibrate?.(15); }
    });
  } catch { return; }
  v.x = x0; v.y = y0; place(v); v.bumping = false;
}
const freeBay = () => [...G.open].sort((a, b) => a - b).find(i => G.bays[i] < 0);
function tapVeh(id) {
  if (!G || G.over) return;
  const v = G.V[id]; if (!v || v.phase !== 'lot' || v.bumping) return;
  if (G.tow) {
    G.tow = false; view.classList.remove('towing');
    const bay = freeBay(); if (bay == null) return toast('No hay lugar en la parada');
    return go(v, bay, true);
  }
  navigator.vibrate?.(8);
  const blocker = v.ray.map(k => G.occ[k]).find(o => o >= 0);
  if (blocker != null) { G.moves++; bump(v, blocker); return; }
  const bay = freeBay();
  if (bay == null) return toast(G.open.size < BAYS ? '🅿️ La parada está llena: espera a que se vaya uno o abre un lugar 🔒' : '🅿️ La parada está llena: espera a que se vaya uno');
  go(v, bay);
}
async function go(v, bay, towed) {
  G.moves++; G.bays[bay] = v.id; v.bay = bay; v.phase = 'drive';
  for (const [x, y] of v.cells) G.occ[y * G.board.w + x] = -1;
  hud();
  try {
    if (towed) { // la grúa: se lo lleva y aparece en la parada
      await animate(320, p => { v.op = 1 - p; place(v); });
      v.x = G.lay.bx[bay]; v.y = G.lay.byc; v.ang = -90;
      await animate(320, p => { v.op = p; place(v); });
    } else await drive(v, route(v, bay));
  } catch { return; }
  v.phase = 'parked'; v.at = performance.now(); place(v);
  boardLoop();
}
// Suben los pasajeros que puedan, en orden; un vehículo lleno se va y libera su lugar
let boarding = false;
async function boardLoop() {
  if (boarding || !G) return; boarding = true;
  const g0 = G;
  try {
    while (G === g0 && !G.over && G.qi < G.queue.length) {
      const c = G.queue[G.qi], v = G.V.filter(x => x.phase === 'parked' && x.color === c && x.filled < x.cap).sort((a, b) => a.at - b.at)[0];
      if (!v) break;
      const el = G.pp.get(G.qi); G.pp.delete(G.qi);
      v.filled++; G.qi++; place(v);
      if (el) { el.classList.add('walk'); el.classList.remove('first'); el.style.left = (v.x - 20).toFixed(1) + 'px'; el.style.top = (v.y - v.L / 2 + 16).toFixed(1) + 'px'; setTimeout(() => { el.style.opacity = 0; }, 430); setTimeout(() => el.remove(), 800); }
      paintPeople(); hud(); if (G.spec.duel) duelPush();
      if (v.filled === v.cap) depart(v);
      await wait(170);
    }
  } catch {} finally { boarding = false; }
  check();
}
async function depart(v) {
  v.phase = 'leave';
  try {
    await wait(420);
    await animate(150, p => { v.lean = -Math.sin(p * Math.PI) * 2.5; place(v); });
    const y0 = v.y; let freed = false;
    await animate(1000, p => {
      const e = p * p * p; v.y = y0 - e * 340; v.op = 1 - Math.max(0, (p - 0.4) / 0.6); v.lean = 0; place(v);
      if (!freed && p > 0.55) { freed = true; G.bays[v.bay] = -1; boardLoop(); }
    });
  } catch { return; }
  v.phase = 'gone'; v.el?.remove(); v.el = null;
  check();
}
// ¿Ganó o se trabó? Trabado: todos los lugares abiertos ocupados por vehículos ya estacionados (nadie llegando ni yéndose)
// y el siguiente de la fila no tiene vehículo de su color
function check() {
  if (!G || G.over || boarding) return;
  if (G.qi >= G.queue.length) { if (!G.V.some(v => v.phase !== 'gone')) win(); return; }
  if (G.V.some(v => v.phase === 'drive' || v.phase === 'leave')) return;
  if (freeBay() != null) return;
  const c = G.queue[G.qi];
  if (!G.V.some(v => v.phase === 'parked' && v.color === c && v.filled < v.cap)) lose();
}
function overlay(html) { view.querySelector('.ar-end')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box">${html}</div></div>`); }
const closeOverlay = () => view?.querySelector('.ar-end')?.remove();
function lose() {
  if (G.spec.duel) { // en el duelo se reintenta solo, sin parar el reloj
    G.fails++; toast('😵 ¡Se llenó la parada! Otra vez (+15 s)'); duelPush(true);
    setTimeout(() => playBus('duel'), 900); return;
  }
  G.fails++; G.stuck = true;
  const locked = G.open.size < BAYS;
  overlay(`<div style="font-size:46px">😵</div><h2>¡Se llenó la parada!</h2><p class="muted" style="margin:0">El siguiente pasajero no tiene vehículo de su color.</p>
    ${locked ? `<p class="small" style="margin:0">Abre un lugar 🔒 y sigue:</p>${unlockButtons()}` : ''}
    <div class="grid2"><button class="btn ghost" onclick="closeBus()">Salir</button><button class="btn ghost" onclick="busRetry()">Reintentar</button></div>`);
}
// Botones para abrir un lugar con candado (foto gratis · monedas · gratis en pruebas)
function unlockButtons() {
  const p = pet(), cost = UNLOCK_COST, pn = partnerName();
  return `${partnerUid() ? `<button class="btn src-btn" onclick="busPhoto()">📸 Mandarle una foto a ${esc(pn || 'tu pareja')}<small>${G.spec.test ? 'En pruebas no se manda' : 'Gratis · le llega como instantánea'}</small></button>` : ''}
    ${G.expert ? '' : `<button class="btn ghost" onclick="busUnlock('coins')" ${!G.spec.test && !(p?.hatchedAt && coins(p) >= cost) ? 'disabled' : ''}>🪙 Abrir con monedas · ${G.spec.test ? 'gratis' : cost}</button>`}
    ${G.spec.test ? `<button class="btn ghost" onclick="busUnlock('free')">🧪 Abrir sin foto (prueba)</button>` : ''}`;
}
function busBay() {
  if (!G || G.over) return;
  if (G.spec.duel) return toast('En el duelo los lugares 🔒 no se abren');
  overlay(`<div class="lk-big">${LOCK_SVG}</div><h2>Lugar con candado</h2>
    <p class="small muted" style="margin:0">Se abre solo durante este nivel. Mándale una foto a ${esc(partnerName() || 'tu pareja')} (llega como instantánea) y es tuyo.</p>
    ${unlockButtons()}<button class="btn ghost" onclick="busCloseOverlay()">Ahora no</button>`);
}
function busCloseOverlay() { closeOverlay(); if (G?.stuck) lose(); }
function openBay() {
  const i = [...Array(BAYS).keys()].find(k => !G.open.has(k)); if (i == null) return;
  G.open.add(i); G.stuck = false; closeOverlay();
  const old = view.querySelector(`.bay[data-b="${i}"]`); old.outerHTML = bayHTML(i);
  const nb = view.querySelector(`.bay[data-b="${i}"]`); nb.classList.add('opened');
  navigator.vibrate?.([10, 30, 10]); toast('🔓 ¡Lugar abierto para este nivel!'); hud(); boardLoop();
}
async function busUnlock(how) {
  if (!G || G.over || G.spec.duel) return;
  if (how === 'free') { if (!G.spec.test) return; return openBay(); }
  const cost = UNLOCK_COST, p = pet();
  if (!G.spec.test) {
    if (G.expert) return;
    if (!p?.hatchedAt) return toast('Las monedas son de su mascota 🐣');
    if (coins(p) < cost) return toast(`Faltan monedas: cuesta ${cost} 🪙`);
    write(updateDoc(ref('pet', 'main'), { spent: increment(cost) }));
  }
  G.help++; openBay();
}
// Abrir con una foto: la cámara (o la galería en la computadora), vista previa con texto opcional y se manda como instantánea
let busPending = null;
function busPhoto(gallery) {
  if (!G || G.over) return;
  const got = async f => { try { busPending = await compressImage(f, 1080); } catch (e) { return photoError(e); } busPreview(); };
  if (!gallery && (ANDROID || IOS)) takePhoto('image/*', got); else nativePick('image/*', null, got);
}
function busPreview() {
  if (!G || !busPending) return;
  overlay(`<h2>📸 Para ${esc(partnerName() || 'tu pareja')}</h2><div class="snap-frame"><img src="${busPending}" alt=""></div>
    <input id="busSnapText" maxlength="80" placeholder="Escribe algo encima (opcional)" aria-label="Texto sobre la foto">
    <button class="btn" id="busSnapBtn" onclick="busSendPhoto()">${G.spec.test ? '🧪 Abrir (no se manda)' : 'Mandar y abrir el lugar 🔓'}</button>
    <div class="grid2"><button class="btn ghost" onclick="busPhoto()">Otra foto</button><button class="btn ghost" onclick="busPhoto(true)">🖼️ Galería</button></div>
    <button class="link" onclick="busCloseOverlay()">Cancelar</button>`);
}
async function busSendPhoto() {
  if (!G || !busPending) return;
  const b = $('busSnapBtn'); if (b) b.disabled = true;
  if (!G.spec.test) { await sendPhotoSnap(busPending, $('busSnapText')?.value.trim() || ''); G.photos++; }
  busPending = null; openBay();
}
function busRetry() { if (G) playBus(G.what); }
// Ayudas (monedas de la mascota; gratis en la zona de pruebas)
async function busHelp(k) {
  if (!G || G.over || G.expert || G.spec.duel) return;
  const [cost, , name] = HELP[k], p = pet();
  if (!G.spec.test) {
    if (!p?.hatchedAt) return toast('Las ayudas se pagan con las monedas de su mascota 🐣');
    if (coins(p) < cost) return toast(`Faltan monedas: ${name} cuesta ${cost} 🪙`);
  }
  if (k === 'tow' && freeBay() == null) return toast('No hay lugar en la parada para la grúa');
  if (!G.spec.test && !(await ask(`¿Usar «${name}» por ${cost} 🪙?`, { ok: 'Usar' }))) return;
  if (!G.spec.test) write(updateDoc(ref('pet', 'main'), { spent: increment(cost) }));
  G.help++;
  if (k === 'sort') {
    // Pasa adelante, en orden, a los pasajeros de colores que ya están en la parada (hasta llenar lo que les falta)
    const need = {}; for (const v of G.V) if (v.phase === 'parked' || v.phase === 'drive') need[v.color] = (need[v.color] || 0) + v.cap - v.filled;
    const rest = G.queue.slice(G.qi), front = [], back = [];
    for (const c of rest) { if (need[c] > 0) { need[c]--; front.push(c); } else back.push(c); }
    G.queue = [...G.queue.slice(0, G.qi), ...front, ...back];
    for (const el of G.pp.values()) el.remove(); G.pp.clear();
    paintPeople(); toast('🔀 Fila acomodada'); boardLoop();
  }
  if (k === 'tow') { G.tow = true; view.classList.add('towing'); toast('🏗️ Toca el vehículo que quieres sacar'); }
  hud();
}
function closeBus() {
  clearInterval(timer); const el = view; view = null; G = null; busPending = null; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); render(); }, 160);
}
function win() {
  if (!G || G.over) return;
  G.over = true; clearInterval(timer);
  const ms = Date.now() - G.t0, sp = G.spec, pt = pet(), p = partnerUid(), b = writeBatch(db);
  const s = G.help === 0 && G.fails === 0 ? 3 : G.help <= 1 ? 2 : 1;
  celebrate(); navigator.vibrate?.([20, 40, 60]);
  const info = `${G.board.queue.length} pasajeros en ${fmtMs(ms)} · ${G.moves} toques${G.help ? ` · ${G.help} ayuda${G.help > 1 ? 's' : ''}` : ''}`;
  if (sp.test) return overlay(`<div style="font-size:46px">🧪</div><h2>¡Prueba lista!</h2><p style="margin:0">${info}<br><span class="small muted">No se guardó nada</span></p><div class="grid2"><button class="btn ghost" onclick="closeBus()">Salir</button><button class="btn" onclick="playBus('${G.what}')">Otra vez</button></div>`);
  markActive();
  if (sp.duel) {
    G.duelEnd = { done: true, ms }; duelPush(true); countStat('acts', 'bus-duel');
    return overlay(`<div style="font-size:46px">⚔️</div><h2>¡Todos a bordo!</h2><p style="margin:0">${info}</p><p class="center ar-duel-res" style="margin:0">${duelResultTxt(duelDoc() || {})}</p><button class="btn ghost" onclick="closeBus()">Listo</button>`);
  }
  let msg = '', next = '';
  if (sp.day) {
    const day = todayKey(), d = daily(day), first = !Object.keys(d).some(k => k !== 'id' && d[k]?.ms);
    const r = { ms, moves: G.moves, help: G.help, fails: G.fails, at: Date.now(), ...(G.expert ? { expert: true } : {}) };
    b.set(ref('bus', 'd-' + day), { [uid()]: r }, { merge: true });
    if (first && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
    const them = p && d[p];
    msg = `${info}${first && pt?.hatchedAt ? '<br>¡Fuiste primero! +10 🪙 para la mascota' : ''}`;
    if (them) msg += `<br>${score(r) < score(them) ? '🏆 ¡Le ganaste a ' : score(r) === score(them) ? '🤝 Empate con ' : '😅 Te ganó '}${esc(nameOf(p))} (${fmtMs(them.ms)})`;
    notify('bus', { title: `🚏 ${meForPartner()} terminó el reto de La parada en ${fmtMs(ms)}`, body: them ? (score(r) < score(them) ? 'Te ganó hoy 😏' : 'Le ganaste hoy 🏆') : '¿Le ganas? El estacionamiento es el mismo para los dos', url: './?open=bus', tag: 'bus-' + day });
  } else {
    const pr = progress(), num = sp.num, had = pr.ls?.[num] || 0, coinsWon = num <= 10 ? 5 : sp.boss ? 20 : 10;
    b.set(ref('bus', 'p-' + uid()), { lv: Math.max(pr.lv || 1, num + 1), ls: { [num]: Math.max(had, s) }, ...(G.expert ? { lx: { [num]: true } } : {}) }, { merge: true });
    if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
    msg = `<span class="ar-stars">${stars(s)}</span>${G.expert ? '<br>💀 ¡En modo experto!' : ''}<br>${info}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}${num === LEVELS ? `<br><b>🏆 ¡Completaste los ${LEVELS} niveles!</b>` : ''}`;
    next = num < LEVELS ? `<button class="btn" onclick="playBus('l${num + 1}')">${isBoss(num + 1) ? '👑 ' : ''}Nivel ${num + 1} →</button>` : '';
    if (!had && (sp.boss || num === LEVELS)) notify('bus', { title: num === LEVELS ? `🏆 ${meForPartner()} completó los ${LEVELS} niveles de La parada` : `👑 ${meForPartner()} venció al jefe del nivel ${num} de La parada`, body: info, url: './?open=bus', tag: 'bus-l' + num });
  }
  write(b.commit()); countStat('acts', sp.day ? 'bus-day' : 'bus');
  overlay(`<div style="font-size:46px">🚌</div><h2>${sp.day ? '¡Reto del día listo!' : `¡${esc(sp.title)} listo!`}</h2><p style="margin:0" class="center">${msg}</p>
    <div class="${next ? 'grid2' : 'stack'}"><button class="btn ghost" onclick="closeBus()">${next ? 'Salir' : 'Listo'}</button>${next}</div>`);
}

on('bus profiles', () => { if ($('s-bus').classList.contains('active') && !view) render(); });
on('bus', duelWatch);
document.addEventListener('visibilitychange', () => { if (!document.hidden) duelWatch(); });
onShow('s-bus', render);
if (EMU) window.__busG = () => G; // solo emulador: para las pruebas automáticas
addEventListener('resize', () => { if (view) fit(); });
expose({ playBus, closeBus, busRetry, busHelp, busExpert, busTestLevel, busDuel, busGiveUp, busBay, busUnlock, busPhoto, busSendPhoto, busCloseOverlay });
