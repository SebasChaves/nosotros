// Viajes: itinerario por día, maleta compartida y presupuesto (unido a Gastos).
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go,
         parseDate, today, daysBetween, fmtShort, fmtDay, dayKey, whenText, fmtMoney, nameOf, plural, uid, ask } from './core.js';
import { PACKING_TPL } from './data.js';
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
  paint('s-trips', `${backBar('Viajes', 's-more', `<button class="btn small" onclick="newTrip()">${icon('plus')} Viaje</button>`)}
    ${upcoming.length ? upcoming.map(card).join('') : `<div class="glass center stack"><div style="font-size:42px">✈️</div><p class="muted" style="margin:0">Planeen su próximo viaje: itinerario, maleta y presupuesto en un solo lugar.</p>
      <button class="btn" onclick="newTrip()">Planear un viaje</button></div>`}
    ${past.length ? `<span class="label">Viajes pasados</span>${past.map(card).join('')}` : ''}`);
}
let editing = null;
function tripForm(t = {}) {
  editing = t.id || null;
  openSheet(`<div class="stack"><h2>${editing ? 'Editar viaje' : 'Nuevo viaje'}</h2>
    <input id="tName" placeholder="Nombre del viaje" maxlength="50" aria-label="Nombre" value="${esc(t.name || '')}">
    <input id="tDest" placeholder="Destino (ej. Tamarindo, Costa Rica)" maxlength="60" aria-label="Destino" value="${esc(t.dest || '')}">
    <div class="grid2"><div><label class="f" for="tStart">Ida</label><input type="date" id="tStart" value="${esc(t.start || '')}"></div>
      <div><label class="f" for="tEnd">Vuelta</label><input type="date" id="tEnd" value="${esc(t.end || '')}"></div></div>
    <div class="grid2"><div><label class="f" for="tGuests">Personas</label><input id="tGuests" type="number" min="1" max="16" inputmode="numeric" value="${esc(t.guests || 2)}"></div>
      <div><label class="f" for="tBudget">Presupuesto</label><input id="tBudget" inputmode="decimal" placeholder="Opcional" value="${t.budget ? esc(t.budget) : ''}"></div></div>
    <span class="label" style="margin-top:6px">Para buscar vuelos (opcional)</span>
    <input id="tOrigin" placeholder="Salen desde (ej. San José)" maxlength="60" aria-label="Ciudad de salida" value="${esc(t.origin || '')}">
    <div class="grid2"><input id="tOCode" placeholder="Aeropuerto salida (SJO)" maxlength="3" autocapitalize="characters" aria-label="Código aeropuerto de salida" value="${esc(t.originCode || '')}">
      <input id="tDCode" placeholder="Aeropuerto llegada (LIR)" maxlength="3" autocapitalize="characters" aria-label="Código aeropuerto de llegada" value="${esc(t.destCode || '')}"></div>
    <button class="btn" onclick="saveTrip()">${editing ? 'Guardar cambios' : 'Crear viaje'}</button></div>`);
}
function newTrip() { tripForm(); }
function editTrip() { tripForm(trip()); }
function saveTrip() {
  const name = $('tName').value.trim(), start = $('tStart').value, end = $('tEnd').value;
  if (!name) return toast('Ponle nombre al viaje');
  if (start && end && end < start) return toast('La vuelta no puede ser antes de la ida');
  const code = v => v.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const fields = { name, dest: $('tDest').value.trim(), start, end, budget: parseAmount($('tBudget').value) || 0,
    guests: Math.min(16, Math.max(1, parseInt($('tGuests').value, 10) || 2)), origin: $('tOrigin').value.trim(),
    originCode: code($('tOCode').value), destCode: code($('tDCode').value) };
  if (editing) { write(updateDoc(ref('trips', editing), fields)); closeSheet(); toast('Viaje actualizado'); return; }
  const r = newRef('trips');
  write(setDoc(r, { ...fields, plan: [], packing: [], stays: [], flights: [], createdAt: Date.now(), by: uid() }));
  pendingTrip = r.id; closeSheet(); openTrip(r.id);
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
    <div class="seg">${[['plan', 'Plan'], ['stays', 'Estadía'], ['flights', 'Vuelos'], ['pack', 'Maleta'], ['money', 'Dinero']].map(([k, l]) =>
      `<button class="${tab === k ? 'on' : ''}" style="padding:10px 2px;font-size:12.5px" onclick="tripTab('${k}')">${l}${k === 'stays' || k === 'flights' ? pendingVotes(t, k) : ''}</button>`).join('')}</div>`);
  ({ plan: renderPlan, stays: renderStays, flights: renderFlights, pack: renderPack, money: renderBudget }[tab] || renderPlan)(t);
}
function tripTab(x) { tab = x; renderTrip(); }

function renderPlan(t) {
  const days = tripDays(t), plan = t.plan || [];
  const groups = days.length ? days : [...new Set(plan.map(p => p.date))].sort();
  paint('tripBody', `
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
      <div class="chips scroll">${PACKING_TPL.filter(x => !have.has(x.toLowerCase())).map(x => `<button class="chip" onclick="addPack('${esc(x)}')">${icon('plus')} ${esc(x)}</button>`).join('')}</div></div>
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
    <button class="btn" onclick="openExpense({tripId:'${t.id}',cat:'✈️'})">${icon('plus')} Agregar gasto del viaje</button>
    <div class="glass"><ul class="list">${ex.length ? ex.map(e => `<li><span style="font-size:20px">${catOf(e.cat)[0]}</span><div class="txt">${esc(e.desc)}<span class="sub">${fmtShort(parseDate(e.date))} · pagó ${esc(nameOf(e.paidBy))}</span></div>
      <b class="num">${fmtMoney(e.amount)}</b></li>`).join('') : '<li class="empty">Los gastos de este viaje aparecen aquí y también en Gastos</li>'}</ul></div>`);
}
function setBudget() {
  const v = parseAmount($('tBudgetEdit').value);
  if (!(v >= 0)) return toast('Monto no válido');
  write(updateDoc(ref('trips', current), { budget: v })); $('tBudgetEdit').value = '';
}
async function delTrip() {
  if (!await ask('¿Borrar este viaje? Los gastos quedan en Gastos.')) return;
  write(deleteDoc(ref('trips', current))); current = null; go('s-trips');
}

on('trips expenses', () => { renderTrips(); if (current) renderTrip(); });
expose({ newTrip, editTrip, saveTrip, openTrip, tripTab, addPlan, delPlan, addPack, togglePack, delPack, setBudget, delTrip });
