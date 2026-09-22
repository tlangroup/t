# T 语言新一代编译管线设计（2026 版）

> 状态：草案 v0.1（设计阶段，尚未落地，作为后续讨论基础）
> 作者：Buddy（编译管线设计专家视角，参照 2026 前沿语言管线）
> 关联：`docs/compiler/tir-design.md`（TIR 子设计）、`docs/compiler/device-design.md`（GPU 路径）、`tools/gate.mjs`、`tools/ir_snapshot.mjs`

---

## 0. 文档定位与范围

本文把之前设计的 **TIR（无类型文件级线性 IR）** 放进 **完整编译管线** 中，并在其上游补齐 **HIR / mir（优化层）· tmir（机器中间层）** 两级（优化层 + 机器层）、在其下游补齐 **多后端 + 链接全局优化** 层，形成一套可演进 5–10 年、不落后于主流语言的管线。

核心诉求（用户原话提炼）：

1. **TIR 的首要目的**：C 与 LLVM 两个后端都从 TIR lowering，而不是各自从 AST 直接发射（详见 §4.4 与 `docs/compiler/tir-design.md`）。
2. **更多设计目标由本文设定**（见 §1）。
3. **对标 2026 前沿**：参照 Rust/Swift/Zig/Mojo(MLIR)/Julia/Go/V8 的管线，重设计 T 的管线，加入更多节点。
4. **十年竞争力**：让 T 的编译管线在未来 5–10 年不落后于其他语言。

---

## 1. 设计目标（本文设定，G1–G12）

| 编号 | 目标 | 说明 |
|---|---|---|
| **G1** | 后端无关 | 每个后端有唯一 IR 真相源，杜绝双后端漂移（根治 Bug1/Bug2 类问题）：C / WASM / RISC-V / Cranelift / GPU **消费 tmir**（TIR 降级得到）lowering；**LLVM 例外**——release 主后端直接消费 **TIR**，自管其机器表示（LLVM IR / MIR / 寄存器分配），不经由 tmir。tmir 是「一套 IR、多个便携薄后端」的桥，不是 LLVM 的机器层 |
| **G2** | 多级 IR、职责单一 | HIR(语义) / mir(优化+所有权) / TIR(类型擦除·线性) / tmir(机器桥) 各管一段，互不越界 |
| **G3** | 中端优化后端无关 | 内联/常量传播/DCE/循环变换/自动向量化在 mir 做一遍，所有后端受益 |
| **G4** | 增量编译 | 基于查询（query）的依赖图 + 内容寻址缓存，改一行只重编受影响函数 |
| **G5** | 并行编译 | 函数级 / CGU 级 / 模块级并行，吃满多核（对标 Zig 自托管后端并行 codegen） |
| **G6** | 多目标 | native(LLVM) / 便携(C) / 快调(Cranelift) / Web(WASM+WASI) / GPU(SPIR-V/NVVM/ROCDL) |
| **G7** | 全局优化 | ThinLTO + PGO(插桩/采样) + BOLT 后链接优化 + 跨模块内联 |
| **G8** | 确定性可复现 | IR/产物不含时间戳/路径，内容寻址，bit-identical 构建 |
| **G9** | 可观测 | 自 profiling、管线可视化、机器可读诊断、结构化 JSON 事件 |
| **G10** | ML 驱动优化 | MLGO 式用模型替代内联/寄存器分配启发式；PGO 数据反馈 |
| **G11** | 自举不动点不破 | 新管线不改变 `tc.tc` 自身，兼容 `gate L2` 四代自举 `g2==g3==g4` |
| **G12** | 渐进落地 | 每个 Stage 以 `gate L2` 全绿为合并门槛，可回退 |

---

## 2. 2026 前沿参照与启示

### 2.1 标杆管线

| 语言 | 管线形态 | 可借鉴点 |
|---|---|---|
| **Rust** | `AST → HIR → THIR → mir → LLVM / Cranelift / GCC` | mir 中端优化 + 多后端可插拔（`rustc_codegen_ssa` 抽象层）；2025 年 Cranelift 后端使 debug 代码生成时间降约 20%、clean build 降约 5% |
| **Swift** | `AST → SIL(high/low) → LLVM IR` | 高层/低层 SIL 两段式，ownership 在 SIL 显式化 |
| **Zig** | `AST → SSA(自研) → 自托管后端 / LLVM` | 2025 中起自托管 x86-64 后端成为 debug 默认，绕开 LLVM，wall-clock 提速 5–50%；release 仍走 LLVM |
| **Mojo / MLIR** | `多 dialect 渐进 lowering` | 多级 IR、dialect 可扩展、渐进降级的工程范式 |
| **Julia / Go** | `typed IR → LLVM` / `gc 内 SSA → 机器码` | SSA 中端、GC 集成 |
| **V8 TurboFan** | `Sea of Nodes` | 海节点 IR、调度与寄存器分配解耦 |
| **MLIR** | `builtin/func/arith/llvm/scf/affine/vector/gpu/spirv` | 多级 dialect + progressive lowering；GPU 经 `gpu → nvvm/rocdl/spirv` 分支；IREE 用 SPIR-V 服务 Vulkan/OpenCL |
| **LLVM 生态** | `ThinLTO / PGO / BOLT / MLGO` | 全局优化与 ML 驱动启发式（MLGO 用 RL 训练内联/寄存器分配，已在 Google 生产，省 3–7% 体积、提升性能） |

### 2.2 关键启示（写入设计）

- **A. 多级 IR 是主流**：Rust(HIR/mir)、Swift(SIL high/low)、MLIR(dialects) 都证明"一级 IR 包打天下"会腐烂。T 必须分层。
- **B. LLVM 用于 release，绕开它用于 debug**：Rust(Cranelift) 与 Zig(自托管) 的共同结论——**保留 LLVM 做优化发布，用更快的 codegen 走 debug**。T 应直接支持"按 profile 选后端"。
- **C. 中端优化放在后端无关层**：内联/常量传播/向量化在 mir 做一遍，所有后端白嫖。
- **D. GPU 走 SPIR-V/NVVM 渐进降级**：与 T 已设计的 Device Dialect（`docs/compiler/device-design.md`）天然契合。
- **E. ML 已进入生产编译器**：MLGO 证明"用模型替代启发式"可行且可部署（XLA AOT 嵌入，无 TF 运行时依赖）。T 应在 PGO 之上预留 ML 决策接口。
- **F. 增量 + 并行 + 缓存是工程护城河**：Rust 的 query 系统、Zig 的并行 codegen、sccache 式缓存，是"大项目不卡"的三件套。

