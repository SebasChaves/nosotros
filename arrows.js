// Flechas: rompecabezas de sacar flechas del tablero. Cada flecha es una línea (a veces con curvas) con punta; al tocarla
// avanza hacia donde apunta y sale si nada la bloquea; si choca, regresa y se pierde una vida (3, y cada 50 flechas sacadas
// se recupera una; sin vidas se puede seguir pagando monedas de la mascota). Tableros de 16 a 700 flechas con zoom.
// - 90 niveles (1–5 para aprender, después de 300 a 700 flechas, jefes cada 10, obstáculos: MODS_INFO) y modo infinito,
//   🧊 Figuras: 30 niveles en 3D hechos de cubitos (cubo, caja, torre, L, escalera, cruz, dona, al azar);
//   los niveles 15, 35, 55 y 75 de la escalera también son figuras,
//   Reto del día (el mismo para los dos; crece en la semana), Contrarreloj (5 min) y Duelo en vivo (arrows/duel).
//   💀 Modo experto (por teléfono): sin pistas, sin recuperar vidas ni pagar para seguir.
//   Todo sale de una semilla: el mismo nivel es igual en los dos teléfonos. La partida a medias se guarda en el teléfono.
// - Sorpresa: hasta que el dueño lo «regala» desde Administración (couples/nosotros.features.arrows.on), solo lo ve él.
//   Al regalarlo, a la pareja le aparece envuelto en papel de regalo (Más, Inicio y juegos de la mascota) hasta que lo abre
//   (profiles/<uid>.prefs.unwrapped.arrows).
// Datos: arrows/p-<uid> { lv (siguiente nivel 1–91), ls{n: estrellas}, lx{n: experto}, inf (tablero infinito), tt (récord contrarreloj), dw (duelos ganados) }
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
  const headOf = a => a.cells[a.cells.length - 1], dist = (a, b) => { const [ax, ay] = headOf(a), [bx, by] = headOf(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
  const rayArrows = a => { const s = new Set(); const [hx, hy] = headOf(a); walk(N, base, portalTo, hx, hy, a.d, k => { if (occ[k] >= 0) s.add(occ[k]); }); return s; };
  decorate(list, R, mods, rayArrows, dist, N);
  return { list, base, portalTo, portals, stones, N };
}

/* ---------- Figuras de cubitos (el cubo es la figura de un solo cubito) ----------
   La figura es una lista de cubitos [x, y, z] (y hacia arriba). Cada cara de cubito que da al aire es un «panel» de N×N
   casillas. Casilla = [x, y, panel]; índice global = panel·N² + y·N + x.
   Al avanzar y salirse de un panel hay tres casos:
     · plano: el cubito vecino sigue en el mismo plano → se pasa a su panel (las caras grandes son varios paneles);
     · arista (hacia afuera): no hay nada → se dobla a la otra cara del mismo cubito;
     · rincón (hacia adentro): hay un cubito delante y arriba → se sube por esa pared.
   Una flecha sale si su camino (derecho, cruzando paneles planos) llega a una arista; si llega a un rincón choca con la
   pared y por ahí nunca sale. Los cuerpos sí pueden doblar aristas y rincones. */
// Orientación de cada tipo de cara de un cubito [0,1]³: normal n, esquina o (arriba-izquierda vista desde afuera), u derecha, v abajo
export const FACES = [
  { n: [0, 0, 1], o: [0, 1, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { n: [1, 0, 0], o: [1, 1, 1], u: [0, 0, -1], v: [0, -1, 0] },
  { n: [0, 0, -1], o: [1, 1, 0], u: [-1, 0, 0], v: [0, -1, 0] },
  { n: [-1, 0, 0], o: [0, 1, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { n: [0, 1, 0], o: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], o: [0, 0, 1], u: [1, 0, 0], v: [0, 0, -1] },
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const neg = a => a.map(c => -c);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const faceOf = n => FACES.findIndex(F => F.n[0] === n[0] && F.n[1] === n[1] && F.n[2] === n[2]);
// Figuras (cubitos). «rara» se arma al azar con la semilla.
export const SHAPES = {
  cubo: { e: '🧊', name: 'Cubo', v: [[0, 0, 0]] },
  caja: { e: '📦', name: 'Caja', v: [[0, 0, 0], [1, 0, 0]] },
  cajon: { e: '📦', name: 'Cajón', v: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1], [1, 0, 1], [2, 0, 1]] },
  torre: { e: '🗼', name: 'Torre', v: [[0, 0, 0], [0, 1, 0], [0, 2, 0]] },
  ele: { e: '🔠', name: 'L', v: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
  escalera: { e: '🪜', name: 'Escalera', v: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]] },
  cruz: { e: '➕', name: 'Cruz', v: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] },
  dona: { e: '🍩', name: 'Dona', v: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1], [2, 0, 1], [0, 0, 2], [1, 0, 2], [2, 0, 2]] },
  rara: { e: '🎲', name: 'Figura rara', v: null },
};
export function randomShape(R, size) {
  const vox = [[0, 0, 0]], has = new Set(['0,0,0']), D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let t = 0; vox.length < size && t < 500; t++) {
    const b = vox[Math.floor(R() * vox.length)], d = D[Math.floor(R() * 6)], c = add(b, d), k = c.join();
    if (has.has(k) || Math.abs(c[1]) > 2) continue;
    has.add(k); vox.push(c);
  }
  return vox;
}
export function buildSurface(vox) {
  const has = new Set(vox.map(v => v.join())), panels = [], index = {};
  for (const v of vox) FACES.forEach((F, f) => {
    if (has.has(add(v, F.n).join())) return;
    index[v.join() + '|' + f] = panels.length;
    panels.push({ v, f, n: F.n, u: F.u, vv: F.v, o: add(v, F.o) });
  });
  return { has, panels, index };
}
export const cellCenter = (S, N, [x, y, p]) => { const P = S.panels[p]; return add(add(P.o, P.u, (x + 0.5) / N), P.vv, (y + 0.5) / N); };
const dirVec = (P, d) => d === 0 ? neg(P.vv) : d === 1 ? P.u : d === 2 ? P.vv : neg(P.u);
function cellAt(S, N, p, pt) { const P = S.panels[p], q = add(pt, P.o, -1); return [Math.floor(dot(q, P.u) * N + 1e-6), Math.floor(dot(q, P.vv) * N + 1e-6), p]; }
// Un paso en dirección w: { c, w, kind: 'in' | 'flat' | 'edge' | 'corner' }
export function shapeStep(S, N, c, w) {
  const [x, y, p] = c, P = S.panels[p], nx = x + dot(w, P.u), ny = y + dot(w, P.vv);
  if (nx >= 0 && ny >= 0 && nx < N && ny < N) return { c: [nx, ny, p], w, kind: 'in' };
  const e = add(cellCenter(S, N, c), w, 0.5 / N), A = add(P.v, w), B = add(A, P.n);
  if (S.has.has(B.join())) { const q = S.index[B.join() + '|' + faceOf(neg(w))]; return { c: cellAt(S, N, q, add(e, P.n, 0.5 / N)), w: P.n, kind: 'corner' }; }
  if (S.has.has(A.join())) { const q = S.index[A.join() + '|' + faceOf(P.n)]; return { c: cellAt(S, N, q, add(e, w, 0.5 / N)), w, kind: 'flat' }; }
  const q = S.index[P.v.join() + '|' + faceOf(w)]; return { c: cellAt(S, N, q, add(e, P.n, -0.5 / N)), w: neg(P.n), kind: 'edge' };
}
// Camino de una punta: derecho cruzando paneles planos hasta una arista. null si choca con una pared (rincón) o una piedra.
export function rayCells(S, N, base, c, d) {
  const M = N * N, out = []; let w = dirVec(S.panels[c[2]], d), cur = c;
  for (let i = 0; i < 4 * N * 8; i++) {
    const st = shapeStep(S, N, cur, w);
    if (st.kind === 'edge') return out;
    if (st.kind === 'corner') return null;
    const k = st.c[2] * M + st.c[1] * N + st.c[0];
    if (base[k] === STONE) return null;
    out.push(k); cur = st.c;
  }
  return null;
}
export function generateShape(spec) {
  const { seed, n: N, minLen = 2, maxLen = 4, mods = {} } = spec, M = N * N, R = rng(seed);
  const vox = spec.vox || (SHAPES[spec.shape]?.v ?? randomShape(R, spec.rare || 6));
  const S = buildSurface(vox), P = S.panels.length;
  const base = new Int8Array(P * M), occ = new Int32Array(P * M).fill(-1), cover = new Float64Array(P * M).fill(-Infinity), list = [], stones = [];
  const K = ([x, y, p]) => p * M + y * N + x;
  for (let i = 0; i < (mods.stones || 0); i++) for (let t = 0; t < 200; t++) { const k = Math.floor(R() * P * M); if (!base[k]) { base[k] = STONE; stones.push(k); break; } }
  const idx = [...Array(P * M).keys()];
  for (let pass = 0; pass < 6; pass++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const k of idx) {
      if (occ[k] >= 0 || base[k]) continue;
      const p = Math.floor(k / M), y = Math.floor((k % M) / N), x = k % N, head = [x, y, p];
      for (const d of [0, 1, 2, 3].sort(() => R() - 0.5)) {
        const rc = rayCells(S, N, base, head, d); if (!rc || rc.includes(k)) continue;
        const ray = new Set(rc); let hi = Infinity;
        for (const rk of rc) if (occ[rk] >= 0) hi = Math.min(hi, list[occ[rk]].o);
        let lo = cover[k];
        if (!(lo < hi)) continue;
        const want = minLen + Math.floor(Math.pow(R(), 1.2) * (maxLen - minLen + 1));
        const cells = [head], used = new Set([k]);
        let cur = head, w = neg(dirVec(S.panels[p], d));
        while (cells.length < want) {
          const n = S.panels[cur[2]].n, side = cross(n, w), s = R() < 0.5 ? 1 : -1;
          const opts = cells.length === 1 ? [w] : R() < 0.4 ? [side.map(c => c * s), w, side.map(c => -c * s)] : [w, side.map(c => c * s), side.map(c => -c * s)];
          let moved = false;
          for (const o of opts) {
            const st = shapeStep(S, N, cur, o), nk = K(st.c);
            if (base[nk] || occ[nk] >= 0 || used.has(nk) || ray.has(nk) || !(Math.max(lo, cover[nk]) < hi)) continue;
            lo = Math.max(lo, cover[nk]); cells.push(st.c); used.add(nk); cur = st.c; w = st.w; moved = true; break;
          }
          if (!moved) break;
        }
        if (cells.length < minLen) continue;
        const o = hi === Infinity ? (lo === -Infinity ? 0 : lo + 1) : lo === -Infinity ? hi - 1 : lo + (hi - lo) * (0.25 + R() * 0.5);
        const id = list.length; cells.reverse();
        for (const c of cells) occ[K(c)] = id;
        for (const rk of ray) cover[rk] = Math.max(cover[rk], o);
        list.push({ id, cells, d, o, ray: rc, c: COLORS[Math.floor(R() * COLORS.length)] });
        break;
      }
    }
  }
  const rayArrows = a => { const s = new Set(); for (const k of a.ray) if (occ[k] >= 0) s.add(occ[k]); return s; };
  const dist = (a, b) => { const p = cellCenter(S, N, a.cells[a.cells.length - 1]), q = cellCenter(S, N, b.cells[b.cells.length - 1]); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * N; };
  decorate(list, R, mods, rayArrows, dist, N);
  return { cube: true, shape: S, vox, list, base, stones, portals: [], portalTo: {}, N, M };
}
// Obstáculos que dependen del orden de solución (igual para el tablero plano y el cubo)
export function decorate(list, R, mods, rayArrows, dist, N) {
  const byRank = [...list].sort((a, b) => b.o - a.o); byRank.forEach((a, r) => { a.rank = r; });
  const n = list.length, taken = new Set();
  const pickRank = (from, to, ok = () => true) => { for (let t = 0; t < 400; t++) { const r = Math.floor(from + R() * Math.max(1, to - from)); const a = byRank[Math.min(n - 1, r)]; if (a && !taken.has(a.id) && ok(a)) { taken.add(a.id); return a; } } return null; };
  for (let i = 0; i < (mods.locks || 0); i++) {
    const L = pickRank(n * 0.25, n * 0.95); if (!L) break;
    const K = pickRank(Math.max(0, L.rank * 0.3), L.rank, k => dist(k, L) > N / 3) || pickRank(0, L.rank);
    if (!K) { taken.delete(L.id); break; }
    const color = PAIR_COLORS[i % PAIR_COLORS.length]; L.lock = K.id; L.pc = color; K.key = L.id; K.pc = color;
  }
  const nums = []; for (let i = 0; i < (mods.nums || 0); i++) { const a = pickRank(n * 0.05, n * 0.9); if (a) nums.push(a); }
  nums.sort((a, b) => a.rank - b.rank).forEach((a, i) => { a.num = i + 1; });
  const slack = Math.max(8, Math.round(n * 0.06));
  for (let i = 0; i < (mods.bombs || 0); i++) { const a = pickRank(5, n * 0.45); if (a) a.bomb = a.rank + 1 + slack; }
  for (let i = 0, tries = 0; i < (mods.chains || 0) && tries < 300; tries++) {
    const A = pickRank(n * 0.1, n * 0.85); if (!A) break;
    const raA = rayArrows(A);
    const B = list.find(b => !taken.has(b.id) && b.rank > A.rank && dist(A, b) <= 6 && !raA.has(b.id) && (() => { const rb = rayArrows(b); return !rb.has(A.id) && [...rb].every(id => list[id].rank < A.rank); })());
    if (!B) { taken.delete(A.id); continue; }
    taken.add(B.id); A.chain = B.id; B.chain = A.id; i++;
  }
  for (let i = 0; i < (mods.ice || 0); i++) { const a = pickRank(0, n, x => !x.chain); if (a) { a.ice = true; taken.delete(a.id); } }
  for (let i = 0; i < (mods.rot || 0); i++) { const a = pickRank(0, n); if (a) { a.rot = true; a.d0 = (a.d + 1 + Math.floor(R() * 3)) % 4; } }
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
const MOD_FROM = { stones: 6, ice: 12, locks: 20, nums: 28, bombs: 36, chains: 44, rot: 52, portals: 60, fog: 70 }; // nivel en que se estrena cada obstáculo
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
// Tamaño según cuántas flechas se quieren
// (0,27 deja margen para piedras y portales, que ocupan casillas; así un nivel de «300» nunca sale con menos)
const sizeFor = arrows => Math.max(8, Math.min(52, Math.ceil(Math.sqrt(arrows / 0.27))));
// Calentamiento: tableros chicos (4×4 a 9×9), sin obstáculos
// Niveles 1–90 (una sola escalera):
//  1–5 para aprender (~30 flechas, sin obstáculos); desde el 6 nunca menos de 300 y sube hasta 700.
//  Cada 10 hay un jefe 👑 (más flechas y más obstáculos) y el siguiente da un pequeño respiro.
//  Piedras en ~la mitad de los niveles; cada obstáculo se estrena en su nivel (MOD_FROM) y después sale en ~1 de cada 3-4,
//  con máximo 2 además de las piedras (3 en los jefes). Después del 90: modo infinito (700 flechas, mezcla al azar).
export const LEVELS = 90;
export const isBoss = L => L >= 10 && L % 10 === 0;
export const levelTarget = L => {
  if (L <= 5) return 30;
  const base = 300 + (L - 6) * 400 / 83;
  return Math.round(clamp(isBoss(L) ? base * 1.18 : L % 10 === 1 ? base * 0.9 : base, 300, 700));
};
export const newModAt = L => Object.entries(MOD_FROM).find(([k, f]) => f === L && k !== 'stones')?.[0];
export function levelMods(L) {
  if (L <= 5) return [];
  const R = rng(hash('mods-' + L)), boss = isBoss(L), out = [], fresh = newModAt(L);
  if (R() < 0.5 || boss || L === MOD_FROM.stones) out.push('stones');
  const known = Object.entries(MOD_FROM).filter(([k, f]) => k !== 'stones' && f < L).map(([k]) => k), max = boss ? 3 : 2, extra = [];
  if (fresh) extra.push(fresh);
  for (const k of known.sort(() => R() - 0.5)) if (extra.length < max && R() < (boss ? 0.7 : 0.28)) extra.push(k);
  if (boss) for (const k of known) if (extra.length < 2 && !extra.includes(k)) extra.push(k);
  return [...out, ...extra];
}
// 🧊 Cubos: escalera propia de 30 y, además, unos niveles de la escalera de 90 son cubos (sorpresa)
// La escalera de 90 es solo plana (las figuras quedaron en sus modos beta: Figuras y Mixto)
export const CUBE_LEVELS = 80, CUBES_IN_LADDER = new Set();
const CUBE_OK = ['stones', 'ice', 'locks', 'nums', 'bombs', 'chains']; // en el cubo no hay giratorias, portales ni niebla
const CUBE_FROM = { stones: 4, ice: 7, locks: 11, nums: 15, bombs: 19, chains: 23 };
// Escalera de Figuras (30): empieza con cubos y van apareciendo las demás formas. Jefes 👑 en 10, 20 y 30.
const FIG_PLAN = ['cubo', 'cubo', 'cubo', 'cubo', 'cubo', 'caja', 'caja', 'torre', 'ele', 'cubo', 'cajon', 'torre', 'ele', 'escalera', 'cruz',
  'caja', 'dona', 'escalera', 'rara', 'cruz', 'ele', 'dona', 'rara', 'torre', 'escalera', 'rara', 'cruz', 'dona', 'rara', 'rara'];
// Del 31 al 80 (agregados después): se turnan figuras grandes y raras; jefes en 40, 50… 80
const FIG_MORE = ['rara', 'ele', 'escalera', 'cruz', 'torre', 'dona', 'cajon', 'rara', 'caja'], FIG_BOSS = ['dona', 'cruz', 'rara', 'escalera', 'rara'];
for (let L = 31; L <= 80; L++) FIG_PLAN.push(L % 10 === 0 ? FIG_BOSS[(L / 10 - 4) % FIG_BOSS.length] : FIG_MORE[(L - 31) % FIG_MORE.length]);
export const figTarget = L => L <= 5 ? 38 + (L - 1) * 10
  : L <= 30 ? Math.round((100 + (L - 6) * 14) * (L % 10 === 0 ? 1.2 : 1))
  : Math.min(780, Math.round((520 + (L - 30) * 4.6) * (L % 10 === 0 ? 1.12 : 1)));
// Lado de cada panel para llegar a esas flechas (~0,32 flechas por casilla)
const panelSize = (vox, arrows) => clamp(Math.round(Math.sqrt(arrows / (buildSurface(vox).panels.length * 0.32))), 3, 14);
const voxOf = (shape, key, size) => SHAPES[shape].v || randomShape(rng(hash('fig-' + key)), size);
export function cubeSpec(L) {
  const R = rng(hash('cubo-mods-' + L)), boss = L % 10 === 0, mods = [], shape = FIG_PLAN[L - 1], vox = voxOf(shape, L, Math.min(12, 6 + Math.floor(L / 8))), n0 = figTarget(L), N = panelSize(vox, n0);
  if (L >= CUBE_FROM.stones && (R() < 0.5 || boss)) mods.push('stones');
  const fresh = Object.entries(CUBE_FROM).find(([k, f]) => f === L && k !== 'stones')?.[0], extra = fresh ? [fresh] : [];
  for (const k of Object.keys(CUBE_FROM).filter(k => k !== 'stones' && CUBE_FROM[k] < L).sort(() => R() - 0.5)) if (extra.length < (boss ? 3 : 2) && R() < (boss ? 0.7 : 0.3)) extra.push(k);
  const sh = SHAPES[shape];
  return { key: 'c' + L, cubeL: L, num: L, cube: true, boss, shape, vox, title: `${sh.e} ${boss ? '👑 ' : ''}${sh.name} · figura ${L}`, n: N, minLen: 2, maxLen: N <= 4 ? 3 : 4, seed: hash('cubo-' + L), hard: L >= 6, mods: modsFor([...mods, ...extra], N, n0) };
}
// 🔀 Mixto (beta): 30 niveles; uno de cada 3 es una figura, los demás planos. Jefes en 10, 20 y 30.
export const MIX_LEVELS = 30;
const MIX_SHAPES = ['caja', 'torre', 'ele', 'escalera', 'cruz', 'dona', 'cajon', 'rara', 'ele', 'dona'];
export const mixTarget = L => Math.round((60 + (L - 1) * 15) * (L % 10 === 0 ? 1.2 : 1));
export function mixSpec(L) {
  const R = rng(hash('mixto-mods-' + L)), boss = L % 10 === 0, n0 = mixTarget(L), fig = L % 3 === 0;
  const intro = Object.keys(MOD_FROM).filter(k => k !== 'stones'), mods = [];
  if (L >= 4 && (R() < 0.4 || boss)) mods.push('stones');
  for (const k of intro.sort(() => R() - 0.5)) if (mods.filter(x => x !== 'stones').length < (boss ? 2 : 1) && L >= 6 && R() < 0.35 && (!fig || CUBE_OK.includes(k))) mods.push(k);
  const base = { key: 'm' + L, mixL: L, num: L, boss, seed: hash('mixto-' + L), hard: L >= 6, minLen: 2 };
  if (fig) {
    const shape = MIX_SHAPES[L / 3 - 1], vox = SHAPES[shape].v || randomShape(rng(hash('mixto-fig-' + L)), 7), N = panelSize(vox, n0);
    return { ...base, cube: true, shape, vox, title: `🔀 ${SHAPES[shape].e} ${boss ? '👑 ' : ''}Mixto ${L}`, n: N, maxLen: N <= 4 ? 3 : 4, mods: modsFor(mods, N, n0) };
  }
  const N = sizeFor(n0);
  return { ...base, title: `🔀 ${boss ? '👑 ' : ''}Mixto ${L}`, n: N, maxLen: 5, mods: modsFor(mods, N, n0) };
}
// (Antes: en la escalera de 90, los niveles 15, 35, 55 y 75 eran figuras)
const LADDER_SHAPES = { 15: 'cajon', 35: 'ele', 55: 'cruz', 75: 'dona' };
export const levelSpec = L => {
  if (CUBES_IN_LADDER.has(L)) { const shape = LADDER_SHAPES[L], vox = SHAPES[shape].v, n0 = levelTarget(L), N = panelSize(vox, n0); return { key: 'l' + L, num: L, cube: true, shape, vox, title: `${SHAPES[shape].e} Nivel ${L}`, n: N, minLen: 2, maxLen: 4, seed: hash('nivel-' + L), hard: true, mods: modsFor(levelMods(L).filter(k => CUBE_OK.includes(k)), N, n0) }; }
  if (L <= 5) { const N = L <= 3 ? 9 : 10; return { key: 'l' + L, num: L, title: 'Nivel ' + L, n: N, minLen: 2, maxLen: L <= 3 ? 3 : 4, seed: hash('nivel-' + L), mods: {} }; }
  const n0 = levelTarget(L), N = sizeFor(n0);
  return { key: 'l' + L, num: L, title: `${isBoss(L) ? '👑 ' : ''}Nivel ${L}`, n: N, minLen: 2, maxLen: 5, seed: hash('nivel-' + L), hard: true, boss: isBoss(L), mods: modsFor(levelMods(L), N, n0) };
};
// Modo infinito (después del 90)
export const infSpec = k => { const R = rng(hash('inf-' + k)), known = Object.keys(MOD_FROM).filter(x => x !== 'stones').sort(() => R() - 0.5).slice(0, 2), N = sizeFor(700);
  return { key: 'i' + k, num: k, inf: true, title: `♾️ Infinito ${k}`, n: N, minLen: 2, maxLen: 5, seed: hash('inf-' + k), hard: true, mods: modsFor(['stones', ...known], N, 700) }; };
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
  if (kind === 'cube' || kind.startsWith('fig-')) { const shape = kind === 'cube' ? 'cubo' : kind.slice(4), seed = Math.floor(Math.random() * 2 ** 31), vox = SHAPES[shape].v || randomShape(rng(seed), 7), N = panelSize(vox, 90);
    return { key: 'test', title: `🧪 ${SHAPES[shape].e} ${SHAPES[shape].name}`, n: N, minLen: 2, maxLen: 3, seed, test: kind, cube: true, shape, vox, mods: modsFor(['stones'], N, 90) }; }
  if (/^cv\d+$/.test(kind)) { const sp = cubeSpec(clamp(Number(kind.slice(2)), 1, CUBE_LEVELS)); return { ...sp, cubeL: 0, key: 'test', title: '🧪 ' + sp.title, test: kind }; }
  if (/^lv\d+$/.test(kind)) { const L = clamp(Number(kind.slice(2)), 1, LEVELS), sp = levelSpec(L); return { ...sp, key: 'test', title: '🧪 ' + sp.title, test: kind }; }
  const seed = Math.floor(Math.random() * 2 ** 31), all = kind === 'all' || kind === 'xp' || kind === 'duel', N = all ? 16 : 12, n0 = all ? 75 : 45;
  const keys = kind === 'tt' ? ['stones', 'ice'] : all ? Object.keys(MODS_INFO) : [kind];
  const title = kind === 'all' ? 'Prueba: todos' : kind === 'xp' ? 'Prueba experto' : kind === 'tt' ? 'Prueba contrarreloj' : kind === 'duel' ? 'Prueba duelo' : `Prueba: ${MODS_INFO[kind][1]}`;
  return { key: 'test', title: '🧪 ' + title, n: N, minLen: 2, maxLen: 4, seed, test: kind, hard: kind === 'xp', timed: kind === 'tt', fake: kind === 'duel', mods: modsFor(keys, N, n0) };
};
const boardOf = spec => (spec.board ??= spec.cube ? generateShape(spec) : generate(spec));

