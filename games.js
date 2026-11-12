// Juego de retos para jugar juntos en un teléfono: verdad o reto, reto rápido, contrarreloj, yo nunca y ¿qué prefieres?
import { setDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, onShow, expose, toast, openSheet, closeSheet, write, ref, newRef,
         nameOf, partnerUid, plural, uid } from './core.js';
import { LEVELS, TRUTHS, DARES, NEVER, RATHER } from './games-data.js';
import { backBar } from './lists.js';

const MODES = [
  ['tod', '🎭', 'Verdad o reto', 'Por turnos, con puntos'],
  ['quick', '⚡', 'Reto rápido', 'Cartas al azar, sin puntos'],
  ['timer', '⏱️', 'Contrarreloj', 'Retos de 60 segundos'],
  ['never', '🙊', 'Yo nunca', '¿Quién lo ha hecho?'],
  ['rather', '🤔', '¿Qué prefieres?', '¿Coinciden?'],
];
const KINDS = [['truth', 'Verdad'], ['dare', 'Reto'], ['never', 'Yo nunca'], ['rather', '¿Qué prefieres? (A | B)']];
const levelName = k => LEVELS.find(l => l[0] === k)?.[1] || k;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const G = { phase: 'setup', mode: 'tod', levels: new Set(['fun', 'love']), rounds: 10 };
let timer = null;

/* ---------- Cartas ---------- */
function pool(kind) {
  const builtIn = { truth: TRUTHS, dare: DARES, never: NEVER, rather: RATHER }[kind];
  const out = [];
  for (const lv of G.levels) for (const c of builtIn[lv] || []) out.push(kind === 'rather' ? { a: c[0], b: c[1], level: lv } : { text: c, level: lv });
  for (const c of S.data.cards) if (c.kind === kind && G.levels.has(c.level)) out.push(kind === 'rather' ? { a: c.a, b: c.b, level: c.level } : { text: c.text, level: c.level });
  return out;
}
function draw(kind) {
  G.decks ??= {};
  if (!G.decks[kind]?.length) G.decks[kind] = shuffle(pool(kind));
  return G.decks[kind].pop() || null;
}
const counts = () => Object.fromEntries(['truth', 'dare', 'never', 'rather'].map(k => [k, pool(k).length]));

/* ---------- Pantalla ---------- */
function render() {
  stopTimer();
  if (G.phase === 'setup') return renderSetup();
  if (G.phase === 'end') return renderEnd();
  renderPlay();
}
function renderSetup() {
  const c = counts(), ours = S.data.cards.filter(x => x.level === 'ours').length;
  const need = { tod: c.truth + c.dare, quick: c.dare, timer: c.dare, never: c.never, rather: c.rather }[G.mode];
  const p = partnerUid();
  paint('s-game', `${backBar('Juego de retos')}
    <div class="stack" style="gap:8px">${MODES.map(([k, e, t, s]) => `<button class="tile" style="min-height:0;flex-direction:row;align-items:center;${G.mode === k ? 'border-color:color-mix(in srgb,var(--g1) 70%,transparent);background:color-mix(in srgb,var(--g1) 16%,transparent)' : ''}" onclick="gameMode('${k}')">
      <span style="font-size:28px">${e}</span><div class="grow"><b>${t}</b><div class="small muted">${s}</div></div>${G.mode === k ? icon('check') : ''}</button>`).join('')}</div>
    <div class="glass stack"><span class="label">Niveles</span>
      <div class="chips">${LEVELS.map(([k, l]) => `<button class="chip ${G.levels.has(k) ? 'on' : ''}" onclick="gameLevel('${k}')">${l}${k === 'ours' ? ` · ${ours}` : ''}</button>`).join('')}</div>
      ${G.levels.has('ours') && !ours ? '<p class="small muted" style="margin:0">"Solo nosotros" está vacío: agreguen sus cartas abajo.</p>' : ''}
      ${G.mode !== 'quick' ? `<span class="label" style="margin-top:6px">Rondas</span>
        <div class="chips">${[[10, '10'], [20, '20'], [0, 'Sin límite']].map(([n, l]) => `<button class="chip ${G.rounds === n ? 'on' : ''}" onclick="gameRounds(${n})">${l}</button>`).join('')}</div>` : ''}
    </div>
    ${!p ? '<div class="glass small muted">Tu pareja tiene que entrar a la app al menos una vez para que aparezca su nombre en el juego.</div>' : ''}
    <button class="btn" ${need ? '' : 'disabled'} onclick="gameStart()">${icon('spark')} ${need ? 'Empezar' : 'No hay cartas en estos niveles'}</button>
    <div class="glass stack"><div class="row"><span class="label">${icon('lock')} Sus propias cartas</span><span class="small muted">${S.data.cards.length}</span></div>
      <p class="small muted" style="margin:0">Escriban las suyas para cualquier nivel. Las de "Solo nosotros" no se incluyen en el respaldo descargable.</p>
      <div class="grid2"><button class="btn ghost small" style="width:100%" onclick="cardsAdd()">${icon('plus')} Agregar cartas</button>
        <button class="btn ghost small" style="width:100%" onclick="cardsList()">Ver las suyas</button></div></div>`);
}
function gameMode(m) { G.mode = m; render(); }
function gameLevel(k) { G.levels.has(k) ? G.levels.delete(k) : G.levels.add(k); if (!G.levels.size) G.levels.add(k); render(); }
function gameRounds(n) { G.rounds = n; render(); }

