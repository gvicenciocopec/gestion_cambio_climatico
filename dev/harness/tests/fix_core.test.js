/* Regresiones del núcleo (fixer "core") · D1-03 · D1-06/GAS-03 · D1-07 · GAS-02 · GAS-05 */
(function () {
  function newTask(nombre) {
    // §15: sin proyecto sería privada por defecto; estas pruebas usan una compartida
    return gSave({ tipo: 'Tarea', pilar: 'nat', nombre: nombre || 'Tarea core', resp: U.ina, fecha: day(5), privada: false });
  }
  function taskCount() { return gRows('Tarea').length; }
  // Reemplaza temporalmente una función global (los .gs comparten el ámbito global). make(orig) → reemplazo.
  var GLOBAL = (0, eval)('this');
  function swap(name, make, body) {
    var orig = GLOBAL[name];
    if (typeof orig !== 'function') __fail('no existe ' + name);
    GLOBAL[name] = make(orig);
    try { return body(); } finally { GLOBAL[name] = orig; }
  }

  test('fix core · D1-03 pestaña "Cuadre AAAA" mal formada: se omite con aviso y la app carga', function () {
    need('bootstrap', 'gSave', 'budgetSave');
    fresh('setup');
    MOCK.addSheet('Cuadre 2025', [['Archivo histórico (sin encabezados)'], ['algo', 1, 2]]);
    var b = client('bootstrap');
    deepEq(b.years, [2026, 2027], 'la pestaña mala no aparece');
    ok(b.config.warnings.some(function (w) { return /Cuadre 2025/.test(w); }), 'aviso con el nombre de la pestaña: ' + JSON.stringify(b.config.warnings));
    ok(b.budget['2026'].length > 0, 'las demás pestañas se leen');
    var n = taskCount();
    var r = client('gSave', { tipo: 'Tarea', pilar: 'nat', nombre: 'Con pestaña mala', resp: U.ina, fecha: day(5) });
    ok(!r.stale && /^TSK-/.test(r.lastId), 'la mutación devuelve el bundle completo');
    eq(taskCount(), n + 1, 'una sola tarea creada');
    var l = b.budget['2026'][0];
    var r2 = client('budgetSave', 2026, l.id, { nota: 'Nota con pestaña mala' });
    eq(lineBy(r2, 2026, l.proj).nota, 'Nota con pestaña mala', 'se puede editar otro año');
  });

  test('fix core · D1-03 bootstrap sin pestañas malas: config.warnings vacío; otros errores se propagan', function () {
    fresh('setup');
    deepEq(client('bootstrap').config.warnings, [], 'sin avisos');
    swap('presReadAll_', function () { return function () { throw new Error('Sheets caído'); }; }, function () {
      throws(function () { client('bootstrap'); }, /Sheets caído/, 'un error que no es de encabezados no se oculta');
    });
  });

  test('fix core · D1-03 guardado OK pero bundle_ falla → {stale, lastId} (no error, no duplicar)', function () {
    fresh('setup');
    var n = taskCount();
    var r = swap('gRead_', function () { return function () { throw new Error('Sheets no responde'); }; }, function () {
      return client('gSave', { tipo: 'Tarea', pilar: 'nat', nombre: 'Guardada igual', resp: U.ina, fecha: day(5) });
    });
    eq(r.stale, true, 'stale');
    ok(/^TSK-[0-9a-f]{8}$/.test(r.lastId), 'lastId de lo guardado');
    ok(/Se guardó/.test(r.warning) && /Sheets no responde/.test(r.warning), 'mensaje: ' + r.warning);
    eq(taskCount(), n + 1, 'la tarea quedó guardada una vez');
    ok(client('bootstrap').tasks.some(function (t) { return t.id === r.lastId; }), 'aparece al recargar');
  });

  test('fix core · D1-03 log_ que falla no convierte un guardado en error', function () {
    fresh('setup');
    var n = taskCount();
    var b = swap('logCell_', function () { return function () { throw new Error('Historial roto'); }; }, function () {
      return client('gSave', { tipo: 'Tarea', pilar: 'nat', nombre: 'Sin auditoría', resp: U.ina, fecha: day(5) });
    });
    ok(b && !b.stale && /^TSK-/.test(b.lastId), 'bundle normal');
    eq(taskCount(), n + 1);
  });

  test('fix core · D1-06/GAS-03 Historial guarda el texto tal cual (sin fórmulas, fechas ni números)', function () {
    need('commentAdd', 'getHistory');
    fresh('setup');
    var tid = newTask('15/10/2026').lastId;
    var h = client('getHistory', 1)[0];
    eq(h.entidad, '15/10/2026', 'nombre tipo fecha queda como texto');
    var texts = ['=IMPORTDATA("https://example.com/x")', '+1 de acuerdo, se envía hoy', '- Informe enviado - Factura', '=> enviado a gerencia', '2026', 'TRUE'];
    texts.forEach(function (txt) {
      commentAdd(tid, txt);
      eq(client('getHistory', 1)[0].detalle, txt, 'detalle de "' + txt + '"');
    });
    var forms = MOCK.sheet('Historial').getDataRange().getFormulas();
    ok(forms.every(function (row) { return row.every(function (f) { return !f; }); }), 'ninguna celda de Historial es fórmula');
    eq(logCell_('Crear tarea'), 'Crear tarea', 'texto normal sin apóstrofo');
    eq(logCell_(''), '', 'vacío');
  });

  test('fix core · D1-07 sólo el equipo usa la app (correo desconocido y EXTRA_USERS permitidos)', function () {
    need('bootstrap', 'budgetDelete', 'gDelete');
    fresh('demo');
    var b = bootstrap();
    var line = b.budget['2026'][0], prj = b.projects[0];
    var nLines = b.budget['2026'].length;
    asUser('cualquiera@copec.cl', function () {
      throws(function () { client('bootstrap'); }, /acceso/i, 'bootstrap');
      throws(function () { client('getHistory', 5); }, /acceso/i, 'getHistory');
      throws(function () { client('getAdminStatus'); }, /acceso/i, 'getAdminStatus');
      throws(function () { client('budgetDelete', 2026, line.id); }, /acceso/i, 'budgetDelete');
      throws(function () { client('gDelete', prj.id); }, /acceso/i, 'gDelete');
      throws(function () { client('commentAdd', prj.id, 'hola'); }, /acceso/i, 'commentAdd');
    });
    var after = bootstrap();
    eq(after.budget['2026'].length, nLines, 'la línea sigue');
    ok(after.projects.some(function (p) { return p.id === prj.id; }), 'el proyecto sigue');
    asUser('', function () { eq(client('bootstrap').me.email, 'desconocido', 'sin correo visible: se permite'); });
    asUser('IBachler@copec.cl', function () { ok(client('bootstrap').me.email === U.ina, 'equipo (sin importar mayúsculas)'); });
    PropertiesService.getScriptProperties().setProperty('EXTRA_USERS', 'apoyo@copec.cl, Otra@Copec.cl');
    asUser('otra@copec.cl', function () { ok(client('commentAdd', prj.id, 'desde EXTRA_USERS').lastId, 'EXTRA_USERS puede escribir'); });
    asUser('cualquiera@copec.cl', function () { throws(function () { client('bootstrap'); }, /acceso/i, 'sigue bloqueado'); });
  });

  test('fix core · GAS-02 appUrl_ prefiere la URL guardada; setAppUrl valida y es sólo admin', function () {
    need('setAppUrl', 'notifDaily');
    fresh('setup');
    eq(appUrl_(), MOCK.serviceUrl, 'sin URL guardada → getUrl()');
    eq(client('getAdminStatus').appUrlSaved, false);
    var good = 'https://script.google.com/a/macros/copec.cl/s/AKfycbReal_123-x/exec';
    asUser(U.ina, function () { throws(function () { client('setAppUrl', good); }, /administrador/i, 'no admin'); });
    throws(function () { client('setAppUrl', 'https://example.com/exec'); }, /script\.google\.com/i, 'URL ajena');
    throws(function () { client('setAppUrl', 'https://script.google.com/macros/s/ABC/dev'); }, /exec/i, '/dev no sirve');
    var b = client('setAppUrl', good + '?usp=sharing');
    eq(b.config.appUrl, good, 'bundle con la URL guardada (sin query)');
    eq(appUrl_(), good);
    eq(client('getAdminStatus').appUrlSaved, true);
    ok(client('setAppUrl', 'https://script.google.com/macros/s/AKfy/exec').config.appUrl, 'formato sin dominio');
    client('setAppUrl', good);
    MOCK.serviceUrl = 'https://script.google.com/macros/s/IDQUENOEXISTE/exec';
    try {
      gSave({ tipo: 'Tarea', pilar: 'nat', nombre: 'Con link', resp: U.ina, fecha: day(-1) });
      notifDaily();
      var mail = MOCK.mails.filter(function (m) { return m.to === U.ina; })[0];
      ok(mail, 'correo enviado');
      includes(mail.htmlBody, good + '#/tareas', 'el correo usa la URL guardada');
      ok(mail.htmlBody.indexOf('IDQUENOEXISTE') < 0, 'no usa getUrl()');
    } finally { MOCK.serviceUrl = 'https://script.google.com/a/macros/copec.cl/s/MOCK/exec'; }
    eq(client('setAppUrl', '').config.appUrl, MOCK.serviceUrl, 'vacío borra la URL guardada');
  });

  test('fix core · GAS-05 loadedAt se toma antes de leer la planilla', function () {
    fresh('setup');
    var readAt = null;
    var b = swap('gRead_', function (orig) { return function (ss) { readAt = new Date().toISOString(); var t0 = Date.now(); while (Date.now() - t0 < 3) { /* lectura lenta */ } return orig(ss); }; }, function () {
      return client('bootstrap');
    });
    ok(readAt, 'se leyó');
    ok(b.loadedAt <= readAt, 'loadedAt (' + b.loadedAt + ') ≤ inicio de la lectura (' + readAt + ')');
  });
})();
