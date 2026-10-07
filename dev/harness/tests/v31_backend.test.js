/* v3.1 servidor (SPEC §14.1 rendimiento, §14.3 columna Carpeta): bundle parcial de Gestión (mutateG_ / bundleGestion_),
   taskReorder liviano, estado rápido de Ariba sin activadores en el bundle, Project.carpeta/carpetaUrl, gSetProjectFolder_
   y el gancho de Drive (typeof, fuera del lock, nunca hace fallar el guardado). */
(function () {
  var GL = (0, eval)('this');
  var PARTIAL_KEYS = ['cascade', 'comments', 'loadedAt', 'partial', 'projects', 'tasks'];

  function find(b, coll, id) { var x = (b[coll] || []).find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function has(b, coll, id) { return (b[coll] || []).some(function (e) { return e.id === id; }); }
  function row(id) { var r = gRows().find(function (x) { return x.ID === id; }); ok(r, 'no encontré la fila ' + id); return r; }
  function isIso(s) { return typeof s === 'string' && /T/.test(s) && !isNaN(Date.parse(s)); }
  function keysOf(b) { return Object.keys(b).filter(function (k) { return k !== 'lastId' && k !== 'lastImport'; }).sort(); }
  function isPartial(b, label) {
    ok(b && typeof b === 'object', label + ': sin respuesta');
    eq(b.partial, 'gestion', label + ': partial');
    deepEq(keysOf(b), PARTIAL_KEYS, label + ': sólo las 4 colecciones + loadedAt');
    ok(isIso(b.loadedAt), label + ': loadedAt ISO');
    ['projects', 'tasks', 'cascade', 'comments'].forEach(function (k) { ok(Array.isArray(b[k]), label + ': ' + k + ' arreglo'); });
  }
  function isFull(b, label) {
    ok(b && b.me && b.budget && b.config && !b.partial, label + ': bundle completo');
  }
  // Reemplaza globales (funciones de otros módulos) durante body; undefined = "el módulo no existe"
  function withGlobals(map, body) {
    var saved = {};
    Object.keys(map).forEach(function (k) { saved[k] = { had: k in GL, v: GL[k] }; GL[k] = map[k]; });
    try { return body(); } finally {
      Object.keys(saved).forEach(function (k) { if (saved[k].had) GL[k] = saved[k].v; else delete GL[k]; });
    }
  }
  function noDrive(body) { return withGlobals({ driveEnsureFolder_: undefined, driveSyncFolder_: undefined }, body); }
  // Cuenta llamadas a servicios (lecturas de hoja por pestaña, metadatos, propiedades, activadores) durante fn
  function probe(fn) {
    var ss = MOCK.spreadsheet();
    var sh0 = ss.getSheets()[0];
    var targets = [
      [Object.getPrototypeOf(sh0.getRange(1, 1)), ['getValues', 'getValue', 'getDisplayValues', 'getFormulas'], 'range'],
      [Object.getPrototypeOf(sh0), ['getLastRow', 'getLastColumn', 'getDataRange'], 'sheet'],
      [Object.getPrototypeOf(ss), ['getSheets', 'getSheetByName', 'getUrl'], 'ss'],
      [Object.getPrototypeOf(PropertiesService.getScriptProperties()), ['getProperty', 'getProperties'], 'props'],
      [ScriptApp, ['getProjectTriggers'], 'triggers'],
    ];
    var out = { total: 0, reads: {}, kinds: {} };
    var saved = [];
    targets.forEach(function (t) {
      t[1].forEach(function (m) {
        var orig = t[0][m];
        if (typeof orig !== 'function') return;
        saved.push([t[0], m, orig]);
        t[0][m] = function () {
          out.kinds[t[2]] = (out.kinds[t[2]] || 0) + 1;
          out.total++;
          if (t[2] === 'range') { var n = this._sh && this._sh._name || '?'; out.reads[n] = (out.reads[n] || 0) + 1; }
          return orig.apply(this, arguments);
        };
      });
    });
    try { out.result = fn(); } finally { saved.reverse().forEach(function (s) { s[0][s[1]] = s[2]; }); }
    return out;
  }

  /* ---------------- Bundle parcial ---------------- */

  test('v31 backend · bundleGestion_: forma parcial, sin Date, mismas colecciones que bootstrap y privacidad por usuario', function () {
    need('bundleGestion_', 'mutateG_', 'gSave');
    fresh('demo');
    var priv = asUser(U.benja, function () { return client('gSave', { tipo: 'Tarea', pilar: 'nat', nombre: 'Privada de Benja v31', privada: true, resp: U.benja }).lastId; });
    asUser(U.benja, function () { client('commentAdd', priv, 'comentario privado v31'); });
    [U.ina, U.benja, U.gonzalo].forEach(function (user) {
      asUser(user, function () {
        var p = bundleGestion_();
        assertNoDates(p, 'bundleGestion_()');
        var c = MOCK.strictClone(p);
        isPartial(c, user);
        var full = bootstrap();
        ['projects', 'tasks', 'cascade', 'comments'].forEach(function (k) { deepEq(c[k], MOCK.strictClone(full[k]), user + ': ' + k + ' = bootstrap'); });
        var sees = user === U.benja;
        eq(has(c, 'tasks', priv), sees, user + ': tarea privada de Benja');
        eq(c.comments.some(function (x) { return x.ref === priv; }), sees, user + ': su comentario');
      });
    });
  });

  test('v31 backend · cada escritura de Gestión devuelve el bundle parcial (con lastId); presupuesto sigue completo', function () {
    need('gSave', 'gDelete', 'taskComplete', 'taskReopen', 'commentAdd', 'commentDelete', 'importCascadeProjects', 'budgetSave', 'budgetDelete');
    fresh('setup');
    noDrive(function () {
      var prj = client('gSave', { tipo: 'Proyecto', pilar: 'cc', nombre: 'Proyecto parcial', resp: U.ina });
      isPartial(prj, 'gSave Proyecto'); ok(/^PRJ-/.test(prj.lastId), 'lastId PRJ'); ok(has(prj, 'projects', prj.lastId), 'el proyecto viene en el parcial');
      var tsk = client('gSave', { tipo: 'Tarea', proyecto: prj.lastId, nombre: 'Tarea parcial', resp: U.ina, fecha: day(9) });
      isPartial(tsk, 'gSave Tarea'); eq(find(tsk, 'tasks', tsk.lastId).proyecto, prj.lastId);
      var grp = client('gSave', { tipo: 'Cascade', pilar: 'cc', nombre: 'Grupo parcial' });
      isPartial(grp, 'gSave Cascade'); ok(has(grp, 'cascade', grp.lastId), 'grupo en el parcial');
      var done = client('taskComplete', tsk.lastId, { cierre: 'listo' });
      isPartial(done, 'taskComplete'); eq(done.lastId, tsk.lastId); eq(find(done, 'tasks', tsk.lastId).estado, 'Realizada');
      var re = client('taskReopen', tsk.lastId);
      isPartial(re, 'taskReopen'); eq(find(re, 'tasks', tsk.lastId).estado, 'Pendiente');
      var y = bootstrap().years[0];
      var line = bootstrap().budget[String(y)][0];
      [prj.lastId, tsk.lastId, line.id].forEach(function (ref) {
        var c = client('commentAdd', ref, 'hola ' + ref);
        isPartial(c, 'commentAdd ' + ref.slice(0, 3)); ok(/^CMT-/.test(c.lastId));
        eq(find(c, 'comments', c.lastId).ref, ref);
        var d = client('commentDelete', c.lastId);
        isPartial(d, 'commentDelete ' + ref.slice(0, 3)); ok(!has(d, 'comments', c.lastId), 'comentario eliminado');
      });
      var del = client('gDelete', grp.lastId);
      isPartial(del, 'gDelete Cascade'); ok(!has(del, 'cascade', grp.lastId));
      // Proyecto con líneas vinculadas: al eliminarlo se desvinculan (vive en Gestión) → parcial basta
      var nat = bootstrap().budget[String(y)].find(function (l) { return l.pilar === 'cc' && l.pf > 0; });
      ok(nat, 'hay una línea de Cambio Climático con monto');
      client('gSave', { tipo: 'Proyecto', id: prj.lastId, lineas: [nat.id] });
      var delP = client('gDelete', prj.lastId);
      isPartial(delP, 'gDelete Proyecto'); ok(!has(delP, 'projects', prj.lastId));
      eq(find(delP, 'tasks', tsk.lastId).proyecto, '', 'la tarea queda sin proyecto');
      var imp = client('importCascadeProjects');
      isPartial(imp, 'importCascadeProjects');
      ok(imp.lastImport && typeof imp.lastImport.projects === 'number' && typeof imp.lastImport.tasks === 'number', 'lastImport');
      // Presupuesto y lecturas: bundle completo, igual que antes
      var bs = client('budgetSave', y, line.id, { nota: 'nota v31' });
      isFull(bs, 'budgetSave'); eq(bs.lastId, line.id);
      isFull(client('budgetDelete', y, line.id), 'budgetDelete');
      isFull(client('bootstrap'), 'bootstrap');
    });
  });

  test('v31 backend · mutateG_: si el bundle parcial falla, el cambio queda guardado y responde {stale, lastId, warning}', function () {
    need('mutateG_', 'bundleGestion_', 'gSave');
    fresh('setup');
    var orig = GL.bundleGestion_;
    GL.bundleGestion_ = function () { throw new Error('lectura caída'); };
    var r;
    try {
      r = noDrive(function () { return client('gSave', { tipo: 'Tarea', nombre: 'Guardada igual', resp: U.gonzalo }); });
    } finally { GL.bundleGestion_ = orig; }
    eq(r.stale, true, 'stale'); ok(/^TSK-/.test(r.lastId), 'lastId'); includes(r.warning, 'lectura caída');
    eq(row(r.lastId).Nombre, 'Guardada igual', 'la fila quedó escrita');
    // after() que lanza no hace fallar la escritura (mutateG_ genérico)
    var b = mutateG_(function () { return { lastId: r.lastId }; }, function () { throw new Error('paso posterior roto'); });
    isPartial(b, 'mutateG_ con after que lanza'); eq(b.lastId, r.lastId);
    // Sin acceso: mismo control que mutate_
    asUser('intruso@gmail.com', function () { throws(function () { mutateG_(function () { return {}; }); }, /No tienes acceso/); });
  });

  /* ---------------- taskReorder liviano ---------------- */

  test('v31 backend · taskReorder: respuesta liviana {ok, ids}, guarda Orden, sin Historial ni bundle', function () {
    need('taskReorder', 'gSave');
    fresh('setup');
    var ids = asUser(U.ina, function () {
      return ['A', 'B', 'C'].map(function (n) { return client('gSave', { tipo: 'Tarea', nombre: 'Orden ' + n, resp: U.ina }).lastId; });
    });
    var priv = asUser(U.benja, function () { return client('gSave', { tipo: 'Tarea', nombre: 'Privada ajena', privada: true }).lastId; });
    var hist = rowsOf('Historial').length;
    var p = probe(function () { return asUser(U.ina, function () { return client('taskReorder', [ids[2], ids[0], ids[2], ids[1]]); }); });
    deepEq(p.result, { ok: true, ids: [ids[2], ids[0], ids[1]] }, 'respuesta liviana sin duplicados');
    deepEq(Object.keys(p.reads), ['Gestión'], 'sólo lee la pestaña Gestión');
    ok(!p.kinds.triggers, 'sin activadores');
    eq(rowsOf('Historial').length, hist, 'ordenar no se anota en el Historial');
    eq(Number(row(ids[2]).Orden), 1); eq(Number(row(ids[0]).Orden), 2); eq(Number(row(ids[1]).Orden), 3);
    asUser(U.ina, function () {
      throws(function () { client('taskReorder', [ids[0], priv]); }, 'No encontré la tarea', 'privada ajena');
      throws(function () { client('taskReorder', []); }, /ordenar/i, 'vacío');
    });
    eq(Number(row(ids[0]).Orden), 2, 'un error no escribe nada');
    asUser('intruso@gmail.com', function () { throws(function () { client('taskReorder', ids); }, /No tienes acceso/); });
  });

  /* ---------------- Estado rápido de Ariba ---------------- */

  test('v31 backend · bundle_: config.aprob rápido (sin ScriptApp.getProjectTriggers); Ajustes sigue exacto', function () {
    need('aprobStatusFast_', 'aprobStatus_', 'aprobInstall', 'getAdminStatus');
    fresh('setup');
    var p = probe(function () { return client('bootstrap'); });
    ok(!p.kinds.triggers, 'bootstrap no consulta activadores (' + (p.kinds.triggers || 0) + ')');
    var st = p.result.config.aprob;
    ok(st && st.fast === true, 'estado rápido en el bundle del administrador');
    eq(st.triggerInstalled, false, 'aún no se activa');
    Object.keys(aprobStatus_()).forEach(function (k) { ok(k in st, 'misma forma que aprobStatus_: ' + k); });
    eq(asUser(U.ina, function () { return client('bootstrap'); }).config.aprob, null, 'no admin: null');

    client('aprobInstall');
    var props = PropertiesService.getScriptProperties();
    props.setProperty('APROB_LAST_SCAN', '2026-10-02T10:00:00.000Z');
    props.setProperty('APROB_LAST_RESULT', JSON.stringify({ found: 3, added: 1, at: '2026-10-02T10:00:00.000Z' }));
    var p2 = probe(function () { return client('bootstrap'); });
    ok(!p2.kinds.triggers, 'tampoco con el activador instalado');
    var st2 = p2.result.config.aprob;
    eq(st2.triggerInstalled, true, 'activado (APROB_SCHEDULE)');
    eq(st2.hour, CONFIG.APROB_SCAN_HOUR, 'hora');
    eq(st2.lastScan, '2026-10-02T10:00:00.000Z'); eq(st2.lastResult.added, 1);
    eq(st2.sender, aprobStatus_().sender);
    // Propiedad corrupta → estado seguro, sin lanzar
    props.setProperty('APROB_LAST_RESULT', '{roto');
    eq(aprobStatusFast_().lastResult, null, 'JSON inválido → null');
    // getAdminStatus (Ajustes) mantiene la consulta exacta de activadores
    var p3 = probe(function () { return client('getAdminStatus'); });
    ok(p3.kinds.triggers >= 1, 'Ajustes consulta los activadores');
    eq(p3.result.aprob.triggerInstalled, true);
    ok(!p3.result.aprob.fast, 'Ajustes: estado completo');
  });

  test('v31 backend · micro-benchmark: bundleGestion_ lee sólo Gestión y hace menos llamadas que bundle_', function () {
    need('bundleGestion_');
    fresh('demo');
    var full = probe(function () { return bundle_(); });
    var part = probe(function () { return bundleGestion_(); });
    deepEq(Object.keys(part.reads), ['Gestión'], 'parcial: sólo la pestaña Gestión');
    ok((part.kinds.props || 0) <= 1 && !part.kinds.triggers, 'parcial: sin activadores; sólo la propiedad SHEET_ID de ss_()');
    ok((part.kinds.props || 0) < (full.kinds.props || 0), 'parcial: menos lecturas de propiedades');
    ok(Object.keys(full.reads).some(function (n) { return /^Cuadre \d{4}$/.test(n); }), 'completo: lee las pestañas Cuadre');
    ok(!full.kinds.triggers, 'completo: sin activadores');
    ok(part.total < full.total, 'parcial (' + part.total + ') < completo (' + full.total + ')');
  });

  /* ---------------- Columna Carpeta ---------------- */

  test('v31 backend · Carpeta: encabezado al final, Project.carpeta/carpetaUrl, gSetProjectFolder_ sin cambiar la versión', function () {
    need('G_HEADERS', 'gSetProjectFolder_', 'gSave');
    fresh('setup');
    eq(G_HEADERS[G_HEADERS.length - 2], 'Carpeta', 'Carpeta va al final (v3.6: justo antes de Asignados, SPEC §20)');
    var sh = MOCK.sheet('Gestión');
    includes(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], 'Carpeta', 'setup agrega la columna');
    var id = noDrive(function () { return client('gSave', { tipo: 'Proyecto', pilar: 'nat', nombre: 'Con carpeta', carpeta: 'HACK123' }).lastId; });
    var p0 = find(bootstrap(), 'projects', id);
    eq(p0.carpeta, '', 'el cliente no escribe la carpeta'); eq(p0.carpetaUrl, '');
    eq(withLock_(function () { return gSetProjectFolder_(id, '1AbC_def-GHIjklMNO'); }), true);
    var p1 = find(bootstrap(), 'projects', id);
    eq(p1.carpeta, '1AbC_def-GHIjklMNO');
    eq(p1.carpetaUrl, 'https://drive.google.com/drive/folders/1AbC_def-GHIjklMNO');
    eq(p1.actualizado, p0.actualizado, 'no cambia la versión (no choca con un formulario abierto)');
    // Editar el proyecto desde el cliente (incluso enviando carpeta) conserva la carpeta
    var e = noDrive(function () { return client('gSave', { tipo: 'Proyecto', id: id, detalle: 'nueva descripción', carpeta: '', base: p1.actualizado }); });
    eq(find(e, 'projects', id).carpeta, '1AbC_def-GHIjklMNO', 'gSave conserva Carpeta');
    // Validación y casos borde
    throws(function () { withLock_(function () { gSetProjectFolder_(id, 'https://evil.com/"x'); }); }, /carpeta de Drive inválido/);
    eq(withLock_(function () { return gSetProjectFolder_('PRJ-00000000', 'abc'); }), false, 'proyecto inexistente');
    var t = noDrive(function () { return gSave({ tipo: 'Tarea', nombre: 'Tarea' }).lastId; });
    eq(withLock_(function () { return gSetProjectFolder_(t, 'abc'); }), false, 'sólo proyectos');
    eq(withLock_(function () { return gSetProjectFolder_(id, ''); }), true, 'vaciar');
    eq(find(bootstrap(), 'projects', id).carpetaUrl, '', 'sin carpeta');
    // Celda editada a mano: link de Drive → id; texto raro → ''
    var col = G_HEADERS.indexOf('Carpeta') + 1;
    sh.getRange(row(id)._row, col).setValue('https://drive.google.com/drive/u/0/folders/0AbcSharedXYZ?usp=sharing');
    eq(find(bootstrap(), 'projects', id).carpeta, '0AbcSharedXYZ', 'link → id');
    sh.getRange(row(id)._row, col).setValue('javascript:alert(1)');
    eq(find(bootstrap(), 'projects', id).carpetaUrl, '', 'texto inválido → sin link');
    ok(MOCK.lockViolations.length === 0, 'sin locks anidados');
  });

  test('v31 backend · Carpeta en planillas v3 (sin la columna): se lee vacía y gSetProjectFolder_ la agrega', function () {
    need('G_HEADERS', 'gSetProjectFolder_');
    fresh('raw');
    var old = G_HEADERS.slice(0, G_HEADERS.indexOf('Carpeta'));
    var r = old.map(function () { return ''; });
    r[0] = 'PRJ-0000cccc'; r[1] = 'Proyecto'; r[2] = 'Naturaleza'; r[4] = 'Proyecto v3';
    MOCK.addSheet('Gestión', [old, r], { hidden: true });
    var p = find(bootstrap(), 'projects', 'PRJ-0000cccc');
    eq(p.carpeta, ''); eq(p.carpetaUrl, '');
    eq(withLock_(function () { return gSetProjectFolder_('PRJ-0000cccc', 'FolderV3abc'); }), true);
    var head = MOCK.sheet('Gestión').getRange(1, 1, 1, MOCK.sheet('Gestión').getLastColumn()).getValues()[0];
    includes(head, 'Carpeta', 'columna agregada');
    eq(find(bootstrap(), 'projects', 'PRJ-0000cccc').carpeta, 'FolderV3abc');
    fresh('raw');
    eq(withLock_(function () { return gSetProjectFolder_('PRJ-0000cccc', 'x'); }), false, 'sin hoja Gestión: false, sin crearla');
    ok(!MOCK.sheet('Gestión'), 'no crea la hoja');
  });

  /* ---------------- Gancho de Drive ---------------- */

  test('v31 backend · gancho de Drive: proyecto nuevo → driveEnsureFolder_ FUERA del lock y la carpeta llega en el parcial', function () {
    need('gSave', 'gSetProjectFolder_');
    fresh('setup');
    var calls = [];
    var ensure = function (p) {
      calls.push({ fn: 'ensure', p: MOCK.strictClone(p) });
      // Drive.gs escribe la columna Carpeta tomando el lock: si gSave aún lo tuviera, sería un lock anidado (falla)
      withLock_(function () { gSetProjectFolder_(p.id, 'FLD_' + p.id.slice(4)); });
    };
    var sync = function (p) { calls.push({ fn: 'sync', p: MOCK.strictClone(p) }); };
    withGlobals({ driveEnsureFolder_: ensure, driveSyncFolder_: sync }, function () {
      var b = asUser(U.ina, function () { return client('gSave', { tipo: 'Proyecto', pilar: 'nat', nombre: 'Humedal v31', resp: U.ina }); });
      isPartial(b, 'gSave');
      eq(calls.length, 1, 'una llamada'); eq(calls[0].fn, 'ensure');
      var arg = calls[0].p;
      eq(arg.id, b.lastId); eq(arg.nombre, 'Humedal v31'); eq(arg.pilar, 'nat'); eq(arg.carpeta, '');
      ok('carpetaUrl' in arg && 'estado' in arg, 'forma del proyecto del bundle');
      var p = find(b, 'projects', b.lastId);
      eq(p.carpeta, 'FLD_' + b.lastId.slice(4), 'la carpeta ya viene en la respuesta');
      ok(/^https:\/\/drive\.google\.com\/drive\/folders\/FLD_/.test(p.carpetaUrl), 'carpetaUrl');
      eq(MOCK.lockViolations.length, 0, 'sin lock anidado');

      // Editar sin cambiar nombre ni pilar → nada
      calls.length = 0;
      client('gSave', { tipo: 'Proyecto', id: b.lastId, detalle: 'algo', estado: 'En pausa' });
      eq(calls.length, 0, 'sin llamadas a Drive');
      // Renombrar → driveSyncFolder_ con el nombre nuevo y la carpeta
      client('gSave', { tipo: 'Proyecto', id: b.lastId, nombre: 'Humedal v31 (renombrado)' });
      eq(calls.length, 1); eq(calls[0].fn, 'sync'); eq(calls[0].p.nombre, 'Humedal v31 (renombrado)');
      eq(calls[0].p.carpeta, 'FLD_' + b.lastId.slice(4), 'sync recibe la carpeta actual');
      // Cambio de pilar → sync
      calls.length = 0;
      client('gSave', { tipo: 'Proyecto', id: b.lastId, pilar: 'cc' });
      eq(calls.length, 1); eq(calls[0].fn, 'sync'); eq(calls[0].p.pilar, 'cc');
      // Tareas, indicadores, comentarios y errores de validación → nunca
      calls.length = 0;
      client('gSave', { tipo: 'Tarea', proyecto: b.lastId, nombre: 'Tarea' });
      client('gSave', { tipo: 'Cascade', pilar: 'cc', nombre: 'Grupo' });
      client('commentAdd', b.lastId, 'hola');
      throws(function () { client('gSave', { tipo: 'Proyecto', pilar: 'nat', nombre: '' }); }, /nombre/i);
      eq(calls.length, 0, 'sin llamadas a Drive');
    });
  });

  test('v31 backend · gancho de Drive: si falla o no existe Drive.gs, el proyecto se guarda igual', function () {
    need('gSave');
    fresh('setup');
    var boom = function () { throw new Error('Drive no disponible'); };
    var b = withGlobals({ driveEnsureFolder_: boom, driveSyncFolder_: boom }, function () {
      var r = client('gSave', { tipo: 'Proyecto', pilar: 'ec', nombre: 'Sin Drive' });
      isPartial(r, 'gSave con Drive caído');
      var r2 = client('gSave', { tipo: 'Proyecto', id: r.lastId, nombre: 'Sin Drive 2' });
      isPartial(r2, 'renombrar con Drive caído');
      return r2;
    });
    eq(find(b, 'projects', b.lastId).nombre, 'Sin Drive 2');
    eq(row(b.lastId).Nombre, 'Sin Drive 2', 'quedó en la hoja');
    ok(MOCK.consoleBuf.some(function (m) { return m.level === 'error' && /driveEnsureFolder_/.test(m.text); }), 'error en el log del servidor');
    // Módulo ausente (typeof)
    var c = noDrive(function () { return client('gSave', { tipo: 'Proyecto', pilar: 'ec', nombre: 'Sin módulo' }); });
    isPartial(c, 'sin Drive.gs'); eq(find(c, 'projects', c.lastId).carpeta, '');
  });
})();
