/* Presupuesto · pestañas "Cuadre AAAA" (SPEC §1.1, §5) */
(function () {
  var HEAD11 = SEED_CUADRE_2026[0];
  var COL = {}; HEAD11.forEach(function (h, j) { COL[h] = j; });

  // Reglas de negocio de la SPEC, implementadas aquí de forma independiente
  function rules(pf, pg, oc, clas) {
    var pend = Math.max(pf - pg, 0);
    var estado = pf === 0 ? 'No se realizará' : pg >= pf ? 'Ejecutado' : (oc === 'Si' || pg > 0) ? 'En curso' : 'Por ejecutar';
    var alerta = pf === 0 ? '—' : clas === 'Fuera de POA' ? 'Ejecutado' : oc === '' ? 'Definir OC' : (oc === 'No' && pend > 0) ? 'Pagar/OC ya' : pend === 0 ? 'Pagado' : 'OK con OC';
    return { pend: pend, estado: estado, alerta: alerta };
  }
  function header(name) { var sh = MOCK.sheet(name); return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }
  function colOf(name, h) { var i = header(name).indexOf(h); ok(i >= 0, 'falta la columna "' + h + '" en ' + name); return i + 1; }
  function allIds(b) { var out = []; b.years.forEach(function (y) { b.budget[String(y)].forEach(function (l) { out.push(l.id); }); }); return out; }

  test('presupuesto · años [2026, 2027] y defaultYear', function () {
    fresh('setup');
    var b = bootstrap();
    deepEq(b.years, [2026, 2027]);
    var cy = new Date().getFullYear();
    eq(b.defaultYear, b.years.indexOf(cy) >= 0 ? cy : b.years[b.years.length - 1]);
    eq(b.budget['2027'].length, SEED_CUADRE_2027.length - 1, 'líneas 2027');
  });

  test('presupuesto · Estado/Alerta/Pendiente = valores originales de la planilla (2026)', function () {
    need('setup', 'bootstrap');
    fresh('setup');
    var b = bootstrap();
    var lines = b.budget['2026'];
    eq(lines.length, SEED_CUADRE_2026.length - 1, 'cantidad de líneas');
    var bad = [];
    var sheet = MOCK.values('Cuadre 2026');
    for (var i = 1; i < SEED_CUADRE_2026.length; i++) {
      var o = SEED_CUADRE_2026[i];
      var l = lines.find(function (x) { return x.row === i + 1; });
      if (!l) { bad.push('fila ' + (i + 1) + ' no aparece'); continue; }
      if (l.proj !== o[COL.Proyecto]) bad.push('fila ' + (i + 1) + ' proyecto ' + l.proj);
      if (l.estado !== o[COL.Estado]) bad.push(o[COL.Proyecto] + ': estado ' + l.estado + ' ≠ ' + o[COL.Estado]);
      if (l.alerta !== o[COL.Alerta]) bad.push(o[COL.Proyecto] + ': alerta ' + l.alerta + ' ≠ ' + o[COL.Alerta]);
      if (l.pend !== o[COL.Pendiente]) bad.push(o[COL.Proyecto] + ': pendiente ' + l.pend + ' ≠ ' + o[COL.Pendiente]);
      if (l.pf !== o[COL['Monto final proyectado']] || l.pg !== o[COL['Pagado a la fecha']] || l.po !== o[COL['Presupuesto original']]) bad.push(o[COL.Proyecto] + ': montos');
      if (l.oc !== o[COL['OC emitida']]) bad.push(o[COL.Proyecto] + ': oc ' + l.oc);
      ['Pendiente', 'Estado', 'Alerta'].forEach(function (h) {
        if (sheet[i][COL[h]] !== o[COL[h]]) bad.push('hoja ' + o[COL.Proyecto] + ': ' + h + ' cambió a ' + sheet[i][COL[h]]);
      });
      var pk = { 'Cambio Climatico': 'cc', 'Economia Circular': 'ec', 'Naturaleza': 'nat' }[o[COL.Area]];
      if (l.pilar !== pk) bad.push(o[COL.Proyecto] + ': pilar ' + l.pilar);
    }
    ok(!bad.length, bad.length + ' diferencias: ' + bad.slice(0, 6).join(' | '));
  });

  test('presupuesto · setup agrega Responsable e ID al final y calcula 2027', function () {
    fresh('setup');
    deepEq(header('Cuadre 2026'), HEAD11.concat(['Responsable', 'ID']), 'encabezados 2026');
    deepEq(header('Cuadre 2027'), HEAD11.concat(['Responsable', 'ID']), 'encabezados 2027');
    var v = MOCK.values('Cuadre 2027');
    for (var i = 1; i < SEED_CUADRE_2027.length; i++) {
      var o = SEED_CUADRE_2027[i];
      var r = rules(o[4], o[5], o[7], o[2]);
      eq(v[i][COL.Pendiente], r.pend, o[1] + ' Pendiente');
      eq(v[i][COL.Estado], r.estado, o[1] + ' Estado');
      eq(v[i][COL.Alerta], r.alerta, o[1] + ' Alerta');
      ok(/^L-[0-9a-f]{8}$/.test(v[i][12]), o[1] + ' ID en la hoja');
    }
  });

  test('presupuesto · IDs se asignan una vez y son estables (sin setup, dos bootstraps)', function () {
    fresh('raw');
    var b1 = bootstrap();
    var ids = allIds(b1);
    ok(ids.every(function (id) { return /^L-[0-9a-f]{8}$/.test(id); }), 'formato L-xxxxxxxx: ' + ids.filter(function (id) { return !/^L-[0-9a-f]{8}$/.test(id); }).slice(0, 3).join(', '));
    eq(new Set(ids).size, ids.length, 'IDs únicos entre años');
    var col = colOf('Cuadre 2026', 'ID');
    var inSheet = MOCK.sheet('Cuadre 2026').getRange(2, col, b1.budget['2026'].length, 1).getValues().map(function (r) { return r[0]; });
    deepEq(inSheet, b1.budget['2026'].map(function (l) { return l.id; }), 'IDs escritos en la hoja');
    deepEq(allIds(bootstrap()), ids, 'segundo bootstrap');
    setup();
    deepEq(allIds(bootstrap()), ids, 'después de setup()');
  });

  test('presupuesto · IDs repetidos entre pestañas (pestaña duplicada) se corrigen', function () {
    fresh('setup');
    var b = bootstrap();
    var first = b.budget['2026'][0].id;
    MOCK.sheet('Cuadre 2027').getRange(2, colOf('Cuadre 2027', 'ID')).setValue(first);
    var b2 = bootstrap();
    var ids = allIds(b2);
    eq(new Set(ids).size, ids.length, 'IDs únicos');
    eq(b2.budget['2026'][0].id, first, 'la línea de 2026 conserva su ID');
    ok(b2.budget['2027'][0].id !== first, '2027 recibe un ID nuevo');
  });

  test('presupuesto · budgetSave edita, recalcula y escribe en la hoja', function () {
    need('budgetSave');
    fresh('setup');
    var l = lineBy(bootstrap(), 2026, 'GV - Auditoria interna ISO 50001');
    eq(l.estado, 'Por ejecutar'); eq(l.alerta, 'Pagar/OC ya');
    var b = client('budgetSave', 2026, l.id, { pg: 1817120, oc: 'sí', nota: 'Pagado en septiembre', resp: 'IDiaz@copec.cl' });
    eq(b.lastId, l.id, 'lastId');
    var n = lineBy(b, 2026, 'GV - Auditoria interna ISO 50001');
    eq(n.pg, 1817120); eq(n.oc, 'Si', '"sí" se normaliza a "Si"'); eq(n.pend, 0); eq(n.estado, 'Ejecutado'); eq(n.alerta, 'Pagado');
    eq(n.nota, 'Pagado en septiembre'); eq(n.resp, 'idiaz@copec.cl', 'responsable en minúsculas'); eq(n.row, l.row, 'misma fila');
    var row = MOCK.values('Cuadre 2026')[l.row - 1];
    eq(row[COL['Pagado a la fecha']], 1817120); eq(row[COL['OC emitida']], 'Si'); eq(row[COL.Pendiente], 0);
    eq(row[COL.Estado], 'Ejecutado'); eq(row[COL.Alerta], 'Pagado'); eq(row[COL.Nota], 'Pagado en septiembre');
    eq(row[colOf('Cuadre 2026', 'Responsable') - 1], 'idiaz@copec.cl');
    var h = rowsOf('Historial');
    ok(h.length > 4 && /l[ií]nea/i.test(String(h[h.length - 1]['Acción'])), 'se registró en Historial');
  });

  test('presupuesto · budgetSave crea una línea nueva (área por clave de pilar)', function () {
    fresh('setup');
    var before = bootstrap().budget['2026'].length;
    var b = client('budgetSave', 2026, '', { area: 'nat', proj: 'Línea creada por el harness', clas: 'Nuevo', po: 1000000, pf: 1200000, pg: 0, oc: '' });
    ok(/^L-[0-9a-f]{8}$/.test(b.lastId), 'lastId');
    eq(b.budget['2026'].length, before + 1);
    var l = b.budget['2026'].find(function (x) { return x.id === b.lastId; });
    ok(l, 'la línea nueva está en el bundle');
    eq(l.area, 'Naturaleza'); eq(l.pilar, 'nat'); eq(l.estado, 'Por ejecutar'); eq(l.alerta, 'Definir OC'); eq(l.pend, 1200000);
    var row = MOCK.values('Cuadre 2026')[l.row - 1];
    eq(row[COL.Area], 'Naturaleza'); eq(row[COL.Proyecto], 'Línea creada por el harness'); eq(row[12], b.lastId, 'ID en la hoja');
    eq(row[COL.Estado], 'Por ejecutar'); eq(row[COL.Alerta], 'Definir OC');
  });

  test('presupuesto · budgetSave en 2027 y en un año inexistente', function () {
    fresh('setup');
    var b = client('budgetSave', '2027', '', { area: 'Cambio Climático', proj: 'Nueva 2027', pf: 5000000, pg: 0, oc: 'Si' });
    var l = b.budget['2027'].find(function (x) { return x.id === b.lastId; });
    ok(l, 'creada en 2027'); eq(l.estado, 'En curso'); eq(l.alerta, 'OK con OC');
    throws(function () { budgetSave(2031, '', { area: 'cc', proj: 'X' }); }, /Cuadre 2031/);
  });

  test('presupuesto · budgetSave valida datos', function () {
    fresh('setup');
    var l = lineBy(bootstrap(), 2026, 'Lemu');
    throws(function () { budgetSave(2026, l.id, { area: 'Marte' }); }, /[áa]rea/i, 'área inválida');
    throws(function () { budgetSave(2026, l.id, { pg: -5 }); }, /negativ/i, 'monto negativo');
    throws(function () { budgetSave(2026, l.id, { oc: 'quizás' }); }, /OC/, 'OC inválida');
    throws(function () { budgetSave(2026, l.id, { clas: 'Otro' }); }, /Clasificaci/i, 'clasificación');
    throws(function () { budgetSave(2026, l.id, { resp: 'no-es-correo' }); }, /correo|responsable/i, 'responsable');
    throws(function () { budgetSave(2026, 'L-00000000', { nota: 'x' }); }, /no encontr/i, 'ID inexistente');
    throws(function () { budgetSave(2026, '', { area: 'nat', proj: '' }); }, /nombre|proyecto/i, 'sin nombre');
    throws(function () { budgetSave('dos mil', '', { area: 'nat', proj: 'x' }); }, /a[ñn]o/i, 'año inválido');
  });

  test('presupuesto · celdas con fórmula nunca se sobrescriben', function () {
    fresh('setup');
    var l = lineBy(bootstrap(), 2026, 'GV - Auditoria interna ISO 50001');
    var r = l.row;
    var cPend = COL.Pendiente + 1, cPg = COL['Pagado a la fecha'] + 1;
    var f = '=MAX(' + MOCK.numToCol(COL['Monto final proyectado'] + 1) + r + '-' + MOCK.numToCol(cPg) + r + ',0)';
    MOCK.setFormula('Cuadre 2026', MOCK.numToCol(cPend) + r, f);
    var b = budgetSave(2026, l.id, { pg: 500000 });
    var sh = MOCK.sheet('Cuadre 2026');
    eq(sh.getRange(r, cPend).getFormula(), f, 'la fórmula de Pendiente sigue ahí');
    eq(sh.getRange(r, cPend).getValue(), 1317120, 'y calcula con el nuevo pagado');
    eq(sh.getRange(r, cPg).getValue(), 500000);
    eq(lineBy(b, 2026, l.proj).pend, 1317120, 'bundle');
    // Editar directamente una columna con fórmula → error claro
    MOCK.setFormula('Cuadre 2026', MOCK.numToCol(cPg) + r, '=100000+400000');
    throws(function () { budgetSave(2026, l.id, { pg: 700000 }); }, /f[óo]rmula/i);
    budgetSave(2026, l.id, { nota: 'nota con fórmula al lado' });
    eq(sh.getRange(r, cPg).getFormula(), '=100000+400000', 'editar otra columna no toca la fórmula');
  });

  test('presupuesto · budgetDelete borra la línea y limpia vínculos en Gestión', function () {
    need('budgetDelete');
    fresh('demo');
    var b = bootstrap();
    var p = b.projects.find(function (x) { return x.nombre === 'Humedal El Bato (Quintero)'; });
    ok(p && p.lineas.length >= 2, 'proyecto demo con líneas');
    var lid = p.lineas[0];
    var l = Object.keys(b.budget).map(function (y) { return b.budget[y]; }).reduce(function (a, x) { return a.concat(x); }, []).find(function (x) { return x.id === lid; });
    commentAdd(lid, 'comentario que debe desaparecer');
    var rowsBefore = MOCK.sheet('Cuadre ' + l.year).getLastRow();
    var b2 = client('budgetDelete', l.year, lid);
    ok(!b2.budget[String(l.year)].some(function (x) { return x.id === lid; }), 'la línea ya no está');
    eq(MOCK.sheet('Cuadre ' + l.year).getLastRow(), rowsBefore - 1, 'una fila menos en la hoja');
    var p2 = b2.projects.find(function (x) { return x.id === p.id; });
    ok(p2.lineas.indexOf(lid) < 0, 'el proyecto ya no la referencia');
    eq(p2.lineas.length, p.lineas.length - 1);
    ok(!b2.comments.some(function (c) { return c.ref === lid; }), 'sus comentarios se borraron');
    throws(function () { budgetDelete(l.year, lid); }, /no encontr/i, 'borrar dos veces');
  });

  test('presupuesto · budgetCreateYear sólo administradores, 13 encabezados', function () {
    need('budgetCreateYear');
    fresh('setup');
    asUser(U.ina, function () { throws(function () { budgetCreateYear(2028); }, /administrador/i); });
    var b = client('budgetCreateYear', 2028);
    deepEq(b.years, [2026, 2027, 2028]);
    deepEq(header('Cuadre 2028'), HEAD11.concat(['Responsable', 'ID']), 'encabezados');
    eq(MOCK.sheet('Cuadre 2028').getFrozenRows(), 1, 'fila 1 fija');
    deepEq(b.budget['2028'], [], 'año vacío');
    throws(function () { budgetCreateYear(2028); }, /existe/i, 'no duplica');
    var b2 = budgetSave(2028, '', { area: 'ec', proj: 'Primera línea 2028', pf: 100, pg: 0, oc: 'No' });
    eq(b2.budget['2028'].length, 1, 'se puede cargar el año nuevo');
  });

  test('presupuesto · recalcAll corrige valores escritos a mano en la hoja', function () {
    need('recalcAll');
    fresh('setup');
    var l = lineBy(bootstrap(), 2026, 'Lemu');
    var sh = MOCK.sheet('Cuadre 2026');
    sh.getRange(l.row, COL.Estado + 1).setValue('Cualquier cosa');
    sh.getRange(l.row, COL.Pendiente + 1).setValue(1);
    var b = client('recalcAll');
    eq(lineBy(b, 2026, 'Lemu').estado, 'Por ejecutar', 'bundle');
    eq(sh.getRange(l.row, COL.Estado + 1).getValue(), 'Por ejecutar');
    eq(sh.getRange(l.row, COL.Pendiente + 1).getValue(), 4000000);
  });

  test('presupuesto · columnas en otro orden y filas de totales', function () {
    fresh('raw');
    // Reordena la pestaña 2027: Proyecto primero; agrega una fila TOTAL al final
    var v = MOCK.values('Cuadre 2027');
    var order = [1, 0].concat(v[0].map(function (x, j) { return j; }).slice(2));
    var re = v.map(function (r) { return order.map(function (j) { return r[j]; }); });
    re.push(['TOTAL', '', '', 999, 999, 0, '', '', '', '', '']);
    MOCK.removeAllSheets();
    seedSpreadsheet();
    MOCK.spreadsheet().deleteSheet(MOCK.sheet('Cuadre 2027'));
    MOCK.addSheet('Cuadre 2027', re, { frozenRows: 1 });
    var b = bootstrap();
    eq(b.budget['2027'].length, SEED_CUADRE_2027.length - 1, 'la fila TOTAL no es una línea');
    eq(b.budget['2027'][0].proj, SEED_CUADRE_2027[1][1], 'lee por nombre de encabezado');
  });
})();