---

## 3. T 新管线总览（节点图）

```
 源 ──▶ Lex/Parse ──▶ CST
                     │
                     ▼
                 ┌───── HIR（ZIR 槽位）─────────┐   未定型·线性·可序列化
                 │ (AstGen: CST→HIR)           │   per-file 磁盘缓存锚点
                 │ 宏/agent展开·脱糖·名字解析   │   惰性诊断·增量编译承重墙
                 └──────────┬───────────┘
                            ▼
                 ┌───────── mir ─────────┐   中层 IR (CFG + SSA)
                 │ 显式控制流·drop/所有权 │   中端优化: 内联/常量传播/DCE/
                 │ borrow检查(NLL)·单态化 │   循环变换/自动向量化/多面体
                 └──────────┬───────────┘
                            ▼
                 ┌───────── TIR ─────────┐   类型擦除·文件级·线性 IR（mir 与 tmir 之间）
                 │ ABI事实集中(TT表)·     │   (详见 docs/compiler/tir-design.md)
                 │ 存储类型格 ST·slot模型 │
                 └──────────┬───────────┘
                            ▼
                 ┌───────── tmir ─────────┐   机器中间层：显式 CFG + 机器类型 ST_*
                 │ 仅做转换（TIR'+ARR+'tmir 结构重分组）│   桥接便携薄后端(非LLVM)（★本层不承载优化）
                 │ 虚拟 slot·无 φ·无优化    │
                 └─────┬──────┬──────┬───┘
        ┌──────────────┘      │      └───────────────┐
        ▼                     ▼                      ▼
  ┌──────────┐        ┌──────────────┐       ┌──────────────┐
  │ LLVM     │        │ Cranelift    │       │ C (clang)    │   ← 按 profile 选
  │ 直消费   │        │ (debug 快)   │       │ (便携/自举)  │
  │ TIR①     │        │ ~10x codegen │       │              │
  └────┬─────┘        └──────┬───────┘       └──────┬───────┘
       │                     │                      │
       │            ┌────────┴────────┐             │
       │            ▼                 ▼             │
       │      ┌──────────────┐  ┌──────────┐         │
       │      │ WASM Component│  │ SPIR-V/  │ (GPU)   │
       │      │ Model+WIT ★G-3│  │ NVVM/    │         │
       │      └──────┬───────┘  │ ROCDL    │         │
       └──────────┼──────────────────┼──────────────┘
                  ▼                  ▼
            ┌──────── 链接与全局优化 ────────┐
            │ CGU划分·ThinLTO·PGO·BOLT·      │
            │ 跨模块内联·死代码剔除          │
            └──────────────┬────────────────┘
                           ▼
                       可执行/库/对象

> ① **LLVM 不消费 tmir**：release 主后端直接消费 **TIR**，自管机器表示（LLVM IR → MIR → 寄存器分配），走既有 `codegen_ll`。tmir 仅桥接便携薄后端（wasm/riscv/C/Cranelift/GPU）；LLVM 有自己的机器层，不经 tmir 中转。

  ╔════════════════ 横切系统（贯穿全管线）════════════════╗
  ║ 增量/查询(salsa) · 并行(rayon式) · 内容寻址缓存(sccache) ║
  ║ 确定性构建 · 富诊断/机器可读 · 自观测profiling · MLGO  ║
  ╚══════════════════════════════════════════════════════╝
```

**节点清单（管线阶段）**：
0. **Driver / Query / Scheduler（贯穿引擎）★G-1**：跑管线的引擎——查询依赖图 + red-green 指纹 + work-stealing 调度 + 分片缓存（详见 §5.1 / §5.2）
1. Lexer / Parser → CST
2. **HIR**（= ZIR 槽位：未定型·线性·可序列化）—→ 产出 **`.tmi` 模块接口制品 ★G-2**
3. **mir**（中层 IR：CFG + SSA + 中端优化；可选 borrow-verify pass ★G-7；读 `target_desc` ★G-10）
4. **TIR**（类型擦除·文件级·线性 IR——mir 与 tmir 之间；IR 级 FDO 布局 ★G-11）
4.5 **tmir**（机器中间层：显式 CFG + 机器类型 `ST_*`；TIR 之后、仅做转换（结构重分组）、不承载优化；**桥接便携薄后端**（wasm/riscv/C/Cranelift/GPU）；**LLVM 不在此层**——release 主后端直消费 TIR）
5. **后端层**：**便携薄后端消费 tmir**（薄发射器 tmir'+ARR'+c / tmir'+ARR'+wasm / tmir'+ARR'+riscv / tmir'+ARR'+spirv）；**LLVM 例外**——直消费 TIR（既有 `codegen_ll`，自管 LLVM IR/MIR，不经 tmir）。Cranelift/WASM/SPIR-V 走 tmir；native release 走 TIR
6. **链接与全局优化**：CGU · ThinLTO · PGO · BOLT · 跨模块摘要缓存(增量 LTO) ★G-5
7. **持久会话 / JIT（REPL·Notebook）★G-4**：消费 HIR 缓存 + `.tmi`，增量编译输入
8. **远程内容寻址缓存（hermetic action cache）★G-6/G-12**：CI/分布式构建共享
9. **横切**：查询/调度 · 并行 · 缓存 · 确定性/hermetic · 诊断 IR(SARIF) · 自观测 · MLGO+autotuning

---

## 4. 各级节点详设

### 4.1 词法 / 语法（Lexer → Parser → CST）
- 沿用现有 `lex.tc` + `parse.tc`；CST 保留完整源码锚点（行/列/文件）供诊断。
- 前端脱糖（agent 展开、函数子句、lambda 提升为 `closure_make`/`__env_N`）在此完成，产出 **HIR 输入**。

