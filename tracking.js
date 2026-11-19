// Registro de uso para el panel de administración (Administración → Ingresos, Estadísticas y Bitácoras).
// Ingreso = abrir la app (o volver a ella después de 20 minutos sin usarla). Se avisa a los dos en Ajustes.
// Bitácoras (1.12.0): acciones de cada uno (sin textos), errores con más detalle, avisos mandados y rendimiento al abrir.
import { setDoc, updateDoc, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, newRef, ref, dayKey, todayKey, logHooks } from './core.js';

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

/* ---------- Errores ---------- */
// Para encontrarlos sin tener el teléfono a mano. Máximo 30 distintos por sesión; si el mismo se repite, se suma a «count».
// kind: js (error del código), promesa, guardar (Firestore no guardó), escuchar (falló la sincronización), foto.
// trail = últimas pantallas abiertas antes del error.
let sent = 0;
const errRefs = {}, trail = [];
logHooks.screen = id => { trail.push(String(id).replace(/^s-/, '')); if (trail.length > 6) trail.shift(); };
export function logError(message, where, extra = {}) {
  if (!S.me || !message) return;
  const key = `${message}|${where}`.slice(0, 400);
  if (errRefs[key]) { updateDoc(errRefs[key], { count: increment(1), lastAt: Date.now() }).catch(() => {}); return; }
  if (sent >= 30) return;
  sent++;
  const r = errRefs[key] = newRef('errors'), dv = device();
  setDoc(r, { uid: S.me.uid, at: Date.now(), message: String(message).slice(0, 300), where: String(where || '').slice(0, 200),
    screen: document.querySelector('.screen.active')?.id || '', os: dv.os, browser: dv.browser, model: dv.model, app: dv.app,
    kind: extra.kind || 'js', code: String(extra.code || ''), stack: String(extra.stack || '').slice(0, 800), trail: [...trail],
    online: navigator.onLine, count: 1 }).catch(() => {});
}
logHooks.error = logError;
addEventListener('error', e => logError(e.message, `${e.filename?.split('/').pop() || ''}:${e.lineno || ''}`, { stack: e.error?.stack }));
addEventListener('unhandledrejection', e => logError(e.reason?.message || e.reason, 'promesa', { kind: 'promesa', code: e.reason?.code, stack: e.reason?.stack }));

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

/* ---------- Acciones de cada uno (Administración → Bitácoras) ---------- */
// app.js pasa cada foto de las colecciones. Los cambios hechos en ESTE teléfono llegan con «hasPendingWrites» (todavía no
// confirmados por el servidor); los de la pareja no, así cada teléfono anota solo lo de su dueño. No se guarda ningún texto:
// solo la sección (colección) y si agregó (a), cambió (e) o borró (d). El mismo documento con la misma acción cuenta una vez
// por minuto (escribir en un formulario o jugar no llena la bitácora).
// Los borrados no se pueden saber así (el documento ya no está en la foto): los anota softDelete (core.js) con
// logHooks.deleted; si tocan «Deshacer», se quita. Las limpiezas automáticas (historias vencidas) no cuentan.
// Se guarda junto con el tiempo de uso en "actions/<día>_<uid>": { uid, day, n: { col: { a, e, d } }, log: [{ at, c, o }] }.
const NO_ACTS = new Set(['push', 'activity']); // automáticas
const seenCols = new Set(), lastAct = {};
let acts = [];
export function logActions(name, snap) {
  if (!seenCols.has(name)) { seenCols.add(name); return; } // la primera foto es la carga, no una acción
  if (!S.me || NO_ACTS.has(name) || !snap.metadata.hasPendingWrites) return;
  const now = Date.now();
  for (const ch of snap.docChanges()) {
    if (ch.type === 'removed' || !ch.doc.metadata.hasPendingWrites) continue;
    const o = ch.type === 'added' ? 'a' : 'e', k = `${name}/${ch.doc.id}/${o}`;
    if (now - (lastAct[k] || 0) < 60e3) continue;
    lastAct[k] = now;
    acts.push({ at: now, c: name, o, id: ch.doc.id });
  }
}
logHooks.deleted = (name, id, undone) => {
  if (!S.me || NO_ACTS.has(name)) return;
  if (!undone) { acts.push({ at: Date.now(), c: name, o: 'd', id }); return; }
  const i = acts.findLastIndex(a => a.c === name && a.o === 'd' && a.id === id);
  if (i >= 0) acts.splice(i, 1);
  lastAct[`${name}/${id}/a`] = Date.now(); // al deshacer se vuelve a escribir: no es un «agregó»
};
function flushActions() {
  if (!S.me || !acts.length) return;
  const byDay = {};
  for (const { at, c, o } of acts) (byDay[dayKey(new Date(at))] ||= []).push({ at, c, o }); // el id no se guarda
  for (const [day, list] of Object.entries(byDay)) {
    const cnt = {};
    for (const a of list) (cnt[a.c] ||= {})[a.o] = ((cnt[a.c] ||= {})[a.o] || 0) + 1;
    const n = Object.fromEntries(Object.entries(cnt).map(([c, ops]) => [c, Object.fromEntries(Object.entries(ops).map(([o, v]) => [o, increment(v)]))]));
    setDoc(ref('actions', `${day}_${S.me.uid}`), { uid: S.me.uid, day, n, log: arrayUnion(...list) }, { merge: true }).catch(() => {});
  }
  acts = [];
}

