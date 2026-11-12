import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, connectAuthEmulator }
  from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator,
         doc, collection, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc, writeBatch }
  from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_IDEAS, LIST_TEMPLATES, COUPON_TEMPLATES, DATE_KINDS, QUESTIONS } from './data.js';

/* ================= Utilidades ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setState = s => { document.body.classList.remove('loading', 'out', 'in', 'noconfig'); document.body.classList.add(s); };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2000);
}
const openModal = id => $(id).classList.add('show');
function closeModal(m) { (typeof m === 'string' ? $(m) : m).classList.remove('show'); }
const updateOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
addEventListener('online', updateOnline); addEventListener('offline', updateOnline); updateOnline();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'PEGAR_AQUI') {
  setState('noconfig');
  throw new Error('Falta firebase-config.js');
}

/* ================= Fechas ================= */
const DAY = 86400000;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysBetween = (a, b) => Math.round((b - a) / DAY);
const fmtDate = d => d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = d => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addMonths(date, n) { // 31 ene + 1 mes = 28/29 feb
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}
const whenText = left => left === 0 ? '¡Hoy!' : left === 1 ? 'Mañana' : `en ${left} días`;

/* ================= Firebase ================= */
// Modo de prueba: en localhost con ?emu usa el emulador local de Firebase, nunca la base real.
const EMU = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu');
const app = initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-nosotros', authDomain: 'localhost' } : firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, EMU
  ? { localCache: memoryLocalCache() }
  : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (EMU) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
const COUPLE = 'nosotros';
const coupleRef = doc(db, 'couples', COUPLE);
const col = name => collection(db, 'couples', COUPLE, name);
const ref = (name, id) => doc(col(name), id);
const newRef = name => doc(col(name));
// Las escrituras se aplican al instante en el teléfono y se sincronizan solas,
// así que no se espera al servidor (funciona también sin internet).
const write = p => p.catch(err => {
  console.error(err);
  toast(err.code === 'permission-denied' ? 'Esta cuenta no tiene permiso 🔒' : 'No se pudo guardar');
});

/* ================= Estado ================= */
let me = null;
let settings = { start: '', members: {} };
const data = { bucket: [], ideas: [], notes: [], coupons: [], dates: [], moments: [], lists: [], answers: [] };
let unsubs = [];

const nameOf = uid => settings.members?.[uid]?.name || (uid === me?.uid ? 'Tú' : 'Tu pareja');
const partnerUid = () => Object.keys(settings.members || {}).find(u => u !== me.uid);
const partnerName = () => { const p = partnerUid(); return p ? nameOf(p) : 'tu pareja'; };
const myName = () => settings.members?.[me.uid]?.name || '';

/* ================= Sesión ================= */
onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  me = user;
  if (!user) { setState('out'); return; }
  setState('in');
  listen();
});

async function login() {
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPass').value);
    $('loginPass').value = '';
  } catch (e) {
    toast({
      'auth/invalid-credential': 'Correo o contraseña incorrectos',
      'auth/invalid-email': 'Ese correo no es válido',
      'auth/too-many-requests': 'Demasiados intentos, espera un rato',
      'auth/network-request-failed': 'Sin conexión a internet',
    }[e.code] || 'No se pudo entrar');
  } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
}
async function resetPass() {
  const email = $('loginEmail').value.trim();
  if (!email) return toast('Escribe tu correo arriba primero');
  try { await sendPasswordResetEmail(auth, email); toast('Te mandamos un correo 📧'); }
  catch { toast('No se pudo enviar el correo'); }
}
function logout() {
  if (!confirm('¿Cerrar sesión en este teléfono?')) return;
  closeModal('settingsModal'); signOut(auth);
}

const RENDER = {
  bucket: () => renderBucket(),
  ideas: () => { renderCitas(); renderCustomIdeas(); },
  notes: () => renderNotes(),
  coupons: () => renderCoupons(),
  dates: () => { renderHome(); renderFechasList(); },
  moments: () => { renderMoments(); renderMemory(); },
  lists: () => renderDecide(),
  answers: () => renderQuestion(),
};
function renderEverything() {
  renderHome(); renderMemory(); renderQuestion(); renderCitas(); renderDecide();
  renderBucket(); renderNotes(); renderCoupons(); renderMoments(); updateBadges();
}

function listen() {
  const fail = err => { console.error(err); if (err.code === 'permission-denied') toast('Esta cuenta no tiene acceso 🔒'); };
  unsubs.push(onSnapshot(coupleRef, { includeMetadataChanges: true }, snap => {
    settings = Object.assign({ start: '', members: {} }, snap.data());
    renderEverything();
    if (!snap.metadata.fromCache) maybeMigrate();
  }, fail));
  for (const name of Object.keys(data)) {
    unsubs.push(onSnapshot(col(name), s => {
      data[name] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      RENDER[name](); updateBadges();
    }, fail));
  }
  renderEverything();
}

function updateBadges() {
  if (!me) return;
  const setDot = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n > 9 ? '9+' : n; };
  const unreadNotes = data.notes.filter(n => n.fromUid !== me.uid && !n.readAt).length;
  const toFulfill = data.coupons.filter(c => c.fromUid === me.uid && c.redeemedAt && !c.doneAt).length;
  const newCoupons = data.coupons.filter(c => c.fromUid !== me.uid && !c.seenAt).length;
  setDot('notesSegDot', unreadNotes);
  setDot('couponsSegDot', toFulfill + newCoupons);
  setDot('loveDot', unreadNotes + toFulfill + newCoupons);
  const waitingVotes = data.lists.filter(l => listNeedsMyVote(l)).length;
  setDot('decideSegDot', waitingVotes); setDot('decideDot', waitingVotes);
  const ans = todayAnswers();
  const p = partnerUid();
  setDot('homeDot', (p && ans?.answers?.[p] && !ans?.answers?.[me.uid]) ? 1 : 0);
}

