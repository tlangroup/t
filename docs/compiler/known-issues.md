# 编译器已知缺陷与修复待办（Known Issues）

> 本文登记当前构建中**已确认、待修复**的编译器缺陷，每条附**可复现用例**与**修复验收标准**，供后续排期与回归核对。
> 关联文档：`docs/code-style-guide.md`（§1 后端状态注记，记录用户侧临时绕过写法）、`docs/compiler/pipeline-review.md`（审查维度 D1–D8，其中 D2 IR 架构 / D7 正确性验证直接受此类前后端契约缺口影响）。

## 0. 约定

- **状态**：`open`（待修）/ `fixing`（进行中）/ `closed`（已修并回归通过）。
- **构建版本**：缺陷以 `out/rls/tc.exe`（2026-09-03 构建）复现；**已修复验证基准为 `out/dbg/tc.exe`（2026-09-05 02:19 构建，含 `fb6eeaf`）**——该构建下 KI-001/KI-002 复现用例 `tc run` 均通过。
- **复现用例位置**：`tests/known-issues/`（本目录**不被** `conformance`/`difftest`/`ir_snapshot` 自动扫描，避免污染自举不动点与 IR 基线；仅作手动修复回归）。
- **验收命令**：`tc run tests/known-issues/<file>.tc` 应正常退出且无 LLVM IR 报错，输出与「期望」一致。
- **维度绑定**：此类「前端 `tc check` 接受、后端 `tc run` 拒绝」的缺口，本质是**前端/后端 IR 契约不一致**（D2），属正确性验证（D7）的边界，修复应纳入 BP-1 正确性门禁。

## 1. 缺陷清单（速览）

| ID | 标题 | 类别 | 构建版本 | 状态 | 严重度 | 复现用例 | 期望 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **KI-001** | variant 直接字面量 `Circle(5)` LLVM 代码生成缺陷 | codegen（variant） | 2026-09-03 | **closed** | 高 | `tests/known-issues/KI-001_variant_anon_literal.tc` | `tc run` 输出 `5` |
| **KI-002** | struct 字面量模式 `Pt{ x: 0, y: 0 }` 在 match 中的 LLVM 代码生成缺陷 | codegen（match 解构） | 2026-09-03 | **closed** | 高 | `tests/known-issues/KI-002_struct_literal_pat.tc` | `tc run` 输出 `0` |

## 2. KI-001 · variant 直接字面量（匿名字段字面量）代码生成缺陷

- **现象**：`variant Shape { Circle(i64); ... }` 定义后，使用**直接字面量** `let s = Circle(5);` 或 `area(Circle(5))` 经 `tc check` 通过，但 `tc run`（LLVM 后端）失败。
- **精确报错**（`out/dbg/KI-001_variant_anon_literal.ll:209:29`）：
  ```
  error: integer constant must have integer type
    %t0 = load %vt.Shape, ptr 0
  ```
- **根因假设**：直接字面量 `Circle(5)` 在 LLVM 发射阶段被错误处理为「从空指针 `ptr 0` 加载」，而非（1）在栈/常量区构造具名变体值（tag + 载荷）并（2）取其地址后 load。空指针被 clang 判为 `integer constant`，类型不符报错。
- **影响范围**：所有「和类型 + 直接字面量 + match 解构」端到端运行路径，含 `variant` 单/多载荷变体（`Circle(r)` / `Rect(w, h)` / 单元 `Empty`）。
- **用户侧临时绕过**（见 `code-style-guide.md §1`）：改用兼容构造器 `Shape_from_Circle(5)`（仍被 `tc check` 与 `tc run` 同时接受）。该构造器由 `tests/variant_smoke/main.tc` 冒烟覆盖。
- **修复方向**：LLVM 后端对 variant 直接字面量节点，按「构造变体值 → 取地址」发射，与 `Shape_from_*` 构造器复用同一 IR 生成路径；match 解构侧不变（其绑定 `Circle(r) => r` 已正确）。
- **验收标准**：`tc run tests/known-issues/KI-001_variant_anon_literal.tc` 退出 0、无 LLVM IR 报错、stdout 含 `5`。
- **✅ 已修复（2026-09-05 02:19 构建，提交 `fb6eeaf`）**：`out/dbg/tc.exe run tests/known-issues/KI-001_variant_anon_literal.tc` → 退出 0、无 IR 报错、stdout 输出 `5`。前导点 variant 构造器 `.Circle(5)` 亦于同提交 `T-DOT-E102` 解除后可用。复现用例保留为回归测试，**不再需要**兼容构造器 `Shape_from_Circle` 绕过。状态 → `closed`。

## 3. KI-002 · struct 字面量模式在 match 中的代码生成缺陷

