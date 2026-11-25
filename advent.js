// Calendario de adviento (s-advent, desde 1.13.0). Del 1 al 24 de diciembre cada uno abre una casilla por día (las de
// días que ya pasaron también; las futuras no). Cada uno le puede llenar casillas al otro con una nota, un cupón, una foto
// o un plan; si nadie la llenó, trae una sorpresa de ADVENT_DEFAULTS (data.js). Se ve del 15 de noviembre al 31 de
// diciembre (gates['s-advent']). Datos en la colección "advent":
//   f-<año>-<uid de quien la llena>-<dd> = { year, day, by, to, type: nota|cupon|foto|plan, text, emoji, photo, at, savedMoment? }
//     (foto en photos/adv-<año>-<uid>-<dd> y su miniatura t-…)
//   o-<año> = { <uid>: { <dd>: ms } }  casillas que abrió cada uno
// Ver docs/ADVIENTO.md.
import { writeBatch, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef, loadPhotos, cachePhoto, getPhoto,
         compressImage, photoError, makeThumb, thumbId, dayKey, today, parseDate, partnerUid, partnerName, nameOf, uid, celebrate,
         markActive, gates, EMU, ask } from './core.js';
import { backBar } from './lists.js';
import { ADVENT_DEFAULTS } from './data.js';
import { notify, meForPartner } from './push.js';
import { pet } from './pet.js';

const ADV_COINS = 5; // monedas para la mascota por cada casilla abierta
const DAYS = Array.from({ length: 24 }, (_, i) => i + 1);
// Solo en el emulador: ?advHoy=AAAA-MM-DD simula otro día (para probar diciembre antes de tiempo)
const fakeDay = EMU ? new URLSearchParams(location.search).get('advHoy') : null;
const now = () => (fakeDay && /^\d{4}-\d{2}-\d{2}$/.test(fakeDay) ? parseDate(fakeDay) : today());
const YEAR = () => now().getFullYear();
const inDec = () => now().getMonth() === 11;
export const adventSeason = () => { const d = now(); return (d.getMonth() === 10 && d.getDate() >= 15) || d.getMonth() === 11; };
const canFill = () => adventSeason() && !(inDec() && now().getDate() > 24);
const canOpen = d => inDec() && d <= Math.min(24, now().getDate());
gates['s-advent'] = adventSeason;

const pad = n => String(n).padStart(2, '0');
const fillId = (by, d) => `f-${YEAR()}-${by}-${pad(d)}`;
const photoId = (by, d) => `adv-${YEAR()}-${by}-${pad(d)}`;
const fillOf = (by, d) => by ? S.data.advent.find(x => x.id === fillId(by, d)) : null;
const openedAt = (who, d) => S.data.advent.find(x => x.id === `o-${YEAR()}`)?.[who]?.[pad(d)];
const TYPES = [['nota', '💌', 'Nota'], ['cupon', '🎟️', 'Cupón'], ['foto', '📷', 'Foto'], ['plan', '📍', 'Plan']];
const TYPE_NAME = { nota: 'Nota', cupon: 'Cupón', foto: 'Foto', plan: 'Plan', reto: 'Reto del día', pregunta: 'Para conversar' };
const typeEmoji = k => TYPES.find(t => t[0] === k)?.[1] || '🎁';
// Lo que trae mi casilla del día d: lo que me dejó mi pareja o la sorpresa de la app
function content(d) {
  const f = fillOf(partnerUid(), d);
  if (f) return { ...f, from: f.by };
  const [emoji, type, text] = ADVENT_DEFAULTS[d - 1];
  return { emoji, type, text };
}
// Casillas que ya se pueden abrir y no he abierto (puntito en la barra / Más)
export const adventReady = () => (!uid() || !partnerUid()) ? 0 : DAYS.filter(d => canOpen(d) && !openedAt(uid(), d)).length;
// Aviso (puntito y campana): solo la casilla de HOY sin abrir. Las de días anteriores siguen en la tarjeta y en Más,
// pero no dejan un punto rojo pegado todo diciembre.
export const adventToday = () => { if (!uid() || !partnerUid()) return 0; const d = now().getDate(); return canOpen(d) && !openedAt(uid(), d) ? 1 : 0; };

