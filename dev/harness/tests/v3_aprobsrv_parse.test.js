/* v3 · Aprobaciones.gs — parser de correos de Ariba (aprobParse_) con los fixtures de dev/fixtures */
(function () {
  var FX = 'dev/fixtures/';
  var SUBJ = null;
  function fx(name) { return readText(FX + name); }
  function subj(name) { if (!SUBJ) SUBJ = JSON.parse(fx('ariba_subjects.json')); return SUBJ[name]; }
  function parse(file, opts) {
    opts = opts || {};
    return aprobParse_(opts.subject !== undefined ? opts.subject : subj(file), fx(file), opts.received || '2026-10-02T19:05:00.000Z');
  }
  function local(iso) { return Utilities.formatDate(new Date(iso), 'America/Santiago', "yyyy-MM-dd'T'HH:mm"); }
  var PR71524_CECOS = [
    { cuenta: '0005606700', cuentaNombre: 'Materiales y equipos Pilotos Garage', codigo: 'XUF81084', nombre: 'NUEVAS ENERGIAS', uf: 218.23, propio: false },
    { cuenta: '0005602585', cuentaNombre: 'Est. y Asesorías por Cumplim. Normativas', codigo: 'XUF80853', nombre: 'PROY.CAMBIOS CLIMA', uf: 109.8, propio: true },
  ];
  function checkPR71524(p, label) {
    eq(p.solicitante, 'GONZALO ALEJANDRO CORTES UARAC', label + ' solicitante');
    eq(p.pr, 'PR71524', label + ' pr');
    eq(p.nombre, 'Piloto Green Energy en Transcom', label + ' nombre');
    eq(p.montoClp, 13473363, label + ' montoClp');
    eq(p.montoTexto, '$13.473.363,17 CLP', label + ' montoTexto');
    eq(p.fechaTexto, 'viernes, 2 octubre, 2026 a las 11:17, CLST', label + ' fechaTexto');
    eq(p.fecha, '2026-10-02T14:17:00.000Z', label + ' fecha ISO (11:17 CLST = UTC-3)');
    eq(local(p.fecha), '2026-10-02T11:17', label + ' fecha en hora de Santiago');
    eq(p.proveedor, 'LUXMETER ENERGY SPA', label + ' proveedor');
    eq(p.totalUf, 328.03, label + ' totalUf');
    eq(p.cecos.length, 2, label + ' cantidad de CeCos');
    PR71524_CECOS.forEach(function (c, i) {
      ['cuenta', 'cuentaNombre', 'codigo', 'nombre', 'uf', 'propio'].forEach(function (k) { eq(p.cecos[i][k], c[k], label + ' ceco ' + i + ' ' + k); });
    });
    eq(p.cecos[1].clp, Math.round(13473363.17 * 109.8 / 328.03), label + ' clp del CeCo propio');
    eq(p.cecos[0].clp, Math.round(13473363.17 * 218.23 / 328.03), label + ' clp del otro CeCo');
    ok(Math.abs(p.sugerido - Math.round(13473363.17 * 109.8 / 328.03)) <= 1, label + ' sugerido ≈ parte de XUF80853: ' + p.sugerido);
    eq(p.lectura, 'ok', label + ' lectura');
  }

  test('v3 aprobsrv · parser PR71524 (getPlainBody aproximado, con cortes de línea)', function () {
    need('aprobParse_');
    var p = parse('ariba_PR71524_plain.txt');
    checkPR71524(p, 'plain');
    eq(p.descripcion, 'Piloto de paneles solares flexibles Green Energy en camiones de Transcom');
    ok(/^GONZALO ALEJANDRO CORTES UARAC - Se adjunta propuesta comercial/.test(p.comentario), 'comentario sin la fecha: ' + p.comentario);
    ok(/combustible de los vehiculos\.$/.test(p.comentario), 'comentario completo (sin el flujo de aprobación)');
    eq(p.recibido, '2026-10-02T19:05:00.000Z', 'recibido');
    ok(/^Acción necesaria: Aprobar/.test(p.asunto), 'asunto guardado');
    assertNoDates(p, 'aprobParse_');
  });

  test('v3 aprobsrv · parser PR71524 sobre el PDF impreso (encabezados, URLs y "Página n de 3")', function () {
    need('aprobParse_');
    checkPR71524(parse('ariba_PR71524.txt'), 'pdf');
  });

  test('v3 aprobsrv · parser sólo con el cuerpo (sin asunto) y con un Date como fecha de recepción', function () {
    need('aprobParse_');
    var p = aprobParse_('', fx('ariba_PR71524_plain.txt'), new Date(Date.UTC(2026, 9, 2, 19, 5)));
    checkPR71524(p, 'sin asunto');
    eq(p.recibido, '2026-10-02T19:05:00.000Z', 'Date → ISO');
    assertNoDates(p);
    var q = aprobParse_('', fx('ariba_PR71899_plain.txt'), '');
    eq(q.solicitante, 'MARÍA JOSÉ PÉREZ SOTO', 'PR71899 solicitante desde el cuerpo');
    eq(q.pr, 'PR71899');
    eq(q.nombre, 'Estudio huella hídrica en plantas de lubricantes');
    var r = aprobParse_('', fx('ariba_PR72010_plain.txt'), '');
    eq(r.solicitante, 'PEDRO ANTONIO GONZÁLEZ NÚÑEZ', 'PR72010 solicitante desde el cuerpo');
    eq(r.nombre, 'Consultoría economía circular para EDS y plantas');
    eq(r.lectura, 'ok');
  });

  test('v3 aprobsrv · parser PR71899: NBSP, tabuladores, <mailto:>, CLT y un solo CeCo (el propio)', function () {
    need('aprobParse_');
    var p = parse('ariba_PR71899_plain.txt');
    eq(p.solicitante, 'MARÍA JOSÉ PÉREZ SOTO');
    eq(p.pr, 'PR71899');
    eq(p.nombre, 'Estudio huella hídrica en plantas de lubricantes');
    eq(p.montoClp, 4512880);
    eq(p.montoTexto, '$4.512.880 CLP');
    eq(p.fechaTexto, 'lunes, 6 julio, 2026 a las 9:05, CLT');
    eq(p.fecha, '2026-07-06T13:05:00.000Z', '9:05 CLT = UTC-4');
    eq(p.proveedor, 'CONSULTORA AGUAS CLARAS LTDA.');
    eq(p.descripcion, 'Estudio de huella hídrica y balance de agua en plantas de lubricantes');
    eq(p.cecos.length, 1);
    eq(p.cecos[0].codigo, 'XUF80853');
    eq(p.cecos[0].uf, 114.25);
    eq(p.cecos[0].propio, true);
    eq(p.cecos[0].clp, 4512880, 'un CeCo: todo el monto');
    eq(p.sugerido, 4512880);
    eq(p.totalUf, 114.25);
    ok(p.comentario.indexOf('mailto') < 0 && /^MARÍA JOSÉ PÉREZ SOTO - Estudio comprometido/.test(p.comentario), 'comentario: ' + p.comentario);
    eq(p.lectura, 'ok');
  });

  test('v3 aprobsrv · parser PR72010: "Etiqueta: valor", septiembre, 1.234,50 CLF, tres CeCos sin el propio', function () {
    need('aprobParse_');
    var p = parse('ariba_PR72010_plain.txt');
    eq(p.solicitante, 'PEDRO ANTONIO GONZÁLEZ NÚÑEZ');
    eq(p.pr, 'PR72010');
    eq(p.nombre, 'Consultoría economía circular para EDS y plantas');
    eq(p.montoClp, 52104331, '52.104.330,90 redondeado');
    eq(p.montoTexto, '$52.104.330,90 CLP');
    eq(p.fechaTexto, 'martes, 15 septiembre, 2026 a las 18:40, CLST');
    eq(local(p.fecha), '2026-09-15T18:40');
    eq(p.proveedor, 'CIRCULAR CONSULTORES SPA');
    deepEq(p.cecos.map(function (c) { return [c.codigo, c.uf, c.propio]; }),
      [['XUF70011', 1234.5, false], ['XUF70345', 62.3, false], ['XUF81084', 22.4, false]]);
    eq(p.totalUf, 1319.2);
    eq(p.cecos[0].clp, Math.round(52104330.9 * 1234.5 / 1319.2));
    var sum = p.cecos.reduce(function (a, c) { return a + c.clp; }, 0);
    ok(Math.abs(sum - p.montoClp) <= 2, 'la suma por CeCo cuadra con el total: ' + sum);
    eq(p.sugerido, p.montoClp, 'sin CeCo propio → sugerido = monto total');
    eq(p.comentario, '', 'sin "Comentarios recientes"');
    eq(p.lectura, 'ok', 'el comentario es opcional');
  });

  test('v3 aprobsrv · parser: secciones faltantes o basura → lectura parcial, nunca lanza', function () {
    need('aprobParse_');
    var half = fx('ariba_PR71524_plain.txt').split('Artículos en línea')[0];
    var p = aprobParse_(subj('ariba_PR71524_plain.txt'), half, '');
    eq(p.pr, 'PR71524');
    eq(p.montoClp, 13473363);
    eq(p.cecos.length, 0, 'sin costos');
    eq(p.sugerido, 13473363, 'sin CeCos → sugerido = monto');
    eq(p.totalUf, 328.03, 'total desde "Max Approval Amount"');
    eq(p.lectura, 'parcial');
    // Sólo el asunto
    var s = aprobParse_(subj('ariba_PR71524_plain.txt'), '', '');
    eq(s.solicitante, 'GONZALO ALEJANDRO CORTES UARAC');
    eq(s.nombre, 'Piloto Green Energy en Transcom');
    eq(s.montoClp, 13473363, 'monto desde el asunto');
    eq(s.fechaTexto, '');
    eq(s.lectura, 'parcial');
    // Basura
    [[null, null, null], [undefined, undefined, undefined], [12, {}, 'x'], ['Solicitud de compra', 'hola', new Date(NaN)],
      ['x', new Array(5000).join('Importe total ( ) $ CLP CLF XUF(') + ' 1,2,3 CLF', ''], ['Re: PR123', '0005602585(Est. XUF80853(PROY) Importe CLF', '']]
      .forEach(function (args, i) {
        var r = aprobParse_(args[0], args[1], args[2]);
        eq(r.lectura, 'parcial', 'caso ' + i);
        ok(Array.isArray(r.cecos), 'caso ' + i + ' cecos');
        assertNoDates(r, 'caso ' + i);
      });
    eq(aprobParse_('Re: PR123 algo', '', '').pr, 'PR123', 'PR del asunto aunque no calce el patrón');
  });

  test('v3 aprobsrv · parser: HTML como respaldo cuando no hay texto plano', function () {
    need('aprobParse_', 'aprobHtmlText_');
    var html = '<html><head><style>td{}</style></head><body><table>' +
      '<tr><td>En representaci&oacute;n de</td><td>ANA&nbsp;LUZ ROJAS</td></tr>' +
      '<tr><td>Solicitud de compra</td><td>PR70001 - Prueba&nbsp;HTML &amp; algo</td></tr>' +
      '<tr><td>Creado</td><td>jueves, 1 octubre, 2026 a las 08:00, CLST</td></tr>' +
      '<tr><td>Importe total</td><td>$1.000.000 CLP</td></tr></table>' +
      '<p>Cuenta contable Centro de costes</p><p>0005602585(Est.) XUF80853(PROY.CAMBIOS CLIMA) Importe 25,00 CLF</p></body></html>';
    var p = aprobParse_('', aprobHtmlText_(html), '');
    eq(p.solicitante, 'ANA LUZ ROJAS');
    eq(p.pr, 'PR70001');
    eq(p.nombre, 'Prueba HTML & algo');
    eq(p.montoClp, 1000000);
    eq(p.cecos.length, 1);
    eq(p.lectura, 'ok');
  });

  test('v3 aprobsrv · números chilenos, fechas en español y CeCos propios desde CONFIG.MY_CECOS', function () {
    need('aprobNum_', 'aprobParseFecha_');
    eq(aprobNum_('13.473.363,17'), 13473363.17);
    eq(aprobNum_('$13.473.363,17 CLP'), 13473363.17);
    eq(aprobNum_('1.234,50'), 1234.5);
    eq(aprobNum_('109,80'), 109.8);
    eq(aprobNum_('4.512.880'), 4512880);
    eq(aprobNum_('1,00'), 1);
    ok(isNaN(aprobNum_('abc')) && isNaN(aprobNum_('')) && isNaN(aprobNum_(null)), 'inválidos → NaN');
    eq(aprobParseFecha_('viernes, 2 octubre, 2026 a las 11:17, CLST'), '2026-10-02T14:17:00.000Z');
    eq(aprobParseFecha_('lunes, 6 julio, 2026 a las 9:05, CLT'), '2026-07-06T13:05:00.000Z');
    eq(aprobParseFecha_('2 de octubre de 2026 a las 16:05'), '2026-10-02T19:05:00.000Z', 'sin sufijo: zona del script');
    eq(aprobParseFecha_('sábado, 3 oct. 2026 a las 2:20 p. m.'), '2026-10-03T17:20:00.000Z', 'abreviado y p. m.');
    eq(aprobParseFecha_('30 febrero 2026'), '', 'día inexistente');
    eq(aprobParseFecha_('Creado: hoy'), '');
    var prev = CONFIG.MY_CECOS;
    try {
      CONFIG.MY_CECOS = ['xuf81084'];
      var p = aprobParse_(subj('ariba_PR71524_plain.txt'), fx('ariba_PR71524_plain.txt'), '');
      eq(p.cecos[0].propio, true, 'código en minúsculas en CONFIG');
      eq(p.cecos[1].propio, false);
      eq(p.sugerido, p.cecos[0].clp);
      CONFIG.MY_CECOS = ['XUF81084', 'XUF80853'];
      p = aprobParse_(subj('ariba_PR71524_plain.txt'), fx('ariba_PR71524_plain.txt'), '');
      eq(p.sugerido, p.cecos[0].clp + p.cecos[1].clp, 'varios CeCos propios se suman');
    } finally {
      CONFIG.MY_CECOS = prev;
    }
  });
})();
