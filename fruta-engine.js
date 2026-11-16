// Pura fruta: motor del juego de combinar 3 (sin pantalla). Lo usan fruta.js (para jugar), admin-juegos.js
// (editor de niveles y «probar 200 veces») y las pruebas en Node. Todo es determinista con una semilla.
//
// Tablero w×h (máx. 9×9). Cada casilla: mask (existe o es hueco), stone (piedra 0-2 golpes), leaf (hojas 0-2 capas),
// vine (bejuco: amarra la fruta) y piece { id, t, sp }: t = color 0..5 o 'P' (piña), sp = null | 'h' | 'v' (machete que
// corta fila / columna) | 'b' (coco explosivo, 3×3) | 'f' (flor tropical: un color entero) | 'l' (lapa: se lleva una casilla
// que ayude al objetivo).
// Nivel (JSON, lo mismo que guarda el editor): { w, h, colors, moves, mask?: '1101…', leaf?: '0120…', stone?: '…',
//   vine?: '…', pinas?: n, goals: { c0..c5?: n, leaf?: true, stone?: true, pinas?: true, score?: n } }

export const FRUITS = [['🍊', 'naranjas'], ['🍉', 'sandías'], ['🫐', 'arándanos'], ['🍇', 'uvas'], ['🍋', 'limones'], ['🥭', 'mangos']];
export const SPECIALS = { h: 'Machete', v: 'Machete', b: 'Coco explosivo', f: 'Flor tropical', l: 'Lapa' };

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const str = (s, n, d = 0) => Array.from({ length: n }, (_, i) => s ? Number(s[i]) || 0 : d);

/* ---------- Crear una partida ---------- */
// assist (0-3): ayuda disimulada cuando un nivel se pierde varias veces seguidas (fruta.js decide el nivel de ayuda).
// No cambia nada visible: el tablero inicial es el mejor de varios y algunas frutas nuevas caen «con suerte».
export function createGame(level, seed = 1, assist = 0) {
  const { w, h } = level, n = w * h, R = rng(seed);
  const st = {
    w, h, n, R, colors: level.colors || 5, movesMax: level.moves, moves: level.moves, score: 0, idc: 1, chain: 0,
    mask: level.mask ? str(level.mask, n) : Array(n).fill(1), stone: str(level.stone, n), leaf: str(level.leaf, n), vine: str(level.vine, n).map(Boolean),
    cells: Array(n).fill(null), goals: level.goals || {}, got: { c: [0, 0, 0, 0, 0, 0], leaf: 0, stone: 0, pinas: 0 },
    pinasTotal: level.goals?.pinas ? (level.pinas || 3) : 0, pinasSpawned: 0, events: [], assist: Math.max(0, Math.min(3, assist | 0)),
  };
  for (let i = 0; i < n; i++) if (!st.mask[i]) { st.stone[i] = 0; st.leaf[i] = 0; st.vine[i] = false; }
  st.leafTotal = st.leaf.filter(x => x > 0).length; st.stoneTotal = st.stone.filter(x => x > 0).length;
  // Fruta inicial sin combinaciones hechas; las piñas empiezan arriba
  let best = null, bestV = -1;
  for (let cand = 0; cand < 1 + st.assist * 3; cand++) { // con ayuda: el mejor de varios tableros
    for (let tries = 0; tries < 60; tries++) {
      for (let i = 0; i < n; i++) st.cells[i] = holds(st, i) ? newPiece(st, colorNoMatch(st, i)) : null;
      if (hasMove(st)) break;
    }
    if (!st.assist) { best = st.cells; break; }
    const v = boardValue(st);
    if (v > bestV) { bestV = v; best = st.cells.slice(); }
  }
  st.cells = best;
  const startP = Math.min(st.pinasTotal, level.pinasStart ?? Math.min(2, st.pinasTotal));
  for (let k = 0, x = 0; k < startP && x < w * 3; x++) {
    const c = (Math.floor(w / (startP + 1)) * (k + 1) + x) % w, i = firstRow(st, c);
    if (i >= 0 && !st.vine[i]) { st.cells[i] = { id: st.idc++, t: 'P', sp: null }; st.pinasSpawned++; k++; }
  }
  return st;
}
// Qué tan «buena» es una mano: jugadas posibles, frutas del objetivo y jugadas que ya arman especiales
function boardValue(st) {
  const moves = allMoves(st); let v = moves.length;
  for (const [a, b] of moves) { swapCells(st, a, b); for (const g of findGroups(st, [a, b])) { if (g.sp) v += 4; if (st.goals['c' + g.color]) v += 1; } swapCells(st, a, b); }
  for (const p of st.cells) if (p && st.goals['c' + p.t]) v += 0.5;
  return v;
}
export const holds = (st, i) => !!st.mask[i] && !st.stone[i];
const newPiece = (st, t, sp = null) => ({ id: st.idc++, t: t ?? Math.floor(st.R() * st.colors), sp });
function colorNoMatch(st, i) {
  const { w } = st, x = i % w;
  for (let k = 0; k < 20; k++) {
    const t = Math.floor(st.R() * st.colors), c = j => st.cells[j]?.t;
    if (x >= 2 && c(i - 1) === t && c(i - 2) === t) continue;
    if (i >= 2 * w && c(i - w) === t && c(i - 2 * w) === t) continue;
    return t;
  }
  return Math.floor(st.R() * st.colors);
}
function firstRow(st, x) { for (let y = 0; y < st.h; y++) { const i = y * st.w + x; if (holds(st, i)) return i; if (!st.mask[i] || st.stone[i]) return -1; } return -1; }
const movable = (st, i) => holds(st, i) && st.cells[i] && !st.vine[i];
const colorOf = p => p && typeof p.t === 'number' && p.sp !== 'f' ? p.t : -1;
export const adjacent = (st, a, b) => (Math.abs(a - b) === 1 && Math.floor(a / st.w) === Math.floor(b / st.w)) || Math.abs(a - b) === st.w;