/* ---------- Tarjeta de Inicio ---------- */
export function adventCard() {
  if (!adventSeason() || !partnerUid()) return '';
  const me = uid(), p = partnerUid(), pn = esc(partnerName());
  const head = `<div class="row"><span class="label">🎄 Calendario de adviento</span><button class="link" onclick="openAdvent()">Ver</button></div>`;
  if (!inDec()) {
    const filled = DAYS.filter(d => fillOf(me, d)).length;
    return `<div class="glass stack adv-card">${head}
      <p class="small" style="margin:0">El <b>1 de diciembre</b> empieza: una casilla por día hasta Nochebuena. Llénale casillas a ${pn} con notas, cupones, fotos o planes; no las verá hasta ese día.</p>
      <div class="row"><span class="pill">🎁 Le llenaste ${filled} de 24</span><button class="btn small" onclick="openAdvent('give')">Llenar casillas</button></div></div>`;
  }
  const n = now().getDate(), left = adventReady();
  if (n > 24) return !left ? '' : `<div class="glass stack adv-card">${head}
      <p class="small" style="margin:0">Te ${left === 1 ? 'queda 1 casilla' : `quedan ${left} casillas`} sin abrir 🎁</p><button class="btn small" onclick="openAdvent()">Abrirlas</button></div>`;
  const opened = openedAt(me, n), fromP = fillOf(p, n), more = left - (opened ? 0 : 1);
  return `<div class="glass stack adv-card">${head}
    <div class="row start" style="gap:12px"><div class="adv-today ${opened ? '' : 'ready'}">${opened ? esc(content(n).emoji || '🎁') : '🎁'}<b>${n}</b></div>
      <div class="grow"><b>${opened ? 'Ya abriste la de hoy ✨' : 'Tu casilla de hoy está lista'}</b>
        <div class="small muted">${fromP ? `💝 ${pn} te dejó algo${opened ? '' : ' adentro'}` : 'Casilla ' + n + ' de 24'}${more > 0 ? ` · ${more === 1 ? 'otra' : more} sin abrir` : ''}</div></div></div>
    <button class="btn" onclick="${opened ? 'openAdvent()' : `adventOpen(${n})`}">${opened ? 'Ver mi calendario' : `🎁 Abrir la casilla ${n}`}</button></div>`;
}

/* ---------- Pantalla ---------- */
let view = 'mine';
function openAdvent(v) { if (v) view = v; window.go('s-advent'); }
function advView(v) { view = v; render(); }
function render() {
  const p = partnerUid(), me = uid(), pn = esc(partnerName());
  const head = backBar('🎄 Adviento', 's-more') + (p ? `<div class="seg"><button class="${view === 'mine' ? 'on' : ''}" onclick="advView('mine')">Mi calendario</button><button class="${view === 'give' ? 'on' : ''}" onclick="advView('give')">Para ${pn}</button></div>` : '');
  if (!p) return paint('s-advent', head + '<p class="empty">Hace falta que estén los dos en Futari (Ajustes → nombre y fecha).</p>');
  if (!adventSeason()) return paint('s-advent', head + '<p class="empty">El calendario de adviento vuelve a mediados de noviembre 🎄</p>');
  const n = inDec() ? now().getDate() : 0;
  let intro, grid;
  if (view === 'mine') {
    intro = !inDec() ? `Empieza el 1 de diciembre. Mientras tanto, llénale casillas a ${pn} en la otra pestaña.`
      : n > 24 ? '¡Feliz Navidad! 🎄 Aquí quedan todas las casillas para volver a verlas.'
      : `Hoy toca la casilla <b>${n}</b>. Las de días que ya pasaron también se pueden abrir.`;
    grid = DAYS.map(d => {
      const op = openedAt(me, d), ready = !op && canOpen(d), gift = !!fillOf(p, d);
      const cls = op ? 'open' : ready ? 'ready' : 'locked';
      const face = op ? esc(content(d).emoji || '🎁') : ready ? '🎁' : '🔒';
      return `<button class="adv-box ${cls} ${d === n ? 'today' : ''}" onclick="${op ? `adventShow(${d})` : ready ? `adventOpen(${d})` : `adventLocked(${d})`}" aria-label="Casilla ${d}${op ? ', abierta' : ready ? ', lista para abrir' : ', cerrada'}${gift ? `, ${pn} te dejó algo` : ''}">
        <b>${d}</b><span>${face}</span>${gift && !op ? '<i class="mk" aria-hidden="true">💝</i>' : ''}</button>`;
    }).join('');
  } else {
    const filled = DAYS.filter(d => fillOf(me, d)).length;
    intro = canFill() ? `Elige un día y déjale algo a ${pn}: no lo verá hasta que abra esa casilla. Llevas <b>${filled} de 24</b>.`
      : `Ya pasó el tiempo de llenar casillas. Llenaste ${filled} de 24.`;
    grid = DAYS.map(d => {
      const f = fillOf(me, d), seen = openedAt(p, d);
      return `<button class="adv-box give ${f ? 'filled' : ''}" onclick="adventFill(${d})" aria-label="Casilla ${d} para ${pn}${f ? ', llena' : ', vacía'}${seen ? ', ya la abrió' : ''}">
        <b>${d}</b><span>${f ? (f.type === 'cupon' ? esc(f.emoji || '🎟️') : typeEmoji(f.type)) : '＋'}</span>${seen ? '<i class="mk" aria-hidden="true">👀</i>' : ''}</button>`;
    }).join('');
  }
  paint('s-advent', `${head}<div class="glass stack"><p class="small" style="margin:0">${intro}</p><div class="adv-grid">${grid}</div>
    ${view === 'mine' ? `<p class="tiny muted" style="margin:0">💝 = ${pn} te dejó algo · cada casilla abierta le da ${ADV_COINS} 🪙 a su mascota</p>` : `<p class="tiny muted" style="margin:0">👀 = ${pn} ya la abrió</p>`}</div>`);
}
onShow('s-advent', render);
on('advent pet profiles', () => { if ($('s-advent')?.classList.contains('active')) render(); });