/* ================= Navegación ================= */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === b.dataset.s));
  window.scrollTo(0, 0);
  if (b.dataset.s === 's-love' && $('p-coupons').classList.contains('on')) markCouponsSeen();
});
document.querySelectorAll('.seg[data-group]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
  const g = seg.dataset.group;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll(`.pane[data-group="${g}"]`).forEach(p => p.classList.toggle('on', p.id === b.dataset.pane));
  if (b.dataset.pane === 'p-coupons') markCouponsSeen();
}));

/* ================= Inicio: contador y próximos momentos ================= */
function nextOccurrence(f) {
  const d = parseDate(f.date), now = today();
  if (!f.yearly) return d >= now ? d : null;
  let n = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (n < now) n = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return n;
}
function fechaLabel(f, occ) {
  const years = occ.getFullYear() - parseDate(f.date).getFullYear();
  if (f.yearly && f.emoji === '🎂' && years > 0) return `${f.emoji} ${f.title} (cumple ${years})`;
  if (f.yearly && f.emoji === '💍' && years > 0) return `${f.emoji} ${f.title} (${years} años)`;
  return `${f.emoji} ${f.title}`;
}

function renderHome() {
  if (!me) return;
  const ready = settings.start && myName();
  $('setupCard').style.display = ready ? 'none' : 'block';
  $('counterArea').style.display = ready ? 'block' : 'none';
  const now = today();
  const list = [];

  if (!ready) {
    $('setupTitle').textContent = settings.start ? '¡Hola! 👋' : '¡Bienvenido!';
    $('setupText').textContent = settings.start
      ? 'Solo falta que pongas tu nombre.'
      : 'Pon tu nombre y el día en que empezaron para activar el contador.';
  } else {
    const start = parseDate(settings.start);
    const days = daysBetween(start, now);
    const names = Object.values(settings.members).sort((a, b) => (a.joined || 0) - (b.joined || 0)).map(m => m.name);
    $('namesLbl').textContent = names.join(' & ');
    $('daysBig').textContent = days.toLocaleString('es');

    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (addMonths(start, months) > now) months--;
    months = Math.max(0, months);
    $('bY').textContent = Math.floor(months / 12);
    $('bM').textContent = months % 12;
    $('bD').textContent = Math.max(0, daysBetween(addMonths(start, months), now));

    const next100 = (Math.floor(days / 100) + 1) * 100;
    list.push({ label: `💯 ${next100.toLocaleString('es')} días juntos`, date: new Date(start.getTime() + next100 * DAY) });
    const next1000 = (Math.floor(days / 1000) + 1) * 1000;
    if (next1000 !== next100) list.push({ label: `🎉 ${next1000.toLocaleString('es')} días juntos`, date: new Date(start.getTime() + next1000 * DAY) });
    const totalMonths = months + 1;
    if (totalMonths % 12 === 0) {
      list.push({ label: `💍 Aniversario #${totalMonths / 12}`, date: addMonths(start, totalMonths) });
    } else {
      list.push({ label: `🗓️ Mesiversario #${totalMonths}`, date: addMonths(start, totalMonths) });
      const nextYear = Math.floor(months / 12) + 1;
      list.push({ label: `💍 Aniversario #${nextYear}`, date: addMonths(start, nextYear * 12) });
    }
  }

  for (const f of data.dates) {
    const occ = nextOccurrence(f);
    if (occ) list.push({ label: fechaLabel(f, occ), date: occ });
  }
  list.sort((a, b) => a.date - b.date);
  $('milestones').innerHTML = list.length ? list.slice(0, 6).map(m => `
    <div class="milestone"><div><div>${esc(m.label)}</div><div class="muted small">${fmtDate(m.date)}</div></div>
    <div class="when">${whenText(daysBetween(now, m.date))}</div></div>`).join('')
    : '<div class="empty">Agreguen cumpleaños, viajes o eventos con 📅</div>';
}

/* ================= Fechas especiales ================= */
$('fechaKind').innerHTML = DATE_KINDS.map(([e, l]) => `<option value="${e}">${e} ${l}</option>`).join('');
$('fechaKind').onchange = () => { $('fechaYearly').checked = ['🎂', '💍'].includes($('fechaKind').value); };
function openFechas() { renderFechasList(); openModal('fechasModal'); }
function renderFechasList() {
  const items = [...data.dates].sort((a, b) => (nextOccurrence(a) || 9e15) - (nextOccurrence(b) || 9e15));
  $('fechasList').innerHTML = items.length ? items.map(f => {
    const occ = nextOccurrence(f);
    return `<li><div class="txt">${esc(f.emoji)} ${esc(f.title)}
      <div class="muted small">${fmtDate(parseDate(f.date))}${f.yearly ? ' · cada año' : ''}${occ ? ' · ' + whenText(daysBetween(today(), occ)) : ' · ya pasó'}</div></div>
      <button class="del" onclick="delFecha('${f.id}')">✕</button></li>`;
  }).join('') : '<li class="empty">Aún no hay fechas</li>';
}
function addFecha() {
  const title = $('fechaTitle').value.trim(), date = $('fechaDate').value;
  if (!title || !date) return toast('Pon un nombre y una fecha');
  write(setDoc(newRef('dates'), { title, date, emoji: $('fechaKind').value, yearly: $('fechaYearly').checked, by: me.uid }));
  $('fechaTitle').value = ''; $('fechaDate').value = '';
  toast('Fecha guardada 📅');
}
function delFecha(id) { if (confirm('¿Borrar esta fecha?')) write(deleteDoc(ref('dates', id))); }

