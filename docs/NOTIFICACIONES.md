# Notificaciones

Futari manda avisos al teléfono de la pareja (historias y su chat, reacciones, notas, «pensando en ti», canciones
dedicadas y cupones) con **Web Push** estándar. Funciona en Android (Chrome) y en iPhone con iOS 16.4 o más nuevo,
**solo con la app instalada en la pantalla de inicio**.

El plan gratuito de Firebase no puede mandar notificaciones, así que un **Cloudflare Worker** (gratis, sin
tarjeta) se encarga solo de entregarlas.

## Cómo funciona

```
Teléfono de Ana                      Cloudflare Worker                 Servicio de push (Google/Apple)   Teléfono de Beto
1. Activa en Ajustes → se suscribe y guarda su dirección en Firestore: couples/nosotros/push/<uid>
2. Ana manda algo → push.js notify() ──POST /notify──▶ verifica la sesión de Firebase de Ana
   (con su token de sesión y las               y que sea uno de ALLOWED_UIDS
    direcciones de Beto)                        cifra y firma (VAPID) ──────▶ entrega ──────────────▶ sw.js muestra el aviso
3. Beto toca el aviso → se abre Futari en ./?open=<sección> (push.js → handleOpenParam / mensaje del service worker)
```

- `push-config.js`: dirección del Worker y llave pública VAPID (no son secretas).
- `push.js`: activar/desactivar, `notify(tipo, {title, body, url, tag})`, preferencias y `?open=`.
- `sw.js`: eventos `push` y `notificationclick`. Ícono pequeño de Android: `icon-badge.png`.
- `notificaciones/worker.js`: el Worker. Sin dependencias; se pega tal cual en Cloudflare.
- `notificaciones/llaves.html`: genera las llaves VAPID en el navegador (la privada nunca sale de ahí).
- Firestore `push/<uid>`: `{ subs: { <llave>: { endpoint, keys{p256dh,auth}, device, at } } }`, un elemento por teléfono.
  Si el servicio de push responde 404/410 (desinstalaron, quitaron el permiso), la app borra esa dirección.
- Preferencias de cada uno: `profiles/<uid>.prefs.notif[tipo] = false` para apagar un tipo (`NOTIF_TYPES` en `push.js`).
  Lo revisa quien manda el aviso.
- «Pensando en ti» manda como mucho un aviso cada 10 minutos desde el mismo teléfono.
- Emulador (`?emu`): no se llama al Worker. Los avisos se anotan en la consola y en `window.__pushLog` (ver docs/PRUEBAS.md).

## Agregar un aviso nuevo

1. Si es un tipo nuevo, agrégalo a `NOTIF_TYPES` en `push.js` (así sale en Ajustes).
2. Después de guardar en Firestore: `notify('tipo', { title: \`… ${meForPartner()} …\`, body, url: './?open=<sección>', tag })`.
   `meForPartner()` usa el apodo que tu pareja te puso, si tiene uno.
3. Si la sección no existe en `OPEN` (`push.js`), agrégala.
4. **Aviso llamativo:** si el `tag` empieza con `urgente-` (antojo 🔥), `sw.js` lo muestra con `requireInteraction` (en
   Android se queda en pantalla hasta tocarlo) y vibración larga. En iPhone se ve como cualquier aviso (iOS no permite más).
5. No pongas textos privados en el aviso (se ven en la pantalla bloqueada): por ejemplo, las notas solo dicen que hay una nueva.

## Configurar el servicio (una sola vez, lo hace el dueño)

**Estado:** configurado en noviembre de 2026 (Worker `futari-push`, versión 34 de la app). Estos pasos sirven si hay que
rehacerlo (otra cuenta, llaves nuevas).

1. **Llaves.** Abre https://sebaschaves.github.io/nosotros/notificaciones/llaves.html → «Crear llaves». Deja la página
   abierta hasta el paso 4.
2. **Cuenta.** Crea una cuenta gratis en https://dash.cloudflare.com (solo correo y contraseña, sin tarjeta).
3. **Worker.** En el menú: *Workers & Pages* (puede estar dentro de *Compute*) → *Create* → *Create Worker* /
   *Start with Hello World* → nombre `futari-push` → *Deploy*. Luego *Edit code*, borra todo, pega el contenido de
   `notificaciones/worker.js` y toca *Deploy*.