### 4.2 HIR —— ZIR 槽位（未定型 · 线性 · 可序列化）

> **采纳 A（2026-09-04）**：HIR 重定义为 Zig 的 **ZIR 槽位**——未定型 · 线性 · 可序列化，位于 Sema **之前**。权威规格见 `docs/compiler/hir-design.md`（含四大性质、指令集草图、与 Sema/CTFE 接口）。本节仅保留与总管线相关的要点，避免与 hir-design.md 重复。

> **实现状态（与管线对齐，2026-09-22 更正）**：HIR 是前端 IR 锚点（增量编译承重墙 + 惰性诊断 + CTFE 解释对象），位于 mir/TIR/tmir 之上。**HIR 已落地（2026-09-21 起，提交 855349d / 633545d）**：`emit-hir` 产真实 HIR + 二进制往返一致；`check` 管线经 AstGen 生成 HIR；**Stage B 全量 sema 已改为消费 HIR 指令流**（RAW 逃生舱 300→0，`infer_expr` 98% 下降边经 HIR），CTFE 经 `src/hir_eval.tc` 解释 HIR。当前发货管线为 `Lex/Parse →(AstGen) HIR → Sema(消费 HIR) → TIR → {mir→tmir→便携后端}`，LLVM 直消费 TIR（见 §4.5 / 管线图①）；类型在 Sema 消费 HIR 时推断、TIR 阶段擦除。这与 v3 §2「类型槽」设计不冲突：类型槽是 HIR 的**前瞻补位**，HIR 落地后已并入其缓存/重入体系。HIR 在管线中的**位置**不变（永远是顶层前端 IR）。（旧版「HIR 尚未落地 / 发货管线 sema→TIR」已于本次扫描更正——该陈述已过时。）

- **性质**：未定型（源类型注解为未解析名字引用）、线性（扁平指令数组）、可序列化（文本+二进制双格式）。
- **来源**：CST 经 AstGen（宏/agent 展开、脱糖、名字解析的**未解析**形式）生成；**不做类型推断**（那是 Sema 的事）。
- **职责边界**：HIR 是"增量编译承重墙 + 惰性诊断"的锚点（见 `hir-design.md §1`），也是 CTFE 解释执行的对象；**不携带 ABI / 存储类型**。
- **增量缓存**：HIR 以**源文件内容哈希**为键进入查询缓存（salsa 式 + G-1 分片缓存），是本管线中**唯一**可 per-file 磁盘缓存的层。
- **与 `.tmi` 分离**：HIR 缓存（pre-type）供本模块 Sema 重入；typed 接口 `.tmi` 供下游依赖（见 §4.2b）。

> **张力已解（采纳 A）**：原「类型化 HIR」只在「类型化树」解读下才会与 per-file 缓存冲突；采纳 A 后 HIR 是 pre-type，冲突消除。裁定依据与 CTFE 重写为解释 HIR 的成本见 `docs/compiler/ir-taxonomy.md §6` 与 `docs/compiler/hir-design.md`。

> ⚠ **HIR 缓存（pre-type）与模块接口 `.tmi`（typed）必须分离**（见 §4.2b）：前者供本模块 Sema 自身重入（键=源内容），后者供下游依赖消费（键=API 指纹）。两者解决的是两个不同的增量粒度问题，不能混为一谈。

### 4.2b 模块接口制品 `.tmi`（typed interface，★G-2）

> 详细规格见 `docs/compiler/tmi-design.md`（本小节仅保留与总管线相关的要点，避免重复）。

- **定位**：HIR 缓存（pre-type，键=源内容）解决"本模块 Sema 重入"；`.tmi`（typed，键=**API 指纹**）解决"下游依赖跳过对本模块的 type-check"。二者是**两个独立的增量粒度**，必须分离（详见 §4.2 张力说明与 `hir-design.md §3`）。
- **内容**：本模块导出符号的完整类型签名、泛型定义、comptime 常量值、类型别名解析结果、API 指纹、依赖 `.tmi` 指纹清单。
- **失效键**：`hash(导出签名 + 泛型定义 + comptime 常量 + 依赖指纹)`；**范围含 `pub` 导出 + same-package `path` 可见符号（决策 (A)，见 `tmi-design.md §3.1`）**；改实现不改签名 ⇒ 指纹不变 ⇒ 下游零重编（声明级失效，见 `tmi-design.md §3`）。
- **与 TIR 拆快照键的关系**：`.tmi` 描述接口、TIR `foo.tir`/`foo.tir.inst` 描述实现产物，二者独立（见 `tir-design.md §4.2.1` / `tmi-design.md §5`）。
- **消费方**：普通编译（第一消费者）+ 持久会话/REPL（第二消费者，见 `persistent-session-design.md`）。

### 4.3 mir —— 中层 IR（CFG + 所有权 + 中端优化）
- **来源**：HIR 经 **单态化（泛型实例化，沿用 `instantiate_generic`）** 与 **comptime 折叠** 后降级为 mir。
- **特征**：
  - **控制流图（CFG）**，基本块 + SSA 值（对标 Rust MIR / Go SSA）。
  - **显式资源管理**：`drop` 节点（若 T 引入所有权/RAII），`borrow`/`NLL` 检查在 mir 做（可选引入，见 §11）。
  - 仍是**类型化**的（保留足够类型信息供优化与降级），但已是"机器友好"的中层。
- **中端优化（后端无关，做一次）**：
  - 内联（monomorphized 后）、常量传播、死代码消除（DCE）、
  - 循环不变量外提、循环 interchange/tiling（多面体 Polyhedral，对标 MLIR affine/linalg）、
  - **自动向量化**（对标 MLIR vector dialect）、公共子表达式消除（CSE）。
- **收益**：这些优化在 mir 写一遍，LLVM/Cranelift/C/WASM/GPU 全部受益——避免在每个后端各写一遍（这正是当前 T 的痛点）。

### 4.3b 目标特征矩阵 `target_desc`（★G-10）

> 详细规格见 `docs/compiler/target-desc-design.md`。

