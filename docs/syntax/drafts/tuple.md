# 元组类型设计草稿（Tuple）

> 状态：激活 `docs/design.md` §2.1（#2 tuple 类型）与 §2.3（#4 match 第 4 类：元组解构匹配）的落点。
> 流程：spec-driven-development Phase 1（SPECIFY）→ Phase 2（PLAN）。本文登记当前**已实现事实** + **待补差距** + 落地计划。
> 风格对齐：`docs/syntax/drafts/bitstring.md`。

## 0. 当前实现事实（2026-09-26 实测）

元组类型**已落地**，实现策略是「**匿名/具名元组 = 带位置字段（`_0`/`_1`/…）的合成具名 struct**」，而非独立的 TI kind：

- `examples/tuple_demo.tc` + `examples/tuple_demo.expected.txt`：双后端验证通过（默认 LLVM 后端输出与 expected 逐字节一致）。
- `examples/tuple_after_local.tc`：回归用例，验证元组字面量出现在「已有局部变量」语句位置不栈溢出（kids 池布局相关，已固化）。
- 位置字段访问 `.0`/`.1`/`.N`、元组作函数参数与返回值、元组类型标注 `.{i64,string}` 均可用。

**未落地（本文目标）**：

1. **KI-002（open）**：struct / 元组**字面量模式**（常量逐字段相等比较，无绑定）在 **C 后端正确，但在 LLVM/TIR 轨恒命中首臂**（见 §8、§14.1）。
2. **元组解构绑定模式**（`.{a,b}` / `Pair{a,b}` 在 `match` 臂或 `let` 绑定中按位置绑定）——`docs/design.md` §2.3 第 4 类「`do_msg({add,A,B}) => A+B`」，当前**未实现**（见 §8、§14.2）。

## 1. 动机与目标

- 数据驱动 / ECS 取向的语言需要**乘积类型**（product type）来表达「固定数量、异构、带位置的元素」——坐标 `(x,y)`、键值对 `(key,val)`、消息载荷 `{op,A,B}`。
- 元组是 `#4 match` 元组解构、`#7 网络通信`（消息标签 + 载荷）、`#6 协程`（yield 多值）的共同类型层脚手架；#2 必须先落地，三者才能展开。
- 不引入独立的运行时表示：元组 = struct，复用既有 struct 存储 / 字段访问 / 双后端发射，**0 新增 TI kind、0 新增运行时类型**——与 `docs/design.md` 极简 runtime 柱一致。

## 2. 核心模型

- **匿名元组类型** `.{T1, T2, ...}`：在解析期依元素类型推导**规范名** `_Tup_<mangled>`，合成一个 `StructDecl`（字段 `_0`/`_1`/…，各存元素类型），同构元组共享同一类型声明。
- **具名位置结构体** `Pair{ T1, T2 }`：等价于「字段名为 `_0`/`_1`/… 的具名 struct」，是元组语法的具名包装（见 `examples/tuple_demo.tc` 第 8 行）。
- **元组字面量** `.{e1, e2, ...}`：struct 字面量，元素按位置存 `_0`/`_1`/…，解析期标记 `ia=1`（位置式）。
- **字段访问** `t.0` / `t._0` / `t.1`：复用既有 struct 字段访问（member 节点），无新机制。
- **值语义**：与 struct 一致（copy on assign；大元组走底层成员拷贝，无引用共享）。
- **类型同一性**：由元素类型序列决定（规范名派生），故 `.{i64,string}` 与另一处 `.{i64,string}` 是同一类型；`.{i64,string}` 与具名 `Pair` 是**不同类型**（参见 `tuple_demo.tc` 注释 5）。

## 3. 与现有设施的关系（调研事实）

