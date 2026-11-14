// Mascota de los dos: empieza como huevo y crece con los días en que ambos hacen algo en Futari (la misma regla
// que la racha: ánimo, pregunta, corazón, foto del día, instantánea, nota, cupón o canción).
// Si un día no comen los dos, se pone triste, pero nunca pierde lo que ya creció.
// Doc "pet/main": { start: 'AAAA-MM-DD', createdAt, by, species?, name?, hatchedAt?, hatchedBy?,
//   bonus (monedas ganadas jugando), spent (gastadas), owned { idPrenda: true }, wear { head, face, neck, body, room },
//   best { juego: { uid: récord } }, gameDay { uid: { day, n } } (monedas de juegos hoy, máx. GAME_CAP) }
// Monedas = 10 por cada día que comió + bonus − spent (son de los dos). Dibujos: pet-art.js · juegos: pet-games.js.
import { setDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, onShow, on, expose, toast, openSheet, closeSheet, write, ref, today, dayKey, todayKey, parseDate, nameOf, partnerUid,
         plural, uid, celebrate, go, ask } from './core.js';
import { bothDid, didSomething, streak } from './home.js';
import { backBar } from './lists.js';
import { sceneSVG, petSVG, ITEMS, SLOTS, timeOfDay } from './pet-art.js';
import { GAMES, playGame } from './pet-games.js';
import { arrowsVisible, arrowsWrapped } from './arrows.js';
import { busVisible, busWrapped } from './bus.js';
// La parada (bus.js), igual: envuelta si todavía no la abre
const busRow = () => !busVisible() ? '' : busWrapped()
  ? `<div class="pet-game gift-row"><span class="pet-game-ic">🎁</span><div class="grow"><b>Un juego sorpresa</b><span class="tiny muted" style="display:block">Está envuelto para ti</span></div><button class="btn small" onclick="unwrapGift('bus')">Abrir</button></div>`
  : `<div class="pet-game"><span class="pet-game-ic">🚏</span><div class="grow"><b>La parada</b><span class="tiny muted" style="display:block">Saca los vehículos y lleva a los pasajeros de su color. Niveles, reto del día y duelos</span></div><button class="btn small" onclick="go('s-bus')">Jugar</button></div>`;
// Flechas (arrows.js) también sale aquí; envuelto como regalo si la pareja aún no lo abre
const arrowsRow = () => !arrowsVisible() ? '' : arrowsWrapped()
  ? `<div class="pet-game gift-row"><span class="pet-game-ic">🎁</span><div class="grow"><b>Un juego sorpresa</b><span class="tiny muted" style="display:block">Está envuelto para ti</span></div><button class="btn small" onclick="unwrapGift('arrows')">Abrir</button></div>`
  : `<div class="pet-game"><span class="pet-game-ic">🏹</span><div class="grow"><b>Flechas</b><span class="tiny muted" style="display:block">Saca todas las flechas del tablero sin chocar. Niveles y reto del día</span></div><button class="btn small" onclick="go('s-arrows')">Jugar</button></div>`;
import { notify, meForPartner } from './push.js';

// [emoji, nombre, artículo]
export const SPECIES = [['🐱', 'gatito', 'un'], ['🐶', 'perrito', 'un'], ['🐰', 'conejito', 'un'], ['🦊', 'zorrito', 'un'], ['🐼', 'panda', 'un'],
  ['🐧', 'pingüino', 'un'], ['🐻', 'osito', 'un'], ['🐨', 'koala', 'un'], ['🐹', 'hámster', 'un'], ['🦦', 'nutria', 'una']];
// [días comidos para llegar, nombre de la etapa, tamaño del emoji]
export const STAGES = [[0, 'Huevo', 64], [3, 'Bebé', 56], [10, 'Pequeño', 70], [30, 'Grande', 84], [60, 'Adulto', 96], [100, 'Leyenda', 100]];
const HATCH_AT = STAGES[1][0];

