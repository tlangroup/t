#!/usr/bin/env node
// tlang-verify.mjs —— 便携式一致性运行器（规范 §3.1 / §3.3 / §3.4）
//
// 用法：
//   tlang-verify.mjs --specs <docs/tlang 目录> [--compiler <tc.exe>] [--lib-dir <dir>]
//                   [--compiler-commit <sha>] [--assert-spec-version] [<rXXXX>...]
//   tlang-verify.mjs attest <rXXXX> --specs <dir> --compiler <tc> [--compiler-commit <sha>]
//
// 行为：
//   1) 以 --specs 目录的父级为工程根，定位 examples/tlang、tests/tlang。
//   2) 扫描 rXXXX_*.tc（示例）与 rXXXX_*/{pass,fail}.tc（测试），按 id 归集。
//   3) 对指定（或缺省全量）需求，用 --compiler 跑对应产物并核对：
//        - 示例：程序 stdout 逐字节 == <同名>.expected.txt
//        - 测试 pass.tc：编译运行退出码 == 0
//        - 测试 fail.tc：退出码 != 0 且 实际诊断码集合 ⊇ 声明 expect-diag
//   4) 任一产物缺失或失败 → 进程退出码非 0。
//
// 全局公共物：本工具由 tlang 核心（t 仓库 tools/）提供，第三方通过 --specs 指向自身目录运行，
//           第三方永不修改 t（见规范 §0.1.3 不变量 4）。

'use strict';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

function parseArgs(argv) {
  const a = {
    specs: null, compiler: null, libDir: null, compilerCommit: null,
    assertSpecVersion: false, attest: null, ids: [], help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--specs') a.specs = argv[++i];
    else if (t === '--compiler') a.compiler = argv[++i];
    else if (t === '--lib-dir') a.libDir = argv[++i];
    else if (t === '--compiler-commit') a.compilerCommit = argv[++i];
    else if (t === '--assert-spec-version') a.assertSpecVersion = true;
    else if (t === 'attest') a.attest = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else if (/^r[A-Za-z0-9]+(-[A-Za-z0-9]+)?$/.test(t)) a.ids.push(t);
  }
  return a;
}

