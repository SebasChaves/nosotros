// Vacaciones del trabajo (s-vac, desde 1.16.0): saldo de cada uno, acreditación automática, solicitudes con su estado
// (por aprobar, aprobadas, no aprobadas), historial, feriados de Costa Rica y puentes sugeridos.
// - Las solicitudes viven en la colección "vacations" (la misma del calendario) con work: true, así salen solas en el
//   calendario. Campos extra: { work, status: pendiente|aprobada|rechazada, days (días que rebajan), half, statusAt }.
//   Las «no aprobadas» no salen en el calendario; las «por aprobar» salen con ⏳.
// - Configuración en el documento de la pareja: vac.cfg.<uid> = { bal, balAt, every, day, md, amount, wd, max }
//   (saldo puesto a mano en la fecha balAt; desde ahí se suman las acreditaciones y se restan las aprobadas),
//   vac.holOff.<AAAA-MM-DD> = true (feriado que no aplica) y vac.holAdd.<AAAA-MM-DD> = nombre (feriado extra).
// - Al principio solo la ve el dueño: gates['s-vac'] (core.js). Se comparte desde Administración → Pruebas
//   (features.vac.on), como los juegos sorpresa. Ver docs/VACACIONES.md.
import { setDoc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, coupleRef, profile,
         uid, partnerUid, nameOf, today, todayKey, parseDate, dayKey, fmtDay, fmtShort, plural, celebrate, go, gates, gateOn,
         softDelete, ask } from './core.js';
import { backBar } from './lists.js';
import { isOwner } from './gifts.js';
import { notify, meForPartner } from './push.js';

export const vacShared = () => !!S.settings.features?.vac?.on;
gates['s-vac'] = () => isOwner() || vacShared();

/* ---------- Números y fechas ---------- */
const fmtN = n => (Math.round(n * 100) / 100).toLocaleString('es', { maximumFractionDigits: 2 });
const dias = n => `${fmtN(n)} ${Math.abs(n) === 1 ? 'día' : 'días'}`;
const addDays = (k, n) => { const d = parseDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const range = (a, b) => { const x = parseDate(a), y = parseDate(b); return a === b ? fmtShort(x) : x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear() ? `${x.getDate()}–${y.getDate()} ${y.toLocaleDateString('es', { month: 'short' }).replace('.', '')}` : `${fmtShort(x)} – ${fmtShort(y)}`; };

/* ---------- Feriados (Costa Rica) ---------- */
const CR_FIXED = [['01-01', 'Año Nuevo'], ['04-11', 'Juan Santamaría'], ['05-01', 'Día del Trabajo'], ['07-25', 'Anexión del Partido de Nicoya'],
  ['08-02', 'Virgen de los Ángeles'], ['08-15', 'Día de la Madre'], ['08-31', 'Día de la Persona Negra'], ['09-15', 'Independencia'],
  ['12-01', 'Abolición del Ejército'], ['12-25', 'Navidad']];
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114; return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}
const V = () => S.settings.vac || {};
// Feriados de la ley (sin quitar los apagados): { 'AAAA-MM-DD': nombre }
function lawHolidays(y) {
  const out = {}; for (const [md, n] of CR_FIXED) out[`${y}-${md}`] = n;
  const e = easter(y);
  out[dayKey(new Date(y, e.getMonth(), e.getDate() - 3))] = 'Jueves Santo';
  out[dayKey(new Date(y, e.getMonth(), e.getDate() - 2))] = 'Viernes Santo';
  return out;
}
let hc = { src: undefined, m: {} };
export function holidays(y) {
  if (hc.src !== S.settings.vac) hc = { src: S.settings.vac, m: {} };
  if (hc.m[y]) return hc.m[y];
  const out = lawHolidays(y), off = V().holOff || {}, extra = V().holAdd || {};
  for (const k in off) if (off[k] && k.startsWith(y + '-')) delete out[k];
  for (const [k, n] of Object.entries(extra)) if (n && k.startsWith(y + '-')) out[k] = n;
  return (hc.m[y] = out);
}
const holidayName = k => holidays(Number(k.slice(0, 4)))[k];

