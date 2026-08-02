#!/usr/bin/env node
// run_examples.mjs — examples 运行时语义验证
//
// 对每个存在 examples/<name>.expected.txt 的示例：
//   ① LLVM 后端：tc build --mode <mode> → out/<mode>/<name>.exe → 实跑，比对 expected
//   ② C   后端：tc compile --emit-c → clang 编译 → 实跑，比对 expected
//   ③ 交叉验证：两个后端的运行输出必须逐字节一致
//
// 并行安全性说明：每个用例的产物是 out/<mode>/<name>.exe 与
// out/<mode>/cback/<name>.{c,h,exe}，文件名由用例名唯一确定，互不覆盖；
// runtime 静态库 out/<mode>/deps/t_runtime.lib 由 tools/build_runtime.mjs
// 预编译，本工具只读不写。故用例之间可安全并行。
// （笔记中"门禁必须串行"约束针对的是**不同工具之间**争抢 out/ 产物，
//   不适用于同一工具内部的用例并行。）
//
// 用法:
//   node tools/run_examples.mjs                      # 缺省 out/dbg/tc.exe, --mode dbg
//   node tools/run_examples.mjs --compiler out/rls/tc.exe --mode rls
//   node tools/run_examples.mjs --only maps,println_demo
//   node tools/run_examples.mjs --jobs 1             # 强制串行（排查用）

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus } from "node:os";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const EX = join(ROOT, "examples");
const RUNTIME = join(ROOT, "runtime");

// ── 参数 ─────────────────────────────────────────────────────────
let mode = "dbg";
let compiler = null;
let only = null;
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") mode = argv[++i];
    else if (argv[i] === "--compiler") compiler = argv[++i];
    else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else {
        // 未知参数硬失败：静默忽略会让笔误退回默认编译器/模式，制造假绿。
        console.error(`run_examples: 未知参数 ${argv[i]}；可用：--mode --compiler --only --jobs`);
        process.exit(2);
    }
}
if (mode !== "dbg" && mode !== "rls") {
    console.error(`run_examples: invalid --mode '${mode}' (expected dbg|rls)`);
    process.exit(2);
}
if (!compiler) compiler = join(ROOT, "out", mode === "rls" ? "rls" : "dbg", "tc.exe");
compiler = resolve(ROOT, compiler);
if (!existsSync(compiler)) {
    console.error(`run_examples: compiler not found: ${compiler}`);
    process.exit(2);
}

// ── clang 探测 ───────────────────────────────────────────────────
function findClang() {
    const cands = [
        "C:\\Program Files\\LLVM\\bin\\clang.exe",
        "C:\\Program Files (x86)\\LLVM\\bin\\clang.exe",
    ];
    for (const c of cands) if (existsSync(c)) return c;
    return "clang";
}
const CLANG = findClang();
const COPT = mode === "rls" ? "-O2" : "-O0";

const OUTDIR = join(ROOT, "out", mode);
const CBACK = join(OUTDIR, "cback");
mkdirSync(CBACK, { recursive: true });

async function sh(cmd, args, opts = {}) {
    try {
        const { stdout } = await pExecFile(cmd, args, {
            cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
            windowsHide: true, ...opts,
        });
        return { ok: true, out: stdout, err: Buffer.alloc(0), code: 0 };
    } catch (e) {
        return {
            ok: false,
            out: e.stdout ?? Buffer.alloc(0),
            err: e.stderr ?? Buffer.alloc(0),
            code: typeof e.code === "number" ? e.code : -1,
        };
    }
}

// 归一化换行，避免 CRLF/LF 差异误判
function norm(buf) {
    return buf.toString("utf8").replace(/\r\n/g, "\n");
}

function tailErr(buf) {
    return norm(buf ?? Buffer.alloc(0)).trim().split("\n").slice(-2).join(" | ");
}

