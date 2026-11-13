// Notificaciones: cada teléfono se suscribe (Web Push) y guarda su dirección en "push/<uid>".
// Cuando alguien hace algo (instantánea, nota, cupón…), su teléfono le pide al Worker de Cloudflare
// (push-config.js, docs/NOTIFICACIONES.md) que avise a los teléfonos de su pareja.
// En el emulador (?emu) no se llama al Worker: el aviso se anota en la consola y en window.__pushLog.
import { setDoc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, auth, EMU, ref, on, partnerUid, profile, uid, toast, go, esc, openSheet, countStat, ANDROID, IOS } from './core.js';
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
  // El tipo va en el enlace (&n=) para contar cuántos se abren
  const msg = { title, body, url: to === 'me' ? url : url + (url.includes('?') ? '&' : '?') + 'n=' + type, tag };
  if (to !== 'me') countStat('sent', type);
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

/* ---------- Diagnóstico de los avisos programados (Worker → /diagnostico) ---------- */
// El Worker lee la base como lo hace cada minuto y manda una prueba; aquí se explica el resultado en palabras.
const DIAG_PAGE = s => `<div class="stack"><h2>⏰ Avisos programados</h2>${s}</div>`;
async function diagnoseSchedule() {
  if (EMU) return toast('En el emulador no se llama al servicio');
  if (!pushConfigured()) return toast('Falta conectar el servicio de avisos');
  openSheet(DIAG_PAGE('<p class="muted" style="margin:0">Revisando con el servicio de avisos…</p>'));
  let d;
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(PUSH.url.replace(/\/$/, '') + '/diagnostico', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 404) return openSheet(DIAG_PAGE('<p style="margin:0">❌ El servicio todavía tiene el código anterior. Hay que pegar la versión nueva de <code>notificaciones/worker.js</code> en Cloudflare.</p>'));
    if (!r.ok) return openSheet(DIAG_PAGE(`<p style="margin:0">❌ El servicio respondió con un error (${r.status}).</p>`));
    d = await r.json();
  } catch (e) { return openSheet(DIAG_PAGE('<p style="margin:0">❌ No se pudo conectar con el servicio. Revisa el internet e intenta otra vez.</p>')); }
  const ok = v => v === 'ok', row = (good, txt) => `<li>${good ? '✅' : '❌'} ${txt}</li>`;
  const st = d.steps || {}, rows = [];
  rows.push(row(true, `Hora del servicio: <b>${esc(d.now || '?')}</b> (${esc(d.zone || '?')}). Si no coincide con tu reloj, los recordatorios llegarán a otra hora.`));
  if (!d.hasSA) rows.push(row(false, 'Falta la clave de lectura (<code>FIREBASE_SA</code>) en Cloudflare.'));
  else if (!ok(st.token)) rows.push(row(false, `Google no aceptó la clave de lectura: <span class="tiny">${esc(st.token || '')}</span><br><span class="small muted">Revisa que <code>FIREBASE_SA</code> tenga el JSON completo, desde { hasta }.</span>`));
  else if (!ok(st.read)) rows.push(row(false, `No pudo leer la base: <span class="tiny">${esc(st.read || '')}</span><br><span class="small muted">Si dice 403, a la cuenta de servicio le falta el rol «Lector de Cloud Datastore» (a veces tarda unos minutos en activarse).</span>`));
  else {
    rows.push(row(true, 'Puede leer la base de datos'));
    const notAllowed = (d.members || []).filter(m => !m.allowed).length;
    if (notAllowed) rows.push(row(false, `${notAllowed === 1 ? 'Una cuenta no está' : 'Las cuentas no están'} en <code>ALLOWED_UIDS</code>: no le llegarán avisos programados.`));
    if (!ok(st.query)) rows.push(row(false, `No pudo buscar los recordatorios: <span class="tiny">${esc(st.query || '')}</span>`));
    else {
      const rem = d.remindersToday || [];
      rows.push(row(true, rem.length ? `Recordatorios de hoy que ve: ${rem.map(x => `«${esc(x.text)}»${x.time ? ' a las ' + esc(x.time) : ' (sin hora: 8:00)'}${x.done ? ' (hecho)' : ''}${x.for === 'pareja' ? ' (para tu pareja)' : ''}`).join(', ')}` : 'No ve recordatorios para hoy'));
    }
    rows.push(row(d.devices > 0, d.devices ? `Tienes ${d.devices} ${d.devices === 1 ? 'teléfono' : 'teléfonos'} con avisos` : 'No tienes teléfonos con avisos activados'));
    const codes = String(st.push || '').split(',').map(x => x.trim());
    if (d.devices) rows.push(row(codes.every(c => /^20\d$/.test(c)), codes.every(c => /^20\d$/.test(c)) ? 'Mandó una prueba a tus teléfonos: debería llegarte «Futari ⏰» ahora' : `No pudo mandar la prueba (${esc(st.push || '')})`));
  }
  openSheet(DIAG_PAGE(`<ul class="small" style="margin:0;padding-left:4px;list-style:none;line-height:1.6">${rows.join('')}</ul>
    <p class="tiny muted" style="margin:0">Servicio versión ${esc(String(d.version || '?'))}. Si todo sale ✅ pero aun así no llegan a su hora, revisa en Cloudflare que el Cron sea <code>* * * * *</code>.</p>`));
}
window.diagnoseSchedule = diagnoseSchedule;

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
// Los avisos programados del Worker no llevan &n=: se deduce por la sección que abren
const openedType = (what, n) => n || { pet: 'streak', reminders: 'reminders', cal: 'dates' }[what] || what;
export function handleOpenParam() {
  const qs = new URLSearchParams(location.search), what = qs.get('open');
  if (!what) return;
  const n = qs.get('n');
  qs.delete('open'); qs.delete('n');
  if (S.me) countStat('opened', openedType(what, n)); else setTimeout(() => countStat('opened', openedType(what, n)), 3000);
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString().replace(/=(&|$)/g, '$1') : ''));
  openWhenReady(what);
}
// Si la app ya estaba abierta, el service worker manda el enlace del aviso por mensaje
navigator.serviceWorker?.addEventListener('message', e => {
  const u = e.data?.futariOpen; if (!u) return;
  const sp = new URL(u, location.href).searchParams, what = sp.get('open');
  if (what) { countStat('opened', openedType(what, sp.get('n'))); openWhenReady(what); }
});

on('push', () => { syncSub(); refreshHere().then(() => window.rerenderSettings?.()); });