/* ---------- Abrir una casilla ---------- */
function adventLocked(d) { toast(inDec() ? `La casilla ${d} se abre el ${d} de diciembre 🔒` : 'Las casillas se abren a partir del 1 de diciembre 🔒'); }
function adventOpen(d) {
  const me = uid(), p = partnerUid();
  if (!p) return toast('Hace falta que estén los dos');
  if (!canOpen(d)) return adventLocked(d);
  if (openedAt(me, d)) return adventShow(d);
  const c = content(d), b = writeBatch(db);
  b.set(ref('advent', `o-${YEAR()}`), { [me]: { [pad(d)]: Date.now() } }, { merge: true });
  if (pet()?.hatchedAt) b.update(ref('pet', 'main'), { bonus: increment(ADV_COINS) });
  // Un cupón que dejó la pareja queda en Detalles → Cupones como cualquier otro (regalado por quien lo llenó)
  if (c.from && c.type === 'cupon') b.set(newRef('coupons'), { text: c.text, emoji: c.emoji || '🎟️', fromUid: c.from, createdAt: Date.now(), seenAt: Date.now(), redeemedAt: null, doneAt: null, fromAdvent: d });
  write(b.commit());
  markActive();
  celebrate('confetti');
  if (c.from) notify('advent', { title: `🎄 ${meForPartner()} abrió la casilla ${d}`, body: 'La que le llenaste 💝', url: './?open=advent', tag: `advent-open-${d}` });
  adventShow(d, true);
}
function adventShow(d, fresh = false) {
  const c = content(d);
  openSheet(`<div class="stack center adv-open">
    <span class="tiny muted">Casilla ${d} · ${d} de diciembre</span>
    <div class="adv-emoji ${fresh ? 'pop' : ''}" aria-hidden="true">${esc(c.emoji || '🎁')}</div>
    <span class="pill" style="align-self:center">${c.from ? `💝 De ${esc(nameOf(c.from))} · ${TYPE_NAME[c.type] || ''}` : TYPE_NAME[c.type] || ''}</span>
    ${c.photo ? `<img class="adv-photo" data-photo="${photoId(c.from, d)}" alt="Foto de ${esc(nameOf(c.from))}" onclick="viewPhoto(this)">` : ''}
    ${c.text ? `<p class="adv-text">${esc(c.text)}</p>` : ''}
    ${c.type === 'cupon' && c.from ? '<p class="small muted" style="margin:0">Quedó guardado en Detalles → Cupones para que lo canjees.</p>' : ''}
    ${c.type === 'pregunta' ? '<p class="small muted" style="margin:0">Respóndanla juntos hoy 💬</p>' : ''}
    ${c.photo && c.from && !c.savedMoment ? `<button class="btn ghost small" onclick="adventToMoments(${d})">📸 Guardar en Momentos</button>` : ''}
    <button class="btn" onclick="closeSheet()">${fresh ? '¡Gracias! 💖' : 'Cerrar'}</button></div>`);
  loadPhotos($('sheet'));
}
async function adventToMoments(d) {
  const f = fillOf(partnerUid(), d); if (!f?.photo) return;
  const pid = photoId(f.by, d), full = await getPhoto(pid);
  if (!full) return toast('Esa foto ya no está');
  const thumb = await getPhoto(thumbId(pid)) || await makeThumb(full).catch(() => null);
  const r = newRef('moments'), b = writeBatch(db);
  b.set(ref('photos', r.id), { data: full }); cachePhoto(r.id, full);
  if (thumb) { b.set(ref('photos', thumbId(r.id)), { data: thumb }); cachePhoto(thumbId(r.id), thumb); }
  b.set(r, { title: `🎄 Casilla ${d} del adviento`, date: `${YEAR()}-12-${pad(d)}`, note: f.text || '', hasPhoto: true, place: null, by: uid(), createdAt: Date.now(), fromAdvent: true });
  b.update(ref('advent', f.id), { savedMoment: r.id });
  write(b.commit());
  closeSheet(); toast('Guardada en Momentos 📸');
}

