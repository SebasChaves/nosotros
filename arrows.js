// Flechas: rompecabezas de sacar flechas del tablero. Cada flecha es una línea (a veces con curvas) con punta; al tocarla
// avanza hacia donde apunta y sale si nada la bloquea; si choca, regresa y se pierde una vida (3, y cada 50 flechas sacadas
// se recupera una; sin vidas se puede seguir pagando monedas de la mascota). Tableros de 16 a 700 flechas con zoom.
// - Calentamiento (4×4 a 9×9), Difícil (de ~150 a ~700 flechas, con obstáculos que aparecen por nivel: MODS_INFO),
//   Reto del día (el mismo para los dos; crece en la semana), Contrarreloj (5 min) y Duelo en vivo (arrows/duel).
//   💀 Modo experto (por teléfono): sin pistas, sin recuperar vidas ni pagar para seguir.
//   Todo sale de una semilla: el mismo nivel es igual en los dos teléfonos. La partida a medias se guarda en el teléfono.
// - Sorpresa: hasta que el dueño lo «regala» desde Administración (couples/nosotros.features.arrows.on), solo lo ve él.
//   Al regalarlo, a la pareja le aparece envuelto en papel de regalo (Más, Inicio y juegos de la mascota) hasta que lo abre
//   (profiles/<uid>.prefs.unwrapped.arrows).
// Datos: arrows/p-<uid> { level, stars{n}, hard, hstars{n}, hx{n: experto}, tt (récord contrarreloj), dw (duelos ganados) }
//   · arrows/duel { did, seed, size, from, to, state invite|live|done|declined|cancelled, at, startAt, p{uid:{n,total,e,done,ms,gaveUp}}, winner } · arrows/d-<día> { <uid>: { ms, errors, hints, arrows, at } }.
import { setDoc, updateDoc, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, db, esc, icon, on, onShow, expose, toast, write, ref, coupleRef, profile, uid, partnerUid, nameOf, partnerName,
         todayKey, celebrate, syncBack, gates, markActive, countStat, ask } from './core.js';
import { backBar } from './lists.js';
import { isTester } from './testing.js';
import { notify, meForPartner } from './push.js';
import { pet, coins } from './pet.js';

/* ---------- Sorpresa: quién lo ve ---------- */
// El dueño (TESTERS). En el emulador los dos son «testers», así que ahí el dueño es quien entró primero a la pareja.
export const isOwner = () => {
  if (!EMU) return isTester();
  const m = Object.entries(S.settings.members || {}).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0));
  return !m.length || m[0][0] === uid();
};
export const giftInfo = () => S.settings.features?.arrows || {};
export const arrowsVisible = () => isOwner() || !!giftInfo().on;
// Puesto para la pareja, pero todavía envuelto (no lo ha abierto)
export const arrowsWrapped = () => !isOwner() && !!giftInfo().on && !profile(uid()).prefs?.unwrapped?.arrows;
gates['s-arrows'] = () => arrowsVisible() && !arrowsWrapped();
gates['notif:arrows'] = arrowsVisible;

