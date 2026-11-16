// Historias: fotos rápidas para la pareja, con texto encima, reacciones y respuesta con otra foto.
// Duran 24 horas: después se borran solas (cualquiera de los dos teléfonos hace la limpieza al abrir la app),
// salvo que antes las guarden en Momentos (eso hace una copia como momento).
import { writeBatch, updateDoc, deleteField, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, on, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos, cachePhoto, getPhoto,
         compressImage, photoError, makeThumb, thumbId, dayKey, nameOf, partnerUid, partnerName, plural, uid, ask, avatar,
         syncBack, takePhoto, nativePick, ANDROID, IOS, celebrate, markActive, countStat, camSrc, setCamSrc, paint } from './core.js';
import { notify, meForPartner } from './push.js';

const LIFE = 24 * 3600e3;
export const REACTS = ['❤️', '😂', '😍', '🥺', '🔥'];
export const snapPhotoId = id => `snap-${id}`;
export const liveSnaps = () => S.data.snaps.filter(s => s.at && Date.now() - s.at < LIFE).sort((a, b) => a.at - b.at);
export const unseenSnaps = () => liveSnaps().filter(s => s.by !== uid() && !s.seen?.[uid()]);
// Reacciones de mi pareja a mis fotos que todavía no he visto
const newReacts = () => liveSnaps().filter(s => s.by === uid() && Object.entries(s.reacts || {}).some(([u, r]) => u !== uid() && r.at > (s.reactSeen || 0)));
// Chat de cada historia: chat [{ by, t, at }] en el mismo doc (se borra con ella a las 24 h, salvo que la guarden
// en Momentos: ahí la conversación queda en la nota). chatSeen.<uid> = hasta cuándo leyó cada uno.
const unreadChat = s => (s.chat || []).filter(m => m.by !== uid() && m.at > (s.chatSeen?.[uid()] || 0)).length;
export const newChats = () => liveSnaps().filter(s => unreadChat(s));
const ago = at => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${plural(Math.floor(m / 60), 'hora', 'horas')}`; };
const leftTxt = at => { const h = Math.ceil((at + LIFE - Date.now()) / 3600e3); return h <= 1 ? 'se borra en menos de 1 hora' : `se borra en ${h} h`; };

/* ---------- Tomar y mandar ---------- */
let replyTo = null, pending = null;
// En el teléfono abre directo la cámara de Futari; en la computadora, el selector de archivos.
function newSnap(reply) {
  replyTo = typeof reply === 'string' ? reply : null;
  if (ANDROID || IOS) takePhoto('image/*', gotFile); // la cámara que se usó la última vez en este teléfono
  else nativePick('image/*', null, gotFile);
}
function retakeSnap() { newSnap(replyTo); }
function snapFromGallery() { nativePick('image/*', null, gotFile); }
// Cambiar de cámara desde la hoja de la historia (queda recordado para las siguientes)
function snapOtherCam() { setCamSrc(camSrc() === 'phone' ? 'futari' : 'phone'); newSnap(replyTo); }
async function gotFile(f) {
  try { pending = await compressImage(f, 1080); } catch (e) { return photoError(e); }
  const r = replyTo && S.data.snaps.find(s => s.id === replyTo);
  openSheet(`<div class="stack"><h2>${r ? 'Responder con foto' : `Historia para ${esc(partnerName() || 'tu pareja')}`}</h2>
    <div class="snap-frame"><img src="${pending}" alt=""><div class="snap-text" id="snapPreview" hidden></div></div>
    <input id="snapText" maxlength="80" placeholder="Escribe algo encima (opcional)" aria-label="Texto sobre la foto" oninput="snapTextInput()">
    <div class="grid2"><button class="btn ghost" onclick="retakeSnap()">Otra foto</button><button class="btn" id="snapBtn" onclick="sendSnap()">Mandar 📸</button></div>
    <div class="row" style="justify-content:center;gap:18px"><button class="link" onclick="snapFromGallery()">🖼️ De la galería</button>${ANDROID || IOS ? `<button class="link" onclick="snapOtherCam()">${camSrc() === 'phone' ? '📷 Con la cámara de Futari' : '📱 Con la cámara del teléfono'}</button>` : ''}</div>
    <p class="tiny muted center" style="margin:0">Se borra sola en 24 horas, salvo que la guarden en Momentos.</p></div>`);
}
function snapTextInput() { const t = $('snapText').value.trim(), p = $('snapPreview'); p.hidden = !t; p.textContent = t; }
// Manda una historia ya comprimida (la usan esta hoja y La parada para desbloquear un lugar con una foto)
export async function sendPhotoSnap(dataUrl, text = '', replyId = null) {
  const r = newRef('snaps'), pid = snapPhotoId(r.id);
  const thumb = await makeThumb(dataUrl).catch(() => null);
  const batch = writeBatch(db);
  batch.set(ref('photos', pid), { data: dataUrl }); cachePhoto(pid, dataUrl);
  if (thumb) { batch.set(ref('photos', thumbId(pid)), { data: thumb }); cachePhoto(thumbId(pid), thumb); }
  const data = { by: uid(), at: Date.now(), text };
  if (replyId && S.data.snaps.some(s => s.id === replyId)) data.replyTo = replyId;
  batch.set(r, data);
  write(batch.commit()); markActive(); countStat('acts', 'snap');
  notify('snaps', { title: data.replyTo ? `📸 ${meForPartner()} te respondió con una foto` : `📸 ${meForPartner()} te mandó una historia`,
    body: data.text || 'Tócala para verla 👀', url: './?open=snaps', tag: 'snaps' });
  return r.id;
}
async function sendSnap() {
  if (!pending) return;
  $('snapBtn').disabled = true;
  await sendPhotoSnap(pending, $('snapText').value.trim(), replyTo);
  pending = null; replyTo = null;
  closeSheet(); toast('Historia enviada 📸');
}

/* ---------- Verlas (pantalla completa, tipo historias) ---------- */
let list = [], idx = 0, viewer = null;
function openSnaps(startId) {
  list = liveSnaps();
  if (!list.length) return toast('No hay historias en las últimas 24 horas');
  const firstNew = list.findIndex(s => s.by !== uid() && !s.seen?.[uid()]);
  idx = startId ? Math.max(0, list.findIndex(s => s.id === startId)) : firstNew >= 0 ? firstNew : list.length - 1;
  viewer?.remove();
  viewer = document.createElement('div');
  viewer.className = 'dialog snapview';
  viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-modal', 'true'); viewer.setAttribute('aria-label', 'Historias');
  document.body.appendChild(viewer); syncBack();
  showSnap();
}
function closeSnaps() {
  const el = viewer; viewer = null; if (!el) return;
  el.classList.add('out'); setTimeout(() => { el.remove(); syncBack(); }, 160);
}
function moveSnap(n) {
  const k = idx + n;
  if (k < 0) return;
  if (k >= list.length) return closeSnaps();
  idx = k; showSnap();
}
function showSnap() {
  const s = list[idx]; if (!viewer || !s) return;
  const pid = snapPhotoId(s.id);
  viewer.innerHTML = `<div class="sv-bars">${list.map((_, k) => `<i class="${k < idx ? 'done' : k === idx ? 'on' : ''}"></i>`).join('')}</div>
    <div class="sv-head">${avatar(s.by, 34)}<div class="sv-who"><b>${esc(s.by === uid() ? 'Tú' : nameOf(s.by))}</b><span>${ago(s.at)} · ${leftTxt(s.at)}</span></div>
      <button class="sv-x" data-v="0" aria-label="Cerrar" onclick="closeSnaps()">${icon('x')}</button></div>
    <div class="sv-photo"><div class="sv-pic"><img id="svImg" alt="Historia de ${esc(nameOf(s.by))}">
      ${s.text ? `<div class="snap-text">${esc(s.text)}</div>` : ''}</div>
      <button class="sv-prev" aria-label="Anterior" onclick="moveSnap(-1)"></button><button class="sv-next" aria-label="Siguiente" onclick="moveSnap(1)"></button></div>
    <div class="sv-bottom" id="svBottom"></div>`;
  // Primero la miniatura (ya suele estar), luego la completa
  getPhoto(thumbId(pid)).then(t => { const i = $('svImg'); if (t && i && !i.dataset.full) i.src = t; });
  getPhoto(pid).then(f => { const i = $('svImg'); if (f && i) { i.src = f; i.dataset.full = '1'; } else if (i && !i.src) i.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Esta foto ya no está' })); });
  paintBottom(); loadPhotos(viewer);
  // Marcar como vista (las de mi pareja) o marcar vistas las reacciones nuevas (las mías)
  if (s.by !== uid() && !s.seen?.[uid()]) write(updateDoc(ref('snaps', s.id), { [`seen.${uid()}`]: Date.now() }));
  if (s.by === uid() && Object.entries(s.reacts || {}).some(([u, r]) => u !== uid() && r.at > (s.reactSeen || 0))) write(updateDoc(ref('snaps', s.id), { reactSeen: Date.now() }));
}
const hhmm = at => new Date(at).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
function paintBottom() {
  const s = list[idx], el = $('svBottom'); if (!s || !el) return;
  const chat = s.chat || [];
  const mine = s.by === uid(), myReact = s.reacts?.[uid()]?.e, p = partnerUid();
  const theirReact = p && s.reacts?.[p]?.e;
  const reply = s.replyTo && S.data.snaps.find(x => x.id === s.replyTo);
  paint(el, `${chat.length ? `<div class="sv-chat" id="svChat">${chat.map(m => `<div class="sv-msg ${m.by === uid() ? 'me' : ''}"><span>${esc(m.t)}</span><small>${hhmm(m.at)}</small></div>`).join('')}</div>` : ''}
    <div class="sv-say"><input id="svSay" maxlength="300" enterkeyhint="send" autocomplete="off" placeholder="${mine ? 'Escribe algo…' : `Responder a ${esc(nameOf(s.by))}…`}" aria-label="Mensaje" onkeydown="if(event.key==='Enter'){event.preventDefault();sayChat()}">
      <button class="sv-send" aria-label="Enviar" onclick="sayChat()">${icon('send')}</button></div>
    ${reply ? `<p class="sv-note">↩︎ Respuesta a ${reply.by === uid() ? 'tu foto' : 'la foto de ' + esc(nameOf(reply.by))}</p>` : ''}
    ${mine
      ? `<p class="sv-note">${theirReact ? `${esc(nameOf(p))} reaccionó ${theirReact}` : s.seen?.[p] ? `${esc(nameOf(p))} ya la vio` : 'Todavía no la ve'}</p>`
      : `<div class="sv-reacts">${REACTS.map(e => `<button class="${myReact === e ? 'on' : ''}" aria-label="Reaccionar ${e}" aria-pressed="${myReact === e}" onclick="reactSnap('${e}')">${e}</button>`).join('')}</div>`}
    <div class="sv-actions">
      ${mine ? '' : `<button class="btn" onclick="replySnap()">📸 Con foto</button>`}
      ${s.saved ? `<button class="btn ghost" disabled>✓ En Momentos</button>` : `<button class="btn ghost" onclick="saveSnapMoment()">Guardar en Momentos</button>`}
      ${mine ? `<button class="btn ghost danger" onclick="delSnap()">${icon('trash')} Borrar</button>` : ''}
    </div>`);
  const c = $('svChat'); if (c) c.scrollTop = c.scrollHeight;
  if (unreadChat(s)) write(updateDoc(ref('snaps', s.id), { [`chatSeen.${uid()}`]: Date.now() }));
}
let chatNotifAt = {};
function sayChat() {
  const s = list[idx], i = $('svSay'); if (!s || !i) return;
  const t = i.value.trim(); if (!t) return;
  i.value = '';
  write(updateDoc(ref('snaps', s.id), { chat: arrayUnion({ by: uid(), t, at: Date.now() }), [`chatSeen.${uid()}`]: Date.now() }));
  markActive(); countStat('acts', 'chat'); navigator.vibrate?.(10);
  // Un aviso por historia (se reemplaza); si escriben varios mensajes seguidos, el aviso muestra el último
  if (Date.now() - (chatNotifAt[s.id] || 0) > 4000) {
    chatNotifAt[s.id] = Date.now();
    notify('snaps', { title: `💬 ${meForPartner()} ${s.by === uid() ? 'escribió en su historia' : 'respondió a tu historia'}`, body: t, url: `./?open=snaps`, tag: 'chat-' + s.id });
  }
  setTimeout(() => $('svSay')?.focus({ preventScroll: true }), 0);
}
function reactSnap(e) {
  const s = list[idx]; if (!s) return;
  const same = s.reacts?.[uid()]?.e === e;
  write(updateDoc(ref('snaps', s.id), { [`reacts.${uid()}`]: same ? deleteField() : { e, at: Date.now() } }));
  if (!same && e === '❤️') celebrate('hearts');
  if (!same) countStat('acts', 'react');
  if (!same && s.by !== uid()) notify('reacts', { title: `${meForPartner()} reaccionó ${e} a tu historia`, body: s.text ? `«${s.text}»` : '', url: './?open=snaps', tag: 'react-' + s.id });
  navigator.vibrate?.(15);
}
function replySnap() { const s = list[idx]; closeSnaps(); newSnap(s?.id); }
async function saveSnapMoment() {
  const s = list[idx]; if (!s) return;
  const pid = snapPhotoId(s.id), full = await getPhoto(pid);
  if (!full) return toast('Esa foto ya no está');
  const thumb = await getPhoto(thumbId(pid)) || await makeThumb(full).catch(() => null);
  const r = newRef('moments'), batch = writeBatch(db);
  batch.set(ref('photos', r.id), { data: full }); cachePhoto(r.id, full);
  if (thumb) { batch.set(ref('photos', thumbId(r.id)), { data: thumb }); cachePhoto(thumbId(r.id), thumb); }
  batch.set(r, { title: s.text || `Historia de ${s.by === uid() ? (S.settings.members?.[uid()]?.name || 'mí') : nameOf(s.by)}`, date: dayKey(new Date(s.at)),
    note: (s.chat || []).map(m => `${m.by === uid() ? (S.settings.members?.[uid()]?.name || 'Yo') : nameOf(m.by)}: ${m.t}`).join('\n').slice(0, 600), hasPhoto: true, place: null, by: uid(), createdAt: Date.now(), fromSnap: true });
  batch.update(ref('snaps', s.id), { saved: r.id });
  write(batch.commit());
  toast('Guardada en Momentos 📚');
}
async function delSnap() {
  const s = list[idx]; if (!s || !(await ask('¿Borrar esta historia para los dos?'))) return;
  const pid = snapPhotoId(s.id), batch = writeBatch(db);
  batch.delete(ref('snaps', s.id)); batch.delete(ref('photos', pid)); batch.delete(ref('photos', thumbId(pid)));
  write(batch.commit());
  list.splice(idx, 1);
  if (!list.length) return closeSnaps();
  idx = Math.min(idx, list.length - 1); showSnap();
}
// Si cambian reacciones o vistos mientras está abierta, se actualiza solo la parte de abajo.
on('snaps', () => {
  if (!viewer) return;
  list = list.map(s => S.data.snaps.find(x => x.id === s.id) || s);
  paintBottom();
});

/* ---------- Limpieza: las de más de 24 horas se borran (con su foto) ---------- */
let lastClean = 0;
on('snaps', () => {
  if (!S.me || Date.now() - lastClean < 10 * 60e3) return;
  const old = S.data.snaps.filter(s => !s.at || Date.now() - s.at >= LIFE).slice(0, 150);
  if (!old.length) return;
  lastClean = Date.now();
  const batch = writeBatch(db);
  for (const s of old) { const pid = snapPhotoId(s.id); batch.delete(ref('snaps', s.id)); batch.delete(ref('photos', pid)); batch.delete(ref('photos', thumbId(pid))); }
  batch.commit().catch(() => { lastClean = 0; });
});

/* ---------- Tarjeta de Inicio y pestaña en Momentos ---------- */
const thumbBtn = s => {
  const r = s.reacts && Object.values(s.reacts)[0]?.e;
  return `<button class="snap-thumb ${(s.by !== uid() && !s.seen?.[uid()]) || unreadChat(s) ? 'new' : ''}" aria-label="Historia de ${esc(s.by === uid() ? 'ti' : nameOf(s.by))}" onclick="openSnaps('${s.id}')">
    <img data-thumb="${snapPhotoId(s.id)}" alt="">${avatar(s.by, 22)}${r ? `<b>${r}</b>` : ''}${s.chat?.length ? `<i class="snap-chat">💬 ${s.chat.length}</i>` : ''}</button>`;
};
export function snapsCard() {
  const live = liveSnaps(), unseen = unseenSnaps(), reacts = newReacts(), p = partnerUid();
  const latest = unseen[unseen.length - 1];
  return `<div class="glass stack snaps-card"><div class="row"><span class="label">📸 Historias</span>
      ${live.length ? `<button class="link" onclick="openSnaps()">Ver ${live.length > 1 ? 'todas' : ''}</button>` : ''}</div>
    ${latest ? `<button class="snap-new" onclick="openSnaps()"><img data-thumb="${snapPhotoId(latest.id)}" alt="">
        <span>${avatar(latest.by, 26)} ${unseen.length > 1 ? `${unseen.length} nuevas` : 'Nueva'} de ${esc(nameOf(latest.by))}</span></button>`
      : live.length ? `<div class="snap-strip">${[...live].reverse().map(thumbBtn).join('')}</div>`
      : `<p class="small muted" style="margin:0">Mándale a ${esc(p ? nameOf(p) : 'tu pareja')} una foto rápida de lo que estás haciendo. Duran 24 horas.</p>`}
    ${(c => c ? `<button class="link" style="align-self:flex-start" onclick="openSnaps('${c.id}')">💬 ${esc(nameOf(p))} te escribió en ${c.by === uid() ? 'tu historia' : 'su historia'}</button>` : '')(newChats().pop())}
    ${reacts.length ? `<button class="link" style="align-self:flex-start" onclick="openSnaps('${reacts[reacts.length - 1].id}')">${esc(nameOf(p))} reaccionó ${reacts[reacts.length - 1].reacts[p]?.e || ''} a tu foto</button>` : ''}
    <button class="btn" onclick="newSnap()">📸 Mandar historia</button></div>`;
}
export function snapsHTML() {
  const live = [...liveSnaps()].reverse();
  return `<div class="glass stack"><button class="btn" onclick="newSnap()">📸 Mandar historia</button>
      <p class="tiny muted center" style="margin:0">Fotos rápidas para tu pareja, con texto si quieres. Se borran solas en 24 horas; guarden en Momentos las que quieran conservar.</p></div>
    ${live.length ? `<div class="snap-grid">${live.map(thumbBtn).join('')}</div>` : '<p class="empty center">No hay historias en las últimas 24 horas</p>'}`;
}

/* ---------- Acceso directo del ícono (Android): ?snap abre la cámara ---------- */
export function snapShortcut() {
  const qs = new URLSearchParams(location.search);
  if (!qs.has('snap')) return;
  qs.delete('snap');
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString().replace(/=(&|$)/g, '$1') : ''));
  // Espera a que se quite el candado del PIN (si lo tienen) antes de abrir la cámara
  let tries = 0;
  const go = () => { if ($('lockScreen') || !S.me) { if (++tries < 240) setTimeout(go, 500); return; } newSnap(); };
  setTimeout(go, 300);
}

expose({ sayChat, newSnap, retakeSnap, snapFromGallery, snapOtherCam, snapTextInput, sendSnap, openSnaps, closeSnaps, moveSnap, reactSnap, replySnap, saveSnapMoment, delSnap });
