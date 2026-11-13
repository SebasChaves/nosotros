// Búsqueda en toda la app. Las notas sin leer para ti y la respuesta de tu pareja a preguntas que no respondiste no aparecen.
import { $, S, esc, icon, paint, onShow, expose, go, parseDate, fmtShort, fmtMoney, uid, SECTIONS } from './core.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
let lastQ = '', searchFrom = 's-home';
// Abre la búsqueda recordando desde qué pantalla se vino, para volver ahí.
function closeSearch() { go(searchFrom === 's-search' ? 's-home' : searchFrom); }
function openSearch() { searchFrom = document.querySelector('.screen.active')?.id || 's-home'; go('s-search'); }

// Cada fuente: [grupo, ícono, lista de { text, sub, open }]
function sources() {
  const me = uid(), D = S.data;
  const out = [];
  const add = (group, e, items) => out.push([group, e, items]);
  add('Secciones', '🧭', SECTIONS.map(([id, , name]) => ({ text: name, sub: 'Abrir sección', open: () => go(id) })));
  add('Notas', '💌', D.notes.filter(n => n.fromUid === me || n.readAt).map(n => ({ text: n.text, sub: fmtShort(new Date(n.createdAt)), open: () => { go('s-love'); window.loveTab('notes'); } })));
  add('Cupones', '🎟️', D.coupons.map(c => ({ text: c.text, sub: c.doneAt ? 'Cumplido' : c.redeemedAt ? 'Canjeado' : 'Disponible', open: () => { go('s-love'); window.loveTab('coupons'); } })));
  add('Momentos', '📸', D.moments.map(m => ({ text: `${m.title} ${m.note || ''}`, label: m.title, sub: fmtShort(parseDate(m.date)), open: () => go('s-moments') })));
  add('Calendario', '📌', D.events.map(e => ({ text: `${e.title} ${e.note || ''}`, label: e.title, sub: fmtShort(parseDate(e.date)), open: () => { go('s-cal'); window.calPick(e.date); } })));
  add('Fechas especiales', '🎂', D.dates.map(f => ({ text: f.title, sub: fmtShort(parseDate(f.date)), open: () => window.openFecha(null, f.id) })));
  add('Viajes', '✈️', D.trips.flatMap(t => [
    { text: `${t.name} ${t.dest || ''}`, label: t.name, sub: t.dest || '', open: () => window.openTrip(t.id) },
    ...(t.plan || []).map(p => ({ text: p.text, sub: `Itinerario · ${t.name}`, open: () => window.openTrip(t.id) })),
    ...(t.stays || []).map(o => ({ text: o.name, sub: `Hospedaje · ${t.name}`, open: () => { window.openTrip(t.id); window.tripTab('stays'); } })),
    ...(t.packing || []).map(p => ({ text: p.text, sub: `Maleta · ${t.name}`, open: () => { window.openTrip(t.id); window.tripTab('pack'); } })),
  ]));
  add('Pelis y series', '🍿', D.shows.map(s => ({ text: s.title, sub: { want: 'Por ver', watching: 'Viendo', seen: 'Vista' }[s.status || 'want'], open: () => { go('s-shows'); window.openShow(s.id); } })));
  add('Restaurantes', '🍽️', D.places.map(p => ({ text: `${p.name} ${p.kind || ''} ${(p.visits || []).map(v => v.note).join(' ')}`, label: p.name, sub: p.status === 'been' ? 'Ya fuimos' : 'Queremos ir', open: () => go('s-places') })));
  add('Bucket list', '✅', D.bucket.map(b => ({ text: b.text, sub: b.done ? 'Cumplida' : 'Pendiente', open: () => go('s-bucket') })));
  add('Súper', '🛒', D.groceries.map(g => ({ text: g.text, sub: g.done ? 'En el carrito' : 'Por comprar', open: () => go('s-grocery') })));
  add('Gastos', '💸', D.expenses.filter(e => e.type !== 'settle').map(e => ({ text: e.desc, sub: `${fmtMoney(e.amount)} · ${fmtShort(parseDate(e.date))}`, open: () => go('s-money') })));
  add('Listas de Decidir', '🎲', D.lists.map(l => ({ text: `${l.name} ${(l.options || []).join(' ')}`, label: l.name, sub: `${(l.options || []).length} opciones`, open: () => { go('s-decide'); window.decideTab('lists'); window.selectList(l.id); } })));
  add('Preguntas del día', '💬', D.answers.filter(a => a.answers?.[me]).map(a => ({ text: `${a.q} ${Object.values(a.answers).map(x => x.text).join(' ')}`, label: a.q, sub: fmtShort(parseDate(a.id)), open: () => { go('s-home'); window.openAnswers(); } })));
  add('Recetas', '👩‍🍳', window.__allRecipes?.().map(r => ({ text: `${r.name} ${(r.ingredients || []).join(' ')}`, label: r.name, sub: r.min ? `${r.min} min` : '', open: () => { go('s-recipes'); window.openRecipe(r.id); } })) || []);
  add('Playlist', '🎵', D.songs.map(s => ({ text: `${s.title} ${s.artist || ''} ${s.why || ''}`, label: s.title, sub: s.artist || '', open: () => go('s-music') })));
  add('Mapa', '📍', D.pins.map(p => ({ text: `${p.title} ${p.place || ''} ${p.country || ''} ${p.note || ''}`, label: p.title, sub: [p.place, p.country].filter(Boolean).join(', '), open: () => { go('s-map'); setTimeout(() => window.flyPin(p.id), 400); } })));
  add('Antojos', '🍓', D.cravings.map(c => ({ text: `${c.text} ${c.note || ''}`, label: `${c.emoji || '🍓'} ${c.text}`, sub: c.fav ? 'Favorito de la ruleta' : c.done ? 'Cumplido' : c.kind === 'someday' ? 'Algún día' : 'Pendiente', open: () => window.openCravings(c.fav ? 'spin' : c.done ? 'done' : c.kind === 'someday' ? 'someday' : 'now') })));
  add('Ideas de regalo', '🎁', S.priv.gifts.map(g => ({ text: g.text, sub: 'Solo tú la ves', open: () => { go('s-us'); window.usTab('gifts'); } })));
  return out;
}

