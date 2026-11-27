# Datos (Firestore)

Proyecto Firebase: `nosotros-app-2e254` (config pública en `firebase-config.js`; no es secreta, lo que protege
los datos son las reglas). Plan gratuito **Spark**: sin Cloud Functions ni Storage de pago → **las fotos se guardan
como texto (dataURL) dentro de documentos de Firestore**.

## Estructura

```
couples/nosotros                     doc de la pareja (S.settings)
  { start: 'AAAA-MM-DD', currency: 'CRC'|'USD'|…, members: { <uid>: { name, joined } }, lastBackup }
couples/nosotros/<colección>/<id>    todo lo compartido (una colección por sección, ver tabla)
private/<uid>/gifts/<id>             ideas de regalo: solo las ve su dueño
private/<uid>/regalitos/r-<año>-<dd> regalitos del adviento que planea cada uno (1.17.0, ver docs/ADVIENTO.md)
adminlogs/nosotros/<colección>/<id>  registros de Administración (1.12.1): los dos escriben, solo el dueño lee y borra
```

`COLLECTIONS` en `core.js` es la lista de colecciones que se escuchan en vivo y se incluyen en el respaldo.
Colecciones que **no** están en esa lista (se leen bajo demanda y no se respaldan, salvo `photos`): `photos`, `stats` y los
registros de `adminlogs/` (`visits`, `errors`, `usage`, `actions`, `perf`, `notiflog`).

## Colecciones principales

Casi todos los docs llevan `by: uid` (quién lo creó) y `createdAt: ms`. Fechas como `'AAAA-MM-DD'`.