// ── 并发池：保持 items 顺序返回结果 ───────────────────────────────
async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const width = Math.min(limit, items.length);
    const runners = [];
    for (let w = 0; w < width; w++) {
        runners.push((async () => {
            for (;;) {
                const i = next++;
                if (i >= items.length) break;
                results[i] = await worker(items[i], i);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}

// ── 收集用例 ─────────────────────────────────────────────────────
let names = readdirSync(EX)
    .filter((f) => f.endsWith(".expected.txt"))
    .map((f) => f.slice(0, -".expected.txt".length))
    .filter((n) => existsSync(join(EX, `${n}.tc`)))
    .sort();
if (only) names = names.filter((n) => only.includes(n));

if (names.length === 0) {
    console.error("run_examples: no examples with .expected.txt found");
    process.exit(2);
}
jobs = Math.min(jobs, names.length);

console.log(
    `run_examples: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} ` +
    `cases=${names.length} jobs=${jobs}\n`
);

// ── 单个用例 ─────────────────────────────────────────────────────
async function runCase(name) {
    const src = join("examples", `${name}.tc`);
    const expected = norm(readFileSync(join(EX, `${name}.expected.txt`)));
    const problems = [];
    let llOut = null;
    let cOut = null;

    // ① LLVM 后端
    const b = await sh(compiler, ["build", src, "--mode", mode]);
    if (!b.ok) {
        problems.push(`llvm build failed (exit ${b.code}): ${tailErr(b.err)}`);
    } else {
        const exe = join(OUTDIR, `${name}.exe`);
        if (!existsSync(exe)) problems.push(`llvm exe missing: out/${mode}/${name}.exe`);
        else {
            const r = await sh(exe, []);
            llOut = norm(r.out);
            if (llOut !== expected) problems.push("llvm output != expected");
        }
    }

    // ② C 后端
    const c = await sh(compiler, ["compile", src, "--emit-c", "--output", join("out", mode, "cback")]);
    if (!c.ok) {
        problems.push(`c emit failed (exit ${c.code})`);
    } else {
        const cexe = join(CBACK, `${name}.exe`);
        const cc = await sh(CLANG, [
            COPT, "-o", cexe,
            join(CBACK, `${name}.c`), join(RUNTIME, "t_runtime.c"),
            "-I", RUNTIME, "-I", CBACK, "-Wl,-subsystem:console",
        ]);
        if (!cc.ok) {
            problems.push(`c link failed (exit ${cc.code}): ${tailErr(cc.err)}`);
        } else {
            const r = await sh(cexe, []);
            cOut = norm(r.out);
            if (cOut !== expected) problems.push("c output != expected");
        }
    }

    // ③ 双后端交叉验证
    if (llOut !== null && cOut !== null && llOut !== cOut) problems.push("llvm output != c output");

    return { name, problems, llOut, cOut, expected };
}

// ── 调度 ─────────────────────────────────────────────────────────
let done = 0;
const results = await runPool(names, jobs, async (name) => {
    const r = await runCase(name);
    done++;
    const tag = r.problems.length === 0 ? "PASS" : "FAIL";
    const suffix = r.problems.length === 0 ? "" : `  — ${r.problems.join("; ")}`;
    console.log(`  [${String(done).padStart(2)}/${names.length}] ${tag}  ${r.name}${suffix}`);
    return r;
});

const failures = results.filter((r) => r.problems.length > 0);
const pass = results.length - failures.length;

console.log("");
if (failures.length > 0) {
    for (const f of failures) {
        console.log(`── ${f.name} ─────────────────────────────`);
        console.log(`expected:\n${JSON.stringify(f.expected)}`);
        if (f.llOut !== null) console.log(`llvm    :\n${JSON.stringify(f.llOut)}`);
        if (f.cOut !== null) console.log(`c       :\n${JSON.stringify(f.cOut)}`);
    }
    console.log("");
}
console.log(`run_examples: ${pass} passed, ${failures.length} failed (of ${names.length})`);
process.exit(failures.length === 0 ? 0 : 1);
