# Notificaciones

Futari manda avisos al teléfono de la pareja (instantáneas, reacciones, notas, «pensando en ti», canciones
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
4. No pongas textos privados en el aviso (se ven en la pantalla bloqueada): por ejemplo, las notas solo dicen que hay una nueva.

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
| 8:00 / 9:00 | «Hoy es…» / «Mañana es…»: fechas especiales, aniversarios y mesiversarios | `dates` |

- La racha usa la misma regla que `home.js` (`didSomething`): `moods`, `answers`, `thinks`, `daily` y `activity`.
  Si cambias esa regla, cámbiala también en el Worker.
- Para gastar pocas lecturas del plan gratis, cada minuto solo consulta los recordatorios de hoy (`date == hoy`); lo demás
  (pareja, teléfonos, racha, fechas) se lee solo en punto o cuando hay un recordatorio que mandar. Unas 1.500 lecturas al día.
- El Worker no escribe nada en la base. Los teléfonos que ya no existen los limpia la app cuando manda un aviso.
- Para cambiar horas o textos: edita `runSchedule` y vuelve a pegar el Worker en Cloudflare.
- Prueba local: `runSchedule(env, fecha, { dryRun: true })` con `env.TEST_FIRESTORE = 'http://127.0.0.1:8080'`
  (emulador) devuelve la lista de avisos sin mandarlos.

### Si un aviso programado no llega

En la app: **Ajustes → Notificaciones → ⏰ Revisar avisos programados**. Llama a `POST /diagnostico` del Worker (con la
sesión de Firebase), que hace lo mismo que el Cron —leer la base con la cuenta de servicio, buscar los recordatorios de
hoy— y manda una prueba «Futari ⏰» a tus teléfonos. La app explica cada paso (hora y zona que ve el Worker, clave de
lectura, permiso 403, recordatorios encontrados, teléfonos). Si todo sale bien y aun así no llegan a su hora, el
problema es el Cron en Cloudflare (*Settings → Triggers*, `* * * * *`) o sus *Logs*.
`WORKER_VERSION` (al inicio del Worker) se muestra ahí: súbelo cada vez que cambies el Worker.

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

