// Hospedaje y vuelos de un viaje: búsquedas ya filtradas en otras páginas y opciones guardadas para comparar y votar.
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos,
         parseDate, daysBetween, todayKey, fmtShort, fmtMoney, nameOf, partnerUid, avatar, plural, uid, ask, celebrate } from './core.js';
import { parseAmount } from './money.js';

let compare = { stays: false, flights: false };
const newId = () => Math.random().toString(36).slice(2, 10);
export const nights = t => t.start && t.end ? Math.max(1, daysBetween(parseDate(t.start), parseDate(t.end))) : null;
const guests = t => Math.max(1, Number(t.guests) || 2);
const tripOf = id => S.data.trips.find(t => t.id === id);
const spentOn = t => S.data.expenses.filter(e => e.tripId === t.id && e.type !== 'settle').reduce((s, e) => s + e.amount, 0);
const SITES = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', expedia: 'Expedia', hotels: 'Hotels.com', google: 'Google',
  kayak: 'Kayak', skyscanner: 'Skyscanner', trivago: 'Trivago', agoda: 'Agoda', despegar: 'Despegar', tripadvisor: 'Tripadvisor' };
const siteOf = url => {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return Object.entries(SITES).find(([k]) => h.includes(k))?.[1] || h; }
  catch { return ''; }
};
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';

