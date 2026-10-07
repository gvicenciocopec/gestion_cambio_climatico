#!/usr/bin/env python3
"""
check_icons.py · verifica que cada ícono Lucide usado en la app exista en el build real (lucide@1.50.0).

  python3 dev/harness/check_icons.py                 revisa apps-script/*.html (+ campos icon: de los .gs)
  python3 dev/harness/check_icons.py --search trash  busca nombres parecidos en el build
  python3 dev/harness/check_icons.py --from ruta/lucide.min.js   usa una copia local (sin descargar)

El build se guarda en dev/harness/vendor/ (caché). La resolución de nombres es la misma que hace
lucide.createIcons(): data-lucide="clipboard-pen" → "ClipboardPen" (incluye alias, p. ej. "trash-2").
Detecta nombres en: icon('x' ...) (todo literal del 1er argumento, también ternarios), badge(t, tono, 'x'),
claves icon:/iconName:/...Icon: 'x', asignaciones icon = 'x', data-lucide="x", return 'x' dentro de
funciones fooIcon(), y pares ['x', 'text-…'] (metadatos de toasts). Sale con 1 si hay nombres desconocidos.
"""
import os
import re
import shutil
import sys
import urllib.request

VERSION = '1.50.0'
URL = 'https://unpkg.com/lucide@%s/dist/umd/lucide.min.js' % VERSION
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
APP = os.path.join(ROOT, 'apps-script')
VENDOR = os.path.join(HERE, 'vendor')
CACHE = os.path.join(VENDOR, 'lucide@%s.min.js' % VERSION)