/* ---------- Encontrar combinaciones ---------- */
// Grupos de frutas iguales: { cells, color, sp?: especial que se crea, at?: dónde }
export function findGroups(st, swapped = []) {
  const { w, h } = st, runs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    const i = y * w + x, c = colorOf(st.cells[i]); let k = x + 1;
    if (c >= 0) while (k < w && colorOf(st.cells[y * w + k]) === c && holds(st, y * w + k)) k++;
    if (c >= 0 && k - x >= 3) runs.push({ dir: 'h', cells: Array.from({ length: k - x }, (_, j) => y * w + x + j), color: c });
    x = c >= 0 ? k : x + 1;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    const i = y * w + x, c = colorOf(st.cells[i]); let k = y + 1;
    if (c >= 0) while (k < h && colorOf(st.cells[k * w + x]) === c && holds(st, k * w + x)) k++;
    if (c >= 0 && k - y >= 3) runs.push({ dir: 'v', cells: Array.from({ length: k - y }, (_, j) => (y + j) * w + x), color: c });
    y = c >= 0 ? k : y + 1;
  }
  // Cuadritos 2×2 (lapa), si no son parte de una línea de 4 o más
  const squares = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const q = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1], c = colorOf(st.cells[q[0]]);
    if (c >= 0 && q.every(j => colorOf(st.cells[j]) === c)) squares.push({ cells: q, color: c });
  }
  // Juntar líneas que se tocan (mismo color, comparten casilla) en un grupo
  const groups = [];
  for (const r of runs) {
    const g = groups.find(g => g.color === r.color && r.cells.some(c => g.set.has(c)));
    if (g) { r.cells.forEach(c => g.set.add(c)); g.runs.push(r); } else groups.push({ color: r.color, set: new Set(r.cells), runs: [r] });
  }
  for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
    const A = groups[a], B = groups[b];
    if (A.color === B.color && [...B.set].some(c => A.set.has(c))) { B.set.forEach(c => A.set.add(c)); A.runs.push(...B.runs); groups.splice(b, 1); b = a; }
  }
  for (const s of squares) {
    const g = groups.find(g => g.color === s.color && s.cells.some(c => g.set.has(c)));
    if (g) { if (!g.square && !g.runs.some(r => r.cells.length >= 4)) { g.square = true; s.cells.forEach(c => g.set.add(c)); } }
    else if (!groups.some(g => s.cells.every(c => g.set.has(c)))) groups.push({ color: s.color, set: new Set(s.cells), runs: [], square: true });
  }
  return groups.map(g => {
    const long = Math.max(0, ...g.runs.map(r => r.cells.length)), dirs = new Set(g.runs.map(r => r.dir));
    let sp = null;
    if (long >= 5) sp = 'f';
    else if (dirs.size === 2) sp = 'b';
    else if (long === 4) sp = g.runs.find(r => r.cells.length === 4).dir === 'h' ? 'v' : 'h';
    else if (g.square) sp = 'l';
    const cells = [...g.set];
    let at = swapped.find(c => g.set.has(c));
    if (at == null) { const r = g.runs.find(r => r.cells.length === long) || { cells }; at = r.cells[Math.floor(r.cells.length / 2)]; }
    return { cells, color: g.color, sp, at };
  });
}

