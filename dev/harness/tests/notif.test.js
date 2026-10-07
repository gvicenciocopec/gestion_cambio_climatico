/* Notificaciones · v3.3 (SPEC §17): un solo correo cuando una tarea VENCE (fecha anterior a hoy), en la revisión diaria */
(function () {
  function task(resp, offset, nombre, extra) {
    return gSave(Object.assign({ tipo: 'Tarea', pilar: 'nat', nombre: nombre, resp: resp, fecha: offset == null ? '' : day(offset) }, extra || {})).lastId;
  }
  function mailsTo(email) { return MOCK.mails.filter(function (m) { return m.to.split(',').indexOf(email) >= 0; }); }
  function text(m) { return m.subject + '\n' + m.body + '\n' + m.htmlBody; }
  function rowOf(id) { return gRows('Tarea').find(function (r) { return r.ID === id; }); }
  function marker(id) { return String(rowOf(id).Notificado || ''); }
  function setCell(id, header, value) { MOCK.sheet('Gestión').getRange(rowOf(id)._row, G_HEADERS.indexOf(header) + 1).setValue(value); }
  function dateCell(ymd) { return MOCK.wallToDate(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), 0, 0, 0, 'America/Santiago'); }
  // Simula que pasó el tiempo: la tarea vence en `n` días y la marca guardada sigue siendo la de su fecha
  function shiftDue(id, n) {
    var old = marker(id);
    var prev = Utilities.formatDate(rowOf(id).Fecha, 'America/Santiago', 'yyyy-MM-dd');
    setCell(id, 'Fecha', dateCell(day(n)));
    if (old) setCell(id, 'Notificado', old.replace(prev, day(n)));
  }

  test('notificaciones · un correo por persona sólo con sus tareas vencidas, sin reenvío', function () {
    need('notifDaily', 'gSave', 'taskComplete');
    fresh('setup');
    task(U.ina, -1, 'Ina venció ayer');
    task(U.ina, -6, 'Ina vencida hace días');
    task(U.ina, 0, 'Ina vence hoy');
    task(U.ina, 1, 'Ina mañana');
    task(U.benja, -2, 'Benja vencida');
    task(U.ignacio, 5, 'Ignacio lejos');
    task('', -1, 'Sin responsable');
    task(U.ignacio, null, 'Ignacio sin fecha');
    task(U.gonzalo, -3, 'Gonzalo sin aviso', { avisar: false });
    var done = task(U.gonzalo, -1, 'Gonzalo realizada');
    taskComplete(done, { cierre: 'ok' });
    eq(MOCK.mails.length, 0, 'guardar tareas no envía correos');
    notifDaily();
    eq(MOCK.mails.length, 2, 'un correo para Ina y otro para Benja: ' + MOCK.mails.map(function (m) { return m.to; }).join(', '));
    var ina = mailsTo(U.ina);
    eq(ina.length, 1, 'Ina recibe UN correo');
    ['Ina venció ayer', 'Ina vencida hace días'].forEach(function (t) { includes(text(ina[0]), t, 'incluye "' + t + '"'); });
    ['Ina vence hoy', 'Ina mañana', 'Benja vencida'].forEach(function (t) { ok(text(ina[0]).indexOf(t) < 0, 'no incluye "' + t + '"'); });
    includes(ina[0].subject, '2 tareas vencidas', 'asunto con el total');
    eq(mailsTo(U.benja)[0].subject, '[' + CONFIG.APP_NAME + '] Venció: Benja vencida', 'asunto de una sola tarea');
    ok(!mailsTo(U.ignacio).length && !mailsTo(U.gonzalo).length, 'Ignacio y Gonzalo no reciben');
    ina.concat(mailsTo(U.benja)).forEach(function (m) {
      ok(m.htmlBody.length > 50 && m.body.length > 20, 'HTML y texto plano');
      includes(m.body, 'una sola vez', 'el pie explica que es un solo aviso');
    });
    MOCK.clearBuffers();
    notifDaily();
    eq(MOCK.mails.length, 0, 'la segunda corrida no reenvía');
  });

  test('notificaciones · avisa una vez cuando pasa la fecha: no antes, no el mismo día, no después', function () {
    fresh('setup');
    var id = task(U.ina, 1, 'Informe');
    notifDaily();
    eq(MOCK.mails.length, 0, 'vence mañana: nada');
    shiftDue(id, 0);
    notifDaily();
    eq(MOCK.mails.length, 0, 'vence hoy: nada');
    shiftDue(id, -1);
    notifDaily();
    eq(mailsTo(U.ina).length, 1, 'al día siguiente del vencimiento: un aviso');
    includes(mailsTo(U.ina)[0].body, 'Esta tarea venció ayer.');
    eq(marker(id), day(-1) + ':0', 'marca con la fecha de la tarea');
    shiftDue(id, -2);
    shiftDue(id, -9);
    MOCK.clearBuffers();
    notifDaily();
    eq(MOCK.mails.length, 0, 'los días siguientes no se repite');
  });

  test('notificaciones · marcas de versiones anteriores: "0" ya avisó; "3" o de otra fecha sí avisan al vencer', function () {
    fresh('setup');
    var a = task(U.ina, -2, 'Ya avisada');
    var b = task(U.ina, -1, 'Sólo aviso previo');
    var c = task(U.benja, -1, 'Marca de otra fecha');
    setCell(a, 'Notificado', day(-2) + ':3,0');
    setCell(b, 'Notificado', day(-1) + ':3');
    setCell(c, 'Notificado', day(4) + ':3,0');
    notifDaily();
    eq(MOCK.mails.length, 2, 'Ina y Benja');
    ok(text(mailsTo(U.ina)[0]).indexOf('Ya avisada') < 0, 'la marca "0" antigua no se reenvía');
    includes(text(mailsTo(U.ina)[0]), 'Sólo aviso previo');
    eq(marker(b), day(-1) + ':3,0', 'conserva la marca previa y agrega la de vencida');
    eq(marker(c), day(-1) + ':0', 'una marca de otra fecha no cuenta');
  });

  test('notificaciones · sin cuota de correo no marca (se reintenta otro día)', function () {
    fresh('setup');
    var id = task(U.benja, -1, 'Cuota');
    MOCK.mailQuota = 0;
    notifDaily();
    eq(MOCK.mails.length, 0);
    eq(marker(id), '', 'sin marca si no se envió');
    MOCK.mailQuota = 100;
    notifDaily();
    eq(MOCK.mails.length, 1, 'se envía cuando vuelve la cuota');
  });

  test('notificaciones · el correo escapa los textos de la tarea', function () {
    fresh('setup');
    task(U.ina, -1, '<img src=x onerror=alert(1)> & "comillas"', { detalle: '<script>alert(2)</script>' });
    notifDaily();
    var m = mailsTo(U.ina)[0];
    ok(m, 'correo enviado');
    ok(m.htmlBody.indexOf('<img src=x') < 0 && m.htmlBody.indexOf('<script>alert') < 0, 'HTML escapado');
  });

  test('notificaciones · el correo incluye el link a la app', function () {
    fresh('setup');
    task(U.ina, -1, 'Con link');
    notifDaily();
    includes(mailsTo(U.ina)[0].htmlBody, MOCK.serviceUrl, 'botón/link a la app web');
  });

  test('notificaciones · sendTestDigest envía a quien lo pide sólo sus tareas vencidas', function () {
    need('sendTestDigest');
    fresh('setup');
    task(U.ina, -1, 'Mía vencida');
    task(U.ina, 1, 'Mía futura');
    task(U.benja, -1, 'De Benja');
    var marks0 = gRows('Tarea').map(function (x) { return String(x.Notificado || ''); }).join('|');
    var r = asUser(U.ina, function () { return client('sendTestDigest'); });
    eq(r.sent, true); eq(r.to, U.ina); eq(r.count, 1);
    eq(MOCK.mails.length, 1); eq(MOCK.mails[0].to, U.ina);
    includes(text(MOCK.mails[0]), 'Mía vencida');
    ok(text(MOCK.mails[0]).indexOf('Mía futura') < 0, 'no incluye las que aún no vencen');
    var r2 = asUser(U.ignacio, function () { return sendTestDigest(); });
    eq(r2.count, 0, 'sin tareas igual envía (estás al día)');
    eq(MOCK.mails[1].subject, '[' + CONFIG.APP_NAME + '] Sin tareas vencidas');
    asUser('', function () { throws(function () { sendTestDigest(); }, /correo/i, 'sin correo identificado'); });
    eq(gRows('Tarea').map(function (x) { return String(x.Notificado || ''); }).join('|'), marks0, 'sendTestDigest no toca las marcas');
  });

  test('notificaciones · installTrigger idempotente y sólo administradores', function () {
    need('installTrigger');
    fresh('setup');
    var mine = function () { return MOCK.triggers().filter(function (t) { return t.handler === 'notifDaily'; }); };
    eq(mine().length, 1, 'setup() instaló un activador');
    var t = mine()[0];
    eq(t.cfg.atHour, CONFIG.NOTIFY_HOUR, 'hora'); eq(t.cfg.everyDays, 1, 'diario'); eq(t.cfg.tz, 'America/Santiago', 'zona');
    deepEq(client('installTrigger'), { installed: true });
    installTrigger();
    eq(mine().length, 1, 'no duplica');
    asUser(U.ina, function () { throws(function () { installTrigger(); }, /administrador/i); });
  });

  test('notificaciones · hoja ocupada: notifDaily reintenta y falla con mensaje claro', function () {
    fresh('setup');
    task(U.ina, -1, 'Lock');
    MOCK.lockBusy = true;
    throws(function () { notifDaily(); }, /ocupad/i);
    ok(MOCK.stats.sleepMs > 0, 'esperó antes de reintentar');
    eq(MOCK.mails.length, 0);
  });

  test('notificaciones · notifDaily sin pestaña Gestión no falla', function () {
    fresh('raw');
    var r = notifDaily();
    eq(MOCK.mails.length, 0);
    ok(r && typeof r === 'object', 'devuelve un resumen');
  });
})();
