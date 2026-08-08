#!/usr/bin/env node
// ir_snapshot.mjs — 编译产物快照比对（LLVM IR + C 后端）
//
// 目的：为"改语法/改 parser"这类**不应改变任何语义**的改动提供确定性判据。
//
//   若新编译器对全部快照目标发射的产物与基线逐字节相同，
//   则两个后端的 clang 输入均相同 → 机器码相同 → 运行结果必然相同。
//   这是确定性推论而非概率判断，因此可**合法跳过**全部运行类门禁
//   （run_examples 双后端双模式、difftest 代际对拍）。
//
//   ⚠ 必须两个后端都快照，推论才成立：只比 .ll 的话，C 后端发射器的
//     改动会完全逃逸检测，而 run_examples 是双后端验证的。
//
// 覆盖边界（这些**不**在快照内，不可因快照全绿而跳过）：
//   * conformance 的 fail 用例 —— 诊断消息不进入发射产物；
//   * runtime (runtime/t_runtime.c) 的改动；
//   * clang 自身版本变化。
//
// 反之，一旦出现 DIFF，必须人工确认该差异是否为改动的预期效果；
// 确认无误后用 --update 重录基线。
//
// 用法:
//   node tools/ir_snapshot.mjs                 # 与基线比对（默认）
//   node tools/ir_snapshot.mjs --update        # 重录基线
//   node tools/ir_snapshot.mjs --compiler out/rls/tc.exe   # 换编译器比对
//   node tools/ir_snapshot.mjs --backends ll   # 只比 LLVM（更快，推论较弱）
//   node tools/ir_snapshot.mjs --keep          # 保留发射产物便于 diff
//
// 基线文件: tests/ir_baseline.json（应随语义变更一同提交）

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
const BASELINE = join(ROOT, "tests", "ir_baseline.json");

// ── 参数 ─────────────────────────────────────────────────────────
let compiler = join(ROOT, "out", "dbg", "tc.exe");
let update = false;
let keep = false;
let backends = ["ll", "c"];
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--compiler") compiler = resolve(ROOT, argv[++i]);
    else if (argv[i] === "--update") update = true;
    else if (argv[i] === "--keep") keep = true;
    else if (argv[i] === "--backends") backends = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else {
        // 未知参数硬失败：静默忽略会让笔误退回默认编译器，快照对比失去意义。
        console.error(`ir_snapshot: 未知参数 ${argv[i]}；可用：--compiler --update --keep --backends --jobs`);
        process.exit(2);
    }
}
if (!existsSync(compiler)) {
    console.error(`ir_snapshot: compiler not found: ${compiler}`);
    process.exit(2);
}

// ── 工作目录：每轮独占，绝不复用 ─────────────────────────────────
// 教训：固定目录 out/dbg/irsnap 会逼着每轮先「清理上一轮残留」，而 Windows 上刚写出的
// .ll/.c 常被杀软/索引器持有若干分钟 —— rmSync 在 EPERM 上反复重试，实测把「30s 的发射」
// 变成「10 分钟不返回」的假死，连 renameSync 都会因目录内有打开的文件而失败。
// 解法是根除依赖：本轮用 irsnap.<pid>，不存在残留，也就不需要在关键路径上清理。
const WORK_REL = join("out", "dbg", `irsnap.${process.pid}`);
const WORK = join(ROOT, WORK_REL);

// 分离式后台删除：unref 后本进程可立即退出，不受删除快慢影响。
function reapDetached(dir) {
    try {
        const child = process.platform === "win32"
            ? spawn("cmd", ["/c", "rd", "/s", "/q", dir], { detached: true, stdio: "ignore", windowsHide: true })
            : spawn("rm", ["-rf", dir], { detached: true, stdio: "ignore" });
        child.unref();
    } catch { /* 删不掉就留着，下次运行再扫 */ }
}

// 回收本轮目录：同样不等待。
function discardWork() {
    if (existsSync(WORK)) reapDetached(WORK);
}

// 启动时尽力扫掉历史遗留的 irsnap* 目录（含旧版固定目录），全部分离式，不阻塞本轮。
{
    const parent = join(ROOT, "out", "dbg");
    const self = `irsnap.${process.pid}`;
    if (existsSync(parent)) {
        for (const e of readdirSync(parent)) {
            if (e === self) continue;
            if (e === "irsnap" || e.startsWith("irsnap.")) reapDetached(join(parent, e));
        }
    }
}

mkdirSync(WORK, { recursive: true });

// ── 快照目标：全部示例 + 编译器自身 + 包管理器 ───────────────────
const targets = [];
for (const f of readdirSync(join(ROOT, "examples")).sort()) {
    if (f.endsWith(".tc")) targets.push(`examples/${f}`);
}
for (const s of ["src/tc.tc", "src/tote.tc"]) {
    if (existsSync(join(ROOT, s))) targets.push(s);
}

function md5File(p) {
    return createHash("md5").update(readFileSync(p)).digest("hex");
}

