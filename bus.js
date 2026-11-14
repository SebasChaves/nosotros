// La parada: saca los vehículos del estacionamiento y llévalos a la parada para que suban los pasajeros de su color.
// - Estacionamiento visto desde arriba: autos (4 asientos), busetas (6) y buses (10) apuntando a un lado. Al tocarlos salen
//   si su camino hasta el borde está libre (si chocan, regresan) y se estacionan en un lugar de espera (4).
// - La fila de pasajeros sube sola, en orden, al vehículo de su color que llegó primero. Lleno = se va y libera el lugar.
//   Si la parada se llena y el siguiente de la fila no tiene vehículo de su color, se pierde.
// - Ayudas con monedas de la mascota: lugar extra, acomodar la fila y grúa (saca un vehículo bloqueado). 💀 Experto: sin ayudas.
// - 100 niveles, reto del día (el mismo para los dos) y duelo en vivo. Siempre tiene solución (generateLot).
// - Sorpresa (gifts.js, clave «bus»): hasta que el dueño la regale, solo él la ve.
// Datos: bus/p-<uid> { lv, ls{n: estrellas}, lx{n: experto}, dw } · bus/d-<día> { <uid>: { ms, moves, help, at } } ·
//   bus/duel { did, seed, size, from, to, state, at, startAt, p{uid:{n,total,done,ms,gaveUp,fails}}, winner, counted }.
import { setDoc, updateDoc, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, db, esc, icon, on, onShow, expose, toast, write, ref, uid, partnerUid, nameOf, partnerName,
         todayKey, celebrate, syncBack, markActive, countStat, ask } from './core.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';
import { pet, coins } from './pet.js';
import { isOwner, giftInfo, giftVisible, giftWrapped } from './gifts.js';

export const busVisible = () => giftVisible('bus');
export const busWrapped = () => giftWrapped('bus');