4. **Variables.** En el Worker → *Settings* → *Variables and Secrets* → *Add*:

   | Nombre | Tipo | Valor |
   |---|---|---|
   | `VAPID_PUBLIC_KEY` | Text | la llave pública de llaves.html |
   | `VAPID_PRIVATE_KEY` | **Secret** | la llave privada de llaves.html |
   | `FIREBASE_PROJECT_ID` | Text | `nosotros-app-2e254` |
   | `ALLOWED_UIDS` | Text | los dos códigos que salen en Futari → Ajustes → Notificaciones (separados por coma) |

   Guarda y vuelve a desplegar si lo pide.
5. **Comprobar.** Abre la dirección del Worker (`https://futari-push.<tu-subdominio>.workers.dev`): debe decir
   `"ready":true`.
6. **App.** Pásale a Claude la dirección del Worker y la llave **pública** para ponerlas en `push-config.js` y publicar.
7. **Teléfonos.** Cada uno: Futari instalada → Ajustes → Notificaciones → *Activar en este teléfono* → *Probar*.

Si cambias `notificaciones/worker.js`, hay que volver a pegarlo en Cloudflare (no se actualiza solo con GitHub).
Si cambias las llaves, actualiza `push-config.js` y cada uno debe desactivar y volver a activar en su teléfono.

## Solo se puede comprobar en el teléfono

- Que llegue el aviso con la app cerrada, el sonido, el ícono pequeño de Android y que al tocarlo abra la sección.
- iPhone: activar desde la app instalada (desde Safari normal no aparece la opción).
- Samsung: si no llegan, revisar Ajustes del teléfono → Aplicaciones → Chrome/Futari → Notificaciones, y que el ahorro
  de batería no esté cerrando Chrome.

## Avisos programados (Cron del Worker)

Cada minuto el Worker (`scheduled` → `runSchedule` en `notificaciones/worker.js`) lee Firestore con una **cuenta de servicio
de solo lectura** y manda, según la hora de Costa Rica (`TIME_ZONE`):

| Hora | Aviso | Tipo (Ajustes) |
|---|---|---|
| 20:00 | «🐱 Mochi tiene hambre» / «🔥 Su racha de N días se acaba hoy» a quien aún no hizo nada hoy (si hay racha o mascota) | `streak` |
| el minuto exacto del recordatorio (o 8:00) | recordatorios 🔔 de hoy no hechos, a quien le toca | `reminders` |
| `remind` minutos antes de la hora del plan (o 8:00 ese día / 9:00 la víspera si no tiene hora) | «📅 Cena con mis papás · En 1 hora · a las 19:00»: planes del calendario (`events`, también los que se repiten), a quien es el plan (`who`). Desde `WORKER_VERSION` 14 | `events` |
| 8:00 / 9:00 | «Hoy es…» / «Mañana es…»: fechas especiales, aniversarios y mesiversarios | `dates` |
| domingo 19:00 | «📊 Su semana en Futari»: días juntos, corazones e historias o preguntas (como `week.js`) | `week` |
| el minuto de `showTime` | «💌 … te dejó una nota para hoy»: notas del frasco programadas (`showDay`/`showTime`) a la pareja. Desde `WORKER_VERSION` 8 | `notes` |
| domingo 19:30 | «🐷 ¡Les sobraron…!» / «💸 Se pasaron…»: gustos de la semana vs. presupuesto y vs. la semana pasada (lee solo `expenses` con `date` de las últimas 2 semanas y `money/cfg`). Desde `WORKER_VERSION` 6 | `money` |

- La racha usa la misma regla que `home.js` (`didSomething`): `moods`, `answers`, `thinks`, `daily` y `activity`.
  Si cambias esa regla, cámbiala también en el Worker.
- Para gastar pocas lecturas del plan gratis, cada minuto solo consulta los recordatorios de hoy (`date == hoy`); lo demás
  (pareja, teléfonos, racha, fechas) se lee solo en punto o cuando hay un recordatorio que mandar. Desde el Worker v8 también consulta cada minuto las notas programadas de hoy (`notes` con `showDay == hoy`): unas 3.000 lecturas al día en total (el plan gratis da 50.000).
- El Worker no escribe nada en la base. Los teléfonos que ya no existen los limpia la app cuando manda un aviso.
- **Planes del calendario (v14):** en punto se lee `events` una vez (≈24 lecturas × planes al día), se calcula qué avisos
  caen en los próximos 60 minutos (hoy, mañana y pasado, con `evOccurs`, copia de `occursOn` de calendar.js) y se guardan
  en KV `RESPALDOS` como `cal:<día>T<hora>` (dura 2 h; solo se escribe si hay algo después del minuto 0). Cada minuto se lee
  esa clave y se manda lo de ese minuto. Sin el KV, todos los avisos de esa hora salen en punto (antes de tiempo).
  Al anotar o cambiar (o arrastrar) un plan que no es «solo yo», la app le avisa a la pareja (`evNotify` en calendar.js, tipo `events`).
