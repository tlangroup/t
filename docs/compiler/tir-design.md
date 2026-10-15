# TIR —— t 语言无类型文件级线性中间表示设计

> 状态：草案 v0.1（设计阶段，尚未落地）
> 作者：Buddy（基于 `src/*` 现状勘探 + `docs/compiler/device-design.md` 设计风格）
> 关联：`docs/compiler/device-design.md`、`tools/ir_snapshot.mjs`、`tests/ir_baseline.json`、`src/codegen_c.tc`、`src/codegen_ll.tc`、`src/sema.tc`
> **对位说明（必读）**：TIR 的三个定语（无类型 / 文件级 / 线性）逐字撞了 Zig **ZIR** 的定义，但两者位置相反、职责无关——ZIR 是**未定型**（sema 之前，类型还没算），TIR 是**已擦除**（sema/mir 之后，类型算完丢掉）。TIR 真正对应的是 **Zig 缺失的那一层**（AIR 之后、各后端之前的共享桥）。完整对位表、命名裁定与由此暴露的反向缺口见 `docs/compiler/ir-taxonomy.md`。裁定后的精确表述为「**类型擦除的线性后端桥 IR**」。

> ⚠ **历史注记（2026-10-15）**：`tote` 包管理器/构建系统已于本日从本仓库抽出为独立项目 `C:/seesaw/codebuddy/tote`（仓库外 `../tote`）。原 `src/tote.tc` 现位于该独立项目的 `tote.tc`；本仓库快照目标与 gate L2 均已不再含 tote（见 §12.2 末注）。

---

## 1. 动机与问题

当前 `t` 编译器的实际管线是：

```
lex → parse(含前端脱糖) → AstGen → HIR(未定型·线性·可序列化, =ZIR槽位)
   → sema(类型检查+单态化+CTFE, 解释HIR) → mir(类型化CFG+SSA) → comptime_fold → TIR(类型擦除·线性) → tmir(便携机器桥) → [tmir→c | TIR→ll(LLVM直消费TIR)]
   （管线总览与 HIR=ZIR 槽位定义见 `docs/compiler/compiler-pipeline-design.md` §3/§4.2 与 `docs/compiler/hir-design.md`）
```

`sema` **不产出**任何独立的"typed IR"。它把结果留在两个并行池里：

- `TI`/`TD` 类型池（`sema.tc:18-62`）——但**节点本身没有类型字段**（`struct Node`，`base.tc:39-67` 只有 `na/nb/nc/nd`、`la/lb/lc`、`kind`、`sa/sb/ia/ib/bf` 等）。
- 类型信息在**发射期由后端按 `node.kind` 重新走一遍 AST 推导**（`expr_type_desc` / `ll_etd`），并查 `tm` 全局符号表 + `fs` 函数内符号表恢复。

由此产生两类**已被实证**的重复（归一化失败 → 双后端漂移）：

1. **类型恢复重复**：`expr_type_desc`（`codegen_c.tc:661`）与 `ll_etd`（`codegen_ll.tc:722`）是两份几乎同构的 `node.kind` 大 switch，都产出 TD 索引。
2. **类型→目标文本重复**：`desc_to_c` 与 `ll_td`（`codegen_ll.tc:316`）是两份平行的 TD→目标类型映射器。
3. **每个构造的 lowering 重复**：`call / if / for / while / var_decl / binary / unary / member / struct_lit / array_lit / slice_lit / match / closure_make / return / break` 在两个后端各写一遍，各自重走 AST、各自重推类型。

**已付出的代价**：A1a `f-string !j` 双后端实现时，泛型 `!j` 在单态化实例中未解糖（Bug1）、LLVM `TStr+TStr` 被错 emit 为 `add i64`（Bug2），都是"同一语义在两端各实现一次、不一致"的典型。这类 bug 在 TIR 上只会出现**一次**，因为 lowering 写一遍。

**TIR 的目标**：在 `comptime_fold` 之后、`emit_*` 之前插入一个**单一、无源类型、文件级、线性**的中间表示。所有"源语义 → 机器存储"的降级只发生一次；C 与 LLVM 两个后端退化为"tmir → 目标语法"的薄翻译器。

---

## 2. TIR 的三个定语（精确定义）

### 2.1 无类型（untyped，相对源类型系统）

TIR **不携带任何源语言类型**。源类型系统（泛型形参、可选 `T?`、named 别名、map、sym、typeinfo、flagset、enum 名、union tag 语义等）在降级阶段**已全部消去**。TIR 中每个值只带一个**存储类型 `ST`（storage type / 机器存储类）**：

- `ST` 只决定"后端如何分配与搬运比特"（定宽整数 / 浮点 / 指针 / 聚合 / 函数指针 / void）。
- `ST` **不携带任何源语义**——没有"这是个 Point 还是个 Color"的概念，只有"这是个 `{f64,f64}` 还是个 `i32`"。

这正是"无类型"的含义：**相对源类型系统而言无类型；相对机器存储而言是带存储类的线性 IR**。它不等价于"值无宽度"——相反，因为要精确对齐 C/LLVM ABI 与 `gate L2` 的 `.ll` 逐字节一致性判据，每个 `ST` 都带着精确位宽/布局。

> **术语裁定**：优先使用「**类型擦除**（type-erased）」而非「无类型（untyped）」。后者有两个相反的读法——「类型尚未算出」（Zig ZIR 那种，一笔待 sema 偿还的债务）与「类型算完后丢弃」（TIR 这种，已清偿）。TIR 是后者。详见 `docs/compiler/ir-taxonomy.md §2`。

### 2.2 文件级（file-level）

- 一个 TIR **模块（module）** 对应一个编译单元（一个 `.tc` 源文件经 sema 后的 `lex.decl_list`）。
- 跨文件调用沿用以有的 import / 符号表模型：TIR 模块只声明本单元导出的函数签名（含 `ST` 形参/返回值）与引用的外部符号；链接由 runtime/目标链接器负责。
- 模块是快照/对拍/门禁的基本单位（取代当前 `ir_snapshot.mjs` 按 `.ll`/`.c` 文本 md5 的粒度）。

> **术语裁定**：「文件级」的精确表述是「**编译单元级 / CGU 级**」。TIR 在单态化**之后**，其自然边界是编译单元（codegen unit），未必与源文件 1:1——泛型实例会落在实例化点所属的单元。真正「按源文件」的是 Zig ZIR（sema 之前，故可按文件缓存），不是 TIR。详见 `docs/compiler/ir-taxonomy.md §2`、§7。

### 2.3 线性（linear）

