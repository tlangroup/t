#!/usr/bin/env node
// tir_snapshot.mjs — TIR 发射产物快照比对（emit-tir 产出的 .tir 文本 md5）
//
// 目的：为「TIR 降级 pass / tir.tc」这类**不应改变任何已有语义**的改动提供确定性判据。
//
//   TIR 是后端无关中间表示（compiler-pipeline-design.md Stage 0+1）。emit-tir 对一批
//   快照目标发射 .tir 文本，md5 逐字节比对即可判定 TIR 发射器是否发生漂移：
//     * 若全绿 → TIR 发射与基线一致（降级 pass 未引入非预期变化）；
//     * 若出现 DIFF → 必须人工确认该差异是否为本次改动的预期效果，
//       确认无误后用 --update 重录基线。
//
//   注意：本工具只覆盖「emit-tir 产物」。它与 ir_snapshot（LLVM IR + C）正交：
//     - ir_snapshot 守卫两个真实后端的机器码等价性；
//     - tir_snapshot 守卫新 TIR 桥的发射稳定性。
//   两者都绿，才说明一次改动既没动后端、也没动 TIR 桥。
//
//   覆盖边界（不进快照，不可因快照全绿而跳过）：
//     * conformance 的 fail 用例 —— 诊断消息不进入发射产物；
//     * 仅比对文本 md5，不在本工具内执行 TIR（TIR 尚无独立执行器）。
//
// 用法:
//   node tools/tir_snapshot.mjs                 # 与基线比对（默认）
//   node tools/tir_snapshot.mjs --update        # 重录基线
//   node tools/tir_snapshot.mjs --compiler out/dbg/tc.exe   # 换编译器比对
//   node tools/tir_snapshot.mjs --keep          # 保留发射产物便于 diff
//   node tools/tir_snapshot.mjs --jobs 4        # 并行度
//
// 基线文件: tests/tir_baseline.json（应随 TIR 发射器变更一同提交）

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
    readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { cpus } from "node:os";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const BASELINE = join(ROOT, "tests", "tir_baseline.json");

// ── 参数 ─────────────────────────────────────────────────────────
let compiler = join(ROOT, "out", "dbg", "tc.exe");
let update = false;
let keep = false;
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--compiler") compiler = resolve(ROOT, argv[++i]);
    else if (argv[i] === "--update") update = true;
    else if (argv[i] === "--keep") keep = true;
    else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else {
        console.error(`tir_snapshot: 未知参数 ${argv[i]}；可用：--compiler --update --keep --jobs`);
        process.exit(2);
    }
}
if (!existsSync(compiler)) {
    console.error(`tir_snapshot: compiler not found: ${compiler}`);
    process.exit(2);
}

// ── 工作目录：每轮独占，绝不复用（与 ir_snapshot 同套教训，规避 Windows 文件锁）──
const WORK_REL = join("out", "dbg", `tirsnap.${process.pid}`);
const WORK = join(ROOT, WORK_REL);

function reapDetached(dir) {
    try {
        const child = process.platform === "win32"
            ? spawn("cmd", ["/c", "rd", "/s", "/q", dir], { detached: true, stdio: "ignore", windowsHide: true })
            : spawn("rm", ["-rf", dir], { detached: true, stdio: "ignore" });
        child.unref();
    } catch { /* 删不掉就留着，下次运行再扫 */ }
}
function discardWork() {
    if (existsSync(WORK)) reapDetached(WORK);
}
{
    const parent = join(ROOT, "out", "dbg");
    const self = `tirsnap.${process.pid}`;
    if (existsSync(parent)) {
        for (const e of readdirSync(parent)) {
            if (e === self) continue;
            if (e === "tirsnap" || e.startsWith("tirsnap.")) reapDetached(join(parent, e));
        }
    }
}
mkdirSync(WORK, { recursive: true });

// ── 快照目标：全部示例 + 编译器自身 + 包管理器（与 ir_snapshot 对齐）──
const targets = [];
for (const f of readdirSync(join(ROOT, "examples")).sort()) {
    if (f.endsWith(".tc")) targets.push(`examples/${f}`);
}
for (const s of ["src/tc.tc"]) {
    if (existsSync(join(ROOT, s))) targets.push(s);
}

function md5File(p) {
    return createHash("md5").update(readFileSync(p)).digest("hex");
}

// 每个目标产出一个 .tir 快照条目，key 形如 "examples/foo.tc::tir"
async function emitOne(rel) {
    const tag = rel.replace(/[\\/]/g, "__").replace(/\.tc$/, "");
    const outBase = join(WORK_REL, tag);
    try {
        await pExecFile(compiler, ["emit-tir", rel, "--output", outBase], {
            cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
        });
    } catch (e) {
        return { rel, md5: null, error: `emit-tir failed (exit ${e.code ?? -1})` };
    }
    const tir = join(ROOT, `${outBase}.tir`);
    if (!existsSync(tir)) return { rel, md5: null, error: "no .tir produced" };
    return { rel, md5: md5File(tir), error: null };
}

// ── 并行发射 ─────────────────────────────────────────────────────
async function runPool(items, n, fn) {
    const out = [];
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx]);
        }
    }
    const ws = [];
    for (let k = 0; k < n; k++) ws.push(worker());
    await Promise.all(ws);
    return out;
}

const results = await runPool(targets, jobs, emitOne);

// ── 汇总与比对 ───────────────────────────────────────────────────
const current = {};
let failed = 0;
let skipped = 0;
for (const r of results) {
    if (r.error) {
        console.error(`  GONE/ERR ${r.rel}: ${r.error}`);
        failed++;
        continue;
    }
    current[`${r.rel}::tir`] = r.md5;
}

let baseline = {};
if (existsSync(BASELINE)) {
    try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch { baseline = {}; }
}

if (update) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    console.log(`tir_snapshot: recorded ${Object.keys(current).length} entries → ${baselinePath(BASELINE)}`);
    discardWork();
    process.exit(0);
}

const keys = Object.keys(current);
let diffs = 0;
for (const k of keys) {
    if (baseline[k] === undefined) {
        console.error(`  NEW  ${k}`);
        diffs++;
    } else if (baseline[k] !== current[k]) {
        console.error(`  DIFF ${k}  (baseline ${baseline[k].slice(0, 8)} → now ${current[k].slice(0, 8)})`);
        diffs++;
    }
}
// 基线里有、当前没有的 key（目标被移除）
for (const k of Object.keys(baseline)) {
    if (current[k] === undefined) {
        console.error(`  MISS ${k} (present in baseline, absent now)`);
        diffs++;
    }
}

function baselinePath(p) { return p; }

if (!existsSync(BASELINE)) {
    console.error("tir_snapshot: no baseline found; run with --update to record one.");
    discardWork();
    process.exit(2);
}

if (diffs > 0) {
    console.error(`tir_snapshot: ${diffs} drift(s) detected across ${keys.length} targets.`);
    if (!keep) discardWork(); else console.error(`  (kept work dir ${WORK_REL} for diff)`);
    process.exit(1);
}
console.log(`tir_snapshot: OK — ${keys.length} targets match baseline (0 drift).`);
if (!keep) discardWork();
process.exit(0);
