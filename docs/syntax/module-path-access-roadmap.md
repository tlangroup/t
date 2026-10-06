# 模块 path-access 实施路线图（2026-10-07）

> 配套设计文档：`docs/syntax/module-path-access-design.md`（论证与实测证据）。
> 本文只回答：**按什么顺序做、每步交付什么、怎么验收**。
> 状态：**阶段 0 已完成，阶段 1 进行中**。

## 0. 总目标与终态

| 项目 | 现状 | 终态 |
|---|---|---|
| 模块身份键 | 路径**末段**（`e`） | **完整路径**（`src.d.e`） |
| IR 重整名 | `e__deep` | `src_d_e__deep` |
| 导入语法 | 声明式 `@import("M")` / `@import("M" as a)` / `const n = @import("M")` 三种并存 | **唯一** `const e = @import("src.d.e")` |
| 同名绑定 | **0 error**（静默取先登记者 / 链接期 duplicate symbol） | 编译期报错 |
| W402 | 告警 | 告警（不豁免，常驻） |

**排序原则**：① 先补正确性护栏，后动架构；② 零 IR 漂移的步骤全部前置于唯一漂移步骤；
③ 每步可独立验证、可独立回滚。

---

## 1. 阶段总览（按优先级从高到低）

| # | 阶段 | 目标 | IR 漂移 | 依赖 | 工作量 | 风险 |
|---|---|---|---|---|---|---|
| 0 | **地基量化** | 摸清改动面，确认可行性 | 0 | — | 小（✅已完成） | — |
| 1 | **M1 补重定义诊断** | 消除「同名绑定静默错编」 | **0** | 阶段 0 | 中 | 低（🔄 M1.2 gate 跑中） |
| 2 | **M2 完整路径身份** | 模块身份切完整路径（原 P0） | ⚠ **全量** | M1 | 大 | **高** |
| 3 | **M3 语法收敛** | 导入语法唯一化 | 0 | M2 | 中 | 中 |
| 4 | **M4 治理收尾** | 去硬编码白名单、W561 裁定 | 0 | M3 | 小 | 低 |
| 5 | **M5 类型级命名空间** | `a.Point.O` 等（独立 epic） | 待评估 | M4 | 大 | 中 |

> ⚠ **阶段 2 是全路线唯一产生 IR 漂移的阶段**，必须放在所有零漂移步骤之后——
> 一旦漂移发生，IR 快照基线（354 个 md5）失去等价性判据能力，此后再做任何改动都无法用 diff 证明「只改了该改的」。

---

## 2. 阶段 0 — 地基量化 ✅ 已完成

**目标**：把「设计」变成「可执行的数字」。

| 交付物 | 结论 |
|---|---|
| 存量盘点 | 声明式 44 / 选择性 `::` 17 / `const` 62 / `pub @import` 0 |
| 迁移冲突扫描 | 521 文件 → **0 冲突**，61 处可机械迁移，**调用点 0 改动** |
| 依赖图环检测 | src 模块 import 图 **0 环**（DAG） |
| `as` 存量 | **3 处**（2 注释 + 1 fail 测试）⇒ 废弃成本 ≈ 0 |
| 重名现状扫描 | 521 文件 → **零真实顶层重名**（13 处 `fn` 同名全是合法 clause） |
| 重定义检查现状 | ⚠ **全面缺失**（const/var/fn/struct 全部不报错） |

**关键发现（改变了阶段 1 的范围）**：用户裁定 2 的前提「一个模块里不可能出现两个同名的变量」
**在当前实现中不成立**——`const`/`var` 同名 → 链接期 duplicate symbol，`fn`/`struct` 同名 → 静默取先声明者。

---

## 3. 阶段 1 — M1 补重定义诊断（零漂移）

**目标**：让「模块内符号不可重名」从愿望变成事实，使裁定 2 成立。

### M1.1 顶层符号重定义检查

| 种类 | 是否检查 | 理由 |
|---|---|---|
| `const`（含 `const n = @import(...)`） | ✅ 检查 | 实测现状：0 error + 链接期 duplicate symbol |
| `var` | ✅ 检查 | 实测现状：0 error + 链接期 duplicate symbol |
| `struct` / `enum` / `variant` / `union` / `type` | ✅ 检查 | 实测现状：静默取先声明者 |
| **`fn`** | ❌ **豁免** | 合法 clause（`fn f(0)` / `fn f(_)`）与重载；全仓 13 处 clause 依赖此豁免 |