| Colección | Campos importantes |
|---|---|
| `notes` | `text, fromUid, fromName, readAt` |
| `coupons` | `text, emoji, fromUid, seenAt, redeemedAt, doneAt` |
| `moments` | `title, date, note, hasPhoto, place?{name,lat,lng,country}` — la foto está en `photos/<id del momento>` |
| `daily` | id = día `'AAAA-MM-DD'`; `{ <uid>: { photo, caption, place?, at } }` |
| `answers` | id = día; respuestas a la pregunta del día por uid |
| `moods`, `thinks` | ánimo del día / contador de "Pensando en ti" por uid y día |
| `challenges` | reto de la semana cumplido (`doneAt`) |
| `lists` | listas de Decidir: `name, emoji, options[], votes: { <uid>: { opción: true/false } }, match?{by, at}, history[]`. `match` = invitación a votar (al empezar a votar primero o con «Elegir juntos» de Pelis): a la pareja le aparece por 7 días aunque quien invitó no termine. Avisos tipo `decide` (te toca votar / en qué coincidieron) |
| `ideas` | ideas de cita propias: `t, place: 'casa'|'afuera', cost: 0-3, e` |
| `bucket`, `groceries` | `text, done, doneAt` |
| `expenses` | gastos (`desc, amount, paidBy, split: half/full/none, cat, date, tripId?, outing?, outName?, quick?, items?[{t, a?}]` — lo que se compró; desde el Súper se llena con el carrito) y pagos de saldo (`type: 'settle'`) |
| `notes` | notas del frasco `{ text, fromUid, fromName, createdAt, readAt, showAt?, showDay?, showTime? }` (programadas: no se ven antes de `showAt`) |
| `money` | `cfg` `{ week, weekCats[], goal, lastRoll }` (presupuesto semanal y alcancía donde cae lo que sobra), `out` `{ active, oid, name, limit, startAt, by, warned }` (salida en curso), `g-<ts>` `{ kind: 'goal', name, emoji, target, saved, log[], done? }` (alcancías). Ver docs/GASTOS.md |
| `places` | restaurantes: `name, kind, price 0-4, loc?{name,lat,lng}, status 'want'|'been', ratings{uid:1-5}, visits[{date,note,by}]` |
| `trips` | viajes con itinerario, maleta, presupuesto y opciones de hospedaje/vuelo (`stays`, `flights` con votos). Desde 1.3.0 además: `currency?, goalId?` (alcancía en `money`), `dreamId?, geo?{lat,lng,name,country}` (clima), `ideas[], todo[], bookings[], journal[]` (fotos `tj-<id>`), `savedMoment?`. Gastos en otra moneda: `expenses.orig {cur, amount, rate}` (el `amount` queda convertido) |
| `events` | planes: `title, date, time, who 'ambos'|uid, note, repeat none/weekly/biweekly/monthly/yearly, until, remind` (minutos antes del aviso: `'60'`, `'15'`, `'0'`, `'1440'` o `'none'`; sin campo = 60) |
| `snaps` | historias (antes «instantáneas»): `by, at (ms), text, replyTo?, seen{uid: ms}, reacts{uid: {e, at}}, reactSeen?, saved?(id del momento), chat?[{by, t, at}], chatSeen?{uid: ms}` — foto en `photos/snap-<id>` (+ miniatura). Duran 24 h: al abrir la app, `snaps.js` borra las vencidas y sus fotos. «Guardar en Momentos» copia la foto a un momento (`fromSnap: true`); chat [{by, t, at}] y chatSeen.<uid> (1.2.0) |
| `activity` | id = día: `{ <uid>: true }` — ese día hizo algo que no queda guardado en otro lado (historia, nota, cupón, canción); `markActive()` en `core.js`. Cuenta para la racha |
| `pet` | doc `main`: `start (día de adopción), createdAt, by, species? (emoji), name?, hatchedAt?, hatchedBy?, namedBy?, bonus, spent, owned{prenda:true}, wear{head,face,neck,body,room}, best{juego:{uid:récord}}, gameDay{uid:{day,n}}, lastBuy?` — el crecimiento se calcula con los días de racha desde `start`; monedas = 10 × días comidos + `bonus` − `spent` (`pet.js`) |
| `usage` | id = `<día>_<uid>`: `uid, day, total, secs{pantalla: segundos}` — tiempo con la app a la vista por sección (`tracking.js`). Solo para Administración |
| `stats` | id = día: `day, sent{uid:{tipo:n}}, opened{uid:{tipo:n}}, acts{uid:{snap,react}}` — avisos mandados/abiertos y acciones que no quedan guardadas (`countStat` en `core.js`). Solo para Administración |
| `cravings` | antojos: `text, emoji, note, kind now|someday, urgent, photo, by, at, seen{uid:at}, done, doneBy, doneAt, donePhoto, doneSeen?, thanks?, savedMoment?, plan?{date,time,eventId}`. Favoritos de la ruleta en la misma colección: `{ fav: true, emoji, text, by, at }`. Fotos: `photos/crave-<id>` (pedido) y `photos/craved-<id>` (cumplido), con miniatura `t-…`. Cumplir el de tu pareja da 10 🪙 a la mascota (`cravings.js`) |
| `arrows` | juego Flechas: `p-<uid>` `{ lv (siguiente nivel, 91 = terminó), ls{nivel: 1..3 estrellas}, lx{nivel: experto}, inf (tablero infinito), cv (siguiente figura 1–81), cs{n: estrellas de figuras}, mv (siguiente mixto 1–31), ms{n: estrellas de mixto}, tt (récord contrarreloj), dw (duelos ganados) }`, `duel` (duelo en vivo: `did, seed, size, from, to, state, at, startAt, p{uid:{n,total,e,done,ms,gaveUp}}, winner, counted`) y `d-<día>` `{ <uid>: { ms, errors, hints, arrows, at } }`; la partida a medias vive solo en el teléfono (localStorage `futari-arrows-<n5|h3|d2026-11-13>`) (reto del día, igual para los dos) (`arrows.js`) |
| `bus` | La parada: `p-<uid>` `{ lv, ls{nivel}, lx{nivel}, dw }`, `d-<día>` `{ <uid>: { ms, moves, help, fails, at } }`, `duel` (ver docs/PARADA.md) |
| `guess` | id = día: `q` (índice en `GUESS_QS`), `<uid>: { me, guess, at }`, `paid?` — «¿Qué respondería tu pareja?»; cada acierto da 5 🪙 a la mascota (`guess.js`) |
| `push` | id = uid: `subs { <llave>: { endpoint, keys{p256dh,auth}, device, at } }` — un teléfono por elemento (docs/NOTIFICACIONES.md) |
| `dates` | fechas especiales: `title, date, emoji, yearly, by, createdAt, editedBy?, editedAt?` — tipos en `DATE_KINDS` (`data.js`); se crean/editan con `openFecha` (`calendar.js`), desde el Calendario o Inicio → Fechas |
| `cooked` | recetas que hicieron (1.1.0): `rid` (receta o null si era del chef sin guardar), `name, emoji, date, at, by, note?, photo?` (foto `cook-<id>` + miniatura `t-cook-<id>` en `photos`) |
| `dreams` | Viajes → Por conocer (1.3.0): `name, place?{name,lat,lng,country}, url?, kind, abroad, cost?, days?, season?, note?, by, at, votes{uid: 1/-1/0}, photo?` (foto `dream-<id>`), `tripId?` (se volvió viaje), `went?` (ya fueron). Salen en Nuestro mapa como ✨ |
| `vacations` | Calendario → vacaciones y días libres (1.4.0): `title, emoji, kind, color, who ('ambos' o uid), start, end, note?, by, at`. Solo quien las tiene las edita o borra (las «de los dos», cualquiera); la otra persona las ve en modo lectura. Es solo en la app: las reglas de Firestore no lo impiden. Barras en el mes, «días que coinciden» (calendar.js `freeTogether`) y cuenta regresiva en Hoy. Desde 1.16.0 también las del trabajo (`vacations.js`): `work: true, status (pendiente|aprobada|rechazada), days, half, statusAt`; las rechazadas no salen en el calendario. Configuración en `couples/nosotros.vac` (ver docs/VACACIONES.md) |
| `advent` | calendario de adviento (1.13.0): `f-<año>-<uid>-<dd>` (casilla que uno le llena al otro: `type, text, emoji, photo`; foto `adv-<año>-<uid>-<dd>`) y `o-<año>` (`{uid: {dd: ms}}` casillas abiertas). Ver docs/ADVIENTO.md |
| `shows` | `title, type movie|tv, year, tmdbId, poster, overview, providers[], status want|watching|seen, progress{s,e}, apart? (cada uno a su ritmo), progressBy.<uid>{s,e,at}, ratings, seenAt` |
| `songs` | `title, artist, url, thumb, preview, apple, cover?(id en photos), why, date, ours, dedication?{by,to,msg,at,seen}` |
| `reminders` | `text, date, time, for 'ambos'|uid, note, urgent, done, doneAt, doneBy` |
| `pins` | lugares del mapa: `title, kind (emoji), lat, lng, place, country, date, note` |
| `recipes`, `recipefav`, `menu` | recetas propias; favoritas (id = id de receta); menú: id = lunes de la semana, `{ days: { fecha: { almuerzo|cena: {id}|{text} } } }` |
| `quiz`, `games`, `cards` | rondas del quiz; partidas del juego; cartas propias del juego |
| `profiles` | id = uid: `avatar` (id en photos), `prefs { accent, theme, bg, myNick, partnerNick, counter{unit days|weeks|months|hours, from start|custom, date, label}, home[{id,on}], menu{order[pantallas], bar[hasta 4], hidden[]}, watch{type, styles[], providers[ids TMDB], extras[], gustos} (buscador de pelis), moneyTour (ya vio la guía de Gastos) }` — todo es personal de quien lo configura; `partnerNick` cambia `nameOf()` de la pareja solo en su teléfono |

