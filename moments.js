// Momentos: línea de tiempo con fotos.
import { writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef,
         loadPhotos, cachePhoto, compressImage, photoError, makeThumb, thumbId, parseDate, fmtDate, todayKey, nameOf, uid, ask, mainTop, softDelete } from './core.js';
import { dailyHTML, myDailyDone, partnerDailyDone } from './daily.js';
import { sorpresaAlbumHTML } from './sorpresa.js';
import { snapsHTML, unseenSnaps, newChats } from './snaps.js';
import { placeField, initPlace, getPlace, placeFromPhoto } from './location.js';

let tab = 'timeline', mq = '', my = '';
const normT = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function momTab(t) { tab = t; render(); }

function render() {
  const allM = [...S.data.moments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt), years = [...new Set(allM.map(m => m.date.slice(0, 4)))];
  const q = normT(mq), items = allM.filter(m => (!my || m.date.startsWith(my)) && (!q || normT(`${m.title} ${m.note} ${m.place?.name}`).includes(q)));
  const dot = !myDailyDone() && partnerDailyDone() ? '<b class="dot">1</b>' : '';
  const nSnaps = unseenSnaps().length + newChats().length, snapDot = nSnaps ? `<b class="dot">${nSnaps > 9 ? '9+' : nSnaps}</b>` : '';
  let html = `${mainTop('s-moments', 'Momentos', `<div class="row" style="gap:8px"><button class="icon-btn tree-btn" aria-label="Árbol de recuerdos" onclick="go('s-tree')">🌳</button><button class="icon-btn" aria-label="Galería" onclick="go('s-gallery')">${icon('grid')}</button>${tab === 'timeline' ? `<button class="btn small" onclick="openMoment()">${icon('plus')} Agregar</button>` : ''}</div>`)}
    <div class="seg"><button class="${tab === 'timeline' ? 'on' : ''}" onclick="momTab('timeline')">Línea de tiempo</button><button class="${tab === 'daily' ? 'on' : ''}" onclick="momTab('daily')">Foto del día${dot}</button><button class="${tab === 'snaps' ? 'on' : ''}" onclick="momTab('snaps')">Historias${snapDot}</button></div>`;
  if (tab === 'daily') { paint('s-moments', html + dailyHTML() + sorpresaAlbumHTML()); loadPhotos($('s-moments')); return; }
  if (tab === 'snaps') { paint('s-moments', html + snapsHTML()); loadPhotos($('s-moments')); return; }
  if (allM.length > 3) html += `<input id="momQ" type="search" placeholder="Buscar: playa, cumpleaños, un lugar…" aria-label="Buscar momentos" value="${esc(mq)}" oninput="momSearch(this.value)">
    ${years.length > 1 ? `<div class="chips scroll"><button class="chip ${!my ? 'on' : ''}" onclick="momYear('')">Todos</button>${years.map(y => `<button class="chip ${my === y ? 'on' : ''}" onclick="momYear('${y}')">${y} · ${allM.filter(m => m.date.startsWith(y)).length}</button>`).join('')}</div>` : ''}`;
  if (allM.length && !items.length) html += '<p class="empty">Ningún momento con esa búsqueda</p>';
  if (!allM.length) {
    html += `<div class="glass center stack"><div style="font-size:46px">📸</div><h2>Su historia empieza aquí</h2>
      <p class="muted" style="margin:0">Guarden momentos importantes con foto: la primera cita, viajes, logros…</p>
      <button class="btn" onclick="openMoment()">Agregar el primero</button></div>`;
  }
  let year = null;
  for (const m of items) {
    const y = m.date.slice(0, 4);
    if (y !== year) { html += `<div class="year grad-text">${y}</div>`; year = y; }
    html += `<div class="glass moment">${m.hasPhoto ? `<img data-thumb="${m.id}" alt="${esc(m.title)}" onclick="viewPhoto(this)">` : ''}
      <div class="body"><div class="title">${esc(m.title)}</div>${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
      ${m.place ? `<button class="link place-link" onclick="showOnMap(${m.place.lat},${m.place.lng})">📍 ${esc(m.place.name)}</button>` : ''}
      <div class="row" style="margin-top:8px"><span class="tiny muted">${fmtDate(parseDate(m.date))} · ${esc(nameOf(m.by))}</span>
      <span class="row" style="gap:2px"><button class="del" aria-label="Editar momento" onclick="openMoment('${m.id}')">${icon('edit')}</button>
      <button class="del" aria-label="Borrar momento" onclick="delMoment('${m.id}')">${icon('trash')}</button></span></div></div></div>`;
  }
  paint('s-moments', html);
  loadPhotos($('s-moments'));
}

