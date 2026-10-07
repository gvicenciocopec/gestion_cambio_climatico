/**
 * Aprobaciones.gs · Solicitudes de compra de Ariba (SPEC §13.2) — panel sólo para administradores.
 *
 * Cada correo de CONFIG.ARIBA_SENDER con "Solicitud de compra" en el asunto queda registrado en la pestaña oculta
 * CONFIG.APROB_SHEET ('Solicitudes'): quién la pidió, PR, nombre, monto, fecha y costo por CeCo. La aprobación real se
 * hace en el mismo correo; aquí sólo se decide qué hacer con el gasto: vincularlo a una línea del presupuesto, crear
 * una línea nueva "Fuera de POA" o descartarlo, para que ningún gasto se pierda.
 *
 * - Lectura de Gmail del dueño del script (GmailApp: permiso nuevo de lectura de correo), fuera del lock; la escritura
 *   en la hoja va en un solo lock. Idempotente: cada mensaje se registra una vez (columna "Gmail ID").
 * - Un mismo PR aún 'Pendiente' se actualiza con el correo más nuevo; un PR ya procesado ignora recordatorios.
 * - Un correo que no se puede leer bien queda igual registrado (lectura 'parcial', con su asunto).
 * API pública (todas sólo admin): aprobScan, aprobLink, aprobNewLine, aprobDiscard, aprobReset, aprobInstall,
 * aprobScanTrigger (activador). Internas: aprobRead_ (bundle), aprobStatus_ (Ajustes, exacto), aprobStatusFast_ (bundle,
 * sin activadores), aprobParse_ (pura, probada).
 */

const APROB_HEADERS = [
  'ID', 'Gmail ID', 'Hilo', 'Recibido', 'Solicitante', 'PR', 'Nombre', 'Monto CLP', 'Monto texto', 'Fecha solicitud',
  'Proveedor', 'Descripción', 'Comentario', 'CeCos', 'Total UF', 'Estado', 'Año', 'Línea', 'Monto imputado', 'Nota',
  'Procesado por', 'Procesado', 'Asunto', 'Lectura',
];
const APROB_ESTADOS = ['Pendiente', 'Vinculada', 'Nueva línea', 'Descartada'];
const APROB_HANDLER = 'aprobScanTrigger';
const APROB_PROP_SCAN = 'APROB_LAST_SCAN';
const APROB_PROP_RESULT = 'APROB_LAST_RESULT';
const APROB_PROP_SCHEDULE = 'APROB_SCHEDULE'; // horario con que se instaló el activador (para reinstalar si cambia)
const APROB_QUERY_DAYS = 120;
const APROB_MAX_THREADS = 50;
const APROB_MESES = {
  enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4, mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9, september: 9,
  octubre: 10, oct: 10, october: 10, noviembre: 11, nov: 11, november: 11, diciembre: 12, dic: 12, december: 12, dec: 12,
};
const APROB_TZ_OFF = { clst: -180, clt: -240, utc: 0, gmt: 0 }; // minutos respecto de UTC
const APROB_ENT = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  Uuml: 'Ü', copy: '©', ordm: 'º', ordf: 'ª', middot: '·', ndash: '–', mdash: '—', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
};
// Fin de cada campo del cuerpo: la siguiente etiqueta conocida (con mayúscula, como en el correo)
const APROB_STOP_HEAD = [/\bSolicitud de compra\b/, /\bCreado\b/, /\bImporte [Tt]otal\b/, /\bEste documento\b/,
  /\bAprobar\b/, /\bDetalles de cabecera\b/, /\bEn representaci[oó]n de\b/, /\bArt[ií]culos en l[ií]nea\b/];
const APROB_STOP_ITEM = [/\bAsignaci[oó]n de cuentas\b/, /\bProveedor\b/, /\bEntregar a\b/, /\bCtd\.?(?=\s|$)/, /\bCantidad\b/,
  /\bUnidad\b/, /\bPrecio\b/, /\bImporte\b/, /\bCuenta contable\b/, /\bComentarios recientes\b/, /\bFlujo de aprobaci[oó]n\b/,
  /\bDescripci[oó]n\b/, /\bAprobar\b/];
const APROB_STOP_COMMENT = [/\bFlujo de aprobaci[oó]n\b/, /\bAprobar Denegar\b/, /\bAhora puede aprobar\b/,
  /\bDerechos de autor\b/, /\bEstado Necesario\b/];

/* ------------------------------------------------------------------ */
/* API pública (sólo administradores)                                  */
/* ------------------------------------------------------------------ */

// Revisa Gmail ahora. → bundle + lastScan {found, added, updated, ignored, skipped, errors, at} + aprob (estado)
function aprobScan() {
  aprobAssertAdmin_();
  aprobAssertGmail_();
  const known = aprobKnown_(ss_());
  let f;
  try {
    f = aprobFetch_(known);
  } catch (e) {
    const msg = aprobErr_(e);
    aprobSaveResult_({ error: msg, at: new Date().toISOString() });
    throw new Error('No pude leer Gmail: ' + msg + '. Si es la primera vez, autoriza el permiso de Gmail ejecutando aprobInstall desde el editor.');
  }
  let res = null;
  const b = mutate_(() => {
    res = aprobStore_(f.items, f.errors);
    return {};
  });
  if (b && typeof b === 'object') {
    b.lastScan = aprobPublicResult_(res);
    b.aprob = aprobStatus_();
  }
  return b;
}

// Vincula la solicitud a una línea existente. data = {year, lineId, monto (int ≥ 0; por defecto el sugerido),
// marcarOc: bool (OC emitida = 'Si'), nota}. Anota el PR en la Nota de la línea si no está. → bundle (lastId = SOL-…)
function aprobLink(id, data) {
  aprobAssertAdmin_();
  const d = aprobObj_(data);
  const y = presYearNum_(d.year);
  const lineId = str_(d.lineId);
  if (!lineId) throw new Error('Elige la línea del presupuesto a la que corresponde este gasto.');
  aprobMonto_(d.monto, 0); // formato antes del lock
  const nota = aprobNota_(d.nota);
  const marcar = aprobBool_(d.marcarOc);
  return mutate_(() => {
    const ss = ss_();
    const sol = aprobEdit_(ss, id, rec => {
      aprobAssertPending_(rec);
      const monto = aprobMonto_(d.monto, aprobSol_(rec).sugerido);
      const line = aprobLineNow_(ss, y, lineId);
      const patch = {};
      if (marcar && line.oc !== 'Si') patch.oc = 'Si';
      if (rec.pr && !aprobHasPr_(line.nota, rec.pr)) patch.nota = line.nota ? line.nota + ' · ' + rec.pr : rec.pr;
      if (Object.keys(patch).length) presSaveInLock_(y, lineId, patch);
      Object.assign(rec, { estado: 'Vinculada', anio: String(y), lineId: lineId, montoImputado: monto, nota: nota });
      aprobStamp_(rec);
      log_('Vincular solicitud', aprobLabel_(rec), [presTabName_(y), line.proj, 'imputado ' + presMoney_(monto),
        marcar ? 'OC emitida' : ''].filter(Boolean).join(' · '));
    });
    return { lastId: sol.id };
  });
}

