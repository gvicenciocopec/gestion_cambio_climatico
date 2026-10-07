/**
 * Notificaciones · aviso por correo cuando una tarea VENCE (SPEC §17, v3.3).
 * - Un activador diario (instalado por un administrador, ~08:00) ejecuta notifDaily(): cada responsable recibe UN correo
 *   con sus tareas pendientes cuya fecha ya pasó y que aún no se le avisaron.
 * - Cada tarea se avisa UNA sola vez por fecha: la columna "Notificado" guarda "aaaa-mm-dd:0". Si cambia la fecha o el
 *   responsable, Gestion.gs borra la marca y la fecha nueva puede avisarse una vez más. Las marcas "0" de versiones
 *   anteriores cuentan como avisadas (no se reenvían); las "3" (aviso previo, ya no existe) no cuentan.
 * - No hay avisos al guardar, ni "por vencer", ni "vence hoy". Una tarea con "Avisar" = No nunca genera correos.
 */

const NOTIF_HANDLER = 'notifDaily';
const NOTIF_PILLAR_HEX = { cc: '#0284c7', ec: '#d97706', nat: '#059669' };
const NOTIF_FONT = "font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

// Instala (idempotente) el activador diario. Sólo administradores: los activadores corren como su creador.
function installTrigger() {
  if (!isAdmin_()) throw new Error('Sólo un administrador puede activar los recordatorios por correo.');
  return notifInstall_();
}

// Activador diario: un correo por responsable con las tareas que vencieron y aún no se le avisaron (sólo las con aviso).
function notifDaily() {
  if (typeof waImport_ === 'function') waImport_(); // también importa la bandeja de WhatsApp una vez al día
  let res;
  try {
    res = withLock_(notifRun_);
  } catch (e) {
    // Si la hoja estaba ocupada, se reintenta una vez
    if (!/ocupada/i.test(String(e && e.message))) throw e;
    Utilities.sleep(20000);
    res = withLock_(notifRun_);
  }
  Logger.log('notifDaily → ' + JSON.stringify(res));
  return res;
}

// Envía al usuario actual sus tareas vencidas ahora (también las sin aviso automático), sin tocar las marcas.
function sendTestDigest() {
  assertMember_();
  const me = me_();
  if (!notifIsEmail_(me)) {
    throw new Error('No pude identificar tu correo de Google, así que no puedo enviarte el resumen.');
  }
  const items = notifPending_(ss_()).items
    .filter(it => it.people.indexOf(me) >= 0 && it.d < 0)
    .sort(notifSort_);
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('Se alcanzó el límite diario de correos de Google. Intenta de nuevo mañana.');
  }
  notifSend_(me, items, { manual: true });
  return { sent: true, to: me, count: items.length };
}

/* ------------------------------------------------------------------ */
/* Activador                                                           */
/* ------------------------------------------------------------------ */

function notifInstall_() {
  const mine = ScriptApp.getProjectTriggers().filter(tr => tr.getHandlerFunction() === NOTIF_HANDLER);
  mine.slice(1).forEach(tr => ScriptApp.deleteTrigger(tr)); // duplicados
  if (!mine.length) {
    ScriptApp.newTrigger(NOTIF_HANDLER).timeBased().everyDays(1).atHour(CONFIG.NOTIFY_HOUR).inTimezone(tz_()).create();
  }
  return { installed: true };
}

// getProjectTriggers() sólo ve los activadores del usuario efectivo (el que implementó la app).
function notifStatus_() {
  try {
    return { triggerInstalled: ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === NOTIF_HANDLER) };
  } catch (e) {
    return { triggerInstalled: false };
  }
}

/* ------------------------------------------------------------------ */
/* Proceso diario (dentro del lock)                                    */
/* ------------------------------------------------------------------ */

