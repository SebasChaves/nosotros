// ⚽ Mejengas (1.20.0, pantalla s-mejengas en Más): los partidos de fútbol del que juega (cfg.player; por defecto el
// dueño) con marcador en vivo que normalmente lleva su pareja (los dos pueden tocarlo).
//   - Agendar: día, hora, cancha (location.js), equipos y colores, costo. Crea también un plan en el calendario
//     (events, con mejenga: id) para que salga en «Hoy» y tenga recordatorio del Worker.
//   - Marcador en vivo: cronómetro (clock = { start, acc, half, running }), +1 por equipo, «gol de <jugador>», momentos
//     (tarjeta, atajadón, lesión, jugada chistosa, jugadón), deshacer y pitazo final. Todo va en `events` del partido y
//     el marcador (a, b) se recalcula de ahí. Se ve en vivo en los dos teléfonos.
//   - Animaciones: cuando llega un evento nuevo (de cualquiera de los dos teléfonos) sale ¡GOOOL!, el golazo del jugador
//     o el pitazo final (fx()). Los eventos viejos no se animan.
//   - Después: calificación 1-10, jugada de la noche, foto (también a Momentos), costo → Gastos; estadísticas y logros.
// Datos: mejengas/cfg = { player, nick, teamA, teamB, colorA, colorB }; mejengas/<id> = { date, time, place, teamA, teamB,
// colorA, colorB, cost, status agendada|envivo|final, a, b, events[{ t, team?, mine?, min, at, by }], clock, eventId,
// rating, play, photo, costDone, by, createdAt, startedAt, endedAt }.
import { setDoc, updateDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, todayKey, parseDate, fmtShort,
         nameOf, partnerUid, uid, plural, avatar, ask, celebrate, markActive, cachePhoto, compressImage, photoError, makeThumb, thumbId, loadPhotos, softDelete, go } from './core.js';
import { backBar } from './lists.js';
import { placeField, initPlace, getPlace } from './location.js';
import { isOwner } from './gifts.js';
import { notify, meForPartner } from './push.js';

