// Flechas: rompecabezas de sacar flechas del tablero. Cada flecha es una línea (a veces con curvas) con punta; al tocarla
// avanza hacia donde apunta y sale si nada la bloquea; si choca, regresa y se pierde una vida (3, y cada 50 flechas sacadas
// se recupera una; sin vidas se puede seguir pagando monedas de la mascota). Tableros de 16 a 700 flechas con zoom.
// - Calentamiento (4×4 a 9×9), Difícil (de ~150 a ~700 flechas) y Reto del día (el mismo para los dos; crece en la semana).
//   Todo sale de una semilla: el mismo nivel es igual en los dos teléfonos. La partida a medias se guarda en el teléfono.
// - Sorpresa: hasta que el dueño lo «regala» desde Administración (couples/nosotros.features.arrows.on), solo lo ve él.
//   Al regalarlo, a la pareja le aparece envuelto en papel de regalo (Más, Inicio y juegos de la mascota) hasta que lo abre
//   (profiles/<uid>.prefs.unwrapped.arrows).
// Datos: arrows/p-<uid> { level, stars{n}, hard, hstars{n} } · arrows/d-<día> { <uid>: { ms, errors, hints, arrows, at } }.
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
   Así se llena más del 90 % del tablero, al principio hay pocas libres y hay cadenas largas de dependencias. */
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // arriba, derecha, abajo, izquierda
const COLORS = ['#FF6B8B', '#FFB547', '#5BD1A0', '#6AA8FF', '#B78BFF', '#FF8A5C', '#4FD6E0', '#F7E05A'];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function generate(seed, N, { minLen = 1, maxLen = 1, passes = 6 } = {}) {
  const R = rng(seed), occ = new Int32Array(N * N).fill(-1), cover = new Float64Array(N * N).fill(-Infinity), list = [];
  const inB = (x, y) => x >= 0 && y >= 0 && x < N && y < N, idx = [...Array(N * N).keys()];
  for (let pass = 0; pass < passes; pass++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const k of idx) {
      if (occ[k] >= 0) continue;
      const x = k % N, y = Math.floor(k / N);
      for (const d of [0, 1, 2, 3].sort(() => R() - 0.5)) {
        const [dx, dy] = DIRS[d], ray = new Set(); let hi = Infinity;
        for (let rx = x + dx, ry = y + dy; inB(rx, ry); rx += dx, ry += dy) { const rk = ry * N + rx; ray.add(rk); if (occ[rk] >= 0) hi = Math.min(hi, list[occ[rk]].o); }
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
            if (!inB(nx, ny) || occ[nk] >= 0 || used.has(nk) || ray.has(nk) || !(Math.max(lo, cover[nk]) < hi)) continue;
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
  return list;
}
// Tamaño según cuántas flechas se quieren (unas 0,3 × N² con líneas de 2 a 5)
const sizeFor = arrows => Math.max(8, Math.min(48, Math.round(Math.sqrt(arrows / 0.3))));
// Normal: tableros chicos (4×4 a 9×9) para calentar
export const levelSpec = L => ({ key: 'n' + L, title: 'Nivel ' + L, n: Math.min(9, 4 + Math.floor((L - 1) / 3)), minLen: 1, maxLen: L <= 3 ? 1 : Math.min(3, 1 + Math.floor((L - 1) / 4)), seed: hash('nivel-' + L) });
// Difícil: de ~150 flechas hasta ~700
export const hardTarget = H => Math.min(700, 150 + (H - 1) * 40);
export const hardSpec = H => ({ key: 'h' + H, title: 'Difícil ' + H, n: sizeFor(hardTarget(H)), minLen: 2, maxLen: 5, seed: hash('dificil-' + H), hard: true });
// Reto del día: crece durante la semana (lunes ~250, domingo ~650)
const DAY_TARGET = [650, 250, 300, 350, 420, 500, 580]; // domingo..sábado
export const dailySpec = (day = todayKey()) => { const w = new Date(day + 'T12:00').getDay(); return { key: 'd' + day, title: 'Reto del día', n: sizeFor(DAY_TARGET[w]), minLen: 2, maxLen: 5, seed: hash('dia-' + day), day: true, hard: true }; };
const boardOf = spec => (spec.list ??= generate(spec.seed, spec.n, spec));

/* ---------- Datos ---------- */
const progress = (id = uid()) => S.data.arrows.find(d => d.id === 'p-' + id) || {};
const myLevel = () => progress().level || 1;
const myHard = () => progress().hard || 1;
const daily = (day = todayKey()) => S.data.arrows.find(d => d.id === 'd-' + day) || {};
const fmtMs = ms => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
// Puntaje del reto: tiempo + 5 s por error + 10 s por pista (menos es mejor)
const score = r => r.ms + r.errors * 5000 + (r.hints || 0) * 10000;
// Partida a medias: se guarda en el teléfono (localStorage) para seguir después
const SAVE = 'futari-arrows-';
const loadSave = key => { try { return JSON.parse(localStorage.getItem(SAVE + key) || 'null'); } catch { return null; } };
const dropSave = key => { try { localStorage.removeItem(SAVE + key); } catch {} };
const LIFE_EVERY = 50, CONTINUE_COST = 15; // cada 50 flechas sacadas se recupera una vida; seguir sin vidas cuesta 15 🪙

/* ---------- Pantalla ---------- */
function render() {
  if (!arrowsVisible()) { $('s-arrows').innerHTML = `${backBar('Flechas')}<p class="empty">Todavía no 😉</p>`; return; }
  const L = myLevel(), H = myHard(), pr = progress(), st = pr.stars || {}, hs = pr.hstars || {};
  const total = [...Object.values(st), ...Object.values(hs)].reduce((a, b) => a + b, 0);
  const d = daily(), me = d[uid()], p = partnerUid(), them = p && d[p], ds = dailySpec();
  const surprise = isOwner() && !giftInfo().on;
  const cont = spec => { const s = loadSave(spec.key); return s ? ` · sigues en ${s.removed.length} de ${s.total}` : ''; };
  const dayRow = (who, r) => `<div class="row"><span>${who}</span><span class="small">${r ? `<b>${fmtMs(r.ms)}</b> · ${r.errors} ${r.errors === 1 ? 'error' : 'errores'}${r.hints ? ` · ${r.hints} 💡` : ''}` : '<span class="muted">sin terminar</span>'}</span></div>`;
  const winner = me && them ? (score(me) === score(them) ? '¡Empate! 🤝' : score(me) < score(them) ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`) : '';
  const lv = (n, cur, sv, pre) => `<button class="${n === cur ? 'cur' : ''}" onclick="playArrows('${pre}${n}')" aria-label="Nivel ${n}"><b>${n}</b><small>${sv[n] ? stars(sv[n]) : n === cur ? 'nuevo' : ''}</small></button>`;
  $('s-arrows').innerHTML = `${backBar('Flechas', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${surprise ? `<div class="glass small" style="border-color:rgba(255,181,71,.5)">🔒 <b>Sorpresa:</b> solo tú lo ves. Cuando quieras regalarlo: Administración → Pruebas → 🎁 Sorpresa.</div>` : ''}
    <div class="glass stack ar-hero hard"><div class="ar-hero-ic">🔥</div><div class="stack" style="gap:2px;align-items:center"><span class="label">Difícil · nivel ${H}</span>
      <span class="tiny muted">Unas ${hardTarget(H)} flechas${cont(hardSpec(H))}</span></div>
      <button class="btn" onclick="playArrows('h${H}')">${loadSave(hardSpec(H).key) ? 'Continuar' : `Jugar difícil ${H}`}</button></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo para los dos</span></div>
      <p class="tiny muted" style="margin:0">Hoy: tablero de ${ds.n}×${ds.n}${cont(ds)}. Crece durante la semana: el domingo es el más grande.</p>
      ${dayRow('Tú', me)}${p ? dayRow(esc(nameOf(p)), them) : ''}
      ${winner ? `<p class="small center" style="margin:0"><b>${winner}</b></p>` : ''}
      ${me ? '<p class="tiny muted center" style="margin:0">Mañana hay otro 😉</p>' : `<button class="btn ghost" onclick="playArrows('day')">${loadSave(ds.key) ? 'Continuar el reto' : 'Jugar el reto de hoy'}</button>`}</div>
    <div class="glass stack"><div class="row"><span class="label">🌱 Calentamiento · nivel ${L}</span><button class="btn small" onclick="playArrows('n${L}')">Jugar</button></div>
      ${L > 1 ? `<div class="ar-levels">${Array.from({ length: L }, (_, i) => i + 1).reverse().slice(0, 30).map(n => lv(n, L, st, 'n')).join('')}</div>` : ''}</div>
    ${H > 1 ? `<div class="glass stack"><span class="label">🔥 Difíciles</span><div class="ar-levels">${Array.from({ length: H }, (_, i) => i + 1).reverse().map(n => lv(n, H, hs, 'h')).join('')}</div></div>` : ''}
    <p class="tiny muted center" style="margin:0 8px">Toca una flecha: avanza hacia donde apunta y sale si nada la bloquea. Si choca pierdes una vida ❤️; cada ${LIFE_EVERY} flechas recuperas una. Con dos dedos acercas o alejas el tablero. Si sales, la partida queda guardada.</p>`;
}

/* ---------- Jugar ---------- */
let G = null, view = null, timer = null;
function specOf(what) {
  if (what === 'day') return dailySpec();
  const m = /^([nh])(\d+)$/.exec(String(what)); if (!m) return levelSpec(myLevel());
  return m[1] === 'h' ? hardSpec(Number(m[2])) : levelSpec(Number(m[2]));
}
function playArrows(what) {
  if (!arrowsVisible() || arrowsWrapped()) return;
  const spec = specOf(what);
  if (spec.day && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  const list = boardOf(spec), N = spec.n, occ = new Int32Array(N * N).fill(-1);
  for (const a of list) for (const [x, y] of a.cells) occ[y * N + x] = a.id;
  G = { spec, what, N, list, occ, gone: new Set(), lives: 3, errors: 0, hints: 0, paid: 0, elapsed: 0, t0: Date.now(), over: false, cam: null };
  const sv = loadSave(spec.key);
  if (sv && sv.total === list.length) {
    for (const id of sv.removed) { const a = list[id]; if (!a) continue; G.gone.add(id); for (const [x, y] of a.cells) occ[y * N + x] = -1; }
    Object.assign(G, { lives: sv.lives, errors: sv.errors, hints: sv.hints || 0, paid: sv.paid || 0, elapsed: sv.elapsed || 0 });
  }
  view?.remove();
  view = document.createElement('div');
  view.className = 'dialog ar-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Flechas');
  view.addEventListener('gesturestart', e => e.preventDefault()); // iPhone: que el pellizco no haga zoom a la página
  document.body.appendChild(view); syncBack();
  paintGame();
  if (G.lives <= 0) outOfLives();
  clearInterval(timer); timer = setInterval(() => { const t = $('arTime'); if (t && G && !G.over && !document.hidden) t.textContent = fmtMs(elapsed()); }, 500);
}
const elapsed = () => G.elapsed + (Date.now() - G.t0);
function save() {
  if (!G || G.over) return;
  try { localStorage.setItem(SAVE + G.spec.key, JSON.stringify({ total: G.list.length, removed: [...G.gone], lives: G.lives, errors: G.errors, hints: G.hints, paid: G.paid, elapsed: elapsed(), at: Date.now() })); } catch {}
}
// Pausa el reloj si la app pasa a segundo plano
document.addEventListener('visibilitychange', () => {
  if (!G || G.over) return;
  if (document.hidden) { G.elapsed = elapsed(); G.t0 = Infinity; save(); } else G.t0 = Date.now();
});
const C = 40; // tamaño de una casilla en el "mundo" (luego se escala con el zoom)
const ctr = ([x, y]) => [x * C + C / 2, y * C + C / 2];
// Trazo de una flecha: de la cola a la punta (si es de una casilla, una rayita detrás de la punta)
function bodyPts(a) {
  const pts = a.cells.map(ctr), [dx, dy] = DIRS[a.d];
  if (pts.length === 1) pts.unshift([pts[0][0] - dx * C * 0.34, pts[0][1] - dy * C * 0.34]);
  const h = pts[pts.length - 1]; pts[pts.length - 1] = [h[0] + dx * C * 0.08, h[1] + dy * C * 0.08];
  return pts;
}
const ptsD = pts => 'M' + pts.map(p => p.map(v => Math.round(v * 10) / 10).join(' ')).join('L');
const headD = a => { const [hx, hy] = ctr(a.cells[a.cells.length - 1]), [dx, dy] = DIRS[a.d], px = -dy, py = dx, t = C * 0.42, b = C * 0.02, w = C * 0.27;
  return `M${hx + dx * t} ${hy + dy * t}L${hx + dx * b + px * w} ${hy + dy * b + py * w}L${hx + dx * b - px * w} ${hy + dy * b - py * w}Z`; };
function paintGame() {
  const N = G.N, W = N * C;
  view.innerHTML = `<div class="ar-top"><button class="icon-btn" data-v="0" aria-label="Salir (se guarda)" onclick="closeArrows()">${icon('x')}</button>
      <div class="ar-title"><b>${esc(G.spec.title)}</b><span class="tiny muted"><span id="arLeft"></span> · <span id="arTime">${fmtMs(elapsed())}</span></span></div>
      <div class="ar-lives" id="arLives" aria-label="Vidas"></div></div>
    <div class="ar-prog"><i id="arProg"></i></div>
    <div class="ar-vp" id="arVp"><div class="ar-world" id="arWorld" style="width:${W}px;height:${W}px;--c:${C}px">
      <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" id="arSvg">${G.list.map(a => G.gone.has(a.id) ? '' :
        `<g id="ag${a.id}" style="color:${a.c}"><path class="ab" d="${ptsD(bodyPts(a))}" stroke-width="${C * 0.3}"/><path class="ah" d="${headD(a)}"/></g>`).join('')}</svg></div></div>
    <div class="ar-bottom"><button class="btn ghost small" onclick="arrowHint()">💡 Pista${G.spec.day ? ' (+10 s)' : ''}</button><button class="btn ghost small" onclick="arrowFit()">⤢ Ver todo</button><button class="btn ghost small" onclick="restartArrows()">↺ Reiniciar</button></div>`;
  updateHud(); setupCamera();
}
function updateHud() {
  const left = G.list.length - G.gone.size;
  $('arLeft').textContent = `${left} de ${G.list.length} flechas`;
  $('arProg').style.width = (G.gone.size / G.list.length * 100) + '%';
  const next = LIFE_EVERY - (G.gone.size % LIFE_EVERY);
  $('arLives').innerHTML = '❤️'.repeat(Math.max(0, G.lives)) + '🤍'.repeat(3 - Math.max(0, G.lives)) + (G.lives < 3 && G.list.length > LIFE_EVERY ? `<small>+1 en ${next}</small>` : '');
}

/* ---------- Cámara: arrastrar, pellizcar y tocar ---------- */
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
  const pts = new Map(); let start = null, pinch = null, moved = false;
  vp.onpointerdown = e => {
    vp.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, t: Date.now() }; moved = false; }
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
      if (!moved && Math.hypot(dx, dy) > 8) moved = true;
      if (moved) { cam.x = start.cx + dx; cam.y = start.cy + dy; apply(); }
    }
  };
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, t: Date.now() }; return; }
    if (!pts.size && start && !moved && Date.now() - start.t < 500) { const r = rect(); tapAt((e.clientX - r.left - cam.x) / cam.k, (e.clientY - r.top - cam.y) / cam.k); }
    start = null;
  };
  vp.onpointerup = up; vp.onpointercancel = e => { moved = true; up(e); };
  vp.onwheel = e => { e.preventDefault(); const r = rect(); zoomAt(cam.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); };
}
function arrowFit() { G?.fit?.(); }
// Toque en coordenadas del mundo: la flecha de esa casilla, o la más cercana alrededor (para dedos gordos con zoom lejos)
function tapAt(wx, wy) {
  if (!G || G.over) return;
  const N = G.N, cx = Math.floor(wx / C), cy = Math.floor(wy / C);
  let best = -1, bd = Infinity;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const id = G.occ[y * N + x]; if (id < 0) continue;
    const d = Math.hypot(x * C + C / 2 - wx, y * C + C / 2 - wy) + (x === cx && y === cy ? 0 : C * 0.25);
    if (d < bd) { bd = d; best = id; }
  }
  if (best >= 0 && bd < C * 1.1) tapArrow(best);
}
function tapArrow(id) {
  const a = G.list[id]; if (!a || G.gone.has(id)) return;
  const N = G.N, [dx, dy] = DIRS[a.d], [hx, hy] = a.cells[a.cells.length - 1];
  let x = hx + dx, y = hy + dy, steps = 0, blocker = -1;
  while (x >= 0 && y >= 0 && x < N && y < N) { const o = G.occ[y * N + x]; if (o >= 0) { blocker = o; break; } steps++; x += dx; y += dy; }
  const g = $('ag' + id); g?.classList.remove('hint'); navigator.vibrate?.(8);
  if (blocker < 0) {
    G.gone.add(id); for (const [cx, cy] of a.cells) G.occ[cy * N + cx] = -1;
    slither(a, g, (steps + a.cells.length + 2) * C, false);
    if (G.gone.size % LIFE_EVERY === 0 && G.lives < 3 && G.lives > 0) { G.lives++; toast('❤️ ¡Recuperaste una vida!'); }
    updateHud(); save();
    if (G.gone.size === G.list.length) setTimeout(win, 450);
    return;
  }
  slither(a, g, steps * C + C * 0.3, true);
  setTimeout(() => { const b = $('ag' + blocker); b?.classList.add('hit'); setTimeout(() => b?.classList.remove('hit'), 450); }, 120 + steps * 20);
  G.errors++; G.lives--; navigator.vibrate?.([40, 30, 40]);
  updateHud(); save();
  if (G.lives <= 0) setTimeout(outOfLives, 450);
}
// Avanza la flecha por su propio trazo (como serpiente) y luego derecho; si choca, regresa
function slither(a, g, dist, back) {
  if (!g) return;
  const body = g.querySelector('.ab'), head = g.querySelector('.ah'), [dx, dy] = DIRS[a.d];
  const pts = bodyPts(a), last = pts[pts.length - 1], far = [last[0] + dx * (dist + C), last[1] + dy * (dist + C)];
  body.setAttribute('d', ptsD([...pts, far]));
  const len = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  body.style.strokeDasharray = `${len} 999999`;
  const dur = back ? 240 + dist / C * 40 : Math.min(900, 220 + dist / C * 22), t0 = performance.now();
  g.classList.add('moving');
  const step = now => {
    let p = Math.min(1, (now - t0) / dur);
    const s = back ? dist * Math.sin(p * Math.PI) : dist * (p * p * (3 - 2 * p) * 0.4 + p * 0.6);
    body.style.strokeDashoffset = -s; head.setAttribute('transform', `translate(${dx * s} ${dy * s})`);
    if (!back) g.style.opacity = p > 0.7 ? (1 - p) / 0.3 : 1;
    if (p < 1) return requestAnimationFrame(step);
    g.classList.remove('moving');
    if (back) { body.setAttribute('d', ptsD(pts)); body.style.strokeDasharray = body.style.strokeDashoffset = ''; head.removeAttribute('transform'); }
    else g.remove();
  };
  requestAnimationFrame(step);
}
const isFree = a => { const [dx, dy] = DIRS[a.d], [hx, hy] = a.cells[a.cells.length - 1]; for (let x = hx + dx, y = hy + dy; x >= 0 && y >= 0 && x < G.N && y < G.N; x += dx, y += dy) if (G.occ[y * G.N + x] >= 0) return false; return true; };
// Pista: una flecha que puede salir ya (y la cámara va hacia ella)
function arrowHint() {
  if (!G || G.over) return;
  const free = G.list.filter(a => !G.gone.has(a.id) && isFree(a)); if (!free.length) return;
  const a = free[Math.floor(Math.random() * free.length)];
  document.querySelectorAll('#arSvg .hint').forEach(e => e.classList.remove('hint'));
  $('ag' + a.id)?.classList.add('hint'); G.hints++; save();
  const [hx, hy] = ctr(a.cells[a.cells.length - 1]); if (G.N > 10) G.focus(hx, hy);
}
async function restartArrows() {
  if (!G) return;
  if (G.gone.size > 20 && !G.over && !(await ask(`¿Empezar este tablero desde cero? Llevas ${G.gone.size} flechas.`, { ok: 'Reiniciar', danger: true }))) return;
  dropSave(G.spec.key); playArrows(G.what);
}
function closeArrows() {
  clearInterval(timer); if (G && !G.over) { G.elapsed = elapsed(); G.t0 = Date.now(); save(); }
  const el = view; view = null; G = null; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); render(); }, 160);
}
function overlay(html) { view.querySelector('.ar-end')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box">${html}</div></div>`); }
function outOfLives() {
  if (!view || !G) return;
  const p = pet(), have = p?.hatchedAt ? coins(p) : 0, can = have >= CONTINUE_COST, left = G.list.length - G.gone.size;
  overlay(`<div style="font-size:46px">💔</div><h2>Sin vidas</h2><p class="muted" style="margin:0">Te faltan ${left} ${left === 1 ? 'flecha' : 'flechas'}.</p>
    ${can ? `<button class="btn" onclick="arrowsContinue()">Seguir con 3 vidas · ${CONTINUE_COST} 🪙</button><p class="tiny muted" style="margin:0">Las monedas son de su mascota (tienen ${have} 🪙)</p>`
      : `<p class="tiny muted" style="margin:0">${p?.hatchedAt ? `Para seguir donde ibas hacen falta ${CONTINUE_COST} 🪙 de la mascota (tienen ${have}).` : 'Cuando tengan mascota, podrán seguir donde iban con sus monedas.'}</p>`}
    <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn ghost" onclick="restartArrows()">Empezar de nuevo</button></div>`);
}
function arrowsContinue() {
  const p = pet(); if (!G || !p || coins(p) < CONTINUE_COST) return;
  write(updateDoc(ref('pet', 'main'), { spent: increment(CONTINUE_COST) }));
  G.lives = 3; G.paid++; updateHud(); save(); view.querySelector('.ar-end')?.remove(); toast('❤️❤️❤️ ¡A seguir!');
}
function win() {
  if (!G || G.over) return;
  G.over = true; clearInterval(timer); dropSave(G.spec.key);
  const ms = elapsed(), sp = G.spec, n = G.list.length, p = partnerUid(), pt = pet();
  // Estrellas: en los grandes se perdonan más errores
  const tol = sp.hard ? Math.max(2, Math.round(n / 120)) : 0, bad = G.errors + G.hints;
  const s = bad <= tol ? 3 : bad <= tol * 3 + 1 ? 2 : 1;
  let msg = '', next = '';
  const b = writeBatch(db), errTxt = `${G.errors} ${G.errors === 1 ? 'error' : 'errores'}${G.hints ? ` · ${G.hints} 💡` : ''}`;
  if (sp.day) {
    const day = todayKey(), d = daily(day), first = !Object.keys(d).some(k => k !== 'id' && d[k]?.ms);
    const r = { ms, errors: G.errors, hints: G.hints, arrows: n, at: Date.now() };
    b.set(ref('arrows', 'd-' + day), { [uid()]: r }, { merge: true });
    if (first && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
    const them = p && d[p];
    msg = `${n} flechas en ${fmtMs(ms)} · ${errTxt}${first && pt?.hatchedAt ? '<br>¡Fuiste primero! +10 🪙 para la mascota' : ''}`;
    if (them) msg += `<br>${score(r) < score(them) ? '🏆 ¡Le ganaste a ' : score(r) === score(them) ? '🤝 Empate con ' : '😅 Te ganó '}${esc(nameOf(p))} (${fmtMs(them.ms)})`;
    notify('arrows', { title: `🏹 ${meForPartner()} resolvió las Flechas del día en ${fmtMs(ms)}`,
      body: them ? (score(r) < score(them) ? 'Te ganó hoy 😏' : 'Le ganaste hoy 🏆') : `${n} flechas, ${errTxt}. ¿Le ganas? El tablero es el mismo para los dos`, url: './?open=arrows', tag: 'arrows-' + day });
  } else {
    const pr = progress(), hard = !!sp.hard, num = Number(sp.key.slice(1)), field = hard ? 'hstars' : 'stars', had = pr[field]?.[num] || 0;
    const coinsWon = hard ? 10 : 3;
    b.set(ref('arrows', 'p-' + uid()), { [hard ? 'hard' : 'level']: Math.max((hard ? pr.hard : pr.level) || 1, num + 1), [field]: { [num]: Math.max(had, s) } }, { merge: true });
    if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(coinsWon) });
    msg = `<span class="ar-stars">${stars(s)}</span><br>${n} flechas en ${fmtMs(ms)} · ${errTxt}${!had && pt?.hatchedAt ? ` · +${coinsWon} 🪙` : ''}`;
    next = `<button class="btn" onclick="playArrows('${hard ? 'h' : 'n'}${num + 1}')">${hard ? 'Difícil' : 'Nivel'} ${num + 1} →</button>`;
    if (hard) notify('arrows', { title: `🔥 ${meForPartner()} terminó Flechas difícil ${num}`, body: `${n} flechas en ${fmtMs(ms)} · ${errTxt}`, url: './?open=arrows', tag: 'arrows-h' + num });
  }
  write(b.commit()); markActive(); countStat('acts', sp.day ? 'arrows-day' : 'arrows');
  celebrate(); navigator.vibrate?.([20, 40, 60]);
  view.querySelector('.ar-bottom').innerHTML = '';
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
onShow('s-arrows', render);
expose({ playArrows, arrowHint, arrowFit, arrowsContinue, restartArrows, closeArrows, unwrapGift, giftGive, giftSave, giftHide, giftRewrap });
