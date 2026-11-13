# Arquitectura

Una sola página (`index.html`) con todas las pantallas como `<section class="screen">`. Solo una tiene la clase
`active`. Cada módulo JS se encarga de una sección: pinta su HTML, escucha sus colecciones de Firestore y
expone las funciones que usan sus botones.

```
index.html      cascarón: pantallas de carga / login / config, <main> con las <section>, barra de pestañas,
                hoja de abajo (#sheet), visor de fotos (#viewer), toast, y el sprite de íconos SVG (<symbol id="i-...">)
styles.css      todo el diseño ("Aurora": fondo oscuro con luces de color, tarjetas de vidrio). Tema claro con body[data-theme="light"]
core.js         núcleo: Firebase, estado S, render, navegación, hojas, diálogos, fotos, fechas, gestos
app.js          arranque: sesión, listeners de Firestore, puntitos de la barra, versión/novedades, cambio de contraseña
sw.js           service worker (caché para funcionar sin internet)
version.json    versión publicada + notas de novedades (ver PUBLICAR.md)
manifest.json   PWA (nombre, íconos, colores)
```

## Módulos

| Archivo | Sección / función |
|---|---|
| `home.js` | Inicio: contador de días, tarjeta urgente, tarjeta **Hoy** (resumen de pendientes), ánimo, pregunta del día, reto semanal, próximas fechas, rachas, "Pensando en ti" |
| `decide.js` (+ `data.js`) | ¿Qué hacemos?: listas con modos al azar / por turnos / match, y ruleta de ideas de citas |
| `moments.js`, `daily.js` | Momentos (línea de tiempo con fotos, galería) y Foto del día (la de la pareja se revela al subir la tuya) |
| `love.js` | Detalles: frasco de notas y cupones canjeables |
| `snaps.js` | Instantáneas: fotos rápidas de 24 h con texto, reacciones, respuesta y «Guardar en Momentos»; tarjeta de Inicio y pestaña en Momentos |
| `pet.js`, `pet-art.js`, `pet-games.js` | Mascota: huevo que nace a los 3 días comidos y crece por etapas con la racha; triste si ayer no comió (no pierde lo crecido). Pantalla `s-pet` con Vestir, Tienda (monedas de los dos) y Juegos. `pet-art.js` dibuja en SVG (estilo mochi, 10 animales, ropa, escenario por hora); `pet-games.js` tiene los 4 juegos (canvas) |
| `cravings.js` | Antojos (`s-cravings`): pedir (😌 normal / 🔥 urgente con aviso llamativo y diálogo al abrir la app), «Algún día» → calendario, Cumplidos (foto, ❤️ gracias, Momentos) y Ruleta con favoritos; tarjeta de urgentes y filas en Hoy |
| `arrows.js` | Flechas (`s-arrows`): rompecabezas de sacar flechas: líneas con curvas que avanzan como serpiente; generador con solución garantizada (orden de salida, ver comentario) y semilla por nivel/día; 90 niveles en una escalera (`levelSpec`: 1–5 de ~30 flechas, desde el 6 de 300 a ~700, jefe 👑 cada 10, obstáculos que se estrenan por nivel según `MOD_FROM` y luego salen en ~1 de cada 3-4, máximo 2 + piedras), 🧊 figuras 3D de cubitos (`generateShape` + `SHAPES`: cubo, caja, cajón, torre, L, escalera, cruz, dona y al azar; cada cara de cubito al aire es un panel de N×N; el camino de una flecha sigue derecho por paneles planos hasta una arista (sale) o un rincón (pared: nunca sale por ahí); los cuerpos doblan aristas y rincones; tres modos: 📄 Plano (escalera de 90, solo plana: `CUBES_IN_LADDER` vacío), 🧊 Figuras BETA (`cubeSpec`, 30 niveles según `FIG_PLAN`) y 🔀 Mixto BETA (`mixSpec`, 30 niveles, uno de cada 3 es figura); dibujo con una SVG por panel en `matrix3d`, se gira arrastrando, el toque usa `elementsFromPoint` y elige el panel más cercano a la vista; botón 👁️ para ver a través), modo infinito después del 90 y reto del día (crece en la semana); tablero SVG con zoom de dos dedos; 3 vidas que se recuperan cada 50 flechas o con 15 🪙. Obstáculos (`MODS_INFO`, aparecen por nivel difícil y por día de la semana): piedras, hielo, candados/llaves, numeradas, bombas, encadenadas, giratorias (mantener para girar), portales y niebla; todos se reparten con el orden de solución, así que siempre hay salida. Modos: 💀 experto, ⏱️ contrarreloj y ⚔️ duelo en vivo (doc `arrows/duel`). El dueño tiene una «🧪 Zona de pruebas» en la pantalla (`testSpec`, `playArrows('t:<obstáculo|all|xp|tt|duel>')`): tableros chicos que no guardan nada ni mandan avisos; el duelo de prueba es contra un rival simulado. **Ojo:** un doc no puede tener un campo `id` (lo pisa `S.data`). Es una **sorpresa**: `gates` (core.js) lo esconde a la pareja hasta que el dueño lo regala desde Administración → Pruebas (`features.arrows` en el doc de la pareja); entonces le sale envuelto (Inicio, Más, juegos de la mascota) hasta que lo abre |
| `arrows.js` (detalle) | Ver docs/FLECHAS.md |
| `menu.js` | Tu menú: secciones en la barra de abajo (1 a 4), orden y ocultas de Más (`prefs.menu`), editor de Ajustes y puntitos por sección (`sectionAlerts`) |
| `guess.js` | «¿Qué respondería tu pareja?»: pregunta diaria de 4 opciones, tarjeta en Inicio, historial de aciertos |
| `week.js` | Resumen de la semana (lunes a domingo): tarjeta en Inicio domingo y lunes, hoja con números, comparación y mosaico de fotos |
| `tour.js` | Guía de bienvenida. `TOUR_VERSION`: si alguien ya vio una versión anterior le sale una vez «Lo nuevo» (`NEW_STEPS`). Al agregar algo grande, súmalo a los pasos y sube la versión |
| `push.js` (+ `push-config.js`) | Notificaciones: activar en el teléfono, `notify()` a la pareja, preferencias y `?open=` al tocar un aviso (docs/NOTIFICACIONES.md) |
| `settings.js` | Pantalla **Más** (mosaico de secciones) y **Ajustes** (nombre, fecha, moneda, acento, tema, avatar, fondo, PIN, respaldo) |
| `lists.js` | Bucket list, súper y la función `backBar()` (barra superior con botón Volver) |
| `money.js` | Gastos compartidos y balance |
| `places.js` | Restaurantes (ubicación, cerca de mí, Google Maps/Waze, calificaciones, visitas) |
| `trips.js`, `booking.js` | Viajes (itinerario, maleta, presupuesto) y búsqueda de hospedaje/vuelos con enlaces a Airbnb, Booking, etc. |
| `calendar.js` | Calendario compartido, planes que se repiten, exportar a calendario del teléfono (.ics / Google) |
| `shows.js` | Pelis y series con TMDB (póster, dónde verla, sugerencias) |
| `music.js` | Playlist: búsqueda en iTunes (portada + adelanto), nuestra canción, dedicatorias, botones a Spotify/YT Music/Apple |
| `reminders.js` | Recordatorios (normales en Hoy desde su fecha; urgentes arriba en Inicio) y alarma vía .ics |
| `recipes.js` (+ `recipes-data.js`) | Recetario (46 incluidas + propias), favoritas, menú semanal → súper |
| `map.js`, `location.js` | Mapa (Leaflet + OpenStreetMap) con pines, fotos con ubicación y restaurantes; `location.js` = campo de ubicación reutilizable, lectura de GPS de la foto (EXIF), distancias |
| `games.js` (+ `games-data.js`) | Juego de retos en un teléfono (verdad o reto, etc.) |
| `quiz.js`, `us.js`, `summary.js`, `badges.js` | Quiz de pareja, gustos + ideas de regalo privadas, resumen del año, logros |
| `search.js`, `tour.js` | Buscador global y guía de bienvenida |
| `lock.js` | PIN opcional por teléfono (hash SHA-256 en localStorage) |
| `tracking.js`, `admin.js`, `testing.js` | Registro de ingresos, errores y tiempo por sección; Administración (solo `TESTERS`) con pestañas Ingresos, Estadísticas (uso, notificaciones, quién hace más) y Pruebas (mascota de pruebas con todo desbloqueado y sin guardar nada, avisos, herramientas, zona de pruebas) |

