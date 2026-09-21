# T 编译管线设计复审与优化方案（专家视角，2026）

> 状态：复审报告 v0.1（设计阶段，作为后续讨论与落地补充的输入）
> 作者：Buddy（以"审过 2020 年后新兴编程语言管线"的视角复审）
> 关联：`compiler-pipeline-design.md`（上位总设计）、`tir-design.md`、`hir-design.md`、`ir-taxonomy.md`
> 性质：本文**不推翻**现有设计，而是补齐其机制层缺口、升级两处目标，并给出优先级路线图。所有补充大多是对现有计划的**加法**，不是返工。

---

## 0. 复审口径与方法

**复审基准（2020 年后已落地的语言/系统管线）**：

| 参照 | 关键管线事实（已查证） |
|---|---|
| **Rust** | 并行前端（nightly `-Z threads=8`，+30~50%；以 **query 系统**为基，thread-safe/sharded 缓存，每线程独立分配池，单线程降级 RefCell 仅 1–3% 开销）；`rmeta` 模块接口制品；增量架构 = `Fingerprint` + `DefPathHash` + red-green 算法 + `cache_on_disk_if`；MLGO（RL 训练内联/regalloc，生产） |
| **Zig** | ZIR 按源文件内容哈希磁盘缓存（增量承重墙）；2025 起自托管后端成 debug 默认 |
| **Swift** | SIL high/low 两段式，ownership 在 SIL 显式化 |
| **Mojo / MLIR** | 多级 dialect + 渐进 lowering；GPU 经 `gpu → nvvm/rocdl/spirv` |
| **TVM / XLA** | AutoTVM / Ansor（XGBoost learned cost model）kernel autotuning；XLA StableHLO 稳定接口层；OpenXLA |
| **WASM** | WASI 0.2 GA（2024-01）Component Model + WIT 生产可用；WASM 3.0 成 W3C 标准（2025-09）；WASI 0.3 加 async；sub-1ms 冷启、强沙箱、多语言组合 |
| **Bazel / sccache** | remote execution + 远程内容寻址缓存（大规模工业标准）；sccache 支持 S3/Redis |
| **Lean 4 / Julia / OCaml 5** | 增量编译 + 持久编译器进程 + JIT；comptime/元编程可反射编译器自身 IR |
| **Odin / Jai / Lobster / Austral / Cone** | 值语义/所有权作为**可选、分离**的验证，不强制进核心类型系统 |

**复审对象**：`compiler-pipeline-design.md` / `tir-design.md` / `hir-design.md` / `ir-taxonomy.md`。

**方法**：先确认设计已做对的部分（避免无的放矢），再按严重度列缺口，最后给落地优先级与对现有文档的修订建议。

---

## 1. 现有设计已做对的部分（先肯定）

1. **多级 IR 职责单一**：HIR(=ZIR 承重墙) / mir(优化) / TIR(线性) / tmir(桥) 各管一段，方向正确。
2. **物化 TIR 而非 trait**（比 Rust 更狠一步）：换来单一 `.tir` md5 快照 + device 路径复用。这是比 `rustc_codegen_ssa` 更进一步的决策，站得住。
3. **memory-first 论证扎实**：C 后端无法发 φ 这一条是决定性论据，且 SSA 归 mir 的分工最优。
4. **拆快照键解决单态化实例污染**（§4.2.1）：把"函数区(文件局部)"与"实例区(全局)"拆成两个 md5，是 smart 的隔离手法。
5. **双序列化 + round-trip 门禁**（§12.1b）：把"两套序列化器语义一致"变成机械判据——正是 TIR 要消灭的那类漂移在序列化层的防御。
6. **多后端按 profile 选**（Cranelift debug / LLVM release）：与 Rust/Zig 的 2020+ 结论一致。
7. **采纳 A 补 ZIR 槽位**：这是 2020+ 增量编译的承重做法（Zig 已实证），方向对。

> 结论：现有骨架在 2020+ 语境下是**正确且先进**的。下面的缺口是"机制层"与"两处目标升级"，不是路线错误。

---

## 2. 核心缺口（按严重度排序）

### G-1 ⚠ 最严重：缺少"驱动 / 查询 / 调度"层（并行与增量的真正机制）

**现状**：`compiler-pipeline-design.md §5` 把"并行/查询/缓存"列为横切系统的几个 bullet，但**从未建模其机制**。G4（增量）与 G5（并行）目前是口号。

**2020+ 事实**：Rust 2024 的并行前端（+30~50%）根基是 **query 系统**——thread-safe/sharded 缓存、每线程独立分配池、单线程降级 RefCell（1–3% 开销）；其增量架构是 `Fingerprint` + `DefPathHash` + **red-green 算法** + `cache_on_disk_if`。rustc 的"改一行只重编受影响函数"是这套机制的结果，不是单独实现的。

**T 缺的三件事**：
1. **查询依赖图**：什么查询依赖什么（parse → HIR → Sema → mir → TIR → tmir → codegen）。
2. **变更影响计算**：red-green 式指纹比对，决定哪些查询失效、哪些可复用。
3. **work-stealing 调度器 + 分片缓存**：把查询映射到线程，缓存分片避免跨线程争用（Rust 实测 8→16 线程反而下降，正是缓存争用所致）。

**提案**：新增贯穿全管线的 **Driver / Query / Scheduler 层**（不是某个 IR 层，而是"跑管线的引擎"）。这是 G4/G5 真正落地的地基——没有它，"改一行只重编受影响函数"永远只是愿望。

**落地位置**：`compiler-pipeline-design.md §3` 图最上方加"Driver / Query / Scheduler"横贯层；§5 把"增量/查询""并行"两条从 bullet 扩成子节。

---

### G-2 严重：缺少"模块接口"制品（`*.tmi`）

**现状**：`hir-design.md §3.4` 说 HIR "per-file 磁盘缓存"，`compiler-pipeline-design.md §4.2` 说"import 沿用现有符号表"。**HIR 缓存（pre-type）与"下游依赖如何消费本模块"被混为一谈**。

**2020+ 事实**：
- Rust `rmeta`：压缩元数据，下游 **type-check 时无需重解析/重类型检查本模块源**。
- C++20 `.ifc`、Swift `.swiftmodule`、Zig 缓存 ZIR + 单独 type emission。

**关键区分**：
- **HIR 缓存**（pre-type）：供**本模块 Sema 自身重入**——键 = 源文件内容哈希（已对）。
- **模块接口 `*.tmi`**（typed）：供**下游依赖**消费——捕获*已类型化*的公共表面（导出 decl + 解析后类型 + 单态相关 info），键 = **导出 API 指纹**。

