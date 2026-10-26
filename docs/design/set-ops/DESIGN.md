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
- **Step 2（2026-10-26 已落地，见 §10）—— 释放 `&&`/`||`**：值表达式位的 `&&`/`||` **不再是布尔**，改派集合交 / 并；布尔只保留 `and`/`or`。
- **类型约束连词 `&&`（两阶段均保留）**：`T: A && B` 在类型位表示多 concept 约束合取，**由编译器内部指定逻辑 AND**，与值表达式位隔离。
- **`++` 有序合并**：值级，已实装（`sema.tc` 的 `++` 分派），作用于 string / bitstr / 数组 / map。
- **值级 `&&`/`||` 集合运算**（交集 / 并集）：**推迟到 Step 2**，不在 Step 1 实装（Step 1 中 `&&`/`||` 仅是布尔别名）。

## 2. 操作符族划分

| 族 | 符 | 语义 | 适用类型 | 现状 |
|---|---|---|---|---|
| 有序合并 | `++` | 有序合并 / 拼接 | string / bitstr / 数组 / map | ✅ 已实装 |
| bool 逻辑 | `&&` | ~~逻辑与~~ **Step 2 起不再作布尔**，让位给集合交集 | — | ⛔ 已移除（Step 2） |
| bool 逻辑 | `and` | 逻辑与 | bool | ✅ 已实装 |
| bool 逻辑 | `||` | ~~逻辑或~~ **Step 2 起不再作布尔**，让位给集合并集 | — | ⛔ 已移除（Step 2） |
| bool 逻辑 | `or` | 逻辑或 | bool | ✅ 已实装 |
| 约束连词 | `&&` | 约束合取（T: A && B，编译器内部逻辑 AND） | concept（多约束） | ✅ 已实装（T6） |
| 集合代数 | `&&` | 交集（∩） | bitstr / 位域（packed struct） | ✅ 已实装（Step 2） |
| 集合代数 | `||` | 并集（∪） | bitstr / 位域（packed struct） | ✅ 已实装（Step 2） |

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

延后（Step 2）：值级 `&&`/`||` 集合交/并（bitstr+flag）✅已落地；
**差集 / 对称差 / 子集判定 / 成员判定 / map-as-set —— 未排期，且符号拼写尚未拍板**（见 §12）。

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
- ✅ **Step 2 第二步已完成（2026-10-26，详见 §10）**：值表达式位 `And`/`Or` token 改派发集合运算
  （`op="&&"`/`"||"` → bitstr 交并）+ T7 `T-SET-E*` 诊断 + 改写 `p_setops_bool_spellings.tc`。
  ✅ 位域（packed struct）交并已随 §11 实装（2026-10-26）。

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

## 10. Step 2 第 2 小步：释放 `&&`/`||` 为集合运算符（2026-10-26）

### 10.1 语义裁定（本批锁定的三个决定）

| 议题 | 裁定 | 理由 |
|---|---|---|
| 不同位宽的 bitstr 交并 | 结果位数 = **max(a.bit_len, b.bit_len)**，较短一侧按**零扩展**对齐 | 位串表示"位位置集合"时，缺失的高位本就是"不含该成员"，零扩展即集合语义的自然写法；也与整数隐式零扩展一致 |
| `&` / `\|` 对 bitstr | 与 `&&` / `\|\|` **同一条通路**（位串上两者语义本就相同） | 顺带补齐"类型检查放行、后端产出非法 IR"的静默错编缺口，比单纯报错更有用 |
| flag（位标志） | 本批不实装，报 `T-SET-E101/E102`；**已在 §11（2026-10-26）实装为位域 `packed struct`** | ① `flag` 声明关键字已被积类型统一废弃（改用 `packed struct`），本设计的"flag"前提已变；② 后端表示不一致（LLVM `%Perm = type { i16 }` 值 vs C 端 `unsigned char*` 按指针传），无"取底层整数"的现成通路 ⇒ 当时判为需单开一批 |

### 10.2 改动清单

| 位置 | 改动 |
|---|---|
| `runtime/t_runtime.{h,c}` | 新增 `t_bitstr_and` / `t_bitstr_or`（共用 `t_bitstr_setop`，零扩展到 max） |
| `runtime/t_shim_ll.c` | 新增 `tll_bitstr_and` / `tll_bitstr_or`（**out 排末位**，与 `tll_str_concat` 同构） |
| `src/parse.tc` | `parse_and` / `parse_or`：`And`/`Or` 产出 `"&&"`/`"\|\|"`（集合），`KwAnd`/`KwOr` 产出 `"and"`/`"or"`（布尔）。⚠ op 必须在 `advance_i()` **之前**判定 |
| `src/opmap.tc` | `tir_binop` 补 `"&&"`→`and`、`"\|\|"`→`or`；`tir_op_from_str` 同步补映射 |
| `src/sema.tc` | 值位集合分派：bitstr×bitstr → `BitStr`；其余类型 → `T-SET-E101`（交）/`T-SET-E102`（并），提示实现 `Intersect`/`Union` concept；bitstr 的 `^` → `T-SET-E103` |
| `src/tir_to_ll.tc` | 位运算发射前拦截 `%TBitStr` → `call void @tll_bitstr_and/or(a, b, out)` |
| `src/codegen_c_tmir.tc` | 同上拦截（须排在 `dst = (` 前缀发射**之前**）→ `t_bitstr_and(a, b)`（C 端 `t_*` 按值返回） |
| `tests/conformance/fail/f_setops_bool_{intersect,union}.tc` | 新增：bool 上用 `&&`/`\|\|` 报结构化错误 |
| `tests/conformance/pass/p_setops_bitstr_setops.tc` | 新增：bitstr 集合运算类型检查 |
| `tests/conformance/pass/p_setops_bool_spellings.tc` | 改写：去掉 `&&`/`\|\|` 布尔断言，只留 `and`/`or` |
| `examples/setops_bitstr.{tc,expected.txt}` | 新增运行期 golden（交 / 并 / 零扩展三条路径，双后端对拍） |
| `docs/**/*.tc`（2 处） | 示例代码布尔拼写迁移 |

