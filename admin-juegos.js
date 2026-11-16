// Administración → 🎮 Juegos (solo el dueño la ve): Pura fruta, Flechas y La parada.
// - Panel: en qué nivel va cada uno, mostrar/ocultar el juego, BETA de Flechas, regalos sorpresa, saltar/reiniciar mi progreso.
// - Editor de niveles: Pura fruta con tablero dibujado (huecos, hojas, piedras, bejucos, objetivos); Flechas y La parada
//   con sus parámetros (tamaño, obstáculos, colores, semilla). Probar sin guardar, «probar 200 veces» (Pura fruta),
//   publicar (le aparece al instante a los dos), despublicar, volver al generado, copiar e intercambiar niveles.
// - Estadísticas por nivel (<juego>/stats: intentos y ganados) y «niveles pared».
// - Reto del día programado (<juego>/day-<día> { num }), mensajes sorpresa (<juego>/msg-<n>) y economía (<juego>/cfg).
// También aplica «ocultar juego» para todos (gates): por eso app.js lo importa aunque la pantalla sea solo del dueño.
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, expose, toast, write, ref, uid, partnerUid, nameOf, todayKey, gates, ask, softDelete } from './core.js';
import { isOwner, giftAdminCards, giftInfo } from './gifts.js';
import { notify, meForPartner } from './push.js';
import * as FE from './fruta-engine.js';
import { levelOf as frutaLevelOf, playFruta, totalLevels as frutaTotal } from './fruta.js';
import { LEVELS as AR_LEVELS, MODS_INFO, arrowsLevelInfo, playArrowsDraft, arrowsTotal } from './arrows.js';
import { LEVELS as BUS_LEVELS, levelSpec as busLevelSpec, playBusDraft, busTotal } from './bus.js';

export const GAMES = {
  fruta: { name: 'Pura fruta', e: '🍍', screen: 's-fruta', levels: FE.LEVELS },
  arrows: { name: 'Flechas', e: '🏹', screen: 's-arrows', levels: AR_LEVELS },
  bus: { name: 'La parada', e: '🚏', screen: 's-bus', levels: BUS_LEVELS },
};
// Total con los niveles extra publicados (101, 102… o 91, 92… en Flechas)
const totalOf = g => g === 'fruta' ? frutaTotal() : g === 'arrows' ? arrowsTotal() : busTotal();
const docOf = (g, id) => (S.data[g] || []).find(d => d.id === id) || null;
const cfgOf = g => docOf(g, 'cfg') || {};
const prog = (g, who) => docOf(g, 'p-' + who) || {};

// Ocultar un juego para los dos (además de lo que ya decida gifts.js para los juegos sorpresa)
for (const [g, info] of Object.entries(GAMES)) { const prev = gates[info.screen]; gates[info.screen] = () => (prev ? prev() : true) && !cfgOf(g).off; }
export const gameOn = g => !cfgOf(g).off;

/* ---------- Estado de la pantalla ---------- */
let game = 'fruta', part = 'panel', edL = 1, draft = null, tool = 'cell', sim = null;

export function juegosHTML() {
  if (!isOwner()) return '<p class="empty">Solo para el dueño</p>';
  const G = GAMES[game];
  const parts = [['panel', '📊 Panel'], ['edit', '✏️ Niveles'], ['stats', '📈 Estadísticas'], ['day', '🗓️ Reto'], ['msg', '💌 Sorpresas'], ['eco', '🪙 Economía']];
  return `<div class="seg">${Object.entries(GAMES).map(([k, x]) => `<button class="${game === k ? 'on' : ''}" onclick="ajGame('${k}')">${x.e} ${x.name}</button>`).join('')}</div>
    <div class="chips scroll">${parts.map(([k, l]) => `<button class="chip ${part === k ? 'on' : ''}" onclick="ajPart('${k}')">${l}</button>`).join('')}</div>
    <div id="ajBody" class="stack" style="gap:14px">${({ panel, edit, stats, day, msg, eco }[part])(G)}</div>`;
}
const rerender = () => window.admRender?.();
function ajGame(g) { game = g; draft = null; sim = null; rerender(); }
function ajPart(p) { part = p; rerender(); }

