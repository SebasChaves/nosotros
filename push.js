// Notificaciones: cada teléfono se suscribe (Web Push) y guarda su dirección en "push/<uid>".
// Cuando alguien hace algo (instantánea, nota, cupón…), su teléfono le pide al Worker de Cloudflare
// (push-config.js, docs/NOTIFICACIONES.md) que avise a los teléfonos de su pareja.
// En el emulador (?emu) no se llama al Worker: el aviso se anota en la consola y en window.__pushLog.
import { setDoc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, auth, EMU, ref, on, partnerUid, profile, uid, toast, go, ANDROID, IOS } from './core.js';
import { PUSH } from './push-config.js';

// [tipo, nombre en Ajustes]. Cada uno elige cuáles recibe (prefs.notif[tipo] === false = apagado).
export const NOTIF_TYPES = [['snaps', '📸 Instantáneas y respuestas'], ['reacts', '😍 Reacciones a tus instantáneas'], ['notes', '💌 Notas nuevas'],
  ['thinks', '❤️ «Pensando en ti»'], ['songs', '🎵 Canciones dedicadas'], ['coupons', '🎟️ Cupones nuevos, canjeados y cumplidos'],
  // Programados: los manda el Worker solo (notificaciones/worker.js → scheduled)
  ['streak', '🔥 Racha en peligro y mascota con hambre (en la noche)'], ['reminders', '🔔 Recordatorios del día'], ['dates', '🎂 Fechas especiales (el día antes y el mismo día)']];

export const pushConfigured = () => !!(PUSH.url && PUSH.publicKey);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const iosNeedsInstall = () => IOS && !standalone();
export const pushPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');
const device = () => IOS ? 'iPhone' : ANDROID ? 'Android' : 'Computadora';
// Llave corta y estable por teléfono (a partir de su dirección) para guardarlo en el mapa "subs"
const subKey = endpoint => { let h = 0; for (const c of endpoint) h = (h * 31 + c.charCodeAt(0)) | 0; return 'd' + (h >>> 0).toString(36); };
const b64ToU8 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export const subsOf = who => Object.entries(S.data.push.find(d => d.id === who)?.subs || {}).map(([k, v]) => ({ k, ...v }));
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
// ¿Este teléfono tiene las notificaciones activas? (lo guarda en una variable para pintar Ajustes sin esperar)
export let pushHere = false;
async function refreshHere() {
  const s = await currentSub().catch(() => null);
  pushHere = !!(s && pushPermission() === 'granted' && subsOf(uid()).some(x => x.endpoint === s.endpoint));
  return s;
}

async function saveSub(s) {
  const j = s.toJSON();
  await setDoc(ref('push', uid()), { subs: { [subKey(j.endpoint)]: { endpoint: j.endpoint, keys: j.keys, device: device(), at: Date.now() } } }, { merge: true });
}
// Activar en este teléfono: pide permiso (debe llamarse desde un toque) y guarda la suscripción.
export async function enablePush() {
  if (!pushConfigured()) return toast('Falta conectar el servicio de avisos');
  if (iosNeedsInstall()) return toast('Primero instala Futari en la pantalla de inicio');
  if (!pushSupported()) return toast('Este navegador no permite notificaciones');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { window.rerenderSettings?.(); return toast(perm === 'denied' ? 'Las notificaciones están bloqueadas para Futari' : 'No se activaron'); }
  try {
    const reg = await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(PUSH.publicKey) });
    await saveSub(s);
    pushHere = true; toast('Notificaciones activadas 🔔');
  } catch (e) { console.error(e); toast('No se pudieron activar. Intenta otra vez'); }
  window.rerenderSettings?.();
}
export async function disablePush() {
  const s = await currentSub().catch(() => null);
  if (s) {
    await updateDoc(ref('push', uid()), { [`subs.${subKey(s.endpoint)}`]: deleteField() }).catch(() => {});
    await s.unsubscribe().catch(() => {});
  }
  pushHere = false; toast('Notificaciones desactivadas en este teléfono');
  window.rerenderSettings?.();
}
// Al abrir la app: si el teléfono ya tenía permiso, se asegura de que su dirección esté guardada (a veces cambia).
let synced = false;
async function syncSub() {
  if (synced || !S.me || !pushConfigured() || pushPermission() !== 'granted') return;
  synced = true;
  const s = await currentSub().catch(() => null);
  if (s && !subsOf(uid()).some(x => x.endpoint === s.endpoint)) await saveSub(s).catch(() => {});
  await refreshHere(); window.rerenderSettings?.();
}

