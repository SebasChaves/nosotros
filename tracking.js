// Registro de uso para el panel de administración (Administración → Ingresos, Estadísticas y Bitácoras).
// Ingreso = abrir la app (o volver a ella después de 20 minutos sin usarla). Se avisa a los dos en Ajustes.
// Bitácoras (1.12.0): acciones de cada uno (sin textos), errores con más detalle, avisos mandados y rendimiento al abrir.
import { setDoc, updateDoc, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, newLogRef, logRef, dayKey, todayKey, logHooks } from './core.js';

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
  // Teléfono nuevo: este teléfono (o navegador) nunca había abierto Futari con esta cuenta
  let newDev = false; try { const k = 'futari-dev-' + S.me.uid; newDev = !localStorage.getItem(k) && !last; localStorage.setItem(k, String(now)); } catch {}
  flushSession(); // cierra la sesión anterior (si volvió después de 20 minutos)
  const r = newLogRef('visits');
  sess = { ref: r, at: now, path: [], secs: 0, uid: S.me.uid };
  const cur = document.querySelector('.screen.active')?.id?.replace(/^s-/, '');
  if (cur) sess.path.push(cur);
  // Se espera un momento para tener el modelo del teléfono (llega aparte).
  setTimeout(() => setDoc(r, { uid: S.me.uid, at: now, day: dayKey(d), hour: d.getHours(), min: d.getMinutes(), ...device(), ...(newDev ? { newDev: true } : {}) }).catch(() => {}), 600);
}
/* ---------- Sesiones: cada ingreso guarda hasta cuándo estuvo y por qué pantallas pasó ---------- */
// En el mismo documento del ingreso ("visits/<id>"): end (último momento con la app a la vista), secs (segundos a la
// vista) y path (pantallas en orden, sin repetir seguidas, máximo 40).
let sess = null;
function flushSession() {
  if (!sess || !sess.secs || sess.uid !== S.me?.uid || sess.sent === sess.secs) return;
  sess.sent = sess.secs;
  setDoc(sess.ref, { end: sess.end || Date.now(), secs: sess.secs, path: sess.path.slice(0, 40) }, { merge: true }).catch(() => {});
}
// Al cerrar sesión: se anota y se sube todo antes de salir (después ya no hay permiso para escribir)
logHooks.logout = async () => {
  if (!S.me) return;
  addAct('_auth', 'sesion', 'x', {});
  flushUsage(); flushSession();
  await Promise.all(actionsWrite());
};

/* ---------- Errores ---------- */
// Para encontrarlos sin tener el teléfono a mano. Máximo 30 distintos por sesión; si el mismo se repite, se suma a «count».
// kind: js (error del código), promesa, guardar (Firestore no guardó), escuchar (falló la sincronización), foto.
// trail = últimas pantallas abiertas antes del error.
let sent = 0;
const errRefs = {}, trail = [];
logHooks.screen = id => {
  const s = String(id).replace(/^s-/, '');
  trail.push(s); if (trail.length > 6) trail.shift();
  if (sess && sess.path[sess.path.length - 1] !== s && sess.path.length < 40) sess.path.push(s);
};
export function logError(message, where, extra = {}) {
  if (!S.me || !message) return;
  const key = `${message}|${where}`.slice(0, 400);
  if (errRefs[key]) { updateDoc(errRefs[key], { count: increment(1), lastAt: Date.now() }).catch(() => {}); return; }
  if (sent >= 30) return;
  sent++;
  const r = errRefs[key] = newLogRef('errors'), dv = device();
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
  if (sess) { sess.secs += 5; sess.end = Date.now(); }
}, 5000);
function flushUsage() {
  if (!S.me || !accTotal) return;
  const day = todayKey(), secs = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, increment(v)]));
  setDoc(logRef('usage', `${day}_${S.me.uid}`), { uid: S.me.uid, day, total: increment(accTotal), secs }, { merge: true }).catch(() => {});
  acc = {}; accTotal = 0;
}

