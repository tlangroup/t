#!/usr/bin/env node
// fb.mjs — focused self-host fixed-point check for S2 (no tsx needed).
// Uses the existing seed (out/dbg/tc.exe, S1b) as gen0 to compile the S2 src/tc.tc,
// then verifies the S2-derived compiler self-hosts: g1 -> g2 -> g3 with C_b == C_c.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findClang } from "./toolchain.mjs";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const SRC = join(ROOT, "src", "tc.tc");
const RUNTIME = join(ROOT, "runtime");
const SEED = join(ROOT, "out", "dbg", "tc.exe");
const { path: CLANG } = findClang();
ensureMsvcEnv();
const RUNTIME_LIB = join(ROOT, "out", "dbg", "deps", "t_runtime.lib");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], ...opts });
}
function emitWith(compilerExe, outDir) {
  mkdirSync(outDir, { recursive: true });
  run(compilerExe, ["compile", SRC, "--emit-c", "--output", outDir]);
  return { h: readFileSync(join(outDir, "tc.h")), c: readFileSync(join(outDir, "tc.c")) };
}
function link(outDir, exeName) {
  run(CLANG, [
    "-std=c11", "-O0",
    `-I${RUNTIME}`, `-I${outDir}`,
    join(outDir, "tc.c"), RUNTIME_LIB,
    "-o", join(outDir, exeName),
    "-Wl,-subsystem:console", "-Wl,/STACK:268435456", "-Wl,/LARGEADDRESSAWARE",
  ]);
  return join(outDir, exeName);
}
function cmp(a, b) { return a.h.equals(b.h) && a.c.equals(b.c); }

console.log("gen1: seed -> C_a -> g1.exe");
const A = emitWith(SEED, join(ROOT, "out", "fb", "genA"));
const g1 = link(join(ROOT, "out", "fb", "genA"), "g1.exe");

console.log("gen2: g1 -> C_b -> g2.exe");
const B = emitWith(g1, join(ROOT, "out", "fb", "genB"));
const g2 = link(join(ROOT, "out", "fb", "genB"), "g2.exe");

console.log("gen3: g2 -> C_c -> g3.exe");
const C = emitWith(g2, join(ROOT, "out", "fb", "genC"));
link(join(ROOT, "out", "fb", "genC"), "g3.exe");

const bc = cmp(B, C);
console.log(`\nC_b == C_c (fixed point): ${bc ? "OK" : "DIFF"}`);
if (bc) { console.log("S2 SELF-HOST FIXED POINT REACHED"); process.exit(0); }
process.exit(1);