/* ---------- 1. Panel ---------- */
function panel(G) {
  const me = uid(), p = partnerUid(), c = cfgOf(game);
  const row = who => { const pr = prog(game, who), st = Object.values(pr.ls || {}).reduce((a, b) => a + b, 0); return `<div class="row"><span>${esc(who === me ? 'Tú' : nameOf(who))}</span><span class="small">Nivel <b>${Math.min(pr.lv || 1, totalOf(game))}</b> de ${totalOf(game)} · ⭐ ${st}${pr.dw ? ` · ⚔️ ${pr.dw}` : ''}</span></div>`; };
  return `<div class="glass stack"><span class="label">${G.e} ${G.name}: en qué van</span>${row(me)}${p ? row(p) : ''}</div>
    <div class="glass stack"><label class="row"><span>Mostrar el juego a los dos</span><input type="checkbox" ${c.off ? '' : 'checked'} onchange="ajCfg('off', !this.checked)"></label>
      <p class="tiny muted" style="margin:0">Si lo apagas, desaparece de Más, de la barra y de los juegos de la mascota (el progreso no se pierde).</p>
      ${game === 'arrows' ? `<label class="row"><span>🧊 Figuras con etiqueta BETA</span><input type="checkbox" ${c.beta?.cube === false ? '' : 'checked'} onchange="ajCfg('beta.cube', this.checked)"></label>
        <label class="row"><span>🔀 Mixto con etiqueta BETA</span><input type="checkbox" ${c.beta?.mix === false ? '' : 'checked'} onchange="ajCfg('beta.mix', this.checked)"></label>` : ''}</div>
    ${game !== 'fruta' ? giftAdminCards() : ''}
    <div class="glass stack"><span class="label">🧪 Tu progreso (para probar)</span>
      <div class="add-row"><input id="ajJump" type="number" min="1" max="${totalOf(game)}" inputmode="numeric" placeholder="Saltar al nivel…" aria-label="Saltar al nivel"><button class="btn small" onclick="ajJump()">Saltar</button></div>
      <button class="btn ghost small danger" onclick="ajReset()">Reiniciar mi progreso en ${G.name}</button>
      <p class="tiny muted" style="margin:0">Solo cambia tu progreso, no el de tu pareja.</p></div>`;
}
async function ajCfg(path, v) {
  const [a, b] = path.split('.'), data = b ? { [a]: { [b]: v } } : { [a]: v };
  write(setDoc(ref(game, 'cfg'), data, { merge: true })); toast('Guardado');
}
function ajJump() {
  const n = Number($('ajJump')?.value), max = totalOf(game); if (!(n >= 1 && n <= max)) return toast(`Del 1 al ${max}`);
  write(setDoc(ref(game, 'p-' + uid()), { lv: n }, { merge: true })); toast(`Ahora vas en el nivel ${n}`);
}
async function ajReset() {
  if (!(await ask(`¿Reiniciar tu progreso en ${GAMES[game].name}? Pierdes tus niveles y estrellas de este juego.`, { ok: 'Reiniciar', danger: true }))) return;
  write(setDoc(ref(game, 'p-' + uid()), { lv: 1, ls: {}, best: {}, lx: {} }, { merge: false })); toast('Progreso reiniciado');
}

