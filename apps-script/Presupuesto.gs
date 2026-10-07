/**
 * Presupuesto.gs · pestañas "Cuadre AAAA" (una por año: "Cuadre 2026", "Cuadre 2027", ...)
 *
 * - Lee cada pestaña por NOMBRE de encabezado (fila 1, cualquier orden; columnas extra se respetan).
 * - Pendiente / Estado / Alerta se calculan siempre con presCalc_ (reglas v1) y se escriben al guardar.
 * - Agrega "Responsable" e "ID" al final de la fila 1 si faltan y asigna IDs L-xxxxxxxx a filas sin ID
 *   (o con ID repetido, p. ej. al duplicar una pestaña para el año siguiente).
 * - Nunca sobrescribe celdas con fórmula (ni columnas alimentadas por ARRAYFORMULA).
 * API pública: budgetSave, budgetDelete, budgetCreateYear, recalcAll. Detalle: dev/SPEC.md §1.1 y §5.
 * presSaveInLock_ (mismo guardado sin lock) lo usa Aprobaciones.gs (SPEC §13.2).
 */

// [clave interna, encabezado en la hoja] en el orden de una pestaña nueva
const PRES_COLS = [
  ['area', 'Area'], ['proj', 'Proyecto'], ['clas', 'Clasificacion'], ['po', 'Presupuesto original'],
  ['pf', 'Monto final proyectado'], ['pg', 'Pagado a la fecha'], ['pend', 'Pendiente'], ['oc', 'OC emitida'],
  ['estado', 'Estado'], ['alerta', 'Alerta'], ['nota', 'Nota'], ['resp', 'Responsable'], ['id', 'ID'],
];
const PRES_REQUIRED = ['area', 'proj', 'clas', 'po', 'pf', 'pg', 'oc'];
const PRES_EDITABLE = ['area', 'proj', 'clas', 'po', 'pf', 'pg', 'oc', 'nota', 'resp'];
const PRES_CALC = ['pend', 'estado', 'alerta'];
const PRES_CLASES = ['POA', 'Nuevo', 'Fuera de POA'];
const PRES_LABELS = {
  area: 'Área', proj: 'Proyecto', clas: 'Clasificación', po: 'Presup. original', pf: 'Final proyectado',
  pg: 'Pagado', oc: 'OC', nota: 'Nota', resp: 'Responsable',
};
const PRES_WIDTHS = [130, 320, 120, 140, 150, 130, 120, 90, 120, 120, 300, 190, 110];

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

// Crea (id vacío) o edita una línea de "Cuadre {year}". Devuelve el bundle con lastId.
// base (opcional, sólo al editar): {campo: valor en la planilla cuando se empezó a editar}. Si un campo que se
// cambia ya no tiene ese valor en la hoja (otro lo cambió), se avisa en vez de sobrescribirlo. Sin base: sin verificación.
// opts.light (v3.4, SPEC §18; sólo al editar): guarda y responde {ok, lastId} SIN armar el bundle. El cliente ya
// mostró el cambio (misma regla que presCalc_), así que no espera los datos completos: la respuesta llega mucho antes.
function budgetSave(year, id, data, base, opts) {
  // Validación antes del lock (mismos errores y en el mismo orden que antes); el guardado está en presSaveInLock_
  presYearNum_(year);
  presClean_(data);
  if (opts && opts.light === true && str_(id)) {
    assertMember_();
    return { ok: true, lastId: withLock_(() => presSaveInLock_(year, id, data, base)).id };
  }
  return mutate_(() => ({ lastId: presSaveInLock_(year, id, data, base).id }));
}

