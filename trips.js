// Viajes: itinerario por día, ideas, pendientes antes de salir, reservas, maleta, presupuesto (unido a Gastos y a una
// alcancía), diario con resumen y clima. La lista tiene dos vistas: sus viajes y «Por conocer» (trips-dreams.js).
// Doc trips/<id>: name, dest, start, end, guests, budget, currency?, goalId?, dreamId?, geo?, plan[], ideas[], todo[],
// bookings[], packing[], stays[], flights[], journal[], savedMoment? (pestañas extra en trips-extra.js).
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go,
         parseDate, today, daysBetween, fmtShort, fmtDay, dayKey, whenText, fmtMoney, nameOf, plural, uid, ask, db, loadPhotos } from './core.js';
import { PACKING_TPL, CURRENCIES } from './data.js';
import { renderIdeas, renderTodo, renderBookings, renderJournal, loadWeather, weatherHTML, weatherPack, todoLeft } from './trips-extra.js';
import { dreamsHTML, afterDreams, dreamsPending } from './trips-dreams.js';
import { backBar } from './lists.js';
import { parseAmount, catOf } from './money.js';
import { renderStays, renderFlights } from './booking.js';

// Opciones que guardó tu pareja y que tú aún no votas
const pendingVotes = (t, k) => { const n = (t[k] || []).filter(o => o.votes?.[uid()] === undefined).length; return n ? `<b class="dot">${n}</b>` : ''; };

