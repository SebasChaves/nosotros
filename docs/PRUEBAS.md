# Pruebas locales

**Nunca pruebes con la base real.** Con `?emu` en la URL (solo en `localhost` / `127.0.0.1`) la app usa el
emulador de Firebase y ningún dato sale de la máquina (`EMU` en `core.js`). En modo emulador todos son "tester"
(se ve Administración y la zona de pruebas).

## 1. Servidor de la app

Cualquier servidor estático en el puerto 5173, sin caché:
```bash
npx -y http-server -p 5173 -c-1 --silent
```
(En Claude Code está en `.claude/launch.json` como `nosotros`.) Abrir `http://localhost:5173/?emu`.

## 2. Emulador de Firebase (Auth + Firestore)

Configuración lista en `dev/` (`firebase.json` + `firestore.rules` con los correos de prueba). Necesita Java 11+.
```bash
cd dev
npx -y firebase-tools@14 emulators:start --only auth,firestore --project demo-nosotros
```
- Usa `firebase-tools@14` (la 13 falla con Node 20).
- **Windows:** si el emulador de Firestore no arranca por un error de "unix domain socket", define antes
  `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\ruta\corta\sin\espacios` (una carpeta que exista).
- Si dice que el puerto 8080/9099 está ocupado, hay un Java del emulador anterior vivo: ciérralo.
- Si editas `dev/firestore.rules` en Windows, guárdalo **sin BOM** (UTF-8 sin BOM) o el emulador lo rechaza.
- El emulador guarda todo en memoria: al reiniciarlo hay que volver a crear las cuentas.

## 3. Cuentas de prueba (solo existen en el emulador)

```bash
for e in ana beto; do curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$e@prueba.test\",\"password\":\"prueba123\",\"returnSecureToken\":true}"; done
```
- `ana@prueba.test` y `beto@prueba.test`, contraseña `prueba123`.
- **Dos usuarios a la vez:** abre uno en `http://localhost:5173/?emu` y el otro en `http://127.0.0.1:5173/?emu`
  (distinto origen = sesión distinta).
- Cada uno debe ir a Ajustes y poner nombre + fecha de inicio para quedar en `members` (si no, no hay "pareja"
  y no salen dedicatorias, votos, etc.). Pon también moneda `CRC` para que las búsquedas de lugares prioricen Costa Rica.
- Para probar el enlace de "olvidé mi contraseña": pide el correo desde la app y lee el código en
  `http://127.0.0.1:9099/emulator/v1/projects/demo-nosotros/oobCodes`; abre `/?emu&mode=resetPassword&oobCode=<código>`.

## 4. Qué revisar

- Tamaño teléfono: 390×844 (iPhone) y el preset móvil (que además simula Android: activa el selector cámara/galería).
- Consola del navegador sin errores.
- Para gestos (deslizar pestañas, arrastrar hojas) se pueden disparar `TouchEvent` desde la consola.
- `history.back()` simula el botón atrás de Android.
- Cámara propia: lanza Chromium con `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` y permiso
  `camera` (da un video de prueba verde); con agente de usuario de Android o iPhone sale la elección cámara/galería.

## 5. Solo se puede comprobar en el teléfono

Dilo explícitamente al usuario en vez de darlo por probado:
- Cualquier cosa de **iOS Safari / app instalada en iPhone** (alto de pantalla, zonas seguras, toques en ventanas).
- Cámara y selector de fotos de Android, fotos HEIF, calendario de Samsung, compartir archivos.
- Ubicación real ("Dónde estoy", "Cerca de mí"), audio (adelantos de canciones), vibración.
- Que Android cierre la app en segundo plano y la recarga.