- 每个函数体是一个**扁平的指令数组**（不是 AST 树）。
- 表达式被"降级到目标 slot"：每个表达式求值结果写入一个 `slot`（帧变量/临时量），后续指令引用该 slot。即 **memory-first**（与现有两个后端的 `alloca`+`store` 同构，风险最低）。
- 控制流**显式化**：基本块用 `block @label` 标注，终止指令 `br / br_cond / switch / ret` 显式连接块。块之间是线性排布的指令序列。
- （可选 Phase 2）在 memory-first 之上再做 SSA 化（`phi`），供优化 pass 使用；但 Phase 1 不强制 SSA。

### 2.4 设计权衡：memory-first vs SSA-first（裁定与论证）

TIR 的函数体可选用两种值模型。**裁定：memory-first**（每条值存于具名 `slot`，用 `load/store` 读写，不强制 SSA）；**SSA 归 mir 层**（管线文档 §4.3，mir 才是类型化 CFG+SSA 的中端优化层）。以下论证该裁定的来由与对后继节点的影响。

#### 两种模型

- **memory-first（采纳）**：值活在显式内存槽。指令直接读写 `slot`；控制流汇合点无需 φ，多个前驱往同一 `slot` 写即可。与现有 `codegen_c`/`codegen_ll` 的 `alloca+store+load` 模型同构。
- **SSA-first（否决用于 TIR）**：每个值唯一、不可变，汇合点用 `phi` 节点选前驱值；无显式 load/store 表达局部值。

#### memory-first 优劣

| 优 | 劣 |
|---|---|
| **风险最低**：与现状代码生成几乎 1:1 重皮，新增机制少 | TIR 自身**不能做值级优化**（GVN/CSE/SCCP）——但中端优化已在 mir 跑过，TIR 不损失任何优化（见下） |
| **生成极简**：表达式结果写入 slot、读取即 load，无需支配树/φ 放置算法 | 指令数偏多（显式 load/store） |
| **无 φ 构造**：循环/if 汇合直接写同一 slot，无支配边界计算 | 别名是隐式的，后端需保守（除非 TIR 带 `noalias`） |
| **可变性/别名天然**：`var`、闭包引用捕获、原地更新直接映射 | — |
| **C 后端直译**：TIR slot → C 局部变量 1:1 | — |
| **可读/易 diff**：线性内存模型像 C，利于 `.tir` md5 快照 | — |

#### SSA-first 优劣

| 优 | 劣（在 T 语境下为决定性劣势） |
|---|---|
| 若 TIR 是优化层，则 SSA 赋能 GVN/CSE/SCCP | **TIR 不是优化层**：mir 已在其上游完成 SSA + 全部中端优化，TIR 再做 SSA 是**冗余工作、零收益** |
| 紧凑、规范形式 | **C 后端无法发射 φ**：`tmir→c` 必须把 SSA 重建回内存（"lower phi to selectors/goto" 问题）→ SSA-first 在 C 路径上**强制增加一个内存重建 pass**，而 memory-first 把这个成本推给 LLVM 的 mem2reg（免费、自动） |
| LLVM 后端可跳过 mem2reg（省约 1–2% codegen 时间） | **构造成本高**：生成器需算支配者、在汇合点放 φ、重命名变量，gate 回归面变大 |
| 精确 use-def 链 | 可变性/别名别扭：`var`、引用捕获需 SSA 版本化（写 `v2`=复制），要么 IR 爆炸、要么对捕获变量仍回落内存 |

#### 对后继节点（后端 / 后续阶段）的影响

| 后继节点 | memory-first | SSA-first |
|---|---|---|
| **`tmir→c`** | slot → C 局部变量，直译 ✅ | 必须 lower φ → 要么重建 alloca/load/store（前功尽弃），要么用 computed-goto/临时技巧（脆弱、复杂 CFG 易碎）❌ **强制多一个 pass** |
| **TIR→ll（LLVM 直消费 TIR）** | TIR→LLVM IR（自管 LLVM IR/MIR，不经 tmir）；`alloca/load/store`→LLVM 标准管线自动跑 mem2reg/SROA（免费）✅ 近乎零成本 | TIR SSA → LLVM SSA 直连、略省 mem2reg（微小收益）✅ |
| **`tmir→cranelift` / `tmir→wasm`** | 这些后端内部是 SSA/内存混合，收内存操作自然（WASM 的 `local.get/set` 即内存式）✅ | 需各自处理 φ，等价重建成本 |
| **`tmir→spirv`（GPU）** | 与 `device-design.md` 的线性模型、`tmir→device dialect` 同构；MLIR 多数 dialect 收内存式线性形式自然 ✅ | 需 MLIR 自有 SSA 重建（mlir 有 `mem2reg` pass，但多一层依赖） |
| **链接全局优化（CGU/ThinLTO/PGO/BOLT）** | 在 LLVM IR / 对象文件层，下游于 TIR，两种模型无差 | 同左，无差 |
| **TIR 级中端优化** | 仅当 TIR 是优化层才有意义（本项目不是） | 同左；mir 已覆盖 |

#### 净结论

1. **tmir 是后端桥，不是优化层**——mir 已在其上游完成 SSA + 全部中端优化，TIR 再做 SSA 冗余且零收益。这是否决 SSA-first 的**首要理由**。
2. **C 后端无法发射 φ**：SSA-first 在 C 路径上强制增加一个 φ-lower 回内存的 pass；memory-first 让 C 直译、把（免费的）mem2reg 成本推给 LLVM。
3. **最低风险**：最贴近现有代码生成、无支配者/φ 机制、`.tir` 快照 diff 稳定。
4. **混合路线（已纳入 Stage 5 可选）**：若未来 TIR 需要承载某些后端无关优化（如 `tmir→*` 共享的 CSE），可在 memory-first 之上**选择性 SSA 化**（`phi` 指令已预留 §6），但**不作为 Phase 1 强制**。

> ⚠ SSA 化**不在 TIR 做**（裁定 3）：SSA 归 mir 层，见 `docs/compiler/compiler-pipeline-design.md §4.3`。

---

## 3. 整体管线（落地后）

```
lex → parse → sema(+单态化+CTFE) → comptime_fold
        → [codegen_tir]  →  TIR module (.tir 文本) → tmir module (.tmir 文本+内存结构)
                                ├──→ [tmir→c]    → .c/.h  → clang
                                └──→ [TIR→ll]   → .ll     → llc（LLVM 直消费 TIR）
        （device kernel fn 经 [tmir→device dialect] → MLIR，沿用 device-design.md）
```

- `codegen_tir`（新模块，建议 `src/tir.tc` + `src/tir_emit.mjs` 序列化）**取代**现有两份类型恢复 + 两份类型映射 + 两份 per-construct lowering。
- `codegen_c` / `codegen_ll` 退化为薄翻译器：只把 TIR 指令逐条映射到 C/LLVM 语法，**不再遍历 AST、不再推类型**。

---

## 4. TIR 模块结构（文件级）

