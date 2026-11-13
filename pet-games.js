// Juegos cortos con la mascota: Atrapa la comida, Memoria, Salta obstáculos y Toca a tiempo.
// Se juegan en una ventana a pantalla completa (el botón atrás de Android la cierra). Al terminar, pet.js decide las
// monedas y guarda el récord: playGame(id, petOpts, finish) donde finish(puntos) devuelve { coins, mine, theirs, record, capped }.
import { esc, syncBack } from './core.js';
import { petImage } from './pet-art.js';

export const GAMES = [
  { id: 'atrapa', name: 'Atrapa la comida', icon: '🍓', desc: 'Mueve a tu mascota con el dedo y atrapa la comida. ¡Ojo con el chile!', coins: s => Math.floor(s / 3) },
  { id: 'memoria', name: 'Memoria', icon: '🃏', desc: 'Encuentra las 6 parejas lo más rápido que puedas.', coins: s => Math.floor(s / 5) },
  { id: 'salta', name: 'Salta obstáculos', icon: '🌵', desc: 'Toca la pantalla para saltar. Aguanta lo más que puedas.', coins: s => Math.floor(s / 2) },
  { id: 'toca', name: 'Toca a tiempo', icon: '🍪', desc: 'Dale de comer justo cuando abra la boca. Tienes 3 vidas.', coins: s => Math.floor(s / 3) },
];
const FOOD = ['🍓', '🍪', '🐟', '🍎', '🧁', '🍙'];

export function playGame(id, petOpts, finish) {
  const g = GAMES.find(x => x.id === id); if (!g) return;
  const el = document.createElement('div');
  el.className = 'dialog game';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', g.name);
  el.innerHTML = `<div class="g-top"><b>${g.icon} ${esc(g.name)}</b><span class="g-score" aria-live="polite">0</span><span class="g-info"></span>
      <button class="g-x" data-v="0" aria-label="Salir del juego">✕</button></div>
    <div class="g-area"></div>`;
  document.body.appendChild(el); syncBack();
  const area = el.querySelector('.g-area'), scoreEl = el.querySelector('.g-score'), info = el.querySelector('.g-info');
  let stop = () => {}, closed = false;
  const close = () => { if (closed) return; closed = true; stop(); el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); };
  el.querySelector('.g-x').onclick = close;
  const setScore = n => { scoreEl.textContent = n; };

  const end = score => {
    stop(); stop = () => {};
    const r = finish(score) || {};
    area.innerHTML = `<div class="g-end"><div class="g-big">${score}</div><p>puntos</p>
      ${r.record ? '<p class="g-rec">🏆 ¡Nuevo récord tuyo!</p>' : ''}
      <p class="g-small">Tu récord: <b>${r.mine ?? score}</b>${r.theirsName ? ` · ${esc(r.theirsName)}: <b>${r.theirs ?? 0}</b>` : ''}</p>
      <p class="g-coins">${r.coins ? `+${r.coins} 🪙` : r.capped ? 'Hoy ya ganaste el máximo de monedas en juegos (30 🪙). ¡Igual cuenta el récord!' : 'Esta vez no alcanzó para monedas'}</p>
      <div class="g-btns"><button class="btn" data-again>Otra vez</button><button class="btn ghost" data-out>Salir</button></div></div>`;
    area.querySelector('[data-again]').onclick = () => start();
    area.querySelector('[data-out]').onclick = close;
  };
  // Cuenta regresiva y arranque
  const start = () => {
    setScore(0); info.textContent = '';
    area.innerHTML = `<div class="g-count"><p class="g-small">${esc(g.desc)}</p><div class="g-big" id="gCount">3</div></div>`;
    let n = 3;
    const t = setInterval(() => {
      if (closed) return clearInterval(t);
      n--; const c = area.querySelector('#gCount'); if (c) c.textContent = n || '¡Ya!';
      if (n < 0) { clearInterval(t); area.innerHTML = ''; stop = RUN[id](area, petOpts, setScore, info, end); }
    }, 600);
    stop = () => clearInterval(t);
  };
  start();
}

