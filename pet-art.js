// Dibujos de la mascota, estilo «mochi»: SVG hecho con código para que se vea igual en iPhone y Android.
// petSVG() dibuja solo la mascota (viewBox 0 0 160 160); sceneSVG() la pone en su escenario con platito y cuarto.
// La especie se guarda como emoji en Firestore (pet.species) para que el Worker y los textos sigan funcionando.

const LINE = '#3B2A3A', BLUSH = '#FF9DB4', TEAR = '#8FD3FF', PINK = '#F7B6C8';
let uidN = 0; // ids únicos para los recortes (puede haber varias mascotas dibujadas en la página)

// fill: color del cuerpo · ear: forma de orejas · extra: detalles propios
export const ART = {
  '🐱': { fill: '#FFD6AE', ear: 'cat', earIn: PINK, stripe: '#F2AE70' },
  '🐶': { fill: '#EED3B8', ear: 'dog', earC: '#B98A66', patch: '#DDB892', nose: LINE },
  '🐰': { fill: '#FFFFFF', ear: 'bunny', earIn: PINK },
  '🦊': { fill: '#FFAE70', ear: 'fox', earTip: '#7A3E22', mask: '#FFF6EE' },
  '🐼': { fill: '#FFFFFF', ear: 'round', earC: LINE, patches: LINE },
  '🐧': { fill: '#43507A', ear: 'none', face: '#FFFFFF', beak: '#FFB547', wings: true },
  '🐻': { fill: '#C99A72', ear: 'round', earC: '#C99A72', earIn: '#E8C3A0', muzzle: '#EBCFB2', nose: LINE },
  '🐨': { fill: '#C7C3D1', ear: 'fluffy', earC: '#C7C3D1', earIn: '#F2EEF6', bigNose: '#4A4152' },
  '🐹': { fill: '#F5C98C', ear: 'small', earC: '#F5C98C', earIn: PINK, cheeks: '#FFF4E3' },
  '🦦': { fill: '#B88762', ear: 'tiny', earC: '#9C6D4C', mask: '#EAD5C0', nose: LINE, whiskers: true },
};
// Tamaño por etapa (1 bebé … 5 leyenda)
const SIZE = [0, 38, 44, 50, 54, 56];

/* ---------- Ropa y detalles (la tienda está en pet.js) ---------- */
export const SLOTS = [['head', 'Cabeza'], ['face', 'Cara'], ['neck', 'Cuello'], ['body', 'Cuerpo'], ['room', 'Cuarto']];
export const ITEMS = [
  { id: 'mono', slot: 'head', name: 'Moño', price: 20 }, { id: 'flor', slot: 'head', name: 'Flor', price: 30 },
  { id: 'gorrito', slot: 'head', name: 'Gorrito de fiesta', price: 40 }, { id: 'sombrero', slot: 'head', name: 'Sombrero', price: 60 },
  { id: 'corona', slot: 'head', name: 'Corona', price: 150 },
  { id: 'lentes', slot: 'face', name: 'Lentes', price: 30 }, { id: 'gafas', slot: 'face', name: 'Lentes de sol', price: 50 },
  { id: 'corbatin', slot: 'neck', name: 'Corbatín', price: 20 }, { id: 'collar', slot: 'neck', name: 'Collar con campanita', price: 30 },
  { id: 'bufanda', slot: 'neck', name: 'Bufanda', price: 40 },
  { id: 'camiseta', slot: 'body', name: 'Camiseta de rayas', price: 40 }, { id: 'sueter', slot: 'body', name: 'Suéter con corazón', price: 60 },
  { id: 'cojin', slot: 'room', name: 'Cojín', price: 30 }, { id: 'planta', slot: 'room', name: 'Planta', price: 40 },
  { id: 'globos', slot: 'room', name: 'Globos', price: 50 }, { id: 'luces', slot: 'room', name: 'Lucecitas', price: 60 },
];

