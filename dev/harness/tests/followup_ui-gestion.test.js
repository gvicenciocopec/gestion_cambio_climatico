/* Seguimiento ui-gestion (FGestion / VPresupuesto / VGestion):
   - D1-01 (cliente): toda edición de Proyecto/Tarea con gSave envía base = "actualizado" visto al abrir; nunca al crear.
   - PX-06: "Administrar catálogo" / "Administrar indicadores" abren el catálogo Cascade en el pilar (e indicador) del contexto.
   Las funciones del cliente se extraen del .html (MOCK.files) y se evalúan con dependencias mínimas. */
(function () {
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  // Espera a que cambie el milisegundo: dos escrituras seguidas no comparten "Actualizado"
  function tick() { var t = Date.now(); while (Date.now() <= t) { /* espera activa */ } }

  // Fuente del archivo .html (sólo los bloques <script>)
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  // Recorta desde `start` hasta la llave que cierra el primer bloque { … } (ignora llaves en strings y comentarios //)
  function block(code, start, label) {
    var i = code.indexOf(start);
    ok(i >= 0, 'no encontré «' + (label || start) + '»');
    var j = code.indexOf('{', i), depth = 0, q = null;
    for (var k = j; k < code.length; k++) {
      var ch = code[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '/' && code[k + 1] === '/') { var nl = code.indexOf('\n', k); k = nl < 0 ? code.length : nl; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return code.slice(i, k + 1);
    }
    __fail('bloque sin cerrar: ' + (label || start));
  }
  function fn(code, name) { return block(code, 'function ' + name + '(', name); }

  // fgProjectPayload real, con fgCleanEv real y stubs de PIL / safeUrl / shortUrl
  function fgPayloadFn() {
    var code = src('FGestion');
    return new Function('PIL', 'safeUrl', 'shortUrl',
      fn(code, 'fgPilarKey') + '\n' + fn(code, 'fgCleanEv') + '\n' + fn(code, 'fgProjectPayload') + '\nreturn fgProjectPayload;')(
      function (k) { return k ? { key: k } : null; },
      function (u) { return /^https:\/\//.test(String(u || '')) ? String(u) : ''; },
      function (u) { return String(u); });
  }
  function budPayloadFn() {
    return new Function(fn(src('VPresupuesto'), 'budProjectPayload') + '\nreturn budProjectPayload;')();
  }

  // v3.4 (SPEC §18, cambio intencional): el usuario prefiere agilidad. El cliente ya no envía la versión (base):
  // los cambios se ven al instante y el último gana; al editar una tarea sólo viajan los campos cambiados.
  test('ui-gestion · v3.4 fgProjectPayload / budProjectPayload: sin base, al crear ni al editar', function () {
    var pay = fgPayloadFn();
    var nuevo = pay({}, { pilar: 'ec', nombre: 'Nuevo', base: '2026-01-01T00:00:00.000Z' });
    ok(!('base' in nuevo) && !('id' in nuevo), 'al crear: sin base ni id');
    var p = { id: 'PRJ-1', pilar: 'ec', nombre: 'P', lineas: ['L-1'], evidencias: [], actualizado: '2026-03-01T10:00:00.000Z' };
    var ed = pay(p, { estado: 'Activo' });
    eq(ed.id, 'PRJ-1'); ok(!('base' in ed), 'al editar tampoco');
    ok(!('base' in pay(p, { lineas: [], base: '2026-02-01T10:00:00.000Z' })), 'aunque over traiga base');
    ok(!('base' in budPayloadFn()(p, ['L-2'])), 'budProjectPayload (Presupuesto) tampoco');
  });

  test('ui-gestion · v3.4 payloads del cliente contra gSave: el último cambio gana; la API sigue aceptando base', function () {
    need('gSave', 'bootstrap');
    fresh('setup');
    var pay = fgPayloadFn(), bud = budPayloadFn();
    var created = client('gSave', pay({}, { pilar: 'ec', nombre: 'Proyecto v3.4', resp: U.ina, estado: 'Activo', anio: '' }));
    var p0 = find(created, 'projects', created.lastId);          // lo que ve Ina al abrir el formulario
    tick();
    var rb = asUser(U.benja, function () { return client('gSave', pay(p0, { detalle: 'De Benja' })); });
    var cur = find(rb, 'projects', p0.id);
    // Ina guarda con el formulario abierto antes del cambio de Benja: ya no hay conflicto, gana lo último
    tick();
    var ri = asUser(U.ina, function () { return client('gSave', pay(p0, { detalle: 'De Ina' })); });
    eq(find(ri, 'projects', p0.id).detalle, 'De Ina', 'el último cambio gana');
    // Desde Presupuesto (vincular línea) con el proyecto viejo: también guarda
    tick();
    var r2 = asUser(U.ina, function () { return client('gSave', bud(p0, [])); });
    deepEq(find(r2, 'projects', p0.id).lineas, [], 'budProjectPayload guarda sin versión');
    // La API conserva el control de versión opcional para quien lo envíe explícitamente
    throws(function () {
      asUser(U.ina, function () { return client('gSave', Object.assign(pay(cur, { detalle: 'Con versión vieja' }), { base: cur.actualizado })); });
    }, /modific/i, 'base explícita y vieja → conflicto (API)');
  });

  test('ui-gestion · v3.4 formularios: sin versión; al editar una tarea sólo viaja lo que cambió', function () {
    var code = src('FGestion');
    var pf = fn(code, 'openProjectForm');
    ok(!/\bbase\b/.test(pf), 'openProjectForm sin base');
    ok(/optimistic\(/.test(pf) && /mutate\('gSave', \[fgProjectPayload\(cur, over\)\], \{ success: 'Proyecto creado' \}\)/.test(pf), 'editar al instante; crear espera el id');
    var tf = fn(code, 'openTaskForm');
    ok(/const orig = t \? fgTaskPayload\(t\) : null/.test(tf), 'openTaskForm guarda los valores al abrir');
    ok(/JSON\.stringify\(payload\[k\]\) !== JSON\.stringify\(orig\[k\]\)/.test(tf), 'al editar envía sólo lo cambiado');
    ok(!/payload\.base/.test(tf), 'openTaskForm sin base');
    var lk = fn(code, 'fgOpenLinkLines');
    ok(!/\bbase\b/.test(lk) && /optimistic\(/.test(lk), 'Vincular líneas: al instante y sin base');
    var un = block(code, "action('project.unlink'", 'project.unlink');
    ok(!/\bbase\b/.test(un) && /optimistic\(/.test(un), 'Desvincular: al instante y sin base');
    var qa = block(code, "action('project.quickadd'", 'project.quickadd');
    ok(!/\bbase\b/.test(qa), 'alta rápida sin base');
  });

  // Entorno mínimo para las acciones de catálogo
  function catalogEnv(cascade) {
    var env = { A: { pilar: 'cc', open: {}, casQ: 'viejo' }, went: [], opened: [], actions: {} };
    env.IDX = { cascade: new Map(cascade.map(function (c) { return [c.id, c]; })) };
    env.admState = function () { return env.A; };
    env.go = function (h) { env.went.push(h); };
    env.openCascadeItem = function (id) { env.opened.push(id); };
    env.action = function (name, f) { env.actions[name] = f; };
    return env;
  }

  test('ui-gestion · PX-06 FGestion: «Administrar indicadores» abre el catálogo en el pilar / indicador del selector', function () {
    var cas = [{ id: 'CAS-G', pilar: 'ec', padre: '' }, { id: 'CAS-K', pilar: 'ec', padre: 'CAS-G' }, { id: 'CAS-G2', pilar: 'nat', padre: '' }];
    var e = catalogEnv(cas);
    var open = new Function('IDX', 'admState', 'go', 'openCascadeItem', fn(src('FGestion'), 'fgOpenCatalog') + '\nreturn fgOpenCatalog;')(e.IDX, e.admState, e.go, e.openCascadeItem);
    open('ec', 'CAS-K');
    eq(e.A.pilar, 'ec'); eq(e.A.casQ, '', 'limpia la búsqueda'); eq(e.A.open['CAS-G'], true, 'grupo desplegado');
    deepEq(e.went, ['#/cascade']); deepEq(e.opened, ['CAS-K'], 'abre el indicador');
    e = catalogEnv(cas);
    open = new Function('IDX', 'admState', 'go', 'openCascadeItem', fn(src('FGestion'), 'fgOpenCatalog') + '\nreturn fgOpenCatalog;')(e.IDX, e.admState, e.go, e.openCascadeItem);
    open('ec', 'CAS-G2');   // un grupo (proyecto) de otro pilar: ese pilar, sin panel
    eq(e.A.pilar, 'nat'); eq(e.A.open['CAS-G2'], true); deepEq(e.opened, []);
    open('ec', '');
    eq(e.A.pilar, 'ec', 'sin indicador: el pilar del selector'); deepEq(e.went, ['#/cascade', '#/cascade']);
    // Sin VAdmin cargado igual navega
    var went = [];
    new Function('IDX', 'admState', 'go', 'openCascadeItem', fn(src('FGestion'), 'fgOpenCatalog') + '\nreturn fgOpenCatalog;')(e.IDX, undefined, function (h) { went.push(h); }, undefined)('ec', 'CAS-K');
    deepEq(went, ['#/cascade'], 'sin admState / openCascadeItem');
    // El selector conserva el pilar en data-pilar y el valor en data-cpk-value (lo que lee cascade.picker.manage)
    var mg = block(src('FGestion'), "action('cascade.picker.manage'", 'cascade.picker.manage');
    ok(mg.indexOf('fgOpenCatalog(pk, casId)') >= 0 && mg.indexOf('root.dataset.pilar') >= 0, 'manage usa el pilar y el indicador del selector');
  });

  test('ui-gestion · PX-06 VGestion: «Administrar catálogo» abre el catálogo en el pilar que se está viendo', function () {
    var code = src('VGestion');
    var e = catalogEnv([]);
    new Function('action', 'admState', 'go', block(code, "action('gestion.catalog'", 'gestion.catalog') + ');')(e.action, e.admState, e.go);
    ok(typeof e.actions['gestion.catalog'] === 'function', 'acción registrada');
    e.actions['gestion.catalog']({ pilar: 'nat' });
    eq(e.A.pilar, 'nat'); eq(e.A.casQ, ''); deepEq(e.went, ['#/cascade']);
    var tab = fn(code, 'vgCascadeTab');
    eq((tab.match(/action: 'gestion\.catalog', data: \{ pilar: p\.key \}/g) || []).length, 2, 'los dos botones pasan el pilar');
  });
})();
