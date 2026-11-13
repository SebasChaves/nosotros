// Flechas: rompecabezas de sacar flechas del tablero. Al tocar una flecha se desliza hacia donde apunta; si nada la
// bloquea sale del tablero, si choca con otra regresa y se pierde una vida (❤️ x3). Gana quien vacía el tablero.
// - Niveles que se desbloquean (cada uno con su semilla: el nivel 7 es igual para los dos) y estrellas por nivel.
// - Reto del día: el mismo tablero para los dos; se comparan tiempo y errores; el primero que lo termina da 10 🪙 a la mascota.
// - Sorpresa: hasta que el dueño lo «regala» desde Administración (couples/nosotros.features.arrows.on), solo lo ve él.
//   Al regalarlo, a la pareja le aparece envuelto en papel de regalo (Más, Inicio y juegos de la mascota) hasta que lo abre
//   (profiles/<uid>.prefs.unwrapped.arrows).
// Datos: arrows/p-<uid> { level, stars{n: 1..3} } · arrows/d-<día> { <uid>: { ms, errors, hints, at } }.
import { setDoc, updateDoc, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, EMU, db, esc, icon, on, onShow, expose, toast, write, ref, coupleRef, profile, uid, partnerUid, nameOf, partnerName,
         todayKey, celebrate, syncBack, gates, markActive, countStat, ask } from './core.js';
import { backBar } from './lists.js';
import { isTester } from './testing.js';
import { notify, meForPartner } from './push.js';
import { pet } from './pet.js';

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
   Se colocan flechas una por una: cada flecha nueva debe tener libre el camino hasta el borde con las que ya están.
   Resolverlo = sacarlas en orden inverso al que se pusieron, así que siempre se puede. */
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // arriba, derecha, abajo, izquierda
const COLORS = ['#FF6B8B', '#FFB547', '#5BD1A0', '#6AA8FF', '#B78BFF', '#FF8A5C'];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function generate(seed, n, density) {
  const R = rng(seed), grid = Array.from({ length: n }, () => Array(n).fill(null)), list = [];
  const clear = (x, y, d) => { const [dx, dy] = DIRS[d]; for (x += dx, y += dy; x >= 0 && y >= 0 && x < n && y < n; x += dx, y += dy) if (grid[y][x]) return false; return true; };
  const target = Math.round(n * n * density);
  for (let tries = 0; list.length < target && tries < n * n * 12; tries++) {
    const x = Math.floor(R() * n), y = Math.floor(R() * n);
    if (grid[y][x]) continue;
    // Prefiere direcciones que apuntan hacia dentro del tablero (más difícil que apuntar al borde más cercano)
    const ds = [0, 1, 2, 3].map(d => ({ d, w: R() + (d === 0 ? y : d === 2 ? n - 1 - y : d === 3 ? x : n - 1 - x) / n })).sort((a, b) => b.w - a.w).map(o => o.d);
    const d = ds.find(k => clear(x, y, k));
    if (d === undefined) continue;
    const a = { id: list.length, x, y, d, c: COLORS[Math.floor(R() * COLORS.length)] };
    grid[y][x] = a; list.push(a);
  }
  return list;
}
// Nivel → tamaño y densidad
export const levelSpec = L => ({ n: Math.min(9, 4 + Math.floor((L - 1) / 3)), density: Math.min(0.9, 0.55 + L * 0.025), seed: hash('nivel-' + L) });
const dailySpec = (day = todayKey()) => ({ n: 8, density: 0.86, seed: hash('dia-' + day) });

/* ---------- Datos ---------- */
const progress = (id = uid()) => S.data.arrows.find(d => d.id === 'p-' + id) || {};
const myLevel = () => progress().level || 1;
const daily = (day = todayKey()) => S.data.arrows.find(d => d.id === 'd-' + day) || {};
const fmtMs = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
// Puntaje del reto: tiempo + 5 s por error + 10 s por pista (menos es mejor)
const score = r => r.ms + r.errors * 5000 + (r.hints || 0) * 10000;