### 10.3 本批踩到的三个坑（值得记住）

1. **opmap 缺映射 = 静默降级**（与 §9 Bug A 同款）：`tir_binop` 缺 `"&&"` 会落 `unsupported_binop`。
   凡新增值级运算符，**必须同时补 `tir_binop` 与 `tir_op_from_str` 两张表**。
2. **shim 参数顺序**：LLVM 轨 `tll_*` 一律 **out 排末位**（同 `tll_str_concat`）。本批首版误写成 `(out,a,b)`，
   实测后果是 `a && b` **把结果写进左操作数 `a`**（`a` 被清零、结果槽空转），且不报错 —— 典型的静默错编，
   只能靠双后端对拍发现（C 端正确、LLVM 端 `a=0`）。
3. **槽类型必须用规范形式 `%TBitStr`**：登记成无 `%` 的形式会让后续「结果槽 → 变量槽」的拷贝解析出空类型
   （`load , ptr` 非法 IR）。

### 10.4 验证
- `tc check src/tc.tc`：0 error / 633 warnings（与基线一致）。
- 双后端对拍：`examples/setops_bitstr.tc` → `AND=128 OR=255 ZEXT=160`，LLVM 与 tmir-c **逐字相同**
  （179 & 204 = 128、179 \| 204 = 255、179 & 224 = 160）。
- conformance **386 / 386**（原 383 + 本批新增 3：bool 交 / 并报错各 1、bitstr 集合运算 1）；
  类型位 `T: A && B` 的多概念用例（`p_setops_multiconcept_ok` / `f_setops_multiconcept_fail`）保持原判据不受影响。
- examples 双后端 **102 / 102**。
- 种子体检通过（`08046b37…` 仍可编译当前 src，0 error / 633 warnings）⇒ 无需刷新。
- **gate L2：24 passed / 0 failed（3458.8s）**，其中自举不动点 `g2 == g3`、`g2 == g3 == g4`、
  C 后端自举、run_examples 双后端、difftest 代际对拍均 PASS。
- IR 快照基线重录（137 targets / 277 entries，用 gate 的 g1 录）：漂移为
  `src/tc.tc::{c,ll}` 2 处 DIFF（编译器自身源码变更）+ 新增 golden 的 2 条 NEW，**0 缺失**；
  且**没有任何既存 example 的 IR 变化** ⇒ 新语义未影响既有行为。
- 四代产物已安装为 `out/dbg/tc.exe`（md5 `b0f4daef…`）。

## 11. Step 2 第 3 小步：位域（packed struct）集合交 / 并（2026-10-26）

§10.1 曾把位域判为"需单开一批"，理由是两后端表示不一致、且无"取底层整数"的现成通路。
本批结论：**那条通路其实早就有了**（packed 成员读写与字面量构造各用一半），拼起来即可，
且不需要任何 runtime shim —— 见 §11.2。

### 11.1 语义裁定

| 议题 | 裁定 | 理由 |
|---|---|---|
| 交 / 并的语义 | **宿主整型 AND / OR** | 位域整体就是"位位置集合"，各字段占互不重叠的位段 ⇒ 等价于**逐字段的位与 / 位或**（实测 `Perm{...} && Perm{...}` = 逐字段取小者，`\|\|` = 取大者） |
| 两侧类型 | 必须是**同一个**位域类型；不同 → `T-SET-E104` | 位域是名义类型、位宽由布局定死，没有 bitstr 那种"取 max + 零扩展"的依据；跨位域类型时"谁的第 3 位对应谁的哪一位"无良定义 |
| 结果类型 | = 该位域类型（不做位宽提升） | 同上：布局定死，`max(a,b)` 无从谈起 |
| padding 位（`total .. host_bits-1`） | **不额外掩码**，原样参与运算 | 与 P8 的 `flag_set` / `flag_get` 一致（宿主字本就当通用位容器用）；且零成本 |
| `&` / `\|` | 与 `&&` / `\|\|` **同一条通路** | 同 bitstr 的处理：补齐"类型检查放行、后端产出非法 IR `and %Perm`"的静默错编缺口 |
| `^` | 不支持 → `T-SET-E103`（bitstr）/ `T-SET-E105`（位域）；两侧位域类型不同 → `T-SET-E104` | 差集 / 对称差未排期且**符号拼写未拍板**（§12）；判定按**任一侧**收口，此前单侧情形 0 error 却在后端产出非法 IR `xor %Perm`。报错文案**不指名**未设计的符号 |

### 11.2 关键实现选择：在 **TIR 层**降，不在后端拦