```
module "foo"            // 来源 foo.tc
source: "examples/foo.tc"

// ── 类型表 TT（已解算布局）──
types:
  %TStr     = struct { f0: ptr<i8>, f1: i64 }                        // String/bytes = {data,len}
  %TSlice   = struct { f0: ptr<void>, f1: i64, f2: i64, f3: i64 }    // {ptr,len,cap,esz}
  %TClosure = struct { f0: fn<(ptr<void>, i64) -> i64>, f1: ptr<void> }  // {fnptr,envptr}
  %Point    = struct { f0: f64, f1: f64 }                            // 用户 struct
  %Color    = alias i32                             // enum 擦除为底层标量（名仅 debug）
  %U        = union  { f0: <max-member ST> }           // 最大成员共享存储（无 tag，C 兼容）
  opt.boxed<i64>  = ptr<i64>                        // optional<i64>：可空装箱指针，none=null（现状 ABI）

// ── 字符串表（字面量）──
strings:
  0: "hello"
  1: "world"

// ── 全局 / 函数签名 ──
func @main(): i32
func @add(i32, i32): i32
extern @print(%TStr): void      // 外部/内建声明

// ── 函数体（线性指令）──
func @add(i32 $a, i32 $b): i32 {
  slot i32 $v0
  add.i32 $v0 $a $b
  ret.i32 $v0
}
```

> 记号约定：`%` 前缀 = **类型**（TT 条目引用），`$` 前缀 = **值 slot**，`@` 前缀 = **符号**（函数/全局）。三个命名空间正交，避免 LLVM 里 `%` 同时兼任类型名与值名带来的读歧义。

> **配套制品**：TIR 模块与两个上游/下游制品协同——
> - **`.tmi`（上游，typed 接口）**：由 HIR 之上 Sema 产出（见 `compiler-pipeline-design.md §4.2b`）；TIR 单态化实例的 `linkonce_odr` 符号声明须在 `.tmi` 中可查，供跨模块 `extern` 引用解析。
> - **`target_desc`（下游消费方）**：后端发射时读取目标特征矩阵（指令集 / 向量宽度 / 地址空间语义），由 `compiler-pipeline-design.md §4.3b` 定义；TIR 本身保持目标无关，仅在 `.tir` 文本中保留 `ptr<ST, as=N>` 的 `as` 维度供 device 后端取用。

### 4.1 内存表示（`src/tir.tc`）

与 `base.nodes` 同构但更简单：一个扁平的 `TirInst` 数组，每个指令是**结构化**实例（见 `pipeline-implementation-route.md §5.3` 的硬规则）：`op: TirOp` 枚举、`dst: TirOperand` / `args: []TirOperand` 结构体、`st: StorageType` 结构体、`line: u64`。**任何字段都不用 string 承载语义**——string 仅出现在 `TirModule.strings`（用户字面量）与 `TirType.name`（调试名）。类型表是 `TirType[]`（id→布局）。模块级字符串表、extern 表、func 表。

- 设计原则：**复用 `base.nodes` 的"扁平池 + 索引引用"范式**（`na/nb/nc/nd` + `la/lb/lc`），不引入新范式，降低 gate 回归风险。新模块在 DAG 中位于 `sema` 之后、`codegen_c`/`codegen_ll` 之前；DAG 约束由 `tools/dagcheck.mjs` 维持。
- **层间接口硬规则（2026-09-08 裁定）**：HIR↔TIR↔后端↔快照一律结构化，禁止用 string 在任意两层之间传递语义；文本 `.tir` 只是 `TirModule` 的单向派生（调试/快照），不可被解析回喂。详见路线文档 §5.6。

### 4.2 模块边界（已裁定：1:1 对应 `.tc` 源文件）

**裁定**：一个 TIR 模块 ↔ 一个 `.tc` 源文件，`module "foo"` + `source: "examples/foo.tc"`。不合并 import 闭包为单个大模块。

**收益**：`.tir` 快照粒度 = 文件粒度（改一个文件只有一个 md5 变，diff 精准）；发射可按模块并行；天然对应管线文档的 CGU 划分；device kernel 所在文件独立成模块，直接喂 Device Dialect。

> ⚠ **必须区分"分区键"与"可缓存单元"**（这是 1:1 最容易被误读的地方）
>
> TIR 位于**单态化之后**，而单态化是**全程序**行为（需看到所有实例化点）。因此：
>
> - **`.tc` 文件是 TIR 的分区键 / 命名归属**（用于快照、并行、CGU）——✅ 本裁定确立。
> - **`.tc` 文件不是 TIR 的独立可缓存单元**——TIR 模块的内容依赖全程序单态化结果，不能单独按文件哈希缓存。
> - 增量编译的**承重墙在 HIR(=ZIR) 层**（未定型 → 可 per-file 磁盘缓存，见 `docs/compiler/hir-design.md`）。TIR 层的缓存粒度是"单态化闭包不变时可复用"，弱于 HIR 层。
>
> 与 `docs/compiler/ir-taxonomy.md` 的术语裁定一致：TIR 的"文件级"指**分区**，其语义层级是**编译单元 / CGU 级**。

#### 4.2.1 单态化实例的模块归属（定义点归属 + 快照键拆分）

`Vec[i32]` 在 `a.tc` 定义、在 `b.tc` 与 `c.tc` 被实例化时，实例发射到哪个模块？

**裁定 A（主方案）：归属定义点所在模块 + 拆快照键。** `Vec[MyStruct]` 的单态实例进 `a.tir.inst`（见下方拆分），符号名用确定性 mangled 名 `@__inst_Vec_MyStruct`，链接语义为 `linkonce_odr`（LLVM 侧 `linkonce_odr`；C 侧 `static inline` 或 weak 符号）。跨模块消费者（`b.tir`）用 `extern @__inst_Vec_MyStruct` 引用，不发射。

##### 必撞根因：函数区（文件局部）与实例区（全局）被混在同一 md5

定义点归属下，`a.tir` 的**实例区**内容 = 全局单态闭包中「由 `a.tc` 内 generics 派生」的子集 → 它依赖**全程序**谁实例化了 `a` 的泛型。于是 `b.tc` 一旦实例化 `a` 泛型的一个**新 concrete 类型**（如 `Vec[MyStruct]`），`a.tir` 必须新增 `@__inst_Vec_MyStruct.*`，`a.tir` 的 md5 随之变化。

这是「1:1 文件快照」与「定义点归属」的表面冲突：**函数区想隔离、实例区 inherently 全局**。原"改 `b.tc` 的影响面：`a.tir` 不变（若未引入新实例）"只说对了一半——若引入了新实例，`a.tir` 必变，而这段变化被混进"函数 + 实例"一个大 md5，看起来像污染，实则是真实信号（新的单态闭包产生了）。