function notifRun_() {
  const data = notifPending_(ss_());
  if (!data.sh || !data.items.length) return { sent: 0, tasks: 0 };
  const byResp = {};
  data.items.forEach(it => {
    if (!it.avisar) return; // la persona pidió no recibir avisos de esta tarea
    const marker = notifNextMarker_(it);
    if (!marker) return;
    // v3.6 (SPEC §20): una tarea con varias personas avisa a cada una (una sola marca para todas)
    it.people.forEach(p => { (byResp[p] = byResp[p] || []).push({ item: it, marker: marker }); });
  });

  let quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 0; }
  let sent = 0;
  let tasks = 0;
  Object.keys(byResp).sort().forEach(email => {
    if (quota < 1) { Logger.log('Sin cuota de correo; queda pendiente: ' + email); return; }
    const list = byResp[email].sort((a, b) => notifSort_(a.item, b.item));
    try {
      notifSend_(email, list.map(x => x.item), { manual: false });
    } catch (e) {
      Logger.log('No se pudo enviar a ' + email + ': ' + (e && e.message));
      return; // sin marcar: se reintenta mañana
    }
    quota--;
    sent++;
    tasks += list.length;
    list.forEach(x => gUpdateFields_(data.sh, x.item.id, { Notificado: x.marker }));
  });
  if (sent) {
    log_('Notificación', sent + (sent === 1 ? ' correo' : ' correos'), tasks + (tasks === 1 ? ' tarea' : ' tareas'));
  }
  return { sent: sent, tasks: tasks };
}

// Tareas pendientes con fecha y responsable → {sh, items:[{id, nombre, detalle, pilar, pilarLabel, proyecto, fecha, d, resp,
// notificado, avisar, creadoPor}]}. El correo va sólo a su responsable, que siempre puede ver la tarea (aunque sea privada).
function notifPending_(ss) {
  const sh = ss.getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return { sh: sh, items: [] };
  const t = gTable_(sh);
  if (t.idx.ID < 0 || t.idx.Tipo < 0) return { sh: sh, items: [] };
  const raws = gAll_(t);
  const prj = {};
  raws.forEach(r => { if (r.tipo === 'Proyecto') prj[r.id] = r; });
  const today = today_();
  const items = [];
  raws.forEach(r => {
    const people = [r.resp].concat(r.asignados || []).filter((e, i, a) => notifIsEmail_(e) && a.indexOf(e) === i);
    if (r.tipo !== 'Tarea' || gTaskDone_(r.estado) || !r.fecha || !people.length) return;
    const p = prj[r.padre] || null;
    const pilar = r.pilar || (p ? p.pilar : '');
    items.push({
      id: r.id,
      nombre: r.nombre || '(sin nombre)',
      detalle: r.detalle,
      pilar: pilar,
      pilarLabel: pilar ? gPillarLabel_(pilar) : '',
      proyecto: p ? p.nombre : '',
      fecha: r.fecha,
      d: daysBetween_(today, r.fecha),
      resp: r.resp,
      people: people,
      notificado: r.notificado,
      avisar: r.avisar !== false,
      creadoPor: r.creadoPor,
    });
  });
  return { sh: sh, items: items };
}

// Marca que hay que guardar si corresponde avisar ahora que la tarea venció ("aaaa-mm-dd:0"), o '' si aún no vence o
// ya se avisó para esta fecha. Conserva las otras marcas vigentes de la misma fecha.
function notifNextMarker_(it) {
  if (!(it.d < 0)) return '';
  const marks = notifMarks_(it.notificado, it.fecha);
  if (marks.indexOf('0') >= 0) return '';
  marks.push('0');
  return it.fecha + ':' + marks.join(',');
}

// Marcas vigentes: sólo valen si el prefijo coincide con la fecha actual de la tarea
function notifMarks_(notificado, fecha) {
  const m = String(notificado || '').trim().match(/^(\d{4}-\d{2}-\d{2}):(.*)$/);
  if (!m || m[1] !== fecha) return [];
  return m[2].split(',').map(s => s.trim()).filter(s => s === '0' || s === '3');
}

function notifSort_(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return String(a.nombre).localeCompare(String(b.nombre), 'es');
}

function notifIsEmail_(s) {
  return /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i.test(String(s || ''));
}

/* ------------------------------------------------------------------ */
/* Correo                                                              */
/* ------------------------------------------------------------------ */

function notifSend_(to, items, opts) {
  const name = userName_(to);
  MailApp.sendEmail({
    to: to,
    subject: notifSubject_(items),
    htmlBody: notifEmailHtml_(name, items, opts),
    body: notifEmailText_(name, items, opts),
    name: CONFIG.APP_NAME,
  });
}

