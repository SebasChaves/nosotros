// Arranque: sesión, sincronización en vivo y avisos (puntitos) de la barra de abajo.
import { onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, verifyPasswordResetCode, confirmPasswordReset }
  from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { onSnapshot, disableNetwork, enableNetwork } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, auth, db, go, esc, openSheet, configured, placeTabPill, coupleRef, col, privCol, COLLECTIONS, PRIVATE, toast, expose, rerender, rerenderAll,
         partnerUid, profile, uid, ask, inBar, setBar, barIds } from './core.js';
import { todayAnswers } from './home.js';
import './decide.js';
import './love.js';
import './moments.js';
import { snapShortcut } from './snaps.js';
import { handleOpenParam } from './push.js';
import { guessWaiting } from './guess.js';
import './lists.js';
import './money.js';
import './places.js';
import './trips.js';
import './us.js';
import './cravings.js';
import './arrows.js';
import './bus.js';
import { sectionAlerts } from './menu.js';
import { urgentReminders } from './reminders.js';
import './summary.js';
import './calendar.js';
import './shows.js';
import './games.js';
import { applyAccent, applyTheme, uploadData } from './settings.js';
import './search.js';
import './admin.js';
import './recipes.js';
import './map.js';
import './music.js';
import './reminders.js';
import { startBadgeWatch } from './badges.js';
import { lockNow } from './lock.js';
import { logVisit } from './tracking.js';
import { maybeStartTour, resetTourCheck } from './tour.js';

// Versión de esta copia de la app. Súbela junto con version.json y la caché de sw.js al publicar.
export const APP_VERSION = '57';
window.FUTARI_VERSION = APP_VERSION; // lo guarda el registro de ingresos (panel de administración)

// Si la app estuvo abierta hace poco (Android la cierra sola al salir), se vuelve rápido a la misma pantalla.
const RESUME_KEY = 'futari-resume';
const resume = (() => { try { const r = JSON.parse(localStorage.getItem(RESUME_KEY)); return r && Date.now() - r.t < 30 * 60000 ? r : null; } catch { return null; } })();
addEventListener('visibilitychange', () => {
  if (!document.hidden || !S.me) return;
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ t: Date.now(), screen: document.querySelector('.screen.active')?.id })); } catch {}
});
addEventListener('pagehide', () => { if (S.me) try { localStorage.setItem(RESUME_KEY, JSON.stringify({ t: Date.now(), screen: document.querySelector('.screen.active')?.id })); } catch {} });

// La pantalla de carga se muestra al menos ~2 s para que se vea la animación (salvo con "reducir movimiento" o al volver).
const splashEnd = performance.now() + (matchMedia('(prefers-reduced-motion: reduce)').matches || resume ? 0 : 2200);
let nextState = null, stateTimer = null;
setBar(barIds().slice(1, -1)); // la barra que eligió este teléfono la última vez (menu.js la actualiza)
const applyState = s => { document.body.classList.remove('loading', 'out', 'in', 'noconfig'); document.body.classList.add(s); if (s === 'in') { requestAnimationFrame(placeTabPill); lockNow(); afterIn(); } };
const setState = s => {
  const wait = splashEnd - performance.now();
  if (document.body.classList.contains('loading') && wait > 0) {
    nextState = s;
    stateTimer ??= setTimeout(() => { stateTimer = null; applyState(nextState); }, wait);
  } else applyState(s);
};
const updateOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
addEventListener('online', updateOnline); addEventListener('offline', updateOnline); updateOnline();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- Sesión ---------- */
let unsubs = [];
if (!configured) setState('noconfig');
else onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  S.me = user; resetTourCheck();
  if (!user) { setState('out'); return; }
  setState('in');
  listen();
  snapShortcut(); // acceso directo «Instantánea» del ícono
  handleOpenParam(); // al tocar una notificación (?open=…)
});

async function login() {
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPass').value);
    $('loginPass').value = '';
  } catch (e) {
    toast({
      'auth/invalid-credential': 'Correo o contraseña incorrectos',
      'auth/invalid-email': 'Ese correo no es válido',
      'auth/too-many-requests': 'Demasiados intentos, espera un rato',
      'auth/network-request-failed': 'Sin conexión a internet',
    }[e.code] || 'No se pudo entrar');
  } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
}
let resetSentAt = 0;
async function resetPass() {
  const email = $('loginEmail').value.trim();
  if (!email) return toast('Escribe tu correo arriba primero');
  if (Date.now() - resetSentAt < 60000) return toast('Ya te lo mandamos. Usa el correo más reciente');
  try {
    await sendPasswordResetEmail(auth, email); resetSentAt = Date.now();
    ask('Te mandamos un correo para cambiar la contraseña. Ábrelo en este teléfono y usa solo el más reciente: los enlaces anteriores dejan de servir. Si no aparece, revisa la carpeta de spam.', { ok: 'Entendido', cancel: 'Cerrar' });
  } catch (e) { toast(e.code === 'auth/invalid-email' ? 'Ese correo no es válido' : e.code === 'auth/too-many-requests' ? 'Demasiados intentos, espera un rato' : 'No se pudo enviar el correo'); }
}