与 §10（bitstr 走 runtime shim）不同，本批**没有**写两套后端拦截，而是在 `src/tir.tc`
的 `tir_emit_binary` 里把 `&&` / `||` / `&` / `|` 展开成三段式：

```
ADDR_OF (ptr<%Perm>) → GEP[0,0] → LOAD hostst   // 抽宿主整型（两侧各一份）
AND / OR  hostst                                 // 位运算
STRUCT_NEW %Perm ← hostst                        // 裹回聚合
```

理由：这三段正是 packed 成员读写（P5）与 packed 字面量构造（P5）**已在双后端验证过**的通路
（含那条 `ptr<%Name>` 的 ADDR_OF 槽型修正 —— 宿主整型 < 8 字节时按值分配会被 8 字节指针写穿栈）。
一次实现两端同构：实测两个后端**首次运行即逐字相同**，没有出现 §10.3 那类"只有单后端才看得见"的坑。

> 推论（可复用的经验）：凡是 packed 相关的新语义，先找 TIR 层已有的等价指令序列拼装，
> 而不是新增 shim —— shim 要同时照顾 C 端按值返回与 LLVM 端 sret 两套约定，
> 那儿才是 `out` 参位置写反、静默写进左操作数这类 bug 的温床（§10.3 坑 2）。

### 11.3 踩到的坑：判别式选错 = 功能静默不生效

首版用 `tip_is_flag()` 判别位域：**编译通过、0 error，但功能完全不生效**
（`Perm && Perm` 照旧报 `T-SET-E101`）。

- `tip_is_flag` 判的是 `TI.kind == "Struct" && TI.und != ""`；
- 但 `und` 现在**只有 Enum 声明会写**（`ti_with_und` 的唯一调用点在 enum decl）。
  `flag` 关键字 P7 移除后，packed struct 走 `ti_named`，`und` 恒空 ⇒ 该判据**恒假**。
- 改用新增的 `tip_is_packed()`：`mb_type_decl(tip_name(ti))` 取声明节点，判 `node_sb(d) == "packed"`。
  ⚠ 不用 `pk_find_struct`（布局池）：它在 `check_struct_decl` 时才填充，sema 期遇到
  "函数在前、packed 声明在后"的次序会漏判；`lex__decl_list` 是词法期全量收集，无次序问题。

**教训**：判别式"看起来对 + `tc check` 全绿"不等于生效。凡"某个分支应该被走进"的改动，
必须用**能观察到结果差异**的最小用例验证（本例即 `var c: Perm = a && b;` 还报不报错），
而不是只看编译器自身检查通过 —— 这类 bug 不会报错，只会让新功能悄悄变成死代码。

### 11.4 改动清单

| 位置 | 改动 |
|---|---|
| `src/sema.tc` | 新增 `tip_is_packed()`；集合分派：同位域类型 → 该类型；跨位域 → `T-SET-E104`；单侧位域 → `E101` / `E102`（顺带收口 `&` / `\|` 的静默缺口）；位域 `^` → `E105` |
| `src/tir.tc` | `tir_emit_binary` 拦截 + `tir_packed_bin_ty` / `tir_packed_setop` / `tir_packed_host_st` / `tir_packed_host` 四个辅助 |
| `tests/conformance/pass/p_setops_packed_{intersect,union}.tc` | 新增 2 |
| `tests/conformance/fail/f_setops_packed_{mixed,xor,half}.tc` | 新增 3（`E104` / `E105` / `E101`） |
| `examples/setops_packed.{tc,expected.txt}` | 新增运行期 golden：u8 / u16 / u64 三种宿主宽度 + 嵌套 + `&` / `\|` + 自检 |

### 11.5 验证
- `tc check src/tc.tc`：0 error / **635** warnings（+2 为本批新增 `tip_is_packed` / `tir_packed_*` 的命名告警）。
- 双后端对拍：`examples/setops_packed.tc` LLVM 与 tmir-c **逐字相同**：

  ```
  perm && r=1 w=0 lv=3 own=42      交：逐字段位与（r 1&1、w 1&0、lv 7&3、own 42&42）
  perm || r=1 w=1 lv=7 own=42      并：逐字段位或
  perm  & r=1 w=0 lv=3 own=42      `&` 与 `&&` 同义
  perm  | r=1 w=1 lv=7 own=42      `|` 与 `||` 同义
  perm nest r=1 w=1 lv=7 own=42    嵌套 (a && b) || (a || b)
  tiny && a=1 b=0 c=0              宿主 u8：0b101 & 0b011
  tiny || a=1 b=1 c=1              宿主 u8：0b101 | 0b011
  wide && lo=33818120 hi=40        宿主 u64：0x12345678 & 0x0F0F0F0F = 0x02040608；0xAB & 0x3C = 0x28
  wide || lo=524246911 hi=191      宿主 u64：0x12345678 | 0x0F0F0F0F = 0x1F3F5F7F；0xAB | 0x3C = 0xBF
  setops_packed OK
  ```

  三种宿主宽度（u8 / u16 / u64）全覆盖 —— 宿主 < 8 字节正是 P5「ADDR_OF 槽按值分配会写穿栈」的敏感路径。