// Mismo guardado que budgetSave pero SIN lock ni bundle: llamar sólo dentro de un mutate_/withLock_ propio
// (p. ej. Aprobaciones.gs vincula o crea líneas en el mismo lock en que marca la solicitud). → {id}
function presSaveInLock_(year, id, data, base) {
  const y = presYearNum_(year);
  const patch = presClean_(data);
  const lineId = str_(id);
  const b = base && typeof base === 'object' && !Array.isArray(base) ? base : null;
  const sh = presSheet_(ss_(), y);
  const tab = sh.getName();
  const m = presKeyMap_(presEnsureColumns_(sh));
  const rng = sh.getDataRange();
  const values = rng.getValues();
  const forms = rng.getFormulas();
  const width = values[0].length;
  const spill = presSpillCols_(forms);

  if (lineId) {
    const i = presFindIndex_(values, m, lineId);
    if (i < 1) throw new Error('No encontré esta línea en la pestaña "' + tab + '" (¿se borró o se movió en la planilla?). Recarga e intenta de nuevo.');
    const cur = presRowObj_(values[i], m);
    // Sólo cambios reales (un salto de línea en el nombre escrito en la hoja no cuenta como cambio)
    const keys = Object.keys(patch).filter(k => (k === 'proj' ? cur.proj.replace(/\s+/g, ' ') : cur[k]) !== patch[k]);
    if (b) presCheckBase_(keys, cur, b);
    const next = Object.assign({}, cur, patch);
    if (keys.indexOf('proj') < 0) next.proj = cur.proj;
    presValidate_(next, keys);
    if (keys.indexOf('area') >= 0) presCheckLinkedArea_(lineId, next.area);
    presCheckWritable_(keys, next, m, forms[i], spill, tab);
    presWriteRow_(sh, i + 1, values[i], forms[i], spill, m, next, keys);
    if (keys.length) log_('Editar línea', next.proj, tab + ' · ' + presDiff_(cur, next, keys));
    return { id: lineId };
  }

  // Crear: valores por defecto + datos recibidos
  const d = Object.assign({ area: '', proj: '', clas: 'POA', po: 0, pf: 0, pg: 0, oc: '', nota: '', resp: '' }, patch);
  presValidate_(d, PRES_EDITABLE);
  const seen = new Set();
  for (let i = 1; i < values.length; i++) seen.add(str_(values[i][m.id]));
  d.id = presNewId_(seen);
  const keys = PRES_EDITABLE.concat(['id']);

  const rowNum = presFreeRow_(sh, values, forms, m, spill);
  const inData = rowNum <= values.length;
  if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rowNum - sh.getMaxRows());
  if (!inData && rowNum > 2) {
    sh.getRange(rowNum, 1, 1, width).setNumberFormats(sh.getRange(rowNum - 1, 1, 1, width).getNumberFormats());
  }
  const raw = inData ? values[rowNum - 1] : new Array(width).fill('');
  const rowForms = inData ? forms[rowNum - 1] : new Array(width).fill('');
  presCheckWritable_(keys, d, m, rowForms, spill, tab);
  presWriteRow_(sh, rowNum, raw, rowForms, spill, m, d, keys);
  log_('Crear línea', d.proj, [tab, presFmt_('area', d.area), d.clas, 'Final ' + presMoney_(d.pf),
    'Pagado ' + presMoney_(d.pg), 'OC ' + (d.oc || '—')].join(' · '));
  return { id: d.id };
}

// Elimina la línea y limpia sus vínculos en Gestión (mismo lock).
function budgetDelete(year, id) {
  const y = presYearNum_(year);
  const lineId = str_(id);
  if (!lineId) throw new Error('Falta el ID de la línea a eliminar.');
  return mutate_(() => {
    const sh = presSheet_(ss_(), y);
    const tab = sh.getName();
    const m = presKeyMap_(presEnsureColumns_(sh));
    const values = sh.getDataRange().getValues();
    const i = presFindIndex_(values, m, lineId);
    if (i < 1) throw new Error('No encontré esta línea en la pestaña "' + tab + '" (¿ya se eliminó?). Recarga e intenta de nuevo.');
    const d = presRowObj_(values[i], m);
    // Primero Gestión: si falla, la línea queda intacta.
    if (typeof gOnLineDeleted_ === 'function') gOnLineDeleted_(lineId);
    if (sh.getMaxRows() - sh.getFrozenRows() > 1) sh.deleteRow(i + 1);
    else sh.getRange(i + 1, 1, 1, values[0].length).clearContent(); // no se puede borrar la única fila no fija
    log_('Eliminar línea', d.proj, [tab, 'Final ' + presMoney_(d.pf), 'Pagado ' + presMoney_(d.pg), 'OC ' + (d.oc || '—')].join(' · '));
    return {};
  });
}

// Sólo administradores: crea la pestaña "Cuadre {year}" con los 13 encabezados.
function budgetCreateYear(year) {
  if (!isAdmin_()) throw new Error('Sólo un administrador puede crear un año nuevo.');
  const y = presYearNum_(year);
  return mutate_(() => {
    const ss = ss_();
    const name = presTabName_(y);
    if (presYears_(ss).some(t => t.year === y) || ss.getSheetByName(name)) {
      throw new Error('Ya existe la pestaña "' + name + '" en la planilla.');
    }
    const sh = ss.insertSheet(name, ss.getSheets().length);
    presInitSheet_(sh);
    log_('Crear año', name, 'Pestaña nueva con ' + PRES_COLS.length + ' columnas');
    return {};
  });
}

// Menú de la hoja / Ajustes: recalcula Pendiente, Estado y Alerta en todas las pestañas Cuadre.
// También agrega columnas Responsable/ID y completa IDs faltantes o repetidos.
function recalcAll() {
  const res = { tabs: 0, rows: 0, ids: 0, cells: 0 };
  const b = mutate_(() => {
    const seen = new Set();
    presYears_(ss_()).forEach(t => {
      const r = presFixTab_(t.sheet, seen, true);
      res.tabs++; res.rows += r.rows; res.ids += r.ids; res.cells += r.cells;
    });
    log_('Recalcular', 'Presupuesto', presRecalcMsg_(res));
  });
  presToast_(presRecalcMsg_(res));
  return b;
}

/* ------------------------------------------------------------------ */
/* Lectura (llamada por bundle_, siempre fuera del lock)               */
/* ------------------------------------------------------------------ */