/* ---------- Pantalla ---------- */
function render() {
  if (!arrowsVisible()) { $('s-arrows').innerHTML = `${backBar('Flechas')}<p class="empty">Todavía no 😉</p>`; return; }
  const L = myLevel(), st = progress().stars || {}, total = Object.values(st).reduce((a, b) => a + b, 0);
  const d = daily(), me = d[uid()], p = partnerUid(), them = p && d[p];
  const surprise = isOwner() && !giftInfo().on;
  const dayRow = (who, r) => `<div class="row"><span>${who}</span><span class="small">${r ? `<b>${fmtMs(r.ms)}</b> · ${r.errors} ${r.errors === 1 ? 'error' : 'errores'}${r.hints ? ` · ${r.hints} 💡` : ''}` : '<span class="muted">sin jugar</span>'}</span></div>`;
  const winner = me && them ? (score(me) === score(them) ? '¡Empate! 🤝' : score(me) < score(them) ? '¡Hoy ganas tú! 🏆' : `Hoy gana ${esc(nameOf(p))} 🏆`) : '';
  $('s-arrows').innerHTML = `${backBar('Flechas', 's-more', `<span class="pill">⭐ ${total}</span>`)}
    ${surprise ? `<div class="glass small" style="border-color:rgba(255,181,71,.5)">🔒 <b>Sorpresa:</b> solo tú lo ves. Cuando quieras regalarlo: Administración → Pruebas → 🎁 Sorpresa.</div>` : ''}
    <div class="glass stack ar-hero"><div class="ar-hero-ic">🏹</div><div class="stack" style="gap:4px;align-items:center"><span class="label">Nivel ${L}</span>
      <span class="tiny muted">Tablero de ${levelSpec(L).n}×${levelSpec(L).n}</span></div>
      <button class="btn" onclick="playArrows(${L})">${L === 1 && !progress().level ? 'Empezar a jugar' : `Jugar nivel ${L}`}</button>
      <p class="tiny muted center" style="margin:0">Toca una flecha para sacarla del tablero. Si choca con otra, pierdes una vida ❤️. ¡Vacía el tablero!</p></div>
    <div class="glass stack"><div class="row"><span class="label">🗓️ Reto del día</span><span class="tiny muted">El mismo para los dos</span></div>
      ${dayRow('Tú', me)}${p ? dayRow(esc(nameOf(p)), them) : ''}
      ${winner ? `<p class="small center" style="margin:0"><b>${winner}</b></p>` : ''}
      ${me ? `<p class="tiny muted center" style="margin:0">Mañana hay otro 😉${them ? '' : ` A ${esc(partnerName())} le llega un aviso para que intente ganarte.`}</p>`
        : `<button class="btn ghost" onclick="playArrows('day')">Jugar el reto de hoy</button>`}</div>
    ${L > 1 ? `<div class="glass stack"><span class="label">Niveles</span><div class="ar-levels">${Array.from({ length: L }, (_, i) => i + 1).reverse().slice(0, 60).map(n =>
      `<button class="${n === L ? 'cur' : ''}" onclick="playArrows(${n})" aria-label="Nivel ${n}"><b>${n}</b><small>${st[n] ? stars(st[n]) : n === L ? 'nuevo' : ''}</small></button>`).join('')}</div></div>` : ''}`;
}

