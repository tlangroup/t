# 集合类操作符设计（Set-Ops）

> 状态：**Step 1（第一批）已落地并验证**（2026-10-17 用户拍板：布尔双拼写；值级集合运算推迟 Step 2）。
> **过渡编译器已于 2026-10-26 退役** —— 种子与主线编译器均已支持 `and`/`or`，自举链条两端同构，桥接不再需要（详见 §8）。
>
> **Step 2 第 1 小步（2026-10-26 进行中）**：先把 `src` / `tests` 的布尔拼写迁到 `and`/`or`（§9），
> 迁移路上查出并修复了**两个长期潜伏的运行期语义 bug**（`x in lo..hi` 判定整体反转、
> `s[a..=b]` 闭合区间少 1），二者此前被 conformance 全绿掩盖（conformance 只 `tc check`、不运行程序）。
> 关联：`src/opmap.tc`（`Concat`=op63）、`src/lex.tc`、`src/parse.tc`（`parse_and/or`）、`src/sema.tc`（类型分派 / comptime 折叠 / 泛型约束解析）、`lib/std/rc/cst.tc`（关键字表）。

## 1. 锁定的决策（用户 2026-10-17 拍板，含 Step 1 / Step 2 两阶段）

- **Step 1（当前批次）—— 布尔双拼写**：逻辑与同时支持 `&&` 与 `and`；逻辑或同时支持 `||` 与 `or`。`&&`/`||` 在第一步**保留为布尔**，与 `and`/`or` 完全同义。
- **Step 2（后续批次）—— 释放 `&&`/`||`**：**删除布尔运算符的 `&&` 与 `||`**，届时 `&&`/`||` 才让位给集合运算（交集 / 并集），布尔仅保留 `and`/`or`。
- **类型约束连词 `&&`（两阶段均保留）**：`T: A && B` 在类型位表示多 concept 约束合取，**由编译器内部指定逻辑 AND**，与值表达式位隔离。
- **`++` 有序合并**：值级，已实装（`sema.tc` 的 `++` 分派），作用于 string / bitstr / 数组 / map。
- **值级 `&&`/`||` 集合运算**（交集 / 并集）：**推迟到 Step 2**，不在 Step 1 实装（Step 1 中 `&&`/`||` 仅是布尔别名）。

## 2. 操作符族划分

| 族 | 符 | 语义 | 适用类型 | 现状 |
|---|---|---|---|---|
| 有序合并 | `++` | 有序合并 / 拼接 | string / bitstr / 数组 / map | ✅ 已实装 |
| bool 逻辑 | `&&` | 逻辑与（Step 1 与 `and` 同义） | bool | ✅ 已实装（Step 1） |
| bool 逻辑 | `and` | 逻辑与 | bool | ✅ 已实装（Step 1） |
| bool 逻辑 | `||` | 逻辑或（Step 1 与 `or` 同义） | bool | ✅ 已实装（Step 1） |
| bool 逻辑 | `or` | 逻辑或 | bool | ✅ 已实装（Step 1） |
| 约束连词 | `&&` | 约束合取（T: A && B，编译器内部逻辑 AND） | concept（多约束） | ✅ 已实装（T6） |
| 集合代数 | `&&` | 交集（∩） | bitstr / flag | ⬜ Step 2 |
| 集合代数 | `||` | 并集（∪） | bitstr / flag | ⬜ Step 2 |

- `bitstr` 特殊：既是位序列（可 `++` 拼接）又是位集合（Step 2 可 `&&`/`||` 交并）。
- `flag`（位标志枚举）在 Step 2 进集合代数族（`&&`/`||`），第一批不吃 `++`。
- **约束连词 `&&`** 只在 `T: A && B` 位置出现，不进值表达式分派。

## 3. `&&`/`||` 在 Step 1 的双重角色说明（消除歧义）

- **值表达式位 `a && b` / `a and b`**：Step 1 均解析为布尔 `binary(op="and")`；`a || b` / `a or b` 解析为 `binary(op="or")`。`And`/`Or` token 与 `KwAnd`/`KwOr` 关键字在值表达式位**同义**，统一产出 `"and"`/`"or"`，由 sema / codegen / tir 的布尔管线处理（`sema.tc` 的 `op=="and"||"or"` → `bool`；C 后端发射 `&&`/`||`；TIR `and`/`or` 短路）。
- **类型约束位 `T: A && B`**：`parse_type`（token `And`，类型位）把 `A && B` 收成 `binary(op="&&", A, B)` 节点；`sema.generic_normalize_func` 经 `collect_concept_constraints` 递归拆解成 concept 名列表存入侧表 `g_gpc_names`（每 pid 一个 `[]string`），实例化处（`generic_prepend_inferred_types`）逐个 concept 调 `concept_satisfied` 检查。与值表达式位隔离，无歧义。
- **Step 2 切换点**：当 Step 2 删除布尔 `&&`/`||` 后，值表达式位的 `And`/`Or` token 将改派发到集合运算（`op="&&"`/`"||"` → bitstr/flag 交并），`and`/`or` 仍为布尔。届时 `parse_and`/`parse_or` 的 `And`/`Or` 分支改回集合语义即可，类型位 `&&` 不变。

