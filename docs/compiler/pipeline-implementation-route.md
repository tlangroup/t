# T 编译管线 —— 具体实现路线 v3（2026-09-08 · 全管线迁移）

> **本文取代 v2 的执行顺序。** v2 的契约条款（准绳定义、结构化验收判据、日落止损）经筛选后继承至 §5 / §7；v1/v2 的实现偏离复盘压缩为**附录 A**，作为 v3 的立论依据。
> 关联：`compiler-pipeline-design.md`（总管线）、`tir-design.md`、`hir-design.md`、`tmi-design.md`、`ir-taxonomy.md`。

---

## 0. 版本沿革与立论前提

### 0.1 三版关系

| 版本 | 时间 | 主张 | 结局 |
|---|---|---|---|
| v1 | 09-05 | TIR 加性层，Stage 0+1 | 实现**偏离契约**（附录 A） |
| v2 | 09-08 早 | 补日落条款 + 验收判据 + 端到端准绳 | 契约正确，但未解决「TIR 是并行第三路」的结构问题 |
| **v3** | 09-08 | **全管线垂直切片迁移**（本文） | 进行中 |

### 0.2 v3 的立论前提

> **本工程其他功能已全部停止，只做编译管线迁移。**

这条保证**解锁**了此前不敢做的选项，同时**没有解锁**另一些：

| 解锁 | 未解锁 |
|---|---|
| 可以动 `sema.tc`（551KB）——回归面不再是约束 | **自举不能停**：`tc.tc` 必须始终能被编译，否则新管线无法自证 |
| 可以从 HIR（类型化 AST）起手，而非绕开它直做 TIR | 语义规则**不可重写**——重写等于重踩数百个已修 bug |
| 可以做双轨对拍（旧管线继续维护自举） | 不可「推倒重来、一次性切换」——无对拍则无法判断正确性 |

**由此推出 v3 的两条硬约束：双轨（§3）+ 改造而非重写（§6）。**

---

## 1. 战略裁定

### 1.1 用垂直切片，不用逐层做完

IR 的形状由**下游需求倒逼**决定，不由上游推导：TIR 的 ST 体系取决于目标 ABI，MIR 的 SSA/CFG 取决于优化需求，HIR 的类型槽取决于 sema 查询需求。若自底向上逐层做完，设计 HIR 时后端尚未触碰，只能猜；到后端发现缺信息，则连锁回头改上面每一层。

**垂直切片**：不按层推进，按**语言构造**推进。每个切片让一批构造**横贯所有层**并端到端可跑；每层能力同步增长，接口被真实需求倒逼，而非猜出来。

### 1.2 起点不是 lex

| 理由 | 说明 |
|---|---|
| 痛点不在前端 | 真正的重复是 `ll_etd` / `ll_td` / `desc_to_c` 与双份 per-construct lowering，全在 sema **之后**；lex/parse 无重复 |
| 从 lex 起步 = 在唯一无痛点处花力气 | 而真痛点被推到最后才碰到 |
| lex/parse 是**资产不是负担** | 131 个 example 能过，重写只会丢东西 |

**真正的起点是「对拍框架 + AST 类型槽」**：前者提供判据，后者消除 `ll_etd` / `expr_type_desc` 存在的根因——`Node` 无类型字段，后端才不得不在发射期重新推导。

### 1.3 加 MIR 机器中间层（取代 LLVM 的轻量多后端）★ 2026-09-13 裁定反转

> **本裁定反转此前「先建两层，不建 MIR」（v3 原 §1.3）的判断。** 原判断的出发点是「中端优化需求缺失 → MIR 空转」；但用户新增的硬性需求改变了立论前提：**需要一个位于 TIR 之后、各轻量后端（WASM / RISC-V / C）之前的机器中间层，作为取代 LLVM 的通用中间层**（原话：「TIR 之后加一个机器中间层，用于取代 llvm 的轻量各种后端的中间层，例如 wasm、riscv 等」）。

- **MIR 的动机是「后端可移植性」，不是「中端优化」**：一条 MIR，多个薄后端。新增目标（wasm / riscv / 后续 loongarch / arm64 …）只需写一个薄发射器，而非各自维护一份完整降级——这正是 v1/v2 失败的根因（平行翻译器越加越多，§附录 A-4）。
- **MIR 复用 TIR 的操作码（TIR_OP_*）与存储类型格（ST_*）**，不重新发明：MIR = TIR 的「显式 CFG + 机器类型」形态。TIR→MIR 仅是把线性指令按基本块（`TIR_OP_BLOCK` / 终止指令）重分组，**语义零改动**（见 `src/mir.tc` 的 `tir_to_mir_lower`）。这把「层间接口」的成本压到最小，符合 §5.6 零 string 语义。
- **MIR 不承载 LLVM 专属概念**：无 `ccc` 调用约定、无 `global` 元数据副作用；调用统一为 `call ret_st @callee (args)`，各后端映射到自身 ABI（WASM `call`、RISC-V `call`+`a0..a7`、C 函数调用）。
- **与 S5 的关系**：S5 切换消费 TIR 仍成立；MIR 是 TIR 的下游消费者之一。原 S5「删 codegen_ll/codegen_c」的判定改为「删 codegen_ll，保留 codegen_c 改造为 MIR→C 便携后端」（见 §10）。