/* ---------- Jugar ---------- */
// ¿Es válido cambiar a y b? (hace una combinación o junta especiales / una flor)
export function canSwap(st, a, b) {
  if (!adjacent(st, a, b) || !movable(st, a) || !movable(st, b)) return false;
  const A = st.cells[a], B = st.cells[b];
  if (A.t === 'P' && B.t === 'P') return false;
  if ((A.sp && B.sp) || A.sp === 'f' || B.sp === 'f') return !(A.t === 'P' || B.t === 'P');
  swapCells(st, a, b); const ok = findGroups(st).length > 0; swapCells(st, a, b);
  return ok;
}
const swapCells = (st, a, b) => { const t = st.cells[a]; st.cells[a] = st.cells[b]; st.cells[b] = t; };
export function hasMove(st) { return !!findMove(st); }
export function findMove(st) {
  for (let i = 0; i < st.n; i++) for (const j of [i + 1, i + st.w]) if (j < st.n && adjacent(st, i, j) && canSwap(st, i, j)) return [i, j];
  return null;
}
export function allMoves(st) {
  const out = [];
  for (let i = 0; i < st.n; i++) for (const j of [i + 1, i + st.w]) if (j < st.n && adjacent(st, i, j) && canSwap(st, i, j)) out.push([i, j]);
  return out;
}

// Hace la jugada y devuelve los pasos para animar: [{ kind:'swap'|'clear'|'fall'|'pinas'|'shuffle'|'bonus', … }]
export function play(st, a, b) {
  if (!canSwap(st, a, b)) return null;
  const steps = [];
  swapCells(st, a, b); st.moves--; st.chain = 0;
  steps.push({ kind: 'swap', a, b });
  const A = st.cells[b], B = st.cells[a]; // A es la que se movió a b
  let first = null;
  if ((A.sp && B.sp) || A.sp === 'f' || B.sp === 'f') first = combo(st, b, a);
  resolve(st, steps, first, [a, b]);
  return steps;
}
// Martillo (ayuda): rompe una casilla
export function hammer(st, i) {
  if (!st.mask[i]) return null;
  const steps = []; st.chain = 0;
  resolve(st, steps, { area: new Set([i]), from: [] }, []);
  return steps;
}
// Mezclar (ayuda o cuando no quedan jugadas)
export function shuffle(st) {
  const idx = []; for (let i = 0; i < st.n; i++) if (movable(st, i) && st.cells[i].t !== 'P') idx.push(i);
  const pcs = idx.map(i => st.cells[i]);
  for (let k = 0; k < 80; k++) {
    for (let m = pcs.length - 1; m > 0; m--) { const r = Math.floor(st.R() * (m + 1)); [pcs[m], pcs[r]] = [pcs[r], pcs[m]]; }
    idx.forEach((i, m) => { st.cells[i] = pcs[m]; });
    if (!findGroups(st).length && hasMove(st)) break;
  }
  if (!hasMove(st)) for (const i of idx) if (!st.cells[i].sp) st.cells[i] = newPiece(st); // último recurso: frutas nuevas
  return { kind: 'shuffle' };
}