**为什么缺它是真问题**：若依赖方只能消费 HIR（pre-type），它每次都得**自己重跑 Sema** 才能 type-check——于是"改 `a.tc` 的实现、不动接口"时，所有依赖 `a` 的模块仍要重 type-check。增量粒度上限被锁死在"文件级重 type-check"，而非"接口不变则零重编"。

**提案**：新增 **`*.tmi` 制品** = HIR 缓存的"typed 兄弟"。与 HIR 缓存分离：HIR 缓存键=源内容；`.tmi` 键=导出 API 指纹。当实现改动不改变 `.tmi` 指纹时，下游直接复用旧 `.tmi`，跳过 type-check。**这才能真正兑现 G4 的"改一行只编一行"。**

**落地位置**：`compiler-pipeline-design.md §4.2` 后加 §4.2b「模块接口 `*.tmi`」；`hir-design.md §3` 明确 HIR 缓存 vs `.tmi` 的分离；`ir-taxonomy.md §3` 补 `.tmi` 与 ZIR 缓存的对位行。

---

### G-3 重要且低风险：WASM 目标停留在 core-module + wasip1，未升级到 Component Model + WIT

**2020+ 事实**：WASI 0.2 GA（2024-01）Component Model + WIT 已生产可用；WASM 3.0 成 W3C 标准（2025-09）；WASI 0.3 加 async；**sub-1ms 冷启、强沙箱、多语言组合**。

**对 T 的特殊价值（业务相关性）**：Component Model 让 T 成为**多语言插件/扩展语言**——Envoy 过滤器、Spin serverless、Fermyon 主机应用扩展。对 **seesaw-erp** 而言，这是"核心不重编、业务扩展脚本化/插件化"的直接故事；Canonical ABI 取代手写 FFI glue。

**现状缺口**：`compiler-pipeline-design.md §4.5 / §7` 把 WASM 标为 `wasm32-wasip1`（core module 层），未触及 Component Model。

**提案**：WASM 目标升级为 **Component Model + WIT emission**——生成 `.wit` 接口定义 + 用 `wasm-tools component new` 产出 component；Canonical ABI 由 tmir→WASM 后端自动生成。这是**有业务相关性、低风险高收益**的具体优化（TIR 已是线性桥，加一层 WIT 发射器即可）。

**落地位置**：`compiler-pipeline-design.md §4.5` WASM 行改写为"Component Model + WIT"；§7 目标矩阵 `wasm32-wasip1` → `wasm32-wasip1`(legacy) + `component`(新)；K 阶段加"WIT 发射器"。

---

### G-4 重要：REPL / Notebook 未与查询缓存 + JIT 整合（缺持久会话层）

**现状**：REPL 是 clean-subprocess（见工作记忆）。`compiler-pipeline-design.md` 未把 REPL/Notebook 接入管线。

**2020+ 事实**：Julia / Swift / OCaml 5 / Lean 4 用**持久编译器进程 + 增量 JIT**；Lean 4 增量编译；JIT（Cranelift / LLVM ORC JIT）让 REPL 输入增量编译，不 full rebuild。

**提案**：新增 **持久会话 / JIT 层**：HIR(=ZIR) 缓存喂 JIT 路径（Cranelift / LLVM ORC JIT），REPL/Notebook 输入增量编译，不再每次 clean-subprocess。这恰好是 HIR 缓存的"**第二消费者**"——G-2 的 `.tmi` 也让 REPL 能零成本加载依赖。

**落地位置**：`compiler-pipeline-design.md` 横切或 §4 后加「持久会话/JIT」节点；与 Notebook Stage1 整合。

---

### G-5 重要：跨模块 LTO 摘要缓存未建模

**现状**：ThinLTO/PGO/BOLT 一句话（§4.6），没说摘要何时算、如何按内容哈希缓存。

**2020+ 事实**：LLVM ThinLTO summary index；Rust cross-crate metadata。

**提案**：新增 **跨模块摘要制品**（类 LLVM ThinLTO summary / Rust metadata），按内容哈希缓存，启用 **增量 LTO**（跨构建复用摘要，不每次重算全程序摘要）。规模化必备。

**落地位置**：`compiler-pipeline-design.md §4.6` 加"跨模块摘要缓存"子项；J 阶段注明"增量 LTO"。

---

### G-6 重要：远程/分布式内容寻址缓存只是 one-liner

**现状**：§5 缓存 bullet 写"sccache 式，支持本地+远程共享（CI 命中率高）"——一句话。

**2020+ 事实**：Bazel remote execution + 远程缓存是大规模工业标准；sccache 支持 S3/Redis 后端。

**提案**：把缓存显式建模为 **远程、内容寻址、hermetic action cache**，定义 **action-key schema**（输入哈希 + 编译器版本 + target + flags）。CI 从"全重编"变"全下载"。

**落地位置**：§5 缓存子节扩写；配合 G-12 的 hermetic action。

---

### G-7 中：borrow / 所有权应设计为"可选 mir 验证 pass"，而非强制类型系统

**现状**：§11.2 把 borrow 检查框为"mir 承担 NLL，工作量陡增，建议先透传"——隐含"要么全有要么全无"。

**2020+ 事实**：Odin / Jai / Lobster / Austral / Cone 把所有权/borrow 当**可选、分离**的验证/检查，不强制进核心类型系统。

**提案**：重框为 **可选 mir pass**（类强化 lint/verify 层），可开关，**不改 ABI、不阻塞 bootstrap**。把"要安全"与"要能自举"解耦——需要安全时开 pass，不需要时关。这直接降 §11.2 的风险评级。

**落地位置**：§11.2 改写为"可选 borrow-verify pass（mir 层，可开关）"；G 阶段注明"mir 可挂可选 verify pass"。

---

### G-8 前沿：GPU 路径缺 ML autotuning（AutoTVM/XLA 式）+ pass 调度 ML

**现状**：MLGO 只提内联/regalloc（§5 / §4.6）。

**2020+ 事实**：TVM AutoTVM / Ansor（XGBoost learned cost model）kernel autotuning；XLA StableHLO + cost model；OpenXLA。**GPU kernel 的 ML autotuning 收益最大**。

**提案**：在 Device Dialect → SPIR-V/PTX 路径加 **ML autotuning 层**（tile/unroll/vectorize 搜索 + learned cost model 选最优 schedule），并预留 **ML for pass ordering**（Google「ML 决定 pass 顺序」式搜索）。

**落地位置**：`device-design.md` 加"ML autotuning 层"；`compiler-pipeline-design.md §4.6` MLGO 扩写。

---

### G-9 打磨：诊断未建模为贯穿全层的 IR（SARIF）

