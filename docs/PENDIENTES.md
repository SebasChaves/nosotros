# Pendientes, servicios externos y trampas conocidas

## Pospuesto por el dueño (no lo hagas sin que lo pida)

- **Blindar los registros de administración.** Hoy `visits` y `errors` están en `couples/nosotros/` y ambas cuentas
  podrían leerlos. La idea: moverlos fuera de `couples/` y limitar la lectura al uid del dueño con reglas.

## En curso

- **Flechas, figuras 3D:** arreglado en v52 (las flechas atravesaban a otras de otro cubito porque la ocupación solo
  cubría 6 paneles; y el toque ahora se calcula con geometría). Falta que el dueño lo confirme en el iPhone y decida si
  quitar el «BETA» de Figuras y Mixto. Detalle en docs/FLECHAS.md.

## Pendiente de confirmar

- **Cambio de contraseña dentro de la app:** `app.js` maneja `?mode=resetPassword&oobCode=…`. Funciona solo si en
  Firebase → Authentication → Templates → Restablecimiento de contraseña → "Personalizar URL de acción" está puesta la
  URL de la app. Confirmar con el dueño si ya lo hizo.
- Ventanas de confirmación en iPhone (eliminar canción, reiniciar votos): se rehicieron porque no respondían; falta
  que lo confirmen en el iPhone.
- Calendario de Samsung (compartir .ics), cámara y fotos pesadas en el Android de la pareja.
- Cámara propia (v31) en los dos teléfonos: permiso de cámara en la app instalada (iPhone puede volver a pedirlo),
  cambiar adelante/atrás, espejo, y que la foto salga derecha (no de lado).
- Instantáneas (v32): acceso directo «Instantánea» del ícono en Android (puede tardar hasta un día en aparecer en la
  app instalada); en iPhone no existen esos accesos directos.

- Avisos programados: confirmado en los dos teléfonos (recordatorios a su hora con la app cerrada y el teléfono bloqueado,
  desde el Worker v4 con prioridad alta). Worker v5 pegado en Cloudflare (resumen del domingo). Falta ver llegar el de las
  20:00 (racha/mascota), fechas especiales y el primer resumen del domingo.
  Ojo: un cambio en el Cron de Cloudflare puede tardar hasta 15 minutos en activarse.
- Mascota (v38): probar en los teléfonos los juegos con el dedo (Atrapa y Salta) y que se vea fluido.
- v40: que la guía «Lo nuevo» salga una sola vez en cada teléfono; aviso del resumen el domingo 19:00 (Worker v5).
- v41 Antojos: el aviso urgente 🔥 en el Samsung debe quedarse en pantalla hasta tocarlo y vibrar más (en iPhone se ve
  normal: iOS no lo permite); el diálogo «antojo urgente» al abrir la app; fotos de cumplido. «Tu menú»: barra con 4
  secciones en la pantalla más angosta, deslizar entre pestañas personalizadas y el gesto atrás de Android.
  El resumen semanal del Worker (domingo) todavía no cuenta antojos; solo la hoja de la app.
- v42 **Sorpresa Flechas** (no mencionarla en novedades ni a la pareja): escondida hasta que el dueño la regale desde
  Administración → Pruebas → 🎁 Sorpresa. Probar en el teléfono (v43, tableros de hasta 700 flechas): pellizcar para acercar/alejar,
  arrastrar sin sacar flechas por error, que tocar con el dedo atine a la flecha, fluidez con 700 flechas en el
  Samsung, que la partida siga guardada al cerrar la app, y la animación del regalo.
  v44: obstáculos (mantener presionado para girar en iPhone y Samsung, que no salga el menú del sistema), niebla,
  y un duelo en vivo real entre los dos teléfonos (la cuenta regresiva y la barrita del otro).
  v47 🧊 Cubo: confirmado en iPhone que se ve bien. v48 Figuras: probar en los teléfonos las figuras con rincones (L,
  escalera, dona) y que tocar elija la flecha de adelante; fluidez en la figura 30 (~580 flechas) y en el Samsung. Cuando se regale, se puede anotar aquí y en novedades si quieren.

## Ideas conversadas, no hechas

- Mascota: más ropa y detalles en la tienda, más juegos, que el otro vea cuando la acariciaste, ropa por temporada
  (Navidad, San Valentín). Juego de a dos (récord en pareja).
- Cartas «Ábrelo cuando…» (algunas bloqueadas hasta una fecha) y cápsula del tiempo.

