/* Regresiones del asistente (fixer "assistant") · PX-12: el cierre de una tarea reabierta no se indexa */
(function () {
  var CIERRE = 'Se envió el informe zafiro a gerencia';
  var EV_URL = 'https://drive.google.com/file/d/1ZafiroInforme/view';

  function mk() {
    return gSave({ tipo: 'Tarea', pilar: 'cc', nombre: 'Preparar reporte trimestral', resp: U.ina, fecha: day(10),
      evidencias: [{ t: 'Borrador', u: EV_URL }] }).lastId;
  }
  function docsOf(id) {
    var docs = aiCorpus_(ss_());
    return {
      task: docs.find(function (d) { return d.type === 'task' && d.refId === id; }),
      ev: docs.find(function (d) { return d.type === 'evidence' && d.refId === id; }),
    };
  }
  function hitsTask(r, id) { return r.results.some(function (s) { return s.type === 'task' && s.refId === id; }); }

  test('fix asistente · tarea realizada: su comentario de cierre se indexa', function () {
    need('ask', 'aiCorpus_', 'gSave', 'taskComplete');
    fresh('setup');
    var id = mk();
    taskComplete(id, { cierre: CIERRE });
    var d = docsOf(id);
    ok(d.task, 'hay documento de la tarea');
    includes(d.task.text, 'Comentario de cierre: ' + CIERRE, 'el texto de la tarea realizada');
    ok(d.ev, 'hay documento de la evidencia');
    includes(d.ev.text, 'Cierre de la tarea: ' + CIERRE, 'el texto de la evidencia de la tarea realizada');
    ok(hitsTask(client('ask', 'informe zafiro enviado'), id), 'la búsqueda encuentra la tarea realizada por su cierre');
  });

  test('fix asistente · tarea reabierta: el cierre antiguo no se indexa (ni en la tarea ni en su evidencia)', function () {
    need('ask', 'aiCorpus_', 'gSave', 'taskComplete', 'taskReopen');
    fresh('setup');
    var id = mk();
    taskComplete(id, { cierre: CIERRE });
    var b = taskReopen(id);
    var t = b.tasks.find(function (x) { return x.id === id; });
    eq(t.estado, 'Pendiente', 'reabierta');
    var d = docsOf(id);
    ok(d.task, 'hay documento de la tarea');
    ok(d.task.text.indexOf('zafiro') < 0 && d.task.text.indexOf('Comentario de cierre') < 0, 'sin cierre antiguo en la tarea: ' + d.task.text);
    ok(d.task.ctx.indexOf('zafiro') < 0, 'sin cierre antiguo en el contexto para Gemini');
    ok(d.ev, 'hay documento de la evidencia');
    ok(d.ev.text.indexOf('zafiro') < 0 && d.ev.text.indexOf('Cierre de la tarea') < 0, 'sin cierre antiguo en la evidencia: ' + d.ev.text);
    ok(!hitsTask(client('ask', 'informe zafiro enviado'), id), 'la búsqueda no devuelve la tarea pendiente por su cierre antiguo');
  });
})();
