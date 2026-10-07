/* =====================================================================
   seed.js · planilla de prueba para el banco local (jsc y navegador)

   seedSpreadsheet()   crea las pestañas tal como está HOY la planilla real:
                         "Cuadre 2026"  datos REALES (53 filas, 11 columnas Area..Nota, sin Responsable/ID)
                         "Cuadre 2027"  6 líneas plausibles (Pendiente/Estado/Alerta en blanco)
                         "Historial"    encabezados v1 + algunas filas
                       NO crea "Gestión": la debe crear setup().
   seedDemoGestion()   DESPUÉS de setup(): contenido de demostración creado por la API PÚBLICA
                       (gSave, taskComplete, taskReorder, commentAdd, budgetSave), con fechas relativas a hoy.
                       v3: setup() ya creó los proyectos del catálogo Cascade; el demo "adopta" varios (responsable,
                       fechas de inicio/término, líneas) y les cuelga tareas. Incluye tareas privadas, una sin aviso,
                       pendientes personales sin pilar, checks rápidos sin comentario de cierre y orden manual.
                       opts.strict = true → lanza al primer error (pruebas); si no, acumula avisos.
   El bloque SEED_CUADRE_2026 se regenera con: python3 dev/harness/tools/xlsx_to_seed.py planilla.xlsx --patch
   ===================================================================== */

