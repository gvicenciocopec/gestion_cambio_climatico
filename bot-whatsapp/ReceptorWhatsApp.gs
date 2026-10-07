/**
 * Receptor de WhatsApp para Cuadre AACC · proyecto de Apps Script APARTE de la app: créalo en script.google.com →
 * Nuevo proyecto (nunca con Extensiones → Apps Script desde la planilla, que abre el proyecto de la app).
 * Guía paso a paso: docs/GUIA_WHATSAPP.md
 *
 * Meta (WhatsApp Cloud API) le envía a este script cada mensaje que llega al número del bot. El script:
 *   1. Exige la clave secreta de la URL (?k=…). Apps Script no puede leer la firma de Meta, así que esa clave
 *      (más la lista de números del equipo) es lo que impide que otros escriban en la planilla.
 *   2. Toma sólo los mensajes del número del bot (PHONE_NUMBER_ID) que vienen de números de "WhatsApp contactos".
 *   3. Los agrega como filas a la pestaña oculta "WhatsApp" de la planilla, sin repetir (por Mensaje ID).
 *   4. Opcional: los marca como leídos (✓✓ azul). Nunca responde mensajes: así el costo es 0.
 * La app Cuadre AACC convierte esas filas en tareas la próxima vez que alguien la abre.
 *
 * Propiedades del script (⚙ Configuración del proyecto → Propiedades del script):
 *   SHEET_ID         ID de la planilla (entre /d/ y /edit en su URL)
 *   PHONE_NUMBER_ID  Meta → identificador del número de teléfono del bot
 *   VERIFY_TOKEN     se crea solo al ejecutar probarReceptor()
 *   URL_KEY          se crea solo al ejecutar probarReceptor()
 *   WA_TOKEN         (opcional) token permanente de Meta, sólo para el ✓✓ azul
 *   GRAPH_VERSION    (opcional) versión de la API de Meta; por defecto v25.0
 */

const RX_INBOX = 'WhatsApp';
const RX_CONTACTS = 'WhatsApp contactos';
const RX_RECENT = 1000; // filas recientes que se revisan para no repetir un mensaje

/* ------------------------------------------------------------------ */
/* Web app (lo que llama Meta)                                         */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.pagina === 'privacidad') return rxPrivacy_(); // URL pública que Meta pide para publicar la app
  const cfg = rxConfig_();
  if (p['hub.mode'] === 'subscribe') {
    // Prueba de conexión de Meta: devolver hub.challenge tal cual
    const ok = !!cfg.URL_KEY && p.k === cfg.URL_KEY && !!cfg.VERIFY_TOKEN && p['hub.verify_token'] === cfg.VERIFY_TOKEN;
    return rxText_(ok ? String(p['hub.challenge'] || '') : 'Token incorrecto');
  }
  return rxText_('Receptor de tareas: funcionando.');
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const cfg = rxConfig_();
  if (!cfg.URL_KEY || p.k !== cfg.URL_KEY) return rxText_('ok'); // sin la clave: se ignora en silencio
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return rxText_('ok'); }
  const msgs = rxExtract_(body, cfg.PHONE_NUMBER_ID);
  if (!msgs.length) return rxText_('ok'); // avisos de "entregado"/"leído": nada que guardar
  // Si la planilla falla, el error se propaga: Meta no recibe "ok" y reintenta más tarde (no se pierde el mensaje)
  const saved = rxStore_(cfg, msgs);
  if (cfg.WA_TOKEN) saved.forEach(m => rxMarkRead_(cfg, m.id));
  return rxText_('ok');
}

/* ------------------------------------------------------------------ */
/* Ejecutar desde el editor                                            */
/* ------------------------------------------------------------------ */