// Crea una línea "Fuera de POA" con el gasto y la vincula. data = {year, area (pilar o área), proj (por defecto el
// nombre de la solicitud), monto (por defecto el sugerido), nota}. → bundle (lastId = SOL-…; la línea queda en sol.lineId)
function aprobNewLine(id, data) {
  aprobAssertAdmin_();
  const d = aprobObj_(data);
  const y = presYearNum_(d.year);
  const area = pillarArea_(str_(d.area));
  if (!area) throw new Error('Elige el pilar de la línea nueva: Cambio Climático, Economía Circular o Naturaleza.');
  aprobMonto_(d.monto, 0);
  const nota = aprobNota_(d.nota);
  const proj = str_(d.proj).replace(/\s+/g, ' ');
  return mutate_(() => {
    const ss = ss_();
    const sol = aprobEdit_(ss, id, rec => {
      aprobAssertPending_(rec);
      const monto = aprobMonto_(d.monto, aprobSol_(rec).sugerido);
      const lineNota = [rec.pr, rec.solicitante].filter(Boolean).join(' · ');
      const r = presSaveInLock_(y, '', {
        area: area, proj: proj || rec.nombre || rec.pr || 'Solicitud de compra', clas: 'Fuera de POA',
        pf: monto, pg: 0, oc: 'Si', nota: lineNota,
      });
      Object.assign(rec, { estado: 'Nueva línea', anio: String(y), lineId: r.id, montoImputado: monto, nota: nota });
      aprobStamp_(rec);
      log_('Solicitud a línea nueva', aprobLabel_(rec), [presTabName_(y), 'línea ' + r.id, presMoney_(monto)].join(' · '));
    });
    return { lastId: sol.id };
  });
}

// La solicitud no es un gasto del presupuesto (motivo opcional). → bundle
function aprobDiscard(id, motivo) {
  aprobAssertAdmin_();
  const nota = aprobNota_(motivo);
  return mutate_(() => {
    const sol = aprobEdit_(ss_(), id, rec => {
      aprobAssertPending_(rec);
      Object.assign(rec, { estado: 'Descartada', anio: '', lineId: '', montoImputado: 0, nota: nota });
      aprobStamp_(rec);
      log_('Descartar solicitud', aprobLabel_(rec), nota || 'Sin motivo');
    });
    return { lastId: sol.id };
  });
}

// Vuelve a 'Pendiente' (no deshace lo que se cambió en el presupuesto). → bundle
function aprobReset(id) {
  aprobAssertAdmin_();
  return mutate_(() => {
    const sol = aprobEdit_(ss_(), id, rec => {
      if (rec.estado === 'Pendiente') throw new Error('Esta solicitud ya está pendiente.');
      const antes = rec.estado + (rec.lineId ? ' (' + rec.lineId + ')' : '');
      Object.assign(rec, { estado: 'Pendiente', anio: '', lineId: '', montoImputado: 0, procesadoPor: '', procesado: '' });
      log_('Reabrir solicitud', aprobLabel_(rec), 'Estaba ' + antes + '. El presupuesto no se modifica.');
    });
    return { lastId: sol.id };
  });
}

// Activa (idempotente) la lectura automática una vez al día (CONFIG.APROB_SCAN_HOUR). → bundle + aprob (estado)
function aprobInstall() {
  aprobAssertAdmin_();
  aprobAssertGmail_();
  let r = null;
  const b = mutate_(() => {
    r = aprobInstall_();
    if (r.created) log_('Activar lectura Ariba', 'Solicitudes de compra', 'Revisa Gmail una vez al día (~' + r.hour + ':00)');
    return {};
  });
  if (b && typeof b === 'object') {
    b.aprobInstall = r;
    b.aprob = aprobStatus_();
  }
  return b;
}

