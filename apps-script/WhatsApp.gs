/**
 * WhatsApp · bandeja de tareas que llegan desde el bot de WhatsApp (guía: docs/GUIA_WHATSAPP.md).
 *
 * Costo 0: el receptor gratuito (un Apps Script aparte, bot-whatsapp/ReceptorWhatsApp.gs) sólo AGREGA filas a la
 * pestaña "WhatsApp" y nunca responde mensajes (a lo más confirma con el ✓✓ azul de "leído").
 * La app convierte esas filas en tareas, bajo su lock y una sola vez por mensaje:
 *   - a nombre de quien escribió (pestaña "WhatsApp contactos": Número → Correo del equipo);
 *   - privadas, como una tarea rápida (SPEC §15), con fecha si el texto termina en hoy / mañana / viernes / 15/10.
 * Se importa al abrir la app (bootstrap) y en el aviso diario (notifDaily).
 */

const WA_INBOX = 'WhatsApp';
const WA_CONTACTS = 'WhatsApp contactos';
const WA_INBOX_HEADERS = ['Recibido', 'Mensaje ID', 'Número', 'Nombre', 'Texto', 'Estado', 'Tarea', 'Nota'];
const WA_CONTACT_HEADERS = ['Número', 'Correo', 'Nombre'];
const WA_DONE = ['Importada', 'Ignorada', 'Duplicada', 'Error'];
const WA_WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WA_CONN = ['para', 'el', 'este', 'esta', 'hasta', 'antes', 'del', 'de', 'al', 'a', 'la', 'proximo', 'proxima'];
const WA_MAX_PER_RUN = 50;

/* ------------------------------------------------------------------ */
/* Estructura (setup)                                                  */
/* ------------------------------------------------------------------ */

// Crea las pestañas si faltan (llamar con el lock tomado). Devuelve {inbox, contacts, created:[nombres]}.
function waEnsureSheets_(ss) {
  const created = [];
  let inbox = ss.getSheetByName(WA_INBOX);
  if (!inbox) {
    inbox = ss.insertSheet(WA_INBOX);
    inbox.getRange(1, 1, 1, WA_INBOX_HEADERS.length).setValues([WA_INBOX_HEADERS]).setFontWeight('bold');
    inbox.setFrozenRows(1);
    try { inbox.getRange('B:C').setNumberFormat('@'); } catch (e) { /* formato opcional */ }
    try { inbox.hideSheet(); } catch (e) { /* no se puede ocultar la última hoja visible */ }
    created.push(WA_INBOX);
  }
  let contacts = ss.getSheetByName(WA_CONTACTS);
  if (!contacts) {
    contacts = ss.insertSheet(WA_CONTACTS);
    const rows = [WA_CONTACT_HEADERS].concat(CONFIG.USERS.map(u => ['', u.email.toLowerCase(), u.name]));
    try { contacts.getRange('A:A').setNumberFormat('@'); } catch (e) { /* formato opcional */ }
    contacts.getRange(1, 1, rows.length, WA_CONTACT_HEADERS.length).setValues(rows);
    contacts.getRange(1, 1, 1, WA_CONTACT_HEADERS.length).setFontWeight('bold');
    contacts.setFrozenRows(1);
    created.push(WA_CONTACTS);
  }
  return { inbox: inbox, contacts: contacts, created: created };
}

/* ------------------------------------------------------------------ */
/* Importación                                                         */
/* ------------------------------------------------------------------ */

// Importa los mensajes nuevos de la bandeja. Rápido si no hay nada (una lectura). Nunca lanza.
// → {imported, ignored, duplicated, errors}
function waImport_() {
  const res = { imported: 0, ignored: 0, duplicated: 0, errors: 0 };
  try {
    const ss = ss_();
    const sh = ss.getSheetByName(WA_INBOX);
    if (!sh || sh.getLastRow() < 2) return res;
    if (!waPendingRows_(sh.getDataRange().getValues()).length) return res;
    withLock_(() => waImportLocked_(ss, res));
    if (res.imported || res.ignored || res.duplicated || res.errors) {
      log_('WhatsApp', 'Bandeja de WhatsApp', waSummary_(res));
    }
  } catch (e) {
    console.error('waImport_: ' + ((e && e.message) || e));
  }
  return res;
}