/* ---------- 2. Editor de niveles ---------- */
const published = L => docOf(game, 'lv-' + L);
function current(L) {
  if (game === 'fruta') { const c = published(L); return JSON.parse(JSON.stringify(c?.level || pick(FE.levelSpec(L)))); }
  if (game === 'arrows') return { ...arrowsLevelInfo(L), ...(published(L)?.params || {}) };
  const sp = busLevelSpec(L); return { w: sp.w, h: sp.h, count: sp.count, colors: sp.colors, diag: Math.round((sp.diag || 0) * 100) / 100, seed: sp.seed, ...(published(L)?.params || {}) };
}
const pick = s => ({ w: s.w, h: s.h, colors: s.colors, moves: s.moves, mask: s.mask, leaf: s.leaf, stone: s.stone, vine: s.vine, pinas: s.pinas || 0, goals: { ...s.goals } });
function edit(G) {
  if (!draft) draft = current(edL);
  const c = published(edL);
  const T = totalOf(game), isNew = edL > T, extra = edL > G.levels;
  const list = Array.from({ length: T }, (_, i) => i + 1).map(n => { const d = published(n); return `<button class="${n === edL ? 'cur' : ''}" onclick="ajLevel(${n})"><b>${n}</b><small>${d ? (d.on ? '✏️' : '⏸️') : ''}</small></button>`; }).join('');
  return `<div class="glass stack"><div class="row"><span class="label">Nivel ${edL}</span><span class="tiny muted">${isNew ? '✨ Nivel nuevo, sin publicar' : extra ? (c?.on ? '✨ Nivel nuevo publicado' : '✨ Nivel nuevo sin publicar') : c ? (c.on ? '✏️ Editado y publicado' : '⏸️ Editado, sin publicar') : 'Generado automáticamente'}</span></div>
      ${isNew ? `<p class="tiny muted" style="margin:0">Empieza con un tablero generado parecido a los últimos niveles: cámbialo a tu gusto, pruébalo y publícalo. Aparece en el mapa de los dos en «✨ Niveles nuevos».</p>` : ''}
      ${game === 'fruta' ? frutaEditor() : game === 'arrows' ? arrowsEditor() : busEditor()}
      <div class="grid2"><button class="btn ghost" onclick="ajTest()">▶ Probar</button><button class="btn" onclick="ajPublish()">Publicar</button></div>
      ${game === 'fruta' ? `<button class="btn ghost" onclick="ajSim()">🤖 Probar 200 veces solo</button><div id="ajSim">${simHTML()}</div>` : '<p class="tiny muted" style="margin:0">Estos tableros siempre tienen solución: el generador los arma así.</p>'}
      ${extra ? (edL === T && c ? `<button class="btn ghost small danger" onclick="ajRevert()">🗑️ Quitar este nivel nuevo</button>` : '') : `<div class="grid2">${c?.on ? `<button class="btn ghost small" onclick="ajUnpublish()">⏸️ Despublicar</button>` : '<span></span>'}${c ? `<button class="btn ghost small" onclick="ajRevert()">↩️ Volver al generado</button>` : '<span></span>'}</div>`}
      <input id="ajOther" type="number" min="1" max="${T}" inputmode="numeric" placeholder="Otro nivel (para copiar o intercambiar)" aria-label="Otro nivel">
      <div class="grid2"><button class="btn ghost small" onclick="ajCopy()">📋 Copiar ahí</button><button class="btn ghost small" onclick="ajSwap()">🔁 Intercambiar</button></div>
      <p class="tiny muted" style="margin:0">«Publicar» lo cambia para los dos al instante. «Copiar ahí» pone este borrador en otro número (para hacer variantes); «Intercambiar» cambia de lugar dos niveles en el mapa.</p></div>
    <div class="glass stack"><div class="row"><span class="label">Todos los niveles</span><button class="btn small" onclick="ajNew()">＋ Nivel nuevo (${T + 1})</button></div><div class="ar-levels aj-levels">${list}${isNew ? `<button class="cur"><b>${edL}</b><small>✨</small></button>` : ''}</div><p class="tiny muted" style="margin:0">✏️ editado · ⏸️ editado sin publicar · los números después del ${G.levels} son niveles nuevos tuyos</p></div>`;
}
function ajLevel(n) { edL = n; draft = null; sim = null; rerender(); }
function ajNew() { edL = totalOf(game) + 1; draft = null; sim = null; rerender(); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }
// Pura fruta: tablero dibujado
const TOOLS = [['cell', '⬜', 'Casilla'], ['hole', '✖️', 'Hueco'], ['leaf1', '🍃', 'Hoja'], ['leaf2', '🌿', 'Hoja doble'], ['stone1', '🪨', 'Piedra'], ['stone2', '⛰️', 'Piedra doble'], ['vine', '🕸️', 'Bejuco']];
function frutaEditor() {
  const d = draft, n = d.w * d.h, g = d.goals || {};
  const cells = Array.from({ length: n }, (_, i) => {
    const m = d.mask[i] === '1', L = Number(d.leaf[i]), s = Number(d.stone[i]), v = d.vine[i] === '1';
    return `<button class="aj-cell ${m ? '' : 'hole'} ${L ? 'l' + L : ''} ${s ? 's' + s : ''} ${v ? 'vn' : ''}" aria-label="Casilla ${i + 1}" onclick="ajPaint(${i})">${s ? (s === 2 ? '⛰️' : '🪨') : v ? '🕸️' : ''}</button>`;
  }).join('');
  return `<div class="grid3"><label class="f">Ancho<select onchange="ajSize('w', this.value)">${[5, 6, 7, 8, 9].map(x => `<option ${x === d.w ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f">Alto<select onchange="ajSize('h', this.value)">${[5, 6, 7, 8, 9].map(x => `<option ${x === d.h ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f">Frutas<select onchange="ajSet('colors', +this.value)">${[4, 5, 6].map(x => `<option ${x === d.colors ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <div class="chips scroll">${TOOLS.map(([k, e, l]) => `<button class="chip ${tool === k ? 'on' : ''}" onclick="ajTool('${k}')">${e} ${l}</button>`).join('')}</div>
    <div class="aj-board" style="grid-template-columns:repeat(${d.w}, 34px)">${cells}</div>
    <p class="tiny muted" style="margin:0">Toca casillas con la herramienta elegida. «Casilla» la deja limpia.</p>
    <div class="grid2"><label class="f">Movimientos<input type="number" min="5" max="99" value="${d.moves}" onchange="ajSet('moves', +this.value)"></label>
      <label class="f">Piñas a bajar (0 = ninguna)<input type="number" min="0" max="8" value="${g.pinas ? d.pinas || 3 : 0}" onchange="ajPinas(+this.value)"></label></div>
    <span class="f">Frutas que hay que juntar (vacío = no)</span>
    <div class="aj-goals">${FE.FRUITS.slice(0, d.colors).map(([e], c) => `<label>${e}<input type="number" min="0" max="99" value="${g['c' + c] || ''}" onchange="ajGoal('c${c}', +this.value)"></label>`).join('')}</div>
    <div class="grid2"><label class="check"><input type="checkbox" ${g.leaf ? 'checked' : ''} onchange="ajGoal('leaf', this.checked)"> Limpiar todas las hojas</label>
      <label class="check"><input type="checkbox" ${g.stone ? 'checked' : ''} onchange="ajGoal('stone', this.checked)"> Romper todas las piedras</label></div>`;
}
function ajTool(k) { tool = k; rerender(); }
function setCh(str, i, ch) { return str.slice(0, i) + ch + str.slice(i + 1); }
function ajPaint(i) {
  const d = draft;
  if (tool === 'cell') { d.mask = setCh(d.mask, i, '1'); d.leaf = setCh(d.leaf, i, '0'); d.stone = setCh(d.stone, i, '0'); d.vine = setCh(d.vine, i, '0'); }
  if (tool === 'hole') { d.mask = setCh(d.mask, i, d.mask[i] === '1' ? '0' : '1'); d.leaf = setCh(d.leaf, i, '0'); d.stone = setCh(d.stone, i, '0'); d.vine = setCh(d.vine, i, '0'); }
  if (tool.startsWith('leaf')) { d.mask = setCh(d.mask, i, '1'); d.stone = setCh(d.stone, i, '0'); d.leaf = setCh(d.leaf, i, d.leaf[i] === tool.slice(-1) ? '0' : tool.slice(-1)); }
  if (tool.startsWith('stone')) { d.mask = setCh(d.mask, i, '1'); d.leaf = setCh(d.leaf, i, '0'); d.vine = setCh(d.vine, i, '0'); d.stone = setCh(d.stone, i, d.stone[i] === tool.slice(-1) ? '0' : tool.slice(-1)); }
  if (tool === 'vine') { if (d.stone[i] !== '0' || d.mask[i] !== '1') return; d.vine = setCh(d.vine, i, d.vine[i] === '1' ? '0' : '1'); }
  sim = null; rerender();
}
function ajSize(k, v) {
  const d = draft, w0 = d.w, h0 = d.h, w = k === 'w' ? +v : w0, h = k === 'h' ? +v : h0;
  const remap = (s, def) => { let o = ''; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o += x < w0 && y < h0 ? s[y * w0 + x] : def; return o; };
  Object.assign(d, { w, h, mask: remap(d.mask, '1'), leaf: remap(d.leaf, '0'), stone: remap(d.stone, '0'), vine: remap(d.vine, '0') });
  sim = null; rerender();
}
function ajSet(k, v) { draft[k] = v; sim = null; }
function ajGoal(k, v) { draft.goals = { ...draft.goals }; if (v) draft.goals[k] = v === true ? true : v; else delete draft.goals[k]; sim = null; }
function ajPinas(v) { draft.goals = { ...draft.goals }; if (v > 0) { draft.goals.pinas = true; draft.pinas = v; } else { delete draft.goals.pinas; draft.pinas = 0; } sim = null; }
// Flechas: parámetros
function arrowsEditor() {
  const d = draft;
  return `<div class="grid2"><label class="f">Flechas (aprox.)<input type="number" min="16" max="800" value="${d.n0}" onchange="ajSet('n0', +this.value)"></label>
      <label class="f">Largo máximo<select onchange="ajSet('maxLen', +this.value)">${[3, 4, 5, 6].map(x => `<option ${x === d.maxLen ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <span class="f">Obstáculos</span>
    <div class="chips">${Object.entries(MODS_INFO).map(([k, [e, l]]) => `<button class="chip ${d.mods.includes(k) ? 'on' : ''}" onclick="ajMod('${k}')">${e} ${l}</button>`).join('')}</div>
    <div class="row"><span class="tiny muted">Semilla: ${d.seed}</span><button class="link" onclick="ajSeed()">🎲 Otro tablero</button></div>`;
}
function ajMod(k) { draft.mods = draft.mods.includes(k) ? draft.mods.filter(x => x !== k) : [...draft.mods, k]; rerender(); }
function ajSeed() { draft.seed = Math.floor(Math.random() * 2 ** 31); sim = null; rerender(); }
// La parada: parámetros
function busEditor() {
  const d = draft, num = (k, l, a, b, step = 1) => `<label class="f">${l}<input type="number" min="${a}" max="${b}" step="${step}" value="${d[k]}" onchange="ajSet('${k}', +this.value)"></label>`;
  return `<div class="grid2">${num('w', 'Ancho', 4, 12)}${num('h', 'Alto', 5, 16)}${num('count', 'Vehículos', 4, 70)}${num('colors', 'Colores', 2, 6)}${num('diag', 'Diagonales (0 a 0.6)', 0, 0.6, 0.05)}</div>
    <div class="row"><span class="tiny muted">Semilla: ${d.seed}</span><button class="link" onclick="ajSeed()">🎲 Otro estacionamiento</button></div>`;
}
const toSave = () => game === 'fruta' ? { level: draft } : { params: draft };
function ajTest() {
  if (game === 'fruta') return playFruta({ ...FE.levelSpec(edL), ...draft, custom: true, title: `🧪 Borrador nivel ${edL}`, num: edL });
  if (game === 'arrows') return playArrowsDraft(edL, draft);
  playBusDraft(edL, draft);
}
async function ajPublish() {
  if (game === 'fruta' && !Object.keys(draft.goals || {}).length) return toast('Ponle al menos un objetivo');
  const T = totalOf(game), fresh = edL > T, p = partnerUid();
  if (edL > T + 1) return toast(`Primero crea el nivel ${T + 1}`);
  write(setDoc(ref(game, 'lv-' + edL), { on: true, ...toSave(), by: uid(), at: Date.now() })); toast(fresh ? `✨ Nivel ${edL} creado y publicado` : `Nivel ${edL} publicado ✏️`);
  // Si tu pareja ya había terminado todos, le avisa que hay uno nuevo (La parada solo si ya se regaló)
  if (fresh && p && (prog(game, p).lv || 1) > T && (game !== 'bus' || giftInfo('bus').on)) {
    const G = GAMES[game];
    notify(game, { title: `✨ Hay un nivel nuevo en ${G.name} ${G.e}`, body: `${meForPartner()} hizo el nivel ${edL}. ¿Lo pasas?`, url: './?open=' + game, tag: game + '-new' });
  }
}
function ajUnpublish() {
  if (edL > GAMES[game].levels) return toast('Los niveles nuevos se quitan con «Quitar este nivel nuevo»'); write(setDoc(ref(game, 'lv-' + edL), { on: false }, { merge: true })); toast('Despublicado: vuelve el generado'); }
async function ajRevert() {
  const T = totalOf(game), extra = edL > GAMES[game].levels;
  if (extra && edL !== T) return toast('Solo se puede quitar el último nivel nuevo');
  if (!(await ask(extra ? `¿Quitar el nivel nuevo ${edL}? Desaparece del mapa de los dos.` : `¿Borrar la edición del nivel ${edL} y volver al generado?`, { ok: extra ? 'Quitar' : 'Volver', danger: true }))) return;
  if (extra) { write(deleteDoc(ref(game, 'lv-' + edL))); edL = Math.max(1, T - 1); draft = null; return toast('Nivel quitado'); }
  write(deleteDoc(ref(game, 'lv-' + edL))); draft = null; toast('Volvió al generado');
}
function otherNum() { const n = Number($('ajOther')?.value), max = totalOf(game); if (!(n >= 1 && n <= max) || n === edL) { toast(`Elige otro nivel del 1 al ${max}`); return 0; } return n; }
function ajCopy() { const n = otherNum(); if (!n) return; write(setDoc(ref(game, 'lv-' + n), { on: true, ...toSave(), by: uid(), at: Date.now() })); toast(`Copiado al nivel ${n} y publicado`); }
async function ajSwap() {
  const n = otherNum(); if (!n) return;
  if (!(await ask(`¿Intercambiar los niveles ${edL} y ${n}? Se publican los dos cambiados.`, { ok: 'Intercambiar' }))) return;
  const a = current(edL), b = current(n), wrap = x => game === 'fruta' ? { level: x } : { params: x };
  write(setDoc(ref(game, 'lv-' + edL), { on: true, ...wrap(b), by: uid(), at: Date.now() }));
  write(setDoc(ref(game, 'lv-' + n), { on: true, ...wrap(a), by: uid(), at: Date.now() }));
  draft = null; toast('Niveles intercambiados');
}
// «Probar 200 veces»: el jugador automático juega el borrador en tandas para no congelar la pantalla
function simHTML() {
  if (!sim) return '';
  if (sim.running) return `<p class="small" style="margin:0">Jugando… ${sim.done} de ${sim.total}</p><div class="ar-bar"><i style="width:${sim.done / sim.total * 100}%"></i></div>`;
  const rate = sim.wins / sim.total;
  return `<div class="aj-sim"><b>${FE.difficultyLabel(rate)}</b><span>Ganó ${Math.round(rate * 100)} % de ${sim.total} partidas${sim.wins ? ` · sobraron ${(sim.left / sim.wins).toFixed(1)} movimientos en promedio` : ''}</span>
    <span class="tiny muted">El jugador automático juega bien pero no perfecto: una persona suele ganar parecido o un poco menos. Para un nivel normal, apunta a 60-85 %.</span></div>`;
}
function ajSim() {
  const level = { ...FE.levelSpec(edL), ...draft }, total = 200;
  sim = { running: true, done: 0, total, wins: 0, left: 0 };
  const box = () => { const el = $('ajSim'); if (el) el.innerHTML = simHTML(); };
  box();
  const step = () => {
    if (!sim?.running) return;
    const r = FE.simulate(level, 10, 77 + sim.done);
    sim.wins += r.wins; sim.left += r.left * r.wins; sim.done += 10;
    if (sim.done >= total) sim.running = false;
    box(); if (sim.running) setTimeout(step, 0);
  };
  setTimeout(step, 30);
}

/* ---------- 3. Estadísticas ---------- */
function stats(G) {
  const st = docOf(game, 'stats') || {}, a = st.a || {}, w = st.w || {}, me = uid(), p = partnerUid();
  const mine = prog(game, me).ls || {}, theirs = p ? prog(game, p).ls || {} : {};
  const rows = []; for (let L = 1; L <= totalOf(game); L++) if (a[L] || mine[L] || theirs[L]) rows.push(L);
  const wall = rows.filter(L => (a[L] || 0) >= 5 && (w[L] || 0) / a[L] < 0.35);
  return `${wall.length ? `<div class="glass stack" style="border-color:rgba(255,110,60,.5)"><span class="label">🧱 Niveles pared</span><p class="small" style="margin:0">Donde más se atascan (5+ intentos y menos de 35 % ganados): ${wall.map(L => `<button class="link" onclick="ajPart('edit');ajLevel(${L})">${L}</button>`).join(', ')}. Tócalos para ajustarlos.</p></div>` : ''}
    <div class="glass stack"><span class="label">📈 Por nivel</span>
      ${rows.length ? `<div class="aj-table"><table><thead><tr><th>Nivel</th><th>Intentos</th><th>Ganados</th><th>%</th><th>Tú</th><th>${esc(p ? nameOf(p) : '')}</th></tr></thead><tbody>${rows.map(L => `<tr class="${wall.includes(L) ? 'wall' : ''}"><td>${L}</td><td>${a[L] || 0}</td><td>${w[L] || 0}</td><td>${a[L] ? Math.round((w[L] || 0) / a[L] * 100) + '%' : '—'}</td><td>${mine[L] ? '★'.repeat(mine[L]) : ''}</td><td>${theirs[L] ? '★'.repeat(theirs[L]) : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="small muted" style="margin:0">Todavía no hay partidas registradas (se empezó a contar en esta versión).</p>'}</div>`;
}

/* ---------- 4. Reto del día programado ---------- */
function day(G) {
  const list = (S.data[game] || []).filter(d => /^day-/.test(d.id) && d.id.slice(4) >= todayKey()).sort((a, b) => a.id.localeCompare(b.id));
  return `<div class="glass stack"><span class="label">🗓️ Programar el reto de un día</span>
      <p class="tiny muted" style="margin:0">Ese día, el reto para los dos usa el tablero del nivel que elijas (por ejemplo uno en forma de corazón para su aniversario). Los demás días se arma solo.</p>
      <div class="grid2"><input type="date" id="ajDay" min="${todayKey()}" aria-label="Día"><input type="number" id="ajDayL" min="1" max="${totalOf(game)}" inputmode="numeric" placeholder="Nivel (1-${totalOf(game)})" aria-label="Nivel"></div>
      <button class="btn" onclick="ajDaySave()">Programar</button></div>
    <div class="glass"><ul class="list">${list.length ? list.map(d => `<li><div class="txt">${esc(d.id.slice(4))}<span class="sub">Tablero del nivel ${d.num}</span></div><button class="del" aria-label="Quitar" onclick="ajDayDel('${d.id}')">✕</button></li>`).join('') : '<li class="empty">Nada programado</li>'}</ul></div>`;
}
function ajDaySave() {
  const d = $('ajDay').value, n = Number($('ajDayL').value), max = totalOf(game);
  if (!d || !(n >= 1 && n <= max)) return toast('Elige el día y un nivel');
  write(setDoc(ref(game, 'day-' + d), { num: n, by: uid(), at: Date.now() })); toast('Reto programado 🗓️');
}
function ajDayDel(id) { softDelete(game, id, 'el reto programado'); }

/* ---------- 5. Mensajes sorpresa al pasar un nivel ---------- */
function msg(G) {
  const p = partnerUid(), list = (S.data[game] || []).filter(d => /^msg-/.test(d.id)).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
  const pl = p ? prog(game, p).lv || 1 : 1;
  return `<div class="glass stack"><span class="label">💌 Mensaje al pasar un nivel</span>
      <p class="tiny muted" style="margin:0">Cuando ${esc(p ? nameOf(p) : 'tu pareja')} pase ese nivel por primera vez, le sale tu mensaje en la pantalla de «¡Nivel listo!». Va en el nivel ${Math.min(pl, totalOf(game))}.</p>
      <input type="number" id="ajMsgL" min="1" max="${totalOf(game)}" inputmode="numeric" placeholder="Nivel (1-${totalOf(game)})" aria-label="Nivel">
      <textarea id="ajMsgT" rows="2" maxlength="200" placeholder="Ej: ¡Ya vas a la mitad! Te amo 💕" aria-label="Mensaje"></textarea>
      <button class="btn" onclick="ajMsgSave()" ${p ? '' : 'disabled'}>Guardar mensaje</button>
      <p class="tiny muted" style="margin:0">Las monedas de la mascota son de los dos, así que no hace falta regalarlas: las ayudas salen de ahí.</p></div>
    <div class="glass"><ul class="list">${list.length ? list.map(d => `<li><div class="txt">Nivel ${d.id.slice(4)}: ${esc(d.text)}<span class="sub">${Number(d.id.slice(4)) < pl ? 'Ya lo pasó (le salió si fue después de guardarlo)' : 'Esperando'}</span></div><button class="del" aria-label="Quitar" onclick="ajMsgDel('${d.id}')">✕</button></li>`).join('') : '<li class="empty">Sin mensajes</li>'}</ul></div>`;
}
function ajMsgSave() {
  const n = Number($('ajMsgL').value), t = $('ajMsgT').value.trim(), max = totalOf(game);
  if (!(n >= 1 && n <= max) || !t) return toast('Escribe el nivel y el mensaje');
  write(setDoc(ref(game, 'msg-' + n), { from: uid(), to: partnerUid(), text: t, at: Date.now() })); toast('Mensaje guardado 💌');
}
function ajMsgDel(id) { softDelete(game, id, 'el mensaje'); }

/* ---------- 6. Economía ---------- */
function eco(G) {
  const c = cfgOf(game), coins = c.coins || {};
  const field = (path, label, val, def) => `<label class="f">${label}<input type="number" min="0" max="500" value="${val ?? ''}" placeholder="${def}" onchange="ajCfgNum('${path}', this.value)"></label>`;
  const costs = game === 'fruta' ? [['helps.hammer', '🔨 Martillo', c.helps?.hammer, 10], ['helps.shuffle', '🔀 Mezclar', c.helps?.shuffle, 8], ['helps.plus', '➕ +5 movimientos', c.helps?.plus, 15], ['helps.lapa', '🦜 Lapa', c.helps?.lapa, 12]]
    : game === 'arrows' ? [['cont', '❤️ Seguir sin vidas', c.cont, 15]] : [['unlock', '🔒 Abrir un lugar', c.unlock, 15], ['sort', '🔀 Acomodar la fila', c.sort, 20], ['tow', '🏗️ Grúa', c.tow, 25]];
  const defs = game === 'fruta' ? [5, 10, 20] : game === 'arrows' ? [3, 10, 20] : [5, 10, 20];
  return `<div class="glass stack"><span class="label">🪙 Monedas que da cada nivel (la primera vez)</span>
      <div class="grid3">${field('coins.easy', game === 'arrows' ? 'Niveles 1-5' : 'Niveles 1-10', coins.easy, defs[0])}${field('coins.normal', 'Normales', coins.normal, defs[1])}${field('coins.boss', '👑 Jefes', coins.boss, defs[2])}</div></div>
    <div class="glass stack"><span class="label">Precio de las ayudas</span><div class="grid2">${costs.map(([k, l, v, d]) => field(k, l, v, d)).join('')}</div>
      <p class="tiny muted" style="margin:0">Vacío = el precio de siempre (el número gris). Se guarda al salir de cada campo.</p></div>`;
}
function ajCfgNum(path, v) { const [a, b] = path.split('.'), n = v === '' ? null : Math.max(0, Math.round(Number(v))); write(setDoc(ref(game, 'cfg'), b ? { [a]: { [b]: n } } : { [a]: n }, { merge: true })); toast('Guardado'); }

expose({ ajNew, ajGame, ajPart, ajCfg, ajJump, ajReset, ajLevel, ajTool, ajPaint, ajSize, ajSet, ajGoal, ajPinas, ajMod, ajSeed, ajTest, ajPublish, ajUnpublish, ajRevert,
  ajCopy, ajSwap, ajSim, ajDaySave, ajDayDel, ajMsgSave, ajMsgDel, ajCfgNum });
