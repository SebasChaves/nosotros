// Ajustes: datos de la pareja, personalización, respaldo y sesión. También la pantalla "Más".
import { setDoc, deleteDoc, writeBatch, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { $, S, db, auth, esc, icon, paint, on, onShow, expose, toast, write, ref, col, privRef, coupleRef, go, openSheet, closeSheet,
         COLLECTIONS, PRIVATE, cachePhoto, forgetPhoto, compressImage, photoError, loadPhotos, parseDate, today, dayKey,
         fmtMoney, nameOf, partnerUid, partnerName, myName, profile, plural, uid, avatar, ask, inBar, gateOn, softDelete } from './core.js';
import { ACCENTS, CURRENCIES, accentFromColor } from './data.js';
import { PUSH } from './push-config.js';
import { backBar, groceryPending } from './lists.js';
import { balance } from './money.js';
import { badgeCount } from './badges.js';
import { pinEnabled } from './lock.js';
import { quizWaiting } from './quiz.js';
import { homeLayout, HOME_CARDS, COUNTER_UNITS } from './home.js';
import { isTester } from './testing.js';
import { menuOrder, hiddenInMore, sectionName, sectionIcon, sectionAlerts, menuPrefsCard } from './menu.js';
import { partnerCravings } from './cravings.js';
import { giftTile } from './gifts.js';
import { NOTIF_TYPES, pushConfigured, pushSupported, iosNeedsInstall, pushPermission, pushHere, subsOf, enablePush, disablePush, testPush } from './push.js';

/* ---------- Más ---------- */
function renderMore() {
  const bal = balance(), pn = partnerName();
  const nextTrip = S.data.trips.filter(t => t.start && parseDate(t.start) >= today()).sort((a, b) => a.start.localeCompare(b.start))[0];
  const bucketDone = S.data.bucket.filter(b => b.done).length;
  const tk = dayKey(today());
  const nextPlan = S.data.events.filter(e => e.date >= tk).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
  const tile = (id, ic, title, sub, dot = 0) => `<button class="tile" onclick="go('${id}')"><span class="badge-ic">${icon(ic)}</span>
    <div><b>${title}</b></div><span class="sub">${sub}</span>${dot ? `<b class="dot">${dot}</b>` : ''}</button>`;
  const alerts = sectionAlerts(), pending = n => n ? plural(n, 'pendiente', 'pendientes') : 'Nada pendiente';
  const [bDone, bTotal] = badgeCount(), crav = partnerCravings().length;
  // Subtítulo de cada sección en su mosaico
  const SUB = {
    's-decide': () => 'Listas e ideas de citas', 's-moments': () => 'Fotos, foto del día e historias', 's-love': () => 'Notas y cupones',
    's-cravings': () => crav ? `${pn} tiene ${plural(crav, 'antojo', 'antojos')}` : 'Pide lo que se te antoje',
    's-grocery': () => groceryPending() ? plural(groceryPending(), 'cosa por comprar', 'cosas por comprar') : 'Nada pendiente',
    's-money': () => bal > 0 ? `${pn} te debe ${fmtMoney(bal)}` : bal < 0 ? `Debes ${fmtMoney(-bal)}` : 'Están a mano',
    's-trips': () => nextTrip ? esc(nextTrip.name) : 'Planear un viaje', 's-places': () => plural(S.data.places.length, 'lugar', 'lugares'),
    's-shows': () => plural(S.data.shows.filter(s => (s.status || 'want') === 'want').length, 'por ver', 'por ver'),
    's-cal': () => nextPlan ? esc(nextPlan.title) : 'Planes de los dos', 's-reminders': () => pending(S.data.reminders.filter(r => !r.done).length),
    's-recipes': () => S.data.menu.length ? 'Recetas y menú semanal' : 'Más de 40 recetas', 's-map': () => plural(S.data.pins.length, 'lugar', 'lugares'),
    's-music': () => plural(S.data.songs.length, 'canción', 'canciones'), 's-pet': () => 'Vestir, tienda y juegos', 's-badges': () => `${bDone} de ${bTotal}`,
    's-game': () => 'Verdad o reto y más', 's-us': () => 'Tallas, gustos, ideas', 's-quiz': () => quizWaiting() ? `${esc(pn)} ya jugó` : 'Quiz de pareja',
    's-bucket': () => `${bucketDone} de ${S.data.bucket.length} cumplidas`, 's-admin': () => 'Solo tú la ves', 's-fruta': () => { const L = S.data.fruta?.find(d => d.id === 'p-' + uid())?.lv || 1; return L > 100 ? '🏆 Los 100 niveles' : L > 1 ? `Vas en el nivel ${L} de 100` : 'Junta frutas tropicales'; }, 's-bus': () => { const L = S.data.bus.find(d => d.id === 'p-' + uid())?.lv || 1; return L > 100 ? '🏆 Los 100 niveles' : L > 1 ? `Vas en el nivel ${L} de 100` : 'Lleva a todos a la parada'; }, 's-arrows': () => { const L = S.data.arrows.find(d => d.id === 'p-' + uid())?.lv || 1; return L > 90 ? '🏆 Los 90 niveles' : L > 1 ? `Vas en el nivel ${L} de 90` : 'Saca las flechas del tablero'; }, 's-summary': () => `Su ${today().getFullYear()} en números`,
  };
  const shown = menuOrder().filter(id => !inBar(id) && !hiddenInMore(id)), hidden = menuOrder().filter(id => !inBar(id) && hiddenInMore(id)).length;
  paint('s-more', `<div class="topbar"><h1>Más</h1><div class="row" style="gap:8px"><button class="icon-btn" aria-label="Buscar" onclick="openSearch()">${icon('search')}</button><button class="icon-btn" aria-label="Ajustes" onclick="go('s-settings')">${icon('gear')}</button></div></div>
    <div class="tiles">
      ${giftTile()}
      ${shown.map(id => tile(id, sectionIcon(id), esc(sectionName(id)), SUB[id]?.() || '', alerts[id] || 0)).join('')}
    </div>
    <button class="link" style="align-self:center" onclick="openMenuPrefs()">${icon('edit')} Organizar el menú${hidden ? ` · ${plural(hidden, 'oculta', 'ocultas')}` : ''}</button>`);
}
function openMenuPrefs() { go('s-settings'); setTimeout(() => document.getElementById('menuCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350); }

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
      <span class="label" style="margin-top:6px">Tamaño de letra y botones</span>
      <div class="seg">${TEXT_SIZES.map(([k, l]) => `<button class="${(prefs.textSize || 'n') === k ? 'on' : ''}" onclick="setTextSize('${k}')">${l}</button>`).join('')}</div>
      <p class="tiny muted" style="margin:0">Agranda todo en este teléfono (menos los juegos y el mapa).</p>
      <span class="label" style="margin-top:6px">Foto de fondo del contador</span>
      ${prefs.bg ? `<img data-photo="bg-${uid()}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:16px">` : ''}
      <div class="grid2"><label class="btn ghost small" style="width:100%">${icon('photo')} ${prefs.bg ? 'Cambiar' : 'Elegir foto'}<input type="file" accept="image/*" hidden onchange="pickBg(this)"></label>
        ${prefs.bg ? `<button class="btn ghost small" style="width:100%" onclick="removeBg()">Quitar</button>` : ''}</div></div>

    ${homePrefsCard(prefs, p)}
    ${menuPrefsCard()}

    ${notifCard(prefs, p)}

    <div class="glass stack"><span class="label">${icon('lock')} Bloqueo con PIN</span>
      <p class="small muted" style="margin:0">Opcional. Pide un código de 4 números al abrir la app en este teléfono (y si estuvo cerrada más de un minuto).</p>
      ${pinEnabled() ? `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="setupPin()">Cambiar PIN</button><button class="btn ghost small" style="width:100%" onclick="disablePin()">Desactivar</button></div>` : `<button class="btn ghost" onclick="setupPin()">Activar bloqueo con PIN</button>`}</div>

    <div class="glass stack"><span class="label">Respaldo</span>
      <p class="small muted" style="margin:0">Todo está guardado en la nube. Igual pueden descargar una copia de todo: gastos, alcancías, recetas, momentos, viajes, juegos… «Con fotos» también guarda las fotos (pesa más y tarda). ${S.settings.lastBackup ? `Último respaldo: ${new Date(S.settings.lastBackup).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Aún no han descargado ninguno.'}</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="exportData()">Descargar</button>
        <button class="btn ghost small" style="width:100%" onclick="exportData(true)">Descargar con fotos</button></div>
      <label class="btn ghost small" style="width:100%">Restaurar desde un respaldo<input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label>
      <button class="btn ghost small" style="width:100%" onclick="autoBackups()">🌙 Respaldos automáticos de cada noche</button>
      <p class="small" id="bkStatus" style="margin:0">${bkStatusHTML()}</p>
      <button class="btn ghost small" style="width:100%" onclick="backupHelp()">🆘 ¿Se borró algo? Qué hacer</button></div></div>

    <div class="glass"><span class="label">Ideas propias de la ruleta</span>
      <ul class="list" style="margin-top:6px">${S.data.ideas.length ? S.data.ideas.map(i => `<li><span class="txt">${esc(i.t)}</span>
        <button class="del" aria-label="Borrar" onclick="delIdea('${i.id}')">${icon('trash')}</button></li>`).join('') : '<li class="empty">Aún no agregan ideas propias</li>'}</ul></div>

    <div class="glass stack"><span class="label">Sesión</span><p class="small muted" style="margin:0">Entraste como ${esc(S.me.email)}</p>
      <p class="tiny muted" style="margin:0">Futari guarda la hora, el modelo de teléfono, el navegador y la versión de la app cada vez que alguno de los dos la abre, cuánto tiempo pasa cada uno en cada sección, y cuántos avisos se mandan y se abren, para estadísticas de uso y para encontrar errores. Si activan las notificaciones, también guarda una dirección de cada teléfono (y si es iPhone o Android) para poder mandarle los avisos. También anota qué días hizo algo cada uno, para la racha y la mascota; el servicio de avisos lo lee para avisarles en la noche si la racha está en peligro. En Gastos guarda lo que anoten, su presupuesto de la semana, las salidas y sus alcancías; el domingo el servicio de avisos lee los gastos de las últimas dos semanas para mandarles el resumen. Si usan el atajo del aviso del banco, ese mensaje solo se usa en el teléfono para sacar el monto: no se guarda. Al tocar «Voy al súper» se guarda la hora (por 3 horas se le muestra a la pareja). Lo que le escriban al chef de Recetas se manda a una inteligencia artificial (la de Cloudflare, o Claude si se configura) solo para armar la receta; no se guarda salvo que guarden la receta. Solo en cada teléfono (no se sube) se recuerda qué tarjetas de Inicio tocan, para esconder las que no usan, y una copia de los días viejos para abrir más rápido. En Pelis y series, si ven una serie cada uno a su ritmo, se guarda en qué capítulo va cada uno. Los mensajes del chat de una historia se borran con ella a las 24 horas, salvo que la guarden en Momentos (ahí la conversación queda en la nota). Para el clima de un viaje se manda el nombre del destino a Open-Meteo, y para gastos en otra moneda se pide el tipo de cambio del día (no se manda ningún dato de ustedes). En los juegos se cuentan los intentos de cada nivel y cuántas veces seguidas se pierde, para ajustar la dificultad.</p>
      <button class="btn ghost" onclick="startTour()">Ver la guía otra vez</button>
      <button class="btn danger" onclick="logout()">Cerrar sesión</button></div>
    ${isTester() ? `<button class="btn ghost" onclick="go('s-admin')">${icon('gear')} Abrir administración</button>` : ''}
    <p class="tiny muted center" style="margin:0">Futari · versión ${esc(window.FUTARI_VERSION || '')}</p>`);
  loadPhotos($('s-settings'));
  bkStatusCheck();
}
/* ---------- Notificaciones (push.js) ---------- */
function notifCard(prefs, p) {
  const n = prefs.notif || {}, mine = subsOf(uid()), theirs = p ? subsOf(p) : [];
  let state;
  if (!pushConfigured()) state = `<p class="small muted" style="margin:0">Falta conectar el servicio de avisos (ver docs/NOTIFICACIONES.md). Para configurarlo se necesitan los códigos de sus cuentas:</p>
      <p class="tiny" style="margin:0;word-break:break-all;user-select:all">${[uid(), p].filter(Boolean).join(',')}</p>`;
  else if (iosNeedsInstall()) state = `<p class="small muted" style="margin:0">En iPhone, primero instala Futari: en Safari toca <b>Compartir → Agregar a inicio</b> y ábrela desde ese ícono. Ahí podrás activarlas.</p>`;
  else if (!pushSupported()) state = `<p class="small muted" style="margin:0">Este navegador no permite notificaciones. En Android, abre Futari con Chrome.</p>`;
  else if (pushPermission() === 'denied') state = `<p class="small muted" style="margin:0">Las notificaciones están bloqueadas para Futari. Actívalas en los ajustes del teléfono (Notificaciones → Futari) y vuelve aquí.</p>`;
  else if (pushHere) state = `<p class="small" style="margin:0">✅ Activadas en este teléfono</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="testPush()">Probar</button><button class="btn ghost small" style="width:100%" onclick="disablePush()">Desactivar</button></div>`;
  else state = `<button class="btn" onclick="enablePush()">🔔 Activar en este teléfono</button>`;
  return `<div class="glass stack"><span class="label">${icon('bell')} Notificaciones</span>
    <p class="small muted" style="margin:0">Te avisan cuando ${esc(p ? nameOf(p) : 'tu pareja')} te manda algo, aunque tengas Futari cerrada.</p>
    ${state}
    ${p ? `<p class="tiny muted" style="margin:0">${theirs.length ? `${esc(nameOf(p))} las tiene activadas (${plural(theirs.length, 'teléfono', 'teléfonos')}).` : `${esc(nameOf(p))} todavía no las activa: a su teléfono no le llegarán avisos.`}${mine.length && !pushHere ? ` Tú las tienes en ${plural(mine.length, 'otro teléfono', 'otros teléfonos')}.` : ''}</p>` : ''}
    <span class="label" style="margin-top:6px">Qué avisos quieres recibir</span>
    ${NOTIF_TYPES.filter(([k]) => gateOn('notif:' + k)).map(([k, l]) => `<label class="check"><input type="checkbox" ${n[k] === false ? '' : 'checked'} onchange="setNotif('${k}', this.checked)"> ${l}</label>`).join('')}</div>`;
}
function setNotif(k, v) { savePrefs({ notif: { ...(profile(uid()).prefs?.notif || {}), [k]: v } }); }

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
    <p class="tiny muted" style="margin:0">Elige cuáles ves y en qué orden. Las que no tocan en 3 semanas se esconden solas en este teléfono; al final de Inicio aparece «Mostrar» para traerlas.</p>
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
function toggleHomeCard(id, on) {
  if (on) try { const u = JSON.parse(localStorage.getItem('futari-hc-use') || '{}'); u[id] = Date.now(); localStorage.setItem('futari-hc-use', JSON.stringify(u)); } catch {}
  savePrefs({ home: homeLayout().map(c => c.id === id ? { ...c, on } : c) }); }
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
// Tamaño de letra: agranda las pantallas con zoom de CSS (los juegos y el mapa se quedan igual, ver styles.css).
const TEXT_SIZES = [['n', 'Normal'], ['g', 'Grande'], ['xg', 'Más grande']], TZ = { n: 1, g: 1.1, xg: 1.2 };
export function applyTextSize(k) {
  k = TZ[k] ? k : (localStorage.getItem('futari-text') || 'n');
  document.documentElement.style.setProperty('--tz', TZ[k]);
  document.documentElement.dataset.ts = k;
  try { localStorage.setItem('futari-text', k); } catch {}
}
applyTextSize();
function setTextSize(k) { applyTextSize(k); write(setDoc(ref('profiles', uid()), { prefs: { textSize: k } }, { merge: true })); renderSettings(); }
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
function delIdea(id) { softDelete('ideas', id, 'la idea'); }
async function logout() { if (await ask('¿Cerrar sesión en este teléfono?')) { go('s-home'); signOut(auth); } }

/* ---------- Respaldo ---------- */
async function exportData(withPhotos) {
  const out = { version: 5, start: S.settings.start, currency: S.settings.currency, members: S.settings.members };
  for (const c of COLLECTIONS) out[c] = S.data[c];
  delete out.push; // suscripciones de avisos de cada teléfono: no sirven en otro y no deben salir de aquí
  if (withPhotos) {
    if (!navigator.onLine) return toast('Para bajar las fotos necesitas internet');
    toast('Juntando las fotos… puede tardar un poco');
    try { out.photos = (await getDocs(col('photos'))).docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.error(e); return toast('No se pudieron bajar las fotos'); }
  }
  write(setDoc(coupleRef, { lastBackup: Date.now() }, { merge: true }));
  out.cards = S.data.cards.filter(c => c.level !== 'ours'); // las de "Solo nosotros" no salen del teléfono
  for (const c of PRIVATE) out[c] = S.priv[c];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `futari-respaldo-${dayKey(new Date())}${withPhotos ? '-con-fotos' : ''}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(withPhotos ? `Respaldo descargado con ${out.photos.length} fotos ✓` : 'Respaldo descargado ✓');
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
/* ---------- Respaldos automáticos (servicio de avisos v11 + KV «RESPALDOS», ver docs/NOTIFICACIONES.md) ----------
   Cada noche el servicio copia la base y las fotos nuevas. Aquí se ven los días guardados, se descargan (con o sin fotos)
   o se restauran (se juntan con lo actual, igual que «Restaurar desde un respaldo»). */
async function bkCall(body) {
  if (!PUSH?.url) throw new Error('no-worker');
  const r = await fetch(PUSH.url.replace(/\/$/, '') + '/respaldo', { method: 'POST', headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 404) throw new Error('old-worker');
  if (r.status === 501) throw new Error('no-kv');
  if (!r.ok) throw new Error('error');
  return body.action === 'get' ? r.blob() : r.json();
}
const BK_ERR = { 'no-worker': 'Falta configurar el servicio de avisos.', 'old-worker': 'Falta pegar el servicio de avisos versión 12 en Cloudflare.',
  'no-kv': 'Falta conectar el espacio «RESPALDOS» en Cloudflare (Settings → Bindings → KV namespace).', error: 'No se pudo hablar con el servicio. Revisa el internet.' };
async function autoBackups() {
  openSheet('<div class="stack"><h2>🌙 Respaldos automáticos</h2><p class="small muted" style="margin:0">Buscando…</p></div>');
  let d; try { d = await bkCall({ action: 'list' }); } catch (e) { return openSheet(`<div class="stack"><h2>🌙 Respaldos automáticos</h2><p class="small" style="margin:0">😕 ${esc(BK_ERR[e.message] || BK_ERR.error)}</p></div>`); }
  const fmt = m => new Date(m.at).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const n = m => Object.values(m.counts || {}).reduce((a, b) => a + b, 0);
  openSheet(`<div class="stack"><h2>🌙 Respaldos automáticos</h2>
    <button class="btn" id="bkNow" onclick="autoBackupNow()">💾 Respaldar ahora</button>
    <p class="small muted" style="margin:0">Cada noche, entre las 3 y las 6 a. m., se guarda una copia de todo. Quedan los últimos 7 días y un domingo de cada semana del último mes. Fotos guardadas: ${d.photos}${d.pendingPhotos ? ` (faltan ${d.pendingPhotos}, siguen las próximas noches)` : ''}.</p>
    ${d.days.length ? `<ul class="list">${d.days.map(m => `<li><div class="txt"><span class="main">${esc(fmt(m))}</span><span class="sub">${n(m)} cosas guardadas</span></div>
      <button class="btn ghost small" onclick="autoBackupGet('${m.day}', false)">Bajar</button><button class="btn ghost small" onclick="autoBackupGet('${m.day}', true)">+ fotos</button>
      <button class="btn small" onclick="autoBackupRestore('${m.day}')">Restaurar</button></li>`).join('')}</ul>`
      : '<p class="small" style="margin:0">Todavía no hay ninguno: el primero se hace esta noche 🌙</p>'}
    <p class="tiny muted" style="margin:0">«Restaurar» junta ese día con lo que tienen ahora (no borra nada): sirve para recuperar algo que se borró sin querer.</p></div>`);
}
// «Respaldar ahora»: el servicio hace un paso por pedido (una sección o unas fotos) y aquí se va mostrando el avance
async function autoBackupNow() {
  const btn = $('bkNow'); if (btn) btn.disabled = true;
  const say = t => { const b = $('bkNow'); if (b) b.textContent = t; };
  try {
    const s = await bkCall({ action: 'start' });
    if (!s.ok && !s.error) throw new Error('old-worker'); // el servicio todavía no conoce «Respaldar ahora»
    if (s.error === 'limit') { toast('Ya se respaldó 4 veces hoy: el próximo se hace solo esta noche 🌙'); if (btn) btn.disabled = false; return say('💾 Respaldar ahora'); }
    for (let k = 0; k < 200; k++) {
      const r = await bkCall({ action: 'step' });
      if (r.phase === 'data') say(`Respaldando… ${r.idx} de ${r.total}`);
      else if (r.phase === 'photos') say(`Guardando fotos nuevas…${r.left ? ` (faltan ${r.left})` : ''}`);
      else break;
    }
    toast('Respaldo listo ✓'); bkStatusCheck(true); autoBackups();
  } catch (e) { toast(BK_ERR[e.message] || BK_ERR.error); if (btn) btn.disabled = false; say('💾 Respaldar ahora'); }
}
// Estado del respaldo automático (se pregunta al servicio como mucho cada 15 minutos; se recuerda en el teléfono)
let bkStatus = (() => { try { return JSON.parse(localStorage.getItem('futari-bk-status')) || null; } catch { return null; } })(), bkAsked = 0;
function bkStatusHTML() {
  if (!bkStatus) return '<span class="muted">🌙 Revisando el respaldo automático…</span>';
  if (bkStatus.err) return `<span class="muted">🌙 Respaldo automático: ${esc(BK_ERR[bkStatus.err] || 'no se pudo revisar ahora')}</span>`;
  if (!bkStatus.at) return '<span class="muted">🌙 Todavía no hay respaldos automáticos: el primero se hace esta noche.</span>';
  const days = Math.floor((Date.now() - bkStatus.at) / 864e5), when = new Date(bkStatus.at).toLocaleString('es', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  return days >= 2 ? `⚠️ <b>No hay respaldo automático desde hace ${days} días.</b> Descarguen uno a mano («Descargar con fotos») y revisen el servicio en Cloudflare (ver «¿Se borró algo?»).`
    : `🌙 Último respaldo automático: ${esc(when)} ✓`;
}
async function bkStatusCheck(force) {
  if (!PUSH?.url || (!force && Date.now() - bkAsked < 15 * 60e3)) return;
  bkAsked = Date.now();
  try { const d = await bkCall({ action: 'list' }); bkStatus = { at: d.days?.[0]?.at || 0, n: d.days?.length || 0 }; }
  catch (e) { bkStatus = { err: e.message }; }
  try { localStorage.setItem('futari-bk-status', JSON.stringify(bkStatus)); } catch {}
  const el = $('bkStatus'); if (el) el.innerHTML = bkStatusHTML();
}
// Guía para cuando algo se borra (la misma de docs/RESPALDO.md, en palabras sencillas)
function backupHelp() {
  openSheet(`<div class="stack"><h2>🆘 ¿Se borró algo?</h2>
    <p class="small" style="margin:0"><b>1. Si fue hace unos segundos:</b> toca «Deshacer» en la barrita de abajo. Vuelve igual que estaba.</p>
    <p class="small" style="margin:0"><b>2. Si fue hoy o en los últimos días:</b> Ajustes → Respaldo → «🌙 Respaldos automáticos» → en el día de <u>antes</u> de que se borrara, toca <b>Restaurar</b>. Se junta con lo que tienen ahora: no se pierde lo nuevo y vuelve lo borrado (con sus fotos).</p>
    <p class="small" style="margin:0"><b>3. Si no hay respaldos automáticos</b> (o el servicio de Cloudflare falla): usen un archivo que hayan descargado con «Descargar con fotos» → «Restaurar desde un respaldo». Por eso conviene bajar uno de vez en cuando y guardarlo en Drive o iCloud.</p>
    <p class="small" style="margin:0"><b>4. Si alguien borró todo desde Firebase</b> o la app no carga los datos: primero entren a la app (si no deja, revisen Firebase → Authentication y las reglas de Firestore). Después restauren el respaldo más reciente (paso 2 o 3).</p>
    <p class="small" style="margin:0"><b>Para que siempre haya respaldo:</b> si aquí sale ⚠️ «No hay respaldo automático desde hace X días», en Cloudflare revisen que el servicio <code>futari-push</code> tenga el Cron (cada minuto), el KV <code>RESPALDOS</code> conectado y la versión 12 o más nueva. Mientras tanto, «💾 Respaldar ahora» o «Descargar con fotos».</p>
    <p class="tiny muted" style="margin:0">«Restaurar» nunca borra: solo vuelve a poner lo que tenía el respaldo. Si algo se había editado, queda como estaba en el respaldo.</p>
    <button class="btn" onclick="closeSheet()">Entendido</button></div>`);
}
async function autoBackupGet(day, photos) {
  toast(photos ? 'Bajando el respaldo con fotos… puede tardar' : 'Bajando el respaldo…');
  try {
    const blob = await bkCall({ action: 'get', day, photos }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `futari-respaldo-${day}${photos ? '-con-fotos' : ''}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Respaldo descargado ✓');
  } catch (e) { toast(BK_ERR[e.message] || BK_ERR.error); }
}
async function autoBackupRestore(day) {
  if (!(await ask(`¿Restaurar el respaldo del ${day}? Se junta con lo que tienen ahora (no se borra nada) y se recuperan también las fotos que falten.`, { ok: 'Restaurar' }))) return;
  toast('Restaurando…');
  try { const d = JSON.parse(await (await bkCall({ action: 'get', day, photos: true })).text()); await uploadData(d); toast('Respaldo restaurado ✓'); closeSheet(); }
  catch (e) { console.error(e); toast(BK_ERR[e.message] || 'No se pudo restaurar'); }
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
  // Las fotos pesan: van en lotes chicos para no pasar el límite de 10 MB por escritura.
  const photoOps = (d.photos || []).filter(x => x?.id && x.data).map(({ id, ...rest }) => b => b.set(ref('photos', id), rest));
  for (let i = 0; i < photoOps.length; i += 8) {
    const batch = writeBatch(db);
    photoOps.slice(i, i + 8).forEach(op => op(batch));
    await batch.commit();
  }
  // Los días viejos (ánimos, preguntas…) se guardan en el teléfono: se vuelven a bajar para incluir lo restaurado.
  try { Object.keys(localStorage).filter(k => k.startsWith('futari-old-')).forEach(k => localStorage.removeItem(k)); } catch {}
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
    const n = c => (d[c] || []).length, parts = [['expenses', 'gasto', 'gastos'], ['moments', 'momento', 'momentos'], ['photos', 'foto', 'fotos'], ['places', 'restaurante', 'restaurantes'], ['recipes', 'receta', 'recetas'],
      ['trips', 'viaje', 'viajes'], ['shows', 'peli o serie', 'pelis y series'], ['notes', 'nota', 'notas'], ['bucket', 'cosa de la bucket list', 'cosas de la bucket list'], ['events', 'plan', 'planes']].filter(([c]) => n(c)).map(([c, a, b]) => plural(n(c), a, b));
    const when = f.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!await ask(`Respaldo${when ? ' del ' + when : ''}: ${parts.join(', ') || 'sin datos'}${parts.length ? ' y más' : ''}. Se juntan con lo que ya tienen (no se borra nada y lo repetido no se duplica). ¿Restaurar?`, { ok: 'Restaurar', cancel: 'Cancelar' })) return;
    toast('Restaurando…');
    return uploadData(d).then(() => toast('Respaldo restaurado ✓'));
  }).catch(() => toast('Ese archivo no es un respaldo válido'));
  input.value = '';
}

on('groceries expenses trips places bucket quiz shows events pins songs menu notes moments thinks answers daily cravings lists coupons snaps profiles reminders arrows bus fruta', renderMore);
on('ideas profiles push', () => { if ($('s-settings').classList.contains('active')) renderSettings(); });
onShow('s-settings', renderSettings);
window.rerenderSettings = () => { if ($('s-settings').classList.contains('active')) renderSettings(); };
onShow('s-more', renderMore);
expose({ backupHelp, autoBackupNow, autoBackups, autoBackupGet, autoBackupRestore, setTextSize, openMenuPrefs, enablePush, disablePush, testPush, setNotif, previewCustomAccent, setCustomAccent, saveNicks, setCounterUnit, saveCounter, toggleHomeCard, moveHomeCard, resetHome, saveSettings, setTheme, setAccent, pickAvatar, removeAvatar, pickBg, removeBg, delIdea, logout, exportData, importData });
