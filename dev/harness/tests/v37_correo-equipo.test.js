/* v3.7 · Correo de respaldo para todo el equipo (SPEC §13.2): bundle `budgetMails` (todo miembro) y aprobMailView, que lee
   el correo de una solicitud registrada en una línea desde el Gmail del dueño del script (sólo correos de Ariba). */
(function () {
  var FX = 'dev/fixtures/';
  var FROM = '"Aprobación por correo electrónico" <buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com>';
  var AUDIT = 'GV - Auditoria interna ISO 50001'; // Cuadre 2026
  var SUBJ = null;
  function fx(name) { return readText(FX + name); }
  function subj(name) { if (!SUBJ) SUBJ = JSON.parse(fx('ariba_subjects.json')); return SUBJ[name]; }
  function hoursAgo(h) { return new Date(Date.now() - h * 3600000); }
  function aribaMsg(file, extra) {
    return MOCK.gmail.add(Object.assign({ from: FROM, subject: subj(file), plainBody: fx(file), date: hoursAgo(5) }, extra || {}));
  }
  function solBy(pr) {
    var s = aprobRead_(ss_()).find(function (x) { return x.pr === pr; });
    if (!s) throw new Error('no encontré la solicitud ' + pr);
    return s;
  }
  // Escribe una celda de la hoja Solicitudes (fila de la solicitud id, columna h)
  function setCell(id, h, v) {
    var vals = MOCK.values('Solicitudes');
    var c = vals[0].indexOf(h), r = vals.findIndex(function (row) { return row[0] === id; });
    ok(c >= 0 && r > 0, 'celda ' + h + ' de ' + id);
    MOCK.sheet('Solicitudes').getRange(r + 1, c + 1).setValue(v);
  }
  // Vinculada (PR71899), Nueva línea (PR71524) y Descartada (PR72010)
  function seed() {
    fresh('setup');
    var m = {
      v: aribaMsg('ariba_PR71899_plain.txt', { date: hoursAgo(30) }),
      n: aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(2) }),
      d: aribaMsg('ariba_PR72010_plain.txt', { date: hoursAgo(50) }),
    };
    client('aprobScan');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    client('aprobLink', solBy('PR71899').id, { year: 2026, lineId: line.id });
    client('aprobNewLine', solBy('PR71524').id, { year: 2026, area: 'cc' });
    client('aprobDiscard', solBy('PR72010').id, 'no es del área');
    return { m: m, line: line, v: solBy('PR71899'), n: solBy('PR71524'), d: solBy('PR72010') };
  }

  test('v37 correo equipo · bundle.budgetMails: todo el equipo recibe sólo las referencias de las solicitudes registradas', function () {
    need('aprobMailView', 'aprobMailRefs_');
    var x = seed();
    var mine = client('bootstrap');
    var ina = asUser(U.ina, function () { return client('bootstrap'); });
    deepEq(ina.solicitudes, [], 'el resto del equipo sigue sin la bandeja de solicitudes');
    eq(ina.budgetMails.length, 2, 'vinculada + línea nueva (la descartada no)');
    var ref = ina.budgetMails.find(function (r) { return r.pr === 'PR71899'; });
    ok(ref, 'la vinculada');
    deepEq(Object.keys(ref).sort(), ['fecha', 'id', 'lineId', 'pr', 'recibido'], 'sin montos, solicitante ni link de Gmail');
    deepEq([ref.id, ref.lineId], [x.v.id, x.line.id]);
    eq(ref.recibido, x.m.v.date.toISOString());
    eq(ref.fecha, x.v.fecha, 'fecha de la solicitud (para elegir la más reciente por línea)');
    eq(ina.budgetMails.find(function (r) { return r.pr === 'PR71524'; }).lineId, x.n.lineId, 'línea nueva');
    ok(ina.budgetMails.every(function (r) { return r.pr !== 'PR72010'; }), 'descartada fuera');
    deepEq(mine.budgetMails, ina.budgetMails, 'el administrador recibe lo mismo (sacado de sus solicitudes)');
    client('aprobReset', x.v.id);
    eq(asUser(U.benja, function () { return client('bootstrap'); }).budgetMails.length, 1, 'reabierta (pendiente) → fuera');
    assertNoDates(ina.budgetMails, 'budgetMails');
  });

  test('v37 correo equipo · aprobMailView: un miembro lee el correo de Ariba sin los links de Aprobar / Denegar / Ver', function () {
    need('aprobMailView');
    var x = seed();
    var before = JSON.stringify(MOCK.values('Solicitudes')), hist = rowsOf('Historial').length;
    var r = asUser(U.ina, function () { return client('aprobMailView', x.v.id); });
    deepEq([r.id, r.pr], [x.v.id, 'PR71899']);
    eq(r.asunto, x.v.asunto, 'asunto en una línea (sin espacios raros)');
    includes(r.asunto, 'PR71899 - Estudio huella hídrica');
    ok(r.de.indexOf('buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com') >= 0, 'remitente: ' + r.de);
    eq(r.fecha, x.m.v.date.toISOString());
    includes(r.cuerpo, 'Estudio huella hídrica en plantas de lubricantes');
    includes(r.cuerpo, 'Aprobar Denegar Ver', 'los textos de los botones quedan');
    ok(r.cuerpo.indexOf('mailto:') < 0 && r.cuerpo.indexOf('Approve') < 0, 'sin links para aprobar o denegar por correo');
    ok(r.cuerpo.indexOf('s1.ariba.com') < 0, 'sin link a Ariba');
    eq(r.hiloUrl, '', 'el link de Gmail sólo le sirve al dueño del buzón');
    assertNoDates(r, 'aprobMailView');
    var a = client('aprobMailView', x.v.id);
    ok(/^https:\/\/mail\.google\.com\//.test(a.hiloUrl), 'administrador: link al hilo');
    eq(a.cuerpo, r.cuerpo);
    var n = asUser(U.ignacio, function () { return client('aprobMailView', x.n.id); });
    includes(n.cuerpo, 'Piloto Green Energy', 'línea nueva también');
    eq(JSON.stringify(MOCK.values('Solicitudes')), before, 'sólo lectura: la hoja no cambia');
    eq(rowsOf('Historial').length, hist, 'ni se anota en el Historial');
  });

  test('v37 correo equipo · aprobMailView rechaza lo que no es un correo de respaldo de una línea', function () {
    need('aprobMailView');
    var x = seed();
    var re = /no tiene un correo de respaldo/;
    asUser(U.ina, function () {
      throws(function () { client('aprobMailView', x.d.id); }, re, 'descartada');
      throws(function () { client('aprobMailView', 'SOL-nada0000'); }, re, 'no existe');
      throws(function () { client('aprobMailView', ''); }, re, 'vacía');
    });
    client('aprobReset', x.d.id);
    throws(function () { asUser(U.ina, function () { client('aprobMailView', x.d.id); }); }, re, 'pendiente');
    throws(function () { asUser('otro@copec.cl', function () { client('aprobMailView', x.v.id); }); }, /No tienes acceso/, 'fuera del equipo');
    throws(function () { asUser('', function () { client('aprobMailView', x.v.id); }); }, /cuenta del equipo/, 'correo desconocido');
  });

  test('v37 correo equipo · aprobMailView sólo devuelve correos de Ariba: el más nuevo disponible o un error claro', function () {
    need('aprobMailView');
    var x = seed();
    var otro = MOCK.gmail.add({ from: 'jefe@copec.cl', subject: 'Privado', plainBody: 'sueldos', date: hoursAgo(1) });
    setCell(x.v.id, 'Gmail ID', otro.id);
    throws(function () { asUser(U.ina, function () { client('aprobMailView', x.v.id); }); }, /No encontré el correo/, 'un id de otro remitente no se muestra');
    setCell(x.v.id, 'Gmail ID', 'borrado00000000,' + otro.id + ',' + x.m.v.id);
    var r = asUser(U.ina, function () { return client('aprobMailView', x.v.id); });
    includes(r.cuerpo, 'Estudio huella hídrica', 'salta lo borrado y lo ajeno');
    ok(r.cuerpo.indexOf('sueldos') < 0);
    MOCK.gmail.messages = MOCK.gmail.messages.filter(function (m) { return m.id !== x.m.v.id; });
    throws(function () { asUser(U.ina, function () { client('aprobMailView', x.v.id); }); }, /No encontré el correo/, 'borrado de Gmail');
  });

  test('v37 correo equipo · modo seguro: sin Gmail no hay ojo para el equipo ni lectura de correos', function () {
    need('aprobMailView');
    var x = seed();
    var prev = CONFIG.FEATURES;
    CONFIG.FEATURES = { DRIVE: false, GMAIL: false };
    try {
      eq(asUser(U.ina, function () { return client('bootstrap'); }).budgetMails.length, 0, 'equipo');
      eq(client('bootstrap').budgetMails.length, 0, 'administrador');
      var calls = 0, get = GmailApp.getMessageById;
      GmailApp.getMessageById = function () { calls++; return get.apply(this, arguments); };
      try {
        throws(function () { asUser(U.ina, function () { client('aprobMailView', x.v.id); }); }, /modo seguro/);
      } finally { GmailApp.getMessageById = get; }
      eq(calls, 0, 'no toca Gmail');
    } finally { CONFIG.FEATURES = prev; }
  });

  test('v37 correo equipo · el bundle no se cae si la hoja de solicitudes falla', function () {
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
