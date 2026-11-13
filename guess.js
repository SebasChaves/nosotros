// «¿Qué respondería tu pareja?»: una pregunta al día con 4 opciones. Cada uno responde por sí mismo y adivina qué
// eligió su pareja. Cuando responden los dos se revela quién acertó. Cada acierto da 5 🪙 a la mascota (si ya nació).
// Doc "guess/<día>": { q: índice, <uid>: { me, guess, at }, paid?: true }
import { setDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { $, S, esc, expose, toast, openSheet, write, ref, todayKey, epochDay, parseDate, nameOf, partnerUid, partnerName, uid, celebrate, markActive } from './core.js';
import { notify, meForPartner } from './push.js';

export const GUESS_COINS = 5;
// [pregunta (se responde por uno mismo), [4 opciones]]
export const GUESS_QS = [
  ['Para una cita perfecta, ¿qué eliges?', ['Cena elegante', 'Picnic al aire libre', 'Peli en casa con cobija', 'Una aventura nueva']],
  ['Si mañana tuvieras el día libre, ¿qué harías primero?', ['Dormir hasta tarde', 'Salir a desayunar', 'Hacer ejercicio', 'Ver series']],
  ['¿Cuál es tu comida de consuelo?', ['Pizza', 'Algo dulce', 'Comida de la casa', 'Comida rápida']],
  ['¿Qué tipo de vacaciones prefieres?', ['Playa', 'Montaña', 'Ciudad nueva', 'Quedarse en casa']],
  ['¿Qué te pone de mejor humor?', ['Un abrazo', 'Comer rico', 'Música', 'Dormir bien']],
  ['Si fueras un animal, ¿cuál serías?', ['Gato', 'Perro', 'Perezoso', 'Delfín']],
  ['¿Qué superpoder elegirías?', ['Volar', 'Teletransportarme', 'Leer mentes', 'Detener el tiempo']],
  ['¿Café, té o ninguno?', ['Café', 'Té', 'Chocolate caliente', 'Ninguno']],
  ['¿Qué haces cuando estás estresado/a?', ['Hablo con alguien', 'Me encierro en mi mundo', 'Como algo', 'Hago ejercicio o salgo']],
  ['¿Cuál es tu momento favorito del día?', ['La mañana', 'El mediodía', 'La tarde', 'La noche']],
  ['¿Qué regalo te haría más ilusión?', ['Algo hecho a mano', 'Una experiencia', 'Algo que necesito', 'Una sorpresa cualquiera']],
  ['En una peli, ¿qué género eliges?', ['Comedia', 'Terror', 'Romance', 'Acción']],
  ['¿Cómo prefieres pasar un domingo?', ['En pijama todo el día', 'Paseando', 'Con la familia', 'Haciendo pendientes']],
  ['¿Qué te cuesta más?', ['Levantarme temprano', 'Decidir qué comer', 'Pedir perdón', 'Quedarme quieto/a']],
  ['¿Cuál es tu lenguaje del amor favorito?', ['Palabras bonitas', 'Tiempo juntos', 'Detalles y regalos', 'Abrazos y cariño']],
  ['Si ganaras la lotería, ¿qué harías primero?', ['Viajar', 'Comprar casa', 'Ayudar a la familia', 'Ahorrar todo']],
  ['¿Qué estación del año prefieres?', ['Verano', 'Lluvia', 'Navidad', 'Cuando hace fresco']],
  ['¿Qué te molesta más?', ['La impuntualidad', 'El ruido', 'El desorden', 'Que me interrumpan']],
  ['¿Dulce o salado?', ['Dulce', 'Salado', 'Las dos cosas juntas', 'Depende del día']],
  ['¿Qué harías en una noche de lluvia?', ['Ver una peli', 'Dormir', 'Cocinar algo rico', 'Platicar horas']],
  ['¿Cuál sería tu trabajo soñado?', ['Viajar por el mundo', 'Tener mi negocio', 'Algo creativo', 'Ayudar a otros']],
  ['¿Qué prefieres para cenar fuera?', ['Sushi', 'Tacos o comida típica', 'Pasta o pizza', 'Hamburguesa']],
  ['¿Cómo reaccionas a una sorpresa?', ['Me emociono un montón', 'Me da pena', 'Lloro', 'Me río nervioso/a']],
  ['¿Qué llevarías a una isla desierta?', ['Mi teléfono', 'Comida', 'A mi pareja', 'Un libro']],
  ['¿Qué tan ordenado/a eres?', ['Súper ordenado/a', 'Ordenado/a a mi manera', 'Un poco caótico/a', 'Desastre feliz']],
  ['¿Qué haces primero al despertar?', ['Ver el teléfono', 'Ir al baño', 'Quedarme un rato en la cama', 'Buscar café']],
  ['¿Qué canción cantarías en un karaoke?', ['Una romántica', 'Una de los 2000', 'Reguetón', 'Ni loco/a canto']],
  ['¿Qué mascota tendrías?', ['Perro', 'Gato', 'Algo exótico', 'Ninguna']],
  ['¿Qué plan te da más pereza?', ['Ir de compras', 'Hacer fila', 'Fiestas grandes', 'Madrugar para un paseo']],
  ['¿Cuál es tu postre favorito?', ['Helado', 'Pastel o queque', 'Galletas', 'Fruta']],
  ['¿Qué haces cuando no puedes dormir?', ['Ver el teléfono', 'Pensar en todo', 'Leer o ver algo', 'Comer algo']],
  ['¿Qué te gustaría aprender?', ['Un idioma', 'Un instrumento', 'Cocinar mejor', 'Un deporte']],
  ['Si pudieras vivir en otro país, ¿dónde?', ['Europa', 'Japón u Asia', 'Estados Unidos o Canadá', 'Me quedo aquí']],
  ['¿Qué haces en una fiesta?', ['Bailo toda la noche', 'Platico en una esquina', 'Me quedo cerca de la comida', 'Me voy temprano']],
  ['¿Cómo te gusta celebrar tu cumpleaños?', ['Fiesta grande', 'Algo tranquilo en pareja', 'Con la familia', 'Que no lo celebren']],
  ['¿Qué es lo que más extrañas cuando no nos vemos?', ['Los abrazos', 'Platicar', 'Reírnos', 'Hacer nada juntos']],
  ['¿Playa: sol o sombra?', ['Sol todo el día', 'Sombra y agua', 'Solo para la foto', 'Prefiero la piscina']],
  ['¿Qué app usas más?', ['WhatsApp', 'Instagram o TikTok', 'YouTube', 'Futari 😉']],
  ['¿Qué harías con una tarde libre solo/a?', ['Dormir', 'Salir a caminar', 'Ver series', 'Hacer algo productivo']],
  ['¿Qué tan bueno/a eres cocinando?', ['Chef', 'Me defiendo', 'Solo lo básico', 'Mejor pedimos']],
  ['¿Qué te da más miedo?', ['Las alturas', 'Los bichos', 'La oscuridad', 'Hablar en público']],
  ['¿Qué tipo de libro o serie prefieres?', ['Misterio', 'Romance', 'Fantasía', 'Documentales']],
  ['¿Qué emoji usas más?', ['😂', '❤️', '🥺', '😅']],
  ['¿Qué prefieres de desayuno?', ['Gallo pinto o algo típico', 'Pan con café', 'Fruta o yogur', 'No desayuno']],
  ['¿Cómo te gusta que te consuelen?', ['Con un abrazo', 'Escuchándome', 'Distrayéndome', 'Dejándome solo/a un rato']],
  ['¿Qué tipo de viaje harías juntos?', ['Mochileros', 'Hotel con todo incluido', 'Road trip', 'Crucero']],
  ['¿Qué cosa nunca puede faltar en tu casa?', ['Café', 'Algo dulce', 'Papel higiénico', 'Wifi']],
  ['¿Qué haces cuando te enojas?', ['Lo digo de una vez', 'Me quedo callado/a', 'Necesito espacio', 'Se me pasa rápido']],
  ['¿Cuál es tu tipo de clima favorito?', ['Soleado', 'Nublado', 'Lluvioso', 'Frío']],
  ['¿Qué prefieres ver juntos?', ['Una peli', 'Una serie larga', 'Videos cortos', 'Deportes']],
  ['¿Qué plan harías un viernes en la noche?', ['Salir a bailar', 'Cena tranquila', 'Juegos de mesa', 'Dormir temprano']],
  ['¿Qué parte de una relación es la más importante para ti?', ['La confianza', 'La comunicación', 'Reírnos juntos', 'Los detalles']],
  ['¿Qué te gustaría hacer juntos este año?', ['Un viaje', 'Aprender algo', 'Ahorrar para algo grande', 'Más citas']],
  ['¿Qué haces con un antojo a medianoche?', ['Me levanto a buscar algo', 'Pido delivery', 'Me aguanto', 'Despierto a mi pareja']],
  ['¿Cuál es tu forma favorita de pasar tiempo juntos?', ['Platicando', 'Saliendo', 'Viendo algo', 'Abrazados sin hacer nada']],
  ['¿Qué tipo de música te pone a bailar?', ['Salsa o merengue', 'Reguetón', 'Pop', 'Rock']],
  ['¿Qué harías si nos perdemos en un viaje?', ['Pregunto a alguien', 'Saco el mapa', 'Sigo caminando a ver qué sale', 'Me río y lo disfruto']],
  ['¿Qué foto subirías a redes?', ['Una de los dos', 'De comida', 'Un paisaje', 'Ninguna, no subo']],
  ['¿Qué tan friolento/a eres?', ['Siempre tengo frío', 'Normal', 'Siempre tengo calor', 'Depende del día']],
  ['¿Qué te gustaría que hiciéramos más seguido?', ['Salir a comer', 'Viajar', 'Cocinar juntos', 'Ver pelis abrazados']],
];

const todayIdx = () => epochDay() % GUESS_QS.length;
export const guessDoc = (day = todayKey()) => S.data.guess.find(g => g.id === day);
export const guessWaiting = () => { const g = guessDoc(), p = partnerUid(); return !!(p && g?.[p] && !g?.[uid()]); };
// Aciertos totales de cada uno (en días donde respondieron los dos)
export function guessScore(who, since = '') {
  const p = who === uid() ? partnerUid() : uid();
  return S.data.guess.filter(g => g.id >= since && g[who] && g[p] && g[who].guess === g[p].me).length;
}

let draft = {};
export function guessCard() {
  const p = partnerUid(); if (!p) return '';
  const g = guessDoc(), qi = g?.q ?? todayIdx(), [q, opts] = GUESS_QS[qi], pn = esc(partnerName());
  const mine = g?.[uid()], theirs = g?.[p];
  let body;
  if (!mine) {
    const step = draft.day === todayKey() && draft.me !== undefined ? 2 : 1;
    body = step === 1
      ? `<p class="small" style="margin:0"><b>Tú:</b> ${esc(q)}</p><div class="guess-opts">${opts.map((o, i) => `<button class="chip" onclick="guessPick(${i})">${esc(o)}</button>`).join('')}</div>`
      : `<p class="small" style="margin:0">Elegiste <b>${esc(opts[draft.me])}</b>. <button class="link" onclick="guessBack()">Cambiar</button></p>
        <p class="small" style="margin:0"><b>¿Qué crees que respondió ${pn}?</b></p><div class="guess-opts">${opts.map((o, i) => `<button class="chip" onclick="guessSend(${i})">${esc(o)}</button>`).join('')}</div>`;
    if (theirs) body += `<p class="tiny muted" style="margin:0">${pn} ya respondió. ¡Adivina!</p>`;
  } else if (!theirs) {
    body = `<p class="small" style="margin:0">${esc(q)}</p><p class="small muted" style="margin:0">Elegiste <b>${esc(opts[mine.me])}</b> y crees que ${pn} eligió <b>${esc(opts[mine.guess])}</b>. Esperando a que responda… 👀</p>`;
  } else {
    const iOk = mine.guess === theirs.me, tOk = theirs.guess === mine.me;
    body = `<p class="small" style="margin:0">${esc(q)}</p>
      <div class="guess-res"><div><span class="tiny muted">${pn} eligió</span><b>${esc(opts[theirs.me])}</b><span class="small">${iOk ? '✅ ¡Adivinaste!' : `❌ Dijiste ${esc(opts[mine.guess])}`}</span></div>
        <div><span class="tiny muted">Tú elegiste</span><b>${esc(opts[mine.me])}</b><span class="small">${tOk ? `✅ ${pn} adivinó` : `❌ ${pn} dijo ${esc(opts[theirs.guess])}`}</span></div></div>
      ${iOk && tOk ? '<p class="small center" style="margin:0">💞 ¡Se conocen perfecto!</p>' : ''}`;
  }
  return `<div class="glass stack guess-card"><div class="row"><span class="label">🔮 ¿Qué respondería ${pn}?</span>
      <button class="link" onclick="guessHistory()">Aciertos: ${guessScore(uid())} · ${guessScore(p)}</button></div>${body}</div>`;
}
function guessPick(i) { draft = { day: todayKey(), me: i }; window.rerenderHome?.(); }
function guessBack() { draft = {}; window.rerenderHome?.(); }
function guessSend(i) {
  if (draft.day !== todayKey() || draft.me === undefined) return;
  const day = todayKey(), g = guessDoc(day), p = partnerUid(), qi = g?.q ?? todayIdx();
  write(setDoc(ref('guess', day), { q: qi, [uid()]: { me: draft.me, guess: i, at: Date.now() } }, { merge: true }));
  markActive();
  const theirs = g?.[p];
  if (theirs) {
    // Soy el segundo en responder: se revela y se reparten las monedas (una sola vez)
    const hits = (i === theirs.me ? 1 : 0) + (theirs.guess === draft.me ? 1 : 0);
    const pet = S.data.pet.find(x => x.id === 'main');
    if (hits && pet?.hatchedAt && !g.paid) { write(updateDoc(ref('pet', 'main'), { bonus: increment(hits * GUESS_COINS) })); write(updateDoc(ref('guess', day), { paid: true })); }
    if (i === theirs.me) celebrate('hearts');
    toast(hits === 2 ? '¡Los dos adivinaron! 💞' + (pet?.hatchedAt ? ` +${2 * GUESS_COINS} 🪙` : '') : hits ? `Un acierto${pet?.hatchedAt ? ` · +${GUESS_COINS} 🪙` : ''}` : 'Esta vez nadie adivinó 😅');
    notify('guess', { title: `🔮 ¡Ya están las respuestas!`, body: `${meForPartner()} también respondió. Mira quién adivinó.`, url: './?open=home', tag: 'guess' });
  } else {
    toast('¡Listo! Cuando responda tu pareja verán quién adivinó');
    notify('guess', { title: `🔮 ${meForPartner()} ya respondió la pregunta de hoy`, body: `${GUESS_QS[qi][0]} ¿Adivinas qué dijo?`, url: './?open=home', tag: 'guess' });
  }
  draft = {};
}
function guessHistory() {
  const p = partnerUid(), pn = esc(partnerName());
  const days = [...S.data.guess].filter(g => g[uid()] && g[p]).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
  openSheet(`<div class="stack"><h2>🔮 ¿Qué tanto se conocen?</h2>
    <div class="grid2"><div class="adm-kpi"><b class="num">${guessScore(uid())}</b><span class="tiny muted">tus aciertos</span></div><div class="adm-kpi"><b class="num">${guessScore(p)}</b><span class="tiny muted">aciertos de ${pn}</span></div></div>
    <ul class="list">${days.map(g => { const [q, o] = GUESS_QS[g.q] || ['', []]; const a = g[uid()], b = g[p];
      return `<li><div class="txt"><span class="small">${esc(q)}</span><span class="sub">${parseDate(g.id).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · Tú: ${esc(o[a.me] || '')} ${b.guess === a.me ? '✅' : '❌'} · ${pn}: ${esc(o[b.me] || '')} ${a.guess === b.me ? '✅' : '❌'}</span></div></li>`; }).join('') || '<li class="empty">Todavía no hay días con respuestas de los dos</li>'}</ul></div>`);
}

expose({ guessPick, guessBack, guessSend, guessHistory });