/* ---------- Jugar ---------- */
let G = null, view = null, timer = null;
function playArrows(what) {
  if (!arrowsVisible() || arrowsWrapped()) return;
  const isDay = what === 'day';
  if (isDay && daily()[uid()]) return toast('Ya hiciste el reto de hoy');
  const L = isDay ? 0 : Number(what) || myLevel(), spec = isDay ? dailySpec() : levelSpec(L);
  const list = generate(spec.seed, spec.n, spec.density);
  G = { isDay, L, n: spec.n, list, grid: Array.from({ length: spec.n }, () => Array(spec.n).fill(null)), left: list.length, lives: 3, errors: 0, hints: 0, moves: 0, t0: Date.now(), busy: new Set(), over: false };
  for (const a of list) G.grid[a.y][a.x] = a;
  view?.remove();
  view = document.createElement('div');
  view.className = 'dialog ar-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Flechas');
  document.body.appendChild(view); syncBack();
  paintGame();
  clearInterval(timer); timer = setInterval(() => { const t = $('arTime'); if (t && G && !G.over) t.textContent = fmtMs(Date.now() - G.t0); }, 500);
}
function paintGame() {
  const c = Math.floor(Math.min(innerWidth - 36, 480) / G.n);
  view.innerHTML = `<div class="ar-top"><button class="icon-btn" data-v="0" aria-label="Cerrar" onclick="closeArrows()">${icon('x')}</button>
      <div class="ar-title"><b>${G.isDay ? 'Reto del día' : 'Nivel ' + G.L}</b><span class="tiny muted"><span id="arLeft">${G.left}</span> flechas · <span id="arTime">0:00</span></span></div>
      <div class="ar-lives" id="arLives" aria-label="Vidas">${'❤️'.repeat(G.lives)}${'🤍'.repeat(3 - G.lives)}</div></div>
    <div class="ar-board" id="arBoard" style="--c:${c}px;width:${c * G.n}px;height:${c * G.n}px">
      ${G.list.map(a => `<button class="ar" id="ar${a.id}" style="left:${a.x * c}px;top:${a.y * c}px;color:${a.c}" aria-label="Flecha" onclick="tapArrow(${a.id})"><svg viewBox="0 0 24 24" style="transform:rotate(${a.d * 90}deg)"><path d="M12 20V5M6 11l6-6 6 6"/></svg></button>`).join('')}</div>
    <div class="ar-bottom"><button class="btn ghost small" onclick="arrowHint()">💡 Pista${G.isDay ? ' (+10 s)' : ''}</button><button class="btn ghost small" onclick="restartArrows()">↺ Reiniciar</button></div>`;
  G.c = c;
}
function tapArrow(id) {
  if (!G || G.over || G.busy.has(id)) return;
  const a = G.list[id]; if (!a || a.gone) return;
  const [dx, dy] = DIRS[a.d]; let x = a.x + dx, y = a.y + dy, steps = 0, blocker = null;
  while (x >= 0 && y >= 0 && x < G.n && y < G.n) { if (G.grid[y][x]) { blocker = G.grid[y][x]; break; } steps++; x += dx; y += dy; }
  const el = $('ar' + id), c = G.c; G.moves++; navigator.vibrate?.(8);
  el.classList.remove('hint');
  if (!blocker) {
    // Sale del tablero
    a.gone = true; G.grid[a.y][a.x] = null; G.left--; $('arLeft').textContent = G.left;
    const far = (steps + 2) * c;
    el.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx * far}px,${dy * far}px)`, opacity: 0 }], { duration: 160 + steps * 35, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' });
    if (!G.left) setTimeout(win, 260 + steps * 35);
    return;
  }
  // Choca: avanza hasta la otra flecha y regresa
  G.busy.add(id);
  const dist = steps * c + c * 0.28;
  el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx * dist}px,${dy * dist}px)`, offset: 0.45 }, { transform: 'translate(0,0)' }], { duration: 260 + steps * 50, easing: 'ease-in-out' })
    .finished.then(() => G?.busy.delete(id)).catch(() => {});
  setTimeout(() => { const b = $('ar' + blocker.id); b?.classList.add('hit'); setTimeout(() => b?.classList.remove('hit'), 400); }, 110 + steps * 22);
  G.errors++; G.lives--; navigator.vibrate?.([40, 30, 40]);
  $('arLives').innerHTML = '❤️'.repeat(G.lives) + '🤍'.repeat(3 - G.lives);
  $('arBoard').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  if (G.lives <= 0) { G.over = true; setTimeout(lose, 500); }
}
// Pista: una flecha que puede salir ya
function arrowHint() {
  if (!G || G.over) return;
  const free = G.list.filter(a => !a.gone && (() => { const [dx, dy] = DIRS[a.d]; for (let x = a.x + dx, y = a.y + dy; x >= 0 && y >= 0 && x < G.n && y < G.n; x += dx, y += dy) if (G.grid[y][x]) return false; return true; })());
  if (!free.length) return;
  const a = free[Math.floor(Math.random() * free.length)];
  document.querySelectorAll('.ar.hint').forEach(e => e.classList.remove('hint'));
  $('ar' + a.id)?.classList.add('hint'); G.hints++;
}
function restartArrows() { if (G) playArrows(G.isDay ? 'day' : G.L); }
function closeArrows() {
  clearInterval(timer); const el = view; view = null; G = null; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); render(); }, 160);
}
function lose() {
  if (!view) return;
  view.querySelector('.ar-bottom').innerHTML = '';
  view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box"><div style="font-size:46px">💔</div><h2>Sin vidas</h2>
    <p class="muted" style="margin:0">Te quedaron ${G.left} ${G.left === 1 ? 'flecha' : 'flechas'}. ¡Otra vez!</p>
    <div class="grid2"><button class="btn ghost" onclick="closeArrows()">Salir</button><button class="btn" onclick="restartArrows()">Reintentar</button></div></div></div>`);
}
function win() {
  if (!G || G.over) return;
  G.over = true; clearInterval(timer);
  const ms = Date.now() - G.t0, s = Math.max(1, 3 - G.errors - G.hints), p = partnerUid(), pt = pet();
  let msg = '', next = '';
  const b = writeBatch(db);
  if (G.isDay) {
    const day = todayKey(), d = daily(day), first = !Object.keys(d).some(k => k !== 'id' && d[k]?.ms);
    const r = { ms, errors: G.errors, hints: G.hints, at: Date.now() };
    b.set(ref('arrows', 'd-' + day), { [uid()]: r }, { merge: true });
    if (first && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(10) });
    const them = p && d[p];
    msg = `${fmtMs(ms)} · ${G.errors} ${G.errors === 1 ? 'error' : 'errores'}${G.hints ? ` · ${G.hints} 💡` : ''}${first && pt?.hatchedAt ? '<br>¡Fuiste primero! +10 🪙 para la mascota' : ''}`;
    if (them) msg += `<br>${score(r) < score(them) ? '🏆 ¡Le ganaste a ' : score(r) === score(them) ? '🤝 Empate con ' : '😅 Te ganó '}${esc(nameOf(p))} (${fmtMs(them.ms)})`;
    notify('arrows', { title: `🏹 ${meForPartner()} resolvió las Flechas del día en ${fmtMs(ms)}`,
      body: them ? (score(r) < score(them) ? 'Te ganó hoy 😏' : 'Le ganaste hoy 🏆') : '¿Le ganas? El tablero es el mismo para los dos', url: './?open=arrows', tag: 'arrows-' + day });
  } else {
    const prog = progress(), had = prog.stars?.[G.L] || 0;
    b.set(ref('arrows', 'p-' + uid()), { level: Math.max(prog.level || 1, G.L + 1), stars: { [G.L]: Math.max(had, s) } }, { merge: true });
    if (!had && pt?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(3) });
    msg = `<span class="ar-stars">${stars(s)}</span><br>${fmtMs(ms)} · ${G.errors} ${G.errors === 1 ? 'error' : 'errores'}${!had && pt?.hatchedAt ? ' · +3 🪙' : ''}`;
    next = `<button class="btn" onclick="playArrows(${G.L + 1})">Nivel ${G.L + 1} →</button>`;
  }
  write(b.commit()); markActive(); countStat('acts', G.isDay ? 'arrows-day' : 'arrows');
  celebrate(); navigator.vibrate?.([20, 40, 60]);
  view.querySelector('.ar-bottom').innerHTML = '';
  view.insertAdjacentHTML('beforeend', `<div class="ar-end"><div class="ar-end-box"><div style="font-size:46px">🎉</div><h2>${G.isDay ? '¡Reto del día listo!' : `¡Nivel ${G.L} listo!`}</h2>
    <p style="margin:0" class="center">${msg}</p><div class="${next ? 'grid2' : 'stack'}"><button class="btn ghost" onclick="closeArrows()">${next ? 'Salir' : 'Listo'}</button>${next}</div></div></div>`);
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
expose({ playArrows, tapArrow, arrowHint, restartArrows, closeArrows, unwrapGift, giftGive, giftSave, giftHide, giftRewrap });