// Pestañas "Cuadre AAAA" ordenadas por año (si hay dos con el mismo año, gana la primera).
function presYears_(ss) {
  const re = presTabRe_();
  const out = [];
  const seen = {};
  (ss || ss_()).getSheets().forEach(sh => {
    const mt = String(sh.getName()).trim().match(re);
    if (!mt) return;
    const y = Number(mt[1]);
    if (seen[y]) return;
    seen[y] = true;
    out.push({ year: y, sheet: sh });
  });
  return out.sort((a, b) => a.year - b.year);
}

// {years:[2026,...], byYear:{'2026':[Line]}}. Repara columnas/IDs una sola vez (con lock) si hace falta.
function presReadAll_(ss) {
  ss = ss || ss_();
  let tabs = presYears_(ss).map(presReadTab_);
  if (presNeedsRepair_(tabs)) {
    let repaired = false;
    try {
      withLock_(() => {
        const seen = new Set();
        presYears_(ss).forEach(t => presFixTab_(t.sheet, seen, false));
      });
      repaired = true;
    } catch (e) {
      // Si no se pudo reparar (lock ocupado, permisos), igual se cargan los datos con IDs temporales.
      console.error('presReadAll_: no se pudieron completar columnas/IDs: ' + (e && e.message));
    }
    if (repaired) tabs = presYears_(ss).map(presReadTab_);
  }

  const years = [];
  const byYear = {};
  const seen = new Set();
  tabs.forEach(tb => {
    years.push(tb.year);
    const lines = [];
    if (!tb.empty) {
      for (let i = 1; i < tb.values.length; i++) {
        const d = presRowObj_(tb.values[i], tb.m);
        if (!d.proj || presIsTotal_(d.proj)) continue;
        if (!presValidId_(d.id) || seen.has(d.id)) d.id = 'L-tmp' + tb.year + 'r' + (i + 1); // sólo si falló la reparación
        seen.add(d.id);
        lines.push(presLine_(tb.year, i + 1, d));
      }
    }
    byYear[String(tb.year)] = lines;
  });
  return { years: years, byYear: byYear };
}

// Reglas de negocio v1 (no confiar en los valores guardados en la hoja).
function presCalc_(d) {
  const pf = num_(d.pf);
  const pg = num_(d.pg);
  const oc = presOc_(d.oc);
  const clas = presClas_(d.clas);
  const pend = Math.max(pf - pg, 0);

  let estado;
  if (pf === 0) estado = 'No se realizará';
  else if (pg >= pf) estado = 'Ejecutado';
  else if (oc === 'Si' || pg > 0) estado = 'En curso';
  else estado = 'Por ejecutar';

  let alerta;
  if (pf === 0) alerta = '—';
  else if (clas === 'Fuera de POA') alerta = 'Ejecutado';
  else if (oc === '') alerta = 'Definir OC';
  else if (oc === 'No' && pend > 0) alerta = 'Pagar/OC ya';
  else if (pend === 0) alerta = 'Pagado';
  else alerta = 'OK con OC';

  return { pend: pend, estado: estado, alerta: alerta };
}

// Escribe: llamar dentro del lock (o desde setup). Inicializa una pestaña vacía, valida las columnas
// obligatorias y agrega "Responsable"/"ID" al final de la fila 1. Devuelve headerIndex_ (13 nombres).
function presEnsureColumns_(sh) {
  const names = PRES_COLS.map(c => c[1]);
  if (sh.getLastRow() === 0 && sh.getLastColumn() === 0) presInitSheet_(sh);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const hi = headerIndex_(sh.getRange(1, 1, 1, lastCol).getValues()[0], names);
  presCheckRequired_(hi, sh.getName());
  const missing = ['Responsable', 'ID'].filter(h => hi[h] < 0);
  if (!missing.length) return hi;

  const start = lastCol + 1; // después de cualquier dato, aunque no tenga encabezado
  const end = lastCol + missing.length;
  if (sh.getMaxColumns() < end) sh.insertColumnsAfter(sh.getMaxColumns(), end - sh.getMaxColumns());
  sh.getRange(1, lastCol).copyFormatToRange(sh, start, end, 1, 1);
  sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  missing.forEach((h, k) => {
    sh.setColumnWidth(start + k, h === 'ID' ? 110 : 190);
    if (h === 'Responsable' && sh.getMaxRows() > 1) {
      sh.getRange(2, start + k, sh.getMaxRows() - 1, 1).setDataValidation(presListRule_(CONFIG.USERS.map(u => u.email.toLowerCase())));
    }
    if (h === 'ID') presProtectId_(sh, start + k);
  });
  return headerIndex_(sh.getRange(1, 1, 1, end).getValues()[0], names);
}

/* ------------------------------------------------------------------ */
/* Helpers internos                                                    */
/* ------------------------------------------------------------------ */

