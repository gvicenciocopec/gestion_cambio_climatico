/* Regresiones del grupo gestion-srv: D1-01 (versión / ediciones concurrentes), D1-05 (líneas de proyecto),
   D1-08 (comentarios huérfanos en líneas), GAS-01 (apóstrofo en columnas de texto plano @). */
(function () {
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function prjBy(b, nombre) { var p = b.projects.find(function (x) { return x.nombre === nombre; }); ok(p, 'no encontré el proyecto "' + nombre + '"'); return p; }
  // Espera a que cambie el milisegundo: dos escrituras seguidas no comparten "Actualizado"
  function tick() { var t = Date.now(); while (Date.now() <= t) { /* espera activa */ } }
  function freeLine(b, pilar) {
    var linked = {};
    b.projects.forEach(function (p) { p.lineas.forEach(function (id) { linked[id] = 1; }); });
    var l = b.budget['2026'].find(function (x) { return x.pilar === pilar && x.pf > 0 && !linked[x.id]; });
    ok(l, 'no encontré una línea libre de ' + pilar);
    return l;
  }
  function lineYear(b, id) {
    var y = Object.keys(b.budget).find(function (k) { return b.budget[k].some(function (l) { return l.id === id; }); });
    ok(y, 'no encontré la línea ' + id);
    return Number(y);
  }
  // Emula Sheets real en celdas con formato texto plano (@): lo escrito se guarda literal (también un apóstrofo
  // inicial, que el mock normalmente quita). Sólo para la pestaña Gestión de esta prueba.
  function plainTextLiteral() {
    var sh = MOCK.sheet('Gestión');
    ok(sh, 'falta la pestaña Gestión');
    var orig = sh._write;
    sh._write = function (r, c, v) {
      var cell = this._ensure(r, c);
      if (cell.nf === '@' && typeof v === 'string') { cell.f = ''; cell.v = v; this._dirty = true; return; }
      return orig.call(this, r, c, v);
    };
    return sh;
  }
  function cellOf(id, header) {
    var row = gRows().find(function (r) { return r.ID === id; });
    ok(row, 'no encontré la fila ' + id);
    return { row: row._row, col: G_HEADERS.indexOf(header) + 1, value: row[header] };
  }

  /* ---------------- GAS-01 ---------------- */

  test('fix gestion-srv · GAS-01 columnas @ sin apóstrofo: Notificado no reenvía y Año se conserva', function () {
    need('gSave', 'notifDaily', 'commentAdd');
    fresh('setup');
    var sh = plainTextLiteral();
    eq(gCellValue_('Notificado', '2026-10-15:3'), '2026-10-15:3', 'marca sin apóstrofo');
    eq(gCellValue_('Año', '2026'), '2026', 'año sin apóstrofo');
    eq(gCellValue_('Detalle', '- punto uno'), '- punto uno', 'viñeta sin apóstrofo');
    eq(gCellValue_('Nombre', '=SUMA(1;2)'), "'=SUMA(1;2)", '"=" sigue protegido');

    // v3.3 (SPEC §17): el único aviso es el de vencida, en la revisión diaria
    MOCK.clearBuffers();
    var id = gSave({ tipo: 'Tarea', pilar: 'nat', nombre: 'Aviso @', resp: U.ina, fecha: day(-1) }).lastId;
    eq(MOCK.mails.length, 0, 'guardar no envía');
    notifDaily();
    eq(MOCK.mails.length, 1, 'aviso de vencida');
    var n = cellOf(id, 'Notificado');
    eq(String(n.value).charAt(0), day(-1).charAt(0), 'la marca quedó sin apóstrofo literal: ' + n.value);
    MOCK.clearBuffers();
    notifDaily();
    eq(MOCK.mails.length, 0, 'la segunda corrida no reenvía');

    var p = gSave({ tipo: 'Proyecto', pilar: 'nat', nombre: 'Proyecto con año', anio: '2026' });
    eq(find(p, 'projects', p.lastId).anio, '2026', 'Año 2026 (no "todos los años")');
    eq(String(cellOf(p.lastId, 'Año').value), '2026', 'celda Año');

    var c = commentAdd(id, '- punto uno\n- punto dos');
    eq(find(c, 'comments', c.lastId).texto, '- punto uno\n- punto dos', 'comentario sin apóstrofo visible');

    var f = gSave({ tipo: 'Tarea', pilar: 'nat', nombre: '=HYPERLINK("http://x")', detalle: '+56 9 1234 5678' });
    var ft = find(f, 'tasks', f.lastId);
    eq(ft.nombre, '=HYPERLINK("http://x")', 'nombre intacto al leer');
    eq(ft.detalle, '+56 9 1234 5678', 'detalle intacto');
    var nc = cellOf(f.lastId, 'Nombre');
    eq(sh.getRange(nc.row, nc.col).getFormula(), '', 'no quedó como fórmula');
  });

  test('fix gestion-srv · GAS-01 filas antiguas con apóstrofo literal se leen bien', function () {
    fresh('setup');
    var sh = plainTextLiteral();
    var id = gSave({ tipo: 'Tarea', pilar: 'nat', nombre: 'Fila antigua', resp: U.ina, fecha: day(-2) }).lastId;
    var pid = gSave({ tipo: 'Proyecto', pilar: 'nat', nombre: 'Proyecto antiguo', anio: '2026' }).lastId;
    var cid = commentAdd(id, 'texto').lastId;
    var cid2 = commentAdd(id, 'otro').lastId;
    // Lo que dejaba la versión anterior de gCellValue_ en celdas @
    function put(rid, header, v) { var c = cellOf(rid, header); sh._ensure(c.row, c.col).v = v; sh._dirty = true; }
    put(id, 'Notificado', "'" + day(-2) + ':3,0');
    put(id, 'Cierre', "'15/10");
    put(pid, 'Año', "'2026");
    put(cid, 'Detalle', "'-1");
    put(cid2, 'Detalle', "'hola' dijo"); // apóstrofo escrito por el usuario: se respeta
    var b = bootstrap();
    eq(find(b, 'projects', pid).anio, '2026', 'Año antiguo');
    eq(find(b, 'comments', cid).texto, '-1', 'comentario antiguo');
    eq(find(b, 'comments', cid2).texto, "'hola' dijo", 'apóstrofo real intacto');
    MOCK.clearBuffers();
    notifDaily();
    eq(MOCK.mails.length, 0, 'la marca antigua vale: no reenvía');
    // Al reescribir la fila, los textos quedan sin apóstrofo
    gSave({ tipo: 'Proyecto', id: pid, detalle: 'editado' });
    eq(String(cellOf(pid, 'Año').value), '2026', 'Año reescrito limpio');
  });

  /* ---------------- D1-01 ---------------- */

  test('fix gestion-srv · D1-01 gSave con base desactualizada no pisa los cambios de otra persona', function () {
    need('gSave', 'taskComplete');
    fresh('demo');
    var b = bootstrap();
    var p = prjBy(b, 'Jardines sustentables');
    var free = freeLine(b, 'nat');
    tick();
    var r = asUser(U.benja, function () { return client('gSave', { tipo: 'Proyecto', id: p.id, lineas: p.lineas.concat([free.id]), base: p.actualizado }); });
    includes(find(r, 'projects', p.id).lineas, free.id, 'Benja vinculó la línea');
    // Ina guarda el formulario que abrió antes (lineas sin la nueva)
    throws(function () {
      asUser(U.ina, function () {
        return client('gSave', { tipo: 'Proyecto', id: p.id, pilar: p.pilar, nombre: p.nombre, detalle: 'Nueva descripción',
          resp: p.resp, estado: p.estado, anio: p.anio, lineas: p.lineas, cascade: p.cascade, evidencias: p.evidencias, base: p.actualizado });
      });
    }, /Otra persona \(Benja\) modific/, 'conflicto con nombre de quien cambió');
    var p2 = find(bootstrap(), 'projects', p.id);
    includes(p2.lineas, free.id, 'la línea de Benja sigue vinculada');
    ok(p2.detalle !== 'Nueva descripción', 'no se guardó la versión vieja');
    // Con la versión actual sí guarda; sin base (llamadas antiguas) también
    var r2 = asUser(U.ina, function () { return gSave({ tipo: 'Proyecto', id: p.id, detalle: 'Nueva descripción', base: p2.actualizado }); });
    eq(find(r2, 'projects', p.id).detalle, 'Nueva descripción');
    gSave({ tipo: 'Proyecto', id: p.id, detalle: 'Sin base' });

    // Tarea: la evidencia del cierre no se pierde con un formulario viejo
    var t = b.tasks.find(function (x) { return x.estado === 'Pendiente' && x.pilar === 'nat' && !x.evidencias.length; });
    ok(t, 'tarea pendiente sin evidencias');
    tick();
    asUser(U.benja, function () { return taskComplete(t.id, { cierre: 'Hecho', evidencias: [{ t: 'Acta', u: 'https://drive.google.com/file/d/abc' }] }); });
    throws(function () {
      asUser(U.ina, function () { return gSave({ tipo: 'Tarea', id: t.id, detalle: 'nota nueva', evidencias: [], fecha: t.fecha, base: t.actualizado }); });
    }, /modific/i, 'conflicto en la tarea');
    var t2 = find(bootstrap(), 'tasks', t.id);
    eq(t2.estado, 'Realizada');
    deepEq(t2.evidencias.map(function (e) { return e.u; }), ['https://drive.google.com/file/d/abc'], 'evidencia del cierre intacta');
    // Mismo usuario en otra pestaña: mensaje propio
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, detalle: 'x', base: p.actualizado }); }, /otra pestaña|modific/i);
  });

  test('fix gestion-srv · D1-01 taskComplete no pisa un cierre; taskReopen sólo reabre realizadas', function () {
    fresh('setup');
    var id = gSave({ tipo: 'Tarea', pilar: 'nat', nombre: 'Doble clic', resp: U.ina, fecha: day(5), privada: false }).lastId; // §15: compartida explícita
    asUser(U.benja, function () { return taskComplete(id, { cierre: 'Benja cerró', completada: day(-1) }); });
    throws(function () { asUser(U.ina, function () { return taskComplete(id, { cierre: 'Ina cerró' }); }); }, /ya fue marcada como realizada por Benja/);
    var t = find(bootstrap(), 'tasks', id);
    eq(t.cierre, 'Benja cerró', 'cierre de la primera persona');
    eq(t.completada, day(-1), 'fecha de la primera persona');
    taskReopen(id);
    throws(function () { taskReopen(id); }, /pendiente/i, 'reabrir dos veces');
    eq(find(bootstrap(), 'tasks', id).estado, 'Pendiente');
  });

  test('fix gestion-srv · D1-01/D1-05 borrar una línea cambia la versión del proyecto y no se puede re-vincular', function () {
    need('budgetDelete');
    fresh('demo');
    var b = bootstrap();
    var p = prjBy(b, 'Jardines sustentables');
    var lid = p.lineas[0];
    tick();
    var r = budgetDelete(lineYear(b, lid), lid);
    var p2 = find(r, 'projects', p.id);
    ok(p2.lineas.indexOf(lid) < 0, 'línea quitada del proyecto');
    ok(p2.actualizado !== p.actualizado, 'nueva versión del proyecto');
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, lineas: p.lineas, detalle: 'x', base: p.actualizado }); }, /modific/i, 'formulario viejo → conflicto');
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, lineas: p.lineas }); }, /ya no existe/, 'sin base: la línea borrada no vuelve');
    deepEq(find(bootstrap(), 'projects', p.id).lineas, p2.lineas, 'sin cambios');
  });

  /* ---------------- D1-05 ---------------- */

  test('fix gestion-srv · D1-05 líneas inexistentes o de otro pilar; cambio de pilar desvincula', function () {
    fresh('demo');
    var b = bootstrap();
    var p = prjBy(b, 'Jardines sustentables');
    var cc = freeLine(b, 'cc');
    var nat = freeLine(b, 'nat');
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, lineas: p.lineas.concat(['L-deadbeef']) }); }, /ya no existe/, 'ID inexistente');
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, lineas: p.lineas.concat([cc.id]) }); }, /mismo pilar/, 'línea de otro pilar');
    throws(function () { gSave({ tipo: 'Proyecto', pilar: 'ec', nombre: 'Nuevo EC', lineas: [nat.id] }); }, /mismo pilar/, 'al crear');
    deepEq(find(bootstrap(), 'projects', p.id).lineas, p.lineas, 'nada cambió');
    var ok1 = gSave({ tipo: 'Proyecto', id: p.id, lineas: p.lineas.concat([nat.id]) });
    includes(find(ok1, 'projects', p.id).lineas, nat.id, 'línea del mismo pilar se vincula');

    var lp = gLineProject_(nat.id);
    ok(lp && lp.id === p.id && lp.pilar === 'nat', 'gLineProject_ encuentra el proyecto: ' + JSON.stringify(lp));
    eq(gLineProject_(cc.id), null, 'línea libre → null');

    // Cambio de pilar: las tareas se mueven, las líneas del pilar anterior se desvinculan
    var r = gSave({ tipo: 'Proyecto', id: p.id, pilar: 'cc' });
    var p2 = find(r, 'projects', p.id);
    eq(p2.pilar, 'cc');
    deepEq(p2.lineas, [], 'sin líneas de Naturaleza');
    var h = rowsOf('Historial');
    includes(String(h[h.length - 1].Detalle), 'desvinculadas', 'queda en el Historial');
    // Ahora sí puede tomar una línea de Cambio Climático
    includes(find(gSave({ tipo: 'Proyecto', id: p.id, lineas: [cc.id] }), 'projects', p.id).lineas, cc.id);
  });

  /* ---------------- D1-08 ---------------- */

  test('fix gestion-srv · D1-08 commentAdd no crea comentarios huérfanos en líneas', function () {
    need('commentAdd', 'budgetDelete');
    fresh('demo');
    var b = bootstrap();
    var l = freeLine(b, 'ec');
    budgetDelete(2026, l.id);
    throws(function () { commentAdd(l.id, 'hola'); }, /no encontr[ée] la l[ií]nea/i, 'línea eliminada');
    eq(bootstrap().comments.filter(function (c) { return c.ref === l.id; }).length, 0, 'sin huérfanos');
    var l2 = bootstrap().budget['2026'].find(function (x) { return /[a-f]/.test(x.id.slice(2)); });
    ok(l2, 'línea con letras en el ID');
    throws(function () { commentAdd('L-' + l2.id.slice(2).toUpperCase(), 'x'); }, /no encontr/i, 'ID con otra capitalización');
    var r = commentAdd(l2.id, 'ok');
    eq(find(r, 'comments', r.lastId).ref, l2.id, 'línea existente sí');
  });
})();