## Lecturas: días viejos guardados en el teléfono (v73)

`moods`, `answers`, `thinks`, `daily` y `activity` tienen un documento por día (id `AAAA-MM-DD`) y crecen para siempre.
`app.js` solo los escucha en vivo desde hace 40 días (`where(documentId(), '>=', corte)`). Lo anterior se baja **una vez**
por teléfono con `getDocs` y queda en localStorage (`futari-old-<colección>`, `{v, upTo, docs}`); cada día solo se baja
el tramo nuevo. `S.data.<colección>` junta las dos partes, así el resto del código no cambia. Restaurar un respaldo borra
ese guardado para que se vuelva a bajar. Si alguna vez se edita un día de hace más de 40 días desde la consola, el
teléfono no lo ve hasta borrar esas claves.

## Fotos (colección `photos`)

- Doc `{ data: 'data:image/jpeg;base64,...' }`. Límite de Firestore: **1 MB por documento**, por eso
  `compressImage()` deja cada foto en ≤ ~700 KB (lado máximo 1080–1280 px, JPEG).
- Cada foto de momento/foto del día tiene una **miniatura** `t-<id>` (~30 KB, 480 px) para listas y galería.
  `loadPhotos()` usa `data-thumb` y crea la miniatura si falta.
- Ids: momento = id del momento; foto del día = `d-<día>-<uid>`; avatar = `avatar-<uid>-<ms>`; fondo = `bg-<uid>`;
  portada de canción = `song-<id>-<ms>`; historia = `snap-<id>`; receta hecha = `cook-<id>`; lugar por conocer = `dream-<id>`; diario de viaje = `tj-<id>`. Al borrar el dueño, borra también su foto (y miniatura).
