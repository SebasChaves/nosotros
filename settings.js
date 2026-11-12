// Ajustes: datos de la pareja, personalización, respaldo y sesión. También la pantalla "Más".
import { setDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { $, S, db, auth, esc, icon, paint, on, onShow, expose, toast, write, ref, privRef, coupleRef, go,
         COLLECTIONS, PRIVATE, cachePhoto, forgetPhoto, compressImage, loadPhotos, parseDate, today, dayKey,
         fmtMoney, nameOf, partnerUid, partnerName, myName, profile, plural, uid, avatar, ask } from './core.js';
import { ACCENTS, CURRENCIES } from './data.js';
import { backBar, groceryPending } from './lists.js';
import { balance } from './money.js';
import { quizWaiting } from './quiz.js';
import { testerCard } from './testing.js';

/* ---------- Más ---------- */
function renderMore() {
  const bal = balance(), pn = partnerName();
  const nextTrip = S.data.trips.filter(t => t.start && parseDate(t.start) >= today()).sort((a, b) => a.start.localeCompare(b.start))[0];
  const bucketDone = S.data.bucket.filter(b => b.done).length;
  const tk = dayKey(today());
  const nextPlan = S.data.events.filter(e => e.date >= tk).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
  const tile = (id, ic, title, sub, dot = 0) => `<button class="tile" onclick="go('${id}')"><span class="badge-ic">${icon(ic)}</span>
    <div><b>${title}</b></div><span class="sub">${sub}</span>${dot ? `<b class="dot">${dot}</b>` : ''}</button>`;
  paint('s-more', `<div class="topbar"><h1>Más</h1><div class="row" style="gap:8px"><button class="icon-btn" aria-label="Buscar" onclick="openSearch()">${icon('search')}</button><button class="icon-btn" aria-label="Ajustes" onclick="go('s-settings')">${icon('gear')}</button></div></div>
    <div class="tiles">
      ${tile('s-grocery', 'cart', 'Súper', groceryPending() ? plural(groceryPending(), 'cosa por comprar', 'cosas por comprar') : 'Nada pendiente')}
      ${tile('s-money', 'wallet', 'Gastos', bal > 0 ? `${pn} te debe ${fmtMoney(bal)}` : bal < 0 ? `Debes ${fmtMoney(-bal)}` : 'Están a mano')}
      ${tile('s-trips', 'plane', 'Viajes', nextTrip ? esc(nextTrip.name) : 'Planear un viaje')}
      ${tile('s-places', 'fork', 'Restaurantes', plural(S.data.places.length, 'lugar', 'lugares'))}
      ${tile('s-shows', 'film', 'Pelis y series', plural(S.data.shows.filter(s => (s.status || 'want') === 'want').length, 'por ver', 'por ver'))}
      ${tile('s-cal', 'cal', 'Calendario', nextPlan ? esc(nextPlan.title) : 'Planes de los dos')}
      ${tile('s-game', 'flame', 'Juego de retos', 'Verdad o reto y más')}
      ${tile('s-us', 'heart', 'Gustos y regalos', 'Tallas, antojos, ideas')}
      ${tile('s-quiz', 'brain', '¿Cuánto me conoces?', quizWaiting() ? `${esc(pn)} ya jugó` : 'Quiz de pareja', quizWaiting() ? 1 : 0)}
      ${tile('s-bucket', 'list', 'Bucket list', `${bucketDone} de ${S.data.bucket.length} cumplidas`)}
      ${tile('s-summary', 'spark', 'Resumen del año', `Su ${today().getFullYear()} en números`)}
    </div>`);
}

/* ---------- Ajustes ---------- */
function renderSettings() {
  const p = partnerUid(), prefs = profile(uid()).prefs || {};
  const accent = prefs.accent || document.body.dataset.accent || 'aurora';
  paint('s-settings', `${backBar('Ajustes')}
    <div class="glass stack"><span class="label">${icon('heart')} Ustedes</span>
      <div class="row start" style="gap:14px">${avatar(uid(), 72)}<div class="stack" style="gap:6px">
        <label class="btn ghost small">${icon('photo')} ${profile(uid()).avatar ? 'Cambiar foto' : 'Poner foto de perfil'}<input type="file" accept="image/*" hidden onchange="pickAvatar(this)"></label>
        ${profile(uid()).avatar ? `<button class="link" style="text-align:left" onclick="removeAvatar()">Quitar foto</button>` : ''}</div></div>
      <div><label class="f" for="setName">Tu nombre</label><input id="setName" maxlength="30" value="${esc(myName())}"></div>
      <div><label class="f" for="setStart">¿Cuándo empezaron?</label><input type="date" id="setStart" value="${esc(S.settings.start || '')}"></div>
      <div><label class="f" for="setCurrency">Moneda para Gastos</label><select id="setCurrency">${CURRENCIES.map(([c, l]) =>
        `<option value="${c}" ${S.settings.currency === c ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="small muted" style="margin:0">${p ? `Conectado con ${esc(nameOf(p))}` : 'Tu pareja aparecerá aquí cuando entre por primera vez y ponga su nombre.'}</p>
      <button class="btn" onclick="saveSettings()">Guardar</button></div>

    <div class="glass stack"><span class="label">${icon('spark')} Tu estilo</span>
      <p class="small muted" style="margin:0">Solo cambia cómo se ve la app en tu teléfono.</p>
      <div class="swatches">${ACCENTS.map(([k, l, a, b]) => `<button class="${accent === k ? 'on' : ''}" style="background:linear-gradient(135deg,${a},${b})" aria-label="${l}" title="${l}" onclick="setAccent('${k}')"></button>`).join('')}</div>
      <span class="label" style="margin-top:6px">Apariencia</span>
      <div class="seg">${[['dark', 'Oscuro'], ['light', 'Claro'], ['auto', 'Automático']].map(([k, l]) => `<button class="${(prefs.theme || 'dark') === k ? 'on' : ''}" onclick="setTheme('${k}')">${l}</button>`).join('')}</div>
      <span class="label" style="margin-top:6px">Foto de fondo del contador</span>
      ${prefs.bg ? `<img data-photo="bg-${uid()}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:16px">` : ''}
      <div class="grid2"><label class="btn ghost small" style="width:100%">${icon('photo')} ${prefs.bg ? 'Cambiar' : 'Elegir foto'}<input type="file" accept="image/*" hidden onchange="pickBg(this)"></label>
        ${prefs.bg ? `<button class="btn ghost small" style="width:100%" onclick="removeBg()">Quitar</button>` : ''}</div></div>

    <div class="glass stack"><span class="label">Respaldo</span>
      <p class="small muted" style="margin:0">Todo está guardado en la nube. Igual pueden descargar una copia (sin las fotos).</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="exportData()">Descargar</button>
        <label class="btn ghost small" style="width:100%">Subir respaldo<input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label></div></div>

    <div class="glass"><span class="label">Ideas propias de la ruleta</span>
      <ul class="list" style="margin-top:6px">${S.data.ideas.length ? S.data.ideas.map(i => `<li><span class="txt">${esc(i.t)}</span>
        <button class="del" aria-label="Borrar" onclick="delIdea('${i.id}')">${icon('trash')}</button></li>`).join('') : '<li class="empty">Aún no agregan ideas propias</li>'}</ul></div>

    <div class="glass stack"><span class="label">Sesión</span><p class="small muted" style="margin:0">Entraste como ${esc(S.me.email)}</p>
      <button class="btn ghost" onclick="startTour()">Ver la guía otra vez</button>
      <button class="btn danger" onclick="logout()">Cerrar sesión</button></div>
    ${testerCard()}`);
  loadPhotos($('s-settings'));
}
function saveSettings() {
  const name = $('setName').value.trim(), start = $('setStart').value;
  if (!name || !start) return toast('Completa tu nombre y la fecha');
  if (parseDate(start) > today()) return toast('La fecha no puede ser futura');
  const joined = S.settings.members?.[uid()]?.joined || Date.now();
  write(setDoc(coupleRef, { start, currency: $('setCurrency').value, members: { [uid()]: { name, joined } } }, { merge: true }));
  toast('Guardado');
}
export function applyAccent(a) {
  if (!a) return;
  document.body.dataset.accent = a;
  try { localStorage.setItem('nosotros-accent', a); } catch {}
}
// Tema claro u oscuro; "auto" sigue al teléfono.
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme(th) {
  th = th || localStorage.getItem('nosotros-theme') || 'dark';
  const real = th === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : th;
  document.body.dataset.theme = real;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', real === 'light' ? '#FBF6F8' : '#140C1C');
  try { localStorage.setItem('nosotros-theme', th); } catch {}
}
darkMQ.addEventListener?.('change', () => { if ((localStorage.getItem('nosotros-theme') || 'dark') === 'auto') applyTheme('auto'); });
function setTheme(th) { applyTheme(th); write(setDoc(ref('profiles', uid()), { prefs: { theme: th } }, { merge: true })); }
function setAccent(a) { applyAccent(a); write(setDoc(ref('profiles', uid()), { prefs: { accent: a } }, { merge: true })); }
async function pickBg(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try {
    const data = await compressImage(f, 1100);
    const batch = writeBatch(db);
    batch.set(ref('photos', `bg-${uid()}`), { data });
    batch.set(ref('profiles', uid()), { prefs: { bg: true } }, { merge: true });
    cachePhoto(`bg-${uid()}`, data);
    write(batch.commit()); toast('Foto de fondo lista');
  } catch { toast('No se pudo leer esa foto'); }
}
async function pickAvatar(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try {
    const data = await compressImage(f, 400);
    const old = profile(uid()).avatar, id = `avatar-${uid()}-${Date.now()}`;
    const batch = writeBatch(db);
    batch.set(ref('photos', id), { data });
    if (old) batch.delete(ref('photos', old));
    batch.set(ref('profiles', uid()), { avatar: id }, { merge: true });
    cachePhoto(id, data);
    write(batch.commit()); toast('Foto de perfil lista');
  } catch { toast('No se pudo leer esa foto'); }
}
function removeAvatar() {
  const old = profile(uid()).avatar; if (!old) return;
  const batch = writeBatch(db);
  batch.delete(ref('photos', old));
  batch.set(ref('profiles', uid()), { avatar: null }, { merge: true });
  write(batch.commit());
}
function removeBg() {
  const batch = writeBatch(db);
  batch.delete(ref('photos', `bg-${uid()}`));
  batch.set(ref('profiles', uid()), { prefs: { bg: false } }, { merge: true });
  forgetPhoto(`bg-${uid()}`); write(batch.commit());
}
function delIdea(id) { write(deleteDoc(ref('ideas', id))); }
async function logout() { if (await ask('¿Cerrar sesión en este teléfono?')) { go('s-home'); signOut(auth); } }

/* ---------- Respaldo ---------- */
function exportData() {
  const out = { version: 4, start: S.settings.start, currency: S.settings.currency, members: S.settings.members };
  for (const c of COLLECTIONS) out[c] = S.data[c];
  out.cards = S.data.cards.filter(c => c.level !== 'ours'); // las de "Solo nosotros" no salen del teléfono
  for (const c of PRIVATE) out[c] = S.priv[c];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nosotros-respaldo-${dayKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Convierte el formato de la primera versión (solo en el teléfono) al actual.
function fromV1(d) {
  return {
    start: d.start,
    members: d.name1 && !S.settings.members?.[uid()] ? { [uid()]: { name: d.name1, joined: Date.now() } } : null,
    ideas: (d.ideas || []).map(i => ({ ...i, by: uid() })),
    bucket: (d.bucket || []).map(b => ({ ...b, doneAt: b.doneAt || null, createdAt: b.createdAt || Date.now(), by: uid() })),
    notes: (d.notes || []).map(n => ({
      id: n.id, text: n.text, createdAt: n.createdAt || Date.now(), readAt: n.readAt || null,
      fromUid: n.from === 2 ? 'antes-pareja' : uid(), fromName: (n.from === 2 ? d.name2 : d.name1) || '',
    })),
  };
}
// Sube un respaldo. Usa los mismos IDs, así que subir el mismo respaldo dos veces no duplica nada.
export async function uploadData(raw) {
  const d = raw.version ? raw : fromV1(raw);
  const ops = [], patch = {};
  if (d.start && !S.settings.start) patch.start = d.start;
  if (d.currency) patch.currency = d.currency;
  if (d.members) patch.members = d.members;
  if (Object.keys(patch).length) ops.push(b => b.set(coupleRef, patch, { merge: true }));
  for (const c of COLLECTIONS) for (const item of d[c] || []) {
    if (!item?.id) continue;
    const { id, ...rest } = item; ops.push(b => b.set(ref(c, id), rest));
  }
  for (const c of PRIVATE) for (const item of d[c] || []) {
    if (!item?.id) continue;
    const { id, ...rest } = item; ops.push(b => b.set(privRef(c, id), rest));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}
function importData(input) {
  const f = input.files[0]; if (!f) return;
  f.text().then(async txt => {
    const d = JSON.parse(txt);
    if (typeof d !== 'object' || !Array.isArray(d.bucket)) throw 0;
    if (!await ask('Se agregarán los datos del respaldo a los actuales. ¿Continuar?')) return;
    return uploadData(d).then(() => toast('Respaldo subido'));
  }).catch(() => toast('Ese archivo no es un respaldo válido'));
  input.value = '';
}

on('groceries expenses trips places bucket quiz shows events', renderMore);
on('ideas profiles', () => { if ($('s-settings').classList.contains('active')) renderSettings(); });
onShow('s-settings', renderSettings);
onShow('s-more', renderMore);
expose({ saveSettings, setTheme, setAccent, pickAvatar, removeAvatar, pickBg, removeBg, delIdea, logout, exportData, importData });