##### 解法：把每个模块 TIR 拆成两个独立快照单元

```
foo.tir       = 函数 + 非泛型全局符号        （纯 1:1，仅 foo.tc 自身改才变）
foo.tir.inst  = 本模块 generics 的全部单态实例（= 全局单态闭包 ∩ 本模块泛型定义）
```

门禁对两者**分别**算 md5：

| 改动 | `foo.tir`（函数区） | `foo.tir.inst`（实例区） |
|---|---|---|
| 改 `foo.tc` 函数体/类型 | 变 | 不变 |
| `b.tc` 用 `foo` 的泛型、未引入新实例 | 不变 | 不变 |
| `b.tc` 引入 `foo` 泛型的新实例（如 `Vec[MyStruct]`） | 不变 | **变（信号，应被检测到）** |

- 函数级快照 **100% 文件隔离**，兑现 1:1 承诺；
- 实例区任何变化都是真实单态闭包变化（信号非噪声），drift gate 应捕获；
- 零 IR 重复（定义点发射一次），保留全部原收益；不引入"按实例化点复制"的额外去重规则。

##### Mangled 名约定

`@__inst_<GenericDefPath>_<TypeArgsMangled>`：用**定义点全路径** + 类型实参的确定性编码，保证跨模块同名同哈希 → `linkonce_odr` 去重正确。

##### 裁定 B（兜底，非默认）：实例化点归属 + `linkonce_odr`（C++ COMDAT 模型）

若全局单态闭包计算成为管线瓶颈（超大工程），退化为：每个使用模块**本地发射**所需实例、全部标 `linkonce_odr`，链接器按 ODR 去重，最终二进制零膨胀。

| | 裁定 A（定义点 + 拆键，默认） | 裁定 B（实例化点 + COMDAT，兜底） |
|---|---|---|
| IR/对象文件重复 | 无（发射一次） | 有（C++ 既有的税，对象文件瞬态） |
| 最终二进制膨胀 | 无 | 无（链接器去重） |
| `foo.tir` 自包含 | 否（实例区依赖全局闭包） | 是（彻底与全局闭包脱钩） |
| 快照键是否需拆分 | 是（函数/实例分键） | 否（每文件自包含） |
| 增量复杂度 | 需全局单态闭包 | 每文件独立，最简单 |

📌 默认走裁定 A；仅当全局单态闭包计算实测为瓶颈时启用 B。两者最终二进制行为一致（均零膨胀），差异只在 IR 层重复与快照键形态。

例外（两种裁定通用）：定义点在**外部模块 / 内建**（无对应 `.tc`）时，实例归属**首个实例化点所在模块**，同样用 `linkonce_odr` 保证去重。

---

## 5. 存储类型格 `ST`（TIR 的唯一类型语言）

> **命名风格已裁定（2026-09-04）**：以 **LLVM 记号为基准**，三处显式偏离。裁定理由见 §5.1。

```
ST ::=
  | i1                        比较结果 / 分支条件专用（值域 {0,1}，不可作存储型）
  | i8 | i16 | i32 | i64      有符号整数（i8 亦为 bool 的存储型）
  | u8 | u16 | u32 | u64      无符号整数
  | f32 | f64
  | ptr<ST>                   host 指针（aspace=0，省略不写）
  | ptr<ST, as=N>             device 地址空间（1=global / 3=shared / 5=local）
  | arr<ST x N>               定长数组
  | vec<ST x N>               SIMD 向量
  | fn<(ST, ...) -> ST>       函数指针（签名内联，不进 TT）
  | %Name                     TT 表具名聚合引用（struct / union / variant）
  | void
```

### 5.1 三处偏离 LLVM 的理由（裁定依据）

| # | 偏离 | LLVM 的做法 | TIR 的做法 | 为什么必须偏离 |
|---|---|---|---|---|
| 1 | **整数带符号性** | 符号性在**指令**上（`sdiv`/`udiv`、`sext`/`zext`），类型只有 `iN` | 类型上区分 `iN`/`uN` | C 后端必须发射 `int64_t` vs `uint64_t`。若类型不带符号性，`tmir→c` 就得回头扫描指令来推导符号性——这正是 TIR 要消灭的"后端自行推导"。信息放在类型上，两个后端都只读不推。 |
| 2 | **指针带 pointee + aspace** | `ptr` 完全 opaque（LLVM 15+ 移除了 pointee） | `ptr<ST>` / `ptr<ST, as=N>` | C 后端必须发射 `T*`，需要 pointee；device 路径需要地址空间（`docs/compiler/device-design.md` 的 `pointer.as`）。TIR 保留全部信息，**LLVM 侧发射时丢弃 pointee 发 opaque `ptr`**、C 侧取 pointee 发 `T*`——各取所需，谁都不用推导。 |
| 3 | **聚合具名引用而非内联展开** | 允许内联匿名 `{i8*, i64}` | 一律 `%TStr` 指向 TT 条目 | ① C 后端要发 `typedef struct` 的**名字**；② diff 友好：改一个字段只动 TT 一行，不会让所有使用点的文本全变——直接决定 `.tir` md5 快照的信噪比。 |

### 5.2 被显式擦除的源类型名（不进 ST）

TIR 是**类型擦除**层，以下源语义名一律解算为底层 ST，**不在 ST 里出现**：

| 源类型 | 擦除为 | 说明 |
|---|---|---|
| `bool` | **`i8`**（存储）/ **`i1`**（比较结果） | 现状即如此：LLVM 侧 bool 存储是 i8，`icmp` 产 i1 需 `ll_b8()` zext。TIR 把这条隐规则**显式化**：`i1` 只能来自 `cmp.*`、只能喂给 `br_cond`；存进 slot 必须显式 `zext.i8`。这一条消灭了"bool 到底几位"这个历史歧义源。 |
| `atom` / `fid` | `u64` | 语义名保留在 TT 的 debug 注释里，不进 ST。 |
| `sym` | `u16` / `u32` | 按现有 `t.alen == 16` 判据解算（`codegen_c.tc:582`）。 |
| `enum` / `flag` | 底层标量 ST | enum 名进 TT debug 注释。 |
| `named` alias | 解算到底层 | 别名在 TIR 里不存在。 |
| 泛型参数 `T` | **不应出现** | 单态化在上游完成；出现即内部错误。 |

- **ABI 事实集中表达于此 + TT**：`String={ptr,len}`、`slice={ptr,len,cap,esz}`、`closure={fnptr,envptr}`、`enum/flag=底层标量`、`vector=<NxT>`、`union=最大成员（无 tag，C 兼容）`、`map=ptr(TMap*)`、`sym=i32/i16`——这些现在散在 `ll_td`/`desc_to_c` 与 `runtime/*.h`，TIR 把它们统一进 **TT 一次**，双后端只做"ST→目标类型名"的极小映射（`tir_tt_to_c` / `tir_tt_to_ll` 远小于现有完整 lowering）。

