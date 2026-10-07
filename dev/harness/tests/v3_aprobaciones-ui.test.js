/* v3 · Solicitudes de compra (cliente): VAprobaciones.html + agregados de VPresupuesto.html (SPEC §13.2 / §13.3).
   Se evalúa el <script> real de VAprobaciones con las primitivas reales de Core.html (esc, btn, badge, pageHeader…)
   y stubs mínimos para lo que necesita el navegador (modales, google.script.run). */
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
  var CORE_FN = ['esc', 'safeUrl', 'fmtNum', 'fmtMoney', 'fmtCompact', 'pad2', 'ymd', 'todayStr', 'parseYmd', 'daysUntil', 'fmtDate',
    'fmtDateShort', 'fmtRel', 'fmtDateTime', 'pct', 'plural', 'initials', 'normTxt', 'kebab', 'dataAttrs', 'tone', 'icon', 'badge', 'btn',
    'iconBtn', 'card', 'emptyState', 'segmented', 'searchInput', 'pageHeader', 'field', 'selectField', 'userObj', 'userName', 'userColor',
    'PIL', 'pillarBadge', 'budgetLines', 'progress', 'avatar'];
  var CORE_CONST = ['MESES', 'TONES', 'CX', 'BTN_VARIANTS', 'AVATAR_TONES'];
  function coreCode() {
    var core = src('Core');
    return CORE_CONST.map(function (c) { return top(core, 'const ' + c + ' '); }).join('\n') + '\n' +
      CORE_FN.map(function (n) { return top(core, 'function ' + n + '('); }).join('\n') + '\n';
  }
  var STUBS = ['S', 'IDX', 'registerView', 'action', 'run', 'mutate', 'optimistic', 'toast', 'rerender', 'go', 'openModal', 'confirmDialog',
    'promptDialog', 'closeDrawer', 'currentDrawerKey', 'isAdminUI', 'refreshIcons', 'myEmail', 'openLine', 'errMsg', 'readForm'];

  var LINES = [
    { id: 'L-00000001', year: 2026, pilar: 'cc', area: 'Cambio Climatico', proj: 'Green Energy: Paneles solares en camiones', clas: 'POA', po: 9000000, pf: 9000000, pg: 0, pend: 9000000, oc: '', nota: '', resp: '' },
    { id: 'L-00000002', year: 2026, pilar: 'cc', area: 'Cambio Climatico', proj: 'Asesoría huella de carbono', clas: 'POA', po: 5000000, pf: 5000000, pg: 1000000, pend: 4000000, oc: 'Si', nota: 'OC 4500 · PR71524', resp: 'gvicencio@copec.cl' },
    { id: 'L-00000003', year: 2026, pilar: 'ec', area: 'Economia Circular', proj: 'Zero Waste plantas', clas: 'POA', po: 3000000, pf: 3000000, pg: 0, pend: 3000000, oc: 'No', nota: '', resp: '' },
    { id: 'L-00000004', year: 2026, pilar: 'nat', area: 'Naturaleza', proj: 'Humedales <b>', clas: 'Nuevo', po: 0, pf: 2000000, pg: 0, pend: 2000000, oc: '', nota: '', resp: '' },
  ];
  function sol(over) {
    return Object.assign({
      id: 'SOL-aaaa0001', gmailId: 'm1', hiloUrl: 'https://mail.google.com/mail/u/0/#inbox/abc', recibido: '2026-10-02T19:05:00.000Z',
      solicitante: 'GONZALO ALEJANDRO CORTES UARAC', pr: 'PR71524', nombre: 'Piloto Green Energy en Transcom',
      montoClp: 13473363, montoTexto: '$13.473.363,17 CLP', fechaTexto: 'viernes, 2 octubre, 2026 a las 11:17, CLST', fecha: '2026-10-02T14:17:00.000Z',
      proveedor: 'LUXMETER ENERGY SPA', descripcion: 'Piloto de paneles solares flexibles Green Energy en camiones de Transcom',
      comentario: 'Se adjunta propuesta comercial y carta de proveedor único.',
      cecos: [
        { cuenta: '0005606700', cuentaNombre: 'Materiales y equipos Pilotos Garage', codigo: 'XUF81084', nombre: 'NUEVAS ENERGIAS', uf: 218.23, clp: 8963387, propio: false },
        { cuenta: '0005602585', cuentaNombre: 'Est. y Asesorías por Cumplim. Normativas', codigo: 'XUF80853', nombre: 'PROY.CAMBIOS CLIMA', uf: 109.8, clp: 4509976, propio: true },
      ],
      totalUf: 328.03, estado: 'Pendiente', anio: '', lineId: '', montoImputado: 0, sugerido: 4509976, nota: '', procesadoPor: '', procesado: '',
      asunto: 'Acción necesaria: Aprobar el/la Solicitud de compra…', lectura: 'ok',
    }, over || {});
  }
  // Entorno: S/IDX de ejemplo + registro de vistas/acciones + llamadas al servidor capturadas
  function env(opts) {
    opts = opts || {};
    var lines = (opts.lines || LINES).map(function (l) { return Object.assign({}, l); });
    var E = {
      views: {}, actions: {}, calls: [], toasts: [], modals: [], gone: [],
      S: {
        me: { email: 'gvicencio@copec.cl', name: 'Gonzalo', admin: opts.admin !== false },
        users: [{ email: 'gvicencio@copec.cl', name: 'Gonzalo', color: 'emerald' }, { email: 'ibachler@copec.cl', name: 'Ina', color: 'violet' }],
        pillars: [
          { key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
          { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
          { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' },
        ],
        years: [2026, 2027], year: 2026, budget: { '2026': lines, '2027': [] },
        solicitudes: opts.sols || [], config: opts.config || {}, ui: {}, route: { name: 'budget.approvals', params: {} },
      },
    };
    E.IDX = { line: new Map(lines.map(function (l) { return [l.id, l]; })) };
    var stub = {
      S: E.S, IDX: E.IDX,
      registerView: function (n, d) { E.views[n] = d; },
      action: function (n, f) { E.actions[n] = f; },
      run: function (fn) { E.calls.push({ fn: fn, args: Array.prototype.slice.call(arguments, 1) }); return { then: function () { return this; }, catch: function () { return this; }, finally: function () { return this; } }; },
      mutate: function (fn, args) { E.calls.push({ fn: fn, args: args }); return { then: function () { return this; }, finally: function () { return this; } }; },
      optimistic: function (local, fn, args) { local(); E.calls.push({ fn: fn, args: args }); return { then: function () { return this; } }; },
      toast: function (m, t, o) { E.toasts.push({ m: m, t: t, o: o }); },
      rerender: function () {}, go: function (h) { E.gone.push(h); },
      openModal: function (o) { E.modals.push(o); return { close: function () {} }; },
      confirmDialog: function () { return { then: function () {} }; },
      promptDialog: function () { return { then: function () {} }; },
      closeDrawer: function () {}, currentDrawerKey: function () { return null; },
      isAdminUI: function () { return !!E.S.me.admin; }, refreshIcons: function () {},
      myEmail: function () { return E.S.me.email; }, openLine: function (id) { E.opened = id; },
      errMsg: function (e) { return String(e && e.message || e); }, readForm: function () { return {}; },
    };
    var f = new Function(STUBS.join(','), coreCode() + src('VAprobaciones') + '\nreturn function (n) { return eval(n); };');
    E.get = f.apply(null, STUBS.map(function (k) { return stub[k]; }));
    return E;
  }

  test('aprob-ui · aprTitle: nombres de Ariba en MAYÚSCULAS → forma legible (y lo mixto queda igual)', function () {
    var t = env().get('aprTitle');
    eq(t('GONZALO ALEJANDRO CORTES UARAC'), 'Gonzalo Alejandro Cortes Uarac');
    eq(t('LUXMETER ENERGY SPA'), 'Luxmeter Energy SpA');
    eq(t('PROY.CAMBIOS CLIMA'), 'Proy.Cambios Clima');
    eq(t('EST. Y ASESORÍAS POR CUMPLIM. NORMATIVAS'), 'Est. y Asesorías por Cumplim. Normativas');
    eq(t('  MARÍA  DE LA   FUENTE '), 'María de la Fuente');
    eq(t('Ya Viene Bien'), 'Ya Viene Bien');
    eq(t(null), '');
    eq(env().get('aprUf')(109.8), '109,80');
  });

  test('aprob-ui · filtro por estado, búsqueda sin tildes (PR, CeCo, proveedor) y más nuevas primero', function () {
    var E = env(), vis = E.get('aprVisible'), counts = E.get('aprCounts');
    var list = [
      sol({ id: 'SOL-1', pr: 'PR1', fecha: '2026-09-01T10:00:00.000Z' }),
      sol({ id: 'SOL-2', pr: 'PR2', fecha: '2026-10-01T10:00:00.000Z', estado: 'Vinculada', lineId: 'L-00000001' }),
      sol({ id: 'SOL-3', pr: 'PR3', fecha: '', recibido: '2026-10-03T10:00:00.000Z', proveedor: 'ENERGÍA ANDINA' }),
      sol({ id: 'SOL-4', pr: 'PR4', fecha: '2026-08-01T10:00:00.000Z', estado: 'Descartada' }),
    ];
    deepEq(vis(list, 'all', '').map(function (s) { return s.id; }), ['SOL-3', 'SOL-2', 'SOL-1', 'SOL-4'], 'orden');
    deepEq(vis(list, 'Pendiente', '').map(function (s) { return s.id; }), ['SOL-3', 'SOL-1']);
    deepEq(vis(list, 'all', 'energia andina').map(function (s) { return s.id; }), ['SOL-3'], 'sin tildes');
    deepEq(vis(list, 'all', 'pr2').map(function (s) { return s.id; }), ['SOL-2']);
    eq(vis(list, 'all', 'xuf80853').length, 4, 'busca por código de CeCo');
    deepEq(vis(list, 'Vinculada', 'paneles solares').map(function (s) { return s.id; }), ['SOL-2'], 'busca por la línea vinculada');
    var c = counts(list);
    eq(c.all, 4); eq(c['Pendiente'], 2); eq(c['Vinculada'], 1); eq(c['Nueva línea'], 0); eq(c['Descartada'], 1);
  });

  test('aprob-ui · sugerencias: área por CeCo propio, año por defecto y líneas sugeridas (PR en la nota primero)', function () {
    var E = env(), g = E.get;
    eq(g('aprGuessPilar')(sol()), 'cc', 'CeCo propio PROY.CAMBIOS CLIMA → Cambio Climático');
    eq(g('aprGuessPilar')(sol({ cecos: [], nombre: 'Valorización de residuos', descripcion: '' })), 'ec');
    eq(g('aprGuessPilar')(sol({ cecos: [], nombre: 'Catering', descripcion: 'Evento' })), '');
    var dy = g('aprDefaultYear');
    eq(dy(sol({ anio: '2027' }), [2026, 2027], 2026), 2027);
    eq(dy(sol({ anio: '' }), [2026, 2027], 2027), 2026, 'año de la fecha del correo');
    eq(dy(sol({ anio: '', fecha: '2025-12-30T10:00:00.000Z', recibido: '' }), [2026, 2027], 2027), 2027, 'fuera de los años → el seleccionado');
    var sug = g('aprSuggest')(sol(), LINES);
    eq(sug[0].l.id, 'L-00000002', 'la nota que menciona el PR va primero');
    ok(sug[0].mention, 'marcada como mención');
    ok(sug.some(function (x) { return x.l.id === 'L-00000001'; }), '«Green Energy» comparte ≥ 2 palabras');
    ok(!sug.some(function (x) { return x.l.id === 'L-00000003'; }), 'sin relación → no se sugiere');
  });

  test('aprob-ui · payloads para aprobLink / aprobNewLine: tipos simples, sin Date ni undefined', function () {
    var g = env().get;
    var a = g('aprLinkPayload')({ year: '2026', lineId: 'L-00000001', monto: 4509976, marcarOc: true, nota: '  primera cuota ' });
    deepEq(a, { year: 2026, lineId: 'L-00000001', monto: 4509976, marcarOc: true, nota: 'primera cuota' });
    var b = g('aprNewLinePayload')({ year: '2027', area: 'cc', proj: ' Piloto Green Energy ', monto: '12', nota: undefined });
    deepEq(b, { year: 2027, area: 'cc', proj: 'Piloto Green Energy', monto: 12, nota: '' });
    assertNoDates([a, b], 'payloads');
    var msg = g('aprScanMsg');
    eq(msg({ found: 3, added: 2, updated: 1 }), '2 solicitudes nuevas registradas · 1 actualizada');
    // v3.1 (§14.4): sin «Todo al día…»
    eq(msg({ found: 3, added: 0, updated: 0 }), 'Nada nuevo · 3 correos revisados');
    eq(msg(null), 'Nada nuevo');
  });

  test('aprob-ui · tarjeta pendiente: datos de la solicitud, CeCos, «Tu CeCo», sugerido y acciones', function () {
    var E = env({ sols: [sol(), sol({ id: 'SOL-x', pr: 'PR9', nombre: '<img src=x onerror=alert(1)>', hiloUrl: 'javascript:alert(1)', lectura: 'parcial', estado: 'Pendiente' })] });
    ok(E.views['budget.approvals'], 'vista registrada');
    var html = E.views['budget.approvals'].render({});
    ['PR71524', 'Piloto Green Energy en Transcom', 'Gonzalo Alejandro Cortes Uarac', 'Luxmeter Energy SpA', '$13.473.363',
      'XUF80853', 'Proy.Cambios Clima', 'Tu CeCo', '109,80', '≈ $4.509.976', 'Sugerido para tu presupuesto', 'tu CeCo XUF80853',
      'Revisar ahora',
      'data-action="aprob.link"', 'data-action="aprob.newLine"', 'data-action="aprob.discard"',
      'href="https://mail.google.com/mail/u/0/#inbox/abc" target="_blank" rel="noopener noreferrer"', 'Comentario del solicitante',
      'el correo no se pudo leer completo'].forEach(function (x) { includes(html, x); });
    ok(html.indexOf('<img src=x') < 0 && html.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, 'nombre escapado');
    ok(html.indexOf('javascript:') < 0, 'hilo con URL no http(s) → sin link');
    ok(/Pendientes<span[^>]*>2</.test(html), 'contador de pendientes en el filtro');
    // Lectura automática: estado desde getAdminStatus().aprob
    E.get('aprUi')().st = { triggerInstalled: true, lastScan: new Date(Date.now() - 5 * 60000).toISOString() };
    includes(E.views['budget.approvals'].render({}), 'Última revisión hace 5 min');
    E.get('aprUi')().st.hour = 7;
    includes(E.views['budget.approvals'].render({}), 'Activa · a diario ~7:00');
  });

  test('aprob-ui · tarjetas procesadas: resultado (línea, monto, quién) y «Deshacer»; sin bandeja → Ajustes', function () {
    var E = env({ sols: [
      sol({ id: 'SOL-v', estado: 'Vinculada', lineId: 'L-00000001', montoImputado: 4509976, procesadoPor: 'gvicencio@copec.cl', procesado: new Date().toISOString(), nota: 'Cuota 1' }),
      sol({ id: 'SOL-d', pr: 'PR2', estado: 'Descartada', nota: 'No es nuestro' }),
      sol({ id: 'SOL-n', pr: 'PR3', estado: 'Nueva línea', lineId: 'L-borrada' }),
    ] });
    var u = E.get('aprUi')();
    u.filter = 'all';
    var html = E.views['budget.approvals'].render({});
    includes(html, 'Registrada en');
    includes(html, 'data-action="aprob.openLine" data-id="L-00000001"');
    includes(html, 'Green Energy: Paneles solares en camiones');
    includes(html, '$4.509.976');
    includes(html, 'Gonzalo · ahora');
    includes(html, '«No es nuestro»');
    includes(html, 'una línea que ya no está en la planilla');
    eq((html.match(/data-action="aprob\.reset"/g) || []).length, 3, 'Deshacer en cada procesada');
    ok(html.indexOf('data-action="aprob.link"') < 0, 'sin acciones de registro en procesadas');
    // Vacía sin lectura automática → explica cómo activarla en Ajustes
    var E2 = env({ sols: [] });
    var h2 = E2.views['budget.approvals'].render({});
    includes(h2, 'Ir a Ajustes');
    includes(h2, 'data-to="#/ajustes"');
    // Sólo administradores
    includes(env({ admin: false, sols: [sol()] }).views['budget.approvals'].render({}), 'Sólo para administradores');
  });

  test('aprob-ui · modal «Vincular a línea»: líneas del año por pilar, sugeridas arriba, preselección y payload', function () {
    var E = env({ sols: [sol(), sol({ id: 'SOL-2', pr: 'PR2', estado: 'Vinculada', lineId: 'L-00000001', montoImputado: 1000000 })] });
    var opts = E.get('aprLineOptions')(sol(), 2026);
    includes(opts, 'Sugeridas');
    ok(opts.indexOf('Sugeridas') < opts.indexOf('Economía Circular'), 'sugeridas primero');
    ok(/value="L-00000002" checked/.test(opts), 'única línea que menciona el PR → preseleccionada');
    includes(opts, 'Menciona PR71524');
    includes(opts, '1 solicitud · $1.000.000', 'lo ya imputado a la línea');
    includes(opts, 'Humedales &lt;b&gt;');
    eq((opts.match(/name="lineId"/g) || []).length, LINES.length, 'cada línea aparece una sola vez');
    includes(E.get('aprLineOptions')(sol(), 2027), 'aún no tiene líneas');
    E.actions['aprob.link']({ id: 'SOL-aaaa0001' });
    eq(E.modals.length, 1);
    includes(E.modals[0].body, 'Marcar OC emitida en la línea');
    includes(E.modals[0].body, 'value="4.509.976"', 'monto sugerido por defecto');
    E.actions['aprob.newLine']({ id: 'SOL-aaaa0001' });
    includes(E.modals[1].body, 'Fuera de POA');
    ok(/<option value="cc" selected>/.test(E.modals[1].body), 'área sugerida por el CeCo propio');
    includes(E.modals[1].body, 'value="Piloto Green Energy en Transcom"');
  });

  test('aprob-ui · descartar/deshacer van al servidor con la API de §13.2; acciones sólo en aprob.*', function () {
    var E = env({ sols: [sol({ id: 'SOL-d', estado: 'Descartada' })] });
    Object.keys(E.actions).forEach(function (k) { ok(/^aprob\./.test(k), 'acción fuera del espacio aprob.*: ' + k); });
    E.actions['aprob.reset']({ id: 'SOL-d' });
    eq(E.calls.length, 1);
    eq(E.calls[0].fn, 'aprobReset');
    deepEq(E.calls[0].args, ['SOL-d']);
    eq(E.S.solicitudes[0].estado, 'Pendiente', 'cambio instantáneo en pantalla');
    E.actions['aprob.scan']({});
    eq(E.calls[1].fn, 'aprobScan');
    // aprFocus: deja la solicitud a la vista en su pestaña
    E.S.solicitudes[0].estado = 'Vinculada';
    E.get('aprFocus')('SOL-d');
    var u = E.get('aprUi')();
    eq(u.filter, 'Vinculada'); eq(u.scrollTo, 'SOL-d'); deepEq(u.flash, ['SOL-d']);
    deepEq(E.gone, ['#/presupuesto/solicitudes']);
  });

  // ---------- De punta a punta: correo de Ariba → bandeja → vincular / línea nueva / descartar / deshacer ----------
  var SUBJECT = 'Acción necesaria: Aprobar el/la Solicitud de compra que GONZALO ALEJANDRO CORTES UARAC ha enviado - PR71524 - Piloto Green Energy en Transcom ($13.473.363,17 CLP)';
  function addMail(over) {
    MOCK.gmail.add(Object.assign({
      from: 'Aprobación por correo electrónico <buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com>', to: 'gvicencio@copec.cl',
      subject: SUBJECT, date: new Date(Date.now() - 3600000), plainBody: readText('dev/fixtures/ariba_PR71524.txt'),
    }, over || {}));
  }
  // Vista renderizada con el bundle real del servidor (lo que vería Gonzalo)
  function viewWith(b, filter) {
    var E = env({ sols: b.solicitudes, lines: b.budget['2026'] });
    if (filter) E.get('aprUi')().filter = filter;
    return { E: E, html: E.views['budget.approvals'].render({}) };
  }
  test('aprob-ui · de punta a punta con Aprobaciones.gs: la tarjeta muestra lo leído y los payloads del cliente funcionan', function () {
    need('aprobScan', 'aprobLink', 'aprobNewLine', 'aprobDiscard', 'aprobReset');
    fresh('setup');
    addMail();
    addMail({ subject: SUBJECT.replace('PR71524', 'PR80001').replace('Piloto Green Energy en Transcom', 'Taller de reciclaje'), plainBody: readText('dev/fixtures/ariba_PR71524.txt').replace(/PR71524/g, 'PR80001') });
    var b = client('aprobScan');
    assertNoDates(b.solicitudes, 'solicitudes');
    var s = b.solicitudes.find(function (x) { return x.pr === 'PR71524'; });
    ok(s, 'se registró PR71524');
    var v = viewWith(b);
    ['PR71524', 'Piloto Green Energy en Transcom', 'Gonzalo Alejandro Cortes Uarac', '$13.473.363', 'XUF80853', 'Tu CeCo',
      'Sugerido para tu presupuesto', fmt(s.sugerido)].forEach(function (x) { includes(v.html, x); });
    // Vincular con el payload real del cliente (OC marcada)
    var line = b.budget['2026'].find(function (l) { return l.pf > 0 && l.oc !== 'Si'; });
    ok(line, 'hay una línea 2026 con monto y sin OC');
    var pay = v.E.get('aprLinkPayload')({ year: '2026', lineId: line.id, monto: s.sugerido, marcarOc: true, nota: 'Cuota 1' });
    var b2 = client('aprobLink', s.id, pay);
    var s2 = b2.solicitudes.find(function (x) { return x.id === s.id; });
    eq(s2.estado, 'Vinculada'); eq(s2.lineId, line.id); eq(s2.montoImputado, s.sugerido);
    var l2 = b2.budget['2026'].find(function (l) { return l.id === line.id; });
    eq(l2.oc, 'Si', 'OC marcada en la línea');
    ok(/PR71524/.test(l2.nota), 'PR anotado en la nota de la línea');
    var v2 = viewWith(b2, 'Vinculada');
    includes(v2.html, 'data-action="aprob.openLine" data-id="' + line.id + '"');
    includes(v2.html, 'Registrada en');
    // Línea nueva para la otra (Fuera de POA, área sugerida por el CeCo propio)
    var o = b2.solicitudes.find(function (x) { return x.pr === 'PR80001'; });
    ok(o, 'se registró PR80001');
    var area = v2.E.get('aprGuessPilar')(o);
    eq(area, 'cc');
    var b3 = client('aprobNewLine', o.id, v2.E.get('aprNewLinePayload')({ year: '2026', area: area, proj: 'Taller de reciclaje', monto: 1234567, nota: '' }));
    var o3 = b3.solicitudes.find(function (x) { return x.id === o.id; });
    eq(o3.estado, 'Nueva línea');
    var nl = b3.budget['2026'].find(function (l) { return l.id === o3.lineId; });
    ok(nl, 'la línea nueva existe');
    eq(nl.clas, 'Fuera de POA'); eq(nl.pf, 1234567); eq(nl.oc, 'Si'); eq(nl.pilar, 'cc');
    // En el detalle de la línea (VPresupuesto) aparecen sus solicitudes
    includes(budEnv(true, b3.solicitudes).lineSols({ id: line.id }), 'PR71524');
    includes(budEnv(true, b3.solicitudes).lineSols({ id: nl.id }), 'creó esta línea');
    // Deshacer y descartar
    var b4 = client('aprobReset', s.id);
    eq(b4.solicitudes.find(function (x) { return x.id === s.id; }).estado, 'Pendiente');
    var b5 = client('aprobDiscard', s.id, 'No es nuestro');
    var s5 = b5.solicitudes.find(function (x) { return x.id === s.id; });
    eq(s5.estado, 'Descartada'); eq(s5.nota, 'No es nuestro');
    includes(viewWith(b5, 'Descartada').html, '«No es nuestro»');
    // Sólo administradores ven solicitudes
    asUser(U.ina, function () { deepEq(client('bootstrap').solicitudes || [], [], 'Ina no recibe solicitudes'); });
  });
  function fmt(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }

  // ---------- VPresupuesto: detalle de línea y resumen ----------
  function budEnv(admin, sols) {
    var code = coreCode(), vp = src('VPresupuesto');
    // v3.1: budLineSols usa budSolLinked/budSolKey y el ojo «Ver correo de respaldo» (budEye)
    var pieces = ['const BUD_MUTED ', 'const BUD_EYE ', 'function budSum(', 'function budIconBox(', 'function budIsAdmin(', 'function budSols(', 'function budSolLinked(',
      'function budSolKey(', 'function budSolsOfLine(', 'function budEye(', 'function budSolDate(', 'function budLineSols(', 'function budSolPendingCard('].map(function (p) { return top(vp, p); }).join('\n');
    var S = { me: { email: 'gvicencio@copec.cl', admin: admin }, users: [], pillars: [], solicitudes: sols };
    return new Function('S', 'isAdminUI', code + pieces + '\nreturn { lineSols: budLineSols, pending: budSolPendingCard };')(S, function () { return !!S.me.admin; });
  }
  test('aprob-ui · Presupuesto: solicitudes de la línea (admin) y aviso «Por registrar» en el resumen', function () {
    var sols = [
      sol({ id: 'SOL-a', estado: 'Vinculada', lineId: 'L-1', montoImputado: 4509976 }),
      sol({ id: 'SOL-b', pr: 'PR2', nombre: 'Otra', estado: 'Nueva línea', lineId: 'L-1', montoImputado: 1000000, fecha: '2026-09-01T12:00:00.000Z' }),
      sol({ id: 'SOL-c', pr: 'PR3', estado: 'Pendiente' }),
      sol({ id: 'SOL-d', pr: 'PR4', estado: 'Pendiente', sugerido: 0, montoClp: 500 }),
      sol({ id: 'SOL-e', pr: 'PR5', estado: 'Descartada', lineId: 'L-1' }),
    ];
    var B = budEnv(true, sols);
    var h = B.lineSols({ id: 'L-1' });
    includes(h, 'Solicitudes de compra');
    includes(h, 'data-action="budget.openSol" data-id="SOL-a"');
    includes(h, 'data-action="budget.openSol" data-id="SOL-b"');
    ok(h.indexOf('SOL-e') < 0 && h.indexOf('SOL-c') < 0, 'sólo vinculadas / líneas nuevas');
    ok(h.indexOf('SOL-a') < h.indexOf('SOL-b'), 'más nuevas primero');
    includes(h, '$5.509.976', 'total imputado (v3.1: sin el conteo redundante)');
    includes(h, 'creó esta línea');
    includes(h, 'data-action="budget.solInbox"');
    eq(B.lineSols({ id: 'L-2' }), '', 'sin solicitudes → no se muestra');
    var p = B.pending();
    includes(p, 'Por registrar: 2 solicitudes de compra');
    includes(p, '$4.510.476 sugerido');
    includes(p, 'href="#/presupuesto/solicitudes"');
    var N = budEnv(false, sols);
    eq(N.lineSols({ id: 'L-1' }), '', 'no admin: nada');
    eq(N.pending(), '', 'no admin: nada');
    eq(budEnv(true, [sols[0]]).pending(), '', 'sin pendientes: nada');
  });
})();
