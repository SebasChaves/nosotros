// 🔥 Racha con recompensas (1.19.0): hitos de días seguidos en que los dos hicieron algo (streak() de home.js).
// Al llegar a un hito, la mascota recibe monedas UNA vez para la pareja (liga/racha.hitos.<n> = ms, con una transacción
// para que los dos teléfonos no las den dos veces) y a cada uno le sale la celebración una vez (prefs.hitoSeen = n).
// La hoja «🔥 Su racha» (tocar la racha en Inicio) muestra el próximo hito y los logrados.
import { runTransaction, setDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { S, db, esc, expose, openSheet, closeSheet, ref, write, uid, plural, celebrate, on } from './core.js';
import { streak, bestStreak } from './home.js';
import { pet, petLabel } from './pet.js';

export const HITOS = [[3, 20], [7, 40], [14, 60], [30, 100], [50, 150], [100, 250], [200, 400], [365, 500]];
const got = () => S.data.liga?.find(d => d.id === 'racha')?.hitos || {};
const me = () => S.data.profiles.find(p => p.id === uid())?.prefs || {};
export const nextHito = (s = streak()) => HITOS.find(([n]) => n > s) || null;

let busy = false;
async function check() {
  if (!S.me || busy || !S.data.profiles.length) return;
  const s = streak(), reached = HITOS.filter(([n]) => n <= s);
  if (!reached.length) return;
  busy = true;
  // Monedas para la mascota: una sola vez por hito, aunque los dos teléfonos lo vean al mismo tiempo
  for (const [n, c] of reached) {
    if (got()[n]) continue;
    try {
      await runTransaction(db, async tx => {
        const r = await tx.get(ref('liga', 'racha'));
        if (r.exists() && r.data().hitos?.[n]) return;
        tx.set(ref('liga', 'racha'), { hitos: { [n]: Date.now() } }, { merge: true });
        if (pet()) tx.update(ref('pet', 'main'), { bonus: increment(c) });
      });
    } catch (e) { console.warn('racha', e); }
  }
  // Celebración: la del hito más alto que esta persona todavía no vio
  const top = reached[reached.length - 1];
  if ((me().hitoSeen || 0) < top[0] && !document.querySelector('#sheet.show')) {
    write(setDoc(ref('profiles', uid()), { prefs: { hitoSeen: top[0] } }, { merge: true }));
    celebrate();
    const nx = nextHito(s), p = pet();
    openSheet(`<div class="stack center"><div style="font-size:56px">🔥</div><h2>¡${top[0]} días seguidos!</h2>
      <p class="muted" style="margin:0">Los dos hicieron algo en Futari ${top[0]} días sin fallar uno.</p>
      ${p ? `<p style="margin:0"><b>+${top[1]} 🪙</b> para ${esc(petLabel(p))}</p>` : '<p class="small muted" style="margin:0">Cuando adopten su mascota, los hitos le dan monedas.</p>'}
      ${nx ? `<p class="small muted" style="margin:0">Próximo hito: ${nx[0]} días (+${nx[1]} 🪙)</p>` : ''}
      <button class="btn" onclick="closeSheet()">¡Sigamos!</button></div>`);
  }
  busy = false;
}

export function openRacha() {
  const s = streak(), best = bestStreak(), nx = nextHito(s), prev = [...HITOS].reverse().find(([n]) => n <= s)?.[0] || 0, g = got();
  const pct = nx ? Math.round((s - prev) / (nx[0] - prev) * 100) : 100;
  openSheet(`<div class="stack"><h2>🔥 Su racha</h2>
    <div class="row"><span class="small">Ahora: <b>${plural(s, 'día', 'días')}</b></span><span class="small muted">Récord: ${plural(best, 'día', 'días')}</span></div>
    ${nx ? `<div class="stack" style="gap:6px"><span class="small">Próximo hito: <b>${nx[0]} días</b> · +${nx[1]} 🪙 · faltan ${plural(nx[0] - s, 'día', 'días')}</span>
      <div class="progress"><i style="width:${pct}%"></i></div></div>` : '<p class="small" style="margin:0">¡Llegaron al último hito! 🏆</p>'}
    <ul class="list">${HITOS.map(([n, c]) => `<li><div class="txt"><span class="small">${g[n] || s >= n ? '✅' : '🔒'} <b>${n} días</b></span><span class="sub">+${c} 🪙 para la mascota${g[n] ? ` · ${new Date(g[n]).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` : ''}</span></div></li>`).join('')}</ul>
    <p class="tiny muted" style="margin:0">Un día cuenta si los dos hicieron algo: el ánimo, la pregunta, un corazón, la foto del día, el momento sorpresa, el diario, una nota, un cupón, una historia…</p>
    <button class="btn ghost" onclick="closeSheet()">Cerrar</button></div>`);
}

let t = null;
on('moods answers thinks daily activity sorpresa diary liga profiles pet', () => { clearTimeout(t); t = setTimeout(check, 1500); });
expose({ openRacha });