## El núcleo (`core.js`)

**Estado:** `S = { me, settings, data: {colección: [docs]}, priv: {gifts: [...]}}`. `app.js` mantiene `S.data` al día con
un `onSnapshot` por cada nombre en `COLLECTIONS`. Cada doc trae su `id`.

**Repintar cuando cambian los datos:**
```js
on('songs places', render);          // se llama al cambiar esas colecciones ('*' = cualquiera)
onShow('s-music', render);           // se llama al entrar a la pantalla
```
Patrón habitual para no pintar pantallas ocultas:
`on('songs', () => { if ($('s-music').classList.contains('active')) render(); });`

**Pintar sin perder lo que el usuario escribe:** `paint(idOElemento, html)` conserva valores y foco de los inputs
con `id`. Si una pantalla tiene un formulario y una lista que se actualiza, separa encabezado y cuerpo en dos
contenedores (ver `decide.js`: `decideHead` / `decideBody`). `data-fresh` en un input = no conservar su valor.

**Botones:** el HTML usa `onclick="miFuncion('id')"`; al final del módulo `expose({ miFuncion })` las pone en `window`.
Ojo con nombres repetidos entre módulos (todas viven en `window`). Para textos dentro de atributos usa `esc()`; para
pasar textos libres a un `onclick` mejor pasa un índice o un id (un apóstrofo rompe el JS).

