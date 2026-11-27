// 📖 Diario de los dos (1.19.0, pantalla s-diary en Más): cada noche una línea de cada uno sobre cómo estuvo su día,
// con un emoji. La de tu pareja de hoy se ve cuando escribes la tuya (las de días pasados se ven siempre).
// Datos: diary/<día> = { <uid>: { text, e, at } }. Cuenta para la racha y para la Liga del mes (1 punto).
// Avisos: en la campana desde las 19:00 si no has escrito, o en cuanto tu pareja escribe; el Worker v17 manda uno a las
// 21:30 a quien no ha escrito.
import { setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, onShow, expose, toast, write, ref, todayKey, parseDate, nameOf, partnerUid, partnerName, uid, plural, avatar, markActive, celebrate } from './core.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';

const EMOJIS = ['🥰', '😊', '😌', '🤩', '😴', '😤', '😢', '🤒', '🥳', '💪'];
const entry = (day, who) => S.data.diary?.find(d => d.id === day)?.[who];
export const myDiaryDone = () => !!entry(todayKey(), uid());
export const partnerDiaryDone = () => { const p = partnerUid(); return !!p && !!entry(todayKey(), p); };
let month = '', editing = false, pickE = '';

export function diaryAlerts() {
  const out = [], pn = esc(partnerName());
  if (!partnerUid() || myDiaryDone()) return out;
  if (partnerDiaryDone()) out.push({ key: 'diary', e: '📖', text: `${pn} ya escribió en el diario de hoy: escribe tu línea para leerla`, short: `${pn} ya escribió` });
  else if (new Date().getHours() >= 19) out.push({ key: 'diary', e: '📖', text: '¿Cómo estuvo tu día? Escribe tu línea del diario', short: 'Escribe tu línea de hoy' });
  return out;
}
export const diarySub = () => myDiaryDone() ? (partnerDiaryDone() ? 'Hoy escribieron los dos ✨' : `Esperando a ${esc(partnerName())}`) : 'Una línea de cada uno, cada noche';

const line = (who, e, mine) => `<div class="answer diary-line"><b class="who">${avatar(who, 22)}${mine ? 'Tú' : esc(nameOf(who))} ${e.e || ''}</b>${esc(e.text)}
  <span class="tiny muted" style="display:block">${new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span></div>`;

function todayBox() {
  const p = partnerUid(), tk = todayKey(), mine = entry(tk, uid()), theirs = p && entry(tk, p);
  if (!mine || editing) {
    const e = pickE || mine?.e || '';
    return `<div class="glass stack"><span class="label">${icon('book')} Hoy</span>
      <div class="chips scroll">${EMOJIS.map(x => `<button class="chip ${e === x ? 'on' : ''}" onclick="diaryEmoji('${x}')" aria-label="${x}">${x}</button>`).join('')}</div>
      <textarea id="diaryText" maxlength="280" placeholder="¿Cómo estuvo tu día? Una o dos líneas…" style="min-height:80px" aria-label="Tu línea de hoy">${mine && editing ? esc(mine.text) : ''}</textarea>
      <button class="btn" onclick="saveDiary()">${mine ? 'Guardar cambios' : 'Guardar'}</button>
      <p class="small muted" style="margin:0">${theirs ? `${icon('lock')} ${esc(partnerName())} ya escribió. Escribe la tuya para leerla.` : `${esc(partnerName())} todavía no escribe.`}</p></div>`;
  }
  return `<div class="glass stack"><div class="row"><span class="label">${icon('book')} Hoy</span><button class="link" onclick="diaryEdit()">Editar la mía</button></div>
    ${line(uid(), mine, true)}${theirs ? line(p, theirs) : `<p class="small muted" style="margin:0">Esperando la de ${esc(partnerName())}…</p>`}</div>`;
}

function render() {
  const p = partnerUid(), tk = todayKey();
  const all = (S.data.diary || []).filter(d => d.id < tk && (d[uid()] || (p && d[p]))).sort((a, b) => b.id.localeCompare(a.id));
  const months = [...new Set(all.map(d => d.id.slice(0, 7)))];
  if (!month || !months.includes(month)) month = months[0] || '';
  const list = all.filter(d => d.id.startsWith(month));
  const mName = k => { const s = parseDate(k + '-01').toLocaleDateString('es', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const mAll = (S.data.diary || []).filter(d => d.id.startsWith(month));
  const both = mAll.filter(d => d[uid()] && p && d[p]).length;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  paint('s-diary', `${backBar('Diario de los dos')}
    ${todayBox()}
    ${months.length ? `<div class="chips scroll">${months.map(m => `<button class="chip ${m === month ? 'on' : ''}" onclick="diaryMonth('${m}')">${mName(m)}</button>`).join('')}</div>
      <div class="glass stack" style="gap:4px"><span class="small"><b>${mName(month)}</b>: escribieron los dos ${plural(both, 'día', 'días')}</span>
        <span class="tiny muted">Tú ${mAll.filter(d => d[uid()]).length} · ${esc(partnerName())} ${p ? mAll.filter(d => d[p]).length : 0}</span></div>
      ${list.map(d => `<div class="glass stack" style="gap:8px"><span class="small muted">${cap(parseDate(d.id).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
        ${d[uid()] ? line(uid(), d[uid()], true) : '<p class="tiny muted" style="margin:0">Tú no escribiste ese día</p>'}
        ${p ? (d[p] ? line(p, d[p]) : `<p class="tiny muted" style="margin:0">${esc(partnerName())} no escribió ese día</p>`) : ''}</div>`).join('')}`
      : '<p class="empty">Aquí van a quedar sus días, uno por uno. Con el tiempo es un diario de su vida juntos 💞</p>'}`);
}

function diaryEmoji(e) { pickE = pickE === e ? '' : e; render(); }
function diaryEdit() { editing = true; pickE = entry(todayKey(), uid())?.e || ''; render(); setTimeout(() => $('diaryText')?.focus(), 50); }
function diaryMonth(m) { month = m; render(); }
function saveDiary() {
  const text = $('diaryText')?.value.trim();
  if (!text) return toast('Escribe cómo estuvo tu día');
  const tk = todayKey(), first = !myDiaryDone(), e = pickE || entry(tk, uid())?.e || '';
  write(setDoc(ref('diary', tk), { [uid()]: { text, e, at: entry(tk, uid())?.at || Date.now() } }, { merge: true }));
  editing = false; pickE = '';
  if (first) {
    markActive(); celebrate('hearts');
    toast(partnerDiaryDone() ? `Guardado. Ya puedes leer la de ${partnerName()}` : 'Guardado 📖');
    notify('diary', { title: `📖 ${meForPartner()} escribió en el diario de hoy`, body: partnerDiaryDone() ? 'Ya pueden leer las dos líneas' : 'Escribe la tuya para leerla', url: './?open=diary', tag: 'diary-' + tk });
  } else toast('Cambios guardados');
}

on('diary profiles', () => { if ($('s-diary')?.classList.contains('active')) render(); });
onShow('s-diary', render);
expose({ diaryEmoji, diaryEdit, diaryMonth, saveDiary });
