# Calendario de adviento (1.13.0)

Pantalla `s-advent` (`advent.js`), tarjeta «🎄 Calendario de adviento» en Inicio y mosaico en Más. Es para los dos desde
que se publicó (no es sorpresa del dueño).

## Cómo funciona

- **Temporada:** se ve del 15 de noviembre al 31 de diciembre (`gates['s-advent'] = adventSeason`). Fuera de esas fechas
  desaparece de Más, de la barra, del buscador y de Inicio.
- **Abrir:** del 1 al 24 de diciembre cada uno abre su casilla del día; las de días pasados también se pueden abrir, las
  futuras no (`canOpen`). Del 25 al 31 la tarjeta de Inicio solo sale si quedan casillas sin abrir.
- **Contenido:** si la pareja llenó esa casilla, trae lo suyo (nota, cupón, foto o plan). Si no, trae la sorpresa del día
  de `ADVENT_DEFAULTS` (`data.js`: 24 retos, preguntas y planes navideños, iguales para los dos).
- **Al abrir:** confeti, +5 🪙 a la mascota (`ADV_COINS`, si ya nació), cuenta para la racha (`markActive`) y, si era algo
  de la pareja, le llega el aviso «abrió la casilla N». Un **cupón** se crea en `coupons` como regalado por quien lo llenó
  (`fromAdvent: día`). Una **foto** se puede guardar en Momentos.
- **Llenar:** pestaña «Para <pareja>», del 15 de noviembre al 24 de diciembre (`canFill`). Se puede cambiar o vaciar
  hasta que la pareja la abra; después queda en modo lectura con «👀 la abrió el…». Al llenar una casilla nueva le llega
  a la pareja un aviso sin el contenido (como mucho uno cada 15 minutos).
- **Puntito:** solo la casilla de **hoy** sin abrir (`adventToday()`, en la lista de avisos de `alerts.js`). `adventReady()` (todas las que ya se pueden abrir y no has abierto) se usa en la tarjeta de Inicio y en el subtítulo de Más.

## Datos (colección `advent`, en `COLLECTIONS` y en `BACKUP_COLS` del Worker)

| Doc | Campos |
|---|---|
| `f-<año>-<uid de quien llena>-<dd>` | `year, day, by, to, type nota/cupon/foto/plan, text, emoji, photo, at, savedMoment?` — foto en `photos/adv-<año>-<uid>-<dd>` (+ miniatura `t-…`) |
| `o-<año>` | `{ <uid>: { <dd>: ms } }` — casillas que abrió cada uno |

El año va en el id: el próximo diciembre empieza limpio y lo de este año queda guardado. Lo que deja uno lo podría leer
el otro desde la consola de Firebase (como las notas programadas); en la app no se ve antes de tiempo.

## Regalitos (1.17.0, `advent-gifts.js`)

Tercera pestaña «🎁 Regalitos» (`view = 'gifts'`). Los dos se dan un regalito físico por día, del 1 al 24 de diciembre.

- **Mi lista** (privada, la pareja no la puede leer ni con las reglas):
  `private/<uid>/regalitos/r-<año>-<dd> = { year, day, text, emoji, price, store, status: idea|comprado|envuelto, at }`.
  «✅ Lo abrió» no se guarda: sale de `o-<año>` (que la pareja abrió esa casilla).
- **Lo compartido**: `advent/g-<año>-<uid de quien regala>-<dd> = { year, day, by, to, hint, at, react?, thanks?, reactAt?, reactSeen?, fav?, moment? }`.
  - Se crea al guardar el regalito, así que la pareja ve 🎀 en esa casilla.
  - La pista (`hint`) solo se muestra al abrir la casilla (`regalitoBlock`, cuando `canOpen(d)`).
  - Quien recibe escribe `react`, `thanks`, `fav` (solo uno por año), y `moment` (la foto se guarda en Momentos).
  - `reactSeen: false` = aviso en la campana de quien regaló; pasa a `true` al ver la pestaña.
- **Rango de precio** de los dos: `couples/nosotros.adv.range = { min, max }` (por defecto ₡1.000 – ₡2.000). Un precio fuera del rango
  avisa, pero no se bloquea.
- **Ideas** (`IDEAS`, ~50 con precio aproximado): se filtran por el rango y salen tenues las que ya usaste.
  «Sorpréndeme» elige una que no hayas usado.
- **Por comprar**: lo que está en «Idea», agrupado por tienda.
- **Recibidos** (en diciembre) y, desde el 24, **Resumen**: los que regalaste, lo gastado, lo recibido y el favorito de cada uno.
- **Avisos** en la campana (`regalitoAlerts`, sección `s-advent`):
  - el regalito de hoy o de mañana sin comprar;
  - después de las 6 p. m., «envuelve el de mañana» (si está comprado);
  - las reacciones de la pareja.
  - Al teléfono solo llegan las reacciones, los agradecimientos y los cambios del rango (tipo `advent`). El Worker no manda nada programado de regalitos.
- **Tarjeta de Inicio**: una línea «🎁 X de 24 regalitos listos» (en noviembre), o con el de mañana (en diciembre).
- Cada casilla muestra el **día de la semana** (`wdShort`); las hojas dicen «martes, 1 de diciembre» (`dayLong`).

## Avisos (tipo `advent`, se apaga en Ajustes → Notificaciones)

- **8:00, del 1 al 24 de diciembre** (Worker v16, `runSchedule` → 3b): «🎄 Tu casilla N está lista», y si la pareja la
  llenó, «te dejó algo adentro 💝». Lee solo 2 docs (`getMany`).
- Desde la app (`push.js`): cuando la pareja llena una casilla y cuando abre una que le llenaste.
- `?open=advent` abre la pantalla.

## Probar

En el emulador, `?advHoy=AAAA-MM-DD` simula otro día (solo con `?emu`): por ejemplo
`http://localhost:5173/?emu=8081&advHoy=2026-12-07`. Ver docs/PRUEBAS.md.
