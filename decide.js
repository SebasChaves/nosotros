// Decidir: listas con tres modos (al azar, por turnos, match) y la ruleta de ideas de citas.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, animatePick,
         nameOf, partnerUid, partnerName, uid } from './core.js';
import { DEFAULT_IDEAS, LIST_TEMPLATES } from './data.js';

let tab = 'lists', selList = null, pendingSel = null, mode = null, turns = null, randomResult = null, lastIdea = null;
const filters = { place: 'todo', cost: 'todo' };
const PLACES = [['todo', 'Todo'], ['casa', 'En casa'], ['afuera', 'Afuera']];
const COSTS = [['todo', 'Cualquier precio'], ['0', 'Gratis'], ['1', '$'], ['2', '$$'], ['3', '$$$']];
const costLbl = c => ['Gratis', '$', '$$', '$$$'][c];

const curList = () => S.data.lists.find(l => l.id === selList);
const myVotes = l => l.votes?.[uid()] || {};
const theirVotes = l => { const p = partnerUid(); return (p && l.votes?.[p]) || {}; };
export function listNeedsMyVote(l) {
  return Object.keys(theirVotes(l)).length > 0 && (l.options || []).some(o => !(o in myVotes(l)));
}

/* ---------- Pantalla ---------- */
function render() {
  const waiting = S.data.lists.filter(listNeedsMyVote).length;
  if (!$('decideBody')) $('s-decide').innerHTML = `<div class="topbar"><h1>¿Qué hacemos?</h1></div><div id="decideHead"></div><div id="decideBody" class="stack" style="gap:14px"></div>`;
  paint('decideHead', `<div class="seg"><button class="${tab === 'lists' ? 'on' : ''}" onclick="decideTab('lists')">Decidir algo${waiting ? `<b class="dot">${waiting}</b>` : ''}</button>
      <button class="${tab === 'citas' ? 'on' : ''}" onclick="decideTab('citas')">Ideas de citas</button></div>`);
  tab === 'lists' ? renderLists() : renderCitas();
}
function decideTab(t) { tab = t; render(); }

