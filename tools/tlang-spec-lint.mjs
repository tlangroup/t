#!/usr/bin/env node
// tlang-spec-lint.mjs —— 一致性检查器（规范 §3.2，防漂移）
//
// 用法：
//   tlang-spec-lint.mjs --specs <docs/tlang 目录>
//
// 检查项（针对第三方/扩展自身目录）：
//   - 每个 rXXXX_*.md 需求文档都有同名 .landing.md
//   - 每个 .landing.md 至少引用一处真实存在的 example / test 文件
//   - 每个 examples/tlang/rXXXX_*.tc 都有 .expected.txt 同缀兄弟
//   - 每个 tests/tlang/rXXXX_*/ 含且只含 pass.tc 或 fail.tc；fail.tc 含 expect-diag
//   - 无孤儿产物：任何 example/test 的 rXXXX 必须在注册表有对应需求
//   - 注册表 _registry.json 与磁盘文件一致（无缺漏、无多余）
//   - [--self / --assert-tc-fresh] 额外校验 t 核心仓库的 tc.exe == g4（新鲜度，bootstrap §4.4）
// 退出码非 0 = 规范被破坏，禁止合并 / 发布。

'use strict';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// 把 POSIX 风格绝对路径（如 /c/foo）转为本机 Windows 形式（C:\foo），
// 因为 t 的编译器是 Windows 二进制，无法识别 GitBash 的 POSIX 路径。
function toNative(p) {
  if (!p) return p;
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
    return p.replace(/^\/([a-zA-Z])\//, '$1:\\').replace(/\//g, '\\');
  }
  return p;
}

function parseArgs(argv) {
  const a = { specs: null, self: false, assertTcFresh: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--specs') a.specs = argv[++i];
    else if (argv[i] === '--self') a.self = true;
    else if (argv[i] === '--assert-tc-fresh') a.assertTcFresh = true;
    else if (argv[i] === '-h' || argv[i] === '--help') a.help = true;
  }
  return a;
}

// 新鲜度校验：tc.exe 必须等于最新不动点 g4（bootstrap §4.4）。仅 t 核心仓库有意义。
function assertTcFresh(root) {
  const tcP = toNative(path.join(root, 'out', 'dbg', 'tc.exe'));
  const g4P = toNative(path.join(root, 'out', 'dbg', 'g4.exe'));
  if (!fs.existsSync(tcP) || !fs.existsSync(g4P)) {
    console.error('[assert-tc-fresh] 缺少 tc.exe 或 g4.exe（需先跑 gate L2）');
    return false;
  }
  const th = crypto.createHash('md5').update(fs.readFileSync(tcP)).digest('hex');
  const gh = crypto.createHash('md5').update(fs.readFileSync(g4P)).digest('hex');
  if (th !== gh) {
    console.error(`[assert-tc-fresh] tc.exe(${th.slice(0, 8)}) ≠ g4(${gh.slice(0, 8)})：tc.exe 陈旧（bootstrap §4.4.4）。请重跑 gate L2，或 cp out/dbg/g4.exe out/dbg/tc.exe`);
    return false;
  }
  console.log(`[assert-tc-fresh] OK tc.exe == g4 (${th.slice(0, 8)})`);
  return true;
}

