/* v3 · banco de pruebas — GmailApp simulado (lectura): search, hilos, mensajes, fallas y aislamiento entre pruebas */
(function () {
  function ago(h) { return new Date(Date.now() - h * 3600000); }

  test('v3 aprobsrv · GmailApp simulado: search por remitente, antigüedad, hilos y paginación', function () {
    eq(MOCK.gmail.messages.length, 0, 'cada prueba parte con el buzón vacío');
    var a1 = MOCK.gmail.add({ from: '"Ariba" <buyer@ariba.com>', subject: 'Solicitud de compra A', plainBody: 'uno', date: ago(30) });
    var a2 = MOCK.gmail.add({ from: 'Buyer@Ariba.com', threadId: a1.threadId, subject: 'Re: Solicitud de compra A', plainBody: 'dos', date: ago(2) });
    var b1 = MOCK.gmail.add({ from: 'buyer@ariba.com', subject: 'Solicitud de compra B', plainBody: 'tres', date: ago(10), htmlBody: '<b>tres</b>' });
    MOCK.gmail.add({ from: 'buyer@ariba.com', subject: 'Muy antigua', plainBody: 'x', date: ago(24 * 200) });
    MOCK.gmail.add({ from: 'otra@copec.cl', subject: 'Solicitud de compra C', plainBody: 'x', date: ago(1) });
    ok(/^[0-9a-f]{16}$/.test(a1.id), 'id hexadecimal de 16: ' + a1.id);

    var th = GmailApp.search('from:(buyer@ariba.com) newer_than:120d', 0, 50);
    eq(th.length, 2, 'dos hilos (la antigua y la de otro remitente no calzan)');
    eq(th[0].getId(), a1.threadId, 'el hilo con el mensaje más nuevo primero');
    var msgs = th[0].getMessages();
    deepEq(msgs.map(function (m) { return m.getPlainBody(); }), ['uno', 'dos'], 'mensajes del hilo por fecha ascendente');
    eq(msgs[1].getId(), a2.id);
    ok(msgs[0].getDate() instanceof Date, 'getDate → Date');
    eq(msgs[0].getDate().getTime(), a1.date.getTime());
    eq(msgs[1].getFrom(), 'Buyer@Ariba.com');
    eq(msgs[1].getThread().getId(), a1.threadId);
    eq(th[1].getMessages()[0].getBody(), '<b>tres</b>');
    ok(/^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\//.test(th[0].getPermalink()), 'permalink');
    eq(GmailApp.search('from:buyer@ariba.com newer_than:120d', 1, 50).length, 1, 'start');
    eq(GmailApp.search('from:buyer@ariba.com', 0, 1).length, 1, 'max');
    eq(GmailApp.search('from:buyer@ariba.com').length, 3, 'sin límite de antigüedad');
    eq(GmailApp.search('subject:(compra B)', 0, 10).length, 1, 'subject:');
    eq(GmailApp.search('"compra c"', 0, 10).length, 1, 'frase');
    eq(GmailApp.search('from:buyer@ariba.com older_than:100d', 0, 10).length, 1, 'older_than');
    eq(GmailApp.getMessageById(b1.id).getSubject(), 'Solicitud de compra B');
    eq(GmailApp.getThreadById('no-existe'), null);
    eq(MOCK.gmail.searches[0].query, 'from:(buyer@ariba.com) newer_than:120d');
    throws(function () { GmailApp.search('x', 0, 501); }, /cannot be greater than 500/);
    throws(function () { GmailApp.search(null); }, /don't match the method signature/);
  });

  test('v3 aprobsrv · GmailApp simulado: fallas por mensaje, error de búsqueda y snapshot/restore', function () {
    eq(MOCK.gmail.messages.length, 0, 'lo agregado en otra prueba no se filtra');
    var m = MOCK.gmail.add({ from: 'a@b.cl', subject: 's', plainBody: 'p', fail: 'getPlainBody' });
    var msg = GmailApp.search('from:a@b.cl')[0].getMessages()[0];
    eq(msg.getSubject(), 's');
    throws(function () { msg.getPlainBody(); }, /No se pudo leer el mensaje/);
    m.fail = ['getFrom', 'getBody'];
    throws(function () { msg.getFrom(); }, /getFrom/);
    eq(msg.getPlainBody(), 'p');
    MOCK.gmail.searchError = 'Exception: Gmail no disponible';
    throws(function () { GmailApp.search('x'); }, /Gmail no disponible/);
    MOCK.clearBuffers();
    eq(MOCK.gmail.searchError, null, 'clearBuffers limpia el error simulado');
    var snap = MOCK.snapshot();
    MOCK.gmail.add({ from: 'c@d.cl', subject: 'otro', date: '2026-10-01T12:00:00.000Z' });
    eq(MOCK.gmail.messages.length, 2);
    ok(MOCK.gmail.messages[1].date === '2026-10-01T12:00:00.000Z', 'fecha ISO aceptada');
    eq(GmailApp.search('from:c@d.cl')[0].getMessages()[0].getDate().toISOString(), '2026-10-01T12:00:00.000Z');
    MOCK.restore(snap);
    eq(MOCK.gmail.messages.length, 1, 'restore devuelve el buzón del snapshot');
    MOCK.reset();
    eq(MOCK.gmail.messages.length, 0, 'reset vacía el buzón');
  });
})();