**现状**：富诊断 + 机器可读 一句话（§5）。

**2020+ 事实**：rustc error codes；SARIF 被 GitHub/CI 采纳；LLM 辅助修复需要结构化诊断。

**提案**：每层的诊断带源 span，汇入**单一诊断 IR**（SARIF/JSON），LSP / CI / LLM 统一消费。TIR 级错误能**回指源 span**（HIR 缓存已保留源锚点，链路要接通）。

**落地位置**：§5 诊断子节扩为"诊断 IR（跨层 span 贯通）"。

---

### G-10 打磨：缺 `target_desc` 制品（目标特征矩阵）

**现状**：TT 管类型 ABI，但没有 CPU 特征/指令可用性矩阵。

**提案**：新增 **`target_desc`**（类 LLVM target triple + feature attrs / Bazel platform constraints），声明 CPU 特征（AVX2/AVX-512/NEON）、OS ABI 变体、data layout。供 **mir 的 autovectorizer** 与多后端知道可用指令。

**落地位置**：§4.3 后加「`target_desc`」；§4 类型/ABI 区补一行。

---

### G-11 打磨：IR 级 FDO 布局（比 BOLT 更便宜）

**提案**：在 TIR/mir 级用 PGO 数据做**基本块/函数布局**（IR-level FDO layout），拿 BOLT 大部分 icache/TLB 收益，不需 post-link 工具链。作为 BOLT 的更可移植替代/补充。

**落地位置**：§4.6 BOLT 项旁加"IR 级 FDO 布局"。

---

### G-12 地基：确定性 / hermetic 未建模为 action graph

**提案**：每个 stage 声明为 **hermetic action**（显式输入/输出，无隐式输入、稳定顺序、无宿主泄漏）。这支撑 G-6 远程缓存的正确性——远程缓存命中的前提就是 action 可复现。

**落地位置**：§5 确定性子节扩为"hermetic action 模型"。

---

### 地平线（不立即做，记一笔）

- **G-13 形式化/验证 lowering**（Lean 4 / Rocq）：超出 T 当前范围，但可在 TIR 层预留验证钩子。
- **G-14 comptime 作为对编译器自身 IR 的查询（反射）**：Lean 4 的元编程读编译器自身 IR；Zig comptime 有完整类型内省。HIR=ZIR 设计（CTFE 解释 HIR）已铺路——文档应**明说反射能力**，为 ERP 插件/代码生成架构开接口。

---

## 3. 优化方案总览（修订管线图）

在现有图基础上，**加粗**为本次复审新增的机制/制品节点：

```
 源 ──▶ Lex/Parse ──▶ CST
                     │
        ┌────────────▼─────────────┐
        │  Driver / Query /        │  ★新增 G-1：查询依赖图 + red-green
        │  Scheduler（贯穿引擎）    │     指纹 + work-stealing + 分片缓存
        └────────────┬─────────────┘
                     ▼
        ┌───── HIR（ZIR 槽位）─────────┐   未定型·线性·可序列化
        │ AstGen: CST→HIR              │   per-file 磁盘缓存锚点（键=源内容）
        │ 宏/agent展开·脱糖·名字解析    │
        └──────────┬───────────┘
                     │  ── 产出 .tmi（typed 模块接口，键=API 指纹）★G-2
                     ▼
        ┌───────── mir ─────────┐   中层 IR (CFG + SSA)
        │ 显式控制流·drop/所有权 │   中端优化: 内联/常量传播/DCE/
        │ （可选 borrow-verify  │   循环变换/自动向量化/多面体
        │   pass，可开关）★G-7  │   autovectorizer 读 target_desc ★G-10
        └──────────┬───────────┘
                     ▼
        ┌───────── TIR ─────────┐   类型擦除·线性 IR（mir 与 tmir 之间）
        │ ABI事实集中(TT表)·     │   IR 级 FDO 布局 ★G-11
        │ 存储类型格 ST·slot模型 │
        └──────────┬───────────┘
                     ▼
        ┌───────── tmir ─────────┐   机器中间层：显式 CFG + 机器类型 ST_*
        │ 仅做转换（TIR→tmir 结构重分组）│   桥接便携薄后端(非 LLVM)（★本层不承载优化）
        │ 虚拟 slot·无 φ·无优化    │
        └─────┬──────┬──────┬───┘
        ┌──────┘      │      └───────────────┐
        ▼            ▼                      ▼
   LLVM       Cranelift        C (clang)   ← 按 profile 选
   (release)   (debug 快)       (便携/自举)
        │  ┌─────┴─────┐
        │  ▼           ▼
        │ WASM Component Model+WIT ★G-3   SPIR-V/NVVM/ROCDL (GPU)
        │ （取代 core-module+wasip1）        │
        └──────────┼──────────────────┼──────────────┘
                   ▼                  ▼
        ┌──── 链接与全局优化 ────┐ 跨模块摘要缓存(增量LTO)★G-5
        │ CGU·ThinLTO·PGO·BOLT·  │ ML autotuning(GPU)★G-8
        │ IR级FDO布局★G-11       │
        └──────────┬────────────┘
                   ▼
        ┌ 持久会话/JIT（REPL·Notebook）★G-4 ┐  消费 HIR 缓存 + .tmi
        └────────────────────────────────────┘
                   ▼
        ┌ 远程内容寻址缓存（hermetic action cache）★G-6/G-12 ┐
        └──────────────────────────────────────────────────┘

  ╔══ 横切系统（含本次新增项）══╗
  ║ 查询/调度(G-1) · 并行 · 缓存(G-6远程) · 确定性/hermetic(G-12) ║
  ║ 诊断 IR(SARIF, span 贯通)(G-9) · 自观测 · MLGO+autotuning(G-8) ║
  ╚════════════════════════════════════════════════════════════╝
```

---

## 4. 优先级路线图（先做哪个）

> 原则：这些大多是**对现有计划的增量补充**，不推翻路线。最大新增工作量在 G-1/G-2，但它们也是增量编译真正成立的地基。

| 优先级 | 缺口 | 理由 | 对应现有阶段 |
|---|---|---|---|
| **P0** | G-1 驱动/查询/调度层 + G-2 `.tmi` | 解锁 G4/G5 的真正机制；没有它们增量/并行只是口号 | 应在 A/A' 阶段**之前或同步**立（越早越好） |
| **P1** | G-3 Component Model WASM、G-4 持久会话/JIT、G-7 borrow 可选 pass | 低风险高收益 + 业务相关性（ERP 插件化、REPL 体验、安全可选） | K / REPL / G 阶段 |
| **P2** | G-5 跨模块摘要、G-6 远程缓存、G-12 hermetic | 规模化/云就绪 | J / L 阶段 |
| **P3** | G-8 ML autotuning、G-10 target_desc | GPU 前沿 + 向量化使能 | device-design / G 阶段 |
| **P4** | G-9 诊断 IR、G-11 IR FDO | 打磨：可观测 + 可移植布局优化 | L / J 阶段 |
| 地平线 | G-13 形式化、G-14 反射 | 不立即做 | 未来专项 |

