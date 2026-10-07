/* Regresión gestion-ui (FGestion/VGestion): contratos del servidor en los que se apoyan los arreglos
   PX-04 (las altas rápidas heredan sólo un indicador hoja del proyecto) y PX-05 (proyecto cerrado). */
(function () {
  function cascadeOf(b, pilar) {
    var group = b.cascade.find(function (c) { return c.pilar === pilar && !c.padre && b.cascade.some(function (k) { return k.padre === c.id; }); });
    ok(group, 'no encontré un grupo Cascade con hijos en ' + pilar);
    var leaf = b.cascade.find(function (c) { return c.padre === group.id; });
    return { group: group, leaf: leaf };
  }
  function find(b, coll, id) { var x = b[coll].find(function (e) { return e.id === id; }); ok(x, coll + ': no encontré ' + id); return x; }
  function mkProject(extra) {
    var b = client('gSave', Object.assign({ tipo: 'Proyecto', pilar: 'ec', nombre: 'Proyecto QA', resp: U.ina, estado: 'Activo', anio: '' }, extra || {}));
    return find(b, 'projects', b.lastId);
  }

  test('gestion-ui · alta rápida con proyecto: hereda el indicador hoja del proyecto (PX-04)', function () {
    need('gSave', 'bootstrap');
    fresh('setup');
    var cas = cascadeOf(client('bootstrap'), 'ec');
    var p = mkProject({ cascade: cas.leaf.id });
    // Payload de gestion.quickadd (VGestion) con el proyecto filtrado.
    var b = client('gSave', { tipo: 'Tarea', pilar: 'ec', nombre: 'QA rápida con proyecto', resp: U.ina, proyecto: p.id, cascade: cas.leaf.id });
    var t = find(b, 'tasks', b.lastId);
    eq(t.proyecto, p.id, 'proyecto');
    eq(t.cascade, cas.leaf.id, 'la tarea queda con el indicador del proyecto');
  });

  test('gestion-ui · un proyecto puede apuntar a un grupo, pero una tarea no (por eso el guard c.padre)', function () {
    fresh('setup');
    var cas = cascadeOf(client('bootstrap'), 'ec');
    var p = mkProject({ cascade: cas.group.id });
    eq(p.cascade, cas.group.id, 'el proyecto acepta un grupo');
    throws(function () { gSave({ tipo: 'Tarea', pilar: 'ec', nombre: 'Con grupo', proyecto: p.id, cascade: cas.group.id }); }, /no el grupo/i);
    // Sin indicador (lo que envían las altas rápidas cuando el del proyecto es un grupo) sí se acepta.
    var b = client('gSave', { tipo: 'Tarea', pilar: 'ec', nombre: 'Sin indicador', proyecto: p.id, cascade: '' });
    eq(find(b, 'tasks', b.lastId).cascade, '', 'sin indicador');
  });

  test('gestion-ui · proyecto cerrado: rechaza tareas nuevas, admite editar las que ya tiene y reabrirlo (PX-05)', function () {
    fresh('setup');
    var p = mkProject();
    var b = client('gSave', { tipo: 'Tarea', pilar: 'ec', nombre: 'Antes del cierre', resp: U.ina, proyecto: p.id, estado: 'Pendiente' });
    var tid = b.lastId;
    client('gSave', { tipo: 'Proyecto', id: p.id, estado: 'Cerrado' });
    throws(function () { gSave({ tipo: 'Tarea', pilar: 'ec', nombre: 'Nueva en cerrado', proyecto: p.id }); }, /cerrado/i);
    // Editar una tarea que ya estaba en el proyecto cerrado (fgProjectSelect lo conserva con keep).
    b = client('gSave', { tipo: 'Tarea', id: tid, pilar: 'ec', nombre: 'Antes del cierre (editada)', proyecto: p.id, fecha: day(5) });
    eq(find(b, 'tasks', tid).proyecto, p.id, 'la tarea sigue en el proyecto cerrado');
    // project.reopen: payload completo (fgProjectPayload) con estado Activo.
    var cur = find(b, 'projects', p.id);
    b = client('gSave', { tipo: 'Proyecto', id: cur.id, pilar: cur.pilar, nombre: cur.nombre, detalle: cur.detalle, resp: cur.resp, estado: 'Activo',
      anio: cur.anio ? String(cur.anio) : '', lineas: cur.lineas.slice(), cascade: cur.cascade, evidencias: cur.evidencias });
    eq(find(b, 'projects', p.id).estado, 'Activo', 'reabierto');
    b = client('gSave', { tipo: 'Tarea', pilar: 'ec', nombre: 'Nueva tras reabrir', proyecto: p.id });
    eq(find(b, 'tasks', b.lastId).proyecto, p.id, 'acepta tareas nuevas tras reabrir');
  });
})();
