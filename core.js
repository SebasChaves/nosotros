// Núcleo compartido: Firebase, estado, utilidades de interfaz y fechas.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
         connectFirestoreEmulator, doc, collection, getDoc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ================= Interfaz ================= */
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}
// Ventana de confirmación con el estilo de la app (reemplaza confirm() del navegador).
// Uso: if (!(await ask('¿Borrar esta nota?'))) return;
export function ask(message, opts = {}) {
  const m = /^¿(Borrar|Quitar|Cerrar sesión)/.exec(message);
  const danger = opts.danger ?? !!m;
  const ok = opts.ok || (m ? m[1] : 'Sí');
  const cancel = opts.cancel || (m ? 'Cancelar' : 'No');
  return new Promise(resolve => {
    const prev = document.activeElement;
    const el = document.createElement('div');
    el.className = 'dialog';
    el.innerHTML = `<div class="box" role="alertdialog" aria-modal="true" aria-labelledby="dlgMsg">
      <p id="dlgMsg">${esc(message)}</p>
      <div class="grid2"><button class="btn ghost" data-v="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-v="1">${esc(ok)}</button></div></div>`;
    let closed = false;
    const done = v => {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', key, true); el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160);
      prev?.focus?.({ preventScroll: true }); resolve(v);
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    // Cada botón tiene su propio manejador (más confiable en iPhone que escuchar en el fondo).
    el.querySelectorAll('button[data-v]').forEach(b => { b.onclick = e => { e.stopPropagation(); done(b.dataset.v === '1'); }; });
    el.addEventListener('click', e => { if (e.target === el) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(el);
    syncBack();
  });
}

export function openSheet(html) {
  $('sheetBody').innerHTML = html;
  const p = $('sheet').querySelector('.panel'); p.style.transform = p.style.transition = ''; p.scrollTop = 0;
  $('sheet').classList.add('show'); syncBack();
}
export function closeSheet() { $('sheet').classList.remove('show'); syncBack(); }

/* ================= Atrás (botón y gesto de Android) =================
   Mientras haya algo que cerrar o una pantalla a la que volver, se deja una entrada en el historial.
   Al tocar "atrás", el teléfono la consume y aquí se cierra lo de arriba o se vuelve una pantalla. */
let guarded = false, silentPop = false;
const topDialog = () => document.querySelector('.dialog:not(.out)');
const overlayOpen = () => !!(topDialog() || $('viewer')?.classList.contains('show') || $('sheet')?.classList.contains('show') || document.querySelector('.tour'));
function backTarget() {
  const s = document.querySelector('.screen.active');
  if (!s || s.id === 's-home') return null;
  const b = s.querySelector('.topbar [aria-label="Volver"]');
  if (inBar(s.id)) return 's-home';
  if (b) return b;
  return null;
}
const canGoBack = () => document.body.classList.contains('in') && !$('lockScreen') && (overlayOpen() || !!backTarget());
export function goBack() {
  const d = topDialog();
  if (d) return d.querySelector('button[data-v="0"]')?.click();
  if ($('viewer').classList.contains('show')) return closeViewer();
  if ($('sheet').classList.contains('show')) return closeSheet();
  if (document.querySelector('.tour')) return;
  const t = backTarget();
  if (typeof t === 'string') go(t); else t?.click();
}
let syncT = null;
export function syncBack() {
  clearTimeout(syncT);
  syncT = setTimeout(() => {
    if (silentPop) return syncBack();
    const need = canGoBack();
    if (need && !guarded) { history.pushState({ futari: 1 }, ''); guarded = true; }
    else if (!need && guarded) { guarded = false; silentPop = true; history.back(); }
  }, 30);
}
addEventListener('popstate', () => {
  if (silentPop) { silentPop = false; return; }
  guarded = false;
  goBack();
  syncBack();
});

/* ================= Hoja de abajo: se cierra arrastrándola hacia abajo ================= */
function sheetDrag() {
  const sheet = $('sheet'), panel = sheet?.querySelector('.panel');
  if (!panel) return;
  let y0 = null, dy = 0, t0 = 0, dragging = false;
  panel.addEventListener('touchstart', e => {
    y0 = null;
    if (e.touches.length !== 1 || panel.scrollTop > 0 || e.target.closest('.chips.scroll, .map-box, input[type=range]')) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); dragging = false;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (!dragging) {
      if (dy > 8 && panel.scrollTop <= 0) { dragging = true; panel.style.transition = 'none'; document.activeElement?.blur?.(); }
      else { if (dy < -4) y0 = null; return; }
    }
    e.preventDefault();
    panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 == null) return; y0 = null;
    if (!dragging) return; dragging = false;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    panel.style.transition = 'transform .22s ease';
    if (dy > 120 || (fast && dy > 40)) { panel.style.transform = 'translateY(110%)'; setTimeout(closeSheet, 200); }
    else panel.style.transform = '';
  };
  panel.addEventListener('touchend', end); panel.addEventListener('touchcancel', end);
}

/* ================= Visor de fotos: botón cerrar y deslizar hacia abajo ================= */
export function closeViewer() { $('viewer').classList.remove('show'); $('viewerImg').style.transform = ''; syncBack(); }
function viewerDrag() {
  const v = $('viewer'), img = $('viewerImg');
  if (!v) return;
  let y0 = null, dy = 0;
  v.addEventListener('touchstart', e => { y0 = e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; img.style.transition = 'none'; }, { passive: true });
  v.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0; e.preventDefault();
    img.style.transform = `translateY(${dy}px) scale(${1 - Math.min(Math.abs(dy), 300) / 1500})`;
    v.style.background = `rgba(0,0,0,${1 - Math.min(Math.abs(dy), 300) / 450})`;
  }, { passive: false });
  v.addEventListener('touchend', () => {
    if (y0 == null) return; y0 = null;
    img.style.transition = 'transform .2s ease'; v.style.background = '';
    if (Math.abs(dy) > 90) closeViewer(); else img.style.transform = '';
  });
}

