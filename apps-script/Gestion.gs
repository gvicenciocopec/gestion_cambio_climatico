/**
 * Gestión · proyectos, tareas, comentarios y catálogo Cascade.
 * Base de datos: pestaña oculta "Gestión" (una sola tabla polimórfica, SPEC §1.2 + §13.1).
 * Se lee siempre por nombre de encabezado; las columnas desconocidas se respetan.
 * Toda escritura pasa por mutateG_() (lock + bundle PARCIAL de Gestión, SPEC §14.1) y deja registro con log_().
 * v3.2 (SPEC §15): una tarea nueva sin proyecto es privada por defecto y con proyecto, compartida (sin identidad →
 * compartida); pasarla a un proyecto la comparte; tasksSetPrivacy cambia la privacidad de varias de una vez.
 * v3.1: carpeta de Drive por proyecto (columna Carpeta; la crea/renombra Drive.gs fuera del lock, SPEC §14.3) y
 * taskReorder liviano ({ok, ids}, sin bundle).
 * v3: tareas privadas (sólo las ven quien la creó y su responsable; el servidor lo aplica en el bundle y en cada
 * cambio), aviso por correo opcional por tarea, orden manual, tareas personales sin pilar, fechas de proyecto
 * (inicio / término) e importación de proyectos desde el catálogo Cascade.
 */

const G_HEADERS = [
  'ID', 'Tipo', 'Pilar', 'Padre', 'Nombre', 'Detalle', 'Responsable', 'Fecha', 'Estado', 'Clase', 'Cascade',
  'Evidencias', 'Presupuesto', 'Año', 'Cierre', 'Completada', 'Creado por', 'Creado', 'Actualizado por',
  'Actualizado', 'Notificado', 'Orden', 'Avisar', 'Privada', 'Inicio', 'Carpeta', 'Asignados',
];
const G_TIPOS = ['Proyecto', 'Tarea', 'Comentario', 'Cascade'];
const G_TIPO_LABEL = { Proyecto: 'proyecto', Tarea: 'tarea', Comentario: 'comentario', Cascade: 'indicador Cascade' };
const G_PRJ_ESTADOS = ['Activo', 'En pausa', 'Cerrado'];
const G_CLASES = ['kpi', 'accion', 'objetivo', 'hito'];
const G_DATE_HEADERS = ['Fecha', 'Completada', 'Creado', 'Actualizado', 'Inicio'];
const G_LIMITS = { nombre: 300, detalle: 10000, cierre: 4000, comentario: 4000, etiqueta: 200, evTitle: 200, evUrl: 2000, evMax: 30, orden: 1000, privacidad: 500, asignados: 10 };
const G_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Mismo mensaje para una tarea que no existe y para una privada ajena (no se revela que existe)
const G_NO_TASK = 'No encontré la tarea (¿la eliminaron?). Actualiza los datos.';
const G_PRIVATE_LABEL = 'Tarea privada'; // así aparece una tarea privada en el Historial
const G_NO_IDENTITY_PRIVATE = 'No pude identificar tu cuenta de Google, así que una tarea privada no la podrías ver ni tú. ' +
  'Déjala compartida o entra con tu cuenta Copec.';
const G_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/';

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

// Crea o edita un Proyecto, Tarea o indicador Cascade. Sin id → crea. Devuelve el bundle parcial con lastId.
// Proyecto nuevo / renombrado / con otro pilar → carpeta de Drive (Drive.gs) DESPUÉS de soltar el lock (gDriveHook_).
// La columna Carpeta no se edita desde el cliente (sólo Drive.gs, con gSetProjectFolder_).
function gSave(entity) {
  const e = entity && typeof entity === 'object' ? entity : {};
  const tipo = gTipo_(e.tipo);
  if (tipo !== 'Proyecto' && tipo !== 'Tarea' && tipo !== 'Cascade') {
    throw new Error('Tipo de registro inválido: usa Proyecto, Tarea o Cascade.');
  }
  const st = { drive: null }; // {sync, project} para gDriveHook_
  return mutateG_(() => gSaveCore_(e, tipo, st), () => gDriveHook_(st.drive));
}

// Núcleo de gSave: valida y escribe UN registro. Debe correr con el lock tomado (lo usa también la bandeja de
// WhatsApp, que importa varias tareas dentro de un solo lock). La identidad sale de me_() (ver asUser_).
function gSaveCore_(e, tipo, st) {
  const sh = gSheet_(ss_());
  const t = gTable_(sh);
  const raws = gAll_(t);
  const id = str_(e.id);
  const me = me_();
  let cur = null;
  if (id) {
    cur = raws.find(r => r.id === id) || null;
    if (cur && cur.tipo === 'Tarea' && !gTaskVisible_(cur, me)) throw new Error(G_NO_TASK); // privada ajena
    if (!cur) throw new Error('No encontré este registro (¿alguien lo eliminó?). Actualiza los datos e intenta de nuevo.');
    if (cur.tipo !== tipo) throw new Error('El registro ' + id + ' no es de tipo ' + tipo + '.');
    // Control de versión opcional: base = "actualizado" que el cliente vio al abrir el formulario
    if (e.base != null && gIso_(e.base) !== cur.actualizado) gConflict_(cur);
  }
  const prev = cur ? gEntity_(tipo, cur) : null;
  const ctx = { raws: raws, id: id, me: me };
  const next = tipo === 'Proyecto' ? gCheckProject_(e, prev, ctx)
    : tipo === 'Tarea' ? gCheckTask_(e, prev, ctx)
      : gCheckCascade_(e, prev, ctx);

  const newId = id || gNewId_(raws, tipo === 'Proyecto' ? 'PRJ' : tipo === 'Tarea' ? 'TSK' : 'CAS');
  const now = new Date();
  const fields = gFields_(tipo, next);
  fields.ID = newId;
  fields.Tipo = tipo;
  fields['Actualizado por'] = me;
  fields.Actualizado = now;
  if (!cur) {
    fields['Creado por'] = me;
    fields.Creado = now;
  }
  const row = cur ? t.values[cur._i].slice() : gBlankRow_(t);
  const rowIdx = cur ? cur._i : t.values.length;
  gApply_(t, row, fields);
  gWriteRows_(sh, rowIdx + 1, [row]);
  if (tipo === 'Proyecto' && (!cur || prev.nombre !== next.nombre || prev.pilar !== next.pilar)) {
    const raw = gRaw_(t, row); // lo recién escrito (incluye la Carpeta que ya tenía)
    st.drive = { sync: !!cur, project: gProject_(raw, raw.cascade ? { [raw.cascade]: true } : {}) };
  }

  // Cambio de pilar: las tareas del proyecto / indicadores del grupo se mueven con él
  let extra = '';
  if (cur && prev.pilar !== next.pilar && (tipo === 'Proyecto' || (tipo === 'Cascade' && !next.padre))) {
    const kids = raws.filter(r => r.id !== newId && r.padre === newId && r.tipo === (tipo === 'Proyecto' ? 'Tarea' : 'Cascade'));
    if (kids.length && t.idx.Pilar >= 0) {
      // También cambia su versión (Actualizado): un formulario abierto sobre ellas verá el conflicto
      kids.forEach(r => gSetCells_(t, r._i, { Pilar: pillarArea_(next.pilar), 'Actualizado por': me, Actualizado: now }));
      extra = ' · ' + kids.length + (tipo === 'Proyecto'
        ? (kids.length === 1 ? ' tarea movida' : ' tareas movidas')
        : (kids.length === 1 ? ' indicador movido' : ' indicadores movidos')) + ' de pilar';
    }
  }
  if (ctx.dropped) {
    extra += ' · ' + ctx.dropped + (ctx.dropped === 1 ? ' línea desvinculada' : ' líneas desvinculadas') + ' (eran del pilar anterior)';
  }
  const verb = (cur ? 'Editar ' : 'Crear ') + G_TIPO_LABEL[tipo];
  if (tipo === 'Tarea' && next.privada) {
    // Historial: una tarea privada no muestra su nombre, su responsable ni sus detalles
    log_(verb, G_PRIVATE_LABEL, prev && !prev.privada ? 'Ahora es privada' : '');
    return { lastId: newId };
  }
  log_(verb, next.nombre, gDescribe_(tipo, prev, next, gNames_(raws)) + extra);
  return { lastId: newId };
}

// Elimina un registro y limpia sus referencias (SPEC §5).
function gDelete(id) {
  id = str_(id);
  if (!id) throw new Error('Falta el identificador del registro.');
  return mutateG_(() => {
    const sh = ss_().getSheetByName(CONFIG.GESTION_SHEET);
    const t = sh ? gTable_(sh) : null;
    const raws = t ? gAll_(t) : [];
    const cur = raws.find(r => r.id === id);
    const me = me_();
    if (cur && cur.tipo === 'Tarea' && !gTaskVisible_(cur, me)) throw new Error(G_NO_TASK);
    if (!cur) throw new Error('No encontré este registro (¿ya fue eliminado?). Actualiza los datos.');
    if (cur.tipo === 'Comentario') {
      gAssertCommentRef_(raws, cur, me);
      gAssertCommentOwner_(cur);
    }
    if (cur.tipo === 'Cascade' && !cur.padre && raws.some(r => r.tipo === 'Cascade' && r.padre === id)) {
      throw new Error('Elimina primero sus indicadores.');
    }
    const del = [cur._i];
    const clearPadre = [];
    const clearCascade = [];
    raws.forEach(r => {
      if (r.id === id) return;
      if (r.tipo === 'Comentario' && r.padre === id) del.push(r._i);
      else if (cur.tipo === 'Proyecto' && r.tipo === 'Tarea' && r.padre === id) clearPadre.push(r._i);
      if (cur.tipo === 'Cascade' && (r.tipo === 'Tarea' || r.tipo === 'Proyecto') && r.cascade === id) clearCascade.push(r._i);
    });
    // Primero se editan referencias (índices estables), luego se borran filas de abajo hacia arriba
    gClearColumn_(t, 'Padre', clearPadre);
    gClearColumn_(t, 'Cascade', clearCascade);
    gDeleteRows_(sh, del.map(i => i + 1));

    const parts = [];
    if (clearPadre.length) parts.push(clearPadre.length + (clearPadre.length === 1 ? ' tarea quedó sin proyecto' : ' tareas quedaron sin proyecto'));
    if (clearCascade.length) parts.push(clearCascade.length + (clearCascade.length === 1 ? ' registro quedó sin indicador' : ' registros quedaron sin indicador'));
    if (del.length > 1) parts.push((del.length - 1) + (del.length === 2 ? ' comentario eliminado' : ' comentarios eliminados'));
    if (cur.tipo === 'Comentario') {
      const hide = gRefPrivate_(raws, cur.padre);
      log_('Eliminar comentario', hide ? G_PRIVATE_LABEL : (gNames_(raws)[cur.padre] || cur.padre), hide ? '' : gExcerpt_(cur.detalle, 140));
    } else if (cur.tipo === 'Tarea' && cur.privada) {
      log_('Eliminar tarea', G_PRIVATE_LABEL, '');
    } else {
      log_('Eliminar ' + G_TIPO_LABEL[cur.tipo], cur.nombre, parts.join(' · '));
    }
    return {};
  });
}