/* ---------- Generador (siempre tiene solución) ----------
   Vehículos rectos: auto (2 casillas, 4 asientos), buseta (3, 6) y bus (4, 10). Un vehículo sale si el camino desde su
   frente hasta el borde está libre. Se colocan con el truco de Flechas (orden de salida «o»: uno nuevo solo entra si su
   camino solo tiene vehículos que salen antes y no pisa el camino de uno que sale después), así que siempre hay un orden
   para sacarlos todos. La fila se arma simulando a alguien que los saca en ese orden con slotsGen lugares de espera; cada
   pasajero que se agrega es del color de un vehículo que esa persona tiene en la parada. Como el jugador tiene
   slots ≥ slotsGen lugares, sacando en ese orden nunca se traba. */
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const KINDS = [{ len: 2, cap: 4, name: 'auto' }, { len: 3, cap: 6, name: 'buseta' }, { len: 4, cap: 10, name: 'bus' }];
export const COLORS = ['#FF5A6E', '#4D8DFF', '#FFD23F', '#3DD68C', '#A66BFF', '#FF9A3C'];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function generateLot({ seed, w, h, count, colors, slotsGen, mix = [0.6, 0.3, 0.1], bias = 0.4 }) {
  const R = rng(seed), occ = new Int32Array(w * h).fill(-1), cover = new Float64Array(w * h).fill(-Infinity), list = [];
  const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const pickKind = () => { const r = R(); return r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2; };
  for (let tries = 0; list.length < count && tries < count * 400; tries++) {
    const x = Math.floor(R() * w), y = Math.floor(R() * h), d = Math.floor(R() * 4), kind = pickKind(), len = KINDS[kind].len, [dx, dy] = DIRS[d];
    const cells = []; let ok = true;
    for (let i = 0; i < len; i++) { const cx = x - dx * i, cy = y - dy * i; if (!inB(cx, cy) || occ[cy * w + cx] >= 0) { ok = false; break; } cells.push([cx, cy]); }
    if (!ok) continue;
    const ray = []; let hi = Infinity;
    for (let rx = x + dx, ry = y + dy; inB(rx, ry); rx += dx, ry += dy) { const k = ry * w + rx; ray.push(k); if (occ[k] >= 0) hi = Math.min(hi, list[occ[k]].o); }
    let lo = -Infinity; for (const [cx, cy] of cells) lo = Math.max(lo, cover[cy * w + cx]);
    if (!(lo < hi)) continue;
    const o = hi === Infinity ? (lo === -Infinity ? 0 : lo + 1) : lo === -Infinity ? hi - 1 : lo + (hi - lo) * (0.25 + R() * 0.5);
    const id = list.length;
    for (const [cx, cy] of cells) occ[cy * w + cx] = id;
    for (const k of ray) cover[k] = Math.max(cover[k], o);
    list.push({ id, cells, d, kind, cap: KINDS[kind].cap, o, ray });
  }
  const order = [...list].sort((a, b) => b.o - a.o); order.forEach((v, r) => { v.rank = r; });
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
export const LEVELS = 100, SLOTS = 4;
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
export const isBoss = L => L % 10 === 0;
// Dificultad: tamaño, cantidad de vehículos, colores, lugares que usa la solución (slotsGen) y qué tan «encadenada» es la fila
export function levelSpec(L) {
  const t = (L - 1) / (LEVELS - 1), boss = isBoss(L);
  const count = Math.round(L <= 3 ? 5 + L : lerp(9, 60, Math.pow(t, 0.85)) * (boss ? 1.12 : 1));
  const w = Math.round(lerp(5, 10, t)), h = Math.round(lerp(6, 14, t));
  const colors = L <= 3 ? 2 : L <= 12 ? 3 : L <= 35 ? 4 : L <= 65 ? 5 : 6;
  const slotsGen = L <= 25 ? 3 : L <= 50 ? (L % 3 ? 3 : 4) : 4;
  return { key: 'l' + L, num: L, title: `${boss ? '👑 ' : ''}Nivel ${L}`, seed: hash('parada-' + L), w, h, count, colors, slotsGen, slots: SLOTS, boss,
    bias: lerp(0.2, 0.6, t), mix: L <= 5 ? [1, 0, 0] : L <= 20 ? [0.7, 0.3, 0] : [0.55, 0.3, 0.15] };
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
const HELP = { slot: [15, '🅿️', 'Lugar extra', 'Un lugar de espera más en este nivel'], sort: [20, '🔀', 'Acomodar la fila', 'Pasa adelante a los pasajeros de los colores que ya están en la parada'], tow: [25, '🏗️', 'Grúa', 'Saca cualquier vehículo, aunque esté bloqueado'] };
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
      <p class="tiny muted" style="margin:0">Se ve tal cual, sin desbloquear ni guardar nada; las ayudas son gratis.</p></details>` : ''}
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
    <p class="tiny muted center" style="margin:0 8px">Toca un vehículo: sale si su camino está libre y se va a la parada. Los pasajeros suben solos al vehículo de su color. Si la parada se llena y el siguiente no tiene vehículo, pierdes: piensa qué sacar primero. Ayudas con las monedas de su mascota 🪙.</p>`;
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

/* ---------- Jugar ---------- */
let G = null, view = null, timer = null;
const C = 40; // casilla en el dibujo
function specOf(what) {
  if (what === 'day') return dailySpec();
  if (what === 'duel') { const d = duelDoc(); return d ? duelSpec(d) : null; }
  const t = /^t(\d+)$/.exec(String(what)); if (t) return isOwner() ? { ...levelSpec(Math.max(1, Math.min(LEVELS, Number(t[1])))), test: true, title: '🧪 Nivel ' + t[1] } : null;
  const m = /^l(\d+)$/.exec(String(what)); return levelSpec(Math.max(1, Math.min(LEVELS, m ? Number(m[1]) : myLevel())));
}
function playBus(what) {
  if (!busVisible() || busWrapped()) return;
  const spec = specOf(what); if (!spec) return;
  if (spec.day && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  const board = spec.board ??= generateLot(spec), occ = new Int32Array(board.w * board.h).fill(-1);
  for (const v of board.list) for (const [x, y] of v.cells) occ[y * board.w + x] = v.id;
  const keep = G && G.spec.key === spec.key && G.spec.duel ? { fails: G.fails + 1, t0: G.t0 } : null; // en el duelo, reintentar no reinicia el reloj
  G = { spec, what, board, occ, gone: new Set(), slots: [], slotsN: spec.slots, qi: 0, moves: 0, help: 0, fails: keep?.fails || 0, t0: keep?.t0 || (spec.duel ? duelDoc()?.startAt || Date.now() : Date.now()), over: false, busy: 0, tow: false,
    expert: !spec.test && !spec.duel && expertOn(), queue: [...board.queue] };
  view?.remove();
  view = document.createElement('div');
  view.className = 'dialog ar-view bus-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'La parada');
  document.body.appendChild(view); syncBack();
  paint();
  clearInterval(timer); timer = setInterval(() => { const t = $('busTime'); if (t && G && !G.over) t.textContent = fmtMs(Date.now() - G.t0); }, 500);
  if (spec.duel) { duelPush(true); duelWatch(); }
}
// Vehículo visto desde arriba, mirando a la derecha (se gira según su dirección)
function vehSVG(v, ang = 0) {
  const L = KINDS[v.kind].len * C, W = C * 0.78, col = COLORS[v.color], x0 = -L / 2 + 3, y0 = -W / 2;
  const win = v.kind === 0 ? `<rect x="${L / 2 - C * 0.62}" y="${y0 + 5}" width="${C * 0.26}" height="${W - 10}" rx="3" class="vw"/><rect x="${x0 + 6}" y="${y0 + 6}" width="${C * 0.2}" height="${W - 12}" rx="3" class="vw dim"/>`
    : `<rect x="${L / 2 - C * 0.58}" y="${y0 + 5}" width="${C * 0.22}" height="${W - 10}" rx="3" class="vw"/>${Array.from({ length: v.kind === 1 ? 3 : 5 }, (_, i) => `<rect x="${x0 + 8 + i * C * 0.55}" y="${y0 + 4}" width="${C * 0.36}" height="5" rx="2" class="vw dim"/><rect x="${x0 + 8 + i * C * 0.55}" y="${W / 2 - 9}" width="${C * 0.36}" height="5" rx="2" class="vw dim"/>`).join('')}`;
  return `<rect x="${x0}" y="${y0}" width="${L - 6}" height="${W}" rx="${C * 0.22}" fill="${col}" class="vb"/>
    <rect x="${x0 + 4}" y="${y0 + 4}" width="${L - 14}" height="${W - 8}" rx="${C * 0.16}" class="vr"/>${win}
    <circle cx="${L / 2 - 5}" cy="${y0 + 6}" r="2.6" class="vl"/><circle cx="${L / 2 - 5}" cy="${W / 2 - 6}" r="2.6" class="vl"/>
    <text class="vc" text-anchor="middle" dominant-baseline="central" transform="translate(${-C * 0.12} 1) rotate(${-ang})">${v.cap}</text>`;
}
const vehPos = v => { const xs = v.cells.map(c => c[0]), ys = v.cells.map(c => c[1]); return [(Math.min(...xs) + Math.max(...xs) + 1) / 2 * C, (Math.min(...ys) + Math.max(...ys) + 1) / 2 * C]; };
const ANG = [-90, 0, 90, 180];
function paint() {
  const b = G.board, W = b.w * C, H = b.h * C, sp = G.spec;
  view.innerHTML = `<div class="ar-top"><button class="icon-btn" data-v="0" aria-label="Salir" onclick="closeBus()">${icon('x')}</button>
      <div class="ar-title"><b>${G.expert ? '💀 ' : ''}${esc(sp.title)}</b><span class="tiny muted"><span id="busLeft"></span> · <span id="busTime">0:00</span></span></div>
      ${sp.duel || G.expert ? '' : `<span class="pill" id="busCoins"></span>`}</div>
    ${sp.duel ? `<div class="ar-opp" id="busOpp"><span>${esc(nameOf(partnerUid()))}</span><div><i></i></div><span class="n">0</span></div>` : ''}
    <div class="bus-queue" id="busQueue" aria-label="Fila de pasajeros"></div>
    <div class="bus-slots" id="busSlots"></div>
    <div class="bus-lot"><svg id="busSvg" viewBox="-6 -6 ${W + 12} ${H + 12}" preserveAspectRatio="xMidYMid meet">
      <rect x="-6" y="-6" width="${W + 12}" height="${H + 12}" rx="18" class="lot-bg"/>
      ${Array.from({ length: b.w - 1 }, (_, i) => `<line x1="${(i + 1) * C}" y1="4" x2="${(i + 1) * C}" y2="${H - 4}" class="lot-line"/>`).join('')}
      ${b.list.filter(v => !G.gone.has(v.id)).map(v => { const [x, y] = vehPos(v); return `<g class="veh" data-v="${v.id}" transform="translate(${x} ${y}) rotate(${ANG[v.d]})"><g class="vbody">${vehSVG(v, ANG[v.d])}</g></g>`; }).join('')}
    </svg></div>
    ${sp.duel ? `<div class="ar-bottom"><button class="btn ghost small" onclick="busGiveUp()">🏳️ Rendirme</button></div>`
      : G.expert ? '' : `<div class="bus-help">${Object.entries(HELP).map(([k, [cost, e, name]]) => `<button class="btn ghost small" onclick="busHelp('${k}')" aria-label="${name}">${e} ${name}<small>${sp.test ? 'gratis' : cost + ' 🪙'}</small></button>`).join('')}</div>`}`;
  $('busSvg').onclick = e => { const g = e.target.closest?.('.veh'); if (g) return tapVeh(Number(g.dataset.v)); nearTap(e); };
  paintQueue(); paintSlots(); hud();
}
// Toque fuera de un vehículo: el más cercano (dedos gordos)
function nearTap(e) {
  const svg = $('busSvg'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse()), cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), b = G.board;
  let best = -1, bd = Infinity;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const id = G.occ[y * b.w + x]; if (id < 0) continue;
    const d = Math.hypot(x * C + C / 2 - p.x, y * C + C / 2 - p.y); if (d < bd) { bd = d; best = id; }
  }
  if (best >= 0 && bd < C * 0.95) tapVeh(best);
}
function hud() {
  const n = G.board.queue.length;
  $('busLeft').textContent = `${G.qi} de ${n} pasajeros`;
  const c = $('busCoins'); if (c) { const p = pet(); c.textContent = G.spec.test ? '🪙 ∞' : `🪙 ${p?.hatchedAt ? coins(p) : 0}`; }
}
function paintQueue() {
  const next = G.queue.slice(G.qi, G.qi + 18);
  $('busQueue').innerHTML = next.length ? next.map((c, i) => `<i class="pax${i === 0 ? ' first' : ''}" style="--c:${COLORS[c]}"></i>`).join('') + (G.queue.length - G.qi > 18 ? `<span class="tiny muted">+${G.queue.length - G.qi - 18}</span>` : '')
    : '<span class="small muted">¡Todos a bordo! 🎉</span>';
}
function paintSlots() {
  $('busSlots').innerHTML = Array.from({ length: G.slotsN }, (_, i) => {
    const s = G.slots[i];
    return s ? `<div class="bus-slot full${s.leaving ? ' leaving' : ''}" style="--c:${COLORS[s.v.color]}"><svg viewBox="${-KINDS[s.v.kind].len * C / 2 - 4} ${-C / 2} ${KINDS[s.v.kind].len * C + 8} ${C}">${vehSVG(s.v)}</svg><b>${s.v.cap - s.rem}/${s.v.cap}</b></div>`
      : `<div class="bus-slot"><span>🅿️</span></div>`;
  }).join('');
}
// Camino libre: casillas hasta el borde. Devuelve { free, steps, blocker }
function trace(v) {
  let steps = 0; for (const k of v.ray) { const o = G.occ[k]; if (o >= 0) return { free: false, steps, blocker: o }; steps++; }
  return { free: true, steps };
}
function tapVeh(id) {
  if (!G || G.over) return;
  const v = G.board.list[id]; if (!v || G.gone.has(id)) return;
  const g = view.querySelector(`.veh[data-v="${id}"]`), body = g?.querySelector('.vbody');
  if (G.tow) { G.tow = false; view.classList.remove('towing'); if (G.slots.length >= G.slotsN) return toast('No hay lugar en la parada'); return leave(v, body, { free: true, steps: 0, towed: true }); }
  const tr = trace(v);
  navigator.vibrate?.(8);
  if (!tr.free) {
    const dist = tr.steps * C + C * 0.25;
    body?.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dist}px)`, offset: 0.45 }, { transform: 'translateX(0)' }], { duration: 260 + tr.steps * 45, easing: 'ease-in-out' });
    setTimeout(() => { const bl = view.querySelector(`.veh[data-v="${tr.blocker}"]`); bl?.classList.add('hit'); setTimeout(() => bl?.classList.remove('hit'), 420); }, 120 + tr.steps * 25);
    G.moves++; return;
  }
  if (G.slots.length >= G.slotsN) return toast('🅿️ La parada está llena: espera a que se vaya uno');
  leave(v, body, tr);
}
function leave(v, body, tr) {
  G.gone.add(v.id); G.moves++;
  for (const [x, y] of v.cells) G.occ[y * G.board.w + x] = -1;
  const slot = { v, rem: v.cap, arriving: true }; G.slots.push(slot);
  const g = body?.closest('.veh');
  const dist = (tr.steps + KINDS[v.kind].len + 1) * C;
  const done = () => { g?.remove(); slot.arriving = false; paintSlots(); boardLoop(); };
  if (tr.towed) { body?.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4) rotate(25deg)' }], { duration: 320, fill: 'forwards' }); setTimeout(done, 320); }
  else { body?.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${dist}px)`, opacity: 0.2 }], { duration: Math.min(650, 220 + tr.steps * 35), easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' }); setTimeout(done, Math.min(650, 220 + tr.steps * 35)); }
  paintSlots(); hud();
}
// Suben los pasajeros que puedan, de uno en uno; un vehículo lleno se va
let boarding = false;
async function boardLoop() {
  if (boarding || !G) return; boarding = true;
  const g0 = G;
  while (G === g0 && !G.over && G.qi < G.queue.length) {
    const c = G.queue[G.qi], s = G.slots.find(x => !x.arriving && !x.leaving && x.v.color === c && x.rem > 0);
    if (!s) break;
    s.rem--; G.qi++;
    const first = view.querySelector('.pax.first'); first?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 120 });
    await new Promise(r => setTimeout(r, 75));
    if (G !== g0) break;
    if (!s.rem) { s.leaving = true; paintSlots(); setTimeout(() => { if (G !== g0) return; G.slots.splice(G.slots.indexOf(s), 1); paintSlots(); boardLoop(); }, 380); }
    paintQueue(); paintSlots(); hud(); if (G.spec.duel) duelPush();
  }
  boarding = false;
  if (G !== g0 || G.over) return;
  if (G.qi >= G.queue.length && !G.slots.length) return win();
  // ¿Se trabó? La parada llena (sin contar los que se están yendo) y el siguiente no tiene vehículo de su color
  const parked = G.slots.filter(x => !x.leaving);
  if (parked.length >= G.slotsN && !parked.some(x => x.arriving) && G.qi < G.queue.length && !parked.some(x => x.v.color === G.queue[G.qi])) lose();
}
function overlay(html) { view.querySelector('.ar-end')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box">${html}</div></div>`); }
function lose() {
  if (G.spec.duel) { // en el duelo se reintenta solo, sin parar el reloj
    G.fails++; toast('😵 ¡Se llenó la parada! Otra vez (+15 s)'); duelPush(true);
    setTimeout(() => playBus('duel'), 900); return;
  }
  G.fails++;
  const p = pet(), cost = HELP.slot[0], can = !G.expert && (G.spec.test || (p?.hatchedAt && coins(p) >= cost));
  overlay(`<div style="font-size:46px">😵</div><h2>¡Se llenó la parada!</h2><p class="muted" style="margin:0">El siguiente pasajero no tiene vehículo de su color.</p>
    ${can ? `<button class="btn" onclick="busHelp('slot', true)">🅿️ Seguir con un lugar extra · ${G.spec.test ? 'gratis' : cost + ' 🪙'}</button>` : G.expert ? '<p class="tiny muted" style="margin:0">💀 Modo experto: sin ayudas.</p>' : ''}
    <div class="grid2"><button class="btn ghost" onclick="closeBus()">Salir</button><button class="btn ghost" onclick="busRetry()">Reintentar</button></div>`);
}
function busRetry() { if (G) playBus(G.what); }
// Ayudas (monedas de la mascota; gratis en la zona de pruebas)
async function busHelp(k, fromLose) {
  if (!G || G.over || G.expert || G.spec.duel) return;
  const [cost, e, name] = HELP[k], p = pet();
  if (!G.spec.test) {
    if (!p?.hatchedAt) return toast('Las ayudas se pagan con las monedas de su mascota 🐣');
    if (coins(p) < cost) return toast(`Faltan monedas: ${name} cuesta ${cost} 🪙`);
  }
  if (k === 'tow' && G.slots.length >= G.slotsN) return toast('No hay lugar en la parada para la grúa');
  if (!fromLose && !G.spec.test && !(await ask(`¿Usar «${name}» por ${cost} 🪙?`, { ok: 'Usar' }))) return;
  if (!G.spec.test) write(updateDoc(ref('pet', 'main'), { spent: increment(cost) }));
  G.help++;
  if (k === 'slot') { G.slotsN++; view.querySelector('.ar-end')?.remove(); paintSlots(); toast('🅿️ ¡Un lugar más!'); boardLoop(); }
  if (k === 'sort') {
    // Pasa adelante, en orden, a los pasajeros de colores que ya están en la parada (hasta llenar lo que les falta)
    const need = {}; for (const s of G.slots) need[s.v.color] = (need[s.v.color] || 0) + s.rem;
    const rest = G.queue.slice(G.qi), front = [], back = [];
    for (const c of rest) { if (need[c] > 0) { need[c]--; front.push(c); } else back.push(c); }
    G.queue = [...G.queue.slice(0, G.qi), ...front, ...back]; paintQueue(); toast('🔀 Fila acomodada'); boardLoop();
  }
  if (k === 'tow') { G.tow = true; view.classList.add('towing'); toast('🏗️ Toca el vehículo que quieres sacar'); }
  hud();
}
function closeBus() {
  clearInterval(timer); const el = view; view = null; G = null; if (!el) return;
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
expose({ playBus, closeBus, busRetry, busHelp, busExpert, busTestLevel, busDuel, busGiveUp });
