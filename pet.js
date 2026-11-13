// Mascota de los dos: empieza como huevo y crece con los días en que ambos hacen algo en Futari (la misma regla
// que la racha: ánimo, pregunta, corazón, foto del día, instantánea, nota, cupón o canción).
// Si un día no comen los dos, se pone triste, pero nunca pierde lo que ya creció.
// Doc "pet/main": { start: 'AAAA-MM-DD', createdAt, by, species?, name?, hatchedAt?, hatchedBy? }
import { setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, expose, toast, openSheet, closeSheet, write, ref, today, dayKey, todayKey, parseDate, nameOf, partnerUid,
         plural, uid, celebrate, go } from './core.js';
import { bothDid, didSomething, streak } from './home.js';

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

const PHRASES = ['¡Me encanta que me acaricien! 💕', '¡Más, más! 🥰', 'Los quiero mucho 💞', '¿Jugamos? 🎈', 'Prrr… 😌', '¡Hoy es un buen día! ☀️', '¿Ya se dijeron que se quieren? 💌'];
function talk() {
  const el = $('petTalk'), body = $('petBody'); if (!el || !body) return;
  el.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  body.classList.remove('pet-pat'); void body.offsetWidth; body.classList.add('pet-pat');
  celebrate('hearts'); navigator.vibrate?.(12);
}