/* ---------- Llenarle casillas a la pareja ---------- */
let fillType = 'nota', fillPhoto = null, lastFillPush = 0;
function adventFill(d) {
  const me = uid(), p = partnerUid(), pn = esc(partnerName()), f = fillOf(me, d);
  if (!p) return toast('Hace falta que estén los dos');
  if (openedAt(p, d)) return f ? adventGiven(d) : toast(`${partnerName()} ya abrió esa casilla`);
  if (!canFill()) return f ? adventGiven(d) : toast('Ya pasó el tiempo de llenar casillas');
  fillType = f?.type || 'nota'; fillPhoto = null;
  openSheet(`<div class="stack"><h2>🎄 Casilla ${d} para ${pn}</h2>
    <p class="small muted" style="margin:0">La verá cuando abra la casilla del ${d} de diciembre.</p>
    <div class="seg" id="advTypes">${TYPES.map(([k, e, l]) => `<button data-k="${k}" class="${fillType === k ? 'on' : ''}" onclick="advType(${d},'${k}')">${e} ${l}</button>`).join('')}</div>
    <div id="advFields" class="stack" style="gap:8px"></div>
    <div class="row">${f ? `<button class="btn ghost danger" onclick="adventClear(${d})">Vaciar</button>` : ''}<button class="btn" style="flex:1" onclick="adventSave(${d})">Guardar</button></div></div>`);
  advFields(d, f);
}
function advFields(d, f = fillOf(uid(), d)) {
  const text = $('advText')?.value ?? f?.text ?? '', emoji = $('advEmoji')?.value ?? (f?.type === fillType ? f?.emoji : '') ?? '';
  const pn = esc(partnerName());
  const box = $('advFields'); if (!box) return;
  const ph = { nota: `Escríbele algo bonito a ${pn}…`, cupon: 'Vale por…', foto: 'Una frase para la foto (opcional)', plan: 'Hoy te invito a…' }[fillType];
  box.innerHTML = `${fillType === 'foto' ? `<label class="btn ghost small" style="text-align:center">📷 ${f?.photo || fillPhoto ? 'Cambiar la foto' : 'Elegir una foto'}<input type="file" id="advPhoto" accept="image/*" hidden onchange="advPhoto(this)"></label>
      <div id="advPrev" class="center">${fillPhoto ? `<img class="adv-photo" src="${fillPhoto.full}" alt="">` : f?.photo ? `<img class="adv-photo" data-photo="${photoId(uid(), d)}" alt="">` : ''}</div>` : ''}
    ${fillType === 'cupon' || fillType === 'plan' ? `<div class="add-row"><input id="advEmoji" style="flex:0 0 60px;text-align:center" maxlength="4" aria-label="Emoji" value="${esc(emoji || typeEmoji(fillType))}"><span class="small muted grow">Emoji de la casilla</span></div>` : ''}
    <textarea id="advText" rows="${fillType === 'nota' ? 4 : 2}" maxlength="400" placeholder="${ph}" aria-label="Texto">${esc(text)}</textarea>`;
  loadPhotos(box);
}
function advType(d, k) {
  fillType = k;
  document.querySelectorAll('#advTypes button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('advEmoji')?.closest('.add-row')?.remove(); // el emoji vuelve al de ese tipo
  advFields(d);
}
async function advPhoto(input) {
  const file = input.files?.[0]; if (!file) return;
  try {
    const full = await compressImage(file, 1280);
    fillPhoto = { full, thumb: await makeThumb(full).catch(() => null) };
    $('advPrev').innerHTML = `<img class="adv-photo" src="${full}" alt="">`;
  } catch (e) { photoError(e); }
}
function adventSave(d) {
  const me = uid(), p = partnerUid(), f = fillOf(me, d);
  const text = ($('advText')?.value || '').trim(), emoji = ($('advEmoji')?.value || '').trim();
  if (fillType !== 'foto' && !text) return toast('Escribe algo');
  const keepPhoto = fillType === 'foto' && !fillPhoto && f?.photo;
  if (fillType === 'foto' && !fillPhoto && !keepPhoto) return toast('Elige una foto');
  const b = writeBatch(db), pid = photoId(me, d);
  if (fillType === 'foto' && fillPhoto) {
    b.set(ref('photos', pid), { data: fillPhoto.full }); cachePhoto(pid, fillPhoto.full);
    if (fillPhoto.thumb) { b.set(ref('photos', thumbId(pid)), { data: fillPhoto.thumb }); cachePhoto(thumbId(pid), fillPhoto.thumb); }
  }
  if (fillType !== 'foto' && f?.photo) { b.delete(ref('photos', pid)); b.delete(ref('photos', thumbId(pid))); }
  b.set(ref('advent', fillId(me, d)), { year: YEAR(), day: d, by: me, to: p, type: fillType, text, emoji: fillType === 'cupon' || fillType === 'plan' ? (emoji || typeEmoji(fillType)) : typeEmoji(fillType), photo: fillType === 'foto', at: Date.now() });
  write(b.commit());
  closeSheet(); markActive();
  toast(`Listo: casilla ${d} lista para ${partnerName()} 🎁`);
  // Aviso a la pareja (sin decir qué es), como mucho uno cada 15 minutos si llena varias seguidas
  if (!f && Date.now() - lastFillPush > 15 * 60e3) {
    lastFillPush = Date.now();
    notify('advent', { title: `🎁 ${meForPartner()} te llenó una casilla del calendario`, body: `La casilla ${d}: la verás ese día 🎄`, url: './?open=advent', tag: 'advent-fill' });
  }
}
async function adventClear(d) {
  if (!(await ask(`¿Vaciar la casilla ${d}? Vuelve a traer la sorpresa de la app.`, { ok: 'Vaciar', danger: true }))) return;
  const me = uid(), f = fillOf(me, d); if (!f) return;
  const b = writeBatch(db), pid = photoId(me, d);
  b.delete(ref('advent', f.id));
  if (f.photo) { b.delete(ref('photos', pid)); b.delete(ref('photos', thumbId(pid))); }
  write(b.commit()); closeSheet(); toast('Casilla vacía');
}
// Lo que le dejé (cuando ya no se puede cambiar)
function adventGiven(d) {
  const f = fillOf(uid(), d), seen = openedAt(partnerUid(), d);
  openSheet(`<div class="stack center adv-open"><span class="tiny muted">Casilla ${d} para ${esc(partnerName())}</span>
    <div class="adv-emoji" aria-hidden="true">${esc(f.emoji || typeEmoji(f.type))}</div>
    ${f.photo ? `<img class="adv-photo" data-photo="${photoId(uid(), d)}" alt="" onclick="viewPhoto(this)">` : ''}
    ${f.text ? `<p class="adv-text">${esc(f.text)}</p>` : ''}
    <p class="small muted" style="margin:0">${seen ? `👀 La abrió el ${new Date(seen).toLocaleDateString('es', { day: 'numeric', month: 'long' })}` : 'Todavía no la abre'}</p>
    <button class="btn" onclick="closeSheet()">Cerrar</button></div>`);
  loadPhotos($('sheet'));
}

// Subtítulo del mosaico en Más
function adventSub() {
  if (!partnerUid()) return '';
  if (!inDec()) return `Le llenaste ${DAYS.filter(d => fillOf(uid(), d)).length} de 24 casillas`;
  const left = adventReady();
  return left ? `${left === 1 ? '1 casilla' : left + ' casillas'} por abrir 🎁` : now().getDate() > 24 ? '¡Feliz Navidad! 🎄' : 'Ya abriste la de hoy';
}

expose({ adventSub, openAdvent, advView, adventOpen, adventShow, adventLocked, adventToMoments, adventFill, advType, advPhoto, adventSave, adventClear, adventGiven });
