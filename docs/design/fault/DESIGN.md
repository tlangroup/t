# fault / trap / repair 落地台账（阶段三）

> 状态：**闸门①已通过**（A-1…A-32 全部裁定，Q1…Q15 无剩余，2026-10-27）｜**闸门②已通过**（B1–B6 批次拆分 + 附录 A/B/C 逐节点确认）｜**阶段三·编码进行中**：B2 ✅、B3 ✅、B1 ✅ 已过门禁（2026-10-27），B4a ✅ 已过门禁（2026-10-28）、B4b 未开工
> 阶段：阶段一·设计 → 阶段二·流程图 → 阶段三·编码｜日期：2026-10-27
> **语法/语义权威**：`docs/syntax/drafts/fault.md`（唯一真源，§8 裁定表 A-1…A-31、§11 批次拆分、附录 A 逐节点清单）
> **本文件的职责**：只记**批次台账 / 验证证据 / 偏离记录**，**不复制裁定** —— 两处内容一旦重复，必然出现「一处改一处没改」的文档骗人事件（本项目已累计 4 次）。

---

## 1. 为什么 fault 会同时占两个位置

| 目录 | 管什么 | fault 的对应物 |
|---|---|---|
| `docs/syntax/drafts/<topic>.md` | **语言层**：这个语法长什么样、语义如何裁定（`docs/INDEX.md` §2 约束 2：语法规范/草案进 `docs/syntax/`） | `fault.md` —— 文法 EBNF、三层语义、A-1…A-31 裁定 |
| `docs/design/<feature>/` | **流程层**：这个功能怎么落地（`docs/AGENT_WORKFLOW.md` §2：阶段一产出 = `DESIGN.md` + 示例/测试） | 本目录 —— 批次状态、门禁证据、偏离记录 |

