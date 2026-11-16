// Recetas (incluidas + propias), favoritas y menú semanal con envío de ingredientes al Súper.
import { setDoc, updateDoc, deleteDoc, deleteField, writeBatch, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, ask, pick, celebrate,
         today, dayKey, parseDate, plural, uid, syncBack, auth, softDelete,
         todayKey, compressImage, makeThumb, thumbId, cachePhoto, photoError, loadPhotos, fmtDate, nameOf } from './core.js';
import { PUSH } from './push-config.js';
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
      <button class="${tab === 'made' ? 'on' : ''}" onclick="recTab('made')">Las que hicimos${S.data.cooked.length ? ' · ' + S.data.cooked.length : ''}</button>
      <button class="${tab === 'menu' ? 'on' : ''}" onclick="recTab('menu')">Menú</button></div>`);
  tab === 'list' ? renderList() : tab === 'made' ? renderMade() : renderMenu();
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
    <button class="btn" onclick="chefOpen()">👩‍🍳 Pregúntale al chef: «quiero hacer…»</button>
    <div class="grid2"><button class="btn ghost" onclick="recRandom()">${icon('dice')} ¿Qué cocinamos hoy?</button><button class="btn ghost" onclick="recHave()">🧺 Con lo que tengo</button></div>
    <div class="glass" style="padding:6px 14px">${list.length ? list.map(r => `
      <button class="result-row" onclick="openRecipe('${esc(r.id)}')">${recThumb(r)}
        <span class="grow" style="min-width:0"><b style="display:block">${esc(r.name)}</b><span class="tiny muted">${r.min ? `${r.min} min · ` : ''}${r.builtIn ? '' : 'Receta suya · '}${(r.tags || []).map(t => RECIPE_TAGS.find(x => x[0] === t)?.[1]).filter(Boolean).slice(0, 2).join(' · ')}</span></span>
        ${isFav(r.id) ? `<span style="color:var(--g1)">${icon('heart-f')}</span>` : ''}</button>`).join('') : '<p class="empty">No hay recetas con ese filtro</p>'}</div>`);
  loadPhotos($('recBody'));
}

/* ---------- Las que hicimos (colección "cooked") ----------
   Cada vez que cocinan algo: { rid (id de la receta o null si era del chef sin guardar), name, emoji, date, at, by,
   photo? (id en "photos": cook-<id>, con miniatura t-cook-<id>), note? }. Se anota al terminar el modo cocina o con
   «📸 La hicimos». La foto más nueva de una receta se usa como su imagen en la lista. */