// Marca una tarea como realizada. v3: el comentario de cierre es opcional (un check rápido lo deja vacío y se
// puede agregar después con gSave); fecha por defecto hoy; evidencias opcionales (se agregan a las existentes).
function taskComplete(id, data) {
  id = str_(id);
  const d = data && typeof data === 'object' ? data : {};
  const cierre = gLong_(d.cierre, G_LIMITS.cierre, 'El comentario de cierre');
  const completada = str_(d.completada) ? gDateIn_(d.completada, 'La fecha de realización') : today_();
  if (completada > today_()) throw new Error('La fecha de realización no puede ser futura.');
  const nuevas = gCleanEvidence_(d.evidencias);
  return mutateG_(() => {
    const sh = gSheet_(ss_());
    const t = gTable_(sh);
    const raws = gAll_(t);
    const cur = raws.find(r => r.id === id);
    const me = me_();
    if (!cur || cur.tipo !== 'Tarea' || !gTaskVisible_(cur, me)) throw new Error(G_NO_TASK);
    // Dos personas marcándola a la vez: la segunda no pisa el cierre de la primera (editar el cierre va por gSave)
    if (gTaskDone_(cur.estado)) {
      throw new Error('Esta tarea ya fue marcada como realizada' + gByOther_(cur) + '. Actualiza los datos.');
    }
    const evs = gMergeEv_(cur.evidencias, nuevas);
    const row = t.values[cur._i].slice();
    gApply_(t, row, {
      Estado: 'Realizada',
      Cierre: cierre,
      Completada: toDate_(completada),
      Evidencias: gEvJson_(evs),
      'Actualizado por': me,
      Actualizado: new Date(),
    });
    gWriteRows_(sh, cur._i + 1, [row]);
    const added = evs.length - cur.evidencias.length;
    const plusEv = added > 0 ? '+' + added + (added === 1 ? ' evidencia' : ' evidencias') : '';
    if (cur.privada) log_('Completar tarea', G_PRIVATE_LABEL, plusEv);
    else log_('Completar tarea', cur.nombre, [cierre ? gExcerpt_(cierre, 160) : 'Sin comentario de cierre', plusEv].filter(Boolean).join(' · '));
    return { lastId: id };
  });
}

// Reabre una tarea realizada (mantiene el texto de cierre; queda en el historial).
// Conserva la marca de aviso (es por fecha): marcar y desmarcar no reenvía el aviso de vencida (SPEC §17).
function taskReopen(id) {
  id = str_(id);
  return mutateG_(() => {
    const sh = gSheet_(ss_());
    const t = gTable_(sh);
    const raws = gAll_(t);
    const cur = raws.find(r => r.id === id);
    const me = me_();
    if (!cur || cur.tipo !== 'Tarea' || !gTaskVisible_(cur, me)) throw new Error(G_NO_TASK);
    // Ya pendiente (p. ej. otra persona la reabrió): no se borran sus marcas de aviso
    if (!gTaskDone_(cur.estado)) {
      throw new Error('Esta tarea ya está pendiente (no está marcada como realizada). Actualiza los datos.');
    }
    const row = t.values[cur._i].slice();
    gApply_(t, row, {
      Estado: 'Pendiente',
      Completada: '',
      'Actualizado por': me,
      Actualizado: new Date(),
    });
    gWriteRows_(sh, cur._i + 1, [row]);
    if (cur.privada) log_('Reabrir tarea', G_PRIVATE_LABEL, '');
    else log_('Reabrir tarea', cur.nombre, cur.cierre ? 'Cierre anterior: ' + gExcerpt_(cur.cierre, 300) : '');
    return { lastId: id };
  });
}

// Orden manual de mi lista (SPEC §13.1): Orden = 1..n en el orden recibido. Cada tarea debe ser visible para mí.
// No cambia la versión (Actualizado) de las tareas: reordenar no choca con un formulario abierto.
// v3.1 (SPEC §14.1): respuesta LIVIANA {ok:true, ids} sin bundle (el cliente ya aplicó el orden y sólo envía el
// último); tampoco se anota en el Historial (ordenar la lista personal no es un cambio que auditar).
function taskReorder(ids) {
  const list = [];
  (Array.isArray(ids) ? ids : []).forEach(x => {
    const s = str_(x);
    if (s && list.indexOf(s) < 0) list.push(s);
  });
  if (!list.length) throw new Error('No hay tareas para ordenar.');
  if (list.length > G_LIMITS.orden) throw new Error('Demasiadas tareas para ordenar de una vez (máximo ' + G_LIMITS.orden + ').');
  assertMember_();
  withLock_(() => {
    const sh = gSheet_(ss_());
    const t = gTable_(sh);
    const me = me_();
    const byId = {};
    gAll_(t).forEach(r => { if (r.tipo === 'Tarea') byId[r.id] = r; });
    list.forEach(id => { if (!byId[id] || !gTaskVisible_(byId[id], me)) throw new Error(G_NO_TASK); });
    gSetColumn_(t, 'Orden', list.map((id, k) => [byId[id]._i, k + 1]));
  });
  return { ok: true, ids: list };
}

// Hace públicas (privada false) o privadas (true) varias tareas de una vez (SPEC §15) → bundle parcial.
// Cada tarea debe ser visible para mí y debo ser quien la creó o su responsable (el administrador no se salta esto);
// si una falla no se cambia ninguna. Ids sin repetir, máximo G_LIMITS.privacidad. Una sola escritura (Privada +
// Actualizado / Actualizado por) y una sola línea en el Historial, sin nombres cuando quedan privadas.
// Las que ya estaban así no se tocan (no cambia su versión).
function tasksSetPrivacy(ids, privada) {
  const list = [];
  (Array.isArray(ids) ? ids : ids == null ? [] : [ids]).forEach(x => {
    const s = str_(x);
    if (s && list.indexOf(s) < 0) list.push(s);
  });
  if (!list.length) throw new Error('No hay tareas seleccionadas.');
  if (list.length > G_LIMITS.privacidad) {
    throw new Error('Demasiadas tareas de una vez (máximo ' + G_LIMITS.privacidad + ').');
  }
  const priv = gBoolIn_(privada, null);
  if (priv === null) throw new Error('Indica si las tareas quedan privadas o públicas.');
  return mutateG_(() => {
    const sh = gSheet_(ss_());
    const t = gTable_(sh);
    const me = me_();
    if (priv && !gKnown_(me)) throw new Error(G_NO_IDENTITY_PRIVATE);
    const byId = {};
    gAll_(t).forEach(r => { if (r.tipo === 'Tarea') byId[r.id] = r; });
    list.forEach(id => {
      const r = byId[id];
      if (!r || !gTaskVisible_(r, me)) throw new Error(G_NO_TASK);
      if (!gTaskOwner_(r, me)) throw new Error('Sólo quien creó la tarea o su responsable puede cambiar su privacidad.');
    });
    // v3.6 (SPEC §20): una tarea con varias personas es del equipo y no pasa a privada
    const changed = list.map(id => byId[id]).filter(r => r.privada !== priv && !(priv && r.asignados.length));
    if (!changed.length) return {};
    const now = new Date();
    gSetBlock_(t, changed.map(r => [r._i, { Privada: priv ? 'Sí' : 'No', 'Actualizado por': me, Actualizado: now }]));
    const n = changed.length;
    const what = n + (n === 1 ? ' tarea ahora ' + (priv ? 'privada' : 'pública') : ' tareas ahora ' + (priv ? 'privadas' : 'públicas'));
    log_('Cambiar privacidad', what, priv ? '' : gExcerpt_(changed.map(r => r.nombre).join(' · '), 600));
    return {};
  });
}

// Ajustes (admin): crea los proyectos (y tareas de hitos) que falten desde el catálogo Cascade (SPEC §13.1).
// Idempotente: nunca duplica un proyecto o tarea que ya apunta a ese indicador. → bundle parcial + lastImport {projects, tasks}
// (las carpetas de Drive de estos proyectos se crean aparte: driveCreateMissing en Ajustes)
function importCascadeProjects() {
  if (!isAdmin_()) throw new Error('Sólo un administrador puede importar los proyectos de Cascade.');
  let res = { projects: 0, tasks: 0 };
  const b = mutateG_(() => {
    res = gImportCascadeProjects_();
    return {};
  });
  if (b && typeof b === 'object') b.lastImport = { projects: res.projects, tasks: res.tasks };
  return b;
}

