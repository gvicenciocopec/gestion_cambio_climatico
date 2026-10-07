/* Asistente · directorio anti-alucinación (SPEC §10, §11 Gemini) */
(function () {
  var Q_BONOS = '¿En qué planilla guardamos el reporte de bonos de carbono?';
  var Q_NAT = '¿Cuál es la tarea pendiente para Naturaleza?';
  var BONOS_ID = '1AbCbonosCarbono2026Xy7QzK';
  var KEY = 'test-key-AIza-123';
  var TYPES = ['line', 'project', 'task', 'comment', 'evidence', 'cascade'];

  function withKey() { PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', KEY); }
  function checkSource(s, label) {
    ['id', 'type', 'title', 'refId'].forEach(function (k) { eq(typeof s[k], 'string', label + '.' + k); });
    includes(TYPES, s.type, label + '.type');
    ok(s.id !== '' && s.title !== '', label + ' sin id/título');
    if (s.url !== undefined && s.url !== '') ok(/^https?:\/\//.test(s.url), label + '.url http(s)');
  }
  function checkResult(r) {
    eq(typeof r.found, 'boolean', 'found'); eq(typeof r.answer, 'string', 'answer');
    ok(Array.isArray(r.sources) && Array.isArray(r.results), 'sources/results');
    includes(['ai', 'search'], r.mode, 'mode');
    r.sources.forEach(function (s, i) { checkSource(s, 'sources[' + i + ']'); });
    r.results.forEach(function (s, i) { checkSource(s, 'results[' + i + ']'); });
    ok(r.results.length <= 20, 'máximo 20 resultados');
    ok(r.answer.length <= 400, 'respuesta ≤ 400 caracteres');
  }
  function sourcesInPrompt(r) {
    var prompt = MOCK.promptText((MOCK.lastFetch() || {}).json);
    r.sources.forEach(function (s) { includes(prompt, s.id, 'la fuente ' + s.id + ' debe estar en el contexto enviado'); });
    return prompt;
  }
  // Responde con el primer registro válido del prompt + lo que agregue `mut`
  function handlerWith(mut) {
    return function (url, params, rec) {
      var ids = MOCK.promptIds(MOCK.promptText(rec.json));
      var out = { found: true, answer: 'Está en [' + ids[0] + '].', sourceIds: ids.slice(0, 1) };
      mut(out, ids);
      return { code: 200, body: MOCK.geminiReply(out) };
    };
  }

  test('asistente · modo búsqueda (sin API key): directorio con el link de bonos de carbono', function () {
    need('ask');
    fresh('demo');
    var r = client('ask', Q_BONOS);
    checkResult(r);
    eq(r.mode, 'search'); eq(r.answer, ''); eq(r.found, true);
    ok(r.results.length > 0, 'hay resultados');
    eq(MOCK.fetches.length, 0, 'sin API key no se llama a Gemini');
    ok(r.results.slice(0, 5).some(function (s) { return String(s.url || '').indexOf(BONOS_ID) >= 0; }), 'el link "Reporte bonos de carbono 2026" debe estar entre los 5 primeros');
    assertNoDates(ask(Q_BONOS), 'ask()');
  });

  test('asistente · intención: tareas pendientes de Naturaleza', function () {
    need('ask');
    fresh('demo');
    var b = bootstrap();
    var byId = {}; b.tasks.forEach(function (t) { byId[t.id] = t; });
    var r = ask(Q_NAT);
    checkResult(r);
    var tasks = r.results.filter(function (s) { return s.type === 'task'; });
    ok(tasks.length > 0, 'debe listar tareas');
    tasks.forEach(function (s) {
      var t = byId[s.refId] || byId[s.id];
      ok(t, 'la tarea ' + s.id + ' existe');
      eq(t.pilar, 'nat', s.title + ' es de Naturaleza');
      eq(t.estado, 'Pendiente', s.title + ' está pendiente');
    });
    eq(r.results[0].type, 'task', 'lo primero son tareas');
  });

  test('asistente · intención: responsable por nombre (Benja) y vencidas', function () {
    need('ask');
    fresh('demo');
    var b = bootstrap();
    var byId = {}; b.tasks.forEach(function (t) { byId[t.id] = t; });
    var r = ask('¿Qué tareas vencidas tiene Benja?');
    var tasks = r.results.filter(function (s) { return s.type === 'task'; }).map(function (s) { return byId[s.refId] || byId[s.id]; });
    tasks.forEach(function (t) { eq(t.resp, U.benja, t.nombre + ' es de Benja'); ok(t.estado === 'Pendiente' && t.fecha && t.fecha < day(0), t.nombre + ' está vencida'); });
  });

  test('asistente · sin coincidencias → found=false, sin resultados inventados', function () {
    need('ask');
    fresh('demo');
    var r = ask('xyzzy plutonio cuántico inexistente');
    checkResult(r);
    eq(r.found, false); eq(r.results.length, 0); eq(r.answer, '');
  });

  test('asistente · pregunta vacía o muy larga → error claro', function () {
    need('ask');
    fresh('demo');
    throws(function () { ask('  '); }, /caracter|pregunta|escrib/i);
    throws(function () { ask('a'.repeat(2000)); }, /larga|m[aá]ximo/i);
  });

  test('asistente · Gemini: request según SPEC §11, fuentes ⊆ contexto, key oculta', function () {
    need('ask');
    fresh('demo');
    withKey();
    var r = client('ask', Q_BONOS);
    checkResult(r);
    eq(r.mode, 'ai'); eq(r.found, true);
    ok(r.sources.length >= 1, 'cita al menos una fuente');
    var f = MOCK.lastFetch();
    ok(f, 'se llamó a Gemini');
    eq(f.method, 'post');
    ok(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/:]+:generateContent$/.test(f.url), 'endpoint: ' + f.url);
    includes(f.url, CONFIG.GEMINI_MODEL, 'modelo por defecto');
    eq(f.headers['x-goog-api-key'], KEY, 'header x-goog-api-key');
    ok(f.url.indexOf(KEY) < 0, 'la key no va en la URL');
    ok(JSON.stringify(r).indexOf(KEY) < 0, 'la key no vuelve al cliente');
    var gc = f.json.generationConfig || {};
    ['temperature', 'topP', 'topK'].forEach(function (k) { ok(!(k in gc), 'no enviar generationConfig.' + k + ' (obsoleto en 3.x)'); });
    ok(gc.responseFormat && gc.responseFormat.text && gc.responseFormat.text.mimeType === 'application/json', 'responseFormat JSON');
    ok(!gc.thinkingConfig, 'flash-lite sin thinkingConfig');
    ok(f.json.systemInstruction && f.json.systemInstruction.parts && f.json.systemInstruction.parts[0].text.length > 50, 'systemInstruction');
    eq(f.json.contents[0].role, 'user');
    sourcesInPrompt(r);
    ok(MOCK.promptIds(MOCK.lastPrompt()).length <= 20, 'máximo 20 registros en el contexto');
  });

  test('asistente · Gemini 3.7/3.8 flash usa thinkingLevel low', function () {
    need('ask');
    fresh('demo');
    withKey();
    PropertiesService.getScriptProperties().setProperty('GEMINI_MODEL', 'gemini-3.7-flash');
    ask(Q_BONOS);
    var f = MOCK.lastFetch();
    includes(f.url, 'gemini-3.7-flash');
    deepEq((f.json.generationConfig || {}).thinkingConfig, { thinkingLevel: 'low' });
  });

  test('asistente · Gemini: IDs y URLs inventados se eliminan', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = handlerWith(function (out) {
      out.sourceIds = out.sourceIds.concat(['TSK-deadbeef', 'PRJ-00000000', 'L-cafecafe']);
      out.answer = 'Está en https://evil.example.com/robo y también en [TSK-deadbeef] ' + out.answer;
    });
    var r = ask(Q_BONOS);
    checkResult(r);
    sourcesInPrompt(r);
    ok(!r.sources.some(function (s) { return /deadbeef|00000000|cafecafe/.test(s.id); }), 'IDs inventados fuera de las fuentes');
    ok(r.answer.indexOf('evil.example.com') < 0, 'URL inventada eliminada de la respuesta: ' + r.answer);
    eq(r.found, true, 'sigue habiendo una fuente válida');
  });

  test('asistente · Gemini: found=true sin fuentes válidas → found=false', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = handlerWith(function (out) { out.sourceIds = ['TSK-deadbeef']; out.answer = 'Inventado.'; });
    var r = ask(Q_BONOS);
    checkResult(r);
    eq(r.found, false); eq(r.sources.length, 0);
    ok(r.results.length > 0, 'igual muestra el directorio');
  });

  test('asistente · Gemini: URL real de una fuente citada se conserva', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = function (url, params, rec) {
      var prompt = MOCK.promptText(rec.json);
      var line = prompt.split('\n').find(function (l) { return l.indexOf(BONOS_ID) >= 0 && /^\[/.test(l); });
      ok(line, 'el contexto incluye el registro con el link de bonos');
      var id = /^\[([^\]]+)\]/.exec(line)[1];
      var u = /(https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s|]+)/.exec(line)[1];
      return { code: 200, body: MOCK.geminiReply({ found: true, answer: 'En la planilla ' + u, sourceIds: [id] }) };
    };
    var r = ask(Q_BONOS);
    includes(r.answer, BONOS_ID, 'la URL citada sobrevive a las guardas');
  });

  test('asistente · Gemini: respuesta larga se trunca a 400', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = handlerWith(function (out) { out.answer = 'palabra '.repeat(300); });
    var r = ask(Q_BONOS);
    ok(r.answer.length <= 400, 'largo ' + r.answer.length);
  });

  test('asistente · Gemini: 400 por responseFormat → un reintento con responseMimeType', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = function (url, params, rec) {
      var gc = rec.json.generationConfig || {};
      if (gc.responseFormat) return { code: 400, body: { error: { code: 400, message: 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\': Cannot find field.', status: 'INVALID_ARGUMENT' } } };
      ok(gc.responseMimeType === 'application/json' && gc.responseJsonSchema, 'el reintento usa responseMimeType + responseJsonSchema');
      return MOCK.geminiDefault(url, params, rec);
    };
    var r = ask(Q_BONOS);
    eq(MOCK.fetches.length, 2, 'exactamente un reintento');
    eq(r.mode, 'ai'); eq(r.found, true);
  });

  test('asistente · Gemini: 429 → reintenta con espera', function () {
    need('ask');
    fresh('demo');
    withKey();
    var n = 0;
    MOCK.fetchHandler = function (url, params, rec) {
      n++;
      if (n === 1) return { code: 429, body: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } } };
      return MOCK.geminiDefault(url, params, rec);
    };
    var r = ask(Q_BONOS);
    eq(n, 2); eq(r.mode, 'ai');
    ok(MOCK.stats.sleepMs >= 1000, 'esperó ≥ 1 s');
  });

  test('asistente · Gemini caído (500) → resultados del directorio sin romper', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = function () { return { code: 500, body: { error: { code: 500, message: 'Internal', status: 'INTERNAL' } } }; };
    var r = ask(Q_BONOS);
    checkResult(r);
    ok(r.results.length > 0, 'muestra el directorio');
    ok(!(r.mode === 'ai' && r.found), 'no afirma una respuesta sin el modelo');
    eq(r.answer, '');
  });

  test('asistente · Gemini bloqueado / incompleto → sin respuesta afirmada', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = function () { return { code: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }; };
    var r = ask(Q_BONOS);
    ok(!(r.mode === 'ai' && r.found), 'blockReason');
    MOCK.fetchHandler = handlerWith(function () {});
    var orig = MOCK.fetchHandler;
    MOCK.fetchHandler = function (u, p, rec) { var res = orig(u, p, rec); res.body.candidates[0].finishReason = 'MAX_TOKENS'; return res; };
    var r2 = ask(Q_NAT);
    ok(!(r2.mode === 'ai' && r2.found), 'finishReason MAX_TOKENS');
  });

  test('asistente · Gemini: partes "thought" se ignoran', function () {
    need('ask');
    fresh('demo');
    withKey();
    MOCK.fetchHandler = function (url, params, rec) {
      var res = MOCK.geminiDefault(url, params, rec);
      res.body.candidates[0].content.parts.unshift({ text: 'Pensando en voz alta {no es json', thought: true });
      return res;
    };
    var r = ask(Q_BONOS);
    eq(r.mode, 'ai'); eq(r.found, true);
  });

  test('asistente · sin coincidencias con key: no se consulta a Gemini', function () {
    need('ask');
    fresh('demo');
    withKey();
    var r = ask('xyzzy plutonio cuántico inexistente');
    eq(MOCK.fetches.length, 0, 'sin registros no hay nada que preguntar');
    eq(r.found, false);
  });
})();