export const pet = () => S.data.pet.find(p => p.id === 'main') || null;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Días en que comió (los dos hicieron algo) desde que lo adoptaron
export function fedDays(p = pet()) {
  if (!p?.start) return 0;
  const keys = new Set([...S.data.moods, ...S.data.answers, ...S.data.thinks, ...S.data.daily, ...S.data.activity].map(x => x.id));
  let n = 0; for (const k of keys) if (k >= p.start && k <= todayKey() && bothDid(k)) n++;
  return n;
}
export function stageOf(n, p = pet()) {
  if (!p?.hatchedAt) return 0; // hasta que lo abran sigue siendo huevo
  let s = 1; STAGES.forEach(([min], i) => { if (i > 0 && n >= min) s = i; });
  return s;
}
// Estado de hoy: fed (comió), half (falta uno), hungry (aún nadie), sad (ayer no comió y hoy todavía no)
export function petMood(p = pet()) {
  const tk = todayKey(), y = dayKey(addDays(today(), -1)), partner = partnerUid();
  if (bothDid(tk)) return 'fed';
  const yesterdayCounts = p?.start && y >= p.start;
  if (yesterdayCounts && !bothDid(y)) return 'sad';
  return didSomething(tk, uid()) || (partner && didSomething(tk, partner)) ? 'half' : 'hungry';
}
const speciesName = e => SPECIES.find(s => s[0] === e)?.[1] || 'mascota';
export const petLabel = (p = pet()) => !p ? '' : !p.hatchedAt ? 'el huevo' : (p.name || `su ${speciesName(p.species)}`);
export const petEmoji = (p = pet()) => !p ? '🥚' : !p.hatchedAt ? '🥚' : p.species;

export const COINS_PER_DAY = 10, GAME_CAP = 30;
export const coins = (p = pet()) => !p ? 0 : fedDays(p) * COINS_PER_DAY + (p.bonus || 0) - (p.spent || 0);
// Cómo se dibuja hoy: ánimo del dibujo, etapa, si el platito está lleno
function look(p = pet()) {
  const n = fedDays(p), st = stageOf(n, p), mood = petMood(p), time = timeOfDay();
  const art = mood === 'fed' ? (time === 'noche' ? 'dormido' : 'feliz') : mood === 'sad' ? 'triste' : 'hambre';
  return { n, st, mood, time, egg: !p?.hatchedAt, ready: !p?.hatchedAt && n >= HATCH_AT, opts: { species: p?.species, mood: art, stage: st || 1, wear: p?.wear || {} }, fed: mood === 'fed' };
}
function petScene(p, size = '') {
  const L = look(p);
  return sceneSVG({ ...L.opts, egg: L.egg, ready: L.ready, fed: L.fed, time: L.time, label: petLabel(p) || 'Su mascota' }).replace('<svg ', `<svg class="pet-scene ${size}" `);
}
function statusText(p) {
  const L = look(p), partner = partnerUid(), night = L.time === 'noche';
  const label = petLabel(p), Label = label.charAt(0).toUpperCase() + label.slice(1);
  const who = id => esc(id === uid() ? 'Tú' : nameOf(id)), done = id => didSomething(todayKey(), id);
  return L.ready ? `¡${Label} se está moviendo! Tóquenlo para que nazca 🐣`
    : L.mood === 'fed' ? (night ? `${Label} ya comió y está durmiendo 💤` : `¡${Label} ya comió hoy! 😋`)
    : L.mood === 'sad' ? `${Label} está triste porque ayer no comió 😢 Si hoy hacen algo los dos, se le pasa`
    : L.mood === 'half' ? `${done(uid()) ? 'Ya le diste de comer' : `${who(partner)} ya le dio de comer`}; falta ${done(uid()) ? who(partner) : 'que tú hagas algo'}`
    : `${Label} tiene hambre. Hagan algo en Futari para darle de comer`;
}
function progress(p) {
  const { n, st, ready } = look(p);
  const goal = st === 0 ? HATCH_AT : STAGES[st + 1]?.[0], prevMin = st === 0 ? 0 : STAGES[st][0];
  const pct = goal ? Math.max(0, Math.min(100, Math.round((n - prevMin) / (goal - prevMin) * 100))) : 100;
  return goal ? `<div class="pet-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="tiny muted center" style="margin:0">${st === 0 ? (ready ? 'Ya puede nacer' : `Nace cuando hayan comido ${plural(HATCH_AT, 'día', 'días')} (${n}/${HATCH_AT})`) : `${plural(Math.max(1, goal - n), 'día', 'días')} más para ser ${STAGES[st + 1][1].toLowerCase()}`}</p>`
    : '<p class="tiny muted center" style="margin:0">Llegó a la etapa máxima 👑</p>';
}
const todayRow = () => {
  const partner = partnerUid(); if (!partner) return '';
  const done = id => didSomething(todayKey(), id);
  return `<div class="pet-today"><span class="${done(uid()) ? 'ok' : ''}">${done(uid()) ? '✅' : '⏳'} Tú</span><span class="${done(partner) ? 'ok' : ''}">${done(partner) ? '✅' : '⏳'} ${esc(nameOf(partner))}</span></div>`;
};