// Una lectura por pestaña: valores + mapa de columnas. Lanza error si faltan columnas obligatorias.
function presReadTab_(t) {
  const values = t.sheet.getDataRange().getValues();
  const empty = values.length <= 1 && values[0].every(v => v === '' || v == null);
  const hi = headerIndex_(values[0], PRES_COLS.map(c => c[1]));
  if (!empty) presCheckRequired_(hi, t.sheet.getName());
  return { year: t.year, sheet: t.sheet, values: values, m: presKeyMap_(hi), empty: empty };
}

// ¿Falta alguna columna, una pestaña está vacía, hay IDs vacíos/inválidos/repetidos (entre todas las pestañas)
// o una fila vaciada a mano que conserva su ID (ver presBlankRow_)?
function presNeedsRepair_(tabs) {
  const seen = new Set();
  return tabs.some(tb => {
    if (tb.empty || tb.m.resp < 0 || tb.m.id < 0) return true;
    for (let i = 1; i < tb.values.length; i++) {
      const row = tb.values[i];
      const proj = presText_(row[tb.m.proj]);
      const id = str_(row[tb.m.id]);
      if (!proj) {
        if (presValidId_(id) && presBlankRow_(row, null, tb.m, null)) return true;
        continue;
      }
      if (presIsTotal_(proj)) continue;
      if (!presValidId_(id) || seen.has(id)) return true;
      seen.add(id);
    }
    return false;
  });
}

// Dentro del lock: columnas + IDs (un setValues en la columna ID) y, si calc, Pendiente/Estado/Alerta.
// `seen` se comparte entre pestañas (en orden de año) para que los IDs sean únicos en toda la planilla.
// Una fila vaciada a mano (sin datos en Área…Nota) pierde su ID, para que una línea nueva escrita ahí no
// herede el proyecto ni los comentarios de la anterior. Los IDs repetidos o liberados quedan en el Historial.
function presFixTab_(sh, seen, calc) {
  const out = { rows: 0, ids: 0, cells: 0, ghosts: 0 };
  const m = presKeyMap_(presEnsureColumns_(sh));
  const rng = sh.getDataRange();
  const values = rng.getValues();
  if (values.length < 2) return out;
  const forms = rng.getFormulas();
  const spill = presSpillCols_(forms);
  const cols = ['id'].concat(calc ? PRES_CALC : []).filter(k => m[k] >= 0 && !spill[m[k]]);
  const buf = {};
  const dirty = {};
  cols.forEach(k => { buf[k] = []; dirty[k] = false; });
  const here = {};    // ID → primera fila de esta pestaña que lo usa
  const dups = [];    // repetidos dentro de la pestaña (p. ej. una fila copiada y pegada)
  const ghosts = [];  // filas vaciadas que conservaban su ID
  let foreign = 0;    // repetidos de otra pestaña (p. ej. pestaña duplicada para el año siguiente)

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const f = forms[i];
    const d = presRowObj_(r, m);
    const live = !!d.proj && !presIsTotal_(d.proj);
    if (live) out.rows++;
    const c = live && calc ? presCalc_(d) : null;
    cols.forEach(k => {
      const j = m[k];
      if (f[j]) {
        if (k === 'id' && live && d.id) seen.add(d.id);
        buf[k].push([f[j]]);
        return;
      }
      let v = r[j];
      if (live && k === 'id') {
        if (presValidId_(d.id) && !seen.has(d.id)) {
          seen.add(d.id);
          here[d.id] = { row: i + 1, proj: d.proj };
        } else {
          v = presNewId_(seen); dirty.id = true; out.ids++;
          if (presValidId_(d.id)) {
            if (here[d.id]) dups.push({ id: d.id, first: here[d.id], row: i + 1, proj: d.proj });
            else foreign++;
          }
        }
      } else if (k === 'id') {
        if (!d.proj && presValidId_(d.id) && presBlankRow_(r, f, m, spill)) {
          v = ''; dirty.id = true; out.ghosts++;
          ghosts.push({ id: d.id, row: i + 1 });
        }
      } else if (c && String(c[k]) !== String(r[j])) {
        v = c[k]; dirty[k] = true; out.cells++;
      }
      buf[k].push([v]);
    });
  }

  cols.forEach(k => {
    if (!dirty[k]) return;
    const col = sh.getRange(2, m[k] + 1, buf[k].length, 1);
    const fmts = col.getNumberFormats();
    col.setValues(buf[k].map((v, n) => [forms[n + 1][m[k]] ? v[0] : presCell_(v[0], fmts[n][0])]));
  });
  if (dirty.id || calc) presProtectId_(sh, m.id + 1);
  presLogIdFixes_(sh.getName(), dups, ghosts, foreign);
  return out;
}

// Fila sin datos en Área, Proyecto, Clasificación, montos, OC y Nota (Responsable y columnas extra no cuentan;
// con forms/spill, las celdas con fórmula tampoco). Sin forms (sólo valores) el criterio es más estricto.
function presBlankRow_(r, forms, m, spill) {
  return ['area', 'proj', 'clas', 'po', 'pf', 'pg', 'oc', 'nota'].every(k => {
    const j = m[k];
    if (j < 0 || j >= r.length) return true;
    if ((forms && forms[j]) || (spill && spill[j])) return true;
    return r[j] === '' || r[j] == null;
  });
}