// Activador (diario, corre como el administrador que lo instaló). Nunca lanza por un error de lectura:
// lo deja en el estado (Ajustes) y reintenta en la próxima vuelta.
function aprobScanTrigger(e) {
  if (!featureOn_('GMAIL')) return { disabled: true }; // modo seguro: no se lee Gmail
  if (!isAdmin_() && !aprobTriggerEvent_(e)) aprobAssertAdmin_();
  try {
    const f = aprobFetch_(aprobKnown_(ss_()));
    const res = withLock_(() => aprobStore_(f.items, f.errors));
    return aprobPublicResult_(res);
  } catch (err) {
    const msg = aprobErr_(err);
    aprobSaveResult_({ error: msg, at: new Date().toISOString() });
    console.error('aprobScanTrigger: ' + msg);
    return { error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* Lectura para el bundle y Ajustes                                    */
/* ------------------------------------------------------------------ */

// [Sol] más recientes primero. Sólo administradores ([] para el resto). Nunca crea la hoja.
function aprobRead_(ss) {
  if (!isAdmin_()) return [];
  const sh = (ss || ss_()).getSheetByName(aprobSheetName_());
  if (!sh || sh.getLastRow() < 2) return [];
  const t = aprobTable_(sh);
  if (t.idx.ID < 0) return [];
  return aprobRecs_(t).map(x => aprobSol_(x.rec))
    .sort((a, b) => (a.recibido < b.recibido ? 1 : a.recibido > b.recibido ? -1 : 0));
}

// {triggerInstalled, lastScan ISO, lastResult, sender, hour, schedule:'diaria', sheet}
function aprobStatus_() {
  let installed = false;
  try {
    installed = ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === APROB_HANDLER);
  } catch (e) { installed = false; }
  let lastScan = '';
  let last = null;
  try {
    const props = PropertiesService.getScriptProperties();
    lastScan = props.getProperty(APROB_PROP_SCAN) || '';
    last = JSON.parse(props.getProperty(APROB_PROP_RESULT) || 'null');
  } catch (e) { last = null; }
  return Object.assign({ disabled: !featureOn_('GMAIL') }, {
    triggerInstalled: installed, lastScan: lastScan, lastResult: last && typeof last === 'object' ? last : null,
    sender: aprobSender_(), hour: aprobHour_(), schedule: 'diaria', sheet: aprobSheetName_(),
  });
}

// Versión RÁPIDA para el bundle (SPEC §14.1): misma forma que aprobStatus_ + fast:true, sólo con propiedades de script
// (una lectura) y SIN ScriptApp.getProjectTriggers(), que tarda segundos. "Activado" se deduce de APROB_SCHEDULE, que
// guarda aprobInstall_ al crear el activador; si alguien lo borra a mano en el editor, sólo aprobStatus_ (Ajustes) lo nota.
// Modo seguro: la lectura de Gmail está apagada en CONFIG.FEATURES.GMAIL
function aprobAssertGmail_() {
  if (!featureOn_('GMAIL')) throw new Error('La lectura de Gmail está desactivada (modo seguro). Se activa en Code.gs (CONFIG.FEATURES.GMAIL) cuando TI lo apruebe.');
}

function aprobStatusFast_() {
  let p = {};
  try { p = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { p = {}; }
  let last = null;
  try { last = JSON.parse(p[APROB_PROP_RESULT] || 'null'); } catch (e) { last = null; }
  const sched = str_(p[APROB_PROP_SCHEDULE]);
  const m = /^daily@(\d{1,2})$/.exec(sched);
  return Object.assign({ disabled: !featureOn_('GMAIL') }, {
    triggerInstalled: !!sched, lastScan: str_(p[APROB_PROP_SCAN]), lastResult: last && typeof last === 'object' ? last : null,
    sender: aprobSender_(), hour: m ? Number(m[1]) : aprobHour_(), schedule: 'diaria', sheet: aprobSheetName_(), fast: true,
  });
}

/* ------------------------------------------------------------------ */
/* Parser (puro): asunto + cuerpo de texto del correo de Ariba          */
/* ------------------------------------------------------------------ */

// → {asunto, recibido, solicitante, pr, nombre, montoClp, montoTexto, fechaTexto, fecha, proveedor, descripcion,
//    comentario, cecos:[{cuenta, cuentaNombre, codigo, nombre, uf, clp, propio}], totalUf, sugerido, lectura}
// Nunca lanza: lo que no se encuentre queda vacío y lectura = 'parcial'.
function aprobParse_(subject, plainBody, receivedDate) {
  const out = {
    asunto: aprobOneLine_(subject).slice(0, 500), recibido: aprobIso_(receivedDate),
    solicitante: '', pr: '', nombre: '', montoClp: 0, montoTexto: '', fechaTexto: '', fecha: '', proveedor: '',
    descripcion: '', comentario: '', cecos: [], totalUf: 0, sugerido: 0, lectura: 'parcial',
  };
  try {
    aprobParseInto_(out, plainBody);
  } catch (e) {
    console.warn('aprobParse_: ' + aprobErr_(e));
  }
  try {
    out.fecha = aprobParseFecha_(out.fechaTexto);
    aprobDerive_(out);
  } catch (e) {
    console.warn('aprobParse_ (cálculos): ' + aprobErr_(e));
  }
  out.lectura = aprobLectura_(out);
  return out;
}

function aprobParseInto_(out, plainBody) {
  const s = out.asunto;
  const flat = aprobLines_(plainBody).join(' ');

  // Asunto: "…Solicitud de compra que <NOMBRE> ha enviado - <PR> - <NOMBRE PR> ($<monto> CLP)"
  const sm = s.match(/solicitud de compra que\s+(.+?)\s+ha enviado\s*[-–—]\s*(PR\s?\d+)\s*[-–—]\s*(.*)$/i);
  let subjMonto = '';
  if (sm) {
    out.solicitante = sm[1];
    out.pr = sm[2];
    const mm = sm[3].match(/^(.*?)\s*\(\s*(\$?\s*\d[\d.,]*\s*CLP)\s*\)\s*$/i);
    out.nombre = mm ? mm[1] : sm[3];
    subjMonto = mm ? mm[2] : '';
  } else {
    out.pr = (s.match(/\bPR\s?\d{3,}\b/i) || [''])[0];
    subjMonto = (s.match(/\(\s*(\$\s*\d[\d.,]*\s*CLP)\s*\)/i) || ['', ''])[1];
  }

  // Cuerpo
  if (!out.solicitante) {
    const que = flat.match(/solicitud de compra que\s+(.+?)\s+ha enviado/i);
    out.solicitante = (que && que[1]) || aprobAfter_(flat, /\bEn representaci[oó]n de:?\s+/, APROB_STOP_HEAD, 200);
  }
  const prm = flat.match(/\bSolicitud de compra:?\s+(PR\s?\d+)\s*[-–—]\s*/);
  if (prm) {
    if (!out.pr) out.pr = prm[1];
    if (!out.nombre) out.nombre = aprobUntil_(flat.slice(prm.index + prm[0].length), APROB_STOP_HEAD, 300);
  }
  if (!out.pr) out.pr = (flat.match(/\bPR\s?\d{4,}\b/) || [''])[0];

  const creado = aprobAfter_(flat, /\bCreado:?\s+/, APROB_STOP_HEAD, 200);
  const dt = aprobFindDate_(creado) || aprobFindDate_(flat);
  out.fechaTexto = dt ? dt.text : '';

  const mt = flat.match(/\bImporte [Tt]otal:?\s*(\$\s*\d[\d.]*(?:,\d+)?\s*CLP)\b/) ||
    (subjMonto ? [0, subjMonto] : null) || flat.match(/(\$\s*\d[\d.]*(?:,\d+)?\s*CLP)\b/);
  if (mt) {
    const n = aprobNum_(mt[1]);
    if (isFinite(n) && n >= 0) {
      out.montoClp = Math.round(n);
      out.montoTexto = '$' + mt[1].replace(/[$\s]|CLP/gi, '') + ' CLP';
    }
  }

  out.proveedor = aprobAfter_(flat, /\bProveedor:?\s+/, APROB_STOP_ITEM, 200);
  out.descripcion = aprobAfter_(flat, /\bDescripci[oó]n:?\s+/, APROB_STOP_ITEM, 1000);
  let com = aprobAfter_(flat, /\bComentarios recientes:?\s+/, APROB_STOP_COMMENT, 2000);
  const cdt = aprobFindDate_(com);
  if (cdt && cdt.index === 0) com = com.slice(cdt.text.length).replace(/^\s*[:\-–—]\s*/, '');
  out.comentario = com;

  // Costos por CeCo: "<cuenta>(<nombre>) <CODIGO>(<NOMBRE>) Importe <n,nn> CLF" (o Porcentaje <n> %)
  const k = flat.search(/\bCuenta contable\b/);
  const zone = k >= 0 ? flat.slice(k) : flat;
  const re = /(?:(\d{5,12})\s*\(([^()]{0,160})\)\s*)?\b([A-Z]{2,5}\d{3,10})\s*\(([^()]{0,160})\)\s*(?:(?:Importe|Porcentaje|Monto|Proporci[oó]n):?\s*)?(\d[\d.]*(?:,\d+)?)\s*(CLF|UF|%)/g;
  const byKey = {};
  const list = [];
  let m;
  while ((m = re.exec(zone))) {
    const val = aprobNum_(m[5]);
    if (!isFinite(val)) continue;
    const key = (m[1] || '') + '|' + m[3];
    let c = byKey[key];
    if (!c) {
      c = byKey[key] = { cuenta: m[1] || '', cuentaNombre: aprobOneLine_(m[2]), codigo: m[3].toUpperCase(), nombre: aprobOneLine_(m[4]), uf: 0, pct: 0 };
      list.push(c);
    }
    if (m[6] === '%') c.pct += val; else c.uf += val;
  }
  const head = flat.match(/\bMax Approval Amount:?\s*(\d[\d.]*(?:,\d+)?)\s*(?:CLF|UF)\b/i);
  const headUf = head ? aprobNum_(head[1]) : NaN;
  list.forEach(c => {
    if (c.pct && !c.uf && isFinite(headUf)) c.uf = headUf * c.pct / 100;
    c.uf = aprobRound2_(c.uf);
    delete c.pct;
  });
  out.cecos = list;
  const sum = aprobRound2_(list.reduce((a, c) => a + c.uf, 0));
  out.totalUf = sum > 0 ? sum : (isFinite(headUf) ? aprobRound2_(headUf) : 0);

  // Limpieza final
  out.solicitante = aprobOneLine_(out.solicitante).replace(/[,.;:\s]+$/, '').slice(0, 200);
  out.pr = str_(out.pr).replace(/\s+/g, '').toUpperCase();
  out.nombre = aprobOneLine_(out.nombre).replace(/[\s,;:-]+$/, '').slice(0, 300);
  out.proveedor = aprobOneLine_(out.proveedor).slice(0, 200);
  out.descripcion = aprobOneLine_(out.descripcion).slice(0, 1000);
  out.comentario = aprobOneLine_(out.comentario).slice(0, 2000);
}

// CLP por CeCo = round(monto × uf / totalUf); propio = código en CONFIG.MY_CECOS; sugerido = suma de los propios
// (si no hay propios, el monto total). Usa los decimales de "Monto texto" cuando calzan con montoClp.
function aprobDerive_(s) {
  const exactTxt = aprobNum_(String(s.montoTexto || '').replace(/[$\s]|CLP/gi, ''));
  const exact = isFinite(exactTxt) && Math.round(exactTxt) === s.montoClp ? exactTxt : s.montoClp;
  const total = s.totalUf > 0 ? s.totalUf : aprobRound2_((s.cecos || []).reduce((a, c) => a + (Number(c.uf) || 0), 0));
  const mine = aprobMyCecos_();
  s.cecos = (s.cecos || []).map(c => {
    const uf = aprobRound2_(Number(c.uf) || 0);
    const codigo = str_(c.codigo).toUpperCase();
    return {
      cuenta: str_(c.cuenta), cuentaNombre: str_(c.cuentaNombre), codigo: codigo, nombre: str_(c.nombre), uf: uf,
      clp: total > 0 ? Math.round(exact * uf / total) : 0, propio: mine.indexOf(codigo) >= 0,
    };
  });
  const own = s.cecos.filter(c => c.propio);
  s.sugerido = own.length ? own.reduce((a, c) => a + c.clp, 0) : (s.montoClp || 0);
  return s;
}

function aprobLectura_(s) {
  return s.solicitante && s.pr && s.nombre && s.montoClp > 0 && s.fechaTexto && (s.cecos || []).length ? 'ok' : 'parcial';
}

// Texto → líneas limpias (NBSP, tabuladores, enlaces <mailto:…> y restos de impresión fuera)
function aprobLines_(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/[  -   　]/g, ' ')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/<(?:https?|mailto):[^>]*>/gi, ' ')
    .split('\n')
    .map(l => l.replace(/[ \t\f\v]+/g, ' ').replace(/^(?:>\s?)+/, '').trim())
    .filter(l => l &&
      !/^=== PAGE \d+/.test(l) &&
      !/^P[aá]gina \d+ de \d+$/i.test(l) &&
      !/^https?:\/\/mail\.google\.com\//i.test(l) &&
      !/^Correo de \S+ - /.test(l) &&
      !/^\d{2}-\d{2}-\d{2},? \d{1,2}:\d{2}/.test(l));
}

// Valor tras la etiqueta, hasta la próxima etiqueta conocida
function aprobAfter_(flat, labelRe, stops, max) {
  const m = labelRe.exec(flat);
  if (!m) return '';
  return aprobUntil_(flat.slice(m.index + m[0].length), stops, max);
}

function aprobUntil_(rest, stops, max) {
  let end = rest.length;
  stops.forEach(re => {
    const k = rest.search(re);
    if (k >= 0 && k < end) end = k;
  });
  return rest.slice(0, Math.min(end, max || 300)).trim();
}

// Primera fecha en español: "viernes, 2 octubre, 2026 a las 11:17, CLST" · "2 de octubre de 2026 a las 16:05"
// → {text, index, y, mo, d, H, M, tz} | null
function aprobFindDate_(s) {
  const txt = String(s || '');
  const re = /(?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s+)?(\d{1,2})(?:\s+de)?\s+([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?,?(?:\s+del?)?\s+(\d{4})(?:,?\s*(?:a\s+las?|at|-)?\s*(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?)?(?:,?\s*\(?(CLST|CLT|UTC|GMT)\b\)?)?/gi;
  let m;
  while ((m = re.exec(txt))) {
    const mo = APROB_MESES[norm_(m[2])];
    if (!mo) continue;
    return {
      text: m[0].trim(), index: m.index, y: Number(m[3]), mo: mo, d: Number(m[1]),
      H: m[4] != null ? Number(m[4]) : null, M: m[5] != null ? Number(m[5]) : 0,
      ampm: (m[6] || '').toLowerCase(), tz: (m[7] || '').toLowerCase(),
    };
  }
  return null;
}

// Texto de fecha → ISO (instante). CLST/CLT fijan el desfase; sin sufijo se usa la zona del script.
function aprobParseFecha_(text) {
  const dt = aprobFindDate_(text);
  if (!dt) return '';
  const y = dt.y;
  let H = dt.H == null ? 0 : dt.H;
  if (dt.ampm === 'p' && H < 12) H += 12;
  if (dt.ampm === 'a' && H === 12) H = 0;
  if (!(y >= 2000 && y <= 2100 && dt.mo >= 1 && dt.mo <= 12 && dt.d >= 1 && H <= 23 && dt.M <= 59)) return '';
  if (new Date(Date.UTC(y, dt.mo - 1, dt.d)).getUTCDate() !== dt.d) return '';
  const off = APROB_TZ_OFF[dt.tz];
  if (off != null) return new Date(Date.UTC(y, dt.mo - 1, dt.d, H, dt.M) - off * 60000).toISOString();
  const p2 = n => ('0' + n).slice(-2);
  try {
    return Utilities.parseDate(y + '-' + p2(dt.mo) + '-' + p2(dt.d) + ' ' + p2(H) + ':' + p2(dt.M), tz_(), 'yyyy-MM-dd HH:mm').toISOString();
  } catch (e) {
    return '';
  }
}

// "13.473.363,17" → 13473363.17 · "1.234,50" → 1234.5 · "4.512.880" → 4512880 · inválido → NaN
function aprobNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let s = String(v == null ? '' : v).replace(/[\s $]|CLP|CLF|UF/gi, '');
  if (!/^-?\d[\d.,]*$/.test(s)) return NaN;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

function aprobRound2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function aprobOneLine_(s) {
  return String(s == null ? '' : s).replace(/[\s  ]+/g, ' ').trim();
}

// HTML del correo → texto con un salto por bloque/celda (sólo si getPlainBody() viene vacío)
function aprobHtmlText_(html) {
  return String(html || '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([A-Za-z]+);/g, (m, n) => (Object.prototype.hasOwnProperty.call(APROB_ENT, n) ? APROB_ENT[n] : m));
}

/* ------------------------------------------------------------------ */
/* Gmail (fuera del lock)                                              */
/* ------------------------------------------------------------------ */

// Lo ya registrado (lectura sin lock) para no volver a pedir el cuerpo de mensajes conocidos
function aprobKnown_(ss) {
  const out = { ids: {}, prEstado: {} };
  try {
    const sh = ss.getSheetByName(aprobSheetName_());
    if (!sh || sh.getLastRow() < 2) return out;
    aprobRecs_(aprobTable_(sh)).forEach(x => {
      x.rec.gmailIds.forEach(g => { out.ids[g] = true; });
      if (x.rec.pr) out.prEstado[x.rec.pr] = x.rec.estado;
    });
  } catch (e) {
    console.warn('aprobKnown_: ' + aprobErr_(e));
  }
  return out;
}

// → {items: [{gmailId, hiloUrl, date ISO, subject, parsed|null}], errors}. Un mensaje dañado no detiene al resto.
function aprobFetch_(known) {
  const sender = aprobSender_();
  const kn = known || { ids: {}, prEstado: {} };
  const threads = GmailApp.search('from:(' + sender + ') newer_than:' + APROB_QUERY_DAYS + 'd', 0, APROB_MAX_THREADS) || [];
  const items = [];
  let errors = 0;
  threads.forEach(th => {
    let msgs = [];
    let link = '';
    try {
      msgs = th.getMessages() || [];
    } catch (e) {
      errors++;
      console.error('aprobFetch_: hilo ilegible: ' + aprobErr_(e));
      return;
    }
    try { link = str_(th.getPermalink()); } catch (e) { link = ''; }
    msgs.forEach(msg => {
      try {
        const it = aprobItem_(msg, sender, link, kn);
        if (it) items.push(it);
      } catch (e) {
        errors++;
        console.error('aprobFetch_: mensaje ilegible: ' + aprobErr_(e));
      }
    });
  });
  return { items: items, errors: errors };
}

function aprobItem_(msg, sender, link, known) {
  if (str_(msg.getFrom()).toLowerCase().indexOf(sender) < 0) return null;
  const subject = aprobOneLine_(msg.getSubject());
  if (norm_(subject).indexOf('solicitud de compra') < 0) return null;
  const id = str_(msg.getId());
  if (!id) return null;
  let date = '';
  try { date = aprobIso_(msg.getDate()); } catch (e) { date = ''; }
  const it = { gmailId: id, hiloUrl: /^https:\/\//i.test(link) ? link : '', date: date, subject: subject, parsed: null };
  const pr = (subject.match(/\bPR\s?\d{3,}\b/i) || [''])[0].replace(/\s+/g, '').toUpperCase();
  if (known.ids[id] || (pr && known.prEstado[pr] && known.prEstado[pr] !== 'Pendiente')) return it; // sin leer el cuerpo
  let body = '';
  try { body = String(msg.getPlainBody() || ''); } catch (e) { body = ''; }
  if (!body.trim()) {
    try { body = aprobHtmlText_(msg.getBody()); } catch (e) { body = ''; }
  }
  it.parsed = aprobParse_(subject, body, date);
  return it;
}

/* ------------------------------------------------------------------ */
/* Registro en la hoja (dentro del lock)                               */
/* ------------------------------------------------------------------ */

function aprobStore_(items, fetchErrors) {
  const res = { found: (items || []).length, added: 0, updated: 0, ignored: 0, skipped: 0, errors: Number(fetchErrors) || 0, at: '' };
  const list = (items || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (list.length) {
    const ss = ss_();
    const sh = aprobSheet_(ss);
    const t = aprobTable_(sh);
    const recs = aprobRecs_(t);
    const byMsg = {};
    const byPr = {};
    const used = {};
    recs.forEach((x, k) => {
      used[x.rec.id] = true;
      x.rec.gmailIds.forEach(g => { byMsg[g] = k; });
      if (x.rec.pr) byPr[x.rec.pr] = k;
    });
    let nextRow = Math.max(sh.getLastRow(), 1) + 1;
    list.forEach(it => {
      try {
        if (!it || !it.gmailId || byMsg[it.gmailId] != null) { res.skipped++; return; }
        const p = it.parsed;
        const k = p && p.pr ? byPr[p.pr] : (it.parsed ? undefined : byPr[aprobSubjectPr_(it.subject)]);
        if (k != null && recs[k].rec.estado !== 'Pendiente') { res.ignored++; return; } // PR ya procesado: se ignora
        if (!p) { res.skipped++; return; } // conocido al leer Gmail pero cambió en la hoja: próxima vuelta
        if (k != null) {
          const x = recs[k];
          aprobMerge_(x.rec, p, it);
          x.raw = aprobWrite_(sh, t, x.row, x.rec, x.raw);
          byMsg[it.gmailId] = k;
          res.updated++;
          return;
        }
        const rec = aprobNewRec_(p, it, used);
        if (nextRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(nextRow - sh.getMaxRows(), 20));
        const raw = aprobWrite_(sh, t, nextRow, rec, null);
        recs.push({ rec: rec, row: nextRow, raw: raw });
        byMsg[it.gmailId] = recs.length - 1;
        if (rec.pr) byPr[rec.pr] = recs.length - 1;
        nextRow++;
        res.added++;
      } catch (e) {
        res.errors++;
        console.error('aprobStore_: ' + aprobErr_(e));
      }
    });
  }
  res.at = new Date().toISOString();
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(APROB_PROP_SCAN, res.at);
    props.setProperty(APROB_PROP_RESULT, JSON.stringify(res));
  } catch (e) {
    console.warn('aprobStore_: no se pudo guardar el estado: ' + aprobErr_(e));
  }
  if (res.added || res.updated) {
    log_('Leer solicitudes Ariba', 'Solicitudes de compra', [res.added ? res.added + (res.added === 1 ? ' nueva' : ' nuevas') : '',
      res.updated ? res.updated + (res.updated === 1 ? ' actualizada' : ' actualizadas') : ''].filter(Boolean).join(' · '));
  }
  return res;
}

function aprobNewRec_(p, it, used) {
  let id = uid_('SOL');
  while (used[id]) id = uid_('SOL');
  used[id] = true;
  const rec = {
    id: id, gmailIds: [it.gmailId], hiloUrl: it.hiloUrl || '', recibido: it.date || p.recibido || '',
    estado: 'Pendiente', anio: '', lineId: '', montoImputado: 0, nota: '', procesadoPor: '', procesado: '',
  };
  aprobFields_().forEach(f => { rec[f] = p[f]; });
  rec.cecos = (p.cecos || []).map(aprobCecoStored_);
  rec.totalUf = Number(p.totalUf) || 0;
  rec.lectura = aprobLectura_(rec);
  return rec;
}

// Un correo más nuevo del mismo PR pendiente: sus datos reemplazan a los anteriores (los vacíos no borran nada);
// uno más antiguo sólo completa lo que falte.
function aprobMerge_(rec, p, it) {
  const newer = !rec.recibido || !it.date || it.date >= rec.recibido;
  aprobFields_().forEach(f => {
    const v = p[f];
    const has = f === 'montoClp' ? Number(v) > 0 : !!v;
    const empty = f === 'montoClp' ? !(Number(rec[f]) > 0) : !rec[f];
    if (has && (newer || empty)) rec[f] = v;
  });
  // El total UF viaja con su lista de CeCos (el CLP por CeCo se calcula con ambos)
  if ((p.cecos || []).length && (newer || !rec.cecos.length)) {
    rec.cecos = p.cecos.map(aprobCecoStored_);
    rec.totalUf = p.totalUf;
  } else if (!rec.cecos.length && p.totalUf > 0 && (newer || !(rec.totalUf > 0))) {
    rec.totalUf = p.totalUf;
  }
  if (it.hiloUrl && (newer || !rec.hiloUrl)) rec.hiloUrl = it.hiloUrl;
  if (newer && it.date) rec.recibido = it.date;
  rec.gmailIds = newer ? [it.gmailId].concat(rec.gmailIds) : rec.gmailIds.concat([it.gmailId]);
  rec.lectura = aprobLectura_(rec);
}

function aprobFields_() {
  return ['solicitante', 'pr', 'nombre', 'montoClp', 'montoTexto', 'fechaTexto', 'proveedor', 'descripcion', 'comentario', 'asunto'];
}

function aprobCecoStored_(c) {
  return { cuenta: str_(c.cuenta), cuentaNombre: str_(c.cuentaNombre), codigo: str_(c.codigo), nombre: str_(c.nombre), uf: aprobRound2_(c.uf) };
}

function aprobSubjectPr_(subject) {
  return (String(subject || '').match(/\bPR\s?\d{3,}\b/i) || [''])[0].replace(/\s+/g, '').toUpperCase();
}

// Busca la solicitud, aplica fn(rec) y escribe su fila (dentro del lock). → rec
function aprobEdit_(ss, id, fn) {
  const sid = str_(id);
  const sh = ss.getSheetByName(aprobSheetName_());
  const notFound = 'No encontré la solicitud de compra (¿se borró de la hoja?). Recarga e intenta de nuevo.';
  if (!sid || !sh || sh.getLastRow() < 2) throw new Error(notFound);
  const t = aprobTable_(sh);
  const x = aprobRecs_(t).find(r => r.rec.id === sid);
  if (!x) throw new Error(notFound);
  fn(x.rec);
  aprobWrite_(sh, t, x.row, x.rec, x.raw);
  return x.rec;
}

function aprobAssertPending_(rec) {
  if (rec.estado !== 'Pendiente') {
    throw new Error('Esta solicitud ya está ' + (rec.estado === 'Nueva línea' ? 'con línea nueva' : rec.estado.toLowerCase()) +
      '. Déjala pendiente otra vez para cambiarla.');
  }
}

function aprobStamp_(rec) {
  rec.procesadoPor = me_();
  rec.procesado = new Date().toISOString();
}

function aprobLabel_(rec) {
  return [rec.pr, rec.nombre].filter(Boolean).join(' · ') || rec.asunto || rec.id;
}

// Línea actual de "Cuadre {year}" (dentro del lock, sin repararla). Lanza si no existe la pestaña o la línea.
function aprobLineNow_(ss, y, lineId) {
  const sh = presSheet_(ss, y);
  const tab = presReadTab_({ year: y, sheet: sh });
  const i = presFindIndex_(tab.values, tab.m, lineId);
  if (i < 1) throw new Error('No encontré esa línea en la pestaña "' + sh.getName() + '" (¿se borró?). Recarga e intenta de nuevo.');
  return presRowObj_(tab.values[i], tab.m);
}

function aprobHasPr_(nota, pr) {
  const p = String(pr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^A-Za-z0-9])' + p + '(?![0-9])', 'i').test(String(nota || ''));
}

/* ------------------------------------------------------------------ */
/* Hoja "Solicitudes"                                                  */
/* ------------------------------------------------------------------ */

// Obtiene (o crea y oculta) la pestaña y completa encabezados faltantes. Sólo dentro del lock.
function aprobSheet_(ss) {
  const name = aprobSheetName_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, ss.getNumSheets());
    sh.getRange(1, 1, 1, APROB_HEADERS.length).setValues([APROB_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    aprobFormat_(sh);
    try { sh.hideSheet(); } catch (e) { /* es la única pestaña visible */ }
    return sh;
  }
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const have = head.map(norm_);
  const missing = APROB_HEADERS.filter(h => have.indexOf(norm_(h)) < 0);
  if (missing.length) {
    const col = head.some(h => str_(h) !== '') ? lastCol + 1 : 1;
    const list = col === 1 ? APROB_HEADERS : missing;
    const need = col + list.length - 1;
    if (need > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, col, 1, list.length).setValues([list]).setFontWeight('bold');
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
    aprobFormat_(sh);
  }
  return sh;
}

function aprobFmt_(h) {
  if (h === 'Recibido' || h === 'Procesado') return 'yyyy-mm-dd hh:mm';
  if (h === 'Monto CLP' || h === 'Monto imputado') return '#,##0';
  if (h === 'Total UF') return '0.00';
  if (h === 'Año') return '0';
  return '@'; // texto plano: Sheets no convierte IDs de Gmail, "2026" ni "$13.473.363,17 CLP"
}

function aprobFormat_(sh) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return;
  const idx = headerIndex_(sh.getRange(1, 1, 1, lastCol).getValues()[0], APROB_HEADERS);
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  APROB_HEADERS.forEach(h => {
    if (idx[h] >= 0) sh.getRange(2, idx[h] + 1, rows, 1).setNumberFormat(aprobFmt_(h));
  });
}

function aprobTable_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const values = lastRow && lastCol ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const head = values[0] || [];
  return { values: values, idx: headerIndex_(head, APROB_HEADERS), width: Math.max(head.length, 1) };
}

// Filas con ID → [{rec, row (número de fila), raw (valores)}]
function aprobRecs_(t) {
  const out = [];
  for (let i = 1; i < t.values.length; i++) {
    const row = t.values[i];
    const g = h => (t.idx[h] >= 0 && t.idx[h] < row.length ? row[t.idx[h]] : '');
    const id = aprobTxt_(g('ID'));
    if (!id) continue;
    out.push({
      row: i + 1,
      raw: row,
      rec: {
        id: id,
        gmailIds: aprobTxt_(g('Gmail ID')).split(/[,;\s]+/).filter(Boolean),
        hiloUrl: aprobTxt_(g('Hilo')),
        recibido: aprobIso_(g('Recibido')),
        solicitante: aprobTxt_(g('Solicitante')),
        pr: aprobTxt_(g('PR')).replace(/\s+/g, '').toUpperCase(),
        nombre: aprobTxt_(g('Nombre')),
        montoClp: Math.max(num_(g('Monto CLP')), 0),
        montoTexto: aprobTxt_(g('Monto texto')),
        fechaTexto: aprobTxt_(g('Fecha solicitud')),
        proveedor: aprobTxt_(g('Proveedor')),
        descripcion: aprobTxt_(g('Descripción')),
        comentario: aprobTxt_(g('Comentario')),
        cecos: aprobCecosRead_(aprobTxt_(g('CeCos'))),
        totalUf: aprobRound2_(typeof g('Total UF') === 'number' ? g('Total UF') : aprobNum_(g('Total UF')) || 0),
        estado: aprobEstado_(g('Estado')),
        anio: aprobAnio_(g('Año')),
        lineId: aprobTxt_(g('Línea')),
        montoImputado: Math.max(num_(g('Monto imputado')), 0),
        nota: aprobTxt_(g('Nota')),
        procesadoPor: aprobTxt_(g('Procesado por')).toLowerCase(),
        procesado: aprobIso_(g('Procesado')),
        asunto: aprobTxt_(g('Asunto')),
        lectura: norm_(g('Lectura')) === 'ok' ? 'ok' : 'parcial',
      },
    });
  }
  return out;
}

// Registro → Sol del bundle (sin Date; montos enteros)
function aprobSol_(rec) {
  const s = {
    id: rec.id, gmailId: rec.gmailIds[0] || '', hiloUrl: /^https?:\/\//i.test(rec.hiloUrl) ? rec.hiloUrl : '',
    recibido: rec.recibido, solicitante: rec.solicitante, pr: rec.pr, nombre: rec.nombre, montoClp: rec.montoClp,
    montoTexto: rec.montoTexto, fechaTexto: rec.fechaTexto, fecha: '', proveedor: rec.proveedor,
    descripcion: rec.descripcion, comentario: rec.comentario, cecos: rec.cecos, totalUf: rec.totalUf, estado: rec.estado,
    anio: rec.anio, lineId: rec.lineId, montoImputado: rec.montoImputado, sugerido: 0, nota: rec.nota,
    procesadoPor: rec.procesadoPor, procesado: rec.procesado, asunto: rec.asunto, lectura: rec.lectura,
  };
  try { s.fecha = aprobParseFecha_(rec.fechaTexto); } catch (e) { s.fecha = ''; }
  aprobDerive_(s);
  return s;
}

// Escribe la fila completa (formatos + valores en una pasada); conserva columnas ajenas. → valores escritos
function aprobWrite_(sh, t, rowNum, rec, raw) {
  const width = t.width;
  const vals = [];
  for (let j = 0; j < width; j++) vals.push(raw && j < raw.length ? raw[j] : '');
  const rng = sh.getRange(rowNum, 1, 1, width);
  const fmts = rng.getNumberFormats()[0].slice();
  const done = rec.estado === 'Vinculada' || rec.estado === 'Nueva línea';
  const cells = {
    'ID': rec.id, 'Gmail ID': rec.gmailIds.join(','), 'Hilo': rec.hiloUrl, 'Recibido': aprobDateCell_(rec.recibido),
    'Solicitante': rec.solicitante, 'PR': rec.pr, 'Nombre': rec.nombre, 'Monto CLP': rec.montoClp || 0,
    'Monto texto': rec.montoTexto, 'Fecha solicitud': rec.fechaTexto, 'Proveedor': rec.proveedor,
    'Descripción': rec.descripcion, 'Comentario': rec.comentario,
    'CeCos': rec.cecos.length ? JSON.stringify(rec.cecos.map(aprobCecoStored_)) : '',
    'Total UF': rec.totalUf || '', 'Estado': rec.estado, 'Año': rec.anio ? Number(rec.anio) : '', 'Línea': rec.lineId,
    'Monto imputado': done ? rec.montoImputado : '', 'Nota': rec.nota, 'Procesado por': rec.procesadoPor,
    'Procesado': aprobDateCell_(rec.procesado), 'Asunto': rec.asunto, 'Lectura': rec.lectura,
  };
  APROB_HEADERS.forEach(h => {
    const j = t.idx[h];
    if (j == null || j < 0 || j >= width) return;
    const f = aprobFmt_(h);
    fmts[j] = f;
    const v = cells[h];
    vals[j] = typeof v === 'string' && v.charAt(0) === '=' ? "'" + v : (v == null ? '' : v);
  });
  rng.setNumberFormats([fmts]);
  rng.setValues([vals]);
  return vals;
}

function aprobDateCell_(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? '' : d;
}

function aprobCecosRead_(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter(c => c && typeof c === 'object').map(aprobCecoStored_) : [];
  } catch (e) {
    return [];
  }
}

function aprobEstado_(v) {
  const n = norm_(v);
  return APROB_ESTADOS.find(e => norm_(e) === n) || 'Pendiente';
}

function aprobAnio_(v) {
  const n = num_(v);
  return n >= 2000 && n <= 2100 ? String(n) : '';
}

// Texto de celda: quita el apóstrofo que se antepone a "=" al escribir
function aprobTxt_(v) {
  const s = v instanceof Date ? iso_(v) : str_(v);
  return /^'=/.test(s) ? s.slice(1) : s;
}

function aprobIso_(v) {
  if (v instanceof Date) return iso_(v);
  const s = str_(v);
  if (!s) return '';
  const d = new Date(s);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(d.getTime()) ? d.toISOString() : '';
}

/* ------------------------------------------------------------------ */
/* Activador, estado y utilidades                                      */
/* ------------------------------------------------------------------ */

// Un activador diario. Si existe uno con otro horario (p. ej. de una versión anterior), se reemplaza.
function aprobInstall_() {
  const hour = aprobHour_();
  const want = 'daily@' + hour;
  const props = PropertiesService.getScriptProperties();
  const mine = ScriptApp.getProjectTriggers().filter(tr => tr.getHandlerFunction() === APROB_HANDLER);
  const same = mine.length === 1 && props.getProperty(APROB_PROP_SCHEDULE) === want;
  if (same) return { installed: true, created: false, hour: hour };
  mine.forEach(tr => ScriptApp.deleteTrigger(tr)); // duplicados u horario antiguo
  ScriptApp.newTrigger(APROB_HANDLER).timeBased().everyDays(1).atHour(hour).inTimezone(tz_()).create();
  props.setProperty(APROB_PROP_SCHEDULE, want);
  return { installed: true, created: true, hour: hour };
}

function aprobHour_() {
  const h = Number(CONFIG.APROB_SCAN_HOUR);
  return isFinite(h) && h >= 0 && h <= 23 ? Math.floor(h) : 7;
}

// Evento real del activador: su triggerUid corresponde a un activador de aprobScanTrigger del dueño del script.
function aprobTriggerEvent_(e) {
  try {
    const uid = e && typeof e === 'object' ? str_(e.triggerUid) : '';
    if (!uid) return false;
    return ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === APROB_HANDLER && str_(tr.getUniqueId()) === uid);
  } catch (err) {
    return false;
  }
}

function aprobAssertAdmin_() {
  if (!isAdmin_()) throw new Error('Las solicitudes de compra son sólo para administradores.');
}

function aprobSaveResult_(obj) {
  try {
    PropertiesService.getScriptProperties().setProperty(APROB_PROP_RESULT, JSON.stringify(obj));
  } catch (e) {
    console.warn('aprobSaveResult_: ' + aprobErr_(e));
  }
}

function aprobPublicResult_(r) {
  const x = r || {};
  return {
    found: x.found || 0, added: x.added || 0, updated: x.updated || 0, ignored: x.ignored || 0,
    skipped: x.skipped || 0, errors: x.errors || 0, at: x.at || '',
  };
}

function aprobSender_() {
  return str_(CONFIG.ARIBA_SENDER || 'buyerapproval-prod+copec-ss-c1@ansmtp.ariba.com').toLowerCase();
}

function aprobSheetName_() {
  return str_(CONFIG.APROB_SHEET) || 'Solicitudes';
}

function aprobMyCecos_() {
  return (Array.isArray(CONFIG.MY_CECOS) ? CONFIG.MY_CECOS : []).map(c => str_(c).toUpperCase()).filter(Boolean);
}

function aprobObj_(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function aprobBool_(v) {
  return v === true || /^(true|1|si|sí|on|yes)$/i.test(str_(v));
}

// Monto entero ≥ 0 (acepta 1234567, "1.234.567" o "$1.234.567"); vacío → def
function aprobMonto_(v, def) {
  if (v === undefined || v === null || v === '') return Math.max(Math.round(Number(def) || 0), 0);
  const n = typeof v === 'number' ? v : (/^\$?\s*\d[\d.]*(,\d+)?$/.test(str_(v)) ? aprobNum_(v) : NaN);
  if (!isFinite(n) || n < 0) throw new Error('El monto debe ser un número entero mayor o igual a cero.');
  if (n > 1e13) throw new Error('El monto es demasiado grande.');
  return Math.round(n);
}

function aprobNota_(v) {
  const s = str_(v);
  if (s.length > 2000) throw new Error('La nota es muy larga (máximo 2.000 caracteres).');
  return s;
}

function aprobErr_(e) {
  return String((e && e.message) || e || 'error desconocido');
}