/* ---------- Cambiar la contraseña con el enlace del correo ---------- */
// El correo trae ?mode=resetPassword&oobCode=… cuando en Firebase la "URL de acción" apunta a esta app.
const qs = new URLSearchParams(location.search);
if (configured && qs.get('mode') === 'resetPassword' && qs.get('oobCode')) showResetGate(qs.get('oobCode'));
async function showResetGate(code) {
  const el = document.createElement('div'); el.className = 'lock'; el.id = 'resetGate';
  const paintGate = inner => { el.innerHTML = `<div class="lock-box" style="max-width:340px">${inner}</div>`; };
  const cleanUrl = () => history.replaceState(null, '', location.pathname);
  paintGate('<h2>Revisando el enlace…</h2>');
  document.body.appendChild(el);
  const fail = e => paintGate(`<div style="font-size:40px">😕</div><h2>${e?.code === 'auth/weak-password' ? 'Contraseña muy corta' : 'El enlace ya no sirve'}</h2>
    <p class="muted" style="margin:4px 0 14px;line-height:1.45">${e?.code === 'auth/weak-password' ? 'Usa al menos 6 caracteres.' : 'Ya se usó o venció. En la pantalla de entrada toca «¿Olvidaste tu contraseña?» y abre solo el correo más reciente.'}</p>
    <button class="btn" onclick="document.getElementById('resetGate').remove()">Ir a entrar</button>`);
  let email;
  try { email = await verifyPasswordResetCode(auth, code); } catch (e) { cleanUrl(); return fail(e); }
  paintGate(`<h2>Nueva contraseña</h2><p class="small muted" style="margin:4px 0 12px">Para ${esc(email)}</p>
    <input id="newPass" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres" aria-label="Nueva contraseña" style="width:100%">
    <button class="btn" id="newPassBtn" style="width:100%;margin-top:10px">Guardar contraseña</button>`);
  el.querySelector('#newPassBtn').onclick = async () => {
    const p = el.querySelector('#newPass').value;
    if (p.length < 6) return toast('Usa al menos 6 caracteres');
    el.querySelector('#newPassBtn').disabled = true;
    try {
      await confirmPasswordReset(auth, code, p); cleanUrl();
      if ($('loginEmail')) $('loginEmail').value = email;
      paintGate(`<div style="font-size:40px">✅</div><h2>¡Listo!</h2><p class="muted" style="margin:4px 0 14px">Ya puedes entrar con tu nueva contraseña.</p>
        <button class="btn" onclick="document.getElementById('resetGate').remove()">Entrar</button>`);
    } catch (e) { if (e.code === 'auth/weak-password') { el.querySelector('#newPassBtn').disabled = false; return toast('Usa al menos 6 caracteres'); } cleanUrl(); fail(e); }
  };
}

/* ---------- Sincronización ---------- */
function listen() {
  const fail = err => { console.error(err); if (err.code === 'permission-denied') toast('Esta cuenta no tiene acceso'); };
  unsubs.push(onSnapshot(coupleRef, { includeMetadataChanges: true }, snap => {
    S.settings = Object.assign({ start: '', members: {}, currency: 'USD' }, snap.data());
    rerenderAll(); updateBadges();
    if (!snap.metadata.fromCache) maybeMigrate();
  }, fail));
  for (const name of COLLECTIONS) {
    unsubs.push(onSnapshot(col(name), s => {
      S.data[name] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      if (name === 'profiles') { applyAccent(profile(uid()).prefs?.accent, profile(uid()).prefs?.customAccent); applyTheme(profile(uid()).prefs?.theme); if (!s.metadata.fromCache || profile(uid()).prefs) maybeStartTour(); }
      if (name === 'profiles') rerenderAll(); else rerender(name); // los apodos cambian nombres en toda la app
      updateBadges();
    }, fail));
  }
  for (const name of PRIVATE) {
    unsubs.push(onSnapshot(privCol(name), s => {
      S.priv[name] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      rerender(name);
    }, fail));
  }
  rerenderAll(); updateBadges();
  logVisit();
  startBadgeWatch();
}

