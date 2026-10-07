/* v3.6 (SPEC §20) · servidor: una tarea con varias personas (siempre pública), avisos para todas y Gmail activado. */
(function () {
  function task(b, id) { var t = (b.tasks || []).find(function (x) { return x.id === id; }); ok(t, 'no encontré la tarea ' + id); return t; }
  function rowOf(id) { return gRows('Tarea').find(function (r) { return r.ID === id; }); }

  test('v3.6 personas · gSave con varias personas: se guardan, la tarea queda pública y el Historial lo cuenta', function () {
    need('gSave', 'bootstrap');
    fresh('setup');
    var r = asUser(U.gonzalo, function () {
      return client('gSave', { tipo: 'Tarea', nombre: 'Entre varios', resp: U.gonzalo, asignados: [U.ina, U.benja, U.ina, U.gonzalo], privada: true });
    });
    var t = task(r, r.lastId);
    eq(t.resp, U.gonzalo);
    deepEq(t.asignados, [U.ina, U.benja], 'sin repetidos ni el responsable');
    eq(t.privada, false, 'con varias personas siempre es pública (aunque se pida privada)');
    eq(String(rowOf(r.lastId).Asignados), U.ina + ', ' + U.benja, 'columna Asignados');
    includes(rowsOf('Historial').slice(-1)[0].Detalle, 'También: Ina, Benja');
    // Sin responsable: la primera persona pasa a serlo
    var r2 = client('gSave', { tipo: 'Tarea', nombre: 'Sin responsable', resp: '', asignados: U.ignacio + ', ' + U.ina });
    var t2 = task(r2, r2.lastId);
    eq(t2.resp, U.ignacio); deepEq(t2.asignados, [U.ina]);
  });

  test('v3.6 personas · sólo correos del equipo; edición parcial; sin nadie más se puede volver a privada', function () {
    fresh('setup');
    throws(function () { client('gSave', { tipo: 'Tarea', nombre: 'X', resp: U.gonzalo, asignados: ['externo@gmail.com'] }); }, /no es parte del equipo/);
    throws(function () { client('gSave', { tipo: 'Tarea', nombre: 'X', resp: U.gonzalo, asignados: ['no-es-correo'] }); }, /correos válidos/);
    var id = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', nombre: 'Mía', resp: U.gonzalo, privada: true }).lastId; });
    var b = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', id: id, asignados: [U.ina] }); });
    deepEq(task(b, id).asignados, [U.ina]); eq(task(b, id).privada, false, 'agregar a alguien la hace pública');
    eq(task(b, id).nombre, 'Mía', 'edición parcial: lo demás se conserva');
    b = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', id: id, asignados: [] }); });
    deepEq(task(b, id).asignados, []); eq(task(b, id).privada, false, 'quitar a todos no la vuelve privada sola');
    b = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', id: id, privada: true }); });
    eq(task(b, id).privada, true, 'sin nadie más, puede volver a ser privada');
  });

  test('v3.6 personas · la ven todas sus personas; «privada en grupo» la salta', function () {
    need('tasksSetPrivacy');
    fresh('setup');
    ok(gTaskVisible_({ privada: true, creadoPor: U.gonzalo, resp: U.gonzalo, asignados: [U.ina] }, U.ina), 'una persona asignada ve la tarea');
    ok(!gTaskVisible_({ privada: true, creadoPor: U.gonzalo, resp: U.gonzalo, asignados: [U.ina] }, U.benja), 'otra no (si fuera privada)');
    var a = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', nombre: 'Grupo', resp: U.gonzalo, asignados: [U.ina] }).lastId; });
    var s = asUser(U.gonzalo, function () { return client('gSave', { tipo: 'Tarea', nombre: 'Sola', resp: U.gonzalo, privada: false }).lastId; });
    var b = asUser(U.gonzalo, function () { return client('tasksSetPrivacy', [a, s], true); });
    eq(task(b, a).privada, false, 'la de varias personas sigue pública');
    eq(task(b, s).privada, true, 'la de una persona pasa a privada');
    ok(asUser(U.ina, function () { return client('bootstrap'); }).tasks.some(function (t) { return t.id === a; }), 'Ina la ve');
  });

  test('v3.6 personas · el aviso de vencida llega a cada persona, una sola vez', function () {
    need('notifDaily');
    fresh('setup');
    var id = asUser(U.gonzalo, function () {
      return client('gSave', { tipo: 'Tarea', nombre: 'Vencida en grupo', resp: U.gonzalo, asignados: [U.ina, U.benja], fecha: day(-1) }).lastId;
    });
    MOCK.clearBuffers();
    notifDaily();
    var to = MOCK.mails.map(function (m) { return m.to; }).sort();
    deepEq(to, [U.benja, U.gonzalo, U.ina].sort(), 'un correo a cada persona');
    includes(MOCK.mails[0].body, 'Vencida en grupo');
    ok(/Personas: /.test(MOCK.mails[0].htmlBody), 'el correo nombra a las personas');
    eq(String(rowOf(id).Notificado), day(-1) + ':0', 'una marca para todas');
    MOCK.clearBuffers();
    notifDaily();
    eq(MOCK.mails.length, 0, 'no se repite');
    var r = asUser(U.ina, function () { return sendTestDigest(); });
    eq(r.count, 1, 'Ina la ve en su resumen de vencidas');
  });

  test('v3.6 config · Gmail activado y Drive apagado; el manifiesto pide Gmail y no Drive', function () {
    var src = readText('apps-script/Code.gs');
    ok(/DRIVE: false,/.test(src) && /GMAIL: true,/.test(src), 'CONFIG.FEATURES en Code.gs: DRIVE false, GMAIL true');
    var m = JSON.parse(readText('apps-script/appsscript.json'));
    ok(m.oauthScopes.indexOf('https://mail.google.com/') >= 0, 'permiso de Gmail (el único que acepta GmailApp)');
    ok(!m.oauthScopes.some(function (s) { return /auth\/drive/.test(s); }), 'sin permisos de Drive');
    eq(m.webapp.access, 'DOMAIN', 'la app sigue sólo para Copec');
  });
})();