const COLORS = [['#E63946', 'Rojo'], ['#2F6FED', 'Azul'], ['#1E9E5A', 'Verde'], ['#F4B400', 'Amarillo'], ['#7B2FF7', 'Morado'], ['#111827', 'Negro'], ['#F5F5F5', 'Blanco'], ['#FF7A1A', 'Naranja']];
const MOMENTS = [['card', '🟨', 'Tarjeta'], ['save', '🧤', 'Atajadón'], ['hurt', '🤕', 'Lesión'], ['funny', '😂', 'Jugada chistosa'], ['wow', '💥', 'Jugadón']];
const cfg = () => S.data.mejengas?.find(d => d.id === 'cfg') || {};
export const playerUid = () => cfg().player || (isOwner() ? uid() : partnerUid()) || uid();
const realName = u => S.settings.members?.[u]?.name || 'Yo';
export const playerName = () => cfg().nick || nameOf(playerUid());
const imPlayer = () => playerUid() === uid();
export const matches = () => (S.data.mejengas || []).filter(d => d.id !== 'cfg');
export const liveMatch = () => matches().find(m => m.status === 'envivo');
const finals = () => matches().filter(m => m.status === 'final').sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
const upcoming = () => matches().filter(m => m.status === 'agendada' && m.date >= todayKey()).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
const score = m => { const ev = m.events || []; return { a: ev.filter(e => e.t === 'goal' && e.team === 'a').length, b: ev.filter(e => e.t === 'goal' && e.team === 'b').length }; };
const myGoals = m => (m.events || []).filter(e => e.t === 'goal' && e.mine).length;
const result = m => { const s = score(m); return s.a > s.b ? 'G' : s.a < s.b ? 'P' : 'E'; };
const RES = { G: ['✅', 'Ganaron', 'win'], E: ['🤝', 'Empate', 'draw'], P: ['❌', 'Perdieron', 'loss'] };
const elapsed = m => { const c = m.clock || {}; return (c.acc || 0) + (c.running && c.start ? Date.now() - c.start : 0); };
const clockTxt = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const curMin = m => Math.floor(elapsed(m) / 60000) + 1;
const hh = t => { if (!t) return ''; const [h, mm] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`; };
const dayTxt = d => d === todayKey() ? 'Hoy' : fmtShort(parseDate(d));
const contrast = c => /^#(F5F5F5|F4B400)$/i.test(c) ? '#111' : '#fff';

/* ---------- Estadísticas y logros ---------- */
export function mjStats() {
  const f = [...finals()].reverse(); // del más viejo al más nuevo
  const st = { pj: f.length, g: 0, e: 0, p: 0, goals: 0, best: null, run: 0, bestRun: 0, clean: 0, hat: 0, rout: 0, byPlace: {}, byMonth: {} };
  for (const m of f) {
    const r = result(m), s = score(m), mg = myGoals(m);
    st[r === 'G' ? 'g' : r === 'E' ? 'e' : 'p']++;
    st.goals += mg; if (mg >= 3) st.hat++;
    if (s.b === 0) st.clean++; if (s.a - s.b >= 5) st.rout++;
    st.run = r === 'G' ? st.run + 1 : 0; st.bestRun = Math.max(st.bestRun, st.run);
    if (!st.best || mg > myGoals(st.best) || (mg === myGoals(st.best) && s.a - s.b > score(st.best).a - score(st.best).b)) st.best = m;
    const pn = m.place?.name; if (pn) st.byPlace[pn] = (st.byPlace[pn] || 0) + 1;
    const mo = m.date.slice(0, 7); st.byMonth[mo] = (st.byMonth[mo] || 0) + mg;
  }
  return st;
}
const LOGROS = [
  ['first', '🥅', 'Primer gol', s => s.goals >= 1], ['hat', '🎩', 'Hat-trick', s => s.hat >= 1], ['pj10', '🔟', '10 mejengas', s => s.pj >= 10],
  ['pj25', '🏟️', '25 mejengas', s => s.pj >= 25], ['pj50', '👑', '50 mejengas', s => s.pj >= 50], ['g10', '⚽', '10 goles', s => s.goals >= 10],
  ['g50', '🔥', '50 goles', s => s.goals >= 50], ['run3', '📈', '3 ganadas seguidas', s => s.bestRun >= 3], ['run5', '🚀', '5 ganadas seguidas', s => s.bestRun >= 5],
  ['clean', '🧱', 'Valla invicta', s => s.clean >= 1], ['rout', '🤯', 'Goleada (por 5 o más)', s => s.rout >= 1],
];
const unlocked = (s = mjStats()) => LOGROS.filter(l => l[3](s)).map(l => l[0]);

/* ---------- Animaciones ---------- */
function fx(kind, m, extra = {}) {
  document.querySelector('.mj-fx')?.remove();
  const el = document.createElement('div'), col = extra.color || m?.colorA || '#E63946';
  el.className = `mj-fx ${kind}`; el.style.setProperty('--c', col); el.setAttribute('aria-hidden', 'true');
  if (kind === 'goal') el.innerHTML = `<div class="mj-net"></div><div class="mj-ball">⚽</div><div class="mj-big">¡GOOOL!</div><div class="mj-sub">${esc(extra.team || '')}</div>`;
  else if (kind === 'mine') el.innerHTML = `<div class="mj-rays"></div><div class="mj-face">${avatar(playerUid(), 120)}</div><div class="mj-big">¡GOLAZO!</div><div class="mj-sub">de ${esc(playerName())} ⚽</div>`;
  else if (kind === 'rival') el.innerHTML = `<div class="mj-ball small">⚽</div><div class="mj-big small">Gol de ${esc(extra.team || 'los rivales')}</div><div class="mj-sub">😬 ¡A remontar!</div>`;
  else if (kind === 'final') { const r = RES[extra.r]; el.innerHTML = `<div class="mj-whistle">📣</div><div class="mj-big">¡PITAZO FINAL!</div><div class="mj-score">${extra.a} – ${extra.b}</div><div class="mj-sub">${r[0]} ${extra.r === 'G' ? '¡Ganaron!' : extra.r === 'E' ? 'Empate' : 'Perdieron… la próxima 💪'}</div>`; }
  else el.innerHTML = `<div class="mj-pop">${extra.e}</div><div class="mj-sub">${esc(extra.label)}</div>`;
  document.body.appendChild(el);
  loadPhotos(el);
  if (kind === 'goal' || kind === 'mine') { celebrate(); navigator.vibrate?.([80, 40, 160]); }
  if (kind === 'final' && extra.r === 'G') celebrate();
  if (kind === 'final' && extra.r === 'E') celebrate('hearts');
  setTimeout(() => el.classList.add('out'), kind === 'final' ? 3200 : kind === 'pop' ? 1300 : 2300);
  setTimeout(() => el.remove(), kind === 'final' ? 3700 : kind === 'pop' ? 1700 : 2800);
}
// Eventos nuevos (de cualquiera de los dos): se animan si son recientes. Lo que ya estaba al abrir la app, no.
const seen = {}; let primed = false;
function watchEvents() {
  for (const m of matches()) {
    const ev = m.events || [], before = seen[m.id];
    seen[m.id] = ev.length;
    if (!primed || before === undefined) { if (m.status === 'final') seen[m.id + ':f'] = true; continue; }
    if (ev.length > before) {
      const e = ev[ev.length - 1]; if (Date.now() - e.at > 25000) continue;
      if (e.t === 'goal') fx(e.mine ? 'mine' : e.team === 'a' ? 'goal' : 'rival', m, { team: e.team === 'a' ? m.teamA : m.teamB, color: e.team === 'a' ? m.colorA : m.colorB });
      else { const k = MOMENTS.find(x => x[0] === e.t); if (k) fx('pop', m, { e: k[1], label: `${k[2]}${e.mine ? ' de ' + playerName() : ''}` }); }
    }
    if (m.status === 'final' && !seen[m.id + ':f']) { seen[m.id + ':f'] = true; if (Date.now() - (m.endedAt || 0) < 30000) { const s = score(m); fx('final', m, { a: s.a, b: s.b, r: result(m) }); } }
  }
  primed = true;
}

/* ---------- Tarjeta de Inicio y avisos ---------- */
export function mejengaCard() {
  const live = liveMatch();
  if (live) { const s = score(live); return `<div class="glass stack mj-homecard" role="button" onclick="mjOpen('${live.id}')"><div class="row"><span class="label">⚽ Mejenga</span><span class="pill hot">🔴 EN VIVO</span></div>
    <div class="mj-mini"><span style="--c:${live.colorA}">${esc(live.teamA)}</span><b class="num">${s.a} – ${s.b}</b><span style="--c:${live.colorB}">${esc(live.teamB)}</span></div>
    <span class="tiny muted center">${imPlayer() ? 'Tu pareja lleva el marcador' : 'Toca para llevar el marcador'} · <span class="mj-clock-mini" data-mj="${live.id}">${clockTxt(elapsed(live))}</span></span></div>`; }
  const today = upcoming().find(m => m.date === todayKey());
  if (today) return `<div class="glass stack" role="button" onclick="go('s-mejengas')"><div class="row"><span class="label">⚽ Hoy hay mejenga</span><span class="pill">${hh(today.time) || 'hoy'}</span></div>
    <span class="small">${esc(today.teamA)} vs ${esc(today.teamB)}${today.place ? ` · 📍 ${esc(today.place.name)}` : ''}</span>
    <button class="btn small" onclick="event.stopPropagation();mjStart('${today.id}')">▶️ Empezar el marcador</button></div>`;
  const last = finals()[0];
  if (last && Date.now() - (last.endedAt || 0) < 14 * 3600e3) { const s = score(last), r = RES[result(last)], g = myGoals(last); return `<div class="glass stack" role="button" onclick="mjSummary('${last.id}')"><div class="row"><span class="label">⚽ Final de la mejenga</span><span class="pill">${r[0]} ${r[1]}</span></div>
    <div class="mj-mini"><span style="--c:${last.colorA}">${esc(last.teamA)}</span><b class="num">${s.a} – ${s.b}</b><span style="--c:${last.colorB}">${esc(last.teamB)}</span></div>
    ${g ? `<span class="small center">⚽ ${esc(playerName())} metió ${plural(g, 'gol', 'goles')}</span>` : ''}</div>`; }
  return '';
}
export function mejengaAlerts() {
  const live = liveMatch(), out = [];
  if (live && !imPlayer()) out.push({ key: 'mj-live', e: '⚽', text: `<b>La mejenga ya empezó</b>: lleva el marcador`, short: 'Mejenga en vivo', run: () => mjOpen(live.id) });
  const last = finals()[0];
  if (last && !imPlayer() && !last.rating && Date.now() - (last.endedAt || 0) < 24 * 3600e3) out.push({ key: 'mj-rate', e: '⭐', text: `Califica cómo jugó ${esc(playerName())} en la mejenga`, short: 'Calificar la mejenga', run: () => mjSummary(last.id) });
  return out;
}
export const mejengaSub = () => { const live = liveMatch(); if (live) { const s = score(live); return `🔴 En vivo ${s.a} – ${s.b}`; } const n = upcoming()[0]; if (n) return `Próxima: ${dayTxt(n.date)}${n.time ? ' ' + hh(n.time) : ''}`; const st = mjStats(); return st.pj ? `${plural(st.pj, 'partido', 'partidos')} · ${plural(st.goals, 'gol', 'goles')}` : 'Partidos y marcador en vivo'; };

/* ---------- Pantalla ---------- */
let liveId = null;
function render() {
  // (al empezar, el estado «envivo» puede tardar un instante en llegar: mientras no sea «final» se queda en el marcador)
  const lm = liveId && matches().find(m => m.id === liveId);
  if (lm && lm.status !== 'final') return renderLive();
  liveId = null;
  const live = liveMatch(), next = upcoming(), st = mjStats(), list = finals(), got = unlocked(st);
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const mx = Math.max(1, ...months.map(k => st.byMonth[k] || 0));
  const places = Object.entries(st.byPlace).sort((a, b) => b[1] - a[1]).slice(0, 3);
  paint('s-mejengas', `${backBar('Mejengas', 's-more', `<button class="btn small" onclick="mjNew()">${icon('plus')} Agendar</button>`)}
    ${live ? `<div class="glass stack mj-homecard" role="button" onclick="mjOpen('${live.id}')"><div class="row"><span class="label">🔴 En vivo</span><span class="mj-clock-mini" data-mj="${live.id}">${clockTxt(elapsed(live))}</span></div>
      <div class="mj-mini"><span style="--c:${live.colorA}">${esc(live.teamA)}</span><b class="num">${score(live).a} – ${score(live).b}</b><span style="--c:${live.colorB}">${esc(live.teamB)}</span></div>
      <button class="btn">Abrir el marcador</button></div>`
      : `<button class="btn ghost" onclick="mjQuick()">⚡ Empezar una mejenga ya</button>`}
    ${next.length ? `<span class="label">Próximas</span>${next.slice(0, 4).map(m => `<div class="glass stack" style="gap:8px"><div class="row"><span class="small"><b>${dayTxt(m.date)}</b>${m.time ? ' · ' + hh(m.time) : ''}</span>
        <span class="row" style="gap:2px"><button class="del" aria-label="Editar" onclick="mjNew('${m.id}')">${icon('edit')}</button><button class="del" aria-label="Borrar" onclick="mjDel('${m.id}')">${icon('trash')}</button></span></div>
      <span class="small">${esc(m.teamA)} vs ${esc(m.teamB)}${m.place ? ` · 📍 ${esc(m.place.name)}` : ''}</span>
      ${m.date === todayKey() && !live ? `<button class="btn small" onclick="mjStart('${m.id}')">▶️ Empezar el marcador</button>` : ''}</div>`).join('')}` : ''}
    <div class="glass stack"><div class="row"><span class="label">📊 ${esc(playerName())} en la cancha</span><button class="link" onclick="mjCfg()">Ajustes</button></div>
      <div class="mj-kpis"><div><b class="num">${st.pj}</b><span class="tiny muted">jugados</span></div><div><b class="num">${st.g}</b><span class="tiny muted">✅ ganados</span></div>
        <div><b class="num">${st.e}</b><span class="tiny muted">🤝 empates</span></div><div><b class="num">${st.p}</b><span class="tiny muted">❌ perdidos</span></div></div>
      <div class="row"><span class="small">⚽ <b>${plural(st.goals, 'gol', 'goles')}</b>${st.pj ? ` · ${(st.goals / st.pj).toFixed(1)} por partido` : ''}</span><span class="small">📈 Mejor racha: ${st.bestRun}</span></div>
      ${st.best && myGoals(st.best) ? `<button class="link" style="text-align:left" onclick="mjSummary('${st.best.id}')">🌟 Mejor partido: ${plural(myGoals(st.best), 'gol', 'goles')} el ${fmtShort(parseDate(st.best.date))}</button>` : ''}
      ${places.length ? `<span class="tiny muted">📍 ${places.map(([n, c]) => `${esc(n)} (${c})`).join(' · ')}</span>` : ''}
      ${st.goals ? `<div class="mj-chart">${months.map(k => `<div><i style="height:${Math.round((st.byMonth[k] || 0) / mx * 100)}%"></i><b class="tiny">${st.byMonth[k] || ''}</b><span class="tiny muted">${parseDate(k + '-01').toLocaleDateString('es', { month: 'short' }).replace('.', '')}</span></div>`).join('')}</div><span class="tiny muted center">Goles por mes</span>` : ''}</div>
    <div class="glass stack"><span class="label">🏅 Logros (${got.length} de ${LOGROS.length})</span>
      <div class="mj-logros">${LOGROS.map(([k, e, l]) => `<div class="${got.includes(k) ? 'on' : ''}"><span>${got.includes(k) ? e : '🔒'}</span><span class="tiny">${l}</span></div>`).join('')}</div></div>
    <span class="label">Historial</span>
    ${list.length ? `<ul class="list">${list.slice(0, 40).map(m => { const s = score(m), r = RES[result(m)], g = myGoals(m); return `<li role="button" tabindex="0" style="cursor:pointer" onclick="mjSummary('${m.id}')"><div class="txt"><span class="small"><span class="mj-res ${r[2]}">${r[0]}</span> <b>${s.a} – ${s.b}</b> · ${esc(m.teamB)}</span>
      <span class="sub">${fmtShort(parseDate(m.date))}${m.place ? ' · ' + esc(m.place.name) : ''}${g ? ` · ⚽×${g}` : ''}${m.rating ? ` · ⭐ ${m.rating}` : ''}</span></div>${icon('send')}</li>`; }).join('')}</ul>`
      : '<p class="empty">Cuando terminen la primera mejenga, aquí queda el resultado ⚽</p>'}`);
}

/* ---------- Agendar / editar ---------- */
let pickA = null, pickB = null;
function mjNew(id) {
  const m = id ? matches().find(x => x.id === id) : null, c = cfg();
  pickA = m?.colorA || c.colorA || COLORS[0][0]; pickB = m?.colorB || c.colorB || COLORS[1][0];
  const sw = (side, cur) => `<div class="mj-colors" data-side="${side}">${COLORS.map(([h, n]) => `<button class="${cur === h ? 'on' : ''}" data-h="${h}" style="background:${h}" aria-label="${n}" onclick="mjColor('${side}','${h}')"></button>`).join('')}</div>`;
  openSheet(`<div class="stack"><h2>${m ? 'Editar mejenga' : '⚽ Agendar mejenga'}</h2>
    <div class="grid2"><div><label class="f" for="mjDate">Día</label><input id="mjDate" type="date" value="${m?.date || todayKey()}"></div>
      <div><label class="f" for="mjTime">Hora</label><input id="mjTime" type="time" value="${m?.time || '20:00'}"></div></div>
    <label class="f">Cancha</label>${placeField('mjPlace')}
    <label class="f" for="mjA">Equipo de ${esc(nameOf(playerUid()))}</label><input id="mjA" maxlength="24" value="${esc(m?.teamA || c.teamA || `Equipo de ${realName(playerUid())}`)}">${sw('a', pickA)}
    <label class="f" for="mjB">Rivales</label><input id="mjB" maxlength="24" value="${esc(m?.teamB || c.teamB || 'Rivales')}">${sw('b', pickB)}
    <label class="f" for="mjCost">Costo de la cancha (opcional)</label><input id="mjCost" type="number" inputmode="decimal" min="0" value="${m?.cost || ''}" placeholder="Lo que pagas tú">
    <button class="btn" onclick="mjSave('${m?.id || ''}')">${m ? 'Guardar' : 'Agendar'}</button></div>`);
  initPlace('mjPlace', m?.place || null);
}
function mjColor(side, h) {
  if (side === 'a') pickA = h; else pickB = h;
  document.querySelectorAll(`#sheet .mj-colors[data-side="${side}"] button`).forEach(b => b.classList.toggle('on', b.dataset.h === h));
}
function mjSave(id) {
  const date = $('mjDate').value; if (!date) return toast('Elige el día');
  const data = { date, time: $('mjTime').value || '', place: getPlace('mjPlace'), teamA: $('mjA').value.trim() || 'Mi equipo', teamB: $('mjB').value.trim() || 'Rivales',
    colorA: pickA, colorB: pickB, cost: Number($('mjCost').value) || 0 };
  const b = writeBatch(db), m = id ? matches().find(x => x.id === id) : null;
  const mid = m ? m.id : newRef('mejengas').id, evId = m?.eventId || newRef('events').id;
  const ev = { title: `⚽ Mejenga: ${data.teamA} vs ${data.teamB}`, date, time: data.time, who: 'ambos', note: data.place?.name || '', repeat: 'none', until: '', remind: '60', mejenga: mid };
  if (m) { b.update(ref('mejengas', mid), data); b.set(ref('events', evId), { ...ev, editedBy: uid(), editedAt: Date.now() }, { merge: true }); if (!m.eventId) b.update(ref('mejengas', mid), { eventId: evId }); }
  else { b.set(ref('mejengas', mid), { ...data, status: 'agendada', events: [], a: 0, b: 0, eventId: evId, by: uid(), createdAt: Date.now() }); b.set(ref('events', evId), { ...ev, by: uid(), createdAt: Date.now() }); }
  b.set(ref('mejengas', 'cfg'), { teamA: data.teamA, teamB: data.teamB, colorA: pickA, colorB: pickB, player: playerUid() }, { merge: true });
  write(b.commit()); closeSheet(); toast(m ? 'Mejenga actualizada' : '⚽ Mejenga agendada (también en el calendario)');
  if (!m) notify('mejenga', { title: `⚽ ${meForPartner()} agendó una mejenga`, body: `${dayTxt(date)}${data.time ? ' a las ' + hh(data.time) : ''}${data.place ? ' · ' + data.place.name : ''}`, url: './?open=mejenga', tag: 'mj-' + mid });
}
function mjDel(id) {
  const m = matches().find(x => x.id === id); if (!m) return;
  softDelete('mejengas', id, 'la mejenga');
  if (m.eventId) write(deleteDoc(ref('events', m.eventId)));
}

