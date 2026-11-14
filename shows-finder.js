// Buscador de pelis y series para ustedes (TMDB): eligen tipo, estilos, plataformas y extras, y sugiere muchas (20 por
// tanda, «Cargar más»). Con «Usar nuestros gustos» también toma lo que calificaron con 4-5 ★ (recomendaciones de TMDB de
// esas, y los géneros que más les gustan suben en la lista; los de 1-2 ★ bajan). Nunca sugiere lo que ya está en su lista.
// Las preferencias del buscador se guardan por persona en profiles/<uid>.prefs.watch { type, styles, providers, extras, gustos }.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, expose, toast, write, ref, uid, profile, nameOf, syncBack, on } from './core.js';
import { tmdb, IMG, region, addFromTmdb, HAS_TMDB } from './shows.js';

// Estilos → géneros de TMDB [película, serie] (varios estilos = cualquiera de ellos)
const STYLES = [
  ['risa', '😂 Comedia', [35], [35]], ['amor', '💘 Romántica', [10749], [10766]], ['miedo', '😱 Terror', [27], [9648]],
  ['suspenso', '🔪 Suspenso', [53], [9648, 80]], ['crimen', '🕵️ Crimen', [80], [80]], ['accion', '💥 Acción', [28], [10759]],
  ['aventura', '🗺️ Aventura', [12], [10759]], ['scifi', '🚀 Ciencia ficción', [878], [10765]], ['fantasia', '🐉 Fantasía', [14], [10765]],
  ['drama', '🎭 Drama', [18], [18]], ['anim', '🧸 Animación', [16], [16]], ['docu', '🌍 Documental', [99], [99]],
  ['familia', '👨‍👩‍👧 Familiar', [10751], [10751]], ['historia', '🏛️ Historia', [36], [10768]], ['musica', '🎵 Musical', [10402], []], ['reality', '📺 Reality', [], [10764]],
];
const GENRE_NAME = { 28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen', 99: 'Documental', 18: 'Drama', 10751: 'Familiar', 14: 'Fantasía', 36: 'Historia',
  27: 'Terror', 10402: 'Musical', 9648: 'Misterio', 10749: 'Romance', 878: 'Ciencia ficción', 53: 'Suspenso', 10752: 'Bélica', 37: 'Western', 10759: 'Acción y aventura',
  10762: 'Infantil', 10764: 'Reality', 10765: 'Ciencia ficción y fantasía', 10766: 'Telenovela', 10768: 'Guerra y política' };
const EXTRAS = [['top', '⭐ Muy bien calificadas'], ['nuevas', '🆕 De los últimos 3 años'], ['clasicas', '🕰️ Clásicos (antes del 2000)'], ['cortas', '⏱️ Pelis cortas (menos de 100 min)']];

const prefs = () => ({ type: 'both', styles: [], providers: [], extras: [], gustos: true, ...(profile(uid()).prefs?.watch || {}) });
let F = null, view = null, provList = null, taste = null, results = [], page = 0, loading = false, seen = new Set();

/* ---------- Plataformas de su país ---------- */
async function loadProviders() {
  if (provList) return provList;
  const R = region();
  const [m, t] = await Promise.all(['movie', 'tv'].map(k => tmdb(`watch/providers/${k}`, { watch_region: R }).catch(() => ({ results: [] }))));
  const map = new Map();
  for (const p of [...(m.results || []), ...(t.results || [])]) {
    const pr = p.display_priorities?.[R] ?? p.display_priority ?? 99, old = map.get(p.provider_id);
    if (!old || pr < old.pr) map.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logo: p.logo_path, pr });
  }
  // Fuera las variantes con anuncios / «Amazon Channel» que repiten la misma plataforma
  return (provList = [...map.values()].filter(p => !/channel|with ads|con anuncios|basic/i.test(p.name)).sort((a, b) => a.pr - b.pr).slice(0, 18));
}