// Agrega un comentario a una línea de presupuesto (L-), proyecto (PRJ-) o tarea (TSK-).
function commentAdd(ref, texto) {
  ref = str_(ref);
  if (!/^(L|PRJ|TSK)-[0-9a-f]{8}$/i.test(ref)) throw new Error('No se puede comentar aquí: referencia inválida.');
  const txt = String(texto == null ? '' : texto).trim();
  if (!txt) throw new Error('El comentario está vacío.');
  if (txt.length > G_LIMITS.comentario) throw new Error('El comentario no puede superar ' + gThousands_(G_LIMITS.comentario) + ' caracteres.');
  // También en líneas de presupuesto: el comentario vive en Gestión, así que basta el bundle parcial
  return mutateG_(() => {
    const ss = ss_();
    const sh = gSheet_(ss);
    const t = gTable_(sh);
    const raws = gAll_(t);
    const me = me_();
    let label = '';
    let hide = false;
    if (/^(PRJ|TSK)-/i.test(ref)) {
      const target = raws.find(r => r.id === ref && (r.tipo === 'Proyecto' || r.tipo === 'Tarea'));
      if (target && target.tipo === 'Tarea' && !gTaskVisible_(target, me)) throw new Error(G_NO_TASK);
      if (!target) throw new Error('No encontré el proyecto o la tarea (¿lo eliminaron?). Actualiza los datos.');
      label = target.nombre;
      hide = target.tipo === 'Tarea' && target.privada;
    } else {
      // La línea debe existir (comparación exacta): evita comentarios huérfanos de una línea ya eliminada
      label = gLineLabel_(ss, ref);
      if (!label) throw new Error('No encontré la línea de presupuesto (¿la eliminaron?). Actualiza los datos.');
    }
    const id = gNewId_(raws, 'CMT');
    const now = new Date();
    const row = gBlankRow_(t);
    gApply_(t, row, {
      ID: id, Tipo: 'Comentario', Padre: ref, Detalle: txt, Responsable: me,
      'Creado por': me, Creado: now, 'Actualizado por': me, Actualizado: now,
    });
    gWriteRows_(sh, t.values.length + 1, [row]);
    if (hide) log_('Comentar', G_PRIVATE_LABEL, '');
    else log_('Comentar', label, gExcerpt_(txt, 160));
    return { lastId: id };
  });
}

// Elimina un comentario (sólo su autor o un administrador).
function commentDelete(id) {
  id = str_(id);
  return mutateG_(() => {
    const sh = ss_().getSheetByName(CONFIG.GESTION_SHEET);
    const t = sh ? gTable_(sh) : null;
    const raws = t ? gAll_(t) : [];
    const cur = raws.find(r => r.id === id && r.tipo === 'Comentario');
    if (!cur) throw new Error('No encontré el comentario (¿ya fue eliminado?).');
    gAssertCommentRef_(raws, cur, me_());
    gAssertCommentOwner_(cur);
    gDeleteRows_(sh, [cur._i + 1]);
    const hide = gRefPrivate_(raws, cur.padre);
    log_('Eliminar comentario', hide ? G_PRIVATE_LABEL : (gNames_(raws)[cur.padre] || cur.padre), hide ? '' : gExcerpt_(cur.detalle, 140));
    return {};
  });
}

/* ------------------------------------------------------------------ */
/* Lectura (bundle)                                                    */
/* ------------------------------------------------------------------ */

// Lee la pestaña Gestión → {projects, tasks, cascade, comments} (SPEC §4). Nunca crea la hoja.
// Devuelve TODAS las tareas (también las privadas): quien sirve a un usuario filtra con gVisibleFilter_.
function gRead_(ss) {
  const out = { projects: [], tasks: [], cascade: [], comments: [] };
  const sh = (ss || ss_()).getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  const t = gTable_(sh);
  if (t.idx.ID < 0 || t.idx.Tipo < 0) return out;
  const raws = gAll_(t);

  // Referencias válidas (para no entregar ids huérfanos al cliente)
  const prjPilar = {};
  const casPilar = {};
  raws.forEach(r => {
    if (r.tipo === 'Proyecto' && r.pilar) prjPilar[r.id] = r.pilar;
    if (r.tipo === 'Cascade' && !r.padre && r.pilar) casPilar[r.id] = r.pilar;
  });
  raws.forEach(r => {
    if (r.tipo === 'Cascade' && r.padre && !r.pilar && casPilar[r.padre]) r.pilar = casPilar[r.padre];
    if (r.tipo === 'Tarea' && prjPilar[r.padre]) r.pilar = prjPilar[r.padre]; // con proyecto manda su pilar
  });
  const casIds = {};
  raws.forEach(r => { if (r.tipo === 'Cascade' && r.pilar) casIds[r.id] = true; });

  raws.forEach(r => {
    if (r.tipo === 'Proyecto' && r.pilar) out.projects.push(gProject_(r, casIds));
    else if (r.tipo === 'Tarea') out.tasks.push(gTask_(r, prjPilar, casIds)); // pilar '' = tarea personal
    else if (r.tipo === 'Cascade' && r.pilar) out.cascade.push(gCascade_(r));
    else if (r.tipo === 'Comentario' && r.padre && r.detalle) out.comments.push(gComment_(r));
  });

  const byName = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
  out.projects.sort(byName);
  out.tasks.sort((a, b) => {
    if (!a.fecha !== !b.fecha) return a.fecha ? -1 : 1;
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return byName(a, b);
  });
  out.cascade.sort((a, b) => a.orden - b.orden);
  out.comments.sort((a, b) => (a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0));
  return out;
}

function gProject_(r, casIds) {
  return {
    id: r.id,
    pilar: r.pilar,
    nombre: r.nombre,
    detalle: r.detalle,
    resp: r.resp,
    estado: gPrjEstado_(r.estado) || 'Activo',
    anio: r.anio,
    lineas: r.lineas,
    cascade: casIds[r.cascade] ? r.cascade : '',
    evidencias: r.evidencias,
    inicio: r.inicio,
    fin: r.fecha, // el término del proyecto se guarda en la columna Fecha
    carpeta: r.carpeta, // id de la carpeta de Drive (SPEC §14.3) o ''
    carpetaUrl: r.carpeta ? G_DRIVE_FOLDER_URL + r.carpeta : '',
    creadoPor: r.creadoPor,
    creado: r.creado,
    actualizadoPor: r.actualizadoPor,
    actualizado: r.actualizado,
  };
}

function gTask_(r, prjPilar, casIds) {
  return {
    id: r.id,
    pilar: r.pilar,
    proyecto: prjPilar[r.padre] ? r.padre : '',
    nombre: r.nombre,
    detalle: r.detalle,
    resp: r.resp,
    asignados: (r.asignados || []).slice(),
    fecha: r.fecha,
    estado: gTaskDone_(r.estado) ? 'Realizada' : 'Pendiente',
    cascade: casIds[r.cascade] ? r.cascade : '',
    evidencias: r.evidencias,
    cierre: r.cierre,
    completada: r.completada,
    avisar: r.avisar,
    privada: r.privada,
    orden: r.orden,
    creadoPor: r.creadoPor,
    creado: r.creado,
    actualizadoPor: r.actualizadoPor,
    actualizado: r.actualizado,
  };
}

function gCascade_(r) {
  return {
    id: r.id,
    pilar: r.pilar,
    padre: r.padre,
    nombre: r.nombre,
    etiqueta: r.detalle,
    clase: r.padre ? (gClase_(r.clase) || 'accion') : 'grupo',
    orden: r.orden,
  };
}