- conformance **391 / 391**（386 + 本批 5）。
- 种子体检通过（`08046b37…` 仍可编译 src，0 error / 635 warnings）⇒ 无需刷新。
- IR 快照基线重录（**138 targets / 279 entries**，用 gate 的 g1 录）：2 处 DIFF（`src/tc.tc::{c,ll}`）
  + 2 条 NEW（`examples/setops_packed.tc::{c,ll}`），**0 缺失**，且**无任何既存 example 的 IR 变化**。
- **gate L2：24 passed / 0 failed（2422.6s）**；自举不动点 `g2==g3`、`g2==g3==g4`、C 后端自举、
  run_examples 双后端（103/103）、conformance、difftest 代际对拍、MIR differential 全绿。
- 四代产物已安装为 `out/dbg/tc.exe`（md5 `96c03c71…`）。
- ⚠ 批量并发下 `concat_demo` 偶发 720s 超时属**已知环境 flake**（单跑 EXIT=0 且输出逐字一致），
  本批 103 例在门禁内全绿。

## 12. 差集 / 对称差：未排期，且符号拼写未拍板

### 12.1 这些符号是怎么来的（澄清来源）

`--` 差集、`^^` 对称差、`⊆` 子集、成员判定这一串**不是用户的需求，也不是拍板项**——
它们是 2026-10-17 首次创建本文档时，由实现方在"延后清单"里**顺手列举的候选名**。

用户 2026-10-17 拍板的只有 §1 三条：布尔双拼写、`&&`/`||` 释放给集合、`++` 有序合并。
差集 / 对称差**从未进过拍板清单，也没有任何语义定义**：

| 查什么 | 结果 |
|---|---|
| lexer token 表里的 `^^` / `--` | 无 |
| 源码里 `op == "--"` / `"^^"` | 零命中 |
| 位宽对齐 / 适用类型 / 优先级 / 与 `^` 的关系裁定 | 全无 |

⇒ 它们当前的真实身份只是**纸面候选名**，连"是否采用这个拼写"都还没定。

### 12.2 由此引出的一个缺陷（本批修复）

实现方曾把这个**未设计**的符号名写进了**面向用户的报错文案**：

```
T-SET-E103  位串暂不支持 `^`：对称差运算符 `^^` 属后续批次，当前可用 `&&`（交）/ `||`（并）
T-SET-E105  位域暂不支持 `^`：对称差运算符 `^^` 属后续批次，...
```

用户撞到 `^` 报错时，会被指向一个**根本不存在、也没定义过拼写**的 `^^` ——
等于对未定项做承诺。本批已改为**不指名**：

```
位串不支持 `^`：集合代数当前只提供 `&&`（交）与 `||`（并）；差集 / 对称差的运算符留待后续批次设计
```

> 原则：**报错文案不得承诺尚未设计的语法**。要提"后续批次"可以，但不能替未来的设计先定符号。

### 12.3 顺带修掉的真 bug：`^` 的单侧静默错编缺口

上一批收口 `&` / `|` 时用的是**任一侧**判定（单侧位域报 `T-SET-E101/E102`），
但 `^` 沿用了**两侧**判定 ⇒ 单侧情形漏网。实测（修复前）：

| 表达式 | `tc check` | 实际后果 |
|---|---|---|
| `Perm ^ i64` | **0 error** | LLVM 校验期炸：`%main.llt30 = xor %Perm %main.llt28, %main.llt29` —— `'i64' but expected '%Perm'` |
| `i64 ^ Perm`（赋给 i64） | **0 error** | 同上族 |
| `bitstr ^ i64` | **0 error** | 后端产出 `xor %TBitStr` |
| `i64 ^ bitstr` | **0 error** | 同上 |

这正是本项目反复出现的那类 bug：**类型检查放行、后端产出非法 IR，且不报错**。
本批把 `^` 的判定统一为「任一侧是 bitstr / 位域即报错」：

- 任一侧 bitstr → `T-SET-E103`
- 两侧位域但类型不同 → `T-SET-E104`（与 `&&`/`||` 同口径：类型不匹配比"`^` 不支持"更根本）
- 其余（含单侧位域、同位域类型）→ `T-SET-E105`

### 12.4 真要做差集 / 对称差时，必须先拍板的清单

1. **拼写**：`--` / `^^` 只是候选，未定。需先确认它们不与既有词法冲突。
2. **位宽对齐**：沿用交并的"max + 零扩展"（bitstr），还是要求同类型（位域）？差集两侧的
   对齐规则与交并是否一致？
3. **适用类型**：bitstr 与位域是否同规则？map-as-set 要不要一起上？
4. **与 `^` 的关系**：`^` 现在对集合类型是**错误**。将来若上对称差，是让 `^` **转正**
   （那本批的 E103/E105 就是临时态，需重新评估），还是另立 `^^` 而 `^` 永久报错？
   ⚠ 这条必须**先定** —— 它决定了现在的报错是"暂不支持"还是"设计如此"。
5. **子集 / 成员判定**：返回 bool，运算符形态与判据（`⊆` 用什么字符？`in` 复用？）。

### 12.5 同类缺陷（一并修复）：E101 / E102 指向未实装的 concept

排查 `^^` 时发现 `T-SET-E101` / `E102` 的文案有**同款**问题，且多一条过时：

```
旧：...；内建实现目前只覆盖 bitstr，其它类型请实现对应 concept `Intersect` 后再使用
                    ^^^^^^^^^^^^^^^^^^^^^^ 过时（位域已支持）    ^^^^^^^^^ 该 concept 查无实装
```