/* ---------- Huevo ---------- */
function eggSVG(ready) {
  return `<ellipse cx="80" cy="146" rx="34" ry="5" fill="#000" opacity=".25"/>
    <g class="${ready ? 'pa-wobble' : 'pa-breathe'}"><path d="M80 52 C 108 52, 120 96, 118 116 C 116 136, 100 144, 80 144 C 60 144, 44 136, 42 116 C 40 96, 52 52, 80 52 Z" fill="#FFF3DD" stroke="${LINE}" stroke-width="3.5"/>
    <circle cx="66" cy="92" r="6" fill="#FFD6AE"/><circle cx="96" cy="108" r="8" fill="#FFD6AE"/><circle cx="72" cy="124" r="4.5" fill="#FFD6AE"/><circle cx="95" cy="80" r="3.5" fill="#FFD6AE"/>
    ${ready ? `<path d="M50 104 l 10 -8 l 8 8 l 10 -9 l 9 8 l 10 -8 l 9 8 l 6 -5" fill="none" stroke="${LINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : ''}</g>`;
}

/* ---------- Mascota ---------- */
// mood: feliz | hambre | triste | dormido · stage: 1..5 · wear: { head, face, neck, body }
export function petSVG({ species = '🐱', mood = 'feliz', stage = 3, wear = {}, egg = false, ready = false } = {}) {
  if (egg) return eggSVG(ready);
  const a = ART[species] || ART['🐱'], id = 'pa' + (++uidN);
  const w = SIZE[stage] || 50, cx = 80, bottom = 142, top = bottom - w * 1.72;
  const sad = mood === 'triste', sleep = mood === 'dormido', hungry = mood === 'hambre', happy = mood === 'feliz';
  const L = cx - w, R = cx + w;
  const body = `M ${L} ${bottom - 18} C ${L} ${top + 14}, ${cx - w * .55} ${top}, ${cx} ${top} C ${cx + w * .55} ${top}, ${R} ${top + 14}, ${R} ${bottom - 18} C ${R} ${bottom - 2}, ${cx + w * .6} ${bottom}, ${cx} ${bottom} C ${cx - w * .6} ${bottom}, ${L} ${bottom - 2}, ${L} ${bottom - 18} Z`;
  const st = `stroke="${LINE}" stroke-width="3.5" stroke-linejoin="round"`;
  const ey = top + (bottom - top) * .48, exs = w * .38, big = stage <= 1 ? 1.25 : stage === 2 ? 1.1 : 1;
  const my = ey + 12 * big;

  // Orejas (detrás del cuerpo)
  let ears = '';
  const droop = sad ? 1 : 0;
  if (a.ear === 'cat' || a.ear === 'fox') ears = [-1, 1].map(k => {
    const tip = a.ear === 'fox' ? `<path d="M ${cx + k * w * .66} ${top - 14 + droop * 8} L ${cx + k * w * .72} ${top - 18 + droop * 8} L ${cx + k * w * .78} ${top - 4 + droop * 8} Z" fill="${a.earTip}"/>` : `<path d="M ${cx + k * w * .45} ${top + 8} L ${cx + k * w * .69} ${top - 8 + droop * 8} L ${cx + k * w * .74} ${top + 12} Z" fill="${a.earIn}"/>`;
    return `<path d="M ${cx + k * w * .33} ${top + 8} L ${cx + k * w * (.72 + droop * .12)} ${top - 18 + droop * 10} L ${cx + k * w * .84} ${top + 20} Z" fill="${a.fill}" ${st}/>${tip}`;
  }).join('');
  if (a.ear === 'dog') ears = [-1, 1].map(k => `<path d="M ${cx + k * w * .6} ${top + 8} q ${k * 22} 4 ${k * 18} ${34 + droop * 6} q ${k * -12} 2 ${k * -16} -14 z" fill="${a.earC}" ${st}/>`).join('');
  if (a.ear === 'bunny') ears = [-1, 1].map(k => `<g transform="rotate(${k * (sad ? 40 : 10)} ${cx + k * w * .3} ${top + 8})"><ellipse cx="${cx + k * w * .3}" cy="${top - 18}" rx="9" ry="26" fill="${a.fill}" ${st}/><ellipse cx="${cx + k * w * .3}" cy="${top - 16}" rx="4" ry="16" fill="${a.earIn}"/></g>`).join('');
  if (a.ear === 'round') ears = [-1, 1].map(k => `<circle cx="${cx + k * w * .64}" cy="${top + 8 + droop * 4}" r="12" fill="${a.earC}" ${a.earC === LINE ? '' : st}/>${a.earIn ? `<circle cx="${cx + k * w * .64}" cy="${top + 9 + droop * 4}" r="6" fill="${a.earIn}"/>` : ''}`).join('');
  if (a.ear === 'fluffy') ears = [-1, 1].map(k => `<circle cx="${cx + k * w * .78}" cy="${top + 14 + droop * 5}" r="17" fill="${a.earC}" ${st}/><circle cx="${cx + k * w * .8}" cy="${top + 16 + droop * 5}" r="9" fill="${a.earIn}"/>`).join('');
  if (a.ear === 'small') ears = [-1, 1].map(k => `<circle cx="${cx + k * w * .5}" cy="${top + 4}" r="9" fill="${a.earC}" ${st}/><circle cx="${cx + k * w * .5}" cy="${top + 5}" r="4.5" fill="${a.earIn}"/>`).join('');
  if (a.ear === 'tiny') ears = [-1, 1].map(k => `<circle cx="${cx + k * w * .55}" cy="${top + 7}" r="6.5" fill="${a.earC}" ${st}/>`).join('');

  // Detalles sobre el cuerpo (recortados a su forma)
  let marks = '';
  if (a.stripe) marks += `<path d="M ${cx - 10} ${top + 2} q 10 10 20 0" fill="none" stroke="${a.stripe}" stroke-width="6" stroke-linecap="round"/>`;
  if (a.patch) marks += `<ellipse cx="${cx + exs + 2}" cy="${ey - 2}" rx="${w * .28}" ry="${w * .24}" fill="${a.patch}"/>`;
  if (a.mask) marks += `<path d="M ${L - 4} ${ey + 4} Q ${cx - w * .5} ${ey - 10} ${cx} ${ey + 2} Q ${cx + w * .5} ${ey - 10} ${R + 4} ${ey + 4} L ${R + 4} ${bottom + 4} L ${L - 4} ${bottom + 4} Z" fill="${a.mask}"/>`;
  if (a.face) marks += `<path d="M ${cx} ${ey + w * .9} C ${cx - w * 1.1} ${ey + w * .2}, ${cx - w * .7} ${ey - w * .75}, ${cx} ${ey - w * .3} C ${cx + w * .7} ${ey - w * .75}, ${cx + w * 1.1} ${ey + w * .2}, ${cx} ${ey + w * .9} Z" fill="${a.face}"/>`;
  if (a.cheeks) marks += [-1, 1].map(k => `<ellipse cx="${cx + k * (exs + 6)}" cy="${my + 2}" rx="${w * .34}" ry="${w * .26}" fill="${a.cheeks}"/>`).join('') + `<ellipse cx="${cx}" cy="${bottom - 8}" rx="${w * .5}" ry="${w * .3}" fill="${a.cheeks}"/>`;
  if (a.muzzle) marks += `<ellipse cx="${cx}" cy="${my + 1}" rx="${w * .34}" ry="${w * .24}" fill="${a.muzzle}"/>`;
  if (a.patches) marks += [-1, 1].map(k => `<ellipse cx="${cx + k * exs}" cy="${ey + 1}" rx="${10 * big}" ry="${12 * big}" fill="${a.patches}" transform="rotate(${k * -20} ${cx + k * exs} ${ey})"/>`).join('');

  // Ropa del cuerpo (debajo de la cara, recortada al cuerpo)
  const neckY = my + 6 * big;
  let clothes = '';
  if (wear.body === 'camiseta') clothes += `<rect x="${L - 4}" y="${neckY}" width="${w * 2 + 8}" height="${bottom - neckY + 6}" fill="#6EC3FF"/>${[0, 1, 2, 3].map(i => `<rect x="${L - 4}" y="${neckY + 6 + i * 12}" width="${w * 2 + 8}" height="5" fill="#FFFFFF" opacity=".85"/>`).join('')}`;
  if (wear.body === 'sueter') clothes += `<rect x="${L - 4}" y="${neckY}" width="${w * 2 + 8}" height="${bottom - neckY + 6}" fill="#E8456B"/><rect x="${L - 4}" y="${neckY}" width="${w * 2 + 8}" height="6" fill="#C7304F"/><path d="M ${cx} ${neckY + 26} c -9 -8 -9 -16 -3 -17 c 2 0 3 1 3 3 c 0 -2 1 -3 3 -3 c 6 1 6 9 -3 17 z" fill="#FFF0F4"/>`;

  // Cara
  const ink = a.patches ? '#FFFFFF' : LINE;
  let face = '';
  if (happy) face += [-1, 1].map(k => `<path d="M ${cx + k * exs - 6 * big} ${ey + 2} q ${6 * big} ${-8 * big} ${12 * big} 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`).join('');
  else if (sleep) face += [-1, 1].map(k => `<path d="M ${cx + k * exs - 6} ${ey} h 12" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`).join('');
  else face += [-1, 1].map(k => `<g class="pa-blink"><circle cx="${cx + k * exs}" cy="${ey}" r="${(hungry ? 6.5 : 5) * big}" fill="${ink}"/>${a.patches ? '' : `<circle cx="${cx + k * exs + 1.7}" cy="${ey - 2}" r="${1.8 * big}" fill="#fff"/>`}</g>`).join('');
  if (sad) face += [-1, 1].map(k => `<path d="M ${cx + k * exs - k * 7} ${ey - 14} l ${k * 12} 4" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`).join('') + `<path class="pa-tear" d="M ${cx - exs} ${ey + 8} q -4 7 0 9 q 4 -2 0 -9 z" fill="${TEAR}"/>`;
  face += [-1, 1].map(k => `<ellipse cx="${cx + k * (exs + 10)}" cy="${ey + 10}" rx="7" ry="4" fill="${BLUSH}" opacity="${sad ? .35 : .8}"/>`).join('');
  if (a.bigNose) face += `<ellipse cx="${cx}" cy="${ey + 8}" rx="${7 * big}" ry="${9 * big}" fill="${a.bigNose}"/>`;
  else if (a.nose) face += `<ellipse cx="${cx}" cy="${my - 6}" rx="4" ry="3" fill="${a.nose}"/>`;
  if (a.whiskers) face += [-1, 1].map(k => `<path d="M ${cx + k * 9} ${my - 3} l ${k * 14} -3 M ${cx + k * 9} ${my} l ${k * 14} 2" stroke="${LINE}" stroke-width="1.6" opacity=".6" stroke-linecap="round"/>`).join('');
  if (a.beak) face += hungry ? `<path d="M ${cx - 7} ${my - 4} L ${cx + 7} ${my - 4} L ${cx} ${my + 1} Z" fill="${a.beak}" ${st}/><path d="M ${cx - 6} ${my + 3} L ${cx + 6} ${my + 3} L ${cx} ${my + 9} Z" fill="${a.beak}" ${st}/>` : `<path d="M ${cx - 7} ${my - 3} L ${cx + 7} ${my - 3} L ${cx} ${my + 5} Z" fill="${a.beak}" ${st}/>`;
  else if (happy) face += `<path d="M ${cx - 6} ${my - 2} q 3 4 6 0 q 3 4 6 0" stroke="${LINE}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (hungry) face += `<ellipse cx="${cx}" cy="${my + 1}" rx="4" ry="5" fill="${LINE}"/><path d="M ${cx + 6} ${my} q 2 7 0 10" stroke="${TEAR}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (sad) face += `<path d="M ${cx - 6} ${my + 3} q 6 -6 12 0" stroke="${LINE}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else face += `<path d="M ${cx - 3} ${my} h 6" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx + 11}" cy="${my - 1}" r="6" fill="rgba(170,215,255,.35)" stroke="#AAD7FF" stroke-width="2"/>`;
  const wings = a.wings ? [-1, 1].map(k => `<path d="M ${cx + k * (w - 2)} ${ey + 14} q ${k * 16} 10 ${k * 6} 30 q ${k * -8} -6 ${k * -8} -24 z" fill="${a.fill}" ${st}/>`).join('') : '';

  // Accesorios de cuello, cara y cabeza
  let acc = '';
  if (wear.neck === 'bufanda') acc += `<path d="M ${L + 2} ${neckY - 2} Q ${cx} ${neckY + 10} ${R - 2} ${neckY - 2} L ${R - 2} ${neckY + 8} Q ${cx} ${neckY + 20} ${L + 2} ${neckY + 8} Z" fill="#7B5CFF" ${st}/><path d="M ${cx + w * .3} ${neckY + 8} l 4 24 l 10 -2 l -4 -22 z" fill="#7B5CFF" ${st}/>`;
  if (wear.neck === 'corbatin') acc += `<path d="M ${cx} ${neckY + 2} l -14 -8 l 0 16 z M ${cx} ${neckY + 2} l 14 -8 l 0 16 z" fill="#E8456B" ${st}/><circle cx="${cx}" cy="${neckY + 2}" r="4" fill="#C7304F" ${st}/>`;
  if (wear.neck === 'collar') acc += `<path d="M ${cx - w * .7} ${neckY - 4} Q ${cx} ${neckY + 10} ${cx + w * .7} ${neckY - 4}" stroke="#E8456B" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="${cx}" cy="${neckY + 8}" r="6" fill="#FFC93D" ${st}/><circle cx="${cx}" cy="${neckY + 10}" r="1.6" fill="${LINE}"/>`;
  if (wear.face === 'lentes' && !sleep) acc += `<g fill="rgba(255,255,255,.2)" ${st.replace('3.5', '3')}><circle cx="${cx - exs}" cy="${ey}" r="${10 * big}"/><circle cx="${cx + exs}" cy="${ey}" r="${10 * big}"/></g><path d="M ${cx - exs + 10 * big} ${ey} h ${2 * exs - 20 * big}" stroke="${LINE}" stroke-width="3"/>`;
  if (wear.face === 'gafas') acc += `<g fill="${LINE}"><rect x="${cx - exs - 12 * big}" y="${ey - 7 * big}" width="${24 * big}" height="${14 * big}" rx="6"/><rect x="${cx + exs - 12 * big}" y="${ey - 7 * big}" width="${24 * big}" height="${14 * big}" rx="6"/></g><path d="M ${cx - exs + 12 * big} ${ey - 2} h ${2 * exs - 24 * big}" stroke="${LINE}" stroke-width="3"/><path d="M ${cx - exs - 7} ${ey - 3} l 5 -2 M ${cx + exs - 7} ${ey - 3} l 5 -2" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/>`;
  const hy = a.ear === 'bunny' ? top + 2 : top + 4;
  if (wear.head === 'mono') acc += `<g transform="translate(${cx - w * .45} ${hy + 4}) rotate(-15)"><path d="M 0 0 l -16 -10 l 0 20 z M 0 0 l 16 -10 l 0 20 z" fill="#FF7FA8" ${st}/><circle r="5" fill="#E8456B" ${st}/></g>`;
  if (wear.head === 'flor') acc += `<g transform="translate(${cx + w * .45} ${hy + 4})">${[0, 72, 144, 216, 288].map(r => `<ellipse cx="0" cy="-8" rx="5.5" ry="8" fill="#FFFFFF" ${st.replace('3.5', '2.5')} transform="rotate(${r})"/>`).join('')}<circle r="5" fill="#FFC93D" ${st.replace('3.5', '2.5')}/></g>`;
  if (wear.head === 'gorrito') acc += `<g transform="rotate(-12 ${cx} ${hy})"><path d="M ${cx - 15} ${hy + 4} L ${cx} ${hy - 32} L ${cx + 15} ${hy + 4} Z" fill="#7B5CFF" ${st}/><path d="M ${cx - 10} ${hy - 8} L ${cx + 10} ${hy - 8} M ${cx - 5} ${hy - 20} L ${cx + 5} ${hy - 20}" stroke="#FFB547" stroke-width="4"/><circle cx="${cx}" cy="${hy - 33}" r="5.5" fill="#FF5C8A" ${st.replace('3.5', '2.5')}/></g>`;
  if (wear.head === 'sombrero') acc += `<ellipse cx="${cx}" cy="${hy + 4}" rx="${w * .9}" ry="8" fill="#F2D48B" ${st}/><path d="M ${cx - w * .45} ${hy + 3} C ${cx - w * .45} ${hy - 22}, ${cx + w * .45} ${hy - 22}, ${cx + w * .45} ${hy + 3} Z" fill="#F2D48B" ${st}/><path d="M ${cx - w * .44} ${hy - 2} Q ${cx} ${hy + 2} ${cx + w * .44} ${hy - 2}" stroke="#E8456B" stroke-width="5" fill="none"/>`;
  if (wear.head === 'corona') acc += `<path d="M ${cx - 17} ${hy + 4} L ${cx - 19} ${hy - 16} L ${cx - 8} ${hy - 6} L ${cx} ${hy - 21} L ${cx + 8} ${hy - 6} L ${cx + 19} ${hy - 16} L ${cx + 17} ${hy + 4} Z" fill="#FFC93D" ${st}/><circle cx="${cx}" cy="${hy - 4}" r="3" fill="#FF5C8A"/>`;

  const legend = stage >= 5 ? [[-1, .2], [1, .6], [-.8, 1.1]].map(([k, d]) => `<path class="pa-spark" style="animation-delay:${d}s" d="M ${cx + k * (w + 14)} ${top + 20 + d * 30} l 2 -6 l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 z" fill="#FFE07A"/>`).join('') : '';
  const squash = sad ? `transform="translate(${cx} ${bottom}) scale(1.04 .95) translate(${-cx} ${-bottom})"` : '';
  return `<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
    <ellipse cx="80" cy="146" rx="${w}" ry="5" fill="#000" opacity=".22"/>${legend}
    <g class="${sleep || sad ? '' : 'pa-squish'}" ${squash}>${ears}${wings}<path d="${body}" fill="${a.fill}"/>
      <g clip-path="url(#${id})">${marks}${clothes}</g><path d="${body}" fill="none" ${st}/>${face}${acc}</g>
    ${sleep ? `<text class="pa-z" x="${cx + w - 4}" y="${top + 6}" font-family="Sora, sans-serif" font-weight="800" font-size="16" fill="#C9B8FF">z</text><text class="pa-z" style="animation-delay:1s" x="${cx + w + 8}" y="${top - 6}" font-family="Sora, sans-serif" font-weight="800" font-size="12" fill="#C9B8FF">z</text>` : ''}`;
}

