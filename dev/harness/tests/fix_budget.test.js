/* Regresiones del grupo "budget" (Presupuesto.gs): D1-02 guardado con base, D1-04 IDs al editar la planilla a mano */
(function () {
  // Columnas de "Cuadre 2026" después de setup(): A Área … K Nota, L Responsable, M ID
  var C = { area: 1, proj: 2, clas: 3, po: 4, pf: 5, pg: 6, oc: 8, nota: 11, resp: 12, id: 13 };
  var EMIS = 'GV - Emisiones: certificacion Huella Carbono + Huella Chile';
  var JARD = 'Levantamiento informacion Jardines';
  function cell(row, col) { return MOCK.values('Cuadre 2026')[row - 1][col - 1]; }
  function lastLog() { var h = rowsOf('Historial'); return h[h.length - 1] || {}; }
  function logsOf(accion) { return rowsOf('Historial').filter(function (r) { return r['Acción'] === accion; }); }
  function projectOf(b, id) { return b.projects.find(function (p) { return (p.lineas || []).indexOf(id) >= 0; }); }

  /* ---------- D1-02 ---------- */
  test('fix_budget · D1-02 guardar sólo la nota no revierte el Pagado cambiado en la planilla', function () {
    fresh('demo');
    var l = lineBy(bootstrap(), 2026, EMIS);
    eq(l.pg, 2306146, 'pagado inicial');
    MOCK.sheet('Cuadre 2026').getRange(l.row, C.pg).setValue(4612000); // otro usuario edita la hoja
    var b = asUser(U.ina, function () { return client('budgetSave', 2026, l.id, { nota: 'nota nueva' }, { nota: '' }); });
    var n = lineBy(b, 2026, EMIS);
    eq(n.pg, 4612000, 'el Pagado de la planilla se mantiene');
    eq(n.nota, 'nota nueva');
    eq(n.estado, 'Ejecutado', 'estado calculado con el Pagado real');
    eq(cell(l.row, C.pg), 4612000, 'Pagado en la hoja');
    var log = lastLog();
    eq(log['Acción'], 'Editar línea');
    ok(!/Pagado/.test(String(log.Detalle)), 'el Historial no registra un cambio de Pagado: ' + log.Detalle);
    includes(String(log.Detalle), 'Nota');
  });

  test('fix_budget · D1-02 conflicto: un campo editado por ambos lados se avisa y no se escribe', function () {
    fresh('demo');
    var l = lineBy(bootstrap(), 2026, EMIS);
    MOCK.sheet('Cuadre 2026').getRange(l.row, C.pg).setValue(4612000);
    var nLogs = rowsOf('Historial').length;
    throws(function () { client('budgetSave', 2026, l.id, { pg: 3000000, nota: 'x' }, { pg: 2306146, nota: '' }); },
      /"Pagado" \(ahora \$4\.612\.000\) cambi.*mientras editabas/);
    eq(cell(l.row, C.pg), 4612000, 'la hoja no cambió');
    eq(cell(l.row, C.nota), '', 'tampoco la nota (nada se escribe)');
    eq(rowsOf('Historial').length, nLogs, 'sin registro en Historial');
    // Reintento con la base actualizada (el usuario ya vio el valor nuevo) → se aplica su valor
    var b = client('budgetSave', 2026, l.id, { pg: 3000000 }, { pg: 4612000 });
    eq(lineBy(b, 2026, EMIS).pg, 3000000, 'reintento aplica el valor');
  });

  test('fix_budget · D1-02 mismo valor en ambos lados, base omitida y valores raros de la hoja', function () {
    fresh('demo');
    var l = lineBy(bootstrap(), 2026, EMIS);
    var sh = MOCK.sheet('Cuadre 2026');
    sh.getRange(l.row, C.pg).setValue(4612000);
    // Ambos pusieron el mismo valor: no es conflicto
    var b = client('budgetSave', 2026, l.id, { pg: 4612000 }, { pg: 2306146 });
    eq(lineBy(b, 2026, EMIS).pg, 4612000);
    // Sin base (llamada de 3 argumentos, p. ej. edición rápida en la tabla): compatible, sin verificación
    b = client('budgetSave', 2026, l.id, { pg: 1000 });
    eq(lineBy(b, 2026, EMIS).pg, 1000, 'llamada de 3 argumentos');
    // Base que no es objeto: se ignora
    b = client('budgetSave', 2026, l.id, { pg: 2000 }, null);
    eq(lineBy(b, 2026, EMIS).pg, 2000, 'base null');

    // Hoja con salto de línea en el nombre, clasificación vacía y área no reconocida
    sh.getRange(l.row, C.proj).setValue('GV - Emisiones:\ncertificacion');
    sh.getRange(l.row, C.clas).setValue('');
    sh.getRange(l.row, C.area).setValue('Marte');
    var x = bootstrap().budget['2026'].find(function (y) { return y.id === l.id; });
    eq(x.pilar, '', 'área no reconocida');
    // base como la arma el navegador: el input quita el salto de línea; área = clave de pilar (vacía)
    b = client('budgetSave', 2026, l.id, { proj: 'Emisiones certificadas', clas: 'Nuevo', area: 'cc' },
      { proj: 'GV - Emisiones:certificacion', clas: '', area: '' });
    var n = b.budget['2026'].find(function (y) { return y.id === l.id; });
    eq(n.proj, 'Emisiones certificadas'); eq(n.clas, 'Nuevo'); eq(n.pilar, 'cc');
    // y con la base exacta de la planilla (salto incluido)
    sh.getRange(l.row, C.proj).setValue('Linea\ncon salto');
    b = client('budgetSave', 2026, l.id, { proj: 'Linea renombrada' }, { proj: 'Linea\ncon salto' });
    eq(b.budget['2026'].find(function (y) { return y.id === l.id; }).proj, 'Linea renombrada');
  });

  /* ---------- D1-04 ---------- */
  test('fix_budget · D1-04 fila vaciada a mano: se quita su ID y una línea nueva ahí no hereda proyecto ni comentarios', function () {
    fresh('demo');
    var b = bootstrap();
    var l = lineBy(b, 2026, JARD);
    var p = projectOf(b, l.id);
    ok(p, 'la línea parte vinculada a un proyecto');
    commentAdd(l.id, 'Factura 123 aprobada');
    var sh = MOCK.sheet('Cuadre 2026');
    sh.getRange(l.row, 1, 1, C.id - 1).clearContent(); // borra A:L, el ID queda en M
    eq(cell(l.row, C.id), l.id, 'el ID quedó en la hoja');
    var b2 = bootstrap();
    ok(!b2.budget['2026'].some(function (x) { return x.id === l.id; }), 'la línea ya no está');
    eq(cell(l.row, C.id), '', 'la reparación quitó el ID de la fila vacía');
    var g = logsOf('Línea borrada en la planilla');
    eq(g.length, 1, 'un registro en Historial');
    includes(String(g[0].Detalle), l.id);
    includes(String(g[0].Detalle), 'Fila ' + l.row);
    ok(!presNeedsRepair_(presYears_(MOCK.spreadsheet()).map(presReadTab_)), 'no vuelve a pedir reparación');
    // Nueva línea escrita en esa fila
    sh.getRange(l.row, 1, 1, 6).setValues([['Naturaleza', 'Nueva consultoría aves', 'Nuevo', 0, 3000000, 0]]);
    var b3 = bootstrap();
    var n = lineBy(b3, 2026, 'Nueva consultoría aves');
    eq(n.row, l.row, 'misma fila');
    ok(n.id !== l.id && /^L-[0-9a-f]{8}$/.test(n.id), 'ID nuevo');
    ok(!projectOf(b3, n.id), 'no hereda el proyecto');
    ok(!b3.comments.some(function (c) { return c.ref === n.id; }), 'no hereda los comentarios');
    eq(logsOf('Línea borrada en la planilla').length, 1, 'sin registros repetidos');
  });

  test('fix_budget · D1-04 borrar sólo el Proyecto (reescribiéndolo) conserva el ID', function () {
    fresh('demo');
    var l = lineBy(bootstrap(), 2026, JARD);
    var sh = MOCK.sheet('Cuadre 2026');
    sh.getRange(l.row, C.proj).setValue('');
    bootstrap();
    eq(cell(l.row, C.id), l.id, 'con otros datos en la fila, el ID se conserva');
    sh.getRange(l.row, C.proj).setValue(JARD);
    eq(lineBy(bootstrap(), 2026, JARD).id, l.id, 'misma línea, mismo ID');
    eq(logsOf('Línea borrada en la planilla').length, 0);
  });

  test('fix_budget · D1-04 ID repetido en la misma pestaña queda en el Historial con ambas filas', function () {
    fresh('demo');
    var l = lineBy(bootstrap(), 2026, JARD);
    var sh = MOCK.sheet('Cuadre 2026');
    var orig = sh.getRange(l.row, 1, 1, C.id).getValues()[0];
    sh.insertRowBefore(l.row); // copia pegada arriba, con ID
    sh.getRange(l.row, 1, 1, C.id).setValues([orig.map(function (v, j) { return j === C.proj - 1 ? 'Linea nueva copiada' : v; })]);
    var b = bootstrap();
    var ids = b.budget['2026'].map(function (x) { return x.id; });
    eq(new Set(ids).size, ids.length, 'IDs únicos');
    var g = logsOf('ID repetido');
    eq(g.length, 1, 'un registro');
    var d = String(g[0].Detalle);
    includes(d, l.id);
    includes(d, 'filas ' + l.row + ' ("Linea nueva copiada") y ' + (l.row + 1));
    includes(d, 'ID nuevo a la fila ' + (l.row + 1));
  });

  test('fix_budget · D1-04 IDs de otra pestaña: un solo registro resumido', function () {
    fresh('setup');
    var b = bootstrap();
    var sh = MOCK.sheet('Cuadre 2027');
    b.budget['2026'].slice(0, 3).forEach(function (x, k) { sh.getRange(k + 2, C.id).setValue(x.id); });
    bootstrap();
    var g = logsOf('IDs nuevos');
    eq(g.length, 1);
    includes(String(g[0].Detalle), '3 líneas');
  });

  test('fix_budget · D1-04 protección "sólo advertencia" en la columna ID', function () {
    fresh('setup');
    var before = MOCK.unknownCalls.length;
    budgetCreateYear(2029);
    var calls = MOCK.unknownCalls.slice(before);
    includes(calls, 'Range.protect', 'pestaña nueva');
    includes(calls, 'Range.setWarningOnly');
    before = MOCK.unknownCalls.length;
    recalcAll();
    includes(MOCK.unknownCalls.slice(before), 'Range.protect', 'recalcAll en pestañas existentes');
    eq(presColA1_(13), 'M'); eq(presColA1_(27), 'AA'); eq(presColA1_(1), 'A');
  });
})();
