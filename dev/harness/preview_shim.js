/* =====================================================================
   preview_shim.js · servidor Apps Script simulado dentro de la página + google.script.run
   (build.py lo inyecta en dev/preview/index.html antes de los parciales de la app)

   - Compila mocks.js + .gs + seed.js en UNA función aislada (no contamina window, como el servidor real).
     Un .gs con error de sintaxis se omite y se avisa en el panel.
   - En la primera llamada: seedSpreadsheet() → setup() → seedDemoGestion() + 3 correos de Ariba y aprobScan() (salvo ?empty=1)
     → carpeta raíz de Drive simulada (driveSetRoot) + carpetas con archivos de ejemplo en 2 proyectos (salvo ?empty=1).
   - google.script.run: asíncrono (?latency=250), withSuccessHandler/withFailureHandler/withUserObject,
     no expone funciones privadas (terminan en _), serializa ESTRICTO (Date, funciones, undefined en arrays
     → error visible) y hace JSON round-trip de argumentos y retorno.
   - Parámetros: ?user=correo (vacío = sin correo) · ?gemini=1 · ?empty=1 · ?latency=ms · ?dev=0 (sin panel)
   - Consola: harness.call('fn', ...args) · harness.mails() · harness.MOCK
   ===================================================================== */
(function () {
  'use strict';
  var SRC = window.__HARNESS_SRC || [];
  var PUBLIC = window.__HARNESS_PUBLIC || [];
  var INFO = window.__HARNESS_INFO || {};
  var params = new URLSearchParams(location.search);
  var LAT = Math.max(0, Number(params.get('latency') || 250) || 0);
  var ADMIN = 'gvicencio@copec.cl';
  var USERS = [
    ['gvicencio@copec.cl', 'Gonzalo (admin)'], ['ibachler@copec.cl', 'Ina'], ['bderigoulier@copec.cl', 'Benja'],
    ['idiaz@copec.cl', 'Ignacio'], ['', 'Sin correo (desconocido)'],
  ];
  var srv = null, srvErr = null, ready = false;
  var issues = (INFO.missing || []).map(function (n) { return 'Falta el parcial ' + n + '.html (Index.html lo incluye)'; });
  var calls = 0, seq = 0;

  /* ---------- Serialización estilo Apps Script (independiente del servidor) ---------- */
  function illegal(v, where) {
    var bad = [];
    (function walk(x, path, inArr, depth) {
      if (bad.length > 10 || depth > 60) return;
      if (x === undefined) { if (inArr) bad.push(path + ': undefined dentro de un array'); return; }
      if (x === null) return;
      var t = typeof x;
      if (t === 'string' || t === 'number' || t === 'boolean') return;
      if (t === 'function') { bad.push(path + ': función'); return; }
      if (t !== 'object') { bad.push(path + ': ' + t); return; }
      var tag = Object.prototype.toString.call(x);
      if (tag === '[object Date]') { bad.push(path + ': Date'); return; }
      if (Array.isArray(x)) { x.forEach(function (y, i) { walk(y, path + '[' + i + ']', true, depth + 1); }); return; }
      var proto = Object.getPrototypeOf(x);
      if (tag !== '[object Object]' || (proto && proto !== Object.prototype && !(proto.constructor && proto.constructor.name === 'Object'))) {
        bad.push(path + ': objeto no plano (' + tag.slice(8, -1) + ')'); return;
      }
      Object.keys(x).forEach(function (k) {
        if (typeof x[k] === 'function') bad.push(path + '.' + k + ': función');
        else walk(x[k], path + '.' + k, false, depth + 1);
      });
    })(v, where, false, 0);
    return bad;
  }
  function strict(v, where) {
    var bad = illegal(v, where);
    if (bad.length) {
      var e = new Error('google.script.run no puede serializar ' + where + ': ' + bad.slice(0, 5).join('; '));
      e.harness = true;
      throw e;
    }
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /* ---------- Servidor aislado ---------- */
  function compile() {
    var good = [];
    SRC.forEach(function (f) {
      try { new Function(f.code); good.push(f); } catch (e) {
        issues.push('Error de sintaxis en ' + f.name + ': ' + e.message);
        console.error('[harness] Error de sintaxis en ' + f.name + ': ' + e.message);
      }
    });
    var body = good.map(function (f) { return '/* ===== ' + f.name + ' ===== */\n' + f.code; }).join('\n;\n') +
      '\n;return {' +
      ' call: function (n, a) { if (!/^[A-Za-z_$][\\w$]*$/.test(n)) throw new Error("Nombre inválido"); var fn; try { fn = eval(n); } catch (e) { fn = undefined; }' +
      ' if (typeof fn !== "function") throw new Error("No existe la función " + n + " en el servidor"); return fn.apply(null, a || []); },' +
      ' has: function (n) { if (!/^[A-Za-z_$][\\w$]*$/.test(n)) return false; try { return typeof eval(n) === "function"; } catch (e) { return false; } },' +
      ' MOCK: MOCK };\n//# sourceURL=harness-servidor.js';
    return new Function(body)();
  }
  /* ---------- Solicitudes de compra (Ariba) de demostración ----------
     Copia de dev/fixtures/ariba_*_plain.txt (+ ariba_subjects.json): tres correos en el Gmail simulado y un aprobScan()
     como administrador, para que la vista previa muestre la bandeja de Solicitudes. */
  var ARIBA_FROM = '"Aprobación por correo electrónico" <buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com>';
  var ARIBA_DEMO = [
    { hours: 2, subject: "Acción necesaria: Aprobar el/la Solicitud de compra que GONZALO ALEJANDRO CORTES UARAC ha enviado - PR71524 - Piloto Green Energy en Transcom ($13.473.363,17 CLP)",
      body: "Solicitud de compra\nEs necesaria una acción por su parte\nEste/esta solicitud de compra que GONZALO ALEJANDRO\nCORTES UARAC ha enviado , requiere su aprobación.\nMotivo: Responsable CECO\nHaga clic en Aprobar o Denegar para aprobar o denegar Solicitud de\ncompra,y escriba sus comentarios en el mensaje de correo electrónico\nque se abrirá. Para ver Solicitud de compra en la solución de Ariba,\nhaga clic en Ver\nEn representación de\nGONZALO ALEJANDRO\nCORTES UARAC\nSolicitud de compra\nPR71524 - Piloto Green Energy\nen Transcom\nCreado\nviernes, 2 octubre, 2026 a las\n11:17, CLST\nImporte total\n$13.473.363,17 CLP\nEste documento tiene adjuntos.\nAprobar Denegar Ver\nDetalles de cabecera\nMax Approval Amount\n328,03 CLF\nArtículos en línea\n1 Descripción\nPiloto de paneles solares flexibles\nGreen Energy en camiones de\nTranscom\nAsignación de cuentas\nK(Centro de coste)\nProveedor\nLUXMETER\nENERGY SPA\nEntregar a\nGonzalo\nCortés\nCtd.\n1,00\nUnidad\ncada\nuno\nPrecio\n328,03\nCLF\nImporte\n328,03\nCLF\nCuenta contable Centro de costes Tipo Proporción\n0005606700(Materiales y equipos\nPilotos Garage)\nXUF81084(NUEVAS\nENERGIAS) Importe 218,23\nCLF\n0005602585(Est. y Asesorías por\nCumplim. Normativas)\nXUF80853(PROY.CAMBIOS\nCLIMA) Importe 109,80\nCLF\nComentarios recientes\nviernes, 2 octubre, 2026 a las 12:26, CLST: GONZALO ALEJANDRO CORTES UARAC - Se\nadjunta propuesta comercial y carta de proveedor unico para proyecto piloto. Se va a pilotear\ntecnología de paneles solares flexibles en camiones de Transcom para buscar ahorro de\ncombustible de los vehiculos.\nFlujo de aprobación (A partir de viernes, 2 octubre, 2026 a las 16:05, CLST)\nEstado Necesario Motivo Responsable de\naprobación Fecha Hora\nAprobado Sí\nValidacion de\ncompras\nsuperior a 150\nCLF\nFrancisca Ignacia Garcés\nFuentes (en representación\nde REVISION COMPRAS)\n2\noctubre,\n2026\n15:00\nAprobado Sí\nJefe de\ncompras Jefe\nde compra 150\nuf\nMarta Montero Castro (en\nrepresentación de BUYING\nJEFE DE COMPRAS)\n2\noctubre,\n2026\n16:05\nListo para\nsu\naprobación\nSí Responsable\nCECO\nRAMON SALINAS\nERRAZURIZ\nListo para\nsu\naprobación\nSí Responsable\nCECO\nGONZALO EDUARDO\nVICENCIO SANCHEZ\nAprobar Denegar Ver\nAhora puede aprobar solicitudes de compra desde un dispositivo móvil. Obtenga hoy mismo la\naplicación SAP Ariba Procurement.\nDerechos de autor © 2005 - 2026 Ariba, Inc., Todos los derechos reservados.\n" },
    { hours: 26, subject: "Acción necesaria: Aprobar el/la Solicitud de compra que MARÍA JOSÉ PÉREZ SOTO ha enviado - PR71899 - Estudio huella hídrica en plantas de lubricantes ($4.512.880 CLP)",
      body: "Solicitud de compra\nEs necesaria una acción por su parte\nEste/esta solicitud de compra que MARÍA JOSÉ PÉREZ SOTO ha enviado , requiere su aprobación.\nMotivo: Responsable CECO\nHaga clic en Aprobar o Denegar para aprobar o denegar Solicitud de compra,y escriba sus comentarios en el mensaje de correo electrónico que se abrirá. Para ver Solicitud de compra en la solución de Ariba, haga clic en Ver\n\nEn representación de\tMARÍA JOSÉ PÉREZ SOTO\nSolicitud de compra\tPR71899 - Estudio huella hídrica en plantas de lubricantes\nCreado\tlunes, 6 julio, 2026 a las 9:05, CLT\nImporte total\t$4.512.880 CLP\nEste documento tiene adjuntos.\nAprobar <mailto:buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com?subject=Aprobar%20PR71899&body=*** Approve ***> Denegar <mailto:buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com?subject=Denegar%20PR71899&body=*** Deny ***> Ver <https://s1.ariba.com/Buyer/Main/ad/webjumper?realm=copec-ss-c1&itemID=PR71899>\n\nDetalles de cabecera\nMax Approval Amount\t114,25 CLF\nArtículos en línea\n1\tDescripción\tEstudio de huella hídrica y balance de agua en plantas de lubricantes\nAsignación de cuentas\tK(Centro de coste)\nProveedor\tCONSULTORA AGUAS CLARAS LTDA.\nEntregar a\tMaría José Pérez\nCtd.\t1,00\tUnidad\tcada uno\tPrecio\t114,25 CLF\tImporte\t114,25 CLF\nCuenta contable\tCentro de costes\tTipo\tProporción\n0005602585(Est. y Asesorías por Cumplim. Normativas)\tXUF80853(PROY.CAMBIOS CLIMA)\tImporte\t114,25 CLF\n\nComentarios recientes\nlunes, 6 julio, 2026 a las 9:10, CLT: MARÍA JOSÉ PÉREZ SOTO - Estudio comprometido en el plan de agua 2026; adjunto cotización.\nFlujo de aprobación (A partir de lunes, 6 julio, 2026 a las 11:30, CLT)\nEstado\tNecesario\tMotivo\tResponsable de aprobación\tFecha Hora\nListo para su aprobación\tSí\tResponsable CECO\tGONZALO EDUARDO VICENCIO SANCHEZ\n\nAhora puede aprobar solicitudes de compra desde un dispositivo móvil. Obtenga hoy mismo la aplicación SAP Ariba Procurement.\nDerechos de autor © 2005 - 2026 Ariba, Inc., Todos los derechos reservados.\n" },
    { hours: 74, subject: "Recordatorio: Acción necesaria: Aprobar el/la Solicitud de compra que PEDRO ANTONIO GONZÁLEZ NÚÑEZ ha enviado - PR72010 - Consultoría economía circular para EDS y plantas ($52.104.330,90 CLP)",
      body: "Solicitud de compra\nEs necesaria una acción por su parte\nEste/esta solicitud de compra que PEDRO ANTONIO\nGONZÁLEZ NÚÑEZ ha enviado , requiere su aprobación.\nMotivo: Responsable CECO\nHaga clic en Aprobar o Denegar para aprobar o denegar Solicitud de\ncompra,y escriba sus comentarios en el mensaje de correo electrónico\nque se abrirá. Para ver Solicitud de compra en la solución de Ariba,\nhaga clic en Ver\nEn representación de:\nPEDRO ANTONIO GONZÁLEZ\nNÚÑEZ\nSolicitud de compra:\nPR72010 - Consultoría economía\ncircular para EDS y plantas\nCreado: martes, 15 septiembre,\n2026 a las 18:40, CLST\nImporte total: $52.104.330,90\nCLP\nAprobar Denegar Ver\nDetalles de cabecera\nMax Approval Amount\n1.319,20 CLF\nArtículos en línea\n1 Descripción\nDiagnóstico y hoja de ruta de\neconomía circular para la red EDS\ny plantas de lubricantes\nAsignación de cuentas\nK(Centro de coste)\nProveedor\nCIRCULAR\nCONSULTORES\nSPA\nEntregar a\nPedro\nGonzález\nCtd.\n1,00\nUnidad\ncada\nuno\nPrecio\n1.319,20\nCLF\nImporte\n1.319,20\nCLF\nCuenta contable Centro de costes Tipo Proporción\n0005602575(Asesorías\nEconomía Circular)\nXUF70011(ECONOMIA\nCIRCULAR) Importe 1.234,50\nCLF\n0005602575(Asesorías\nEconomía Circular)\nXUF70345(LUBRICANTES\nPLANTAS) Importe 62,30\nCLF\n0005606700(Materiales y equipos\nPilotos Garage)\nXUF81084(NUEVAS\nENERGIAS) Importe 22,40\nCLF\nFlujo de aprobación (A partir de miércoles, 16 septiembre, 2026 a las 09:12, CLST)\nEstado Necesario Motivo Responsable de\naprobación Fecha Hora\nListo para\nsu\naprobación\nSí Responsable\nCECO\nGONZALO EDUARDO\nVICENCIO SANCHEZ\nAprobar Denegar Ver\nAhora puede aprobar solicitudes de compra desde un dispositivo móvil. Obtenga hoy mismo la\naplicación SAP Ariba Procurement.\nDerechos de autor © 2005 - 2026 Ariba, Inc., Todos los derechos reservados.\n" }
  ];
  function seedAriba(M) {
    if (!srv.has('aprobScan') || !M.gmail || typeof M.gmail.add !== 'function') return;
    var now = Date.now();
    ARIBA_DEMO.forEach(function (d) {
      M.gmail.add({ from: ARIBA_FROM, to: ADMIN, subject: d.subject, plainBody: d.body, date: new Date(now - d.hours * 3600000) });
    });
    var prev = M.user;
    M.user = ADMIN;
    try { srv.call('aprobScan'); } finally { M.user = prev; }
  }

  /* ---------- Drive de demostración (SPEC §14.3) ----------
     Una carpeta raíz simulada dentro de una "unidad compartida", conectada con driveSetRoot (como administrador), y
     carpetas con archivos de ejemplo para dos proyectos de pilares distintos, para que la pestaña Drive muestre contenido.
     Los enlaces apuntan a IDs simulados (en Drive real no abren). Con ?empty=1 sólo se conecta la raíz. */
  var DRIVE_DEMO = [
    [
      { name: 'Informe de avance septiembre.pdf', mimeType: 'application/pdf', size: 1843200, hours: 30 },
      { name: 'Foto visita a planta.jpg', mimeType: 'image/jpeg', size: 2457600, hours: 5 },
      { name: 'Cotización proveedor.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 48230, hours: 75 },
      { name: 'Minuta reunión de inicio', mimeType: 'application/vnd.google-apps.document', size: 0, hours: 160 },
      { name: 'Video piloto.mp4', mimeType: 'video/mp4', size: 18350080, hours: 52 },
      { name: 'Fotos de terreno', folder: true, hours: 8, files: [
        { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', size: 3145728, hours: 8 },
        { name: 'IMG_2042.jpg', mimeType: 'image/jpeg', size: 2936012, hours: 8 },
      ] },
    ],
    [
      { name: 'Presentación al comité', mimeType: 'application/vnd.google-apps.presentation', size: 0, hours: 20 },
      { name: 'Certificado de recepción.pdf', mimeType: 'application/pdf', size: 312400, hours: 200 },
      { name: 'Registro de consumo', mimeType: 'application/vnd.google-apps.spreadsheet', size: 0, hours: 3 },
    ],
  ];
  function seedDrive(M, withFiles) {
    if (!srv.has('driveSetRoot') || !M.drive || typeof M.drive.addFolder !== 'function') return;
    var unidad = M.drive.addFolder('Equipo Sostenibilidad (unidad compartida)', '');
    var rootId = M.drive.addFolder('Cuadre AACC · Proyectos', unidad);
    var prev = M.user;
    M.user = ADMIN;
    try {
      srv.call('driveSetRoot', ['https://drive.google.com/drive/folders/' + rootId + '?usp=sharing']);
      if (!withFiles) return;
      var b = srv.call('bootstrap');
      var picked = [];
      (b.projects || []).forEach(function (p) {
        if (picked.length < 2 && p.resp && p.estado !== 'Cerrado' && !picked.some(function (q) { return q.pilar === p.pilar; })) picked.push(p);
      });
      var now = Date.now();
      var add = function (parentId, d) {
        var when = new Date(now - d.hours * 3600000);
        if (!d.folder) { M.drive.addFile(d.name, parentId, { mimeType: d.mimeType, size: d.size, updated: when, created: when }); return; }
        var sub = M.drive.addFolder(d.name, parentId, { updated: when, created: when });
        (d.files || []).forEach(function (x) { add(sub, x); });
      };
      picked.forEach(function (p, k) {
        var f = srv.call('driveFolder', [p.id]);
        DRIVE_DEMO[k].forEach(function (d) { add(f.id, d); });
      });
    } finally { M.user = prev; }
  }

  function init() {
    if (ready) return;
    ready = true;
    var t0 = performance.now();
    try {
      srv = compile();
      var M = srv.MOCK;
      window.MOCK = M;
      M.reset();
      srv.call('seedSpreadsheet');
      M.user = ADMIN;
      try {
        var st = srv.call('setup');
        (st && st.warnings || []).forEach(function (w) { if (!/zona horaria|GEMINI|implementada/i.test(w)) issues.push('setup(): ' + w); });
      } catch (e) { issues.push('setup() falló: ' + e.message); console.error('[harness] setup()', e); }
      if (params.get('gemini') === '1') M.services.PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'mock-gemini-key');
      if (params.get('empty') !== '1') {
        try {
          var rep = srv.call('seedDemoGestion', [{}]);
          (rep && rep.warnings || []).forEach(function (w) { issues.push('Datos demo: ' + w); });
        } catch (e) { issues.push('seedDemoGestion() falló: ' + e.message); console.error('[harness] seedDemoGestion()', e); }
        try { seedAriba(M); } catch (e) { issues.push('Solicitudes Ariba (demo) fallaron: ' + e.message); console.error('[harness] seedAriba()', e); }
      }
      try { seedDrive(M, params.get('empty') !== '1'); } catch (e) { issues.push('Drive (demo) falló: ' + e.message); console.error('[harness] seedDrive()', e); }
      M.user = params.has('user') ? params.get('user') : ADMIN;
      if (M.lockViolations.length) issues.push('Lock anidado durante la carga: ' + M.lockViolations[0].stack.split('\n')[0]);
      M.clearBuffers();
      console.info('[harness] servidor simulado listo en ' + Math.round(performance.now() - t0) + ' ms · usuario: ' + (M.user || '(sin correo)'));
    } catch (e) {
      srvErr = e;
      issues.push('El servidor simulado no cargó: ' + e.message);
      console.error('[harness] servidor', e);
    }
    renderPanel();
  }

  /* ---------- google.script.run ---------- */
  function invoke(name, args, st) {
    var id = ++seq;
    var fail = function (err) {
      if (st.fail) st.fail(err, st.uo);
      else console.error('[google.script.run] ' + name + ' falló sin withFailureHandler:', err);
    };
    var cargs;
    try { cargs = strict(args, name + '(argumentos)') || []; } catch (e) {
      console.error('[harness] ' + e.message);
      setTimeout(function () { fail(new Error(e.message)); }, 0);
      return;
    }
    setTimeout(function () {
      init();
      calls++;
      var t0 = performance.now(), res, err = null;
      if (srvErr) err = new Error('El servidor simulado no cargó: ' + srvErr.message);
      else {
        try {
          var raw = srv.call(name, cargs);
          res = strict(raw, name + '() → retorno');
        } catch (e) { err = e; }
      }
      var ms = Math.round(performance.now() - t0);
      var lv = srv && srv.MOCK && srv.MOCK.lockViolations.length;
      if (lv) { issues.push('Lock anidado en ' + name + '(): ' + srv.MOCK.lockViolations[0].stack.split('\n')[0]); srv.MOCK.lockViolations.length = 0; renderPanel(); }
      if (err) {
        if (err.harness) { console.error('[harness] ' + err.message); issues.push(err.message); renderPanel(); }
        else console.warn('[gs.run #' + id + '] ' + name + ' → error: ' + err.message);
        fail(new Error(err.message));
      } else {
        if (window.__HARNESS_LOG !== false) console.debug('[gs.run #' + id + '] ' + name, cargs, '→', res, '(' + ms + ' ms)');
        if (st.ok) st.ok(res, st.uo);
      }
      updatePill();
    }, LAT);
  }
  function runner(st) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(Object.assign({}, st, { ok: fn })); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(Object.assign({}, st, { fail: fn })); };
        if (prop === 'withUserObject') return function (o) { return runner(Object.assign({}, st, { uo: o })); };
        if (typeof prop !== 'string' || /_$/.test(prop) || PUBLIC.indexOf(prop) < 0) return undefined;
        return function () { invoke(prop, Array.prototype.slice.call(arguments), st); };
      },
    });
  }
  window.google = window.google || {};
  window.google.script = {
    run: runner({}),
    host: { origin: location.origin, close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } },
    url: { getLocation: function (cb) { var p = {}, ps = {}; params.forEach(function (v, k) { p[k] = v; (ps[k] = ps[k] || []).push(v); }); cb({ hash: location.hash.replace(/^#/, ''), parameter: p, parameters: ps }); } },
    history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} },
  };
  window.harness = {
    call: function (name) { init(); return srv.call(name, Array.prototype.slice.call(arguments, 1)); },
    mails: function () { return srv ? srv.MOCK.mails.slice() : []; },
    get MOCK() { init(); return srv && srv.MOCK; },
    issues: issues,
  };

  /* ---------- Panel de desarrollo ---------- */
  var pill = null, panel = null;
  var CSS = {
    pill: 'position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(24,24,27,.92);color:#fafafa;font:500 11px/1.2 Inter,system-ui,sans-serif;box-shadow:0 6px 20px -6px rgba(0,0,0,.45);cursor:pointer;backdrop-filter:blur(6px)',
    panel: 'position:fixed;left:12px;bottom:52px;z-index:2147483000;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 72px);overflow:auto;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(24,24,27,.97);color:#e4e4e7;font:400 12px/1.45 Inter,system-ui,sans-serif;box-shadow:0 20px 40px -12px rgba(0,0,0,.6)',
    label: 'display:block;margin:10px 0 4px;color:#a1a1aa;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em',
    input: 'width:100%;padding:6px 8px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fafafa;font:inherit',
    btn: 'padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:#27272a;color:#fafafa;font:500 12px Inter,system-ui,sans-serif;cursor:pointer',
  };
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function reloadWith(k, v) {
    var p = new URLSearchParams(location.search);
    if (v === null) p.delete(k); else p.set(k, v);
    location.search = p.toString();
  }
  function updatePill() {
    if (!pill) return;
    var M = srv && srv.MOCK;
    var u = params.has('user') ? params.get('user') : ADMIN;
    var name = (USERS.find(function (x) { return x[0] === u; }) || [u, u || 'sin correo'])[1].replace(' (admin)', '');
    var dot = issues.length ? '#f87171' : '#34d399';
    pill.innerHTML = '<span style="width:7px;height:7px;border-radius:99px;background:' + dot + '"></span>Mock · ' + escH(name) +
      (M && M.mails.length ? ' · ' + M.mails.length + ' correo' + (M.mails.length === 1 ? '' : 's') : '') +
      (issues.length ? ' · ' + issues.length + ' aviso' + (issues.length === 1 ? '' : 's') : '');
  }
  function renderPanel() {
    updatePill();
    if (!panel || panel.style.display === 'none') return;
    var M = srv && srv.MOCK;
    var u = params.has('user') ? params.get('user') : ADMIN;
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong style="color:#fafafa;font-size:13px">Banco local · Apps Script simulado</strong>' +
      '<button type="button" data-h="close" aria-label="Cerrar panel" title="Cerrar" style="' + CSS.btn + ';padding:2px 8px">×</button></div>' +
      '<p style="margin:4px 0 0;color:#a1a1aa">Generado ' + escH(INFO.builtAt || '') + ' · ' + calls + ' llamadas · latencia ' + LAT + ' ms. Recargar = datos frescos.</p>' +
      '<label style="' + CSS.label + '" for="h-user">Usuario (Session.getActiveUser)</label>' +
      '<select id="h-user" style="' + CSS.input + '">' + USERS.map(function (x) { return '<option value="' + escH(x[0]) + '"' + (x[0] === u ? ' selected' : '') + '>' + escH(x[1]) + '</option>'; }).join('') + '</select>' +
      '<label style="' + CSS.label + '">Opciones</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" id="h-gem"' + (params.get('gemini') === '1' ? ' checked' : '') + '> Gemini simulado (GEMINI_API_KEY)</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" id="h-empty"' + (params.get('empty') === '1' ? ' checked' : '') + '> Sin datos demo (sólo setup)</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:4px 0">Latencia <select id="h-lat" style="' + CSS.input + ';width:auto">' + [0, 250, 800, 2000].concat([0, 250, 800, 2000].indexOf(LAT) < 0 ? [LAT] : []).sort(function (a, b) { return a - b; }).map(function (n) { return '<option' + (n === LAT ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> ms</label>' +
      '<label style="' + CSS.label + '">Acciones</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
      '<button type="button" data-h="notif" style="' + CSS.btn + '">Ejecutar notifDaily()</button>' +
      '<button type="button" data-h="digest" style="' + CSS.btn + '">sendTestDigest()</button>' +
      '<button type="button" data-h="mails" style="' + CSS.btn + '">Ver correos (' + (M ? M.mails.length : 0) + ')</button>' +
      '<button type="button" data-h="reload" style="' + CSS.btn + '">Reiniciar datos</button></div>' +
      (issues.length ? '<label style="' + CSS.label + ';color:#fca5a5">Avisos</label><ul style="margin:0;padding-left:16px;color:#fecaca">' + issues.slice(-12).map(function (i) { return '<li style="margin:2px 0">' + escH(i) + '</li>'; }).join('') + '</ul>' : '') +
      '<p style="margin:10px 0 0;color:#71717a">Consola: <code>harness.call("bootstrap")</code>, <code>harness.mails()</code>, <code>MOCK</code></p>';
  }
  function showMails() {
    var M = srv && srv.MOCK;
    var list = M ? M.mails : [];
    var ov = el('div', { style: 'position:fixed;inset:0;z-index:2147483001;background:rgba(9,9,11,.6);display:flex;align-items:center;justify-content:center;padding:16px', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Correos enviados (simulados)' });
    var box = el('div', { style: 'width:min(760px,100%);max-height:90dvh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:#18181b;color:#e4e4e7;font:13px/1.45 Inter,system-ui,sans-serif;border:1px solid #3f3f46' });
    var head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #3f3f46' },
      '<strong>Correos enviados (MailApp simulado) · ' + list.length + '</strong>');
    var close = el('button', { type: 'button', style: CSS.btn, 'aria-label': 'Cerrar' }, 'Cerrar');
    head.appendChild(close);
    var body = el('div', { style: 'overflow:auto;padding:12px 14px' });
    if (!list.length) body.innerHTML = '<p style="color:#a1a1aa">Aún no se envían correos. Usa "Ejecutar notifDaily()".</p>';
    list.forEach(function (m) {
      var card = el('div', { style: 'margin-bottom:14px;border:1px solid #3f3f46;border-radius:10px;overflow:hidden' },
        '<div style="padding:8px 10px;background:#27272a"><div><b>Para:</b> ' + escH(m.to) + '</div><div><b>Asunto:</b> ' + escH(m.subject) + '</div></div>');
      var fr = el('iframe', { sandbox: '', title: 'Vista previa del correo', style: 'width:100%;height:360px;border:0;background:#fff' });
      fr.srcdoc = m.htmlBody || '<pre>' + escH(m.body) + '</pre>';
      card.appendChild(fr);
      body.appendChild(card);
    });
    box.appendChild(head); box.appendChild(body); ov.appendChild(box);
    var done = function () { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    close.addEventListener('click', done);
    ov.addEventListener('click', function (e) { if (e.target === ov) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    close.focus();
  }
  function mountPanel() {
    if (params.get('dev') === '0' || pill) return;
    pill = el('button', { type: 'button', style: CSS.pill, title: 'Banco local (Apps Script simulado)', 'aria-label': 'Abrir panel del banco local' });
    panel = el('div', { style: CSS.panel + ';display:none', role: 'dialog', 'aria-label': 'Banco local' });
    pill.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; renderPanel(); });
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-h]');
      if (!b) return;
      var h = b.getAttribute('data-h');
      if (h === 'close') { panel.style.display = 'none'; pill.focus(); }
      if (h === 'reload') location.reload();
      if (h === 'mails') showMails();
      if (h === 'notif' || h === 'digest') {
        init();
        try {
          var r = srv.call(h === 'notif' ? 'notifDaily' : 'sendTestDigest');
          console.info('[harness] ' + (h === 'notif' ? 'notifDaily' : 'sendTestDigest') + ' →', r);
        } catch (err) { issues.push((h === 'notif' ? 'notifDaily' : 'sendTestDigest') + ': ' + err.message); }
        renderPanel();
        if (srv && srv.MOCK.mails.length) showMails();
      }
    });
    panel.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'h-user') reloadWith('user', t.value);
      if (t.id === 'h-gem') reloadWith('gemini', t.checked ? '1' : null);
      if (t.id === 'h-empty') reloadWith('empty', t.checked ? '1' : null);
      if (t.id === 'h-lat') reloadWith('latency', t.value);
    });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); panel.style.display = 'none'; pill.focus(); } });
    document.body.appendChild(panel);
    document.body.appendChild(pill);
    updatePill();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPanel);
  else mountPanel();
})();