/* ---------- Datos ---------- */
const progress = (id = uid()) => S.data.arrows.find(d => d.id === 'p-' + id) || {};
const myLevel = () => progress().lv || 1; // siguiente nivel por jugar (91 = terminó los 90)
const myInf = () => progress().inf || 1;
const myCube = () => progress().cv || 1;
const myMix = () => progress().mv || 1;
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
  const L = myLevel(), pr = progress(), st = pr.ls || {}, lx = pr.lx || {};
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  const d = daily(), me = d[uid()], p = partnerUid(), them = p && d[p], ds = dailySpec(), pp = p ? progress(p) : {};
  const surprise = isOwner() && !giftInfo().on, xp = expertOn();
  const cont = spec => { const s = loadSave(spec.key); return s ? ` · vas en ${s.removed.length} de ${s.total}` : ''; };
  const modList = m => Object.keys(m).map(k => MODS_INFO[k][0]).join(' ');
  const dayRow = (who, r) => `<div class="row"><span>${who}</span><span class="small">${r ? `${r.expert ? '💀 ' : ''}<b>${fmtMs(r.ms)}</b> · ${r.errors} ${r.errors === 1 ? 'error' : 'errores'}${r.hints ? ` · ${r.hints} 💡` : ''}` : '<span class="muted">sin terminar</span>'}</span></div>`;
  const winner = me && them ? (score(me) === score(them) ? '¡Empate! 🤝' : score(me) < score(them) ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`) : '';
  const done = L > LEVELS, cur = done ? infSpec(myInf()) : levelSpec(L), nm = done ? null : newModAt(L);
  const lvBtn = n => n > L ? `<button disabled aria-label="Nivel ${n} bloqueado"><b>${n}</b><small>${isBoss(n) ? '👑' : CUBES_IN_LADDER.has(n) ? '🧊' : '🔒'}</small></button>`
    : `<button class="${n === L ? 'cur' : ''}${isBoss(n) ? ' boss' : ''}" onclick="playArrows('l${n}')" aria-label="Nivel ${n}"><b>${lx[n] ? '💀' : ''}${n}</b><small>${st[n] ? stars(st[n]) : n === L ? 'nuevo' : isBoss(n) ? '👑' : CUBES_IN_LADDER.has(n) ? '🧊' : ''}</small></button>`;
  $('s-arrows').innerHTML = `${backBar('Flechas', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${surprise ? `<div class="glass small" style="border-color:rgba(255,181,71,.5)">🔒 <b>Sorpresa:</b> solo tú lo ves. Cuando quieras regalarlo: Administración → Pruebas → 🎁 Sorpresa.</div>` : ''}
    ${testCard()}
    ${duelCard()}
    <div class="glass stack ar-hero ${cur.boss ? 'boss' : 'hard'}"><div class="ar-hero-ic">${done ? '🏆' : cur.boss ? '👑' : L <= 5 ? '🌱' : '🔥'}</div>
      <div class="stack" style="gap:2px;align-items:center"><span class="label">📄 Plano · ${done ? `¡completaste los ${LEVELS} niveles!` : `nivel ${L} de ${LEVELS}${cur.boss ? ' · jefe' : ''}`}</span>
      <span class="tiny muted">${done ? `♾️ Modo infinito · tablero ${myInf()} · ` : ''}Unas ${done ? 700 : levelTarget(L)} flechas${Object.keys(cur.mods).length ? ' · ' + modList(cur.mods) : ''}${cont(cur)}</span>
      ${nm ? `<span class="small">✨ Se estrena: ${MODS_INFO[nm][0]} ${MODS_INFO[nm][1]}</span>` : ''}</div>
      <button class="btn" onclick="playArrows('${done ? 'i' + myInf() : 'l' + L}')">${loadSave(cur.key) ? 'Continuar' : done ? 'Jugar infinito' : `Jugar nivel ${L}`}</button>
      <div class="ar-bar"><i style="width:${Math.min(100, (L - 1) / LEVELS * 100)}%"></i></div>
      <label class="row ar-xp"><input type="checkbox" ${xp ? 'checked' : ''} onchange="arrowsExpert(this.checked)"><span class="small">💀 Modo experto: sin pistas, sin recuperar vidas ni pagar para seguir (desde el nivel 6 y en el reto)</span></label></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo para los dos</span></div>
      <p class="tiny muted" style="margin:0">Hoy: ${ds.n}×${ds.n} · ${modList(ds.mods)}${cont(ds)}. Crece durante la semana: el domingo es el más grande.</p>
      ${dayRow('Tú', me)}${p ? dayRow(esc(nameOf(p)), them) : ''}
      ${winner ? `<p class="small center" style="margin:0"><b>${winner}</b></p>` : ''}
      ${me ? '<p class="tiny muted center" style="margin:0">Mañana hay otro 😉</p>' : `<button class="btn ghost" onclick="playArrows('day')">${loadSave(ds.key) ? 'Continuar el reto' : 'Jugar el reto de hoy'}</button>`}</div>
    <div class="glass stack"><div class="row"><span class="label">⏱️ Contrarreloj</span><button class="btn small" onclick="playArrows('tt')">Jugar</button></div>
      <p class="tiny muted" style="margin:0">Saca todas las flechas que puedas en 5 minutos. Cada error resta 10 segundos.</p>
      <div class="row"><span class="small">Récord: tú <b>${pr.tt || 0}</b>${p ? ` · ${esc(nameOf(p))} <b>${pp.tt || 0}</b>` : ''}</span></div></div>
    <p class="tiny muted center" style="margin:4px 8px 0">Modos en prueba: pueden cambiar y tener detalles todavía.</p>
    ${cubeCard()}
    ${mixCard()}
    <div class="glass stack"><span class="label">🗺️ Niveles</span><div class="ar-levels">${Array.from({ length: LEVELS }, (_, i) => lvBtn(i + 1)).join('')}</div></div>
    <div class="glass stack"><span class="label">📖 Obstáculos</span>${Object.entries(MODS_INFO).map(([k, [e, t, txt]]) => `<p class="small" style="margin:0">${e} <b>${t}</b> <span class="tiny muted">(desde el nivel ${MOD_FROM[k]})</span><br><span class="muted">${txt}</span></p>`).join('')}</div>
    <p class="tiny muted center" style="margin:0 8px">Toca una flecha: avanza hacia donde apunta y sale si nada la bloquea. Si choca pierdes una vida ❤️; cada ${LIFE_EVERY} flechas recuperas una. Con dos dedos acercas o alejas el tablero. Si sales, la partida queda guardada.</p>`;
}
function mixCard() {
  const V = myMix(), ms = progress().ms || {}, done = V > MIX_LEVELS, cur = mixSpec(Math.min(V, MIX_LEVELS));
  const btn = n => n > V ? `<button disabled aria-label="Mixto ${n} bloqueado"><b>${n}</b><small>${n % 10 === 0 ? '👑' : n % 3 === 0 ? '🧊' : '🔒'}</small></button>`
    : `<button class="${n === V ? 'cur' : ''}${n % 10 === 0 ? ' boss' : ''}" onclick="playArrows('m${n}')" aria-label="Mixto ${n}"><b>${n}</b><small>${ms[n] ? stars(ms[n]) : n === V ? 'nuevo' : n % 10 === 0 ? '👑' : n % 3 === 0 ? '🧊' : ''}</small></button>`;
  return `<div class="glass stack ar-mixcard"><div class="row"><span class="label">🔀 Mixto <span class="ar-beta">BETA</span> · ${done ? '¡completo! 🏆' : `nivel ${V} de ${MIX_LEVELS}`}</span>
      ${done ? '' : `<button class="btn small" onclick="playArrows('m${V}')">${loadSave(cur.key) ? 'Continuar' : 'Jugar'}</button>`}</div>
    <p class="tiny muted" style="margin:0">Tableros planos y figuras 3D intercalados: uno de cada tres niveles es una figura.${done ? '' : ` Este: ${cur.cube ? `${SHAPES[cur.shape].e} ${SHAPES[cur.shape].name}` : 'plano'}, ~${mixTarget(Math.min(V, MIX_LEVELS))} flechas.`}</p>
    <div class="ar-levels">${Array.from({ length: MIX_LEVELS }, (_, i) => btn(i + 1)).join('')}</div></div>`;
}
function cubeCard() {
  const V = myCube(), cs = progress().cs || {}, done = V > CUBE_LEVELS, cur = cubeSpec(Math.min(V, CUBE_LEVELS));
  const btn = n => n > V ? `<button disabled aria-label="Figura ${n} bloqueada"><b>${n}</b><small>${n % 10 === 0 ? '👑' : SHAPES[FIG_PLAN[n - 1]].e}</small></button>`
    : `<button class="${n === V ? 'cur' : ''}${n % 10 === 0 ? ' boss' : ''}" onclick="playArrows('c${n}')" aria-label="Figura ${n}"><b>${n}</b><small>${cs[n] ? stars(cs[n]) : n === V ? 'nuevo' : n % 10 === 0 ? '👑' : SHAPES[FIG_PLAN[n - 1]].e}</small></button>`;
  return `<div class="glass stack ar-cubecard"><div class="row"><span class="label">🧊 Figuras <span class="ar-beta">BETA</span> · ${done ? `¡las ${CUBE_LEVELS} completas! 🏆` : `nivel ${V} de ${CUBE_LEVELS}`}</span>
      ${done ? '' : `<button class="btn small" onclick="playArrows('c${V}')">${loadSave(cur.key) ? 'Continuar' : 'Jugar'}</button>`}</div>
    <p class="tiny muted" style="margin:0">Figuras en 3D hechas de cubitos: arrastra para girarlas. Cada flecha sale por una arista; en los rincones choca con la pared. Algunas tienen el cuerpo doblado sobre otra cara y la estorban.${done ? '' : ` Esta: ${SHAPES[cur.shape].e} ${SHAPES[cur.shape].name}, ~${figTarget(Math.min(V, CUBE_LEVELS))} flechas${Object.keys(cur.mods).length ? ' · ' + Object.keys(cur.mods).map(k => MODS_INFO[k][0]).join(' ') : ''}.`}</p>
    <div class="ar-levels">${Array.from({ length: CUBE_LEVELS }, (_, i) => btn(i + 1)).join('')}</div></div>`;
}
function testCard() {
  if (!isOwner()) return '';
  const b = (k, label) => `<button class="btn ghost small" onclick="playArrows('t:${k}')">${label}</button>`;
  return `<details class="glass stack ar-test"><summary class="label">🧪 Zona de pruebas · solo tú</summary>
    <p class="tiny muted" style="margin:6px 0">Tableros chicos para ver cada cosa. No guardan récords, monedas ni partida, y no mandan avisos.</p>
    <div class="grid3">${Object.entries(MODS_INFO).map(([k, [e, t]]) => b(k, `${e} ${t}`)).join('')}</div>
    <div class="add-row" style="margin-top:8px"><input id="arTestLv" type="number" min="1" max="${LEVELS}" inputmode="numeric" placeholder="Ir al nivel (1-${LEVELS})" aria-label="Nivel a probar" onkeydown="if(event.key==='Enter')arrowsTestLevel()"><button class="btn small" onclick="arrowsTestLevel()">Nivel</button><button class="btn small" onclick="arrowsTestCube()">🧊 Figura</button></div>
    <p class="tiny muted" style="margin:0">Escribe un número y elige: nivel (1-${LEVELS}) o figura (1-${CUBE_LEVELS}). Se ve tal cual, sin desbloquearlo ni guardarlo.</p>
    <div class="grid2" style="margin-top:8px">${b('all', '🎲 Todos juntos')}${b('xp', '💀 Experto')}${b('tt', '⏱️ Contrarreloj 1 min')}${b('duel', '⚔️ Duelo vs 🤖')}</div>
    <p class="tiny muted" style="margin:8px 0 4px">Figuras chicas (~90 flechas):</p>
    <div class="grid3">${Object.entries(SHAPES).map(([k, x]) => b('fig-' + k, `${x.e} ${x.name}`)).join('')}</div></details>`;
}
function arrowsTestCube() { const n = Number($('arTestLv')?.value); if (!(n >= 1 && n <= CUBE_LEVELS)) return toast(`Escribe una figura del 1 al ${CUBE_LEVELS}`); playArrows('t:cv' + n); }
function arrowsTestLevel() { const n = Number($('arTestLv')?.value); if (!(n >= 1 && n <= LEVELS)) return toast(`Escribe un nivel del 1 al ${LEVELS}`); playArrows('t:lv' + n); }
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
  const c = /^c(\d+)$/.exec(String(what)); if (c) return cubeSpec(clamp(Number(c[1]), 1, CUBE_LEVELS));
  const mx = /^m(\d+)$/.exec(String(what)); if (mx) return mixSpec(clamp(Number(mx[1]), 1, MIX_LEVELS));
  const m = /^([li])(\d+)$/.exec(String(what)); if (!m) return levelSpec(Math.min(LEVELS, myLevel()));
  return m[1] === 'i' ? infSpec(Number(m[2])) : levelSpec(clamp(Number(m[2]), 1, LEVELS));
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
// Índice de una casilla [x, y, cara?] (en el plano la cara es 0)
const cix = (N, c) => (c[2] || 0) * N * N + c[1] * N + c[0];
const ix = c => cix(G.N, c);
function newGame(spec, what) {
  // Una casilla por cada casilla del tablero (en las figuras: paneles × N²; antes se asumían 6 caras y en figuras de
  // más paneles las casillas sobrantes quedaban «vacías»: las flechas atravesaban a las de otros cubitos)
  const board = boardOf(spec), N = board.N, occ = new Int32Array(board.base.length).fill(-1);
  for (const a of board.list) for (const c of a.cells) occ[cix(N, c)] = a.id;
  const xp = spec.test === 'xp' || ((spec.hard || spec.day) && (!spec.test || /^(lv|cv)/.test(spec.test)) && expertOn());
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
  for (const id of sv.removed) { const a = board.list[id]; if (!a) continue; G.gone.add(id); for (const c of a.cells) occ[cix(N, c)] = -1; if (a.num) G.next++; }
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
  if (a.chain != null && G.board.cube) out.push(['cn', '🔗', '#2b2340']);
  return out;
}
function badgesSVG(a) {
  const [mx, my] = ctr(G.board.cube ? headCell(a) : midCell(a)), r = C * 0.27;
  return badgesOf(a).map(([k, txt, fill], i) => `<g class="bd ${k}" transform="translate(${mx + C * 0.3 + i * r * 1.9} ${my - C * 0.3})"><circle r="${r}" fill="${fill}"/>
    <text class="${k}-t" font-size="${k === 'nm' || k === 'bm' ? C * 0.34 : C * 0.3}" text-anchor="middle" dominant-baseline="central"${k === 'nm' ? ' fill="#1a1024"' : k === 'bm' || k === 'rt' ? ' fill="#fff"' : ''}>${txt}</text></g>`).join('');
}
function arrowSVG(a) {
  const ice = a.ice && !G.cracked.has(a.id);
  return `<g id="ag${a.id}" data-a="${a.id}" class="${ice ? 'ice' : ''}" style="color:${a.c}">${ice ? `<path class="ib" d="${ptsD(bodyPts(a))}" stroke-width="${C * 0.66}"/>` : ''}<path class="ab" d="${ptsD(bodyPts(a))}" stroke-width="${C * 0.3}"/><path class="ah" d="${headD(a)}"/>${badgesSVG(a)}</g>`;
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
    ${G.board.cube ? cubeHTML() : `<div class="ar-vp" id="arVp"><div class="ar-world" id="arWorld" style="width:${W}px;height:${W}px;--c:${C}px">
      <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" id="arSvg">${boardSVG()}</svg></div></div>`}
    <div class="ar-bottom">${hint ? `<button class="btn ghost small" onclick="arrowHint()">💡 Pista${sp.day ? ' (+10 s)' : ''}</button>` : ''}<button class="btn ghost small" onclick="arrowFit()">⤢ Ver todo</button>${G.board.cube && G.board.vox.length > 1 ? '<button class="btn ghost small" id="arXray" onclick="arrowsXray()">👁️</button>' : ''}
      ${sp.fake ? '' : sp.duel ? '<button class="btn ghost small" onclick="duelGiveUp()">🏳️ Rendirme</button>' : sp.timed ? '' : '<button class="btn ghost small" onclick="restartArrows()">↺ Reiniciar</button>'}</div>`;
  updateFog(); updateHud(); tickClock(); G.board.cube ? setupCube() : setupCamera();
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

/* ---------- Cubo 3D: una SVG por cara puesta con matrix3d; se gira arrastrando ---------- */
const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Trazos de una flecha por panel (en px de cada panel); al doblar una arista o un rincón el trazo sigue en el panel vecino
function cubePieces(a) {
  const N = G.N, W = N * C, S = G.board.shape, out = {}, cells = a.cells;
  const loc = (p, p3) => { const P = S.panels[p], q = add3(p3, P.o, -1); return [dot3(q, P.u) * W, dot3(q, P.vv) * W]; };
  let curP = cells[0][2], cur = [ctr(cells[0])];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i], pc = cells[i - 1];
    if (c[2] === pc[2]) { cur.push(ctr(c)); continue; }
    // Punto del borde entre las dos casillas: avanzando en w desde la primera (w = dirección del paso)
    const c1 = cellCenter(S, N, pc), c2 = cellCenter(S, N, c), n1 = S.panels[pc[2]].n, n2 = S.panels[c[2]].n, dlt = add3(c2, c1, -1);
    const same = n1[0] === n2[0] && n1[1] === n2[1] && n1[2] === n2[2];
    const w = same ? dlt.map(v => Math.round(v * N)) : dot3(n2, dlt) > 0 ? n2 : n2.map(v => -v);
    const e3 = add3(c1, w, 0.5 / N);
    cur.push(loc(pc[2], e3)); (out[curP] ||= []).push(cur); curP = c[2]; cur = [loc(c[2], e3), ctr(c)];
  }
  const [dx, dy] = DIRS[a.d], h = cur[cur.length - 1]; cur[cur.length - 1] = [h[0] + dx * C * 0.08, h[1] + dy * C * 0.08];
  (out[curP] ||= []).push(cur);
  return out;
}
const multiD = lines => lines.map(ptsD).join('');
function cubeArrowSVG(a) {
  const ice = a.ice && !G.cracked.has(a.id), hp = headCell(a)[2], parts = cubePieces(a), out = {};
  for (const [p, lines] of Object.entries(parts)) {
    const d = multiD(lines), head = Number(p) === hp;
    out[p] = `<g ${head ? `id="ag${a.id}"` : ''} data-a="${a.id}" data-p="${p}" class="${ice ? 'ice' : ''}" style="color:${a.c}">${ice ? `<path class="ib" d="${d}" stroke-width="${C * 0.66}"/>` : ''}<path class="ht" d="${d}" stroke-width="${C * 0.7}"/><path class="ab" d="${d}" stroke-width="${C * 0.3}"/>${head ? `<path class="ah" d="${headD(a)}"/>${badgesSVG(a)}` : ''}</g>`;
  }
  return out;
}
// Centro y tamaño de la figura (en cubitos)
function shapeBox() {
  const V = G.board.vox, mn = [0, 1, 2].map(i => Math.min(...V.map(v => v[i]))), mx = [0, 1, 2].map(i => Math.max(...V.map(v => v[i])) + 1);
  return { c: mn.map((m, i) => (m + mx[i]) / 2), size: Math.max(...mx.map((m, i) => m - mn[i])) };
}
function cubeHTML() {
  const N = G.N, M = N * N, W = N * C, S = G.board.shape, panels = S.panels.map(() => ''), box = shapeBox();
  for (const k of G.board.stones) { const p = Math.floor(k / M), x = (k % M) % N * C, y = Math.floor((k % M) / N) * C;
    panels[p] += `<rect class="stone" x="${x + C * 0.1}" y="${y + C * 0.1}" width="${C * 0.8}" height="${C * 0.8}" rx="${C * 0.26}"/><circle class="stone-hl" cx="${x + C * 0.36}" cy="${y + C * 0.34}" r="${C * 0.1}"/>`; }
  for (const a of G.board.list) if (!G.gone.has(a.id)) for (const [p, html] of Object.entries(cubeArrowSVG(a))) panels[p] += html;
  const css = v => [v[0], -v[1], v[2]];
  return `<div class="ar-vp ar-vp3" id="arVp"><div class="ar-cube" id="arCube">${S.panels.map((P, p) => {
    const u = css(P.u), v = css(P.vv), n = css(P.n), t = [(P.o[0] - box.c[0]) * W, -(P.o[1] - box.c[1]) * W, (P.o[2] - box.c[2]) * W];
    // Borde solo en las aristas y rincones de verdad; donde sigue la misma cara (otro cubito pegado) no se marca nada
    const side = d => { const w = d === 0 ? P.vv.map(x => -x) : d === 1 ? P.u : d === 2 ? P.vv : P.u.map(x => -x), c = d === 0 ? [0, 0, p] : d === 1 ? [N - 1, 0, p] : d === 2 ? [0, N - 1, p] : [0, 0, p];
      return shapeStep(S, N, c, w).kind === 'flat'; };
    const flat = [0, 1, 2, 3].map(side);
    const edges = [[0, 0, W, 0], [W, 0, W, W], [0, W, W, W], [0, 0, 0, W]].map((l, d) => flat[d] ? '' : `<line class="edge" x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}"/>`).join('');
    const ext = `--t:${flat[0] ? -1 : 0}px;--r:${flat[1] ? -1 : 0}px;--b:${flat[2] ? -1 : 0}px;--l:${flat[3] ? -1 : 0}px`;
    return `<div class="ar-face" id="arF${p}" style="width:${W}px;height:${W}px;${ext};transform:matrix3d(${[...u, 0, ...v, 0, ...n, 0, ...t, 1].map(x => Math.round(x * 1000) / 1000).join(',')})"><svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${edges}${panels[p]}</svg></div>`;
  }).join('')}</div></div>`;
}
function setupCube() {
  const vp = $('arVp'), cube = $('arCube'), W = G.N * C, S = G.board.shape, box = shapeBox();
  const rect = () => vp.getBoundingClientRect();
  const fitK = () => { const r = rect(); return Math.min(r.width, r.height) / (W * box.size * (box.size > 1 ? 1.75 : 1.55)); };
  const cam = G.cam = { k: fitK(), rx: -24, ry: -34 };
  const kMax = () => Math.max(fitK() * 3 * box.size, 46 / C), kMin = () => fitK() * 0.8;
  const rad = d => d * Math.PI / 180;
  // Profundidad de cada panel (para tocar el de adelante) y caras de espaldas ocultas
  const view = (v3, rx, ry) => { const x = v3[0], y = -v3[1], z = v3[2], z1 = -x * Math.sin(ry) + z * Math.cos(ry); return y * Math.sin(rx) + z1 * Math.cos(rx); };
  G.panelZ = [];
  const apply = () => {
    cam.rx = Math.max(-88, Math.min(88, cam.rx));
    cube.style.transform = `scale(${cam.k}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`;
    const rx = rad(cam.rx), ry = rad(cam.ry);
    S.panels.forEach((P, p) => {
      const ctrP = add3(add3(P.o, P.u, 0.5), P.vv, 0.5).map((v, i) => v - box.c[i]);
      G.panelZ[p] = view(ctrP, rx, ry);
      $('arF' + p)?.classList.toggle('back', view(P.n, rx, ry) < 0.03);
    });
  };
  G.fit = () => { cam.k = fitK(); apply(); };
  // Girar hacia la cara de una flecha. Si se pasa la flecha, se prueban varios ángulos hasta uno donde de verdad se vea
  // (en la dona o en los rincones, mirando la cara de frente la puede tapar otra parte de la figura).
  G.focusFace = (p, id) => {
    const n = S.panels[p].n, from = { rx: cam.rx, ry: cam.ry, k: cam.k }, k = Math.max(cam.k, fitK() * 1.2);
    const baseRy = Math.abs(n[1]) > 0.5 ? cam.ry : -Math.atan2(n[0], n[2]) * 180 / Math.PI - 12;
    const baseRx = n[1] > 0.5 ? -80 : n[1] < -0.5 ? 80 : -12, cands = [];
    for (let rx = -85; rx <= 85; rx += 10) for (let dy = -180; dy < 180; dy += 15) cands.push([rx, baseRy + dy]);
    cands.sort((a, b) => Math.abs(a[0] - baseRx) + Math.abs(a[1] - baseRy) - Math.abs(b[0] - baseRx) - Math.abs(b[1] - baseRy)); // primero los más parecidos a ver la cara de frente
    let pickV = cands[0];
    if (id != null) {
      const a = G.board.list[id], [hx, hy, hp] = headCell(a), P = S.panels[hp], N = G.N;
      const head3 = [0, 1, 2].map(i => P.o[i] + P.u[i] * (hx + 0.5) / N + P.vv[i] * (hy + 0.5) / N);
      cam.k = k;
      for (const [rx, ry] of cands) { cam.rx = rx; cam.ry = ry; apply(); const [sx, sy] = cubeProjector()(head3); if (cubePick(sx, sy) === id) { pickV = [rx, ry]; break; } }
      Object.assign(cam, from); apply();
    }
    [cam.rx, cam.ry] = pickV; cam.k = k;
    cube.style.transition = 'transform .45s ease'; apply(); setTimeout(() => { cube.style.transition = ''; }, 480);
  };
  apply();
  const pts = new Map(); let start = null, pinch = null, moved = false;
  vp.onpointerdown = e => {
    vp.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, rx: cam.rx, ry: cam.ry, t: Date.now() }; moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k }; moved = true; }
  };
  vp.onpointermove = e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) { const [a, b] = [...pts.values()]; cam.k = Math.min(kMax(), Math.max(kMin(), pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); apply(); }
    else if (start && pts.size === 1) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) > 8) moved = true;
      if (moved) { cam.ry = start.ry + dx * 0.4; cam.rx = start.rx - dy * 0.4; apply(); }
    }
  };
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, rx: cam.rx, ry: cam.ry, t: Date.now() }; return; }
    if (!pts.size && start && !moved && Date.now() - start.t < 500) cubeTap(e.clientX, e.clientY);
    start = null;
  };
  vp.onpointerup = up; vp.onpointercancel = e => { moved = true; up(e); };
  vp.oncontextmenu = e => e.preventDefault();
  vp.onwheel = e => { e.preventDefault(); cam.k = Math.min(kMax(), Math.max(kMin(), cam.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); apply(); };
}
// Ver a través: los paneles se vuelven medio transparentes para ver lo que hay detrás
function arrowsXray() { const c = $('arCube'); if (!c) return; c.classList.toggle('xray'); $('arXray')?.classList.toggle('on', c.classList.contains('xray')); }
// Toque en la figura, con geometría (no depende de qué dibujo SVG queda bajo el dedo):
// cada casilla de los paneles que miran a la cámara se proyecta a la pantalla con el mismo giro, zoom y perspectiva que
// usa el CSS (.ar-vp3 perspective, .ar-cube scale·rotateX·rotateY). Se elige la casilla bajo el dedo del panel más cercano
// a la vista; si está vacía, la flecha más cercana de ese mismo panel (a menos de ~1 casilla). Así nunca se toma una
// flecha de otro lugar (antes, cerca de las uniones entre cubitos, a veces salía la vecina).
const PERSPECTIVE = 1600; // igual que .ar-vp3 en styles.css
export function cubeProjector() {
  const { k, rx, ry } = G.cam, W = G.N * C, box = shapeBox(), r = $('arVp').getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, sx = Math.sin(rx * Math.PI / 180), cxr = Math.cos(rx * Math.PI / 180), sy = Math.sin(ry * Math.PI / 180), cyr = Math.cos(ry * Math.PI / 180);
  // Punto de la figura (en cubitos, y hacia arriba) → [x, y en pantalla, profundidad (mayor = más cerca)]
  return p3 => {
    const X = (p3[0] - box.c[0]) * W, Y = -(p3[1] - box.c[1]) * W, Z = (p3[2] - box.c[2]) * W;
    const x1 = X * cyr + Z * sy, z1 = -X * sy + Z * cyr, y2 = Y * cxr - z1 * sx, z2 = Y * sx + z1 * cxr;
    const qx = x1 * k, qy = y2 * k, qz = z2 * k, f = PERSPECTIVE / (PERSPECTIVE - qz);
    return [cx + qx * f, cy + qy * f, qz];
  };
}
// ¿El punto está dentro del cuadrilátero (convexo) a, b, c, d?
const inQuad = (x, y, q) => { let sign = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (cr !== 0) { if (sign && Math.sign(cr) !== sign) return false; sign = Math.sign(cr); } } return true; };
export function cubePick(x, y) {
  const S = G.board.shape, N = G.N, M = N * N, proj = cubeProjector();
  let best = null;
  // Las caras casi de canto (se ven como una rayita) no se tocan: ahí cualquier toque sería al azar
  const { rx, ry } = G.cam, srx = Math.sin(rx * Math.PI / 180), crx = Math.cos(rx * Math.PI / 180), sry = Math.sin(ry * Math.PI / 180), cry = Math.cos(ry * Math.PI / 180);
  const facing = n => -n[1] * srx + (-n[0] * sry + n[2] * cry) * crx;
  S.panels.forEach((P, p) => {
    if ($('arF' + p)?.classList.contains('back') || facing(P.n) < 0.2) return;
    const at = (i, j) => proj([P.o[0] + P.u[0] * i / N + P.vv[0] * j / N, P.o[1] + P.u[1] * i / N + P.vv[1] * j / N, P.o[2] + P.u[2] * i / N + P.vv[2] * j / N]);
    const quad = [at(0, 0), at(N, 0), at(N, N), at(0, N)];
    if (!inQuad(x, y, quad)) return;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (!inQuad(x, y, q)) continue;
      const z = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
      if (!best || z > best.z) best = { p, i, j, z, at };
    }
  });
  if (!best) return -1;
  const { p, i, j, at } = best, here = G.occ[p * M + j * N + i];
  if (here >= 0) return here;
  // Casilla vacía: la flecha más cercana del mismo panel (en pantalla), si está a menos de ~1 casilla
  const cell = at(1, 0), o = at(0, 0), cellPx = Math.hypot(cell[0] - o[0], cell[1] - o[1]);
  let pick = -1, bd = Infinity;
  for (let jj = j - 1; jj <= j + 1; jj++) for (let ii = i - 1; ii <= i + 1; ii++) {
    if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
    const id = G.occ[p * M + jj * N + ii]; if (id < 0) continue;
    const c = at(ii + 0.5, jj + 0.5), d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bd) { bd = d; pick = id; }
  }
  return bd < cellPx * 1.1 ? pick : -1;
}
function cubeTap(x, y) {
  if (!G || G.over) return;
  const id = cubePick(x, y);
  if (id >= 0) tapArrow(id);
}
// Movimiento en las figuras, como en el plano: la flecha avanza como serpiente por su propio trazo (cruzando aristas y
// rincones), sigue por su camino y al llegar a la arista sale hacia afuera en el plano de su cara. Se dibuja con trazos
// temporales en cada panel por el que pasa; de cada uno se muestra solo el tramo que ocupa la serpiente en ese momento.
function seqPieces(seq) {
  const N = G.N, W = N * C, S = G.board.shape, out = [];
  const loc = (p, p3) => { const P = S.panels[p], q = add3(p3, P.o, -1); return [dot3(q, P.u) * W, dot3(q, P.vv) * W]; };
  let cur = { p: seq[0][2], pts: [ctr(seq[0])] };
  for (let i = 1; i < seq.length; i++) {
    const c = seq[i], pc = seq[i - 1];
    if (c[2] === pc[2]) { cur.pts.push(ctr(c)); continue; }
    const c1 = cellCenter(S, N, pc), c2 = cellCenter(S, N, c), n1 = S.panels[pc[2]].n, n2 = S.panels[c[2]].n, dlt = add3(c2, c1, -1);
    const same = n1[0] === n2[0] && n1[1] === n2[1] && n1[2] === n2[2];
    const w = same ? dlt.map(v => Math.round(v * N)) : dot3(n2, dlt) > 0 ? n2 : n2.map(v => -v), e3 = add3(c1, w, 0.5 / N);
    cur.pts.push(loc(pc[2], e3)); out.push(cur); cur = { p: c[2], pts: [loc(c[2], e3), ctr(c)] };
  }
  out.push(cur);
  return out;
}
const segLen = pts => pts.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
function pointAt(pts, t) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay);
    if (t <= l || i === pts.length - 1) { const f = l ? Math.min(1, t / l) : 0; return [ax + (bx - ax) * f, ay + (by - ay) * f, (bx - ax) / (l || 1), (by - ay) / (l || 1)]; }
    t -= l;
  }
  return [...pts[0], 1, 0];
}
function cubeMove(a, g, dist, back) {
  const N = G.N, M = N * N, [dx, dy] = DIRS[a.d], statics = pieces(a.id);
  // Camino completo: cuerpo + casillas del camino (hasta el choque si regresa) + salida al aire más allá de la arista
  const rayCells = (back ? a.ray.slice(0, Math.ceil(dist / C) + 1) : a.ray).map(k => [k % N, Math.floor((k % M) / N), Math.floor(k / M)]);
  const parts = seqPieces([...a.cells, ...rayCells]);
  const bodyLen = seqPieces(a.cells).reduce((t, x) => t + segLen(x.pts), 0); // largo del cuerpo (de la cola a la punta)
  if (!back) { const last = parts[parts.length - 1], [lx, ly] = last.pts[last.pts.length - 1]; last.pts.push([lx + dx * (bodyLen + C * 2.5), ly + dy * (bodyLen + C * 2.5)]); }
  let acc = 0; for (const x of parts) { x.a = acc; x.len = segLen(x.pts); acc += x.len; }
  const travel = back ? dist : acc - bodyLen;
  // Trazos temporales por panel
  const svgOf = p => $('arF' + p)?.querySelector('svg'), NS = 'http://www.w3.org/2000/svg', made = [], heads = {};
  for (const x of parts) {
    const el = document.createElementNS(NS, 'path'); el.setAttribute('class', 'ab mv'); el.setAttribute('d', ptsD(x.pts)); el.setAttribute('stroke-width', C * 0.3); el.style.color = a.c;
    svgOf(x.p)?.appendChild(el); x.el = el; made.push(el);
    if (!heads[x.p]) { const h = document.createElementNS(NS, 'path'); h.setAttribute('class', 'ah mv'); h.style.color = a.c; h.style.fill = a.c; svgOf(x.p)?.appendChild(h); heads[x.p] = h; made.push(h); }
  }
  statics.forEach(e => e.style.visibility = 'hidden');
  const draw = (sv, op) => {
    for (const x of parts) {
      const v0 = Math.max(sv, x.a), v1 = Math.min(sv + bodyLen, x.a + x.len);
      if (v1 - v0 > 0.5) { x.el.style.display = ''; x.el.style.strokeDasharray = `${v1 - v0} 999999`; x.el.style.strokeDashoffset = -(v0 - x.a); }
      else x.el.style.display = 'none';
      x.el.style.opacity = op;
    }
    const H = sv + bodyLen, hp = [...parts].reverse().find(x => H >= x.a - 0.01) || parts[0];
    for (const [p, h] of Object.entries(heads)) h.style.display = Number(p) === hp.p ? '' : 'none';
    const [hx, hy, tx, ty] = pointAt(hp.pts, H - hp.a), px = -ty, py = tx, t = C * 0.42, bb = C * 0.02, w = C * 0.27;
    heads[hp.p].setAttribute('d', `M${hx + tx * t} ${hy + ty * t}L${hx + tx * bb + px * w} ${hy + ty * bb + py * w}L${hx + tx * bb - px * w} ${hy + ty * bb - py * w}Z`);
    heads[hp.p].style.opacity = op;
  };
  const dur = back ? 240 + dist / C * 40 : Math.min(950, 260 + travel / C * 22), t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const sv = back ? dist * Math.sin(p * Math.PI) : travel * (p * p * (3 - 2 * p) * 0.4 + p * 0.6);
    draw(sv, back ? 1 : p > 0.72 ? (1 - p) / 0.28 : 1);
    if (p < 1) return requestAnimationFrame(step);
    made.forEach(e => e.remove());
    if (back) statics.forEach(e => e.style.visibility = '');
    else statics.forEach(e => e.remove());
  };
  draw(0, 1); requestAnimationFrame(step);
}

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
  if (G.board.cube) { // en las figuras, el camino ya viene calculado (derecho por los paneles planos hasta una arista)
    let steps = 0; for (const k of a.ray) { const o = G.occ[k]; if (o >= 0 && o !== ignore) return { free: false, steps, blocker: o, straight: true }; steps++; }
    return { free: true, steps };
  }
  let [x, y] = headCell(a), steps = 0, straight = true, hops = 0;
  const off = 0;
  for (;;) {
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= N || y >= N) return { free: true, steps, portal: hops > 0 };
    const k = off + y * N + x, b = base[k];
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
  const g = $('ag' + id); pieces(id).forEach(e => e.classList.remove('hint')); navigator.vibrate?.(8);
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
  pieces(a.id).forEach(e => { if (e !== g) { e.classList.remove('ice'); e.querySelector('.ib')?.remove(); } });
  g.classList.remove('ice'); g.querySelector('.ib')?.animate([{ opacity: 1, strokeWidth: C * 0.66 }, { opacity: 0, strokeWidth: C * 0.9 }], { duration: 300 }).finished.then(() => g.querySelector('.ib')?.remove());
  navigator.vibrate?.(15);
}
function nope(g) { g?.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${C * 0.12}px)` }, { transform: `translateX(-${C * 0.12}px)` }, { transform: 'translateX(0)' }], { duration: 260 }); }
function bump(a, g, tr) {
  const dist = tr.straight === false ? tr.steps * C + C * 0.5 : tr.steps * C + C * 0.3;
  slither(a, g, dist, true);
  if (tr.blocker != null) setTimeout(() => { const b = pieces(tr.blocker); b.forEach(e => e.classList.add('hit')); setTimeout(() => b.forEach(e => e.classList.remove('hit')), 450); }, 120 + tr.steps * 20);
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
  G.gone.add(a.id); for (const c of a.cells) G.occ[ix(c)] = -1;
  if (a.num) G.next++;
  $('ch' + Math.min(a.id, a.chain ?? a.id))?.remove();
  slither(a, g, (tr.steps + a.cells.length + (tr.portal ? 1 : 2)) * C, false, tr.portal);
}
function afterRemoval(removed) {
  const N = G.N;
  // 🔄 Giratorias: giran las que estaban pegadas a lo que salió
  const near = new Set();
  if (!G.board.cube) for (const a of removed) for (const [x, y] of a.cells) for (const [dx, dy] of DIRS) {
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
const pieces = id => view ? [...view.querySelectorAll(`[data-a="${id}"]`)] : [];
// Avanza la flecha por su propio trazo (como serpiente) y luego derecho; si choca, regresa
function slither(a, g, dist, back, portal) {
  if (!g) return;
  if (G.board.cube) return cubeMove(a, g, dist, back);
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
  view.querySelectorAll('.hint').forEach(e => e.classList.remove('hint'));
  pieces(a.id).forEach(e => e.classList.add('hint')); G.hints++; save(); if (msg) toast(msg);
  if (G.board.cube) G.focusFace(headCell(a)[2], a.id);
  else { const [hx, hy] = ctr(headCell(a)); if (G.N > 10) G.focus(hx, hy); }
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
      <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn" onclick="playArrows('t:${sp.test}')">${/^(lv|cv)/.test(sp.test) ? 'Otra vez' : 'Otro tablero'}</button></div>`);
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
    const pr = progress(), num = sp.num;
    if (sp.mixL) {
      const had = pr.ms?.[num] || 0, coinsWon = sp.boss ? 20 : 10;
      b.set(ref('arrows', 'p-' + uid()), { mv: Math.max(pr.mv || 1, num + 1), ms: { [num]: Math.max(had, s) } }, { merge: true });
      if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
      msg = `<span class="ar-stars">${stars(s)}</span><br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}${num === MIX_LEVELS ? `<br><b>🏆 ¡Completaste el modo mixto!</b>` : ''}`;
      next = num < MIX_LEVELS ? `<button class="btn" onclick="playArrows('m${num + 1}')">🔀 Mixto ${num + 1} →</button>` : '';
    } else if (sp.cubeL) {
      const had = pr.cs?.[num] || 0, coinsWon = num <= 5 ? 5 : sp.boss ? 20 : 10;
      b.set(ref('arrows', 'p-' + uid()), { cv: Math.max(pr.cv || 1, num + 1), cs: { [num]: Math.max(had, s) } }, { merge: true });
      if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
      msg = `<span class="ar-stars">${stars(s)}</span><br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}${num === CUBE_LEVELS ? `<br><b>🏆 ¡Completaste las ${CUBE_LEVELS} figuras!</b>` : ''}`;
      next = num < CUBE_LEVELS ? `<button class="btn" onclick="playArrows('c${num + 1}')">${SHAPES[FIG_PLAN[num]].e} Figura ${num + 1} →</button>` : '';
      if (!had && (sp.boss || num === CUBE_LEVELS)) notify('arrows', { title: `🧊 ${meForPartner()} ${num === CUBE_LEVELS ? `completó las ${CUBE_LEVELS} figuras de Flechas 🏆` : `venció a la figura jefe ${num} 👑`}`, body: `${n} flechas en ${fmtMs(ms)} · ${errTxt}`, url: './?open=arrows', tag: 'arrows-c' + num });
    } else if (sp.inf) {
      b.set(ref('arrows', 'p-' + uid()), { inf: Math.max(pr.inf || 1, num + 1) }, { merge: true });
      if (pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
      msg = `<span class="ar-stars">${stars(s)}</span><br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${pt?.hatchedAt ? ' · +10 🪙' : ''}`;
      next = `<button class="btn" onclick="playArrows('i${num + 1}')">Infinito ${num + 1} →</button>`;
    } else {
      const had = pr.ls?.[num] || 0, coinsWon = num <= 5 ? 3 : sp.boss ? 20 : 10;
      b.set(ref('arrows', 'p-' + uid()), { lv: Math.max(pr.lv || 1, num + 1), ls: { [num]: Math.max(had, s) }, ...(G.expert && sp.hard ? { lx: { [num]: true } } : {}) }, { merge: true });
      if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
      msg = `<span class="ar-stars">${stars(s)}</span>${G.expert && sp.hard ? '<br>💀 ¡En modo experto!' : ''}<br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}`;
      if (num === LEVELS) msg += `<br><b>🏆 ¡Completaste los ${LEVELS} niveles!</b><br><span class="small">Se abrió el modo infinito ♾️</span>`;
      next = num < LEVELS ? `<button class="btn" onclick="playArrows('l${num + 1}')">${isBoss(num + 1) ? '👑 ' : ''}Nivel ${num + 1} →</button>` : `<button class="btn" onclick="playArrows('i1')">♾️ Infinito</button>`;
      // Avisos solo en los momentos grandes (jefes y el final), para no llenar de notificaciones
      if (!had && (sp.boss || num === LEVELS)) notify('arrows', { title: num === LEVELS ? `🏆 ${meForPartner()} completó los ${LEVELS} niveles de Flechas` : `👑 ${meForPartner()} venció al jefe del nivel ${num}${G.expert ? ' en modo experto 💀' : ''}`, body: `${n} flechas en ${fmtMs(ms)} · ${errTxt}`, url: './?open=arrows', tag: 'arrows-l' + num });
      if (num === LEVELS) setTimeout(() => celebrate('hearts'), 600);
    }
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
  // Ya regalado: solo queda el registro (el dueño pidió quitar esconder / volver a envolver)
  if (g.on) return `<div class="glass stack"><span class="label">🎁 Flechas</span>
    <p class="small" style="margin:0">Regalado el ${when(g.at)}. ${opened ? `${esc(nameOf(p))} lo abrió el ${when(opened)} 💝` : `${esc(nameOf(p) || 'Tu pareja')} todavía no lo abre.`}</p></div>`;
  return `<div class="glass stack" style="border-color:rgba(255,181,71,.5)"><span class="label">🎁 Sorpresa: Flechas</span>
    <p class="small" style="margin:0">${g.on ? `🎁 Regalado el ${when(g.at)}. ${opened ? `${esc(nameOf(p))} lo abrió el ${when(opened)} 💝` : `${esc(nameOf(p) || 'Tu pareja')} todavía no lo abre.`}`
      : '🔒 Escondido: solo tú lo ves (Más → Flechas). Tu pareja no ve nada: ni la sección, ni en el buscador, ni el aviso en Ajustes.'}</p>
    <div><label class="f" for="giftMsg">Mensaje al abrirlo (opcional)</label><textarea id="giftMsg" maxlength="200" placeholder="Ej: Para que juegues a lo que te gusta, pero aquí 💕">${esc(g.msg || '')}</textarea></div>
    ${`<label class="check"><input type="checkbox" id="giftNotify" checked> Avisarle con una notificación («🎁 Tienes un regalo en Futari»)</label>
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

on('arrows profiles', () => { if ($('s-arrows').classList.contains('active') && !view) render(); });
on('arrows', duelWatch);
onShow('s-arrows', render);
if (EMU) window.__arrowsG = () => G; // solo emulador: para las pruebas automáticas
expose({ playArrows, arrowHint, arrowFit, arrowsContinue, restartArrows, closeArrows, arrowsExpert, arrowsTestLevel, arrowsTestCube, arrowsXray, arrowsLegend, duelInvite, duelAccept, duelDecline, duelCancel, duelEnter, duelGiveUp, unwrapGift, giftGive });
