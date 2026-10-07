/* v3.1 · VAdmin (Ajustes: «Ver como admin», «Carpetas de Drive», menos texto en Ajustes / Cascade / Historial) y
   VAsistente (sin la ruta de la página de tareas: «Abrir mis tareas» usa el panel; comandos de administración según
   isAdminUI(); menos notas al pie). SPEC §14.3 y §14.4.
   Se evalúa el código real del cliente (Core.html + la vista) en un ámbito aislado con un DOM mínimo, google.script.run
   simulado (cada llamada queda en cola y la prueba decide la respuesta) y toast() capturado. */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }

  var NAMES = ['applyBundle', 'ACTIONS', 'IDX', 'LS', 'isAdminUI', 'setAdminView',
    'ASST', 'asstQueryHtml', 'asstHomeHtml', 'asstCommands', 'asstOpenMyTasks', 'asstShellHtml',
    'admState', 'admSettingsView', 'admSettingsMount', 'admHistoryView', 'admCascadeView', 'admItemDrawer', 'admDriveCard', 'admViewCard', 'admDriveCreateMsg',
    'admPrivacyCard', 'admNotifCard', 'admProfileCard'];

  // Entorno: o.els = {id: elemento falso} para getElementById; o.query = {selector: elemento} para querySelector.
  function env(file, bundle, o) {
    o = o || {};
    var E = { calls: [], net: [], toasts: [], store: {}, timers: [], focused: [], sheet: 0, expand: 0, wide: o.wide !== false, els: o.els || {}, query: o.query || {} };
    var cls = { contains: function () { return false; }, toggle: function () {}, add: function () {}, remove: function () {} };
    var doc = {
      addEventListener: function () {}, documentElement: { classList: cls, style: {} },
      getElementById: function (id) { return Object.prototype.hasOwnProperty.call(E.els, id) ? E.els[id] : null; },
      querySelectorAll: function () { return []; }, querySelector: function (s) { return Object.prototype.hasOwnProperty.call(E.query, s) ? E.query[s] : null; },
      activeElement: null, body: {}, contains: function () { return false; }, title: '',
    };
    var win = { addEventListener: function () {}, open: function () { return null; } };
    var ls = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(E.store, k) ? E.store[k] : null; },
      setItem: function (k, v) { E.store[k] = String(v); },
    };
    function chain(okFn, koFn) {
      var c = {
        withSuccessHandler: function (f) { return chain(f, koFn); },
        withFailureHandler: function (f) { return chain(okFn, f); },
      };
      ['driveStatus', 'driveSetRoot', 'driveCreateMissing', 'bootstrap', 'getAdminStatus', 'getHistory'].forEach(function (name) {
        c[name] = function () {
          E.calls.push({ fn: name, args: MOCK.strictClone(Array.prototype.slice.call(arguments), name + '(argumentos)') });
          E.net.push({ fn: name, ok: okFn, ko: koFn });
        };
      });
      return c;
    }
    // Stubs del panel de tareas (TodoPanel no se carga aquí) y captura de toasts
    var tail = '\nfunction todoIsWide() { return __E.wide; }\nfunction todoOpenSheet() { __E.sheet++; }\n' +
      'ACTIONS["todo.expand"] = function () { __E.expand++; };\n' +
      'toast = function (m, t) { __E.toasts.push([String(m), t || "success"]); };\n';
    var exp = '{' + NAMES.map(function (n) { return n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined'; }).join(', ') + '}';
    var x = new Function('document', 'window', 'navigator', 'localStorage', 'google', 'lucide', 'location', 'setTimeout', 'clearTimeout', '__E',
      src('Core') + '\n' + src(file) + tail + '\n;return ' + exp + ';')(
      doc, win, { platform: 'MacIntel', userAgent: '' }, ls, { script: { run: chain(null, null) } }, undefined, { hash: '' },
      function (f) { E.timers.push(f); return E.timers.length; }, function () {}, E);
    if (bundle) x.applyBundle(bundle);
    E.x = x;
    // Responde la primera llamada pendiente a fn (valor, o error si fail) y deja correr las promesas
    E.respond = function (fn, value, fail) {
      var i = E.net.findIndex(function (n) { return n.fn === fn; });
      ok(i >= 0, 'no hay una llamada pendiente a ' + fn);
      var n = E.net.splice(i, 1)[0];
      if (fail) { if (n.ko) n.ko(new Error(value)); } else if (n.ok) n.ok(MOCK.strictClone(value, fn + '(respuesta)'));
      drainMicrotasks();
    };
    E.count = function (fn) { return E.calls.filter(function (c) { return c.fn === fn; }).length; };
    E.lastToast = function () { return E.toasts[E.toasts.length - 1] || ['', '']; };
    return E;
  }

  function bundle(o) {
    o = o || {};
    var me = o.me || U.gonzalo;
    var t0 = new Date(), ymd = function (n) { var d = new Date(t0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var task = function (id, p) {
      return Object.assign({ id: id, pilar: 'cc', proyecto: '', nombre: id, detalle: '', resp: me, fecha: '', estado: 'Pendiente', cascade: '', evidencias: [],
        cierre: '', completada: '', privada: false, avisar: true, orden: 0, creadoPor: me, creado: t0.toISOString(), actualizadoPor: me, actualizado: t0.toISOString() }, p);
    };
    var proj = function (id, p) {
      return Object.assign({ id: id, pilar: 'cc', nombre: id, detalle: '', resp: me, estado: 'Activo', anio: '', lineas: [], cascade: '', evidencias: [], inicio: '', fin: '' }, p);
    };
    var cas = function (id, padre, nombre, clase, orden) { return { id: id, pilar: 'cc', padre: padre, nombre: nombre, etiqueta: padre ? '' : 'Iniciativa', clase: clase, orden: orden }; };
    var projects = [proj('PRJ-0000000a', { nombre: 'Piloto 1er Camión eléctrico', cascade: 'CAS-A1' }), proj('PRJ-0000000b', { nombre: 'Huella 2026' })];
    if (o.carpetas) { projects[0].carpeta = 'FOLDER-1'; projects[0].carpetaUrl = 'https://drive.google.com/drive/folders/FOLDER-1'; projects[1].carpeta = ''; projects[1].carpetaUrl = ''; }
    return {
      me: { email: me, name: me === U.gonzalo ? 'Gonzalo' : 'Ina', admin: me === U.gonzalo },
      users: [{ email: U.ina, name: 'Ina', color: 'violet' }, { email: U.benja, name: 'Benja', color: 'sky' }, { email: U.ignacio, name: 'Ignacio', color: 'amber' }, { email: U.gonzalo, name: 'Gonzalo', color: 'emerald' }],
      pillars: [{ key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
        { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
        { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' }],
      years: [2026], defaultYear: 2026,
      budget: { '2026': [{ id: 'L-0000000a', year: 2026, row: 2, pilar: 'cc', area: 'Cambio Climatico', proj: 'Green Energy paneles', clas: 'POA', po: 1000, pf: 1000, pg: 0, pend: 1000, oc: 'No', estado: 'Por ejecutar', alerta: 'Pagar/OC ya', nota: '', resp: '' }] },
      projects: projects,
      tasks: [
        task('TSK-0000000a', { nombre: 'Cotizar cargadores', proyecto: 'PRJ-0000000a', cascade: 'CAS-A1', fecha: ymd(-1) }),
        task('TSK-0000000b', { nombre: 'Informe flota', cascade: 'CAS-A1', estado: 'Realizada', completada: ymd(-3) }),
      ],
      cascade: [cas('CAS-G1', '', 'Electrificación flota logística', 'grupo', 1), cas('CAS-A1', 'CAS-G1', 'Piloto 1er Camión eléctrico', 'accion', 1),
        cas('CAS-A2', 'CAS-G1', 'Proyecto camiones híbridos', 'accion', 2), cas('CAS-G2', '', 'Grupo vacío', 'grupo', 2)],
      comments: [],
      config: { alertDays: 7, notifyDays: 3, geminiEnabled: false, tz: 'America/Santiago', today: ymd(0), sheetUrl: 'https://docs.google.com/spreadsheets/d/x', appUrl: '', version: '3.1.0', warnings: [] },
      solicitudes: me === U.gonzalo ? [{ id: 'SOL-0000000a', estado: 'Pendiente' }] : [],
      loadedAt: t0.toISOString(),
    };
  }
  // Claves de las tarjetas de Ajustes en el orden en que aparecen
  function cardKeys(html) {
    var out = [], re = /aria-labelledby="set-([a-z-]+)"/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  }
  function settled(E) { var A = E.x.admState(); A.status = { triggerInstalled: true, appUrl: '', appUrlSaved: true, aprob: { triggerInstalled: false, lastScan: '', lastResult: null, sender: 'x@y.z' } }; A.drive = { configured: false, root: null, admin: true }; return A; }

  test('v31 ajustes · «Ver como admin»: sólo cuentas de administración; apagado = exactamente lo del equipo', function () {
    var g = env('VAdmin', bundle());
    settled(g);
    var on = g.x.admSettingsView();
    includes(on, 'Ver como admin');
    includes(on, 'role="switch" aria-checked="true" data-action="admin.viewAs"', 'interruptor encendido y accesible');
    includes(on, 'Activado:', 'el estado se lee en texto');
    var onKeys = cardKeys(on);
    eq(onKeys[0], 'vista', 'la tarjeta Vista va arriba');
    ['drive', 'ariba', 'cascade-import'].forEach(function (k) { includes(onKeys, k, 'con vista de administración: ' + k); });
    ['admin.createYear', 'admin.installTrigger', 'EXTRA_USERS', 'Enlace de la app'].forEach(function (t) { includes(on, t); });

    // Apagar: setAdminView(false) → isAdminUI() falso, pero la cuenta sigue siendo admin
    g.x.ACTIONS['admin.viewAs']({}, {});
    eq(g.x.isAdminUI(), false, 'isAdminUI() apagado');
    eq(g.store['aacc.adminView'], 'false', 'se guarda en este navegador');
    includes(g.lastToast()[0], 'como el equipo');
    var off = g.x.admSettingsView();
    includes(off, 'role="switch" aria-checked="false" data-action="admin.viewAs"', 'el interruptor sigue visible, apagado');
    includes(off, 'Desactivado: ves exactamente lo que ve el equipo.');
    ['Carpetas de Drive', 'Solicitudes de compra (Ariba)', 'Proyectos desde Cascade', 'admin.createYear', 'admin.installTrigger', 'EXTRA_USERS',
      'Enlace de la app', 'admin.aprobScan', 'admin.driveCreate', 'Asistente Gemini'].forEach(function (t) { ok(off.indexOf(t) < 0, 'apagado no se ve: ' + t); });

    // Mismas tarjetas que Ina (más el interruptor)
    var ina = env('VAdmin', bundle({ me: U.ina }));
    settled(ina);
    var team = ina.x.admSettingsView();
    deepEq(cardKeys(off), ['vista'].concat(cardKeys(team)), 'Gonzalo sin vista de admin = equipo + interruptor');
    ok(team.indexOf('Ver como admin') < 0 && team.indexOf('admin.viewAs') < 0, 'el equipo no ve el interruptor');
    ina.x.ACTIONS['admin.viewAs']({}, {});
    ok(!('aacc.adminView' in ina.store), 'el equipo no puede activarlo');

    // Historial y comandos del asistente respetan el interruptor
    includes(g.x.admHistoryView(), 'El historial lo revisa la administración', 'Historial: sólo con vista de administración');
    var a = env('VAsistente', bundle());
    a.store['aacc.adminView'] = 'false';
    var labels = a.x.asstCommands().map(function (c) { return c.label; });
    ['Vista general', 'Solicitudes de compra', 'Historial'].forEach(function (l) { ok(labels.indexOf(l) < 0, 'asistente sin ' + l + ' con la vista apagada'); });
    a.store['aacc.adminView'] = 'true';
    labels = a.x.asstCommands().map(function (c) { return c.label; });
    ['Vista general', 'Solicitudes de compra', 'Historial'].forEach(function (l) { includes(labels, l); });

    // Volver a encender
    g.x.ACTIONS['admin.viewAs']({}, {});
    eq(g.x.isAdminUI(), true);
    includes(g.x.admSettingsView(), 'Carpetas de Drive');
  });

  test('v31 ajustes · Carpetas de Drive: cargando, error, sin configurar, conectada, editando y conteo de carpetas', function () {
    var E = env('VAdmin', bundle());
    var A = E.x.admState();
    var h = E.x.admDriveCard();
    includes(h, 'skeleton', 'cargando');
    ok(h.indexOf('admin.driveCreate') < 0, 'sin estado no se ofrece crear');
    includes(h, 'Pilar › Proyecto', 'una línea explica el orden');
    includes(h, 'con tu cuenta dentro de la unidad compartida');

    A.driveErr = 'Script function not found: <driveStatus>';
    h = E.x.admDriveCard();
    includes(h, 'data-action="admin.driveReload"', 'reintentar');
    includes(h, 'Script function not found: &lt;driveStatus&gt;', 'error escapado');

    A.driveErr = ''; A.drive = { configured: false, root: null, admin: true };
    h = E.x.admDriveCard();
    includes(h, 'Sin configurar');
    includes(h, 'id="adm-driveroot"', 'campo para pegar el link');
    includes(h, 'data-enter="admin.driveSave"', 'Enter guarda');
    includes(h, 'data-action="admin.driveSave"');
    ok(/data-action="admin\.driveCreate"[^>]*disabled/.test(h), '«Crear carpetas que faltan» deshabilitado sin carpeta raíz');
    ok(h.indexOf('admin.driveCancel') < 0, 'sin raíz no hay Cancelar');

    A.drive = { configured: true, root: { id: 'R1', name: 'Proyectos <AACC>', url: 'https://drive.google.com/drive/folders/R1' }, admin: true };
    h = E.x.admDriveCard();
    includes(h, 'Conectada');
    includes(h, 'Proyectos &lt;AACC&gt;', 'nombre escapado');
    includes(h, 'href="https://drive.google.com/drive/folders/R1" target="_blank" rel="noopener noreferrer"');
    includes(h, 'data-action="admin.driveEdit"', 'lápiz para cambiarla');
    ok(h.indexOf('adm-driveroot') < 0, 'conectada: sin campo');
    ok(/data-action="admin\.driveCreate"/.test(h) && !/data-action="admin\.driveCreate"[^>]*disabled/.test(h), 'crear habilitado');
    includes(h, 'Crear carpetas que faltan');
    ok(h.indexOf('con carpeta') < 0, 'sin Project.carpeta en el bundle no se muestra un conteo engañoso');

    A.drive.root.url = 'javascript:alert(1)';
    ok(E.x.admDriveCard().indexOf('javascript:') < 0, 'safeUrl en el link de la raíz');
    A.drive.root.url = 'https://drive.google.com/drive/folders/R1';

    A.driveEdit = true;
    h = E.x.admDriveCard();
    includes(h, 'id="adm-driveroot"');
    includes(h, 'data-action="admin.driveCancel"');
    ok(h.indexOf('admin.driveEdit') < 0, 'editando: sin lápiz');
    E.x.ACTIONS['admin.driveCancel']({}, {});
    eq(A.driveEdit, false);

    // driveStatus con error (carpeta en la papelera o sin acceso): se avisa en la tarjeta
    A.driveEdit = false;
    A.drive = { configured: true, root: { id: 'R1', name: '', url: 'https://drive.google.com/drive/folders/R1' }, admin: true, error: 'La carpeta del equipo está en la <papelera>' };
    h = E.x.admDriveCard();
    includes(h, 'Revisar', 'insignia de revisar');
    includes(h, 'La carpeta del equipo está en la &lt;papelera&gt;', 'error del servidor escapado');
    includes(h, '>R1<', 'sin nombre: muestra el ID');

    var C = env('VAdmin', bundle({ carpetas: true }));
    C.x.admState().drive = { configured: true, root: { id: 'R1', name: 'Raíz', url: '' }, admin: true };
    h = C.x.admDriveCard();
    includes(h, '1 de 2 proyectos con carpeta');
    ok(h.indexOf('href=""') < 0, 'raíz sin URL: texto, no link');
  });

  test('v31 ajustes · Carpetas de Drive: driveStatus al montar, driveSetRoot y driveCreateMissing', function () {
    var E = env('VAdmin', bundle());
    var A = E.x.admState();
    A.status = { triggerInstalled: true };
    E.x.admSettingsMount({ querySelector: function () { return null; } }, {}, { animate: true });
    eq(E.count('driveStatus'), 1, 'pide el estado de Drive al abrir Ajustes');
    E.x.admSettingsMount({ querySelector: function () { return null; } }, {}, {});
    eq(E.count('driveStatus'), 1, 'no repite mientras carga');
    E.respond('driveStatus', { configured: false, root: null, admin: true });
    eq(A.drive.configured, false);

    // Equipo: no se consulta
    var T = env('VAdmin', bundle({ me: U.ina }));
    T.x.admState().status = { triggerInstalled: true };
    T.x.admSettingsMount({ querySelector: function () { return null; } }, {}, { animate: true });
    eq(T.count('driveStatus'), 0, 'el equipo no consulta Drive');

    // Guardar sin texto: no llama
    var inp = { value: '   ', defaultValue: '', focus: function () { inp.focused = true; } };
    E.els['adm-driveroot'] = inp;
    E.x.ACTIONS['admin.driveSave']({}, inp);
    eq(E.count('driveSetRoot'), 0, 'vacío: no llama al servidor');
    eq(E.lastToast()[1], 'info');
    ok(inp.focused, 'vuelve al campo');

    var link = 'https://drive.google.com/drive/folders/1AbC?usp=sharing';
    inp.value = '  ' + link + ' ';
    E.x.ACTIONS['admin.driveSave']({}, inp);
    E.x.ACTIONS['admin.driveSave']({}, inp);
    eq(E.count('driveSetRoot'), 1, 'doble Enter: una sola llamada');
    deepEq(E.calls.filter(function (c) { return c.fn === 'driveSetRoot'; })[0].args, [link], 'envía el link recortado');
    ok(A.busy.driveRoot, 'ocupado mientras guarda');
    includes(E.x.admDriveCard(), 'Guardando…');
    E.respond('driveSetRoot', 'No tengo acceso a esa carpeta', true);
    eq(E.lastToast()[0], 'No tengo acceso a esa carpeta');
    eq(E.lastToast()[1], 'error');
    ok(!A.busy.driveRoot && !A.drive.configured, 'error: sigue sin configurar y se puede reintentar');

    E.x.ACTIONS['admin.driveSave']({}, inp);
    E.respond('driveSetRoot', { ok: true, root: { id: '1AbC', name: 'AACC Proyectos', url: 'https://drive.google.com/drive/folders/1AbC' } });
    includes(E.lastToast()[0], 'AACC Proyectos');
    eq(E.lastToast()[1], 'success');
    ok(A.drive.configured && A.drive.root.id === '1AbC', 'estado actualizado al tiro');
    eq(inp.value, '', 'se limpia el campo');
    eq(E.count('driveStatus'), 2, 'y confirma el estado con el servidor');
    E.respond('driveStatus', { configured: true, root: { id: '1AbC', name: 'AACC Proyectos', url: 'https://drive.google.com/drive/folders/1AbC' }, admin: true });

    // Crear carpetas que faltan → toast con conteos y recarga de datos (Project.carpeta)
    E.x.ACTIONS['admin.driveCreate']({}, {});
    E.x.ACTIONS['admin.driveCreate']({}, {});
    eq(E.count('driveCreateMissing'), 1, 'una sola llamada');
    includes(E.x.admDriveCard(), 'Creando carpetas…');
    E.respond('driveCreateMissing', { created: 3, total: 12 });
    eq(E.lastToast()[0], 'Listo: 3 carpetas creadas (de 12 proyectos)');
    eq(E.count('bootstrap'), 1, 'recarga los datos para traer las carpetas nuevas');
    ok(!A.busy.driveCreate, 'libera el botón');
    E.x.ACTIONS['admin.driveCreate']({}, {});
    E.respond('driveCreateMissing', { created: 0, total: 12 });
    eq(E.lastToast()[0], 'No faltaba ninguna: 12 proyectos con carpeta');
    eq(E.count('bootstrap'), 1, 'sin cambios no recarga');
    E.x.ACTIONS['admin.driveCreate']({}, {});
    E.respond('driveCreateMissing', { created: 0, linked: 2, total: 12, remaining: 0, failed: 0, errors: [], done: true });
    eq(E.lastToast()[0], 'Listo: 2 vinculadas (de 12 proyectos)');
    eq(E.count('bootstrap'), 2, 'vincular también recarga');

    // Corte por tiempo y errores (Drive.gs: remaining incluye las fallidas)
    var m = E.x.admDriveCreateMsg({ created: 1, linked: 0, total: 9, remaining: 4, failed: 1, errors: ['Huella: sin permiso'], done: false });
    includes(m.text, 'Listo: 1 carpeta creada (de 9 proyectos)');
    includes(m.text, '1 con error: Huella: sin permiso');
    includes(m.text, 'faltan 3: vuelve a apretar el botón');
    eq(m.type, 'info');
    eq(E.x.admDriveCreateMsg({ created: 0, linked: 0, total: 3, remaining: 3, failed: 3, errors: ['A: sin acceso'] }).type, 'error', 'todo falló');
    eq(E.x.admDriveCreateMsg({ created: 0, total: 0 }).text, 'Aún no hay proyectos');

    // Contrato con Drive.gs (si ya está): las formas que lee la tarjeta
    if (typeof driveStatus === 'function' && typeof driveCreateMissing === 'function') {
      fresh('setup');
      var st = client('driveStatus');
      ok('configured' in st && 'root' in st && 'admin' in st, 'driveStatus → {configured, root, admin}');
      eq(st.admin, true);
      throws(function () { driveCreateMissing(); }, /carpeta|Drive|configur/i, 'sin raíz, crear falla con un mensaje en español');
    }

    // Sin raíz no se intenta crear
    var N = env('VAdmin', bundle());
    N.x.admState().drive = { configured: false, root: null };
    N.x.ACTIONS['admin.driveCreate']({}, {});
    eq(N.count('driveCreateMissing'), 0);
    includes(N.lastToast()[0], 'Primero guarda la carpeta raíz');
  });

  test('v31 ajustes / cascade / historial · menos texto (§14.4) sin perder funciones', function () {
    var code = src('VAdmin');
    ['Mis tareas', '#/tareas', '¿Qué se puede seleccionar?', 'Última actividad', 'Identificado con tu cuenta de Google', 'Aún sin tareas',
      'Tus preferencias, avisos y privacidad', 'Los objetivos e indicadores de Cascade del equipo', 'Lo que se ha hecho desde la app',
      'Compartidas · así parten todas', 'Cada correo de aprobación de Ariba queda registrado'].forEach(function (t) {
      ok(code.indexOf(t) < 0, 'texto quitado: ' + t);
    });
    var bb = bundle();
    bb.projects.push({ id: 'PRJ-0000000c', pilar: 'cc', nombre: 'Flota eléctrica fase 2', detalle: '', resp: U.gonzalo, estado: 'Activo', anio: '', lineas: [], cascade: 'CAS-A2', evidencias: [], inicio: '', fin: '' });
    var E = env('VAdmin', bb);
    settled(E);
    var s = E.x.admSettingsView();
    ok(s.indexOf('<p class="mt-0.5 text-sm text-zinc-500') < 0, 'Ajustes sin subtítulo de página');
    var priv = E.x.admPrivacyCard();
    eq((priv.match(/<p[\s>]/g) || []).length, 1, 'privacidad en una sola línea');
    includes(priv, 'quedan guardadas en la planilla', 'sigue diciendo que la privacidad es de la app');
    var notif = E.x.admNotifCard();
    includes(notif, 'data-action="admin.testDigest"', 'avisos: el correo de prueba sigue');
    eq((notif.match(/<p[\s>]/g) || []).length, 1, 'avisos: una sola línea de texto');

    var cv = E.x.admCascadeView();
    ok(cv.indexOf('realizadas 2026') < 0 && cv.indexOf('<aside') < 0, 'catálogo sin cifras de relleno ni columna lateral');
    includes(cv, '1 atrasada', 'lo atrasado se sigue viendo (en rojo)');
    ok(cv.indexOf('Con proyecto') < 0, 'el proyecto con el mismo nombre del indicador no se repite');
    includes(cv, 'Flota eléctrica fase 2', 'un proyecto con otro nombre sí se muestra');
    includes(cv, 'text-red-600');
    includes(cv, 'data-action="cascade.addItem" data-padre="CAS-G2"', 'grupo vacío: queda el botón para agregar');
    ok(cv.indexOf('Este grupo aún no tiene indicadores') < 0);
    var dr = E.x.admItemDrawer('CAS-A1');
    ok(dr.body.indexOf('grid-cols-3') < 0, 'panel del indicador sin tarjetas de cifras');
    includes(dr.body, 'Cotizar cargadores', 'pendiente listada');
    includes(dr.body, 'Informe flota', 'realizada listada');
    var empty = E.x.admItemDrawer('CAS-A2');
    ok(empty.body.indexOf('Realizadas') < 0, 'sin realizadas: la sección no aparece');
    includes(empty.body, 'Sin pendientes.');

    var A = E.x.admState();
    A.hist = [{ fecha: new Date().toISOString(), usuario: U.ina, accion: 'Crear tarea', entidad: 'X', detalle: '', _k: 'create' }];
    var hv = E.x.admHistoryView();
    ok(hv.indexOf('movimiento') < 0, 'sin conteo por día');
    includes(hv, 'data-action="admin.histType" data-value="create"', 'filtro del tipo presente');
    ok(hv.indexOf('data-value="delete"') < 0, 'tipos sin movimientos no se ofrecen');
    includes(hv, 'pestaña «Historial» de la planilla', 'dónde está el registro completo');
  });

  test('v31 asistente · «Abrir mis tareas» usa el panel (sin la ruta vieja) y las notas al pie se fueron', function () {
    var code = src('VAsistente');
    ['#/tareas', 'ASST_DRIVE_SEEN', 'Buscas sólo en lo que tú puedes ver', 'Documentos, planillas y presentaciones de tu Drive',
      'Entiende pendientes, vencimientos', 'Sin coincidencias con todas las palabras'].forEach(function (t) { ok(code.indexOf(t) < 0, 'quitado: ' + t); });

    var E = env('VAsistente', bundle());
    var cmds = E.x.asstCommands();
    var mt = cmds.find(function (c) { return c.label === 'Abrir mis tareas'; });
    ok(mt && mt.grp === 'do', 'acción rápida en la vista vacía');
    ok(!cmds.some(function (c) { return c.label === 'Mis tareas'; }), 'sin el comando viejo');
    includes(E.x.asstHomeHtml(function () { return 0; }), 'Abrir mis tareas');
    ok(E.x.asstHomeHtml(function () { return 0; }).indexOf('Cambiar tema') < 0, 'Cambiar tema sólo al buscarlo');
    ok(E.x.asstShellHtml().indexOf('hidden shrink-0') >= 0, 'pie con atajos sólo en escritorio');

    // «mis tareas» encuentra la acción (antes «mis» se cambiaba por el nombre y no calzaba)
    var A = E.x.ASST;
    A.q = 'mis tareas'; A.items = [];
    var h = E.x.asstQueryHtml('mis tareas', function (it) { A.items.push(it); return A.items.length - 1; });
    ok(A.items.some(function (it) { return it.kind === 'cmd' && it.cmd.label === 'Abrir mis tareas'; }), '«mis tareas» → acción «Abrir mis tareas»');
    var firstCmd = A.items.find(function (it) { return it.kind === 'cmd'; });
    eq(firstCmd.cmd.label, 'Abrir mis tareas', 'y va primero (antes que «Nueva tarea»)');
    includes(h, 'Abrir mis <mark class="hl">tareas</mark>', 'resaltada');

    // Escritorio con el panel visible: enfoca «Agregar una tarea»
    var inp = { focus: function () { inp.n = (inp.n || 0) + 1; } };
    E.els['todo-add-aside'] = inp;
    eq(E.x.asstOpenMyTasks(), 'focus');
    ok(inp.n >= 1, 'foco en el campo del panel');
    eq(E.sheet, 0, 'no abre la hoja');
    // Elegida desde la paleta (cierra y enfoca)
    var i = A.items.findIndex(function (it) { return it.kind === 'cmd' && it.cmd.label === 'Abrir mis tareas'; });
    ok(i >= 0, 'la acción es navegable');
    E.x.ACTIONS['assistant.pick']({ idx: String(i) });
    ok(inp.n >= 2, 'desde la paleta también');

    // Escritorio con el panel oculto (riel): lo despliega
    var R = env('VAsistente', bundle(), { query: { '[data-action="todo.expand"]': {} } });
    eq(R.x.asstOpenMyTasks(), 'expand');
    eq(R.expand, 1);
    // Pantalla chica (o vista sin panel): hoja lateral
    var M = env('VAsistente', bundle(), { wide: false });
    M.els['todo-add-aside'] = inp;
    eq(M.x.asstOpenMyTasks(), 'sheet');
    eq(M.sheet, 1);
    var W = env('VAsistente', bundle());
    eq(W.x.asstOpenMyTasks(), 'sheet', 'escritorio sin panel en la vista: hoja lateral');
  });
})();
