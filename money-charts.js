// Gráficos de Gastos (pantalla completa, desde Gastos y la tarjeta de Inicio). Solo lee lo que ya anotan (expenses).
// 1. Semana a semana (12): gustos por semana con la línea del presupuesto · 2. ¿En qué se va? (barras por categoría,
// este mes / mes pasado / 3 meses) · 3. Mes contra mes (6): gustos + lo demás, apilado · 4. Días de la semana (gustos,
// últimas 8 semanas). Arriba, frases con lo importante. Tocar una barra muestra su detalle; cada gráfico tiene su tabla.
// Colores (docs/GASTOS.md): --viz-1 azul y --viz-2 naranja, validados en tema oscuro y claro (daltonismo incluido).
import { $, S, esc, expose, syncBack, fmtMoney, todayKey, dayKey, parseDate } from './core.js';
import { EXPENSE_CATS } from './data.js';
import { weekStart } from './money.js';

const GUSTOS_DEF = ['🍽️', '🎬', '🎉'];
const gustos = () => { const c = S.data.money.find(d => d.id === 'cfg'); return c?.weekCats?.length ? c.weekCats : GUSTOS_DEF; };
const budget = () => Number(S.data.money.find(d => d.id === 'cfg')?.week) || 0;
const spends = () => S.data.expenses.filter(e => e.type !== 'settle' && e.date);
const shift = (k, n) => { const d = parseDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const monthKey = (k, n = 0) => { const d = parseDate(k.slice(0, 7) + '-01'); d.setMonth(d.getMonth() + n); return dayKey(d).slice(0, 7); };
const sum = (list) => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
const short = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.0', '') + ' M' : a >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(Math.round(n)); };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_L = ['los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados', 'los domingos'];
const fmtDay = k => { const d = parseDate(k); return `${d.getDate()} ${MES[d.getMonth()]}`; };
const catName = c => (EXPENSE_CATS.find(([e]) => e === c) || ['📦', 'Otro']).join(' ');
const pct = (a, b) => b ? Math.round((a / b - 1) * 100) : null;

/* ---------- Datos ---------- */
function weeks() { // 12 semanas, la última es la actual
  const g = gustos(), now = weekStart();
  return Array.from({ length: 12 }, (_, i) => {
    const from = shift(now, (i - 11) * 7), to = shift(from, 6);
    return { from, to, v: sum(spends().filter(e => e.date >= from && e.date <= to && g.includes(e.cat))), cur: i === 11 };
  });
}
function months() { // 6 meses, el último es el actual
  const g = gustos(), now = todayKey();
  return Array.from({ length: 6 }, (_, i) => {
    const mk = monthKey(now, i - 5), list = spends().filter(e => e.date.startsWith(mk));
    const a = sum(list.filter(e => g.includes(e.cat))), b = sum(list) - a;
    return { mk, a, b, cur: i === 5 };
  });
}
function byCat(period) {
  const now = todayKey(), mk = monthKey(now), prev = monthKey(now, -1);
  const list = spends().filter(e => period === 'mes' ? e.date.startsWith(mk) : period === 'pasado' ? e.date.startsWith(prev) : e.date >= monthKey(now, -2) + '-01');
  const total = sum(list), m = new Map();
  for (const e of list) m.set(e.cat, (m.get(e.cat) || 0) + (Number(e.amount) || 0));
  return { total, rows: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ c, v, p: total ? v / total : 0 })) };
}
function byDay() { // gustos de las últimas 8 semanas completas + la actual, por día de la semana
  const g = gustos(), from = shift(weekStart(), -56), out = Array(7).fill(0);
  for (const e of spends()) if (e.date >= from && g.includes(e.cat)) out[(parseDate(e.date).getDay() + 6) % 7] += Number(e.amount) || 0;
  return out;
}
// Frases con lo importante
function insights() {
  const out = [], ms = months(), [prevM, curM] = ms.slice(-2), ws = weeks(), b = budget(), d = byDay(), dt = d.reduce((a, x) => a + x, 0);
  const day = new Date().getDate();
  if (prevM.a && curM.a) {
    // Antes del día 20 el mes va a medias: se dice cuánto llevan; después, se compara con el mes pasado completo
    const p = pct(curM.a, prevM.a);
    if (day >= 20 && p != null) out.push(p <= 0 ? `🎉 Este mes llevan ${Math.abs(p)} % menos en gustos que todo el mes pasado.` : `⚠️ Este mes ya gastaron ${p} % más en gustos que todo el mes pasado.`);
    else if (day < 20) out.push(`🗓️ Van ${fmtMoney(curM.a)} en gustos este mes (el mes pasado fueron ${fmtMoney(prevM.a)} en total).`);
  }
  if (b) {
    const first = spends().reduce((m, e) => e.date < m ? e.date : m, '9999'), done = ws.slice(0, 11).filter(w => w.to >= weekStart(first)), ok = done.filter(w => w.v <= b).length;
    if (done.length >= 2) out.push(`📊 Cumplieron el presupuesto ${ok} de las últimas ${done.length} semanas.`);
  }
  if (dt) { const i = d.indexOf(Math.max(...d)), share = Math.round(d[i] / dt * 100); if (share >= 25) out.push(`📅 ${DIAS_L[i][0].toUpperCase() + DIAS_L[i].slice(1)} se les va el ${share} % de los gustos.`); }
  const c = byCat('mes'); if (c.rows[0] && c.total) out.push(`🥇 En lo que más gastan este mes: ${catName(c.rows[0].c)} (${Math.round(c.rows[0].p * 100)} %).`);
  return out.slice(0, 3);
}

