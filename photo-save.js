// Guardar fotos en el teléfono: una sola (botón «Guardar» del visor) o muchas juntas en un .zip (Galería → Bajar fotos).
// - iPhone: se abre el menú de compartir («Guardar imagen» la manda a Fotos; el .zip, «Guardar en Archivos»).
// - Android y computadora: se descarga (queda en Descargas y la galería la muestra).
// El .zip se arma aquí mismo, sin librerías (método «sin comprimir»: las fotos JPEG ya vienen comprimidas).
// Las fotos son las que guarda Futari (≤ ~700 KB, lado máximo ~1280 px), no el original de la cámara.
import { getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, expose, toast, openSheet, closeSheet, ref, IOS, plural } from './core.js';

// data:image/jpeg;base64,... → bytes (sin esperar: el menú de compartir del iPhone pide que sea justo después del toque)
function dataToBytes(dataUrl) {
  const b = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const safeName = s => String(s || 'foto').replace(/[\\/:*?"<>|#%\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'foto';

export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (IOS && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

// Botón «Guardar» del visor de fotos (core.js → viewPhoto deja el nombre en data-name)
async function saveViewerPhoto() {
  const src = $('viewerImg')?.src || '';
  if (!src.startsWith('data:')) return toast('Espera a que cargue la foto');
  // Nombre sin tildes ni ¿¡: algunos navegadores de Android descartan el nombre si trae esos caracteres
  const plain = safeName($('viewer').dataset.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .()-]+/g, '').trim() || 'foto-futari';
  const ok = await saveFile(new Blob([dataToBytes(src)], { type: 'image/jpeg' }), plain + '.jpg');
  if (ok && !IOS) toast('Foto guardada en Descargas ✓');
}

/* ---------- .zip sin comprimir ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function makeZip(files) { // [{ name, data: Uint8Array, date: 'AAAA-MM-DD' }]
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const [y, m, d] = (f.date || '1980-01-01').split('-').map(Number), dosDate = (Math.max(0, y - 1980) << 9) | (m << 5) | d, dosTime = 12 << 11;
    const head = (sig, extra) => { const h = new DataView(new ArrayBuffer(extra)); h.setUint32(0, sig, true); return h; };
    const lh = head(0x04034b50, 30);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, f.data);
    const ch = head(0x02014b50, 46);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cSize = central.reduce((s, p) => s + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/* ---------- Bajar fotos de Momentos ---------- */
const withPhoto = () => S.data.moments.filter(m => m.hasPhoto).sort((a, b) => a.date.localeCompare(b.date));
function downloadPhotos() {
  const all = withPhoto(), years = [...new Set(all.map(m => m.date.slice(0, 4)))].reverse();
  if (!all.length) return toast('Todavía no hay momentos con foto');
  openSheet(`<div class="stack"><h2>⬇️ Bajar fotos</h2>
    <p class="small muted" style="margin:0">Se juntan en un archivo .zip con la fecha y el nombre de cada momento. ${IOS ? 'Al final toquen «Guardar en Archivos».' : 'Queda en Descargas.'} Son las fotos como están en Futari (no el original de la cámara). Muchas fotos pueden tardar un poco.</p>
    <button class="btn" onclick="zipPhotos('')">Todas · ${plural(all.length, 'foto', 'fotos')}</button>
    ${years.length > 1 ? `<div class="grid2">${years.map(y => `<button class="btn ghost small" style="width:100%" onclick="zipPhotos('${y}')">${y} · ${all.filter(m => m.date.startsWith(y)).length}</button>`).join('')}</div>` : ''}
    <p class="tiny muted" style="margin:0">Para guardar una sola: ábranla en grande y toquen «Guardar».</p></div>`);
}
let zipping = false;
async function zipPhotos(year) {
  if (zipping) return; if (!navigator.onLine) return toast('Para bajar las fotos necesitas internet');
  const list = withPhoto().filter(m => !year || m.date.startsWith(year)); zipping = true;
  const say = t => { const p = $('zipProg'); if (p) p.textContent = t; };
  openSheet(`<div class="stack"><h2>⬇️ Bajar fotos</h2><p class="small" id="zipProg" style="margin:0">Juntando 0 de ${list.length}…</p></div>`);
  const files = [], used = new Set(); let done = 0, missing = 0;
  try {
    const queue = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => { // 4 a la vez
      while (queue.length) {
        const m = queue.shift();
        const data = await getDoc(ref('photos', m.id)).then(s => s.data()?.data || '').catch(() => '');
        if (data) {
          let base = `${m.date} ${safeName(m.title)}`, name = base + '.jpg', n = 2;
          while (used.has(name)) name = `${base} (${n++}).jpg`;
          used.add(name); files.push({ name, data: dataToBytes(data), date: m.date });
        } else missing++;
        say(`Juntando ${++done} de ${list.length}…`);
      }
    }));
    files.sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) { zipping = false; return say('😕 No se pudo bajar ninguna foto. Revisen el internet.'); }
    const blob = makeZip(files), name = `futari-fotos${year ? '-' + year : ''}.zip`, mb = blob.size < 1048576 ? '< 1' : (blob.size / 1048576).toFixed(1);
    window.__zipReady = { blob, name };
    // El botón final es un toque nuevo: el iPhone solo abre «Compartir» justo después de tocar algo
    openSheet(`<div class="stack"><h2>✅ Listo</h2>
      <p class="small" style="margin:0">${plural(files.length, 'foto', 'fotos')} · ${esc(mb)} MB${missing ? ` · ${plural(missing, 'no se pudo bajar', 'no se pudieron bajar')}` : ''}</p>
      <button class="btn" onclick="zipSave()">${IOS ? 'Guardar (Compartir → Guardar en Archivos)' : 'Descargar el .zip'}</button></div>`);
  } catch (e) { console.error(e); say('😕 No se pudieron juntar las fotos. Prueben con un año a la vez.'); }
  zipping = false;
}
async function zipSave() {
  const z = window.__zipReady; if (!z) return closeSheet();
  if (await saveFile(z.blob, z.name)) { window.__zipReady = null; closeSheet(); if (!IOS) toast('Fotos descargadas ✓'); }
}

expose({ saveViewerPhoto, downloadPhotos, zipPhotos, zipSave });
