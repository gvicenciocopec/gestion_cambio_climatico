/* v3.4 (SPEC §18) · fluidez: guardado liviano de líneas, cambios en curso que no "saltan" cuando llegan datos de otro
   guardado, error → datos reales, sin barra superior en los guardados y sin zoom en el celular.
   El JS real de Core.html corre aislado con google.script.run simulado sobre el servidor emulado: cada llamada queda
   en cola y la prueba decide cuándo responde. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  function tick() { var t = Date.now(); while (Date.now() <= t) { /* espera activa */ } }

  function sandbox(user) {
    var env = { net: [], failNext: {}, toasts: [], bar: [] };
    function el() {
      return { setAttribute: function () {}, removeAttribute: function () {}, appendChild: function () {}, addEventListener: function () {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, style: {}, dataset: {} };
    }
    var bar = { classList: { toggle: function (c, on) { env.bar.push(!!on); } } };
    var doc = {
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function (id) { return id === 'top-progress' ? bar : null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: el, body: el(), activeElement: null, contains: function () { return false; }, hidden: false,
      documentElement: { classList: { contains: function () { return false; }, toggle: function () {} }, style: {} },
    };
    function chain(okFn, koFn) {
      var c = {
        withSuccessHandler: function (f) { return chain(f, koFn); },
        withFailureHandler: function (f) { return chain(okFn, f); },
      };
      ['bootstrap', 'gSave', 'budgetSave', 'commentAdd'].forEach(function (name) {
        c[name] = function () {
          var args = MOCK.strictClone(Array.prototype.slice.call(arguments), name + '(argumentos)');
          env.net.push(function () {
            var res, err = null;
            if (env.failNext[name]) { err = new Error(env.failNext[name]); delete env.failNext[name]; }
            else { try { res = asUser(user, function () { return client.apply(null, [name].concat(args)); }); } catch (e) { err = e; } }
            if (err) { if (koFn) koFn(err); } else if (okFn) okFn(res);
          });
        };
      });
      return c;
    }
    var code = src('Core') + '\n;' +
      'toast = function (m, type) { __env.toasts.push({ m: m, type: type || "success" }); };' +
      'return { get S() { return S; }, applyBundle: applyBundle, optimistic: optimistic, refreshData: refreshData, IDX: IDX };';
    env.api = new Function('document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout',
      'requestAnimationFrame', 'cancelAnimationFrame', '__env', code)(
      doc, { addEventListener: function () {} }, { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
      { hash: '' }, { script: { run: chain(null, null) } },
      function () { return 0; }, function () {}, function () { return 0; }, function () {}, env);
    env.flush = function () { while (env.net.length) { env.net.shift()(); drainMicrotasks(); } drainMicrotasks(); };
    env.bundle = function () { tick(); return asUser(user, function () { return client('bootstrap'); }); };
    return env;
  }
  function openTask(A) {
    var t = A.S.tasks.filter(function (x) { return x.estado !== 'Realizada' && !/^tmp-/.test(x.id); })[0];
    ok(t, 'hay una tarea pendiente');
    return t;
  }

  test('v3.4 fluidez · un cambio en curso no "salta" cuando llegan datos de otro guardado', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(U.gonzalo), A = env.api;
    A.applyBundle(env.bundle());
    var t = openTask(A);
    A.optimistic(function () { var x = A.IDX.task.get(t.id); if (x) x.nombre = 'Nombre local'; },
      'gSave', [{ tipo: 'Tarea', id: t.id, nombre: 'Nombre local' }], { reapply: true });
    eq(A.IDX.task.get(t.id).nombre, 'Nombre local', 'al instante');
    A.applyBundle(env.bundle());                       // datos de otro guardado, aún sin este cambio
    eq(A.IDX.task.get(t.id).nombre, 'Nombre local', 'no vuelve al valor anterior');
    env.flush();
    eq(A.IDX.task.get(t.id).nombre, 'Nombre local', 'confirmado por el servidor');
    // Ya confirmado: los datos posteriores mandan (el cambio no se re-aplica para siempre)
    asUser(U.gonzalo, function () { client('gSave', { tipo: 'Tarea', id: t.id, nombre: 'Cambio posterior' }); });
    A.applyBundle(env.bundle());
    eq(A.IDX.task.get(t.id).nombre, 'Cambio posterior', 'sin cambios en curso, mandan los datos nuevos');
  });

  test('v3.4 fluidez · si el guardado falla: avisa y vuelve a los datos reales', function () {
    fresh('demo');
    var env = sandbox(U.gonzalo), A = env.api;
    A.applyBundle(env.bundle());
    var t = openTask(A), name0 = t.nombre;
    env.failNext.gSave = 'Sin conexión';
    A.optimistic(function () { var x = A.IDX.task.get(t.id); if (x) x.nombre = 'No se guardará'; },
      'gSave', [{ tipo: 'Tarea', id: t.id, nombre: 'No se guardará' }], { reapply: true });
    eq(A.IDX.task.get(t.id).nombre, 'No se guardará');
    env.flush();
    ok(env.toasts.some(function (x) { return x.type === 'error' && /Sin conexión/.test(x.m); }), 'avisa el error');
    eq(A.IDX.task.get(t.id).nombre, name0, 'vuelve al dato real (recarga)');
  });

  test('v3.4 fluidez · los guardados no muestran la barra superior; «Actualizar» sí', function () {
    fresh('demo');
    var env = sandbox(U.gonzalo), A = env.api;
    A.applyBundle(env.bundle());
    var t = openTask(A);
    env.bar.length = 0;
    A.optimistic(function () {}, 'gSave', [{ tipo: 'Tarea', id: t.id, detalle: 'Sin barra' }]);
    env.flush();
    ok(env.bar.length && env.bar.every(function (on) { return !on; }), 'guardar no enciende la barra');
    env.bar.length = 0;
    A.refreshData(false);
    ok(env.bar.indexOf(true) >= 0, '«Actualizar» la enciende');
    env.flush();
    eq(env.bar[env.bar.length - 1], false, 'y se apaga al terminar');
  });

  test('v3.4 fluidez · budgetSave liviano: guarda y responde sin bundle; crear sigue trayendo el bundle', function () {
    need('budgetSave', 'bootstrap');
    fresh('setup');
    var l = client('bootstrap').budget['2026'][0];
    var r = client('budgetSave', 2026, l.id, { pg: 12345 }, null, { light: true });
    deepEq(r, { ok: true, lastId: l.id }, 'respuesta liviana');
    var now = client('bootstrap').budget['2026'].find(function (x) { return x.id === l.id; });
    eq(now.pg, 12345, 'guardado en la planilla');
    eq(now.pend, Math.max((Number(now.pf) || 0) - 12345, 0), 'Pendiente recalculado como en el cliente');
    var c = client('budgetSave', 2026, '', { area: 'nat', proj: 'Creada con light', clas: 'Nuevo', po: 0, pf: 1000, pg: 0, oc: '' }, null, { light: true });
    ok(c.me && /^L-/.test(c.lastId), 'al crear devuelve el bundle con lastId (hace falta la fila nueva)');
    asUser('cualquiera@gmail.com', function () {
      throws(function () { client('budgetSave', 2026, l.id, { pg: 1 }, null, { light: true }); }, /acceso/i, 'liviano igual exige ser del equipo');
    });
  });

  /* ---------------- Deslizar hacia abajo para actualizar ---------------- */
  // Core real con #view e indicador simulados: se disparan los eventos táctiles a mano.
  function ptrSandbox() {
    var env = { net: [], toasts: [], h: {}, prevented: 0 };
    var view = { scrollTop: 0, addEventListener: function (t, f) { env.h[t] = f; } };
    var svg = { style: {} };
    var ptr = { dataset: { state: 'idle' }, style: {}, querySelector: function () { return svg; } };
    env.view = view; env.ptr = ptr;
    var doc = {
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function (id) { return id === 'view' ? view : id === 'ptr' ? ptr : null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      body: { classList: { add: function () {}, remove: function () {}, contains: function () { return false; } } },
      documentElement: { classList: { contains: function () { return false; }, toggle: function () {} }, style: {} },
    };
    var run = { withSuccessHandler: function (ok) { return { withFailureHandler: function () { return { bootstrap: function () {
      env.net.push(function () { ok(asUser(U.gonzalo, function () { return client('bootstrap'); })); });
    } }; } }; } };
    var code = src('Core') + '\n;toast = function (m, type) { __env.toasts.push({ m: m, type: type || "success" }); };' +
      'return { ptrInit: ptrInit, PTR: PTR, MODALS: MODALS, setDrawer: function (d) { DRAWER = d; } };';
    env.api = new Function('document', 'window', 'navigator', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout', '__env', code)(
      doc, { ontouchstart: null, addEventListener: function () {} }, { maxTouchPoints: 5, vibrate: function () {} },
      { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} }, { hash: '' }, { script: { run: run } },
      function () { return 0; }, function () {}, env);
    env.api.ptrInit();
    function ev(y, x, target) {
      return { touches: [{ clientY: y, clientX: x || 100 }], target: target || { closest: function () { return null; } }, cancelable: true,
        preventDefault: function () { env.prevented++; } };
    }
    env.drag = function (from, to, opts) {
      opts = opts || {};
      env.h.touchstart(ev(from, 100, opts.target));
      var steps = 6;
      for (var i = 1; i <= steps; i++) env.h.touchmove(ev(from + (to - from) * i / steps, 100 + (opts.dx || 0) * i / steps));
      env.h.touchend({});
    };
    env.flush = function () { while (env.net.length) { env.net.shift()(); drainMicrotasks(); } drainMicrotasks(); };
    return env;
  }

  test('v3.4 fluidez · deslizar hacia abajo actualiza con su animación (sin barra ni toast)', function () {
    need('bootstrap');
    fresh('demo');
    var E = ptrSandbox();
    ok(E.h.touchstart && E.h.touchmove && E.h.touchend, 'escucha los toques en la vista');
    E.drag(100, 200);                                    // 100 px × 0,5 de resistencia = 50 px: no alcanza
    eq(E.net.length, 0, 'tirón corto: no actualiza');
    eq(E.ptr.dataset.state, 'idle', 'el indicador vuelve a esconderse');
    E.drag(100, 300);                                    // 200 px → 100 px: pasa el umbral
    eq(E.net.length, 1, 'actualiza: pide los datos');
    eq(E.ptr.dataset.state, 'busy', 'gira mientras actualiza');
    ok(E.prevented > 0, 'evita el rebote / la recarga de la página completa');
    E.flush();
    eq(E.ptr.dataset.state, 'idle', 'al terminar se esconde');
    eq(E.toasts.length, 0, 'sin toast de «Datos actualizados»');
  });

  test('v3.4 fluidez · deslizar no actualiza: vista abajo, hacia arriba, de lado, sobre un campo o con un panel abierto', function () {
    fresh('demo');
    var E = ptrSandbox();
    E.view.scrollTop = 40; E.drag(100, 400); E.view.scrollTop = 0;
    E.drag(400, 100);
    E.drag(100, 300, { dx: 400 });
    E.drag(100, 400, { target: { closest: function () { return {}; } } });
    E.api.setDrawer({ key: 'task:x' }); E.drag(100, 400); E.api.setDrawer(null);
    E.api.MODALS.push({}); E.drag(100, 400); E.api.MODALS.pop();
    eq(E.net.length, 0, 'ninguno de estos casos actualiza');
    E.drag(100, 400);
    eq(E.net.length, 1, 'arriba, hacia abajo y sin paneles: sí');
  });

  test('v3.4 fluidez · «Editar» en el menú ⋯ de Mis tareas abre el formulario de la tarea, no su tarjeta', function () {
    var code = src('TodoPanel');
    var m = code.match(/action\('todo\.edit'[\s\S]*?\n\}\);/);
    ok(m, 'acción todo.edit');
    var opened = [];
    var acts = {};
    new Function('action', 'todoIsTmp', 'openTaskForm', 'openTask', m[0])(
      function (n, f) { acts[n] = f; }, function (id) { return /^tmp-/.test(id); },
      function (o) { opened.push(['form', o.id]); }, function (id) { opened.push(['card', id]); });
    acts['todo.edit']({ id: 'TSK-1' });
    acts['todo.edit']({ id: 'tmp-123' });
    deepEq(opened, [['form', 'TSK-1']], 'formulario editable directo; una tarea aún sin guardar no se abre');
  });

  test('v3.4 fluidez · celular sin zoom: meta viewport, doble toque y gestos', function () {
    need('doGet');
    fresh('setup');
    var meta = doGet().getMetaTags().filter(function (m) { return m.name === 'viewport'; })[0];
    ok(meta && /maximum-scale=1/.test(meta.content) && /user-scalable=no/.test(meta.content), 'viewport sin zoom: ' + (meta && meta.content));
    ok(/html \{ touch-action: manipulation; \}/.test(MOCK.files.Styles), 'sin zoom con doble toque');
    ok(/'gesturestart', 'gesturechange'\]\.forEach/.test(src('Core')), 'sin zoom con gestos (iPhone)');
  });
})();
