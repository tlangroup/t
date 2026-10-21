#!/usr/bin/env node
// run_examples_tmir.mjs — tmir-c 后端 (codegen_c_tmir.tc, --backend tmir-c)
// 与 LLVM 后端 (tc run 默认, --backend tir) 的运行时语义对拍。
//
// 对每个用例（缺省=有 examples/<name>.expected.txt 的 golden 示例）：
//   ① LLVM 后端：tc run <src>               → 程序 stdout
//   ② tmir-c 后端：tc run --backend tmir-c <src> → 程序 stdout
//   判据：
//     a) LLVM 输出 == expected（golden）
//     b) tmir-c 输出 == expected（golden）
//     c) LLVM 输出 == tmir-c 输出（跨后端逐字节一致）
//   --all 时补跑「有 @main 但无 expected」的可运行示例（smoke：仅判据 c）。
//
// 与 run_examples.mjs 的区别：后者比对 LLVM vs 旧 C (--emit-c / codegen_c.tc)；
// 本工具比对 LLVM vs 新 tmir-c 后端（字节缓冲聚合模型），是 P1 variant/string
// 支持验收的主门禁。
//
// 并行安全：每个用例产物是 out/<mode>/<name>.{exe,ll,c}，由用例名唯一确定，
// 互不覆盖（与 run_examples.mjs 同理）。tc run 串行重建同一 <name>.exe 不影响
// 判据——每次运行后立即捕获 stdout。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus } from "node:os";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const EX = join(ROOT, "examples");
const RUNTIME = join(ROOT, "runtime");

{
    const s = ensureMsvcEnv();
    if (s) console.error(`[env] ${s}`);
}

let mode = "dbg";
let compiler = null;
let only = null;
let all = false;
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") mode = argv[++i];
    else if (argv[i] === "--compiler") compiler = argv[++i];
    else if (argv[i] === "--all") all = true;
    else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else { console.error(`run_examples_tmir: 未知参数 ${argv[i]}`); process.exit(2); }
}
if (mode !== "dbg" && mode !== "rls") { console.error(`run_examples_tmir: invalid --mode '${mode}'`); process.exit(2); }
if (!compiler) compiler = join(ROOT, "out", mode === "rls" ? "rls" : "dbg", "tc.exe");
compiler = resolve(ROOT, compiler);
if (!existsSync(compiler)) { console.error(`run_examples_tmir: compiler not found: ${compiler}`); process.exit(2); }

const OUTDIR = join(ROOT, "out", mode);
mkdirSync(OUTDIR, { recursive: true });

const RUN_TIMEOUT_MS = 120 * 1000;
const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;

// 退出码不是失败判据：示例常 return 非零演示值。仅异常终止算失败。
function abnormalExit(code, killed) {
    if (killed) return true;
    return typeof code === "number" && code >= 0xc0000000;
}

async function sh(cmd, args, opts = {}) {
    try {
        const { stdout } = await pExecFile(cmd, args, {
            cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
            windowsHide: true, ...opts,
        });
        return { ok: true, out: stdout, err: Buffer.alloc(0), code: 0, killed: false };
    } catch (e) {
        const killed = e.killed === true || e.signal === "SIGTERM";
        return {
            ok: false,
            out: e.stdout ?? Buffer.alloc(0),
            err: killed
                ? Buffer.from(`超时被杀（>${(opts.timeout ?? 0) / 1000}s）`)
                : (e.stderr ?? Buffer.alloc(0)),
            code: typeof e.code === "number" ? e.code : -1,
            killed,
        };
    }
}

function norm(buf) { return buf.toString("utf8").replace(/\r\n/g, "\n"); }
function tailErr(buf) { return norm(buf ?? Buffer.alloc(0)).trim().split("\n").slice(-2).join(" | "); }

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

const KNOWN_FAILING = new Set();

const SMOKE_SKIP = new Map([
    ["time_fmt_local", "输出含本地时间戳，非确定"],
    ["agent_npc_mind_llm", "交互式：阻塞读 stdin，无人值守环境不可跑"],
    ["_cpuemu_check", "KI-006：device 运行时问题，双后端待齐"],
    ["vecadd_device_full", "KI-006：device 运行时问题，双后端待齐"],
]);