/* ---------- Tarjeta de Inicio ---------- */
export function petCard() {
  const p = pet(), partner = partnerUid();
  if (!p) return `<div class="glass stack pet-card"><div class="row"><span class="label">🥚 Su mascota</span></div>
    <div class="pet-stage"><div class="pet-body wobble" style="font-size:64px">🥚</div></div>
    <p class="small muted center" style="margin:0">Adopten un huevo: va a crecer cada día que los dos hagan algo en Futari. Si un día se les olvida, se pone triste, pero no pierde lo que creció.</p>
    <button class="btn" onclick="adoptPet()">🥚 Adoptar un huevo</button></div>`;
  const n = fedDays(p), st = stageOf(n, p), mood = petMood(p), s = streak();
  const hour = new Date().getHours(), night = hour >= 22 || hour < 6;
  const ready = !p.hatchedAt && n >= HATCH_AT;
  const next = STAGES[st + 1] || (st === 0 ? STAGES[1] : null);
  const goal = st === 0 ? HATCH_AT : next?.[0];
  const prevMin = st === 0 ? 0 : STAGES[st][0];
  const pct = goal ? Math.max(0, Math.min(100, Math.round((n - prevMin) / (goal - prevMin) * 100))) : 100;
  const label = petLabel(p), Label = label.charAt(0).toUpperCase() + label.slice(1);
  const who = id => esc(id === uid() ? 'Tú' : nameOf(id));
  const done = id => didSomething(todayKey(), id);
  const status = ready ? `¡${Label} se está moviendo! Tóquenlo para que nazca 🐣`
    : mood === 'fed' ? (night ? `${Label} ya comió y está durmiendo 💤` : `¡${Label} ya comió hoy! 😋`)
    : mood === 'sad' ? `${Label} está triste porque ayer no comió 😢 Si hoy hacen algo los dos, se le pasa`
    : mood === 'half' ? `${done(uid()) ? 'Ya le diste de comer' : `${who(partner)} ya le dio de comer`}; falta ${done(uid()) ? who(partner) : 'que tú hagas algo'}`
    : `${Label} tiene hambre. Hagan algo en Futari para darle de comer`;
  const emoji = petEmoji(p), size = STAGES[st][2];
  const cls = ready ? 'wobble' : mood === 'sad' ? 'sad' : mood === 'fed' && night ? 'sleep' : mood === 'fed' ? 'happy' : 'idle';
  return `<div class="glass stack pet-card"><div class="row"><span class="label">${p.hatchedAt ? emoji : '🥚'} ${esc(p.hatchedAt ? (p.name || 'Su mascota') : 'Su huevo')}</span>
      <span class="pill">${esc(STAGES[st][1])}${s ? ` · 🔥 ${s}` : ''}</span></div>
    <button class="pet-stage" onclick="${ready ? 'hatchPet()' : p.hatchedAt ? 'petTalk()' : 'eggTalk()'}" aria-label="${ready ? 'Abrir el huevo' : 'Acariciar'}">
      <div class="pet-body ${cls}" id="petBody" style="font-size:${size}px">${emoji}${st === 5 ? '<i class="pet-crown">👑</i>' : ''}${cls === 'sleep' ? '<i class="pet-z">💤</i>' : ''}${cls === 'sad' ? '<i class="pet-tear">💧</i>' : ''}</div>
      <div class="pet-talk" id="petTalk"></div></button>
    <p class="small center" style="margin:0">${status}</p>
    ${partner ? `<div class="pet-today"><span class="${done(uid()) ? 'ok' : ''}">${done(uid()) ? '✅' : '⏳'} Tú</span><span class="${done(partner) ? 'ok' : ''}">${done(partner) ? '✅' : '⏳'} ${who(partner)}</span></div>` : ''}
    ${goal ? `<div class="pet-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="tiny muted center" style="margin:0">${st === 0 ? (ready ? 'Ya puede nacer' : `Nace cuando hayan comido ${plural(HATCH_AT, 'día', 'días')} (${n}/${HATCH_AT})`) : `${plural(Math.max(1, goal - n), 'día', 'días')} más para ser ${STAGES[st + 1][1].toLowerCase()}`}</p>`
      : '<p class="tiny muted center" style="margin:0">Llegó a la etapa máxima 👑</p>'}
    <button class="link" style="align-self:center" onclick="petHelp()">¿Cómo se alimenta?</button></div>`;
}

/* ---------- Acciones ---------- */
function adoptPet() {
  if (pet()) return;
  write(setDoc(ref('pet', 'main'), { start: todayKey(), createdAt: Date.now(), by: uid() }));
  toast('¡Adoptaron un huevo! 🥚'); celebrate('hearts');
}
function eggTalk() {
  const el = $('petTalk'); if (!el) return;
  el.textContent = `Todavía no está listo… faltan ${plural(Math.max(1, HATCH_AT - fedDays()), 'día', 'días')} 🥚`;
  const body = $('petBody'); body?.classList.remove('wobble'); void body?.offsetWidth; body?.classList.add('wobble');
}
function hatchPet() {
  const p = pet(); if (!p || p.hatchedAt) return;
  const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)][0];
  const body = $('petBody');
  if (body) { body.classList.add('cracking'); body.textContent = '🐣'; }
  setTimeout(() => {
    write(updateDoc(ref('pet', 'main'), { species: sp, hatchedAt: Date.now(), hatchedBy: uid() }));
    celebrate();
    openSheet(`<div class="stack center"><div style="font-size:84px;line-height:1">${sp}</div>
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
  write(updateDoc(ref('pet', 'main'), { name, namedBy: uid() }));
  closeSheet(); toast(`¡Hola, ${name}! 💕`);
}
function petHelp() {
  const p = pet();
  openSheet(`<div class="stack"><h2>${p?.hatchedAt ? esc(petEmoji(p)) : '🥚'} Cómo cuidar a ${esc(petLabel(p) || 'su mascota')}</h2>
    <p class="small" style="margin:0">Come una vez al día, cuando <b>los dos</b> hacen al menos una de estas cosas:</p>
    <ul class="small" style="margin:0;padding-left:20px;line-height:1.7">
      <li>Marcar cómo se sienten</li><li>Responder la pregunta del día</li><li>Mandar un «pensando en ti»</li>
      <li>Subir la foto del día o mandar una instantánea</li><li>Dejar una nota, regalar un cupón o dedicar una canción</li></ul>
    <p class="small muted" style="margin:0">Cada día que come cuenta para crecer: nace a los ${HATCH_AT} días, y luego crece a los ${STAGES.slice(2).map(s => s[0]).join(', ')} días.
      Si un día no come, se pone triste, pero <b>no pierde</b> lo que ya creció. Con las notificaciones activas, les avisa en la noche si todavía tiene hambre.</p>
    ${p?.hatchedAt ? `<button class="btn ghost" onclick="renamePet()">✏️ Cambiar su nombre</button>` : ''}
    <button class="btn ghost" onclick="closeSheet();go('s-settings')">🔔 Notificaciones</button></div>`);
}

expose({ adoptPet, eggTalk, hatchPet, petTalk: talk, renamePet, savePetName, petHelp });
