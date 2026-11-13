// Calendario compartido: planes de los dos más fechas especiales, mesiversarios y viajes.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos,
         parseDate, today, dayKey, todayKey, fmtDay, addMonths, nameOf, partnerUid, partnerName, avatar, uid, ask, ANDROID } from './core.js';
import { backBar } from './lists.js';
import { DATE_KINDS, YEARLY_KINDS } from './data.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
let vy = today().getFullYear(), vm = today().getMonth(), sel = todayKey();

// Repeticiones de un plan: none (una vez), weekly, biweekly, monthly, yearly; "until" opcional.
export const REPEATS = [['none', 'No se repite'], ['weekly', 'Cada semana'], ['biweekly', 'Cada 2 semanas'], ['monthly', 'Cada mes'], ['yearly', 'Cada año']];
const repeatLabel = r => REPEATS.find(x => x[0] === r)?.[1] || '';

// Próxima vez que toca una fecha especial (null si era de una sola vez y ya pasó)
export function nextOccurrence(f) {
  const d = parseDate(f.date), now = today();
  if (!f.yearly) return d >= now ? d : null;
  let n = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (n < now) n = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return n;
}
export function occursOn(ev, key) {
  if (ev.date === key) return true;
  if (!ev.repeat || ev.repeat === 'none' || key < ev.date || (ev.until && key > ev.until)) return false;
  const a = parseDate(ev.date), d = parseDate(key);
  if (ev.repeat === 'weekly') return a.getDay() === d.getDay();
  if (ev.repeat === 'biweekly') return Math.round((d - a) / 864e5) % 14 === 0;
  if (ev.repeat === 'monthly') return a.getDate() === d.getDate();
  if (ev.repeat === 'yearly') return a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
  return false;
}
// Próxima fecha (desde hoy) en que ocurre un plan, o null si ya pasó.
export function nextEventDate(ev, fromKey = todayKey()) {
  let d = parseDate(ev.date > fromKey ? ev.date : fromKey);
  for (let i = 0; i < 400; i++, d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) { const k = dayKey(d); if (occursOn(ev, k)) return k; }
  return null;
}

