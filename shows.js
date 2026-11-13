// Películas y series: por ver, viendo y vistas. Con clave de TMDB busca títulos con póster y dónde verlos.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go,
         nameOf, partnerUid, uid, ask } from './core.js';
import { TMDB_KEY } from './tmdb-config.js';
import { backBar } from './lists.js';
import { createList } from './decide.js';

const HAS_TMDB = !!TMDB_KEY;
const IMG = (path, w = 342) => path ? `https://image.tmdb.org/t/p/w${w}${path}` : '';
const STATUS = [['want', 'Por ver'], ['watching', 'Viendo'], ['seen', 'Vistas']];
const REGION = { CRC: 'CR', MXN: 'MX', COP: 'CO', GTQ: 'GT', PEN: 'PE', ARS: 'AR', CLP: 'CL', EUR: 'ES', USD: 'US' };
const region = () => REGION[S.settings.currency] || 'CR';
let tab = 'want', kind = 'all', openId = null, searchTimer = null;

async function tmdb(path, params = {}) {
  const long = TMDB_KEY.length > 40; // token de lectura (v4) o clave corta (v3)
  const q = new URLSearchParams({ language: 'es-MX', ...params, ...(long ? {} : { api_key: TMDB_KEY }) });
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${q}`, long ? { headers: { Authorization: `Bearer ${TMDB_KEY}` } } : {});
  if (!res.ok) throw new Error('TMDB ' + res.status);
  return res.json();
}

/* ---------- Lista ---------- */
function render() {
  const all = S.data.shows;
  const list = all.filter(s => (s.status || 'want') === tab && (kind === 'all' || s.type === kind))
    .sort((a, b) => tab === 'seen' ? (b.seenAt || 0) - (a.seenAt || 0) : b.createdAt - a.createdAt);
  const count = st => all.filter(s => (s.status || 'want') === st).length;
  paint('s-shows', `${backBar('Pelis y series', 's-more', `<button class="btn small" onclick="openAddShow()">${icon('plus')} Agregar</button>`)}
    <div class="seg">${STATUS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="showsTab('${k}')">${l} · ${count(k)}</button>`).join('')}</div>
    <div class="row"><div class="chips">${[['all', 'Todo'], ['movie', 'Películas'], ['tv', 'Series']].map(([k, l]) => `<button class="chip ${kind === k ? 'on' : ''}" onclick="showsKind('${k}')">${l}</button>`).join('')}</div></div>
    ${tab === 'want' && count('want') >= 2 ? `<button class="btn ghost" onclick="showsToDecide()">${icon('dice')} ¿Qué vemos hoy?</button>` : ''}
    ${HAS_TMDB ? `<button class="btn ghost" onclick="openSuggestions()">✨ Sugerencias para ustedes</button>` : ''}
    ${list.length ? `<div class="posters">${list.map(s => `<button class="poster" onclick="openShow('${s.id}')">
      <span class="img">${s.poster ? `<img src="${IMG(s.poster, 342)}" alt="" loading="lazy">` : (s.type === 'tv' ? '📺' : '🎬')}
        ${s.status === 'watching' && s.type === 'tv' && s.progress ? `<span class="tag">T${s.progress.s} · E${s.progress.e}</span>` : ''}</span>
      <b>${esc(s.title)}</b><small>${[s.year, s.type === 'tv' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')}</small></button>`).join('')}</div>`
      : `<div class="glass center"><p class="muted" style="margin:0">${tab === 'want' ? 'Agreguen pelis y series que quieren ver' : tab === 'watching' ? 'Nada en curso' : 'Cuando terminen una, aparece aquí'}</p></div>`}
    ${HAS_TMDB ? '<p class="tiny muted center" style="margin:0">Datos de películas por TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.</p>' : ''}`);
}
function showsTab(t) { tab = t; render(); }
function showsKind(k) { kind = k; render(); }

