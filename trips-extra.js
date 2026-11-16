// Viajes, pestañas extra de cada viaje (1.3.0): Ideas, Antes de salir, Reservas, Diario (con resumen) y el clima.
// Todo vive dentro del doc del viaje (trips/<id>): ideas[], todo[], bookings[], journal[], geo{lat,lng,name}.
// Las fotos del diario van en "photos" con id tj-<idEntrada> (+ miniatura t-tj-<idEntrada>).
import { updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, expose, toast, openSheet, closeSheet, write, ref, newRef, parseDate, today, daysBetween,
         fmtShort, fmtDay, dayKey, todayKey, fmtMoney, nameOf, partnerUid, plural, uid, loadPhotos, compressImage, makeThumb,
         thumbId, cachePhoto, getPhoto, photoError, celebrate, undoBar } from './core.js';
import { catOf } from './money.js';

const newId = () => Math.random().toString(36).slice(2, 10);
const T = id => S.data.trips.find(t => t.id === id);
const save = (t, patch) => write(updateDoc(ref('trips', t.id), patch));
const safeUrl = u => /^https?:\/\//i.test(u || '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/* ---------- Ideas: cosas que hacer allá (restaurantes, tours, playas, enlaces de redes) ---------- */
export const IDEA_KINDS = [['🍽️', 'Comer'], ['🏖️', 'Playa'], ['🥾', 'Tour o aventura'], ['🏛️', 'Visitar'], ['🍹', 'Salir'], ['🛍️', 'Compras'], ['📍', 'Otro']];
let ideaKind = '🍽️';
export function renderIdeas(t) {
  const ideas = [...(t.ideas || [])].sort((a, b) => !!a.planned - !!b.planned || score(b) - score(a) || b.at - a.at), p = partnerUid();
  paint('tripBody', `
    <div class="glass stack"><h2>Guardar una idea</h2>
      <div class="chips scroll">${IDEA_KINDS.map(([e, l]) => `<button class="chip ${ideaKind === e ? 'on' : ''}" onclick="ideaKindSet('${e}')">${e} ${l}</button>`).join('')}</div>
      <input id="idText" maxlength="80" placeholder="Ej: Cenar en la soda de la playa" aria-label="Idea">
      <input id="idUrl" type="url" placeholder="Enlace (TikTok, Instagram, Maps…) opcional" aria-label="Enlace">
      <button class="btn" onclick="addIdea('${t.id}')">${icon('plus')} Guardar idea</button></div>
    ${ideas.length ? `<div class="glass"><ul class="list">${ideas.map(i => {
      const mine = i.votes?.[uid()], theirs = p && i.votes?.[p];
      return `<li><span style="font-size:22px">${esc(i.emoji || '📍')}</span>
        <div class="txt"><span class="main">${esc(i.text)}</span><span class="sub">${esc(nameOf(i.by))}${safeUrl(i.url) ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(host(i.url) || 'enlace')}</a>` : ''}${i.planned ? ` · 📅 ${fmtShort(parseDate(i.planned))}` : ''}${theirs ? ` · a ${esc(nameOf(p))} le gusta` : ''}</span></div>
        <button class="del" aria-label="${mine ? 'Ya no me gusta' : 'Me gusta'}" style="${mine ? 'color:var(--g1)' : ''}" onclick="voteIdea('${t.id}','${i.id}')">${icon(mine ? 'heart-f' : 'heart')}</button>
        ${i.planned ? '' : `<button class="del" aria-label="Al itinerario" onclick="ideaToPlan('${t.id}','${i.id}')">${icon('cal')}</button>`}
        <button class="del" aria-label="Quitar" onclick="delIdeaT('${t.id}','${i.id}')">${icon('x')}</button></li>`;
    }).join('')}</ul></div>` : '<div class="glass center muted small">Guarden aquí lo que ven en redes o les recomiendan para este viaje. Con 📅 lo pasan a un día del plan.</div>'}`);
}
const score = i => Object.values(i.votes || {}).filter(Boolean).length;
function ideaKindSet(e) { ideaKind = e; document.querySelectorAll('#tripBody .chips .chip').forEach(b => b.classList.toggle('on', b.textContent.startsWith(e))); }
function addIdea(id) {
  const t = T(id), text = $('idText').value.trim(), url = $('idUrl').value.trim();
  if (!text && !url) return toast('Escribe la idea o pega un enlace');
  if (url && !safeUrl(url)) return toast('El enlace debe empezar con https://');
  save(t, { ideas: [...(t.ideas || []), { id: newId(), text: text || host(url) || 'Idea', url, emoji: ideaKind, by: uid(), at: Date.now(), votes: { [uid()]: true } }] });
  $('idText').value = ''; $('idUrl').value = ''; toast('Idea guardada 💡');
}
function voteIdea(id, iid) { const t = T(id); save(t, { ideas: (t.ideas || []).map(i => i.id === iid ? { ...i, votes: { ...(i.votes || {}), [uid()]: !i.votes?.[uid()] } } : i) }); }
function delIdeaT(id, iid) {
  const t = T(id), old = t.ideas || [], it = old.find(i => i.id === iid);
  save(t, { ideas: old.filter(i => i.id !== iid) });
  undoBar(`Quitaste «${it?.text || 'la idea'}»`, () => { const n = T(id); save(n, { ideas: [...(n.ideas || []), it] }); });
}
function ideaToPlan(id, iid) {
  const t = T(id), i = (t.ideas || []).find(x => x.id === iid), days = tripDays(t);
  openSheet(`<div class="stack"><h2>${esc(i.emoji)} ${esc(i.text)}</h2><p class="small muted" style="margin:0">¿Qué día lo hacen?</p>
    <div class="grid2">${days.length ? `<select id="ipDay" aria-label="Día">${days.map((d, k) => `<option value="${d}">Día ${k + 1} · ${fmtShort(parseDate(d))}</option>`).join('')}</select>` : '<input type="date" id="ipDay" aria-label="Día">'}
      <input type="time" id="ipTime" aria-label="Hora"></div>
    <button class="btn" onclick="saveIdeaPlan('${id}','${iid}')">${icon('cal')} Agregar al itinerario</button></div>`);
}
function saveIdeaPlan(id, iid) {
  const t = T(id), i = (t.ideas || []).find(x => x.id === iid), date = $('ipDay').value;
  if (!date) return toast('Elige el día');
  save(t, { plan: [...(t.plan || []), { id: newId(), date, time: $('ipTime').value, text: `${i.emoji} ${i.text}`, by: uid() }], ideas: t.ideas.map(x => x.id === iid ? { ...x, planned: date } : x) });
  closeSheet(); toast('Quedó en el plan 📅');
}
export function tripDays(t) {
  if (!t.start) return [];
  const s = parseDate(t.start), e = t.end ? parseDate(t.end) : s, out = [];
  for (let d = s; d <= e && out.length < 60; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(dayKey(d));
  return out;
}

/* ---------- Antes de salir: pendientes con responsable ---------- */
const TODO_TPL = ['Revisar que el pasaporte esté vigente', 'Cambiar plata o avisar al banco', 'Seguro de viaje', 'Check-in del vuelo', 'Quién cuida la casa o las mascotas',
  'Descargar mapas sin internet', 'Imprimir o guardar las reservas', 'Cargar el power bank', 'Sacar la basura y desconectar cosas'];
export const todoLeft = t => (t.todo || []).filter(x => !x.done).length;
export function renderTodo(t) {
  const list = t.todo || [], have = new Set(list.map(x => x.text.toLowerCase())), p = partnerUid(), done = list.filter(x => x.done).length;
  const whoTxt = w => !w || w === 'ambos' ? 'Los dos' : w === uid() ? 'Tú' : nameOf(w);
  const left = t.start ? daysBetween(today(), parseDate(t.start)) : null;
  paint('tripBody', `
    <div class="glass stack"><div class="row"><b>${done} de ${list.length} listos</b>${left !== null && left > 0 ? `<span class="pill">faltan ${plural(left, 'día', 'días')}</span>` : ''}</div>
      <div class="progress"><i style="width:${list.length ? Math.round(done / list.length * 100) : 0}%"></i></div>
      <div class="add-row"><input id="tdText" maxlength="80" placeholder="Algo que hacer antes de salir" aria-label="Pendiente" onkeydown="if(event.key==='Enter')addTodo('${t.id}')">
        <button class="btn" aria-label="Agregar" onclick="addTodo('${t.id}')">${icon('plus')}</button></div>
      <select id="tdWho" aria-label="¿Quién?"><option value="ambos">Los dos</option><option value="${uid()}">Yo</option>${p ? `<option value="${p}">${esc(nameOf(p))}</option>` : ''}</select>
      <div class="chips scroll">${TODO_TPL.filter(x => !have.has(x.toLowerCase())).map(x => `<button class="chip" onclick="addTodo('${t.id}', this.dataset.t)" data-t="${esc(x)}">${icon('plus')} ${esc(x)}</button>`).join('')}</div>
      <p class="tiny muted" style="margin:0">Les llega un aviso 30 días, 7 días y 1 día antes del viaje con lo que falta.</p></div>
    <div class="glass"><ul class="list">${list.length ? [...list].sort((a, b) => a.done - b.done).map(x => `<li class="${x.done ? 'done' : ''}" data-swr="todoToggle|${t.id}:${x.id}">
      <button class="check-btn" aria-label="${x.done ? 'Desmarcar' : 'Marcar listo'}" onclick="todoToggle('${t.id}:${x.id}')">${x.done ? icon('check') : ''}</button>
      <div class="txt"><span class="main">${esc(x.text)}</span><span class="sub">${esc(whoTxt(x.who))}${x.done && x.doneBy ? ` · lo hizo ${esc(nameOf(x.doneBy))}` : ''}</span></div>
      <button class="del" aria-label="Quitar" onclick="delTodo('${t.id}','${x.id}')">${icon('x')}</button></li>`).join('') : '<li class="empty">Toquen las sugerencias de arriba para empezar</li>'}</ul></div>`);
}
function addTodo(id, text) {
  const t = T(id), v = (text ?? $('tdText').value).trim(); if (!v) return;
  save(t, { todo: [...(t.todo || []), { id: newId(), text: v, who: $('tdWho')?.value || 'ambos', done: false }] });
  if (text === undefined) $('tdText').value = '';
}
function todoToggle(key) {
  const [id, xid] = key.split(':'), t = T(id); if (!t) return;
  save(t, { todo: (t.todo || []).map(x => x.id === xid ? { ...x, done: !x.done, doneBy: x.done ? null : uid() } : x) });
}
function delTodo(id, xid) { const t = T(id); save(t, { todo: (t.todo || []).filter(x => x.id !== xid) }); }

/* ---------- Reservas a mano (funcionan sin internet: quedan en el teléfono) ---------- */
const BOOK_KINDS = [['🏨', 'Hospedaje'], ['✈️', 'Vuelo'], ['🚗', 'Carro'], ['🚌', 'Bus o traslado'], ['🎟️', 'Tour o entrada'], ['🍽️', 'Restaurante'], ['📄', 'Otro']];
export function renderBookings(t) {
  const list = [...(t.bookings || [])].sort((a, b) => (a.when || '9').localeCompare(b.when || '9'));
  paint('tripBody', `
    <button class="btn" onclick="bookForm('${t.id}')">${icon('plus')} Agregar reserva</button>
    ${list.length ? list.map(b => `<div class="glass stack" style="gap:6px">
      <div class="row"><b>${esc(b.kind || '📄')} ${esc(b.name)}</b><button class="del" aria-label="Editar" onclick="bookForm('${t.id}','${b.id}')">${icon('edit')}</button></div>
      ${b.when ? `<span class="small">🕒 ${esc(fmtWhen(b.when))}${b.until ? ` → ${esc(fmtWhen(b.until))}` : ''}</span>` : ''}
      ${b.code ? `<div class="book-code"><span class="tiny muted">Código</span><b>${esc(b.code)}</b><button class="link" onclick="copyText('${esc(b.code)}')">Copiar</button></div>` : ''}
      ${b.address ? `<a class="small" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">📍 ${esc(b.address)}</a>` : ''}
      ${b.phone ? `<a class="small" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(b.phone)}</a>` : ''}
      ${b.note ? `<span class="small muted">${esc(b.note)}</span>` : ''}</div>`).join('')
      : '<div class="glass center muted small">Guarden aquí los códigos de reserva, horas de check-in, direcciones y teléfonos. Se pueden ver sin internet.</div>'}
    <p class="tiny muted center" style="margin:0">🔒 No guarden números de pasaporte, de tarjeta ni contraseñas.</p>`);
}
const fmtWhen = w => { const d = new Date(w); return isNaN(d) ? w : d.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
function bookForm(id, bid) {
  const t = T(id), b = (t.bookings || []).find(x => x.id === bid) || {};
  openSheet(`<div class="stack"><h2>${bid ? 'Editar reserva' : 'Nueva reserva'}</h2>
    <select id="bkKind" aria-label="Tipo">${BOOK_KINDS.map(([e, l]) => `<option value="${e}" ${b.kind === e ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select>
    <input id="bkName" maxlength="70" placeholder="Nombre (hotel, aerolínea, tour…)" value="${esc(b.name || '')}" aria-label="Nombre">
    <input id="bkCode" maxlength="40" placeholder="Código de reserva" value="${esc(b.code || '')}" aria-label="Código de reserva" autocapitalize="characters">
    <div class="grid2"><div><label class="f" for="bkWhen">Desde / check-in</label><input type="datetime-local" id="bkWhen" value="${esc(b.when || '')}"></div>
      <div><label class="f" for="bkUntil">Hasta / check-out</label><input type="datetime-local" id="bkUntil" value="${esc(b.until || '')}"></div></div>
    <input id="bkAddr" maxlength="140" placeholder="Dirección" value="${esc(b.address || '')}" aria-label="Dirección">
    <input id="bkPhone" maxlength="30" inputmode="tel" placeholder="Teléfono" value="${esc(b.phone || '')}" aria-label="Teléfono">
    <input id="bkNote" maxlength="160" placeholder="Nota (ej. desayuno incluido)" value="${esc(b.note || '')}" aria-label="Nota">
    <button class="btn" onclick="saveBook('${id}','${bid || ''}')">Guardar</button>
    ${bid ? `<button class="btn ghost danger" onclick="delBook('${id}','${bid}')">${icon('trash')} Quitar</button>` : ''}</div>`);
}
function saveBook(id, bid) {
  const t = T(id), name = $('bkName').value.trim(); if (!name) return toast('Ponle nombre a la reserva');
  const data = { kind: $('bkKind').value, name, code: $('bkCode').value.trim(), when: $('bkWhen').value, until: $('bkUntil').value, address: $('bkAddr').value.trim(), phone: $('bkPhone').value.trim(), note: $('bkNote').value.trim() };
  const list = t.bookings || [];
  save(t, { bookings: bid ? list.map(x => x.id === bid ? { ...x, ...data } : x) : [...list, { id: newId(), by: uid(), ...data }] });
  closeSheet(); toast('Reserva guardada');
}
function delBook(id, bid) {
  const t = T(id), it = (t.bookings || []).find(x => x.id === bid);
  save(t, { bookings: (t.bookings || []).filter(x => x.id !== bid) }); closeSheet();
  undoBar(`Quitaste «${it?.name || 'la reserva'}»`, () => { const n = T(id); save(n, { bookings: [...(n.bookings || []), it] }); });
}
function copyText(s) { navigator.clipboard?.writeText(s).then(() => toast('Copiado 📋'), () => toast(s)); }

/* ---------- Diario del viaje y resumen al final ---------- */
let jPic = null;
const jPhoto = eid => `tj-${eid}`;
export function renderJournal(t) {
  const days = tripDays(t), list = [...(t.journal || [])].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  const tk = todayKey(), defDay = days.includes(tk) ? tk : days[days.length - 1] || tk;
  const ended = t.end && t.end < tk;
  paint('tripBody', `
    ${ended || list.length ? summaryCard(t) : ''}
    <div class="glass stack"><h2>¿Qué pasó hoy?</h2>
      <label class="photo-pick" id="jPick">${icon('photo', 'ic lg')}<span>Foto (opcional)</span><input type="file" accept="image/*" hidden onchange="jPhotoPick(this)"></label>
      <textarea id="jText" rows="2" maxlength="600" placeholder="Lo mejor del día, lo que comieron, lo que no quieren olvidar…" aria-label="Nota del día"></textarea>
      ${days.length ? `<select id="jDay" aria-label="Día">${days.map((d, k) => `<option value="${d}" ${d === defDay ? 'selected' : ''}>Día ${k + 1} · ${fmtShort(parseDate(d))}</option>`).join('')}</select>` : `<input type="date" id="jDay" value="${tk}" aria-label="Día">`}
      <button class="btn" id="jSave" onclick="saveJournal('${t.id}')">Guardar en el diario</button></div>
    ${list.length ? list.map(j => `<div class="glass stack jentry" style="gap:8px">
      ${j.photo ? `<img data-thumb="${jPhoto(j.id)}" alt="" onclick="viewPhoto(this)">` : ''}
      <div class="row"><span class="tiny muted">${fmtDay(parseDate(j.date))} · ${esc(nameOf(j.by))}</span>${j.by === uid() ? `<button class="del" aria-label="Quitar" onclick="delJournal('${t.id}','${j.id}')">${icon('x')}</button>` : ''}</div>
      ${j.text ? `<p class="small" style="margin:0;white-space:pre-wrap">${esc(j.text)}</p>` : ''}</div>`).join('')
      : '<div class="glass center muted small">Durante el viaje, cada uno puede subir una foto y una nota por día. Al final les queda un resumen para guardar en Momentos.</div>'}`);
  loadPhotos($('tripBody'));
}
function summaryCard(t) {
  const days = tripDays(t), ex = S.data.expenses.filter(e => e.tripId === t.id && e.type !== 'settle'), spent = ex.reduce((s, e) => s + e.amount, 0);
  const byCat = Object.entries(ex.reduce((m, e) => (m[e.cat] = (m[e.cat] || 0) + e.amount, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const photos = (t.journal || []).filter(j => j.photo).length, plans = (t.plan || []).length;
  return `<div class="glass stack trip-sum"><span class="label">🧳 Resumen del viaje</span>
    <div class="grid3"><div><b class="num">${days.length || '—'}</b><span class="tiny muted">días</span></div><div><b class="num">${photos}</b><span class="tiny muted">fotos</span></div><div><b class="num">${plans}</b><span class="tiny muted">planes</span></div></div>
    ${spent ? `<p class="small" style="margin:0">Gastaron <b>${fmtMoney(spent)}</b>${days.length ? ` (≈ ${fmtMoney(spent / days.length)} por día)` : ''}${t.budget ? ` · presupuesto ${fmtMoney(t.budget)}` : ''}</p>
      <p class="tiny muted" style="margin:0">${byCat.map(([c, v]) => `${catOf(c)[0]} ${fmtMoney(v)}`).join(' · ')}</p>` : ''}
    ${t.savedMoment ? '<button class="btn ghost" disabled>✓ Guardado en Momentos</button>' : `<button class="btn ghost" onclick="tripToMoment('${t.id}')">📚 Guardar el viaje en Momentos</button>`}</div>`;
}
async function jPhotoPick(input) {
  const f = input.files?.[0]; input.value = ''; if (!f) return;
  const btn = $('jSave'); if (btn) { btn.disabled = true; btn.textContent = 'Preparando foto…'; }
  try {
    const full = await compressImage(f, 1080); jPic = { full, thumb: await makeThumb(full).catch(() => null) };
    const box = $('jPick'); box.querySelectorAll('svg,span,img').forEach(x => x.remove());
    const img = document.createElement('img'); img.src = full; img.alt = ''; box.prepend(img);
  } catch (e) { photoError(e); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Guardar en el diario'; } }
}
function saveJournal(id) {
  const t = T(id), text = $('jText').value.trim(); if (!text && !jPic) return toast('Escribe algo o pon una foto');
  const eid = newId(), b = writeBatch(db);
  if (jPic) {
    b.set(ref('photos', jPhoto(eid)), { data: jPic.full }); cachePhoto(jPhoto(eid), jPic.full);
    if (jPic.thumb) { b.set(ref('photos', thumbId(jPhoto(eid))), { data: jPic.thumb }); cachePhoto(thumbId(jPhoto(eid)), jPic.thumb); }
  }
  b.update(ref('trips', id), { journal: [...(t.journal || []), { id: eid, date: $('jDay').value || todayKey(), text, photo: !!jPic, by: uid(), at: Date.now() }] });
  write(b.commit()); jPic = null; toast('Guardado en el diario 📔');
}
function delJournal(id, eid) {
  const t = T(id), it = (t.journal || []).find(j => j.id === eid);
  save(t, { journal: (t.journal || []).filter(j => j.id !== eid) });
  undoBar('Quitaste la entrada del diario', () => { const n = T(id); save(n, { journal: [...(n.journal || []), it] }); },
    { later: it?.photo ? () => { const b = writeBatch(db); b.delete(ref('photos', jPhoto(eid))); b.delete(ref('photos', thumbId(jPhoto(eid)))); b.commit().catch(() => {}); } : null });
}
// Un momento con la primera foto del diario como portada y el resumen en la nota
async function tripToMoment(id) {
  const t = T(id); if (!t) return;
  const first = (t.journal || []).filter(j => j.photo).sort((a, b) => a.date.localeCompare(b.date))[0];
  const full = first ? await getPhoto(jPhoto(first.id)) : '';
  const r = newRef('moments'), b = writeBatch(db);
  if (full) { b.set(ref('photos', r.id), { data: full }); cachePhoto(r.id, full); const th = await getPhoto(thumbId(jPhoto(first.id))); if (th) b.set(ref('photos', thumbId(r.id)), { data: th }); }
  const spent = S.data.expenses.filter(e => e.tripId === t.id && e.type !== 'settle').reduce((s, e) => s + e.amount, 0);
  const lines = [`${t.dest || t.name}${t.start ? ` · ${fmtShort(parseDate(t.start))}${t.end ? ' – ' + fmtShort(parseDate(t.end)) : ''}` : ''}`, spent ? `Gastaron ${fmtMoney(spent)}` : '',
    ...(t.journal || []).filter(j => j.text).sort((a, b) => a.date.localeCompare(b.date)).map(j => `• ${j.text}`)].filter(Boolean);
  b.set(r, { title: `✈️ ${t.name}`, date: t.start || todayKey(), note: lines.join('\n').slice(0, 600), hasPhoto: !!full, place: t.geo ? { name: t.geo.name || t.dest || '', lat: t.geo.lat, lng: t.geo.lng, country: t.geo.country || '' } : null, by: uid(), createdAt: Date.now(), tripId: t.id });
  b.update(ref('trips', id), { savedMoment: r.id });
  write(b.commit()); celebrate(); toast('El viaje quedó en Momentos 📚');
}

/* ---------- Clima del destino (Open-Meteo: gratis y sin claves) ----------
   Dentro de los próximos 16 días: pronóstico. Más lejos: cómo estuvo en esas mismas fechas el año pasado. Se guarda
   en el teléfono un día (localStorage futari-wx-<viaje>) para no pedirlo a cada rato. */
const WX = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };
const wxIcon = c => WX[c] ?? (c >= 71 && c <= 77 ? '❄️' : c >= 61 ? '🌧️' : '⛅');
async function geoOf(t) {
  if (t.geo?.lat) return t.geo;
  const q = (t.dest || t.name || '').split(',')[0].trim(); if (!q) return null;
  const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(q)}`)).json();
  const g = j.results?.[0]; if (!g) return null;
  const geo = { lat: g.latitude, lng: g.longitude, name: [g.name, g.admin1].filter(Boolean).join(', '), country: g.country || '' };
  write(updateDoc(ref('trips', t.id), { geo })); return geo;
}
export async function loadWeather(t) {
  const days = tripDays(t); if (!days.length) return null;
  const k = 'futari-wx-' + t.id;
  try { const c = JSON.parse(localStorage.getItem(k)); if (c && c.day === todayKey() && c.from === days[0] && c.to === days[days.length - 1]) return c; } catch {}
  const geo = await geoOf(t); if (!geo) return null;
  const until = daysBetween(today(), parseDate(days[0])), soon = until <= 14 && daysBetween(today(), parseDate(days[days.length - 1])) <= 15;
  let from = days[0], to = days[days.length - 1], url;
  if (soon) url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${from < todayKey() ? todayKey() : from}&end_date=${to}`;
  else {
    const back = d => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`; // las mismas fechas, un año antes
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${back(from)}&end_date=${back(to)}`;
  }
  const j = await (await fetch(url)).json(); if (!j.daily?.time) return null;
  const d = j.daily, rows = d.time.map((_, i) => ({ code: d.weather_code[i], max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], rain: soon ? d.precipitation_probability_max?.[i] ?? null : (d.precipitation_sum?.[i] > 1 ? 70 : 0) }));
  const out = { day: todayKey(), from, to, soon, place: geo.name, rows, start: soon && from < todayKey() ? todayKey() : from };
  try { localStorage.setItem(k, JSON.stringify(out)); } catch {}
  return out;
}
export function weatherHTML(w) {
  if (!w?.rows?.length) return '';
  const max = Math.round(Math.max(...w.rows.map(r => r.max))), min = Math.round(Math.min(...w.rows.map(r => r.min))), rainy = w.rows.filter(r => r.rain >= 50).length;
  const s = parseDate(w.start);
  return `<div class="glass stack wx"><div class="row"><span class="label">${w.soon ? '🌦️ Pronóstico' : '🌦️ Cómo suele estar'} · ${esc(w.place || '')}</span></div>
    <div class="wx-days">${w.rows.slice(0, 10).map((r, i) => { const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i); return `<div><span class="tiny muted">${w.soon ? d.toLocaleDateString('es', { weekday: 'short' }).replace('.', '') : d.getDate()}</span><b>${wxIcon(r.code)}</b><span class="tiny">${Math.round(r.max)}°</span><span class="tiny muted">${Math.round(r.min)}°</span></div>`; }).join('')}</div>
    <p class="tiny muted" style="margin:0">${w.soon ? '' : 'Todavía falta para el pronóstico: esto es cómo estuvo en esas fechas el año pasado. '}Entre ${min}° y ${max}°${rainy ? ` · ${plural(rainy, 'día', 'días')} con lluvia` : ' · casi sin lluvia'}.</p></div>`;
}
// Sugerencias para la maleta según el clima
export function weatherPack(w) {
  if (!w?.rows?.length) return [];
  const max = Math.max(...w.rows.map(r => r.max)), min = Math.min(...w.rows.map(r => r.min)), rainy = w.rows.some(r => r.rain >= 50);
  return [rainy && ['☔', 'Sombrilla o capa'], max >= 27 && ['🧴', 'Bloqueador'], max >= 27 && ['🩳', 'Ropa fresca'], min <= 14 && ['🧥', 'Abrigo'], min <= 8 && ['🧣', 'Bufanda y guantes'], rainy && ['👟', 'Zapatos que se puedan mojar']].filter(Boolean);
}

expose({ ideaKindSet, addIdea, voteIdea, delIdeaT, ideaToPlan, saveIdeaPlan, addTodo, todoToggle, delTodo, bookForm, saveBook, delBook, copyText,
  jPhotoPick, saveJournal, delJournal, tripToMoment });