function gameStart() {
  const p = partnerUid();
  G.players = [uid(), p].filter(Boolean).map(id => nameOf(id));
  if (G.players.length < 2) G.players = [G.players[0] || 'Jugador 1', 'Tu pareja'];
  if (Math.random() < .5) G.players.reverse();
  Object.assign(G, { phase: 'play', turn: 0, round: 0, scores: [0, 0], card: null, step: 0, picks: [], decks: {}, matches: 0, timeLeft: 0, log: [] });
  render();
  toast(`Empieza ${G.players[0]}`);
}
const who = () => G.players[G.turn % 2];
const scoreBar = () => `<div class="grid2">${G.players.map((n, i) => `<div class="glass tight center" style="${G.mode !== 'quick' && G.mode !== 'rather' && i === G.turn % 2 ? 'border-color:color-mix(in srgb,var(--g1) 70%,transparent)' : ''}">
  <div class="small muted">${esc(n)}</div><div class="money grad-text" style="font-size:28px">${G.mode === 'rather' ? '' : G.scores[i]}</div></div>`).join('')}</div>`;
const roundInfo = () => G.rounds ? `Ronda ${Math.min(G.round + 1, G.rounds)} de ${G.rounds}` : `Ronda ${G.round + 1}`;
const cardHTML = (label, text, level) => `<div class="glass" style="padding:28px 20px;text-align:center">
  <div class="row" style="justify-content:center;gap:8px"><span class="pill hot">${label}</span><span class="pill">${levelName(level)}</span></div>
  <div style="font-size:22px;font-weight:700;line-height:1.35;margin-top:16px;text-wrap:balance">${esc(text)}</div></div>`;
const quitBtn = `<button class="link" onclick="gameEnd()">Terminar juego</button>`;

