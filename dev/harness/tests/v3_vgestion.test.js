/* v3 · VGestion (cliente): vista general (admin), página de pilar (proyectos + tareas a la vista) y Planificación (Gantt).
   Se evalúa el <script> real de Core.html + VGestion.html en un sandbox con stubs mínimos del navegador
   (document/window/google.script.run), sobre el bundle real del servidor simulado (datos demo). */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  // google.script.run que sólo registra las llamadas (nunca responde: lo que importa es el efecto inmediato)
  function fakeRun(calls) {
    var o = {};
    var px = new Proxy(o, { get: function (t, k) { return k in t ? t[k] : function () { calls.push({ fn: String(k), args: Array.prototype.slice.call(arguments) }); }; } });
    o.withSuccessHandler = function () { return px; };
    o.withFailureHandler = function () { return px; };
    return px;
  }
  function sandbox(bundle, route) {
    var calls = [];
    var noop = function () {};
    var el0 = { classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } }, style: {} };
    var doc = {
      addEventListener: noop, getElementById: function () { return null; }, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, documentElement: el0, body: el0, activeElement: null,
    };
    var win = { addEventListener: noop };
    var factory = new Function('document', 'window', 'google', 'navigator', 'localStorage', 'requestAnimationFrame', 'getComputedStyle',
      src('Core') + '\n' + src('VGestion') + '\n;return {' +
      ' VIEWS: VIEWS, ACTIONS: ACTIONS,' +
      ' init: function (b, r) { S = Object.assign({}, b, { ui: {}, route: r || null }); S.year = b.defaultYear; rebuildIndex(); },' +
      ' S: function () { return S; }, IDX: function () { return IDX; }, fn: function (n) { return eval(n); } };');
    var box = factory(doc, win, { script: { run: fakeRun(calls) } }, {}, undefined, noop, function () { return { getPropertyValue: function () { return ''; } }; });
    box.init(bundle, route || null);
    box.calls = calls;
    return box;
  }
  function demo() { fresh('demo'); return client('bootstrap'); }
  function route(name, pilar) { return { name: name, params: pilar ? { pilar: pilar } : {}, path: '' }; }
  function noJunk(html, label) {
    ok(typeof html === 'string' && html.length > 200, label + ': HTML vacío');
    ok(html.indexOf('undefined') < 0, label + ': aparece «undefined»');
    ok(!/\bNaN\b/.test(html), label + ': aparece «NaN»');
    ok(html.indexOf('[object Object]') < 0, label + ': aparece «[object Object]»');
  }
  function count(html, re) { return (html.match(re) || []).length; }

  test('v3 vgestion · vistas: overview / pillar / plan anchas, con mount; sin «gestion.mine»', function () {
    need('bootstrap');
    var box = sandbox(demo());
    ['gestion.overview', 'gestion.pillar', 'gestion.plan'].forEach(function (n) {
      var v = box.VIEWS[n];
      ok(v && typeof v.render === 'function', n + ' registrada');
      eq(v.wide, true, n + ' es ancha');
      ok(typeof v.mount === 'function', n + ' tiene mount');
    });
    ok(!box.VIEWS['gestion.mine'], 'gestion.mine ya no existe (la lista personal es de TodoPanel)');
    ['gestion.addTask', 'gestion.addOpen', 'gestion.planZoom', 'gestion.planToggle', 'gestion.mineOnly', 'gestion.catalog'].forEach(function (a) {
      ok(typeof box.ACTIONS[a] === 'function', 'acción ' + a);
    });
    ok(src('VGestion').indexOf('#/avance') < 0, 'sin enlaces a Avance por período');
  });

  test('v3 vgestion · pilar: proyectos agrupados por Cascade con sus tareas pendientes, link discreto a Planificación', function () {
    var b = demo();
    var box = sandbox(b, route('gestion.pillar', 'nat'));
    var html = box.VIEWS['gestion.pillar'].render({ pilar: 'nat' });
    noJunk(html, 'pilar nat');
    ok(html.indexOf('href="#/gestion/nat/plan"') >= 0 && html.indexOf('data-lucide="chart-gantt"') >= 0, 'link «Planificación» con ícono chart-gantt');
    ok(html.indexOf('data-action="gestion.newTask" data-pilar="nat"') >= 0, 'botón Nueva tarea del pilar');
    ok(html.indexOf('data-action="gestion.newProject" data-pilar="nat"') >= 0, 'botón Nuevo proyecto del pilar');
    ok(!/statCard|data-countup/.test(html), 'sin franja de KPIs');
    // Cada grupo Cascade con proyectos aparece como sección
    var S = box.S(), IDX = box.IDX();
    var groupsWith = (IDX.cascadeGroups.nat || []).filter(function (g) {
      return S.projects.some(function (p) {
        if (p.pilar !== 'nat' || p.estado === 'Cerrado' || !p.cascade) return false;
        var c = IDX.cascade.get(p.cascade);
        return c && (c.id === g.id || c.padre === g.id);
      });
    });
    ok(groupsWith.length > 0, 'hay grupos con proyectos en los datos demo');
    groupsWith.forEach(function (g) { ok(html.indexOf('title="' + box.fn('esc')(g.nombre) + '"') >= 0, 'sección del grupo ' + g.nombre); });
    // Las tareas pendientes de un proyecto visible se ven como filas con check (hasta 4 + «+N más»)
    var withTasks = S.projects.filter(function (p) { return p.pilar === 'nat' && p.estado !== 'Cerrado' && (IDX.tasksByProject.get(p.id) || []).some(function (t) { return t.estado !== 'Realizada'; }); });
    ok(withTasks.length > 0, 'hay proyectos con tareas pendientes');
    withTasks.forEach(function (p) {
      ok(html.indexOf('data-vg-project="' + p.id + '"') >= 0, 'tarjeta de ' + p.nombre);
      var pend = (IDX.tasksByProject.get(p.id) || []).filter(function (t) { return t.estado !== 'Realizada'; });
      if (pend.length <= 4) pend.forEach(function (t) { ok(html.indexOf('data-task-row data-id="' + t.id + '"') >= 0, 'fila de ' + t.nombre); });
      else ok(html.indexOf('+' + (pend.length - 4) + ' más') >= 0, '«+N más» en ' + p.nombre);
    });
    ok(count(html, /data-action="task\.toggle"/g) > 0, 'checks con task.toggle (Core.checkButton)');
    ok(count(html, /class="task-title"/g) >= count(html, /data-action="task\.toggle"/g), 'cada fila con check tiene .task-title');
    // Proyectos sin tareas: línea compacta con «+» para agregar
    var empty = S.projects.filter(function (p) { return p.pilar === 'nat' && p.estado !== 'Cerrado' && !(IDX.tasksByProject.get(p.id) || []).length; });
    if (empty.length) ok(html.indexOf('data-action="gestion.addOpen" data-key="' + empty[0].id + '"') >= 0, 'compacto con «+»');
    // Pilar inexistente
    ok(box.VIEWS['gestion.pillar'].render({ pilar: 'zz' }).indexOf('No encontramos este pilar') >= 0, 'pilar inexistente');
    ok(box.VIEWS['gestion.plan'].render({ pilar: 'zz' }).indexOf('No encontramos este pilar') >= 0, 'plan de pilar inexistente');
  });

  test('v3 vgestion · escapa textos y muestra el candado en tareas privadas', function () {
    var b = demo();
    var p = b.projects.find(function (x) { return x.pilar === 'cc'; });
    ok(p, 'proyecto cc');
    p.nombre = '<img src=x onerror=alert(1)>';
    b.tasks.push({ id: 'TSK-xss00001', pilar: 'cc', proyecto: p.id, nombre: '<script>alert(2)</script>', detalle: '', resp: U.gonzalo, fecha: day(2),
      estado: 'Pendiente', cascade: '', evidencias: [], cierre: '', completada: '', creadoPor: U.gonzalo, creado: new Date().toISOString(),
      actualizadoPor: U.gonzalo, actualizado: new Date().toISOString(), privada: true, avisar: true, orden: 0 });
    var box = sandbox(b, route('gestion.pillar', 'cc'));
    var html = box.VIEWS['gestion.pillar'].render({ pilar: 'cc' });
    ok(html.indexOf('<img src=x') < 0 && html.indexOf('<script>alert') < 0, 'sin HTML crudo de datos');
    ok(html.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, 'nombre de proyecto escapado');
    var i = html.indexOf('data-task-row data-id="TSK-xss00001"');
    ok(i >= 0, 'fila de la tarea privada');
    var next = html.indexOf('data-task-row', i + 20);
    var row = html.slice(i, next < 0 ? html.length : next);
    ok(row.indexOf('data-lucide="lock"') >= 0, 'candado en la fila privada');
    var plan = box.VIEWS['gestion.plan'].render({ pilar: 'cc' });
    ok(plan.indexOf('<img src=x') < 0, 'plan: sin HTML crudo');
  });

  test('v3 vgestion · alta rápida en un proyecto: aparece al instante y el servidor acepta el payload', function () {
    need('gSave');
    var b = demo();
    var box = sandbox(b, route('gestion.pillar', 'ec'));
    var S = box.S(), IDX = box.IDX();
    var p = S.projects.find(function (x) { return x.pilar === 'ec' && x.estado !== 'Cerrado'; });
    ok(p, 'proyecto ec abierto');
    var el = { value: '  Llamar a la planta de Maipú  ', dataset: {} };
    var before = S.tasks.length;
    // v3.1 (SPEC §14.2): Enter pregunta la fecha con pickDate; aquí se elige «Sin fecha» al instante.
    box.fn('pickDate = function () { return { then: function (ok) { ok(""); } }; }');
    box.ACTIONS['gestion.addTask']({ key: p.id }, el);
    S = box.S();
    eq(S.tasks.length, before + 1, 'la tarea aparece al instante');
    var tmp = S.tasks[S.tasks.length - 1];
    ok(/^tmp-/i.test(tmp.id) && tmp._tmp, 'id temporal');
    eq(tmp.nombre, 'Llamar a la planta de Maipú');
    eq(el.value, '', 'el input queda vacío para la siguiente');
    eq(S.ui.gestion.addOpen, p.id, 'el input sigue abierto');
    var call = box.calls.filter(function (c) { return c.fn === 'gSave'; })[0];
    ok(call, 'gSave enviado');
    var ent = call.args[0];
    eq(ent.tipo, 'Tarea'); eq(ent.proyecto, p.id); eq(ent.pilar, 'ec'); eq(ent.resp, U.gonzalo, 'responsable: yo');
    var c = p.cascade ? IDX.cascade.get(p.cascade) : null;
    eq(ent.cascade, c && c.padre ? c.id : '', 'hereda sólo un indicador hoja');
    // El servidor real acepta exactamente ese payload
    var r = client('gSave', ent);
    var t = r.tasks.find(function (x) { return x.id === r.lastId; });
    ok(t && t.proyecto === p.id && t.pilar === 'ec' && t.estado === 'Pendiente', 'creada en el proyecto');
    // La fila temporal no ofrece check (evita completar algo que aún no existe en el servidor)
    var html = box.VIEWS['gestion.pillar'].render({ pilar: 'ec' });
    var i = html.indexOf('data-task-row data-id="' + tmp.id + '"');
    ok(i >= 0, 'fila temporal visible');
    var row = html.slice(i, html.indexOf('</div></div>', i));
    ok(row.indexOf('task.toggle') < 0 && row.indexOf('aria-busy="true"') >= 0, 'fila temporal sin check');
    // Sin proyecto («Tareas sin proyecto» del pilar)
    box.ACTIONS['gestion.addTask']({ key: 'sp-nat' }, { value: 'Suelta', dataset: {} });
    var ent2 = box.calls.filter(function (c2) { return c2.fn === 'gSave'; })[1].args[0];
    eq(ent2.proyecto, ''); eq(ent2.pilar, 'nat');
    var r2 = client('gSave', ent2);
    eq(r2.tasks.find(function (x) { return x.id === r2.lastId; }).pilar, 'nat');
    // Proyecto cerrado: no envía nada
    var n = box.calls.length;
    var closed = S.projects.find(function (x) { return x.pilar === 'ec'; });
    closed.estado = 'Cerrado';
    box.ACTIONS['gestion.addTask']({ key: closed.id }, { value: 'No debería', dataset: {} });
    eq(box.calls.length, n, 'proyecto cerrado: sin llamada');
    // Vacío: no envía nada
    box.ACTIONS['gestion.addTask']({ key: p.id }, { value: '   ', dataset: {} });
    eq(box.calls.length, n, 'texto vacío: sin llamada');
  });

  test('v3 vgestion · «Sólo lo mío» y búsqueda filtran proyectos y tareas del pilar', function () {
    var b = demo();
    var box = sandbox(b, route('gestion.pillar', 'nat'));
    var u = box.fn('vgUi')();
    var isMine = box.fn('isMine');
    var all = box.fn('vgPillarData')('nat');
    var nAll = all.groups.reduce(function (a, G) { return a + G.items.length; }, 0);
    u.mineOnly = true;
    var mine = box.fn('vgPillarData')('nat');
    var me = U.gonzalo;
    mine.groups.forEach(function (G) {
      G.items.forEach(function (it) {
        if (it.p.resp === me) return;
        ok(it.pend.length + it.done.length > 0, 'proyecto ajeno sólo si tengo tareas: ' + it.p.nombre);
        it.pend.concat(it.done).forEach(function (t) { ok(isMine(t), 'sólo mis tareas en ' + it.p.nombre); });
      });
    });
    ok(mine.groups.reduce(function (a, G) { return a + G.items.length; }, 0) <= nAll, 'filtra');
    u.mineOnly = false;
    // Búsqueda por el nombre de una tarea: muestra su proyecto con esa tarea
    var t = box.S().tasks.find(function (x) { return x.pilar === 'nat' && x.proyecto && x.estado !== 'Realizada'; });
    ok(t, 'tarea nat con proyecto');
    u.pq.nat = t.nombre;
    var q = box.fn('vgPillarData')('nat');
    var hit = null;
    q.groups.forEach(function (G) { G.items.forEach(function (it) { if (it.p.id === t.proyecto) hit = it; }); });
    ok(hit && hit.pend.some(function (x) { return x.id === t.id; }), 'la búsqueda encuentra la tarea dentro de su proyecto');
    u.pq.nat = '';
    // Un proyecto cerrado con tareas pendientes sigue a la vista como tarjeta (no se pierde en «Ver cerrados»)
    var pc = box.S().projects.find(function (x) { return x.id === t.proyecto; });
    pc.estado = 'Cerrado';
    var dc = box.fn('vgPillarData')('nat');
    ok(dc.groups.some(function (G) { return G.items.some(function (it) { return it.p.id === pc.id; }); }), 'cerrado con pendientes: visible');
    ok(!dc.closed.some(function (it) { return it.p.id === pc.id; }), 'no queda escondido entre los cerrados');
    u.pq.nat = 'zzzz-no-existe';
    var html = box.VIEWS['gestion.pillar'].render({ pilar: 'nat' });
    ok(html.indexOf('Nada por aquí con ese filtro') >= 0, 'estado vacío amable con filtro');
  });

  test('v3 vgestion · planificación: tramos de tareas y de proyectos', function () {
    var box = sandbox(demo());
    var span = box.fn('vgTaskSpan'), proj = box.fn('vgPlanProject');
    var iso = function (ymd, h) { var p = ymd.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], h || 12, 0, 0).toISOString(); };
    deepEq(span({ estado: 'Pendiente', creado: iso('2026-09-01'), fecha: '2026-10-15' }), { s: '2026-09-01', e: '2026-10-15', dot: false }, 'creada → vence');
    // Creada a las 23:30 de Chile (ya es otro día en UTC): cuenta el día local
    deepEq(span({ estado: 'Pendiente', creado: iso('2026-09-01', 23), fecha: '2026-09-20' }).s, '2026-09-01', 'fecha local de creación');
    deepEq(span({ estado: 'Realizada', creado: iso('2026-09-01'), fecha: '2026-12-01', completada: '2026-09-10' }), { s: '2026-09-01', e: '2026-09-10', dot: false }, 'lista: hasta que se completó');
    deepEq(span({ estado: 'Pendiente', creado: iso('2026-09-05'), fecha: '' }), { s: '2026-09-05', e: '2026-09-05', dot: true }, 'sin fecha → punto');
    deepEq(span({ estado: 'Pendiente', creado: iso('2026-09-05'), fecha: '2026-09-01' }), { s: '2026-09-01', e: '2026-09-01', dot: false }, 'vence antes de crearse');
    var tasks = [
      { estado: 'Realizada', creado: iso('2026-03-01'), fecha: '2026-04-01', completada: '2026-03-20' },
      { estado: 'Pendiente', creado: iso('2026-05-01'), fecha: '2026-11-30' },
    ];
    var r = proj({ id: 'PRJ-1', nombre: 'P', inicio: '', fin: '', creado: iso('2026-01-01') }, tasks);
    eq(r.s, '2026-03-01'); eq(r.e, '2026-11-30'); eq(r.est, true, 'estimado por sus tareas'); eq(r.pct, 50); eq(r.dot, false);
    r = proj({ id: 'PRJ-2', nombre: 'P', inicio: '2026-02-01', fin: '2026-12-31' }, tasks);
    eq(r.s, '2026-02-01'); eq(r.e, '2026-12-31'); eq(r.est, false, 'fechas explícitas');
    r = proj({ id: 'PRJ-3', nombre: 'P', inicio: '', fin: '', creado: iso('2026-01-01') }, []);
    eq(r.dot, true, 'sin fechas ni tareas: no se inventa una barra'); eq(r.s, ''); eq(r.e, '');
    r = proj({ id: 'PRJ-4', nombre: 'P', inicio: '2026-12-01', fin: '2026-02-01' }, []);
    ok(r.s <= r.e, 'fechas invertidas se ordenan');
  });

  test('v3 vgestion · planificación: rango con hoy y meses completos; barras dentro de 0–100 %', function () {
    var b = demo();
    var box = sandbox(b, route('gestion.plan', 'nat'));
    var range = box.fn('vgPlanRange'), today = box.fn('todayStr')();
    ['mes', 'trimestre', 'anio'].forEach(function (z) {
      var R = range([{ s: '2026-03-10', e: '2026-04-02' }], z);
      ok(R.a <= today && R.b >= today, z + ': incluye hoy');
      ok(/-01$/.test(R.a), z + ': parte el día 1');
      eq(box.fn('addDays')(R.b, 1).slice(8), '01', z + ': termina a fin de mes');
      ok(R.a <= '2026-03-10', z + ': incluye el inicio');
      eq(R.days, box.fn('vgDays')(R.a, R.b) + 1, z + ': días');
    });
    var Ry = range([], 'anio');
    ok(Ry.a <= box.S().year + '-01-01' && Ry.b >= box.S().year + '-12-31', 'zoom Año cubre el año seleccionado');
    var Rbig = range([{ s: '2010-01-01', e: '2040-01-01' }], 'trimestre');
    ok(Rbig.days < 1900, 'tope de ~5 años');
    // Desplegar tareas no cambia el rango (si cambiara, la vista saltaría de vuelta a «hoy»)
    var u = box.fn('vgUi')();
    var keyOf = function (h) { var m = h.match(/data-vg-gantt="([^"]+)"/); return m && m[1]; };
    var k0 = keyOf(box.VIEWS['gestion.plan'].render({ pilar: 'nat' }));
    box.S().projects.forEach(function (p) { u.plan.open[p.id] = true; });
    eq(keyOf(box.VIEWS['gestion.plan'].render({ pilar: 'nat' })), k0, 'mismo rango plegado y desplegado');
    // Render completo en los tres zoom, con todo desplegado
    ['mes', 'trimestre', 'anio'].forEach(function (z) {
      u.plan.zoom = z;
      var html = box.VIEWS['gestion.plan'].render({ pilar: 'nat' });
      noJunk(html, 'plan ' + z);
      ok(html.indexOf('data-vg-gantt="nat:' + z + ':') >= 0, z + ': contenedor del Gantt');
      ok(html.indexOf('>Hoy</span>') >= 0, z + ': marca de hoy');
      ok(html.indexOf('href="#/gestion/nat"') >= 0, z + ': volver al pilar');
      var lefts = (html.match(/left:(-?[\d.]+)%/g) || []).map(function (s) { return parseFloat(s.slice(5)); });
      var widths = (html.match(/width:(-?[\d.]+)%/g) || []).map(function (s) { return parseFloat(s.slice(6)); });
      ok(lefts.length > 10, z + ': hay posiciones');
      lefts.forEach(function (v) { ok(v >= 0 && v <= 100.0001, z + ': left fuera de rango ' + v); });
      widths.forEach(function (v) { ok(v >= 0 && v <= 100.0001, z + ': width fuera de rango ' + v); });
      ok(count(html, /data-action="gestion\.openTask"/g) > 0 && count(html, /data-action="gestion\.openProject"/g) > 0, z + ': barras clicables');
    });
    // Pilar sin nada que planificar (filtro «Sólo lo mío» como alguien sin tareas)
    var S = box.S();
    S.me = { email: 'nadie@copec.cl', name: 'Nadie', admin: false };
    u.mineOnly = true;
    var empty = box.VIEWS['gestion.plan'].render({ pilar: 'nat' });
    ok(empty.indexOf('Nada tuyo por planificar aquí') >= 0, 'estado vacío con «Sólo lo mío»');
  });

  test('v3 vgestion · vista general: saludo, pilares y franja de solicitudes sólo para el administrador', function () {
    var b = demo();
    b.solicitudes = [
      { id: 'SOL-1', estado: 'Pendiente', montoClp: 13473363, recibido: '2026-10-02T14:20:00.000Z', pr: 'PR71524', nombre: 'Piloto Green Energy en Transcom', solicitante: 'GONZALO ALEJANDRO CORTES UARAC' },
      { id: 'SOL-2', estado: 'Vinculada', montoClp: 500000, recibido: '2026-09-02T14:20:00.000Z', pr: 'PR1', nombre: 'Otra', solicitante: 'X' },
    ];
    var box = sandbox(b, route('gestion.overview'));
    var html = box.VIEWS['gestion.overview'].render({});
    noJunk(html, 'overview');
    ok(html.indexOf('href="#/presupuesto/solicitudes"') >= 0 && html.indexOf('1 por revisar') >= 0, 'franja con 1 por revisar');
    ok(html.indexOf('PR71524 · Piloto Green Energy en Transcom') >= 0, 'muestra la última solicitud');
    b.pillars.forEach(function (p) { ok(html.indexOf('href="#/gestion/' + p.key + '"') >= 0, 'tarjeta del pilar ' + p.key); });
    ok(html.indexOf('Lo que viene') >= 0 && html.indexOf('Cómo va el equipo') >= 0, 'secciones');
    ok(html.indexOf('Actividad reciente') < 0, 'v3.1: sin «Actividad reciente» (no ayuda a decidir)');
    ok(!/statCard|data-countup/.test(html), 'sin KPIs pesados');
    var b2 = demo();
    b2.me = Object.assign({}, b2.me, { admin: false });
    b2.solicitudes = b.solicitudes;
    var box2 = sandbox(b2, route('gestion.overview'));
    ok(box2.VIEWS['gestion.overview'].render({}).indexOf('Solicitudes de compra') < 0, 'sin franja si no es administrador');
  });
})();