function waImportLocked_(ss, res) {
  const sh = ss.getSheetByName(WA_INBOX);
  const values = sh.getDataRange().getValues(); // se relee dentro del lock: otra ejecución pudo importar ya
  const head = headerIndex_(values[0], WA_INBOX_HEADERS);
  if (head['Mensaje ID'] < 0 || head['Texto'] < 0 || head['Estado'] < 0) {
    throw new Error('La pestaña "' + WA_INBOX + '" no tiene los encabezados esperados.');
  }
  const pending = waPendingRows_(values).slice(0, WA_MAX_PER_RUN);
  if (!pending.length) return;
  const contacts = waContacts_(ss);
  // Mensajes ya procesados (los reintentos de Meta pueden repetir un Mensaje ID)
  const seen = {};
  for (let i = 1; i < values.length; i++) {
    const st = str_(values[i][head['Estado']]);
    const mid = str_(values[i][head['Mensaje ID']]);
    if (mid && st === 'Importada') seen[mid] = str_(values[i][head['Tarea']]);
  }
  const today = today_();
  pending.forEach(i => {
    const row = values[i];
    const mid = str_(row[head['Mensaje ID']]);
    const out = { estado: '', tarea: '', nota: '' };
    if (mid && seen[mid] !== undefined) {
      out.estado = 'Duplicada'; out.tarea = seen[mid]; out.nota = 'Mismo mensaje que una fila anterior';
      res.duplicated++;
    } else {
      const email = contacts[waDigits_(row[head['Número']])] || '';
      const text = waCleanText_(row[head['Texto']]);
      if (!email) {
        out.estado = 'Ignorada'; out.nota = 'Número no registrado en "' + WA_CONTACTS + '"';
        res.ignored++;
      } else if (!text) {
        out.estado = 'Ignorada'; out.nota = 'Mensaje vacío o que no es texto';
        res.ignored++;
      } else {
        try {
          const p = waParse_(text, today);
          const nombre = p.nombre.length > 300 ? p.nombre.slice(0, 297) + '…' : p.nombre;
          const detalle = p.nombre.length > 300 ? p.nombre : '';
          const entity = { tipo: 'Tarea', nombre: nombre, detalle: detalle, resp: email, fecha: p.fecha, pilar: '', privada: true, avisar: true };
          const r = asUser_(email, () => gSaveCore_(entity, 'Tarea', { drive: null }));
          out.estado = 'Importada'; out.tarea = (r && r.lastId) || '';
          if (p.fecha) out.nota = 'Fecha: ' + p.fecha;
          if (mid) seen[mid] = out.tarea;
          res.imported++;
        } catch (e) {
          out.estado = 'Error'; out.nota = str_((e && e.message) || e).slice(0, 300);
          res.errors++;
        }
      }
    }
    row[head['Estado']] = out.estado;
    if (head['Tarea'] >= 0) row[head['Tarea']] = out.tarea;
    if (head['Nota'] >= 0) row[head['Nota']] = out.nota;
  });
  // Una sola escritura de las columnas Estado/Tarea/Nota (son contiguas en el formato de la bandeja)
  const c0 = head['Estado'], c1 = Math.max(c0, head['Tarea'], head['Nota']);
  const block = values.slice(1).map(r => r.slice(c0, c1 + 1));
  sh.getRange(2, c0 + 1, block.length, c1 - c0 + 1).setValues(block);
}

// Índices (en values) de las filas por procesar: con texto o ID y sin Estado final
function waPendingRows_(values) {
  if (!values || values.length < 2) return [];
  const head = headerIndex_(values[0], WA_INBOX_HEADERS);
  const ie = head['Estado'], im = head['Mensaje ID'], it = head['Texto'];
  if (ie < 0) return [];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const st = str_(values[i][ie]);
    if (st && st !== 'Nueva') continue;
    if (!str_(values[i][im]) && !str_(values[i][it])) continue;
    out.push(i);
  }
  return out;
}

