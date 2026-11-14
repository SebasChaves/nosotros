// Gastos compartidos: quién pagó qué y quién le debe a quién, y todo para gastar menos en comida, salidas y fiestas:
// - Anotar rápido (quickSpend): teclado de números y un toque en la categoría guarda (sin «Guardar» ni confirmar; se
//   puede deshacer). Pagué yo · a medias · hoy por defecto. Gastos frecuentes, repetir el último y montos rápidos.
//   Atajo del ícono «Anotar gasto» (./?gasto) y desde el aviso del banco (#banco=<texto>, ver bankTutorial).
// - Salida en curso (money/out): lo que se anote mientras está activa se suma a esa salida; al final queda agrupado.
// - Presupuesto semanal para gustos (money/cfg.week, categorías weekCats) con termómetro en Inicio y en Gastos.
// - Alcancías (money/g-<ts>): metas de ahorro; lo que sobra del presupuesto de la semana pasa solo a la elegida (cfg.goal).
// - Resumen del domingo: tarjeta aquí y aviso del Worker (notificaciones/worker.js, tipo «money»).
// Datos: expenses { desc, amount, paidBy, split: half|full|none, cat, date, tripId, outing, createdAt, by } ·
//   money/cfg { week, weekCats[], goal, lastRoll } · money/out { active, oid, name, limit, startAt, by, warned } ·
//   money/g-<ts> { kind:'goal', name, emoji, target, saved, at, by, log[{ by, amount, at, auto }] }.
import { setDoc, deleteDoc, updateDoc, increment, arrayUnion, runTransaction } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, db, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef, go, IOS, ANDROID,
         parseDate, fmtShort, todayKey, dayKey, fmtMoney, nameOf, partnerUid, partnerName, uid, ask, celebrate, markActive } from './core.js';
import { EXPENSE_CATS } from './data.js';
import { backBar } from './lists.js';
import { notify, meForPartner } from './push.js';

const owedPart = e => e.type === 'settle' ? e.amount : e.split === 'none' ? 0 : (e.split === 'full' ? e.amount : e.amount / 2);
// Positivo: tu pareja te debe. Negativo: tú le debes.
export function balance() {
  let net = 0;
  for (const e of S.data.expenses) net += e.paidBy === uid() ? owedPart(e) : -owedPart(e);
  return Math.round(net * 100) / 100;
}
export const catOf = c => EXPENSE_CATS.find(([e]) => e === c) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
const monthName = k => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }); };
const QUICK_CATS = ['🍽️', '🎬', '🎉', '🛒', '📦'];
const GUSTOS = ['🍽️', '🎬', '🎉'];
const SPLITS = { half: 'A medias', full: 'Todo lo debe el otro', none: 'Solo mío' };