// Historial de las correcciones de ID de una pestaña (una entrada por tipo, no una por fila).
function presLogIdFixes_(tab, dups, ghosts, foreign) {
  const list = (arr, f) => arr.slice(0, 10).map(f).join(' · ') + (arr.length > 10 ? ' · y ' + (arr.length - 10) + ' más' : '');
  if (dups.length) {
    log_('ID repetido', tab, list(dups, x => 'ID ' + x.id + ' en filas ' + x.first.row + ' ("' + presFmt_('proj', x.first.proj) + '") y ' +
      x.row + ' ("' + presFmt_('proj', x.proj) + '"): se asignó un ID nuevo a la fila ' + x.row) +
      '. La fila de arriba conserva el proyecto vinculado y los comentarios; revisa que correspondan.');
  }
  if (ghosts.length) {
    log_('Línea borrada en la planilla', tab, list(ghosts, x => 'Fila ' + x.row + ' (' + x.id + ')') +
      ': fila vaciada que conservaba su ID. Se quitó el ID para que una línea nueva escrita ahí no herede su proyecto ni sus comentarios.');
  }
  if (foreign) {
    log_('IDs nuevos', tab, foreign + (foreign === 1 ? ' línea tenía un ID usado' : ' líneas tenían IDs usados') +
      ' en otra pestaña (p. ej. copiada de otro año): se asignaron IDs nuevos.');
  }
}

// Protección "sólo advertencia" en la columna ID: Sheets avisa antes de pegar o escribir encima (no bloquea
// ni afecta a la app). Se crea una vez por pestaña; si no se puede (permisos), se sigue sin ella.
function presProtectId_(sh, col) {
  const desc = 'ID de la app (no copiar ni editar)';
  try {
    if (!(col >= 1)) return false;
    const prots = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
    if (prots.some(p => p.getDescription() === desc)) return false;
    const a1 = presColA1_(col);
    sh.getRange(a1 + ':' + a1).protect().setDescription(desc).setWarningOnly(true);
    return true;
  } catch (e) {
    console.warn('presProtectId_: ' + (e && e.message));
    return false;
  }
}

