// Regalitos del adviento (desde 1.17.0): cada uno le da a su pareja un regalito físico por día del 1 al 24 de diciembre.
// Pestaña «🎁 Regalitos» de la pantalla de adviento (advent.js).
// - Mi lista (qué es, precio, tienda, estado) es PRIVADA: private/<uid>/regalitos/r-<año>-<dd>
//     = { year, day, text, emoji, price, store, status: idea|comprado|envuelto, at }  → la pareja no la puede leer.
// - Lo que ve la pareja va en la colección compartida "advent": g-<año>-<uid de quien regala>-<dd>
//     = { year, day, by, to, hint, at, react?, thanks?, reactAt?, reactSeen?, fav?, moment? }
//   (la app solo muestra la pista al abrir la casilla ese día; el 🎀 en la casilla dice que hay regalito).
// - Rango de precio de los dos: couples/nosotros.adv.range = { min, max } (por defecto ₡1.000 – ₡2.000).
// Ver docs/ADVIENTO.md.
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, expose, toast, openSheet, closeSheet, write, ref, newRef, privRef, coupleRef, uid, partnerUid, partnerName,
         nameOf, celebrate, cachePhoto, compressImage, makeThumb, photoError, thumbId, loadPhotos, plural, ask } from './core.js';
import { YEAR, now, inDec, pad, wdShort, dayLong, openedAt, canOpen, DAYS, adventSeason } from './advent.js';
import { notify, meForPartner } from './push.js';

/* ---------- Datos ---------- */
const crc = n => '₡' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const range = () => { const r = S.settings.adv?.range || {}; return { min: Number(r.min ?? 1000), max: Number(r.max ?? 2000) }; };
const myId = d => `r-${YEAR()}-${pad(d)}`;
const mine = d => (S.priv.regalitos || []).find(x => x.id === myId(d)) || null;
const myList = () => DAYS.map(d => ({ d, g: mine(d) }));
const gId = (by, d) => `g-${YEAR()}-${by}-${pad(d)}`;
const gDoc = (by, d) => by ? (S.data.advent || []).find(x => x.id === gId(by, d)) || null : null;
// El regalito que me da mi pareja el día d (solo lo que se comparte: pista y reacción)
export const regalitoFrom = d => gDoc(partnerUid(), d);
const ST = [['idea', '💡', 'Idea'], ['comprado', '🛒', 'Comprado'], ['envuelto', '🎀', 'Envuelto']];
const stOf = (d, g) => openedAt(partnerUid(), d) ? 'abierto' : g?.status || 'idea';
const ST_LABEL = { idea: '💡 Idea', comprado: '🛒 Comprado', envuelto: '🎀 Envuelto', abierto: '✅ Lo abrió' };
const outOfRange = p => { const { min, max } = range(); return p && (p < min || p > max); };

