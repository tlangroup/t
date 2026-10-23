#!/usr/bin/env python3
# Resolve MIHIST caller addresses to function names using llvm-symbolizer + PDB.
import sys, subprocess, re

LOG = sys.argv[1] if len(sys.argv) > 1 else "out/dbg/mihist_run.log"
OBJ = sys.argv[2] if len(sys.argv) > 2 else "out/dbg/tc_new.exe"
SYM = r"C:/Program Files/LLVM/bin/llvm-symbolizer.exe"

lines = open(LOG, encoding="utf-8", errors="replace").read().splitlines()
entries = []
for ln in lines:
    m = re.match(r"^MIHIST (0x[0-9a-fA-F]+) bytes=(\d+) cnt=(\d+) avg=(\d+)", ln)
    if m:
        entries.append((int(m.group(1), 16), int(m.group(2)), int(m.group(3)), int(m.group(4))))

# Sort by bytes desc
entries.sort(key=lambda e: e[1], reverse=True)

def resolve(addr):
    try:
        out = subprocess.run([SYM, "--obj", OBJ, "--functions", "--demangle", hex(addr)],
                             capture_output=True, text=True, timeout=30)
        return out.stdout.strip().replace("\n", " | ")
    except Exception as e:
        return "ERR " + str(e)

print("rank  bytes        cnt      avg    function")
print("-" * 100)
for i, (addr, b, c, a) in enumerate(entries[:30], 1):
    name = resolve(addr) or "??"
    print(f"{i:>3}  {b:>12} {c:>8} {a:>8}  {name}")
