// Bloqueo con PIN opcional. Se guarda solo en este teléfono (una huella del PIN, nunca el PIN), por cuenta.
import { signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { $, S, auth, icon, expose, toast, ask, uid } from './core.js';

const KEY = () => `futari-pin-${uid()}`;
const AFTER_MS = 60 * 1000; // se vuelve a pedir si la app estuvo en segundo plano más de 1 minuto
let hiddenAt = 0, entry = '', mode = null, firstPin = '', fails = 0, waitUntil = 0;

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY())); } catch { return null; } };
export const pinEnabled = () => !!(S.me && saved());
async function hash(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function screen(title, sub = '') {
  let el = $('lockScreen');
  if (!el) { el = document.createElement('div'); el.id = 'lockScreen'; el.className = 'lock'; document.body.appendChild(el); }
  el.innerHTML = `<div class="lock-box" role="dialog" aria-modal="true" aria-labelledby="lockTitle">
    <svg viewBox="12 18 76 64" width="56" height="47" aria-hidden="true"><path d="M47.5 36 C47.5 28 41 22 33 22 C23 22 17 30 17 39 C17 56 35.5 66 47.5 78Z" fill="#FF5C8A"/><path d="M52.5 36 C52.5 28 59 22 67 22 C77 22 83 30 83 39 C83 56 64.5 66 52.5 78Z" fill="#FFB547"/></svg>
    <h2 id="lockTitle">${title}</h2><p class="small muted" id="lockSub">${sub}</p>
    <div class="lock-dots" id="lockDots">${[0, 1, 2, 3].map(i => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="lock-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button onclick="pinKey('${n}')">${n}</button>`).join('')}
      ${mode === 'unlock' ? '<button class="txt" onclick="pinForgot()">Olvidé</button>' : '<button class="txt" onclick="pinCancel()">Cancelar</button>'}
      <button onclick="pinKey('0')">0</button><button class="txt" aria-label="Borrar" onclick="pinKey('del')">${icon('back')}</button></div></div>`;
}
const dots = () => { const d = $('lockDots'); if (d) d.innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join(''); };
const shake = msg => { const b = document.querySelector('.lock-box'); b?.classList.remove('shake'); void b?.offsetWidth; b?.classList.add('shake'); if (msg) $('lockSub').textContent = msg; navigator.vibrate?.(120); };
const close = () => { $('lockScreen')?.remove(); mode = null; entry = ''; };

export function lockNow() { if (!pinEnabled() || mode === 'unlock') return; mode = 'unlock'; entry = ''; screen('Futari está bloqueada', 'Ingresa tu PIN'); }
export function setupPin() { mode = 'new'; entry = ''; firstPin = ''; screen('Crea tu PIN', 'Elige 4 números'); }
async function pinKey(k) {
  if (Date.now() < waitUntil) return;
  if (k === 'del') { entry = entry.slice(0, -1); return dots(); }
  if (entry.length >= 4) return;
  entry += k; dots();
  if (entry.length < 4) return;
  await new Promise(r => setTimeout(r, 120));
  if (mode === 'new') { firstPin = entry; entry = ''; mode = 'confirm'; screen('Repite tu PIN', 'Para confirmar'); return; }
  if (mode === 'confirm') {
    if (entry !== firstPin) { entry = ''; mode = 'new'; dots(); return shake('No coinciden. Elige tu PIN otra vez'); }
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
    try { localStorage.setItem(KEY(), JSON.stringify({ salt, hash: await hash(entry, salt) })); } catch {}
    close(); toast('Bloqueo con PIN activado'); window.rerenderSettings?.(); return;
  }
  if (mode === 'unlock' || mode === 'disable') {
    const s = saved();
    if (s && await hash(entry, s.salt) === s.hash) {
      fails = 0;
      if (mode === 'disable') { try { localStorage.removeItem(KEY()); } catch {} toast('Bloqueo con PIN desactivado'); window.rerenderSettings?.(); }
      return close();
    }
    entry = ''; dots(); fails++;
    if (fails >= 5) { waitUntil = Date.now() + 30000; shake('Demasiados intentos. Espera 30 segundos'); setTimeout(() => { if ($('lockSub')) $('lockSub').textContent = 'Ingresa tu PIN'; }, 30000); }
    else shake(`PIN incorrecto (${5 - fails} intentos más)`);
  }
}
function pinCancel() { close(); }
export function disablePin() { mode = 'disable'; entry = ''; screen('Desactivar bloqueo', 'Ingresa tu PIN actual'); }
async function pinForgot() {
  if (!(await ask('¿Olvidaste tu PIN? Se cerrará la sesión en este teléfono y se quitará el PIN. Para volver a entrar necesitas tu correo y contraseña.', { ok: 'Cerrar sesión', danger: true }))) return;
  try { localStorage.removeItem(KEY()); } catch {}
  close(); signOut(auth);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > AFTER_MS) lockNow();
});

expose({ pinKey, pinCancel, pinForgot, setupPin, disablePin });