// Efecto de juntar dos especiales (o una flor con cualquiera)
function combo(st, a, b) {
  const A = st.cells[a], B = st.cells[b], area = new Set([a, b]), { w, h } = st, x = b % w, y = Math.floor(b / w);
  const row = yy => { for (let k = 0; k < w; k++) if (yy >= 0 && yy < h) area.add(yy * w + k); };
  const col = xx => { for (let k = 0; k < h; k++) if (xx >= 0 && xx < w) area.add(k * w + xx); };
  const box = r => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) area.add(yy * w + xx); } };
  const sps = [A.sp, B.sp], has = s => sps.includes(s), other = A.sp === 'f' ? B : A;
  const mk = { area, from: [a, b], fx: [] };
  A.sp = B.sp = null; A.used = B.used = true; // no se vuelven a activar
  if (has('f') && sps.filter(s => s === 'f').length === 2) { for (let i = 0; i < st.n; i++) area.add(i); mk.fx.push({ fx: 'all' }); return mk; }
  if (has('f')) {
    const c = typeof other.t === 'number' ? other.t : mostColor(st), osp = sps.find(s => s !== 'f');
    for (let i = 0; i < st.n; i++) if (colorOf(st.cells[i]) === c || st.cells[i] === other) {
      if (osp && st.cells[i] !== other) st.cells[i].sp = osp === 'h' || osp === 'v' ? (st.R() < 0.5 ? 'h' : 'v') : osp; // todas se vuelven ese especial
      area.add(i);
    }
    mk.fx.push({ fx: 'flor', color: c, at: b }); return mk;
  }
  if (has('l')) { const t = sps.find(s => s !== 'l') || 'l'; const n = t === 'l' ? 3 : 1; for (let k = 0; k < n; k++) { const tg = lapaTarget(st, area); if (tg >= 0) { area.add(tg); mk.fx.push({ fx: 'lapa', from: b, to: tg }); if (t !== 'l' && st.cells[tg]) st.cells[tg].sp = t === 'h' || t === 'v' ? 'h' : t; } } return mk; }
  if ((has('h') || has('v')) && has('b')) { for (let d = -1; d <= 1; d++) { row(y + d); col(x + d); } mk.fx.push({ fx: 'cross3', at: b }); return mk; }
  if (has('b')) { box(2); mk.fx.push({ fx: 'boom2', at: b }); return mk; }
  row(y); col(x); mk.fx.push({ fx: 'cross', at: b }); return mk;
}
const mostColor = st => { const n = Array(6).fill(0); for (const p of st.cells) if (colorOf(p) >= 0) n[p.t]++; return n.indexOf(Math.max(...n)); };
// Lo que más ayuda al objetivo: hojas, piedras, bejucos, frutas del color pedido, o cualquier fruta
function lapaTarget(st, skip = new Set()) {
  const g = st.goals, pick = arr => arr.length ? arr[Math.floor(st.R() * arr.length)] : -1, all = [];
  for (let i = 0; i < st.n; i++) if (st.mask[i] && !skip.has(i)) all.push(i);
  const pref = [g.stone && all.filter(i => st.stone[i]), g.leaf && all.filter(i => st.leaf[i] && st.cells[i]), all.filter(i => st.vine[i]),
    all.filter(i => { const c = colorOf(st.cells[i]); return c >= 0 && g['c' + c] && st.got.c[c] < g['c' + c]; })].filter(x => x && x.length);
  return pick(pref[0] || all.filter(i => st.cells[i] && st.cells[i].t !== 'P'));
}