// 1 → "A", 13 → "M", 27 → "AA"
function presColA1_(col) {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Fila destino de una línea nueva: la primera fila vacía bajo la última línea (respeta fórmulas
// pre-cargadas en columnas calculadas); si no hay, la fila siguiente a getLastRow().
function presFreeRow_(sh, values, forms, m, spill) {
  let last = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    const p = presText_(values[i][m.proj]);
    if (p && !presIsTotal_(p)) { last = i; break; }
  }
  const cand = last + 1; // índice en values (fila de la hoja = cand + 1)
  if (cand < values.length) {
    const f = forms[cand];
    const inputCols = PRES_EDITABLE.concat(['id']).map(k => m[k]).filter(j => j >= 0);
    const formulaInInput = inputCols.some(j => f[j]);
    const empty = values[cand].every((v, j) => f[j] || spill[j] || v === '' || v == null);
    if (empty && !formulaInInput) return cand + 1;
  }
  return sh.getLastRow() + 1;
}

// Escribe la fila (normalmente con UN setValues) sólo en el tramo que cambia, incluidos Pendiente/Estado/
// Alerta; las fórmulas del tramo se reescriben tal cual y las columnas ARRAYFORMULA quedan en blanco.
// El tramo se corta sólo alrededor de celdas con texto que la app no administra (Proyecto, Nota,
// columnas extra) para no borrar enlaces o chips; en ese caso hay un setValues por tramo.
// Guardar sin cambios no escribe nada.
function presWriteRow_(sh, rowNum, raw, forms, spill, m, d, keys) {
  const want = {};
  keys.forEach(k => { if (m[k] >= 0) want[m[k]] = d[k]; });
  const c = presCalc_(d);
  PRES_CALC.forEach(k => { if (m[k] >= 0 && String(raw[m[k]]) !== String(c[k])) want[m[k]] = c[k]; });
  const cols = Object.keys(want).map(Number).filter(j => !forms[j] && !spill[j]).sort((a, b) => a - b);
  if (!cols.length) return 0;

  const managed = {};
  ['area', 'clas', 'po', 'pf', 'pg', 'pend', 'oc', 'estado', 'alerta', 'resp', 'id'].forEach(k => { if (m[k] >= 0) managed[m[k]] = true; });
  const safe = j => !!forms[j] || !!spill[j] || raw[j] === '' || raw[j] == null || !!managed[j];
  const runs = [];
  let a = cols[0], b = cols[0];
  for (let n = 1; n < cols.length; n++) {
    let ok = true;
    for (let j = b + 1; j < cols[n]; j++) if (!safe(j)) { ok = false; break; }
    if (ok) b = cols[n];
    else { runs.push([a, b]); a = b = cols[n]; }
  }
  runs.push([a, b]);

  runs.forEach(r => {
    const rng = sh.getRange(rowNum, r[0] + 1, 1, r[1] - r[0] + 1);
    const fmts = rng.getNumberFormats()[0];
    const vals = [];
    for (let j = r[0]; j <= r[1]; j++) {
      const f = j - r[0];
      vals.push(forms[j] ? forms[j] : spill[j] ? '' : presCell_(j in want ? want[j] : raw[j], fmts[f]));
    }
    rng.setValues([vals]);
  });
  return runs.length;
}

// Error claro si se intenta cambiar una celda que la hoja calcula con fórmula, o una columna inexistente.
function presCheckWritable_(keys, d, m, forms, spill, tab) {
  keys.forEach(k => {
    const j = m[k];
    if (j < 0) {
      if (d[k] !== '' && d[k] != null) throw new Error('La pestaña "' + tab + '" no tiene la columna "' + presHeader_(k) + '". Agrégala en la fila 1.');
      return;
    }
    if (forms[j] || spill[j]) {
      throw new Error('La columna "' + presHeader_(k) + '" de esta línea se calcula con una fórmula en la planilla; cámbiala directamente en la hoja.');
    }
  });
}

// Normaliza y valida los campos permitidos de un formulario (sólo los presentes).
function presClean_(data) {
  const src = data && typeof data === 'object' ? data : {};
  const out = {};
  PRES_EDITABLE.forEach(k => {
    if (src[k] === undefined) return;
    const v = src[k];
    if (k === 'area') {
      const s = presText_(v);
      const a = pillarArea_(s);
      if (s && !a) throw new Error('Área no reconocida: "' + s + '". Usa Cambio Climático, Economía Circular o Naturaleza.');
      out.area = a;
    } else if (k === 'proj') {
      const s = presText_(v).replace(/\s+/g, ' ');
      if (s.length > 300) throw new Error('El nombre del proyecto es muy largo (máximo 300 caracteres).');
      out.proj = s;
    } else if (k === 'clas') {
      const c = presClas_(v);
      if (PRES_CLASES.indexOf(c) < 0) throw new Error('Clasificación inválida: usa POA, Nuevo o Fuera de POA.');
      out.clas = c;
    } else if (k === 'po' || k === 'pf' || k === 'pg') {
      if (typeof v === 'number' && !isFinite(v)) throw new Error('El monto "' + PRES_LABELS[k] + '" no es un número válido.');
      const n = num_(v);
      if (n < 0) throw new Error('El monto "' + PRES_LABELS[k] + '" no puede ser negativo.');
      if (n > 1e13) throw new Error('El monto "' + PRES_LABELS[k] + '" es demasiado grande.');
      out[k] = n;
    } else if (k === 'oc') {
      const s = presText_(v);
      const o = presOc_(s);
      if (s && !o) throw new Error('"OC emitida" debe ser Si, No o quedar vacío.');
      out.oc = o;
    } else if (k === 'nota') {
      const s = presText_(v);
      if (s.length > 5000) throw new Error('La nota es muy larga (máximo 5.000 caracteres).');
      out.nota = s;
    } else if (k === 'resp') {
      const s = presResp_(v);
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new Error('Responsable inválido: debe ser un correo (ej. nombre@copec.cl).');
      out.resp = s;
    }
  });
  return out;
}

// Conflicto de edición: entre los campos que el usuario cambió (keys), los que en la hoja ya no tienen el valor
// con que se empezó a editar (base) también cambiaron en la planilla → error claro, nada se escribe.
function presCheckBase_(keys, cur, base) {
  const clash = keys.filter(k => base[k] !== undefined && !presSame_(k, cur[k], base[k]));
  if (!clash.length) return;
  const show = k => (k === 'proj' || k === 'nota') && cur[k] ? '"' + presFmt_(k, cur[k]) + '"' : presFmt_(k, cur[k]);
  const parts = clash.map(k => '"' + PRES_LABELS[k] + '" (ahora ' + show(k) + ')');
  const one = parts.length === 1;
  throw new Error((one ? 'El campo ' + parts[0] + ' cambió' : 'Los campos ' + parts.join(', ') + ' cambiaron') +
    ' en la planilla mientras editabas. Revisa y vuelve a guardar si quieres reemplazarl' + (one ? 'o' : 'os') + ' por tu valor.');
}

// ¿Mismo valor? Compara en forma canónica (no lanza errores con valores raros de la hoja).
// Proyecto sin espacios: un campo de texto del navegador quita los saltos de línea del nombre.
function presSame_(k, a, b) {
  if (k === 'area') return pillarKey_(a) === pillarKey_(b);
  if (k === 'proj') return presText_(a).replace(/\s+/g, '') === presText_(b).replace(/\s+/g, '');
  if (k === 'po' || k === 'pf' || k === 'pg') return num_(a) === num_(b);
  if (k === 'clas') return presClas_(a) === presClas_(b);
  if (k === 'oc') return presOc_(a) === presOc_(b);
  if (k === 'resp') return presResp_(a) === presResp_(b);
  return presText_(a).replace(/\s+/g, ' ') === presText_(b).replace(/\s+/g, ' ');
}

// Una línea vinculada a un proyecto (Gestión) debe seguir en el pilar del proyecto: cambiarle el área a otro pilar
// dejaría el vínculo inconsistente. Volver al pilar del proyecto sí se permite.
function presCheckLinkedArea_(lineId, area) {
  if (typeof gLineProject_ !== 'function') return;
  const p = gLineProject_(lineId);
  if (!p || !p.pilar || p.pilar === pillarKey_(area)) return;
  const pil = typeof gPillarLabel_ === 'function' ? gPillarLabel_(p.pilar) : pillarArea_(p.pilar);
  throw new Error('Esta línea está vinculada al proyecto "' + p.nombre + '" (' + pil + '). Desvincúlala antes de cambiarle el área.');
}

function presValidate_(d, keys) {
  const has = k => keys.indexOf(k) >= 0;
  if (!d.proj) throw new Error('La línea necesita un nombre de proyecto.');
  if (has('area') && !pillarKey_(d.area)) throw new Error('Elige un área: Cambio Climático, Economía Circular o Naturaleza.');
  if (has('clas') && PRES_CLASES.indexOf(d.clas) < 0) throw new Error('Clasificación inválida: usa POA, Nuevo o Fuera de POA.');
}

// Fila de la hoja → objeto con valores canónicos (área, clasificación, OC y responsable normalizados).
function presRowObj_(r, m) {
  const at = j => (j >= 0 && j < r.length ? r[j] : '');
  const area = presText_(at(m.area));
  return {
    area: pillarArea_(area) || area,
    proj: presText_(at(m.proj)),
    clas: presClas_(at(m.clas)),
    po: num_(at(m.po)),
    pf: num_(at(m.pf)),
    pg: num_(at(m.pg)),
    oc: presOc_(at(m.oc)),
    nota: presText_(at(m.nota)),
    resp: presResp_(at(m.resp)),
    id: str_(at(m.id)),
  };
}

function presLine_(year, row, d) {
  const c = presCalc_(d);
  return {
    id: d.id, year: year, row: row, pilar: pillarKey_(d.area), area: d.area, proj: d.proj, clas: d.clas,
    po: d.po, pf: d.pf, pg: d.pg, pend: c.pend, oc: d.oc, estado: c.estado, alerta: c.alerta,
    nota: d.nota, resp: d.resp,
  };
}

// Pestaña nueva o vacía: encabezados, fila fija, anchos, formato de montos y listas desplegables.
function presInitSheet_(sh) {
  const names = PRES_COLS.map(c => c[1]);
  if (sh.getMaxColumns() < names.length) sh.insertColumnsAfter(sh.getMaxColumns(), names.length - sh.getMaxColumns());
  if (sh.getMaxRows() < 50) sh.insertRowsAfter(sh.getMaxRows(), 50 - sh.getMaxRows());
  sh.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold').setBackground('#f4f4f5');
  sh.setFrozenRows(1);
  PRES_WIDTHS.forEach((w, j) => sh.setColumnWidth(j + 1, w));
  const rows = sh.getMaxRows() - 1;
  const col = k => PRES_COLS.findIndex(c => c[0] === k) + 1;
  sh.getRange(2, col('po'), rows, 4).setNumberFormat('#,##0'); // D:G montos
  sh.getRange(2, col('area'), rows, 1).setDataValidation(presListRule_(CONFIG.PILLARS.map(p => p.area)));
  sh.getRange(2, col('clas'), rows, 1).setDataValidation(presListRule_(PRES_CLASES));
  sh.getRange(2, col('oc'), rows, 1).setDataValidation(presListRule_(['Si', 'No']));
  sh.getRange(2, col('resp'), rows, 1).setDataValidation(presListRule_(CONFIG.USERS.map(u => u.email.toLowerCase())));
  presProtectId_(sh, col('id'));
}

// Lista desplegable que sólo advierte (no bloquea) valores distintos.
function presListRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
}

