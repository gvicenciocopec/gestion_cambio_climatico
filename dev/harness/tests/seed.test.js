/* Datos demo (seedDemoGestion) · cubren los casos que la UI debe mostrar */
(function () {
  test('seed · planilla base: Cuadre 2026 real, Cuadre 2027, Historial, sin Gestión', function () {
    fresh('raw');
    deepEq(MOCK.sheetNames(), ['Cuadre 2026', 'Cuadre 2027', 'Historial']);
    eq(MOCK.values('Cuadre 2026').length, 53, '53 filas (encabezado + 52 líneas)');
    eq(MOCK.values('Cuadre 2026')[0].length, 11, '11 columnas Area..Nota');
    deepEq(MOCK.values('Cuadre 2026')[1].slice(0, 6), ['Cambio Climatico', 'GV - IREC Flux (compra certificados renovables)', 'POA', 53383608, 36608000, 37595558]);
  });

  test('seed · demo completo: proyectos, tareas, vencimientos, realizadas, comentarios', function () {
    fresh('demo');
    var b = bootstrap();
    var today = day(0);
    ok(b.projects.length >= 6, 'proyectos: ' + b.projects.length);
    ['cc', 'ec', 'nat'].forEach(function (k) { ok(b.projects.some(function (p) { return p.pilar === k; }), 'proyectos en ' + k); });
    ok(b.projects.some(function (p) { return p.estado === 'Cerrado'; }), 'un proyecto cerrado');
    ok(b.projects.some(function (p) { return p.estado === 'En pausa'; }), 'un proyecto en pausa');
    ok(b.projects.some(function (p) { return p.lineas.some(function (id) { return id && b.budget['2027'].some(function (l) { return l.id === id; }); }); }), 'un proyecto con líneas de 2027');
    ok(b.tasks.length >= 25, 'tareas: ' + b.tasks.length);
    var pend = b.tasks.filter(function (t) { return t.estado === 'Pendiente'; });
    var done = b.tasks.filter(function (t) { return t.estado === 'Realizada'; });
    ok(pend.some(function (t) { return t.fecha && t.fecha < today; }), 'vencidas');
    ok(pend.some(function (t) { return t.fecha === today; }), 'vence hoy');
    ok(pend.some(function (t) { return t.fecha > today && t.fecha <= day(7); }), 'esta semana');
    ok(pend.some(function (t) { return t.fecha > day(14); }), 'próximo mes');
    ok(pend.some(function (t) { return !t.fecha; }), 'sin fecha');
    ok(pend.some(function (t) { return !t.proyecto; }), 'tareas sin proyecto');
    ok(done.length >= 10, 'realizadas: ' + done.length);
    // v3 (cambio intencional, SPEC §13.1): el cierre es opcional; sólo los checks rápidos personales (sin pilar) no lo traen
    ok(done.some(function (t) { return !t.cierre; }), 'hay checks rápidos sin comentario de cierre');
    done.forEach(function (t) {
      if (t.pilar) ok(t.cierre, t.nombre + ': cierre');
      ok(t.completada >= day(-60) && t.completada <= today, t.nombre + ': completada en los últimos 60 días (' + t.completada + ')');
    });
    ok(done.filter(function (t) { return t.evidencias.length; }).length >= 6, 'realizadas con evidencia');
    Object.keys(U).forEach(function (k) { ok(b.tasks.some(function (t) { return t.resp === U[k]; }), 'tareas de ' + k); });
    ok(b.tasks.filter(function (t) { return t.cascade; }).length >= 8, 'tareas con indicador Cascade');
    ok(b.comments.length >= 5, 'comentarios');
    ['L-', 'PRJ-', 'TSK-'].forEach(function (p) { ok(b.comments.some(function (c) { return c.ref.indexOf(p) === 0; }), 'comentario en ' + p); });
    ok(b.budget['2026'].filter(function (l) { return l.resp; }).length >= 5, 'líneas con responsable');
    var all = b.projects.concat(b.tasks);
    ok(all.some(function (x) { return x.evidencias.some(function (e) { return /bonos de carbono/i.test(e.t) && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(e.u); }); }), 'evidencia "Reporte bonos de carbono 2026"');
  });

  test('seed · seedDemoGestion no duplica si ya hay datos', function () {
    fresh('demo');
    var n = bootstrap().tasks.length;
    var rep = seedDemoGestion();
    eq(rep.skipped, true);
    eq(bootstrap().tasks.length, n);
  });
})();
