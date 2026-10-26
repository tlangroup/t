#!/usr/bin/env bash
# fb_bash.sh — S2 self-host bootstrap fixed-point check (bash driver).
# Mirrors tools/fb.mjs logic but spawns the seed/exe directly (avoids Node EBUSY).
set -u
ROOT="C:/seesaw/codebuddy/t"
SRC="$ROOT/src/tc.tc"
SEED="$ROOT/out/dbg/tc.exe"
RUNTIME="$ROOT/runtime"
RLIB="$ROOT/out/dbg/deps/t_runtime.lib"
CLANG="C:/Program Files/LLVM/bin/clang.exe"

# Inject MSVC env (LIB/INCLUDE) from tools/msvc_env.mjs
ENV_LINES="$(node -e "import('$ROOT/tools/msvc_env.mjs').then(m=>{m.ensureMsvcEnv();console.log('LIB='+JSON.stringify(process.env.LIB));console.log('INCLUDE='+JSON.stringify(process.env.INCLUDE));}).catch(e=>{console.log('ERR='+e.message);process.exit(1)})")"
eval "$ENV_LINES"
echo "LIB set: ${LIB:+yes}"
echo "INCLUDE set: ${INCLUDE:+yes}"

emit() {
  local comp="$1"; local outdir="$2"
  mkdir -p "$outdir"
  "$comp" compile "$SRC" --emit-c --output "$outdir" > "$outdir/emit.log" 2>&1
  local rc=$?
  echo "  emit rc=$rc  ($(wc -c < "$outdir/tc.c" 2>/dev/null) bytes tc.c)"
  return $rc
}

linkg() {
  local outdir="$1"; local exe="$2"
  "$CLANG" -std=c11 -O0 -I"$RUNTIME" -I"$outdir" \
    "$outdir/tc.c" "$RLIB" -o "$outdir/$exe" \
    -Wl,-subsystem:console -Wl,/STACK:268435456 > "$outdir/link.log" 2>&1
  local rc=$?
  echo "  link rc=$rc  -> $outdir/$exe"
  return $rc
}

echo "gen1: SEED -> genA -> g1.exe"
emit "$SEED" "$ROOT/out/fb/genA" || { echo "FAIL emit genA"; cat "$ROOT/out/fb/genA/emit.log"; exit 1; }
linkg "$ROOT/out/fb/genA" "g1.exe" || { echo "FAIL link genA"; cat "$ROOT/out/fb/genA/link.log"; exit 1; }
G1="$ROOT/out/fb/genA/g1.exe"

echo "gen2: g1 -> genB -> g2.exe"
emit "$G1" "$ROOT/out/fb/genB" || { echo "FAIL emit genB"; cat "$ROOT/out/fb/genB/emit.log"; exit 1; }
linkg "$ROOT/out/fb/genB" "g2.exe" || { echo "FAIL link genB"; cat "$ROOT/out/fb/genB/link.log"; exit 1; }
G2="$ROOT/out/fb/genB/g2.exe"

echo "gen3: g2 -> genC -> g3.exe"
emit "$G2" "$ROOT/out/fb/genC" || { echo "FAIL emit genC"; cat "$ROOT/out/fb/genC/emit.log"; exit 1; }
linkg "$ROOT/out/fb/genC" "g3.exe" || { echo "FAIL link genC"; cat "$ROOT/out/fb/genC/link.log"; exit 1; }

echo ""
echo "=== fixed-point comparison: genB vs genC ==="
CH="$(cmp -s "$ROOT/out/fb/genB/tc.h" "$ROOT/out/fb/genC/tc.h" && echo SAME || echo DIFF)"
CC="$(cmp -s "$ROOT/out/fb/genB/tc.c" "$ROOT/out/fb/genC/tc.c" && echo SAME || echo DIFF)"
echo "tc.h: $CH"
echo "tc.c: $CC"
if [ "$CH" = "SAME" ] && [ "$CC" = "SAME" ]; then
  echo "S2 SELF-HOST FIXED POINT REACHED"
  exit 0
else
  echo "FIXED POINT NOT REACHED (DIFF)"
  exit 1
fi
