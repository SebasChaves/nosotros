# Respaldo y recuperación de datos

Guía para el dueño (y para Claude): cómo se respalda Futari, cómo recuperar algo que se borró y qué hacer si algo
falla. En la app hay una versión corta en **Ajustes → Respaldo → «🆘 ¿Se borró algo?»**.

## Las 3 capas de respaldo

| Capa | Qué guarda | Dónde | Cuánto dura |
|---|---|---|---|
| **Deshacer** | Lo que se borró hace unos segundos (momentos, notas, gastos, recetas…) | En la app (barrita «Deshacer» abajo) | ~5 segundos |
| **Respaldo automático** | Toda la base y las fotos | Cloudflare KV `RESPALDOS` (Worker `futari-push` v13) | Últimos 7 días + un domingo por semana del último mes |
| **Respaldo a mano** | Toda la base (y las fotos si se pide) | Un archivo `.json` en el teléfono | Lo que lo guarden (Drive, iCloud, correo…) |

Qué **no** se respalda en ninguna: `push` (direcciones de los teléfonos para avisos, se vuelven a crear solas), lo
privado de cada uno (`private/<uid>`, ideas de regalo) y las cartas «Solo nosotros» del juego de retos.

## Cómo se usa (en la app)

Todo está en **Ajustes → Respaldo**. Esta tarjeta **solo la ve el dueño** (`isOwner()` de `gifts.js`: su uid en `TESTERS`; en el emulador, la primera cuenta que entró). Su pareja no la ve.
- **Descargar** / **Descargar con fotos**: baja un archivo en este momento (no depende de Cloudflare).
- **Restaurar desde un respaldo**: sube uno de esos archivos. Primero muestra qué trae.
- **🌙 Respaldos automáticos de cada noche**: lista los días guardados. En cada uno: **Bajar** (archivo sin fotos),
  **+ fotos** (con fotos) y **Restaurar**. Arriba, **💾 Respaldar ahora** hace una copia en el momento (hasta 4 al día).
- **Línea de estado**: «🌙 Último respaldo automático: … ✓». Si dice **⚠️ No hay respaldo automático desde hace X días**,
  algo está fallando (ver «Si el respaldo automático falla»).

**Restaurar nunca borra nada**: escribe otra vez los documentos del respaldo con sus mismos ids. Lo nuevo que no estaba
en el respaldo se queda; lo que estaba en el respaldo vuelve como estaba ese día (si algo se había editado después,
queda la versión del respaldo). Las fotos que falten se vuelven a subir.

## Recuperar algo que se borró

1. **Hace segundos** → «Deshacer».
2. **Hoy o en los últimos días** → Respaldos automáticos → elegir el día **anterior** a que se borrara → **Restaurar**.
3. **Hace más de un mes** o sin respaldos automáticos → «Restaurar desde un respaldo» con el archivo más reciente que
   tengan guardado (por eso conviene descargar uno «con fotos» cada tanto y guardarlo fuera del teléfono).
4. **Se borró desde la consola de Firebase** (o se vació una colección) → igual que el paso 2 o 3: entrar a la app y
   restaurar.

## Si algo falla

### El respaldo automático no corre (⚠️ en Ajustes)
En Cloudflare → Workers → `futari-push`:
1. **Settings → Triggers → Cron**: debe existir `* * * * *` (cada minuto). Sin él tampoco llegan los recordatorios.
2. **Settings → Bindings**: debe estar el KV namespace con el nombre de variable **`RESPALDOS`** (y `AI` para el chef).
3. **Variables and Secrets**: `FIREBASE_SA` (la cuenta de servicio de solo lectura) y `FIREBASE_PROJECT_ID`.
4. **Edit code**: arriba debe decir `const WORKER_VERSION = 13` o más. Si no, pegar `notificaciones/worker.js` y Deploy.
5. **Logs** (Observability): buscar errores con «respaldo».
Mientras se arregla: «💾 Respaldar ahora» (si el servicio responde) o «Descargar con fotos» (no necesita Cloudflare).

### La app no deja entrar o no carga los datos
- Firebase → **Authentication**: que existan las dos cuentas.
- Firebase → **Firestore → Reglas**: que estén las reglas con los dos correos (las reales viven solo en la consola;
  `firestore.rules` del repo tiene correos de ejemplo).
- Si los datos de verdad se perdieron: cuando ya puedan entrar, restaurar como arriba.

### Cloudflare no funciona y hace falta un respaldo automático
Los respaldos están en Cloudflare → Storage & Databases → KV → el espacio de `RESPALDOS`. Cada día son las claves
`d:<día>:<colección>` (una por colección, en JSON) y las fotos `p:<id>`. Desde el panel se pueden ver y copiar a mano,
pero es lento; lo normal es arreglar el Worker (arriba) y usar la app.

### Restaurar «limpio» (dejar la base exactamente como el respaldo)
Restaurar junta, no borra. Si hiciera falta dejar una colección igual al respaldo (por ejemplo, si se llenó de datos
malos), primero se borra esa colección en la consola de Firebase y después se restaura. Hacerlo con cuidado: es la única
operación que de verdad borra.

## Para Claude (técnico)
- Respaldo a mano y restaurar: `settings.js` (`exportData`, `uploadData`, `importData`). Formato versión 5.
- Automático: `notificaciones/worker.js` (`backupStep`, `backupStart`, `backupList`, `backupDownload`) y en la app
  `autoBackups`, `autoBackupNow`, `autoBackupGet`, `autoBackupRestore`, `bkStatusCheck`, `backupHelp`. Detalles de límites
  y claves de KV en docs/NOTIFICACIONES.md («Respaldo automático»).
- Si se agrega una colección nueva a `COLLECTIONS` (core.js), agregarla también a `BACKUP_COLS` del Worker.
