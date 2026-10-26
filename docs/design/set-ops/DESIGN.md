# 集合类操作符设计（Set-Ops）

> 状态：**Step 1（第一批）已落地并验证**（2026-10-17 用户拍板：布尔双拼写；值级集合运算推迟 Step 2）。
> **过渡编译器已于 2026-10-26 退役** —— 种子与主线编译器均已支持 `and`/`or`，自举链条两端同构，桥接不再需要（详见 §8）。
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

## 8. 风险 / 成本

- Step 1 双拼写：`and`/`or` 关键字在 `src` 内**零标识符冲突**（仅出现在注释与内部 TIR 文本 `and`/`or`=位运算 op 38/39）；`&&`/`||` 仍布尔，与 `and`/`or` 完全同义。
- 自举恢复（**已退役，2026-10-26**）：过渡编译器 T'（旧 worktree `transitional` 分支 = HEAD + T1 + T2）由 seed（`out/dbg/tc.exe`）构建，再编译主仓 set-ops 源码产出 N；N 自我编译不动点（g1≡g2≡g3≡g4）已验证。
  - **退役依据**：`ci/seed/tc.exe` 于 2026-10-18 构建，**晚于 set-ops 落地（2026-10-17，提交 `17cea77`）**，实测可编译当前 `src/tc.tc`（0 error / 633 warnings）⇒ 自举链条的**起点（种子）与终点（主线编译器）都已支持 `and`/`or`**，桥接失去存在意义。
  - **处置**：worktree `t_transitional` 与分支 `transitional` 已删除；桥接改动留档 `.workbuddy/transitional_setops_bridge_wip_2026-10-26.patch`，原 tip 钉在 `backup/transitional-setops-2026-10-26`。
  - **对 Step 2 的影响**：Step 2 删除布尔 `&&`/`||`（§1）后，源码布尔全量改用 `and`/`or` —— 仍落在种子能力范围内，**无需重建桥接**。
- Step 2 切换需注意：值表达式位 `&&`/`||` 改派发集合运算时，须确保与类型位约束 `&&` 隔离（`T: A && B` 不触发集合分派）。