## 4. 可扩展性（对应需求 #3 / #4）—— Step 2 落地

- Step 2 集合操作符对"未处理类型"必须**结构化报错并指向扩展点**。
- Step 2 第一批落地：内置类型（bitstr / flag）由编译器提供内建实现；其它类型 → 抛 `T-SET-E*` 错误，提示实现对应 concept（`Intersect` / `Union`）。
- 完整"第三方扩展" = 把 `&&`/`||` 脱糖为 concept 方法调用 + 内建 impl。Step 2 先保证"未处理即报错 + 扩展提示"。

## 5. 编译期内建（comptime）—— Step 2 落地

- Step 2 集合操作符的**分发**在编译期完成；操作数为 comptime 已知时折叠：`&&`/`||` 对 bitstr/flag 的位运算天然可折叠（与 `&`/`|` 同机制）。

## 6. 第一批范围（Batch 1 = Step 1）

实现：
1. 关键字 `and` / `or`（bool 逻辑别名）—— ✅ 已落地（`cst.tc`：`g_kw_count` 41→43，forced 级）。
2. 值表达式位 `&&`/`||` 与 `and`/`or` **同为布尔**（`parse_and`/`parse_or`：`And`/`Or`/`KwAnd`/`KwOr` 统一产出 `"and"`/`"or"`）—— ✅ 已落地（Step 1）。
3. concept 多约束 `T: A && B`（编译器内部合取）—— ✅ 已落地（T6）。
4. `++` 有序合并 —— ✅ 既有实装。

延后（Step 2）：值级 `&&`/`||` 集合交/并（bitstr+flag）；`--` 差集、`^^` 对称差、子集 `⊆`、成员判定；map-as-set 的 `&&`/`||`。

## 7. 实现计划（任务拆分）

- **T1** `lib/std/rc/cst.tc`：`g_kw_text` / `g_kw_kind` / `g_kw_tier` 增加 `and` / `or`（`forced`），`g_kw_count` 41 → 43 —— ✅ 已完成。
- **T2** `src/parse.tc`：`parse_and` / `parse_or` 让 `And` / `Or` 与 `KwAnd` / `KwOr` 在值表达式位统一产出 `"and"` / `"or"`（Step 1 布尔同义）—— ✅ 已完成。
- **T6** `src/sema.tc`：泛型形参解析支持 `&&` 多 concept 约束（`g_gpc_names: [][]string` + `collect_concept_constraints` 递归拆解 binary("&&")；`generic_param_constraint` 返回 `[]string`；实例化处 `generic_prepend_inferred_types` 逐个 `concept_satisfied` 校验；`parse_type` 类型位吃 `And` token 收连词节点）—— ✅ 已完成。
- **Step 2 待做**：T3/T4/T5 的值级集合语义（bitstr/flag 交并 + comptime 折叠 + codegen 位运算）、T7 `T-SET-E*` 诊断（Step 2 才真正派发集合错误）、T8 迁移 examples/tests 到新布尔拼写（可选，Step 1 已保持 `&&`/`||` 布尔）。
- ✅ **Step 2 第一步「布尔拼写迁移」已完成（2026-10-26）**（拆两小步的拆法：先迁移后切换）：
  1. `src` 值位布尔全量改 `and` / `or` —— 实际只有 2 处：`src/base.tc:38`（`||` → `or`）、
     `src/base.tc:3839`（`mk_range_test` 的 `mk_binary("&&", …)` → `"and"`）。
     其余 `&&` 命中全是**类型位**（`T: A && B`，两阶段均保留）或注释，未动。
     ⚠ 类型位与值位混在同一 token，**禁止全局替换**，须逐处判位置。
  2. `tests/conformance/pass/p_setops_cast_then_bool.tc` 4 处布尔 `&&`/`||` → `and`/`or`。
  3. `p_setops_bool_spellings.tc`（Step 1 双拼写验收）**保留不动** —— 第一步 `&&` 仍为布尔，
     它要到第二步切换派发时才改写。