/* ---------- Escenario ---------- */
export const timeOfDay = (h = new Date().getHours()) => h >= 6 && h < 17 ? 'dia' : h >= 17 && h < 19 ? 'tarde' : 'noche';
export function sceneSVG({ species, mood, stage, wear = {}, egg, ready, fed = false, time = timeOfDay(), label = 'Su mascota' } = {}) {
  const sky = { dia: ['#9ED8FF', '#DDF2FF'], tarde: ['#FF9478', '#FFD69A'], noche: ['#1E1640', '#3A2A6E'] }[time];
  const ground = { dia: '#A6DB86', tarde: '#D2AA68', noche: '#3E5A4A' }[time];
  const gid = 'sk' + (++uidN);
  let s = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
    <rect width="200" height="200" fill="url(#${gid})"/>`;
  if (time === 'dia') s += `<circle cx="165" cy="34" r="15" fill="#FFE07A"/><g fill="#fff" opacity=".9"><ellipse cx="44" cy="36" rx="18" ry="8"/><ellipse cx="57" cy="31" rx="11" ry="8"/></g>`;
  if (time === 'tarde') s += `<circle cx="160" cy="120" r="22" fill="#FFE07A" opacity=".9"/>`;
  if (time === 'noche') { s += `<circle cx="162" cy="34" r="13" fill="#FFF3C4"/><circle cx="168" cy="29" r="12" fill="#2A1F58"/>`; for (const [x, y] of [[22, 24], [58, 46], [96, 18], [122, 58], [34, 78], [182, 80], [76, 84]]) s += `<circle cx="${x}" cy="${y}" r="1.4" fill="#fff"/>`; }
  s += `<path d="M0 148 Q 50 136 100 146 T 200 140 V200 H0 Z" fill="${ground}"/>`;
  // Cuarto
  if (wear.room === 'luces') s += `<path d="M 6 18 Q 100 46 194 18" stroke="#3B2A3A" stroke-width="1.5" fill="none"/>${[20, 44, 70, 100, 130, 156, 180].map((x, i) => `<circle class="pa-twinkle" style="animation-delay:${i * .3}s" cx="${x}" cy="${18 + Math.sin(x / 200 * Math.PI) * 26 + 6}" r="4" fill="${['#FF5C8A', '#FFE07A', '#7FE0B0', '#8FD3FF'][i % 4]}"/>`).join('')}`;
  if (wear.room === 'globos') s += `<g class="pa-float"><path d="M 26 92 q -2 30 6 56" stroke="#3B2A3A" stroke-width="1.2" fill="none"/><ellipse cx="26" cy="80" rx="12" ry="14" fill="#FF5C8A" stroke="#3B2A3A" stroke-width="2"/><path d="M 44 98 q 0 26 -8 50" stroke="#3B2A3A" stroke-width="1.2" fill="none"/><ellipse cx="44" cy="86" rx="11" ry="13" fill="#FFB547" stroke="#3B2A3A" stroke-width="2"/></g>`;
  if (wear.room === 'planta') s += `<path d="M 14 186 h 26 l -4 -24 h -18 z" fill="#E07F4E" stroke="#3B2A3A" stroke-width="2.5" stroke-linejoin="round"/><path d="M 27 162 q -14 -16 -8 -34 q 10 10 8 34 q 4 -22 16 -28 q 2 18 -16 28" fill="#5DBB6A" stroke="#3B2A3A" stroke-width="2.5" stroke-linejoin="round"/>`;
  if (wear.room === 'cojin') s += `<ellipse cx="100" cy="186" rx="66" ry="12" fill="#FF8FA8" stroke="#3B2A3A" stroke-width="2.5"/><path d="M 44 184 q 56 10 112 0" stroke="#FFFFFF" stroke-width="2" fill="none" opacity=".6"/>`;
  // Mascota (encima del cojín) y platito
  s += `<g transform="translate(20 ${wear.room === 'cojin' ? 22 : 28})"><g class="pa-pet">${petSVG({ species, mood, stage, wear, egg, ready })}</g></g>`;
  if (!egg) s += `${fed ? `<ellipse cx="170" cy="178" rx="13" ry="4" fill="#C8763A"/><circle cx="164" cy="176" r="3" fill="#A65A26"/><circle cx="172" cy="175" r="3" fill="#B86A30"/><circle cx="178" cy="177" r="2.6" fill="#A65A26"/>` : ''}
    <path d="M 154 178 q 16 14 32 0 z" fill="#FF5C8A" stroke="#3B2A3A" stroke-width="2"/><rect x="153" y="176.5" width="34" height="3" rx="1.5" fill="#FF8FA8"/>`;
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${label}">${s}</svg>`;
}
// La mascota sola como imagen (para los juegos, que la dibujan en un canvas)
export function petImage(opts, size = 160) {
  const img = new Image(size, size);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="${size}" height="${size}">${petSVG(opts)}</svg>`);
  return img;
}
