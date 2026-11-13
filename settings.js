// Ajustes: datos de la pareja, personalización, respaldo y sesión. También la pantalla "Más".
import { setDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { $, S, db, auth, esc, icon, paint, on, onShow, expose, toast, write, ref, privRef, coupleRef, go,
         COLLECTIONS, PRIVATE, cachePhoto, forgetPhoto, compressImage, photoError, loadPhotos, parseDate, today, dayKey,
         fmtMoney, nameOf, partnerUid, partnerName, myName, profile, plural, uid, avatar, ask } from './core.js';
import { ACCENTS, CURRENCIES, accentFromColor } from './data.js';
import { backBar, groceryPending } from './lists.js';
import { balance } from './money.js';
import { badgeCount } from './badges.js';
import { pinEnabled } from './lock.js';
import { quizWaiting } from './quiz.js';
import { homeLayout, HOME_CARDS, COUNTER_UNITS } from './home.js';
import { isTester } from './testing.js';

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
      ${tile('s-reminders', 'bell', 'Recordatorios', (n => n ? plural(n, 'pendiente', 'pendientes') : 'Nada pendiente')(S.data.reminders.filter(r => !r.done).length))}
      ${tile('s-recipes', 'pot', 'Recetas', S.data.menu.length ? 'Recetas y menú semanal' : `Más de 40 recetas`)}
      ${tile('s-map', 'map', 'Nuestro mapa', plural(S.data.pins.length, 'lugar', 'lugares'))}
      ${tile('s-music', 'music', 'Su playlist', plural(S.data.songs.length, 'canción', 'canciones'))}
      ${tile('s-badges', 'medal', 'Logros', ` de `)}
      ${tile('s-game', 'flame', 'Juego de retos', 'Verdad o reto y más')}
      ${tile('s-us', 'heart', 'Gustos y regalos', 'Tallas, antojos, ideas')}
      ${tile('s-quiz', 'brain', '¿Cuánto me conoces?', quizWaiting() ? `${esc(pn)} ya jugó` : 'Quiz de pareja', quizWaiting() ? 1 : 0)}
      ${tile('s-bucket', 'list', 'Bucket list', `${bucketDone} de ${S.data.bucket.length} cumplidas`)}
      ${tile('s-summary', 'spark', 'Resumen del año', `Su ${today().getFullYear()} en números`)}
      ${isTester() ? tile('s-admin', 'gear', 'Administración', 'Solo tú la ves') : ''}
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
      <div class="swatches">${ACCENTS.map(([k, l, a, b]) => `<button class="${accent === k ? 'on' : ''}" style="background:linear-gradient(135deg,${a},${b})" aria-label="${l}" title="${l}" onclick="setAccent('${k}')"></button>`).join('')}
        <label class="swatch-custom ${accent === 'custom' ? 'on' : ''}" title="Elegir mi color" aria-label="Elegir mi color"${accent === 'custom' ? ` style="background:linear-gradient(135deg,${esc(prefs.customAccent || '#FF5C8A')},${accentFromColor(prefs.customAccent)[1]})"` : ''}>
          <span>${accent === 'custom' ? '' : '+'}</span><input type="color" value="${esc(prefs.customAccent || '#FF5C8A')}" oninput="previewCustomAccent(this.value)" onchange="setCustomAccent(this.value)"></label></div>
      <p class="tiny muted" style="margin:0">${esc((ACCENTS.find(x => x[0] === accent) || [, 'Tu color'])[1])} · toca el último cuadro para elegir tu propio color.</p>
      <span class="label" style="margin-top:6px">Apariencia</span>
      <div class="seg">${[['dark', 'Oscuro'], ['light', 'Claro'], ['auto', 'Automático']].map(([k, l]) => `<button class="${(prefs.theme || 'dark') === k ? 'on' : ''}" onclick="setTheme('${k}')">${l}</button>`).join('')}</div>
      <span class="label" style="margin-top:6px">Foto de fondo del contador</span>
      ${prefs.bg ? `<img data-photo="bg-${uid()}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:16px">` : ''}
      <div class="grid2"><label class="btn ghost small" style="width:100%">${icon('photo')} ${prefs.bg ? 'Cambiar' : 'Elegir foto'}<input type="file" accept="image/*" hidden onchange="pickBg(this)"></label>
        ${prefs.bg ? `<button class="btn ghost small" style="width:100%" onclick="removeBg()">Quitar</button>` : ''}</div></div>

    ${homePrefsCard(prefs, p)}

    <div class="glass stack"><span class="label">${icon('lock')} Bloqueo con PIN</span>
      <p class="small muted" style="margin:0">Opcional. Pide un código de 4 números al abrir la app en este teléfono (y si estuvo cerrada más de un minuto).</p>
      ${pinEnabled() ? `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="setupPin()">Cambiar PIN</button><button class="btn ghost small" style="width:100%" onclick="disablePin()">Desactivar</button></div>` : `<button class="btn ghost" onclick="setupPin()">Activar bloqueo con PIN</button>`}</div>

    <div class="glass stack"><span class="label">Respaldo</span>
      <p class="small muted" style="margin:0">Todo está guardado en la nube. Igual pueden descargar una copia (sin las fotos). ${S.settings.lastBackup ? `Último respaldo: ${new Date(S.settings.lastBackup).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Aún no han descargado ninguno.'}</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="exportData()">Descargar</button>
        <label class="btn ghost small" style="width:100%">Subir respaldo<input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label></div></div>

    <div class="glass"><span class="label">Ideas propias de la ruleta</span>
      <ul class="list" style="margin-top:6px">${S.data.ideas.length ? S.data.ideas.map(i => `<li><span class="txt">${esc(i.t)}</span>
        <button class="del" aria-label="Borrar" onclick="delIdea('${i.id}')">${icon('trash')}</button></li>`).join('') : '<li class="empty">Aún no agregan ideas propias</li>'}</ul></div>

    <div class="glass stack"><span class="label">Sesión</span><p class="small muted" style="margin:0">Entraste como ${esc(S.me.email)}</p>
      <p class="tiny muted" style="margin:0">Futari guarda la hora, el modelo de teléfono, el navegador y la versión de la app cada vez que alguno de los dos la abre, para estadísticas de uso y para encontrar errores.</p>
      <button class="btn ghost" onclick="startTour()">Ver la guía otra vez</button>
      <button class="btn danger" onclick="logout()">Cerrar sesión</button></div>
    ${isTester() ? `<button class="btn ghost" onclick="go('s-admin')">${icon('gear')} Abrir administración</button>` : ''}`);
  loadPhotos($('s-settings'));
}
/* ---------- Tu Inicio: apodos, contador y tarjetas (solo para quien lo configura) ---------- */
const savePrefs = patch => write(setDoc(ref('profiles', uid()), { prefs: patch }, { merge: true }));
function homePrefsCard(prefs, p) {
  const c = prefs.counter || {}, custom = c.from === 'custom', layout = homeLayout();
  return `<div class="glass stack"><span class="label">${icon('heart')} Tu Inicio</span>
    <p class="small muted" style="margin:0">Solo cambia lo que ves tú.</p>
    <span class="label" style="margin-top:4px">Apodos</span>
    <div><label class="f" for="nickMe">¿Cómo te saluda la app?</label><input id="nickMe" data-fresh maxlength="24" placeholder="${esc(myName() || 'Tu nombre')}" value="${esc(prefs.myNick || '')}"></div>
    ${p ? `<div><label class="f" for="nickPartner">¿Cómo aparece ${esc(S.settings.members?.[p]?.name || 'tu pareja')} en tu app?</label><input id="nickPartner" data-fresh maxlength="24" placeholder="Ej: Mi amor, Bebé, Gordo…" value="${esc(prefs.partnerNick || '')}"></div>` : ''}
    <button class="btn ghost small" onclick="saveNicks()">Guardar apodos</button>

    <span class="label" style="margin-top:8px">Contador</span>
    <div class="seg">${COUNTER_UNITS.map(([k, l]) => `<button class="${(c.unit || 'days') === k ? 'on' : ''}" onclick="setCounterUnit('${k}')">${l}</button>`).join('')}</div>
    <div><label class="f" for="cntFrom">Contar desde</label><select id="cntFrom" onchange="document.getElementById('cntCustom').hidden=this.value!=='custom'">
      <option value="start" ${!custom ? 'selected' : ''}>El día que empezaron${S.settings.start ? ` (${fmtShortYear(S.settings.start)})` : ''}</option>
      <option value="custom" ${custom ? 'selected' : ''}>Otra fecha</option></select></div>
    <div id="cntCustom" class="stack" style="gap:10px" ${custom ? '' : 'hidden'}>
      <div class="grid2"><div><label class="f" for="cntDate">Fecha</label><input type="date" id="cntDate" data-fresh value="${esc(c.date || '')}"></div>
        <div><label class="f" for="cntLabel">Texto</label><input id="cntLabel" data-fresh maxlength="40" placeholder="desde que nos conocimos" value="${esc(c.label || '')}"></div></div>
      <p class="tiny muted" style="margin:0">Se lee así: "120 días <i>desde que nos conocimos</i>".</p></div>
    <button class="btn ghost small" onclick="saveCounter()">Guardar contador</button>

    <span class="label" style="margin-top:8px">Tarjetas de Inicio</span>
    <p class="tiny muted" style="margin:0">Elige cuáles ves y en qué orden.</p>
    <ul class="list home-cards">${layout.map((x, i) => `<li><input type="checkbox" ${x.on ? 'checked' : ''} aria-label="Mostrar ${esc(cardName(x.id))}" onchange="toggleHomeCard('${x.id}', this.checked)">
      <span class="txt ${x.on ? '' : 'muted'}">${esc(cardName(x.id))}</span>
      <button class="del" aria-label="Subir" ${i === 0 ? 'disabled' : ''} onclick="moveHomeCard(${i},-1)">▲</button><button class="del" aria-label="Bajar" ${i === layout.length - 1 ? 'disabled' : ''} onclick="moveHomeCard(${i},1)">▼</button></li>`).join('')}</ul>
    <button class="link" onclick="resetHome()">Volver al orden original</button></div>`;
}
const cardName = id => HOME_CARDS.find(([k]) => k === id)?.[1] || id;
const fmtShortYear = d => parseDate(d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
function saveNicks() { savePrefs({ myNick: $('nickMe').value.trim(), partnerNick: $('nickPartner')?.value.trim() || '' }); toast('Apodos guardados'); }
function setCounterUnit(u) { savePrefs({ counter: { ...(profile(uid()).prefs?.counter || {}), unit: u } }); }
function saveCounter() {
  const from = $('cntFrom').value, date = $('cntDate')?.value || '';
  if (from === 'custom' && !date) return toast('Elige la fecha');
  if (from === 'custom' && parseDate(date) > today()) return toast('La fecha no puede ser futura');
  savePrefs({ counter: { ...(profile(uid()).prefs?.counter || {}), from, date, label: $('cntLabel')?.value.trim() || '' } }); toast('Contador guardado');
}
function toggleHomeCard(id, on) { savePrefs({ home: homeLayout().map(c => c.id === id ? { ...c, on } : c) }); }
function moveHomeCard(i, d) {
  const l = homeLayout(), j = i + d; if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; savePrefs({ home: l });
}
function resetHome() { savePrefs({ home: HOME_CARDS.map(([id]) => ({ id, on: true })) }); toast('Inicio como al principio'); }

function saveSettings() {
  const name = $('setName').value.trim(), start = $('setStart').value;
  if (!name || !start) return toast('Completa tu nombre y la fecha');
  if (parseDate(start) > today()) return toast('La fecha no puede ser futura');
  const joined = S.settings.members?.[uid()]?.joined || Date.now();
  write(setDoc(coupleRef, { start, currency: $('setCurrency').value, members: { [uid()]: { name, joined } } }, { merge: true }));
  toast('Guardado');
}
// Aplica los colores de acento como variables CSS en <body>. Se guardan también en el teléfono para pintarlos
// antes de que cargue la app (ver el script al inicio de index.html).
export function applyAccent(a, custom) {
  if (!a) return;
  const c = a === 'custom' ? accentFromColor(custom) : ACCENTS.find(x => x[0] === a)?.slice(2);
  if (!c) return;
  document.body.dataset.accent = a;
  const vars = { '--g1': c[0], '--g2': c[1], '--g3': c[2], '--on-grad': c[3] };
  for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
  try { localStorage.setItem('nosotros-accent', a); localStorage.setItem('futari-accent-vars', JSON.stringify(vars)); } catch {}
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
// Mientras se mueve el selector se ve en vivo; al soltarlo se guarda.
function previewCustomAccent(hex) { applyAccent('custom', hex); }
function setCustomAccent(hex) { applyAccent('custom', hex); write(setDoc(ref('profiles', uid()), { prefs: { accent: 'custom', customAccent: hex } }, { merge: true })); }
async function pickBg(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  try {
    const data = await compressImage(f, 1100);
    const batch = writeBatch(db);
    batch.set(ref('photos', `bg-${uid()}`), { data });
    batch.set(ref('profiles', uid()), { prefs: { bg: true } }, { merge: true });
    cachePhoto(`bg-${uid()}`, data);
    write(batch.commit()); toast('Foto de fondo lista');
  } catch (e) { photoError(e); }
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
  } catch (e) { photoError(e); }
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
  write(setDoc(coupleRef, { lastBackup: Date.now() }, { merge: true }));
  const out = { version: 4, start: S.settings.start, currency: S.settings.currency, members: S.settings.members };
  for (const c of COLLECTIONS) out[c] = S.data[c];
  out.cards = S.data.cards.filter(c => c.level !== 'ours'); // las de "Solo nosotros" no salen del teléfono
  for (const c of PRIVATE) out[c] = S.priv[c];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `futari-respaldo-${dayKey(new Date())}.json`;
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

on('groceries expenses trips places bucket quiz shows events pins songs menu notes moments thinks answers daily', renderMore);
on('ideas profiles', () => { if ($('s-settings').classList.contains('active')) renderSettings(); });
onShow('s-settings', renderSettings);
window.rerenderSettings = () => { if ($('s-settings').classList.contains('active')) renderSettings(); };
onShow('s-more', renderMore);
expose({ previewCustomAccent, setCustomAccent, saveNicks, setCounterUnit, saveCounter, toggleHomeCard, moveHomeCard, resetHome, saveSettings, setTheme, setAccent, pickAvatar, removeAvatar, pickBg, removeBg, delIdea, logout, exportData, importData });
