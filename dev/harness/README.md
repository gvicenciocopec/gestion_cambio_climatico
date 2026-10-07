# Banco de pruebas local · Cuadre AACC v2

Emula Apps Script en tu Mac para probar el servidor (`apps-script/*.gs`) y ver la app completa en el
navegador sin desplegar nada. Usa la misma planilla de base: la pestaña **Cuadre 2026 con los datos reales**
(53 filas), una **Cuadre 2027** de ejemplo y el **Historial**; la pestaña oculta **Gestión** la crea `setup()`.

Requisitos: macOS (usa `jsc`, el motor JavaScriptCore del sistema) y `python3`.

## Comandos

```bash
python3 dev/harness/build.py          # genera dev/preview/index.html (app + servidor simulado)
bash dev/harness/run_tests.sh         # lint de .gs + carga aislada + pruebas (exit ≠ 0 si algo falla)
python3 dev/harness/check_icons.py    # valida cada ícono Lucide contra el build real lucide@1.50.0
```

Variantes útiles:

```bash
bash dev/harness/run_tests.sh asistente          # sólo pruebas cuyo nombre contiene "asistente"
VERBOSE=1 bash dev/harness/run_tests.sh notif    # muestra console/Logger del servidor
python3 dev/harness/build.py --check             # además valida la sintaxis JS de cada parcial
python3 dev/harness/check_icons.py --search chart  # busca nombres de íconos en el build
python3 dev/harness/check_icons.py --from /ruta/lucide.min.js  # usa una copia local en vez de descargar
```

## Vista previa (`dev/preview/index.html`)

Ábrela directo (`file://…/dev/preview/index.html`) o sírvela:
`python3 -m http.server 8777 --directory dev/preview` → `http://localhost:8777/`.

| Parámetro | Efecto |
|---|---|
| `?user=ibachler@copec.cl` | usuario de `Session.getActiveUser()` (`?user=` vacío = correo no disponible → "desconocido") |
| `?gemini=1` | define `GEMINI_API_KEY`: el Asistente usa el Gemini simulado |
| `?empty=1` | sólo `setup()`, sin datos demo |
| `?latency=0` | latencia de `google.script.run` en ms (por defecto 250) |
| `?dev=0` | oculta la píldora "Mock" |

La píldora **Mock** (abajo a la izquierda) cambia usuario/opciones, ejecuta `notifDaily()` y
`sendTestDigest()` y muestra los correos generados. En la consola: `harness.call('bootstrap')`,
`harness.mails()`, `MOCK`. Cada recarga parte con datos frescos (nada se guarda).

`google.script.run` simulado: asíncrono, `withSuccessHandler` / `withFailureHandler` / `withUserObject`,
no expone funciones privadas (terminan en `_`) y **serializa estricto**: un `Date`, una función o un
`undefined` dentro de un array (en argumentos o en el retorno) produce un error visible en la consola y en
el panel, en vez del `null` silencioso del Apps Script real.

## Archivos

| Archivo | Qué es |
|---|---|
| `mocks.js` | SpreadsheetApp, PropertiesService, CacheService, LockService, Session, Utilities, MailApp, ScriptApp, UrlFetchApp (Gemini simulado), HtmlService, Logger, console + objeto `MOCK` |
| `seed.js` | `seedSpreadsheet()` (estado actual de la planilla) y `seedDemoGestion()` (datos demo vía API pública) |
| `build.py` + `preview_shim.js` | arma la vista previa; el shim compila mocks + .gs + seed en una función aislada y emula `google.script.run` |
| `run_tests.sh` + `jsc_driver.js` | corre todo en jsc con TZ=America/Santiago |
| `tests/_framework.js` | `test`, `ok`, `eq`, `deepEq`, `throws`, `includes`, `assertNoDates`, `need`, `fresh`, `client`, `asUser`, `rowsOf`, `gRows`, `day` |
| `tests/*.test.js` | pruebas por módulo (bootstrap, presupuesto, gestión, comentarios, notificaciones, asistente, setup, seed) |
| `tools/lint_gs.py` | nombres repetidos entre .gs, choques con el banco, código ejecutable en el nivel superior |
| `tools/xlsx_to_seed.py` | regenera `SEED_CUADRE_2026` desde un .xlsx: `python3 dev/harness/tools/xlsx_to_seed.py planilla.xlsx --patch` |
| `check_icons.py` | íconos Lucide; el build se guarda en `vendor/` |

