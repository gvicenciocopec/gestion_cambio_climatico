#!/usr/bin/env python3
"""
Convierte la primera hoja de un .xlsx (o un sheet1.xml ya extraído) en JSON con los valores tipados,
para regenerar el bloque SEED_CUADRE_2026 de dev/harness/seed.js.

Uso:
  python3 dev/harness/tools/xlsx_to_seed.py planilla.xlsx            > filas.json
  python3 dev/harness/tools/xlsx_to_seed.py xl/worksheets/sheet1.xml > filas.json
  python3 dev/harness/tools/xlsx_to_seed.py planilla.xlsx --patch     (reemplaza el bloque en seed.js)

Celdas: inlineStr (<is><t>), str/s (texto), números (<v>) → int si es entero. Filas vacías al final se omiten.
"""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(os.path.dirname(HERE), 'seed.js')


def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xml(path):
    if path.lower().endswith('.xlsx'):
        with zipfile.ZipFile(path) as z:
            shared = []
            if 'xl/sharedStrings.xml' in z.namelist():
                sroot = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in sroot.findall('m:si', NS):
                    shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
            return ET.fromstring(z.read('xl/worksheets/sheet1.xml')), shared
    return ET.parse(path).getroot(), []


def parse(path):
    root, shared = read_xml(path)
    rows = []
    for r in root.find('m:sheetData', NS).findall('m:row', NS):
        cells = {}
        for c in r.findall('m:c', NS):
            i = col_index(c.get('r'))
            typ = c.get('t')
            if typ == 'inlineStr':
                v = ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
            else:
                ve = c.find('m:v', NS)
                v = ve.text if ve is not None and ve.text is not None else ''
                if typ == 's' and v != '':
                    v = shared[int(v)]
                elif typ not in ('str', 's', 'inlineStr', 'b') and v != '':
                    f = float(v)
                    v = int(f) if f == int(f) else f
                elif typ == 'b':
                    v = v == '1'
            cells[i] = v
        width = max(cells.keys()) + 1 if cells else 0
        rows.append([cells.get(j, '') for j in range(width)])
    width = max((len(r) for r in rows), default=0)
    rows = [r + [''] * (width - len(r)) for r in rows]
    while rows and all(v == '' for v in rows[-1]):
        rows.pop()
    return rows


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    rows = parse(sys.argv[1])
    block = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    if '--patch' in sys.argv:
        src = open(SEED, encoding='utf-8').read()
        pat = re.compile(r'(// <SEED_CUADRE_2026>\n)(.*?)(\n// </SEED_CUADRE_2026>)', re.S)
        if not pat.search(src):
            sys.exit('No encontré el bloque // <SEED_CUADRE_2026> en seed.js')
        rows_js = '[\n' + ',\n'.join('  ' + json.dumps(r, ensure_ascii=False) for r in rows) + '\n]'
        src = pat.sub(lambda m: m.group(1) + 'var SEED_CUADRE_2026 = ' + rows_js + ';' + m.group(3), src)
        open(SEED, 'w', encoding='utf-8').write(src)
        print('seed.js actualizado: %d filas (incluye encabezado)' % len(rows))
    else:
        print(block)


if __name__ == '__main__':
    main()