/* ---------- Configuración de cada uno ---------- */
const DEF = { every: 'month', day: 'last', amount: 1, wd: [1, 2, 3, 4, 5], max: 15 };
export const cfgOf = u => { const c = V().cfg?.[u]; return c && c.balAt ? { ...DEF, ...c } : null; };
const workDay = (c, k) => (c?.wd || DEF.wd).includes(parseDate(k).getDay()) && !holidayName(k);
// Días que rebaja un rango (sin días que no trabaja ni feriados). Medio día: 0,5 si es un solo día hábil.
export function workDays(u, start, end, half) {
  const c = cfgOf(u); let n = 0;
  for (let k = start, i = 0; k <= end && i < 400; k = addDays(k, 1), i++) if (workDay(c, k)) n++;
  return half && start === end ? n * 0.5 : n;
}
// Fechas de acreditación en (desde, hasta]
function accruals(c, from, to) {
  const out = []; if (!c || c.every === 'none' || to <= from) return out;
  const a = parseDate(from), b = parseDate(to);
  const push = k => { if (k > from && k <= to) out.push(k); };
  for (let y = a.getFullYear(); y <= b.getFullYear(); y++) {
    if (c.every === 'year') { const md = /^\d{2}-\d{2}$/.test(c.md || '') ? c.md : '01-01'; push(`${y}-${md}`); continue; }
    for (let m = 0; m < 12; m++) {
      const last = new Date(y, m + 1, 0).getDate(), key = d => dayKey(new Date(y, m, d));
      if (c.every === 'quincena') { push(key(15)); push(key(last)); }
      else push(key(c.day === 'last' ? last : Math.min(Number(c.day) || 1, last)));
    }
  }
  return out.sort();
}
const vacList = () => (S.data.vacations || []).filter(v => v.work);
export const workVacs = u => vacList().filter(v => v.who === u).sort((a, b) => b.start.localeCompare(a.start));
const daysOf = v => v.days != null && v.days !== '' ? Number(v.days) : workDays(v.who, v.start, v.end, v.half);
// Saldo al día «key»: el que pusieron + acreditaciones − aprobadas que empiezan después del saldo puesto y hasta ese día.
export function balanceAt(u, key, { pending = false, skip = null } = {}) {
  const c = cfgOf(u); if (!c) return null;
  let b = (Number(c.bal) || 0) + accruals(c, c.balAt, key).length * (Number(c.amount) || 0);
  for (const v of workVacs(u)) if (v.id !== skip && v.start > c.balAt && v.start <= key && (v.status === 'aprobada' || (pending && v.status === 'pendiente'))) b -= daysOf(v);
  return b;
}
export function summary(u) {
  const c = cfgOf(u); if (!c) return null;
  const tk = todayKey(), vs = workVacs(u).filter(v => v.start > c.balAt);
  const now = balanceAt(u, tk);
  const ahead = vs.filter(v => v.status === 'aprobada' && v.start > tk).reduce((s, v) => s + daysOf(v), 0);
  const pend = vs.filter(v => v.status === 'pendiente').reduce((s, v) => s + daysOf(v), 0);
  const next = accruals(c, tk, addDays(tk, 400))[0];
  const ye = `${today().getFullYear()}-12-31`;
  return { c, now, ahead, pend, free: now - ahead - pend, next, yearEnd: balanceAt(u, ye, { pending: true }) };
}

/* ---------- Estados ---------- */
const ST = { pendiente: ['⏳', 'Por aprobar'], aprobada: ['✅', 'Aprobadas'], rechazada: ['❌', 'No aprobadas'] };
const stOf = v => v.status === 'aprobada' && v.end < todayKey() ? 'tomada' : v.status || 'aprobada';
const stChip = v => { const s = stOf(v); return `<span class="vac-st ${s}">${s === 'tomada' ? '🏝️ Disfrutadas' : ST[s].join(' ')}</span>`; };
const colorOf = u => { const m = Object.entries(S.settings.members || {}).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0)).map(x => x[0]); return m.indexOf(u) === 1 ? '#F472B6' : '#38BDF8'; };
const who = u => u === uid() ? 'Tú' : esc(nameOf(u));

/* ---------- Pantalla ---------- */
let person = null, tab = 'resumen';
const people = () => [uid(), partnerUid()].filter(Boolean);
function vacPerson(u) { person = u; render(); }
function vacTab(t) { tab = t; render(); window.scrollTo?.(0, 0); }
export function openVacations(u, t) { if (u) person = u; if (t) tab = t; go('s-vac'); }