// Ideas que suelen caber en ₡1.000 – ₡2.000: [emoji, idea, precio aproximado]
export const IDEAS = [
  ['🍫', 'Su chocolate favorito', 1200], ['🧦', 'Medias navideñas', 1800], ['🕯️', 'Una vela aromática pequeña', 2000], ['🌵', 'Una suculenta en maceta', 1800],
  ['☕', 'Un café para llevar de su lugar favorito', 1800], ['🍪', 'Galletas navideñas', 1500], ['🍭', 'Una bolsita de confites', 1000], ['🧴', 'Una crema de manos pequeña', 1900],
  ['💋', 'Un bálsamo de labios', 1500], ['✨', 'Una hoja de stickers bonitos', 1000], ['🔑', 'Un llavero', 1500], ['📝', 'Una libreta pequeña', 1500],
  ['🖊️', 'Un lapicero bonito', 1200], ['🧖', 'Una mascarilla facial', 1200], ['🍿', 'Palomitas para ver una peli juntos', 1200], ['🥤', 'Su bebida favorita', 1000],
  ['🍦', 'Un vale por un helado hoy', 1500], ['🍬', 'Gomitas', 1000], ['🥜', 'Maní garapiñado', 1000], ['🍞', 'Un pan dulce pequeño', 1800],
  ['🧁', 'Un cupcake', 1800], ['🎀', 'Un accesorio para el pelo', 1500], ['🖼️', 'Una foto de los dos impresa', 1000], ['💌', 'Una carta a mano con un dulce', 1000],
  ['🃏', 'Un juego de cartas', 2000], ['🌱', 'Semillas para sembrar juntos', 1000], ['🌹', 'Una flor', 1500], ['🫖', 'Un té especial', 1500],
  ['🛁', 'Sales de baño', 1500], ['🧼', 'Un jabón artesanal', 1500], ['🎄', 'Un adorno navideño', 1500], ['🦌', 'Una diadema de reno', 1800],
  ['🎅', 'Un gorro navideño', 2000], ['☕', 'Chocolate caliente en sobres', 1200], ['🥨', 'Snacks salados', 1000], ['🍓', 'Fresas con chocolate', 2000],
  ['🧲', 'Un imán para la refri', 1200], ['🧸', 'Un peluche pequeñito', 2000], ['💅', 'Un esmalte de uñas', 1800], ['🌶️', 'Una salsa picante para probar', 1500],
  ['🥥', 'Una pipa fría', 1000], ['🍍', 'Su fruta favorita', 1000], ['🎟️', 'Un vale hecho por ti con un dulce', 1000], ['🍯', 'Miel en frasco pequeño', 2000],
  ['🧃', 'Un jugo natural', 1200], ['🪥', 'Un cepillo de dientes navideño', 1200], ['🎧', 'Un estuche para audífonos', 2000], ['🧤', 'Calcetines graciosos', 1500],
  ['📌', 'Pinzas para colgar fotos', 1200], ['🍰', 'Un pedazo de queque navideño', 1800], ['🧩', 'Un rompecabezas pequeño', 2000], ['🫧', 'Burbujas para jugar', 1000],
];
const fitIdeas = () => { const { min, max } = range(); const f = IDEAS.filter(i => i[2] >= min && i[2] <= max); return f.length ? f : IDEAS; };
const usedTexts = () => new Set((S.priv.regalitos || []).filter(x => x.year === YEAR()).map(x => x.text));

