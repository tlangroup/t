# IR 分层对位与命名裁定（T vs Zig / Rust / Swift）

> 状态：裁定文档 v0.1
> 缘起：提问「相对 Zig 的 `源码 → Token → AST → ZIR (AstGen) → Sema → AIR → CodeGen → LLVM-IR`，T 的 TIR 位置为什么颠倒了？」
> 关联：`docs/compiler/tir-design.md`、`docs/compiler/compiler-pipeline-design.md`
> 作用：本文是「T 的某一级 IR 对应别的语言哪一级」的**唯一对位依据**。后续讨论 IR 分层、命名、职责边界时先读本文，避免按名字（而非按职责）对位造成的反复。

---

## 1. 问题的来源：一次定义撞名

TIR 最初的需求描述是「**无类型的文件级线性中间表示**」。

这三个定语，逐字就是 Zig ZIR 的定义。Zig 官方对 ZIR 的表述是：*an untyped, linear IR that represents program semantics independent of types*；由 `AstGen` 产出，**按源文件缓存到磁盘**，指令带引用计数以支持增量编译，内含**未解析**的声明与类型表达式。

而 TIR 在 `tir-design.md` 里被放在了 **Sema/mir 之后、后端之前** —— 也就是 Zig 里 **AIR** 的槽位。

所以：

> **不是位置颠倒了，是一个描述同时精确匹配了两个完全不同的 IR。**
> ZIR 与 TIR 都可以叫「无类型 + 线性 + 文件级」，但两者的「无类型」方向相反。这是全部混淆的根源。

---

## 2. 两种「无类型」（决定性区分）

| 维度 | **ZIR 式：未定型（pre-type）** | **TIR 式：已擦除（post-type）** |
|---|---|---|
| 位置 | 语义分析**之前** | 语义分析**之后** |
| 「无类型」的含义 | 类型**还没算出来** | 类型**算完了、然后丢掉** |
| 无类型的性质 | 一笔**待偿债务**（Sema 必须来还） | 一笔**已清偿**（下游不再需要） |
| 值携带什么 | 只有语法意图 + 未解析的类型表达式 | 精确的**存储类 `ST`**（位宽/布局/地址空间） |
| 能否 per-file 磁盘缓存 | **能**——正因为没做跨文件类型解析 | 不能（在单态化之后，依赖全程序） |
| 主要消费者 | Sema（解释执行它）、增量引擎 | 各后端（逐条翻译成目标语法） |
| 存在理由 | comptime 惰性求值 + 增量粒度 | 多后端**共享 lowering** |

一句话：**ZIR 的无类型是「还没定」，TIR 的无类型是「不用管了」。** 两者都合理，都不可互相替代。

---

## 3. 按「阶段职责」对位（而不是按名字）

| 阶段职责 | Zig | Rust | Swift | T（现状） | T（设计目标） |
|---|---|---|---|---|---|
| 词法 / 语法树 | AST | AST | AST | AST (`parse.tc`) | CST / AST |
| **未定型·可序列化·可缓存指令流** | **ZIR**（`AstGen`） | 无对应（HIR 是类型化树；缓存靠 `rmeta`） | 无对应 | **✗ 空缺** | **HIR（= ZIR 槽位，已裁定 A）** |
| 语义分析 / comptime / 单态化 | Sema（**解释 ZIR**） | 类型检查 + monomorphize | Sema / SILGen | `sema.tc`（直接在 AST 树上跑） | sema + CTFE（**解释 HIR**） |
| **类型化·单态·CFG 化中层 IR**（中端优化在此） | **AIR**（typed, per-fn, 带 liveness） | **mir**（typed CFG，中端 pass） | **SIL**（typed SSA，ARC/泛型特化） | ✗ 空缺 | **mir** |
| **类型擦除的后端共享桥** | **✗ 空缺** | `rustc_codegen_ssa`（**trait 形式**，不物化） | IRGen（单后端，无桥压力） | ✗ 空缺 → 两后端各自从 AST 发射 | **TIR**（**物化 IR 形式**） |
| 后端 | 各后端自有 mir：`x86_64.Mir` / `aarch64.Mir` / `wasm.Mir` / `c.Mir` / LLVM | LLVM / Cranelift / GCC | LLVM | `codegen_c` / `codegen_ll` | LLVM / Cranelift / C / WASM / SPIR-V |

**读表结论**：

