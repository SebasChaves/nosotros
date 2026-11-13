# Publicar una versión

GitHub Pages publica la rama `main` tal cual. Los teléfonos reciben la versión nueva así:

1. `app.js` revisa `version.json` al abrir, al volver a la app y cada 30 min.
2. Si la versión publicada es distinta de su `APP_VERSION`, muestra arriba **"Hay una versión nueva · Actualizar"**.
3. Al actualizar, la app recarga (el service worker pide los archivos "sin caché" con revalidación).
4. Después de recargar, si la versión cambió desde la última vista en ese teléfono (`futari-version` en
   localStorage), muestra **Novedades**: todas las notas de `history` desde esa versión hasta la actual (acumulado).

## Pasos (siempre los tres números iguales)

1. `app.js`: `export const APP_VERSION = 'N';`
2. `sw.js`: `const CACHE = 'nosotros-vN';` (y agrega a `FILES` cualquier archivo nuevo).
3. `version.json`:
   ```json
   {
     "version": "N",
     "notes": ["…notas de esta versión…"],
     "history": [
       { "version": "N", "notes": ["…las mismas notas…"] },
       { "version": "N-1", "notes": ["…"] }
     ]
   }
   ```
   - `notes` (arriba) = las de la versión actual; la primera se muestra en la barrita de "Hay una versión nueva".
   - `history`: agrega la nueva **al principio**, no borres las anteriores.
   - Notas cortas, en español, pensadas para la pareja (qué pueden hacer ahora), no técnicas.
   - Guárdalo como UTF-8 **sin BOM** y verifica que es JSON válido.
4. Probar en el emulador (docs/PRUEBAS.md).
5. Commit y push:
   ```bash
   git add -A
   git -c user.email="SebasChaves@users.noreply.github.com" commit -m "Descripción en español

   Co-Authored-By: ..."
   git push origin main
   ```
   Si el push pide credenciales, que el usuario lo haga en una terminal (Git Credential Manager).
6. Confirmar que está en vivo (1–2 min): `https://sebaschaves.github.io/nosotros/version.json` debe mostrar la versión nueva.
7. Contarle al usuario qué cambió y qué falta comprobar en los teléfonos.

## Notas

- Archivos de diseño o maquetas sueltas (`*-futari.html`, `propuestas-diseno.html`) no son parte de la app. Hay varios
  en `.gitignore`; si creas otro, agrégalo ahí para no publicarlo.
- Administración tiene "Forzar actualización" (borra caché y service worker de ese teléfono) por si alguno se queda pegado.
- Si cambias `manifest.json` (por ejemplo accesos directos), Android puede tardar hasta un día en aplicarlo a la app instalada.