**关键提醒**：P0 的 G-1/G-2 与现有 A 阶段（HIR=ZIR）**强耦合**——既然要立 HIR 缓存，就顺手把 Driver/Query 层与 `.tmi` 制品一起设计，避免 HIR 落地后再回头补机制（那正是"先 B 后 A"会踩的坑）。建议把原路线 A 阶段升级为 **"A. AstGen + Driver/Query 层 + `.tmi` 制品"** 三件套。

---

## 5. 对现有文档的具体修订建议

| 文档 | 修订点 |
|---|---|
| `compiler-pipeline-design.md` | §3 图加 **Driver/Query/Scheduler** 横贯层 + `.tmi` + `target_desc` + 跨模块摘要 + 远程缓存 + 持久会话/JIT + Component Model WASM；§4 加 §4.2b「模块接口 `.tmi`」、§4.3 后「`target_desc`」、§4.5 WASM 行改写、§4.6 加跨模块摘要/IR FDO；§5 横切系统把"增量/查询""并行""缓存""诊断"扩成子节；§9 路线插入 P0 阶段（A 阶段升级为 AstGen+Driver+`.tmi`）；§11.2 改写为"可选 borrow-verify pass" |
| `tir-design.md` | §4 模块结构加 `.tmi` 与 `target_desc` 引用；§12 快照扩展（跨模块摘要键） |
| `hir-design.md` | §3 明确 **HIR 缓存（pre-type, 键=源内容）vs `.tmi`（typed, 键=API 指纹）** 的分离；§7 落地补 `.tmi` 产出 |
| `ir-taxonomy.md` | §3 对位表补 `.tmi` 行（与 ZIR 缓存、Rust rmeta 对位） |
| `device-design.md` | 加"ML autotuning 层"（G-8） |
| `docs/INDEX.md` | 登记本文 `pipeline-review.md` |

---

## 6. 结论

1. 现有设计骨架（**多级 IR + 物化 TIR + ZIR 承重墙**）在 2020+ 语境下是**正确且先进**的，不必返工。
2. 主要短板是**机制层缺失**——**驱动/查询/调度层（G-1）** 与 **模块接口制品 `.tmi`（G-2）** 是增量编译与并行真正成立的地基，目前只是口号；以及**两处目标升级**——**Component Model WASM（G-3）** 与 **持久会话/JIT（G-4）**，二者低风险高收益且对 ERP 业务有直接价值。
3. 其余（G-5~G-12）是规模化/前沿/打磨项，按 P2~P4 渐进接入即可。
4. **最大新增工作量在 P0（G-1/G-2）**，但建议与现有 A 阶段（HIR=ZIR）**同期设计**，避免 HIR 落地后再回头补机制。

# 附录

## 审查维度

### 使用说明

本清单采用 **维度 = 审查目的 + 检查项** 结构。每条检查项尽量附带 **证据/产物**（基准测试、门禁脚本、文档等，说明拿什么判通过）与 **对应正文缺口（G-x / 章节）**。清单同时适用于设计期走查与实现期验收，可按路线阶段（A\~L）裁剪使用。

### 维度速览与映射

| **维度编号** | **维度名**           | **审查目的（一句话）**                                    | **主要对应缺口**                    |
| -------- | ----------------- | ------------------------------------------------ | ----------------------------- |
| D1       | 语言语义维度            | 语言规则定义完备、语义无歧义                                   | G-14（地平线）                     |
| D2       | IR 架构维度           | 内核管线骨架与数据模型稳固、层间契约一致                             | G-2 / §12.1b；G-14（地平线）        |
| D3       | 工程性能维度            | 编译器自身资源可控、增量/并行有效、产出质量达标                         | G-1 / G-6 / G-8 / G-11 / G-12 |
| D4       | 适配与兼容维度           | 跑在既定环境、对外对接与版本演进稳定                               | G-2 / G-3 / G-5 / G-8 / G-10  |
| D5       | 工具与体验维度           | 面向人 / IDE / CI 的诊断、调试与集成体验达标                     | G-4 / G-9                     |
| D6       | 安全与可维护维度          | 长期生存能力：抗恶意、模块化、易维护                               | G-6 / G-7                     |
| **D7**   | **正确性与语义一致性验证维度** | **验证编译器忠实实现语言规则，杜绝误编译；含增量正确性、learned 优化与隔离属性验证** | G-13（地平线）                     |
| **D8**   | **供应链与交付安全维度**    | **交付端安全：依赖、产物、云编译分发链条可信**                        | G-3 / G-6 / G-12              |

***

### D1 语言语义维度（对外：语言规则）

**审查目的**：语言规则定义完备、语义无歧义，编译期/运行期契约一致。

**1.** 语法体系、字面量、语法糖规则（匿名 struct literal、匿名 enum literal 等）

**2.** 类型系统、类型推导、类型检查约束

**3.** 作用域、可见性、控制流、错误流语义

**4.** comptime/CTFE 语义，**编译期与运行时代码行为一致性契约5.** 泛型、模式匹配、语法去糖的语义规则

**6.** 运行时契约：panic/unwind 策略、异常模型对 TIR 后端的影响

**7.** 编译器反射/内省能力：comptime 可反射编译器自身 IR、完整类型内省（对应 G-14，地平线；语言层能力，编译器架构侧接口见 D2-8）

***

### D2 IR 架构维度（内核管线骨架，编译器内部数据模型）

**审查目的**：IR 分层与数据模型设计稳固，层间契约一致、可演进。

**1.** 管线分层策略：AST → 初级 IR → 高级 IR → 后端 IR，各层职责边界

**2.** IR 求值模型选型：memory‑first / SSA‑first，phi 节点生成时机

**3.** IR 粒度：文件级 / 函数级；ASL 数组索引模型，是否使用递归树节点

**4.** 类型信息分层：无类型层 / 带完整类型层划分

**5.** 语法糖、控制流展开（defer/try）落在哪个编译阶段

**6.** 源码位置 Span 跨层传递方案

**7.** 层间契约一致性机制：双序列化 round-trip 门禁是否真实执行；快照键拆分（函数区/实例区）隔离（对应正文 §12.1b / §4.2.1），证据 = round-trip 测试门禁通过率（机制设计面；执行与 CI 验证归 D7-5）

