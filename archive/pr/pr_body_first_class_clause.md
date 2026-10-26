## 概述

把 **子句（clause）** 提升为**编译期一等值**：`clause` 成为独立类型，`@clause(...)` 字面量可被命名、组合（`++`）、传入函数、在 `match` 臂位展开。全特性共 16 个节点（N1–N16），分三批落地，全部完成。

设计文档：`docs/compiler/first-class-clause.md`（§9.0 含 N1–N16 状态表与 P1–P11 踩坑记录）。

## 能力清单

**Phase 1 — 值层**
- `@clause(<类别>, <pattern>, [when <守卫>,] <body>)` 字面量；通配形态 `_`；
- `clause` 作为**编译期一等类型**（独立 TI 种类 `Clause`，非未解析 Named）；合成枚举 `ClauseKind`（成员 `pattern`）；
- `const C = @clause(...)` **无需显式标注 `: clause`**（对 clause 定向回填符号类型，与其他 const 保持一致）；
- `[N]clause` 字面量与 `++` 组合复用既有 Array 分支（`ti_equal` + `[N+M]`）；
- clause 出现在运行期位置（`var` / 结构体字段 / 运行期返回 / 全局 var）⇒ `T-CLA-E724`。

**Phase 2 — 展开 / 重排 / 排重 / 函数化**
- `match (x) { G }`：臂位裸表达式承接 `[N]clause` 组 ⇒ 在 `parse_unit` 末尾（**HIR 之前**）展开为既有 `MatchArm` 链；
- **不可反驳 clause 重排到末位**充当 `else` —— 判据为「无守卫 **且** pattern 是标识符」，即 `_` 通配**或**裸绑定；
- **排重**：首个不可反驳 clause 之后被完全遮蔽的子句丢弃 + `T-CLA-W727`（仅告警）；
- **函数化** `fn f(x: T) R = G;`：体脱糖为 `return match (x) { G };`（此前 `= <expr>` 在函数体位是解析错误 ⇒ 空位利用）。

**Phase 3 — clause 形参**
- 含 clause 形参 ⇒ 函数**自动升为编译期**（`N14`），按实参单态化生成运行期实例；
- clause 形参的实参必须能在编译期求值，否则 `T-CLA-E726`（`N15`）；
- 三组探针（`N16`）：① 同一 G 换 scrutinee 结果不同 ② 换 group 得到不同实例 ③ 当运行期函数值传入 ⇒ `T-CLO-E781`。

**诊断**：新增 `T-CLA` 类别（720–739），`TIM` 由 700–739 收缩为 700–719 与 `CLA` 共享百年段（既有 LEX/ICE 先例，TIM 实码最大 E703 不受影响）。启用码：`E720` 形态 / `E721` 未知类别 / `E722` pattern 混杂 / `E723` 不是子句组或类型不符 / `E724` 逃逸 / `E726` 实参非常量 / `W727` 遮蔽。

## 验证

- `tc check src/tc.tc`：**0 errors / 633 warnings**（告警集合与改动前逐条一致，差集为空）；
- conformance：**383 / 383**（新增 10 例：pass 4 + fail 6）；
- 自举不动点：`g1 ≡ g2 ≡ g3`（md5 `efb04905…` 三代逐字节一致）；
- **gate L2：23 passed / 1 failed**，唯一失败 = 「产物快照比对」（改 `src` 的预期偏差）；
  ⇒ IR 快照判据 `2 差异 / 2 新增 / **0 缺失**` ⇒ `--update` 重录 134 targets / 271 entries，复查 **271 份产物逐字节相同** ⇒ 快照步等价 **PASS = 24/24**；
- `seed:check`：**OK**（`ci/seed/tc.exe` md5 `7bca0633…` 可编当前 `src/tc.tc`，0 error / 633 warnings）⇒ CI / nightly 自举起点未过期；
- 运行期对拍：`examples/clause_expand.tc` → `10 11 -1 99 -2`、`clause_fn.tc` → `10 11 -1 50 0`、`clause_param.tc` → `10 -1 -5 99`，均 == 期望。

## 实现要点（三条可复用通则）

1. **HIR 要「降级成无害」不能「跳过」**：clause 声明必须走 `hir_build`/`hir_sync`（跳过会丢 sema 符号 ⇒ 静默空洞），降级为 `HIR_OP_BLOCK`；**只有 tir 可跳过发射**（靠 `base.g_clause_const_ids` 标记表）。
2. **脱糖必须落在它该在的那一趟**：parse 期产物（臂位展开）挂 `parse_unit` 末尾；check 期产物（单态实例）挂 `instantiate_generic`。
3. **新类型绝不要走未解析 Named**（曾导致 0 error 静默放行）；**单态 key 必须真能区分实参**（`meta_val_key` 会回落去哈希空 `sa` ⇒ 不同 group 撞 key ⇒ 静默错结果；改用 `clause_group_key` 按实参 span）。

## 已知约束

- 内联 `GA ++ [C]` 直接当 clause 实参 ⇒ `T-CLA-E726`（meta 折不出组值）；先存成具名 `const` 即可。
- `match` 的 ret_exp 静态类型一致、pattern 与 scrutinee 类型匹配，均**在展开点**才检查，脱离 scrutinee 无从推断。

## 清理

- 移除误入库的 `runtime/_debug.log`（t_runtime 写出的运行期调试日志），并在 `.gitignore` 加 `_debug.log` 护栏；
- 删除已合并进 `wb` 的 4 个特性分支（`feat/clause`、`feat/clause-expand`、`feat/clause-fn`、`feat/clause-param`）。
