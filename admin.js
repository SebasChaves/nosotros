// Panel de administración (solo visible para TESTERS), en tres pestañas:
//   Ingresos (por día, horas, teléfonos, datos, errores) · Estadísticas (uso, notificaciones, quién hace más) · Pruebas.
import { query, where, orderBy, limit, getDocs, getCountFromServer, writeBatch, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, ask, col, ref, avatar, loadPhotos, nameOf, openSheet, celebrate,
         today, dayKey, todayKey, parseDate, fmtShort, fmtDay, plural, COLLECTIONS, uid, EMU, vnum, vlabel, auth, logCol, logRef, SECTIONS } from './core.js';
import { isTester, testerCard } from './testing.js';
import { giftAdminCards } from './gifts.js';
import { NOTIF_TYPES, pushHere, pushConfigured } from './push.js';
import { PUSH } from './push-config.js';
import { SPECIES, STAGES } from './pet.js';
import { sceneSVG, petSVG, ITEMS, SLOTS } from './pet-art.js';
import { GAMES, playGame } from './pet-games.js';
import { juegosHTML } from './admin-juegos.js';
import { vacAdminCard } from './vacations.js';

let range = 14, selDay = null, visits = [], errors = [], usage = [], stats = [], photoCount = null, loading = false, tab = 'ingresos';
const COLORS = ['var(--g1)', 'var(--g2)'];
const people = () => {
  const ids = Object.entries(S.settings.members || {}).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0)).map(([id]) => id);
  for (const v of visits) if (!ids.includes(v.uid)) ids.push(v.uid);
  return ids.slice(0, 4);
};
const hhmm = v => `${String(v.hour).padStart(2, '0')}:${String(v.min).padStart(2, '0')}`;
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const shortBrowser = b => (b || '').replace('Samsung Internet', 'Samsung').replace(/ \d+$/, '');
// Teléfono, sistema, navegador y versión del último ingreso, con avisos si algo puede dar problemas.
function deviceInfo(v) {
  if (!v) return '';
  const latest = window.FUTARI_VERSION, rows = [
    ['Teléfono', [v.model, v.os + (v.osVersion ? ' ' + v.osVersion : '')].filter(Boolean).join(' · ')],
    ['Navegador', v.browser || 'sin dato (versión vieja)'],
    ['Instalada', v.installed ? 'Sí, como app' : 'No, la abre desde el navegador'],
    ['Versión', v.app ? (v.app === latest ? `${vlabel(v.app)} (la última)` : vlabel(v.app)) : 'sin dato'],
  ];
  const warn = [];
  if (/Samsung/.test(v.browser || '')) warn.push('Usa Samsung Internet: los accesos directos y algunas funciones van mejor con Chrome. Conviene instalarla desde Chrome.');
  if (/otra app/.test(v.browser || '')) warn.push('La abrió desde dentro de otra app (por ejemplo un enlace en WhatsApp o Instagram). Mejor abrirla desde el ícono instalado.');
  if (!v.installed && (v.os === 'iPhone' || v.os === 'Android')) warn.push('No la tiene instalada: se pierden la pantalla completa y algunas funciones.');
  if (v.app && latest && vnum(v.app) < vnum(latest)) warn.push(`Tiene una versión vieja (${vlabel(v.app)}). Al abrir la app le sale el aviso para actualizar.`);
  return `<div class="adm-dev">${rows.map(([k, x]) => `<div><span class="tiny muted">${k}</span><span class="small">${esc(x)}</span></div>`).join('')}</div>
    ${warn.map(w => `<div class="adm-warn">⚠️ ${esc(w)}</div>`).join('')}`;
}

async function load() {
  if (loading) return; loading = true;
  const sinceDate = new Date(today().getFullYear(), today().getMonth(), today().getDate() - (range - 1)), since = sinceDate.getTime(), sinceKey = dayKey(sinceDate);
  try {
    const [vs, es, pc, us, st] = await Promise.all([
      getDocs(query(logCol('visits'), where('at', '>=', since), orderBy('at', 'desc'))),
      getDocs(query(logCol('errors'), orderBy('at', 'desc'), limit(100))),
      getCountFromServer(col('photos')).catch(() => null),
      getDocs(query(logCol('usage'), where('day', '>=', sinceKey))).catch(() => null),
      getDocs(query(col('stats'), where('day', '>=', sinceKey))).catch(() => null),
    ]);
    visits = vs.docs.map(d => ({ id: d.id, ...d.data() }));
    usage = us ? us.docs.map(d => d.data()) : [];
    stats = st ? st.docs.map(d => d.data()) : [];
    errors = es.docs.map(d => ({ id: d.id, ...d.data() }));
    photoCount = pc ? pc.data().count : null;
    // Registros que quedaron en la ruta vieja (couples/, antes de 1.12.1): se ofrece moverlos una vez
    oldLogs = (await Promise.all(LOG_COLS.map(c => getCountFromServer(col(c)).then(s => s.data().count).catch(() => 0)))).reduce((a, b) => a + b, 0);
    if (tab === 'bitacoras') await loadLogs(since, sinceKey);
  } catch (e) { console.error(e); toast('No se pudieron cargar los datos'); }
  loading = false; render();
}

/* ---------- Registros viejos ----------
   Hasta 1.12.0 los registros vivían en couples/nosotros/<col>, donde los dos pueden leer. Desde 1.12.1 viven en
   adminlogs/nosotros/<col> (solo el dueño lee). Esto copia lo viejo a la ruta nueva y después lo borra de la vieja. */
const LOG_COLS = ['visits', 'errors', 'usage', 'actions', 'perf', 'notiflog'];
let oldLogs = 0, migrating = false;
// usage, actions y notiflog tienen un doc por día: el día que se publicó 1.12.1 puede haber uno viejo y uno nuevo con el
// mismo id. En vez de pisar el nuevo, se suman los contadores y se juntan las listas.
const incMap = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'object' ? incMap(v) : increment(Number(v) || 0)]));
function mergeOld(c, d) {
  if (c === 'usage') return [{ uid: d.uid, day: d.day, total: increment(Number(d.total) || 0), secs: incMap(d.secs) }, { merge: true }];
  if (c === 'actions') return [{ uid: d.uid, day: d.day, n: incMap(d.n), ...(d.log?.length ? { log: arrayUnion(...d.log) } : {}) }, { merge: true }];
  if (c === 'notiflog') return [{ day: d.day, ...(d.list?.length ? { list: arrayUnion(...d.list) } : {}) }, { merge: true }];
  return [d];
}
async function admMigrate() {
  if (migrating) return;
  if (!(await ask(`¿Mover ${plural(oldLogs, 'registro viejo', 'registros viejos')} a la parte privada de administración? Se copian primero y después se borran de donde estaban.`, { ok: 'Mover' }))) return;
  migrating = true; render();
  let moved = 0;
  try {
    for (const c of LOG_COLS) {
      const docs = (await getDocs(col(c))).docs;
      for (let i = 0; i < docs.length; i += 400) { const b = writeBatch(db); docs.slice(i, i + 400).forEach(d => b.set(logRef(c, d.id), ...mergeOld(c, d.data()))); await b.commit(); }
      for (let i = 0; i < docs.length; i += 400) { const b = writeBatch(db); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
      moved += docs.length;
    }
    toast(`Listo: ${plural(moved, 'registro movido', 'registros movidos')} 🔒`);
  } catch (e) { console.error(e); toast(`Se movieron ${moved}; falló el resto (${e.code || e.message}). Toca de nuevo para seguir.`); }
  migrating = false; load();
}
const migrateCard = () => !oldLogs ? '' : `<div class="glass stack" style="border-color:rgba(255,181,71,.45)"><span class="label">🔒 Mover registros viejos</span>
  <p class="small" style="margin:0">Hay ${plural(oldLogs, 'registro', 'registros')} de antes de la versión 1.12.1 donde los dos pueden leerlos. Muévelos a la parte que solo ves tú.</p>
  <button class="btn small" onclick="admMigrate()" ${migrating ? 'disabled' : ''}>${migrating ? 'Moviendo…' : `Mover ${oldLogs}`}</button></div>`;

/* ---------- Bitácoras: se leen solo al abrir esa pestaña (cada registro es una lectura de Firebase) ---------- */
let logs = { actions: [], perf: [], notif: [], worker: null, workerMsg: '', key: '' }, sub = 'acciones';
async function loadLogs(since, sinceKey) {
  const [ac, pf, nl] = await Promise.all([
    getDocs(query(logCol('actions'), where('day', '>=', sinceKey))).catch(() => null),
    getDocs(query(logCol('perf'), where('at', '>=', since), orderBy('at', 'desc'), limit(300))).catch(() => null),
    getDocs(query(logCol('notiflog'), where('day', '>=', sinceKey))).catch(() => null),
  ]);
  logs.actions = ac ? ac.docs.map(d => d.data()) : [];
  logs.perf = pf ? pf.docs.map(d => d.data()) : [];
  logs.notif = nl ? nl.docs.flatMap(d => d.data().list || []) : [];
  logs.key = sinceKey;
  // Lo que anota el Worker (avisos programados, respaldos y sus errores) vive en su KV: se le pide con la sesión
  logs.worker = null; logs.workerMsg = '';
  if (EMU) { logs.workerMsg = 'En el emulador no hay servicio de Cloudflare.'; return; }
  if (!pushConfigured()) { logs.workerMsg = 'El servicio de avisos no está conectado.'; return; }
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(PUSH.url.replace(/\/$/, '') + '/bitacora', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: sinceKey }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) logs.worker = j;
    else logs.workerMsg = j.error === 'not-found' ? 'El Worker de Cloudflare es de una versión anterior: falta pegar la v15.' : j.error === 'no-kv' ? 'El Worker no tiene el espacio KV «RESPALDOS» conectado.' : `El Worker respondió ${r.status}${j.error ? ' (' + j.error + ')' : ''}.`;
  } catch (e) { logs.workerMsg = 'No se pudo hablar con el Worker: ' + (e.message || e); }
}

