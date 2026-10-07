/* =====================================================================
   mocks.js · emulación en memoria de los servicios de Apps Script (banco de pruebas local)

   Se carga ANTES de los .gs, tanto en jsc (run_tests.sh) como en el navegador (build.py).
   Sólo declara nombres globales de servicios + MOCK (+ console en jsc). Todo lo demás vive
   dentro del IIFE para no chocar con los nombres de los módulos de la app.

   Fidelidad (lo importante para encontrar bugs reales):
   - Los valores conservan su tipo JS (Date sigue siendo Date). setValues/appendRow/setValue
     interpretan textos como lo haría Sheets al escribir: "2026" → 2026, "2026-10-15" → Date,
     "TRUE" → true, salvo formato '@' (texto) o apóstrofo inicial ("'2026" → texto "2026").
     Desactivar con MOCK.coerce = false.
   - Un texto que empieza con "=" se guarda como fórmula (getFormulas la devuelve; getValues
     devuelve el resultado de un evaluador simple: + - * / & comparaciones, SUM MAX MIN ABS ROUND IF).
   - getRange fuera de las dimensiones, setValues con dimensiones distintas, hideSheet de la última
     visible, deleteRows de todas las filas no fijas, nombres de hoja repetidos → mismo error que Apps Script.
   - LockService: un único lock de script. Tomarlo dos veces sin soltarlo se registra en
     MOCK.lockViolations (los tests fallan). MOCK.lockBusy = true simula otro usuario con el lock.
   - google.script.run: MOCK.strictClone(v) aplica las reglas de serialización (sin Date, funciones,
     undefined dentro de arrays, objetos no planos) y hace JSON round-trip.
   - GmailApp (lectura): buzón simulado en MOCK.gmail.messages (MOCK.gmail.add({...})); search() con from:/subject:/
     newer_than:, hilos y mensajes con los getters de Apps Script. Entra en snapshot/restore.
   - DriveApp: unidad simulada en MOCK.drive (carpetas/archivos con IDs, iteradores, createFolder/createFile(blob),
     moveTo, setTrashed, getParents; MOCK.drive.addFolder/addFile/deny/failOn/count/path). Entra en snapshot/restore.
   - Utilities.base64Decode/base64Encode/newBlob con bytes con signo (como Java) y UTF-8; base64 inválido lanza.
   Limitaciones: al insertar/borrar filas sólo se ajustan referencias de fila de la misma hoja (no columnas
   ni otras hojas); no hay ARRAYFORMULA real; los activadores se registran pero no se disparan solos.
   ===================================================================== */