由此推出：**管线变为 HIR → TIR → MIR → { WASM | RISC-V | C |（可选 LLVM）}**，MIR 是「一套中间层、多个薄后端」的分水岭。

### 1.4 改造，不是重写

保留 `lex.tc` / `parse.tc` / `sema.tc` 的语义规则与已修 bug 积累。核心动作只有两个：

1. **给 AST 加类型槽**（`Node` 增加类型字段，sema 填入）→ 即 HIR
2. **后端改消费新 IR**（改 `codegen_ll` / `codegen_c` 的**输入**）→ 消除 `ll_etd` / `expr_type_desc`

---

## 2. 目标架构

```
lex → parse → AST → sema ──► HIR（类型化 AST）──► TIR（类型擦除·线性）──► MIR（机器 IR·显式 CFG）──► { WASM | RISC-V | C |（可选 LLVM）}
                      │            ↑ 类型槽由 sema 一次性填入        ↑ 降级只发生一次        ↑ 薄后端各自映射 ABI
                      └─ 语义规则复用，不重写
```

| 层 | 职责 | 载体 | 状态 |
|---|---|---|---|
| AST | 语法结构（无类型） | `base.Node` | 现有，保留 |
| **HIR** | AST + 类型槽；sema 一次性把 TD 写入节点 | `Node` 新增类型字段（或并行类型池 + 索引） | **新增（S0）** |
| **TIR** | 类型擦除、线性、编译单元级；每指令自带 `StorageType` | `src/tir.tc` | 现有，**须按 §5.3/§5.6 重构为结构化（零 string 语义载体）** |
| **MIR** | 机器类型、显式基本块（CFG）、虚拟 slot；TIR 的 CFG 重分组形态 | `src/mir.tc`（`tir_to_mir_lower`）+ `MIRModule` | **新增（M0，2026-09-13 落地）** |
| 后端 | MIR → 目标语法的薄发射器（薄到只做 ABI 映射 + 指令选择） | `codegen_wasm` / `codegen_riscv` / `codegen_c`（改消费 MIR）/ `codegen_ll`（可选） | **wasm/riscv 新增（M1）；C/LLVM 改造中** |

> **关键**：后端改的是**输入**（消费 TIR），不是在旁边新增第三个翻译器。v1/v2 正是在这一点上被做反（附录 A-4）。

---

## 3. 双轨对拍（v3 安全机制）

同一 `.tc` 输入分别走旧轨与新轨，比对**运行输出**（不是 `.ll`、不是 `clang -c`）。

- **旧轨**：`lex → parse → sema → codegen_ll`（现状，始终可编译 `tc.tc`，维持 `g2==g3==g4`）
- **新轨**：`… → HIR → TIR → 后端`
- **对拍**：两侧分别 link + run，diff 输出

| 条款 | 内容 |
|---|---|
| **切换判据** | 新轨能编译 `tc.tc`，且运行输出与旧轨**逐字一致** |
| **回退** | 旧轨全程保持可用；任一切片失败即回退旧轨，不影响自举 |
| **基线** | `examples/*.expected.txt`（70 个）+ gate L2 自举不动点 = 对拍黄金集 |
| **门禁** | 对拍接入 `tools/gate.mjs`；先 **warn 级**冻结退化，切片全绿后转 **hard** |

> **S-1 先于一切**：没有对拍，无法判断新轨正确与否，等于盲改数万行。

---

## 4. 切片计划（v3 主导路线）

> 原则：**先止血，再切片加宽。** 每片都是端到端闭环，可跑、可对拍、可回退。

| 切片 | 内容 | 完成判据 |
|---|---|---|
| **S-1** | **对拍框架**：`tools/_diffpipe.mjs`（由 `tools/_run_tirll.mjs` 推广） | 对同一输入自动跑双轨并 diff 运行输出；接入 gate（warn 级） |
| **S0** | 骨架：`fn main() -> i32 { return 0; }` 横贯全层；**先立 `TirOp` / `StorageType` / `TirOperand` 三个结构化类型（§5.3/§5.6）**；`Node` 类型槽落地 | 最小程序在双轨下输出一致；`TirInst` 全部字段为枚举/结构体、无 string 语义载体 |
| **S1** | 标量 + 控制流：i32/i64/f64/bool、算术比较、if/while/for、局部变量、调用、返回 | 对应用例对拍全绿 |
| **S2** | 聚合：struct/enum/union/variant、字段访问、数组、切片、字符串 | 同上；**此片后 `tir_to_ll.tc` 须被结构化翻译器取代（直接消费 `TirModule` 字段、不解析文本）或下线** |
| **S3** | 高级：闭包、泛型单态化、match、defer、T? | 同上 |
| **S4** | std 库、模块系统、comptime / CTFE | 同上 |
| **S5** | 新轨编译 `tc.tc` 且输出与旧轨逐字一致 | **切换**：`emit-ll` 改消费 TIR，删 `ll_etd` / `ll_td` / `expr_type_desc` / `desc_to_c` 的重复实现 |

> **S5 是收益唯一兑现点**——前面所有切片都是成本，只有删掉重复实现才有回报。

---

## 5. 技术契约（继承 v1/v2，仍然有效）

### 5.1 命名空间与 ST 记号