// Revisa la configuración, crea VERIFY_TOKEN y URL_KEY si faltan, y muestra lo que hay que pegar en Meta.
function probarReceptor() {
  const props = PropertiesService.getScriptProperties();
  const lines = [];
  const add = s => { lines.push(s); Logger.log(s); };
  if (!props.getProperty('VERIFY_TOKEN')) props.setProperty('VERIFY_TOKEN', 'tareas-' + rxRandom_(16));
  if (!props.getProperty('URL_KEY')) props.setProperty('URL_KEY', rxRandom_(40));
  const cfg = rxConfig_();
  let ok = true;
  if (!cfg.SHEET_ID) { ok = false; add('✗ Falta la propiedad SHEET_ID (el ID de la planilla).'); }
  if (!cfg.PHONE_NUMBER_ID) { ok = false; add('✗ Falta la propiedad PHONE_NUMBER_ID (el identificador del número en Meta).'); }
  if (cfg.SHEET_ID) {
    try {
      const ss = SpreadsheetApp.openById(cfg.SHEET_ID);
      add('✓ Planilla abierta: ' + ss.getName());
      if (!ss.getSheetByName(RX_INBOX) || !ss.getSheetByName(RX_CONTACTS)) {
        ok = false;
        add('✗ Faltan las pestañas "' + RX_INBOX + '" y "' + RX_CONTACTS + '". Ejecuta setup() en la app Cuadre AACC.');
      } else {
        const n = Object.keys(rxAllow_(ss)).length;
        add(n ? '✓ ' + n + (n === 1 ? ' número del equipo registrado.' : ' números del equipo registrados.')
          : '✗ "' + RX_CONTACTS + '" no tiene números todavía: escribe el WhatsApp de cada persona en la columna Número.');
        if (!n) ok = false;
      }
    } catch (err) {
      ok = false;
      add('✗ No pude abrir la planilla: ' + ((err && err.message) || err) + '. Revisa que SHEET_ID esté bien copiado y que esta cuenta pueda editar la planilla.');
    }
  }
  add(cfg.WA_TOKEN ? '✓ WA_TOKEN configurado: los mensajes quedarán con ✓✓ azul.' : '· Sin WA_TOKEN (opcional): funciona igual, sin ✓✓ azul.');
  add('');
  add('Para Meta (Configurar webhooks):');
  add('  URL de devolución de llamada: <la URL /exec de tu implementación>?k=' + cfg.URL_KEY);
  add('  Token de verificación: ' + cfg.VERIFY_TOKEN);
  add('Sólo si Meta pide publicar la app:');
  add('  Política de privacidad y eliminación de datos: <la URL /exec>?pagina=privacidad');
  add(ok ? '✓ Todo listo.' : '→ Corrige lo marcado con ✗ y vuelve a ejecutar probarReceptor.');
  return { ok: ok, lines: lines, urlKey: cfg.URL_KEY, verifyToken: cfg.VERIFY_TOKEN };
}

/* ------------------------------------------------------------------ */
/* Internos                                                            */
/* ------------------------------------------------------------------ */

function rxConfig_() {
  const p = PropertiesService.getScriptProperties().getProperties() || {};
  return {
    SHEET_ID: String(p.SHEET_ID || '').trim(),
    PHONE_NUMBER_ID: String(p.PHONE_NUMBER_ID || '').trim(),
    VERIFY_TOKEN: String(p.VERIFY_TOKEN || '').trim(),
    URL_KEY: String(p.URL_KEY || '').trim(),
    WA_TOKEN: String(p.WA_TOKEN || '').trim(),
    GRAPH_VERSION: String(p.GRAPH_VERSION || 'v25.0').trim(),
  };
}

// Todos los mensajes del aviso (Meta puede agrupar varios). Ignora los de otro número del bot.
function rxExtract_(body, phoneNumberId) {
  const out = [];
  ((body && body.entry) || []).forEach(entry => {
    (entry.changes || []).forEach(ch => {
      if (ch.field && ch.field !== 'messages') return;
      const v = ch.value || {};
      if (phoneNumberId && v.metadata && String(v.metadata.phone_number_id) !== String(phoneNumberId)) return;
      const names = {};
      (v.contacts || []).forEach(c => { if (c && c.wa_id) names[c.wa_id] = (c.profile && c.profile.name) || ''; });
      (v.messages || []).forEach(m => {
        const from = m.from || (v.contacts && v.contacts[0] && v.contacts[0].wa_id) || '';
        let msg = '', note = '';
        if (m.type === 'text') msg = (m.text && m.text.body) || '';
        else if (m.type === 'interactive') {
          const it = m.interactive || {};
          msg = (it.button_reply && it.button_reply.title) || (it.list_reply && it.list_reply.title) || '';
        } else if (m.type === 'button') msg = (m.button && m.button.text) || '';
        else note = 'Tipo no soportado: ' + (m.type || 'desconocido');
        out.push({ id: String(m.id || ''), from: from, name: names[from] || '', text: msg, note: note, ts: m.timestamp });
      });
    });
  });
  return out;
}