**Escribir en Firestore:** `write(promesa)` muestra un toast si falla y no espera al servidor (funciona sin internet).
Referencias: `ref('col', id)`, `newRef('col')`, `col('col')`, `privRef/privCol` (privado por usuario), `coupleRef` (doc de la pareja).

**Interfaz:**
- `openSheet(html)` / `closeSheet()`: hoja que sube desde abajo (formularios). Se cierra arrastrándola hacia abajo.
- `ask(mensaje, {ok, cancel, danger})` → `Promise<boolean>`: confirmación propia. Si el texto empieza con
  "¿Borrar…", "¿Quitar…" o "¿Cerrar sesión…" el botón sale en rojo automáticamente. **No usar `confirm()`/`alert()`.**
- `toast(texto)`, `celebrate('confetti' | 'hearts')`, `animatePick(items, mostrar, fin)` (sorteo animado).
- `icon('nombre')` → `<svg><use href="#i-nombre">`. Los íconos están en el sprite de `index.html`.
- `backBar(título, pantallaDestino, botonesExtra)` (en `lists.js`) para subpantallas: incluye el botón con
  `aria-label="Volver"`, que el botón atrás de Android usa para saber a dónde ir.

**Navegación:** `go('s-xxx')` con animación de deslizar según la dirección. La barra de abajo la arma cada uno
(Ajustes → Tu menú, `menu.js`): siempre `s-home` y `s-more`, y en medio de 1 a 4 secciones de `SECTIONS` (`core.js`;
por defecto Decidir, Momentos y Detalles). `setBar()` la dibuja (copia en localStorage `futari-bar`), `barIds()`/`inBar(id)`
dicen qué hay. Se puede deslizar el dedo entre las pestañas de la barra. La pestaña marcada de una pantalla se deduce de su
botón Volver (`tabOf`): por eso toda subpantalla usa `backBar(título, pantallaPadre)`. Una sección puesta en la barra
esconde su Volver (`.screen.in-bar`, CSS). Decidir/Momentos/Detalles usan `mainTop(id, título)`, que les pone Volver
(a Más) solo cuando no están en la barra. Si agregas una sección nueva, súmala a `SECTIONS` y a `SUB` en `renderMore`. Para esconder una sección o un tipo de aviso a
alguien, registra `gates['s-xxx']` / `gates['notif:tipo']` (ver `arrows.js`): la barra, Más, el buscador y Ajustes lo respetan.

