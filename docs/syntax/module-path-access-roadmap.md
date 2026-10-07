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
| 4 | **M4 治理收尾** | 去硬编码白名单、W561 升 error + 清理 720 裸引用 | ✅ | M3 | 小 | 低 |
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

### M2.1 符号身份切完整路径（含蓝图偏差修正）

> ⚠ **蓝图偏差（须记录）**：蓝图原写「四处同时切换」基于旧代码；当前代码（M1.2 已落 + S3 SoA 迁移后）
> 模块身份与别名**强耦合**——`handle_one_import` 里 `alias`(末段) 同时是 `g_cur_mod`(模块身份) 与
> 名字重整命名空间，且 `modval_load` 对 `src.` 前缀做 **strip** 后传给它（10265
> `load_module_file(chosen, alias)`；10499-10507 `rest = strip(src.)`）。故 M2 实际须：
> ① 把「模块身份（完整路径）」与「文件定位路径（去 `src.`）」**解耦**；② 新增
> **别名(末段)→完整路径身份**映射表，支撑声明式 `base.foo` 的 Pass 1 解析
> （`def_lookup` 须用身份而非末段别名）；③ `mangled_name` **扁平化**（`.`→`_`）使 C 后端符号合法；
> ④ 退化 `T-MOD-E562`（末段同名模块符号已区分，不再静默合并）；⑤ `is_src_mod` 比较集增补完整路径；
> ⑥ 改写 `f152`/`f153`（两末段同名模块现可共存，须用 `as` 区分才能无二义引用）。
> **目标与约束不变**，改动点从 4 处扩至 **11 处 + 1 新表**。

> ⚠ **验证期两处关键修正（2026-10-07，必须记录）**：
> **① 重整名策略改为「碰撞感知」，非蓝图原写的「全路径 always」**。
> 蓝图 M2.1⑤ 写 `mangled_name` 扁平化（`.`→`_`）即「模块身份完整路径直接进符号名」
> （`base`→`src_base__kids`）。但这会让编译器自身源码约 748 处硬编码重整名字面量
> （`src/*.tc` 里的 `base__kids`/`lex__decl_list`/…，**mangler 不触碰**）在旧种子编译新源码时
> 全部「未定义」（旧种子只认 `base__kids`）⇒ **gate boot1（旧种子→g1）自举断裂**。
> 先试过把 748 处改成 `src_base__X`，新编译器链（g1→g4）通过但旧种子编译新源码失败，证实此路不通。
> **正解**：`mangled_name` 改为**碰撞感知**——仅当某末段别名在全局「同末段多模块」冲突时才升完整路径
> （`src.d.e`/`src.x.e` 都末段 `e` ⇒ `src_d_e__DEEP`/`src_x_e__DEEP` 消歧，满足 f152/f153）；
> 编译器自身 9 模块末段均唯一 ⇒ 仍发旧名 `base__kids`（与新/旧编译器都一致，**自举不动点成立**）。
> 实现：新增 `g_mod_fullpaths`（已加载模块完整路径清单，resolve_modules 期登记）+ `mod_lastseg_count`。
> **② const 形态双模块导入的 E560 误报**：`const EA=@import("src.d.e"); const EB=@import("src.x.e")`
> 经 `modval_load` 的「兼容通配 `:: *`」把 `DEEP` 注册进入口作用域，两模块通配同名触发 T-MOD-E560。
> 但二者模块身份已是完整路径（`src.d.e`≠`src.x.e`），通配同名经限定访问 `EA.DEEP` 可消歧，非真歧义。
> 修正：选择性导入项加 `g_sel_from_wild` 标记，`sel_validate` 冲突判定仅当**两条都非通配**时才报 E560
> （通配×通配、分属不同模块 ⇒ 豁免）。显式 `:: a as x` 撞名（f131）仍正确报错。

