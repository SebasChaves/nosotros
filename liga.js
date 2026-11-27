// 🏆 Liga del mes (1.19.0, pantalla s-liga en Más y tarjeta en Inicio). Puntos de cada día, todo calculado con lo
// que ya se guarda (no hay que anotar nada aparte):
//   Reto del día de Flechas y de Pura fruta (arrows/d-<día>, fruta/d-<día>): jugarlo 1, ganarle al otro +2
//   Momento sorpresa (sorpresa/<día>): a tiempo 2, tarde 1 · Diario de los dos (diary/<día>): 1
// Solo cuentan los juegos que los dos ven (gateOn). Al empezar un mes, el primer teléfono que abre la app cierra el
// anterior: guarda liga/<AAAA-MM> = { closed, pts, winners, at } y le regala al ganador un cupón del otro
// (coupons/liga-<AAAA-MM>-<uid>, id fijo para que no salga dos veces). Si empatan, cupón para los dos.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, write, ref, todayKey, parseDate, nameOf, partnerUid, uid, plural, avatar, gateOn, openSheet, closeSheet } from './core.js';
import { backBar } from './lists.js';

const arrowsScore = r => r.ms + (r.errors ?? r.e ?? 0) * 5000 + (r.hints || 0) * 10000; // igual que arrows.js (menos es mejor)
const ym = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const prevYm = () => { const d = new Date(); return ym(new Date(d.getFullYear(), d.getMonth() - 1, 1)); };
export const monthName = k => parseDate(k + '-01').toLocaleDateString('es', { month: 'long' });
const people = () => [uid(), partnerUid()].filter(Boolean);

// Puntos del mes: { pts: {uid: n}, rows: [{ day, who, why, n }] }
export function ligaScores(month = ym()) {
  const ids = people(), pts = Object.fromEntries(ids.map(u => [u, 0])), rows = [];
  const give = (day, who, n, why) => { if (!(who in pts)) return; pts[who] += n; rows.push({ day, who, n, why }); };
  const days = (col, pre = '') => (S.data[col] || []).filter(d => d.id.startsWith(pre + month)).map(d => [d.id.slice(pre.length), d]);
  const duelDay = (day, d, val, better, name) => {
    const played = ids.filter(u => d[u] && val(d[u]) != null);
    for (const u of played) give(day, u, 1, `${name}: jugó el reto`);
    if (played.length === 2) { const [a, b] = played, va = val(d[a]), vb = val(d[b]); if (va !== vb) give(day, better(va, vb) ? a : b, 2, `${name}: ganó el reto`); }
  };
  if (gateOn('s-arrows')) for (const [day, d] of days('arrows', 'd-')) duelDay(day, d, r => r.ms != null ? arrowsScore(r) : null, (x, y) => x < y, '🏹 Flechas');
  if (gateOn('s-fruta')) for (const [day, d] of days('fruta', 'd-')) duelDay(day, d, r => r.score ?? null, (x, y) => x > y, '🍍 Pura fruta');
  for (const [day, d] of days('sorpresa')) for (const u of ids) if (d[u]) give(day, u, d[u].late ? 1 : 2, d[u].late ? '⚡ Momento sorpresa (tarde)' : '⚡ Momento sorpresa a tiempo');
  for (const [day, d] of days('diary')) for (const u of ids) if (d[u]) give(day, u, 1, '📖 Escribió en el diario');
  return { pts, rows: rows.sort((a, b) => b.day.localeCompare(a.day)) };
}
const leader = pts => { const v = Object.values(pts), mx = Math.max(0, ...v); return mx ? Object.keys(pts).filter(u => pts[u] === mx) : []; };
const hist = () => (S.data.liga || []).filter(d => /^\d{4}-\d{2}$/.test(d.id) && d.closed).sort((a, b) => b.id.localeCompare(a.id));

// Cierre del mes anterior (una vez, cualquiera de los dos teléfonos)
let closing = false;
function closePrev() {
  const p = partnerUid(); if (!S.me || !p || closing) return;
  const m = prevYm();
  if ((S.data.liga || []).some(d => d.id === m && d.closed)) return;
  const { pts } = ligaScores(m), win = leader(pts);
  if (!win.length) return; // nadie jugó: no hay liga que cerrar
  closing = true;
  write(setDoc(ref('liga', m), { closed: true, pts, winners: win, at: Date.now() }, { merge: true }));
  for (const w of win) {
    if (S.data.coupons.some(c => c.id === `liga-${m}-${w}`)) continue;
    const from = people().find(u => u !== w);
    write(setDoc(ref('coupons', `liga-${m}-${w}`), { text: `Ganaste la liga de ${monthName(m)}: tú eliges el plan del fin de semana`, emoji: '🏆', fromUid: from,
      createdAt: Date.now(), seenAt: null, redeemedAt: null, doneAt: null, fromLiga: m }));
  }
  setTimeout(() => { closing = false; }, 5000);
}