function gComment_(r) {
  return {
    id: r.id,
    ref: r.padre,
    texto: r.detalle,
    autor: r.resp || r.creadoPor,
    creado: r.creado,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers internos usados por otros módulos                           */
/* ------------------------------------------------------------------ */

// Visibilidad (SPEC §13.1): una tarea se ve si no es privada, o si la creé o soy su responsable (o una de sus personas).
// Sirve para la fila cruda (gAll_) y para la tarea del bundle. Sin correo identificado sólo se ven las compartidas.
// El administrador NO se salta la privacidad.
function gTaskVisible_(task, email) {
  if (!task) return false;
  if (!task.privada) return true;
  const me = str_(email).toLowerCase();
  if (!me || me === 'desconocido') return false;
  return str_(task.creadoPor).toLowerCase() === me || str_(task.resp).toLowerCase() === me ||
    (Array.isArray(task.asignados) && task.asignados.indexOf(me) >= 0);
}

// Lo que gRead_ entrega, visto por un usuario: sin las tareas privadas ajenas ni sus comentarios.
// Devuelve una copia ({projects, tasks, cascade, comments, ...}); úsalo en todo lo que sirve a un usuario (bundle, ask).
function gVisibleFilter_(data, email) {
  const d = data && typeof data === 'object' ? data : {};
  const tasks = [];
  const hidden = {};
  (d.tasks || []).forEach(x => {
    if (gTaskVisible_(x, email)) tasks.push(x);
    else if (x && x.id) hidden[x.id] = true;
  });
  return Object.assign({}, d, {
    tasks: tasks,
    comments: (d.comments || []).filter(c => c && !hidden[c.ref]),
  });
}

// Actualiza campos (por nombre de encabezado) de un registro. Llamar dentro del lock. → true si escribió.
function gUpdateFields_(sh, id, fields) {
  id = str_(id);
  if (!sh || !id || !fields) return false;
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || !lastCol) return false;
  const names = Object.keys(fields);
  const idx = headerIndex_(sh.getRange(1, 1, 1, lastCol).getValues()[0], ['ID'].concat(names));
  if (idx.ID < 0) return false;
  const ids = sh.getRange(2, idx.ID + 1, lastRow - 1, 1).getValues();
  let rowNum = -1;
  for (let k = 0; k < ids.length; k++) {
    if (str_(ids[k][0]) === id) { rowNum = k + 2; break; }
  }
  if (rowNum < 0) return false;
  const rng = sh.getRange(rowNum, 1, 1, lastCol);
  const row = rng.getValues()[0];
  let changed = false;
  names.forEach(n => {
    const j = idx[n];
    if (j == null || j < 0) return;
    row[j] = gCellValue_(n, fields[n]);
    changed = true;
  });
  if (changed) rng.setValues([row]);
  return changed;
}

// Al borrar una línea de presupuesto (dentro del lock de budgetDelete): la quita de los proyectos
// y elimina sus comentarios. → {projects, comments}
function gOnLineDeleted_(lineId) {
  const id = str_(lineId);
  const res = { projects: 0, comments: 0 };
  if (!id) return res;
  const sh = ss_().getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return res;
  const t = gTable_(sh);
  if (t.idx.ID < 0 || t.idx.Tipo < 0) return res;
  const raws = gAll_(t);
  const del = [];
  const me = me_();
  const now = new Date();
  raws.forEach(r => {
    if (r.tipo === 'Proyecto' && r.lineas.indexOf(id) >= 0 && t.idx.Presupuesto >= 0) {
      const rest = r.lineas.filter(x => x !== id);
      // Nueva versión del proyecto: un formulario abierto con la lista anterior no puede re-vincularla
      gSetCells_(t, r._i, { Presupuesto: rest.join(','), 'Actualizado por': me, Actualizado: now });
      res.projects++;
    } else if (r.tipo === 'Comentario' && r.padre === id) {
      del.push(r._i + 1);
    }
  });
  gDeleteRows_(sh, del);
  res.comments = del.length;
  return res;
}

// Importa proyectos desde el catálogo Cascade (SPEC §13.1). Llamar DENTRO del lock (importCascadeProjects / setup).
// Por cada grupo: cada hijo acción/objetivo → un Proyecto (cascade = hijo). Un grupo sin acciones ni objetivos →
// un Proyecto con su nombre (cascade = grupo) y sus hitos → Tareas de ese proyecto (sin fecha, compartidas, con aviso).
// Idempotente: se omite lo que ya tiene un proyecto (o tarea) con ese indicador.
// → {projects, tasks} creados (+ catalog: filas Cascade leídas)
function gImportCascadeProjects_(ss) {
  const res = { projects: 0, tasks: 0, catalog: 0 };
  const sh = gSheet_(ss || ss_());
  const t = gTable_(sh);
  const raws = gAll_(t);
  const cas = raws.filter(r => r.tipo === 'Cascade');
  res.catalog = cas.length;
  if (!cas.length) return res;
  const pilOrder = k => { const i = CONFIG.PILLARS.findIndex(p => p.key === k); return i < 0 ? 99 : i; };
  const byOrden = (a, b) => (a.orden - b.orden) || (a._i - b._i);
  const groups = cas.filter(r => !r.padre && r.pilar).sort((a, b) => (pilOrder(a.pilar) - pilOrder(b.pilar)) || byOrden(a, b));
  const kids = {};
  cas.filter(r => r.padre).forEach(r => { (kids[r.padre] = kids[r.padre] || []).push(r); });
  const prjByCas = {};
  const taskCas = {};
  raws.forEach(r => {
    if (r.tipo === 'Proyecto' && r.cascade && !prjByCas[r.cascade]) prjByCas[r.cascade] = r.id;
    if (r.tipo === 'Tarea' && r.cascade) taskCas[r.cascade] = true;
  });
  const used = {};
  raws.forEach(r => { used[r.id] = true; });
  const newId = prefix => { let id = uid_(prefix); while (used[id]) id = uid_(prefix); used[id] = true; return id; };
  const me = me_();
  const now = new Date();
  const audit = { 'Creado por': me, Creado: now, 'Actualizado por': me, Actualizado: now };
  const rows = [];
  const addProject = (nombre, area, casId, detalle) => {
    const id = newId('PRJ');
    rows.push(gApply_(t, gBlankRow_(t), Object.assign({
      ID: id, Tipo: 'Proyecto', Pilar: area, Nombre: nombre, Detalle: detalle, Estado: 'Activo', Cascade: casId,
    }, audit)));
    prjByCas[casId] = id;
    res.projects++;
    return id;
  };
  groups.forEach(g => {
    const area = pillarArea_(g.pilar);
    const list = (kids[g.id] || []).slice().sort(byOrden);
    const acts = list.filter(k => { const c = gClase_(k.clase) || 'accion'; return c === 'accion' || c === 'objetivo'; });
    const origen = 'Proyecto creado desde Cascade · ' + g.nombre + (g.detalle ? ' (' + g.detalle + ')' : '') + '.';
    if (acts.length) {
      acts.forEach(k => { if (!prjByCas[k.id]) addProject(gExcerpt_(k.nombre, G_LIMITS.nombre), area, k.id, origen); });
      return;
    }
    const hitos = list.filter(k => gClase_(k.clase) === 'hito');
    const pid = prjByCas[g.id] || addProject(gExcerpt_(g.nombre, G_LIMITS.nombre), area, g.id, origen);
    hitos.forEach(h => {
      if (taskCas[h.id]) return;
      rows.push(gApply_(t, gBlankRow_(t), Object.assign({
        ID: newId('TSK'), Tipo: 'Tarea', Pilar: area, Padre: pid, Nombre: gExcerpt_(h.nombre, G_LIMITS.nombre),
        Estado: 'Pendiente', Cascade: h.id, Avisar: 'Sí', Privada: 'No',
      }, audit)));
      taskCas[h.id] = true;
      res.tasks++;
    });
  });
  if (rows.length) {
    gWriteRows_(sh, t.values.length + 1, rows);
    log_('Importar proyectos Cascade', 'Catálogo Cascade', res.projects + (res.projects === 1 ? ' proyecto' : ' proyectos') +
      ' · ' + res.tasks + (res.tasks === 1 ? ' tarea' : ' tareas') + ' (hitos)');
  }
  return res;
}

// Proyecto que tiene vinculada una línea (lee la tabla cruda) → {id, nombre, pilar} | null.
// Para budgetSave: impedir cambiar el área de una línea vinculada a un proyecto de otro pilar.
function gLineProject_(lineId) {
  const id = str_(lineId);
  if (!id) return null;
  const sh = ss_().getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const t = gTable_(sh);
  if (t.idx.ID < 0 || t.idx.Tipo < 0) return null;
  const p = gAll_(t).find(r => r.tipo === 'Proyecto' && r.lineas.indexOf(id) >= 0);
  return p ? { id: p.id, nombre: p.nombre, pilar: p.pilar } : null;
}

/* ---------- v3.1: carpeta de Drive por proyecto (SPEC §14.3; la lógica de Drive vive en Drive.gs) ---------- */

// Para Drive.gs: guarda (o borra, folderId '') el id de la carpeta del proyecto en la columna Carpeta.
// NO toma el lock: llamar DENTRO de withLock_. No cambia la versión del proyecto (Actualizado): no choca con un
// formulario abierto. → true si quedó guardado; false si el proyecto no existe (¿lo eliminaron?).
function gSetProjectFolder_(projectId, folderId) {
  const id = str_(projectId);
  const fid = str_(folderId);
  if (fid && gFolderId_(fid) !== fid) throw new Error('Identificador de carpeta de Drive inválido: ' + fid.slice(0, 80));
  if (!id) return false;
  const ss = ss_();
  if (!ss.getSheetByName(CONFIG.GESTION_SHEET)) return false;
  const t = gTable_(gSheet_(ss)); // gSheet_ agrega la columna Carpeta si falta (planillas v3)
  if (t.idx.ID < 0 || t.idx.Carpeta < 0) return false;
  const r = gAll_(t).find(x => x.id === id && x.tipo === 'Proyecto');
  if (!r) return false;
  if (str_(gGet_(t, t.values[r._i], 'Carpeta')) !== fid) gSetCells_(t, r._i, { Carpeta: fid });
  return true;
}

// Después de guardar un proyecto (FUERA del lock: Drive es lento y Drive.gs toma el lock sólo para escribir la
// columna Carpeta). Nuevo → driveEnsureFolder_; renombrado o con otro pilar → driveSyncFolder_. Opcional (typeof:
// Drive.gs puede no estar) y best-effort: nunca hace fallar el guardado. job = {sync, project (forma del bundle)}.
function gDriveHook_(job) {
  if (!job || !job.project || !job.project.id) return;
  const name = job.sync ? 'driveSyncFolder_' : 'driveEnsureFolder_';
  try {
    if (job.sync) {
      if (typeof driveSyncFolder_ === 'function') driveSyncFolder_(job.project);
    } else if (typeof driveEnsureFolder_ === 'function') {
      driveEnsureFolder_(job.project);
    }
  } catch (e) {
    console.error('gSave: ' + name + ' falló para ' + job.project.id + ' (el proyecto quedó guardado): ' + (e && e.message));
  }
}

// Id de carpeta de Drive desde la celda: el id tal cual o un link (…/folders/<id>, …?id=<id>). Sólo [A-Za-z0-9_-]
// (va en una URL); cualquier otra cosa → ''.
function gFolderId_(v) {
  const s = str_(v);
  if (!s) return '';
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  const id = m ? m[1] : s;
  return /^[\w-]{1,200}$/.test(id) ? id : '';
}

/* ------------------------------------------------------------------ */
/* Hoja                                                                */
/* ------------------------------------------------------------------ */

// Obtiene (o crea, oculta) la pestaña Gestión y completa encabezados faltantes. Sólo dentro del lock.
function gSheet_(ss) {
  ss = ss || ss_();
  let sh = ss.getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.GESTION_SHEET, ss.getNumSheets());
    gWriteHeaders_(sh, 1, G_HEADERS);
    sh.setFrozenRows(1);
    gFormat_(sh);
    try { sh.hideSheet(); } catch (e) { /* es la única pestaña visible */ }
    return sh;
  }
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (!head.some(h => str_(h) !== '')) {
    gWriteHeaders_(sh, 1, G_HEADERS);
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
    gFormat_(sh);
    return sh;
  }
  const have = head.map(norm_);
  const missing = G_HEADERS.filter(h => have.indexOf(norm_(h)) < 0);
  if (missing.length) {
    gWriteHeaders_(sh, lastCol + 1, missing);
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
    gFormat_(sh);
  }
  return sh;
}