`%` = 类型（TT 引用）、`$` = 值 slot、`@` = 符号（函数/全局）。

ST 记号：`i8/i16/i32/i64/u8/…/f32/f64/ptr<ST>/ptr<ST,as=N>/arr<ST x N>/vec<ST x N>/fn<(ST,..)->ST>/%Name/void`。

`bool` 存储 = `i8`，比较结果 = `i1`。

### 5.2 TD → ST 映射表（`tir.st_of_td`，对齐 `ll_td`）

| TD.cat | ST | 备注 |
|---|---|---|
| scalar (name) | `i8/u8/…/f32/f64` | 按 `t.name` 带符号性（`i32` vs `u32`） |
| string/bytes | `%TStr` | 预置 TT `%TStr = struct { f0: ptr<i8>, f1: i64 }` |
| slice | `%TSlice` | `{ptr<void>, i64, i64, i64}` |
| pointer (host) | `ptr<ST>` | ST = `st_of_td(elem)` |
| pointer (device, as>0) | `i64` | 沿用现状不透明句柄 |
| array | `arr<ST x N>` | |
| vector | `vec<ST x N>` | |
| map | `ptr<void>` | |
| optional | `ptr<ST>` | 严格 `opt.boxed` |
| enum/flag | 底层标量 ST | 名进 TT debug |
| struct/variant/union | `%Name` | TT 条目含字段 |
| sym | `u16` / `u32` | |
| func | `fn<...>` | |
| void | `void` | |
| named (alias) | 解算到底层 | 别名在 TIR 不存在 |

### 5.3 TIR 内存结构 —— 硬性验收判据（结构化，零字符串语义）

TIR 在内存中以**结构化类型**承载，所有层间接口（HIR↔TIR↔后端↔快照）一律是结构体或枚举，**禁止用 string 承载任何语义信息**（见 §5.6 硬规则）。

**`TirOp`（枚举，指令操作码——非空 string）：**

`Slot | Load | Store | AddrOf | Gep | Extract | Insert | Const | ConstPtrNull | ConstStr | ConstZero | Add | Sub | Mul | UDiv | SDiv | URem | SRem | FAdd | FSub | FMul | FDiv | And | Or | Xor | Shl | Lshr | Ashr | Neg | FNeg | Not | Cmp( Eq | Ne | Slt | Sle | Sgt | Sge | Ult | Ule | Ugt | Uge | Foeq | Fone | Folt | Fole | Foge ) | SExt | ZExt | Trunc | FPToSI | FPToUI | SIToFP | UIToFP | FPTrunc | FPExt | Bitcast | IntToPtr | PtrToInt | StructNew | ArrayNew | VecNew | ClosureNew | Call | CallInd | Block | Br | BrCond | Switch | Ret | RetVoid | Phi | Comment`

（完整操作码表集中在 `tir-design.md §6`；**新增一条指令 = 给 `TirOp` 加一个枚举变体 + 在发射器与两个后端各加一个 `match TirOp` 分支**，无文本协议可踩。）

**`StorageType`（结构体，存储类型格——非空 string）：**

```
StorageType {
  kind: enum {              // StKind
    Scalar,                 // sign: bool, width: i8 (8/16/32/64), is_float: bool, is_bool: bool
    Ptr,                    // pointee: StorageType, aspace: i16
    Arr,                    // elem: StorageType, len: i64
    Vec,                    // elem: StorageType, lanes: i64
    Fn,                     // params: []StorageType, ret: StorageType
    Named,                  // ty_idx: i64            // 指向 module.types
    Void,
  }
}
```

**`TirOperand`（结构体，操作数——非空 string token）：**

```
TirOperand {
  kind: enum {              // OperandKind
    Slot,                   // idx: i64    // 函数帧 slot 索引
    Global,                 // idx: i64    // module.globals / syms 索引
    Imm,                    // st: StorageType, bits: i64 / fbits: u64
    Null,                   // st: StorageType（ptr<ST> 空）
    StrRef,                 // str_idx: i64
    TyRef,                  // ty_idx: i64
  }
}
```

**`TirInst`（指令，无 text 字段）：**

`TirInst { op: TirOp; dst: TirOperand; args: []TirOperand; st: StorageType; line: u64 }`

—— `op` 是枚举、`dst/args` 是结构化操作数、`st` 是结构化存储类型；`line` 仅为诊断锚点（u64）。

**其余结构（结构体）：** `TirFunc{name, params:[]StorageType, ret_st:StorageType, locals:[]TirOperand, body:[]TirInst, is_extern, is_kernel}`、`TirModule{mod, source, types:[]TirType, strings:[]string, globals:[]TirGlobal, funcs:[]TirFunc}`、`TirType{name, st:StorageType, fields:[]TirField}`。

**验收判据（缺一不可）**：

