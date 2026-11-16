// Pura fruta 🍍: juego de combinar 3 (estilo tropical). El motor está en fruta-engine.js; aquí la pantalla, las
// animaciones, el progreso, el reto del día y el duelo.
// - Toca una fruta y luego la de al lado, o desliza el dedo. 3 o más iguales explotan.
// - Especiales: 4 en línea → 🔪 machete (fila o columna) · L/T → 🥥 coco explosivo (3×3) · 5 en línea → 🌺 flor (un color
//   entero) · cuadrito 2×2 → 🦜 lapa (se lleva una casilla que ayude). Juntar dos especiales hace un efecto más grande.
// - Obstáculos: 🍃 hojas (1-2 capas), 🪨 piedras (1-2 golpes, se rompen con jugadas al lado), 🕸️ bejucos (amarran la fruta),
//   🍍 piñas que hay que bajar hasta el fondo.
// - 100 niveles (playa, selva, volcán), 1-3 estrellas según los movimientos que sobran; ayudas con monedas de la mascota.
// Datos (colección «fruta»): p-<uid> { lv, ls{n: estrellas}, best{n: puntos}, dw } · d-<día> { <uid>: { score, at } } ·
//   duel { did, level, seed, from, to, state, at, p{ uid: { won, left, score, at } }, winner, counted } ·
//   lv-<n> { on, level{…} } (niveles hechos en Administración → Juegos; reemplazan al generado).
import { setDoc, updateDoc, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, db, esc, on, onShow, expose, toast, write, ref, uid, partnerUid, nameOf, partnerName, todayKey, celebrate, syncBack,
         markActive, countStat, ask } from './core.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';
import { pet, coins } from './pet.js';
import { isOwner } from './gifts.js';
import * as E from './fruta-engine.js';

/* ---------- Datos ---------- */
const doc = id => S.data.fruta?.find(d => d.id === id) || null;
const progress = (id = uid()) => doc('p-' + id) || {};
const myLevel = () => progress().lv || 1;
const daily = (day = todayKey()) => doc('d-' + day) || {};
const duelDoc = () => doc('duel');
const cfg = () => doc('cfg') || {};
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
// Nivel publicado desde Administración (si hay) o el generado
export function levelOf(L) {
  const c = doc('lv-' + L);
  return c?.on && c.level ? { ...E.levelSpec(L), ...c.level, num: L, title: `${E.isBoss(L) ? '👑 ' : ''}Nivel ${L}`, custom: true } : E.levelSpec(L);
}
export const HELPS = { hammer: [10, '🔨', 'Martillo', 'Rompe una casilla'], shuffle: [8, '🔀', 'Mezclar', 'Revuelve las frutas'], plus: [15, '➕', '+5', 'Cinco movimientos más'], lapa: [12, '🦜', 'Lapa', 'Una fruta se vuelve lapa'] };
const helpCost = k => cfg().helps?.[k] ?? HELPS[k][0];
const coinsFor = L => cfg().coins?.[E.isBoss(L) ? 'boss' : L <= 10 ? 'easy' : 'normal'] ?? (L <= 10 ? 5 : E.isBoss(L) ? 20 : 10);
export const frutaAlerts = () => { const d = duelDoc(); return d?.state === 'invite' && d.to === uid() && Date.now() - d.at < 2 * 864e5 ? 1 : d?.state === 'on' && [d.from, d.to].includes(uid()) && !d.p?.[uid()] ? 1 : 0; };