// Aplica combinaciones y caídas hasta que el tablero quede quieto
function resolve(st, steps, first, swapped) {
  let pending = first;
  for (let guard = 0; guard < 60; guard++) {
    const groups = pending ? [] : findGroups(st, swapped);
    if (!pending && !groups.length) break;
    st.chain++;
    const area = new Set(pending?.area || []), create = [], fx = [...(pending?.fx || [])], hitStones = new Set();
    for (const g of groups) {
      g.cells.forEach(c => area.add(c));
      if (g.sp) create.push({ at: g.at, t: g.color, sp: g.sp });
      for (const c of g.cells) for (const d of [-1, 1, -st.w, st.w]) { const j = c + d; if (j >= 0 && j < st.n && adjacent(st, c, j) && st.stone[j]) hitStones.add(j); }
    }
    pending = null; swapped = [];
    // Especiales que caen dentro del área se activan (en cadena)
    const queue = [...area], done = new Set();
    while (queue.length) {
      const i = queue.pop(); if (done.has(i)) continue; done.add(i);
      const p = st.cells[i]; if (!p || !p.sp || p.used) continue;
      p.used = true;
      const add = j => { if (j >= 0 && j < st.n && !area.has(j)) { area.add(j); queue.push(j); } }, x = i % st.w, y = Math.floor(i / st.w);
      if (p.sp === 'h') { for (let k = 0; k < st.w; k++) add(y * st.w + k); fx.push({ fx: 'row', at: i }); }
      if (p.sp === 'v') { for (let k = 0; k < st.h; k++) add(k * st.w + x); fx.push({ fx: 'col', at: i }); }
      if (p.sp === 'b') { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < st.w && yy < st.h) add(yy * st.w + xx); } fx.push({ fx: 'boom', at: i }); }
      if (p.sp === 'f') { const c = mostColor(st); for (let j = 0; j < st.n; j++) if (colorOf(st.cells[j]) === c) add(j); fx.push({ fx: 'flor', color: c, at: i }); }
      if (p.sp === 'l') { const tg = lapaTarget(st, area); if (tg >= 0) { add(tg); fx.push({ fx: 'lapa', from: i, to: tg }); } }
    }
    // Daño
    const cleared = [];
    for (const i of area) {
      if (!st.mask[i]) continue;
      if (st.stone[i]) { hitStones.add(i); continue; }
      const p = st.cells[i];
      if (st.vine[i]) { st.vine[i] = false; st.score += 40; cleared.push({ i, vine: true }); continue; }
      if (st.leaf[i] && (p || area.size)) { st.leaf[i]--; if (!st.leaf[i]) st.got.leaf++; st.score += 100; }
      if (!p || p.t === 'P') continue;
      if (typeof p.t === 'number') st.got.c[p.t]++;
      st.score += 60 * st.chain;
      cleared.push({ i, id: p.id, t: p.t, sp: p.sp });
      st.cells[i] = null;
    }
    for (const j of hitStones) if (st.stone[j]) { st.stone[j]--; st.score += 200; if (!st.stone[j]) st.got.stone++; cleared.push({ i: j, stone: st.stone[j] }); }
    const made = [];
    for (const c of create) { if (st.cells[c.at] || !holds(st, c.at)) continue; st.cells[c.at] = newPiece(st, c.t, c.sp); st.score += 200; made.push({ i: c.at, id: st.cells[c.at].id, t: c.t, sp: c.sp }); }
    steps.push({ kind: 'clear', cleared, made, fx, chain: st.chain, tiles: { leaf: st.leaf.slice(), stone: st.stone.slice(), vine: st.vine.slice() }, score: st.score });
    fall(st, steps);
  }
  if (!won(st) && st.moves > 0 && !hasMove(st)) { steps.push(shuffle(st)); }
  if (won(st) && st.moves > 0 && !st.bonusDone) bonus(st, steps);
}
// Gravedad: caen derecho; si algo bloquea (piedra, hueco, bejuco) caen en diagonal; arriba nacen frutas nuevas
function fall(st, steps) {
  const { w, h } = st, moves = [], born = [];
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!holds(st, i) || st.cells[i]) continue;
      const up = i - w;
      if (y > 0 && movable(st, up)) { st.cells[i] = st.cells[up]; st.cells[up] = null; moves.push({ id: st.cells[i].id, to: i }); changed = true; continue; }
      if (y === 0 || !st.mask[up] && isTopOpen(st, x, y)) { st.cells[i] = spawn(st, i); born.push({ id: st.cells[i].id, to: i, t: st.cells[i].t }); changed = true; continue; }
      if (y > 0 && !feedsFromAbove(st, x, y)) {
        for (const dx of [-1, 1]) { const j = up + dx; if (x + dx >= 0 && x + dx < w && movable(st, j) && !(holds(st, j + w) && !st.cells[j + w])) { st.cells[i] = st.cells[j]; st.cells[j] = null; moves.push({ id: st.cells[i].id, to: i }); changed = true; break; } }
      }
    }
    if (!changed) break;
  }
  if (moves.length || born.length) steps.push({ kind: 'fall', moves, born });
  // Piñas que llegaron abajo
  const got = [];
  for (let x = 0; x < w; x++) { for (let y = h - 1; y >= 0; y--) { const i = y * w + x; if (!holds(st, i)) continue; const p = st.cells[i]; if (p?.t === 'P') { st.cells[i] = null; st.got.pinas++; st.score += 1000; got.push({ i, id: p.id }); } break; } }
  if (got.length) { steps.push({ kind: 'pinas', got }); fall(st, steps); }
}
// ¿Esta casilla vacía puede recibir fruta desde arriba (aunque haya huecos de por medio que no estorban)?
function feedsFromAbove(st, x, y) {
  for (let yy = y - 1; yy >= 0; yy--) { const i = yy * st.w + x; if (!st.mask[i]) return isTopOpen(st, x, yy + 1); if (st.stone[i] || st.vine[i]) return false; }
  return true;
}
function isTopOpen(st, x, y) { for (let yy = y - 1; yy >= 0; yy--) if (st.mask[yy * st.w + x]) return false; return true; }
function spawn(st, i) {
  const onBoard = st.cells.filter(p => p?.t === 'P').length, a = st.assist;
  if (st.pinasSpawned < st.pinasTotal && onBoard < 2 && st.R() < 0.4 + a * 0.08) { st.pinasSpawned++; return { id: st.idc++, t: 'P', sp: null }; }
  // Con ayuda, algunas frutas caen «con suerte»: del color del objetivo que falta o igual a la de abajo/al lado (más cascadas)
  if (a && st.R() < [0, 0.1, 0.17, 0.25][a]) {
    const need = []; for (let c = 0; c < st.colors; c++) if (st.goals['c' + c] && st.got.c[c] < st.goals['c' + c]) need.push(c);
    const near = [i + st.w, i - 1, i + 1].filter(j => j >= 0 && j < st.n && adjacent(st, i, j)).map(j => colorOf(st.cells[j])).filter(c => c >= 0);
    const pool = need.length && st.R() < 0.5 ? need : near.length ? near : need;
    if (pool.length) return newPiece(st, pool[Math.floor(st.R() * pool.length)]);
  }
  return newPiece(st);
}