// "[Cuadre AACC] Venció: Pagar cuota" · varias: "[Cuadre AACC] 3 tareas vencidas" · ninguna (prueba): "Sin tareas vencidas"
function notifSubject_(items) {
  const app = '[' + CONFIG.APP_NAME + '] ';
  if (!items.length) return app + 'Sin tareas vencidas';
  if (items.length === 1) return app + 'Venció: ' + gExcerpt_(items[0].nombre, 70);
  return app + items.length + ' tareas vencidas';
}

// d = días hasta la fecha (negativo: ya pasó) → "venció ayer" / "venció hace 3 días"
function notifWhen_(d) {
  if (d === -1) return 'venció ayer';
  if (d < -1) return 'venció hace ' + (-d) + ' días';
  if (d === 0) return 'vence hoy';
  return d === 1 ? 'vence mañana' : 'vence en ' + d + ' días';
}

// Una: "Esta tarea venció ayer. Ina te la asignó." · varias: "Tienes 3 tareas vencidas."
function notifIntro_(items) {
  if (items.length === 1) {
    const it = items[0];
    const by = it.creadoPor && it.creadoPor !== it.resp && it.creadoPor !== 'desconocido' ? ' ' + userName_(it.creadoPor) + ' te la asignó.' : '';
    return 'Esta tarea ' + notifWhen_(it.d) + '.' + by;
  }
  return 'Tienes ' + items.length + ' tareas vencidas.';
}

