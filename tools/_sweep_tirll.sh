#!/usr/bin/env bash
# Sweep: emit-tir-ll + clang -c over examples/*.tc
set -u
TC=${TC:-out/dbg/tc_tirll.exe}
CLANG="C:/Program Files/LLVM/bin/clang.exe"
EX=examples
TMP=out/dbg/_sweep
mkdir -p "$TMP"
PASS=0; FAIL=0; SKIP=0
FAILLIST=""
for f in "$EX"/*.tc; do
  name=$(basename "$f" .tc)
  out="$TMP/$name"
  # emit-tir-ll
  if ! "$TC" emit-tir-ll "$f" --output "$out" --mode dbg >/dev/null 2>&1; then
    SKIP=$((SKIP+1))
    echo "SKIP  $name (emit failed)"
    continue
  fi
  ll="$out.tir.ll"
  if [ ! -f "$ll" ]; then
    SKIP=$((SKIP+1))
    echo "SKIP  $name (no .tir.ll)"
    continue
  fi
  if "$CLANG" -c "$ll" -o "$out.o" >/dev/null 2>&1; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    FAILLIST="$FAILLIST $name"
    echo "FAIL  $name"
  fi
done
echo "==== SUMMARY: PASS=$PASS FAIL=$FAIL SKIP=$SKIP ===="
if [ -n "$FAILLIST" ]; then
  echo "FAILURES:$FAILLIST"
fi
