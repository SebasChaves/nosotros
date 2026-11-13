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
```

`COLLECTIONS` en `core.js` es la lista de colecciones que se escuchan en vivo y se incluyen en el respaldo.
Colecciones que **no** están en esa lista (se leen bajo demanda): `photos`, `visits`, `errors`.

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
| `lists` | listas de Decidir: `name, emoji, options[], votes: { <uid>: { opción: true/false } }` |
| `ideas` | ideas de cita propias: `t, place: 'casa'|'afuera', cost: 0-3, e` |
| `bucket`, `groceries` | `text, done, doneAt` |
| `expenses` | gastos (`amount, paidBy, split, cat, date, tripId?`) y pagos de saldo (`type: 'settle'`) |
| `places` | restaurantes: `name, kind, price 0-4, loc?{name,lat,lng}, status 'want'|'been', ratings{uid:1-5}, visits[{date,note,by}]` |
| `trips` | viajes con itinerario, maleta, presupuesto y opciones de hospedaje/vuelo (`stays`, `flights` con votos) |
| `events` | planes: `title, date, time, who 'ambos'|uid, note, repeat none/weekly/biweekly/monthly/yearly, until` |
| `snaps` | instantáneas: `by, at (ms), text, replyTo?, seen{uid: ms}, reacts{uid: {e, at}}, reactSeen?, saved?(id del momento)` — foto en `photos/snap-<id>` (+ miniatura). Duran 24 h: al abrir la app, `snaps.js` borra las vencidas y sus fotos. «Guardar en Momentos» copia la foto a un momento (`fromSnap: true`) |
| `dates` | fechas especiales: `title, date, emoji, yearly, by, createdAt, editedBy?, editedAt?` — tipos en `DATE_KINDS` (`data.js`); se crean/editan con `openFecha` (`calendar.js`), desde el Calendario o Inicio → Fechas |
| `shows` | `title, type movie|tv, year, tmdbId, poster, overview, providers[], status want|watching|seen, progress{s,e}, ratings, seenAt` |
| `songs` | `title, artist, url, thumb, preview, apple, cover?(id en photos), why, date, ours, dedication?{by,to,msg,at,seen}` |
| `reminders` | `text, date, time, for 'ambos'|uid, note, urgent, done, doneAt, doneBy` |
| `pins` | lugares del mapa: `title, kind (emoji), lat, lng, place, country, date, note` |
| `recipes`, `recipefav`, `menu` | recetas propias; favoritas (id = id de receta); menú: id = lunes de la semana, `{ days: { fecha: { almuerzo|cena: {id}|{text} } } }` |
| `quiz`, `games`, `cards` | rondas del quiz; partidas del juego; cartas propias del juego |
| `profiles` | id = uid: `avatar` (id en photos), `prefs { accent, theme, bg, myNick, partnerNick, counter{unit days|weeks|months|hours, from start|custom, date, label}, home[{id,on}] }` — todo es personal de quien lo configura; `partnerNick` cambia `nameOf()` de la pareja solo en su teléfono |

## Fotos (colección `photos`)

- Doc `{ data: 'data:image/jpeg;base64,...' }`. Límite de Firestore: **1 MB por documento**, por eso
  `compressImage()` deja cada foto en ≤ ~700 KB (lado máximo 1080–1280 px, JPEG).
- Cada foto de momento/foto del día tiene una **miniatura** `t-<id>` (~30 KB, 480 px) para listas y galería.
  `loadPhotos()` usa `data-thumb` y crea la miniatura si falta.
- Ids: momento = id del momento; foto del día = `d-<día>-<uid>`; avatar = `avatar-<uid>-<ms>`; fondo = `bg-<uid>`;
  portada de canción = `song-<id>-<ms>`; instantánea = `snap-<id>`. Al borrar el dueño, borra también su foto (y miniatura).
- Espacio gratis: 1 GB. El panel de administración muestra una estimación del uso.

## Registro de uso (`visits`, `errors`)

`tracking.js` guarda un ingreso al abrir la app o al volver tras 20 min: `uid, at, day, hour, min, os, osVersion,
model, browser, installed, app (versión)`. Los errores de JS (máx. 10 por sesión) van a `errors`. Hoy ambas cuentas
pueden leerlos (ver PENDIENTES.md). Hay un aviso en Ajustes; si agregas campos, actualízalo.

## Reglas de seguridad

`firestore.rules` (el del repo tiene correos de ejemplo; **las reales están solo en la consola de Firebase**):
- `couples/{couple}/{document=**}`: leer/escribir si el correo de la sesión está en la lista de la pareja.
- `private/{owner}/{document=**}`: además, solo si `request.auth.uid == owner`.

Cualquier colección nueva bajo `couples/nosotros/` queda cubierta sin tocar reglas. Un cambio de reglas lo hace el
dueño en la consola: dale el texto, no lo publiques tú.

## Datos locales del teléfono (localStorage)

`nosotros-accent`, `nosotros-theme` (tema antes de cargar), `futari-pin-<uid>` (huella del PIN), `futari-badges-<uid>`
(logros ya avisados), `futari-version` (última versión vista, para las novedades), `futari-resume` (pantalla para
volver rápido), `futari-last-visit-<uid>`. Firestore además usa su caché persistente (IndexedDB) para funcionar sin internet.