let current = null, tab = 'plan', pendingTrip = null;
const trip = () => S.data.trips.find(t => t.id === current);
const newId = () => Math.random().toString(36).slice(2, 10);
const tripSpent = t => S.data.expenses.filter(e => e.tripId === t.id && e.type !== 'settle').reduce((s, e) => s + e.amount, 0);
const tripDays = t => {
  if (!t.start) return [];
  const s = parseDate(t.start), e = t.end ? parseDate(t.end) : s, out = [];
  for (let d = s; d <= e && out.length < 60; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(dayKey(d));
  return out;
};

/* ---------- Lista de viajes ---------- */
function renderTrips() {
  const now = today();
  const items = [...S.data.trips].sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const upcoming = items.filter(t => !t.end || parseDate(t.end) >= now), past = items.filter(t => t.end && parseDate(t.end) < now).reverse();
  const card = t => {
    const left = t.start ? daysBetween(now, parseDate(t.start)) : null;
    return `<button class="tile" style="min-height:0;width:100%" onclick="openTrip('${t.id}')">
      <div class="row"><b>${esc(t.name)}</b>${left !== null && left >= 0 ? `<span class="pill hot">${whenText(left)}</span>` : ''}</div>
      <span class="sub">${esc(t.dest || '')}${t.start ? ` · ${fmtShort(parseDate(t.start))}${t.end ? ' – ' + fmtShort(parseDate(t.end)) : ''}` : ''}</span></button>`;
  };
  const nd = S.data.dreams.filter(d => !d.went).length, dp = dreamsPending();
  const seg = `<div class="seg"><button class="${view === 'trips' ? 'on' : ''}" onclick="tripsView('trips')">Sus viajes</button><button class="${view === 'dreams' ? 'on' : ''}" onclick="tripsView('dreams')">Por conocer${nd ? ' · ' + nd : ''}${dp ? `<b class="dot">${dp}</b>` : ''}</button></div>`;
  if (view === 'dreams') { paint('s-trips', `${backBar('Viajes', 's-more', `<button class="btn small" onclick="newTrip()">${icon('plus')} Viaje</button>`)}${seg}${dreamsHTML()}`); afterDreams($('s-trips')); return; }
  // Viaje que salió de «Por conocer» y ya terminó: ese lugar pasa a «Ya fueron»
  for (const t of past) if (t.dreamId) { const d = S.data.dreams.find(x => x.id === t.dreamId); if (d && !d.went) write(updateDoc(ref('dreams', d.id), { went: Date.now() })); }
  paint('s-trips', `${backBar('Viajes', 's-more', `<button class="btn small" onclick="newTrip()">${icon('plus')} Viaje</button>`)}${seg}
    ${upcoming.length ? upcoming.map(card).join('') : `<div class="glass center stack"><div style="font-size:42px">✈️</div><p class="muted" style="margin:0">Planeen su próximo viaje: itinerario, maleta y presupuesto en un solo lugar.</p>
      <button class="btn" onclick="newTrip()">Planear un viaje</button></div>`}
    ${past.length ? `<span class="label">Viajes pasados</span>${past.map(card).join('')}` : ''}`);
}
let view = 'trips';
function tripsView(v) { view = v; renderTrips(); }
window.renderTripsList = () => renderTrips();
let editing = null, fromDream = null;
function tripForm(t = {}) {
  editing = t.id || null;
  openSheet(`<div class="stack"><h2>${editing ? 'Editar viaje' : 'Nuevo viaje'}</h2>
    <input id="tName" placeholder="Nombre del viaje" maxlength="50" aria-label="Nombre" value="${esc(t.name || '')}">
    <input id="tDest" placeholder="Destino (ej. Tamarindo, Costa Rica)" maxlength="60" aria-label="Destino" value="${esc(t.dest || '')}">
    <div class="grid2"><div><label class="f" for="tStart">Ida</label><input type="date" id="tStart" value="${esc(t.start || '')}"></div>
      <div><label class="f" for="tEnd">Vuelta</label><input type="date" id="tEnd" value="${esc(t.end || '')}"></div></div>
    <div class="grid2"><div><label class="f" for="tGuests">Personas</label><input id="tGuests" type="number" min="1" max="16" inputmode="numeric" value="${esc(t.guests || 2)}"></div>
      <div><label class="f" for="tBudget">Presupuesto</label><input id="tBudget" inputmode="decimal" placeholder="Opcional" value="${t.budget ? esc(t.budget) : ''}"></div></div>
    <div><label class="f" for="tCur">Moneda del destino</label><select id="tCur">${CURRENCIES.map(([k, l]) => `<option value="${k}" ${(t.currency || S.settings.currency || 'USD') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    ${!t.goalId ? `<label class="check"><input type="checkbox" id="tGoal" ${editing ? '' : 'checked'}> 🐷 Abrir una alcancía para este viaje (meta = presupuesto)</label>` : ''}
    <span class="label" style="margin-top:6px">Para buscar vuelos (opcional)</span>
    <input id="tOrigin" placeholder="Salen desde (ej. San José)" maxlength="60" aria-label="Ciudad de salida" value="${esc(t.origin || '')}">
    <div class="grid2"><input id="tOCode" placeholder="Aeropuerto salida (SJO)" maxlength="3" autocapitalize="characters" aria-label="Código aeropuerto de salida" value="${esc(t.originCode || '')}">
      <input id="tDCode" placeholder="Aeropuerto llegada (LIR)" maxlength="3" autocapitalize="characters" aria-label="Código aeropuerto de llegada" value="${esc(t.destCode || '')}"></div>
    <button class="btn" onclick="saveTrip()">${editing ? 'Guardar cambios' : 'Crear viaje'}</button></div>`);
}
function newTrip() { fromDream = null; tripForm(); }
// Desde «Por conocer»: el formulario con nombre, destino y presupuesto ya puestos
// Desde los días libres del calendario: el viaje con esas fechas
function newTripDates(start, end) { go('s-trips'); fromDream = null; tripForm({ name: '', start, end }); }
function newTripFrom(d) { tripForm({ name: d.name, dest: d.dest, budget: d.budget }); fromDream = d; }
function editTrip() { tripForm(trip()); }
function saveTrip() {
  const name = $('tName').value.trim(), start = $('tStart').value, end = $('tEnd').value;
  if (!name) return toast('Ponle nombre al viaje');
  if (start && end && end < start) return toast('La vuelta no puede ser antes de la ida');
  const code = v => v.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const fields = { name, dest: $('tDest').value.trim(), start, end, budget: parseAmount($('tBudget').value) || 0,
    guests: Math.min(16, Math.max(1, parseInt($('tGuests').value, 10) || 2)), origin: $('tOrigin').value.trim(),
    originCode: code($('tOCode').value), destCode: code($('tDCode').value), currency: $('tCur').value };
  const wantGoal = $('tGoal')?.checked && fields.budget > 0;
  if ($('tGoal')?.checked && !fields.budget) return toast('Pongan un presupuesto para la alcancía (o desmárquenla)');
  const r = editing ? ref('trips', editing) : newRef('trips'), b = writeBatch(db);
  if (wantGoal) { const gid = 'g-' + Date.now(); b.set(ref('money', gid), { kind: 'goal', name, emoji: '✈️', target: fields.budget, saved: 0, at: Date.now(), by: uid(), log: [], tripId: r.id }); fields.goalId = gid; }
  if (editing) {
    const old = trip(); if (old?.goalId && fields.budget && fields.budget !== old.budget) b.update(ref('money', old.goalId), { target: fields.budget });
    if (old?.dest !== fields.dest) fields.geo = null; // el clima se vuelve a buscar con el destino nuevo
    b.update(r, fields); write(b.commit()); closeSheet(); toast('Viaje actualizado'); return;
  }
  const fd = fromDream; fromDream = null;
  b.set(r, { ...fields, plan: [], packing: [], stays: [], flights: [], ideas: [], todo: [], bookings: [], journal: [], createdAt: Date.now(), by: uid(), ...(fd ? { dreamId: fd.dreamId, geo: fd.geo } : {}) });
  if (fd?.dreamId) b.update(ref('dreams', fd.dreamId), { tripId: r.id });
  write(b.commit());
  pendingTrip = r.id; closeSheet(); openTrip(r.id);
  if (wantGoal) toast('Viaje creado con su alcancía 🐷');
}

/* ---------- Detalle ---------- */
function openTrip(id) { current = id; tab = 'plan'; go('s-trip'); renderTrip(); }
function renderTrip() {
  const t = trip();
  if (!t) { if (current !== pendingTrip && $('s-trip').classList.contains('active')) go('s-trips'); return; }
  const left = t.start ? daysBetween(today(), parseDate(t.start)) : null;
  if (!$('tripBody')) $('s-trip').innerHTML = `<div id="tripHead" class="stack"></div><div id="tripBody" class="stack" style="gap:14px"></div>`;
  paint('tripHead', `${backBar(esc(t.name), 's-trips', `<div class="row" style="gap:8px"><button class="icon-btn" aria-label="Editar viaje" onclick="editTrip()">${icon('gear')}</button><button class="icon-btn" aria-label="Borrar viaje" onclick="delTrip()">${icon('trash')}</button></div>`)}
    <div class="glass center"><div class="small muted">${esc(t.dest || '')}${t.start ? ` · ${fmtShort(parseDate(t.start))}${t.end ? ' – ' + fmtShort(parseDate(t.end)) : ''}` : ''}</div>
      ${left !== null && left > 0 ? `<div class="big grad-text" style="font-size:48px;margin-top:6px">${left}</div><div class="muted">${left === 1 ? 'día' : 'días'} para el viaje</div>` : left !== null && left <= 0 && (!t.end || parseDate(t.end) >= today()) ? '<h2 style="margin-top:6px">¡Están de viaje!</h2>' : ''}</div>
    <div class="chips scroll trip-tabs">${TABS.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" onclick="tripTab('${k}')">${l}${k === 'stays' || k === 'flights' ? pendingVotes(t, k) : k === 'todo' && todoLeft(t) && left !== null && left >= 0 ? `<b class="dot">${todoLeft(t)}</b>` : ''}</button>`).join('')}</div>`);
  ({ plan: renderPlan, ideas: renderIdeas, todo: renderTodo, stays: renderStays, flights: renderFlights, book: renderBookings, pack: renderPack, money: renderBudget, diary: renderJournal }[tab] || renderPlan)(t);
  document.querySelector('.trip-tabs .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}
const TABS = [['plan', '🗓️ Plan'], ['ideas', '💡 Ideas'], ['todo', '✅ Antes de salir'], ['stays', '🏨 Estadía'], ['flights', '✈️ Vuelos'], ['book', '🎫 Reservas'], ['pack', '🧳 Maleta'], ['money', '💸 Dinero'], ['diary', '📔 Diario']];
function tripTab(x) { tab = x; renderTrip(); }
// Clima: se pide una vez y se vuelve a pintar el Plan o la Maleta cuando llega
const wxCache = {};
function wx(t) {
  if (!t.start || !(t.dest || t.geo)) return null;
  const key = `${t.id}|${t.start}|${t.end}|${t.dest}`;
  if (!(key in wxCache)) { wxCache[key] = null; loadWeather(t).then(w => { wxCache[key] = w; if (w && current === t.id && (tab === 'plan' || tab === 'pack')) renderTrip(); }).catch(() => {}); }
  return wxCache[key];
}

function renderPlan(t) {
  const days = tripDays(t), plan = t.plan || [];
  const groups = days.length ? days : [...new Set(plan.map(p => p.date))].sort();
  paint('tripBody', `${weatherHTML(wx(t))}
    <div class="glass stack"><h2>Agregar al itinerario</h2>
      <div class="grid2">${days.length ? `<select id="pDay" aria-label="Día">${days.map((d, i) => `<option value="${d}">Día ${i + 1} · ${fmtShort(parseDate(d))}</option>`).join('')}</select>` : `<input type="date" id="pDay" aria-label="Día">`}
        <input type="time" id="pTime" aria-label="Hora"></div>
      <div class="add-row"><input id="pText" placeholder="Ej: Tour en lancha" maxlength="80" aria-label="Actividad" onkeydown="if(event.key==='Enter')addPlan()">
        <button class="btn" aria-label="Agregar" onclick="addPlan()">${icon('plus')}</button></div></div>
    ${groups.map((d, i) => {
      const items = plan.filter(p => p.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      return `<div class="glass"><span class="label">Día ${i + 1} · ${fmtDay(parseDate(d))}</span>
        <ul class="list" style="margin-top:6px">${items.length ? items.map(p => `<li><b class="num" style="width:46px;font-size:13px">${esc(p.time || '—')}</b>
          <div class="txt">${esc(p.text)}</div><button class="del" aria-label="Quitar" onclick="delPlan('${p.id}')">${icon('x')}</button></li>`).join('')
          : '<li class="empty" style="padding:8px">Día libre</li>'}</ul></div>`;
    }).join('') || '<div class="glass center muted">Pongan fechas al viaje o agreguen actividades</div>'}`);
}
function addPlan() {
  const t = trip(), text = $('pText').value.trim(), date = $('pDay').value;
  if (!text || !date) return toast('Escribe la actividad y el día');
  write(updateDoc(ref('trips', t.id), { plan: [...(t.plan || []), { id: newId(), date, time: $('pTime').value, text, by: uid() }] }));
  $('pText').value = '';
}
function delPlan(id) { const t = trip(); write(updateDoc(ref('trips', t.id), { plan: (t.plan || []).filter(p => p.id !== id) })); }

function renderPack(t) {
  const pack = t.packing || [];
  const done = pack.filter(p => p.done).length;
  const have = new Set(pack.map(p => p.text.toLowerCase()));
  paint('tripBody', `
    <div class="glass stack"><div class="row"><b>${done} de ${pack.length} empacadas</b></div>
      <div class="progress"><i style="width:${pack.length ? Math.round(done / pack.length * 100) : 0}%"></i></div>
      <div class="add-row"><input id="packText" placeholder="¿Qué hay que llevar?" maxlength="60" aria-label="Cosa para la maleta" onkeydown="if(event.key==='Enter')addPack()">
        <button class="btn" aria-label="Agregar" onclick="addPack()">${icon('plus')}</button></div>
      ${(s => s.length ? `<p class="tiny muted" style="margin:0">Por el clima de allá:</p><div class="chips scroll">${s.map(([e, x]) => `<button class="chip" onclick="addPack('${esc(x)}')">${e} ${esc(x)}</button>`).join('')}</div>` : '')(weatherPack(wx(t)).filter(([, x]) => !have.has(x.toLowerCase())))}
      <div class="chips scroll">${PACKING_TPL.filter(x => !have.has(x.toLowerCase())).map(x => `<button class="chip" onclick="addPack('${esc(x)}')">${icon('plus')} ${esc(x)}</button>`).join('')}</div>
      ${S.data.trips.some(o => o.id !== t.id && (o.packing || []).length) ? `<select aria-label="Copiar la maleta de otro viaje" onchange="copyPack(this.value)"><option value="">🧳 Copiar la maleta de otro viaje…</option>${S.data.trips.filter(o => o.id !== t.id && (o.packing || []).length).map(o => `<option value="${o.id}">${esc(o.name)} (${o.packing.length})</option>`).join('')}</select>` : ''}</div>
    <div class="glass"><ul class="list">${pack.length ? [...pack].sort((a, b) => a.done - b.done).map(p => `<li class="${p.done ? 'done' : ''}">
      <button class="check-btn" aria-label="${p.done ? 'Desmarcar' : 'Marcar empacado'}" onclick="togglePack('${p.id}')">${p.done ? icon('check') : ''}</button>
      <div class="txt"><span class="main">${esc(p.text)}</span>${p.done && p.doneBy ? `<span class="sub">lo empacó ${esc(nameOf(p.doneBy))}</span>` : ''}</div>
      <button class="del" aria-label="Quitar" onclick="delPack('${p.id}')">${icon('x')}</button></li>`).join('') : '<li class="empty">La maleta está vacía</li>'}</ul></div>`);
}
function addPack(text) {
  const t = trip(), v = (text ?? $('packText').value).trim(); if (!v) return;
  write(updateDoc(ref('trips', t.id), { packing: [...(t.packing || []), { id: newId(), text: v, done: false }] }));
  if (text === undefined) $('packText').value = '';
}
// Copia lo de la maleta de otro viaje (sin repetir y sin marcar)
function copyPack(from) {
  const t = trip(), o = S.data.trips.find(x => x.id === from); if (!t || !o) return;
  const have = new Set((t.packing || []).map(p => p.text.toLowerCase())), add = (o.packing || []).filter(p => !have.has(p.text.toLowerCase())).map(p => ({ id: newId(), text: p.text, done: false }));
  if (!add.length) return toast('Ya tienen todo lo de esa maleta');
  write(updateDoc(ref('trips', t.id), { packing: [...(t.packing || []), ...add] })); toast(`${add.length} cosas copiadas de «${o.name}» 🧳`);
}
function togglePack(id) {
  const t = trip();
  write(updateDoc(ref('trips', t.id), { packing: (t.packing || []).map(p => p.id === id ? { ...p, done: !p.done, doneBy: p.done ? null : uid() } : p) }));
}
function delPack(id) { const t = trip(); write(updateDoc(ref('trips', t.id), { packing: (t.packing || []).filter(p => p.id !== id) })); }

function renderBudget(t) {
  const spent = tripSpent(t), pct = t.budget ? Math.min(100, Math.round(spent / t.budget * 100)) : 0;
  const ex = S.data.expenses.filter(e => e.tripId === t.id && e.type !== 'settle').sort((a, b) => b.date.localeCompare(a.date));
  paint('tripBody', `
    <div class="glass stack"><div class="row"><span class="label">Gastado</span><span class="label">Presupuesto</span></div>
      <div class="row"><span class="money grad-text" style="font-size:28px">${fmtMoney(spent)}</span><b class="num">${t.budget ? fmtMoney(t.budget) : '—'}</b></div>
      ${t.budget ? `<div class="progress"><i style="width:${pct}%"></i></div><p class="small muted" style="margin:0">${spent > t.budget ? `Se pasaron por ${fmtMoney(spent - t.budget)}` : `Les quedan ${fmtMoney(t.budget - spent)}`}</p>` : ''}
      <div class="add-row"><input id="tBudgetEdit" inputmode="decimal" placeholder="${t.budget ? 'Cambiar presupuesto' : 'Poner presupuesto'}" aria-label="Presupuesto">
        <button class="btn" aria-label="Guardar presupuesto" onclick="setBudget()">${icon('check')}</button></div></div>
    ${goalBox(t)}
    <button class="btn" onclick="openExpense({tripId:'${t.id}',cat:'✈️'})">${icon('plus')} Agregar gasto del viaje</button>
    <div class="glass"><ul class="list">${ex.length ? ex.map(e => `<li><span style="font-size:20px">${catOf(e.cat)[0]}</span><div class="txt">${esc(e.desc)}<span class="sub">${fmtShort(parseDate(e.date))} · pagó ${esc(nameOf(e.paidBy))}</span></div>
      <b class="num">${fmtMoney(e.amount)}${e.orig ? `<small class="muted" style="display:block;font-weight:500">${esc(fmtCur(e.orig.amount, e.orig.cur))}</small>` : ''}</b></li>`).join('') : '<li class="empty">Los gastos de este viaje aparecen aquí y también en Gastos</li>'}</ul></div>`);
}
const fmtCur = (n, c) => { try { return new Intl.NumberFormat('es', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(n); } catch { return `${n} ${c}`; } };
// La alcancía del viaje (si tiene): cuánto llevan ahorrado y botón para aportar
function goalBox(t) {
  const g = t.goalId && S.data.money.find(x => x.id === t.goalId);
  if (!g) return t.budget ? `<button class="btn ghost" onclick="tripGoal()">🐷 Abrir una alcancía para este viaje</button>` : '';
  const pc = g.target ? Math.min(100, Math.round((g.saved || 0) / g.target * 100)) : 0;
  return `<div class="glass stack"><div class="row"><span class="label">🐷 Alcancía del viaje</span><b class="num">${fmtMoney(g.saved || 0)} <span class="muted">/ ${fmtMoney(g.target)}</span></b></div>
    <div class="progress"><i style="width:${pc}%"></i></div>
    <div class="row"><span class="small muted">${g.done ? '🎉 ¡Ya juntaron todo!' : `Llevan el ${pc} % · faltan ${fmtMoney(Math.max(0, g.target - (g.saved || 0)))}`}</span><button class="link" onclick="goalAdd('${g.id}')">+ Aportar</button></div></div>`;
}
function tripGoal() {
  const t = trip(); if (!t?.budget) return;
  const gid = 'g-' + Date.now(), b = writeBatch(db);
  b.set(ref('money', gid), { kind: 'goal', name: t.name, emoji: '✈️', target: t.budget, saved: 0, at: Date.now(), by: uid(), log: [], tripId: t.id });
  b.update(ref('trips', t.id), { goalId: gid }); write(b.commit()); toast('Alcancía creada 🐷 (también está en Gastos)');
}
function setBudget() {
  const v = parseAmount($('tBudgetEdit').value);
  if (!(v >= 0)) return toast('Monto no válido');
  const t = trip(); write(updateDoc(ref('trips', current), { budget: v })); $('tBudgetEdit').value = '';
  if (t?.goalId && v) write(updateDoc(ref('money', t.goalId), { target: v }));
}
async function delTrip() {
  if (!await ask('¿Borrar este viaje? Los gastos quedan en Gastos.')) return;
  write(deleteDoc(ref('trips', current))); current = null; go('s-trips');
}

on('trips expenses dreams money', () => { renderTrips(); if (current) renderTrip(); });
expose({ tripsView, newTripFrom, newTripDates, tripGoal, copyPack, newTrip, editTrip, saveTrip, openTrip, tripTab, addPlan, delPlan, addPack, togglePack, delPack, setBudget, delTrip });
