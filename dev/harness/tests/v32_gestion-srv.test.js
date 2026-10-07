/* v3.2 servidor (SPEC §15): privacidad por defecto en gSave (sin proyecto → privada, con proyecto → compartida,
   sin identidad → compartida, lo explícito manda, pasar a un proyecto la comparte) y tasksSetPrivacy (permisos de
   creador / responsable, lote atómico, sin repetidos, máximo 500, una escritura, una línea de Historial, bundle parcial). */
(function () {
  var GL = (0, eval)('this');
  var PARTIAL_KEYS = ['cascade', 'comments', 'loadedAt', 'partial', 'projects', 'tasks'];
  var NOT_OWNER = 'Sólo quien creó la tarea o su responsable puede cambiar su privacidad.';

  function find(b, coll, id) { var x = (b[coll] || []).find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function has(b, coll, id) { return (b[coll] || []).some(function (e) { return e.id === id; }); }
  function row(id) { var r = gRows().find(function (x) { return x.ID === id; }); ok(r, 'no encontré la fila ' + id); return r; }
  function isPartial(b, label) {
    ok(b && typeof b === 'object', label + ': sin respuesta');
    eq(b.partial, 'gestion', label + ': partial');
    deepEq(Object.keys(b).filter(function (k) { return k !== 'lastId'; }).sort(), PARTIAL_KEYS, label + ': sólo las 4 colecciones + loadedAt');
  }
  function withGlobals(map, body) {
    var saved = {};
    Object.keys(map).forEach(function (k) { saved[k] = { had: k in GL, v: GL[k] }; GL[k] = map[k]; });
    try { return body(); } finally {
      Object.keys(saved).forEach(function (k) { if (saved[k].had) GL[k] = saved[k].v; else delete GL[k]; });
    }
  }
  function noDrive(body) { return withGlobals({ driveEnsureFolder_: undefined, driveSyncFolder_: undefined }, body); }
  function project(pilar, nombre) {
    return noDrive(function () { return client('gSave', { tipo: 'Proyecto', pilar: pilar, nombre: nombre, resp: U.ina }).lastId; });
  }
  // Alta como google.script.run; extra sin "privada" = el cliente no la envía
  function mk(user, extra) {
    return asUser(user, function () {
      return client('gSave', Object.assign({ tipo: 'Tarea', nombre: 'Tarea v32', resp: user || '' }, extra || {}));
    });
  }
  function privOf(user, id) { return asUser(user, function () { return find(bundleGestion_(), 'tasks', id).privada; }); }
  function sees(user, id) { return asUser(user, function () { return has(bundleGestion_(), 'tasks', id); }); }
  function hist() { return rowsOf('Historial'); }
  function tick() { var t = Date.now(); while (Date.now() === t) { /* Actualizado distinto */ } }
  // Cuenta escrituras sobre la pestaña Gestión durante fn
  function countWrites(fn) {
    var proto = Object.getPrototypeOf(MOCK.spreadsheet().getSheets()[0].getRange(1, 1));
    var n = { setValues: 0, setValue: 0 };
    var saved = {};
    ['setValues', 'setValue'].forEach(function (m) {
      saved[m] = proto[m];
      proto[m] = function () {
        if (this._sh && this._sh._name === 'Gestión') n[m]++;
        return saved[m].apply(this, arguments);
      };
    });
    try { n.result = fn(); } finally { Object.keys(saved).forEach(function (m) { proto[m] = saved[m]; }); }
    return n;
  }

  /* ---------------- gSave: valores por defecto ---------------- */

  test('v32 gestion-srv · alta: sin proyecto → privada; con proyecto → compartida; sin correo → compartida; lo explícito manda', function () {
    need('gSave', 'bundleGestion_');
    fresh('setup');
    var prj = project('nat', 'Proyecto v32');
    var cases = [
      // [usuario, extra, privada esperada, etiqueta]
      [U.ina, { pilar: 'nat' }, true, 'sin proyecto, con pilar'],
      [U.ina, {}, true, 'personal (sin pilar ni proyecto)'],
      [U.ina, { privada: null }, true, 'privada null = no enviada'],
      [U.ina, { proyecto: prj }, false, 'con proyecto'],
      [U.ina, { pilar: 'nat', privada: false }, false, 'sin proyecto, explícita compartida'],
      [U.ina, { pilar: 'nat', privada: 'No' }, false, 'sin proyecto, "No"'],
      [U.ina, { proyecto: prj, privada: true }, true, 'con proyecto, explícita privada'],
      [U.ina, { proyecto: prj, privada: 'Sí' }, true, 'con proyecto, "Sí"'],
      ['', { pilar: 'nat' }, false, 'sin correo, sin proyecto'],
      ['', {}, false, 'sin correo, personal'],
      ['', { proyecto: prj }, false, 'sin correo, con proyecto'],
    ];
    cases.forEach(function (c) {
      var b = mk(c[0], Object.assign({ nombre: 'Alta · ' + c[3] }, c[1]));
      var who = c[0] || 'desconocido';
      ok(/^TSK-/.test(b.lastId), c[3] + ': lastId');
      eq(row(b.lastId).Privada, c[2] ? 'Sí' : 'No', c[3] + ': columna Privada');
      if (c[0]) eq(find(b, 'tasks', b.lastId).privada, c[2], c[3] + ': bundle de quien la creó');
      else eq(has(b, 'tasks', b.lastId), true, c[3] + ': sin correo la ve (es compartida)');
      eq(sees(U.ignacio, b.lastId), !c[2], c[3] + ': otra persona la ve sólo si es compartida (' + who + ')');
    });
    // Sin correo, pedir privada explícita sigue siendo un error (nadie la podría ver)
    asUser('', function () {
      throws(function () { client('gSave', { tipo: 'Tarea', nombre: 'Privada sin correo', privada: true }); }, /identificar/i);
    });
    // Historial: la privada por defecto no revela su nombre
    var h = JSON.stringify(hist());
    ok(h.indexOf('Alta · sin proyecto, con pilar') < 0, 'el Historial no muestra la privada por defecto');
    includes(h, 'Alta · con proyecto', 'la compartida sí aparece');
  });

  test('v32 gestion-srv · edición: pasar de sin proyecto a un proyecto la comparte (salvo privada explícita); lo demás conserva', function () {
    need('gSave');
    fresh('setup');
    var a = project('nat', 'Proyecto A v32');
    var b = project('ec', 'Proyecto B v32');
    // Sin proyecto (privada por defecto) → proyecto, sin enviar privada → compartida
    var t1 = mk(U.ina, { nombre: 'Mover al proyecto' }).lastId;
    eq(privOf(U.ina, t1), true, 'parte privada');
    var r1 = asUser(U.ina, function () { return client('gSave', { tipo: 'Tarea', id: t1, proyecto: a }); });
    var x1 = find(r1, 'tasks', t1);
    eq(x1.privada, false, 'al entrar a un proyecto queda compartida');
    eq(x1.proyecto, a); eq(x1.pilar, 'nat', 'pilar del proyecto');
    ok(sees(U.ignacio, t1), 'el equipo la ve');
    var last = hist().slice(-1)[0];
    eq(last['Acción'], 'Editar tarea'); eq(last.Proyecto, 'Mover al proyecto');
    includes(String(last.Detalle), 'Ahora es compartida', 'el Historial lo dice');
    // Mismo cambio, pero con privada explícita → se respeta
    var t2 = mk(U.ina, { nombre: 'Mover pero privada' }).lastId;
    eq(asUser(U.ina, function () { return find(client('gSave', { tipo: 'Tarea', id: t2, proyecto: a, privada: true }), 'tasks', t2).privada; }), true, 'explícita privada manda');
    ok(!sees(U.ignacio, t2), 'sigue oculta');
    // Editar otra cosa (sin proyecto) conserva la privacidad
    var t3 = mk(U.ina, { nombre: 'Sólo nota' }).lastId;
    asUser(U.ina, function () { client('gSave', { tipo: 'Tarea', id: t3, detalle: 'nota nueva', fecha: day(4) }); });
    eq(privOf(U.ina, t3), true, 'editar sin proyecto la deja privada');
    // Una privada que YA tenía proyecto y cambia a otro proyecto: se conserva (sólo "sin proyecto → proyecto" comparte)
    asUser(U.ina, function () { client('gSave', { tipo: 'Tarea', id: t2, proyecto: b }); });
    eq(privOf(U.ina, t2), true, 'proyecto A → B no la comparte');
    // Quitarle el proyecto no la vuelve privada en el servidor
    asUser(U.ina, function () { client('gSave', { tipo: 'Tarea', id: t1, proyecto: '' }); });
    eq(privOf(U.ina, t1), false, 'proyecto → sin proyecto conserva compartida');
    // Compartida explícita sin proyecto: editarla no la vuelve privada
    var t4 = mk(U.ina, { nombre: 'Compartida a mano', privada: false }).lastId;
    asUser(U.ina, function () { client('gSave', { tipo: 'Tarea', id: t4, detalle: 'x' }); });
    eq(privOf(U.ina, t4), false, 'la edición no aplica el valor por defecto de alta');
  });

  /* ---------------- tasksSetPrivacy ---------------- */

  test('v32 gestion-srv · tasksSetPrivacy: creador y responsable sí; otra persona y el administrador no (ni ven las privadas)', function () {
    need('tasksSetPrivacy', 'gSave');
    fresh('setup');
    var prj = project('nat', 'Proyecto permisos v32');
    // Ina la crea para Benja (compartida, en un proyecto)
    var pub = mk(U.ina, { nombre: 'Compartida de Ina para Benja', resp: U.benja, proyecto: prj }).lastId;
    var priv = mk(U.ina, { nombre: 'Privada de Ina para Benja', resp: U.benja }).lastId;
    eq(privOf(U.ina, priv), true, 'privada por defecto');
    // Otra persona: la compartida la ve pero no es suya; la privada ni siquiera existe para ella
    [U.ignacio, U.gonzalo].forEach(function (user) {
      asUser(user, function () {
        throws(function () { client('tasksSetPrivacy', [pub], true); }, NOT_OWNER, user + ': compartida ajena');
        throws(function () { client('tasksSetPrivacy', [priv], false); }, 'No encontré la tarea', user + ': privada ajena');
      });
    });
    eq(privOf(U.ina, pub), false, 'nada cambió (compartida)');
    eq(privOf(U.ina, priv), true, 'nada cambió (privada)');
    // Creadora
    var b1 = asUser(U.ina, function () { return client('tasksSetPrivacy', [pub], true); });
    isPartial(b1, 'creadora');
    eq(find(b1, 'tasks', pub).privada, true, 'la creadora la hizo privada');
    eq(row(pub).Privada, 'Sí');
    ok(!sees(U.ignacio, pub), 'ya no la ve el equipo');
    // Responsable
    var b2 = asUser(U.benja, function () { return client('tasksSetPrivacy', [pub, priv], false); });
    eq(find(b2, 'tasks', pub).privada, false, 'el responsable la compartió');
    eq(find(b2, 'tasks', priv).privada, false, 'y la otra');
    eq(row(priv)['Actualizado por'], U.benja, 'auditoría: Actualizado por');
    ok(sees(U.ignacio, priv) && sees(U.gonzalo, priv), 'ahora todos la ven');
    // El administrador que es creador sí puede
    var mine = mk(U.gonzalo, { nombre: 'Del administrador' }).lastId;
    eq(asUser(U.gonzalo, function () { return find(client('tasksSetPrivacy', [mine], false), 'tasks', mine).privada; }), false, 'admin creador');
  });

  test('v32 gestion-srv · tasksSetPrivacy: sin correo no se hace privada ni se es "dueño" por desconocido', function () {
    need('tasksSetPrivacy');
    fresh('setup');
    var anon = mk('', { nombre: 'Creada sin correo' }).lastId; // compartida, creadoPor 'desconocido'
    eq(row(anon)['Creado por'], 'desconocido');
    asUser('', function () {
      throws(function () { client('tasksSetPrivacy', [anon], true); }, /identificar/i, 'privada sin correo');
      throws(function () { client('tasksSetPrivacy', [anon], false); }, NOT_OWNER, '"desconocido" no es dueño de nada');
    });
    var ina = mk(U.ina, { nombre: 'De Ina', privada: false }).lastId;
    asUser('', function () { throws(function () { client('tasksSetPrivacy', [ina], false); }, NOT_OWNER); });
    eq(row(anon).Privada, 'No'); eq(row(ina).Privada, 'No');
  });

  test('v32 gestion-srv · tasksSetPrivacy: lote atómico, sin repetidos, una escritura, una línea de Historial, versión', function () {
    need('tasksSetPrivacy');
    fresh('setup');
    // Entre las del lote queda una fila que no cambia: el bloque escrito la reescribe tal cual
    var ids = [mk(U.ina, { nombre: 'Lote Uno', fecha: day(3) }).lastId];
    var already = mk(U.ina, { nombre: 'Lote ya compartida', privada: false }).lastId;
    var foreign = mk(U.benja, { nombre: 'De Benja', privada: false }).lastId;
    ids.push(mk(U.ina, { nombre: 'Lote Dos', fecha: day(3) }).lastId, mk(U.ina, { nombre: 'Lote Tres', fecha: day(3) }).lastId);
    ok(row(already)._row > row(ids[0])._row && row(already)._row < row(ids[2])._row, 'la fila intacta queda en medio');
    var middleBefore = JSON.stringify([row(already), row(foreign)]);
    ids.forEach(function (id) { eq(row(id).Privada, 'Sí', 'parten privadas'); });
    var alreadyVer = asUser(U.ina, function () { return find(bundleGestion_(), 'tasks', already).actualizado; });
    var oldVer = asUser(U.ina, function () { return find(bundleGestion_(), 'tasks', ids[0]).actualizado; });

    // Atómico: una ajena en el lote → no cambia ninguna, no escribe ni anota
    var sheetBefore = JSON.stringify(gRows());
    var h0 = hist().length;
    asUser(U.ina, function () { throws(function () { client('tasksSetPrivacy', ids.concat([foreign]), false); }, NOT_OWNER); });
    eq(JSON.stringify(gRows()), sheetBefore, 'nada cambió en la hoja');
    eq(hist().length, h0, 'sin Historial');

    // Lote válido con repetidos: una sola escritura en Gestión, una línea de Historial con los nombres
    tick();
    var w = countWrites(function () {
      return asUser(U.ina, function () { return client('tasksSetPrivacy', [ids[0], ids[1], ids[0], ' ' + ids[2] + ' ', already, ids[1]], false); });
    });
    eq(w.setValues, 1, 'un solo setValues en Gestión'); eq(w.setValue, 0, 'sin escrituras celda a celda');
    isPartial(w.result, 'lote');
    assertNoDates(w.result, 'tasksSetPrivacy()');
    ids.forEach(function (id) {
      var r = row(id);
      eq(r.Privada, 'No', id + ': compartida');
      eq(r['Actualizado por'], U.ina, id + ': Actualizado por');
      ok(r.Actualizado instanceof Date, id + ': Actualizado es fecha en la hoja');
      eq(r.Nombre.indexOf('Lote '), 0, id + ': el resto de la fila intacto');
      eq(r.Avisar, 'Sí', id + ': Avisar intacto');
      eq(find(w.result, 'tasks', id).privada, false, id + ': en el bundle');
    });
    ok(find(w.result, 'tasks', ids[0]).actualizado !== oldVer, 'cambia la versión');
    eq(find(w.result, 'tasks', already).actualizado, alreadyVer, 'la que ya estaba compartida no se toca');
    eq(JSON.stringify([row(already), row(foreign)]), middleBefore, 'filas intermedias idénticas (tipos incluidos)');
    ok(row(already).Actualizado instanceof Date, 'su Actualizado sigue siendo fecha');
    var hs = hist();
    eq(hs.length, h0 + 1, 'una sola línea de Historial');
    var line = hs[hs.length - 1];
    eq(line['Acción'], 'Cambiar privacidad');
    eq(line.Proyecto, '3 tareas ahora públicas', 'cuenta sólo las que cambiaron');
    includes(String(line.Detalle), 'Lote Uno'); includes(String(line.Detalle), 'Lote Tres');
    ok(String(line.Detalle).indexOf('ya compartida') < 0, 'no nombra la que no cambió');
    eq(line.Usuario, U.ina);

    // Un formulario abierto con la versión anterior choca
    asUser(U.ina, function () {
      throws(function () { client('gSave', { tipo: 'Tarea', id: ids[0], detalle: 'x', base: oldVer }); }, /modific/i, 'conflicto de versión');
    });

    // Volver a privadas: sin nombres en el Historial
    var b = asUser(U.ina, function () { return client('tasksSetPrivacy', ids, true); });
    ids.forEach(function (id) { eq(find(b, 'tasks', id).privada, true); ok(!sees(U.benja, id), 'Benja ya no la ve'); });
    line = hist().slice(-1)[0];
    eq(line.Proyecto, '3 tareas ahora privadas');
    eq(String(line.Detalle), '', 'sin nombres de privadas');
    ok(JSON.stringify(hist().slice(-1)).indexOf('Lote') < 0, 'ningún nombre en la línea');

    // Una sola: singular
    asUser(U.ina, function () { client('tasksSetPrivacy', [ids[1]], false); });
    eq(hist().slice(-1)[0].Proyecto, '1 tarea ahora pública');

    // Sin cambios (todas ya así): bundle parcial, sin escribir ni anotar
    var h1 = hist().length;
    var w2 = countWrites(function () { return asUser(U.ina, function () { return client('tasksSetPrivacy', [ids[1], already], false); }); });
    isPartial(w2.result, 'sin cambios');
    eq(w2.setValues + w2.setValue, 0, 'no escribe');
    eq(hist().length, h1, 'no anota');
  });

  test('v32 gestion-srv · tasksSetPrivacy: validaciones (vacío, máximo 500 tras quitar repetidos, valor de privada)', function () {
    need('tasksSetPrivacy');
    fresh('setup');
    var id = mk(U.ina, { nombre: 'Validar' }).lastId;
    asUser(U.ina, function () {
      throws(function () { client('tasksSetPrivacy', [], false); }, /no hay tareas/i, 'lista vacía');
      throws(function () { client('tasksSetPrivacy', null, false); }, /no hay tareas/i, 'null');
      throws(function () { client('tasksSetPrivacy', ['', '  '], false); }, /no hay tareas/i, 'sólo vacíos');
      throws(function () { client('tasksSetPrivacy', [id]); }, /privadas o públicas/i, 'falta privada');
      throws(function () { client('tasksSetPrivacy', [id], 'quizás'); }, /privadas o públicas/i, 'privada inválida');
      throws(function () { client('tasksSetPrivacy', ['TSK-00000000'], false); }, 'No encontré la tarea', 'inexistente');
      var many = [];
      for (var k = 0; k < 501; k++) many.push('TSK-' + ('0000000' + k.toString(16)).slice(-8));
      throws(function () { client('tasksSetPrivacy', many, false); }, /máximo 500/i, '501 distintas');
      // 600 repeticiones de la misma = 1 tarea: se acepta
      var reps = [];
      for (var j = 0; j < 600; j++) reps.push(id);
      eq(find(client('tasksSetPrivacy', reps, 'No'), 'tasks', id).privada, false, 'repetidas cuentan una vez; "No" = pública');
      // Un id suelto (no arreglo) también sirve
      eq(find(client('tasksSetPrivacy', id, true), 'tasks', id).privada, true, 'id suelto');
    });
    // Un id que no es tarea (proyecto) → no encontrada
    var prj = project('nat', 'No es tarea');
    asUser(U.ina, function () { throws(function () { client('tasksSetPrivacy', [prj], false); }, 'No encontré la tarea'); });
  });

  test('v32 gestion-srv · tasksSetPrivacy: bundle parcial sin Date y filtrado por quien llama', function () {
    need('tasksSetPrivacy', 'bundleGestion_');
    fresh('demo');
    var id = mk(U.benja, { nombre: 'Parcial v32' }).lastId; // privada de Benja
    asUser(U.benja, function () { commentAdd(id, 'comentario v32'); });
    var b = asUser(U.benja, function () { return client('tasksSetPrivacy', [id], false); });
    isPartial(b, 'publicar');
    assertNoDates(b, 'tasksSetPrivacy()');
    ok(!('lastId' in b), 'sin lastId');
    // Mismas colecciones que bootstrap para ese usuario
    var full = asUser(U.benja, function () { return MOCK.strictClone(bootstrap()); });
    ['projects', 'tasks', 'cascade', 'comments'].forEach(function (k) { deepEq(b[k], full[k], k + ' = bootstrap'); });
    ok(asUser(U.ignacio, function () { return bundleGestion_().comments.some(function (c) { return c.ref === id; }); }), 'compartida: su comentario viaja a otros');
    var b2 = asUser(U.benja, function () { return client('tasksSetPrivacy', [id], true); });
    ok(has(b2, 'tasks', id), 'Benja la sigue viendo');
    ok(!asUser(U.ignacio, function () { return has(bundleGestion_(), 'tasks', id); }), 'Ignacio ya no');
    ok(!asUser(U.ignacio, function () { return bundleGestion_().comments.some(function (c) { return c.ref === id; }); }), 'ni su comentario');
    // Las privadas del demo (de otra persona) no aparecen en el parcial de Benja
    var others = gRows('Tarea').filter(function (r) { return r.Privada === 'Sí' && r['Creado por'] !== U.benja && r.Responsable !== U.benja; });
    ok(others.length > 0, 'el demo tiene privadas ajenas');
    others.forEach(function (r) { ok(!has(b2, 'tasks', r.ID), 'privada ajena oculta: ' + r.ID); });
  });
})();