/* ---------- Mandar un aviso ---------- */
// to: 'partner' (por defecto) o 'me' (prueba). type: uno de NOTIF_TYPES (la pareja puede tenerlo apagado).
export async function notify(type, { title, body = '', url = './', tag = '' }, to = 'partner') {
  const who = to === 'me' ? uid() : partnerUid();
  if (!who || !S.me) return;
  if (to !== 'me' && profile(who).prefs?.notif?.[type] === false) return;
  const subs = subsOf(who);
  if (!subs.length) return;
  const msg = { title, body, url, tag };
  if (EMU) { (window.__pushLog ||= []).push({ to: who, type, ...msg, devices: subs.length }); console.info('[aviso emulador]', who, msg); return; }
  if (!pushConfigured()) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(PUSH.url.replace(/\/$/, '') + '/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...msg, subs: subs.map(({ endpoint, keys }) => ({ endpoint, keys })) }) });
    if (!r.ok) { console.warn('aviso', r.status, await r.text().catch(() => '')); return r.status; }
    const { results = [] } = await r.json();
    // Teléfonos que ya no existen (desinstalaron o quitaron el permiso): se borran
    const gone = results.filter(x => x.status === 404 || x.status === 410).map(x => subs.find(s => s.endpoint === x.endpoint)?.k).filter(Boolean);
    if (gone.length) updateDoc(ref('push', who), Object.fromEntries(gone.map(k => [`subs.${k}`, deleteField()]))).catch(() => {});
    return results.some(x => x.status >= 200 && x.status < 300) ? 'ok' : results.map(x => x.status).join(',');
  } catch (e) { console.warn('aviso', e); return 'error'; }
}
// Cómo me llama mi pareja en su teléfono (su apodo para mí, si puso uno)
export const meFor = who => profile(who).prefs?.partnerNick || S.settings.members?.[uid()]?.name || 'Tu pareja';
export const meForPartner = () => meFor(partnerUid());

export async function testPush() {
  if (!subsOf(uid()).length) return toast('Primero activa las notificaciones');
  toast('Mandando una prueba…');
  const r = await notify('test', { title: 'Futari 💞', body: 'Así se verán los avisos. ¡Ya funcionan!', url: './', tag: 'prueba' }, 'me');
  if (EMU) return toast('Prueba anotada (emulador)');
  if (r === 'ok') toast('Listo: debería llegarte en unos segundos');
  else toast(r === 401 || r === 403 ? 'El servicio no reconoció esta cuenta' : 'No se pudo mandar la prueba');
}

/* ---------- Abrir la sección correcta al tocar un aviso (?open=…) ---------- */
const OPEN = {
  snaps: () => window.openSnaps?.(),
  notes: () => { go('s-love'); window.loveTab?.('notes'); },
  coupons: () => { go('s-love'); window.loveTab?.('coupons'); },
  songs: () => go('s-music'),
  home: () => go('s-home'),
  pet: () => { go('s-home'); setTimeout(() => document.querySelector('.pet-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); },
  reminders: () => go('s-reminders'),
  cal: () => go('s-cal'),
};
// Espera a que estén cargados los datos y a que se quite el candado del PIN
function openWhenReady(what) {
  const fn = OPEN[what]; if (!fn) return;
  let tries = 0;
  const run = () => {
    if ($('lockScreen') || !S.me || !document.body.classList.contains('in') || (what === 'snaps' && !S.data.snaps.length)) { if (++tries < 40) setTimeout(run, 400); else if (S.me) fn(); return; }
    fn();
  };
  run();
}
export function handleOpenParam() {
  const qs = new URLSearchParams(location.search), what = qs.get('open');
  if (!what) return;
  qs.delete('open');
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString().replace(/=(&|$)/g, '$1') : ''));
  openWhenReady(what);
}
// Si la app ya estaba abierta, el service worker manda el enlace del aviso por mensaje
navigator.serviceWorker?.addEventListener('message', e => {
  const u = e.data?.futariOpen; if (!u) return;
  const what = new URL(u, location.href).searchParams.get('open');
  if (what) openWhenReady(what);
});

on('push', () => { syncSub(); refreshHere().then(() => window.rerenderSettings?.()); });