| 现有设施 | 文件/事实 | 与 tuple 的关系 |
|---|---|---|
| **具名 struct** | `base.mk_StructDecl` / `codegen_c` struct 发射 / `codegen_ll` struct 发射 | 元组**直接复用** struct 的存储、字段访问、双后端发射；无独立表示 |
| **位置字段 `_N`** | `parse_struct_lit` 中 `mk_FV("_"+i, val)`、`tuple_struct_exists` 扫描 `decl_list` | 元组字段即 `_0`/`_1`/…，与具名 struct 字段机制同源 |
| **类型名派生** | `synth_tuple_type_name`（parse.tc:756）/ `tuple_lit_type_name`（sema.tc:5202）/ `type_node_mangle`（parse.tc:726） | 三处必须永远一致：元素类型 → mangle → `_Tup_xxx`，保证同构共享 |
| **match 字面量模式** | `docs/syntax/drafts/match.md` §2「`Pt{ x: 1, y: 2 }` 按字段逐值相等比较」 | 元组字面量模式复用该路径（**但 LLVM 轨坏，KI-002**） |
| **`@` as-模式 / S3** | `match.md` §6.1.1 S3 | 元组解构绑定可借道 as-模式 `p @ .{a,b}` 预声明绑定槽 |

## 4. 类型系统整合（TI）

**不新增 TI kind**。元组 = 具名 struct（`kind = "Struct"`），`ti_equal` 走既有 struct 相等（声明同一即相等，由规范名保证）。`ti_to_str`/`desc` 打印为 `.{T1,T2}`（在 `desc_to_c`/`td_to_str` 路径加 `Struct` 特判：若名字匹配 `_Tup_` 前缀则渲染为 `.{...}`，否则普通 struct）。

## 5. 语法设计（已落地 + 待补）

```
// 已落地
AnonTupleType   ::= "." "{" Type ("," Type)* "}"          // .{i64, string}
NamedPosStruct  ::= Ident "{" Type ("," Type)* "}"         // Pair{ i64, string }
TupleLit        ::= "." "{" Expr ("," Expr)* "}"           // .{1i64, "hi", true}
FieldAccess     ::= Expr ("." DIGIT+) | ("." "_" DIGIT+)   // t.0 / t._0

// 待补（本文目标）
TupleLitPat     ::= "." "{" Pattern ("," Pattern)* "}"     // .{a, b}  位置绑定（无类型名）
NamedStructPat  ::= Ident "{" Ident ("," Ident)* "}"        // Pair{ a, b } 位置/字段绑定
TupleBind       ::= "var" TupleLitPat "=" Expr              // 直接解构绑定（可选）
```

## 6. 脱糖策略（应用前几轮结论）

- **元组类型 `.{...}`**：解析期合成 `StructDecl`（位置字段），脱糖为 `named` 类型节点 → 复用 struct 全链路（**已落地**）。
- **元组字面量 `.{...}`**：解析期脱糖为 `StructLit`（位置字段 `FV`），复用 struct 字面量发射（**已落地**）。
- **元组字面量模式 `.{c1,c2}`**：`match` 臂按 struct 字面量模式处理——逐字段相等比较（**C 后端已落地；LLVM 轨坏，KI-002**）。
- **元组解构绑定模式 `.{a,b}`/`Pair{a,b}`**：解析期生成为「struct 解构模式」节点，sema 据字段位置预声明绑定、`match` 发射期按字段偏移提取并绑定（**未实现**，见 §8、§14.2）。

对齐 `docs/design.md` §2.9 原则：脱糖只到既有 struct 机制，双后端发射路径**尽量零改动**（仅 KI-002 修复 + 解构绑定提取两处增量）。

## 7. 后端发射

- **C**：`typedef struct { T0 _0; T1 _1; ... } _Tup_xxx;`（struct 发射，已就绪）。
- **LLVM**：`%_Tup_xxx = { T0, T1, ... }`（struct 发射，已就绪）。
- 元组类型本身与 struct 发射**完全同构**，双后端零差异（已验证 `tuple_demo.tc`）。

## 8. 模式匹配（本文核心差距）

### 8.1 字面量模式（常量比较，无绑定）—— KI-002

