/* Gestión · hoja oculta, catálogo Cascade, proyectos, tareas (SPEC §1.2, §5, §7, §9) */
(function () {
  // Encabezados exactos de SPEC §1.2 (leídos del propio SPEC.md)
  function specHeaders() {
    var s = readText('dev/SPEC.md');
    var i = s.indexOf('Row 1 headers EXACTLY in this order');
    ok(i >= 0, 'no encontré la lista de encabezados en SPEC §1.2');
    var block = s.slice(s.indexOf('```', i) + 3);
    block = block.slice(0, block.indexOf('```'));
    var base = block.split('|').map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    // v3 (cambio intencional, SPEC §13.1): "new headers appended at the end: `Avisar | Privada | Inicio`"
    var v3 = /new headers appended at the end:\s*`([^`]+)`/.exec(s);
    var out = v3 ? base.concat(v3[1].split('|').map(function (x) { return x.trim(); }).filter(Boolean)) : base;
    // v3.1 (cambio intencional, SPEC §14.3): "Project folder id stored in Gestión column `Carpeta` (append header"
    var v31 = /Gestión column `([^`]+)` \(append header/.exec(s);
    if (v31) out = out.concat([v31[1].trim()]);
    // v3.6 (cambio intencional, SPEC §20): "task assignees in Gestión column `Asignados` (appended after"
    var v36 = /assignees in Gestión column `([^`]+)` \(appended after/.exec(s);
    return v36 ? out.concat([v36[1].trim()]) : out;
  }
  // SPEC §9 → [{pilar, nombre, etiqueta, items:[[clase, nombre]]}]
  function specCascade() {
    var s = readText('dev/SPEC.md');
    var a = s.indexOf('## 9.'), b = s.indexOf('## 10.');
    var lines = s.slice(a, b).split('\n');
    var CL = { k: 'kpi', a: 'accion', o: 'objetivo', h: 'hito' };
    var out = [], pilar = '', cur = null;
    lines.forEach(function (ln) {
      var m = /^[A-ZÁÉÍÓÚÑ ]+\((cc|ec|nat)\)\s*$/.exec(ln.trim());
      if (m) { pilar = m[1]; cur = null; return; }
      m = /^- (.+?)\s*\[(.*)\]\s*$/.exec(ln);
      if (m && pilar) { cur = { pilar: pilar, nombre: m[1].trim(), etiqueta: m[2].trim() === '—' ? '' : m[2].trim(), items: [] }; out.push(cur); return; }
      if (cur && /^\s{2,}\S/.test(ln)) {
        ln.trim().split(/;\s*/).forEach(function (it) {
          var mm = /^([kaoh])\s+(.+)$/.exec(it.trim());
          if (mm) cur.items.push([CL[mm[1]], mm[2].trim()]);
        });
      }
    });
    return out;
  }
  function expectedCascadeCount() {
    need('CASCADE_SEED');
    return CASCADE_SEED.length + CASCADE_SEED.reduce(function (a, g) { return a + (g.items || []).length; }, 0);
  }
  function mkTask(extra) {
    // §15: sin proyecto sería privada por defecto; estas pruebas usan una compartida salvo que extra diga otra cosa
    return gSave(Object.assign({ tipo: 'Tarea', pilar: 'nat', nombre: 'Tarea de prueba', resp: U.ina, fecha: day(10), privada: false }, extra || {}));
  }
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }

  test('gestión · setup crea la pestaña oculta con G_HEADERS exactos (SPEC §1.2)', function () {
    need('setup', 'G_HEADERS');
    fresh('raw');
    ok(!MOCK.sheet('Gestión'), 'la planilla real aún no tiene Gestión');
    setup();
    var sh = MOCK.sheet('Gestión');
    ok(sh, 'setup() debe crear "Gestión"');
    ok(sh.isSheetHidden(), 'Gestión debe quedar oculta');
    deepEq(G_HEADERS, specHeaders(), 'G_HEADERS = SPEC §1.2 + §13.1');
    deepEq(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], G_HEADERS, 'fila 1');
    eq(sh.getFrozenRows(), 1, 'fila 1 fija');
    ok(!MOCK.spreadsheet().getActiveSheet().isSheetHidden(), 'la hoja activa no queda oculta');
  });

  test('gestión · Cascade se siembra una sola vez (re-ejecutar setup no duplica)', function () {
    fresh('setup');
    var n = expectedCascadeCount();
    eq(gRows('Cascade').length, n, 'filas Cascade = grupos + indicadores de CASCADE_SEED');
    setup();
    setup();
    eq(gRows('Cascade').length, n, 'después de 3 setup()');
    var b = bootstrap();
    eq(b.cascade.length, n, 'bundle.cascade');
    var groups = b.cascade.filter(function (c) { return !c.padre; });
    eq(groups.length, CASCADE_SEED.length, 'grupos');
    var byId = {}; b.cascade.forEach(function (c) { byId[c.id] = c; });
    b.cascade.filter(function (c) { return c.padre; }).forEach(function (c) {
      ok(byId[c.padre] && !byId[c.padre].padre, c.nombre + ': el padre debe ser un grupo');
      eq(c.pilar, byId[c.padre].pilar, c.nombre + ': mismo pilar que su grupo');
      includes(['kpi', 'accion', 'objetivo', 'hito'], c.clase, c.nombre + ': clase');
    });
    groups.forEach(function (g) { eq(g.clase, 'grupo'); });
  });

  test('gestión · CASCADE_SEED coincide con el catálogo de SPEC §9 (imágenes de Cascade)', function () {
    need('CASCADE_SEED');
    var spec = specCascade();
    ok(spec.length >= 10, 'no pude leer SPEC §9');
    var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
    var seed = CASCADE_SEED.map(function (g) { return { pilar: g.pilar, nombre: norm(g.nombre), etiqueta: norm(g.etiqueta || ''), items: (g.items || []).map(function (it) { return [it[0], norm(it[1])]; }) }; });
    var problems = [];
    spec.forEach(function (sg) {
      var g = seed.find(function (x) { return x.pilar === sg.pilar && x.nombre === norm(sg.nombre); });
      if (!g) { problems.push('falta el grupo "' + sg.nombre + '" (' + sg.pilar + ')'); return; }
      if (g.etiqueta !== norm(sg.etiqueta)) problems.push(sg.nombre + ': etiqueta "' + g.etiqueta + '" ≠ "' + sg.etiqueta + '"');
      sg.items.forEach(function (it) {
        var x = g.items.find(function (y) { return y[1] === norm(it[1]); });
        if (!x) problems.push(sg.nombre + ': falta "' + it[1] + '"');
        else if (x[0] !== it[0]) problems.push(it[1] + ': clase ' + x[0] + ' ≠ ' + it[0]);
      });
      if (g.items.length !== sg.items.length) problems.push(sg.nombre + ': ' + g.items.length + ' indicadores ≠ ' + sg.items.length);
    });
    if (seed.length !== spec.length) problems.push(seed.length + ' grupos en CASCADE_SEED ≠ ' + spec.length + ' en SPEC');
    ok(!problems.length, problems.length + ' diferencias: ' + problems.slice(0, 6).join(' | '));
  });

  test('gestión · gSave valida (nombre, pilar, proyecto, evidencias, líneas, Cascade)', function () {
    need('gSave');
    fresh('demo');
    var b = bootstrap();
    var ec = b.projects.find(function (p) { return p.pilar === 'ec'; });
    var group = b.cascade.find(function (c) { return !c.padre && c.pilar === 'nat'; });
    throws(function () { gSave({ tipo: 'Proyecto', pilar: 'nat' }); }, /nombre/i, 'sin nombre');
    throws(function () { gSave({ tipo: 'Proyecto', pilar: 'nat', nombre: '   ' }); }, /nombre/i, 'nombre vacío');
    throws(function () { gSave({ tipo: 'Proyecto', nombre: 'X', pilar: 'marte' }); }, /pilar/i, 'pilar inválido');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', proyecto: 'PRJ-00000000' }); }, /proyecto/i, 'proyecto inexistente');
    // v3 (cambio intencional, SPEC §13.1): con proyecto, el pilar se fuerza al del proyecto en vez de dar error
    var forced = gSave({ tipo: 'Tarea', nombre: 'X pilar forzado', pilar: 'nat', proyecto: ec.id });
    eq(find(forced, 'tasks', forced.lastId).pilar, 'ec', 'proyecto de otro pilar → pilar del proyecto');
    gDelete(forced.lastId);
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', evidencias: [{ t: 'x', u: 'javascript:alert(1)' }] }); }, /https?|link|evidencia/i, 'evidencia javascript:');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', evidencias: [{ t: 'x', u: 'ftp://drive' }] }); }, /https?|link|evidencia/i, 'evidencia ftp');
    throws(function () { gSave({ tipo: 'Proyecto', nombre: 'X', pilar: 'nat', lineas: ['123'] }); }, /l[ií]nea/i, 'línea con ID inválido');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', cascade: group.id }); }, /grupo|indicador/i, 'un grupo Cascade no es seleccionable');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', cascade: 'CAS-00000000' }); }, /indicador|cascade/i, 'Cascade inexistente');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', fecha: '2026-02-30' }); }, /fecha/i, 'fecha imposible');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'nat', resp: 'ina' }); }, /correo|responsable/i, 'responsable no es correo');
    throws(function () { gSave({ tipo: 'Comentario', texto: 'x' }); }, /tipo/i, 'tipo no permitido');
    throws(function () { gSave({ tipo: 'Tarea', id: 'TSK-00000000', nombre: 'X', pilar: 'nat' }); }, /encontr/i, 'id inexistente');
    throws(function () { gSave({ tipo: 'Proyecto', id: b.tasks[0].id, nombre: 'X', pilar: 'nat' }); }, /tipo/i, 'id de otro tipo');
    eq(bootstrap().tasks.length, b.tasks.length, 'ningún intento inválido escribió');
  });

  test('gestión · crear proyecto y tarea: lastId, auditoría, fecha sin corrimiento', function () {
    fresh('setup');
    var b = asUser(U.benja, function () {
      return client('gSave', { tipo: 'Proyecto', pilar: 'Economía Circular', nombre: '  Proyecto   nuevo ', detalle: 'Desc', resp: 'BDeRigoulier@copec.cl', anio: '2027' });
    });
    var p = find(b, 'projects', b.lastId);
    eq(p.pilar, 'ec', 'pilar por etiqueta'); eq(p.nombre, 'Proyecto nuevo', 'espacios normalizados'); eq(p.resp, U.benja); eq(p.estado, 'Activo');
    eq(p.anio, '2027'); eq(p.creadoPor, U.benja); eq(p.actualizadoPor, U.benja);
    var t = client('gSave', { tipo: 'Tarea', proyecto: p.id, nombre: 'Primera tarea', resp: U.ina, fecha: '2026-12-01', detalle: 'nota' });
    var task = find(t, 'tasks', t.lastId);
    eq(task.pilar, 'ec', 'hereda el pilar del proyecto'); eq(task.proyecto, p.id); eq(task.fecha, '2026-12-01', 'fecha exacta (sin corrimiento de zona)');
    eq(task.estado, 'Pendiente'); eq(task.completada, ''); eq(task.creadoPor, U.gonzalo);
    var row = gRows('Tarea').find(function (r) { return r.ID === t.lastId; });
    ok(Object.prototype.toString.call(row.Fecha) === '[object Date]', 'Fecha se guarda como Date en la hoja');
    eq(Utilities.formatDate(row.Fecha, 'America/Santiago', 'yyyy-MM-dd'), '2026-12-01');
    eq(row.Pilar, 'Economia Circular', 'Pilar guardado como área');
    var y = gRows('Proyecto').find(function (r) { return r.ID === p.id; })['Año'];
    eq(String(y), '2027', 'Año');
    // Edición parcial: sólo nombre
    var t2 = gSave({ tipo: 'Tarea', id: t.lastId, nombre: 'Primera tarea (editada)' });
    var task2 = find(t2, 'tasks', t.lastId);
    eq(task2.nombre, 'Primera tarea (editada)'); eq(task2.fecha, '2026-12-01', 'conserva la fecha'); eq(task2.resp, U.ina, 'conserva responsable');
  });

  // v3.3 (SPEC §17): el único aviso es el de vencida. Cambiar fecha o responsable limpia la marca: la fecha nueva
  // (o la persona nueva) puede recibir UN aviso más; editar otra cosa no reenvía.
  test('gestión · cambiar fecha o responsable limpia "Notificado"', function () {
    need('notifDaily');
    fresh('setup');
    var id = mkTask({ fecha: day(-1), nombre: 'Aviso' }).lastId;
    var notif = function () { return String(gRows('Tarea').find(function (r) { return r.ID === id; }).Notificado || ''); };
    eq(MOCK.mails.length, 0, 'guardar no envía correos');
    notifDaily();
    eq(MOCK.mails.length, 1, 'aviso de vencida');
    eq(notif(), day(-1) + ':0', 'la tarea quedó marcada');
    gSave({ tipo: 'Tarea', id: id, detalle: 'otra nota' });
    eq(notif(), day(-1) + ':0', 'editar la nota conserva la marca');
    notifDaily();
    eq(MOCK.mails.length, 1, 'editar la nota no reenvía');
    gSave({ tipo: 'Tarea', id: id, fecha: day(-2) });
    eq(notif(), '', 'cambiar la fecha reinicia la marca');
    notifDaily();
    eq(MOCK.mails.length, 2, 'la fecha nueva (también vencida) avisa una vez');
    gSave({ tipo: 'Tarea', id: id, resp: U.benja });
    eq(notif(), '', 'cambiar el responsable reinicia la marca');
    notifDaily();
    eq(MOCK.mails.length, 3);
    eq(MOCK.mails[2].to, U.benja, 'el aviso va a Benja');
    gSave({ tipo: 'Tarea', id: id, fecha: day(20) });
    eq(notif(), '', 'fecha futura: sin marca');
    notifDaily();
    eq(MOCK.mails.length, 3, 'sin aviso hasta que venza');
  });

  // v3 (cambio intencional, SPEC §13.1): el comentario de cierre es OPCIONAL (check rápido); se valida el resto igual
  test('gestión · taskComplete exige comentario de cierre y agrega evidencias', function () {
    need('taskComplete');
    fresh('setup');
    var id = mkTask({ evidencias: [{ t: 'Acta', u: 'https://docs.google.com/document/d/1Acta/edit' }] }).lastId;
    var quick = mkTask({ nombre: 'Check rápido' }).lastId;
    var q = find(taskComplete(quick, {}), 'tasks', quick);
    eq(q.estado, 'Realizada', 'sin cierre también se completa'); eq(q.cierre, '', 'cierre vacío');
    var r2 = taskComplete(mkTask({ nombre: 'Con espacios' }).lastId, { cierre: '   ' });
    eq(find(r2, 'tasks', r2.lastId).cierre, '', 'cierre de puros espacios → vacío');
    throws(function () { taskComplete(id, { cierre: 'x'.repeat(4001) }); }, /cierre/i, 'cierre muy largo');
    throws(function () { taskComplete(id, { cierre: 'ok', completada: day(3) }); }, /futur/i, 'fecha futura');
    throws(function () { taskComplete('TSK-00000000', { cierre: 'ok' }); }, /encontr/i, 'tarea inexistente');
    eq(find(bootstrap(), 'tasks', id).estado, 'Pendiente', 'nada cambió');
    var b = client('taskComplete', id, { cierre: 'Listo, informe en Drive', evidencias: [{ t: 'Informe', u: 'https://drive.google.com/file/d/1Inf/view' }, { t: 'Acta otra vez', u: 'https://docs.google.com/document/d/1Acta/edit' }] });
    var t = find(b, 'tasks', id);
    eq(b.lastId, id);
    eq(t.estado, 'Realizada'); eq(t.cierre, 'Listo, informe en Drive'); eq(t.completada, day(0), 'completada = hoy por defecto');
    deepEq(t.evidencias.map(function (e) { return e.u; }), ['https://docs.google.com/document/d/1Acta/edit', 'https://drive.google.com/file/d/1Inf/view'], 'evidencias agregadas sin duplicar');
    var b2 = taskComplete(mkTask().lastId, { cierre: 'Hecho la semana pasada', completada: day(-7) });
    eq(find(b2, 'tasks', b2.lastId).completada, day(-7), 'fecha de realización explícita');
  });

  test('gestión · taskReopen vuelve a Pendiente', function () {
    need('taskReopen');
    fresh('setup');
    var id = mkTask().lastId;
    taskComplete(id, { cierre: 'Cerrada' });
    var t = find(client('taskReopen', id), 'tasks', id);
    eq(t.estado, 'Pendiente'); eq(t.completada, '');
    var h = rowsOf('Historial');
    ok(h.some(function (r) { return /Cerrada/.test(String(r.Detalle)); }), 'el cierre anterior queda en el Historial');
  });

  test('gestión · gDelete proyecto: sus tareas quedan sin proyecto (se conservan)', function () {
    need('gDelete');
    fresh('demo');
    var b = bootstrap();
    var p = b.projects.find(function (x) { return x.nombre === 'Valorización residuos plantas'; });
    var tasks = b.tasks.filter(function (t) { return t.proyecto === p.id; });
    ok(tasks.length >= 2, 'el proyecto demo tiene tareas');
    commentAdd(p.id, 'comentario del proyecto');
    var b2 = client('gDelete', p.id);
    ok(!b2.projects.some(function (x) { return x.id === p.id; }), 'proyecto eliminado');
    tasks.forEach(function (t) {
      var t2 = find(b2, 'tasks', t.id);
      eq(t2.proyecto, '', 'tarea sin proyecto'); eq(t2.pilar, 'ec', 'conserva el pilar');
    });
    ok(!b2.comments.some(function (c) { return c.ref === p.id; }), 'comentarios del proyecto eliminados');
  });

  test('gestión · gDelete tarea borra sus comentarios', function () {
    fresh('setup');
    var id = mkTask().lastId;
    commentAdd(id, 'uno'); commentAdd(id, 'dos');
    eq(bootstrap().comments.filter(function (c) { return c.ref === id; }).length, 2);
    var b = gDelete(id);
    ok(!b.tasks.some(function (t) { return t.id === id; }));
    eq(b.comments.filter(function (c) { return c.ref === id; }).length, 0, 'comentarios borrados');
    eq(gRows('Comentario').filter(function (r) { return r.Padre === id; }).length, 0, 'también en la hoja');
  });

  test('gestión · grupo Cascade con indicadores no se puede eliminar', function () {
    fresh('setup');
    var b = bootstrap();
    var g = b.cascade.find(function (c) { return !c.padre; });
    throws(function () { gDelete(g.id); }, 'Elimina primero sus indicadores');
    var child = b.cascade.find(function (c) { return c.padre; });
    var id = mkTask({ pilar: child.pilar, cascade: child.id }).lastId;
    var b2 = gDelete(child.id);
    eq(find(b2, 'tasks', id).cascade, '', 'la tarea queda sin indicador');
    eq(b2.cascade.length, b.cascade.length - 1);
  });

  test('gestión · indicadores Cascade: crear, mover de grupo y validar', function () {
    fresh('setup');
    var b = bootstrap();
    var g = b.cascade.find(function (c) { return !c.padre && c.pilar === 'ec'; });
    var r = client('gSave', { tipo: 'Cascade', padre: g.id, nombre: 'Nuevo KPI de prueba', clase: 'kpi' });
    var c = find(r, 'cascade', r.lastId);
    eq(c.pilar, 'ec', 'hereda pilar del grupo'); eq(c.clase, 'kpi'); eq(c.padre, g.id);
    var siblings = r.cascade.filter(function (x) { return x.padre === g.id; });
    eq(c.orden, Math.max.apply(null, siblings.map(function (x) { return x.orden; })), 'queda al final del grupo');
    throws(function () { gSave({ tipo: 'Cascade', padre: g.id, nombre: 'X', clase: 'meta' }); }, /tipo|clase|indicador/i, 'clase inválida');
    var other = b.cascade.find(function (x) { return !x.padre && x.pilar === 'nat'; });
    throws(function () { gSave({ tipo: 'Cascade', padre: other.id, pilar: 'ec', nombre: 'X', clase: 'kpi' }); }, /pilar/i, 'grupo de otro pilar');
    var ng = gSave({ tipo: 'Cascade', pilar: 'cc', nombre: 'Grupo nuevo', etiqueta: 'Iniciativa' });
    eq(find(ng, 'cascade', ng.lastId).clase, 'grupo');
  });

  test('gestión · una línea de presupuesto pertenece a un solo proyecto (SPEC §7)', function () {
    fresh('demo');
    var b = bootstrap();
    var bato = b.projects.find(function (p) { return p.nombre === 'Humedal El Bato (Quintero)'; });
    var other = b.projects.find(function (p) { return p.pilar === 'nat' && p.id !== bato.id; });
    throws(function () { gSave({ tipo: 'Proyecto', id: other.id, lineas: other.lineas.concat([bato.lineas[0]]) }); }, /vinculad|proyecto/i);
    var free = b.budget['2026'].find(function (l) { return l.pilar === 'nat' && l.pf > 0 && !b.projects.some(function (p) { return p.lineas.indexOf(l.id) >= 0; }); });
    var r = gSave({ tipo: 'Proyecto', id: other.id, lineas: other.lineas.concat([free.id]) });
    includes(find(r, 'projects', other.id).lineas, free.id, 'línea libre vinculada');
  });

  test('gestión · proyecto cerrado no recibe tareas nuevas; cambio de pilar mueve sus tareas', function () {
    fresh('demo');
    var b = bootstrap();
    var closed = b.projects.find(function (p) { return p.estado === 'Cerrado'; });
    ok(closed, 'el demo tiene un proyecto cerrado');
    throws(function () { gSave({ tipo: 'Tarea', proyecto: closed.id, nombre: 'Nueva', pilar: closed.pilar }); }, /cerrad/i);
    var p = b.projects.find(function (x) { return x.nombre === 'Jardines sustentables'; });
    var ids = b.tasks.filter(function (t) { return t.proyecto === p.id; }).map(function (t) { return t.id; });
    var r = gSave({ tipo: 'Proyecto', id: p.id, pilar: 'cc' });
    ids.forEach(function (id) { eq(find(r, 'tasks', id).pilar, 'cc', 'la tarea se movió de pilar con su proyecto'); });
  });

  test('gestión · textos con fórmulas o números se guardan como texto', function () {
    fresh('setup');
    var r = mkTask({ nombre: '=HYPERLINK("http://x")', detalle: '+56 9 1234 5678' });
    var t = find(r, 'tasks', r.lastId);
    eq(t.nombre, '=HYPERLINK("http://x")', 'nombre intacto');
    eq(t.detalle, '+56 9 1234 5678', 'detalle intacto');
    var row = gRows('Tarea').find(function (x) { return x.ID === r.lastId; });
    eq(MOCK.sheet('Gestión').getRange(row._row, G_HEADERS.indexOf('Nombre') + 1).getFormula(), '', 'no quedó como fórmula');
  });
})();