/* ---------- Avisos que manda la app (push.js) ---------- */
// "notiflog/<día>": { day, list: [{ at, by, to, type, src: 'app', r, n?, ok? }] }. r = ok, apagado (la pareja lo tiene
// apagado), sin-telefono, sin-configurar, emulador, worker-<código>, error o los códigos de cada teléfono. Sin textos.
export function logNotif(e) {
  if (!S.me) return;
  const day = todayKey(), item = { at: Date.now(), by: S.me.uid, src: 'app' };
  for (const [k, v] of Object.entries(e)) if (v !== undefined && v !== null) item[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  setDoc(ref('notiflog', day), { day, list: arrayUnion(item) }, { merge: true }).catch(() => {});
}

/* ---------- Rendimiento al abrir la app ---------- */
// Una vez por cada vez que se abre la app desde cero, a los 30 s (o al salir antes): "perf/<id>".
// t = milisegundos desde que se empezó a cargar: auth (se supo quién es), cache (primeros datos del teléfono),
// server (primeros datos del servidor), ready (todas las secciones con datos). photos = fotos cargadas en ese rato.
const perf = { t: {}, ph: { n: 0, sum: 0, max: 0, fail: 0 } };
let perfSent = false;
logHooks.perf = k => { if (perf.t[k] == null) perf.t[k] = Math.round(performance.now()); };
logHooks.photo = (ms, ok) => {
  if (perfSent) return;
  const p = perf.ph;
  if (!ok) { p.fail++; return; }
  p.n++; p.sum += ms; p.max = Math.max(p.max, ms);
};
function sendPerf() {
  if (perfSent || !S.me) return;
  perfSent = true;
  const nav = performance.getEntriesByType?.('navigation')?.[0], p = perf.ph, start = Date.now() - Math.round(performance.now());
  setDoc(newRef('perf'), { uid: S.me.uid, at: start, day: dayKey(new Date(start)), ...device(), online: navigator.onLine,
    conn: navigator.connection?.effectiveType || '', sw: !!navigator.serviceWorker?.controller,
    dom: nav ? Math.round(nav.domContentLoadedEventEnd) : null, t: perf.t,
    photos: { n: p.n, avg: p.n ? Math.round(p.sum / p.n) : 0, max: Math.round(p.max), fail: p.fail } }).catch(() => {});
}
setTimeout(sendPerf, 30000);

const flushAll = () => { flushUsage(); flushActions(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { flushAll(); sendPerf(); } });
addEventListener('pagehide', () => { flushAll(); sendPerf(); });
setInterval(flushAll, 5 * 60e3);
