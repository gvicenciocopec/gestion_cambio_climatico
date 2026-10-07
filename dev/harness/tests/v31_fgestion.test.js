/* v3.1 · FGestion (SPEC §14): pestaña «Drive» del proyecto (estados, caché, subida con cola y límite de 20 MB),
   «Subir archivo» en el editor de links (agrega {t, u}), base64 sin prefijo, alta rápida con pickDate después de
   Enter (§14.2) y menos texto en pantalla (§14.4). Las funciones del cliente se extraen del .html y corren con las
   reales de Core y stubs de red / DOM; la subida y el link se prueban también contra Drive.gs (MOCK.drive). */
(function () {
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  function skipRegex(code, k) {
    var p = k - 1;
    while (p >= 0 && /\s/.test(code[p])) p--;
    if (p >= 0 && !/[(,=:[!&|?{};+\-*%<>~^]/.test(code[p]) && !/\breturn$/.test(code.slice(Math.max(0, p - 6), p + 1))) return -1;
    var cls = false;
    for (var j = k + 1; j < code.length; j++) {
      var c = code[j];
      if (c === '\\') { j++; continue; }
      if (c === '\n') return -1;
      if (cls) { if (c === ']') cls = false; continue; }
      if (c === '[') { cls = true; continue; }
      if (c === '/') return j;
    }
    return -1;
  }
  function block(code, start, label) {
    var i = code.indexOf(start);
    ok(i >= 0, 'no encontré «' + (label || start) + '»');
    var j = code.indexOf('{', i), depth = 0, q = null;
    for (var k = j; k < code.length; k++) {
      var ch = code[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '/' && code[k + 1] === '/') { var nl = code.indexOf('\n', k); k = nl < 0 ? code.length : nl; continue; }
      if (ch === '/') { var e = skipRegex(code, k); if (e > 0) { k = e; continue; } }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return code.slice(i, k + 1);
    }
    __fail('bloque sin cerrar: ' + (label || start));
  }
  function fn(code, name) { return block(code, 'function ' + name + '(', name); }
  function constDecl(code, name) {
    var i = code.indexOf('const ' + name + ' = ');
    ok(i >= 0, 'no encontré const ' + name);
    var depth = 0, q = null;
    for (var k = i + 6 + name.length; k < code.length; k++) {
      var ch = code[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '/' && code[k + 1] === '/') { var nl = code.indexOf('\n', k); k = nl < 0 ? code.length : nl; continue; }
      if (ch === '/') { var e = skipRegex(code, k); if (e > 0) { k = e; continue; } }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
      else if (ch === ';' && depth === 0) return code.slice(i, k + 1);
    }
    __fail('const sin cerrar: ' + name);
  }

  var CORE_CONSTS = ['MESES', 'TONES', 'AVATAR_TONES', 'CLASE_META', 'BTN_VARIANTS', 'CX'];
  var CORE_FNS = ['esc', 'safeUrl', 'pad2', 'ymd', 'todayStr', 'parseYmd', 'addDays', 'daysUntil', 'fmtDate', 'fmtDateShort', 'fmtRel', 'fmtDateTime',
    'pct', 'plural', 'normTxt', 'kebab', 'dataAttrs', 'tone', 'icon', 'badge', 'btn', 'iconBtn', 'skeleton', 'emptyState', 'progress', 'checkButton',
    'PIL', 'dueInfo', 'userObj', 'userName', 'userColor', 'initials', 'avatar', 'taskPeople', 'avatarStack', 'cascadeLabel', 'myEmail', 'shortUrl', 'evidenceIcon', 'evidenceChip',
    'errMsg', 'linkify', 'fmtNum', 'fmtMoney', 'fmtCompact'];
  var FG_CONSTS = ['FG_STATE', 'FG_DIAS', 'FG_SOFT', 'FG_TABS', 'FG_DRIVE_MAX', 'FG_DRIVE_TTL', 'FG_DRIVE_KIND', 'FG_EV_NAMES', 'FG_RED', 'FG_EV_BTN'];
  var FG_FNS = ['fgUi', 'fgPilarKey', 'fgCleanEv', 'fgClip', 'fgMuted', 'fgSection', 'fgLinkBtn', 'fgSoftChip', 'fgPillarChip', 'fgWeekday', 'fgRelDays',
    'fgWhen', 'fgCheck', 'fgDueChip', 'fgCascadeChip', 'fgAvisar', 'fgPrivada', 'taskRow', 'fgByDue', 'fgByDoneDesc', 'fgCmpStr', 'fgProjectTasks', 'fgIsTmp',
    'fgProjCascade', 'fgTile', 'fgCascadeDetail', 'fgPlazoHtml', 'fgProjectSummary', 'cascadePickerHtml', 'fgCpkTriggerInner', 'fgCpkListHtml', 'fgCpkOption',
    'fgDriveCache', 'fgDriveGet', 'fgDriveEntry', 'fgDriveIsOff', 'fgDriveTooBig', 'fgBytes', 'fgDriveBigMsg', 'fgDriveFolderUrl', 'fgStripB64',
    'fgDriveOn', 'fgReadB64', 'fgDriveSend', 'fgDriveAdded', 'fgDriveLoad', 'fgDriveEnsure', 'fgDrivePaint', 'fgDrivePanel', 'fgDriveOffHtml', 'fgDriveFileRow',
    'fgDriveUploadsHtml', 'fgDriveBody', 'fgDriveUpload', 'fgDriveWork', 'fgQuickText', 'fgQuickAdd', 'fgCmpRoot', 'fgCmpMoreSummary', 'fgEvRow',
    'fgEvIconHtml', 'evidenceEditorHtml', 'fgEvProject', 'fgEvSyncUpload', 'fgEvBlank', 'fgEvFromUpload', 'fgEvPendingRow', 'fgEvPlace', 'fgEvUpload',
    'fgEvEditor', 'readEvidence', 'fgCheckEvidence', 'fgFixUrl', 'fgEvAutoTitle'];
  var FG_ACTIONS = ["action('project.quickadd'", "action('task.redate'", "action('project.drive.refresh'", "action('project.drive.dismiss'",
    "action('project.drive.folder'"];

  var PID = 'PRJ-00000001';
  var USERS = [{ email: U.ina, name: 'Ina', color: 'violet' }, { email: U.benja, name: 'Benja', color: 'sky' },
    { email: U.ignacio, name: 'Ignacio', color: 'amber' }, { email: U.gonzalo, name: 'Gonzalo', color: 'emerald' }];
  var PILLARS = [{ key: 'cc', area: 'Cambio Climatico', label: 'Cambio Climático', icon: 'cloud-sun', color: 'sky' },
    { key: 'ec', area: 'Economia Circular', label: 'Economía Circular', icon: 'recycle', color: 'amber' },
    { key: 'nat', area: 'Naturaleza', label: 'Naturaleza', icon: 'leaf', color: 'emerald' }];

  // Entorno del cliente: Core real + FGestion real; red (run / mutate), pickDate, FileReader y DOM controlados.
  function env(o) {
    o = o || {};
    var st = { calls: [], net: [], toasts: [], mutates: [], picks: [], refresh: 0, optimistic: [], forms: [], els: {}, actions: {}, drawerKey: o.drawerKey || null };
    var projects = o.projects || [{ id: PID, pilar: 'nat', nombre: 'Humedal El Bato', estado: 'Activo', resp: U.ina, lineas: [], evidencias: [], cascade: '' }];
    var tasks = o.tasks || [];
    var S = { me: { email: U.gonzalo, name: 'Gonzalo', admin: o.admin !== false }, users: USERS, pillars: PILLARS, config: { alertDays: 7, notifyDays: 3 },
      projects: projects, tasks: tasks, ui: {}, route: { params: {} } };
    var IDX = { project: new Map(projects.map(function (p) { return [p.id, p]; })), task: new Map(tasks.map(function (t) { return [t.id, t]; })),
      cascade: new Map(), commentsByRef: new Map(), tasksByProject: new Map(), line: new Map(), lineProject: new Map(), cascadeGroups: {}, cascadeChildren: new Map() };
    tasks.forEach(function (t) { if (!t.proyecto) return; if (!IDX.tasksByProject.has(t.proyecto)) IDX.tasksByProject.set(t.proyecto, []); IDX.tasksByProject.get(t.proyecto).push(t); });
    var stubs = {
      S: S, IDX: IDX,
      LS: { get: function (k, d) { return d; }, set: function () {} },
      run: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        st.calls.push({ fn: name, args: MOCK.strictClone(args, name + '(argumentos)') });
        return new Promise(function (res, rej) { st.net.push({ fn: name, args: args, res: res, rej: rej }); });
      },
      toast: function (m, type) { st.toasts.push([m, type || 'success']); },
      refreshIcons: function () {},
      isAdminUI: function () { return o.adminUI !== false; },
      mutate: function (name, args, opts) {
        st.mutates.push({ fn: name, args: MOCK.strictClone(args, name), opts: opts || {} });
        return Promise.resolve(o.mutateFail ? null : { partial: 'gestion', loadedAt: 'x' });
      },
      pickDate: o.noPick ? undefined : function (el, opts) { return new Promise(function (res) { st.picks.push({ el: el, opts: opts, res: res }); }); },
      todoParse: o.todoParse,
      currentDrawerKey: function () { return st.drawerKey; },
      refreshDrawer: function () { st.refresh++; },
      optimistic: function (apply, name, args) { apply(); st.optimistic.push({ fn: name, args: MOCK.strictClone(args, name) }); return Promise.resolve({ partial: 'gestion' }); },
      openTaskForm: function (x) { st.forms.push(x); },
      closeDrawer: function () {}, go: function () {},
      document: { getElementById: function (id) { return st.els[id] || null; }, querySelector: function () { return null; } },
      FileReader: function () {
        var self = this;
        this.readAsDataURL = function (f) {
          Promise.resolve().then(function () {
            if (f && f.unreadable) { if (self.onerror) self.onerror(); return; }
            self.result = 'data:' + ((f && f.type) || '') + ';base64,' + ((f && f.b64) || 'AAAA');
            if (self.onload) self.onload();
          });
        };
      },
      action: function (name, f) { st.actions[name] = f; },
    };
    var names = Object.keys(stubs);
    var core = src('Core'), fg = src('FGestion');
    var body = CORE_CONSTS.map(function (c) { return constDecl(core, c); }).join('\n') + '\n' +
      CORE_FNS.map(function (n) { return fn(core, n); }).join('\n') + '\n' +
      FG_CONSTS.map(function (c) { return constDecl(fg, c); }).join('\n') + '\n' +
      FG_FNS.map(function (n) { return fn(fg, n); }).join('\n') + '\n' +
      FG_ACTIONS.map(function (a) { return block(fg, a) + ');'; }).join('\n') + '\n' +
      'return {' + FG_FNS.join(',') + ', FG_STATE: FG_STATE, FG_TABS: FG_TABS, FG_DRIVE_MAX: FG_DRIVE_MAX };';
    var api = new Function(names.join(','), body).apply(null, names.map(function (k) { return stubs[k]; }));
    api.st = st; api.S = S; api.IDX = IDX;
    api.flush = function () { drainMicrotasks(); drainMicrotasks(); };
    // Responde la llamada pendiente más antigua de `name` (ok o error) y deja correr las promesas
    api.respond = function (name, value, isError) {
      var i = st.net.findIndex(function (x) { return x.fn === name; });
      ok(i >= 0, 'no hay una llamada pendiente a ' + name);
      var c = st.net.splice(i, 1)[0];
      if (isError) c.rej(new Error(value)); else c.res(value);
      api.flush();
      return c;
    };
    api.count = function (name) { return st.calls.filter(function (c) { return c.fn === name; }).length; };
    return api;
  }
  function file(name, size, type, b64) { return { name: name, size: size, type: type || '', b64: b64 }; }

  // DOM mínimo para el editor de links: nodos con su HTML; los inputs se leen del HTML de cada fila.
  function FakeNode(html, parent, dataset) { this.html = html; this.parentNode = parent || null; this.children = []; this.dataset = dataset || {}; }
  FakeNode.prototype.matches = function (sel) {
    var m = String(sel).match(/^\[([\w-]+)\]$/);
    return !!m && new RegExp('^<\\w+ ' + m[1] + '(?=[\\s>=])').test(this.html);
  };
  FakeNode.prototype.closest = function () { return null; };
  FakeNode.prototype.querySelectorAll = function (sel) {
    var out = [], m = String(sel).match(/^\[([\w-]+)\]$/);
    (function walk(n) { n.children.forEach(function (c) { if (c.matches(sel)) out.push(c); walk(c); }); })(this);
    if (!out.length && m && /^data-ev-[ut]$/.test(m[1])) {
      var r = new RegExp('<input[^>]*\\b' + m[1] + '\\b[^>]*\\bvalue="([^"]*)"').exec(this.html);
      if (r) out.push({ value: r[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'") });
    }
    return out;
  };
  FakeNode.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  FakeNode.prototype.insertAdjacentHTML = function (pos, html) {
    if (pos === 'beforeend') { this.children.push(new FakeNode(html, this)); return; }
    if (pos === 'beforebegin') { var p = this.parentNode; p.children.splice(p.children.indexOf(this), 0, new FakeNode(html, p)); return; }
    __fail('insertAdjacentHTML ' + pos + ' no emulado');
  };
  FakeNode.prototype.remove = function () {
    var p = this.parentNode;
    if (!p) return;
    var i = p.children.indexOf(this);
    if (i >= 0) p.children.splice(i, 1);
    this.parentNode = null;
  };
  Object.defineProperty(FakeNode.prototype, 'lastElementChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  function fakeEditor(E, list, project) {
    var ed = new FakeNode('<div data-ev-editor data-name="evidencias">', null, { name: 'evidencias', project: project || '' });
    var rows = new FakeNode('<div data-ev-rows class="space-y-2">', ed);
    ed.children.push(rows);
    var evs = E.fgCleanEv(list || []);
    (evs.length ? evs : [{}]).forEach(function (e) { rows.children.push(new FakeNode(E.fgEvRow(e), rows)); });
    return { ed: ed, rows: rows };
  }

  test('v31 fgestion · pestaña Drive justo después de Comentarios (ícono hard-drive) y sin conteos en cero', function () {
    var E = env();
    deepEq(E.FG_TABS, ['resumen', 'tareas', 'presupuesto', 'comentarios', 'drive']);
    var dr = fn(src('FGestion'), 'fgProjectDrawer');
    ok(dr.indexOf("value: 'comentarios'") < dr.indexOf("value: 'drive', label: 'Drive', icon: 'hard-drive'"), 'Drive va después de Comentarios');
    ok(/tab === 'drive' && fgDriveOn\(\)\) \{ fgDriveEnsure\(p\.id\); content = fgDrivePanel\(p\); \}/.test(dr), 'al abrir la pestaña: pide la lista (con caché) y dibuja el panel (sólo si Drive está activo)');
    ok(/count: st\.pending \|\| null/.test(dr) && /count: nCom \|\| null/.test(dr), 'sin «0» en las pestañas');
  });

  test('v31 fgestion · Drive: estados (cargando, sin configurar admin / equipo, sin carpeta, vacía, con archivos, error)', function () {
    var E = env();
    var p = E.IDX.project.get(PID);
    var h = E.fgDriveBody(p);
    ok(h.indexOf('aria-busy="true"') >= 0 && h.indexOf('skeleton') >= 0, 'sin caché: esqueleto');
    var panel = E.fgDrivePanel(p);
    ok(panel.indexOf('data-fg-drive="' + PID + '"') >= 0 && panel.indexOf('data-fg-drop="' + PID + '"') >= 0, 'panel repintable y zona para soltar');
    // Sin carpeta raíz
    var e = E.fgDriveEntry(PID);
    e.status = 'off';
    h = E.fgDriveBody(p);
    ok(h.indexOf('Configura la carpeta raíz en Ajustes') >= 0 && h.indexOf('data-action="project.drive.setup"') >= 0, 'admin: botón a Ajustes');
    var team = env({ adminUI: false });
    team.fgDriveEntry(PID).status = 'off';
    var ht = team.fgDriveBody(team.IDX.project.get(PID));
    ok(ht.indexOf('project.drive.setup') < 0 && ht.indexOf('Configura') < 0, 'equipo (o Gonzalo con «Ver como admin» apagado): sin botón');
    ok(/^<p[^>]*>Drive aún no está conectado a la app\.<\/p>$/.test(ht), 'equipo: una sola línea discreta');
    // Configurado, sin carpeta y sin archivos
    e.status = 'ok'; e.data = { folder: null, files: [] }; e.at = Date.now();
    h = E.fgDriveBody(p);
    ok(h.indexOf('data-action="project.drive.folder"') >= 0 && h.indexOf('Crear carpeta') >= 0, 'sin carpeta: «Crear carpeta»');
    ok(h.indexOf('Abrir carpeta') < 0, 'sin carpeta no hay «Abrir carpeta»');
    ok(h.indexOf('data-action="project.drive.choose"') >= 0 && h.indexOf('Subir archivos') >= 0, 'botón «Subir archivos»');
    ok(h.indexOf('Arrastra archivos aquí') >= 0 && h.indexOf('Hasta 20 MB por archivo') >= 0, 'vacía: la zona para soltar es la invitación');
    e.creating = true;
    ok(/data-action="project\.drive\.folder"[^>]*disabled/.test(E.fgDriveBody(p)) && E.fgDriveBody(p).indexOf('Creando…') >= 0, 'creando: botón deshabilitado');
    e.creating = false;
    // carpetaUrl del proyecto como respaldo
    p.carpetaUrl = 'https://drive.google.com/drive/folders/1Proyecto';
    ok(E.fgDriveBody(p).indexOf('href="https://drive.google.com/drive/folders/1Proyecto"') >= 0, '«Abrir carpeta» con project.carpetaUrl');
    p.carpetaUrl = '';
    // Con archivos
    var now = Date.now();
    e.data = { folder: { id: '1F', name: 'Humedal', url: 'https://drive.google.com/drive/folders/1F' }, files: [
      { id: 'a', name: 'Informe <final>.pdf', kind: 'pdf', size: 1258291, updated: new Date(now - 3 * 3600e3).toISOString(), url: 'https://drive.google.com/file/d/a/view' },
      { id: 'b', name: 'Planilla', kind: 'sheet', size: 0, updated: new Date(now - 5 * 60e3).toISOString(), url: 'https://docs.google.com/spreadsheets/d/b' },
      { id: 'c', name: 'Raro', kind: 'otro', size: 900, updated: '', url: 'javascript:alert(1)' },
    ] };
    h = E.fgDriveBody(p);
    ok(/<a href="https:\/\/drive\.google\.com\/drive\/folders\/1F"[^>]*target="_blank" rel="noopener noreferrer"[^>]*>.*Abrir carpeta/.test(h), '«Abrir carpeta» → folder.url en otra pestaña');
    ok(h.indexOf('Informe &lt;final&gt;.pdf') >= 0 && h.indexOf('<final>') < 0, 'nombres escapados');
    ok(/<a href="https:\/\/drive\.google\.com\/file\/d\/a\/view" target="_blank" rel="noopener noreferrer"/.test(h), 'cada archivo abre su url en otra pestaña');
    ok(h.indexOf('hace 3 h · 1,2 MB') >= 0, 'actualizado (fmtRel) y tamaño');
    ok(h.indexOf('hace 5 min') >= 0 && h.indexOf('hace 5 min · ') < 0, 'documento de Google: sin tamaño');
    ok(h.indexOf('javascript:') < 0 && h.indexOf('>Raro<') >= 0, 'url no http(s): fila sin link');
    ok(h.indexOf('data-lucide="file-text"') >= 0 && h.indexOf('data-lucide="file-spreadsheet"') >= 0 && h.indexOf('data-lucide="file"') >= 0, 'ícono por tipo (desconocido → file)');
    ok(h.indexOf('Arrastra archivos aquí') < 0, 'con archivos no se repite la invitación');
    // Error sin datos previos
    var E2 = env();
    var e2 = E2.fgDriveEntry(PID);
    e2.status = 'error'; e2.data = null; e2.error = 'Google Drive no respondió a tiempo.';
    var he = E2.fgDriveBody(E2.IDX.project.get(PID));
    ok(he.indexOf('No pude cargar los archivos de Drive.') >= 0 && he.indexOf('Google Drive no respondió a tiempo.') >= 0, 'error con su mensaje');
    ok(he.indexOf('data-action="project.drive.refresh"') >= 0 && he.indexOf('Reintentar') >= 0, 'y «Reintentar»');
  });

  test('v31 fgestion · Drive: subidas en curso, en cola y rechazadas por tamaño en la pestaña', function () {
    var E = env();
    var p = E.IDX.project.get(PID);
    var e = E.fgDriveEntry(PID);
    e.status = 'ok'; e.at = Date.now();
    e.data = { folder: { id: '1F', url: 'https://drive.google.com/drive/folders/1F', name: 'X' }, files: [] };
    e.uploads = [
      { uid: 1, name: 'Acta.pdf', size: 2048, status: 'uploading' },
      { uid: 2, name: 'Foto <1>.jpg', size: 500, status: 'queued' },
      { uid: 3, name: 'Video.mov', size: 25 * 1024 * 1024, status: 'error', big: true, error: E.fgDriveBigMsg({ size: 25 * 1024 * 1024 }, true) },
    ];
    var h = E.fgDriveBody(p);
    ok(h.indexOf('data-fg-up="uploading"') >= 0 && h.indexOf('2 KB · Subiendo…') >= 0 && h.indexOf('animate-spin') >= 0, 'subiendo: spinner y tamaño');
    ok(h.indexOf('data-fg-up="queued"') >= 0 && h.indexOf('En cola') >= 0 && h.indexOf('Foto &lt;1&gt;.jpg') >= 0, 'en cola (nombre escapado)');
    ok(h.indexOf('Pesa 25 MB (máx. 20 MB): súbelo directo en la carpeta.') >= 0, 'mensaje amable del límite');
    ok(/súbelo directo en la carpeta\. <a href="https:\/\/drive\.google\.com\/drive\/folders\/1F" target="_blank"[^>]*>Abrir carpeta<\/a>/.test(h), 'sugiere «Abrir carpeta» con el link');
    ok(/data-action="project\.drive\.dismiss" data-id="PRJ-00000001" data-uid="3"/.test(h), 'el error se puede quitar');
    E.st.actions['project.drive.dismiss']({ id: PID, uid: '3' });
    eq(e.uploads.length, 2, 'quitado');
    ok(E.fgDriveBigMsg({ size: 21 * 1024 * 1024 }, false).indexOf('pestaña Drive del proyecto') >= 0, 'desde un editor de links explica dónde está «Abrir carpeta»');
  });

  test('v31 fgestion · Drive: caché por proyecto (no repite en cada redibujo), respuestas viejas, sin configurar y errores', function () {
    var E = env();
    E.fgDriveEnsure(PID);
    eq(E.count('driveList'), 1, 'abrir la pestaña pide la lista');
    deepEq(E.st.calls[0].args, [PID], 'driveList(projectId)');
    E.fgDriveEnsure(PID); E.fgDriveEnsure(PID);
    eq(E.count('driveList'), 1, 'mientras carga, los redibujos no vuelven a pedir');
    E.respond('driveList', { folder: { id: '1F', url: 'https://drive.google.com/drive/folders/1F', name: 'F' }, files: [{ id: 'a', name: 'A', kind: 'pdf', url: 'https://x.cl/a' }], configured: true });
    var e = E.fgDriveGet(PID);
    eq(e.status, 'ok'); eq(e.data.files.length, 1); eq(e.data.folder.id, '1F');
    E.fgDriveEnsure(PID);
    eq(E.count('driveList'), 1, 'con caché fresca no se vuelve a pedir');
    e.at = Date.now() - E.FG_DRIVE_TTL - 1000;
    E.fgDriveEnsure(PID);
    eq(E.count('driveList'), 2, 'caché vencida: se actualiza');
    E.st.actions['project.drive.refresh']({ id: PID });
    eq(E.count('driveList'), 3, '«Actualizar» fuerza otra lectura');
    // Responde primero la vieja (2ª) con otra lista: se ignora; la última manda
    E.respond('driveList', { folder: null, files: [], configured: true });
    eq(e.data.files.length, 1, 'respuesta superada: ignorada');
    E.respond('driveList', { folder: { id: '1F', url: 'https://drive.google.com/drive/folders/1F' }, files: [{ id: 'a' }, { id: 'b' }], configured: true });
    eq(e.data.files.length, 2, 'la más nueva se aplica');
    // Sin carpeta raíz: {configured:false} o el error del servidor
    var E2 = env();
    E2.fgDriveEnsure(PID);
    E2.respond('driveList', { folder: null, files: [], configured: false });
    eq(E2.fgDriveGet(PID).status, 'off', 'configured:false → sin configurar');
    eq(E2.FG_STATE.driveOff, true, 'y se esconde «Subir archivo» en los editores');
    var E3 = env();
    E3.fgDriveEnsure(PID);
    E3.respond('driveList', 'Falta conectar la carpeta de Drive del equipo: un administrador la configura en Ajustes.', true);
    eq(E3.fgDriveGet(PID).status, 'off', 'el error «Falta conectar…» también');
    eq(E3.st.toasts.length, 0, 'sin toast de error por eso');
    var E4 = env();
    E4.fgDriveEnsure(PID);
    E4.respond('driveList', 'Google Drive no respondió a tiempo.', true);
    eq(E4.fgDriveGet(PID).status, 'error');
    eq(E4.fgDriveGet(PID).error, 'Google Drive no respondió a tiempo.');
    E4.fgDriveEnsure(PID);
    eq(E4.count('driveList'), 1, 'un error no se reintenta solo en cada redibujo');
    // Con lista previa, un error conserva lo que había y avisa
    E.st.actions['project.drive.refresh']({ id: PID });
    E.respond('driveList', 'Se cortó la conexión', true);
    eq(e.status, 'ok'); eq(e.data.files.length, 2, 'se conserva la última lista');
    deepEq(E.st.toasts[E.st.toasts.length - 1], ['Se cortó la conexión', 'error']);
  });

  test('v31 fgestion · Drive: «Crear carpeta» usa driveFolder y deja «Abrir carpeta»', function () {
    var E = env();
    var e = E.fgDriveEntry(PID);
    e.status = 'ok'; e.data = { folder: null, files: [] }; e.at = Date.now();
    E.st.actions['project.drive.folder']({ id: PID });
    E.st.actions['project.drive.folder']({ id: PID });
    eq(E.count('driveFolder'), 1, 'un clic a la vez');
    deepEq(E.st.calls[0].args, [PID]);
    E.respond('driveFolder', { id: '1N', url: 'https://drive.google.com/drive/folders/1N', name: 'Humedal El Bato' });
    eq(e.creating, false);
    eq(e.data.folder.url, 'https://drive.google.com/drive/folders/1N');
    ok(E.fgDriveBody(E.IDX.project.get(PID)).indexOf('href="https://drive.google.com/drive/folders/1N"') >= 0, 'ahora «Abrir carpeta»');
    deepEq(E.st.toasts[0], ['Carpeta creada en Drive', 'success']);
  });

  test('v31 fgestion · base64: se quita el prefijo data:…;base64, (FileReader → driveUpload)', function () {
    var E = env();
    eq(E.fgStripB64('data:application/pdf;base64,JVBERi0xLjQ='), 'JVBERi0xLjQ=');
    eq(E.fgStripB64('data:;base64,AAEC'), 'AAEC', 'sin tipo');
    eq(E.fgStripB64('data:image/svg+xml;charset=utf-8;base64,PHN2Zz4='), 'PHN2Zz4=', 'con parámetros');
    eq(E.fgStripB64('QUJD'), 'QUJD', 'sin prefijo queda igual');
    eq(E.fgStripB64(null), '');
    var got = null, err = null;
    E.fgReadB64(file('a.pdf', 10, 'application/pdf', 'JVBER')).then(function (b) { got = b; });
    E.fgReadB64({ name: 'roto.bin', unreadable: true }).then(null, function (x) { err = x; });
    E.flush();
    eq(got, 'JVBER', 'FileReader → base64 limpio');
    ok(err && /No pude leer «roto\.bin»/.test(err.message), 'archivo ilegible: mensaje claro');
    E.fgDriveSend(PID, file('Acta.pdf', 10, 'application/pdf', 'JVBER'));
    E.fgDriveSend(PID, file('sin-tipo', 10, '', 'QUJD'));
    E.flush();
    deepEq(E.st.calls[0], { fn: 'driveUpload', args: [PID, { name: 'Acta.pdf', mimeType: 'application/pdf', base64: 'JVBER' }] });
    eq(E.st.calls[1].args[1].mimeType, 'application/octet-stream', 'sin tipo → octet-stream (el servidor lo deduce por extensión)');
  });

  test('v31 fgestion · Drive: límite de 20 MB y cola de subida (uno a la vez, toast «Subido a Drive», lista fresca)', function () {
    var E = env();
    var MB = 1024 * 1024;
    ok(!E.fgDriveTooBig({ size: 20 * MB }), '20 MB justos: se aceptan');
    ok(E.fgDriveTooBig({ size: 20 * MB + 1 }), 'más de 20 MB: no');
    var e = E.fgDriveEntry(PID);
    e.status = 'ok'; e.at = Date.now(); e.data = { folder: { id: '1F', url: 'https://drive.google.com/drive/folders/1F' }, files: [{ id: 'old', name: 'Viejo' }] };
    E.fgDriveUpload(PID, [file('Acta.pdf', 2048, 'application/pdf', 'QUNUQQ=='), file('Video.mov', 35 * MB, 'video/quicktime'), file('Foto.jpg', 900, 'image/jpeg', 'Rk9UTw==')]);
    E.flush();
    eq(E.count('driveUpload'), 1, 'uno a la vez');
    var big = e.uploads.filter(function (u) { return u.big; })[0];
    ok(big && big.status === 'error' && /Pesa 35 MB \(máx\. 20 MB\)/.test(big.error), 'el de 35 MB no se envía: queda con su mensaje');
    ok(!E.st.calls.some(function (c) { return c.args[1] && c.args[1].name === 'Video.mov'; }), 'nunca llega al servidor');
    deepEq(E.st.calls[0].args, [PID, { name: 'Acta.pdf', mimeType: 'application/pdf', base64: 'QUNUQQ==' }]);
    eq(e.uploads.filter(function (u) { return u.status === 'uploading'; }).length, 1);
    eq(e.uploads.filter(function (u) { return u.status === 'queued'; }).length, 1, 'Foto.jpg en cola');
    E.respond('driveUpload', { id: 'n1', name: 'Acta.pdf', kind: 'pdf', size: 2048, url: 'https://drive.google.com/file/d/n1/view' });
    eq(e.data.files[0].id, 'n1', 'lo subido aparece al tiro en la lista');
    eq(E.count('driveUpload'), 2, 'recién entonces sube el siguiente');
    eq(E.st.calls[1].args[1].name, 'Foto.jpg');
    E.respond('driveUpload', { id: 'n2', name: 'Foto.jpg', kind: 'image', size: 900, url: 'https://drive.google.com/file/d/n2/view' });
    deepEq(E.st.toasts.filter(function (t) { return t[1] === 'success'; }), [['2 archivos subidos a Drive', 'success']], 'un toast al terminar la tanda');
    eq(E.count('driveList'), 1, 'y se actualiza la lista desde Drive');
    deepEq(e.uploads.map(function (u) { return u.name; }), ['Video.mov'], 'sólo queda el rechazado');
    // Una sola subida: «Subido a Drive»; un error del servidor queda en su fila
    E.respond('driveList', { folder: e.data.folder, files: e.data.files, configured: true });
    E.fgDriveUpload(PID, [file('Uno.pdf', 10, 'application/pdf', 'QQ==')]);
    E.flush();
    eq(e.uploads.length, 1, 'una tanda nueva limpia los errores anteriores');
    E.respond('driveUpload', { id: 'n3', name: 'Uno.pdf', url: 'https://drive.google.com/file/d/n3/view' });
    deepEq(E.st.toasts[E.st.toasts.length - 1], ['Subido a Drive', 'success']);
    E.respond('driveList', { folder: e.data.folder, files: e.data.files, configured: true });
    E.fgDriveUpload(PID, [file('Falla.pdf', 10, 'application/pdf', 'QQ==')]);
    E.flush();
    E.respond('driveUpload', 'Google Drive no respondió a tiempo. Intenta de nuevo en un minuto.', true);
    var f = e.uploads.filter(function (u) { return u.name === 'Falla.pdf'; })[0];
    ok(f && f.status === 'error' && /no respondió/.test(f.error), 'error del servidor en la fila');
    ok(!('file' in f), 'no se retiene el archivo en memoria');
    eq(E.count('driveList'), 2, 'sin nada subido no se recarga la lista');
  });

  test('v31 fgestion · editor de links: «Subir archivo» (con proyecto) agrega {t, u}; espera antes de guardar', function () {
    var E = env();
    var withP = E.evidenceEditorHtml('evidencias', [], { project: PID });
    ok(/data-project="PRJ-00000001"/.test(withP) && /data-action="evidence\.upload" title="[^"]*" class=/.test(withP), 'con proyecto: «Subir archivo» visible');
    ok(/data-action="evidence\.upload"[^>]* hidden /.test(E.evidenceEditorHtml('evidencias', [])), 'sin proyecto: oculto');
    ok(/data-action="evidence\.upload"[^>]* hidden /.test(E.evidenceEditorHtml('evidencias', [], {})), 'sin proyecto (opts vacío): oculto');
    E.FG_STATE.driveOff = true;
    ok(/data-action="evidence\.upload"[^>]* hidden /.test(E.evidenceEditorHtml('evidencias', [], { project: PID })), 'Drive sin configurar: oculto');
    E.FG_STATE.driveOff = false;
    // Subida: la fila vacía por defecto se reemplaza por el archivo; los links existentes se conservan
    var x = fakeEditor(E, [], PID);
    eq(E.fgEvProject(x.ed), PID);
    E.fgEvUpload(x.ed, PID, [file('Acta reunión.pdf', 5000, 'application/pdf', 'JVBER')]);
    E.flush();
    eq(x.rows.children.length, 2, 'fila vacía + «Subiendo…»');
    ok(x.ed.querySelector('[data-ev-pending]') && x.rows.children[1].html.indexOf('Subiendo «Acta reunión.pdf» a Drive…') >= 0, 'fila «Subiendo…»');
    eq(E.fgCheckEvidence(x.ed, 'evidencias'), false, 'mientras sube no se puede guardar');
    deepEq(E.st.toasts[0], ['Espera a que termine de subir el archivo', 'info']);
    deepEq(E.st.calls[0], { fn: 'driveUpload', args: [PID, { name: 'Acta reunión.pdf', mimeType: 'application/pdf', base64: 'JVBER' }] }, 'sube a la carpeta del proyecto');
    E.respond('driveUpload', { id: '1A', name: 'Acta reunión.pdf', kind: 'pdf', url: 'https://drive.google.com/file/d/1A/view' });
    ok(!x.ed.querySelector('[data-ev-pending]'), 'sin fila «Subiendo…»');
    deepEq(E.readEvidence(x.ed, 'evidencias'), [{ t: 'Acta reunión.pdf', u: 'https://drive.google.com/file/d/1A/view' }], 'queda {t: nombre, u: url} (sin la fila vacía)');
    // Con un link previo: se agrega al final
    var y = fakeEditor(E, [{ t: 'Minuta', u: 'https://docs.google.com/document/d/1M/edit' }], PID);
    E.fgEvUpload(y.ed, PID, [file('Foto.jpg', 10, 'image/jpeg', 'Rk8=')]);
    E.flush();
    E.respond('driveUpload', { id: '1B', name: 'Foto.jpg', url: 'https://drive.google.com/file/d/1B/view' });
    deepEq(E.readEvidence(y.ed, 'evidencias').map(function (e) { return e.t; }), ['Minuta', 'Foto.jpg'], 'se suma al final');
    // Varios archivos: todos muestran «Subiendo…», pero se envían uno a la vez (la 1ª subida puede crear la carpeta)
    var w = fakeEditor(E, [], PID);
    var before = E.count('driveUpload');
    E.fgEvUpload(w.ed, PID, [file('Uno.pdf', 10, 'application/pdf', 'QQ=='), file('Dos.pdf', 10, 'application/pdf', 'Qg==')]);
    E.flush();
    eq(w.ed.querySelectorAll('[data-ev-pending]').length, 2, 'dos filas «Subiendo…»');
    eq(E.count('driveUpload') - before, 1, 'una a la vez');
    E.respond('driveUpload', { id: '1U', name: 'Uno.pdf', url: 'https://drive.google.com/file/d/1U/view' });
    eq(E.count('driveUpload') - before, 2, 'luego la siguiente');
    E.respond('driveUpload', { id: '1D', name: 'Dos.pdf', url: 'https://drive.google.com/file/d/1D/view' });
    deepEq(E.readEvidence(w.ed, 'evidencias').map(function (e) { return e.t; }), ['Uno.pdf', 'Dos.pdf'], 'en el orden elegido');
    // Demasiado grande: no se envía; error del servidor: se retira la fila y se avisa; url inválida: no se agrega
    var z = fakeEditor(E, [], PID);
    var n = E.st.calls.length;
    E.fgEvUpload(z.ed, PID, [file('Gigante.mov', 30 * 1024 * 1024, 'video/quicktime')]);
    E.flush();
    eq(E.st.calls.length, n, 'más de 20 MB: no llega al servidor');
    ok(/«Gigante\.mov» pesa 30 MB \(máx\. 20 MB\)/.test(E.st.toasts[E.st.toasts.length - 1][0]), 'toast amable');
    E.fgEvUpload(z.ed, PID, [file('Malo.pdf', 10, 'application/pdf', 'QQ==')]);
    E.flush();
    E.respond('driveUpload', 'No tengo acceso a la carpeta del proyecto.', true);
    ok(!z.ed.querySelector('[data-ev-pending]'), 'error: se retira «Subiendo…»');
    deepEq(E.readEvidence(z.ed, 'evidencias'), [], 'sin link nuevo');
    deepEq(E.st.toasts[E.st.toasts.length - 1], ['No tengo acceso a la carpeta del proyecto.', 'error']);
    eq(E.fgEvFromUpload({ name: 'x', url: 'javascript:alert(1)' }, {}), null, 'sólo links http(s)');
    deepEq(E.fgEvFromUpload({ url: 'https://drive.google.com/file/d/9/view' }, { name: 'Local.pdf' }), { t: 'Local.pdf', u: 'https://drive.google.com/file/d/9/view' }, 'sin nombre de Drive: el del archivo');
    // La caché de la pestaña Drive se entera
    var e = E.fgDriveEntry(PID);
    e.status = 'ok'; e.at = Date.now(); e.data = { folder: null, files: [] };
    E.fgDriveAdded(PID, { id: '1C', name: 'C' });
    eq(e.data.files[0].id, '1C'); eq(e.at, 0, 'y se marca para refrescar (carpeta recién creada)');
    // Formularios: el proyecto llega al editor
    var code = src('FGestion');
    ok(/evidenceEditorHtml\('evidencias', ev, \{ project: proj \? proj\.id : '' \}\)/.test(fn(code, 'openTaskForm')), 'compositor: proyecto de la tarea');
    ok(/fgEvSyncUpload\(root\)/.test(fn(code, 'fgCmpPickProject')), 'al cambiar de proyecto se muestra / oculta');
    ok(/evidenceEditorHtml\('evidencias', evs, \{ project: /.test(fn(code, 'openCompleteTask')), '«¿Cómo te fue?»: proyecto de la tarea');
    ok(/evidenceEditorHtml\('evidencias', p \? p\.evidencias : \[\], \{ project: p \? p\.id : '' \}\)/.test(fn(code, 'openProjectForm')), 'editar proyecto: su carpeta');
  });

  test('v31 fgestion · contra Drive.gs: archivo subido con el base64 del cliente queda como evidencia de la tarea', function () {
    need('driveUpload', 'driveList', 'driveSetRoot', 'gSave');
    fresh('setup');
    var E = env();
    var root = MOCK.drive.addFolder('AACC Proyectos', '');
    asUser(U.gonzalo, function () { return client('driveSetRoot', root); });
    var pb = client('gSave', { tipo: 'Proyecto', pilar: 'nat', nombre: 'Humedal El Bato', resp: U.ina, estado: 'Activo', anio: '', lineas: [], evidencias: [] });
    var pid = pb.lastId;
    var b64 = E.fgStripB64('data:application/pdf;base64,' + Utilities.base64Encode('%PDF-1.4 acta'));
    var entry = asUser(U.ina, function () { return client('driveUpload', pid, { name: 'Acta terreno.pdf', mimeType: 'application/pdf', base64: b64 }); });
    eq(entry.name, 'Acta terreno.pdf');
    eq(entry.kind, 'pdf');
    var ev = E.fgEvFromUpload(entry, { name: 'Acta terreno.pdf' });
    ok(ev && ev.u === entry.url && /^https:\/\//.test(ev.u), 'link http(s) de Drive');
    var tb = asUser(U.ina, function () {
      return client('gSave', { tipo: 'Tarea', pilar: 'nat', proyecto: pid, nombre: 'Visita a terreno', resp: U.ina, fecha: '', cascade: '', evidencias: [ev], estado: 'Pendiente', avisar: true, privada: false });
    });
    var t = tb.tasks.filter(function (x) { return x.id === tb.lastId; })[0];
    deepEq(t.evidencias, [ev], 'la tarea guarda el link del archivo');
    var list = asUser(U.benja, function () { return client('driveList', pid); });
    ok(list.folder && list.folder.url, 'el proyecto ya tiene carpeta');
    ok(list.files.some(function (f) { return f.id === entry.id; }), 'el equipo ve el archivo en la pestaña Drive');
  });

  test('v31 fgestion · alta rápida del proyecto: Enter → pickDate; null no crea; fecha / sin fecha crean al tiro', function () {
    var E = env({ drawerKey: 'project:' + PID });
    var input = { value: '  Enviar   fotos a Ina ', dataset: {}, focus: function () { this.focused = (this.focused || 0) + 1; } };
    E.st.els['fg-qa-' + PID] = input;
    var qa = E.st.actions['project.quickadd'];
    qa({ id: PID }, input);
    eq(E.st.picks.length, 1, 'pregunta la fecha');
    ok(E.st.picks[0].el === input && E.st.picks[0].opts.title === '¿Para cuándo?', 'junto al campo');
    eq(E.st.mutates.length, 0, 'todavía no crea nada');
    qa({ id: PID }, input);
    eq(E.st.picks.length, 1, 'un segundo Enter con el selector abierto no abre otro');
    // Esc → null: no crea, conserva el texto y devuelve el foco
    E.st.picks[0].res(null);
    E.flush();
    eq(E.st.mutates.length, 0, 'cancelado: no crea');
    eq(input.value, '  Enviar   fotos a Ina ', 'el texto queda');
    ok(input.focused >= 1, 'foco de vuelta al campo');
    ok(!input.dataset.busy, 'liberado');
    // Elegir una fecha: crea con esa fecha, limpia el campo y deja la fila atenuada mientras guarda
    qa({ id: PID }, input);
    E.st.picks[1].res(day(6));
    E.flush();
    eq(E.st.mutates.length, 1);
    var m = E.st.mutates[0];
    eq(m.fn, 'gSave');
    eq(m.opts.silent, true, 'sin toast: la fila aparece al tiro');
    var pay = m.args[0];
    eq(pay.nombre, 'Enviar fotos a Ina', 'espacios normalizados');
    eq(pay.fecha, day(6)); eq(pay.proyecto, PID); eq(pay.pilar, 'nat'); eq(pay.resp, U.gonzalo); eq(pay.estado, 'Pendiente');
    ok(!('base' in pay) && !('id' in pay), 'alta: sin id ni base');
    eq(input.value, '', 'campo limpio para la siguiente');
    eq(E.FG_STATE.qa.length, 0, 'la fila temporal se retira al confirmar');
    ok(E.st.refresh >= 2, 'el drawer se redibuja al agregar y al confirmar');
    // «Sin fecha» → ''
    input.value = 'Llamar a Kilimo';
    qa({ id: PID }, input);
    E.st.picks[2].res('');
    E.flush();
    eq(E.st.mutates[1].args[0].fecha, '', 'sin fecha');
    eq(E.st.mutates[1].args[0].nombre, 'Llamar a Kilimo');
  });

  test('v31 fgestion · alta rápida: fecha natural en el texto no pregunta; proyecto cerrado no crea; falla devuelve el texto', function () {
    var tomorrow = day(1);
    var E = env({ drawerKey: 'project:' + PID, todoParse: function (txt) { return /\smañana$/.test(txt) ? { nombre: txt.replace(/\s+mañana$/, ''), fecha: tomorrow, token: 'mañana' } : { nombre: txt, fecha: '', token: '' }; } });
    var input = { value: 'Llamar a Kilimo mañana', dataset: {}, focus: function () {} };
    E.st.els['fg-qa-' + PID] = input;
    E.st.actions['project.quickadd']({ id: PID }, input);
    E.flush();
    eq(E.st.picks.length, 0, 'ya trae la fecha: no pregunta');
    eq(E.st.mutates[0].args[0].nombre, 'Llamar a Kilimo');
    eq(E.st.mutates[0].args[0].fecha, tomorrow);
    // Proyecto cerrado: nada
    var C = env({ projects: [{ id: PID, pilar: 'nat', nombre: 'Viejo', estado: 'Cerrado', lineas: [], evidencias: [] }] });
    C.st.actions['project.quickadd']({ id: PID }, { value: 'X', dataset: {}, focus: function () {} });
    eq(C.st.picks.length + C.st.mutates.length, 0, 'cerrado: no pregunta ni crea');
    // Sin pickDate (Core viejo): crea sin fecha
    var N = env({ noPick: true });
    N.st.actions['project.quickadd']({ id: PID }, { value: 'Y', dataset: {}, focus: function () {} });
    N.flush();
    eq(N.st.mutates[0].args[0].fecha, '', 'sin selector: sin fecha');
    // Falla del servidor: la fila se retira y el texto vuelve al campo
    var F = env({ drawerKey: 'project:' + PID, mutateFail: true });
    var inp = { value: 'Revisar acta', dataset: {}, focus: function () {} };
    F.st.els['fg-qa-' + PID] = inp;
    F.st.actions['project.quickadd']({ id: PID }, inp);
    F.st.picks[0].res(day(2));
    F.flush();
    eq(F.FG_STATE.qa.length, 0, 'sin fantasmas');
    eq(inp.value, 'Revisar acta', 'texto devuelto para reintentar');
  });

  test('v31 fgestion · lista del proyecto: fila temporal atenuada, sin ayudas ni «Con detalles»', function () {
    var E = env({ tasks: [
      { id: 'TSK-1', proyecto: PID, pilar: 'nat', nombre: 'Postular', estado: 'Pendiente', resp: U.ina, fecha: day(20), evidencias: [{ t: 'a', u: 'https://x.cl' }], avisar: false },
      { id: 'TSK-2', proyecto: PID, pilar: 'nat', nombre: 'Lista', estado: 'Realizada', completada: day(-1), resp: U.ina, evidencias: [] },
    ] });
    var p = E.IDX.project.get(PID);
    E.FG_STATE.qa.push({ id: 'tmp-abc', proyecto: PID, pilar: 'nat', nombre: 'Nueva <rápida>', fecha: day(1), resp: U.gonzalo, estado: 'Pendiente', evidencias: [] });
    var h = E.fgProjectTasks(p);
    ok(/data-task-row data-id="tmp-abc"[^>]*opacity-60"[^>]* aria-busy="true"/.test(h), 'fila temporal atenuada');
    ok(h.indexOf('Nueva &lt;rápida&gt;') >= 0, 'escapada');
    ok(h.indexOf('Nueva &lt;rápida&gt;') < h.indexOf('Postular'), 'ordenada por fecha con las demás');
    ok(h.indexOf('data-enter="project.quickadd"') >= 0, 'alta rápida');
    ['Enter la crea', 'Con detalles', 'Pendientes', 'Todo listo por aquí', 'Escribe la primera'].forEach(function (s) { ok(h.indexOf(s) < 0, 'sin «' + s + '»'); });
    ok(h.indexOf('Realizadas') >= 0, 'las realizadas siguen plegables');
    ok(h.indexOf('paperclip') < 0 && h.indexOf('bell-off') < 0, 'filas: sin contadores ni campana (§14.4)');
    E.FG_STATE.qa.length = 0;
    var E0 = env();
    var empty = E0.fgProjectTasks(E0.IDX.project.get(PID));
    ok(/^<div class="relative">[\s\S]*data-enter="project\.quickadd"[^>]*><\/div>$/.test(empty), 'vacío: sólo el campo para agregar (sin estado vacío)');
  });

  test('v31 fgestion · resumen del proyecto sin ruido: secciones vacías fuera, sin etiquetas «Iniciativa» ni ayudas', function () {
    var E = env();
    var p = { id: PID, pilar: 'nat', nombre: 'Humedal', estado: 'Activo', detalle: '', cascade: '', evidencias: [], creado: new Date().toISOString(), creadoPor: U.ina };
    var st = { tasks: 0, done: 0, pending: 0, overdue: 0, lines: [], nextTask: null, pf: 0, pg: 0 };
    var h = E.fgProjectSummary(p, st);
    ['Sin descripción', 'Sin evidencias', 'Sin indicador', 'heredan', 'Todo listo', 'Nada pendiente', 'Todavía sin tareas', 'Próximo vencimiento'].forEach(function (s) {
      ok(h.indexOf(s) < 0, 'sin «' + s + '»');
    });
    ok(h.indexOf('sm:grid-cols-2') >= 0, 'sin próximo vencimiento: dos tarjetas');
    ok(h.indexOf('Creado por Ina') >= 0, '«Creado por» discreto');
    var withOver = E.fgProjectSummary(p, { tasks: 3, done: 1, pending: 2, overdue: 1, lines: [], nextTask: { id: 'T', nombre: 'X', estado: 'Pendiente', fecha: day(-2) }, pf: 0, pg: 0 });
    ok(withOver.indexOf('1 atrasada') >= 0 && withOver.indexOf('pendientes') < 0, 'sólo lo atrasado (no «2 pendientes»)');
    ok(withOver.indexOf('sm:grid-cols-3') >= 0, 'con próximo vencimiento: tres');
    E.IDX.cascade.set('CAS-G', { id: 'CAS-G', padre: '', nombre: 'Grupo', etiqueta: 'Iniciativa', clase: 'grupo', pilar: 'nat' });
    E.IDX.cascade.set('CAS-A', { id: 'CAS-A', padre: 'CAS-G', nombre: 'Acción 1', clase: 'accion', pilar: 'nat' });
    var hc = E.fgProjectSummary(Object.assign({}, p, { cascade: 'CAS-A' }), st);
    ok(hc.indexOf('Acción 1') >= 0 && hc.indexOf('Iniciativa') < 0, 'indicador sin la etiqueta «Iniciativa»');
    eq(E.cascadePickerHtml({ name: 'cascade', pilar: 'nat', value: '' }).indexOf('data-cpk-hint'), -1, 'selector Cascade sin texto de ayuda por defecto');
  });

  test('v31 fgestion · drawer de tarea: fecha con «Cambiar» (pickDate, al instante, v3.4 sin versión), sin texto duplicado', function () {
    var t = { id: 'TSK-9', pilar: 'nat', proyecto: '', nombre: 'Medir', estado: 'Pendiente', fecha: day(-2), resp: U.ina, evidencias: [], actualizado: '2026-10-01T10:00:00.000Z' };
    var E = env({ tasks: [t] });
    var el = { id: 'x' };
    E.st.actions['task.redate']({ id: 'TSK-9' }, el);
    eq(E.st.picks.length, 1);
    eq(E.st.picks[0].opts.title, 'Nueva fecha');
    E.st.picks[0].res(day(3));
    E.flush();
    deepEq(E.st.optimistic[0], { fn: 'gSave', args: [{ tipo: 'Tarea', id: 'TSK-9', fecha: day(3) }] }, 'sólo la fecha (v3.4, SPEC §18: sin versión)');
    eq(t.fecha, day(3), 'cambio local al instante');
    E.st.actions['task.redate']({ id: 'TSK-9' }, el);
    E.st.picks[1].res(null);
    E.flush();
    eq(E.st.optimistic.length, 1, 'cancelar no guarda');
    t.estado = 'Realizada';
    E.st.actions['task.redate']({ id: 'TSK-9' }, el);
    eq(E.st.picks.length, 2, 'una tarea lista no se re-fecha desde aquí');
    var dr = fn(src('FGestion'), 'fgTaskDrawer');
    ok(dr.indexOf('data-action="task.redate"') >= 0, 'botón «Cambiar» / «Poner fecha»');
    ok(dr.indexOf('¿Le damos otra fecha?') < 0 && dr.indexOf('Vence en ') < 0, 'sin franja de vencimiento duplicada');
    ok(dr.indexOf('Opcional: qué se hizo o dónde quedó.') < 0, 'sin ayuda bajo «Agregar comentario de cierre»');
    ok(!/subtitle:[^\n]*fgDueChip/.test(dr), 'el subtítulo no repite la fecha');
  });
})();