1. `TirInst` 及其任何字段**不存在 `string` 类型的语义载体**（`op/dst/args/st` 全部为枚举或结构体）。字符串只可能出现在两处 leaf 数据：`TirModule.strings`（用户字面量）与 `TirType.name`（调试名）——且这两处**不进任何类型/操作数推断**。
2. 禁止 `tir_to_ll(tir_to_text())` 形式的文本 round-trip；模块间直接共享 `TirModule` 内存结构。
3. 禁止「按位置推断类型」的逻辑（`toks[n]`、`ll_get_st` 兜底、`split`/`tokenize` 文本行）。类型一律来自 `inst.st`（结构化）；操作数身份来自 `inst.dst/args.kind`（枚举）。
4. **禁止任何层级用 string 在上下层之间传递语义**：HIR→TIR 用 TD 索引 / `Node` 类型槽；TIR→后端用 `TirInst` 结构化字段；后端只读字段，不解析文本。
5. 文本序列化 `to_text()` 仅供**调试与快照**，禁止作为模块间接口；`.tir` 文本由 `TirModule` **单向派生**，不可被解析回喂给任何层。

> v1/v2 把 `TIRInst` 写成 `{text: string}` 整行文本，是 9/6–9/8 大量 bug（含本工程已踩的 **TD-vs-TI 越界 panic**）的**单一根因**（附录 A-1）。v3 把"结构化"从建议升级为**硬规则**：`op/dst/args/st` 必须是枚举/结构体，string 仅作 leaf 数据。**S0 必须先立 `TirOp` / `StorageType` / `TirOperand` 三个类型，再写任何发射逻辑**——现有 text round-trip 实现（`src/tir.tc` 的 `tir_line(sb_cat*)` + `src/tir_to_ll.tc` 的 `split→tokenize`）自本裁定起视为**非合规，须按本 § 重构后方可计入切片进度**。

### 5.4 准绳定义（先于一切判据）

**「通过」= 链接 + 运行 + 输出比对 `.expected.txt` 一致。** 以下**均不算通过**：

- `clang -c` 编译成功（只证明语法合法）
- `.ll` 生成成功
- md5 稳定（只证明确定性）

禁止用代理指标（编译通过数）替代真指标（端到端通过数）；任何阶段汇报必须注明准绳。

### 5.5 降级构造 → TIR 指令对照（S1–S3 实现参考）

| 构造 | TIR 指令 | 来源节点 kind |
|---|---|---|
| 函数签名 | `func @name(ST $p, …) : ST` | `FuncDecl` |
| 局部变量 | `slot ST $name` + `store` | `var_decl` / `let` |
| 常量 | `const ST $d imm` / `const.str` / `const.ptr.null` | `int`/`float`/`string`/`bool`/`null`/`opt_none` |
| 标识符 | `load` | `ident` |
| 二元 / 一元 | `add/sub/…/` `neg/not` | `binary` / `unary` |
| 调用 | `call ST $d @fname ($a…)` | `call` |
| 取址 / 解引用 | `addr_of` / `load` / `store` | `amp` / `deref` |
| 字段读 / 写 | `addr_of`→`gep`→`load` / `gep`→`store` | `member` / `assignment` |
| struct 字面 | `struct_new %Name $d ($f0 $f1 …)` | `struct_lit` |
| 控制流 | `block` / `br` / `br_cond` / `ret` | `if`/`for`/`while`/`return` |
| 不支持 | `comment "…"` 兜底 | 其余 |

> **兜底限制**：`comment` 兜底只保证**不崩溃**，**不保证不错编**——文本协议 + 兜底会静默产出错误语义（附录 A-3）。结构化的 `TirInst`（§5.3）落地后，`comment` 兜底更应被视为临时占位、不得当作「安全」依据。

---

### 5.6 层间接口硬规则：禁止用 string 传递语义（2026-09-08 裁定）

> **本裁定取代一切「过渡期可用文本」的宽限。** 此前 v3 §4 / §5.3 允许 `tir_to_ll.tc` 作为"文本过渡原型"，自本裁定起该宽限撤销——**编译管线任意两层之间传递的语义信息必须是结构体或枚举实例**。

**原则**：`string` 只能承载两类 leaf 数据：(a) 用户字面量（源码字符串常量，落 `TirModule.strings`）；(b) 调试名（类型/符号名，仅供人读，不进任何推断）。除此之外，任何"把语义编码进 string 再解析回来"的模式一律禁止。

**逐层要求**：

| 边界 | 禁止（旧 / 过渡做法） | 必须（结构化） |
|---|---|---|
| HIR 类型槽 → TIR | `Node` 不带类型、发射期用 `expr_type_desc` 把类型名当 string 推回 | `Node` 带 TD 索引（`i64`）；`codegen_tir` 直接读 TD 索引映射为 `StorageType` |
| TIR 指令构造 | `tir_line(sb_cat*("store ", st, " ", $v, " ", @g))` 拼文本行 | 直接构造 `TirInst{op: Store, dst: Global{idx}, args:[Slot{idx}], st: <StorageType>}` |
| TIR → 后端翻译 | `lines[k].split(" ")` → `tokenize` → 按位置约定 `toks[2]` 当 dst、`ll_get_st` 兜底 | 遍历 `func.body: []TirInst`，按 `inst.op`（`match TirOp`）分支，读 `inst.dst/args/inst.st` 字段直译 |
| 快照 / 缓存 | 用 `.tir` / `.c` / `.ll` 文本作为模块间接口 | 文本仅为 leaf 输出 / 调试；结构化 `TirModule` 才是唯一接口；`.tirb` 二进制是 `TirModule` 的字节化，非独立语义源 |

**与 §12 的边界**：文本 `.tir` 仍可作为快照 / 人读规范（§12.1），但它是 `TirModule` 的**单向派生**，不得被解析回喂给任何编译层——这与本硬规则不冲突（§5.3 判据 5）。

