/**
 * Cuadre AACC v3.1 · núcleo del servidor
 *
 * Módulos (todos comparten el mismo ámbito global de Apps Script):
 *   Code.gs            configuración, helpers compartidos, bundle y web app
 *   Presupuesto.gs     pestañas "Cuadre AAAA"
 *   Gestion.gs         pestaña oculta "Gestión" (proyectos, tareas, comentarios, catálogo Cascade)
 *   Drive.gs           carpeta de Drive por proyecto (unidad compartida del equipo)
 *   Notificaciones.gs  aviso por correo cuando una tarea vence (una sola vez, revisión diaria ~08:00)
 *   Aprobaciones.gs    solicitudes de compra de Ariba (sólo administradores)
 *   Asistente.gs       buscador + Gemini (anti-alucinación)
 *   Setup.gs           configuración inicial, menú de la hoja y catálogo Cascade inicial
 * Detalle técnico: dev/SPEC.md
 * Rendimiento (SPEC §14.1): las escrituras de Gestión devuelven un bundle PARCIAL (mutateG_ → bundleGestion_: sólo
 * la pestaña Gestión); el presupuesto, las solicitudes y la configuración sólo viajan en bootstrap y en sus escrituras.
 */

const CONFIG = {
  // ID de la Google Sheet (entre /d/ y /edit en la URL). Vacío si el script está vinculado a la hoja.
  SHEET_ID: '',
  // URL /exec de la implementación (Implementar › Gestionar implementaciones). Vacío → propiedad de script
  // APP_URL (se guarda en Ajustes con setAppUrl) → ScriptApp.getService().getUrl() (poco fiable en activadores).
  APP_URL: '',
  APP_NAME: 'Cuadre AACC',
  APP_VERSION: '3.1.0',
  BUDGET_PREFIX: 'Cuadre',
  GESTION_SHEET: 'Gestión',
  LOG_SHEET: 'Historial',
  ALERT_DAYS: 7,
  NOTIFY_HOUR: 8,
  GEMINI_MODEL: 'gemini-3.5-flash-lite', // se puede cambiar con la propiedad de script GEMINI_MODEL
  ADMINS: ['gvicencio@copec.cl'],
  // MODO SEGURO: funciones que necesitan permisos amplios de Google. En false, la app no las usa y el manifiesto
  // (appsscript.json) no pide esos permisos. Para activar una: ponerla en true Y agregar su permiso al manifiesto.
  // v3.6 (2026-10-06, decisión del usuario): Gmail activado (appsscript.json incluye https://mail.google.com/); Drive no.
  FEATURES: {
    DRIVE: false, // carpetas de Drive por proyecto (permiso: acceso a todo Drive)
    GMAIL: true, // lectura de correos de Ariba (permiso: Gmail completo, el único que acepta GmailApp)
  },
  // Solicitudes de compra de Ariba (panel sólo para administradores; lee el Gmail del dueño del script)
  ARIBA_SENDER: 'buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com',
  APROB_SHEET: 'Solicitudes',
  MY_CECOS: ['XUF80853'],            // CeCos propios: su parte es el monto sugerido a imputar
  APROB_SCAN_HOUR: 7,                // revisión automática diaria (~07:00–08:00); además hay botón «Revisar ahora»
  USERS: [
    { email: 'ibachler@copec.cl', name: 'Ina', color: 'violet' },
    { email: 'bderigoulier@copec.cl', name: 'Benja', color: 'sky' },
    { email: 'idiaz@copec.cl', name: 'Ignacio', color: 'amber' },
    { email: 'gvicencio@copec.cl', name: 'Gonzalo', color: 'emerald' },
  ],
  PILLARS: [
    { key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
    { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
    { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' },
  ],
};

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  // Sólo para validar el caché local del navegador (los permisos se revisan en cada llamada). JSON seguro dentro de <script>.
  t.viewerJson = JSON.stringify(me_()).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(CONFIG.APP_NAME)
    // v3.4: sin zoom en el celular (ni al escribir en un campo, ni con gestos)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

function bootstrap() {
  assertMember_();
  appUrlCapture_();
  if (typeof waImport_ === 'function') waImport_(); // tareas nuevas desde WhatsApp (nunca lanza)
  return bundle_();
}

function getHistory(limit) {
  assertMember_();
  const sh = ss_().getSheetByName(CONFIG.LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000, sh.getLastRow() - 1);
  const vals = sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues();
  return vals.reverse().map(v => ({
    fecha: iso_(v[0]) || str_(v[0]),
    usuario: str_(v[1]).toLowerCase(),
    accion: str_(v[2]),
    entidad: str_(v[3]),
    detalle: str_(v[4]),
  }));
}

function getAdminStatus() {
  assertMember_();
  const ss = ss_();
  const g = ss.getSheetByName(CONFIG.GESTION_SHEET);
  const props = PropertiesService.getScriptProperties();
  return {
    admin: isAdmin_(),
    triggerInstalled: notifStatus_().triggerInstalled,
    aprob: adminAprobStatus_(), // lector de correos de Ariba (Aprobaciones.gs) o null si el módulo no está
    geminiEnabled: !!props.getProperty('GEMINI_API_KEY'),
    model: props.getProperty('GEMINI_MODEL') || CONFIG.GEMINI_MODEL,
    years: presYears_(ss).map(y => y.year),
    gestionRows: g ? Math.max(g.getLastRow() - 1, 0) : 0,
    tz: tz_(),
    version: CONFIG.APP_VERSION,
    appUrl: appUrl_(),
    appUrlSaved: !!(CONFIG.APP_URL || props.getProperty('APP_URL')), // false → el botón de los correos puede fallar
  };
}

// Estado del lector de solicitudes de compra (Aprobaciones.gs, opcional). Nunca lanza.
function adminAprobStatus_() {
  if (typeof aprobStatus_ !== 'function') return null;
  try {
    return aprobStatus_();
  } catch (e) {
    console.error('getAdminStatus: aprobStatus_ falló: ' + (e && e.message));
    return { triggerInstalled: false, lastScan: '', lastResult: null, sender: CONFIG.ARIBA_SENDER, error: String((e && e.message) || e) };
  }
}

// Ajustes (admin): guarda la URL /exec de la implementación para los links de los correos diarios.
// getUrl() dentro de un activador devuelve una URL que no abre; por eso se guarda a mano. url vacía → se borra.
function setAppUrl(url) {
  if (!isAdmin_()) throw new Error('Sólo un administrador puede cambiar la URL de la app.');
  const u = str_(url).replace(/[?#].*$/, '');
  if (u && !/^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/?#]+|a\/[^\/?#]+\/macros|macros)\/s\/[\w-]+\/exec$/.test(u)) {
    throw new Error('Pega la URL de la implementación (https://script.google.com/…/exec), desde Implementar › Gestionar implementaciones.');
  }
  return mutate_(() => {
    const props = PropertiesService.getScriptProperties();
    if (u) props.setProperty('APP_URL', u); else props.deleteProperty('APP_URL');
    log_('Configurar app', 'URL de la app', u || '(sin URL guardada)');
    return {};
  });
}

// Primera visita a la app web publicada: si no hay URL guardada (CONFIG.APP_URL ni propiedad APP_URL), se guarda
// la de getUrl() cuando termina en /exec (/dev es la implementación de prueba del editor). Así el botón de los
// correos diarios funciona sin configurarlo a mano; setAppUrl (Ajustes) la puede reemplazar. Nunca lanza.
function appUrlCapture_() {
  try {
    if (CONFIG.APP_URL) return;
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('APP_URL')) return;
    const u = str_(ScriptApp.getService().getUrl()).replace(/[?#].*$/, '');
    if (/^https:\/\/\S+\/exec$/.test(u)) props.setProperty('APP_URL', u);
  } catch (e) {
    console.error('appUrlCapture_: no se pudo guardar la URL de la app: ' + (e && e.message));
  }
}

/* ------------------------------------------------------------------ */
/* Bundle: todo lo que necesita el navegador en una sola llamada       */
/* ------------------------------------------------------------------ */

// Estado del lector de Ariba para el bundle: versión RÁPIDA (sólo propiedades de script). ScriptApp.getProjectTriggers()
// tarda segundos y el bundle se arma en cada visita (SPEC §14.1); el estado exacto va en getAdminStatus (Ajustes).
function bundleAprobStatus_() {
  try { return typeof aprobStatusFast_ === 'function' ? aprobStatusFast_() : null; } catch (e) { return null; }
}

function bundle_() {
  SpreadsheetApp.flush();
  // Marca tomada ANTES de leer: el cliente descarta respuestas cuya lectura empezó antes que la del bundle que ya tiene.
  const loadedAt = new Date().toISOString();
  const ss = ss_();
  const warnings = [];
  const budget = bundleBudget_(ss, warnings);
  const me = me_();
  const admin = isAdmin_();
  const g = bundleGestionData_(ss, me);
  const year = new Date().getFullYear();
  return {
    me: { email: me, name: userName_(me), admin: admin },
    users: CONFIG.USERS.map(u => ({ email: u.email.toLowerCase(), name: u.name, color: u.color })),
    pillars: CONFIG.PILLARS.map(p => Object.assign({}, p)),
    years: budget.years,
    defaultYear: budget.years.indexOf(year) >= 0 ? year : (budget.years[budget.years.length - 1] || year),
    budget: budget.byYear,
    projects: g.projects,
    tasks: g.tasks,
    cascade: g.cascade,
    comments: g.comments,
    solicitudes: bundleSolicitudes_(ss, warnings), // sólo administradores; [] para el resto
    config: {
      drive: typeof driveConfigured_ === 'function' ? !!driveConfigured_() : false, // ¿hay carpeta raíz de Drive?
      features: { drive: featureOn_('DRIVE'), gmail: featureOn_('GMAIL') }, // modo seguro (CONFIG.FEATURES)
      alertDays: CONFIG.ALERT_DAYS,
      geminiEnabled: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
      tz: tz_(),
      today: today_(),
      sheetUrl: ss.getUrl(),
      appUrl: appUrl_(),
      version: CONFIG.APP_VERSION,
      warnings: warnings, // avisos para un banner (p. ej. una pestaña "Cuadre AAAA" omitida)
      aprob: admin ? bundleAprobStatus_() : null, // estado del lector de Ariba (sólo administradores)
    },
    loadedAt: loadedAt,
  };
}

// Gestión vista por un usuario. Privacidad (SPEC §13.1): sin tareas privadas ajenas ni sus comentarios (el
// administrador tampoco las ve). Común a bundle_ y bundleGestion_.
function bundleGestionData_(ss, me) {
  return gVisibleFilter_(gRead_(ss), me);
}

// Bundle PARCIAL de Gestión (SPEC §14.1): lo devuelven las escrituras que sólo tocan la pestaña Gestión. Lee una sola
// pestaña (sin presupuesto, solicitudes, propiedades ni activadores); Core reemplaza sólo estas 4 colecciones.
function bundleGestion_() {
  SpreadsheetApp.flush();
  const loadedAt = new Date().toISOString(); // antes de leer, igual que bundle_
  const g = bundleGestionData_(ss_(), me_());
  return {
    partial: 'gestion',
    projects: g.projects,
    tasks: g.tasks,
    cascade: g.cascade,
    comments: g.comments,
    loadedAt: loadedAt,
  };
}

// Solicitudes de compra de Ariba (SPEC §13.2): sólo para administradores. Si el módulo falla, la app sigue
// funcionando sin el panel (aviso en config.warnings).
function bundleSolicitudes_(ss, warnings) {
  if (!isAdmin_() || typeof aprobRead_ !== 'function') return [];
  try {
    const list = aprobRead_(ss);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('bundle_: no se pudieron leer las solicitudes de compra: ' + (e && e.message));
    warnings.push('No se pudieron leer las solicitudes de compra: ' + ((e && e.message) || e));
    return [];
  }
}

// Presupuesto del bundle. Una pestaña "Cuadre AAAA" mal formada (sin los encabezados obligatorios) no debe botar
// toda la app: se omite y se avisa en config.warnings. Otros errores (p. ej. transitorios de Sheets) se propagan.
function bundleBudget_(ss, warnings) {
  let err;
  try {
    const r = presReadAll_(ss);
    (r.warnings || []).forEach(w => warnings.push(str_(w)));
    return r;
  } catch (e) {
    err = e;
  }
  if (typeof presReadTab_ !== 'function') throw err;
  const bad = {};
  presYears_(ss).forEach(t => {
    try {
      presReadTab_(t);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/faltan? las? columnas?/i.test(msg)) throw e; // sólo encabezados incompletos (presCheckRequired_)
      bad[t.sheet.getName()] = true;
      warnings.push('Se omitió la pestaña "' + t.sheet.getName() + '": ' + msg);
    }
  });
  if (!Object.keys(bad).length) throw err;
  console.error('bundle_: pestañas de presupuesto omitidas: ' + Object.keys(bad).join(', '));
  // presReadAll_ sólo recorre getSheets(): se le entrega la planilla sin las pestañas con problemas
  // (así la reparación de IDs/columnas tampoco se corta por la pestaña mala).
  return presReadAll_({ getSheets: () => ss.getSheets().filter(sh => !bad[sh.getName()]) });
}

// Ejecuta una escritura con lock y devuelve el bundle actualizado.
// Si el cambio ya quedó guardado pero el bundle no se pudo armar, NO se informa como error (el usuario
// reintentaría y duplicaría el registro): se devuelve {stale, lastId, warning} y el cliente recarga aparte.
function mutate_(fn) {
  assertMember_();
  const res = withLock_(fn);
  let b;
  try {
    b = bundle_();
  } catch (e) {
    console.error('mutate_: guardado OK, pero bundle_ falló: ' + (e && e.message));
    return {
      stale: true,
      lastId: (res && res.lastId) || '',
      warning: 'Se guardó, pero no se pudieron recargar los datos: ' + ((e && e.message) || e),
    };
  }
  if (res && res.lastId) b.lastId = res.lastId;
  return b;
}

// Igual que mutate_, para escrituras que SÓLO tocan la pestaña Gestión: devuelve el bundle parcial (bundleGestion_).
// after(res) es opcional y corre FUERA del lock y antes de leer (p. ej. crear la carpeta de Drive del proyecto, que es
// lento y toma el lock por su cuenta): nunca hace fallar el guardado. Misma salida {stale, lastId, warning} que mutate_.
function mutateG_(fn, after) {
  assertMember_();
  const res = withLock_(fn);
  if (typeof after === 'function') {
    try {
      after(res);
    } catch (e) {
      console.error('mutateG_: guardado OK, pero el paso posterior falló: ' + (e && e.message));
    }
  }
  let b;
  try {
    b = bundleGestion_();
  } catch (e) {
    console.error('mutateG_: guardado OK, pero bundleGestion_ falló: ' + (e && e.message));
    return {
      stale: true,
      lastId: (res && res.lastId) || '',
      warning: 'Se guardó, pero no se pudieron recargar los datos: ' + ((e && e.message) || e),
    };
  }
  if (res && res.lastId) b.lastId = res.lastId;
  return b;
}

// Sólo el equipo usa la app: CONFIG.USERS, CONFIG.ADMINS y la propiedad de script EXTRA_USERS (correos separados
// por comas). Si Google no entrega el correo ('desconocido') se permite: la identidad se elige en Ajustes.
// Los activadores (notifDaily) no pasan por aquí.
function assertMember_() {
  const e = me_();
  if (e === 'desconocido' || isMember_(e)) return;
  throw new Error('No tienes acceso a ' + CONFIG.APP_NAME + ' con la cuenta ' + e + '. Pide acceso a ' + CONFIG.ADMINS[0] + '.');
}

function isMember_(email) {
  const e = str_(email).toLowerCase();
  if (!e) return false;
  const same = x => str_(x).toLowerCase() === e;
  if (CONFIG.USERS.some(u => same(u.email)) || CONFIG.ADMINS.some(same)) return true;
  let extra = '';
  try { extra = PropertiesService.getScriptProperties().getProperty('EXTRA_USERS') || ''; } catch (err) { extra = ''; }
  return extra.split(/[,;\s]+/).some(same);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('La hoja está ocupada con otro cambio. Intenta de nuevo en unos segundos.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// Nunca lanza: si falla el registro de auditoría después de guardar, el cambio no debe verse como fallido.
function log_(accion, entidad, detalle) {
  try {
    const ss = ss_();
    let sh = ss.getSheetByName(CONFIG.LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.LOG_SHEET);
      sh.appendRow(['Fecha', 'Usuario', 'Acción', 'Proyecto', 'Detalle']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), me_(), logCell_(accion), logCell_(entidad), logCell_(str_(detalle).slice(0, 2000))]);
  } catch (e) {
    console.error('log_: no se pudo escribir en ' + CONFIG.LOG_SHEET + ': ' + (e && e.message));
  }
}

// Texto para Historial: appendRow interpreta lo escrito como si se tipeara, así que se antepone un apóstrofo
// (la hoja lo oculta) a lo que parezca fórmula (= + - @), número, fecha o booleano. Mismas reglas que presCell_.
function logCell_(v) {
  const s = str_(v);
  if (s && (/^[^A-Za-zÀ-ÖØ-öø-ÿ]/.test(s) || /^(true|false|verdadero|falso)$/i.test(s) ||
    /^(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?[\s\/-]+\d/i.test(s))) return "'" + s;
  return s;
}

/* ------------------------------------------------------------------ */
/* Helpers compartidos                                                 */
/* ------------------------------------------------------------------ */

// Orden: CONFIG.SHEET_ID → propiedad SHEET_ID (la guarda setup()) → hoja vinculada.
// ¿Está activa una función que requiere permisos amplios? (CONFIG.FEATURES; por defecto apagada)
function featureOn_(name) {
  return !!(CONFIG.FEATURES && CONFIG.FEATURES[name] === true);
}

function ss_() {
  const id = CONFIG.SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No encuentro la planilla. Ejecuta setup() desde el editor o completa CONFIG.SHEET_ID en Code.gs.');
  return ss;
}

// Identidad prestada (sólo uso interno): la bandeja de WhatsApp crea cada tarea a nombre de quien la envió.
const ACTOR_ = { email: '' };
function asUser_(email, fn) {
  const prev = ACTOR_.email;
  ACTOR_.email = str_(email).toLowerCase();
  try { return fn(); } finally { ACTOR_.email = prev; }
}

function me_() {
  if (ACTOR_.email) return ACTOR_.email;
  let e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (err) { e = ''; }
  return e ? e.toLowerCase() : 'desconocido';
}

function userName_(email) {
  const e = str_(email).toLowerCase();
  const u = CONFIG.USERS.find(x => x.email.toLowerCase() === e);
  return u ? u.name : (e.split('@')[0] || '—');
}

function isAdmin_() {
  const e = me_();
  return CONFIG.ADMINS.some(a => a.toLowerCase() === e);
}

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function str_(v) {
  if (v == null) return '';
  if (v instanceof Date) return iso_(v);
  return String(v).trim();
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
  const s = String(v == null ? '' : v).replace(/[^0-9-]/g, '');
  return parseInt(s, 10) || 0;
}

function uid_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function tz_() {
  return Session.getScriptTimeZone() || 'America/Santiago';
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function dateStr_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = str_(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const cl = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // 15/10/2026
  if (cl) return cl[3] + '-' + ('0' + cl[2]).slice(-2) + '-' + ('0' + cl[1]).slice(-2);
  return '';
}

function toDate_(s) {
  const d = dateStr_(s);
  if (!d) return '';
  const p = d.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function iso_(v) {
  return v instanceof Date && !isNaN(v.getTime()) ? v.toISOString() : '';
}

function daysBetween_(a, b) {
  const da = toDate_(a), db = toDate_(b);
  if (!da || !db) return 0;
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
    Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

function pillarKey_(v) {
  const n = norm_(v);
  if (!n) return '';
  const p = CONFIG.PILLARS.find(x => x.key === n || norm_(x.area) === n || norm_(x.label) === n);
  return p ? p.key : '';
}

function pillarArea_(key) {
  const p = CONFIG.PILLARS.find(x => x.key === pillarKey_(key));
  return p ? p.area : '';
}

function headerIndex_(headerRow, names) {
  const head = (headerRow || []).map(norm_);
  const out = {};
  names.forEach(n => { out[n] = head.indexOf(norm_(n)); });
  return out;
}

// URL /exec de la app: CONFIG.APP_URL → propiedad APP_URL (Ajustes) → getUrl(). getUrl() fuera de una visita a la
// app web (activador diario, editor) puede devolver /dev o un ID de implementación que no existe.
function appUrl_() {
  try {
    const u = CONFIG.APP_URL || PropertiesService.getScriptProperties().getProperty('APP_URL') || '';
    if (u) return u;
  } catch (e) { /* sin propiedades: se usa getUrl() */ }
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
