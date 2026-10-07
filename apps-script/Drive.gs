/**
 * Drive · una carpeta de Google Drive por proyecto, dentro de la unidad compartida del equipo (SPEC §14.3).
 *
 * Estructura: <carpeta raíz>/<Pilar>/<Proyecto>. La raíz se guarda en la propiedad de script DRIVE_ROOT_ID
 * (Ajustes › driveSetRoot, sólo administradores). El ID de la carpeta de cada proyecto queda en la columna
 * "Carpeta" de la pestaña Gestión (se escribe con gSetProjectFolder_ de Gestion.gs, dentro del lock).
 *
 * PERMISO NUEVO: DriveApp necesita el alcance completo de Drive (https://www.googleapis.com/auth/drive).
 * Después de agregar este archivo hay que ejecutar cualquier función desde el editor (p. ej. setup) para autorizar
 * el permiso nuevo y volver a implementar la app web (Implementar › Gestionar implementaciones › Editar › Nueva versión).
 * La app corre como Gonzalo: las carpetas y archivos se crean con su cuenta dentro de la unidad compartida y el
 * equipo los abre con su propia membresía en esa unidad.
 *
 * Las llamadas a Drive son lentas: nunca se hacen dentro del lock de la planilla. Sólo la escritura de la celda
 * Carpeta (y el Historial) toman el lock, un instante.
 */

const DRIVE_PROP = 'DRIVE_ROOT_ID';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/';
// budgetMs: driveCreateMissing se detiene a los ~4,5 min (Apps Script corta a los 6) y avisa cuántos faltan.
const DRIVE_LIMITS = { maxBytes: 20 * 1024 * 1024, listMax: 200, scanMax: 1000, budgetMs: 270000, nameMax: 180, folderMax: 120 };
// Tipo por extensión, cuando el navegador no informa el mimeType del archivo
const DRIVE_EXT_MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', csv: 'text/csv', txt: 'text/plain', rtf: 'application/rtf',
  zip: 'application/zip', kml: 'application/vnd.google-earth.kml+xml', kmz: 'application/vnd.google-earth.kmz',
};

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

// Admin: conecta la carpeta raíz (enlace de Drive o ID). '' la desconecta. → {ok, root:{id, name, url}|null}
function driveSetRoot(urlOrId) {
  assertMember_();
  if (!isAdmin_()) throw new Error('Sólo un administrador puede conectar la carpeta de Drive del equipo.');
  const raw = str_(urlOrId);
  const props = PropertiesService.getScriptProperties();
  if (raw && !featureOn_('DRIVE')) throw new Error('Drive está desactivado (modo seguro). Actívalo en Code.gs (CONFIG.FEATURES.DRIVE) cuando TI lo apruebe.');
  if (!raw) {
    withLock_(() => {
      props.deleteProperty(DRIVE_PROP);
      log_('Configurar app', 'Carpeta de Drive', 'Carpeta del equipo desconectada');
    });
    return { ok: true, root: null };
  }
  const id = driveParseId_(raw);
  if (!id) throw new Error('Pega el enlace de una carpeta de Drive (https://drive.google.com/drive/folders/…) o su ID.');
  const folder = driveOpenFolder_(id, 'esa carpeta');
  if (driveTrashed_(folder)) throw new Error('Esa carpeta está en la papelera de Drive. Restáurala o elige otra.');
  let root;
  try {
    root = driveInfo_(folder);
  } catch (e) {
    throw new Error(driveErrMsg_(e, 'esa carpeta'));
  }
  withLock_(() => {
    props.setProperty(DRIVE_PROP, root.id);
    log_('Configurar app', 'Carpeta de Drive', root.name + ' (' + root.id + ')');
  });
  return { ok: true, root: root };
}