// 每个 (目标, 后端) 产出一个快照条目，key 形如 "examples/foo.tc::ll"
async function emitOne(rel) {
    // 输出名唯一化，保证并行时互不覆盖
    const tag = rel.replace(/[\\/]/g, "__").replace(/\.tc$/, "");
    const base = basename(rel, ".tc");
    const out = {};

    if (backends.includes("ll")) {
        const outBase = join(WORK_REL, tag);
        try {
            await pExecFile(compiler, ["emit-ll", rel, "--output", outBase], {
                cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
            });
        } catch (e) {
            return { rel, entries: null, error: `emit-ll failed (exit ${e.code ?? -1})` };
        }
        const ll = join(ROOT, `${outBase}.ll`);
        if (!existsSync(ll)) return { rel, entries: null, error: "no .ll produced" };
        out[`${rel}::ll`] = md5File(ll);
    }

    if (backends.includes("c")) {
        // emit-c 的 --output 是**目录**；每个目标独立子目录，避免 basename 撞名
        const outDir = join(WORK_REL, `c__${tag}`);
        mkdirSync(join(ROOT, outDir), { recursive: true });
        try {
            await pExecFile(compiler, ["compile", rel, "--emit-c", "--output", outDir], {
                cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
            });
        } catch (e) {
            return { rel, entries: null, error: `emit-c failed (exit ${e.code ?? -1})` };
        }
        for (const ext of [".c", ".h"]) {
            const f = join(ROOT, outDir, base + ext);
            if (!existsSync(f)) return { rel, entries: null, error: `no ${base}${ext} produced` };
            out[`${rel}::${ext.slice(1)}`] = md5File(f);
        }
    }

    return { rel, entries: out, error: null };
}

async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = [];
    for (let w = 0; w < Math.min(limit, items.length); w++) {
        runners.push((async () => {
            for (;;) {
                const i = next++;
                if (i >= items.length) break;
                results[i] = await worker(items[i]);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}

const t0 = Date.now();
const results = await runPool(targets, jobs, emitOne);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const errors = results.filter((r) => r.error);
if (errors.length > 0) {
    for (const e of errors) console.log(`  ERROR  ${e.rel}  — ${e.error}`);
    console.log(`\nir_snapshot: ${errors.length} target(s) failed to emit`);
    if (!keep) discardWork();
    process.exit(1);
}

const current = {};
for (const r of results) Object.assign(current, r.entries);
const curKeys = Object.keys(current).sort();

// ── 更新基线 ─────────────────────────────────────────────────────
if (update) {
    const sorted = {};
    for (const k of curKeys) sorted[k] = current[k];
    const payload = {
        _meta: {
            note: "编译产物逐目标 md5 基线（key = <源文件>::<ll|c|h>）。"
                + "全同 ⇒ 两后端 clang 输入不变 ⇒ 语义零影响，可跳过运行类门禁。",
            updated: new Date().toISOString().slice(0, 19).replace("T", " "),
            backends: backends.join(","),
            targets: targets.length,
            entries: curKeys.length,
        },
        ...sorted,
    };
    mkdirSync(join(ROOT, "tests"), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(
        `ir_snapshot: baseline updated — ${targets.length} targets / ` +
        `${curKeys.length} entries [${backends.join(",")}] (${elapsed}s)`
    );
    console.log(`  → tests/ir_baseline.json`);
    if (!keep) discardWork();
    process.exit(0);
}

// ── 比对基线 ─────────────────────────────────────────────────────
if (!existsSync(BASELINE)) {
    console.error("ir_snapshot: 基线不存在，先运行 `node tools/ir_snapshot.mjs --update`");
    if (!keep) discardWork();
    process.exit(2);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const baseKeys = Object.keys(base).filter((k) => k !== "_meta");

const diffs = [];
const added = [];
for (const k of curKeys) {
    if (!(k in base)) added.push(k);
    else if (base[k] !== current[k]) diffs.push({ k, was: base[k], now: current[k] });
}
// 只报告本次实际发射过的后端的缺失项，避免 --backends ll 时误报所有 ::c/::h
const activeSuffix = new Set(backends.includes("c") ? ["ll", "c", "h"] : backends);
const removed = baseKeys.filter((k) => {
    const suf = k.split("::")[1];
    return activeSuffix.has(suf) && !(k in current);
});

console.log(
    `ir_snapshot: compiler=${compiler.replace(ROOT + "\\", "")} ` +
    `targets=${targets.length} entries=${curKeys.length} ` +
    `backends=${backends.join(",")} jobs=${jobs} (${elapsed}s)\n`
);

for (const d of diffs) {
    console.log(`  DIFF   ${d.k}`);
    console.log(`           was ${d.was}`);
    console.log(`           now ${d.now}`);
}
for (const a of added) console.log(`  NEW    ${a}  ${current[a]}  （基线中不存在）`);
for (const r of removed) console.log(`  GONE   ${r}  （基线有但本次未产出）`);

const bad = diffs.length + added.length + removed.length;
console.log("");
if (bad === 0) {
    console.log(`ir_snapshot: OK — ${curKeys.length} 份产物与基线逐字节相同（${backends.join(" + ")} 后端）`);
    console.log("  ⇒ 两后端 clang 输入不变，可跳过 run_examples / difftest 等运行类门禁");
    console.log("  ⚠ 不覆盖：conformance 诊断、runtime 改动、clang 版本变化");
} else {
    console.log(`ir_snapshot: ${diffs.length} 处差异, ${added.length} 个新增, ${removed.length} 个缺失`);
    console.log("  ⇒ 必须确认差异符合预期；确认后 `--update` 重录基线");
    if (keep) console.log(`  发射产物保留在 ${WORK_REL}/ 便于 diff`);
    else console.log("  加 --keep 可保留产物用于逐行 diff");
}
if (!keep) discardWork();
process.exit(bad === 0 ? 0 : 1);