- `Intersect` / `Union` 作为**集合扩展点**在 `src` / `lib` 里**查无实装**
  （grep 命中的 `Union` 全是"Union 类型种类"，与集合代数无关）。
  指向它等于让用户去实现一个**根本不存在**的扩展机制 —— 与 `^^` 同款。
- "只覆盖 bitstr" 是上一批的措辞，位域落地后已过时。

已改为：

```
...；内建实现目前只覆盖 bitstr 与位域（packed struct）（布尔逻辑请用 `and` / `or`）
```

> 由此得到一条**可复用的判据**：报错文案里出现的每一个符号名 / concept 名 / 扩展点，
> 都必须是**当前已存在**的东西。写文案时顺手 grep 一次，否则就是在给用户指一条死路。
> 这类问题不会让任何测试变红（conformance 只判诊断码，不判消息文本），只能靠人工核。

### 12.6 验证
- `tc check src/tc.tc`：0 error / 635 warnings（与本批前一致 —— 改动只在字符串常量与判定条件）。
- 探针复核（修复前 → 修复后），6/6 全部从"静默放行"转为结构化报错：

  | 表达式 | 修复前 | 修复后 |
  |---|---|---|
  | `Perm ^ i64` | 0 error → LLVM 校验期炸 `xor %Perm` | `T-SET-E105` |
  | `i64 ^ Perm`（赋给 Perm） | 0 error（撞对成 E202） | `T-SET-E105` |
  | `i64 ^ Perm`（赋给 i64） | 0 error | `T-SET-E105` |
  | `bitstr ^ i64` | 0 error → `xor %TBitStr` | `T-SET-E103` |
  | `i64 ^ bitstr` | 0 error | `T-SET-E103` |
  | `Perm ^ Mode`（跨位域） | `T-SET-E105`（文案误导） | `T-SET-E104`（与 `&&`/`||` 同口径） |

- conformance **394 / 394**（391 + 本批 3：`f_setops_bitstr_xor_half` / `f_setops_packed_xor_half` /
  `f_setops_packed_xor_mixed`）。既有用例的 EXPECT 只判诊断码、不判消息文本 ⇒ 改文案不影响判据。
- 种子体检通过（`08046b37…` 仍可编译 src）⇒ 无需刷新。
- IR 快照基线重录（138 targets / 279 entries，用 gate 的 g1 录）：**2 处 DIFF（`src/tc.tc::{c,ll}`）、
  0 新增、0 缺失** —— 本批未新增 example，漂移全部来自编译器自身源码。
- **gate L2：24 passed / 0 failed（3282.3s）**；自举不动点 `g2==g3`、`g2==g3==g4` PASS；
  C 后端自举、difftest、MIR differential、rls 快速通道、tc lint 冒烟全绿。
- 四代产物已安装为 `out/dbg/tc.exe`（md5 `6d99030c…`），复核 0 error / 635 warnings。

## 13. 「统一集合运算符」提案审查与替代方案（2026-10-26，**提案 / 待用户拍板**）

> 本节不是已落地结论。它记录对用户提案（`+{T1,T2}` / `&{...}` / `|{...}` 前缀花括号形态取代
> `++` / `&&` / `||`，在**值 / 类型 / clause** 三个域统一）的审查，以及一个替代解的形态。
> 遵循 §12.5 的判据：**本节不引入任何新记号**，用到的 `&` / `|` / `++` 全部是当前已存在的东西。

### 13.1 三处硬约束（来自现状代码，非推测）

1. **`|{` 撞 Rust 式闭包** `|x| expr`：`src/parse.tc:5204` 把表达式起始位的裸 `BitOr` 送进
   `parse_bar_lambda`（`:1575`），后者 `:1581` 在吃掉起始 `|` 后立刻 `expect_tok("Identifier")`
   ⇒ `|{a, b}` 是语法错。将来若支持解构闭包参数 `|{a,b}| body`，连 LL(k) 都修不了。
2. **`&{` 撞前缀取址** `&x`：`src/parse.tc:5443` 的 `BitAnd` → `mk_amp`（注释明写「前缀 `&x` = 取址」），
   而 Primary 位的 `{` 已经是块表达式（`:5223`）⇒ `&{...}` 今天是一条**可解析**路径（块的取址）。
   同一原因适用于方括号：`&[a,b]` 今天是「数组字面量取址」。
3. ⇒ **结构性结论**：只要保留「`&` = 取址、`|` = 闭包起始」这两条既有约定，
   **任何以位运算符引导的前缀式（`&X` / `|X`）都不可能成立**。这不是 LL(k) 修补问题，是记号已被占用。
   （附带邻接陷阱：`a &{b,c}` 少一个逗号会被读成 `a & (&{b,c})` ⇒ 静默按位与 —— 本项目反复流血的老 bug 类型。）

### 13.2 「值 / 类型 / clause 都是集合」：只有一个半成立

| 域 | 代数结构 | meet ∧ | join ∨ | 补 | 有序合并（monoid） |
|---|---|---|---|---|---|
| 值：bitstr / 位域 | 位向量上的布尔代数（幂集格） | ✅ `&` | ✅ `|` | 待定（§12.4） | ✅ `++` |
| 类型 / concept 约束 | meet-半格（⊤ = 无约束） | ✅ 合取 | ❌ 析取需 union type / 动态派发 | ❌ `not A` 不可判定 | ❌ 无意义 |
| clause group | **`[N]clause` 定长数组** = 有序多重集 | — | — | — | ✅ `++` |