/* ================= Un día como hoy ================= */
function renderMemory() {
  if (!me) return;
  const now = today();
  const md = dayKey(now).slice(5);
  const m = data.moments
    .filter(x => x.date && x.date.slice(5) === md && Number(x.date.slice(0, 4)) < now.getFullYear())
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const card = $('memoryCard');
  if (!m) { card.style.display = 'none'; return; }
  const years = now.getFullYear() - Number(m.date.slice(0, 4));
  card.style.display = 'block';
  card.innerHTML = `<h2>🕰️ Un día como hoy</h2><div class="memory">
    ${m.hasPhoto ? `<img data-photo="${m.id}" alt="">` : '<div style="font-size:44px">📸</div>'}
    <div><div style="font-weight:700">${esc(m.title)}</div><div class="muted small">Hace ${years} año${years === 1 ? '' : 's'}</div></div></div>`;
  loadPhotos(card);
}

/* ================= Pregunta del día ================= */
const todayKey = () => dayKey(today());
function todayQuestion() {
  const n = today();
  const idx = Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY);
  return QUESTIONS[idx % QUESTIONS.length];
}
const todayAnswers = () => data.answers.find(a => a.id === todayKey());

function renderQuestion() {
  if (!me) return;
  const ans = todayAnswers();
  const q = ans?.q || todayQuestion();
  const p = partnerUid(), pn = partnerName();
  const mine = ans?.answers?.[me.uid], theirs = p && ans?.answers?.[p];
  let html = `<div class="header"><h2 style="margin:0">💬 Pregunta del día</h2>
    <button class="link" onclick="openAnswers()">Anteriores</button></div>
    <div class="question">${esc(q)}</div>`;
  if (!mine) {
    html += `<textarea id="answerText" maxlength="500" placeholder="Tu respuesta…" style="min-height:70px"></textarea>
      <div class="gap"></div><button class="primary" onclick="answerQuestion()">Responder</button>
      <div class="locked">${theirs ? `🔒 ${esc(pn)} ya respondió. Responde para ver su respuesta.` : `${esc(pn)} aún no responde.`}</div>`;
  } else {
    html += `<div class="answer"><b>Tú</b>${esc(mine.text)}</div>`;
    html += theirs
      ? `<div class="answer"><b>${esc(pn)}</b>${esc(theirs.text)}</div>`
      : `<div class="locked">⏳ Esperando la respuesta de ${esc(pn)}…</div>`;
  }
  $('questionCard').innerHTML = html;
}
function answerQuestion() {
  const text = $('answerText').value.trim();
  if (!text) return toast('Escribe tu respuesta');
  const ans = todayAnswers();
  write(setDoc(ref('answers', todayKey()), { q: ans?.q || todayQuestion(), answers: { [me.uid]: { text, at: Date.now() } } }, { merge: true }));
}
function openAnswers() {
  const p = partnerUid(), pn = partnerName();
  const past = data.answers.filter(a => a.id !== todayKey() && a.answers?.[me.uid]).sort((a, b) => b.id.localeCompare(a.id));
  $('answersHistory').innerHTML = past.length ? past.map(a => `
    <div style="margin-bottom:18px"><div class="muted small">${fmtDate(parseDate(a.id))}</div>
    <div style="font-weight:700;margin:4px 0">${esc(a.q)}</div>
    <div class="answer"><b>Tú</b>${esc(a.answers[me.uid].text)}</div>
    ${p && a.answers[p] ? `<div class="answer"><b>${esc(pn)}</b>${esc(a.answers[p].text)}</div>` : `<div class="locked">${esc(pn)} no respondió</div>`}
    </div>`).join('') : '<p class="empty">Aquí aparecerán las preguntas que ya respondiste.</p>';
  openModal('answersModal');
}

/* ================= Ajustes y respaldo ================= */
function openSettings() {
  $('setName').value = myName();
  $('setStart').value = settings.start || '';
  const p = partnerUid();
  $('partnerInfo').textContent = p
    ? `Conectado con ${nameOf(p)} 💞`
    : 'Tu pareja aparecerá aquí cuando entre por primera vez y ponga su nombre.';
  $('sessionInfo').textContent = `Entraste como ${me.email}`;
  renderCustomIdeas();
  openModal('settingsModal');
}
function saveSettings() {
  const name = $('setName').value.trim(), start = $('setStart').value;
  if (!name || !start) return toast('Completa tu nombre y la fecha');
  if (parseDate(start) > today()) return toast('La fecha no puede ser futura');
  const joined = settings.members?.[me.uid]?.joined || Date.now();
  write(setDoc(coupleRef, { start, members: { [me.uid]: { name, joined } } }, { merge: true }));
  closeModal('settingsModal'); toast('Guardado 💾');
}
function renderCustomIdeas() {
  $('customIdeasList').innerHTML = data.ideas.length
    ? data.ideas.map(i => `<li><span class="txt">${esc(i.t)}</span><button class="del" onclick="delIdea('${i.id}')">✕</button></li>`).join('')
    : '<li class="empty">Aún no agregan ideas propias</li>';
}
function delIdea(id) { write(deleteDoc(ref('ideas', id))); }

