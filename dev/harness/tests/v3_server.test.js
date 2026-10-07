/* v3 servidor (SPEC §13.1): privacidad por tarea, orden manual, aviso de vencida por correo (v3.3, §17),
   avisar=false, importación de proyectos desde Cascade, fechas de proyecto, pilar opcional, bundle (solicitudes). */
(function () {
  var GLOBAL = (0, eval)('this');
  function swap(name, make, body) {
    var orig = GLOBAL[name];
    if (typeof orig !== 'function') __fail('no existe ' + name);
    GLOBAL[name] = make(orig);
    try { return body(); } finally { GLOBAL[name] = orig; }
  }
  function find(b, coll, id) { var x = (b[coll] || []).find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function has(b, coll, id) { return (b[coll] || []).some(function (e) { return e.id === id; }); }
  function row(id) { var r = gRows().find(function (x) { return x.ID === id; }); ok(r, 'no encontré la fila ' + id); return r; }
  function marker(id) { return String(row(id).Notificado || ''); }
  function mailsTo(email) { return MOCK.mails.filter(function (m) { return m.to.split(',').indexOf(email) >= 0; }); }
  function setCell(id, header, value) {
    MOCK.sheet('Gestión').getRange(row(id)._row, G_HEADERS.indexOf(header) + 1).setValue(value);
  }
  function dateCell(ymd) { return MOCK.wallToDate(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), 0, 0, 0, 'America/Santiago'); }
  // Simula que pasó el tiempo: la tarea vence en `n` días (y la marca guardada sigue siendo la de su fecha)
  function shiftDue(id, n) {
    var old = String(row(id).Notificado || '');
    var oldDate = row(id).Fecha;
    var prevYmd = Utilities.formatDate(oldDate, 'America/Santiago', 'yyyy-MM-dd');
    setCell(id, 'Fecha', dateCell(day(n)));
    if (old) setCell(id, 'Notificado', old.replace(prevYmd, day(n)));
  }
  function mk(user, extra) {
    return asUser(user, function () {
      // §15: sin proyecto sería privada por defecto; estas pruebas parten de una compartida salvo que extra diga otra cosa
      return client('gSave', Object.assign({ tipo: 'Tarea', pilar: 'nat', nombre: 'Tarea v3', resp: user, fecha: day(10), privada: false }, extra || {}));
    });
  }
  // Conteo esperado de la importación según la regla de §13.1, a partir de CASCADE_SEED
  function expectedImport() {
    var out = { projects: 0, tasks: 0, names: [] };
    CASCADE_SEED.forEach(function (g) {
      var acts = (g.items || []).filter(function (it) { return it[0] === 'accion' || it[0] === 'objetivo'; });
      if (acts.length) { out.projects += acts.length; acts.forEach(function (a) { out.names.push(a[1]); }); return; }
      out.projects += 1; out.names.push(g.nombre);
      out.tasks += (g.items || []).filter(function (it) { return it[0] === 'hito'; }).length;
    });
    return out;
  }

  /* ---------------- Privacidad ---------------- */

  test('v3 server · privacidad: matriz creador / responsable / otro / administrador (bundle + comentarios)', function () {
    need('gSave', 'commentAdd', 'bootstrap');
    fresh('setup');
    var b = mk(U.ina, { nombre: 'Secreto de Ina para Benja', resp: U.benja, privada: true });
    var id = b.lastId;
    var t = find(b, 'tasks', id);
    eq(t.privada, true, 'privada en el bundle'); eq(t.avisar, true, 'avisar por defecto'); eq(t.orden, 0, 'sin orden');
    var cid = asUser(U.ina, function () { return commentAdd(id, 'comentario privado').lastId; });
    var shared = mk(U.ignacio, { nombre: 'Compartida' }).lastId;
    var see = function (user) { return asUser(user, function () { return client('bootstrap'); }); };
    [[U.ina, true, 'creadora'], [U.benja, true, 'responsable'], [U.ignacio, false, 'otra persona'], [U.gonzalo, false, 'administrador'], ['', false, 'sin correo']].forEach(function (c) {
      var bb = see(c[0]);
      eq(has(bb, 'tasks', id), c[1], c[2] + ': ve la tarea');
      eq(has(bb, 'comments', cid), c[1], c[2] + ': ve su comentario');
      ok(has(bb, 'tasks', shared), c[2] + ': ve la compartida');
      ok(JSON.stringify(bb).indexOf('Secreto de Ina') < 0 || c[1], c[2] + ': el nombre no viaja');
    });
    // Dejarla compartida la muestra a todos
    asUser(U.ina, function () { gSave({ tipo: 'Tarea', id: id, privada: false }); });
    ok(has(see(U.ignacio), 'tasks', id), 'compartida: Ignacio la ve');
    ok(has(see(U.gonzalo), 'comments', cid), 'y su comentario');
  });

  test('v3 server · privacidad: toda mutación sobre una tarea ajena privada responde "No encontré la tarea"', function () {
    need('gSave', 'gDelete', 'taskComplete', 'taskReopen', 'taskReorder', 'commentAdd', 'commentDelete');
    fresh('setup');
    var id = mk(U.ina, { nombre: 'Privada de Ina', privada: true }).lastId;
    var cid = asUser(U.ina, function () { return commentAdd(id, 'nota').lastId; });
    var done = mk(U.ina, { nombre: 'Privada realizada', privada: true }).lastId;
    asUser(U.ina, function () { taskComplete(done, {}); });
    var before = JSON.stringify(gRows());
    [U.benja, U.gonzalo, ''].forEach(function (user) {
      asUser(user, function () {
        var who = user || 'desconocido';
        throws(function () { client('gSave', { tipo: 'Tarea', id: id, nombre: 'hack' }); }, 'No encontré la tarea', who + ' gSave');
        throws(function () { client('gSave', { tipo: 'Proyecto', id: id, nombre: 'hack' }); }, 'No encontré la tarea', who + ' gSave con otro tipo');
        throws(function () { client('gDelete', id); }, 'No encontré la tarea', who + ' gDelete');
        throws(function () { client('taskComplete', id, { cierre: 'x' }); }, 'No encontré la tarea', who + ' taskComplete');
        throws(function () { client('taskReopen', done); }, 'No encontré la tarea', who + ' taskReopen');
        throws(function () { client('taskReorder', [id]); }, 'No encontré la tarea', who + ' taskReorder');
        throws(function () { client('commentAdd', id, 'hola'); }, 'No encontré la tarea', who + ' commentAdd');
        throws(function () { client('commentDelete', cid); }, 'No encontré la tarea', who + ' commentDelete');
        throws(function () { client('gDelete', cid); }, 'No encontré la tarea', who + ' gDelete del comentario');
      });
    });
    eq(JSON.stringify(gRows()), before, 'nada cambió en la hoja');
    // La creadora sí puede todo
    asUser(U.ina, function () {
      ok(client('gSave', { tipo: 'Tarea', id: id, detalle: 'mía' }).lastId, 'editar');
      ok(client('taskReopen', done).lastId, 'reabrir');
      ok(client('taskReorder', [done, id]), 'ordenar');
      ok(client('commentDelete', cid), 'borrar su comentario');
      ok(client('taskComplete', id, {}).lastId, 'completar');
    });
  });

  test('v3 server · privacidad: Historial y asistente no revelan la tarea; sin correo no se crea privada', function () {
    need('gSave', 'ask', 'getHistory');
    fresh('setup');
    var id = mk(U.ina, { nombre: 'Zafiroturquesa confidencial', detalle: 'detalle zafiroturquesa', privada: true }).lastId;
    asUser(U.ina, function () { commentAdd(id, 'comentario zafiroturquesa'); taskComplete(id, { cierre: 'cierre zafiroturquesa' }); taskReopen(id); });
    var hist = JSON.stringify(rowsOf('Historial'));
    ok(hist.indexOf('zafiroturquesa') < 0 && hist.indexOf('Zafiroturquesa') < 0, 'el Historial no muestra nombre, comentario ni cierre');
    includes(hist, 'Tarea privada', 'aparece como "Tarea privada"');
    var hits = function (r) { return r.results.some(function (s) { return s.refId === id || s.id === id; }); };
    asUser(U.benja, function () { ok(!hits(client('ask', 'zafiroturquesa confidencial')), 'el asistente de Benja no la encuentra'); });
    asUser(U.gonzalo, function () { ok(!hits(client('ask', 'zafiroturquesa confidencial')), 'ni el del administrador'); });
    asUser(U.ina, function () { ok(hits(client('ask', 'zafiroturquesa confidencial')), 'la creadora sí'); });
    asUser('', function () {
      throws(function () { client('gSave', { tipo: 'Tarea', nombre: 'Privada sin correo', privada: true }); }, /identificar/i, 'sin correo: no se crea privada');
      ok(client('gSave', { tipo: 'Tarea', nombre: 'Compartida sin correo' }).lastId, 'compartida sí');
    });
    // gTaskVisible_ / gVisibleFilter_ (para otros módulos)
    var priv = { id: 'TSK-1', privada: true, creadoPor: U.ina, resp: U.benja };
    eq(gTaskVisible_(priv, U.ina), true); eq(gTaskVisible_(priv, 'BDeRigoulier@copec.cl'), true); eq(gTaskVisible_(priv, U.gonzalo), false);
    eq(gTaskVisible_({ privada: false }, ''), true); eq(gTaskVisible_(priv, 'desconocido'), false);
    var f = gVisibleFilter_({ projects: [1], tasks: [priv, { id: 'TSK-2' }], comments: [{ ref: 'TSK-1' }, { ref: 'TSK-2' }], cascade: [] }, U.ignacio);
    deepEq(f.tasks.map(function (x) { return x.id; }), ['TSK-2']);
    deepEq(f.comments.map(function (x) { return x.ref; }), ['TSK-2']);
    deepEq(f.projects, [1], 'el resto se conserva');
  });

  /* ---------------- Orden manual ---------------- */

  test('v3 server · taskReorder: Orden 1..n, sin cambiar la versión, valida ids', function () {
    need('taskReorder');
    fresh('setup');
    var a = mk(U.ina, { nombre: 'A' }).lastId, b2 = mk(U.ina, { nombre: 'B' }).lastId, c = mk(U.benja, { nombre: 'C de Benja' }).lastId;
    var v0 = find(bootstrap(), 'tasks', a).actualizado;
    var r0 = asUser(U.ina, function () { return client('taskReorder', [c, a, b2, a]); });
    // v3.1 (SPEC §14.1, cambio intencional): respuesta liviana {ok, ids} sin bundle
    deepEq(r0, { ok: true, ids: [c, a, b2] }, 'respuesta liviana');
    var r = asUser(U.ina, function () { return bootstrap(); });
    eq(find(r, 'tasks', c).orden, 1); eq(find(r, 'tasks', a).orden, 2, 'duplicado ignorado'); eq(find(r, 'tasks', b2).orden, 3);
    eq(find(r, 'tasks', a).actualizado, v0, 'reordenar no cambia "actualizado" (no choca con formularios abiertos)');
    eq(Number(row(a).Orden), 2, 'columna Orden');
    asUser(U.ina, function () { taskReorder([b2]); });
    eq(find(bootstrap(), 'tasks', b2).orden, 1);
    throws(function () { client('taskReorder', []); }, /ordenar/i, 'vacío');
    throws(function () { client('taskReorder', 'TSK-xx'); }, /ordenar/i, 'no es lista');
    throws(function () { client('taskReorder', ['TSK-00000000']); }, 'No encontré la tarea', 'inexistente');
    var p = gSave({ tipo: 'Proyecto', pilar: 'nat', nombre: 'P' }).lastId;
    throws(function () { client('taskReorder', [p]); }, 'No encontré la tarea', 'un proyecto no se ordena aquí');
    // gSave acepta orden explícito (entero ≥ 0)
    eq(find(gSave({ tipo: 'Tarea', id: a, orden: 7 }), 'tasks', a).orden, 7);
    eq(find(gSave({ tipo: 'Tarea', id: a, orden: -3 }), 'tasks', a).orden, 0, 'negativo → sin orden');
  });

  /* ---------------- Aviso de vencida (v3.3, SPEC §17) ---------------- */

  test('v3.3 server · guardar, activar el aviso, completar o reabrir no envían correos', function () {
    need('gSave', 'notifDaily', 'taskReopen');
    fresh('setup');
    mk(U.gonzalo, { nombre: 'Vence hoy', fecha: day(0), resp: U.ina });
    var late = mk(U.benja, { nombre: 'Atrasada', fecha: day(-4) }).lastId;
    var quiet = mk(U.ina, { nombre: 'Sin aviso', fecha: day(-1), avisar: false }).lastId;
    eq(find(bootstrap(), 'tasks', quiet).avisar, false, 'avisar=false en el bundle');
    eq(String(row(quiet).Avisar), 'No', 'columna Avisar = No');
    gSave({ tipo: 'Tarea', id: quiet, avisar: true });
    for (var k = 0; k < 2; k++) { taskComplete(late, {}); taskReopen(late); }
    eq(MOCK.mails.length, 0, 'ningún correo al guardar');
    ok(!rowsOf('Historial').some(function (r) { return /Recordatorio/.test(String(r.Detalle)); }), 'el Historial no habla de recordatorios');
    notifDaily();
    eq(mailsTo(U.benja).length, 1, 'la atrasada se avisa en la revisión diaria');
    eq(mailsTo(U.ina).length, 1, 'la que activó el aviso también');
    ok(MOCK.mails.every(function (m) { return m.body.indexOf('Vence hoy') < 0; }), 'la que vence hoy todavía no');
  });

  test('v3.3 server · el aviso de vencida: asunto, texto, quién la asignó y marca', function () {
    fresh('setup');
    var id = mk(U.gonzalo, { nombre: 'Informe para el directorio', fecha: day(-1), resp: U.ina }).lastId;
    notifDaily();
    eq(MOCK.mails.length, 1);
    var m = MOCK.mails[0];
    eq(m.to, U.ina, 'a la responsable');
    eq(m.subject, '[' + CONFIG.APP_NAME + '] Venció: Informe para el directorio');
    includes(m.body, 'Esta tarea venció ayer.'); includes(m.body, 'Gonzalo te la asignó');
    includes(m.htmlBody, 'Venció ayer'); includes(m.htmlBody, 'cámbiale la fecha');
    eq(marker(id), day(-1) + ':0');
  });

  test('v3.3 server · marcar y desmarcar una tarea vencida no reenvía el aviso', function () {
    fresh('setup');
    var id = mk(U.ina, { nombre: 'Check', fecha: day(-2) }).lastId;
    notifDaily();
    eq(MOCK.mails.length, 1, 'aviso de vencida');
    for (var k = 0; k < 3; k++) { taskComplete(id, {}); taskReopen(id); }
    notifDaily();
    eq(MOCK.mails.length, 1, 'tres veces marcar/desmarcar → sigue siendo un correo');
    eq(marker(id), day(-2) + ':0', 'la marca se conserva al reabrir');
  });

  test('v3.3 server · si el correo falla no marca y se reintenta al día siguiente', function () {
    fresh('setup');
    var id = mk(U.ina, { nombre: 'Reintento', fecha: day(-1) }).lastId;
    swap('notifSend_', function () { return function () { throw new Error('Gmail caído'); }; }, function () { notifDaily(); });
    eq(marker(id), '', 'sin marca');
    notifDaily();
    eq(mailsTo(U.ina).length, 1, 'al día siguiente se envía');
    eq(marker(id), day(-1) + ':0');
  });

  test('v3.3 server · sendTestDigest incluye las vencidas sin aviso automático (lo pidió la persona)', function () {
    fresh('setup');
    mk(U.ina, { nombre: 'Silenciosa', fecha: day(-1), avisar: false });
    mk(U.ina, { nombre: 'Futura', fecha: day(1) });
    var r = asUser(U.ina, function () { return sendTestDigest(); });
    eq(r.count, 1);
    includes(MOCK.mails[0].body, 'Silenciosa');
  });

  /* ---------------- Importación desde Cascade ---------------- */

  test('v3 server · setup importa proyectos de Cascade según la regla (conteos) y es idempotente', function () {
    need('setup', 'importCascadeProjects', 'CASCADE_SEED');
    fresh('setup');
    var exp = expectedImport();
    var b = bootstrap();
    eq(b.projects.length, exp.projects, 'proyectos = acciones/objetivos + grupos sin ellos');
    eq(b.tasks.length, exp.tasks, 'tareas = hitos de grupos sin acciones/objetivos');
    var cas = {}; b.cascade.forEach(function (c) { cas[c.id] = c; });
    b.projects.forEach(function (p) {
      var c = cas[p.cascade];
      ok(c, p.nombre + ': apunta a su indicador');
      eq(p.nombre, c.nombre, 'nombre = indicador'); eq(p.pilar, c.pilar, 'pilar'); eq(p.estado, 'Activo'); eq(p.anio, ''); eq(p.resp, '');
      ok(c.padre ? (c.clase === 'accion' || c.clase === 'objetivo') : true, p.nombre + ': hijo acción/objetivo o grupo');
    });
    deepEq(b.projects.map(function (p) { return p.nombre; }).sort(), exp.names.slice().sort(), 'nombres');
    var dec = b.projects.find(function (p) { return p.nombre === 'Estrategia descarbonización Logística'; });
    ok(dec && !cas[dec.cascade].padre, 'grupo sin acciones → proyecto del grupo');
    b.tasks.forEach(function (t) {
      eq(t.proyecto, dec.id, t.nombre + ': en el proyecto del grupo'); eq(cas[t.cascade].clase, 'hito');
      eq(t.fecha, ''); eq(t.avisar, true); eq(t.privada, false); eq(t.estado, 'Pendiente'); eq(t.pilar, 'cc');
    });
    ok(!b.projects.some(function (p) { return p.nombre === 'Valorización Plantas, CD, Oficinas' && false; }));
    ok(b.projects.some(function (p) { return p.nombre === 'Valorización Plantas, CD, Oficinas'; }), 'grupo sólo con KPI → proyecto');
    ok(!b.projects.some(function (p) { return p.nombre === 'Tasa Desvío COPEC'; }), 'los KPI no son proyectos');
    var rows = MOCK.sheet('Gestión').getLastRow();
    var r = client('importCascadeProjects');
    deepEq(r.lastImport, { projects: 0, tasks: 0 }, 'segunda importación: nada nuevo');
    var s = setup();
    eq(MOCK.sheet('Gestión').getLastRow(), rows, 'setup() otra vez no agrega filas');
    ok(s.steps.some(function (x) { return /Cascade ya importados/.test(x); }), 'setup informa que ya se importó');
    ok(rowsOf('Historial').some(function (h) { return h['Acción'] === 'Importar proyectos Cascade'; }), 'queda en el Historial');
    asUser(U.ina, function () { throws(function () { client('importCascadeProjects'); }, /administrador/i); });
  });

  test('v3 server · importación: un proyecto eliminado no reaparece con setup(); el botón de Ajustes sí lo trae', function () {
    fresh('setup');
    var b = bootstrap();
    var p = b.projects.find(function (x) { return x.nombre === 'Mitigación Huella'; });
    gDelete(p.id);
    setup();
    ok(!bootstrap().projects.some(function (x) { return x.nombre === 'Mitigación Huella'; }), 'setup() no lo recrea');
    var r = client('importCascadeProjects');
    deepEq(r.lastImport, { projects: 1, tasks: 0 });
    ok(r.projects.some(function (x) { return x.nombre === 'Mitigación Huella'; }), 'importar lo trae de vuelta');
    // Indicador nuevo (acción) → un proyecto nuevo; un proyecto existente con ese indicador no se duplica
    var g = r.cascade.find(function (c) { return !c.padre && c.pilar === 'ec'; });
    var nc = gSave({ tipo: 'Cascade', padre: g.id, nombre: 'Acción nueva 2027', clase: 'accion' }).lastId;
    gSave({ tipo: 'Proyecto', pilar: 'ec', nombre: 'Mi proyecto con esa acción', cascade: nc });
    deepEq(client('importCascadeProjects').lastImport, { projects: 0, tasks: 0 }, 'ya hay proyecto con ese indicador');
    var nc2 = gSave({ tipo: 'Cascade', padre: g.id, nombre: 'Otra acción 2027', clase: 'objetivo' }).lastId;
    var r2 = client('importCascadeProjects');
    deepEq(r2.lastImport, { projects: 1, tasks: 0 });
    ok(r2.projects.some(function (x) { return x.cascade === nc2 && x.nombre === 'Otra acción 2027'; }));
  });

  test('v3 server · setup en planilla nueva: resumen menciona Cascade y Solicitudes (sin activar Ariba)', function () {
    fresh('raw');
    var r = setup();
    ok(r.cascadeProjects && r.cascadeProjects.imported && r.cascadeProjects.projects > 0, 'importó: ' + JSON.stringify(r.cascadeProjects));
    ok(r.steps.some(function (s) { return /Proyectos desde Cascade/.test(s); }), 'paso de Cascade');
    if (typeof aprobSheet_ === 'function') {
      ok(MOCK.sheet(CONFIG.APROB_SHEET), 'pestaña de solicitudes');
      ok(MOCK.sheet(CONFIG.APROB_SHEET).isSheetHidden(), 'oculta');
      ok(r.steps.some(function (s) { return /aprobInstall/.test(s); }), 'menciona aprobInstall');
    }
    ok(!MOCK.triggers().some(function (t) { return /aprob/i.test(t.handler); }), 'el lector de Ariba NO se instala solo');
  });

  /* ---------------- Proyectos: fechas ---------------- */

  test('v3 server · proyecto con inicio/fin (fin en la columna Fecha), validación y edición parcial', function () {
    fresh('setup');
    var b = client('gSave', { tipo: 'Proyecto', pilar: 'cc', nombre: 'Con fechas', inicio: '2026-03-01', fin: '2026-11-30' });
    var p = find(b, 'projects', b.lastId);
    eq(p.inicio, '2026-03-01'); eq(p.fin, '2026-11-30');
    var r = row(b.lastId);
    ok(Object.prototype.toString.call(r.Inicio) === '[object Date]', 'Inicio como fecha');
    eq(Utilities.formatDate(r.Fecha, 'America/Santiago', 'yyyy-MM-dd'), '2026-11-30', 'fin en la columna Fecha');
    throws(function () { gSave({ tipo: 'Proyecto', id: p.id, fin: '2026-02-01' }); }, /término.*anterior/i, 'fin < inicio');
    throws(function () { gSave({ tipo: 'Proyecto', pilar: 'cc', nombre: 'X', inicio: '2026-13-01' }); }, /inicio/i, 'fecha inválida');
    var e = find(gSave({ tipo: 'Proyecto', id: p.id, nombre: 'Con fechas (editado)' }), 'projects', p.id);
    eq(e.inicio, '2026-03-01', 'edición parcial conserva'); eq(e.fin, '2026-11-30');
    var c = find(gSave({ tipo: 'Proyecto', id: p.id, fin: '' }), 'projects', p.id);
    eq(c.fin, '', 'se puede borrar'); eq(c.inicio, '2026-03-01');
    eq(find(gSave({ tipo: 'Proyecto', pilar: 'nat', nombre: 'Sólo término', fin: '2026-12-31' }), 'projects', bootstrap().projects.find(function (x) { return x.nombre === 'Sólo término'; }).id).fin, '2026-12-31');
    var h = rowsOf('Historial').map(function (x) { return String(x.Detalle); }).join('\n');
    includes(h, 'Término', 'el Historial registra el cambio de término');
    assertNoDates(bootstrap(), 'bootstrap() con fechas de proyecto');
  });

  /* ---------------- Tareas: pilar opcional, cierre editable, filas v2 ---------------- */

  test('v3 server · pilar opcional: tarea personal, pilar forzado por el proyecto, cierre editable en cualquier estado', function () {
    fresh('setup');
    var b = client('gSave', { tipo: 'Tarea', nombre: 'Llamar a Finanzas', resp: U.ina });
    var t = find(b, 'tasks', b.lastId);
    eq(t.pilar, '', 'sin pilar'); eq(t.proyecto, '');
    eq(String(row(t.id).Pilar), '', 'celda Pilar vacía');
    throws(function () { gSave({ tipo: 'Tarea', nombre: 'X', pilar: 'marte' }); }, /pilar/i, 'pilar inválido sigue siendo error');
    var p = gSave({ tipo: 'Proyecto', pilar: 'ec', nombre: 'Proyecto EC' }).lastId;
    var r = find(gSave({ tipo: 'Tarea', id: t.id, proyecto: p }), 'tasks', t.id);
    eq(r.pilar, 'ec', 'al asignarle proyecto toma su pilar');
    var r2 = find(gSave({ tipo: 'Tarea', id: t.id, pilar: 'nat' }), 'tasks', t.id);
    eq(r2.pilar, 'ec', 'con proyecto el pilar no se puede cambiar a otro');
    var r3 = find(gSave({ tipo: 'Tarea', id: t.id, proyecto: '', pilar: '' }), 'tasks', t.id);
    eq(r3.pilar, '', 'sin proyecto puede quedar sin pilar'); eq(r3.proyecto, '');
    // Cierre editable aunque esté pendiente; y después de un check rápido
    eq(find(gSave({ tipo: 'Tarea', id: t.id, cierre: 'nota previa' }), 'tasks', t.id).cierre, 'nota previa');
    taskComplete(t.id, {});
    var d = find(gSave({ tipo: 'Tarea', id: t.id, cierre: 'Listo: correo enviado', evidencias: [{ t: 'Correo', u: 'https://mail.google.com/x' }] }), 'tasks', t.id);
    eq(d.estado, 'Realizada'); eq(d.cierre, 'Listo: correo enviado'); eq(d.evidencias.length, 1);
    eq(find(gSave({ tipo: 'Tarea', id: t.id, cierre: '' }), 'tasks', t.id).cierre, '', 'también se puede vaciar');
  });

  test('v3 server · filas v2 (sin Avisar/Privada/Inicio): se agregan las columnas y se leen con valores por defecto', function () {
    need('G_HEADERS');
    fresh('raw');
    var old = G_HEADERS.slice(0, 22);
    var r1 = ['TSK-0000aaaa', 'Tarea', 'Naturaleza', '', 'Tarea v2', '', U.ina, '', 'Pendiente', '', '', '', '', '', '', '', U.ina, '', '', '', '', ''];
    var r2 = ['PRJ-0000bbbb', 'Proyecto', 'Naturaleza', '', 'Proyecto v2', '', U.ina, '', 'Activo', '', '', '', '', '', '', '', U.ina, '', '', '', '', ''];
    MOCK.addSheet('Gestión', [old, r1, r2], { hidden: true });
    var b = bootstrap();
    var t = find(b, 'tasks', 'TSK-0000aaaa');
    eq(t.avisar, true, 'Avisar vacío → true'); eq(t.privada, false, 'Privada vacío → false'); eq(t.orden, 0);
    var p = find(b, 'projects', 'PRJ-0000bbbb');
    eq(p.inicio, ''); eq(p.fin, '');
    gSave({ tipo: 'Tarea', id: t.id, detalle: 'editada' }); // gSheet_ agrega las columnas que faltan
    var head = MOCK.sheet('Gestión').getRange(1, 1, 1, MOCK.sheet('Gestión').getLastColumn()).getValues()[0];
    ['Avisar', 'Privada', 'Inicio'].forEach(function (h) { includes(head, h, 'columna ' + h); });
    var rr = row(t.id);
    eq(rr.Avisar, 'Sí'); eq(rr.Privada, 'No');
    // Valores escritos a mano en la hoja
    setCell(t.id, 'Privada', 'sí'); setCell(t.id, 'Avisar', 'no');
    var t2 = find(asUser(U.ina, function () { return bootstrap(); }), 'tasks', t.id);
    eq(t2.privada, true); eq(t2.avisar, false);
    ok(!has(asUser(U.benja, function () { return bootstrap(); }), 'tasks', t.id), 'privada a mano también se respeta');
  });

  /* ---------------- Bundle ---------------- */

  test('v3 server · bundle: solicitudes sólo para administradores; un error del módulo no bota la app', function () {
    fresh('setup');
    var b = client('bootstrap');
    ok(Array.isArray(b.solicitudes), 'admin: arreglo');
    deepEq(asUser(U.ina, function () { return client('bootstrap'); }).solicitudes, [], 'no admin: []');
    var st = client('getAdminStatus');
    ok('aprob' in st, 'getAdminStatus.aprob');
    if (typeof aprobRead_ === 'function') {
      var b2 = swap('aprobRead_', function () { return function () { throw new Error('hoja rota'); }; }, function () { return client('bootstrap'); });
      deepEq(b2.solicitudes, []);
      ok(b2.config.warnings.some(function (w) { return /solicitudes de compra/i.test(w); }), 'aviso en config.warnings');
      var st2 = swap('aprobStatus_', function () { return function () { throw new Error('sin permiso'); }; }, function () { return client('getAdminStatus'); });
      eq(st2.aprob.triggerInstalled, false, 'aprobStatus_ con error → estado seguro');
    }
    eq(b.config.version, CONFIG.APP_VERSION);
    ok(/^3\./.test(CONFIG.APP_VERSION), 'versión 3');
  });

  test('v3 server · demo: privadas, sin aviso, personales, orden manual y proyectos con fechas', function () {
    fresh('demo');
    var b = bootstrap(); // como Gonzalo
    var mine = b.tasks.filter(function (t) { return t.privada; });
    ok(mine.length >= 1 && mine.every(function (t) { return t.creadoPor === U.gonzalo || t.resp === U.gonzalo; }), 'Gonzalo sólo ve sus privadas');
    var ina = asUser(U.ina, function () { return bootstrap(); });
    ok(ina.tasks.some(function (t) { return t.privada && t.creadoPor === U.ina; }), 'Ina ve la suya');
    ok(!ina.tasks.some(function (t) { return t.privada && t.creadoPor !== U.ina && t.resp !== U.ina; }), 'y no las de otros');
    var all = gRows('Tarea').filter(function (r) { return r.Privada === 'Sí'; });
    ok(all.length >= 4, 'varias privadas en la hoja: ' + all.length);
    ok(b.tasks.some(function (t) { return t.avisar === false; }), 'una sin aviso');
    ok(b.tasks.some(function (t) { return !t.pilar && t.estado === 'Pendiente'; }), 'pendientes personales sin pilar');
    ok(b.tasks.filter(function (t) { return t.orden > 0; }).length >= 3, 'orden manual');
    var dated = b.projects.filter(function (p) { return p.inicio && p.fin; });
    ok(dated.length >= 10, 'proyectos con fechas para la carta Gantt: ' + dated.length);
    ok(dated.some(function (p) { return p.inicio < day(-200); }) && dated.some(function (p) { return p.fin > day(150); }), 'fechas a lo largo del año');
    ok(dated.every(function (p) { return p.fin >= p.inicio; }), 'fin ≥ inicio');
    var imported = expectedImport().projects;
    ok(b.projects.length >= imported, 'los proyectos de Cascade siguen ahí (adoptados, no duplicados)');
    var byCas = {};
    b.projects.forEach(function (p) { if (p.cascade) { ok(!byCas[p.cascade], 'un solo proyecto por indicador: ' + p.nombre); byCas[p.cascade] = 1; } });
    deepEq(client('importCascadeProjects').lastImport, { projects: 0, tasks: 0 }, 'el demo no deja nada por importar');
    assertNoDates(b, 'bundle demo');
  });
})();
