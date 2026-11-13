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
// Ver docs/NOTIFICACIONES.md. Sin dependencias: se pega tal cual en el editor de Cloudflare.

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
    if (req.method === 'GET') return json({ ok: true, service: 'futari-push', ready: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.FIREBASE_PROJECT_ID && env.ALLOWED_UIDS) });
    if (req.method !== 'POST' || url.pathname !== '/notify') return json({ error: 'not-found' }, 404);

    // 1. ¿Quién pide? Sesión de Firebase válida y de la pareja
    let who;
    try { who = await verifyFirebaseToken((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env); }
    catch (e) { return json({ error: 'auth', detail: String(e.message || e) }, 401); }
    const allowed = (env.ALLOWED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(who)) return json({ error: 'forbidden' }, 403);

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
