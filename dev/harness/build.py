#!/usr/bin/env python3
"""
build.py · genera dev/preview/index.html: la app completa corriendo en el navegador con el servidor simulado.

  python3 dev/harness/build.py            → dev/preview/index.html
  python3 dev/harness/build.py --check    → además valida la sintaxis JS de cada parcial con jsc (si existe)

Qué hace (como HtmlService.createTemplateFromFile('Index').evaluate()):
  - reemplaza <?!= include('X'); ?> por el contenido de apps-script/X.html (si falta → <script> con console.warn)
  - agrega lo que doGet() pone por fuera del HTML: <title> y meta viewport
  - inyecta ANTES de los parciales de la app: mocks.js + .gs (Code.gs primero, luego alfabético) + seed.js
    (como texto, compilados en una función aislada) + preview_shim.js (google.script.run simulado + panel)
  - deja tal cual los <script> de CDN (Tailwind, Lucide, XLSX): el navegador de vista previa tiene red.
Parámetros de la página: ?user=correo · ?gemini=1 · ?empty=1 · ?latency=ms · ?dev=0
"""
import datetime
import json
import urllib.parse
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
APP = os.path.join(ROOT, 'apps-script')
OUT_DIR = os.path.join(ROOT, 'dev', 'preview')
OUT = os.path.join(OUT_DIR, 'index.html')
JSC = os.environ.get('JSC', '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc')
INCLUDE_RE = re.compile(r"<\?!=\s*include\(\s*['\"]([^'\"]+)['\"]\s*\)\s*;?\s*\?>")


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def gs_files():
    files = sorted(f for f in os.listdir(APP) if f.endswith('.gs'))
    if 'Code.gs' in files:
        files.remove('Code.gs')
        files.insert(0, 'Code.gs')
    return files


def public_functions(src):
    names = re.findall(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', src, re.M)
    return [n for n in names if not n.endswith('_')]


def js_literal(obj):
    """JSON seguro dentro de <script>: sin '</script' ni '<!--'."""
    s = json.dumps(obj, ensure_ascii=False)
    return s.replace('</', '<\\/').replace('<!--', '\\u003c!--').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def app_name():
    m = re.search(r"APP_NAME:\s*'([^']+)'", read(os.path.join(APP, 'Code.gs'))) if os.path.exists(os.path.join(APP, 'Code.gs')) else None
    return m.group(1) if m else 'Cuadre AACC'


def check_partials(partials):
    """Valida con jsc el JS de cada <script> inline de los parciales (sólo sintaxis)."""
    if not os.path.exists(JSC):
        print('  (sin jsc: se omite --check)')
        return 0
    bad = 0
    tmp = os.path.join(OUT_DIR, '.chk_build.js')
    for name, html in partials:
        for k, code in enumerate(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)):
            if not code.strip():
                continue
            with open(tmp, 'w', encoding='utf-8') as f:
                f.write('function __w(){\n' + code + '\n}\nprint("OK")')
            r = subprocess.run([JSC, tmp], capture_output=True, text=True)
            if 'OK' not in r.stdout:
                bad += 1
                print('  ERROR de sintaxis en %s.html (script %d): %s' % (name, k + 1, (r.stdout + r.stderr).strip()[:300]))
    if os.path.exists(tmp):
        os.remove(tmp)
    return bad


def build(check=False):
    index_path = os.path.join(APP, 'Index.html')
    if not os.path.exists(index_path):
        sys.exit('No existe apps-script/Index.html')
    index = read(index_path)
    used, missing, partials = [], [], []

    def repl(m):
        name = m.group(1)
        path = os.path.join(APP, name + '.html')
        if not os.path.exists(path):
            missing.append(name)
            return "<script>console.warn('[harness] Falta el parcial %s.html (incluido por Index.html)');</script>" % name
        used.append(name)
        content = read(path)
        partials.append((name, content))
        return content

    # Punto de inyección: antes del primer parcial de la app dentro de <body> (Core)
    body_at = index.find('<body')
    first_app = None
    for m in INCLUDE_RE.finditer(index):
        if m.start() > body_at >= 0:
            first_app = m.start()
            break
    marker = '<!--__HARNESS_INJECT__-->'
    if first_app is not None:
        index = index[:first_app] + marker + index[first_app:]
    elif '</body>' in index:
        index = index.replace('</body>', marker + '</body>', 1)
    else:
        index += marker

    html = INCLUDE_RE.sub(repl, index)
    # Identidad del visitante (doGet → viewerJson): en la vista previa sale de ?user= (por defecto Gonzalo)
    html = html.replace('<?!= viewerJson ?>', "(function(){var q=new URLSearchParams(location.search);return q.has('user')?(q.get('user')||'desconocido'):'gvicencio@copec.cl';})()")
    # Otros scriptlets (no emulados) → se quitan con aviso
    others = re.findall(r'<\?[\s\S]*?\?>', html)
    for o in others:
        print('  AVISO scriptlet no emulado: ' + o[:80])
    html = re.sub(r'<\?[\s\S]*?\?>', '', html)

    # Lo que doGet() agrega fuera del HTML (HtmlService ignora <meta> del archivo)
    head_extra = ('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
                  '<title>%s (local)</title>' % app_name())
    html = re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + head_extra, html, count=1)

    # Fuentes del servidor (texto) + shim
    src = [{'name': 'mocks.js', 'code': read(os.path.join(HERE, 'mocks.js'))}]
    public = []
    for f in gs_files():
        code = read(os.path.join(APP, f))
        src.append({'name': f, 'code': code})
        public += public_functions(code)
    src.append({'name': 'seed.js', 'code': read(os.path.join(HERE, 'seed.js'))})
    info = {
        'builtAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'gs': gs_files(), 'partials': used, 'missing': missing,
    }
    shim = read(os.path.join(HERE, 'preview_shim.js'))
    if re.search(r'</script', shim, re.I):
        sys.exit('preview_shim.js no puede contener "</script"')
    inject = ('\n<!-- ===== harness: servidor Apps Script simulado (dev/harness) ===== -->\n'
              '<script>window.__HARNESS_SRC = ' + js_literal(src) + ';\nwindow.__HARNESS_PUBLIC = ' + js_literal(sorted(set(public))) +
              ';\nwindow.__HARNESS_INFO = ' + js_literal(info) + ';</script>\n<script>' + shim + '</script>\n'
              '<!-- ===== /harness ===== -->\n')
    html = html.replace(marker, inject, 1)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)

    print('dev/preview/index.html generado (%d KB)' % (len(html.encode('utf-8')) // 1024))
    print('  .gs:       ' + ', '.join(info['gs']))
    print('  parciales: ' + ', '.join(used))
    if missing:
        print('  FALTAN:    ' + ', '.join(m + '.html' for m in missing))
    print('  API pública expuesta a google.script.run: ' + ', '.join(sorted(set(public))))
    bad = check_partials(partials) if check else 0
    print('  Abrir: file://' + urllib.parse.quote(OUT) + '   (parámetros: ?user=ibachler@copec.cl&gemini=1&empty=1&latency=0&dev=0)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(build('--check' in sys.argv))