/* ---------- Marcador en vivo ---------- */
function mjQuick() {
  const c = cfg(), mid = newRef('mejengas').id;
  write(setDoc(ref('mejengas', mid), { date: todayKey(), time: new Date().toTimeString().slice(0, 5), place: null, teamA: c.teamA || `Equipo de ${realName(playerUid())}`, teamB: c.teamB || 'Rivales',
    colorA: c.colorA || COLORS[0][0], colorB: c.colorB || COLORS[1][0], cost: 0, status: 'agendada', events: [], a: 0, b: 0, by: uid(), createdAt: Date.now() }));
  setTimeout(() => mjStart(mid), 300);
}
function mjStart(id) {
  const m = matches().find(x => x.id === id); if (!m) return;
  if (liveMatch() && liveMatch().id !== id) return toast('Ya hay una mejenga en vivo');
  if (m.status !== 'envivo') {
    write(updateDoc(ref('mejengas', id), { status: 'envivo', startedAt: Date.now(), keeper: uid(), clock: { start: Date.now(), acc: 0, half: 1, running: true } }));
    markActive();
    if (imPlayer()) notify('mejenga', { title: '⚽ ¡Empezó la mejenga!', body: `${m.teamA} vs ${m.teamB}: ¿llevas el marcador?`, url: './?open=mejenga', tag: 'mj-' + id });
  }
  liveId = id; go('s-mejengas'); render();
}
function mjOpen(id) { liveId = id; go('s-mejengas'); render(); }
function mjBack() { liveId = null; render(); }
let lastScore = {};
function renderLive() {
  const m = matches().find(x => x.id === liveId); if (!m) { liveId = null; return render(); }
  const s = score(m), c = m.clock || {}, ev = [...(m.events || [])].reverse();
  const bumpA = lastScore.id === m.id && s.a !== lastScore.a, bumpB = lastScore.id === m.id && s.b !== lastScore.b;
  lastScore = { id: m.id, a: s.a, b: s.b };
  paint('s-mejengas', `<div class="topbar"><div class="row start"><button class="icon-btn" aria-label="Volver" onclick="mjBack()">${icon('back')}</button><h1>Marcador</h1></div><span class="pill hot">🔴 EN VIVO</span></div>
    <div class="mj-clockbox"><span class="mj-half">${c.half === 2 ? '2.º tiempo' : '1.er tiempo'}</span><b class="mj-clock" id="mjClock">${clockTxt(elapsed(m))}</b>
      <div class="row" style="gap:8px;justify-content:center"><button class="btn small ghost" onclick="mjClock('${m.id}')">${c.running ? '⏸ Pausar' : '▶️ Seguir'}</button>${c.half !== 2 ? `<button class="btn small ghost" onclick="mjHalf('${m.id}')">🔁 Medio tiempo</button>` : ''}</div></div>
    <div class="mj-board">
      <div class="mj-team" style="--c:${m.colorA};--t:${contrast(m.colorA)}"><span class="mj-name">${esc(m.teamA)}</span><b class="mj-num ${bumpA ? 'bump' : ''}">${s.a}</b>
        <button class="mj-plus" onclick="mjGoal('${m.id}','a',false)">+1 GOL</button><button class="mj-mine" onclick="mjGoal('${m.id}','a',true)">⚽ De ${esc(playerName())}</button></div>
      <div class="mj-team" style="--c:${m.colorB};--t:${contrast(m.colorB)}"><span class="mj-name">${esc(m.teamB)}</span><b class="mj-num ${bumpB ? 'bump' : ''}">${s.b}</b>
        <button class="mj-plus" onclick="mjGoal('${m.id}','b',false)">+1 GOL</button></div></div>
    <div class="chips scroll">${MOMENTS.map(([k, e, l]) => `<button class="chip" onclick="mjMoment('${m.id}','${k}')">${e} ${l}</button>`).join('')}</div>
    <div class="glass stack"><div class="row"><span class="label">Minuto a minuto</span>${ev.length ? `<button class="link" onclick="mjUndo('${m.id}')">↩️ Deshacer el último</button>` : ''}</div>
      ${ev.length ? `<ul class="list">${ev.slice(0, 30).map(e => { const k = MOMENTS.find(x => x[0] === e.t); return `<li><div class="txt"><span class="small">${e.t === 'goal' ? (e.mine ? `⚽ <b>¡Gol de ${esc(playerName())}!</b>` : `⚽ Gol de ${esc(e.team === 'a' ? m.teamA : m.teamB)}`) : `${k?.[1] || '•'} ${esc(k?.[2] || e.t)}`}</span></div><span class="tiny muted num">${e.min}'</span></li>`; }).join('')}</ul>`
        : '<p class="small muted" style="margin:0">Toca +1 cuando metan un gol. Si es de él, toca «⚽ De…» para su animación especial.</p>'}</div>
    <button class="btn danger" onclick="mjEnd('${m.id}')">🏁 Pitazo final</button>`);
}
const save = (m, events) => { const a = events.filter(e => e.t === 'goal' && e.team === 'a').length, b = events.filter(e => e.t === 'goal' && e.team === 'b').length; write(updateDoc(ref('mejengas', m.id), { events, a, b })); };
function mjGoal(id, team, mine) { const m = matches().find(x => x.id === id); if (!m) return; save(m, [...(m.events || []), { t: 'goal', team, mine: !!mine, min: curMin(m), at: Date.now(), by: uid() }]); }
function mjMoment(id, t) { const m = matches().find(x => x.id === id); if (!m) return; save(m, [...(m.events || []), { t, min: curMin(m), at: Date.now(), by: uid() }]); }
function mjUndo(id) { const m = matches().find(x => x.id === id); if (!m?.events?.length) return; seen[id] = m.events.length - 1; save(m, m.events.slice(0, -1)); toast('Listo, se quitó'); }
function mjClock(id) {
  const m = matches().find(x => x.id === id); if (!m) return; const c = m.clock || {};
  write(updateDoc(ref('mejengas', id), { clock: c.running ? { ...c, acc: elapsed(m), start: null, running: false } : { ...c, start: Date.now(), running: true } }));
}
function mjHalf(id) { const m = matches().find(x => x.id === id); if (!m) return; write(updateDoc(ref('mejengas', id), { clock: { half: 2, acc: elapsed(m), start: null, running: false } })); fx('pop', m, { e: '🔁', label: 'Medio tiempo' }); }
async function mjEnd(id) {
  const m = matches().find(x => x.id === id); if (!m) return;
  const s = score(m);
  if (!(await ask(`¿Pitazo final? Queda ${s.a} – ${s.b}.`, { ok: '🏁 Terminar' }))) return;
  const before = unlocked();
  write(updateDoc(ref('mejengas', id), { status: 'final', endedAt: Date.now(), clock: { ...(m.clock || {}), acc: elapsed(m), start: null, running: false } }));
  liveId = null;
  const g = myGoals(m), r = RES[result(m)];
  if (!imPlayer()) notify('mejenga', { title: `⚽ Final: ${m.teamA} ${s.a} – ${s.b} ${m.teamB}`, body: `${r[0]} ${r[1]}${g ? ` · metiste ${plural(g, 'gol', 'goles')} 🔥` : ''}`, url: './?open=mejenga', tag: 'mj-' + id });
  setTimeout(() => {
    const fresh = unlocked().filter(k => !before.includes(k));
    mjSummary(id, fresh);
  }, 3800);
}