/* ---------- Generador de tableros (siempre tienen solución) ----------
   Las flechas son líneas de 1 a 5 casillas (con curvas). Al tocarlas avanzan como serpiente siguiendo su punta: solo
   importa que el camino desde la punta hasta el borde esté libre. Cada flecha tiene un «orden» o (se sacan de mayor a
   menor). Una flecha nueva entra con orden t si en su camino solo hay flechas con orden mayor (se van antes) y ninguna de
   sus casillas está en el camino de una flecha con orden mayor (cover = el mayor orden que pasa por esa casilla).
   Así se llena más del 90 % del tablero, al principio hay pocas libres y hay cadenas largas de dependencias.
   Obstáculos (spec.mods): piedras y portales se ponen antes de generar (los caminos los respetan); candados, numeradas,
   bombas y encadenadas se reparten después usando ese orden de solución (rank: 0 = la primera que sale), así que
   siempre hay una forma de terminar. Hielo y giratorias no cambian la solución (las giratorias también se giran a mano). */
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // arriba, derecha, abajo, izquierda
const COLORS = ['#FF6B8B', '#FFB547', '#5BD1A0', '#6AA8FF', '#B78BFF', '#FF8A5C', '#4FD6E0', '#F7E05A'];
const PAIR_COLORS = ['#00E0FF', '#FF4FD8', '#9DFF4F', '#FFD84F', '#FF7A3D', '#B9A4FF', '#FFFFFF'];
const STONE = -2, PORTAL = -3;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// Camino desde (x, y) en dirección d sobre el tablero base: atraviesa portales, se corta en piedras (null) o en bucles.
function walk(N, base, portalTo, x, y, d, each) {
  const [dx, dy] = DIRS[d]; let hops = 0;
  for (;;) {
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= N || y >= N) return true;
    const k = y * N + x, b = base[k];
    if (b === STONE) return false;
    if (b === PORTAL) { if (++hops > 3) return false; const t = portalTo[k]; x = t % N; y = Math.floor(t / N); continue; }
    if (each(k) === false) return false;
  }
}
export function generate(spec) {
  const { seed, n: N, minLen = 1, maxLen = 1, mods = {} } = spec;
  const R = rng(seed), base = new Int8Array(N * N), occ = new Int32Array(N * N).fill(-1), cover = new Float64Array(N * N).fill(-Infinity), list = [];
  const portalTo = {}, portals = [], stones = [];
  const inB = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  // Piedras y portales (lejos de los bordes los portales; nunca pegados entre sí)
  const free = () => { for (let t = 0; t < 500; t++) { const k = Math.floor(R() * N * N); if (!base[k]) return k; } return -1; };
  for (let i = 0; i < (mods.stones || 0); i++) { const k = free(); if (k >= 0) { base[k] = STONE; stones.push(k); } }
  for (let i = 0; i < (mods.portals || 0); i++) {
    const a = free(); if (a < 0) break; base[a] = PORTAL;
    let b = -1; for (let t = 0; t < 200; t++) { const k = free(); if (k >= 0 && Math.abs(k % N - a % N) + Math.abs(Math.floor(k / N) - Math.floor(a / N)) > N / 3) { b = k; break; } }
    if (b < 0) { base[a] = 0; break; }
    base[b] = PORTAL; portalTo[a] = b; portalTo[b] = a; portals.push([a, b, PAIR_COLORS[i % PAIR_COLORS.length]]);
  }
  const idx = [...Array(N * N).keys()];
  for (let pass = 0; pass < 6; pass++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const k of idx) {
      if (occ[k] >= 0 || base[k]) continue;
      const x = k % N, y = Math.floor(k / N);
      for (const d of [0, 1, 2, 3].sort(() => R() - 0.5)) {
        const ray = new Set(); let hi = Infinity;
        const ok = walk(N, base, portalTo, x, y, d, rk => { if (rk === k) return false; ray.add(rk); if (occ[rk] >= 0) hi = Math.min(hi, list[occ[rk]].o); });
        if (!ok) continue;
        let lo = cover[k];
        if (!(lo < hi)) continue;
        const want = minLen + Math.floor(Math.pow(R(), 1.2) * (maxLen - minLen + 1));
        const cells = [[x, y]], used = new Set([k]);
        let px = x, py = y, pd = (d + 2) % 4; // el cuerpo crece hacia atrás desde la punta
        while (cells.length < want) {
          const side = R() < 0.5 ? 1 : 3, opts = cells.length === 1 ? [pd] : R() < 0.4 ? [(pd + side) % 4, pd, (pd + 4 - side) % 4] : [pd, (pd + side) % 4, (pd + 4 - side) % 4];
          let moved = false;
          for (const o of opts) {
            const nx = px + DIRS[o][0], ny = py + DIRS[o][1], nk = ny * N + nx;
            if (!inB(nx, ny) || base[nk] || occ[nk] >= 0 || used.has(nk) || ray.has(nk) || !(Math.max(lo, cover[nk]) < hi)) continue;
            lo = Math.max(lo, cover[nk]); cells.push([nx, ny]); used.add(nk); px = nx; py = ny; pd = o; moved = true; break;
          }
          if (!moved) break;
        }
        if (cells.length < minLen) continue;
        const o = hi === Infinity ? (lo === -Infinity ? 0 : lo + 1) : lo === -Infinity ? hi - 1 : lo + (hi - lo) * (0.25 + R() * 0.5);
        const id = list.length; cells.reverse(); // de la cola a la punta
        for (const [cx, cy] of cells) occ[cy * N + cx] = id;
        for (const rk of ray) cover[rk] = Math.max(cover[rk], o);
        list.push({ id, cells, d, o, c: COLORS[Math.floor(R() * COLORS.length)] });
        break;
      }
    }
  }
  // Orden de solución
  const byRank = [...list].sort((a, b) => b.o - a.o); byRank.forEach((a, r) => { a.rank = r; });
  const n = list.length, taken = new Set();
  const pickRank = (from, to, ok = () => true) => { for (let t = 0; t < 400; t++) { const r = Math.floor(from + R() * Math.max(1, to - from)); const a = byRank[Math.min(n - 1, r)]; if (a && !taken.has(a.id) && ok(a)) { taken.add(a.id); return a; } } return null; };
  const headOf = a => a.cells[a.cells.length - 1], dist = (a, b) => { const [ax, ay] = headOf(a), [bx, by] = headOf(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
  const rayArrows = a => { const s = new Set(); const [hx, hy] = headOf(a); walk(N, base, portalTo, hx, hy, a.d, k => { if (occ[k] >= 0) s.add(occ[k]); }); return s; };
  // 🔒 candados y 🔑 llaves: la llave sale antes que el candado (y lejos)
  for (let i = 0; i < (mods.locks || 0); i++) {
    const L = pickRank(n * 0.25, n * 0.95); if (!L) break;
    const K = pickRank(Math.max(0, L.rank * 0.3), L.rank, k => dist(k, L) > N / 3) || pickRank(0, L.rank);
    if (!K) { taken.delete(L.id); break; }
    const color = PAIR_COLORS[i % PAIR_COLORS.length]; L.lock = K.id; L.pc = color; K.key = L.id; K.pc = color;
  }
  // 🔢 numeradas: en el orden de solución
  const nums = []; for (let i = 0; i < (mods.nums || 0); i++) { const a = pickRank(n * 0.05, n * 0.9); if (a) nums.push(a); }
  nums.sort((a, b) => a.rank - b.rank).forEach((a, i) => { a.num = i + 1; });
  // 💣 bombas: hay que sacarlas antes de X flechas sacadas
  const slack = Math.max(8, Math.round(n * 0.06));
  for (let i = 0; i < (mods.bombs || 0); i++) { const a = pickRank(5, n * 0.45); if (a) a.bomb = a.rank + 1 + slack; }
  // 🔗 encadenadas: B sale junto con A si su camino solo depende de flechas que salen antes que A
  for (let i = 0, tries = 0; i < (mods.chains || 0) && tries < 300; tries++) {
    const A = pickRank(n * 0.1, n * 0.85); if (!A) break;
    const raA = rayArrows(A);
    const B = list.find(b => !taken.has(b.id) && b.rank > A.rank && dist(A, b) <= 6 && !raA.has(b.id) && (() => { const rb = rayArrows(b); return !rb.has(A.id) && [...rb].every(id => list[id].rank < A.rank); })());
    if (!B) { taken.delete(A.id); continue; }
    taken.add(B.id); A.chain = B.id; B.chain = A.id; i++;
  }
  // 🧊 hielo y 🔄 giratorias (no cambian la solución)
  for (let i = 0; i < (mods.ice || 0); i++) { const a = pickRank(0, n, x => !x.chain); if (a) { a.ice = true; taken.delete(a.id); } }
  for (let i = 0; i < (mods.rot || 0); i++) { const a = pickRank(0, n); if (a) { a.rot = true; a.d0 = (a.d + 1 + Math.floor(R() * 3)) % 4; } }
  return { list, base, portalTo, portals, stones, N };
}

/* ---------- Obstáculos y niveles ---------- */
export const MODS_INFO = {
  stones: ['🪨', 'Piedras', 'No se mueven nunca. Una flecha que apunta a una piedra no puede salir por ese lado.'],
  ice: ['🧊', 'Hielo', 'El primer toque solo rompe el hielo; el segundo la mueve. Si está bloqueada cuando la tocas, igual pierdes vida.'],
  locks: ['🔒', 'Candados', 'No se mueve hasta que saques la flecha con la 🔑 llave del mismo color.'],
  nums: ['🔢', 'Numeradas', 'Las flechas con número salen en orden: 1, 2, 3… Tocar una antes de tiempo cuesta una vida.'],
  bombs: ['💣', 'Bombas', 'Su número baja con cada flecha que sacas. Sácala antes de que llegue a 0 o explota y pierdes una vida.'],
  chains: ['🔗', 'Encadenadas', 'Dos flechas unidas salen juntas: las dos necesitan su camino libre al mismo tiempo.'],
  rot: ['🔄', 'Giratorias', 'Giran solas cada vez que sale una flecha pegada a ellas. Mantenlas presionadas para girarlas tú.'],
  portals: ['🌀', 'Portales', 'Una flecha que entra a un portal sale por el otro del mismo color y sigue derecho.'],
  fog: ['🌫️', 'Niebla', 'Solo ves lo que está cerca de la parte despejada. Lo demás se va descubriendo.'],
};
const MOD_FROM = { stones: 2, ice: 3, locks: 5, nums: 7, bombs: 9, chains: 11, rot: 13, portals: 15, fog: 17 }; // nivel difícil en que aparece
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function modsFor(keys, N, n0) {
  const m = {}, has = k => keys.includes(k);
  if (has('stones')) m.stones = Math.round(N * N * 0.035);
  if (has('portals')) m.portals = clamp(Math.round(N / 14), 1, 3);
  if (has('locks')) m.locks = clamp(Math.round(n0 / 90), 2, 6);
  if (has('nums')) m.nums = clamp(Math.round(n0 / 70), 4, 9);
  if (has('bombs')) m.bombs = clamp(Math.round(n0 / 150), 1, 3);
  if (has('chains')) m.chains = clamp(Math.round(n0 / 70), 2, 6);
  if (has('ice')) m.ice = Math.round(n0 * 0.08);
  if (has('rot')) m.rot = Math.round(n0 * 0.04);
  if (has('fog')) m.fog = true;
  return m;
}
// Tamaño según cuántas flechas se quieren (unas 0,3 × N² con líneas de 2 a 5)
const sizeFor = arrows => Math.max(8, Math.min(48, Math.round(Math.sqrt(arrows / 0.3))));
// Calentamiento: tableros chicos (4×4 a 9×9), sin obstáculos
export const levelSpec = L => ({ key: 'n' + L, title: 'Nivel ' + L, n: Math.min(9, 4 + Math.floor((L - 1) / 3)), minLen: 1, maxLen: L <= 3 ? 1 : Math.min(3, 1 + Math.floor((L - 1) / 4)), seed: hash('nivel-' + L), mods: {} });
// Difícil: de ~150 a ~700 flechas; cada pocos niveles aparece un obstáculo nuevo y después se mezclan
export const hardTarget = H => Math.min(700, 150 + (H - 1) * 40);
export const hardMods = H => {
  const intro = Object.entries(MOD_FROM).filter(([, f]) => f <= H).map(([k]) => k), newest = intro[intro.length - 1], R = rng(hash('mods-' + H));
  return intro.filter(k => k === newest || R() < (k === 'fog' ? 0.3 : 0.55));
};
export const newModAt = H => Object.entries(MOD_FROM).find(([, f]) => f === H)?.[0];
export const hardSpec = H => { const n0 = hardTarget(H), N = sizeFor(n0); return { key: 'h' + H, num: H, title: 'Difícil ' + H, n: N, minLen: 2, maxLen: 5, seed: hash('dificil-' + H), hard: true, mods: modsFor(hardMods(H), N, n0) }; };
// Reto del día: crece en la semana y cada día tiene sus obstáculos
const DAY_TARGET = [650, 250, 300, 350, 420, 500, 580]; // domingo..sábado
const DAY_MODS = [['fog', 'stones', 'locks'], ['stones', 'ice'], ['locks', 'ice'], ['nums', 'stones'], ['bombs', 'chains'], ['rot', 'portals'], ['stones', 'ice', 'locks', 'nums', 'bombs', 'chains', 'rot', 'portals']];
export const dailySpec = (day = todayKey()) => { const w = new Date(day + 'T12:00').getDay(), N = sizeFor(DAY_TARGET[w]); return { key: 'd' + day, title: 'Reto del día', n: N, minLen: 2, maxLen: 5, seed: hash('dia-' + day), day: true, hard: true, mods: modsFor(DAY_MODS[w], N, DAY_TARGET[w]) }; };
const TIMED_MS = 5 * 60e3;
const timedSpec = seed => { const N = sizeFor(270); return { key: 'tt', title: 'Contrarreloj', n: N, minLen: 2, maxLen: 5, seed, timed: true, mods: modsFor(['stones', 'ice'], N, 270) }; };
const DUEL_SIZES = { rapido: [100, 'Rápido'], normal: [250, 'Normal'], largo: [450, 'Largo'] };
const duelSpec = d => { const n0 = DUEL_SIZES[d.size]?.[0] || 250, N = sizeFor(n0); return { key: 'duel' + d.did, title: '⚔️ Duelo', n: N, minLen: 2, maxLen: 5, seed: d.seed, duel: d.did, mods: modsFor(['stones', 'ice'], N, n0) }; };
// Zona de pruebas (solo el dueño): tableros chicos con un obstáculo, todos juntos, y los modos en versión corta.
// No guardan nada (ni récords, ni monedas, ni partida a medias) ni mandan avisos.
const testSpec = kind => {
  const seed = Math.floor(Math.random() * 2 ** 31), all = kind === 'all' || kind === 'xp' || kind === 'duel', N = all ? 16 : 12, n0 = all ? 75 : 45;
  const keys = kind === 'tt' ? ['stones', 'ice'] : all ? Object.keys(MODS_INFO) : [kind];
  const title = kind === 'all' ? 'Prueba: todos' : kind === 'xp' ? 'Prueba experto' : kind === 'tt' ? 'Prueba contrarreloj' : kind === 'duel' ? 'Prueba duelo' : `Prueba: ${MODS_INFO[kind][1]}`;
  return { key: 'test', title: '🧪 ' + title, n: N, minLen: 2, maxLen: 4, seed, test: kind, hard: kind === 'xp', timed: kind === 'tt', fake: kind === 'duel', mods: modsFor(keys, N, n0) };
};
const boardOf = spec => (spec.board ??= generate(spec));

/* ---------- Datos ---------- */
const progress = (id = uid()) => S.data.arrows.find(d => d.id === 'p-' + id) || {};
const myLevel = () => progress().level || 1;
const myHard = () => progress().hard || 1;
const daily = (day = todayKey()) => S.data.arrows.find(d => d.id === 'd-' + day) || {};
const duelDoc = () => S.data.arrows.find(d => d.id === 'duel') || null;
const fmtMs = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
// Puntaje del reto y del duelo: tiempo + 5 s por error + 10 s por pista (menos es mejor)
const score = r => r.ms + (r.errors ?? r.e ?? 0) * 5000 + (r.hints || 0) * 10000;
// Partida a medias: se guarda en el teléfono (localStorage) para seguir después
const SAVE = 'futari-arrows-';
const loadSave = key => { try { return JSON.parse(localStorage.getItem(SAVE + key) || 'null'); } catch { return null; } };
const dropSave = key => { try { localStorage.removeItem(SAVE + key); } catch {} };
const expertOn = () => { try { return localStorage.getItem('futari-ar-expert') === '1'; } catch { return false; } };
const LIFE_EVERY = 50, CONTINUE_COST = 15; // cada 50 flechas sacadas se recupera una vida; seguir sin vidas cuesta 15 🪙
// Avisos para el puntito de Flechas: un duelo que te están pidiendo aceptar
export const arrowsAlerts = () => { const d = duelDoc(); return arrowsVisible() && !arrowsWrapped() && d?.state === 'invite' && d.to === uid() && Date.now() - d.at < 3600e3 ? 1 : 0; };

/* ---------- Pantalla ---------- */
function render() {
  if (!arrowsVisible()) { $('s-arrows').innerHTML = `${backBar('Flechas')}<p class="empty">Todavía no 😉</p>`; return; }
  const L = myLevel(), H = myHard(), pr = progress(), st = pr.stars || {}, hs = pr.hstars || {}, hx = pr.hx || {};
  const total = [...Object.values(st), ...Object.values(hs)].reduce((a, b) => a + b, 0);
  const d = daily(), me = d[uid()], p = partnerUid(), them = p && d[p], ds = dailySpec(), pp = p ? progress(p) : {};
  const surprise = isOwner() && !giftInfo().on, xp = expertOn();
  const cont = spec => { const s = loadSave(spec.key); return s ? ` · vas en ${s.removed.length} de ${s.total}` : ''; };
  const modList = m => Object.keys(m).map(k => MODS_INFO[k][0]).join(' ');
  const dayRow = (who, r) => `<div class="row"><span>${who}</span><span class="small">${r ? `${r.expert ? '💀 ' : ''}<b>${fmtMs(r.ms)}</b> · ${r.errors} ${r.errors === 1 ? 'error' : 'errores'}${r.hints ? ` · ${r.hints} 💡` : ''}` : '<span class="muted">sin terminar</span>'}</span></div>`;
  const winner = me && them ? (score(me) === score(them) ? '¡Empate! 🤝' : score(me) < score(them) ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`) : '';
  const lv = (n, cur, sv, pre, x = {}) => `<button class="${n === cur ? 'cur' : ''}" onclick="playArrows('${pre}${n}')" aria-label="Nivel ${n}"><b>${x[n] ? '💀' : ''}${n}</b><small>${sv[n] ? stars(sv[n]) : n === cur ? 'nuevo' : ''}</small></button>`;
  const hsp = hardSpec(H), nm = newModAt(H);
  $('s-arrows').innerHTML = `${backBar('Flechas', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${surprise ? `<div class="glass small" style="border-color:rgba(255,181,71,.5)">🔒 <b>Sorpresa:</b> solo tú lo ves. Cuando quieras regalarlo: Administración → Pruebas → 🎁 Sorpresa.</div>` : ''}
    ${testCard()}
    ${duelCard()}
    <div class="glass stack ar-hero hard"><div class="ar-hero-ic">🔥</div><div class="stack" style="gap:2px;align-items:center"><span class="label">Difícil · nivel ${H}</span>
      <span class="tiny muted">Unas ${hardTarget(H)} flechas${Object.keys(hsp.mods).length ? ' · ' + modList(hsp.mods) : ''}${cont(hsp)}</span>
      ${nm ? `<span class="small">✨ Nuevo: ${MODS_INFO[nm][0]} ${MODS_INFO[nm][1]}</span>` : ''}</div>
      <button class="btn" onclick="playArrows('h${H}')">${loadSave(hsp.key) ? 'Continuar' : `Jugar difícil ${H}`}</button>
      <label class="row ar-xp"><input type="checkbox" ${xp ? 'checked' : ''} onchange="arrowsExpert(this.checked)"><span class="small">💀 Modo experto: sin pistas, sin recuperar vidas ni pagar para seguir (difícil y reto)</span></label></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo para los dos</span></div>
      <p class="tiny muted" style="margin:0">Hoy: ${ds.n}×${ds.n} · ${modList(ds.mods)}${cont(ds)}. Crece durante la semana: el domingo es el más grande.</p>
      ${dayRow('Tú', me)}${p ? dayRow(esc(nameOf(p)), them) : ''}
      ${winner ? `<p class="small center" style="margin:0"><b>${winner}</b></p>` : ''}
      ${me ? '<p class="tiny muted center" style="margin:0">Mañana hay otro 😉</p>' : `<button class="btn ghost" onclick="playArrows('day')">${loadSave(ds.key) ? 'Continuar el reto' : 'Jugar el reto de hoy'}</button>`}</div>
    <div class="glass stack"><div class="row"><span class="label">⏱️ Contrarreloj</span><button class="btn small" onclick="playArrows('tt')">Jugar</button></div>
      <p class="tiny muted" style="margin:0">Saca todas las flechas que puedas en 5 minutos. Cada error resta 10 segundos.</p>
      <div class="row"><span class="small">Récord: tú <b>${pr.tt || 0}</b>${p ? ` · ${esc(nameOf(p))} <b>${pp.tt || 0}</b>` : ''}</span></div></div>
    <div class="glass stack"><div class="row"><span class="label">🌱 Calentamiento · nivel ${L}</span><button class="btn small" onclick="playArrows('n${L}')">Jugar</button></div>
      ${L > 1 ? `<div class="ar-levels">${Array.from({ length: L }, (_, i) => i + 1).reverse().slice(0, 30).map(n => lv(n, L, st, 'n')).join('')}</div>` : ''}</div>
    ${H > 1 ? `<div class="glass stack"><span class="label">🔥 Difíciles</span><div class="ar-levels">${Array.from({ length: H }, (_, i) => i + 1).reverse().map(n => lv(n, H, hs, 'h', hx)).join('')}</div></div>` : ''}
    <div class="glass stack"><span class="label">📖 Obstáculos</span>${Object.entries(MODS_INFO).map(([k, [e, t, txt]]) => `<p class="small" style="margin:0">${e} <b>${t}</b> <span class="tiny muted">(desde difícil ${MOD_FROM[k]})</span><br><span class="muted">${txt}</span></p>`).join('')}</div>
    <p class="tiny muted center" style="margin:0 8px">Toca una flecha: avanza hacia donde apunta y sale si nada la bloquea. Si choca pierdes una vida ❤️; cada ${LIFE_EVERY} flechas recuperas una. Con dos dedos acercas o alejas el tablero. Si sales, la partida queda guardada.</p>`;
}
function testCard() {
  if (!isOwner()) return '';
  const b = (k, label) => `<button class="btn ghost small" onclick="playArrows('t:${k}')">${label}</button>`;
  return `<details class="glass stack ar-test"><summary class="label">🧪 Zona de pruebas · solo tú</summary>
    <p class="tiny muted" style="margin:6px 0">Tableros chicos para ver cada cosa. No guardan récords, monedas ni partida, y no mandan avisos.</p>
    <div class="grid3">${Object.entries(MODS_INFO).map(([k, [e, t]]) => b(k, `${e} ${t}`)).join('')}</div>
    <div class="grid2" style="margin-top:8px">${b('all', '🎲 Todos juntos')}${b('xp', '💀 Experto')}${b('tt', '⏱️ Contrarreloj 1 min')}${b('duel', '⚔️ Duelo vs 🤖')}</div></details>`;
}
function arrowsExpert(v) { try { localStorage.setItem('futari-ar-expert', v ? '1' : '0'); } catch {} render(); }

/* ---------- Duelo en vivo ---------- */
function duelCard() {
  const d = duelDoc(), p = partnerUid(), pn = esc(partnerName()); if (!p) return '';
  const wins = `<span class="tiny muted">Duelos ganados: tú ${progress().dw || 0} · ${pn} ${progress(p).dw || 0}</span>`;
  const fresh = d && Date.now() - d.at < 3600e3, mine = d?.p?.[uid()] || {}, theirs = d?.p?.[p] || {};
  const sizes = `<div class="grid3">${Object.entries(DUEL_SIZES).map(([k, [n, l]]) => `<button class="btn ghost small" onclick="duelInvite('${k}')">${l}<br><span class="tiny muted">~${n}</span></button>`).join('')}</div>`;
  let body;
  if (fresh && d.state === 'invite' && d.from === uid()) body = `<p class="small" style="margin:0">Esperando a que ${pn} acepte el duelo (${DUEL_SIZES[d.size][1]})… ⏳</p><button class="btn ghost small" onclick="duelCancel()">Cancelar</button>`;
  else if (fresh && d.state === 'invite' && d.to === uid()) body = `<p style="margin:0"><b>${esc(nameOf(d.from))} te reta a un duelo</b> (${DUEL_SIZES[d.size][1]}, ~${DUEL_SIZES[d.size][0]} flechas). El mismo tablero, al mismo tiempo.</p>
    <div class="grid2"><button class="btn ghost" onclick="duelDecline()">Ahora no</button><button class="btn" onclick="duelAccept()">⚔️ Aceptar</button></div>`;
  else if (d?.state === 'live' && [d.from, d.to].includes(uid()) && Date.now() - d.startAt < 3 * 3600e3) body = mine.done || mine.gaveUp
    ? `<p class="small" style="margin:0">${mine.gaveUp ? 'Te rendiste' : `Terminaste en ${fmtMs(mine.ms)}`}. ${theirs.done ? '' : `${pn} va en ${theirs.n || 0} de ${theirs.total || '?'}…`}</p>`
    : `<p class="small" style="margin:0">Duelo en curso: ${pn} va en ${theirs.n || 0} de ${theirs.total || '?'}.</p><button class="btn" onclick="duelEnter()">Volver al duelo</button>`;
  else {
    const last = d?.state === 'done' && d.winner ? `<p class="small" style="margin:0">Último duelo: ${d.winner === uid() ? 'ganaste tú 🏆' : `ganó ${esc(nameOf(d.winner))}`}</p>` : '';
    body = `${last}<p class="tiny muted" style="margin:0">Reta a ${pn}: el mismo tablero al mismo tiempo, viendo cómo va el otro. Gana el primero en vaciarlo (cada error suma 5 segundos).</p>${sizes}`;
  }
  return `<div class="glass stack ar-duel"><div class="row"><span class="label">⚔️ Duelo en vivo</span>${wins}</div>${body}</div>`;
}
function duelInvite(size) {
  const p = partnerUid(); if (!p) return;
  const d = duelDoc();
  if (d && ['invite', 'live'].includes(d.state) && Date.now() - (d.startAt || d.at) < 3600e3 && !(d.state === 'live' && Object.values(d.p || {}).filter(x => x.done || x.gaveUp).length === 2)) return toast('Ya hay un duelo pendiente');
  write(setDoc(ref('arrows', 'duel'), { did: String(Date.now()), seed: Math.floor(Math.random() * 2 ** 31), size, from: uid(), to: p, state: 'invite', at: Date.now(), p: {} }));
  notify('arrows', { title: `⚔️ ${meForPartner()} te reta a un duelo de Flechas`, body: `${DUEL_SIZES[size][1]}: el mismo tablero, al mismo tiempo. ¡Acepta!`, url: './?open=arrows', tag: 'duel' });
  toast('Reto enviado ⚔️');
}
function duelAccept() {
  const d = duelDoc(); if (!d || d.state !== 'invite' || d.to !== uid()) return;
  write(updateDoc(ref('arrows', 'duel'), { state: 'live', startAt: Date.now() + 5000 }));
  notify('arrows', { title: `⚔️ ${meForPartner()} aceptó el duelo`, body: '¡Empieza ya! Entra a Flechas', url: './?open=arrows', tag: 'duel' }, 'partner');
}
function duelDecline() { write(updateDoc(ref('arrows', 'duel'), { state: 'declined' })); }
function duelCancel() { write(updateDoc(ref('arrows', 'duel'), { state: 'cancelled' })); }
function duelEnter() { const d = duelDoc(); if (d?.state === 'live') startDuel(d); }
let duelStarted = '', lastPush = 0;
function startDuel(d) {
  duelStarted = d.did;
  const wait = (d.startAt || 0) - Date.now();
  if (wait > 400) {
    const el = document.createElement('div'); el.className = 'dialog ar-count'; el.innerHTML = '<b id="arCount"></b>'; document.body.appendChild(el); syncBack();
    const tick = () => { const s = Math.ceil(((d.startAt || 0) - Date.now()) / 1000); if (s > 0) { $('arCount').textContent = s; navigator.vibrate?.(20); setTimeout(tick, 250); } else { el.remove(); syncBack(); playArrows('duel'); } };
    tick();
  } else playArrows('duel');
}
let pushLater = null;
function duelPush(force) {
  if (!G?.spec.duel) return;
  clearTimeout(pushLater);
  // Como mucho una escritura cada 1,5 s; la última siempre se manda (para que la barrita del otro quede al día)
  if (!force && Date.now() - lastPush < 1500) { pushLater = setTimeout(() => duelPush(true), 1500 - (Date.now() - lastPush)); return; }
  lastPush = Date.now();
  write(updateDoc(ref('arrows', 'duel'), { [`p.${uid()}`]: { n: G.gone.size, total: G.board.list.length, e: G.errors, at: Date.now(), ...(G.duelEnd || {}) } }));
}
async function duelGiveUp() {
  if (!(await ask('¿Rendirte en este duelo?', { ok: 'Rendirme', danger: true }))) return;
  G.duelEnd = { gaveUp: true }; duelPush(true); G.over = true; dropSave(G.spec.key); closeArrows();
}
// Cambios del duelo: arrancar cuando lo aceptan, la barrita del otro y el resultado
function duelWatch() {
  const d = duelDoc(); if (!d || !S.me || !arrowsVisible() || arrowsWrapped()) return;
  const p = partnerUid(), mine = d.p?.[uid()] || {}, theirs = d.p?.[p] || {};
  if (d.state === 'live' && [d.from, d.to].includes(uid()) && !mine.done && !mine.gaveUp && !G && duelStarted !== d.did && !document.hidden && !$('lockScreen') && Date.now() - d.startAt < 3600e3) startDuel(d);
  if (G?.spec.duel === d.did) {
    const o = $('arOpp'); if (o) { o.querySelector('i').style.width = ((theirs.n || 0) / (theirs.total || G.board.list.length) * 100) + '%'; o.querySelector('.n').textContent = theirs.gaveUp ? 'se rindió' : theirs.done ? '¡terminó!' : `${theirs.n || 0}/${theirs.total || G.board.list.length}`; }
    if (G.over && view?.querySelector('.ar-duel-res')) view.querySelector('.ar-duel-res').innerHTML = duelResultTxt(d);
  }
  // Los dos terminaron (o alguien se rindió): se anota el ganador una vez
  const fin = x => x.done || x.gaveUp;
  if (d.state === 'live' && fin(mine) && fin(theirs)) {
    const w = mine.gaveUp && theirs.gaveUp ? '' : mine.gaveUp ? p : theirs.gaveUp ? uid() : score(mine) <= score(theirs) ? uid() : p;
    write(updateDoc(ref('arrows', 'duel'), { state: 'done', winner: w || null }));
  }
  if (d.state === 'done' && d.winner === uid() && !d.counted) {
    write(updateDoc(ref('arrows', 'duel'), { counted: true }));
    write(setDoc(ref('arrows', 'p-' + uid()), { dw: increment(1) }, { merge: true }));
  }
}
function duelResultTxt(d) {
  const p = partnerUid(), mine = d.p?.[uid()] || {}, theirs = d.p?.[p] || {}, pn = esc(nameOf(p));
  if (theirs.gaveUp) return `🏆 ¡Ganaste! ${pn} se rindió`;
  if (!theirs.done) return `Esperando a ${pn}: va en ${theirs.n || 0} de ${theirs.total || '?'}… ⏳`;
  const a = score(mine), b = score(theirs);
  return `${a < b ? '🏆 ¡Ganaste!' : a === b ? '🤝 ¡Empate!' : `😅 Ganó ${pn}`}<br><span class="small">Tú ${fmtMs(a)} · ${pn} ${fmtMs(b)} (con errores)</span>`;
}

/* ---------- Jugar ---------- */
let G = null, view = null, timer = null;
function specOf(what) {
  if (what === 'day') return dailySpec();
  if (what === 'tt') return timedSpec(Math.floor(Math.random() * 2 ** 31));
  if (what === 'duel') { const d = duelDoc(); return d ? duelSpec(d) : null; }
  if (String(what).startsWith('t:')) return isOwner() ? testSpec(what.slice(2)) : null;
  const m = /^([nh])(\d+)$/.exec(String(what)); if (!m) return levelSpec(myLevel());
  return m[1] === 'h' ? hardSpec(Number(m[2])) : levelSpec(Number(m[2]));
}
function playArrows(what) {
  if (!arrowsVisible() || arrowsWrapped()) return;
  const spec = specOf(what); if (!spec) return;
  if (spec.day && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  G = newGame(spec, what);
  const sv = !spec.timed && loadSave(spec.key);
  if (sv && sv.total === G.board.list.length) restore(sv);
  view?.remove();
  view = document.createElement('div');
  view.className = 'dialog ar-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Flechas');
  view.addEventListener('gesturestart', e => e.preventDefault()); // iPhone: que el pellizco no haga zoom a la página
  document.body.appendChild(view); syncBack();
  paintGame();
  if (G.lives <= 0 && !G.noLives) outOfLives(); else introMods();
  clearInterval(timer); timer = setInterval(tickClock, 500);
  if (spec.duel) { duelPush(true); duelWatch(); }
}
function newGame(spec, what) {
  const board = boardOf(spec), N = board.N, occ = new Int32Array(N * N).fill(-1);
  for (const a of board.list) for (const [x, y] of a.cells) occ[y * N + x] = a.id;
  const xp = spec.test === 'xp' || ((spec.hard || spec.day) && !spec.test && expertOn());
  const g = { spec, what, board, N, occ, gone: new Set(), lives: 3, errors: 0, hints: 0, paid: 0, elapsed: 0, t0: Date.now(), over: false,
    cracked: new Set(), boom: new Set(), dir: {}, next: 1, expert: xp, noLives: !!(spec.timed || spec.duel || spec.fake), vis: null };
  for (const a of board.list) if (a.rot) g.dir[a.id] = a.d0;
  if (spec.timed) g.timed = { end: Date.now() + (spec.test ? 60e3 : TIMED_MS), done: 0, boards: 0 };
  if (spec.fake) g.fake = { n: 0, ms: 0 }; // rival simulado: avanza solo
  if (spec.duel) g.t0 = duelDoc()?.startAt || Date.now(); // en el duelo el reloj es el real desde que empezó
  return g;
}
function restore(sv) {
  const { board, occ, N } = G;
  for (const id of sv.removed) { const a = board.list[id]; if (!a) continue; G.gone.add(id); for (const [x, y] of a.cells) occ[y * N + x] = -1; if (a.num) G.next++; }
  Object.assign(G, { lives: sv.lives, errors: sv.errors, hints: sv.hints || 0, paid: sv.paid || 0, elapsed: G.spec.duel ? 0 : sv.elapsed || 0 });
  (sv.cracked || []).forEach(id => G.cracked.add(id)); (sv.boom || []).forEach(id => G.boom.add(id)); Object.assign(G.dir, sv.dir || {});
}
const elapsed = () => G.elapsed + (Date.now() - G.t0);
const timeLeft = () => G.timed.end - Date.now();
function tickClock() {
  if (!G || G.over || document.hidden) return;
  const t = $('arTime'); if (t) t.textContent = G.timed ? '⏱️ ' + fmtMs(timeLeft()) : fmtMs(elapsed());
  if (G.timed && timeLeft() <= 0) timeUp();
  if (G.fake && G.fake.n < G.board.list.length && Math.random() < 0.6) {
    G.fake.n = Math.min(G.board.list.length, G.fake.n + 1); if (G.fake.n === G.board.list.length) G.fake.ms = elapsed();
    const o = $('arOpp'); if (o) { o.querySelector('i').style.width = (G.fake.n / G.board.list.length * 100) + '%'; o.querySelector('.n').textContent = G.fake.ms ? '¡terminó!' : `${G.fake.n}/${G.board.list.length}`; }
  }
}
function save() {
  if (!G || G.over || G.timed || G.spec.test) return;
  try { localStorage.setItem(SAVE + G.spec.key, JSON.stringify({ total: G.board.list.length, removed: [...G.gone], lives: G.lives, errors: G.errors, hints: G.hints, paid: G.paid, elapsed: elapsed(),
    cracked: [...G.cracked], boom: [...G.boom], dir: G.dir, at: Date.now() })); } catch {}
}
// Pausa el reloj si la app pasa a segundo plano (menos en contrarreloj y duelo)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (G && !G.over && !G.timed && !G.spec.duel) { G.elapsed = elapsed(); G.t0 = Infinity; save(); } }
  else { if (G && G.t0 === Infinity) G.t0 = Date.now(); duelWatch(); }
});

/* ---------- Dibujo ---------- */
const C = 40; // tamaño de una casilla en el "mundo" (luego se escala con el zoom)
const ctr = ([x, y]) => [x * C + C / 2, y * C + C / 2];
const curD = a => a.rot ? G.dir[a.id] ?? a.d : a.d;
const headCell = a => a.cells[a.cells.length - 1];
function bodyPts(a) {
  const pts = a.cells.map(ctr), [dx, dy] = DIRS[curD(a)];
  if (pts.length === 1) pts.unshift([pts[0][0] - dx * C * 0.34, pts[0][1] - dy * C * 0.34]);
  const h = pts[pts.length - 1]; pts[pts.length - 1] = [h[0] + dx * C * 0.08, h[1] + dy * C * 0.08];
  return pts;
}
const ptsD = pts => 'M' + pts.map(p => p.map(v => Math.round(v * 10) / 10).join(' ')).join('L');
const headD = a => { const [hx, hy] = ctr(headCell(a)), [dx, dy] = DIRS[curD(a)], px = -dy, py = dx, t = C * 0.42, b = C * 0.02, w = C * 0.27;
  return `M${hx + dx * t} ${hy + dy * t}L${hx + dx * b + px * w} ${hy + dy * b + py * w}L${hx + dx * b - px * w} ${hy + dy * b - py * w}Z`; };
const midCell = a => a.cells[Math.floor((a.cells.length - 1) / 2)];
function badgesOf(a) {
  const out = [];
  if (a.lock != null) out.push(['lk', '🔒', a.pc]);
  if (a.key != null) out.push(['ky', '🔑', a.pc]);
  if (a.num) out.push(['nm', a.num, '#fff']);
  if (a.bomb && !G.boom.has(a.id)) out.push(['bm', Math.max(0, a.bomb - G.gone.size), '#3a0b12']);
  if (a.rot) out.push(['rt', '↻', '#2b2340']);
  return out;
}
function badgesSVG(a) {
  const [mx, my] = ctr(midCell(a)), r = C * 0.27;
  return badgesOf(a).map(([k, txt, fill], i) => `<g class="bd ${k}" transform="translate(${mx + C * 0.3 + i * r * 1.9} ${my - C * 0.3})"><circle r="${r}" fill="${fill}"/>
    <text class="${k}-t" font-size="${k === 'nm' || k === 'bm' ? C * 0.34 : C * 0.3}" text-anchor="middle" dominant-baseline="central"${k === 'nm' ? ' fill="#1a1024"' : k === 'bm' || k === 'rt' ? ' fill="#fff"' : ''}>${txt}</text></g>`).join('');
}
function arrowSVG(a) {
  const ice = a.ice && !G.cracked.has(a.id);
  return `<g id="ag${a.id}" class="${ice ? 'ice' : ''}" style="color:${a.c}">${ice ? `<path class="ib" d="${ptsD(bodyPts(a))}" stroke-width="${C * 0.66}"/>` : ''}<path class="ab" d="${ptsD(bodyPts(a))}" stroke-width="${C * 0.3}"/><path class="ah" d="${headD(a)}"/>${badgesSVG(a)}</g>`;
}
function chainSVG(a) {
  if (a.chain == null || a.chain < a.id || G.gone.has(a.id)) return '';
  const b = G.board.list[a.chain], [ax, ay] = ctr(midCell(a)), [bx, by] = ctr(midCell(b));
  return `<g id="ch${a.id}" class="chain"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke-width="${C * 0.09}"/><text x="${(ax + bx) / 2}" y="${(ay + by) / 2}" font-size="${C * 0.4}" text-anchor="middle" dominant-baseline="central">🔗</text></g>`;
}
function boardSVG() {
  const { board } = G, N = G.N;
  const xy = k => [(k % N) * C, Math.floor(k / N) * C];
  const stones = board.stones.map(k => { const [x, y] = xy(k); return `<rect class="stone" x="${x + C * 0.1}" y="${y + C * 0.1}" width="${C * 0.8}" height="${C * 0.8}" rx="${C * 0.26}"/><circle class="stone-hl" cx="${x + C * 0.36}" cy="${y + C * 0.34}" r="${C * 0.1}"/>`; }).join('');
  const portals = board.portals.map(([a, b, col]) => [a, b].map(k => { const [x, y] = xy(k); return `<g class="portal" id="pt${k}" style="color:${col}"><circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.38}"/><circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.2}"/><text x="${x + C / 2}" y="${y + C / 2}" font-size="${C * 0.42}" text-anchor="middle" dominant-baseline="central">🌀</text></g>`; }).join('')).join('');
  return `${stones}${portals}${board.list.filter(a => !G.gone.has(a.id)).map(arrowSVG).join('')}${board.list.map(chainSVG).join('')}`;
}
function paintGame() {
  const W = G.N * C, sp = G.spec, hint = !G.expert && !sp.duel && !sp.fake;
  view.innerHTML = `<div class="ar-top"><button class="icon-btn" data-v="0" aria-label="Salir (se guarda)" onclick="closeArrows()">${icon('x')}</button>
      <div class="ar-title"><b>${G.expert ? '💀 ' : ''}${esc(sp.title)}</b><span class="tiny muted"><span id="arLeft"></span> · <span id="arTime"></span></span></div>
      ${Object.keys(sp.mods).length ? '<button class="icon-btn ar-help" aria-label="Obstáculos" onclick="arrowsLegend()">?</button>' : ''}
      <div class="ar-lives" id="arLives" aria-label="Vidas"></div></div>
    <div class="ar-prog"><i id="arProg"></i></div>
    ${sp.duel || sp.fake ? `<div class="ar-opp" id="arOpp"><span>${sp.fake ? '🤖 Rival' : esc(nameOf(partnerUid()))}</span><div><i></i></div><span class="n">0</span></div>` : ''}
    <div class="ar-vp" id="arVp"><div class="ar-world" id="arWorld" style="width:${W}px;height:${W}px;--c:${C}px">
      <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" id="arSvg">${boardSVG()}</svg></div></div>
    <div class="ar-bottom">${hint ? `<button class="btn ghost small" onclick="arrowHint()">💡 Pista${sp.day ? ' (+10 s)' : ''}</button>` : ''}<button class="btn ghost small" onclick="arrowFit()">⤢ Ver todo</button>
      ${sp.fake ? '' : sp.duel ? '<button class="btn ghost small" onclick="duelGiveUp()">🏳️ Rendirme</button>' : sp.timed ? '' : '<button class="btn ghost small" onclick="restartArrows()">↺ Reiniciar</button>'}</div>`;
  updateFog(); updateHud(); tickClock(); setupCamera();
}
function updateHud() {
  const n = G.board.list.length, left = n - G.gone.size;
  $('arLeft').textContent = G.timed ? `${G.timed.done + G.gone.size} flechas` : `${left} de ${n} flechas`;
  $('arProg').style.width = (G.gone.size / n * 100) + '%';
  const next = LIFE_EVERY - (G.gone.size % LIFE_EVERY);
  $('arLives').innerHTML = G.noLives ? (G.errors ? `<small>${G.errors} ${G.errors === 1 ? 'error' : 'errores'}</small>` : '') :
    '❤️'.repeat(Math.max(0, G.lives)) + '🤍'.repeat(3 - Math.max(0, G.lives)) + (G.lives < 3 && n > LIFE_EVERY && !G.expert ? `<small>+1 en ${next}</small>` : '');
  for (const a of G.board.list) if (a.bomb && !G.gone.has(a.id) && !G.boom.has(a.id)) { const t = document.querySelector(`#ag${a.id} .bm-t`); if (t) t.textContent = Math.max(0, a.bomb - G.gone.size); }
}
// Niebla: se ve lo que está a 2 casillas o menos de la zona despejada que conecta con el borde (los portales conectan)
function updateFog() {
  if (!G.spec.mods.fog) return;
  const N = G.N, { base, portalTo } = G.board, open = new Uint8Array(N * N), q = [];
  const push = k => { if (open[k] || G.occ[k] >= 0 || base[k] === STONE) return; open[k] = 1; q.push(k); };
  for (let i = 0; i < N; i++) { push(i); push((N - 1) * N + i); push(i * N); push(i * N + N - 1); }
  while (q.length) {
    const k = q.pop(), x = k % N, y = Math.floor(k / N);
    if (base[k] === PORTAL) push(portalTo[k]);
    if (x > 0) push(k - 1); if (x < N - 1) push(k + 1); if (y > 0) push(k - N); if (y < N - 1) push(k + N);
  }
  const vis = G.vis = new Uint8Array(N * N), R = 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x < R || y < R || x >= N - R || y >= N - R) { vis[y * N + x] = 1; continue; }
    out: for (let yy = y - R; yy <= y + R; yy++) for (let xx = x - R; xx <= x + R; xx++) if (open[yy * N + xx]) { vis[y * N + x] = 1; break out; }
  }
  for (const a of G.board.list) if (!G.gone.has(a.id)) $('ag' + a.id)?.classList.toggle('fog', fogged(a));
}
const fogged = a => !!G.vis && !a.cells.some(([x, y]) => G.vis[y * G.N + x]);

/* ---------- Cámara: arrastrar, pellizcar, tocar y mantener ---------- */
function setupCamera() {
  const vp = $('arVp'), world = $('arWorld'), W = G.N * C;
  const rect = () => vp.getBoundingClientRect();
  const fitK = () => { const r = rect(); return Math.min(r.width, r.height) / W; };
  const cam = G.cam = { k: 1, x: 0, y: 0 };
  const kMax = () => Math.max(fitK() * 1.2, 56 / C), kMin = () => fitK() * 0.85;
  const apply = () => {
    const r = rect(), k = cam.k, bw = W * k, m = 60;
    cam.x = bw <= r.width ? (r.width - bw) / 2 : Math.min(m, Math.max(r.width - bw - m, cam.x));
    cam.y = bw <= r.height ? (r.height - bw) / 2 : Math.min(m, Math.max(r.height - bw - m, cam.y));
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${k})`;
  };
  const zoomAt = (k, px, py) => { k = Math.min(kMax(), Math.max(kMin(), k)); cam.x = px - (px - cam.x) * k / cam.k; cam.y = py - (py - cam.y) * k / cam.k; cam.k = k; apply(); };
  G.fit = () => { cam.k = fitK(); apply(); };
  G.focus = (wx, wy) => { const r = rect(); cam.k = Math.max(cam.k, Math.min(kMax(), 34 / C)); cam.x = r.width / 2 - wx * cam.k; cam.y = r.height / 2 - wy * cam.k; apply(); };
  G.fit();
  const pts = new Map(); let start = null, pinch = null, moved = false, longT = null, longDone = false;
  const world2 = (cx, cy) => { const r = rect(); return [(cx - r.left - cam.x) / cam.k, (cy - r.top - cam.y) / cam.k]; };
  vp.onpointerdown = e => {
    vp.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(longT);
    if (pts.size === 1) {
      start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, t: Date.now() }; moved = false; longDone = false;
      longT = setTimeout(() => { if (pts.size === 1 && !moved) { longDone = true; holdAt(...world2(start.x, start.y)); } }, 420);
    }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k }; moved = true; }
  };
  vp.onpointermove = e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()], r = rect();
      zoomAt(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (start && pts.size === 1) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) > 8) { moved = true; clearTimeout(longT); }
      if (moved) { cam.x = start.cx + dx; cam.y = start.cy + dy; apply(); }
    }
  };
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); clearTimeout(longT);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, t: Date.now() }; return; }
    if (!pts.size && start && !moved && !longDone && Date.now() - start.t < 500) tapAt(...world2(e.clientX, e.clientY));
    start = null;
  };
  vp.onpointerup = up; vp.onpointercancel = e => { moved = true; up(e); };
  vp.oncontextmenu = e => e.preventDefault();
  vp.onwheel = e => { e.preventDefault(); const r = rect(); zoomAt(cam.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); };
}
function arrowFit() { G?.fit?.(); }
// Flecha bajo un punto del mundo (la de esa casilla o la más cercana alrededor, para dedos gordos con zoom lejos)
function arrowAt(wx, wy) {
  const N = G.N, cx = Math.floor(wx / C), cy = Math.floor(wy / C);
  let best = -1, bd = Infinity;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const id = G.occ[y * N + x]; if (id < 0) continue;
    const d = Math.hypot(x * C + C / 2 - wx, y * C + C / 2 - wy) + (x === cx && y === cy ? 0 : C * 0.25);
    if (d < bd) { bd = d; best = id; }
  }
  return best >= 0 && bd < C * 1.1 ? best : -1;
}
function tapAt(wx, wy) { if (!G || G.over) return; const id = arrowAt(wx, wy); if (id >= 0) tapArrow(id); }
// Mantener presionado: gira una flecha giratoria
function holdAt(wx, wy) {
  if (!G || G.over) return; const id = arrowAt(wx, wy); if (id < 0) return;
  const a = G.board.list[id];
  if (!a.rot) { if (G.spec.mods.rot) toast('Solo las flechas 🔄 se pueden girar'); return; }
  if (fogged(a)) return;
  rotate(a); navigator.vibrate?.(25); save();
}
function rotate(a) {
  G.dir[a.id] = (curD(a) + 1) % 4;
  const g = $('ag' + a.id); if (!g) return;
  const d = ptsD(bodyPts(a)); g.querySelector('.ab').setAttribute('d', d); g.querySelector('.ib')?.setAttribute('d', d); g.querySelector('.ah').setAttribute('d', headD(a));
  g.classList.remove('spin'); void g.getBBox?.(); g.classList.add('spin');
}

/* ---------- Reglas ---------- */
// Camino desde la punta (atraviesa portales). steps = casillas libres en línea recta antes del primer obstáculo o portal.
function traceG(a, ignore = -1, flash = false) {
  const N = G.N, { base, portalTo } = G.board, [dx, dy] = DIRS[curD(a)];
  let [x, y] = headCell(a), steps = 0, straight = true, hops = 0;
  for (;;) {
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= N || y >= N) return { free: true, steps, portal: hops > 0 };
    const k = y * N + x, b = base[k];
    if (b === STONE) return { free: false, steps, stone: k, straight };
    if (b === PORTAL) { if (++hops > 3) return { free: false, steps, straight: false }; if (straight) { straight = false; if (flash) { $('pt' + k)?.classList.add('flash'); setTimeout(() => $('pt' + k)?.classList.remove('flash'), 500); } } const t = portalTo[k]; x = t % N; y = Math.floor(t / N); continue; }
    const o = G.occ[k];
    if (o >= 0 && o !== ignore) return { free: false, steps, blocker: o, straight };
    if (straight) steps++;
  }
}
function tapArrow(id) {
  const a = G.board.list[id]; if (!a || G.gone.has(id) || G.over) return;
  if (fogged(a)) return toast('🌫️ Está en la niebla');
  const g = $('ag' + id); g?.classList.remove('hint'); navigator.vibrate?.(8);
  if (a.lock != null && !G.gone.has(a.lock)) { nope(g); toast('🔒 Primero saca la flecha con la llave 🔑 de ese color'); return mistake(); }
  if (a.num && a.num !== G.next) { nope(g); toast(`🔢 Primero la ${G.next}`); return mistake(); }
  const p = a.chain != null && !G.gone.has(a.chain) ? G.board.list[a.chain] : null;
  if (p && p.lock != null && !G.gone.has(p.lock)) { nope(g); toast('🔗 La flecha encadenada todavía tiene candado'); return mistake(); }
  const tr = traceG(a, p?.id ?? -1, true);
  if (!tr.free) { bump(a, g, tr); return mistake(); }
  let trp = null;
  if (p) { trp = traceG(p, a.id); if (!trp.free) { bump(p, $('ag' + p.id), trp); toast('🔗 Su pareja encadenada está bloqueada'); return mistake(); } }
  // Hielo: el primer toque solo lo rompe
  const iceOf = x => x.ice && !G.cracked.has(x.id);
  if (iceOf(a) || (p && iceOf(p))) { for (const x of [a, p]) if (x && iceOf(x)) crack(x); save(); return; }
  removeArrow(a, g, tr); if (p) removeArrow(p, $('ag' + p.id), trp);
  afterRemoval([a, p].filter(Boolean));
}
function crack(a) {
  G.cracked.add(a.id); const g = $('ag' + a.id); if (!g) return;
  g.classList.remove('ice'); g.querySelector('.ib')?.animate([{ opacity: 1, strokeWidth: C * 0.66 }, { opacity: 0, strokeWidth: C * 0.9 }], { duration: 300 }).finished.then(() => g.querySelector('.ib')?.remove());
  navigator.vibrate?.(15);
}
function nope(g) { g?.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${C * 0.12}px)` }, { transform: `translateX(-${C * 0.12}px)` }, { transform: 'translateX(0)' }], { duration: 260 }); }
function bump(a, g, tr) {
  const dist = tr.straight === false ? tr.steps * C + C * 0.5 : tr.steps * C + C * 0.3;
  slither(a, g, dist, true);
  if (tr.blocker != null) setTimeout(() => { const b = $('ag' + tr.blocker); b?.classList.add('hit'); setTimeout(() => b?.classList.remove('hit'), 450); }, 120 + tr.steps * 20);
  if (tr.stone != null) toast('🪨 Hay una piedra en el camino');
}
// Un error: quita una vida (o suma tiempo en contrarreloj; en duelo cuenta 5 s)
function mistake() {
  G.errors++; navigator.vibrate?.([40, 30, 40]);
  if (G.timed) { G.timed.end -= 10e3; toast('−10 s'); }
  else if (!G.noLives) G.lives--;
  updateHud(); save(); if (G.spec.duel) duelPush();
  if (!G.noLives && G.lives <= 0) setTimeout(outOfLives, 450);
}
function removeArrow(a, g, tr) {
  G.gone.add(a.id); for (const [cx, cy] of a.cells) G.occ[cy * G.N + cx] = -1;
  if (a.num) G.next++;
  $('ch' + Math.min(a.id, a.chain ?? a.id))?.remove();
  slither(a, g, (tr.steps + a.cells.length + (tr.portal ? 1 : 2)) * C, false, tr.portal);
}
function afterRemoval(removed) {
  const N = G.N;
  // 🔄 Giratorias: giran las que estaban pegadas a lo que salió
  const near = new Set();
  for (const a of removed) for (const [x, y] of a.cells) for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const o = G.occ[ny * N + nx]; if (o >= 0 && G.board.list[o].rot) near.add(o);
  }
  for (const id of near) rotate(G.board.list[id]);
  // 💣 Bombas
  for (const b of G.board.list) if (b.bomb && !G.gone.has(b.id) && !G.boom.has(b.id) && G.gone.size >= b.bomb) {
    G.boom.add(b.id); const g = $('ag' + b.id); g?.querySelector('.bd.bm')?.remove(); g?.classList.add('boom'); setTimeout(() => g?.classList.remove('boom'), 700);
    toast('💥 ¡Explotó una bomba!'); mistake();
  }
  // ❤️ vida cada 50 (no en experto)
  if (!G.noLives && !G.expert && G.lives > 0 && G.lives < 3 && Math.floor((G.gone.size - removed.length) / LIFE_EVERY) < Math.floor(G.gone.size / LIFE_EVERY)) { G.lives++; toast('❤️ ¡Recuperaste una vida!'); }
  updateFog(); updateHud(); save(); if (G.spec.duel) duelPush();
  if (G.gone.size === G.board.list.length) setTimeout(G.timed ? nextTimedBoard : win, 450);
}
// Avanza la flecha por su propio trazo (como serpiente) y luego derecho; si choca, regresa
function slither(a, g, dist, back, portal) {
  if (!g) return;
  const body = g.querySelector('.ab'), head = g.querySelector('.ah'), [dx, dy] = DIRS[curD(a)];
  g.querySelectorAll('.bd, .ib').forEach(e => e.style.opacity = back ? '' : '0');
  const pts = bodyPts(a), last = pts[pts.length - 1], far = [last[0] + dx * (dist + C), last[1] + dy * (dist + C)];
  body.setAttribute('d', ptsD([...pts, far]));
  const len = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  body.style.strokeDasharray = `${len} 999999`;
  const dur = back ? 240 + dist / C * 40 : Math.min(900, 220 + dist / C * 22), t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const s = back ? dist * Math.sin(p * Math.PI) : dist * (p * p * (3 - 2 * p) * 0.4 + p * 0.6);
    body.style.strokeDashoffset = -s; head.setAttribute('transform', `translate(${dx * s} ${dy * s})`);
    if (!back) g.style.opacity = p > (portal ? 0.4 : 0.7) ? (1 - p) / (portal ? 0.6 : 0.3) : 1;
    if (p < 1) return requestAnimationFrame(step);
    if (back) { body.setAttribute('d', ptsD(bodyPts(a))); body.style.strokeDasharray = body.style.strokeDashoffset = ''; head.removeAttribute('transform'); }
    else g.remove();
  };
  requestAnimationFrame(step);
}
// ¿Se puede sacar ya? (para la pista)
function canGo(a) {
  if (G.gone.has(a.id) || fogged(a) || (a.lock != null && !G.gone.has(a.lock)) || (a.num && a.num !== G.next)) return false;
  const p = a.chain != null && !G.gone.has(a.chain) ? G.board.list[a.chain] : null;
  if (p && ((p.lock != null && !G.gone.has(p.lock)) || (p.num && p.num !== G.next))) return false;
  return traceG(a, p?.id ?? -1).free && (!p || traceG(p, a.id).free);
}
function arrowHint() {
  if (!G || G.over) return;
  const L = G.board.list.filter(a => !G.gone.has(a.id));
  // Prioridad: numerada siguiente o bomba a punto de explotar, luego cualquiera
  let free = L.filter(canGo), msg = '';
  const urgent = free.filter(a => a.num || (a.bomb && !G.boom.has(a.id)));
  if (urgent.length) free = urgent;
  if (!free.length) {
    // ¿Alguna giratoria saldría girándola?
    const r = L.find(a => a.rot && !fogged(a) && [1, 2, 3].some(k => { const d0 = G.dir[a.id]; G.dir[a.id] = (d0 + k) % 4; const ok = canGo(a); G.dir[a.id] = d0; return ok; }));
    if (!r) return toast('Sin pistas por ahora');
    free = [r]; msg = '🔄 Mantenla presionada para girarla';
  }
  const a = free[Math.floor(Math.random() * free.length)];
  document.querySelectorAll('#arSvg .hint').forEach(e => e.classList.remove('hint'));
  $('ag' + a.id)?.classList.add('hint'); G.hints++; save(); if (msg) toast(msg);
  const [hx, hy] = ctr(headCell(a)); if (G.N > 10) G.focus(hx, hy);
}
// Explicación de los obstáculos nuevos (una vez por teléfono) y leyenda con «?»
function introMods() {
  let seen = []; try { seen = JSON.parse(localStorage.getItem('futari-ar-seen') || '[]'); } catch {}
  const fresh = Object.keys(G.spec.mods).filter(k => !seen.includes(k));
  if (!fresh.length) return;
  try { localStorage.setItem('futari-ar-seen', JSON.stringify([...seen, ...fresh])); } catch {}
  legend(fresh, '✨ Nuevo en este tablero');
}
function legend(keys, title) {
  overlay(`<h2>${title}</h2><div class="stack" style="gap:10px;text-align:left">${keys.map(k => `<p class="small" style="margin:0"><span style="font-size:22px">${MODS_INFO[k][0]}</span> <b>${MODS_INFO[k][1]}</b><br><span class="muted">${MODS_INFO[k][2]}</span></p>`).join('')}</div>
    <button class="btn" onclick="this.closest('.ar-end').remove()">¡Entendido!</button>`);
}
function arrowsLegend() { if (G) legend(Object.keys(G.spec.mods), 'Obstáculos de este tablero'); }
async function restartArrows() {
  if (!G) return;
  if (G.gone.size > 20 && !G.over && !(await ask(`¿Empezar este tablero desde cero? Llevas ${G.gone.size} flechas.`, { ok: 'Reiniciar', danger: true }))) return;
  dropSave(G.spec.key); playArrows(G.what);
}
function closeArrows() {
  clearInterval(timer);
  if (G && !G.over) { if (G.timed) return timeUp(); G.elapsed = elapsed(); G.t0 = Date.now(); save(); }
  const el = view; view = null; G = null; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); render(); }, 160);
}
function overlay(html) { view.querySelector('.ar-end')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box">${html}</div></div>`); }
function outOfLives() {
  if (!view || !G) return;
  const p = pet(), have = p?.hatchedAt ? coins(p) : 0, can = have >= CONTINUE_COST && !G.expert, left = G.board.list.length - G.gone.size;
  overlay(`<div style="font-size:46px">💔</div><h2>Sin vidas</h2><p class="muted" style="margin:0">Te faltan ${left} ${left === 1 ? 'flecha' : 'flechas'}.</p>
    ${can ? `<button class="btn" onclick="arrowsContinue()">Seguir con 3 vidas · ${CONTINUE_COST} 🪙</button><p class="tiny muted" style="margin:0">Las monedas son de su mascota (tienen ${have} 🪙)</p>`
      : `<p class="tiny muted" style="margin:0">${G.expert ? '💀 Modo experto: no se puede seguir pagando.' : p?.hatchedAt ? `Para seguir donde ibas hacen falta ${CONTINUE_COST} 🪙 de la mascota (tienen ${have}).` : 'Cuando tengan mascota, podrán seguir donde iban con sus monedas.'}</p>`}
    <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn ghost" onclick="restartArrows()">Empezar de nuevo</button></div>`);
}
function arrowsContinue() {
  const p = pet(); if (!G || !p || coins(p) < CONTINUE_COST || G.expert) return;
  write(updateDoc(ref('pet', 'main'), { spent: increment(CONTINUE_COST) }));
  G.lives = 3; G.paid++; updateHud(); save(); view.querySelector('.ar-end')?.remove(); toast('❤️❤️❤️ ¡A seguir!');
}
// Contrarreloj: al vaciar un tablero sale otro
function nextTimedBoard() {
  if (!G?.timed || G.over) return;
  G.timed.done += G.board.list.length; G.timed.boards++;
  const t = G.timed, spec = timedSpec(Math.floor(Math.random() * 2 ** 31));
  const errors = G.errors; G = newGame(spec, 'tt'); G.timed = t; G.errors = errors;
  celebrate(); toast('¡Tablero limpio! Otro 💪'); paintGame();
}
function timeUp() {
  if (!G?.timed || G.over) return;
  G.over = true; clearInterval(timer);
  const total = G.timed.done + G.gone.size, pr = progress(), best = pr.tt || 0, p = partnerUid(), theirs = p ? progress(p).tt || 0 : 0;
  if (G.spec.test) { view.querySelector('.ar-bottom').innerHTML = ''; return overlay(`<div style="font-size:46px">⏱️</div><h2>¡Tiempo!</h2><p style="margin:0" class="center"><b style="font-size:28px">${total}</b> flechas en 1 minuto<br><span class="small muted">Prueba: no se guardó nada</span></p>
    <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn" onclick="playArrows('t:tt')">Otra vez</button></div>`); }
  if (total > best) write(setDoc(ref('arrows', 'p-' + uid()), { tt: total }, { merge: true }));
  if (total > best && total > theirs && theirs) notify('arrows', { title: `⏱️ ${meForPartner()} hizo ${total} flechas en 5 minutos`, body: `Te ganó tu récord de ${theirs}. ¿Lo recuperas?`, url: './?open=arrows', tag: 'arrows-tt' });
  markActive(); countStat('acts', 'arrows-tt');
  if (total > best) celebrate();
  view.querySelector('.ar-bottom').innerHTML = '';
  overlay(`<div style="font-size:46px">⏱️</div><h2>¡Se acabó el tiempo!</h2><p style="margin:0" class="center"><b style="font-size:28px">${total}</b> flechas${timeLeft() > 1000 ? ' (saliste antes de tiempo)' : ' en 5 minutos'}<br><span class="small muted">${G.errors} ${G.errors === 1 ? 'error' : 'errores'}${G.timed.boards ? ` · ${G.timed.boards} ${G.timed.boards === 1 ? 'tablero limpio' : 'tableros limpios'}` : ''}</span><br>${total > best ? '🏆 ¡Nuevo récord!' : `Tu récord: ${best}`}</p>
    <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn" onclick="playArrows('tt')">Otra vez</button></div>`);
}
function win() {
  if (!G || G.over) return;
  G.over = true; clearInterval(timer); dropSave(G.spec.key);
  const ms = elapsed(), sp = G.spec, n = G.board.list.length, p = partnerUid(), pt = pet();
  const errTxt = `${G.errors} ${G.errors === 1 ? 'error' : 'errores'}${G.hints ? ` · ${G.hints} 💡` : ''}`;
  celebrate(); navigator.vibrate?.([20, 40, 60]); view.querySelector('.ar-bottom').innerHTML = '';
  if (sp.test) {
    const vs = sp.fake ? `<br>${G.fake.ms && G.fake.ms < ms ? '😅 El rival 🤖 terminó primero' : '🏆 ¡Le ganaste al rival 🤖!'}` : '';
    return overlay(`<div style="font-size:46px">🧪</div><h2>¡Prueba lista!</h2><p style="margin:0" class="center">${n} flechas en ${fmtMs(ms)} · ${errTxt}${vs}<br><span class="small muted">No se guardó nada</span></p>
      <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn" onclick="playArrows('t:${sp.test}')">Otro tablero</button></div>`);
  }
  markActive();
  if (sp.duel) {
    G.duelEnd = { done: true, ms }; duelPush(true); countStat('acts', 'arrows-duel');
    overlay(`<div style="font-size:46px">⚔️</div><h2>¡Terminaste!</h2><p style="margin:0" class="center">${n} flechas en ${fmtMs(ms)} · ${errTxt}</p><p class="center ar-duel-res" style="margin:0">${duelResultTxt(duelDoc() || {})}</p>
      <button class="btn ghost" onclick="closeArrows()">Listo</button>`);
    return;
  }
  // Estrellas: en los grandes se perdonan más errores
  const tol = sp.hard ? Math.max(2, Math.round(n / 120)) : 0, bad = G.errors + G.hints;
  const s = bad <= tol ? 3 : bad <= tol * 3 + 1 ? 2 : 1;
  let msg = '', next = '';
  const b = writeBatch(db);
  if (sp.day) {
    const day = todayKey(), d = daily(day), first = !Object.keys(d).some(k => k !== 'id' && d[k]?.ms);
    const r = { ms, errors: G.errors, hints: G.hints, arrows: n, at: Date.now(), ...(G.expert ? { expert: true } : {}) };
    b.set(ref('arrows', 'd-' + day), { [uid()]: r }, { merge: true });
    if (first && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
    const them = p && d[p];
    msg = `${G.expert ? '💀 ' : ''}${n} flechas en ${fmtMs(ms)} · ${errTxt}${first && pt?.hatchedAt ? '<br>¡Fuiste primero! +10 🪙 para la mascota' : ''}`;
    if (them) msg += `<br>${score(r) < score(them) ? '🏆 ¡Le ganaste a ' : score(r) === score(them) ? '🤝 Empate con ' : '😅 Te ganó '}${esc(nameOf(p))} (${fmtMs(them.ms)})`;
    notify('arrows', { title: `🏹 ${meForPartner()} resolvió las Flechas del día en ${fmtMs(ms)}`,
      body: them ? (score(r) < score(them) ? 'Te ganó hoy 😏' : 'Le ganaste hoy 🏆') : `${n} flechas, ${errTxt}. ¿Le ganas? El tablero es el mismo para los dos`, url: './?open=arrows', tag: 'arrows-' + day });
  } else {
    const pr = progress(), hard = !!sp.hard, num = Number(sp.key.slice(1)), field = hard ? 'hstars' : 'stars', had = pr[field]?.[num] || 0;
    const coinsWon = hard ? 10 : 3;
    b.set(ref('arrows', 'p-' + uid()), { [hard ? 'hard' : 'level']: Math.max((hard ? pr.hard : pr.level) || 1, num + 1), [field]: { [num]: Math.max(had, s) }, ...(G.expert && hard ? { hx: { [num]: true } } : {}) }, { merge: true });
    if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
    msg = `<span class="ar-stars">${stars(s)}</span>${G.expert && hard ? '<br>💀 ¡En modo experto!' : ''}<br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}`;
    next = `<button class="btn" onclick="playArrows('${hard ? 'h' : 'n'}${num + 1}')">${hard ? 'Difícil' : 'Nivel'} ${num + 1} →</button>`;
    if (hard) notify('arrows', { title: `🔥 ${meForPartner()} terminó Flechas difícil ${num}${G.expert ? ' en modo experto 💀' : ''}`, body: `${n} flechas en ${fmtMs(ms)} · ${errTxt}`, url: './?open=arrows', tag: 'arrows-h' + num });
  }
  write(b.commit()); countStat('acts', sp.day ? 'arrows-day' : 'arrows');
  overlay(`<div style="font-size:46px">🎉</div><h2>${sp.day ? '¡Reto del día listo!' : `¡${esc(sp.title)} listo!`}</h2>
    <p style="margin:0" class="center">${msg}</p><div class="${next ? 'grid2' : 'stack'}"><button class="btn ghost" onclick="closeArrows()">${next ? 'Salir' : 'Listo'}</button>${next}</div>`);
}

/* ---------- Regalo envuelto ---------- */
// Tarjeta de Inicio y mosaico de Más mientras esté envuelto
export const giftCard = () => !arrowsWrapped() ? '' : `<button class="glass gift-card" onclick="unwrapGift()" aria-label="Abrir regalo">
    <span class="gift-box" aria-hidden="true"><i></i></span><span class="stack" style="gap:2px;text-align:left"><b>Tienes un regalo 🎁</b><span class="small muted">Tócalo para abrirlo</span></span></button>`;
export const giftTile = () => !arrowsWrapped() ? '' : `<button class="tile gift-tile" onclick="unwrapGift()"><span class="gift-bow" aria-hidden="true">🎀</span>
    <div><b>Un regalo para ti</b></div><span class="sub">Tócalo para abrirlo</span></button>`;
// Abrirlo (preview = solo verlo, desde Administración, sin guardar nada)
function unwrapGift(preview) {
  if (!preview && !arrowsWrapped()) return;
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
    if (!preview) write(setDoc(ref('profiles', uid()), { prefs: { unwrapped: { arrows: Date.now() } } }, { merge: true }));
    const m = giftInfo().msg;
    setTimeout(() => {
      el.querySelector('.gift-stage').innerHTML = `<div class="gift-reveal"><div style="font-size:64px">🏹</div><h2>Flechas</h2>
        <p class="muted" style="margin:0">Un juego hecho para ti: saca todas las flechas del tablero sin que choquen.</p>
        ${m ? `<p class="gift-msg">«${esc(m)}»</p>` : ''}
        <button class="btn" id="giftPlay">¡A jugar!</button>${preview ? '<p class="tiny muted" style="margin:0">(Vista previa: no se guardó nada)</p>' : ''}</div>`;
      el.querySelector('#giftPlay').onclick = () => { close(); window.go('s-arrows'); };
    }, 700);
  };
}

/* ---------- Administración: tarjeta de la sorpresa ---------- */
export function giftAdminCard() {
  if (!isOwner()) return '';
  const g = giftInfo(), p = partnerUid(), opened = p && profile(p).prefs?.unwrapped?.arrows;
  const when = t => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `<div class="glass stack" style="border-color:rgba(255,181,71,.5)"><span class="label">🎁 Sorpresa: Flechas</span>
    <p class="small" style="margin:0">${g.on ? `🎁 Regalado el ${when(g.at)}. ${opened ? `${esc(nameOf(p))} lo abrió el ${when(opened)} 💝` : `${esc(nameOf(p) || 'Tu pareja')} todavía no lo abre.`}`
      : '🔒 Escondido: solo tú lo ves (Más → Flechas). Tu pareja no ve nada: ni la sección, ni en el buscador, ni el aviso en Ajustes.'}</p>
    <div><label class="f" for="giftMsg">Mensaje al abrirlo (opcional)</label><textarea id="giftMsg" maxlength="200" placeholder="Ej: Para que juegues a lo que te gusta, pero aquí 💕">${esc(g.msg || '')}</textarea></div>
    ${g.on ? `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="giftSave()">Guardar mensaje</button><button class="btn ghost small" style="width:100%" onclick="giftRewrap()">↺ Volver a envolver</button></div>
        <button class="btn ghost small danger" onclick="giftHide()">🔒 Esconderlo otra vez</button>`
      : `<label class="check"><input type="checkbox" id="giftNotify" checked> Avisarle con una notificación («🎁 Tienes un regalo en Futari»)</label>
        <button class="btn" onclick="giftGive()">🎁 Envolver y regalar</button>`}
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="unwrapGift(true)">👀 Ver cómo se abre</button><button class="btn ghost small" style="width:100%" onclick="go('s-arrows')">🏹 Probar el juego</button></div></div>`;
}
const saveGift = patch => write(setDoc(coupleRef, { features: { arrows: { ...giftInfo(), ...patch } } }, { merge: true }));
async function giftGive() {
  if (!(await ask('¿Regalar Flechas ahora? A tu pareja le aparece envuelto en Inicio y en Más.', { ok: 'Regalar' }))) return;
  const n = $('giftNotify')?.checked;
  saveGift({ on: true, at: Date.now(), by: uid(), msg: $('giftMsg').value.trim() });
  if (n) notify('surprise', { title: '🎁 Tienes un regalo en Futari', body: 'Ábrelo cuando quieras 💝', url: './?open=gift', tag: 'gift-arrows' });
  celebrate(); toast('¡Regalo envuelto y entregado! 🎁');
}
function giftSave() { saveGift({ msg: $('giftMsg').value.trim() }); toast('Mensaje guardado'); }
async function giftHide() { if (await ask('¿Esconderlo otra vez? Tu pareja deja de verlo (su progreso no se borra).', { ok: 'Esconder' })) saveGift({ on: false }); }
async function giftRewrap() {
  const p = partnerUid(); if (!p) return;
  if (!(await ask('¿Volver a envolverlo? A tu pareja le aparece otra vez como regalo sin abrir.', { ok: 'Envolver' }))) return;
  write(setDoc(ref('profiles', p), { prefs: { unwrapped: { arrows: null } } }, { merge: true })); toast('Envuelto otra vez 🎀');
}

on('arrows profiles', () => { if ($('s-arrows').classList.contains('active') && !view) render(); });
on('arrows', duelWatch);
onShow('s-arrows', render);
expose({ playArrows, arrowHint, arrowFit, arrowsContinue, restartArrows, closeArrows, arrowsExpert, arrowsLegend, duelInvite, duelAccept, duelDecline, duelCancel, duelEnter, duelGiveUp, unwrapGift, giftGive, giftSave, giftHide, giftRewrap });
