// Estilo navideño (1.14.0): del 15 de noviembre al 6 de enero la app se viste de Navidad en los dos teléfonos (colores
// rojo y dorado, nieve, guirnalda y gorrito en Inicio) y el 7 de enero vuelve sola a la normalidad. Cada uno lo puede
// apagar en su teléfono: Ajustes → Apariencia → «🎄 Estilo navideño» (prefs.season === false en su perfil).
// body.xmas activa todo el CSS (styles.css, «Estilo navideño»). La copia en localStorage «futari-xmas» deja que el script
// del inicio de index.html lo pinte antes de que cargue la app (sin parpadeo). Ver docs/ARQUITECTURA.md.
import { S, uid, profile, on, EMU, today, parseDate } from './core.js';

// Solo en el emulador: ?advHoy=AAAA-MM-DD simula otro día (el mismo parámetro del calendario de adviento)
const fakeDay = EMU ? new URLSearchParams(location.search).get('advHoy') : null;
export const seasonNow = () => (fakeDay && /^\d{4}-\d{2}-\d{2}$/.test(fakeDay) ? parseDate(fakeDay) : today());
export const xmasSeason = () => { const d = seasonNow(), m = d.getMonth(), n = d.getDate(); return (m === 10 && n >= 15) || m === 11 || (m === 0 && n <= 6); };
export const xmasOn = () => xmasSeason() && profile(uid()).prefs?.season !== false;
// Saludo especial de Inicio en Nochebuena, Navidad, 31 de diciembre y 1 de enero: «¡Feliz Navidad, Ana! 🎄» (o null)
export function xmasGreeting(name) {
  if (!xmasOn()) return null;
  const d = seasonNow(), m = d.getMonth(), n = d.getDate();
  const say = (t, e) => `¡${t}${name ? ', ' + name : ''}! ${e}`;
  if (m === 11 && (n === 24 || n === 25)) return say('Feliz Navidad', '🎄');
  if ((m === 11 && n === 31) || (m === 0 && n === 1)) return say('Feliz Año Nuevo', '🎆');
  return null;
}

/* ---------- Nieve ----------
   Unos 36 copos en un canvas detrás de todo (z-index -1, sobre el fondo). Unos 30 cuadros por segundo, se detiene con la
   app en segundo plano, no sale en los juegos ni en el mapa, ni si el teléfono pide «reducir movimiento». */
const NO_SNOW = new Set(['s-arrows', 's-bus', 's-fruta', 's-map', 's-game', 's-pet']);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let canvas = null, ctx = null, flakes = [], raf = 0, last = 0, W = 0, H = 0, running = false;
function resize() {
  if (!canvas) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const newFlake = top => ({ x: Math.random() * W, y: top ? -10 : Math.random() * H, r: 1 + Math.random() * 2.4, s: 14 + Math.random() * 26, d: Math.random() * Math.PI * 2, o: .35 + Math.random() * .45 });
function frame(t) {
  raf = requestAnimationFrame(frame);
  if (t - last < 32) return; // ~30 cuadros por segundo para cuidar la batería
  const dt = Math.min(.1, (t - last) / 1000); last = t;
  ctx.clearRect(0, 0, W, H);
  if (document.hidden || NO_SNOW.has(document.querySelector('.screen.active')?.id)) return;
  const light = document.body.dataset.theme === 'light';
  for (const f of flakes) {
    f.y += f.s * dt; f.d += dt * .8; f.x += Math.sin(f.d) * 10 * dt;
    if (f.y > H + 6) Object.assign(f, newFlake(true));
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = light ? `rgba(150, 175, 205, ${f.o})` : `rgba(255, 255, 255, ${f.o})`; ctx.fill();
  }
}
function snow(onNow) {
  const want = onNow && !reduce.matches;
  if (want === running) return;
  running = want;
  if (!want) { cancelAnimationFrame(raf); canvas?.remove(); canvas = null; return; }
  canvas = document.createElement('canvas'); canvas.id = 'snowfx'; canvas.setAttribute('aria-hidden', 'true');
  document.getElementById('bgfx')?.after(canvas);
  ctx = canvas.getContext('2d'); resize();
  flakes = Array.from({ length: 36 }, () => newFlake(false));
  last = performance.now(); raf = requestAnimationFrame(frame);
}
addEventListener('resize', resize);
reduce.addEventListener?.('change', () => applySeason());

/* ---------- Aplicar ---------- */
export function applySeason() {
  const onNow = S.me ? xmasOn() : xmasSeason() && (() => { try { return localStorage.getItem('futari-xmas') !== '0'; } catch { return true; } })();
  document.body.classList.toggle('xmas', onNow);
  try { localStorage.setItem('futari-xmas', onNow ? '1' : '0'); } catch {}
  snow(onNow);
}
on('profiles', applySeason);
applySeason();