function render() {
  if (!gateOn('s-vac')) return paint('s-vac', backBar('🏖️ Vacaciones') + '<p class="empty">Esta sección todavía no está disponible.</p>');
  if (!person || !people().includes(person)) person = uid();
  const p = partnerUid();
  const head = backBar('🏖️ Vacaciones', 's-more', `<button class="btn small" onclick="vacNew()">${icon('plus')} Pedir</button>`)
    + (isOwner() && !vacShared() ? `<div class="row vac-lock"><span class="small">🔒 Por ahora solo tú la ves</span><button class="link" onclick="go('s-admin');setTimeout(()=>admTab('pruebas'),50)">Compartir</button></div>` : '')
    + (p ? `<div class="seg">${people().map(u => `<button class="${person === u ? 'on' : ''}" onclick="vacPerson('${u}')">${u === uid() ? 'Mías' : 'De ' + esc(nameOf(u))}</button>`).join('')}</div>` : '')
    + `<div class="chips scroll">${[['resumen', '📊 Saldo'], ['historial', '🕘 Historial'], ['config', '⚙️ Configurar']].map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" onclick="vacTab('${k}')">${l}</button>`).join('')}</div>`;
  const body = tab === 'historial' ? historyHTML(person) : tab === 'config' ? configHTML(person) : resumenHTML(person);
  paint('s-vac', head + body);
}

function resumenHTML(u) {
  const s = summary(u), mine = u === uid();
  if (!s) return `<div class="glass stack"><span class="label">👋 Para empezar</span>
    <p class="small" style="margin:0">Pon cuántos días de vacaciones ${mine ? 'tienes' : `tiene ${esc(nameOf(u))}`} ahorita y cada cuánto se ${mine ? 'te' : 'le'} acreditan. Desde ahí la app lleva la cuenta sola: suma lo que se acredita y resta las vacaciones aprobadas.</p>
    <button class="btn" onclick="vacTab('config')">⚙️ Configurar el saldo</button></div>${listHTML(u)}`;
  const neg = n => n < 0 ? 'vac-neg' : '';
  return `<div class="glass stack"><span class="label">${mine ? 'Tu saldo' : 'Saldo de ' + esc(nameOf(u))}</span>
      <div class="vac-hero"><b class="${neg(s.now)}">${fmtN(s.now)}</b><span class="muted">${Math.abs(s.now) === 1 ? 'día' : 'días'} hoy</span></div>
      ${s.ahead ? `<div class="row"><span class="small">✅ Aprobadas por tomar</span><b class="num">−${fmtN(s.ahead)}</b></div>` : ''}
      ${s.pend ? `<div class="row"><span class="small">⏳ Por aprobar</span><b class="num">−${fmtN(s.pend)}</b></div>` : ''}
      ${s.ahead || s.pend ? `<div class="row"><span class="small"><b>Libres para pedir</b></span><b class="num ${neg(s.free)}">${fmtN(s.free)}</b></div>` : ''}
      <p class="tiny muted" style="margin:0">${s.next && s.c.every !== 'none' ? `Próxima acreditación: ${esc(fmtShort(parseDate(s.next)))} · +${fmtN(Number(s.c.amount) || 0)}. ` : ''}Al 31 de diciembre ${mine ? 'tendrás' : 'tendrá'} ${dias(s.yearEnd)} (con lo aprobado y por aprobar).</p>
      ${s.c.max && s.free > s.c.max ? `<p class="small" style="margin:0">🌴 ${mine ? 'Tienes' : 'Tiene'} muchos días juntos: ¿y si planean algo?</p>` : ''}</div>
    ${listHTML(u)}${bridgesHTML(u)}`;
}
// Próximas y por aprobar
function listHTML(u) {
  const tk = todayKey(), vs = workVacs(u).filter(v => (v.end >= tk && v.status !== 'rechazada') || v.status === 'pendiente').sort((a, b) => a.start.localeCompare(b.start));
  return `<div class="glass"><div class="row"><span class="label">Próximas</span><button class="link" onclick="vacNew('${u}')">${icon('plus')} Pedir</button></div>
    ${vs.length ? vs.map(v => vacRow(v, true)).join('') : `<p class="small muted" style="margin:6px 0 0">No hay vacaciones pedidas. Toca «Pedir» para anotar unas: salen solas en el calendario.</p>`}</div>`;
}
function vacRow(v, actions) {
  const tk = todayKey(), left = Math.round((parseDate(v.start) - parseDate(tk)) / 864e5);
  const when = v.start > tk ? (left === 1 ? ' · mañana' : ` · en ${left} días`) : v.end >= tk ? ' · ¡ahora!' : '';
  return `<div class="vac-item"><button class="result-row" onclick="vacOpen('${v.id}')"><span class="e">${esc(v.emoji || '🏖️')}</span>
    <span class="grow"><b>${esc(v.title)}</b><span class="tiny muted" style="display:block">${esc(range(v.start, v.end))} · ${dias(daysOf(v))}${v.status === 'rechazada' ? '' : when}</span></span>${stChip(v)}</button>
    ${actions && v.status === 'pendiente' ? `<div class="grid2 vac-ask"><button class="btn small" onclick="vacStatus('${v.id}','aprobada')">✅ Aprobadas</button><button class="btn ghost small" onclick="vacStatus('${v.id}','rechazada')">❌ No aprobadas</button></div>` : ''}</div>`;
}
// Puentes: feriados en martes, miércoles o jueves en los próximos 12 meses
export function bridges(u) {
  const c = cfgOf(u) || DEF, wd = c.wd || DEF.wd; if (wd.includes(0) || wd.includes(6)) return [];
  const tk = todayKey(), end = addDays(tk, 365), out = [], y0 = today().getFullYear();
  const busy = k => workVacs(u).some(v => v.status !== 'rechazada' && k >= v.start && k <= v.end);
  for (const y of [y0, y0 + 1]) for (const [k, name] of Object.entries(holidays(y))) {
    if (k <= tk || k > end) continue;
    const d = parseDate(k).getDay();
    // Martes: pedir el lunes (sáb–mar = 4). Jueves: pedir el viernes (jue–dom = 4). Miércoles: jueves y viernes (mié–dom = 5).
    const req = d === 2 ? [addDays(k, -1), addDays(k, -1)] : d === 4 ? [addDays(k, 1), addDays(k, 1)] : d === 3 ? [addDays(k, 1), addDays(k, 2)] : null;
    if (!req || busy(k) || busy(req[0])) continue;
    const take = workDays(u, req[0], req[1]); if (!take) continue;
    const from = d === 2 ? addDays(k, -3) : k, to = d === 2 ? k : addDays(k, d === 3 ? 4 : 3);
    out.push({ k, name, start: req[0], end: req[1], take, free: Math.round((parseDate(to) - parseDate(from)) / 864e5) + 1 });
  }
  return out.sort((a, b) => a.k.localeCompare(b.k));
}
function bridgesHTML(u) {
  const b = bridges(u).slice(0, 4); if (!b.length) return '';
  return `<div class="glass stack"><span class="label">🌉 Puentes que vienen</span>
    ${b.map(x => `<div class="row start" style="gap:10px"><span class="grow small"><b>${esc(cap(parseDate(x.k).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')))}</b> es feriado (${esc(x.name)}): ${x.take === 1 ? 'pide el' : 'pide del'} ${esc(x.start === x.end ? parseDate(x.start).toLocaleDateString('es', { weekday: 'long', day: 'numeric' }) : range(x.start, x.end))} y ${u === uid() ? 'tienes' : 'tiene'} <b>${x.free} días libres</b> con ${dias(x.take)}.</span>
      <button class="btn ghost small" onclick="vacNew('${u}','${x.start}','${x.end}','Puente: ${esc(x.name.replace(/['"\\]/g, ''))}')">Pedir</button></div>`).join('')}</div>`;
}

/* ---------- Historial ---------- */
function historyHTML(u) {
  const c = cfgOf(u), tk = todayKey();
  const past = workVacs(u).filter(v => v.status === 'rechazada' || v.end < tk);
  const years = new Set(past.map(v => Number(v.start.slice(0, 4))));
  if (c) for (let y = Number(c.balAt.slice(0, 4)); y <= today().getFullYear(); y++) years.add(y);
  if (!years.size) return `<p class="empty">Todavía no hay historial. Aquí van a quedar las vacaciones que ${u === uid() ? 'disfrutes' : 'disfrute'}, las que no aprobaron y lo que se acreditó cada año.</p>`;
  return [...years].sort((a, b) => b - a).map(y => {
    const vs = past.filter(v => v.start.startsWith(y + '-')), used = vs.filter(v => v.status === 'aprobada').reduce((s, v) => s + daysOf(v), 0);
    const from = c ? [c.balAt, `${y - 1}-12-31`].sort()[1] : null, to = [tk, `${y}-12-31`].sort()[0];
    const acc = c && to > from ? accruals(c, from, to).length * (Number(c.amount) || 0) : 0;
    const start = c && c.balAt.startsWith(y + '-') ? `<div class="row"><span class="small">📌 Saldo puesto a mano (${esc(fmtShort(parseDate(c.balAt)))})</span><b class="num">${fmtN(Number(c.bal) || 0)}</b></div>` : '';
    return `<div class="glass"><div class="row"><span class="label">${y}</span><span class="small muted">${used ? `🏝️ ${dias(used)} disfrutados` : ''}${used && acc ? ' · ' : ''}${acc ? `➕ ${fmtN(acc)} acreditados` : ''}</span></div>
      ${start}${vs.length ? vs.map(v => vacRow(v, false)).join('') : '<p class="small muted" style="margin:6px 0 0">Sin vacaciones este año.</p>'}</div>`;
  }).join('');
}

/* ---------- Configurar ---------- */
const WD = [[1, 'L'], [2, 'K'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const DAYS_OPT = () => [['last', 'El último día del mes'], ...Array.from({ length: 31 }, (_, i) => [String(i + 1), `El día ${i + 1}`])];
function configHTML(u) {
  const c = cfgOf(u) || { ...DEF, bal: '', balAt: todayKey() }, mine = u === uid(), y = today().getFullYear();
  const md = c.md || '01-01';
  return `<div class="glass stack"><span class="label">📌 ${mine ? '¿Cuántos días tienes ahorita?' : `¿Cuántos días tiene ${esc(nameOf(u))} ahorita?`}</span>
      <div class="grid2"><div><label class="f" for="vcBal">Días</label><input type="number" id="vcBal" inputmode="decimal" step="0.5" value="${esc(String(c.bal ?? ''))}" placeholder="Ej: 9,5"></div>
        <div><label class="f" for="vcBalAt">Al día</label><input type="date" id="vcBalAt" value="${esc(c.balAt)}"></div></div>
      <p class="tiny muted" style="margin:0">Pon el saldo como sale en la planilla o en el sistema del trabajo. Desde esa fecha la app suma lo que se acredita y resta las vacaciones aprobadas. Si algún día no cuadra, solo vuelve a ponerlo aquí.</p></div>
    <div class="glass stack"><span class="label">➕ ¿Cuándo y cuánto se acredita?</span>
      <div><label class="f" for="vcEvery">Cada cuánto</label><select id="vcEvery" onchange="vacCfgEvery()">
        ${[['month', 'Cada mes'], ['quincena', 'Cada quincena (el 15 y fin de mes)'], ['year', 'Una vez al año'], ['none', 'No se acreditan solos']].map(([k, l]) => `<option value="${k}" ${c.every === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="vcDayBox" ${c.every === 'month' ? '' : 'hidden'}><label class="f" for="vcDay">Qué día</label><select id="vcDay">${DAYS_OPT().map(([k, l]) => `<option value="${k}" ${String(c.day) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="vcMdBox" ${c.every === 'year' ? '' : 'hidden'}><label class="f" for="vcMd">Qué día del año (por ejemplo, el aniversario en el trabajo)</label><input type="date" id="vcMd" value="${y}-${esc(md)}"></div>
      <div id="vcAmtBox" ${c.every === 'none' ? 'hidden' : ''}><label class="f" for="vcAmt">Cuántos días se acreditan cada vez</label><input type="number" id="vcAmt" inputmode="decimal" step="0.01" min="0" value="${esc(String(c.amount ?? 1))}"></div>
      <p class="tiny muted" style="margin:0">Ejemplos: 1 por mes = 12 al año · 14 al año ≈ 1,17 por mes · 10 hábiles al año ≈ 0,83 por mes.</p></div>
    <div class="glass stack"><span class="label">🗓️ Días que ${mine ? 'trabajas' : 'trabaja'}</span>
      <div class="chips" id="vcWd">${WD.map(([d, l]) => `<button class="chip ${c.wd.includes(d) ? 'on' : ''}" data-d="${d}" onclick="this.classList.toggle('on')" aria-label="${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d]}">${l}</button>`).join('')}</div>
      <p class="tiny muted" style="margin:0">Solo esos días se rebajan del saldo (ni los feriados).</p>
      <div><label class="f" for="vcMax">Avisarme si ${mine ? 'junto' : 'junta'} más de… días (0 = nunca)</label><input type="number" id="vcMax" inputmode="numeric" min="0" step="1" value="${esc(String(c.max ?? 15))}"></div></div>
    <button class="btn" onclick="vacCfgSave('${u}')">Guardar</button>
    <div class="glass stack"><span class="label">🇨🇷 Feriados</span>
      <p class="small muted" style="margin:0">Son los de Costa Rica y no se rebajan. Si alguno se corre a otro día o en el trabajo no lo dan, cámbialo aquí (vale para los dos).</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="vacHolidays(${y})">Feriados ${y}</button><button class="btn ghost small" style="width:100%" onclick="vacHolidays(${y + 1})">Feriados ${y + 1}</button></div></div>`;
}
function vacCfgEvery() {
  const e = $('vcEvery').value;
  $('vcDayBox').hidden = e !== 'month'; $('vcMdBox').hidden = e !== 'year'; $('vcAmtBox').hidden = e === 'none';
}
function vacCfgSave(u) {
  const bal = parseFloat(String($('vcBal').value).replace(',', '.')), balAt = $('vcBalAt').value;
  if (!Number.isFinite(bal)) return toast('Pon cuántos días hay ahorita');
  if (!balAt) return toast('Pon la fecha del saldo');
  const every = $('vcEvery').value, amount = parseFloat(String($('vcAmt').value).replace(',', '.')) || 0;
  if (every !== 'none' && amount <= 0) return toast('Pon cuántos días se acreditan');
  const wd = [...document.querySelectorAll('#vcWd .chip.on')].map(b => Number(b.dataset.d));
  if (!wd.length) return toast('Elige al menos un día de trabajo');
  const md = ($('vcMd').value || '').slice(5) || '01-01';
  const cfg = { bal, balAt, every, day: $('vcDay').value, md, amount, wd, max: Math.max(0, parseInt($('vcMax').value, 10) || 0), at: Date.now(), by: uid() };
  write(setDoc(coupleRef, { vac: { cfg: { [u]: cfg } } }, { merge: true }));
  toast('Guardado 🏖️'); tab = 'resumen'; setTimeout(render, 50);
}
// Feriados de un año: apagar los que no aplican y agregar otros
function vacHolidays(y) {
  const law = lawHolidays(y), off = V().holOff || {}, extra = V().holAdd || {};
  const rows = Object.entries(law).sort().map(([k, n]) => `<label class="row" style="cursor:pointer"><span class="small ${off[k] ? 'muted' : ''}">${esc(cap(parseDate(k).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')))} · ${esc(n)}</span>
      <input type="checkbox" ${off[k] ? '' : 'checked'} onchange="vacHolOn('${k}', this.checked, ${y})" aria-label="${esc(n)}"></label>`).join('');
  const adds = Object.entries(extra).filter(([k, n]) => n && k.startsWith(y + '-')).sort().map(([k, n]) => `<div class="row"><span class="small">${esc(cap(parseDate(k).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')))} · ${esc(n)}</span>
      <button class="del" aria-label="Quitar" onclick="vacHolDel('${k}', ${y})">${icon('trash')}</button></div>`).join('');
  openSheet(`<div class="stack"><h2>🇨🇷 Feriados ${y}</h2>
    <p class="small muted" style="margin:0">Desmarca los que no aplican (por ejemplo si se corren a un lunes) y agrega el día al que se pasaron.</p>
    <div class="stack" style="gap:6px">${rows}</div>
    ${adds ? `<span class="label">Agregados</span><div class="stack" style="gap:6px">${adds}</div>` : ''}
    <span class="label">Agregar un feriado</span>
    <div class="grid2"><input type="date" id="vhDate" value="${y}-01-01" min="${y}-01-01" max="${y}-12-31" aria-label="Fecha"><input id="vhName" maxlength="40" placeholder="Nombre" aria-label="Nombre"></div>
    <button class="btn ghost" onclick="vacHolAdd(${y})">${icon('plus')} Agregar</button>
    <button class="btn" onclick="closeSheet()">Listo</button></div>`);
}
function vacHolOn(k, on, y) { write(setDoc(coupleRef, { vac: { holOff: { [k]: !on } } }, { merge: true })); }
function vacHolAdd(y) {
  const k = $('vhDate').value, n = $('vhName').value.trim();
  if (!k || !n) return toast('Pon la fecha y el nombre');
  write(setDoc(coupleRef, { vac: { holAdd: { [k]: n } } }, { merge: true }));
  toast('Feriado agregado'); setTimeout(() => vacHolidays(y), 150);
}
function vacHolDel(k, y) { write(updateDoc(coupleRef, { [`vac.holAdd.${k}`]: deleteField() })); setTimeout(() => vacHolidays(y), 150); }

/* ---------- Pedir o editar ---------- */
let editId = null, editSt = 'pendiente', manual = false;
function vacNew(u, start, end, title) {
  editId = null; editSt = 'pendiente'; manual = false;
  sheet({ who: u || person || uid(), start: start || addDays(todayKey(), 1), end: end || start || addDays(todayKey(), 1), title: title || '' });
}
function vacOpen(id) {
  const v = vacList().find(x => x.id === id); if (!v) return;
  editId = id; editSt = v.status || 'aprobada'; manual = v.days != null && v.days !== '' && Number(v.days) !== workDays(v.who, v.start, v.end, v.half);
  sheet(v);
}
function sheet(v) {
  const p = partnerUid();
  openSheet(`<div class="stack"><h2>${editId ? '🏖️ Vacaciones' : '🏖️ Pedir vacaciones'}</h2>
    ${p ? `<div><label class="f" for="vqWho">¿De quién?</label><select id="vqWho" onchange="vacCalc()">${people().map(u => `<option value="${u}" ${v.who === u ? 'selected' : ''}>${u === uid() ? 'Mías' : 'De ' + esc(nameOf(u))}</option>`).join('')}</select></div>` : `<input type="hidden" id="vqWho" value="${uid()}">`}
    <input id="vqTitle" maxlength="50" placeholder="Ej: Vacaciones de fin de año" value="${esc(v.title || '')}" aria-label="Nombre">
    <div class="grid2"><div><label class="f" for="vqStart">Desde</label><input type="date" id="vqStart" value="${esc(v.start)}" onchange="vacCalc(1)"></div>
      <div><label class="f" for="vqEnd">Hasta</label><input type="date" id="vqEnd" value="${esc(v.end)}" onchange="vacCalc()"></div></div>
    <label class="check" id="vqHalfBox"><input type="checkbox" id="vqHalf" ${v.half ? 'checked' : ''} onchange="vacCalc()"> Medio día</label>
    <p class="small muted" id="vqInfo" style="margin:-4px 0 0"></p>
    <div><label class="f" for="vqDays">Días que se rebajan</label><input type="number" id="vqDays" inputmode="decimal" step="0.5" min="0" oninput="vacManual()"></div>
    <div><span class="f">Estado</span><div class="seg" id="vqSt">${Object.entries(ST).map(([k, [e, l]]) => `<button data-s="${k}" class="${editSt === k ? 'on' : ''}" onclick="vacSt('${k}')">${e} ${l}</button>`).join('')}</div></div>
    <p class="small" id="vqSim" style="margin:0"></p>
    <input id="vqNote" maxlength="140" placeholder="Nota (opcional)" value="${esc(v.note || '')}" aria-label="Nota">
    <button class="btn" onclick="vacSave()">${editId ? 'Guardar cambios' : 'Guardar'}</button>
    ${editId ? `<button class="btn ghost danger" onclick="vacDel('${editId}')">${icon('trash')} Borrar</button>` : ''}
    <p class="tiny muted center" style="margin:0">Las que no están «No aprobadas» salen solas en el calendario.</p></div>`);
  vacCalc();
}
function vacSt(s) { editSt = s; document.querySelectorAll('#vqSt button').forEach(b => b.classList.toggle('on', b.dataset.s === s)); vacCalc(); }
function vacManual() { manual = true; vacCalc(); }
function vacCalc(fromStart) {
  const s = $('vqStart')?.value; if (!s) return;
  if (fromStart && $('vqEnd').value < s) $('vqEnd').value = s;
  if ($('vqEnd').value < s) $('vqEnd').value = s;
  const e = $('vqEnd').value, u = $('vqWho').value, one = s === e;
  $('vqHalfBox').hidden = !one; if (!one) $('vqHalf').checked = false;
  const half = $('vqHalf').checked, n = workDays(u, s, e, half);
  let total = 0, hol = [];
  for (let k = s, i = 0; k <= e && i < 400; k = addDays(k, 1), i++) { total++; const h = holidayName(k); if (h) hol.push(h); }
  $('vqInfo').textContent = `${plural(total, 'día', 'días')} en total · ${dias(n)} de trabajo${hol.length ? ` (no cuenta${hol.length > 1 ? 'n' : ''} ${hol.join(', ')})` : ''}`;
  if (!manual) $('vqDays').value = n;
  const days = parseFloat(String($('vqDays').value).replace(',', '.')) || 0;
  const sim = $('vqSim'), c = cfgOf(u);
  if (!c) { sim.innerHTML = `<span class="muted">Configura el saldo para ver cuántos días ${u === uid() ? 'te' : 'le'} quedarían.</span>`; return; }
  if (editSt === 'rechazada') { sim.innerHTML = '<span class="muted">No se rebajan del saldo.</span>'; return; }
  const at = balanceAt(u, s, { pending: true, skip: editId }), left = at - days;
  sim.innerHTML = `El ${esc(fmtShort(parseDate(s)))} ${u === uid() ? 'vas a tener' : 'va a tener'} <b>${dias(at)}</b> → ${left < 0 ? `<b class="vac-neg">${u === uid() ? 'te faltarían' : 'le faltarían'} ${dias(-left)}</b>` : `${u === uid() ? 'te quedarían' : 'le quedarían'} <b>${dias(left)}</b>`}`;
}
function vacSave() {
  const s = $('vqStart').value, e = $('vqEnd').value || s, u = $('vqWho').value;
  if (!s) return toast('Elige desde cuándo');
  const days = parseFloat(String($('vqDays').value).replace(',', '.'));
  const prev = editId ? vacList().find(x => x.id === editId) : null;
  const data = { title: $('vqTitle').value.trim() || 'Vacaciones', emoji: prev?.emoji || '🏖️', kind: '🏖️', color: prev?.color || colorOf(u), who: u, start: s, end: e,
    half: s === e && $('vqHalf').checked, days: Number.isFinite(days) ? days : workDays(u, s, e), status: editSt, note: $('vqNote').value.trim(), work: true };
  if (!prev || prev.status !== editSt) data.statusAt = Date.now();
  if (prev) write(updateDoc(ref('vacations', editId), { ...data, editedBy: uid(), editedAt: Date.now() }));
  else write(setDoc(newRef('vacations'), { ...data, by: uid(), at: Date.now() }));
  closeSheet();
  if (editSt === 'aprobada' && prev?.status !== 'aprobada') cheer(data);
  else toast(prev ? 'Cambios guardados' : editSt === 'pendiente' ? 'Anotadas ⏳ Cuando te respondan, márcalas' : 'Guardadas 🏖️');
  if (!prev && vacShared() && u === uid() && editSt !== 'rechazada')
    notify('vacations', { title: `🏖️ ${meForPartner()} pidió vacaciones`, body: `${range(s, e)} · ${dias(data.days)}${editSt === 'pendiente' ? ' (por aprobar)' : ''}`, url: './?open=vac', tag: 'vacw' });
  editId = null;
}
function cheer(v) {
  celebrate('confetti'); toast('¡Aprobadas! 🎉 Ya están en el calendario');
  if (vacShared() && v.who === uid()) notify('vacations', { title: `✅ A ${meForPartner()} le aprobaron vacaciones`, body: `${range(v.start, v.end)} · ${dias(daysOf(v))}`, url: './?open=vac', tag: 'vacw' });
}
function vacStatus(id, st) {
  const v = vacList().find(x => x.id === id); if (!v) return;
  write(updateDoc(ref('vacations', id), { status: st, statusAt: Date.now(), editedBy: uid(), editedAt: Date.now() }));
  if (st === 'aprobada') cheer({ ...v, status: st }); else toast('Anotado. Ya no salen en el calendario');
}
function vacDel(id) { softDelete('vacations', id, 'las vacaciones', { after: closeSheet }); }

/* ---------- Avisos (campana) y mosaico de Más ---------- */
const ym = () => todayKey().slice(0, 7);
export function vacAlerts() {
  if (!S.me || !uid() || !gateOn('s-vac')) return [];
  const out = [], tk = todayKey(), soon = addDays(tk, 3);
  for (const v of workVacs(uid()).filter(v => v.status === 'pendiente' && v.start <= soon))
    out.push({ key: 'vacp-' + v.id, e: '⏳', text: `¿Ya te respondieron las vacaciones del ${esc(range(v.start, v.end))}? Márcalas como aprobadas o no`, short: 'Vacaciones por aprobar', run: () => { openVacations(uid(), 'resumen'); setTimeout(() => vacOpen(v.id), 350); } });
  const s = summary(uid());
  if (s && s.c.max && s.free > s.c.max && profile(uid()).prefs?.vacHigh !== ym())
    out.push({ key: 'vach', e: '🌴', text: `Tienes ${dias(s.free)} de vacaciones libres: ¿planean algo?`, short: `${dias(s.free)} acumulados`, run: () => openVacations(uid(), 'resumen') });
  return out;
}
function vacSub() {
  const s = summary(uid()); if (!s) return 'Saldo y solicitudes';
  const pend = workVacs(uid()).filter(v => v.status === 'pendiente').length;
  return `Tienes ${dias(s.free)}${pend ? ` · ${pend} por aprobar` : ''}`;
}
// Al abrir la pantalla se da por visto el aviso de «muchos días» de este mes
onShow('s-vac', () => {
  render();
  const s = summary(uid());
  if (s && s.c.max && s.free > s.c.max && profile(uid()).prefs?.vacHigh !== ym()) write(setDoc(ref('profiles', uid()), { prefs: { vacHigh: ym() } }, { merge: true }));
});
on('vacations profiles', () => { if ($('s-vac')?.classList.contains('active')) render(); });

/* ---------- Administración → Pruebas: compartirla con la pareja ---------- */
export function vacAdminCard() {
  if (!isOwner()) return '';
  const f = S.settings.features?.vac || {}, pn = esc(nameOf(partnerUid()) || 'tu pareja');
  return `<div class="glass stack" style="${f.on ? '' : 'border-color:rgba(56,189,248,.5)'}"><span class="label">🏖️ Vacaciones</span>
    <label class="row" style="cursor:pointer"><span>Que ${pn} también la vea</span><input type="checkbox" ${f.on ? 'checked' : ''} onchange="vacShare(this.checked)" aria-label="Compartir Vacaciones"></label>
    <p class="tiny muted" style="margin:0">${f.on ? `La ven los dos desde el ${esc(new Date(f.at).toLocaleDateString('es', { day: 'numeric', month: 'long' }))}.`
      : `🔒 Ahora solo tú la ves (Más → Vacaciones). ${pn} no ve la sección, ni en el buscador, ni sus avisos. Las vacaciones que anotes sí salen en el calendario de los dos.`}</p>
    ${f.on ? '' : `<label class="check"><input type="checkbox" id="vacShareNotify" checked> Avisarle con una notificación al compartirla</label>`}
    <button class="btn ghost small" onclick="go('s-vac')">🏖️ Abrir Vacaciones</button></div>`;
}
async function vacShare(on) {
  const pn = nameOf(partnerUid()) || 'tu pareja';
  if (!(await ask(on ? `¿Mostrarle Vacaciones a ${pn}? Le aparece en Más.` : `¿Volver a esconder Vacaciones? ${pn} deja de verla (no se borra nada).`, { ok: on ? 'Compartir' : 'Esconder' }))) return window.admRender?.();
  const n = on && $('vacShareNotify')?.checked;
  write(setDoc(coupleRef, { features: { vac: { on, at: Date.now(), by: uid() } } }, { merge: true }));
  if (n) notify('vacations', { title: '🏖️ Nueva sección en Futari: Vacaciones', body: 'Lleven la cuenta de sus días de vacaciones del trabajo 🌴', url: './?open=vac', tag: 'vac-share' });
  toast(on ? 'Listo: ahora la ven los dos 🏖️' : 'Escondida otra vez 🔒');
  setTimeout(() => window.admRender?.(), 150);
}

expose({ vacPerson, vacTab, vacNew, vacOpen, vacSt, vacManual, vacCalc, vacSave, vacStatus, vacDel, vacCfgEvery, vacCfgSave, vacHolidays, vacHolOn, vacHolAdd, vacHolDel, vacShare, vacSub, openVacations });