**8.** 编译器框架化/扩展面：自定义 IR（dialect）/自定义 lowering/pass 可插拔性与接口稳定性（若 T 走插件/生态路线，与 G-14 反射衔接，地平线）

***

### D3 工程性能维度（编译器自身资源 + 增量/并行机制 + 产出质量）

**审查目的**：单次编译快、内存可控、增量/并行与缓存机制真实有效，且生成代码质量有验收基线。

#### 子轴 A：单次编译性能

**1.** 各阶段编译耗时与并行能力（证据 = 编译基准，阈值对照业界 Rust 并行前端 +30\~50%）

**2.** 内存开销控制：Arena 分配、IR 膨胀、临时对象

**3.** CTFE 虚拟机执行效率与资源上限（超时 / 内存上限）

**4.** 泛型单态化膨胀控制（IR / 二进制体积）

#### 子轴 B：增量与并行机制（机制级而非口号级）

**1.** Driver / Query / 调度层：查询依赖图、red-green 指纹、work-stealing、分片缓存（对应 G-1）

**2.** 缓存键正确性与 hermetic action 模型：显式输入声明、无隐式输入、无宿主泄漏（对应 G-6 / G-12）

**3.** 增量命中率与重编译粒度验收：改一行 → 只重编受影响函数

**4.** 确定性 / 可复现构建：相同输入 → 相同输出

#### 子轴 C：产出质量（新增）

**1.** 生成代码运行性能验收基线（benchmark）

**2.** 二进制体积预算

**3.** 编译时间与运行性能的 profile 化权衡策略

**4.** IR 级 FDO 布局：PGO 驱动的函数/基本块布局（对应 G-11，作为 BOLT 的可移植替代/补充）

#### 子轴 D：智能优化（ML/LLM）治理（新增）

**1.** ML/LLM 优化决策的确定性化：模型权重哈希、推理种子、采样温度等纳入 hermetic action key（联动子轴 B / G-12，否则 learned 决策会击穿可复现构建）

**2.** 优化决策可审计性：pass 序列与调度参数选择留痕，可事后归因

**3.** ML 产物版本管理与回退：模型/调优产物纳入版本管理；若采纳 LLM 辅助 codegen，生成代码须过测试/实测门禁（对应 G-8 扩展）

（learned 优化正确性门禁的验证见 D7-9）

***

### D4 适配与兼容维度（环境、对接、版本）

**审查目的**：跑在什么环境、和外部怎么对接、版本兼容，均需清晰定义并具备可验证证据。

**1. 多后端支持：** LLVM / 自研机器码 / WASM / GPU‑SPIR‑V；profile 化选后端（Cranelift debug / LLVM release）

**2. 多目标平台：** 架构、指针位宽、裸机无 libc 环境；target\_desc 制品与 CPU 特征矩阵（AVX2/NEON 等），并作为云侧代价模型/autotuning 所需的『目标环境画像』（对应 G-10）

**3. WASM 目标：** Component Model + WIT emission、Canonical ABI（对应 G-3）

**4. GPU 路径：** ML autotuning 层（对应 G-8）

**5.** Debug / Release 两条构建路径差异化策略

**6. ABI / 链接能力：** 静态库、动态库、导出符号；跨模块摘要缓存与增量 LTO（对应 G-5）

**7. FFI 互操作：** 外部类型、调用约定、内存布局

**8. 向前 / 向后兼容：** 语言版本；.tmi 模块接口指纹稳定性、IR 缓存版本、标准库-编译器版本绑定（对应 G-2）

**9. debug info 质量：** DWARF 产出、栈回溯、变量可见性（支撑 IDE / 调试器）

**10. 异构『编译器原生』协同：** 跨设备（CPU/NPU/GPU/DSP）自动子图切分与数据搬运统一规划、异构执行确定性与同步语义、设备代价模型（对应 MLIR 生态趋势；若 T 不面向异构算力可仅记录）

***

### D5 工具与体验维度（面向人、IDE、CI）

**审查目的**：面向使用者与外部工具链的诊断、调试、组件化与集成体验达标。

**1. 诊断系统与诊断质量：** 错误恢复、多错误收集、报错提示、候选建议、warning 策略（两者互为补充，共同决定开发者体验）；诊断 IR（SARIF/JSON）与 span 跨层贯通（对应 G-9）

**2. 调试编译器本身：** IR dump、各阶段可视化、profiling、自观测；panic 信息完备、内部 bug 上下文充足（并入原 1.6.5）

**3. 组件可拆分：** lex/parse 可独立使用，支撑 LSP、格式化、静态分析

**4. REPL / Notebook 与持久会话 / JIT 层整合：** 消费 HIR 缓存 + .tmi（对应 G-4）

**5.** 多编译模式：语法检查、仅解析、仅导出 IR，不完整生成目标文件

**6. CI 测试体系：** 分层表述——单元测试（IR/层内变换）、编译测试（各阶段正确性）、错误测试（诊断质量/错误恢复）、运行测试（生成代码行为）

***

### D6 安全与可维护维度（长期生存能力）

**审查目的**：对抗恶意输入、隔离编译期风险，同时保证代码库可长期演进。

**1. 恶意输入防护：** 对抗深度嵌套、超大输入，避免 OOM、死循环；持续 fuzz 投入与随机语料回归（健壮性视角：防崩溃/OOM/死循环；正确性视角的 fuzz 见 D7-3）

**2. CTFE 沙箱：** 编译时代码权限隔离，限制 IO、循环、资源

**3. Module / 包系统：** 导入解析、循环依赖检测、模块可见性（同时是增量边界与生态基础）

**4. 管线解耦：** 低耦合高内聚，可替换后端，减少跨阶段强依赖

**5.** 开发维护成本：新增语言特性的改动范围可控，测试负担可控

**6. 安全机制可解耦性：** 可选 borrow/所有权 verify pass（mir 层、可开关、不改 ABI、不阻塞 bootstrap；要安全时开、自举时关，对应 G-7）

***

### D7 正确性与语义一致性验证维度（新增，置于全部维度中最优先审查位）

**审查目的**：验证编译器忠实实现语言规则，杜绝误编译（miscompilation）。

**1.** conformance suite 的组织与规范对应关系（每条用例可追溯至语言规则条目）

**2.** 各层 lowering 语义等价验证手段（HIR→mir→TIR→tmir→后端的等价性测试/证明）

**3.** 差分测试 / 随机 fuzzing 投入与多后端互证（同一输入在不同后端输出行为一致）

**4.** miscompilation 检测与回归基线（历史 bug 用例沉淀为回归测试）