/* ---------- Acciones de cada uno (Administración → Bitácoras) ---------- */
// app.js pasa cada foto de las colecciones (y la del documento de la pareja como «_couple»). Los cambios hechos en ESTE
// teléfono llegan con «hasPendingWrites» (todavía no confirmados por el servidor); los de la pareja no, así cada teléfono
// anota solo lo de su dueño. Se guarda la sección (colección), si agregó (a), cambió (e), borró (d), deshizo un borrado (u)
// o cerró sesión (x), el id del documento, el teléfono y la versión, y:
//   - al cambiar: qué campos cambiaron con el valor de antes y el de ahora (f: [{ p, b, a }], textos cortados a 80
//     caracteres; las fotos no se copian, solo se dice que cambiaron: ph);
//   - al agregar o borrar: un título corto (t) para saber qué fue.
// auto: 1 = lo guardó la app sola (guía vista, avisos vistos…), sin que la persona tocara un ajuste.
// El mismo documento en el mismo minuto se junta en una sola fila. Las colecciones privadas (regalos) no se anotan.
// Se guarda junto con el tiempo de uso en "actions/<día>_<uid>": { uid, day, n: { col: { a, e, d } }, log: [...] }.
const NO_ACTS = new Set(['push', 'activity']); // automáticas
const IGNORE = /^(at|updatedAt|editedAt|lastAt|ts|by|id)$/; // marcas de tiempo y autor: cambian solas en cada edición
// Campos que la app guarda sola (por colección). Si todo lo que cambió está aquí, la fila sale como «automático».
const AUTO = {
  profiles: /^prefs\.(tour|tourV|tourGates|unwrapped|vacHigh|moneyTour)(\.|$)/,
  advent: /^(reactSeen)$/,
  _couple: /^(lastBackup)$/,
};
const PHOTO_KEY = /(^|\.)(photo|photos|avatar|thumb|img|image|bg|pic|data)$/i;
const prev = {}; // último contenido conocido de cada documento: «col/id» → datos
const seenCols = new Set(), lastAct = {};
let acts = [];
const short = v => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 79) + '…' : v;
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 79) + '…' : s;
};
const isPhotoVal = v => typeof v === 'string' && (v.startsWith('data:') || /^(avatar|bg|adv|mom|t)-/.test(v) && v.length > 20);
// Aplana un documento a «ruta → valor» (hasta 3 niveles; las listas cuentan como un solo valor)
function flat(o, pre = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(o || {})) {
    if (!pre && IGNORE.test(k)) continue;
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2 && !(v.seconds !== undefined && v.nanoseconds !== undefined)) flat(v, p, out, depth + 1);
    else out[p] = v;
  }
  return out;
}
function diff(before, after) {
  const A = flat(before), B = flat(after), f = [];
  for (const p of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[p], y = B[p];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (PHOTO_KEY.test(p) || isPhotoVal(x) || isPhotoVal(y)) f.push({ p, ph: y === undefined || y === null || y === false ? 'quitó' : x === undefined || x === null || x === false ? 'puso' : 'cambió' });
    else f.push({ p, b: short(x), a: short(y) });
  }
  return f;
}
const titleOf = d => { const t = [d?.title, d?.name, d?.text, d?.t, d?.note, d?.q].find(v => typeof v === 'string' && v.trim()); return t ? short(t.trim()) : ''; };
const dev = () => { const d = device(); return { d: d.model || d.os, v: d.app }; };
function addAct(name, id, o, extra) {
  const now = Date.now(), k = `${name}/${id}`, last = lastAct[k];
  // Mismo documento, misma acción, en el último minuto y todavía sin subir: se junta (queda el «antes» original)
  const same = last && now - last.at < 60e3 && last.o === o && !last.auto === !extra.auto && acts.includes(last);
  if (same && o === 'e') {
    for (const g of extra.f || []) { const h = last.f.find(x => x.p === g.p); if (h) Object.assign(h, g.ph ? { ph: g.ph } : { a: g.a }); else last.f.push(g); }
    last.f = last.f.filter(x => x.ph || JSON.stringify(x.b) !== JSON.stringify(x.a)).slice(0, 8);
    return;
  }
  if (same) return;
  const a = { at: now, c: name, o, id, ...dev(), ...extra };
  if (a.f) a.f = a.f.slice(0, 8);
  lastAct[k] = a; acts.push(a);
}
export function logActions(name, snap) {
  const first = !seenCols.has(name); seenCols.add(name);
  const changes = snap.docChanges ? snap.docChanges() : [{ type: snap.exists() ? 'modified' : 'removed', doc: snap }];
  for (const ch of changes) {
    const id = ch.doc.id, k = `${name}/${id}`, before = prev[k];
    const data = ch.type === 'removed' ? null : ch.doc.data();
    // Al borrar se queda el último contenido: sirve para el título del borrado, y si tocan «Deshacer» vuelve igual y no
    // cuenta como «agregó» (no hay diferencia)
    if (data) prev[k] = data;
    // la primera foto es la carga; lo de la pareja no se anota aquí (lo anota su teléfono)
    if (first || !S.me || NO_ACTS.has(name) || ch.type === 'removed' || !ch.doc.metadata.hasPendingWrites) continue;
    if (ch.type === 'added' && !before) { addAct(name, id, 'a', { t: titleOf(data) }); continue; }
    const f = diff(before, data);
    if (!f.length) continue;
    const auto = AUTO[name] && f.every(x => AUTO[name].test(x.p)) ? 1 : 0;
    addAct(name, id, 'e', { f, ...(auto ? { auto } : {}) });
  }
}
logHooks.deleted = (name, id, undone) => {
  if (!S.me || NO_ACTS.has(name)) return;
  if (!undone) { addAct(name, id, 'd', { t: titleOf(prev[`${name}/${id}`]) }); return; }
  addAct(name, id, 'u', { t: titleOf(prev[`${name}/${id}`]) });
};
function actionsWrite() {
  if (!S.me || !acts.length) return [];
  const byDay = {};
  for (const a of acts) (byDay[dayKey(new Date(a.at))] ||= []).push(a);
  acts = [];
  return Object.entries(byDay).map(([day, list]) => {
    const cnt = {};
    for (const a of list) if ('aed'.includes(a.o) && !a.auto) (cnt[a.c] ||= {})[a.o] = (cnt[a.c][a.o] || 0) + 1;
    const n = Object.fromEntries(Object.entries(cnt).map(([c, ops]) => [c, Object.fromEntries(Object.entries(ops).map(([o, v]) => [o, increment(v)]))]));
    return setDoc(logRef('actions', `${day}_${S.me.uid}`), { uid: S.me.uid, day, n, log: arrayUnion(...list) }, { merge: true }).catch(() => {});
  });
}
function flushActions() { actionsWrite(); }

