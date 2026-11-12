// Quiz "¿Cuánto me conoces?": cada uno responde sobre sí mismo y luego adivina las respuestas del otro.
import { setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, esc, icon, paint, on, expose, toast, write, ref, newRef, fmtShort, partnerUid, partnerName, myName, uid } from './core.js';
import { QUIZ } from './data.js';
import { backBar } from './lists.js';

const ROUND = 8;
const rounds = () => [...S.data.quiz].sort((a, b) => b.createdAt - a.createdAt);
const current = () => rounds()[0];
const complete = (r, who) => who && Object.keys(r.answers?.[who] || {}).length >= r.qs.length && Object.keys(r.guesses?.[who] || {}).length >= r.qs.length;
const finished = r => { const p = partnerUid(); return complete(r, uid()) && complete(r, p); };
const scoreOf = (r, guesser, answerer) => r.qs.filter((_, i) => r.guesses?.[guesser]?.[i] !== undefined && r.guesses[guesser][i] === r.answers?.[answerer]?.[i]).length;
export function quizWaiting() {
  const r = current(), p = partnerUid();
  return !!(r && p && Object.keys(r.answers?.[p] || {}).length && !complete(r, uid()));
}

function render() {
  const r = current(), p = partnerUid(), pn = esc(partnerName());
  let body;
  if (!r) body = startCard();
  else {
    const myA = r.answers?.[uid()] || {}, myG = r.guesses?.[uid()] || {};
    const ia = r.qs.findIndex((_, i) => myA[i] === undefined), ig = r.qs.findIndex((_, i) => myG[i] === undefined);
    if (ia >= 0) body = questionCard(r, ia, 'answer', 'Sobre ti', QUIZ[r.qs[ia]][0]);
    else if (ig >= 0) body = questionCard(r, ig, 'guess', `¿Qué respondió ${pn}?`, QUIZ[r.qs[ig]][0]);
    else if (!complete(r, p)) {
      const n = Object.keys(r.answers?.[p] || {}).length + Object.keys(r.guesses?.[p] || {}).length;
      body = `<div class="glass center stack"><div style="font-size:42px">⏳</div><h2>¡Terminaste!</h2>
        <p class="muted" style="margin:0">Esperando a ${pn} (va ${n} de ${r.qs.length * 2}). Le aparecerá un aviso.</p></div>`;
    } else body = results(r);
  }
  const past = rounds().filter(x => x !== r && finished(x));
  paint('s-quiz', `${backBar('¿Cuánto me conoces?')}${body}
    ${past.length ? `<div class="glass"><span class="label">${icon('trophy')} Rondas anteriores</span><ul class="list" style="margin-top:6px">${past.slice(0, 10).map(x =>
      `<li><div class="txt">${fmtShort(new Date(x.createdAt))}</div><span class="small">Tú ${scoreOf(x, uid(), p)} · ${pn} ${scoreOf(x, p, uid())}</span></li>`).join('')}</ul></div>` : ''}`);
}
function startCard() {
  return `<div class="glass center stack"><div style="font-size:46px">🧠</div><h2>Nueva ronda</h2>
    <p class="muted" style="margin:0">${ROUND} preguntas. Primero respondes sobre ti y luego adivinas qué respondió ${esc(partnerName())}. Gana quien más acierte.</p>
    <button class="btn" onclick="newRound()">Empezar</button></div>`;
}
function questionCard(r, i, kind, title, q) {
  const opts = QUIZ[r.qs[i]][1];
  const done = Object.keys((kind === 'answer' ? r.answers : r.guesses)?.[uid()] || {}).length;
  return `<div class="glass"><div class="row"><span class="label">${title}</span><span class="small muted">${done + 1} / ${r.qs.length}</span></div>
    <div class="progress" style="margin-top:10px"><i style="width:${Math.round((done + (kind === 'guess' ? r.qs.length : 0)) / (r.qs.length * 2) * 100)}%"></i></div>
    <div class="q" style="font-size:20px;margin-top:16px">${esc(q)}</div>
    <div class="quiz-opts">${opts.map((o, k) => `<button onclick="quizPick('${r.id}','${kind}',${i},${k})">${esc(o)}</button>`).join('')}</div></div>`;
}
function results(r) {
  const p = partnerUid(), pn = esc(partnerName());
  const mine = scoreOf(r, uid(), p), theirs = scoreOf(r, p, uid());
  const verdict = mine === theirs ? '¡Empate! Se conocen igual de bien' : mine > theirs ? '¡Ganaste! Conoces mejor a tu pareja' : `¡Ganó ${pn}!`;
  return `<div class="glass center stack"><span class="label" style="justify-content:center">Resultado</span>
      <div class="grid2"><div><div class="score grad-text">${mine}</div><div class="small muted">${esc(myName() || 'Tú')} acertó</div></div>
        <div><div class="score grad-text">${theirs}</div><div class="small muted">${pn} acertó</div></div></div>
      <h2>${verdict}</h2></div>
    <div class="glass"><span class="label">Tus respuestas sobre ${pn}</span><ul class="list" style="margin-top:6px">${r.qs.map((qi, i) => {
      const [q, o] = QUIZ[qi], real = r.answers?.[p]?.[i], g = r.guesses?.[uid()]?.[i];
      return `<li><span style="font-size:18px">${g === real ? '✅' : '❌'}</span><div class="txt">${esc(q)}<span class="sub">${pn}: ${esc(o[real])}${g !== real ? ` · tú dijiste ${esc(o[g])}` : ''}</span></div></li>`;
    }).join('')}</ul></div>
    <button class="btn" onclick="newRound()">Jugar otra ronda</button>`;
}
function newRound() {
  if (!partnerUid()) return toast('Tu pareja tiene que entrar a la app primero');
  const used = new Set(rounds().slice(0, 3).flatMap(r => r.qs.map(i => i)));
  let pool = QUIZ.map((_, i) => i).filter(i => !used.has(i));
  if (pool.length < ROUND) pool = QUIZ.map((_, i) => i);
  const qs = pool.sort(() => Math.random() - .5).slice(0, ROUND);
  write(setDoc(newRef('quiz'), { qs, answers: {}, guesses: {}, createdAt: Date.now(), by: uid() }));
}
function quizPick(id, kind, i, k) {
  const r = S.data.quiz.find(x => x.id === id); if (!r) return;
  const field = kind === 'answer' ? 'answers' : 'guesses';
  write(updateDoc(ref('quiz', id), { [`${field}.${uid()}`]: { ...(r[field]?.[uid()] || {}), [i]: k } }));
}

on('quiz', render);
expose({ newRound, quizPick });