/* ================= Deslizar entre las pestañas principales ================= */
const NO_SWIPE = 'input, textarea, select, .chips.scroll, .map-box, .leaflet-container, .noswipe, .lock';
function hasHScroll(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) { const o = getComputedStyle(el).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
}
let sw = null;
document.addEventListener('touchstart', e => {
  sw = null;
  if (e.touches.length !== 1 || !document.body.classList.contains('in') || overlayOpen()) return;
  const s = document.querySelector('.screen.active');
  if (!s || !inBar(s.id) || !e.target.closest?.('main') || e.target.closest(NO_SWIPE) || hasHScroll(e.target)) return;
  const t = e.touches[0];
  if (t.clientX < 22 || t.clientX > innerWidth - 22) return; // los bordes son del gesto "atrás" del teléfono
  sw = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!sw) return;
  const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 800 || overlayOpen()) return;
  const ids = barIds(), cur = ids.indexOf(document.querySelector('.screen.active')?.id);
  const next = ids[cur + (dx < 0 ? 1 : -1)];
  if (cur >= 0 && next) go(next);
}, { passive: true });

/* ================= Teléfonos: elegir entre cámara y galería =================
   El selector nuevo de Android no ofrece la cámara, así que se pregunta antes de abrirlo.
   "Tomar foto" abre la cámara propia de Futari (abajo); si no se puede, la del teléfono. */
export const ANDROID = /Android/i.test(navigator.userAgent);
export const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Pasa el archivo elegido al <input> original como si el usuario lo hubiera escogido ahí.
function deliverFile(input, f) {
  const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
// Abre el selector del sistema (galería, o la cámara del teléfono con capture). Debe llamarse dentro de un toque.
export function nativePick(accept, capture, onFile) {
  const tmp = document.createElement('input');
  tmp.type = 'file'; tmp.accept = accept || 'image/*'; tmp.hidden = true; tmp.dataset.direct = '1';
  if (capture) tmp.setAttribute('capture', capture);
  tmp.onchange = () => { const f = tmp.files[0]; tmp.remove(); if (f) onFile(f); };
  document.body.appendChild(tmp); tmp.click();
}
function chooseImageSource(input) {
  const el = document.createElement('div');
  el.className = 'dialog';
  el.innerHTML = `<div class="box stack" role="dialog" aria-modal="true" aria-label="Agregar foto" style="gap:10px">
    <button class="btn" data-src="camera">📷 Tomar foto</button><button class="btn ghost" data-src="gallery">🖼️ Elegir de la galería</button>
    <button class="btn ghost" data-v="0">Cancelar</button></div>`;
  const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); };
  el.querySelector('[data-v="0"]').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); });
  el.querySelectorAll('[data-src]').forEach(b => b.onclick = () => {
    close();
    if (b.dataset.src === 'gallery') return nativePick(input.accept, null, f => deliverFile(input, f));
    if (navigator.mediaDevices?.getUserMedia) openCamera(input.accept, f => deliverFile(input, f));
    else nativePick(input.accept, 'environment', f => deliverFile(input, f));
  });
  document.body.appendChild(el); syncBack();
}
if (ANDROID || IOS) document.addEventListener('click', e => {
  const t = e.target;
  const input = t.matches?.('input[type=file]') ? t : t.closest?.('label')?.querySelector('input[type=file]');
  if (!input || !/image/.test(input.accept || '') || input.hasAttribute('capture') || input.dataset.direct) return;
  e.preventDefault(); e.stopPropagation();
  chooseImageSource(input);
}, true);