---

## 6. 指令集（线性、三地址式、memory-first）

操作数记号：`$n` = slot 引用；`imm` = 立即数；`@label` = 基本块标签；`<id>` = 类型表/字符串表 id。

### 6.1 槽与内存
| 指令 | 语义 |
|---|---|
| `slot ST $n [name]` | 声明一个帧 slot（存储类型 ST） |
| `load ST $dst $ptr` | 从指针 `$ptr` 载出 ST 值到 `$dst` |
| `store $val $dst` | 把 `$val` 存入 slot `$dst`（ST 须匹配） |
| `addr_of $dst $slot` | `$dst = &slot`（ptr） |
| `gep ST $dst $base idx...` | 指针 `$base` + 索引 → 元素地址；`ST`=元素存储类型 |
| `extract ST $dst $agg idx` | 从聚合**值**（非指针）取元素 |
| `insert $dst $agg $val idx` | 向聚合值插入元素 |

### 6.2 常量
| 指令 | 语义 |
|---|---|
| `const ST $dst imm` | 带 ST 的立即数（int/float/bool/atom/fid） |
| `const.ptr.null ST $dst` | `ptr<ST>` 的空指针 |
| `const.str $dst <id>` | 引用模块字符串表 `<id>` |
| `const.zero ST $dst` | ST 的零值 |

### 6.3 算术 / 逻辑（以宽度/种类作后缀）
```
add/sub/mul  .iN|.uN        $dst $a $b
udiv/sdiv/urem/srem .iN|.uN  $dst $a $b
fadd/fsub/fmul/fdiv .f32|.f64
and/or/xor/shl/lshr/ashr        $dst $a $b
neg/fneg/not                     $dst $a
```

### 6.4 比较（产出 bool）
```
eq/ne/slt/sle/sgt/sge   .iN|.uN    $dst $a $b
ult/ule/ugt/uge         .iN|.uN
foeq/fone/folt/fole/... .f32|.f64
```

### 6.5 造型（cast）
```
sext/zext/trunc                STdst STsrc $dst $src   (整宽变化)
fptosi/fptoui/sitofp/uitofp    STdst STsrc $dst $src
fptrunc/fpext                  STdst STsrc $dst $src
bitcast/inttoptr/ptrtoint      STdst STsrc $dst $src
```

### 6.6 聚合构造
| 指令 | 语义 |
|---|---|
| `struct_new %Name $dst ($f0 $f1 ...)` | 构造 struct 值 |
| `array_new ST $dst ($e0 $e1 ...)` | 构造定长数组值 |
| `vec_new ST $dst ($l0 $l1 ...)` | 构造向量值 |
| `closure_new $dst $fnptr $env` | 构造闭包值 `{fnptr,envptr}` |

### 6.7 调用
| 指令 | 语义 |
|---|---|
| `call ST $dst @fname ($a0 $a1 ...)` | 直接调用 |
| `call_ind ST $dst $closure ($a0 ...)` | 经闭包 `{fnptr,envptr}` 间接调用 |
| （内建 `@panic`/`@assert_*`/`@strlen` 等直接用 `call @name`） | 名字保留、由后端/链接器解析 |

### 6.8 控制流（线性、显式）
| 指令 | 语义 |
|---|---|
| `block @label` | 基本块开始 |
| `br @label` | 无条件跳 |
| `br_cond $cond @then @else` | 条件跳 |
| `switch $val [@case_i @label_i ...] @default` | match-on-enum 降级为 switch |
| `ret [$val]` / `ret.void` | 返回 |

### 6.9 杂项 / 诊断
- `comment "..."`：仅诊断用，不进目标代码。
- `phi ST $dst [($v0 @b0) ...]`：Phase 2 SSA 化后用于优化 pass（Phase 1 不出现）。

---

## 7. 源类型 → TIR 降级规则（单点定义）

下表是"源 TD.cat → TIR ST / 构造"的**唯一真理源**，取代 `desc_to_c` 与 `ll_td`：

| mir `TD.cat` | TIR 表达 |
|---|---|
| `scalar` i8..i64 / u8..u64 / f32 / f64 | 同名 ST |
| `scalar` `bool` | `i8`（存储）；比较结果为 `i1`，存回需 `zext.i8`（见 §5.2） |
| `scalar` `atom` / `fid` | `u64` |
| `string` / `bytes` | `%TStr` / `%TBytes` = `struct { ptr<i8>, i64 }` |
| `slice` | `%TSlice` = `struct { ptr<void>, i64, i64, i64 }`（ptr,len,cap,esz） |
| `pointer` (host) | `ptr<ST>` |
| `pointer` (device, `memspace>0`) | `i64`（**不透明句柄 CUdeviceptr**；沿用 `codegen_c.tc:578` / `codegen_ll` 现状），仅 kernel 体内经 `ptr<ST, as=N>` 承载 |
| `array(ST, len)` | `arr<ST x len>` |
| `map` | `ptr<void>`（`TMap*`，runtime 管理） |
| **`optional<T>`（Stage 1 唯一形态）** | **`ptr<ST_T>`** —— 可空装箱指针，`none` = null。**严格沿用现状**：`codegen_c.tc:581` `c_ptr_to(t.elem)` / `codegen_ll.tc:365` `"ptr"`；`some(x)` = `t_opt_some(&x, sizeof T)`（arena 分配 + memcpy）、`unwrap` = null 检查 + 解引用、`is_some`/`is_none` = null 比较。TT 记为 `opt.boxed(ST_T)`。 |
| `optional<T>`（预留，Stage 5+） | `%TOpt_T` = `struct { i8, ST_T }` —— 按值 tagged，零分配。TT 记为 `opt.tagged(ST_T)`。**未启用**，见 §15 裁定 2 |
| `struct(name)` | `%name`（TT 条目含字段偏移） |
| `enum` / `flag` | 底层标量 ST |
| `union` | `%uname` = `struct { i8, <最大成员 ST> }` |
| `variant` | `%vname` = `struct { i8, <data...> }` |
| `vector(ST, lanes)` | `vec<ST x lanes>` |
| `closure` | `%TClosure` = `struct { fn<...>, ptr<void> }`（沿用已统一的 TClosure ABI） |
| `func` sig | `fn<(ST, ...) -> ST>` |
| `sym` | `u16`（`alen==16`）/ `u32` |
| `typeinfo` / `fieldinfo` | `%TTypeInfo` / `%TFieldInfo` |
| `named` alias | 解算到底层 ST / TT 条目（别名不存在于 TIR） |
| `void` | `void` |
| `unknown` | **错误**：sema 之后不应出现 |