/* ---------- Pestaña «🎁 Regalitos» ---------- */
let part = 'list';
function rgPart(p) { part = p; window.advView?.('gifts'); }
export function giftsHTML() {
  const pn = esc(partnerName()), L = myList(), withGift = L.filter(x => x.g?.text);
  const bought = withGift.filter(x => ['comprado', 'envuelto'].includes(x.g.status) || openedAt(partnerUid(), x.d)).length;
  const wrapped = withGift.filter(x => x.g.status === 'envuelto' || openedAt(partnerUid(), x.d)).length;
  const spent = withGift.reduce((s, x) => s + (Number(x.g.price) || 0), 0), priced = withGift.filter(x => Number(x.g.price) > 0).length;
  const { min, max } = range(), end = inDec() && now().getDate() >= 24;
  const parts = [['list', '📋 Los 24'], ['shop', '🛒 Por comprar'], ...(inDec() ? [['got', end ? '🎄 Resumen' : '🎁 Recibidos']] : [])];
  if (!parts.some(p => p[0] === part)) part = 'list';
  return `<div class="glass stack"><span class="label">🎁 Tus regalitos para ${pn}</span>
      <span class="small"><b>${withGift.length}</b> de 24 con regalito · ${plural(bought, 'comprado', 'comprados')} · ${plural(wrapped, 'envuelto', 'envueltos')}</span>
      <div class="progress"><i style="width:${Math.round(bought / 24 * 100)}%"></i></div>
      <span class="small">Gastado <b>${crc(spent)}</b>${priced ? ` · promedio ${crc(spent / priced)}` : ''}</span>
      <div class="row"><span class="small muted">Rango por regalito: ${crc(min)} – ${crc(max)}</span><button class="link" onclick="rgRange()">Cambiar</button></div>
      <p class="tiny muted" style="margin:0">🔒 Esta lista solo la ves tú. ${pn} solo ve la pista el día que abre la casilla.</p></div>
    <div class="chips">${parts.map(([k, l]) => `<button class="chip ${part === k ? 'on' : ''}" onclick="rgPart('${k}')">${l}</button>`).join('')}</div>
    ${part === 'shop' ? shopHTML() : part === 'got' ? gotHTML(end) : listHTML()}`;
}
function dayChip(d) { return `<span class="rg-day"><b>${d}</b><small>${wdShort(d)}</small></span>`; }
function listHTML() {
  return `<div class="glass">${myList().map(({ d, g }) => {
    const st = stOf(d, g), p = Number(g?.price) || 0;
    return `<button class="result-row" onclick="rgEdit(${d})">${dayChip(d)}
      <span class="grow">${g?.text ? `<b>${esc(g.emoji || '🎁')} ${esc(g.text)}</b>` : '<span class="muted">Sin regalito · toca para elegir</span>'}
        ${g?.text ? `<span class="tiny muted" style="display:block">${p ? `<span class="${outOfRange(p) ? 'vac-neg' : ''}">${crc(p)}</span>` : 'Sin precio'}${g.store ? ' · ' + esc(g.store) : ''}${g.hint ? ' · 📍 con pista' : ''}</span>` : ''}</span>
      ${g?.text ? `<span class="rg-st ${st}">${ST_LABEL[st]}</span>` : ''}</button>`;
  }).join('')}</div>`;
}
// Lista de compras: lo que falta comprar, por tienda
function shopHTML() {
  const todo = myList().filter(x => x.g?.text && (x.g.status || 'idea') === 'idea' && !openedAt(partnerUid(), x.d));
  if (!todo.length) return `<p class="empty">${myList().some(x => x.g?.text) ? 'Nada por comprar 🎉' : 'Primero elige los regalitos en «Los 24».'}</p>`;
  const by = {}; for (const x of todo) (by[x.g.store?.trim() || 'Sin tienda'] ||= []).push(x);
  return Object.entries(by).sort((a, b) => (a[0] === 'Sin tienda') - (b[0] === 'Sin tienda') || b[1].length - a[1].length).map(([store, xs]) => `<div class="glass">
    <div class="row"><span class="label">🏪 ${esc(store)}</span><span class="small muted">${plural(xs.length, 'cosa', 'cosas')} · ${crc(xs.reduce((s, x) => s + (Number(x.g.price) || 0), 0))}</span></div>
    ${xs.map(({ d, g }) => `<div class="result-row" style="cursor:default">${dayChip(d)}<span class="grow">${esc(g.emoji || '🎁')} ${esc(g.text)}${g.price ? `<span class="tiny muted" style="display:block">${crc(g.price)}</span>` : ''}</span>
      <button class="btn small" onclick="rgBought(${d})">🛒 Comprado</button></div>`).join('')}</div>`).join('');
}
// Lo que me regalaron (y, desde el 24, el resumen de los dos)
function gotHTML(end) {
  const p = partnerUid(), pn = esc(partnerName());
  const got = DAYS.filter(d => openedAt(uid(), d) && gDoc(p, d));
  const rows = got.map(d => { const g = gDoc(p, d); return `<div class="result-row" style="cursor:default">${dayChip(d)}
      <span class="grow">${g.hint ? `📍 ${esc(g.hint)}` : '🎁 Regalito'}${g.thanks ? `<span class="tiny muted" style="display:block">«${esc(g.thanks)}»</span>` : ''}</span>
      ${g.moment ? `<img class="rg-thumb" data-photo="${thumbId(g.moment)}" alt="" onclick="viewPhoto(this)">` : ''}${g.react ? `<span style="font-size:22px">${esc(g.react)}</span>` : ''}${g.fav ? '⭐' : ''}</div>`; }).join('');
  let summary = '';
  if (end) {
    const L = myList().filter(x => x.g?.text), spent = L.reduce((s, x) => s + (Number(x.g.price) || 0), 0);
    const theirFav = DAYS.map(d => ({ d, g: gDoc(uid(), d) })).find(x => x.g?.fav), myFav = got.find(d => gDoc(p, d).fav);
    summary = `<div class="glass stack"><span class="label">🎄 Sus 24 regalitos</span>
      <p class="small" style="margin:0">Le diste <b>${L.length}</b> regalitos a ${pn} por <b>${crc(spent)}</b> y recibiste <b>${got.length}</b>.</p>
      ${theirFav ? `<p class="small" style="margin:0">⭐ El favorito de ${pn}: tu regalito del ${dayLong(theirFav.d)}${mine(theirFav.d)?.text ? ` (${esc(mine(theirFav.d).text)})` : ''} ${esc(theirFav.g.react || '')}</p>` : ''}
      ${myFav ? `<p class="small" style="margin:0">⭐ Tu favorito: el del ${dayLong(myFav)}</p>` : `<p class="small muted" style="margin:0">Abre una casilla y toca «⭐ Mi favorito» en su regalito.</p>`}</div>`;
  }
  return summary + `<div class="glass"><span class="label">🎁 Lo que te regaló ${pn}</span>${rows || '<p class="small muted" style="margin:6px 0 0">Todavía no has abierto casillas con regalito.</p>'}</div>`;
}