**后果**：违反本条的提交**视为未完成、须回滚**（见 §6 纪律第 7 条）。本工程已实证——文本 round-trip 是 **TD-vs-TI 越界 panic**、`g_ll_*` 影子类型表错编、`46 个失败` 的源头（附录 A-1）；结构化后这类 bug 从根上不可能发生。

---

## 6. 纪律（违反即回滚）

1. **禁止重写** `lex.tc` / `parse.tc` / 语义规则——只加类型槽，不改判定逻辑。
2. **禁止无对拍推进**：任何切片未接入 S-1 对拍，即视为未完成。
3. **禁止新增平行翻译器**：后端只能改输入消费 `TirModule`，不得在旁新增第三条路。
4. **禁止文本解析式翻译器**：现有 `tir_to_ll.tc`（`split→tokenize` 文本行）为非合规，须按 §5.3 重构为**结构化翻译器**（直接遍历 `TirInst`、按 `TirOp` 分支、读 `inst.st`/`inst.dst/args` 字段），或下线。
5. **先修崩溃、后修语义**：崩溃可定位，静默错编不可定位。
6. **改前端后必重录基线 + 复跑 gate**（IR 漂移铁律，沿用 working-memory）。
7. **禁止 string 层间传递语义**（2026-09-08 裁定）：任意两层接口不得用 string 承载语义；`TirInst.op/dst/args/st` 必须是枚举/结构体（§5.3、§5.6）。未重构的文本 round-trip 实现不计入切片进度，违反即回滚。

---

## 7. 日落与止损

| 线 | 期限 | 触发动作 |
|---|---|---|
| **止损** | 2026-09-12 前 S-1（对拍）+ S0（类型槽）未完成 | 停止一切功能推进，只做这两项 |
| **日落** | 2026-09-30 前未达 S5 切换判据 | 停止迁移，转回 `codegen_ll` 单点维护 |

没有截止日的重构，等于不会发生的重构。

---

## 8. 执行进度与剩余阻塞（2026-09-13 更新）

> 本节记录 v3 路线实际落地状态与 S5 收口的唯一剩余阻塞，作为「路径规划」的当前结论。

### 8.1 切片完成状态

| 切片 | 状态 | 证据 |
|---|---|---|
| S-1 | ✅ 已落地 | `tools/_diffpipe.mjs` 对拍框架 + gate warn 级接入 |
| S0 | ✅ 已落地 | `Node` 类型槽 + TIR 结构化类型（`TIR_OP_*` i64 判别码，无文本 round-trip，满足 §5.3 判据 1–3） |
| S1–S4 | ✅（经 emit-tir-ll 后端） | emit-tir-ll 后端对 69 个 example 双轨全绿 |
| S5-切换 | ⚠️ 代码完成 / 判据未验 | `src/tc.tc` 默认 `backend="tir"`，`--backend ll` 保留回退；arena 改 16GB 预留+按需提交（commit `1d578f3`）。**切换判据（新轨编 `tc.tc` 且输出与旧轨逐字一致）尚未在工具链机器跑 `gate L2` 验证**（沙箱无 clang/VS/WinSDK，无法链接） |
| S5-删除 | ⛔ 硬阻塞 | 见 §8.2 |
| **M0** | ✅ 已落地 | `src/mir.tc` MIR 类型 + `tir_to_mir_lower` + `--backend mir-wasm`/`mir-riscv` 接线（§9/§10） |
| **M1** | ⚠️ 首切片落地 / 端到端未验 | `src/codegen_wasm.tc`(MIR→WAT) + `src/codegen_riscv.tc`(MIR→rv64)（§10.1）；沙箱无 wasm/riscv 工具链，待工具链机器对拍 |
| **M-opt** | ✅ 首切片落地 / 端到端未验 | `src/mir_opt.tc` 中端 pass（常量折叠+代数化简+DIE+不可达块消除）；`--opt/-O` 默认关闭保护自举不动点；沙箱无目标工具链，待工具链机器对拍（§11） |

### 8.2 S5-删除的硬阻塞：自举 arena 鸡生蛋

`ll_td` / `ll_etd` / `expr_type_desc` / `desc_to_c` **全部为活代码**（caller 实测：
`ll_td` / `ll_etd` 在 `codegen_ll.tc` 内被调用上百处；
`expr_type_desc` 在 `codegen_c.tc` 内数十处 + `codegen_ll.tc:755/833/835` + `tir.tc:2420`；
`desc_to_c` 在 `codegen_c.tc` 内数十处）。它们不是死代码，是旧双后端（C/LLVM）的类型推导主干。

删除这 4 个函数 ≡ 删除 `codegen_ll` / `codegen_c` ≡ 删除 `--backend ll`。但**自举首建（stage0 = 当前 512MB arena 的旧 `tc.exe`）必须走 `--backend ll` 才能编译 `src/tc.tc`**：tir 降低完整 `tc.tc` 需 >512MB（旧 arena 报 `arena: out of memory`）。若删 ll，stage0 无可用后端编 `tc.tc` → 自举断链。

