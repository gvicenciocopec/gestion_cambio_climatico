/* Comentarios en líneas (L-), proyectos (PRJ-) y tareas (TSK-) · SPEC §5 */
(function () {
  function ids() {
    var b = bootstrap();
    return { line: b.budget['2026'][3].id, project: b.projects[0].id, task: b.tasks[0].id };
  }

  test('comentarios · commentAdd valida referencia y texto', function () {
    need('commentAdd');
    fresh('demo');
    var r = ids();
    throws(function () { commentAdd('XYZ-123', 'hola'); }, /referencia|comentar/i, 'ref inválida');
    throws(function () { commentAdd('CAS-12345678', 'hola'); }, /referencia|comentar/i, 'no se comenta un indicador Cascade');
    throws(function () { commentAdd(r.project, '   '); }, /vac/i, 'texto vacío');
    throws(function () { commentAdd(r.project, 'x'.repeat(4001)); }, /4[.]?000/, 'más de 4000');
    throws(function () { commentAdd('PRJ-00000000', 'hola'); }, /encontr/i, 'proyecto inexistente');
    throws(function () { commentAdd('TSK-00000000', 'hola'); }, /encontr/i, 'tarea inexistente');
    var b = commentAdd(r.project, 'x'.repeat(4000));
    eq(b.comments.find(function (c) { return c.id === b.lastId; }).texto.length, 4000, 'acepta 4000');
  });

  test('comentarios · autor = usuario actual; funciona en línea, proyecto y tarea', function () {
    fresh('demo');
    var r = ids();
    [r.line, r.project, r.task].forEach(function (ref) {
      var b = asUser(U.ina, function () { return client('commentAdd', ref, '  Comentario en ' + ref + '\ncon salto de línea  '); });
      ok(/^CMT-[0-9a-f]{8}$/.test(b.lastId), 'lastId CMT-');
      var c = b.comments.find(function (x) { return x.id === b.lastId; });
      eq(c.ref, ref); eq(c.autor, U.ina, 'autor'); eq(c.texto, 'Comentario en ' + ref + '\ncon salto de línea', 'texto recortado, conserva saltos');
      ok(!isNaN(Date.parse(c.creado)), 'creado ISO');
    });
    var b2 = bootstrap();
    var mine = b2.comments.filter(function (c) { return c.autor === U.ina && /^Comentario en/.test(c.texto); });
    eq(mine.length, 3);
    ok(b2.comments.every(function (c, i, a) { return i === 0 || a[i - 1].creado <= c.creado; }), 'ordenados del más antiguo al más nuevo');
  });

  test('comentarios · sólo el autor o un administrador puede eliminar', function () {
    need('commentDelete');
    fresh('demo');
    var ref = ids().project;
    var id = asUser(U.ina, function () { return commentAdd(ref, 'de Ina').lastId; });
    asUser(U.benja, function () { throws(function () { commentDelete(id); }, /autor|escribi|administrador/i, 'Benja no puede'); });
    asUser('', function () { throws(function () { commentDelete(id); }, /autor|escribi|administrador/i, 'usuario desconocido no puede'); });
    var b = asUser(U.ina, function () { return client('commentDelete', id); });
    ok(!b.comments.some(function (c) { return c.id === id; }), 'la autora sí puede');
    var id2 = asUser(U.ignacio, function () { return commentAdd(ref, 'de Ignacio').lastId; });
    var b2 = asUser(U.gonzalo, function () { return commentDelete(id2); });
    ok(!b2.comments.some(function (c) { return c.id === id2; }), 'el administrador puede');
    throws(function () { commentDelete(id2); }, /encontr/i, 'ya eliminado');
  });

  test('comentarios · links en el texto se guardan tal cual (el cliente los convierte con linkify)', function () {
    fresh('demo');
    var url = 'https://docs.google.com/spreadsheets/d/1AbCbonosCarbono2026Xy7QzK/edit#gid=0';
    var b = commentAdd(ids().task, 'Ver ' + url + ' <b>ok</b>');
    var c = b.comments.find(function (x) { return x.id === b.lastId; });
    eq(c.texto, 'Ver ' + url + ' <b>ok</b>', 'sin escapar en el servidor (el cliente usa esc/linkify)');
  });
})();