> 注：`match` 表达式（含 match-on-enum）在降级时变成"结果 slot + `switch`/`br_cond` 链"，与现有两个后端 `emit_expr` 的 match 分支降级方式一致，只是现在只写一次。

---

## 8. AST → TIR 降级（新 pass：`codegen_tir`）

入口：`tir.lower_unit()`，在 `comptime_fold.comptime_fold_pass()` 之后调用（与现有 `emit_llunit`/`emit_unit` 同一时机）。

步骤：
1. **建 TT**：遍历所有 `StructDecl/EnumDecl/UnionDecl/VariantDecl/FlagDecl`，解算字段偏移/大小/对齐，写入类型表。切片/字符串/闭包/optional 的标准 struct 也登记进 TT。
2. **建符号表**：遍历 `lex.decl_list`，为每个函数生成签名（`ST` 形参 + `ST` 返回值）。跳过 `func_is_generic`（模板，已是具体实例才进 TIR）与 `kernel fn`（`bf`，走 device 路径）。
3. **降级函数体**：对每个函数，按 mir 求值序遍历其语句/基本块/SSA 值，把每个 SSA 值"翻译到目标 slot"：
   - mir 值 `v` + 目标 slot `$d` → 发射一串 TIR 指令，最终把 `v` 的值放进 `$d`（类型擦除：mir 的源类型 → ST）。
   - 控制流（`if/for/while/return/break/continue/var_decl/assign/block/defer`，已由 mir 降级为 CFG 基本块 + 终止指令）→ 直接映射为 TIR 的 `block/br/br_cond/switch/ret`。
   - 子值先降级，结果 slot 作为父指令操作数。

此 pass **一次性替代**了 `expr_type_desc`/`ll_etd`（类型恢复）与 `desc_to_c`/`ll_td`（类型→文本）以及全部 per-construct lowering。两个后端不再需要这些。

---

## 9. 双后端变薄（TIR → 目标）

### 9.1 C 后端（`emit_unit` 改写为消费 tmir）
- `slot ST $n` → C 局部变量 `desc_to_c(ST) n;`
- `load/store` → C 赋值 `n = *p;` / `*p = v;`
- `gep` → `.field` / `[idx]`（由 ST + TT 偏移决定）
- `call` → `n = f(args);`，闭包解包 `{fnptr,envptr}`
- `block`/`br`/`br_cond` → C 标签 + `goto` / `if`
- 仅保留极小的 `tir_tt_to_c`（ST→C 类型名），不再有完整 lowering。

### 9.2 LLVM 后端（`emit_llunit` 直消费 TIR，不经 tmir）
- `slot ST $n` → `alloca ST`
- `load/store` → `load`/`store`
- `gep` → `getelementptr inbounds`（由 ST + TT 偏移）
- `call`/`call_ind` → `call` / 解包 `%TClosure`
- `block`/`br`/`br_cond`/`switch`/`ret` → 基本块 + 终止指令
- 仅保留极小的 `tir_tt_to_ll`（ST→LLVM 类型），不再有完整 lowering。

**关键收益**：两个后端读的是**同一个 TIR 的 ST**，因此 `%TStr`/`%TSlice`/`%TClosure`/enum 底层/vector 布局由 TT **定义一次**。`gate L2` 的 `cself`（C 自举后再 `emit-ll` 与 `g4.ll` 逐字节比对）将变为**结构性等价**——只要 TIR 一致，两端目标代码必然一致，而非靠运气文本一致。

---

## 10. 设备子系统衔接

- `kernel fn` 在 TIR 中仍是带 `kernel` 标志的函数；其指针形参带 `aspace`（device 地址空间，见 `pointer.memspace`）。
- `codegen_dev` 从"直接读 AST"改为"消费带 `aspace` 的 tmir"→ 发射 Device Dialect 文本（`docs/compiler/device-design.md` L4/L5 不变）。
- TIR 的 `ptr<ST, as=N>` 完整保留地址空间信息，device 路径降级时直接读 `aspace`，无需再翻 AST 的 `memspace` 字段。

---

## 11. 单态化 / comptime 衔接（无变动）

- 单态化（`instantiate_generic`，`sema.tc:1680`）与 comptime 折叠（`comptime_fold_pass`）都在 sema/后处理阶段完成，TIR 只看到**已 concrete 的实例**——与现在两个后端看到的世界完全一致。
- TIR 中**不存在泛型**：模板函数已被单态化为具体实例 FuncDecl，降级时类型全落定（这也解释了 `!j` 脱糖为何推迟到实例：TIR 在实例层面才看到具体 JSON 编码目标，降级只做一次）。
- 这意味着在 TIR 上，**Bug1（泛型 `!j` 单态实例未解糖）与 Bug2（LLVM `TStr+TStr` 错 emit 为 `add`）这类双后端不一致 bug 从根上消失**——降级写一遍。

---

## 12. 序列化、快照与 gate 集成

> **已裁定（2026-09-04）**：**双格式** —— 文本 `.tir` 为规范真相源，二进制 `.tirb` 为速度格式。分工见 12.1 / 12.1b。

### 12.1 文本格式 `.tir`（规范真相源）
人类可读、可 diff（见 §4 示例），一个模块一个 `.tir` 文件。内存结构（`src/tir.tc`）与文本双向可序列化。

**"规范真相源"的三条硬约束**：
1. **md5 快照只对文本算**。二进制永不进基线——它可能因版本号、padding、字段序变化而字节不同却语义相同，会产生假阳性门禁失败。
2. **语义分歧一律以文本为准**。若二进制读回的结构与文本解析结果不一致，判定二进制实现有 bug。
3. **文本必须自足**：脱离编译器版本也能被人/脚本读懂，不依赖任何外部符号表。

### 12.1b 二进制快格式 `.tirb`（速度格式）

**用途**（三处，都是"机器读、不给人看"）：
- **增量缓存**：编译器内部高速读回，避免重复文本解析。
- **device 内嵌**：`docs/compiler/device-design.md` 已定 JIT 默认内嵌 Device MLIR **bytecode**，`.tirb` 与之同构。
- **分布式/远端构建**：传输体积与解析成本都显著低于文本。

**格式规格**：

| 项 | 规定 |
|---|---|
| Magic | `TIRB`（4 字节） |
| Version | u32 单调递增；**版本不匹配即视为缓存失效并重建**，不做向后兼容解析（避免多版本解析分支成为 bug 温床） |
| 字节序 | 固定小端（确定性构建要求，不随宿主变化） |
| 布局 | 段式：`header / TT 表 / 字符串表 / 符号表 / 函数体指令流`。指令为定长记录 + 变长操作数池 |
| 浮点 | 按 IEEE-754 位模式原样存取，禁止十进制往返（避免精度漂移破坏确定性） |

**门禁：round-trip 逐字节等价（新增，必须进 gate）**

