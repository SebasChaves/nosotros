// Panel de administración (solo visible para TESTERS), en tres pestañas:
//   Ingresos (por día, horas, teléfonos, datos, errores) · Estadísticas (uso, notificaciones, quién hace más) · Pruebas.
import { query, where, orderBy, limit, getDocs, getCountFromServer, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, onShow, expose, toast, ask, col, ref, avatar, loadPhotos, nameOf,
         today, dayKey, todayKey, parseDate, fmtShort, fmtDay, plural, COLLECTIONS, uid, EMU } from './core.js';
import { isTester, testerCard } from './testing.js';
import { NOTIF_TYPES, pushHere } from './push.js';

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
    ['Versión', v.app ? (v.app === latest ? `v${v.app} (la última)` : `v${v.app}`) : 'sin dato'],
  ];
  const warn = [];
  if (/Samsung/.test(v.browser || '')) warn.push('Usa Samsung Internet: los accesos directos y algunas funciones van mejor con Chrome. Conviene instalarla desde Chrome.');
  if (/otra app/.test(v.browser || '')) warn.push('La abrió desde dentro de otra app (por ejemplo un enlace en WhatsApp o Instagram). Mejor abrirla desde el ícono instalado.');
  if (!v.installed && (v.os === 'iPhone' || v.os === 'Android')) warn.push('No la tiene instalada: se pierden la pantalla completa y algunas funciones.');
  if (v.app && latest && Number(v.app) < Number(latest)) warn.push(`Tiene una versión vieja (v${v.app}). Al abrir la app le sale el aviso para actualizar.`);
  return `<div class="adm-dev">${rows.map(([k, x]) => `<div><span class="tiny muted">${k}</span><span class="small">${esc(x)}</span></div>`).join('')}</div>
    ${warn.map(w => `<div class="adm-warn">⚠️ ${esc(w)}</div>`).join('')}`;
}

