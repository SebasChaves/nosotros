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
// Respaldo automático (v11): un espacio KV conectado con el nombre RESPALDOS (Settings → Bindings → KV namespace).
//   Cada noche de 3:00 a 6:00 copia la base (una colección por minuto) y las fotos nuevas. Ver docs/NOTIFICACIONES.md.
// Ver docs/NOTIFICACIONES.md. Sin dependencias: se pega tal cual en el editor de Cloudflare.

const WORKER_VERSION = 14; // súbelo al cambiar este archivo (la app lo muestra en el diagnóstico)
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
    if (req.method !== 'POST' || !['/notify', '/diagnostico', '/link', '/chef', '/respaldo'].includes(url.pathname)) return json({ error: 'not-found' }, 404);

    // 1. ¿Quién pide? Sesión de Firebase válida y de la pareja
    let who;
    try { who = await verifyFirebaseToken((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env); }
    catch (e) { return json({ error: 'auth', detail: String(e.message || e) }, 401); }
    const allowed = (env.ALLOWED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(who)) return json({ error: 'forbidden' }, 403);
    if (url.pathname === '/diagnostico') return json(await diagnose(env, who));
    if (url.pathname === '/respaldo') { // respaldos automáticos (lista o descargar uno)
      if (!env.RESPALDOS) return json({ error: 'no-kv' }, 501);
      let b4; try { b4 = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
      try { // si algo falla, responder con el motivo (y con CORS) para que la app lo muestre
        if (b4.action === 'get') return backupDownload(env, String(b4.day || ''), !!b4.photos, cors);
        if (b4.action === 'start') return json(await backupStart(env)); // «Respaldar ahora» (Ajustes): la app pide los pasos uno por uno
        if (b4.action === 'step') return json(await backupStep(env, Date.now(), { manual: true }) || { phase: 'done' });
        return json(await backupList(env));
      } catch (e) { console.error('respaldo', e); return json({ error: 'fail', detail: String(e.message || e).slice(0, 200) }, 500); }
    }
    if (url.pathname === '/chef') { // «Pregúntale al chef» (recipes.js): arma una receta con IA
      let b3; try { b3 = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
      try { return json(await chef(env, b3)); }
      catch (e) { const m = String(e.message || e); return json({ error: m.startsWith('no-ai') ? 'no-ai' : /limit|429|quota|neurons/i.test(m) ? 'limit' : 'ai', detail: m.slice(0, 300) }, m.startsWith('no-ai') ? 501 : 502); }
    }
    if (url.pathname === '/link') { // abre un enlace corto de Google Maps (maps.app.goo.gl) y devuelve a dónde lleva
      let b2; try { b2 = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
      return json({ url: await resolveMapLink(String(b2.url || '')) });
    }

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
    if (env.RESPALDOS && env.FIREBASE_SA) ctx.waitUntil(backupStep(env, event.scheduledTime).catch(e => console.error('respaldo', e)));
  },
};

/* ---------- Respaldo automático (KV «RESPALDOS») ----------
   Cada minuto entre las 3:00 y las 5:59 (hora local) se hace un paso chico (el plan gratis da 10 ms de CPU por vez):
   1. Una colección por minuto → KV «d:<día>:<colección>» (JSON). Al terminar: «d:<día>:_meta» y se borran los días viejos
      (quedan los últimos 7 y los domingos del último mes).
   2. Después, fotos nuevas: se listan los ids (sin bajar las fotos) y se copian las que falten, ~8 por minuto y hasta
      600 por noche (límite de escrituras de KV: 1000 al día). «p:<id>» = {"id","data"}; «photos-index» = ids ya copiados.
   No se respaldan: «push» (direcciones de los teléfonos), lo privado de cada uno ni las cartas «Solo nosotros». */
const BACKUP_COLS = ['bucket', 'ideas', 'notes', 'coupons', 'dates', 'moments', 'lists', 'answers', 'moods', 'challenges', 'groceries', 'expenses', 'places',
  'trips', 'quiz', 'profiles', 'shows', 'events', 'cards', 'games', 'thinks', 'daily', 'pins', 'recipes', 'recipefav', 'menu', 'songs', 'reminders', 'snaps',
  'activity', 'pet', 'guess', 'cravings', 'arrows', 'bus', 'money', 'cooked', 'dreams', 'vacations', 'fruta'];
const kvJSON = async (env, k, d = null) => { const v = await env.RESPALDOS.get(k); return v ? JSON.parse(v) : d; };
// KV deja escribir la misma clave como máximo una vez por segundo: si choca (429), espera y reintenta
const kvPut = async (env, k, v, o) => { for (let i = 0; ; i++) { try { return await env.RESPALDOS.put(k, v, o); } catch (e) { if (i >= 3 || !/429|too many/i.test(String(e.message || e))) throw e; await new Promise(r => setTimeout(r, 1100)); } } };
async function listAll(env, db, col, mask) {
  const out = []; let token = '';
  const base = db.base;
  do {
    const r = await fetch(`${base}/${col}?pageSize=300${mask ? '&mask.fieldPaths=__nada' : ''}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: db.auth });
    if (!r.ok) throw new Error('list ' + col + ' ' + r.status);
    const j = await r.json();
    for (const d of j.documents || []) out.push(mask ? d.name.split('/').pop() : { id: d.name.split('/').pop(), ...fields(d.fields || {}) });
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
export async function backupStep(env, when = Date.now(), { manual = false } = {}) {
  const tz = env.TIME_ZONE || 'America/Costa_Rica';
  const L = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(when)).map(p => [p.type, p.value]));
  const hour = Number(L.hour), day = `${L.year}-${L.month}-${L.day}`;
  if (!manual && !env.BACKUP_ANYTIME && (hour < 3 || hour > 5)) return null;
  const st = await kvJSON(env, 'state', {});
  const db = await firestoreReader(env);
  if (st.day !== day) { st.day = day; st.idx = 0; st.dataDone = false; st.nightPhotos = 0; }
  if (!st.dataDone) {
    if (st.idx === 0) { const c = await db.get(''); await kvPut(env, `d:${day}:_couple`, JSON.stringify({ start: c?.start || '', currency: c?.currency || '', members: c?.members || {} })); }
    const col = BACKUP_COLS[st.idx];
    let docs = await listAll(env, db, col);
    if (col === 'cards') docs = docs.filter(x => x.level !== 'ours');
    await kvPut(env, `d:${day}:${col}`, JSON.stringify(docs));
    (st.counts ||= {})[col] = docs.length;
    st.idx++;
    if (st.idx >= BACKUP_COLS.length) {
      st.dataDone = true; st.lastAt = Date.now();
      await kvPut(env, `d:${day}:_meta`, JSON.stringify({ day, at: st.lastAt, counts: st.counts }));
      const days = [...new Set([...(await kvJSON(env, 'days', [])), day])].sort();
      const keep = days.filter((d, i) => i >= days.length - 7 || (new Date(d + 'T12:00').getDay() === 0 && (Date.parse(day) - Date.parse(d)) < 31 * 864e5));
      for (const old of days.filter(d => !keep.includes(d))) for (const c of ['_couple', '_meta', ...BACKUP_COLS]) await env.RESPALDOS.delete(`d:${old}:${c}`);
      await kvPut(env, 'days', JSON.stringify(keep));
      st.counts = {};
    }
    await kvPut(env, 'state', JSON.stringify(st));
    return { phase: 'data', step: col, idx: st.idx, total: BACKUP_COLS.length };
  }
  // Fotos: se copian solo las nuevas (las que ya están en KV no se vuelven a leer)
  if (st.nightPhotos >= 600 || st.photosDoneDay === day) return null; // ya se revisaron las fotos esta noche
  if (manual && st.manualPhotos >= 120) return null; // con el botón, pocas fotos: las demás siguen en la noche
  const index = new Set(await kvJSON(env, 'photos-index', []));
  let ids = await kvJSON(env, 'photo-todo', null);
  if (!ids) ids = (await listAll(env, db, 'photos', true)).filter(id => !index.has(id));
  if (!ids.length) { if (st.photosDoneDay !== day) { st.photosDoneDay = day; await kvPut(env, 'state', JSON.stringify(st)); } return null; }
  const batch = ids.splice(0, 8);
  for (const id of batch) {
    const d = await db.get('photos/' + id); if (!d?.data) continue;
    await kvPut(env, 'p:' + id, JSON.stringify({ id, data: d.data })); index.add(id); st.nightPhotos++;
  }
  await kvPut(env, 'photos-index', JSON.stringify([...index]));
  await kvPut(env, 'photo-todo', JSON.stringify(ids.length ? ids : []));
  if (!ids.length) await env.RESPALDOS.delete('photo-todo');
  if (manual) st.manualPhotos = (st.manualPhotos || 0) + batch.length;
  await kvPut(env, 'state', JSON.stringify(st));
  return { phase: 'photos', copied: batch.length, left: ids.length };
}
// «Respaldar ahora»: vuelve a empezar el respaldo de hoy (como máximo 4 veces al día, por el límite gratis de escrituras)
export async function backupStart(env) {
  const tz = env.TIME_ZONE || 'America/Costa_Rica';
  const L = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const day = `${L.year}-${L.month}-${L.day}`, st = await kvJSON(env, 'state', {});
  const manualToday = st.day === day ? (st.manualRuns || 0) : 0;
  if (manualToday >= 4) return { error: 'limit' };
  const next = { day, idx: 0, dataDone: false, counts: {}, nightPhotos: st.day === day ? st.nightPhotos || 0 : 0, photosDoneDay: null, manualRuns: manualToday + 1, manualPhotos: 0, lastAt: st.lastAt };
  await kvPut(env, 'state', JSON.stringify(next));
  return { ok: true, total: BACKUP_COLS.length };
}
async function backupList(env) {
  const days = await kvJSON(env, 'days', []), st = await kvJSON(env, 'state', {}), metas = [];
  for (const d of [...days].reverse()) { const m = await kvJSON(env, `d:${d}:_meta`); if (m) metas.push(m); }
  return { ok: true, days: metas, photos: (await kvJSON(env, 'photos-index', [])).length, pendingPhotos: (await kvJSON(env, 'photo-todo', [])).length, state: { day: st.day, idx: st.idx, total: BACKUP_COLS.length, dataDone: st.dataDone } };
}
// Descarga en el mismo formato que «Descargar» de Ajustes (versión 5), armado sin volver a leer Firebase y en partes
export function backupDownload(env, day, withPhotos, cors) {
  const { readable, writable } = new TransformStream(), w = writable.getWriter(), put = s => w.write(enc.encode(s));
  (async () => {
    try {
      const c = await kvJSON(env, `d:${day}:_couple`, {});
      await put(`{"version":5,"auto":${JSON.stringify(day)},"start":${JSON.stringify(c.start || '')},"currency":${JSON.stringify(c.currency || '')},"members":${JSON.stringify(c.members || {})}`);
      for (const col of BACKUP_COLS) { const v = await env.RESPALDOS.get(`d:${day}:${col}`); await put(`,${JSON.stringify(col)}:${v || '[]'}`); }
      if (withPhotos) {
        await put(',"photos":[');
        const ids = await kvJSON(env, 'photos-index', []); let first = true;
        for (const id of ids) { const v = await env.RESPALDOS.get('p:' + id); if (!v) continue; await put((first ? '' : ',') + v); first = false; }
        await put(']');
      }
      await put('}');
    } catch (e) { console.error('descarga', e); }
    await w.close();
  })();
  return new Response(readable, { headers: { ...cors, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="futari-respaldo-${day}.json"` } });
}

/* ---------- Chef con IA ----------
   Usa Claude si hay un secreto ANTHROPIC_API_KEY; si no, Workers AI (binding «AI», gratis con límite diario).
   Devuelve { recipe: { name, emoji, min, servings, ingredients[], steps[], tips }, engine }. No guarda nada. */
const RECIPE_SCHEMA = { type: 'object', additionalProperties: false, required: ['name', 'emoji', 'min', 'servings', 'ingredients', 'steps', 'tips'],
  properties: { name: { type: 'string' }, emoji: { type: 'string' }, min: { type: 'integer' }, servings: { type: 'integer' },
    ingredients: { type: 'array', items: { type: 'string' } }, steps: { type: 'array', items: { type: 'string' } }, tips: { type: 'string' } } };
const CHEF_SYSTEM = `Eres un chef de cocina casera para una pareja en Costa Rica. Escribe en español claro de Costa Rica.
Devuelve una sola receta realista y que funcione, con:
- name: nombre corto del plato
- emoji: un emoji de comida
- min: minutos totales aproximados
- servings: porciones
- ingredients: cada ingrediente con su cantidad en unidades caseras o métricas (ej. «250 g de pasta», «1 taza de leche», «2 dientes de ajo»)
- steps: pasos cortos en orden, con tiempos y temperaturas concretos cuando importan (ej. «Sella el ribeye 3 minutos por lado a fuego alto»)
- tips: un consejo corto (o cadena vacía)
Usa ingredientes que se consiguen en un supermercado de Costa Rica. Si piden algo peligroso o que no es comida, devuelve una receta sencilla de lo más cercano que sí sea comida.`;
function chefPrompt(b) {
  const ask = String(b.ask || '').slice(0, 400), parts = [];
  if (b.base && b.change) parts.push(`Esta es la receta actual (JSON): ${JSON.stringify(b.base).slice(0, 4000)}\nCámbiala así: ${String(b.change).slice(0, 300)}`);
  else parts.push(`Quiero cocinar: ${ask}`);
  if (b.pantry) parts.push(`En la casa tenemos: ${String(b.pantry).slice(0, 400)}. Úsalo si sirve.`);
  if (b.servings) parts.push(`Para ${Number(b.servings) || 2} porciones.`);
  return parts.join('\n');
}
function cleanRecipe(r) {
  if (!r || typeof r !== 'object') throw new Error('bad-recipe');
  const list = (a, n) => (Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(Boolean).slice(0, n);
  const out = { name: String(r.name || 'Receta').slice(0, 80), emoji: String(r.emoji || '🍽️').slice(0, 4), min: Math.min(600, Math.max(1, parseInt(r.min) || 30)),
    servings: Math.min(20, Math.max(1, parseInt(r.servings) || 2)), ingredients: list(r.ingredients, 30), steps: list(r.steps, 25), tips: String(r.tips || '').slice(0, 300) };
  if (!out.ingredients.length || !out.steps.length) throw new Error('bad-recipe');
  return out;
}
const firstJson = t => { const s = String(t || ''), a = s.indexOf('{'), z = s.lastIndexOf('}'); if (a < 0 || z <= a) throw new Error('bad-recipe'); return JSON.parse(s.slice(a, z + 1)); };
async function chef(env, b) {
  const user = chefPrompt(b);
  if (env.ANTHROPIC_API_KEY) {
    // Claude (raw HTTP: el editor de Cloudflare no instala paquetes). Salida estructurada con el esquema de la receta.
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({ model: env.CHEF_MODEL || 'claude-opus-5-5', max_tokens: 8000, fallbacks: 'default', system: CHEF_SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPE_SCHEMA } }, messages: [{ role: 'user', content: user }] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`claude ${r.status} ${d?.error?.message || ''}`);
    if (d.stop_reason === 'refusal') throw new Error('refusal');
    const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return { recipe: cleanRecipe(firstJson(text)), engine: 'claude' };
  }
  if (!env.AI) throw new Error('no-ai: falta el binding «AI» (Workers AI) en Cloudflare');
  const model = env.CHEF_CF_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const res = await env.AI.run(model, { max_tokens: 1800,
    messages: [{ role: 'system', content: CHEF_SYSTEM + '\nResponde SOLO con un objeto JSON con las claves name, emoji, min, servings, ingredients, steps, tips. Sin texto antes ni después.' }, { role: 'user', content: user }] });
  const raw = res?.response ?? res;
  return { recipe: cleanRecipe(typeof raw === 'object' ? raw : firstJson(raw)), engine: 'workers-ai' };
}

/* ---------- Enlaces de mapas ---------- */
// Solo sigue redirecciones de dominios de Google Maps / Waze (no es un abridor de enlaces cualquiera).
const MAP_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|consent\.google\.[a-z.]+|(www\.|ul\.)?waze\.com)$/i;
async function resolveMapLink(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  for (let i = 0; i < 6; i++) {
    if (!MAP_HOSTS.test(u.hostname) || u.protocol !== 'https:') return null;
    if (/^consent\./i.test(u.hostname) && u.searchParams.get('continue')) { u = new URL(u.searchParams.get('continue')); continue; }
    if (/[@!]3d|@-?\d+\.\d+,-?\d+\.\d+|[?&](q|ll|query)=-?\d/.test(decodeURIComponent(u.href))) return u.href;
    const r = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'Accept-Language': 'es' } });
    const loc = r.headers.get('Location');
    if (!loc) return u.href;
    u = new URL(loc, u);
  }
  return u.href;
}

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
// Minutos «locales» (fecha y hora de Costa Rica tratadas como UTC): sirven para restar y comparar
const localMin = (key, t) => { const [y, m, d] = key.split('-').map(Number), [h, mi] = String(t).slice(0, 5).split(':').map(Number); return Date.UTC(y, m - 1, d, h || 0, mi || 0) / 60000; };
// Igual que occursOn de calendar.js: ¿el plan (o una de sus repeticiones) cae ese día?
export function evOccurs(ev, key) {
  if (ev.date === key) return true;
  if (!ev.repeat || ev.repeat === 'none' || key < ev.date || (ev.until && key > ev.until)) return false;
  const a = new Date(ev.date + 'T12:00Z'), d = new Date(key + 'T12:00Z');
  if (ev.repeat === 'weekly') return a.getUTCDay() === d.getUTCDay();
  if (ev.repeat === 'biweekly') return Math.round((d - a) / 864e5) % 14 === 0;
  if (ev.repeat === 'monthly') return a.getUTCDate() === d.getUTCDate();
  if (ev.repeat === 'yearly') return a.getUTCMonth() === d.getUTCMonth() && a.getUTCDate() === d.getUTCDate();
  return false;
}
// Corre cada minuto. Lee Firestore con una cuenta de servicio de solo lectura y decide qué avisar según la hora local:
//   al minuto exacto del recordatorio (o 8:00 si no tiene hora) los recordatorios de hoy
//   planes del calendario: X minutos antes (remind), o 8:00 / la víspera 9:00 si no tienen hora
//   20:00 racha en peligro / mascota con hambre (a quien todavía no ha hecho nada hoy)
//   8:00 «Hoy es…» y 9:00 «Mañana es…» para fechas especiales, aniversarios y mesiversarios
//   domingo 19:00 resumen de la semana (lunes a domingo), como el de week.js en la app
//   al minuto exacto las notas del frasco programadas (showDay/showTime)
//   domingo 19:30 resumen de gastos de la semana (gustos vs. presupuesto y vs. la semana pasada), como el de money.js
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
  const STREAK_HOUR = 20, TODAY_HOUR = 8, TOMORROW_HOUR = 9, WEEK_HOUR = 19;
  const weekday = new Date(Date.UTC(...today.split('-').map((x, i) => i === 1 ? x - 1 : +x))).getUTCDay(); // 0 = domingo

  const db = await firestoreReader(env);
  // Recordatorios de hoy que tocan en este minuto (los que no tienen hora, a las 8:00)
  const due = (await db.query('reminders', 'date', today)).filter(r => !r.done && (r.time ? String(r.time).slice(0, 5) === hhmm : onTheHour && hour === TODAY_HOUR));
  const moneyTime = weekday === 0 && hour === WEEK_HOUR && L.minute === '30';
  // Notas del frasco programadas para este minuto (love.js: showDay / showTime)
  const notesDue = (await db.query('notes', 'showDay', today)).filter(n => !n.readAt && String(n.showTime || '08:00').slice(0, 5) === hhmm);
  // Planes del calendario (calendar.js, campo remind = minutos antes, 'none' o nada = 60). Para no leer `events` cada minuto,
  // en punto se calcula qué avisos caen en la próxima hora y se guardan en KV (cal:<día>T<hora>); cada minuto se lee esa
  // lista (KV, gratis) y se manda lo de ese minuto. Sin KV, se mandan todos en punto (hasta 59 minutos antes de tiempo).
  const calKey = `cal:${today}T${L.hour}`, kv = !!env.RESPALDOS;
  let calDue = [];
  if (onTheHour) {
    const nowMin = localMin(today, hhmm), plan = [];
    for (const ev of await db.list('events')) {
      if (ev.remind === 'none' || !ev.date || !ev.title) continue;
      for (const k of [today, tomorrow, shift(today, 2)]) {
        if (!evOccurs(ev, k)) continue;
        const at = ev.time ? localMin(k, ev.time) - Number(ev.remind ?? 60) : ev.remind === '1440' ? localMin(shift(k, -1), '09:00') : localMin(k, '08:00');
        if (at >= nowMin && at < nowMin + 60) plan.push({ m: at - nowMin, id: ev.id, day: k, title: ev.title, time: ev.time || '', who: ev.who || 'ambos', note: ev.note || '', remind: ev.remind ?? '60' });
      }
    }
    if (kv && plan.some(p => p.m > 0)) await kvPut(env, calKey, JSON.stringify(plan), { expirationTtl: 7200 });
    calDue = kv ? plan.filter(p => p.m === 0) : plan;
  } else if (kv) calDue = (await kvJSON(env, calKey, [])).filter(p => p.m === Number(L.minute));
  if (!due.length && !notesDue.length && !onTheHour && !moneyTime && !calDue.length) return [];
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
      parts.push(otherDid ? `${nameFor(u, other)} ya hizo lo suyo; solo faltas tú.` : 'Hagan algo hoy en Futari: un corazón, su ánimo o una historia.');
      add(u, 'streak', { title, body: parts.join(' '), url: './?open=pet', tag: 'streak' });
    }
  }

  // 2. Recordatorios de hoy, al minuto exacto
  for (const r of due) {
    const to = !r.for || r.for === 'ambos' ? members : members.filter(u => u === r.for);
    for (const u of to) add(u, 'reminders', { title: `${r.urgent ? '🔴' : '🔔'} ${r.text}`, body: [r.time, r.note].filter(Boolean).join(' · ') || 'Recordatorio de hoy', url: './?open=reminders', tag: 'rem-' + r.id });
  }

  // 2a. Planes del calendario: a quien es el plan (los dos, o solo uno)
  for (const p of calDue) {
    const to = p.who === 'ambos' ? members : members.filter(u => u === p.who), r = String(p.remind);
    const title = !p.time ? `📅 ${p.day === today ? 'Hoy' : 'Mañana'}: ${p.title}` : `📅 ${p.title}`;
    const when = !p.time ? (p.who === 'ambos' ? 'Tienen este plan' : 'Tienes este plan') : r === '0' ? `Ahora · ${p.time}` : r === '1440' ? `Mañana a las ${p.time}` : `En ${r === '60' ? '1 hora' : r + ' minutos'} · a las ${p.time}`;
    for (const u of to) add(u, 'events', { title, body: [when, p.note].filter(Boolean).join(' · '), url: './?open=cal', tag: `ev-${p.id}-${p.day}` });
  }

  // 2b. Notas programadas: le llegan a la pareja a su hora
  for (const n of notesDue) for (const u of members.filter(x => x !== n.fromUid)) add(u, 'notes', { title: `💌 ${n.fromName || couple.members[n.fromUid]?.name || 'Tu pareja'} te dejó una nota para hoy`, body: 'Sácala del frasco 🫙', url: './?open=notes', tag: 'note-' + n.id });

  // 2c. Viajes: 30 días, 7 días y 1 día antes (a las 10:00), con lo que falta de «Antes de salir»
  if (onTheHour && hour === 10) {
    for (const n of [30, 7, 1]) for (const t of await db.query('trips', 'start', shift(today, n))) {
      const left = (t.todo || []).filter(x => !x.done);
      for (const u of members) {
        const mine = left.filter(x => !x.who || x.who === 'ambos' || x.who === u);
        const title = n === 1 ? `✈️ ¡Mañana se van a ${t.dest || t.name}!` : `✈️ Faltan ${n} días para «${t.name}»`;
        const body = mine.length ? `Te falta: ${mine.slice(0, 3).map(x => x.text).join(', ')}${mine.length > 3 ? ` y ${mine.length - 3} más` : ''}` : n === 1 ? 'Revisen la maleta y las reservas 🧳' : 'Todo listo en «Antes de salir» ✅';
        add(u, 'trips', { title, body, url: './?open=trips', tag: 'trip-' + t.id });
      }
    }
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

  // 4. Resumen de la semana (domingo 19:00)
  if (onTheHour && hour === WEEK_HOUR && weekday === 0 && members.length === 2) {
    const keys = Array.from({ length: 7 }, (_, i) => shift(today, i - 6));
    const COLS = ['moods', 'answers', 'thinks', 'daily', 'activity', 'stats', 'guess'], days = {};
    const docs = await db.getMany(keys.flatMap(k => COLS.map(c => `${c}/${k}`)));
    for (const [path, d] of Object.entries(docs)) { const [c, k] = path.split('/'); (days[k] ||= {})[c] = d; }
    const did = (k, u) => { const x = days[k] || {}; return !!(x.moods?.[u] || x.answers?.answers?.[u] || x.thinks?.[u] || x.daily?.[u] || x.activity?.[u]); };
    const together = keys.filter(k => members.every(u => did(k, u))).length;
    const hearts = keys.reduce((s, k) => s + members.reduce((a, u) => a + (Number(days[k]?.thinks?.[u]) || 0), 0), 0);
    const snaps = keys.reduce((s, k) => s + members.reduce((a, u) => a + (Number(days[k]?.stats?.acts?.[u]?.snap) || 0), 0), 0);
    const answers = keys.filter(k => members.every(u => days[k]?.answers?.answers?.[u])).length;
    const parts = [`🔥 ${together} de 7 días juntos`, `❤️ ${hearts} ${hearts === 1 ? 'corazón' : 'corazones'}`];
    if (snaps) parts.push(`📸 ${snaps} ${snaps === 1 ? 'historia' : 'historias'}`); else parts.push(`💬 ${answers} ${answers === 1 ? 'pregunta' : 'preguntas'}`);
    const title = together >= 6 ? '🏆 ¡Qué semana! Su resumen en Futari' : '📊 Su semana en Futari';
    for (const u of members) add(u, 'week', { title, body: parts.join(' · ') + '. Toquen para ver el resumen completo.', url: './?open=week', tag: 'week-' + today });
  }

  // 5. Resumen de gastos de la semana (domingo 19:30): lee solo los gastos de las últimas dos semanas
  if (L.minute === '30' && hour === WEEK_HOUR && weekday === 0 && members.length) {
    const from = shift(today, -13), mid = shift(today, -6);
    const cfg = (await db.get('money/cfg')) || {}, cats = cfg.weekCats?.length ? cfg.weekCats : ['🍽️', '🎬', '🎉'];
    const ex = (await db.query('expenses', 'date', from, 'GREATER_THAN_OR_EQUAL')).filter(e => e.type !== 'settle' && e.date <= today);
    const sum = (a, b, all) => ex.filter(e => e.date >= a && e.date <= b && (all || cats.includes(e.cat))).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const now = sum(mid, today), prev = sum(from, shift(mid, -1)), all = sum(mid, today, true);
    if (ex.length) {
      const cur = couple.currency || 'USD', fm = n => { try { return new Intl.NumberFormat('es', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(n); } catch { return String(Math.round(n)); } };
      const budget = Number(cfg.week) || 0, parts = [`Gustos: ${fm(now)}${budget ? ` de ${fm(budget)}` : ''}`];
      if (prev) parts.push(now <= prev ? `▼ ${Math.round((1 - now / prev) * 100)}% menos que la semana pasada` : `▲ ${Math.round((now / prev - 1) * 100)}% más que la semana pasada`);
      parts.push(`Todo: ${fm(all)}`);
      const title = budget && now <= budget ? `🐷 ¡Les sobraron ${fm(budget - now)} esta semana!` : budget ? `💸 Se pasaron ${fm(now - budget)} esta semana` : '💸 Sus gastos de la semana';
      for (const u of members) add(u, 'money', { title, body: parts.join(' · ') + (budget && now <= budget ? '. Mañana pasan a su alcancía.' : ''), url: './?open=money', tag: 'money-' + today });
    }
  }

  if (!dryRun) {
    await Promise.all(out.map(async n => {
      const payload = enc.encode(JSON.stringify({ title: n.title.slice(0, 120), body: n.body.slice(0, 300), url: n.url, tag: n.tag.slice(0, 60) }));
      // Prioridad alta: con 'normal' el iPhone y Android se guardan el aviso para ahorrar batería hasta que se usa el teléfono
      await Promise.all(subsOf(n.to).map(s => sendPush(s, payload, env, 'high').catch(e => console.error('push', e))));
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
    base, auth,
    // Documentos de una colección con campo == valor (solo se cobran los que coinciden)
    async query(col, field, eq, op = 'EQUAL') {
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: eq } } } } }) });
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