/* ---------- Objetivos y final ---------- */
export function goalList(st) {
  const g = st.goals, out = [];
  for (let c = 0; c < 6; c++) if (g['c' + c]) out.push({ k: 'c' + c, label: FRUITS[c][1], need: g['c' + c], have: Math.min(g['c' + c], st.got.c[c]), fruit: c });
  if (g.leaf) out.push({ k: 'leaf', label: 'hojas', need: st.leafTotal, have: st.got.leaf });
  if (g.stone) out.push({ k: 'stone', label: 'piedras', need: st.stoneTotal, have: st.got.stone });
  if (g.pinas) out.push({ k: 'pinas', label: 'piñas', need: st.pinasTotal, have: st.got.pinas });
  if (g.score) out.push({ k: 'score', label: 'puntos', need: g.score, have: Math.min(g.score, st.score) });
  return out;
}
export const won = st => goalList(st).every(g => g.have >= g.need);
export const lost = st => !won(st) && st.moves <= 0;
export const starsOf = st => !won(st) ? 0 : st.leftAtWin >= Math.ceil(st.movesMax * 0.3) ? 3 : st.leftAtWin >= Math.ceil(st.movesMax * 0.1) ? 2 : 1;
// Al ganar con movimientos de sobra: cada uno se vuelve un machete que explota (puntos extra)
function bonus(st, steps) {
  st.bonusDone = true; st.leftAtWin = st.moves;
  const n = Math.min(st.moves, 12);
  if (!n) return;
  const pool = []; for (let i = 0; i < st.n; i++) if (st.cells[i] && typeof st.cells[i].t === 'number' && !st.cells[i].sp && !st.vine[i]) pool.push(i);
  const area = new Set();
  for (let k = 0; k < n && pool.length; k++) { const i = pool.splice(Math.floor(st.R() * pool.length), 1)[0]; st.cells[i].sp = st.R() < 0.5 ? 'h' : 'v'; area.add(i); }
  st.score += st.moves * 300; st.moves = 0;
  steps.push({ kind: 'bonus', cells: [...area], ids: [...area].map(i => ({ id: st.cells[i].id, sp: st.cells[i].sp })) });
  const save = st.goals; st.goals = { ...save, score: 0 };
  resolve(st, steps, { area, from: [], fx: [] }, []);
  st.goals = save;
}

