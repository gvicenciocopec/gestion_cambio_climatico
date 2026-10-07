/* v3.1 · Presupuesto y Solicitudes (cliente): VPresupuesto.html + VAprobaciones.html (SPEC §14.4).
   - Ojo «Ver correo de respaldo» en la tabla, las tarjetas móviles y el detalle de línea (sólo con «Ver como admin»).
   - Menos texto: sin subtítulos explicativos, «Cómo funciona», «Todo al día…», etc. (los números y acciones siguen).
   Se evalúa el <script> real de cada vista con las primitivas reales de Core.html y stubs mínimos del navegador. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  // Declaración del nivel superior: una línea, o hasta la "}" / "};" en la columna 0 si la primera línea abre un bloque
  function top(code, start) {
    var i = code.indexOf('\n' + start);
    ok(i >= 0, 'no encontré «' + start + '»');
    i++;
    var nl = code.indexOf('\n', i), first = code.slice(i, nl < 0 ? code.length : nl);
    if (!/[{[]\s*$/.test(first)) return first;
    var end = code.slice(i).search(/\n[}\]];?\s*(\n|$)/);
    ok(end >= 0, 'bloque sin cerrar: ' + start);
    var close = code.indexOf('\n', i + end + 1);
    return code.slice(i, close < 0 ? code.length : close);
  }
  var CORE_FN = ['esc', 'safeUrl', 'fmtNum', 'fmtMoney', 'fmtCompact', 'parseMoney', 'pad2', 'ymd', 'todayStr', 'parseYmd', 'daysUntil', 'fmtDate',
    'fmtDateShort', 'fmtRel', 'fmtDateTime', 'pct', 'plural', 'initials', 'normTxt', 'kebab', 'dataAttrs', 'tone', 'icon', 'badge', 'btn',
    'iconBtn', 'card', 'statCard', 'progress', 'stackBar', 'emptyState', 'segmented', 'tabs', 'searchInput', 'pageHeader', 'field', 'selectField',
    'userSelect', 'userObj', 'userName', 'userColor', 'avatar', 'PIL', 'pillarBadge', 'budgetLines', 'dueInfo', 'dueBadge', 'linesOf', 'projectStats'];
  var CORE_CONST = ['MESES', 'TONES', 'CX', 'BTN_VARIANTS', 'AVATAR_TONES'];
  function coreCode() {
    var core = src('Core');
    return CORE_CONST.map(function (c) { return top(core, 'const ' + c + ' '); }).join('\n') + '\n' +
      CORE_FN.map(function (n) { return top(core, 'function ' + n + '('); }).join('\n') + '\n';
  }
  var STUBS = ['S', 'IDX', 'registerView', 'action', 'document', 'window', 'matchMedia', 'rerender', 'go', 'run', 'mutate', 'optimistic', 'toast',
    'openDrawer', 'refreshDrawer', 'closeDrawer', 'currentDrawerKey', 'isAdminUI', 'refreshIcons', 'myEmail', 'commentsPanel', 'readForm',
    'confirmDialog', 'promptDialog', 'refreshData', 'downloadXlsx', 'openModal', 'errMsg'];

  var MAIL = 'https://mail.google.com/mail/u/0/#inbox/';
  var LINES = [
    { id: 'L-00000001', year: 2026, row: 2, pilar: 'cc', area: 'Cambio Climatico', proj: 'Green Energy <b>camiones</b>', clas: 'POA', po: 9000000, pf: 9000000, pg: 0, pend: 9000000, oc: 'Si', estado: 'En curso', alerta: 'OK con OC', nota: '', resp: '' },
    { id: 'L-00000002', year: 2026, row: 3, pilar: 'cc', area: 'Cambio Climatico', proj: 'Asesoría huella de carbono', clas: 'Nuevo', po: 0, pf: 5000000, pg: 1000000, pend: 4000000, oc: 'No', estado: 'En curso', alerta: 'Pagar/OC ya', nota: 'PR71524', resp: 'gvicencio@copec.cl' },
    { id: 'L-00000003', year: 2026, row: 4, pilar: 'ec', area: 'Economia Circular', proj: 'Zero Waste plantas', clas: 'POA', po: 3000000, pf: 3000000, pg: 3000000, pend: 0, oc: 'Si', estado: 'Ejecutado', alerta: 'Pagado', nota: '', resp: 'ibachler@copec.cl' },
    { id: 'L-00000004', year: 2026, row: 5, pilar: 'nat', area: 'Naturaleza', proj: 'Humedales', clas: 'POA', po: 2000000, pf: 2000000, pg: 0, pend: 2000000, oc: '', estado: 'Por ejecutar', alerta: 'Definir OC', nota: '', resp: '' },
  ];
  function sol(over) {
    return Object.assign({
      id: 'SOL-1', gmailId: 'm1', hiloUrl: MAIL + 'uno', recibido: '2026-10-02T19:05:00.000Z', solicitante: 'GONZALO CORTES', pr: 'PR71524',
      nombre: 'Piloto Green Energy', montoClp: 13473363, montoTexto: '$13.473.363,17 CLP', fechaTexto: '', fecha: '2026-10-02T14:17:00.000Z',
      proveedor: 'LUXMETER ENERGY SPA', descripcion: 'Paneles', comentario: '', cecos: [], totalUf: 0, estado: 'Vinculada', anio: '2026',
      lineId: 'L-00000001', montoImputado: 4509976, sugerido: 4509976, nota: '', procesadoPor: 'gvicencio@copec.cl', procesado: '2026-10-02T20:00:00.000Z',
      asunto: 'Solicitud de compra', lectura: 'ok',
    }, over || {});
  }

  // Entorno de VPresupuesto: opts.admin (S.me.admin), opts.adminView (isAdminUI), opts.mobile, opts.sols
  function budEnv(opts) {
    opts = opts || {};
    var lines = (opts.lines || LINES).map(function (l) { return Object.assign({}, l); });
    var E = { views: {}, actions: {}, calls: [], toasts: [], drawers: [], gone: [] };
    E.S = {
      me: { email: 'gvicencio@copec.cl', name: 'Gonzalo', admin: opts.admin !== false },
      users: [{ email: 'gvicencio@copec.cl', name: 'Gonzalo', color: 'emerald' }, { email: 'ibachler@copec.cl', name: 'Ina', color: 'violet' },
        { email: 'idiaz@copec.cl', name: 'Ignacio', color: 'amber' }],
      pillars: [
        { key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
        { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
        { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' },
      ],
      years: [2026], year: 2026, budget: { '2026': lines }, projects: [], tasks: [], comments: [],
      solicitudes: opts.sols || [], config: { sheetUrl: 'https://docs.google.com/spreadsheets/d/x' }, ui: {}, route: { name: 'budget.lines', params: {} },
      loadedAt: new Date().toISOString(),
    };
    E.IDX = {
      line: new Map(lines.map(function (l) { return [l.id, l]; })), lineProject: new Map(), commentsByRef: new Map(),
      project: new Map(), tasksByProject: new Map(),
    };
    var adminView = opts.adminView !== false;
    var stub = {
      S: E.S, IDX: E.IDX,
      registerView: function (n, d) { E.views[n] = d; },
      action: function (n, f) { E.actions[n] = f; },
      document: { addEventListener: function () {}, removeEventListener: function () {}, querySelector: function () { return null; }, getElementById: function () { return null; } },
      window: opts.mobile ? { matchMedia: function () { return { matches: false }; } } : {},
      matchMedia: function () { return { matches: !opts.mobile }; },
      rerender: function () { E.rerenders = (E.rerenders || 0) + 1; }, go: function (h) { E.gone.push(h); },
      run: function () { return { then: function () { return this; }, catch: function () { return this; }, finally: function () { return this; } }; },
      mutate: function (fn, args, o) { E.calls.push({ fn: fn, args: args, opts: o || {} }); return { then: function () { return this; } }; },
      optimistic: function (local, fn, args, o) { local(); E.calls.push({ fn: fn, args: args, opts: o || {} }); return { then: function () { return this; } }; },
      toast: function (m, t) { E.toasts.push({ m: m, t: t }); },
      openDrawer: function (d) { E.drawers.push(d); E.drawer = d; }, refreshDrawer: function () {}, closeDrawer: function () {},
      currentDrawerKey: function () { return E.drawer ? E.drawer.key : null; },
      isAdminUI: function () { return !!E.S.me.admin && adminView; }, refreshIcons: function () {},
      myEmail: function () { return E.S.me.email; }, commentsPanel: function () { return '<div data-comments></div>'; },
      readForm: function () { return {}; }, confirmDialog: function () { return { then: function () {} }; }, promptDialog: function () { return { then: function () {} }; },
      refreshData: function () { return { then: function () {} }; }, downloadXlsx: function () {}, openModal: function () { return { close: function () {} }; },
      errMsg: function (e) { return String(e && e.message || e); },
    };
    var f = new Function(STUBS.join(','), coreCode() + src('VPresupuesto') + '\nreturn function (n) { return eval(n); };');
    E.get = f.apply(null, STUBS.map(function (k) { return stub[k]; }));
    E.lines = function () { E.S.route = { name: 'budget.lines', params: {} }; return E.views['budget.lines'].render({}); };
    E.summary = function () { E.S.route = { name: 'budget.summary', params: {} }; return E.views['budget.summary'].render({}); };
    E.drawerHtml = function (id) {
      E.get('openLine')(id);
      var r = E.drawer.render();
      return [r.title, r.subtitle, r.headerRight, r.body, r.footer].join('\n');
    };
    return E;
  }
  function count(html, re) { return (html.match(re) || []).length; }
  function eyes(html) { return count(html, /data-bud-mail="1"/g); }

  test('v31 presupuesto · ojo «Ver correo de respaldo» en la tabla: sólo líneas con solicitud registrada y hilo seguro', function () {
    var E = budEnv({ sols: [
      sol(),
      sol({ id: 'SOL-2', pr: 'PR2', lineId: 'L-00000002', hiloUrl: 'javascript:alert(1)' }),          // URL no http(s) → sin ojo
      sol({ id: 'SOL-3', pr: 'PR3', lineId: 'L-00000003', hiloUrl: '' }),                               // sin hilo → sin ojo
      sol({ id: 'SOL-4', pr: 'PR4', lineId: 'L-00000004', estado: 'Pendiente', hiloUrl: MAIL + 'p' }),  // no registrada → sin ojo
      sol({ id: 'SOL-5', pr: 'PR5', lineId: 'L-00000004', estado: 'Descartada', hiloUrl: MAIL + 'd' }),
    ] });
    var html = E.lines();
    eq(eyes(html), 1, 'un solo ojo');
    includes(html, '<a href="' + MAIL + 'uno" target="_blank" rel="noopener noreferrer" data-bud-mail="1" title="Ver correo de respaldo" aria-label="Ver correo de respaldo"');
    includes(html, 'data-lucide="eye"');
    ok(html.indexOf('javascript:') < 0, 'nunca un href javascript:');
    ok(html.indexOf(MAIL + 'p') < 0 && html.indexOf(MAIL + 'd') < 0, 'pendientes / descartadas no muestran correo');
    // el ojo queda en la fila de su línea (junto al nombre)
    var row = html.split('<tr>').find(function (r) { return r.indexOf('data-id="L-00000001"') >= 0; });
    ok(row && row.indexOf('data-bud-mail') >= 0, 'el ojo está en la fila L-00000001');
    // discreto: gris, índigo al pasar el mouse, con variante oscura
    ok(/data-bud-mail="1"[^>]*class="[^"]*text-zinc-400[^"]*hover:text-indigo-600[^"]*dark:hover:text-indigo-400/.test(html), 'estilo discreto');
  });

  test('v31 presupuesto · la tabla abre el correo más reciente; el detalle lista cada solicitud con su ojo', function () {
    var E = budEnv({ sols: [
      sol({ id: 'SOL-old', pr: 'PR100', hiloUrl: MAIL + 'vieja', fecha: '2026-08-01T10:00:00.000Z', montoImputado: 1000000 }),
      sol({ id: 'SOL-new', pr: 'PR200', hiloUrl: MAIL + 'nueva', fecha: '2026-09-15T10:00:00.000Z', estado: 'Nueva línea', montoImputado: 2000000 }),
      sol({ id: 'SOL-sin', pr: 'PR300', hiloUrl: '', fecha: '2026-07-01T10:00:00.000Z', montoImputado: 500000 }),
    ] });
    var html = E.lines();
    eq(eyes(html), 1);
    includes(html, 'href="' + MAIL + 'nueva"', 'la más reciente');
    ok(html.indexOf(MAIL + 'vieja') < 0, 'en la tabla, sólo un ojo por línea');
    var d = E.drawerHtml('L-00000001');
    includes(d, 'Solicitudes de compra');
    eq(eyes(d), 2, 'un ojo por solicitud con hilo');
    includes(d, 'href="' + MAIL + 'nueva" target="_blank" rel="noopener noreferrer" data-bud-mail="1" title="Ver correo de respaldo (PR200)"');
    includes(d, 'href="' + MAIL + 'vieja" target="_blank" rel="noopener noreferrer" data-bud-mail="1" title="Ver correo de respaldo (PR100)"');
    ok(d.indexOf('PR200') < d.indexOf('PR100') && d.indexOf('PR100') < d.indexOf('PR300'), 'más nuevas primero');
    includes(d, 'data-action="budget.openSol" data-id="SOL-sin"', 'sin hilo: se lista igual (sin ojo)');
    includes(d, '$3.500.000', 'total imputado');
    // el ojo es un <a> aparte (nunca dentro del botón de la fila)
    ok(!/<button[^>]*budget\.openSol[^>]*>(?:(?!<\/button>)[\s\S])*data-bud-mail/.test(d), 'sin <a> anidado en <button>');
  });

  test('v31 presupuesto · «Ver como admin» apagado (o no admin): sin ojos, sin solicitudes en el detalle ni en el Resumen', function () {
    var sols = [sol(), sol({ id: 'SOL-p', pr: 'PR9', estado: 'Pendiente', lineId: '' })];
    var on = budEnv({ sols: sols });
    eq(eyes(on.lines()), 1);
    includes(on.summary(), 'Por registrar: 1 solicitud de compra');
    [budEnv({ sols: sols, adminView: false }), budEnv({ sols: sols, admin: false })].forEach(function (E, i) {
      var tag = i ? 'no admin' : 'vista de equipo';
      eq(eyes(E.lines()), 0, tag + ': tabla sin ojo');
      eq(eyes(budEnv({ sols: sols, adminView: i ? true : false, admin: !i, mobile: true }).lines()), 0, tag + ': tarjetas sin ojo');
      var d = E.drawerHtml('L-00000001');
      eq(eyes(d), 0, tag + ': detalle sin ojo');
      ok(d.indexOf('Solicitudes de compra') < 0 && d.indexOf('budget.openSol') < 0, tag + ': detalle sin solicitudes');
      var s = E.summary();
      ok(s.indexOf('Por registrar') < 0 && s.indexOf('#/presupuesto/solicitudes') < 0, tag + ': Resumen sin solicitudes');
      ok(s.indexOf(MAIL) < 0, tag + ': ningún link al correo');
    });
    // Sin la pestaña del año: el atajo a Ajustes sólo con «Ver como admin»
    var empty = function (o) { var E = budEnv(Object.assign({ lines: [] }, o)); E.S.years = [2027]; return E.summary(); };
    includes(empty({}), 'Crear pestaña en Ajustes');
    ok(empty({ adminView: false }).indexOf('Crear pestaña en Ajustes') < 0, 'vista de equipo: sin atajo de administración');
    includes(empty({ adminView: false }), 'Falta la pestaña «Cuadre 2026»');
  });

  test('v31 presupuesto · tarjetas móviles: ojo junto a «Abrir detalle», menos insignias', function () {
    var E = budEnv({ mobile: true, sols: [sol({ lineId: 'L-00000002', hiloUrl: MAIL + 'movil' })] });
    var html = E.lines();
    ok(html.indexOf('<table') < 0, 'en móvil se dibujan tarjetas');
    eq(eyes(html), 1);
    includes(html, 'href="' + MAIL + 'movil"');
    // Insignias: la alerta sólo si pide acción; la clasificación sólo si no es POA
    includes(html, '>Pagar/OC ya<');
    includes(html, '>Definir OC<');
    ok(html.indexOf('</i>OK con OC</span>') < 0 && html.indexOf('</i>Pagado</span>') < 0 && html.indexOf('title="Sin saldo pendiente."') < 0,
      'alertas informativas fuera (ya se leen en Estado / OC / Pendiente)');
    includes(html, '>Nuevo<');
    ok(html.indexOf('>POA<') < 0, 'POA es lo normal: no se marca');
    includes(html, 'Green Energy &lt;b&gt;camiones&lt;/b&gt;', 'nombre escapado');
  });

  test('v31 presupuesto · tabla: columna «Estado», alerta sólo si pide acción, href del correo siempre escapado', function () {
    var E = budEnv({ sols: [sol({ hiloUrl: MAIL + 'a"onmouseover="alert(1)' })] });
    var html = E.lines();
    includes(html, '>Estado<');
    ok(html.indexOf('Alerta · estado') < 0, 'sin el encabezado antiguo');
    eq(count(html, />Pagar\/OC ya</g), 1); eq(count(html, />Definir OC</g), 1);
    ok(html.indexOf('</i>OK con OC</span>') < 0 && html.indexOf('</i>Pagado</span>') < 0, 'sin alertas informativas');
    includes(html, '>Ejecutado</span>', 'el estado sigue visible');
    // Un hilo con comillas no pasa safeUrl: no hay ojo (y nada del texto llega al HTML)
    eq(eyes(html), 0, 'hilo inseguro → sin ojo');
    ok(html.indexOf('onmouseover') < 0, 'nada inyectado');
    ok(html.indexOf('edita pagos, OC y responsable') < 0, 'sin subtítulo explicativo');
    ok(html.indexOf('Ninguna línea coincide') < 0);
    // Sin resultados: título + «Limpiar filtros», sin prosa
    E.get('budUi')().q = 'zzz-nada';
    var none = E.lines();
    includes(none, 'Sin resultados'); includes(none, 'data-action="budget.clear"');
    ok(none.indexOf('Ninguna línea coincide') < 0, 'estado vacío simple');
  });

  test('v31 presupuesto · Resumen sin textos de relleno; números y acciones intactos', function () {
    var E = budEnv({});
    var html = E.summary();
    ['Seguimiento de asesorías', 'se calculan automáticamente', 'Primero las con OC', 'Toca un área para filtrar', 'Saldo por pagar, separando',
      'Monto final proyectado según estado', 'Pendiente y avance de pago por persona', 'Monto final de ', 'A gestionar:', 'Todo el presupuesto vigente',
      'No hay saldo pendiente', 'Aún no hay responsables asignados', 'Sin líneas asignadas', 'en Cuadre 2026</p>', 'Llegaron desde Ariba']
      .forEach(function (x) { ok(html.indexOf(x) < 0, 'sobra «' + x + '»'); });
    ['Presup. original POA', 'Final proyectado', 'Comprometido con OC', 'Pagado a la fecha', 'Pendiente', 'Requieren acción', 'Ejecución',
      'Cobertura de OC', 'Pendiente de pago', 'Distribución por estado', 'Avance por área', 'Por responsable',
      'data-action="budget.gotoAccion"', 'data-action="budget.export"', 'data-action="budget.area"', 'data-action="budget.gotoEstado"', 'data-action="budget.gotoResp"',
      '$19.000.000', '$4.000.000', '$14.000.000'].forEach(function (x) { includes(html, x); });
    // Por responsable: sólo quien tiene líneas (Ignacio no tiene → no aparece)
    ok(html.indexOf('Ver líneas de Ignacio') < 0, 'sin filas vacías');
    includes(html, 'Ver líneas de Ina'); includes(html, 'Ver líneas de Sin asignar');
    // Nada que requiera acción → la tarjeta no se dibuja (el KPI de alertas ya lo dice)
    var calm = budEnv({ lines: [LINES[0], LINES[2]] }).summary();
    ok(calm.indexOf('Requieren acción') < 0 && calm.indexOf('Todo en orden') < 0, 'sin tarjeta vacía');
    includes(calm, 'Sin alertas');
  });

  test('v31 presupuesto · detalle de línea: menos insignias y sin textos de ayuda; ediciones rápidas sin toast de éxito', function () {
    var E = budEnv({});
    var d = E.drawerHtml('L-00000001');
    var sub = E.drawer.render().subtitle;
    ok(sub.indexOf('>POA<') < 0 && sub.indexOf('OK con OC') < 0, 'encabezado sin POA ni alerta informativa: ' + sub);
    eq(count(sub, /<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-md/g), 2, 'pilar + estado');
    includes(sub, 'Cuadre 2026');
    includes(d, 'Pendiente</div>');
    ok(d.indexOf('(se calcula solo)') < 0, 'sin ayuda innecesaria');
    var d2 = E.drawerHtml('L-00000002');
    includes(d2, '>Pagar/OC ya<'); includes(d2, '>Nuevo<');
    E.S.projects = [{ id: 'PRJ-1', pilar: 'cc', nombre: 'Proyecto clima', estado: 'Activo', lineas: [] }];
    var g = E.drawerHtml('L-00000001');
    E.get('budUi')().lineTab = 'gestion'; // pestaña Gestión
    var gb = E.drawer.render().body;
    includes(gb, 'Sin proyecto de gestión');
    ok(gb.indexOf('Cada línea pertenece a un solo proyecto') < 0 && gb.indexOf('¿No existe todavía?') < 0, 'sin prosa');
    includes(gb, 'data-action="budget.linkProject"', 'la acción sigue');
    ok(g, 'detalle dibujado');
    // OC / responsable / pagado: el cambio se ve al instante; v3.4 (SPEC §18): al servidor por detrás, con respuesta
    // liviana (sin bundle) y sin toast de éxito
    E.actions['budget.oc']({ id: 'L-00000004', value: 'Si' });
    eq(E.calls[0].fn, 'budgetSave'); deepEq(E.calls[0].args, [2026, 'L-00000004', { oc: 'Si' }, null, { light: true }]);
    eq(E.calls[0].opts.applyResult, false, 'no espera ni aplica datos completos');
    eq(E.calls[0].opts.reapply, true, 'se mantiene si llegan datos de otro guardado');
    eq(E.IDX.line.get('L-00000004').alerta, 'OK con OC', 'cambio local inmediato');
    E.actions['budget.respQuick']({ id: 'L-00000004' }, { value: 'idiaz@copec.cl' });
    deepEq(E.calls[1].args.slice(2), [{ resp: 'idiaz@copec.cl' }, null, { light: true }]);
    eq(E.toasts.length, 0, 'sin toasts de éxito');
  });

  // v3.4 (SPEC §18): en el celular, menos filtros a la vista, sin «Requieren acción» fijo y Pagado editable en la tarjeta
  test('v3.4 presupuesto · móvil: búsqueda + «Filtros» plegados; Pagado editable en cada tarjeta', function () {
    var E = budEnv({ mobile: true });
    var h = E.lines();
    ok(h.indexOf('data-action="budget.filters"') >= 0, 'botón Filtros');
    ok(h.indexOf('data-change="budget.estado"') < 0 && h.indexOf('data-action="budget.ocFilter"') < 0 && h.indexOf('data-action="budget.area"') < 0, 'filtros plegados');
    ok(h.indexOf('Requieren acción') < 0, 'sin «Requieren acción»');
    E.actions['budget.filters']();
    var o = E.lines();
    ok(o.indexOf('data-change="budget.estado"') >= 0 && o.indexOf('data-action="budget.ocFilter"') >= 0 && o.indexOf('data-action="budget.area"') >= 0, 'al abrir aparecen todos');
    ok(/data-action="budget\.filters" aria-expanded="true"/.test(o), 'el botón indica que está abierto');
    eq((o.match(/id="bud-pgc-/g) || []).length, E.S.budget['2026'].length, 'un Pagado editable por tarjeta');
    ok(/id="bud-pgc-L-00000004"[^>]*inputmode="numeric"[^>]*data-change="budget\.pg" data-id="L-00000004"/.test(o), 'misma acción que la tabla, teclado numérico');
    // Editarlo guarda al instante (respuesta liviana)
    E.actions['budget.pg']({ id: 'L-00000004' }, { value: '1.234.567' });
    var c = E.calls[E.calls.length - 1];
    deepEq(c.args, [2026, 'L-00000004', { pg: 1234567 }, null, { light: true }]);
    eq(E.IDX.line.get('L-00000004').pg, 1234567, 'cambio local inmediato');
    // Si se llegó desde el resumen («Requieren acción»), el filtro se ve para poder quitarlo
    E.get('budUi')().accion = true;
    ok(/data-action="budget\.accionToggle"[^>]*>.*Requieren acción/.test(E.lines()), 'filtro visible para quitarlo');
    ok(budEnv({}).lines().indexOf('Requieren acción') < 0, 'escritorio: tampoco hay botón fijo');
  });

  /* ---------------- VAprobaciones ---------------- */
  var APR_STUBS = ['S', 'IDX', 'registerView', 'action', 'run', 'mutate', 'optimistic', 'toast', 'rerender', 'go', 'openModal', 'confirmDialog',
    'promptDialog', 'closeDrawer', 'currentDrawerKey', 'isAdminUI', 'refreshIcons', 'myEmail', 'openLine', 'errMsg', 'readForm'];
  function aprEnv(opts) {
    opts = opts || {};
    var budEnvForS = budEnv({ admin: opts.admin, adminView: opts.adminView, sols: opts.sols });
    var E = { views: {}, actions: {}, modals: [], S: budEnvForS.S, IDX: budEnvForS.IDX };
    E.S.route = { name: 'budget.approvals', params: {} };
    var adminView = opts.adminView !== false;
    var thenable = { then: function () { return thenable; }, catch: function () { return thenable; }, finally: function () { return thenable; } };
    var stub = {
      S: E.S, IDX: E.IDX, registerView: function (n, d) { E.views[n] = d; }, action: function (n, f) { E.actions[n] = f; },
      run: function () { return thenable; }, mutate: function () { return thenable; }, optimistic: function () { return thenable; }, toast: function () {},
      rerender: function () {}, go: function () {}, openModal: function (o) { E.modals.push(o); return { close: function () {} }; },
      confirmDialog: function () { return thenable; }, promptDialog: function () { return thenable; }, closeDrawer: function () {},
      currentDrawerKey: function () { return null; }, isAdminUI: function () { return !!E.S.me.admin && adminView; }, refreshIcons: function () {},
      myEmail: function () { return E.S.me.email; }, openLine: function () {}, errMsg: function (e) { return String(e); }, readForm: function () { return {}; },
    };
    var f = new Function(APR_STUBS.join(','), coreCode() + src('VAprobaciones') + '\nreturn function (n) { return eval(n); };');
    E.get = f.apply(null, APR_STUBS.map(function (k) { return stub[k]; }));
    E.render = function () { return E.views['budget.approvals'].render({}); };
    return E;
  }

  test('v31 solicitudes · sin «Cómo funciona» ni textos de relleno; resumen en una sola tarjeta con estado de la lectura', function () {
    var E = aprEnv({ sols: [sol({ estado: 'Pendiente', lineId: '' }), sol({ id: 'SOL-2', pr: 'PR2', estado: 'Vinculada' })] });
    E.get('aprUi')().st = { triggerInstalled: true, hour: 7, lastScan: new Date(Date.now() - 3 * 60000).toISOString() };
    var html = E.render();
    ['Cómo funciona', 'Las apruebas en el correo', 'Se registran solas', 'Ariba te pide aprobar', 'Todo registrado', 'Ningún gasto suelto',
      'La aprobación sigue siendo en el correo', 'monto total</div>'].forEach(function (x) { ok(html.indexOf(x) < 0, 'sobra «' + x + '»'); });
    ['Última revisión hace 3 min', 'Revisar ahora', 'Por registrar', 'Registradas este mes', 'Lectura automática', 'Activa · a diario ~7:00',
      'Sugerido para tu presupuesto', 'data-action="aprob.link"', 'data-action="aprob.newLine"', 'data-action="aprob.discard"', 'Abrir correo']
      .forEach(function (x) { includes(html, x); });
    eq(count(html, /<aside[\s\S]*?<\/aside>/g), 1);
    var aside = html.slice(html.indexOf('<aside'));
    eq(count(aside, new RegExp(CX_CARD_RE, 'g')), 1, 'una sola tarjeta lateral');
    // Lectura apagada: el atajo a Ajustes sigue
    E.get('aprUi')().st = { triggerInstalled: false };
    var off = E.render();
    includes(off, 'Revisión automática apagada'); includes(off, 'Activar en Ajustes');
  });
  var CX_CARD_RE = 'rounded-xl border border-zinc-200/80 bg-white shadow-sm';

  test('v31 solicitudes · estados vacíos de una línea; toast de «Revisar ahora» sin «Todo al día»', function () {
    var E = aprEnv({ sols: [sol({ id: 'SOL-v', estado: 'Vinculada' })] });
    var html = E.render(); // filtro por defecto: Pendientes (vacío)
    includes(html, 'Nada pendiente');
    ok(html.indexOf('Todas las solicitudes están registradas') < 0, 'sin prosa en el vacío');
    E.get('aprUi')().q = 'zzz';
    var q = E.render();
    includes(q, 'Sin resultados'); includes(q, 'data-action="aprob.clearQ"');
    ok(q.indexOf('Ninguna solicitud coincide') < 0 && q.indexOf('No hay coincidencias') < 0);
    var none = aprEnv({ sols: [] });
    none.get('aprUi')().st = { triggerInstalled: true, hour: 7 };
    var h = none.render();
    includes(h, 'Sin solicitudes por ahora');
    ok(h.indexOf('Todo tranquilo') < 0 && h.indexOf('Revisamos tu correo') < 0, 'sin relleno');
    var msg = E.get('aprScanMsg');
    ok(msg({ found: 2 }).indexOf('Todo al día') < 0 && msg({}).indexOf('Todo al día') < 0);
    // «Ver como admin» apagado: la bandeja no se muestra
    includes(aprEnv({ adminView: false, sols: [sol()] }).render(), 'Sólo para administradores');
  });

  test('v31 solicitudes · modales sin subtítulos ni ayudas redundantes (lo que evita errores se queda)', function () {
    var E = aprEnv({ sols: [sol({ estado: 'Pendiente', lineId: '', cecos: [{ codigo: 'XUF80853', nombre: 'PROY', uf: 1, clp: 4509976, propio: true }], totalUf: 1 })] });
    E.actions['aprob.link']({ id: 'SOL-1' });
    var m = E.modals[0];
    ok(!m.subtitle, 'sin subtítulo');
    ok(m.body.indexOf('La línea quedará con OC') < 0, 'sin ayuda redundante');
    includes(m.body, 'Marcar OC emitida en la línea');
    includes(m.body, 'La parte de tu CeCo.', 'el monto sugerido explica de dónde sale');
    E.actions['aprob.newLine']({ id: 'SOL-1' });
    var n = E.modals[1];
    ok(!n.subtitle, 'sin subtítulo');
    ok(n.body.indexOf('Así ningún gasto queda fuera') < 0 && n.body.indexOf('Sugerida según el CeCo') < 0, 'sin relleno');
    includes(n.body, 'Fuera de POA');
    includes(n.body, 'Monto final proyectado');
  });
})();