// Estado de la conexión → {configured, root:{id, name, url}|null, admin, error?}
function driveStatus() {
  assertMember_();
  const id = driveRootId_();
  const out = { configured: !!id, root: null, admin: isAdmin_(), disabled: !featureOn_('DRIVE') };
  if (!id) return out;
  try {
    const f = driveOpenFolder_(id, 'la carpeta del equipo');
    out.root = driveInfo_(f);
    if (driveTrashed_(f)) out.error = 'La carpeta del equipo está en la papelera de Drive. Restáurala o conecta otra en Ajustes.';
  } catch (e) {
    out.root = { id: id, name: '', url: DRIVE_FOLDER_URL + id };
    out.error = driveErrMsg_(e, 'la carpeta del equipo');
  }
  return out;
}

// Carpeta del proyecto (la crea o reutiliza si hace falta) → {id, url, name}
function driveFolder(projectId) {
  assertMember_();
  const list = driveProjects_();
  const p = driveProjectOrThrow_(projectId, list);
  const r = driveEnsure_(p.id, { log: true, projects: list });
  if (!r) throw new Error(driveNotConfigured_());
  return driveInfo_(r.folder);
}

// Archivos de la carpeta del proyecto, más nuevos primero (máx. 200). No crea la carpeta.
// → {folder:{id, url, name}|null, files:[{id, name, mimeType, size, updated, url, kind}], configured}
function driveList(projectId) {
  assertMember_();
  if (!featureOn_('DRIVE')) return { folder: null, files: [], configured: false, disabled: true }; // modo seguro
  const p = driveProjectOrThrow_(projectId);
  const out = { folder: null, files: [], configured: !!driveRootId_() };
  if (!p.carpeta) return out;
  const folder = driveTryFolder_(p.carpeta); // borrada, sin acceso o en la papelera → como si no tuviera carpeta
  if (!folder) return out;
  try {
    out.folder = driveInfo_(folder);
    out.files = driveEntries_(folder);
  } catch (e) {
    throw new Error(driveErrMsg_(e, 'la carpeta del proyecto'));
  }
  return out;
}

// Sube un archivo (base64) a la carpeta del proyecto (la crea si hace falta). Máx. 20 MB. → entrada de archivo
function driveUpload(projectId, file) {
  assertMember_();
  const f = file && typeof file === 'object' ? file : {};
  const list = driveProjects_();
  const p = driveProjectOrThrow_(projectId, list);
  const name = driveFileName_(f.name);
  let b64 = str_(f.base64).replace(/^data:[^,]*?;base64,/i, '').replace(/\s+/g, '');
  if (!b64) throw new Error('El archivo "' + name + '" está vacío o no se pudo leer.');
  const pad = /==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0;
  const approx = Math.floor(b64.length * 3 / 4) - pad;
  if (approx > DRIVE_LIMITS.maxBytes) throw new Error(driveTooBig_(name, approx));
  let bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (e) {
    throw new Error('No pude leer el archivo "' + name + '". Intenta subirlo de nuevo.');
  }
  if (!bytes || !bytes.length) throw new Error('El archivo "' + name + '" está vacío.');
  if (bytes.length > DRIVE_LIMITS.maxBytes) throw new Error(driveTooBig_(name, bytes.length));
  const mime = driveMime_(f.mimeType, name);
  const r = driveEnsure_(p.id, { log: true, projects: list });
  if (!r) throw new Error(driveNotConfigured_());
  let entry;
  try {
    const created = r.folder.createFile(Utilities.newBlob(bytes, mime, name));
    entry = driveEntry_(created, false);
  } catch (e) {
    throw new Error(driveErrMsg_(e, 'la carpeta del proyecto'));
  }
  driveLog_('Subir archivo', p.nombre, entry.name + ' · ' + driveSize_(bytes.length));
  return entry;
}

