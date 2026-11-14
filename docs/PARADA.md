# La parada (juego sorpresa)

Juego de sacar vehículos de un estacionamiento y llevar a los pasajeros de cada color a la parada (`bus.js`, pantalla
`s-bus`). Inspirado en el estilo de juegos de «buses y pasajeros de colores» que le gusta a la pareja, con nombre, reglas y
dibujos propios. **Es sorpresa:** mientras el dueño no lo regale (Administración → Pruebas → 🎁 Sorpresa: La parada), solo
él lo ve. **No lo menciones en novedades ni en la guía** hasta que el dueño diga que ya lo regaló.

## Reglas

- Estacionamiento visto desde arriba con autos (2 casillas, 4 asientos), busetas (3, 6) y buses (4, 10), cada uno
  apuntando a un lado. Al tocarlo sale si el camino desde su frente hasta el borde está libre; si choca, regresa.
- Al salir se estaciona en un **lugar de espera** de la parada (4). La fila de pasajeros sube sola, en orden, al vehículo
  de su color que llegó primero; cuando se llena, se va y libera el lugar.
- **Se pierde** si la parada está llena y el siguiente pasajero no tiene vehículo de su color.
- **Ayudas** (monedas de la mascota): 🅿️ lugar extra (15), 🔀 acomodar la fila (20: pasa adelante a los colores que ya
  están en la parada), 🏗️ grúa (25: saca cualquier vehículo). Al perder se ofrece «seguir con un lugar extra». 💀 Experto:
  sin ayudas (interruptor por teléfono, localStorage `futari-bus-expert`).

## Siempre tiene solución

`generateLot()` coloca los vehículos con el mismo truco que Flechas (orden de salida: uno nuevo solo entra si su camino
solo tiene vehículos que salen antes), así que siempre hay un orden para sacarlos. La fila se arma simulando a alguien que
los saca en ese orden con `slotsGen` lugares (≤ los 4 del jugador): cada pasajero es del color de un vehículo que esa
persona tiene en la parada. Probado: 240 tableros, todos se resuelven con ese orden.

## Modos y niveles

- **100 niveles** (`levelSpec`): de 6 vehículos y 2 colores a ~60 vehículos y 6 colores; `slotsGen` 3 (un lugar de
  margen) hasta el 25 y luego 4 (sin margen); `bias` sube (la fila obliga más a pensar el orden). Jefe 👑 cada 10.
- **Reto del día** (`dailySpec`): igual para los dos, tamaño según el día (domingo y sábado los más grandes).
- **Duelo en vivo** (`bus/duel`): Rápido / Normal / Largo, cuenta regresiva, barrita del otro (pasajeros subidos). Si se
  llena la parada en el duelo, se reinicia el tablero sin parar el reloj (+15 s en el puntaje).
- **Zona de pruebas** (solo el dueño): ir a cualquier nivel sin guardar; ayudas gratis.

Datos: `bus/p-<uid> { lv, ls{n}, lx{n}, dw }`, `bus/d-<día> { <uid>: { ms, moves, help, fails, at } }`, `bus/duel`.
En el emulador `window.__busG()` devuelve el estado del juego.

## Regalo

El sistema de sorpresa es común a los juegos (`gifts.js`, `GIFTS`): `features.bus`, envuelto en Inicio, Más y juegos de
la mascota hasta que la pareja lo abre (`prefs.unwrapped.bus`). Probado en el emulador (regalo, versión limpia para la
pareja y duelo completo).

## Falta probar en el teléfono

Que tocar los vehículos se sienta bien en los tableros grandes (10×14) y que las animaciones vayan fluidas.
