// tools/cst_rollout.mjs —— S2 全量铺开：抽取 mk_* 字段 schema + 向 mk_* 注入双写登记调用
//
// 动作：
//   1) 抽取阶段：扫描 src/base.tc 的全部 `pub fn mk_*(...) i64`，解析 node_new("KIND") 种类、
//      参数（去末位 ti）、字段赋值 `n.<field> = <rhs>;`。按 kind 聚合，同一 kind 的多个 mk_*
//      （如 pointer 的 mk_pointer / mk_dev_ptr）取**字段并集**，使登记函数签名为并集、各 mk_*
//      按并集顺序传参（缺失字段补类型默认值），避免参数个数不匹配。
//      写出 tools/cst_nodes.json（cstgen.mjs 据此生成 GEN:node-structs）。
//   2) 接线阶段：在每个 mk_* 的 `slice_set(nodes, id, n);` 后注入
//        `cst_register_<RecK>(<rhs1>, <rhs2>, ...);`（幂等，带 // S2 dual-write 哨兵）。
//
// 设计取舍（见 docs/compiler/cst-design-v2.md §0.12）：登记函数以「参数」而非「读 nodes[id]」
// 实现，避免对 `nodes` 的前向引用；GEN:node-structs 区间可稳定落在文件头。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(ROOT, "src", "base.tc");
const NODES_JSON = join(ROOT, "tools", "cst_nodes.json");

const FIELD_TYPE = {
  kind: "string", sa: "string", sb: "string", sc: "string", se: "string", tv: "string",
  has_sa: "bool", has_sb: "bool", has_sc: "bool",
  ba: "bool", bb: "bool", bc: "bool", bd: "bool", be: "bool", bf: "bool",
  ia: "i64", ib: "i64", na: "i64", nb: "i64", nc: "i64", nd: "i64", memspace: "i64",
  la: "i64", lb: "i64", lc: "i64", ln: "i64", cl: "i64", td: "i64",
};
function recName(kind) {
  return kind.split("_").map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s)).join("");
}
function nkConst(kind) {
  return "NK_" + kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}
function defaultFor(t) {
  if (t === "string") return `""`;
  if (t === "bool") return `false`;
  return `0`;
}

const src = readFileSync(BASE, "utf8");
const fnRe = /pub\s+fn\s+(mk_[A-Za-z0-9_]+)\s*\(([^)]*)\)\s*i64\s*\{/g;
const mks = [];
let m;
while ((m = fnRe.exec(src))) {
  const name = m[1];
  const paramStr = m[2];
  const bodyStart = m.index + m[0].length;
  let depth = 1, i = bodyStart, end = -1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    i++;
  }
  const body = src.slice(bodyStart, end);
  const kindM = body.match(/node_new\s*\(\s*"([^"]+)"\s*\)/);
  if (!kindM) { console.error(`[cst_rollout] ${name}: 找不到 node_new("KIND")，跳过`); continue; }
  const kind = kindM[1];
  const assigns = [];
  const asRe = /n\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g;
  let am;
  while ((am = asRe.exec(body))) {
    const field = am[1];
    const rhs = am[2].trim();
    if (!(field in FIELD_TYPE)) { console.error(`[cst_rollout] ${name}: 未知字段 n.${field}（rhs=${rhs}），跳过该赋值`); continue; }
    assigns.push({ field, rhs });
  }
  mks.push({ name, kind, assigns });
}

// 同 kind 聚合 → 字段并集
const byKind = {};
for (const mk of mks) { (byKind[mk.kind] ||= []).push(mk); }
const nodes = {};
const order = [];
for (const kind of Object.keys(byKind)) {
  const group = byKind[kind];
  const unionMap = new Map();
  for (const mk of group) for (const a of mk.assigns) if (!unionMap.has(a.field)) unionMap.set(a.field, FIELD_TYPE[a.field]);
  const fields = [...unionMap.entries()].map(([f, t]) => [f, t]);
  nodes[kind] = { rec: "Rec" + recName(kind), nk: nkConst(kind), mk: group[0].name, fields };
  order.push(kind);
}
const out = {
  _comment: "S2 全量节点字段 schema（由 tools/cst_rollout.mjs 从 src/base.tc 的 mk_* 自动抽取）。cstgen.mjs 据此生成 base.tc GEN:node-structs：逐字段独立 typed 全局切片 tbl_<RecK>_<field> + Rec<K> 结构 + cst_register_<RecK> 双写登记 + cst_get_<RecK> 读取。同 kind 多 mk_*（如 pointer）取字段并集，缺失字段补类型默认值。运行时可变全局刻意落在主程序模块 base.tc（§4.14.7）。",
  pilot: order,
  nodes,
};
writeFileSync(NODES_JSON, JSON.stringify(out, null, 2) + "\n");
console.log(`[cst_rollout] 抽取 ${mks.length} 个 mk_*，聚合为 ${order.length} 个 kind 的 schema 到 cst_nodes.json`);

// 接线：向每个 mk_* 注入双写登记（并集顺序，缺失补默认）
let patched = 0;
let baseOut = src;
for (const mk of mks) {
  const spec = nodes[mk.kind];
  if (!spec) continue;
  const R = spec.rec;
  const union = spec.fields; // [[name,type],...]
  const myAssign = new Map(mk.assigns.map((a) => [a.field, a.rhs]));
  const callArgs = union.map(([f, t]) => (myAssign.has(f) ? myAssign.get(f) : defaultFor(t)));
  const fnRe2 = new RegExp("pub\\s+fn\\s+" + mk.name + "\\s*\\([^)]*\\)\\s*i64\\s*\\{", "g");
  const mm = fnRe2.exec(baseOut);
  if (!mm) { console.error(`[cst_rollout] 接线：找不到 ${mk.name}`); continue; }
  const bodyStart2 = mm.index + mm[0].length;
  let depth = 1, j = bodyStart2, end2 = -1;
  while (j < baseOut.length && depth > 0) {
    const c = baseOut[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end2 = j; break; } }
    j++;
  }
  const body2 = baseOut.slice(bodyStart2, end2);
  if (body2.includes(`cst_register_${R}(`)) continue; // 幂等
  // 统一锚定在 `return id;` 之前，独立成行，避免与注释/标识符粘连。
  const ri = body2.lastIndexOf("return id;");
  if (ri < 0) { console.error(`[cst_rollout] 接线：${mk.name} 无 return id，跳过`); continue; }
  const insertAt = bodyStart2 + ri;
  const callLine = `    cst_register_${R}(${callArgs.join(", ")}); // S2 dual-write\n    `;
  baseOut = baseOut.slice(0, insertAt) + callLine + baseOut.slice(insertAt);
  patched++;
}
writeFileSync(BASE, baseOut);
console.log(`[cst_rollout] 已向 ${patched} 个 mk_* 注入双写登记调用（base.tc）`);
