// Zona de pruebas: herramientas para limpiar datos. Solo se muestra a las cuentas de TESTERS
// (o a todos en el emulador local). Es solo visual: las reglas de Firebase no cambian.
import { getDocs, writeBatch, deleteField, terminate, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { $, S, db, auth, EMU, esc, icon, expose, toast, openSheet, closeSheet, ask, col, ref, privCol, coupleRef,
         COLLECTIONS, PRIVATE, profile, uid, gates } from './core.js';

// Identificador interno de Firebase (no el correo, para no publicarlo en GitHub).
const TESTERS = ['sYhgiWepc8bsJ1lo5gKKVqVGDvp2'];
export const isTester = () => EMU || TESTERS.includes(uid());
// Administración solo aparece en Más, en el buscador y en «Tu menú» para los TESTERS
gates['s-admin'] = isTester;

export const testerCard = () => !isTester() ? '' : `
  <div class="glass stack" style="border-color:rgba(255,92,120,.4)"><span class="label">🧪 Zona de pruebas · solo tú la ves</span>
    <p class="small muted" style="margin:0">Para hacer pruebas. Lo que se borre en Firebase no se puede recuperar, salvo con un respaldo.</p>
    <button class="btn ghost small" style="width:100%" onclick="wipeDevice()">${icon('trash')} 1. Limpiar este teléfono</button>
    <button class="btn danger small" style="width:100%" onclick="wipeAsk('mine')">${icon('trash')} 2. Borrar mis datos en Firebase</button>
    <button class="btn danger small" style="width:100%" onclick="wipeAsk('all')">${icon('trash')} 3. Borrar TODO (de los dos)</button></div>`;

/* ---------- 1. Este teléfono ---------- */
async function wipeDevice() {
  if (!(await ask('¿Limpiar este teléfono? Se borra la copia local y se cierra la sesión. Firebase no se toca.', { ok: 'Limpiar', danger: true }))) return;
  toast('Limpiando…');
  try { await signOut(auth); } catch {}
  try { await terminate(db); } catch {}
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
  try {
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(dbs.map(d => new Promise(res => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = res; })));
  } catch {}
  location.replace(location.pathname + location.search);
}

/* ---------- 2 y 3. Firebase ---------- */
function wipeAsk(kind) {
  const all = kind === 'all';
  openSheet(`<div class="stack"><h2>${all ? 'Borrar TODO' : 'Borrar mis datos'}</h2>
    <p class="small" style="margin:0;line-height:1.5">${all
      ? 'Se borra todo lo de la pareja en Firebase: notas, momentos y fotos, listas, gastos, viajes, calendario, pelis, cartas, perfiles, nombres y fecha. Las ideas de regalo privadas de tu pareja no se pueden borrar desde tu cuenta.'
      : 'Se borra de Firebase solo lo que creaste tú: tus notas, momentos y fotos, gastos, planes, listas, cupones, cartas, ideas, tus votos, respuestas y ánimos, tu perfil y foto, tus ideas de regalo y tu nombre en la pareja. Lo de tu pareja queda.'}</p>
    <button class="btn ghost small" onclick="exportData()">Descargar respaldo antes</button>
    <label class="f" for="wipeConfirm">Escribe BORRAR para confirmar</label>
    <input id="wipeConfirm" autocomplete="off" autocapitalize="characters">
    <button class="btn danger" id="wipeBtn" onclick="wipeRun('${kind}')">${icon('trash')} Borrar ahora</button></div>`);
}
const mineDoc = d => [d.by, d.fromUid].includes(uid()) || (d.paidBy === uid() && !d.by);
async function commitAll(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}
async function wipeRun(kind) {
  if ($('wipeConfirm').value.trim().toUpperCase() !== 'BORRAR') return toast('Escribe BORRAR para confirmar');
  const btn = $('wipeBtn'); btn.disabled = true; btn.textContent = 'Borrando…';
  const me = uid(), ops = [];
  try {
    const photos = (await getDocs(col('photos'))).docs.map(d => d.id);
    if (kind === 'all') {
      for (const c of COLLECTIONS) for (const d of S.data[c]) ops.push(b => b.delete(ref(c, d.id)));
      for (const id of photos) ops.push(b => b.delete(ref('photos', id)));
      ops.push(b => b.delete(coupleRef));
      for (const c of ['visits', 'errors']) for (const d of (await getDocs(col(c))).docs) ops.push(b => b.delete(d.ref));
    } else {
      for (const c of COLLECTIONS) {
        if (c === 'profiles') continue;
        for (const d of S.data[c]) if (mineDoc(d)) ops.push(b => b.delete(ref(c, d.id)));
      }
      // Fotos de mis momentos, mi foto de perfil y mi fondo
      const myMoments = new Set(S.data.moments.filter(mineDoc).map(m => m.id));
      for (const id of photos) if (myMoments.has(id.replace(/^t-/, '')) || (id.startsWith('d-') || id.startsWith('t-d-')) && id.endsWith('-' + me) || id.startsWith(`avatar-${me}`) || id === `bg-${me}`) ops.push(b => b.delete(ref('photos', id)));
      // Mi parte dentro de documentos compartidos
      for (const m of S.data.moods) if (m[me]) ops.push(b => b.update(ref('moods', m.id), { [me]: deleteField() }));
      for (const a of S.data.answers) if (a.answers?.[me]) ops.push(b => b.update(ref('answers', a.id), { [`answers.${me}`]: deleteField() }));
      for (const l of S.data.lists) if (!mineDoc(l) && l.votes?.[me]) ops.push(b => b.update(ref('lists', l.id), { [`votes.${me}`]: deleteField() }));
      if (profile(me).id) ops.push(b => b.delete(ref('profiles', me)));
      for (const c of ['visits', 'errors']) for (const d of (await getDocs(query(col(c), where('uid', '==', me)))).docs) ops.push(b => b.delete(d.ref));
      if (S.settings.members?.[me]) ops.push(b => b.update(coupleRef, { [`members.${me}`]: deleteField() }));
    }
    for (const c of PRIVATE) for (const d of (await getDocs(privCol(c))).docs) ops.push(b => b.delete(d.ref));
    await commitAll(ops);
    try { localStorage.removeItem('nosotros-tour'); localStorage.removeItem('nosotros-data-subido'); } catch {}
    closeSheet(); toast(`Listo: ${ops.length} cambios en Firebase`);
  } catch (e) {
    console.error(e); toast('No se pudo borrar todo. Revisa la conexión e intenta de nuevo.');
    btn.disabled = false; btn.textContent = 'Borrar ahora';
  }
}

expose({ wipeDevice, wipeAsk, wipeRun });