/* ---------- Búsquedas con un toque ---------- */
function stayLinks(t) {
  const d = encodeURIComponent(t.dest), ci = t.start, co = t.end, n = guests(t), cur = S.settings.currency || 'USD';
  const dates = ci && co;
  return [
    ['Airbnb', `https://www.airbnb.com/s/${encodeURIComponent(t.dest.trim().replace(/\s*,\s*/g, '--').replace(/\s+/g, '-'))}/homes?query=${d}&adults=${n}&currency=${cur}${dates ? `&checkin=${ci}&checkout=${co}` : ''}`],
    ['Booking', `https://www.booking.com/searchresults.es.html?ss=${d}&group_adults=${n}&no_rooms=1&group_children=0&selected_currency=${cur}${dates ? `&checkin=${ci}&checkout=${co}` : ''}`],
    ['Google Hoteles', `https://www.google.com/travel/search?hl=es&q=${encodeURIComponent(`hoteles en ${t.dest}${dates ? ` del ${ci} al ${co}` : ''} para ${n}`)}`],
    ['Vrbo', `https://www.vrbo.com/search?destination=${d}&adults=${n}${dates ? `&startDate=${ci}&endDate=${co}` : ''}`],
    ['Expedia', `https://www.expedia.com/Hotel-Search?destination=${d}&adults=${n}${dates ? `&startDate=${ci}&endDate=${co}` : ''}`],
    ['Hotels.com', `https://www.hotels.com/Hotel-Search?destination=${d}&adults=${n}${dates ? `&startDate=${ci}&endDate=${co}` : ''}`],
  ];
}
function flightLinks(t) {
  const n = guests(t), O = (t.originCode || '').toUpperCase(), D = (t.destCode || '').toUpperCase();
  const from = O || t.origin, to = D || t.dest, ci = t.start, co = t.end;
  const yymmdd = s => s.slice(2).replace(/-/g, '');
  const out = [['Google Flights', `https://www.google.com/travel/flights?hl=es&q=${encodeURIComponent(`Flights to ${to} from ${from}${ci ? ` on ${ci}` : ''}${co ? ` through ${co}` : ''} for ${n} adults`)}`]];
  if (O && D && ci) {
    out.push(['Skyscanner', `https://www.skyscanner.net/transport/flights/${O.toLowerCase()}/${D.toLowerCase()}/${yymmdd(ci)}/${co ? yymmdd(co) + '/' : ''}?adultsv2=${n}`]);
    out.push(['Kayak', `https://www.kayak.com/flights/${O}-${D}/${ci}${co ? '/' + co : ''}/${n}adults`]);
  }
  return out;
}
const linkGrid = links => `<div class="grid2">${links.map(([n, u]) => `<a class="btn ghost small" style="width:100%;text-decoration:none" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('')}</div>`;

/* ---------- Votos y comparación ---------- */
const likes = o => Object.entries(o.votes || {}).filter(([, v]) => v).map(([k]) => k);
const voteRow = (t, kind, o) => {
  const mine = o.votes?.[uid()];
  return `<div class="row"><span class="avatars">${likes(o).map(id => avatar(id, 26)).join('') || '<span class="small muted">Sin votos</span>'}</span>
    <div class="row" style="gap:6px"><button class="icon-btn" style="width:38px;height:38px;${mine === false ? 'background:var(--glass-2)' : ''}" aria-label="No me gusta" onclick="optVote('${t.id}','${kind}','${o.id}',false)">${icon('x')}</button>
    <button class="icon-btn" style="width:38px;height:38px;${mine ? 'background:var(--grad);color:var(--on-grad)' : ''}" aria-label="Me gusta" onclick="optVote('${t.id}','${kind}','${o.id}',true)">${icon('heart-f')}</button></div></div>`;
};
const sortOpts = arr => [...arr].sort((a, b) => (b.booked - a.booked) || (likes(b).length - likes(a).length) || ((a.total || 9e15) - (b.total || 9e15)));
function budgetPill(t, o) {
  if (!t.budget || !o.total || o.booked) return '';
  const left = t.budget - spentOn(t);
  return o.total <= left ? `<span class="pill ok">Cabe en el presupuesto</span>` : `<span class="pill hot">Se pasa por ${fmtMoney(o.total - left)}</span>`;
}

/* ---------- Hospedaje ---------- */
export function renderStays(t) {
  const n = nights(t), g = guests(t), opts = sortOpts(t.stays || []);
  const ready = !!t.dest;
  paint('tripBody', `
    <div class="glass stack"><span class="label">${icon('spark')} Buscar dónde quedarse</span>
      ${ready ? `<p class="small muted" style="margin:0">${esc(t.dest)} · ${t.start && t.end ? `${fmtShort(parseDate(t.start))} – ${fmtShort(parseDate(t.end))} · ${plural(n, 'noche', 'noches')}` : 'sin fechas'} · ${plural(g, 'persona', 'personas')}</p>
        ${linkGrid(stayLinks(t))}<p class="tiny muted" style="margin:0">Se abre la página con la búsqueda lista. Cuando vean algo que les guste, copien el enlace y guárdenlo aquí.</p>`
      : `<p class="small muted" style="margin:0">Pon el destino del viaje para buscar.</p><button class="btn ghost small" onclick="editTrip()">Editar viaje</button>`}</div>
    <div class="row"><h2>Opciones (${opts.length})</h2><div class="row" style="gap:6px">${opts.length > 1 ? `<button class="link" onclick="toggleCompare('stays')">${compare.stays ? 'Ver tarjetas' : 'Comparar'}</button>` : ''}
      <button class="btn small" onclick="openStay('${t.id}')">${icon('plus')} Guardar opción</button></div></div>
    ${compare.stays && opts.length > 1 ? compareTable(opts, o => [o.name, o.total ? fmtMoney(o.total) : '—', o.total ? fmtMoney(o.total / g) : '—', o.rating ? `⭐ ${o.rating}` : '—', likes(o).length])
      : opts.length ? opts.map(o => `<div class="glass stack">
      <div class="row"><div class="grow"><h2 style="font-size:16px">${safeUrl(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(o.name)} ↗</a>` : esc(o.name)}</h2>
        <span class="small muted">${[o.site, o.rating ? `⭐ ${o.rating}` : ''].filter(Boolean).join(' · ')}</span></div>
        ${o.booked ? '<span class="pill ok">Reservado</span>' : ''}</div>
      ${o.total ? `<div class="row"><div><div class="money grad-text" style="font-size:24px">${fmtMoney(o.total)}</div>
        <div class="tiny muted">${o.perNight && n ? `${fmtMoney(o.perNight)} × ${plural(n, 'noche', 'noches')} · ` : ''}${fmtMoney(o.total / g)} por persona</div></div>${budgetPill(t, o)}</div>` : ''}
      ${o.notes ? `<p class="small" style="margin:0">${esc(o.notes)}</p>` : ''}
      ${voteRow(t, 'stays', o)}
      <div class="grid2"><button class="btn ${o.booked ? 'ghost' : ''} small" style="width:100%" onclick="bookOpt('${t.id}','stays','${o.id}')">${o.booked ? 'Quitar reserva' : `${icon('check')} Reservamos esta`}</button>
        <button class="btn ghost small" style="width:100%" onclick="delOpt('${t.id}','stays','${o.id}')">${icon('trash')} Quitar</button></div></div>`).join('')
      : '<div class="glass center muted small">Aún no guardan opciones. Busquen arriba y guarden las que les gusten para votar.</div>'}`);
  loadPhotos($('tripBody'));
}
function openStay(tripId) {
  const t = tripOf(tripId), n = nights(t);
  openSheet(`<div class="stack"><h2>Guardar hospedaje</h2>
    <input id="oUrl" type="url" placeholder="Pega el enlace (Airbnb, Booking…)" aria-label="Enlace" oninput="guessSite(this.value)">
    <input id="oName" placeholder="Nombre del lugar" maxlength="70" aria-label="Nombre">
    <div class="grid2"><div><label class="f" for="oNight">Precio por noche</label><input id="oNight" inputmode="decimal" oninput="calcTotal(${n || 0})"></div>
      <div><label class="f" for="oTotal">Total${n ? ` (${plural(n, 'noche', 'noches')})` : ''}</label><input id="oTotal" inputmode="decimal"></div></div>
    <div class="grid2"><div><label class="f" for="oRating">Calificación</label><input id="oRating" inputmode="decimal" placeholder="Ej: 4.8"></div><div></div></div>
    <textarea id="oNotes" maxlength="200" placeholder="Notas: piscina, cerca de la playa, cancelación gratis…" style="min-height:70px" aria-label="Notas"></textarea>
    <button class="btn" onclick="saveStay('${tripId}')">Guardar opción</button></div>`);
}
function guessSite(url) {
  const name = $('oName'); if (!name || name.value) return;
  const s = siteOf(url); if (s) name.placeholder = `Nombre del lugar (${s})`;
}
function calcTotal(n) { const v = parseAmount($('oNight').value); if (n && v > 0) $('oTotal').value = Math.round(v * n * 100) / 100; }
function saveStay(tripId) {
  const t = tripOf(tripId), url = $('oUrl').value.trim(), name = $('oName').value.trim() || siteOf(url);
  if (!name) return toast('Pon el nombre o el enlace');
  const opt = { id: newId(), name, url: safeUrl(url), site: siteOf(url), perNight: parseAmount($('oNight').value) || 0,
    total: parseAmount($('oTotal').value) || 0, rating: parseFloat(String($('oRating').value).replace(',', '.')) || 0,
    notes: $('oNotes').value.trim(), votes: { [uid()]: true }, booked: false, by: uid(), createdAt: Date.now() };
  write(updateDoc(ref('trips', tripId), { stays: [...(t.stays || []), opt] }));
  closeSheet(); toast('Opción guardada. ¡Que vote tu pareja!');
}