/* ---------- Agregar ---------- */
function openAddShow() {
  openSheet(`<div class="stack"><h2>Agregar película o serie</h2>
    ${HAS_TMDB ? `<input id="shSearch" placeholder="Busca el nombre…" autocomplete="off" aria-label="Buscar" oninput="searchShows(this.value)">
      <div id="shResults" class="stack" style="gap:4px"></div>
      <button class="link" onclick="manualShow()">No la encuentro, agregar a mano</button>` : manualForm()}
  </div>`);
  setTimeout(() => $('shSearch')?.focus(), 50);
}
const manualForm = () => `<input id="shTitle" placeholder="Nombre" maxlength="80" aria-label="Nombre">
  <div class="grid2"><select id="shType" aria-label="Tipo"><option value="movie">Película</option><option value="tv">Serie</option></select>
    <input id="shWhere" placeholder="Dónde verla" maxlength="30" aria-label="Plataforma"></div>
  <button class="btn" onclick="saveManualShow()">Agregar</button>`;
function manualShow() { $('sheetBody').querySelector('.stack').innerHTML = `<h2>Agregar a mano</h2>${manualForm()}`; }
function saveManualShow() {
  const title = $('shTitle').value.trim(); if (!title) return toast('Pon el nombre');
  const where = $('shWhere').value.trim();
  write(setDoc(newRef('shows'), { title, type: $('shType').value, providers: where ? [where] : [], status: 'want', ratings: {}, by: uid(), createdAt: Date.now() }));
  tab = 'want'; closeSheet(); toast('Agregada a la lista');
}
let lastResults = [];
function searchShows(q) {
  clearTimeout(searchTimer);
  if (q.trim().length < 2) { $('shResults').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const data = await tmdb('search/multi', { query: q.trim(), include_adult: 'false' });
      lastResults = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 8);
      const box = $('shResults'); if (!box) return;
      box.innerHTML = lastResults.length ? lastResults.map((r, i) => {
        const title = r.title || r.name, year = (r.release_date || r.first_air_date || '').slice(0, 4);
        const have = S.data.shows.some(s => s.tmdbId === r.id && s.type === r.media_type);
        return `<button class="result" onclick="pickShow(${i})" ${have ? 'disabled style="opacity:.5"' : ''}>
          ${r.poster_path ? `<img src="${IMG(r.poster_path, 92)}" alt="">` : `<span class="ph">${r.media_type === 'tv' ? '📺' : '🎬'}</span>`}
          <span class="grow"><b>${esc(title)}</b><span class="sub small muted" style="display:block">${[year, r.media_type === 'tv' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')}${have ? ' · ya está en la lista' : ''}</span></span></button>`;
      }).join('') : '<p class="small muted center">Sin resultados</p>';
    } catch (e) { console.error(e); const box = $('shResults'); if (box) box.innerHTML = '<p class="small muted center">No se pudo buscar. Revisa la conexión o agrégala a mano.</p>'; }
  }, 350);
}
async function pickShow(i, keep = false) {
  const r = lastResults[i]; if (!r) return;
  if (keep) { const b = document.querySelector(`[data-sug="${i}"]`); if (b) { b.disabled = true; b.textContent = '✓'; } }
  const type = r.media_type;
  let providers = [], seasons = null;
  try {
    const [prov, det] = await Promise.all([
      tmdb(`${type}/${r.id}/watch/providers`).catch(() => ({})),
      type === 'tv' ? tmdb(`tv/${r.id}`).catch(() => ({})) : Promise.resolve({}),
    ]);
    const reg = prov.results?.[region()] || {};
    providers = [...new Set([...(reg.flatrate || []), ...(reg.free || []), ...(reg.ads || [])].map(p => p.provider_name))].slice(0, 4);
    seasons = det.number_of_seasons || null;
  } catch {}
  write(setDoc(newRef('shows'), {
    title: r.title || r.name, type, year: (r.release_date || r.first_air_date || '').slice(0, 4), tmdbId: r.id,
    poster: r.poster_path || null, overview: (r.overview || '').slice(0, 600), providers, seasons,
    status: 'want', ratings: {}, by: uid(), createdAt: Date.now(),
  }));
  if (!keep) { tab = 'want'; closeSheet(); }
  toast('Agregada a Por ver');
}