var MOCK = (function () {
  'use strict';

  var G = (typeof globalThis !== 'undefined') ? globalThis : this;
  var REAL_CONSOLE = (G && G.console && typeof G.console.log === 'function') ? G.console : null;
  var HAS_PRINT = typeof G.print === 'function' && !REAL_CONSOLE;

  var DEFAULT_USER = 'gvicencio@copec.cl';
  var SHEET_URL_BASE = 'https://docs.google.com/spreadsheets/d/';

  /* ------------------------------------------------------------------ */
  /* Estado global del mock                                              */
  /* ------------------------------------------------------------------ */
  var M = {
    user: DEFAULT_USER,                 // Session.getActiveUser().getEmail()  ('' = no disponible)
    effectiveUser: DEFAULT_USER,        // Session.getEffectiveUser() y dueño de los activadores
    tz: 'America/Santiago',             // Session.getScriptTimeZone()
    ssTz: 'America/Santiago',           // Spreadsheet.getSpreadsheetTimeZone()
    locale: 'es_CL',
    bound: true,                        // getActiveSpreadsheet() devuelve la planilla
    ui: false,                          // SpreadsheetApp.getUi() disponible (menú de la hoja)
    coerce: true,                       // conversión de textos al escribir (como Sheets)
    verbose: false,                     // imprime console/Logger en jsc
    lockBusy: false,                    // otro proceso tiene el lock
    lockNested: false,                  // true = se detectó un lock anidado en esta prueba
    mailQuota: 1500,
    urlWhitelist: ['https://generativelanguage.googleapis.com/'],
    serviceUrl: 'https://script.google.com/a/macros/copec.cl/s/MOCK/exec',
    scriptId: 'MOCK-SCRIPT-ID',
    files: {},                          // nombre → contenido HTML (HtmlService)
    mails: [], fetches: [], logs: [], consoleBuf: [], toasts: [], alerts: [],
    warnings: [], unknownCalls: [], missing: [], lockViolations: [],
    stats: { flush: 0, locks: 0, sleepMs: 0, fetch: 0 },
    fetchHandler: null,                 // (url, opts) → {code, body, headers} | HTTPResponse
  };

  var STATE = null;                     // {ss, props:{script,user,document}, cache:{...}, triggers, uuidSeed, lock}

  function warn(msg) { M.warnings.push(msg); }

  /* ------------------------------------------------------------------ */
  /* Utilidades internas                                                 */
  /* ------------------------------------------------------------------ */
  function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
  function cloneVal(v) { return isDate(v) ? new Date(v.getTime()) : v; }
  function typeName(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (isDate(v)) return 'Date';
    if (Array.isArray(v)) return 'Array';
    var t = typeof v;
    return t === 'object' ? 'Object' : t.charAt(0).toUpperCase() + t.slice(1);
  }
  function sigError(method, args) {
    return new Error('Exception: The parameters (' + Array.prototype.map.call(args, function (a) {
      return a === undefined || a === null ? 'null' : typeName(a) === 'Number' ? 'number' : typeName(a) === 'String' ? 'String' : typeName(a);
    }).join(',') + ') don\'t match the method signature for ' + method + '.');
  }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function pad(n, w) { var s = String(Math.abs(n)); while (s.length < (w || 2)) s = '0' + s; return (n < 0 ? '-' : '') + s; }

  // PRNG determinista (mulberry32) para getUuid → pruebas reproducibles
  function rand() {
    STATE.uuidSeed = (STATE.uuidSeed + 0x6D2B79F5) | 0;
    var t = STATE.uuidSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Objeto encadenable para métodos de formato desconocidos (setBorder, setFontSize, ...)
  var CHAIN_RE = /^(set|auto|apply|merge|unmerge|protect|insertCheckboxes|removeCheckboxes|breakApart|trimWhitespace|activate|collapse|expand|hide|show|unhide|addDeveloperMetadata|createFilter|createTextFinder|setTab|uncheck|check)/;
  function wrap(obj, cls) {
    if (typeof Proxy === 'undefined') return obj;
    return new Proxy(obj, {
      get: function (target, prop, recv) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON' || prop.charAt(0) === '_') return undefined;
        if (CHAIN_RE.test(prop)) {
          return function () { M.unknownCalls.push(cls + '.' + prop); return recv; };
        }
        M.missing.push(cls + '.' + prop);
        return undefined;
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fechas y zonas horarias                                             */
  /* ------------------------------------------------------------------ */
  var DTF = {};
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function tzParts(date, tz) {
    var ms = date.getTime();
    if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) {
      return { y: date.getFullYear(), M: date.getMonth() + 1, d: date.getDate(), H: date.getHours(), m: date.getMinutes(), s: date.getSeconds(), S: date.getMilliseconds(), wd: date.getDay(), off: -date.getTimezoneOffset() };
    }
    var f = DTF[tz];
    if (!f) {
      try {
        f = DTF[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
      } catch (e) {
        warn('Zona horaria inválida "' + tz + '" (se usa GMT)');
        f = DTF[tz] = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
      }
    }
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    var p = { y: +o.year, M: +o.month, d: +o.day, H: (+o.hour) % 24, m: +o.minute, s: +o.second, S: ((ms % 1000) + 1000) % 1000, wd: WD[o.weekday] };
    p.off = Math.round((Date.UTC(p.y, p.M - 1, p.d, p.H, p.m, p.s) - (ms - p.S)) / 60000);
    return p;
  }

  function offStr(min, colon, short) {
    var sign = min < 0 ? '-' : '+';
    var a = Math.abs(min);
    var h = pad(Math.floor(a / 60)), mm = pad(a % 60);
    if (short) return sign + h;
    return sign + h + (colon ? ':' : '') + mm;
  }

  // Patrones estilo java.text.SimpleDateFormat (lo que usa Utilities.formatDate)
  function formatDate(date, tz, pattern) {
    if (!isDate(date) || typeof tz !== 'string' || typeof pattern !== 'string') throw sigError('Utilities.formatDate', [date, tz, pattern]);
    if (isNaN(date.getTime())) throw new Error('Exception: Invalid argument: date');
    var p = tzParts(date, tz);
    var out = '';
    var i = 0;
    while (i < pattern.length) {
      var ch = pattern.charAt(i);
      if (ch === "'") {
        var j = i + 1, lit = '';
        if (pattern.charAt(j) === "'") { out += "'"; i += 2; continue; }
        while (j < pattern.length) {
          if (pattern.charAt(j) === "'") {
            if (pattern.charAt(j + 1) === "'") { lit += "'"; j += 2; continue; }
            break;
          }
          lit += pattern.charAt(j); j++;
        }
        out += lit; i = j + 1; continue;
      }
      if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
      var n = 1;
      while (pattern.charAt(i + n) === ch) n++;
      i += n;
      switch (ch) {
        case 'Y': warn("Utilities.formatDate: 'Y' es el año-semana (week year); probablemente quisiste 'y'.");
        // falls through
        case 'y': out += n === 2 ? pad(p.y % 100) : pad(p.y, n); break;
        case 'M': case 'L': out += n >= 4 ? MONTHS[p.M - 1] : n === 3 ? MONTHS[p.M - 1].slice(0, 3) : pad(p.M, n); break;
        case 'd': out += pad(p.d, n); break;
        case 'D': {
          var doy = Math.round((Date.UTC(p.y, p.M - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000) + 1;
          warn("Utilities.formatDate: 'D' es el día del año; probablemente quisiste 'd'.");
          out += pad(doy, n); break;
        }
        case 'H': out += pad(p.H, n); break;
        case 'k': out += pad(p.H === 0 ? 24 : p.H, n); break;
        case 'h': out += pad(p.H % 12 === 0 ? 12 : p.H % 12, n); break;
        case 'K': out += pad(p.H % 12, n); break;
        case 'm': out += pad(p.m, n); break;
        case 's': out += pad(p.s, n); break;
        case 'S': out += pad(p.S, n); break;
        case 'E': out += n >= 4 ? DAYS[p.wd] : DAYS[p.wd].slice(0, 3); break;
        case 'u': out += String(p.wd === 0 ? 7 : p.wd); break;
        case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
        case 'z': out += 'GMT' + offStr(p.off, true); break;
        case 'Z': out += offStr(p.off, false); break;
        case 'X': out += p.off === 0 ? 'Z' : n === 1 ? offStr(p.off, false, true) : n === 2 ? offStr(p.off, false) : offStr(p.off, true); break;
        default: throw new Error("Exception: Illegal pattern character '" + ch + "'");
      }
    }
    return out;
  }

  // Instante para una hora "de pared" en tz
  function wallToDate(y, mo, d, H, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, H || 0, mi || 0, s || 0);
    var off = tzParts(new Date(guess), tz).off;
    var t = guess - off * 60000;
    var off2 = tzParts(new Date(t), tz).off;
    if (off2 !== off) t = guess - off2 * 60000;
    return new Date(t);
  }

  function parseDate(str, tz, pattern) {
    if (typeof str !== 'string' || typeof tz !== 'string' || typeof pattern !== 'string') throw sigError('Utilities.parseDate', [str, tz, pattern]);
    var re = '', keys = [], i = 0;
    while (i < pattern.length) {
      var ch = pattern.charAt(i);
      if (ch === "'") { var j = pattern.indexOf("'", i + 1); re += pattern.slice(i + 1, j < 0 ? undefined : j).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i = j < 0 ? pattern.length : j + 1; continue; }
      if (/[yMdHms]/.test(ch)) { var n = 1; while (pattern.charAt(i + n) === ch) n++; keys.push(ch); re += '(\\d{1,' + Math.max(n, ch === 'y' ? 4 : 2) + '})'; i += n; continue; }
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++;
    }
    var m = new RegExp('^' + re).exec(str.trim());
    if (!m) throw new Error('Exception: Unparseable date: "' + str + '"');
    var v = { y: 1970, M: 1, d: 1, H: 0, m: 0, s: 0 };
    keys.forEach(function (k, idx) { v[k] = Number(m[idx + 1]); });
    return wallToDate(v.y, v.M, v.d, v.H, v.m, v.s, tz);
  }

  /* ------------------------------------------------------------------ */
  /* Notación A1                                                         */
  /* ------------------------------------------------------------------ */
  function colToNum(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function a1(r, c) { return numToCol(c) + r; }
  // 'A1' | 'A1:C3' | 'B2:B' | 'A:A' | '2:5' | "'Hoja'!A1:B2" → {r, c, nr, nc} (con maxRows/maxCols de la hoja)
  function parseA1(sheet, s) {
    var str = String(s).trim().replace(/^.*!/, '').toUpperCase().replace(/\$/g, '');
    var parts = str.split(':');
    var ref = /^([A-Z]*)(\d*)$/;
    var p1 = ref.exec(parts[0]), p2 = parts.length > 1 ? ref.exec(parts[1]) : p1;
    if (!p1 || !p2 || parts.length > 2 || (!p1[1] && !p1[2])) throw new Error('Exception: Range not found');
    var c1 = p1[1] ? colToNum(p1[1]) : 1, r1 = p1[2] ? Number(p1[2]) : 1;
    var c2 = p2[1] ? colToNum(p2[1]) : sheet._maxCols, r2 = p2[2] ? Number(p2[2]) : sheet._maxRows;
    if (parts.length === 1) { c2 = c1; r2 = r1; if (!p1[1] || !p1[2]) throw new Error('Exception: Range not found'); }
    return { r: Math.min(r1, r2), c: Math.min(c1, c2), nr: Math.abs(r2 - r1) + 1, nc: Math.abs(c2 - c1) + 1 };
  }

  /* ------------------------------------------------------------------ */
  /* Conversión al escribir (como si un usuario tipeara el texto)         */
  /* ------------------------------------------------------------------ */
  function coerce(v, nf) {
    if (v === null || v === undefined) return '';
    if (isDate(v)) {
      if (isNaN(v.getTime())) { warn('Se escribió un Date inválido en una celda'); return ''; }
      return new Date(v.getTime());
    }
    var t = typeof v;
    if (t === 'number') { if (!isFinite(v)) warn('Se escribió un número no finito (' + v + ') en una celda'); return v; }
    if (t === 'boolean') return v;
    if (t !== 'string') { warn('Se escribió un ' + typeName(v) + ' en una celda (se guarda como texto)'); return String(v); }
    if (v.charAt(0) === "'") return v.slice(1);
    if (!M.coerce || nf === '@') return v;
    var s = v.trim();
    if (/^-?\d{1,15}$/.test(s)) return Number(s);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) return d;
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // es_CL: dd/MM/yyyy
    if (m) {
      var d2 = new Date(+m[3], +m[2] - 1, +m[1]);
      if (d2.getMonth() === +m[2] - 1 && d2.getDate() === +m[1]) return d2;
    }
    if (/^(true|verdadero)$/i.test(s)) return true;
    if (/^(false|falso)$/i.test(s)) return false;
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* Evaluador de fórmulas (subconjunto)                                 */
  /* ------------------------------------------------------------------ */
  function FErr(code) { this.code = code; }
  function evalFormula(sheet, formula, depth) {
    if ((depth || 0) > 30) throw new FErr('#REF!');
    var s = formula.replace(/^=/, ''), i = 0;
    function ws() { while (s.charAt(i) === ' ') i++; }
    function num(v) {
      if (Array.isArray(v)) v = v[0];
      if (typeof v === 'number') return v;
      if (v === '' || v == null) return 0;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
      if (v instanceof FErr) throw v;
      throw new FErr('#VALUE!');
    }
    function cellVal(r, c) {
      var cell = sheet._cell(r, c);
      if (!cell) return '';
      if (cell.f) return evalCell(sheet, cell, depth + 1);
      return cell.v;
    }
    function cmp() {
      var a = expr();
      ws();
      var m = /^(<=|>=|<>|=|<|>)/.exec(s.slice(i));
      if (!m) return a;
      i += m[0].length;
      var b = expr();
      var x = typeof a === 'string' || typeof b === 'string' ? [String(a), String(b)] : [num(a), num(b)];
      switch (m[0]) {
        case '=': return x[0] === x[1];
        case '<>': return x[0] !== x[1];
        case '<': return x[0] < x[1];
        case '>': return x[0] > x[1];
        case '<=': return x[0] <= x[1];
        default: return x[0] >= x[1];
      }
    }
    function expr() {
      var v = term();
      for (;;) {
        ws();
        var c = s.charAt(i);
        if (c === '+' || c === '-') { i++; var r = term(); v = c === '+' ? num(v) + num(r) : num(v) - num(r); }
        else if (c === '&') { i++; var r2 = term(); v = String(Array.isArray(v) ? v[0] : v) + String(Array.isArray(r2) ? r2[0] : r2); }
        else return v;
      }
    }
    function term() {
      var v = unary();
      for (;;) {
        ws();
        var c = s.charAt(i);
        if (c === '*' || c === '/') {
          i++;
          var r = unary();
          if (c === '/' && num(r) === 0) throw new FErr('#DIV/0!');
          v = c === '*' ? num(v) * num(r) : num(v) / num(r);
        } else return v;
      }
    }
    function unary() {
      ws();
      if (s.charAt(i) === '-') { i++; return -num(unary()); }
      if (s.charAt(i) === '+') { i++; return num(unary()); }
      return primary();
    }
    function args() {
      var out = [];
      ws();
      if (s.charAt(i) === ')') { i++; return out; }
      for (;;) {
        out.push(cmp());
        ws();
        var c = s.charAt(i);
        if (c === ',' || c === ';') { i++; continue; }
        if (c === ')') { i++; return out; }
        throw new FErr('#ERROR!');
      }
    }
    function flat(list) {
      var out = [];
      list.forEach(function (x) { if (Array.isArray(x)) out.push.apply(out, x); else out.push(x); });
      return out;
    }
    function nums(list) { return flat(list).filter(function (x) { return typeof x === 'number'; }); }
    function primary() {
      ws();
      var rest = s.slice(i), m;
      if (s.charAt(i) === '(') { i++; var v = cmp(); ws(); if (s.charAt(i) !== ')') throw new FErr('#ERROR!'); i++; return v; }
      if (s.charAt(i) === '"') {
        var j = i + 1, str = '';
        while (j < s.length) { if (s.charAt(j) === '"') { if (s.charAt(j + 1) === '"') { str += '"'; j += 2; continue; } break; } str += s.charAt(j); j++; }
        i = j + 1; return str;
      }
      if ((m = /^\d+(\.\d+)?/.exec(rest))) { i += m[0].length; return Number(m[0]); }
      if ((m = /^([A-Za-z][A-Za-z0-9.]*)\s*\(/.exec(rest))) {
        i += m[0].length;
        var fn = m[1].toUpperCase(), a = args();
        switch (fn) {
          case 'SUM': return nums(a).reduce(function (x, y) { return x + y; }, 0);
          case 'MAX': { var n1 = nums(a); return n1.length ? Math.max.apply(null, n1) : 0; }
          case 'MIN': { var n2 = nums(a); return n2.length ? Math.min.apply(null, n2) : 0; }
          case 'ABS': return Math.abs(num(a[0]));
          case 'ROUND': { var k = Math.pow(10, a.length > 1 ? num(a[1]) : 0); return Math.round(num(a[0]) * k) / k; }
          case 'IF': return (Array.isArray(a[0]) ? a[0][0] : a[0]) ? (a.length > 1 ? a[1] : true) : (a.length > 2 ? a[2] : false);
          case 'AND': return flat(a).every(Boolean);
          case 'OR': return flat(a).some(Boolean);
          case 'IFERROR': return a[0];
          default: throw new FErr('#NAME?');
        }
      }
      if ((m = /^(TRUE|FALSE)\b/i.exec(rest))) { i += m[0].length; return m[1].toUpperCase() === 'TRUE'; }
      if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/.exec(rest))) {
        i += m[0].length;
        var c1 = colToNum(m[1].toUpperCase()), r1 = Number(m[2]);
        if (!m[3]) return cellVal(r1, c1);
        var c2 = colToNum(m[3].toUpperCase()), r2 = Number(m[4]), out = [];
        for (var r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (var c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(cellVal(r, c));
        return out;
      }
      throw new FErr('#ERROR!');
    }
    var res = cmp();
    ws();
    if (i < s.length) throw new FErr('#ERROR!');
    return Array.isArray(res) ? (res.length ? res[0] : '') : res;
  }
  function evalCell(sheet, cell, depth) {
    try {
      return evalFormula(sheet, cell.f, depth || 0);
    } catch (e) {
      if (e instanceof FErr) return e.code === '#NAME?' && cell.v !== '' && cell.v !== undefined ? cell.v : e.code;
      throw e;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Range                                                               */
  /* ------------------------------------------------------------------ */
  function MRange(sheet, r, c, nr, nc) {
    this._sh = sheet; this._r = r; this._c = c; this._nr = nr; this._nc = nc;
  }
  MRange.prototype = {
    _each: function (fn) {
      for (var i = 0; i < this._nr; i++) for (var j = 0; j < this._nc; j++) fn(this._r + i, this._c + j, i, j);
    },
    _grid: function (fn) {
      var out = [];
      for (var i = 0; i < this._nr; i++) {
        var row = [];
        for (var j = 0; j < this._nc; j++) row.push(fn(this._r + i, this._c + j));
        out.push(row);
      }
      return out;
    },
    _value: function (r, c) {
      var cell = this._sh._cell(r, c);
      if (!cell) return '';
      if (cell.f) return cloneVal(evalCell(this._sh, cell, 0));
      return cloneVal(cell.v);
    },
    getValues: function () { var self = this; return this._grid(function (r, c) { return self._value(r, c); }); },
    getValue: function () { return this._value(this._r, this._c); },
    getDisplayValues: function () { var self = this; return this._grid(function (r, c) { return self._sh._display(r, c, self._value(r, c)); }); },
    getDisplayValue: function () { return this._sh._display(this._r, this._c, this.getValue()); },
    getFormulas: function () { var sh = this._sh; return this._grid(function (r, c) { var cell = sh._cell(r, c); return cell && cell.f ? cell.f : ''; }); },
    getFormula: function () { var cell = this._sh._cell(this._r, this._c); return cell && cell.f ? cell.f : ''; },
    getNumberFormats: function () { var sh = this._sh; return this._grid(function (r, c) { var cell = sh._cell(r, c); return cell && cell.nf ? cell.nf : '0.###############'; }); },
    getNumberFormat: function () { return this.getNumberFormats()[0][0]; },
    getBackgrounds: function () { var sh = this._sh; return this._grid(function (r, c) { var cell = sh._cell(r, c); return cell && cell.bg ? cell.bg : '#ffffff'; }); },
    getBackground: function () { return this.getBackgrounds()[0][0]; },
    getFontWeights: function () { var sh = this._sh; return this._grid(function (r, c) { var cell = sh._cell(r, c); return cell && cell.fw ? cell.fw : 'normal'; }); },
    getFontWeight: function () { return this.getFontWeights()[0][0]; },
    getDataValidation: function () { var cell = this._sh._cell(this._r, this._c); return cell && cell.dv ? cell.dv : null; },
    getDataValidations: function () { var sh = this._sh; return this._grid(function (r, c) { var cell = sh._cell(r, c); return cell && cell.dv ? cell.dv : null; }); },

    setValues: function (values) {
      if (!Array.isArray(values) || (values.length && !Array.isArray(values[0]))) throw sigError('SpreadsheetApp.Range.setValues', [values]);
      if (values.length !== this._nr) throw new Error('Exception: The number of rows in the data does not match the number of rows in the range. The data has ' + values.length + ' but the range has ' + this._nr + '.');
      for (var i = 0; i < values.length; i++) {
        if (!Array.isArray(values[i])) throw sigError('SpreadsheetApp.Range.setValues', [values]);
        if (values[i].length !== this._nc) throw new Error('Exception: The number of columns in the data does not match the number of columns in the range. The data has ' + values[i].length + ' but the range has ' + this._nc + '.');
      }
      var sh = this._sh;
      this._each(function (r, c, i, j) { sh._write(r, c, values[i][j]); });
      return this;
    },
    setValue: function (v) {
      if (arguments.length === 0) throw sigError('SpreadsheetApp.Range.setValue', arguments);
      var sh = this._sh;
      this._each(function (r, c) { sh._write(r, c, v); });
      return this;
    },
    setFormula: function (f) {
      var sh = this._sh, s = String(f);
      this._each(function (r, c) { sh._write(r, c, s.charAt(0) === '=' ? s : '=' + s); });
      return this;
    },
    setFormulas: function (fs) {
      if (!Array.isArray(fs) || fs.length !== this._nr) throw new Error('Exception: The number of rows in the data does not match the number of rows in the range.');
      var sh = this._sh;
      this._each(function (r, c, i, j) { sh._write(r, c, fs[i][j]); });
      return this;
    },
    setNumberFormat: function (f) { var sh = this._sh; this._each(function (r, c) { sh._ensure(r, c).nf = String(f); }); return this; },
    setNumberFormats: function (fs) {
      if (!Array.isArray(fs) || fs.length !== this._nr || (fs[0] || []).length !== this._nc) throw new Error('Exception: The number of rows in the data does not match the number of rows in the range.');
      var sh = this._sh;
      this._each(function (r, c, i, j) { sh._ensure(r, c).nf = String(fs[i][j]); });
      return this;
    },
    setBackground: function (bg) { var sh = this._sh; this._each(function (r, c) { sh._ensure(r, c).bg = bg; }); return this; },
    setFontWeight: function (w) { var sh = this._sh; this._each(function (r, c) { sh._ensure(r, c).fw = w; }); return this; },
    setDataValidation: function (rule) { var sh = this._sh; this._each(function (r, c) { sh._ensure(r, c).dv = rule; }); return this; },
    setDataValidations: function (rules) { var sh = this._sh; this._each(function (r, c, i, j) { sh._ensure(r, c).dv = rules[i][j]; }); return this; },
    clearDataValidations: function () { var sh = this._sh; this._each(function (r, c) { var cell = sh._cell(r, c); if (cell) cell.dv = null; }); return this; },
    setFontColor: function () { return this; },
    setFontSize: function () { return this; },
    setFontFamily: function () { return this; },
    setFontStyle: function () { return this; },
    setHorizontalAlignment: function () { return this; },
    setVerticalAlignment: function () { return this; },
    setWrap: function () { return this; },
    setWrapStrategy: function () { return this; },
    setBorder: function () { return this; },
    setNote: function () { return this; },
    setTextStyle: function () { return this; },
    clearContent: function () { var sh = this._sh; this._each(function (r, c) { var cell = sh._cell(r, c); if (cell) { cell.v = ''; cell.f = ''; } }); sh._dirty = true; return this; },
    clearFormat: function () { var sh = this._sh; this._each(function (r, c) { var cell = sh._cell(r, c); if (cell) { cell.nf = ''; cell.bg = ''; cell.fw = ''; } }); return this; },
    clear: function (opts) {
      if (opts && (opts.contentsOnly || opts.formatOnly)) { if (opts.contentsOnly) this.clearContent(); if (opts.formatOnly) this.clearFormat(); return this; }
      var sh = this._sh; this._each(function (r, c) { var row = sh._rows[r - 1]; if (row) row[c - 1] = undefined; }); sh._dirty = true; return this;
    },
    copyFormatToRange: function (target, c1, c2, r1, r2) {
      var dest = (target && target._rows) ? target : this._sh;
      for (var r = r1; r <= r2; r++) {
        for (var c = c1; c <= c2; c++) {
          var src = this._sh._cell(this._r + ((r - r1) % this._nr), this._c + ((c - c1) % this._nc));
          var cell = dest._ensure(r, c);
          cell.nf = src ? src.nf : ''; cell.bg = src ? src.bg : ''; cell.fw = src ? src.fw : '';
        }
      }
    },
    copyTo: function (dest, opts) {
      var vals = this.getValues(), forms = this.getFormulas();
      var t = dest;
      for (var i = 0; i < this._nr; i++) for (var j = 0; j < this._nc; j++) {
        if (opts && opts.formatOnly) continue;
        t._sh._write(t._r + i, t._c + j, forms[i][j] || vals[i][j]);
      }
    },
    getRow: function () { return this._r; },
    getColumn: function () { return this._c; },
    getLastRow: function () { return this._r + this._nr - 1; },
    getLastColumn: function () { return this._c + this._nc - 1; },
    getNumRows: function () { return this._nr; },
    getNumColumns: function () { return this._nc; },
    getHeight: function () { return this._nr; },
    getWidth: function () { return this._nc; },
    getSheet: function () { return this._sh._proxy; },
    getA1Notation: function () { return this._nr === 1 && this._nc === 1 ? a1(this._r, this._c) : a1(this._r, this._c) + ':' + a1(this._r + this._nr - 1, this._c + this._nc - 1); },
    getCell: function (r, c) { if (r < 1 || c < 1 || r > this._nr || c > this._nc) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.'); return this._sh._range(this._r + r - 1, this._c + c - 1, 1, 1); },
    offset: function (ro, co, nr, nc) { return this._sh._range(this._r + ro, this._c + co, nr || this._nr, nc || this._nc); },
    isBlank: function () { var vals = this.getValues(), f = this.getFormulas(); return vals.every(function (row, i) { return row.every(function (v, j) { return v === '' && !f[i][j]; }); }); },
    activate: function () { this._sh._ss._active = this._sh._self; return this; },
  };

  /* ------------------------------------------------------------------ */
  /* Sheet                                                               */
  /* ------------------------------------------------------------------ */
  function MSheet(ss, name, opts) {
    opts = opts || {};
    this._ss = ss;
    this._name = name;
    this._id = opts.id != null ? opts.id : ss._nextId();
    this._maxRows = opts.maxRows || 1000;
    this._maxCols = opts.maxCols || 26;
    this._rows = [];
    this._hidden = !!opts.hidden;
    this._frozenRows = 0;
    this._frozenCols = 0;
    this._widths = {};
    this._dirty = true;
    this._last = { r: 0, c: 0 };
    this._self = this;
    this._proxy = wrap(this, 'Sheet');
  }
  MSheet.prototype = {
    _cell: function (r, c) { var row = this._rows[r - 1]; return row ? row[c - 1] || null : null; },
    _ensure: function (r, c) {
      var row = this._rows[r - 1];
      if (!row) row = this._rows[r - 1] = [];
      var cell = row[c - 1];
      if (!cell) cell = row[c - 1] = { v: '', f: '', nf: '', bg: '', fw: '', dv: null };
      return cell;
    },
    _write: function (r, c, v) {
      var cell = this._ensure(r, c);
      if (typeof v === 'string' && v.length > 1 && v.charAt(0) === '=') { cell.f = v; cell.v = ''; }
      else { cell.f = ''; cell.v = coerce(v, cell.nf); }
      this._dirty = true;
    },
    _display: function (r, c, v) {
      var cell = this._cell(r, c), nf = cell ? cell.nf : '';
      if (isDate(v)) return formatDate(v, M.ssTz, /h/.test(nf || '') ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
      if (typeof v === 'number') return /#,##0/.test(nf || '') ? Math.round(v).toLocaleString('es-CL') : String(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return String(v == null ? '' : v);
    },
    _calcLast: function () {
      if (!this._dirty) return this._last;
      var lr = 0, lc = 0;
      for (var i = 0; i < this._rows.length; i++) {
        var row = this._rows[i];
        if (!row) continue;
        for (var j = 0; j < row.length; j++) {
          var cell = row[j];
          if (cell && (cell.f || (cell.v !== '' && cell.v != null))) { lr = i + 1; if (j + 1 > lc) lc = j + 1; }
        }
      }
      this._last = { r: lr, c: lc };
      this._dirty = false;
      return this._last;
    },
    _range: function (r, c, nr, nc) {
      if (r < 1) throw new Error('Exception: The starting row of the range is too small.');
      if (c < 1) throw new Error('Exception: The starting column of the range is too small.');
      if (nr < 1) throw new Error('Exception: The number of rows in the range must be at least 1.');
      if (nc < 1) throw new Error('Exception: The number of columns in the range must be at least 1.');
      if (r + nr - 1 > this._maxRows || c + nc - 1 > this._maxCols) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
      return wrap(new MRange(this, r, c, nr, nc), 'Range');
    },
    // Ajusta referencias de fila en las fórmulas de esta hoja (desde la fila `from`, delta filas; delta<0 = borrado)
    _shiftRefs: function (from, delta) {
      var re = /("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\d(A-Za-z])/g;
      this._rows.forEach(function (row) {
        (row || []).forEach(function (cell) {
          if (!cell || !cell.f) return;
          cell.f = cell.f.replace(re, function (m, str, d1, col, d2, rowNum) {
            if (str) return str;
            var r = Number(rowNum);
            if (r < from) return m;
            if (delta < 0 && r < from - delta) return '#REF!';
            return d1 + col + d2 + (r + delta);
          });
        });
      });
    },
    _assertCanDeleteRows: function (n) {
      if (this._maxRows - n <= this._frozenRows) throw new Error('Exception: Sorry, it is not possible to delete all non-frozen rows.');
    },

    getName: function () { return this._name; },
    setName: function (name) {
      name = String(name);
      var ss = this._ss, self = this._self;
      if (ss._sheets.some(function (s) { return s !== self && s._name.toLowerCase() === name.toLowerCase(); })) {
        throw new Error('Exception: A sheet with the name "' + name + '" already exists. Please enter another name.');
      }
      this._name = name;
      return this._proxy;
    },
    getSheetId: function () { return this._id; },
    getSheetName: function () { return this._name; },
    getIndex: function () { return this._ss._sheets.indexOf(this._self) + 1; },
    getParent: function () { return this._ss._proxy; },
    getType: function () { return 'GRID'; },
    getRange: function (a, b, c, d) {
      if (typeof a === 'string' && arguments.length === 1) {
        var p = parseA1(this, a);
        return this._range(p.r, p.c, p.nr, p.nc);
      }
      var n = arguments.length;
      for (var i = 0; i < n; i++) if (!isInt(arguments[i])) throw sigError('SpreadsheetApp.Sheet.getRange', arguments);
      if (n < 2) throw sigError('SpreadsheetApp.Sheet.getRange', arguments);
      return this._range(a, b, n >= 3 ? c : 1, n >= 4 ? d : 1);
    },
    getRangeList: function (list) {
      var self = this;
      var ranges = (list || []).map(function (s) { return self.getRange(s); });
      var rl = {
        getRanges: function () { return ranges.slice(); },
        setNumberFormat: function (f) { ranges.forEach(function (r) { r.setNumberFormat(f); }); return rlp; },
        setValue: function (v) { ranges.forEach(function (r) { r.setValue(v); }); return rlp; },
        setFontWeight: function (w) { ranges.forEach(function (r) { r.setFontWeight(w); }); return rlp; },
        setBackground: function (b) { ranges.forEach(function (r) { r.setBackground(b); }); return rlp; },
        clearContent: function () { ranges.forEach(function (r) { r.clearContent(); }); return rlp; },
        clear: function () { ranges.forEach(function (r) { r.clear(); }); return rlp; },
        setDataValidation: function (dv) { ranges.forEach(function (r) { r.setDataValidation(dv); }); return rlp; },
      };
      var rlp = wrap(rl, 'RangeList');
      return rlp;
    },
    getDataRange: function () {
      var l = this._calcLast();
      return this._range(1, 1, Math.max(l.r, 1), Math.max(l.c, 1));
    },
    getLastRow: function () { return this._calcLast().r; },
    getLastColumn: function () { return this._calcLast().c; },
    getMaxRows: function () { return this._maxRows; },
    getMaxColumns: function () { return this._maxCols; },
    appendRow: function (arr) {
      if (!Array.isArray(arr)) throw sigError('SpreadsheetApp.Sheet.appendRow', arguments);
      var r = this._calcLast().r + 1;
      if (r > this._maxRows) this._maxRows = r;
      if (arr.length > this._maxCols) this._maxCols = arr.length;
      for (var j = 0; j < arr.length; j++) this._write(r, j + 1, arr[j]);
      return this._proxy;
    },
    insertRowsAfter: function (after, n) {
      if (!isInt(after) || !isInt(n) || n < 1) throw sigError('SpreadsheetApp.Sheet.insertRowsAfter', arguments);
      if (after < 1 || after > this._maxRows) throw new Error('Exception: Those rows are out of bounds.');
      var ref = this._rows[after - 1], add = [];
      for (var k = 0; k < n; k++) add.push(ref ? ref.map(function (cell) { return cell ? { v: '', f: '', nf: cell.nf, bg: '', fw: '', dv: cell.dv } : undefined; }) : undefined);
      while (this._rows.length < after) this._rows.push(undefined);
      Array.prototype.splice.apply(this._rows, [after, 0].concat(add));
      this._maxRows += n; this._dirty = true;
      this._shiftRefs(after + 1, n);
      return this._proxy;
    },
    insertRowAfter: function (after) { return this.insertRowsAfter(after, 1); },
    insertRowsBefore: function (before, n) {
      if (!isInt(before) || !isInt(n) || n < 1) throw sigError('SpreadsheetApp.Sheet.insertRowsBefore', arguments);
      if (before < 1 || before > this._maxRows) throw new Error('Exception: Those rows are out of bounds.');
      var add = [];
      for (var k = 0; k < n; k++) add.push(undefined);
      while (this._rows.length < before - 1) this._rows.push(undefined);
      Array.prototype.splice.apply(this._rows, [before - 1, 0].concat(add));
      this._maxRows += n; this._dirty = true;
      this._shiftRefs(before, n);
      return this._proxy;
    },
    insertRowBefore: function (before) { return this.insertRowsBefore(before, 1); },
    insertRows: function (before, n) { return this.insertRowsBefore(before, n || 1); },
    deleteRows: function (start, n) {
      if (!isInt(start) || !isInt(n)) throw sigError('SpreadsheetApp.Sheet.deleteRows', arguments);
      if (start < 1 || n < 1 || start + n - 1 > this._maxRows) throw new Error('Exception: Those rows are out of bounds.');
      this._assertCanDeleteRows(n);
      this._rows.splice(start - 1, n);
      this._maxRows -= n; this._dirty = true;
      this._shiftRefs(start, -n);
    },
    deleteRow: function (r) { this.deleteRows(r, 1); return this._proxy; },
    insertColumnsAfter: function (after, n) {
      if (!isInt(after) || !isInt(n) || n < 1) throw sigError('SpreadsheetApp.Sheet.insertColumnsAfter', arguments);
      if (after < 1 || after > this._maxCols) throw new Error('Exception: Those columns are out of bounds.');
      this._rows.forEach(function (row) {
        if (!row) return;
        var ref = row[after - 1], add = [];
        for (var k = 0; k < n; k++) add.push(ref ? { v: '', f: '', nf: ref.nf, bg: ref.bg, fw: ref.fw, dv: null } : undefined);
        while (row.length < after) row.push(undefined);
        Array.prototype.splice.apply(row, [after, 0].concat(add));
      });
      this._maxCols += n; this._dirty = true;
      return this._proxy;
    },
    insertColumnAfter: function (after) { return this.insertColumnsAfter(after, 1); },
    insertColumnsBefore: function (before, n) {
      if (!isInt(before) || !isInt(n) || n < 1) throw sigError('SpreadsheetApp.Sheet.insertColumnsBefore', arguments);
      this._rows.forEach(function (row) {
        if (!row) return;
        var add = [];
        for (var k = 0; k < n; k++) add.push(undefined);
        while (row.length < before - 1) row.push(undefined);
        Array.prototype.splice.apply(row, [before - 1, 0].concat(add));
      });
      this._maxCols += n; this._dirty = true;
      return this._proxy;
    },
    insertColumnBefore: function (before) { return this.insertColumnsBefore(before, 1); },
    deleteColumns: function (start, n) {
      if (start < 1 || n < 1 || start + n - 1 > this._maxCols) throw new Error('Exception: Those columns are out of bounds.');
      if (this._maxCols - n <= this._frozenCols) throw new Error('Exception: Sorry, it is not possible to delete all non-frozen columns.');
      this._rows.forEach(function (row) { if (row) row.splice(start - 1, n); });
      this._maxCols -= n; this._dirty = true;
    },
    deleteColumn: function (c) { this.deleteColumns(c, 1); return this._proxy; },
    clear: function () { this._rows = []; this._dirty = true; return this._proxy; },
    clearContents: function () { this._rows.forEach(function (row) { (row || []).forEach(function (cell) { if (cell) { cell.v = ''; cell.f = ''; } }); }); this._dirty = true; return this._proxy; },
    clearFormats: function () { this._rows.forEach(function (row) { (row || []).forEach(function (cell) { if (cell) { cell.nf = ''; cell.bg = ''; cell.fw = ''; } }); }); return this._proxy; },
    hideSheet: function () {
      var self = this._self;
      var visible = this._ss._sheets.filter(function (s) { return !s._hidden && s !== self; });
      if (!this._hidden && !visible.length) throw new Error("Exception: You can't hide all the sheets in a document.");
      this._hidden = true;
      if (this._ss._active === self) this._ss._active = visible[0] || self;
      return this._proxy;
    },
    showSheet: function () { this._hidden = false; return this._proxy; },
    isSheetHidden: function () { return this._hidden; },
    setFrozenRows: function (n) {
      if (!isInt(n) || n < 0) throw sigError('SpreadsheetApp.Sheet.setFrozenRows', arguments);
      if (n >= this._maxRows) throw new Error('Exception: Sorry, it is not possible to freeze all rows.');
      this._frozenRows = n; return this._proxy;
    },
    getFrozenRows: function () { return this._frozenRows; },
    setFrozenColumns: function (n) { this._frozenCols = n; return this._proxy; },
    getFrozenColumns: function () { return this._frozenCols; },
    setColumnWidth: function (c, w) {
      if (!isInt(c) || typeof w !== 'number') throw sigError('SpreadsheetApp.Sheet.setColumnWidth', arguments);
      if (c < 1 || c > this._maxCols) throw new Error('Exception: Those columns are out of bounds.');
      this._widths[c] = w; return this._proxy;
    },
    setColumnWidths: function (c, n, w) { for (var k = 0; k < n; k++) this.setColumnWidth(c + k, w); return this._proxy; },
    getColumnWidth: function (c) { return this._widths[c] || 100; },
    setRowHeight: function () { return this._proxy; },
    setRowHeights: function () { return this._proxy; },
    setRowHeightsForced: function () { return this._proxy; },
    autoResizeColumns: function () { return this._proxy; },
    autoResizeColumn: function () { return this._proxy; },
    hideColumns: function () { return this._proxy; },
    showColumns: function () { return this._proxy; },
    hideRows: function () { return this._proxy; },
    showRows: function () { return this._proxy; },
    setTabColor: function () { return this._proxy; },
    setHiddenGridlines: function () { return this._proxy; },
    activate: function () { this._ss._active = this._self; return this._proxy; },
    getFilter: function () { return null; },
    getCharts: function () { return []; },
    getNamedRanges: function () { return []; },
    getProtections: function () { return []; },
    protect: function () { return wrap({ setDescription: function () { return this; }, setWarningOnly: function () { return this; }, removeEditors: function () { return this; }, addEditor: function () { return this; } }, 'Protection'); },
    toString: function () { return 'Sheet'; },
  };

  /* ------------------------------------------------------------------ */
  /* Spreadsheet                                                         */
  /* ------------------------------------------------------------------ */
  function MSpreadsheet(name, id) {
    this._name = name || 'Cuadre AACC (mock)';
    this._id = id || 'MOCK-SPREADSHEET-ID';
    this._sheets = [];
    this._active = null;
    this._seq = 0;
    this._proxy = wrap(this, 'Spreadsheet');
  }
  MSpreadsheet.prototype = {
    _nextId: function () { this._seq++; return this._seq === 1 ? 0 : 100000000 + this._seq * 7919; },
    _add: function (name, index, opts) {
      name = String(name);
      if (this._sheets.some(function (s) { return s._name.toLowerCase() === name.toLowerCase(); })) {
        throw new Error('Exception: A sheet with the name "' + name + '" already exists. Please enter another name.');
      }
      var sh = new MSheet(this, name, opts);
      var at = index == null ? this._sheets.length : Math.max(0, Math.min(index, this._sheets.length));
      this._sheets.splice(at, 0, sh);
      return sh;
    },
    getId: function () { return this._id; },
    getName: function () { return this._name; },
    rename: function (n) { this._name = String(n); },
    getUrl: function () { return SHEET_URL_BASE + this._id + '/edit'; },
    getSpreadsheetTimeZone: function () { return M.ssTz; },
    setSpreadsheetTimeZone: function (tz) { M.ssTz = tz; },
    getSpreadsheetLocale: function () { return M.locale; },
    getSheets: function () { return this._sheets.map(function (s) { return s._proxy; }); },
    getNumSheets: function () { return this._sheets.length; },
    getSheetByName: function (name) {
      var s = this._sheets.find(function (x) { return x._name === String(name); });
      return s ? s._proxy : null;
    },
    getSheetById: function (id) { var s = this._sheets.find(function (x) { return x._id === id; }); return s ? s._proxy : null; },
    insertSheet: function (a, b) {
      var name, index;
      if (typeof a === 'number') { index = a; name = null; }
      else { name = a; index = typeof b === 'number' ? b : null; }
      if (name == null || name === '') { var k = this._sheets.length + 1; while (this.getSheetByName('Hoja ' + k)) k++; name = 'Hoja ' + k; }
      var sh = this._add(name, index == null ? null : index);
      this._active = sh;
      return sh._proxy;
    },
    deleteSheet: function (sheet) {
      var real = this._sheets.find(function (s) { return s._proxy === sheet || s === sheet; });
      if (!real) throw new Error('Exception: Sheet not found');
      if (this._sheets.length === 1) throw new Error("Exception: You can't remove all the sheets in a document.");
      this._sheets.splice(this._sheets.indexOf(real), 1);
      if (this._active === real) this._active = this._sheets[0];
    },
    getActiveSheet: function () { return (this._active || this._sheets[0] || null) && (this._active || this._sheets[0])._proxy; },
    setActiveSheet: function (sheet) {
      var real = this._sheets.find(function (s) { return s._proxy === sheet || s === sheet; });
      if (real) this._active = real;
      return sheet;
    },
    getActiveRange: function () { return null; },
    toast: function (msg, title, secs) { M.toasts.push({ msg: String(msg), title: title == null ? '' : String(title), secs: secs }); },
    getRangeByName: function () { return null; },
    getOwner: function () { return { getEmail: function () { return M.effectiveUser; } }; },
    getEditors: function () { return []; },
    moveActiveSheet: function (pos) {
      var a = this._active || this._sheets[0];
      this._sheets.splice(this._sheets.indexOf(a), 1);
      this._sheets.splice(pos - 1, 0, a);
    },
    toString: function () { return 'Spreadsheet'; },
  };

  /* ------------------------------------------------------------------ */
  /* Servicios                                                           */
  /* ------------------------------------------------------------------ */
  function chainBuilder(cls, build) {
    var calls = [];
    var p;
    var target = {};
    p = (typeof Proxy !== 'undefined') ? new Proxy(target, {
      get: function (t, prop) {
        if (prop === 'build') return function () { return build(calls); };
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return function () { calls.push([prop].concat(Array.prototype.slice.call(arguments))); return p; };
      },
    }) : target;
    return p;
  }

  function ss() {
    if (!STATE) throw new Error('MOCK sin inicializar: llama MOCK.reset()');
    return STATE.ss;
  }

  var Ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    createMenu: function (name) {
      var menu = { name: name, items: [] };
      var api = {
        addItem: function (caption, fn) { menu.items.push([caption, fn]); return api; },
        addSeparator: function () { menu.items.push(['---']); return api; },
        addSubMenu: function (sub) { menu.items.push(['>', sub]); return api; },
        addToUi: function () { (STATE.menus = STATE.menus || []).push(menu); },
      };
      return api;
    },
    createAddonMenu: function () { return Ui.createMenu('Add-on'); },
    alert: function (a, b, c) { M.alerts.push({ title: b === undefined ? '' : a, message: b === undefined ? a : b, buttons: c }); return 'OK'; },
    prompt: function () { return { getResponseText: function () { return ''; }, getSelectedButton: function () { return 'CANCEL'; } }; },
    showModalDialog: function () {},
    showModelessDialog: function () {},
    showSidebar: function () {},
  };

  var SpreadsheetApp = {
    getActiveSpreadsheet: function () { return M.bound ? ss()._proxy : null; },
    getActive: function () { return M.bound ? ss()._proxy : null; },
    openById: function (id) {
      if (String(id) === ss()._id) return ss()._proxy;
      throw new Error('Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.');
    },
    openByUrl: function (url) {
      if (String(url).indexOf(ss()._id) >= 0) return ss()._proxy;
      throw new Error('Exception: Unexpected error while getting the method or property openByUrl on object SpreadsheetApp.');
    },
    flush: function () { M.stats.flush++; },
    getUi: function () {
      if (!M.ui) throw new Error('Exception: Cannot call SpreadsheetApp.getUi() from this context.');
      return Ui;
    },
    newDataValidation: function () { return chainBuilder('DataValidationBuilder', function (calls) { return { __dataValidation: true, calls: calls }; }); },
    newConditionalFormatRule: function () { return chainBuilder('ConditionalFormatRuleBuilder', function (calls) { return { __cf: true, calls: calls }; }); },
    newRichTextValue: function () { return chainBuilder('RichTextValueBuilder', function (calls) { return { __rich: true, calls: calls }; }); },
    getActiveSheet: function () { return ss().getActiveSheet(); },
    setActiveSheet: function (s) { return ss().setActiveSheet(s); },
    BorderStyle: { SOLID: 'SOLID', DOTTED: 'DOTTED', DASHED: 'DASHED' },
    WrapStrategy: { WRAP: 'WRAP', CLIP: 'CLIP', OVERFLOW: 'OVERFLOW' },
    DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', CHECKBOX: 'CHECKBOX' },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    Dimension: { ROWS: 'ROWS', COLUMNS: 'COLUMNS' },
  };

  function Properties(name) { this._name = name; }
  Properties.prototype = {
    _s: function () { return STATE.props[this._name]; },
    getProperty: function (k) { var s = this._s(); return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
    setProperty: function (k, v) {
      if (k == null) throw sigError('PropertiesService.Properties.setProperty', arguments);
      var str = String(v);
      if (str.length > 9 * 1024) throw new Error('Exception: Argument too large: value');
      this._s()[String(k)] = str; return this;
    },
    setProperties: function (obj, deleteOthers) {
      if (deleteOthers) STATE.props[this._name] = {};
      var self = this;
      Object.keys(obj || {}).forEach(function (k) { self.setProperty(k, obj[k]); });
      return this;
    },
    getProperties: function () { return Object.assign({}, this._s()); },
    getKeys: function () { return Object.keys(this._s()); },
    deleteProperty: function (k) { delete this._s()[k]; return this; },
    deleteAllProperties: function () { STATE.props[this._name] = {}; return this; },
  };
  var PropertiesService = {
    getScriptProperties: function () { return new Properties('script'); },
    getUserProperties: function () { return new Properties('user'); },
    getDocumentProperties: function () { return new Properties('document'); },
  };

  function Cache(name) { this._name = name; }
  Cache.prototype = {
    _s: function () { return STATE.cache[this._name]; },
    get: function (k) {
      var e = this._s()[k];
      if (!e) return null;
      if (e.exp < Date.now()) { delete this._s()[k]; return null; }
      return e.v;
    },
    put: function (k, v, ttl) {
      if (typeof v !== 'string') throw sigError('CacheService.Cache.put', arguments);
      if (String(k).length > 250) throw new Error('Exception: Argument too large: key');
      if (v.length > 100 * 1024) throw new Error('Exception: Argument too large: value');
      var t = Math.min(ttl == null ? 600 : Number(ttl), 21600);
      this._s()[k] = { v: v, exp: Date.now() + t * 1000 };
    },
    getAll: function (keys) { var self = this, out = {}; keys.forEach(function (k) { var v = self.get(k); if (v !== null) out[k] = v; }); return out; },
    putAll: function (obj, ttl) { var self = this; Object.keys(obj).forEach(function (k) { self.put(k, obj[k], ttl); }); },
    remove: function (k) { delete this._s()[k]; },
    removeAll: function (keys) { var self = this; keys.forEach(function (k) { self.remove(k); }); },
  };
  var CacheService = {
    getScriptCache: function () { return new Cache('script'); },
    getUserCache: function () { return new Cache('user'); },
    getDocumentCache: function () { return new Cache('document'); },
  };

  // Un único lock de script por ejecución. Anidar → violación registrada.
  function Lock(kind) { this._kind = kind; this._mine = false; }
  Lock.prototype = {
    _acquire: function (how) {
      var L = STATE.locks[this._kind];
      if (L.held) {
        M.lockNested = true;
        var stack = '';
        try { throw new Error('x'); } catch (e) { stack = String(e.stack || '').split('\n').slice(2, 9).join('\n'); }
        M.lockViolations.push({ kind: this._kind, how: how, sameObject: L.owner === this, stack: stack });
        return true; // se deja seguir para ver el resto del flujo; la prueba falla igual
      }
      L.held = true; L.owner = this; this._mine = true;
      M.stats.locks++;
      return true;
    },
    tryLock: function (ms) {
      if (typeof ms !== 'number') throw sigError('LockService.Lock.tryLock', arguments);
      if (M.lockBusy) return false;
      return this._acquire('tryLock');
    },
    waitLock: function (ms) {
      if (typeof ms !== 'number') throw sigError('LockService.Lock.waitLock', arguments);
      if (M.lockBusy) throw new Error('Exception: Lock timeout: another process was holding the lock for too long.');
      this._acquire('waitLock');
    },
    releaseLock: function () {
      var L = STATE.locks[this._kind];
      if (L.owner === this) { L.held = false; L.owner = null; }
      this._mine = false;
    },
    hasLock: function () { var L = STATE.locks[this._kind]; return L.held && L.owner === this; },
  };
  var LockService = {
    getScriptLock: function () { return new Lock('script'); },
    getUserLock: function () { return new Lock('user'); },
    getDocumentLock: function () { return new Lock('document'); },
  };

  var Session = {
    getActiveUser: function () { return { getEmail: function () { return M.user == null ? '' : String(M.user); }, getUsername: function () { return String(M.user || '').split('@')[0]; }, toString: function () { return String(M.user || ''); } }; },
    getEffectiveUser: function () { return { getEmail: function () { return M.effectiveUser; }, getUsername: function () { return String(M.effectiveUser).split('@')[0]; }, toString: function () { return M.effectiveUser; } }; },
    getScriptTimeZone: function () { return M.tz; },
    getActiveUserLocale: function () { return 'es'; },
    getTemporaryActiveUserKey: function () { return 'mock-key-' + String(M.user || 'anon'); },
  };

  /* ---------- Digest (MD5 / SHA-1 / SHA-256) → bytes con signo, como Java ---------- */
  function toBytes(v, charset) {
    if (Array.isArray(v)) return v.map(function (b) { return b & 255; });
    var s = unescape(encodeURIComponent(String(v == null ? '' : v)));
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
    return out;
  }
  function signed(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); }
  function md5(bytes) {
    var K = [], S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var msg = bytes.slice(), len = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (i = 0; i < 8; i++) msg.push(i < 4 ? (len >>> (8 * i)) & 255 : 0);
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var off = 0; off < msg.length; off += 64) {
      var M2 = [];
      for (i = 0; i < 16; i++) M2[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M2[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = [];
    [a0, b0, c0, d0].forEach(function (w) { for (var k = 0; k < 4; k++) out.push((w >>> (8 * k)) & 255); });
    return out;
  }
  function shaPad(bytes) {
    var msg = bytes.slice(), len = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (var i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (len >>> (8 * i)) & 255);
    return msg;
  }
  function wordsOut(ws) { var out = []; ws.forEach(function (w) { for (var k = 3; k >= 0; k--) out.push((w >>> (8 * k)) & 255); }); return out; }
  function sha1(bytes) {
    var msg = shaPad(bytes), h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0];
    for (var off = 0; off < msg.length; off += 64) {
      var w = [], i;
      for (i = 0; i < 16; i++) w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc | 0; } else { f = b ^ c ^ d; k = 0xca62c1d6 | 0; }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0, (h[4] + e) | 0];
    }
    return wordsOut(h);
  }
  function sha256(bytes) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var msg = shaPad(bytes);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < msg.length; off += 64) {
      var w = [], i;
      for (i = 0; i < 16; i++) w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0, (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0];
    }
    return wordsOut(h);
  }
  function computeDigest(alg, value, charset) {
    if (value === undefined) throw sigError('Utilities.computeDigest', arguments);
    var bytes = toBytes(value, charset);
    var a = String(alg);
    if (a === 'MD5') return signed(md5(bytes));
    if (a === 'SHA_1') return signed(sha1(bytes));
    if (a === 'SHA_256') return signed(sha256(bytes));
    throw new Error('Exception: Algoritmo de digest no emulado: ' + a);
  }

  /* ---------- Base64 y Blob (bytes con signo, como Java) ---------- */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_IX = {};
  for (var b64i = 0; b64i < 64; b64i++) B64_IX[B64.charCodeAt(b64i)] = b64i;
  function b64encBytes(bytes) {
    var parts = [], i = 0, n, len = bytes.length;
    for (; i + 3 <= len; i += 3) {
      n = ((bytes[i] & 255) << 16) | ((bytes[i + 1] & 255) << 8) | (bytes[i + 2] & 255);
      parts.push(B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63));
    }
    if (len - i === 1) { n = (bytes[i] & 255) << 16; parts.push(B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + '=='); }
    else if (len - i === 2) { n = ((bytes[i] & 255) << 16) | ((bytes[i + 1] & 255) << 8); parts.push(B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + '='); }
    return parts.join('');
  }
  // Texto base64 → bytes con signo. Inválido → 'Could not decode string.' (como Apps Script)
  function b64dec(s, webSafe, method) {
    if (typeof s !== 'string') throw sigError(method, [s]);
    var str = s.replace(/[\r\n]+/g, '');
    if (webSafe) str = str.replace(/-/g, '+').replace(/_/g, '/');
    str = str.replace(/={1,2}$/, '');
    if (str.length % 4 === 1 || /[^A-Za-z0-9+\/]/.test(str)) throw new Error('Exception: Could not decode string.');
    var out = new Array(Math.floor(str.length * 3 / 4)), k = 0, i = 0, n;
    for (; i + 4 <= str.length; i += 4) {
      n = (B64_IX[str.charCodeAt(i)] << 18) | (B64_IX[str.charCodeAt(i + 1)] << 12) | (B64_IX[str.charCodeAt(i + 2)] << 6) | B64_IX[str.charCodeAt(i + 3)];
      out[k++] = (n >> 16) & 255; out[k++] = (n >> 8) & 255; out[k++] = n & 255;
    }
    if (str.length - i === 2) {
      n = (B64_IX[str.charCodeAt(i)] << 18) | (B64_IX[str.charCodeAt(i + 1)] << 12);
      out[k++] = (n >> 16) & 255;
    } else if (str.length - i === 3) {
      n = (B64_IX[str.charCodeAt(i)] << 18) | (B64_IX[str.charCodeAt(i + 1)] << 12) | (B64_IX[str.charCodeAt(i + 2)] << 6);
      out[k++] = (n >> 16) & 255; out[k++] = (n >> 8) & 255;
    }
    out.length = k;
    for (var j = 0; j < k; j++) if (out[j] > 127) out[j] -= 256;
    return out;
  }
  function utf8dec(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192).map(function (b) { return b & 255; }));
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  // Utilities.newBlob(data: Byte[] | string, contentType?, name?) → Blob (getBytes con signo, getDataAsString UTF-8)
  function blob(data, type, name) {
    var st = { bytes: null, str: null, type: type == null ? null : String(type), name: name == null || name === '' ? null : String(name) };
    if (Array.isArray(data)) st.bytes = data.map(function (b) { return b & 255; });
    else { st.str = String(data == null ? '' : data); if (st.type == null) st.type = 'text/plain'; }
    function bytes() { if (!st.bytes) st.bytes = toBytes(st.str); return st.bytes; }
    var api = {
      getBytes: function () { return signed(bytes()); },
      getDataAsString: function () { return st.str != null ? st.str : utf8dec(bytes()); },
      getContentType: function () { return st.type; },
      setContentType: function (t) { st.type = t == null ? null : String(t); return proxy; },
      getName: function () { return st.name; },
      setName: function (n) { st.name = n == null ? null : String(n); return proxy; },
      setBytes: function (b) { st.bytes = toBytes(b); st.str = null; return proxy; },
      setDataFromString: function (s) { st.str = String(s); st.bytes = null; return proxy; },
      copyBlob: function () { return blob(st.str != null ? st.str : bytes().slice(), st.type, st.name); },
      getAs: function (t) { return api.copyBlob().setContentType(t); },
      isGoogleType: function () { return false; },
      getAllBlobs: function () { return [proxy]; },
      __size: function () { return st.str != null && !st.bytes ? toBytes(st.str).length : bytes().length; },
      __unsigned: function () { return bytes(); },
    };
    var proxy = wrap(api, 'Blob');
    return proxy;
  }
  var Utilities = {
    getUuid: function () {
      var h = '';
      for (var i = 0; i < 32; i++) h += Math.floor(rand() * 16).toString(16);
      h = h.slice(0, 12) + '4' + h.slice(13, 16) + '89ab'.charAt(Math.floor(rand() * 4)) + h.slice(17);
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32);
    },
    formatDate: formatDate,
    parseDate: parseDate,
    sleep: function (ms) { M.stats.sleepMs += Number(ms) || 0; },
    formatString: function (fmt) {
      var args = Array.prototype.slice.call(arguments, 1), k = 0;
      return String(fmt).replace(/%[sdif%]/g, function (m) { if (m === '%%') return '%'; var v = args[k++]; return m === '%d' || m === '%i' ? String(Math.trunc(Number(v))) : String(v); });
    },
    base64Encode: function (s) { if (s == null) throw sigError('Utilities.base64Encode', arguments); return b64encBytes(toBytes(s)); },
    base64EncodeWebSafe: function (s) { return Utilities.base64Encode(s).replace(/\+/g, '-').replace(/\//g, '_'); },
    base64Decode: function (s) { return b64dec(s, false, 'Utilities.base64Decode'); },
    base64DecodeWebSafe: function (s) { return b64dec(s, true, 'Utilities.base64DecodeWebSafe'); },
    newBlob: function (data, contentType, name) {
      if (arguments.length === 0) throw sigError('Utilities.newBlob', arguments);
      return blob(data, contentType, name);
    },
    computeDigest: computeDigest,
    Charset: { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' },
    DigestAlgorithm: { MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256' },
  };

  var EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[A-Za-z]{2,}$/;
  function recipients(s) { return String(s || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function sendMail(args, via) {
    var msg;
    if (args.length === 1 && args[0] && typeof args[0] === 'object') msg = Object.assign({}, args[0]);
    else if (args.length >= 3) msg = Object.assign({}, args[3] || {}, { to: args[0], subject: args[1], body: args[2] });
    else throw sigError(via + '.sendEmail', args);
    var to = recipients(msg.to), cc = recipients(msg.cc), bcc = recipients(msg.bcc);
    if (!to.length) throw new Error('Exception: Failed to send email: no recipient');
    to.concat(cc, bcc).forEach(function (e) { if (!EMAIL_RE.test(e)) throw new Error('Exception: Invalid email: ' + e); });
    if (msg.body == null && msg.htmlBody == null) throw new Error('Exception: Invalid argument: body');
    var n = to.length + cc.length + bcc.length;
    if (M.mailQuota < n) throw new Error('Exception: Service invoked too many times for one day: email.');
    M.mailQuota -= n;
    var rec = {
      to: to.join(','), cc: cc.join(','), bcc: bcc.join(','), subject: String(msg.subject == null ? '' : msg.subject),
      body: msg.body == null ? '' : String(msg.body), htmlBody: msg.htmlBody == null ? '' : String(msg.htmlBody),
      name: msg.name || '', replyTo: msg.replyTo || '', noReply: !!msg.noReply, from: M.effectiveUser, via: via,
      at: new Date().toISOString(),
    };
    M.mails.push(rec);
    return rec;
  }
  var MailApp = {
    sendEmail: function () { sendMail(Array.prototype.slice.call(arguments), 'MailApp'); },
    getRemainingDailyQuota: function () { return M.mailQuota; },
  };
  /* ---------- GmailApp: lectura (buzón simulado) ----------
     MOCK.gmail.messages = [{id, threadId, from, to, subject, date (Date|ISO), plainBody, htmlBody, fail?}]
     - search(query, start, max) → hilos con al menos un mensaje que calza; el hilo devuelve TODOS sus mensajes
       (por fecha ascendente), como Gmail. Hilos ordenados por su último mensaje (más nuevo primero).
     - query: from:(x) · from:x · to: · subject:(…) · newer_than:/older_than:Nd|m|y · "frase" · palabras (asunto/cuerpo).
     - fail: 'getPlainBody' (o cualquier getter) → ese método lanza (mensaje dañado). MOCK.gmail.searchError → search lanza.
     - MOCK.gmail.add({...}) completa id/threadId/fecha; MOCK.gmail.searches = consultas recibidas. */
  M.gmail = { messages: [], searches: [], searchError: null, seq: 0 };
  function gmDate(v) {
    if (isDate(v)) return new Date(v.getTime());
    var d = new Date(v == null || v === '' ? 0 : v);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  function gmText(v) { return String(v == null ? '' : v); }
  function gmNorm(s) { return gmText(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ \s]+/g, ' ').toLowerCase(); }
  function gmFail(rec, method) {
    var f = rec.fail;
    if (f && (f === method || f === true || (Array.isArray(f) && f.indexOf(method) >= 0))) {
      throw new Error('Exception: No se pudo leer el mensaje ' + rec.id + ' (' + method + ', simulado).');
    }
  }
  function gmThreadMsgs(tid) {
    return M.gmail.messages.filter(function (m) { return gmText(m.threadId || m.id) === tid; })
      .sort(function (a, b) { return gmDate(a.date) - gmDate(b.date); });
  }
  function gmMessage(rec) {
    var api = {
      getId: function () { gmFail(rec, 'getId'); return gmText(rec.id); },
      getFrom: function () { gmFail(rec, 'getFrom'); return gmText(rec.from); },
      getTo: function () { gmFail(rec, 'getTo'); return gmText(rec.to); },
      getCc: function () { return gmText(rec.cc); },
      getReplyTo: function () { return gmText(rec.replyTo); },
      getSubject: function () { gmFail(rec, 'getSubject'); return gmText(rec.subject); },
      getDate: function () { gmFail(rec, 'getDate'); return gmDate(rec.date); },
      getPlainBody: function () { gmFail(rec, 'getPlainBody'); return gmText(rec.plainBody); },
      getBody: function () { gmFail(rec, 'getBody'); return gmText(rec.htmlBody); },
      getThread: function () { return gmThread(gmText(rec.threadId || rec.id)); },
      isInTrash: function () { return !!rec.trash; },
      isUnread: function () { return !rec.read; },
      isStarred: function () { return !!rec.starred; },
      getAttachments: function () { return []; },
    };
    return wrap(api, 'GmailMessage');
  }
  function gmThread(tid) {
    var api = {
      getId: function () { return tid; },
      getMessages: function () { return gmThreadMsgs(tid).map(gmMessage); },
      getMessageCount: function () { return gmThreadMsgs(tid).length; },
      getFirstMessageSubject: function () { var l = gmThreadMsgs(tid); return l.length ? gmText(l[0].subject) : ''; },
      getLastMessageDate: function () { var l = gmThreadMsgs(tid); return l.length ? gmDate(l[l.length - 1].date) : new Date(0); },
      getPermalink: function () { return 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(tid); },
      isInTrash: function () { return false; },
    };
    return wrap(api, 'GmailThread');
  }
  // Consulta → lista de predicados sobre un mensaje
  function gmQuery(q) {
    var preds = [], s = gmText(q), m;
    var re = /(-)?(from|to|subject|newer_than|older_than|in|is|label|has):(\([^)]*\)|"[^"]*"|\S+)|(-)?"([^"]*)"|(-)?(\S+)/gi;
    while ((m = re.exec(s))) {
      if (m[2]) {
        var neg = !!m[1], op = m[2].toLowerCase(), val = m[3].replace(/^[("]|[)"]$/g, '').trim();
        var p = null;
        if (op === 'from' || op === 'to') {
          var parts = gmNorm(val).split(/\s+or\s+|\s+/).filter(Boolean);
          p = (function (field, parts) { return function (r) { var t = gmNorm(r[field]); return parts.some(function (x) { return t.indexOf(x) >= 0; }); }; })(op, parts);
        } else if (op === 'subject') {
          p = (function (v) { return function (r) { return gmNorm(r.subject).indexOf(v) >= 0; }; })(gmNorm(val));
        } else if (op === 'newer_than' || op === 'older_than') {
          var mm = /^(\d+)([dmy])$/i.exec(val);
          if (!mm) { warn('GmailApp.search: valor inválido para ' + op + ': ' + val); continue; }
          var ms = Number(mm[1]) * { d: 1, m: 30, y: 365 }[mm[2].toLowerCase()] * 86400000;
          p = (function (older, lim) { return function (r) { var age = Date.now() - gmDate(r.date).getTime(); return older ? age > lim : age <= lim; }; })(op === 'older_than', ms);
        } else {
          warn('GmailApp.search: operador no emulado "' + op + ':" (se ignora)');
          continue;
        }
        preds.push(neg ? (function (f) { return function (r) { return !f(r); }; })(p) : p);
      } else {
        var neg2 = !!(m[4] || m[6]), word = gmNorm(m[5] != null ? m[5] : m[7]);
        if (!word || word === 'or' || word === 'and') continue;
        var pw = (function (w) { return function (r) { return (gmNorm(r.subject) + ' ' + gmNorm(r.plainBody)).indexOf(w) >= 0; }; })(word);
        preds.push(neg2 ? (function (f) { return function (r) { return !f(r); }; })(pw) : pw);
      }
    }
    return preds;
  }
  var GmailApp = {
    sendEmail: function () { sendMail(Array.prototype.slice.call(arguments), 'GmailApp'); return GmailApp; },
    getAliases: function () { return []; },
    search: function (query, start, max) {
      if (typeof query !== 'string') throw sigError('GmailApp.search', arguments);
      if (arguments.length > 1 && (!isInt(start) || !isInt(max) || start < 0 || max < 0)) throw sigError('GmailApp.search', arguments);
      if (arguments.length > 1 && max > 500) throw new Error('Exception: Argument max cannot be greater than 500.');
      M.gmail.searches.push({ query: query, start: start == null ? 0 : start, max: max == null ? 500 : max });
      if (M.gmail.searchError) throw new Error(String(M.gmail.searchError));
      var preds = gmQuery(query);
      var tids = [];
      M.gmail.messages.forEach(function (r) {
        if (r.trash || !preds.every(function (p) { return p(r); })) return;
        var tid = gmText(r.threadId || r.id);
        if (tids.indexOf(tid) < 0) tids.push(tid);
      });
      var last = function (tid) { var l = gmThreadMsgs(tid); return l.length ? gmDate(l[l.length - 1].date).getTime() : 0; };
      tids.sort(function (a, b) { return last(b) - last(a); });
      var from = start == null ? 0 : start, n = max == null ? 500 : max;
      return tids.slice(from, from + n).map(gmThread);
    },
    getThreadById: function (id) { return gmThreadMsgs(gmText(id)).length ? gmThread(gmText(id)) : null; },
    getMessageById: function (id) { var r = M.gmail.messages.find(function (x) { return gmText(x.id) === gmText(id); }); return r ? gmMessage(r) : null; },
    getInboxThreads: function (start, max) { return GmailApp.search('', start || 0, max == null ? 500 : max); },
  };
  // Agrega un mensaje al buzón simulado (id hexadecimal de 16 caracteres, como Gmail) y lo devuelve
  M.gmail.add = function (msg) {
    var r = Object.assign({}, msg || {});
    if (!r.id) {
      M.gmail.seq++;
      var h = '';
      for (var i = 0; i < 16; i++) h += Math.floor(rand() * 16).toString(16);
      r.id = '19' + h.slice(2);
    }
    r.id = gmText(r.id);
    if (!r.threadId) r.threadId = r.id;
    if (r.date == null || r.date === '') r.date = new Date();
    if (r.from == null) r.from = 'mock@example.com';
    if (r.subject == null) r.subject = '';
    if (r.plainBody == null) r.plainBody = '';
    if (r.htmlBody == null) r.htmlBody = '';
    M.gmail.messages.push(r);
    return r;
  };
  function gmClone(list) {
    return (list || []).map(function (r) { var o = Object.assign({}, r); if (isDate(o.date)) o.date = new Date(o.date.getTime()); return o; });
  }

  /* ---------- DriveApp: unidad simulada ----------
     MOCK.drive.items = {id → {id, type:'folder'|'file', name, mimeType, parents:[id], trashed, created, updated (ms), size, data}}
     · "Mi unidad" = MOCK.drive.myDrive (DriveApp.getRootFolder / createFolder / createFile). IDs tipo Drive ('1' + 32).
     · Helpers: addFolder(nombre, padreId?, opts) → id (padre undefined → Mi unidad; '' → sin padre, como la raíz de una
       unidad compartida) · addFile(nombre, padreId, {mimeType, size, updated, created, data, trashed}) → id · item(id) ·
       children(id) · byName(nombre, tipo?) · path(id) → 'A/B/C' · deny(id)/allow(id) (sin acceso: también sus
       descendientes) · trash(id, bool) · touch(id, fecha) · count(método).
     · Fallas configurables: failOn(método | '*', mensaje?, veces?) → ese método lanza 'Exception: <mensaje>' (veces = n o
       siempre); clearFailures(). MOCK.drive.calls = métodos llamados, en orden (para medir llamadas).
     · Fidelidad: getFiles/getFolders/get*ByName también entregan elementos en la papelera (hay que filtrar con isTrashed());
       Folder no tiene getMimeType; getFolderById/getFileById de un id inexistente, de otro tipo o sin acceso lanzan;
       next() pasado el final lanza; createFile acepta un Blob o (nombre, contenido, mimeType), máx. 50 MB.
     · Entra en snapshot/restore; failures y calls se limpian en clearBuffers. */
  var DV_FOLDER = 'application/vnd.google-apps.folder';
  var DV_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  var DV_NOT_FOUND = 'Exception: No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.';
  var DV_MY_DRIVE = '0AMockMiUnidadRaizUk9PVA';
  M.drive = { items: {}, seq: 0, seed: 7, denied: {}, failures: {}, calls: [], myDrive: DV_MY_DRIVE };

  function dvRand() { // PRNG propio: no altera la secuencia de Utilities.getUuid
    M.drive.seed = (M.drive.seed + 0x6D2B79F5) | 0;
    var t = M.drive.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function dvNewId() {
    var id;
    do {
      id = '1';
      for (var i = 0; i < 32; i++) id += DV_CHARS.charAt(Math.floor(dvRand() * 64));
    } while (M.drive.items[id]);
    M.drive.seq++;
    return id;
  }
  function dvMs(v, def) {
    if (v == null || v === '') return def;
    var d = isDate(v) ? v : new Date(v);
    return isNaN(d.getTime()) ? def : d.getTime();
  }
  function dvAdd(type, name, parentId, opts) {
    opts = opts || {};
    var now = Date.now();
    var id = opts.id ? String(opts.id) : dvNewId();
    var data = Array.isArray(opts.data) ? opts.data.map(function (b) { return b & 255; }) : null;
    var size = type === 'folder' ? 0 : Number(opts.size != null ? opts.size : (data ? data.length : 0)) || 0;
    var it = {
      id: id, type: type, name: String(name == null ? '' : name),
      mimeType: type === 'folder' ? DV_FOLDER : String(opts.mimeType || 'application/octet-stream'),
      parents: parentId ? [String(parentId)] : [], trashed: !!opts.trashed,
      created: dvMs(opts.created, now), updated: dvMs(opts.updated, dvMs(opts.created, now)), size: size,
      data: data && data.length <= 262144 ? data : null, description: opts.description ? String(opts.description) : '',
    };
    M.drive.items[id] = it;
    return it;
  }
  function dvCall(method) {
    M.drive.calls.push(method);
    if (M.drive.calls.length > 5000) M.drive.calls.splice(0, 1000);
    var key = M.drive.failures[method] ? method : (M.drive.failures['*'] ? '*' : null);
    if (!key) return;
    var f = M.drive.failures[key];
    if (f.times != null) { f.times--; if (f.times <= 0) delete M.drive.failures[key]; }
    throw new Error('Exception: ' + f.message);
  }
  // Sin acceso: el elemento o alguno de sus ancestros está denegado
  function dvDenied(id, depth) {
    var it = M.drive.items[id];
    if (!it) return true;
    if (M.drive.denied[id]) return true;
    if ((depth || 0) > 60) return false;
    return it.parents.some(function (p) { return M.drive.items[p] && dvDenied(p, (depth || 0) + 1); });
  }
  function dvGet(id, type) {
    var it = M.drive.items[id];
    if (!it || it.type !== type || dvDenied(id)) throw new Error(DV_NOT_FOUND);
    return it;
  }
  function dvIter(ids, mk, cls) {
    var i = 0;
    return wrap({
      hasNext: function () { return i < ids.length; },
      next: function () {
        if (i >= ids.length) throw new Error('Exception: Cannot retrieve the next object: iterator has reached the end.');
        return mk(ids[i++]);
      },
      getContinuationToken: function () { return 'mock-token-' + i; },
    }, cls);
  }
  // Hijos directos (incluye la papelera, como DriveApp)
  function dvKids(parentId, type, name) {
    return Object.keys(M.drive.items).filter(function (k) {
      var it = M.drive.items[k];
      return it.type === type && it.parents.indexOf(parentId) >= 0 && (name == null || it.name === name) && !M.drive.denied[k];
    });
  }
  function dvAll(type, name) {
    return Object.keys(M.drive.items).filter(function (k) {
      var it = M.drive.items[k];
      return it.type === type && k !== M.drive.myDrive && (name == null || it.name === name) && !dvDenied(k);
    });
  }
  function dvCreateFile(parentId, args, method) {
    var a = args[0], name, mime, bytes;
    if (args.length === 1) {
      if (!a || typeof a.getBytes !== 'function') throw sigError(method, args);
      bytes = typeof a.__unsigned === 'function' ? a.__unsigned() : a.getBytes().map(function (b) { return b & 255; });
      name = a.getName() || 'Untitled';
      mime = a.getContentType() || 'application/octet-stream';
    } else {
      if (typeof a !== 'string' || args.length < 2) throw sigError(method, args);
      name = a;
      mime = args[2] ? String(args[2]) : 'text/plain';
      bytes = toBytes(args[1] == null ? '' : String(args[1]));
    }
    if (/^application\/vnd\.google-apps\./.test(mime)) throw new Error('Exception: Invalid argument: file.contentType');
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Exception: File size exceeds the maximum allowed for DriveApp.createFile (50 MB).');
    dvCall('createFile');
    var par = M.drive.items[parentId];
    if (par) par.updated = Date.now();
    return dvFile(dvAdd('file', name, parentId, { mimeType: mime, size: bytes.length, data: bytes }).id);
  }
  // Métodos comunes de File y Folder
  function dvCommon(id, cls, self) {
    function it() { return M.drive.items[id]; }
    return {
      getId: function () { return id; },
      getName: function () { return it().name; },
      setName: function (n) {
        if (typeof n !== 'string') throw sigError('DriveApp.' + cls + '.setName', arguments);
        dvCall('setName');
        it().name = n; it().updated = Date.now();
        return self();
      },
      getDescription: function () { return it().description || null; },
      setDescription: function (d) { it().description = String(d == null ? '' : d); return self(); },
      getDateCreated: function () { return new Date(it().created); },
      getLastUpdated: function () { return new Date(it().updated); },
      getParents: function () {
        dvCall('getParents');
        return dvIter(it().parents.filter(function (p) { return M.drive.items[p] && !dvDenied(p); }), dvFolder, 'FolderIterator');
      },
      isTrashed: function () { return !!it().trashed; },
      setTrashed: function (b) {
        if (typeof b !== 'boolean') throw sigError('DriveApp.' + cls + '.setTrashed', arguments);
        dvCall('setTrashed');
        it().trashed = b;
        return self();
      },
      moveTo: function (dest) {
        var did = dest && typeof dest.getId === 'function' ? dest.getId() : null;
        var d = did ? M.drive.items[did] : null;
        if (!d || d.type !== 'folder') throw sigError('DriveApp.' + cls + '.moveTo', arguments);
        dvCall('moveTo');
        var cur = did, guard = 0;
        while (cur && guard++ < 100) {
          if (cur === id) throw new Error('Exception: Invalid argument: destination');
          cur = (M.drive.items[cur] || { parents: [] }).parents[0];
        }
        it().parents = [did];
        return self();
      },
      getOwner: function () { return { getEmail: function () { return M.effectiveUser; }, getName: function () { return String(M.effectiveUser).split('@')[0]; } }; },
      getEditors: function () { return []; },
      getViewers: function () { return []; },
      getSharingAccess: function () { return 'PRIVATE'; },
      getSharingPermission: function () { return 'NONE'; },
      isStarred: function () { return false; },
      isShareableByEditors: function () { return true; },
    };
  }
  function dvFolder(id) {
    var proxy;
    var api = dvCommon(id, 'Folder', function () { return proxy; });
    api.getUrl = function () { return 'https://drive.google.com/drive/folders/' + id; };
    api.getSize = function () { return 0; };
    api.getFolders = function () { dvCall('getFolders'); return dvIter(dvKids(id, 'folder'), dvFolder, 'FolderIterator'); };
    api.getFiles = function () { dvCall('getFiles'); return dvIter(dvKids(id, 'file'), dvFile, 'FileIterator'); };
    api.getFoldersByName = function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.Folder.getFoldersByName', arguments);
      dvCall('getFoldersByName');
      return dvIter(dvKids(id, 'folder', name), dvFolder, 'FolderIterator');
    };
    api.getFilesByName = function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.Folder.getFilesByName', arguments);
      dvCall('getFilesByName');
      return dvIter(dvKids(id, 'file', name), dvFile, 'FileIterator');
    };
    api.createFolder = function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.Folder.createFolder', arguments);
      dvCall('createFolder');
      M.drive.items[id].updated = Date.now();
      return dvFolder(dvAdd('folder', name, id).id);
    };
    api.createFile = function () { return dvCreateFile(id, Array.prototype.slice.call(arguments), 'DriveApp.Folder.createFile'); };
    proxy = wrap(api, 'Folder');
    return proxy;
  }
  function dvFileUrl(it) {
    var m = it.mimeType;
    if (m === 'application/vnd.google-apps.document') return 'https://docs.google.com/document/d/' + it.id + '/edit?usp=drivesdk';
    if (m === 'application/vnd.google-apps.spreadsheet') return 'https://docs.google.com/spreadsheets/d/' + it.id + '/edit?usp=drivesdk';
    if (m === 'application/vnd.google-apps.presentation') return 'https://docs.google.com/presentation/d/' + it.id + '/edit?usp=drivesdk';
    return 'https://drive.google.com/file/d/' + it.id + '/view?usp=drivesdk';
  }
  function dvFile(id) {
    var proxy;
    var api = dvCommon(id, 'File', function () { return proxy; });
    function it() { return M.drive.items[id]; }
    api.getUrl = function () { return dvFileUrl(it()); };
    api.getMimeType = function () { return it().mimeType; };
    api.getSize = function () { return it().size; };
    api.getDownloadUrl = function () { return 'https://drive.google.com/uc?id=' + id + '&export=download'; };
    api.getThumbnail = function () { return null; };
    api.getBlob = function () { dvCall('getBlob'); return blob(it().data || [], it().mimeType, it().name); };
    api.getAs = function (t) { return api.getBlob().setContentType(t); };
    proxy = wrap(api, 'File');
    return proxy;
  }
  var DriveApp = {
    Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER', ORGANIZER: 'ORGANIZER', FILE_ORGANIZER: 'FILE_ORGANIZER', NONE: 'NONE' },
    getRootFolder: function () { dvCall('getRootFolder'); return dvFolder(M.drive.myDrive); },
    getFolderById: function (id) {
      if (typeof id !== 'string') throw sigError('DriveApp.getFolderById', arguments);
      dvCall('getFolderById');
      dvGet(id, 'folder');
      return dvFolder(id);
    },
    getFileById: function (id) {
      if (typeof id !== 'string') throw sigError('DriveApp.getFileById', arguments);
      dvCall('getFileById');
      dvGet(id, 'file');
      return dvFile(id);
    },
    createFolder: function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.createFolder', arguments);
      dvCall('createFolder');
      return dvFolder(dvAdd('folder', name, M.drive.myDrive).id);
    },
    createFile: function () { return dvCreateFile(M.drive.myDrive, Array.prototype.slice.call(arguments), 'DriveApp.createFile'); },
    getFolders: function () { dvCall('getFolders'); return dvIter(dvAll('folder'), dvFolder, 'FolderIterator'); },
    getFiles: function () { dvCall('getFiles'); return dvIter(dvAll('file'), dvFile, 'FileIterator'); },
    getFoldersByName: function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.getFoldersByName', arguments);
      dvCall('getFoldersByName');
      return dvIter(dvAll('folder', name), dvFolder, 'FolderIterator');
    },
    getFilesByName: function (name) {
      if (typeof name !== 'string') throw sigError('DriveApp.getFilesByName', arguments);
      dvCall('getFilesByName');
      return dvIter(dvAll('file', name), dvFile, 'FileIterator');
    },
    getStorageUsed: function () { return Object.keys(M.drive.items).reduce(function (s, k) { return s + (M.drive.items[k].size || 0); }, 0); },
    enforceSingleParent: function () {},
  };
  function dvReset() {
    M.drive.items = {}; M.drive.seq = 0; M.drive.seed = 7; M.drive.denied = {}; M.drive.failures = {}; M.drive.calls = [];
    M.drive.myDrive = DV_MY_DRIVE;
    dvAdd('folder', 'Mi unidad', '', { id: DV_MY_DRIVE });
  }
  function dvSnapshot() {
    var items = {};
    Object.keys(M.drive.items).forEach(function (k) {
      var it = M.drive.items[k];
      items[k] = Object.assign({}, it, { parents: it.parents.slice(), data: it.data ? it.data.slice() : null });
    });
    return { items: items, seq: M.drive.seq, seed: M.drive.seed, denied: Object.assign({}, M.drive.denied), myDrive: M.drive.myDrive };
  }
  function dvRestore(s) {
    if (!s) { dvReset(); return; }
    M.drive.items = {};
    Object.keys(s.items).forEach(function (k) {
      var it = s.items[k];
      M.drive.items[k] = Object.assign({}, it, { parents: it.parents.slice(), data: it.data ? it.data.slice() : null });
    });
    M.drive.seq = s.seq; M.drive.seed = s.seed; M.drive.denied = Object.assign({}, s.denied); M.drive.myDrive = s.myDrive;
    M.drive.failures = {}; M.drive.calls = [];
  }
  M.drive.addFolder = function (name, parentId, opts) {
    return dvAdd('folder', name, parentId === undefined || parentId === null ? M.drive.myDrive : parentId, opts).id;
  };
  M.drive.addFile = function (name, parentId, opts) {
    return dvAdd('file', name, parentId === undefined || parentId === null ? M.drive.myDrive : parentId, opts).id;
  };
  M.drive.item = function (id) { return M.drive.items[id] || null; };
  M.drive.children = function (id) {
    return Object.keys(M.drive.items).map(function (k) { return M.drive.items[k]; }).filter(function (it) { return it.parents.indexOf(id) >= 0; });
  };
  M.drive.byName = function (name, type) {
    return Object.keys(M.drive.items).map(function (k) { return M.drive.items[k]; })
      .filter(function (it) { return it.name === name && (!type || it.type === type); });
  };
  M.drive.path = function (id) {
    var names = [], cur = M.drive.items[id], guard = 0;
    while (cur && guard++ < 100) { names.unshift(cur.name); cur = M.drive.items[cur.parents[0]]; }
    return names.join('/');
  };
  M.drive.deny = function (id) { M.drive.denied[id] = true; };
  M.drive.allow = function (id) { delete M.drive.denied[id]; };
  M.drive.trash = function (id, v) { var it = M.drive.items[id]; if (it) it.trashed = v === undefined ? true : !!v; };
  M.drive.touch = function (id, when) { var it = M.drive.items[id]; if (it) it.updated = dvMs(when, Date.now()); };
  M.drive.failOn = function (method, message, times) {
    M.drive.failures[method || '*'] = { message: message || 'We\'re sorry, a server error occurred. Please wait a bit and try again.', times: times == null ? null : times };
  };
  M.drive.clearFailures = function () { M.drive.failures = {}; };
  M.drive.count = function (method) { return M.drive.calls.filter(function (m) { return m === method; }).length; };

  function Trigger(fn, cfg) {
    this._fn = fn; this._cfg = cfg; this._id = String(1000000 + Math.floor(rand() * 8999999)); this._owner = M.effectiveUser;
  }
  Trigger.prototype = {
    getHandlerFunction: function () { return this._fn; },
    getUniqueId: function () { return this._id; },
    getEventType: function () { return this._cfg.event; },
    getTriggerSource: function () { return this._cfg.source; },
    getTriggerSourceId: function () { return this._cfg.sourceId || null; },
  };
  var ScriptApp = {
    EventType: { CLOCK: 'CLOCK', ON_OPEN: 'ON_OPEN', ON_EDIT: 'ON_EDIT', ON_CHANGE: 'ON_CHANGE', ON_FORM_SUBMIT: 'ON_FORM_SUBMIT' },
    TriggerSource: { CLOCK: 'CLOCK', SPREADSHEETS: 'SPREADSHEETS' },
    AuthMode: { NONE: 'NONE', LIMITED: 'LIMITED', FULL: 'FULL' },
    WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' },
    getProjectTriggers: function () { return STATE.triggers.filter(function (t) { return t._owner === M.effectiveUser; }); },
    getUserTriggers: function () { return ScriptApp.getProjectTriggers(); },
    deleteTrigger: function (t) {
      var i = STATE.triggers.findIndex(function (x) { return x === t || (t && x._id === (t.getUniqueId ? t.getUniqueId() : t._id)); });
      if (i < 0) throw new Error('Exception: Trigger not found');
      STATE.triggers.splice(i, 1);
    },
    newTrigger: function (fn) {
      if (typeof fn !== 'string' || !fn) throw sigError('ScriptApp.newTrigger', arguments);
      function create(cfg) {
        if (STATE.triggers.filter(function (t) { return t._owner === M.effectiveUser; }).length >= 20) {
          throw new Error('Exception: This script has too many triggers. Triggers must be deleted from the script before more can be added.');
        }
        var t = new Trigger(fn, cfg);
        STATE.triggers.push(t);
        return t;
      }
      return {
        timeBased: function () {
          var cfg = { event: 'CLOCK', source: 'CLOCK' };
          var b = {
            everyDays: function (n) { if (!isInt(n) || n < 1) throw new Error('Exception: Invalid argument: everyDays'); cfg.everyDays = n; return b; },
            everyHours: function (n) { if ([1, 2, 4, 6, 8, 12].indexOf(n) < 0) throw new Error('Exception: Invalid argument: everyHours'); cfg.everyHours = n; return b; },
            everyMinutes: function (n) { if ([1, 5, 10, 15, 30].indexOf(n) < 0) throw new Error('Exception: Invalid argument: everyMinutes'); cfg.everyMinutes = n; return b; },
            everyWeeks: function (n) { cfg.everyWeeks = n; return b; },
            onWeekDay: function (d) { cfg.weekDay = d; return b; },
            atHour: function (h) { if (!isInt(h) || h < 0 || h > 23) throw new Error('Exception: Invalid argument: hour'); cfg.atHour = h; return b; },
            nearMinute: function (m) { cfg.nearMinute = m; return b; },
            inTimezone: function (tz) { cfg.tz = tz; return b; },
            atDate: function (y, mo, d) { cfg.atDate = [y, mo, d]; return b; },
            at: function (d) { cfg.at = isDate(d) ? d.toISOString() : d; return b; },
            after: function (ms) { cfg.after = ms; return b; },
            create: function () {
              if (!cfg.everyDays && !cfg.everyHours && !cfg.everyMinutes && !cfg.everyWeeks && !cfg.at && !cfg.after && !cfg.atDate) {
                throw new Error('Exception: You must specify the frequency of the trigger.');
              }
              return create(cfg);
            },
          };
          return b;
        },
        forSpreadsheet: function (s) {
          var cfg = { source: 'SPREADSHEETS', sourceId: s && s.getId ? s.getId() : String(s) };
          var b = {
            onOpen: function () { cfg.event = 'ON_OPEN'; return b; },
            onEdit: function () { cfg.event = 'ON_EDIT'; return b; },
            onChange: function () { cfg.event = 'ON_CHANGE'; return b; },
            onFormSubmit: function () { cfg.event = 'ON_FORM_SUBMIT'; return b; },
            create: function () { return create(cfg); },
          };
          return b;
        },
      };
    },
    getService: function () { return { getUrl: function () { return M.serviceUrl; }, isEnabled: function () { return !!M.serviceUrl; } }; },
    getScriptId: function () { return M.scriptId; },
    getOAuthToken: function () { return 'mock-oauth-token'; },
    requireScopes: function () {},
    invalidateAuth: function () {},
  };

  /* ---------- UrlFetchApp ---------- */
  function lowerKeys(o) { var out = {}; Object.keys(o || {}).forEach(function (k) { out[k.toLowerCase()] = o[k]; }); return out; }
  function httpResponse(code, body, headers) {
    var text = typeof body === 'string' ? body : JSON.stringify(body == null ? '' : body);
    return {
      getResponseCode: function () { return code; },
      getContentText: function () { return text; },
      getContent: function () { return text.split('').map(function (c) { return c.charCodeAt(0) & 255; }); },
      getHeaders: function () { return Object.assign({ 'Content-Type': 'application/json; charset=UTF-8' }, headers || {}); },
      getAllHeaders: function () { return Object.assign({ 'Content-Type': 'application/json; charset=UTF-8' }, headers || {}); },
      getBlob: function () { return blob(text, 'application/json'); },
      getAs: function () { return blob(text, 'application/json'); },
    };
  }
  function fetchOne(url, params) {
    if (typeof url !== 'string') throw sigError('UrlFetchApp.fetch', arguments);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Exception: Invalid argument: ' + url);
    params = params || {};
    if (M.urlWhitelist && M.urlWhitelist.length && !M.urlWhitelist.some(function (p) { return url.indexOf(p) === 0; })) {
      throw new Error('Exception: UrlFetch calls to ' + url + ' are not permitted by your Apps Script project (urlFetchWhitelist).');
    }
    var headers = Object.assign({}, params.headers || {});
    var payload = params.payload;
    var json = null;
    if (typeof payload === 'string') { try { json = JSON.parse(payload); } catch (e) { json = null; } }
    else if (payload && typeof payload === 'object') json = payload;
    var rec = {
      url: url, method: String(params.method || 'get').toLowerCase(), headers: headers, payload: payload, json: json,
      contentType: params.contentType || '', muteHttpExceptions: !!params.muteHttpExceptions, at: new Date().toISOString(),
    };
    M.fetches.push(rec);
    M.stats.fetch++;
    var handler = M.fetchHandler || geminiDefault;
    var res = handler(url, params, rec);
    if (!res) res = { code: 500, body: 'Mock sin respuesta' };
    var out = typeof res.getResponseCode === 'function' ? res : httpResponse(res.code == null ? 200 : res.code, res.body, res.headers);
    rec.code = out.getResponseCode();
    rec.response = out.getContentText();
    if (!params.muteHttpExceptions && rec.code >= 400) {
      throw new Error('Exception: Request failed for ' + url.replace(/\?.*$/, '') + ' returned code ' + rec.code + '. Truncated server response: ' + rec.response.slice(0, 200) + ' (use muteHttpExceptions option to examine full response)');
    }
    return out;
  }
  var UrlFetchApp = {
    fetch: fetchOne,
    fetchAll: function (reqs) { return (reqs || []).map(function (r) { return typeof r === 'string' ? fetchOne(r) : fetchOne(r.url, r); }); },
    getRequest: function (url, params) { return Object.assign({ url: url }, params || {}); },
  };

  /* ---------- Gemini simulado ---------- */
  // Texto completo enviado al modelo (systemInstruction + contents)
  function promptText(json) {
    if (!json) return '';
    var parts = [];
    (json.contents || []).forEach(function (c) { (c.parts || []).forEach(function (p) { if (p && p.text) parts.push(p.text); }); });
    return parts.join('\n');
  }
  var ID_RE = /\[((?:L|PRJ|TSK|CMT|CAS|EV)-[A-Za-z0-9][A-Za-z0-9_.:#\/-]*)\]/g;
  function promptIds(text) {
    var out = [], m;
    var re = new RegExp(ID_RE.source, 'g');
    while ((m = re.exec(String(text || '')))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    var re2 = /"id"\s*:\s*"((?:L|PRJ|TSK|CMT|CAS|EV)-[^"]+)"/g;
    while ((m = re2.exec(String(text || '')))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }
  // Primer registro citado en el prompt → {id, title}
  function firstRecord(text) {
    var s = String(text || '');
    var re = new RegExp(ID_RE.source, 'g');
    var m = re.exec(s);
    if (m) {
      var line = s.slice(m.index + m[0].length).split('\n')[0];
      var title = line.replace(/^[\s:·|\-—–]+/, '').replace(/^(t[ií]tulo|title|nombre)\s*[:=]\s*/i, '').split(/\s+[|·—]\s+|\t/)[0].trim();
      return { id: m[1], title: title.slice(0, 90) };
    }
    var j = /"id"\s*:\s*"((?:L|PRJ|TSK|CMT|CAS|EV)-[^"]+)"/.exec(s);
    if (j) {
      var t = /"(?:title|titulo|nombre)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s.slice(j.index));
      return { id: j[1], title: t ? t[1].slice(0, 90) : j[1] };
    }
    return null;
  }
  function geminiReply(obj, extra) {
    extra = extra || {};
    var text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Object.assign({
      candidates: [{ content: { role: 'model', parts: [{ text: text }] }, finishReason: extra.finishReason || 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 60, totalTokenCount: 1260 },
      modelVersion: extra.model || 'gemini-mock',
    }, extra.envelope || {});
  }
  function geminiDefault(url, params, rec) {
    if (!/^https:\/\/generativelanguage\.googleapis\.com\//.test(url)) return { code: 404, body: 'Not Found (mock)' };
    var h = lowerKeys(params.headers);
    var key = h['x-goog-api-key'] || (/[?&]key=([^&]+)/.exec(url) || [])[1];
    if (!key) return { code: 403, body: { error: { code: 403, message: 'Method doesn\'t allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.', status: 'PERMISSION_DENIED' } } };
    if (String(params.method || 'get').toLowerCase() !== 'post') return { code: 404, body: { error: { code: 404, message: 'Method not found.', status: 'NOT_FOUND' } } };
    var j = rec.json;
    if (!j || !Array.isArray(j.contents) || !j.contents.length) return { code: 400, body: { error: { code: 400, message: 'Invalid JSON payload received. contents is required.', status: 'INVALID_ARGUMENT' } } };
    var gc = j.generationConfig || {};
    ['temperature', 'topP', 'topK'].forEach(function (k) { if (gc[k] !== undefined) warn('Gemini: se envió generationConfig.' + k + ' (obsoleto en 3.x, ver SPEC §11)'); });
    var model = (/models\/([^:]+):/.exec(url) || [])[1] || '';
    var r = firstRecord(promptText(j));
    var out = r
      ? { found: true, answer: 'Según el registro [' + r.id + ']: ' + r.title + '.', sourceIds: [r.id] }
      : { found: false, answer: 'No encontré esa información en los registros de la app.', sourceIds: [] };
    return { code: 200, body: geminiReply(out, { model: model }) };
  }

  /* ---------- HtmlService ---------- */
  var META_OK = ['viewport', 'apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style', 'google', 'google-site-verification', 'format-detection'];
  function HtmlOutput(content) { this._c = String(content == null ? '' : content); this._title = ''; this._meta = []; }
  HtmlOutput.prototype = {
    getContent: function () { return this._c; },
    setContent: function (c) { this._c = String(c); return this; },
    append: function (c) { this._c += String(c); return this; },
    appendUntrusted: function (c) { this._c += String(c).replace(/[&<>"']/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]; }); return this; },
    setTitle: function (t) { this._title = String(t); return this; },
    getTitle: function () { return this._title; },
    addMetaTag: function (name, content) {
      if (META_OK.indexOf(String(name)) < 0) throw new Error('Exception: Meta tag "' + name + '" is not allowed.');
      this._meta.push({ name: name, content: content }); return this;
    },
    getMetaTags: function () { return this._meta.slice(); },
    setXFrameOptionsMode: function (m) { this._xfo = m; return this; },
    setSandboxMode: function (m) { this._sandbox = m; return this; },
    setFaviconUrl: function (u) { this._favicon = u; return this; },
    setWidth: function () { return this; },
    setHeight: function () { return this; },
    asTemplate: function () { return template(this._c, 'inline'); },
    getBlob: function () { return blob(this._c, 'text/html'); },
  };
  function fileContent(name) {
    var n = String(name).replace(/\.html$/i, '');
    if (!Object.prototype.hasOwnProperty.call(M.files, n)) throw new Error('Exception: No HTML file named ' + n + ' was found.');
    return M.files[n];
  }
  function template(src, name) {
    var tpl = {
      _src: src,
      getRawContent: function () { return src; },
      getCode: function () { return src; },
      evaluate: function () {
        // Sólo se evalúa <?!= include('X'); ?> (lo que usa Index.html); otros scriptlets se quitan con aviso
        var out = src.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, function (m, n) {
          if (typeof G.include === 'function') return G.include(n);
          return fileContent(n);
        });
        out = out.replace(/<\?[\s\S]*?\?>/g, function (m) { warn('Scriptlet no emulado en ' + name + ': ' + m.slice(0, 60)); return ''; });
        return new HtmlOutput(out);
      },
    };
    return tpl;
  }
  var HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE', EMULATED: 'EMULATED' },
    createTemplateFromFile: function (name) { return template(fileContent(name), String(name)); },
    createTemplate: function (src) { return template(String(src), 'inline'); },
    createHtmlOutputFromFile: function (name) { return new HtmlOutput(fileContent(name)); },
    createHtmlOutput: function (c) { return new HtmlOutput(c || ''); },
  };

  var ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' },
    createTextOutput: function (t) { var o = { _t: String(t || ''), _m: 'TEXT', getContent: function () { return o._t; }, setMimeType: function (m) { o._m = m; return o; }, setContent: function (c) { o._t = String(c); return o; } }; return o; },
  };

  /* ---------- Logger y console ---------- */
  function fmtArgs(args) {
    return Array.prototype.map.call(args, function (a) {
      if (typeof a === 'string') return a;
      if (isDate(a)) return a.toISOString();
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
  }
  function emit(level, text) {
    M.consoleBuf.push({ level: level, text: text });
    if (M.consoleBuf.length > 2000) M.consoleBuf.splice(0, 500);
    if (REAL_CONSOLE) {
      var fn = REAL_CONSOLE[level] || REAL_CONSOLE.log;
      if (M.verbose || level === 'error' || level === 'warn') fn.call(REAL_CONSOLE, '[servidor] ' + text);
    } else if (HAS_PRINT && M.verbose) {
      G.print('    [' + level + '] ' + text);
    }
  }
  var Logger = {
    log: function (fmt) {
      var args = Array.prototype.slice.call(arguments, 1), k = 0;
      var text = args.length && typeof fmt === 'string' ? fmt.replace(/%s/g, function () { return String(args[k++]); }) : fmtArgs(arguments);
      M.logs.push(text);
      emit('log', text);
      return Logger;
    },
    getLog: function () { return M.logs.join('\n'); },
    clear: function () { M.logs.length = 0; },
  };
  var mconsole = {
    log: function () { emit('log', fmtArgs(arguments)); },
    info: function () { emit('info', fmtArgs(arguments)); },
    warn: function () { emit('warn', fmtArgs(arguments)); },
    error: function () { emit('error', fmtArgs(arguments)); },
    debug: function () { emit('debug', fmtArgs(arguments)); },
    time: function () {}, timeEnd: function () {},
  };

  /* ------------------------------------------------------------------ */
  /* Serialización estilo google.script.run                              */
  /* ------------------------------------------------------------------ */
  function findIllegal(v, where) {
    var bad = [];
    (function walk(x, path, inArray, depth) {
      if (bad.length > 20) return;
      if (depth > 60) { bad.push(path + ': demasiado profundo (¿ciclo?)'); return; }
      if (x === undefined) { if (inArray) bad.push(path + ': undefined dentro de un array'); return; }
      if (x === null) return;
      var t = typeof x;
      if (t === 'string' || t === 'boolean') return;
      if (t === 'number') return;
      if (t === 'function') { bad.push(path + ': función'); return; }
      if (t === 'symbol' || t === 'bigint') { bad.push(path + ': ' + t); return; }
      if (isDate(x)) { bad.push(path + ': Date (' + (isNaN(x.getTime()) ? 'inválida' : x.toISOString()) + ')'); return; }
      if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) walk(x[i], path + '[' + i + ']', true, depth + 1); return; }
      var tag = Object.prototype.toString.call(x);
      var proto = Object.getPrototypeOf(x);
      var plain = tag === '[object Object]' && (proto === null || proto === Object.prototype || (proto && proto.constructor && proto.constructor.name === 'Object'));
      if (!plain) { bad.push(path + ': objeto no plano (' + tag.slice(8, -1) + ')'); return; }
      Object.keys(x).forEach(function (k) {
        var y = x[k];
        if (typeof y === 'function') { bad.push(path + '.' + k + ': función'); return; }
        walk(y, path + '.' + k, false, depth + 1);
      });
    })(v, where || 'valor', false, 0);
    return bad;
  }
  function strictClone(v, where) {
    var bad = findIllegal(v, where);
    if (bad.length) {
      var e = new Error('google.script.run no puede serializar ' + (where || 'el valor') + ': ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ' …' : ''));
      e.illegal = bad;
      throw e;
    }
    if (v === undefined) return undefined;
    return JSON.parse(JSON.stringify(v));
  }

  /* ------------------------------------------------------------------ */
  /* Estado: reset / snapshot / restore                                  */
  /* ------------------------------------------------------------------ */
  function freshState(opts) {
    opts = opts || {};
    return {
      ss: new MSpreadsheet(opts.name, opts.id),
      props: { script: {}, user: {}, document: {} },
      cache: { script: {}, user: {}, document: {} },
      locks: { script: { held: false, owner: null }, user: { held: false, owner: null }, document: { held: false, owner: null } },
      triggers: [],
      uuidSeed: opts.seed == null ? 20261002 : opts.seed,
      menus: [],
    };
  }
  function clearBuffers() {
    M.mails = []; M.fetches = []; M.logs = []; M.consoleBuf = []; M.toasts = []; M.alerts = [];
    M.warnings = []; M.unknownCalls = []; M.missing = []; M.lockViolations = []; M.lockNested = false;
    M.stats = { flush: 0, locks: 0, sleepMs: 0, fetch: 0 };
    M.gmail.searches = []; M.gmail.searchError = null;
    M.drive.calls = []; M.drive.failures = {};
  }
  function cloneCell(c) { return c ? { v: cloneVal(c.v), f: c.f, nf: c.nf, bg: c.bg, fw: c.fw, dv: c.dv } : undefined; }
  function snapSheet(s) {
    return {
      name: s._name, id: s._id, maxRows: s._maxRows, maxCols: s._maxCols, hidden: s._hidden,
      frozenRows: s._frozenRows, frozenCols: s._frozenCols, widths: Object.assign({}, s._widths),
      rows: s._rows.map(function (row) { return row ? row.map(cloneCell) : undefined; }),
    };
  }
  M.reset = function (opts) {
    opts = opts || {};
    STATE = freshState(opts);
    clearBuffers();
    M.user = opts.user !== undefined ? opts.user : DEFAULT_USER;
    M.effectiveUser = DEFAULT_USER;
    M.tz = 'America/Santiago'; M.ssTz = 'America/Santiago';
    M.bound = true; M.ui = false; M.coerce = true; M.lockBusy = false; M.mailQuota = 1500;
    M.fetchHandler = null;
    M.gmail.messages = []; M.gmail.seq = 0;
    dvReset();
    return M;
  };
  M.clearBuffers = clearBuffers;
  M.snapshot = function () {
    var s = STATE.ss;
    return {
      ss: { name: s._name, id: s._id, seq: s._seq, active: s._active ? s._active._name : null, sheets: s._sheets.map(snapSheet) },
      props: JSON.parse(JSON.stringify(STATE.props)),
      cache: JSON.parse(JSON.stringify(STATE.cache)),
      triggers: STATE.triggers.map(function (t) { return { fn: t._fn, cfg: JSON.parse(JSON.stringify(t._cfg)), id: t._id, owner: t._owner }; }),
      uuidSeed: STATE.uuidSeed,
      mailQuota: M.mailQuota,
      gmail: gmClone(M.gmail.messages),
      gmailSeq: M.gmail.seq,
      drive: dvSnapshot(),
    };
  };
  M.restore = function (snap) {
    var st = freshState({ name: snap.ss.name, id: snap.ss.id });
    var ssObj = st.ss;
    ssObj._seq = snap.ss.seq;
    snap.ss.sheets.forEach(function (x) {
      var sh = new MSheet(ssObj, x.name, { id: x.id, maxRows: x.maxRows, maxCols: x.maxCols, hidden: x.hidden });
      sh._frozenRows = x.frozenRows; sh._frozenCols = x.frozenCols; sh._widths = Object.assign({}, x.widths);
      sh._rows = x.rows.map(function (row) { return row ? row.map(cloneCell) : undefined; });
      sh._dirty = true;
      ssObj._sheets.push(sh);
    });
    ssObj._active = ssObj._sheets.find(function (s) { return s._name === snap.ss.active; }) || ssObj._sheets[0] || null;
    st.props = JSON.parse(JSON.stringify(snap.props));
    st.cache = JSON.parse(JSON.stringify(snap.cache));
    STATE = st;
    STATE.triggers = snap.triggers.map(function (t) { var tr = new Trigger(t.fn, t.cfg); tr._id = t.id; tr._owner = t.owner; return tr; });
    STATE.uuidSeed = snap.uuidSeed;
    M.mailQuota = snap.mailQuota;
    M.gmail.messages = gmClone(snap.gmail);
    M.gmail.seq = snap.gmailSeq || 0;
    dvRestore(snap.drive);
    return M;
  };

  /* ---------- Helpers para seeds y pruebas ---------- */
  // Crea una hoja con valores (2D, fila 1 = encabezados). opts: {maxRows, maxCols, formats:{'D2:G1000':'#,##0'}, hidden, index}
  M.addSheet = function (name, values, opts) {
    opts = opts || {};
    var s = ss();
    values = values || [];
    var width = values.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
    var sh = s._add(name, opts.index == null ? null : opts.index, {
      maxRows: Math.max(opts.maxRows || 1000, values.length), maxCols: Math.max(opts.maxCols || 26, width), hidden: !!opts.hidden,
    });
    Object.keys(opts.formats || {}).forEach(function (rng) { sh._proxy.getRange(rng).setNumberFormat(opts.formats[rng]); });
    var coerceWas = M.coerce;
    M.coerce = opts.coerce === undefined ? false : !!opts.coerce; // los datos semilla ya vienen tipados
    values.forEach(function (row, i) { row.forEach(function (v, j) { if (v !== '' && v != null) sh._write(i + 1, j + 1, v); }); });
    M.coerce = coerceWas;
    if (opts.frozenRows) sh._frozenRows = opts.frozenRows;
    if (!s._active) s._active = sh;
    return sh._proxy;
  };
  M.removeAllSheets = function () { var s = ss(); s._sheets = []; s._active = null; };
  M.spreadsheet = function () { return ss()._proxy; };
  M.sheet = function (name) { return ss().getSheetByName(name); };
  M.sheetNames = function () { return ss()._sheets.map(function (s) { return s._name; }); };
  M.values = function (name) { var sh = M.sheet(name); return sh ? sh.getDataRange().getValues() : null; };
  M.triggers = function () { return STATE.triggers.map(function (t) { return { handler: t._fn, id: t._id, owner: t._owner, cfg: JSON.parse(JSON.stringify(t._cfg)) }; }); };
  M.menus = function () { return JSON.parse(JSON.stringify(STATE.menus || [])); };
  M.props = function (kind) { return Object.assign({}, STATE.props[kind || 'script']); };
  M.setFormula = function (sheetName, a1n, formula, cached) {
    var sh = ss()._sheets.find(function (s) { return s._name === sheetName; });
    if (!sh) throw new Error('No existe la hoja ' + sheetName);
    var p = parseA1(sh, a1n);
    var cell = sh._ensure(p.r, p.c);
    cell.f = formula.charAt(0) === '=' ? formula : '=' + formula;
    cell.v = cached === undefined ? '' : cached;
    sh._dirty = true;
  };
  M.strictClone = strictClone;
  M.findIllegal = findIllegal;
  M.formatDate = formatDate;
  M.wallToDate = wallToDate;
  M.colToNum = colToNum;
  M.numToCol = numToCol;
  M.geminiReply = geminiReply;
  M.geminiDefault = geminiDefault;
  M.promptText = promptText;
  M.promptIds = promptIds;
  M.firstRecord = firstRecord;
  M.lastFetch = function () { return M.fetches[M.fetches.length - 1] || null; };
  M.lastPrompt = function () { var f = M.lastFetch(); return f ? promptText(f.json) : ''; };
  M.httpResponse = httpResponse;
  M.console = mconsole;
  M.services = {
    SpreadsheetApp: SpreadsheetApp, PropertiesService: PropertiesService, CacheService: CacheService,
    LockService: LockService, Session: Session, Utilities: Utilities, MailApp: MailApp, GmailApp: GmailApp,
    DriveApp: DriveApp, ScriptApp: ScriptApp, UrlFetchApp: UrlFetchApp, HtmlService: HtmlService, ContentService: ContentService,
    Logger: Logger,
  };

  M.reset();
  return M;
})();

/* Servicios globales (mismos nombres que Apps Script) */
var SpreadsheetApp = MOCK.services.SpreadsheetApp;
var PropertiesService = MOCK.services.PropertiesService;
var CacheService = MOCK.services.CacheService;
var LockService = MOCK.services.LockService;
var Session = MOCK.services.Session;
var Utilities = MOCK.services.Utilities;
var MailApp = MOCK.services.MailApp;
var GmailApp = MOCK.services.GmailApp;
var DriveApp = MOCK.services.DriveApp;
var ScriptApp = MOCK.services.ScriptApp;
var UrlFetchApp = MOCK.services.UrlFetchApp;
var HtmlService = MOCK.services.HtmlService;
var ContentService = MOCK.services.ContentService;
var Logger = MOCK.services.Logger;
// En jsc no existe console; en el navegador se reenvía al console real con prefijo [servidor]
var console = MOCK.console;