// Etiqueta de estado: sólo hay tareas vencidas (rojo)
function notifChip_(d) {
  const w = notifWhen_(d);
  return { label: w.charAt(0).toUpperCase() + w.slice(1), bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca', bar: '#ef4444' };
}

function notifEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function notifFooterText_(opts) {
  if (opts && opts.manual) {
    return 'Pediste este resumen desde ' + CONFIG.APP_NAME + '. Incluye tus tareas pendientes que ya vencieron.';
  }
  return 'Te escribimos una sola vez cuando vence una tarea de la que eres responsable. ' +
    'Si prefieres no recibir este aviso, apágalo en la tarea.';
}

// HTML compatible con clientes de correo: tablas + estilos en línea, ancho máx. 560px.
function notifEmailHtml_(name, items, opts) {
  items = items || [];
  const E = notifEsc_;
  const F = NOTIF_FONT;
  const url = appUrl_();
  const link = url ? url + '#/tareas' : '';
  const preheader = items.length ? notifSubject_(items).replace(/^\[[^\]]*\]\s*/, '') : 'No tienes tareas vencidas.';

  const cards = items.map(it => {
    const chip = notifChip_(it.d);
    const hex = NOTIF_PILLAR_HEX[it.pilar] || '#71717a';
    const meta = [];
    if (it.pilarLabel) meta.push('<span style="color:' + hex + ';">&#9679;</span>&nbsp;' + E(it.pilarLabel));
    meta.push(it.proyecto ? 'Proyecto: ' + E(it.proyecto) : (it.pilarLabel ? 'Sin proyecto' : 'Tarea personal'));
    const note = it.detalle ? gExcerpt_(it.detalle, 160) : '';
    return '<tr><td style="padding:0 0 12px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid #e4e4e7;border-left:4px solid ' + chip.bar + ';border-radius:10px;background-color:#ffffff;">' +
      '<tr><td style="padding:14px 16px;">' +
      '<span style="display:inline-block;padding:2px 9px;border-radius:999px;background-color:' + chip.bg + ';border:1px solid ' + chip.bd + ';color:' + chip.fg + ';' + F + 'font-size:12px;font-weight:600;line-height:18px;">' + E(chip.label) + '</span>' +
      '<div style="margin-top:8px;' + F + 'font-size:15px;font-weight:600;line-height:21px;color:#18181b;">' + E(it.nombre) + '</div>' +
      '<div style="margin-top:4px;' + F + 'font-size:13px;line-height:19px;color:#52525b;">' + meta.join(' &nbsp;·&nbsp; ') + '</div>' +
      '<div style="margin-top:2px;' + F + 'font-size:13px;line-height:19px;color:#71717a;">' + (it.d < 0 ? 'Era para el ' : 'Vence el ') + E(gFmtDate_(it.fecha)) +
      ' &nbsp;·&nbsp; ' + ((it.people || []).length > 1 ? 'Personas: ' + E(it.people.map(userName_).join(', ')) : 'Responsable: ' + E(userName_(it.resp))) + '</div>' +
      (note ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #f4f4f5;' + F + 'font-size:13px;line-height:19px;color:#71717a;">' + E(note) + '</div>' : '') +
      '</td></tr></table></td></tr>';
  }).join('');

  const single = items.length === 1;
  const intro = items.length
    ? E(notifIntro_(items)) + (single ? ' Cuando esté lista, márcala en la app o cámbiale la fecha.' : ' Cuando estén listas, márcalas en la app o cámbiales la fecha.')
    : 'No tienes tareas vencidas. Buen trabajo.';

  const cta = link
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>' +
      '<td bgcolor="#4f46e5" style="border-radius:8px;background-color:#4f46e5;">' +
      '<a href="' + E(link) + '" target="_blank" style="display:inline-block;padding:11px 20px;' + F + 'font-size:14px;font-weight:600;line-height:18px;color:#ffffff;text-decoration:none;border-radius:8px;">' + (single ? 'Ver la tarea' : 'Abrir mis tareas') + '</a>' +
      '</td></tr></table>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + E(CONFIG.APP_NAME) + '</title></head>' +
    '<body style="margin:0;padding:0;background-color:#f4f4f5;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">' + E(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f5" style="background-color:#f4f4f5;">' +
    '<tr><td align="center" style="padding:32px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">' +
    // Encabezado
    '<tr><td style="padding:0 4px 16px 4px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="32" height="32" align="center" valign="middle" bgcolor="#10b981" style="width:32px;height:32px;border-radius:8px;background-color:#10b981;background-image:linear-gradient(135deg,#10b981,#14b8a6,#0ea5e9);color:#ffffff;' + F + 'font-size:15px;font-weight:700;line-height:32px;text-align:center;">C</td>' +
    '<td style="padding-left:10px;' + F + 'font-size:15px;font-weight:600;line-height:18px;color:#18181b;">' + E(CONFIG.APP_NAME) +
    '<br><span style="font-size:12px;font-weight:400;color:#71717a;">Sostenibilidad · Asuntos Corporativos</span></td>' +
    '</tr></table></td></tr>' +
    // Tarjeta principal
    '<tr><td style="background-color:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px 24px;">' +
    '<div style="' + F + 'font-size:20px;font-weight:700;line-height:28px;color:#18181b;">Hola ' + E(name || '') + ',</div>' +
    '<div style="margin-top:8px;margin-bottom:20px;' + F + 'font-size:14px;line-height:22px;color:#3f3f46;">' + intro + '</div>' +
    (cards ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + cards + '</table>' : '') +
    cta +
    '</td></tr>' +
    // Pie
    '<tr><td style="padding:18px 12px 0 12px;' + F + 'font-size:12px;line-height:18px;color:#a1a1aa;text-align:center;">' +
    E(notifFooterText_(opts)) + '<br>' + E(CONFIG.APP_NAME) + ' · Equipo de Sostenibilidad Copec' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// Versión en texto plano del mismo resumen
function notifEmailText_(name, items, opts) {
  items = items || [];
  const url = appUrl_();
  const lines = ['Hola ' + (name || '') + ',', ''];
  if (!items.length) {
    lines.push('No tienes tareas vencidas. Buen trabajo.');
  } else {
    lines.push(notifIntro_(items), '');
    items.forEach(it => {
      lines.push('- [' + notifChip_(it.d).label + '] ' + it.nombre);
      lines.push('  ' + [it.pilarLabel, it.proyecto ? 'Proyecto: ' + it.proyecto : (it.pilarLabel ? 'Sin proyecto' : 'Tarea personal'),
        (it.d < 0 ? 'era para el ' : 'vence el ') + gFmtDate_(it.fecha)].filter(Boolean).join(' · '));
      if (it.detalle) lines.push('  ' + gExcerpt_(it.detalle, 160));
      lines.push('');
    });
  }
  if (lines[lines.length - 1] !== '') lines.push('');
  if (url) lines.push('Abrir mis tareas: ' + url + '#/tareas', '');
  lines.push('--', notifFooterText_(opts));
  return lines.join('\n');
}
