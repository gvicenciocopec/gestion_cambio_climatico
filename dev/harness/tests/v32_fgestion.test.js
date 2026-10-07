/* v3.2 · FGestion (SPEC §15): privacidad por defecto del compositor (openTaskForm) y del alta rápida del proyecto.
   - Nueva sin proyecto → Privada; elegir un proyecto la pasa a Compartida si no se tocó el interruptor; quitarlo la devuelve.
   - Editar conserva lo guardado, salvo una privada sin proyecto a la que se le pone uno (→ Compartida si no se tocó).
   - Sin cuenta identificada: siempre Compartida (el interruptor queda bloqueado).
   - Alta rápida del drawer de proyecto: privada: false explícito.
   Las funciones reales de Core + FGestion corren con stubs de red / modal y un nodo raíz falso armado con el HTML real. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  function skipRegex(code, k) {
    var p = k - 1;
    while (p >= 0 && /\s/.test(code[p])) p--;
    if (p >= 0 && !/[(,=:[!&|?{};+\-*%<>~^]/.test(code[p]) && !/\breturn$/.test(code.slice(Math.max(0, p - 6), p + 1))) return -1;
    var cls = false;
    for (var j = k + 1; j < code.length; j++) {
      var c = code[j];
      if (c === '\\') { j++; continue; }
      if (c === '\n') return -1;
      if (cls) { if (c === ']') cls = false; continue; }
      if (c === '[') { cls = true; continue; }
      if (c === '/') return j;
    }
    return -1;
  }
  function block(code, start, label) {
    var i = code.indexOf(start);
    ok(i >= 0, 'no encontré «' + (label || start) + '»');
    var j = code.indexOf('{', i), depth = 0, q = null;
    for (var k = j; k < code.length; k++) {
      var ch = code[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '/' && code[k + 1] === '/') { var nl = code.indexOf('\n', k); k = nl < 0 ? code.length : nl; continue; }
      if (ch === '/') { var e = skipRegex(code, k); if (e > 0) { k = e; continue; } }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return code.slice(i, k + 1);
    }
    __fail('bloque sin cerrar: ' + (label || start));
  }
  function fn(code, name) { return block(code, 'function ' + name + '(', name); }
  function constDecl(code, name) {
    var i = code.indexOf('const ' + name + ' = ');
    ok(i >= 0, 'no encontré const ' + name);
    var depth = 0, q = null;
    for (var k = i + 6 + name.length; k < code.length; k++) {
      var ch = code[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '/' && code[k + 1] === '/') { var nl = code.indexOf('\n', k); k = nl < 0 ? code.length : nl; continue; }
      if (ch === '/') { var e = skipRegex(code, k); if (e > 0) { k = e; continue; } }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
      else if (ch === ';' && depth === 0) return code.slice(i, k + 1);
    }
    __fail('const sin cerrar: ' + name);
  }

  var CORE_CONSTS = ['MESES', 'TONES', 'AVATAR_TONES', 'CLASE_META', 'CX'];
  var CORE_FNS = ['esc', 'safeUrl', 'pad2', 'ymd', 'todayStr', 'parseYmd', 'addDays', 'daysUntil', 'fmtDate', 'fmtDateShort', 'plural', 'normTxt',
    'dataAttrs', 'tone', 'icon', 'PIL', 'userObj', 'userName', 'userColor', 'initials', 'avatar', 'taskPeople', 'avatarStack', 'myEmail'];
  var FG_CONSTS = ['FG_STATE', 'FG_MULTI_PUBLIC', 'FG_DIAS', 'FG_PIL_SHORT', 'FG_SOFT', 'FG_PILL', 'FG_PILL_OFF', 'FG_PILL_ON', 'FG_PILL_LATE', 'FG_MINI', 'FG_MINI_OFF', 'FG_MINI_ON', 'FG_MINI_INPUT'];
  var FG_FNS = ['fgReady', 'fgPilarKey', 'fgCleanEv', 'fgTaskPayload', 'fgApplyTask', 'fgAvisar', 'fgPrivada', 'fgServerMe', 'fgPrivacyBlock', 'fgCanPrivacy', 'fgAnd', 'fgWhoSees',
    'fgDayLabel', 'fgNextDow', 'fgWeekday', 'fgProjCascade', 'fgTaskPilar', 'fgCmpRoot', 'fgCmpHidden', 'fgCmpGet', 'fgCmpAutoPriv', 'fgCmpSet', 'fgCmpChips',
    'fgCmpPils', 'fgCmpHint', 'fgCmpPaint', 'fgCmpPickProject', 'openTaskForm', 'fgQuickText', 'fgQuickAdd',
    'fgPplToggle', 'fgPplOwner', 'fgPplHtml', 'fgCmpPopResp', 'fgCmpPpl', 'openPeoplePicker'];
  var FG_ACTIONS = ["action('task.cmp.toggle'", "action('task.cmp.proj'", "action('project.quickadd'", "action('task.flag'",
    "action('task.cmp.ppl'", "action('task.cmp.owner'"];

  var PID = 'PRJ-00000001', PID2 = 'PRJ-00000002', CLOSED = 'PRJ-00000009';
  var USERS = [{ email: U.ina, name: 'Ina', color: 'violet' }, { email: U.benja, name: 'Benja', color: 'sky' },
    { email: U.ignacio, name: 'Ignacio', color: 'amber' }, { email: U.gonzalo, name: 'Gonzalo', color: 'emerald' }];
  var PILLARS = [{ key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
    { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
    { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' }];

  function env(o) {
    o = o || {};
    var st = { modals: [], mutates: [], optimistic: [], toasts: [], picks: [], actions: {}, els: {}, refresh: 0, repilar: [] };
    var projects = [
      { id: PID, pilar: 'nat', nombre: 'Humedal El Bato', estado: 'Activo', resp: U.ina, lineas: [], evidencias: [], cascade: '' },
      { id: PID2, pilar: 'ec', nombre: 'Zero Waste', estado: 'Activo', resp: '', lineas: [], evidencias: [], cascade: '' },
      { id: CLOSED, pilar: 'cc', nombre: 'Viejo', estado: 'Cerrado', resp: '', lineas: [], evidencias: [], cascade: '' },
    ];
    var tasks = o.tasks || [];
    var S = { me: { email: o.me === undefined ? U.gonzalo : o.me, name: 'Gonzalo', admin: true }, users: USERS, pillars: PILLARS,
      config: { alertDays: 7, notifyDays: 3 }, projects: projects, tasks: tasks, ui: {}, route: { params: {} } };
    var IDX = { project: new Map(projects.map(function (p) { return [p.id, p]; })), task: new Map(tasks.map(function (t) { return [t.id, t]; })),
      cascade: new Map(), commentsByRef: new Map(), tasksByProject: new Map() };
    var stubs = {
      S: S, IDX: IDX,
      LS: { get: function (k, d) { return d; }, set: function () {} },
      toast: function (m, type) { st.toasts.push([m, type || 'success']); },
      refreshIcons: function () {},
      openModal: function (m) { st.modals.push(m); },
      fgSaveHint: function () { return ''; },
      btn: function () { return ''; },
      fgFieldLabel: function () { return ''; },
      cascadePickerHtml: function () { return ''; },
      evidenceEditorHtml: function () { return ''; },
      fgCpkRepilar: function (r, name, pk) { st.repilar.push(pk); },
      fgCpkSet: function () {},
      fgCmpMoreSummary: function () {},
      fgEvSyncUpload: function () {},
      fgCmpPop: function () {},
      fgCmpFocusChip: function () {},
      mutate: function (name, args, opts) { st.mutates.push({ fn: name, args: MOCK.strictClone(args, name), opts: opts || {} }); return Promise.resolve({ partial: 'gestion' }); },
      optimistic: function (apply, name, args) { apply(); st.optimistic.push({ fn: name, args: MOCK.strictClone(args, name) }); return Promise.resolve({ partial: 'gestion' }); },
      pickDate: function (el, opts) { return new Promise(function (res) { st.picks.push({ el: el, opts: opts, res: res }); }); },
      todoParse: undefined,
      currentDrawerKey: function () { return null; },
      refreshDrawer: function () { st.refresh++; },
      setTimeout: function (f) { f(); return 0; },
      document: { activeElement: null, getElementById: function (id) { return st.els[id] || null; }, querySelector: function () { return null; } },
      action: function (name, f) { st.actions[name] = f; },
      window: {},
    };
    var names = Object.keys(stubs);
    var core = src('Core'), fg = src('FGestion');
    var body = CORE_CONSTS.map(function (c) { return constDecl(core, c); }).join('\n') + '\n' +
      CORE_FNS.map(function (n) { return fn(core, n); }).join('\n') + '\n' +
      FG_CONSTS.map(function (c) { return constDecl(fg, c); }).join('\n') + '\n' +
      FG_FNS.map(function (n) { return fn(fg, n); }).join('\n') + '\n' +
      FG_ACTIONS.map(function (a) { return block(fg, a) + ');'; }).join('\n') + '\n' +
      'return {' + FG_FNS.join(',') + ', FG_STATE: FG_STATE };';
    var api = new Function(names.join(','), body).apply(null, names.map(function (k) { return stubs[k]; }));
    api.st = st; api.S = S; api.IDX = IDX;
    api.flush = function () { drainMicrotasks(); drainMicrotasks(); };
    // Abre el compositor y arma un nodo raíz falso con su HTML real (dataset + inputs ocultos + zonas que repinta)
    api.open = function (opts) {
      var n = st.modals.length;
      api.openTaskForm(opts || {});
      eq(st.modals.length, n + 1, 'se abrió el compositor');
      var root = fakeRoot(st.modals[n].body);
      api.fgCmpPaint(root);   // lo mismo que hace onMount
      return root;
    };
    api.pick = function (root, id) { st.actions['task.cmp.proj']({ value: id }, { closest: function () { return root; } }); };
    api.toggle = function (root) { st.actions['task.cmp.toggle']({ key: 'privada' }, { closest: function () { return root; }, disabled: false }); };
    return api;
  }

  function unesc(s) { return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  function fakeRoot(html) {
    var head = /^<div data-fg-cmp([^>]*)>/.exec(html);
    ok(head, 'el compositor empieza con <div data-fg-cmp …>');
    var ds = {}, re = /\sdata-([\w-]+)="([^"]*)"/g, m;
    while ((m = re.exec(head[1]))) ds[m[1].replace(/-([a-z])/g, function (x, c) { return c.toUpperCase(); })] = unesc(m[2]);
    var inputs = {}, ri = /<input type="hidden" data-fg-st name="(\w+)" value="([^"]*)">/g;
    while ((m = ri.exec(html))) inputs[m[1]] = { name: m[1], value: unesc(m[2]) };
    var zones = { '[data-fg-chips]': { innerHTML: '' }, '[data-fg-pils]': { innerHTML: '' }, '[data-fg-hint]': { innerHTML: '' } };
    return {
      dataset: ds, inputs: inputs, zones: zones,
      querySelector: function (sel) {
        var q = /^\[data-fg-st\]\[name="(\w+)"\]$/.exec(sel);
        if (q) return inputs[q[1]] || null;
        return zones[sel] || null;
      },
      querySelectorAll: function () { return []; },
      contains: function () { return false; },
      closest: function () { return null; },
    };
  }
  function priv(root) { return root.inputs.privada.value; }
  function chips(root) { return root.zones['[data-fg-chips]'].innerHTML; }
  function hint(root) { return root.zones['[data-fg-hint]'].innerHTML; }
  var PRIV_ON = /role="switch" aria-checked="true" data-action="task\.cmp\.toggle" data-key="privada"/;
  var PRIV_OFF = /role="switch" aria-checked="false" data-action="task\.cmp\.toggle" data-key="privada"/;

  test('v32 fgestion · compositor nuevo: privada sin proyecto, compartida con proyecto (también un proyecto cerrado se ignora)', function () {
    var E = env();
    var r = E.open({});
    eq(priv(r), '1', 'sin proyecto → Privada');
    eq(r.dataset.privTouched, '0', 'el interruptor parte sin tocar');
    ok(PRIV_ON.test(chips(r)) && /Privada<\/button>/.test(chips(r)), 'la píldora muestra Privada');
    eq(E.open({ proyecto: PID }).inputs.privada.value, '0', 'con proyecto → Compartida');
    eq(E.open({ proyecto: CLOSED }).inputs.privada.value, '1', 'proyecto cerrado (se ignora) → sin proyecto → Privada');
    eq(E.open({ pilar: 'cc' }).inputs.privada.value, '1', 'con pilar pero sin proyecto → Privada');
  });

  test('v32 fgestion · compositor nuevo: elegir proyecto → Compartida, quitarlo → Privada (sin tocar el interruptor)', function () {
    var E = env();
    var r = E.open({});
    E.pick(r, PID);
    eq(r.inputs.proyecto.value, PID);
    eq(priv(r), '0', 'con proyecto pasa a Compartida');
    ok(PRIV_OFF.test(chips(r)) && /Compartida<\/button>/.test(chips(r)), 'la píldora se repinta');
    E.pick(r, PID2);
    eq(priv(r), '0', 'cambiar de proyecto: sigue Compartida');
    E.pick(r, '');
    eq(r.inputs.proyecto.value, '');
    eq(priv(r), '1', 'sin proyecto vuelve a Privada');
    ok(PRIV_ON.test(chips(r)), 'píldora en Privada');
    eq(hint(r).indexOf('planilla'), -1, 'la privada por defecto no agrega texto (§14.4)');
    // Abierto desde un proyecto y luego se le quita
    var r2 = E.open({ proyecto: PID });
    E.pick(r2, '');
    eq(priv(r2), '1', 'abierto en un proyecto y quitado → Privada');
  });

  test('v32 fgestion · compositor nuevo: si la persona toca el interruptor, el proyecto ya no lo cambia', function () {
    var E = env();
    var r = E.open({});
    E.toggle(r);
    eq(priv(r), '0', 'la hizo compartida a mano');
    eq(r.dataset.privTouched, '1', 'queda marcado como tocado');
    E.pick(r, PID); eq(priv(r), '0');
    E.pick(r, ''); eq(priv(r), '0', 'quitar el proyecto no la vuelve privada (la persona eligió)');
    // Privada a propósito dentro de un proyecto
    var r2 = E.open({});
    E.toggle(r2); E.toggle(r2);
    eq(priv(r2), '1', 'ida y vuelta: Privada, ahora elegida');
    ok(/planilla/.test(hint(r2)), 'elegida a mano: se explica quién la ve y que queda en la planilla');
    E.pick(r2, PID);
    eq(priv(r2), '1', 'una privada elegida a mano sigue privada con proyecto');
    // Abierto en un proyecto (Compartida), tocado a Privada: quitar / poner proyecto no la mueve
    var r3 = E.open({ proyecto: PID });
    E.toggle(r3);
    eq(priv(r3), '1');
    E.pick(r3, ''); E.pick(r3, PID2);
    eq(priv(r3), '1', 'tocado: manda la persona');
  });

  test('v32 fgestion · compositor sin cuenta identificada: siempre Compartida y el interruptor bloqueado', function () {
    var E = env({ me: 'desconocido' });
    var r = E.open({});
    eq(priv(r), '0', 'sin cuenta → Compartida (una privada no la vería nadie)');
    eq(r.dataset.canPriv, '0');
    ok(/data-key="privada" disabled title="No pude identificar tu cuenta/.test(chips(r)), 'bloqueado con su motivo');
    E.pick(r, PID); eq(priv(r), '0');
    E.pick(r, ''); eq(priv(r), '0', 'quitar el proyecto no la vuelve privada');
    E.toggle(r); eq(priv(r), '0', 'el interruptor no hace nada');
    var E2 = env({ me: '' });
    eq(E2.open({}).inputs.privada.value, '0', 'correo vacío: igual');
  });

  test('v32 fgestion · compositor al editar: conserva lo guardado; privada sin proyecto + proyecto → Compartida', function () {
    var E = env({ tasks: [
      { id: 'TSK-1', nombre: 'Personal privada', pilar: '', proyecto: '', privada: true, avisar: true, estado: 'Pendiente', resp: U.gonzalo, creadoPor: U.gonzalo, evidencias: [], actualizado: 'v1' },
      { id: 'TSK-2', nombre: 'Privada en proyecto', pilar: 'nat', proyecto: PID, privada: true, avisar: true, estado: 'Pendiente', resp: U.gonzalo, creadoPor: U.gonzalo, evidencias: [], actualizado: 'v1' },
      { id: 'TSK-3', nombre: 'Personal compartida', pilar: 'cc', proyecto: '', privada: false, avisar: true, estado: 'Pendiente', resp: U.gonzalo, creadoPor: U.gonzalo, evidencias: [], actualizado: 'v1' },
      { id: 'TSK-4', nombre: 'Compartida en proyecto', pilar: 'nat', proyecto: PID, privada: false, avisar: true, estado: 'Pendiente', resp: U.ina, creadoPor: U.ina, evidencias: [], actualizado: 'v1' },
      { id: 'TSK-5', nombre: 'De Ina, privada', pilar: '', proyecto: '', privada: true, avisar: true, estado: 'Pendiente', resp: U.ina, creadoPor: U.ina, evidencias: [], actualizado: 'v1' },
    ] });
    // 1) Privada sin proyecto: poner uno → Compartida; quitarlo → vuelve a lo guardado (Privada)
    var r1 = E.open({ id: 'TSK-1' });
    eq(priv(r1), '1', 'abre con lo guardado');
    eq(r1.dataset.privStored, '1');
    E.pick(r1, PID); eq(priv(r1), '0', 'con proyecto pasa a Compartida');
    E.pick(r1, ''); eq(priv(r1), '1', 'sin proyecto vuelve a Privada');
    // …pero si la tocó antes, manda la persona
    var r1b = E.open({ id: 'TSK-1' });
    E.toggle(r1b); E.toggle(r1b);
    E.pick(r1b, PID); eq(priv(r1b), '1', 'tocada: sigue Privada con proyecto');
    // 2) Privada que ya tenía proyecto: quitarlo o cambiarlo no la toca
    var r2 = E.open({ id: 'TSK-2' });
    eq(priv(r2), '1');
    E.pick(r2, ''); eq(priv(r2), '1', 'quitar el proyecto: se conserva Privada');
    E.pick(r2, PID2); eq(priv(r2), '1', 'otro proyecto: se conserva Privada');
    // 3) Compartida sin proyecto: queda compartida en todo momento
    var r3 = E.open({ id: 'TSK-3' });
    eq(priv(r3), '0');
    E.pick(r3, PID); eq(priv(r3), '0');
    E.pick(r3, ''); eq(priv(r3), '0', 'editar no la vuelve privada');
    // 4) Compartida con proyecto: quitarle el proyecto no la vuelve privada
    var r4 = E.open({ id: 'TSK-4' });
    E.pick(r4, ''); eq(priv(r4), '0', 'editar conserva Compartida');
    // 5) Sin permiso para cambiar la privacidad: nada automático
    var r5 = E.open({ id: 'TSK-5' });
    eq(r5.dataset.canPriv, '0');
    E.pick(r5, PID); eq(priv(r5), '1', 'no es suya: no se cambia sola');
  });

  test('v32 fgestion · fgCmpAutoPriv: tabla de casos (pura)', function () {
    var E = env();
    var A = E.fgCmpAutoPriv;
    eq(A({ create: true, canPriv: true }, ''), true, 'nueva sin proyecto');
    eq(A({ create: true, canPriv: true }, PID), false, 'nueva con proyecto');
    eq(A({ create: true, canPriv: false }, ''), null, 'sin cuenta: no se toca');
    eq(A({ create: true, canPriv: true, privTouched: true }, PID), null, 'tocada: no se toca');
    eq(A({ create: false, canPriv: true, privStored: true, hadProj: false }, PID), false, 'editar privada sin proyecto + proyecto');
    eq(A({ create: false, canPriv: true, privStored: true, hadProj: false }, ''), true, '… y quitado de nuevo');
    eq(A({ create: false, canPriv: true, privStored: true, hadProj: true }, ''), true, 'editar privada con proyecto: lo guardado');
    eq(A({ create: false, canPriv: true, privStored: false, hadProj: false }, ''), false, 'editar compartida: lo guardado');
    eq(A(null, ''), null);
  });

  test('v32 fgestion · el compositor envía la privacidad elegida; el drawer de tarea sigue igual (task.flag)', function () {
    var code = src('FGestion');
    var tf = fn(code, 'openTaskForm');
    // v3.6 (SPEC §20): con varias personas siempre va pública
    ok(/avisar: st\.avisar, privada: st\.asignados\.length \? false : st\.privada/.test(tf), 'el payload lleva la privacidad elegida (pública con varias personas)');
    // task.flag: sólo la tarea, al instante (v3.4, SPEC §18: sin versión)
    var E = env({ tasks: [{ id: 'TSK-1', nombre: 'X', pilar: '', proyecto: '', privada: true, avisar: true, estado: 'Pendiente', resp: U.gonzalo, creadoPor: U.gonzalo, evidencias: [], actualizado: 'v7' }] });
    E.st.actions['task.flag']({ id: 'TSK-1', key: 'privada', value: '0' }, null);
    E.flush();
    eq(E.st.optimistic.length, 1);
    deepEq(E.st.optimistic[0].args[0], { tipo: 'Tarea', id: 'TSK-1', privada: false }, 'drawer: cambio puntual, sin versión');
    eq(E.IDX.task.get('TSK-1').privada, false, 'aplicado localmente');
  });

  test('v32 fgestion · alta rápida del proyecto: privada: false explícito (y el servidor la deja compartida)', function () {
    need('gSave');
    var E = env();
    var input = { value: 'Enviar fotos', dataset: {}, focus: function () {} };
    E.st.els['fg-qa-' + PID] = input;
    E.st.actions['project.quickadd']({ id: PID }, input);
    E.st.picks[0].res(day(3));
    E.flush();
    eq(E.st.mutates.length, 1);
    var pay = E.st.mutates[0].args[0];
    ok(Object.prototype.hasOwnProperty.call(pay, 'privada') && pay.privada === false, 'privada: false explícito');
    eq(pay.proyecto, PID); eq(pay.avisar, true);
    eq(E.FG_STATE.qa.length, 0, 'sin filas temporales colgando');
    // Contra el servidor real: dentro de un proyecto, compartida y visible para el equipo
    fresh('demo');
    var b = client('bootstrap');
    var p = b.projects.find(function (x) { return x.estado !== 'Cerrado'; });
    var real = Object.assign({}, pay, { proyecto: p.id, pilar: p.pilar, cascade: '' });
    var r = asUser(U.gonzalo, function () { return client('gSave', real); });
    var t = r.tasks.find(function (x) { return x.id === r.lastId; });
    ok(t && t.privada === false, 'guardada compartida');
    var other = asUser(U.ina, function () { return client('bootstrap'); });
    ok(other.tasks.some(function (x) { return x.id === r.lastId; }), 'el equipo la ve');
  });
  /* ---------------- v3.6 (SPEC §20): varias personas ---------------- */

  test('v3.6 fgestion · personas: tocar suma o quita; «Hacer responsable» elige quién queda a cargo', function () {
    var E = env();
    var st = { resp: U.gonzalo, asignados: [] };
    E.fgPplToggle(st, U.ina); deepEq(st, { resp: U.gonzalo, asignados: [U.ina] }, 'suma a Ina');
    E.fgPplToggle(st, U.benja); deepEq(st.asignados, [U.ina, U.benja], 'y a Benja');
    E.fgPplOwner(st, U.benja); eq(st.resp, U.benja, 'Benja a cargo'); deepEq(st.asignados, [U.gonzalo, U.ina], 'el anterior queda como persona');
    E.fgPplToggle(st, U.benja); eq(st.resp, U.gonzalo, 'quitar al responsable: el siguiente queda a cargo'); deepEq(st.asignados, [U.ina]);
    E.fgPplToggle(st, U.ina); deepEq(st.asignados, [], 'quita a Ina');
    E.fgPplToggle(st, U.gonzalo); eq(st.resp, '', 'sin nadie');
    E.fgPplToggle(st, U.ina); eq(st.resp, U.ina, 'el primero que se toca queda a cargo');
    var h = E.fgPplHtml({ resp: U.gonzalo, asignados: [U.ina] });
    includes(h, '>Responsable</span>', 'insignia del responsable');
    includes(h, 'data-ppl-owner="' + U.ina + '"', '«Hacer responsable» para las demás');
    ok(/data-ppl-toggle="[^"]+" role="checkbox" aria-checked="true"/.test(h), 'casillas marcadas');
    includes(h, 'la tarea es del equipo (pública)', 'avisa que con varias personas es pública');
    includes(E.fgPplHtml({ resp: U.gonzalo, asignados: [] }, 'cmp'), 'data-action="task.cmp.ppl" data-value="' + U.ina + '"', 'en el compositor usa acciones');
  });

  test('v3.6 fgestion · compositor: sumar personas la deja pública (interruptor bloqueado) y guarda sólo lo cambiado', function () {
    var E = env({ tasks: [{ id: 'TSK-1', nombre: 'Mía', pilar: '', proyecto: '', privada: true, avisar: true, estado: 'Pendiente', resp: U.gonzalo, asignados: [],
      creadoPor: U.gonzalo, evidencias: [], actualizado: 'v1' }] });
    var r = E.open({ id: 'TSK-1' });
    eq(r.inputs.privada.value, '1', 'abre privada');
    E.st.actions['task.cmp.ppl']({ value: U.ina }, { closest: function () { return r; } });
    eq(r.inputs.asignados.value, U.ina, 'Ina sumada');
    eq(r.inputs.privada.value, '0', 'con dos personas pasa a pública');
    var chips = E.fgCmpChips(E.fgCmpGet(r));
    ok(/data-key="privada" disabled title="Con varias personas/.test(chips), 'interruptor bloqueado con su motivo');
    includes(chips, 'Para mí +1', 'la píldora cuenta a las personas');
    E.st.actions['task.cmp.owner']({ value: U.ina }, { closest: function () { return r; } });
    eq(r.inputs.resp.value, U.ina, 'Ina queda a cargo'); eq(r.inputs.asignados.value, U.gonzalo);
  });

  test('v3.6 fgestion · ventana «Personas»: guarda al instante (pública con varias) y no llama si no cambió nada', function () {
    var t = { id: 'TSK-7', nombre: 'Con equipo', pilar: '', proyecto: '', privada: true, avisar: true, estado: 'Pendiente', resp: U.gonzalo, asignados: [],
      creadoPor: U.gonzalo, evidencias: [], actualizado: 'v1' };
    var E = env({ tasks: [t] });
    function picker() {
      E.openPeoplePicker('TSK-7');
      var m = E.st.modals[E.st.modals.length - 1];
      var box = { innerHTML: '', querySelector: function () { return null; } }, handler = null, closed = 0;
      m.onMount({ querySelector: function () { return box; }, addEventListener: function (type, f) { handler = f; } }, function () { closed++; });
      function press(attr, value) {
        var b = { hasAttribute: function (a) { return a === attr; }, getAttribute: function (a) { return a === attr ? value : null; } };
        handler({ target: { closest: function () { return b; } }, preventDefault: function () {} });
      }
      return { m: m, box: box, press: press, closed: function () { return closed; } };
    }
    var P = picker();
    includes(P.m.body, 'data-ppl-toggle="' + U.ina + '"');
    P.press('data-ppl-toggle', U.ina);
    includes(P.box.innerHTML, 'data-ppl-owner="' + U.ina + '"', 'se redibuja con Ina marcada');
    P.press('data-ppl-save', '');
    eq(P.closed(), 1, 'se cierra al guardar');
    deepEq(E.st.optimistic[0], { fn: 'gSave', args: [{ tipo: 'Tarea', id: 'TSK-7', resp: U.gonzalo, asignados: [U.ina], privada: false }] });
    deepEq(t.asignados, [U.ina], 'cambio local al instante'); eq(t.privada, false, 'pública');
    ok(E.st.toasts.some(function (x) { return /2 personas/.test(x[0]); }), 'avisa que ahora son 2 personas');
    var Q = picker();
    Q.press('data-ppl-save', '');
    eq(E.st.optimistic.length, 1, 'sin cambios no llama al servidor');
  });
})();
