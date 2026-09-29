// tools/cst_kinds_census.mjs —— CST 节点 kind 宇宙普查（S1 枚举化的事实依据）
//
// 用途：回答「编译器里实际存在哪些节点 kind 字符串」，而不是相信手工维护的注册表。
//   * 注册表 src/base.tc::node_kind_names（当前 86 项）是**手工/生成器**维护的，
//     实测发现它**并不覆盖真实全集**（如 "ClauseDead" / "block_expr" / "deserialize"
//     只在 parse/sema 里被赋值，从未进注册表）→ 若直接按注册表做数值枚举，
//     这些 kind 会落到「未注册」，将来 match(nr_tag) 分派必须留 unknown 兜底臂。
//   * 本脚本从源码里**抽取**四类证据，取并集，产出 tools/cst_kinds.json：
//       ① node_new("K")                 —— 节点构造（真正的产生点）
//       ② mk_<NAME>(... ) 调用           —— 经 base.tc 的构造器间接产生（mk_NAME → K 映射从 base.tc 抽）
//       ③ .kind == "K" / .kind != "K"   —— 判定点（说明这个 kind 被消费）
//       ④ .kind = "K"                   —— 改写点（说明 kind 会在构造后被改，tag 易失效）
//
// 产物被 tools/cstgen.mjs（S2a）消费，用于生成 NK_* 枚举 / nk_name / nk_of_kind。
//
// 用法：
//   node tools/cst_kinds_census.mjs            # 输出报告 + 写 tools/cst_kinds.json
//   node tools/cst_kinds_census.mjs --dry      # 只报告，不写文件
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DRY = process.argv.includes("--dry");

const files = readdirSync(SRC).filter((f) => f.endsWith(".tc")).map((f) => join(SRC, f));

// ── ① 注册表：从 base.tc 抽取 node_kind_names ──
const baseSrc = readFileSync(join(SRC, "base.tc"), "utf8");
const regMatch = baseSrc.match(/node_kind_names:\s*\[(\d+)\]string\s*=\s*\[([^\]]*)\]/);
if (!regMatch) { console.error("[census] 未能解析 node_kind_names 注册表"); process.exit(2); }
const registryCount = Number(regMatch[1]);
const registry = [...regMatch[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
if (registry.length !== registryCount) {
  console.error(`[census] ⚠ 注册表声明 ${registryCount} 项，实际解析 ${registry.length} 项`);
}

// ── ② mk_<NAME> → kind 映射（从 base.tc 的构造器体里取 node_new("K")）──
const mkMap = {};
const mkRe = /pub fn (mk_\w+)\([^)]*\)\s*i64\s*\{([\s\S]*?)\n\}/g;
for (const m of baseSrc.matchAll(mkRe)) {
  const fn = m[1];
  const body = m[2];
  const nn = body.match(/node_new\(\s*"([^"]+)"\s*\)/);
  if (nn) mkMap[fn] = nn[1];
}

// ── ③ 全量扫描四类证据 ──
const usage = {};                       // kind -> { ctor, call, cmp, assign, files:Set }
function bump(k, field, file) {
  if (!usage[k]) usage[k] = { ctor: 0, call: 0, cmp: 0, assign: 0, files: new Set() };
  usage[k][field]++;
  usage[k].files.add(file.split(/[\\/]/).pop());
}

for (const f of files) {
  const s = readFileSync(f, "utf8");
  const base = f.split(/[\\/]/).pop();
  // ① node_new("K")
  for (const m of s.matchAll(/node_new\(\s*"([^"]+)"\s*\)/g)) bump(m[1], "ctor", base);
  // ② mk_NAME( → 映射 kind
  for (const m of s.matchAll(/\b(mk_\w+)\s*\(/g)) {
    const k = mkMap[m[1]];
    if (k) bump(k, "call", base);
  }
  // ③ .kind == "K" / != "K" / kind == "K"（含 base.kind / n.kind 等一切以 kind 结尾的字段）
  for (const m of s.matchAll(/\bkind\s*[!=]=\s*"([^"]+)"/g)) bump(m[1], "cmp", base);
  // ④ .kind = "K"
  for (const m of s.matchAll(/\b\.kind\s*=\s*"([^"]+)"/g)) bump(m[1], "assign", base);
}

// ── 关键分类：`kind` 字段名被**多个互不相交的宇宙**共用 ──
//   Node.kind（CST 节点）/ TypeDesc.kind（类型）/ HvValue.kind（CTFE 值）/ 各类 token kind …
// 只有**产生点**（node_new / mk_*）能确证一个字符串属于 Node 宇宙；仅出现在
// 比较式里的（如 "Array"/"Map"/"Void" —— 实为 TypeDesc.kind）属**其它宇宙**，
// 必须与 Node 枚举隔离（与 Sym16/32/64(tag)「不同集合不可比较」同一原则）。
const prod = Object.keys(usage).filter((k) => usage[k].ctor > 0 || usage[k].call > 0).sort();
const cmpOnly = Object.keys(usage).filter((k) => usage[k].ctor === 0 && usage[k].call === 0).sort();

// 「只由构造后改写产生」的 Node kind：没有 node_new 产生点，只能靠 `.kind = "X"` 出现，
// 但确实是 Node 宇宙成员（人工核定，脚本无法从文本区分 `.kind` 属于哪个宇宙）。
// ⚠ 新增此类 kind 时**必须**同步更新本表，否则会被误判进「其它宇宙」而漏出枚举。
const REWRITE_ONLY_NODE_KINDS = ["ClauseDead", "deserialize"];

const universe = [...new Set([...prod, ...REWRITE_ONLY_NODE_KINDS])].sort();
const regSet = new Set(registry);
const unregistered = universe.filter((k) => !regSet.has(k));
const unusedInRegistry = registry.filter((k) => !usage[k]);

// ── 报告 ──
console.log(`[census] 注册表 ${registry.length} 项（声明 ${registryCount}）`);
console.log(`[census] Node 宇宙（有产生点 node_new/mk_*）：${universe.length} 项`);
console.log(`[census] ⚠ 产生点有、注册表缺（${unregistered.length}）：${unregistered.join(", ")}`);
console.log(`[census] ⚠ 注册表有、源码无任何实证（${unusedInRegistry.length}）：${unusedInRegistry.join(", ")}`);
console.log(`[census] 其它 kind 宇宙（仅出现在比较/赋值，非 Node，禁止混入 NK_*）：${cmpOnly.length} 项 —— ${cmpOnly.join(", ")}`);
const assigned = universe.filter((k) => usage[k].assign > 0);
console.log(`[census] 会被「构造后改写」的 kind（${assigned.length}）—— tag 字段若只填一次即失效：`);
for (const k of assigned) {
  console.log(`         - ${k}: assign×${usage[k].assign} ${[...usage[k].files].join(",")}`);
}

const out = {
  generated: new Date().toISOString(),
  registry_count: registryCount,
  registry,
  universe,
  unregistered,
  unused_in_registry: unusedInRegistry,
  mk_map: mkMap,
  usage: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, { ctor: v.ctor, call: v.call, cmp: v.cmp, assign: v.assign, files: [...v.files].sort() }])),
};

if (!DRY) {
  writeFileSync(join(ROOT, "tools", "cst_kinds.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("[census] 已写 tools/cst_kinds.json");
}
