/* v3.7 · Pantallazo del correo de respaldo para todo el equipo (SPEC §13.2): al registrar una solicitud en una línea (o con
   «Revisar ahora») se guarda una copia fija del correo de Ariba en la pestaña oculta "Capturas de correo"; el bundle
   `budgetMails` (todo miembro) y aprobMailView sólo leen esa copia, nunca Gmail. */
(function () {
  var FX = 'dev/fixtures/';
  var FROM = '"Aprobación por correo electrónico" <buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com>';
  var AUDIT = 'GV - Auditoria interna ISO 50001'; // Cuadre 2026
  var SNAP = 'Capturas de correo';
  var SUBJ = null;
  function fx(name) { return readText(FX + name); }
  function subj(name) { if (!SUBJ) SUBJ = JSON.parse(fx('ariba_subjects.json')); return SUBJ[name]; }
  function hoursAgo(h) { return new Date(Date.now() - h * 3600000); }
  // HTML parecido al de Ariba: estilos, tabla, logo, botones mailto con el permiso del aprobador, y cosas peligrosas
  function aribaHtml(pr, titulo) {
    return '<html><head><title>Ariba</title><style>.btn{background:#0a6ed1;color:#fff}@import url(https://x.test/a.css);</style>' +
      '<script>alert("head")</script></head><body bgcolor="#ffffff"><!-- comentario -->' +
      '<table width="640" style="font-family:Arial"><tr><td><img src="https://s1.ariba.com/logo.png" alt="SAP Ariba">' +
      '<img src="http://inseguro.test/pixel.gif"><img src="javascript:alert(1)"></td></tr>' +
      '<tr><td><h2>Solicitud de compra</h2><p>' + pr + ' - ' + titulo + '</p><p>Importe total $4.512.880 CLP</p></td></tr>' +
      '<tr><td><a class="btn" href="mailto:buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com?subject=Aprobar%20' + pr + '&body=TOKEN-SECRETO-123">Aprobar</a> ' +
      '<a class="btn" href="mailto:x@ariba.com?subject=Denegar&body=TOKEN-SECRETO-123" target="_blank">Denegar</a> ' +
      '<a href="https://s1.ariba.com/Buyer/Main/ad/webjumper?itemID=' + pr + '" onclick="steal()">Ver</a></td></tr></table>' +
      '<form action="https://x.test"><input name="q"><button>Enviar</button></form><iframe src="https://x.test"></iframe>' +
      '<div onmouseover="alert(2)" style="color:#555">Flujo de aprobación</div><script>alert("body")</script></body></html>';
  }
  function aribaMsg(file, extra) {
    return MOCK.gmail.add(Object.assign({ from: FROM, subject: subj(file), plainBody: fx(file), date: hoursAgo(5) }, extra || {}));
  }
  function solBy(pr) {
    var s = aprobRead_(ss_()).find(function (x) { return x.pr === pr; });
    if (!s) throw new Error('no encontré la solicitud ' + pr);
    return s;
  }
  function snapRows() { return MOCK.sheet(SNAP) ? MOCK.values(SNAP).slice(1).filter(function (r) { return r[0]; }) : []; }
  // Cuenta las llamadas a GmailApp durante fn
  function gmailCalls(fn) {
    var calls = 0, saved = {};
    Object.keys(GmailApp).forEach(function (k) {
      if (typeof GmailApp[k] === 'function') { saved[k] = GmailApp[k]; GmailApp[k] = function () { calls++; return saved[k].apply(this, arguments); }; }
    });
    try { fn(); } finally { Object.keys(saved).forEach(function (k) { GmailApp[k] = saved[k]; }); }
    return calls;
  }
  function safe(fn) {
    var prev = CONFIG.FEATURES;
    CONFIG.FEATURES = { DRIVE: false, GMAIL: false };
    try { return fn(); } finally { CONFIG.FEATURES = prev; }
  }
  // Vinculada (PR71899, con HTML), Nueva línea (PR71524, sólo texto) y Descartada (PR72010)
  function seed() {
    fresh('setup');
    var m = {
      v: aribaMsg('ariba_PR71899_plain.txt', { date: hoursAgo(30), htmlBody: aribaHtml('PR71899', 'Estudio huella hídrica') }),
      n: aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(2) }),
      d: aribaMsg('ariba_PR72010_plain.txt', { date: hoursAgo(50), htmlBody: aribaHtml('PR72010', 'Consultoría') }),
    };
    client('aprobScan');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    client('aprobLink', solBy('PR71899').id, { year: 2026, lineId: line.id });
    client('aprobNewLine', solBy('PR71524').id, { year: 2026, area: 'cc' });
    client('aprobDiscard', solBy('PR72010').id, 'no es del área');
    return { m: m, line: line, v: solBy('PR71899'), n: solBy('PR71524'), d: solBy('PR72010') };
  }

  test('v37 pantallazo · al registrar una solicitud se guarda la copia del correo en una pestaña oculta', function () {
    need('aprobMailView', 'aprobSnapSave_');
    var x = seed();
    ok(MOCK.sheet(SNAP), 'se creó la pestaña de pantallazos');
    ok(MOCK.sheet(SNAP).isSheetHidden(), 'oculta');
    deepEq(MOCK.values(SNAP)[0].slice(0, 7), ['ID', 'Gmail ID', 'Capturado', 'Asunto', 'De', 'Fecha', 'Captura']);
    var rows = snapRows();
    deepEq(rows.map(function (r) { return r[0]; }).sort(), [x.v.id, x.n.id].sort(), 'vinculada + línea nueva (la descartada no)');
    var r = rows.find(function (row) { return row[0] === x.v.id; });
    eq(r[1], x.m.v.id, 'Gmail ID del correo capturado');
    ok(r[2] instanceof Date, 'fecha de captura');
    eq(r[3], aprobOneLine_(subj('ariba_PR71899_plain.txt')));
    ok(String(r[6]).charAt(0) === '|', 'cada trozo empieza con "|" (Sheets nunca lo convierte)');
    ok(rows.every(function (row) { return row.every(function (c) { return String(c).length <= 50000; }); }), 'ninguna celda pasa de 50.000');
  });

  test('v37 pantallazo · aprobMailView: el equipo ve la copia, sin scripts ni links, y NUNCA se lee Gmail', function () {
    need('aprobMailView');
    var x = seed();
    var before = JSON.stringify(MOCK.values('Solicitudes')), hist = rowsOf('Historial').length;
    var r;
    var calls = gmailCalls(function () { r = asUser(U.ina, function () { return client('aprobMailView', x.v.id); }); });
    eq(calls, 0, 'ver el pantallazo no toca Gmail');
    deepEq([r.id, r.pr], [x.v.id, 'PR71899']);
    eq(r.asunto, x.v.asunto);
    ok(r.de.indexOf('buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com') >= 0, 'remitente: ' + r.de);
    eq(r.fecha, x.m.v.date.toISOString());
    ok(/^\d{4}-\d{2}-\d{2}T/.test(r.capturado), 'fecha del pantallazo');
    var h = r.html;
    ['<table width="640"', 'PR71899 - Estudio huella hídrica', 'Importe total $4.512.880 CLP', '.btn{background:#0a6ed1',
      'src="https://s1.ariba.com/logo.png"', '>Aprobar</span>', '>Denegar</span>', '>Ver</span>', 'Flujo de aprobación']
      .forEach(function (s) { includes(h, s, 'conserva «' + s + '»'); });
    ['<script', 'alert(', 'TOKEN-SECRETO', 'mailto:', 'href=', 'onclick', 'onmouseover', '<a ', '<form', '<input', '<iframe',
      '<button', 'http://inseguro', 'javascript:', '@import', 'target=', '<html', '<head', '<title', '<!--']
      .forEach(function (s) { ok(h.indexOf(s) < 0, 'sin «' + s + '»'); });
    eq(r.hiloUrl, '', 'el link de Gmail sólo le sirve al dueño del buzón');
    assertNoDates(r, 'aprobMailView');
    eq(JSON.stringify(MOCK.values('Solicitudes')), before, 'sólo lectura');
    eq(rowsOf('Historial').length, hist, 'sin entrada en el Historial');
    // Correo sin HTML: pantallazo en texto, sin links
    var n = asUser(U.ignacio, function () { return client('aprobMailView', x.n.id); });
    ok(/^<pre style="/.test(n.html), 'texto preformateado');
    includes(n.html, 'Piloto Green Energy');
    ok(n.html.indexOf('mailto:') < 0 && n.html.indexOf('<script') < 0);
    // El administrador además recibe el link al hilo
    ok(/^https:\/\/mail\.google\.com\//.test(client('aprobMailView', x.v.id).hiloUrl), 'administrador: link al hilo');
  });

  test('v37 pantallazo · sigue disponible aunque el correo se borre de Gmail (es una copia)', function () {
    need('aprobMailView');
    var x = seed();
    MOCK.gmail.messages = [];
    var r = asUser(U.benja, function () { return client('aprobMailView', x.v.id); });
    includes(r.html, 'PR71899 - Estudio huella hídrica');
  });

  test('v37 pantallazo · bundle.budgetMails: todo el equipo, sólo registradas con pantallazo, sin datos sensibles', function () {
    need('aprobMailRefs_');
    var x = seed();
    var mine = client('bootstrap');
    var ina = asUser(U.ina, function () { return client('bootstrap'); });
    deepEq(ina.solicitudes, [], 'el resto del equipo sigue sin la bandeja de solicitudes');
    eq(ina.budgetMails.length, 2, 'vinculada + línea nueva');
    var ref = ina.budgetMails.find(function (r) { return r.pr === 'PR71899'; });
    deepEq(Object.keys(ref).sort(), ['fecha', 'id', 'lineId', 'pr', 'recibido'], 'sin montos, solicitante ni link de Gmail');
    deepEq([ref.id, ref.lineId, ref.fecha], [x.v.id, x.line.id, x.v.fecha]);
    eq(ref.recibido, x.m.v.date.toISOString());
    deepEq(mine.budgetMails, ina.budgetMails, 'el administrador recibe lo mismo (sacado de sus solicitudes)');
    assertNoDates(ina.budgetMails, 'budgetMails');
    client('aprobReset', x.v.id);
    eq(asUser(U.benja, function () { return client('bootstrap'); }).budgetMails.length, 1, 'reabierta (pendiente) → sin ojo');
  });

  test('v37 pantallazo · lo registrado sin captura (modo seguro, versión anterior) se completa con «Revisar ahora»', function () {
    need('aprobSnapPending_');
    fresh('setup');
    var m = aribaMsg('ariba_PR71899_plain.txt', { htmlBody: aribaHtml('PR71899', 'Estudio huella hídrica') });
    client('aprobScan');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    var id = solBy('PR71899').id;
    var calls = gmailCalls(function () { safe(function () { client('aprobLink', id, { year: 2026, lineId: line.id }); }); });
    eq(calls, 0, 'modo seguro: vincular no lee Gmail');
    eq(snapRows().length, 0, 'sin pantallazo');
    eq(asUser(U.ina, function () { return client('bootstrap'); }).budgetMails.length, 0, 'sin pantallazo no hay ojo');
    throws(function () { asUser(U.ina, function () { client('aprobMailView', id); }); }, /Aún no hay pantallazo/);
    var b = client('aprobScan');
    eq(snapRows().length, 1, '«Revisar ahora» toma el pantallazo que faltaba');
    eq(b.budgetMails.length, 1, 'el bundle de la respuesta ya trae el ojo');
    eq(snapRows()[0][1], m.id);
    // Idempotente: otra revisión no vuelve a leer ese correo ni duplica la fila
    var n = 0, get = GmailApp.getMessageById;
    GmailApp.getMessageById = function (gid) { if (gid === m.id) n++; return get.apply(this, arguments); };
    try { client('aprobScan'); aprobScanTrigger(); } finally { GmailApp.getMessageById = get; }
    eq(n, 0, 'no se vuelve a capturar');
    eq(snapRows().length, 1, 'una fila por solicitud');
    // El activador diario también completa los que faltan
    MOCK.sheet(SNAP).deleteRows(2, 1);
    aprobScanTrigger();
    eq(snapRows().length, 1, 'el activador también');
  });

  test('v37 pantallazo · correos grandes se guardan en trozos; los enormes, como texto', function () {
    need('aprobSnapSave_', 'aprobSnapRead_');
    fresh('setup');
    var big = '<table>' + new Array(3001).join('<tr><td>Fila de prueba con texto largo para el pantallazo</td></tr>') + '</table>';
    ok(big.length > APROB_SNAP_PART * 3, 'más de 3 trozos: ' + big.length);
    aribaMsg('ariba_PR71899_plain.txt', { htmlBody: big });
    client('aprobScan');
    client('aprobLink', solBy('PR71899').id, { year: 2026, lineId: lineBy(bootstrap(), 2026, AUDIT).id });
    var r = snapRows()[0];
    var parts = r.slice(6).filter(function (c) { return c !== ''; });
    eq(parts.length, Math.ceil(big.length / APROB_SNAP_PART), 'un trozo por cada ' + APROB_SNAP_PART + ' caracteres');
    ok(parts.every(function (p) { return String(p).length <= 50000; }), 'cada celda bajo el límite');
    var sid = solBy('PR71899').id;
    eq(asUser(U.ina, function () { return client('aprobMailView', sid); }).html, big, 'se rearma igual');
    // Reemplazar por uno más corto borra los trozos sobrantes
    withLock_(function () { aprobSnapSave_(ss_(), [{ id: sid, gmailId: 'x', asunto: 'a', de: 'b', fecha: '', html: '<p>corto</p>' }]); });
    eq(aprobSnapRead_(ss_(), sid).html, '<p>corto</p>');
    eq(snapRows().length, 1);
    // Más grande que el máximo → texto plano
    fresh('setup');
    var huge = '<div>' + new Array(APROB_SNAP_PART * APROB_SNAP_PARTS / 10 + 2).join('xxxxxxxxxx') + '</div>';
    aribaMsg('ariba_PR71524_plain.txt', { htmlBody: huge });
    client('aprobScan');
    client('aprobLink', solBy('PR71524').id, { year: 2026, lineId: lineBy(bootstrap(), 2026, AUDIT).id });
    var h = aprobSnapRead_(ss_(), solBy('PR71524').id).html;
    ok(/^<pre /.test(h) && h.indexOf('Piloto Green Energy') > 0, 'pantallazo en texto');
  });

  test('v37 pantallazo · sólo correos de Ariba: un Gmail ID ajeno nunca se captura', function () {
    need('aprobSnapTake_');
    fresh('setup');
    aribaMsg('ariba_PR71899_plain.txt');
    client('aprobScan');
    var s = solBy('PR71899');
    var otro = MOCK.gmail.add({ from: 'jefe@copec.cl', subject: 'Privado', plainBody: 'sueldos', htmlBody: '<p>sueldos</p>' });
    var rec = { id: s.id, gmailIds: ['borrado00000000', otro.id], asunto: '', recibido: '' };
    eq(aprobSnapTake_(rec), null, 'ajeno o borrado → sin pantallazo');
    rec.gmailIds.push(s.gmailId);
    var snap = aprobSnapTake_(rec);
    eq(snap.gmailId, s.gmailId, 'salta lo borrado y lo ajeno');
    ok(snap.html.indexOf('sueldos') < 0);
  });

  test('v37 pantallazo · aprobMailView rechaza lo que no es el correo de respaldo de una línea', function () {
    need('aprobMailView');
    var x = seed();
    var re = /no tiene un correo de respaldo/;
    asUser(U.ina, function () {
      throws(function () { client('aprobMailView', x.d.id); }, re, 'descartada');
      throws(function () { client('aprobMailView', 'SOL-nada0000'); }, re, 'no existe');
      throws(function () { client('aprobMailView', ''); }, re, 'vacía');
    });
    client('aprobReset', x.v.id);
    throws(function () { asUser(U.ina, function () { client('aprobMailView', x.v.id); }); }, re, 'reabierta (pendiente)');
    throws(function () { asUser('otro@copec.cl', function () { client('aprobMailView', x.n.id); }); }, /No tienes acceso/, 'fuera del equipo');
    throws(function () { asUser('', function () { client('aprobMailView', x.n.id); }); }, /cuenta del equipo/, 'correo desconocido');
  });

  test('v37 pantallazo · modo seguro: los pantallazos ya guardados se ven sin tocar Gmail', function () {
    need('aprobMailView');
    var x = seed();
    safe(function () {
      var r, b;
      var calls = gmailCalls(function () {
        b = asUser(U.ina, function () { return client('bootstrap'); });
        r = asUser(U.ina, function () { return client('aprobMailView', x.v.id); });
      });
      eq(calls, 0, 'sin Gmail');
      eq(b.budgetMails.length, 2);
      includes(r.html, 'PR71899');
    });
  });

  test('v37 pantallazo · el bundle no se cae si la pestaña de pantallazos falla', function () {
    need('aprobMailRefs_');
    seed();
    var GL = (0, eval)('this'), saved = GL.aprobMailRefs_;
    GL.aprobMailRefs_ = function () { throw new Error('hoja rota'); };
    try {
      var b = asUser(U.ina, function () { return client('bootstrap'); });
      deepEq(b.budgetMails, [], 'sin ojos, pero la app abre');
      ok(b.budget && b.me, 'bundle completo');
    } finally { GL.aprobMailRefs_ = saved; }
  });
})();