/* ---------- Pantalla principal ---------- */
function render() {
  const el = $('s-fruta'); if (!el) return;
  const L = Math.min(myLevel(), E.LEVELS), pr = progress(), st = pr.ls || {}, done = myLevel() > E.LEVELS, p = partnerUid();
  const total = Object.values(st).reduce((a, b) => a + b, 0), sp = levelOf(L), [ze, zn] = E.zoneOf(L);
  const d = daily(), me = d[uid()], them = p && d[p];
  const theirs = p ? progress(p).ls || {} : {};
  const lvBtn = n => n > myLevel() ? `<button disabled aria-label="Nivel ${n} bloqueado"><b>${n}</b><small>${E.isBoss(n) ? '👑' : '🔒'}</small></button>`
    : `<button class="${n === myLevel() ? 'cur' : ''}${E.isBoss(n) ? ' boss' : ''}" onclick="playFruta('l${n}')" aria-label="Nivel ${n}"><b>${n}</b><small>${st[n] ? stars(st[n]) : n === myLevel() ? 'nuevo' : E.isBoss(n) ? '👑' : ''}</small>${theirs[n] ? `<i class="fr-them" title="${esc(nameOf(p))}: ${theirs[n]} estrellas">${theirs[n]}★</i>` : ''}</button>`;
  const zone = (a, b) => { const [e, nm] = E.zoneOf(a); return `<span class="label fr-zone">${e} ${nm} · ${a}–${b}</span><div class="ar-levels">${Array.from({ length: b - a + 1 }, (_, i) => lvBtn(a + i)).join('')}</div>`; };
  el.innerHTML = `${backBar('Pura fruta', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${isOwner() ? `<details class="glass stack ar-test"><summary class="label">🧪 Zona de pruebas · solo tú</summary>
      <div class="add-row" style="margin-top:8px"><input id="frTestLv" type="number" min="1" max="${E.LEVELS}" inputmode="numeric" placeholder="Probar nivel (1-${E.LEVELS})" aria-label="Nivel a probar"><button class="btn small" onclick="frutaTest()">Probar</button></div>
      <p class="tiny muted" style="margin:0">Sin guardar nada y con ayudas gratis. Los niveles se editan en Administración → Juegos.</p></details>` : ''}
    <div class="glass stack ar-hero fr-hero"><div class="ar-hero-ic">${done ? '🏆' : sp.boss ? '👑' : ze}</div>
      <div class="stack" style="gap:2px;align-items:center"><span class="label">${done ? `¡Completaste los ${E.LEVELS} niveles!` : `Nivel ${L} de ${E.LEVELS} · ${zn}${sp.boss ? ' · jefe' : ''}`}</span>
      <span class="small">${goalsTxt(sp)}</span><span class="tiny muted">${sp.moves} movimientos</span></div>
      <button class="btn" onclick="playFruta('l${L}')">${done ? `Repetir el ${L}` : `Jugar nivel ${L}`}</button>
      <div class="ar-bar"><i style="width:${Math.min(100, (myLevel() - 1) / E.LEVELS * 100)}%"></i></div></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo tablero para los dos</span></div>
      <p class="tiny muted" style="margin:0">25 movimientos: gana quien haga más puntos.</p>
      <div class="row"><span>Tú</span><b>${me ? me.score.toLocaleString('es') : '<span class="muted small">sin jugar</span>'}</b></div>
      ${p ? `<div class="row"><span>${esc(nameOf(p))}</span><b>${them ? them.score.toLocaleString('es') : '<span class="muted small">sin jugar</span>'}</b></div>` : ''}
      ${me && them ? `<p class="small center" style="margin:0"><b>${me.score === them.score ? '¡Empate! 🤝' : me.score > them.score ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`}</b></p>` : ''}
      ${me ? '<p class="tiny muted center" style="margin:0">Mañana hay otro 😉</p>' : `<button class="btn ghost" onclick="playFruta('day')">Jugar el reto de hoy</button>`}</div>
    ${duelCard()}
    <div class="glass stack">${zone(1, 33)}${zone(34, 66)}${zone(67, 100)}</div>
    <p class="tiny muted center" style="margin:0 8px">Junta 3 o más frutas iguales. Con 4 en línea sale un 🔪 machete, en L o T un 🥥 coco explosivo, con 5 en línea una 🌺 flor y con un cuadrito una 🦜 lapa. Junten dos especiales para un efecto más grande. Ayudas con las monedas de su mascota 🪙.</p>`;
}
function goalsTxt(sp) {
  const g = sp.goals || {}, out = [];
  for (let c = 0; c < 6; c++) if (g['c' + c]) out.push(`${g['c' + c]} ${E.FRUITS[c][0]}`);
  if (g.leaf) out.push('🍃 limpiar las hojas'); if (g.stone) out.push('🪨 romper las piedras'); if (g.pinas) out.push(`🍍 bajar ${sp.pinas || 3} piñas`);
  return out.join(' · ') || 'Hacer puntos';
}
function frutaTest() { const n = Number($('frTestLv')?.value); if (!(n >= 1 && n <= E.LEVELS)) return toast(`Escribe un nivel del 1 al ${E.LEVELS}`); playFruta('t' + n); }

/* ---------- Duelo (cada uno juega cuando pueda; gana quien lo pase con más movimientos de sobra) ---------- */
function duelCard() {
  const d = duelDoc(), p = partnerUid(), pn = esc(partnerName()); if (!p) return '';
  const mine = d?.p?.[uid()], theirs = d?.p?.[p], fresh = d && Date.now() - d.at < 2 * 864e5;
  const wins = `<span class="tiny muted">Ganados: tú ${progress().dw || 0} · ${pn} ${progress(p).dw || 0}</span>`;
  let body;
  if (fresh && d.state === 'invite' && d.from === uid()) body = `<p class="small" style="margin:0">Esperando a que ${pn} acepte el duelo del nivel ${d.level}… ⏳</p><button class="btn ghost small" onclick="frutaDuel('cancel')">Cancelar</button>`;
  else if (fresh && d.state === 'invite' && d.to === uid()) body = `<p style="margin:0"><b>${esc(nameOf(d.from))} te reta en el nivel ${d.level}.</b> Las mismas frutas para los dos; gana quien lo pase con más movimientos de sobra.</p>
    <div class="grid2"><button class="btn ghost" onclick="frutaDuel('decline')">Ahora no</button><button class="btn" onclick="frutaDuel('accept')">⚔️ Aceptar</button></div>`;
  else if (d?.state === 'on' && [d.from, d.to].includes(uid())) body = mine
    ? `<p class="small" style="margin:0">Ya jugaste: ${resTxt(mine)}. Esperando a ${pn}… ⏳</p>`
    : `<p class="small" style="margin:0">Duelo del nivel ${d.level}${theirs ? ` · ${pn} ya jugó` : ''}. Tienes un solo intento.</p><button class="btn" onclick="playFruta('duel')">⚔️ Jugar el duelo</button>`;
  else if (Math.min(myLevel(), progress(p).lv || 1) < 2) body = `<p class="tiny muted" style="margin:0">Cuando los dos pasen el nivel 1, aquí pueden retarse en un nivel: las mismas frutas para los dos y gana quien lo pase con más movimientos de sobra.</p>`;
  else body = `${d?.state === 'done' ? `<p class="small" style="margin:0">Último duelo (nivel ${d.level}): ${d.winner === uid() ? 'ganaste tú 🏆' : d.winner ? `ganó ${esc(nameOf(d.winner))}` : 'empate 🤝'}</p>` : ''}
    <p class="tiny muted" style="margin:0">Reta a ${pn} en un nivel que ya pasaron los dos: las mismas frutas y gana quien lo pase con más movimientos de sobra.</p>
    <div class="add-row"><input id="frDuelLv" type="number" min="1" max="${Math.max(1, Math.min(myLevel(), progress(p).lv || 1) - 1)}" inputmode="numeric" placeholder="Nivel (1-${Math.max(1, Math.min(myLevel(), progress(p).lv || 1) - 1)})" aria-label="Nivel del duelo"><button class="btn small" onclick="frutaDuel('invite')">Retar</button></div>`;
  return `<div class="glass stack"><div class="row"><span class="label">⚔️ Duelo</span>${wins}</div>${body}</div>`;
}
const resTxt = r => r.won ? `lo pasaste con ${r.left} de sobra (${r.score.toLocaleString('es')} pts)` : `no lo pasaste (${r.score.toLocaleString('es')} pts)`;
const duelScore = r => !r ? -1 : (r.won ? 1e9 + r.left * 1e6 : 0) + r.score;
function frutaDuel(what) {
  const d = duelDoc(), p = partnerUid(); if (!p) return;
  if (what === 'invite') {
    const max = Math.max(1, Math.min(myLevel(), progress(p).lv || 1) - 1), L = Number($('frDuelLv')?.value) || max;
    if (L < 1 || L > max) return toast(`Elige un nivel del 1 al ${max}`);
    write(setDoc(ref('fruta', 'duel'), { did: String(Date.now()), level: L, seed: Math.floor(Math.random() * 2 ** 31), from: uid(), to: p, state: 'invite', at: Date.now(), p: {} }));
    notify('fruta', { title: `⚔️ ${meForPartner()} te reta en Pura fruta`, body: `Nivel ${L}: las mismas frutas para los dos. ¡Acepta!`, url: './?open=fruta', tag: 'fruta-duel' });
    return toast('Reto enviado ⚔️');
  }
  if (!d) return;
  if (what === 'accept') { write(updateDoc(ref('fruta', 'duel'), { state: 'on', at: Date.now() })); notify('fruta', { title: `⚔️ ${meForPartner()} aceptó el duelo de Pura fruta`, body: `Nivel ${d.level}: ya pueden jugarlo`, url: './?open=fruta', tag: 'fruta-duel' }); }
  if (what === 'decline') write(updateDoc(ref('fruta', 'duel'), { state: 'declined' }));
  if (what === 'cancel') write(updateDoc(ref('fruta', 'duel'), { state: 'cancelled' }));
}
function duelWatch() {
  const d = duelDoc(); if (!d || d.state !== 'on' || !S.me) return;
  const p = partnerUid(), a = d.p?.[uid()], b = d.p?.[p];
  if (a && b) {
    const w = duelScore(a) === duelScore(b) ? null : duelScore(a) > duelScore(b) ? uid() : p;
    write(updateDoc(ref('fruta', 'duel'), { state: 'done', winner: w }));
    if (w) write(setDoc(ref('fruta', 'p-' + w), { dw: increment(1) }, { merge: true }));
  }
}

/* ---------- Jugar ---------- */
let G = null, view = null, busy = false, hintT = null, sel = -1;
function specOf(what) {
  if (what === 'day') return { ...E.dailySpec(todayKey()), what };
  if (what === 'duel') { const d = duelDoc(); return d ? { ...levelOf(d.level), seed: d.seed, duel: d.did, what, title: `⚔️ Duelo · nivel ${d.level}` } : null; }
  const t = /^t(\d+)$/.exec(what); if (t) return isOwner() ? { ...levelOf(Number(t[1])), test: true, what, title: '🧪 Nivel ' + t[1] } : null;
  if (what?.custom) return { ...what, test: true }; // desde el editor de Administración
  const m = /^l(\d+)$/.exec(what); const L = Math.max(1, Math.min(E.LEVELS, m ? Number(m[1]) : myLevel()));
  return { ...levelOf(L), what };
}
export function playFruta(what, seed) {
  const spec = specOf(what); if (!spec) return;
  if (spec.day && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  if (spec.duel && duelDoc()?.p?.[uid()]) return toast('Ya jugaste este duelo');
  const st = E.createGame(spec, seed ?? (spec.day || spec.duel ? spec.seed : spec.seed + Math.floor(Math.random() * 1e6)));
  G = { spec, st, els: new Map(), pos: new Map(), help: 0, startAt: Date.now() };
  view?.remove();
  view = document.createElement('div'); view.className = 'dialog fr-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Pura fruta');
  document.body.appendChild(view); syncBack();
  paintView(); hintLater();
}
const CELL = () => Math.min(48, Math.floor((Math.min(innerWidth, 460) - 28) / G.st.w));
function paintView() {
  const { st, spec } = G, c = CELL(), test = spec.test;
  view.innerHTML = `<div class="fr-top"><button class="icon-btn" aria-label="Salir" onclick="closeFruta()">✕</button>
      <div class="fr-title"><b>${esc(spec.title)}</b><span class="tiny">${spec.day ? 'Gana quien haga más puntos' : goalsTxt(spec)}</span></div>
      <div class="fr-moves"><span class="tiny">Movimientos</span><b id="frMoves">${st.moves}</b></div></div>
    <div class="fr-goals" id="frGoals"></div>
    <div class="fr-score"><span id="frScore">0</span><div class="fr-sbar"><i id="frSbar"></i></div></div>
    <div class="fr-board" id="frBoard" style="width:${st.w * c + 12}px;height:${st.h * c + 12}px;--c:${c}px"></div>
    <div class="fr-helps">${Object.entries(HELPS).map(([k, [, e, n]]) => `<button class="fr-help" id="frH-${k}" onclick="frutaHelp('${k}')" ${spec.duel || spec.day && k === 'plus' ? 'disabled' : ''}><span>${e}</span><b>${n}</b><small>${test ? 'gratis' : helpCost(k) + ' 🪙'}</small></button>`).join('')}</div>`;
  const board = $('frBoard'), frag = document.createDocumentFragment();
  for (let i = 0; i < st.n; i++) if (st.mask[i]) { const t = document.createElement('div'); t.className = 'fr-tile'; t.dataset.i = i; place(t, i); frag.appendChild(t); }
  board.appendChild(frag);
  syncTiles({ leaf: st.leaf, stone: st.stone, vine: st.vine });
  for (let i = 0; i < st.n; i++) if (st.cells[i]) addPiece(st.cells[i], i);
  board.addEventListener('pointerdown', onDown);
  hud();
}
const xy = i => [(i % G.st.w) * CELL() + 6, Math.floor(i / G.st.w) * CELL() + 6];
function place(el, i, dy = 0) { const [x, y] = xy(i); el.style.transform = `translate(${x}px, ${y + dy}px)`; }
function pieceClass(p) { return `fr-p ${p.t === 'P' ? 'pina' : 't' + p.t}${p.sp ? ' sp-' + p.sp : ''}`; }
function addPiece(p, i, fromAbove = 0) {
  const el = document.createElement('div'); el.className = pieceClass(p); el.innerHTML = '<i class="g"></i>'; el.dataset.id = p.id;
  if (fromAbove) { el.style.transition = 'none'; place(el, i, -fromAbove * CELL()); $('frBoard').appendChild(el); void el.offsetWidth; el.style.transition = ''; place(el, i); }
  else { place(el, i); $('frBoard').appendChild(el); }
  G.els.set(p.id, el); G.pos.set(p.id, i);
  return el;
}
function syncTiles(t) {
  for (const tile of $('frBoard')?.querySelectorAll('.fr-tile') || []) {
    const i = Number(tile.dataset.i), L = t.leaf[i], s = t.stone[i];
    tile.className = `fr-tile${L ? ' l' + L : ''}${s ? ' st s' + s : ''}${t.vine[i] ? ' vn' : ''}`;
  }
}
function hud() {
  if (!G || !view) return;
  const { st } = G, gl = E.goalList(st).filter(g => !(G.spec.day && g.k === 'score'));
  $('frMoves').textContent = st.moves; $('frScore').textContent = st.score.toLocaleString('es');
  $('frGoals').innerHTML = gl.map(g => `<span class="fr-goal ${g.have >= g.need ? 'ok' : ''}">${g.fruit != null ? `<i class="fr-mini t${g.fruit}"><i class="g"></i></i>` : g.k === 'leaf' ? '🍃' : g.k === 'stone' ? '🪨' : g.k === 'pinas' ? '🍍' : '⭐'}<b>${g.have >= g.need ? '✓' : `${g.have}/${g.need}`}</b></span>`).join('');
  const pct = G.spec.day ? Math.min(100, st.score / 300) : Math.round(gl.reduce((s, g) => s + Math.min(1, g.have / g.need), 0) / Math.max(1, gl.length) * 100);
  $('frSbar').style.width = pct + '%';
  const p = pet();
  for (const k of Object.keys(HELPS)) { const b = $('frH-' + k); if (b && !G.spec.test && !G.spec.duel) b.classList.toggle('poor', !(p?.hatchedAt && coins(p) >= helpCost(k))); }
}

// Tocar / deslizar
let down = null;
function cellAt(e) { const r = $('frBoard').getBoundingClientRect(), c = CELL(), x = Math.floor((e.clientX - r.left - 6) / c), y = Math.floor((e.clientY - r.top - 6) / c); return x >= 0 && y >= 0 && x < G.st.w && y < G.st.h ? y * G.st.w + x : -1; }
function onDown(e) {
  if (!G || busy) return;
  const i = cellAt(e); if (i < 0 || !G.st.mask[i]) return;
  if (G.hammer) { G.hammer = false; view.classList.remove('hammering'); return doSteps(E.hammer(G.st, i), true); }
  down = { i, x: e.clientX, y: e.clientY };
  const move = ev => {
    if (!down) return;
    const dx = ev.clientX - down.x, dy = ev.clientY - down.y; if (Math.hypot(dx, dy) < CELL() * 0.4) return;
    const j = Math.abs(dx) > Math.abs(dy) ? down.i + Math.sign(dx) : down.i + Math.sign(dy) * G.st.w; const a = down.i; down = null; cleanup();
    if (j >= 0 && j < G.st.n && E.adjacent(G.st, a, j)) trySwap(a, j);
  };
  const up = () => { if (down) tap(down.i); down = null; cleanup(); };
  const cleanup = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
function tap(i) {
  if (sel >= 0 && E.adjacent(G.st, sel, i)) { const a = sel; select(-1); return trySwap(a, i); }
  select(sel === i ? -1 : i);
}
function select(i) {
  if (sel >= 0) G.els.get(G.st.cells[sel]?.id)?.classList.remove('sel');
  sel = i; if (i >= 0) G.els.get(G.st.cells[i]?.id)?.classList.add('sel');
}
async function trySwap(a, b) {
  if (busy || !G || G.over) return;
  select(-1); clearHint();
  const steps = E.play(G.st, a, b);
  if (!steps) { // no hace combinación: va y vuelve
    const A = G.st.cells[a], B = G.st.cells[b]; if (!A || !B) return;
    const ea = G.els.get(A.id), eb = G.els.get(B.id); busy = true;
    place(ea, b); place(eb, a); await wait(170); place(ea, a); place(eb, b); await wait(170); busy = false; navigator.vibrate?.(8); return hintLater();
  }
  doSteps(steps);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function doSteps(steps, noMove) {
  if (!steps) return;
  busy = true; const g0 = G;
  for (const s of steps) {
    if (G !== g0 || !view) return;
    if (s.kind === 'swap') {
      const A = idAt(s.a), B = idAt(s.b);
      if (A) { G.pos.set(A, s.b); place(G.els.get(A), s.b); } if (B) { G.pos.set(B, s.a); place(G.els.get(B), s.a); }
      await wait(170);
    }
    if (s.kind === 'clear') {
      for (const f of s.fx) fx(f);
      for (const c of s.cleared) if (c.id) { const el = G.els.get(c.id); el?.classList.add('pop'); G.els.delete(c.id); G.pos.delete(c.id); setTimeout(() => el?.remove(), 260); }
      for (const m of s.made) { const el = addPiece(m, m.i); el.classList.add('born'); }
      syncTiles(s.tiles);
      if (s.chain >= 2) cheer(s.chain); if (s.made.length) navigator.vibrate?.(12);
      $('frScore').textContent = s.score.toLocaleString('es');
      await wait(s.fx.length ? 320 : 240);
    }
    if (s.kind === 'fall') {
      // Posición final de cada fruta (una recién nacida puede moverse otra vez en la misma caída)
      const fin = new Map(); for (const m of [...s.born, ...s.moves]) fin.set(m.id, m.to);
      const bornIds = new Set(s.born.map(b => b.id)), perCol = {};
      for (const b of s.born) { const x = fin.get(b.id) % G.st.w; perCol[x] = (perCol[x] || 0) + 1; }
      for (const b of s.born) addPiece({ id: b.id, t: b.t, sp: null }, fin.get(b.id), perCol[fin.get(b.id) % G.st.w] + 1);
      for (const [id, to] of fin) if (!bornIds.has(id)) { const el = G.els.get(id); G.pos.set(id, to); if (el) place(el, to); }
      await wait(210);
    }
    if (s.kind === 'pinas') { for (const p of s.got) { const el = G.els.get(p.id); el?.classList.add('gone'); G.els.delete(p.id); setTimeout(() => el?.remove(), 400); } toast('🍍 ¡Piña abajo!'); await wait(300); }
    if (s.kind === 'shuffle') { toast('🔀 No quedaban jugadas: se mezcló el tablero'); repaintPieces(); await wait(400); }
    if (s.kind === 'bonus') { cheer(0, '¡Fruta extra!'); for (const x of s.ids) G.els.get(x.id)?.classList.add('sp-' + x.sp); await wait(450); }
    hud();
  }
  repaintPieces(); // por si algo quedó desfasado, se reconcilia con el estado real
  busy = false; hud();
  if (G.st.moves <= 0 || E.won(G.st)) return end();
  hintLater();
}
const idAt = i => [...G.pos.entries()].find(([, p]) => p === i)?.[0];
function repaintPieces() {
  const { st } = G, keep = new Set();
  for (let i = 0; i < st.n; i++) { const p = st.cells[i]; if (!p) continue; keep.add(p.id); const el = G.els.get(p.id); if (el) { el.className = pieceClass(p); place(el, i); G.pos.set(p.id, i); } else addPiece(p, i); }
  for (const [id, el] of G.els) if (!keep.has(id)) { el.remove(); G.els.delete(id); G.pos.delete(id); }
  syncTiles(st);
}
function fx(f) {
  const b = $('frBoard'), c = CELL(), el = document.createElement('div'), [x, y] = f.at != null ? xy(f.at) : [0, 0];
  el.className = 'fr-fx fx-' + f.fx;
  if (f.fx === 'row' || f.fx === 'cross') { el.style.top = (y + c / 2 - 4) + 'px'; }
  if (f.fx === 'col') { el.style.left = (x + c / 2 - 4) + 'px'; }
  if (f.fx === 'cross') { const v = document.createElement('div'); v.className = 'fr-fx fx-col'; v.style.left = (x + c / 2 - 4) + 'px'; b.appendChild(v); setTimeout(() => v.remove(), 500); el.className = 'fr-fx fx-row'; }
  if (['boom', 'boom2', 'cross3', 'flor', 'all'].includes(f.fx)) { el.style.left = (x + c / 2) + 'px'; el.style.top = (y + c / 2) + 'px'; }
  if (f.fx === 'lapa') { const [x2, y2] = xy(f.to); el.textContent = '🦜'; el.style.left = (x + 4) + 'px'; el.style.top = (y + 4) + 'px'; el.style.setProperty('--dx', (x2 - x) + 'px'); el.style.setProperty('--dy', (y2 - y) + 'px'); }
  b.appendChild(el); setTimeout(() => el.remove(), 600);
}
function cheer(chain, text) {
  const words = ['¡Bien!', '¡Combo!', '¡Qué rico!', '¡Tropical!', '¡Pura vida!'], el = document.createElement('div');
  el.className = 'fr-cheer'; el.textContent = text || words[Math.min(words.length - 1, chain - 1)];
  $('frBoard')?.appendChild(el); setTimeout(() => el.remove(), 900);
}
// Pista: si no juegas en 5 segundos, dos frutas brillan
function hintLater() { clearHint(); hintT = setTimeout(() => { if (!G || busy) return; const m = E.findMove(G.st); if (m) for (const i of m) G.els.get(G.st.cells[i]?.id)?.classList.add('hint'); }, 5000); }
function clearHint() { clearTimeout(hintT); view?.querySelectorAll('.hint').forEach(e => e.classList.remove('hint')); }

// Ayudas (monedas de la mascota; gratis en pruebas)
async function frutaHelp(k) {
  if (!G || busy || G.over || G.spec.duel) return;
  const cost = helpCost(k), [, e, name] = HELPS[k], p = pet();
  if (!G.spec.test) {
    if (!p?.hatchedAt) return toast('Las ayudas se pagan con las monedas de su mascota 🐣');
    if (coins(p) < cost) return toast(`Faltan monedas: ${name} cuesta ${cost} 🪙`);
    if (!(await ask(`¿Usar «${name}» por ${cost} 🪙?`, { ok: 'Usar' }))) return;
    write(updateDoc(ref('pet', 'main'), { spent: increment(cost) }));
  }
  G.help++;
  if (k === 'hammer') { G.hammer = true; view.classList.add('hammering'); toast('🔨 Toca la casilla que quieres romper'); }
  if (k === 'shuffle') { E.shuffle(G.st); repaintPieces(); }
  if (k === 'plus') { G.st.moves += 5; G.st.movesMax += 5; hud(); toast('+5 movimientos'); }
  if (k === 'lapa') { const pool = []; for (let i = 0; i < G.st.n; i++) { const q = G.st.cells[i]; if (q && typeof q.t === 'number' && !q.sp && !G.st.vine[i]) pool.push(i); } const i = pool[Math.floor(Math.random() * pool.length)]; if (i != null) { G.st.cells[i].sp = 'l'; repaintPieces(); toast('🦜 ¡Una lapa! Júntala con otras frutas'); } }
  hud();
}

/* ---------- Final ---------- */
function overlay(html) { view.querySelector('.ar-end')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box">${html}</div></div>`); }
function end() {
  if (!G || G.over) return;
  const { st, spec } = G, win = E.won(st), s = E.starsOf(st), pt = pet(), p = partnerUid();
  clearHint();
  if (spec.test) { G.over = true; return overlay(`<div style="font-size:46px">${win ? '🧪' : '😅'}</div><h2>${win ? '¡Prueba superada!' : 'Se acabaron los movimientos'}</h2><p style="margin:0">${win ? stars(s) + ' · ' : ''}${st.score.toLocaleString('es')} puntos<br><span class="small muted">No se guardó nada</span></p><div class="grid2"><button class="btn ghost" onclick="closeFruta()">Salir</button><button class="btn" onclick="frutaRetry()">Otra vez</button></div>`); }
  if (!win && !spec.day && !spec.duel && !G.offered) { // ¿seguir con 5 más?
    G.offered = true;
    return overlay(`<div style="font-size:46px">😮</div><h2>¡Casi!</h2><p style="margin:0">${E.goalList(st).filter(g => g.have < g.need).map(g => `Faltan ${g.need - g.have} ${g.label}`).join(' · ')}</p>
      <button class="btn" onclick="frutaMore()">➕ 5 movimientos más · ${helpCost('plus')} 🪙</button><div class="grid2"><button class="btn ghost" onclick="closeFruta()">Salir</button><button class="btn ghost" onclick="frutaRetry()">Reintentar</button></div>`);
  }
  G.over = true; markActive(); countStat('acts', spec.day ? 'fruta-day' : spec.duel ? 'fruta-duel' : 'fruta');
  const b = writeBatch(db);
  if (spec.day) {
    const day = todayKey(), d = daily(day), first = !Object.keys(d).some(k => k !== 'id' && d[k]?.score != null), them = p && d[p];
    b.set(ref('fruta', 'd-' + day), { [uid()]: { score: st.score, at: Date.now(), help: G.help } }, { merge: true });
    if (first && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
    write(b.commit());
    notify('fruta', { title: `🍍 ${meForPartner()} hizo ${st.score.toLocaleString('es')} puntos en el reto de Pura fruta`, body: them ? (st.score > them.score ? 'Te ganó hoy 😏' : 'Le ganaste hoy 🏆') : '¿Le ganas? El tablero es el mismo para los dos', url: './?open=fruta', tag: 'fruta-' + day });
    celebrate();
    return overlay(`<div style="font-size:46px">🍍</div><h2>¡Reto del día listo!</h2><p style="margin:0" class="center"><b style="font-size:26px">${st.score.toLocaleString('es')}</b> puntos${first && pt?.hatchedAt ? '<br>¡Fuiste primero! +10 🪙' : ''}${them ? `<br>${st.score > them.score ? '🏆 ¡Le ganaste a ' : st.score === them.score ? '🤝 Empate con ' : '😅 Te ganó '}${esc(nameOf(p))} (${them.score.toLocaleString('es')})` : ''}</p><button class="btn" onclick="closeFruta()">Listo</button>`);
  }
  if (spec.duel) {
    const r = { won: win, left: win ? st.leftAtWin || 0 : 0, score: st.score, at: Date.now() };
    write(updateDoc(ref('fruta', 'duel'), { [`p.${uid()}`]: r }));
    notify('fruta', { title: `⚔️ ${meForPartner()} ya jugó el duelo de Pura fruta`, body: win ? `Lo pasó con ${r.left} movimientos de sobra. ¿Le ganas?` : 'No lo pasó… ¡es tu oportunidad!', url: './?open=fruta', tag: 'fruta-duel' });
    if (win) celebrate();
    return overlay(`<div style="font-size:46px">⚔️</div><h2>${win ? '¡Lo pasaste!' : 'No lo pasaste'}</h2><p style="margin:0">${resTxt(r)}</p><button class="btn" onclick="closeFruta()">Listo</button>`);
  }
  if (!win) { G.over = true; return overlay(`<div style="font-size:46px">😅</div><h2>Se acabaron los movimientos</h2><p style="margin:0">${E.goalList(st).filter(g => g.have < g.need).map(g => `Faltaron ${g.need - g.have} ${g.label}`).join(' · ')}</p><div class="grid2"><button class="btn ghost" onclick="closeFruta()">Salir</button><button class="btn" onclick="frutaRetry()">Reintentar</button></div>`); }
  const L = spec.num, pr = progress(), had = pr.ls?.[L] || 0, coinsWon = coinsFor(L), msgDoc = doc('msg-' + L);
  b.set(ref('fruta', 'p-' + uid()), { lv: Math.max(pr.lv || 1, L + 1), ls: { [L]: Math.max(had, s) }, best: { [L]: Math.max(pr.best?.[L] || 0, st.score) } }, { merge: true });
  if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
  write(b.commit());
  if (!had && (spec.boss || L === E.LEVELS)) notify('fruta', { title: L === E.LEVELS ? `🏆 ${meForPartner()} completó los ${E.LEVELS} niveles de Pura fruta` : `👑 ${meForPartner()} pasó el jefe del nivel ${L} de Pura fruta`, body: `${stars(s)} · ${st.score.toLocaleString('es')} puntos`, url: './?open=fruta', tag: 'fruta-l' + L });
  celebrate(); navigator.vibrate?.([20, 40, 60]);
  // Mensaje sorpresa que dejó la pareja para este nivel (Administración → Juegos)
  const surprise = msgDoc && msgDoc.to === uid() && msgDoc.text ? `<div class="fr-surprise">💌 ${esc(nameOf(msgDoc.from))} te dejó un mensaje:<br><b>${esc(msgDoc.text)}</b></div>` : '';
  overlay(`<div style="font-size:46px">🍹</div><h2>¡${esc(spec.title)} listo!</h2><p style="margin:0" class="center"><span class="ar-stars">${stars(s)}</span><br>${st.score.toLocaleString('es')} puntos${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}${L === E.LEVELS ? `<br><b>🏆 ¡Completaste los ${E.LEVELS} niveles!</b>` : ''}</p>${surprise}
    <div class="${L < E.LEVELS ? 'grid2' : 'stack'}"><button class="btn ghost" onclick="closeFruta()">Salir</button>${L < E.LEVELS ? `<button class="btn" onclick="playFruta('l${L + 1}')">${E.isBoss(L + 1) ? '👑 ' : ''}Nivel ${L + 1} →</button>` : ''}</div>`);
}
async function frutaMore() {
  const cost = helpCost('plus'), p = pet();
  if (!p?.hatchedAt || coins(p) < cost) return toast(`Faltan monedas: cuesta ${cost} 🪙`);
  write(updateDoc(ref('pet', 'main'), { spent: increment(cost) }));
  view.querySelector('.ar-end')?.remove(); G.st.moves += 5; G.help++; hud(); hintLater();
}
function frutaRetry() { if (G) playFruta(G.spec.custom && G.spec.test ? G.spec : G.spec.what); }
function closeFruta() {
  clearHint(); const el = view; view = null; G = null; busy = false; sel = -1; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); render(); }, 160);
}

on('fruta profiles pet', () => { if ($('s-fruta')?.classList.contains('active') && !view) render(); });
on('fruta', duelWatch);
onShow('s-fruta', render);
if (EMU) window.__frG = () => G; // solo emulador: pruebas automáticas
expose({ playFruta, closeFruta, frutaRetry, frutaMore, frutaHelp, frutaTest, frutaDuel });
