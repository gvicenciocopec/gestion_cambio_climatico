/* v3 · Aprobaciones.gs — lectura de Gmail, registro en "Solicitudes", vincular / línea nueva / descartar / reabrir,
   permisos de administrador, activador y presSaveInLock_ (Presupuesto.gs) */
(function () {
  var FX = 'dev/fixtures/';
  var FROM = '"Aprobación por correo electrónico" <buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com>';
  var SUBJ = null;
  var AUDIT = 'GV - Auditoria interna ISO 50001';   // Cuadre 2026: OC "No", sin nota
  var AGUADA = 'Aguada La Chimba - Continuacion';  // Cuadre 2026: con nota
  function fx(name) { return readText(FX + name); }
  function subj(name) { if (!SUBJ) SUBJ = JSON.parse(fx('ariba_subjects.json')); return SUBJ[name]; }
  function hoursAgo(h) { return new Date(Date.now() - h * 3600000); }
  function aribaMsg(file, extra) {
    return MOCK.gmail.add(Object.assign({ from: FROM, subject: subj(file), plainBody: fx(file), date: hoursAgo(5) }, extra || {}));
  }
  function seed3() {
    return [
      aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(2) }),
      aribaMsg('ariba_PR71899_plain.txt', { date: hoursAgo(30) }),
      aribaMsg('ariba_PR72010_plain.txt', { date: hoursAgo(50) }),
    ];
  }
  function sols() { return aprobRead_(ss_()); }
  function solBy(pr) {
    var s = sols().find(function (x) { return x.pr === pr; });
    if (!s) throw new Error('no encontré la solicitud ' + pr);
    return s;
  }
  function logsOf(accion) { return rowsOf('Historial').filter(function (r) { return r['Acción'] === accion; }); }
  function aprobTriggers() { return MOCK.triggers().filter(function (t) { return t.handler === 'aprobScanTrigger'; }); }

  test('v3 aprobsrv · aprobScan registra las solicitudes de Ariba y es idempotente', function () {
    need('aprobScan', 'aprobRead_');
    fresh('setup');
    eq(MOCK.gmail.messages.length, 0, 'el buzón simulado parte vacío en cada prueba');
    var ms = seed3();
    MOCK.gmail.add({ from: 'otro@copec.cl', subject: 'Solicitud de compra PR99999 (reenviado)', plainBody: 'x', date: hoursAgo(1) });
    MOCK.gmail.add({ from: FROM, subject: 'Su contraseña de Ariba vence pronto', plainBody: 'x', date: hoursAgo(1) });
    MOCK.gmail.add({ from: FROM, subject: subj('ariba_PR71524_plain.txt').replace('PR71524', 'PR60000'), plainBody: fx('ariba_PR71524_plain.txt'), date: hoursAgo(24 * 200) });

    var b = client('aprobScan');
    deepEq([b.lastScan.found, b.lastScan.added, b.lastScan.updated, b.lastScan.errors], [3, 3, 0, 0], 'primer escaneo');
    var q = MOCK.gmail.searches[0];
    eq(q.query, 'from:(buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com) newer_than:120d');
    eq(q.max, 50);
    var sh = MOCK.sheet('Solicitudes');
    ok(sh, 'se creó la hoja Solicitudes');
    ok(sh.isSheetHidden(), 'la hoja queda oculta');
    eq(MOCK.values('Solicitudes')[0].join('|'), APROB_HEADERS.join('|'), 'encabezados §13.2');
    var list = sols();
    deepEq(list.map(function (s) { return s.pr; }), ['PR71524', 'PR71899', 'PR72010'], 'más recientes primero');
    var s = list[0];
    ok(/^SOL-[0-9a-f]{8}$/.test(s.id), 'id SOL-xxxxxxxx: ' + s.id);
    eq(s.gmailId, ms[0].id);
    ok(/^https:\/\/mail\.google\.com\//.test(s.hiloUrl), 'link al hilo');
    eq(s.recibido, ms[0].date.toISOString());
    eq(s.estado, 'Pendiente');
    eq(s.lectura, 'ok');
    eq(s.montoClp, 13473363);
    eq(s.fecha, '2026-10-02T14:17:00.000Z');
    eq(s.sugerido, Math.round(13473363.17 * 109.8 / 328.03), 'sugerido recalculado al leer');
    eq(s.cecos[1].propio, true);
    deepEq([s.anio, s.lineId, s.montoImputado, s.nota, s.procesadoPor, s.procesado], ['', '', 0, '', '', '']);
    var row = rowsOf('Solicitudes').find(function (r) { return r.PR === 'PR71524'; });
    eq(rowsOf('Solicitudes')[0].PR, 'PR72010', 'en la hoja quedan en orden de llegada');
    eq(row['Gmail ID'], ms[0].id, 'el ID de Gmail se guarda como texto');
    eq(typeof row['Monto CLP'], 'number');
    ok(row.Recibido instanceof Date, 'Recibido es fecha en la hoja');
    eq(rowsOf('Solicitudes').length, 3);
    eq(MOCK.props().APROB_LAST_SCAN, b.lastScan.at, 'lastScan en Script Properties');
    eq(aprobStatus_().lastResult.added, 3);
    eq(logsOf('Leer solicitudes Ariba').length, 1, 'Historial');
    if (b.solicitudes) eq(b.solicitudes.length, 3, 'bundle.solicitudes (Code.gs)');

    // Segunda vuelta: nada nuevo y sin volver a leer los cuerpos ya registrados
    ms.forEach(function (m) { m.fail = 'getPlainBody'; });
    var b2 = client('aprobScan');
    deepEq([b2.lastScan.found, b2.lastScan.added, b2.lastScan.updated, b2.lastScan.skipped, b2.lastScan.errors], [3, 0, 0, 3, 0], 'segundo escaneo');
    eq(rowsOf('Solicitudes').length, 3, 'sin duplicados');
    eq(logsOf('Leer solicitudes Ariba').length, 1, 'sin entrada nueva en Historial si no hubo cambios');
    var r3 = aprobScanTrigger();
    eq(r3.added, 0, 'el activador también es idempotente');
    ok(b2.aprob && b2.aprob.sender === 'buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com', 'estado en la respuesta');
  });

  test('v3 aprobsrv · un correo más nuevo del mismo PR pendiente actualiza la solicitud', function () {
    need('aprobScan');
    fresh('setup');
    var m1 = aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(10) });
    client('aprobScan');
    var body = fx('ariba_PR71524_plain.txt').replace('$13.473.363,17 CLP', '$14.000.000 CLP');
    var m2 = MOCK.gmail.add({ from: FROM, threadId: m1.threadId, subject: 'Recordatorio: ' + subj('ariba_PR71524_plain.txt').replace('$13.473.363,17', '$14.000.000'), plainBody: body, date: hoursAgo(1) });
    var b = client('aprobScan');
    deepEq([b.lastScan.found, b.lastScan.added, b.lastScan.updated, b.lastScan.skipped], [2, 0, 1, 1]);
    var list = sols();
    eq(list.length, 1, 'una sola solicitud por PR');
    eq(list[0].montoClp, 14000000, 'monto del correo más nuevo');
    eq(list[0].gmailId, m2.id, 'gmailId = el más nuevo');
    eq(list[0].recibido, m2.date.toISOString());
    ok(/^Recordatorio:/.test(list[0].asunto));
    eq(rowsOf('Solicitudes')[0]['Gmail ID'], m2.id + ',' + m1.id, 'se recuerdan ambos mensajes');
    // Un correo más antiguo que llega tarde sólo completa lo que falta
    MOCK.gmail.add({ from: FROM, subject: subj('ariba_PR71524_plain.txt'), plainBody: fx('ariba_PR71524_plain.txt').replace('LUXMETER', 'OTRO'), date: hoursAgo(48) });
    var b3 = client('aprobScan');
    eq(b3.lastScan.updated, 1);
    eq(solBy('PR71524').montoClp, 14000000, 'no pisa con datos más antiguos');
    eq(solBy('PR71524').proveedor, 'LUXMETER ENERGY SPA');
    eq(solBy('PR71524').gmailId, m2.id);
  });

  test('v3 aprobsrv · una solicitud parcial se completa con el siguiente correo del mismo PR', function () {
    need('aprobScan');
    fresh('setup');
    var half = fx('ariba_PR71524_plain.txt').split('Cuenta contable')[0];
    aribaMsg('ariba_PR71524_plain.txt', { plainBody: half, date: hoursAgo(6) });
    client('aprobScan');
    eq(solBy('PR71524').lectura, 'parcial');
    eq(solBy('PR71524').sugerido, 13473363, 'sin CeCos: sugerido = monto');
    aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(1) });
    client('aprobScan');
    eq(sols().length, 1);
    eq(solBy('PR71524').lectura, 'ok');
    eq(solBy('PR71524').cecos.length, 2);
  });

  test('v3 aprobsrv · un PR ya procesado ignora recordatorios (no registra nada)', function () {
    need('aprobScan', 'aprobDiscard');
    fresh('setup');
    aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(10) });
    client('aprobScan');
    var s = solBy('PR71524');
    client('aprobDiscard', s.id, 'Lo paga otra gerencia');
    var before = JSON.stringify(MOCK.values('Solicitudes'));
    var rem = aribaMsg('ariba_PR71524_plain.txt', { subject: 'Recordatorio: ' + subj('ariba_PR71524_plain.txt'), date: hoursAgo(1), fail: 'getPlainBody' });
    var b = client('aprobScan');
    deepEq([b.lastScan.found, b.lastScan.added, b.lastScan.updated, b.lastScan.ignored, b.lastScan.errors], [2, 0, 0, 1, 0]);
    eq(JSON.stringify(MOCK.values('Solicitudes')), before, 'la hoja no cambió');
    ok(String(rowsOf('Solicitudes')[0]['Gmail ID']).indexOf(rem.id) < 0, 'el recordatorio no se registra');
    // Al reabrirla, el recordatorio sí la actualiza
    client('aprobReset', s.id);
    rem.fail = null;
    var b2 = client('aprobScan');
    eq(b2.lastScan.updated, 1);
    eq(solBy('PR71524').gmailId, rem.id);
  });

  test('v3 aprobsrv · un mensaje dañado no detiene a los demás y lo ilegible queda como parcial', function () {
    need('aprobScan');
    fresh('setup');
    aribaMsg('ariba_PR71899_plain.txt', { date: hoursAgo(3) });
    var noBody = aribaMsg('ariba_PR71524_plain.txt', { date: hoursAgo(2), fail: ['getPlainBody', 'getBody'] });
    aribaMsg('ariba_PR72010_plain.txt', { date: hoursAgo(4), fail: 'getFrom' });
    var raro = MOCK.gmail.add({ from: FROM, subject: 'Solicitud de compra: aviso del sistema', plainBody: '%%% sin formato %%%', date: hoursAgo(1) });
    var html = MOCK.gmail.add({
      from: FROM, subject: 'Acción necesaria: Aprobar el/la Solicitud de compra que ANA LUZ ROJAS ha enviado - PR70001 - Prueba HTML ($1.000.000 CLP)',
      plainBody: '', date: hoursAgo(5),
      htmlBody: '<table><tr><td>Creado</td><td>jueves, 1 octubre, 2026 a las 08:00, CLST</td></tr><tr><td>Importe total</td><td>$1.000.000 CLP</td></tr></table>' +
        '<p>Cuenta contable</p><p>0005602585(Est.) XUF80853(PROY.CAMBIOS CLIMA) Importe 25,00 CLF</p>',
    });
    var b = client('aprobScan');
    deepEq([b.lastScan.found, b.lastScan.added, b.lastScan.errors], [4, 4, 1], 'resultado');
    var a = solBy('PR71524');
    eq(a.lectura, 'parcial', 'sin cuerpo legible');
    eq(a.nombre, 'Piloto Green Energy en Transcom', 'igual se aprovecha el asunto');
    eq(a.gmailId, noBody.id);
    var r = sols().find(function (x) { return x.gmailId === raro.id; });
    ok(r, 'el correo sin formato queda registrado');
    eq(r.lectura, 'parcial');
    eq(r.pr, '');
    eq(r.asunto, 'Solicitud de compra: aviso del sistema', 'con su asunto, para no perderlo');
    var h = solBy('PR70001');
    eq(h.lectura, 'ok', 'cuerpo HTML como respaldo');
    eq(h.gmailId, html.id);
    eq(solBy('PR71899').lectura, 'ok');
    ok(!sols().some(function (x) { return x.pr === 'PR72010'; }), 'el mensaje que no se pudo leer no se registra');
    // Gmail no disponible: error claro (aprobScan) y el activador no lanza
    MOCK.gmail.searchError = 'Exception: Service invoked too many times for one day: gmail.';
    throws(function () { client('aprobScan'); }, /No pude leer Gmail/);
    eq(aprobStatus_().lastResult.error.indexOf('too many times') >= 0, true, 'error guardado en el estado');
    var t = aprobScanTrigger();
    ok(/too many times/.test(t.error), 'el activador devuelve el error sin lanzar');
  });

  test('v3 aprobsrv · aprobLink vincula a una línea, marca OC y anota el PR en la nota (un solo lock)', function () {
    need('aprobLink', 'aprobReset', 'presSaveInLock_');
    fresh('setup');
    aribaMsg('ariba_PR71524_plain.txt');
    client('aprobScan');
    var s = solBy('PR71524');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    eq(line.oc, 'No');
    eq(line.nota, '');
    var nEdit = logsOf('Editar línea').length;
    var b = client('aprobLink', s.id, { year: 2026, lineId: line.id, monto: '4.509.878', marcarOc: true, nota: 'Piloto Transcom' });
    eq(b.lastId, s.id);
    var v = solBy('PR71524');
    deepEq([v.estado, v.anio, v.lineId, v.montoImputado, v.nota, v.procesadoPor], ['Vinculada', '2026', line.id, 4509878, 'Piloto Transcom', U.gonzalo]);
    ok(/^\d{4}-\d{2}-\d{2}T/.test(v.procesado), 'procesado ISO');
    var l2 = lineBy(b, 2026, AUDIT);
    eq(l2.oc, 'Si', 'OC emitida');
    eq(l2.nota, 'PR71524', 'PR en la nota de la línea');
    eq(l2.estado, 'En curso');
    if (b.solicitudes) eq(b.solicitudes.find(function (x) { return x.id === s.id; }).estado, 'Vinculada', 'bundle.solicitudes');
    eq(logsOf('Vincular solicitud').length, 1, 'Historial');
    eq(logsOf('Editar línea').length, nEdit + 1, 'el cambio de la línea queda en el Historial');

    // Reabrir no deshace el presupuesto; volver a vincular no duplica el PR y usa el sugerido por defecto
    client('aprobReset', s.id);
    var r = solBy('PR71524');
    deepEq([r.estado, r.anio, r.lineId, r.montoImputado, r.procesadoPor, r.procesado], ['Pendiente', '', '', 0, '', '']);
    eq(lineBy(bootstrap(), 2026, AUDIT).oc, 'Si', 'reabrir no toca la línea');
    client('aprobLink', s.id, { year: '2026', lineId: line.id, marcarOc: false });
    eq(solBy('PR71524').montoImputado, s.sugerido, 'monto por defecto = sugerido');
    eq(lineBy(bootstrap(), 2026, AUDIT).nota, 'PR71524', 'el PR no se repite');

    // Línea con nota previa: se agrega al final
    client('aprobReset', s.id);
    var ag = lineBy(bootstrap(), 2026, AGUADA);
    client('aprobLink', s.id, { year: 2026, lineId: ag.id, monto: 0 });
    eq(lineBy(bootstrap(), 2026, AGUADA).nota, ag.nota + ' · PR71524');
    eq(lineBy(bootstrap(), 2026, AGUADA).oc, ag.oc, 'sin marcarOc la OC no cambia');
    eq(solBy('PR71524').montoImputado, 0, 'monto 0 es válido');
  });

  test('v3 aprobsrv · aprobLink valida año, línea, monto y estado sin escribir nada', function () {
    need('aprobLink');
    fresh('setup');
    aribaMsg('ariba_PR71524_plain.txt');
    client('aprobScan');
    var s = solBy('PR71524');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    var sheetBefore = JSON.stringify(MOCK.values('Cuadre 2026'));
    var solBefore = JSON.stringify(MOCK.values('Solicitudes'));
    throws(function () { client('aprobLink', s.id, { year: 2031, lineId: line.id }); }, /No existe la pestaña "Cuadre 2031"/);
    throws(function () { client('aprobLink', s.id, { year: 1990, lineId: line.id }); }, /Año inválido/);
    throws(function () { client('aprobLink', s.id, { year: 2027, lineId: line.id }); }, /No encontré esa línea/);
    throws(function () { client('aprobLink', s.id, { year: 2026, lineId: '' }); }, /Elige la línea/);
    throws(function () { client('aprobLink', s.id, { year: 2026, lineId: line.id, monto: -5 }); }, /mayor o igual a cero/);
    throws(function () { client('aprobLink', s.id, { year: 2026, lineId: line.id, monto: 'mucho' }); }, /mayor o igual a cero/);
    throws(function () { client('aprobLink', 'SOL-00000000', { year: 2026, lineId: line.id }); }, /No encontré la solicitud/);
    throws(function () { client('aprobLink', s.id, null); }, /Año inválido/);
    eq(JSON.stringify(MOCK.values('Cuadre 2026')), sheetBefore, 'el presupuesto no cambió');
    eq(JSON.stringify(MOCK.values('Solicitudes')), solBefore, 'la solicitud no cambió');
    client('aprobLink', s.id, { year: 2026, lineId: line.id, monto: 1000 });
    throws(function () { client('aprobLink', s.id, { year: 2026, lineId: line.id }); }, /ya está vinculada/);
    throws(function () { client('aprobDiscard', s.id, ''); }, /ya está vinculada/);
    throws(function () { client('aprobNewLine', s.id, { year: 2026, area: 'cc' }); }, /ya está vinculada/);
  });

  test('v3 aprobsrv · aprobNewLine crea una línea "Fuera de POA" con el gasto y la vincula', function () {
    need('aprobNewLine');
    fresh('setup');
    aribaMsg('ariba_PR71524_plain.txt');
    aribaMsg('ariba_PR71899_plain.txt');
    client('aprobScan');
    var s = solBy('PR71524');
    var n2027 = bootstrap().budget['2027'].length;
    var nCrear = logsOf('Crear línea').length;
    var b = client('aprobNewLine', s.id, { year: 2027, area: 'cc', nota: 'Fuera de presupuesto' });
    eq(b.lastId, s.id);
    var v = solBy('PR71524');
    eq(v.estado, 'Nueva línea');
    eq(v.anio, '2027');
    ok(/^L-[0-9a-f]{8}$/.test(v.lineId), 'línea nueva: ' + v.lineId);
    eq(v.montoImputado, s.sugerido, 'monto por defecto = sugerido');
    eq(v.nota, 'Fuera de presupuesto');
    eq(b.budget['2027'].length, n2027 + 1);
    var l = b.budget['2027'].find(function (x) { return x.id === v.lineId; });
    ok(l, 'la línea está en el bundle');
    deepEq([l.pilar, l.area, l.proj, l.clas, l.po, l.pf, l.pg, l.oc, l.nota],
      ['cc', 'Cambio Climatico', 'Piloto Green Energy en Transcom', 'Fuera de POA', 0, s.sugerido, 0, 'Si', 'PR71524 · GONZALO ALEJANDRO CORTES UARAC']);
    eq(logsOf('Solicitud a línea nueva').length, 1);
    eq(logsOf('Crear línea').length, nCrear + 1);
    // Con nombre propio y monto; validaciones
    var s2 = solBy('PR71899');
    throws(function () { client('aprobNewLine', s2.id, { year: 2027 }); }, /Elige el pilar/);
    throws(function () { client('aprobNewLine', s2.id, { year: 2031, area: 'nat' }); }, /No existe la pestaña/);
    eq(solBy('PR71899').estado, 'Pendiente', 'sigue pendiente tras el error');
    var b2 = client('aprobNewLine', s2.id, { year: 2026, area: 'Naturaleza', proj: '  Huella   hídrica  plantas ', monto: 4500000 });
    var l2 = b2.budget['2026'].find(function (x) { return x.id === solBy('PR71899').lineId; });
    eq(l2.proj, 'Huella hídrica plantas');
    eq(l2.pf, 4500000);
    eq(l2.pilar, 'nat');
  });

  test('v3 aprobsrv · aprobDiscard y aprobReset', function () {
    need('aprobDiscard', 'aprobReset');
    fresh('setup');
    aribaMsg('ariba_PR72010_plain.txt');
    client('aprobScan');
    var s = solBy('PR72010');
    throws(function () { client('aprobReset', s.id); }, /ya está pendiente/);
    client('aprobDiscard', s.id, 'No es de nuestros CeCos');
    var d = solBy('PR72010');
    deepEq([d.estado, d.nota, d.lineId, d.montoImputado, d.procesadoPor], ['Descartada', 'No es de nuestros CeCos', '', 0, U.gonzalo]);
    eq(logsOf('Descartar solicitud').length, 1);
    throws(function () { client('aprobDiscard', s.id, 'otra vez'); }, /ya está descartada/);
    client('aprobReset', s.id);
    var r = solBy('PR72010');
    deepEq([r.estado, r.procesadoPor, r.procesado], ['Pendiente', '', '']);
    eq(logsOf('Reabrir solicitud').length, 1);
    client('aprobDiscard', s.id);
    eq(solBy('PR72010').nota, '', 'motivo opcional');
    throws(function () { client('aprobDiscard', s.id + 'x'); }, /No encontré la solicitud/);
    throws(function () { client('aprobDiscard', s.id, new Array(2100).join('x')); }, /muy larga/);
    client('aprobReset', s.id);
    eq(solBy('PR72010').estado, 'Pendiente', 'reabrir una descartada');
  });

  test('v3 aprobsrv · sólo el administrador: cada función pública rechaza al resto', function () {
    need('aprobScan', 'aprobRead_');
    fresh('setup');
    aribaMsg('ariba_PR71524_plain.txt');
    client('aprobScan');
    var s = solBy('PR71524');
    var before = JSON.stringify(MOCK.values('Solicitudes'));
    var nTrig = MOCK.triggers().length;
    [U.ina, U.benja, ''].forEach(function (who) {
      asUser(who, function () {
        var re = /sólo para administradores/;
        throws(function () { client('aprobScan'); }, re, who + ' aprobScan');
        throws(function () { client('aprobLink', s.id, { year: 2026, lineId: 'L-00000000' }); }, re, who + ' aprobLink');
        throws(function () { client('aprobNewLine', s.id, { year: 2026, area: 'cc' }); }, re, who + ' aprobNewLine');
        throws(function () { client('aprobDiscard', s.id, 'x'); }, re, who + ' aprobDiscard');
        throws(function () { client('aprobReset', s.id); }, re, who + ' aprobReset');
        throws(function () { client('aprobInstall'); }, re, who + ' aprobInstall');
        throws(function () { client('aprobScanTrigger'); }, re, who + ' aprobScanTrigger');
        throws(function () { client('aprobScanTrigger', { triggerUid: '1234567' }); }, re, who + ' aprobScanTrigger con uid falso');
        deepEq(aprobRead_(ss_()), [], who + ' aprobRead_');
        var b = client('bootstrap');
        if ('solicitudes' in b) deepEq(b.solicitudes, [], who + ' bundle sin solicitudes');
      });
    });
    eq(JSON.stringify(MOCK.values('Solicitudes')), before, 'nada cambió');
    eq(MOCK.triggers().length, nTrig, 'sin activadores nuevos');
  });

  test('v3 aprobsrv · respuestas sin Date (google.script.run) y bundle con solicitudes', function () {
    need('aprobScan');
    fresh('setup');
    seed3();
    var b = client('aprobScan'); // client() ya serializa estricto: un Date haría fallar aquí
    assertNoDates(b, 'aprobScan');
    assertNoDates(aprobRead_(ss_()), 'aprobRead_');
    assertNoDates(aprobStatus_(), 'aprobStatus_');
    var s = solBy('PR71899');
    var line = lineBy(bootstrap(), 2026, AUDIT);
    assertNoDates(client('aprobLink', s.id, { year: 2026, lineId: line.id, marcarOc: true }), 'aprobLink');
    assertNoDates(client('aprobInstall'), 'aprobInstall');
    assertNoDates(aprobScanTrigger(), 'aprobScanTrigger');
    var st = client('getAdminStatus');
    if (st.aprob) assertNoDates(st.aprob, 'getAdminStatus.aprob');
  });

  test('v3 aprobsrv · aprobInstall es idempotente y el activador corre como su dueño', function () {
    need('aprobInstall', 'aprobScanTrigger', 'aprobStatus_');
    fresh('setup');
    ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'aprobScanTrigger'; })
      .forEach(function (t) { ScriptApp.deleteTrigger(t); }); // por si setup() ya lo instala
    eq(aprobStatus_().triggerInstalled, false);
    var b = client('aprobInstall');
    var b2 = client('aprobInstall');
    var tr = aprobTriggers();
    eq(tr.length, 1, 'un solo activador');
    eq(tr[0].cfg.everyDays, 1, 'una vez al día');
    eq(tr[0].cfg.atHour, CONFIG.APROB_SCAN_HOUR, 'a la hora CONFIG.APROB_SCAN_HOUR');
    ok(b.aprob.triggerInstalled && b2.aprob.triggerInstalled, 'estado en la respuesta');
    eq(b.aprobInstall.created, true);
    eq(b2.aprobInstall.created, false);
    eq(logsOf('Activar lectura Ariba').length, 1, 'se registra una vez');
    // Duplicados (p. ej. instalado dos veces a mano) → queda uno
    ScriptApp.newTrigger('aprobScanTrigger').timeBased().everyMinutes(5).create();
    client('aprobInstall');
    eq(aprobTriggers().length, 1, 'duplicados eliminados');
    // Hora inválida → 7; cambiar la hora reinstala el activador
    var prev = CONFIG.APROB_SCAN_HOUR;
    try {
      CONFIG.APROB_SCAN_HOUR = 99; eq(aprobHour_(), 7);
      CONFIG.APROB_SCAN_HOUR = 6; eq(aprobHour_(), 6);
      var r6 = client('aprobInstall');
      eq(r6.aprobInstall.created, true, 'otra hora → se reinstala');
      eq(aprobTriggers().length, 1);
      eq(aprobTriggers()[0].cfg.atHour, 6);
    } finally {
      CONFIG.APROB_SCAN_HOUR = prev;
      client('aprobInstall');
    }
    // El evento real del activador (triggerUid propio) se acepta aunque Google no entregue el correo
    aribaMsg('ariba_PR71524_plain.txt');
    var uid = aprobTriggers()[0].id;
    var r = asUser('', function () { return aprobScanTrigger({ triggerUid: uid, authMode: 'FULL' }); });
    eq(r.added, 1, 'el activador registró la solicitud');
    eq(MOCK.props().APROB_LAST_SCAN, r.at);
    // Hoja ocupada: no lanza, avisa en el estado y reintenta en la próxima vuelta
    MOCK.lockBusy = true;
    var busy = aprobScanTrigger({ triggerUid: uid });
    ok(/ocupada/.test(busy.error), 'error informado: ' + busy.error);
    ok(/ocupada/.test(aprobStatus_().lastResult.error));
    MOCK.lockBusy = false;
  });

  test('v3 aprobsrv · presSaveInLock_ guarda dentro de un lock ajeno y budgetSave delega en él', function () {
    need('presSaveInLock_', 'budgetSave');
    fresh('setup');
    var nCrear = logsOf('Crear línea').length;
    var r = withLock_(function () { return presSaveInLock_(2027, '', { area: 'ec', proj: 'Prueba en lock', pf: 1000, oc: 'Si' }); });
    ok(/^L-[0-9a-f]{8}$/.test(r.id), 'devuelve {id}');
    eq(Object.keys(r).join(','), 'id');
    var l = lineBy(bootstrap(), 2027, 'Prueba en lock');
    deepEq([l.id, l.pilar, l.clas, l.pf, l.oc, l.estado], [r.id, 'ec', 'POA', 1000, 'Si', 'En curso']);
    var r2 = withLock_(function () { return presSaveInLock_('2027', r.id, { pg: 1000 }); });
    eq(r2.id, r.id);
    eq(lineBy(bootstrap(), 2027, 'Prueba en lock').estado, 'Ejecutado');
    throws(function () { withLock_(function () { return presSaveInLock_(2027, 'L-00000000', { pg: 1 }); }); }, /No encontré esta línea/);
    // budgetSave: mismos errores antes del lock y mismo resultado
    throws(function () { budgetSave(1800, '', { proj: 'x' }); }, /Año inválido/);
    throws(function () { budgetSave(2027, '', { clas: 'Otra' }); }, /Clasificación inválida/);
    var b = client('budgetSave', 2027, '', { area: 'nat', proj: 'Vía budgetSave', pf: 500 });
    var l3 = lineBy(b, 2027, 'Vía budgetSave');
    eq(b.lastId, l3.id, 'lastId de la línea creada');
    eq(logsOf('Crear línea').length, nCrear + 2);
  });
})();