- **定位**：目标知识（ISA/向量宽度/对齐/调用约定/地址空间/指针位宽）的**单一数据源（SSoT）**，所有需要目标知识的层都读它，而非各自 hardcode——消除"目标知识散落各后端"的漂移源（双后端漂移的近亲问题）。
- **读取方**：mir 自动向量化（读向量宽度+ISA）、TIR ABI 生成（读调用约定/对齐/指针位宽）、后端选择（读 ISA/地址空间）、链接布局（读页大小/缓存行做 IR 级 FDO）。
- **与 TIR `ST` 关系**：`ST` 描述"值如何搬运比特"，`target_desc` 描述"目标如何摆放这些比特"；struct 实际对齐/填充由 `target_desc` 决定 ⇒ TIR 跨目标可复用，布局决策外置。

### 4.4 TIR —— 类型擦除的线性 IR（mir 与 tmir 之间）★
- **承接**（详 `docs/compiler/tir-design.md`；跨语言对位与命名裁定详 `docs/compiler/ir-taxonomy.md`）：mir 经"类型擦除 + ABI 事实集中（TT 类型表）+ 线性化（slot 模型）"降级为 TIR。
- **对位**：TIR 不是 Zig 的 ZIR（那是 sema **之前**的未定型指令流），而是 **Zig 缺失的那一层**——AIR 之后、tmir 之前的共享桥（tmir 为各后端之前的机器桥）。Zig 让每个后端各自把 AIR 降到自家 mir（`src/codegen/x86_64/CodeGen.zig` ≈10.4 MB、`llvm.zig` ≈580 KB、`c.zig` 另一套），对手写机器码后端是合理取舍；但 T 的后端都只是**文本 IR 发射器**（不做寄存器分配/指令选择），重写一遍拿不到自由度、只拿到漂移。Rust 用 `rustc_codegen_ssa` + `BuilderMethods` trait 解了同一问题（官方数据复用约 10,000 LOC）；T 选择**物化成数据**而非 trait，额外换来单一 `.tir` md5 快照与 device 路径复用。理由详 `ir-taxonomy.md §4`/§5。
- **本质**：**无源类型、文件级、线性**——每个值只带存储类型 `ST`（定宽整数/浮点/指针/聚合/函数指针/void），ABI 事实（String=`{ptr,len}` 等）集中在 TT。
- **为什么必须存在**：让所有后端有**单一类型真相源**，而非各自从 AST 重新推导类型。C / WASM / RISC-V 经 **tmir（TIR 降级得到）** lowering 到目标语法，成为薄翻译器（§5.5）；**LLVM 直消费 TIR**（自管 LLVM IR/MIR，见 §4.5 与管线图①）——它有独立机器层，不经 tmir 中转。双后端漂移（Bug1/Bug2）根源是 C 与 LLVM 各写一遍类型恢复(`expr_type_desc`/`ll_etd`)、类型映射(`desc_to_c`/`ll_td`)；TIR 把类型语义收敛为单一真相源，release/便携后端都只从它派生，不再各自猜回。
- **文件级**：一个 TIR 模块 = 一个 `.tc` 编译单元；是快照/对拍/门禁的基本单位（取代按 `.ll`/`.c` 文本 md5）。⚠ `.tc` 是**分区键**而非**独立可缓存单元**——TIR 在全程序单态化之后，缓存承重墙在 HIR(=ZIR) 层（`tir-design.md §4.2`）。

> **TIR 规格已全部拍板（2026-09-04，详 `docs/compiler/tir-design.md §15`）**：
> 1. **ST 命名**：LLVM 记号为基 + 三处显式偏离（整数带符号性 → C 后端不必回头推导；指针带 pointee+aspace → C 取 pointee 发 `T*`、LLVM 丢弃发 opaque `ptr`、device 取 aspace；聚合具名引用 → C 发 `typedef` 名 + diff 噪声最小）。命名空间三分：`%`=类型 / `$`=值 slot / `@`=符号。
> 2. **`T?` ABI**：Stage 1 **严格沿用现状** `opt.boxed`（可空装箱指针，`none`=null，`some` 走 arena）；`{i8, ST}` 按值形态收进规格为 `opt.tagged`，**Stage 5+ 独立启用**。原始裁定「用 `{tag,payload}`」与「严格沿用现有布局」实证互斥，解法见 `tir-design.md §15.2`。
> 3. **memory-first**（SSA 归本文 §4.3 的 mir 层）。
> 4. **双序列化格式**：文本 `.tir` = 规范真相源（md5 快照只对它算）；二进制 `.tirb` = 速度格式（增量缓存 / device 内嵌 bytecode / 远端构建），带 **round-trip 逐字节门禁**。
> 5. **模块边界 1:1 `.tc`**；单态化实例按**定义点归属** + `linkonce_odr` 去重。

### 4.5 后端层（多目标 codegen，按 profile 选择）
| 后端 | 用途 | 选型策略 | 状态 |
|---|---|---|---|
| **LLVM** | release / 极致优化 | 默认 release；最佳代码质量；**直消费 TIR**（自管 LLVM IR/MIR，不经 tmir） | 主后端（沿用现有 `codegen_ll`） |
| **Cranelift** | debug / 快编 | profile=dev 时启用；codegen 约 **10× 快于 LLVM**（Rust 实测 ~20% 省代码生成时间） | 新增（tmir→Cranelift） |
| **C** | 便携 / 自举 / 无 LLVM 环境 | 嵌入/教学/自举引导 | 沿用（重写为 tmir→C） |
| **WASM / Component Model** | Web / 沙箱便携 / **多语言插件·ERP 扩展** | `wasm32-wasip1`(legacy) + `component`(新，★G-3)；生成 `.wit` + `wasm-tools component new` | 新增（tmir→wasm，经 LLVM wasm 或独立；Component Model 由 WIT 发射器覆盖，沙箱隔离验证见 `wasm-component-design.md` BP-2） |
| **SPIR-V / NVVM / ROCDL** | GPU 计算 | `kernel fn` 走 tmir→Device Dialect（见 `docs/compiler/device-design.md`） | 沿用 device 路径 |

