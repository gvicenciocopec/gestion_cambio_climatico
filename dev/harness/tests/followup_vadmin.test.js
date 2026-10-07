/* Seguimiento VAdmin (Ajustes):
   - «Enlace de la app»: estado guardado/sin guardar (getAdminStatus) y formulario sólo admin que llama a setAppUrl.
   - Tarjeta Gemini discreta (IA pospuesta): plegada, con el estado en una línea.
   - Pestañas «Cuadre AAAA» omitidas: se leen de bundle.config.warnings para el «Qué hacer» de Años de presupuesto.
   Las funciones del cliente se extraen de VAdmin.html (MOCK.files) y se evalúan con dependencias mínimas. */
(function () {
  var EXEC = 'https://script.google.com/a/macros/copec.cl/s/MOCK/exec';

  // Fuente del .html (sólo los bloques <script>)
  function src(file) {
    var html = MOCK.files[file];
    ok(typeof html === 'string', 'no se cargó ' + file + '.html');
    var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out.join('\n');
  }
  // Función de nivel superior: desde «function name(» hasta la llave de cierre en la columna 0
  // (no se cuentan llaves: el código tiene regex con comillas, p. ej. /pestaña "([^"]+)"/)
  function fn(code, name) {
    var i = code.indexOf('\nfunction ' + name + '(');
    ok(i >= 0, 'no encontré la función ' + name);
    var j = code.indexOf('\n}', i + 1);
    ok(j > i, 'función sin cerrar: ' + name);
    return code.slice(i + 1, j + 2);
  }

  // Stubs mínimos del kit de UI de Core (sólo lo que usan las funciones probadas)
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(n) { return '<i data-lucide="' + n + '"></i>'; }
  function tone() { return { iconbox: '' }; }
  function safeUrl(u) { var s = String(u || '').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; }
  function badge(t) { return '<span class="badge">' + esc(t) + '</span>'; }
  function btn(o) { return '<button data-action="' + esc(o.action || '') + '">' + esc(o.label || '') + '</button>'; }
  function iconBtn(o) { return '<button data-action="' + esc(o.action || '') + '" title="' + esc(o.title || '') + '"></button>'; }
  function field(o) { return '<input id="' + esc(o.id) + '" name="' + esc(o.name) + '" value="' + esc(o.value) + '">'; }
  function admSpin(l) { return '<button disabled>' + esc(l) + '</button>'; }
  var CX = { card: 'card' };

  function appUrlBlock(S, A) {
    return new Function('S', 'admState', 'safeUrl', 'esc', 'icon', 'badge', 'btn', 'iconBtn', 'field', 'admSpin',
      'const ADM_APPURL_ID = "adm-appurl";\n' + fn(src('VAdmin'), 'admAppUrlBlock') + '\nreturn admAppUrlBlock();')(
      S, function () { return A; }, safeUrl, esc, icon, badge, btn, iconBtn, field, admSpin);
  }
  function geminiCard(S, A) {
    var code = src('VAdmin');
    return new Function('S', 'admState', 'safeUrl', 'esc', 'icon', 'tone', 'CX',
      ['admIconBox', 'admCode', 'admDetails', 'admSetCard', 'admGeminiCard'].map(function (n) { return fn(code, n); }).join('\n') +
      '\nreturn admGeminiCard();')(S, function () { return A; }, safeUrl, esc, icon, tone, CX);
  }
  function skippedTabs(S) {
    return new Function('S', fn(src('VAdmin'), 'admSkippedTabs') + '\nreturn admSkippedTabs();')(S);
  }

  test('vadmin · Enlace de la app: el formulario sólo es para administradores y propone la URL /exec', function () {
    var admin = { me: { admin: true }, config: { appUrl: EXEC } }, team = { me: { admin: false }, config: { appUrl: EXEC } };
    var unsaved = { status: { appUrl: EXEC, appUrlSaved: false }, busy: {} };
    var h = appUrlBlock(team, unsaved);
    ok(h.indexOf('Sin guardar') >= 0, 'muestra que no está guardado');
    ok(/Se guarda automáticamente la primera vez que alguien abre la URL publicada \(\/exec\)\. Los correos usan este enlace\./.test(h), 'nota ámbar');
    ok(h.indexOf('adm-appurl') < 0 && h.indexOf('admin.saveAppUrl') < 0 && h.indexOf('admin.editAppUrl') < 0, 'sin formulario para el equipo');

    h = appUrlBlock(admin, unsaved);
    ok(h.indexOf('admin.saveAppUrl') >= 0 && h.indexOf('Guardar enlace') >= 0, 'botón Guardar enlace');
    includes(h, 'id="adm-appurl" name="appUrl" value="' + EXEC + '"', 'propone la URL /exec actual');
    ok(h.indexOf('admin.cancelAppUrl') < 0, 'sin guardar no hay Cancelar');
    var dev = appUrlBlock(admin, { status: { appUrl: EXEC.replace(/exec$/, 'dev'), appUrlSaved: false }, busy: {} });
    includes(dev, 'name="appUrl" value=""', 'una URL /dev no se propone');

    var saved = { status: { appUrl: EXEC, appUrlSaved: true }, busy: {} };
    h = appUrlBlock(admin, saved);
    ok(h.indexOf('Guardado') >= 0 && h.indexOf('Se guarda automáticamente') < 0, 'guardado: sin nota ámbar');
    ok(h.indexOf('adm-appurl') < 0 && h.indexOf('admin.editAppUrl') >= 0, 'guardado: se edita con el lápiz');
    h = appUrlBlock(admin, { status: saved.status, busy: {}, appUrlEdit: true });
    ok(h.indexOf('adm-appurl') >= 0 && h.indexOf('admin.cancelAppUrl') >= 0, 'editando: formulario con Cancelar');
    h = appUrlBlock(admin, { status: saved.status, busy: { appUrl: true }, appUrlEdit: true });
    ok(h.indexOf('Guardando…') >= 0 && h.indexOf('admin.saveAppUrl') < 0, 'guardando: botón ocupado');

    // Antes de leer getAdminStatus: URL del bundle y sin estado
    h = appUrlBlock(admin, { status: null, busy: {} });
    includes(h, EXEC, 'usa config.appUrl mientras carga');
    ok(h.indexOf('Sin guardar') < 0 && h.indexOf('Guardado') < 0, 'sin estado todavía');
  });

  test('vadmin · Enlace de la app: contrato de getAdminStatus / setAppUrl que usa Ajustes', function () {
    need('getAdminStatus', 'setAppUrl', 'bootstrap');
    fresh('setup');
    var prev = MOCK.serviceUrl;
    try {
      MOCK.serviceUrl = EXEC;
      var st = client('getAdminStatus');
      eq(typeof st.appUrl, 'string', 'appUrl');
      eq(typeof st.appUrlSaved, 'boolean', 'appUrlSaved');
      eq(st.admin, true, 'admin ve el formulario');
      asUser(U.ina, function () { eq(client('getAdminStatus').admin, false, 'el equipo no'); });
      // admin.saveAppUrl compara config.appUrl con lo escrito sin ?… ni #… (aviso de CONFIG.APP_URL)
      var typed = 'https://script.google.com/a/macros/copec.cl/s/AKfycbNueva_1/exec?usp=sharing#x';
      eq(client('setAppUrl', typed).config.appUrl, typed.replace(/[?#].*$/, ''), 'el servidor limpia igual que el cliente');
      st = client('getAdminStatus');
      eq(st.appUrlSaved, true);
      eq(st.appUrl, typed.replace(/[?#].*$/, ''));
      // Vacío borra: vuelve a «Sin guardar» con la URL de getUrl() (que el formulario propone)
      client('setAppUrl', '');
      st = client('getAdminStatus');
      eq(st.appUrlSaved, false, 'borrada');
      eq(st.appUrl, EXEC);
      // La nota ámbar: la próxima visita a /exec la guarda sola
      client('bootstrap');
      eq(client('getAdminStatus').appUrlSaved, true, 'se guardó al abrir la app');
    } finally { MOCK.serviceUrl = prev; }
  });

  test('vadmin · tarjeta Gemini plegada y en una línea mientras la IA está pospuesta', function () {
    var h = geminiCard({ config: { geminiEnabled: false } }, { status: { geminiEnabled: false, model: 'gemini-x' } });
    includes(h, 'Asistente Gemini (opcional)');
    includes(h, 'Desactivado — el buscador funciona como directorio sin IA');
    includes(h, 'Cómo activarlo más adelante');
    ok(!/<details[^>]*\sopen[\s>]/.test(h), 'plegada por defecto');
    ['GEMINI_API_KEY', 'GEMINI_MODEL', 'Privacidad', 'aistudio.google.com', 'actual: gemini-x'].forEach(function (t) { includes(h, t, 'pasos y privacidad dentro del desplegable'); });
    h = geminiCard({ config: { geminiEnabled: true } }, { status: { geminiEnabled: true, model: 'gemini-x' } });
    ok(/Activado · gemini-x/.test(h) && h.indexOf('Desactivado') < 0, 'activada: estado y modelo');
    includes(h, 'Cómo cambiar la clave o el modelo');
    // Sin estado del servidor: usa config.geminiEnabled del bundle
    includes(geminiCard({ config: { geminiEnabled: false } }, { status: null }), 'Desactivado');
    // Los nombres de las propiedades de script que se explican en Ajustes son los que lee el servidor
    includes(String(getAdminStatus), 'GEMINI_API_KEY');
    includes(String(isMember_), 'EXTRA_USERS');
    includes(src('VAdmin'), 'EXTRA_USERS', 'Ajustes explica EXTRA_USERS');
  });

  test('vadmin · Años de presupuesto lista las pestañas omitidas del aviso del servidor', function () {
    need('bootstrap');
    fresh('setup');
    eq(skippedTabs(client('bootstrap')).length, 0, 'sin pestañas malas');
    MOCK.addSheet('Cuadre 2025', [['Archivo histórico (sin encabezados)'], ['algo', 1, 2]]);
    var b = client('bootstrap');
    ok(b.years.indexOf(2025) < 0, 'no está entre los años');
    deepEq(skippedTabs(b), ['Cuadre 2025'], 'nombre leído del aviso: ' + JSON.stringify(b.config.warnings));
    deepEq(skippedTabs({ config: { warnings: [b.config.warnings[0], b.config.warnings[0], 'Otro aviso cualquiera'] } }), ['Cuadre 2025'], 'sin repetir y sólo avisos de pestañas');
    deepEq(skippedTabs({ config: {} }), [], 'bundle sin warnings');
  });
})();
