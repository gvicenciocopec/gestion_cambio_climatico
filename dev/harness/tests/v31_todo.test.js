/* v3.1 · TodoPanel: sin página «Mis tareas», fecha rápida tras Enter (pickDate), reordenar sin redibujar con UNA
   llamada diferida y orden local protegido de bundles que llegan con el orden antiguo, panel más limpio.
   El JS real de Core.html + TodoPanel.html corre aislado (sin DOM real) con google.script.run simulado sobre el
   servidor emulado: cada llamada queda en cola y la prueba decide cuándo responde. Los temporizadores también. */
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
    var env = { calls: [], net: [], failNext: {}, store: {}, timers: [], picks: [], rerenders: 0 };
    function el() {
      return { setAttribute: function () {}, removeAttribute: function () {}, appendChild: function () {}, addEventListener: function () {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, style: {}, dataset: {} };
    }
    var doc = {
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
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
      ['bootstrap', 'gSave', 'taskReorder', 'taskComplete', 'taskReopen'].forEach(function (name) {
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
    // Temporizadores controlados: la prueba decide cuáles se cumplen (por duración).
    var seq = 0;
    function setT(fn, ms) { var t = { id: ++seq, fn: fn, ms: Number(ms) || 0, dead: false }; env.timers.push(t); return t.id; }
    function clearT(id) { env.timers.forEach(function (t) { if (t.id === id) t.dead = true; }); }
    env.live = function (ms) { return env.timers.filter(function (t) { return !t.dead && t.ms === ms; }); };
    env.runTimers = function (ms) {
      var due = env.live(ms);
      due.forEach(function (t) { t.dead = true; t.fn(); drainMicrotasks(); });
      drainMicrotasks();
      return due.length;
    };
    // pickDate de Core reemplazado por un doble: registra la llamada y deja la promesa en manos de la prueba.
    env.pick = function (anchor, o) {
      var call = { anchor: anchor, opts: o };
      env.picks.push(call);
      return new Promise(function (res, rej) { call.resolve = res; call.reject = rej; });
    };
    var code = src('Core') + '\n' + src('TodoPanel') + '\n;' +
      'pickDate = function (a, o) { return __env.pick(a, o); };' +
      'rerender = (function (orig) { return function () { __env.rerenders++; return orig.apply(this, arguments); }; })(rerender);' +
      'return {' +
      ' get S() { return S; }, applyBundle: applyBundle, IDX: IDX, TODO_STATE: TODO_STATE, VIEWS: VIEWS, ACTIONS: ACTIONS, LS: LS, esc: esc,' +
      ' todoPanelHtml: todoPanelHtml, todoLayout: todoLayout, todoAdd: todoAdd, todoMoveBy: todoMoveBy, todoPendingIds: todoPendingIds,' +
      ' todoData: todoData, todoSendReorder: todoSendReorder, todoOpenSheet: todoOpenSheet, myTasks: myTasks };';
    var api = new Function('document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout',
      'requestAnimationFrame', 'cancelAnimationFrame', '__env', code)(
      doc, win, ls, { hash: '' }, { script: { run: chain(null, null) } }, setT, clearT,
      function () { return 0; }, function () {}, env);
    env.api = api;
    env.flush = function (n) {
      var k = n == null ? env.net.length : n;
      for (var i = 0; i < k && env.net.length; i++) { env.net.shift()(); drainMicrotasks(); }
      drainMicrotasks();
    };
    env.input = function (value) {
      return { value: value, id: 'todo-add-aside', parentElement: null, focused: 0, focus: function () { this.focused++; }, classList: { toggle: function () {} } };
    };
    env.bundle = function () { return asUser(opts.user || U.gonzalo, function () { return client('bootstrap'); }); };
    env.load = function () { api.applyBundle(env.bundle()); return api; };
    env.count = function (fn) { return env.calls.filter(function (c) { return c.fn === fn; }).length; };
    env.last = function (fn) { var x = env.calls.filter(function (c) { return c.fn === fn; }); return x[x.length - 1]; };
    return env;
  }
  function serverOrden(ids) {
    var by = {};
    asUser(U.gonzalo, function () { return bootstrap(); }).tasks.forEach(function (t) { by[t.id] = Number(t.orden) || 0; });
    return ids.map(function (id) { return by[id]; });
  }
  // HTML de una fila del panel (hasta la siguiente fila).
  function rowOf(html, id) {
    var i = html.indexOf('data-todo-row="' + id + '"');
    ok(i >= 0, 'fila ' + id + ' en el panel');
    var r = html.slice(i), j = r.indexOf('role="listitem"');
    return j > 0 ? r.slice(0, j) : r;
  }
  function seq(n) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }
  // Lista falsa (sólo lo que usa todoOrderDom): filas con ↑/↓, insertBefore cuenta los movimientos.
  function fakeList(ids) {
    var list = { children: [], moves: 0 };
    list.insertBefore = function (node, ref) {
      var i = list.children.indexOf(node);
      if (i >= 0) list.children.splice(i, 1);
      var j = ref ? list.children.indexOf(ref) : -1;
      if (j < 0) list.children.push(node); else list.children.splice(j, 0, node);
      list.moves++;
    };
    Object.defineProperty(list, 'firstElementChild', { get: function () { return list.children[0] || null; } });
    function btnStub() { return { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; }, removeAttribute: function (k) { delete this.attrs[k]; } }; }
    ids.forEach(function (id) {
      var row = { dataset: { todoRow: id }, style: {}, up: btnStub(), dn: btnStub() };
      row.querySelector = function (sel) { return /todo\.up/.test(sel) ? row.up : /todo\.down/.test(sel) ? row.dn : null; };
      Object.defineProperty(row, 'nextElementSibling', { get: function () { return list.children[list.children.indexOf(row) + 1] || null; } });
      list.children.push(row);
    });
    list.ids = function () { return list.children.map(function (r) { return r.dataset.todoRow; }); };
    return list;
  }

  test('v3.1 todo · sin vista todo.page; todoOpenSheet es global', function () {
    need('bootstrap');
    fresh('demo');
    var A = sandbox().load();
    ok(!A.VIEWS['todo.page'], 'la página «Mis tareas» no se registra (Core redirige #/tareas)');
    eq(typeof A.todoOpenSheet, 'function', 'todoOpenSheet expuesta para Core / Asistente');
    ok(Object.keys(A.VIEWS).every(function (k) { return k.indexOf('todo') !== 0; }), 'ninguna vista todo.*');
  });

  test('v3.1 todo · alta rápida: Enter sin fecha pregunta con pickDate (null / sin fecha / fecha)', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    A.S.route = { name: 'gestion.pillar', params: { pilar: 'nat' }, path: 'gestion/nat' };
    var inp = env.input('Llamar a Ina');
    A.todoAdd(inp);
    eq(env.picks.length, 1, 'se abre el menú de fecha');
    ok(env.picks[0].anchor === inp, 'anclado al campo');
    eq(env.count('gSave'), 0, 'todavía no se crea nada');
    ok(A.TODO_STATE.picking, 'menú abierto');
    A.todoAdd(inp);                                        // Enter repetido con el menú abierto
    eq(env.picks.length, 1, 'no abre un segundo menú');
    // Esc → null: el texto queda y el foco vuelve al campo
    env.picks[0].resolve(null); drainMicrotasks();
    eq(env.count('gSave'), 0, 'cancelado: no se crea');
    eq(inp.value, 'Llamar a Ina', 'el texto se conserva');
    ok(inp.focused > 0, 'foco de vuelta en el campo');
    ok(!A.TODO_STATE.picking, 'menú cerrado');
    // «Sin fecha» → ''
    A.todoAdd(inp);
    eq(env.picks.length, 2);
    env.picks[1].resolve(''); drainMicrotasks();
    eq(env.count('gSave'), 1, 'se crea');
    var p = env.last('gSave').args[0];
    eq(p.nombre, 'Llamar a Ina'); eq(p.fecha, '', 'sin fecha'); eq(p.pilar, 'nat');
    eq(inp.value, '', 'campo vacío para la siguiente');
    // Una fecha del menú
    var inp2 = env.input('Revisar informe');
    A.todoAdd(inp2);
    env.picks[2].resolve(day(6)); drainMicrotasks();
    var p2 = env.last('gSave').args[0];
    eq(p2.nombre, 'Revisar informe'); eq(p2.fecha, day(6), 'fecha elegida');
    assertNoDates(env.last('gSave').args, 'gSave');
    var tmp = A.S.tasks.filter(function (t) { return t.nombre === 'Revisar informe'; })[0];
    ok(tmp && /^tmp-/.test(tmp.id) && tmp.fecha === day(6), 'aparece al instante con su fecha');
    ok(inp2.focused > 0, 'el foco vuelve al campo después de crear');
    // Fecha escrita en el texto: se crea directo, sin menú
    var inp3 = env.input('Pagar factura mañana');
    A.todoAdd(inp3);
    eq(env.picks.length, 3, 'con fecha escrita no hay menú');
    eq(env.last('gSave').args[0].nombre, 'Pagar factura');
    eq(env.last('gSave').args[0].fecha, day(1));
    ok(inp3.focused > 0, 'foco listo para la siguiente');
    // Si el menú falla, la tarea no se pierde: se crea sin fecha
    A.todoAdd(env.input('Plan B'));
    env.picks[3].reject(new Error('sin DOM')); drainMicrotasks();
    eq(env.last('gSave').args[0].nombre, 'Plan B'); eq(env.last('gSave').args[0].fecha, '');
    eq(env.count('gSave'), 4);
    env.flush();
    eq(A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); }).length, 0, 'todas aterrizan');
  });

  test('v3.1 todo · reordenar: varios movimientos = UNA llamada diferida con el orden final, sin redibujar', function () {
    need('taskReorder');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 5, 'hay al menos 5 pendientes');
    var r0 = env.rerenders;
    ok(A.todoMoveBy(ids[0], 1) && A.todoMoveBy(ids[0], 1) && A.todoMoveBy(ids[3], -1), 'tres movimientos');
    var expect = [ids[1], ids[2], ids[3], ids[0]].concat(ids.slice(4));
    deepEq(A.todoPendingIds(), expect, 'orden local inmediato');
    deepEq(expect.map(function (id) { return A.IDX.task.get(id).orden; }), seq(expect.length), 'orden local en S.tasks');
    eq(env.count('taskReorder'), 0, 'nada viaja mientras se sigue moviendo');
    eq(env.live(700).length, 1, 'un solo temporizador pendiente (debounce)');
    eq(env.rerenders, r0, 'mover no redibuja la vista');
    env.runTimers(700);
    eq(env.count('taskReorder'), 1, 'una sola llamada');
    deepEq(env.last('taskReorder').args[0], expect, 'con el orden final');
    ok(env.last('taskReorder').args[0].every(function (id) { return !/^tmp-/.test(id); }), 'sin ids temporales');
    eq(env.rerenders, r0, 'enviar tampoco redibuja (rerender:false)');
    eq(env.runTimers(700), 0, 'no queda otro envío');
    env.flush();
    eq(env.count('taskReorder'), 1);
    deepEq(serverOrden(expect), seq(expect.length), 'Orden 1..n guardado en la planilla');
    deepEq(A.todoPendingIds(), expect, 'la lista sigue igual tras la respuesta');
    // ↑ en la primera: no hace nada ni agenda envíos
    ok(!A.todoMoveBy(expect[0], -1), 'subir la primera no hace nada');
    eq(env.live(700).length, 0);
    // Las acciones ↑/↓ usan el mismo camino
    A.ACTIONS['todo.down']({ id: expect[0] });
    eq(env.live(700).length, 1, 'todo.down agenda el guardado');
    eq(env.count('taskReorder'), 1, 'sin llamada inmediata');
  });

  test('v3.1 todo · el orden local sobrevive a bundles con el orden antiguo; se suelta cuando el servidor lo confirma', function () {
    need('taskReorder', 'bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 3);
    A.todoMoveBy(ids[0], 2);                               // mover 2 lugares de una vez (como al arrastrar)
    var expect = [ids[1], ids[2], ids[0]].concat(ids.slice(3));
    deepEq(A.todoPendingIds(), expect);
    // 1) Llega un bundle (p. ej. el bootstrap del arranque) leído con el orden antiguo, antes de enviar
    A.applyBundle(env.bundle());
    deepEq(A.todoPendingIds(), expect, 'un bundle antiguo no reordena la lista');
    ok(A.TODO_STATE.order, 'orden pendiente activo');
    // 2) Se envía; antes de la respuesta llega otro bundle antiguo
    env.runTimers(700);
    var stale = env.bundle();                              // leído ANTES de que el servidor guarde el orden
    A.applyBundle(stale);
    deepEq(A.todoPendingIds(), expect, 'sigue firme mientras la llamada está en vuelo');
    // 3) El servidor confirma
    env.flush();
    ok(A.TODO_STATE.order && A.TODO_STATE.order.done > 0, 'confirmado (se protege un rato de respuestas viejas)');
    // 4) Una respuesta leída antes de guardar llega tarde: no mueve nada
    A.applyBundle(JSON.parse(JSON.stringify(stale)));
    deepEq(A.todoPendingIds(), expect, 'una respuesta vieja que llega tarde tampoco reordena');
    // 5) Un bundle fresco ya trae el orden: el orden local se suelta
    A.applyBundle(env.bundle());
    deepEq(A.todoPendingIds(), expect, 'orden correcto con los datos del servidor');
    ok(!A.TODO_STATE.order, 'sin orden pendiente');
  });

  test('v3.1 todo · si guardar el orden falla, se suelta el orden local y vuelve el del servidor', function () {
    need('taskReorder', 'bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    env.failNext.taskReorder = 'Sin conexión';
    A.todoMoveBy(ids[0], 1);
    env.runTimers(700);
    env.flush(1);
    ok(!A.TODO_STATE.order, 'orden local descartado');
    ok(env.net.length >= 1 && env.last('bootstrap'), 'Core pide los datos reales');
    env.flush();
    deepEq(A.todoPendingIds().slice(0, ids.length), ids, 'vuelve el orden del servidor');
  });

  test('v3.1 todo · las filas se reordenan en el DOM (un movimiento) y ↑/↓ se actualizan', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 4);
    var list = fakeList(ids);
    env.doc.querySelectorAll = function (sel) { return sel === '[data-todo-list]' ? [list] : []; };
    var r0 = env.rerenders;
    A.todoMoveBy(ids[2], -1);
    deepEq(list.ids(), [ids[0], ids[2], ids[1]].concat(ids.slice(3)), 'el DOM sigue al orden local');
    eq(list.moves, 1, 'se mueve un solo nodo');
    eq(env.rerenders, r0, 'sin redibujar');
    A.todoMoveBy(ids[2], -1);                              // ahora queda primera
    eq(list.ids()[0], ids[2]);
    eq(list.children[0].up.attrs['aria-disabled'], 'true', '↑ deshabilitado en la primera');
    ok(!('aria-disabled' in list.children[1].up.attrs), '↑ habilitado en la segunda');
    eq(list.children[list.children.length - 1].dn.attrs['aria-disabled'], 'true', '↓ deshabilitado en la última');
    ok(!('aria-disabled' in list.children[0].dn.attrs), '↓ habilitado en la primera');
  });

  test('v3.1 todo · panel limpio: sin saludo ni textos de relleno; filas = check + título + fecha (+ candado)', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var prj = asUser(U.gonzalo, function () { return bootstrap(); }).projects.filter(function (p) { return p.estado !== 'Cerrado'; })[0];
    ok(prj, 'hay un proyecto');
    asUser(U.gonzalo, function () {
      client('gSave', { tipo: 'Tarea', pilar: prj.pilar, proyecto: prj.id, nombre: 'Fila con proyecto', resp: U.gonzalo, fecha: day(20) });
      client('gSave', { tipo: 'Tarea', pilar: 'cc', nombre: 'Fila privada', resp: U.gonzalo, privada: true, avisar: false });
    });
    var env = sandbox(), A = env.load();
    var html = A.todoPanelHtml('aside');
    ['Buenos días', 'Buenas tardes', 'Buenas noches', 'listas hoy', 'Nada vence hoy', 'Enter para agregar', 'Disfruta', 'bell-off']
      .forEach(function (s) { ok(html.indexOf(s) < 0, 'sin «' + s + '»'); });
    includes(html, '>Mis tareas</h2>', 'título');
    var n = A.todoData().pending.length;
    includes(html, '>' + n + '<span class="sr-only"> pendientes</span>', 'cantidad pequeña junto al título');
    includes(html, 'data-action="todo.collapse"', 'botón para ocultar');
    // El proyecto sólo en el tooltip del título (no como texto visible)
    var t = A.S.tasks.filter(function (x) { return x.nombre === 'Fila con proyecto'; })[0];
    var row = rowOf(html, t.id);
    includes(row, 'title="' + A.esc('Proyecto: ' + prj.nombre) + '"', 'proyecto en el tooltip');
    ok(row.replace(/<[^>]*>/g, '').indexOf(prj.nombre) < 0, 'el nombre del proyecto no es texto visible de la fila');
    var visible = row.replace(/<[^>]*>/g, '');
    ok(visible.indexOf('Fila con proyecto') >= 0, 'título visible');
    var p = A.S.tasks.filter(function (x) { return x.nombre === 'Fila privada'; })[0];
    var prow = rowOf(html, p.id);
    includes(prow, 'data-lucide="lock"', 'candado en la privada');
    ok(rowOf(html, t.id).indexOf('data-lucide="lock"') < 0, 'sin candado si no es privada');
    // Lista vacía: una línea corta
    A.S.tasks = [];
    var empty = A.todoPanelHtml('aside');
    includes(empty, 'Sin pendientes');
    ok(empty.indexOf('Disfruta') < 0 && empty.indexOf('Cuando surja algo') < 0, 'sin prosa de relleno');
    // La hoja (celular) tampoco trae saludo
    var sheet = A.todoPanelHtml('sheet');
    includes(sheet, 'data-todo-panel="sheet"');
    ok(sheet.indexOf('Buen') < 0, 'hoja sin saludo');
  });
})();
