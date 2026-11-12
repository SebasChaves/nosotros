// Recetas (incluidas + propias), favoritas y menú semanal con envío de ingredientes al Súper.
import { setDoc, deleteDoc, deleteField, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, ask, pick, celebrate,
         today, dayKey, parseDate, plural, uid } from './core.js';
import { RECIPES, RECIPE_TAGS } from './recipes-data.js';
import { backBar } from './lists.js';

let tab = 'list', q = '', tag = '', onlyFav = false, weekOffset = 0;
const SLOTS = [['almuerzo', 'Almuerzo'], ['cena', 'Cena']];
const norm = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const allRecipes = () => [...RECIPES, ...S.data.recipes.map(r => ({ ...r, builtIn: false }))];
const recipe = id => allRecipes().find(r => r.id === id);
const isFav = id => S.data.recipefav.some(f => f.id === id);
const mondayOf = off => { const t = today(); const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + off * 7); return d; };
const weekDays = off => { const m = mondayOf(off); return [...Array(7)].map((_, i) => dayKey(new Date(m.getFullYear(), m.getMonth(), m.getDate() + i))); };
const weekDoc = off => S.data.menu.find(w => w.id === weekDays(off)[0]) || {};
export const cookedCount = () => S.data.menu.reduce((s, w) => s + Object.values(w.days || {}).reduce((a, d) => a + Object.values(d || {}).filter(x => x?.id).length, 0), 0);

function render() {
  if (!$('recBody')) $('s-recipes').innerHTML = `<div id="recHead" class="stack"></div><div id="recBody" class="stack" style="gap:14px"></div>`;
  paint('recHead', `${backBar('Recetas', 's-more', `<button class="btn small" onclick="recipeForm()">${icon('plus')} Receta</button>`)}
    <div class="seg"><button class="${tab === 'list' ? 'on' : ''}" onclick="recTab('list')">Recetas · ${allRecipes().length}</button>
      <button class="${tab === 'menu' ? 'on' : ''}" onclick="recTab('menu')">Menú de la semana</button></div>`);
  tab === 'list' ? renderList() : renderMenu();
}
function recTab(t) { tab = t; render(); }

/* ---------- Lista ---------- */
function filtered() {
  const n = norm(q);
  return allRecipes().filter(r => (!tag || r.tags?.includes(tag)) && (!onlyFav || isFav(r.id)) && (!n || norm(r.name + ' ' + r.ingredients.join(' ')).includes(n)))
    .sort((a, b) => (isFav(b.id) - isFav(a.id)) || a.name.localeCompare(b.name));
}
function renderList() {
  const list = filtered();
  paint('recBody', `
    <input id="recSearch" type="search" placeholder="Buscar receta o ingrediente…" aria-label="Buscar receta" value="${esc(q)}" oninput="recSearch(this.value)">
    <div class="chips scroll"><button class="chip ${onlyFav ? 'on' : ''}" onclick="recFav()">${icon('heart-f')} Favoritas</button>
      ${RECIPE_TAGS.map(([k, l]) => `<button class="chip ${tag === k ? 'on' : ''}" onclick="recTag('${k}')">${l}</button>`).join('')}</div>
    <button class="btn ghost" onclick="recRandom()">${icon('dice')} ¿Qué cocinamos hoy?</button>
    <div class="glass" style="padding:6px 14px">${list.length ? list.map(r => `
      <button class="result-row" onclick="openRecipe('${esc(r.id)}')"><span class="e" style="font-size:22px">${esc(r.emoji || '🍽️')}</span>
        <span class="grow" style="min-width:0"><b style="display:block">${esc(r.name)}</b><span class="tiny muted">${r.min ? `${r.min} min · ` : ''}${r.builtIn ? '' : 'Receta suya · '}${(r.tags || []).map(t => RECIPE_TAGS.find(x => x[0] === t)?.[1]).filter(Boolean).slice(0, 2).join(' · ')}</span></span>
        ${isFav(r.id) ? `<span style="color:var(--g1)">${icon('heart-f')}</span>` : ''}</button>`).join('') : '<p class="empty">No hay recetas con ese filtro</p>'}</div>`);
}
let qTimer = null;
function recSearch(v) { q = v; clearTimeout(qTimer); qTimer = setTimeout(renderList, 150); }
function recTag(k) { tag = tag === k ? '' : k; renderList(); }
function recFav() { onlyFav = !onlyFav; renderList(); }
function recRandom() {
  const pool = filtered().filter(r => !r.tags?.includes('postre'));
  if (!pool.length) return toast('No hay recetas con ese filtro');
  openRecipe(pick(pool).id, true);
}