/* ---------- Resumen del partido ---------- */
let photoData = null;
function mjSummary(id, fresh = []) {
  const m = matches().find(x => x.id === id); if (!m) return;
  const s = score(m), r = RES[result(m)], g = myGoals(m), ev = m.events || [];
  photoData = null;
  openSheet(`<div class="stack"><h2>${r[0]} ${r[1]}</h2>
    <div class="mj-mini big"><span style="--c:${m.colorA}">${esc(m.teamA)}</span><b class="num">${s.a} – ${s.b}</b><span style="--c:${m.colorB}">${esc(m.teamB)}</span></div>
    <span class="small muted center">${fmtShort(parseDate(m.date))}${m.time ? ' · ' + hh(m.time) : ''}${m.place ? ' · 📍 ' + esc(m.place.name) : ''}${m.clock?.acc ? ` · ${Math.round(m.clock.acc / 60000)} min` : ''}</span>
    ${fresh.length ? `<div class="mj-newlogro">🏅 ¡Logro nuevo! ${fresh.map(k => { const l = LOGROS.find(x => x[0] === k); return `${l[1]} ${l[2]}`; }).join(' · ')}</div>` : ''}
    ${g ? `<p class="center" style="margin:0">⚽ <b>${esc(playerName())}</b> metió ${plural(g, 'gol', 'goles')}${g >= 3 ? ' 🎩 ¡hat-trick!' : ''}</p>` : ''}
    ${ev.length ? `<div class="mj-timeline">${ev.map(e => { const k = MOMENTS.find(x => x[0] === e.t); return `<span class="${e.t === 'goal' ? (e.team === 'a' ? 'ga' : 'gb') : ''}">${e.min}' ${e.t === 'goal' ? (e.mine ? '⚽🌟' : '⚽') : k?.[1] || '•'}</span>`; }).join('')}</div>` : ''}
    ${m.photo ? `<img data-thumb="${m.photo}" alt="" style="width:100%;max-height:40vh;object-fit:cover;border-radius:16px" onclick="viewPhoto(this)">` : ''}
    <label class="f">⭐ Calificación de ${esc(playerName())} (1 a 10)</label>
    <div class="chips scroll">${[...Array(10)].map((_, i) => `<button class="chip ${m.rating === i + 1 ? 'on' : ''}" onclick="mjRate('${m.id}',${i + 1})">${i + 1}</button>`).join('')}</div>
    <label class="f" for="mjPlay">🎬 Jugada de la noche</label><input id="mjPlay" maxlength="100" value="${esc(m.play || '')}" placeholder="Ej: el globito del minuto 34" onchange="mjPlaySave('${m.id}',this.value)">
    <label class="btn ghost">${icon('photo')} ${m.photo ? 'Cambiar la foto' : 'Agregar una foto'}<input type="file" accept="image/*" hidden onchange="mjPhoto(this,'${m.id}')"></label>
    ${m.cost && !m.costDone ? `<button class="btn ghost" onclick="mjCost('${m.id}')">💸 Anotar la cancha en Gastos (${m.cost})</button>` : ''}
    <div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" onclick="closeSheet()">Cerrar</button><button class="btn ghost danger" onclick="closeSheet();mjDel('${m.id}')">Borrar</button></div></div>`);
  loadPhotos($('sheet'));
}
function mjRate(id, n) { write(updateDoc(ref('mejengas', id), { rating: n })); document.querySelectorAll('#sheet .chips .chip').forEach((b, i) => b.classList.toggle('on', i + 1 === n)); if (n >= 9) celebrate('hearts'); toast(`⭐ ${n}`); }
function mjPlaySave(id, v) { write(updateDoc(ref('mejengas', id), { play: v.trim() })); toast('Jugada guardada 🎬'); }
async function mjPhoto(input, id) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try { photoData = await compressImage(f, 1280); } catch (e) { return photoError(e); }
  const m = matches().find(x => x.id === id); if (!m) return;
  const s = score(m), pid = `mj-${id}`, thumb = await makeThumb(photoData).catch(() => null);
  const toMoments = await ask('¿Guardarla también en Momentos?', { ok: 'Sí, en Momentos', cancel: 'Solo aquí' });
  const b = writeBatch(db);
  b.set(ref('photos', pid), { data: photoData }); cachePhoto(pid, photoData);
  if (thumb) { b.set(ref('photos', thumbId(pid)), { data: thumb }); cachePhoto(thumbId(pid), thumb); }
  b.update(ref('mejengas', id), { photo: pid });
  if (toMoments) {
    const mr = newRef('moments');
    b.set(ref('photos', mr.id), { data: photoData }); cachePhoto(mr.id, photoData);
    if (thumb) { b.set(ref('photos', thumbId(mr.id)), { data: thumb }); cachePhoto(thumbId(mr.id), thumb); }
    b.set(mr, { title: `⚽ Mejenga: ${m.teamA} ${s.a} – ${s.b} ${m.teamB}`, date: m.date, note: myGoals(m) ? `${playerName()} metió ${plural(myGoals(m), 'gol', 'goles')}` : '', place: m.place || null, by: uid(), createdAt: Date.now(), hasPhoto: true });
  }
  write(b.commit()); toast(toMoments ? 'Foto guardada (también en Momentos) 📸' : 'Foto guardada 📸');
  setTimeout(() => mjSummary(id), 300);
}
function mjCost(id) {
  const m = matches().find(x => x.id === id); if (!m) return;
  write(updateDoc(ref('mejengas', id), { costDone: true })); closeSheet();
  setTimeout(() => window.quickSpend?.({ amount: m.cost, desc: `Cancha ⚽${m.place ? ' ' + m.place.name : ''}` }), 350);
}