- ⚠ **顺带修掉的既存 bug（2026-10-26）**：`mk_range_test` 原先产 `binary("&&", …)`，而
  `"&&"` 在 `opmap.tir_op_from_str` **无映射** ⇒ 落 `OTHER=57` ⇒ 后端降级成 `add i1`；
  i1 回绕使 `true && true` 得 false（1+1=0）⇒ **`x in lo..hi` 的区间判定整体反转**
  （实测 `3 in 1..5` 为假、`3 in 10..20` 为真）。改成 `"and"` 后走短路逻辑，判定恢复正确。
  该路径此前**无任何守卫**：conformance 的 pass 用例只跑 `tc check` 不运行程序，
  examples 里也没有 `in` + 区间字面量的用例 ⇒ 新增 golden 用例 `examples/range_in_bool.tc`
  （双后端比对输出 `RANGE_IN_OK`）。
- **Step 2 第二步（待做）**：值表达式位 `And`/`Or` token 改派发集合运算（`op="&&"`/`"||"` →
  bitstr/flag 交并）+ T7 `T-SET-E*` 诊断 + 改写 `p_setops_bool_spellings.tc`。

## 8. 风险 / 成本

- Step 1 双拼写：`and`/`or` 关键字在 `src` 内**零标识符冲突**（仅出现在注释与内部 TIR 文本 `and`/`or`=位运算 op 38/39）；`&&`/`||` 仍布尔，与 `and`/`or` 完全同义。
- 自举恢复（**已退役，2026-10-26**）：过渡编译器 T'（旧 worktree `transitional` 分支 = HEAD + T1 + T2）由 seed（`out/dbg/tc.exe`）构建，再编译主仓 set-ops 源码产出 N；N 自我编译不动点（g1≡g2≡g3≡g4）已验证。
  - **退役依据**：`ci/seed/tc.exe` 于 2026-10-18 构建，**晚于 set-ops 落地（2026-10-17，提交 `17cea77`）**，实测可编译当前 `src/tc.tc`（0 error / 633 warnings）⇒ 自举链条的**起点（种子）与终点（主线编译器）都已支持 `and`/`or`**，桥接失去存在意义。
  - **处置**：worktree `t_transitional` 与分支 `transitional` 已删除；桥接改动留档 `.workbuddy/transitional_setops_bridge_wip_2026-10-26.patch`，原 tip 钉在 `backup/transitional-setops-2026-10-26`。
  - **对 Step 2 的影响**：Step 2 删除布尔 `&&`/`||`（§1）后，源码布尔全量改用 `and`/`or` —— 仍落在种子能力范围内，**无需重建桥接**。
- Step 2 切换需注意：值表达式位 `&&`/`||` 改派发集合运算时，须确保与类型位约束 `&&` 隔离（`T: A && B` 不触发集合分派）。

## 9. Step 2 第 1 小步：布尔拼写迁移 + 两个运行期 bug（2026-10-26）

### 9.1 迁移范围（已完成）
按「先迁移后切换」拆法，第 1 小步只把布尔 `&&`/`||` 改成 `and`/`or`，此时值位语义未变、可独立验证：

| 位置 | 改动 |
|---|---|
| `src/base.tc:34` | `id < 0 \|\| id >= ...` → `or` |
| `src/base.tc`（`mk_range_test`） | `mk_binary("&&", lo_t, hi_t)` → `mk_binary("and", ...)` |
| `tests/conformance/pass/p_setops_cast_then_bool.tc` | 注释与用例内的 `&&`/`\|\|` → `and`/`or` |

⚠ **不能全局替换**：`src`/`tests` 里混着类型位约束 `T: A && B`，须逐处判位置（本轮实际值位 `&&` 仅 1 处真需要改）。

### 9.2 查出并修复的两个运行期 bug

二者都被 **conformance 383/383 全绿** 掩盖 —— `tools/conformance.mjs` 对 `// EXPECT: pass` 用例
**只跑 `tc check`、从不执行程序**，运行期语义零覆盖。

**Bug A — `x in lo..hi` 判定整体反转**
- 现象：`5 in 1..10` 得 `0`、区间外反而得 `1`（探针 `IN=0 OUT=1 EDGE_LO=1 EDGE_HI=1`）。
- 根因：`mk_range_test` 合成的是 `binary("&&")`，而 `src/opmap.tc` **没有 `&&` 的映射** ⇒ 落到 `OTHER`(=57)
  ⇒ 后端把合取发射成 `add i1` 而非 `and i1`；`1 add 1` 在 i1 上回绕为 `0`。