/* ---------- Editar el regalito de un día ---------- */
let edDay = 0, draft = null;
function rgEdit(d, keep) {
  edDay = d; const g = mine(d), sh = gDoc(uid(), d), opened = openedAt(partnerUid(), d);
  const v = keep && draft ? draft : { text: g?.text || '', emoji: g?.emoji || '🎁', price: g?.price || '', store: g?.store || '', status: g?.status || 'idea', hint: sh?.hint || '' };
  draft = v;
  const stores = [...new Set((S.priv.regalitos || []).map(x => x.store).filter(Boolean))];
  openSheet(`<div class="stack"><h2>🎁 Regalito del ${d}</h2>
    <p class="small muted" style="margin:-6px 0 0">${esc(dayLong(d))}${opened ? ` · ✅ ${esc(partnerName())} ya abrió esa casilla` : ''}</p>
    <div class="add-row"><input id="rgEmoji" style="flex:0 0 60px;text-align:center" maxlength="4" value="${esc(v.emoji)}" aria-label="Emoji"><input id="rgText" maxlength="60" placeholder="¿Qué le vas a regalar?" value="${esc(v.text)}" aria-label="Regalito"></div>
    <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="rgIdeas()">💡 Ideas</button><button class="btn ghost small" style="width:100%" onclick="rgSurprise()">🎲 Sorpréndeme</button></div>
    <div class="grid2"><div><label class="f" for="rgPrice">Precio (₡)</label><input type="number" id="rgPrice" inputmode="numeric" min="0" step="50" value="${esc(String(v.price))}" oninput="rgWarn()"></div>
      <div><label class="f" for="rgStore">¿Dónde?</label><input id="rgStore" list="rgStores" maxlength="40" placeholder="Tienda" value="${esc(v.store)}"><datalist id="rgStores">${stores.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <p class="small" id="rgWarnTxt" style="margin:-4px 0 0"></p>
    <div><span class="f">Estado</span><div class="seg" id="rgSt">${ST.map(([k, e, l]) => `<button data-s="${k}" class="${v.status === k ? 'on' : ''}" onclick="rgSt('${k}')">${e} ${l}</button>`).join('')}</div></div>
    <div><label class="f" for="rgHint">📍 Pista de dónde lo vas a esconder (opcional)</label><input id="rgHint" maxlength="100" placeholder="Ej: Búscalo debajo de tu almohada" value="${esc(v.hint)}">
      <p class="tiny muted" style="margin:4px 0 0">${esc(partnerName())} solo ve la pista cuando abre la casilla ese día. Lo demás es solo tuyo.</p></div>
    <button class="btn" onclick="rgSave()">Guardar</button>
    ${g ? `<button class="btn ghost danger" onclick="rgClear(${d})">Vaciar este día</button>` : ''}</div>`);
  rgWarn();
}
const readDraft = () => { if (!$('rgText')) return draft; draft = { text: $('rgText').value.trim(), emoji: $('rgEmoji').value.trim() || '🎁', price: $('rgPrice').value, store: $('rgStore').value.trim(), status: document.querySelector('#rgSt button.on')?.dataset.s || 'idea', hint: $('rgHint').value.trim() }; return draft; };
function rgSt(s) { document.querySelectorAll('#rgSt button').forEach(b => b.classList.toggle('on', b.dataset.s === s)); }
function rgWarn() {
  const p = Number($('rgPrice')?.value) || 0, t = $('rgWarnTxt'); if (!t) return;
  const { min, max } = range();
  t.innerHTML = !p ? '' : p > max ? `<span class="vac-neg">Se pasa del rango (máximo ${crc(max)})</span>` : p < min ? `<span class="muted">Está debajo del rango (mínimo ${crc(min)})</span>` : '<span class="muted">✓ Dentro del rango</span>';
}
function rgIdeas() {
  readDraft();
  const used = usedTexts(), { min, max } = range();
  openSheet(`<div class="stack"><h2>💡 Ideas para el ${edDay}</h2><p class="small muted" style="margin:0">Cuestan más o menos entre ${crc(min)} y ${crc(max)}. Toca una para usarla.</p>
    <div class="alert-list">${fitIdeas().map(([e, t, p], i) => `<button class="result-row" onclick="rgPick(${IDEAS.findIndex(x => x[1] === t)})" ${used.has(t) ? 'style="opacity:.45"' : ''}><span class="e">${e}</span><span class="grow">${esc(t)}<span class="tiny muted" style="display:block">≈ ${crc(p)}${used.has(t) ? ' · ya la usaste' : ''}</span></span></button>`).join('')}</div>
    <button class="btn ghost" onclick="rgEdit(${edDay}, true)">Volver</button></div>`);
}
function rgPick(i) { const [e, t, p] = IDEAS[i]; draft = { ...draft, emoji: e, text: t, price: draft.price || p }; rgEdit(edDay, true); }
function rgSurprise() {
  readDraft();
  const used = usedTexts(), pool = fitIdeas().filter(i => !used.has(i[1]) && i[1] !== draft.text);
  const [e, t, p] = (pool.length ? pool : fitIdeas())[Math.floor(Math.random() * (pool.length || fitIdeas().length))];
  draft = { ...draft, emoji: e, text: t, price: p }; rgEdit(edDay, true);
}
function rgSave() {
  const v = readDraft(), d = edDay, p = partnerUid();
  if (!v.text) return toast('Escribe qué le vas a regalar');
  const price = Math.max(0, Math.round(Number(v.price) || 0));
  write(setDoc(privRef('regalitos', myId(d)), { year: YEAR(), day: d, text: v.text, emoji: v.emoji, price, store: v.store, status: v.status, at: Date.now() }, { merge: true }));
  // Lo compartido: que hay regalito y la pista
  if (p) write(setDoc(ref('advent', gId(uid(), d)), { year: YEAR(), day: d, by: uid(), to: p, hint: v.hint, at: Date.now() }, { merge: true }));
  closeSheet(); draft = null;
  toast(outOfRange(price) ? `Guardado (ojo: ${crc(price)} está fuera del rango)` : 'Guardado 🎁');
}
async function rgClear(d) {
  if (!(await ask(`¿Vaciar el regalito del ${d}?`, { ok: 'Vaciar', danger: true }))) return;
  write(deleteDoc(privRef('regalitos', myId(d))));
  const sh = gDoc(uid(), d); if (sh && !sh.react && !sh.moment) write(deleteDoc(ref('advent', sh.id)));
  closeSheet(); draft = null; toast('Día vacío');
}
function rgBought(d) { write(setDoc(privRef('regalitos', myId(d)), { status: 'comprado' }, { merge: true })); toast(`Regalito del ${d}: comprado 🛒`); }
function rgRange() {
  const { min, max } = range();
  openSheet(`<div class="stack"><h2>💰 Rango de precio</h2><p class="small muted" style="margin:0">Lo que acordaron gastar en cada regalito. Vale para los dos.</p>
    <div class="grid2"><div><label class="f" for="rgMin">Desde (₡)</label><input type="number" id="rgMin" inputmode="numeric" min="0" step="100" value="${min}"></div>
      <div><label class="f" for="rgMax">Hasta (₡)</label><input type="number" id="rgMax" inputmode="numeric" min="0" step="100" value="${max}"></div></div>
    <button class="btn" onclick="rgRangeSave()">Guardar</button></div>`);
}
function rgRangeSave() {
  const min = Math.round(Number($('rgMin').value) || 0), max = Math.round(Number($('rgMax').value) || 0);
  if (!max || max < min) return toast('El máximo tiene que ser mayor que el mínimo');
  write(setDoc(coupleRef, { adv: { range: { min, max } } }, { merge: true }));
  closeSheet(); toast(`Rango: ${crc(min)} – ${crc(max)}`);
  if (partnerUid()) notify('advent', { title: `💰 ${meForPartner()} cambió el rango de los regalitos`, body: `Ahora: ${crc(min)} – ${crc(max)} cada uno`, url: './?open=advent', tag: 'advent-range' });
}