- **交付物**：新增诊断码（或复用既有码位）+ 顶层符号登记处的重复检测。
- **验收**：① `tc check src/tc.tc` → `"errors": 0`（全仓零违反，零误报）；
  ② 新增 fail 负向测试 ≥ 4（const/var/struct/import 绑定各一）；
  ③ gate L2 全绿（零漂移 ⇒ 快照**不需要**重录）。

### M1.2 import 绑定撞名检查

覆盖 const 形态（M1.1 天然覆盖）与声明式形态（`@import("src.d.e")` 默认绑末段，
两个末段同名模块 → 静默取先登记者，实测输出 110）。

- **交付物**：模块别名登记处的同名检测（原「改写 `f131`」已作废，见下方 M1.2 进度说明）。
- **依赖**：M1.1。

### 📌 M1.1 进度（2026-10-07 已实施）

| 步骤 | 状态 |
|---|---|
| 登记新诊断码 `T-NAM-E405`（`tools/diag_defs.json` → `gen_diag.mjs` → `gen_diag_t.mjs`） | ✅ 161 条 |
| 实现 `err_dup_top_def` + `check_entry_redefs`（`sema.tc`，入口模块、fn 豁免） | ✅ |
| 挂载：`mangle_modules()` 中 `collect_module_defs()` 之后 | ✅ |
| 负向测试 `f148`–`f151`（const / var / struct / import 绑定） | ✅ conformance **320 / 0**（316→320） |
| 零误报验证：`g1 check src/tc.tc` = **0 errors / 528 warnings**（与基线一致） | ✅ |
| 自举一代 → 四代不动点（`g2 == g3 == g4`，`.ll` md5 全同） | ✅ |
| gate L2 首次 | ✅ **24 passed / 1 failed**（唯一失败＝陈基线，预期） |
| IR 快照漂移范围 | ✅ **3 处差异 / 0 NEW / 0 GONE**，且**全部**为 `src/tc.tc::{c,h,ll}` |
| `--update` 重录基线（117 targets / 354 entries，g1 录制） | ✅ |
| gate L2 复跑 | ✅ **25 passed / 0 failed**（2887s） |
| 安装四代种子 + dbg/rls 双复检（check 均 0 errors / 528 warnings） | ✅ |
| 提交 + FF 推送 main（`9dbf99c`） | ✅ |

> ⭐ **漂移证据（决定性）**：348 个 examples/tests entry **一个都没变**，
> 变化的只有编译器自身的 3 个自举 entry ⇒ 新检查对既有代码**零语义影响**。

### 📌 M1.2 进度（2026-10-07 已实施）

**范围修正**：实施前实测发现 `ModuleDecl` 那条路子是个伪命题 —— 声明式 `@import` 之外，
`const X = @import(...)` 形态的**内部**模块身份同样取 `last_segment`（`modval_load` 传入），
所以「末段同名」这个病根**与导入写法无关**。M1.2 因此定为「模块别名 → 模块路径」登记表的撞名检出。

| 步骤 | 状态 |
|---|---|
| 新增诊断码 `T-MOD-E562` `IMPORT_ALIAS_CLASH`（162 条） | ✅ |
| `g_imp_alias` / `g_imp_path` 登记表 + `imp_alias_register()`，挂 `handle_one_import` | ✅ |
| `handle_one_import` / `modval_load` 增 `at` 形参（const 形态报在 const 声明处，非合成节点） | ✅ |
| 负向用例 `f152`（声明式）/ `f153`（const 形态） | ✅ conformance **326 / 0** |
| 全仓零误报静态预扫（tests + examples + lib + src + tc0，含 lib 搜索路径） | ✅ 冲突 **0** |
| g1 自检 `src/tc.tc` | ✅ **0 errors / 528 warnings** |
| seed vs g1 对拍 `src/tc.tc` | ✅ `.h` / `.c` **逐字节 IDENTICAL**，且 `.c` md5 == 快照 `now` 值 |
| IR 快照 | ✅ **3 差异 / 0 NEW / 0 GONE**，全部为 `src/tc.tc::{c,h,ll}` |

> ⭐ **遗留开放问题（需裁定，不阻塞 M1）**：`const` 形态在 M2 落地前**无法**区分末段同名模块，
> 唯一解药是被裁定废弃的 `as`。建议 `as` 保留至 M2 完成再移除；已写入设计文档 §9.2。
> 另：`f131_import_conflict` 测的是**选择性导入**改名冲突（`:: fa as x, fb as x` → `T-MOD-E560`），
> 与模块别名 `as` 不是同一处语法，且**无法改写成 const 形态**（`const a = @import("src.m" :: f1)`
> 实测报 `T-PAR-E101`，见设计文档 §10.3）—— 故原「改写 f131」的交付物**取消**，该用例保留原样。
> 是否随 `as` 一并废弃留待 M3/M4（其提示文案当前仍写「请用 as 改名」）。