```
text --parse--> mem --emit_bin--> .tirb --parse_bin--> mem' --emit_text--> text'
断言：text' 与 text 逐字节相同
```

这条断言把"两套序列化器语义一致"变成**可自动化验证的机械判据**，而不是靠人工审查——正是 TIR 引入本身要解决的那类问题（同一语义写两遍必漂移）在序列化层的复现与防御。实现为 `tools/tir_roundtrip.mjs`，挂进 gate 的 TIR 步。

### 12.2 快照（取代/增强 `ir_snapshot.mjs`）
- 新增 `tools/tir_snapshot.mjs`：对每个 `examples/*.tc` + `src/tc.tc` 产 `emit-tir` → `.tir` 文本的 md5，写入 `tests/tir_baseline.json`。（注：`tote` 已于 2026-10-15 抽出为独立项目 `../tote`，不再作为本仓库快照目标。）
- 因为 TIR 后端无关，**一个 TIR md5 同时覆盖两个后端**——不再需要分别比对 `.ll` 与 `.c` 来证明等价。
- `ir_snapshot.mjs` 现有的 `.ll`/`.c` md5 作为**端到端安全网**保留（验证逻辑：TIR 正确 ⇒ 两后端一致 ⇒ 文本一致）。

#### 12.2.1 快照键拆分（隔离粒度各归其位，见 §4.2.1）
每个模块 TIR 的快照键**拆成两个**，分别算 md5 并以不同触发器失效：

| 单元 | 内容 | 失效触发器 |
|---|---|---|
| `foo.tir` | 函数 + 非泛型全局符号 | **仅** `foo.tc` 自身改 |
| `foo.tir.inst` | 本模块 generics 的全部单态实例（= 全局单态闭包 ∩ 本模块泛型定义） | 仅当某处引入本模块泛型的新实例 |

- 函数级快照 100% 文件隔离（改 `b.tc` 不动 `a.tir`）；实例区变化是真实信号（新单态闭包产生），由 drift gate 捕获而非误判为污染。
- 归属仍按**定义点**（`Vec[MyStruct]` 进 `a.tir.inst`，mangled 名 `@__inst_Vec_MyStruct`，标 `linkonce_odr`）；`b.tir` 用 `extern` 引用不发射。

#### 12.2.2 跨模块摘要键（`.tmi`，G-5）
- `.tmi`（typed 模块接口，键=API 指纹，见 `compiler-pipeline-design.md §4.2b`）按**内容哈希**进入跨模块摘要缓存，启用**增量 LTO**：跨构建复用 ThinLTO / 跨模块内联所需的摘要索引，不每次重算全程序摘要。
- 规模化必备，且与 G-1 的查询缓存、G-6 的远程缓存共用同一 action-key 机制（键 = 内容哈希 + 编译器版本 + 目标三元组）。

### 12.3 gate L2 改造
- `boot4` 自举不动点判据从"`.ll` md5 相等"升级为"**`tir(g2)==tir(g3)==tir(g4)`**"——复杂度更低（只编译到 TIR 一次比对，不必两次 emit LLVM）。
- `cself`：C 后端产物再 `emit-tir`，与 `g4.tir` 结构化比对。
- `rls`/`dbg`：`emit-tir` 比对，取代 `.ll` 比对。
- 现有 `.ll`/`.c` md5 比对降级为 smoke 校验，不阻断主流程。
- **新增 `tirrt` 步（序列化 round-trip 门禁，裁定 4）**：`node tools/tir_roundtrip.mjs` 对每个 `.tir` 断言 `text → .tirb → text'` 逐字节相同。失败即阻断——两套序列化器语义不一致属于同类漂移，必须机械拦截而非人工审查。

> ⚠ **IR 漂移归零铁律沿用**：改前端后，先 `cp out/dbg/g4.exe out/dbg/tc.exe`（及 rls `out/rls/gr.exe`），再 `node tools/tir_snapshot.mjs --compiler out/dbg/g1.exe --update` 重录 TIR 基线，最后复跑 gate。判不动点只比 `.tir` md5，非 `.exe` md5（debug 构建 `.exe` 含路径/时间戳元数据，会不同）。

---

## 13. 分阶段落地路线（staged bootstrap，贴合现有 gate 哲学）

- **Stage 0**：新增 `src/tir.tc`（内存结构 + **文本**序列化）+ `emit-tir` 子命令。后端保持不变。
- **Stage 1**：实现 `codegen_tir` 降级（**子集**：标量、调用、if/for/while、struct 字段、返回）。`emit-tir` 跑通；TIR 文本稳定、可读。门禁：TIR 文本 md5 稳定（不要求与旧 `.ll` 一致，是新增维度）。**optional 一律 `opt.boxed`（裁定 2）。**
- **Stage 2**：实现 `tmir→c` 薄后端，让 `emit-c` 改走 TIR。通过 `gate L2`。
- **Stage 3**：`emit-ll` 直消费 TIR（自管 LLVM IR/MIR，不经 tmir）。通过 `gate L2`。**双后端共享 TIR 单一真相源，Bug1/Bug2 类问题根除。**
- **Stage 4**：删除重复的 `expr_type_desc`/`ll_etd`/`desc_to_c`/`ll_td`/per-construct 发射代码。TIR 成为唯一真相源。上线 `tir_snapshot` 门禁。
- **Stage 4b**：二进制 `.tirb` 序列化器 + `tools/tir_roundtrip.mjs` round-trip 门禁上线（裁定 4）。此前所有阶段只用文本，二进制不影响任何既有判据。
- **Stage 5+（独立 ABI 优化项）**：
  - `opt.tagged` 启用（`T?` 由装箱指针改为按值 `{i8, ST}`）——**独立 stage、独立基线重录**，不与上述任何阶段并行（裁定 2 的理由：一个 stage 只引入一条风险线）。
  - TIR 层优化 pass（若 mir 层未覆盖）；device 后端改由 TIR 驱动。
  - ⚠ SSA 化**不在 TIR 做**（裁定 3）：SSA 归 mir 层，见 `docs/compiler/compiler-pipeline-design.md §4.3`。

每个 Stage 结束都以 `gate L2` 全绿为合并门槛，保证自举不动点不破。

---

## 14. 风险与回滚

- **自举不动点**：插入 TIR 不改变 `tc.tc` 本身（无 kernel、无泛型使用），故 `g2==g3==g4` 不动点不受影响（device-design.md 已确认同类结论）。
- **ABI 一致性**：TT 集中定义布局，双后端只读 ST，避免两侧布局漂移。
- **回归面**：Stage 2/3 是风险高峰——若某构造 TIR→目标映射与旧后端逐字节不一致，`.ll` md5 安全网会立刻报警；此时回退该 Stage（保留旧后端分支）即可，不影响主线。
- **性能**：memory-first TIR 与现有 `alloca`+`store` 模型同构，不会比现状更差；Phase 5 SSA 可进一步提质。