- **后端无关抽象层（对标 `rustc_codegen_ssa`）**：定义 `BackendTraits`（布局/`ST→目标类型`/链接/debuginfo），**tmir 系后端**实现 traits、复用整条 tmir 遍历机（保证"加一个新便携后端只写 traits，不碰 tmir 语义"）；**LLVM 例外**——release 路径直消费 TIR，由既有 `codegen_ll` 自管到 LLVM IR 的 lowering，不参与 tmir 遍历机（其 `BackendTraits` 落在 LLVM 侧）。

### 4.6 链接与全局优化（CGU · ThinLTO · PGO · BOLT）
- **CGU（Codegen Unit）划分**：按模块/函数图切分，供并行 codegen 与增量。
- **ThinLTO**：跨模块内联与过程间优化，不牺牲并行性。
- **PGO**：插桩 PGO（训练构建）+ 采样 PGO（生产侧 eBPF/perf），反馈驱动内联/布局/向量化。
- **BOLT**：后链接（post-link）重排基本块/函数布局，榨取 icache/TLB 收益。
- **IR 级 FDO 布局（★G-11）**：在 TIR/mir 级用 PGO 数据做**基本块/函数布局**，拿 BOLT 大部分 icache/TLB 收益而**不需 post-link 工具链**——作为 BOLT 的更可移植补充/替代。
- **死代码/重复剔除**：`--gc-sections` / `/OPT:REF`。

#### 4.6.1 跨模块摘要缓存（增量 LTO，★G-5）

ThinLTO / PGO 所需的**跨模块摘要**（类 LLVM ThinLTO summary index / Rust cross-crate metadata）按**内容哈希缓存**，启用 **增量 LTO**：跨构建复用摘要，不每次重算全程序摘要。规模化必备——与 G-1 的查询缓存、G-6 的远程缓存共用同一 action-key 机制。

---

## 5. 横切系统（贯穿全管线）

> 以下子节将"增量 / 查询""并行""缓存""确定性""诊断""自观测""MLGO"从口号扩展为机制（对应 G-1/G-6/G-12 等）。各子节与独立设计文档一一对应，避免本文件重复承载细节。

### 5.1 增量 / 查询（Driver / Query / Scheduler 引擎，★G-1）

跑管线的"引擎"，不是一层 IR（详见 `docs/compiler/driver-query-design.md`）：
- **查询依赖图（salsa 式）**：`hir_of(file)`/`sema_of(file)`/`tir_of(file)`/`tmir_of(file)`/`object_of(file)`/`tmi_of(file)` … 均为纯函数 query，结果按输入指纹缓存。
- **red-green 指纹**：green=内容哈希，red=依赖子树任一 green 变 ⇒ 重算；把"增量"从"按文件"升级为"按 query/按声明"。
- **分片内容寻址缓存**：键 = query 名 + 输入指纹；分片避免单锁竞争；多级（内存+磁盘+远程）。
- **⚠ 增量正确性铁律**：增量产物必须**位等价**于 clean 产物，否则缓存即误编译源。red-green 失效完备性 + clean≡incremental 等价门禁见 `driver-query-design.md §9`、验证维度见审查维度 D7-8。

### 5.2 并行（work-stealing 三档）

函数级（mir 优化/单态实例）、CGU 级（codegen）、模块级（链接）三档并行；全局任务队列 + 每线程本地队列 + 独立分配池（对标 Rust 2024 并行前端 +30~50%、Zig 自托管并行 codegen）。详见 `driver-query-design.md §5`。

### 5.3 缓存（内容寻址，本地 + 远程）

sccache 式内容寻址；远程缓存为 hermetic action cache（见 §5.5 / G-6 / G-12），CI 从全重编变全下载。action-key = 内容哈希 + 编译器版本 + 目标三元组 + flags。**信任边界与签名校验见 `supply-chain-design.md` D8-4**——缓存条目须带签名 + 内容哈希，消费方校验不通过即本地重算，防远程投毒。

### 5.4 持久会话 / JIT（REPL · Notebook，★G-4）

Driver/Query 实例长期存活，跨"输入"保留 query 缓存 ⇒ 热重编/增量替换。HIR 缓存 + `.tmi` 的**第二消费者**。详见 `docs/compiler/persistent-session-design.md`。

### 5.5 确定性 / hermetic（G-12）

IR/产物不含时间戳/绝对路径；输入排序 + 哈希；bit-identical 复现。每个 stage 声明为 **hermetic action**（显式输入/输出、无隐式输入、稳定顺序、无宿主泄漏）——远程缓存命中（§5.3）的前提。

### 5.6 诊断 IR（跨层 span 贯通，G-9）

富诊断 + 机器可读 SARIF/JSON；源码 span 跨层贯通（HIR 锚点 → mir → TIR → tmir → 后端），LSP/CI/LLM 统一消费。详见审查维度 D5-1 / D7（误编译定位）。

### 5.7 自观测 profiling

编译器自 profiling（`-Zself-profile` 式），输出各阶段耗时火焰图 + §3 管线可视化；TIR/HIR 文本 dump 为调试编译器自身的首要手段（见 `tir-design.md §12`）。

### 5.8 MLGO + autotuning（G-10 决策 / G-8 GPU）

PGO 之上预留 ML 决策接口（内联/regalloc，LLVM MLGO 范式）；GPU 路径加 ML autotuning 层（见 `device-design.md §5.1`）。**治理约束**：learned 决策必须纳入 hermetic action key（§5.5）、过正确性回归门禁且可自动回退（D7-9），否则不得 ship——见 `device-design.md §5.1`。

## 6. 优化分层布局（pass 在哪一级做）

| 优化 | 层级 | 理由 |
|---|---|---|
| 宏/agent 展开、脱糖、类型推断 | HIR | 语义层，需完整源信息 |
| 单态化、comptime 折叠 | HIR→mir 边界 | 必须 concrete 后才能降级 |
| 内联、常量传播、DCE、CSE | **mir** | 后端无关，做一次 |
| 循环变换、自动向量化、多面体 | **mir** | 中层 CFG/SSA 最适合 |
| borrow / 所有权 / drop 检查 | **mir** | 资源管理在语义与机器之间 |
| ABI 布局、slot 分配、 lowering 到 ST | **TIR** | mir 与 tmir 之间，集中 ABI 事实 |
| 机器类型化、CFG 重组（仅转换，不优化） | **tmir** | TIR 之后，喂薄后端 |
| 指令选择、寄存器分配、调度 | 各后端 | 机器相关 |
| 跨模块内联、PGO、ThinLTO、BOLT | 链接/后链接 | 全局视角 |