function renderPlay() {
  const m = G.mode;
  let body = '';
  if (m === 'quick') {
    body = G.card ? cardHTML('Reto', G.card.text, G.card.level) : `<div class="glass center muted" style="padding:30px">Toca para sacar un reto</div>`;
    body += `<div class="grid2"><button class="btn" onclick="quickNext('dare')">${icon('dice')} Reto</button><button class="btn ghost" onclick="quickNext('truth')">Verdad</button></div>`;
    paint('s-game', `${backBar('Reto rápido')}${body}${quitBtn}`);
    return;
  }
  if (m === 'tod') {
    if (!G.card) body = `<div class="glass center stack" style="padding:26px"><div class="small muted">${roundInfo()}</div><h2>Turno de ${esc(who())}</h2>
      <div class="grid2"><button class="btn ghost" onclick="todPick('truth')">Verdad</button><button class="btn" onclick="todPick('dare')">Reto</button></div></div>`;
    else body = `${cardHTML(G.card.kind === 'truth' ? `Verdad para ${esc(who())}` : `Reto para ${esc(who())}`, G.card.text, G.card.level)}
      <div class="grid2"><button class="btn ghost" onclick="todResult(false)">Paso (−1)</button><button class="btn" onclick="todResult(true)">${icon('check')} ¡Cumplido! (+1)</button></div>`;
  }
  if (m === 'timer') {
    if (!G.card) body = `<div class="glass center stack" style="padding:26px"><div class="small muted">${roundInfo()}</div><h2>Turno de ${esc(who())}</h2>
      <button class="btn" onclick="timerDraw()">${icon('dice')} Sacar reto</button></div>`;
    else body = `${cardHTML(`Reto para ${esc(who())}`, G.card.text, G.card.level)}
      <div class="glass center"><div id="gTimer" class="big grad-text" style="font-size:56px">${G.timeLeft || 60}</div><div class="small muted">segundos</div></div>
      ${G.timeLeft ? '' : `<button class="btn" onclick="timerGo()">⏱️ Empezar</button>`}
      <div class="grid2"><button class="btn ghost" onclick="timerResult(false)">No llegó</button><button class="btn" onclick="timerResult(true)">${icon('check')} ¡Lo logró! (+2)</button></div>`;
  }
  if (m === 'never') {
    if (!G.card) G.card = draw('never');
    if (!G.card) { toast('No hay cartas de Yo nunca en estos niveles'); return gameEnd(); }
    G.picks ??= [];
    body = `${cardHTML('Yo nunca', G.card.text, G.card.level)}
      <p class="small muted center" style="margin:0">Marca quién SÍ lo ha hecho</p>
      <div class="grid2">${G.players.map((n, i) => `<button class="btn ${G.picks[i] ? '' : 'ghost'}" onclick="neverToggle(${i})">${G.picks[i] ? '🙋 ' : ''}${esc(n)}</button>`).join('')}</div>
      <button class="btn ghost" onclick="neverNext()">Siguiente ${icon('send')}</button>`;
  }
  if (m === 'rather') {
    if (!G.card) G.card = draw('rather');
    if (!G.card) { toast('No hay cartas de ¿Qué prefieres? en estos niveles'); return gameEnd(); }
    const c = G.card;
    if (G.step < 2) {
      const n = G.players[G.step];
      body = `<div class="glass center stack" style="padding:22px"><div class="small muted">${roundInfo()} · ${G.step === 1 ? `pásale el teléfono a ${esc(n)}` : 'que el otro no vea'}</div>
        <h2>${esc(n)}, ¿qué prefieres?</h2><span class="pill" style="align-self:center">${levelName(c.level)}</span>
        <button class="btn ghost" style="min-height:64px" onclick="ratherPick('a')">${esc(c.a)}</button>
        <div class="small muted">o</div>
        <button class="btn ghost" style="min-height:64px" onclick="ratherPick('b')">${esc(c.b)}</button></div>`;
    } else {
      const same = G.picks[0] === G.picks[1];
      body = `<div class="glass center stack" style="padding:22px"><div style="font-size:44px">${same ? '💞' : '😅'}</div><h2>${same ? '¡Coinciden!' : 'No coinciden'}</h2>
        ${G.players.map((n, i) => `<div class="answer" style="text-align:left"><b>${esc(n)}</b>${esc(G.picks[i] === 'a' ? c.a : c.b)}</div>`).join('')}
        <p class="small muted" style="margin:0">Llevan ${plural(G.matches, 'coincidencia', 'coincidencias')}</p></div>
        <button class="btn" onclick="ratherNext()">Siguiente ${icon('send')}</button>`;
    }
  }
  paint('s-game', `${backBar(MODES.find(x => x[0] === m)[2])}${m === 'rather' ? '' : scoreBar()}${body}${quitBtn}`);
}