**5.** round-trip / 双序列化一致性门禁执行情况（对应 D2-7 机制设计，此处验证其真实运行、纳入 CI 且有通过率基线）

**6.** 代码生成正确性：SSA/φ 约束、类型擦除后 ABI 一致性与内存布局正确性

**7.** 形式化验证预留钩子（对应 G-13，地平线）

**8. 增量正确性验证：** 增量产物 vs clean 产物一致性比对门禁；缓存失效完备性测试（依赖图任一节点变更后所有下游正确失效）（对应 D3 子轴 B，防陈旧构建）

**9. learned/ML 优化正确性：** ML 决策不得引入误编译，含正确性回归门禁与自动回退机制（对应 D3 子轴 D）

**10. 正确性概念二分：** 区分『语义保持』（lowering 与源程序语义一致）与『安全边界保持/隔离属性』（面向 WASM/插件沙箱场景：编译产物无法逃逸沙箱、仅经声明的 ABI/API 与宿主交互、无非法访存，类 vWasm）（与 D4-3 Component Model 联动）

***

### D8 供应链与交付安全维度（新增）

**审查目的**：输入防御之外的交付端安全，为组件化生态（G-3）与远程缓存（G-6）就绪后把关。

**1.** 第三方依赖供应链审计（类 cargo audit）与 SBOM 生成

**2.** 工具链版本固定与可复现工具链构建

**3.** 产物安全：调试符号/name section 不泄入生产构建；优化器不得静默移除安全检查

**4.** 远程缓存信任边界与内容校验（联动 G-6 / G-12）

**5.** 发布签名与来源追踪：git SHA 锁定、镜像摘要验证、构建命令可记录与可审计

**6.** 云编译/编译即服务信任模型：云端编译产物签名与完整性验证、下发通道安全、设备侧产物校验；云侧调优与目标环境画像的契约精度（联动 D4-2）

​

---

## 7. 基于审查维度（D1–D8）的复审结论

> 本回合按 `pipeline-review.md` 附录「审查维度」章节对编译管线文档族（`compiler-pipeline-design.md` / `tir-design.md` / `hir-design.md` / `ir-taxonomy.md` / `device-design.md` 及 G-x 配套 `driver-query` / `tmi` / `mir` / `target-desc` / `persistent-session` / `linker-opt` / `backend` / `comptime` 设计）做逐维度走查。结论先上表，再展开关键发现。

### 7.1 逐维度审查速览

| 维度 | 审查结论（证据） | 主要缺口 | 对应 G-x | 严重度 |
|---|---|---|---|---|
| **D1 语言语义** | comptime/CTFE 语义由 `comptime-design.md` 统一（B 式弥漫折叠 + HIR 解释）；TIR 单 lowering 根除 Bug1/Bug2（双后端不一致已结构性消除，D7-2）。`reference.md` 已把 `meta` 统一为 `KwMeta` 保留字、`comptime` 为唯一编译期关键字 | ① 反射能力（D1-7/G-14）规格未预留入口；② panic/unwind 在 TIR 后端的降级模型未定义（D1-6） | G-14（地平线） | 低 |
| **D2 IR 架构** | HIR/mir/TIR 三层职责单一、论证扎实；round-trip 双序列化门禁已建模（D2-7）。**最大缺口**：父文档 `compiler-pipeline-design.md` 缺子文档声称的 6 个锚点（§4.2b/§4.3b/§5.1/§5.2/§5.4/§11.2），层间契约不齐 | 父文档悬空引用（子文档"落实 §X"但父文档无该节）；INDEX.md 变更日志却声称已落编——文档治理失真 | G-1/G-2/G-10 | **高（契约断裂）** |
| **D3 工程性能** | 增量/并行机制完整（HIR 缓存 + `.tmi` + Driver/Query + red-green）；多后端按 profile 选。ML autotuning 搜索空间/缓存已设计 | ① 增量产物正确性未绑定验证门禁（D3-B ↔ D7-8）；② 新增 mir 层单次编译开销无原型量化（D3-A）；③ ML 决策未纳入 hermetic key（D3-D1） | G-1/G-8 | 中 |
| **D4 适配与兼容** | 多后端/多目标矩阵清晰；`.tmi` API 指纹稳定性已定义 | ① WASM Component Model 仅 bullet，无 WIT 发射细则 + **无沙箱隔离属性**（D4-3 ↔ D7-10）；② 文本 `.tmi` 格式版本/兼容策略缺失（D4-8 ↔ D8-5） | G-3/G-5/G-10 | 中 |
| **D5 工具与体验** | 持久会话/JIT（G-4）、TIR/HIR dump 自观测、REPL 已规划 | ① 诊断 IR(SARIF) 跨层 span 贯通设计 **已落编 `diagnostic-ir-design.md`**（D5-1⊕D7），提至 P1；剩余为 CI/SARIF 导出实现与 LSP 集成 | G-9 | 低（设计已闭环，待实现） |
| **D6 安全与可维护** | 可选 borrow-verify pass（G-7）解耦安全与自举；CTFE 预算护栏（`T_META_BUDGET`）存在 | ① 恶意输入/深嵌套 OOM 无 fuzz 投入与硬上限（D6-1）；② CTFE 沙箱主机资源上限未显式（D6-2） | G-7 | 低中 |
| **D7 正确性与语义一致性（最高优先）** | 双后端 `cself` 对拍、IR 快照基线、TIR 单 lowering、round-trip 门禁（D7-2/4/5/6）均已建模 | **① 增量正确性门禁缺失**（D7-8：clean≡incremental 等价）；② learned 优化无正确性回归+回退（D7-9）；③ WASM 沙箱隔离"安全边界保持"未定义（D7-10） | G-2/G-8/G-3 | **高（误编译防线缺口）** |
| **D8 供应链与交付安全** | `.tmib` 有版本不匹配即重建策略；远程缓存概念已提 | **全维度最薄**：无 SBOM/依赖审计（D8-1）、无工具链 pin（D8-2）、无产物/符号泄漏策略（D8-3）、无远程缓存信任边界（D8-4）、无发布签名（D8-5/8-6） | G-3/G-6/G-12 | **高（生态化前置雷）** |

### 7.2 维度内关键发现（展开）