/* ---------- Sugerencias ---------- */
// Recomendaciones de TMDB a partir de lo que vieron y les gustó (o de lo que tienen por ver). Sin datos: lo más visto de la semana.
async function openSuggestions() {
  openSheet('<div class="stack" id="sugBox"><h2>✨ Sugerencias</h2><p class="small muted center">Buscando ideas…</p></div>');
  const withId = S.data.shows.filter(s => s.tmdbId);
  const liked = withId.filter(s => s.status === 'seen' && Object.values(s.ratings || {}).some(v => v >= 4));
  const seeds = (liked.length ? liked : withId.filter(s => s.status === 'seen').length ? withId.filter(s => s.status === 'seen') : withId)
    .sort((a, b) => (b.seenAt || b.createdAt || 0) - (a.seenAt || a.createdAt || 0)).slice(0, 6);
  const have = new Set(S.data.shows.map(s => `${s.type}-${s.tmdbId}`));
  const found = new Map();
  try {
    if (seeds.length) {
      const lists = await Promise.all(seeds.map(s => tmdb(`${s.type}/${s.tmdbId}/recommendations`).then(d => ({ s, d })).catch(() => null)));
      for (const x of lists.filter(Boolean)) for (const r of (x.d.results || []).slice(0, 12)) {
        const type = r.media_type || x.s.type, key = `${type}-${r.id}`;
        if (have.has(key) || r.adult) continue;
        const f = found.get(key) || { ...r, media_type: type, n: 0, because: [] };
        f.n++; if (f.because.length < 2) f.because.push(x.s.title); found.set(key, f);
      }
    }
    if (found.size < 6) {
      const t = await tmdb('trending/all/week').catch(() => ({}));
      for (const r of (t.results || [])) { const key = `${r.media_type}-${r.id}`; if ((r.media_type === 'movie' || r.media_type === 'tv') && !have.has(key) && !found.has(key)) found.set(key, { ...r, n: 0, because: [] }); }
    }
  } catch {}
  lastResults = [...found.values()].sort((a, b) => b.n - a.n || (b.vote_average || 0) - (a.vote_average || 0)).slice(0, 18);
  const box = $('sugBox'); if (!box) return;
  box.innerHTML = `<h2>✨ Sugerencias</h2>${seeds.length ? '<p class="small muted" style="margin:0">Según lo que han visto y agregado</p>' : '<p class="small muted" style="margin:0">Lo más visto esta semana. Mientras más agreguen y califiquen, mejores sugerencias.</p>'}
    ${lastResults.length ? lastResults.map((r, i) => `<div class="result" style="cursor:default">${r.poster_path ? `<img src="${IMG(r.poster_path, 92)}" alt="">` : `<span class="ph">${r.media_type === 'tv' ? '📺' : '🎬'}</span>`}
      <span class="grow"><b>${esc(r.title || r.name)}</b><span class="sub small muted" style="display:block">${[(r.release_date || r.first_air_date || '').slice(0, 4), r.media_type === 'tv' ? 'Serie' : 'Película', r.vote_average ? '★ ' + r.vote_average.toFixed(1) : ''].filter(Boolean).join(' · ')}</span>
        ${r.because.length ? `<span class="tiny muted" style="display:block">${seeds.every(s => s.status === 'seen') ? 'Porque vieron' : 'Parecida a'} ${r.because.map(esc).join(' y ')}</span>` : ''}</span>
      <button class="btn small" data-sug="${i}" aria-label="Agregar a Por ver" onclick="pickShow(${i},true)">${icon('plus')}</button></div>`).join('') : '<p class="small muted center">No se pudieron cargar sugerencias. Revisa la conexión.</p>'}`;
}

