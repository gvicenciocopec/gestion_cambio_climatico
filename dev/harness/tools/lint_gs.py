#!/usr/bin/env python3
"""
lint_gs.py · reglas duras de SPEC §0 sobre los .gs (ámbito global compartido de Apps Script)

ERROR (exit 1):
  - un nombre de nivel superior declarado en más de un .gs (function/const/let/var/class)
  - un nombre que choca con los servicios simulados o con el banco de pruebas (mocks/seed/tests)
  - código ejecutable en el nivel superior (llamadas, asignaciones, IIFE): sólo se permiten declaraciones
AVISO:
  - helpers privados (terminan en _) sin el prefijo del módulo (pres*, g*, notif*, ai*, setup*)
  - funciones públicas (sin _) que no figuran en la API de SPEC §5
Uso: python3 dev/harness/tools/lint_gs.py apps-script/*.gs
"""
import os
import re
import sys

PREFIX = {'Presupuesto.gs': ('pres', 'PRES_'), 'Gestion.gs': ('g', 'G_'), 'Notificaciones.gs': ('notif', 'NOTIF_'),
          'Asistente.gs': ('ai', 'AI_'), 'Setup.gs': ('setup', 'SETUP_'), 'Aprobaciones.gs': ('aprob', 'APROB_'), 'WhatsApp.gs': ('wa', 'WA_')}
SPEC_PUBLIC = {
    'Code.gs': {'doGet', 'include', 'bootstrap', 'getHistory', 'getAdminStatus', 'setAppUrl', 'CONFIG'},
    'Presupuesto.gs': {'budgetSave', 'budgetDelete', 'budgetCreateYear', 'recalcAll'},
    'Gestion.gs': {'gSave', 'gDelete', 'taskComplete', 'taskReopen', 'taskReorder', 'tasksSetPrivacy', 'importCascadeProjects', 'commentAdd', 'commentDelete', 'G_HEADERS'},
    'Aprobaciones.gs': {'aprobScan', 'aprobLink', 'aprobNewLine', 'aprobDiscard', 'aprobReset', 'aprobInstall', 'aprobScanTrigger', 'aprobMailView'},
    'Notificaciones.gs': {'installTrigger', 'notifDaily', 'sendTestDigest'},
    'Asistente.gs': {'ask'},
    'WhatsApp.gs': set(),
    'Setup.gs': {'setup', 'onOpen', 'toggleGestionSheet', 'CASCADE_SEED'},
}
RESERVED = {
    # servicios simulados (mocks.js)
    'MOCK', 'SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'Session', 'Utilities', 'MailApp',
    'GmailApp', 'DriveApp', 'ScriptApp', 'UrlFetchApp', 'HtmlService', 'ContentService', 'Logger', 'console',
    # banco de pruebas (seed.js, tests/_framework.js, jsc_driver.js)
    'SEED_CUADRE_2026', 'SEED_CUADRE_2027', 'seedSpreadsheet', 'seedDemoGestion', '__H', 'U', 'ADMIN', 'test', 'ok', 'eq',
    'deepEq', 'throws', 'includes', 'assertNoDates', 'G', 'need', 'fresh', 'client', 'asUser', 'rowsOf', 'gRows', 'day',
    'lineBy', 'casBy', 'readText', '__harnessRun', '__drv', '__drvArgs',
}
KEYWORDS_OK = {'function', 'async', 'const', 'let', 'var', 'class'}


