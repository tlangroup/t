#!/usr/bin/env node
// run_examples.mjs — examples 运行时语义验证
//
// 对每个存在 examples/<name>.expected.txt 的示例：
//   ① LLVM 后端：tc build --mode <mode> → out/<mode>/<name>.exe → 实跑，比对 expected
//   ② C   后端：tc compile --emit-c → clang 编译 → 实跑，比对 expected
//   ③ 交叉验证：两个后端的运行输出必须逐字节一致
//
// 用法:
//   node tools/run_examples.mjs                      # 缺省 out/dbg/tc.exe, --mode dbg
//   node tools/run_examples.mjs --compiler out/rls/tc.exe --mode rls
//   node tools/run_examples.mjs --only maps,println_demo

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const EX = join(ROOT, "examples");
const RUNTIME = join(ROOT, "runtime");

// ── 参数 ─────────────────────────────────────────────────────────
let mode = "dbg";
let compiler = null;
let only = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") mode = argv[++i];
    else if (argv[i] === "--compiler") compiler = argv[++i];
    else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
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

function sh(cmd, args, opts = {}) {
    try {
        const out = execFileSync(cmd, args, { cwd: ROOT, encoding: "buffer", stdio: ["pipe", "pipe", "pipe"], ...opts });
        return { ok: true, out, code: 0 };
    } catch (e) {
        return { ok: false, out: e.stdout ?? Buffer.alloc(0), err: e.stderr ?? Buffer.alloc(0), code: e.status ?? -1 };
    }
}

// 归一化换行，避免 CRLF/LF 差异误判
function norm(buf) {
    return buf.toString("utf8").replace(/\r\n/g, "\n");
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

console.log(`run_examples: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} cases=${names.length}\n`);

let pass = 0;
const failures = [];

for (const name of names) {
    const src = join("examples", `${name}.tc`);
    const expected = norm(readFileSync(join(EX, `${name}.expected.txt`)));
    const problems = [];
    let llOut = null;
    let cOut = null;

    // ① LLVM 后端
    const b = sh(compiler, ["build", src, "--mode", mode]);
    if (!b.ok) {
        problems.push(`llvm build failed (exit ${b.code}): ${norm(b.err ?? Buffer.alloc(0)).trim().split("\n").slice(-2).join(" | ")}`);
    } else {
        const exe = join(OUTDIR, `${name}.exe`);
        if (!existsSync(exe)) problems.push(`llvm exe missing: out/${mode}/${name}.exe`);
        else {
            const r = sh(exe, []);
            llOut = norm(r.out);
            if (llOut !== expected) problems.push("llvm output != expected");
        }
    }

    // ② C 后端
    const c = sh(compiler, ["compile", src, "--emit-c", "--output", join("out", mode, "cback")]);
    if (!c.ok) {
        problems.push(`c emit failed (exit ${c.code})`);
    } else {
        const cexe = join(CBACK, `${name}.exe`);
        const cc = sh(CLANG, [
            COPT, "-o", cexe,
            join(CBACK, `${name}.c`), join(RUNTIME, "t_runtime.c"),
            "-I", RUNTIME, "-I", CBACK, "-Wl,-subsystem:console",
        ]);
        if (!cc.ok) {
            problems.push(`c link failed (exit ${cc.code}): ${norm(cc.err ?? Buffer.alloc(0)).trim().split("\n").slice(-2).join(" | ")}`);
        } else {
            const r = sh(cexe, []);
            cOut = norm(r.out);
            if (cOut !== expected) problems.push("c output != expected");
        }
    }

    // ③ 双后端交叉验证
    if (llOut !== null && cOut !== null && llOut !== cOut) problems.push("llvm output != c output");

    if (problems.length === 0) {
        pass++;
        console.log(`  PASS  ${name}`);
    } else {
        failures.push({ name, problems, llOut, cOut, expected });
        console.log(`  FAIL  ${name}  — ${problems.join("; ")}`);
    }
}

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
