// Su playlist: canciones que les recuerdan momentos, con portada, adelanto de 30 s, "nuestra canción" y dedicatorias.
// Las portadas y los adelantos vienen de la búsqueda pública de Apple (iTunes Search, sin clave).
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, ask, pick, celebrate, go,
         loadPhotos, cachePhoto, compressImage, photoError, todayKey, parseDate, fmtShort, nameOf, partnerUid, partnerName, uid } from './core.js';
import { backBar } from './lists.js';

let who = 'all', editing = null, results = [], newCover = null, audio = null, playing = null;
const service = url => /spotify/.test(url) ? ['Spotify', '#1DB954'] : /youtu/.test(url) ? ['YouTube', '#FF0033'] : /apple/.test(url) ? ['Apple Music', '#FA2D48'] : /deezer/.test(url) ? ['Deezer', '#A238FF'] : url ? ['Escuchar', 'var(--g1)'] : null;
const safe = u => /^https?:\/\//i.test(u || '') ? u : '';
// Botones para abrir la canción en cada app. Si guardaron un enlace de ese servicio se usa; si no, se abre la búsqueda (abre la app si está instalada).
const services = s => {
  const q = encodeURIComponent(`${s.title} ${s.artist || ''}`.trim()), u = safe(s.url);
  return [
    ['Spotify', '#1DB954', /spotify\./.test(u) ? u : `https://open.spotify.com/search/${q}`],
    ['YouTube Music', '#FF0033', /youtu/.test(u) ? u : `https://music.youtube.com/search?q=${q}`],
    ['Apple Music', '#FA2D48', /apple\.com/.test(u) ? u : safe(s.apple) || `https://music.apple.com/search?term=${q}`],
  ];
};
const country = () => ({ CRC: 'CR', MXN: 'MX', COP: 'CO', USD: 'US', EUR: 'ES' }[S.settings.currency] || 'CR');

// Dedicatoria pendiente para mí (la muestra la tarjeta Hoy)
export const songDedication = () => S.data.songs.find(s => s.dedication?.to === uid() && !s.dedication.seen);

function render() {
  const p = partnerUid();
  const ours = S.data.songs.find(s => s.ours);
  const list = S.data.songs.filter(s => (who === 'all' || s.by === who) && s !== ours).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  paint('s-music', `${backBar('Su playlist', 's-more', `<button class="btn small" onclick="addSong()">${icon('plus')} Canción</button>`)}
    ${ours ? `<div class="label">💞 Nuestra canción</div>${songCard(ours, true)}` : ''}
    <div class="chips"><button class="chip ${who === 'all' ? 'on' : ''}" onclick="songWho('all')">Todas · ${S.data.songs.length}</button>
      <button class="chip ${who === uid() ? 'on' : ''}" onclick="songWho('${uid()}')">Las que agregué</button>
      ${p ? `<button class="chip ${who === p ? 'on' : ''}" onclick="songWho('${p}')">Las de ${esc(partnerName())}</button>` : ''}</div>
    ${S.data.songs.length > 1 ? `<button class="btn ghost" onclick="randomSong()">${icon('dice')} Una canción al azar</button>` : ''}
    ${list.length ? list.map(s => songCard(s)).join('') : !S.data.songs.length ? `<div class="glass center stack"><div style="font-size:44px">🎵</div><h2>La banda sonora de ustedes</h2>
      <p class="muted" style="margin:0">Agreguen las canciones que les recuerdan momentos: su primera cita, un viaje, la que bailaron…</p>
      <button class="btn" onclick="addSong()">Agregar la primera</button></div>` : ''}`);
  loadPhotos($('s-music'));
}
const cover = (s, size = 56) => s.cover
  ? `<img data-photo="${esc(s.cover)}" alt="" style="width:${size}px;height:${size}px;border-radius:12px;object-fit:cover;flex-shrink:0">`
  : s.thumb ? `<img src="${esc(s.thumb)}" alt="" style="width:${size}px;height:${size}px;border-radius:12px;object-fit:cover;flex-shrink:0">`
  : `<span class="e" style="width:${size}px;height:${size}px;border-radius:12px;display:grid;place-items:center;background:var(--soft);font-size:${Math.round(size / 2.2)}px;flex-shrink:0">🎵</span>`;
