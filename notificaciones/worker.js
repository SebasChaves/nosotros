// Futari · servicio de notificaciones (Cloudflare Worker).
// Recibe de la app "avísale a estos teléfonos" y entrega la notificación con Web Push estándar (VAPID + cifrado
// aes128gcm, RFC 8291/8292). No guarda nada: los teléfonos a los que avisar los manda la app en cada pedido.
// Solo acepta pedidos con una sesión válida de Firebase de una de las cuentas en ALLOWED_UIDS.
//
// Variables del Worker (Cloudflare → Worker → Settings → Variables and Secrets):
//   VAPID_PUBLIC_KEY   (texto)   llave pública, la misma que usa la app (push-config.js)
//   VAPID_PRIVATE_KEY  (secreto) llave privada; se genera con notificaciones/llaves.html
//   FIREBASE_PROJECT_ID (texto)  id del proyecto de Firebase (está en firebase-config.js)
//   ALLOWED_UIDS       (texto)   los dos uid de la pareja, separados por coma
//   ALLOWED_ORIGINS    (texto, opcional) por defecto https://sebaschaves.github.io
//   VAPID_SUBJECT      (texto, opcional) por defecto https://sebaschaves.github.io/nosotros/
// Avisos programados (Cron Trigger "* * * * *", cada minuto):
//   FIREBASE_SA        (secreto) el JSON de una cuenta de servicio de SOLO LECTURA (rol "Cloud Datastore Viewer")
//   TIME_ZONE          (texto, opcional) por defecto America/Costa_Rica
//   COUPLE_ID          (texto, opcional) por defecto nosotros
// Ver docs/NOTIFICACIONES.md. Sin dependencias: se pega tal cual en el editor de Cloudflare.

const WORKER_VERSION = 3; // súbelo al cambiar este archivo (la app lo muestra en el diagnóstico)
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export default {
  async fetch(req, env) {
    const origins = (env.ALLOWED_ORIGINS || 'https://sebaschaves.github.io').split(',').map(s => s.trim());
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (req.method === 'GET') return json({ ok: true, service: 'futari-push', version: WORKER_VERSION, ready: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.FIREBASE_PROJECT_ID && env.ALLOWED_UIDS), scheduled: !!env.FIREBASE_SA });
    if (req.method !== 'POST' || !['/notify', '/diagnostico'].includes(url.pathname)) return json({ error: 'not-found' }, 404);

    // 1. ¿Quién pide? Sesión de Firebase válida y de la pareja
    let who;
    try { who = await verifyFirebaseToken((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env); }
    catch (e) { return json({ error: 'auth', detail: String(e.message || e) }, 401); }
    const allowed = (env.ALLOWED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(who)) return json({ error: 'forbidden' }, 403);
    if (url.pathname === '/diagnostico') return json(await diagnose(env, who));

    // 2. Qué avisar y a qué teléfonos
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const subs = Array.isArray(body.subs) ? body.subs.slice(0, 10) : [];
    const msg = { title: String(body.title || 'Futari').slice(0, 120), body: String(body.body || '').slice(0, 300),
      url: String(body.url || './').slice(0, 200), tag: String(body.tag || '').slice(0, 60) };
    const payload = enc.encode(JSON.stringify(msg));

    // 3. Entregar a cada teléfono
    const results = await Promise.all(subs.map(async s => {
      try {
        if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return { endpoint: s?.endpoint, status: 0, error: 'bad-sub' };
        const res = await sendPush(s, payload, env, body.urgency === 'normal' ? 'normal' : 'high');
        return { endpoint: s.endpoint, status: res.status };
      } catch (e) { return { endpoint: s?.endpoint, status: 0, error: String(e.message || e) }; }
    }));
    return json({ results });
  },
  // Avisos programados: racha en peligro / mascota con hambre, recordatorios y fechas especiales
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, event.scheduledTime).catch(e => console.error('programados', e)));
  },
};

/* ---------- Sesión de Firebase (token de identidad, RS256) ---------- */
let jwksCache = null, jwksUntil = 0;
async function googleKeys(env) {
  if (env.JWKS_OVERRIDE) return JSON.parse(env.JWKS_OVERRIDE).keys; // solo para pruebas locales
  if (jwksCache && Date.now() < jwksUntil) return jwksCache;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('jwks ' + r.status);
  jwksCache = (await r.json()).keys; jwksUntil = Date.now() + 3600e3;
  return jwksCache;
}
async function verifyFirebaseToken(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token');
  const head = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
  if (head.alg !== 'RS256') throw new Error('alg');
  const jwk = (await googleKeys(env)).find(k => k.kid === head.kid);
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('firma');
  const now = Math.floor(Date.now() / 1000), pid = env.FIREBASE_PROJECT_ID;
  if (claims.aud !== pid || claims.iss !== 'https://securetoken.google.com/' + pid) throw new Error('proyecto');
  if (!(claims.exp > now - 60) || !(claims.iat < now + 300) || !claims.sub) throw new Error('vencido');
  return claims.sub;
}