/* ================= Cámara propia =================
   La cámara del teléfono tarda en disparar y guarda las selfies en espejo. Esta toma el cuadro del video
   al instante y guarda la foto tal como se ve en pantalla; "⇋ Espejo" la voltea. Recuerda la última
   cámara (adelante/atrás) y, para cada una, si el espejo estaba puesto (localStorage "futari-cam"). */
const camPref = () => { try { return JSON.parse(localStorage.getItem('futari-cam')) || {}; } catch { return {}; } };
const saveCamPref = p => { try { localStorage.setItem('futari-cam', JSON.stringify({ ...camPref(), ...p })); } catch {} };
export function openCamera(accept, onFile) {
  let facing = camPref().facing || 'environment', mirror = !!camPref()['mirror_' + facing], stream = null, review = false, closed = false, multi = true;
  const el = document.createElement('div');
  el.className = 'dialog cam';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Cámara');
  el.innerHTML = `<div class="cam-view"><video playsinline autoplay muted></video><canvas hidden></canvas>
      <div class="cam-msg" hidden><p></p><button class="btn" data-a="native">📷 Usar la cámara del teléfono</button></div></div>
    <button class="cam-x" data-v="0" aria-label="Cerrar cámara">${icon('x')}</button>
    <div class="cam-bar">
      <button class="cam-btn" data-a="mirror" aria-label="Espejo" aria-pressed="false"><span>⇋</span><small>Espejo</small></button>
      <button class="cam-shoot" data-a="shoot" aria-label="Tomar foto"></button>
      <button class="cam-btn" data-a="flip" aria-label="Cambiar de cámara"><span>🔄</span><small>Girar</small></button>
    </div>
    <div class="cam-bar" data-review hidden>
      <button class="cam-btn" data-a="mirror" aria-label="Espejo" aria-pressed="false"><span>⇋</span><small>Espejo</small></button>
      <button class="btn ghost" data-a="retake">Repetir</button><button class="btn" data-a="use">Usar foto</button>
    </div>`;
  const video = el.querySelector('video'), canvas = el.querySelector('canvas'), msg = el.querySelector('.cam-msg');
  const [liveBar, reviewBar] = el.querySelectorAll('.cam-bar');
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const paintMirror = () => {
    el.classList.toggle('mirror', mirror);
    el.querySelectorAll('[data-a="mirror"]').forEach(b => b.setAttribute('aria-pressed', mirror));
  };
  const showFail = text => {
    stop(); msg.hidden = false; msg.querySelector('p').textContent = text;
    video.hidden = true; liveBar.hidden = true; reviewBar.hidden = true;
  };
  async function start() {
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (closed || review) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; video.srcObject = s; video.hidden = false; msg.hidden = true;
      await video.play().catch(() => {});
      // Una sola cámara (por ejemplo en computadora): no tiene sentido el botón de girar
      const cams = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
      multi = cams.filter(d => d.kind === 'videoinput').length !== 1;
      el.querySelector('[data-a="flip"]').style.visibility = multi ? '' : 'hidden';
    } catch (e) {
      if (closed) return;
      showFail(e?.name === 'NotAllowedError'
        ? 'Futari no tiene permiso para usar la cámara. Puedes darle permiso en los ajustes del navegador, o usar la cámara del teléfono.'
        : 'No se pudo abrir la cámara. Puedes usar la del teléfono.');
    }
  }
  function close() {
    if (closed) return; closed = true; stop();
    document.removeEventListener('visibilitychange', onVis);
    el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160);
  }
  // Al salir de la app se apaga la cámara; al volver, se prende otra vez.
  const onVis = () => { if (document.hidden) stop(); else if (!review && msg.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);
  function shoot() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    // La foto se guarda como se ve: con espejo solo si está puesto
    if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0, w, h);
    g.setTransform(1, 0, 0, 1, 0, 0);
    review = true; stop();
    canvas.hidden = false; video.hidden = true; liveBar.hidden = true; reviewBar.hidden = false;
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 220);
    navigator.vibrate?.(15);
  }
  function retake() {
    review = false; canvas.hidden = true; liveBar.hidden = false; reviewBar.hidden = true; start();
  }
  function flipShot() {
    // Ya tomada: voltea la foto misma
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(canvas, 0, 0);
    canvas.getContext('2d').drawImage(c, 0, 0);
  }
  el.querySelector('[data-v="0"]').onclick = close;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'shoot') shoot();
    else if (a === 'retake') retake();
    else if (a === 'flip') { facing = facing === 'user' ? 'environment' : 'user'; mirror = !!camPref()['mirror_' + facing]; saveCamPref({ facing }); paintMirror(); start(); }
    else if (a === 'mirror') { mirror = !mirror; saveCamPref({ ['mirror_' + facing]: mirror }); paintMirror(); if (review) flipShot(); }
    else if (a === 'native') { close(); nativePick(accept, facing, onFile); }
    else if (a === 'use') {
      b.disabled = true;
      canvas.toBlob(blob => { close(); if (blob) onFile(new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })); }, 'image/jpeg', 0.92);
    }
  });
  paintMirror();
  document.body.appendChild(el); syncBack();
  start();
}

