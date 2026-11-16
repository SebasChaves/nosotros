// Recordatorios: cosas que no hay que olvidar. Aparecen en la tarjeta Hoy desde su fecha hasta que se marcan como hechas.
// Para que suene una alarma aunque la app esté cerrada, se pueden pasar al calendario del teléfono (con alarma).
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, ask, ANDROID,
         parseDate, todayKey, dayKey, today, fmtDay, nameOf, partnerUid, uid, softDelete, swipeHint } from './core.js';
import { backBar } from './lists.js';

let editing = null, showDone = false;
const forMe = r => !r.for || r.for === 'ambos' || r.for === uid();
// Los que tocan hoy (o ya vencieron) y son para mí: los usa la tarjeta Hoy.
export const dueReminders = () => S.data.reminders.filter(r => !r.done && !r.urgent && forMe(r) && r.date <= todayKey())
  .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
// Urgentes: se muestran arriba en Inicio sin importar la fecha, hasta que se marquen como hechos.
export const urgentReminders = () => S.data.reminders.filter(r => !r.done && r.urgent && forMe(r))
  .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
export const whenTxt = r => {
  const tk = todayKey(), tm = dayKey(new Date(today().getFullYear(), today().getMonth(), today().getDate() + 1));
  const d = r.date === tk ? 'Hoy' : r.date === tm ? 'Mañana' : r.date < tk ? `Venció el ${parseDate(r.date).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` : fmtDay(parseDate(r.date));
  return d + (r.time ? ` · ${r.time}` : '');
};
// Repetir: al marcarlo hecho, en vez de quedar hecho pasa a la próxima fecha
const REPEAT = [['', 'No se repite'], ['daily', 'Cada día'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año']];
const repTxt = r => r.repeat ? ' · 🔁 ' + REPEAT.find(x => x[0] === r.repeat)?.[1].toLowerCase() : '';
function nextDate(k, rep) {
  const d = parseDate(k), day = d.getDate();
  if (rep === 'daily') d.setDate(day + 1);
  if (rep === 'weekly') d.setDate(day + 7);
  if (rep === 'monthly') { d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  if (rep === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return dayKey(d);
}
const whoTxt = r => !r.for || r.for === 'ambos' ? 'Los dos' : r.for === uid() ? 'Para mí' : `Para ${nameOf(r.for)}`;

function render() {
  const pending = S.data.reminders.filter(r => !r.done).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const done = S.data.reminders.filter(r => r.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const item = r => `<li class="${r.done ? 'done' : ''}" data-swr="toggleReminder|${r.id}" data-swl="delReminder|${r.id}"><button class="check-btn ${r.done ? 'on' : ''}" aria-label="${r.done ? 'Marcar pendiente' : 'Marcar hecho'}" onclick="toggleReminder('${r.id}')">${r.done ? icon('check') : ''}</button>
    <div class="txt" role="button" tabindex="0" style="cursor:pointer" onclick="openReminder('${r.id}')"><span class="main">${r.urgent && !r.done ? '<span class="urg-tag">Urgente</span> ' : ''}${esc(r.text)}</span>
      <span class="sub" style="${!r.done && r.date < todayKey() ? 'color:#FF7A9C' : ''}">${esc(whenTxt(r))} · ${esc(whoTxt(r))}${esc(repTxt(r))}${r.note ? ' · ' + esc(r.note) : ''}</span></div>
    ${r.done ? '' : `<button class="del" aria-label="Alarma en mi calendario" onclick="reminderAlarm('${r.id}')">🔔</button>`}</li>`;
  paint('s-reminders', `${backBar('Recordatorios', 's-more', `<button class="btn small" onclick="openReminder()">${icon('plus')} Nuevo</button>`)}
    <div class="glass"><ul class="list">${pending.length ? pending.map(item).join('') : '<li class="empty">Nada pendiente ✨</li>'}</ul>${pending.length ? swipeHint('marcar hecho') : ''}</div>
    <p class="tiny muted center" style="margin:0">Aparecen en Hoy desde su fecha. Toca 🔔 para ponerlo en el calendario del teléfono con alarma.</p>
    ${done.length ? `<button class="link" onclick="toggleDoneList()">${showDone ? 'Ocultar' : 'Ver'} hechos (${done.length})</button>
      ${showDone ? `<div class="glass"><ul class="list">${done.slice(0, 30).map(item).join('')}</ul></div>` : ''}` : ''}`);
}
function toggleDoneList() { showDone = !showDone; render(); }

function openReminder(id) {
  const r = id ? S.data.reminders.find(x => x.id === id) : null, p = partnerUid();
  editing = r ? r.id : null;
  openSheet(`<div class="stack"><h2>${r ? 'Editar recordatorio' : 'Nuevo recordatorio'}</h2>
    <input id="remText" placeholder="Ej: Pagar el agua, comprar regalo para mamá" maxlength="90" aria-label="Recordatorio" value="${esc(r?.text || '')}">
    <div class="grid2"><div><label class="f" for="remDate">Día</label><input type="date" id="remDate" value="${r?.date || todayKey()}"></div>
      <div><label class="f" for="remTime">Hora (opcional)</label><input type="time" id="remTime" value="${r?.time || ''}"></div></div>
    <div><label class="f" for="remFor">¿Para quién?</label><select id="remFor"><option value="ambos">Los dos</option><option value="${uid()}">Para mí</option>
      ${p ? `<option value="${p}">Para ${esc(nameOf(p))}</option>` : ''}</select></div>
    <div><label class="f" for="remRepeat">Repetir</label><select id="remRepeat">${REPEAT.map(([k, l]) => `<option value="${k}" ${(r?.repeat || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <input id="remNote" placeholder="Nota (opcional)" maxlength="120" aria-label="Nota" value="${esc(r?.note || '')}">
    <label class="check" style="margin-top:0"><input type="checkbox" id="remUrgent" ${r?.urgent ? 'checked' : ''}> <span>🔴 Urgente <span class="tiny muted" style="display:block">Se muestra arriba en Inicio hasta que esté hecho</span></span></label>
    <button class="btn" onclick="saveReminder()">${r ? 'Guardar cambios' : 'Guardar'}</button>
    ${r && !r.done ? `<div class="stack" style="gap:6px"><span class="label">⏰ Posponer</span><div class="chips">${[['10m', '10 min'], ['1h', '1 hora'], ['tarde', 'Esta tarde'], ['manana', 'Mañana'], ['semana', 'En una semana']].map(([k, l]) => `<button class="chip" onclick="snoozeReminder('${r.id}','${k}')">${l}</button>`).join('')}</div></div>` : ''}
    ${r ? `<div class="grid2"><button class="btn ghost" onclick="reminderAlarm('${r.id}')">🔔 Alarma</button><button class="btn ghost danger" onclick="delReminder('${r.id}')">${icon('trash')} Borrar</button></div>` : ''}</div>`);
  if (r) $('remFor').value = r.for || 'ambos';
  else setTimeout(() => $('remText')?.focus(), 50);
}
function saveReminder() {
  const text = $('remText').value.trim(); if (!text) return toast('Escribe qué hay que recordar');
  const data = { text, date: $('remDate').value || todayKey(), time: $('remTime').value || '', for: $('remFor').value, note: $('remNote').value.trim(), urgent: $('remUrgent').checked, repeat: $('remRepeat').value };
  if (editing && S.data.reminders.some(r => r.id === editing)) write(updateDoc(ref('reminders', editing), data));
  else write(setDoc(newRef('reminders'), { ...data, done: false, by: uid(), createdAt: Date.now() }));
  closeSheet(); toast(editing ? 'Cambios guardados' : 'Recordatorio guardado'); editing = null;
}
function toggleReminder(id) {
  const r = S.data.reminders.find(x => x.id === id); if (!r) return;
  if (!r.done && r.repeat) { // se repite: pasa a la próxima fecha (a partir de hoy si estaba atrasado)
    let d = nextDate(r.date, r.repeat); while (d <= todayKey() && r.repeat !== 'yearly') d = nextDate(d, r.repeat);
    write(updateDoc(ref('reminders', id), { date: d, lastDone: Date.now(), lastDoneBy: uid() }));
    return toast(`¡Hecho! El próximo: ${whenTxt({ ...r, date: d })}`);
  }
  write(updateDoc(ref('reminders', id), r.done ? { done: false, doneAt: null, doneBy: null } : { done: true, doneAt: Date.now(), doneBy: uid() }));
  if (!r.done) toast('¡Hecho!');
}
// Posponer: cambia día/hora (el aviso del Worker suena a la nueva hora)
function snoozeReminder(id, k) {
  const r = S.data.reminders.find(x => x.id === id); if (!r) return;
  const now = new Date(), hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let date = todayKey(), time = r.time || '';
  if (k === '10m' || k === '1h') { const d = new Date(now.getTime() + (k === '10m' ? 10 : 60) * 60e3); date = dayKey(d); time = hm(d); }
  if (k === 'tarde') { time = now.getHours() < 17 ? '17:00' : hm(new Date(now.getTime() + 3600e3)); }
  if (k === 'manana') { const d = new Date(now); d.setDate(d.getDate() + 1); date = dayKey(d); time = r.time || '09:00'; }
  if (k === 'semana') { const d = new Date(now); d.setDate(d.getDate() + 7); date = dayKey(d); }
  write(updateDoc(ref('reminders', id), { date, time }));
  closeSheet(); toast(`⏰ Pospuesto: ${whenTxt({ ...r, date, time })}`);
}
function delReminder(id) { softDelete('reminders', id, 'el recordatorio', { after: closeSheet }); }

// Archivo de calendario con alarma a la hora del recordatorio (o a las 9:00 si no tiene hora).
async function reminderAlarm(id) {
  const r = S.data.reminders.find(x => x.id === id); if (!r) return;
  const t = (r.time || '09:00').replace(':', '') + '00', d = r.date.replace(/-/g, '');
  const [h, m] = (r.time || '09:00').split(':').map(Number), end = `${String(Math.min(23, h + 1)).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
  const clean = s => String(s || '').replace(/[\\;,]/g, x => '\\' + x).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Futari//ES', 'BEGIN:VEVENT', `UID:${r.id}@futari-rem`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART:${d}T${t}`, `DTEND:${d}T${end}`,
    `SUMMARY:${clean('⏰ ' + r.text)}`, r.note ? `DESCRIPTION:${clean(r.note)}` : '',
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${clean(r.text)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  if (ANDROID && navigator.canShare) {
    const file = new File([blob], 'recordatorio.ics', { type: 'text/calendar' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: r.text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'recordatorio.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

on('reminders', () => { if ($('s-reminders').classList.contains('active')) render(); });
onShow('s-reminders', render);
expose({ snoozeReminder, openReminder, saveReminder, toggleReminder, delReminder, reminderAlarm, toggleDoneList });