/* ---------- Avisos que manda la app (push.js) ---------- */
// "notiflog/<día>": { day, list: [{ at, by, to, type, src: 'app', r, n?, ok? }] }. r = ok, apagado (la pareja lo tiene
// apagado), sin-telefono, sin-configurar, emulador, worker-<código>, error o los códigos de cada teléfono. Sin textos.
export function logNotif(e) {
  if (!S.me) return;
  const day = todayKey(), item = { at: Date.now(), by: S.me.uid, src: 'app' };
  for (const [k, v] of Object.entries(e)) if (v !== undefined && v !== null) item[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  setDoc(logRef('notiflog', day), { day, list: arrayUnion(item) }, { merge: true }).catch(() => {});
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
  setDoc(newLogRef('perf'), { uid: S.me.uid, at: start, day: dayKey(new Date(start)), ...device(), online: navigator.onLine,
    conn: navigator.connection?.effectiveType || '', sw: !!navigator.serviceWorker?.controller,
    dom: nav ? Math.round(nav.domContentLoadedEventEnd) : null, t: perf.t,
    photos: { n: p.n, avg: p.n ? Math.round(p.sum / p.n) : 0, max: Math.round(p.max), fail: p.fail } }).catch(() => {});
}
setTimeout(sendPerf, 30000);

const flushAll = () => { flushUsage(); flushActions(); flushSession(); };

/* ---------- Avisos que se tocaron (push.js: al abrir la app desde un aviso) ---------- */
logHooks.opened = type => { if (S.me) logNotif({ type, src: 'tap', to: S.me.uid }); else setTimeout(() => S.me && logNotif({ type, src: 'tap', to: S.me.uid }), 3000); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { flushAll(); sendPerf(); } });
addEventListener('pagehide', () => { flushAll(); sendPerf(); });
setInterval(flushAll, 5 * 60e3);