sheetDrag(); viewerDrag(); // los módulos corren cuando el HTML ya está listo

// Repinta un contenedor sin perder lo que el usuario está escribiendo (valores y foco por id).
export function paint(target, html) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const keep = {};
  el.querySelectorAll('input[id],textarea[id],select[id]').forEach(i => {
    if (i.type === 'file' || 'fresh' in i.dataset) return;
    keep[i.id] = i.type === 'checkbox' ? i.checked : i.value;
  });
  const a = document.activeElement;
  let focusId = null, sel = null;
  if (a && el.contains(a) && a.id) { focusId = a.id; try { sel = [a.selectionStart, a.selectionEnd]; } catch {} }
  el.innerHTML = html;
  for (const [id, v] of Object.entries(keep)) {
    const i = el.querySelector('#' + CSS.escape(id));
    if (!i || 'fresh' in i.dataset) continue;
    if (i.type === 'checkbox') i.checked = v; else i.value = v;
  }
  if (focusId) {
    const f = el.querySelector('#' + CSS.escape(focusId));
    if (f) { f.focus({ preventScroll: true }); try { if (sel && sel[0] != null) f.setSelectionRange(...sel); } catch {} }
  }
}

// Funciones que los botones del HTML llaman con onclick="...".
export const expose = fns => Object.assign(window, fns);

/* ================= Navegación ================= */
const showHooks = {};
export const onShow = (id, fn) => { showHooks[id] = fn; };
/* ---------- Barra de abajo (cada uno la arma en Ajustes → Tu menú; menu.js) ----------
   Inicio y Más siempre están; en medio van de 1 a 4 secciones (prefs.menu en el perfil, copia en localStorage
   para pintarla antes de que cargue la base). Una pantalla "pertenece" a la pestaña de la barra a la que vuelve su
   botón Volver (tabOf); si no está en la barra, a Más. */
// [pantalla, ícono del sprite, nombre]: todas las secciones que pueden ir en la barra o en Más
export const SECTIONS = [['s-decide', 'dice', '¿Qué hacemos?'], ['s-moments', 'photo', 'Momentos'], ['s-love', 'gift', 'Detalles'],
  ['s-cravings', 'crave', 'Antojos'], ['s-grocery', 'cart', 'Súper'], ['s-money', 'wallet', 'Gastos'], ['s-trips', 'plane', 'Viajes'],
  ['s-places', 'fork', 'Restaurantes'], ['s-shows', 'film', 'Pelis y series'], ['s-cal', 'cal', 'Calendario'],
  ['s-reminders', 'bell', 'Recordatorios'], ['s-recipes', 'pot', 'Recetas'], ['s-map', 'map', 'Nuestro mapa'],
  ['s-music', 'music', 'Su playlist'], ['s-pet', 'paw', 'Su mascota'], ['s-badges', 'medal', 'Logros'], ['s-game', 'flame', 'Juego de retos'],
  ['s-us', 'heart', 'Gustos y regalos'], ['s-quiz', 'brain', '¿Cuánto me conoces?'], ['s-bucket', 'list', 'Bucket list'],
  ['s-summary', 'spark', 'Resumen del año'], ['s-arrows', 'arrow', 'Flechas'], ['s-admin', 'admin', 'Administración']];