- **Bajarlas al teléfono** (`photo-save.js`): el visor tiene «⬇️ Guardar» (una foto; iPhone = menú compartir, Android =
  Descargas) y la Galería «⬇️ Bajar fotos» (las de Momentos en un .zip armado en el teléfono, todas o por año; lee cada
  `photos/<id>` una vez, sin guardarlas en la caché). Son las fotos reducidas de Futari, no el original.
- Espacio gratis: 1 GB. El panel de administración muestra una estimación del uso.

## Registro de uso y bitácoras (`visits`, `errors`, `actions`, `perf`, `notiflog`)

`tracking.js` guarda un ingreso al abrir la app o al volver tras 20 min: `uid, at, day, hour, min, os, osVersion,
model, browser, installed, app (versión), newDev?` (`newDev` = primera vez de esa cuenta en ese teléfono o navegador,
por `localStorage`). Desde 1.18.0 el mismo doc es la **sesión**: `end, secs, path[]` (hasta cuándo, segundos a la vista y
pantallas en orden, máx. 40), se actualiza cada 5 min y al salir. Desde 1.12.1 todos estos registros (y `usage`) viven en
`adminlogs/nosotros/<colección>` (`logCol` / `logRef` / `newLogRef` en core.js): las reglas dejan escribir a los dos y
leer o borrar solo al uid del dueño. `stats` se quedó en `couples/` porque el Worker lo lee para el resumen del domingo.
Lo de antes se mueve con la tarjeta «🔒 Mover registros viejos» de Administración → Ingresos. Hay un aviso en Ajustes
(«Futari guarda…»); si agregas campos, actualízalo. Bitácoras (1.12.0, Administración → 📒 Bitácoras):