- Más accesos directos al mantener presionado el ícono (solo Android; `shortcuts` en `manifest.json`). Ya está
  «Mandar instantánea» (`./?snap`, v32). Hay maqueta (`accesos-directos-futari.html`). Widgets reales no son posibles en una app web.
- Ligar una canción a un momento. Actualizar la guía (`tour.js`) con lo nuevo (deslizar pestañas, recordatorios, urgentes).
- Panel de administración: secciones más usadas, tiempo por visita, quién agrega qué, velocidad de carga, aviso de
  errores nuevos, mensaje para la pareja.
- Otras: cartas "Ábrelo cuando…", tareas de la casa, metas de ahorro, check-in semanal, test de lenguajes del amor,
  cambiar la URL a /futari o dominio propio.

## Servicios externos (todos gratis, sin cuenta salvo TMDB)

| Servicio | Uso | Notas |
|---|---|---|
| TMDB | buscar pelis/series, pósters, dónde verlas, sugerencias | clave de solo lectura en `tmdb-config.js`; mostrar el aviso de atribución |
| OpenStreetMap tiles + Leaflet 1.9.4 (unpkg) | mapa | en modo oscuro se oscurece con un filtro CSS. CARTO pide clave: no usar |
| Nominatim | buscar lugares y nombre de un punto | priorizar el país con `countrycodes` (según la moneda); sin abusar (1 búsqueda por acción) |
| iTunes Search API | portada y adelanto de 30 s de canciones | CORS abierto; artwork `100x100bb` → `600x600bb` |
| noembed.com | (antes) datos de un enlace de canción | ya casi no se usa |
| Google Fonts | Sora (texto) y Pacifico (logo "Futari") | |
| Cloudflare Workers | entregar las notificaciones (`notificaciones/worker.js`) | cuenta gratis del dueño; ver docs/NOTIFICACIONES.md |
| Airbnb, Booking, Google Flights, etc. | solo enlaces con la búsqueda armada (`booking.js`) | no hay API |

## Trampas conocidas (aprendidas a la mala)

- Un documento de Firestore **no puede tener un campo llamado `id`**: `app.js` arma `{ id: doc.id, ...datos }` y el campo
  pisa el nombre del documento (le pasó al duelo de Flechas).

**iPhone (app instalada, barra translúcida):**
- Si la página es más corta que la pantalla, iOS calcula mal el alto y sube la barra de pestañas dejando una
  franja abajo. Por eso `html`/`body` tienen `min-height` de 100% + `env(safe-area-inset-top)`. No lo quites.
- Estirar el fondo fijo (`#bgfx`) más allá del borde lo hizo verse como un cuadro: déjalo en `inset: 0`.
- Los toques en ventanas superpuestas fallaban escuchando el clic en el fondo: cada botón del diálogo tiene su propio `onclick`.

**Android (Samsung):**
- El selector de fotos nuevo no ofrece cámara → `core.js` pregunta cámara/galería (no pongas `capture` a mano).
- La cámara del teléfono tardaba en disparar y guardaba las selfies en espejo → Futari usa su cámara propia (v31).
- Fotos de 50–200 MP: decodificar reducidas con `createImageBitmap(file, { resizeWidth })`. HEIF no se puede abrir.
- Samsung cierra apps en segundo plano: al volver en <30 min se salta la animación y vuelve a la misma pantalla.
- La conexión de Firestore queda dormida al volver: se hace `disableNetwork` + `enableNetwork`.
- Samsung Internet vs Chrome: probar/recomendar Chrome (el panel de admin avisa).

**Código:**
- Todas las funciones expuestas comparten `window`: dos módulos con `delPlan` se pisaron. Usa nombres únicos.
- Repintar toda una pantalla borra lo que se está escribiendo si el input no tiene `id`, o si se repinta el contenedor
  del formulario: separa encabezado y cuerpo.
- Algo recién creado puede no estar en `S.data` hasta que llegue el snapshot (usa un "pendiente" como `pendingSel`).
- Semanas: usar `Math.floor` al calcular desplazamientos (con `Math.round` jueves a domingo caían en la semana siguiente).
- Montos: "20.000" es veinte mil en Costa Rica (`parseAmount`).
- Al editar desde PowerShell, plantillas JS con `${…}` y textos con tildes se rompen fácil: preferir la herramienta de
  edición de archivos y verificar que no queden `` `{ `` sueltos ni archivos con BOM.
