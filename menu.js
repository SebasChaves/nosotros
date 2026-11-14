// Tu menú: cada uno elige qué secciones van en la barra de abajo (de 1 a 4, entre Inicio y Más), en qué orden
// salen y cuáles esconde de Más. Se guarda en profiles/<uid>.prefs.menu = { order: [pantallas], bar: [...], hidden: [...] }
// y solo cambia lo que ve esa persona. core.js (setBar) dibuja la barra; settings.js pinta Más y el editor.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, esc, icon, on, expose, toast, write, ref, profile, uid, SECTIONS, BAR_DEFAULT, BAR_MAX, setBar, inBar, rerenderAll, gateOn } from './core.js';
import { listNeedsMyVote } from './decide.js';
import { unreadNotes, couponAlerts } from './love.js';
import { unseenSnaps } from './snaps.js';
import { quizWaiting } from './quiz.js';
import { cravingAlerts } from './cravings.js';
import { arrowsAlerts } from './arrows.js';
import { busAlerts } from './bus.js';

const prefs = () => profile(uid()).prefs?.menu || {};
const known = id => SECTIONS.some(([k]) => k === id) && gateOn(id);
// Orden elegido; las secciones nuevas que no estén guardadas entran detrás de la que tienen antes en SECTIONS
export function menuOrder() {
  const out = (prefs().order || []).filter(known);
  SECTIONS.forEach(([id], k) => {
    if (out.includes(id) || !gateOn(id)) return;
    const prev = k > 0 ? out.indexOf(SECTIONS[k - 1][0]) : -1;
    out.splice(prev >= 0 ? prev + 1 : (k === 0 ? 0 : out.length), 0, id);
  });
  return out;
}
export const barChoice = () => { const b = (prefs().bar || BAR_DEFAULT).filter(known); return menuOrder().filter(id => b.includes(id)).slice(0, BAR_MAX); };
export const hiddenInMore = id => (prefs().hidden || []).includes(id);
export const sectionName = id => SECTIONS.find(([k]) => k === id)?.[2] || id;
export const sectionIcon = id => SECTIONS.find(([k]) => k === id)?.[1] || 'grid';

// Avisos (puntitos) por sección: van en su botón de la barra o, si no está en la barra, se suman en Más
export const sectionAlerts = () => ({
  's-decide': S.data.lists.filter(listNeedsMyVote).length, 's-love': unreadNotes() + couponAlerts(),
  's-moments': unseenSnaps().length, 's-quiz': quizWaiting() ? 1 : 0, 's-cravings': cravingAlerts(), 's-arrows': arrowsAlerts(), 's-bus': busAlerts(),
});

const saveMenu = patch => write(setDoc(ref('profiles', uid()), { prefs: { menu: { order: menuOrder(), bar: barChoice(), hidden: prefs().hidden || [], ...patch } } }, { merge: true }));
function menuBar(id, on) {
  const bar = barChoice();
  if (on && bar.length >= BAR_MAX) return toast(`Caben ${BAR_MAX} en la barra: quita una primero`);
  if (!on && bar.length <= 1) return toast('Deja al menos una en la barra');
  saveMenu({ bar: on ? [...bar, id] : bar.filter(x => x !== id) });
}
function menuShow(id, show) { const h = (prefs().hidden || []).filter(x => x !== id); saveMenu({ hidden: show ? h : [...h, id] }); }
function menuMove(i, d) {
  const l = menuOrder(), j = i + d; if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; saveMenu({ order: l });
}
function menuReset() { saveMenu({ order: SECTIONS.map(([k]) => k), bar: BAR_DEFAULT, hidden: [] }); toast('Menú como al principio'); }

// Tarjeta de Ajustes → Tu menú
export function menuPrefsCard() {
  const order = menuOrder(), bar = barChoice();
  return `<div class="glass stack" id="menuCard"><span class="label">${icon('grid')} Tu menú</span>
    <p class="small muted" style="margin:0">Elige qué secciones van en la barra de abajo (hasta ${BAR_MAX}, entre Inicio y Más) y el orden de todo. Las demás quedan en Más. Solo cambia lo que ves tú.</p>
    <div class="menu-preview" aria-hidden="true">${['s-home', ...bar, 's-more'].map(id => `<span>${icon(id === 's-home' ? 'heart' : id === 's-more' ? 'grid' : sectionIcon(id))}</span>`).join('')}</div>
    <ul class="list menu-list">${order.map((id, i) => {
      const b = bar.includes(id), h = !b && hiddenInMore(id);
      return `<li><span class="badge-ic small-ic">${icon(sectionIcon(id))}</span>
        <span class="txt ${h ? 'muted' : ''}">${esc(sectionName(id))}<span class="sub">${b ? 'En la barra' : h ? 'Oculta (se encuentra con el buscador)' : 'En Más'}</span></span>
        <button class="chip ${b ? 'on' : ''}" aria-pressed="${b}" aria-label="${b ? 'Quitar de la barra' : 'Poner en la barra'}: ${esc(sectionName(id))}" onclick="menuBar('${id}', ${!b})">${b ? '📌 Barra' : '+ Barra'}</button>
        ${b ? '' : `<input type="checkbox" ${h ? '' : 'checked'} aria-label="Mostrar ${esc(sectionName(id))} en Más" onchange="menuShow('${id}', this.checked)">`}
        <button class="del" aria-label="Subir" ${i === 0 ? 'disabled' : ''} onclick="menuMove(${i},-1)">▲</button><button class="del" aria-label="Bajar" ${i === order.length - 1 ? 'disabled' : ''} onclick="menuMove(${i},1)">▼</button></li>`;
    }).join('')}</ul>
    <button class="link" onclick="menuReset()">Volver al menú original</button></div>`;
}

// Aplica la barra cuando cambia el perfil (y al arrancar). Si cambió, repinta las pantallas que muestran o no su botón Volver.
on('profiles', () => { if (S.me && setBar(barChoice())) setTimeout(rerenderAll); });
window.inBar = inBar;
expose({ menuBar, menuShow, menuMove, menuReset });
