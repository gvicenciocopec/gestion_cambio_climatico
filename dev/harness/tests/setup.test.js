/* Setup · configuración idempotente, menú, mostrar/ocultar Gestión (SPEC §5 Setup.gs) */
(function () {
  test('setup · guarda SHEET_ID, crea Gestión e Historial y es idempotente', function () {
    need('setup');
    fresh('raw');
    var r = setup();
    ok(r && typeof r === 'object', 'devuelve un resumen');
    eq(PropertiesService.getScriptProperties().getProperty('SHEET_ID'), MOCK.spreadsheet().getId(), 'SHEET_ID');
    var names = MOCK.sheetNames();
    includes(names, 'Gestión'); includes(names, 'Historial');
    var hist = MOCK.values('Historial');
    deepEq(hist[0], ['Fecha', 'Usuario', 'Acción', 'Proyecto', 'Detalle'], 'encabezados Historial intactos');
    ok(hist.length >= 5, 'conserva las filas v1');
    var snapRows = MOCK.sheet('Gestión').getLastRow();
    setup();
    deepEq(MOCK.sheetNames(), names, 'no crea pestañas nuevas');
    eq(MOCK.sheet('Gestión').getLastRow(), snapRows, 'no agrega filas a Gestión');
    ok(MOCK.sheet('Gestión').isSheetHidden(), 'sigue oculta');
    assertNoDates(r, 'setup()');
  });

  test('setup · sin Historial lo crea; sin planilla vinculada usa SHEET_ID', function () {
    fresh('raw');
    MOCK.spreadsheet().deleteSheet(MOCK.sheet('Historial'));
    setup();
    deepEq(MOCK.values('Historial')[0], ['Fecha', 'Usuario', 'Acción', 'Proyecto', 'Detalle']);
    MOCK.bound = false; // web app sin hoja activa: ss_() usa la propiedad SHEET_ID
    var b = bootstrap();
    deepEq(b.years, [2026, 2027]);
  });

  test('setup · usuario no administrador no instala el activador', function () {
    fresh('raw');
    asUser(U.ina, function () { setup(); });
    eq(MOCK.triggers().length, 0);
    ok(MOCK.sheet('Gestión'), 'igual crea la estructura');
  });

  test('setup · administrador instala un activador diario', function () {
    fresh('raw');
    setup();
    var ts = MOCK.triggers();
    eq(ts.length, 1);
    eq(ts[0].handler, 'notifDaily'); eq(ts[0].cfg.atHour, CONFIG.NOTIFY_HOUR); eq(ts[0].cfg.everyDays, 1);
    setup();
    eq(MOCK.triggers().length, 1, 'no duplica');
  });

  test('setup · Gestión existente con columnas faltantes se completa sin perder datos', function () {
    need('setup', 'G_HEADERS');
    fresh('raw');
    var partial = G_HEADERS.slice(0, 12);
    MOCK.addSheet('Gestión', [partial, ['PRJ-0000abcd', 'Proyecto', 'Naturaleza', '', 'Proyecto viejo', 'desc', 'ibachler@copec.cl', '', 'Activo', '', '', '']], { hidden: true });
    setup();
    var sh = MOCK.sheet('Gestión');
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    G_HEADERS.forEach(function (h) { includes(head, h, 'columna ' + h); });
    var p = bootstrap().projects.find(function (x) { return x.id === 'PRJ-0000abcd'; });
    ok(p, 'el proyecto existente sigue ahí'); eq(p.nombre, 'Proyecto viejo'); eq(p.resp, U.ina);
  });

  test('setup · toggleGestionSheet muestra y oculta', function () {
    need('toggleGestionSheet');
    fresh('setup');
    var sh = MOCK.sheet('Gestión');
    toggleGestionSheet();
    eq(sh.isSheetHidden(), false, 'visible');
    toggleGestionSheet();
    eq(sh.isSheetHidden(), true, 'oculta');
  });

  test('setup · onOpen agrega el menú cuando hay interfaz (y no falla sin ella)', function () {
    need('onOpen');
    fresh('setup');
    onOpen(); // sin UI: no debe lanzar
    MOCK.ui = true;
    onOpen();
    var menus = MOCK.menus();
    eq(menus.length, 1, 'un menú');
    var fns = menus[0].items.map(function (i) { return i[1]; }).filter(Boolean);
    ['setup', 'recalcAll', 'toggleGestionSheet'].forEach(function (f) { includes(fns, f, 'menú → ' + f); });
    fns.forEach(function (f) { eq(typeof G(f), 'function', 'el menú apunta a una función existente: ' + f); });
  });

  test('setup · zona horaria de la planilla distinta → aviso', function () {
    fresh('raw');
    MOCK.ssTz = 'Etc/GMT';
    var r = setup();
    ok((r.warnings || []).some(function (w) { return /zona horaria/i.test(w); }), 'avisa la diferencia de zona horaria');
  });
})();