function extractId(name) {
  const m = name.match(/^(r[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)_/);
  return m ? m[1] : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.specs) {
    console.log('用法: tlang-spec-lint.mjs --specs <docs/tlang 目录>');
    process.exit(args.specs ? 0 : 2);
  }
  if (!fs.existsSync(args.specs)) { console.error(`--specs 不存在: ${args.specs}`); process.exit(2); }

  // specsDir = <root>/docs/tlang  → 工程根 = specsDir 的再上一级（docs 的父级）
  // 先转本机路径，避免 Windows 上 path.dirname 把 /c/... 误解为 \c\...
  const root = path.dirname(path.dirname(toNative(args.specs)));
  const exDir = path.join(root, 'examples', 'tlang');
  const teDir = path.join(root, 'tests', 'tlang');
  const errors = [];
  const idsOnDisk = new Set();

  // --self：t 核心自用，默认启用新鲜度校验（bootstrap §4.4）。
  if (args.self && !fs.existsSync(path.join(root, 'tools', 'gate.mjs'))) {
    errors.push('[--self] 仅当 specs 位于 t 核心仓库时可用（未找到 tools/gate.mjs）');
  }
  if (args.assertTcFresh || args.self) {
    if (!assertTcFresh(root)) errors.push('[assert-tc-fresh] tc.exe 陈旧，不等于最新不动点 g4（bootstrap §4.4.4）');
  }

  // 需求文档 / 落地文档成对
  const reqDocs = fs.readdirSync(args.specs).filter((f) => /^r[A-Za-z0-9]+(-[A-Za-z0-9]+)?_.*\.md$/.test(f) && !f.endsWith('.landing.md'));
  for (const f of reqDocs) {
    const id = extractId(f);
    const landing = path.join(args.specs, f.replace(/\.md$/, '.landing.md'));
    if (!fs.existsSync(landing)) errors.push(`需求 ${f} 缺少落地文档 ${path.basename(landing)}`);
  }

  // 落地文档必须引用真实产物
  const landingDocs = fs.readdirSync(args.specs).filter((f) => f.endsWith('.landing.md'));
  for (const f of landingDocs) {
    const id = extractId(f);
    idsOnDisk.add(id);
    const doc = fs.readFileSync(path.join(args.specs, f), 'utf8');
    const refs = (doc.match(/(examples\/tlang\/|tests\/tlang\/)\S+/g) || []).map((s) => s.trim());
    let realRef = 0;
    for (const ref of refs) {
      if (fs.existsSync(path.join(root, ref))) realRef++;
      else errors.push(`落地 ${f} 引用产物不存在: ${ref}`);
    }
    if (refs.length === 0) errors.push(`落地 ${f} 未引用任何验证产物`);
    else if (realRef === 0) errors.push(`落地 ${f} 引用的产物均不存在`);
  }

  // 示例：tc 必须有 expected
  if (fs.existsSync(exDir)) {
    for (const f of fs.readdirSync(exDir)) {
      if (!f.endsWith('.tc')) continue;
      const id = extractId(f);
      if (id) idsOnDisk.add(id);
      const exp = f.slice(0, -3) + '.expected.txt';
      if (!fs.existsSync(path.join(exDir, exp))) errors.push(`示例 ${f} 缺少 ${exp}`);
    }
  }

  // 测试：pass/fail 互斥 + fail 必须 expect-diag
  if (fs.existsSync(teDir)) {
    for (const d of fs.readdirSync(teDir)) {
      const dp = path.join(teDir, d);
      if (!fs.statSync(dp).isDirectory()) continue;
      const id = extractId(d);
      if (id) idsOnDisk.add(id);
      const hasPass = fs.existsSync(path.join(dp, 'pass.tc'));
      const hasFail = fs.existsSync(path.join(dp, 'fail.tc'));
      if (hasPass && hasFail) errors.push(`测试 ${d} 同时含 pass.tc 与 fail.tc（必须互斥）`);
      if (!hasPass && !hasFail) errors.push(`测试 ${d} 既无 pass.tc 也无 fail.tc`);
      if (hasFail) {
        const src = fs.readFileSync(path.join(dp, 'fail.tc'), 'utf8');
        if (!/expect-diag:/.test(src)) errors.push(`测试 ${d}/fail.tc 缺少 // expect-diag 声明`);
      }
    }
  }

  // 注册表一致性
  const regPath = path.join(args.specs, '_registry.json');
  if (fs.existsSync(regPath)) {
    let reg;
    try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch (e) { errors.push(`_registry.json 不是合法 JSON: ${e.message}`); reg = []; }
    const regIds = new Set((reg || []).map((e) => e.id));
    for (const id of idsOnDisk) if (!regIds.has(id)) errors.push(`磁盘需求 ${id} 未登记进 _registry.json`);
    for (const id of regIds) if (!idsOnDisk.has(id)) errors.push(`_registry.json 登记 ${id} 但磁盘无对应产物`);
  } else {
    errors.push(`缺少 _registry.json（机器可读单一真相源）`);
  }

  if (errors.length) {
    console.error(`\n[tlang-spec-lint] ${errors.length} 处违规：`);
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
  }
  console.log(`[tlang-spec-lint] OK 目录 ${args.specs} 规范一致（${idsOnDisk.size} 条需求）`);
  process.exit(0);
}

main();