// Admin: crea (o vincula) la carpeta de cada proyecto que aún no tiene. Idempotente; se detiene a los ~4,5 min.
// → {created, linked, total, remaining, failed, errors[], done}
function driveCreateMissing() {
  assertMember_();
  if (!isAdmin_()) throw new Error('Sólo un administrador puede crear las carpetas de todos los proyectos.');
  const t0 = Date.now();
  const rootId = driveRootId_();
  if (!rootId) throw new Error(driveNotConfigured_());
  const projects = driveProjects_();
  const ctx = driveCtx_(projects);
  const todo = projects.filter(p => !p.carpeta);
  const out = { created: 0, linked: 0, total: projects.length, remaining: 0, failed: 0, errors: [], done: false };
  for (let i = 0; i < todo.length; i++) {
    if (Date.now() - t0 >= DRIVE_LIMITS.budgetMs) break;
    try {
      const r = driveEnsure_(todo[i], { ctx: ctx });
      if (!r) throw new Error(driveNotConfigured_());
      if (r.created) out.created++; else out.linked++;
    } catch (e) {
      out.failed++;
      const msg = String((e && e.message) || e);
      if (out.errors.length < 5) out.errors.push((todo[i].nombre || todo[i].id) + ': ' + msg);
      console.error('driveCreateMissing: ' + todo[i].id + ': ' + msg);
      // Sin acceso a la raíz (o sin raíz) fallarían todos: no se insiste
      if (e && e.driveRoot) break;
    }
  }
  out.remaining = todo.length - out.created - out.linked;
  out.done = out.remaining === 0;
  if (out.created || out.linked) {
    driveLog_('Crear carpetas de Drive', 'Proyectos', out.created + ' creadas · ' + out.linked + ' vinculadas' +
      (out.remaining ? ' · faltan ' + out.remaining : ''));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers internos usados por otros módulos                           */
/* ------------------------------------------------------------------ */

// true si hay carpeta raíz configurada (sólo propiedades: rápido, sirve para el bundle)
function driveConfigured_() {
  return !!driveRootId_();
}

// Asegura la carpeta del proyecto (id 'PRJ-…' u objeto {id, …}): reutiliza la guardada si sigue viva; si no, busca en
// <raíz>/<Pilar> una con el mismo nombre (que no sea de otro proyecto) y si no hay la crea. Guarda su ID en Carpeta.
// → {id, url, name, created} | null si no hay carpeta raíz configurada. Lanza errores en español.
// Llamar FUERA del lock; si quien llama ya tiene el lock, pasar {inLock: true} (escribe la celda sin tomarlo).
// Sin Historial salvo {log: true} (gSave lo llama en cada proyecto nuevo: la carpeta se da por entendida).
function driveEnsureFolder_(project, opts) {
  const r = driveEnsure_(project, opts || {});
  if (!r) return null;
  return Object.assign(driveInfo_(r.folder), { created: r.created });
}

// Después de guardar un proyecto: renombra su carpeta y, si cambió de pilar, la mueve a la subcarpeta del pilar.
// Sólo la mueve si está en el lugar que administra la app (la raíz o una subcarpeta de pilar de la raíz): una carpeta
// que alguien ordenó a mano en otro lugar se respeta. Mejor esfuerzo: nunca lanza. → {renamed, moved} | null
function driveSyncFolder_(project) {
  if (!featureOn_('DRIVE')) return null; // modo seguro
  try {
    if (project && typeof project === 'object' && 'carpeta' in project && !str_(project.carpeta)) return null; // sin carpeta
    const p = driveProjectArg_(project, null);
    if (!p || !p.carpeta) return null;
    const folder = driveTryFolder_(p.carpeta);
    if (!folder) return null;
    const out = { renamed: false, moved: false };
    const want = driveFolderName_(p.nombre);
    const cur = str_(folder.getName());
    if (cur !== want && cur !== want + ' (' + p.id + ')') {
      folder.setName(want);
      out.renamed = true;
    }
    const rootId = driveRootId_();
    if (!rootId) return out;
    const ctx = driveCtx_([p]);
    const root = driveRootFolder_(ctx);
    const label = drivePillarLabel_(p.pilar);
    const labels = CONFIG.PILLARS.map(x => x.label).concat(['Sin pilar']);
    let managed = false;
    let inPlace = false;
    const it = folder.getParents();
    while (it.hasNext()) {
      const par = it.next();
      if (par.getId() === root.getId()) { managed = true; continue; }
      const pn = str_(par.getName());
      if (labels.indexOf(pn) >= 0 && driveHasParent_(par, root.getId())) {
        managed = true;
        if (pn === label) inPlace = true;
      }
    }
    if (managed && !inPlace) {
      folder.moveTo(driveTargetParent_(p, ctx));
      out.moved = true;
    }
    return out;
  } catch (e) {
    console.error('driveSyncFolder_: no se pudo ordenar la carpeta del proyecto: ' + ((e && e.message) || e));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Núcleo                                                              */
/* ------------------------------------------------------------------ */

// → {folder, created, linked} | null (sin raíz). opts: {ctx | projects (ya leídos), inLock, log (Historial al crear)}
function driveEnsure_(project, opts) {
  const o = opts || {};
  // Sin carpeta raíz y sin carpeta guardada no hay nada que hacer (gSave llama esto en cada proyecto nuevo: sin leer la hoja)
  if (!o.ctx && !driveRootId_() && project && typeof project === 'object' && 'carpeta' in project && !str_(project.carpeta)) return null;
  const list = o.ctx ? o.ctx.projects : (o.projects || driveProjects_());
  const p = driveProjectArg_(project, { projects: list });
  if (!p) throw driveFail_('No encontré el proyecto (¿lo eliminaron?). Actualiza los datos.');
  try {
    // 1) La carpeta guardada, si sigue disponible
    let bad = '';
    if (p.carpeta) {
      const f = driveTryFolder_(p.carpeta);
      if (f) return { folder: f, created: false, linked: false };
      bad = p.carpeta;
    }
    // 2) <raíz>/<Pilar>/<Proyecto>: reutiliza una carpeta con el mismo nombre que no sea de otro proyecto
    const ctx = o.ctx || driveCtx_(list);
    const parent = driveTargetParent_(p, ctx);
    if (!parent) return null;
    const base = driveFolderName_(p.nombre);
    const same = driveChildren_(parent, base);
    let folder = driveFree_(same, ctx, p.id);
    let created = false;
    if (!folder) {
      // Mismo nombre que la carpeta de otro proyecto → se distingue con el ID
      const name = same.length ? base + ' (' + p.id + ')' : base;
      if (name !== base) folder = driveFree_(driveChildren_(parent, name), ctx, p.id);
      if (!folder) {
        folder = parent.createFolder(name);
        created = true;
      }
    }
    // 3) Guarda el ID (único paso con lock)
    const fid = folder.getId();
    const store = expected => (o.inLock ? driveStoreId_(p.id, fid, expected) : withLock_(() => driveStoreId_(p.id, fid, expected)));
    let res = store(bad);
    if (res.current) {
      // Otra persona vinculó una carpeta a este proyecto al mismo tiempo: se usa la suya (si sirve)
      const other = driveTryFolder_(res.current);
      if (other) {
        if (created) driveTrashQuiet_(folder);
        return { folder: other, created: false, linked: false };
      }
      res = store(res.current);
    }
    if (res.gone || res.current) {
      if (created) driveTrashQuiet_(folder);
      throw driveFail_('No encontré el proyecto (¿lo eliminaron?). Actualiza los datos.');
    }
    ctx.taken[fid] = p.id;
    p.carpeta = fid;
    if (created && o.log) {
      const det = drivePillarLabel_(p.pilar) + ' / ' + str_(folder.getName());
      if (o.inLock) log_('Crear carpeta de Drive', p.nombre, det); else driveLog_('Crear carpeta de Drive', p.nombre, det);
    }
    return { folder: folder, created: created, linked: !created };
  } catch (e) {
    if (e && e.driveFriendly) throw e;
    if (e && /^La hoja está ocupada/.test(String(e.message))) throw e; // withLock_ (ya es un mensaje amable)
    throw driveFail_(driveErrMsg_(e, 'la carpeta del proyecto'));
  }
}

// Dentro del lock: vuelve a leer la celda Carpeta y la escribe. → {ok} | {gone} | {current: idDeOtraEjecución}
// expected = ID guardado que se vio antes (vacío o una carpeta que ya no sirve) y que se puede reemplazar.
function driveStoreId_(projectId, folderId, expected) {
  const p = driveProjects_().find(x => x.id === projectId);
  if (!p) return { gone: true };
  if (p.carpeta === folderId) return { ok: true };
  if (p.carpeta && p.carpeta !== str_(expected)) return { current: p.carpeta };
  if (typeof gSetProjectFolder_ === 'function') gSetProjectFolder_(projectId, folderId);
  else driveWriteCell_(projectId, folderId);
  return { ok: true };
}

// Respaldo si Gestion.gs no expone gSetProjectFolder_: escribe la celda Carpeta (agrega la columna si falta).
// Dentro del lock. No toca "Actualizado" (un formulario abierto no debe ver un conflicto por esto).
function driveWriteCell_(projectId, folderId) {
  const ss = ss_();
  const sh = typeof gSheet_ === 'function' ? gSheet_(ss) : ss.getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return false;
  const lastCol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_);
  const jId = head.indexOf('id');
  if (jId < 0) return false;
  let j = head.indexOf('carpeta');
  if (j < 0) {
    if (lastCol + 1 > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, lastCol + 1).setValue('Carpeta').setFontWeight('bold');
    j = lastCol;
  }
  const ids = sh.getRange(2, jId + 1, sh.getLastRow() - 1, 1).getValues();
  for (let k = 0; k < ids.length; k++) {
    if (str_(ids[k][0]) === projectId) {
      sh.getRange(k + 2, j + 1).setNumberFormat('@').setValue(folderId);
      return true;
    }
  }
  return false;
}

// Proyectos leídos directo de la pestaña Gestión (sólo lectura) → [{id, pilar, nombre, carpeta}]
function driveProjects_() {
  const sh = ss_().getSheetByName(CONFIG.GESTION_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues();
  const ix = headerIndex_(vals[0], ['ID', 'Tipo', 'Pilar', 'Nombre', 'Carpeta']);
  if (ix.ID < 0 || ix.Tipo < 0) return [];
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (norm_(r[ix.Tipo]) !== 'proyecto') continue;
    const id = str_(r[ix.ID]);
    if (!id) continue;
    out.push({
      id: id,
      pilar: ix.Pilar >= 0 ? pillarKey_(r[ix.Pilar]) : '',
      nombre: ix.Nombre >= 0 ? (typeof gUnq_ === 'function' ? gUnq_(r[ix.Nombre]) : str_(r[ix.Nombre])) : '',
      carpeta: ix.Carpeta >= 0 ? driveCellId_(r[ix.Carpeta]) : '',
    });
  }
  return out;
}

// Celda Carpeta → ID (también si alguien pegó el enlace a mano). Misma regla que Gestion.gs cuando está.
function driveCellId_(v) {
  const s = str_(v);
  if (!s) return '';
  if (typeof gFolderId_ === 'function') return gFolderId_(s);
  return driveParseId_(s) || (/^[\w-]{1,200}$/.test(s) ? s : '');
}

// 'PRJ-…' u objeto {id} → proyecto normalizado (datos frescos de la hoja) | null
function driveProjectArg_(project, ctx) {
  const id = str_(project && typeof project === 'object' ? project.id : project);
  if (!id) return null;
  const list = ctx && ctx.projects ? ctx.projects : driveProjects_();
  return list.find(x => x.id === id) || null;
}

function driveProjectOrThrow_(projectId, list) {
  const id = str_(projectId);
  if (!id) throw new Error('Falta indicar el proyecto.');
  const p = driveProjectArg_(id, list ? { projects: list } : null);
  if (!p) throw new Error('No encontré el proyecto (¿lo eliminaron?). Actualiza los datos.');
  return p;
}

// Contexto para varias llamadas seguidas: proyectos, carpetas ya tomadas y carpetas abiertas (raíz y pilares)
function driveCtx_(projects) {
  const list = projects || driveProjects_();
  const taken = {};
  list.forEach(x => { if (x.carpeta) taken[x.carpeta] = x.id; });
  return { projects: list, taken: taken, root: undefined, pillars: {} };
}

// Carpeta raíz abierta (cacheada en ctx) | null si no está configurada. Sin acceso / en la papelera → error amable.
function driveRootFolder_(ctx) {
  if (ctx.root !== undefined) return ctx.root;
  const id = driveRootId_();
  if (!id) { ctx.root = null; return null; }
  let f;
  try {
    f = driveOpenFolder_(id, 'la carpeta del equipo');
  } catch (e) {
    e.driveRoot = true;
    throw e;
  }
  if (driveTrashed_(f)) {
    const err = driveFail_('La carpeta del equipo está en la papelera de Drive. Restáurala o conecta otra en Ajustes.');
    err.driveRoot = true;
    throw err;
  }
  ctx.root = f;
  return f;
}

// <raíz>/<Pilar> (la busca por nombre o la crea) | null si no hay raíz
function driveTargetParent_(p, ctx) {
  const root = driveRootFolder_(ctx);
  if (!root) return null;
  const label = drivePillarLabel_(p.pilar);
  if (!ctx.pillars[label]) ctx.pillars[label] = driveChildren_(root, label)[0] || root.createFolder(label);
  return ctx.pillars[label];
}

// Subcarpetas (fuera de la papelera) con ese nombre exacto
function driveChildren_(parent, name) {
  const out = [];
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (!driveTrashed_(f)) out.push(f);
  }
  return out;
}

// Primera carpeta de la lista que no esté vinculada a otro proyecto
function driveFree_(folders, ctx, projectId) {
  return folders.find(f => {
    const owner = ctx.taken[f.getId()];
    return !owner || owner === projectId;
  }) || null;
}

function driveHasParent_(item, parentId) {
  const it = item.getParents();
  while (it.hasNext()) if (it.next().getId() === parentId) return true;
  return false;
}

// Carpeta por ID | null si no existe, no hay acceso o está en la papelera. Otros errores (cuota, red) → error amable.
function driveTryFolder_(id) {
  if (!str_(id)) return null;
  try {
    const f = DriveApp.getFolderById(str_(id));
    return driveTrashed_(f) ? null : f;
  } catch (e) {
    if (driveIsMissing_(e)) return null;
    throw driveFail_(driveErrMsg_(e, 'la carpeta del proyecto'));
  }
}

// Abre una carpeta o lanza un error amable (sin acceso, inexistente, Drive no responde)
function driveOpenFolder_(id, what) {
  try {
    const f = DriveApp.getFolderById(id);
    f.getName(); // fuerza la verificación de acceso
    return f;
  } catch (e) {
    throw driveFail_(driveErrMsg_(e, what));
  }
}

function driveTrashed_(item) {
  try { return !!item.isTrashed(); } catch (e) { return false; }
}

function driveTrashQuiet_(folder) {
  try { folder.setTrashed(true); } catch (e) { console.error('driveTrashQuiet_: ' + ((e && e.message) || e)); }
}

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */

// Subcarpetas y archivos (fuera de la papelera), más nuevos primero, máx. DRIVE_LIMITS.listMax
function driveEntries_(folder) {
  const list = [];
  let seen = 0;
  const add = (it, isFolder) => {
    while (it.hasNext() && seen < DRIVE_LIMITS.scanMax) {
      const x = it.next();
      seen++;
      try {
        if (driveTrashed_(x)) continue;
        list.push(driveEntry_(x, isFolder));
      } catch (e) {
        console.error('driveEntries_: se omitió un elemento: ' + ((e && e.message) || e));
      }
    }
  };
  add(folder.getFolders(), true);
  add(folder.getFiles(), false);
  list.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.name.localeCompare(b.name, 'es')));
  return list.slice(0, DRIVE_LIMITS.listMax);
}