- **现状**：`match (t) { .{1i64,2i64} => ..., _ => ... }` 在 C 后端按字段逐值相等比较、正确分发；**在 LLVM/TIR 轨恒命中首臂**（实际输出与 C 轨不一致）。
- **根因（match.md §6.3）**：`tir_match_pattern_cond` 对 struct_lit 模式返回空条件串 → dispatch 退化为无条件跳转，未走 `named` 回查分支。与 enum scrutinee 首臂 bug（match.md §6.2 根因 ①）同族。
- **修复方向**：在 `tir_match_pattern_cond` / `tir_to_ll` 的 struct_lit 模式分支，按 struct 字段偏移逐个提取 + 相等比较，生成非空的 `icmp` 条件链（对齐 C 后端 `struct_lit` 比较发射）。

### 8.2 解构绑定模式（`.{a,b}` / `Pair{a,b}`）—— 未实现

- **现状**：`match (t) { .{a,b} => ... }` 解析期即报 `T-PAR-E101`（`.{` 在模式位未被识别为模式）；`Pair{ a, b }` 报「期待 FatArrow，实际读到 {」（conpat 只认 `Name(args)` 不认 `Name{...}`）。
- **设计（#2/#4 第 4 类）**：`do_msg({add,A,B}) => A+B` —— 按位置字段把元组解构成绑定 `A`/`B`。
  - **解析**：`parse_match_alt_atom` / `parse_struct_lit` 在模式位（`pat=true`）识别 `.{...}`（元素为 `Ident` 绑定或嵌套模式）与 `Name{ a, b }`（位置/字段名绑定），生成 `struct_pat` 节点（沿用 `conpat`/`slice_pat` 的「模式节点」范式）。
  - **sema**：`conpat_check` 增加 struct/tuple 分支——校验 scrutinee 类型是该 struct（或同构元组），按字段声明绑定（作用域限臂内），复用 `f_pat`/`a_bind` 既有绑定槽机制（match.md §7.2、S3 as-模式槽机制）。
  - **发射**：`match` 发射期对每个绑定字段，按 struct 字段偏移 `gep` 提取并存入绑定变量（C：取成员地址/值；LLVM：提取 + alloca 绑定）。
- **范围边界**：仅做**位置字段绑定**（`.{a,b}` 与 `Pair{a,b}` 位置式）；具名字段 `Pt{ x: a, y: b }` 的「字段名→绑定」映射留作 #4 扩展（match.md §2 已明示「`Pt{ x: a }` 不绑定 a」为当前语义，解构绑定是增量，须另行裁定字段名语义）。

## 9. 门禁与测试

- **conformance**：
  - `tests/conformance/pass/p_tuple_basic.tc`：元组类型、字面量、字段访问、参数/返回值（`tuple_demo` 的最小闭环）。
  - `tests/conformance/pass/p_tuple_litpat.tc`：字面量模式分发（C + LLVM 双后端，验证 KI-002 修复）。
  - `tests/conformance/pass/p_tuple_destructure.tc`：`.{a,b}` / `Pair{a,b}` 解构绑定（验证 §8.2）。
  - `tests/conformance/fail/f_tuple_arity.tc`：元组字面量元素数与类型不符 → `T-SEM-E...`（码号与 `src/diag_table` 协调）。
  - `tests/conformance/fail/f_tuple_pat_type.tc`：模式类型与 scrutinee 不符 → 类型错误。
- **run_examples**：`examples/tuple_demo.tc`（已有）+ `examples/tuple_match_demo.tc`（新增，覆盖字面量模式 + 解构绑定双场景，双后端 `.expected.txt`）。
- **gate L1**：元组改动须过全量自举不动点 + 双后端对拍（参照 bitstring/P4-P5 流程：`gate` → 同步 `tc.exe` → 重录 IR 基线 → 提交）。

## 10. 诊断码

| 码 | 含义 | 状态 |
|---|---|---|
| `T-TUP-E601` | 元组字面量元素数/类型与上下文元组类型不符 | 待新增（fail 用例） |
| `T-TUP-E602` | 解构模式字段数超出元组元数 | 待新增 |
| `T-TUP-E603` | 解构绑定模式类型与 scrutinee 不匹配 | 待新增 |
| （复用 `T-MAT-E742`） | 元组模式不穷尽（须 `_`/`..` 收尾） | 复用 match 穷尽性 |

（具体码号与 `src/diag_table.gen.h` 协调，避免冲突。）

## 11. ASSUMPTIONS（请纠偏，否则按此推进）

1. 元组 = 合成 struct（位置字段 `_0`/`_1`），**不引入新 TI kind**——与现状一致。
2. 元组**值语义**（copy on assign），与 struct 一致。
3. 类型同一性由元素类型序列决定（规范名派生），同名不同元素 → 不同类型。
4. **解构绑定先做位置式**（`.{a,b}` / `Pair{a,b}`）；`Pt{ x: a }` 字段名→绑定映射留 #4 扩展，本轮回避。
5. KI-002 修复**只动 LLVM/TIR 的 struct_lit 模式发射**，C 后端行为不变（已正确）。

## 12. Open Questions

- 元组字面量模式是否应支持**嵌套**（` .{1i64, .{2i64,3i64}} `）？→ 默认支持（递归 struct_lit 比较/解构）。
- 元组能否 `==` 整体相等比较？→ 当前 struct 不支持 `==`；元组字面量模式是「逐字段比较」特例，非通用 `==` 运算符。通用 `==` 留 #4。
- 解构绑定在 `let`/`var` 直接绑定（`var (a,b) = f()`）是否本轮回？→ 默认**本轮回**（与 `match` 解构共用同一 `struct_pat` 节点与提取发射）；若风险高则降级为仅 `match` 位，直接绑定留增量。

## 13. Success Criteria

- 元组类型、字面量、字段访问、参数/返回值在**双后端**运行一致（`tuple_demo.tc` 已达标）。
- **KI-002 修复**：元组字面量模式在 **C 与 LLVM 双后端**分发正确（新增 `p_tuple_litpat` 验证）。
- **解构绑定**：`.{a,b}` / `Pair{a,b}` 在 `match` 臂（及可选 `let` 绑定）按位置绑定，双后端一致（新增 `p_tuple_destructure` / `tuple_match_demo.tc` 验证）。
- gate L1 全绿（自举不动点 + 双后端对拍 + conformance）。

## 14. 设计决策记录（复盘）

### 14.1 KI-002：struct/元组字面量模式 LLVM 轨恒命中首臂
- **事实**：`match.md` §6.3 记为 open known-issue；复现用例 `tests/known-issues/KI-002_struct_literal_pat.tc`（期望 `0`，C 轨 `0`，LLVM 轨 `1`）。
- **根因**：`tir_match_pattern_cond` 对 `struct_lit` 模式返回空条件串 ⇒ dispatch 退化为无条件跳转，未走 `named` 回查分支（与 §6.2 根因 ① 同族）。
- **处置**：本特性落地时一并修复（§8.1 修复方向），使元组字面量模式双后端一致。**修复须双后端对拍验证**，避免「C 改对、LLVM 仍错」的静默不一致。

### 14.2 解构绑定模式
- **事实**：当前 `match` 模式位不识别 `.{...}` / `Name{...}` 为模式（`T-PAR-E101`），仅支持字面量常量比较（match.md §2：「`Pt{ x: a }` 不绑定 a」）。
- **决策**：本特性补「位置字段解构绑定」（`.{a,b}` / `Pair{a,b}`），实现 `do_msg({add,A,B}) => A+B`（design.md §2.3 第 4 类）。复用 `conpat_check` 的 struct 分支 + `f_pat`/`a_bind` 绑定槽 + `match` 发射的字段提取。
- **影响**：`parse_match_alt_atom` 增加 struct_pat 识别；`conpat_check` 增加 struct/tuple 解构分支；`match` 发射（C/LLVM）增加字段提取绑定。

## 15. 实现计划（Phase 2 PLAN）

> 按依赖序；每步以最小可用闭环验证双后端后再铺开，对齐 bitstring §15.5。

### 15.1 模块改造清单

**M0. 诊断码**（src/diag_table.gen.h + gen_diag 机制）
- 新增 `T-TUP-E601/602/603`（见 §10），与现有码号协调无冲突。

**M1. 解析：元组解构模式**（src/parse.tc）
- `parse_match_alt_atom`：模式位识别 `.{...}` → 若元素为 `Ident`/嵌套模式则生成 `struct_pat`（位置绑定）；否则（字面量常量）走既有 `struct_lit` 模式。
- `parse_struct_lit`：模式位（`pat=true`）识别 `Name{ a, b }` 位置绑定 → `struct_pat`。
- 字面量模式路径保持不变（仅 KI-002 修复其 LLVM 发射）。

**M2. sema：解构模式类型检查与绑定**（src/sema.tc）
- `conpat_check` 增加 `struct_pat` 分支：校验 scrutinee 为该 struct/同构元组；按字段声明绑定（`f_pat`/`a_bind` 槽，作用域限臂内）。
- 字面量模式：`struct_lit` 模式已有类型检查，仅 LLVM 发射修复（M4）。

**M3. tir：模式条件生成**（src/tir.tc）
- `tir_match_pattern_cond`：struct_lit / struct_pat 模式生成**非空**条件链（逐字段 `icmp` + `gep` 提取），修复 KI-002。

**M4. codegen_c：模式发射**（src/codegen_c.tc）
- struct_lit / struct_pat 模式的字段提取 + 相等比较 + 绑定变量赋值（对齐 LLVM 修复，双后端一致）。

**M5. codegen_ll：模式发射**（src/codegen_ll.tc / tir_to_ll.tc）
- struct_lit / struct_pat 模式的 `gep` 提取 + `icmp` 条件链 + 绑定（修复 KI-002 + 解构绑定）。

### 15.2 门禁与测试
- conformance：`p_tuple_basic` / `p_tuple_litpat` / `p_tuple_destructure` + `f_tuple_arity` / `f_tuple_pat_type`。
- run_examples：`tuple_match_demo.tc`（+ `.expected.txt`，双后端）。
- gate L1：全量自举不动点 + 双后端对拍（参照 P4/P5）。

### 15.3 风险
- **R1** 解构绑定与 `conpat_check` 既有 enum/variant 分支交互——须保证 `struct_pat` 走独立分支，不污染既有路径。
- **R2** KI-002 修复须**双后端对拍**：C 已对，LLVM 修后须与 C 输出逐字节一致（新增 `p_tuple_litpat` 固化）。
- **R3** 引入 struct_pat 新节点可能触发全量 gate（~2668s）；改动须一次性到位，避免反复重验不动点。
- **R4** 元组模式穷尽性：元组无有限穷尽集，须 `_`/`..` 收尾，否则 `T-MAT-E742`（复用 match 穷尽性）。

### 15.4 建议实施顺序（多 commit 到 wb）
`M0(诊断码) → M1(解析) → M2(sema) → 验证 check → M3(tir) → M4(C 发射) → M5(LLVM 发射) → 验证双后端 → conformance + example → gate L1 → PR main`。

## 16. 实施状态（进行中，2026-09-26）

- **已落地（双后端验证通过）**：元组类型、字面量、字段访问、参数/返回值（`tuple_demo.tc` / `tuple_after_local.tc`）。
- **待补（本文目标）**：
  - KI-002：struct/元组字面量模式 LLVM 轨恒命中首臂（§8.1 / §14.1）。
  - 解构绑定模式 `.{a,b}` / `Pair{a,b}`（§8.2 / §14.2）。
  - conformance + `tuple_match_demo.tc`（§9）。
