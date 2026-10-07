/* v3.1 · Drive.gs: carpeta de Google Drive por proyecto (SPEC §14.3) + mock DriveApp */
(function () {
  var PIL = { cc: 'Cambio Climático', ec: 'Economía Circular', nat: 'Naturaleza' };

  // Carpeta raíz simulada (sin padre, como una carpeta de la unidad compartida) conectada como administrador
  function setRoot() {
    var root = MOCK.drive.addFolder('Equipo AACC', '');
    driveSetRoot(root);
    return root;
  }
  function prjs() { return bootstrap().projects; }
  function prjIn(pilar, skip) {
    var p = prjs().filter(function (x) { return x.pilar === pilar && (skip || []).indexOf(x.id) < 0; })[0];
    if (!p) throw new Error('no hay proyectos del pilar ' + pilar);
    return p;
  }
  function carpetaOf(id) { return driveProjects_().filter(function (p) { return p.id === id; })[0].carpeta; }
  function hist(accion) { return rowsOf('Historial').filter(function (h) { return h['Acción'] === accion; }); }
  function setCell(id, fields) { ok(gUpdateFields_(MOCK.sheet('Gestión'), id, fields), 'escribió ' + JSON.stringify(fields)); }

  test('v31 drive · enlaces de carpeta: formas aceptadas y rechazadas', function () {
    need('driveParseId_');
    var id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    eq(driveParseId_('https://drive.google.com/drive/folders/' + id), id);
    eq(driveParseId_('https://drive.google.com/drive/folders/' + id + '?usp=sharing'), id);
    eq(driveParseId_('https://drive.google.com/drive/u/0/folders/' + id), id);
    eq(driveParseId_('https://drive.google.com/drive/u/1/folders/' + id + '?usp=drive_link#algo'), id);
    eq(driveParseId_('https://drive.google.com/drive/mobile/folders/' + id), id);
    eq(driveParseId_('https://drive.google.com/open?id=' + id), id);
    eq(driveParseId_('  ' + id + '  '), id, 'ID suelto (con espacios)');
    eq(driveParseId_('https://drive.google.com/drive/folders/0AFooBarSharedDrv9PVA'), '0AFooBarSharedDrv9PVA', 'raíz de unidad compartida');
    eq(driveParseId_('https://docs.google.com/document/d/' + id + '/edit'), '', 'un documento no es una carpeta');
    eq(driveParseId_('https://evil.example.com/drive/folders/' + id), '', 'otro dominio');
    eq(driveParseId_('https://drive.google.com/drive/folders/abc'), '', 'ID demasiado corto');
    eq(driveParseId_('mi carpeta'), '');
    eq(driveParseId_(''), '');
    eq(driveParseId_(null), '');
  });

  test('v31 drive · driveSetRoot: sólo admin, valida el acceso y guarda DRIVE_ROOT_ID', function () {
    need('driveSetRoot');
    fresh('setup');
    var root = MOCK.drive.addFolder('Equipo AACC · Proyectos', '');
    asUser(U.ina, function () { throws(function () { client('driveSetRoot', root); }, /administrador/); });
    throws(function () { client('driveSetRoot', 'no es un enlace'); }, /enlace de una carpeta de Drive/);
    throws(function () { client('driveSetRoot', 'https://drive.google.com/drive/folders/1NoExisteNoExisteNoExiste00'); },
      /No tengo acceso a esa carpeta\. Compártela con la cuenta de Gonzalo \(gvicencio@copec\.cl\)/);
    var secret = MOCK.drive.addFolder('Privada', '');
    MOCK.drive.deny(secret);
    throws(function () { client('driveSetRoot', secret); }, /No tengo acceso/);
    var vieja = MOCK.drive.addFolder('Vieja', '', { trashed: true });
    throws(function () { client('driveSetRoot', vieja); }, /papelera/);
    eq(MOCK.props('script').DRIVE_ROOT_ID, undefined, 'nada guardado tras los errores');

    var r = client('driveSetRoot', 'https://drive.google.com/drive/u/0/folders/' + root + '?usp=sharing');
    deepEq(r, { ok: true, root: { id: root, name: 'Equipo AACC · Proyectos', url: 'https://drive.google.com/drive/folders/' + root } });
    eq(MOCK.props('script').DRIVE_ROOT_ID, root);
    ok(hist('Configurar app').some(function (h) { return /Equipo AACC/.test(h.Detalle); }), 'queda en el Historial');
    eq(driveConfigured_(), true);

    deepEq(client('driveSetRoot', ''), { ok: true, root: null }, "'' desconecta");
    eq(MOCK.props('script').DRIVE_ROOT_ID, undefined);
    eq(driveConfigured_(), false);
  });

  test('v31 drive · driveStatus y acceso: no miembros rechazados en toda la API', function () {
    need('driveStatus');
    fresh('setup');
    deepEq(client('driveStatus'), { configured: false, root: null, admin: true, disabled: false });
    asUser(U.benja, function () { deepEq(client('driveStatus'), { configured: false, root: null, admin: false, disabled: false }); });
    var root = setRoot();
    var st = client('driveStatus');
    eq(st.configured, true);
    deepEq(st.root, { id: root, name: 'Equipo AACC', url: 'https://drive.google.com/drive/folders/' + root });
    ok(!st.error);
    MOCK.drive.deny(root);
    st = client('driveStatus');
    eq(st.root.id, root, 'aunque no haya acceso muestra qué carpeta está configurada');
    ok(/No tengo acceso a la carpeta del equipo/.test(st.error), st.error);
    MOCK.drive.allow(root);

    asUser('intruso@otra.cl', function () {
      ['driveStatus', 'driveSetRoot', 'driveFolder', 'driveList', 'driveUpload', 'driveCreateMissing'].forEach(function (fn) {
        throws(function () { client(fn, 'x'); }, /No tienes acceso/, fn);
      });
    });
    asUser(U.ina, function () { throws(function () { client('driveCreateMissing'); }, /administrador/); });
  });

  test('v31 drive · carpeta por proyecto: <raíz>/<Pilar>/<Proyecto>, guarda Carpeta y la reutiliza', function () {
    need('driveFolder', 'gSetProjectFolder_');
    fresh('demo');
    setRoot();
    var p = prjIn('nat');
    eq(p.carpeta || '', '', 'sin carpeta al empezar');
    var f = client('driveFolder', p.id);
    eq(MOCK.drive.path(f.id), 'Equipo AACC/Naturaleza/' + driveFolderName_(p.nombre));
    deepEq(f, { id: f.id, url: 'https://drive.google.com/drive/folders/' + f.id, name: driveFolderName_(p.nombre) });
    eq(carpetaOf(p.id), f.id, 'columna Carpeta');
    var bp = prjs().filter(function (x) { return x.id === p.id; })[0];
    eq(bp.carpeta, f.id, 'bundle: Project.carpeta');
    eq(bp.carpetaUrl, 'https://drive.google.com/drive/folders/' + f.id, 'bundle: Project.carpetaUrl');
    eq(bp.actualizado, p.actualizado, 'guardar la carpeta no cambia la versión del proyecto (sin conflictos)');
    eq(hist('Crear carpeta de Drive').length, 1);

    MOCK.clearBuffers();
    eq(client('driveFolder', p.id).id, f.id, 'segunda vez: la misma');
    eq(MOCK.drive.count('createFolder'), 0);

    var q = prjIn('nat', [p.id]);
    var g = asUser(U.ina, function () { return client('driveFolder', q.id); });
    eq(MOCK.drive.path(g.id), 'Equipo AACC/Naturaleza/' + driveFolderName_(q.nombre), 'un miembro también puede');
    eq(MOCK.drive.byName('Naturaleza', 'folder').length, 1, 'una sola subcarpeta por pilar');
    var c = client('driveFolder', prjIn('cc').id);
    includes(MOCK.drive.path(c.id), 'Equipo AACC/Cambio Climático/');
  });

  test('v31 drive · reutiliza una carpeta con el mismo nombre; si es de otro proyecto crea otra con el ID', function () {
    need('driveFolder');
    fresh('demo');
    var root = setRoot();
    var p = prjIn('cc');
    var pil = MOCK.drive.addFolder('Cambio Climático', root);
    var pre = MOCK.drive.addFolder(driveFolderName_(p.nombre), pil);
    MOCK.drive.addFile('ya estaba.pdf', pre, { mimeType: 'application/pdf' });
    MOCK.clearBuffers();
    var f = client('driveFolder', p.id);
    eq(f.id, pre, 'vincula la carpeta que ya existía');
    eq(MOCK.drive.count('createFolder'), 0, 'sin crear nada');
    eq(client('driveList', p.id).files[0].name, 'ya estaba.pdf');

    // Otro proyecto con el mismo nombre: no se apropia de la carpeta ajena
    var q = prjIn('cc', [p.id]);
    setCell(q.id, { Nombre: p.nombre });
    var g = client('driveFolder', q.id);
    ok(g.id !== pre, 'no comparte la carpeta');
    eq(g.name, driveFolderName_(p.nombre) + ' (' + q.id + ')');
    eq(MOCK.drive.path(g.id), 'Equipo AACC/Cambio Climático/' + g.name);

    // Una carpeta homónima en la papelera no se reutiliza
    var r = prjIn('nat');
    var nat = MOCK.drive.addFolder('Naturaleza', root);
    var old = MOCK.drive.addFolder(driveFolderName_(r.nombre), nat, { trashed: true });
    var h = client('driveFolder', r.id);
    ok(h.id !== old && !MOCK.drive.item(h.id).trashed, 'crea una nueva');
    eq(MOCK.drive.byName('Naturaleza', 'folder').length, 1, 'reutiliza la subcarpeta del pilar');
  });

  test('v31 drive · carpeta guardada que ya no sirve: driveList no la muestra y driveFolder crea otra', function () {
    need('driveFolder', 'driveList');
    fresh('demo');
    setRoot();
    var p = prjIn('ec');
    var f = driveFolder(p.id);
    MOCK.drive.trash(f.id);
    deepEq(client('driveList', p.id), { folder: null, files: [], configured: true }, 'en la papelera');
    var f2 = client('driveFolder', p.id);
    ok(f2.id !== f.id);
    eq(carpetaOf(p.id), f2.id, 'reemplaza el ID guardado');
    MOCK.drive.deny(f2.id);
    eq(client('driveList', p.id).folder, null, 'sin acceso');
    var f3 = client('driveFolder', p.id);
    ok(f3.id !== f2.id);
    eq(carpetaOf(p.id), f3.id);
  });

  test('v31 drive · driveList: más nuevos primero, tipo por mimeType, sin papelera ni Date; no crea la carpeta', function () {
    need('driveList');
    fresh('demo');
    setRoot();
    var p = prjIn('nat');
    MOCK.clearBuffers();
    deepEq(client('driveList', p.id), { folder: null, files: [], configured: true });
    eq(MOCK.drive.count('createFolder'), 0, 'listar no crea la carpeta');
    eq(MOCK.drive.calls.length, 0, 'ni llama a Drive si no hay carpeta');
    eq(carpetaOf(p.id), '');

    var f = driveFolder(p.id);
    var now = Date.now(), H = 3600000;
    function add(name, mime, hoursAgo, opts) {
      return MOCK.drive.addFile(name, f.id, Object.assign({ mimeType: mime, size: 1234, updated: new Date(now - hoursAgo * H) }, opts || {}));
    }
    add('foto.jpg', 'image/jpeg', 1);
    add('informe.pdf', 'application/pdf', 5);
    add('minuta', 'application/vnd.google-apps.document', 3);
    add('planilla.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10);
    add('deck', 'application/vnd.google-apps.presentation', 2);
    add('video.mp4', 'video/mp4', 4);
    add('datos.zip', 'application/zip', 8);
    add('borrado.pdf', 'application/pdf', 0, { trashed: true });
    MOCK.drive.addFolder('Fotos terreno', f.id, { updated: new Date(now - 6 * H) });
    MOCK.drive.addFolder('Vieja', f.id, { updated: new Date(now), trashed: true });

    var l = client('driveList', p.id);
    assertNoDates(l);
    deepEq(l.folder, { id: f.id, url: f.url, name: f.name });
    deepEq(l.files.map(function (x) { return x.name; }),
      ['foto.jpg', 'deck', 'minuta', 'video.mp4', 'informe.pdf', 'Fotos terreno', 'datos.zip', 'planilla.xlsx']);
    deepEq(l.files.map(function (x) { return x.kind; }), ['image', 'slide', 'doc', 'video', 'pdf', 'folder', 'file', 'sheet']);
    var pdf = l.files[4];
    eq(pdf.size, 1234);
    eq(pdf.mimeType, 'application/pdf');
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(pdf.updated), 'updated ISO');
    ok(/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view/.test(pdf.url), pdf.url);
    ok(/^https:\/\/docs\.google\.com\/document\/d\//.test(l.files[2].url), 'Docs abre en Docs');
    var fol = l.files[5];
    eq(fol.mimeType, 'application/vnd.google-apps.folder');
    eq(fol.size, 0);
    eq(fol.url, 'https://drive.google.com/drive/folders/' + fol.id);

    for (var i = 0; i < 205; i++) add('f' + i + '.txt', 'text/plain', 20 + i);
    var big = client('driveList', p.id);
    eq(big.files.length, 200, 'máximo 200');
    eq(big.files[0].name, 'foto.jpg', 'siguen primero los más nuevos');
    eq(big.files[199].name, 'f191.txt');

    // Tipos
    var K = {
      'image/heic': 'image', 'application/vnd.google-apps.photo': 'image', 'application/pdf': 'pdf', 'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc', 'text/plain': 'doc',
      'application/vnd.google-apps.spreadsheet': 'sheet', 'text/csv': 'sheet', 'application/vnd.ms-excel': 'sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slide', 'application/vnd.ms-powerpoint': 'slide',
      'application/vnd.google-apps.folder': 'folder', 'video/quicktime': 'video', 'application/zip': 'file', '': 'file',
    };
    Object.keys(K).forEach(function (m) { eq(driveKind_(m), K[m], m || '(vacío)'); });
  });

  test('v31 drive · driveUpload: base64 → archivo en la carpeta, nombre saneado, extensión, tipo y límite de 20 MB', function () {
    need('driveUpload', 'DRIVE_LIMITS');
    fresh('demo');
    setRoot();
    var p = prjIn('ec');
    var e = asUser(U.benja, function () {
      return client('driveUpload', p.id, { name: 'Informe final.pdf', mimeType: 'application/pdf', base64: Utilities.base64Encode('%PDF-1.4 hola') });
    });
    assertNoDates(e);
    deepEq(Object.keys(e).sort(), ['id', 'kind', 'mimeType', 'name', 'size', 'updated', 'url']);
    eq(e.name, 'Informe final.pdf');
    eq(e.kind, 'pdf');
    eq(e.size, 13);
    eq(e.mimeType, 'application/pdf');
    ok(carpetaOf(p.id), 'creó la carpeta del proyecto');
    eq(MOCK.drive.path(e.id), 'Equipo AACC/Economía Circular/' + driveFolderName_(p.nombre) + '/Informe final.pdf');
    eq(Utilities.newBlob(MOCK.drive.item(e.id).data).getDataAsString(), '%PDF-1.4 hola', 'contenido intacto');
    ok(hist('Subir archivo').some(function (h) { return /Informe final\.pdf · 13 B/.test(h.Detalle) && h.Usuario === U.benja; }), 'Historial');

    // Nombre: sin / \ ni caracteres de control, conserva la extensión
    eq(client('driveUpload', p.id, { name: '../..\\evil/\u0007na\u0000me.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }).name, 'evilname.png');
    var largo = new Array(301).join('a') + '.docx';
    var e3 = client('driveUpload', p.id, { name: largo, base64: 'UEsDBA==' });
    eq(e3.name.length, 180);
    ok(/a\.docx$/.test(e3.name), 'conserva la extensión al acortar');
    eq(e3.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'tipo por extensión si no viene');
    eq(e3.kind, 'doc');
    // Tipo por defecto, inválido o de Google → por extensión o application/octet-stream
    var e4 = client('driveUpload', p.id, { name: 'datos.raro', base64: 'AAEC' });
    eq(e4.mimeType, 'application/octet-stream');
    eq(e4.kind, 'file');
    eq(client('driveUpload', p.id, { name: 'x.csv', mimeType: 'no válido', base64: 'YSxi' }).mimeType, 'text/csv');
    eq(client('driveUpload', p.id, { name: 'y.txt', mimeType: 'application/vnd.google-apps.document', base64: 'YQ==' }).mimeType, 'text/plain');
    eq(client('driveUpload', p.id, { base64: 'YQ==' }).name, 'Archivo', 'sin nombre');
    eq(client('driveUpload', p.id, { name: 'n.txt', mimeType: 'text/plain', base64: 'data:text/plain;base64,aG9s\nYQ==' }).size, 4, 'acepta data: URL');
    // Vacío o ilegible
    throws(function () { client('driveUpload', p.id, { name: 'v.pdf', base64: '' }); }, /vacío/);
    throws(function () { client('driveUpload', p.id, { name: 'v.pdf', base64: '@@@@' }); }, /No pude leer el archivo "v\.pdf"/);
    throws(function () { client('driveUpload', 'PRJ-noexiste', { name: 'v.pdf', base64: 'YQ==' }); }, /No encontré el proyecto/);

    // Límite (decodificado), y el chequeo previo no decodifica un archivo enorme
    var max = DRIVE_LIMITS.maxBytes, dec = Utilities.base64Decode, n = 0;
    try {
      DRIVE_LIMITS.maxBytes = 10;
      Utilities.base64Decode = function (s) { n++; return dec(s); };
      throws(function () { client('driveUpload', p.id, { name: 'grande.pdf', base64: Utilities.base64Encode('12345678901') }); },
        /"grande\.pdf" pesa 11 B y el máximo es/);
      eq(n, 0, 'se rechaza antes de decodificar');
      eq(client('driveUpload', p.id, { name: 'justo.txt', base64: Utilities.base64Encode('1234567890') }).size, 10, 'justo en el límite');
    } finally {
      DRIVE_LIMITS.maxBytes = max;
      Utilities.base64Decode = dec;
    }
    eq(DRIVE_LIMITS.maxBytes, 20 * 1024 * 1024, '20 MB');
    includes(driveTooBig_('a.mp4', 25 * 1048576), 'pesa 25,0 MB y el máximo es 20 MB');
  });

  test('v31 drive · sin carpeta raíz: driveFolder/driveUpload avisan y driveList responde vacío', function () {
    need('driveFolder');
    fresh('demo');
    var p = prjIn('cc');
    throws(function () { client('driveFolder', p.id); }, /Falta conectar la carpeta de Drive del equipo/);
    throws(function () { client('driveUpload', p.id, { name: 'a.txt', base64: 'YQ==' }); }, /Falta conectar/);
    deepEq(client('driveList', p.id), { folder: null, files: [], configured: false });
    throws(function () { client('driveCreateMissing'); }, /Falta conectar/);
    throws(function () { client('driveFolder', 'PRJ-noexiste'); }, /No encontré el proyecto/);
    throws(function () { client('driveList', ''); }, /Falta indicar el proyecto/);
    eq(driveEnsureFolder_({ id: p.id, carpeta: '' }), null, 'el gancho de gSave no hace nada');
  });

  test('v31 drive · driveCreateMissing: crea las que faltan por pilar, idempotente y con presupuesto de tiempo', function () {
    need('driveCreateMissing');
    fresh('demo');
    setRoot();
    var all = driveProjects_();
    var total = all.length;
    ok(total > 3, 'hay proyectos demo');
    var p0 = prjIn('nat');
    driveFolder(p0.id);

    var budget = DRIVE_LIMITS.budgetMs;
    try {
      DRIVE_LIMITS.budgetMs = 0;
      var r0 = client('driveCreateMissing');
      deepEq(r0, { created: 0, linked: 0, total: total, remaining: total - 1, failed: 0, errors: [], done: false });
    } finally { DRIVE_LIMITS.budgetMs = budget; }

    // Reloj que avanza 100 s por consulta: se detiene a mitad y avisa cuántos faltan
    var realNow = Date.now, t = realNow();
    var rp;
    try {
      Date.now = function () { t += 100000; return t; };
      rp = client('driveCreateMissing');
    } finally { Date.now = realNow; }
    ok(rp.created >= 1 && rp.remaining >= 1, 'parcial: ' + JSON.stringify(rp));
    eq(rp.created + rp.linked + rp.remaining, total - 1);
    eq(rp.done, false);

    var r = client('driveCreateMissing');
    assertNoDates(r);
    eq(r.total, total);
    eq(r.remaining, 0);
    eq(r.done, true);
    eq(r.created + r.linked + rp.created + rp.linked, total - 1);
    var after = driveProjects_();
    ok(after.every(function (x) { return x.carpeta; }), 'todos con carpeta');
    after.forEach(function (x) {
      eq(MOCK.drive.path(x.carpeta), 'Equipo AACC/' + PIL[x.pilar] + '/' + MOCK.drive.item(x.carpeta).name, x.nombre);
    });
    var ids = after.map(function (x) { return x.carpeta; });
    eq(ids.filter(function (x, i) { return ids.indexOf(x) === i; }).length, ids.length, 'una carpeta distinta por proyecto');
    Object.keys(PIL).forEach(function (k) { ok(MOCK.drive.byName(PIL[k], 'folder').length <= 1, 'subcarpeta única ' + PIL[k]); });
    ok(hist('Crear carpetas de Drive').length >= 1, 'Historial');

    MOCK.clearBuffers();
    var r2 = client('driveCreateMissing');
    deepEq(r2, { created: 0, linked: 0, total: total, remaining: 0, failed: 0, errors: [], done: true }, 'idempotente');
    eq(MOCK.drive.count('createFolder'), 0);
  });

  test('v31 drive · driveCreateMissing: sin acceso a la raíz se detiene con un mensaje claro', function () {
    need('driveCreateMissing');
    fresh('demo');
    var root = setRoot();
    MOCK.drive.deny(root);
    var r = client('driveCreateMissing');
    eq(r.created, 0);
    eq(r.failed, 1, 'no insiste proyecto por proyecto');
    eq(r.remaining, r.total);
    ok(/No tengo acceso a la carpeta del equipo/.test(r.errors[0]), r.errors[0]);
  });

  test('v31 drive · sincroniza nombre y pilar (mejor esfuerzo, nunca lanza)', function () {
    need('driveSyncFolder_');
    fresh('demo');
    setRoot();
    var p = prjIn('nat');
    var f = driveFolder(p.id);
    setCell(p.id, { Nombre: 'Nuevo nombre / fase 2' });
    deepEq(driveSyncFolder_(p.id), { renamed: true, moved: false });
    eq(MOCK.drive.item(f.id).name, 'Nuevo nombre - fase 2');

    setCell(p.id, { Pilar: 'Cambio Climatico' });
    deepEq(driveSyncFolder_({ id: p.id, carpeta: f.id }), { renamed: false, moved: true });
    eq(MOCK.drive.path(f.id), 'Equipo AACC/Cambio Climático/Nuevo nombre - fase 2');
    deepEq(driveSyncFolder_(p.id), { renamed: false, moved: false }, 'idempotente');

    // Una carpeta que alguien ordenó a mano fuera de la raíz se respeta
    var archivo = MOCK.drive.addFolder('Archivo 2025', '');
    DriveApp.getFolderById(f.id).moveTo(DriveApp.getFolderById(archivo));
    setCell(p.id, { Pilar: 'Naturaleza' });
    deepEq(driveSyncFolder_(p.id), { renamed: false, moved: false });
    eq(MOCK.drive.item(f.id).parents[0], archivo);

    // Errores de Drive → null, sin lanzar
    MOCK.drive.failOn('setName', 'Backend Error');
    setCell(p.id, { Nombre: 'Otro nombre' });
    eq(driveSyncFolder_(p.id), null);
    MOCK.drive.clearFailures();
    MOCK.drive.deny(f.id);
    eq(driveSyncFolder_(p.id), null, 'sin acceso');

    // Sin carpeta → no llama a Drive
    var q = prjIn('ec');
    MOCK.clearBuffers();
    eq(driveSyncFolder_({ id: q.id, carpeta: '' }), null);
    eq(driveSyncFolder_(q.id), null);
    eq(MOCK.drive.calls.length, 0);
    eq(driveSyncFolder_('PRJ-noexiste'), null);
  });

  test('v31 drive · integración con gSave: proyecto nuevo con carpeta; renombrar/cambiar de pilar la ordena', function () {
    need('gSave', 'gSetProjectFolder_');
    fresh('demo');
    setRoot();
    var b = client('gSave', { tipo: 'Proyecto', pilar: 'ec', nombre: 'Piloto compostaje' });
    var np = b.projects.filter(function (x) { return x.id === b.lastId; })[0];
    ok(np.carpeta, 'el bundle ya trae la carpeta del proyecto nuevo');
    eq(MOCK.drive.path(np.carpeta), 'Equipo AACC/Economía Circular/Piloto compostaje');
    eq(hist('Crear carpeta de Drive').length, 0, 'la carpeta automática no ensucia el Historial');

    client('gSave', { tipo: 'Proyecto', id: np.id, nombre: 'Piloto compostaje 2026', pilar: 'nat' });
    eq(MOCK.drive.path(np.carpeta), 'Equipo AACC/Naturaleza/Piloto compostaje 2026');
    eq(carpetaOf(np.id), np.carpeta, 'mantiene la misma carpeta');

    // Si Drive falla, el proyecto igual se guarda
    MOCK.drive.failOn('createFolder', 'User rate limit exceeded.');
    var b3 = client('gSave', { tipo: 'Proyecto', pilar: 'cc', nombre: 'Sin carpeta por ahora' });
    var p3 = b3.projects.filter(function (x) { return x.id === b3.lastId; })[0];
    ok(p3, 'proyecto guardado');
    eq(p3.carpeta, '');
    MOCK.drive.clearFailures();

    // Sin raíz: guardar proyectos no llama a Drive
    driveSetRoot('');
    MOCK.clearBuffers();
    client('gSave', { tipo: 'Proyecto', pilar: 'ec', nombre: 'Sin drive' });
    eq(MOCK.drive.calls.length, 0);
  });

  test('v31 drive · errores de Drive: mensajes amables en español', function () {
    need('driveFolder');
    fresh('demo');
    var root = setRoot();
    var p = prjIn('cc');
    MOCK.drive.failOn('createFolder', 'User rate limit exceeded.');
    throws(function () { client('driveFolder', p.id); }, /^Google Drive no respondió a tiempo\. Intenta de nuevo en un minuto\.$/);
    MOCK.drive.clearFailures();
    var f = client('driveFolder', p.id);
    MOCK.drive.failOn('getFiles', 'We\'re sorry, a server error occurred. Please wait a bit and try again.');
    throws(function () { client('driveList', p.id); }, /Google Drive no respondió/);
    MOCK.drive.clearFailures();
    MOCK.drive.failOn('createFile', 'Algo raro');
    throws(function () { client('driveUpload', p.id, { name: 'a.txt', base64: 'YQ==' }); }, /No pude completar la operación en Google Drive: Algo raro/);
    MOCK.drive.clearFailures();
    MOCK.drive.failOn('getFolderById', 'Service invoked too many times for one day: driveapp.', 1);
    throws(function () { client('driveList', p.id); }, /Google Drive no respondió/, 'un error pasajero no se confunde con "no existe"');
    eq(carpetaOf(p.id), f.id, 'y no se pierde la carpeta guardada');
    MOCK.drive.deny(root);
    var q = prjIn('cc', [p.id]);
    throws(function () { client('driveFolder', q.id); }, /No tengo acceso a la carpeta del equipo\. Compártela con la cuenta de Gonzalo \(gvicencio@copec\.cl\)/);
  });

  test('v31 drive · concurrencia: si otra ejecución ya vinculó una carpeta, se usa esa y la nueva va a la papelera', function () {
    need('driveStoreId_', 'driveEnsure_');
    fresh('demo');
    var root = setRoot();
    var p = prjIn('nat');
    var a = MOCK.drive.addFolder('A', root), b = MOCK.drive.addFolder('B', root);
    eq(withLock_(function () { return driveStoreId_(p.id, a, ''); }).ok, true);
    deepEq(withLock_(function () { return driveStoreId_(p.id, b, ''); }), { current: a });
    eq(carpetaOf(p.id), a);
    eq(withLock_(function () { return driveStoreId_(p.id, b, a); }).ok, true, 'reemplaza la que se vio vencida');
    eq(carpetaOf(p.id), b);
    deepEq(withLock_(function () { return driveStoreId_('PRJ-noexiste', a, ''); }), { gone: true });

    // Carrera: el contexto se leyó sin carpeta y mientras tanto otra ejecución guardó B
    var q = prjIn('ec');
    var ctx = driveCtx_(driveProjects_());
    withLock_(function () { gSetProjectFolder_(q.id, b); });
    var r = driveEnsure_(q.id, { ctx: ctx });
    eq(r.folder.getId(), b, 'usa la que ya estaba vinculada');
    var mine = MOCK.drive.byName(driveFolderName_(q.nombre), 'folder')[0];
    ok(mine && mine.trashed, 'la carpeta recién creada va a la papelera');
  });

  test('v31 drive · mock DriveApp, Blob y base64 se comportan como Apps Script', function () {
    fresh('raw');
    // base64 / Blob: bytes con signo y UTF-8
    var enc = Utilities.base64Encode('Ñandú €');
    eq(enc, 'w5FhbmTDuiDigqw=');
    var bytes = Utilities.base64Decode(enc);
    ok(bytes.some(function (x) { return x < 0; }), 'bytes con signo');
    eq(Utilities.newBlob(bytes).getDataAsString(), 'Ñandú €');
    eq(Utilities.base64Encode([255, 0, -1, 128]), '/wD/gA==');
    deepEq(Utilities.base64Decode('/wD/gA=='), [-1, 0, -1, -128]);
    deepEq(Utilities.base64DecodeWebSafe('_wD_gA'), [-1, 0, -1, -128]);
    throws(function () { Utilities.base64Decode('ab$c'); }, /Could not decode string/);
    var bl = Utilities.newBlob([1, 2, 3], 'application/pdf', 'a.pdf');
    eq(bl.getContentType(), 'application/pdf');
    eq(bl.getName(), 'a.pdf');
    eq(bl.copyBlob().getBytes().length, 3);

    // DriveApp
    var top = DriveApp.createFolder('Top');
    eq(MOCK.drive.path(top.getId()), 'Mi unidad/Top');
    var sub = top.createFolder('Sub');
    var file = sub.createFile(bl);
    eq(file.getSize(), 3);
    eq(file.getMimeType(), 'application/pdf');
    ok(file.getLastUpdated() instanceof Date, 'los getters de Drive devuelven Date (hay que convertirlos)');
    var it = sub.getFiles();
    eq(it.next().getName(), 'a.pdf');
    eq(it.hasNext(), false);
    throws(function () { it.next(); }, /iterator has reached the end/);
    file.setTrashed(true);
    eq(sub.getFiles().hasNext(), true, 'getFiles también entrega la papelera');
    eq(typeof sub.getMimeType, 'undefined', 'Folder no tiene getMimeType');
    includes(MOCK.missing, 'Folder.getMimeType');
    throws(function () { DriveApp.getFolderById(123); }, /don't match the method signature/);
    throws(function () { DriveApp.getFolderById(file.getId()); }, /No item with the given ID/);
    MOCK.drive.deny(top.getId());
    throws(function () { DriveApp.getFolderById(sub.getId()); }, /No item with the given ID/, 'sin acceso al padre');
    MOCK.drive.allow(top.getId());
    throws(function () { top.moveTo(sub); }, /Invalid argument: destination/);
    sub.moveTo(DriveApp.getRootFolder());
    eq(MOCK.drive.path(sub.getId()), 'Mi unidad/Sub');
    var par = sub.getParents();
    eq(par.next().getId(), MOCK.drive.myDrive);
    throws(function () { DriveApp.createFile(Utilities.newBlob('x', 'application/vnd.google-apps.document', 'd')); }, /Invalid argument/);

    // Fallas configurables (n veces) y conteo de llamadas
    MOCK.drive.failOn('createFolder', 'User rate limit exceeded.', 1);
    throws(function () { top.createFolder('X'); }, /User rate limit exceeded/);
    eq(top.createFolder('X').getName(), 'X', 'la falla era de una vez');
    ok(MOCK.drive.count('createFolder') >= 4);

    // snapshot / restore
    var snap = MOCK.snapshot();
    top.setName('Cambiado');
    MOCK.restore(snap);
    eq(DriveApp.getFolderById(top.getId()).getName(), 'Top');
    MOCK.reset();
    throws(function () { DriveApp.getFolderById(top.getId()); }, /No item/, 'reset vacía la unidad');
    eq(DriveApp.getRootFolder().getName(), 'Mi unidad');
  });
})();