/* ---------- Detalle ---------- */
function openRecipe(id, lucky = false) {
  const r = recipe(id); if (!r) return;
  const pending = new Set(S.data.groceries.filter(g => !g.done).map(g => norm(g.text)));
  const days = weekDays(0).filter(d => d >= dayKey(today())).concat(weekDays(1)).slice(0, 7);
  openSheet(`<div class="stack">
    ${lucky ? '<span class="label">Hoy toca…</span>' : ''}
    <div class="row start" style="gap:12px"><span style="font-size:44px">${esc(r.emoji || '🍽️')}</span><div><h2>${esc(r.name)}</h2>
      <span class="small muted">${r.min ? `${r.min} min · ` : ''}${plural(r.servings || 2, 'porción', 'porciones')}</span></div></div>
    <span class="label">Ingredientes</span>
    <ul class="list">${r.ingredients.map(i => `<li style="padding:7px 0"><span class="txt small">${esc(i)}</span>${pending.has(norm(i)) ? '<span class="pill">en el súper</span>' : ''}</li>`).join('')}</ul>
    <button class="btn ghost" onclick="recipeToGrocery('${esc(r.id)}')">${icon('cart')} Ingredientes al Súper</button>
    <span class="label">Preparación</span>
    <ol style="margin:0;padding-left:20px;line-height:1.55;font-size:14.5px">${r.steps.map(s => `<li style="margin-bottom:6px">${esc(s)}</li>`).join('')}</ol>
    <span class="label">Agregar al menú</span>
    <div class="grid2"><select id="recDay" aria-label="Día">${days.map(d => `<option value="${d}">${cap(parseDate(d).toLocaleDateString('es', { weekday: 'long', day: 'numeric' }))}</option>`).join('')}</select>
      <select id="recSlot" aria-label="Comida">${SLOTS.map(([k, l]) => `<option value="${k}" ${k === 'cena' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <button class="btn" onclick="recipeToMenu('${esc(r.id)}')">${icon('cal')} Agregar al menú</button>
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="toggleFav('${esc(r.id)}')">${icon(isFav(r.id) ? 'heart-f' : 'heart')} ${isFav(r.id) ? 'Quitar de favoritas' : 'Favorita'}</button>
      ${r.builtIn ? '' : `<button class="btn danger small" style="width:100%" onclick="delRecipe('${esc(r.id)}')">${icon('trash')} Borrar</button>`}</div></div>`);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function addIngredients(list) {
  const have = new Set(S.data.groceries.filter(g => !g.done).map(g => norm(g.text)));
  const toAdd = [...new Set(list)].filter(i => !have.has(norm(i)));
  if (!toAdd.length) { toast('Ya está todo en el súper'); return 0; }
  const batch = writeBatch(db);
  toAdd.forEach(t => batch.set(newRef('groceries'), { text: t, done: false, by: uid(), createdAt: Date.now() }));
  write(batch.commit());
  return toAdd.length;
}
function recipeToGrocery(id) { const n = addIngredients(recipe(id).ingredients); if (n) { toast(`${plural(n, 'ingrediente agregado', 'ingredientes agregados')} al súper`); closeSheet(); } }
function setSlot(day, slot, value) {
  const monday = dayKey(mondayOf(Math.floor((parseDate(day) - mondayOf(0)) / (7 * 864e5))));
  write(setDoc(ref('menu', monday), { days: { [day]: { [slot]: value ?? deleteField() } } }, { merge: true }));
}
function recipeToMenu(id) {
  setSlot($('recDay').value, $('recSlot').value, { id, by: uid() });
  closeSheet(); toast('Agregada al menú'); tab = 'menu'; render();
}
function toggleFav(id) {
  if (isFav(id)) write(deleteDoc(ref('recipefav', id))); else { write(setDoc(ref('recipefav', id), { by: uid(), at: Date.now() })); celebrate('hearts'); }
  closeSheet();
}
async function delRecipe(id) { if (await ask('¿Borrar esta receta?')) { write(deleteDoc(ref('recipes', id))); closeSheet(); } }
function recipeForm() {
  openSheet(`<div class="stack"><h2>Nueva receta</h2>
    <div class="add-row"><input id="rEmoji" style="flex:0 0 60px;text-align:center" value="🍽️" maxlength="4" aria-label="Emoji"><input id="rName" placeholder="Nombre" maxlength="60" aria-label="Nombre"></div>
    <div class="grid2"><input id="rMin" inputmode="numeric" placeholder="Minutos" aria-label="Minutos"><select id="rTag" aria-label="Tipo"><option value="">Tipo (opcional)</option>${RECIPE_TAGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <label class="f" for="rIng">Ingredientes (uno por línea)</label><textarea id="rIng" style="min-height:110px"></textarea>
    <label class="f" for="rSteps">Pasos (uno por línea)</label><textarea id="rSteps" style="min-height:110px"></textarea>
    <button class="btn" onclick="saveRecipe()">Guardar receta</button></div>`);
}
function saveRecipe() {
  const name = $('rName').value.trim(), lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!name || !lines('rIng').length) return toast('Pon el nombre y al menos un ingrediente');
  write(setDoc(newRef('recipes'), { name, emoji: $('rEmoji').value.trim() || '🍽️', min: parseInt($('rMin').value, 10) || 0, servings: 2,
    tags: $('rTag').value ? [$('rTag').value] : [], ingredients: lines('rIng'), steps: lines('rSteps'), by: uid(), createdAt: Date.now() }));
  closeSheet(); toast('Receta guardada');
}

/* ---------- Menú semanal ---------- */
function renderMenu() {
  const days = weekDays(weekOffset), wk = weekDoc(weekOffset).days || {}, tk = dayKey(today());
  const label = weekOffset === 0 ? 'Esta semana' : weekOffset === 1 ? 'La próxima semana' : weekOffset === -1 ? 'La semana pasada' : `${parseDate(days[0]).toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${parseDate(days[6]).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`;
  const recipesInWeek = days.flatMap(d => SLOTS.map(([s]) => wk[d]?.[s]?.id)).filter(Boolean);
  paint('recBody', `
    <div class="glass row"><button class="icon-btn" aria-label="Semana anterior" onclick="menuWeek(-1)">${icon('back')}</button>
      <b>${label}</b><button class="icon-btn" aria-label="Semana siguiente" style="transform:scaleX(-1)" onclick="menuWeek(1)">${icon('back')}</button></div>
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="menuToGrocery()">${icon('cart')} Ingredientes al Súper</button>
      <button class="btn ghost small" style="width:100%" onclick="menuFill()">${icon('dice')} Rellenar cenas vacías</button></div>
    ${days.map(d => `<div class="glass" style="${d === tk ? 'border-color:color-mix(in srgb,var(--g1) 60%,transparent)' : ''}">
      <span class="label">${cap(parseDate(d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' }))}${d === tk ? ' · hoy' : ''}</span>
      ${SLOTS.map(([s, l]) => { const v = wk[d]?.[s]; const r = v?.id && recipe(v.id);
        return `<button class="result-row" onclick="menuSlot('${d}','${s}')"><span class="e">${r ? esc(r.emoji) : v?.text ? '📝' : '＋'}</span>
          <span class="grow"><span class="tiny muted" style="display:block">${l}</span>${r ? `<b>${esc(r.name)}</b>` : v?.text ? `<b>${esc(v.text)}</b>` : '<span class="muted small">Sin planear</span>'}</span></button>`; }).join('')}</div>`).join('')}
    <p class="tiny muted center" style="margin:0">${plural(recipesInWeek.length, 'receta planeada', 'recetas planeadas')} esta semana</p>`);
}
function menuWeek(d) { weekOffset += d; renderMenu(); }
function menuSlot(day, slot) {
  const v = (weekDoc(Math.floor((parseDate(day) - mondayOf(0)) / (7 * 864e5))).days || {})[day]?.[slot];
  const favs = allRecipes().filter(r => isFav(r.id)), others = allRecipes().filter(r => !isFav(r.id) && !r.tags?.includes('postre'));
  openSheet(`<div class="stack"><h2>${cap(parseDate(day).toLocaleDateString('es', { weekday: 'long', day: 'numeric' }))} · ${SLOTS.find(x => x[0] === slot)[1]}</h2>
    ${v ? `<div class="grid2">${v.id ? `<button class="btn ghost small" style="width:100%" onclick="openRecipe('${esc(v.id)}')">Ver receta</button>` : '<span></span>'}
      <button class="btn danger small" style="width:100%" onclick="menuClear('${day}','${slot}')">Quitar</button></div>` : ''}
    <div class="add-row"><input id="menuText" placeholder="Otra cosa (ej. comer fuera)" maxlength="50" aria-label="Otra cosa">
      <button class="btn" aria-label="Guardar" onclick="menuSetText('${day}','${slot}')">${icon('check')}</button></div>
    <input type="search" placeholder="Buscar receta…" aria-label="Buscar receta" oninput="menuFilter(this.value)">
    <div id="menuPick" style="max-height:44vh;overflow:auto">${[...favs, ...others].map(r => `<button class="result-row" data-n="${esc(norm(r.name))}" onclick="menuSet('${day}','${slot}','${esc(r.id)}')">
      <span class="e">${esc(r.emoji)}</span><span class="grow"><b>${esc(r.name)}</b>${isFav(r.id) ? ' <span style="color:var(--g1)">♥</span>' : ''}</span></button>`).join('')}</div></div>`);
}
function menuFilter(v) { const n = norm(v); document.querySelectorAll('#menuPick .result-row').forEach(b => { b.hidden = n && !b.dataset.n.includes(n); }); }
function menuSet(day, slot, id) { setSlot(day, slot, { id, by: uid() }); closeSheet(); }
function menuSetText(day, slot) { const t = $('menuText').value.trim(); if (!t) return; setSlot(day, slot, { text: t, by: uid() }); closeSheet(); }
function menuClear(day, slot) { setSlot(day, slot, null); closeSheet(); }
function menuToGrocery() {
  const days = weekDays(weekOffset), wk = weekDoc(weekOffset).days || {};
  const ings = days.flatMap(d => SLOTS.map(([s]) => wk[d]?.[s]?.id)).filter(Boolean).flatMap(id => recipe(id)?.ingredients || []);
  if (!ings.length) return toast('Primero planeen algunas recetas');
  const n = addIngredients(ings); if (n) toast(`${plural(n, 'ingrediente agregado', 'ingredientes agregados')} al súper`);
}
function menuFill() {
  const days = weekDays(weekOffset).filter(d => d >= dayKey(today())), wk = weekDoc(weekOffset).days || {};
  const empty = days.filter(d => !wk[d]?.cena);
  if (!empty.length) return toast('No hay cenas vacías esta semana');
  const pool = allRecipes().filter(r => !r.tags?.includes('postre') && !r.tags?.includes('desayuno'));
  const favs = pool.filter(r => isFav(r.id)), used = new Set();
  for (const d of empty) {
    const src = (favs.length > used.size ? favs : pool).filter(r => !used.has(r.id));
    const r = pick(src.length ? src : pool); used.add(r.id);
    setSlot(d, 'cena', { id: r.id, by: uid() });
  }
  toast(`${plural(empty.length, 'cena planeada', 'cenas planeadas')}`); celebrate();
}

on('recipes recipefav menu groceries', () => { if ($('recBody')) render(); });
onShow('s-recipes', render);
window.__allRecipes = allRecipes;
expose({ recTab, recSearch, recTag, recFav, recRandom, openRecipe, recipeToGrocery, recipeToMenu, toggleFav, delRecipe, recipeForm, saveRecipe,
  menuWeek, menuSlot, menuFilter, menuSet, menuSetText, menuClear, menuToGrocery, menuFill });