let momTimer = null;
function momSearch(v) { mq = v; clearTimeout(momTimer); momTimer = setTimeout(() => { render(); const i = $('momQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }
function momYear(y) { my = y; render(); }

let pendingPhoto = null, editing = null;
// Sin id: momento nuevo. Con id: editar título, fecha, lugar, nota y cambiar (o poner) la foto.
function openMoment(id) {
  pendingPhoto = null;
  const m = id && S.data.moments.find(x => x.id === id); editing = m ? id : null;
  openSheet(`<div class="stack"><h2>${m ? 'Editar momento' : 'Nuevo momento'}</h2>
    <label class="photo-pick" id="photoPick">${m?.hasPhoto ? `<img data-thumb="${m.id}" alt="">` : `${icon('photo', 'ic lg')}<span>Agregar foto (opcional)</span>`}
      <input type="file" accept="image/*" id="momentPhoto" hidden onchange="pickPhoto(this)"></label>
    ${m?.hasPhoto ? '<p class="tiny muted" style="margin:-6px 0 0;text-align:center">Toca la foto para cambiarla</p>' : ''}
    <div><label class="f" for="momentTitle">¿Qué pasó?</label><input id="momentTitle" data-fresh maxlength="80" placeholder="Ej: Nuestro primer viaje juntos" value="${esc(m?.title || '')}"></div>
    <div><label class="f" for="momentDate">Fecha</label><input type="date" id="momentDate" data-fresh value="${m?.date || todayKey()}"></div>
    ${placeField('momPlace')}
    <div><label class="f" for="momentNote">Nota (opcional)</label><textarea id="momentNote" data-fresh maxlength="600" placeholder="Lo que no quieren olvidar…">${esc(m?.note || '')}</textarea></div>
    <button class="btn" id="momentSave" onclick="saveMoment()">${m ? 'Guardar cambios' : 'Guardar momento'}</button></div>`);
  initPlace('momPlace', m?.place || null);
  if (m?.hasPhoto) loadPhotos($('photoPick'));
}
async function pickPhoto(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  const btn = $('momentSave'); btn.disabled = true; btn.textContent = 'Preparando foto…';
  placeFromPhoto('momPlace', f);
  try {
    pendingPhoto = await compressImage(f);
    const box = $('photoPick');
    box.querySelectorAll('svg,span').forEach(s => s.remove());
    box.querySelector('img')?.remove();
    const img = document.createElement('img'); img.src = pendingPhoto; img.alt = ''; box.prepend(img);
  } catch (e) { photoError(e); }
  finally { btn.disabled = false; btn.textContent = editing ? 'Guardar cambios' : 'Guardar momento'; }
}
async function saveMoment() {
  const title = $('momentTitle').value.trim(), date = $('momentDate').value;
  if (!title || !date) return toast('Pon qué pasó y la fecha');
  $('momentSave').disabled = true;
  const r = editing ? ref('moments', editing) : newRef('moments'), batch = writeBatch(db);
  const old = editing && S.data.moments.find(x => x.id === editing);
  if (pendingPhoto) {
    const thumb = await makeThumb(pendingPhoto).catch(() => null);
    batch.set(ref('photos', r.id), { data: pendingPhoto }); cachePhoto(r.id, pendingPhoto);
    if (thumb) { batch.set(ref('photos', thumbId(r.id)), { data: thumb }); cachePhoto(thumbId(r.id), thumb); }
    else if (old?.hasPhoto) batch.delete(ref('photos', thumbId(r.id))); // se vuelve a crear de la foto nueva al verla
  }
  const fields = { title, date, note: $('momentNote').value.trim(), hasPhoto: !!pendingPhoto || !!old?.hasPhoto, place: getPlace('momPlace') };
  if (old) batch.update(r, { ...fields, editedAt: Date.now() });
  else batch.set(r, { ...fields, by: uid(), createdAt: Date.now() });
  write(batch.commit());
  pendingPhoto = null; closeSheet(); toast(old ? 'Cambios guardados' : 'Momento guardado'); editing = null;
}
function delMoment(id) {
  // Las fotos se borran solo si no tocan «Deshacer»
  softDelete('moments', id, 'el momento', { photos: [id, thumbId(id)] });
}

/* ---------- Galería ---------- */
function renderGallery() {
  const items = S.data.moments.filter(m => m.hasPhoto).sort((a, b) => b.date.localeCompare(a.date));
  let html = `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-moments')">${icon('back')}</button><h1>Galería</h1></div>
    ${items.length ? `<button class="btn small ghost" onclick="downloadPhotos()" aria-label="Bajar fotos al teléfono">⬇️ Bajar fotos</button>` : ''}</div>
    ${items.length ? `<p class="tiny muted" style="margin:-6px 0 0">${items.length} fotos</p>` : ''}`;
  if (!items.length) html += '<div class="glass center muted">Cuando agreguen momentos con foto, aparecen aquí.</div>';
  let year = null, grid = '';
  for (const m of items) {
    const y = m.date.slice(0, 4);
    if (y !== year) { if (grid) html += `<div class="gallery">${grid}</div>`; grid = ''; html += `<div class="year grad-text">${y}</div>`; year = y; }
    grid += `<button class="gal" aria-label="${esc(m.title)}" onclick="viewPhoto(this.querySelector('img'))"><img data-thumb="${m.id}" alt="${esc(m.title)}"></button>`;
  }
  if (grid) html += `<div class="gallery">${grid}</div>`;
  paint('s-gallery', html);
  loadPhotos($('s-gallery'));
}

on('moments daily profiles snaps sorpresa', render);
on('moments', () => { if ($('s-gallery').classList.contains('active')) renderGallery(); });
onShow('s-gallery', renderGallery);
expose({ momSearch, momYear, momTab, openMoment, pickPhoto, saveMoment, delMoment });