/* ---------- Web Push ---------- */
async function sendPush(sub, payload, env, urgency) {
  const body = await encryptPayload(sub, payload);
  const aud = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(aud, env);
  return fetch(sub.endpoint, { method: 'POST', body, headers: {
    TTL: '86400', Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` } });
}
// Firma VAPID (RFC 8292): JWT ES256 con la llave privada del servicio
async function vapidJwt(aud, env) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://sebaschaves.github.io/nosotros/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims));
  return `${head}.${claims}.${b64u(sig)}`;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
// Cifrado del contenido (RFC 8291, aes128gcm). `fixed` solo se usa en pruebas para reproducir resultados.
export async function encryptPayload(sub, payload, fixed = {}) {
  const uaPub = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const local = fixed.keyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

/* ---------- Avisos programados ---------- */
// Corre cada minuto. Lee Firestore con una cuenta de servicio de solo lectura y decide qué avisar según la hora local:
//   al minuto exacto del recordatorio (o 8:00 si no tiene hora) los recordatorios de hoy
//   20:00 racha en peligro / mascota con hambre (a quien todavía no ha hecho nada hoy)
//   8:00 «Hoy es…» y 9:00 «Mañana es…» para fechas especiales, aniversarios y mesiversarios
// Para gastar pocas lecturas: cada minuto solo consulta los recordatorios de hoy; el resto se lee solo si hay algo que mandar.
// Devuelve la lista de avisos (sirve para las pruebas). La app usa la misma regla de racha que home.js.
export async function runSchedule(env, when = Date.now(), { dryRun = false } = {}) {
  if (!env.FIREBASE_SA) return [];
  const tz = env.TIME_ZONE || 'America/Costa_Rica';
  const local = d => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(p => [p.type, p.value]));
  const L = local(new Date(when)), hour = Number(L.hour), onTheHour = L.minute === '00', hhmm = `${L.hour}:${L.minute}`;
  const today = `${L.year}-${L.month}-${L.day}`;
  const shift = (key, n) => { const [y, m, d] = key.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
  const yesterday = shift(today, -1), tomorrow = shift(today, 1);
  const STREAK_HOUR = 20, TODAY_HOUR = 8, TOMORROW_HOUR = 9;

  const db = await firestoreReader(env);
  // Recordatorios de hoy que tocan en este minuto (los que no tienen hora, a las 8:00)
  const due = (await db.query('reminders', 'date', today)).filter(r => !r.done && (r.time ? String(r.time).slice(0, 5) === hhmm : onTheHour && hour === TODAY_HOUR));
  if (!due.length && !onTheHour) return [];
  const couple = await db.get('');
  if (!couple) return [];
  const members = Object.keys(couple.members || {}).filter(u => (env.ALLOWED_UIDS || '').split(',').map(x => x.trim()).includes(u));
  if (!members.length) return [];
  const [push, profiles] = await Promise.all([db.list('push'), db.list('profiles')]);
  const subsOf = u => Object.values(push.find(d => d.id === u)?.subs || {});
  const wants = (u, type) => profiles.find(d => d.id === u)?.prefs?.notif?.[type] !== false;
  const nameFor = (to, who) => profiles.find(d => d.id === to)?.prefs?.partnerNick || couple.members[who]?.name || 'Tu pareja';
  const out = [];
  const add = (to, type, msg) => { if (subsOf(to).length && wants(to, type)) out.push({ to, type, ...msg }); };

  // 1. Racha en peligro / mascota con hambre
  if (onTheHour && hour === STREAK_HOUR && members.length === 2) {
    // Los docs de cada día tienen como id la fecha: se piden por bloques de 30 días hacia atrás mientras siga la racha
    const COLS = ['moods', 'answers', 'thinks', 'daily', 'activity'], days = {};
    const load = async keys => {
      const docs = await db.getMany(keys.flatMap(k => COLS.map(c => `${c}/${k}`)));
      for (const [path, d] of Object.entries(docs)) { const [c, k] = path.split('/'); (days[k] ||= {})[c] = d; }
    };
    const did = (k, u) => { const x = days[k] || {}; return !!(x.moods?.[u] || x.answers?.answers?.[u] || x.thinks?.[u] || x.daily?.[u] || x.activity?.[u]); };
    const both = k => members.every(u => did(k, u));
    await load([today, ...Array.from({ length: 30 }, (_, i) => shift(yesterday, -i))]);
    let streak = 0, k = yesterday;
    while (streak < 3660) {
      if (!(k in days) && !days[k]) { await load(Array.from({ length: 30 }, (_, i) => shift(k, -i))); days[k] ||= {}; }
      if (!both(k)) break;
      streak++; k = shift(k, -1);
    }
    const pet = await db.get('pet/main');
    const species = { '🐱': 'gatito', '🐶': 'perrito', '🐰': 'conejito', '🦊': 'zorrito', '🐼': 'panda', '🐧': 'pingüino', '🐻': 'osito', '🐨': 'koala', '🐹': 'hámster', '🦦': 'nutria' };
    const petName = pet ? (!pet.hatchedAt ? 'El huevo' : pet.name || `Su ${species[pet.species] || 'mascota'}`) : '';
    for (const u of members) {
      if (did(today, u)) continue;
      const other = members.find(x => x !== u), otherDid = did(today, other);
      if (!streak && !pet) continue; // no hay nada en juego
      const title = pet ? `${pet.hatchedAt ? pet.species : '🥚'} ${petName} tiene hambre` : `🔥 Su racha de ${streak} ${streak === 1 ? 'día' : 'días'} se acaba hoy`;
      const parts = [];
      if (pet && streak) parts.push(`Llevan ${streak} ${streak === 1 ? 'día' : 'días'} seguidos.`);
      parts.push(otherDid ? `${nameFor(u, other)} ya hizo lo suyo; solo faltas tú.` : 'Hagan algo hoy en Futari: un corazón, su ánimo o una instantánea.');
      add(u, 'streak', { title, body: parts.join(' '), url: './?open=pet', tag: 'streak' });
    }
  }

  // 2. Recordatorios de hoy, al minuto exacto
  for (const r of due) {
    const to = !r.for || r.for === 'ambos' ? members : members.filter(u => u === r.for);
    for (const u of to) add(u, 'reminders', { title: `${r.urgent ? '🔴' : '🔔'} ${r.text}`, body: [r.time, r.note].filter(Boolean).join(' · ') || 'Recordatorio de hoy', url: './?open=reminders', tag: 'rem-' + r.id });
  }

  // 3. Fechas especiales, aniversarios y mesiversarios: hoy (8:00) y mañana (9:00)
  if (onTheHour && (hour === TODAY_HOUR || hour === TOMORROW_HOUR)) {
    const day = hour === TODAY_HOUR ? today : tomorrow, word = hour === TODAY_HOUR ? 'Hoy' : 'Mañana';
    const [y, m, d] = day.split('-').map(Number);
    const items = [];
    for (const f of await db.list('dates')) {
      if (!f.date) continue;
      const [fy, fm, fd] = f.date.split('-').map(Number);
      const hit = f.yearly ? fm === m && fd === d && y >= fy : f.date === day;
      if (!hit) continue;
      const years = y - fy;
      const extra = f.yearly && years > 0 ? (f.emoji === '🎂' ? ` (cumple ${years})` : f.emoji === '💍' ? ` (${years} ${years === 1 ? 'año' : 'años'})` : '') : '';
      items.push(`${f.emoji || '📌'} ${f.title}${extra}`);
    }
    if (couple.start) {
      const [sy, sm, sd] = couple.start.split('-').map(Number);
      const months = (y - sy) * 12 + (m - sm);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (months > 0 && Math.min(sd, lastDay) === d) items.push(months % 12 === 0 ? `💍 su aniversario #${months / 12}` : `🗓️ su mesiversario #${months}`);
    }
    for (const it of items) for (const u of members) add(u, 'dates', { title: `${word} es ${it}`, body: word === 'Mañana' ? '¿Ya tienen algo preparado? 💝' : '¡Que sea un gran día! 🎉', url: './?open=cal', tag: `date-${day}-${it}`.slice(0, 60) });
  }

  if (!dryRun) {
    await Promise.all(out.map(async n => {
      const payload = enc.encode(JSON.stringify({ title: n.title.slice(0, 120), body: n.body.slice(0, 300), url: n.url, tag: n.tag.slice(0, 60) }));
      await Promise.all(subsOf(n.to).map(s => sendPush(s, payload, env, 'normal').catch(e => console.error('push', e))));
    }));
  }
  return out;
}

// Diagnóstico (Ajustes → Notificaciones → «Revisar avisos programados»): hace lo mismo que el Cron —leer la base con la
// cuenta de servicio y mandar un aviso a los teléfonos guardados— y cuenta qué vio, para encontrar qué falla.
async function diagnose(env, who) {
  const tz = env.TIME_ZONE || 'America/Costa_Rica';
  const L = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  const today = `${L.year}-${L.month}-${L.day}`;
  const r = { version: WORKER_VERSION, zone: tz, now: `${today} ${L.hour}:${L.minute}`, hasSA: !!env.FIREBASE_SA, steps: {} };
  if (!env.FIREBASE_SA) return r;
  let db;
  try { db = await firestoreReader(env); r.steps.token = 'ok'; } catch (e) { r.steps.token = String(e.message || e).slice(0, 300); return r; }
  try {
    const couple = await db.get('');
    r.steps.read = couple ? 'ok' : 'sin datos de la pareja';
    r.members = Object.keys(couple?.members || {}).map(u => ({ allowed: (env.ALLOWED_UIDS || '').split(',').map(x => x.trim()).includes(u), me: u === who }));
  } catch (e) { r.steps.read = String(e.message || e).slice(0, 300); return r; }
  try {
    const rem = await db.query('reminders', 'date', today);
    r.steps.query = 'ok';
    r.remindersToday = rem.map(x => ({ text: String(x.text || '').slice(0, 40), time: x.time || '', for: !x.for || x.for === 'ambos' ? 'ambos' : x.for === who ? 'yo' : 'pareja', done: !!x.done }));
  } catch (e) { r.steps.query = String(e.message || e).slice(0, 300); }
  try {
    const mine = Object.values((await db.get('push/' + who))?.subs || {});
    r.devices = mine.length;
    const payload = enc.encode(JSON.stringify({ title: 'Futari ⏰', body: 'Prueba de avisos programados: si ves esto, los recordatorios pueden llegarte.', url: './', tag: 'prueba-programados' }));
    const sent = await Promise.all(mine.map(s => sendPush(s, payload, env, 'high').then(x => x.status).catch(e => String(e.message || e).slice(0, 80))));
    r.steps.push = sent.length ? sent.join(', ') : 'sin teléfonos';
  } catch (e) { r.steps.push = String(e.message || e).slice(0, 300); }
  return r;
}

// Lector de Firestore con la cuenta de servicio (token OAuth de Google firmado con su llave privada)
let saToken = null, saTokenUntil = 0;
async function firestoreReader(env) {
  if (env.TEST_FIRESTORE) return restReader(`${env.TEST_FIRESTORE}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/couples/${env.COUPLE_ID || 'nosotros'}`, { Authorization: 'Bearer owner' }); // solo pruebas con el emulador
  const sa = typeof env.FIREBASE_SA === 'string' ? JSON.parse(env.FIREBASE_SA) : env.FIREBASE_SA;
  const reader = token => restReader(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID || sa.project_id}/databases/(default)/documents/couples/${env.COUPLE_ID || 'nosotros'}`,
    { Authorization: 'Bearer ' + token });
  if (saToken && Date.now() < saTokenUntil) return reader(saToken); // el token de Google dura 1 hora
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claims)));
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claims}.${sig}` });
  if (!tr.ok) throw new Error('token ' + tr.status + ' ' + await tr.text());
  const { access_token } = await tr.json();
  saToken = access_token; saTokenUntil = Date.now() + 50 * 60e3;
  return reader(access_token);
}
function restReader(base, auth) {
  const docOf = d => ({ id: d.name.split('/').pop(), ...fields(d.fields || {}) });
  const root = base.slice(0, base.indexOf('/documents/') + '/documents'.length), prefix = base.slice(base.indexOf('/projects/') + 1);
  return {
    // Documentos de una colección con campo == valor (solo se cobran los que coinciden)
    async query(col, field, eq) {
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: eq } } } } }) });
      if (!r.ok) throw new Error('query ' + col + ' ' + r.status + ' ' + await r.text());
      return (await r.json()).filter(x => x.document).map(x => docOf(x.document));
    },
    // Varios documentos de una vez: { 'moods/2026-11-12': {...} } (los que no existen no aparecen)
    async getMany(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 300) {
        const r = await fetch(root + ':batchGet', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ documents: paths.slice(i, i + 300).map(p => `${prefix}/${p}`) }) });
        if (!r.ok) throw new Error('batchGet ' + r.status + ' ' + await r.text());
        for (const x of await r.json()) if (x.found) out[x.found.name.slice(x.found.name.indexOf(prefix) + prefix.length + 1)] = fields(x.found.fields || {});
      }
      return out;
    },
    async get(path) {
      const r = await fetch(base + (path ? '/' + path : ''), { headers: auth });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('get ' + path + ' ' + r.status);
      return docOf(await r.json());
    },
    async list(col, { pageSize = 300 } = {}) {
      const r = await fetch(`${base}/${col}?pageSize=${pageSize}`, { headers: auth });
      if (!r.ok) throw new Error('list ' + col + ' ' + r.status);
      return ((await r.json()).documents || []).map(docOf);
    },
  };
}
// Valores de Firestore (REST) → objetos normales
function value(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value);
  return null;
}
function fields(f) { return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, value(v)])); }