function gWriteHeaders_(sh, col, names) {
  const need = col + names.length - 1;
  if (need > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  sh.getRange(1, col, 1, names.length).setValues([names]).setFontWeight('bold');
}

// Formatos de columna: fechas como fecha, el resto texto plano (evita que Sheets convierta "15/10" o "2026").
function gFormat_(sh) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return;
  const idx = headerIndex_(sh.getRange(1, 1, 1, lastCol).getValues()[0], G_HEADERS);
  const rows = Math.max(sh.getMaxRows(), 2);
  const groups = {};
  G_HEADERS.forEach(h => {
    const j = idx[h];
    if (j < 0) return;
    const f = (h === 'Fecha' || h === 'Completada' || h === 'Inicio') ? 'yyyy-mm-dd'
      : (h === 'Creado' || h === 'Actualizado') ? 'yyyy-mm-dd hh:mm'
        : h === 'Orden' ? '0' : '@';
    const c = gColLetter_(j + 1);
    (groups[f] = groups[f] || []).push(c + '2:' + c + rows);
  });
  Object.keys(groups).forEach(f => sh.getRangeList(groups[f]).setNumberFormat(f));
}

function gColLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Lee toda la tabla una vez: {sh, values, idx, width}
function gTable_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const values = lastRow && lastCol ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const head = values[0] || [];
  return { sh: sh, values: values, idx: headerIndex_(head, G_HEADERS), width: Math.max(head.length, 1) };
}

function gGet_(t, row, name) {
  const j = t.idx[name];
  return j >= 0 && j < row.length ? row[j] : '';
}

// Fila → objeto crudo normalizado (común a todos los tipos)
function gRaw_(t, row) {
  const g = name => gGet_(t, row, name);
  const resp = str_(g('Responsable')).toLowerCase();
  return {
    id: str_(g('ID')),
    tipo: gTipo_(g('Tipo')),
    pilar: pillarKey_(g('Pilar')),
    padre: str_(g('Padre')),
    nombre: gUnq_(g('Nombre')),
    detalle: gUnq_(g('Detalle')),
    resp: resp,
    asignados: gParseEmails_(g('Asignados')).filter(x => x !== resp), // v3.6 (SPEC §20): personas además del responsable
    fecha: dateStr_(g('Fecha')),
    estado: str_(g('Estado')),
    clase: str_(g('Clase')),
    cascade: str_(g('Cascade')),
    evidencias: gParseEv_(g('Evidencias')),
    lineas: gParseLines_(g('Presupuesto')),
    anio: gYearRead_(g('Año')),
    cierre: gUnq_(g('Cierre')),
    completada: dateStr_(g('Completada')),
    creadoPor: str_(g('Creado por')).toLowerCase(),
    creado: gIso_(g('Creado')),
    actualizadoPor: str_(g('Actualizado por')).toLowerCase(),
    actualizado: gIso_(g('Actualizado')),
    notificado: gUnq_(g('Notificado')),
    orden: num_(g('Orden')),
    avisar: gAvisarRead_(g('Avisar')),   // vacío (filas v2) → true
    privada: gPrivadaRead_(g('Privada')), // vacío (filas v2) → false
    inicio: dateStr_(g('Inicio')),
    carpeta: gFolderId_(g('Carpeta')),
  };
}

// Todos los registros con ID; _i = índice en t.values (fila de la hoja = _i + 1)
function gAll_(t) {
  const out = [];
  if (t.idx.ID < 0) return out;
  for (let i = 1; i < t.values.length; i++) {
    const r = gRaw_(t, t.values[i]);
    if (!r.id || !r.tipo) continue;
    r._i = i;
    out.push(r);
  }
  return out;
}

function gBlankRow_(t) {
  const row = [];
  for (let j = 0; j < t.width; j++) row.push('');
  return row;
}

// Escribe valores por nombre de encabezado sobre una fila (array) existente
function gApply_(t, row, fields) {
  Object.keys(fields).forEach(name => {
    const j = t.idx[name];
    if (j == null || j < 0) return;
    while (row.length <= j) row.push('');
    row[j] = gCellValue_(name, fields[name]);
  });
  return row;
}

// Escribe filas completas en un solo setValues (agrega filas a la hoja si hace falta)
function gWriteRows_(sh, startRow, rows) {
  if (!rows.length) return;
  const last = startRow + rows.length - 1;
  if (last > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows() + 20);
    gFormat_(sh); // las filas nuevas también quedan como texto plano (@) antes de escribir
  }
  sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