/* ---------- Detalle ---------- */
function openShow(id) {
  const s = S.data.shows.find(x => x.id === id); if (!s) { closeSheet(); return; }
  openId = id;
  const p = partnerUid(), mine = s.ratings?.[uid()] || 0, theirs = p ? s.ratings?.[p] : 0;
  const st = s.status || 'want', prog = s.progress || { s: 1, e: 1 };
  openSheet(`<div class="stack" id="showDetail">
    <div class="show-head">${s.poster ? `<img src="${IMG(s.poster, 342)}" alt="">` : ''}
      <div class="stack" style="gap:6px"><h2>${esc(s.title)}</h2>
        <span class="small muted">${[s.year, s.type === 'tv' ? 'Serie' : 'Película', s.seasons ? `${s.seasons} temporadas` : ''].filter(Boolean).join(' · ')}</span>
        ${s.providers?.length ? `<div class="chips">${s.providers.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
        <span class="tiny muted">La agregó ${esc(nameOf(s.by))}</span></div></div>
    ${s.overview ? `<p class="small" style="margin:0;line-height:1.5;color:color-mix(in srgb,var(--text) 85%,transparent)">${esc(s.overview)}</p>` : ''}
    <div class="seg">${STATUS.map(([k, l]) => `<button class="${st === k ? 'on' : ''}" onclick="setShowStatus('${id}','${k}')">${l.replace('Vistas', 'Vista')}</button>`).join('')}</div>
    ${s.type === 'tv' && st === 'watching' ? `<div class="glass tight row"><span class="small">Van en</span>
      <div class="stepper"><button aria-label="Temporada anterior" onclick="stepShow('${id}','s',-1)">−</button><b>T${prog.s}</b><button aria-label="Temporada siguiente" onclick="stepShow('${id}','s',1)">+</button></div>
      <div class="stepper"><button aria-label="Capítulo anterior" onclick="stepShow('${id}','e',-1)">−</button><b>E${prog.e}</b><button aria-label="Capítulo siguiente" onclick="stepShow('${id}','e',1)">+</button></div></div>` : ''}
    ${st === 'seen' ? `<div class="row"><span class="small muted">Tu nota</span><span class="stars">${[1, 2, 3, 4, 5].map(i =>
      `<button class="${i <= mine ? 'on' : ''}" aria-label="${i} estrellas" onclick="rateShow('${id}',${i})">${icon('star')}</button>`).join('')}</span></div>
      ${theirs ? `<div class="row"><span class="small muted">Nota de ${esc(nameOf(p))}</span><span class="stars">${[1, 2, 3, 4, 5].map(i =>
        `<span style="color:${i <= theirs ? 'var(--g2)' : 'var(--line)'}">${icon('star')}</span>`).join('')}</span></div>` : ''}` : ''}
    <button class="btn danger" onclick="delShow('${id}')">${icon('trash')} Quitar de la lista</button></div>`);
}
function setShowStatus(id, status) {
  const patch = { status };
  if (status === 'seen') patch.seenAt = Date.now();
  if (status === 'watching' && !S.data.shows.find(x => x.id === id)?.progress) patch.progress = { s: 1, e: 1 };
  write(updateDoc(ref('shows', id), patch)); tab = status;
  if (status === 'seen') toast('¡Vista! Pónganle nota');
}
function stepShow(id, k, d) {
  const s = S.data.shows.find(x => x.id === id); const p = { ...(s.progress || { s: 1, e: 1 }) };
  p[k] = Math.max(1, p[k] + d); if (k === 's' && d > 0) p.e = 1;
  write(updateDoc(ref('shows', id), { progress: p }));
}
function rateShow(id, n) { write(updateDoc(ref('shows', id), { [`ratings.${uid()}`]: n })); }
async function delShow(id) { if (await ask('¿Quitar de la lista?')) { write(deleteDoc(ref('shows', id))); openId = null; closeSheet(); } }

// Manda las pendientes a Decidir para elegir con match, al azar o por turnos.
function showsToDecide() {
  const opts = [...new Set(S.data.shows.filter(s => (s.status || 'want') === 'want' && (kind === 'all' || s.type === kind)).map(s => s.title))].slice(0, 30);
  if (opts.length < 2) return toast('Necesitan al menos 2 en "Por ver"');
  const name = 'Nuestra lista de pelis';
  const existing = S.data.lists.find(l => l.name === name);
  if (existing) { write(updateDoc(ref('lists', existing.id), { options: opts, votes: {} })); window.selectList(existing.id); }
  else createList(name, '🍿', opts);
  window.decideTab('lists'); go('s-decide'); toast('Lista lista en Decidir');
}

on('shows', () => { render(); if (openId && $('showDetail') && $('sheet').classList.contains('show')) openShow(openId); });
expose({ openSuggestions, showsTab, showsKind, openAddShow, manualShow, saveManualShow, searchShows, pickShow, openShow,
  setShowStatus, stepShow, rateShow, delShow, showsToDecide });
