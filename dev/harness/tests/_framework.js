/* =====================================================================
   tests/_framework.js · mini framework de pruebas para jsc (se carga antes que los demás tests)

   test(nombre, fn)            registra una prueba (una que falla no detiene a las demás)
   ok(cond, msg) · eq(a, b, msg) · deepEq(a, b, msg) · throws(fn, /re/|'texto', msg) · includes(xs, x, msg)
   assertNoDates(v, etiqueta)  falla si hay Date / función / undefined dentro de arrays / objetos no planos
   need('ask', ...)            falla con un mensaje claro si falta una función/constante de otro módulo
   fresh('raw'|'setup'|'demo') restaura la planilla: sólo semilla | + setup() | + seedDemoGestion()
   client(fn, ...args)         llama como google.script.run (serialización estricta de args y retorno)
   asUser(email, fn)           ejecuta fn como otro usuario
   rowsOf(hoja) · gRows()      filas como objetos {encabezado: valor}
   day(n)                      'yyyy-MM-dd' de hoy + n días (zona del script)
   U.ina / U.benja / U.ignacio / U.gonzalo
   Después de cada prueba: si hubo locks anidados → FAIL.
   ===================================================================== */

var __H = { tests: [], snaps: {}, snapErr: {}, root: '', current: null };
var U = { ina: 'ibachler@copec.cl', benja: 'bderigoulier@copec.cl', ignacio: 'idiaz@copec.cl', gonzalo: 'gvicencio@copec.cl' };
var ADMIN = U.gonzalo;

function test(name, fn) { __H.tests.push({ name: name, fn: fn }); }

function __fmt(v) {
  if (v === undefined) return 'undefined';
  if (Object.prototype.toString.call(v) === '[object Date]') return 'Date(' + (isNaN(v.getTime()) ? 'inválida' : v.toISOString()) + ')';
  if (typeof v === 'string') return JSON.stringify(v.length > 300 ? v.slice(0, 300) + '…' : v);
  try { var s = JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; } catch (e) { return String(v); }
}
function __fail(msg) { var e = new Error(msg); e.assertion = true; throw e; }

function ok(cond, msg) { if (!cond) __fail(msg || 'se esperaba verdadero'); }
function eq(actual, expected, msg) {
  if (actual !== expected) __fail((msg ? msg + ': ' : '') + 'se esperaba ' + __fmt(expected) + ' y llegó ' + __fmt(actual));
}
function __norm(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return { __date: v.getTime() };
  if (Array.isArray(v)) return v.map(__norm);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = __norm(v[k]); }); return o; }
  return v;
}
function __diff(a, b, path) {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return path + ': ' + __fmt(a) + ' ≠ ' + __fmt(b);
  if (Array.isArray(a) !== Array.isArray(b)) return path + ': array vs objeto';
  var keys = Array.isArray(a) ? (a.length >= b.length ? a : b).map(function (x, i) { return i; }) : Object.keys(Object.assign({}, a, b));
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var d = __diff(a[k], b[k], path + (Array.isArray(a) ? '[' + k + ']' : '.' + k));
    if (d) return d;
  }
  return null;
}
function deepEq(actual, expected, msg) {
  var d = __diff(__norm(actual), __norm(expected), '');
  if (d) __fail((msg ? msg + ': ' : '') + 'diferencia en ' + (d.charAt(0) === ':' ? '(raíz)' + d : d));
}
function throws(fn, matcher, msg) {
  var err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) __fail((msg ? msg + ': ' : '') + 'se esperaba un error' + (matcher ? ' (' + matcher + ')' : ''));
  if (err.assertion) throw err;
  var m = String(err && err.message || err);
  if (matcher instanceof RegExp && !matcher.test(m)) __fail((msg ? msg + ': ' : '') + 'el error no coincide con ' + matcher + ': "' + m + '"');
  if (typeof matcher === 'string' && m.toLowerCase().indexOf(matcher.toLowerCase()) < 0) __fail((msg ? msg + ': ' : '') + 'el error no contiene "' + matcher + '": "' + m + '"');
  return err;
}
function includes(xs, x, msg) {
  var has = typeof xs === 'string' ? xs.indexOf(x) >= 0 : (xs || []).indexOf(x) >= 0;
  if (!has) __fail((msg ? msg + ': ' : '') + __fmt(x) + ' no está en ' + __fmt(xs));
}
function assertNoDates(v, label) {
  var bad = MOCK.findIllegal(v, label || 'valor');
  if (bad.length) __fail('valores no serializables por google.script.run: ' + bad.slice(0, 8).join('; ') + (bad.length > 8 ? ' …' : ''));
}