// Agrega las filas nuevas (del equipo y no repetidas) bajo un lock. → mensajes guardados
function rxStore_(cfg, msgs) {
  if (!cfg.SHEET_ID) throw new Error('Falta la propiedad SHEET_ID');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Receptor ocupado; Meta reintentará.');
  try {
    const ss = SpreadsheetApp.openById(cfg.SHEET_ID);
    const sh = ss.getSheetByName(RX_INBOX);
    if (!sh) throw new Error('Falta la pestaña "' + RX_INBOX + '" (ejecuta setup() en la app).');
    const allow = rxAllow_(ss);
    const known = rxKnown_(sh);
    const rows = [], saved = [];
    msgs.forEach(m => {
      if (!m.id || known[m.id] || !allow[rxDigits_(m.from)]) return;
      known[m.id] = true;
      rows.push(rxRow_(m));
      saved.push(m);
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
    return saved;
  } finally {
    lock.releaseLock();
  }
}

// Fila en el formato que espera la app: Recibido | Mensaje ID | Número | Nombre | Texto | Estado | Tarea | Nota
function rxRow_(m) {
  const at = m.ts ? new Date(Number(m.ts) * 1000) : new Date();
  return [at, m.id, rxDigits_(m.from), rxLiteral_(m.name), rxLiteral_(m.text), 'Nueva', '', m.note];
}

// Lo que escribe la gente se guarda como texto, nunca como fórmula
function rxLiteral_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Números del equipo (sólo dígitos) desde la columna A de "WhatsApp contactos"
function rxAllow_(ss) {
  const sh = ss.getSheetByName(RX_CONTACTS);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => {
    const d = rxDigits_(r[0]);
    if (d) map[d] = true;
  });
  return map;
}

// Mensaje ID de las últimas filas de la bandeja (Meta puede reenviar el mismo aviso)
function rxKnown_(sh) {
  const out = {};
  const last = sh.getLastRow();
  if (last < 2) return out;
  const from = Math.max(2, last - RX_RECENT + 1);
  sh.getRange(from, 2, last - from + 1, 1).getValues().forEach(r => { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function rxMarkRead_(cfg, messageId) {
  try {
    const res = UrlFetchApp.fetch('https://graph.facebook.com/' + cfg.GRAPH_VERSION + '/' + encodeURIComponent(cfg.PHONE_NUMBER_ID) + '/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.WA_TOKEN },
      payload: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) console.error('No se pudo marcar como leído: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  } catch (err) {
    console.error('No se pudo marcar como leído: ' + ((err && err.message) || err));
  }
}

// Sólo dígitos; un celular chileno de 9 dígitos sin el 56 se completa (igual que la app)
function rxDigits_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) d = '56' + d;
  return d;
}

function rxRandom_(n) {
  let s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}

function rxPrivacy_() {
  const html = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Política de privacidad · Bot de tareas</title>' +
    '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;line-height:1.6">' +
    '<h1>Política de privacidad · Bot de tareas</h1>' +
    '<p>Este bot es una herramienta interna de un equipo de trabajo. Sólo procesa mensajes enviados por los miembros registrados del equipo.</p>' +
    '<p>El texto de cada mensaje se guarda como una tarea en la planilla privada del equipo. No se usa para publicidad, no se vende y no se comparte con terceros.</p>' +
    '<p>Los mensajes de números que no pertenecen al equipo se descartan sin guardarse.</p>' +
    '<p><b>Eliminación de datos:</b> para eliminar tus datos, pide al administrador del equipo que borre tus tareas y tus mensajes de la planilla.</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Política de privacidad · Bot de tareas');
}

function rxText_(t) {
  return ContentService.createTextOutput(String(t));
}
