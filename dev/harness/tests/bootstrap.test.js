/* bootstrap(), doGet(), getHistory(), getAdminStatus() · forma del bundle (SPEC §4) */
(function () {
  var LINE = { id: 'string', year: 'number', row: 'number', pilar: 'string', area: 'string', proj: 'string', clas: 'string', po: 'number', pf: 'number', pg: 'number', pend: 'number', oc: 'string', estado: 'string', alerta: 'string', nota: 'string', resp: 'string' };
  var PROJECT = { id: 'string', pilar: 'string', nombre: 'string', detalle: 'string', resp: 'string', estado: 'string', anio: 'string', lineas: 'array', cascade: 'string', evidencias: 'array', creadoPor: 'string', creado: 'string', actualizadoPor: 'string', actualizado: 'string' };
  var TASK = { id: 'string', pilar: 'string', proyecto: 'string', nombre: 'string', detalle: 'string', resp: 'string', fecha: 'string', estado: 'string', cascade: 'string', evidencias: 'array', cierre: 'string', completada: 'string', creadoPor: 'string', creado: 'string', actualizadoPor: 'string', actualizado: 'string' };
  var CASCADE = { id: 'string', pilar: 'string', padre: 'string', nombre: 'string', etiqueta: 'string', clase: 'string', orden: 'number' };
  var COMMENT = { id: 'string', ref: 'string', texto: 'string', autor: 'string', creado: 'string' };
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var PILLARS = ['cc', 'ec', 'nat'];

  function kind(v) { return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v; }
  function shape(obj, spec, label) {
    Object.keys(spec).forEach(function (k) {
      ok(k in obj, label + ': falta el campo "' + k + '"');
      eq(kind(obj[k]), spec[k], label + '.' + k + ' (tipo)');
    });
  }
  function isIso(s) { return typeof s === 'string' && s !== '' && !isNaN(Date.parse(s)) && /T/.test(s); }

  function checkBundle(b, opts) {
    opts = opts || {};
    ['me', 'users', 'pillars', 'years', 'defaultYear', 'budget', 'projects', 'tasks', 'cascade', 'comments', 'config', 'loadedAt'].forEach(function (k) {
      ok(k in b, 'falta bundle.' + k);
    });
    eq(typeof b.me.email, 'string', 'me.email'); eq(typeof b.me.name, 'string', 'me.name'); eq(typeof b.me.admin, 'boolean', 'me.admin');
    deepEq(b.users.map(function (u) { return u.email; }), [U.ina, U.benja, 'idiaz@copec.cl', U.gonzalo], 'users');
    deepEq(b.users.map(function (u) { return u.name; }), ['Ina', 'Benja', 'Ignacio', 'Gonzalo'], 'nombres');
    deepEq(b.pillars.map(function (p) { return p.key; }), PILLARS, 'pillars');
    b.pillars.forEach(function (p) { ['key', 'area', 'label', 'icon', 'color'].forEach(function (k) { eq(typeof p[k], 'string', 'pillar.' + k); }); });
    ok(Array.isArray(b.years) && b.years.every(function (y) { return typeof y === 'number'; }), 'years debe ser [Number]');
    deepEq(b.years.slice().sort(function (a, c) { return a - c; }), b.years, 'years ascendente');
    eq(typeof b.defaultYear, 'number', 'defaultYear');
    deepEq(Object.keys(b.budget).sort(), b.years.map(String).sort(), 'budget por año');
    eq(typeof b.config.alertDays, 'number', 'config.alertDays');
    ok(!('notifyDays' in b.config), 'v3.3: ya no hay aviso previo (notifyDays)');
    eq(typeof b.config.geminiEnabled, 'boolean', 'config.geminiEnabled');
    ['tz', 'today', 'sheetUrl', 'appUrl', 'version'].forEach(function (k) { eq(typeof b.config[k], 'string', 'config.' + k); });
    ok(YMD.test(b.config.today), 'config.today yyyy-mm-dd');
    eq(b.config.today, day(0), 'config.today es hoy en America/Santiago');
    ok(isIso(b.loadedAt), 'loadedAt ISO');
    ok(b.lastId === undefined, 'bootstrap no trae lastId');

    Object.keys(b.budget).forEach(function (y) {
      b.budget[y].forEach(function (l, i) {
        var lab = 'budget[' + y + '][' + i + ']';
        shape(l, LINE, lab);
        eq(l.year, Number(y), lab + '.year');
        includes(PILLARS, l.pilar, lab + '.pilar');
        if (opts.ids) ok(/^L-[0-9a-f]{8}$/.test(l.id), lab + '.id con formato L-xxxxxxxx (' + l.id + ')');
        ['po', 'pf', 'pg', 'pend'].forEach(function (k) { ok(Number.isInteger(l[k]), lab + '.' + k + ' entero'); });
      });
    });
    b.projects.forEach(function (p, i) { shape(p, PROJECT, 'projects[' + i + ']'); includes(PILLARS, p.pilar); ok(/^PRJ-/.test(p.id)); });
    b.tasks.forEach(function (t, i) {
      shape(t, TASK, 'tasks[' + i + ']');
      ok(t.fecha === '' || YMD.test(t.fecha), 'tasks[' + i + '].fecha yyyy-mm-dd');
      ok(t.completada === '' || YMD.test(t.completada), 'tasks[' + i + '].completada yyyy-mm-dd');
      includes(['Pendiente', 'Realizada'], t.estado, 'tasks[' + i + '].estado');
      ok(isIso(t.creado), 'tasks[' + i + '].creado ISO');
    });
    b.cascade.forEach(function (c, i) { shape(c, CASCADE, 'cascade[' + i + ']'); includes(['grupo', 'kpi', 'accion', 'objetivo', 'hito'], c.clase); });
    b.comments.forEach(function (c, i) { shape(c, COMMENT, 'comments[' + i + ']'); ok(isIso(c.creado), 'comments[' + i + '].creado ISO'); });
  }

  test('bootstrap · antes de setup(): bundle válido y NO crea la pestaña Gestión', function () {
    need('bootstrap');
    fresh('raw');
    var b = client('bootstrap');
    checkBundle(b, { ids: true });
    eq(b.projects.length + b.tasks.length + b.cascade.length + b.comments.length, 0, 'sin datos de gestión');
    ok(!MOCK.sheet('Gestión'), 'gRead_ nunca debe crear la hoja Gestión');
    eq(b.budget['2026'].length, SEED_CUADRE_2026.length - 1, 'líneas 2026');
  });

  test('bootstrap · después de setup(): catálogo Cascade y sin Date', function () {
    fresh('setup');
    var b = client('bootstrap');
    checkBundle(b, { ids: true });
    ok(b.cascade.length > 0, 'catálogo Cascade sembrado');
    assertNoDates(bootstrap(), 'bootstrap()');
  });

  test('bootstrap · con datos demo: forma completa, JSON round-trip idéntico', function () {
    fresh('demo');
    var raw = bootstrap();
    assertNoDates(raw, 'bootstrap()');
    var b = MOCK.strictClone(raw);
    checkBundle(b, { ids: true });
    deepEq(b, raw, 'el bundle debe sobrevivir JSON sin cambios');
    ok(b.projects.length >= 6 && b.tasks.length >= 25 && b.comments.length >= 5, 'demo cargado');
    var lineIds = {};
    Object.keys(b.budget).forEach(function (y) { b.budget[y].forEach(function (l) { lineIds[l.id] = true; }); });
    b.projects.forEach(function (p) { p.lineas.forEach(function (id) { ok(lineIds[id], 'proyecto ' + p.nombre + ' apunta a línea inexistente ' + id); }); });
    var prj = {}; b.projects.forEach(function (p) { prj[p.id] = p; });
    b.tasks.forEach(function (t) { if (t.proyecto) { ok(prj[t.proyecto], 'tarea con proyecto inexistente'); eq(t.pilar, prj[t.proyecto].pilar, 'pilar tarea = pilar proyecto'); } });
  });

  // v3.1 (SPEC §14.1, cambio intencional): las escrituras de Gestión devuelven un bundle PARCIAL; las de presupuesto,
  // el bundle completo. Ambos con lastId.
  test('bootstrap · cada mutación devuelve su bundle (parcial en Gestión, completo en presupuesto) con lastId', function () {
    fresh('setup');
    var b = client('gSave', { tipo: 'Proyecto', pilar: 'cc', nombre: 'Proyecto bundle', resp: U.gonzalo });
    eq(b.partial, 'gestion', 'gSave → parcial');
    ok(!('budget' in b) && !('me' in b) && !('config' in b), 'sin presupuesto, me ni config');
    ok(isIso(b.loadedAt), 'loadedAt ISO');
    var full = Object.assign({}, bootstrap(), { projects: b.projects, tasks: b.tasks, cascade: b.cascade, comments: b.comments });
    checkBundle(MOCK.strictClone(full), { ids: true });
    ok(/^PRJ-[0-9a-f]{8}$/.test(b.lastId), 'lastId PRJ-xxxxxxxx');
    var y = bootstrap().years[0];
    var bb = client('budgetSave', y, '', { area: 'cc', proj: 'Línea bundle', clas: 'Nuevo', po: 1, pf: 1, pg: 0, oc: 'No' });
    checkBundle(Object.assign({}, bb, { lastId: undefined }), { ids: true });
    ok(/^L-[0-9a-f]{8}$/.test(bb.lastId), 'budgetSave → bundle completo con lastId L-xxxxxxxx');
  });

  test('bootstrap · usuario sin correo → "desconocido", no admin', function () {
    fresh('setup');
    MOCK.user = '';
    var b = client('bootstrap');
    eq(b.me.email, 'desconocido');
    eq(b.me.admin, false);
  });

  test('bootstrap · usuaria no administradora', function () {
    fresh('setup');
    MOCK.user = U.ina;
    var b = client('bootstrap');
    eq(b.me.email, U.ina); eq(b.me.name, 'Ina'); eq(b.me.admin, false);
    MOCK.user = 'GVicencio@Copec.cl';
    eq(client('bootstrap').me.email, U.gonzalo, 'correo en minúsculas');
  });

  test('doGet · evalúa Index.html con todos sus parciales (como HtmlService)', function () {
    need('doGet', 'include');
    var idx = MOCK.files.Index;
    ok(idx, 'falta apps-script/Index.html');
    var names = [], re = /include\(\s*'([^']+)'\s*\)/g, m;
    while ((m = re.exec(idx))) names.push(m[1]);
    var missing = names.filter(function (n) { return !(n in MOCK.files); });
    ok(!missing.length, 'Index.html incluye parciales que no existen (la app no cargaría): ' + missing.join(', '));
    var out = doGet();
    var html = out.getContent();
    ok(html.indexOf('<?') < 0, 'quedaron scriptlets sin evaluar');
    includes(html, 'boot()', 'Index debe llamar boot()');
    eq(out.getTitle(), CONFIG.APP_NAME, 'título');
  });

  test('getHistory · más nuevo primero, sin Date, límite', function () {
    need('getHistory');
    fresh('demo');
    var h = client('getHistory', 5);
    eq(h.length, 5, 'respeta el límite');
    h.forEach(function (r) { ['fecha', 'usuario', 'accion', 'entidad', 'detalle'].forEach(function (k) { eq(typeof r[k], 'string', 'historial.' + k); }); });
    ok(h[0].fecha >= h[4].fecha, 'orden descendente por fecha');
    ok(client('getHistory', 100000).length <= 1000, 'máximo 1000');
  });

  test('getAdminStatus · forma y valores', function () {
    need('getAdminStatus');
    fresh('setup');
    var s = client('getAdminStatus');
    eq(s.admin, true); eq(s.triggerInstalled, true, 'setup() instaló el activador'); eq(s.geminiEnabled, false);
    eq(s.model, CONFIG.GEMINI_MODEL); deepEq(s.years, [2026, 2027]); eq(s.tz, 'America/Santiago');
    ok(s.gestionRows > 0, 'gestionRows');
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'k-123');
    PropertiesService.getScriptProperties().setProperty('GEMINI_MODEL', 'gemini-3.7-flash');
    s = client('getAdminStatus');
    eq(s.geminiEnabled, true); eq(s.model, 'gemini-3.7-flash');
    ok(JSON.stringify(s).indexOf('k-123') < 0, 'la API key nunca viaja al cliente');
    ok(JSON.stringify(client('bootstrap')).indexOf('k-123') < 0, 'ni en el bundle');
  });
})();