/* ---------- En la casilla abierta: el regalito de mi pareja ---------- */
const REACTS = ['😍', '🥹', '😂', '🤗', '🔥'];
export function regalitoBlock(d) {
  const g = regalitoFrom(d); if (!g || !canOpen(d)) return ''; // (recién abierta, «abierta» todavía no llegó de la base)
  const pn = esc(partnerName());
  return `<div class="glass stack rg-open" style="text-align:left"><b>🎁 Hoy hay regalito de ${pn}</b>
    ${g.hint ? `<p class="adv-text" style="font-size:16px">📍 ${esc(g.hint)}</p>` : `<p class="small muted" style="margin:0">Búscalo o pídeselo a ${pn} 😉</p>`}
    <div class="rg-reacts">${REACTS.map(e => `<button class="${g.react === e ? 'on' : ''}" onclick="rgReact(${d},'${e}')" aria-label="Reaccionar ${e}">${e}</button>`).join('')}</div>
    <div class="add-row"><input id="rgThanks" maxlength="120" placeholder="Dale las gracias…" value="${esc(g.thanks || '')}" aria-label="Gracias"><button class="btn small" onclick="rgThanks(${d})">Enviar</button></div>
    <div class="grid2">${g.moment ? `<img class="rg-thumb big" data-photo="${thumbId(g.moment)}" alt="Foto del regalito" onclick="viewPhoto(this)">`
      : `<label class="btn ghost small" style="width:100%;text-align:center">📸 Foto del regalito<input type="file" accept="image/*" hidden onchange="rgPhoto(${d}, this)"></label>`}
      <button class="btn ghost small ${g.fav ? 'on' : ''}" style="width:100%" onclick="rgFav(${d})">${g.fav ? '⭐ Tu favorito' : '☆ Mi favorito'}</button></div></div>`;
}
const refreshOpen = d => setTimeout(() => { if ($('sheet')?.classList.contains('show')) window.adventShow?.(d); }, 250);
function rgReact(d, e) {
  const g = regalitoFrom(d); if (!g) return;
  write(updateDoc(ref('advent', g.id), { react: e, reactAt: Date.now(), reactSeen: false }));
  if (!g.react) celebrate('hearts');
  notify('advent', { title: `${e} ${meForPartner()} reaccionó a tu regalito ${d}`, body: g.thanks || 'Del calendario de adviento 🎄', url: './?open=advent', tag: `advent-react-${d}` });
  refreshOpen(d);
}
function rgThanks(d) {
  const g = regalitoFrom(d), t = $('rgThanks')?.value.trim(); if (!g || !t) return toast('Escribe algo');
  write(updateDoc(ref('advent', g.id), { thanks: t, reactAt: Date.now(), reactSeen: false }));
  notify('advent', { title: `💌 ${meForPartner()} te agradeció el regalito ${d}`, body: t, url: './?open=advent', tag: `advent-thanks-${d}` });
  toast('Enviado 💖'); refreshOpen(d);
}
async function rgPhoto(d, input) {
  const g = regalitoFrom(d), file = input.files?.[0]; if (!g || !file) return;
  try {
    const full = await compressImage(file, 1280), thumb = await makeThumb(full).catch(() => null);
    const r = newRef('moments'), b = writeBatch(db);
    b.set(ref('photos', r.id), { data: full }); cachePhoto(r.id, full);
    if (thumb) { b.set(ref('photos', thumbId(r.id)), { data: thumb }); cachePhoto(thumbId(r.id), thumb); }
    b.set(r, { title: `🎁 Regalito ${d} de ${partnerName()}`, date: `${YEAR()}-12-${pad(d)}`, note: [g.hint && `📍 ${g.hint}`, g.thanks].filter(Boolean).join('\n'), hasPhoto: true, place: null, by: uid(), createdAt: Date.now(), fromAdvent: true });
    b.update(ref('advent', g.id), { moment: r.id, reactSeen: false, reactAt: Date.now() });
    write(b.commit());
    toast('Guardada en Momentos 📸'); refreshOpen(d);
  } catch (e) { photoError(e); }
}
function rgFav(d) {
  const p = partnerUid(), b = writeBatch(db), was = regalitoFrom(d)?.fav;
  for (const x of DAYS) { const g = gDoc(p, x); if (g?.fav && x !== d) b.update(ref('advent', g.id), { fav: false }); }
  const g = regalitoFrom(d); if (!g) return;
  b.update(ref('advent', g.id), { fav: !was, reactSeen: false, reactAt: Date.now() });
  write(b.commit());
  if (!was) { celebrate('hearts'); toast('⭐ Tu favorito'); }
  refreshOpen(d);
}

