// Panel de administración (solo visible para TESTERS): ingresos por día con horas, actividad, datos, errores y herramientas.
import { query, where, orderBy, limit, getDocs, getCountFromServer, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, onShow, expose, toast, ask, col, ref, avatar, loadPhotos, nameOf,
         today, dayKey, todayKey, parseDate, fmtShort, fmtDay, plural, COLLECTIONS, uid, EMU } from './core.js';
import { isTester, testerCard } from './testing.js';

let range = 14, selDay = null, visits = [], errors = [], photoCount = null, loading = false;
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
  const since = new Date(today().getFullYear(), today().getMonth(), today().getDate() - (range - 1)).getTime();
  try {
    const [vs, es, pc] = await Promise.all([
      getDocs(query(col('visits'), where('at', '>=', since), orderBy('at', 'desc'))),
      getDocs(query(col('errors'), orderBy('at', 'desc'), limit(20))),
      getCountFromServer(col('photos')).catch(() => null),
    ]);
    visits = vs.docs.map(d => ({ id: d.id, ...d.data() }));
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

  paint('s-admin', `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-more')">${icon('back')}</button><h1>Admin</h1></div>
      <button class="btn ghost small" onclick="admReload()">${loading ? 'Cargando…' : 'Actualizar'}</button></div>
    <div class="chips">${[7, 14, 30].map(n => `<button class="chip ${range === n ? 'on' : ''}" onclick="admRange(${n})">${n} días</button>`).join('')}</div>
    <div class="stack" style="gap:14px">${summary}</div>
    <div class="glass stack"><div class="row"><span class="label">Ingresos por día</span><span class="small muted">${visits.length} en ${range} días</span></div>${chart}${legend}</div>
    <div class="glass"><div class="row"><span class="label">${capital(fmtDay(parseDate(selDay)))}</span></div>${detail}</div>
    <div class="glass stack"><span class="label">Todos los días · horas de cada uno</span>${table}</div>
    <div class="glass stack"><span class="label">Horas más activas</span>${heat}</div>
    <div class="glass stack"><span class="label">Datos guardados</span>${data}</div>
    <div class="glass stack"><span class="label">Errores recientes</span>${errs}</div>
    <div class="glass stack"><span class="label">Herramientas</span>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="admCsv()">⬇️ Ingresos (CSV)</button>
        <button class="btn ghost small" style="width:100%" onclick="admPurge()">🧹 Ingresos de +90 días</button>
        <button class="btn ghost small" style="width:100%" onclick="admForceUpdate()">🔄 Forzar actualización</button>
        <button class="btn ghost small" style="width:100%" onclick="startTour()">👋 Ver la guía</button></div>
      <p class="tiny muted" style="margin:0" id="admVersion">Proyecto: ${EMU ? 'emulador local' : 'nosotros-app-2e254'}</p></div>
    ${testerCard()}`);
  loadPhotos($('s-admin'));
  showVersion();
}
async function showVersion() {
  try { const t = await (await fetch('sw.js', { cache: 'no-store' })).text(); const v = t.match(/CACHE = '([^']+)'/)?.[1]; const el = $('admVersion'); if (el && v) el.textContent += ` · versión ${v.replace('nosotros-', '')}`; } catch {}
}

function admRange(n) { range = n; load(); }
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
  if (!(await ask('¿Borrar los registros de ingresos de hace más de 90 días?', { ok: 'Borrar', danger: true }))) return;
  const cut = Date.now() - 90 * 864e5;
  const old = await getDocs(query(col('visits'), where('at', '<', cut)));
  for (let i = 0; i < old.docs.length; i += 400) { const b = writeBatch(db); old.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  toast(`${plural(old.size, 'registro borrado', 'registros borrados')}`);
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
expose({ admRange, admDay, admReload, admCsv, admPurge, admClearErrors, admForceUpdate });
