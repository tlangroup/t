#!/usr/bin/env node
// tools/bench_compile.mjs — T 编译器单文件编译性能基线测量
//
// 用途：建立「当前管线（HIR→TIR→双后端）」单次编译耗时基线，
//       供 MIR 层（D3-A vs D2 张力）落地前后做回归 / 持平 / 增益对比。
// 不触碰编译器实现，仅驱动 `tc` 子命令并计时。
//
// 用法：
//   node tools/bench_compile.mjs [--compiler <path>] [--examples <dir>]
//                                [--modes check,emit-ll] [--repeat N] [--limit N]
//
// 输出：out/perf_baseline.json（结构化）+ out/perf_baseline.md（可读表）

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const COMPILER = arg('--compiler', 'out/rls/tc.exe');
const EX_DIR = arg('--examples', 'examples');
const REPEAT = Number(arg('--repeat', '3')) || 3;
const LIMIT = Number(arg('--limit', '0')) || 0;
const MODES = (arg('--modes', 'check,emit-ll') || 'check,emit-ll').split(',').filter(Boolean);

function timeOne(cmd, file) {
  const t0 = performance.now();
  try {
    execFileSync(COMPILER, [cmd, file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { ok: false, err: String(e.message || e).split('\n')[0].slice(0, 100) };
  }
  return { ok: true, ms: performance.now() - t0 };
}

let files = readdirSync(EX_DIR)
  .filter((f) => f.endsWith('.tc') && !f.startsWith('_z_') && !f.startsWith('.'))
  .map((f) => join(EX_DIR, f))
  .sort();
if (LIMIT > 0) files = files.slice(0, LIMIT);

const results = {};
for (const f of files) {
  results[f] = { modes: {} };
  for (const m of MODES) {
    const samples = [];
    let lastErr = null;
    for (let r = 0; r < REPEAT; r++) {
      const r0 = timeOne(m, f);
      if (r0.ok) samples.push(r0.ms);
      else lastErr = r0.err;
    }
    if (samples.length) {
      samples.sort((a, b) => a - b);
      results[f].modes[m] = {
        median: samples[Math.floor(samples.length / 2)],
        min: samples[0],
        n: samples.length,
      };
    } else {
      results[f].modes[m] = { error: lastErr };
    }
  }
}

function agg(mode) {
  const vals = files
    .map((f) => results[f].modes[mode])
    .filter((x) => x && x.median != null)
    .map((x) => x.median);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    count: vals.length,
    totalMs: Math.round(sum),
    medianMs: Math.round(vals[Math.floor(vals.length / 2)]),
    p90Ms: Math.round(vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))]),
    maxMs: Math.round(vals[vals.length - 1]),
  };
}

const summary = {
  compiler: COMPILER,
  repeat: REPEAT,
  modes: MODES,
  sampleCount: files.length,
  generatedAt: new Date().toISOString(),
  aggregate: {},
};
for (const m of MODES) summary.aggregate[m] = agg(m);

const top = [...files]
  .map((f) => ({ f, c: results[f].modes.check ? results[f].modes.check.median : null }))
  .filter((r) => r.c != null)
  .sort((a, b) => b.c - a.c)
  .slice(0, 15);

let md = '# T 编译性能基线（自动测量）\n\n';
md += `- 编译器：${COMPILER}\n`;
md += `- 重复：${REPEAT}× / 取中位数\n`;
md += `- 样本：${files.length} 个 examples/*.tc（排除 \`_z_*\` 预期错误夹具）\n`;
md += `- 生成时间：${summary.generatedAt}\n\n`;
md += '## 聚合\n\n';
md += '| 模式 | 样本数 | 总耗时(ms) | 中位(ms) | p90(ms) | 最大(ms) |\n';
md += '| --- | --- | --- | --- | --- | --- |\n';
for (const m of MODES) {
  const a = summary.aggregate[m];
  md += a
    ? `| ${m} | ${a.count} | ${a.totalMs} | ${a.medianMs} | ${a.p90Ms} | ${a.maxMs} |\n`
    : `| ${m} | - | - | - | - | - |\n`;
}
md += '\n## 逐文件 top 15（按 check 中位耗时）\n\n';
md += '| 文件 | check(ms) | emit-ll(ms) |\n';
md += '| --- | --- | --- |\n';
for (const r of top) {
  const ell = results[r.f].modes['emit-ll'];
  const ellStr = ell ? (ell.median != null ? Math.round(ell.median) : 'err') : '-';
  md += `| ${r.f.replace(EX_DIR + '/', '')} | ${Math.round(r.c)} | ${ellStr} |\n`;
}
md += '\n> 此基线对应「当前管线（无 MIR）」。MIR 层（D3-A）落地后复跑本脚本，比对中位/p90；回归 > 10% 即触发 G-CI-10 阻断（见 ci-gate-design.md）。\n';

mkdirSync('out', { recursive: true });
writeFileSync('out/perf_baseline.json', JSON.stringify(summary, null, 2));
writeFileSync('out/perf_baseline.md', md);
console.log(md);
