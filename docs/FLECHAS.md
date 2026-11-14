# Flechas (juego sorpresa)

Juego de sacar flechas del tablero (`arrows.js`, pantalla `s-arrows`). Lo pidió el dueño como **sorpresa para su pareja**:
mientras no lo regale, solo él lo ve. **No lo menciones en las novedades (`version.json`) ni en la guía** hasta que el
dueño diga que ya lo regaló.

## Error de las figuras que «atravesaban» flechas (resuelto en v52)

**Síntoma (lo vio el dueño en el iPhone):** en una figura de cubitos pegados, una flecha con otra enfrente en el cubito
vecino salía igual. **Causa real:** `newGame()` creaba el arreglo de ocupación `G.occ` con tamaño `6 × N²` (pensado para el
cubo). Las figuras tienen más paneles (caja 10, dona 32…), así que las casillas de los paneles 7 en adelante nunca se
marcaban y el juego las veía vacías: en la versión publicada, 298 de 818 flechas de prueba no veían un choque real. Ahora
`G.occ` mide `board.base.length` (paneles × N²). Comprobado: 0 de 802.

**También se cambió el toque** (`cubeTap` → `cubePick`): ya no depende de qué dibujo SVG queda bajo el dedo. Proyecta las
casillas de los paneles que miran a la cámara con la misma rotación, zoom y perspectiva que el CSS (`cubeProjector`,
`PERSPECTIVE = 1600` igual que `.ar-vp3`), elige la casilla del panel más cercano y, si está vacía, la flecha más cercana
de ese panel. Los paneles casi de canto (orientación < 0,2) no aceptan toques. Prueba: 2.036 de 2.036 toques dentro de
flechas eligieron la correcta.

**La pista también cambió** (`G.focusFace(panel, id)`): prueba ángulos (empezando por ver la cara de frente) hasta uno
donde `cubePick` en la punta devuelve esa flecha, porque en la dona o los rincones la cara de frente puede quedar tapada
por otra parte de la figura. Antes, con el error de ocupación, una flecha tapada se dejaba sacar igual y no se notaba.
Resueltas completas en el emulador, tocando el centro de la punta tras cada pista: L, escalera, cruz, cajón, dona y figura
rara, todas con 0 errores.

**Movimiento en las figuras (v53):** antes la punta se deslizaba recta y el resto se desvanecía (flechas con curva
«tiesas», partes que quedaban atrás o que se metían bajo la figura). Ahora `cubeMove` hace lo mismo que el plano: arma el
camino completo (cuerpo + casillas del camino + salida al aire más allá de la arista, en el plano de su cara) con
`seqPieces`, dibuja trazos temporales en cada panel por el que pasa y en cada cuadro muestra solo el tramo que ocupa la
serpiente (`stroke-dasharray`); la punta se dibuja donde va, siguiendo el camino. Al chocar, avanza hasta la flecha que
la bloquea y regresa.

**Para probar en el emulador:** `window.__arrowsG()` devuelve el estado del juego (solo con `?emu`) y `cubePick` /
`cubeProjector` están exportados. Pruebas usadas: comparar `a.ray` contra `G.occ` (que el juego vea todos los choques) y
tocar puntos dentro de cada casilla de una flecha (que se elija esa flecha).

**Pendiente:** que el dueño lo confirme en el iPhone. Si va bien, se le puede quitar el «BETA» a Figuras y Mixto.

## Sorpresa / regalo

- `couples/nosotros.features.arrows = { on, at, by, msg }`. `isOwner()` (TESTERS; en el emulador, el primero que entró a
  la pareja = Ana) lo ve siempre; la pareja solo si `on`.
- `gates['s-arrows']` y `gates['notif:arrows']` (core.js) esconden la sección, el buscador, la barra y el aviso en Ajustes.
- Al regalarlo (Administración → Pruebas → 🎁 Sorpresa: Flechas → «Envolver y regalar») a la pareja le llega
  «🎁 Tienes un regalo en Futari» (`?open=gift`) y le aparece **envuelto**: tarjeta en Inicio, mosaico en Más y fila en los
  juegos de la mascota. Al abrirlo (3 toques a la caja) ve el mensaje del dueño y queda `profiles/<uid>.prefs.unwrapped.arrows`.
- Probado en v50 (emulador): antes de regalar la pareja no ve nada (Más, Inicio, buscador, Ajustes, juegos de la mascota,
  ni entrando directo); después ve el regalo, lo abre desde el aviso, y su pantalla **no tiene** la zona de pruebas ni el
  aviso de sorpresa. Administración muestra cuándo lo abrió. Cuando se regale de verdad, se puede agregar una nota en
  `version.json` y un paso en la guía (`tour.js`) si el dueño quiere.

## Modos

| Modo | Qué es | Progreso (`arrows/p-<uid>`) |
|---|---|---|
| 📄 Plano | Escalera de 90 (`levelSpec`): 1–5 de ~30 flechas, desde el 6 de 300 a ~700, jefe 👑 cada 10, obstáculos por nivel (`MOD_FROM`). Después del 90, infinito | `lv`, `ls`, `lx`, `inf` |
| 🧊 Figuras **BETA** | 30 figuras 3D de cubitos (`cubeSpec`, `FIG_PLAN`, `SHAPES`) | `cv`, `cs` |
| 🔀 Mixto **BETA** | 30 niveles, uno de cada 3 es figura (`mixSpec`) | `mv`, `ms` |
| 🗓️ Reto del día | Mismo tablero para los dos; crece en la semana | `arrows/d-<día>` |
| ⏱️ Contrarreloj | 5 minutos | `tt` |
| ⚔️ Duelo en vivo | Los dos a la vez, con la barrita del otro | `arrows/duel`, `dw` |
| 💀 Experto | Interruptor por teléfono (localStorage) | `lx` |

**Zona de pruebas** (solo el dueño, `testCard`): un tablero por obstáculo, todas las figuras, ir a cualquier nivel o
figura (`t:lv<n>`, `t:cv<n>`), experto, contrarreloj de 1 min y duelo contra un rival simulado. No guarda nada.

## Cómo funciona por dentro (resumen)

- **Generador** (`generate` plano, `generateShape` figuras): cada flecha tiene un «orden de salida»; una flecha nueva solo
  entra si su camino hasta el borde solo tiene flechas que salen antes. Así **siempre hay solución**. `decorate()` reparte
  candados, numeradas, bombas y encadenadas usando ese orden.
- **Figuras:** la superficie se arma con paneles N×N (una cara de cubito al aire = un panel). Camino: derecho cruzando
  paneles planos; en una arista sale, en un rincón choca (pared). Los cuerpos sí doblan aristas y rincones.
- **Dibujo plano:** una SVG con zoom/arrastre (`setupCamera`). **Figuras:** una SVG por panel con `matrix3d`
  (`cubeHTML`, `setupCube`), bordes solo en aristas/rincones reales.
- Partida a medias en localStorage `futari-arrows-<clave>`. Un doc de Firestore **no puede tener un campo `id`**.