/* ---------- Dibujo (SVG a mano: barras finas con punta redonda, grilla tenue, sin doble eje) ---------- */
const W = 340, H = 170, PL = 34, PR = 8, PT = 12, PB = 24;
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * p; }
const roundTop = (x, y, w, h, r = 4) => { if (h <= 0) return ''; r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
function axis(max) {
  const ih = H - PT - PB, ticks = [0, 0.5, 1].map(f => f * max);
  return ticks.map(t => { const y = PT + ih - t / max * ih; return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" class="vz-grid"/><text x="${PL - 5}" y="${y + 3.5}" class="vz-ax" text-anchor="end">${short(t)}</text>`; }).join('');
}
// Columnas: data [{label, segs:[valor, valor2?], tip, cur}] · ref: línea de referencia (presupuesto)
function columns(id, data, { ref = 0, stacked = false } = {}) {
  const n = data.length, iw = W - PL - PR, ih = H - PT - PB, slot = iw / n, bw = Math.min(26, slot * 0.56);
  const max = niceMax(Math.max(ref * 1.1, ...data.map(d => d.segs.reduce((a, b) => a + b, 0))));
  const y = v => PT + ih - v / max * ih;
  let marks = '', hits = '', labels = '';
  data.forEach((d, i) => {
    const x = PL + slot * i + (slot - bw) / 2;
    let base = 0;
    d.segs.forEach((v, s) => {
      if (v <= 0) return;
      const top = y(base + v), bot = y(base), gap = stacked && base > 0 ? 2 : 0, isTop = s === d.segs.length - 1 || d.segs.slice(s + 1).every(z => z <= 0);
      marks += isTop ? `<path d="${roundTop(x, top, bw, bot - top - gap)}" class="vz-s${s + 1}${d.cur ? ' cur' : ''}"/>` : `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(0, bot - top - gap)}" class="vz-s${s + 1}${d.cur ? ' cur' : ''}"/>`;
      base += v;
    });
    hits += `<rect x="${PL + slot * i}" y="${PT}" width="${slot}" height="${ih + PB}" class="vz-hit" data-i="${i}"/>`;
    if (n <= 7 || i % 2 === (n - 1) % 2) labels += `<text x="${PL + slot * i + slot / 2}" y="${H - 8}" class="vz-ax${d.cur ? ' cur' : ''}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  const refLine = ref ? `<line x1="${PL}" x2="${W - PR}" y1="${y(ref)}" y2="${y(ref)}" class="vz-ref"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="vz-svg" id="${id}" role="img">${axis(max)}${marks}${refLine}<line x1="${PL}" x2="${W - PR}" y1="${PT + ih}" y2="${PT + ih}" class="vz-base"/>${labels}${hits}</svg>`;
}
const table = (head, rows) => `<details class="vz-table"><summary>Ver como tabla</summary><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;

/* ---------- Pantalla ---------- */
let view = null, period = 'mes';
const TIPS = {};
function render() {
  if (!view) return;
  const ws = weeks(), ms = months(), cat = byCat(period), dd = byDay(), b = budget(), g = gustos(), ins = insights();
  const any = spends().length;
  TIPS.w = ws.map(w => `<b>Semana del ${fmtDay(w.from)}${w.cur ? ' (esta)' : ''}</b>: ${fmtMoney(w.v)} en gustos${b ? ` · ${w.v <= b ? `les sobró ${fmtMoney(b - w.v)}` : `se pasaron ${fmtMoney(w.v - b)}`}` : ''}`);
  TIPS.m = ms.map(m => { const [y, mo] = m.mk.split('-'); return `<b>${MES[mo - 1]} ${y}${m.cur ? ' (va)' : ''}</b>: ${fmtMoney(m.a + m.b)} en total · gustos ${fmtMoney(m.a)} · lo demás ${fmtMoney(m.b)}`; });
  TIPS.d = dd.map((v, i) => `<b>${DIAS_L[i][0].toUpperCase() + DIAS_L[i].slice(1)}</b>: ${fmtMoney(v)} en gustos en las últimas 8 semanas (≈ ${fmtMoney(v / 9)} por semana)`);
  view.innerHTML = `<div class="mt-top"><b>📈 Gráficos de gastos</b><button class="link" onclick="closeMoneyCharts()">Cerrar</button></div>
    <div class="mt-body vz-body">
    ${!any ? '<p class="empty">Cuando anoten gastos, aquí verán sus gráficos 📈</p>' : `
    ${ins.length ? `<div class="vz-ins">${ins.map(t => `<p>${t}</p>`).join('')}</div>` : ''}
    <section class="vz-card"><h3>Gustos semana a semana</h3><p class="vz-sub">${g.map(catName).join(' · ')} · últimas 12 semanas</p>${b ? `<p class="vz-sub"><span class="vz-refk"></span> Presupuesto: ${fmtMoney(b)} por semana</p>` : ''}
      ${columns('vzW', ws.map(w => ({ label: fmtDay(w.from), segs: [w.v], cur: w.cur })), { ref: b })}
      <p class="vz-tip" id="vzW-tip">Toca una barra para ver el detalle</p>
      ${table(['Semana', 'Gustos', ...(b ? ['vs. presupuesto'] : [])], ws.map(w => [`${fmtDay(w.from)}${w.cur ? ' (esta)' : ''}`, fmtMoney(w.v), ...(b ? [w.v <= b ? `−${fmtMoney(b - w.v)}` : `+${fmtMoney(w.v - b)}`] : [])]))}</section>
    <section class="vz-card"><h3>¿En qué se va?</h3>
      <div class="seg vz-seg">${[['mes', 'Este mes'], ['pasado', 'El pasado'], ['tres', '3 meses']].map(([k, l]) => `<button class="${period === k ? 'on' : ''}" onclick="moneyChartsPeriod('${k}')">${l}</button>`).join('')}</div>
      <p class="vz-sub">Total: <b>${fmtMoney(cat.total)}</b></p>
      ${cat.rows.length ? `<div class="vz-hbars">${cat.rows.map(r => `<div class="vz-hrow"><span class="vz-hl">${esc(catName(r.c))}</span><div class="vz-htrack"><i style="width:${Math.max(1.5, r.v / cat.rows[0].v * 100)}%"></i></div><span class="vz-hv"><b>${fmtMoney(r.v)}</b> <span class="muted">${Math.round(r.p * 100)} %</span></span></div>`).join('')}</div>` : '<p class="small muted">Sin gastos en este periodo</p>'}</section>
    <section class="vz-card"><h3>Mes contra mes</h3><p class="vz-sub">Últimos 6 meses</p>
      <div class="vz-legend"><span><i class="vz-k1"></i>Gustos</span><span><i class="vz-k2"></i>Lo demás</span></div>
      ${columns('vzM', ms.map(m => ({ label: MES[Number(m.mk.slice(5)) - 1], segs: [m.a, m.b], cur: m.cur })), { stacked: true })}
      <p class="vz-tip" id="vzM-tip">Toca una barra para ver el detalle</p>
      ${table(['Mes', 'Gustos', 'Lo demás', 'Total'], ms.map(m => [`${MES[Number(m.mk.slice(5)) - 1]} ${m.mk.slice(0, 4)}`, fmtMoney(m.a), fmtMoney(m.b), fmtMoney(m.a + m.b)]))}</section>
    <section class="vz-card"><h3>¿Qué días gastan más?</h3><p class="vz-sub">Gustos de las últimas 8 semanas, por día</p>
      ${columns('vzD', dd.map((v, i) => ({ label: DIAS[i], segs: [v] })))}
      <p class="vz-tip" id="vzD-tip">Toca una barra para ver el detalle</p>
      ${table(['Día', 'Gustos'], dd.map((v, i) => [DIAS[i], fmtMoney(v)]))}</section>`}
    </div>`;
  [['vzW', 'w'], ['vzM', 'm'], ['vzD', 'd']].forEach(([id, k]) => {
    const svg = $(id); if (!svg) return;
    svg.addEventListener('click', e => {
      const h = e.target.closest('.vz-hit'); if (!h) return;
      const i = Number(h.dataset.i);
      svg.querySelectorAll('.vz-hit').forEach(x => x.classList.toggle('on', x === h));
      $(id + '-tip').innerHTML = TIPS[k][i];
    });
  });
}
export function moneyCharts() {
  if (!view) { view = document.createElement('div'); view.className = 'dialog mt-view vz-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Gráficos de gastos'); document.body.appendChild(view); syncBack(); }
  render();
}
function closeMoneyCharts() { const el = view; view = null; if (!el) return; el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); }
function moneyChartsPeriod(k) { period = k; render(); }
expose({ moneyCharts, closeMoneyCharts, moneyChartsPeriod });