function presCheckRequired_(hi, tab) {
  const miss = PRES_REQUIRED.map(presHeader_).filter(h => hi[h] < 0);
  if (!miss.length) return;
  throw new Error((miss.length === 1 ? 'Falta la columna ' : 'Faltan las columnas ') +
    miss.map(h => '"' + h + '"').join(', ') + ' en la fila 1 de la pestaña "' + tab + '". ' +
    'Corrige los encabezados (o cambia el nombre de la pestaña si no es un cuadre de presupuesto).');
}

function presKeyMap_(hi) {
  const m = {};
  PRES_COLS.forEach(c => { m[c[0]] = hi[c[1]] == null ? -1 : hi[c[1]]; });
  return m;
}

function presHeader_(k) {
  const c = PRES_COLS.find(x => x[0] === k);
  return c ? c[1] : k;
}

// Columnas alimentadas por ARRAYFORMULA / {…} desde la fila 1 o 2: nunca se escriben valores en ellas.
function presSpillCols_(forms) {
  const out = {};
  [0, 1].forEach(i => (forms[i] || []).forEach((f, j) => {
    if (f && /ARRAYFORMULA|^=\s*\{/i.test(f)) out[j] = true;
  }));
  return out;
}

function presFindIndex_(values, m, id) {
  if (m.id < 0 || !id) return -1;
  for (let i = 1; i < values.length; i++) if (str_(values[i][m.id]) === id) return i;
  return -1;
}

function presSheet_(ss, year) {
  const t = presYears_(ss).find(x => x.year === year);
  if (!t) throw new Error('No existe la pestaña "' + presTabName_(year) + '" en la planilla.');
  return t.sheet;
}

function presTabName_(year) {
  return (CONFIG.BUDGET_PREFIX || 'Cuadre') + ' ' + year;
}

function presTabRe_() {
  const p = String(CONFIG.BUDGET_PREFIX || 'Cuadre').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + p + '\\s+(\\d{4})$', 'i');
}