function nextTurn() {
  G.card = null; G.turn++; G.round++; G.picks = []; G.step = 0;
  if (G.rounds && G.round >= G.rounds) return gameEnd();
  render();
}
function quickNext(kind) { G.card = draw(kind); if (!G.card) return toast('No hay cartas de ese tipo'); G.card.kind = kind; render(); }
function todPick(kind) {
  G.card = draw(kind);
  if (!G.card) { G.card = draw(kind === 'truth' ? 'dare' : 'truth'); kind = kind === 'truth' ? 'dare' : 'truth'; toast('No quedan de ese tipo, va la otra'); }
  if (!G.card) return toast('No hay cartas en estos niveles');
  G.card.kind = kind; render();
}
function todResult(ok) { G.scores[G.turn % 2] += ok ? 1 : -1; G.log.push(ok); nextTurn(); }
function timerDraw() { G.card = draw('dare'); if (!G.card) return toast('No hay retos en estos niveles'); G.timeLeft = 0; render(); }
function timerGo() {
  G.timeLeft = 60; renderPlay();
  timer = setInterval(() => {
    G.timeLeft--; const el = $('gTimer'); if (el) el.textContent = G.timeLeft;
    if (G.timeLeft <= 0) { stopTimer(); navigator.vibrate?.(300); toast('¡Se acabó el tiempo!'); }
  }, 1000);
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function timerResult(ok) { stopTimer(); if (ok) G.scores[G.turn % 2] += 2; nextTurn(); }
function neverToggle(i) { G.picks[i] = !G.picks[i]; renderPlay(); }
function neverNext() {
  G.picks.forEach((v, i) => { if (v) G.scores[i]++; });
  G.round++; G.card = null; G.picks = [];
  if (G.rounds && G.round >= G.rounds) return gameEnd();
  render();
}
function ratherPick(x) { G.picks[G.step] = x; G.step++; if (G.step === 2 && G.picks[0] === G.picks[1]) G.matches++; render(); }
function ratherNext() { G.round++; G.card = null; G.picks = []; G.step = 0; if (G.rounds && G.round >= G.rounds) return gameEnd(); render(); }

function gameEnd() {
  stopTimer();
  if (G.mode !== 'quick' && G.round > 0) {
    write(setDoc(newRef('games'), { mode: G.mode, levels: [...G.levels], players: G.players, scores: G.scores, matches: G.matches || 0, rounds: G.round, at: Date.now(), by: uid() }));
  }
  G.phase = G.mode === 'quick' || G.round === 0 ? 'setup' : 'end';
  render();
}
function renderEnd() {
  const [a, b] = G.scores, n = G.players;
  let title, detail;
  if (G.mode === 'rather') { title = `${G.matches} de ${G.round} coincidencias`; detail = G.matches / G.round >= .6 ? 'Están muy en sintonía 💞' : 'Polos opuestos que se atraen 😄'; }
  else if (G.mode === 'never') { title = a === b ? 'Empate' : `${esc(a > b ? n[0] : n[1])} lo ha hecho todo`; detail = `${esc(n[0])}: ${a} · ${esc(n[1])}: ${b}`; }
  else { title = a === b ? '¡Empate!' : `¡Ganó ${esc(a > b ? n[0] : n[1])}!`; detail = `${esc(n[0])}: ${a} · ${esc(n[1])}: ${b}`; }
  const past = [...S.data.games].sort((x, y) => y.at - x.at).slice(0, 5);
  paint('s-game', `${backBar('Juego de retos')}
    <div class="glass story"><div style="font-size:52px">🏆</div><h2 style="font-size:24px">${title}</h2><p class="muted" style="margin:6px 0 0">${detail}</p></div>
    <div class="grid2"><button class="btn ghost" onclick="gameSetup()">Cambiar modo</button><button class="btn" onclick="gameStart()">Otra vez</button></div>
    ${past.length ? `<div class="glass"><span class="label">Partidas anteriores</span><ul class="list" style="margin-top:6px">${past.map(g => `<li><div class="txt">${MODES.find(m => m[0] === g.mode)?.[2] || g.mode}
      <span class="sub">${new Date(g.at).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · ${g.rounds} rondas</span></div>
      <span class="small">${g.mode === 'rather' ? `${g.matches} coincid.` : `${esc(g.players[0])} ${g.scores[0]} · ${esc(g.players[1])} ${g.scores[1]}`}</span></li>`).join('')}</ul></div>` : ''}`);
}
function gameSetup() { G.phase = 'setup'; render(); }

/* ---------- Cartas propias ---------- */
function cardsAdd() {
  openSheet(`<div class="stack"><h2>Agregar cartas</h2>
    <div class="grid2"><select id="cKind" aria-label="Tipo">${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select id="cLevel" aria-label="Nivel">${LEVELS.map(([k, l]) => `<option value="${k}" ${k === 'ours' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <textarea id="cText" style="min-height:160px" placeholder="Una carta por línea.&#10;Para ¿Qué prefieres? escribe: opción A | opción B" aria-label="Cartas"></textarea>
    <button class="btn" onclick="cardsSave()">Guardar</button></div>`);
}
function cardsSave() {
  const kind = $('cKind').value, level = $('cLevel').value;
  const lines = $('cText').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return toast('Escribe al menos una carta');
  const batch = writeBatch(db); let n = 0, bad = 0;
  for (const line of lines.slice(0, 300)) {
    if (kind === 'rather') {
      const [a, b] = line.split('|').map(s => s?.trim());
      if (!a || !b) { bad++; continue; }
      batch.set(newRef('cards'), { kind, level, a, b, by: uid(), createdAt: Date.now() });
    } else batch.set(newRef('cards'), { kind, level, text: line.slice(0, 300), by: uid(), createdAt: Date.now() });
    n++;
  }
  if (!n) return toast('Para ¿Qué prefieres? usa: opción A | opción B');
  write(batch.commit()); G.decks = {};
  closeSheet(); toast(`${plural(n, 'carta agregada', 'cartas agregadas')}${bad ? ` · ${bad} sin "|"` : ''}`);
}
function cardsList() {
  const items = [...S.data.cards].sort((a, b) => a.level.localeCompare(b.level) || b.createdAt - a.createdAt);
  openSheet(`<div class="stack"><h2>Sus cartas</h2>${items.length ? `<ul class="list">${items.map(c => `<li><div class="txt">${esc(c.kind === 'rather' ? `${c.a} | ${c.b}` : c.text)}
    <span class="sub">${KINDS.find(k => k[0] === c.kind)?.[1].replace(' (A | B)', '')} · ${levelName(c.level)}</span></div>
    <button class="del" aria-label="Borrar carta" onclick="cardDel('${c.id}')">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="empty">Todavía no escriben cartas</p>'}
    <button class="btn ghost" onclick="cardsAdd()">${icon('plus')} Agregar</button></div>`);
}
function cardDel(id) { if (confirm('¿Borrar esta carta?')) { write(deleteDoc(ref('cards', id))); G.decks = {}; setTimeout(cardsList, 150); } }

on('cards games', () => { if ($('s-game').classList.contains('active') && G.phase !== 'play') render(); });
onShow('s-game', () => { if (G.phase !== 'play') render(); });
expose({ gameMode, gameLevel, gameRounds, gameStart, gameEnd, gameSetup, quickNext, todPick, todResult, timerDraw, timerGo,
  timerResult, neverToggle, neverNext, ratherPick, ratherNext, cardsAdd, cardsSave, cardsList, cardDel });
