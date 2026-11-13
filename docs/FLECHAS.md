# Flechas (juego sorpresa)

Juego de sacar flechas del tablero (`arrows.js`, pantalla `s-arrows`). Lo pidió el dueño como **sorpresa para su pareja**:
mientras no lo regale, solo él lo ve. **No lo menciones en las novedades (`version.json`) ni en la guía** hasta que el
dueño diga que ya lo regaló.

## ⚠️ Siguiente tarea: error al tocar en las figuras 3D (Figuras y Mixto, beta)

**Síntoma (lo vio el dueño en el iPhone):** en una figura de cubitos pegados, una flecha que tiene otra enfrente en el
cubito vecino «pasa igual». **Causa encontrada:** la regla está bien (el camino cruza las caras planas y el choque se
detecta: comprobado con 7.926 flechas contra un cálculo 3D independiente, y tocando la punta exacta siempre rebota). Lo que
falla es **qué flecha se elige al tocar**: cerca de la flecha a veces se toma la vecina (que sí estaba libre) y sale esa.
Prueba automática: tocando a ±7 px de 355 flechas de figuras, en 12 salió otra flecha.

- Código: `cubeTap()` usa `document.elementsFromPoint()` sobre las SVG de los paneles 3D y prefiere el trazo real (`.ab`,
  `.ah`) sobre el área ampliada (`.ht`, `stroke-width = C·0,7`). En v50 se cambió de «el panel más cercano» a esto; mejoró
  pero no lo quitó.
- **Idea para arreglarlo:** no depender del SVG debajo del dedo. Calcular la casilla tocada con geometría: rayo desde la
  cámara (rotación `cam.rx/ry`, escala `cam.k`, `perspective` de `.ar-vp3`) contra los planos de los paneles
  (`G.board.shape.panels`: `o, u, vv, n`), quedarse con el panel más cercano que contenga el punto, sacar `[x, y, panel]` y
  ver `G.occ`. Si cae en una casilla vacía, buscar la flecha más cercana dentro de ese mismo panel (como `arrowAt` en el
  plano). Así el toque nunca elige una flecha de otro lugar.
- Para probar: en el emulador `window.__arrowsG()` devuelve el estado del juego (solo con `?emu`). El script de prueba
  tocaba alrededor de la punta de cada flecha con caminos que cruzan de panel y contaba si salía otra flecha
  (`G.gone` antes/después). Cuando quede en 0, se le puede quitar el «BETA» a Figuras y Mixto si el dueño quiere.

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