/* ---------- Avisos (campana), Inicio ---------- */
// Mañana (o el 1 si hoy es 30 de noviembre): qué casilla toca
const tomorrowDay = () => { const t = now(); const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1); return m.getMonth() === 11 && m.getDate() <= 24 ? m.getDate() : 0; };
export function regalitoAlerts() {
  if (!uid() || !partnerUid() || !adventSeason()) return [];
  const out = [], pn = esc(partnerName()), go = () => { window.openAdvent?.('gifts'); };
  const td = inDec() && now().getDate() <= 24 ? now().getDate() : 0, tm = tomorrowDay();
  const notBought = d => d && !openedAt(partnerUid(), d) && (!mine(d)?.text || (mine(d).status || 'idea') === 'idea');
  if (notBought(td)) out.push({ key: 'rg-buy-' + td, e: '🛒', text: `Hoy toca el regalito ${td} para ${pn} y todavía no lo has comprado`, short: 'Regalito de hoy sin comprar', run: () => { go(); setTimeout(() => rgEdit(td), 350); } });
  if (notBought(tm)) out.push({ key: 'rg-buy-' + tm, e: '🛒', text: `Mañana (${wdShort(tm)} ${tm}) toca el regalito para ${pn} y todavía no lo has comprado`, short: 'Regalito de mañana sin comprar', run: () => { go(); setTimeout(() => rgEdit(tm), 350); } });
  if (tm && new Date().getHours() >= 18 && mine(tm)?.status === 'comprado')
    out.push({ key: 'rg-wrap', e: '🎀', text: `Esta noche: envuelve el regalito de mañana, escóndelo y pon la pista`, short: 'Envolver el de mañana', run: () => { go(); setTimeout(() => rgEdit(tm), 350); } });
  for (const d of DAYS) { const g = gDoc(uid(), d); if (g && g.reactAt && g.reactSeen === false)
    out.push({ key: 'rg-react-' + d, e: g.react || '💌', text: `${pn} reaccionó a tu regalito ${d}${g.thanks ? `: «${esc(g.thanks)}»` : ''}`, short: 'Reacción a tu regalito', run: go }); }
  return out;
}
// Al ver la pestaña, las reacciones nuevas a mis regalitos quedan vistas
export function markReactsSeen() {
  const xs = DAYS.map(d => gDoc(uid(), d)).filter(g => g?.reactSeen === false); if (!xs.length) return;
  const b = writeBatch(db); xs.forEach(g => b.update(ref('advent', g.id), { reactSeen: true })); write(b.commit());
}
export function regalitosHomeLine() {
  if (!partnerUid()) return '';
  const L = myList().filter(x => x.g?.text), tm = tomorrowDay(), g = tm && mine(tm);
  const txt = inDec() && tm ? (g?.text ? `Mañana: ${esc(g.emoji || '🎁')} ${esc(g.text)} · ${ST_LABEL[stOf(tm, g)]}` : `Mañana toca el ${tm} y no tiene regalito`)
    : `${L.length} de 24 regalitos listos`;
  return `<div class="row"><span class="small">🎁 ${txt}</span><button class="link" onclick="openAdvent('gifts')">Regalitos</button></div>`;
}

expose({ rgPart, rgEdit, rgSt, rgWarn, rgIdeas, rgPick, rgSurprise, rgSave, rgClear, rgBought, rgRange, rgRangeSave, rgReact, rgThanks, rgPhoto, rgFav });