// Secciones o avisos que no todos ven todavía (por ejemplo una sorpresa que el dueño pone desde Administración).
// gates[clave] = () => true/false; claves: id de pantalla ('s-arrows') o 'notif:<tipo>'. Sin gate = siempre visible.
export const gates = {};
export const gateOn = key => !gates[key] || !!gates[key]();
export const BAR_DEFAULT = ['s-decide', 's-moments', 's-love'], BAR_MAX = 4;
// Las que eran pestañas fijas: si alguien las saca de la barra, muestran su propio botón Volver (a Más)
const OLD_TABS = new Set(BAR_DEFAULT);
// (Antes de iniciar sesión no se aplican los gates: todavía no se sabe quién es, y la barra guardada se respeta)
const validBar = v => Array.isArray(v) ? [...new Set(v)].filter(id => SECTIONS.some(([k]) => k === id) && (!S.me || gateOn(id))).slice(0, BAR_MAX) : [];
let barMid = (() => { try { const v = validBar(JSON.parse(localStorage.getItem('futari-bar') || 'null')); return v.length ? v : BAR_DEFAULT; } catch { return BAR_DEFAULT; } })();
export const barIds = () => ['s-home', ...barMid, 's-more'];
export const inBar = id => barIds().includes(id);
export function setBar(mid) {
  const v = validBar(mid), next = v.length ? v : BAR_DEFAULT;
  try { localStorage.setItem('futari-bar', JSON.stringify(next)); } catch {}
  const nav = document.querySelector('.tabbar');
  const same = next.join() === barMid.join() && nav?.querySelectorAll('button').length === next.length + 2;
  barMid = next;
  document.querySelectorAll('main > .screen').forEach(x => x.classList.toggle('in-bar', inBar(x.id) && x.id !== 's-home' && x.id !== 's-more'));
  if (!nav || same) return false;
  const btn = (id, ic, label) => `<button data-tab="${id}" onclick="go('${id}')" aria-label="${label}"><svg><use href="#i-${ic}"/></svg><b class="dot" id="dot-${id.slice(2)}" hidden></b></button>`;
  nav.innerHTML = '<span class="pill" aria-hidden="true"></span>' + btn('s-home', 'heart', 'Inicio')
    + barMid.map(id => { const [, ic, label] = SECTIONS.find(([k]) => k === id); return btn(id, ic, label); }).join('') + btn('s-more', 'grid', 'Más');
  nav.style.setProperty('--n', barMid.length + 2);
  markTab(); return true;
}
// Barra superior de las pantallas que pueden ser pestaña o no (Decidir, Momentos, Detalles)
export const mainTop = (id, title, extra = '') => inBar(id) || !OLD_TABS.has(id)
  ? `<div class="topbar"><h1>${title}</h1>${extra}</div>`
  : `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-more')">${icon('back')}</button><h1>${title}</h1></div>${extra}</div>`;