function extractId(name) {
  const m = name.match(/^(r[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)_/);
  return m ? m[1] : null;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

// 把 POSIX 风格绝对路径（如 /c/foo）转为本机 Windows 形式（C:\foo），
// 因为 t 的编译器是 Windows 二进制，无法识别 GitBash 的 POSIX 路径。
function toNative(p) {
  if (!p) return p;
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
    return p.replace(/^\/([a-zA-Z])\//, '$1:\\').replace(/\//g, '\\');
  }
  return p;
}

// 运行 t 编译器（run 子命令）。返回 { code, stdout, stderr }
// 注意：execFileSync 成功时【直接返回 stdout 字符串】；失败时在抛出的 error 上才有 .stdout/.stderr。
function runTc(compiler, libDir, file) {
  const args = ['run'];
  if (libDir) args.push('--lib-dir', toNative(libDir));
  args.push(toNative(file));
  try {
    const out = execFileSync(compiler, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout: out || '', stderr: '' };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function parseDiags(text) {
  const set = new Set();
  const re = /T-[A-Z]+-E\d+/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[0]);
  return set;
}

function declaredDiags(tcPath) {
  const src = fs.readFileSync(tcPath, 'utf8');
  const set = new Set();
  const re = /\/\/\s*expect-diag:\s*(\S+)/g;
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return set;
}

function normLines(s) {
  return s.replace(/\r\n/g, '\n');
}

function discover(specsDir) {
  // specsDir = <root>/docs/tlang  → 工程根 = specsDir 的再上一级（docs 的父级）
  // 先转本机路径，避免 Windows 上 path.dirname 把 /c/... 误解为 \c\...
  const root = path.dirname(path.dirname(toNative(specsDir)));
  const exDir = path.join(root, 'examples', 'tlang');
  const teDir = path.join(root, 'tests', 'tlang');
  const ids = new Map();
  const add = (id, kind, payload) => {
    if (!ids.has(id)) ids.set(id, { examples: [], tests: [] });
    if (kind === 'example') ids.get(id).examples.push(payload);
    else ids.get(id).tests.push(payload);
  };
  if (fs.existsSync(exDir)) {
    for (const f of fs.readdirSync(exDir)) {
      if (!f.endsWith('.tc')) continue;
      const id = extractId(f);
      if (!id) continue;
      const tc = path.join(exDir, f);
      const exp = tc.slice(0, -3) + '.expected.txt';
      add(id, 'example', { tc, expected: exp, hasExpected: fs.existsSync(exp) });
    }
  }
  if (fs.existsSync(teDir)) {
    for (const d of fs.readdirSync(teDir)) {
      const dp = path.join(teDir, d);
      if (!fs.statSync(dp).isDirectory()) continue;
      const id = extractId(d);
      if (!id) continue;
      const pass = path.join(dp, 'pass.tc');
      const fail = path.join(dp, 'fail.tc');
      if (fs.existsSync(pass)) add(id, 'test', { kind: 'pass', tc: pass });
      if (fs.existsSync(fail)) add(id, 'test', { kind: 'fail', tc: fail });
    }
  }
  return { ids, exDir, teDir };
}

function verifyOne(id, entry, compiler, libDir) {
  const problems = [];
  for (const ex of entry.examples) {
    if (!ex.hasExpected) {
      problems.push(`示例 ${path.basename(ex.tc)} 缺少 .expected.txt`);
      continue;
    }
    const exp = normLines(fs.readFileSync(ex.expected, 'utf8'));
    const r = runTc(compiler, libDir, ex.tc);
    if (r.code !== 0) {
      problems.push(`示例 ${path.basename(ex.tc)} 运行失败 (exit ${r.code}): ${r.stderr.trim().split('\n')[0]}`);
      continue;
    }
    const got = normLines(r.stdout);
    if (got !== exp) {
      problems.push(`示例 ${path.basename(ex.tc)} stdout 不符 (got sha=${sha256(got)} exp sha=${sha256(exp)})`);
    }
  }
  for (const te of entry.tests) {
    const r = runTc(compiler, libDir, te.tc);
    if (te.kind === 'pass') {
      if (r.code !== 0) problems.push(`测试 ${path.basename(path.dirname(te.tc))}/pass.tc 应成功却失败 (exit ${r.code}): ${r.stderr.trim().split('\n')[0]}`);
    } else {
      if (r.code === 0) {
        problems.push(`测试 ${path.basename(path.dirname(te.tc))}/fail.tc 应失败却成功`);
        continue;
      }
      const emitted = parseDiags(r.stderr + '\n' + r.stdout);
      const declared = declaredDiags(te.tc);
      for (const d of declared) {
        if (!emitted.has(d)) problems.push(`测试 ${path.basename(path.dirname(te.tc))}/fail.tc 期望诊断 ${d} 未出现 (实发: ${[...emitted].join(',') || '无'})`);
      }
    }
  }
  return problems;
}

function assertSpecVersion(specsDir, compilerCommit) {
  const vf = path.join(specsDir, '_spec_version.json');
  if (!fs.existsSync(vf)) {
    console.error(`[assert-spec-version] 缺少 ${vf}`);
    return false;
  }
  const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  const target = v.compiler_commit || v.compilerCommit;
  if (!target) { console.error('[assert-spec-version] _spec_version.json 无 compiler_commit 字段'); return false; }
  if (!compilerCommit) {
    console.error(`[assert-spec-version] 需 --compiler-commit <sha> 比对（目标 ${target.slice(0, 12)}）`);
    return false;
  }
  if (compilerCommit !== target) {
    console.error(`[assert-spec-version] 编译器 commit ${compilerCommit.slice(0, 12)} ≠ 基线 ${target.slice(0, 12)}；请先更新 _spec_version.json 或换用对应编译器`);
    return false;
  }
  console.log(`[assert-spec-version] OK 基线 ${target.slice(0, 12)}`);
  return true;
}

function attest(args) {
  if (!args.compiler) { console.error('attest 需要 --compiler'); process.exit(2); }
  const { ids } = discover(args.specs);
  const id = args.attest;
  if (!ids.has(id)) { console.error(`attest: 未找到需求 ${id}`); process.exit(2); }
  const problems = verifyOne(id, ids.get(id), args.compiler, args.libDir);
  const commit = args.compilerCommit || 'unknown';
  const stamp = new Date().toISOString().slice(0, 10);
  const evLines = [`### 验收结果（auto-attest ${stamp}）`, `- compiler_commit: ${commit}`, `- 状态: ${problems.length ? 'FAIL' : 'PASS'}`];
  if (problems.length) evLines.push(...problems.map((p) => `- ❌ ${p}`));
  else evLines.push('- ✅ 所有验证产物通过');
  const block = evLines.join('\n');
  let landing = path.join(args.specs, `${id}.landing.md`);
  // 约定命名是 <id>_<slug>.landing.md，若直接 <id>.landing.md 不存在则按前缀查找
  if (!fs.existsSync(landing)) {
    const cand = fs.readdirSync(args.specs).find((f) => f.startsWith(`${id}_`) && f.endsWith('.landing.md'));
    if (cand) landing = path.join(args.specs, cand);
  }
  if (!fs.existsSync(landing)) {
    console.error(`attest: 缺少落地文档 ${landing}`);
    process.exit(2);
  }
  let doc = fs.readFileSync(landing, 'utf8');
  if (/^### 验收结果（auto-attest/.test(doc)) {
    doc = doc.replace(/### 验收结果（auto-attest[\s\S]*?(?=\n### |\n## |$)/, block + '\n');
  } else if (/^## 验收结果/m.test(doc)) {
    doc = doc.replace(/## 验收结果[\s\S]*?(?=\n## |$)/, '## 验收结果\n' + block + '\n');
  } else {
    doc = doc.replace(/\n*$/, '\n\n## 验收结果\n' + block + '\n');
  }
  fs.writeFileSync(landing, doc);
  console.log(`attest ${id}: ${problems.length ? 'FAIL' : 'PASS'} → 已写回 ${landing}`);
  process.exit(problems.length ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.specs) {
    console.log('用法: tlang-verify.mjs --specs <docs/tlang> [--compiler <tc>] [--lib-dir <dir>] [--compiler-commit <sha>] [--assert-spec-version] [<rXXXX>...]');
    console.log('      tlang-verify.mjs attest <rXXXX> --specs <dir> --compiler <tc> [--compiler-commit <sha>]');
    process.exit(args.specs ? 0 : 2);
  }
  if (!fs.existsSync(args.specs)) { console.error(`--specs 不存在: ${args.specs}`); process.exit(2); }
  if (args.attest) return attest(args);
  if (!args.compiler) { console.error('需要 --compiler <tc.exe>'); process.exit(2); }
  if (args.assertSpecVersion && !assertSpecVersion(args.specs, args.compilerCommit)) process.exit(1);

  const { ids } = discover(args.specs);
  let targetIds = args.ids.length ? args.ids : [...ids.keys()];
  let fail = 0;
  for (const id of targetIds.sort()) {
    if (!ids.has(id)) { console.log(`r ${id.padEnd(12)} SKIP (无产物)`); continue; }
    const problems = verifyOne(id, ids.get(id), args.compiler, args.libDir);
    if (problems.length) { fail++; console.log(`r ${id.padEnd(12)} FAIL (${problems.length})`); problems.forEach((p) => console.log(`    - ${p}`)); }
    else console.log(`r ${id.padEnd(12)} PASS`);
  }
  console.log(`\n=== tlang-verify: ${targetIds.length - fail}/${targetIds.length} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}

main();
