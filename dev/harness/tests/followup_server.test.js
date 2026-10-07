/* Regresiones del seguimiento del servidor: ask() sólo para el equipo y tolera una pestaña "Cuadre AAAA" mala;
   bootstrap() guarda sola la URL /exec; budgetSave no cambia de pilar una línea vinculada; gSave no vincula
   líneas "No se realizará" (monto final $0). */
(function () {
  var EXEC = 'https://script.google.com/a/macros/copec.cl/s/MOCK/exec';
  function scriptProp(k) { return PropertiesService.getScriptProperties().getProperty(k); }
  function prjBy(b, nombre) { var p = b.projects.find(function (x) { return x.nombre === nombre; }); ok(p, 'no encontré el proyecto "' + nombre + '"'); return p; }
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function linked(b) { var m = {}; b.projects.forEach(function (p) { p.lineas.forEach(function (id) { m[id] = p; }); }); return m; }

  /* ---------------- 1) Asistente ---------------- */

  test('followup server · ask() exige ser del equipo (desconocido sí entra)', function () {
    need('ask');
    fresh('setup');
    asUser('cualquiera@gmail.com', function () { throws(function () { client('ask', 'Retiro Totora'); }, /acceso/i, 'externo bloqueado'); });
    asUser('', function () { eq(client('ask', 'Retiro Totora').mode, 'search', 'sin correo de Google se permite'); });
    PropertiesService.getScriptProperties().setProperty('EXTRA_USERS', 'apoyo@copec.cl');
    asUser('apoyo@copec.cl', function () { ok(client('ask', 'Retiro Totora').results.length > 0, 'EXTRA_USERS puede preguntar'); });
  });

  test('followup server · ask() con una pestaña "Cuadre AAAA" mal formada sigue buscando', function () {
    need('ask');
    fresh('setup');
    MOCK.addSheet('Cuadre 2025', [['Archivo histórico (sin encabezados)'], ['algo', 1, 2]]);
    var r = client('ask', 'Retiro Totora');
    eq(r.mode, 'search');
    ok(r.results.some(function (s) { return /Retiro Totora/.test(s.title); }), 'encuentra la línea de 2026: ' + JSON.stringify(r.results.slice(0, 3)));
  });

  test('followup server · sendTestDigest exige ser del equipo', function () {
    need('sendTestDigest');
    fresh('setup');
    asUser('cualquiera@gmail.com', function () { throws(function () { client('sendTestDigest'); }, /acceso/i); });
    eq(MOCK.mails.length, 0, 'no se envió nada');
  });

  /* ---------------- 3) URL de la app ---------------- */

  test('followup server · bootstrap guarda sola la URL /exec (y no pisa una guardada)', function () {
    need('bootstrap', 'getAdminStatus');
    fresh('setup');
    var prev = MOCK.serviceUrl;
    try {
      // /dev (implementación de prueba) no se guarda
      MOCK.serviceUrl = 'https://script.google.com/a/macros/copec.cl/s/MOCK/dev';
      client('bootstrap');
      eq(scriptProp('APP_URL'), null, '/dev no se guarda');
      // Un externo no deja nada guardado
      MOCK.serviceUrl = EXEC;
      asUser('cualquiera@gmail.com', function () { throws(function () { client('bootstrap'); }, /acceso/i); });
      eq(scriptProp('APP_URL'), null, 'externo: nada guardado');
      // Primera visita del equipo a /exec → se guarda
      eq(client('getAdminStatus').appUrlSaved, false);
      eq(client('bootstrap').config.appUrl, EXEC);
      eq(scriptProp('APP_URL'), EXEC, 'URL /exec guardada');
      eq(client('getAdminStatus').appUrlSaved, true);
      // Una URL ya guardada (p. ej. con setAppUrl) no se reemplaza
      var good = 'https://script.google.com/a/macros/copec.cl/s/AKfycbReal_123-x/exec';
      client('setAppUrl', good);
      MOCK.serviceUrl = 'https://script.google.com/macros/s/OTRAIMPLEMENTACION/exec';
      client('bootstrap');
      eq(scriptProp('APP_URL'), good, 'no pisa la URL guardada');
      // getService() con error: bootstrap funciona igual
      client('setAppUrl', '');
      var GLOBAL = (0, eval)('this');
      var orig = GLOBAL.ScriptApp.getService;
      GLOBAL.ScriptApp.getService = function () { throw new Error('sin servicio'); };
      try {
        ok(client('bootstrap').budget, 'bootstrap no falla');
        eq(scriptProp('APP_URL'), null, 'nada guardado');
      } finally { GLOBAL.ScriptApp.getService = orig; }
    } finally { MOCK.serviceUrl = prev; }
  });

  test('followup server · setup avisa si no hay URL de la app guardada', function () {
    need('setup');
    fresh('raw');
    MOCK.user = ADMIN;
    var r = setup();
    ok(r.warnings.some(function (w) { return /URL de la app/.test(w) && /\/exec/.test(w) && /Ajustes/.test(w); }), 'aviso: ' + JSON.stringify(r.warnings));
    PropertiesService.getScriptProperties().setProperty('APP_URL', EXEC);
    ok(!setup().warnings.some(function (w) { return /URL de la app/.test(w); }), 'con URL guardada no avisa');
  });

  /* ---------------- 5) budgetSave: área de una línea vinculada ---------------- */

  test('followup server · budgetSave no cambia a otro pilar una línea vinculada a un proyecto', function () {
    need('budgetSave', 'gSave');
    fresh('demo');
    var b = bootstrap();
    var p = prjBy(b, 'Humedal El Bato (Quintero)');
    var map = linked(b);
    var l = b.budget['2026'].find(function (x) { return map[x.id] && map[x.id].id === p.id; });
    ok(l, 'el proyecto tiene una línea 2026');
    var err = throws(function () { client('budgetSave', 2026, l.id, { area: 'Cambio Climatico' }); }, /vinculada al proyecto/);
    eq(err.message, 'Esta línea está vinculada al proyecto "' + p.nombre + '" (Naturaleza). Desvincúlala antes de cambiarle el área.');
    eq(lineBy(bootstrap(), 2026, l.proj).area, l.area, 'el área no cambió');
    // Otros campos (y la misma área) se pueden guardar
    eq(lineBy(client('budgetSave', 2026, l.id, { area: l.area, nota: 'Sigue en Naturaleza' }), 2026, l.proj).nota, 'Sigue en Naturaleza');
    // Una línea libre sí cambia de área
    var free = b.budget['2026'].find(function (x) { return x.pilar === 'nat' && !map[x.id]; });
    ok(free, 'hay una línea libre de Naturaleza');
    eq(lineBy(client('budgetSave', 2026, free.id, { area: 'Cambio Climatico' }), 2026, free.proj).pilar, 'cc', 'línea libre cambia de área');
    // Desvinculada, ya se puede cambiar
    client('gSave', { tipo: 'Proyecto', id: p.id, lineas: p.lineas.filter(function (x) { return x !== l.id; }) });
    eq(lineBy(client('budgetSave', 2026, l.id, { area: 'Cambio Climatico' }), 2026, l.proj).pilar, 'cc', 'desvinculada: cambia de área');
  });

  /* ---------------- 6) gSave: líneas "No se realizará" ---------------- */

  test('followup server · gSave no vincula líneas con monto final $0; conserva las ya vinculadas', function () {
    need('gSave', 'budgetSave');
    fresh('demo');
    var b = bootstrap();
    var map = linked(b);
    var zero = b.budget['2026'].find(function (x) { return x.pilar === 'nat' && x.pf === 0 && !map[x.id]; });
    ok(zero, 'el semillero tiene una línea de Naturaleza con monto final 0');
    eq(zero.estado, 'No se realizará');
    var p = prjBy(b, 'Humedal El Bato (Quintero)');
    var err = throws(function () { client('gSave', { tipo: 'Proyecto', id: p.id, lineas: p.lineas.concat([zero.id]) }); }, /no se realizará/);
    eq(err.message, 'La línea "' + zero.proj + '" no se realizará (monto final $0); no se puede vincular.');
    throws(function () { client('gSave', { tipo: 'Proyecto', pilar: 'nat', nombre: 'Nuevo con línea en cero', lineas: [zero.id] }); }, /monto final \$0/, 'al crear');
    deepEq(find(bootstrap(), 'projects', p.id).lineas, p.lineas, 'nada cambió');

    // Una línea ya vinculada que pasa a $0 se conserva al editar el proyecto
    var kept = p.lineas.find(function (id) { return b.budget['2026'].some(function (x) { return x.id === id; }); });
    var kl = b.budget['2026'].find(function (x) { return x.id === kept; });
    client('budgetSave', 2026, kept, { pf: 0 });
    var r = client('gSave', { tipo: 'Proyecto', id: p.id, nombre: p.nombre + ' (editado)', lineas: p.lineas });
    deepEq(find(r, 'projects', p.id).lineas, p.lineas, 'las ya vinculadas se conservan');
    // v3.1: gSave devuelve el bundle parcial de Gestión (sin presupuesto) → la línea se mira en bootstrap()
    eq(lineBy(bootstrap(), 2026, kl.proj).estado, 'No se realizará');
  });
})();