**解锁路径（须工具链机器，严格按序）**：
1. `node tools/build_runtime.mjs` —— 用新 16GB 预留 arena 的 `t_runtime.c` 重建 runtime lib；
2. `./out/dbg/tc.exe build --backend ll src/tc.tc -o out/dbg/tc.exe` —— **首建显式走 ll**（旧 512MB arena 够用），产出带 16GB arena 的新 `tc.exe`（默认 tir）；
3. `node tools/gate.mjs L2` —— 此后默认 tir 可自举 `tc.tc`，验证新轨输出与旧轨逐字一致；
4. gate 全绿后，再删 `codegen_ll` / `codegen_c` + 上述 4 个重复类型推导函数 —— 此时 stage0 已是 16GB arena，首建可走 tir，删 ll 不再断链，S5 收益（单一类型真相源）兑现。

### 8.3 日落研判（2026-09-13）

- §7 的 09-30 日落线仍有效。S5-切换代码已完成，仅差步骤 3 的 gate 验证。
- 若工具链机器 `gate L2` 通过 → S5 切换判据达成，剩余仅 S5-删除（受 §8.2 约束，待 stage0 升级 16GB arena 后做）。
- 若 `gate L2` 因 tir 输出与 C 后端不符而失败 → 一行回退 `src/tc.tc:397` 改 `backend="ll"`，转回 `codegen_ll` 单点维护（§7 日落条款）。
- **M 轨验证路径（独立于 S5）**：M0/M1 代码已落地，端到端须工具链机器执行——`wat2wasm out/dbg/<m>.wat` 验证 WASM 语法、或 `riscv64-linux-gnu-gcc -c out/dbg/<m>.s` 验证 RISC-V 汇编；随后以双轨对拍（§10.4）比对 `mir-wasm`/`mir-riscv` 与 `tir` 运行输出。沙箱无 clang/wasm/riscv 工具链，无法在此验证（与设计 §1.3 反转同期已知缺口）。

---

## 9. MIR 机器中间层设计（§1.3 裁定落地）

> MIR 是「一套中间层、多个薄后端」的分水岭。本节约等于 `hir-design.md` / `tir-design.md` 对 MIR 的补位——它此前在设计中是空位（附录 A 末段已指出 HIR/MIR/TMI 三层零文件）。

### 9.1 设计原则

1. **复用 TIR 语义域，不重新发明**：MIR 的指令操作码直接复用 `TIR_OP_*`，存储类型复用 `ST_*`，操作数复用 `TirOperand`（`$slot` / `@global` / 立即数 + `st`）。MIR 不引入第二套 opcode/ST——避免 v1/v2「平行翻译器越加越多」的覆辙。

2. **MIR = TIR 的「显式 CFG + 机器类型」形态**：
   - TIR 是**线性**指令序列，块边界由 `TIR_OP_BLOCK`（dst=标签）与终止指令（`br`/`br_cond`/`ret`/`ret_void`）隐式标记；
   - MIR 把线性序列按这些边界**重分组为 `[]MIRBlock`**，每个块含一组线性指令 + 一个终止指令。语义零改动（`tir_to_mir_lower` 是纯结构重排）。
   - 机器类型：MIR 强制每指令带 `st`（TIR 已带），且只表达机器可直译的 op（无高层构造）。

3. **虚拟 slot 模型（不绑物理寄存器）**：MIR 操作数沿用 TIR 的 `$slot`（帧槽），**不引入物理寄存器分配**。各后端把 `$slot` 映射到自身存储：
   - WASM → `local`（按 `mir_st_wasm` 选 i32/i64/f32/f64）；
   - RISC-V → 栈帧 8 字节槽（`lw`/`ld`/`sw`/`sd`，调用参数经 `a0..a7`）；
   - C → 局部变量（`int32_t`/`int64_t`/…）。
   寄存器分配（线性扫描 / 图着色）作为可选 pass 后续插，不阻塞首切片。

4. **零 string 语义（沿用 §5.6）**：MIR 的 `MIRInst`/`MIRBlock`/`MIRFunc` 全是结构体；`mir_to_text()` 仅供调试与快照，单向派生，禁止回喂。

### 9.2 MIR 内存结构（`src/mir.tc`）

```
MIRInst  { op: i64; st: i64; dst: TirOperand; args: []TirOperand; line: u64; cmt: string; is_comment: bool }
MIRBlock { name: string; insts: []MIRInst }            // 基本块；以终止指令结束
MIRFunc  { name; params: []string; ret_st: string; blocks: []MIRBlock; is_extern; is_main }
MIRGlobal{ name; td; init; is_link }
MIRModule{ mod; source; types: []TIRType; strings: []string; globals: []MIRGlobal; funcs: []MIRFunc }
```

ST → 目标存储类映射帮手（在 `mir.tc` 内，`mir_st_wasm` / `mir_st_rv` / `mir_st_c` / `mir_st_signed`）：
- WASM 只有 i32/i64/f32/f64；窄整数与指针一律提升到 i32（WASM32 地址）。
- RISC-V（rv64）：i64/u64/ptr → x 寄存器（64 位），i32/u32/i8/i16 → 32 位（`addw` 等零/符号扩展），f32/f64 → f 寄存器。
- C：直接映射 `<stdint.h>`（`int32_t`/`int64_t`/`void*`/…）。

### 9.3 TIR → MIR 降级（`tir_to_mir_lower`）

