/* v3.2 (SPEC §15) · TodoPanel y privacidad: el alta rápida crea privadas (públicas si el servidor no sabe quién soy),
   el candado de una privada la comparte con un clic, modo selección (clic, Shift+clic, «Todas») con UNA llamada
   tasksSetPrivacy, sin arrastre mientras se selecciona, Esc sale, y «Mover a proyecto» la deja pública.
   El JS real de Core.html + TodoPanel.html corre aislado (sin DOM real) con google.script.run simulado sobre el
   servidor emulado: cada llamada queda en cola y la prueba decide cuándo (y en qué orden) responde. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  function sandbox(opts) {
    opts = opts || {};
    var env = { calls: [], net: [], failNext: {}, store: {}, toasts: [] };
    function el() {
      return { setAttribute: function () {}, removeAttribute: function () {}, appendChild: function () {}, addEventListener: function () {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, style: {}, dataset: {} };
    }
    var doc = {
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function () { return null; },
      // El panel «está en pantalla» (si no, todoAfterRender apaga la selección como cuando se cierra la hoja)
      querySelector: function (sel) { return sel === '[data-todo-panel]' && env.panelShown !== false ? {} : null; },
      querySelectorAll: function () { return []; },
      createElement: el, body: el(), activeElement: null, contains: function () { return false; }, hidden: false,
      documentElement: { classList: { contains: function () { return false; }, toggle: function () {} }, style: {} },
    };
    env.doc = doc;
    var win = { addEventListener: function () {} };
    var ls = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(env.store, k) ? env.store[k] : null; },
      setItem: function (k, v) { env.store[k] = String(v); },
      removeItem: function (k) { delete env.store[k]; },
    };
    function chain(okFn, koFn) {
      var c = {
        withSuccessHandler: function (f) { return chain(f, koFn); },
        withFailureHandler: function (f) { return chain(okFn, f); },
      };
      ['bootstrap', 'gSave', 'taskReorder', 'taskComplete', 'taskReopen', 'tasksSetPrivacy'].forEach(function (name) {
        c[name] = function () {
          var args = Array.prototype.slice.call(arguments);
          env.calls.push({ fn: name, args: MOCK.strictClone(args, name + '(argumentos)') });
          env.net.push(function () {
            var res, err = null;
            if (env.failNext[name]) { err = new Error(env.failNext[name]); delete env.failNext[name]; }
            else { try { res = asUser(opts.user || U.gonzalo, function () { return client.apply(null, [name].concat(args)); }); } catch (e) { err = e; } }
            if (err) { if (koFn) koFn(err); } else if (okFn) okFn(res);
          });
        };
      });
      return c;
    }
    var timers = [];
    var code = src('Core') + '\n' + src('TodoPanel') + '\n;' +
      'toast = function (m, type, o) { __env.toasts.push({ m: m, type: type || "success", o: o || null }); };' +
      'return {' +
      ' get S() { return S; }, applyBundle: applyBundle, IDX: IDX, TODO_STATE: TODO_STATE, ACTIONS: ACTIONS, LS: LS, esc: esc,' +
      ' todoPanelHtml: todoPanelHtml, todoSheetDef: todoSheetDef, todoAdd: todoAdd, todoMoveTo: todoMoveTo, todoPendingIds: todoPendingIds,' +
      ' todoData: todoData, todoOnKeyDown: todoOnKeyDown, todoOnPointerDown: todoOnPointerDown, todoMoveBy: todoMoveBy, myTasks: myTasks,' +
      ' todoOnTouchStart: todoOnTouchStart, todoOnTouchMove: todoOnTouchMove, todoDropOnProject: todoDropOnProject };';
    var api = new Function('document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout',
      'requestAnimationFrame', 'cancelAnimationFrame', '__env', code)(
      doc, win, ls, { hash: '' }, { script: { run: chain(null, null) } },
      function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; }, function () {}, function () { return 0; }, function () {}, env);
    env.api = api;
    env.timers = timers;
    // Responde n llamadas pendientes (todas si n no se indica) y deja correr las promesas.
    env.flush = function (n) {
      var k = n == null ? env.net.length : n;
      for (var i = 0; i < k && env.net.length; i++) { env.net.shift()(); drainMicrotasks(); }
      drainMicrotasks();
    };
    // Responde la llamada pendiente número i (0 = la más antigua) antes que las demás.
    env.flushAt = function (i) { var f = env.net.splice(i, 1)[0]; if (f) { f(); drainMicrotasks(); } drainMicrotasks(); };
    env.input = function (value) {
      return { value: value, id: 'todo-add-aside', parentElement: null, focus: function () {}, classList: { toggle: function () {} } };
    };
    env.bundle = function () { return asUser(opts.user || U.gonzalo, function () { return client('bootstrap'); }); };
    env.load = function () { api.applyBundle(env.bundle()); return api; };
    env.count = function (fn) { return env.calls.filter(function (c) { return c.fn === fn; }).length; };
    env.last = function (fn) { var x = env.calls.filter(function (c) { return c.fn === fn; }); return x[x.length - 1]; };
    env.lastToast = function () { return env.toasts[env.toasts.length - 1] || null; };
    return env;
  }
  function count(hay, needle) { return String(hay).split(needle).length - 1; }
  // HTML de una fila del panel (hasta la siguiente fila).
  function rowOf(html, id) {
    var i = html.indexOf('data-todo-row="' + id + '"');
    ok(i >= 0, 'fila ' + id + ' en el panel');
    var r = html.slice(i), j = r.indexOf('role="listitem"');
    return j > 0 ? r.slice(0, j) : r;
  }
  function srvTask(id, user) {
    return asUser(user || U.gonzalo, function () { return bootstrap(); }).tasks.filter(function (t) { return t.id === id; })[0] || null;
  }
  // Crea tareas de Gonzalo en el servidor (antes de abrir el panel) y devuelve sus ids.
  function seedMine(names, extra) {
    return asUser(U.gonzalo, function () {
      return names.map(function (n) {
        var b = client('gSave', Object.assign({ tipo: 'Tarea', pilar: 'cc', nombre: n, resp: U.gonzalo }, extra || {}));
        return b.lastId;
      });
    });
  }

  test('v3.2 todo · alta rápida privada por defecto (pública si el servidor no sabe quién soy)', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    A.S.route = { name: 'gestion.pillar', params: { pilar: 'cc' }, path: 'gestion/cc' };
    A.todoPanelHtml('aside');
    A.todoAdd(env.input('Idea personal mañana'));
    var p = env.last('gSave').args[0];
    eq(p.privada, true, 'el alta rápida viaja privada');
    var tmp = A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); })[0];
    ok(tmp && tmp.privada === true, 'la temporal ya es privada');
    var trow = rowOf(A.todoPanelHtml('aside'), tmp.id);
    includes(trow, 'data-lucide="lock"', 'candado al instante');
    ok(trow.indexOf('todo.share') < 0, 'mientras se guarda, el candado no es un botón');
    env.flush();
    var real = A.S.tasks.filter(function (t) { return t.nombre === 'Idea personal'; })[0];
    ok(real && /^TSK-/.test(real.id) && real.privada === true, 'aterriza privada');
    eq(srvTask(real.id).privada, true, 'privada en la planilla');
    eq(srvTask(real.id, U.ina), null, 'el equipo no la ve');
    // Sin identidad del servidor (correo «desconocido», nombre elegido en Ajustes): se crea compartida
    var env2 = sandbox(), B = env2.load();
    B.S.me = { email: 'desconocido', name: '', admin: false };
    B.LS.set('whoami', U.gonzalo);
    B.S.route = { name: 'gestion.pillar', params: { pilar: 'cc' }, path: 'gestion/cc' };
    B.todoAdd(env2.input('Sin cuenta hoy'));
    eq(env2.count('gSave'), 1, 'igual se crea');
    eq(env2.last('gSave').args[0].privada, false, 'pública: una privada sin dueño no la vería nadie');
    var tmp2 = B.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); })[0];
    eq(tmp2.privada, false, 'la temporal también');
  });

  test('v3.2 todo · el candado comparte con un clic: optimista, UNA llamada [id] false (clave privacy), con Deshacer', function () {
    need('bootstrap', 'gSave', 'tasksSetPrivacy');
    fresh('demo');
    var ids = seedMine(['Privada con candado'], { privada: true });
    var env = sandbox(), A = env.load();
    var id = ids[0];
    var html = A.todoPanelHtml('aside');
    var row = rowOf(html, id);
    includes(row, 'data-action="todo.share"', 'el candado es un botón');
    includes(row, 'title="Privada · clic para compartir"', 'tooltip');
    includes(row, 'aria-label="Privada · clic para compartir"');
    includes(row, 'data-lucide="lock-open"', 'al pasar el mouse se ve abierto');
    includes(row, 'absolute right-8 top-1/2', 'la barra flotante deja libre el candado');
    var pub = A.todoData().pending.filter(function (t) { return t.privada !== true && !/^tmp-/.test(t.id); })[0];
    if (pub) {
      var prow = rowOf(html, pub.id);
      ok(prow.indexOf('todo.share') < 0 && prow.indexOf('data-lucide="lock"') < 0, 'una pública no lleva candado');
      includes(prow, 'absolute right-1.5 top-1/2', 'barra flotante en su lugar de siempre');
    }
    A.ACTIONS['todo.share']({ id: id });
    eq(A.IDX.task.get(id).privada, false, 'optimista: pública al instante');
    ok(rowOf(A.todoPanelHtml('aside'), id).indexOf('data-lucide="lock"') < 0, 'el candado desaparece');
    eq(env.count('tasksSetPrivacy'), 1, 'una llamada');
    deepEq(env.last('tasksSetPrivacy').args, [[id], false], 'tasksSetPrivacy([id], false)');
    eq(env.count('gSave'), 0, 'no pasa por gSave');
    eq(env.toasts.length, 0, 'el aviso espera la confirmación');
    env.flush();
    eq(srvTask(id).privada, false, 'pública en la planilla');
    ok(srvTask(id, U.ina), 'ahora el equipo la ve');
    eq(A.IDX.task.get(id).privada, false, 'sigue pública con los datos del servidor');
    var t = env.lastToast();
    ok(t && t.m === 'Ahora la ve el equipo' && t.type === 'success', 'aviso corto');
    ok(t.o && t.o.actionLabel === 'Deshacer' && typeof t.o.onAction === 'function', 'con Deshacer');
    eq(A.TODO_STATE.privFlying, 0); deepEq(A.TODO_STATE.priv, {}, 'sin cambios en vuelo');
    // Deshacer: vuelve a privada (otra llamada)
    t.o.onAction();
    eq(A.IDX.task.get(id).privada, true, 'Deshacer: privada al instante');
    deepEq(env.last('tasksSetPrivacy').args, [[id], true]);
    env.flush();
    eq(srvTask(id).privada, true, 'privada otra vez en la planilla');
    // Una pública no hace nada
    var n = env.count('tasksSetPrivacy');
    A.ACTIONS['todo.share']({ id: pub ? pub.id : 'TSK-00000000' });
    eq(env.count('tasksSetPrivacy'), n, 'sin llamada para una pública (o inexistente)');
  });

  test('v3.2 todo · modo selección: casillas, «Todas», barra; UNA llamada con todas las seleccionadas', function () {
    need('bootstrap', 'tasksSetPrivacy');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 4, 'hay al menos 4 pendientes');
    var h0 = A.todoPanelHtml('aside');
    includes(h0, 'id="todo-sel-aside" data-action="todo.select" aria-pressed="false" title="Seleccionar"', 'control discreto en el encabezado');
    includes(h0, 'data-lucide="list-checks"');
    // v3.6 (SPEC §20): sin asa; la fila entera se arrastra y la barra trae «Personas»
    ok(h0.indexOf('data-todo-grip') < 0 && h0.indexOf('data-action="todo.up"') < 0, 'sin asa ni flechas');
    includes(h0, 'data-action="todo.people"', 'fuera del modo: botón Personas');
    ok(h0.indexOf('role="checkbox"') < 0 && h0.indexOf('data-todo-selbar') < 0, 'fuera del modo: sin casillas ni barra');
    A.ACTIONS['todo.select']({});
    ok(A.TODO_STATE.select, 'modo selección');
    var h = A.todoPanelHtml('aside');
    includes(h, 'aria-pressed="true" title="Terminar selección (Esc)"', 'el control queda activo');
    eq(count(h, 'data-action="todo.pick" data-id='), ids.length * 2, 'cada fila (y su casilla) marca/desmarca');
    eq(count(h, 'role="checkbox"'), ids.length + 1, 'una casilla por pendiente + «Todas»');
    includes(h, '>Todas</span>');
    includes(h, 'aria-checked="false" id="todo-all-aside"', '«Todas» sin marcar');
    ok(h.indexOf('data-todo-grip') < 0, 'sin asas: no se arrastra mientras se selecciona');
    ok(h.indexOf('data-action="todo.up"') < 0 && h.indexOf('data-action="todo.share"') < 0, 'sin herramientas ni candado-botón');
    ok(h.indexOf('data-todo-add') < 0, '«Todas» ocupa el lugar del alta rápida');
    ok(h.indexOf('todo.doneToggle') < 0, 'las realizadas se esconden');
    includes(h, 'data-todo-selbar', 'barra inferior');
    includes(h, '0 seleccionadas');
    ['Hacer públicas', 'Hacer privadas', '>Cancelar<'].forEach(function (s) { includes(h, s); });
    includes(h, 'data-value="0" aria-disabled="true"', 'sin selección: acciones deshabilitadas');
    // Marcar tres → Hacer privadas
    A.ACTIONS['todo.pick']({ id: ids[0] }, null, { shiftKey: false });
    A.ACTIONS['todo.pick']({ id: ids[2] }, null, { shiftKey: false });
    A.ACTIONS['todo.pick']({ id: ids[3] }, null, {});
    var h2 = A.todoPanelHtml('aside');
    includes(h2, '3 seleccionadas');
    includes(rowOf(h2, ids[0]), 'role="checkbox" aria-checked="true"');
    includes(rowOf(h2, ids[1]), 'role="checkbox" aria-checked="false"');
    includes(h2, 'aria-checked="mixed" id="todo-all-aside"', '«Todas» a medias');
    A.ACTIONS['todo.selApply']({ value: '1' });
    eq(env.count('tasksSetPrivacy'), 1, 'UNA llamada');
    deepEq(env.last('tasksSetPrivacy').args, [[ids[0], ids[2], ids[3]], true], 'con todas las seleccionadas, en el orden de la lista');
    ok(!A.TODO_STATE.select, 'sale del modo selección');
    ok([ids[0], ids[2], ids[3]].every(function (id) { return A.IDX.task.get(id).privada === true; }), 'optimista: privadas al instante');
    env.flush();
    ok([ids[0], ids[2], ids[3]].every(function (id) { return srvTask(id).privada === true; }), 'privadas en la planilla');
    // Todas → Hacer públicas: una sola llamada con TODOS los ids pendientes
    A.ACTIONS['todo.select']({});
    A.ACTIONS['todo.selAll']({});
    var h3 = A.todoPanelHtml('aside');
    includes(h3, ids.length + ' seleccionadas');
    includes(h3, 'aria-checked="true" id="todo-all-aside"', '«Todas» marcada');
    var n0 = env.count('tasksSetPrivacy');
    A.ACTIONS['todo.selApply']({ value: '0' });
    eq(env.count('tasksSetPrivacy'), n0 + 1, 'UNA llamada');
    deepEq(env.last('tasksSetPrivacy').args, [ids, false], 'todas las pendientes');
    assertNoDates(env.last('tasksSetPrivacy').args, 'tasksSetPrivacy');
    env.flush();
    ok(ids.every(function (id) { return srvTask(id).privada === false; }), 'públicas en la planilla');
    var t = env.lastToast();
    ok(t && t.type === 'success' && /equipo/.test(t.m), 'aviso al confirmar');
    // Cancelar sale sin llamar
    A.ACTIONS['todo.select']({});
    A.ACTIONS['todo.pick']({ id: ids[1] }, null, {});
    var n1 = env.count('tasksSetPrivacy');
    A.ACTIONS['todo.selCancel']({});
    ok(!A.TODO_STATE.select, 'Cancelar apaga el modo');
    eq(env.count('tasksSetPrivacy'), n1, 'Cancelar no llama al servidor');
    // El mismo control también lo apaga
    A.ACTIONS['todo.select']({}); A.ACTIONS['todo.select']({});
    ok(!A.TODO_STATE.select, 'el control alterna');
  });

  test('v3.2 todo · selección: Shift+clic marca rangos, «Todas» alterna; acciones deshabilitadas si no cambian nada', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 5, 'hay al menos 5 pendientes');
    function picked() { return ids.filter(function (id) { return A.TODO_STATE.select.ids.has(id); }); }
    A.ACTIONS['todo.select']({});
    A.ACTIONS['todo.pick']({ id: ids[1] }, null, { shiftKey: false });
    A.ACTIONS['todo.pick']({ id: ids[4] }, null, { shiftKey: true });
    deepEq(picked(), [ids[1], ids[2], ids[3], ids[4]], 'Shift+clic: rango hacia abajo');
    A.ACTIONS['todo.pick']({ id: ids[2] }, null, { shiftKey: true });
    deepEq(picked(), [ids[1]], 'Shift+clic en una marcada: desmarca el rango desde la última tocada');
    A.ACTIONS['todo.pick']({ id: ids[0] }, null, { shiftKey: true });
    deepEq(picked(), [ids[0], ids[1], ids[2]], 'rango hacia arriba');
    A.ACTIONS['todo.pick']({ id: ids[0] }, null, {});
    deepEq(picked(), [ids[1], ids[2]], 'clic simple: sólo esa');
    A.ACTIONS['todo.selAll']({});
    deepEq(picked(), ids, '«Todas»');
    A.ACTIONS['todo.selAll']({});
    deepEq(picked(), [], 'otra vez «Todas» = ninguna');
    A.ACTIONS['todo.pick']({ id: ids[3] }, null, { shiftKey: true });
    deepEq(picked(), [ids[3]], 'Shift sin punto de partida = clic simple');
    // Si todas las elegidas ya son públicas, «Hacer públicas» no hace nada (y lo dice en el tooltip)
    ids.forEach(function (id) { A.IDX.task.get(id).privada = false; });
    var h = A.todoPanelHtml('aside');
    includes(h, 'data-value="0" aria-disabled="true" title="Ya las ve el equipo"');
    ok(h.indexOf('data-value="1" aria-disabled') < 0, '«Hacer privadas» disponible');
    A.ACTIONS['todo.selApply']({ value: '0' });
    eq(env.count('tasksSetPrivacy'), 0, 'sin llamadas inútiles');
    ok(A.TODO_STATE.select, 'sigue seleccionando');
    // Sin identidad del servidor no se puede hacer privadas
    A.S.me = { email: 'desconocido', name: '', admin: false };
    A.LS.set('whoami', U.gonzalo);
    var h2 = A.todoPanelHtml('aside');
    includes(h2, 'data-value="1" aria-disabled="true" title="No pude identificar tu cuenta de Google"');
    A.ACTIONS['todo.selApply']({ value: '1' });
    eq(env.count('tasksSetPrivacy'), 0, 'no intenta hacerlas privadas');
    // Las seleccionadas que dejan de estar pendientes salen de la selección; sin pendientes el modo se apaga
    A.S.me = { email: U.gonzalo, name: 'Gonzalo', admin: true };
    A.ACTIONS['todo.selAll']({});
    A.IDX.task.get(ids[0]).estado = 'Realizada';
    A.todoPanelHtml('aside');
    ok(!A.TODO_STATE.select.ids.has(ids[0]), 'una realizada deja la selección');
    A.S.tasks = [];
    A.todoPanelHtml('aside');
    ok(!A.TODO_STATE.select, 'lista vacía: el modo se apaga solo');
  });

  test('v3.2 todo · seleccionando no se arrastra ni se reordena; Esc sale (sin cerrar la hoja)', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 3);
    // v3.6 (SPEC §20): se toma la fila entera (no hay asa)
    var list = { dataset: { todoList: 'aside' } };
    var row = { dataset: { todoRow: ids[1] }, closest: function (s) { return s === '[data-todo-list]' ? list : null; }, setPointerCapture: function () {} };
    function down() {
      var prevented = 0;
      A.todoOnPointerDown({ target: { closest: function (s) { return s === '[data-todo-row]' ? row : null; } }, button: 0, pointerId: 1, pointerType: 'mouse',
        clientX: 20, clientY: 10, preventDefault: function () { prevented++; } });
      return prevented;
    }
    A.ACTIONS['todo.select']({});
    eq(down(), 0, 'la fila no reacciona mientras se selecciona');
    eq(A.TODO_STATE.drag, null, 'no empieza un arrastre');
    A.ACTIONS['todo.down']({ id: ids[0] });
    A.ACTIONS['todo.up']({ id: ids[2] });
    var altEv = { key: 'ArrowDown', altKey: true, preventDefault: function () { this.p = 1; }, stopPropagation: function () {},
      target: { tagName: 'BUTTON', dataset: {}, hasAttribute: function () { return true; },
        closest: function (s) { return s === '[data-todo-row]' ? { dataset: { todoRow: ids[0] }, closest: function (q) { return q === '[data-todo-panel]' ? { dataset: { todoPanel: 'aside' } } : q === '[data-todo-list]' ? {} : null; } } : null; } } };
    A.todoOnKeyDown(altEv);
    deepEq(A.todoPendingIds(), ids, 'ni ↑/↓ ni Alt+flechas reordenan');
    ok(!A.TODO_STATE.order, 'sin orden pendiente');
    // Esc: sale del modo y no deja pasar la tecla (la hoja no se cierra)
    var esc = { key: 'Escape', stopped: 0, prevented: 0, preventDefault: function () { this.prevented++; }, stopPropagation: function () { this.stopped++; },
      target: { tagName: 'BUTTON', dataset: {}, closest: function () { return null; } } };
    A.todoOnKeyDown(esc);
    ok(!A.TODO_STATE.select, 'Esc apaga la selección');
    ok(esc.stopped && esc.prevented, 'Esc consumido');
    // Fuera del modo, Esc sigue su camino y el asa vuelve a funcionar
    var esc2 = { key: 'Escape', stopped: 0, preventDefault: function () {}, stopPropagation: function () { this.stopped++; }, target: esc.target };
    A.todoOnKeyDown(esc2);
    eq(esc2.stopped, 0, 'sin selección, Esc no se toca');
    ok(down() > 0 && A.TODO_STATE.drag, 'fuera del modo se puede tomar la fila');
    A.TODO_STATE.drag = null;
    // Sin el panel en pantalla (hoja cerrada / otra vista) la selección no sobrevive
    A.ACTIONS['todo.select']({});
    ok(A.TODO_STATE.select);
    env.panelShown = false;
    A.todoPanelHtml('aside');
    A.ACTIONS['todo.selAll']({});              // redibuja → todoAfterRender ve que no hay panel
    ok(!A.TODO_STATE.select, 'se apaga si el panel no está');
  });

  test('v3.2 todo · hoja del celular: control en el encabezado, barra pegada abajo', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var def = A.todoSheetDef();
    includes(def.headerRight, 'id="todo-sel-sheet"', 'el control vive en el encabezado de la hoja');
    includes(def.headerRight, 'data-lucide="list-checks"');
    ok(def.body.indexOf('data-todo-selbar') < 0);
    A.ACTIONS['todo.select']({});
    var d2 = A.todoSheetDef();
    includes(d2.headerRight, 'aria-pressed="true"', 'activo');
    includes(d2.body, 'data-todo-selbar class="sticky -bottom-5', 'barra pegada al borde inferior');
    includes(d2.body, 'safe-area-inset-bottom', 'respeta el borde del teléfono');
    includes(d2.body, 'min-height:calc(100% + 2.5rem)', 'la hoja ocupa el alto: la barra queda abajo aunque la lista sea corta');
    includes(d2.body, 'id="todo-all-sheet"', '«Todas» arriba');
    includes(d2.body, 'dark:bg-zinc-900/95', 'modo oscuro');
  });

  test('v3.2 todo · mover a proyecto la deja pública («Ahora la ve el equipo»); «Sin proyecto» conserva la privacidad', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var ids = seedMine(['Privada para mover'], { privada: true });
    var env = sandbox(), A = env.load();
    var id = ids[0], t = A.IDX.task.get(id);
    eq(t.privada, true);
    var prj = A.S.projects.filter(function (p) { return p.estado === 'Activo'; })[0];
    ok(prj, 'hay un proyecto activo');
    A.todoMoveTo(id, prj.id);
    eq(A.IDX.task.get(id).privada, false, 'optimista: pública');
    eq(A.IDX.task.get(id).proyecto, prj.id);
    var p = env.last('gSave').args[0];
    eq(p.privada, false, 'gSave con privada:false explícito');
    eq(p.proyecto, prj.id);
    env.flush();
    var s = srvTask(id);
    eq(s.proyecto, prj.id); eq(s.privada, false, 'pública en la planilla');
    ok(srvTask(id, U.ina), 'el equipo la ve');
    var tt = env.lastToast();
    ok(tt && tt.type === 'success' && tt.m.indexOf('Movida a «' + prj.nombre + '»') === 0 && /Ahora la ve el equipo/.test(tt.m), 'aviso: «… Ahora la ve el equipo»');
    // Ya pública: el aviso no repite lo obvio
    var prj2 = A.S.projects.filter(function (x) { return x.estado === 'Activo' && x.id !== prj.id; })[0];
    if (prj2) {
      A.todoMoveTo(id, prj2.id);
      env.flush();
      eq(env.lastToast().m, 'Movida a «' + prj2.nombre + '»', 'sin «Ahora la ve el equipo» si ya lo era');
    }
    // «Sin proyecto» no cambia la privacidad
    var ids2 = seedMine(['Privada suelta'], { privada: true });
    var env2 = sandbox(), B = env2.load();
    B.todoMoveTo(ids2[0], '');
    ok(!env2.last('gSave'), 'ya estaba sin proyecto: nada que hacer');
    asUser(U.gonzalo, function () { client('gSave', { tipo: 'Tarea', id: ids2[0], proyecto: prj.id, privada: true }); });
    var env3 = sandbox(), C = env3.load();
    eq(C.IDX.task.get(ids2[0]).privada, true, 'privada dentro de un proyecto (elegida explícitamente)');
    C.todoMoveTo(ids2[0], '');
    eq(env3.last('gSave').args[0].privada, true, '«Sin proyecto» la deja privada');
    eq(env3.last('gSave').args[0].proyecto, '');
  });

  test('v3.2 todo · privacidad en vuelo: una respuesta que no trae el cambio no lo revierte; al final se recarga', function () {
    need('bootstrap', 'gSave', 'tasksSetPrivacy');
    fresh('demo');
    var ids = seedMine(['Candado uno', 'Candado dos'], { privada: true });
    var env = sandbox(), A = env.load();
    A.ACTIONS['todo.share']({ id: ids[0] });
    A.ACTIONS['todo.share']({ id: ids[1] });
    eq(env.count('tasksSetPrivacy'), 2, 'dos clics = dos llamadas');
    eq(A.TODO_STATE.privFlying, 2);
    // El servidor atiende primero la segunda: su respuesta (la más nueva, la que se aplica) no trae la primera
    env.flushAt(1);
    eq(srvTask(ids[0]).privada, true, 'en el servidor la primera aún no se guarda');
    var hp = A.todoPanelHtml('aside');                     // lo que hace el redibujo al llegar el bundle
    eq(A.IDX.task.get(ids[0]).privada, false, 'la primera sigue pública en pantalla');
    ok(rowOf(hp, ids[0]).indexOf('data-lucide="lock"') < 0, 'sin candado');
    ok(A.TODO_STATE.privDirty, 'la vista principal se redibuja una vez para ponerse al día');
    // Llega la primera (superada por la clave 'privacy': no se aplica) → se piden los datos reales
    var boots = env.count('bootstrap');
    env.flush(1);
    eq(A.TODO_STATE.privFlying, 0);
    deepEq(A.TODO_STATE.priv, {}, 'sin cambios en vuelo');
    eq(env.count('bootstrap'), boots + 1, 'hubo que corregir: se recargan los datos');
    env.flush();
    ok(A.IDX.task.get(ids[0]).privada === false && A.IDX.task.get(ids[1]).privada === false, 'ambas públicas con los datos reales');
    eq(env.toasts.filter(function (t) { return t.m === 'Ahora la ve el equipo'; }).length, 1, 'un solo aviso (el de la última llamada)');
    // Si falla, vuelve lo del servidor y no queda nada forzado
    var ids2 = seedMine(['Candado falla'], { privada: true });
    var env2 = sandbox(), B = env2.load();
    env2.failNext.tasksSetPrivacy = 'Sin conexión';
    B.ACTIONS['todo.share']({ id: ids2[0] });
    eq(B.IDX.task.get(ids2[0]).privada, false, 'optimista');
    env2.flush(1);
    eq(B.TODO_STATE.privFlying, 0); deepEq(B.TODO_STATE.priv, {});
    ok(env2.toasts.some(function (t) { return t.type === 'error'; }), 'Core avisa el error');
    env2.flush();
    eq(B.IDX.task.get(ids2[0]).privada, true, 'vuelve a privada (datos reales)');
  });
  /* ---------------- v3.6 (SPEC §20): Personas y arrastrar la fila entera ---------------- */

  test('v3.6 todo · fila: Personas · Mover · Editar (sin asa ni flechas); el menú ⋯ igual; avatares de las demás personas', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var ids = seedMine(['Con Ina'], { asignados: [U.ina] });
    var env = sandbox(), A = env.load();
    var h = A.todoPanelHtml('aside');
    var r = rowOf(h, ids[0]);
    ['todo.people', 'todo.move', 'todo.edit'].forEach(function (a) { includes(r, 'data-action="' + a + '"'); });
    ok(r.indexOf('data-todo-grip') < 0 && r.indexOf('todo.up') < 0 && r.indexOf('todo.down') < 0, 'sin asa ni flechas');
    ok(/title="También: Ina"/.test(r), 'avatar de Ina (la tarea también está en su lista)');
    var code = src('TodoPanel');
    var menu = code.slice(code.indexOf('function todoOpenMenu('), code.indexOf('/* ---------- Privacidad'));
    ok(/'Personas', 'todo\.people'/.test(menu) && /'Mover a proyecto', 'todo\.move'/.test(menu) && /'Editar', 'todo\.edit'/.test(menu), 'menú ⋯: Personas · Mover · Editar');
    ok(!/'Subir'|'Bajar'/.test(menu), 'sin Subir / Bajar');
    // Ina también la tiene en «Mis tareas»
    var envI = sandbox({ user: U.ina }), I = envI.load();
    ok(I.myTasks().some(function (t) { return t.id === ids[0]; }), 'aparece en la lista de Ina');
  });

  test('v3.6 todo · celular: mantener presionada toma la tarea; si el dedo se mueve antes es desplazamiento; no desde el check o la barra', function () {
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    var list = { dataset: { todoList: 'sheet' } };
    var row = { dataset: { todoRow: ids[0] }, isConnected: true, closest: function (s) { return s === '[data-todo-list]' ? list : null; } };
    function target(blocked) { return { closest: function (s) { return s === '[data-todo-row]' ? row : (blocked ? {} : null); } }; }
    A.todoOnTouchStart({ touches: [{ clientX: 50, clientY: 100 }], target: target() });
    ok(A.TODO_STATE.hold, 'empieza a contar el toque largo');
    eq(env.timers[env.timers.length - 1].ms, 400, 'espera ~0,4 s');
    A.todoOnTouchMove({ touches: [{ clientX: 52, clientY: 104 }], cancelable: true, preventDefault: function () {} });
    ok(A.TODO_STATE.hold, 'un temblor del dedo no lo cancela');
    A.todoOnTouchMove({ touches: [{ clientX: 50, clientY: 130 }], cancelable: true, preventDefault: function () {} });
    eq(A.TODO_STATE.hold, null, 'el dedo se movió: es un desplazamiento normal');
    A.todoOnTouchStart({ touches: [{ clientX: 50, clientY: 100 }], target: target(true) });
    eq(A.TODO_STATE.hold, null, 'desde el check, el candado o la barra no se arrastra');
    A.ACTIONS['todo.select']({});
    A.todoOnTouchStart({ touches: [{ clientX: 50, clientY: 100 }], target: target() });
    eq(A.TODO_STATE.hold, null, 'seleccionando no se arrastra');
  });

  test('v3.6 todo · soltar una tarea sobre un proyecto la suma a él y sigue en «Mis tareas»; si ya estaba, avisa', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var ids = seedMine(['Para soltar'], { privada: true });
    var env = sandbox(), A = env.load();
    var prj = A.S.projects.filter(function (p) { return p.estado === 'Activo'; })[0];
    ok(prj, 'hay un proyecto activo');
    A.todoDropOnProject(ids[0], prj.id);
    eq(A.IDX.task.get(ids[0]).proyecto, prj.id, 'al instante en el proyecto');
    eq(env.last('gSave').args[0].proyecto, prj.id, 'se guarda con ese proyecto');
    eq(env.last('gSave').args[0].privada, false, 'en un proyecto queda pública (SPEC §15)');
    ok(A.myTasks().some(function (t) { return t.id === ids[0]; }), 'sigue en «Mis tareas»');
    env.flush();
    var n = env.count('gSave');
    A.todoDropOnProject(ids[0], prj.id);
    eq(env.count('gSave'), n, 'ya estaba: no guarda de nuevo');
    ok(/^Ya está en «/.test(env.lastToast().m), 'avisa que ya estaba');
  });
})();