/* ---------- Sus gustos (lo que calificaron) ---------- */
async function loadTaste() {
  if (taste) return taste;
  const rated = S.data.shows.filter(s => s.tmdbId && Object.keys(s.ratings || {}).length);
  const avg = s => { const v = Object.values(s.ratings); return v.reduce((a, b) => a + b, 0) / v.length; };
  const liked = rated.filter(s => avg(s) >= 4).sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0)).slice(0, 8);
  const disliked = rated.filter(s => avg(s) <= 2).slice(0, 6);
  const genres = {};
  const det = await Promise.all([...liked, ...disliked].map(s => tmdb(`${s.type}/${s.tmdbId}`).then(d => ({ s, g: (d.genres || []).map(x => x.id) })).catch(() => ({ s, g: [] }))));
  for (const { s, g } of det) for (const id of g) genres[id] = (genres[id] || 0) + (liked.includes(s) ? 1 : -1);
  // Quién calificó alto (para decir «A Ana le encantó…» o «A los dos les gustó…»)
  const who = s => { const hi = Object.entries(s.ratings).filter(([, v]) => v >= 4).map(([u]) => u); return hi.length >= 2 ? 'los dos' : hi[0] ? nameOf(hi[0]) : ''; };
  return (taste = { liked: liked.map(s => ({ ...s, who: who(s) })), genres });
}
const favGenres = () => Object.entries(taste?.genres || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([g]) => Number(g));

/* ---------- Buscar ---------- */
const types = () => F.type === 'both' ? ['movie', 'tv'] : [F.type];
const genresFor = t => [...new Set(F.styles.flatMap(k => STYLES.find(s => s[0] === k)?.[t === 'movie' ? 2 : 3] || []))];
const yearAgo = n => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };
function discoverParams(t, pg) {
  const p = { watch_region: region(), sort_by: 'popularity.desc', include_adult: 'false', page: pg, 'vote_count.gte': t === 'movie' ? 120 : 60 };
  let g = genresFor(t);
  if (F.styles.length && !g.length) return null; // ese estilo no existe para este tipo (p. ej. Reality en películas)
  if (!g.length && F.gustos && favGenres().length) g = favGenres().slice(0, 3);
  if (g.length) p.with_genres = g.join('|');
  if (F.providers.length) { p.with_watch_providers = F.providers.join('|'); p.with_watch_monetization_types = 'flatrate|free|ads'; }
  const dk = t === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (F.extras.includes('top')) { p['vote_average.gte'] = 7.2; p['vote_count.gte'] = t === 'movie' ? 400 : 200; }
  if (F.extras.includes('nuevas')) p[`${dk}.gte`] = yearAgo(3);
  if (F.extras.includes('clasicas')) p[`${dk}.lte`] = '1999-12-31';
  if (F.extras.includes('cortas') && t === 'movie') p['with_runtime.lte'] = 100;
  const bad = Object.entries(taste?.genres || {}).filter(([, n]) => n < -1).map(([id]) => id);
  if (F.gustos && bad.length) p.without_genres = bad.join(',');
  return p;
}
const inList = () => new Set(S.data.shows.filter(s => s.tmdbId).map(s => `${s.type}-${s.tmdbId}`));
async function provOf(r) {
  if (r._prov) return r._prov;
  const d = await tmdb(`${r.media_type}/${r.id}/watch/providers`).catch(() => ({}));
  const reg = d.results?.[region()] || {};
  return (r._prov = [...(reg.flatrate || []), ...(reg.free || []), ...(reg.ads || [])].filter((p, i, a) => a.findIndex(x => x.provider_id === p.provider_id) === i));
}
async function search(more) {
  if (loading) return; loading = true;
  if (!more) { results = []; page = 0; seen = inList(); }
  page++;
  paintResults(true);
  try {
    if (F.gustos) await loadTaste();
    const found = [];
    // 1. Parecidas a lo que les gustó (solo en la primera tanda)
    if (!more && F.gustos && taste.liked.length) {
      const recs = await Promise.all(taste.liked.slice(0, 6).map(s => tmdb(`${s.type}/${s.tmdbId}/recommendations`).then(d => ({ s, d })).catch(() => null)));
      const cand = [];
      for (const x of recs.filter(Boolean)) for (const r of (x.d.results || []).slice(0, 10)) {
        const t = r.media_type || x.s.type, k = `${t}-${r.id}`;
        if (!types().includes(t) || seen.has(k) || r.adult) continue;
        const g = genresFor(t); if (F.styles.length && !(r.genre_ids || []).some(id => g.includes(id))) continue;
        if (F.extras.includes('top') && (r.vote_average || 0) < 7) continue;
        const year = Number((r.release_date || r.first_air_date || '').slice(0, 4));
        if (F.extras.includes('nuevas') && year < new Date().getFullYear() - 3) continue;
        if (F.extras.includes('clasicas') && (!year || year >= 2000)) continue;
        seen.add(k); cand.push({ ...r, media_type: t, why: `💜 Porque a ${x.s.who === 'los dos' ? 'los dos les' : `${esc(x.s.who)} le`} gustó «${esc(x.s.title)}»` });
      }
      // Si eligieron plataformas, solo las que están ahí
      const ok = F.providers.length ? (await Promise.all(cand.slice(0, 16).map(async r => ((await provOf(r)).some(p => F.providers.includes(p.provider_id)) ? r : null)))).filter(Boolean) : cand.slice(0, 8);
      found.push(...ok.slice(0, 8));
    }
    // 2. Descubrir por estilo y plataforma (las que van con sus géneros favoritos suben)
    const fav = F.gustos ? favGenres() : [];
    const lists = await Promise.all(types().map(t => { const p = discoverParams(t, page); return p ? tmdb(`discover/${t}`, p).then(d => (d.results || []).map(r => ({ ...r, media_type: t }))).catch(() => []) : []; }));
    const mixed = [];
    for (let i = 0; i < 20; i++) for (const l of lists) if (l[i]) mixed.push({ ...l[i], _rank: mixed.length });
    for (const r of mixed) {
      const k = `${r.media_type}-${r.id}`; if (seen.has(k) || r.adult) continue; seen.add(k);
      const hits = (r.genre_ids || []).filter(id => fav.includes(id));
      r._score = r._rank - hits.length * 4;
      if (hits.length && F.gustos) r.why = `✨ Va con lo que les gusta: ${hits.slice(0, 2).map(id => GENRE_NAME[id]).filter(Boolean).join(' y ')}`;
      found.push(r);
    }
    const head = found.filter(r => r.why?.startsWith('💜')), rest = found.filter(r => !r.why?.startsWith('💜')).sort((a, b) => a._score - b._score);
    results.push(...head, ...rest);
  } catch (e) { console.warn(e); toast('No se pudo buscar. Revisa la conexión'); }
  loading = false;
  paintResults();
}