---

## 7. 目标矩阵

| 目标三元组 | 默认后端 | 场景 |
|---|---|---|
| `x86_64-pc-windows-msvc` / `gnu` | LLVM(release) / Cranelift(dev) | 桌面 |
| `aarch64-apple-darwin` 等 | LLVM / Cranelift | 移动/桌面 |
| `wasm32-wasip1` | LLVM-wasm | Web/沙箱 |
| `nvptx64-nvidia-cuda` | SPIR-V→NVVM/PTX | GPU（见 device-design） |
| `spirv-unknown-*` | SPIR-V | Vulkan/OpenCL 计算 |
| `c-unknown-unknown` | C(clang) | 便携/自举/无 LLVM |

---

## 8. 与现有 `gate L2` 自举不动点的兼容（G11）

- 新管线插入 **HIR/mir/TIR/tmir** 后，`tc.tc` 自身不含泛型使用/kernel，故 `g2==g3==g4` 不动点不受影响（`device-design.md` 已确认同类结论）。
- **IR 漂移归零铁律沿用**：改前端后先同步 `tc.exe`，再重录 **TIR 基线**（`tools/tir_snapshot.mjs --update`）。⚠ **现状（2026-09-22 扫描）**：`gate.mjs` 的自举不动点（`boot23`/`boot4`）实际以 **`.ll` md5** 为 oracle（见 `tools/gate.mjs` 与记忆「致命坑 5」），`tests/tir_baseline.json`（`.tir` 发射稳定性）由 `tir_snapshot.mjs` **并行护卫**；设计目标「以 `.tir` 为唯一不动点 oracle」尚待收口，当前 `.ll` md5 仍为实际判据。判不动点只比产物 md5、非 `.exe` md5 的原则不变。
- 现有 `.ll`/`.c` 文本 md5 作为端到端安全网保留。

---

## 9. 分阶段落地路线（结合 `tir-design.md` Stage0-5，扩展为 Pipeline A–L）

- **A. AstGen + Driver/Query 层 + `.tmi` 三件套（P0，★G-1/★G-2）**：CST → HIR（ZIR 槽位，未定型·线性·可序列化）；**同期**立 Driver/Query/Scheduler 层（§5.1 查询依赖图 + red-green 指纹 + work-stealing + 分片缓存）与 `.tmi` 模块接口制品（§4.2b）。`hir-design.md` 为 HIR 规格。不动后端、不动 TIR。⚠ 三件套必须同期立——HIR 缓存（pre-type）确立了，但缺查询层则增量只是缓存命中、缺 `.tmi` 则下游仍重 type-check；二者与 A 同属"立增量承重墙"的一件事。
- **A'. CTFE 重写（选项 A 核心成本，与 TIR 解耦）**：`meta_eval_call` / `comptime_fold_pass` 从 AST 树求值改为**解释 HIR 指令流**；Sema 改为消费 HIR。单独 gate，作为回退 B 的隔离线。
- **B–F. TIR（沿用 Stage0-5）**：建 `src/tir.tc` + `emit-tir`；先子集降级；再 `tmir→c` 薄后端（便携）；`emit-ll` 直消费 TIR（自管 LLVM IR/MIR，不经 tmir）；删除重复 lowering；上线 `tir_snapshot` 门禁。
- **G. mir 抽取**：在 TIR 之前插入 mir（CFG+SSA+显式 drop），先把"控制流扁平化/常量折叠"从后端提到 mir（哪怕初始 mir 仅做透传降级，也为优化留接口）。
- **H. mir 中端优化**：内联 + 常量传播 + DCE + CSE（后端无关，验证双后端一致收益）。
- **H'. tmir 机器层**：TIR→tmir 结构重分组（仅转换，不承载优化）；**便携薄后端由消费 TIR 改为消费 tmir**（tmir→c/wasm/riscv/spirv），tmir 成为「一套 IR、多个便携薄后端」的桥（见 `pipeline-implementation-route.md §9`）。**LLVM 不在此列**——release 主后端直消费 TIR、自管 LLVM IR/MIR（见 §4.5），其机器层由 LLVM 自身提供；tmir 只服务于无自有机器层的轻量目标，不替代 LLVM 的机器表示。
- **I. 后端抽象层 + Cranelift**：抽 `BackendTraits`，加 `tmir→cranelift`（debug 快编路径）。
- **J. 链接全局优化**：CGU 划分 + ThinLTO + PGO 接入。
- **K. WASM / SPIR-V**：扩展目标矩阵；GPU 经 tmir→Device Dialect。
- **L. MLGO / 确定性 / 增量缓存**：PGO 反馈 + ML 决策接口；内容寻址缓存 + 确定性构建。

每 Stage 结束以 `gate L2` 全绿 + TIR 基线稳定为合并门槛。

### 9.1 实现状态总表（2026-09-22 扫描，对照实际仓库）

> 本表为对 `docs/compiler/compiler-pipeline-design.md` 的查缺补漏：以 `src/*.tc`、`tools/*.mjs|*.py`、各 `docs/compiler/*.md` 的实际存在与接线为准，标注「设计 vs 落地」是否相符，并判定文档正确性。