- Para cambiar horas o textos: edita `runSchedule` y vuelve a pegar el Worker en Cloudflare.
- Prueba local: `runSchedule(env, fecha, { dryRun: true })` con `env.TEST_FIRESTORE = 'http://127.0.0.1:8080'`
  (emulador) devuelve la lista de avisos sin mandarlos.

### Si un aviso programado no llega

En la app: **Administración → Pruebas → ⏰ Avisos programados** (solo lo ve el dueño; «Probar» sigue en Ajustes para los dos). Llama a `POST /diagnostico` del Worker (con la
sesión de Firebase), que hace lo mismo que el Cron —leer la base con la cuenta de servicio, buscar los recordatorios de
hoy— y manda una prueba «Futari ⏰» a tus teléfonos. La app explica cada paso (hora y zona que ve el Worker, clave de
lectura, permiso 403, recordatorios encontrados, teléfonos). Si todo sale bien y aun así no llegan a su hora, el
problema es el Cron en Cloudflare (*Settings → Triggers*, `* * * * *`) o sus *Logs*.
`WORKER_VERSION` (al inicio del Worker) se muestra ahí: súbelo cada vez que cambies el Worker.

### Calendario de adviento (v16)

Del 1 al 24 de diciembre a las 8:00, a cada uno: «🎄 Tu casilla N está lista» (tipo `advent`, `?open=advent`). Si la pareja
llenó esa casilla, dice que hay algo de ella sin decir qué. Ver docs/ADVIENTO.md.

### Bitácora del Worker (v15)

La cuenta de servicio es de **solo lectura**, así que el Worker no escribe en Firestore: anota en su KV `RESPALDOS`, una
clave por día que se borra sola a los 40 días (`expirationTtl`):
- `nlog:<día>`: cada aviso programado `{ at, type, to, n (teléfonos), ok (entregados), r (códigos) }`, sin el texto. Una
  escritura por minuto en que se mandan avisos.
- `blog:<día>`: el respaldo de la noche `{ at, kind 'datos'|'fotos', manual, cols, docs | copied, total }`. Dos escrituras por noche.
- `elog:<día>`: errores de `scheduled` (`programados` o `respaldo`); el mismo error se anota como máximo una vez por hora
  para no gastar el límite de 1000 escrituras al día.

`POST /bitacora { from: 'AAAA-MM-DD' }` (con la sesión) devuelve `{ days: { día: { notifs, backup, errors } }, backup }`
(hasta 31 días, más lo mismo que la lista de respaldos). Lo usa Administración → 📒 Bitácoras (Avisos y Respaldos); los
avisos que manda la app los anota la app misma en `notiflog` (DATOS.md). Sin la v15 pegada, la pestaña lo dice.

### Configurarlo (una sola vez)

1. **Cuenta de servicio de solo lectura.** En https://console.cloud.google.com, elige el proyecto `nosotros-app-2e254` →
   *IAM y administración* → *Cuentas de servicio* → *Crear cuenta de servicio*. Nombre: `futari-avisos`. En
   *Otorgar acceso*, rol **«Visualizador de Cloud Datastore»** (*Cloud Datastore Viewer*); nada más. → *Listo*.
2. Abre la cuenta creada → pestaña *Claves* → *Agregar clave* → *Crear clave nueva* → **JSON**. Se descarga un archivo.
3. En Cloudflare → `futari-push` → *Settings* → *Variables and Secrets* → *Add*: nombre `FIREBASE_SA`, tipo **Secret**,
   valor = **todo** el contenido del archivo JSON (ábrelo con el Bloc de notas y copia todo). Después borra el archivo
   descargado.
4. Pega la versión nueva de `notificaciones/worker.js` en *Edit code* → *Deploy*.
5. *Settings* → *Triggers* (o *Trigger Events*) → *Cron Triggers* → *Add* → `* * * * *` (cada minuto) → guardar.
6. Abre la dirección del Worker: debe decir `"scheduled":true`.


## Viajes (Worker v10)

Tipos de aviso nuevos en Ajustes: `trips`, `vacations` (vacaciones que pone tu pareja o que coinciden), `shows` (avance en una serie a su ritmo), `fruta` (reto y duelos de Pura fruta) y los mensajes del chat de historias (tipo `snaps`).