判定一句话：**还在讨论「语言该是什么样」→ drafts；已经开始讨论「怎么分批落地、跑没跑过门禁」→ design/**。
fault 的设计讨论已在 2026-10-27 收口，编码已开工 ⇒ 两侧都需要，且**不重叠**。

---

## 2. 批次台账（B1–B6）

| 批次 | 内容 | 状态 | 门禁结论 |
|---|---|---|---|
| **B2** | `PatternExpr` 放宽到关系表达式（谓词模式）+ A-16 硬约束 + 值级 match 语义（N4/N6） | ✅ **完成** | gate L2 **23 passed / 1 failed**；唯一 FAIL 为「产物快照」且根因是基线录制编译器用错（见 §3），非代码回归 |
| **B3** | `@clause(.fault)` / `@clause(.repair)` 变体 + 形态校验 + 「不进运行期」保证（槽位索引按 A-26 归 B1） | ✅ **完成** | gate L2 **23 passed / 1 failed**；唯一 FAIL 为产物快照的**合法漂移**（2 DIFF = `src/tc.tc` 自举产物、2 NEW = 新示例、0 GONE），已重录 |
| **B1** | `FaultSetDecl` 解析 + 具名组登记 + `fault(E)!T` 运行时表示（A-27/A-32：合成具名 struct，不新增 TI kind） | ✅ **完成** | 见 §3.3 |
| **B4** | `trap` / `resume` / `recover` 脱糖为 `match` + 常量索引间接调用；组 → 生成校验函数（A-23） | ✅ **B4a**（`Ok` / `Err` raise 侧）+ ✅ **B4b**（消费侧）均已完成并通过门禁（2026-10-28） | `fault.md` 附录 F |
| **B5** | 跨函数可达故障集 / 可达 repair 分析，经 `.tlib` TIR 摘要（A-28：不砍） | ✅ **B5a**（跨函数签名推导）+ ✅ **B5b**（早期返回脱糖）+ ✅ **B5c**（@main 运行时接手） | 附录 H（B5a/B5b/B5c） |
| **B6** | 门禁收口：conformance 用例 + examples golden 双后端 + 自举 + IR 快照重录 | ✅ 已完成（2026-10-29）：gate L2 23/24 → 快照重录 **149 targets / 301 entries** 回验逐字节相同；另补「未上传 repair」空槽护栏 | 见 §3.6 |

- **顺序**：B2 → B3 → B1 → B4 → B5（B6 随每批走）。理由见 `fault.md` §11：B2/B3/B4 全在编译期、不碰后端。
- ⚠ **B5 不砍（A-28）**：A-4 的非 `pub` 推导要求跨函数可达集分析，排在最后但**不是可选项**。
- ⚠ **B4 之后 IR 形态会变**（新增闭包槽位与间接调用）⇒ IR 快照基线必须重录。

---

## 3. 每批固定验证链（不得跳步）

1. `tc check src --json` → `summary.errors = 0`
2. 自举一代：`node tools/bootstrap_tc.mjs --tc ci/seed/tc.exe --out out/dbg/_<batch>g1.exe` → `exit=0`
   ⚠ 工具会给 `--out` **再追加一次 `.exe`** ⇒ 实际产物是 `<name>.exe.exe`
3. conformance 全量：`node tools/conformance.mjs --compiler <一代产物>`
4. **改了运行期语义 ⇒ 必须加 examples golden**（`examples/<n>.tc` + `<n>.expected.txt`），
   `run_examples_tmir.mjs` 双后端对拍 stdout —— conformance 只 `tc check`、**从不运行程序**，运行期语义零覆盖
5. gate L2 全量（约 1h40m）
6. **IR 快照基线用 gate 的 g1 重录**：`node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe --jobs 1`

### 3.1 B2 门禁证据（2026-10-27）

- `tc check src` → `errors = 0`
- 自举 g1 → `exit=0`
- conformance → **400 passed / 0 failed / 400 total**（含新增 3 例）
- `run_examples_tmir.mjs --only predpat_demo` → PASS，LLVM 与 tmir-c **逐字节一致** ⇒ 坐实 **N7 = 后端零改动**
- gate L2 → 23 passed / 1 failed：
  - FAIL 项 = 「产物快照比对 (ll + c 双后端)… 6 处与 LLVM 自举基线不符」
  - **根因**：我重录基线时用了 `out/dbg/_b2g1.exe.exe`（ci/seed 自举出的**另一条**产物），
    而门禁步骤固定用 `out/dbg/g1.exe` 比对 ⇒ **异源自举产物之间的良性差异**（结构体按布局命名 / const 实参临时名 / 求值序），
    在 `gate.mjs` 该步注释里已明确记录。**不是 B2 的回归。**
  - 佐证：改前（`out/dbg/tc.exe`，pre-B2）与改后编译器对同一示例产出**逐字节相同**的 IR
  - 处置：按规则用 `out/dbg/g1.exe` 重录基线（见 §3 第 6 条）
- 逐节点改动点与三条踩坑（`is_tuple` 漏改 / 默认分支承载真实语义 / arm 名≠类型 kind）见 `fault.md` §11.1 与附录 A

### 3.2 B3 门禁证据（2026-10-27）

- `tc check src/tc.tc --json` → `errors = 0`；`refresh_seed.mjs --check` → 种子仍可用（0 error）
- 自举（`bootstrap_tc.mjs --tc ci/seed/tc.exe`）→ `exit=0`
- conformance → **405 passed / 0 failed / 405 total**（含新增 5 例）
- `run_examples_tmir.mjs --only faultclause_demo` → PASS，LLVM 与 tmir-c **逐字节一致**
- gate L2 → 23 passed / 1 failed（3175s）：
  - FAIL 项 = 产物快照的**合法漂移**：`2 DIFF`（`src/tc.tc::ll` / `::c`，编译器自身源码变大必然变）
    + `2 NEW`（新增示例 `faultclause_demo`）+ **0 GONE** ⇒ 既有 141 个示例 IR 零漂移
  - 已用 gate 的 `out/dbg/g1.exe` 重录（`142 targets / 287 entries`）并回验 **287/287 逐字节相同**
- 四个新诊断码 E728 / E729 / E730 / E731 均已实测触发且文案正确
- 落点与三条实测偏差（M9 `++` 文档债务 / M10 谓词位须置 `g_in_match_pat` / M11 附带诊断）见 `fault.md` §11.2 与附录 B

### 3.3 B1 门禁证据（2026-10-27）

- `tc check src/tc.tc --json` → `errors = 0`（warnings 638，与改前持平）
- 自举一代（`bootstrap_tc.mjs --tc out/dbg/tc.exe` → `_b1h1.exe.exe`）→ `exit=0`
- conformance → **415 passed / 0 failed / 415 total**（新增 10 例：1 pass + 9 fail）
- golden：`examples/faultgroup_demo`（`0\n42\n0\n`）LLVM 与 tmir-c **逐字节一致** ⇒ 坐实 **N7 = 后端零改动**（合成的是普通 StructDecl）
- gate L2 **第一轮** → 22 passed / **2 failed**（3136s）：
  - FAIL ① = **HIR AstGen 验证**：`examples/faultgroup_demo.tc` 1 处 `HIR_OP_RAW` 逃生舱，门禁要求 **RAW 合计 0** ⇒ **真 bug**（不是漂移），见 **D-10**
  - FAIL ② = 产物快照 6 处（合法漂移，见下）
- gate L2 **第二轮**（修完 D-10）→ 23 passed / 1 failed（3256s）：唯一 FAIL = 产物快照的**合法漂移**
  - `4 DIFF` = `src/tc.tc::c` / `::ll`（编译器自身源码变大，必然）
    + `examples/import_module_type.tc::c` / `::ll`
    （该例用 `@type_info` 反射 `src.base`，而 B1 给 `base.tc` 新增 `pub fn mk_FaultDecl`
     ⇒ 模块公开面 +1；实测新 IR 出现 196 处该符号名，**stdout 未变**，run_examples 双后端 PASS）
  - `2 NEW` = 新示例 `faultgroup_demo`
  - **0 GONE** ⇒ 既有 141 个示例 IR 零漂移
  - ⚠ 对照：`_b1h1.exe.exe`（非 gate 的 g1）跑同一比对会多出 4 个 `@import("std.*")` 示例 × 双后端
    的 8 处 DIFF —— 这是**「基线录错编译器」的指纹**，不是回归（与 B2 那次同源）
- 已用 gate 的 `out/dbg/g1.exe` 重录（143 targets / 289 entries）并回验 **289/289 逐字节相同**
- 11 个新诊断码（CLA `E725 / E732 / E733 / E734 / E735 / E738 / E739`
  + MAT `E747 / E748 / E749 / E752`）均已实测触发且文案正确
- 逐节点改动点与偏差 D-5…D-11、既有后端缺口 G-1…G-3 见 `fault.md` 附录 C（§C.2 / §C.5）
- ⚠ **B4 的前置**：G-1（tmir-c 编译不了「返回结构体的闭包」）/ G-2（数组元素上的闭包调用发未定义符号 `t__`）
  是**既有**缺口，已用 pre-B1 编译器复现 ⇒ B4 的 repair 闭包必然撞上，**先修再谈 B4**

### 3.4 ✅ B4 前置 G-1 已修（2026-10-28）

根因是**两套 ABI 混用**：用户聚合返回函数走 `void <fn>(unsigned char* __sret, <params…>)`，
而统一 TClosure ABI 要求 `code(env, 实参…) → 聚合缓冲指针`。`c_emit_thunks` 原来只按形参原样转发。
修法：`src/codegen_c_tmir.tc` 两处 —— ① thunk 体改为「分配缓冲 → sret 首参转发 → return 指针」；
② `c_clo_code` 的判据从「带 env 首参 ⇒ 用裸函数名」改为「**聚合返回 ⇒ 一律走 thunk**」
（带 env 的聚合返回函数签名是 `void <fn>(__sret, __env, args…)`，当 code 用会让 env 落进 `__sret`）。

**门禁证据（24 步按 `gate.mjs` 步骤定义逐条手工复现，见 `fault.md` §D.3）**
- 自举不动点 **g1 == g2 == g3 == g4**（`0fe9c283…`，强于门禁只需 g2 == g3）
- ⭐ **C 后端自举**：`g4.exe --emit-c src/tc.tc` → clang → 该 C 产物 `emit-ll src/tc.tc`
  与 LLVM 产物 **md5 逐字节相同** ⇒ 修复后的 C 后端能编译编译器自身且行为一致
- conformance 415/415（g1 与 C 自举产物各一遍）、run_examples dbg 109/109、双轨对拍 109/109、
  difftest 代际对拍 27/27、MIR opt=1/2 FAILS:0、lint 0 findings
- 产物快照唯一 FAIL（合法漂移）→ 重录 **144 targets / 291 entries**，回验 **291/291 逐字节相同**
- ⚠ **偏差**：本批**不是**一次 `gate.mjs L2` 跑出来的 —— 后台执行通道故障（exit 125），
  改为逐条手工复现；判据一致，但无 gate 汇总行作单一证据源。

**⚠ 仍阻塞 B4 的只剩 G-2**（数组元素上的闭包间接调用，前端名字解析为空）；
G-3（嵌套字段赋值）已用整结构体赋值绕开。

---

### 3.6 ✅ B6 门禁收口证据（2026-10-29）

- gate L2（57min，`--keep-going`）：**23 passed / 1 failed**，唯一 FAIL = 产物快照 6 处。
  先核合法性再重录：`2 DIFF = src/tc.tc::{ll,c}`（B5c+B5b 改了编译器源码）+ `4 NEW`（两个新 example × 双后端）+ **0 GONE** ⇒ 合法、非退化。
- 用 **gate 的 g1** 重录：**149 targets / 301 entries**；回验 `ir_snapshot --compiler out/dbg/g1.exe`
  ⇒ **OK，301 份产物逐字节相同**。⇒ 快照步等价 PASS = **24/24**，fault 批次门禁全绿。
- 关键步全 PASS：自举一代 g1 / **四代不动点 g2==g3==g4** / conformance 442 /
  run_examples 双后端 / HIR AstGen + CTFE / 双轨对拍 / MIR differential / **C 后端自举** /
  difftest tc0 / rls 快速通道 / lint 冒烟。
- 收尾：`g4 → out/dbg/tc.exe`；`npm run seed:check` 通过（种子未过期，未刷新）。
- 提交：`0d8ba69`(B5c) / `ca0b44c`(B5b) / `8a5f9a6`(基线)，均在 `wb`，未 push、未开 PR。

**⭐ B6 追加修复：未上传的 repair ⇒ 空槽护栏（原为静默段错误）**

- **现象**：组内声明了修法（`.anon`），但某条 `Err(...)` **只抛不挂**；上层的
  `trap` 臂 `resume(.anon)` 静态完全合法（E770 只查「修法名是否属于该成员」，
  不查「是否真的上传」）⇒ 运行期调用**空闭包槽位** ⇒ **EXIT=139 段错误**。
- **修法**：`trap` 脱糖时，凡 `resume(.m)` 臂都在闭包调用**前**插入
  `if (<fv>.r<slot> == null) { eprint(...); exit(1); }`（`trap_slot_guard`，位置①②同插）。
  与 B5c「未处理故障由运行时接手」同手法：宁可显式报错退出，也不让空调用沦为 UB。
- ⚠ **合成 null 字面量必须用 `base.mk_null(-1)`**，不能用 `mk_ident("null")`
  —— 后者报 `T-SEM-E201 未定义的标识符 null`（`null` 是独立节点 kind，不是标识符）。
- **为什么不做静态判定**：那需要**成员级**可达集（每条 raise 上传了哪些槽位、跨函数求交），
  而 **A-39 已裁定跨模块不做**（`.tlib` 只承载推导后的签名）⇒ 静态覆盖不全。
  运行期护栏对全部路径（含跨模块 / 间接调用）都成立 ⇒ v1 取护栏，静态分析留 v2。
- 用例：`examples/faultrepair_missing.tc`（故意 exit 1 ⇒ 不进 golden，已加 `SMOKE_SKIP`）。

---

## 4. 偏离记录

| # | 批次 | 偏离 | 处置 |
|---|---|---|---|
| D-1 | B2 | 形态判定点不是附录 A 预估的 3 处而是 **4 处**，且真正先截走谓词的是 `is_tuple`（第 ② 处） | 已改并补进 `fault.md` §11.1 表格 |
| D-2 | B2 | 谓词模式的 scrutinee 约束（A-16）落成**两个**诊断码：E745（非关系运算符）/ E746（scrutinee 非变量） | 已入 `tools/diag_defs.json`（唯一真源），MAT 段 000–999 已切满，走既有区间 |
| D-3 | B3 | **槽位索引（R-2）从 B3 移到 B1** | A-26 已裁定 N（槽位数）是**组**的属性；组（B1）落地前做索引属返工（附录 B §B.5） |
| D-4 | B3 | 多出一处 `sema.tc` 改动：`++` 的 Concat 分支原不放行 clause（`T-BIT-E515`） | 文档债务第 5 次：`fault.md` §7 D4 记「`++` 已存在 ⇒ 增量 0」**未验证**；已在 Concat 分支最前加 `Clause ++ Clause` |
| D-5 | B1 | **`fault` 不能做强制关键字**：做成 `KwFault` 后 `@clause(.fault, ...)` 的 `.fault`（成员名）撞 `expect_tok("Identifier")`，B3 的 4 个用例全红 | `fault` / `over` / `repairs` 一律降为 **mod 阶上下文关键词**，按词文本 + 前瞻判定（`fault.md` §C.5 D-5） |
| D-6 | B1 | **A-32（新裁定）**：§5 原写的运行层 `{ tag, repairs:[N]%TClosure }` **没有承载成功值的字段**，`Ok(u)` 无处安放；且「数组元素上的闭包调用」实测是坏的 | 布局改为 `{ tag: i64, val: T, r0..r(N-1): fn() T }`（`fault.md` §C.1）；`val` 由 R-opt3（成功路径零成本）倒逼，N 个独立字段由实测缺口倒逼 |
| D-7 | B1 | 三处**既有后端缺口**（与 B1 无关，已用 pre-B1 编译器复现）：tmir-c 编译不了「返回结构体的闭包」；数组元素上的闭包调用发未定义符号 `t__`；嵌套字段赋值双后端都不生效 | 本批绕开（golden 用整结构体赋值、不调闭包）；**B4 的 repair 闭包必然撞前两条 ⇒ 先修再谈 B4**（`fault.md` §C.5 G-1..G-3）。G-1 已修（2026-10-28，见 `fault.md` 附录 D） |
| **D-12** | B4a | ⭐ **差点误判** `++` 不存在：它的 op 名是 **"Concat"**（B3 已为它加过 Concat 分支，见 D-4）。按字面量 `"++"` grep 得 0 命中 ⇒ 首版据此改用逗号实参 | 实现改为**同时**支持 `Err(c1 ++ c2 ++ c3)` 与 `Err(c1, c2, c3)`（递归展平 Concat 链）；golden 用设计稿的规范形态 `++`（`fault.md` §F.2） |
| **D-13** | B4a | ⭐ `Ok` 必须**显式**写 `.tag = 0i64`，不能省略靠零初始化 | 为绕开 G-6（C 后端对缺失的**标量**字段会分配 0 字节缓冲并把指针当值用）；缺失聚合/指针字段无害（`fault.md` §F.2） |
| **D-14** | B4a | ⭐ `base.kids_chain_idx(la)` 返回 **kids 链下标**，不是节点 id，须再取 `kids[i].val` | 首版三处直接把下标当节点 ⇒ `Err(...)` 的实参全被判成非 clause（`T-MAT-E754` 误报） |
| **G-4** | B4a→B4b ✅ | ⚠ 既有缺口。⚠ **旧归因错误**：非捕获 lambda 与具名函数单独用都正常，真因是 **fn 类型的槽（struct 字段 / 变量）被写成裸函数符号**（`Box{ .r0 = seven }` / `b.r0 = seven` / `var f: fn()i64 = seven`）⇒ LLVM `store i64 @fn, ptr %x` 链接失败、C 轨把函数机器码当 TClosure 读 | 修在 **TIR 层**（`tir_emit_struct_lit` 具名字段 + `tir_emit_assign` member 分支）：判据「值以 `@` 开头 = 裸函数符号」⇒ `tir_make_closure_value` 包成 `%TClosure`。⚠ 后端层判别不可靠（fn 槽的 TIR 型是 `ptr<void>`，与 %TClosure 基址无从区分）⇒ 两轮后端层尝试均回退 |
| **G-5** | B4a | ⚠ 既有缺口：从闭包调用结果**直接**读 string 字段（`g().name`）出空串且程序随后停住；i64 字段与非闭包的 `mk().n` 都正常 | golden 一律先落局部变量再读字段 |
| **D-15** | B6 | ⭐ **未上传的 repair 被 `resume(.m)` 消费 ⇒ 空槽调用段错误（EXIT=139，静默崩溃）**。组内声明了修法 ≠ 每条 raise 都挂了闭包（A-26 只让槽位**数** N 属组） | 改为**运行期护栏**：`resume(.m)` 臂在闭包调用前插 `if (<fv>.r<slot> == null) { eprint; exit(1); }`。静态成员级可达集因 A-39（跨模块不做）覆盖不全 ⇒ 留 v2。详见 §3.6 |
| **G-6** | B4a | ⚠ 既有缺口：**C 后端**对结构体字面量缺失的**标量**字段分配 0 字节缓冲 + 把指针当值 ⇒ `incompatible pointer to integer conversion` | B4a 靠补全 `tag` 绕开（不动后端）；普通 `P3{ .a = 5 }` 在改动前的编译器上同样炸 |
| **D-10** | B1 | ⭐ **HIR 侧不是零改动**（推翻「附录 C P8」的预估）：`hir_lower_decl` 的 `else` 兜底给未知 kind 发 `HIR_OP_RAW`，而门禁 **「RAW 合计 0」是硬判据** ⇒ `examples/faultgroup_demo.tc` 1 处 RAW 让 gate L2 第 15 步 FAIL | 复用 `HIR_OP_TYPE_ALIAS_DECL` + 在 `check_decl_hir` 显式回落 `check_fault_decl`（`fault.md` §C.5 D-10 / D-11） |


| **D-15** | B4b | ⭐ **A-33 的脱糖示意漏了 `Ok` 那层**：示意写 `return __fv1.r0()`，那只在「函数签名就是 `T`」时成立；有 `.abort` 臂时签名**必**是 `fault(E)!T`，不包会直接在 return 处报 T-SEM-E202 | 消费臂一律补 `Ok(<修复值>)` ⇒ 由 B4a 的 `fault_raise_ok` 就地改成 `__fault_<E>` struct_lit（`fault.md` §G.2） |
| **D-16** | B4b | ⭐⭐ **`lex.cur_t() == "_"` 是恒假的死判据**：lexer 不产 `"_"` token 类型（`_` 走 is_ident_start）⇒ 通配臂 `_` 从未被识别，谓词位拿到 `ident("_")` 而报 E759。既有 `parse.tc` 的 939/5022/5328/5412/5433 等处仍是错形态 | 改为 `lex.cur_t() == "Identifier" and lex.cur_v() == "_"` |
| **D-17** | B4b | ⭐ 位置② 的产物块**不能**是新作用域：TIR 的 `tir_find_local_idx` 用 `g_local_depths[i] <= g_blk_depth` 过滤 ⇒ 块内声明的 `x` 出块即查不到 ⇒ 被当未定义全局 ⇒ 链接期 `undefined symbol: x` | 产物块打 `bf=1`，`tir_emit_stmt` 的 block 分支据此跳过 `tir_blk_push/pop` |
| **D-18** | B4b | 脱糖失败会挨**两条**诊断：具体码 + 一条误导的 E764（退回普通路径后由 infer 的 match 分支补发） | 发诊断时给 trap 节点打 `bc=1`，infer 的 match 分支见到 bc 即不补发 |
| **D-19** | B4b | `parse_fatal_at(code, msg, ti)` 收 **token 索引**（且 `exit(1)`），传节点 id 会把诊断定位到完全无关的源码位置 | 一律传 token 索引 |
| **D-20** | B4b | ⭐ **脱糖产物嵌套 ⇒ 后续 pass 不递归进入**：`fault_raise_try` 挂在语句分派位，只看顶层语句；if 分支内的 `return Ok(...)` 轮不到它 ⇒ `Ok` 原样走到后端（LLVM 类型不符 / C 报 `t_Ok` 未声明） | `Ok(...)` 在**脱糖当场**就地改写，不留给后续 pass |
| **D-21** | B4b | `recover(e)` 直接脱糖成 `return e;` / `x = e`，**不合成闭包** | A-23 的「recover = resume(合成闭包)」只是语义等价说明；产物没必要造 thunk 再调用它，顺带彻底避开 G-4 |
> ⚠ **编号口径（防文档骗人）**：本表 D-1…D-5 与 `fault.md` 同源；**D-6 / D-7 是本表自建编号**
> （分别对应 `fault.md` §C.1 的 A-32 与 §C.5 的 G-1..G-3）。自 D-10 起**一律沿用 `fault.md` §C.5 的编号**，
> 本表只做索引 —— 两处各编一套号必然出现「同一件事两个号」。

---

## 5. 相关文件

- 语法权威：`docs/syntax/drafts/fault.md`
- 测试矩阵：`docs/design/fault/TESTS.md`
- 运行期 golden：`examples/predpat_demo.tc` + `.expected.txt`（B2）、
  `examples/faultraise_demo.tc`（B4a）、`examples/faulttrap_demo.tc`（B4b）
- 诊断用例：`tests/conformance/pass/p_predpat_hit_miss.tc`、`fail/f_predpat_nonrelop.tc`、
  `fail/f_predpat_scrutinee_expr.tc`（B2）；
  `pass/p_fault_raise.tc` + `fail/f_fault_*.tc`（B4a）；
  `pass/p_fault_trap.tc` + `fail/f_fault_trap_*.tc`（B4b，11 条覆盖 E759/E762…E771）
