// Calendario compartido: planes de los dos más fechas especiales, mesiversarios y viajes.
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos,
         parseDate, today, dayKey, todayKey, fmtDay, addMonths, nameOf, partnerUid, partnerName, avatar, uid } from './core.js';
import { backBar } from './lists.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
let vy = today().getFullYear(), vm = today().getMonth(), sel = todayKey();

// Todo lo que pasa en un día: { kind: plan|date|love|trip, label, time?, ev? }
function itemsFor(key) {
  const out = [], d = parseDate(key);
  for (const ev of S.data.events) if (ev.date === key) out.push({ kind: 'plan', label: ev.title, time: ev.time, ev });
  for (const f of S.data.dates) {
    const o = parseDate(f.date);
    const hit = f.yearly ? (o.getMonth() === d.getMonth() && o.getDate() === d.getDate() && d.getFullYear() >= o.getFullYear()) : f.date === key;
    if (hit) {
      const years = d.getFullYear() - o.getFullYear();
      out.push({ kind: 'date', label: `${f.emoji} ${f.title}${f.yearly && years > 0 && f.emoji === '🎂' ? ` (cumple ${years})` : ''}` });
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
  paint('s-cal', `${backBar('Calendario', 's-more', `<button class="btn small" onclick="openEvent()">${icon('plus')} Plan</button>`)}
    <div class="glass stack">
      <div class="row"><button class="icon-btn" aria-label="Mes anterior" onclick="calMove(-1)">${icon('back')}</button>
        <h2>${cap(first.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}</h2>
        <button class="icon-btn" aria-label="Mes siguiente" onclick="calMove(1)" style="transform:scaleX(-1)">${icon('back')}</button></div>
      <div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span class="dow">${d}</span>`).join('')}
        ${cells.slice(0, lastRowNeeded ? 42 : 35).map(c => {
          const k = dayKey(c), its = itemsFor(k);
          return `<button class="${c.getMonth() !== vm ? 'out' : ''} ${k === tk ? 'today' : ''} ${k === sel ? 'sel' : ''}" onclick="calPick('${k}')" aria-label="${fmtDay(c)}${its.length ? ', ' + its.length + ' cosas' : ''}">
            ${c.getDate()}<span class="dots">${its.slice(0, 3).map(i => `<i class="${i.kind}"></i>`).join('')}</span></button>`;
        }).join('')}</div>
      <div class="legend"><span><i style="background:var(--g1)"></i>Planes</span><span><i style="background:var(--g2)"></i>Fechas especiales</span><span><i style="background:#7DD3FC"></i>Viajes</span></div>
      ${vy !== today().getFullYear() || vm !== today().getMonth() ? `<button class="link" onclick="calToday()">Ir a hoy</button>` : ''}
    </div>
    <div class="glass"><div class="row"><h2>${cap(fmtDay(parseDate(sel)))}</h2>
      <button class="link" onclick="openEvent('${sel}')">${icon('plus')} Agregar</button></div>
      <ul class="list" style="margin-top:6px">${items.length ? items.map(i => i.kind === 'plan' ? `<li>
        ${i.ev.who === 'ambos' || !i.ev.who ? `<span class="avatars">${avatar(uid(), 28)}${p ? avatar(p, 28) : ''}</span>` : avatar(i.ev.who, 28)}
        <div class="txt">${esc(i.label)}<span class="sub">${i.time ? esc(i.time) + ' · ' : ''}${i.ev.who === 'ambos' || !i.ev.who ? 'Los dos' : esc(nameOf(i.ev.who))}${i.ev.note ? ' · ' + esc(i.ev.note) : ''}</span></div>
        <button class="del" aria-label="Agregar a mi calendario" onclick="exportEvent('${i.ev.id}')">${icon('cal')}</button>
        <button class="del" aria-label="Borrar plan" onclick="delEvent('${i.ev.id}')">${icon('trash')}</button></li>`
        : `<li><div class="txt">${esc(i.label)}</div></li>`).join('')
        : '<li class="empty">Nada este día</li>'}</ul></div>`);
  loadPhotos($('s-cal'));
}
function calMove(n) { const d = new Date(vy, vm + n, 1); vy = d.getFullYear(); vm = d.getMonth(); render(); }
function calToday() { vy = today().getFullYear(); vm = today().getMonth(); sel = todayKey(); render(); }
function calPick(k) { sel = k; const d = parseDate(k); if (d.getMonth() !== vm) { vy = d.getFullYear(); vm = d.getMonth(); } render(); }

function openEvent(date) {
  const p = partnerUid();
  openSheet(`<div class="stack"><h2>Nuevo plan</h2>
    <input id="evTitle" placeholder="Ej: Cena con mis papás" maxlength="70" aria-label="Plan">
    <div class="grid2"><div><label class="f" for="evDate">Día</label><input type="date" id="evDate" value="${date || sel}"></div>
      <div><label class="f" for="evTime">Hora (opcional)</label><input type="time" id="evTime"></div></div>
    <div><label class="f" for="evWho">¿De quién?</label><select id="evWho"><option value="ambos">Los dos</option><option value="${uid()}">Solo yo</option>
      ${p ? `<option value="${p}">Solo ${esc(nameOf(p))}</option>` : ''}</select></div>
    <input id="evNote" placeholder="Nota (opcional)" maxlength="120" aria-label="Nota">
    <button class="btn" onclick="saveEvent()">Guardar plan</button></div>`);
}
function saveEvent() {
  const title = $('evTitle').value.trim(), date = $('evDate').value;
  if (!title || !date) return toast('Pon el plan y el día');
  write(setDoc(newRef('events'), { title, date, time: $('evTime').value || '', who: $('evWho').value, note: $('evNote').value.trim(), by: uid(), createdAt: Date.now() }));
  sel = date; const d = parseDate(date); vy = d.getFullYear(); vm = d.getMonth();
  closeSheet(); toast('Plan guardado');
}
function delEvent(id) { if (confirm('¿Borrar este plan para los dos?')) write(deleteDoc(ref('events', id))); }

/* ---------- Pasar un plan al calendario del teléfono ---------- */
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
  const ev = S.data.events.find(e => e.id === id); if (!ev) return;
  const [a, b] = range(ev);
  const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${a}/${b}&details=${encodeURIComponent(ev.note || '')}`;
  openSheet(`<div class="stack"><h2>Agregar a mi calendario</h2><p class="small muted" style="margin:0">${esc(ev.title)} · ${esc(fmtDay(parseDate(ev.date)))}${ev.time ? ' · ' + esc(ev.time) : ''}</p>
    <button class="btn" onclick="downloadIcs('${id}')">${icon('cal')} Calendario del iPhone</button>
    <a class="btn ghost" href="${g}" target="_blank" rel="noopener" style="text-decoration:none">Google Calendar</a></div>`);
}
function downloadIcs(id) {
  const ev = S.data.events.find(e => e.id === id); if (!ev) return;
  const [a, b] = range(ev), allDay = !ev.time;
  const clean = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nosotros//ES', 'BEGIN:VEVENT', `UID:${ev.id}@nosotros`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    allDay ? `DTSTART;VALUE=DATE:${a}` : `DTSTART:${a}`, allDay ? `DTEND;VALUE=DATE:${b}` : `DTEND:${b}`,
    `SUMMARY:${clean(ev.title)}`, ev.note ? `DESCRIPTION:${clean(ev.note)}` : '', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY',
    `DESCRIPTION:${clean(ev.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'plan.ics'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  closeSheet();
}

on('events dates trips profiles', () => { if ($('s-cal').classList.contains('active')) render(); });
onShow('s-cal', render);
expose({ calMove, calToday, calPick, openEvent, saveEvent, delEvent, exportEvent, downloadIcs });