- 修复：`mk_range_test` 改用 `"and"`（opmap 有映射）。
- 守卫：新增 `examples/range_in_bool.tc` + `.expected.txt`。

**Bug B — `s[a..=b]` 闭合区间少 1（且「字面量错、变量对」）**
- 现象：`msg[6..=8]` 得 `"wo"`(2) 而非 `"wor"`(3)；`1..=4` 物化得 3 个元素而非 4；
  但端点换成变量 `msg[lo..=hi]` 时**正确**；`for (i in 0..=3)` 与 `5 in 5..=5` 也正确。
- 根因链：
  1. `rng_excl_hi` 合成 `mk_binary("+", hi, rng_lit(1))` 把闭合上界抬成 `hi+1`；
  2. `comptime_fold_pass()` 在 `sema.run_check()` **之后**运行（`src/tc.tc` 三处调度均是），
     会遍历到 sema 期合成的节点并折叠；
  3. `rng_lit(1)` 是合成字面量、**未经 infer** ⇒ 折叠期右操作数被当成 `0` ⇒ `8+1` 折成 `8`；
  4. 端点含变量时该 `+` 含运行期引用，`comptime_has_runtime_ref` 使其跳过折叠 ⇒ 反而正确 ——
     这正是「字面量错、变量对」的来源。
- 修复：`rng_excl_hi` 对 **int 字面量端点直接算出字面量**（`lit_u64(node_sa)+1`，并带走 `sb` 位宽后缀保类型），
  不再合成二元节点，天然免疫该折叠；非常量端点仍走 `+` 路径。
  - ⚠ 教训：字面量的**权威值在 `sa`**（sema 自身推断 int 类型也是 `lit_u64(node_sa)`），
    不要读 `ia` 槽 —— 首版修复误用 `ia` 得到常数 11，反而更错。
- 守卫：新增 `examples/range_inclusive.tc` + `.expected.txt`（覆盖索引 / 切片 / 物化 / for / in 五条路径）。

### 9.3 验证
- `tc check src/tc.tc`：0 error / 633 warnings（与基线一致）。
- 自举不动点：g→g1→g2 IR md5 相同（`147223e7…`）；修复后自举同样通过。
- `tests/conformance/pass/p48_range_ok.tc` 单独运行：退出码 **1 → 0**（此前唯一失败项 `str_ranges()=28` 转绿）。
- conformance **383/383**。
- examples 双后端 **101/101**（含新增两个 golden；`concat_demo` 批量并发下 720s 超时属环境 flake，单跑 EXIT=0 且输出逐字一致）。
- 种子 `ci/seed/tc.exe` 仍可编译当前源码（0 error / 633 warnings）⇒ 无需刷新。
- IR 快照：`ir_snapshot` 报 8 处 example DIFF + 2 处 `src/tc.tc` DIFF。用**改动前**编译器（`ci/seed/tc.exe`）
  与改动后 `tc.exe` 对同一目标对拍 `emit-ll` ⇒ 4 个 example **0 行差异** ⇒ 与本次改动无关，
  是基线相对当前 HEAD 的既有漂移（基线末次重录于 `d3a8fe6`，其后 merge 未重录）；
  `src/tc.tc` 的 2 处才是源码改动所致。判据 0 GONE / NEW 仅为新增 golden ⇒ 重录
  （136 targets / 275 entries）。
  ⚠ 基线**必须用 gate 的 g1 录**（`ir_snapshot --compiler out/dbg/g1.exe --update`）；
  先用 `bootstrap_tc` 产出的 `tc.exe` 录，会让 3 个 `@import("std.*")` 示例 × 双后端报 6 处 DIFF
  （实测 g1 与 tc.exe 对这 3 例输出**逐字相同** ⇒ 差异来自录制时 `.tlib` 的时序状态，非编译器差异）。
- **gate L2 最终验收：24 passed / 0 failed（3397.7s）**；四代自举产物已安装为 `out/dbg/tc.exe`（md5 `5ad181ee…`）。
- ⚠ 附带修的一处基础设施：`src/base.tc` 的 `GEN:node-structs` 生成区（28–1635 行）内也有 `||`，
  手改会让 gate「CST kind 清单一致性」步 FAIL ⇒ 已同步改 `tools/cstgen.mjs:145` 模板并 `--emit` 重生成。
  ⭐ Step 2 第 2 小步（`&&`/`||` 全量退场）须连生成器模板一起扫。