// Número (sólo dígitos) → correo del equipo, desde "WhatsApp contactos"
function waContacts_(ss) {
  const sh = ss.getSheetByName(WA_CONTACTS);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  const values = sh.getDataRange().getValues();
  const head = headerIndex_(values[0], WA_CONTACT_HEADERS);
  for (let i = 1; i < values.length; i++) {
    const num = waDigits_(values[i][head['Número']]);
    const email = str_(values[i][head['Correo']]).toLowerCase();
    if (num && email && isMember_(email)) map[num] = email;
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Texto y fechas                                                      */
/* ------------------------------------------------------------------ */

function waDigits_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) d = '56' + d; // celular chileno escrito sin el 56
  return d;
}

// Quita el prefijo opcional "Tarea:" y espacios de más
function waCleanText_(v) {
  return str_(v).replace(/\s+/g, ' ').replace(/^(nueva\s+)?tarea\s*[:\-–—]\s*/i, '').trim();
}

function waNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    .replace(/^[¿¡("'«]+|[.,;:!?)"'»]+$/g, '');
}

// Igual que la tarea rápida de la app (TodoPanel.todoParse): fecha al final del texto.
// "hoy", "mañana", "pasado mañana", "viernes", "próxima semana", "en 3 días", "15/10", "15/10/2026"
function waParse_(text, today) {
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const out = { nombre: clean, fecha: '' };
  const words = clean ? clean.split(' ') : [];
  if (words.length < 2) return out;
  const n = words.map(waNorm_);
  const base = toDate_(today) || new Date();
  const plus = k => dateStr_(new Date(base.getFullYear(), base.getMonth(), base.getDate() + k));
  const L = n.length, last = n[L - 1], prev = n[L - 2];
  let take = 0, fecha = '', m = null;
  if (last === 'manana' && prev === 'pasado') { take = 2; fecha = plus(2); }
  else if (last === 'hoy') { take = 1; fecha = plus(0); }
  else if (last === 'manana') { take = 1; fecha = plus(1); }
  else if (WA_WEEKDAYS.indexOf(last) >= 0) {
    take = 1; fecha = plus((WA_WEEKDAYS.indexOf(last) - base.getDay() + 7) % 7 || 7);
  } else if (last === 'semana' && (prev === 'proxima' || prev === 'siguiente')) {
    take = 2; fecha = plus((8 - base.getDay()) % 7 || 7);
  } else if ((last === 'dias' || last === 'dia') && /^\d{1,3}$/.test(prev) && n[L - 3] === 'en') {
    const k = Number(prev);
    if (k >= 1 && k <= 365) { take = 3; fecha = plus(k); }
  } else if ((m = last.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2}|\d{4}))?$/))) {
    fecha = waDateFrom_(Number(m[1]), Number(m[2]), m[3], base);
    if (fecha) take = 1;
  }
  if (!take) return out;
  let end = L - take;
  while (end > 0 && WA_CONN.indexOf(n[end - 1]) >= 0) end--;
  if (end < 1) return out; // nunca deja el nombre vacío
  return { nombre: words.slice(0, end).join(' '), fecha: fecha };
}

function waDateFrom_(d, mo, y, base) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  const year = y ? (String(y).length === 2 ? 2000 + Number(y) : Number(y)) : base.getFullYear();
  if (year < 2000 || year > 2100) return '';
  const mk = yy => { const x = new Date(yy, mo - 1, d); return x.getMonth() === mo - 1 ? x : null; };
  let x = mk(year);
  if (!x) return '';
  if (!y && x < new Date(base.getFullYear(), base.getMonth(), base.getDate())) x = mk(year + 1);
  return x ? dateStr_(x) : '';
}

function waSummary_(r) {
  const bits = [];
  if (r.imported) bits.push(r.imported + (r.imported === 1 ? ' tarea creada' : ' tareas creadas'));
  if (r.ignored) bits.push(r.ignored + (r.ignored === 1 ? ' ignorada' : ' ignoradas'));
  if (r.duplicated) bits.push(r.duplicated + (r.duplicated === 1 ? ' duplicada' : ' duplicadas'));
  if (r.errors) bits.push(r.errors + (r.errors === 1 ? ' con error' : ' con error'));
  return bits.join(' · ');
}
