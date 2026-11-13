// Foto del día: cada uno sube una foto diaria. La de tu pareja de hoy se revela cuando subes la tuya.
import { setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, expose, toast, openSheet, closeSheet, write, ref, cachePhoto, compressImage, photoError, makeThumb, thumbId,
         today, dayKey, todayKey, parseDate, nameOf, partnerUid, partnerName, plural, uid, celebrate } from './core.js';
import { placeField, initPlace, getPlace, placeFromPhoto } from './location.js';

export const dailyPhotoId = (day, who) => `d-${day}-${who}`;
const entry = (day, who) => S.data.daily.find(d => d.id === day)?.[who];
const bothPosted = day => { const p = partnerUid(); return !!p && !!entry(day, uid()) && !!entry(day, p); };
export function dailyStreak() {
  let d = today(), n = 0;
  if (!bothPosted(dayKey(d))) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  while (n < 3660 && bothPosted(dayKey(d))) { n++; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); }
  return n;
}
export const dailyBothDays = () => S.data.daily.filter(d => bothPosted(d.id)).length;
export const myDailyDone = () => !!entry(todayKey(), uid());
export const partnerDailyDone = () => { const p = partnerUid(); return !!p && !!entry(todayKey(), p); };

const slot = (day, who, revealed) => {
  const e = entry(day, who);
  if (!e) return `<div class="daily-slot empty"><span class="small muted">${who === uid() ? 'Aún no subes tu foto' : `${esc(nameOf(who))} aún no sube la suya`}</span></div>`;
  if (!revealed) return `<div class="daily-slot locked"><span style="font-size:28px">🔒</span><span class="small">${esc(nameOf(who))} ya subió su foto</span><span class="tiny muted">Sube la tuya para verla</span></div>`;
  return `<button class="daily-slot" onclick="viewPhoto(this.querySelector('img'))" aria-label="Foto de ${esc(nameOf(who))}">
    <img data-thumb="${e.photo}" alt=""><span class="daily-cap"><b>${esc(nameOf(who))}</b>${e.caption ? ' · ' + esc(e.caption) : ''}<span class="tiny"> · ${new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>${e.place ? `<span class="tiny" style="display:block">📍 ${esc(e.place.name)}</span>` : ''}</span></button>`;
};

export function dailyHTML() {
  const p = partnerUid(), tk = todayKey(), mine = !!entry(tk, uid()), s = dailyStreak();
  const past = S.data.daily.filter(d => d.id !== tk).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
  return `
    <div class="glass stack"><div class="row"><span class="label">${icon('photo')} Hoy</span>${s ? `<span class="pill hot">📷 ${plural(s, 'día', 'días')} seguidos</span>` : ''}</div>
      <div class="daily-pair">${slot(tk, uid(), true)}${p ? slot(tk, p, mine) : ''}</div>
      <label class="btn ${mine ? 'ghost' : ''}">${icon('photo')} ${mine ? 'Cambiar mi foto de hoy' : 'Subir mi foto de hoy'}<input type="file" accept="image/*" hidden onchange="pickDaily(this)"></label>
      <p class="tiny muted center" style="margin:0">Una foto al día de lo que están haciendo. Con el tiempo queda un álbum de su vida diaria.</p></div>
    ${past.length ? `<span class="label">Días anteriores</span>${past.map(d => `<div class="glass stack" style="gap:8px">
      <span class="small muted">${cap(parseDate(d.id).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
      <div class="daily-pair">${slot(d.id, uid(), true)}${p ? slot(d.id, p, true) : ''}</div></div>`).join('')}` : ''}`;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

let pending = null;
async function pickDaily(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try { pending = await compressImage(f, 1080); } catch (e) { return photoError(e); }
  const file = f;
  openSheet(`<div class="stack"><h2>Tu foto de hoy</h2><img src="${pending}" alt="" style="width:100%;max-height:50vh;object-fit:cover;border-radius:18px">
    <input id="dailyCap" placeholder="¿Qué están haciendo? (opcional)" maxlength="80" aria-label="Descripción">
    ${placeField('dailyPlace')}
    <button class="btn" id="dailyBtn" onclick="saveDaily()">Publicar</button></div>`);
  initPlace('dailyPlace'); placeFromPhoto('dailyPlace', file);
}
async function saveDaily() {
  if (!pending) return;
  $('dailyBtn').disabled = true;
  const day = todayKey(), id = dailyPhotoId(day, uid());
  const thumb = await makeThumb(pending).catch(() => null);
  const batch = writeBatch(db);
  batch.set(ref('photos', id), { data: pending }); cachePhoto(id, pending);
  if (thumb) { batch.set(ref('photos', thumbId(id)), { data: thumb }); cachePhoto(thumbId(id), thumb); }
  batch.set(ref('daily', day), { [uid()]: { photo: id, caption: $('dailyCap').value.trim(), place: getPlace('dailyPlace'), at: Date.now() } }, { merge: true });
  write(batch.commit());
  const first = !entry(day, uid());
  pending = null; closeSheet();
  toast(partnerDailyDone() ? `¡Listo! Ya puedes ver la foto de ${partnerName()}` : 'Foto publicada');
  if (first) celebrate();
}

expose({ pickDaily, saveDaily });