function render() {
  if (!isTester()) { paint('s-admin', '<p class="empty">Sin acceso</p>'); return; }
  const ids = people(), tk = todayKey();
  const days = [...Array(range)].map((_, i) => dayKey(new Date(today().getFullYear(), today().getMonth(), today().getDate() - i)));
  selDay ??= tk;
  const byDay = Object.fromEntries(days.map(d => [d, Object.fromEntries(ids.map(id => [id, visits.filter(v => v.day === d && v.uid === id).sort((a, b) => a.at - b.at)]))]));
  const maxDay = Math.max(1, ...days.map(d => ids.reduce((s, id) => s + byDay[d][id].length, 0)));
  const legend = `<div class="legend">${ids.map((id, i) => `<span><i style="background:${COLORS[i % 2]}"></i>${esc(nameOf(id))}</span>`).join('')}</div>`;

  // 1. Resumen por persona
  const summary = ids.map(id => {
    const mine = visits.filter(v => v.uid === id), last = mine[0];
    return `<div class="glass stack" style="gap:6px"><div class="row start" style="gap:8px">${avatar(id, 30)}<b>${esc(nameOf(id))}</b></div>
      <div class="small">${last ? `Último ingreso: <b>${ago(last.at)}</b> (${hhmm(last)})` : 'Sin ingresos en el periodo'}</div>
      <div class="small muted">Hoy: ${mine.filter(v => v.day === tk).length} · ${range} días: ${mine.length}</div>
      ${deviceInfo(last)}</div>`;
  }).join('');

  // 2. Gráfico por día (más antiguo a la izquierda)
  const chart = `<div class="adm-chart" role="img" aria-label="Ingresos por día">${[...days].reverse().map(d => {
    const total = ids.reduce((s, id) => s + byDay[d][id].length, 0);
    return `<button class="adm-col ${d === selDay ? 'on' : ''}" onclick="admDay('${d}')" title="${fmtShort(parseDate(d))}: ${total}">
      <span class="adm-n">${total || ''}</span>
      <span class="adm-stack" style="height:${Math.round(total / maxDay * 100)}%">${ids.map((id, i) => byDay[d][id].length ? `<i style="flex:${byDay[d][id].length};background:${COLORS[i % 2]}"></i>` : '').join('')}</span>
      <span class="adm-d">${parseDate(d).getDate()}</span></button>`;
  }).join('')}</div>`;

  // 3. Detalle del día elegido
  const detail = ids.map((id, i) => {
    const list = byDay[selDay]?.[id] || [];
    return `<div style="margin-top:8px"><div class="row"><span class="small"><i class="adm-dot" style="background:${COLORS[i % 2]}"></i>${esc(nameOf(id))}</span><span class="pill">${plural(list.length, 'ingreso', 'ingresos')}</span></div>
      <div class="chips" style="margin-top:6px">${list.map(v => `<span class="chip" style="padding:5px 10px;font-size:12.5px" title="${esc([v.model, v.os, v.browser, v.app && 'v' + vlabel(v.app)].filter(Boolean).join(' · '))}">${hhmm(v)} <span class="tiny muted">${v.os === 'iPhone' ? 'iOS' : v.os === 'Android' ? 'Android' : 'PC'}${v.browser ? ' · ' + esc(shortBrowser(v.browser)) : ''}</span></span>`).join('') || '<span class="small muted">—</span>'}</div></div>`;
  }).join('');

  // 4. Tabla de todos los días con las horas de cada uno
  const table = `<div style="overflow-x:auto"><table class="adm-table"><thead><tr><th>Día</th>${ids.map(id => `<th>${esc(nameOf(id))}</th>`).join('')}</tr></thead><tbody>
    ${days.map(d => `<tr class="${d === selDay ? 'on' : ''}" onclick="admDay('${d}')"><td>${capital(parseDate(d).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
      ${ids.map(id => { const l = byDay[d][id]; return `<td><b>${l.length}</b>${l.length ? `<span class="tiny muted"> · ${l.map(hhmm).join(' · ')}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div>`;

  // 5. Horas más activas
  const heat = ids.map((id, i) => {
    const h = [...Array(24)].map((_, k) => visits.filter(v => v.uid === id && v.hour === k).length), mx = Math.max(1, ...h);
    return `<div class="row start" style="gap:8px;margin-top:6px"><span class="tiny" style="width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nameOf(id))}</span>
      <div class="adm-heat">${h.map((n, k) => `<i title="${k}:00 · ${n}" style="background:${COLORS[i % 2]};opacity:${n ? .2 + .8 * n / mx : .06}"></i>`).join('')}</div></div>`;
  }).join('') + `<div class="row start" style="gap:8px"><span style="width:54px"></span><div class="adm-heat lbl">${[...Array(24)].map((_, k) => `<span>${k % 6 === 0 ? k : ''}</span>`).join('')}</div></div>`;

  // 6. Datos y espacio
  const counts = [['💌 Notas', 'notes'], ['📸 Momentos', 'moments'], ['🎟️ Cupones', 'coupons'], ['💸 Gastos', 'expenses'], ['✈️ Viajes', 'trips'], ['🍿 Pelis', 'shows'],
    ['🗓️ Planes', 'events'], ['🎲 Listas', 'lists'], ['✅ Bucket', 'bucket'], ['🛒 Súper', 'groceries'], ['💬 Respuestas', 'answers'], ['🔥 Cartas', 'cards']];
  const jsonBytes = COLLECTIONS.reduce((s, c) => s + JSON.stringify(S.data[c]).length, 0);
  const withPhoto = S.data.moments.filter(m => m.hasPhoto).length;
  const estMB = (jsonBytes + withPhoto * 230000 + (photoCount ?? 0) * 2000) / 1048576;
  const data = `<div class="grid2">${counts.map(([l, c]) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="small">${l}</span><b class="num">${S.data[c].length}</b></div>`).join('')}</div>
    <div class="stack" style="gap:6px;margin-top:10px"><div class="row"><span class="small">Espacio estimado</span><b class="num">≈ ${estMB.toFixed(1)} MB de 1.024 MB</b></div>
    <div class="progress"><i style="width:${Math.min(100, estMB / 1024 * 100).toFixed(1)}%"></i></div>
    <span class="tiny muted">${withPhoto} momentos con foto · ${photoCount ?? '?'} archivos de foto (incluye miniaturas y perfiles)</span></div>`;

  const head = `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-more')">${icon('back')}</button><h1>Admin</h1></div>
      <button class="btn ghost small" onclick="admReload()">${loading ? 'Cargando…' : 'Actualizar'}</button></div>
    <div class="seg adm-seg">${[['ingresos', 'Ingresos'], ['stats', 'Estadísticas'], ['bitacoras', '📒 Bitácoras'], ['juegos', '🎮 Juegos'], ['pruebas', 'Pruebas']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="admTab('${k}')">${l}</button>`).join('')}</div>
    ${!['pruebas', 'juegos'].includes(tab) ? `<div class="chips">${[7, 14, 30].map(n => `<button class="chip ${range === n ? 'on' : ''}" onclick="admRange(${n})">${n} días</button>`).join('')}</div>` : ''}`;
  if (tab === 'stats') { paint('s-admin', head + statsHTML(ids, days)); loadPhotos($('s-admin')); return; }
  if (tab === 'bitacoras') { paint('s-admin', head + logsHTML(ids, days)); return; }
  if (tab === 'pruebas') { paint('s-admin', head + testsHTML()); showVersion(); return; }
  if (tab === 'juegos') { paint('s-admin', head + juegosHTML()); return; }
  paint('s-admin', `${head}${migrateCard()}
    <div class="stack" style="gap:14px">${summary}</div>
    <div class="glass stack"><div class="row"><span class="label">Ingresos por día</span><span class="small muted">${visits.length} en ${range} días</span></div>${chart}${legend}</div>
    <div class="glass"><div class="row"><span class="label">${capital(fmtDay(parseDate(selDay)))}</span></div>${detail}</div>
    <div class="glass stack"><span class="label">Todos los días · horas de cada uno</span>${table}</div>
    <div class="glass stack"><span class="label">Horas más activas</span>${heat}</div>
    <div class="glass stack"><span class="label">Datos guardados</span>${data}</div>
    <div class="glass row"><span class="small">${errors.length ? `⚠️ ${plural(errors.length, 'error registrado', 'errores registrados')}` : 'Sin errores registrados 🎉'}</span>
      <button class="btn ghost small" onclick="admTab('bitacoras');admSub('errores')">Ver en Bitácoras</button></div>`);
  loadPhotos($('s-admin'));
}

/* ---------- Pestaña Pruebas: notificaciones, herramientas y zona de pruebas ---------- */
/* ---------- Mascota de pruebas: todo disponible, nada se guarda en Firebase ---------- */
const lab = { species: '🐱', stage: 3, egg: false, ready: false, mood: 'feliz', time: 'dia', fed: true, wear: {}, best: {} };
const labChips = (items, cur, fn) => `<div class="chips">${items.map(([v, l]) => `<button class="chip ${String(cur) === String(v) ? 'on' : ''}" onclick="${fn}('${v}')">${l}</button>`).join('')}</div>`;
function labHTML() {
  const stageVal = lab.egg ? (lab.ready ? 'listo' : 'huevo') : lab.stage;
  const scene = sceneSVG({ species: lab.species, mood: lab.mood, stage: lab.stage, wear: lab.wear, egg: lab.egg, ready: lab.ready, fed: lab.fed, time: lab.time, label: 'Mascota de pruebas' }).replace('<svg ', '<svg class="pet-scene big" ');
  return `<div class="glass stack" id="petLab" style="border-color:rgba(255,181,71,.45)"><span class="label">🧪 Mascota de pruebas</span>
    <p class="tiny muted" style="margin:0">Solo para probar: todo está desbloqueado y nada se guarda (no toca la mascota de ustedes, sus monedas ni sus récords).</p>
    <div class="pet-stage big">${scene}</div>
    <span class="label">Animal</span>${labChips(SPECIES.map(([e, n]) => [e, `${e} ${n}`]), lab.species, 'labSpecies')}
    <span class="label">Etapa</span>${labChips([['huevo', '🥚 Huevo'], ['listo', '🐣 Listo para nacer'], ...STAGES.slice(1).map(([, n], i) => [i + 1, n])], stageVal, 'labStage')}
    <span class="label">Cara</span>${labChips([['feliz', '😊 Feliz'], ['hambre', '😋 Con hambre'], ['triste', '😢 Triste'], ['dormido', '😴 Dormido']], lab.mood, 'labMood')}
    <span class="label">Hora</span>${labChips([['dia', '☀️ Día'], ['tarde', '🌇 Atardecer'], ['noche', '🌙 Noche']], lab.time, 'labTime')}
    <span class="label">Platito</span>${labChips([['1', 'Lleno'], ['0', 'Vacío']], lab.fed ? '1' : '0', 'labFed')}
    ${SLOTS.map(([slot, l]) => `<span class="label">${l}</span>${labChips([['', 'Nada'], ...ITEMS.filter(i => i.slot === slot).map(i => [i.id, i.name])], lab.wear[slot] || '', `labWear_${slot}`)}`).join('')}
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="labAll()">👗 Ponerle de todo</button><button class="btn ghost small" style="width:100%" onclick="labNone()">Quitarle todo</button>
      <button class="btn ghost small" style="width:100%" onclick="labHatch()">🐣 Ver nacimiento</button><button class="btn ghost small" style="width:100%" onclick="labRandom()">🎲 Al azar</button></div>
    <span class="label">Juegos (sin monedas ni récords reales)</span>
    <div class="grid2">${GAMES.map(g => `<button class="btn ghost small" style="width:100%" onclick="labGame('${g.id}')">${g.icon} ${esc(g.name)}${lab.best[g.id] ? ` · ${lab.best[g.id]}` : ''}</button>`).join('')}</div></div>`;
}
const labDo = f => (...a) => { f(...a); render(); };
const labSpecies = labDo(v => { lab.species = v; });
const labStage = labDo(v => { lab.egg = v === 'huevo' || v === 'listo'; lab.ready = v === 'listo'; if (!lab.egg) lab.stage = Number(v); });
const labMood = labDo(v => { lab.mood = v; });
const labTime = labDo(v => { lab.time = v; });
const labFed = labDo(v => { lab.fed = v === '1'; });
const labWearFns = Object.fromEntries(SLOTS.map(([slot]) => [`labWear_${slot}`, labDo(v => { lab.wear = { ...lab.wear, [slot]: v || null }; })]));
const labAll = labDo(() => { lab.wear = { head: 'corona', face: 'gafas', neck: 'bufanda', body: 'sueter', room: 'luces' }; });
const labNone = labDo(() => { lab.wear = {}; });
const labRandom = labDo(() => {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  lab.species = pick(SPECIES)[0]; lab.egg = false; lab.stage = 1 + Math.floor(Math.random() * 5);
  lab.mood = pick(['feliz', 'hambre', 'triste', 'dormido']); lab.time = pick(['dia', 'tarde', 'noche']);
  lab.wear = Object.fromEntries(SLOTS.map(([slot]) => [slot, Math.random() < .6 ? pick(ITEMS.filter(i => i.slot === slot)).id : null]));
});
function labHatch() {
  const [sp, name, art] = SPECIES[Math.floor(Math.random() * SPECIES.length)];
  celebrate();
  openSheet(`<div class="stack center"><svg viewBox="0 0 160 160" style="width:150px;height:150px;align-self:center" role="img" aria-label="${esc(name)}">${petSVG({ species: sp, mood: 'feliz', stage: 1 })}</svg>
    <h2>¡Nació ${art} ${esc(name)}!</h2><p class="muted" style="margin:0">Así se ve al nacer (prueba: no se guarda nada).</p>
    <button class="btn" onclick="closeSheet()">Listo</button></div>`);
}
function labGame(id) {
  playGame(id, { species: lab.species, stage: Math.max(2, lab.egg ? 2 : lab.stage), wear: { ...lab.wear, room: null } }, score => {
    const prev = lab.best[id] || 0; lab.best[id] = Math.max(prev, score);
    const g = GAMES.find(x => x.id === id);
    return { mine: lab.best[id], record: score > prev && prev > 0, note: `Modo prueba: en la versión real habría ganado ${Math.min(15, g.coins(score))} 🪙 (tope de 30 al día).` };
  });
}

function testsHTML() {
  return `${vacAdminCard()}
    ${giftAdminCards()}
    ${labHTML()}
    <div class="glass stack"><span class="label">🔔 Notificaciones</span>
      <p class="small muted" style="margin:0">${pushHere ? 'Activadas en este teléfono.' : 'No están activadas en este teléfono (Ajustes → Notificaciones).'}</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="testPush()">Probar aviso</button>
        <button class="btn ghost small" style="width:100%" onclick="diagnoseSchedule()">⏰ Avisos programados</button></div>
      <p class="tiny muted" style="margin:0">«Avisos programados» le pregunta al servicio de Cloudflare qué ve (hora, permiso de lectura, recordatorios de hoy) y te manda una prueba por el mismo camino que los recordatorios.</p></div>
    <div class="glass stack"><span class="label">Herramientas</span>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="admCsv()">⬇️ Ingresos (CSV)</button>
        <button class="btn ghost small" style="width:100%" onclick="admPurge()">🧹 Registros de +90 días</button>
        <button class="btn ghost small" style="width:100%" onclick="admForceUpdate()">🔄 Forzar actualización</button>
        <button class="btn ghost small" style="width:100%" onclick="startTour()">👋 Ver la guía</button></div>
      <p class="tiny muted" style="margin:0" id="admVersion">Proyecto: ${EMU ? 'emulador local' : 'nosotros-app-2e254'}</p></div>
    ${testerCard()}`;
}

/* ---------- Pestaña Estadísticas ---------- */
const SCREENS = { home: 'Inicio', decide: 'Decidir', moments: 'Momentos', love: 'Detalles', more: 'Más', settings: 'Ajustes', cal: 'Calendario', vac: 'Vacaciones',
  reminders: 'Recordatorios', music: 'Playlist', grocery: 'Súper', money: 'Gastos', trips: 'Viajes', trip: 'Viaje', places: 'Restaurantes',
  shows: 'Pelis y series', recipes: 'Recetas', map: 'Mapa', badges: 'Logros', game: 'Juego de retos', us: 'Gustos y regalos', quiz: 'Quiz',
  bucket: 'Bucket list', cravings: 'Antojos', arrows: 'Flechas', bus: 'La parada', pet: 'Mascota', summary: 'Resumen del año', gallery: 'Galería', search: 'Buscar', admin: 'Admin' };
const dur = s => { const m = Math.round(s / 60); return m < 1 ? (s ? '<1 min' : '0') : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim(); };
// Barra comparando a los dos (izquierda uno, derecha el otro)
const duel = (ids, vals, fmt = n => n) => {
  const tot = vals.reduce((a, b) => a + b, 0), w = tot ? Math.round(vals[0] / tot * 100) : 50;
  return `<div class="adm-duel ${tot ? '' : 'zero'}"><b class="num">${fmt(vals[0])}</b><div class="adm-duelbar" style="--w:${w}%">${tot ? `<i style="background:${COLORS[0]}"></i><i style="background:${COLORS[1]}"></i>` : ''}</div><b class="num">${fmt(vals[1] ?? 0)}</b></div>`;
};
function statsHTML(ids, days) {
  const inRange = d => d >= days[days.length - 1] && d <= days[0];
  const msInRange = ms => ms && inRange(dayKey(new Date(ms)));
  const names = `<div class="row"><span class="small"><i class="adm-dot" style="background:${COLORS[0]}"></i>${esc(nameOf(ids[0]))}</span>${ids[1] ? `<span class="small">${esc(nameOf(ids[1]))}<i class="adm-dot" style="background:${COLORS[1]};margin:0 0 0 6px"></i></span>` : ''}</div>`;

  // 1. Uso de la app
  const use = ids.map((id, i) => {
    const mine = usage.filter(u => u.uid === id), total = mine.reduce((s, u) => s + (u.total || 0), 0);
    const daysActive = new Set(visits.filter(v => v.uid === id).map(v => v.day)).size;
    const secs = {}; for (const u of mine) for (const [k, v] of Object.entries(u.secs || {})) secs[k] = (secs[k] || 0) + v;
    const top = Object.entries(secs).sort((a, b) => b[1] - a[1]).slice(0, 6), mx = Math.max(1, ...top.map(t => t[1]));
    const visitsN = visits.filter(v => v.uid === id).length;
    return `<div class="glass stack" style="gap:8px"><div class="row start" style="gap:8px">${avatar(id, 28)}<b>${esc(nameOf(id))}</b></div>
      <div class="grid2" style="gap:6px">
        <div class="adm-kpi"><b class="num">${dur(total)}</b><span class="tiny muted">en la app</span></div>
        <div class="adm-kpi"><b class="num">${daysActive}/${range}</b><span class="tiny muted">días que entró</span></div>
        <div class="adm-kpi"><b class="num">${daysActive ? dur(total / daysActive) : '0'}</b><span class="tiny muted">por día activo</span></div>
        <div class="adm-kpi"><b class="num">${visitsN}</b><span class="tiny muted">ingresos</span></div></div>
      ${top.length ? `<span class="tiny muted">Secciones donde pasa más tiempo</span>${top.map(([k, v]) => `<div class="adm-bar"><span class="small">${esc(SCREENS[k] || k)}</span><span class="adm-barline"><i style="width:${Math.round(v / mx * 100)}%;background:${COLORS[i % 2]}"></i></span><span class="tiny muted num">${dur(v)}</span></div>`).join('')}`
        : '<p class="tiny muted" style="margin:0">Todavía no hay tiempo registrado (se empezó a medir en esta versión).</p>'}</div>`;
  }).join('');

  // 2. Notificaciones (enviadas por quien las mandó; abiertas por quien las tocó)
  const sum = (kind, id, key) => stats.reduce((s, d) => s + (d[kind]?.[id]?.[key] || 0), 0);
  const SHORT = { snaps: '📸 Historias', reacts: '😍 Reacciones', notes: '💌 Notas', thinks: '❤️ Corazones', songs: '🎵 Canciones', coupons: '🎟️ Cupones',
    streak: '🔥 Racha', reminders: '🔔 Recordatorios', dates: '🎂 Fechas' };
  const notif = `<table class="adm-table adm-notif"><thead><tr><th>Aviso</th>${ids.map(id => `<th>${esc(nameOf(id))}</th>`).join('')}</tr></thead><tbody>
    ${NOTIF_TYPES.map(([k]) => `<tr><td>${SHORT[k] || k}</td>${ids.map(id => `<td><b>${sum('sent', id, k)}</b> <span class="muted">/ ${sum('opened', id, k)}</span></td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="tiny muted" style="margin:0"><b>mandó</b> / abrió: «mandó» son los avisos que esa persona generó para su pareja; «abrió», los que tocó.</p>
    <p class="tiny muted" style="margin:0">Los avisos programados (racha, recordatorios, fechas) los manda el servicio de Cloudflare, así que solo se cuentan cuando los abren. Se empezó a contar en esta versión.</p>`;

  // 3. Quién hace más (en el periodo)
  const D = S.data;
  const rows = [
    ['❤️ «Pensando en ti»', id => D.thinks.filter(t => inRange(t.id)).reduce((s, t) => s + (Number(t[id]) || 0), 0)],
    ['📸 Historias', id => sum('acts', id, 'snap')],
    ['😍 Reacciones', id => sum('acts', id, 'react')],
    ['💌 Notas', id => D.notes.filter(n => n.fromUid === id && msInRange(n.createdAt)).length],
    ['🎟️ Cupones regalados', id => D.coupons.filter(c => c.fromUid === id && msInRange(c.createdAt)).length],
    ['🎵 Canciones dedicadas', id => D.songs.filter(s => s.dedication?.by === id && msInRange(s.dedication.at)).length],
    ['🙂 Días con ánimo', id => D.moods.filter(m => inRange(m.id) && m[id]).length],
    ['💬 Preguntas respondidas', id => D.answers.filter(a => inRange(a.id) && a.answers?.[id]).length],
    ['⚡ Respondió primero', id => D.answers.filter(a => { if (!inRange(a.id)) return false; const x = a.answers || {}, o = ids.find(u => u !== id); return x[id]?.at && x[o]?.at && x[id].at < x[o].at; }).length],
    ['🔮 Aciertos (¿Qué respondería?)', id => { const o = ids.find(u => u !== id); return D.guess.filter(g => inRange(g.id) && g[id] && g[o] && g[id].guess === g[o].me).length; }],
    ['📷 Fotos del día', id => D.daily.filter(d => inRange(d.id) && d[id]).length],
    ['📚 Momentos guardados', id => D.moments.filter(m => m.by === id && msInRange(m.createdAt)).length],
    ['📌 Planes creados', id => D.events.filter(e => e.by === id && msInRange(e.createdAt)).length],
  ];
  const who = ids.length < 2 ? '<p class="small muted" style="margin:0">Hace falta que estén los dos.</p>'
    : names + rows.map(([l, f]) => { const v = ids.map(f); return `<div class="adm-who"><span class="small">${l}</span>${duel(ids, v)}</div>`; }).join('')
      + '<p class="tiny muted" style="margin:0">Historias y reacciones se cuentan desde esta versión (las historias se borran a las 24 h).</p>';

  return `<div class="glass stack"><span class="label">📱 Uso de la app · ${range} días</span>
      <p class="tiny muted" style="margin:0">Tiempo con Futari abierta y a la vista, por sección.</p></div>
    <div class="stack" style="gap:14px">${use}</div>
    <div class="glass stack"><span class="label">⚖️ Quién hace más · ${range} días</span>${who}</div>
    <div class="glass stack"><span class="label">🔔 Notificaciones · ${range} días</span>${notif}</div>`;
}
/* ---------- Pestaña Bitácoras ---------- */
const COL_NAMES = { bucket: 'Bucket list', ideas: 'Ideas de citas', notes: 'Notas', coupons: 'Cupones', dates: 'Fechas', moments: 'Momentos', lists: 'Decidir',
  answers: 'Pregunta del día', moods: 'Ánimo', challenges: 'Reto semanal', groceries: 'Súper', expenses: 'Gastos', places: 'Restaurantes', trips: 'Viajes',
  quiz: 'Quiz', profiles: 'Perfil y ajustes', shows: 'Pelis y series', events: 'Planes', cards: 'Cartas del juego', games: 'Juego de retos', thinks: '«Pensando en ti»',
  daily: 'Foto del día', pins: 'Mapa', recipes: 'Recetas', recipefav: 'Recetas favoritas', menu: 'Menú', songs: 'Playlist', reminders: 'Recordatorios', snaps: 'Historias',
  pet: 'Mascota', guess: '¿Qué respondería?', cravings: 'Antojos', arrows: 'Flechas', bus: 'La parada', money: 'Presupuesto y alcancías', cooked: 'Las que hicimos',
  dreams: 'Por conocer', vacations: 'Vacaciones', fruta: 'Pura fruta', advent: 'Calendario de adviento', _couple: 'Ajustes de los dos', _auth: 'Sesión', sorpresa: 'Momento sorpresa', diary: 'Diario', liga: 'Liga y racha' };
const OPS = { a: ['➕', 'agregó'], e: ['✏️', 'cambió'], d: ['🗑️', 'borró'], u: ['↩️', 'deshizo el borrado'], x: ['🚪', 'cerró sesión'] };
// Pantalla a la que lleva «Ir» en cada fila
const COL_SCREEN = { moments: 's-moments', expenses: 's-money', money: 's-money', events: 's-cal', vacations: 's-cal', cravings: 's-cravings', groceries: 's-grocery',
  places: 's-places', trips: 's-trips', dreams: 's-trips', shows: 's-shows', songs: 's-music', reminders: 's-reminders', recipes: 's-recipes', recipefav: 's-recipes', menu: 's-recipes',
  cooked: 's-recipes', pins: 's-map', pet: 's-pet', lists: 's-decide', bucket: 's-bucket', notes: 's-love', coupons: 's-love', profiles: 's-settings', _couple: 's-settings',
  advent: 's-advent', diary: 's-diary', liga: 's-liga', sorpresa: 's-home', arrows: 's-arrows', bus: 's-bus', fruta: 's-fruta', quiz: 's-quiz', cards: 's-game', games: 's-game' };
// Nombre en español de cada campo: primero la ruta completa (o su comienzo), después la última parte
const FIELD = {
  'prefs.myNick': 'su apodo', 'prefs.partnerNick': 'el apodo de su pareja', 'prefs.accent': 'el color', 'prefs.customAccent': 'el color propio',
  'prefs.theme': 'el tema', 'prefs.textSize': 'el tamaño de letra', 'prefs.bg': 'la foto de fondo', 'prefs.season': 'el estilo navideño',
  'prefs.menu.bar': 'la barra de abajo', 'prefs.menu.order': 'el orden de Más', 'prefs.menu.hidden': 'lo escondido en Más', 'prefs.home': 'las tarjetas de Inicio',
  'prefs.notif': 'las notificaciones', 'prefs.counter': 'el contador', 'prefs.watch': 'el buscador de pelis', avatar: 'la foto de perfil', likes: 'sus gustos',
  superAt: '«Voy al súper»', 'prefs.tour': 'la guía', 'prefs.tourV': 'la guía (versión vista)', 'prefs.tourGates': 'la guía', 'prefs.unwrapped': 'los regalos abiertos',
  'prefs.vacHigh': 'el aviso de vacaciones', 'prefs.moneyTour': 'la guía de Gastos',
  'adv.range': 'el rango de los regalitos', lastBackup: 'el último respaldo', features: 'lo compartido desde Administración', 'vac.cfg': 'la configuración de vacaciones',
  'vac.holOff': 'los feriados quitados', 'vac.holAdd': 'los feriados agregados', currency: 'la moneda', start: 'la fecha de inicio',
};
const KEYS = { title: 'el título', name: 'el nombre', text: 'el texto', note: 'la nota', notes: 'las notas', amount: 'el monto', price: 'el precio', date: 'la fecha', time: 'la hora',
  emoji: 'el emoji', done: 'hecho', status: 'el estado', cat: 'la categoría', category: 'la categoría', place: 'el lugar', who: 'quién', end: 'el final', url: 'el enlace',
  rating: 'la calificación', votes: 'los votos', hint: 'la pista', react: 'la reacción', thanks: 'el agradecimiento', fav: 'el favorito', mood: 'el ánimo', q: 'la pregunta',
  answer: 'la respuesta', limit: 'el límite', target: 'la meta', saved: 'lo ahorrado', type: 'el tipo', days: 'los días', half: 'medio día', budget: 'el presupuesto',
  qty: 'la cantidad', store: 'la tienda', link: 'el enlace', address: 'la dirección', city: 'la ciudad', country: 'el país', season: 'la temporada', ep: 'el capítulo',
  urgent: 'urgente', expires: 'el vencimiento', used: 'usado', level: 'el nivel', score: 'los puntos', coins: 'las monedas' };
function fieldName(c, p) {
  if (FIELD[p]) return FIELD[p];
  const pre = Object.keys(FIELD).find(k => p.startsWith(k + '.')); if (pre) return FIELD[pre];
  const mem = p.match(/^members\.([^.]+)\.name$/); if (mem) return `el nombre de ${nameOf(mem[1])}`;
  const last = p.split('.').pop();
  return KEYS[last] || p;
}
// Valores guardados con clave que se leen mejor en español
const VALS = { 'prefs.theme': { dark: 'Oscuro', light: 'Claro', auto: 'Automático' }, 'prefs.textSize': { n: 'Normal', g: 'Grande', xg: 'Más grande' } };
const fval = (p, v) => v === '' || v === undefined || v === null ? '—' : v === true ? 'sí' : v === false ? 'no' : `«${VALS[p]?.[v] || v}»`;
const fieldLine = (c, f) => `<div class="tiny adm-field"><span class="muted">${esc(capital(fieldName(c, f.p)))}:</span> ${f.ph ? `${esc(f.ph)} 📷` : `${esc(fval(f.p, f.b))} → <b>${esc(fval(f.p, f.a))}</b>`}</div>`;
let fWho = '', fOp = '', fCol = '', fAuto = false;
const NOTIF_NAMES = Object.fromEntries(NOTIF_TYPES.map(([k, l]) => [k, l.split(' (')[0]]));
const RES = { ok: 'entregado', apagado: 'lo tiene apagado', 'sin-telefono': 'sin teléfono con avisos', 'sin-configurar': 'servicio sin conectar', emulador: 'emulador (no se manda)', error: 'error de conexión' };
const ERR_KINDS = { js: 'Código', promesa: 'Promesa', guardar: 'Guardar', escuchar: 'Sincronizar', foto: 'Foto' };
const tm = ms => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const dayLbl = ms => capital(new Date(ms).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }));
const secs = ms => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y), h = s.length >> 1; return !s.length ? null : s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
// Lista agrupada por día (lo más nuevo arriba), con «Ver más» para no pintar cientos de filas
let logMore = 60;
function byDayList(items, row) {
  const shown = items.slice(0, logMore); let last = '';
  const html = shown.map(x => { const d = dayKey(new Date(x.at)), h = d !== last ? `<li class="adm-logday"><span class="label">${dayLbl(x.at)}</span></li>` : ''; last = d; return h + row(x); }).join('');
  return `<ul class="list adm-log">${html}</ul>${items.length > logMore ? `<button class="btn ghost small" onclick="admMore()">Ver más (${items.length - logMore})</button>` : ''}`;
}
function logsHTML(ids, days) {
  const tabs = [['acciones', 'Acciones'], ['sesiones', 'Sesiones'], ['errores', 'Errores'], ['avisos', 'Avisos'], ['respaldos', 'Respaldos'], ['rendimiento', 'Rendimiento']];
  const nav = `<div class="chips scroll">${tabs.map(([k, l]) => `<button class="chip ${sub === k ? 'on' : ''}" onclick="admSub('${k}')">${l}</button>`).join('')}</div>`;
  if (loading && !logs.key) return nav + '<p class="small muted">Cargando…</p>';
  const body = { acciones: actionsHTML, sesiones: sessionsHTML, errores: errorsHTML, avisos: notifsHTML, respaldos: backupsHTML, rendimiento: perfHTML }[sub](ids, days);
  return nav + body;
}
function actionsHTML(ids) {
  const per = ids.map((id, i) => {
    const mine = logs.actions.filter(a => a.uid === id), tot = {}, ops = { a: 0, e: 0, d: 0 };
    for (const a of mine) for (const [c, o] of Object.entries(a.n || {})) for (const [k, v] of Object.entries(o)) { tot[c] = (tot[c] || 0) + v; ops[k] = (ops[k] || 0) + v; }
    const top = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = Math.max(1, ...top.map(t => t[1]));
    return `<div class="glass stack" style="gap:8px"><div class="row start" style="gap:8px">${avatar(id, 28)}<b>${esc(nameOf(id))}</b></div>
      <div class="grid2" style="gap:6px;grid-template-columns:repeat(3,1fr)">${['a', 'e', 'd'].map(k => [k, OPS[k]]).map(([k, [e, l]]) => `<div class="adm-kpi"><b class="num">${ops[k] || 0}</b><span class="tiny muted">${e} ${l}</span></div>`).join('')}</div>
      ${top.length ? `<span class="tiny muted">Dónde hizo más cosas</span>${top.map(([c, v]) => `<div class="adm-bar"><span class="small">${esc(COL_NAMES[c] || c)}</span><span class="adm-barline"><i style="width:${Math.round(v / mx * 100)}%;background:${COLORS[i % 2]}"></i></span><span class="tiny muted num">${v}</span></div>`).join('')}`
        : '<p class="tiny muted" style="margin:0">Sin acciones registradas en el periodo.</p>'}</div>`;
  }).join('');
  const all = allActs();
  // Resumen de hoy: cuántas cosas hizo cada uno, dónde y qué ajustes cambió
  const tk = todayKey(), todays = all.filter(x => dayKey(new Date(x.at)) === tk && !x.auto);
  const sumToday = ids.map(id => {
    const m = todays.filter(x => x.uid === id); if (!m.length) return `<div class="small"><b>${esc(nameOf(id))}</b> <span class="muted">· nada todavía</span></div>`;
    const byCol = {}; for (const x of m) if (x.o !== 'x') byCol[x.c] = (byCol[x.c] || 0) + 1;
    const set = m.filter(x => ['profiles', '_couple'].includes(x.c) && x.f?.length).flatMap(x => x.f.map(f => fieldName(x.c, f.p)));
    return `<div class="small"><b>${esc(nameOf(id))}</b> · ${plural(m.length, 'acción', 'acciones')}<span class="muted"> · ${Object.entries(byCol).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${esc(COL_NAMES[c] || c)}${n > 1 ? ' ×' + n : ''}`).join(', ')}${set.length ? ` · cambió ${esc([...new Set(set)].slice(0, 3).join(', '))}` : ''}</span></div>`;
  }).join('');
  // Filtros
  const cols = [...new Set(all.map(x => x.c))].sort((a, b) => (COL_NAMES[a] || a).localeCompare(COL_NAMES[b] || b));
  const list = all.filter(x => (!fWho || x.uid === fWho) && (!fCol || x.c === fCol) && (fAuto || !x.auto)
    && (!fOp || (fOp === 'auto' ? x.auto : x.o === fOp)));
  const nAuto = all.filter(x => x.auto).length;
  const chip = (on, fn, l) => `<button class="chip ${on ? 'on' : ''}" onclick="${fn}">${l}</button>`;
  const filters = `<div class="chips scroll">${chip(!fWho, "admF('who','')", 'Los dos')}${ids.map(id => chip(fWho === id, `admF('who','${id}')`, esc(nameOf(id)))).join('')}</div>
    <div class="chips scroll">${chip(!fOp, "admF('op','')", 'Todo')}${['a', 'e', 'd', 'u', 'x'].map(o => chip(fOp === o, `admF('op','${o}')`, `${OPS[o][0]} ${OPS[o][1]}`)).join('')}</div>
    <div class="row" style="gap:8px"><select class="adm-sel" aria-label="Sección" onchange="admF('col',this.value)"><option value="">Todas las secciones</option>${cols.map(c => `<option value="${esc(c)}" ${fCol === c ? 'selected' : ''}>${esc(COL_NAMES[c] || c)}</option>`).join('')}</select>
      <label class="tiny muted" style="display:flex;gap:6px;align-items:center;white-space:nowrap"><input type="checkbox" ${fAuto ? 'checked' : ''} onchange="admF('auto',this.checked)"> ⚙️ Automáticos (${nAuto})</label></div>`;
  return `<div class="glass stack" style="gap:6px"><span class="label">Hoy</span>${sumToday}</div>
    <div class="stack" style="gap:14px">${per}</div>
    <div class="glass stack"><span class="label">Qué hizo cada uno</span>
      <p class="tiny muted" style="margin:0">Cada teléfono anota lo que hace su dueño: qué cambió (antes → ahora), qué agregó o borró, desde qué teléfono. ⚙️ = lo guardó la app sola. Se sube cada 5 minutos o al salir de la app.</p>
      ${filters}${list.length ? byDayList(list, actRow) : '<p class="small muted" style="margin:0">No hay acciones con estos filtros.</p>'}</div>`;
}
const allActs = () => logs.actions.flatMap(a => (a.log || []).map(x => ({ ...x, uid: a.uid }))).sort((a, b) => b.at - a.at);
function actRow(x) {
  const [e, verb] = OPS[x.o] || ['•', x.o], where = x.o === 'x' ? '' : ` en ${esc(COL_NAMES[x.c] || x.c)}`;
  const go = COL_SCREEN[x.c] && !['d', 'x'].includes(x.o) ? `<button class="btn ghost small adm-go" onclick="go('${COL_SCREEN[x.c]}')">Ir</button>` : '';
  return `<li style="display:block"><div class="row start" style="gap:6px;align-items:flex-start"><span class="small" style="flex:1">${x.auto ? '⚙️' : e} <b>${esc(nameOf(x.uid))}</b> ${verb}${where}${x.t ? ` · «${esc(x.t)}»` : ''}</span>
      <span class="tiny muted num">${tm(x.at)}</span>${go}</div>
    ${(x.f || []).map(f => fieldLine(x.c, f)).join('')}
    ${x.d || x.v ? `<div class="tiny muted">${esc([x.d, x.v && 'v' + vlabel(x.v)].filter(Boolean).join(' · '))}${x.auto ? ' · automático' : ''}</div>` : ''}</li>`;
}
/* Sesiones: cada ingreso con su duración, las pantallas que abrió y lo que hizo en ese rato */
function sessionsHTML(ids) {
  const acts = allActs();
  const list = visits.filter(v => !fWho || v.uid === fWho);
  const nf = list.filter(v => v.newDev).length;
  const who = `<div class="chips scroll"><button class="chip ${!fWho ? 'on' : ''}" onclick="admF('who','')">Los dos</button>${ids.map(id => `<button class="chip ${fWho === id ? 'on' : ''}" onclick="admF('who','${id}')">${esc(nameOf(id))}</button>`).join('')}</div>`;
  const row = v => {
    const end = v.end || v.at, mins = v.secs ? Math.max(1, Math.round(v.secs / 60)) : null;
    const mine = acts.filter(x => x.uid === v.uid && x.at >= v.at - 5000 && x.at <= end + 60e3 && !x.auto);
    const path = (v.path || []).map(p => SECTIONS.find(([k]) => k === 's-' + p)?.[2] || { home: 'Inicio', more: 'Más', settings: 'Ajustes' }[p] || p);
    return `<li style="display:block"><div class="row start" style="gap:6px;flex-wrap:wrap"><span class="small"><b>${esc(nameOf(v.uid))}</b> · ${tm(v.at)}${v.end ? ` – ${tm(v.end)}` : ''}${mins ? ` <span class="muted">(${mins} min)</span>` : ''}</span>
        ${v.newDev ? '<span class="pill" style="border-color:rgba(255,181,71,.6)">📱 teléfono nuevo</span>' : ''}${mine.length ? `<span class="pill">${plural(mine.length, 'acción', 'acciones')}</span>` : ''}</div>
      <div class="tiny muted">${esc([v.model || v.os, shortBrowser(v.browser), v.app && 'v' + vlabel(v.app), v.installed === false ? 'sin instalar' : ''].filter(Boolean).join(' · '))}</div>
      ${path.length ? `<div class="tiny">${esc(path.join(' → '))}</div>` : ''}
      ${mine.length ? `<details><summary class="tiny muted">Qué hizo</summary><ul class="list adm-log">${mine.map(actRow).join('')}</ul></details>` : ''}</li>`;
  };
  return `${who}<div class="glass stack"><span class="label">Sesiones · ${range} días</span>
      <p class="tiny muted" style="margin:0">Cada vez que abre la app (o vuelve después de 20 minutos): cuánto rato la tuvo a la vista, por qué pantallas pasó y qué hizo. La duración y las pantallas se empezaron a guardar en la 1.18.0.${nf ? ` · 📱 ${plural(nf, 'ingreso', 'ingresos')} desde un teléfono nuevo.` : ''}</p>
      ${list.length ? byDayList(list, row) : '<p class="small muted" style="margin:0">Sin ingresos en el periodo.</p>'}</div>`;
}
function errorsHTML() {
  if (!errors.length) return '<div class="glass"><p class="small muted" style="margin:0">Sin errores registrados 🎉</p></div>';
  const kinds = {}; for (const e of errors) kinds[e.kind || 'js'] = (kinds[e.kind || 'js'] || 0) + (e.count || 1);
  const list = byDayList(errors, e => `<li style="display:block"><div class="row start" style="gap:6px;flex-wrap:wrap"><span class="pill">${esc(ERR_KINDS[e.kind] || 'Código')}</span>${(e.count || 1) > 1 ? `<span class="pill">×${e.count}</span>` : ''}${e.code ? `<span class="pill">${esc(e.code)}</span>` : ''}${e.online === false ? '<span class="pill">sin internet</span>' : ''}<span class="tiny muted" style="margin-left:auto">${tm(e.at)}</span></div>
    <div class="small" style="margin-top:4px;word-break:break-word">${esc(e.message)}</div>
    <div class="tiny muted">${esc(nameOf(e.uid))} · ${esc((e.screen || '').replace(/^s-/, ''))}${e.where ? ' · ' + esc(e.where) : ''} · ${esc([e.model || e.os, e.browser, e.app && 'v' + vlabel(e.app)].filter(Boolean).join(' · '))}</div>
    ${e.trail?.length ? `<div class="tiny muted">Venía de: ${esc(e.trail.join(' → '))}</div>` : ''}
    ${e.stack ? `<details><summary class="tiny muted">Detalle técnico</summary><pre class="adm-pre">${esc(e.stack)}</pre></details>` : ''}</li>`);
  return `<div class="glass stack"><span class="label">Errores · últimos ${errors.length}</span>
      <div class="chips">${Object.entries(kinds).map(([k, n]) => `<span class="chip" style="cursor:default">${esc(ERR_KINDS[k] || k)} · ${n}</span>`).join('')}</div>
      <p class="tiny muted" style="margin:0">Código = error del programa · Guardar = Firebase no guardó · Sincronizar = falló la conexión en vivo · Foto = no se pudo abrir una foto. Si se repite, se suma (×).</p>
      ${list}<button class="btn ghost small" onclick="admClearErrors()">Borrar errores</button></div>`;
}
function notifsHTML(ids) {
  const wk = logs.worker ? Object.values(logs.worker.days).flatMap(d => (d.notifs || []).map(x => ({ ...x, src: 'worker' }))) : [];
  const taps = logs.notif.filter(x => x.src === 'tap');
  const all = [...logs.notif.filter(x => x.src !== 'tap'), ...wk].sort((a, b) => b.at - a.at);
  const ok =all.filter(x => x.r === 'ok' || (x.src === 'worker' && x.ok > 0)).length, off = all.filter(x => x.r === 'apagado').length;
  const failed = all.length - ok - off - all.filter(x => x.r === 'emulador').length;
  const res = x => x.src === 'worker' ? (x.ok ? `entregado${x.n > 1 ? ` (${x.ok}/${x.n})` : ''}` : `no llegó (${x.r || 'sin teléfono'})`) : x.r === 'ok' ? `entregado${x.n > 1 ? ` (${x.ok}/${x.n})` : ''}` : RES[x.r] || (x.r?.startsWith('worker-') ? `el Worker respondió ${x.r.slice(7)}` : `no llegó (${x.r})`);
  const good = x => x.r === 'ok' || (x.src === 'worker' && x.ok > 0);
  const mixed = [...all, ...taps].sort((a, b) => b.at - a.at);
  const list = mixed.length ? byDayList(mixed, x => x.src === 'tap' ? `<li><div class="txt"><span class="small">👆 <b>${esc(nameOf(x.by))}</b> abrió un aviso de ${esc(NOTIF_NAMES[x.type] || x.type)}</span><span class="sub">Tocó el aviso y entró a la app</span></div><span class="tiny muted num">${tm(x.at)}</span></li>` : `<li><div class="txt"><span class="small">${good(x) ? '✅' : x.r === 'apagado' || x.r === 'emulador' ? '⚪' : '❌'} ${esc(NOTIF_NAMES[x.type] || x.type)}</span>
      <span class="sub">${x.src === 'worker' ? '⏰ Programado' : esc(nameOf(x.by))} → ${esc(x.by === x.to ? 'sí mismo (prueba)' : nameOf(x.to))} · ${esc(res(x))}${x.gone ? ` · ${plural(x.gone, 'teléfono viejo borrado', 'teléfonos viejos borrados')}` : ''}${x.d ? ' · ' + esc(x.d) : ''}</span></div><span class="tiny muted num">${tm(x.at)}</span></li>`)
    : '<p class="small muted" style="margin:0">Todavía no hay avisos registrados.</p>';
  return `<div class="glass stack"><span class="label">🔔 Avisos · ${range} días</span>
      <div class="grid2" style="gap:6px;grid-template-columns:repeat(3,1fr)"><div class="adm-kpi"><b class="num">${ok}</b><span class="tiny muted">✅ entregados</span></div>
        <div class="adm-kpi"><b class="num">${Math.max(0, failed)}</b><span class="tiny muted">❌ no llegaron</span></div><div class="adm-kpi"><b class="num">${off}</b><span class="tiny muted">⚪ apagados</span></div></div>
      <p class="small" style="margin:0">👆 ${plural(taps.length, 'aviso abierto', 'avisos abiertos')} (tocaron el aviso y entraron a la app)</p>
      ${logs.worker ? '' : `<p class="tiny muted" style="margin:0">⏰ Programados: ${esc(logs.workerMsg || 'sin datos del Worker.')}</p>`}
      <p class="tiny muted" style="margin:0">«Entregado» quiere decir que el servicio del teléfono (Apple o Google) lo recibió; si el teléfono lo mostró depende de él. Se anota el tipo y para quién, no el texto.</p>
      ${list}</div>`;
}
function backupsHTML() {
  if (!logs.worker) return `<div class="glass stack"><span class="label">💾 Respaldos</span><p class="small muted" style="margin:0">${esc(logs.workerMsg || 'Sin datos del Worker.')}</p></div>`;
  const b = logs.worker.backup || {}, days = Object.entries(logs.worker.days);
  const runs = days.flatMap(([, d]) => d.backup || []).sort((a, x) => x.at - a.at);
  const errs = days.flatMap(([, d]) => d.errors || []).sort((a, x) => x.at - a.at);
  const st = b.state || {};
  return `<div class="glass stack"><span class="label">💾 Respaldo de cada noche</span>
      <div class="grid2" style="gap:6px"><div class="adm-kpi"><b class="num">${(b.days || []).length}</b><span class="tiny muted">días guardados</span></div>
        <div class="adm-kpi"><b class="num">${b.photos ?? '—'}</b><span class="tiny muted">fotos copiadas</span></div></div>
      <p class="small" style="margin:0">${st.dataDone ? `Último: ${esc(st.day || '')}, completo ✅` : st.day ? `Hoy (${esc(st.day)}) va por ${st.idx || 0} de ${st.total || '?'} colecciones` : 'Todavía no hay respaldos.'}${b.pendingPhotos ? ` · ${b.pendingPhotos} fotos en cola` : ''}</p>
      ${(b.days || []).length ? `<ul class="list">${b.days.map(m => `<li><div class="txt"><span class="small">${esc(capital(parseDate(m.day).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })))}</span><span class="sub">${Object.values(m.counts || {}).reduce((a, x) => a + x, 0)} documentos · ${Object.keys(m.counts || {}).length} colecciones</span></div><span class="tiny muted num">${m.at ? tm(m.at) : ''}</span></li>`).join('')}</ul>` : ''}</div>
    <div class="glass stack"><span class="label">Bitácora del respaldo · ${range} días</span>
      ${runs.length ? byDayList(runs, x => `<li><div class="txt"><span class="small">${x.kind === 'fotos' ? `📷 Fotos: ${x.copied} nuevas (${x.total} en total)` : `🗂️ Datos: ${x.docs} documentos de ${x.cols} colecciones`}</span><span class="sub">${x.manual ? '«Respaldar ahora»' : 'Automático'}</span></div><span class="tiny muted num">${tm(x.at)}</span></li>`)
        : '<p class="small muted" style="margin:0">Sin registros todavía (se empezó a anotar con el Worker v15).</p>'}</div>
    <div class="glass stack"><span class="label">Errores del Worker</span>
      ${errs.length ? byDayList(errs, x => `<li><div class="txt"><span class="small">${esc(x.where === 'respaldo' ? '💾 Respaldo' : '⏰ Avisos programados')}</span><span class="sub" style="word-break:break-word">${esc(x.msg)}</span></div><span class="tiny muted num">${tm(x.at)}</span></li>`)
        : '<p class="small muted" style="margin:0">Sin errores 🎉</p>'}
      <p class="tiny muted" style="margin:0">Si el mismo error se repite, se anota como máximo una vez por hora.</p></div>`;
}
function perfHTML(ids) {
  const P = logs.perf;
  if (!P.length) return '<div class="glass"><p class="small muted" style="margin:0">Todavía no hay mediciones (se toman a los 30 s de abrir la app).</p></div>';
  const per = ids.map(id => {
    const mine = P.filter(p => p.uid === id);
    if (!mine.length) return '';
    const ph = mine.filter(p => p.photos?.n);
    return `<div class="glass stack" style="gap:8px"><div class="row start" style="gap:8px">${avatar(id, 28)}<b>${esc(nameOf(id))}</b><span class="tiny muted" style="margin-left:auto">${plural(mine.length, 'apertura', 'aperturas')}</span></div>
      <div class="grid2" style="gap:6px">
        <div class="adm-kpi"><b class="num">${secs(median(mine.map(p => p.t?.cache)))}</b><span class="tiny muted">datos del teléfono</span></div>
        <div class="adm-kpi"><b class="num">${secs(median(mine.map(p => p.t?.server)))}</b><span class="tiny muted">datos del servidor</span></div>
        <div class="adm-kpi"><b class="num">${secs(median(mine.map(p => p.t?.ready)))}</b><span class="tiny muted">todo listo</span></div>
        <div class="adm-kpi"><b class="num">${ph.length ? secs(median(ph.map(p => p.photos.avg))) : '—'}</b><span class="tiny muted">por foto</span></div></div>
      <span class="tiny muted">Valores típicos (la mediana). ${mine.filter(p => !p.online).length ? `${mine.filter(p => !p.online).length} veces sin internet. ` : ''}${mine.some(p => p.conn) ? `Conexión: ${esc([...new Set(mine.map(p => p.conn).filter(Boolean))].join(', '))}.` : ''}</span></div>`;
  }).join('');
  const list = byDayList(P, p => `<li><div class="txt"><span class="small">${esc(nameOf(p.uid))} · todo listo en <b>${secs(p.t?.ready)}</b></span>
      <span class="sub">teléfono ${secs(p.t?.cache)} · servidor ${secs(p.t?.server)}${p.photos?.n ? ` · ${p.photos.n} fotos, ${secs(p.photos.avg)} c/u (máx. ${secs(p.photos.max)})` : ''}${p.photos?.fail ? ` · ${p.photos.fail} sin cargar` : ''}</span>
      <span class="sub">${esc([p.model || p.os, p.browser, p.installed ? 'instalada' : 'navegador', p.conn, p.online ? '' : 'sin internet', p.app && 'v' + vlabel(p.app)].filter(Boolean).join(' · '))}</span></div><span class="tiny muted num">${tm(p.at)}</span></li>`);
  return `<div class="stack" style="gap:14px">${per}</div>
    <div class="glass stack"><span class="label">⚡ Cada vez que se abrió</span>
      <p class="tiny muted" style="margin:0">Tiempo desde que se toca el ícono: «teléfono» = primeros datos guardados en el teléfono; «servidor» = primeros datos de internet; «todo listo» = todas las secciones con datos (la animación de entrada dura ~2 s aparte). La conexión solo la da Android.</p>${list}</div>`;
}

async function showVersion() {
  try { const t = await (await fetch('sw.js', { cache: 'no-store' })).text(); const v = t.match(/CACHE = '([^']+)'/)?.[1]; const el = $('admVersion'); if (el && v) el.textContent += ` · versión ${v.replace('nosotros-v', '')}`; } catch {}
}

function admRange(n) { range = n; load(); }
window.admRender = () => { if ($('s-admin')?.classList.contains('active')) render(); };
on('fruta arrows bus', () => { if (tab === 'juegos' && $('s-admin')?.classList.contains('active')) render(); });
function admTab(t) { tab = t; render(); window.scrollTo?.(0, 0); if (t === 'bitacoras') load(); }
function admSub(s) { sub = s; logMore = 60; render(); }
function admMore() { logMore += 100; render(); }
function admF(k, v) { if (k === 'who') fWho = v; else if (k === 'op') { fOp = v; if (v === 'auto') fAuto = true; } else if (k === 'col') fCol = v; else if (k === 'auto') fAuto = !!v; logMore = 60; render(); }
function admDay(d) { selDay = d; render(); }
function admReload() { load(); }
function admCsv() {
  const rows = [['fecha', 'hora', 'usuario', 'dispositivo', 'sistema', 'modelo', 'navegador', 'instalada', 'versión']].concat([...visits].sort((a, b) => a.at - b.at).map(v => [v.day, hhmm(v), nameOf(v.uid), v.os, v.osVersion || '', v.model || '', v.browser || '', v.installed ? 'sí' : 'no', vlabel(v.app)]));
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `futari-ingresos-${todayKey()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function admPurge() {
  if (!(await ask('¿Borrar los registros de ingresos, tiempo de uso, avisos y bitácoras de hace más de 90 días?', { ok: 'Borrar', danger: true }))) return;
  const cut = Date.now() - 90 * 864e5, cutDay = dayKey(new Date(cut));
  const docs = [...(await getDocs(query(logCol('visits'), where('at', '<', cut)))).docs, ...(await getDocs(query(logCol('perf'), where('at', '<', cut)))).docs,
    ...(await getDocs(query(logCol('usage'), where('day', '<', cutDay)))).docs, ...(await getDocs(query(col('stats'), where('day', '<', cutDay)))).docs,
    ...(await getDocs(query(logCol('actions'), where('day', '<', cutDay)))).docs, ...(await getDocs(query(logCol('notiflog'), where('day', '<', cutDay)))).docs];
  for (let i = 0; i < docs.length; i += 400) { const b = writeBatch(db); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  toast(`${plural(docs.length, 'registro borrado', 'registros borrados')}`);
}
async function admClearErrors() {
  const all = await getDocs(logCol('errors'));
  for (let i = 0; i < all.docs.length; i += 400) { const b = writeBatch(db); all.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  errors = []; render(); toast('Errores borrados');
}
async function admForceUpdate() {
  if (!(await ask('¿Descargar de nuevo la última versión de la app en este teléfono? Tus datos no se tocan.', { ok: 'Actualizar' }))) return;
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  location.reload();
}

onShow('s-admin', () => { render(); load(); });
expose({ labSpecies, labStage, labMood, labTime, labFed, ...labWearFns, labAll, labNone, labRandom, labHatch, labGame, admTab, admSub, admMore, admF, admMigrate, admRange, admDay, admReload, admCsv, admPurge, admClearErrors, admForceUpdate });