- **D2（契约断裂，最具体）**：`docs/INDEX.md` 第 58 行（2026-09-04"复审落编"变更日志）声明已把 `§4.2b/.tmi`、`§4.3b/target_desc`、`§5` 子节、`§11.2` 写入父文档，但磁盘真实文件**无这些小节**——子文档（新文件）落地、父文档（就地改写）未持久。整个文档家族反复引用这些悬空锚点。本回合已**真实补齐**父文档 6 节（见 §9）。
- **D3-B ↔ D7-8（增量 vs 正确性，核心张力）**：G-1/G-2 把"改一行只编一行"建模为机制，但未定义"增量产物 == clean 产物"的验证。没有等价门禁，增量缓存就是**误编译源**（陈旧构建）。
- **D3-D/D7-9/D8（ML 治理）**：`device-design.md §5.1` 的 autotuning 缓存键 `(kernel,形状,arch,target_desc版本)` **未含模型权重/版本/种子**，也无正确性回退——learned schedule 可能静默误编译且击穿确定性构建。
- **D4-3/D7-10（WASM 沙箱）**：Component Model 对 seesaw-erp 的"核心不重编、业务插件化"故事，**只在产物无法逃逸沙箱时成立**；当前设计只给 `.wit` 发射轮廓，缺"安全边界保持"验证（vWasm 式）。
- **D8（整体最薄）**：供应链/交付安全（SBOM、签名、工具链 pin、缓存信任）几乎空白——这是组件化生态（G-3）与远程缓存（G-6）就绪前必须先补的地基。

---

## 8. 维度间张力、协同与最佳结合点（综合裁定）

### 8.1 三处维度张力（不处理会互相拖累）

1. **D3-A（单次编译性能）vs D2（新增 mir 层）**：mir 比当前"双后端直接从 AST 发射"多一层 IR pass，单次编译有回归风险。设计已用"M 阶段透传 → M' 阶段再优化"的分期化解，但**缺原型量化证据**——须在 M 阶段落地前先测"HIR→mir→TIR→tmir→后端"vs"当前双后端"的单次编译耗时基线。
2. **D3-B（增量机制）vs D7-8（增量正确性）**：最危险张力。增量机制若不被正确性门禁钉死，就是误编译源。→ 见 BP-1。
3. **D8（远程缓存/供应链）vs D7-8/D3-D**：缓存命中、远端分发的前提是"等价且可信"。等价由 D7-8 保证，可信由 D8-4/8-6 保证；二者缺一则缓存从"加速"变"投毒"。→ 见 BP-1/BP-3。

### 8.2 三处维度协同（已自然咬合，应固化）

- **D2(HIR=ZIR) + D1-7(G-14) + D3-B(per-file 缓存)**：HIR 未定型使 per-file 缓存与 comptime 解释编译器自身 IR 同时成立——增量、反射、惰性诊断三赢，是设计最漂亮的协同。
- **D7-2/D7-5（TIR 单 lowering + round-trip）**：把"双后端一致"从文本巧合升级为结构性必然，一次性消除 Bug1/Bug2 类漂移——D2 物化 TIR 决策的直接正确性回报。
- **D6-6(G-7) + D2(mir 层)**：可选 borrow-verify pass 放在 mir、可开关、不改 ABI、不阻塞自举——把"要安全"与"要能自举"解耦，是 D6 可维护性的范本。

### 8.3 最佳结合点（综合裁定，本回合核心结论）

> 综合八维度，**最佳结合点不是"某维度做到极致"，而是把"性能/机制"维度与"正确性/信任"维度钉成同一交付物**——让加速能力从诞生起就自带正确性证明与信任边界，而非事后补。具体三处绑定：

- **BP-1（P0 交付门槛）· 增量正确性门禁是增量机制的交付门槛** = D3-B ⊕ D7-8 ⊕ D8-4 ⊕ D6
  G-1/G-2 只有在其增量产物被证明**位等价**于 clean 产物时才算优化。落实：red-green 失效完备性测试 + `clean≡incremental` 等价门禁（纳入 CI 阻断）。这把"增量性能"（D3）、"杜绝误编译"（D7）、"远程缓存可信"（D8）、"长期可维护"（D6）钉成一条铁链。→ 已写入 `driver-query-design.md §9`。
- **BP-2（P1 同一交付包）· WASM Component = 接口发射 + 沙箱隔离验证** = D4-3 ⊕ D7-10 ⊕ D8
  Component Model 对 ERP 的价值仅在"产物无法逃逸沙箱"时成立。故 `tmir→wasm` 不能只产 `.wit`+`.wasm`，须同日定义并验证**沙箱隔离属性**（vWasm 式：仅经声明 ABI 交互、无非法访存）。把"对外兼容"（D4）、"安全边界保持"（D7-10）、"插件供应链信任"（D8）打包交付。→ 已写入 `backend-design.md §3` 并指向独立文档 `wasm-component-design.md`。
- **BP-3（P2/P3 三位一体）· learned 优化 = 可复现 + 可审计 + 可回退** = D3-D ⊕ D7-9 ⊕ D8
  任何 ML 决策（GPU autotuning / MLGO）不得 ship，除非：① 模型身份进 hermetic key（D3-D1，保确定性）；② 过正确性回归门禁且可自动回退（D7-9，防误编译）；③ 缓存条目带签名/校验（D8-4/8-6，防投毒）。→ 已写入 `device-design.md §5.1` 治理约束(1)(2)(3)。

### 8.4 综合后的优先级重排建议

原 P0~P4 路线基本成立，按 BP 微调：

- **P0（G-1/G-2）**：维持，但 A 阶段验收**必须包含 BP-1 增量正确性门禁**，否则 G-1/G-2 不算通过。
- **P1**：G-3(WASM) 与沙箱隔离验证**同批**（BP-2，设计已落编 `wasm-component-design.md`）；G-9(诊断 IR/SARIF) **已提前到 P1**（设计已落编 `diagnostic-ir-design.md`）——它是 D7 误编译定位与 D5 体验的低成本高杠杆基础，原排 P4 偏晚；G-4/G-7 已稳。
- **P2/P3**：G-8(ML autotuning) 须在 BP-3 治理下才允许默认开启；G-5/G-6/G-12 远程缓存须在 D8-4 信任边界下——**D8-4 信任边界设计已本回合落编（`supply-chain-design.md`），P0 信任地基在设计层闭合，实现随发布流程接入**。
- **P4→前置**：G-9 诊断 IR 提到 P1。
- **地平线**：G-13 形式化、G-14 反射（已在 `comptime-design.md §0` 预留只读反射入口）。


## 9. 本回合落地修订清单（已写入各相关文档）

> 本章是「审查意见 → 设计修改」的闭环台账。§9.1 为本次已真实落盘、并经 grep 复核的设计修改；§9.2 为审查中识别但需后续回合独立推进的待办（含新建文档与专项设计）。

### 9.1 已落盘的设计修改（真实磁盘复核通过）

