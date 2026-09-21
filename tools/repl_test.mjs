#!/usr/bin/env node
// repl_test.mjs — REPL 冒烟测试（轻量回归护栏）
//
// 背景：t 编译器曾有 REPL 输入 `let a=3` 即报 `arena: out of memory` 的事故。
// 根因是 LLVM 后端对 read_line 内建漏配 sret 兼容的 tll_read_line 末位 out 指针 shim，
// 16B %TStr 聚合返回被按值（RAX:RDX）发射，与 clang 的 sret 隐藏指针 ABI 错位，
// 调用方读到垃圾 len → t_arena_alloc 触发 OOM。该测试在每次门禁跑一遍 REPL，
// 用最简单的输入守住「read_line 不 OOM、表达式能求值」这条底线。
//
// 用法：
//   node tools/repl_test.mjs [--compiler <path>] [--mode dbg|rls]
// 退出码 0 = 通过；非 0 = 失败（并把失败原因打到 stdout 末行，供 gate lastLine 取用）。

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

// ── 参数 ──
let compiler = join(ROOT, "out", "dbg", "tc.exe");
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--compiler") { compiler = process.argv[++i]; }
    else if (a === "--mode") { i++; /* 预留：当前 REPL 模式与 --mode 无关，仅透传兼容 */ }
    else { console.error(`repl_test: unknown arg '${a}'`); process.exit(2); }
}

// ── 简单用例：每行是一次 REPL 输入；expect 为正则（可选），需出现在合并输出中 ──
// 只用最朴素的、单行自洽的代码：算术、let 声明、字符串拼接、元命令退出。
// 注意：REPL 的 let 声明不跨行持久到会话作用域（属既有行为，与本次 OOM 修复无关），
// 故「let 常量」用例只断言「不 OOM、退出 0」，不要求回显值；求值类用例用单行自洽表达式。
const CASES = [
    { name: "算术求值 1+2", input: "1+2\n:quit\n", expect: /(^|[\s])3([\s]|$)/, forbid: "arena: out of memory" },
    { name: "let 声明不 OOM", input: "let a=3\n:quit\n", expect: null, forbid: "arena: out of memory" },
    { name: "字符串拼接", input: '"hi" + "!"\n:quit\n', expect: /hi!/, forbid: "arena: out of memory" },
    { name: "退出码为 0", input: "2*21\n:quit\n", expect: /42/, forbid: "arena: out of memory" },
];

function runRepl(inputs) {
    return new Promise((res) => {
        const p = spawn(compiler, [], { cwd: ROOT, windowsHide: true });
        let out = "";
        let done = false;
        const finish = (code, extra) => {
            if (done) return;
            done = true;
            if (killTimer) clearTimeout(killTimer);
            res({ code, out: extra ? out + extra : out });
        };
        const killTimer = setTimeout(() => {
            try { p.kill("SIGKILL"); } catch { /* 已退出 */ }
            finish(-1, "\n[repl_test] 超时 30s，已强杀（可能卡在 read_line）\n");
        }, 30000);
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { out += d; });
        p.on("exit", (code) => finish(code ?? -1));
        p.on("error", (e) => finish(-1, String(e)));
        // 无参数启动 tc → 进入 REPL；通过 stdin 喂入交互脚本。
        p.stdin.write(inputs);
        p.stdin.end();
    });
}

let failed = 0;
const lines = [];
lines.push(`repl_test: compiler=${compiler}`);
for (const c of CASES) {
    const r = await runRepl(c.input);
    const oom = r.out.includes(c.forbid);
    const matched = c.expect == null ? true : c.expect.test(r.out);
    const ok = r.code === 0 && !oom && matched;
    if (!ok) failed++;
    const detail = oom
        ? `出现 ${c.forbid}`
        : !matched
            ? `未匹配 ${c.expect}（输出末行: ${r.out.trimEnd().split("\n").slice(-1)[0] || "<空>"}）`
            : `退出码 ${r.code}`;
    lines.push(`  ${ok ? "PASS" : "FAIL"}  ${c.name} —— ${detail}`);
}
lines.push(failed === 0 ? `repl_test: ${CASES.length} 用例全过` : `repl_test: ${failed} 例失败`);
console.log(lines.join("\n"));
process.exit(failed === 0 ? 0 : 1);