// Archivo o carpeta → {id, name, mimeType, size, updated (ISO), url, kind}. Nunca un Date.
function driveEntry_(x, isFolder) {
  const id = str_(x.getId());
  const mimeType = isFolder ? DRIVE_FOLDER_MIME : (str_(x.getMimeType()) || 'application/octet-stream');
  return {
    id: id,
    name: str_(x.getName()),
    mimeType: mimeType,
    size: isFolder ? 0 : (Number(x.getSize()) || 0),
    updated: iso_(x.getLastUpdated()),
    url: str_(x.getUrl()) || (isFolder ? DRIVE_FOLDER_URL + id : 'https://drive.google.com/file/d/' + id + '/view'),
    kind: driveKind_(mimeType),
  };
}

function driveInfo_(folder) {
  const id = str_(folder.getId());
  return { id: id, name: str_(folder.getName()), url: str_(folder.getUrl()) || DRIVE_FOLDER_URL + id };
}

// Tipo para el ícono: image | pdf | doc | sheet | slide | folder | video | file
function driveKind_(mimeType) {
  const m = str_(mimeType).toLowerCase();
  if (m === DRIVE_FOLDER_MIME) return 'folder';
  if (/^image\//.test(m) || m === 'application/vnd.google-apps.photo' || m === 'application/vnd.google-apps.drawing') return 'image';
  if (/^video\//.test(m) || m === 'application/vnd.google-apps.video') return 'video';
  if (m === 'application/pdf') return 'pdf';
  if (/spreadsheet|ms-excel|^text\/csv$|^text\/tab-separated-values$/.test(m)) return 'sheet';
  if (/presentation|ms-powerpoint/.test(m)) return 'slide';
  if (/google-apps\.document|msword|wordprocessingml|opendocument\.text|^application\/rtf$|^text\/(plain|rtf|markdown)$/.test(m)) return 'doc';
  return 'file';
}

/* ------------------------------------------------------------------ */
/* Nombres, enlaces y mensajes                                         */
/* ------------------------------------------------------------------ */

function driveRootId_() {
  if (!featureOn_('DRIVE')) return ''; // modo seguro: sin Drive
  try {
    return str_(PropertiesService.getScriptProperties().getProperty(DRIVE_PROP));
  } catch (e) {
    return '';
  }
}

// Enlace de carpeta o ID → ID ('' si no se reconoce). Acepta /drive/folders/<id>, /drive/u/0/folders/<id>,
// /drive/mobile/folders/<id>, ?id=<id> (open, folderview) y un ID suelto.
function driveParseId_(v) {
  const s = str_(v);
  if (!s) return '';
  let m = s.match(/^https?:\/\/drive\.google\.com\/(?:a\/[^\/?#]+\/)?(?:drive\/)?(?:u\/\d+\/)?(?:mobile\/)?folders\/([A-Za-z0-9_-]{10,})(?:[\/?#]|$)/i);
  if (m) return m[1];
  m = s.match(/^https?:\/\/drive\.google\.com\/(?:a\/[^\/?#]+\/)?(?:open|folderview|drive\/folderview)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})(?:[&#]|$)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}

function drivePillarLabel_(key) {
  const p = CONFIG.PILLARS.find(x => x.key === pillarKey_(key));
  return p ? p.label : 'Sin pilar';
}

// Nombre de carpeta de un proyecto: sin caracteres de control ni / \, espacios simples, ≤ 120
function driveFolderName_(nombre) {
  const s = String(nombre == null ? '' : nombre).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[\/\\]+/g, '-')
    .replace(/\s+/g, ' ').trim().slice(0, DRIVE_LIMITS.folderMax).trim();
  return s || 'Proyecto sin nombre';
}

// Nombre de archivo subido: sin / \ ni caracteres de control (ni los puntos iniciales que deja un "../"),
// conserva la extensión, ≤ 180
function driveFileName_(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f\/\\]+/g, '').replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '').trim();
  const m = /(\.[A-Za-z0-9]{1,10})$/.exec(s);
  const ext = m ? m[1] : '';
  let base = s.slice(0, s.length - ext.length).trim();
  if (base.length + ext.length > DRIVE_LIMITS.nameMax) base = base.slice(0, DRIVE_LIMITS.nameMax - ext.length).trim();
  if (!base || /^\.+$/.test(base)) base = 'Archivo';
  return base + ext;
}

// mimeType enviado (si es válido) → por extensión → application/octet-stream
function driveMime_(mimeType, name) {
  const m = str_(mimeType).toLowerCase();
  if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) && m !== 'application/octet-stream' &&
    m.indexOf('application/vnd.google-apps.') !== 0) return m;
  const ext = (/\.([A-Za-z0-9]{1,10})$/.exec(str_(name)) || [])[1];
  return (ext && DRIVE_EXT_MIME[ext.toLowerCase()]) || 'application/octet-stream';
}

function driveSize_(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

function driveTooBig_(name, n) {
  return 'El archivo "' + name + '" pesa ' + driveSize_(n) + ' y el máximo es ' + Math.round(DRIVE_LIMITS.maxBytes / 1048576) +
    ' MB. Súbelo directo a la carpeta de Drive del proyecto.';
}

function driveNotConfigured_() {
  return 'Falta conectar la carpeta de Drive del equipo: un administrador la configura en Ajustes.';
}

// Cuenta con la que corre la app (dueña de los archivos creados)
function driveOwner_() {
  let e = '';
  try { e = str_(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (err) { e = ''; }
  return e || str_(CONFIG.ADMINS[0]).toLowerCase();
}

function driveNoAccess_(what) {
  const owner = driveOwner_();
  return 'No tengo acceso a ' + (what || 'esa carpeta') + '. Compártela con la cuenta de ' + userName_(owner) + ' (' + owner +
    ') como editor, o revisa el enlace.';
}

// Id inexistente o sin permiso (no vale la pena reintentar)
function driveIsMissing_(e) {
  return /no item with the given id|not found|could not be found|do not have permission|don't have permission|permission denied|access denied|forbidden|insufficient permission|invalid argument: id/i
    .test(String((e && e.message) || e));
}

// Error de Drive → mensaje en español
function driveErrMsg_(e, what) {
  const m = String((e && e.message) || e || '').replace(/^Exception:\s*/, '');
  if (e && e.driveFriendly) return m;
  if (driveIsMissing_(e)) return driveNoAccess_(what);
  if (/too many times|rate limit|quota|limit exceeded|backend error|internal error|timed? ?out|unavailable|try again|server error/i.test(m)) {
    return 'Google Drive no respondió a tiempo. Intenta de nuevo en un minuto.';
  }
  return 'No pude completar la operación en Google Drive: ' + m;
}

function driveFail_(msg) {
  const e = new Error(msg);
  e.driveFriendly = true;
  return e;
}

// Historial con lock (para llamar fuera del lock). Nunca lanza.
function driveLog_(accion, entidad, detalle) {
  try {
    withLock_(() => log_(accion, entidad, detalle));
  } catch (e) {
    console.error('driveLog_: ' + ((e && e.message) || e));
  }
}