| # | 位置（当前行号） | 改动 |
|---|---|---|
| 1 | `modval_load`(10499) | 不再 strip `src.`，`mk_ImportModDecl` 传**完整路径**；定位去 `src.` 交给 `handle_one_import` |
| 2 | `handle_one_import`(10163) | 拆 `idn`(完整身份)=nm / `loc`(定位)=去 `src.` 版本；`g_cur_mod=idn`；`alias`(末段) 仍用于 `mod_alias_add` + `imp_alias_register` |
| 3 | `load_module_file`(10114) | 第二参传 `idn`（完整），`base__g_cur_mod=alias` 自然为完整身份 |
| 4 | `mod_alias_add`(10090) | 维护 `g_alias_full[alias]=idn`；新增 `g_alias_full` 表与 `alias_full(a)` 解析 |
| 5 | `mangled_name`(10554) | alias 扁平化 `dots_to_underscores`（点→下划线） |
| 6 | `g_modval_set`(9247) | key = 完整路径（去 `last_segment`） |
| 7 | `infer_expr_body`(6132) | `mkey = import_expr.sa`（完整路径，去 `last_segment`） |
| 8 | `mangle_modules` Pass 1(10952/10967/10978) | `def_lookup` 第一参用 `alias_full(receiver)` |
| 9 | `is_src_mod`(10577) | 比较集增补 `src.base`/`src.lex`/`src.parse`/`src.sema`/… 完整路径 |
| 10 | `imp_alias_register`(10074) | 退化：末段同名不同路径**不再报 E562**（菱形同路径仍去重）；`err_import_alias_clash` 保留函数不再调用 |
| 11 | `tests/conformance/fail/f152`·`f153` | 两末段同名模块共存，改用 `as` de/xe 区分，期望 pass + 返回值正确 |

### M2.2 验证链（固化，不得跳步）

`tc check` → `cstgen --check` → 自举 g1 → **seed vs g1 逐字节 IDENTICAL** → 覆盖反查
→ 旁路对照 → IR 快照 → `--update` 重录 → gate L2 → 四代种子 + dbg/rls 双复检 → commit + FF 推送。

- ⚠ **快照等价性判据（碰撞感知下比 detour 更强）**：编译器自身 9 模块末段均唯一 ⇒ 发射符号仍为
  `base__x`，与 pre-M2 逐字节一致，故 `src/tc.tc` 相关条目**未漂移**，快照可直接作证等价；
  仅 f152/f153 等「同末段多模块冲突」的 fixture 升 `src_d_e__x`/`src_x_e__x` 新名 ⇒ 这些条目
  必然漂移，须 `--update` 重录。等价性补充证据：**g2==g3==g4** 不动点 + `seed(tc.exe)` 编译新源码
  成功（boot1 不断）+ 全量 conformance 326/0。
