# Gastos (`money.js`, pantalla `s-money`)

La pareja gasta mucho en comida, salidas y fiestas; la sección está pensada para que **anotar tome 3 segundos** y para
ver y frenar ese gasto sin que se sienta castigo. No se pide el salario (lo decidió el dueño).

## Guía de Gastos (`money-tour.js`)

11 pantallas con ejemplos (anotar, atajos, quién pagó y cómo se divide, deshacer, Salimos, presupuesto con
termómetros de ejemplo, alcancías, avisos, banco e ideas para gastar menos) y una **práctica** con teclado que no guarda
nada. Sale sola la primera vez que cada uno entra a Gastos (`profiles/<uid>.prefs.moneyTour`) y se vuelve a ver con
«📖 Cómo funciona» (botón arriba en Gastos y enlace en la tarjeta de Inicio). La guía general (`tour.js`, versión 4)
muestra una vez «Lo nuevo» con un paso de Gastos.

## Gráficos (`money-charts.js`)

Pantalla completa desde el ícono 📈 de arriba en Gastos (entre 📖 y «+ Gasto») y la tarjeta de Inicio. Solo lee `expenses` (no guarda nada).
- Arriba hasta 3 frases con lo importante (mes vs. mes pasado —antes del día 20 solo dice cuánto llevan—, semanas que
  cumplieron el presupuesto, el día que más gastan, la categoría #1).
- **Gustos semana a semana** (12 semanas, línea punteada del presupuesto) · **¿En qué se va?** (barras por categoría:
  este mes / mes pasado / 3 meses) · **Mes contra mes** (6 meses, gustos + lo demás apilado, con leyenda) · **¿Qué días
  gastan más?** (gustos de las últimas 8 semanas).
- Tocar una barra muestra su detalle debajo; cada gráfico tiene «Ver como tabla».
- SVG a mano, sin librerías. Colores `--viz-1` (azul) y `--viz-2` (naranja) en `styles.css`, distintos en tema oscuro
  y claro, validados con el validador de paletas (contraste y daltonismo). Grilla tenue, un solo eje, sin número en cada barra.

## Anotar rápido (`quickSpend`)

- Se abre desde **Inicio** (tarjeta «💸 Gustos de la semana»), el botón «+ Gasto» de Gastos, el **atajo del ícono**
  («Anotar gasto», `manifest.json` → `./?gasto`) y el **aviso del banco** (`#banco=<texto>`, abajo).
- Teclado de números propio (no sale el del teléfono), monto grande arriba, **tocar la categoría guarda** (sin botón
  «Guardar» ni confirmación). Después sale una barra con **Deshacer** 5 s (`undoBar`).
- Por defecto: pagó quien anota · la última forma de dividir que se eligió en ese teléfono (localStorage `futari-split`; la primera vez «a medias») · hoy. El chip ➗ dice la deuda en palabras (`debtTxt`: «Beto te debe la mitad», «Le debes todo a…», «Nadie debe nada») (chips para cambiarlos: pagó el otro; «todo lo debe el otro» o «solo
  mío» = `split: 'none'`, no cuenta en el balance; ayer/antier). Descripción opcional (si no, el nombre de la categoría).
- Gastos frecuentes (misma descripción, categoría y monto ≥ 2 veces en 120 días), «Repetir el último» y botones
  +1.000 / +5.000 / +10.000 (+1/+5/+10 si la moneda no es colones). «⋯ Más» abre todas las categorías.
- Categorías rápidas: 🍽️ Comida, 🎬 Salidas, 🎉 Fiestas (nueva en `EXPENSE_CATS`), 🛒 Súper, 📦 Otro.
- El formulario completo de antes (`openExpense`) sigue para viajes y detalles («Con más detalle»).

## Salida en curso (`money/out`)

«🎉 Salimos» (nombre y límite opcional). Mientras está activa, lo que anoten los dos lleva `outing`/`outName` y en la
lista se ve como **una sola fila** que se abre con el detalle. Si pasan el límite: aviso a la pareja (`money`) y toast
(una vez, `warned`). «Terminar» la cierra.

## Presupuesto semanal, termómetro y alcancías

- `money/cfg.week` (lunes a domingo) para las categorías `weekCats` (por defecto 🍽️🎬🎉). Termómetro verde → amarillo
  (80 %) → rojo en Inicio y Gastos, con «quedan ₡X · faltan N días». Al cruzar el 80 % y el 100 %: toast y aviso a la pareja.
- **Alcancías** (`money/g-<ts>`): meta, aportar/sacar (`log`), «Que caiga lo que sobra» (`cfg.goal`).
- **Lo que sobra pasa solo** (`rollWeek`): el primer teléfono que abre Futari en una semana nueva hace una transacción
  sobre `money/cfg` (`lastRoll`), así que aunque abran los dos a la vez se suma una sola vez (probado en el emulador).
- Tarjeta «Esta semana vs. la pasada» por categoría.

## Resumen del domingo

Aviso del Worker a las **19:30** del domingo (tipo `money`, ver docs/NOTIFICACIONES.md). Hace falta pegar la versión
nueva del Worker (`WORKER_VERSION` 6) en Cloudflare.

## Desde el aviso del banco (y su tutorial)

Futari no puede leer SMS ni notificaciones. Un atajo del teléfono abre Futari con el texto del aviso:
`https://…/nosotros/#banco=<texto>`. Va después del `#` para que el texto **no salga del teléfono** (no llega a GitHub);
`moneyShortcut()` lo lee, lo quita de la dirección y abre «Anotar» con monto y lugar (`parseBank`: «CRC 18,750.00»,
«₡8.500,00», «US$ 23.50», «en COMERCIO…»). Si venía en otra moneda, avisa que revisen el monto. También escucha
`hashchange` (en iPhone el atajo abre Safari, que puede tener Futari ya abierto).

Tutorial paso a paso dentro de la app (Gastos → «⚡ Que se anote desde el aviso del banco», `bankTutorial`):
- **iPhone (Atajos):** automatización de Mensaje/Correo del banco que contiene «compra» → Codificar URL (entrada) →
  Abrir URL. Abre Safari, por eso hay que iniciar sesión una vez en Safari.
- **Samsung/Android (MacroDroid):** disparador «Notificación recibida» de la app del banco/Mensajes → acción «Abrir sitio
  web» con el texto de la notificación. Con Futari instalado desde Chrome, el enlace abre la app.
- Tiene un cuadro para pegar un mensaje real y ver qué monto y lugar saca.

## Falta probar en el teléfono

Los dos atajos del banco con mensajes reales de su banco (el formato de cada banco cambia: si `parseBank` no saca el
monto, pedir un ejemplo sin datos de tarjeta y ajustar), el atajo del ícono «Anotar gasto» (Android; en iPhone los
accesos del ícono no existen) y que el teclado se sienta rápido.
