# Futari — guía para Claude

Futari (antes "Nosotros") es una app web personal para **una pareja**: dos cuentas, dos teléfonos
(uno **iPhone** y uno **Samsung Android**), instalada como PWA desde la pantalla de inicio.
Todo lo que ve el usuario está en **español**, con tono cercano ("tú" para cada uno, "ustedes" para los dos).

- Código: repositorio `SebasChaves/nosotros`, rama `main`.
- En vivo: https://sebaschaves.github.io/nosotros/ (GitHub Pages publica `main` tal cual, sin build).
- Datos: Firebase (Auth con correo y contraseña + Firestore), plan gratuito Spark.

Lee estos documentos antes de cambiar algo:

| Documento | Para qué |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Cómo está armado el código, módulos y patrones; cómo agregar una pantalla |
| [docs/DATOS.md](docs/DATOS.md) | Firestore: colecciones, campos, fotos, reglas de seguridad |
| [docs/PRUEBAS.md](docs/PRUEBAS.md) | Emulador local con dos cuentas de prueba; qué solo se puede probar en el teléfono |
| [docs/PUBLICAR.md](docs/PUBLICAR.md) | Versiones, aviso de actualización, novedades y cómo publicar |
| [docs/PENDIENTES.md](docs/PENDIENTES.md) | Cosas pospuestas, ideas, servicios externos y trampas conocidas (iPhone/Android) |

## Reglas que no se rompen

1. **Sin build ni dependencias.** HTML + CSS + JavaScript con módulos ES nativos. Firebase se carga del CDN
   `https://www.gstatic.com/firebasejs/11.0.2/...`. Nada de npm, bundlers ni frameworks en la app.
2. **Nunca pruebes contra los datos reales.** Usa el emulador (`?emu`, ver docs/PRUEBAS.md). La base real
   es de la pareja y la están usando a diario.
3. **Nunca pongas correos ni datos personales en el código**: el repositorio es público. Para identificar a
   alguien se usa su `uid` de Firebase (como `TESTERS` en `testing.js`). Las reglas reales con los correos
   viven solo en la consola de Firebase; `firestore.rules` del repo tiene correos de ejemplo.
4. **Cada publicación sube la versión** en tres lugares (`app.js`, `sw.js`, `version.json`). Si no, los
   teléfonos no reciben el cambio ni el aviso. Ver docs/PUBLICAR.md.
5. **Todo módulo nuevo va en la lista `FILES` de `sw.js`** (si no, no funciona sin internet).
6. **Las funciones que se llaman desde `onclick="..."` deben exponerse** con `expose({ ... })`.
7. **Privacidad:** si se empieza a guardar un dato nuevo de uso (como en `tracking.js`), actualiza el aviso de
   Ajustes (`settings.js`, texto "Futari guarda…"). Los dos usuarios deben saber qué se registra.
8. **Contenido:** el juego de retos tiene un nivel atrevido pero **no se escribe contenido sexual explícito**;
   para eso existe el nivel "🔒 Solo nosotros", donde ellos escriben sus propias cartas.
9. **No escribas contraseñas ni crees cuentas reales** por el usuario. Las cuentas de prueba del emulador sí.
10. **Probar en tamaño de teléfono** (390×844 o el preset móvil) después de cada cambio visible, y revisar la
    consola del navegador.

## Cómo trabaja el dueño

- Pide cambios en lotes ("tandas"); proponle un plan corto antes de algo grande y luego hazlo completo.
- Prefiere que publiques al terminar (commit + push a `main`) y que confirmes que la versión ya está en vivo.
- Commits en español, con el correo noreply de GitHub del usuario
  (`git -c user.email="SebasChaves@users.noreply.github.com" commit ...`).
- Cuando algo solo se puede comprobar en un teléfono real (gestos de iOS, cámara de Android, etc.), dilo
  claramente en vez de darlo por probado.
