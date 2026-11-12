// Momentos: línea de tiempo con fotos.
import { writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef,
         loadPhotos, cachePhoto, compressImage, parseDate, fmtDate, todayKey, nameOf, uid, ask } from './core.js';

function render() {
  const items = [...S.data.moments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  let html = `<div class="topbar"><h1>Momentos</h1><div class="row" style="gap:8px"><button class="icon-btn" aria-label="Galería" onclick="go('s-gallery')">${icon('grid')}</button><button class="btn small" onclick="openMoment()">${icon('plus')} Agregar</button></div></div>`;
  if (!items.length) {
    html += `<div class="glass center stack"><div style="font-size:46px">📸</div><h2>Su historia empieza aquí</h2>
      <p class="muted" style="margin:0">Guarden momentos importantes con foto: la primera cita, viajes, logros…</p>
      <button class="btn" onclick="openMoment()">Agregar el primero</button></div>`;
  }
  let year = null;
  for (const m of items) {
    const y = m.date.slice(0, 4);
    if (y !== year) { html += `<div class="year grad-text">${y}</div>`; year = y; }
    html += `<div class="glass moment">${m.hasPhoto ? `<img data-photo="${m.id}" alt="${esc(m.title)}" onclick="viewPhoto(this)">` : ''}
      <div class="body"><div class="title">${esc(m.title)}</div>${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
      <div class="row" style="margin-top:8px"><span class="tiny muted">${fmtDate(parseDate(m.date))} · ${esc(nameOf(m.by))}</span>
      <button class="del" aria-label="Borrar momento" onclick="delMoment('${m.id}')">${icon('trash')}</button></div></div></div>`;
  }
  paint('s-moments', html);
  loadPhotos($('s-moments'));
}

let pendingPhoto = null;
function openMoment() {
  pendingPhoto = null;
  openSheet(`<div class="stack"><h2>Nuevo momento</h2>
    <label class="photo-pick" id="photoPick">${icon('photo', 'ic lg')}<span>Agregar foto (opcional)</span>
      <input type="file" accept="image/*" id="momentPhoto" hidden onchange="pickPhoto(this)"></label>
    <div><label class="f" for="momentTitle">¿Qué pasó?</label><input id="momentTitle" data-fresh maxlength="80" placeholder="Ej: Nuestro primer viaje juntos"></div>
    <div><label class="f" for="momentDate">Fecha</label><input type="date" id="momentDate" data-fresh value="${todayKey()}"></div>
    <div><label class="f" for="momentNote">Nota (opcional)</label><textarea id="momentNote" data-fresh maxlength="600" placeholder="Lo que no quieren olvidar…"></textarea></div>
    <button class="btn" id="momentSave" onclick="saveMoment()">Guardar momento</button></div>`);
}
async function pickPhoto(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  const btn = $('momentSave'); btn.disabled = true; btn.textContent = 'Preparando foto…';
  try {
    pendingPhoto = await compressImage(f);
    const box = $('photoPick');
    box.querySelectorAll('svg,span').forEach(s => s.remove());
    box.querySelector('img')?.remove();
    const img = document.createElement('img'); img.src = pendingPhoto; img.alt = ''; box.prepend(img);
  } catch { toast('No se pudo leer esa foto'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar momento'; }
}
function saveMoment() {
  const title = $('momentTitle').value.trim(), date = $('momentDate').value;
  if (!title || !date) return toast('Pon qué pasó y la fecha');
  const r = newRef('moments'), batch = writeBatch(db);
  if (pendingPhoto) { batch.set(ref('photos', r.id), { data: pendingPhoto }); cachePhoto(r.id, pendingPhoto); }
  batch.set(r, { title, date, note: $('momentNote').value.trim(), hasPhoto: !!pendingPhoto, by: uid(), createdAt: Date.now() });
  write(batch.commit());
  pendingPhoto = null; closeSheet(); toast('Momento guardado');
}
async function delMoment(id) {
  if (!await ask('¿Borrar este momento para los dos?')) return;
  const batch = writeBatch(db);
  batch.delete(ref('moments', id)); batch.delete(ref('photos', id));
  write(batch.commit());
}

/* ---------- Galería ---------- */
function renderGallery() {
  const items = S.data.moments.filter(m => m.hasPhoto).sort((a, b) => b.date.localeCompare(a.date));
  let html = `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="go('s-moments')">${icon('back')}</button><h1>Galería</h1></div>
    <span class="small muted">${items.length} fotos</span></div>`;
  if (!items.length) html += '<div class="glass center muted">Cuando agreguen momentos con foto, aparecen aquí.</div>';
  let year = null, grid = '';
  for (const m of items) {
    const y = m.date.slice(0, 4);
    if (y !== year) { if (grid) html += `<div class="gallery">${grid}</div>`; grid = ''; html += `<div class="year grad-text">${y}</div>`; year = y; }
    grid += `<button class="gal" aria-label="${esc(m.title)}" onclick="viewPhoto(this.querySelector('img'))"><img data-photo="${m.id}" alt="${esc(m.title)}" loading="lazy"></button>`;
  }
  if (grid) html += `<div class="gallery">${grid}</div>`;
  paint('s-gallery', html);
  loadPhotos($('s-gallery'));
}

on('moments', render);
on('moments', () => { if ($('s-gallery').classList.contains('active')) renderGallery(); });
onShow('s-gallery', renderGallery);
expose({ openMoment, pickPhoto, saveMoment, delMoment });