/* ---------- Pantalla ---------- */
export async function openFinder() {
  if (!HAS_TMDB) return toast('Falta la clave de TMDB');
  F = { ...prefs() };
  view?.remove();
  view = document.createElement('div'); view.className = 'dialog mt-view fd-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Buscar qué ver');
  document.body.appendChild(view); syncBack();
  view.innerHTML = `<div class="mt-top"><b>🔎 ¿Qué vemos?</b><button class="link" onclick="closeFinder()">Cerrar</button></div><div class="mt-body" id="fdBody"><div id="fdFilters"></div><div id="fdResults"></div></div>`;
  paintFilters();
  loadProviders().then(() => paintFilters()).catch(() => {});
  search();
}
function paintFilters() {
  const box = $('fdFilters'); if (!box) return;
  const chip = (on, label, click, extra = '') => `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" onclick="${click}" ${extra}>${label}</button>`;
  const liked = S.data.shows.filter(s => Object.values(s.ratings || {}).some(v => v >= 4)).length;
  box.innerHTML = `<div class="fd-sec"><span class="label">¿Qué quieren ver?</span>
      <div class="seg">${[['both', 'Las dos'], ['movie', 'Películas'], ['tv', 'Series']].map(([k, l]) => `<button class="${F.type === k ? 'on' : ''}" onclick="fdSet('type','${k}')">${l}</button>`).join('')}</div></div>
    <div class="fd-sec"><span class="label">Estilo <span class="tiny muted">(elige uno o varios)</span></span>
      <div class="fd-chips">${STYLES.filter(s => F.type === 'both' || (F.type === 'movie' ? s[2].length : s[3].length)).map(([k, l]) => chip(F.styles.includes(k), l, `fdToggle('styles','${k}')`)).join('')}</div></div>
    <div class="fd-sec"><span class="label">En sus plataformas <span class="tiny muted">(si no eligen, busca en todas)</span></span>
      <div class="fd-chips">${provList ? provList.map(p => chip(F.providers.includes(p.id), `${p.logo ? `<img src="${IMG(p.logo, 45)}" alt="">` : ''}${esc(p.name)}`, `fdToggle('providers',${p.id})`)).join('') : '<span class="tiny muted">Cargando plataformas…</span>'}</div></div>
    <div class="fd-sec"><span class="label">Extras</span><div class="fd-chips">${EXTRAS.filter(([k]) => k !== 'cortas' || F.type !== 'tv').map(([k, l]) => chip(F.extras.includes(k), l, `fdToggle('extras','${k}')`)).join('')}</div></div>
    <label class="row fd-gustos"><input type="checkbox" ${F.gustos ? 'checked' : ''} onchange="fdSet('gustos', this.checked)">
      <span class="small"><b>💜 Usar nuestros gustos</b><br><span class="muted">${liked ? `Toma en cuenta las ${liked} que calificaron con 4 o 5 ★ (y evita lo que no les gustó)` : 'Califiquen con estrellas lo que vean (en «Vistas») y las sugerencias se parecerán más a ustedes'}</span></span></label>
    <button class="btn" onclick="fdSearch()">🔎 Buscar</button>`;
}
function paintResults(busy) {
  const box = $('fdResults'); if (!box) return;
  const items = results;
  box.innerHTML = `${items.length ? `<p class="small muted" style="margin:8px 0 4px">${items.length} ${items.length === 1 ? 'sugerencia' : 'sugerencias'}${F.providers.length ? ' en sus plataformas' : ''}</p>` : ''}
    <div class="fd-list">${items.map((r, i) => `<div class="fd-card">
      <button class="fd-poster" onclick="fdMore(${i})" aria-label="Ver de qué trata">${r.poster_path ? `<img src="${IMG(r.poster_path, 185)}" alt="" loading="lazy">` : `<span>${r.media_type === 'tv' ? '📺' : '🎬'}</span>`}</button>
      <div class="fd-info"><b>${esc(r.title || r.name)}</b>
        <span class="tiny muted">${[(r.release_date || r.first_air_date || '').slice(0, 4), r.media_type === 'tv' ? 'Serie' : 'Película', r.vote_average ? '★ ' + r.vote_average.toFixed(1) : ''].filter(Boolean).join(' · ')}</span>
        <span class="tiny muted">${(r.genre_ids || []).slice(0, 3).map(id => GENRE_NAME[id]).filter(Boolean).join(' · ')}</span>
        ${r.why ? `<span class="tiny fd-why">${r.why}</span>` : ''}
        <span class="fd-prov" data-i="${i}"></span>
        ${r._open ? `<p class="small fd-ov">${esc(r.overview || 'Sin descripción.')}</p>` : ''}
        <div class="row" style="gap:8px;justify-content:flex-start;margin-top:4px">
          <button class="btn small" ${r._added ? 'disabled' : ''} onclick="fdAdd(${i})">${r._added ? '✓ En Por ver' : `${icon('plus')} Por ver`}</button>
          <button class="link small" onclick="fdMore(${i})">${r._open ? 'Menos' : 'De qué trata'}</button></div></div></div>`).join('')}</div>
    ${busy ? '<p class="small muted center">Buscando… 🍿</p>' : items.length ? `<button class="btn ghost" onclick="fdSearch(true)">Cargar más</button>`
      : `<p class="small muted center">No encontré nada con esos filtros. Prueben con menos estilos, otras plataformas o sin extras.</p>`}
    <p class="tiny muted center" style="margin:8px 0 0">Datos y plataformas por TMDB y JustWatch. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.</p>`;
  // Dónde verla: logos de las plataformas (en su país)
  items.forEach((r, i) => provOf(r).then(ps => {
    const el = box.querySelector(`.fd-prov[data-i="${i}"]`); if (!el) return;
    const mine = F.providers.length ? ps.filter(p => F.providers.includes(p.provider_id)).concat(ps.filter(p => !F.providers.includes(p.provider_id))) : ps;
    el.innerHTML = mine.slice(0, 4).map(p => `<img src="${IMG(p.logo_path, 45)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('') || '<span class="tiny muted">No está en streaming en su país</span>';
  }));
}
function savePrefs() { write(setDoc(ref('profiles', uid()), { prefs: { watch: { type: F.type, styles: F.styles, providers: F.providers, extras: F.extras, gustos: F.gustos } } }, { merge: true })); }
function fdSet(k, v) { F[k] = v; if (k === 'type') F.styles = F.styles.filter(s => { const st = STYLES.find(x => x[0] === s); return v === 'both' || (v === 'movie' ? st[2].length : st[3].length); }); paintFilters(); }
function fdToggle(k, v) { const a = F[k]; F[k] = a.includes(v) ? a.filter(x => x !== v) : [...a, v]; paintFilters(); }
function fdSearch(more) { if (!more) { savePrefs(); $('fdResults')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } search(more === true); }
function fdMore(i) { const r = results[i]; if (!r) return; r._open = !r._open; paintResults(); }
async function fdAdd(i) {
  const r = results[i]; if (!r || r._added) return;
  r._added = true; paintResults();
  await addFromTmdb(r); toast(`«${r.title || r.name}» quedó en Por ver 🍿`);
}
function closeFinder() { const el = view; view = null; if (!el) return; el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160); }
// Si cambian las calificaciones, se recalculan sus gustos la próxima vez
on('shows', () => { taste = null; });
expose({ openFinder, closeFinder, fdSet, fdToggle, fdSearch, fdMore, fdAdd });