// Valor global por nombre (funciones y const de los .gs)
function G(name) { try { return (0, eval)(name); } catch (e) { return undefined; } }
var __MODULE_OF = {
  bootstrap: 'Code.gs', getHistory: 'Code.gs', getAdminStatus: 'Code.gs', doGet: 'Code.gs',
  budgetSave: 'Presupuesto.gs', budgetDelete: 'Presupuesto.gs', budgetCreateYear: 'Presupuesto.gs', recalcAll: 'Presupuesto.gs',
  gSave: 'Gestion.gs', gDelete: 'Gestion.gs', taskComplete: 'Gestion.gs', taskReopen: 'Gestion.gs', commentAdd: 'Gestion.gs', commentDelete: 'Gestion.gs', G_HEADERS: 'Gestion.gs',
  installTrigger: 'Notificaciones.gs', notifDaily: 'Notificaciones.gs', sendTestDigest: 'Notificaciones.gs',
  ask: 'Asistente.gs', setup: 'Setup.gs', onOpen: 'Setup.gs', toggleGestionSheet: 'Setup.gs', CASCADE_SEED: 'Setup.gs',
};
function need() {
  Array.prototype.slice.call(arguments).forEach(function (n) {
    if (G(n) === undefined) __fail('falta ' + n + (__MODULE_OF[n] ? ' (' + __MODULE_OF[n] + ' no existe o no cargó)' : ''));
  });
}

function __ensureSnap(kind) {
  if (__H.snaps[kind]) return __H.snaps[kind];
  if (__H.snapErr[kind]) throw __H.snapErr[kind];
  try {
    if (kind === 'raw') {
      MOCK.reset();
      seedSpreadsheet();
    } else if (kind === 'setup') {
      MOCK.restore(__ensureSnap('raw'));
      MOCK.user = ADMIN;
      need('setup');
      setup();
    } else if (kind === 'demo') {
      MOCK.restore(__ensureSnap('setup'));
      MOCK.user = ADMIN;
      var rep = seedDemoGestion({ strict: true });
      if (rep.skipped) throw new Error('seedDemoGestion no creó nada (ya había datos)');
    } else {
      throw new Error('estado desconocido: ' + kind);
    }
    if (MOCK.lockViolations.length) throw new Error('lock anidado al preparar "' + kind + '": ' + MOCK.lockViolations[0].stack.split('\n')[0]);
    __H.snaps[kind] = MOCK.snapshot();
  } catch (e) {
    __H.snapErr[kind] = new Error('no se pudo preparar el estado "' + kind + '": ' + (e && e.message ? e.message : e));
    throw __H.snapErr[kind];
  }
  return __H.snaps[kind];
}
function __resetFlags() {
  MOCK.user = ADMIN;
  MOCK.lockBusy = false;
  MOCK.fetchHandler = null;
  MOCK.ui = false;
  MOCK.bound = true;
  MOCK.coerce = true;
  MOCK.clearBuffers();
}
// Las pruebas existentes cubren Drive y Gmail activos; las de modo seguro los apagan explícitamente.
function __featuresOn() { if (typeof CONFIG !== 'undefined') CONFIG.FEATURES = { DRIVE: true, GMAIL: true }; }
__featuresOn();
function fresh(kind) {
  __featuresOn();
  MOCK.restore(__ensureSnap(kind || 'setup'));
  __resetFlags();
  return MOCK.spreadsheet();
}

