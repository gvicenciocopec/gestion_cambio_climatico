/* v3 · FGestion (SPEC §13): check task.toggle (único dueño), taskRow (data-task-row, .task-title, candado, campana),
   compositor de tareas (payloads, pilar opcional, privacidad, avisos), fechas de proyecto (inicio / término) y
   comentario de cierre opcional. Las funciones del cliente se extraen del .html y se evalúan con las de Core
   (o stubs mínimos); los payloads se prueban contra el servidor real con client(). */
(function () {
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function tick() { var t = Date.now(); while (Date.now() <= t) { /* espera activa: otro "Actualizado" */ } }

  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  // Salta un literal de regex que empieza en code[k] === '/' (si por el contexto lo es); devuelve el índice final o -1
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
  // Recorta desde `start` hasta el cierre del primer bloque { … } (ignora strings, regex y comentarios //)
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
  // `const NOMBRE = …;` completo (objetos, arrays, strings), respetando strings y llaves
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

  var CORE_FNS = ['esc', 'safeUrl', 'pad2', 'ymd', 'todayStr', 'parseYmd', 'addDays', 'daysUntil', 'fmtDate', 'fmtDateShort', 'plural', 'normTxt',
    'tone', 'icon', 'checkButton', 'PIL', 'dueInfo', 'userObj', 'userName', 'userColor', 'initials', 'avatar', 'taskPeople', 'avatarStack', 'cascadeLabel', 'myEmail', 'shortUrl'];
  var CORE_CONSTS = ['MESES', 'TONES', 'AVATAR_TONES', 'CLASE_META'];
  var FG_FNS = ['fgPilarKey', 'fgCleanEv', 'fgAvisar', 'fgPrivada', 'fgServerMe', 'fgPrivacyBlock', 'fgCanPrivacy', 'fgAnd', 'fgWhoSees',
    'fgSoftChip', 'fgPillarChip', 'fgDayLabel', 'fgNextDow', 'fgRange', 'fgWeekday', 'fgRelDays', 'fgCheck', 'fgDueChip', 'fgCascadeChip', 'taskRow',
    'fgTaskPayload', 'fgProjectPayload', 'fgCmpStr', 'fgCmpChips', 'fgCmpPils', 'fgCmpHint', 'fgCmpPopProyecto', 'fgTaskPilar'];
  var FG_CONSTS = ['FG_STATE', 'FG_DIAS', 'FG_PIL_SHORT', 'FG_SOFT', 'FG_PILL', 'FG_PILL_OFF', 'FG_PILL_ON', 'FG_PILL_LATE', 'FG_MINI', 'FG_MINI_OFF', 'FG_MINI_ON', 'FG_MINI_INPUT'];

  // Entorno del cliente: S / IDX mínimos + funciones reales de Core y FGestion
  function env(o) {
    o = o || {};
    var S = {
      me: { email: o.me === undefined ? U.gonzalo : o.me, name: 'Gonzalo', admin: true },
      users: [{ email: U.ina, name: 'Ina', color: 'violet' }, { email: U.benja, name: 'Benja', color: 'sky' },
        { email: U.ignacio, name: 'Ignacio', color: 'amber' }, { email: U.gonzalo, name: 'Gonzalo', color: 'emerald' }],
      pillars: [{ key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
        { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
        { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' }],
      config: { alertDays: 7, notifyDays: 3 },
      projects: o.projects || [],
      route: { params: o.route || {} },
    };
    var IDX = { project: new Map(S.projects.map(function (p) { return [p.id, p]; })), cascade: new Map(), commentsByRef: new Map(), task: new Map() };
    var LS = { get: function (k, d) { return d; }, set: function () {} };
    var core = src('Core'), fg = src('FGestion');
    var body = CORE_CONSTS.map(function (c) { return constDecl(core, c); }).join('\n') + '\n' +
      CORE_FNS.map(function (n) { return fn(core, n); }).join('\n') + '\n' +
      FG_CONSTS.map(function (c) { return constDecl(fg, c); }).join('\n') + '\n' +
      FG_FNS.map(function (n) { return fn(fg, n); }).join('\n') + '\n' +
      'return {' + FG_FNS.concat(['S', 'IDX', 'FG_STATE']).join(',') + '};';
    return new Function('S', 'IDX', 'LS', body)(S, IDX, LS);
  }

  test('v3 fgestion · task.toggle: un solo dueño (FGestion) y completa / reabre sin confirmar', function () {
    var count = 0, owner = '';
    Object.keys(MOCK.files).forEach(function (f) {
      if (!/\.html$/.test(f) && MOCK.files[f].indexOf('<script') < 0) return;
      var n = (MOCK.files[f].match(/action\('task\.toggle'/g) || []).length;
      if (n) { count += n; owner = f; }
    });
    eq(count, 1, 'action(\'task.toggle\') se registra una sola vez');
    ok(/FGestion/.test(owner), 'lo registra FGestion (no ' + owner + ')');
    var code = src('FGestion');
    var reg = {}, calls = [];
    var tasks = { 'TSK-1': { id: 'TSK-1', estado: 'Pendiente' }, 'TSK-2': { id: 'TSK-2', estado: 'Realizada' } };
    var IDX = { task: new Map(Object.keys(tasks).map(function (k) { return [k, tasks[k]]; })) };
    var st = { stack: [], busy: {}, tapAt: {} };
    new Function('action', 'IDX', 'FG_STATE', 'PENDING', 'completeTask', 'reopenTask', 'openCompleteTask', 'mutate',
      block(code, "action('task.toggle'", 'task.toggle') + ');')(
      function (n, f) { reg[n] = f; }, IDX, st, 0,
      function (id, el) { calls.push(['complete', id, el]); }, function (id) { calls.push(['reopen', id]); },
      function (id) { calls.push(['modal', id]); }, function () { calls.push(['mutate']); });
    var el = { tag: 'chk' };
    reg['task.toggle']({ id: 'TSK-1' }, el);
    deepEq(calls[0], ['complete', 'TSK-1', el], 'pendiente → completeTask(id, el)');
    reg['task.toggle']({ id: 'TSK-1' }, el);
    eq(calls.length, 1, 'un segundo toque inmediato se ignora (la animación aún corre)');
    reg['task.toggle']({ id: 'TSK-2' }, el);
    deepEq(calls[1], ['reopen', 'TSK-2'], 'lista → reopenTask(id), sin diálogo de confirmación');
    reg['task.toggle']({ id: 'TSK-404' }, el);
    eq(calls.length, 2, 'una tarea que no existe no hace nada');
    ok(code.indexOf('function fgReopen(') < 0 && code.indexOf('fgStatusBtn') < 0, 'se eliminó el botón / diálogo v2');
  });

  test('v3 fgestion · taskRow: check animable, data-task-row, .task-title y candado (v3.1: sin campana)', function () {
    var E = env();
    var t = { id: 'TSK-9', nombre: 'Medir <huella>', estado: 'Pendiente', resp: U.ina, fecha: day(2), pilar: 'cc', proyecto: '', evidencias: [], privada: true, avisar: false };
    var h = E.taskRow(t, { showPillar: true });
    ok(/^<div data-task-row data-id="TSK-9" data-action="task.open"/.test(h), 'fila con data-task-row + task.open');
    ok(h.indexOf('data-action="task.toggle" data-id="TSK-9"') >= 0, 'check con la acción task.toggle');
    ok(h.indexOf('class="chk ') >= 0, 'usa checkButton de Core (animación)');
    ok(h.indexOf('<span class="task-title">Medir &lt;huella&gt;</span>') >= 0, 'título escapado dentro de .task-title');
    ok(h.indexOf('data-lucide="lock"') >= 0, 'candado si es privada');
    // v3.1 (SPEC §14.4): la fila es título + vencimiento + avatar (+ candado); «sin avisos» se ve en el drawer
    ok(h.indexOf('bell-off') < 0, 'v3.1: la fila ya no muestra la campana tachada');
    ok(h.indexOf('ring-1') < 0, 'chips suaves (sin anillo)');
    ok(h.indexOf('En 2 días') >= 0 && h.indexOf('bg-amber-50') >= 0, 'vencimiento cercano en ámbar');
    var h2 = E.taskRow({ id: 'TSK-8', nombre: 'Normal', estado: 'Pendiente', resp: U.ina, fecha: '', pilar: 'cc', evidencias: [] });
    ok(h2.indexOf('data-lucide="lock"') < 0 && h2.indexOf('bell-off') < 0, 'sin campos v3 → compartida y con avisos (bundles viejos)');
    ok(h2.indexOf('Sin fecha') < 0, 'sin fecha no muestra un chip de ruido');
    var late = E.taskRow({ id: 'TSK-7', nombre: 'Atrasada', estado: 'Pendiente', resp: U.ina, fecha: day(-3), pilar: 'cc', evidencias: [] });
    ok(late.indexOf('bg-red-50') >= 0 && late.indexOf('Atrasada · 3 d') >= 0, 'sólo lo atrasado va en rojo');
    var done = E.taskRow({ id: 'TSK-6', nombre: 'Lista', estado: 'Realizada', completada: day(0), resp: U.ina, pilar: 'cc', evidencias: [], avisar: false });
    ok(done.indexOf('aria-pressed="true"') >= 0 && done.indexOf('line-through') >= 0, 'lista: check lleno y título tachado');
    ok(done.indexOf('bell-off') < 0, 'una tarea lista no muestra la campana');
    var extra = E.taskRow(t, { lead: '<i data-x></i>', trail: '<b data-y></b>', attrs: 'draggable="true"', showResp: false });
    ok(extra.indexOf('draggable="true"') > 0 && extra.indexOf('<i data-x></i>') > 0 && /<b data-y><\/b><\/div>$/.test(extra), 'lead / trail / attrs para otras vistas');
    ok(extra.indexOf('avatar') < 0 && extra.indexOf('Ina') < 0, 'showResp:false oculta el responsable');
  });

  test('v3 fgestion · privacidad: quién la ve (tú e Ina) y quién puede cambiarla', function () {
    var E = env();
    eq(E.fgAnd('tú', 'Ina'), 'tú e Ina');
    eq(E.fgAnd('tú', 'Ignacio'), 'tú e Ignacio');
    eq(E.fgAnd('tú', 'Benja'), 'tú y Benja');
    eq(E.fgWhoSees({ creadoPor: U.gonzalo }, true, U.ina), 'Sólo tú e Ina la ven en la app');
    eq(E.fgWhoSees({ creadoPor: U.gonzalo }, true, U.gonzalo), 'Sólo tú la ves en la app');
    eq(E.fgWhoSees({ creadoPor: U.benja }, true, U.gonzalo), 'Sólo tú y Benja la ven en la app');
    eq(E.fgWhoSees(null, true, ''), 'Sólo tú la ves en la app', 'al crear sin responsable');
    eq(E.fgWhoSees({}, false, U.ina), 'Todo el equipo la ve en la app');
    ok(E.fgCanPrivacy(null), 'al crear se puede elegir');
    ok(E.fgCanPrivacy({ id: 'T', creadoPor: U.gonzalo, resp: U.ina }), 'quien la creó');
    ok(E.fgCanPrivacy({ id: 'T', creadoPor: U.ina, resp: U.gonzalo }), 'su responsable');
    ok(!E.fgCanPrivacy({ id: 'T', creadoPor: U.ina, resp: U.benja }), 'otra persona no (la perdería de vista)');
    var anon = env({ me: 'desconocido' });
    ok(!anon.fgCanPrivacy(null), 'sin cuenta identificada no se ofrece privada (el servidor la rechaza)');
    ok(/identificar tu cuenta/.test(anon.fgPrivacyBlock(null)), 'y se explica por qué');
  });

  test('v3 fgestion · compositor: píldoras, pilar opcional, ayuda de avisos y privacidad', function () {
    var E = env({ projects: [
      { id: 'PRJ-A', pilar: 'ec', nombre: 'Zero Waste', estado: 'Activo' },
      { id: 'PRJ-B', pilar: 'cc', nombre: 'Huella 2026', estado: 'En pausa' },
      { id: 'PRJ-C', pilar: 'cc', nombre: 'Viejo', estado: 'Cerrado' },
    ] });
    var st = { fecha: day(2), resp: U.ina, proyecto: '', pilar: '', avisar: true, privada: true, canPriv: true, create: true, creator: '', pop: 'fecha' };
    var chips = E.fgCmpChips(st);
    ok(chips.indexOf('data-pop="fecha" aria-expanded="true"') >= 0, 'la píldora abierta lo indica');
    ok(chips.indexOf('Para Ina') >= 0, 'responsable elegido');
    ok(/role="switch" aria-checked="true" data-action="task\.cmp\.toggle" data-key="avisar"/.test(chips), 'Avisarme encendido por defecto');
    ok(/aria-checked="true" data-action="task\.cmp\.toggle" data-key="privada"/.test(chips) && chips.indexOf('Privada') >= 0, 'privada');
    var pils = E.fgCmpPils(st);
    ['Clima', 'Circular', 'Naturaleza', 'Ninguno'].forEach(function (x) { ok(pils.indexOf('>' + x + '<') >= 0, 'mini-chip ' + x); });
    ok(/data-value="" aria-pressed="true"/.test(pils), '«Ninguno» marcado (tarea personal)');
    eq(E.fgCmpPils(Object.assign({}, st, { proyecto: 'PRJ-A' })), '', 'con proyecto el pilar lo pone el proyecto');
    var hint = E.fgCmpHint(st);
    ok(!/correo/.test(hint), 'v3.3 (SPEC §17): ya no hay aviso al crearla; la ayuda no habla de correos');
    ok(/un correo si pasa la fecha sin estar lista/.test(chips), 'el interruptor Avisarme explica el único aviso');
    ok(/sólo tú e Ina la ven en la app/.test(hint) && /planilla/.test(hint), 'privada: quién la ve + aclara que queda en la planilla');
    // v3.1 (SPEC §14.4): sólo avisos que evitan sorpresas; lo rutinario queda en el title del interruptor Avisarme
    eq(E.fgCmpHint(Object.assign({}, st, { fecha: day(10), privada: false })), '', 'v3.1: fecha lejana sin texto rutinario');
    eq(E.fgCmpHint(Object.assign({}, st, { avisar: false, privada: false })), '', 'v3.1: avisos apagados ya se ven en la píldora');
    ok(/nadie recibirá el aviso/.test(E.fgCmpHint(Object.assign({}, st, { fecha: day(10), resp: '', privada: false }))), 'sin responsable: sí avisa (evita un error)');
    eq(E.fgCmpHint(Object.assign({}, st, { done: true, privada: false })), '', 'una tarea lista no habla de avisos');
    var dis = E.fgCmpChips(Object.assign({}, st, { canPriv: false, privBlock: 'Sólo quien la creó' }));
    ok(/data-key="privada" disabled title="Sólo quien la creó"/.test(dis), 'privacidad bloqueada con su motivo');
    // Selector de proyecto: no cerrados (salvo el actual al editar), el pilar elegido primero
    var pop = E.fgCmpPopProyecto({ pilar: 'cc', proyecto: '' }, '');
    ok(pop.indexOf('Viejo') < 0, 'sin proyectos cerrados');
    ok(pop.indexOf('Huella 2026') < pop.indexOf('Zero Waste'), 'el pilar de la tarea primero');
    ok(pop.indexOf('En pausa') >= 0, 'muestra el estado si no está activo');
    ok(/data-value="" data-fg-popt data-none/.test(pop), 'opción «Sin proyecto»');
    ok(E.fgCmpPopProyecto({ pilar: 'cc', proyecto: 'PRJ-C' }, 'PRJ-C').indexOf('Viejo') >= 0, 'al editar conserva el cerrado actual');
    // Pilar por defecto de una tarea nueva: proyecto → indicado → ruta → ninguno
    eq(E.fgTaskPilar('', E.IDX.project.get('PRJ-A')), 'ec');
    eq(E.fgTaskPilar('nat', null), 'nat');
    eq(env({ route: { pilar: 'cc' } }).fgTaskPilar('', null), 'cc', 'desde la ruta del pilar');
    eq(E.fgTaskPilar('', null), '', 'sin contexto: tarea personal');
  });

  test('v3 fgestion · fechas amables: Hoy / Mañana / Vie 9 oct y plazos de proyecto', function () {
    var E = env();
    eq(E.fgDayLabel(day(0)), 'Hoy');
    eq(E.fgDayLabel(day(1)), 'Mañana');
    var wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    eq(E.fgDayLabel('2031-01-10'), wd[new Date(2031, 0, 10).getDay()] + ' 10 ene 2031', 'otro año: con el año');
    var d9 = day(9), dt9 = new Date(+d9.slice(0, 4), +d9.slice(5, 7) - 1, +d9.slice(8, 10));
    eq(E.fgDayLabel(d9), wd[dt9.getDay()] + ' ' + dt9.getDate() + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][dt9.getMonth()] +
      (dt9.getFullYear() !== new Date().getFullYear() ? ' ' + dt9.getFullYear() : ''), 'formato «Vie 9 oct»');
    for (var dow = 0; dow < 7; dow++) {
      var d = E.fgNextDow(dow);
      var dt = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
      eq(dt.getDay(), dow, 'fgNextDow(' + dow + ') cae ese día');
      var diff = Math.round((dt - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
      ok(diff >= 1 && diff <= 7, 'siempre después de hoy (dentro de 7 días)');
    }
    eq(E.fgRange('2026-01-01', '2026-12-30'), '1 ene → 30 dic 2026');
    eq(E.fgRange('2026-11-01', '2027-02-01'), '1 nov 2026 → 1 feb 2027');
    eq(E.fgRange('2026-03-01', ''), 'Desde el 1 mar 2026');
    eq(E.fgRange('', ''), '');
  });

  // v3.4 (SPEC §18, cambio intencional): sin versión (base); el último cambio gana
  test('v3 fgestion · payloads: fgTaskPayload / fgProjectPayload (sin base; inicio / término)', function () {
    var E = env();
    var nuevo = E.fgTaskPayload({}, { nombre: 'X', pilar: '', base: 'zzz' });
    ok(!('id' in nuevo) && !('base' in nuevo), 'al crear: sin id ni base');
    eq(nuevo.avisar, true, 'avisar por defecto'); eq(nuevo.privada, false, 'compartida por defecto');
    var t = { id: 'TSK-1', pilar: 'cc', nombre: 'T', evidencias: [{ t: 'a', u: 'https://x.cl' }, { t: 'mal', u: 'javascript:alert(1)' }], avisar: false, privada: true, actualizado: '2026-10-01T10:00:00.000Z' };
    var p = E.fgTaskPayload(t, { cierre: 'ok' });
    ok(!('base' in p), 'al editar tampoco hay base');
    eq(p.avisar, false); eq(p.privada, true); eq(p.cierre, 'ok');
    deepEq(p.evidencias, [{ t: 'a', u: 'https://x.cl' }], 'sólo links http(s)');
    ok(!('base' in E.fgTaskPayload(t, { base: 'abierto' })), 'aunque over traiga base');
    var pr = E.fgProjectPayload({ id: 'PRJ-1', pilar: 'cc', nombre: 'P', inicio: '2026-01-01', fin: '2026-06-30', actualizado: 'v1' });
    eq(pr.inicio, '2026-01-01'); eq(pr.fin, '2026-06-30'); ok(!('base' in pr), 'proyecto sin base');
    var pr2 = E.fgProjectPayload({}, { pilar: 'cc', nombre: 'Nuevo', inicio: '2026-02-01' });
    eq(pr2.fin, '', 'término vacío por defecto'); ok(!('base' in pr2), 'al crear sin base');
  });

  test('v3 fgestion · formularios: al instante (v3.4), cierre opcional, sin abrir el drawer al crear', function () {
    var code = src('FGestion');
    var tf = fn(code, 'openTaskForm');
    ok(/size: 'md'/.test(tf), 'compositor tamaño md');
    ok(tf.indexOf('¿Qué hay que hacer?') >= 0 && tf.indexOf('autofocus') >= 0, 'título grande con foco');
    ok(/title: t \? 'Editar tarea' : ''/.test(tf), 'editar reutiliza el compositor con título «Editar tarea»');
    ok(tf.indexOf("toast('Tarea creada'") >= 0, 'toast «Tarea creada»');
    ok(!/openTask\(r\.lastId\)|openDrawer\(/.test(tf.replace(/onAction: \(\) => \{[^}]*\}/, '')), 'no abre el drawer al crear (sólo desde el toast)');
    ok(/avisar: st\.avisar, privada: st\.asignados\.length \? false : st\.privada/.test(tf), 'envía avisar y privada (v3.6: pública con varias personas)');
    var pf = fn(code, 'openProjectForm');
    ok(/name: 'inicio'/.test(pf) && /name: 'fin'/.test(pf), 'proyecto: campos inicio / término');
    ok(/inicio: f\.inicio \|\| '', fin: f\.fin \|\| ''/.test(pf), 'proyecto: se envían');
    var ct = fn(code, 'openCompleteTask');
    ok(ct.indexOf('¿Cómo te fue?') >= 0, 'título amable');
    ok(!/Describe brevemente|necesita su comentario/.test(ct), 'el comentario de cierre ya no es obligatorio');
    ok(/optimistic\([^\n]*'taskComplete', \[id, \{ cierre: cierre, completada: comp, evidencias: evList \}\]/.test(ct), 'pendiente → taskComplete al instante');
    ok(/optimistic\([^\n]*'gSave', \[Object\.assign\(\{ tipo: 'Tarea', id: id \}, over\)\]/.test(ct) && !/\bbase\b/.test(ct), 'lista → gSave sólo con lo cambiado, sin base');
    var fl = block(code, "action('task.flag'", 'task.flag');
    ok(!/\bbase\b/.test(fl) && /optimistic\(/.test(fl), 'interruptores: al instante y sin base');
  });

  test('v3 fgestion · contra el servidor: tarea personal, privada con aviso, cierre opcional y comentario después', function () {
    need('gSave', 'taskComplete', 'bootstrap');
    fresh('setup');
    var E = env();
    // Compositor: tarea personal (sin pilar ni proyecto), privada, para Ina, con fecha
    var b = asUser(U.gonzalo, function () {
      return client('gSave', { tipo: 'Tarea', pilar: '', proyecto: '', nombre: 'Llamar al proveedor', detalle: '', resp: U.ina, fecha: day(10),
        cascade: '', evidencias: [], avisar: true, privada: true, estado: 'Pendiente' });
    });
    var t = find(b, 'tasks', b.lastId);
    eq(t.pilar, ''); eq(t.privada, true); eq(t.avisar, true);
    ok(!asUser(U.benja, function () { return client('bootstrap'); }).tasks.some(function (x) { return x.id === t.id; }), 'Benja no la ve');
    ok(asUser(U.ina, function () { return client('bootstrap'); }).tasks.some(function (x) { return x.id === t.id; }), 'Ina (responsable) sí');
    // Interruptor del drawer: payload parcial con base → sólo cambia avisar
    tick();
    b = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', id: t.id, base: t.actualizado, avisar: false }); });
    var t2 = find(b, 'tasks', t.id);
    eq(t2.avisar, false); eq(t2.privada, true, 'lo demás se conserva'); eq(t2.resp, U.ina); eq(t2.fecha, day(10));
    // Check rápido: cierre vacío es válido
    tick();
    b = asUser(U.gonzalo, function () { return client('taskComplete', t.id, { cierre: '' }); });
    var t3 = find(b, 'tasks', t.id);
    eq(t3.estado, 'Realizada');
    // "Agregar comentario" desde el toast: gSave con el payload completo y la base vista
    tick();
    b = asUser(U.gonzalo, function () { return client('gSave', E.fgTaskPayload(t3, { cierre: 'Quedó listo', evidencias: [{ t: 'Acta', u: 'https://drive.google.com/x' }], base: t3.actualizado })); });
    var t4 = find(b, 'tasks', t.id);
    eq(t4.cierre, 'Quedó listo'); eq(t4.estado, 'Realizada'); eq(t4.privada, true); eq(t4.avisar, false);
    eq(t4.evidencias.length, 1, 'links del cierre');
    // Con proyecto, el pilar sigue al proyecto
    var pb = client('gSave', E.fgProjectPayload({}, { pilar: 'nat', nombre: 'Humedales', resp: U.ina, estado: 'Activo', anio: '', inicio: day(-30), fin: day(60) }));
    var prj = find(pb, 'projects', pb.lastId);
    eq(prj.inicio, day(-30)); eq(prj.fin, day(60));
    b = client('gSave', { tipo: 'Tarea', pilar: 'cc', proyecto: prj.id, nombre: 'En humedales', resp: U.gonzalo, fecha: '', cascade: '', evidencias: [], avisar: true, privada: false, estado: 'Pendiente' });
    eq(find(b, 'tasks', b.lastId).pilar, 'nat', 'pilar del proyecto');
  });
})();