- TIR 对应的**不是** ZIR。TIR 对应的是 **Zig 里那一行空缺**。
- 若要在 T 里找 ZIR 的对应物：采纳裁定 A 后，**HIR = ZIR 槽位**（未定型·线性·可序列化，见 §6），故 T 的 ZIR 对应物就是 HIR——这正是增量编译承重墙。此前"目前没有"的结论已被 A 推翻。
- 最接近 TIR 的现成对位其实是 **LLVM IR 本身**：相对源类型已擦除、线性、模块级、每个值带存储类型。T 需要自己造一份，是因为它还要下降到 **C**（以及 Cranelift / SPIR-V）——LLVM IR 无法承担这个角色。

---

## 4. 为什么说 Zig 在「桥」这一行是空缺（证据）

Zig 的 CodeGen 把 AIR 转成 **backend-specific mir**：`codegen.AnyMir` 是 `aarch64.Mir` / `x86_64.Mir` / `wasm.Mir` / `c.Mir` 等的 union —— 注意这里的 "mir" 是**各后端自己的机器 IR**，不是共享中层 IR。后果是每个后端把 AIR 的 lowering 重写一遍：

- `src/codegen/x86_64/CodeGen.zig` ≈ 10.4 MB 单文件（手写后端里最大的）
- `src/codegen/llvm.zig` ≈ 580 KB
- `src/codegen/c.zig` 另有一套
- 另有 aarch64 / riscv64 / sparc64 / wasm / spirv / arm / mips 各一套

也就是说：**Zig 用「每后端重写一遍」换取了每个后端的极致自由度**（这对手写机器码后端是合理取舍——寄存器分配、指令选择本就高度目标相关）。

但 T 的处境不同：T 的后端都是**发射另一种文本 IR / 源码**（C、LLVM IR，未来 Cranelift IR、WASM、SPIR-V），不做寄存器分配、不做指令选择。这类后端之间**几乎全部 lowering 逻辑都是重复的**，重写一遍拿不到任何自由度收益，只拿到漂移风险。

而漂移风险已经兑现两次：

- **Bug1**：泛型 `!j` 在单态化实例中未解糖（只在一端修）
- **Bug2**：LLVM 侧 `TStr + TStr` 被错误发射为 `add i64`（C 端是对的）

T 只有 **2** 个后端就已经漂移两次。管线设计要扩到 **5** 个后端，不建桥就是把这个 bug 类乘以 5。

---

## 5. 三种解法对比

| | 做法 | 代价 | 收益 |
|---|---|---|---|
| **Zig** | 不建桥，每后端从 AIR 各自 lowering | 每后端一套 lowering（x86_64 后端 10.4 MB） | 手写后端有最大自由度 |
| **Rust** | 建桥但**不物化**：`rustc_codegen_ssa` 提供 mir 遍历骨架，后端实现 `BuilderMethods` / `BackendTypes` / `LayoutTypeMethods` 等 trait 填空 | 需要语言级 trait + 编译期单态化能力 | 官方数据：原 27,000 LOC 的 `rustc_codegen_llvm` 拆成 18,500 (LLVM) + 12,000 (SSA)，**复用约 10,000 LOC**，无性能/测试回归 |
| **T（本设计）** | 建桥且**物化成数据**：TIR 是真实的 IR，可打印、可序列化、可 diff | 多一层数据结构与序列化 | 复用同 Rust；**外加**下面三条 |

**T 为何选「物化」而非 Rust 的 trait 方案**：

1. **语言能力**：Rust 方案依赖 `Bx: BuilderMethods` 的 trait + 编译期单态化。`t` 目前没有这套抽象能力（也不该为此先造一套 trait 系统）。
2. **门禁收益（决定性）**：物化的 TIR 可以序列化成文本 → **可 diff → 可做单一 md5 快照**。于是 `gate L2` 的跨后端一致性从「靠两份文本恰好一致」变成「**同一份 tmir 输入喂所有后端**」的结构性必然。trait 方案拿不到这个：它没有可快照的中间产物。这直接把 `tools/ir_snapshot.mjs` 的双 `.ll`/`.c` md5 收敛为单一 `.tir` md5。
3. **device 路径**：`ptr(ST, aspace)` 形态的 TIR 文本可以直接喂 `docs/compiler/device-design.md` 的 Device Dialect（`t-device-opt` 已跑通 `--device-to-nvvm`）。物化 IR 天然是跨进程/跨工具链的交换格式，trait 方案不是。

---

## 6. 反向缺口：T 缺的是 ZIR 槽位，而且它是承重的

这才是本次提问最有价值的产出。

管线设计 `compiler-pipeline-design.md §4.2` 把 HIR 定义为**类型化的树**，并同时声称它承担「salsa 式增量缓存锚点」。**这两件事有内在冲突**：