// Todo lo que pasa en un día: { kind: plan|date|love|trip, label, time?, ev? }
export function itemsFor(key) {
  const out = [], d = parseDate(key);
  for (const ev of S.data.events) if (occursOn(ev, key)) out.push({ kind: 'plan', label: ev.title, time: ev.time, ev });
  for (const f of S.data.dates) {
    const o = parseDate(f.date);
    const hit = f.yearly ? (o.getMonth() === d.getMonth() && o.getDate() === d.getDate() && d.getFullYear() >= o.getFullYear()) : f.date === key;
    if (hit) {
      const years = d.getFullYear() - o.getFullYear();
      out.push({ kind: 'date', f, label: `${f.emoji} ${f.title}${f.yearly && years > 0 && f.emoji === '🎂' ? ` (cumple ${years})` : f.yearly && years > 0 && f.emoji === '💍' ? ` (${years} años)` : ''}` });
    }
  }
  if (S.settings.start) {
    const s = parseDate(S.settings.start);
    const n = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
    if (n > 0 && dayKey(addMonths(s, n)) === key) out.push({ kind: 'love', label: n % 12 === 0 ? `💍 Aniversario #${n / 12}` : `🗓️ Mesiversario #${n}` });
    if (key === S.settings.start) out.push({ kind: 'love', label: '💞 El día que empezaron' });
  }
  for (const t of S.data.trips) if (t.start && key >= t.start && key <= (t.end || t.start)) out.push({ kind: 'trip', label: `✈️ ${t.name}` });
  return out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

function render() {
  const first = new Date(vy, vm, 1);
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const gridStart = new Date(vy, vm, 1 - offset);
  const cells = [...Array(42)].map((_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const lastRowNeeded = cells.slice(35).some(c => c.getMonth() === vm);
  const tk = todayKey();
  const items = itemsFor(sel);
  const p = partnerUid();
  paint('s-cal', `${backBar('Calendario', 's-more', `<button class="btn small" onclick="openAdd()">${icon('plus')} Agregar</button>`)}
    <div class="glass stack">
      <div class="row"><button class="icon-btn" aria-label="Mes anterior" onclick="calMove(-1)">${icon('back')}</button>
        <h2>${cap(first.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}</h2>
        <button class="icon-btn" aria-label="Mes siguiente" onclick="calMove(1)" style="transform:scaleX(-1)">${icon('back')}</button></div>
      <div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span class="dow">${d}</span>`).join('')}
        ${cells.slice(0, lastRowNeeded ? 42 : 35).map(c => {
          const k = dayKey(c), its = itemsFor(k), fecha = its.find(i => i.kind === 'date');
          // Fecha especial: se ve su emoji; lo demás, con puntitos de color
          const marks = (fecha ? [`<b>${esc(fecha.f.emoji)}</b>`] : []).concat(its.filter(i => i.kind !== 'date').map(i => `<i class="${i.kind}"></i>`)).slice(0, 3);
          return `<button class="${c.getMonth() !== vm ? 'out' : ''} ${k === tk ? 'today' : ''} ${k === sel ? 'sel' : ''}" onclick="calPick('${k}')" aria-label="${fmtDay(c)}${its.length ? ', ' + its.length + ' cosas' : ''}">
            ${c.getDate()}<span class="dots">${marks.join('')}</span></button>`;
        }).join('')}</div>
      <div class="legend"><span><i style="background:var(--c-plan)"></i>Planes</span><span>🎂 Fechas especiales</span><span><i style="background:var(--c-date)"></i>Aniversarios</span><span><i style="background:var(--c-trip)"></i>Viajes</span></div>
      ${vy !== today().getFullYear() || vm !== today().getMonth() ? `<button class="link" onclick="calToday()">Ir a hoy</button>` : ''}
    </div>
    <div class="glass"><div class="row"><h2>${cap(fmtDay(parseDate(sel)))}</h2>
      <button class="link" onclick="openAdd('${sel}')">${icon('plus')} Agregar</button></div>
      <ul class="list" style="margin-top:6px">${items.length ? items.map(i => i.kind === 'plan' ? `<li>
        ${i.ev.who === 'ambos' || !i.ev.who ? `<span class="avatars">${avatar(uid(), 28)}${p ? avatar(p, 28) : ''}</span>` : avatar(i.ev.who, 28)}
        <div class="txt" role="button" tabindex="0" style="cursor:pointer" aria-label="Editar ${esc(i.label)}" onclick="openEvent(null,'${i.ev.id}')">${esc(i.label)}<span class="sub">${i.ev.repeat && i.ev.repeat !== 'none' ? '↻ ' + repeatLabel(i.ev.repeat).toLowerCase() + ' · ' : ''}${i.time ? esc(i.time) + ' · ' : ''}${i.ev.who === 'ambos' || !i.ev.who ? 'Los dos' : esc(nameOf(i.ev.who))}${i.ev.note ? ' · ' + esc(i.ev.note) : ''}</span></div>
        <button class="del" aria-label="Agregar a mi calendario" onclick="exportEvent('${i.ev.id}')">${icon('cal')}</button>
        <button class="del" aria-label="Borrar plan" onclick="delEvent('${i.ev.id}')">${icon('trash')}</button></li>`
        : i.kind === 'date' ? `<li>
        <div class="txt" role="button" tabindex="0" style="cursor:pointer" aria-label="Editar ${esc(i.label)}" onclick="openFecha(null,'${i.f.id}')">${esc(i.label)}<span class="sub">Fecha especial${i.f.yearly ? ' · cada año' : ''}</span></div>
        <button class="del" aria-label="Agregar a mi calendario" onclick="exportEvent('${i.f.id}')">${icon('cal')}</button>
        <button class="del" aria-label="Borrar fecha" onclick="delFecha('${i.f.id}')">${icon('trash')}</button></li>`
        : `<li><div class="txt">${esc(i.label)}</div></li>`).join('')
        : '<li class="empty">Nada este día</li>'}</ul></div>`);
  loadPhotos($('s-cal'));
}
function calMove(n) { const d = new Date(vy, vm + n, 1); vy = d.getFullYear(); vm = d.getMonth(); render(); }
function calToday() { vy = today().getFullYear(); vm = today().getMonth(); sel = todayKey(); render(); }
function calPick(k) { sel = k; const d = parseDate(k); if (d.getMonth() !== vm || d.getFullYear() !== vy) { vy = d.getFullYear(); vm = d.getMonth(); } render(); }

// "+ Agregar": elegir entre un plan o una fecha especial para ese día
function openAdd(date) {
  const d = date || sel;
  openSheet(`<div class="stack"><h2>Agregar · ${esc(fmtDay(parseDate(d)))}</h2>
    <button class="btn" onclick="openEvent('${d}')">📌 Un plan</button>
    <p class="tiny muted center" style="margin:-4px 0 4px">Algo que van a hacer: una cena, una cita, una salida…</p>
    <button class="btn ghost" onclick="openFecha('${d}')">🎂 Una fecha especial</button>
    <p class="tiny muted center" style="margin:-4px 0 0">Un día para recordar: cumpleaños, aniversarios, festivos…</p></div>`);
}

/* ---------- Fechas especiales (colección "dates") ---------- */
let editingF = null;
// Sin id: fecha nueva (con el día que se tocó). Con id: editar esa fecha.
function openFecha(date, id) {
  const f = id ? S.data.dates.find(x => x.id === id) : null;
  editingF = f ? f.id : null;
  const kind = f?.emoji || DATE_KINDS[0][0];
  const kinds = DATE_KINDS.some(k => k[0] === kind) ? DATE_KINDS : [[kind, 'Otro'], ...DATE_KINDS];
  const yearly = f ? !!f.yearly : YEARLY_KINDS.includes(kind);
  openSheet(`<div class="stack"><h2>${f ? 'Editar fecha especial' : 'Nueva fecha especial'}</h2>
    <div class="grid2"><div><label class="f" for="fechaKind">Tipo</label><select id="fechaKind" onchange="fechaKindChanged()">
        ${kinds.map(([e, l]) => `<option value="${e}">${e} ${l}</option>`).join('')}</select></div>
      <div><label class="f" for="fechaDate">Fecha</label><input type="date" id="fechaDate" value="${f?.date || date || sel}"></div></div>
    <input id="fechaTitle" placeholder="Ej: Cumpleaños de mamá" maxlength="60" aria-label="Nombre" value="${esc(f?.title || '')}">
    <label class="check"><input type="checkbox" id="fechaYearly" ${yearly ? 'checked' : ''}> Se repite cada año</label>
    <p class="tiny muted" id="fechaHint" style="margin:0" ${kind === '🎂' ? '' : 'hidden'}>Si ponen el año en que nació, la app les dice cuántos cumple.</p>
    <button class="btn" onclick="saveFecha()">${f ? 'Guardar cambios' : 'Guardar fecha'}</button>
    ${f ? `<div class="grid2"><button class="btn ghost" onclick="exportEvent('${f.id}')">${icon('cal')} A mi calendario</button><button class="btn ghost danger" onclick="delFecha('${f.id}')">${icon('trash')} Borrar</button></div>` : ''}</div>`);
  $('fechaKind').value = kind;
}
function fechaKindChanged() {
  const k = $('fechaKind').value;
  if (!editingF) $('fechaYearly').checked = YEARLY_KINDS.includes(k);
  $('fechaHint').hidden = k !== '🎂';
}
function saveFecha() {
  const title = $('fechaTitle').value.trim(), date = $('fechaDate').value;
  if (!title || !date) return toast('Pon un nombre y una fecha');
  const data = { title, date, emoji: $('fechaKind').value, yearly: $('fechaYearly').checked };
  const edit = editingF && S.data.dates.some(x => x.id === editingF);
  if (edit) write(updateDoc(ref('dates', editingF), { ...data, editedBy: uid(), editedAt: Date.now() }));
  else write(setDoc(newRef('dates'), { ...data, by: uid(), createdAt: Date.now() }));
  // En el calendario se va al día guardado (si se repite cada año, a la próxima vez que toca)
  if ($('s-cal').classList.contains('active')) { const n = nextOccurrence(data) || parseDate(date); sel = dayKey(n); vy = n.getFullYear(); vm = n.getMonth(); }
  closeSheet(); toast(edit ? 'Cambios guardados' : 'Fecha guardada'); editingF = null;
}
async function delFecha(id) {
  if (await ask('¿Borrar esta fecha especial para los dos?')) { write(deleteDoc(ref('dates', id))); closeSheet(); }
}

let editing = null;
// Sin id: plan nuevo. Con id: editar ese plan (tocándolo en la lista del día).
function openEvent(date, id) {
  const p = partnerUid(), ev = id ? S.data.events.find(e => e.id === id) : null;
  editing = ev ? ev.id : null;
  openSheet(`<div class="stack"><h2>${ev ? 'Editar plan' : 'Nuevo plan'}</h2>
    <input id="evTitle" placeholder="Ej: Cena con mis papás" maxlength="70" aria-label="Plan" value="${esc(ev?.title || '')}">
    <div class="grid2"><div><label class="f" for="evDate">Día</label><input type="date" id="evDate" value="${ev?.date || date || sel}"></div>
      <div><label class="f" for="evTime">Hora (opcional)</label><input type="time" id="evTime" value="${ev?.time || ''}"></div></div>
    <div><label class="f" for="evWho">¿De quién?</label><select id="evWho"><option value="ambos">Los dos</option><option value="${uid()}">Solo yo</option>
      ${p ? `<option value="${p}">Solo ${esc(nameOf(p))}</option>` : ''}</select></div>
    <div class="grid2"><div><label class="f" for="evRepeat">¿Se repite?</label><select id="evRepeat" onchange="document.getElementById('evUntilBox').hidden=this.value==='none'">${REPEATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div id="evUntilBox" hidden><label class="f" for="evUntil">Hasta (opcional)</label><input type="date" id="evUntil"></div></div>
    <input id="evNote" placeholder="Nota (opcional)" maxlength="120" aria-label="Nota">
    <button class="btn" onclick="saveEvent()">${ev ? 'Guardar cambios' : 'Guardar plan'}</button>
    ${ev ? `<div class="grid2"><button class="btn ghost" onclick="exportEvent('${ev.id}')">${icon('cal')} A mi calendario</button><button class="btn ghost danger" onclick="delEvent('${ev.id}')">${icon('trash')} Borrar</button></div>` : ''}</div>`);
  if (ev) {
    $('evWho').value = ev.who || 'ambos'; $('evRepeat').value = ev.repeat || 'none';
    $('evUntilBox').hidden = (ev.repeat || 'none') === 'none'; $('evUntil').value = ev.until || ''; $('evNote').value = ev.note || '';
  }
}
function saveEvent() {
  const title = $('evTitle').value.trim(), date = $('evDate').value;
  if (!title || !date) return toast('Pon el plan y el día');
  const data = { title, date, time: $('evTime').value || '', who: $('evWho').value, note: $('evNote').value.trim(),
    repeat: $('evRepeat').value, until: $('evRepeat').value !== 'none' ? ($('evUntil').value || '') : '' };
  if (editing && S.data.events.some(e => e.id === editing)) write(updateDoc(ref('events', editing), { ...data, editedBy: uid(), editedAt: Date.now() }));
  else write(setDoc(newRef('events'), { ...data, by: uid(), createdAt: Date.now() }));
  sel = date; const d = parseDate(date); vy = d.getFullYear(); vm = d.getMonth();
  closeSheet(); toast(editing ? 'Cambios guardados' : 'Plan guardado'); editing = null;
}
async function delEvent(id) {
  const ev = S.data.events.find(e => e.id === id);
  const rep = ev?.repeat && ev.repeat !== 'none';
  if (await ask(rep ? '¿Borrar este plan y todas sus repeticiones para los dos?' : '¿Borrar este plan para los dos?')) { write(deleteDoc(ref('events', id))); closeSheet(); }
}
// Regla de repetición para el calendario del teléfono y Google
const rrule = ev => {
  if (!ev.repeat || ev.repeat === 'none') return '';
  const f = { weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[ev.repeat];
  return 'RRULE:' + f + (ev.until ? ';UNTIL=' + ev.until.replace(/-/g, '') + 'T235959' : '');
};

/* ---------- Pasar un plan o una fecha especial al calendario del teléfono ---------- */
// Una fecha especial se exporta como un evento de todo el día (cada año si se repite), desde su próxima vez.
function exportable(id) {
  const ev = S.data.events.find(e => e.id === id);
  if (ev) return ev;
  const f = S.data.dates.find(x => x.id === id); if (!f) return null;
  const next = nextOccurrence(f);
  return { id: f.id, fecha: true, title: `${f.emoji} ${f.title}`, date: next ? dayKey(next) : f.date, time: '', note: '', repeat: f.yearly ? 'yearly' : 'none', until: '' };
}
const compact = (date, time) => date.replace(/-/g, '') + (time ? 'T' + time.replace(':', '') + '00' : '');
function range(ev) {
  if (ev.time) {
    const [h, m] = ev.time.split(':').map(Number), d = parseDate(ev.date);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1, m);
    return [compact(ev.date, ev.time), compact(dayKey(end), `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)];
  }
  const d = parseDate(ev.date);
  return [compact(ev.date), compact(dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)))];
}
function exportEvent(id) {
  const ev = exportable(id); if (!ev) return;
  const [a, b] = range(ev);
  const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${a}/${b}&details=${encodeURIComponent(ev.note || '')}${rrule(ev) ? '&recur=' + encodeURIComponent(rrule(ev)) : ''}`;
  openSheet(`<div class="stack"><h2>Agregar a mi calendario</h2><p class="small muted" style="margin:0">${esc(ev.title)} · ${esc(fmtDay(parseDate(ev.date)))}${ev.time ? ' · ' + esc(ev.time) : ''}${ev.fecha && ev.repeat === 'yearly' ? ' · cada año' : ''}</p>
    ${ev.fecha ? '<p class="tiny muted" style="margin:0">Con aviso el día antes y el mismo día a las 9 a. m. (en Google Calendar, los avisos son los de tu cuenta).</p>' : ''}
    ${ANDROID
      ? `<a class="btn" href="${g}" target="_blank" rel="noopener" style="text-decoration:none">${icon('cal')} Google Calendar</a>
         <button class="btn ghost" onclick="downloadIcs('${id}')">Calendario de Samsung u otro</button>
         <p class="tiny muted center" style="margin:0">Si usan el de Samsung con su cuenta de Google, el de Google también aparece ahí. La otra opción manda el plan al calendario que elijas (o lo descarga: ábrelo desde las notificaciones).</p>`
      : `<button class="btn" onclick="downloadIcs('${id}')">${icon('cal')} Calendario del iPhone</button>
         <a class="btn ghost" href="${g}" target="_blank" rel="noopener" style="text-decoration:none">Google Calendar</a>`}</div>`);
}
async function downloadIcs(id) {
  const ev = exportable(id); if (!ev) return;
  const [a, b] = range(ev), allDay = !ev.time;
  const clean = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Futari//ES', 'BEGIN:VEVENT', `UID:${ev.id}@futari`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    allDay ? `DTSTART;VALUE=DATE:${a}` : `DTSTART:${a}`, allDay ? `DTEND;VALUE=DATE:${b}` : `DTEND:${b}`,
    `SUMMARY:${clean(ev.title)}`, rrule(ev), ev.note ? `DESCRIPTION:${clean(ev.note)}` : '',
    // Plan: aviso 1 hora antes. Fecha especial (todo el día): el día antes y el mismo día, a las 9 a. m.
    ...(ev.fecha ? ['-PT15H', 'PT9H'] : ['-PT1H']).flatMap(t => ['BEGIN:VALARM', `TRIGGER:${t}`, 'ACTION:DISPLAY', `DESCRIPTION:${clean(ev.title)}`, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  // En Android se intenta compartir el archivo (así se puede elegir el Calendario de Samsung); si no se puede, se descarga.
  if (ANDROID && navigator.canShare) {
    const file = new File([blob], ev.fecha ? 'fecha.ics' : 'plan.ics', { type: 'text/calendar' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: ev.title }); closeSheet(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = ev.fecha ? 'fecha.ics' : 'plan.ics'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  closeSheet();
}

on('events dates trips profiles', () => { if ($('s-cal').classList.contains('active')) render(); });
onShow('s-cal', render);
expose({ calMove, calToday, calPick, openAdd, openEvent, saveEvent, delEvent, openFecha, fechaKindChanged, saveFecha, delFecha, exportEvent, downloadIcs });