export function ligaCard() {
  const p = partnerUid(); if (!p) return '';
  const { pts } = ligaScores(), me = pts[uid()] || 0, them = pts[p] || 0, last = hist()[0];
  const fresh = last && last.id === prevYm() && Date.now() - last.at < 4 * 864e5;
  const diff = me - them;
  return `<div class="glass stack" style="gap:8px" role="button" onclick="go('s-liga')"><div class="row"><span class="label">${icon('trophy')} Liga de ${monthName(ym())}</span><span class="pill">${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()} días</span></div>
    ${fresh ? `<p class="small" style="margin:0">🏆 ${last.winners.length > 1 ? '¡Empataron' : `¡${esc(nameOf(last.winners[0]))} ganó`} la liga de ${monthName(last.id)}! ${last.winners.length > 1 ? 'Cupón para los dos.' : 'Tiene un cupón para elegir el plan.'}</p>` : ''}
    <div class="liga-score"><span>${avatar(uid(), 26)}<b class="num">${me}</b></span><span class="muted small">vs</span><span><b class="num">${them}</b>${avatar(p, 26)}</span></div>
    <span class="tiny muted">${!me && !them ? 'Jueguen el reto del día, el momento sorpresa y el diario para sumar puntos' : diff > 0 ? `Vas ganando por ${plural(diff, 'punto', 'puntos')}` : diff < 0 ? `${esc(nameOf(p))} va ganando por ${plural(-diff, 'punto', 'puntos')}` : 'Van empatados'}</span></div>`;
}

function render() {
  const p = partnerUid(), { pts, rows } = ligaScores(), me = pts[uid()] || 0, them = p ? pts[p] || 0 : 0, mx = Math.max(1, me, them);
  const bar = (u, n) => `<div class="adm-bar"><span class="small">${avatar(u, 22)} ${esc(u === uid() ? 'Tú' : nameOf(u))}</span><span class="adm-barline"><i style="width:${Math.round(n / mx * 100)}%;background:var(--grad)"></i></span><b class="num">${n}</b></div>`;
  const h = hist();
  const wins = u => h.filter(x => x.winners?.includes(u)).length;
  paint('s-liga', `${backBar('Liga del mes')}
    <div class="glass stack"><div class="row"><span class="label">${icon('trophy')} ${monthName(ym()).replace(/^./, c => c.toUpperCase())}</span><span class="tiny muted">El ganador elige el plan 🎟️</span></div>
      ${bar(uid(), me)}${p ? bar(p, them) : ''}</div>
    <div class="glass stack" style="gap:4px"><span class="label">Cómo se suman puntos</span>
      <span class="small">🏹 🍍 Jugar el reto del día de Flechas o Pura fruta: <b>1</b> · ganarle al otro: <b>+2</b></span>
      <span class="small">⚡ Momento sorpresa a tiempo: <b>2</b> · tarde: <b>1</b></span>
      <span class="small">📖 Escribir en el diario: <b>1</b></span>
      <span class="tiny muted">El primer día del mes siguiente, a quien gane le llega un cupón del otro para elegir el plan del fin de semana. Si empatan, cupón para los dos.</span></div>
    ${h.length ? `<div class="glass stack" style="gap:4px"><span class="label">Ganadores</span>
      <span class="small">🏆 Tú ${wins(uid())} · ${esc(p ? nameOf(p) : '')} ${p ? wins(p) : 0}</span>
      ${h.slice(0, 12).map(x => `<div class="row"><span class="small">${monthName(x.id).replace(/^./, c => c.toUpperCase())} ${x.id.slice(0, 4)}</span><span class="small">${x.winners.length > 1 ? '🤝 Empate' : '🏆 ' + esc(nameOf(x.winners[0]))} <span class="tiny muted">${Object.values(x.pts || {}).join(' – ')}</span></span></div>`).join('')}</div>` : ''}
    <div class="glass stack"><span class="label">Puntos de este mes</span>
      ${rows.length ? `<ul class="list">${rows.slice(0, 60).map(r => `<li><div class="txt"><span class="small">${esc(r.why)}</span><span class="sub">${esc(r.who === uid() ? 'Tú' : nameOf(r.who))} · ${parseDate(r.day).toLocaleDateString('es', { weekday: 'short', day: 'numeric' })}</span></div><b class="num">+${r.n}</b></li>`).join('')}</ul>`
        : '<p class="small muted" style="margin:0">Todavía no hay puntos este mes.</p>'}</div>`);
}

let t = null;
on('arrows fruta sorpresa diary liga', () => { if ($('s-liga')?.classList.contains('active')) render(); clearTimeout(t); t = setTimeout(closePrev, 3000); });
onShow('s-liga', render);
export const ligaSub = () => { const p = partnerUid(); if (!p) return 'Puntos del mes'; const { pts } = ligaScores(); return `Tú ${pts[uid()] || 0} · ${esc(nameOf(p))} ${pts[p] || 0}`; };
expose({});