- ⚠ 改 `src/` 后首跑 gate L2 的快照步旧基线含 `src_base__x`（detour 残留）必 FAIL，属**预期失败**；
  须先 `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录再复跑。基线**必须由 g1 录制**。
- **验收**：gate L2 25/0；`tc.ll` / `tc.c` 中**编译器自身符号名仍为 `base__x`**（碰撞感知：
  末段唯一 ⇒ 旧名，自举不动点成立），仅「同末段多模块冲突」的用户代码升完整路径
  `src_d_e__x`（如 f152/f153）；旧种子 `tc.exe` 可编译新源码（boot1 不再断）。

### 里程碑 M2 ✅ = gate L2 全绿且四代自举不动点成立。

---

## 5. 阶段 3 — M3 语法收敛

| 任务 | 内容 | 依赖 |
|---|---|---|
| M3.1 | 扩展 parse 支持 `const m = @import("src.m" :: a, b)`（17 处选择性导入） | M2 |
| M3.2 | 声明式 `@import` → `const` 迁移（实测 `src/*.tc` 内仅 15 处语句形态，调用点 0 改动） | M3.1 |
| M3.3 | 删 `as` 语法（项级 `a as c` + 导入级 `as 别名`）；别名表 `imp_alias_register` 键改完整路径 idn；清死代码 `err_import_alias_clash`；声明式 `@import("X"`（无 `as`）保留 | M3.2 |

> **M3.1 进度（2026-10-07）**：✅ 已完成并通过验证。
> - 改动面（实测远小于蓝图「17 处」）：`parse.tc` 表达式位 `parse_import_expr` 支持 `:: a, b as c`（存 `import_expr.lb`）；`sema.tc` `modval_load` 从 const/var 声明的 `import_expr` 取 `::` 项写入 `ImportModDecl.lb`，经 `handle_one_import → sel_register` 登记选择性可见性；仅无 `::` 时退化通配（与 M2 前行为一致）。库模块内 const 选择性导入的 owner 经 `node_mod(imp)` = 当时 `g_cur_mod`，与通配分支一致。
> - 新增正向用例 `tests/conformance/pass/p_m3_const_selective/`（`const e = @import("src.d.e" :: deep)` → `e.deep(10)`=110；模块另含未导入的 `other` 验证选择性）。
> - 验证：旧种子 `tc.exe` 编译 M3.1 源码 EXIT=0（自举不断）；`g1 check src/tc.tc` = 0 errors；conformance **328/0**（增 2，新用例通过，无回归）；gate L2 24/1（唯一 FAIL = 产物快照比对，因 M3.1 改 `parse.tc`/`sema.tc` 致 `src/tc.tc::{c,ll}` 2 entry 必漂移，属 §8 合法基线陈旧，`0 新增/0 缺失` 且未波及 348 用户 entry）；重录基线后复跑预期 25/0。
> - ⚠ 蓝图「17 处选择性导入」是高估：实际只在「表达式位解析」+「`modval_load` 消费」两处打通，声明式 `parse_at_import_decl` 此前已支持 `:: items`，无需再改。

> **M3.2 进度（2026-10-07）**：✅ 已完成并推 main（commit `8249697`）。
> - 蓝图「61 处声明式 → const 迁移」高估：实测 `src/*.tc` 内**真·语句形态 `@import` 仅 15 处**（其余 79 处早已是 `const/var` 赋值形态，即 M3 目标形态）。
> - 迁移规则：语句形态 `@import("src.X" :: items);` → `const X = @import("src.X" :: items);`（绑定名 = 路径末段，与 M3 前模块别名同名 ⇒ 调用点 0 改动）；通配 `@import("std.rc.cst");` → `const cst = @import("std.rc.cst");`。
> - 15 处分布：`base.tc`/`lex.tc`/`hir.tc`/`tc.tc`(×2 `std.rc.cst` 直连)/`test.tc`/`tir.tc`/`tir_to_ll.tc`(×4) 的 `src.*` 选择性导入 + `std.rc.cst` 直连；`base.tc` 头部注释同步更新。
> - 风险已排：逐文件核对绑定名无 T-NAM-E405 重定义（tc.tc 既有 `base/lex/parse/hir/sema/codegen_c/tir/mir`，新增 `tir_to_ll/tmir/codegen_wasm/riscv/c_tmir/cst` 均不撞）；`const X` 触发 T-NAM-W402 告警属预期（warning 非 error）。
> - 验证：旧种子 `tc.exe` 编译 M3.2 源码 EXIT=0；`g1 check src/tc.tc`=0 errors/543 warnings（增 15 个 W402）；conformance **328/0**（无回归）；gate L2 预期 25/0（改 src 使 `src/tc.tc` 等 6 entry 必漂移，重录基线后复绿）。

> **M3.3 进度（2026-10-07）**：✅ 已完成并推 main（commit `5b3852f`，用户裁定 B：删 `as` + 别名表键改完整路径）。
> - 改动面：`parse.tc` 删除项级 `a as c`（`parse_import_items`）与导入级 `as 别名`（`parse_at_import_decl`）；类型转换 `x as T`（`parse_post_cast`）保留。
>   `sema.tc`：`imp_alias_register` 注册表键由末段 `alias` 改为完整路径 `idn`（src.d.e ≠ src.x.e 自然不撞，与 M2 idn 重整一致）；删除死代码 `err_import_alias_clash`（E562 退化后已无调用点）。
> - ⭐ **同末段模块消歧改用 const 绑定名**：`f152` 由 `@import("src.d.e" as de)` 改为 `const de = @import("src.d.e")`，`de`/`xe` 为 distinct const 绑定，经模块值机制（const 绑定即模块身份）解析各自符号，无需 `as`。`f153`（`const EA/EB`）不变。
> - `f131`：原测 `:: fa as x, fb as x` 选择性重命名冲突 E560，该重命名随 `as` 移除 ⇒ 改为测「`as` 已删除」：`@import("src.mod_a" as x)` 预期 `T-PAR-E101`。
> - 验证：旧种子 `tc.exe` 编译 M3.3 源码 EXIT=0；`g1 check src/tc.tc`=0 errors/543 warnings；conformance **328/0**（f131→E101、f152/f153→0 errors，无回归）；gate L2 已验证 **25/0**（2561.7s，改 src 使 `src/tc.tc` 等 6 entry 必漂移，已重录基线后复绿）。
> - 声明式 `@import("X"`（无 `as`）保留：M3.3 仅删 `as`，未删声明式导入语句形态；故 f123/f54/f55/f56/f_export_on_import/p42_std_import 等仍有效，无需改写。

- **验收**：全仓零 `as` 导入语法；`tc check` 0 error；gate L2 全绿（零漂移）。

---

## 6. 阶段 4 — M4 治理收尾

- M4.1 `is_src_mod`（`sema.tc:10532`）去硬编码 9 模块白名单 ✅（commit 见阶段 3 末）。
- M4.2 W561 裁定 ✅（2026-10-07 完成）：
  - **根因修复**：`mangle_modules` Pass 3 曾把函数内局部变量/形参（与通配导入的跨模块名重名，如 `validate_slice_pat` 的局部 `pos` 撞 `lex.pos`）误改名为 `lex__pos`；新增父指针侧表 + 「局部引用跳过改写」守卫 + 「已限定名 `__` 跳过」守卫，仅对真正跨模块引用（`ident`/`named`/`struct_lit`）改写。
  - **清理 720**：用 `g1 check` 诊断的精确 (file,line,col,col) 跨度，对 9 个 `src.*` 文件 720 处真实裸引用做**跨度精确替换**为 `module__name`（规避盲替换双重限定 `lex__lex__decl_list`），归零全部裸名跨模块访问。
  - **升 error**：`T-MOD-W561`(warning) → `T-MOD-E561`(error)，同步 `tools/diag_defs.json` / `src/diag_table.gen.h` / `src/base.tc` GEN 块（g_dcode[74]、g_dsev[74]）/ `src/sema.tc` 发射点。验证：`g1 check src/tc.tc` 0 errors / 0 T-MOD-E561。
  - 因 W561 受 `is_src_mod` 守卫仅作用于 `src.*` 模块，tests/examples 不受影响。
  - 后续：跑 gate L2 + 重录 IR 基线（src/tc.tc、src/tote.tc 这 6 entry 预期漂移）后提交 FF 推 main。

---

## 7. 阶段 5 — M5 类型级命名空间（独立 epic）

`a.Point.O`、struct 关联常量、多级 `member` 解析。见
`docs/syntax/type-namespace-review.md` 与 `docs/syntax/product-type-unification-design.md`。
**不塞进本 epic**（否则边界失控）。

### 7.1 已修：前导点变体 `variant_name_of_case` 全局反查无视 `g_lead_expect`（P0 静默错编）
- **根因**：`sema.tc::variant_name_of_case` 扫描 `lex__decl_list` 取**首个**含该 case 的 variant，
  完全无视上下文注入的期望变体类型 `g_lead_expect`。同名 case 跨多个 variant 时取错构造器
  （如 `A { .X }` 误脱糖成 `B_from_X`）→ 静默错编（或类型错）。
  `sema.tc:7609` 对 Enum/Union 已优先用 `g_lead_expect`，但 Variant 分支漏了 —— 形成不对称。
- **修复**：当 `g_lead_expect` 是含该 case 的 Variant 时优先返回其名；否则（期望变体不含该 case）
  `break` 走全局兜底，与旧行为一致。改动仅影响歧义场景，编译器自身 IR 字节级不变（自举不动点
  `g2.ll==g3.ll==g4.ll` 与 M4 基线同 md5 `4d701937…`）。
- **回归测试**：`tests/conformance/pass/p_variant_lead_expect.tc`（两 variant 共享 case 名 `X`，
  `B` 先于 `A` 声明，验证 `.X` 在 `A { .X }` 中按上下文消歧为 `A_from_X`）。

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