| 文档 | 修改位置 | 修改内容 | 服务的维度 / 最佳结合点 |
| --- | --- | --- | --- |
| `compiler-pipeline-design.md` | §4.2b / §4.3b / §5 / §11.2 | 补 §4.2b `.tmi` 摘要格式、§4.3b `target_desc` 目标三元组描述；§5 由概览扩为 §5.1~§5.8（增量/查询·并行/缓存/持久会话/确定性/诊断IR/自观测/MLGO），§5.1 内嵌⚠增量正确性铁律并引用 D7-8；补 §11.2 可选 borrow-verify pass | D2 层间契约一致、D5/D8 横切落地 |
| `driver-query-design.md` | §9 | 新增「增量正确性验证（D7-8 绑定，P0 交付门槛）」：red-green 失效完备性测试 + `clean≡incremental` 等价门禁（纳入 CI 阻断）+ 缓存键闭合性（源/依赖`.tmi`指纹/编译器版本/目标三元组/flags/pass 集） | D7-8、BP-1 |
| `device-design.md` | §5.1 治理约束 | 新增治理约束(1)(2)(3)：(1) hermetic key 含模型身份（权重哈希/版本/种子）；(2) 正确性回归门禁 + 自动回退；(3) 缓存条目可信（SBOM/签名） | D3-D / D7-9 / D8、BP-3 |
| `backend-design.md` | §3（WASM 注记） | 新增「WASM Component 交付包 = 接口发射 + 沙箱隔离验证」注记，指向已落编独立文档 `wasm-component-design.md`（BP-2） | D4-3 / D7-10、BP-2 |
| `tmi-design.md` | §4 | 新增「格式版本与兼容」：文本 `.tmi` 须带版本/格式戳，防格式漂移击穿增量 | D8-5 |
| `comptime-design.md` | §0 | 新增「编译器反射预留」：HIR 只读反射入口，绑定 D1-7/G-14 地平线 | D1-7 / G-14 |
| `comptime-design.md` | §5.1.1 | 新增「CI 模糊测试门禁规格」：fuzz 语料/断言/CI 接入/隔离自检（D6-1/D7-3/D7-10） | D6 / D7-3 / D7-10、BP-1 |
| `wasm-component-design.md` | §4.1 | 新增「隔离门禁的 CI 实现（阻断）」：构建段 + 隔离验证段（ABI 闭环/内存边界/无裸指针逃逸/失败回指）+ 信任准入 | D4-3 / D7-10 / D8、BP-2 |
| `diagnostic-ir-design.md` | §5.1 | 新增「CI SARIF 门禁」：`--sarif` 导出 + Code Scanning 上传；P1 前告警、P1 起阻断 | D5-1 / D7 |
| `supply-chain-design.md` | §7.1 | 新增「CI 供应链门禁」：SBOM/审计/签名/缓存信任分级门禁（D8-1~D8-5） | D8、BP-1/2/3 信任侧 |
| `ci-gate-design.md` | 全文 | 新建：BP-1/2/3 三向绑定落到 CI 阻断层的门禁矩阵 G-CI-1~G-CI-10 + DAG 执行序 + hermetic action cache + 门禁脚本接口契约 | 跨维度综合落地、BP 实体化 |
| `.github/workflows/ci.yml` | 全文 | 新建：真实 GitHub Actions 工作流实现上述门禁（bootstrap/ir-roundtrip/incrementality/ctfe-fuzz/diagnose/supply-chain/wasm-component-verify/perf-baseline）；gate.mjs + ir_snapshot.mjs 直跑，其余为接口契约 | 跨维度综合落地、BP 实体化 |
| `perf-baseline.md` | 全文 | 新建：性能基线方法学 + 实测（前端+sema 中位 13ms / codegen 中位 116ms）+ mir 落地 G-CI-10 对比接入 | D3-A vs D2 张力证据 |
| `tools/bench_compile.mjs` | 全文 | 新建：编译性能基准脚本（仅驱动 `tc` 计时，不碰实现） | D3-A 量化工具 |

### 9.2 留待后续回合（未落编，列入待办）

> 上轮 §9.2 第 1/2/3 项（`wasm-component-design.md` / D8 供应链专项 / 诊断 IR）**本回合已落编**，见 §9.1。以下为仍待推进项：

1. ~~**单次编译性能基线（原型量化）**~~ **已完成（见 §9.1 `perf-baseline.md` / `tools/bench_compile.mjs`）**：实测当前管线「前端+sema 中位 13ms / codegen 中位 116ms」，mir 落地前后 G-CI-10 阻断阈值 10%，D3-A vs D2 张力转为可量化证据。
2. **CTFE fuzz 门禁实现（D6-1/D7-3）**：`comptime-design.md §5.1.1` 已定义 fuzz 门禁规格与 CI 接入，但 `tools/ctfe_fuzz.mjs` 语料生成 + CI 熔断为实现项（接口契约见 `ci-gate-design.md §5`）。
3. **文档治理闭环（D2 修复根因）**：本回合已通过 `docs/INDEX.md` 变更日志 + 真实落盘复核缓解「父文档不落盘」失真（与 `reference.md` overlay 同源）；仍建议建立「变更日志 ↔ 磁盘真实小节」的自动校验脚本，避免声称已落编而实际悬空复发。
4. **D8 / G-3 / G-9 门禁脚本实现（CI 接入已完成，实现待排）**：本回合已完成「CI 接入」设计/配置层——四文档 CI 门禁小节 + `ci-gate-design.md` + `.github/workflows/ci.yml`（见 §9.1）；剩余 SBOM 生成、签名流水线、缓存信任校验、WASM 隔离验证、SARIF 导出等**门禁脚本实现**为后续回合，接口契约见 `ci-gate-design.md §5`。

---

> **本回合（续 7 · 两个同时都做）闭环状态**：用户要求「实现与 CI 接入」与「性能基线量化」两条线同时推进，均已交付。① **CI 接入**：四文档补齐 CI 门禁小节（`comptime §5.1.1` / `wasm-component §4.1` / `diagnostic-ir §5.1` / `supply-chain §7.1`）+ 新建 `ci-gate-design.md`（门禁矩阵 G-CI-1~G-CI-10）+ 真实 `.github/workflows/ci.yml`（GitHub Actions 工作流），把 BP-1/2/3 三向绑定落到 CI 阻断层。② **性能基线**：新建 `tools/bench_compile.mjs` + `perf-baseline.md`，实测前端+sema 中位 13ms / codegen 中位 116ms，mir 落地前后 G-CI-10 阻断阈值 10%。§9.1 新增 9 处落编、§9.2 第 1 项（性能基线）已完成、第 4 项（CI 接入）已完成、门禁脚本实现与 CTFE fuzz 实现列为后续待办。全部为设计/配置/测量，未触碰编译器实现（沿用「不要编码」裁定）。