- **clause 不是集合而是序列**：group 的类型是 `[N]clause`（`docs/compiler/first-class-clause.md` §1.2），
  顺序决定展开后的臂序、阴影判定与穷尽性（该文 §1.3 / §1.4 的 INV-2 要求通配臂重排至末位）。
  ⇒ 对 clause 而言，**幂等且交换的 join 是错的语义**；它在同样的「┃]-doc 里已被你自己 2026-10-25 定向为
  改用 `++`（§1.2 裁定 B，理由之一正是「不和 `&&` 撞」），并复用已实装的
  `[N]T ++ [M]T ⇒ [N+M]T`（`src/sema.tc:8238-8251`）。
- 类型域缺 join 与补 ⇒「3 符号 × 3 域」的格子里天然有 5 个空格。真正能统一的只有 **meet** 与 **monoid concat** 两条。

### 13.3 替代方案：按代数结构分两族，而不是按域统一写法

| 族 | 符号 | 结构性质 | 适用域 | 处置 |
|---|---|---|---|---|
| 格族 | `&` / `|` | 幂等 · 交换 · 结合 | 值（bitstr / 位域）；类型约束位（仅 meet） | 删值级 `&&` / `||`（§10.1 / §11.1 已判定二者与 `&` / `|` **同一条通路**，无语义增量） |
| 单oids 族 | `++` | 保序 · 结合 · 非幂等 · 非交换 | 值（bitstr / string / slice / array / map）；**clause group** | **保留**，且它不属于本族改革的范畴 |

统一性落在「**同一个符号在所有域都读作同一个代数运算**」上，而不是落在外形上：
`&` 到处都读 meet，`++` 到处都读 monoid concat。这比引入新外形便宜一个数量级，且**零新增记号**。

### 13.4 顺带干掉 `g_type_and`（值与类型的上下文开关）

今天 type / value 上下文靠 `src/parse.tc:414-451` 的**可变全局 bool** `g_type_and` 区分，
2026-10-18 出过 `expr as T && cond` 被误读为 `as (T && cond)` 的回归。两个候选修法（待拍板）：

- **(a)** 把全局 bool 换成 `parse_type` 的**显式参数**（只有声明位传 true）；
- **(b)** 更彻底：`as` / 返回类型 / 字段类型位**只吃一元类型**（不许中缀合取），
  concept 合取只允许出现在形参约束位 `T: A & B` 与将来的 `where` 位。
  ⇒ (b) 之后 `g_type_and` 这类状态彻底消失，且再没有「我在哪一层」的判定漏洞。

### 13.5 关于 n-ary / 列表形态

静态 brace list **不能表达动态 arity** ⇒ `&{a,b,c}` 相对 `a & b & c` 只省一个字符；
真正有价值的那个特性是 **spread**（把数组 / 集合摊进运算），届时形态应走**既有方括号聚合字面量**
（`[a,b]`、map 的 `[k:v]`），而不是花括号 —— 花括号已身兼五职（块 / `Name{...}` / `V{.Case}` /
`Peng{.x=1}` / `.{a,b}` 元组字面量与类型位 `.{T1,T2}`），判据 `looks_like_struct_lit()`
（`parse.tc:708-724`）已经是 LL(3) 启发式。
⇒ 建议 n-ary / spread **排在 §13.3 之后单独开批**，形态另起一轮裁定。

### 13.6 迁移顺序（避免再次触发桥接编译器）

1. §13.3 的改动不需要新记号 ⇒ 旧种子仍可编译 src，**无需桥接**；
2. 删值级 `&&` / `||`（src 值位早已迁 `and` / `or`，剩余全是注释与类型位）+ `T: A && B` → `T: A & B`；
3. gate L2 → `npm run seed:check` / `seed:refresh` 提交种子；
4. 最后改 `opmap` 与 `T-SET-E101/E102/E103/E105` 文案（按 §12.5 判据逐个 grep 符号是否仍存在）。
   ⚠ 若采用 §13.4 (b)，`expr as T & cond` 的解析结果会变（报错位置不同）⇒ 需 conformance diff 人工复核。

### 13.7 用户裁定（2026-10-27）

| 编号 | 议题 | 裁定 |
|---|---|---|
| ① | clause group 是序列还是集合 | ✅ **序列**（其别的 tooling: `first-class-clause.md` §1.2 裁定 B 的 `++`，本轮确认该定性不变） |
| ② | 类型位的 meet 用什么 | ✅ **用 `&`**，不另造只在约束位生效的新连词 |
| ③ | `g_type_and` 怎么改 | ⏳ 见 §13.8（读到 `_cleanup_trash/ecs_entity_DESIGN_20261025.md` 后出的修订建议，**尚未拍板**） |
| ④ | `++` 是否长期保留 | ✅ **长期保留**（它被 clause group 占用，不属于本族改革范畴） |

### 13.8 ③ 的修订建议：既不是纯 (a) 也不是原版 (b)

读到 ECS entity 设计（`_cleanup_trash/ecs_entity_DESIGN_20261025.md`）后，原 §13.4 的 (a)/(b) 两选都不够准。
该文档的规格层是 `#entity struct X = Position && Health && ?PoisonData && ?BurnData;`
（§0、§2.1、§2.2 G3、§4 E6），据此逐条修订：