function presYearNum_(year) {
  const y = Number(String(year == null ? '' : year).trim());
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Año inválido: usa un número entre 2000 y 2100.');
  return y;
}

// Mismo formato que valida Gestion.gs al vincular líneas (L- + 8 hex)
function presValidId_(s) {
  return /^L-[0-9a-f]{8}$/i.test(String(s || ''));
}

function presNewId_(seen) {
  let id;
  do { id = uid_('L'); } while (seen.has(id));
  seen.add(id);
  return id;
}

// Texto de celda (una fecha se convierte a 'yyyy-mm-dd', nunca viaja como Date).
function presText_(v) {
  return v instanceof Date ? dateStr_(v) : str_(v);
}

function presOc_(v) {
  const s = norm_(v).replace(/\.$/, '');
  if (['si', 's', 'yes', 'true', 'x'].indexOf(s) >= 0) return 'Si';
  if (['no', 'n', 'false'].indexOf(s) >= 0) return 'No';
  return '';
}

function presClas_(v) {
  const s = norm_(v).replace(/\s+/g, ' ');
  if (s === 'poa') return 'POA';
  if (s === 'nuevo' || s === 'nueva') return 'Nuevo';
  if (s === 'fuera de poa' || s === 'fuera poa' || s === 'fuera del poa') return 'Fuera de POA';
  return presText_(v);
}

// Responsable en minúsculas; si en la hoja escribieron un nombre ("Ina"), se traduce a su correo.
function presResp_(v) {
  const s = presText_(v).toLowerCase();
  if (!s || s.indexOf('@') >= 0) return s;
  const u = CONFIG.USERS.find(x => norm_(x.name) === norm_(s));
  return u ? u.email.toLowerCase() : s;
}

// Filas de totales al pie de la tabla (no son líneas).
function presIsTotal_(proj) {
  return /^total(es)?(\s+general)?\s*:?$/.test(norm_(proj));
}

// Evita que la hoja reinterprete un texto (fórmula, número, fecha, booleano) al reescribirlo.
function presCell_(v, fmt) {
  if (typeof v !== 'string' || v === '' || fmt === '@') return v;
  if (/^[^A-Za-zÀ-ÖØ-öø-ÿ]/.test(v) || /^(true|false|verdadero|falso)$/i.test(v) ||
    /^(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?[\s\/-]+\d/i.test(v)) return "'" + v;
  return v;
}

function presMoney_(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function presFmt_(k, v) {
  if (k === 'po' || k === 'pf' || k === 'pg') return presMoney_(v);
  if (v === '' || v == null) return '—';
  if (k === 'area') {
    const p = CONFIG.PILLARS.find(x => x.key === pillarKey_(v));
    return p ? p.label : String(v);
  }
  if (k === 'resp') return userName_(v);
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}

// "Pagado: $0 → $1.000.000 · OC: — → Si"
function presDiff_(a, b, keys) {
  return keys.map(k => PRES_LABELS[k] + ': ' + presFmt_(k, a[k]) + ' → ' + presFmt_(k, b[k])).join(' · ');
}

function presRecalcMsg_(r) {
  return r.tabs + (r.tabs === 1 ? ' pestaña' : ' pestañas') + ' · ' + r.rows + ' líneas · ' +
    r.cells + ' celdas actualizadas' + (r.ids ? ' · ' + r.ids + ' IDs nuevos' : '');
}

// Aviso en la hoja cuando se ejecuta desde el menú (en la web app no hace nada visible).
function presToast_(msg) {
  try {
    const a = SpreadsheetApp.getActiveSpreadsheet();
    if (a) a.toast(msg, CONFIG.APP_NAME, 5);
  } catch (e) { /* sin interfaz */ }
}
