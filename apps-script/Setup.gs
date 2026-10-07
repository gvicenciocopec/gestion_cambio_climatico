/**
 * Setup · configuración inicial idempotente, menú de la planilla y catálogo Cascade inicial (SPEC §9).
 * Ejecutar setup() una vez desde el editor de Apps Script (se puede repetir sin duplicar nada).
 * v3: también crea los proyectos del catálogo Cascade (una vez por planilla; SPEC §13.1) y prepara la pestaña
 * oculta de solicitudes de compra (el lector de correos de Ariba se activa a mano en Ajustes).
 */

// Propiedad de script (+ ':' + id de la planilla): setup() ya importó los proyectos de Cascade en esa planilla
const SETUP_IMPORT_PROP = 'CASCADE_PROJECTS_IMPORTED';

// Catálogo inicial de indicadores Cascade. Grupos = clase 'grupo'; items: [clase, nombre].
const CASCADE_SEED = [
  /* ---------- Economía Circular ---------- */
  {
    pilar: 'ec', nombre: 'Implementación y Desarrollo Estrategia Zero Waste', etiqueta: 'Iniciativa Estratégica Organizacional',
    items: [
      ['kpi', 'Costo Valorización / Tonelada valorizadas'],
      ['kpi', 'Tasa Desvío COPEC'],
      ['accion', 'Implementar Sistemas Estrategia Zero Waste'],
      ['accion', 'Elaborar estrategia Zero Waste'],
      ['objetivo', 'Implementar el plan zero waste en la red de tiendas (Retail Arcoprime)'],
    ],
  },
  {
    pilar: 'ec', nombre: 'Valorización Plantas, CD, Oficinas', etiqueta: 'Iniciativa',
    items: [
      ['kpi', 'CD Maipú'],
      ['kpi', 'Planta Chacabuco'],
      ['kpi', 'Planta Pureo'],
      ['kpi', 'Planta Chillán'],
      ['kpi', 'Planta SIAV'],
      ['kpi', 'Planta Bluemax'],
      ['kpi', 'Planta Maipú'],
      ['kpi', 'Planta Concón'],
      ['kpi', 'Planta LUB'],
      ['kpi', 'Planta TPI'],
      ['kpi', 'Planta Guayacán'],
      ['kpi', 'Planta Caldera'],
      ['kpi', 'Planta Iquique'],
      ['kpi', 'Planta Arica'],
      ['kpi', 'Planta Mejillones'],
    ],
  },
  {
    pilar: 'ec', nombre: 'Valorización EDS', etiqueta: 'Iniciativa',
    items: [
      ['objetivo', 'Logística Inversa'],
      ['accion', 'Isla Sin Basura'],
      ['accion', 'APL EDS'],
    ],
  },

  /* ---------- Naturaleza ---------- */
  {
    pilar: 'nat', nombre: 'Iniciativas de gestión hídrica estratégicas', etiqueta: 'Iniciativa',
    items: [
      ['objetivo', 'Certificación de "Sello Azul" en instalaciones'],
    ],
  },
  {
    pilar: 'nat', nombre: 'Iniciativas de reducción de consumo hídrico', etiqueta: 'Iniciativa',
    items: [
      ['accion', 'Búsqueda y evaluación de nuevas iniciativas de reducción hídrica'],
      ['accion', 'Pilotaje de reúso de aguas grises tratadas en baños Pronto'],
      ['accion', 'Implementación de remarcadores de agua en estaciones de servicio con sobreconsumo'],
    ],
  },
  {
    pilar: 'nat', nombre: 'Reducción neta de consumo de agua', etiqueta: 'Iniciativa',
    items: [
      ['kpi', 'Reducción - Jardines sustentables'],
      ['kpi', 'Reducción - Reductores de flujo en grifería'],
      ['kpi', 'Reducción - Autolavado'],
      ['kpi', 'Reducción - Sobreconsumo EDS 20606'],
      ['kpi', 'Reducción - Lavado Tunel'],
      ['kpi', 'Reducción - Eliminación de jardines'],
      ['kpi', 'Reducción - Planta Pureo'],
      ['kpi', 'Compensación - Kilimo'],
      ['kpi', 'Compensación - Nilus'],
      ['accion', 'Reducción - Oneka'],
    ],
  },
  {
    pilar: 'nat', nombre: 'Conservar y proteger Ecosistemas cercanos a nuestra operación', etiqueta: 'Iniciativa',
    items: [
      ['accion', '15 - Santuario Naturaleza Desembocadura río Lluta, Arica (2025)'],
      ['accion', '1 - Quebrada de Huatacondo, Pozo Almonte (2025)'],
      ['accion', '2 - Humedal Aguada La Chimba, Antofagasta (2019)'],
      ['accion', '3 - Parque Nacional Nevado Tres Cruces, Copiapó (2025)'],
      ['accion', '4 - Humedal Estero Tongoy, Coquimbo (2025)'],
      ['accion', '5 - Humedal El Bato, Quintero (2020)'],
      ['accion', '13 - Santuario del Maipo, San José de Maipo (2026)'],
      ['accion', '13 - Humedal El Trebal, Maipú (2025)'],
      ['accion', '7 - Humedal Rio Claro, Talca (2025)'],
      ['accion', '8 - Humedal Palomares (2026)'],
      ['accion', '16 - Reserva Nacional Huemules Niblinto, Coihueco (2025)'],
      ['accion', '14 - Centro Rescate Fauna Silvestre Huilo Huilo (2024)'],
      ['accion', '10 - Santuario Naturaleza Isla Kaikue/Lagartija, Calbuco (2025)'],
      ['accion', '11 - Humedal Vientos del Chelenko, Rio Ibáñez (2022)'],
      ['accion', '12 - Humedal Huairavo, Cabo de hornos (2025)'],
    ],
  },
  {
    pilar: 'nat', nombre: 'Implementación Jardines Sustentables', etiqueta: 'Iniciativa Estratégica Organizacional',
    items: [
      ['accion', 'Jardines Sustentables 2026'],
    ],
  },

  /* ---------- Cambio Climático ---------- */
  {
    pilar: 'cc', nombre: 'Gestión energética', etiqueta: '',
    items: [
      ['accion', 'Implementación SGE'],
      ['accion', 'Spirax - recubrimiento térmico planta lubricantes'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Consumo de energía renovable', etiqueta: 'Iniciativa',
    items: [
      ['accion', 'Compra de certificados de energía renovable'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Electrificación flota logística', etiqueta: 'Iniciativa Estratégica Organizacional',
    items: [
      ['accion', 'Proyecto camiones híbridos'],
      ['accion', 'Piloto 1er Camión eléctrico'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Eficiencia energética logística', etiqueta: 'Iniciativa',
    items: [
      ['accion', 'Vigía - Inflado automático de neumatico'],
      ['accion', 'Diésel Premium'],
      ['accion', 'Green Energy: Paneles solares en camiones'],
      ['accion', 'Gestión de datos'],
      ['accion', 'Efilabs - Inflado de neumáticos'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Mitigación Huella', etiqueta: 'Iniciativa',
    items: [
      ['kpi', 'Movener'],
      ['kpi', 'Gestión de flota'],
      ['kpi', 'Diésel Premium'],
      ['kpi', 'Green Energy'],
      ['kpi', 'Efilabs'],
      ['kpi', 'Compensación EDS'],
      ['kpi', 'Electrificación de flota lubricantes'],
      ['kpi', 'Climatización eficiente Pronto'],
      ['kpi', 'Certificados IREC'],
      ['kpi', 'Contrato energía renovable'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Sistema de climatización Flair', etiqueta: 'Iniciativa',
    items: [
      ['accion', 'Piloto Pronto Express'],
    ],
  },
  {
    pilar: 'cc', nombre: 'Estrategia descarbonización Logística', etiqueta: 'Iniciativa',
    items: [
      ['hito', 'Entregable 1 - Benchmark y medidas de mitigación'],
      ['hito', 'Mesas de trabajo'],
      ['hito', 'Entregable final - Hoja de ruta'],
    ],
  },
];

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

// Configura / repara la planilla. Idempotente: se puede ejecutar cuantas veces se quiera.
// Bandeja de WhatsApp (WhatsApp.gs): pestañas "WhatsApp" (oculta) y "WhatsApp contactos" (Número → Correo)
function setupWhatsApp_(ss, out, step, warn) {
  if (typeof waEnsureSheets_ !== 'function') return;
  try {
    const r = waEnsureSheets_(ss);
    out.whatsapp = { created: r.created };
    if (r.created.length) step('Pestañas de WhatsApp creadas: ' + r.created.join(', ') + '. Completa los números en "WhatsApp contactos".');
    else step('Pestañas de WhatsApp: OK.');
  } catch (e) {
    warn('No se pudieron crear las pestañas de WhatsApp: ' + ((e && e.message) || e));
  }
}

function setup() {
  const out = {
    ok: true, sheetId: '', steps: [], warnings: [],
    gestion: {}, historial: {}, budget: {}, cascade: {}, cascadeProjects: {}, aprob: {}, trigger: {},
  };
  const step = msg => { out.steps.push(msg); Logger.log(msg); };
  const warn = msg => { out.warnings.push(msg); Logger.log('AVISO: ' + msg); };

  // 1) Recordar la planilla vinculada (así la app web la encuentra siempre)
  let active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) {
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', active.getId());
    step('Planilla vinculada guardada (SHEET_ID = ' + active.getId() + ').');
  } else {
    step('Sin planilla activa: se usa CONFIG.SHEET_ID o la propiedad SHEET_ID.');
  }
  const ss = ss_();
  out.sheetId = ss.getId();
  let prevActive = null;
  try { prevActive = ss.getActiveSheet(); } catch (e) { prevActive = null; }

  // 2) Estructura de la planilla (bajo lock)
  withLock_(() => {
    setupGestion_(ss, out, step, warn);
    setupHistorial_(ss, out, step);
    setupBudget_(ss, out, step, warn);
    setupCascade_(ss, out, step, warn);
    setupCascadeProjects_(ss, out, step, warn);
    setupAprob_(ss, out, step, warn);
    setupWhatsApp_(ss, out, step, warn);
  });

  // Recalcular columnas calculadas del presupuesto (recalcAll toma su propio lock)
  if (typeof recalcAll === 'function') {
    try { recalcAll(); step('Pendiente / Estado / Alerta recalculados en todas las pestañas Cuadre.'); } catch (e) { warn('No se pudo recalcular el presupuesto: ' + (e && e.message)); }
  }

  // 3) Activador diario de correos (fuera del lock). Sólo administradores: corre como su creador.
  if (isAdmin_()) {
    try {
      notifInstall_();
      out.trigger = { installed: true, hour: CONFIG.NOTIFY_HOUR };
      step('Aviso de tareas vencidas activo (se revisa todos los días a las ' + CONFIG.NOTIFY_HOUR + ':00, ' + tz_() + ').');
    } catch (e) {
      out.trigger = { installed: false, reason: String(e && e.message) };
      warn('No se pudo instalar el aviso diario de tareas vencidas: ' + (e && e.message));
    }
  } else {
    out.trigger = { installed: false, reason: 'Sólo un administrador instala el aviso diario de tareas vencidas.' };
    warn('El aviso diario de tareas vencidas no se instaló: ejecuta setup() con una cuenta administradora (' + CONFIG.ADMINS.join(', ') + ').');
  }

  // Revisiones útiles
  try {
    const stz = ss.getSpreadsheetTimeZone();
    if (stz && stz !== tz_()) warn('La zona horaria de la planilla (' + stz + ') no coincide con la del script (' + tz_() + '). Ajústala en Archivo › Configuración para que las fechas no se corran un día.');
  } catch (e) { /* opcional */ }
  if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
    step('Sin GEMINI_API_KEY: el asistente funcionará en modo búsqueda (directorio).');
  }
  if (!appUrl_()) step('La app aún no está implementada como app web: los correos irán sin botón "Abrir mis tareas".');
  let savedUrl = '';
  try { savedUrl = CONFIG.APP_URL || PropertiesService.getScriptProperties().getProperty('APP_URL') || ''; } catch (e) { savedUrl = ''; }
  if (!savedUrl) {
    warn('Aún no hay URL de la app guardada para el botón "Abrir mis tareas" de los correos diarios. Se guarda sola la ' +
      'primera vez que alguien abre la URL publicada de la app web (la que termina en /exec); también puedes pegarla en Ajustes.');
  }

  try { log_('Configurar app', 'Setup', out.steps.concat(out.warnings).join(' · ')); } catch (e) { /* opcional */ }
  try {
    if (prevActive && prevActive.getName() !== CONFIG.GESTION_SHEET) ss.setActiveSheet(prevActive);
  } catch (e) { /* opcional */ }
  setupAlert_(out);
  return out;
}

// Menú en la planilla (sólo si el script está vinculado a la hoja)
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu(CONFIG.APP_NAME)
      .addItem('Configurar / reparar', 'setup')
      .addItem('Recalcular Pendiente / Estado / Alerta', 'recalcAll')
      .addSeparator()
      .addItem('Mostrar u ocultar pestaña Gestión', 'toggleGestionSheet')
      .addItem('Enviarme mis tareas vencidas', 'sendTestDigest')
      .addToUi();
  } catch (e) { /* sin interfaz (p. ej. ejecución sin hoja abierta) */ }
}

// Muestra u oculta la pestaña Gestión (al mostrarla, queda activa)
function toggleGestionSheet() {
  const ss = ss_();
  const sh = ss.getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh) throw new Error('La pestaña "' + CONFIG.GESTION_SHEET + '" aún no existe. Usa "Configurar / reparar" primero.');
  if (sh.isSheetHidden()) {
    sh.showSheet();
    try { ss.setActiveSheet(sh); } catch (e) { /* sin interfaz */ }
    return { hidden: false };
  }
  try {
    sh.hideSheet();
  } catch (e) {
    throw new Error('No se puede ocultar "' + CONFIG.GESTION_SHEET + '" porque es la única pestaña visible.');
  }
  return { hidden: true };
}

/* ------------------------------------------------------------------ */
/* Pasos internos (dentro del lock)                                    */
/* ------------------------------------------------------------------ */

function setupGestion_(ss, out, step, warn) {
  const before = ss.getSheetByName(CONFIG.GESTION_SHEET);
  let missing = [];
  if (before && before.getLastColumn()) {
    const have = before.getRange(1, 1, 1, before.getLastColumn()).getValues()[0].map(norm_);
    missing = G_HEADERS.filter(h => have.indexOf(norm_(h)) < 0);
  }
  const sh = gSheet_(ss);
  gFormat_(sh);
  sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).setFontWeight('bold');
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  let hidden = sh.isSheetHidden();
  if (!hidden) {
    try { sh.hideSheet(); hidden = true; } catch (e) { warn('No se pudo ocultar "' + CONFIG.GESTION_SHEET + '": es la única pestaña visible.'); }
  }
  out.gestion = {
    created: !before,
    hidden: hidden,
    columnsAdded: before ? missing.length : 0,
    rows: Math.max(sh.getLastRow() - 1, 0),
  };
  step(!before
    ? 'Pestaña "' + CONFIG.GESTION_SHEET + '" creada y oculta.'
    : 'Pestaña "' + CONFIG.GESTION_SHEET + '" revisada (' + out.gestion.rows + ' filas' +
      (missing.length ? ', columnas agregadas: ' + missing.join(', ') : '') + ').');
}

function setupHistorial_(ss, out, step) {
  let sh = ss.getSheetByName(CONFIG.LOG_SHEET);
  const created = !sh;
  if (!sh) sh = ss.insertSheet(CONFIG.LOG_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 5).setValues([['Fecha', 'Usuario', 'Acción', 'Proyecto', 'Detalle']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  out.historial = { created: created, rows: Math.max(sh.getLastRow() - 1, 0) };
  step(created ? 'Pestaña "' + CONFIG.LOG_SHEET + '" creada.' : 'Pestaña "' + CONFIG.LOG_SHEET + '" OK (' + out.historial.rows + ' registros).');
}

// Columnas Responsable / ID en cada "Cuadre AAAA" + IDs faltantes, inválidos o repetidos entre pestañas
// (p. ej. al duplicar "Cuadre 2026" para crear 2027). Usa los helpers de Presupuesto.gs (sin lock propio).
function setupBudget_(ss, out, step, warn) {
  const res = { years: [], columnsAdded: 0, idsAssigned: 0 };
  out.budget = res;
  if (typeof presYears_ !== 'function') { warn('Falta el módulo Presupuesto.gs (presYears_).'); return; }
  const years = (presYears_(ss) || []).slice().sort((a, b) => a.year - b.year);
  if (!years.length) { warn('No encontré pestañas "' + CONFIG.BUDGET_PREFIX + ' AAAA" (ej. "' + CONFIG.BUDGET_PREFIX + ' 2026").'); return; }
  const seen = new Set(); // IDs únicos en toda la planilla (en orden de año)
  years.forEach(y => {
    const sh = y.sheet;
    res.years.push(y.year);
    const cols = sh.getLastColumn();
    try {
      if (typeof presFixTab_ === 'function') {
        res.idsAssigned += (presFixTab_(sh, seen, false) || {}).ids || 0; // columnas + IDs, sin recalcular
      } else if (typeof presEnsureColumns_ === 'function') {
        presEnsureColumns_(sh); // los IDs los completa recalcAll() más abajo
      }
    } catch (e) {
      warn('Pestaña "' + sh.getName() + '": ' + (e && e.message));
    }
    res.columnsAdded += Math.max(sh.getLastColumn() - cols, 0);
  });
  step('Presupuesto: ' + years.map(y => y.sheet.getName()).join(', ') + ' · columnas agregadas: ' + res.columnsAdded +
    ' · IDs asignados o corregidos: ' + res.idsAssigned + '.');
}

// Siembra el catálogo Cascade sólo si no hay ninguna fila Cascade (nunca duplica)
function setupCascade_(ss, out, step, warn) {
  const sh = gSheet_(ss);
  const t = gTable_(sh);
  const raws = gAll_(t);
  const existing = raws.filter(r => r.tipo === 'Cascade').length;
  if (existing) {
    out.cascade = { seeded: 0, existing: existing };
    step('Catálogo Cascade existente (' + existing + ' filas): no se modifica.');
    return;
  }
  const me = me_();
  const now = new Date();
  const used = {};
  raws.forEach(r => { used[r.id] = true; });
  const newId = () => { let id = uid_('CAS'); while (used[id]) id = uid_('CAS'); used[id] = true; return id; };
  const audit = { 'Creado por': me, Creado: now, 'Actualizado por': me, Actualizado: now };
  const ordenGrupo = {};
  const rows = [];
  let groups = 0;
  CASCADE_SEED.forEach(g => {
    const pilar = pillarKey_(g.pilar);
    if (!pilar) { warn('Pilar desconocido en CASCADE_SEED: ' + g.pilar); return; }
    const area = pillarArea_(pilar);
    ordenGrupo[pilar] = (ordenGrupo[pilar] || 0) + 1;
    const gid = newId();
    groups++;
    rows.push(gApply_(t, gBlankRow_(t), Object.assign({
      ID: gid, Tipo: 'Cascade', Pilar: area, Padre: '', Nombre: g.nombre, Detalle: g.etiqueta || '',
      Clase: 'grupo', Orden: ordenGrupo[pilar],
    }, audit)));
    (g.items || []).forEach((it, k) => {
      rows.push(gApply_(t, gBlankRow_(t), Object.assign({
        ID: newId(), Tipo: 'Cascade', Pilar: area, Padre: gid, Nombre: it[1], Detalle: '',
        Clase: gClase_(it[0]) || 'accion', Orden: k + 1,
      }, audit)));
    });
  });
  if (rows.length) gWriteRows_(sh, t.values.length + 1, rows);
  out.cascade = { seeded: rows.length, groups: groups, existing: 0 };
  step('Catálogo Cascade cargado: ' + groups + ' grupos y ' + (rows.length - groups) + ' indicadores.');
}

// Proyectos desde el catálogo Cascade (SPEC §13.1). Se hace UNA vez por planilla: así un proyecto importado que el
// equipo eliminó no reaparece al volver a ejecutar setup(). Para traer los que falten (p. ej. indicadores nuevos):
// Ajustes › Importar proyectos de Cascade (importCascadeProjects, sólo administradores).
function setupCascadeProjects_(ss, out, step, warn) {
  if (typeof gImportCascadeProjects_ !== 'function') { warn('Falta el módulo Gestion.gs (gImportCascadeProjects_).'); return; }
  const props = PropertiesService.getScriptProperties();
  const key = SETUP_IMPORT_PROP + ':' + ss.getId();
  const done = props.getProperty(key);
  if (done) {
    out.cascadeProjects = { imported: false, projects: 0, tasks: 0, already: done };
    step('Proyectos de Cascade ya importados (' + String(done).slice(0, 10) + '). Para traer los que falten usa Ajustes › Importar proyectos de Cascade.');
    return;
  }
  try {
    const r = gImportCascadeProjects_(ss) || { projects: 0, tasks: 0 };
    out.cascadeProjects = { imported: true, projects: r.projects, tasks: r.tasks };
    if (r.catalog) props.setProperty(key, new Date().toISOString()); // sin catálogo aún: se reintenta la próxima vez
    step('Proyectos desde Cascade: ' + r.projects + (r.projects === 1 ? ' proyecto' : ' proyectos') + ' y ' + r.tasks +
      (r.tasks === 1 ? ' tarea (hito)' : ' tareas (hitos)') + ' creados' + (r.projects || r.tasks ? '' : ' (ya existían)') + '.');
  } catch (e) {
    out.cascadeProjects = { imported: false, error: String((e && e.message) || e) };
    warn('No se pudieron crear los proyectos de Cascade: ' + (e && e.message));
  }
}

// Pestaña oculta de solicitudes de compra (Aprobaciones.gs). El lector de correos de Ariba NO se instala aquí:
// necesita permiso para leer el Gmail del dueño, así que el administrador lo activa en Ajustes (aprobInstall).
function setupAprob_(ss, out, step, warn) {
  if (typeof aprobSheet_ !== 'function') {
    out.aprob = { sheet: false };
    warn('Falta el módulo Aprobaciones.gs: no se creó la pestaña "' + CONFIG.APROB_SHEET + '" de solicitudes de compra.');
    return;
  }
  try {
    const before = !!ss.getSheetByName(CONFIG.APROB_SHEET);
    aprobSheet_(ss);
    out.aprob = { sheet: true, created: !before };
    step('Pestaña "' + CONFIG.APROB_SHEET + '" ' + (before ? 'revisada' : 'creada') + ' (solicitudes de compra de Ariba). ' +
      'Para registrarlas solas una vez al día (~' + CONFIG.APROB_SCAN_HOUR + ':00), actívalo en Ajustes › Solicitudes de compra (aprobInstall). Siempre puedes usar «Revisar ahora».');
  } catch (e) {
    out.aprob = { sheet: false, error: String((e && e.message) || e) };
    warn('No se pudo preparar la pestaña "' + CONFIG.APROB_SHEET + '": ' + (e && e.message));
  }
}

// Resumen visible cuando se ejecuta desde el menú de la planilla
function setupAlert_(out) {
  try {
    const ui = SpreadsheetApp.getUi();
    const txt = out.steps.map(s => '• ' + s).join('\n') +
      (out.warnings.length ? '\n\nAvisos:\n' + out.warnings.map(s => '• ' + s).join('\n') : '');
    ui.alert(CONFIG.APP_NAME + ' · configuración', txt, ui.ButtonSet.OK);
  } catch (e) { /* ejecutado desde el editor o sin interfaz */ }
}