async function load() {
  if (loading) return; loading = true;
  const sinceDate = new Date(today().getFullYear(), today().getMonth(), today().getDate() - (range - 1)), since = sinceDate.getTime(), sinceKey = dayKey(sinceDate);
  try {
    const [vs, es, pc, us, st] = await Promise.all([
      getDocs(query(col('visits'), where('at', '>=', since), orderBy('at', 'desc'))),
      getDocs(query(col('errors'), orderBy('at', 'desc'), limit(20))),
      getCountFromServer(col('photos')).catch(() => null),
      getDocs(query(col('usage'), where('day', '>=', sinceKey))).catch(() => null),
      getDocs(query(col('stats'), where('day', '>=', sinceKey))).catch(() => null),
    ]);
    visits = vs.docs.map(d => ({ id: d.id, ...d.data() }));
    usage = us ? us.docs.map(d => d.data()) : [];
    stats = st ? st.docs.map(d => d.data()) : [];
    errors = es.docs.map(d => ({ id: d.id, ...d.data() }));
    photoCount = pc ? pc.data().count : null;
  } catch (e) { console.error(e); toast('No se pudieron cargar los datos'); }
  loading = false; render();
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
      <div class="chips" style="margin-top:6px">${list.map(v => `<span class="chip" style="padding:5px 10px;font-size:12.5px" title="${esc([v.model, v.os, v.browser, v.app && 'v' + v.app].filter(Boolean).join(' · '))}">${hhmm(v)} <span class="tiny muted">${v.os === 'iPhone' ? 'iOS' : v.os === 'Android' ? 'Android' : 'PC'}${v.browser ? ' · ' + esc(shortBrowser(v.browser)) : ''}</span></span>`).join('') || '<span class="small muted">—</span>'}</div></div>`;
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

  // 7. Errores
  const errs = errors.length ? `<ul class="list">${errors.map(e => `<li><div class="txt"><span class="small">${esc(e.message)}</span>
    <span class="sub">${esc(nameOf(e.uid))} · ${ago(e.at)} · ${esc(e.screen || '')} · ${esc([e.os, e.browser, e.app && 'v' + e.app].filter(Boolean).join(' · '))}${e.where ? ' · ' + esc(e.where) : ''}</span></div></li>`).join('')}</ul>
    <button class="btn ghost small" onclick="admClearErrors()">Borrar errores</button>` : '<p class="small muted" style="margin:0">Sin errores registrados 🎉</p>';

  const head = `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-more')">${icon('back')}</button><h1>Admin</h1></div>
      <button class="btn ghost small" onclick="admReload()">${loading ? 'Cargando…' : 'Actualizar'}</button></div>
    <div class="seg">${[['ingresos', 'Ingresos'], ['stats', 'Estadísticas'], ['pruebas', 'Pruebas']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="admTab('${k}')">${l}</button>`).join('')}</div>
    ${tab !== 'pruebas' ? `<div class="chips">${[7, 14, 30].map(n => `<button class="chip ${range === n ? 'on' : ''}" onclick="admRange(${n})">${n} días</button>`).join('')}</div>` : ''}`;
  if (tab === 'stats') { paint('s-admin', head + statsHTML(ids, days)); loadPhotos($('s-admin')); return; }
  if (tab === 'pruebas') { paint('s-admin', head + testsHTML()); showVersion(); return; }
  paint('s-admin', `${head}
    <div class="stack" style="gap:14px">${summary}</div>
    <div class="glass stack"><div class="row"><span class="label">Ingresos por día</span><span class="small muted">${visits.length} en ${range} días</span></div>${chart}${legend}</div>
    <div class="glass"><div class="row"><span class="label">${capital(fmtDay(parseDate(selDay)))}</span></div>${detail}</div>
    <div class="glass stack"><span class="label">Todos los días · horas de cada uno</span>${table}</div>
    <div class="glass stack"><span class="label">Horas más activas</span>${heat}</div>
    <div class="glass stack"><span class="label">Datos guardados</span>${data}</div>
    <div class="glass stack"><span class="label">Errores recientes</span>${errs}</div>`);
  loadPhotos($('s-admin'));
}

/* ---------- Pestaña Pruebas: notificaciones, herramientas y zona de pruebas ---------- */
function testsHTML() {
  return `<div class="glass stack"><span class="label">🔔 Notificaciones</span>
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
const SCREENS = { home: 'Inicio', decide: 'Decidir', moments: 'Momentos', love: 'Detalles', more: 'Más', settings: 'Ajustes', cal: 'Calendario',
  reminders: 'Recordatorios', music: 'Playlist', grocery: 'Súper', money: 'Gastos', trips: 'Viajes', trip: 'Viaje', places: 'Restaurantes',
  shows: 'Pelis y series', recipes: 'Recetas', map: 'Mapa', badges: 'Logros', game: 'Juego de retos', us: 'Gustos y regalos', quiz: 'Quiz',
  bucket: 'Bucket list', summary: 'Resumen del año', gallery: 'Galería', search: 'Buscar', admin: 'Admin' };
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
  const SHORT = { snaps: '📸 Instantáneas', reacts: '😍 Reacciones', notes: '💌 Notas', thinks: '❤️ Corazones', songs: '🎵 Canciones', coupons: '🎟️ Cupones',
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
    ['📸 Instantáneas', id => sum('acts', id, 'snap')],
    ['😍 Reacciones', id => sum('acts', id, 'react')],
    ['💌 Notas', id => D.notes.filter(n => n.fromUid === id && msInRange(n.createdAt)).length],
    ['🎟️ Cupones regalados', id => D.coupons.filter(c => c.fromUid === id && msInRange(c.createdAt)).length],
    ['🎵 Canciones dedicadas', id => D.songs.filter(s => s.dedication?.by === id && msInRange(s.dedication.at)).length],
    ['🙂 Días con ánimo', id => D.moods.filter(m => inRange(m.id) && m[id]).length],
    ['💬 Preguntas respondidas', id => D.answers.filter(a => inRange(a.id) && a.answers?.[id]).length],
    ['⚡ Respondió primero', id => D.answers.filter(a => { if (!inRange(a.id)) return false; const x = a.answers || {}, o = ids.find(u => u !== id); return x[id]?.at && x[o]?.at && x[id].at < x[o].at; }).length],
    ['📷 Fotos del día', id => D.daily.filter(d => inRange(d.id) && d[id]).length],
    ['📚 Momentos guardados', id => D.moments.filter(m => m.by === id && msInRange(m.createdAt)).length],
    ['📌 Planes creados', id => D.events.filter(e => e.by === id && msInRange(e.createdAt)).length],
  ];
  const who = ids.length < 2 ? '<p class="small muted" style="margin:0">Hace falta que estén los dos.</p>'
    : names + rows.map(([l, f]) => { const v = ids.map(f); return `<div class="adm-who"><span class="small">${l}</span>${duel(ids, v)}</div>`; }).join('')
      + '<p class="tiny muted" style="margin:0">Instantáneas y reacciones se cuentan desde esta versión (las instantáneas se borran a las 24 h).</p>';

  return `<div class="glass stack"><span class="label">📱 Uso de la app · ${range} días</span>
      <p class="tiny muted" style="margin:0">Tiempo con Futari abierta y a la vista, por sección.</p></div>
    <div class="stack" style="gap:14px">${use}</div>
    <div class="glass stack"><span class="label">⚖️ Quién hace más · ${range} días</span>${who}</div>
    <div class="glass stack"><span class="label">🔔 Notificaciones · ${range} días</span>${notif}</div>`;
}
async function showVersion() {
  try { const t = await (await fetch('sw.js', { cache: 'no-store' })).text(); const v = t.match(/CACHE = '([^']+)'/)?.[1]; const el = $('admVersion'); if (el && v) el.textContent += ` · versión ${v.replace('nosotros-', '')}`; } catch {}
}

function admRange(n) { range = n; load(); }
function admTab(t) { tab = t; render(); window.scrollTo?.(0, 0); }
function admDay(d) { selDay = d; render(); }
function admReload() { load(); }
function admCsv() {
  const rows = [['fecha', 'hora', 'usuario', 'dispositivo', 'sistema', 'modelo', 'navegador', 'instalada', 'versión']].concat([...visits].sort((a, b) => a.at - b.at).map(v => [v.day, hhmm(v), nameOf(v.uid), v.os, v.osVersion || '', v.model || '', v.browser || '', v.installed ? 'sí' : 'no', v.app || '']));
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `futari-ingresos-${todayKey()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function admPurge() {
  if (!(await ask('¿Borrar los registros de ingresos, tiempo de uso y avisos de hace más de 90 días?', { ok: 'Borrar', danger: true }))) return;
  const cut = Date.now() - 90 * 864e5, cutDay = dayKey(new Date(cut));
  const docs = [...(await getDocs(query(col('visits'), where('at', '<', cut)))).docs,
    ...(await getDocs(query(col('usage'), where('day', '<', cutDay)))).docs, ...(await getDocs(query(col('stats'), where('day', '<', cutDay)))).docs];
  for (let i = 0; i < docs.length; i += 400) { const b = writeBatch(db); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  toast(`${plural(docs.length, 'registro borrado', 'registros borrados')}`);
}
async function admClearErrors() {
  const all = await getDocs(col('errors'));
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
expose({ admTab, admRange, admDay, admReload, admCsv, admPurge, admClearErrors, admForceUpdate });