| 设计项（编号） | 文档主张 | 实际状态（扫描） | 判定 |
|---|---|---|---|
| **HIR（ZIR 槽位）** §4.2 | 草案称「尚未落地，发货管线 sema→TIR」 | **已落地**：`src/hir.tc`、`emit-hir` 真实产出 + 二进制往返一致；Stage B 全量 sema 消费 HIR（`src/sema.tc` `infer_expr_hir` 等）；CTFE 经 `src/hir_eval.tc` | ⚠ **文档过时（已更正 §4.2）**——文档该陈述错误，实际已落地 |
| **TIR** §4.4 | mir 与 tmir 之间，类型擦除线性 IR；LLVM 直消费、便携后端经 tmir | 一致：`src/tir.tc` + `src/tir_to_ll.tc`（LLVM 直消费）；`src/tmir.tc` 由 TIR 降 | ✅ 相符 |
| **tmir** §4.4/4.5 | 机器桥，便携薄后端消费 | 一致：`codegen_wasm.tc`(16×tmir) / `codegen_riscv.tc`(7×) / `codegen_c_tmir.tc`(24×) 均消费 tmir；LLVM 不消费 | ✅ 相符 |
| **LLVM 后端** §4.5① | 直消费 TIR，不经 tmir | 一致：`tc build/emit-ll/run` 走 `tir_to_ll`，绕过 mir/tmir（`src/tc.tc:607`） | ✅ 相符 |
| **C 后端（tmir→C）** G1 | 单一真相源 tmir→C，删除重复 lowering | ⚠ **两套 C 后端并存，但性质不同、非「重复 lowering」**：① `src/codegen_c.tc`（4817 行，**全功能自举/RELEASE C 后端**，消费 post-sema AST、靠 `expr_type_desc`/`desc_to_c` 类型恢复）← `tc compile --emit-c`，被 gate.mjs`cself`/ir_snapshot.mjs/bootstrap.mjs/difftest.mjs/run_examples.mjs 全用；② `src/codegen_c_tmir.tc`（863 行，**便携机器层 C 后端**，消费 tmir，仅 S1 标量+S2 聚合覆盖）← 仅 `tests/m1` 的 `tc build --backend tmir-c`。**漂移根已除**：Bug1/Bug2 类漂移发生在 LLVM↔便携后端之间，便携后端（wasm/riscv/c_tmir）现统一消费 tmir 单一源；自举 C 后端与 LLVM 同属「RELEASE 直消费前端」路径（LLVM 直消费 TIR、C 直消费 AST），二者对拍由 gate `cself` 步 **字节级 .ll 一致性** 守卫，漂移可侦测。 | ⚠ **务实收口（2026-09-22 复核）**：G1 主体（便携后端单一源 + 漂移可侦测）已达成；字面「删 `codegen_c.tc`、自举 C 迁 tmir-c」**不可行**——`codegen_c_tmir` 仅 S1+S2、`TIR_OP_CONST_STR` 标 `unsupported`、且 `build src/tc.tc --backend tmir-c` 实测 **崩溃**（`index_out_of_bounds` @`t_slice_at`，EXIT=1），无法自举整编译器。该字面收口推迟至后续 Stage：先把 `codegen_c_tmir` 扩到全语言覆盖（字符串/切片/闭包/map/内建），再令其成为唯一自举 C 后端并删 `codegen_c.tc`。当前保留双后端不破任何门禁。 |
| **mir** §4.3 / Stage G-H | TIR 前插 mir（CFG+SSA+中端优化，opt=0 恒等） | 已落：`src/mir.tc`（`mir_from_tir`/`mir_run`/`mir_to_tir_lower`），主路径 wasm/riscv/c 经 `mir_run(opt=0 恒等) → tir_to_tmir_lower`；LLVM 旁路 | ✅ 相符（初版透传，符合 §10 风险策略） |
| **`.tmi`（★G-2）** §4.2b / Stage A | P0 三件套之一，typed 接口制品 | ❌ 未实现：无 `emit-tmi` 子命令、无 `.tmi` 产物（`grep "\.tmi"` 仅在设计文档与后端注释出现，非发射逻辑） | ⚠ 文档标 P0 但未落地（设计层决策 `tmi-design.md §3` 已定，实现待办） |
| **Driver/Query/Scheduler（★G-1）** §5.1 / Stage A | P0 三件套之一，查询依赖图 + red-green + work-stealing | ❌ 未实现：仅有 `docs/compiler/driver-query-design.md` 设计，无对应引擎代码 | ⚠ 文档标 P0 但未落地 |
| **Cranelift** Stage I | debug 快编后端 | ❌ 未实现（无 `codegen_cranelift.tc`） | ✅ 符合路线图（后续 Stage） |
| **WASM Component Model / SPIR-V / NVVM** Stage K | 多目标 | 部分：wasm/riscv/device 发射器已落（v3 M 轨，`tests/m1` 三轨对拍 12/12 全绿）；Component Model/PGO/BOLT 未做 | ✅ 部分落地、其余符合路线图 |
| **PGO / ThinLTO / BOLT / MLGO / 增量缓存 / 确定性 hermetic** Stage J/L | 全局优化 + 缓存 | ❌ 未实现 | ✅ 符合路线图（后续 Stage） |
| **自举不动点 g2==g3==g4** G11 | 新管线不破不动点 | 一致：gate L2 22/22 通过，四代 `.ll` md5 全同 | ✅ 相符 |
| **不动点 oracle** §8 | 「判不动点只比 `.tir` md5」 | ⚠ 实际 gate 比 `.ll` md5（见 §8 注）；`.tir` 基线并行护卫 | ⚠ **文档措辞超前于实现（已加注 §8）** |
| **被引子文档/工具完整性** | 引用 hir/tir/device/tmi/target-desc/driver-query/persistent-session/ir-taxonomy/mir/pipeline-*/wasm-component/supply-chain/comptime/meta_design + gate/ir_snapshot/tir_snapshot/hir_test/llvm_verify/m1_difftest | 全部存在，无缺失引用 | ✅ 相符 |