// Pestaña de la barra a la que pertenece una pantalla
function tabOf(s, depth = 0) {
  if (!s || s.id === 's-search') return null;
  if (inBar(s.id)) return s.id;
  const m = s.querySelector('.topbar [aria-label="Volver"]')?.getAttribute('onclick')?.match(/go\('([^']+)'\)/);
  if (m && m[1] !== s.id && depth < 4 && $(m[1])) return tabOf($(m[1]), depth + 1);
  return s.dataset.tab === 'home' ? 's-home' : 's-more';
}
function markTab() {
  const t = tabOf(document.querySelector('.screen.active'));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  placeTabPill();
}
const SLIDE_EASE = 'cubic-bezier(.22,.8,.24,1)';
let leaving = null;
// Dirección: 1 = la nueva entra desde la derecha; -1 = desde la izquierda.
function slideDir(from, to) {
  const ids = barIds(), tf = tabOf(from), tt = tabOf(to), a = ids.indexOf(tf), b = ids.indexOf(tt);
  if (tf !== tt && a >= 0 && b >= 0 && (inBar(to.id) || inBar(from.id))) return b > a ? 1 : -1;
  // Dentro de la misma pestaña (o la búsqueda): entrar a una sub-pantalla avanza, volver a la principal retrocede.
  if (to.id === 's-search') return 1;
  if (from.id === 's-search') return -1;
  const back = from.querySelector('.topbar [aria-label="Volver"]')?.getAttribute('onclick')?.includes(`'${to.id}'`);
  return inBar(to.id) || back ? -1 : 1;
}
export function placeTabPill() {
  const pill = document.querySelector('.tabbar .pill'), on = document.querySelector('.tabbar button.on');
  if (!pill) return;
  pill.style.opacity = on ? 1 : 0;
  if (on) pill.style.transform = `translateX(${on.offsetLeft}px)`;
}
export function go(id) {
  const s = $(id); if (!s) return;
  const old = document.querySelector('.screen.active');
  if (old === s) { window.scrollTo(0, 0); showHooks[id]?.(); return; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  leaving?.(); // si se toca rápido, termina la animación anterior
  if (old && !reduce && document.body.classList.contains('in')) {
    // La pantalla que sale queda "flotando" en su lugar mientras se desliza hacia afuera.
    const y = window.scrollY, rect = { top: old.offsetTop - y, left: old.offsetLeft, width: old.offsetWidth };
    old.classList.add('leaving');
    Object.assign(old.style, { top: rect.top + 'px', left: rect.left + 'px', width: rect.width + 'px' });
    const dir = slideDir(old, s);
    const outA = old.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-dir * 30}%)`, opacity: 0 }], { duration: 300, easing: SLIDE_EASE });
    const cleanup = () => { leaving = null; outA.cancel(); old.classList.remove('leaving'); old.style.top = old.style.left = old.style.width = ''; };
    leaving = cleanup; outA.finished.then(() => leaving === cleanup && cleanup()).catch(() => {});
    document.querySelectorAll('.screen').forEach(x => x.classList.toggle('active', x === s));
    s.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0)' }], { duration: 340, easing: SLIDE_EASE });
  } else {
    document.querySelectorAll('.screen').forEach(x => x.classList.toggle('active', x === s));
  }
  window.scrollTo(0, 0);
  showHooks[id]?.();
  markTab(); // después de pintar: la pestaña se deduce del botón Volver de la pantalla
  syncBack();
}
addEventListener('resize', () => placeTabPill());

/* ================= Fechas ================= */
export const DAY = 86400000;
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const daysBetween = (a, b) => Math.round((b - a) / DAY);
export const fmtDate = d => d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
export const fmtShort = d => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
export const fmtDay = d => d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayKey = () => dayKey(today());
export const whenText = left => left === 0 ? '¡Hoy!' : left === 1 ? 'Mañana' : left < 0 ? `hace ${-left} días` : `en ${left} días`;
export function addMonths(date, n) { // 31 ene + 1 mes = 28/29 feb
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}
// Semana ISO, p. ej. "2026-W46"
export function weekKey(d = today()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
export const epochDay = (d = today()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);

/* ================= Firebase ================= */
// Modo de prueba: en localhost con ?emu usa el emulador local de Firebase, nunca la base real.
export const EMU = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu');
export const configured = EMU || (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'PEGAR_AQUI');
export const app = configured ? initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-nosotros', authDomain: 'localhost' } : firebaseConfig) : null;
export const auth = app && getAuth(app);
export const db = app && initializeFirestore(app, EMU
  ? { localCache: memoryLocalCache() }
  : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (EMU) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
export const COUPLE = 'nosotros';
export const coupleRef = db && doc(db, 'couples', COUPLE);
export const col = name => collection(db, 'couples', COUPLE, name);
export const ref = (name, id) => doc(col(name), id);
export const newRef = name => doc(col(name));
// Datos que solo ve quien los escribe (p. ej. ideas de regalo)
export const privCol = name => collection(db, 'private', S.me.uid, name);
export const privRef = (name, id) => doc(privCol(name), id);
export const newPrivRef = name => doc(privCol(name));

// Las escrituras se aplican al instante en el teléfono y se sincronizan solas,
// así que no se espera al servidor (funciona también sin internet).
export const write = p => p.catch(err => {
  console.error(err);
  toast(err.code === 'permission-denied' ? 'Esta cuenta no tiene permiso 🔒' : 'No se pudo guardar');
});

/* ================= Estado ================= */
export const COLLECTIONS = ['bucket', 'ideas', 'notes', 'coupons', 'dates', 'moments', 'lists', 'answers',
  'moods', 'challenges', 'groceries', 'expenses', 'places', 'trips', 'quiz', 'profiles', 'shows', 'events', 'cards', 'games', 'thinks', 'daily', 'pins', 'recipes', 'recipefav', 'menu', 'songs', 'reminders', 'snaps', 'push', 'activity', 'pet', 'guess', 'cravings', 'arrows'];
export const PRIVATE = ['gifts'];
export const S = {
  me: null,
  settings: { start: '', members: {}, currency: 'USD' },
  data: Object.fromEntries(COLLECTIONS.map(c => [c, []])),
  priv: Object.fromEntries(PRIVATE.map(c => [c, []])),
};
export const uid = () => S.me?.uid;
// Estadísticas de Administración (doc "stats/<día>"): kind = 'sent' (avisos que mandaste), 'opened' (avisos que abriste)
// o 'acts' (cosas que no quedan guardadas para siempre, como instantáneas y reacciones). No se lee en vivo.
export function countStat(kind, key) {
  if (!S.me || !key) return;
  const day = todayKey();
  setDoc(ref('stats', day), { day, [kind]: { [uid()]: { [key]: increment(1) } } }, { merge: true }).catch(() => {});
}
// Marca que hoy hiciste algo en Futari (cuenta para la racha y para alimentar a la mascota). Una escritura al día.
export function markActive() {
  const k = todayKey();
  if (!S.me || S.data.activity.find(x => x.id === k)?.[uid()]) return;
  write(setDoc(ref('activity', k), { [uid()]: true }, { merge: true }));
}
// Si en Ajustes pusiste un apodo para tu pareja, en tu teléfono aparece con ese apodo en toda la app.
export const nameOf = id => (id && id !== S.me?.uid && profile(S.me?.uid).prefs?.partnerNick) || S.settings.members?.[id]?.name || (id === S.me?.uid ? 'Tú' : 'Tu pareja');
export const partnerUid = () => Object.keys(S.settings.members || {}).find(u => u !== S.me.uid);
export const partnerName = () => { const p = partnerUid(); return p ? nameOf(p) : 'tu pareja'; };
export const myName = () => S.settings.members?.[S.me.uid]?.name || '';
export const profile = id => S.data.profiles.find(p => p.id === id) || {};
export const initials = n => (n || '?').trim().charAt(0).toUpperCase();
// Foto de perfil (o la inicial si no hay foto). Después de pintar, llamar loadPhotos(contenedor).
export const avatar = (id, size = 36) => profile(id).avatar
  ? `<img class="av" data-photo="${esc(profile(id).avatar)}" alt="${esc(nameOf(id))}" style="width:${size}px;height:${size}px">`
  : `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px">${esc(initials(nameOf(id)))}</span>`;

export function fmtMoney(n) {
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency: S.settings.currency || 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
  } catch { return String(n); }
}