const songCard = (s, big = false) => {
  const sv = service(s.url), d = s.dedication;
  return `<div class="glass stack ${big ? 'song-ours' : ''}" style="gap:8px"><div class="row start" style="gap:12px">
    ${cover(s, big ? 76 : 56)}
    <div class="grow" style="min-width:0"><b style="display:block">${esc(s.title)}</b><span class="small muted">${esc(s.artist || '')}</span></div>
    ${s.preview ? `<button class="icon-btn play-btn" aria-label="Escuchar adelanto" onclick="playSong('${s.id}')">${playing === s.id ? '❚❚' : '▶'}</button>` : ''}</div>
    ${s.why ? `<p style="margin:0;font-style:italic;line-height:1.45">“${esc(s.why)}”</p>` : ''}
    ${d ? `<div class="dedic">💌 <b>${esc(nameOf(d.by))}</b> se la dedicó a ${d.to === uid() ? 'ti' : esc(nameOf(d.to))}${d.msg ? `: “${esc(d.msg)}”` : ''}</div>` : ''}
    <div class="svc">${services(s).map(([n, col, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener" style="background:${col}">${n}</a>`).join('')}</div>
    <div class="row"><span class="tiny muted">${esc(nameOf(s.by))}${s.date ? ' · ' + fmtShort(parseDate(s.date)) : ''}</span>
      <div class="row" style="gap:4px">${sv && safe(s.url) && !/spotify\.|youtu|apple\.com/.test(s.url) ? `<a class="btn small" style="text-decoration:none;background:${sv[1]};color:#fff" href="${esc(s.url)}" target="_blank" rel="noopener">${sv[0]}</a>` : ''}
      ${partnerUid() ? `<button class="del" aria-label="Dedicar" onclick="dedicateSong('${s.id}')">💌</button>` : ''}
      <button class="del" aria-label="Editar canción" onclick="addSong('${s.id}')">✎</button></div></div></div>`;
};
function songWho(w) { who = w; render(); }
function randomSong() { const s = pick(S.data.songs); openSheet(`<div class="stack"><span class="label">Hoy suena…</span>${songCard(s)}</div>`); loadPhotos($('sheetBody')); }

/* ---------- Adelanto de 30 segundos ---------- */
function playSong(id) {
  const s = S.data.songs.find(x => x.id === id); if (!s?.preview) return;
  if (playing === id) { audio?.pause(); playing = null; return render(); }
  audio?.pause(); audio = new Audio(s.preview); playing = id;
  audio.onended = () => { playing = null; render(); };
  audio.play().catch(() => { playing = null; toast('No se pudo reproducir'); render(); });
  render();
}

/* ---------- Agregar / editar ---------- */
function addSong(id) {
  const s = id ? S.data.songs.find(x => x.id === id) : null;
  editing = s ? s.id : null; newCover = null; results = [];
  openSheet(`<div class="stack"><h2>${s ? 'Editar canción' : 'Agregar canción'}</h2>
    <div class="add-row"><input id="songQ" placeholder="Busca la canción o el artista" aria-label="Buscar canción" value="${esc(s ? `${s.title} ${s.artist || ''}`.trim() : '')}" onkeydown="if(event.key==='Enter')songSearch()">
      <button class="btn" aria-label="Buscar" onclick="songSearch()">${icon('search')}</button></div>
    <div id="songRes" class="stack" style="gap:2px"></div>
    <div class="row start" style="gap:12px"><label class="song-cover" id="songCoverBox" aria-label="Cambiar portada">${s ? cover(s, 72) : cover({}, 72)}
        <input type="file" accept="image/*" hidden onchange="songCoverPick(this)"></label>
      <div class="stack grow" style="gap:8px"><input id="songTitle" placeholder="Nombre de la canción" maxlength="80" aria-label="Canción" value="${esc(s?.title || '')}">
        <input id="songArtist" placeholder="Artista" maxlength="60" aria-label="Artista" value="${esc(s?.artist || '')}"></div></div>
    <p class="tiny muted" style="margin:-4px 0 0">Toca la portada para poner una foto suya.</p>
    <input id="songUrl" type="url" placeholder="Enlace de la canción (opcional): Spotify, YouTube Music…" aria-label="Enlace" value="${esc(s?.url || '')}">
    <textarea id="songWhy" placeholder="¿Por qué es especial? Ej: la bailamos en nuestra primera cita" maxlength="200" style="min-height:70px" aria-label="Por qué es especial">${esc(s?.why || '')}</textarea>
    <div><label class="f" for="songDate">¿De qué fecha es el recuerdo?</label><input type="date" id="songDate" value="${s?.date || todayKey()}"></div>
    <label class="check"><input type="checkbox" id="songOurs" ${s?.ours ? 'checked' : ''}> 💞 Es nuestra canción</label>
    <input type="hidden" id="songThumb" value="${esc(s?.thumb || '')}"><input type="hidden" id="songPreview" value="${esc(s?.preview || '')}"><input type="hidden" id="songApple" value="${esc(s?.apple || '')}">
    <button class="btn" id="songSave" onclick="saveSong()">Guardar</button>
    ${s ? `<button class="btn ghost danger" onclick="delSong('${s.id}')">${icon('trash')} Quitar canción</button>` : ''}</div>`);
  loadPhotos($('sheetBody'));
  if (!s) setTimeout(() => $('songQ')?.focus(), 50);
}
async function songSearch() {
  const q = $('songQ').value.trim(); if (q.length < 2) return;
  const box = $('songRes'); box.innerHTML = '<p class="small muted center" style="margin:0">Buscando…</p>';
  try {
    const r = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=6&country=${country()}`)).json();
    results = r.results || [];
    box.innerHTML = results.length ? results.map((x, i) => `<button class="result-row" onclick="songChoose(${i})"><img src="${esc(x.artworkUrl60)}" alt="" style="width:40px;height:40px;border-radius:8px">
      <span class="grow" style="min-width:0"><b class="small" style="display:block">${esc(x.trackName)}</b><span class="tiny muted">${esc(x.artistName)}</span></span></button>`).join('')
      : '<p class="small muted center" style="margin:0">Sin resultados. Escríbela a mano abajo.</p>';
  } catch { box.innerHTML = '<p class="small muted center" style="margin:0">No se pudo buscar. Escríbela a mano abajo.</p>'; }
}
function songChoose(i) {
  const x = results[i]; if (!x) return;
  $('songTitle').value = (x.trackName || '').slice(0, 80); $('songArtist').value = (x.artistName || '').slice(0, 60);
  const art = (x.artworkUrl100 || '').replace('100x100bb', '600x600bb');
  $('songThumb').value = art; $('songPreview').value = x.previewUrl || '';
  $('songApple').value = x.trackViewUrl || '';
  if (!newCover) $('songCoverBox').querySelector('img,span')?.replaceWith(Object.assign(document.createElement('img'), { src: art, alt: '', style: 'width:72px;height:72px;border-radius:12px;object-fit:cover' }));
  $('songRes').innerHTML = '';
}
async function songCoverPick(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try { newCover = await compressImage(f, 500); } catch (e) { return photoError(e); }
  $('songCoverBox').querySelector('img,span')?.replaceWith(Object.assign(document.createElement('img'), { src: newCover, alt: '', style: 'width:72px;height:72px;border-radius:12px;object-fit:cover' }));
}
function saveSong() {
  const title = $('songTitle').value.trim(); if (!title) return toast('Pon el nombre de la canción');
  const old = editing ? S.data.songs.find(x => x.id === editing) : null;
  const r = old ? ref('songs', old.id) : newRef('songs');
  const data = { title, artist: $('songArtist').value.trim(), url: safe($('songUrl').value.trim()), thumb: safe($('songThumb').value), preview: safe($('songPreview').value), apple: safe($('songApple').value),
    why: $('songWhy').value.trim(), date: $('songDate').value || todayKey(), ours: $('songOurs').checked };
  const batch = writeBatch(db);
  if (newCover) { const pid = `song-${r.id}-${Date.now()}`; batch.set(ref('photos', pid), { data: newCover }); cachePhoto(pid, newCover); data.cover = pid; if (old?.cover) batch.delete(ref('photos', old.cover)); }
  // Solo puede haber una "nuestra canción"
  if (data.ours) for (const s of S.data.songs) if (s.ours && s.id !== r.id) batch.update(ref('songs', s.id), { ours: false });
  if (old) batch.update(r, data); else batch.set(r, { ...data, by: uid(), createdAt: Date.now() });
  write(batch.commit());
  closeSheet(); toast(old ? 'Cambios guardados' : 'Canción agregada'); if (!old) celebrate('hearts');
  editing = null; newCover = null;
}
async function delSong(id) {
  if (!(await ask('¿Quitar esta canción?'))) return;
  const s = S.data.songs.find(x => x.id === id);
  write(deleteDoc(ref('songs', id))); if (s?.cover) write(deleteDoc(ref('photos', s.cover)));
  closeSheet();
}