/* ---------- Listas ---------- */
function renderLists() {
  const lists = [...S.data.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (curList()) pendingSel = null;
  else if (selList !== pendingSel) { selList = lists[0]?.id || null; mode = null; turns = null; }
  const l = curList();
  let html = `<div class="chips scroll">${lists.map(x =>
    `<button class="chip ${x.id === selList ? 'on' : ''}" onclick="selectList('${x.id}')">${esc(x.emoji)} ${esc(x.name)}${listNeedsMyVote(x) ? ' •' : ''}</button>`).join('')}
    <button class="chip" onclick="newList()">${icon('plus')} Nueva lista</button></div>`;
  if (!lists.length) {
    html += `<div class="glass stack"><h2>Empiecen con una lista</h2>
      <p class="small muted" style="margin:0">Después pueden cambiar las opciones como quieran.</p>
      <div class="chips">${LIST_TEMPLATES.map((t, i) => `<button class="chip" onclick="fromTemplate(${i})">${t.emoji} ${esc(t.name)}</button>`).join('')}</div></div>`;
  }
  if (l) {
    const opts = l.options || [];
    html += `<div class="glass stack">
      <div class="row"><h2>${esc(l.emoji)} ${esc(l.name)}</h2><button class="del" aria-label="Borrar lista" onclick="delList('${l.id}')">${icon('trash')}</button></div>
      <div class="chips">${opts.map((o, i) => `<span class="chip">${esc(o)}<span class="x" role="button" tabindex="0" aria-label="Quitar ${esc(o)}" onclick="delOption(${i})">${icon('x')}</span></span>`).join('') || '<span class="small muted">Sin opciones todavía</span>'}</div>
      <div class="add-row"><input id="newOption" placeholder="Agregar opción…" maxlength="40" aria-label="Nueva opción" onkeydown="if(event.key==='Enter')addOption()">
        <button class="btn" aria-label="Agregar" onclick="addOption()">${icon('plus')}</button></div></div>
      <div class="modes">
        <button class="mode ${mode === 'random' ? 'on' : ''}" onclick="setMode('random')">${icon('dice', 'ic lg')}<b>Al azar</b><small>Decide la suerte</small></button>
        <button class="mode ${mode === 'turns' ? 'on' : ''}" onclick="setMode('turns')">${icon('x', 'ic lg')}<b>Por turnos</b><small>Eliminan una y una</small></button>
        <button class="mode ${mode === 'match' ? 'on' : ''}" onclick="setMode('match')">${icon('heart', 'ic lg')}<b>Match</b><small>Cada uno vota</small>${listNeedsMyVote(l) ? '<b class="dot">!</b>' : ''}</button>
      </div><div id="modeArea" class="stack"></div>`;
  }
  paint('decideBody', html);
  if (l) renderMode();
}

function renderMode() {
  const l = curList(), area = $('modeArea');
  if (!l || !area) return;
  const opts = l.options || [];
  if (!mode) return paint(area, '<p class="small muted center" style="margin:0">Elijan cómo decidir</p>');
  if (opts.length < 2) return paint(area, '<p class="muted center">Agreguen al menos 2 opciones.</p>');

  if (mode === 'random') {
    return paint(area, `<div class="glass wheel" id="dWheel"><div class="emoji">${esc(l.emoji)}</div>
      <div class="txt" id="dTxt">${randomResult ? esc(randomResult) : '¿Qué saldrá?'}</div></div>
      <button class="btn" id="dSpin" onclick="decideRandom()">${icon('dice')} ${randomResult ? 'Otra vez' : 'Sortear'}</button>`);
  }
  if (mode === 'turns') {
    if (!turns) { const p = partnerUid(); turns = { remaining: [...opts], who: 0, order: p ? [uid(), p] : [uid()] }; }
    if (turns.remaining.length === 1) {
      return paint(area, `<div class="glass winner"><div style="font-size:48px">🏆</div><div class="muted">Ganó</div>
        <div class="name grad-text">${esc(turns.remaining[0])}</div></div>
        <button class="btn ghost" onclick="restartTurns()">Jugar otra vez</button>`);
    }
    const who = nameOf(turns.order[turns.who % turns.order.length]);
    return paint(area, `<div class="glass stack"><div class="center"><div class="small muted">Pásense el teléfono</div>
      <h2 style="margin-top:4px">Turno de ${esc(who)}: elimina una</h2></div>
      <div class="opt-grid">${turns.remaining.map((o, i) => `<button class="opt-btn" onclick="eliminate(${i})">${esc(o)}</button>`).join('')}</div></div>
      <button class="link" onclick="restartTurns()">Reiniciar</button>`);
  }
  // match
  const mine = myVotes(l), theirs = theirVotes(l), p = partnerUid(), pn = esc(partnerName());
  const pending = opts.filter(o => !(o in mine));
  if (pending.length) {
    return paint(area, `<div class="glass" style="padding:24px 16px"><div class="label" style="justify-content:center">${esc(l.name)} · ${opts.length - pending.length + 1} de ${opts.length}</div>
      <div class="vote-opt">${esc(pending[0])}</div>
      <div class="vote"><button onclick="vote(false)" aria-label="No">${icon('x', 'ic lg')}</button><button class="yes" onclick="vote(true)" aria-label="Sí">${icon('heart-f', 'ic lg')}</button></div>
      <p class="small muted center" style="margin:16px 0 0">${pn} no verá tus votos, solo en qué coinciden.</p></div>`);
  }
  const partnerDone = p && opts.every(o => o in theirs);
  if (!partnerDone) {
    const n = opts.filter(o => o in theirs).length;
    return paint(area, `<div class="glass center stack"><div style="font-size:40px">⏳</div><h2>¡Ya votaste!</h2>
      <p class="muted" style="margin:0">Esperando a ${pn}${n ? ` (va ${n} de ${opts.length})` : ''}. Le aparecerá un aviso en su app.</p></div>
      <button class="link" onclick="resetVotes()">Empezar de nuevo</button>`);
  }
  const matches = opts.filter(o => mine[o] && theirs[o]);
  if (!matches.length) {
    return paint(area, `<div class="glass center stack"><div style="font-size:40px">😅</div><h2>No coincidieron en nada</h2>
      <p class="muted" style="margin:0">Prueben "Por turnos" para desempatar.</p></div>
      <button class="btn ghost" onclick="resetVotes()">Votar de nuevo</button>`);
  }
  if (matches.length === 1) {
    return paint(area, `<div class="glass winner"><div style="font-size:44px">💞</div><div class="muted">¡Coinciden en!</div>
      <div class="name grad-text">${esc(matches[0])}</div></div><button class="btn ghost" onclick="resetVotes()">Votar de nuevo</button>`);
  }
  paint(area, `<div class="glass stack"><span class="label">Coinciden en ${matches.length}</span>
    <div class="chips">${matches.map(o => `<span class="chip on">${esc(o)}</span>`).join('')}</div>
    <div class="wheel" style="padding:8px"><div class="txt" id="mTxt"></div></div>
    <button class="btn" id="mSpin" onclick="decideAmong()">${icon('dice')} Sortear entre los matches</button></div>
    <button class="link" onclick="resetVotes()">Votar de nuevo</button>`);
}

function selectList(id) { selList = id; mode = null; turns = null; randomResult = null; render(); }
function setMode(m) { mode = m; turns = null; randomResult = null; render(); }
export function createList(name, emoji, options) {
  const r = newRef('lists');
  write(setDoc(r, { name, emoji, options, votes: {}, createdAt: Date.now(), by: uid() }));
  selList = pendingSel = r.id; mode = null; tab = 'lists';
  return r.id;
}
function fromTemplate(i) { const t = LIST_TEMPLATES[i]; createList(t.name, t.emoji, [...t.options]); }
function newList() {
  openSheet(`<div class="stack"><h2>Nueva lista</h2>
    <div class="add-row"><input id="listEmoji" style="flex:0 0 64px;text-align:center" value="🤔" maxlength="4" aria-label="Emoji">
      <input id="listName" placeholder="Ej: ¿Qué cenamos?" maxlength="40" aria-label="Nombre"></div>
    ${!S.data.lists.length ? '' : `<div class="chips">${LIST_TEMPLATES.filter(t => !S.data.lists.some(l => l.name === t.name)).map(t =>
      `<button class="chip" onclick="closeSheet();fromTemplate(${LIST_TEMPLATES.indexOf(t)})">${t.emoji} ${esc(t.name)}</button>`).join('')}</div>`}
    <button class="btn" onclick="createListFromSheet()">Crear lista</button></div>`);
}
function createListFromSheet() {
  const name = $('listName').value.trim();
  if (!name) return toast('Ponle nombre a la lista');
  createList(name, $('listEmoji').value.trim() || '🤔', []);
  closeSheet();
}
function delList(id) { if (confirm('¿Borrar esta lista para los dos?')) { write(deleteDoc(ref('lists', id))); selList = null; } }
function addOption() {
  const l = curList(), v = $('newOption').value.trim();
  if (!l || !v) return;
  if ((l.options || []).some(o => o.toLowerCase() === v.toLowerCase())) return toast('Esa opción ya está');
  $('newOption').value = '';
  write(updateDoc(ref('lists', l.id), { options: [...(l.options || []), v] })); turns = null;
}
function delOption(i) {
  const l = curList(); if (!l) return;
  const options = [...l.options]; options.splice(i, 1);
  write(updateDoc(ref('lists', l.id), { options })); turns = null;
}
function decideRandom() {
  const l = curList(); $('dSpin').disabled = true; $('dWheel').classList.add('spinning');
  animatePick(l.options, o => { const t = $('dTxt'); if (t) t.textContent = o; }, o => {
    randomResult = o; $('dWheel')?.classList.remove('spinning'); const b = $('dSpin'); if (b) b.disabled = false; toast(`¡${o}!`);
  });
}
function eliminate(i) { turns.remaining.splice(i, 1); turns.who++; renderMode(); }
function restartTurns() { turns = null; renderMode(); }
function vote(yes) {
  const l = curList(); if (!l) return;
  const o = (l.options || []).find(x => !(x in myVotes(l)));
  if (o === undefined) return;
  write(updateDoc(ref('lists', l.id), { [`votes.${uid()}`]: { ...myVotes(l), [o]: yes } }));
}
function resetVotes() { const l = curList(); if (l && confirm('¿Borrar los votos de los dos y empezar de nuevo?')) write(updateDoc(ref('lists', l.id), { votes: {} })); }
function decideAmong() {
  const l = curList(), matches = l.options.filter(o => myVotes(l)[o] && theirVotes(l)[o]);
  $('mSpin').disabled = true;
  animatePick(matches, o => { const t = $('mTxt'); if (t) t.textContent = o; }, o => { const b = $('mSpin'); if (b) b.disabled = false; toast(`¡${o}!`); });
}

/* ---------- Ideas de citas ---------- */
const allIdeas = () => [...DEFAULT_IDEAS, ...S.data.ideas.map(i => ({ ...i, e: i.e || '💡' }))];
const ideaPool = () => allIdeas().filter(i => (filters.place === 'todo' || i.place === filters.place) && (filters.cost === 'todo' || String(i.cost) === filters.cost));
function renderCitas() {
  const n = ideaPool().length;
  paint('decideBody', `
    <div class="glass stack tight">
      <div class="chips">${PLACES.map(([v, l]) => `<button class="chip ${filters.place === v ? 'on' : ''}" onclick="setFilter('place','${v}')">${l}</button>`).join('')}</div>
      <div class="chips">${COSTS.map(([v, l]) => `<button class="chip ${filters.cost === v ? 'on' : ''}" onclick="setFilter('cost','${v}')">${l}</button>`).join('')}</div>
    </div>
    <div class="glass wheel" id="wheel"><div class="emoji" id="wEmoji">${lastIdea ? lastIdea.e : '🎲'}</div>
      <div class="txt" id="wTxt">${lastIdea ? esc(lastIdea.t) : 'Toquen el botón para sortear una cita'}</div>
      <div class="small muted" id="wMeta" style="margin-top:6px">${lastIdea ? `${lastIdea.place === 'casa' ? 'En casa' : 'Afuera'} · ${costLbl(lastIdea.cost)}` : ''}</div></div>
    <button class="btn" id="spinBtn" onclick="spin()">${icon('dice')} ${lastIdea ? 'Otra vez' : 'Sortear cita'}</button>
    ${lastIdea ? `<button class="btn ghost" onclick="ideaToBucket()">${icon('plus')} Guardar en la bucket list</button>` : ''}
    <div class="glass stack"><h2>Agregar idea propia</h2>
      <input id="newIdea" placeholder="Ej: Picnic en el parque" maxlength="80" aria-label="Idea">
      <div class="grid2"><select id="newIdeaPlace" aria-label="Dónde"><option value="casa">En casa</option><option value="afuera">Afuera</option></select>
        <select id="newIdeaCost" aria-label="Precio"><option value="0">Gratis</option><option value="1">$</option><option value="2">$$</option><option value="3">$$$</option></select></div>
      <button class="btn ghost" onclick="addIdea()">Agregar a la ruleta</button>
      <p class="tiny muted center" style="margin:0">${n} ideas con estos filtros · ${S.data.ideas.length} propias</p></div>`);
}
function setFilter(k, v) { filters[k] = v; renderCitas(); }
function spin() {
  const p = ideaPool();
  if (!p.length) return toast('No hay ideas con esos filtros');
  $('spinBtn').disabled = true; $('wheel').classList.add('spinning');
  animatePick(p, x => { const e = $('wEmoji'), t = $('wTxt'); if (e) e.textContent = x.e; if (t) t.textContent = x.t; }, x => { lastIdea = x; renderCitas(); });
}
function ideaToBucket() {
  if (!lastIdea) return;
  write(setDoc(newRef('bucket'), { text: `${lastIdea.e} ${lastIdea.t}`, done: false, doneAt: null, createdAt: Date.now(), by: uid() }));
  toast('Agregada a la bucket list');
}
function addIdea() {
  const t = $('newIdea').value.trim();
  if (!t) return toast('Escribe una idea');
  write(setDoc(newRef('ideas'), { t, place: $('newIdeaPlace').value, cost: Number($('newIdeaCost').value), e: '💡', by: uid() }));
  $('newIdea').value = ''; toast('Idea agregada');
}

on('lists ideas', render);
expose({ decideTab, selectList, setMode, fromTemplate, newList, createListFromSheet, delList, addOption, delOption,
  decideRandom, eliminate, restartTurns, vote, resetVotes, decideAmong, setFilter, spin, ideaToBucket, addIdea });