**扫描结论**：
1. 文档整体是**正确且自洽的路线图**，除 HIR 状态与不动点 oracle 两处措辞外，层级/后端接线主张与实现一致；所有被引设计文档与工具均齐备，无断链。
2. **两处文档错误/超前（已更正）**：① §4.2「HIR 尚未落地」→ 已落地；② §8「只比 .tir md5」→ 实际以 .ll 为 oracle（.tir 并行护卫）。
3. **G1「C 后端单一真相源」——务实收口（非偏差、非待删）**：`codegen_c.tc`（全功能自举/RELEASE C 后端，消费 post-sema AST）与 `codegen_c_tmir.tc`（便携机器层 C 后端，消费 tmir，S1+S2）并存，但二者是**不同用途的两后端**，不是「重复 lowering」。漂移根（Bug1/Bug2：LLVM↔便携后端各自重推类型）已除——便携后端统一消费 tmir 单一源；自举 C 与 LLVM 同属 RELEASE 直消费前端路径，对拍由 gate `cself` 字节级 .ll 一致性守卫。字面「删 `codegen_c.tc`」经实测**不可行**（tmir-c 仅 S1+S2、`CONST_STR` 不支持、`build src/tc.tc --backend tmir-c` 崩溃），推迟至「tmir-c 扩到全语言覆盖」的后续 Stage。当前双后端并存不破任何门禁，不构成需立即处理的偏离。
4. **P0 未落地**：`.tmi` 与 Driver/Query 仅设计未实现，与文档 Stage A 路线图一致（非偏差），但因其标 ★G-1/★G-2，建议立项追踪。

---

## 10. 风险与回滚

- **自举不动点**：`tc.tc` 无泛型/kernel，新阶段不破 `g2==g3==g4`（§8）。
- **回归面**：B–F、I 为高风险；任一阶段双后端 `.ll` md5 安全网报警即回退该 Stage，保留旧路径。
- **Cranelift 覆盖**：初期 Cranelift 可能不支持 T 全部 ABI（对标 rustc_cg_clif 的"未支持清单"），以 `profile=dev` 兜底回 LLVM。
- **mir 复杂度**：若 mir 优化引入不确定行为，先在 G 阶段让 mir 透传（不优化），H 阶段再逐步开 pass，每 pass 独立 gate。

---

## 11. 待裁定项（请用户拍板）

1. **HIR 是否完全新建，还是复用现有 `base.nodes` 池 + 类型注解**？复用低风险，新建更干净。
2. **mir 是否引入所有权/borrow 检查**？T 当前无 borrow checker；引入则 mir 承担 NLL，但工作量陡增。建议先 mir 透传、后续再加。
3. **Cranelift 是否作为 debug 默认**？建议 `profile=dev` 默认 Cranelift、`release` 默认 LLVM。
4. **TIR 是否仍为 memory-first（非 SSA）**？Phase 1 维持（最低风险），mir 承担 SSA；TIR 后续可选 SSA 化。
5. **增量缓存范围**：仅 IR 级（HIR/mir/TIR/tmir）还是连同对象文件全缓存？建议先 IR 级。
6. **MLGO 是否纳入一期**？建议仅预留接口，PGO 先上，ML 决策后置（L 阶段）。
7. **「ZIR 槽位」已裁定采纳 A（2026-09-04）**：HIR 重定义为未定型·线性·可序列化，增量承重墙立起；CTFE 重写为解释 HIR（与 TIR 落地解耦，单独 gate）。详见 `ir-taxonomy.md §6`、`hir-design.md`。**剩余开放项已转为 G-1/G-2（P0）**：要不要与 A 同期立 Driver/Query 层与 `.tmi`——已裁定**同期立**（见 §9 A 阶段），理由见 `pipeline-review.md`。

---

### 11.2 可选 borrow-verify pass（mir 层，可开关，★G-7）

原 §11 第 2 项（是否引入所有权/borrow 检查）裁定为**可选 mir pass**，不强制进核心类型系统（对标 Odin/Jai/Lobster/Austral 的"可选、分离"验证层）：
- 默认**关闭**：mir 整段透传，drop 为占位 no-op，不引入 NLL ⇒ 不阻塞自举、首版风险最低。
- 启用时：在 mir 加 **borrow-verify pass**（独立、可插拔），不影响其他 pass；错误回指 HIR 源码映射。
- 把"要安全"与"要能自举"解耦：需要安全时开 pass，不需要时关。详细规格见 `docs/compiler/mir-design.md §6`。

## 附 A：端到端示例（同一源 → 多级 → 双后端等价）

```t
fn add(a: i32, b: i32) -> i32 { return a + b; }
```

- **HIR**：`Fn(add, [a:i32, b:i32] -> i32, Block[ Ret(BinOp(Add, Var(a), Var(b))) ])`
- **mir**：`bb0: v0 = a; v1 = b; v2 = Add(v0, v1); return v2`（SSA）
- **TIR**：`slot i32 %v0; add.i32 %v0 %a %b; ret.i32 %v0`（无类型，仅 ST）
- **tmir**：`TMIRBlock bb0 { insts: [add.i32 $v0 $a $b]; ret.i32 $v0 }`（TIR 结构重分组为显式 CFG+ST，仅转换）
- **tmir→c**：`i32 v0 = a + b; return v0;`
- **LLVM（直消费 TIR，不经 tmir）**：`%v0 = alloca i32; %t = add i32 %a,%b; store; load; ret`（TIR→LLVM IR，自管后续 MIR / 寄存器分配）
- **tmir→cranelift**：等价；debug 构建 codegen 快 ~10×。

---

## 附 B：与既有设计文档关系

- `docs/compiler/ir-taxonomy.md`：**IR 分层对位与命名裁定**（T vs Zig ZIR/AIR、Rust MIR/`codegen_ssa`、Swift SIL）。讨论「某一级 IR 对应别的语言哪一级」「为什么 TIR 不在 ZIR 的位置」「HIR 该不该改成未定型」时的唯一依据。
- `docs/compiler/tir-design.md`：本文 §4.4 的子设计，TIR 规范（ST 格 / 指令集 / 降级规则 / 双后端变薄）的唯一来源。
- `docs/compiler/device-design.md`：GPU 路径 = TIR `ptr(ST, aspace)` → Device Dialect → SPIR-V/NVVM，本文 §4.5/§7 的目标之一。
- `docs/compiler/comptime-design.md` / `docs/compiler/meta_design.md`：单态化与 CTFE 在 HIR→mir 边界完成，mir/TIR/tmir 只消费 concrete 实例。
- `tools/ir_snapshot.mjs` → 派生 `tools/tir_snapshot.mjs`：快照维度从"双后端文本"收敛为"单一 TIR 结构化"，是本文 G1/G8 的核心门禁收益。
