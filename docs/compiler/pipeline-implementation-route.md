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

### 1.3 先建两层，不建 MIR

当前没有中端优化需求，MIR 是空转——它由「需要优化」倒逼，不由「需要分层」倒逼。先用 **HIR → TIR → 后端** 两层跑通；等真要写 const-prop / DCE / inline 时再插 MIR，届时其形状由具体 pass 的需求决定。少一层，少一堆猜错。

### 1.4 改造，不是重写

保留 `lex.tc` / `parse.tc` / `sema.tc` 的语义规则与已修 bug 积累。核心动作只有两个：

1. **给 AST 加类型槽**（`Node` 增加类型字段，sema 填入）→ 即 HIR
2. **后端改消费新 IR**（改 `codegen_ll` / `codegen_c` 的**输入**）→ 消除 `ll_etd` / `expr_type_desc`

---

## 2. 目标架构

```
lex → parse → AST → sema ──► HIR（类型化 AST）──► TIR（类型擦除·线性）──► { C | LLVM }
                      │            ↑ 类型槽由 sema 一次性填入        ↑ 降级只发生一次
                      └─ 语义规则复用，不重写
```

| 层 | 职责 | 载体 | 状态 |
|---|---|---|---|
| AST | 语法结构（无类型） | `base.Node` | 现有，保留 |
| **HIR** | AST + 类型槽；sema 一次性把 TD 写入节点 | `Node` 新增类型字段（或并行类型池 + 索引） | **新增（S0）** |
| **TIR** | 类型擦除、线性、编译单元级；每指令自带 `StorageType` | `src/tir.tc` | 现有，**须按 §5.3/§5.6 重构为结构化（零 string 语义载体）** |
| 后端 | TIR → 目标语法的薄翻译 | `codegen_ll` / `codegen_c` **改消费 TIR** | 现有，**改输入** |
| ~~MIR~~ | CFG + SSA、中端优化 | — | **暂缓**，见 §1.3 |

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
