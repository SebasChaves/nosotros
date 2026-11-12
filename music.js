// Su playlist: canciones que les recuerdan momentos, con enlace y por qué son especiales.
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, ask, pick, celebrate,
         todayKey, parseDate, fmtShort, nameOf, partnerUid, partnerName, uid } from './core.js';
import { backBar } from './lists.js';

let who = 'all';
const service = url => /spotify/.test(url) ? ['Spotify', '#1DB954'] : /youtu/.test(url) ? ['YouTube', '#FF0033'] : /apple/.test(url) ? ['Apple Music', '#FA2D48'] : /deezer/.test(url) ? ['Deezer', '#A238FF'] : url ? ['Escuchar', 'var(--g1)'] : null;
const safe = u => /^https?:\/\//i.test(u || '') ? u : '';

function render() {
  const p = partnerUid();
  const list = S.data.songs.filter(s => who === 'all' || s.by === who).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  paint('s-music', `${backBar('Su playlist', 's-more', `<button class="btn small" onclick="addSong()">${icon('plus')} Canción</button>`)}
    <div class="chips"><button class="chip ${who === 'all' ? 'on' : ''}" onclick="songWho('all')">Todas · ${S.data.songs.length}</button>
      <button class="chip ${who === uid() ? 'on' : ''}" onclick="songWho('${uid()}')">Las que agregué</button>
      ${p ? `<button class="chip ${who === p ? 'on' : ''}" onclick="songWho('${p}')">Las de ${esc(partnerName())}</button>` : ''}</div>
    ${S.data.songs.length > 1 ? `<button class="btn ghost" onclick="randomSong()">${icon('dice')} Una canción al azar</button>` : ''}
    ${list.length ? list.map(s => songCard(s)).join('') : `<div class="glass center stack"><div style="font-size:44px">🎵</div><h2>La banda sonora de ustedes</h2>
      <p class="muted" style="margin:0">Agreguen las canciones que les recuerdan momentos: su primera cita, un viaje, la que bailaron…</p>
      <button class="btn" onclick="addSong()">Agregar la primera</button></div>`}`);
}
const songCard = s => {
  const sv = service(s.url);
  return `<div class="glass stack" style="gap:8px"><div class="row start" style="gap:12px">
    ${s.thumb ? `<img src="${esc(s.thumb)}" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex-shrink:0">` : '<span class="e" style="width:56px;height:56px;border-radius:12px;display:grid;place-items:center;background:var(--soft);font-size:26px;flex-shrink:0">🎵</span>'}
    <div class="grow" style="min-width:0"><b style="display:block">${esc(s.title)}</b><span class="small muted">${esc(s.artist || '')}</span></div></div>
    ${s.why ? `<p style="margin:0;font-style:italic;line-height:1.45">“${esc(s.why)}”</p>` : ''}
    <div class="row"><span class="tiny muted">${esc(nameOf(s.by))}${s.date ? ' · ' + fmtShort(parseDate(s.date)) : ''}</span>
      <div class="row" style="gap:6px">${sv && safe(s.url) ? `<a class="btn small" style="text-decoration:none;background:${sv[1]};color:#fff" href="${esc(s.url)}" target="_blank" rel="noopener">▶ ${sv[0]}</a>` : ''}
      <button class="del" aria-label="Quitar canción" onclick="delSong('${s.id}')">${icon('trash')}</button></div></div></div>`;
};
function songWho(w) { who = w; render(); }
function randomSong() { const s = pick(S.data.songs); openSheet(`<div class="stack"><span class="label">Hoy suena…</span>${songCard(s)}</div>`); }

function addSong() {
  openSheet(`<div class="stack"><h2>Agregar canción</h2>
    <input id="songUrl" type="url" placeholder="Enlace de Spotify, YouTube o Apple Music (opcional)" aria-label="Enlace" onchange="songLookup(this.value)">
    <input id="songTitle" placeholder="Nombre de la canción" maxlength="80" aria-label="Canción">
    <input id="songArtist" placeholder="Artista" maxlength="60" aria-label="Artista">
    <textarea id="songWhy" placeholder="¿Por qué es especial? Ej: la bailamos en nuestra primera cita" maxlength="200" style="min-height:70px" aria-label="Por qué es especial"></textarea>
    <div><label class="f" for="songDate">¿De qué fecha es el recuerdo?</label><input type="date" id="songDate" value="${todayKey()}"></div>
    <input type="hidden" id="songThumb">
    <button class="btn" onclick="saveSong()">Guardar</button></div>`);
}
// Con el enlace se completan solos el nombre, el artista y la portada (servicio público noembed.com).
async function songLookup(url) {
  if (!safe(url)) return;
  try {
    const d = await (await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)).json();
    if (d.error) return;
    if (!$('songTitle').value) $('songTitle').value = (d.title || '').replace(/\s*\(.*?(video|lyric|letra|audio).*?\)\s*/ig, '').slice(0, 80);
    if (!$('songArtist').value && d.author_name) $('songArtist').value = d.author_name.replace(/ - Topic$|VEVO$/i, '').slice(0, 60);
    if (d.thumbnail_url) $('songThumb').value = d.thumbnail_url;
  } catch {}
}
function saveSong() {
  const title = $('songTitle').value.trim(); if (!title) return toast('Pon el nombre de la canción');
  write(setDoc(newRef('songs'), { title, artist: $('songArtist').value.trim(), url: safe($('songUrl').value.trim()), thumb: safe($('songThumb').value),
    why: $('songWhy').value.trim(), date: $('songDate').value || todayKey(), by: uid(), createdAt: Date.now() }));
  closeSheet(); toast('Canción agregada'); celebrate('hearts');
}
async function delSong(id) { if (await ask('¿Quitar esta canción?')) write(deleteDoc(ref('songs', id))); }

on('songs', () => { if ($('s-music').classList.contains('active')) render(); });
onShow('s-music', render);
expose({ addSong, songLookup, saveSong, delSong, songWho, randomSong });