let current = [];
function search(q) {
  lastQ = q;
  const box = $('searchResults'); if (!box) return;
  const n = norm(q.trim());
  if (n.length < 2) { box.innerHTML = '<p class="small muted center">Escribe al menos 2 letras</p>'; return; }
  current = []; let html = '';
  for (const [group, e, items] of sources()) {
    const hits = items.filter(it => norm(it.text).includes(n)).slice(0, 8);
    if (!hits.length) continue;
    html += `<div class="glass"><span class="label">${group} · ${hits.length}</span><div style="margin-top:4px">${hits.map(h => {
      current.push(h);
      const label = h.label || h.text, i = norm(label).indexOf(n);
      const shown = i >= 0 ? `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + q.trim().length))}</mark>${esc(label.slice(i + q.trim().length))}` : esc(label);
      return `<button class="result-row" onclick="openResult(${current.length - 1})"><span class="e">${e}</span>
        <span class="grow" style="min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shown}</span><span class="tiny muted">${esc(h.sub || '')}</span></span></button>`;
    }).join('')}</div></div>`;
  }
  box.innerHTML = html || `<p class="small muted center">Nada con "${esc(q.trim())}"</p>`;
}
function openResult(i) { current[i]?.open(); }

function render() {
  paint('s-search', `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="closeSearch()">${icon('back')}</button><h1>Buscar</h1></div></div>
    <input id="searchInput" type="search" placeholder="Notas, viajes, pelis, gastos…" autocomplete="off" aria-label="Buscar" oninput="runSearch(this.value)">
    <div id="searchResults" class="stack"></div>`);
  const inp = $('searchInput');
  if (lastQ) { inp.value = lastQ; search(lastQ); } else $('searchResults').innerHTML = '<p class="small muted center">Busca en notas, momentos, viajes, pelis, gastos, listas y más</p>';
  setTimeout(() => inp.focus(), 60);
}

onShow('s-search', render);
expose({ runSearch: search, openResult, openSearch, closeSearch });
