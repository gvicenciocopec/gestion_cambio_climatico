/* v3.2 · VGestion (SPEC §15): privacidad del alta en línea del pilar.
   - Dentro de un proyecto → privada: false (la ve el equipo).
   - «Tareas sin proyecto» → privada: true (sólo quien la crea y su responsable), salvo que el servidor no sepa quién
     eres → privada: false (el servidor rechaza una privada sin cuenta identificada).
   El JS real de Core.html + VGestion.html corre sin DOM, con google.script.run simulado sobre el servidor emulado. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  function sandbox() {
    var env = { calls: [], net: [], store: {}, picks: [], as: U.gonzalo };
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
            try { res = asUser(env.as, function () { return client.apply(null, [name].concat(args)); }); } catch (e) { err = e; }
            if (err) { if (koFn) koFn(err); } else if (okFn) okFn(res);
          });
        };
      } });
    }
    var code = 'var todoParse = undefined;\n' + src('Core') + '\n' + src('VGestion') + '\n;return {' +
      ' get S() { return S; }, applyBundle: applyBundle, VIEWS: VIEWS, ACTIONS: ACTIONS, VG: VG,' +
      ' setPick: function (f) { pickDate = f; }, fn: function (n) { return eval(n); } };';
    var api = new Function('document', 'window', 'localStorage', 'location', 'google', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'getComputedStyle', code)(
      doc, win, ls, { hash: '' }, { script: { run: chain(null, null) } },
      function () { return 0; }, function () {}, function () { return 0; }, function () { return { getPropertyValue: function () { return ''; } }; });
    env.api = api;
    api.setPick(function (anchor, o) { return new Promise(function (resolve) { env.picks.push({ anchor: anchor, o: o || {}, resolve: resolve }); }); });
    env.pick = function (value) { var p = env.picks.shift(); ok(p, 'no había un selector de fecha abierto'); p.resolve(value); drainMicrotasks(); };
    env.flush = function () { while (env.net.length) { env.net.shift()(); drainMicrotasks(); } drainMicrotasks(); };
    env.saves = function () { return env.calls.filter(function (c) { return c.fn === 'gSave'; }); };
    env.load = function (pilar, who) {
      env.as = who === undefined ? U.gonzalo : who;
      api.applyBundle(asUser(env.as, function () { return client('bootstrap'); }));
      api.S.route = { name: 'gestion.pillar', params: { pilar: pilar }, path: 'gestion/' + pilar };
      return api;
    };
    env.input = function (value) { return { value: value, dataset: {}, focus: function () {} }; };
    env.pillarHtml = function (pk) { return api.VIEWS['gestion.pillar'].render({ pilar: pk }); };
    return env;
  }
  function rowOf(html, id) {
    var i = html.indexOf('data-task-row data-id="' + id + '"');
    ok(i >= 0, 'fila ' + id + ' visible');
    var j = html.indexOf('data-task-row', i + 10);
    return html.slice(i, j < 0 ? html.length : j);
  }
  function openProject(A, pk) {
    var p = A.S.projects.find(function (x) { return x.pilar === pk && x.estado !== 'Cerrado'; });
    ok(p, 'proyecto abierto en ' + pk);
    return p;
  }

  test('v32 vgestion · alta en línea dentro de un proyecto: privada: false (la ve el equipo)', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('ec');
    var p = openProject(A, 'ec');
    A.ACTIONS['gestion.addTask']({ key: p.id }, env.input('Revisar contrato'));
    env.pick(day(2));
    var ent = env.saves()[0].args[0];
    ok(Object.prototype.hasOwnProperty.call(ent, 'privada') && ent.privada === false, 'privada: false explícito');
    eq(ent.avisar, true); eq(ent.proyecto, p.id);
    var tmp = A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); })[0];
    eq(tmp.privada, false, 'la fila temporal también');
    env.flush();
    var real = A.S.tasks.find(function (t) { return t.nombre === 'Revisar contrato'; });
    ok(real && /^TSK-/.test(real.id) && real.privada === false, 'guardada compartida');
    var ina = asUser(U.ina, function () { return client('bootstrap'); });
    ok(ina.tasks.some(function (t) { return t.id === real.id; }), 'Ina la ve');
  });

  test('v32 vgestion · alta en línea «sin proyecto»: privada: true, con candado al instante y sólo para quien la crea', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('ec');
    A.ACTIONS['gestion.addTask']({ key: 'sp-ec' }, env.input('Idea suelta'));
    env.pick('');
    var ent = env.saves()[0].args[0];
    eq(ent.proyecto, ''); eq(ent.pilar, 'ec');
    eq(ent.privada, true, 'sin proyecto → privada');
    var tmp = A.S.tasks.filter(function (t) { return /^tmp-/.test(t.id); })[0];
    eq(tmp.privada, true, 'la temporal ya es privada');
    ok(rowOf(env.pillarHtml('ec'), tmp.id).indexOf('data-lucide="lock"') >= 0, 'candado en la fila temporal');
    env.flush();
    var real = A.S.tasks.find(function (t) { return t.nombre === 'Idea suelta'; });
    ok(real && /^TSK-/.test(real.id), 'creada');
    eq(real.privada, true, 'guardada privada');
    eq(real.creadoPor, U.gonzalo);
    ok(rowOf(env.pillarHtml('ec'), real.id).indexOf('data-lucide="lock"') >= 0, 'candado en la fila real');
    var ina = asUser(U.ina, function () { return client('bootstrap'); });
    ok(!ina.tasks.some(function (t) { return t.id === real.id; }), 'otra persona no la ve');
  });

  test('v32 vgestion · alta en línea «sin proyecto» sin cuenta identificada: privada: false (el servidor la acepta)', function () {
    need('bootstrap', 'gSave');
    fresh('demo');
    var env = sandbox(), A = env.load('nat', '');
    eq(A.S.me.email, 'desconocido', 'el servidor no sabe quién es');
    eq(A.fn('vgQuickPrivada')(null), false, 'sin cuenta: compartida');
    A.ACTIONS['gestion.addTask']({ key: 'sp-nat' }, env.input('Sin cuenta'));
    env.pick('');
    var ent = env.saves()[0].args[0];
    eq(ent.privada, false, 'sin cuenta → compartida');
    env.flush();
    var real = A.S.tasks.find(function (t) { return t.nombre === 'Sin cuenta'; });
    ok(real && /^TSK-/.test(real.id) && real.privada === false, 'el servidor la guardó (compartida)');
    // Por qué: una privada sin cuenta identificada la rechaza el servidor
    throws(function () { asUser('', function () { return gSave(Object.assign({}, ent, { nombre: 'Otra', privada: true })); }); }, /identificar/i);
    // Con cuenta conocida y dentro de un proyecto: nunca privada
    var B = sandbox().load('nat');
    var p = openProject(B, 'nat');
    eq(B.fn('vgQuickPrivada')(p), false, 'proyecto → compartida');
    eq(B.fn('vgQuickPrivada')(null), true, 'sin proyecto → privada');
  });
})();