## Escribir una prueba

```js
// dev/harness/tests/mi_modulo.test.js  (envolver en una IIFE: comparte ámbito con los .gs)
(function () {
  test('mi módulo · algo importante', function () {
    need('gSave');                    // mensaje claro si el módulo aún no existe
    fresh('demo');                    // 'raw' (sólo semilla) | 'setup' | 'demo' (setup + datos demo)
    var b = client('gSave', { tipo: 'Tarea', pilar: 'nat', nombre: 'X', fecha: day(3) }); // como google.script.run
    eq(b.tasks.find(function (t) { return t.id === b.lastId; }).fecha, day(3));
    throws(function () { gSave({ tipo: 'Tarea', pilar: 'nat' }); }, /nombre/i);
    asUser(U.ina, function () { /* ... como Ina */ });
  });
})();
```

Cada prueba parte de un estado restaurado (snapshot); una prueba que falla no detiene a las demás.
Si se toma el lock de script dos veces sin soltarlo (p. ej. `withLock_` dentro de `mutate_`), la prueba falla.

## `MOCK` (para pruebas y consola)

`MOCK.user` · `MOCK.mails` · `MOCK.fetches` / `MOCK.lastFetch()` / `MOCK.lastPrompt()` · `MOCK.fetchHandler = (url, opts, rec) => ({code, body})`
· `MOCK.geminiReply({found, answer, sourceIds})` · `MOCK.geminiDefault` (responde con el primer `[ID]` del prompt)
· `MOCK.mailQuota` · `MOCK.lockBusy` · `MOCK.ui` (menú de la hoja) · `MOCK.bound` · `MOCK.triggers()` · `MOCK.menus()`
· `MOCK.sheet(nombre)` / `MOCK.values(nombre)` / `MOCK.addSheet(nombre, filas, opts)` / `MOCK.setFormula(hoja, 'G5', '=E5-F5')`
· `MOCK.snapshot()` / `MOCK.restore(s)` · `MOCK.strictClone(v)` · `MOCK.warnings` / `MOCK.unknownCalls` / `MOCK.missing`.

## Fidelidad y límites

- Las celdas conservan su tipo (un `Date` sigue siendo `Date`). Al escribir, Sheets interpreta textos:
  `"2026"` → número, `"2026-10-15"` → fecha, `"TRUE"` → booleano, salvo formato `@` o apóstrofo inicial.
- `getRange` fuera de la hoja, `setValues` con dimensiones distintas, ocultar la última hoja visible,
  borrar todas las filas no fijas y nombres de hoja repetidos lanzan el mismo error que Apps Script.
- Fórmulas: se guardan como fórmula y se evalúa un subconjunto (`+ - * / &`, comparaciones, `SUM MAX MIN ABS ROUND IF`).
  Al insertar/borrar filas se ajustan las referencias de fila de la misma hoja; no hay `ARRAYFORMULA` real.
- Métodos de formato no emulados (`setBorder`, `setFontSize`…) son no-op encadenables y quedan en `MOCK.unknownCalls`;
  otros métodos inexistentes quedan en `MOCK.missing` (se muestran cuando una prueba falla).
- Los activadores se registran pero no se ejecutan solos: llama `notifDaily()` (o usa el panel).
- El mensaje de error que recibe el cliente es `error.message` tal cual (en Apps Script puede venir con prefijo).
