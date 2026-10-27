# fault / trap / repair 落地台账（阶段三）

> 状态：**闸门①已通过**（A-1…A-31 全部裁定，Q1…Q15 无剩余，2026-10-27）｜**闸门②已通过**（B1–B6 批次拆分 + 附录 A 逐节点确认）｜**阶段三·编码进行中**：B2 ✅、B3 ✅ 已过门禁（2026-10-27），B1 未开工
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
| **B1** | `FaultSetDecl` 解析 + 具名组登记 + `fault(E)!T` 运行时表示（A-27 后不新增 TI kind） | ⬜ 未开工 | — |
| **B4** | `trap` / `resume` / `recover` 脱糖为 `match` + 常量索引间接调用；组 → 生成校验函数（A-23） | ⬜ 未开工 | — |
| **B5** | 跨函数可达故障集 / 可达 repair 分析，经 `.tlib` TIR 摘要（A-28：不砍） | ⬜ 未开工 | — |
| **B6** | 门禁收口：conformance 用例 + examples golden 双后端 + 自举 + IR 快照重录 | ⬜ 未开工 | — |

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

---

## 4. 偏离记录

| # | 批次 | 偏离 | 处置 |
|---|---|---|---|
| D-1 | B2 | 形态判定点不是附录 A 预估的 3 处而是 **4 处**，且真正先截走谓词的是 `is_tuple`（第 ② 处） | 已改并补进 `fault.md` §11.1 表格 |
| D-2 | B2 | 谓词模式的 scrutinee 约束（A-16）落成**两个**诊断码：E745（非关系运算符）/ E746（scrutinee 非变量） | 已入 `tools/diag_defs.json`（唯一真源），MAT 段 000–999 已切满，走既有区间 |
| D-3 | B3 | **槽位索引（R-2）从 B3 移到 B1** | A-26 已裁定 N（槽位数）是**组**的属性；组（B1）落地前做索引属返工（附录 B §B.5） |
| D-4 | B3 | 多出一处 `sema.tc` 改动：`++` 的 Concat 分支原不放行 clause（`T-BIT-E515`） | 文档债务第 5 次：`fault.md` §7 D4 记「`++` 已存在 ⇒ 增量 0」**未验证**；已在 Concat 分支最前加 `Clause ++ Clause` |

---

## 5. 相关文件

- 语法权威：`docs/syntax/drafts/fault.md`
- 测试矩阵：`docs/design/fault/TESTS.md`
- 运行期 golden：`examples/predpat_demo.tc` + `.expected.txt`（B2）
- 诊断用例：`tests/conformance/pass/p_predpat_hit_miss.tc`、`fail/f_predpat_nonrelop.tc`、`fail/f_predpat_scrutinee_expr.tc`（B2）