NAME_RE = re.compile(r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
# Nombres antiguos que la SPEC §11 pide reemplazar (siguen funcionando como alias)
DEPRECATED = {
    'trash-2': 'trash', 'history': 'rotate-ccw-clock', 'filter': 'funnel', 'loader-2': 'loader-circle',
    'more-horizontal': 'ellipsis', 'more-vertical': 'ellipsis-vertical', 'bar-chart': 'chart-column',
    'bar-chart-2': 'chart-column', 'bar-chart-3': 'chart-column', 'pie-chart': 'chart-pie', 'help-circle': 'circle-help',
    'x-circle': 'circle-x', 'check-circle': 'circle-check', 'check-circle-2': 'circle-check', 'alert-triangle': 'triangle-alert',
    'alert-circle': 'circle-alert', 'edit': 'pencil', 'edit-2': 'pencil', 'edit-3': 'pencil-line',
}
SKIP_KEYS = re.compile(r'(cls|class|classes|html|tone|color|colour|size|box|wrap|bg)$', re.I)


def ensure_build(local=None):
    os.makedirs(VENDOR, exist_ok=True)
    if local:
        shutil.copyfile(local, CACHE)
    if not os.path.exists(CACHE):
        print('Descargando %s …' % URL)
        req = urllib.request.Request(URL, headers={'User-Agent': 'cuadre-aacc-harness'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(CACHE, 'wb') as f:
            f.write(data)
    src = open(CACHE, encoding='utf-8').read()
    if VERSION not in src[:300]:
        print('AVISO el archivo en caché no parece ser lucide v%s' % VERSION)
    return src


def icon_keys(src):
    """Claves PascalCase exportadas (canónicas + alias)."""
    m = re.search(r'\b([A-Za-z_$][\w$]*)\.createIcons=', src)
    keys = set()
    if m:
        keys = set(re.findall(r'\b' + re.escape(m.group(1)) + r'\.([A-Z][A-Za-z0-9]*)=', src))
    if len(keys) < 1000:  # respaldo: objeto icons
        keys |= set(re.findall(r'[,{]([A-Z][A-Za-z0-9]*):', src))
    if len(keys) < 1000:
        sys.exit('No pude leer la lista de íconos del build (%d nombres).' % len(keys))
    return keys


def to_pascal(name):
    """Igual que lucide.createIcons (toCamelCase + mayúscula inicial)."""
    t, cap = '', False
    for ch in name:
        if ch in '-_' or ch <= ' ':
            cap = len(t) > 0
            continue
        t += ch.lower() if not t else (ch.upper() if cap else ch)
        cap = False
    return t[:1].upper() + t[1:]


def kebab(pascal):
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '-', pascal)
    s = re.sub(r'(?<=[A-Za-z])(?=[0-9])', '-', s)
    return s.lower()


def skip_string(s, i):
    q = s[i]
    j = i + 1
    level = 0
    while j < len(s):
        c = s[j]
        if c == '\\':
            j += 2
            continue
        if q == '`':
            if c == '$' and j + 1 < len(s) and s[j + 1] == '{':
                level += 1
                j += 2
                continue
            if level and c == '}':
                level -= 1
            elif not level and c == '`':
                return j + 1
        elif c == q or c == '\n':
            return j + 1
        j += 1
    return j


def take_expr(s, i, stop_at_comma=True, block=False):
    """Desde i, devuelve la expresión hasta , ) } ; o salto de línea en profundidad 0 (block=True: hasta la } que cierra)."""
    depth = 0
    j = i
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_string(s, j)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and not block and ((c == ',' and stop_at_comma) or c in ';\n'):
            break
        j += 1
    return s[i:j]


def call_args(s, i):
    """i = índice justo después de '('. Devuelve la lista de argumentos (texto)."""
    out = []
    while i < len(s):
        a = take_expr(s, i)
        out.append(a)
        i += len(a)
        if i >= len(s) or s[i] != ',':
            break
        i += 1
    return out


def literals(expr):
    e = re.sub(r"(===|!==|==|!=)\s*('[^'\n]*'|\"[^\"\n]*\")", ' ', expr)
    e = re.sub(r"('[^'\n]*'|\"[^\"\n]*\")\s*(===|!==|==|!=)", ' ', e)
    e = re.sub(r"\[\s*('[^'\n]*'|\"[^\"\n]*\")\s*\]", ' ', e)              # obj['clave']
    e = re.sub(r"\.[A-Za-z_$][\w$]*\(\s*('[^'\n]*'|\"[^\"\n]*\")", ' ', e)   # x.metodo('arg')
    out = []
    for m in re.finditer(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"", e):
        v = m.group(1) if m.group(1) is not None else m.group(2)
        if NAME_RE.match(v) and not re.match(r'^size-[0-9.]+$', v):
            out.append(v)
    return out


def line_of(s, i):
    return s.count('\n', 0, i) + 1


def scan(path, gs=False):
    s = open(path, encoding='utf-8').read()
    found = []  # (nombre, línea, contexto)

    def add(names, pos, ctx):
        for n in names:
            found.append((n, line_of(s, pos), ctx))

    # Claves icon: / iconName: / fooIcon: 'x'  (y asignaciones icon = 'x')
    for m in re.finditer(r'\b([A-Za-z_$]*[iI]con[A-Za-z_$]*)\s*(:|=(?![=>]))\s*', s):
        key = m.group(1)
        if SKIP_KEYS.search(key) or key in ('icons', 'createIcons', 'refreshIcons', 'lucide'):
            continue
        if m.group(2) == ':' and s[m.start() - 1:m.start()] == '?':
            continue
        add(literals(take_expr(s, m.end())), m.start(), key + ':')
    if gs:
        return found
    # icon('x' ...) → literales del 1er argumento
    for m in re.finditer(r'(?<![\w$.])icon\(\s*', s):
        args = call_args(s, m.end())
        if args:
            add(literals(args[0]), m.start(), 'icon()')
    # badge(texto, tono, 'ícono')
    for m in re.finditer(r'(?<![\w$.])badge\(\s*', s):
        args = call_args(s, m.end())
        if len(args) >= 3:
            add(literals(args[2]), m.start(), 'badge()')
    # data-lucide="x" estático
    for m in re.finditer(r'data-lucide="([^"]+)"', s):
        if NAME_RE.match(m.group(1)):
            add([m.group(1)], m.start(), 'data-lucide')
    # return 'x' dentro de funciones *Icon(...)
    for m in re.finditer(r'function\s+([A-Za-z_$]*Icon)\s*\([^)]*\)\s*\{', s):
        if m.group(1) in ('icon', 'refreshIcons'):
            continue
        body = take_expr(s, m.end(), stop_at_comma=False, block=True)
        for r in re.finditer(r'\breturn\s+', body):
            add(literals(take_expr(body, r.end(), stop_at_comma=False)), m.end() + r.start(), m.group(1) + '()')
    # ['x', 'text-…'] (metadatos ícono + clase de color)
    for m in re.finditer(r"\[\s*'([a-z][a-z0-9-]*)'\s*,\s*'text-", s):
        add([m.group(1)], m.start(), "['ícono', 'text-…']")
    return found


def main():
    args = sys.argv[1:]
    local = None
    if '--from' in args:
        local = args[args.index('--from') + 1]
    src = ensure_build(local)
    keys = icon_keys(src)
    if '--search' in args:
        q = args[args.index('--search') + 1].lower().replace('-', '')
        hits = sorted(k for k in keys if q in k.lower())
        print('\n'.join('%-28s ~ %s' % (kebab(k), k) for k in hits) or 'sin coincidencias')
        return 0

    files = sorted(f for f in os.listdir(APP) if f.endswith('.html') and f != 'App.html')
    gsf = sorted(f for f in os.listdir(APP) if f.endswith('.gs'))
    uses = []
    for f in files:
        uses += [(n, f, ln, ctx) for n, ln, ctx in scan(os.path.join(APP, f))]
    for f in gsf:
        uses += [(n, f, ln, ctx) for n, ln, ctx in scan(os.path.join(APP, f), gs=True)]

    unknown, old = [], []
    seen = set()
    for n, f, ln, ctx in uses:
        seen.add(n)
        if to_pascal(n) not in keys:
            unknown.append((n, f, ln, ctx))
        elif n in DEPRECATED:
            old.append((n, f, ln, ctx))
    print('Lucide %s · %d nombres en el build (%s)' % (VERSION, len(keys), os.path.relpath(CACHE, ROOT)))
    print('Íconos usados: %d distintos en %d archivos (%d apariciones)' % (len(seen), len(set(u[1] for u in uses)), len(uses)))
    for n, f, ln, ctx in old:
        print('AVISO "%s" es un nombre antiguo → usa "%s" (SPEC §11) · %s:%d %s' % (n, DEPRECATED[n], f, ln, ctx))
    for n, f, ln, ctx in unknown:
        near = sorted(k for k in keys if to_pascal(n)[:5].lower() in k.lower())[:4]
        print('FAIL  ícono desconocido "%s" · %s:%d %s%s' % (n, f, ln, ctx, ('  (¿' + ', '.join(kebab(k) for k in near) + '?)') if near else ''))
    if not unknown:
        print('PASS  todos los íconos existen en lucide@%s' % VERSION)
    return 1 if unknown else 0


if __name__ == '__main__':
    sys.exit(main())