/* ---------- Tarjeta de Inicio ---------- */
export function petCard() {
  const p = pet();
  if (!p) return `<div class="glass stack pet-card"><div class="row"><span class="label">🥚 Su mascota</span></div>
    <div class="pet-stage">${sceneSVG({ egg: true, time: timeOfDay(), label: 'Huevo' }).replace('<svg ', '<svg class="pet-scene" ')}</div>
    <p class="small muted center" style="margin:0">Adopten un huevo: va a crecer cada día que los dos hagan algo en Futari. Si un día se les olvida, se pone triste, pero no pierde lo que creció.</p>
    <button class="btn" onclick="adoptPet()">🥚 Adoptar un huevo</button></div>`;
  const L = look(p), s = streak();
  return `<div class="glass stack pet-card"><div class="row"><span class="label">${p.hatchedAt ? p.species : '🥚'} ${esc(p.hatchedAt ? (p.name || 'Su mascota') : 'Su huevo')}</span>
      <span class="pill">${esc(STAGES[L.st][1])}${s ? ` · 🔥 ${s}` : ''}</span></div>
    <button class="pet-stage" onclick="${L.ready ? 'hatchPet()' : p.hatchedAt ? "go('s-pet')" : 'eggTalk()'}" aria-label="${L.ready ? 'Abrir el huevo' : p.hatchedAt ? 'Abrir su mascota' : 'Huevo'}">
      ${petScene(p)}<div class="pet-talk" id="petTalk"></div></button>
    <p class="small center" style="margin:0">${statusText(p)}</p>
    ${todayRow()}${progress(p)}
    ${p.hatchedAt ? `<div class="grid2"><button class="btn ghost small" style="width:100%" onclick="openPet('vestir')">👗 Vestir · 🪙 ${coins(p)}</button><button class="btn ghost small" style="width:100%" onclick="openPet('juegos')">🎮 Jugar</button></div>` : ''}
    <button class="link" style="align-self:center" onclick="petHelp()">¿Cómo se alimenta?</button></div>`;
}