function hasMain(name) {
    try { return /@main/.test(readFileSync(join(EX, `${name}.tc`), "utf8")); }
    catch { return false; }
}
function hasGolden(name) { return existsSync(join(EX, `${name}.expected.txt`)); }

let names = readdirSync(EX)
    .filter((f) => f.endsWith(".expected.txt"))
    .map((f) => f.slice(0, -".expected.txt".length))
    .filter((n) => existsSync(join(EX, `${n}.tc`)))
    .filter((n) => !KNOWN_FAILING.has(n))
    .sort();

let smokeCount = 0;
if (all) {
    const extra = readdirSync(EX)
        .filter((f) => f.endsWith(".tc"))
        .map((f) => f.slice(0, -".tc".length))
        .filter((n) => !hasGolden(n))
        .filter((n) => hasMain(n))
        .filter((n) => !SMOKE_SKIP.has(n))
        .sort();
    smokeCount = extra.length;
    names = names.concat(extra);
}
if (only) names = names.filter((n) => only.includes(n));

if (names.length === 0) { console.error("run_examples_tmir: no examples found"); process.exit(2); }
jobs = Math.min(jobs, names.length);

console.log(
    `run_examples_tmir: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} ` +
    `cases=${names.length} jobs=${jobs}` +
    (smokeCount > 0 ? ` (golden ${names.length - smokeCount} + smoke ${smokeCount})` : "") +
    "\n"
);

async function runCase(name) {
    const src = join("examples", `${name}.tc`);
    const golden = hasGolden(name);
    const expected = golden ? norm(readFileSync(join(EX, `${name}.expected.txt`))) : null;
    const problems = [];
    let llOut = null;
    let cOut = null;

    // ① LLVM 后端 (tc run 默认走 tir/LLVM)
    // 退出码不是失败判据：示例常 return 非零演示值；仅异常终止（崩溃）算失败。
    const a = await sh(compiler, ["run", src], { timeout: COMPILE_TIMEOUT_MS + RUN_TIMEOUT_MS });
    if (abnormalExit(a.code, a.killed)) {
        problems.push(`llvm crashed (exit ${a.code}): ${tailErr(a.err)}`);
    } else {
        llOut = norm(a.out);
        if (golden && llOut !== expected) problems.push("llvm output != expected");
    }

    // ② tmir-c 后端 (--backend tmir-c)
    const b = await sh(compiler, ["run", "--backend", "tmir-c", src], { timeout: COMPILE_TIMEOUT_MS + RUN_TIMEOUT_MS });
    if (abnormalExit(b.code, b.killed)) {
        problems.push(`tmir-c crashed (exit ${b.code}): ${tailErr(b.err)}`);
    } else {
        cOut = norm(b.out);
        if (golden && cOut !== expected) problems.push("tmir-c output != expected");
    }

    // ③ 跨后端逐字节一致
    if (llOut !== null && cOut !== null && llOut !== cOut) problems.push("llvm output != tmir-c output");

    return { name, problems, llOut, cOut, expected, golden };
}

let done = 0;
const results = await runPool(names, jobs, async (name) => {
    const r = await runCase(name);
    done++;
    const tag = r.problems.length === 0 ? "PASS" : "FAIL";
    const kind = r.golden ? "" : " [smoke]";
    const suffix = r.problems.length === 0 ? kind : `${kind}  — ${r.problems.join("; ")}`;
    console.log(`  [${String(done).padStart(2)}/${names.length}] ${tag}  ${r.name}${suffix}`);
    return r;
});

const failures = results.filter((r) => r.problems.length > 0);
const pass = results.length - failures.length;

console.log("");
if (failures.length > 0) {
    for (const f of failures) {
        console.log(`── ${f.name} ─────────────────────────────`);
        console.log(f.golden ? `expected:\n${JSON.stringify(f.expected)}` : "(smoke：无 expected)");
        if (f.llOut !== null) console.log(`llvm    :\n${JSON.stringify(f.llOut)}`);
        if (f.cOut !== null) console.log(`tmir-c  :\n${JSON.stringify(f.cOut)}`);
    }
    console.log("");
}
console.log(`run_examples_tmir: ${pass} passed, ${failures.length} failed (of ${names.length}` +
    (smokeCount > 0 ? `，其中 smoke ${smokeCount} 个` : "") + ")");
process.exit(failures.length === 0 ? 0 : 1);
