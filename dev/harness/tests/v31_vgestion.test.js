/* v3.1 · VGestion (cliente): alta en línea con fecha rápida (pickDate, SPEC §14.2), altas seguidas sin parpadeo,
   y la limpieza de §14.4 (sin líneas de estadísticas, textos de relleno, etiquetas «Iniciativa» ni conteos redundantes;
   «Ver como admin» apagado oculta lo de administrador).
   El JS real de Core.html + VGestion.html (y TodoPanel.html en la prueba de integración) corre sin DOM, con
   google.script.run simulado sobre el servidor emulado: cada llamada queda en cola y la prueba decide cuándo responde. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  // files: parciales a cargar después de Core (en orden). hooks.todoParse: parser de fechas simulado (sin TodoPanel).
  function sandbox(opts) {
    opts = opts || {};
    var env = { calls: [], net: [], failNext: {}, store: {}, picks: [] };
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
    var win = { addEventListener: function () {}, innerWidth: 1440 };
    var ls = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(env.store, k) ? env.store[k] : null; },
      setItem: function (k, v) { env.store[k] = String(v); },
      removeItem: function (k) { delete env.store[k]; },
    };
    function chain(okFn, koFn) {
      var base = {
        withSuccessHandler: function (f) { return chain(f, koFn); },
        withFailureHandler: function (f) { return chain(okFn, f); },
      };
      return new Proxy(base, { get: function (t, name) {
        if (name in t) return t[name];
        return function () {
          var args = Array.prototype.slice.call(arguments);
          env.calls.push({ fn: String(name), args: MOCK.strictClone(args, String(name) + '(argumentos)') });
          env.net.push(function () {
            var res, err = null;
            if (env.failNext[name]) { err = new Error(env.failNext[name]); delete env.failNext[name]; }
            else { try { res = asUser(U.gonzalo, function () { return client.apply(null, [name].concat(args)); }); } catch (e) { err = e; } }
            if (err) { if (koFn) koFn(err); } else if (okFn) okFn(res);
          });
        };
      } });
    }
    var files = ['Core'].concat(opts.files || ['VGestion']);
    var code = 'var todoParse = typeof todoParse === "function" ? todoParse : HOOKS.todoParse;\n' +
      files.map(src).join('\n') + '\n;return {' +
      ' get S() { return S; }, applyBundle: applyBundle, VIEWS: VIEWS, ACTIONS: ACTIONS, LS: LS, VG: VG,' +
      ' setPick: function (f) { pickDate = f; }, fn: function (n) { return eval(n); } };';
    var api = new Function('HOOKS', 'document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'getComputedStyle', code)(
      { todoParse: opts.todoParse }, doc, win, ls, { hash: '' }, { script: { run: chain(null, null) } },
      function () { return 0; }, function () {}, function () { return 0; }, function () { return { getPropertyValue: function () { return ''; } }; });
    env.api = api;
    // pickDate controlado por la prueba: cada llamada queda en env.picks con su resolve.
    api.setPick(function (anchor, o) {
      return new Promise(function (resolve) { env.picks.push({ anchor: anchor, o: o || {}, resolve: resolve }); });
    });
    env.pick = function (value) {
      var p = env.picks.shift();
      ok(p, 'no había un selector de fecha abierto');
      p.resolve(value);
      drainMicrotasks();
    };
    env.flush = function (n) {
      var k = n == null ? env.net.length : n;
      for (var i = 0; i < k && env.net.length; i++) { env.net.shift()(); drainMicrotasks(); }
      drainMicrotasks();
    };
    env.saves = function () { return env.calls.filter(function (c) { return c.fn === 'gSave'; }); };
    env.load = function (pilar) {
      api.applyBundle(asUser(U.gonzalo, function () { return client('bootstrap'); }));
      api.S.route = { name: 'gestion.pillar', params: { pilar: pilar || 'ec' }, path: 'gestion/' + (pilar || 'ec') };
      return api;
    };
    env.input = function (value) { return { value: value, dataset: {}, focus: function () {} }; };
    env.pillarHtml = function (pk) { return api.VIEWS['gestion.pillar'].render({ pilar: pk || 'ec' }); };
    return env;
  }
  function count(h, s) { return h.split(s).length - 1; }
  function openProject(A, pk) {
    var p = A.S.projects.find(function (x) { return x.pilar === pk && x.estado !== 'Cerrado'; });
    ok(p, 'proyecto abierto en ' + pk);
    return p;
  }
  function headerOf(html) { var i = html.indexOf('</header>'); return i < 0 ? '' : html.slice(0, i); }

  test('v3.1 vgestion · alta en línea: Enter pregunta «¿Para cuándo?» y crea con la fecha elegida', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('ec');
    var p = openProject(A, 'ec');
    var n0 = A.S.tasks.length;
    var input = env.input('  Revisar   contrato de reciclaje  ');
    A.ACTIONS['gestion.addTask']({ key: p.id }, input);
    eq(env.picks.length, 1, 'se abre el selector de fecha');
    ok(env.picks[0].anchor === input, 'anclado al input');
    eq(env.picks[0].o.title, '¿Para cuándo?');
    eq(env.saves().length, 0, 'todavía no se guarda nada');
    eq(A.S.tasks.length, n0, 'todavía no aparece');
    // Esc / clic afuera: no se crea nada y el texto queda
    env.pick(null);
    eq(env.saves().length, 0, 'cancelado: sin gSave');
    eq(input.value, '  Revisar   contrato de reciclaje  ', 'cancelado: el texto queda tal cual');
    eq(A.S.tasks.length, n0, 'cancelado: sin tarea');
    // Ahora elige una fecha
    A.ACTIONS['gestion.addTask']({ key: p.id }, input);
    env.pick(day(2));
    var saves = env.saves();
    eq(saves.length, 1, 'un gSave');
    var ent = saves[0].args[0];
    eq(ent.nombre, 'Revisar contrato de reciclaje', 'nombre limpio');
    eq(ent.fecha, day(2), 'con la fecha elegida');
    eq(ent.proyecto, p.id); eq(ent.pilar, 'ec'); eq(ent.tipo, 'Tarea'); eq(ent.resp, U.gonzalo);
    assertNoDates(saves[0].args, 'gSave');
    eq(input.value, '', 'input vacío para la siguiente');
    eq(A.S.ui.gestion.addOpen, p.id, 'el input sigue abierto');
    eq(A.VG.focusAdd, p.id, 'y vuelve a tener el foco');
    var tmp = A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); });
    eq(tmp.length, 1, 'aparece al instante (temporal en minúscula, como Core.isTmpId y TodoPanel)');
    eq(tmp[0].fecha, day(2), 'la temporal ya trae la fecha');
    var h = env.pillarHtml('ec');
    ok(h.indexOf('data-task-row data-id="' + tmp[0].id + '"') >= 0, 'fila temporal visible');
    // El servidor confirma: una sola fila, la real, con su fecha
    env.flush();
    var real = A.S.tasks.filter(function (t) { return t.nombre === 'Revisar contrato de reciclaje'; });
    eq(real.length, 1, 'la tarea real existe una vez');
    ok(/^TSK-/.test(real[0].id), 'id real');
    eq(real[0].fecha, day(2), 'fecha guardada');
    eq(real[0].proyecto, p.id, 'en el proyecto');
    var h2 = env.pillarHtml('ec');
    eq(count(h2, '>Revisar contrato de reciclaje<'), 1, 'una sola fila tras confirmar');
    ok(h2.indexOf('data-id="tmp-') < 0, 'sin temporales');
    eq(A.VG.temps.length, 0, 'sin altas pendientes');
    // «Sin fecha» crea sin fecha
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Sin apuro'));
    env.pick('');
    eq(env.saves().length, 2, 'segundo gSave');
    eq(env.saves()[1].args[0].fecha, '', 'sin fecha');
    env.flush();
    eq(A.S.tasks.filter(function (t) { return t.nombre === 'Sin apuro' && !t.fecha; }).length, 1, 'creada sin fecha');
    // Tareas sueltas del pilar («Tareas sin proyecto») siguen el mismo camino
    A.ACTIONS['gestion.addTask']({ key: 'sp-ec' }, env.input('Suelta con fecha'));
    env.pick(day(5));
    var e3 = env.saves()[2].args[0];
    eq(e3.proyecto, ''); eq(e3.pilar, 'ec'); eq(e3.fecha, day(5));
    // Texto vacío o proyecto cerrado: ni selector ni guardado
    var nPick = env.picks.length, nSave = env.saves().length;
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('    '));
    A.fn('IDX').project.get(p.id).estado = 'Cerrado';     // el objeto vigente (los bundles reemplazan S.projects)
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('No debería'));
    eq(env.picks.length, nPick, 'sin selector');
    eq(env.saves().length, nSave, 'sin guardado');
  });

  test('v3.1 vgestion · alta en línea: una fecha escrita en el texto no abre el selector', function () {
    need('gSave');
    fresh('demo');
    // Parser simulado (el real vive en TodoPanel: ver la prueba de integración siguiente)
    var env = sandbox({ todoParse: function (text) {
      return /\smañana$/.test(text) ? { nombre: text.replace(/\s+mañana$/, ''), fecha: day(1), token: 'mañana' } : { nombre: text, fecha: '', token: '' };
    } });
    var A = env.load('nat');
    var p = openProject(A, 'nat');
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Llamar al humedal mañana'));
    eq(env.picks.length, 0, 'no pregunta la fecha');
    var e = env.saves()[0].args[0];
    eq(e.nombre, 'Llamar al humedal', 'la fecha se quita del nombre');
    eq(e.fecha, day(1), 'fecha = mañana');
    // Sin fecha natural sí pregunta
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Llamar al humedal'));
    eq(env.picks.length, 1, 'sin fecha en el texto: pregunta');
  });

  test('v3.1 vgestion · alta en línea + TodoPanel real: «… viernes» usa todoParse y no pregunta', function () {
    need('gSave');
    fresh('demo');
    var tp = src('TodoPanel');
    ok(tp.indexOf('function todoParse(') >= 0, 'TodoPanel expone todoParse (VGestion lo reutiliza para la fecha natural)');
    var env = sandbox({ files: ['TodoPanel', 'VGestion'] });
    var A = env.load('cc');
    var p = openProject(A, 'cc');
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Enviar minuta viernes'));
    eq(env.picks.length, 0, 'no pregunta la fecha');
    var e = env.saves()[0].args[0];
    eq(e.nombre, 'Enviar minuta');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(e.fecha) && e.fecha > day(0) && e.fecha <= day(7), 'el próximo viernes');
    // La página del pilar con TodoPanel (todoLayout) dibuja la fila temporal y luego la real una sola vez
    var h = env.pillarHtml('cc');
    ok(h.indexOf('Enviar minuta') >= 0, 'visible al instante');
    env.flush();
    var h2 = env.pillarHtml('cc');
    ok(h2.indexOf('data-id="tmp-') < 0, 'sin temporales tras confirmar');
  });

  test('v3.1 vgestion · altas en línea seguidas: la segunda no desaparece cuando responde la primera', function () {
    need('gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('ec');
    var p = openProject(A, 'ec');
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Primera en línea'));
    env.pick('');
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Segunda en línea'));
    env.pick(day(3));
    eq(env.net.length, 2, 'dos guardados en vuelo');
    env.flush(1);                                  // responde sólo la primera: su bundle no trae la segunda
    var h = env.pillarHtml('ec');
    eq(count(h, '>Primera en línea<'), 1, 'primera: una vez (la real)');
    eq(count(h, '>Segunda en línea<'), 1, 'segunda: sigue visible mientras se guarda');
    eq(A.VG.temps.length, 1, 'queda una alta pendiente');
    env.flush();
    var h2 = env.pillarHtml('ec');
    eq(count(h2, '>Primera en línea<'), 1);
    eq(count(h2, '>Segunda en línea<'), 1);
    eq(A.VG.temps.length, 0, 'sin altas pendientes');
    eq(A.S.tasks.filter(function (t) { return /en línea$/.test(t.nombre); }).length, 2, 'dos tareas reales');
  });

  test('v3.1 vgestion · alta en línea que falla: la fila temporal se retira', function () {
    need('gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('ec');
    var p = openProject(A, 'ec');
    env.failNext.gSave = 'Sin conexión';
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('No se guardará'));
    env.pick(day(1));
    ok(env.pillarHtml('ec').indexOf('No se guardará') >= 0, 'optimista: visible');
    env.flush(1);
    eq(A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); }).length, 0, 'temporal retirada de S');
    eq(A.VG.temps.length, 0, 'sin altas pendientes');
    ok(env.pillarHtml('ec').indexOf('No se guardará') < 0, 'ya no se muestra');
  });

  test('v3.1 vgestion · menos ruido: sin líneas de estadísticas, textos de relleno, «Iniciativa» ni conteos redundantes', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load('nat');
    var gone = ['tareas en curso', 'tarea en curso', 'Buen momento para planificar', 'Todo al día', 'Sin apuros', 'proyectos activos',
      'Toca una barra', 'Proyectos y tareas en el tiempo', 'Tareas en curso de cada persona', 'toca para ver el detalle',
      'Las nuevas llegan solas', 'Actividad reciente', 'Semanas tranquilas', 'Ver mis tareas', '#/tareas', 'Sin tareas aún',
      'Indicadores del catálogo Cascade', 'tarea vinculada', 'Un espacio nuevo', 'Crea el primer proyecto',
      'Revisa el enlace', 'Prueba con otras palabras', 'Iniciativa Estratégica Organizacional', 'Atrasadas y próximos 14 días',
      'Con tiempo o sin fecha', 'Proyecto y su avance', 'Tarea en curso'];
    function clean(html, label) {
      ok(typeof html === 'string' && html.length > 100, label + ': HTML');
      ok(html.indexOf('undefined') < 0 && !/\bNaN\b/.test(html), label + ': sin undefined/NaN');
      gone.forEach(function (s) { ok(html.indexOf(s) < 0, label + ': no debería decir «' + s + '»'); });
      ok(!/>\s*Iniciativa\s*</.test(html) && html.indexOf('Iniciativa ·') < 0, label + ': sin etiqueta «Iniciativa»');
      ok(!/>\s*\d+ proyectos?\s*</.test(html), label + ': sin conteo «N proyectos»');
      ok(!/>\s*\d+ indicador(es)?\s*</.test(html), label + ': sin conteo «N indicadores»');
      ok(!/>[^<]*tareas vinculadas/.test(html), label + ': sin «N tareas vinculadas» a la vista (sólo en el title del botón)');
    }
    var u = A.fn('vgUi')();
    A.S.pillars.forEach(function (P) {
      A.S.route = { name: 'gestion.pillar', params: { pilar: P.key }, path: 'gestion/' + P.key };
      var h = env.pillarHtml(P.key);
      clean(h, 'pilar ' + P.key);
      ok(!/\d+ (atrasad|esta semana)/.test(headerOf(h)), 'pilar ' + P.key + ': encabezado sin estadísticas');
      u.mode[P.key] = 'indicadores';
      clean(env.pillarHtml(P.key), 'indicadores ' + P.key);
      u.mode[P.key] = 'proyectos';
      A.S.route = { name: 'gestion.plan', params: { pilar: P.key }, path: 'gestion/' + P.key + '/plan' };
      var plan = A.VIEWS['gestion.plan'].render({ pilar: P.key });
      clean(plan, 'plan ' + P.key);
      ok(count(plan, 'rounded-sm border border-dashed') + count(plan, 'size-2 rounded-full bg-zinc-300') <= 3, 'plan ' + P.key + ': leyenda mínima');
    });
    A.S.route = { name: 'gestion.overview', params: {}, path: 'gestion' };
    var ov = A.VIEWS['gestion.overview'].render({});
    clean(ov, 'vista general');
    ok(!/Buenos días|Buenas tardes|Buenas noches|Hola,/.test(headerOf(ov)), 'vista general: encabezado sin saludo ni fecha');
    // Pilar sin nada (sólo setup): estado vacío de una línea
    fresh('setup');
    var env2 = sandbox(), B = env2.load('cc');
    var empty = env2.pillarHtml('cc');
    clean(empty, 'pilar vacío');
    ok(empty.indexOf('Sin proyectos aún') >= 0 || empty.indexOf('data-vg-project') >= 0 || empty.indexOf('gestion.addOpen') >= 0, 'pilar vacío: una línea corta');
    B.fn('vgUi')().pq.cc = 'zzzz-no-existe';
    ok(env2.pillarHtml('cc').indexOf('Nada por aquí con ese filtro') >= 0, 'filtro sin resultados: una línea');
  });

  test('v3.1 vgestion · «Ver como admin» apagado: sin solicitudes de compra; sin pendientes no hay franja', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load('cc');
    ok(A.S.me.admin, 'Gonzalo es administrador');
    A.S.solicitudes = [{ id: 'SOL-1', estado: 'Pendiente', montoClp: 13473363, recibido: '2026-10-02T14:20:00.000Z', pr: 'PR71524', nombre: 'Piloto Green Energy', solicitante: 'X' }];
    A.S.route = { name: 'gestion.overview', params: {}, path: 'gestion' };
    var on = A.VIEWS['gestion.overview'].render({});
    ok(on.indexOf('href="#/presupuesto/solicitudes"') >= 0 && on.indexOf('1 por revisar') >= 0, 'admin: franja con 1 por revisar');
    A.LS.set('adminView', false);
    ok(!A.fn('isAdminUI')(), 'isAdminUI() apagado');
    var off = A.VIEWS['gestion.overview'].render({});
    ok(off.indexOf('Solicitudes de compra') < 0 && off.indexOf('#/presupuesto/solicitudes') < 0, 'vista de equipo: sin solicitudes');
    A.LS.set('adminView', true);
    A.S.solicitudes = [{ id: 'SOL-2', estado: 'Vinculada', montoClp: 1, recibido: '2026-10-01T10:00:00.000Z', pr: 'PR1', nombre: 'Y', solicitante: 'Z' }];
    var none = A.VIEWS['gestion.overview'].render({});
    ok(none.indexOf('Solicitudes de compra') < 0, 'nada por revisar: sin franja (ni «todo revisado»)');
  });

  test('v3.1 vgestion · tarjeta de proyecto compacta: barra fina, fechas sólo si existen, hasta 4 pendientes', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load('nat');
    var IDX = A.fn('IDX');
    var withTasks = A.S.projects.filter(function (p) {
      return p.pilar === 'nat' && p.estado !== 'Cerrado' && (IDX.tasksByProject.get(p.id) || []).some(function (t) { return t.estado !== 'Realizada'; });
    });
    ok(withTasks.length >= 2, 'proyectos nat con tareas pendientes');
    var a = withTasks[0], b = withTasks[1];
    a.inicio = ''; a.fin = '';
    b.inicio = day(-10); b.fin = day(40);
    var h = env.pillarHtml('nat');
    function cardOf(id) {
      var i = h.indexOf('data-vg-project="' + id + '"');
      ok(i >= 0, 'tarjeta ' + id);
      var j = h.indexOf('data-vg-project="', i + 20);
      return h.slice(i, j < 0 ? h.length : j);
    }
    var ca = cardOf(a.id), cb = cardOf(b.id);
    ok(ca.indexOf('data-lucide="calendar"') < 0, 'sin fechas: no hay línea de fechas');
    ok(cb.indexOf('data-lucide="calendar"') >= 0, 'con fechas: se muestran');
    var all = IDX.tasksByProject.get(a.id) || [];
    var done = all.filter(function (t) { return t.estado === 'Realizada'; }).length;
    ok(ca.indexOf('role="progressbar"') >= 0 && ca.indexOf('aria-label="' + done + ' de ' + all.length + ' tareas listas"') >= 0, 'barra fina con su detalle accesible');
    ok(ca.indexOf('data-lucide="corner-down-left"') < 0, 'sin pista «Enter»');
    var pend = all.filter(function (t) { return t.estado !== 'Realizada'; }).length;
    ok(count(ca, 'data-task-row') <= 4 || pend > 4, 'hasta 4 pendientes a la vista');
  });
  // v3.6 (SPEC §20): los proyectos de la vista de pilar reciben una tarea soltada desde «Mis tareas» (los cerrados no)
  test('v3.6 vgestion · proyectos de la vista de pilar como destino al soltar (no los cerrados)', function () {
    need('bootstrap');
    fresh('demo');
    var env = sandbox(), A = env.load('cc');
    A.S.ui.gestion = Object.assign(A.S.ui.gestion || {}, { showClosed: true });
    var html = env.pillarHtml('cc');
    // Los proyectos que la vista dibuja (tarjeta o línea compacta)
    var shown = {}, re = /data-action="gestion\.openProject" data-id="([^"]+)"/g, m;
    while ((m = re.exec(html))) shown[m[1]] = 1;
    var ids = Object.keys(shown);
    ok(ids.length, 'la vista muestra proyectos');
    var open = 0;
    ids.forEach(function (id) {
      var p = A.S.projects.find(function (x) { return x.id === id; });
      if (p.estado === 'Cerrado') ok(html.indexOf('data-drop-project="' + id + '"') < 0, 'un proyecto cerrado no recibe tareas: ' + p.nombre);
      else { open++; includes(html, 'data-drop-project="' + id + '"', 'destino: ' + p.nombre); }
    });
    ok(open > 0, 'hay destinos abiertos');
  });
})();