**Atrás (Android):** `syncBack()` deja una entrada en el historial mientras haya algo que cerrar o una pantalla a la
que volver; el gesto atrás la consume y `goBack()` cierra diálogo → visor → hoja, o pulsa el "Volver" de la pantalla,
o vuelve a Inicio. Si agregas otro tipo de ventana superpuesta, inclúyela en `overlayOpen()` y `goBack()`.

**Fotos:** ver docs/DATOS.md. Helpers: `compressImage(file, lado)`, `makeThumb`, `loadPhotos(contenedor)` (carga
perezosa de `<img data-photo="id">` / `<img data-thumb="id">`), `viewPhoto(img)`, `photoError(e)`.
En Android y iPhone, al tocar cualquier `<input type=file accept="image/*">` se pregunta "Tomar foto / Elegir de la galería".
"Tomar foto" abre la **cámara propia** (`openCamera` en `core.js`: `getUserMedia`, dispara al instante, botón ⇋ Espejo
y 🔄 Girar; si no hay permiso ofrece la cámara del teléfono). El archivo resultante llega al `<input>` original con su
evento `change`, así que no hace falta hacer nada extra.

**Fechas:** siempre como texto `'AAAA-MM-DD'` (`todayKey()`, `dayKey(d)`, `parseDate(s)`), en hora local.

## Cómo agregar una pantalla nueva (lista de pasos)

1. `index.html`: `<section class="screen" id="s-nueva" data-tab="more"></section>` (y un `<symbol id="i-...">` si necesita ícono).
2. Crear `nueva.js` con `render()` que use `paint('s-nueva', backBar('Título', 's-more', ...) + ...)`,
   `onShow('s-nueva', render)`, `on('coleccion', ...)` y `expose({...})`.
3. Importarlo en `app.js` (`import './nueva.js';`).
4. Si guarda datos nuevos: agregar la colección a `COLLECTIONS` en `core.js` (las reglas ya cubren `couples/nosotros/*`).
5. Agregarla a `SECTIONS` en `core.js` ([pantalla, ícono, nombre]) y su subtítulo a `SUB` en `renderMore` (`settings.js`):
   así sale en Más, en el buscador y se puede poner en la barra. Si tiene puntito, súmala a `sectionAlerts()` (`menu.js`).
6. Agregar el archivo a `FILES` en `sw.js`.
7. Opcional: avisos en la tarjeta Hoy (`todayCard()` en `home.js`, y sumar la colección a su `on(...)`), buscador
   (`search.js`), logros (`badges.js`), guía (`tour.js`), respaldo (lo hace solo por `COLLECTIONS`).
8. Probar con el emulador en tamaño teléfono, luego publicar (docs/PUBLICAR.md) con una nota de novedades.

## Estilos (`styles.css`)

- Variables: `--bg --panel --glass --line --text --muted --g1 --g2 --g3 --grad --on-grad --soft --field`.
  Los colores de acento están en `ACCENTS` (`data.js`, 16 opciones) y `applyAccent()` (`settings.js`) los pone como
  variables en `<body>`; "custom" arma la paleta desde un color con `accentFromColor()`. Se copian a localStorage para
  pintarlos antes de que cargue la app (script al inicio de `index.html`). **No uses colores fijos
  para cosas que deben contrastar con el acento** salvo a propósito (ej. el calendario usa `--c-plan/--c-date/--c-trip`).
- Clases base: `.glass` (tarjeta), `.stack`, `.row`, `.grid2`, `.btn` (+ `.ghost .small .danger`), `.chip`/`.chips`
  (`.scroll` = fila deslizable), `.seg` (pestañas internas), `.list` con `li`, `.check-btn`, `.del` (botón ícono
  pequeño), `.icon-btn`, `.label`, `.pill`, `.tiny .small .muted`, `.empty`, `.result-row`.
- Las casillas `input[type=checkbox]` tienen estilo propio (el check del sistema salía negro).
- Siempre respetar `env(safe-area-inset-*)` (iPhone con notch, app instalada con barra translúcida).
