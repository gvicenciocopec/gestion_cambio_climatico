/* jsc_driver.js · carga los archivos en orden (cada uno con try/catch) y ejecuta las pruebas.
   Uso (lo arma run_tests.sh):  jsc mocks.js jsc_driver.js -- ROOT FILTRO archivo1 archivo2 ...
   - *.html → MOCK.files[nombre] (para HtmlService/include)
   - el resto (.gs, seed.js, tests/*.js) se cargan con load() en el ámbito global, como Apps Script. */
var __drvArgs = Array.prototype.slice.call(typeof arguments !== 'undefined' ? arguments : []);
var __drv = { root: __drvArgs[0] || '', filter: __drvArgs[1] || '', loads: [] };

(function () {
  var files = __drvArgs.slice(2);
  files.forEach(function (f) {
    if (!/\.html$/i.test(f)) return;
    var name = f.replace(/^.*\//, '').replace(/\.html$/i, '');
    try { MOCK.files[name] = readFile(f); } catch (e) { __drv.loads.push({ file: f, ok: false, error: 'no se pudo leer: ' + e }); }
  });
  files.forEach(function (f) {
    if (/\.html$/i.test(f)) return;
    try {
      load(f);
      __drv.loads.push({ file: f, ok: true });
    } catch (e) {
      __drv.loads.push({ file: f, ok: false, error: (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)), line: e && e.line });
    }
  });
})();

if (typeof __harnessRun === 'function') {
  __harnessRun(__drv);
} else {
  print('FAIL  no se cargó tests/_framework.js');
  __drv.loads.forEach(function (l) { if (!l.ok) print('      ' + l.file + ': ' + l.error); });
  print('HARNESS_RESULT pass=0 fail=1 skip=0');
}