const COLS = Object.keys(data);
function exportData() {
  const out = { version: 3, start: settings.start, members: settings.members };
  for (const c of COLS) out[c] = data[c];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nosotros-respaldo-${dayKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Convierte el formato de la primera versión (solo en el teléfono) al actual.
function fromV1(d) {
  return {
    start: d.start,
    members: d.name1 && !settings.members?.[me.uid] ? { [me.uid]: { name: d.name1, joined: Date.now() } } : null,
    ideas: (d.ideas || []).map(i => ({ ...i, by: me.uid })),
    bucket: (d.bucket || []).map(b => ({ ...b, doneAt: b.doneAt || null, createdAt: b.createdAt || Date.now(), by: me.uid })),
    notes: (d.notes || []).map(n => ({
      id: n.id, text: n.text, createdAt: n.createdAt || Date.now(), readAt: n.readAt || null,
      fromUid: n.from === 2 ? 'antes-pareja' : me.uid,
      fromName: (n.from === 2 ? d.name2 : d.name1) || '',
    })),
  };
}
// Sube un respaldo. Usa los mismos IDs, así que subir el mismo respaldo dos veces no duplica nada.
async function uploadData(raw) {
  const d = raw.version ? raw : fromV1(raw);
  const ops = [];
  const patch = {};
  if (d.start && !settings.start) patch.start = d.start;
  if (d.members) patch.members = d.members;
  if (Object.keys(patch).length) ops.push(b => b.set(coupleRef, patch, { merge: true }));
  for (const c of COLS) {
    for (const item of d[c] || []) {
      if (!item?.id) continue;
      const { id, ...rest } = item;
      ops.push(b => b.set(ref(c, id), rest));
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}
const OLD_KEY = 'nosotros-data';
async function maybeMigrate() {
  if (maybeMigrate.running || localStorage.getItem(OLD_KEY + '-subido')) return;
  let old; try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch {}
  if (!old || !(old.bucket?.length || old.notes?.length || old.ideas?.length || old.start)) return;
  maybeMigrate.running = true;
  if (confirm('Encontré datos guardados en este teléfono de la versión anterior. ¿Subirlos para compartirlos?')) {
    try { await uploadData(old); localStorage.setItem(OLD_KEY + '-subido', '1'); toast('Datos subidos ✅'); }
    catch (e) { console.error(e); toast('No se pudieron subir, se intentará de nuevo'); }
  } else {
    localStorage.setItem(OLD_KEY + '-subido', 'no');
  }
  maybeMigrate.running = false;
}
function importData(input) {
  const f = input.files[0]; if (!f) return;
  f.text().then(txt => {
    const d = JSON.parse(txt);
    if (typeof d !== 'object' || !Array.isArray(d.bucket)) throw 0;
    if (!confirm('Se agregarán los datos del respaldo a los actuales. ¿Continuar?')) return;
    return uploadData(d).then(() => toast('Respaldo subido ✅'));
  }).catch(() => toast('Ese archivo no es un respaldo válido'));
  input.value = '';
}

/* ================= Animación de sorteo ================= */
// Muestra opciones al azar cada vez más lento y termina en una.
function animatePick(items, show, done) {
  let i = 0, delay = 40, last = null;
  const tick = () => {
    let p; do { p = pick(items); } while (items.length > 1 && p === last);
    last = p; show(p);
    if (navigator.vibrate) navigator.vibrate(5);
    if (++i < 16) { delay *= 1.12; setTimeout(tick, delay); } else done(p);
  };
  tick();
}

/* ================= Ideas de citas ================= */
const filters = { place: 'todo', cost: 'todo' };
const PLACES = [['todo', 'Todo'], ['casa', '🏠 En casa'], ['afuera', '🌆 Afuera']];
const COSTS = [['todo', 'Cualquier precio'], ['0', 'Gratis'], ['1', '$'], ['2', '$$'], ['3', '$$$']];
const costLbl = c => ['Gratis', '$', '$$', '$$$'][c];
let lastIdea = null;

function renderChips(el, opts, key) {
  el.innerHTML = opts.map(([v, l]) => `<button class="chip ${filters[key] === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
  el.querySelectorAll('.chip').forEach(c => c.onclick = () => { filters[key] = c.dataset.v; renderCitas(); });
}
const allIdeas = () => [...DEFAULT_IDEAS, ...data.ideas.map(i => ({ ...i, e: i.e || '💡' }))];
const ideaPool = () => allIdeas().filter(i =>
  (filters.place === 'todo' || i.place === filters.place) &&
  (filters.cost === 'todo' || String(i.cost) === filters.cost));

function renderCitas() {
  renderChips($('placeChips'), PLACES, 'place');
  renderChips($('costChips'), COSTS, 'cost');
  const n = ideaPool().length;
  $('ideaCount').textContent = `${n} idea${n === 1 ? '' : 's'} con estos filtros · ${data.ideas.length} propia${data.ideas.length === 1 ? '' : 's'}`;
}
function spin() {
  const p = ideaPool();
  if (!p.length) return toast('No hay ideas con esos filtros');
  const btn = $('spinBtn'), w = $('wheel');
  btn.disabled = true; w.classList.add('spinning'); $('toBucketBtn').hidden = true; $('wMeta').textContent = '';
  animatePick(p, x => { $('wEmoji').textContent = x.e; $('wTxt').textContent = x.t; }, x => {
    lastIdea = x;
    w.classList.remove('spinning'); btn.disabled = false; btn.textContent = '🎰 Otra vez';
    $('wMeta').textContent = `${x.place === 'casa' ? '🏠 En casa' : '🌆 Afuera'} · ${costLbl(x.cost)}`;
    $('toBucketBtn').hidden = false;
  });
}
function ideaToBucket() {
  if (!lastIdea) return;
  write(setDoc(newRef('bucket'), { text: `${lastIdea.e} ${lastIdea.t}`, done: false, doneAt: null, createdAt: Date.now(), by: me.uid }));
  $('toBucketBtn').hidden = true; toast('Agregada a la bucket list ✅');
}
function addIdea() {
  const t = $('newIdea').value.trim();
  if (!t) return toast('Escribe una idea');
  write(setDoc(newRef('ideas'), { t, place: $('newIdeaPlace').value, cost: Number($('newIdeaCost').value), e: '💡', by: me.uid }));
  $('newIdea').value = ''; toast('Idea agregada 💡');
}
$('newIdea').addEventListener('keydown', e => e.key === 'Enter' && addIdea());

/* ================= Decidir algo ================= */
// Modos: 'random' (al azar), 'turns' (eliminar por turnos en un teléfono), 'match' (cada uno vota en el suyo)
let selList = null, mode = null, turns = null, randomResult = null;
const curList = () => data.lists.find(l => l.id === selList);
const myVotes = l => l.votes?.[me.uid] || {};
const theirVotes = l => { const p = partnerUid(); return (p && l.votes?.[p]) || {}; };
function listNeedsMyVote(l) {
  const theirs = theirVotes(l), mine = myVotes(l);
  return Object.keys(theirs).length > 0 && (l.options || []).some(o => !(o in mine));
}

function renderDecide() {
  if (!me) return;
  const lists = [...data.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!curList()) { selList = lists[0]?.id || null; mode = null; turns = null; }

  $('listChips').innerHTML = lists.map(l =>
    `<button class="chip ${l.id === selList ? 'on' : ''}" onclick="selectList('${l.id}')">${esc(l.emoji)} ${esc(l.name)}${listNeedsMyVote(l) ? ' 🔴' : ''}</button>`).join('') +
    `<button class="chip" onclick="openModal('listModal')">＋ Nueva lista</button>`;

  const missing = LIST_TEMPLATES.filter(t => !lists.some(l => l.name === t.name));
  $('listTemplates').innerHTML = !lists.length ? `<div class="card"><h2>Empiecen con una lista</h2>
    <p class="muted small" style="margin-top:0">Después pueden cambiar las opciones como quieran.</p>
    <div class="chips" style="margin:0">${missing.map((t, i) => `<button class="chip" onclick="createFromTemplate(${LIST_TEMPLATES.indexOf(t)})">${t.emoji} ${esc(t.name)}</button>`).join('')}</div></div>` : '';

  const l = curList();
  if (!l) { $('listArea').innerHTML = ''; return; }
  const opts = l.options || [];
  let html = `<div class="card">
    <div class="header"><h2 style="margin:0">${esc(l.emoji)} ${esc(l.name)}</h2>
      <button class="del" onclick="delList('${l.id}')" title="Borrar lista">🗑️</button></div>
    <div class="chips" style="margin:12px 0">${opts.map((o, i) =>
      `<span class="chip">${esc(o)}<span class="x" onclick="delOption(${i})">✕</span></span>`).join('') || '<span class="muted small">Sin opciones todavía</span>'}</div>
    <div class="row"><input id="newOption" placeholder="Agregar opción…" maxlength="40"><button class="ghost" onclick="addOption()">＋</button></div>
  </div>
  <div class="modes">
    <button class="mode ${mode === 'random' ? 'on' : ''}" onclick="setMode('random')"><span>🎲</span><b>Al azar</b><small>Decide la suerte</small></button>
    <button class="mode ${mode === 'turns' ? 'on' : ''}" onclick="setMode('turns')"><span>⚔️</span><b>Por turnos</b><small>Eliminan uno y uno</small></button>
    <button class="mode ${mode === 'match' ? 'on' : ''}" onclick="setMode('match')"><span>💞</span><b>Match</b><small>Cada uno vota</small>${listNeedsMyVote(l) ? '<b class="dot" style="top:6px;right:8px">!</b>' : ''}</button>
  </div><div style="height:14px"></div><div id="modeArea"></div>`;
  $('listArea').innerHTML = html;
  $('newOption').addEventListener('keydown', e => e.key === 'Enter' && addOption());
  renderMode();
}

function renderMode() {
  const l = curList(), area = $('modeArea');
  if (!l || !area) return;
  const opts = l.options || [];
  if (!mode) { area.innerHTML = '<p class="muted small center">Elijan cómo decidir 👆</p>'; return; }
  if (opts.length < 2) { area.innerHTML = '<p class="muted center">Agreguen al menos 2 opciones.</p>'; return; }

  if (mode === 'random') {
    area.innerHTML = `<div class="card wheel" id="dWheel"><div class="emoji">${esc(l.emoji)}</div>
      <div class="txt" id="dTxt">${randomResult ? esc(randomResult) : '¿Qué saldrá?'}</div></div>
      <button class="primary" id="dSpin" onclick="decideRandom()">${randomResult ? '🎲 Otra vez' : '🎲 Sortear'}</button>`;
  }

  if (mode === 'turns') {
    if (!turns) {
      const p = partnerUid();
      const order = p ? [me.uid, p] : [me.uid];
      turns = { remaining: [...opts], who: 0, order };
    }
    const t = turns;
    if (t.remaining.length === 1) {
      area.innerHTML = `<div class="card winner"><div class="big-emoji">🏆</div><div class="muted">Ganó</div>
        <div class="name">${esc(t.remaining[0])}</div></div>
        <button class="ghost full" onclick="restartTurns()">⚔️ Jugar otra vez</button>`;
    } else {
      const who = nameOf(t.order[t.who % t.order.length]);
      area.innerHTML = `<div class="card"><div class="center" style="margin-bottom:12px">
        <div class="muted small">Pásense el teléfono</div>
        <div style="font-size:19px;font-weight:700">Turno de ${esc(who)}: elimina una ❌</div></div>
        <div class="opt-grid">${t.remaining.map((o, i) => `<button class="opt-btn" onclick="eliminate(${i})">${esc(o)}</button>`).join('')}</div></div>
        <button class="link" style="width:100%" onclick="restartTurns()">Reiniciar</button>`;
    }
  }

  if (mode === 'match') {
    const mine = myVotes(l), theirs = theirVotes(l), p = partnerUid(), pn = partnerName();
    const pending = opts.filter(o => !(o in mine));
    if (pending.length) {
      const o = pending[0];
      const done = opts.length - pending.length;
      area.innerHTML = `<div class="card vote-card"><div class="muted small">${done + 1} de ${opts.length} · ¿Te late?</div>
        <div class="opt">${esc(o)}</div>
        <div class="vote-btns"><button class="vote-no" onclick="vote(false)">👎</button><button class="vote-yes" onclick="vote(true)">👍</button></div>
        <p class="muted small" style="margin:14px 0 0">${esc(pn)} no verá tus votos, solo en lo que coinciden.</p></div>`;
    } else {
      const partnerDone = p && opts.every(o => o in theirs);
      if (!partnerDone) {
        const n = opts.filter(o => o in theirs).length;
        area.innerHTML = `<div class="card center"><div style="font-size:44px">⏳</div>
          <h2>¡Ya votaste!</h2><p class="muted">Esperando a ${esc(pn)}${n ? ` (va ${n} de ${opts.length})` : ''}. Le aparecerá un aviso en su app.</p></div>
          <button class="link" style="width:100%" onclick="resetVotes()">🔄 Empezar de nuevo</button>`;
      } else {
        const matches = opts.filter(o => mine[o] && theirs[o]);
        if (!matches.length) {
          area.innerHTML = `<div class="card center"><div style="font-size:44px">😅</div><h2>No coincidieron en nada</h2>
            <p class="muted">Prueben "Por turnos" para desempatar.</p></div>
            <button class="ghost full" onclick="resetVotes()">🔄 Votar de nuevo</button>`;
        } else if (matches.length === 1) {
          area.innerHTML = `<div class="card winner"><div class="big-emoji">💞</div><div class="muted">¡Coinciden en!</div>
            <div class="name">${esc(matches[0])}</div></div>
            <button class="ghost full" onclick="resetVotes()">🔄 Votar de nuevo</button>`;
        } else {
          area.innerHTML = `<div class="card"><h2>💞 Coinciden en ${matches.length}</h2>
            <div class="chips">${matches.map(o => `<span class="chip on">${esc(o)}</span>`).join('')}</div>
            <div class="wheel" style="min-height:90px;padding:8px"><div class="txt" id="mTxt"></div></div>
            <button class="primary" id="mSpin" onclick="decideAmong()">🎲 Sortear entre los matches</button></div>
            <button class="link" style="width:100%" onclick="resetVotes()">🔄 Votar de nuevo</button>`;
        }
      }
    }
  }
}

function selectList(id) { selList = id; mode = null; turns = null; randomResult = null; renderDecide(); }
function setMode(m) { mode = m; turns = null; randomResult = null; renderDecide(); }
function createFromTemplate(i) {
  const t = LIST_TEMPLATES[i];
  const r = newRef('lists');
  write(setDoc(r, { name: t.name, emoji: t.emoji, options: [...t.options], votes: {}, createdAt: Date.now(), by: me.uid }));
  selList = r.id; mode = null;
}
function createList() {
  const name = $('listName').value.trim();
  if (!name) return toast('Ponle nombre a la lista');
  const r = newRef('lists');
  write(setDoc(r, { name, emoji: $('listEmoji').value.trim() || '🤔', options: [], votes: {}, createdAt: Date.now(), by: me.uid }));
  selList = r.id; mode = null;
  $('listName').value = ''; closeModal('listModal');
}
function delList(id) {
  if (!confirm('¿Borrar esta lista para los dos?')) return;
  write(deleteDoc(ref('lists', id))); selList = null;
}
function addOption() {
  const l = curList(), v = $('newOption').value.trim();
  if (!l || !v) return;
  if ((l.options || []).some(o => o.toLowerCase() === v.toLowerCase())) return toast('Esa opción ya está');
  write(updateDoc(ref('lists', l.id), { options: [...(l.options || []), v] }));
  turns = null;
}
function delOption(i) {
  const l = curList(); if (!l) return;
  const options = [...l.options]; options.splice(i, 1);
  write(updateDoc(ref('lists', l.id), { options })); turns = null;
}
function decideRandom() {
  const l = curList(); const btn = $('dSpin'); btn.disabled = true;
  $('dWheel').classList.add('spinning');
  animatePick(l.options, o => { $('dTxt').textContent = o; }, o => {
    randomResult = o; $('dWheel').classList.remove('spinning'); btn.disabled = false; btn.textContent = '🎲 Otra vez';
    toast(`¡${o}! 🎉`);
  });
}
function eliminate(i) {
  turns.remaining.splice(i, 1); turns.who++;
  if (navigator.vibrate) navigator.vibrate(10);
  renderMode();
}
function restartTurns() { turns = null; renderMode(); }
function vote(yes) {
  const l = curList(); if (!l) return;
  const o = (l.options || []).find(x => !(x in myVotes(l)));
  if (o === undefined) return;
  write(updateDoc(ref('lists', l.id), { [`votes.${me.uid}`]: { ...myVotes(l), [o]: yes } }));
}
function resetVotes() {
  const l = curList(); if (!l) return;
  if (!confirm('¿Borrar los votos de los dos y empezar de nuevo?')) return;
  write(updateDoc(ref('lists', l.id), { votes: {} }));
}
function decideAmong() {
  const l = curList();
  const matches = l.options.filter(o => myVotes(l)[o] && theirVotes(l)[o]);
  const btn = $('mSpin'); btn.disabled = true;
  animatePick(matches, o => { $('mTxt').textContent = o; }, o => { btn.disabled = false; toast(`¡${o}! 🎉`); });
}

/* ================= Bucket list ================= */
function renderBucket() {
  if (!me) return;
  const items = [...data.bucket].sort((a, b) => (a.done - b.done) || (b.createdAt || 0) - (a.createdAt || 0));
  const done = data.bucket.filter(b => b.done).length, total = data.bucket.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  $('bucketCount').textContent = `${done} de ${total} cumplidas`;
  $('bucketPct').textContent = `${pct}%`;
  $('bucketBar').style.width = pct + '%';
  $('bucketList').innerHTML = items.length ? items.map(b => `
    <li class="${b.done ? 'done' : ''}">
      <button class="check" onclick="toggleBucket('${b.id}')">${b.done ? '✓' : ''}</button>
      <div class="txt">${esc(b.text)}<span class="muted small" style="display:block">${b.doneAt ? `Cumplida el ${fmtDate(new Date(b.doneAt))}` : `Agregado por ${esc(nameOf(b.by))}`}</span></div>
      <button class="del" onclick="delBucket('${b.id}')">✕</button>
    </li>`).join('') : '<li class="empty">Agreguen su primer sueño juntos ✨</li>';
}
function addBucket() {
  const t = $('newBucket').value.trim();
  if (!t) return;
  write(setDoc(newRef('bucket'), { text: t, done: false, doneAt: null, createdAt: Date.now(), by: me.uid }));
  $('newBucket').value = '';
}
$('newBucket').addEventListener('keydown', e => e.key === 'Enter' && addBucket());
function toggleBucket(id) {
  const b = data.bucket.find(x => x.id === id); if (!b) return;
  write(updateDoc(ref('bucket', id), { done: !b.done, doneAt: b.done ? null : Date.now() }));
  if (!b.done) toast('¡Una menos! 🎉');
}
function delBucket(id) {
  if (!confirm('¿Borrar este elemento? Se borra para los dos.')) return;
  write(deleteDoc(ref('bucket', id)));
}

/* ================= Frasco de notas ================= */
const fromLabel = n => n.fromName || nameOf(n.fromUid);
function renderNotes() {
  if (!me) return;
  const forMe = data.notes.filter(n => n.fromUid !== me.uid);
  const unread = forMe.filter(n => !n.readAt).length;
  $('writeTitle').textContent = `Escribirle una nota a ${partnerName()}`;
  $('jarInfo').textContent = forMe.length
    ? `${unread} nota${unread === 1 ? '' : 's'} sin leer para ti`
    : `El frasco está vacío. Pídele a ${partnerName()} que te escriba una 😉`;
  const read = forMe.filter(n => n.readAt).sort((a, b) => b.readAt - a.readAt);
  $('readCount').textContent = read.length || '';
  $('readList').innerHTML = read.length ? read.map(n => `
    <li><div class="txt">${esc(n.text)}<div class="muted small">De ${esc(fromLabel(n))} · ${fmtDate(new Date(n.createdAt))}</div></div></li>`).join('')
    : '<li class="empty">Aún no has sacado notas</li>';
  const mine = data.notes.filter(n => n.fromUid === me.uid).sort((a, b) => b.createdAt - a.createdAt);
  $('mineList').innerHTML = mine.length ? mine.map(n => `
    <li><div class="txt">${esc(n.text)}<div class="muted small">${fmtDate(new Date(n.createdAt))}</div></div>
    <span class="badge ${n.readAt ? 'ok' : ''}">${n.readAt ? 'Leída ✓' : 'Sin leer'}</span>
    <button class="del" onclick="delNote('${n.id}')">✕</button></li>`).join('')
    : '<li class="empty">Todavía no escribes ninguna</li>';
}
function addNote() {
  const t = $('newNote').value.trim();
  if (!t) return toast('Escribe algo bonito primero');
  write(setDoc(newRef('notes'), { text: t, fromUid: me.uid, fromName: myName(), createdAt: Date.now(), readAt: null }));
  $('newNote').value = ''; toast('Nota guardada en el frasco 💌');
}
function drawNote() {
  const forMe = data.notes.filter(n => n.fromUid !== me.uid);
  if (!forMe.length) return toast('No hay notas para ti todavía');
  const unread = forMe.filter(n => !n.readAt);
  const n = pick(unread.length ? unread : forMe);
  if (!n.readAt) write(updateDoc(ref('notes', n.id), { readAt: Date.now() }));
  $('noteText').textContent = n.text;
  $('noteMeta').textContent = `De ${fromLabel(n)} · escrita el ${fmtDate(new Date(n.createdAt))}` +
    (unread.length ? '' : ' · (ya leíste todas, esta es repetida)');
  openModal('noteModal');
}
function delNote(id) { if (confirm('¿Borrar esta nota?')) write(deleteDoc(ref('notes', id))); }

/* ================= Cupones ================= */
$('couponTpls').innerHTML = COUPON_TEMPLATES.map(([e, t], i) => `<button class="chip" onclick="useCouponTpl(${i})">${e} ${esc(t.replace('Vale por ', ''))}</button>`).join('');
function useCouponTpl(i) {
  const [e, t] = COUPON_TEMPLATES[i];
  $('couponEmoji').value = e; $('couponText').value = t; $('couponText').focus();
}
function couponStatus(c) {
  if (c.doneAt) return `Cumplido el ${fmtShort(new Date(c.doneAt))} ✓`;
  if (c.redeemedAt) return `Canjeado el ${fmtShort(new Date(c.redeemedAt))}`;
  return `Regalado el ${fmtShort(new Date(c.createdAt))}`;
}
function renderCoupons() {
  if (!me) return;
  const pn = partnerName();
  $('couponTitle').textContent = `Regalarle un cupón a ${pn}`;
  $('forMeTitle').textContent = `Cupones de ${pn} para ti`;
  const order = c => c.doneAt ? 2 : c.redeemedAt ? 1 : 0;
  const sort = arr => arr.sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt);

  const forMe = sort(data.coupons.filter(c => c.fromUid !== me.uid));
  $('couponsForMe').innerHTML = forMe.length ? forMe.map(c => `
    <div class="ticket ${c.doneAt ? 'used' : ''}"><div class="e">${esc(c.emoji)}</div>
    <div class="txt">${esc(c.text)}<small>${c.redeemedAt && !c.doneAt ? `⏳ Canjeado, esperando a que ${esc(pn)} cumpla` : couponStatus(c)}</small></div>
    ${!c.redeemedAt ? `<button class="ghost" onclick="redeemCoupon('${c.id}')">Canjear</button>` : ''}</div>`).join('')
    : `<p class="empty">Aún no tienes cupones. Quizás ${esc(pn)} debería regalarte uno 😉</p>`;

  const mine = sort(data.coupons.filter(c => c.fromUid === me.uid));
  $('couponsMine').innerHTML = mine.length ? mine.map(c => `
    <div class="ticket ${c.doneAt ? 'used' : ''}"><div class="e">${esc(c.emoji)}</div>
    <div class="txt">${esc(c.text)}<small>${c.redeemedAt && !c.doneAt ? `🔔 ¡${esc(pn)} lo canjeó! Te toca cumplir` : couponStatus(c)}</small></div>
    ${c.redeemedAt && !c.doneAt ? `<button class="ghost" onclick="fulfillCoupon('${c.id}')">✓ Cumplido</button>` : ''}
    ${!c.redeemedAt ? `<button class="del" onclick="delCoupon('${c.id}')">✕</button>` : ''}</div>`).join('')
    : '<p class="empty">Todavía no regalas cupones</p>';
}
function addCoupon() {
  const text = $('couponText').value.trim();
  if (!text) return toast('Escribe el cupón');
  write(setDoc(newRef('coupons'), { text, emoji: $('couponEmoji').value, fromUid: me.uid, createdAt: Date.now(), seenAt: null, redeemedAt: null, doneAt: null }));
  $('couponText').value = ''; toast(`Cupón regalado a ${partnerName()} 🎁`);
}
function redeemCoupon(id) {
  if (!confirm('¿Canjear este cupón ahora?')) return;
  write(updateDoc(ref('coupons', id), { redeemedAt: Date.now(), seenAt: Date.now() }));
  toast('¡Canjeado! 🎉');
}
function fulfillCoupon(id) { write(updateDoc(ref('coupons', id), { doneAt: Date.now() })); toast('¡Cumplido! 💞'); }
function delCoupon(id) { if (confirm('¿Borrar este cupón?')) write(deleteDoc(ref('coupons', id))); }
function markCouponsSeen() {
  if (!me) return;
  for (const c of data.coupons) if (c.fromUid !== me.uid && !c.seenAt) write(updateDoc(ref('coupons', c.id), { seenAt: Date.now() }));
}

/* ================= Momentos ================= */
const photoCache = {};
function loadPhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async img => {
    const id = img.dataset.photo;
    photoCache[id] ??= getDoc(ref('photos', id)).then(s => s.data()?.data || '').catch(() => { delete photoCache[id]; return ''; });
    const src = await photoCache[id];
    if (src) img.src = src; else img.remove();
  });
}
function renderMoments() {
  if (!me) return;
  const items = [...data.moments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!items.length) {
    $('momentsList').innerHTML = `<div class="card center"><div style="font-size:48px">📸</div>
      <h2>Su historia empieza aquí</h2><p class="muted">Guarden momentos importantes con foto: la primera cita, viajes, logros…</p>
      <button class="primary" onclick="openMoment()">＋ Agregar el primero</button></div>`;
    return;
  }
  let html = '', year = null;
  for (const m of items) {
    const y = m.date.slice(0, 4);
    if (y !== year) { html += `<div class="year">${y}</div>`; year = y; }
    html += `<div class="card moment">
      ${m.hasPhoto ? `<img data-photo="${m.id}" alt="" onclick="viewPhoto(this)">` : ''}
      <div class="body"><div class="title">${esc(m.title)}</div>
      ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
      <div class="foot"><span class="muted small">${fmtDate(parseDate(m.date))} · ${esc(nameOf(m.by))}</span>
      <button class="del" onclick="delMoment('${m.id}')">✕</button></div></div></div>`;
  }
  $('momentsList').innerHTML = html;
  loadPhotos($('momentsList'));
}
let pendingPhoto = null;
function openMoment() {
  pendingPhoto = null;
  $('momentTitle').value = ''; $('momentNote').value = ''; $('momentDate').value = todayKey();
  $('photoPick').querySelector('img')?.remove();
  $('photoPick').querySelectorAll('span').forEach(s => s.hidden = false);
  openModal('momentModal');
}
function closeMoment() { pendingPhoto = null; closeModal('momentModal'); }

// Reduce la foto para que quepa en el plan gratis (máx. ~700 KB por foto).
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    let max = 1280, q = 0.8, out;
    do {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (q > 0.5) q -= 0.1; else max = Math.round(max * 0.8);
    } while (out.length > 700000 && max > 300);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
async function pickPhoto(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  const btn = $('momentSave'); btn.disabled = true; btn.textContent = 'Preparando foto…';
  try {
    pendingPhoto = await compressImage(f);
    const box = $('photoPick');
    box.querySelectorAll('span').forEach(s => s.hidden = true);
    box.querySelector('img')?.remove();
    const img = document.createElement('img'); img.src = pendingPhoto; box.prepend(img);
  } catch { toast('No se pudo leer esa foto'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar momento'; }
}
function saveMoment() {
  const title = $('momentTitle').value.trim(), date = $('momentDate').value;
  if (!title || !date) return toast('Pon qué pasó y la fecha');
  const r = newRef('moments');
  const batch = writeBatch(db);
  if (pendingPhoto) batch.set(ref('photos', r.id), { data: pendingPhoto });
  batch.set(r, { title, date, note: $('momentNote').value.trim(), hasPhoto: !!pendingPhoto, by: me.uid, createdAt: Date.now() });
  if (pendingPhoto) photoCache[r.id] = Promise.resolve(pendingPhoto);
  write(batch.commit());
  closeMoment(); toast('Momento guardado 📸');
}
function delMoment(id) {
  if (!confirm('¿Borrar este momento para los dos?')) return;
  const batch = writeBatch(db);
  batch.delete(ref('moments', id)); batch.delete(ref('photos', id));
  write(batch.commit());
}
function viewPhoto(img) { $('viewerImg').src = img.src; $('viewer').classList.add('show'); }

// Actualiza fechas y pregunta si la app queda abierta pasada la medianoche
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) { renderHome(); renderQuestion(); renderMemory(); } });

// Funciones que usan los botones del HTML
Object.assign(window, {
  login, resetPass, logout, openSettings, saveSettings, closeModal, openModal, delIdea, exportData, importData,
  spin, ideaToBucket, addIdea, addBucket, toggleBucket, delBucket, drawNote, addNote, delNote,
  openFechas, addFecha, delFecha, answerQuestion, openAnswers,
  selectList, setMode, createFromTemplate, createList, delList, addOption, delOption,
  decideRandom, eliminate, restartTurns, vote, resetVotes, decideAmong,
  useCouponTpl, addCoupon, redeemCoupon, fulfillCoupon, delCoupon,
  openMoment, closeMoment, pickPhoto, saveMoment, delMoment, viewPhoto,
});