**R1 机制：改成显式形参。** 把 `g_type_and`（`src/parse.tc:420`）这个可变全局 bool 换成
`parse_type(allow_and: bool)` 的**形参**，取值必须是编译期常量，杜绝"上层偷偷改全局再调用"的形态。

**R2 取值策略：反转默认值 —— 默认放行，只关两处。**
先厘清一个易混点（用户 2026-10-27 提示「`as` 已废弃」，经核实**是两个不同的 `as`**）：

| 形态 | 例子 | 状态 |
|---|---|---|
| **导入别名 `as`** | `@import("src.mod_a" as x)` | ⛔ **已废弃且已落地**（用户 2026-10-07 裁定，`docs/syntax/module-path-access-design.md` §9.0）；`tests/conformance/fail/f131_import_conflict/main.tc` 已改写为期望 `T-PAR-E101` 语法错，无存量债务 |
| **类型转换 `as`** | `tag as u64` / `parse_post_cast`（`src/parse.tc:5422`、`:673`） | ✅ **健在**，且是 src/lib 里密度最高的语法之一（实测 6438 处，关键字表仍登记 `"as"`）⇒ **R2/R3 恰恰是针对它** |

> **澄清（易被误读为「保留 `as` 有好处」）：三者是不同层面的事，不要混为一谈。**
> ① **`as` 保留是基线前提，不是本批的变更项**：废除类型转换 `as` 需要另设计转换语法、迁移 6438 处、
> 重建种子 —— 那是一场独立战争，不在本批范围内。本批既不废除它，也不依赖它被废除。
> ② **真正带来收益的是 R2 的开关反转**（默认放行 + 只关两处），与 `as` 是否存在无关。
> ③ **「保留 `as`」本身是成本，不是红利**；只是这笔钱 **Step 2 第 1 小步已经替我们付完了**（见下条实测）。
> 唯一要新付的实钱是 R3（括号类型）。

据此把 `parse_type` 的全部调用点分两类（`src/parse.tc` 的 33 处逐一落位）：

- **表达式内部的裸露类型位（有歧义）—— 只有两处：**
  1. `expr as T`（`:673`，经 `:5422` 触发）
  2. **`fid > T`**（`:5523`，M52 反序列化读路径，由 `tok_type_only()` 门控）
     ⚠ 这第二处是本次枚举才发现的：`x > A & B` 与 `as` 位**同形歧义** —— 开放合取会被读成
     `x > (A & B)` 类型反序列化，否则是 `(x > A) & B` 位与。原 R2 只点了 `as`，会把同款 bug 复制到这里。
- **声明位（无歧义）—— 其余全部：** 形参 `:2018/2026/2032`、返回类型 `:2079`、struct 字段 `:5806`、
  变体载荷 `:5776`、type alias `:5949`、map key/value `:258-260`、数组/指针/optional 元素 `:213-295`、
  lambda 形参 `:1586`、`:1142/2293`、类型traits `:356-378` 等。这些位置类型之后不接表达式。

⇒ 与其继续维持「只有形参位允许」的白名单，不如 **默认 true、只在这两处置 false**：

- 好处是 ECS 将来 `#entity struct X = A & B & ?C` 以及**已实装**的 `type X = A & B`（`:5949`）
  **自动获得类型代数能力**，不必再回头改开关 —— 少一处「忘了加标志」的静默失败。
- 安全性：历史上唯一炸过的是 `as`（`src/parse.tc:415-418` 回归原文 `expr as T && cond`）；
  且同一注释指出 **nightly 用种子编译旧版本 main 源码**，那批源码大量使用该写法
  ⇒ `as` 位保持关闭即可守住；`fid > T` 同理关闭。开放的位置全是无后继表达式的声明位。
- ⭐ **实测（2026-10-27，修正上一轮的估算）：`as` 位关闭合取的代价在现行源码上为 0。**
  `grep -ro " as [A-Za-z_][A-Za-z_0-9]*"` 在 src/lib 命中 **6438** 处，但
  `grep " as X &&"` 全库仅命中 **2** 处，且两处**都是那条回归注释自身**（`src/parse.tc:415`、`:435`）—
  真实代码里 **零处** `expr as T && cond`。根因是 Step 2 第 1 小步已把值级连词迁到 `and`/`or`，
  剩余的 `&&` 全在注释与类型位。
  ⇒ 关闭 `as`/`fid > T` 两处的合取，对**当前**自举、examples、tests **零影响**；
  nightly 编旧 main 源码的那层风险是**保险**，不是当下的障碍。
  ⇒ 这条也说明：**R2 不需要为「升级旧源码」留出任何过渡**（这一点曾是本设计里最担心的风险）。

**R2.1 实施形态：** `parse_post_cast`（`:673`）与 `fid > T`（`:5523`）两处改为调用
`parse_type_conjunction(false)` 的显式形参版本，并在两处各留一行注释写明「为什么这里不能开」。

**R3 必做配套：补括号类型。** 今天 `parse_type_inner`（`src/parse.tc` 约 270-410）**没有通用 `LParen` 分支**
（`(T)` 会落 `expected type`）。
⚠ 别被 `src/parse.tc:339` 的 `expect_tok("LParen")` 误导 —— 那是 **`Sym32("tag")` 的实参括号**，不是括号类型；
全函数扫描后确认没有任何 `( Type )` 通路。
⇒ 一旦在 R2 那两处禁止合取，`x as (A & B)` 与 `fid > (A & B)` 这两条退路并不存在。
必须先加一个 `( Type )` 分支；顺带让 `(A & B)?`、`*(A & B)`（其中 `*` 缀接由既有 ptr 分支承担）可写。

