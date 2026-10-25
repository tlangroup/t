#!/usr/bin/env node
// run_examples.mjs — examples 运行时语义验证
//
// 对每个存在 examples/<name>.expected.txt 的示例：
//   ① LLVM 后端：tc build --mode <mode> → out/<mode>/<name>.exe → 实跑，比对 expected
//   ② C   后端：tc compile --emit-c → clang 编译 → 实跑，比对 expected
//   ③ 交叉验证：两个后端的运行输出必须逐字节一致
//
// 并行安全性说明：每个用例的产物是 out/<mode>/<name>.exe 与
// out/<mode>/cback/<name>/{<name>.c,<name>.h,导入模块的*.c/*.h,<name>.exe}，
// 整目录由用例名唯一确定，互不覆盖——导入同模块（如 src.agentkit / src.physics）
// 的多个用例先前共用 out/<mode>/cback 顶层目录，同名 <module>.c/.h 在并行下
// 互相踩踏造成偶发 c emit failed / io write 假失败；现改为每用例独立子目录隔离。
// runtime 静态库 out/<mode>/deps/t_runtime.lib 由 tools/build_runtime.mjs
// 预编译，本工具只读不写。故用例之间可安全并行。
// （笔记中"门禁必须串行"约束针对的是**不同工具之间**争抢 out/ 产物，
//   不适用于同一工具内部的用例并行。）
//
// ⚠ 覆盖范围（重要）：缺省**只跑有 examples/<name>.expected.txt 的示例**（golden 比对）。
//   没有 expected 文件的示例既不做运行验证、也不做双后端对拍 —— 历史上这批示例
//   因此长期零运行时覆盖（本仓库 115 个示例中一度只有 88 个被真正跑过）。
//   加 --all 后补跑这批示例的 **smoke 模式**：无 golden 文件，改为
//   ① 双后端各自构建并运行成功；② 两后端输出逐字节一致（跨后端对拍即判据）。
//
// 用法:
//   node tools/run_examples.mjs                      # 缺省 out/dbg/tc.exe, --mode dbg
//   node tools/run_examples.mjs --compiler out/rls/tc.exe --mode rls
//   node tools/run_examples.mjs --all                # 额外补跑无 expected 的可运行示例
//   node tools/run_examples.mjs --only maps,println_demo
//   node tools/run_examples.mjs --jobs 1             # 强制串行（排查用）

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

// 自动注入 LIB+INCLUDE，使 C 后端 clang 编译能找到系统头/库（详见 tools/msvc_env.mjs）。
{
    const s = ensureMsvcEnv();
    if (s) console.error(`[env] ${s}`);
}

