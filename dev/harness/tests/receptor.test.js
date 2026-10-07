/* Receptor de WhatsApp (bot-whatsapp/ReceptorWhatsApp.gs): proyecto Apps Script APARTE de la app.
   Se carga aislado (tiene su propio doGet/doPost) y se prueba de punta a punta con la app: Meta → bandeja → tarea. */
(function () {
  var NUM = { gonzalo: '56911111111', ina: '56922222222' };
  var PNID = '1189588840906084';

  function rx() {
    var src = readFile((__drv.root ? __drv.root + '/' : '') + 'bot-whatsapp/ReceptorWhatsApp.gs');
    return new Function(src + '\n;return { doGet: doGet, doPost: doPost, probarReceptor: probarReceptor, rxDigits_: rxDigits_ };')();
  }
  function setup(extra) {
    fresh('setup');
    var sh = MOCK.sheet('WhatsApp contactos');
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var email = String(v[i][1]).toLowerCase();
      if (email === U.gonzalo) sh.getRange(i + 1, 1).setValue(NUM.gonzalo);
      if (email === U.ina) sh.getRange(i + 1, 1).setValue('+56 9 2222 2222');
    }
    var props = PropertiesService.getScriptProperties();
    ['SHEET_ID', 'PHONE_NUMBER_ID', 'VERIFY_TOKEN', 'URL_KEY', 'WA_TOKEN'].forEach(function (k) { props.deleteProperty(k); });
    props.setProperty('SHEET_ID', MOCK.spreadsheet().getId());
    props.setProperty('PHONE_NUMBER_ID', PNID);
    Object.keys(extra || {}).forEach(function (k) { props.setProperty(k, extra[k]); });
    return rx();
  }
  function payload(messages, pnid) {
    return JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '56962648291', phone_number_id: pnid || PNID },
      contacts: messages.map(function (m) { return { profile: { name: m.name || 'Persona' }, wa_id: m.from }; }), messages: messages } }] }] });
  }
  function txt(id, from, body) { return { id: id, from: from, timestamp: '1759676400', type: 'text', text: { body: body } }; }
  function post(R, body, k) { return R.doPost({ parameter: { k: k }, postData: { contents: body, type: 'application/json' } }); }
  function inbox() { return rowsOf('WhatsApp'); }

  test('receptor · prueba de conexión de Meta: clave de URL + token correctos → challenge', function () {
    var R = setup({ VERIFY_TOKEN: 'tareas-abc', URL_KEY: 'k123' });
    eq(R.doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tareas-abc', 'hub.challenge': '5550', k: 'k123' } }).getContent(), '5550');
    eq(R.doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tareas-abc', 'hub.challenge': '5550', k: 'otra' } }).getContent(), 'Token incorrecto');
    eq(R.doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': 'mal', 'hub.challenge': '5550', k: 'k123' } }).getContent(), 'Token incorrecto');
    eq(R.doGet({ parameter: {} }).getContent(), 'Receptor de tareas: funcionando.');
    var pol = R.doGet({ parameter: { pagina: 'privacidad' } }).getContent();
    ok(/Política de privacidad/.test(pol) && /Eliminación de datos/.test(pol), 'página de privacidad pública');
  });

  test('receptor · probarReceptor crea VERIFY_TOKEN y URL_KEY y revisa planilla y números', function () {
    var R = setup();
    var r = R.probarReceptor();
    ok(r.ok, r.lines.join(' | '));
    ok(/^tareas-/.test(r.verifyToken) && r.urlKey.length === 40, 'claves creadas');
    eq(PropertiesService.getScriptProperties().getProperty('URL_KEY'), r.urlKey, 'guardadas');
    ok(r.lines.some(function (l) { return /2 números del equipo/.test(l); }), '2 números');
    ok(r.lines.some(function (l) { return l.indexOf('?k=' + r.urlKey) >= 0; }), 'muestra la URL para Meta');
    var r2 = R.probarReceptor();
    eq(r2.urlKey, r.urlKey, 'no cambia las claves al repetir');
    PropertiesService.getScriptProperties().deleteProperty('SHEET_ID');
    ok(!R.probarReceptor().ok, 'sin SHEET_ID avisa');
  });

  test('receptor · sin la clave de la URL no escribe nada', function () {
    var R = setup({ URL_KEY: 'k123' });
    post(R, payload([txt('wamid.1', NUM.gonzalo, 'hola')]), 'mala');
    post(R, payload([txt('wamid.1', NUM.gonzalo, 'hola')]), undefined);
    eq(inbox().length, 0);
  });

  test('receptor · de punta a punta: fila en la bandeja → la app crea la tarea privada de quien escribió', function () {
    var R = setup({ URL_KEY: 'k123' });
    var res = post(R, payload([txt('wamid.A', NUM.gonzalo, 'Enviar informe a la fundación mañana')]), 'k123');
    eq(res.getContent(), 'ok');
    var rows = inbox();
    eq(rows.length, 1);
    eq(String(rows[0]['Número']), NUM.gonzalo);
    eq(rows[0]['Texto'], 'Enviar informe a la fundación mañana');
    eq(rows[0]['Estado'], 'Nueva');
    var b = asUser(U.gonzalo, function () { return client('bootstrap'); });
    var t = b.tasks.find(function (x) { return x.nombre === 'Enviar informe a la fundación'; });
    ok(t && t.privada && t.resp === U.gonzalo && t.fecha === day(1), 'tarea creada: privada, de Gonzalo, para mañana');
    eq(inbox()[0]['Estado'], 'Importada');
  });

  test('receptor · reenvío de Meta, número ajeno, otro número del bot e imagen', function () {
    var R = setup({ URL_KEY: 'k123' });
    var body = payload([txt('wamid.R', NUM.gonzalo, 'Llamar a Kilimo')]);
    post(R, body, 'k123');
    post(R, body, 'k123');                                                     // Meta reintenta el mismo aviso
    post(R, payload([txt('wamid.Z', '56999999999', 'spam')]), 'k123');           // no es del equipo
    post(R, payload([txt('wamid.O', NUM.gonzalo, 'otro bot')], '999'), 'k123'); // otro número de la cuenta de Meta
    post(R, payload([{ id: 'wamid.I', from: '56922222222', timestamp: '1759676400', type: 'image', image: { id: 'x' } }]), 'k123');
    post(R, JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, statuses: [{ id: 'wamid.R', status: 'read' }] } }] }] }), 'k123');
    var rows = inbox();
    deepEq(rows.map(function (r) { return r['Mensaje ID']; }), ['wamid.R', 'wamid.I'], 'sin repetir, sin ajenos');
    eq(rows[1]['Nota'], 'Tipo no soportado: image');
  });

  test('receptor · texto con fórmula queda como texto y llega igual a la app', function () {
    var R = setup({ URL_KEY: 'k123' });
    post(R, payload([txt('wamid.F', NUM.gonzalo, '=IMPORTXML("https://x","//a") revisar')]), 'k123');
    var sh = MOCK.sheet('WhatsApp');
    ok(!sh.getRange(2, 1, 1, sh.getLastColumn()).getFormulas()[0].some(function (f) { return !!f; }), 'ninguna fórmula en la bandeja');
    var b = asUser(U.gonzalo, function () { return client('bootstrap'); });
    ok(b.tasks.some(function (t) { return t.nombre === '=IMPORTXML("https://x","//a") revisar'; }), 'texto exacto en la tarea');
  });

  test('receptor · con WA_TOKEN marca como leído (✓✓) y nunca envía mensajes; sin token no llama a Meta', function () {
    var calls = [];
    var R = setup({ URL_KEY: 'k123', WA_TOKEN: 'EAAG-token' }); // setup() reinicia el simulador: lo de abajo va después
    var wl = MOCK.urlWhitelist;
    MOCK.urlWhitelist = []; // el receptor es otro proyecto: no tiene la lista de URLs permitidas de la app
    MOCK.fetchHandler = function (url, opts) { calls.push({ url: url, opts: opts }); return { code: 200, body: '{"success":true}' }; };
    try {
      post(R, payload([txt('wamid.T', NUM.gonzalo, 'Con check azul')]), 'k123');
      eq(calls.length, 1);
      eq(calls[0].url, 'https://graph.facebook.com/v25.0/' + PNID + '/messages');
      deepEq(JSON.parse(calls[0].opts.payload), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.T' });
      ok(!/"type"/.test(calls[0].opts.payload), 'no es un mensaje (costo 0)');
      calls.length = 0;
      PropertiesService.getScriptProperties().deleteProperty('WA_TOKEN');
      post(R, payload([txt('wamid.U', NUM.gonzalo, 'Sin check azul')]), 'k123');
      eq(calls.length, 0);
    } finally {
      MOCK.fetchHandler = null;
      MOCK.urlWhitelist = wl;
    }
  });

  test('receptor · si la planilla no está disponible, falla para que Meta reintente', function () {
    var R = setup({ URL_KEY: 'k123', SHEET_ID: 'otra-planilla-sin-acceso' });
    throws(function () { post(R, payload([txt('wamid.X', NUM.gonzalo, 'algo')]), 'k123'); });
  });
})();