### 里程碑 M1 ✅ = M1.1 + M1.2 完成且 gate L2 全绿。

---

## 4. 阶段 2 — M2 完整路径身份（⚠ 唯一漂移阶段）

**目标**：模块身份从末段切到完整路径。

### M2.1 四处**同时**切换（缺一即符号名与查找键不一致）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `sema.tc:9247` `g_modval_set` | 存**完整路径**而非 `last_segment(path)` |
| 2 | `sema.tc:10518` `def_lookup` | 按完整路径查，命中即唯一 |
| 3 | `sema.tc:10509` `mangled_name` | 重整名扁平化为 `src_d_e__deep` |
| 4 | `sema.tc:6127` `infer_expr_body` | 脱糖取完整路径作 key |

### M2.2 验证链（固化，不得跳步）

`tc check` → `cstgen --check` → 自举 g1 → **seed vs g1 逐字节 IDENTICAL** → 覆盖反查
→ 旁路对照 → IR 快照 → `--update` 重录 → gate L2 → 四代种子 + dbg/rls 双复检 → commit + FF 推送。

- ⚠ **快照失去等价性判据能力**（354 个 md5 全变）⇒ 等价性**必须**改用
  「变更前 seed vs 新 g1 同源码对拍」证明；快照只能防回归。
- ⚠ 改 `src/` 后首跑 gate L2 的快照步必 FAIL（陈基线），属**预期失败**；
  判据是 **0 NEW / 0 GONE**。基线**必须由 g1 录制**。
- **验收**：gate L2 25/0；`tc.ll` / `tc.c` 中符号名由 `base__x` 变为 `src_base__x`；体积 +5~10%（已知代价）。

### 里程碑 M2 ✅ = gate L2 全绿且四代自举不动点成立。

---

## 5. 阶段 3 — M3 语法收敛

| 任务 | 内容 | 依赖 |
|---|---|---|
| M3.1 | 扩展 parse 支持 `const m = @import("src.m" :: a, b)`（17 处选择性导入） | M2 |
| M3.2 | 61 处声明式 → `const` 迁移（调用点 0 改动） | M3.1 |
| M3.3 | 删除声明式 `@import` 与 `as` 语法；清理 `pub @import` 死代码（`lex.tc:913`、`sema.tc:10137/10151/10546`） | M3.2 |

- **验收**：全仓零声明式 `@import`；`tc check` 0 error；gate L2 全绿（零漂移）。
- ⚠ 6 个测试需同步改写：`f123` / `f54` / `f55` / `f56` / `f_export_on_import` / `p42_std_import`。

---

## 6. 阶段 4 — M4 治理收尾

- M4.1 `is_src_mod`（`sema.tc:10532`）去硬编码 9 模块白名单。
- M4.2 W561 裁定：升级 error 还是保持 advisory（遗留 2 条）。

---

## 7. 阶段 5 — M5 类型级命名空间（独立 epic）

`a.Point.O`、struct 关联常量、多级 `member` 解析。见
`docs/syntax/type-namespace-review.md` 与 `docs/syntax/product-type-unification-design.md`。
**不塞进本 epic**（否则边界失控）。

---

## 8. 横切事项

- **每步红线**：改 `src/` 后 → `tc build src/tc.tc` → gate L2 → 必要时 `--update` 重录 → commit → FF 推送。
- ⚠ **「零漂移」的精确含义**（易误解，务必按此判读）：
  `tests/ir_baseline.json` 共 **354 entry**，其中 **6 个是编译器自身**（`src/tc.tc`、`src/tote.tc` 各 c/h/ll），
  其余 **348 个是 examples/tests 的用户代码**。
  改 `src/*.tc` ⇒ 编译 `src/tc.tc` 的产物**必然**变化（编译器源码进了自己的产物），
  故**这 6 个 entry 必然漂移、基线必须重录**；但 **348 个用户代码 entry 必须完全不变**。
  ⇒ 真正的判据是：**漂移是否局限在 `src/tc.tc` / `src/tote.tc` 这 6 个 entry**。
  若 examples/tests 的 entry 也变了，说明行为被意外改变，须回查。
- **已知代价**：完整路径化使 `tc.ll` +8.6% / `tc.h` +9.8% / `tc.c` +5.2%（符号名占 `tc.ll` 44.7% 字节）。
- **已知漏洞**：库搜索路径导入（如 `const repl = @import("repl")`）的身份是**单段**，
  无命名空间保护，`.tlib` 场景可能撞同名库（见设计文档 §11.5）。
