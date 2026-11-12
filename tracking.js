// Registro de ingresos y errores para el panel de administración.
// Ingreso = abrir la app (o volver a ella después de 20 minutos sin usarla). Se avisa a los dos en Ajustes.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, newRef, dayKey } from './core.js';

const GAP = 20 * 60 * 1000;
export const device = () => {
  const ua = navigator.userAgent;
  const os = /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Otro';
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return { os, installed };
};

export function logVisit(force = false) {
  if (!S.me) return;
  let last = 0; try { last = Number(localStorage.getItem('futari-last-visit-' + S.me.uid)) || 0; } catch {}
  const now = Date.now();
  if (!force && now - last < GAP) return;
  try { localStorage.setItem('futari-last-visit-' + S.me.uid, String(now)); } catch {}
  const d = new Date(now), { os, installed } = device();
  setDoc(newRef('visits'), { uid: S.me.uid, at: now, day: dayKey(d), hour: d.getHours(), min: d.getMinutes(), os, installed }).catch(() => {});
}

// Errores de la app (máximo 10 por sesión), para encontrarlos sin tener el teléfono a mano.
let sent = 0;
function logError(message, where) {
  if (!S.me || sent >= 10 || !message) return;
  sent++;
  const screen = document.querySelector('.screen.active')?.id || '';
  setDoc(newRef('errors'), { uid: S.me.uid, at: Date.now(), message: String(message).slice(0, 300), where: String(where || '').slice(0, 200), screen, os: device().os }).catch(() => {});
}
addEventListener('error', e => logError(e.message, `${e.filename?.split('/').pop() || ''}:${e.lineno || ''}`));
addEventListener('unhandledrejection', e => logError(e.reason?.message || e.reason, 'promesa'));

// Al volver a la app después de un rato cuenta como nuevo ingreso
document.addEventListener('visibilitychange', () => { if (!document.hidden) logVisit(); });