// Borra filas (números de fila de la hoja) de abajo hacia arriba, agrupando contiguas
function gDeleteRows_(sh, rowNums) {
  const rows = rowNums.filter((r, k) => r > 1 && rowNums.indexOf(r) === k).sort((a, b) => b - a);
  if (!rows.length) return;
  // Sheets no permite borrar todas las filas no congeladas
  if (sh.getMaxRows() - rows.length <= sh.getFrozenRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length);
  let i = 0;
  while (i < rows.length) {
    const end = rows[i];
    let start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start = rows[i]; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}

// Escribe sólo las celdas indicadas (por encabezado) de una fila (índice de t.values); el resto no se toca
function gSetCells_(t, i, fields) {
  Object.keys(fields).forEach(name => {
    const j = t.idx[name];
    if (j == null || j < 0) return;
    t.sh.getRange(i + 1, j + 1).setValue(gCellValue_(name, fields[name]));
  });
}

// Vacía una columna en las filas indicadas (índices de t.values) con un solo setValues
function gClearColumn_(t, name, idxs) {
  gSetColumn_(t, name, idxs.map(i => [i, '']));
}

// Escribe valores en una columna: pairs = [[índice en t.values, valor]], con un solo setValues
function gSetColumn_(t, name, pairs) {
  const j = t.idx[name];
  if (!pairs.length || j == null || j < 0 || t.values.length < 2) return;
  const col = t.values.slice(1).map(r => [r[j] == null ? '' : r[j]]);
  pairs.forEach(p => { if (col[p[0] - 1]) col[p[0] - 1][0] = gCellValue_(name, p[1]); });
  t.sh.getRange(2, j + 1, col.length, 1).setValues(col);
}

// Escribe varias columnas (por encabezado) en varias filas con UN solo setValues: rows = [[índice en t.values,
// {encabezado: valor}]]. El bloque va de la primera a la última fila y columna tocadas; las demás celdas del bloque se
// reescriben con su valor actual (como gSetColumn_; un texto que empieza con "=" conserva su apóstrofo).
function gSetBlock_(t, rows) {
  const cols = [];
  rows.forEach(p => Object.keys(p[1]).forEach(n => {
    const j = t.idx[n];
    if (j != null && j >= 0 && cols.indexOf(j) < 0) cols.push(j);
  }));
  const idxs = rows.map(p => p[0]).filter(i => i >= 1 && i < t.values.length);
  if (!cols.length || !idxs.length) return;
  const c0 = Math.min.apply(null, cols);
  const c1 = Math.max.apply(null, cols);
  const r0 = Math.min.apply(null, idxs);
  const r1 = Math.max.apply(null, idxs);
  const block = [];
  for (let i = r0; i <= r1; i++) {
    const src = t.values[i] || [];
    const line = [];
    for (let j = c0; j <= c1; j++) {
      const v = src[j] == null ? '' : src[j];
      line.push(typeof v === 'string' && v.charAt(0) === '=' ? "'" + v : v);
    }
    block.push(line);
  }
  rows.forEach(p => {
    if (p[0] < r0 || p[0] > r1) return;
    Object.keys(p[1]).forEach(n => {
      const j = t.idx[n];
      if (j != null && j >= 0) block[p[0] - r0][j - c0] = gCellValue_(n, p[1][n]);
    });
  });
  t.sh.getRange(r0 + 1, c0 + 1, r1 - r0 + 1, c1 - c0 + 1).setValues(block);
}

// Valor para una celda. Las columnas de texto de Gestión tienen formato texto plano (@, gFormat_):
// Sheets no convierte "2026" ni "2026-10-15:3", y en ese formato un apóstrofo inicial quedaría como
// carácter literal, así que no se antepone. Sólo "=" lleva apóstrofo (nunca se interpreta como fórmula);
// gUnq_ lo quita al leer.
function gCellValue_(name, v) {
  if (v == null) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (!s || G_DATE_HEADERS.indexOf(name) >= 0) return s;
  if (s.charAt(0) === '=') return "'" + s;
  return s;
}

// Lectura de texto: quita el apóstrofo que versiones anteriores de gCellValue_ (o "=" ahora) anteponían
// y que en celdas @ queda literal. Sólo esos patrones: un apóstrofo escrito por el usuario se respeta.
function gUnq_(v) {
  const s = str_(v);
  return /^'(?:[=+\-@]|[\d\s.,:;\/%$-]+$|(?:true|false|verdadero|falso)$)/i.test(s) ? s.slice(1) : s;
}

function gNewId_(raws, prefix) {
  const used = {};
  raws.forEach(r => { used[r.id] = true; });
  let id = uid_(prefix);
  while (used[id]) id = uid_(prefix);
  return id;
}

function gNames_(raws) {
  const m = {};
  raws.forEach(r => { if (r.nombre) m[r.id] = r.nombre; });
  return m;
}

/* ------------------------------------------------------------------ */
/* Validación por tipo                                                 */
/* ------------------------------------------------------------------ */

// Estado actual de un registro en la forma de entidad (para merge y diff)
function gEntity_(tipo, r) {
  if (tipo === 'Proyecto') {
    return {
      pilar: r.pilar, nombre: r.nombre, detalle: r.detalle, resp: r.resp,
      estado: gPrjEstado_(r.estado) || 'Activo', anio: r.anio, lineas: r.lineas,
      cascade: r.cascade, evidencias: r.evidencias, inicio: r.inicio, fin: r.fecha,
    };
  }
  if (tipo === 'Tarea') {
    return {
      pilar: r.pilar, proyecto: r.padre, nombre: r.nombre, detalle: r.detalle, resp: r.resp, asignados: (r.asignados || []).slice(),
      fecha: r.fecha, estado: gTaskDone_(r.estado) ? 'Realizada' : 'Pendiente', cascade: r.cascade,
      evidencias: r.evidencias, cierre: r.cierre, completada: r.completada, notificado: r.notificado,
      avisar: r.avisar, privada: r.privada, orden: r.orden,
    };
  }
  return {
    pilar: r.pilar, padre: r.padre, nombre: r.nombre, etiqueta: r.detalle,
    clase: r.padre ? (gClase_(r.clase) || 'accion') : 'grupo', orden: r.orden,
  };
}

// Toma el valor enviado o, si no viene (undefined), el actual
function gPick_(e, prev, k, def) {
  if (e[k] !== undefined && e[k] !== null) return e[k];
  return prev && prev[k] !== undefined ? prev[k] : def;
}

function gCheckProject_(e, prev, ctx) {
  const v = (k, d) => gPick_(e, prev, k, d);
  const out = {
    nombre: gName_(v('nombre', '')),
    pilar: gPilarIn_(v('pilar', '')),
    detalle: gLong_(v('detalle', ''), G_LIMITS.detalle, 'La descripción'),
    resp: gEmailIn_(v('resp', '')),
    estado: gPrjEstadoIn_(v('estado', 'Activo')),
    anio: gYearIn_(v('anio', '')),
    lineas: gLinesIn_(v('lineas', [])),
    cascade: gCascadeRef_(v('cascade', ''), ctx, false),
    evidencias: gCleanEvidence_(v('evidencias', [])),
    inicio: gDateIn_(v('inicio', ''), 'La fecha de inicio'),
    fin: gDateIn_(v('fin', ''), 'La fecha de término'),
  };
  if (out.inicio && out.fin && out.fin < out.inicio) {
    throw new Error('La fecha de término (' + gFmtDate_(out.fin) + ') no puede ser anterior a la de inicio (' + gFmtDate_(out.inicio) + ').');
  }
  // Una línea pertenece a un solo proyecto (evita doble conteo)
  const before = prev ? prev.lineas : [];
  const added = out.lineas.filter(x => before.indexOf(x) < 0);
  added.forEach(lid => {
    const other = ctx.raws.find(r => r.tipo === 'Proyecto' && r.id !== ctx.id && r.lineas.indexOf(lid) >= 0);
    if (other) throw new Error('La línea ' + lid + ' ya está vinculada al proyecto "' + other.nombre + '". Desvincúlala allí primero.');
  });
  // Las líneas nuevas deben existir y ser del mismo pilar (SPEC §7). Al cambiar de pilar, las líneas del
  // pilar anterior se desvinculan (como las tareas se mueven con el proyecto). Las que no se pudieron
  // leer se conservan: nunca se quita un vínculo por un error de lectura.
  const moved = !!prev && prev.pilar !== out.pilar;
  if (added.length || (moved && out.lineas.length)) {
    const ix = gLineIndex_(ss_());
    added.forEach(lid => {
      const l = ix.lines[lid];
      if (!l) {
        if (ix.failed) throw new Error('No pude leer las pestañas de presupuesto para verificar las líneas. Intenta de nuevo.');
        throw new Error('La línea ' + lid + ' ya no existe (¿la eliminaron?). Actualiza los datos.');
      }
      if (l.pilar !== out.pilar) {
        throw new Error('La línea "' + l.proj + '" (' + l.year + ') es de ' + (l.pilar ? gPillarLabel_(l.pilar) : 'un área sin pilar') +
          ': sólo se vinculan líneas del mismo pilar del proyecto (' + gPillarLabel_(out.pilar) + ').');
      }
      // Monto final 0 = "No se realizará": no se vincula (las ya vinculadas se conservan)
      if (l.pf === 0) throw new Error('La línea "' + l.proj + '" no se realizará (monto final $0); no se puede vincular.');
    });
    if (moved) {
      const keep = out.lineas.filter(x => !ix.lines[x] || ix.lines[x].pilar === out.pilar);
      ctx.dropped = out.lineas.length - keep.length;
      out.lineas = keep;
    }
  }
  return out;
}

function gCheckTask_(e, prev, ctx) {
  const v = (k, d) => gPick_(e, prev, k, d);
  const proyecto = str_(v('proyecto', ''));
  const prj = proyecto ? ctx.raws.find(r => r.tipo === 'Proyecto' && r.id === proyecto && r.pilar) : null;
  if (proyecto && !prj) throw new Error('El proyecto elegido ya no existe. Elige otro o deja la tarea sin proyecto.');
  // v3: con proyecto, el pilar es siempre el del proyecto; sin proyecto el pilar es opcional ('' = tarea personal)
  const pil = v('pilar', '');
  const out = {
    nombre: gName_(v('nombre', '')),
    pilar: prj ? prj.pilar : (str_(pil) ? gPilarIn_(pil) : ''),
    proyecto: proyecto,
  };
  if (prj && (!prev || prev.proyecto !== proyecto) && gPrjEstado_(prj.estado) === 'Cerrado') {
    throw new Error('El proyecto "' + prj.nombre + '" está cerrado. Reábrelo o elige otro.');
  }
  out.detalle = gLong_(v('detalle', ''), G_LIMITS.detalle, 'La nota');
  out.resp = gEmailIn_(v('resp', ''));
  // v3.6 (SPEC §20): más personas además del responsable (sin él responsable, la primera pasa a serlo)
  const ppl = gAsignadosIn_(v('asignados', []));
  if (!out.resp && ppl.length) out.resp = ppl.shift();
  out.asignados = ppl.filter(x => x !== out.resp);
  out.fecha = gDateIn_(v('fecha', ''), 'La fecha');
  out.cascade = gCascadeRef_(v('cascade', ''), ctx, true);
  out.evidencias = gCleanEvidence_(v('evidencias', []));
  out.avisar = gBoolIn_(v('avisar', true), true);
  out.privada = gBoolIn_(e.privada, gPrivadaDefault_(prev, prj, ctx));
  // Con más de una persona la tarea es del equipo: siempre pública
  if (out.asignados.length) out.privada = false;
  out.orden = gOrdenIn_(v('orden', 0));
  if (out.privada && !gKnown_(ctx.me)) throw new Error(G_NO_IDENTITY_PRIVATE);
  // El estado sólo cambia con taskComplete / taskReopen
  out.estado = prev ? prev.estado : 'Pendiente';
  out.cierre = prev ? prev.cierre : '';
  out.completada = prev ? prev.completada : '';
  // v3: el comentario de cierre (opcional) se puede escribir o corregir en cualquier estado
  if (e.cierre !== undefined && e.cierre !== null) out.cierre = gLong_(e.cierre, G_LIMITS.cierre, 'El comentario de cierre');
  if (prev && prev.estado === 'Realizada' && str_(e.completada)) {
    const dc = gDateIn_(e.completada, 'La fecha de realización');
    if (dc > today_()) throw new Error('La fecha de realización no puede ser futura.');
    out.completada = dc;
  }
  // Si cambia la fecha o el responsable, se vuelve a notificar
  out.notificado = prev && prev.fecha === out.fecha && prev.resp === out.resp ? prev.notificado : '';
  return out;
}

function gCheckCascade_(e, prev, ctx) {
  const v = (k, d) => gPick_(e, prev, k, d);
  const padre = str_(v('padre', ''));
  let group = null;
  let pil = v('pilar', '');
  if (padre) {
    if (padre === ctx.id) throw new Error('Un indicador no puede ser su propio grupo.');
    group = ctx.raws.find(r => r.tipo === 'Cascade' && r.id === padre);
    if (!group || group.padre) throw new Error('El grupo elegido no existe.');
    if (!pillarKey_(pil)) pil = group.pilar;
  }
  const out = {
    nombre: gName_(v('nombre', '')),
    pilar: gPilarIn_(pil),
    padre: padre,
  };
  if (group && group.pilar !== out.pilar) throw new Error('El grupo "' + group.nombre + '" pertenece a otro pilar.');
  if (prev && !prev.padre && padre && ctx.raws.some(r => r.tipo === 'Cascade' && r.padre === ctx.id)) {
    throw new Error('Este grupo tiene indicadores; no puede quedar dentro de otro grupo.');
  }
  if (padre) {
    const raw = v('clase', '');
    const c = gClase_(raw);
    if (!c && str_(raw) && norm_(raw) !== 'grupo') throw new Error('Tipo de indicador inválido: usa KPI, Acción, Objetivo o Hito.');
    out.clase = c || 'accion';
  } else {
    out.clase = 'grupo';
  }
  out.etiqueta = gLong_(v('etiqueta', ''), G_LIMITS.etiqueta, 'La etiqueta').replace(/\s+/g, ' ');
  const moved = !prev || prev.padre !== out.padre || (!out.padre && prev.pilar !== out.pilar);
  if (moved) {
    let max = 0;
    ctx.raws.forEach(r => {
      if (r.tipo !== 'Cascade' || r.id === ctx.id || r.padre !== out.padre) return;
      if (!out.padre && r.pilar !== out.pilar) return;
      if (r.orden > max) max = r.orden;
    });
    out.orden = max + 1;
  } else if (e.orden !== undefined && e.orden !== null && e.orden !== '' && isFinite(Number(e.orden))) {
    out.orden = Math.max(0, Math.round(Number(e.orden)));
  } else {
    out.orden = prev.orden;
  }
  return out;
}

// Entidad validada → campos por encabezado
function gFields_(tipo, n) {
  if (tipo === 'Proyecto') {
    return {
      Pilar: pillarArea_(n.pilar), Nombre: n.nombre, Detalle: n.detalle, Responsable: n.resp,
      Estado: n.estado, 'Año': n.anio, Presupuesto: n.lineas.join(','), Cascade: n.cascade,
      Evidencias: gEvJson_(n.evidencias),
      Inicio: n.inicio ? toDate_(n.inicio) : '', Fecha: n.fin ? toDate_(n.fin) : '',
    };
  }
  if (tipo === 'Tarea') {
    return {
      Pilar: n.pilar ? pillarArea_(n.pilar) : '', Padre: n.proyecto, Nombre: n.nombre, Detalle: n.detalle,
      Responsable: n.resp, Fecha: n.fecha ? toDate_(n.fecha) : '', Estado: n.estado, Cascade: n.cascade,
      Evidencias: gEvJson_(n.evidencias), Cierre: n.cierre,
      Completada: n.completada ? toDate_(n.completada) : '', Notificado: n.notificado,
      Avisar: n.avisar ? 'Sí' : 'No', Privada: n.privada ? 'Sí' : 'No', Orden: n.orden || '',
      Asignados: (n.asignados || []).join(', '),
    };
  }
  return {
    Pilar: pillarArea_(n.pilar), Padre: n.padre, Nombre: n.nombre, Detalle: n.etiqueta,
    Clase: n.clase, Orden: n.orden,
  };
}

// Resumen legible para el Historial (alta: atributos clave; edición: sólo cambios)
function gDescribe_(tipo, a, b, names) {
  const out = [];
  const A = a || {};
  const nm = id => (id ? (names[id] || id) : '');
  const add = (label, x, y, fmt) => {
    const f = fmt || (s => (s === '' || s == null ? '—' : String(s)));
    if (!a) {
      if (y !== '' && y != null && !(Array.isArray(y) && !y.length)) out.push(label + ': ' + f(y));
      return;
    }
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    out.push(label + ': ' + f(x) + ' → ' + f(y));
  };
  const count = l => String((l || []).length);
  const fdate = s => (s ? gFmtDate_(s) : '—');
  add('Pilar', A.pilar, b.pilar, s => (s ? gPillarLabel_(s) : 'Sin pilar'));
  if (a) add('Nombre', A.nombre, b.nombre);
  if (tipo === 'Proyecto') {
    add('Estado', A.estado, b.estado);
    add('Responsable', A.resp, b.resp, gWho_);
    add('Año', A.anio, b.anio, s => s || 'Todos');
    add('Inicio', A.inicio, b.inicio, fdate);
    add('Término', A.fin, b.fin, fdate);
    add('Líneas', A.lineas, b.lineas, count);
    add('Indicador', A.cascade, b.cascade, s => nm(s) || '—');
  } else if (tipo === 'Tarea') {
    add('Proyecto', A.proyecto, b.proyecto, s => nm(s) || 'Sin proyecto');
    add('Responsable', A.resp, b.resp, gWho_);
    add('También', A.asignados || [], b.asignados || [], l => (l && l.length ? l.map(gWho_).join(', ') : 'Nadie más'));
    add('Fecha', A.fecha, b.fecha, s => (s ? gFmtDate_(s) : 'Sin fecha'));
    add('Indicador', A.cascade, b.cascade, s => nm(s) || '—');
    if (!a ? b.privada : A.privada !== b.privada) out.push(b.privada ? 'Privada' : 'Ahora es compartida');
    if (!a ? !b.avisar : A.avisar !== b.avisar) out.push(b.avisar ? 'Avisos por correo activados' : 'Sin avisos por correo');
    if (!a && b.cierre) out.push('Con comentario de cierre');
    if (a && A.cierre !== b.cierre) out.push('Cierre editado');
    if (a && A.completada !== b.completada) add('Realizada', A.completada, b.completada, fdate);
  } else {
    add('Grupo', A.padre, b.padre, s => nm(s) || '(es grupo)');
    add('Clase', A.clase, b.clase);
    add('Etiqueta', A.etiqueta, b.etiqueta);
    if (a) add('Orden', A.orden, b.orden);
  }
  if (tipo !== 'Cascade') {
    add('Evidencias', A.evidencias, b.evidencias, count);
    if (a && A.detalle !== b.detalle) out.push((tipo === 'Tarea' ? 'Nota' : 'Descripción') + ' editada');
  }
  return out.join(' · ') || (a ? 'Sin cambios' : '');
}

/* ------------------------------------------------------------------ */
/* Validadores y normalizadores                                        */
/* ------------------------------------------------------------------ */

function gTipo_(v) {
  const n = norm_(v);
  return G_TIPOS.find(x => norm_(x) === n) || '';
}

function gTaskDone_(estado) {
  return norm_(estado) === 'realizada';
}

function gPrjEstado_(v) {
  const n = norm_(v);
  return G_PRJ_ESTADOS.find(x => norm_(x) === n) || '';
}

function gPrjEstadoIn_(v) {
  if (!str_(v)) return 'Activo';
  const s = gPrjEstado_(v);
  if (!s) throw new Error('Estado de proyecto inválido: usa Activo, En pausa o Cerrado.');
  return s;
}

function gClase_(v) {
  const n = norm_(v);
  if (G_CLASES.indexOf(n) >= 0) return n;
  if (n === 'indicador') return 'kpi';
  return '';
}

function gName_(v) {
  const s = str_(v).replace(/\s+/g, ' ');
  if (!s) throw new Error('El nombre es obligatorio.');
  if (s.length > G_LIMITS.nombre) throw new Error('El nombre no puede superar ' + G_LIMITS.nombre + ' caracteres.');
  return s;
}

function gLong_(v, max, label) {
  const s = v == null ? '' : String(v instanceof Date ? dateStr_(v) : v).replace(/\r\n?/g, '\n').trim();
  if (s.length > max) throw new Error(label + ' no puede superar ' + gThousands_(max) + ' caracteres.');
  return s;
}

function gPilarIn_(v) {
  const k = pillarKey_(v);
  if (!k) throw new Error('Elige un pilar válido: Cambio Climático, Economía Circular o Naturaleza.');
  return k;
}

function gEmailIn_(v) {
  const s = str_(v).toLowerCase();
  if (!s) return '';
  if (!/^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i.test(s)) throw new Error('El responsable debe ser un correo válido.');
  return s;
}

// Personas adicionales de una tarea (SPEC §20): correos del equipo, sin repetir, hasta G_LIMITS.asignados.
function gAsignadosIn_(v) {
  const list = Array.isArray(v) ? v : str_(v) ? String(v).split(/[\s,;]+/) : [];
  const out = [];
  list.forEach(x => {
    const s = str_(x).toLowerCase();
    if (!s || out.indexOf(s) >= 0) return;
    if (!/^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i.test(s)) throw new Error('Las personas de la tarea deben ser correos válidos.');
    if (!isMember_(s)) throw new Error(s + ' no es parte del equipo de ' + CONFIG.APP_NAME + '.');
    out.push(s);
  });
  if (out.length > G_LIMITS.asignados + 1) throw new Error('Una tarea puede tener hasta ' + (G_LIMITS.asignados + 1) + ' personas.');
  return out;
}

// Correos de una celda (separados por coma, punto y coma o espacios): minúsculas y sin repetir
function gParseEmails_(v) {
  const out = [];
  gUnq_(v).split(/[\s,;]+/).forEach(x => {
    const s = str_(x).toLowerCase();
    if (s && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function gDateIn_(v, label) {
  if (v == null || str_(v) === '') return '';
  const d = dateStr_(v);
  const p = d ? d.split('-').map(Number) : null;
  if (p) {
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    if (p[0] >= 2000 && p[0] <= 2100 && dt.getUTCMonth() === p[1] - 1 && dt.getUTCDate() === p[2]) return d;
  }
  throw new Error(label + ' no es válida (usa el formato aaaa-mm-dd).');
}

function gYearIn_(v) {
  const s = str_(v);
  if (!s) return '';
  if (!/^\d{4}$/.test(s) || Number(s) < 2000 || Number(s) > 2100) throw new Error('El año debe tener 4 dígitos (ej. 2026) o quedar vacío para "todos los años".');
  return s;
}

function gYearRead_(v) {
  const s = v instanceof Date ? String(v.getFullYear()) : gUnq_(v); // "'2026" escrito por versiones anteriores
  return /^\d{4}$/.test(s) ? s : '';
}

function gLinesIn_(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;\s]+/);
  const out = [];
  list.forEach(x => {
    const s = str_(x);
    if (!s) return;
    if (!/^L-[0-9a-f]{8}$/i.test(s)) throw new Error('Identificador de línea de presupuesto inválido: ' + s.slice(0, 40));
    if (out.indexOf(s) < 0) out.push(s);
  });
  if (out.length > 300) throw new Error('Demasiadas líneas vinculadas a un proyecto.');
  return out;
}

function gParseLines_(v) {
  const out = [];
  String(v == null ? '' : v).split(/[,;\s]+/).forEach(x => {
    const s = str_(x);
    if (/^L-/i.test(s) && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function gCascadeRef_(v, ctx, leafOnly) {
  const id = str_(v);
  if (!id) return '';
  const c = ctx.raws.find(r => r.tipo === 'Cascade' && r.id === id);
  if (!c) throw new Error('El indicador Cascade elegido ya no existe. Elige otro.');
  if (leafOnly && !c.padre) throw new Error('Elige un indicador dentro de "' + c.nombre + '", no el grupo.');
  return id;
}

// Conflicto de edición: el registro cambió después de que el cliente abrió el formulario
function gConflict_(cur) {
  const who = cur.actualizadoPor;
  const me = me_();
  const known = who && who !== 'desconocido';
  const lead = known && who !== me ? 'Otra persona (' + userName_(who) + ') modificó este registro'
    : known ? 'Modificaste este registro en otra pestaña o ventana' : 'Alguien modificó este registro';
  throw new Error(lead + ' mientras lo editabas. Cierra, actualiza los datos e intenta de nuevo.');
}

// " por Benja" si el último cambio lo hizo otra persona identificada; '' si no
function gByOther_(cur) {
  const who = cur.actualizadoPor;
  return who && who !== 'desconocido' && who !== me_() ? ' por ' + userName_(who) : '';
}

function gAssertCommentOwner_(r) {
  const author = r.resp || r.creadoPor;
  if (author !== me_() && !isAdmin_()) throw new Error('Sólo quien escribió el comentario (o un administrador) puede eliminarlo.');
}

// Un comentario de una tarea privada ajena no se puede tocar (ni se revela que existe)
function gAssertCommentRef_(raws, c, me) {
  const target = raws.find(r => r.id === c.padre && r.tipo === 'Tarea');
  if (target && !gTaskVisible_(target, me)) throw new Error(G_NO_TASK);
}

// ¿El registro referido es una tarea privada? (para no escribir su nombre en el Historial)
function gRefPrivate_(raws, ref) {
  return raws.some(r => r.id === ref && r.tipo === 'Tarea' && r.privada);
}

/* ---------- v3: privacidad, avisos y orden ---------- */

// Booleano desde el cliente (true/false, "Sí"/"No", "1"/"0"); vacío o desconocido → def
function gBoolIn_(v, def) {
  if (typeof v === 'boolean') return v;
  if (v == null || str_(v) === '') return def;
  const n = norm_(v);
  if (['true', '1', 'si', 'yes', 'on', 'x'].indexOf(n) >= 0) return true;
  if (['false', '0', 'no', 'off'].indexOf(n) >= 0) return false;
  return def;
}

// ¿Google entregó el correo? ('desconocido' / vacío → no: una tarea privada así no la vería nadie)
function gKnown_(email) {
  const s = str_(email).toLowerCase();
  return !!s && s !== 'desconocido';
}

// Privacidad por defecto de una tarea cuando el cliente no la envía (SPEC §15). Alta: privada si no tiene proyecto,
// compartida si lo tiene (y siempre compartida si no sé quién eres). Edición: la que tenía, salvo que pase de
// "sin proyecto" a un proyecto: entonces se comparte. prj = fila cruda del proyecto elegido o null.
function gPrivadaDefault_(prev, prj, ctx) {
  if (!prev) return !prj && gKnown_(ctx.me);
  const had = !!prev.proyecto && ctx.raws.some(r => r.tipo === 'Proyecto' && r.id === prev.proyecto && r.pilar);
  if (prj && !had) return false;
  return !!prev.privada;
}

// ¿Puedo cambiar la privacidad de esta tarea? Sólo quien la creó o su responsable (el administrador no se salta esto).
function gTaskOwner_(task, email) {
  if (!task || !gKnown_(email)) return false;
  const me = str_(email).toLowerCase();
  return str_(task.creadoPor).toLowerCase() === me || str_(task.resp).toLowerCase() === me;
}

// Columna Avisar: "No" (o falso) → false; cualquier otra cosa, incluso vacío (filas v2) → true
function gAvisarRead_(v) {
  if (v === false) return false;
  return ['no', 'false', '0', 'n'].indexOf(norm_(gUnq_(v))) < 0;
}

// Columna Privada: "Sí" (o verdadero) → true; vacío (filas v2) → false
function gPrivadaRead_(v) {
  if (v === true) return true;
  return ['si', 'true', '1', 'x', 'privada'].indexOf(norm_(gUnq_(v))) >= 0;
}

// Orden manual: entero ≥ 0 (0 = sin orden: va después de las ordenadas)
function gOrdenIn_(v) {
  const n = Math.round(Number(v));
  return isFinite(n) && n > 0 ? Math.min(n, 1000000) : 0;
}

/* ---------- Evidencias (links) ---------- */

function gIsUrl_(u) {
  return typeof u === 'string' && u.length <= G_LIMITS.evUrl && /^https?:\/\/[^\s"'<>]+$/i.test(u);
}

// Título por defecto: tipo de archivo de Google o el dominio
function gEvTitle_(u) {
  if (/docs\.google\.com\/spreadsheets/i.test(u)) return 'Planilla (Google Sheets)';
  if (/docs\.google\.com\/document/i.test(u)) return 'Documento (Google Docs)';
  if (/docs\.google\.com\/presentation/i.test(u)) return 'Presentación (Google Slides)';
  if (/docs\.google\.com\/forms|forms\.gle/i.test(u)) return 'Formulario (Google Forms)';
  if (/drive\.google\.com\/(drive\/)?(u\/\d+\/)?folders/i.test(u)) return 'Carpeta de Drive';
  if (/drive\.google\.com/i.test(u)) return 'Archivo de Drive';
  const m = u.match(/^https?:\/\/([^\/?#:]+)/i);
  return m ? m[1].replace(/^www\./i, '') : 'Link';
}

// Valida evidencias enviadas por el cliente: [{t,u}] → lanza error si un link no es http(s)
function gCleanEvidence_(list) {
  if (list == null || list === '') return [];
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (e) { list = [list]; }
  }
  if (!Array.isArray(list)) list = [list];
  const out = [];
  const seen = {};
  list.forEach(ev => {
    if (!ev) return;
    const u = str_(typeof ev === 'string' ? ev : ev.u);
    let t = str_(typeof ev === 'string' ? '' : ev.t).replace(/\s+/g, ' ');
    if (!u && !t) return;
    if (!gIsUrl_(u)) throw new Error('El link de evidencia "' + (u || t).slice(0, 80) + '" no es válido: debe comenzar con https://');
    if (seen[u]) return;
    seen[u] = true;
    if (t.length > G_LIMITS.evTitle) t = t.slice(0, G_LIMITS.evTitle - 1) + '…';
    out.push({ t: t || gEvTitle_(u), u: u });
  });
  if (out.length > G_LIMITS.evMax) throw new Error('Máximo ' + G_LIMITS.evMax + ' evidencias por registro.');
  return out;
}

function gMergeEv_(a, b) {
  const out = (a || []).slice();
  (b || []).forEach(ev => { if (!out.some(x => x.u === ev.u)) out.push(ev); });
  if (out.length > G_LIMITS.evMax) throw new Error('Máximo ' + G_LIMITS.evMax + ' evidencias por tarea.');
  return out;
}

// Lectura tolerante: JSON inválido → []; sólo links http(s)
function gParseEv_(v) {
  const s = str_(v);
  if (!s) return [];
  let list;
  try { list = JSON.parse(s); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach(ev => {
    if (!ev || typeof ev !== 'object') return;
    const u = str_(ev.u);
    if (!gIsUrl_(u) || out.some(x => x.u === u)) return;
    out.push({ t: str_(ev.t).slice(0, G_LIMITS.evTitle) || gEvTitle_(u), u: u });
  });
  return out;
}

function gEvJson_(list) {
  if (!list || !list.length) return '';
  const s = JSON.stringify(list.map(x => ({ t: x.t, u: x.u })));
  if (s.length > 45000) throw new Error('Las evidencias son demasiado largas para guardarlas. Quita algunos links.');
  return s;
}

/* ---------- Formato ---------- */

function gIso_(v) {
  if (v instanceof Date) return iso_(v);
  const s = str_(v);
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// 'yyyy-mm-dd' → '15 oct 2026'
function gFmtDate_(s) {
  const d = dateStr_(s);
  if (!d) return '';
  const p = d.split('-');
  return Number(p[2]) + ' ' + G_MESES[Number(p[1]) - 1] + ' ' + p[0];
}

function gPillarLabel_(key) {
  const p = CONFIG.PILLARS.find(x => x.key === pillarKey_(key));
  return p ? p.label : '—';
}

function gWho_(email) {
  return email ? userName_(email) : 'Sin asignar';
}

function gExcerpt_(s, n) {
  const t = str_(s).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function gThousands_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Nombre legible de una línea de presupuesto (para el Historial); '' si no se encuentra
function gLineLabel_(ss, lineId) {
  try {
    if (typeof presYears_ !== 'function') return '';
    const ys = presYears_(ss) || [];
    for (let k = 0; k < ys.length; k++) {
      const sh = ys[k].sheet;
      if (!sh || sh.getLastRow() < 2) continue;
      const v = sh.getDataRange().getValues();
      const idx = headerIndex_(v[0], ['ID', 'Proyecto']);
      if (idx.ID < 0) continue;
      for (let i = 1; i < v.length; i++) {
        if (str_(v[i][idx.ID]) === lineId) {
          return (idx.Proyecto >= 0 ? str_(v[i][idx.Proyecto]) : lineId) + ' (' + ys[k].year + ')';
        }
      }
    }
  } catch (e) { /* sólo es una etiqueta */ }
  return '';
}

// Índice de líneas de todas las pestañas Cuadre: {lines: {id: {year, pilar, proj, pf}}, failed}
// (failed = alguna pestaña no se pudo leer: una línea ausente puede existir igual; pf = null si falta la columna)
function gLineIndex_(ss) {
  const out = { lines: {}, failed: false };
  let ys = [];
  try {
    ys = typeof presYears_ === 'function' ? (presYears_(ss) || []) : null;
  } catch (e) { ys = null; }
  if (!ys) { out.failed = true; return out; }
  ys.forEach(y => {
    try {
      const sh = y.sheet;
      if (!sh || sh.getLastRow() < 2) return;
      const v = sh.getDataRange().getValues();
      const idx = headerIndex_(v[0], ['ID', 'Area', 'Proyecto', 'Monto final proyectado']);
      if (idx.ID < 0) return;
      for (let i = 1; i < v.length; i++) {
        const id = str_(v[i][idx.ID]);
        if (!id || out.lines[id]) continue;
        out.lines[id] = {
          year: y.year,
          pilar: idx.Area >= 0 ? pillarKey_(v[i][idx.Area]) : '',
          proj: idx.Proyecto >= 0 ? str_(v[i][idx.Proyecto]) || id : id,
          pf: idx['Monto final proyectado'] >= 0 ? num_(v[i][idx['Monto final proyectado']]) : null,
        };
      }
    } catch (e) { out.failed = true; }
  });
  return out;
}
