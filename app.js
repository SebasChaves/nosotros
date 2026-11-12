// Arranque: sesión, sincronización en vivo y avisos (puntitos) de la barra de abajo.
import { onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { onSnapshot } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, auth, configured, coupleRef, col, privCol, COLLECTIONS, PRIVATE, toast, expose, rerender, rerenderAll,
         partnerUid, profile, uid } from './core.js';
import { todayAnswers } from './home.js';
import { listNeedsMyVote } from './decide.js';
import { unreadNotes, couponAlerts } from './love.js';
import './moments.js';
import './lists.js';
import './money.js';
import './places.js';
import './trips.js';
import './us.js';
import { quizWaiting } from './quiz.js';
import './summary.js';
import { applyAccent, uploadData } from './settings.js';

const setState = s => { document.body.classList.remove('loading', 'out', 'in', 'noconfig'); document.body.classList.add(s); };
const updateOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
addEventListener('online', updateOnline); addEventListener('offline', updateOnline); updateOnline();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- Sesión ---------- */
let unsubs = [];
if (!configured) setState('noconfig');
else onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  S.me = user;
  if (!user) { setState('out'); return; }
  setState('in');
  listen();
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
async function resetPass() {
  const email = $('loginEmail').value.trim();
  if (!email) return toast('Escribe tu correo arriba primero');
  try { await sendPasswordResetEmail(auth, email); toast('Te mandamos un correo'); }
  catch { toast('No se pudo enviar el correo'); }
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
      if (name === 'profiles') applyAccent(profile(uid()).prefs?.accent);
      rerender(name); updateBadges();
    }, fail));
  }
  for (const name of PRIVATE) {
    unsubs.push(onSnapshot(privCol(name), s => {
      S.priv[name] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      rerender(name);
    }, fail));
  }
  rerenderAll(); updateBadges();
}

function updateBadges() {
  if (!S.me) return;
  const setDot = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n > 9 ? '9+' : n; };
  const p = partnerUid(), ans = todayAnswers();
  setDot('dot-home', p && ans?.answers?.[p] && !ans?.answers?.[uid()] ? 1 : 0);
  setDot('dot-decide', S.data.lists.filter(listNeedsMyVote).length);
  setDot('dot-love', unreadNotes() + couponAlerts());
  setDot('dot-more', quizWaiting() ? 1 : 0);
}

/* ---------- Datos de la primera versión (solo en el teléfono) ---------- */
const OLD_KEY = 'nosotros-data';
let migrating = false;
async function maybeMigrate() {
  if (migrating || localStorage.getItem(OLD_KEY + '-subido')) return;
  let old; try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch {}
  if (!old || !(old.bucket?.length || old.notes?.length || old.ideas?.length || old.start)) return;
  migrating = true;
  if (confirm('Encontré datos guardados en este teléfono de la versión anterior. ¿Subirlos para compartirlos?')) {
    try { await uploadData(old); localStorage.setItem(OLD_KEY + '-subido', '1'); toast('Datos subidos'); }
    catch (e) { console.error(e); toast('No se pudieron subir, se intentará de nuevo'); }
  } else localStorage.setItem(OLD_KEY + '-subido', 'no');
  migrating = false;
}

// Actualiza fechas, pregunta y ánimo si la app queda abierta pasada la medianoche
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) rerenderAll(); });

expose({ login, resetPass });