- **现象**：`struct Pt { x: i64; y: i64; }` 定义后，用 **字面量模式** `match (p) { Pt{ x: 0, y: 0 } => 1, _ => 0 }` 经 `tc check` 通过，但 `tc run`（LLVM 后端）失败。
- **精确报错**（`out/dbg/KI-002_struct_literal_pat.ll:155:21`）：
  ```
  error: '%v._tms1' defined with type 'ptr' but expected 'i64'
    %t3 = icmp eq i64 %v._tms1, %s0
  ```
- **根因假设**：match 解构得到的字段绑定 `%v._tms1`（struct 字段）在 LLVM 发射时被定义为 `ptr`（值即指针），却以 `i64` 直接参与 `icmp eq` 比较，发生指针/整数类型错配；应为「对 ptr 做 `load i64` 后再比较」。
- **影响范围**：所有「struct + 字面量模式 match」端到端运行路径（字面量模式含具名字段 `Pt{ x: 0, y: 0 }`；绑定模式 `Pt{ x: a, y: b }` 在 `tc check` 阶段即 `T-SEM-E201` 未支持，属独立 sema 缺口，不计入本 codegen 缺陷）。
- **用户侧临时绕过**（见 `code-style-guide.md §1`）：struct 改用**字段访问 + `if` 比较**，避免字面量模式解构：
  ```t
  fn at_origin(p: Pt) i64 {
      if (p.x == 0 && p.y == 0) { return 1; }
      return 0;
  }
  ```
- **修复方向**：LLVM 后端对 match 字面量/绑定模式解构出的 struct 字段绑定，发射 `load` 取字段值后再参与比较/绑定（与字段访问 `p.x` 复用同一取址路径）；同时评估是否一并放开绑定模式 `Pt{ x: a, y: b }` 的 sema 支持。
- **验收标准**：`tc run tests/known-issues/KI-002_struct_literal_pat.tc` 退出 0、无 LLVM IR 报错、stdout 含 `0`。
- **✅ 已修复（2026-09-05 02:19 构建，提交 `fb6eeaf`）**：`out/dbg/tc.exe run tests/known-issues/KI-002_struct_literal_pat.tc` → 退出 0、无 IR 报错、stdout 输出 `0`。struct 字面量模式 `Pt{ x: 0, y: 0 }` 与具名 match 解构现已双后端通过。复现用例保留为回归测试。状态 → `closed`。

## 4. 修复排期建议

- **优先级**：KI-001 / KI-002 均 **已修复**（2026-09-05 `fb6eeaf` 构建，高优先 blocker 已闭环，见 §2/§3 验收记录）。复现用例保留于 `tests/known-issues/` 作回归测试。
- **前置（修复时已完成）**：修复落在「双后端一致」约束内——C 后端（`codegen_c`）须同步验证；`tc run` 验收即双后端一致证据。后续若改动相关 codegen 路径，复跑 `node tools/gate.mjs L2` 保自举不动点，并视情况将两用例纳入 `tests/variant_smoke` 自动回归。
- **关联待办（非本次范围）**：struct match 绑定模式 `Pt{ x: a, y: b }` 的 sema 支持（当前 `T-SEM-E201`）仍开放，建议单独排期评估放开。

## 5. 变更记录

- 2026-09-04（续 10）：由 `docs/code-style-guide.md` §1 后端状态注记中披露的两处 codegen 缺陷，登记为本文件 KI-001 / KI-002，附 `tests/known-issues/` 复现用例与验收标准。
- 2026-09-04（续 11 · 前导点语法）：前导点提交 `9224f06`(`.{...}` 匿名结构体字面量)/`898de07`(`.Red` match 臂) 落地后，复用 `out/dbg/tc.exe` 23:38 构建**复核 KI-001/KI-002 仍 open**（报错一致，未随前导点提交修复）；同时确认前导点语法仅覆盖 struct `.{...}` 与 enum `.Red`，**variant 构造器前导点 `.Circle(5)` 报 `T-DOT-E102` 尚不支持**——已同步写入 `code-style-guide.md §1`。
- 2026-09-05（续 12 · KI-001/KI-002 修复闭环）：用户确认「001、002 具名结构体已通过、匿名结构体字面量也通过」。复用最新 `out/dbg/tc.exe` 02:19 构建（含 `fb6eeaf` fix(variant): 前导点变体构造器在 match 臂与值位的正确脱糖）复跑复现用例：`KI-001_variant_anon_literal.tc` → stdout `5`、无 IR 报错；`KI-002_struct_literal_pat.tc` → stdout `0`、无 IR 报错。两缺陷状态置 `closed`；前导点 variant 构造器 `.Circle(5)` 同提交解除 `T-DOT-E102` 后可用。`code-style-guide.md §1/§5/后端注记` 同步去除 KI 绕过写法、`docs/INDEX.md` 追加续 12 变更日志。