// ── 参数 ─────────────────────────────────────────────────────────
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
    else {
        // 未知参数硬失败：静默忽略会让笔误退回默认编译器/模式，制造假绿。
        console.error(`run_examples: 未知参数 ${argv[i]}；可用：--mode --compiler --all --only --jobs`);
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
const CBACK = join(OUTDIR, "cback"); // 每用例隔离子目录 CBACK/<name>，见 runCase
mkdirSync(CBACK, { recursive: true });

// ⚠ 运行用例必须带超时：示例若读 stdin（read_line 等）而无输入，子进程会永久阻塞，
//   execFile 不设 timeout 就永远不返回 —— 整个门禁（尤其无人值守的每日全量 CI）
//   会被单个示例挂死（2026-09-28 实测挂了 35 分钟毫无进展）。故运行阶段统一
//   传 RUN_TIMEOUT_MS；编译阶段按经验值给更长的 COMPILE_TIMEOUT_MS。
// 120s：CI runner 比本地慢，单次运行留足余量；超时会判失败而非静默挂住。
const RUN_TIMEOUT_MS = 120 * 1000;
const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;

// ⚠ 退出码**不是**失败判据：本项目的示例普遍把 main 写成 `return <演示值>`，
//   非零退出是正常语义（实测 bitstr_demo=1 / tagid_typeinfo=12 / tuple_demo=32 /
//   min_while=1 / xid_ident=60，它们都是 PASS）。只有「异常终止」才算失败：
//   · Windows 状态码 ≥ 0xC0000000（0xC0000005 访问违例 / 0xC000000D 等）
//   · 被信号杀死（killed，含上面的超时）
//   误把非零退出当失败会把 5 个本来全绿的示例打成红（2026-09-28 实测踩过）。
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
        return { ok: true, out: stdout, err: Buffer.alloc(0), code: 0 };
    } catch (e) {
        const killed = e.killed === true || e.signal === "SIGTERM";
        return {
            ok: false,
            out: e.stdout ?? Buffer.alloc(0),
            err: killed
                ? Buffer.from(`超时被杀（>${(opts.timeout ?? 0) / 1000}s）：疑似等待 stdin 或死循环`)
                : (e.stderr ?? Buffer.alloc(0)),
            code: typeof e.code === "number" ? e.code : -1,
            killed,
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
// 已知失败用例名单（与 _diffpipe.mjs / ir_snapshot.mjs 的 KNOWN_FAILING 保持一致）：
// 后端 bug 修好后从名单移除，恢复示例门禁双后端对拍覆盖。
// tile_demo 的 Tile 元素错当成 i64 当 ptr 存的后端 bug 已修复
// （src/tir_to_ll.tc 瓦片 binop 聚合类型探测从 inst.st 回退到 inst.args[0].st），
// 已从名单移除。
const KNOWN_FAILING = new Set();

// ── smoke 模式（--all 补跑）的排除名单 ──────────────────────────
// smoke 判据是「双后端各自跑通 + 输出逐字节一致」，故两类示例不能进：
//   ① 输出天然非确定（时间戳 / 随机 / 地址）：两次运行必然不一致 → 假红。
//   ② 未实现的语言特性：双后端都跑不通 → 天天红，掩盖真实回归。
// 两者都必须带原因登记，修好后从本表移除并恢复覆盖。
// 排除分两类：③不可无人值守运行，④已登记的已知缺陷（KI-00x）。
const SMOKE_SKIP = new Map([
    // ── ③ 不可无人值守运行 ──────────────────────────────────
    // 输出含本地当前时间，两次运行可能跨秒，跨后端对拍会假红。
    ["time_fmt_local", "输出含本地时间戳，非确定"],
    // 交互式示例：打印到 `LLMREQ|hours` 后阻塞读 stdin 等待 LLM 桥应答。
    // CI 无 stdin 必然超时；且被杀后残留进程会锁住 out/dbg/<name>.exe，
    // 让**下一次**构建的 lld-link 报 permission denied（伪装成构建失败）。
    ["agent_npc_mind_llm", "交互式：阻塞读 stdin，无人值守环境不可跑"],

    // ── ④ 已知缺陷（修好后从本表移除、恢复覆盖）────────────
    // device 子系统（LLVM 后端发射 __t_devmod_blob + device.* 调用；cpu-emu
    // 解释器 brace 配对 / 指针参数识别 / atomic_add 解析均已修）：内核已能执行、
    // rc=0、不崩。但示例 host 侧用 [256]f32 定长数组，LLVM 后端对该类堆分配数组
    // 的元素赋值 ha[k]=x 实际不落盘（读回为 mimalloc 残留 0x200），h2d 拷不进真
    // 数据 → 端到端输出对拍失败。此为独立的 LLVM 后端数组 store bug，非 device
    // 子系统范围，单独登记为 KI 待修；修好后从本表移除。
    // KI-006（2026-09-28）已修复 LLVM 后端 f32 堆数组元素 store 不落盘：
    //   现 LLVM 后端两个示例均 rc=0、hc/ho 输出与期望逐字节一致（host 定长数组
    //   元素赋值 + h2d 全链路打通）。但 C 后端 _cpuemu_check 在 reduce_atomic 第二
    //   次 launch 后 segfault（独立 device 运行时问题，非 store bug），vecadd_device_full
    //   C 后端 rc=0。双后端 run_examples 要求两后端都过，故仍留 SMOKE_SKIP，待 C 后端
    //   device 运行时单独修。LLVM 单后端覆盖已由 KI-006 验收保证。
    ["_cpuemu_check", "KI-006：LLVM 后端 f32 堆数组 store 已修(示例 rc=0 输出正确)；C 后端 reduce_atomic 第二 launch 后 segfault（独立 device 运行时问题），双后端待齐"],
    ["vecadd_device_full", "KI-006：LLVM 后端 rc=0 输出正确；C 后端仍待 device 运行时单独修，双后端待齐"],
]);

// 无 @main 的示例是「被别的示例 import 的库模块」：build/run 需要入口，
// 直接跑必然 no entry point；其编译期覆盖由 ir_snapshot（全 117 目标）与
// 导入它的示例间接保证，smoke 不计入。
function hasMain(name) {
    try {
        return /@main/.test(readFileSync(join(EX, `${name}.tc`), "utf8"));
    } catch { return false; }
}

function hasGolden(name) {
    return existsSync(join(EX, `${name}.expected.txt`));
}

let names = readdirSync(EX)
    .filter((f) => f.endsWith(".expected.txt"))
    .map((f) => f.slice(0, -".expected.txt".length))
    .filter((n) => existsSync(join(EX, `${n}.tc`)))
    .filter((n) => !KNOWN_FAILING.has(n))
    .sort();

// --all：补跑「有 @main 但无 golden」的可运行示例（smoke 模式）
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

if (names.length === 0) {
    console.error("run_examples: no examples with .expected.txt found");
    process.exit(2);
}
jobs = Math.min(jobs, names.length);

console.log(
    `run_examples: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} ` +
    `cases=${names.length} jobs=${jobs}` +
    (smokeCount > 0 ? ` (golden ${names.length - smokeCount} + smoke ${smokeCount})` : "") +
    "\n"
);

// ── 单个用例 ─────────────────────────────────────────────────────
async function runCase(name) {
    const src = join("examples", `${name}.tc`);
    // smoke 模式（无 golden 文件）：不做期望比对，判据改为「双后端都跑通 + 输出一致」。
    const golden = hasGolden(name);
    const expected = golden ? norm(readFileSync(join(EX, `${name}.expected.txt`))) : null;
    const problems = [];
    let llOut = null;
    let cOut = null;

    // ① LLVM 后端
    const b = await sh(compiler, ["build", src, "--mode", mode], { timeout: COMPILE_TIMEOUT_MS });
    if (!b.ok) {
        problems.push(`llvm build failed (exit ${b.code}): ${tailErr(b.err)}`);
    } else {
        const exe = join(OUTDIR, `${name}.exe`);
        if (!existsSync(exe)) problems.push(`llvm exe missing: out/${mode}/${name}.exe`);
        else {
            const r = await sh(exe, [], { timeout: RUN_TIMEOUT_MS });
            if (abnormalExit(r.code, r.killed)) {
                problems.push(`llvm run crashed (exit ${r.code}): ${tailErr(r.err)}`);
            }
            llOut = norm(r.out);
            if (golden && llOut !== expected) problems.push("llvm output != expected");
        }
    }

    // ② C 后端 —— 每用例独立子目录，避免并行踩踏导入模块的同名 .c/.h
    const cdir = join(CBACK, name);
    mkdirSync(cdir, { recursive: true });
    // ⚠ 阶段 C 链接模式：`--link-deps` 让编译器把解析到的外部 .tlib 归档逐行打到 stdout。
    //   导入 std.math 等外部库的用例在 C 侧调用是 extern，缺归档 ⇒ lld-link undefined symbol。
    const c = await sh(compiler, ["compile", src, "--emit-c", "--link-deps", "--output", cdir], { timeout: COMPILE_TIMEOUT_MS });
    if (!c.ok) {
        problems.push(`c emit failed (exit ${c.code})`);
    } else {
        const cexe = join(cdir, `${name}.exe`);
        const linkDeps = String(c.out || "")
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && /\.(tlib|tlibd)$/.test(s) && existsSync(s));
        // ⚠ 运行时不再以源码形式参与编译：t_runtime.c 现在依赖 vendored 第三方库
        // （mimalloc / fdlibm / imath / ryu），逐个编进来既不现实也让命令行失控。
        // 统一链接预编译的 out/<mode>/deps/t_runtime.lib（与 LLVM 后端同一份产物），
        // 既保证两后端用**同一份**运行时，也让 C 后端编译快得多。
        const cc = await sh(CLANG, [
            COPT, "-o", cexe,
            join(cdir, `${name}.c`),
            "-I", RUNTIME, "-I", cdir, "-Wl,-subsystem:console",
            join(ROOT, "out", mode, "deps", "t_runtime.lib"),
            ...linkDeps,
        ], { timeout: COMPILE_TIMEOUT_MS });
        if (!cc.ok) {
            problems.push(`c link failed (exit ${cc.code}): ${tailErr(cc.err)}`);
        }         else {
            const r = await sh(cexe, [], { timeout: RUN_TIMEOUT_MS });
            if (abnormalExit(r.code, r.killed)) {
                problems.push(`c run crashed (exit ${r.code}): ${tailErr(r.err)}`);
            }
            cOut = norm(r.out);
            if (golden && cOut !== expected) problems.push("c output != expected");
        }
    }

    // ③ 双后端交叉验证（golden / smoke 两种模式都要求两后端输出逐字节一致；
    //    smoke 模式没有 golden 文件，这一步就是唯一的值判据）
    if (llOut !== null && cOut !== null && llOut !== cOut) problems.push("llvm output != c output");

    return { name, problems, llOut, cOut, expected, golden };
}

// ── 调度 ─────────────────────────────────────────────────────────
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
        console.log(f.golden
            ? `expected:\n${JSON.stringify(f.expected)}`
            : "(smoke 模式：无 expected 文件，判据=双后端跑通且输出一致)");
        if (f.llOut !== null) console.log(`llvm    :\n${JSON.stringify(f.llOut)}`);
        if (f.cOut !== null) console.log(`c       :\n${JSON.stringify(f.cOut)}`);
    }
    console.log("");
}
console.log(`run_examples: ${pass} passed, ${failures.length} failed (of ${names.length}` +
    (smokeCount > 0 ? `，其中 smoke ${smokeCount} 个` : "") + ")");
process.exit(failures.length === 0 ? 0 : 1);
