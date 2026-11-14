# La parada (juego sorpresa)

Juego de sacar vehículos de un estacionamiento y llevar a los pasajeros de cada color a la parada (`bus.js`, pantalla
`s-bus`). Inspirado en el estilo de juegos de «buses y pasajeros de colores» que le gusta a la pareja, con nombre, reglas y
dibujos propios. **Es sorpresa:** mientras el dueño no lo regale (Administración → Pruebas → 🎁 Sorpresa: La parada), solo
él lo ve. **No lo menciones en novedades ni en la guía** hasta que el dueño diga que ya lo regaló.

## Reglas

- Estacionamiento en 3D (CSS `preserve-3d`, plano inclinado `rotateX` · `rotateZ(-10deg)`) con autos (2 casillas, 4
  asientos), busetas (3, 6), buses (4, 10) y **autos en diagonal** (ocupan 2×2 casillas, 4 asientos). Al tocarlo sale si
  el barrido de su huella hacia adelante está libre; si choca, avanza hasta el que estorba (que parpadea) y regresa.
- Al salir sigue derecho hasta la calle que rodea el estacionamiento, la recorre y entra de frente a un **lugar de la
  parada**. La fila de pasajeros (figuritas en U arriba) sube sola, en orden, al vehículo de su color que llegó primero;
  cuando se llena, se va y libera el lugar.
- **7 lugares:** 4 abiertos y 3 con candado 🔒. Un lugar con candado se abre **solo durante ese nivel**: mandándole una
  foto a la pareja (cámara elegida o galería → `sendPhotoSnap()` de `snaps.js`, le llega como instantánea normal; el texto
  es opcional y no menciona el juego) o con 15 🪙. En el duelo no se abren. Al perder se ofrece abrir uno y seguir.
- **Se pierde** si todos los lugares abiertos están ocupados y el siguiente pasajero no tiene vehículo de su color.
- **Ayudas** (monedas de la mascota): 🔀 acomodar la fila (20: pasa adelante a los colores que ya están en la parada),
  🏗️ grúa (25: saca cualquier vehículo). 💀 Experto: sin ayudas de monedas (la foto sí vale); interruptor por teléfono,
  localStorage `futari-bus-expert`. Estrellas: 3 sin ayudas ni fallas (abrir con foto no cuenta como ayuda; con monedas sí).

## Dibujo y cámara

- `layout()` da las medidas del plano: fila arriba, 7 lugares, calle de arriba, estacionamiento (`C = 34` px por
  casilla) y la calle alrededor. `fit()` mide marcas invisibles (`.mk`) en las esquinas ya proyectadas en 3D y ajusta
  escala y centro para que **todo el tablero quepa** en la pantalla; en tableros altos baja la inclinación (47° → 39°)
  si así los vehículos salen más grandes. Se recalcula al girar o cambiar el tamaño.
- Vehículos: `<button class="v3">` con capas apiladas (`translateZ`) de esquinas redondas: carrocería, cintura, vidrio y
  techo; ruedas `.whl` (no `.wheel`: esa clase ya existe en la ruleta). El número va contra-girado para leerse siempre.
- Animaciones con `requestAnimationFrame` (`animate()`, se cortan solas si se cierra el juego): arranque con un
  pequeño hundimiento, recorrido suave (`smooth()`, esquinas redondeadas) con aceleración y frenado, rebote al llegar.
- Probado en el emulador: en los niveles 1, 6, 30, 60 y 100 el toque en el centro de cada vehículo cae en ese vehículo.

## Siempre tiene solución

`generateLot()` coloca los vehículos con el mismo truco que Flechas (orden de salida: uno nuevo solo entra si su camino
—el barrido de su huella— solo tiene vehículos que salen antes), así que siempre hay un orden para sacarlos. La fila se
arma simulando a alguien que los saca en ese orden con `slotsGen` lugares (≤ los 4 abiertos): cada pasajero es del color
de un vehículo que esa persona tiene en la parada. Probado: los 100 niveles se resuelven con ese orden.

## Modos y niveles

- **100 niveles** (`levelSpec`), la dificultad sube rápido: 6, 8 y 10 vehículos en los primeros tres; luego de 12 a ~56
  en tableros de 5×6 a 11×15; colores 2 → 6 (6 desde el 36); diagonales desde el 6 (~20 % de los vehículos al final);
  `slotsGen` 3 (un lugar de margen) solo hasta el 8; `bias` sube (la fila obliga más a pensar el orden). Jefe 👑 cada 10.
- **Reto del día** (`dailySpec`): igual para los dos, tamaño según el día (domingo y sábado los más grandes).
- **Duelo en vivo** (`bus/duel`): Rápido / Normal / Largo, cuenta regresiva, barrita del otro (pasajeros subidos). Si se
  llena la parada en el duelo, se reinicia el tablero sin parar el reloj (+15 s en el puntaje).
- **Zona de pruebas** (solo el dueño): ir a cualquier nivel, botones para cada complejidad (fácil, diagonales, medio,
  difícil, muy difícil, el último) y el reto de hoy, sin guardar nada. Ayudas y lugares 🔒 gratis; con foto se prueba
  todo el flujo pero la foto **no** se manda.

Datos: `bus/p-<uid> { lv, ls{n}, lx{n}, dw }`, `bus/d-<día> { <uid>: { ms, moves, help, fails, at } }`, `bus/duel`.
Las fotos para abrir lugares son instantáneas normales (`snaps`, `photos`). En el emulador `window.__busG()` devuelve el
estado del juego.

## Regalo

El sistema de sorpresa es común a los juegos (`gifts.js`, `GIFTS`): `features.bus`, envuelto en Inicio, Más y juegos de
la mascota hasta que la pareja lo abre (`prefs.unwrapped.bus`). Probado en el emulador (regalo, versión limpia para la
pareja y duelo completo).

## Falta probar en el teléfono

Que el 3D vaya fluido en los dos teléfonos con ~55 vehículos (nivel 100), que tocar los vehículos se sienta bien en los
tableros grandes (11×15) y que abrir un lugar con la cámara (de Futari o del teléfono) funcione en iPhone y Android.