纯结构重排：遍历 `TIRFunc.body`，遇 `TIR_OP_BLOCK` 起新块（块名=其 `dst.name`），遇终止指令结束当前块，普通指令 append 进当前块。无类型推导、无重写。复杂度 O(指令数)。

### 9.4 验收判据（对标 §5.3）

- MIR 不引入任何 TIR 之外的 opcode/ST 语义；新架构若需新机器 op，先在 TIR 层以 `TIR_OP_*` 表达，MIR 直接继承。
- `tir_to_mir_lower` 必须保持「逐指令语义等价」：同一 `tc.tc` 经 `tir→mir→wasm` 与 `tir→llvm` 运行输出须可端到端对拍（见 §10 门禁）。

## 10. MIR 后端计划（WASM / RISC-V / C）

> 后端铁律（§6 纪律第 3 条延伸）：**后端只能消费 MIR，是薄发射器，不得在 MIR 之外新增平行翻译器**。MIR 是单一类型/指令真相源。

### 10.1 已落地（M0/M1，2026-09-13 首切片）

| 后端 | 命令 | 载体 | 覆盖 | 状态 |
|---|---|---|---|---|
| **MIR→RISC-V** | `--backend mir-riscv` | `src/codegen_riscv.tc` | S1 标量（i32/i64/f64/bool、算术/比较/位/移位、load/store、call、br/br_cond）；CFG 直接映射 `beq/bne/j/ret`，虚拟 slot 溢出到栈帧 | **首切片落地**（沙箱无 riscv 工具链，待 `riscv64-linux-gnu-gcc -c` 验证） |
| **MIR→WASM** | `--backend mir-wasm` | `src/codegen_wasm.tc` | S1 标量；对**可归约 CFG** 用支配树嵌套 `block`/`loop`+`br` 重建结构化控制流 | **首切片落地**（沙箱无 `wat2wasm`，待 `wat2wasm` 验证） |

> MIR→WASM 的结构化控制流重建只对**可归约 CFG** 正确（S1 的 if/while/for 天然可归约）。`src/codegen_wasm.tc` 用迭代数据流求支配树 + Cooper-Harvey-Kennedy 求 `idom`，按支配树前序 DFS 发射，自然后继（支配后代）落入、其余目标 `br`。不可归约 CFG（如 computed goto）需后续补 `br_table`/栈式兜底。

### 10.2 待做（M2+ 切片）

| 后端 | 载体 | 说明 |
|---|---|---|
| **MIR→C（便携后端）** | `codegen_c` 改造为消费 MIR | 取代 LLVM 的本地编译路径：MIR→C 后经宿主 `cc` 编译。覆盖度随 S2（struct/union/数组/字符串/全局）补齐 |
| **MIR→LLVM（可选）** | `codegen_ll` 改消费 MIR | 保留为「需要 LLVM 优化/目标」的可选后端；S5 删 `codegen_ll` 改判为「MIR→LLVM 可选」，不再强制 |
| **Global / 内存模型** | `codegen_wasm`/`codegen_riscv` 的 `.data`/内存段 | S1 标量切片暂以 `comment` 兜底全局/字符串（§5.5）；S2 起补齐 MIR 全局 → WASM `memory`/RISC-V `.data` |
| **调度 / 寄存器分配** | 各后端可选 pass | 线性扫描把虚拟 slot 分配到物理寄存器，减少栈溢出（正确性不依赖，先正确后优化） |

### 10.3 切片计划（M 轨，独立于 S 轨）

| 切片 | 内容 | 完成判据 |
|---|---|---|
| **M0** | MIR 类型 + `tir_to_mir_lower` + `--backend mir-*` 接线 | `mir_to_text` 与 TIR 逐指令对应；`tc emit-mir` 类路径产出 `.wat`/`.s` |
| **M1** | MIR→RISC-V + MIR→WASM（S1 标量子集） | 对 S1 example 子集，wasm/riscv 与 LLVM 后端运行输出对拍一致 |
| **M2** | MIR→C 便携后端 + S2 聚合（struct/union/数组/字符串/全局） | 双轨对拍全绿；LLVM 转为可选 |
| **M3** | 调度/寄存器分配 pass + 不可归约 CFG 兜底 | 性能与覆盖度达标 |

### 10.4 门禁接入

M 轨沿用 S 轨的双轨对拍（§3）：同一 `.tc` 走 `tir→mir→wasm`（`--backend mir-wasm`）与 `tir→llvm`（`--backend tir`），比对运行输出。首切片（M1）先以 warn 级接入 `gate.mjs`（对齐 S-1 纪律），全绿后转 hard。

> **沙箱限制**：本沙箱无 `clang`/`VS2022`/`wat2wasm`/`riscv64` 工具链，M1 的端到端对拍须工具链机器执行（见 §8.3 验证路径）。代码改动（src/mir.tc / src/codegen_wasm.tc / src/codegen_riscv.tc / tc.tc 接线）已落地，仅差链接验证。

## 11. MIR 优化层（中端 pass，2026-09-13 首切片）

> 优化层 = 一组作用于 `MIRModule` 的结构化 pass，**不另造 IR**（MIR 已是显式 CFG + 机器类型，天然是中端优化载体）。所有 pass 均为「语义保持的就地改写」，对后端完全透明。

