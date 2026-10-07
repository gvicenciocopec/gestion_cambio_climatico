/* Bandeja de WhatsApp (WhatsApp.gs): el receptor externo agrega filas; la app las convierte en tareas. */
(function () {
  var NUM = { gonzalo: '56911111111', ina: '56922222222' };

  function setContacts() {
    var sh = MOCK.sheet('WhatsApp contactos');
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var email = String(v[i][1]).toLowerCase();
      if (email === U.gonzalo) sh.getRange(i + 1, 1).setValue('+56 9 1111 1111'); // con formato humano
      if (email === U.ina) sh.getRange(i + 1, 1).setValue(NUM.ina);
    }
  }
  // Lo que escribe el receptor (Cloudflare Worker) con valueInputOption=RAW: el texto nunca se interpreta como
  // fórmula. En el simulador eso equivale a anteponer el apóstrofo de "texto literal".
  function raw(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
  function inbox(rows) {
    var sh = MOCK.sheet('WhatsApp');
    rows.forEach(function (r) { sh.appendRow([r.at || new Date().toISOString(), r.id, r.num, raw(r.name || ''), raw(r.text), '', '', r.note || '']); });
  }
  function inboxRows() { return rowsOf('WhatsApp'); }
  function taskByName(name) { return gRows('Tarea').find(function (r) { return String(r.Nombre) === name; }); }

  test('whatsapp · setup crea "WhatsApp" (oculta) y "WhatsApp contactos" con el equipo', function () {
    need('waEnsureSheets_', 'waImport_');
    fresh('setup');
    var inb = MOCK.sheet('WhatsApp'), con = MOCK.sheet('WhatsApp contactos');
    ok(inb && con, 'pestañas creadas');
    deepEq(inb.getDataRange().getValues()[0], WA_INBOX_HEADERS);
    eq(inb.isSheetHidden(), true, 'la bandeja queda oculta');
    var emails = rowsOf('WhatsApp contactos').map(function (r) { return r['Correo']; });
    deepEq(emails, CONFIG.USERS.map(function (u) { return u.email; }));
    // re-ejecutar setup no duplica
    client('setup');
    eq(rowsOf('WhatsApp contactos').length, CONFIG.USERS.length);
  });

  test('whatsapp · importa al abrir la app: a nombre de quien escribió, privada, con fecha, sin duplicados', function () {
    fresh('setup');
    setContacts();
    inbox([
      { id: 'wamid.A', num: NUM.gonzalo, name: 'Gonzalo', text: 'Tarea: Enviar informe a la fundación mañana' },
      { id: 'wamid.B', num: NUM.ina, name: 'Ina', text: 'Revisar contrato para el 15/10' },
      { id: 'wamid.C', num: '56999999999', name: 'Desconocido', text: 'compra criptomonedas' },
      { id: 'wamid.A', num: NUM.gonzalo, name: 'Gonzalo', text: 'Tarea: Enviar informe a la fundación mañana' },
      { id: 'wamid.D', num: NUM.ina, name: 'Ina', text: '', note: 'Tipo no soportado: image' },
    ]);
    var b = asUser(U.gonzalo, function () { return client('bootstrap'); });
    assertNoDates(b);
    var a = taskByName('Enviar informe a la fundación');
    ok(a, 'tarea de Gonzalo creada (sin el prefijo "Tarea:")');
    eq(String(a.Responsable).toLowerCase(), U.gonzalo);
    eq(String(a['Creado por']).toLowerCase(), U.gonzalo);
    eq(dateStr_(a.Fecha), day(1), 'mañana');
    ok(/^s[ií]$/i.test(String(a.Privada)) || a.Privada === true, 'privada');
    var bt = taskByName('Revisar contrato');
    ok(bt, 'tarea de Ina creada');
    eq(String(bt.Responsable).toLowerCase(), U.ina);
    ok(/^\d{4}-10-15$/.test(dateStr_(bt.Fecha)), '15/10');
    // privacidad: Gonzalo no ve la de Ina; Ina sí
    ok(!b.tasks.some(function (t) { return t.nombre === 'Revisar contrato'; }), 'la tarea privada de Ina no le llega a Gonzalo');
    ok(b.tasks.some(function (t) { return t.nombre === 'Enviar informe a la fundación' && t.privada; }), 'Gonzalo ve la suya, privada');
    var bi = asUser(U.ina, function () { return client('bootstrap'); });
    ok(bi.tasks.some(function (t) { return t.nombre === 'Revisar contrato'; }), 'Ina ve la suya');
    // estados en la bandeja
    var st = inboxRows().map(function (r) { return r['Estado']; });
    deepEq(st, ['Importada', 'Importada', 'Ignorada', 'Duplicada', 'Ignorada']);
    var rows = inboxRows();
    ok(/^TSK-/.test(String(rows[0]['Tarea'])) && rows[3]['Tarea'] === rows[0]['Tarea'], 'la duplicada apunta a la misma tarea');
    includes(String(rows[2]['Nota']), 'no registrado');
    eq(gRows('Tarea').filter(function (r) { return String(r.Nombre) === 'Enviar informe a la fundación'; }).length, 1, 'una sola tarea pese al mensaje repetido');
    // Historial: una línea de resumen
    ok(rowsOf('Historial').some(function (r) { return r['Acción'] === 'WhatsApp' && /2 tareas creadas/.test(String(r['Detalle'])); }), 'resumen en Historial');
    // idempotente
    var n = gRows('Tarea').length;
    asUser(U.gonzalo, function () { client('bootstrap'); });
    eq(gRows('Tarea').length, n, 'abrir de nuevo no crea más');
    eq(me_(), U.gonzalo === MOCK.user ? U.gonzalo : MOCK.user, 'la identidad prestada se libera');
  });

  test('whatsapp · texto con fórmula o muy largo se guarda como texto; importar no envía correos', function () {
    fresh('setup');
    setContacts();
    var mails0 = MOCK.mails.length;
    var long = 'Coordinar ' + new Array(80).join('visita terreno ') + 'hoy';
    inbox([
      { id: 'wamid.F', num: NUM.gonzalo, text: '=HYPERLINK("https://example.com","clic") revisar' },
      { id: 'wamid.L', num: NUM.ina, text: long },
    ]);
    asUser(U.benja, function () { client('bootstrap'); }); // cualquier miembro que abra la app dispara la importación
    var bg = asUser(U.gonzalo, function () { return client('bootstrap'); });
    ok(bg.tasks.some(function (t) { return t.nombre === '=HYPERLINK("https://example.com","clic") revisar'; }), 'el texto con "=" llega tal cual a la app');
    var raw = gRows('Tarea').find(function (r) { return /HYPERLINK/.test(String(r.Nombre)); });
    ok(raw && !MOCK.sheet('Gestión').getRange(raw._row, 1, 1, MOCK.sheet('Gestión').getLastColumn()).getFormulas()[0].some(function (f) { return /HYPERLINK/i.test(f); }), 'en la planilla no quedó como fórmula');
    var l = gRows('Tarea').find(function (r) { return /^Coordinar visita/.test(String(r.Nombre)); });
    ok(l && String(l.Nombre).length <= 300 && String(l.Detalle).length > 300, 'nombre recortado y texto completo en el detalle');
    eq(dateStr_(l.Fecha), day(0), 'hoy');
    eq(MOCK.mails.length, mails0, 'sin correos al importar (sólo el aviso diario cuando vence, SPEC §17)');
    var hist = rowsOf('Historial').filter(function (r) { return r['Acción'] === 'Crear tarea'; });
    ok(hist.length >= 2 && hist.every(function (r) { return String(r['Usuario']).toLowerCase() !== U.benja; }), 'Historial a nombre de quien envió, no de quien abrió la app');
  });

  test('whatsapp · el aviso diario también importa; números sin 56 y correos que no son del equipo', function () {
    fresh('setup');
    var sh = MOCK.sheet('WhatsApp contactos');
    sh.appendRow(['922222222', 'externo@gmail.com', 'Externo']);   // no es del equipo → se ignora
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][1]).toLowerCase() === U.ignacio) sh.getRange(i + 1, 1).setValue('933333333'); // sin 56
    inbox([
      { id: 'wamid.X', num: '56933333333', text: 'Llamar a Kilimo el viernes' },
      { id: 'wamid.Y', num: '56922222222', text: 'algo' },
    ]);
    notifDaily();
    var t = taskByName('Llamar a Kilimo');
    ok(t, 'importada por el activador diario');
    eq(String(t.Responsable).toLowerCase(), U.ignacio);
    var r = inboxRows();
    eq(r[1]['Estado'], 'Ignorada', 'un correo fuera del equipo no crea tareas');
  });

  test('whatsapp · sin pestaña o sin filas nuevas no hace nada (rápido) y nunca falla la carga', function () {
    fresh('setup');
    var res = waImport_();
    deepEq(res, { imported: 0, ignored: 0, duplicated: 0, errors: 0 });
    MOCK.spreadsheet().deleteSheet(MOCK.sheet('WhatsApp'));
    var b = asUser(U.gonzalo, function () { return client('bootstrap'); });
    ok(b && b.tasks, 'la app carga igual');
  });
})();