> **可 per-file 缓存的前提，是被缓存物不依赖其他文件。**
> ZIR 之所以能按源文件缓存到磁盘（Zig 连标准库的 ZIR 都缓存，避免每次重新 lower），恰恰**因为它未定型**——AstGen 阶段没有做任何跨文件的名字/类型解析，缓存键就只是本文件内容。
> 一个**类型化**的 HIR 做不到这点：类型解析会拉进依赖文件的信息，任何依赖变动都会污染缓存条目，粒度必然退化。

所以 ZIR 那个槽位不是装饰，它是承重墙。T 现在的设计把它省了，代价是**增量粒度上限**。

### 裁定结果（2026-09-04）：**采纳选项 A**

承重墙必须立起来。HIR 重新定义为 ZIR 槽位（未定型 · 线性 · 可序列化），管线对位如下：

```
CST ──AstGen──▶ HIR（未定型·线性·可序列化，= T 的 ZIR 槽位）
                  → sema + CTFE（解释 HIR：名字解析/类型检查/单态化/comptime 折叠）
                  → mir（类型化 CFG+SSA，= AIR 槽位，中端优化在此）
                  → TIR（类型擦除·线性，Zig 无此层）
                   → tmir（机器桥，喂薄后端）
                  → 后端（LLVM / Cranelift / C / WASM / SPIR-V）
```

- HIR 规格详 `docs/compiler/hir-design.md`。
- 得到与 Zig 的干净对位，**外加** Zig 缺的那层桥（TIR）。
- **核心成本（已立项）**：CTFE 从「AST 树求值」重写为「解释 HIR 指令流」——`meta_eval_call` / `comptime_fold_pass` 需重做；Sema 改为消费 HIR。这是**孤立风险线**，与 TIR 落地解耦，单独 stage / 单独 gate（见 `compiler-pipeline-design.md §9` A / A' 阶段）。
- **附带收益（采纳 A 才拿得到）**：Zig 式**惰性诊断语义**（未实例化泛型体内错误不报）+ 真正的 **per-file 缓存**（改一个文件只重算该文件 AstGen + 依赖闭包 Sema 入口）。

> **选项 B 作为回退方案保留**：若 CTFE 重写风险不可控，可暂退回 B（HIR 维持类型化树、放弃 ZIR 槽位、CTFE 不动），增量粒度退化为「按声明/按模块失效」，仍远优于现状全量重编。但默认路线是 A。

---

## 7. 命名裁定

「无类型的文件级线性中间表示」这个副标题会持续引发本次这类混淆（它字面是 ZIR 的定义）。裁定如下：

| 项 | 旧表述 | 裁定表述 | 理由 |
|---|---|---|---|
| 「无类型」 | untyped | **类型擦除**（type-erased） | 「无类型」歧义（未定型 / 已擦除）；「擦除」明确方向在下游 |
| 「文件级」 | file-level | **编译单元级**（compilation-unit / CGU level） | TIR 在单态化**之后**，自然单位是 CGU，不是源文件；「文件级」是 ZIR 的性质 |
| 整体定位 | 「无类型文件级线性 IR」 | **类型擦除的线性后端桥 IR**（type-erased linear backend-bridge IR） | 「后端桥」是它存在的唯一理由，应写进名字 |

`TIR` 缩写保留（`T` = t 语言 / target-facing 双关），文件名 `tir-design.md` 不改（避免再一轮全仓引用改写）。

---

## 8. 结论

1. **TIR 的位置没有颠倒。** 撞的是名字：需求描述用的三个定语恰好是 ZIR 的定义，而 TIR 落在 AIR 的槽位。
2. **TIR 对应的是 Zig 缺失的那一层** —— AIR 之后、各后端之前的共享桥。Zig 用「每后端重写」换手写后端的自由度；T 的后端都是文本 IR 发射器，拿不到这份自由度，只会拿到漂移（Bug1/Bug2 已兑现）。
3. **Rust 证明了这层桥的价值**（`rustc_codegen_ssa` 复用约 10,000 LOC），T 选择把它**物化成数据**而非 trait，额外换来单一 `.tir` md5 快照与 device 路径复用。
4. **反向缺口已补（采纳 A）**：HIR 重定义为 ZIR 槽位（未定型·线性·可序列化），增量编译承重墙立起。规格见 `docs/compiler/hir-design.md`；CTFE 重写为解释 HIR 已立项、与 TIR 落地解耦。
5. 命名统一为「**类型擦除的线性后端桥 IR**」，避免再次撞名。