/* ---------- Utilidades de canvas ---------- */
function canvasIn(area) {
  const c = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = area.clientWidth, H = area.clientHeight;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  area.appendChild(c);
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  return { c, ctx, W, H };
}
function loop(step) {
  let last = performance.now(), raf = 0, on = true;
  const f = now => { if (!on) return; const dt = Math.min(.05, (now - last) / 1000); last = now; if (step(dt) !== false) raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
  return () => { on = false; cancelAnimationFrame(raf); };
}
const emoji = (ctx, e, x, y, size) => { ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.fillText(e, x, y); };

const RUN = {
  /* ---------- Atrapa la comida (30 s) ---------- */
  atrapa(area, petOpts, setScore, info, end) {
    const { c, ctx, W, H } = canvasIn(area), img = petImage({ ...petOpts, mood: 'feliz' }, 160);
    const P = 92; let px = W / 2, score = 0, t = 0, spawn = 0, items = [], flash = 0, popups = [];
    const move = e => { const r = c.getBoundingClientRect(); px = Math.max(P / 2, Math.min(W - P / 2, e.clientX - r.left)); };
    c.addEventListener('pointerdown', move); c.addEventListener('pointermove', move);
    c.style.touchAction = 'none';
    const stopLoop = loop(dt => {
      t += dt; spawn -= dt;
      const left = Math.max(0, 30 - t); info.textContent = `⏱ ${Math.ceil(left)}`;
      if (spawn <= 0) { spawn = Math.max(.32, .7 - t * .012); const bad = Math.random() < .15; items.push({ x: 20 + Math.random() * (W - 40), y: -20, v: 160 + t * 6 + Math.random() * 60, e: bad ? '🌶️' : FOOD[Math.floor(Math.random() * FOOD.length)], bad }); }
      ctx.clearRect(0, 0, W, H);
      if (flash > 0) { ctx.fillStyle = `rgba(255,80,80,${flash})`; ctx.fillRect(0, 0, W, H); flash -= dt * 2; }
      const py = H - P - 10;
      for (const it of items) {
        it.y += it.v * dt; emoji(ctx, it.e, it.x, it.y, 34);
        if (!it.hit && it.y > py + 10 && it.y < py + 50 && Math.abs(it.x - px) < P / 2) {
          it.hit = true;
          if (it.bad) { score = Math.max(0, score - 3); flash = .5; popups.push({ x: it.x, y: py, s: '-3', t: 0 }); navigator.vibrate?.(60); }
          else { score++; popups.push({ x: it.x, y: py, s: '+1', t: 0 }); }
          setScore(score);
        }
      }
      items = items.filter(it => !it.hit && it.y < H + 30);
      ctx.drawImage(img, px - P / 2, py, P, P);
      ctx.font = '700 18px Sora, sans-serif'; ctx.fillStyle = '#FFE07A';
      for (const p of popups) { p.t += dt; ctx.globalAlpha = Math.max(0, 1 - p.t * 1.5); ctx.fillText(p.s, p.x, p.y - p.t * 60); ctx.globalAlpha = 1; }
      popups = popups.filter(p => p.t < .7);
      if (t >= 30) { end(score); return false; }
    });
    return stopLoop;
  },

  /* ---------- Memoria (6 parejas, máx. 60 s) ---------- */
  memoria(area, petOpts, setScore, info, end) {
    const cards = [...FOOD, ...FOOD].map((e, i) => ({ e, i })).sort(() => Math.random() - .5);
    area.innerHTML = `<div class="g-mem">${cards.map((k, n) => `<button class="g-card" data-n="${n}" aria-label="Carta ${n + 1}"><span>${k.e}</span></button>`).join('')}</div>`;
    let open = [], found = 0, busy = false, t0 = performance.now(), done = false;
    const tick = setInterval(() => {
      const s = (performance.now() - t0) / 1000; info.textContent = `⏱ ${Math.floor(s)} s`;
      if (s >= 60 && !done) { done = true; clearInterval(tick); end(found * 5); }
    }, 250);
    area.querySelectorAll('.g-card').forEach(b => b.onclick = () => {
      if (busy || done || b.classList.contains('up')) return;
      b.classList.add('up'); open.push(b);
      if (open.length < 2) return;
      const [a, c] = open; open = [];
      if (cards[a.dataset.n].e === cards[c.dataset.n].e) {
        a.classList.add('ok'); c.classList.add('ok'); found++; navigator.vibrate?.(15);
        const s = (performance.now() - t0) / 1000;
        setScore(found * 5);
        if (found === 6) { done = true; clearInterval(tick); setTimeout(() => end(30 + Math.max(0, Math.round(45 - s))), 500); }
      } else { busy = true; setTimeout(() => { a.classList.remove('up'); c.classList.remove('up'); busy = false; }, 650); }
    });
    return () => clearInterval(tick);
  },

  /* ---------- Salta obstáculos (hasta chocar) ---------- */
  salta(area, petOpts, setScore, info, end) {
    const { c, ctx, W, H } = canvasIn(area), img = petImage({ ...petOpts, mood: 'feliz' }, 160);
    const G = H - 70, P = 70, X = 40; let y = G - P, vy = 0, t = 0, score = 0, next = 1, speed = 240, obs = [], dead = false;
    const jump = e => { e.preventDefault(); if (y >= G - P - 1) { vy = -Math.max(780, H * 1.25); navigator.vibrate?.(8); } };
    c.addEventListener('pointerdown', jump); c.style.touchAction = 'none';
    info.textContent = 'Toca para saltar';
    const stopLoop = loop(dt => {
      t += dt; speed = 240 + t * 12; next -= dt;
      vy += 2300 * dt; y = Math.min(G - P, y + vy * dt); if (y >= G - P) vy = 0;
      if (next <= 0) { next = .9 + Math.random() * 1.1 - Math.min(.4, t * .01); obs.push({ x: W + 30, e: ['🌵', '🪨', '🍄'][Math.floor(Math.random() * 3)], s: 36 + Math.random() * 10 }); }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(0, G, W, 3);
      for (const o of obs) {
        o.x -= speed * dt; emoji(ctx, o.e, o.x, G - o.s / 2 + 4, o.s);
        if (!o.passed && o.x < X) { o.passed = true; score++; setScore(score); }
        const hit = Math.abs(o.x - (X + P / 2)) < (o.s / 2 + P / 2 - 22) && y + P > G - o.s + 10;
        if (hit) dead = true;
      }
      obs = obs.filter(o => o.x > -40);
      ctx.drawImage(img, X, y, P, P);
      if (dead) { navigator.vibrate?.(80); end(score); return false; }
    });
    return stopLoop;
  },

  /* ---------- Toca a tiempo (3 vidas, máx. 45 s) ---------- */
  toca(area, petOpts, setScore, info, end) {
    const { c, ctx, W, H } = canvasIn(area);
    const shut = petImage({ ...petOpts, mood: 'feliz' }, 220), openImg = petImage({ ...petOpts, mood: 'hambre' }, 220);
    let state = 'closed', wait = 1 + Math.random(), win = 1.1, t = 0, lives = 3, score = 0, msg = '', msgT = 0, shake = 0;
    const lose = text => { lives--; msg = text; msgT = .8; shake = .3; navigator.vibrate?.(60); };
    c.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (state === 'open') { score++; setScore(score); msg = '¡Ñam! 😋'; msgT = .6; state = 'closed'; wait = .5 + Math.random() * 1.1; win = Math.max(.42, win * .95); navigator.vibrate?.(15); }
      else lose('¡Aún no! 🙈');
    });
    c.style.touchAction = 'none';
    const stopLoop = loop(dt => {
      t += dt; msgT -= dt; shake = Math.max(0, shake - dt);
      if (state === 'closed') { wait -= dt; if (wait <= 0) { state = 'open'; wait = win; } }
      else { wait -= dt; if (wait <= 0) { state = 'closed'; wait = .6 + Math.random() * 1.1; lose('¡Se le fue! 😢'); } }
      info.textContent = '❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, 3 - lives));
      ctx.clearRect(0, 0, W, H);
      const S = Math.min(W, H) * .62, dx = shake ? (Math.random() - .5) * 12 : 0;
      ctx.drawImage(state === 'open' ? openImg : shut, (W - S) / 2 + dx, (H - S) / 2, S, S);
      if (state === 'open') emoji(ctx, '🍪', W / 2, (H - S) / 2 - 10, 40);
      if (msgT > 0) { ctx.font = '700 22px Sora, sans-serif'; ctx.fillStyle = '#FFF'; ctx.globalAlpha = Math.min(1, msgT * 2); ctx.fillText(msg, W / 2, H - 50); ctx.globalAlpha = 1; }
      if (lives <= 0 || t >= 45) { end(score); return false; }
    });
    return stopLoop;
  },
};
