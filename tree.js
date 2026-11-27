// 🌳 Árbol de recuerdos (1.19.0, pantalla s-tree, botón 🌳 en Momentos): un árbol dibujado en SVG que crece con el
// tiempo juntos (el tronco, hasta los 2 años) y con los momentos guardados: cada momento es una hoja y los que tienen
// foto, una flor. Todo sale de los datos que ya existen (S.data.moments y la fecha de inicio); no se guarda nada.
// La forma es fija para cada momento (semilla = su id): el árbol no cambia al abrirlo otra vez, solo crece.
import { $, S, esc, icon, paint, on, onShow, expose, openSheet, closeSheet, loadPhotos, parseDate, fmtDate, today, daysBetween, nameOf, plural } from './core.js';

const seed = s => { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };
const W = 360, GROUND = 418, CX = 180;

function monthsTogether() {
  if (!S.settings.start) return 0;
  return Math.max(0, daysBetween(parseDate(S.settings.start), today()) / 30.44);
}

function treeSVG(moments) {
  const growth = Math.min(1, (monthsTogether() + 1) / 24), n = moments.length;
  const H = 120 + growth * 170, top = GROUND - H;
  const K = Math.max(4, Math.min(14, 4 + Math.ceil(n / 7))); // ramas
  const rnd = seed('arbol-' + (S.settings.start || ''));
  // Ramas: salen del tronco, alternando lados, más cortas arriba
  const branches = [];
  for (let i = 0; i < K; i++) {
    const t = 0.32 + 0.62 * (i / Math.max(1, K - 1)), y = GROUND - H * t, side = i % 2 ? 1 : -1;
    const len = (55 + 70 * rnd()) * (1.05 - t * 0.45) * (0.6 + growth * 0.5);
    const ang = (-0.35 - 0.55 * rnd()) ; // hacia arriba
    const x2 = CX + side * len * Math.cos(ang), y2 = y + len * Math.sin(ang) - 10;
    branches.push({ x1: CX, y1: y, x2, y2, cx: CX + side * len * 0.45, cy: y - 4, w: Math.max(2.5, 9 * (1 - t)) });
  }
  const at = (b, u) => { const a = 1 - u; return [a * a * b.x1 + 2 * a * u * b.cx + u * u * b.x2, a * a * b.y1 + 2 * a * u * b.cy + u * u * b.y2]; };
  // Hojas y flores (de los momentos, del más viejo al más nuevo)
  const newest = moments.reduce((m, x) => (x.createdAt || 0) > (m?.createdAt || 0) ? x : m, null);
  const items = moments.map(m => {
    const r = seed(m.id), b = branches[Math.floor(r() * branches.length)], u = 0.35 + 0.65 * r();
    const [x, y] = at(b, u), dx = (r() - 0.5) * 34, dy = (r() - 0.6) * 30, rot = Math.round(r() * 360);
    const X = Math.max(14, Math.min(W - 14, x + dx)), Y = Math.min(GROUND - 30, y + dy), hue = 95 + Math.round(r() * 50), light = 32 + Math.round(r() * 18);
    const shape = m.hasPhoto
      ? `<g class="tr-flower">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(Math.cos(a * Math.PI / 180) * 5.2).toFixed(1)}" cy="${(Math.sin(a * Math.PI / 180) * 5.2).toFixed(1)}" r="4.2" fill="hsl(${330 + Math.round(r() * 30)},85%,${70 + Math.round(r() * 10)}%)"/>`).join('')}<circle r="2.6" fill="#FFD25A"/></g>`
      : `<ellipse rx="8.5" ry="4.2" transform="rotate(${rot})" fill="hsl(${hue},55%,${light}%)"/>`;
    return `<g class="tr-item${m === newest ? ' tr-new' : ''}" transform="translate(${X.toFixed(1)},${Y.toFixed(1)})" onclick="treeOpen('${m.id}')" role="button" aria-label="${esc(m.title)}">
      <circle r="11" fill="transparent"/>${shape}</g>`;
  }).join('');
  const canopy = n > 6 ? `<ellipse cx="${CX}" cy="${top + 40}" rx="${110 + Math.min(60, n)}" ry="${70 + Math.min(40, n / 2)}" fill="hsl(130,45%,40%)" opacity=".13"/>` : '';
  return `<svg class="tree-svg" viewBox="0 0 ${W} 440" role="img" aria-label="Árbol de recuerdos con ${n} recuerdos">
    <ellipse cx="${CX}" cy="${GROUND + 4}" rx="150" ry="14" fill="hsl(100,30%,30%)" opacity=".35"/>
    ${canopy}
    <path d="M${CX - 11 - growth * 6},${GROUND} C${CX - 8},${GROUND - H * 0.4} ${CX - 4},${top + 30} ${CX},${top} C${CX + 4},${top + 30} ${CX + 8},${GROUND - H * 0.4} ${CX + 11 + growth * 6},${GROUND} Z" fill="#7A5236"/>
    ${branches.map(b => `<path d="M${b.x1},${b.y1} Q${b.cx.toFixed(1)},${b.cy.toFixed(1)} ${b.x2.toFixed(1)},${b.y2.toFixed(1)}" stroke="#7A5236" stroke-width="${b.w.toFixed(1)}" stroke-linecap="round" fill="none"/>`).join('')}
    ${items}
  </svg>`;
}

function render() {
  const moments = [...S.data.moments].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const flowers = moments.filter(m => m.hasPhoto).length, months = Math.floor(monthsTogether());
  const thisMonth = moments.filter(m => (m.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  paint('s-tree', `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-moments')">${icon('back')}</button><h1>Árbol de recuerdos</h1></div></div>
    <div class="glass tree-wrap">${treeSVG(moments)}</div>
    <div class="glass stack" style="gap:6px">
      <div class="row"><span class="small"><b>${plural(moments.length, 'recuerdo', 'recuerdos')}</b> · 🌸 ${flowers} con foto · 🍃 ${moments.length - flowers} sin foto</span></div>
      <span class="small muted">${months ? `${plural(months, 'mes', 'meses')} creciendo juntos` : 'Recién plantado'}${thisMonth ? ` · ${plural(thisMonth, 'recuerdo nuevo', 'recuerdos nuevos')} este mes` : ''}</span>
      <p class="tiny muted" style="margin:0">Cada momento que guardan le agrega una hoja, y si tiene foto, una flor. El tronco crece con el tiempo que llevan juntos. Toca una para verla.</p>
      <button class="btn small" onclick="go('s-moments');setTimeout(()=>openMoment(),350)">${icon('plus')} Guardar un momento</button></div>`);
}

function treeOpen(id) {
  const m = S.data.moments.find(x => x.id === id); if (!m) return;
  openSheet(`<div class="stack">${m.hasPhoto ? `<img data-thumb="${m.id}" alt="" style="width:100%;max-height:45vh;object-fit:cover;border-radius:18px" onclick="viewPhoto(this)">` : '<div style="font-size:46px;text-align:center">🍃</div>'}
    <h2 style="margin:0">${esc(m.title)}</h2><span class="small muted">${fmtDate(parseDate(m.date))} · ${esc(nameOf(m.by))}${m.place ? ' · 📍 ' + esc(m.place.name) : ''}</span>
    ${m.note ? `<p style="margin:0">${esc(m.note)}</p>` : ''}
    <button class="btn ghost" onclick="closeSheet()">Cerrar</button></div>`);
  loadPhotos($('sheet'));
}

on('moments', () => { if ($('s-tree')?.classList.contains('active')) render(); });
onShow('s-tree', render);
expose({ treeOpen });