// <SEED_CUADRE_2026>
var SEED_CUADRE_2026 = [
  ["Area", "Proyecto", "Clasificacion", "Presupuesto original", "Monto final proyectado", "Pagado a la fecha", "Pendiente", "OC emitida", "Estado", "Alerta", "Nota"],
  ["Cambio Climatico", "GV - IREC Flux (compra certificados renovables)", "POA", 53383608, 36608000, 37595558, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Cambio Climatico", "GV - EDS Carbono Neutral 2024", "POA", 10647105, 0, 0, 0, "", "No se realizará", "—", "No se realiza: ahorro liberado"],
  ["Cambio Climatico", "GV - Emisiones: certificacion Huella Carbono + Huella Chile", "POA", 6044813, 4612000, 2306146, 2305854, "Si", "En curso", "OK con OC", ""],
  ["Cambio Climatico", "GV - Auditoria interna ISO 50001", "POA", 1817120, 1817120, 0, 1817120, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Cambio Climatico", "GV - Emisiones: mi huella (Disney)", "POA", 14342159, 14342159, 13112446, 1229713, "Si", "En curso", "OK con OC", ""],
  ["Cambio Climatico", "GV - Recertificacion ISO 50001", "POA", 4955783, 4955783, 0, 4955783, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Cambio Climatico", "Analisis prevencion (Huella)", "Nuevo", 0, 7120000, 7235235, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Cambio Climatico", "Apoyo SGE - EMOAC (Huella)", "Nuevo", 0, 14000000, 4700000, 9300000, "Si", "En curso", "OK con OC", "DESVIACION: plan tenia $10M, monto final $14M."],
  ["Cambio Climatico", "Extension Manuia", "Fuera de POA", 0, 4212621, 4212621, 0, "Si", "Ejecutado", "Ejecutado", "5602585-0007. Ejecutado fuera de POA."],
  ["Cambio Climatico", "Zizcar", "Fuera de POA", 0, 3500000, 3500000, 0, "Si", "Ejecutado", "Ejecutado", "5602585-0020. Ejecutado fuera de POA."],
  ["Cambio Climatico", "CTX Membership SME", "Fuera de POA", 0, 509546, 509546, 0, "Si", "Ejecutado", "Ejecutado", "5602585-0004. Ejecutado fuera de POA."],
  ["Economia Circular", "Asesoria Residuos plantas", "Nuevo", 0, 20000000, 12252533, 7747467, "Si", "En curso", "OK con OC", ""],
  ["Economia Circular", "Kyklos red recicladores de base (1a etapa)", "Nuevo", 0, 14400000, 15517593, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Economia Circular", "Inscripcion Acuerdo APL", "Nuevo", 0, 3790461, 3792041, 0, "Si", "Ejecutado", "Pagado", "5602575-0001. Pagado."],
  ["Economia Circular", "Papel higienico Fontova", "Fuera de POA", 0, 156600, 157600, 0, "Si", "Ejecutado", "Ejecutado", "Ejecutado fuera de POA."],
  ["Economia Circular", "Retiro Residuos El Trebal Maipu", "Fuera de POA", 0, 3540000, 3540000, 0, "Si", "Ejecutado", "Ejecutado", "5602575-0012. Ejecutado fuera de POA."],
  ["Naturaleza", "El Trebal - Continuacion", "POA", 25000000, 0, 0, 0, "", "No se realizará", "—", "No se realiza: ahorro liberado"],
  ["Naturaleza", "El Bato, La Chimba - Analisis agua", "POA", 15000000, 0, 0, 0, "", "No se realizará", "—", "No se realiza: ahorro liberado"],
  ["Naturaleza", "Aguada La Chimba - Continuacion", "POA", 50000000, 41452010, 20726005, 20726005, "Si", "En curso", "OK con OC", "5602575-0004 'Plan trabajo 2026'. Pago parcial."],
  ["Naturaleza", "El Bato - Continuacion proyecto 2019", "POA", 45000000, 40579184, 20289592, 20289592, "Si", "En curso", "OK con OC", "5602575-0009 'Pago 1'. Pago parcial."],
  ["Naturaleza", "Estero Tongoy - Continuacion", "POA", 7000000, 3500000, 0, 3500000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Isla Kaikue - Continuacion", "POA", 7000000, 3500000, 0, 3500000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Huairavo - Continuacion", "POA", 25000000, 25000000, 0, 25000000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Centro de rescate Huilo Huilo - Etapa 3", "POA", 10000000, 10000000, 0, 10000000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "El Bato - Consulta pertinencia retiro Totora", "POA", 5000000, 5000000, 0, 5000000, "Si", "En curso", "OK con OC", ""],
  ["Naturaleza", "Nevado Tres Cruces - Continuacion", "POA", 7000000, 3500000, 0, 3500000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Rio Claro - Continuacion y fin", "POA", 7000000, 3500000, 0, 3500000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Remote Waters", "Nuevo", 0, 3000000, 0, 3000000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Levantamiento informacion Jardines", "Nuevo", 0, 2800000, 2092036, 707964, "Si", "En curso", "OK con OC", "5602575-0005. Pago parcial."],
  ["Naturaleza", "Rvalvec", "Nuevo", 0, 3000000, 1050000, 1950000, "No", "En curso", "Pagar/OC ya", ""],
  ["Naturaleza", "Mantenimiento refugios extra", "Nuevo", 0, 15854000, 3050000, 12804000, "Si", "En curso", "OK con OC", "5602575-0006/07/08 (Antofagasta+Copiapo). Pago parcial."],
  ["Naturaleza", "Gastos menores Naturaleza fuera de POA", "Fuera de POA", 0, 7390779, 7390779, 0, "Si", "Ejecutado", "Ejecutado", "Placa, gravilla, cercos, camiones aljibe, totem, aireadores, otros."],
  ["Naturaleza", "Piloto recirculacion de aguas grises", "Fuera de POA", 0, 1050000, 1050000, 0, "Si", "Ejecutado", "Ejecutado", "5602575-0010. Ejecutado fuera de POA."],
  ["Cambio Climatico", "Revisión proyecto especial", "Nuevo", 0, 2500000, 0, 2500000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Cambio Climatico", "Proyectos paneles/Efilabs", "Nuevo", 0, 5000000, 0, 5000000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Nuevo proyecto bio", "POA", 120000000, 90000000, 37500000, 52500000, "Si", "En curso", "OK con OC", ""],
  ["Naturaleza", "Levantamiento información Bosko", "POA", 0, 6123862, 6123862, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Naturaleza", "Estándares jardines", "POA", 0, 7500000, 3750000, 3750000, "Si", "En curso", "OK con OC", ""],
  ["Cambio Climatico", "Artículo 6.2", "POA", 0, 7125000, 0, 7125000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Economia Circular", "Contenedor piloto", "POA", 0, 365000, 0, 365000, "Si", "En curso", "OK con OC", ""],
  ["Cambio Climatico", "Emisión certificación IREC", "POA", 16387789, 0, 0, 0, "", "No se realizará", "—", ""],
  ["Naturaleza", "Huella Hídrica", "POA", 20900232, 0, 0, 0, "", "No se realizará", "—", ""],
  ["Naturaleza", "Compra plantas directorio", "POA", 0, 56000, 56600, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Naturaleza", "Levantamiento jardines sustentables", "POA", 0, 2831860, 2831860, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Naturaleza", "Evaluación Rano Raraku", "POA", 0, 4981000, 4981000, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Cambio Climatico", "Estudio áreas clasificadas", "POA", 0, 11000000, 0, 11000000, "Si", "En curso", "OK con OC", ""],
  ["Naturaleza", "Retiro Totora", "POA", 0, 30000000, 0, 30000000, "No", "Por ejecutar", "Pagar/OC ya", ""],
  ["Naturaleza", "Contenedor reciclaje", "POA", 0, 365000, 365000, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Naturaleza", "Mantención NOS final", "POA", 0, 3664813, 3664813, 0, "Si", "Ejecutado", "Pagado", ""],
  ["Naturaleza", "Refugio Valdivia", "POA", 0, 7475000, 3737500, 3737500, "Si", "En curso", "OK con OC", ""],
  ["Naturaleza", "Lemu", "POA", 0, 4000000, 0, 4000000, "", "Por ejecutar", "Definir OC", ""],
  ["Naturaleza", "Vientos del Chelenko", "POA", 7000000, 4200000, 0, 4200000, "", "Por ejecutar", "Definir OC", ""]
];
// </SEED_CUADRE_2026>

var SEED_CUADRE_2027 = [
  ['Area', 'Proyecto', 'Clasificacion', 'Presupuesto original', 'Monto final proyectado', 'Pagado a la fecha', 'Pendiente', 'OC emitida', 'Estado', 'Alerta', 'Nota'],
  ['Cambio Climatico', 'GV - IREC 2027 (certificados renovables)', 'POA', 55000000, 55000000, 0, '', 'No', '', '', 'Presupuesto preliminar, depende del precio del MWh'],
  ['Cambio Climatico', 'GV - Seguimiento ISO 50001 (año 2)', 'POA', 3500000, 3500000, 0, '', '', '', '', ''],
  ['Economia Circular', 'Valorización residuos plantas - fase 2', 'Nuevo', 18000000, 18000000, 0, '', '', '', '', 'Incluye Concón, Maipú y Chacabuco'],
  ['Naturaleza', 'El Bato - Continuación 2027', 'POA', 38000000, 38000000, 9500000, '', 'Si', '', '', 'Anticipo 25% pagado en diciembre'],
  ['Naturaleza', 'Jardines sustentables 2027', 'POA', 12000000, 12000000, 0, '', 'No', '', '', ''],
  ['Naturaleza', 'Huairavo - Continuación 2027', 'POA', 20000000, 20000000, 0, '', '', '', '', 'Sujeto a renovación del convenio'],
];

// Crea la planilla de prueba (estado actual de la planilla real). Devuelve la Spreadsheet.
function seedSpreadsheet() {
  MOCK.removeAllSheets();
  MOCK.addSheet('Cuadre 2026', SEED_CUADRE_2026, { formats: { 'D2:G1000': '#,##0' }, frozenRows: 1 });
  MOCK.addSheet('Cuadre 2027', SEED_CUADRE_2027, { formats: { 'D2:G1000': '#,##0' }, frozenRows: 1 });
  var d = function (y, m, dd, h, mi) { return new Date(y, m - 1, dd, h, mi); };
  MOCK.addSheet('Historial', [
    ['Fecha', 'Usuario', 'Acción', 'Proyecto', 'Detalle'],
    [d(2026, 8, 28, 10, 12), 'gvicencio@copec.cl', 'Editar', 'GV - IREC Flux (compra certificados renovables)', 'Pagado: $36.608.000 → $37.595.558'],
    [d(2026, 9, 3, 16, 40), 'ibachler@copec.cl', 'Editar', 'Aguada La Chimba - Continuacion', 'OC: No → Si'],
    [d(2026, 9, 15, 9, 5), 'idiaz@copec.cl', 'Crear', 'Contenedor piloto', 'Economía Circular · POA · Final $365.000'],
    [d(2026, 9, 29, 18, 22), 'bderigoulier@copec.cl', 'Editar', 'Kyklos red recicladores de base (1a etapa)', 'Pagado: $14.400.000 → $15.517.593'],
  ], { frozenRows: 1 });
  MOCK.spreadsheet().setActiveSheet(MOCK.sheet('Cuadre 2026'));
  return MOCK.spreadsheet();
}


// Contenido de demostración a través de la API pública. Requiere setup() previo (catálogo Cascade + proyectos importados).
function seedDemoGestion(opts) {
  opts = opts || {};
  var U = { ina: 'ibachler@copec.cl', benja: 'bderigoulier@copec.cl', ignacio: 'idiaz@copec.cl', gonzalo: 'gvicencio@copec.cl' };
  var BONOS = 'https://docs.google.com/spreadsheets/d/1AbCbonosCarbono2026Xy7QzK/edit';
  var prevUser = MOCK.user;
  var rep = { projects: 0, adopted: 0, tasks: 0, done: 0, comments: 0, lines: 0, private: 0, warnings: [] };
  var b = bootstrap();
  // Los proyectos importados desde Cascade (sin responsable) no cuentan: el demo sólo se omite si ya hay trabajo del equipo
  var busy = (b.tasks || []).some(function (t) { return t.resp; }) || (b.projects || []).some(function (p) { return p.resp; }) ||
    (b.comments || []).length > 0;
  if (busy) { rep.skipped = true; return rep; }
  var tz = Session.getScriptTimeZone();

  function nk(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function day(n) { var x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return Utilities.formatDate(x, tz, 'yyyy-MM-dd'); }
  function fail(msg, e) {
    var m = msg + (e ? ': ' + (e && e.message ? e.message : e) : '');
    if (opts.strict) throw new Error('seedDemoGestion · ' + m);
    rep.warnings.push(m);
  }
  function line(year, name) {
    var l = ((b.budget || {})[String(year)] || []).find(function (x) { return nk(x.proj) === nk(name); });
    if (!l) fail('no encontré la línea "' + name + '" en Cuadre ' + year);
    return l || null;
  }
  function lines(list) { return list.map(function (p) { return line(p[0], p[1]); }).filter(Boolean).map(function (l) { return l.id; }); }
  function casItem(pilar, name, groupOk) {
    return (b.cascade || []).find(function (x) { return (groupOk || x.padre) && x.pilar === pilar && nk(x.nombre) === nk(name); }) || null;
  }
  function cas(pilar, name) {
    if (!name) return '';
    var c = casItem(pilar, name, false);
    if (!c) { fail('no encontré el indicador Cascade "' + name + '"'); return ''; }
    return c.id;
  }
  function call(user, label, fn) {
    MOCK.user = user;
    try {
      var r = fn();
      // v3.1 (SPEC §14.1): las escrituras de Gestión devuelven un bundle parcial → se mezcla (conserva budget)
      if (r && r.partial) b = Object.assign({}, b, { projects: r.projects, tasks: r.tasks, cascade: r.cascade, comments: r.comments });
      else if (r && r.projects) b = r;
      return r;
    } catch (e) { fail(label, e); return null; } finally { MOCK.user = prevUser; }
  }
  function prjFields(p) {
    var f = { tipo: 'Proyecto', nombre: p.nombre, detalle: p.detalle || '', resp: p.resp, estado: p.estado || 'Activo',
      anio: p.anio || '', lineas: lines(p.lineas || []), evidencias: p.evidencias || [],
      inicio: p.inicio == null ? '' : day(p.inicio), fin: p.fin == null ? '' : day(p.fin) };
    if (p.nombre == null) delete f.nombre;   // adoptado: conserva el nombre del indicador
    if (p.detalle == null) delete f.detalle; // adoptado: conserva la descripción de origen (Cascade)
    return f;
  }
  // Proyecto nuevo (no viene de Cascade)
  function project(user, p) {
    var r = call(user, 'proyecto "' + p.nombre + '"', function () {
      return gSave(Object.assign(prjFields(p), { pilar: p.pilar, cascade: cas(p.pilar, p.cascade) }));
    });
    if (r && r.lastId) rep.projects++;
    return r ? r.lastId : '';
  }
  // "Adopta" el proyecto que setup() importó desde Cascade (p.from = nombre del indicador o del grupo): le pone
  // responsable, fechas, líneas y, si se indica, un nombre más corto. Conserva su indicador (así no se reimporta).
  function adopt(user, p) {
    var c = casItem(p.pilar, p.from, true);
    var cur = c ? (b.projects || []).find(function (x) { return x.cascade === c.id; }) : null;
    if (!cur) { fail('no encontré el proyecto importado desde Cascade "' + p.from + '"'); return ''; }
    var r = call(user, 'adoptar "' + p.from + '"', function () { return gSave(Object.assign(prjFields(p), { id: cur.id })); });
    if (r && r.lastId) rep.adopted++;
    return r ? r.lastId : '';
  }
  function finish(id, t) {
    var c = call(t.resp || U.gonzalo, 'completar "' + t.nombre + '"', function () {
      var d = { completada: day(-t.done.hace), evidencias: t.done.evidencias || [] };
      if (t.done.cierre) d.cierre = t.done.cierre; // v3: un check rápido no lleva comentario de cierre
      return taskComplete(id, d);
    });
    if (c) rep.done++;
  }
  function task(user, t) {
    var r = call(user, 'tarea "' + t.nombre + '"', function () {
      return gSave({ tipo: 'Tarea', pilar: t.pilar || '', proyecto: t.proyecto || '', nombre: t.nombre, detalle: t.detalle || '', resp: t.resp,
        fecha: t.fecha == null ? '' : day(t.fecha), cascade: cas(t.pilar, t.cascade), evidencias: t.evidencias || [],
        avisar: t.avisar !== false, privada: !!t.privada });
    });
    if (r && r.lastId) { rep.tasks++; if (t.privada) rep.private++; }
    var id = r ? r.lastId : '';
    if (id && t.done) finish(id, t);
    return id;
  }
  // Completa una tarea importada (hito de Cascade): responsable, fecha y, si corresponde, la cierra
  function milestone(user, pid, pilar, name, t) {
    var c = casItem(pilar, name, false);
    var cur = c ? (b.tasks || []).find(function (x) { return x.cascade === c.id && x.proyecto === pid; }) : null;
    if (!cur) { fail('no encontré el hito importado "' + name + '"'); return ''; }
    var r = call(user, 'hito "' + name + '"', function () {
      return gSave({ tipo: 'Tarea', id: cur.id, resp: t.resp, fecha: t.fecha == null ? '' : day(t.fecha), detalle: t.detalle || '' });
    });
    if (r && t.done) finish(cur.id, Object.assign({ nombre: name }, t));
    return cur.id;
  }
  function comment(user, ref, texto) {
    if (!ref) return;
    var r = call(user, 'comentario en ' + ref, function () { return commentAdd(ref, texto); });
    if (r) rep.comments++;
  }
  function owner(year, name, email) {
    var l = line(year, name);
    if (!l) return;
    var r = call(U.gonzalo, 'responsable de "' + name + '"', function () { return budgetSave(year, l.id, { resp: email }); });
    if (r) rep.lines++;
  }
  function reorder(user, ids) {
    var list = ids.filter(Boolean);
    if (list.length) call(user, 'ordenar tareas', function () { return taskReorder(list); });
  }

  /* ---------- Proyectos (la mayoría adoptados desde Cascade; fechas relativas a hoy para la carta Gantt) ---------- */
  var P = {};
  P.bato = adopt(U.ina, {
    pilar: 'nat', from: '5 - Humedal El Bato, Quintero (2020)', nombre: 'Humedal El Bato (Quintero)', resp: U.ina, anio: '',
    inicio: -250, fin: 80,
    detalle: 'Restauración y monitoreo del humedal El Bato junto a la fundación local. Incluye la consulta de pertinencia para el retiro de totora y el seguimiento trimestral de calidad de agua.',
    lineas: [[2026, 'El Bato - Continuacion proyecto 2019'], [2026, 'El Bato - Consulta pertinencia retiro Totora'], [2026, 'Retiro Totora'], [2027, 'El Bato - Continuación 2027']],
    evidencias: [{ t: 'Carpeta Humedal El Bato', u: 'https://drive.google.com/drive/folders/1ElBatoQuintero2026HmdX' }],
  });
  P.chimba = adopt(U.benja, {
    pilar: 'nat', from: '2 - Humedal Aguada La Chimba, Antofagasta (2019)', nombre: 'Humedal Aguada La Chimba (Antofagasta)', resp: U.benja, anio: '2026',
    inicio: -200, fin: 60,
    detalle: 'Continuación del convenio de conservación 2026: dos cuotas contra informe de avance.',
    lineas: [[2026, 'Aguada La Chimba - Continuacion']],
  });
  P.residuos = adopt(U.ignacio, {
    pilar: 'ec', from: 'Valorización Plantas, CD, Oficinas', nombre: 'Valorización residuos plantas', resp: U.ignacio, anio: '2026',
    inicio: -180, fin: 90,
    detalle: 'Diagnóstico y plan de valorización de residuos en plantas y CD. Meta: subir la tasa de desvío sobre 70%.',
    lineas: [[2026, 'Asesoria Residuos plantas'], [2026, 'Contenedor piloto'], [2026, 'Retiro Residuos El Trebal Maipu']],
    evidencias: [{ t: 'Línea base residuos por planta 2026', u: 'https://docs.google.com/spreadsheets/d/1ResiduosPlantasLineaBase2026/edit' }],
  });
  P.kyklos = adopt(U.benja, {
    pilar: 'ec', from: 'APL EDS', nombre: 'Red de recicladores de base (Kyklos)', resp: U.benja, anio: '2026',
    inicio: -230, fin: 120,
    detalle: 'Primera etapa con recicladores de base y adhesión al Acuerdo de Producción Limpia de EDS.',
    lineas: [[2026, 'Kyklos red recicladores de base (1a etapa)'], [2026, 'Inscripcion Acuerdo APL']],
  });
  P.irec = adopt(U.gonzalo, {
    pilar: 'cc', from: 'Compra de certificados de energía renovable', nombre: 'Certificación IREC / ISO 50001', resp: U.gonzalo, anio: '2026',
    inicio: -270, fin: 85,
    detalle: 'Compra de certificados de energía renovable (I-REC) y recertificación del sistema de gestión de energía ISO 50001.',
    lineas: [[2026, 'GV - IREC Flux (compra certificados renovables)'], [2026, 'GV - Auditoria interna ISO 50001'], [2026, 'GV - Recertificacion ISO 50001']],
  });
  P.huella = adopt(U.gonzalo, {
    pilar: 'cc', from: 'Mitigación Huella', nombre: 'Huella de carbono y bonos de carbono 2026', resp: U.gonzalo, anio: '2026',
    inicio: -275, fin: 88,
    detalle: 'Medición y verificación de la huella corporativa, compensaciones EDS y asesoría en mercados de carbono (Artículo 6.2).',
    lineas: [[2026, 'GV - Emisiones: certificacion Huella Carbono + Huella Chile'], [2026, 'GV - Emisiones: mi huella (Disney)'], [2026, 'Analisis prevencion (Huella)'], [2026, 'Apoyo SGE - EMOAC (Huella)'], [2026, 'Artículo 6.2']],
    evidencias: [{ t: 'Reporte bonos de carbono 2026', u: BONOS }],
  });
  P.jardines = adopt(U.ignacio, {
    pilar: 'nat', from: 'Jardines Sustentables 2026', nombre: 'Jardines sustentables', resp: U.ignacio, anio: '2026',
    inicio: -150, fin: 60,
    detalle: 'Levantamiento, estándares y mantención de jardines de bajo consumo hídrico en EDS.',
    lineas: [[2026, 'Levantamiento informacion Jardines'], [2026, 'Estándares jardines'], [2026, 'Levantamiento jardines sustentables']],
  });
  P.lluta = adopt(U.ina, {
    pilar: 'nat', from: '15 - Santuario Naturaleza Desembocadura río Lluta, Arica (2025)', nombre: 'Santuario río Lluta (Arica)', resp: U.ina,
    estado: 'En pausa', inicio: -120, fin: 150,
    detalle: 'En pausa hasta firmar el convenio con la municipalidad.',
  });
  P.camion = adopt(U.benja, {
    pilar: 'cc', from: 'Piloto 1er Camión eléctrico', nombre: 'Piloto 1er camión eléctrico', resp: U.benja, anio: '2026',
    inicio: -95, fin: -5,
    detalle: 'Piloto de un camión eléctrico en la ruta Santiago–Valparaíso.',
  });
  P.descarbo = adopt(U.benja, {
    pilar: 'cc', from: 'Estrategia descarbonización Logística', resp: U.benja, anio: '2026', inicio: -60, fin: 110,
    detalle: 'Hoja de ruta para descarbonizar la logística: benchmark, mesas de trabajo con transportistas y entregable final.',
  });
  P.sello = adopt(U.ina, {
    pilar: 'nat', from: 'Certificación de "Sello Azul" en instalaciones', resp: U.ina, anio: '2026', inicio: -45, fin: 140,
    detalle: 'Postulación de instalaciones de Santiago al Sello Azul.',
  });
  P.maipo = adopt(U.ina, {
    pilar: 'nat', from: '13 - Santuario del Maipo, San José de Maipo (2026)', nombre: 'Santuario del Maipo', resp: U.ina, anio: '2026',
    inicio: -100, fin: 200,
  });
  P.isla = adopt(U.ignacio, {
    pilar: 'ec', from: 'Isla Sin Basura', resp: U.ignacio, anio: '2026', inicio: -30, fin: 200,
    detalle: 'Piloto de islas sin basura en EDS: separación en origen y retiro con recicladores de base.',
  });
  P.sge = adopt(U.gonzalo, { pilar: 'cc', from: 'Implementación SGE', resp: U.gonzalo, anio: '2026', inicio: -210, fin: 150 });
  P.hibridos = adopt(U.benja, {
    pilar: 'cc', from: 'Proyecto camiones híbridos', resp: U.benja, anio: '2027', inicio: 25, fin: 260,
    detalle: 'Evaluación técnica y económica de camiones híbridos para la flota de distribución.',
  });
  P.zeroWaste = adopt(U.ignacio, { pilar: 'ec', from: 'Elaborar estrategia Zero Waste', resp: U.ignacio, anio: '2026', inicio: -120, fin: 30 });
  // Un proyecto propio del equipo (no está en Cascade)
  P.voluntariado = project(U.ina, {
    pilar: 'nat', nombre: 'Voluntariado corporativo de limpieza de playas', resp: U.ina, anio: '2026', inicio: 10, fin: 70,
    detalle: 'Jornada de limpieza con voluntarios de Copec en Quintero y Concón.',
  });

  /* ---------- Tareas pendientes (fecha = días desde hoy) ---------- */
  var T = {};
  T.pertinencia = task(U.ina, { pilar: 'nat', proyecto: P.bato, resp: U.ina, fecha: -5, cascade: '5 - Humedal El Bato, Quintero (2020)',
    nombre: 'Enviar consulta de pertinencia (retiro de totora) al SEA', detalle: 'Adjuntar informe técnico de la consultora y plano del área de intervención.' });
  T.reunionBato = task(U.ina, { pilar: 'nat', proyecto: P.bato, resp: U.ina, fecha: 2, avisar: false,
    nombre: 'Reunión de seguimiento con la fundación (El Bato)', detalle: 'Ya está en el calendario: no necesito aviso por correo.' });
  task(U.benja, { pilar: 'nat', proyecto: P.bato, resp: U.benja, fecha: 12, nombre: 'Revisar informe trimestral de calidad de agua El Bato' });
  T.cuota = task(U.benja, { pilar: 'nat', proyecto: P.chimba, resp: U.benja, fecha: 0, cascade: '2 - Humedal Aguada La Chimba, Antofagasta (2019)',
    nombre: 'Pagar 2ª cuota Aguada La Chimba (OC 4500123)', detalle: 'Factura recibida; falta la recepción conforme.' });
  task(U.benja, { pilar: 'nat', proyecto: P.chimba, resp: U.benja, fecha: 25, nombre: 'Coordinar visita a terreno La Chimba' });
  task(U.ignacio, { pilar: 'ec', proyecto: P.residuos, resp: U.ignacio, fecha: -2, cascade: 'Costo Valorización / Tonelada valorizadas',
    nombre: 'Consolidar toneladas valorizadas de septiembre (todas las plantas)' });
  task(U.ignacio, { pilar: 'ec', proyecto: P.residuos, resp: U.ignacio, fecha: 4, cascade: 'Planta Concón', nombre: 'Cotizar retiro de residuos Planta Concón' });
  T.contenedor = task(U.gonzalo, { pilar: 'ec', proyecto: P.residuos, resp: U.gonzalo, fecha: 1, nombre: 'Definir OC del contenedor piloto' });
  task(U.benja, { pilar: 'ec', proyecto: P.kyklos, resp: U.benja, fecha: 28, cascade: 'APL EDS', nombre: 'Firmar convenio 2ª etapa con Kyklos' });
  T.auditoria = task(U.gonzalo, { pilar: 'cc', proyecto: P.irec, resp: U.gonzalo, fecha: 6, cascade: 'Implementación SGE', nombre: 'Programar auditoría interna ISO 50001' });
  T.irec = task(U.gonzalo, { pilar: 'cc', proyecto: P.irec, resp: U.gonzalo, fecha: -12, cascade: 'Certificados IREC',
    nombre: 'Emitir certificados IREC 2026 (Flux)', detalle: 'Pedir a Flux la emisión a nombre de Copec y subir los certificados a la carpeta.' });
  T.bonos = task(U.gonzalo, { pilar: 'cc', proyecto: P.huella, resp: U.gonzalo, fecha: 3, cascade: 'Compensación EDS',
    nombre: 'Actualizar reporte de bonos de carbono (Artículo 6.2)', detalle: 'Agregar las compensaciones de EDS del tercer trimestre.',
    evidencias: [{ t: 'Reporte bonos de carbono 2026', u: BONOS }] });
  task(U.ignacio, { pilar: 'cc', proyecto: P.huella, resp: U.ignacio, fecha: 20, nombre: 'Cargar inventario de emisiones 2025 en Huella Chile' });
  task(U.ignacio, { pilar: 'nat', proyecto: P.jardines, resp: U.ignacio, fecha: 9, cascade: 'Jardines Sustentables 2026', nombre: 'Licitar mantención de jardines sustentables (zona centro)' });
  task(U.ina, { pilar: 'nat', proyecto: P.jardines, resp: U.ina, fecha: 40, cascade: 'Reducción - Jardines sustentables', nombre: 'Medir consumo de agua en jardines piloto' });
  task(U.ina, { pilar: 'nat', proyecto: P.sello, resp: U.ina, fecha: 18, cascade: 'Certificación de "Sello Azul" en instalaciones', nombre: 'Postular a Sello Azul (instalaciones Santiago)' });
  task(U.ignacio, { pilar: 'ec', proyecto: P.isla, resp: U.ignacio, cascade: 'Isla Sin Basura', nombre: 'Revisar propuesta Isla Sin Basura' });
  task(U.ina, { pilar: 'nat', proyecto: P.lluta, resp: U.ina, nombre: 'Retomar contacto con la municipalidad de Arica' });
  task(U.benja, { pilar: 'cc', proyecto: P.hibridos, resp: U.benja, fecha: 35, nombre: 'Pedir fichas técnicas de camiones híbridos a tres marcas' });
  task(U.gonzalo, { pilar: 'ec', proyecto: P.zeroWaste, resp: U.ignacio, fecha: 14, cascade: 'Elaborar estrategia Zero Waste', nombre: 'Borrador de estrategia Zero Waste para comité' });
  task(U.ina, { pilar: 'nat', proyecto: P.voluntariado, resp: U.ina, fecha: 30, nombre: 'Coordinar transporte para el voluntariado' });
  // Una tarea de pilar sin proyecto
  task(U.ignacio, { pilar: 'ec', resp: U.ignacio, fecha: 45, nombre: 'Revisar indicadores de reciclaje de oficinas centrales' });

  /* ---------- Hitos importados de Cascade (Estrategia descarbonización Logística) ---------- */
  milestone(U.benja, P.descarbo, 'cc', 'Entregable 1 - Benchmark y medidas de mitigación', { resp: U.benja, fecha: -20,
    done: { hace: 18, cierre: 'Benchmark entregado: 14 medidas priorizadas por costo y potencial de reducción.', evidencias: [{ t: 'Benchmark descarbonización logística', u: 'https://docs.google.com/presentation/d/1BenchmarkDescarbonizacionLog/edit' }] } });
  T.mesas = milestone(U.benja, P.descarbo, 'cc', 'Mesas de trabajo', { resp: U.benja, fecha: 7, detalle: 'Preparar la presentación de la estrategia para la mesa con transportistas.' });
  milestone(U.benja, P.descarbo, 'cc', 'Entregable final - Hoja de ruta', { resp: U.benja, fecha: 100 });

  /* ---------- Pendientes personales (sin pilar) y tareas privadas ---------- */
  T.finanzas = task(U.gonzalo, { resp: U.gonzalo, fecha: 1, nombre: 'Responder a Finanzas sobre el cierre trimestral' });
  task(U.ina, { resp: U.ina, fecha: 0, nombre: 'Reservar sala para la reunión de equipo' });
  task(U.benja, { resp: U.benja, nombre: 'Actualizar firma de correo con el nuevo cargo' });
  T.feedback = task(U.gonzalo, { resp: U.gonzalo, fecha: 9, privada: true, nombre: 'Preparar conversaciones de feedback con el equipo',
    detalle: 'Notas personales: logros del semestre y próximos desafíos de cada uno.' });
  task(U.ina, { resp: U.ina, fecha: 6, privada: true, nombre: 'Preparar mi evaluación de desempeño' });
  task(U.benja, { resp: U.benja, fecha: 2, privada: true, nombre: 'Ordenar facturas pendientes de octubre' });
  task(U.ignacio, { pilar: 'ec', proyecto: P.residuos, resp: U.ignacio, fecha: 10, privada: true, nombre: 'Borrador de propuesta para Planta Concón',
    detalle: 'Todavía es un borrador; lo comparto cuando esté más armado.' });

  /* ---------- Tareas realizadas (últimos 60 días) ---------- */
  task(U.ina, { pilar: 'nat', proyecto: P.bato, resp: U.ina, fecha: -40, nombre: 'Firmar OC continuación El Bato',
    done: { hace: 38, cierre: 'OC 4500987 firmada por gerencia y enviada a la fundación.', evidencias: [{ t: 'OC El Bato 2026 (PDF)', u: 'https://drive.google.com/file/d/1OcElBato2026PdfQ/view' }] } });
  task(U.gonzalo, { pilar: 'cc', proyecto: P.huella, resp: U.gonzalo, fecha: -30, cascade: 'Compensación EDS', nombre: 'Reporte de bonos de carbono Q2',
    done: { hace: 29, cierre: 'Reporte enviado a Finanzas. Quedó guardado en la planilla "Reporte bonos de carbono 2026".', evidencias: [{ t: 'Reporte bonos de carbono 2026', u: BONOS }] } });
  task(U.gonzalo, { pilar: 'cc', proyecto: P.irec, resp: U.gonzalo, fecha: -50, cascade: 'Compra de certificados de energía renovable', nombre: 'Compra de certificados IREC del primer semestre',
    done: { hace: 45, cierre: 'Compra de 12.000 MWh en certificados I-REC vía Flux.', evidencias: [{ t: 'Certificados I-REC 2026 S1', u: 'https://drive.google.com/drive/folders/1IrecCertificados2026S1q' }] } });
  task(U.ignacio, { pilar: 'ec', proyecto: P.residuos, resp: U.ignacio, fecha: -20, cascade: 'Planta Maipú', nombre: 'Diagnóstico de residuos Planta Maipú',
    done: { hace: 18, cierre: 'Diagnóstico entregado por la consultora; tasa de desvío actual 61%.', evidencias: [{ t: 'Diagnóstico residuos Planta Maipú', u: 'https://docs.google.com/document/d/1DiagnosticoMaipuResiduosX/edit' }] } });
  task(U.benja, { pilar: 'ec', proyecto: P.kyklos, resp: U.benja, fecha: -55, cascade: 'APL EDS', nombre: 'Inscripción en el Acuerdo de Producción Limpia',
    done: { hace: 52, cierre: 'Inscripción aprobada por la Agencia de Sustentabilidad y Cambio Climático.', evidencias: [{ t: 'Certificado inscripción APL', u: 'https://drive.google.com/file/d/1CertInscripcionAPLx/view' }] } });
  task(U.ignacio, { pilar: 'nat', proyecto: P.jardines, resp: U.ignacio, fecha: -15, cascade: 'Jardines Sustentables 2026', nombre: 'Levantamiento de jardines en 40 EDS',
    done: { hace: 10, cierre: 'Levantamiento terminado: 40 EDS con ficha y fotos.', evidencias: [{ t: 'Levantamiento jardines EDS', u: 'https://docs.google.com/spreadsheets/d/1LevantamientoJardinesEDSv/edit' }] } });
  task(U.benja, { pilar: 'nat', proyecto: P.chimba, resp: U.benja, fecha: -35, cascade: '2 - Humedal Aguada La Chimba, Antofagasta (2019)', nombre: 'Pagar 1ª cuota Aguada La Chimba',
    done: { hace: 33, cierre: 'Pago realizado (50% del convenio).' } });
  task(U.benja, { pilar: 'cc', proyecto: P.camion, resp: U.benja, fecha: -25, cascade: 'Piloto 1er Camión eléctrico', nombre: 'Ruta piloto camión eléctrico Santiago–Valparaíso',
    done: { hace: 24, cierre: 'Piloto completado: 1.200 km sin incidentes.', evidencias: [{ t: 'Informe piloto camión eléctrico', u: 'https://docs.google.com/presentation/d/1InformePilotoCamionElectrico/edit' }] } });
  task(U.benja, { pilar: 'cc', proyecto: P.camion, resp: U.benja, fecha: -8, cascade: 'Piloto 1er Camión eléctrico', nombre: 'Informe final del piloto de camión eléctrico',
    done: { hace: 6, cierre: 'Informe final presentado al comité de sostenibilidad.' } });
  task(U.ina, { pilar: 'nat', proyecto: P.maipo, resp: U.ina, fecha: -12, cascade: '13 - Santuario del Maipo, San José de Maipo (2026)', nombre: 'Visita al Santuario del Maipo',
    done: { hace: 12, cierre: 'Visita realizada con la fundación; minuta en Drive.', evidencias: [{ t: 'Minuta visita Santuario del Maipo', u: 'https://docs.google.com/document/d/1MinutaVisitaSantuarioMaipo/edit' }] } });
  task(U.gonzalo, { pilar: 'cc', proyecto: P.huella, resp: U.gonzalo, fecha: -3, nombre: 'Verificación de la huella de carbono 2025',
    done: { hace: 1, cierre: 'Verificación aprobada por tercero (Huella Chile).' } });
  // Checks rápidos desde la lista personal: sin comentario de cierre (v3)
  task(U.ignacio, { resp: U.ignacio, fecha: -2, nombre: 'Enviar fotos de la visita a Planta Maipú', done: { hace: 2 } });
  task(U.gonzalo, { resp: U.gonzalo, fecha: -1, nombre: 'Agendar la reunión de planificación 2027', done: { hace: 0 } });

  /* ---------- Orden manual de las listas personales ---------- */
  reorder(U.gonzalo, [T.finanzas, T.irec, T.bonos, T.contenedor, T.feedback, T.auditoria]);
  reorder(U.ina, [T.pertinencia, T.reunionBato]);

  /* ---------- Comentarios ---------- */
  comment(U.ina, P.huella, '¿El reporte de bonos incluye las compensaciones de EDS? Lo pidió Finanzas.');
  comment(U.gonzalo, P.huella, 'Sí, quedó en la pestaña "Compensaciones" de la planilla: ' + BONOS);
  comment(U.benja, P.bato, 'La fundación pidió adelantar la segunda visita a noviembre.');
  comment(U.benja, T.cuota, 'Factura N° 2231 recibida; falta la recepción conforme del área.');
  comment(U.ignacio, T.irec, 'Flux confirma la emisión para la próxima semana.');
  comment(U.benja, T.mesas, 'Confirmaron 6 transportistas para la primera mesa.');
  comment(U.gonzalo, T.feedback, 'Nota para mí: partir por lo que salió bien.');
  var lh = line(2026, 'Huairavo - Continuacion');
  if (lh) comment(U.ina, lh.id, 'Pendiente definir OC: esperando cotización actualizada de la fundación.');
  var la = line(2026, 'Artículo 6.2');
  if (la) comment(U.gonzalo, la.id, 'Asesoría en mercados de carbono (Art. 6.2 del Acuerdo de París).');

  /* ---------- Responsables de líneas ---------- */
  owner(2026, 'Huairavo - Continuacion', U.ina);
  owner(2026, 'Centro de rescate Huilo Huilo - Etapa 3', U.ina);
  owner(2026, 'Kyklos red recicladores de base (1a etapa)', U.benja);
  owner(2026, 'Nuevo proyecto bio', U.benja);
  owner(2026, 'Asesoria Residuos plantas', U.ignacio);
  owner(2026, 'GV - IREC Flux (compra certificados renovables)', U.gonzalo);
  owner(2026, 'Artículo 6.2', U.gonzalo);

  /* ---------- Proyecto cerrado (después de completar sus tareas) ---------- */
  if (P.camion) call(U.benja, 'cerrar "Piloto 1er camión eléctrico"', function () { return gSave({ tipo: 'Proyecto', id: P.camion, estado: 'Cerrado' }); });

  MOCK.user = prevUser;
  rep.ids = { projects: P, tasks: T };
  return rep;
}