| Colección | Campos |
|---|---|
| `errors` | `uid, at, message, where, screen, os, browser, model, app, kind (js/promesa/guardar/escuchar/foto), code, stack, trail[] (últimas pantallas), online, count, lastAt?` — máx. 30 distintos por sesión; si el mismo se repite suma `count`. `write()`, `photoError()` y los listeners de `app.js` también los anotan (`logHooks.error` en core.js) |
| `actions` | id = `<día>_<uid>`: `uid, day, n{colección:{a,e,d}}` (sin lo automático), `log[{at, c, o, id, d (teléfono), v (versión), t?, f?, auto?}]`. `o`: a agregó, e cambió, d borró, u deshizo un borrado, x cerró sesión (`c: '_auth'`). `f[{p (ruta del campo), b (antes), a (ahora)}]` o `{p, ph: puso/quitó/cambió}` para fotos (no se copian); textos cortados a 80 caracteres, máx. 8 campos. `t` = título corto al agregar o borrar. `auto: 1` = solo cambiaron campos que la app guarda sola (`AUTO` en tracking.js: guía vista, regalos abiertos…). `c: '_couple'` = el doc de la pareja (nombres, rango de regalitos, vacaciones). Desde 1.18.0. Se detecta en `logActions` (tracking.js, llamado desde app.js): los cambios con `hasPendingWrites` son del dueño del teléfono y se comparan con el último contenido conocido (`prev`). Los borrados los anota `softDelete`; un `deleteDoc` directo no se anota. El mismo doc en el mismo minuto se junta en una fila. Fuera: `push`, `activity` y lo privado (`private/`) |
| `perf` | `uid, at, day, os…app (como visits), online, conn (solo Android), sw, dom, t{auth, cache, server, ready} (ms desde que empezó a cargar), photos{n, avg, max, fail}` — uno por cada vez que se abre la app desde cero, a los 30 s |
| `notiflog` | id = día: `day, list[{at, by, to, type, src 'app', r, n?, ok?, gone?, d?}]` — cada aviso que manda la app (`notify` en push.js), sin el texto. `src: 'tap'` (1.18.0) = alguien tocó un aviso y entró a la app (`by` = quien lo tocó, `type`). Los programados los anota el Worker en su KV (NOTIFICACIONES.md) |

«🧹 Registros de +90 días» (Administración → Pruebas) borra `visits`, `perf`, `usage`, `stats`, `actions` y `notiflog` viejos.

## Reglas de seguridad

`firestore.rules` (el del repo tiene correos y uid de ejemplo; **las reales están solo en la consola de Firebase**):
- `couples/{couple}/{document=**}`: leer/escribir si el correo de la sesión está en la lista de la pareja.
- `private/{owner}/{document=**}`: además, solo si `request.auth.uid == owner`.
- `adminlogs/{couple}/{document=**}`: crear y actualizar la pareja; leer y borrar solo el uid del dueño (1.12.1).

Authentication (consola → Configuración → Acciones del usuario, 24 nov 2026): **registro de cuentas nuevas apagado** desde
la app (nadie puede crear una cuenta con la API pública) y protección de enumeración de correos encendida. Una cuenta nueva
se crea a mano en Authentication → Usuarios → Agregar usuario. El emulador no se ve afectado (las cuentas de prueba siguen
creándose con `accounts:signUp`).

Cualquier colección nueva bajo `couples/nosotros/` queda cubierta sin tocar reglas. Un cambio de reglas lo hace el
dueño en la consola: dale el texto, no lo publiques tú.

## Datos locales del teléfono (localStorage)

`nosotros-accent`, `nosotros-theme` (tema antes de cargar), `futari-xmas` (estilo navideño encendido, season.js), `futari-pin-<uid>` (huella del PIN), `futari-badges-<uid>`
(logros ya avisados), `futari-version` (última versión vista, para las novedades), `futari-resume` (pantalla para
volver rápido), `futari-last-visit-<uid>`. Firestore además usa su caché persistente (IndexedDB) para funcionar sin internet.

## Juegos: datos de Administración (1.6.0+)

En las colecciones `fruta`, `arrows` y `bus` (además del progreso `p-<uid>`, reto `d-<día>` y `duel`):
`cfg` (economía, `off` para ocultar, BETA de Flechas, `assist` en Pura fruta), `lv-<n>` (nivel editado o nivel nuevo
después del último), `day-<día> { num }` (reto programado), `msg-<n>` (mensaje sorpresa) y `stats { a{n}, w{n} }`
(intentos y ganados). En Pura fruta `p-<uid>.fl{n}` = derrotas seguidas en ese nivel (ayuda disimulada). Ver docs/FRUTA.md.

## Respaldo automático (Worker v11)

No vive en Firestore: el Worker copia cada noche la base a Cloudflare KV (`RESPALDOS`). Ver docs/NOTIFICACIONES.md.
Quedan fuera `push`, lo privado de cada uno (`private/…`) y las cartas «Solo nosotros».
