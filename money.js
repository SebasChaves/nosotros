// Gastos compartidos: quién pagó qué y quién le debe a quién.
import { setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, icon, paint, on, expose, toast, openSheet, closeSheet, write, ref, newRef,
         parseDate, fmtShort, todayKey, fmtMoney, nameOf, partnerUid, partnerName, uid, ask } from './core.js';
import { EXPENSE_CATS } from './data.js';
import { backBar } from './lists.js';

const owedPart = e => e.type === 'settle' ? e.amount : (e.split === 'full' ? e.amount : e.amount / 2);
// Positivo: tu pareja te debe. Negativo: tú le debes.
export function balance() {
  let net = 0;
  for (const e of S.data.expenses) net += e.paidBy === uid() ? owedPart(e) : -owedPart(e);
  return Math.round(net * 100) / 100;
}
export const catOf = c => EXPENSE_CATS.find(([e]) => e === c) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
const monthName = k => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }); };

function render() {
  const bal = balance(), pn = esc(partnerName());
  const ym = todayKey().slice(0, 7);
  const thisMonth = S.data.expenses.filter(e => e.type !== 'settle' && e.date?.startsWith(ym));
  const total = thisMonth.reduce((s, e) => s + e.amount, 0);
  const byCat = EXPENSE_CATS.map(([e, l]) => [e, l, thisMonth.filter(x => x.cat === e).reduce((s, x) => s + x.amount, 0)]).filter(c => c[2] > 0).sort((a, b) => b[2] - a[2]);
  const items = [...S.data.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt).slice(0, 80);
  let lastMonth = null, list = '';
  for (const e of items) {
    const mk = (e.date || '').slice(0, 7);
    if (mk !== lastMonth) { list += `<li class="label" style="border:0;padding:14px 0 4px">${monthName(mk)}</li>`; lastMonth = mk; }
    const [ce, cl] = e.type === 'settle' ? ['🤝', 'Pago'] : catOf(e.cat);
    const trip = e.tripId && S.data.trips.find(t => t.id === e.tripId);
    list += `<li><span style="font-size:22px">${ce}</span><div class="txt">${esc(e.type === 'settle' ? `${nameOf(e.paidBy)} saldó cuentas` : e.desc)}
      <span class="sub">${fmtShort(parseDate(e.date))} · ${e.type === 'settle' ? '' : `pagó ${esc(nameOf(e.paidBy))} · ${e.split === 'full' ? 'todo del otro' : 'mitad y mitad'}`}${trip ? ` · ${esc(trip.name)}` : ''}</span></div>
      <b class="num">${fmtMoney(e.amount)}</b><button class="del" aria-label="Borrar" onclick="delExpense('${e.id}')">${icon('trash')}</button></li>`;
  }
  paint('s-money', `${backBar('Gastos', 's-more', `<button class="btn small" onclick="openExpense()">${icon('plus')} Gasto</button>`)}
    <div class="glass stack center">
      <span class="label" style="justify-content:center">Balance</span>
      <div class="money ${bal ? 'grad-text' : ''}">${bal === 0 ? 'Están a mano' : fmtMoney(Math.abs(bal))}</div>
      <p class="muted" style="margin:0">${bal > 0 ? `${pn} te debe` : bal < 0 ? `Le debes a ${pn}` : 'Nadie le debe nada a nadie'}</p>
      ${bal ? `<button class="btn ghost" onclick="settleUp()">Saldar cuentas</button>` : ''}</div>
    <div class="glass stack"><div class="row"><span class="label">Este mes</span><b class="num">${fmtMoney(total)}</b></div>
      ${byCat.length ? `<div class="bars">${byCat.map(([e, l, v]) => `<div class="bar"><span>${e} ${l}</span><div class="progress"><i style="width:${Math.round(v / total * 100)}%"></i></div><span class="num">${fmtMoney(v)}</span></div>`).join('')}</div>`
        : '<p class="small muted" style="margin:0">Sin gastos este mes</p>'}</div>
    <div class="glass"><ul class="list">${list || '<li class="empty">Anoten el primer gasto con el botón de arriba</li>'}</ul></div>`);
}

export function openExpense(preset = {}) {
  const p = partnerUid();
  const today = todayKey();
  const trips = S.data.trips.filter(t => !t.end || t.end >= today || t.id === preset.tripId);
  openSheet(`<div class="stack"><h2>Nuevo gasto</h2>
    <input id="exDesc" placeholder="¿En qué?" maxlength="60" aria-label="Descripción">
    <input id="exAmount" inputmode="decimal" placeholder="Monto" aria-label="Monto">
    <div class="grid2">
      <div><label class="f" for="exPaid">Pagó</label><select id="exPaid"><option value="${uid()}">Yo</option>${p ? `<option value="${p}">${esc(nameOf(p))}</option>` : ''}</select></div>
      <div><label class="f" for="exSplit">Se divide</label><select id="exSplit"><option value="half">Mitad y mitad</option><option value="full">Todo lo debe el otro</option></select></div>
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
  write(setDoc(newRef('expenses'), {
    desc, amount: Math.round(amount * 100) / 100, paidBy: $('exPaid').value, split: $('exSplit').value,
    cat: $('exCat').value, date: $('exDate').value || todayKey(), tripId: $('exTrip')?.value || null, createdAt: Date.now(), by: uid(),
  }));
  closeSheet(); toast('Gasto guardado');
}
async function settleUp() {
  const bal = balance(), p = partnerUid();
  if (!bal || !p) return;
  const debtor = bal < 0 ? uid() : p;
  if (!await ask(`¿Registrar que ${nameOf(debtor)} pagó ${fmtMoney(Math.abs(bal))} y quedan a mano?`)) return;
  write(setDoc(newRef('expenses'), { type: 'settle', amount: Math.abs(bal), paidBy: debtor, date: todayKey(), createdAt: Date.now(), by: uid() }));
  toast('¡Quedaron a mano!');
}
async function delExpense(id) { if (await ask('¿Borrar este movimiento?')) write(deleteDoc(ref('expenses', id))); }

on('expenses trips', render);
expose({ openExpense, saveExpense, settleUp, delExpense });