function client(name) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (/_$/.test(name)) __fail('google.script.run no puede llamar funciones privadas: ' + name);
  var fn = G(name);
  if (typeof fn !== 'function') { need(name); __fail(name + ' no es una función'); }
  var a = MOCK.strictClone(args, name + '(argumentos)') || [];
  var res = fn.apply(null, a);
  return MOCK.strictClone(res, name + '() → retorno');
}
function asUser(email, fn) {
  var prev = MOCK.user;
  MOCK.user = email;
  try { return fn(); } finally { MOCK.user = prev; }
}
function rowsOf(sheetName) {
  var sh = MOCK.sheet(sheetName);
  if (!sh || sh.getLastRow() < 1) return [];
  var v = sh.getDataRange().getValues();
  var head = v[0].map(String);
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { if (h) o[h] = r[j]; }); return o; });
}
function gRows(tipo) { return rowsOf('Gestión').filter(function (r) { return !tipo || r.Tipo === tipo; }); }
function day(n) { var x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + (n || 0)); return Utilities.formatDate(x, 'America/Santiago', 'yyyy-MM-dd'); }
function lineBy(bundle, year, proj) {
  var l = (bundle.budget[String(year)] || []).find(function (x) { return x.proj === proj; });
  if (!l) __fail('no encontré la línea "' + proj + '" en ' + year);
  return l;
}
function casBy(bundle, name) {
  var c = (bundle.cascade || []).find(function (x) { return x.nombre === name; });
  if (!c) __fail('no encontré el indicador Cascade "' + name + '"');
  return c;
}
function readText(rel) { return readFile(__H.root + '/' + rel); }

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */
function __short(file) { return String(file).replace(__H.root + '/', ''); }
function __stack(e) {
  var s = String(e && e.stack || '');
  return s.split('\n').filter(function (l) { return l && !/_framework\.js|jsc_driver\.js/.test(l); }).slice(0, 6)
    .map(function (l) { return l.replace(__H.root + '/', ''); });
}

function __harnessRun(drv) {
  __H.root = drv.root;
  var t0 = Date.now();
  var pass = 0, fail = 0, skip = 0;
  print('Cuadre AACC v2 · banco de pruebas (jsc)');
  drv.loads.forEach(function (l) {
    if (l.ok) return;
    fail++;
    print('FAIL  carga ' + __short(l.file) + (l.line ? ':' + l.line : '') + '  →  ' + l.error);
  });
  var okFiles = drv.loads.filter(function (l) { return l.ok; }).map(function (l) { return __short(l.file).replace(/^.*\//, ''); });
  print('      cargados: ' + okFiles.filter(function (f) { return /\.gs$/.test(f); }).join(', '));

  var filter = String(drv.filter || '').toLowerCase();
  __H.tests.forEach(function (t) {
    if (filter && t.name.toLowerCase().indexOf(filter) < 0) { skip++; return; }
    __H.current = t.name;
    var start = Date.now();
    var err = null;
    try {
      MOCK.restore(__ensureSnap('raw'));
      __resetFlags();
      t.fn();
      if (MOCK.lockViolations.length) {
        var v = MOCK.lockViolations[0];
        err = new Error('lock anidado (' + v.how + (v.sameObject ? ', mismo objeto' : '') + '): ' + MOCK.lockViolations.length + ' vez/veces.\n' + v.stack);
        err.assertion = true;
      }
    } catch (e) { err = e; }
    var ms = Date.now() - start;
    if (!err) { pass++; print('PASS  ' + t.name + '  (' + ms + ' ms)'); return; }
    fail++;
    print('FAIL  ' + t.name + '  (' + ms + ' ms)');
    String(err && err.message ? err.message : err).split('\n').forEach(function (l) { print('      ' + l); });
    if (!err.assertion) __stack(err).forEach(function (l) { print('        at ' + l); });
    else {
      var at = __stack(err).filter(function (l) { return /tests\//.test(l); })[0];
      if (at) print('        en ' + at);
    }
    var cons = MOCK.consoleBuf.filter(function (c) { return c.level === 'error' || c.level === 'warn'; }).slice(-5);
    cons.forEach(function (c) { print('      [' + c.level + '] ' + c.text.slice(0, 300)); });
    if (MOCK.missing.length) print('      métodos no emulados: ' + MOCK.missing.slice(0, 6).join(', '));
  });
  __H.current = null;
  var dt = ((Date.now() - t0) / 1000).toFixed(1);
  print('');
  print('Resultado: ' + pass + ' PASS · ' + fail + ' FAIL' + (skip ? ' · ' + skip + ' omitidas (filtro)' : '') + ' · ' + dt + ' s');
  print('HARNESS_RESULT pass=' + pass + ' fail=' + fail + ' skip=' + skip);
}