/* ---------- Jugador automático (pistas y «probar 200 veces») ---------- */
// Elige la jugada que más ayuda: frutas del objetivo, especiales creados, hojas/piedras; con algo de azar
export function botMove(st, noise = 0.35) {
  const moves = allMoves(st); if (!moves.length) return null;
  let best = null, bestV = -1;
  for (const [a, b] of moves) {
    const A = st.cells[a], B = st.cells[b];
    let v = (A.sp ? 6 : 0) + (B.sp ? 6 : 0) + (A.sp && B.sp ? 20 : 0) + (A.sp === 'f' || B.sp === 'f' ? 25 : 0);
    swapCells(st, a, b);
    for (const g of findGroups(st, [a, b])) {
      v += g.cells.length + (g.sp ? { f: 30, b: 14, h: 10, v: 10, l: 8 }[g.sp] : 0);
      if (st.goals['c' + g.color] && st.got.c[g.color] < st.goals['c' + g.color]) v += g.cells.length * 2;
      for (const c of g.cells) { if (st.leaf[c]) v += 3; if (st.vine[c]) v += 2; for (const d of [-1, 1, -st.w, st.w]) if (st.stone[c + d] && adjacent(st, c, c + d)) v += 2; }
      // bajar piñas: jugar debajo de ellas
      if (st.goals.pinas) for (const c of g.cells) for (let y = Math.floor(c / st.w) - 1; y >= 0; y--) if (st.cells[y * st.w + c % st.w]?.t === 'P') v += 2;
    }
    swapCells(st, a, b);
    v *= 1 + (st.R() - 0.5) * noise * 2;
    if (v > bestV) { bestV = v; best = [a, b]; }
  }
  return best;
}
export function simulate(level, runs = 200, seed0 = 1, assist = 0) {
  let wins = 0, stars = 0, leftSum = 0;
  for (let r = 0; r < runs; r++) {
    const st = createGame(level, seed0 + r * 7919, assist);
    while (!won(st) && st.moves > 0) { const m = botMove(st); if (!m) { shuffle(st); continue; } play(st, m[0], m[1]); }
    if (won(st)) { wins++; stars += starsOf(st); leftSum += st.leftAtWin || 0; }
  }
  return { runs, wins, rate: wins / runs, stars: wins ? stars / wins : 0, left: wins ? leftSum / wins : 0 };
}
export const difficultyLabel = rate => rate >= 0.85 ? 'Fácil' : rate >= 0.6 ? 'Normal' : rate >= 0.35 ? 'Difícil' : rate >= 0.12 ? 'Muy difícil' : 'Casi imposible';

