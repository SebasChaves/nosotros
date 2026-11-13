// Registro de ingresos y errores para el panel de administración.
// Ingreso = abrir la app (o volver a ella después de 20 minutos sin usarla). Se avisa a los dos en Ajustes.
import { setDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, newRef, ref, dayKey, todayKey } from './core.js';

const GAP = 20 * 60 * 1000;
// Navegador: el orden importa (Samsung Internet, Edge y otros también dicen "Chrome" en su identificación).
function browserOf(ua) {
  const m = (re, name) => { const r = ua.match(re); return r ? `${name} ${r[1].split('.')[0]}` : null; };
  return m(/SamsungBrowser\/([\d.]+)/, 'Samsung Internet') || m(/EdgA?\/([\d.]+)/, 'Edge') || m(/OPR\/([\d.]+)/, 'Opera')
    || m(/FxiOS\/([\d.]+)/, 'Firefox') || m(/Firefox\/([\d.]+)/, 'Firefox') || m(/CriOS\/([\d.]+)/, 'Chrome')
    || (/; wv\)/.test(ua) ? 'Navegador dentro de otra app' : null) || m(/Chrome\/([\d.]+)/, 'Chrome')
    || (/iphone|ipad|ipod|macintosh/i.test(ua) ? m(/Version\/([\d.]+)/, 'Safari') || 'Safari' : 'Otro');
}
function osVersionOf(ua) {
  const a = ua.match(/Android ([\d.]+)/); if (a) return a[1].split('.')[0];
  const i = ua.match(/OS (\d+)[_.](\d+)/); if (i && /iphone|ipad|ipod/i.test(ua)) return `${i[1]}.${i[2]}`;
  return '';
}
// Modelo del teléfono (Chrome en Android lo da aparte; Samsung empieza con "SM-").
let model = '';
navigator.userAgentData?.getHighEntropyValues?.(['model']).then(v => { model = v.model || ''; }).catch(() => {});
const modelName = m => !m ? '' : /^SM-/i.test(m) ? `Samsung ${m}` : m;

export const device = () => {
  const ua = navigator.userAgent;
  const os = /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Otro';
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // Si el navegador no da el modelo aparte (Samsung Internet), se busca en su identificación ("Android 14; SAMSUNG SM-S918B").
  const fromUa = (ua.match(/Android [\d.]+; (?:SAMSUNG )?([^;)]+)/i)?.[1] || '').trim();
  const m = model || (fromUa && fromUa !== 'K' ? fromUa : '');
  return { os, installed, osVersion: osVersionOf(ua), browser: browserOf(ua), model: modelName(m), app: window.FUTARI_VERSION || '' };
};

export function logVisit(force = false) {
  if (!S.me) return;
  let last = 0; try { last = Number(localStorage.getItem('futari-last-visit-' + S.me.uid)) || 0; } catch {}
  const now = Date.now();
  if (!force && now - last < GAP) return;
  try { localStorage.setItem('futari-last-visit-' + S.me.uid, String(now)); } catch {}
  const d = new Date(now);
  // Se espera un momento para tener el modelo del teléfono (llega aparte).
  setTimeout(() => setDoc(newRef('visits'), { uid: S.me.uid, at: now, day: dayKey(d), hour: d.getHours(), min: d.getMinutes(), ...device() }).catch(() => {}), 600);
}

// Errores de la app (máximo 10 por sesión), para encontrarlos sin tener el teléfono a mano.
let sent = 0;
function logError(message, where) {
  if (!S.me || sent >= 10 || !message) return;
  sent++;
  const screen = document.querySelector('.screen.active')?.id || '', dv = device();
  setDoc(newRef('errors'), { uid: S.me.uid, at: Date.now(), message: String(message).slice(0, 300), where: String(where || '').slice(0, 200), screen,
    os: dv.os, browser: dv.browser, app: dv.app }).catch(() => {});
}
addEventListener('error', e => logError(e.message, `${e.filename?.split('/').pop() || ''}:${e.lineno || ''}`));
addEventListener('unhandledrejection', e => logError(e.reason?.message || e.reason, 'promesa'));

// Al volver a la app después de un rato cuenta como nuevo ingreso
document.addEventListener('visibilitychange', () => { if (!document.hidden) logVisit(); });

/* ---------- Tiempo en la app por sección (Administración → Estadísticas) ---------- */
// Cada 5 segundos con la app a la vista se suma a la pantalla abierta. Se guarda al salir de la app o cada 5 minutos
// en "usage/<día>_<uid>": { uid, day, total, secs: { home: 120, moments: 30, … } } (en segundos).
let acc = {}, accTotal = 0;
setInterval(() => {
  if (document.hidden || !S.me) return;
  const s = document.querySelector('.screen.active')?.id?.replace(/^s-/, '');
  if (!s) return;
  acc[s] = (acc[s] || 0) + 5; accTotal += 5;
}, 5000);
function flushUsage() {
  if (!S.me || !accTotal) return;
  const day = todayKey(), secs = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, increment(v)]));
  setDoc(ref('usage', `${day}_${S.me.uid}`), { uid: S.me.uid, day, total: increment(accTotal), secs }, { merge: true }).catch(() => {});
  acc = {}; accTotal = 0;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushUsage(); });
addEventListener('pagehide', flushUsage);
setInterval(flushUsage, 5 * 60e3);
