# Vacaciones del trabajo

Pantalla `s-vac` (`vacations.js`, desde 1.16.0), en Más → 🏖️ Vacaciones. Sirve para llevar la cuenta de los días de
vacaciones del trabajo de cada uno: saldo, acreditación automática, solicitudes con su estado, historial, feriados y puentes.

## Quién la ve

- Al principio **solo el dueño** (`isOwner()` de `gifts.js`): `gates['s-vac'] = () => isOwner() || vacShared()`.
  Mientras tanto, la pareja no la ve en Más, ni en la barra, ni en el buscador, ni en la campana, ni en la guía.
- Se comparte en **Administración → Pruebas → 🏖️ Vacaciones** («Que <pareja> también la vea»). Eso guarda
  `couples/nosotros.features.vac = { on, at, by }`, y opcionalmente le manda un aviso (tipo `vacations`, `./?open=vac`).
  Se puede volver a esconder; no se borra nada.
- Las vacaciones que se anotan **sí salen en el calendario de los dos** desde el principio. La pareja las ve en modo lectura
  («Son vacaciones del trabajo: se manejan aparte»).
- Guía «Lo nuevo» (`tour.js`, versión 11): el paso `VACWORK` tiene `gate: 's-vac'`. Si todo lo nuevo es de secciones que la
  persona todavía no ve, la guía no sale **ni se marca como vista**. Así le aparece cuando se comparta.
- Las notas de `version.json` no la mencionan mientras esté escondida.

## Datos

- **Solicitudes**: en la colección `vacations` (la misma del calendario), con `work: true`. Además de los campos del
  calendario (`title, emoji, kind, color, who (uid), start, end, note, by, at`), llevan:
  - `status`: `pendiente`, `aprobada` o `rechazada`;
  - `days`: días que rebajan (se calcula y se puede cambiar a mano);
  - `half`: medio día (solo si empieza y termina el mismo día);
  - `statusAt`, `editedBy` y `editedAt`.
- En el calendario (`calendar.js`):
  - las `rechazada` no salen;
  - las `pendiente` llevan ⏳ y una barra más clarita (`.vbars i.p`);
  - al tocar una del trabajo se abre la hoja de Vacaciones (o la vista de solo lectura si no la ve).
  - «+ Agregar» tiene «💼 Vacaciones del trabajo» para quien la ve.
- **Configuración** en el documento de la pareja, `couples/nosotros.vac`:
  - `cfg.<uid> = { bal, balAt, every, day, md, amount, wd, max, at, by }`:
    - `bal`: los días que tenía en la fecha `balAt` (el saldo que se pone a mano).
    - `every`: `month`, `quincena` (el 15 y el último día), `year` o `none`.
    - `day`: el día del mes (`'last'` o `'1'`…`'31'`) cuando `every` es `month`.
    - `md`: la fecha del año (`'MM-DD'`) cuando `every` es `year`.
    - `amount`: los días que se acreditan cada vez.
    - `wd`: los días que trabaja (0 = domingo; por defecto L–V).
    - `max`: avisar si tiene más de esos días libres (0 = nunca).
  - `holOff.<AAAA-MM-DD> = true`: un feriado de ley que no aplica (por ejemplo, si se corrió de día).
  - `holAdd.<AAAA-MM-DD> = nombre`: un feriado extra.
  - Valen para los dos.
- No hay colección nueva: no hizo falta tocar reglas ni el respaldo del Worker (`vacations` ya estaba).

## Cálculos

- **Saldo de un día** (`balanceAt`): `bal` + las acreditaciones entre `balAt` (sin contarlo) y ese día, menos las
  **aprobadas** que empiezan después de `balAt` y hasta ese día. Toda la solicitud se rebaja el día que empieza.
- **Resumen**:
  - «hoy»;
  - «aprobadas por tomar» (aprobadas que empiezan después de hoy);
  - «por aprobar»;
  - «libres para pedir» = hoy − por tomar − por aprobar;
  - la próxima acreditación;
  - lo que habrá al 31 de diciembre (cuenta las aprobadas y las por aprobar).
- **Días que rebaja** (`workDays`): solo los días de `wd`, sin feriados. Medio día = 0,5. Se guarda en `days` al guardar,
  así que si después cambia un feriado, las ya guardadas no cambian (se pueden abrir y corregir).
- **Simulador** al pedir: «El <fecha> vas a tener X → te quedarían Y». Cuenta las aprobadas y las por aprobar, sin la
  que se está editando.
- **Feriados** (`holidays(año)`): los de Costa Rica, más los agregados y menos los apagados.
  - Fijos: 1 ene, 11 abr, 1 may, 25 jul, 2 ago, 15 ago, 31 ago, 15 sep, 1 dic y 25 dic.
  - Jueves y Viernes Santo se calculan desde la Pascua.
  - Si la ley corre alguno a un lunes, se corrige en Configurar → Feriados.
- **Puentes** (`bridges`): feriados en martes, miércoles o jueves en los próximos 12 meses. Solo se calculan si no
  trabaja fines de semana. El botón «Pedir» abre la solicitud con esas fechas.
- **Historial**:
  - por año: las disfrutadas (aprobadas que ya terminaron) y las no aprobadas;
  - lo acreditado ese año (desde `balAt`);
  - el saldo puesto a mano.

## Avisos

En la campana, sección `s-vac` (`vacAlerts()`), solo para quien ve la sección y solo sobre lo suyo:
- `vacp-<id>`: «¿Ya te respondieron…?», para una solicitud por aprobar que empieza en 3 días o menos (o que ya empezó).
- `vach`: tiene más de `max` días libres. Sale una vez por mes: al abrir la pantalla se guarda
  `profiles/<uid>.prefs.vacHigh = 'AAAA-MM'`.
- Avisos al teléfono:
  - al pedir o cuando se aprueban, solo si ya está compartida y son tuyas;
  - al compartirla.
  - El Worker no manda nada programado de Vacaciones (por ejemplo, «mañana empiezan»). Sería un cambio aparte.

## Pendiente / ideas

- Aviso programado del Worker el día antes de empezar.
- Ligar unas vacaciones a un presupuesto de Gastos o a una alcancía.