/* ---------- Pantalla de la mascota: Vestir, Tienda y Juegos ---------- */
let tab = 'vestir', slotSel = 'head';
function openPet(t) { if (t) tab = t; go('s-pet'); }
function petTab(t) { tab = t; render(); }
function petSlot(s) { slotSel = s; render(); }
const PHRASES = ['¡Me encanta que me acaricien! 💕', '¡Más, más! 🥰', 'Los quiero mucho 💞', '¿Jugamos? 🎈', 'Prrr… 😌', '¡Hoy es un buen día! ☀️', '¿Ya se dijeron que se quieren? 💌', '¿Me compran algo bonito? 🛍️'];
function talk() {
  const el = $('petTalk2') || $('petTalk'); if (!el) return;
  el.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const sv = document.querySelector('#s-pet .pa-pet, .pet-card .pa-pet');
  sv?.classList.remove('pa-hop'); void sv?.getBoundingClientRect(); sv?.classList.add('pa-hop');
  celebrate('hearts'); navigator.vibrate?.(12);
}
function render() {
  if (!$('s-pet').classList.contains('active')) return;
  const p = pet();
  if (!p?.hatchedAt) { paint('s-pet', `${backBar('Su mascota', 's-home')}<div class="glass">${petCard()}</div>`); return; }
  const owned = p.owned || {}, wear = p.wear || {}, money = coins(p);
  let body = '';
  if (tab === 'vestir') {
    const mine = ITEMS.filter(i => i.slot === slotSel && owned[i.id]);
    body = `<div class="chips">${SLOTS.map(([k, l]) => `<button class="chip ${slotSel === k ? 'on' : ''}" onclick="petSlot('${k}')">${l}${wear[k] ? ' ✓' : ''}</button>`).join('')}</div>
      ${mine.length ? `<div class="pet-items">${mine.map(i => `<button class="pet-item ${wear[i.slot] === i.id ? 'on' : ''}" onclick="wearItem('${i.id}')" aria-pressed="${wear[i.slot] === i.id}">
          ${itemThumb(p, i)}<b>${esc(i.name)}</b><small>${wear[i.slot] === i.id ? 'Puesto · tocar para quitar' : 'Ponérselo'}</small></button>`).join('')}</div>`
        : `<p class="empty">Todavía no tienen nada de ${esc(SLOTS.find(s => s[0] === slotSel)[1].toLowerCase())}. <button class="link" onclick="petTab('tienda')">Ir a la tienda</button></p>`}
      ${Object.values(wear).some(Boolean) ? `<button class="link" style="align-self:center" onclick="undress()">Quitarle todo</button>` : ''}`;
  } else if (tab === 'tienda') {
    body = `<p class="small muted" style="margin:0">Las monedas son de los dos. Ganan ${COINS_PER_DAY} 🪙 cada día que ${esc(petLabel(p))} come y hasta ${GAME_CAP} 🪙 al día cada uno jugando.</p>
      ${SLOTS.map(([k, l]) => { const list = ITEMS.filter(i => i.slot === k); return `<span class="label">${l}</span><div class="pet-items">${list.map(i => `<button class="pet-item ${owned[i.id] ? 'have' : ''}" onclick="${owned[i.id] ? `wearItem('${i.id}')` : `buyItem('${i.id}')`}">
          ${itemThumb(p, i)}<b>${esc(i.name)}</b><small>${owned[i.id] ? (wear[i.slot] === i.id ? 'Puesto' : 'Ya es suyo') : `🪙 ${i.price}`}</small></button>`).join('')}</div>`; }).join('')}`;
  } else {
    const gd = p.gameDay?.[uid()], todayCoins = gd?.day === todayKey() ? gd.n : 0, partner = partnerUid();
    body = `<p class="small muted" style="margin:0">Hoy ganaste ${todayCoins} de ${GAME_CAP} 🪙 jugando. Los récords son de cada uno: ¡compitan!</p>
      <div class="stack" style="gap:10px">${GAMES.map(g => { const b = p.best?.[g.id] || {}; return `<div class="pet-game"><span class="pet-game-ic">${g.icon}</span>
        <div class="grow"><b>${esc(g.name)}</b><span class="tiny muted" style="display:block">${esc(g.desc)}</span>
          <span class="tiny">🏆 Tú: <b>${b[uid()] || 0}</b>${partner ? ` · ${esc(nameOf(partner))}: <b>${b[partner] || 0}</b>` : ''}</span></div>
        <button class="btn small" onclick="startGame('${g.id}')">Jugar</button></div>`; }).join('')}${arrowsRow()}${busRow()}</div>`;
  }
  paint('s-pet', `${backBar(p.name || 'Su mascota', 's-home', `<span class="pill pet-coins" aria-label="Monedas">🪙 ${money}</span>`)}
    <div class="glass stack">
      <button class="pet-stage big" onclick="petTalk()" aria-label="Acariciar">${petScene(p, 'big')}<div class="pet-talk" id="petTalk2"></div></button>
      <p class="small center" style="margin:0">${statusText(p)}</p>${todayRow()}${progress(p)}
      <div class="row" style="justify-content:center;gap:14px"><button class="link" onclick="renamePet()">✏️ Nombre</button><button class="link" onclick="petHelp()">¿Cómo se alimenta?</button></div></div>
    <div class="seg">${[['vestir', '👗 Vestir'], ['tienda', '🛍️ Tienda'], ['juegos', '🎮 Juegos']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="petTab('${k}')">${l}</button>`).join('')}</div>
    <div class="glass stack">${body}</div>`);
}
// Miniatura: la mascota con esa prenda puesta (o el cuarto con ese detalle)
function itemThumb(p, i) {
  if (i.slot === 'room') return sceneSVG({ species: p.species, mood: 'feliz', stage: 2, wear: { room: i.id }, fed: true, time: 'dia', label: i.name }).replace('<svg ', '<svg class="pet-thumb" ');
  return `<svg class="pet-thumb" viewBox="0 0 160 160" role="img" aria-label="${esc(i.name)}">${petSVG({ species: p.species, mood: 'feliz', stage: 3, wear: { [i.slot]: i.id } })}</svg>`;
}
async function buyItem(id) {
  const p = pet(), it = ITEMS.find(i => i.id === id); if (!p || !it || p.owned?.[id]) return;
  const money = coins(p);
  if (money < it.price) return toast(`Les faltan ${it.price - money} 🪙. ¡Cuídenlo y jueguen para ganar más!`);
  if (!(await ask(`¿Comprar ${it.name} por ${it.price} 🪙? Quedarían ${money - it.price} 🪙.`, { ok: 'Comprar' }))) return;
  write(updateDoc(ref('pet', 'main'), { spent: increment(it.price), [`owned.${id}`]: true, [`wear.${it.slot}`]: id, lastBuy: { id, by: uid(), at: Date.now() } }));
  celebrate(); toast(`¡${it.name} para ${p.name || 'su mascota'}! Ya se lo pusieron`);
  notify('pet', { title: `💝 ${meForPartner()} le compró ${it.name.toLowerCase()} a ${p.name || 'su mascota'}`, body: 'Ya lo tiene puesto. ¡Vayan a verlo!', url: './?open=petgames', tag: 'pet-buy' });
  tab = 'vestir'; slotSel = it.slot;
}
function wearItem(id) {
  const p = pet(), it = ITEMS.find(i => i.id === id); if (!p || !it || !p.owned?.[id]) return;
  const on = p.wear?.[it.slot] === id;
  write(updateDoc(ref('pet', 'main'), { [`wear.${it.slot}`]: on ? null : id }));
  navigator.vibrate?.(10);
}
function undress() { write(updateDoc(ref('pet', 'main'), { wear: {} })); }
function startGame(id) {
  const p = pet(); if (!p?.hatchedAt) return;
  const L = look(p), g = GAMES.find(x => x.id === id);
  playGame(id, { species: p.species, stage: Math.max(2, L.st), wear: { ...(p.wear || {}), room: null } }, score => {
    const cur = pet() || p, partner = partnerUid();
    const mine = cur.best?.[id]?.[uid()] || 0, record = score > mine;
    const gd = cur.gameDay?.[uid()], used = gd?.day === todayKey() ? gd.n : 0;
    const earn = Math.max(0, Math.min(15, g.coins(score), GAME_CAP - used));
    const patch = {};
    if (record) patch[`best.${id}.${uid()}`] = score;
    if (earn) { patch.bonus = increment(earn); patch[`gameDay.${uid()}`] = { day: todayKey(), n: used + earn }; }
    if (Object.keys(patch).length) write(updateDoc(ref('pet', 'main'), patch));
    // Si superaste el récord de tu pareja (y antes no lo tenías superado), se le avisa
    const theirs = partner ? cur.best?.[id]?.[partner] || 0 : 0;
    if (record && theirs > 0 && score > theirs && mine <= theirs) notify('pet', { title: `🏆 ${meForPartner()} superó tu récord en ${g.name}`, body: `${score} puntos contra tus ${theirs}. ¿La revancha?`, url: './?open=petgames', tag: 'pet-rec-' + id });
    return { coins: earn, capped: !earn && used >= GAME_CAP, mine: Math.max(mine, score), record: record && mine > 0, theirs: partner ? cur.best?.[id]?.[partner] || 0 : null, theirsName: partner ? nameOf(partner) : '' };
  });
}

/* ---------- Adoptar, nacer, nombre y ayuda ---------- */
function adoptPet() {
  if (pet()) return;
  write(setDoc(ref('pet', 'main'), { start: todayKey(), createdAt: Date.now(), by: uid() }));
  toast('¡Adoptaron un huevo! 🥚'); celebrate('hearts');
}
function eggTalk() {
  const el = $('petTalk'); if (!el) return;
  el.textContent = `Todavía no está listo… faltan ${plural(Math.max(1, HATCH_AT - fedDays()), 'día', 'días')} 🥚`;
}
function hatchPet() {
  const p = pet(); if (!p || p.hatchedAt) return;
  const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)][0];
  document.querySelector('.pet-card .pet-scene')?.classList.add('pa-crack');
  setTimeout(() => {
    write(updateDoc(ref('pet', 'main'), { species: sp, hatchedAt: Date.now(), hatchedBy: uid() }));
    celebrate();
    notify('pet', { title: '🐣 ¡Nació su mascota!', body: `Es ${SPECIES.find(s => s[0] === sp)?.[2] || 'un'} ${speciesName(sp)}. ¿Cómo le van a poner?`, url: './?open=pet', tag: 'pet-hatch' });
    openSheet(`<div class="stack center"><svg viewBox="0 0 160 160" style="width:150px;height:150px;align-self:center" role="img" aria-label="${esc(speciesName(sp))}">${petSVG({ species: sp, mood: 'feliz', stage: 1 })}</svg>
      <h2>¡Nació ${SPECIES.find(s => s[0] === sp)?.[2] || 'un'} ${esc(speciesName(sp))}!</h2>
      <p class="muted" style="margin:0">¿Cómo le van a poner?</p>
      <input id="petName" maxlength="20" placeholder="Nombre" aria-label="Nombre de la mascota">
      <button class="btn" onclick="savePetName()">Ponerle nombre</button>
      <button class="link" onclick="closeSheet()">Después</button></div>`);
  }, 900);
}
function renamePet() {
  const p = pet(); if (!p?.hatchedAt) return;
  openSheet(`<div class="stack"><h2>Nombre de su ${esc(speciesName(p.species))}</h2>
    <input id="petName" maxlength="20" value="${esc(p.name || '')}" placeholder="Nombre" aria-label="Nombre de la mascota">
    <button class="btn" onclick="savePetName()">Guardar</button></div>`);
}
function savePetName() {
  const name = $('petName').value.trim();
  if (!name) return toast('Escribe un nombre');
  const before = pet()?.name;
  write(updateDoc(ref('pet', 'main'), { name, namedBy: uid() }));
  closeSheet(); toast(`¡Hola, ${name}! 💕`);
  if (name !== before) notify('pet', { title: `🐾 ${meForPartner()} ${before ? 'le cambió el nombre' : 'le puso nombre'} a su mascota`, body: `Ahora se llama ${name} 💕`, url: './?open=pet', tag: 'pet-name' });
}
function petHelp() {
  const p = pet();
  openSheet(`<div class="stack"><h2>${p?.hatchedAt ? esc(p.species) : '🥚'} Cómo cuidar a ${esc(petLabel(p) || 'su mascota')}</h2>
    <p class="small" style="margin:0">Come una vez al día, cuando <b>los dos</b> hacen al menos una de estas cosas:</p>
    <ul class="small" style="margin:0;padding-left:20px;line-height:1.7">
      <li>Marcar cómo se sienten</li><li>Responder la pregunta del día</li><li>Mandar un «pensando en ti»</li>
      <li>Subir la foto del día o mandar una instantánea</li><li>Dejar una nota, regalar un cupón o dedicar una canción</li></ul>
    <p class="small muted" style="margin:0">Cada día que come cuenta para crecer: nace a los ${HATCH_AT} días, y luego crece a los ${STAGES.slice(2).map(s => s[0]).join(', ')} días.
      Si un día no come, se pone triste, pero <b>no pierde</b> lo que ya creció. Cada día que come ganan ${COINS_PER_DAY} 🪙 para la tienda, y pueden ganar más jugando.
      Con las notificaciones activas, les avisa en la noche si todavía tiene hambre.</p>
    ${p?.hatchedAt ? `<button class="btn ghost" onclick="renamePet()">✏️ Cambiar su nombre</button>` : ''}
    <button class="btn ghost" onclick="closeSheet();go('s-settings')">🔔 Notificaciones</button></div>`);
}

on('pet moods answers thinks daily activity profiles', render);
onShow('s-pet', render);
expose({ adoptPet, eggTalk, hatchPet, petTalk: talk, renamePet, savePetName, petHelp, openPet, petTab, petSlot, buyItem, wearItem, undress, startGame });
