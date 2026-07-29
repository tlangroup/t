#!/usr/bin/env node
// bootstrap.mjs — M10 三轮自编译不动点验证 (bootstrap.md)
//
// 轮次:
//   gen0: tc0 (TypeScript)      compile src/tc1.tc → C_a; cl → tc1.exe
//   gen1: tc1.exe               compile src/tc1.tc → C_b; cl → tc2.exe
//   gen2: tc2.exe               compile src/tc1.tc → C_c; cl → tc3.exe
// 判定: C_a ≡ C_b ≡ C_c (逐字节)。成立 ⇒ 自举不动点 (Stage 2)。
//
// 用法: node tools/bootstrap.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const SRC = join(ROOT, "src", "tc1.tc");
const RUNTIME = join(ROOT, "runtime");

// ── 定位 MSVC (同 tc0/index.ts findMsvc 逻辑简化版) ──────────────
function findMsvc() {
    const vsRoots = [
        "C:\\Program Files\\Microsoft Visual Studio\\2022",
        "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022",
    ];
    for (const vsRoot of vsRoots) {
        if (!existsSync(vsRoot)) continue;
        for (const edition of readdirSync(vsRoot)) {
            const msvcDir = join(vsRoot, edition, "VC", "Tools", "MSVC");
            if (!existsSync(msvcDir)) continue;
            const vers = readdirSync(msvcDir).sort().reverse();
            for (const v of vers) {
                const cl = join(msvcDir, v, "bin", "Hostx64", "x64", "cl.exe");
                if (!existsSync(cl)) continue;
                const kitsInc = "C:\\Program Files (x86)\\Windows Kits\\10\\Include";
                const kitsLib = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
                if (!existsSync(kitsInc)) continue;
                const sdk = readdirSync(kitsInc).sort().reverse()[0];
                const msvcHome = join(msvcDir, v);
                return {
                    cl,
                    env: {
                        ...process.env,
                        INCLUDE: [
                            join(msvcHome, "include"),
                            join(kitsInc, sdk, "ucrt"),
                            join(kitsInc, sdk, "um"),
                            join(kitsInc, sdk, "shared"),
                        ].join(";"),
                        LIB: [
                            join(msvcHome, "lib", "x64"),
                            join(kitsLib, sdk, "ucrt", "x64"),
                            join(kitsLib, sdk, "um", "x64"),
                        ].join(";"),
                    },
                };
            }
        }
    }
    return null;
}

const msvc = findMsvc();
if (!msvc) { console.error("bootstrap: MSVC (cl.exe) not found"); process.exit(2); }

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], ...opts });
}

function compileC(outDir, exeName) {
    run(msvc.cl, [
        "/nologo", "/std:c11", "/utf-8", "/Od",
        `/I${RUNTIME}`, `/I${outDir}`,
        join(outDir, "tc1.c"), join(RUNTIME, "t_runtime.c"),
        `/Fo${outDir}\\`, `/Fe${join(outDir, exeName)}`,
    ], { env: msvc.env });
    return join(outDir, exeName);
}

function emitWith(compilerArgv, outDir) {
    mkdirSync(outDir, { recursive: true });
    const [file, ...pre] = compilerArgv;
    run(file, [...pre, "compile", SRC, "--emit-c", "--output", outDir], {
        shell: process.platform === "win32" && file === "npx",
    });
    return {
        h: readFileSync(join(outDir, "tc1.h")),
        c: readFileSync(join(outDir, "tc1.c")),
    };
}

function eq(a, b) { return a.h.equals(b.h) && a.c.equals(b.c); }

// ── gen0: tc0 ────────────────────────────────────────────────────
console.log("gen0: tc0 (TypeScript) → C_a → tc1.exe");
const dir0 = join(ROOT, "build", "bootstrap", "gen0");
const Ca = emitWith(["npx", "tsx", "tc0/index.ts"], dir0);
const tc1exe = compileC(dir0, "tc1.exe");

// ── gen1: tc1.exe ────────────────────────────────────────────────
console.log("gen1: tc1.exe → C_b → tc2.exe");
const dir1 = join(ROOT, "build", "bootstrap", "gen1");
const Cb = emitWith([tc1exe], dir1);
const tc2exe = compileC(dir1, "tc2.exe");

// ── gen2: tc2.exe ────────────────────────────────────────────────
console.log("gen2: tc2.exe → C_c → tc3.exe");
const dir2 = join(ROOT, "build", "bootstrap", "gen2");
const Cc = emitWith([tc2exe], dir2);
compileC(dir2, "tc3.exe");

// ── 判定 ─────────────────────────────────────────────────────────
console.log("");
const ab = eq(Ca, Cb), bc = eq(Cb, Cc);
console.log(`C_a ≡ C_b : ${ab ? "OK" : "DIFF"}`);
console.log(`C_b ≡ C_c : ${bc ? "OK" : "DIFF"}`);
if (ab && bc) {
    console.log("\nBOOTSTRAP FIXPOINT REACHED — tc0/tc1/tc2 产出逐字节一致 (Stage 2 达成)");
    process.exit(0);
}
console.log("\nbootstrap: fixpoint NOT reached");
process.exit(1);