/* ---------- Vuelos ---------- */
export function renderFlights(t) {
  const g = guests(t), opts = sortOpts(t.flights || []);
  const hasFrom = t.origin || t.originCode;
  paint('tripBody', `
    <div class="glass stack"><span class="label">${icon('plane')} Buscar vuelos</span>
      ${hasFrom && t.dest ? `<p class="small muted" style="margin:0">${esc(t.originCode || t.origin)} → ${esc(t.destCode || t.dest)} · ${plural(g, 'persona', 'personas')}</p>
        ${linkGrid(flightLinks(t))}${!(t.originCode && t.destCode) ? '<p class="tiny muted" style="margin:0">Con los códigos de aeropuerto (ej. SJO, LIR) también aparecen Skyscanner y Kayak.</p>' : ''}`
      : `<p class="small muted" style="margin:0">Pon desde dónde salen y el destino para buscar vuelos.</p>`}
      <button class="btn ghost small" onclick="editTrip()">Editar viaje</button></div>
    <div class="row"><h2>Opciones (${opts.length})</h2><div class="row" style="gap:6px">${opts.length > 1 ? `<button class="link" onclick="toggleCompare('flights')">${compare.flights ? 'Ver tarjetas' : 'Comparar'}</button>` : ''}
      <button class="btn small" onclick="openFlight('${t.id}')">${icon('plus')} Guardar opción</button></div></div>
    ${compare.flights && opts.length > 1 ? compareTable(opts, o => [o.airline, o.total ? fmtMoney(o.total) : '—', o.total ? fmtMoney(o.total / g) : '—', o.stops === 0 ? 'Directo' : o.stops ? `${o.stops} esc.` : '—', likes(o).length])
      : opts.length ? opts.map(o => `<div class="glass stack">
      <div class="row"><div class="grow"><h2 style="font-size:16px">${safeUrl(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(o.airline)} ↗</a>` : esc(o.airline)}</h2>
        <span class="small muted">${[o.stops === 0 ? 'Directo' : o.stops ? plural(o.stops, 'escala', 'escalas') : '', o.site].filter(Boolean).join(' · ')}</span></div>
        ${o.booked ? '<span class="pill ok">Comprado</span>' : ''}</div>
      ${o.out || o.back ? `<div class="small">${o.out ? `Ida: ${esc(o.out)}` : ''}${o.out && o.back ? '<br>' : ''}${o.back ? `Vuelta: ${esc(o.back)}` : ''}</div>` : ''}
      ${o.total ? `<div class="row"><div><div class="money grad-text" style="font-size:24px">${fmtMoney(o.total)}</div><div class="tiny muted">${fmtMoney(o.total / g)} por persona</div></div>${budgetPill(t, o)}</div>` : ''}
      ${o.notes ? `<p class="small" style="margin:0">${esc(o.notes)}</p>` : ''}
      ${voteRow(t, 'flights', o)}
      <div class="grid2"><button class="btn ${o.booked ? 'ghost' : ''} small" style="width:100%" onclick="bookOpt('${t.id}','flights','${o.id}')">${o.booked ? 'Quitar compra' : `${icon('check')} Compramos este`}</button>
        <button class="btn ghost small" style="width:100%" onclick="delOpt('${t.id}','flights','${o.id}')">${icon('trash')} Quitar</button></div></div>`).join('')
      : '<div class="glass center muted small">Guarden aquí los vuelos que encuentren para compararlos.</div>'}`);
  loadPhotos($('tripBody'));
}
function openFlight(tripId) {
  openSheet(`<div class="stack"><h2>Guardar vuelo</h2>
    <input id="fUrl" type="url" placeholder="Enlace (opcional)" aria-label="Enlace">
    <input id="fAirline" placeholder="Aerolínea" maxlength="50" aria-label="Aerolínea">
    <input id="fOut" placeholder="Ida: ej. 20 dic 6:30 am → 8:00 am" maxlength="60" aria-label="Ida">
    <input id="fBack" placeholder="Vuelta: ej. 23 dic 5:00 pm → 6:30 pm" maxlength="60" aria-label="Vuelta">
    <div class="grid2"><div><label class="f" for="fTotal">Precio total</label><input id="fTotal" inputmode="decimal"></div>
      <div><label class="f" for="fStops">Escalas</label><select id="fStops"><option value="0">Directo</option><option value="1">1</option><option value="2">2 o más</option></select></div></div>
    <textarea id="fNotes" maxlength="200" placeholder="Notas: incluye maleta, horario cómodo…" style="min-height:70px" aria-label="Notas"></textarea>
    <button class="btn" onclick="saveFlight('${tripId}')">Guardar opción</button></div>`);
}
function saveFlight(tripId) {
  const t = tripOf(tripId), url = $('fUrl').value.trim(), airline = $('fAirline').value.trim() || siteOf(url);
  if (!airline) return toast('Pon la aerolínea o el enlace');
  const opt = { id: newId(), airline, url: safeUrl(url), site: siteOf(url), out: $('fOut').value.trim(), back: $('fBack').value.trim(),
    total: parseAmount($('fTotal').value) || 0, stops: Number($('fStops').value), notes: $('fNotes').value.trim(),
    votes: { [uid()]: true }, booked: false, by: uid(), createdAt: Date.now() };
  write(updateDoc(ref('trips', tripId), { flights: [...(t.flights || []), opt] }));
  closeSheet(); toast('Opción guardada');
}

/* ---------- Comunes ---------- */
function compareTable(opts, row) {
  const head = ['Opción', 'Total', 'Por persona', opts[0].airline !== undefined ? 'Escalas' : 'Nota', '👍'];
  return `<div class="glass" style="overflow-x:auto;padding:10px"><table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">
    <thead><tr>${head.map(h => `<th style="text-align:left;padding:8px 6px;color:var(--muted);font-weight:600;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
    <tbody>${opts.map(o => `<tr style="border-top:1px solid var(--line)">${row(o).map((c, i) => `<td style="padding:10px 6px;${i ? 'white-space:nowrap' : 'font-weight:600'}">${esc(c)}${i === 0 && o.booked ? ' ✓' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function toggleCompare(k) { compare[k] = !compare[k]; window.tripTab(k === 'stays' ? 'stays' : 'flights'); }
function optVote(tripId, kind, id, val) {
  const t = tripOf(tripId);
  write(updateDoc(ref('trips', tripId), { [kind]: (t[kind] || []).map(o => o.id === id ? { ...o, votes: { ...(o.votes || {}), [uid()]: val } } : o) }));
}
async function delOpt(tripId, kind, id) {
  const t = tripOf(tripId), o = (t[kind] || []).find(x => x.id === id);
  if (!await ask(o?.booked ? '¿Quitar esta opción? También se borra su gasto.' : '¿Quitar esta opción?')) return;
  const batch = writeBatch(db);
  if (o?.expenseId) batch.delete(ref('expenses', o.expenseId));
  batch.update(ref('trips', tripId), { [kind]: (t[kind] || []).filter(x => x.id !== id) });
  write(batch.commit());
}
// Marcar como reservado crea el gasto en Gastos (pagado por quien lo marca, mitad y mitad). Desmarcar lo borra.
async function bookOpt(tripId, kind, id) {
  const t = tripOf(tripId), o = (t[kind] || []).find(x => x.id === id); if (!o) return;
  const batch = writeBatch(db);
  if (o.booked) {
    if (!await ask('¿Quitar la reserva? Se borra el gasto que se había agregado.')) return;
    if (o.expenseId) batch.delete(ref('expenses', o.expenseId));
    batch.update(ref('trips', tripId), { [kind]: t[kind].map(x => x.id === id ? { ...x, booked: false, expenseId: null } : x) });
    write(batch.commit()); return;
  }
  let expenseId = null;
  if (o.total > 0 && await ask(`¿Agregar ${fmtMoney(o.total)} a Gastos, pagado por ti y dividido mitad y mitad? (Luego se puede cambiar en Gastos)`)) {
    const er = newRef('expenses'); expenseId = er.id;
    batch.set(er, { desc: `${kind === 'stays' ? 'Hospedaje' : 'Vuelo'}: ${o.name || o.airline}`, amount: o.total, paidBy: uid(), split: 'half',
      cat: '✈️', date: todayKey(), tripId, createdAt: Date.now(), by: uid() });
  }
  batch.update(ref('trips', tripId), { [kind]: t[kind].map(x => x.id === id ? { ...x, booked: true, expenseId } : x) });
  write(batch.commit()); toast(kind === 'stays' ? '¡Reservado!' : '¡Comprado!'); celebrate();
}

expose({ openStay, guessSite, calcTotal, saveStay, openFlight, saveFlight, toggleCompare, optVote, delOpt, bookOpt });
