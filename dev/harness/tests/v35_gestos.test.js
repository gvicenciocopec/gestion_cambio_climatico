/* v3.5 (SPEC §19) · gestos laterales en el celular: izquierda → derecha abre el menú (o cierra «Mis tareas»),
   derecha → izquierda abre «Mis tareas» (o cierra el menú); el borde no dispara «Atrás / Adelante» del navegador.
   El JS real de Core.html corre aislado; los toques se disparan a mano sobre los oyentes del documento. */
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
    var env = { h: {}, opened: [], closed: 0, prevented: 0, compact: opts.compact !== false };
    var sidebarOpen = false;
    var sidebar = { classList: {
      contains: function (c) { return c === '-translate-x-full' ? !sidebarOpen : false; },
      toggle: function (c, on) { if (c === '-translate-x-full') sidebarOpen = !on; },
    } };
    var overlay = { classList: { toggle: function () {} } };
    env.sidebarOpen = function () { return sidebarOpen; };
    var doc = {
      addEventListener: function (t, f) { env.h[t] = f; }, removeEventListener: function () {},
      getElementById: function (id) { return id === 'sidebar' ? sidebar : id === 'sidebar-overlay' ? overlay : null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      body: { classList: { add: function () {}, remove: function () {}, contains: function () { return false; } } },
      documentElement: { classList: { contains: function () { return false; }, toggle: function () {} }, style: {} },
    };
    var win = { ontouchstart: null, innerWidth: 375, addEventListener: function () {}, matchMedia: function () { return { matches: env.compact }; } };
    var code = src('Core') + '\n;function todoOpenSheet() { __env.opened.push("todo"); }' +
      'closeDrawer = function () { DRAWER = null; __env.closed++; };' +
      'return { swipeInit: swipeInit, MODALS: MODALS, setDrawer: function (d) { DRAWER = d; } };';
    env.api = new Function('document', 'window', 'navigator', 'matchMedia', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout', '__env', code)(
      doc, win, { maxTouchPoints: 5 }, function () { return { matches: env.compact }; },
      { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} }, { hash: '' }, { script: { run: {} } },
      function () { return 0; }, function () {}, env);
    env.api.swipeInit();
    function target(kind) {
      return { closest: function (sel) {
        if (kind === 'input' && /input/.test(sel)) return {};
        if (kind === 'button' && /button/.test(sel)) return {};
        return null;
      } };
    }
    function ev(x, y, kind) {
      return { touches: [{ clientX: x, clientY: y }], target: target(kind), cancelable: true, preventDefault: function () { env.prevented++; } };
    }
    // Arrastre de (x0, y0) a (x1, y1) en varios pasos
    env.swipe = function (x0, y0, x1, y1, kind) {
      env.h.touchstart(ev(x0, y0, kind));
      for (var i = 1; i <= 6; i++) env.h.touchmove(ev(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, kind));
      env.h.touchend({});
    };
    return env;
  }

  test('v3.5 gestos · izquierda → derecha abre el menú; derecha → izquierda lo cierra', function () {
    var E = sandbox();
    ok(E.h.touchstart && E.h.touchmove && E.h.touchend, 'escucha los toques del documento');
    E.swipe(80, 300, 220, 310);
    eq(E.sidebarOpen(), true, 'abre el menú');
    eq(E.opened.length, 0, 'no abre «Mis tareas»');
    E.swipe(250, 300, 100, 305);
    eq(E.sidebarOpen(), false, 'el gesto contrario lo cierra');
    eq(E.opened.length, 0, 'y no abre «Mis tareas» de paso');
  });

  test('v3.5 gestos · derecha → izquierda abre «Mis tareas»; izquierda → derecha la cierra', function () {
    var E = sandbox();
    E.swipe(300, 400, 150, 395);
    deepEq(E.opened, ['todo'], 'abre «Mis tareas»');
    E.api.setDrawer({ key: 'todo' });
    E.swipe(100, 400, 260, 400);
    eq(E.closed, 1, 'el gesto contrario la cierra');
    eq(E.sidebarOpen(), false, 'sin abrir el menú de paso');
  });

  test('v3.5 gestos · no se activa: vertical, corto, sobre un campo, con otro panel o un modal, o en pantalla ancha', function () {
    var E = sandbox();
    E.swipe(100, 100, 130, 400);                      // vertical (desplazar / actualizar)
    E.swipe(100, 300, 140, 300);                      // muy corto
    E.swipe(100, 300, 300, 300, 'input');             // seleccionar texto en un campo
    E.api.setDrawer({ key: 'task:TSK-1' }); E.swipe(300, 300, 100, 300); E.swipe(100, 300, 300, 300); E.api.setDrawer(null);
    E.api.MODALS.push({}); E.swipe(300, 300, 100, 300); E.api.MODALS.pop();
    eq(E.opened.length, 0, 'no abre «Mis tareas»');
    eq(E.sidebarOpen(), false, 'no abre el menú');
    eq(E.closed, 0, 'no cierra paneles');
    var W = sandbox({ compact: false });
    W.swipe(300, 300, 100, 300); W.swipe(100, 300, 300, 300);
    ok(!W.opened.length && !W.sidebarOpen(), 'en pantalla ancha (menú y tareas ya visibles) no hace nada');
  });

  test('v3.5 gestos · el borde no dispara «Atrás / Adelante» del navegador, salvo sobre un botón', function () {
    var E = sandbox();
    E.h.touchstart({ touches: [{ clientX: 5, clientY: 300 }], target: { closest: function () { return null; } }, cancelable: true, preventDefault: function () { E.prevented++; } });
    eq(E.prevented, 1, 'borde izquierdo: bloqueado');
    E.h.touchstart({ touches: [{ clientX: 370, clientY: 300 }], target: { closest: function () { return null; } }, cancelable: true, preventDefault: function () { E.prevented++; } });
    eq(E.prevented, 2, 'borde derecho: bloqueado');
    E.h.touchstart({ touches: [{ clientX: 6, clientY: 30 }], target: { closest: function (s) { return /button/.test(s) ? {} : null; } }, cancelable: true, preventDefault: function () { E.prevented++; } });
    eq(E.prevented, 2, 'sobre un botón (p. ej. el menú) el toque funciona normal');
    E.h.touchstart({ touches: [{ clientX: 180, clientY: 300 }], target: { closest: function () { return null; } }, cancelable: true, preventDefault: function () { E.prevented++; } });
    eq(E.prevented, 2, 'en el centro no se bloquea nada al tocar');
    ok(/html, body \{ overscroll-behavior-x: none; \}/.test(MOCK.files.Styles), 'Chrome: deslizar de lado no navega');
  });
})();