def strip_code(src):
    """Devuelve (líneas, profundidad al inicio de cada línea) ignorando strings, comentarios, templates y regex."""
    depth_at = []
    out = []
    depth = 0
    i = 0
    n = len(src)
    line_start = True
    cur = []
    prev_sig = ''  # último carácter significativo (para distinguir regex de división)
    while i < n:
        ch = src[i]
        if line_start:
            depth_at.append(depth)
            line_start = False
        if ch == '\n':
            out.append(''.join(cur)); cur = []; line_start = True; i += 1; continue
        nxt = src[i + 1] if i + 1 < n else ''
        if ch == '/' and nxt == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if ch == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            seg = src[i:(n if j < 0 else j + 2)]
            for _ in range(seg.count('\n')):
                out.append(''.join(cur)); cur = []; depth_at.append(depth)
            i = n if j < 0 else j + 2
            continue
        if ch in ('"', "'"):
            j = i + 1
            while j < n and src[j] != ch:
                if src[j] == '\\':
                    j += 1
                elif src[j] == '\n':
                    break
                j += 1
            cur.append('""'); i = j + 1; prev_sig = '"'; continue
        if ch == '`':
            j = i + 1
            level = 0
            while j < n:
                c = src[j]
                if c == '\\':
                    j += 2
                    continue
                if level == 0 and c == '`':
                    break
                if c == '$' and j + 1 < n and src[j + 1] == '{':
                    level += 1
                    j += 2
                    continue
                if level > 0 and c == '{':
                    level += 1
                elif level > 0 and c == '}':
                    level -= 1
                j += 1
            for _ in range(src[i:j + 1].count('\n')):
                out.append(''.join(cur)); cur = []; depth_at.append(depth + 1)  # líneas dentro del template
            cur.append('``'); i = j + 1; prev_sig = '`'
            continue
        if ch == '/':
            if prev_sig == '' or prev_sig in '(,=:[!&|?{};+-*%<>~^' or re.search(r'\b(return|typeof|case|in|of|delete|void|throw|new)\s*$', ''.join(cur)):
                j = i + 1
                in_class = False
                while j < n and src[j] != '\n':
                    c = src[j]
                    if c == '\\':
                        j += 2; continue
                    if c == '[':
                        in_class = True
                    elif c == ']':
                        in_class = False
                    elif c == '/' and not in_class:
                        break
                    j += 1
                j += 1
                while j < n and src[j].isalpha():
                    j += 1
                cur.append('/r/'); i = j; prev_sig = 'r'; continue
        if ch in '{([':
            depth += 1
        elif ch in '})]':
            depth -= 1
        cur.append(ch)
        if not ch.isspace():
            prev_sig = ch
        i += 1
    out.append(''.join(cur))
    while len(depth_at) < len(out):
        depth_at.append(depth)
    return out, depth_at


DECL = re.compile(r'^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)')


def lint(files):
    errors, warns, info = [], [], []
    owner = {}
    for path in files:
        base = os.path.basename(path)
        src = open(path, encoding='utf-8').read()
        lines, depth = strip_code(src)
        names = []
        for k, ln in enumerate(lines):
            if depth[k] != 0 or not ln or ln[0].isspace():
                continue
            s = ln.strip()
            if not s or s[0] in '})];':
                continue
            m = DECL.match(s)
            if m:
                name = m.group(1) or m.group(2)
                names.append(name)
                if name in owner and owner[name] != base:
                    errors.append('%s:%d  "%s" ya está declarado en %s' % (base, k + 1, name, owner[name]))
                owner.setdefault(name, base)
                if name in RESERVED:
                    errors.append('%s:%d  "%s" choca con un nombre de Apps Script/banco de pruebas' % (base, k + 1, name))
                continue
            first = re.match(r'[A-Za-z_$][\w$]*', s)
            if first and first.group(0) in ('if', 'for', 'while', 'try', 'switch', 'do') or s.startswith('(') or re.match(r'^[A-Za-z_$][\w$.\[\]"]*\s*(\(|=[^=>]|\+=|-=)', s):
                errors.append('%s:%d  código ejecutable en el nivel superior (sólo declaraciones): %s' % (base, k + 1, s[:90]))
        pfx = PREFIX.get(base)
        for nm in names:
            if nm.endswith('_') and pfx and not nm.startswith(pfx[0]):
                warns.append('%s  helper privado "%s" sin prefijo "%s"' % (base, nm, pfx[0]))
            if not nm.endswith('_') and not nm.isupper() and nm not in SPEC_PUBLIC.get(base, set()) and base in SPEC_PUBLIC:
                if re.match(r'^[a-z]', nm):
                    warns.append('%s  nombre público "%s" no está en la API de SPEC §5 (¿debería terminar en _?)' % (base, nm))
            if nm.isupper() or re.match(r'^[A-Z][A-Z0-9_]+$', nm):
                if pfx and not nm.startswith(pfx[1]) and nm not in SPEC_PUBLIC.get(base, set()):
                    warns.append('%s  constante "%s" sin prefijo "%s"' % (base, nm, pfx[1]))
        pub = [x for x in names if not x.endswith('_') and re.match(r'^[a-z]', x)]
        info.append('%-18s %3d nombres · públicas: %s' % (base, len(names), ', '.join(pub) or '—'))
    return errors, warns, info


def main():
    files = [f for f in sys.argv[1:] if f.endswith('.gs')]
    if not files:
        print('lint_gs: no hay archivos .gs')
        return 0
    errors, warns, info = lint(files)
    for l in info:
        print('      ' + l)
    for w in warns:
        print('AVISO ' + w)
    for e in errors:
        print('FAIL  lint ' + e)
    if not errors:
        print('PASS  lint .gs (%d archivos, sin nombres repetidos ni código en el nivel superior)' % len(files))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
