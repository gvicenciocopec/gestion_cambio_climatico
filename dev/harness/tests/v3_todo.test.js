/* v3 · TodoPanel («Mis tareas»): lenguaje natural, orden, alta rápida optimista, mover a proyecto, layout.
   El JS real de Core.html + TodoPanel.html corre en un entorno aislado (sin DOM) con google.script.run
   simulado sobre el servidor emulado: cada llamada queda en una cola y la prueba decide cuándo "responde". */
(function () {
  var TODAY = '2026-10-03'; // sábado

  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  // Entorno del cliente: Core + TodoPanel con document/window mínimos y red controlada.
  function sandbox(opts) {
    opts = opts || {};
    var env = { calls: [], net: [], failNext: {}, store: {} };
    function el() {
      return { setAttribute: function () {}, removeAttribute: function () {}, appendChild: function () {}, addEventListener: function () {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, style: {}, dataset: {} };
    }
    var doc = {
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: el, body: el(), activeElement: null, contains: function () { return false; },
      documentElement: { classList: { contains: function () { return false; }, toggle: function () {} }, style: {} },
    };
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
    var timers = [];
    var code = src('Core') + '\n' + src('TodoPanel') + '\n;return {' +
      ' get S() { return S; }, applyBundle: applyBundle, IDX: IDX, TODO_STATE: TODO_STATE, VIEWS: VIEWS, ACTIONS: ACTIONS, LS: LS,' +
      ' todoParse: todoParse, todoMoveIds: todoMoveIds, todoSameOrder: todoSameOrder, todoPanelHtml: todoPanelHtml, todoLayout: todoLayout,' +
      ' todoAdd: todoAdd, todoMoveBy: todoMoveBy, todoMoveTo: todoMoveTo, todoPendingIds: todoPendingIds, todoData: todoData,' +
      ' todoTaskPayload: todoTaskPayload, myTasks: myTasks, todoDueLabel: todoDueLabel, todoSendReorder: todoSendReorder };';
    var api = new Function('document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', code)(
      doc, win, ls, { hash: '' }, { script: { run: chain(null, null) } },
      function (f) { timers.push(f); return timers.length; }, function () {}, function () { return 0; });
    env.api = api;
    // Responde n llamadas pendientes (todas si n no se indica) y deja correr las promesas.
    env.flush = function (n) {
      var k = n == null ? env.net.length : n;
      for (var i = 0; i < k && env.net.length; i++) { env.net.shift()(); drainMicrotasks(); }
      drainMicrotasks();
    };
    env.input = function (value, mode) {
      return { value: value, id: 'todo-add-' + (mode || 'aside'), parentElement: null, focus: function () {}, classList: { toggle: function () {} } };
    };
    env.load = function () {
      api.applyBundle(asUser(opts.user || U.gonzalo, function () { return client('bootstrap'); }));
      return api;
    };
    env.last = function (fn) { var x = env.calls.filter(function (c) { return c.fn === fn; }); return x[x.length - 1]; };
    return env;
  }
  function count(hay, needle) { return String(hay).split(needle).length - 1; }

  test('v3 todo · lenguaje natural: hoy, mañana, día de la semana, dd/mm, «en N días», próxima semana', function () {
    var P = sandbox().api.todoParse;
    function chk(text, nombre, fecha, msg) {
      var r = P(text, TODAY);
      eq(r.nombre, nombre, (msg || text) + ' → nombre');
      eq(r.fecha, fecha, (msg || text) + ' → fecha');
    }
    chk('Llamar a proveedor viernes', 'Llamar a proveedor', '2026-10-09');
    chk('Enviar informe para el viernes', 'Enviar informe', '2026-10-09', 'conectores «para el»');
    chk('Revisar presupuesto mañana', 'Revisar presupuesto', '2026-10-04');
    chk('Revisar presupuesto manana', 'Revisar presupuesto', '2026-10-04', 'sin tilde');
    chk('Pagar factura HOY', 'Pagar factura', '2026-10-03', 'mayúsculas');
    chk('Plan de riego pasado mañana', 'Plan de riego', '2026-10-05');
    chk('Reunión con Ina sábado', 'Reunión con Ina', '2026-10-10', 'el mismo día de la semana = la próxima');
    chk('Llamar a Benja el miércoles', 'Llamar a Benja', '2026-10-07');
    chk('Cotizar paneles 15/10', 'Cotizar paneles', '2026-10-15');
    chk('Cotizar paneles 1/2', 'Cotizar paneles', '2027-02-01', 'fecha pasada sin año → el próximo año');
    chk('Cierre anual 15-10-27', 'Cierre anual', '2027-10-15', 'año de dos dígitos');
    chk('Ordenar carpeta en 3 días', 'Ordenar carpeta', '2026-10-06');
    chk('Planificar la próxima semana', 'Planificar', '2026-10-05', 'próxima semana = el lunes');
    chk('  Llamar   a Ina   mañana. ', 'Llamar a Ina', '2026-10-04', 'espacios y punto final');
    // Sin fecha (o fecha imposible): el texto queda tal cual
    chk('mañana', 'mañana', '', 'sólo la fecha: no deja el nombre vacío');
    chk('para el viernes', 'para el viernes', '', 'sólo conectores + fecha');
    chk('Hoy reviso el informe', 'Hoy reviso el informe', '', 'la fecha debe ir al final');
    chk('Informe Q3 2026', 'Informe Q3 2026', '');
    chk('Pagar el 31/02', 'Pagar el 31/02', '', 'fecha imposible');
    chk('Revisar 3 días', 'Revisar 3 días', '', '«días» sin «en»');
    eq(P('Llamar viernes', TODAY).token, 'viernes', 'token quitado del nombre');
  });

  test('v3 todo · todoMoveIds / todoSameOrder', function () {
    var A = sandbox().api;
    deepEq(A.todoMoveIds(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd'], 'a → posición 2');
    deepEq(A.todoMoveIds(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c'], 'd → arriba');
    deepEq(A.todoMoveIds(['a', 'b', 'c'], 'b', 99), ['a', 'c', 'b'], 'fuera de rango → al final');
    deepEq(A.todoMoveIds(['a', 'b'], 'zz', 0), ['a', 'b'], 'id desconocido: sin cambios');
    ok(A.todoSameOrder(['a', 'b'], ['a', 'b']) && !A.todoSameOrder(['a', 'b'], ['b', 'a']), 'comparación');
  });

  test('v3 todo · panel: sólo mis tareas, pendientes primero, textos escapados, accesible', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    client('gSave', { tipo: 'Tarea', pilar: 'cc', nombre: '<img src=x onerror=alert(1)>', resp: U.gonzalo, fecha: day(2) });
    client('gSave', { tipo: 'Tarea', pilar: 'cc', nombre: 'Tarea de Ina (no va)', resp: U.ina, fecha: day(2) });
    var env = sandbox(), A = env.load();
    var mine = A.myTasks();
    ok(mine.length > 0, 'Gonzalo tiene tareas');
    var html = A.todoPanelHtml('aside');
    includes(html, 'data-todo-panel="aside"');
    includes(html, 'role="list"');
    includes(html, 'aria-label="Tareas pendientes"');
    ok(html.indexOf('<img src=x') < 0 && html.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, 'nombre escapado');
    ok(html.indexOf('Tarea de Ina (no va)') < 0, 'las tareas de otros no aparecen');
    var pend = mine.filter(function (t) { return t.estado !== 'Realizada'; });
    eq(count(html, 'role="listitem"'), pend.length, 'una fila por pendiente (Realizadas parte colapsada)');
    eq(count(html, 'data-task-row'), pend.length, 'filas con data-task-row (animación de tachado)');
    eq(count(html, 'class="task-title"'), pend.length, 'título con task-title');
    includes(html, 'Realizadas', 'sección de realizadas');
    includes(html, 'aria-expanded="false"', 'colapsada por defecto');
    ok(html.indexOf('anim-slide-up') < 0, 'el primer dibujo no anima filas');
    includes(html, 'data-enter="todo.add"', 'alta rápida con Enter');
    includes(html, 'Agregar una tarea…');
    // Realizadas abiertas con su acción: máximo 10; el bloque aparece suave (sin animar fila por fila)
    A.ACTIONS['todo.doneToggle']({}, { closest: function () { return { dataset: { todoPanel: 'aside' } }; } });
    eq(A.LS.get('todo.doneOpen', false), true, 'preferencia guardada');
    var h2 = A.todoPanelHtml('aside');
    var done = mine.filter(function (t) { return t.estado === 'Realizada'; });
    eq(count(h2, 'role="listitem"'), pend.length + Math.min(done.length, 10), 'se agregan las realizadas visibles');
    if (done.length) includes(h2, 'aria-label="Tareas realizadas" data-todo-done="aside" class="mt-0.5 space-y-px anim-fade-in"', 'el bloque entra suave');
    ok(h2.indexOf('anim-slide-up') < 0, 'sin animación fila por fila');
    var h3 = A.todoPanelHtml('aside');
    ok(h3.indexOf('anim-slide-up') < 0 && h3.indexOf('space-y-px anim-fade-in') < 0, 'al redibujar sin cambios no se anima nada');
    // v3.1: la página «Mis tareas» ya no existe (el panel derecho es el único lugar; Core redirige #/tareas)
    ok(!A.VIEWS['todo.page'], 'sin vista todo.page');
  });

  test('v3 todo · alta rápida optimista: aparece al instante, payload limpio, sin duplicados al confirmar', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    A.S.route = { name: 'gestion.pillar', params: { pilar: 'cc' }, path: 'gestion/cc' };
    var before = A.myTasks().length;
    A.todoPanelHtml('aside');                         // el panel ya estaba en pantalla
    A.todoAdd(env.input('Probar alta rápida mañana'));
    // Al instante (antes de que responda el servidor)
    var tmp = A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); });
    eq(tmp.length, 1, 'tarea temporal en S.tasks');
    eq(tmp[0].nombre, 'Probar alta rápida', 'la fecha se quitó del nombre');
    eq(tmp[0].fecha, day(1), 'fecha = mañana');
    eq(tmp[0].pilar, 'cc', 'pilar de la ruta');
    ok(tmp[0].avisar === true && tmp[0].privada === true, 'avisar sí; v3.2 (§15): privada por defecto en la lista personal');
    eq(A.myTasks().length, before + 1, 'ya está en mi lista');
    var h = A.todoPanelHtml('aside');
    eq(count(h, 'Probar alta rápida'), 1, 'una sola fila');
    includes(h, 'anim-slide-up', 'la fila nueva entra animada');
    includes(h, 'border-dashed', 'círculo de «guardando»');
    // Lo que viaja al servidor
    var call = env.last('gSave');
    ok(call, 'se llamó gSave');
    var p = call.args[0];
    deepEq(p, { tipo: 'Tarea', nombre: 'Probar alta rápida', resp: U.gonzalo, pilar: 'cc', fecha: day(1), avisar: true, privada: true, estado: 'Pendiente' }, 'payload (v3.2: privada)');
    assertNoDates(call.args, 'gSave');
    // El servidor confirma
    env.flush();
    eq(A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); }).length, 0, 'sin temporales en S');
    eq(A.TODO_STATE.temps.length, 0, 'sin temporales pendientes');
    var real = A.S.tasks.filter(function (t) { return t.nombre === 'Probar alta rápida'; });
    eq(real.length, 1, 'la tarea real existe una vez');
    ok(/^TSK-/.test(real[0].id), 'id real');
    eq(real[0].fecha, day(1));
    var h2 = A.todoPanelHtml('aside');
    eq(count(h2, 'Probar alta rápida'), 1, 'una sola fila tras confirmar');
    ok(h2.indexOf('anim-slide-up') < 0, 'la fila real no vuelve a animarse');
  });

  test('v3 todo · varias altas seguidas: la segunda no parpadea cuando responde la primera', function () {
    need('gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    A.S.route = { name: 'gestion.pillar', params: { pilar: 'nat' }, path: 'gestion/nat' };
    A.todoAdd(env.input('Primera rápida hoy'));
    A.todoAdd(env.input('Segunda rápida hoy'));
    eq(env.net.length, 2, 'dos guardados en vuelo');
    env.flush(1);                                   // responde sólo la primera (su bundle no trae la segunda)
    var h = A.todoPanelHtml('aside');
    eq(count(h, 'Primera rápida'), 1, 'primera: una vez');
    eq(count(h, 'Segunda rápida'), 1, 'segunda: sigue visible mientras se guarda');
    env.flush();
    var h2 = A.todoPanelHtml('aside');
    eq(count(h2, 'Primera rápida'), 1);
    eq(count(h2, 'Segunda rápida'), 1);
    eq(A.TODO_STATE.temps.length, 0, 'sin temporales');
    eq(A.S.tasks.filter(function (t) { return /rápida$/.test(t.nombre); }).length, 2, 'dos tareas reales');
  });

  test('v3 todo · alta rápida que falla: la fila se retira; sin identidad no se crea nada', function () {
    need('gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var n = A.myTasks().length;
    env.failNext.gSave = 'Sin conexión';
    A.todoAdd(env.input('No se guardará hoy'));
    eq(A.myTasks().length, n + 1, 'optimista');
    env.flush(1);
    eq(A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); }).length, 0, 'temporal retirada de S');
    eq(A.TODO_STATE.temps.length, 0, 'temporal retirada del panel');
    ok(A.todoPanelHtml('aside').indexOf('No se guardará') < 0, 'ya no se muestra');
    // Sin identidad no se crea nada (aviso amable)
    var env2 = sandbox(), B = env2.load();
    B.S.me = { email: 'desconocido', name: '', admin: false };
    B.todoAdd(env2.input('Sin dueño'));
    eq(env2.calls.filter(function (c) { return c.fn === 'gSave'; }).length, 0, 'no llama al servidor sin saber quién soy');
    includes(B.todoPanelHtml('aside'), 'Ir a Ajustes', 'invita a elegir el nombre');
  });

  test('v3 todo · reordenar: optimista, ids reales (nunca temporales) y el servidor guarda el orden', function () {
    need('taskReorder', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var ids = A.todoPendingIds();
    ok(ids.length >= 3, 'hay al menos 3 pendientes');
    A.todoAdd(env.input('Temporal en vuelo hoy'));          // queda sin responder
    ok(A.todoPendingIds().every(function (id) { return !/^tmp-/.test(id); }), 'todoPendingIds excluye temporales');
    ok(A.todoMoveBy(ids[0], 1), 'bajar la primera');
    var expect = [ids[1], ids[0]].concat(ids.slice(2));
    deepEq(A.todoPendingIds(), expect, 'orden local inmediato');
    eq(env.calls.filter(function (c) { return c.fn === 'taskReorder'; }).length, 0, 'v3.1: aún no se llama (pausa antes de guardar)');
    A.todoSendReorder();                               // lo que hace el temporizador al cumplirse la pausa
    var call = env.last('taskReorder');
    deepEq(call.args[0], expect, 'taskReorder con el orden nuevo');
    ok(call.args[0].every(function (id) { return !/^tmp-/.test(id); }), 'sin ids temporales');
    eq(A.IDX.task.get(ids[0]).orden, 2, 'orden local 2');
    ok(!A.todoMoveBy(expect[0], -1), 'subir la primera: no hace nada');
    env.flush();
    deepEq(A.todoPendingIds().slice(0, ids.length), expect, 'el orden se mantiene con los datos del servidor');
    var srv = bootstrap().tasks.filter(function (t) { return t.id === ids[0]; })[0];
    eq(Number(srv.orden), 2, 'Orden guardado en la planilla');
  });

  test('v3 todo · mover a proyecto: payload completo (v3.4 sin base), pilar del proyecto y el servidor lo aplica', function () {
    need('gSave');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var t = A.myTasks().filter(function (x) { return x.estado !== 'Realizada' && !x.proyecto; })[0];
    if (!t) {
      client('gSave', { tipo: 'Tarea', pilar: 'cc', nombre: 'Suelta para mover', resp: U.gonzalo });
      A = (env = sandbox()).load();
      t = A.myTasks().filter(function (x) { return x.nombre === 'Suelta para mover'; })[0];
    }
    var prj = A.S.projects.filter(function (p) { return p.estado === 'Activo' && p.pilar !== t.pilar; })[0] || A.S.projects[0];
    A.todoMoveTo(t.id, prj.id);
    eq(A.IDX.task.get(t.id).proyecto, prj.id, 'optimista: proyecto');
    eq(A.IDX.task.get(t.id).pilar, prj.pilar, 'optimista: pilar del proyecto');
    var p = env.last('gSave').args[0];
    eq(p.id, t.id); eq(p.tipo, 'Tarea'); eq(p.proyecto, prj.id); eq(p.pilar, prj.pilar);
    ok(!('base' in p), 'v3.4 (SPEC §18): sin versión, el último cambio gana');
    eq(p.nombre, t.nombre, 'conserva el nombre');
    ok(p.avisar === (t.avisar !== false), 'conserva avisar');
    eq(p.privada, false, 'v3.2 (§15): en un proyecto la tarea queda pública');
    ok(!('estado' in p) && !('cierre' in p), 'no toca estado ni cierre');
    assertNoDates(env.last('gSave').args, 'gSave');
    env.flush();
    var srv = bootstrap().tasks.filter(function (x) { return x.id === t.id; })[0];
    eq(srv.proyecto, prj.id, 'guardado en el servidor');
    eq(srv.pilar, prj.pilar);
    // Sin proyecto: conserva el pilar
    var env2 = sandbox(), B = env2.load();
    B.todoMoveTo(t.id, '');
    eq(env2.last('gSave').args[0].proyecto, '');
    eq(env2.last('gSave').args[0].pilar, prj.pilar, '«Sin proyecto» deja el pilar');
  });

  test('v3 todo · todoLayout: panel lateral por defecto, riel al colapsar', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load();
    var h = A.todoLayout('<p>contenido principal</p>');
    includes(h, 'data-todo-layout="wide"');
    includes(h, '<p>contenido principal</p>', 'conserva el contenido');
    includes(h, '<aside aria-label="Mis tareas"', 'panel lateral');
    includes(h, 'w-[340px]');
    includes(h, 'data-todo-panel="aside"');
    includes(h, 'data-action="todo.collapse"');
    includes(h, 'data-todo-scroll="aside"', 'scroll propio');
    A.LS.set('todo.open', false);
    var r = A.todoLayout('<p>x</p>');
    ok(r.indexOf('data-todo-panel') < 0, 'colapsado: sin panel');
    includes(r, 'data-action="todo.expand"', 'riel para volver a abrir');
    var n = A.todoData().pending.length;
    if (n) includes(r, '>' + n + '</span>', 'cantidad pendiente en el riel');
  });
})();
