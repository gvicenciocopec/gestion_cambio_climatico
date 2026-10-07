/* v3 · VAsistente (búsqueda en Drive, Gemini sólo si está activo, privacidad) y VAdmin (Ajustes de administración,
   privacidad, catálogo Cascade más amable, Historial sólo administración).
   Se evalúa el código real del cliente (Core.html + la vista) en una función aislada con un DOM mínimo y un bundle
   armado a mano (no depende del estado del servidor). */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  var NAMES = ['applyBundle', 'todayStr', 'addDays', 'ACTIONS', 'IDX', 'LS',
    'ASST', 'asstQueryHtml', 'asstHomeHtml', 'asstCommands', 'asstDocs', 'asstSrcVisible', 'asstAiStillVisible', 'asstDrive', 'asstKeydown',
    'admState', 'admSettingsView', 'admHistoryView', 'admCascadeImportPreview', 'admAribaCard', 'admCascadeImportCard', 'admPrivacyCard',
    'admTeamCard', 'admItemStats', 'admCascadeView', 'admItemDrawer', 'admScanText', 'admAprobResult'];

  // Carga Core + vista en un ámbito propio. Devuelve {x: exports, opened: [window.open], store: localStorage}
  function env(file, bundle) {
    var opened = [], store = {};
    var cls = { contains: function () { return false; }, toggle: function () {}, add: function () {}, remove: function () {} };
    var doc = {
      addEventListener: function () {}, documentElement: { classList: cls, style: {} }, getElementById: function () { return null; },
      querySelectorAll: function () { return []; }, querySelector: function () { return null; }, activeElement: null, body: {},
      contains: function () { return false; }, title: '',
    };
    var win = { addEventListener: function () {}, open: function (u, t, f) { opened.push([u, t, f]); return null; } };
    var ls = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } };
    var exp = '{' + NAMES.map(function (n) { return n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined'; }).join(', ') + '}';
    var x = new Function('document', 'window', 'navigator', 'localStorage', 'google', 'lucide', 'location',
      src('Core') + '\n' + src(file) + '\n;return ' + exp + ';')(doc, win, { platform: 'MacIntel', userAgent: '' }, ls, undefined, undefined, { hash: '' });
    if (bundle) x.applyBundle(bundle);
    return { x: x, opened: opened, store: store };
  }

  function bundle(o) {
    o = o || {};
    var me = o.me || U.gonzalo;
    var t0 = new Date(), ymd = function (n) { var d = new Date(t0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var task = function (id, p) {
      return Object.assign({ id: id, pilar: 'cc', proyecto: '', nombre: id, detalle: '', resp: me, fecha: '', estado: 'Pendiente', cascade: '', evidencias: [],
        cierre: '', completada: '', privada: false, avisar: true, orden: 0, creadoPor: me, creado: t0.toISOString(), actualizadoPor: me, actualizado: t0.toISOString() }, p);
    };
    var cas = function (id, padre, nombre, clase, orden) { return { id: id, pilar: 'cc', padre: padre, nombre: nombre, etiqueta: padre ? '' : 'Iniciativa', clase: clase, orden: orden }; };
    return {
      me: { email: me, name: me === U.gonzalo ? 'Gonzalo' : 'Ina', admin: o.admin !== false && me === U.gonzalo },
      users: [{ email: U.ina, name: 'Ina', color: 'violet' }, { email: U.benja, name: 'Benja', color: 'sky' }, { email: U.ignacio, name: 'Ignacio', color: 'amber' }, { email: U.gonzalo, name: 'Gonzalo', color: 'emerald' }],
      pillars: [{ key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
        { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
        { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' }],
      years: [2026], defaultYear: 2026,
      budget: { '2026': [{ id: 'L-0000000a', year: 2026, row: 2, pilar: 'cc', area: 'Cambio Climatico', proj: 'Green Energy paneles', clas: 'POA', po: 1000, pf: 1000, pg: 0, pend: 1000, oc: 'No', estado: 'Por ejecutar', alerta: 'Pagar/OC ya', nota: '', resp: '' }] },
      projects: [{ id: 'PRJ-0000000a', pilar: 'cc', nombre: 'Piloto 1er Camión eléctrico', detalle: '', resp: me, estado: 'Activo', anio: '', lineas: [], cascade: 'CAS-A1', evidencias: [], inicio: '', fin: '' }],
      tasks: [
        task('TSK-0000000a', { nombre: 'Cotizar cargadores eléctricos', proyecto: 'PRJ-0000000a', cascade: 'CAS-A1', fecha: ymd(0) }),
        task('TSK-0000000b', { nombre: 'Llamar al dentista zafiro', pilar: '', privada: true }),
        task('TSK-0000000c', { nombre: 'Enviar informe flota', cascade: 'CAS-A1', fecha: ymd(-2) }),
      ],
      cascade: [cas('CAS-G1', '', 'Electrificación flota logística', 'grupo', 1), cas('CAS-A1', 'CAS-G1', 'Piloto 1er Camión eléctrico', 'accion', 1),
        cas('CAS-A2', 'CAS-G1', 'Proyecto camiones híbridos', 'accion', 2), cas('CAS-G2', '', 'Estrategia descarbonización Logística', 'grupo', 2),
        cas('CAS-H1', 'CAS-G2', 'Mesas de trabajo', 'hito', 1), cas('CAS-H2', 'CAS-G2', 'Entregable final', 'hito', 2),
        cas('CAS-G3', '', 'Mitigación Huella', 'grupo', 3), cas('CAS-K1', 'CAS-G3', 'Movener', 'kpi', 1)],
      comments: [
        { id: 'CMT-0000000a', ref: 'TSK-0000000a', texto: 'Hablé con el proveedor de cargadores', autor: me, creado: t0.toISOString() },
        { id: 'CMT-0000000b', ref: 'TSK-0000ffff', texto: 'secreto rubí de otra persona', autor: U.ina, creado: t0.toISOString() },
      ],
      config: { alertDays: 7, notifyDays: 3, geminiEnabled: !!o.gemini, tz: 'America/Santiago', today: ymd(0), sheetUrl: '', appUrl: '', version: '3.0.0', warnings: [] },
      solicitudes: o.admin === false || me !== U.gonzalo ? [] : [{ id: 'SOL-0000000a', estado: 'Pendiente' }, { id: 'SOL-0000000b', estado: 'Vinculada' }],
      loadedAt: t0.toISOString(),
    };
  }

  function query(e, q) {
    var A = e.x.ASST;
    A.q = q; A.items = []; A.def = 0;
    var h = e.x.asstQueryHtml(q, function (it) { A.items.push(it); return A.items.length - 1; });
    return { html: h, items: A.items, def: A.def };
  }

  test('v3 asistente · fila «Buscar en Drive con IA de Google» y Gemini sólo si está activo', function () {
    var e = env('VAsistente', bundle());
    var r = query(e, 'informe huella');
    includes(r.html, 'Buscar en Drive con IA de Google · ', 'fila de Drive');
    includes(r.html, '«informe huella»');
    includes(r.html, 'folder-search', 'ícono verificado');
    ok(r.html.indexOf('Preguntar a Gemini') < 0, 'sin Gemini no hay fila de Gemini');
    ok(!/Activa Gemini/.test(src('VAsistente')), 'sin el aviso «Activa Gemini…»');
    ok(r.items.some(function (it) { return it.kind === 'drive'; }), 'la fila de Drive es navegable');
    ok(r.html.indexOf('Se abre en Google Drive') < 0, 'v3.1 (§14.4): sin nota al pie; la flecha indica la pestaña nueva');
    ok(query(e, 'in').html.indexOf('Buscar en Drive') < 0, 'menos de 3 caracteres: sin fila de Drive');

    var g = env('VAsistente', bundle({ gemini: true }));
    var rg = query(g, '¿qué vence esta semana?');
    includes(rg.html, 'Preguntar a Gemini');
    includes(rg.html, 'Buscar en Drive con IA de Google');
    eq(rg.items[rg.def].kind, 'ask', 'con Gemini, una pregunta va a Gemini por defecto');
  });

  test('v3 asistente · Drive abre la búsqueda en una pestaña nueva (fila, Alt+Enter) y se explica una sola vez', function () {
    var e = env('VAsistente', bundle());
    var r = query(e, 'zzqx sin resultados');
    eq(r.items[r.def].kind, 'drive', 'sin resultados en la app, Enter busca en Drive');
    var di = r.items.findIndex(function (it) { return it.kind === 'drive'; });
    e.x.ACTIONS['assistant.pick']({ idx: String(di) });
    eq(e.opened.length, 1, 'abrió una pestaña');
    eq(e.opened[0][0], 'https://drive.google.com/drive/search?q=' + encodeURIComponent('zzqx sin resultados'));
    eq(e.opened[0][1], '_blank');
    eq(e.opened[0][2], 'noopener');
    ok(query(e, 'zzqx sin resultados').html.indexOf('Se abre en Google Drive') < 0, 'la nota ya no se repite');

    e.x.ASST.q = 'Bonos & carbono?';
    var prevented = 0;
    e.x.asstKeydown({ key: 'Enter', altKey: true, preventDefault: function () { prevented++; } });
    eq(prevented, 1);
    eq(e.opened.length, 2, 'Alt+Enter también abre Drive');
    eq(e.opened[1][0], 'https://drive.google.com/drive/search?q=Bonos%20%26%20carbono%3F', 'consulta codificada');

    var home = e.x.asstHomeHtml(function () { return 0; });
    includes(home, 'Pregúntale a Drive: la IA de Drive busca en tus archivos', 'pista en la vista vacía');
  });

  test('v3 asistente · sin Avance ni rutas viejas; comandos de administración sólo para administración', function () {
    var code = src('VAsistente');
    ok(!/avance/i.test(code), 'sin referencias a Avance');
    ok(code.indexOf('gestion.mine') < 0, 'sin gestion.mine');
    var labels = function (b) { return env('VAsistente', b).x.asstCommands().map(function (c) { return c.label; }); };
    var adm = labels(bundle()), team = labels(bundle({ me: U.ina }));
    ['Vista general', 'Solicitudes de compra', 'Historial'].forEach(function (l) {
      includes(adm, l, 'administración ve ' + l);
      ok(team.indexOf(l) < 0, 'el equipo no ve ' + l);
    });
    includes(team, 'Abrir mis tareas', 'v3.1: «Mis tareas» se abre en el panel (no hay ruta propia)');
    includes(team, 'Planificación · Naturaleza', 'planificación por pilar al buscarla');
    var e = env('VAsistente', bundle({ me: U.ina }));
    var home = e.x.asstHomeHtml(function () { return 0; });
    ok(home.indexOf('Planificación') < 0 && home.indexOf('Ajustes') < 0, 'la vista vacía no se llena de accesos');
  });

  test('v3 asistente · privacidad: comentarios de tareas que no veo no se indexan; respuestas guardadas se validan', function () {
    var e = env('VAsistente', bundle());
    var docs = e.x.asstDocs();
    ok(docs.some(function (d) { return d.type === 'comment' && d.refId === 'TSK-0000000a'; }), 'comentario de una tarea visible');
    ok(!docs.some(function (d) { return /rub/.test(d.body); }), 'el comentario de una tarea que no está en mis datos no se indexa');
    var priv = docs.find(function (d) { return d.refId === 'TSK-0000000b' && d.type === 'task'; });
    ok(priv && priv.hay.indexOf('privada') >= 0, 'mis privadas se encuentran buscando «privada»');
    ok(query(e, 'dentista').html.indexOf('lock') >= 0, 'y muestran un candado');

    ok(e.x.asstSrcVisible({ id: 'TSK-0000000a', refId: 'TSK-0000000a' }), 'tarea visible');
    ok(!e.x.asstSrcVisible({ id: 'TSK-0000ffff', refId: 'TSK-0000ffff' }), 'tarea que no veo');
    ok(!e.x.asstSrcVisible({ id: 'TSK-0000ffff:ev1', refId: 'TSK-0000ffff', type: 'evidence' }), 'evidencia de una tarea que no veo');
    ok(e.x.asstSrcVisible({ id: 'L-0000000a', refId: 'L-0000000a' }), 'líneas y proyectos no cambian');
    ok(!e.x.asstAiStillVisible({ res: { sources: [{ id: 'TSK-0000ffff', refId: 'TSK-0000ffff' }], results: [] } }), 'no se restaura');
    ok(e.x.asstAiStillVisible({ res: { sources: [{ id: 'TSK-0000000a', refId: 'TSK-0000000a' }], results: [] } }), 'sí se restaura');

    // Resultados del servidor con una tarea que no está en mis datos: no se muestran
    e.x.ASST.ai = { qn: 'flota', q: 'flota', mode: 'search', status: 'done', res: { mode: 'search', found: true, answer: '', results: [
      { id: 'TSK-0000000c', type: 'task', title: 'Enviar informe flota', subtitle: '', pilar: 'cc', refId: 'TSK-0000000c' },
      { id: 'TSK-0000ffff', type: 'task', title: 'Tarea ajena privada', subtitle: '', pilar: 'cc', refId: 'TSK-0000ffff' }] } };
    var h = query(e, 'flota').html;
    includes(h, 'Enviar informe', 'la tarea visible sigue');
    ok(h.indexOf('Tarea ajena') < 0, 'la que no veo se filtra');
  });

  test('v3 asistente · tono amable: hoy en ámbar, rojo sólo para lo atrasado', function () {
    var e = env('VAsistente', bundle());
    var h = query(e, 'cotizar cargadores').html;     // vence hoy
    ok(h.indexOf('bg-red-50') < 0, 'hoy no es rojo');
    h = query(e, 'enviar informe flota').html;       // atrasada
    includes(h, 'bg-red-50', 'atrasada sí');
  });

  test('v3 ajustes · tarjetas de administración sólo para administración; privacidad para todos', function () {
    var a = env('VAdmin', bundle());
    var h = a.x.admSettingsView();
    ['Solicitudes de compra (Ariba)', 'Proyectos desde Cascade', 'Importar / completar proyectos', 'Privacidad de tus tareas'].forEach(function (t) { includes(h, t); });
    var t = env('VAdmin', bundle({ me: U.ina }));
    var ht = t.x.admSettingsView();
    includes(ht, 'Privacidad de tus tareas');
    includes(ht, 'sólo las ven tú y el responsable', 'v3.1: privacidad en una línea');
    includes(ht, 'quedan guardadas en la planilla');
    ['Solicitudes de compra (Ariba)', 'Proyectos desde Cascade', 'admin.importCascade', 'admin.aprobScan', 'Asistente Gemini'].forEach(function (s) {
      ok(ht.indexOf(s) < 0, 'el equipo no ve ' + s);
    });
    ok(!/urgente/.test(t.x.admTeamCard()), 'la tarjeta Equipo no expone urgencias de cada persona');
    ok(!/avance|gestion\.mine/i.test(src('VAdmin')), 'sin referencias a Avance ni a gestion.mine');
  });

  test('v3 ajustes · Proyectos desde Cascade: vista previa con la regla de §13.1 y acción importCascadeProjects', function () {
    var e = env('VAdmin', bundle());
    // G1: acciones A1 (ya tiene proyecto) y A2 → 1 · G2 sin acciones → el grupo + 2 hitos · G3 sólo KPI → el grupo
    deepEq(e.x.admCascadeImportPreview(), { projects: 3, tasks: 2 });
    var h = e.x.admCascadeImportCard();
    includes(h, '3 proyectos · 2 hitos');
    includes(h, 'data-action="admin.importCascade"');
    includes(src('VAdmin'), "mutate('importCascadeProjects', []");
    includes(String(e.x.admScanText({ found: 3, added: 1, updated: 0 })), '1 solicitud nueva');
    includes(e.x.admScanText({ found: 2, added: 0, updated: 0 }), 'sin novedades');
  });

  test('v3 ajustes · Ariba: estado de getAdminStatus().aprob, botones y nota del permiso de Gmail', function () {
    var e = env('VAdmin', bundle());
    var A = e.x.admState();
    A.status = null;
    includes(e.x.admAribaCard(), 'skeleton', 'cargando');
    A.status = { aprob: { triggerInstalled: false, lastScan: '', lastResult: null, sender: 'buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com' } };
    var h = e.x.admAribaCard();
    ['Sólo manual', 'Aún no se revisa', 'buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com', 'Permiso de Gmail', 'en el mismo correo',
      'data-action="admin.aprobInstall"', 'data-action="admin.aprobScan"', 'Activar revisión automática', 'Revisar ahora', '1 solicitud'].forEach(function (t) { includes(h, t); });
    A.status = { aprob: { triggerInstalled: true, lastScan: new Date().toISOString(), lastResult: { found: 4, added: 2, updated: 1 }, sender: 'x@y.z' } };
    h = e.x.admAribaCard();
    includes(h, 'Automática');
    includes(h, '2 nuevas · 1 actualizada');
    ok(h.indexOf('admin.aprobInstall') < 0, 'ya activa: sin botón de activar');
    A.status = { aprob: { triggerInstalled: true, lastScan: '', lastResult: { error: 'Sin permiso <Gmail>', at: '' }, sender: 'x@y.z', hour: 7 } };
    h = e.x.admAribaCard();
    includes(h, 'a diario ~7:00');
    includes(h, 'No se pudo leer Gmail: Sin permiso &lt;Gmail&gt;', 'error de lectura escapado');
    A.status = { admin: true };
    h = e.x.admAribaCard();
    includes(h, 'No disponible', 'servidor sin el módulo');
    ok(h.indexOf('admin.aprobScan') < 0 && h.indexOf('admin.aprobInstall') < 0, 'sin módulo no se ofrecen botones que fallarían');
    // Contrato con el servidor (si Aprobaciones.gs ya está)
    if (typeof aprobStatus_ === 'function' && typeof getAdminStatus === 'function') {
      fresh('setup');
      var st = client('getAdminStatus');
      ok(st.aprob && typeof st.aprob.triggerInstalled === 'boolean', 'getAdminStatus().aprob.triggerInstalled');
      ok('lastScan' in st.aprob && 'sender' in st.aprob, 'lastScan y sender');
    }
  });

  test('v3 VAdmin · Historial sólo administración; Cascade amable (rojo sólo atrasadas, proyectos vinculados)', function () {
    var t = env('VAdmin', bundle({ me: U.ina }));
    var h = t.x.admHistoryView();
    includes(h, 'El historial lo revisa la administración');
    ok(h.indexOf('admin.histReload') < 0, 'no ofrece cargar el historial');
    var e = env('VAdmin', bundle());
    var st = e.x.admItemStats(e.x.IDX.task ? Array.from(e.x.IDX.task.values()).filter(function (x) { return x.cascade === 'CAS-A1'; }) : []);
    eq(st.pending, 2);
    eq(st.overdue, 1, 'la que vence hoy no cuenta como atrasada');
    var view = e.x.admCascadeView();
    ok(view.indexOf('Con proyecto') < 0, 'v3.1 (§14.4): un proyecto con el mismo nombre del indicador no se anuncia en la fila');
    ok(view.indexOf('¿Qué se puede seleccionar?') < 0 && view.indexOf('Proyectos vinculados') < 0, 'v3.1 (§14.4): sin leyenda ni columna de cifras');
    var dr = e.x.admItemDrawer('CAS-A1');
    includes(dr.body, 'data-action="admin.openProject"', 'el panel lista el proyecto vinculado');
  });
})();