A las 10:00, 30, 7 y 1 día antes de la ida (`trips.start`), a cada uno le llega «✈️ Faltan N días para…» con lo que le
falta de «Antes de salir» (`trips.todo`, los que son suyos o de los dos). Tipo de aviso `trips` (también lo usa la app al
guardar un lugar en «Por conocer»). Abre `./?open=trips`.

## Chef con IA (`/chef`, Worker v9)

«👩‍🍳 Pregúntale al chef» (`recipes.js`) manda lo que escriben al Worker (con la sesión de la pareja) y el Worker arma la
receta con IA. No guarda nada; la app la guarda solo si tocan «Guardar».

- **Gratis (lo que está activo):** Workers AI de Cloudflare. Se activa una vez: Cloudflare → Workers & Pages →
  `futari-push` → *Settings* → *Bindings* → *Add* → **Workers AI** → nombre de la variable **`AI`** → guardar (y *Deploy*
  si lo pide). Modelo: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (se cambia con la variable `CHEF_CF_MODEL`). Tiene un
  límite gratis diario; al pasarlo responde `limit` y la app dice «se acabó lo gratis de hoy».
- **Claude (opcional, mejores recetas):** agregar el secreto `ANTHROPIC_API_KEY` (cuenta en console.anthropic.com con
  crédito prepagado; sin cuota mensual). Si existe, el Worker usa Claude (`claude-opus-5-5`, esfuerzo `low`, salida JSON
  con esquema, `fallbacks: "default"`) en vez de Workers AI. `CHEF_MODEL` cambia el modelo de Claude. **Sin probar con
  una clave real**: revisar la primera vez.
- Errores: `old-worker` (falta pegar v9 o más nuevo), `no-ai` (falta el binding), `limit`, `ai` (otro error; detalle en *Logs*).

## Respaldo automático (Worker v11; «Respaldar ahora» desde v12; v13 aguanta el límite de KV)

Guía de uso y de recuperación: docs/RESPALDO.md.

Cada noche, de 3:00 a 5:59 (hora de `TIME_ZONE`), el Cron hace un paso chico por minuto (`backupStep`; el plan gratis da
10 ms de CPU por vez):
1. Una colección por minuto → KV `d:<día>:<colección>` (+ `_couple` con fecha de inicio, moneda y miembros, y `_meta`).
   Se borran los días viejos: quedan los últimos 7 y los domingos del último mes (`days`).
2. Fotos nuevas: lista solo los ids de `photos` (sin bajarlas) y copia las que faltan a `p:<id>`, ~8 por minuto y hasta
   600 por noche (límite gratis de KV: 1000 escrituras al día). `photos-index` = ids ya copiados; `photo-todo` = pendientes.
No se copian `push`, lo privado de cada uno ni las cartas «Solo nosotros».

**Configurar (una vez, lo hace el dueño):** Cloudflare → Storage & Databases → KV → crear `futari-respaldos`; luego en el
Worker `futari-push` → Settings → Bindings → Add → KV namespace, nombre de la variable **`RESPALDOS`** → ese espacio. Pegar
el Worker v11 y Deploy. Gratis: 1 GB de espacio (alcanza para miles de fotos).

**En la app:** Ajustes → Respaldo → «🌙 Respaldos automáticos de cada noche» (`POST /respaldo` con `{action:'list'}` o
`{action:'get', day, photos}`): lista los días, baja el JSON (mismo formato que «Descargar», versión 5, con o sin fotos)
o lo restaura (se junta con lo actual, no borra nada). Errores: `no-kv` (falta el binding) y `old-worker`.

**«💾 Respaldar ahora» (v12):** `{action:'start'}` reinicia el respaldo de hoy (máximo 4 veces al día por el límite de
escrituras de KV; si no, `{error:'limit'}`) y la app pide `{action:'step'}` una y otra vez (cada pedido = un paso:
una colección o ~8 fotos; con el botón, hasta 120 fotos y las demás siguen en la noche) mostrando «Respaldando… 12 de 40»
hasta recibir `{phase:'done'}`. **Ojo (v13):** KV deja escribir la misma clave (p. ej. `state`) solo una vez por segundo; si no, lanza 429. Por eso la app espera 1,2 s entre pasos y reintenta hasta 3 veces, el Worker usa `kvPut` (reintenta tras 1,1 s) y cualquier error de `/respaldo` vuelve como `{error:'fail', detail}` con CORS, para que la app muestre el motivo en vez de «no se pudo hablar».

Prueba local: `backupStep(env, fecha)` con `env.TEST_FIRESTORE` (emulador), un KV simulado (`get/put/delete`) y
`env.BACKUP_ANYTIME = true` para correrlo fuera de horario.
