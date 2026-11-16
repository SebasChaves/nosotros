# Pura fruta 🍍 (juego de combinar 3)

Juego para los dos desde el primer día (no es sorpresa). Estilo tropical elegido por el dueño entre 4 prototipos
(artifact «Futari · juego de combinar 3 (prototipos)»). Es un juego **original**: nombres, frutas, especiales y niveles
propios; no copiar nombres, arte ni niveles de otros juegos del género.

## Archivos
- `fruta-engine.js`: motor sin pantalla (también lo usa Administración → Juegos y las pruebas en Node).
  - `createGame(level, seed)`, `play(st, a, b)` → pasos para animar (`swap`, `clear`, `fall`, `pinas`, `shuffle`, `bonus`),
    `hammer`, `shuffle`, `findMove` (pista), `botMove` / `simulate(level, runs)` (jugador automático y dificultad).
  - `levelSpec(L)`: los 100 niveles generados con semilla. `MOVES` = movimientos calibrados.
  - `dailySpec(day)`: reto del día (25 movimientos, gana más puntos).
- `fruta.js`: pantalla, animaciones (cada fruta es un div con `transform`), progreso, reto del día y duelo.

## Reglas
- Frutas: 🍊 🍉 🫐 🍇 🍋 🥭 (4 a 6 colores según el nivel).
- Especiales: 4 en línea → machete (`h`/`v`, corta fila o columna) · L/T → coco explosivo (`b`, 3×3) · 5 en línea → flor
  (`f`, un color entero) · cuadrito 2×2 → lapa (`l`, se lleva una casilla que ayude al objetivo).
- Combinaciones de dos especiales: cruz, 3 filas + 3 columnas, 5×5, flor + especial (todo ese color se vuelve ese especial),
  flor + flor (todo el tablero), lapa + especial (lo lleva a una casilla útil).
- Obstáculos: hojas (1-2 capas, se limpian jugando encima), piedras (1-2 golpes, se rompen con jugadas al lado o
  explosiones), bejucos (amarran la fruta: no se mueve hasta hacer una jugada con ella), piñas (bajarlas al fondo).
- Estrellas: 3 si sobran ≥30 % de los movimientos, 2 si ≥10 %, 1 si se gana. Lo que sobra se vuelve machetes (puntos).
- Monedas para la mascota: 5 (niveles 1-10), 10, 20 (jefes) la primera vez; +10 al primero del reto del día.
  Ayudas: martillo 10, mezclar 8, +5 movimientos 15, lapa 12 (se pueden cambiar en Administración → Juegos).

## Datos (colección `fruta`)
- `p-<uid>`: `{ lv, ls{n: estrellas}, best{n: puntos}, dw }`
- `d-<día>`: `{ <uid>: { score, at, help } }`
- `duel`: `{ did, level, seed, from, to, state: invite|on|done|declined|cancelled, at, p{uid:{won,left,score,at}}, winner }`.
  Cada uno juega una vez; gana quien lo pase con más movimientos de sobra (si no, más puntos).
- `lv-<n>`: `{ on, level{…} }` nivel editado en Administración (reemplaza al generado mientras `on`).
- `msg-<n>`: `{ from, to, text }` mensaje sorpresa al pasar ese nivel. `cfg`: `{ helps{…}, coins{easy,normal,boss} }`.

## Calibrar la dificultad
Los movimientos de `MOVES` salen de buscar, nivel por nivel, el mínimo con el que el jugador automático gana una tasa
objetivo (de ~95 % en el nivel 1 a ~42 % en el 100; jefes 8 puntos menos), más 15 % y 2 de margen (mínimo 18 en los
primeros 10 y 15 después). Si cambias el generador, recalibra con `simulate()` (ver PENDIENTES para el script).

## Solo en el teléfono
Deslizar el dedo en iPhone y Samsung, que las animaciones vayan fluidas y la vibración en combos.

## Administración → 🎮 Juegos (1.6.0, `admin-juegos.js`, solo el dueño)
Para Pura fruta, Flechas y La parada:
- **Panel**: nivel y estrellas de cada uno; mostrar u ocultar el juego (`<juego>/cfg.off`, se aplica con `gates`);
  BETA de Figuras/Mixto (`arrows/cfg.beta`); regalos sorpresa; saltar o reiniciar tu progreso.
- **Niveles**: Pura fruta con tablero dibujado (`fruta/lv-<n>.level`); Flechas (`arrows/lv-<n>.params { n0, maxLen, mods, seed }`,
  aplicado en `liveLevel`) y La parada (`bus/lv-<n>.params { w, h, count, colors, diag, seed }`, en `liveBusLevel`). Probar el
  borrador sin guardar, «probar 200 veces» (solo Pura fruta, con `simulate`), publicar, despublicar, volver al generado,
  copiar a otro número e intercambiar dos niveles.
- **Estadísticas**: `<juego>/stats { a{n}, w{n} }` (intentos al empezar un nivel de la escalera, ganados al pasarlo) y niveles pared.
- **Reto programado**: `<juego>/day-<día> { num }`: ese día el reto usa el tablero de ese nivel.
- **Sorpresas**: `<juego>/msg-<n> { from, to, text }`: sale en «¡Nivel listo!» cuando la pareja lo pasa.
- **Economía**: `<juego>/cfg` (monedas por nivel y precio de ayudas; vacío = el de siempre).

### Niveles nuevos (1.7.0)
«＋ Nivel nuevo» crea el siguiente número después del último (101, 102… en Pura fruta y La parada; 91, 92… en Flechas), en
`<juego>/lv-<n>` con `on: true`. Cuentan mientras estén publicados y seguidos (`totalLevels` / `busTotal` / `arrowsTotal`):
salen en «✨ Niveles nuevos» al final del mapa y se desbloquean en orden. Solo se puede quitar el último. Si la pareja ya había
terminado todos, le llega un aviso (La parada solo si ya se regaló). En Flechas se juegan antes del modo infinito.

## Ayuda disimulada (1.7.2) — no mencionarla en Novedades ni en la guía
Si un nivel de la escalera se pierde varias veces seguidas (`fruta/p-<uid>.fl{nivel}`: sube al salir el «¡Casi!» y vuelve a
0 al ganar), el siguiente intento lleva `assist` (3 seguidas → 1, 5 → 2, 7+ → 3) en `createGame(level, seed, assist)`:
- tablero inicial = el mejor de 1 + 3·assist candidatos (`boardValue`: jugadas posibles, especiales a mano, frutas del objetivo);
- 10/17/25 % de las frutas nuevas caen del color del objetivo que falta o igual a la vecina (más cascadas);
- piñas un poco más seguido.
Nada visible cambia (movimientos, objetivos, obstáculos). Nunca en el reto del día, duelos ni pruebas. Se apaga en
Administración → Juegos → Panel (`fruta/cfg.assist = false`), donde también se ve en qué niveles tiene ayuda cada uno.
Medido con el jugador automático: en niveles difíciles pasa de ~25-45 % de victorias a ~80-90 % con la ayuda máxima.