/* ---------- Datos de apoyo ---------- */
const cfg = () => S.data.money.find(d => d.id === 'cfg') || {};
const outing = () => { const o = S.data.money.find(d => d.id === 'out'); return o?.active ? o : null; };
const goals = () => S.data.money.filter(d => d.kind === 'goal').sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || a.at - b.at);
const spends = () => S.data.expenses.filter(e => e.type !== 'settle');
const shiftKey = (k, n) => { const d = parseDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
// Semana de lunes a domingo
export const weekStart = (k = todayKey()) => { const d = parseDate(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d); };
const weekCats = () => cfg().weekCats?.length ? cfg().weekCats : GUSTOS;
const spentIn = (from, to, cats) => spends().filter(e => e.date >= from && e.date <= to && (!cats || cats.includes(e.cat))).reduce((s, e) => s + e.amount, 0);
function weekState(k = todayKey()) {
  const from = weekStart(k), to = shiftKey(from, 6), budget = Number(cfg().week) || 0, spent = spentIn(from, to, weekCats());
  const daysLeft = Math.max(0, Math.round((parseDate(to) - parseDate(k)) / 864e5) + 1);
  return { from, to, budget, spent, left: budget - spent, pct: budget ? spent / budget : 0, daysLeft };
}
const tone = pct => pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
const catsTxt = cats => cats.map(c => catOf(c)[0]).join('');

/* ---------- Tarjeta de Inicio y termómetro ---------- */
function thermo(w) {
  return `<div class="thermo ${tone(w.pct)}"><i style="width:${Math.min(100, Math.round(w.pct * 100))}%"></i></div>
    <div class="row small"><span><b class="num">${fmtMoney(w.spent)}</b> <span class="muted">de ${fmtMoney(w.budget)}</span></span>
    <span class="${w.left < 0 ? 'bad' : 'muted'}">${w.left >= 0 ? `quedan <b class="num">${fmtMoney(w.left)}</b>` : `se pasaron <b class="num">${fmtMoney(-w.left)}</b>`} · ${w.daysLeft === 1 ? 'último día' : `faltan ${w.daysLeft} días`}</span></div>`;
}
function outingBanner(o) {
  const items = spends().filter(e => e.outing === o.oid), total = items.reduce((s, e) => s + e.amount, 0);
  return `<div class="outing ${o.limit && total > o.limit ? 'over' : ''}"><div class="row"><b>🎉 ${esc(o.name)}</b><span class="num"><b>${fmtMoney(total)}</b>${o.limit ? ` <span class="muted">de ${fmtMoney(o.limit)}</span>` : ''}</span></div>
    <div class="row"><span class="tiny muted">${items.length} ${items.length === 1 ? 'gasto' : 'gastos'} · lo que anoten se suma aquí</span><button class="link" onclick="endOuting()">Terminar</button></div></div>`;
}
export function moneyCard() {
  const w = weekState(), o = outing();
  const mk = todayKey().slice(0, 7), month = spends().filter(e => e.date?.startsWith(mk) && weekCats().includes(e.cat)).reduce((s, e) => s + e.amount, 0);
  return `<div class="glass stack money-card" style="gap:8px"><div class="row"><span class="label">💸 Gustos de la semana ${catsTxt(weekCats())}</span><button class="link" onclick="go('s-money')">Gastos</button></div>
    ${w.budget ? thermo(w) : `<p class="small muted" style="margin:0">Pongan un presupuesto semanal para comida, salidas y fiestas y aquí verán cuánto les queda.</p><button class="btn ghost small" onclick="budgetSheet()">Poner presupuesto</button>`}
    ${o ? outingBanner(o) : ''}
    <div class="grid2"><button class="btn" onclick="quickSpend()">${icon('plus')} Anotar gasto</button><button class="btn ghost" onclick="${o ? 'quickSpend()' : 'startOuting()'}">${o ? '➕ A la salida' : '🎉 Salimos'}</button></div>
    <p class="tiny muted center" style="margin:0">Este mes en gustos: <b class="num">${fmtMoney(month)}</b></p></div>`;
}

/* ---------- Pantalla Gastos ---------- */
function render() {
  const bal = balance(), pn = esc(partnerName());
  const ym = todayKey().slice(0, 7);
  const thisMonth = spends().filter(e => e.date?.startsWith(ym));
  const total = thisMonth.reduce((s, e) => s + e.amount, 0);
  const byCat = EXPENSE_CATS.map(([e, l]) => [e, l, thisMonth.filter(x => x.cat === e).reduce((s, x) => s + x.amount, 0)]).filter(c => c[2] > 0).sort((a, b) => b[2] - a[2]);
  const w = weekState(), o = outing();
  // Lista: los gastos de una misma salida van juntos en una fila que se abre
  const items = [...S.data.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt).slice(0, 120);
  const seenOut = new Set();
  let lastMonth = null, list = '';
  const row = e => {
    const [ce, cl] = e.type === 'settle' ? ['🤝', 'Pago'] : catOf(e.cat);
    const trip = e.tripId && S.data.trips.find(t => t.id === e.tripId);
    return `<li><span style="font-size:22px">${ce}</span><div class="txt">${esc(e.type === 'settle' ? `${nameOf(e.paidBy)} saldó cuentas` : e.desc || cl)}
      <span class="sub">${fmtShort(parseDate(e.date))} · ${e.type === 'settle' ? '' : `pagó ${esc(nameOf(e.paidBy))} · ${SPLITS[e.split] || SPLITS.half}`}${trip ? ` · ${esc(trip.name)}` : ''}</span></div>
      <b class="num">${fmtMoney(e.amount)}</b><button class="del" aria-label="Borrar" onclick="delExpense('${e.id}')">${icon('trash')}</button></li>`;
  };
  for (const e of items) {
    const mk = (e.date || '').slice(0, 7);
    if (mk !== lastMonth) { list += `<li class="label" style="border:0;padding:14px 0 4px">${monthName(mk)}</li>`; lastMonth = mk; }
    if (e.outing) {
      if (seenOut.has(e.outing)) continue; seenOut.add(e.outing);
      const grp = S.data.expenses.filter(x => x.outing === e.outing).sort((a, b) => a.createdAt - b.createdAt), sum = grp.reduce((s, x) => s + x.amount, 0);
      list += `<li class="outing-row"><details><summary><span style="font-size:22px">🎉</span><div class="txt">${esc(e.outName || 'Salida')}<span class="sub">${fmtShort(parseDate(e.date))} · ${grp.length} ${grp.length === 1 ? 'gasto' : 'gastos'}${o?.oid === e.outing ? ' · en curso' : ''}</span></div><b class="num">${fmtMoney(sum)}</b></summary>
        <ul class="list">${grp.map(row).join('')}</ul></details></li>`;
      continue;
    }
    list += row(e);
  }
  // Resumen de la semana pasada y esta
  const lastFrom = shiftKey(weekStart(), -7), lastTo = shiftKey(lastFrom, 6);
  const wk = (from, to) => Object.fromEntries(GUSTOS.map(c => [c, spentIn(from, to, [c])]));
  const now = wk(w.from, w.to), prev = wk(lastFrom, lastTo), nowT = spentIn(w.from, w.to), prevT = spentIn(lastFrom, lastTo);
  const diff = (a, b) => !b ? '' : a > b ? `<span class="bad">▲ ${Math.round((a / b - 1) * 100)}%</span>` : a < b ? `<span class="good">▼ ${Math.round((1 - a / b) * 100)}%</span>` : '';
  paint('s-money', `${backBar('Gastos', 's-more', `<button class="btn small" onclick="quickSpend()">${icon('plus')} Gasto</button>`)}
    <div class="glass stack money-card" style="gap:8px"><div class="row"><span class="label">💸 Gustos de la semana ${catsTxt(weekCats())}</span><button class="link" onclick="budgetSheet()">${w.budget ? 'Cambiar' : 'Poner presupuesto'}</button></div>
      ${w.budget ? thermo(w) : '<p class="small muted" style="margin:0">Sin presupuesto semanal todavía. Pónganlo y lo que les sobre cada semana pasa solo a su alcancía 🐷.</p>'}
      ${o ? outingBanner(o) : `<button class="btn ghost" onclick="startOuting()">🎉 Salimos: sumar lo de esta salida</button>`}
      <button class="link" onclick="bankTutorial()">⚡ Que se anote desde el aviso del banco</button></div>
    ${goalsCard()}
    <div class="glass stack" style="gap:6px"><div class="row"><span class="label">📊 Esta semana vs. la pasada</span></div>
      ${GUSTOS.map(c => `<div class="row small"><span>${catOf(c).join(' ')}</span><span><b class="num">${fmtMoney(now[c])}</b> <span class="muted">· antes ${fmtMoney(prev[c])}</span> ${diff(now[c], prev[c])}</span></div>`).join('')}
      <div class="row small" style="border-top:1px solid var(--line);padding-top:6px"><span>Todo</span><span><b class="num">${fmtMoney(nowT)}</b> <span class="muted">· antes ${fmtMoney(prevT)}</span> ${diff(nowT, prevT)}</span></div></div>
    <div class="glass stack center">
      <span class="label" style="justify-content:center">Balance</span>
      <div class="money ${bal ? 'grad-text' : ''}">${bal === 0 ? 'Están a mano' : fmtMoney(Math.abs(bal))}</div>
      <p class="muted" style="margin:0">${bal > 0 ? `${pn} te debe` : bal < 0 ? `Le debes a ${pn}` : 'Nadie le debe nada a nadie'}</p>
      ${bal ? `<button class="btn ghost" onclick="settleUp()">Saldar cuentas</button>` : ''}</div>
    <div class="glass stack"><div class="row"><span class="label">Este mes</span><b class="num">${fmtMoney(total)}</b></div>
      ${byCat.length ? `<div class="bars">${byCat.map(([e, l, v]) => `<div class="bar"><span>${e} ${l}</span><div class="progress"><i style="width:${Math.round(v / total * 100)}%"></i></div><span class="num">${fmtMoney(v)}</span></div>`).join('')}</div>`
        : '<p class="small muted" style="margin:0">Sin gastos este mes</p>'}</div>
    <div class="glass"><div class="row"><span class="label">Movimientos</span><button class="link" onclick="openExpense()">Con más detalle</button></div><ul class="list">${list || '<li class="empty">Anoten el primer gasto con el botón de arriba</li>'}</ul></div>`);
}

/* ---------- Anotar rápido ---------- */
let Q = null; // { amt: 'texto', desc, paidBy, split, date, fromBank }
const shown = () => Q.amt ? fmtMoney(Number(Q.amt)) : fmtMoney(0);
// Lo que más anotan (últimos 120 días): misma descripción, categoría y monto, al menos 2 veces
function frequent() {
  const since = shiftKey(todayKey(), -120), cnt = new Map();
  for (const e of spends()) {
    if (!e.desc || e.date < since || e.outing && !e.desc) continue;
    const k = `${e.cat}|${e.desc.trim().toLowerCase()}|${e.amount}`;
    const c = cnt.get(k) || { n: 0, e }; c.n++; if (e.createdAt > c.e.createdAt) c.e = e; cnt.set(k, c);
  }
  return [...cnt.values()].filter(c => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6).map(c => c.e);
}
const lastMine = () => [...spends()].filter(e => e.by === uid()).sort((a, b) => b.createdAt - a.createdAt)[0];
export function quickSpend(pre = {}) {
  Q = { amt: pre.amount ? String(Math.round(pre.amount * 100) / 100) : '', desc: pre.desc || '', paidBy: uid(), split: 'half', date: todayKey(), note: pre.note || '' };
  paintQuick();
}
function paintQuick() {
  const p = partnerUid(), o = outing(), fr = frequent(), last = lastMine(), crc = (S.settings.currency || 'USD') === 'CRC';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', crc ? '000' : '.', '0', '⌫'];
  openSheet(`<div class="stack qs" style="gap:10px">
    <div class="qs-amt" id="qsAmt" aria-live="polite">${shown()}</div>
    ${Q.note ? `<p class="tiny muted center" style="margin:-6px 0 0">${esc(Q.note)}</p>` : ''}
    <input id="qsDesc" maxlength="60" placeholder="¿En qué? (opcional)" aria-label="Descripción" value="${esc(Q.desc)}" oninput="qsDescIn(this.value)">
    ${o ? `<div class="qs-out">🎉 Se suma a <b>${esc(o.name)}</b></div>` : ''}
    ${fr.length || last ? `<div class="qs-chips">${last ? `<button class="chip" onclick="qsRepeat()">↺ Repetir: ${esc(last.desc || catOf(last.cat)[1])} ${fmtMoney(last.amount)}</button>` : ''}${fr.map((e, i) => `<button class="chip" onclick="qsFreq(${i})">${catOf(e.cat)[0]} ${esc(e.desc)} ${fmtMoney(e.amount)}</button>`).join('')}</div>` : ''}
    <div class="qs-plus">${(crc ? [1000, 5000, 10000] : [1, 5, 10]).map(n => `<button class="chip" onclick="qsAdd(${n})">+${fmtMoney(n)}</button>`).join('')}</div>
    <div class="qs-keys">${keys.map(k => `<button onclick="qsKey('${k}')" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`).join('')}</div>
    <p class="tiny muted center" style="margin:0">Toca la categoría y queda anotado</p>
    <div class="qs-cats">${QUICK_CATS.map(c => `<button class="btn ${GUSTOS.includes(c) ? '' : 'ghost'}" onclick="qsSave('${c}')">${catOf(c)[0]}<small>${catOf(c)[1]}</small></button>`).join('')}
      <button class="btn ghost" onclick="qsMore()">⋯<small>Más</small></button></div>
    <div class="qs-opts">
      <button class="chip" onclick="qsToggle('paid')">💳 Pagó ${Q.paidBy === uid() ? 'yo' : esc(nameOf(p))}</button>
      <button class="chip" onclick="qsToggle('split')">➗ ${SPLITS[Q.split]}</button>
      <button class="chip" onclick="qsToggle('date')">📅 ${Q.date === todayKey() ? 'Hoy' : Q.date === shiftKey(todayKey(), -1) ? 'Ayer' : fmtShort(parseDate(Q.date))}</button>
    </div></div>`);
}
const qsDescIn = v => { if (Q) Q.desc = v; };
function qsKey(k) {
  if (!Q) return;
  if (k === '⌫') Q.amt = Q.amt.slice(0, -1);
  else if (k === '.') { if (!Q.amt.includes('.')) Q.amt = (Q.amt || '0') + '.'; }
  else if ((Q.amt + k).replace('.', '').length <= 10) Q.amt = (Q.amt === '0' ? '' : Q.amt) + k;
  navigator.vibrate?.(5);
  $('qsAmt').textContent = shown();
}
function qsAdd(n) { if (!Q) return; Q.amt = String(Math.round((Number(Q.amt || 0) + n) * 100) / 100); $('qsAmt').textContent = shown(); navigator.vibrate?.(5); }
function qsToggle(what) {
  const p = partnerUid();
  if (what === 'paid' && p) Q.paidBy = Q.paidBy === uid() ? p : uid();
  if (what === 'split') Q.split = { half: 'full', full: 'none', none: 'half' }[Q.split];
  if (what === 'date') Q.date = Q.date === todayKey() ? shiftKey(todayKey(), -1) : Q.date === shiftKey(todayKey(), -1) ? shiftKey(todayKey(), -2) : todayKey();
  paintQuick();
}
function qsMore() {
  openSheet(`<div class="stack"><h2>Categoría</h2><div class="qs-cats">${EXPENSE_CATS.map(([e, l]) => `<button class="btn ghost" onclick="qsSave('${e}')">${e}<small>${l}</small></button>`).join('')}</div>
    <button class="link" onclick="qsBack()">← Volver</button></div>`);
}
const qsBack = () => paintQuick();
function qsFreq(i) { const e = frequent()[i]; if (!e) return; Q.amt = String(e.amount); Q.desc = e.desc; qsSave(e.cat); }
function qsRepeat() { const e = lastMine(); if (!e) return; Q.amt = String(e.amount); Q.desc = e.desc || ''; Q.paidBy = e.paidBy; Q.split = e.split || 'half'; qsSave(e.cat); }
function qsSave(cat) {
  const amount = Math.round(Number(Q?.amt || 0) * 100) / 100;
  if (!(amount > 0)) { toast('Escribe el monto primero'); $('qsAmt')?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 }); return; }
  const o = outing(), r = newRef('expenses'), before = weekState();
  const data = { desc: (Q.desc || '').trim() || catOf(cat)[1], amount, paidBy: Q.paidBy, split: Q.split, cat, date: Q.date, tripId: null, createdAt: Date.now(), by: uid(), quick: true,
    ...(o ? { outing: o.oid, outName: o.name } : {}) };
  write(setDoc(r, data)); markActive();
  closeSheet(); Q = null; navigator.vibrate?.(12);
  undoBar(`Anotado ${fmtMoney(amount)} en ${catOf(cat)[1]}${o ? ' · ' + o.name : ''}`, () => write(deleteDoc(r)));
  setTimeout(() => afterSpend(data, before), 600);
}
// Avisos suaves: salida que pasó su límite y presupuesto de la semana al 80 % o pasado
function afterSpend(e, before) {
  const o = outing();
  if (o && e.outing === o.oid && o.limit && !o.warned) {
    const total = spends().filter(x => x.outing === o.oid).reduce((s, x) => s + x.amount, 0);
    if (total > o.limit) {
      write(updateDoc(ref('money', 'out'), { warned: true }));
      toast(`🙈 Ya van ${fmtMoney(total)} en ${o.name} (límite ${fmtMoney(o.limit)})`);
      notify('money', { title: `🙈 Ya van ${fmtMoney(total)} en ${o.name}`, body: `El límite era ${fmtMoney(o.limit)}. ¿La seguimos en casa? 😅`, url: './?open=money', tag: 'outing' });
    }
  }
  if (!GUSTOS.concat(weekCats()).includes(e.cat)) return;
  const w = weekState();
  if (!w.budget) return;
  const cross = lim => before.pct < lim && w.pct >= lim;
  if (cross(1)) notify('money', { title: '🔴 Se pasaron del presupuesto de la semana', body: `Van ${fmtMoney(w.spent)} de ${fmtMoney(w.budget)} en gustos. Quedan ${w.daysLeft} días.`, url: './?open=money', tag: 'budget' });
  else if (cross(0.8)) notify('money', { title: '🟡 Van por el 80 % del presupuesto de la semana', body: `Quedan ${fmtMoney(w.left)} para ${w.daysLeft === 1 ? 'hoy' : `${w.daysLeft} días`}.`, url: './?open=money', tag: 'budget' });
  if (cross(1)) toast('🔴 Se pasaron del presupuesto de la semana');
  else if (cross(0.8)) toast(`🟡 Ya van por el 80 %: quedan ${fmtMoney(w.left)}`);
}
// Barra de abajo con «Deshacer» (en vez de preguntar antes de guardar)
function undoBar(text, undo) {
  $('undoBar')?.remove();
  const el = document.createElement('div'); el.id = 'undoBar'; el.className = 'undo-bar'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span><button>Deshacer</button>`;
  let done = false;
  el.querySelector('button').onclick = () => { if (done) return; done = true; undo(); el.remove(); toast('Listo, no se anotó'); };
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 5000);
}

/* ---------- Formulario completo (viajes y detalles) ---------- */
export function openExpense(preset = {}) {
  const p = partnerUid();
  const today = todayKey();
  const trips = S.data.trips.filter(t => !t.end || t.end >= today || t.id === preset.tripId);
  openSheet(`<div class="stack"><h2>Nuevo gasto</h2>
    <input id="exDesc" placeholder="¿En qué?" maxlength="60" aria-label="Descripción">
    <input id="exAmount" inputmode="decimal" placeholder="Monto" aria-label="Monto">
    <div class="grid2">
      <div><label class="f" for="exPaid">Pagó</label><select id="exPaid"><option value="${uid()}">Yo</option>${p ? `<option value="${p}">${esc(nameOf(p))}</option>` : ''}</select></div>
      <div><label class="f" for="exSplit">Se divide</label><select id="exSplit">${Object.entries(SPLITS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div><label class="f" for="exCat">Categoría</label><select id="exCat">${EXPENSE_CATS.map(([e, l]) => `<option value="${e}" ${preset.cat === e ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></div>
      <div><label class="f" for="exDate">Fecha</label><input type="date" id="exDate" value="${today}"></div>
    </div>
    ${trips.length ? `<div><label class="f" for="exTrip">Viaje (opcional)</label><select id="exTrip"><option value="">Ninguno</option>${trips.map(t => `<option value="${t.id}" ${preset.tripId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
    <button class="btn" onclick="saveExpense()">Guardar gasto</button></div>`);
}
// Acepta "5000", "5.000", "5,000", "12,50", "1.234,56" o "1,234.56".
export function parseAmount(s) {
  s = String(s).replace(/[^\d.,]/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep < 0) return Number(s);
  return Number(s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1));
}
function saveExpense() {
  const desc = $('exDesc').value.trim(), amount = parseAmount($('exAmount').value);
  if (!desc || !(amount > 0)) return toast('Pon en qué y un monto válido');
  const o = outing(), cat = $('exCat').value;
  write(setDoc(newRef('expenses'), {
    desc, amount: Math.round(amount * 100) / 100, paidBy: $('exPaid').value, split: $('exSplit').value,
    cat, date: $('exDate').value || todayKey(), tripId: $('exTrip')?.value || null, createdAt: Date.now(), by: uid(),
    ...(o && !$('exTrip')?.value ? { outing: o.oid, outName: o.name } : {}),
  }));
  closeSheet(); toast('Gasto guardado');
}
async function settleUp() {
  const bal = balance(), p = partnerUid();
  if (!bal || !p) return;
  const debtor = bal < 0 ? uid() : p;
  if (!await ask(`¿Registrar que ${nameOf(debtor)} pagó ${fmtMoney(Math.abs(bal))} y quedan a mano?`)) return;
  write(setDoc(newRef('expenses'), { type: 'settle', amount: Math.abs(bal), paidBy: debtor, date: todayKey(), createdAt: Date.now(), by: uid() }));
  toast('¡Quedaron a mano!'); celebrate();
}
async function delExpense(id) { if (await ask('¿Borrar este movimiento?')) write(deleteDoc(ref('expenses', id))); }

/* ---------- Salida en curso ---------- */
function startOuting() {
  const d = new Date(), dia = d.toLocaleDateString('es', { weekday: 'long' });
  openSheet(`<div class="stack"><h2>🎉 Salimos</h2>
    <p class="small muted" style="margin:0">Todo lo que anoten (los dos) mientras esté activa se suma a esta salida. Al final queda como una sola fila con el detalle adentro.</p>
    <input id="outName" maxlength="40" value="Salida del ${dia}" aria-label="Nombre de la salida">
    <input id="outLimit" inputmode="numeric" placeholder="Límite para hoy (opcional)" aria-label="Límite">
    <p class="tiny muted" style="margin:-4px 0 0">Si pasan el límite, les llega un aviso suave a los dos.</p>
    <button class="btn" onclick="saveOuting()">Empezar</button></div>`);
}
function saveOuting() {
  const name = $('outName').value.trim() || 'Salida', limit = parseAmount($('outLimit').value) || 0;
  write(setDoc(ref('money', 'out'), { active: true, oid: 'o' + Date.now(), name, limit, startAt: Date.now(), by: uid(), warned: false }));
  closeSheet(); toast('🎉 ¡Que se diviertan! Anoten lo que gasten');
  notify('money', { title: `🎉 ${meForPartner()} empezó «${name}»`, body: limit ? `Límite: ${fmtMoney(limit)}. Lo que anoten se suma ahí.` : 'Lo que anoten se suma ahí.', url: './?open=money', tag: 'outing' });
}
async function endOuting() {
  const o = outing(); if (!o) return;
  const total = spends().filter(e => e.outing === o.oid).reduce((s, e) => s + e.amount, 0);
  if (!(await ask(`¿Terminar «${o.name}»? Total: ${fmtMoney(total)}`, { ok: 'Terminar' }))) return;
  write(updateDoc(ref('money', 'out'), { active: false, endAt: Date.now(), total }));
  toast(`Salida terminada: ${fmtMoney(total)}`);
}

/* ---------- Presupuesto semanal ---------- */
function budgetSheet() {
  const c = cfg(), cats = weekCats();
  openSheet(`<div class="stack"><h2>💸 Presupuesto de la semana</h2>
    <p class="small muted" style="margin:0">Cuánto quieren gastar a la semana (de lunes a domingo) en gustos. Lo que les sobre pasa solo a su alcancía el lunes.</p>
    <input id="bgWeek" inputmode="numeric" placeholder="Monto por semana" value="${c.week || ''}" aria-label="Monto por semana">
    <span class="label">Qué cuenta</span>
    <div class="qs-chips">${EXPENSE_CATS.map(([e, l]) => `<label class="chip ${cats.includes(e) ? 'on' : ''}"><input type="checkbox" class="bgCat" value="${e}" ${cats.includes(e) ? 'checked' : ''} hidden onchange="this.parentNode.classList.toggle('on', this.checked)">${e} ${l}</label>`).join('')}</div>
    <button class="btn" onclick="saveBudget()">Guardar</button>
    ${c.week ? '<button class="link" onclick="saveBudget(true)">Quitar el presupuesto</button>' : ''}</div>`);
}
function saveBudget(clear) {
  if (clear === true) { write(setDoc(ref('money', 'cfg'), { week: 0 }, { merge: true })); closeSheet(); return; }
  const week = parseAmount($('bgWeek').value), cats = [...document.querySelectorAll('.bgCat:checked')].map(x => x.value);
  if (!(week > 0)) return toast('Escribe el monto por semana');
  if (!cats.length) return toast('Elige al menos una categoría');
  write(setDoc(ref('money', 'cfg'), { week, weekCats: cats, ...(cfg().lastRoll ? {} : { lastRoll: weekStart() }) }, { merge: true }));
  closeSheet(); toast('Presupuesto guardado 💪');
}
// Lunes: lo que sobró de la semana pasada pasa a la alcancía elegida (una sola vez, aunque abran los dos a la vez)
let rolling = false;
async function rollWeek() {
  const c = cfg(), now = weekStart();
  if (rolling || !S.me || !c.week || !c.lastRoll || c.lastRoll >= now) return;
  rolling = true;
  try {
    const prevFrom = shiftKey(now, -7), left = Math.round((Number(c.week) - spentIn(prevFrom, shiftKey(prevFrom, 6), weekCats())) * 100) / 100;
    const g = c.goal && goals().find(x => x.id === c.goal && !x.done);
    const moved = await runTransaction(db, async tx => {
      const cr = ref('money', 'cfg'), snap = await tx.get(cr);
      if ((snap.data()?.lastRoll || '') >= now) return 0;
      tx.set(cr, { lastRoll: now }, { merge: true });
      if (g && left > 0) tx.update(ref('money', g.id), { saved: increment(left), log: arrayUnion({ by: 'auto', amount: left, at: Date.now(), auto: true, week: prevFrom }) });
      return g && left > 0 ? left : 0;
    });
    if (moved) { toast(`🐷 Les sobraron ${fmtMoney(moved)} la semana pasada: ya están en «${g.name}»`); celebrate(); }
  } catch (e) { console.warn('rollWeek', e); } finally { rolling = false; }
}

/* ---------- Alcancías ---------- */
const GOAL_EMOJI = ['🐷', '✈️', '🏖️', '🏠', '🚗', '💍', '🎁', '🎓', '🛋️', '💻'];
function goalsCard() {
  const gs = goals(), c = cfg();
  return `<div class="glass stack" style="gap:8px"><div class="row"><span class="label">🐷 Alcancías</span><button class="link" onclick="goalSheet()">+ Nueva</button></div>
    ${gs.length ? gs.map(g => {
      const pct = g.target ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0, star = c.goal === g.id;
      return `<div class="goal ${g.done ? 'done' : ''}"><div class="row"><span><span style="font-size:20px">${g.emoji || '🐷'}</span> <b>${esc(g.name)}</b>${star ? ' <span class="pill tiny">aquí va lo que sobra</span>' : ''}</span><span class="small num"><b>${fmtMoney(g.saved || 0)}</b> <span class="muted">/ ${fmtMoney(g.target)}</span></span></div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <div class="row tiny"><span class="muted">${g.done ? '🎉 ¡Lo lograron!' : `${pct}% · faltan ${fmtMoney(Math.max(0, g.target - (g.saved || 0)))}`}</span>
          <span class="row" style="gap:10px">${g.done ? '' : `${star ? '' : `<button class="link" onclick="goalStar('${g.id}')">Que caiga lo que sobra</button>`}<button class="link" onclick="goalAdd('${g.id}')">+ Aportar</button>`}<button class="del" aria-label="Borrar alcancía" onclick="goalDel('${g.id}')">${icon('trash')}</button></span></div></div>`;
    }).join('') : '<p class="small muted" style="margin:0">Creen una meta (un viaje, algo para la casa…) y aparten para ella. Lo que les sobre del presupuesto de la semana cae aquí solo.</p>'}</div>`;
}
function goalSheet() {
  openSheet(`<div class="stack"><h2>🐷 Nueva alcancía</h2>
    <input id="glName" maxlength="40" placeholder="¿Para qué? (ej. Viaje a la playa)" aria-label="Nombre">
    <input id="glTarget" inputmode="numeric" placeholder="Meta (monto)" aria-label="Meta">
    <div class="qs-chips" id="glEmo">${GOAL_EMOJI.map((e, i) => `<button class="chip ${i ? '' : 'on'}" onclick="this.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));this.classList.add('on')">${e}</button>`).join('')}</div>
    <button class="btn" onclick="saveGoal()">Crear</button></div>`);
}
function saveGoal() {
  const name = $('glName').value.trim(), target = parseAmount($('glTarget').value), emoji = $('glEmo').querySelector('.on')?.textContent || '🐷';
  if (!name || !(target > 0)) return toast('Pon un nombre y la meta');
  const id = 'g-' + Date.now();
  write(setDoc(ref('money', id), { kind: 'goal', name, emoji, target, saved: 0, at: Date.now(), by: uid(), log: [] }));
  if (!cfg().goal) write(setDoc(ref('money', 'cfg'), { goal: id }, { merge: true }));
  closeSheet(); toast('Alcancía creada 🐷');
}
function goalAdd(id) {
  const g = goals().find(x => x.id === id); if (!g) return;
  openSheet(`<div class="stack"><h2>${g.emoji} ${esc(g.name)}</h2>
    <input id="glAmt" inputmode="numeric" placeholder="¿Cuánto apartan?" aria-label="Monto">
    <div class="grid2"><button class="btn ghost" onclick="saveGoalAdd('${id}', -1)">Sacar</button><button class="btn" onclick="saveGoalAdd('${id}', 1)">Aportar</button></div></div>`);
  setTimeout(() => $('glAmt')?.focus(), 200);
}
function saveGoalAdd(id, sign) {
  const g = goals().find(x => x.id === id), amount = parseAmount($('glAmt').value);
  if (!g || !(amount > 0)) return toast('Escribe un monto');
  const saved = (g.saved || 0) + sign * amount, done = saved >= g.target;
  write(updateDoc(ref('money', id), { saved: increment(sign * amount), log: arrayUnion({ by: uid(), amount: sign * amount, at: Date.now() }), ...(done && !g.done ? { done: true } : {}) }));
  closeSheet();
  if (done && !g.done) { celebrate(); toast(`🎉 ¡Llenaron «${g.name}»!`); notify('money', { title: `🎉 ¡Llenaron la alcancía «${g.name}»!`, body: `${fmtMoney(saved)} de ${fmtMoney(g.target)} 🐷`, url: './?open=money', tag: 'goal' }); }
  else toast(sign > 0 ? `+${fmtMoney(amount)} en ${g.name} 🐷` : `Sacaron ${fmtMoney(amount)}`);
}
function goalStar(id) { write(setDoc(ref('money', 'cfg'), { goal: id }, { merge: true })); toast('Lo que sobre cada semana cae ahí 🐷'); }
async function goalDel(id) { if (await ask('¿Borrar esta alcancía?')) { write(deleteDoc(ref('money', id))); if (cfg().goal === id) write(setDoc(ref('money', 'cfg'), { goal: null }, { merge: true })); } }

/* ---------- Desde el aviso del banco ----------
   Un atajo del teléfono (Atajos en iPhone, MacroDroid en Android) abre Futari con el texto del aviso en el enlace:
   …/#banco=<texto>. Va después del «#» para que el texto no salga del teléfono (no se manda al servidor). */
export function parseBank(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const cur = '(₡|CRC|colones|US\\$|USD|\\$|dólares|dolares)';
  const m = new RegExp(`${cur}\\s*([0-9][0-9.,]*)`, 'i').exec(t) || (x => x && [x[0], x[2], x[1]])(new RegExp(`([0-9][0-9.,]*)\\s*${cur}`, 'i').exec(t));
  let amount = 0, currency = '';
  if (m) { amount = parseAmount(m[2]); currency = /us|\$|d[oó]lar/i.test(m[1]) && !/₡/.test(m[1]) ? 'USD' : 'CRC'; }
  else { const n = /(?:monto|total|por)\s*:?\s*([0-9][0-9.,]*)/i.exec(t); if (n) amount = parseAmount(n[1]); }
  const w = /(?:\ben\b|comercio|establecimiento|lugar)\s*:?\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9*][^,;\n]{1,38}?)(?=\s+(?:el|por|con|monto|fecha|a las|del|hora|autorizaci)\b|[,;.\n]|$)/i.exec(t);
  return { amount: amount > 0 ? amount : 0, currency, place: w ? w[1].trim().replace(/\s+\d{2}[/-]\d{2}.*$/, '') : '' };
}
export function moneyShortcut() {
  const qs = new URLSearchParams(location.search), hs = new URLSearchParams(location.hash.slice(1));
  const bank = hs.get('banco'), quick = qs.has('gasto') || hs.has('gasto');
  if (bank == null && !quick) return;
  const amt = Number(qs.get('gasto') || hs.get('gasto')) || 0;
  qs.delete('gasto');
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString().replace(/=(&|$)/g, '$1') : '')); // sin el #: el texto del aviso no queda en el historial
  let tries = 0;
  const run = () => {
    if ($('lockScreen') || !S.me || !document.body.classList.contains('in')) { if (++tries < 240) setTimeout(run, 400); return; }
    if (bank != null) {
      const b = parseBank(bank), mine = S.settings.currency || 'USD';
      quickSpend({ amount: b.amount, desc: b.place, note: b.amount ? `Del aviso del banco${b.currency && b.currency !== mine ? ` (venía en ${b.currency}: revisa el monto)` : ''}` : 'No encontré el monto en el aviso: escríbelo' });
    } else quickSpend({ amount: amt });
  };
  setTimeout(run, 300);
}
// Si Futari ya estaba abierto (Safari en iPhone), el atajo solo cambia el #: también hay que escucharlo
addEventListener('hashchange', () => { if (/[#&](banco|gasto)\b/.test(location.hash)) moneyShortcut(); });
function bankTutorial(tab = IOS ? 'ios' : 'android') {
  const base = location.origin + location.pathname, url = base + '#banco=';
  const step = (n, html) => `<li><b>${n}</b><span>${html}</span></li>`;
  const ios = [
    'Abre Futari <b>una vez en Safari</b> (no desde el ícono) e inicia sesión con tu cuenta. El atajo abre Futari en Safari y así ya te encuentra con la sesión abierta.',
    'Abre la app <b>Atajos</b> → pestaña <b>Automatización</b> → <b>+</b> (Nueva automatización).',
    'Elige <b>Mensaje</b> si el banco te manda SMS, o <b>Correo</b> si te manda correos.',
    'En <b>Remitente</b> elige el número o correo del banco, y en <b>El mensaje contiene</b> escribe una palabra que siempre venga en los avisos de compra (por ejemplo <i>compra</i> o <i>transacción</i>). → Siguiente.',
    'Marca <b>Ejecutar inmediatamente</b> (y apaga «Notificar al ejecutar»).',
    'Toca <b>Nuevo atajo en blanco</b> y agrega la acción <b>Codificar URL</b>. En su texto elige la variable <b>Entrada del atajo</b> (si te deja elegir, <b>Contenido</b> o <b>Cuerpo</b> del mensaje).',
    `Agrega la acción <b>Abrir URL</b> y escribe la dirección de abajo, y justo después pega la variable <b>URL codificada</b>:<div class="code-copy"><code>${esc(url)}</code><button class="chip" onclick="copyBankUrl()">Copiar</button></div>`,
    'Listo. Cuando llegue el aviso de una compra, se abre Futari con el monto y el lugar ya puestos: solo tocas la categoría.',
  ];
  const android = [
    'Ten Futari <b>instalado desde Chrome</b> (el ícono en la pantalla de inicio): así el enlace abre la app y no una pestaña.',
    'Instala <b>MacroDroid</b> (Play Store, es gratis) y dale el permiso de <b>Acceso a notificaciones</b> cuando lo pida.',
    'En MacroDroid toca <b>Agregar macro</b>.',
    'En <b>Disparadores</b> toca <b>+</b> → <b>Notificación</b> → <b>Notificación recibida</b> → elige la app del banco (o <b>Mensajes</b> si te llega por SMS) → <b>Contiene texto</b>: una palabra que siempre venga en los avisos de compra (por ejemplo <i>compra</i>).',
    `En <b>Acciones</b> toca <b>+</b> → <b>Aplicaciones</b> → <b>Abrir sitio web / URL</b>. Escribe la dirección de abajo y, justo después, toca <b>…</b> (texto mágico) y elige <b>Texto de la notificación</b>:<div class="code-copy"><code>${esc(url)}</code><button class="chip" onclick="copyBankUrl()">Copiar</button></div>`,
    'Ponle un nombre (por ejemplo <i>Gasto a Futari</i>) y guarda la macro.',
    'Listo. Cuando llegue el aviso de una compra, se abre Futari con el monto y el lugar ya puestos: solo tocas la categoría. En Samsung, si no se abre, quita a MacroDroid del ahorro de batería (Ajustes → Aplicaciones → MacroDroid → Batería → Sin restricciones).',
  ];
  openSheet(`<div class="stack"><h2>⚡ Anotar desde el aviso del banco</h2>
    <p class="small muted" style="margin:0">Si su banco les manda un SMS, correo o notificación con cada compra, el teléfono puede abrir Futari con el monto ya puesto. Se configura una vez en cada teléfono (cada uno el suyo). Los nombres de los botones pueden cambiar un poquito según la versión.</p>
    <div class="seg"><button class="${tab === 'ios' ? 'on' : ''}" onclick="bankTutorial('ios')">📱 iPhone</button><button class="${tab === 'android' ? 'on' : ''}" onclick="bankTutorial('android')">🤖 Samsung / Android</button></div>
    <ol class="steps">${(tab === 'ios' ? ios : android).map((h, i) => step(i + 1, h)).join('')}</ol>
    <div class="glass stack" style="gap:6px"><span class="label">🧪 Probar con un aviso</span>
      <textarea id="bankTry" rows="3" placeholder="Pega aquí un mensaje de compra de tu banco" oninput="bankTry()"></textarea>
      <p class="small" id="bankTryOut" style="margin:0"></p>
      <button class="btn ghost small" onclick="bankTryOpen()">Abrir como si fuera el atajo</button></div>
    <p class="tiny muted" style="margin:0">El texto del aviso solo se usa en el teléfono para sacar el monto y el lugar; Futari no lo guarda. Si su banco no manda avisos, actívenlos en su app o banca en línea.</p></div>`);
}
function copyBankUrl() { const u = location.origin + location.pathname + '#banco='; navigator.clipboard?.writeText(u).then(() => toast('Copiado')).catch(() => toast(u)); }
function bankTry() {
  const b = parseBank($('bankTry').value);
  $('bankTryOut').innerHTML = $('bankTry').value.trim() ? (b.amount ? `✅ Monto: <b>${fmtMoney(b.amount)}</b>${b.currency ? ` (${b.currency})` : ''}${b.place ? ` · En: <b>${esc(b.place)}</b>` : ''}` : '⚠️ No encontré el monto. Mándame un ejemplo del mensaje (sin datos de la tarjeta) y lo ajusto.') : '';
}
function bankTryOpen() { const b = parseBank($('bankTry').value); quickSpend({ amount: b.amount, desc: b.place, note: 'Prueba del aviso del banco' }); }

on('expenses trips money', () => { render(); rollWeek(); });
expose({ openExpense, saveExpense, settleUp, delExpense, quickSpend, qsKey, qsAdd, qsToggle, qsMore, qsBack, qsFreq, qsRepeat, qsSave, qsDescIn,
  startOuting, saveOuting, endOuting, budgetSheet, saveBudget, goalSheet, saveGoal, goalAdd, saveGoalAdd, goalStar, goalDel,
  bankTutorial, copyBankUrl, bankTry, bankTryOpen });