const cookedOf = rid => S.data.cooked.filter(c => c.rid === rid).sort((a, b) => b.at - a.at);
const lastPhoto = rid => cookedOf(rid).find(c => c.photo);
const recThumb = r => { const p = lastPhoto(r.id); return p ? `<img class="rec-th" data-thumb="${esc(p.photo)}" alt="">` : `<span class="e" style="font-size:22px">${esc(r.emoji || '🍽️')}</span>`; };
function renderMade() {
  const list = [...S.data.cooked].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  const top = Object.values(list.reduce((m, c) => { const k = c.rid || c.name; (m[k] ??= { c, n: 0 }).n++; return m; }, {})).sort((a, b) => b.n - a.n).filter(x => x.n > 1).slice(0, 3);
  paint('recBody', list.length ? `
    ${top.length ? `<div class="glass small">🏆 La que más repiten: <b>${esc(top[0].c.name)}</b> (${top[0].n} veces)${top[1] ? ` · después ${esc(top[1].c.name)} (${top[1].n})` : ''}</div>` : ''}
    <div class="made-grid">${list.map(c => `<button class="made" onclick="openCooked('${c.id}')">
      ${c.photo ? `<img data-thumb="${esc(c.photo)}" alt="${esc(c.name)}">` : `<span class="made-e">${esc(c.emoji || '🍽️')}</span>`}
      <b>${esc(c.name)}</b><small>${new Date(c.date + 'T12:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: c.date.slice(0, 4) === todayKey().slice(0, 4) ? undefined : 'numeric' })}</small></button>`).join('')}</div>
    <p class="tiny muted center" style="margin:0">Se anotan solas al terminar el modo cocina, o con «📸 La hicimos» en cada receta.</p>`
    : `<div class="glass center stack"><div style="font-size:44px">📸</div><h2>Su recetario con fotos</h2>
      <p class="muted" style="margin:0">Cuando cocinen algo, abran la receta y toquen «📸 La hicimos» (o terminen el modo cocina). Aquí quedan todas, con foto y fecha.</p>
      <button class="btn" onclick="recTab('list')">Ver recetas</button></div>`);
  loadPhotos($('recBody'));
}
let madePic = null, madeFor = null, madeEdit = null;
// rec: receta (objeto) para anotar una vez nueva; o id de "cooked" para editar
function madeSheet(rec, editId) {
  const c = editId && S.data.cooked.find(x => x.id === editId);
  madePic = null; madeEdit = c ? c.id : null; madeFor = c ? null : rec;
  const name = c?.name || rec?.name || '', emoji = c?.emoji || rec?.emoji || '🍽️';
  openSheet(`<div class="stack"><h2>${c ? 'Editar' : '📸 ¡La hicieron!'}</h2>
    <p class="small muted" style="margin:0">${esc(emoji)} ${esc(name)}</p>
    <label class="photo-pick" id="madePick">${c?.photo ? `<img data-thumb="${esc(c.photo)}" alt="">` : `${icon('photo', 'ic lg')}<span>Foto de cómo les quedó (opcional)</span>`}
      <input type="file" accept="image/*" hidden onchange="madePhoto(this)"></label>
    <div class="grid2"><div><label class="f" for="madeDate">Día</label><input type="date" id="madeDate" max="${todayKey()}" value="${c?.date || todayKey()}"></div>
      <div><label class="f" for="madeNote">Nota (opcional)</label><input id="madeNote" maxlength="140" placeholder="Le faltó sal…" value="${esc(c?.note || '')}"></div></div>
    <button class="btn" id="madeSave" onclick="madeSave()">${c ? 'Guardar cambios' : 'Guardar en «Las que hicimos»'}</button>
    ${c ? `<button class="btn ghost danger" onclick="madeDel('${c.id}')">${icon('trash')} Borrar</button>` : ''}</div>`);
  if (c?.photo) loadPhotos($('madePick'));
}
async function madePhoto(input) {
  const f = input.files?.[0]; input.value = ''; if (!f) return;
  const btn = $('madeSave'); if (btn) { btn.disabled = true; btn.textContent = 'Preparando foto…'; }
  try {
    const full = await compressImage(f, 1080); madePic = { full, thumb: await makeThumb(full).catch(() => null) };
    const box = $('madePick'); box.querySelectorAll('svg,span,img').forEach(x => x.remove());
    const img = document.createElement('img'); img.src = full; img.alt = ''; box.prepend(img);
  } catch (e) { photoError(e); }
  finally { if (btn) { btn.disabled = false; btn.textContent = madeEdit ? 'Guardar cambios' : 'Guardar en «Las que hicimos»'; } }
}
function madeSave() {
  const r = madeEdit ? ref('cooked', madeEdit) : newRef('cooked'), b = writeBatch(db);
  const old = madeEdit && S.data.cooked.find(x => x.id === madeEdit);
  const fields = { date: $('madeDate').value || todayKey(), note: $('madeNote').value.trim() };
  if (madePic) {
    const pid = `cook-${r.id}`;
    b.set(ref('photos', pid), { data: madePic.full }); cachePhoto(pid, madePic.full);
    if (madePic.thumb) { b.set(ref('photos', thumbId(pid)), { data: madePic.thumb }); cachePhoto(thumbId(pid), madePic.thumb); }
    fields.photo = pid;
  }
  if (old) b.update(r, fields);
  else {
    const rec = madeFor || {};
    b.set(r, { rid: rec.id && rec.id !== 'chef' ? rec.id : null, name: rec.name || 'Receta', emoji: rec.emoji || '🍽️', at: Date.now(), by: uid(), ...fields });
  }
  write(b.commit());
  const first = !old && madeFor && !cookedOf(madeFor.id).length;
  madePic = null; madeFor = null; madeEdit = null; closeSheet();
  toast(old ? 'Cambios guardados' : first ? '¡Primera vez que la hacen! Quedó en «Las que hicimos» 📸' : 'Quedó en «Las que hicimos» 📸');
  if (!old) celebrate('hearts');
}
function madeDel(id) {
  const c = S.data.cooked.find(x => x.id === id);
  softDelete('cooked', id, 'la receta hecha', { photos: c?.photo ? [c.photo, thumbId(c.photo)] : [], after: closeSheet });
}
function openCooked(id) {
  const c = S.data.cooked.find(x => x.id === id); if (!c) return;
  const r = c.rid && recipe(c.rid), times = c.rid ? cookedOf(c.rid).length : 1;
  openSheet(`<div class="stack">
    ${c.photo ? `<img class="made-big" data-photo="${esc(c.photo)}" alt="${esc(c.name)}" onclick="viewPhoto(this)">` : `<div class="center" style="font-size:56px">${esc(c.emoji || '🍽️')}</div>`}
    <h2>${esc(c.name)}</h2>
    <p class="small muted" style="margin:0">${fmtDate(new Date(c.date + 'T12:00'))} · la anotó ${esc(nameOf(c.by))}${times > 1 ? ` · la han hecho ${times} veces` : ''}</p>
    ${c.note ? `<p class="small" style="margin:0">📝 ${esc(c.note)}</p>` : ''}
    <div class="grid2">${r ? `<button class="btn ghost" onclick="openRecipe('${esc(r.id)}')">Ver receta</button>` : ''}<button class="btn ghost" onclick="madeEditOpen('${c.id}')">${icon('edit')} ${c.photo ? 'Editar' : 'Ponerle foto'}</button></div></div>`);
  loadPhotos($('sheetBody'));
}
const madeEditOpen = id => madeSheet(null, id);
const madeNew = id => { const r = recipe(id); if (r) madeSheet(r); };
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
  setTimeout(() => loadPhotos($('sheetBody')), 0);
  openSheet(`<div class="stack">
    ${lucky ? '<span class="label">Hoy toca…</span>' : ''}
    <div class="row start" style="gap:12px"><span style="font-size:44px">${esc(r.emoji || '🍽️')}</span><div><h2>${esc(r.name)}</h2>
      <span class="small muted">${r.min ? `${r.min} min · ` : ''}${plural(r.servings || 2, 'porción', 'porciones')}</span></div></div>
    ${(h => h.length ? `<div class="made-strip">${h.slice(0, 8).map(c => `<button onclick="openCooked('${c.id}')" aria-label="La hicieron el ${esc(c.date)}">${c.photo ? `<img data-thumb="${esc(c.photo)}" alt="">` : `<span>${esc(c.emoji || '🍽️')}</span>`}</button>`).join('')}</div>
      <p class="tiny muted" style="margin:-4px 0 0">La han hecho ${plural(h.length, 'vez', 'veces')} · la última el ${fmtDate(new Date(h[0].date + 'T12:00'))}</p>` : '')(cookedOf(r.id))}
    <div class="grid2"><button class="btn" onclick="cookMode('${esc(r.id)}')">👩‍🍳 Modo cocina</button><button class="btn ghost" onclick="madeNew('${esc(r.id)}')">📸 La hicimos</button></div>
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

/* ---------- Pregúntale al chef (IA en el Worker de avisos: /chef) ----------
   Escriben lo que quieren cocinar y el Worker arma la receta (Workers AI gratis, o Claude si se pone una clave).
   La receta no se guarda hasta que tocan «Guardar»; se puede pedir cambios, mandar al Súper o cocinar en el modo cocina. */
let chefR = null, chefAsk = '';
const CHEF_IDEAS = ['Pasta en salsa blanca con ribeye', 'Algo rápido con pollo y arroz', 'Cena romántica fácil', 'Postre sin horno', 'Desayuno típico para el domingo'];
function chefOpen() {
  openSheet(`<div class="stack"><h2>👩‍🍳 Pregúntale al chef</h2>
    <textarea id="chefAsk" rows="2" maxlength="300" placeholder="Ej: quiero hacer pasta en salsa blanca con ribeye">${esc(chefAsk)}</textarea>
    <div class="chips">${CHEF_IDEAS.map(t => `<button class="chip" onclick="document.getElementById('chefAsk').value=this.textContent">${esc(t)}</button>`).join('')}</div>
    <div class="grid2"><select id="chefServ" aria-label="Porciones">${[1, 2, 3, 4, 6, 8].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${plural(n, 'porción', 'porciones')}</option>`).join('')}</select>
      <label class="check" style="margin:0"><input type="checkbox" id="chefPantry"> Usar lo que tengo</label></div>
    <button class="btn" id="chefGo" onclick="chefRun()">✨ Armar la receta</button>
    <div id="chefOut" class="stack"></div>
    <p class="tiny muted" style="margin:0">La escribe una inteligencia artificial: revisen cantidades y tiempos (sobre todo con carnes). Lo que escriben se manda solo para armar la receta.</p></div>`);
  setTimeout(() => $('chefAsk')?.focus(), 80);
}
async function chefCall(body) {
  if (!PUSH?.url) throw new Error('no-worker');
  const r = await fetch(PUSH.url.replace(/\/$/, '') + '/chef', { method: 'POST', headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error('old-worker');
  if (!r.ok) throw new Error(d.error || 'ai');
  return d.recipe;
}
const CHEF_ERR = { 'old-worker': 'Falta pegar el servicio de avisos nuevo (versión 9) en Cloudflare.', 'no-ai': 'Falta activar la IA en Cloudflare: en el servicio futari-push → Settings → Bindings → Workers AI, con el nombre AI.', limit: 'Se acabó lo gratis de hoy 😅. Mañana el chef vuelve a cocinar.', 'no-worker': 'Falta configurar el servicio de avisos.', ai: 'El chef no pudo con esa. Prueben de nuevo o escríbanlo de otra forma.' };
async function chefRun(change) {
  const out = $('chefOut'); if (!out) return;
  const ask = change ? chefAsk : ($('chefAsk')?.value || '').trim();
  if (!ask) return toast('Escribe qué quieren cocinar');
  chefAsk = ask;
  let pantry = ''; if ($('chefPantry')?.checked) { try { pantry = localStorage.getItem('futari-have') || ''; } catch {} if (!pantry) toast('Escribe primero lo que tienen en «Con lo que tengo»'); }
  out.innerHTML = '<p class="small muted center" style="margin:0">El chef está pensando… 🍳 (puede tardar unos segundos)</p>';
  ['chefGo', 'chefChangeBtn'].forEach(id => { const b = $(id); if (b) b.disabled = true; });
  try {
    chefR = await chefCall(change ? { base: chefR, change } : { ask, servings: Number($('chefServ')?.value) || 2, pantry });
    chefShow();
  } catch (e) { out.innerHTML = `<p class="small center" style="margin:0">😕 ${esc(CHEF_ERR[e.message] || CHEF_ERR.ai)}</p>`; }
  finally { ['chefGo', 'chefChangeBtn'].forEach(id => { const b = $(id); if (b) b.disabled = false; }); }
}
function chefShow() {
  const r = chefR, out = $('chefOut'); if (!r || !out) return;
  out.innerHTML = `<div class="glass stack" style="gap:8px"><div class="row start" style="gap:10px"><span style="font-size:40px">${esc(r.emoji)}</span><div><h2 style="margin:0">${esc(r.name)}</h2>
      <span class="small muted">${r.min} min · ${plural(r.servings, 'porción', 'porciones')}</span></div></div>
    <span class="label">Ingredientes</span><ul class="list">${r.ingredients.map(i => `<li style="padding:6px 0"><span class="txt small">${esc(i)}</span></li>`).join('')}</ul>
    <span class="label">Preparación</span><ol style="margin:0;padding-left:20px;line-height:1.55;font-size:14.5px">${r.steps.map(s => `<li style="margin-bottom:6px">${esc(s)}</li>`).join('')}</ol>
    ${r.tips ? `<p class="small" style="margin:0">💡 ${esc(r.tips)}</p>` : ''}</div>
    <div class="grid2"><button class="btn" onclick="chefSave()">💾 Guardar</button><button class="btn ghost" onclick="chefCook()">👩‍🍳 Cocinar</button></div>
    <button class="btn ghost" onclick="chefGrocery()">${icon('cart')} Ingredientes al Súper</button>
    <div class="add-row"><input id="chefChange" maxlength="200" placeholder="Pedir un cambio: sin crema, para 4, más fácil…" onkeydown="if(event.key==='Enter')chefChangeRun()"><button class="btn" id="chefChangeBtn" aria-label="Pedir cambio" onclick="chefChangeRun()">✏️</button></div>`;
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function chefChangeRun() { const c = ($('chefChange')?.value || '').trim(); if (!c) return toast('Escribe qué cambiar'); if (!chefR) return; chefRun(c); }
function chefSave() {
  if (!chefR) return;
  write(setDoc(newRef('recipes'), { name: chefR.name, emoji: chefR.emoji, min: chefR.min, servings: chefR.servings, ingredients: chefR.ingredients, steps: chefR.steps, tags: [], by: uid(), createdAt: Date.now(), chef: true, ...(chefR.tips ? { note: chefR.tips } : {}) }));
  toast('Receta guardada en sus recetas 💾'); celebrate('hearts');
}
function chefGrocery() { if (!chefR) return; const n = addIngredients(chefR.ingredients); toast(n ? `${plural(n, 'ingrediente agregado', 'ingredientes agregados')} al súper` : 'Ya estaban en el súper'); }
function chefCook() { if (chefR) cookMode({ ...chefR, id: 'chef' }); }

/* ---------- ¿Qué cocino con lo que tengo? ---------- */
function recHave() {
  let saved = ''; try { saved = localStorage.getItem('futari-have') || ''; } catch {}
  openSheet(`<div class="stack"><h2>🧺 Con lo que tengo</h2>
    <p class="small muted" style="margin:0">Escribe lo que hay en la casa, separado por comas, y te digo qué pueden cocinar.</p>
    <textarea id="haveTxt" rows="3" placeholder="Ej: huevos, arroz, pollo, tomate, queso" oninput="recHaveRun()">${esc(saved)}</textarea>
    <div id="haveOut" class="stack" style="gap:2px"></div></div>`);
  recHaveRun();
}
function recHaveRun() {
  const t = $('haveTxt')?.value || ''; try { localStorage.setItem('futari-have', t); } catch {}
  const have = t.split(/[,\n]/).map(x => norm(x).trim()).filter(x => x.length > 1);
  const box = $('haveOut'); if (!box) return;
  if (!have.length) { box.innerHTML = ''; return; }
  const BASIC = /sal|pimienta|aceite|agua|azucar/;
  const scored = allRecipes().map(r => {
    const ing = r.ingredients.filter(i => !BASIC.test(norm(i).split(' ').slice(-1)[0] || '') || norm(i).length > 14);
    const ok = ing.filter(i => have.some(h => norm(i).includes(h)));
    return { r, ok: ok.length, total: ing.length || 1, miss: ing.filter(i => !ok.includes(i)) };
  }).filter(x => x.ok).sort((a, b) => b.ok / b.total - a.ok / a.total || b.ok - a.ok).slice(0, 12);
  box.innerHTML = scored.length ? scored.map(x => `<button class="result-row" onclick="openRecipe('${esc(x.r.id)}')"><span class="e" style="font-size:22px">${esc(x.r.emoji || '🍽️')}</span>
    <span class="grow" style="min-width:0"><b style="display:block">${esc(x.r.name)}</b><span class="tiny muted">Tienes ${x.ok} de ${x.total}${x.miss.length ? ` · falta: ${x.miss.slice(0, 3).map(esc).join(', ')}${x.miss.length > 3 ? '…' : ''}` : ' · ¡tienes todo!'}</span></span></button>`).join('')
    : '<p class="small muted center" style="margin:0">Ninguna receta usa eso todavía. Prueben con otros ingredientes.</p>';
}

/* ---------- Modo cocina ---------- */
// Pantalla completa: un paso grande a la vez, la pantalla no se apaga (Wake Lock) y temporizador si el paso dice minutos
let ck = null;
async function cookMode(id) {
  const r = typeof id === 'object' ? id : recipe(id); if (!r) return;
  closeSheet();
  const el = document.createElement('div'); el.className = 'dialog mt-view ck-view'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Modo cocina');
  document.body.appendChild(el); syncBack();
  ck = { r, i: 0, el, lock: null, timer: null, left: 0 };
  try { ck.lock = await navigator.wakeLock?.request('screen'); } catch {}
  cookPaint();
}
const stepMinutes = s => { const m = /(\d+)\s*(?:a\s*\d+\s*)?(min|minutos?|horas?|hrs?)\b/i.exec(s); return m ? Number(m[1]) * (/h/i.test(m[2]) ? 60 : 1) : 0; };
function cookPaint() {
  if (!ck) return;
  const { r, i } = ck, step = r.steps[i], mins = stepMinutes(step), last = i === r.steps.length - 1;
  const t = ck.left > 0 ? `${Math.floor(ck.left / 60)}:${String(ck.left % 60).padStart(2, '0')}` : '';
  ck.el.innerHTML = `<div class="mt-top"><b>${esc(r.emoji || '🍽️')} ${esc(r.name)}</b><button class="link" onclick="cookClose()">Salir</button></div>
    <div class="mt-body"><details class="ck-ing"><summary class="small">Ingredientes (${r.ingredients.length})</summary><ul>${r.ingredients.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
      <span class="label">Paso ${i + 1} de ${r.steps.length}</span><p class="ck-step">${esc(step)}</p>
      ${t ? `<div class="ck-timer"><b>${t}</b><button class="btn ghost small" onclick="cookTimer(0)">Parar</button></div>` : mins ? `<button class="btn ghost" onclick="cookTimer(${mins})">⏲️ Temporizador de ${mins} min</button>` : ''}
      <div class="ck-custom">${[1, 5, 10, 15, 20].map(n => `<button class="chip" onclick="cookTimer(${n})">⏲️ ${n} min</button>`).join('')}</div></div>
    <div class="mt-dots">${r.steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="grid2 mt-nav"><button class="btn ghost" ${i ? '' : 'disabled'} onclick="cookGo(-1)">Atrás</button><button class="btn" onclick="${last ? 'cookClose(true)' : 'cookGo(1)'}">${last ? '¡Listo! 🎉' : 'Siguiente'}</button></div>`;
}
function cookGo(d) { if (!ck) return; ck.i = Math.max(0, Math.min(ck.r.steps.length - 1, ck.i + d)); cookPaint(); }
function cookTimer(min) {
  if (!ck) return;
  clearInterval(ck.timer); ck.left = min * 60;
  if (min) ck.timer = setInterval(() => {
    if (!ck) return;
    ck.left--;
    if (ck.left <= 0) { clearInterval(ck.timer); ck.left = 0; navigator.vibrate?.([300, 150, 300, 150, 300]); beep(); toast('⏲️ ¡Se acabó el tiempo!'); }
    const b = ck.el.querySelector('.ck-timer b'); if (b && ck.left > 0) b.textContent = `${Math.floor(ck.left / 60)}:${String(ck.left % 60).padStart(2, '0')}`; else cookPaint();
  }, 1000);
  cookPaint();
}
function beep() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.25, a.currentTime); o.start(); [0.3, 0.6].forEach(t => { g.gain.setValueAtTime(0, a.currentTime + t - 0.1); g.gain.setValueAtTime(0.25, a.currentTime + t); }); o.stop(a.currentTime + 0.9); } catch {} }
function cookClose(done) {
  if (!ck) return;
  clearInterval(ck.timer); try { ck.lock?.release(); } catch {}
  const el = ck.el, rec = ck.r; ck = null; el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160);
  if (done === true) {
    setTimeout(() => madeSheet(rec), 900); // para anotarla en «Las que hicimos» con foto
    celebrate();
    const pt = S.data.pet.find(p => p.id === 'main'), k = 'futari-cooked-' + new Date().toDateString();
    let first = true; try { first = !localStorage.getItem(k); localStorage.setItem(k, '1'); } catch {}
    if (pt?.hatchedAt && first) { write(updateDoc(ref('pet', 'main'), { bonus: increment(5) })); toast('¡Buen provecho! 🍽️ +5 🪙 para su mascota'); } else toast('¡Buen provecho! 🍽️');
  }
}
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
function delRecipe(id) { softDelete('recipes', id, 'la receta', { after: closeSheet }); }
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

on('recipes recipefav menu groceries cooked', () => { if ($('recBody')) render(); });
onShow('s-recipes', render);
window.__allRecipes = allRecipes;
expose({ madeNew, madeEditOpen, madePhoto, madeSave, madeDel, openCooked, chefOpen, chefRun, chefChangeRun, chefSave, chefGrocery, chefCook, recHave, recHaveRun, cookMode, cookGo, cookTimer, cookClose, recTab, recSearch, recTag, recFav, recRandom, openRecipe, recipeToGrocery, recipeToMenu, toggleFav, delRecipe, recipeForm, saveRecipe,
  menuWeek, menuSlot, menuFilter, menuSet, menuSetText, menuClear, menuToGrocery, menuFill });