// Registro de funciones que se repintan cuando cambia una colección ('*' = siempre).
const renders = {};
export function on(keys, fn) { for (const k of keys.split(' ')) (renders[k] ??= new Set()).add(fn); }
export function rerender(key) {
  const fns = new Set([...(renders[key] || []), ...(renders['*'] || [])]);
  if (!S.me) return;
  fns.forEach(f => { try { f(); } catch (e) { console.error(e); } });
}
export function rerenderAll() {
  if (!S.me) return;
  const fns = new Set(Object.values(renders).flatMap(s => [...s]));
  fns.forEach(f => { try { f(); } catch (e) { console.error(e); } });
}

/* ================= Fotos ================= */
const photoCache = {};
export const getPhoto = id => (photoCache[id] ??= getDoc(ref('photos', id)).then(s => s.data()?.data || '').catch(() => { delete photoCache[id]; return ''; }));
export function cachePhoto(id, data) { photoCache[id] = Promise.resolve(data); }
export function forgetPhoto(id) { delete photoCache[id]; }
// Cada foto de un momento tiene una miniatura liviana (~30 KB) con id "t-<id>" para listas y galería.
export const thumbId = id => `t-${id}`;
export async function makeThumb(dataUrl, max = 480) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl; });
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
async function fillPhoto(img) {
  let src;
  if (img.dataset.thumb) {
    const id = img.dataset.thumb;
    src = await getPhoto(thumbId(id));
    if (!src) { // fotos de antes: se crea la miniatura una sola vez y se guarda
      const full = await getPhoto(id);
      if (full) { src = await makeThumb(full).catch(() => full); cachePhoto(thumbId(id), src); write(setDoc(ref('photos', thumbId(id)), { data: src })); }
    }
  } else src = await getPhoto(img.dataset.photo);
  if (src) img.src = src; else img.remove();
}
// Las fotos se cargan solo cuando están por aparecer en pantalla.
const photoIO = 'IntersectionObserver' in window
  ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { photoIO.unobserve(e.target); fillPhoto(e.target); } }), { rootMargin: '500px 0px' })
  : null;