---

## 15. 裁定记录（全部已拍板，2026-09-04）

> ⚠ **裁定 1（ST 命名）= 用户裁定「选项 3」**：以「LLVM 记号为基 + 三处刻意偏离」为正式选项 3，已锁定。其余 4 项亦为用户拍板。
> **暂不进入实现（不要编码）**：以上裁定当前仅作为设计契约锁定于文档；`src/tir.tc` 等实现代码**未开工、未写入**。后续进入实现需另行指令。

| # | 议题 | 裁定 | 落地位置 |
|---|---|---|---|
| 1 | **ST 命名风格** | **LLVM 记号为基 + 三处显式偏离**（整数带符号性 / 指针带 pointee+aspace / 聚合具名引用）。记号命名空间三分：`%`=类型、`$`=值 slot、`@`=符号 | §5、§5.1、§5.2、§4 |
| 2 | **`T?` 的 ABI** | **Stage 1 严格沿用现状 `opt.boxed`（可空装箱指针）**；`{tag i8, payload ST}` 收进规格为 `opt.tagged`，**Stage 5+ 独立启用**。详见下方"裁定 2 的矛盾与解法" | §7、§15.2 |
| 3 | **memory-first vs SSA** | **memory-first**；SSA 归 mir 层（管线文档 G/H 阶段） | §2.4（完整权衡+后继节点影响）、§6、`compiler-pipeline-design.md §4.3` |
| 4 | **序列化格式** | **双格式**：文本 `.tir` = 规范真相源（md5 快照只对它算）；二进制 `.tirb` = 速度格式（增量缓存 / device 内嵌 / 远端构建），带 **round-trip 逐字节门禁** | §12.1、§12.1b |
| 5 | **模块边界** | **1:1 对应 `.tc` 源文件**；单态化实例按**定义点归属** + `linkonce_odr`。⚠ `.tc` 是**分区键**而非**可缓存单元**（缓存承重墙在 HIR 层） | §4.2、§4.2.1 |
| 6 | 落地顺序 | 见 `docs/compiler/compiler-pipeline-design.md §9`（裁定 A 后：先立 HIR(=ZIR) → 再 mir 优化 → 再 TIR(线性) → 再 tmir(机器桥)） | §13 |

### 15.2 裁定 2 的矛盾与解法（重要）

原裁定要求同时满足两件事，但**实证证明二者互斥**：

- 要求 a：「TIR 用 `{tag i8, payload ST}`」
- 要求 b：「严格沿用现有 `desc_to_c`/`ll_td` 的精确内存布局」

**实证的现状 ABI 不是 tagged struct，而是 arena 装箱的可空指针**：

| 证据 | 位置 | 内容 |
|---|---|---|
| C 后端类型映射 | `src/codegen_c.tc:581` | `if (t.cat == "optional") { return c_ptr_to(t.elem); }` —— 注释明写「可选类型 ?T 与引用同构：可空的元素指针（none = NULL）」 |
| LLVM 后端类型映射 | `src/codegen_ll.tc:365` | `if (t.cat == "optional") { return "ptr"; }` |
| `some(x)` 语义 | `runtime/t_runtime.c:42` | `t_opt_some(src, sz)` = **arena 分配 + memcpy**，返回指针 |
| `unwrap` 语义 | `runtime/t_runtime.c:48` | null 检查（报 `unwrap_none` 并 exit 1）后返回指针 |
| `is_some`/`is_none` | `src/codegen_c.tc:2325` | null 比较 |

即：`T?` 的存储是 `ptr`，**`some(x)` 每次都堆分配**；tagged struct 则是按值、零分配。两者不仅布局不同，**分配语义也不同**（后者不占 arena，影响 arena 生命周期）。

**解法：规格两种都收，落地分期**

- **TT 支持两种 optional 表示**，由类型表条目标记选择：`opt.boxed(ST)` → 降为 `ptr<ST>`；`opt.tagged(ST)` → 降为 `struct { i8, ST }`。
- **Stage 1 只用 `opt.boxed`**。理由是门禁的可判定性：TIR 落地阶段的唯一验收标准是**IR 逐字节零漂移**（`.ll`/`.c` 与落地前完全一致）。若同时改 optional ABI，"TIR 降级写错了"与"ABI 改版本身导致的差异"两类回归会混在同一批 diff 里，无法定位来源——这与项目既有的 staged bootstrap 哲学（每 Stage 只引入一条风险线）直接冲突。
- **`opt.tagged` 作为独立 ABI 优化项排到 Stage 5+**，届时收益是明确的：小类型（`i32?`/`bool?`）省一次堆分配与一次间接寻址、可进寄存器、不再污染 arena。启动时按标准流程走：改 → `gate L2` → 同步 `tc.exe` → 重录 TIR/IR 基线 → 提交。
- **规格一次写对、不返工**：因为两种表示从第一天就在 TT 里定义好，Stage 5+ 只是把默认标记从 `boxed` 切到 `tagged`，无需改 TIR 结构、无需改指令集。

---

## 附 A：端到端示例（同源 → TIR → 双后端等价）

源（`examples/vec_add.tc` 简化）：
```t
fn add(a: i32, b: i32) -> i32 {
    return a + b;
}
```

TIR（`emit-tir` 输出，节选）：
```
module "vec_add"
func @add(i32 $a, i32 $b): i32 {
  slot i32 $v0
  add.i32 $v0 $a $b
  ret.i32 $v0
}
```

`tmir→c`：
```c
i32 add(i32 a, i32 b) {
  i32 v0;
  v0 = a + b;
  return v0;
}
```

`TIR→ll`（LLVM 直消费 TIR，不经 tmir）：
```llvm
define i32 @add(i32 %a, i32 %b) {
  %v0 = alloca i32
  %t0 = add i32 %a, %b
  store i32 %t0, i32* %v0
  %t1 = load i32, i32* %v0
  ret i32 %t1
}
```
（LLVM 侧可由后端选择是否 mem2reg；语义与 C 完全一致。）

---

## 附 B：与现有设计文档的关系

- `docs/compiler/device-design.md`：TIR 的 `ptr<ST, as=N>` 直接承接其 L1 `pointer.as` 地址空间设计；device 路径在 TIR 之上实现，不冲突。
- `docs/compiler/comptime-design.md` / `docs/compiler/meta_design.md`：单态化与 CTFE 在 TIR 之前完成，TIR 只消费 concrete 实例，无需改动。
- `tools/ir_snapshot.mjs` → 派生 `tools/tir_snapshot.mjs`：快照维度从"双后端文本"收敛为"单一 TIR 结构化"，是本次设计的核心门禁收益。
