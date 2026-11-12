// Núcleo compartido: Firebase, estado, utilidades de interfaz y fechas.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
         connectFirestoreEmulator, doc, collection, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
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
    const done = v => { document.removeEventListener('keydown', key, true); el.classList.add('out'); setTimeout(() => el.remove(), 160); prev?.focus?.({ preventScroll: true }); resolve(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    el.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === el) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(el);
    el.querySelector('button[data-v="1"]').focus({ preventScroll: true });
  });
}

export function openSheet(html) { $('sheetBody').innerHTML = html; $('sheet').classList.add('show'); }
export function closeSheet() { $('sheet').classList.remove('show'); }

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
export function go(id) {
  const s = $(id); if (!s) return;
  document.querySelectorAll('.screen').forEach(x => x.classList.toggle('active', x === s));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === s.dataset.tab));
  window.scrollTo(0, 0);
  showHooks[id]?.();
}

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
  'moods', 'challenges', 'groceries', 'expenses', 'places', 'trips', 'quiz', 'profiles', 'shows', 'events', 'cards', 'games', 'thinks'];
export const PRIVATE = ['gifts'];
export const S = {
  me: null,
  settings: { start: '', members: {}, currency: 'USD' },
  data: Object.fromEntries(COLLECTIONS.map(c => [c, []])),
  priv: Object.fromEntries(PRIVATE.map(c => [c, []])),
};
export const uid = () => S.me?.uid;
export const nameOf = id => S.settings.members?.[id]?.name || (id === S.me?.uid ? 'Tú' : 'Tu pareja');
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
const getPhoto = id => (photoCache[id] ??= getDoc(ref('photos', id)).then(s => s.data()?.data || '').catch(() => { delete photoCache[id]; return ''; }));
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
export async function compressImage(file, maxSide = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    let max = maxSide, q = 0.8, out;
    do {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (q > 0.5) q -= 0.1; else max = Math.round(max * 0.8);
    } while (out.length > 700000 && max > 300);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
// Abre la foto en grande: muestra la miniatura al instante y la cambia por la completa al cargar.
export async function viewPhoto(img) {
  $('viewerImg').src = img.src || ''; $('viewer').classList.add('show');
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

expose({ closeSheet, go, viewPhoto });