function updateBadges() {
  if (!S.me) return;
  const setDot = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n > 9 ? '9+' : n; };
  const p = partnerUid(), ans = todayAnswers();
  setDot('dot-home', (p && ans?.answers?.[p] && !ans?.answers?.[uid()] ? 1 : 0) + (guessWaiting() ? 1 : 0) + urgentReminders().length);
  // Cada sección con avisos: su puntito en la barra si está ahí; si no, se suma al de Más (menu.js)
  let more = 0;
  for (const [id, n] of Object.entries(sectionAlerts())) { if (inBar(id)) setDot('dot-' + id.slice(2), n); else more += n; }
  setDot('dot-more', more);
}

/* ---------- Datos de la primera versión (solo en el teléfono) ---------- */
const OLD_KEY = 'nosotros-data';
let migrating = false;
async function maybeMigrate() {
  if (migrating || localStorage.getItem(OLD_KEY + '-subido')) return;
  let old; try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch {}
  if (!old || !(old.bucket?.length || old.notes?.length || old.ideas?.length || old.start)) return;
  migrating = true;
  if (await ask('Encontré datos guardados en este teléfono de la versión anterior. ¿Subirlos para compartirlos?')) {
    try { await uploadData(old); localStorage.setItem(OLD_KEY + '-subido', '1'); toast('Datos subidos'); }
    catch (e) { console.error(e); toast('No se pudieron subir, se intentará de nuevo'); }
  } else localStorage.setItem(OLD_KEY + '-subido', 'no');
  migrating = false;
}

// Actualiza fechas, pregunta y ánimo si la app queda abierta pasada la medianoche.
// Si estuvo en segundo plano un rato, se reconecta la base de datos: en Android la conexión queda dormida y no llegaban los cambios.
let hiddenSince = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenSince = Date.now(); return; }
  if (!S.me) return;
  rerenderAll();
  if (hiddenSince && Date.now() - hiddenSince > 15000) { disableNetwork(db).then(() => enableNetwork(db)).catch(() => {}); checkUpdate(); }
});

/* ---------- Versión nueva ---------- */
let firstIn = true;
function afterIn() {
  if (!firstIn) return; firstIn = false;
  // Pantallas que dependen de algo elegido antes (un viaje, una partida) no se restauran.
  if (resume?.screen && !['s-home', 's-trip', 's-search', 's-game', 's-quiz'].includes(resume.screen) && $(resume.screen)) go(resume.screen);
  let seen = null; try { seen = localStorage.getItem('futari-version'); localStorage.setItem('futari-version', APP_VERSION); } catch {}
  if (seen && seen !== APP_VERSION) setTimeout(() => showNews(seen), 1200);
  setTimeout(checkUpdate, 4000);
  setInterval(checkUpdate, 30 * 60000);
}
const getVersion = () => fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
async function checkUpdate() {
  let v; try { v = await getVersion(); } catch { return; }
  if (!v?.version || v.version === APP_VERSION || $('updateBar')) return;
  const bar = document.createElement('div'); bar.className = 'update-bar'; bar.id = 'updateBar'; bar.setAttribute('role', 'status');
  bar.innerHTML = `<span style="font-size:20px">✨</span><div class="grow"><b style="display:block">Hay una versión nueva</b><span class="tiny muted">${esc((v.notes || [])[0] || 'Mejoras y arreglos')}</span></div>
    <button class="btn small" onclick="updateNow(this)">Actualizar</button><button class="x" aria-label="Después" onclick="this.parentElement.remove()">✕</button>`;
  document.body.appendChild(bar);
}
async function updateNow(btn) {
  btn.disabled = true; btn.textContent = 'Actualizando…';
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  location.reload();
}
// Muestra todo lo nuevo desde la última versión que se abrió en este teléfono (acumulado, de lo más nuevo a lo más viejo).
async function showNews(seen) {
  let v; try { v = await getVersion(); } catch { return; }
  const hist = (v?.history || [{ version: v?.version, notes: v?.notes || [] }])
    .filter(h => Number(h.version) > Number(seen) && Number(h.version) <= Number(APP_VERSION) && h.notes?.length)
    .sort((a, b) => Number(b.version) - Number(a.version));
  if (!hist.length) return;
  const notes = hist.flatMap(h => h.notes);
  openSheet(`<div class="stack"><h2>✨ Novedades</h2>${hist.length > 1 ? `<p class="small muted" style="margin:0">Lo nuevo de las últimas ${hist.length} actualizaciones</p>` : ''}
    <ul class="news" style="margin:0;padding-left:20px;max-height:52vh;overflow:auto">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <button class="btn" onclick="closeSheet()">¡Genial!</button></div>`);
}

expose({ login, resetPass, updateNow });