### 11.1 首切片（level≥1，无条件安全）

| Pass | 动作 | 示例 |
|---|---|---|
| 常量折叠 | `const op const → const`（整数算术 + 有符号比较） | `3*4 → 12`；`a==a → 1`（SLT 类） |
| 代数化简 | 恒等式就地替换为复制/常量 | `x+0→x`、`x*1→x`、`x-x→0`、`a^a→0`、`a&a→a` |
| 常量分支化简 | `br_cond <const>` → 无条件 `br` | `if (1) {A} else {B}` → 直坠 A |
| 死指令删除 DIE | 结果无人引用的纯值指令删除 | 中间量不再使用即删 |
| 不可达块消除 | 入口 BFS 删除不可达块（含死分支） | `if(1)` 后的 B 块移除 |

实现：`src/mir_opt.tc`（全局替换表 + CONST 定义表 + 使用集，定点迭代至不动点）。MIR 复用 `TIR_OP_*`/`TirOperand`/`ST_*`，**无第二套操作码**。

### 11.2 触发与范围

- 开关：`tc --opt`（或 `-O`）。**默认关闭**，保护自举不动点（`tc.tc` 自编译不经优化 → g2/g3/g4 不变）。
- 范围：仅 `--backend mir-wasm`/`mir-riscv` 消费 MIR，故优化仅在这两个后端 + `--opt` 时生效；LLVM/C 路径经各自下游优化器（clang -O2 / gcc），不在此层（避免与 S5-删除重复）。

### 11.3 明确不做（留待 M2+）

- 中端**不参与**类型感知优化（MIR 已类型擦除为 ST）；需要类型信息的优化留待 HIR/TIR 层（未来可选）。
- 无 SSA 构造、无循环优化、无寄存器分配（归 M3）。本切片只对**局部可静态判定**的等价变换。
- 无符号除/余、浮点运算、移位不折叠（规避 i64 符号歧义，正确性优先）。
- 复制传播以「恒等式就地替换 + 定点解析」实现（MIR 无独立 MOV 操作码，拷贝在 TIR 构造期已消解）。

### 11.4 门禁接入

随 M 轨双轨对拍（§10.4）：开 `--opt` 后 `mir-wasm`/`mir-riscv` 输出应与关闭 `--opt` **语义等价**（指令数更少）。工具链机器验证：对 S1 标量子集开/关 `--opt` 比对运行输出；再 `wat2wasm`/`riscv64-gcc` 编译确认合法。

## 附录 A：v1/v2 实现偏离复盘（v3 立论依据）

规模参照：项目 7/29 起 148 提交，TIR 相关 **25 提交全部集中在 9/5–9/8 共 4 天**。问题不是「投入不足」，而是「高密度投入但收敛慢」。

| # | 契约 | 实际落地 | 后果 |
|---|---|---|---|
| 1 | `TIRInst{op,dst,args,st}` 结构化 | `{text: string}` 整行文本 | 无 schema，语义靠位置约定；`g_ll_*` 影子数组反推类型。**46 个失败的主要产地** | → **v3 §5.3/§5.6 已升级为硬规则**：`op/dst/args/st` 必须是枚举/结构体，文本实现须重构，否则不计切片进度 |
| 2 | 快照门禁接 gate | `gate.mjs` 零 tir | 零回归保护；前端每次改动 TIR 静默退化 |
| 3 | 验证 = 端到端 | 实际以 `clang -c` 为准 | 9/6 报 88/0/0 虚假完成，9/7 真 harness 后 23/69。**最大时间黑洞** |
| 4 | Stage 2/3「老后端消费 TIR」 | 新增平行翻译器 `tir_to_ll.tc` | lowering 由 2 份变 3 份，与收敛目标相反 |
| 5 | 「加性层」 | 加性但无切换点 | 长成第三条并行后端（273KB > `codegen_ll` 230KB，完成度 1/3） |

**判定**：不是「TIR 不该做」（双后端重复是实证痛点，Bug1/Bug2 可证），而是**契约对、执行偏离 + 契约缺执行保障**。v3 用双轨对拍（§3）+ 硬性验收判据（§5.3）+ 纪律（§6）补上执行保障。

**附带发现**：设计管线写作 `sema → MIR(类型化) → TIR`，但 `src/` 中 HIR / MIR / TMI **三层零文件**（`docs/compiler/` 23 篇 4067 行多为未落地草案）——实际从 AST 直接降级，即「类型当场擦掉→翻译器再猜回」。此缺口由 v3 §2 的类型槽补上；**应在 `tir-design.md` 中同步标注**。

---

## 附录 B：规模与节奏

| 项 | 规模 | v3 动作 |
|---|---|---|
| `sema.tc` | 551 KB | 加类型槽，不重写 |
| `codegen_ll.tc` | 230 KB | 改输入（消费 TIR） |
| `codegen_c.tc` | 195 KB | 改输入 |
| `tir.tc` + `tir_to_ll.tc` | 273 KB | 按 §5.3 重构；S2 后吸收/下线 |

按每周 2–3 个切片，S-1 → S5 约 **3–4 周**。

对比：继续在现有 TIR 上补构造，边际成本不下降（每新增一构造都要重踩一遍协议坑），且无门禁防回退——**剩余 46 个不会比已完成的 23 个更快**。