/* ---------- Los 100 niveles (generados con semilla; el editor de Administración puede reemplazar cualquiera) ---------- */
export const LEVELS = 100;
// Movimientos de cada nivel: calibrados con simulate() para que la dificultad suba pareja, más un margen para personas
export const MOVES = [18,18,18,18,18,18,26,18,18,19,42,15,18,23,36,16,18,24,28,15,22,19,31,15,18,25,24,15,17,17,30,15,18,18,33,15,18,18,27,20,16,24,31,15,17,23,31,16,17,32,34,15,18,20,45,18,18,25,31,26,20,24,26,17,18,26,36,15,18,32,34,15,17,20,30,17,19,27,34,31,38,42,53,20,45,47,57,16,34,47,56,22,34,48,56,25,39,45,53,31];
export const isBoss = L => L % 10 === 0;
export const zoneOf = L => L <= 33 ? ['🏖️', 'La playa'] : L <= 66 ? ['🌴', 'La selva'] : ['🌋', 'El volcán'];
const SHAPES = {
  corners: (w, h) => (x, y) => !((x === 0 || x === w - 1) && (y === 0 || y === h - 1)),
  heart: (w, h) => (x, y) => { const cx = (w - 1) / 2; return !(y === 0 && (Math.abs(x - cx) < 1 || x === 0 || x === w - 1)) && !(y >= h - 2 && Math.abs(x - cx) > (h - 1 - y) * 1.6 + 0.6) && !(y === h - 3 && (x === 0 || x === w - 1)); },
  diamond: (w, h) => (x, y) => Math.abs(x - (w - 1) / 2) / (w / 2) + Math.abs(y - (h - 1) / 2) / (h / 2) <= 1.15,
  hole: (w, h) => (x, y) => !(Math.abs(x - (w - 1) / 2) < 1 && Math.abs(y - (h - 1) / 2) < 1),
  pillars: (w, h) => (x, y) => !((x === 2 || x === w - 3) && y >= 2 && y <= 3),
};
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
export function levelSpec(L) {
  const R = rng(hash('fruta-' + L)), t = (L - 1) / (LEVELS - 1), boss = isBoss(L);
  const w = L <= 12 ? 7 : 8, h = L <= 12 ? 7 : L <= 40 ? 8 : 9, n = w * h;
  const colors = L <= 8 ? 4 : L <= 45 ? 5 : boss || L > 80 ? 6 : 5;
  const kinds = ['c', 'leaf', 'pinas', 'stone'];
  const kind = L <= 3 ? 'c' : kinds[(L - 1) % kinds.length];
  const shapes = ['heart', 'diamond', 'corners', 'hole', 'pillars'];
  let shapeName = L < 7 || R() > (boss ? 0.8 : 0.45) ? null : shapes[Math.floor(R() * shapes.length)];
  if (kind === 'pinas' && ['heart', 'diamond'].includes(shapeName)) shapeName = 'corners'; // las piñas necesitan fondo ancho para bajar
  const shape = shapeName ? SHAPES[shapeName](w, h) : () => true;
  const mask = [], leaf = Array(n).fill(0), stone = Array(n).fill(0), vine = Array(n).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask.push(shape(x, y) ? 1 : 0);
  const cells = mask.map((m, i) => m ? i : -1).filter(i => i >= 0);
  const pickN = (k, filt = () => true) => { const pool = cells.filter(filt); const out = []; while (out.length < k && pool.length) out.push(pool.splice(Math.floor(R() * pool.length), 1)[0]); return out; };
  const goals = {};
  // Un objetivo principal; desde el 26, a veces un segundo de juntar fruta; los jefes siempre llevan dos
  const extraColor = boss || (L > 25 && kind !== 'c' && R() < 0.4);
  const want = Math.round((kind === 'c' ? lerp(20, 48, t) : lerp(12, 26, t)) * (boss ? 1.15 : 1));
  if (kind === 'c' || extraColor) { const c1 = Math.floor(R() * colors); goals['c' + c1] = want; if (kind === 'c' && L > 30 && R() < 0.4) { let c2; do { c2 = Math.floor(R() * colors); } while (c2 === c1); goals['c' + c2] = Math.round(want * 0.6); } }
  if (kind === 'leaf') {
    goals.leaf = true;
    const rows = Math.round(lerp(2, h - 2, t)), y0 = h - rows; // las hojas empiezan abajo (más difícil de alcanzar)
    for (const i of cells) { const y = Math.floor(i / w); if (y >= y0 && (L < 30 || R() < 0.85)) leaf[i] = L >= 35 && R() < lerp(0, 0.5, (L - 35) / 65) ? 2 : 1; }
  }
  if (kind === 'stone') { goals.stone = true; for (const i of pickN(Math.round(lerp(4, 10, t)), i => Math.floor(i / w) >= 2)) stone[i] = L >= 30 && R() < 0.4 ? 2 : 1; }
  let pinas = 0;
  if (kind === 'pinas') { goals.pinas = true; pinas = Math.round(lerp(2, 3, t)); }
  if (L >= 15) for (const i of pickN(Math.round(lerp(3, 10, (L - 15) / 85)), i => !stone[i] && Math.floor(i / w) >= 1 && !(kind === 'pinas' && Math.floor(i / w) >= h - 2))) vine[i] = 1;
  // Movimientos calibrados con el jugador automático (MOVES, ver tools en docs/FRUTA.md); si falta, una fórmula
  const work = (goals.leaf ? 1.2 : 0) + (goals.stone ? 1 : 0) + (goals.pinas ? 1.1 : 0) + Object.keys(goals).filter(k => k[0] === 'c').length * 0.8;
  const moves = MOVES[L - 1] || Math.round(lerp(26, 20, t) + work * lerp(5, 3, t) + (colors === 6 ? 4 : 0) + (boss ? 4 : 0));
  return { num: L, title: `${boss ? '👑 ' : ''}Nivel ${L}`, boss, w, h, colors, moves, goals, pinas,
    mask: mask.join(''), leaf: leaf.join(''), stone: stone.join(''), vine: vine.join(''), seed: hash('fruta-seed-' + L), shape: shapeName };
}
// Reto del día: el mismo tablero y las mismas frutas para los dos; gana más puntos
export function dailySpec(day) {
  const d = new Date(day + 'T12:00').getDay(), base = levelSpec([45, 15, 22, 28, 34, 38, 55][d]);
  return { ...base, title: 'Reto del día', day: true, boss: false, seed: hash('fruta-dia-' + day), goals: { score: 999999999 }, moves: 25, scoreMode: true };
}