/* ---------- Ajustes ---------- */
function mjCfg() {
  const c = cfg(), ids = Object.keys(S.settings.members || {});
  openSheet(`<div class="stack"><h2>⚙️ Ajustes de la mejenga</h2>
    <label class="f" for="mjPlayer">¿Quién juega?</label><select id="mjPlayer">${ids.map(u => `<option value="${u}" ${playerUid() === u ? 'selected' : ''}>${esc(realName(u))}</option>`).join('')}</select>
    <label class="f" for="mjNick">Apodo de futbolista (opcional)</label><input id="mjNick" maxlength="20" value="${esc(c.nick || '')}" placeholder="Para el «¡GOLAZO DE…!»">
    <button class="btn" onclick="mjCfgSave()">Guardar</button>
    <button class="btn ghost" onclick="closeSheet();mjFx()">👀 Ver la animación del golazo</button></div>`);
}
function mjCfgSave() { write(setDoc(ref('mejengas', 'cfg'), { player: $('mjPlayer').value, nick: $('mjNick').value.trim() }, { merge: true })); closeSheet(); toast('Guardado ⚽'); }
function mjFx() { fx('mine', null, { color: cfg().colorA }); }

// Reloj: corre cada segundo donde se vea
setInterval(() => {
  const live = liveMatch(); if (!live) return;
  const c = document.getElementById('mjClock'); if (c && liveId === live.id) c.textContent = clockTxt(elapsed(live));
  document.querySelectorAll('.mj-clock-mini').forEach(x => { x.textContent = clockTxt(elapsed(live)); });
}, 1000);

on('mejengas', () => { watchEvents(); if ($('s-mejengas')?.classList.contains('active')) render(); });
on('profiles', () => { if ($('s-mejengas')?.classList.contains('active')) render(); });
onShow('s-mejengas', render);
expose({ mjNew, mjColor, mjSave, mjDel, mjQuick, mjStart, mjOpen, mjBack, mjGoal, mjMoment, mjUndo, mjClock, mjHalf, mjEnd, mjSummary, mjRate, mjPlaySave, mjPhoto, mjCost, mjCfg, mjCfgSave, mjFx });