/* ---------- Dedicar ---------- */
function dedicateSong(id) {
  const s = S.data.songs.find(x => x.id === id); if (!s) return;
  openSheet(`<div class="stack"><h2>💌 Dedicar canción</h2><div class="row start" style="gap:12px">${cover(s)}<div><b>${esc(s.title)}</b><div class="small muted">${esc(s.artist || '')}</div></div></div>
    <textarea id="dedMsg" placeholder="Un mensajito para ${esc(partnerName())} (opcional)" maxlength="160" style="min-height:70px" aria-label="Mensaje"></textarea>
    <button class="btn" onclick="saveDedication('${id}')">Dedicársela a ${esc(partnerName())}</button></div>`);
  loadPhotos($('sheetBody'));
}
function saveDedication(id) {
  write(updateDoc(ref('songs', id), { dedication: { by: uid(), to: partnerUid(), msg: $('dedMsg').value.trim(), at: Date.now(), seen: false } }));
  closeSheet(); toast(`Le llegará en su pantalla de inicio`); celebrate('hearts');
}
// Desde la tarjeta Hoy: abre la playlist y marca la dedicatoria como vista.
function openDedication() {
  const s = songDedication(); go('s-music');
  if (s) { write(updateDoc(ref('songs', s.id), { 'dedication.seen': true })); setTimeout(() => { openSheet(`<div class="stack"><span class="label">💌 ${esc(nameOf(s.dedication.by))} te dedicó</span>${songCard(s)}</div>`); loadPhotos($('sheetBody')); }, 350); celebrate('hearts'); }
}

on('songs', () => { if ($('s-music').classList.contains('active')) render(); });
onShow('s-music', render);
expose({ addSong, songSearch, songChoose, songCoverPick, saveSong, delSong, songWho, randomSong, playSong, dedicateSong, saveDedication, openDedication });