export function loadPhotos(root) {
  root?.querySelectorAll('img[data-photo]:not([src]),img[data-thumb]:not([src])').forEach(img => photoIO ? photoIO.observe(img) : fillPhoto(img));
}
// Reduce la foto para que quepa en el plan gratis (máx. ~700 KB por foto).
// Las fotos de cámaras de 50 a 200 megapíxeles (comunes en Android) se decodifican ya reducidas,
// porque abrirlas completas puede agotar la memoria del navegador.
async function decodeSmall(file, maxSide) {
  if ('createImageBitmap' in window) {
    try {
      let bmp = await createImageBitmap(file, { resizeWidth: maxSide * 2, resizeQuality: 'high' });
      if (bmp.height > bmp.width) { bmp.close?.(); bmp = await createImageBitmap(file, { resizeHeight: maxSide * 2, resizeQuality: 'high' }); }
      return { src: bmp, w: bmp.width, h: bmp.height };
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, url };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}
export async function compressImage(file, maxSide = 1280) {
  let d;
  try { d = await decodeSmall(file, maxSide); }
  catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
    throw new Error(heic ? 'heic' : 'decode');
  }
  try {
    let max = maxSide, q = 0.8, out;
    do {
      const s = Math.min(1, max / Math.max(d.w, d.h));
      const c = document.createElement('canvas');
      c.width = Math.round(d.w * s); c.height = Math.round(d.h * s);
      c.getContext('2d').drawImage(d.src, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (q > 0.5) q -= 0.1; else max = Math.round(max * 0.8);
    } while (out.length > 700000 && max > 300);
    return out;
  } finally { if (d.url) URL.revokeObjectURL(d.url); d.src.close?.(); }
}
// Mensaje claro cuando una foto no se puede abrir.
export const photoError = e => toast(e?.message === 'heic' ? 'Esa foto está en formato HEIF. Elige otra o cambia la cámara a JPG' : 'No se pudo abrir esa foto. Prueba con otra');
// Abre la foto en grande: muestra la miniatura al instante y la cambia por la completa al cargar.
export async function viewPhoto(img) {
  $('viewerImg').src = img.src || ''; $('viewer').classList.add('show'); syncBack();
  const id = img.dataset?.thumb;
  if (id) { const full = await getPhoto(id); if (full && $('viewer').classList.contains('show')) $('viewerImg').src = full; }
}

/* ================= Celebraciones ================= */
// Lluvia corta de corazones o confeti. No hace nada si el teléfono pide menos movimiento.
export function celebrate(kind = 'confetti') {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'celebrate'; layer.setAttribute('aria-hidden', 'true');
  const pieces = kind === 'hearts' ? ['❤️', '💕', '💖', '💗', '🧡'] : null;
  const n = kind === 'hearts' ? 18 : 46;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const x = Math.random() * 100, dx = (Math.random() - .5) * 40, rot = (Math.random() - .5) * 720;
    p.style.cssText = `left:${x}vw;--dx:${dx}vw;--rot:${rot}deg;animation-delay:${Math.random() * .25}s;animation-duration:${1.1 + Math.random() * .9}s`;
    if (pieces) { p.textContent = pick(pieces); p.className = 'h'; }
    else p.style.background = pick(['var(--g1)', 'var(--g2)', 'var(--g3)', '#fff', '#5EE0A0']);
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  navigator.vibrate?.(kind === 'hearts' ? [20, 40, 20] : 30);
  setTimeout(() => layer.remove(), 2400);
}

/* ================= Sorteo animado ================= */
// Muestra opciones al azar cada vez más lento y termina en una.
export function animatePick(items, show, done) {
  let i = 0, delay = 40, last = null;
  const tick = () => {
    let p; do { p = pick(items); } while (items.length > 1 && p === last);
    last = p; show(p);
    if (++i < 16) { delay *= 1.12; setTimeout(tick, delay); } else done(p);
  };
  tick();
}

expose({ closeSheet, go, viewPhoto, closeViewer });
