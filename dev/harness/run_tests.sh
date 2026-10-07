#!/usr/bin/env bash
# =====================================================================
# run_tests.sh · banco de pruebas del servidor (Apps Script emulado en JavaScriptCore)
#
#   bash dev/harness/run_tests.sh              todas las pruebas
#   bash dev/harness/run_tests.sh asistente    sólo las que contienen "asistente" en el nombre
#   VERBOSE=1 bash dev/harness/run_tests.sh    muestra console/Logger del servidor
#
# Pasos: 1) lint de los .gs (nombres repetidos, código en el nivel superior)
#        2) carga aislada de cada .gs (sólo con mocks: detecta dependencias de orden de carga)
#        3) pruebas: mocks.js + Code.gs + resto de .gs (alfabético) + seed.js + tests/_framework.js + tests/*.js
# Sale con código ≠ 0 si algo falla.
# =====================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP="$ROOT/apps-script"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"
FILTER="${1:-}"
export TZ="America/Santiago"   # Apps Script corre con la zona del proyecto (appsscript.json)

if [ ! -x "$JSC" ]; then
  echo "No encuentro jsc en $JSC (define JSC=/ruta/a/jsc)."
  exit 2
fi

GS=()
[ -f "$APP/Code.gs" ] && GS+=("$APP/Code.gs")
while IFS= read -r f; do [ -n "$f" ] && GS+=("$f"); done < <(ls "$APP"/*.gs 2>/dev/null | grep -v '/Code\.gs$' | LC_ALL=C sort)
HTML=()
while IFS= read -r f; do [ -n "$f" ] && HTML+=("$f"); done < <(ls "$APP"/*.html 2>/dev/null | LC_ALL=C sort)
TESTS=()
while IFS= read -r f; do [ -n "$f" ] && TESTS+=("$f"); done < <(ls "$HERE"/tests/*.js 2>/dev/null | grep -v '/_framework\.js$' | LC_ALL=C sort)

PRE_FAIL=0

echo "== 1. Lint de los .gs =="
if command -v python3 >/dev/null 2>&1; then
  python3 "$HERE/tools/lint_gs.py" "${GS[@]}" || PRE_FAIL=$((PRE_FAIL + 1))
else
  echo "AVISO python3 no disponible: se omite el lint"
fi

echo
echo "== 2. Carga aislada de cada .gs (sólo mocks) =="
for f in "${GS[@]}"; do
  out="$("$JSC" "$HERE/mocks.js" "$f" 2>&1)"
  if printf '%s' "$out" | grep -q "Exception:"; then
    echo "FAIL  carga aislada $(basename "$f")"
    printf '%s\n' "$out" | grep -v '^$' | head -4 | sed 's/^/      /'
    PRE_FAIL=$((PRE_FAIL + 1))
  else
    echo "PASS  carga aislada $(basename "$f")"
  fi
done

echo
echo "== 3. Pruebas =="
OUT="$(mktemp -t aacc_tests.XXXXXX)"
trap 'rm -f "$OUT"' EXIT
PRE=("$HERE/mocks.js")
[ -n "${VERBOSE:-}" ] && PRE+=("$HERE/tools/verbose.js")
"$JSC" "${PRE[@]}" "$HERE/jsc_driver.js" -- "$ROOT" "$FILTER" \
  "${GS[@]}" "$HERE/seed.js" "$HERE/tests/_framework.js" "${TESTS[@]}" "${HTML[@]}" 2>&1 | tee "$OUT"

line="$(grep '^HARNESS_RESULT' "$OUT" | tail -1)"
if [ -z "$line" ]; then
  echo
  echo "FAIL  el runner terminó antes de tiempo (revisa la salida de arriba)"
  exit 1
fi
nfail="$(printf '%s' "$line" | sed -E 's/.*fail=([0-9]+).*/\1/')"
total=$((PRE_FAIL + nfail))
echo
if [ "$total" -gt 0 ]; then
  echo "TOTAL: $total con fallas (lint/carga: $PRE_FAIL · pruebas: $nfail)"
  exit 1
fi
echo "TOTAL: todo OK"
exit 0