**R3 与 R2 的解耦：** R3 是纯增量——加一条分支、不改任何既有分支的行为，可**独立于 ③ 的选择**单独实施与验证。
无论 ③ 最终选哪个方案，`( Type )` 都是要的（它同时是 `as` 位关闭合取后唯一的正经退路）。

**R3 实施状态：已落地并验证（2026-10-27）。** 实现见 `src/parse.tc:203-213`（`parse_type_inner` 开头加 `LParen` 分支），
要点三条：

1. **不包层、不产生新 kind**，直接返回内部节点 ⇒ sema / codegen 零改动，截面最小；
2. 括号内调用的是 **`parse_type()` 而非 `parse_type_inner()`** —— 这样括号内部享有完整的
   后缀 `?` 与合取连词能力，与外部Requested的处理保持一致。实测绑定正确：
   `(A && B)?` == `optional(A && B)`（而非 `A && optional(B)`），因为内层 `?` 循环遇 `)` 即停、
   由外层循环接过；
3. `()` 空括号不合法（`parse_type` 遇 `RParen` 落 `expected type`）—— unit 请写 `void` / `unit`。

验证证据（三项，缺一不可见 §12 纪律「判别式看起来对 ≠ 生效」）：

- **正向**：`out/dbg/g1_R3.exe.exe check` 新增两用例均 **0 error** ——
  `tests/conformance/pass/p_paren_type.tc`（覆盖局部变量位、`as T` 位、数组元素位、`(T)?`、`*(T)`、
  形参位、返回类型位、`map[(T)](T)`、struct 字段位共 9 个位置）与 `examples/paren_type.tc`。
- **反向（关键）**：同一 `p_paren_type.tc` 用**改动前**的 `out/dbg/tc.exe` 检查 ⇒ **`T-PAR-E101 10:8 expected type`**。
  证明这条通路确由 R3 提供，而不是碰巧从既有路径通过。
- **运行期**：`examples/paren_type.tc` 双后端对拍（`run_examples_tmir.mjs`）**PASS**，
  golden `examples/paren_type.expected.txt` = `8 / 8 / 42 / 7`；LLVM 与 tmir-c 逐字节一致。
- **门禁**：`gate L2` 24 步 **23 PASS / 1 FAIL**，唯一失败项是产物快照比对 —— 经逐条核验属**合法漂移**：

  | 类别 | 条目 | 判定 |
  |---|---|---|
  | DIFF | `src/tc.tc::c`、`src/tc.tc::ll` | ✅ 编译器自身 IR —— 新增一条分支的必然足迹 |
  | NEW | `examples/paren_type.tc::c`、`::ll` | ✅ 新目标，基线中本不存在 |
  | **GONE** | **无** | ✅ 没有任何既有目标消失 |

  ⇒ **其余 137 个既有目标的 IR 逐字节不变**，证明该分支对既有代码零影响（不进 `(` 就永不触发）。
  已按项目纪律用 **gate 的 g1** 重录基线：`ir_snapshot --update --compiler out/dbg/g1.exe`
  （139 targets / 281 entries），复验 0 DIFF。

**R4 延后拆解：保留原 binary 节点。** ECS 的 **G3 / M2** 要求未认领的类型节点
（如 `Position && Health && ?PoisonData`）**原样**活到 sema、再派发给注册降解器，无注册则硬错。
但今天 sema 侧 `collect_concept_constraints`（`src/sema.tc:2553`）会递归拆成扁平 concept 名列表
存入 `g_gpc_names`（`src/sema.tc:2532`）⇒ 拆解一旦先行，降解所需的结构就没了。
建议：**binary 节点保持不动，扁平名单作为派生数据并存**；sema 入口先判"是否有注册降解器"，
命中走降解路径，否则走 concept 路径。这条必须在动那一行代码**之前**定，事后补要改两处。

**R5 更正 §13.2 的一处不严密：类型位 `&` 不是可交换的。**
原 §13.2 把三个域的 meet 一律标成「幂等 · 交换」，在类型域不成立：
ECS 的 **E6 明写「列序 = `&&` 链中的源码顺序」** ⇒ `(A & B)` 与 `(B & A)` 在降解后被观测为
**不同列序 ⇒ 不同结构体布局**。故类型位 `&` 必须标注为 **保序（order-preserving）**，
并且**不要**做操作数排序 / 规范化 / 去重。
⇒ 同一符号在各域的代数律不同这件事，要在 spec 里逐域明写，不能靠"都是 meet"一句带过。

**R6 `?` 的优先级不需要额外裁定。** `?T` 前缀（`src/parse.tc:293`）与 `T?` 后缀（`:424-429`）均已实装，
且 `?` 循环在 `&&` 循环**之前** ⇒ `?` 绑定更紧，`Position && Health && ?PoisonData` 的读法已由文法保证。

**落地顺序：** R3（括号类型，可独立验）→ R1+R2（形参化 + `as` 关闭）→ R4（保留 binary 节点）
→ conformance diff 专看 `as` 相关用例。
