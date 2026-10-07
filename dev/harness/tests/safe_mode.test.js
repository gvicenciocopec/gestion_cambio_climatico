/* Modo seguro (CONFIG.FEATURES): sin Drive ni Gmail la app no llama a DriveApp / GmailApp y lo informa al cliente. */
(function () {
  function safe(fn) {
    var prev = CONFIG.FEATURES;
    CONFIG.FEATURES = { DRIVE: false, GMAIL: false };
    try { fn(); } finally { CONFIG.FEATURES = prev; }
  }
  function counting(obj, label, fn) {
    var calls = 0, saved = {};
    Object.keys(obj).forEach(function (k) {
      if (typeof obj[k] === 'function') { saved[k] = obj[k]; obj[k] = function () { calls++; return saved[k].apply(this, arguments); }; }
    });
    try { fn(); } finally { Object.keys(saved).forEach(function (k) { obj[k] = saved[k]; }); }
    return calls;
  }

  test('modo seguro · el manifiesto por defecto no pide Drive ni Gmail; el completo sí (detección automática)', function () {
    ok(CONFIG.FEATURES && typeof CONFIG.FEATURES === 'object', 'CONFIG.FEATURES existe');
  });

  test('modo seguro · bundle informa features y nunca toca Drive/Gmail', function () {
    fresh('demo');
    safe(function () {
      var n = counting(DriveApp, 'DriveApp', function () {
        counting(GmailApp, 'GmailApp', function () {
          var b = client('bootstrap');
          deepEq(b.config.features, { drive: false, gmail: false });
          eq(b.config.drive, false, 'sin carpeta raíz efectiva');
          ok(b.config.aprob === null || b.config.aprob.disabled === true, 'estado de Ariba marcado como desactivado');
        });
      });
      eq(n, 0, 'sin llamadas a DriveApp');
    });
  });

  test('modo seguro · Drive: lista vacía, sin crear carpetas, conectar rechazado, desconectar permitido', function () {
    fresh('demo');
    PropertiesService.getScriptProperties().setProperty('DRIVE_ROOT_ID', 'raiz-antigua');
    safe(function () {
      var p = client('bootstrap').projects[0];
      var calls = counting(DriveApp, 'DriveApp', function () {
        var l = client('driveList', p.id);
        eq(l.disabled, true); eq(l.files.length, 0);
        var st = client('driveStatus');
        eq(st.configured, false); eq(st.disabled, true);
        throws(function () { client('driveSetRoot', 'https://drive.google.com/drive/folders/abc123'); }, /modo seguro/);
        client('driveSetRoot', '');
        // crear un proyecto no intenta crear carpetas
        client('gSave', { tipo: 'Proyecto', pilar: 'cc', nombre: 'Proyecto modo seguro' });
      });
      eq(calls, 0, 'ninguna llamada a DriveApp');
      eq(PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID'), null, 'desconectar borra DRIVE_ROOT_ID');
    });
  });

  test('modo seguro · Gmail: revisar/activar rechazados con mensaje claro; el activador no lee correo', function () {
    fresh('demo');
    safe(function () {
      var calls = counting(GmailApp, 'GmailApp', function () {
        throws(function () { client('aprobScan'); }, /modo seguro/);
        throws(function () { client('aprobInstall'); }, /modo seguro/);
        var r = aprobScanTrigger({});
        eq(r.disabled, true);
      });
      eq(calls, 0, 'ninguna llamada a GmailApp');
    });
  });
})();
