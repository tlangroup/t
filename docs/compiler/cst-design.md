# t 语言 CST / AST 节点规格（Lexer → Parser → CST）

> 状态：设计规格 v0.1（2026-09-04）  
> 关联：`docs/compiler/compiler-pipeline-design.md`、`docs/compiler/hir-design.md`、`docs/compiler/ir-taxonomy.md`、`src/lex.tc`、`src/parse.tc`、`src/base.tc`

## 0. 范围、定位与文档关系

本文是 `docs/compiler/` 分层设计体系里**此前缺失的「前端节点层」规格**——专门描述 `Lexer → Parser` 的产物 **CST（具体语法树）/ AST** 的节点模型、内存布局与到 HIR 的降级契约。

- **覆盖范围**：词法 token 模型、`base.Node` 扁平节点池结构、`parse.tc` 产生的全部节点种类、子节点引用范式（单子索引 vs 子列表头）、溯源与诊断锚点、**CST → HIR 降级契约**。
- **不覆盖**：节点之上的语义（类型检查见 `sema`；类型系统见 TD/TI 文档；HIR 线性化见 `hir-design.md`；文法 EBNF 见顶层 `docs/reference.md` / `docs/spec.md`）。
- **文档分工**：顶层 `reference.md` / `spec.md` 是**文法**（产生式、关键字、优先级）；本文是**节点结构**（内存里树长什么样、字段含义、与 HIR 的边界）。两者互补，不应合并——改文法不必然改节点字段，反之亦然。
- **范式声明**：CST 沿用 `base.nodes` 的**扁平池 + 索引引用**范式（`na/nb/nc/nd` + `la/lb/lc`），与 HIR / sema 共享同一底层存储，不引入第二套节点表示（降低门禁回归风险，见 `ir-taxonomy.md`）。

## 1. Lexer（词法层，`src/lex.tc`）

### 1.1 字符分类
- `is_ident_start(cp)`：XID_Start + 下划线。
- `is_ident_cont(cp)`：XID_Continue + 下划线 + 数字。
- `is_hex_digit` / `is_bin_digit`：字面量扫描用。

### 1.2 关键字表（`kw_reg`）
关键字以 `kw_reg("文法字", "KwXxx")` 注册，token 的 kind 是字符串 `"KwXxx"`。当前全集（来自 `src/lex.tc`）：

| 文法字 | token kind | 文法字 | token kind |
|---|---|---|---|
| `fn` | `KwFunc` | `else` | `KwElse` |
| `struct` | `KwStruct` | `match` | `KwMatch` |
| `enum` | `KwEnum` | `when` | `KwWhen` |
| `flag` | `KwFlag` | `for` | `KwFor` |
| `union` | `KwUnion` | `while` | `KwWhile` |
| `variant` | `KwVariant` | `break` | `KwBreak` |
| `agent` | `KwAgent` | `continue` | `KwContinue` |
| `var` | `KwVar` | `return` | `KwReturn` |
| `const` | `KwConst` | `true`/`false` | `KwTrue`/`KwFalse` |
| `let` | `KwLet` | `null` | `KwNull` |
| `comptime` | `KwComptime` | `map` | `KwMap` |
| `type` | `KwType` | `import` | `KwImport` |
| `if` | `KwIf` | `pub` | `KwPub` |
| `as` | `KwAs` | `in` | `KwIn` |
| `defer` | `KwDefer` | `void` | `KwVoid` |
| `string` | `KwString` | `StringBuilder` | `KwStringBuilder` |
| `auto` | `KwAuto` | `any` | `KwAny` |
| `kernel` | `KwKernel` | | |

> 注：`meta` 现为**保留关键字** `KwMeta`（当前无语义、留作他用，禁止用户用作标识符；见 `meta_design.md`）；编译期统一用 `comptime`。

### 1.3 字面量类别
- `int` / `float` / `string` / `bool` / `atom`（原子）/ `fid`（fid 值）/ `sym`（符号字面量）。
- 字面量 token 携带 lexeme 文本，由 `parse.tc` 转成 `int`/`float`/`string`/`bool`/`atom`/`fidconst`/`sym` 节点。

### 1.4 Token 流模型
- token 流是**扁平数组**；每个 token 记录：`kind`（字符串类别）、`value`（词素文本）、`line`、`col`。
- 访问器（来自 `src/lex.tc`）：`tk_t(idx)`（kind）、`tk_v(idx)`（value）、`tk_line(idx)`、`tk_col(idx)`；`cur_t` / `advance_i` 驱动扫描位置。
- **锚点**：token 的 `line/col` 是诊断定位的最小单元；parser 把 token 锚点拷进节点的 `ln/cl/tv` 字段（见 §2.3），使语义错误能精确指回源码。

## 2. Parser（语法层 → CST，`src/parse.tc` + `src/base.tc`）

### 2.1 存储范式：扁平节点池 + 子节点池
- `nodes[]`：扁平 `Node` 数组，每个 AST 节点是池里一个槽位，用 **i64 索引**互引用（不存指针，arena 友好、可序列化）。
- `kids[]`（`g_children`）：`Child` 池，承载「子节点列表」。节点的 `la/lb/lc` 存的是 **Child 池索引**（列表头），不是节点 id；沿 Child 链遍历得到子节点序列。

> ⚠ **铁律（已踩坑，见 `meta_design.md` Phase C 教训）**：`la/lb/lc` 是**子列表头（Child 池索引）**，不是节点 id。凡是要遍历某节点的子节点，必须沿 Child 链走，绝不能把 `la` 当节点 id 喂给「改写单个节点」的 API——这会误改无关子树。`lc` 同理是链表头，不是最后子节点。

### 2.2 `Node` 字段表（`src/base.tc`）
| 字段 | 类型 | 含义 |
|---|---|---|
| `kind` | string | 节点种类（见 §2.4） |
| `sa`/`sb`/`sc` | string | 字符串载荷（标识符名、字面量文本、`se`=C 导出名等）；`has_sa`/`has_sb` 标记 `sa`/`sb` 语义是否为 null |
| `se` | string | C 互操作导出符号名（clean name；`""`=未导出） |
| `ia`/`ib` | i64 | 整型载荷（radix / bitWidth / offset 等）；`-1`=null |
| `ba`/`bb`/`bc`/`bd`/`be`/`bf` | bool | 布尔载荷：`isConst`/`isExtern`/`isComptime`/`isBitpack`/`模块搜索路径`/`kernel fn` 等 |
| `na`/`nb`/`nc`/`nd` | i64 | **单子节点索引**；`-1`=null（如 `binary` 的左右操作数、`call` 的 callee） |
| `la`/`lb`/`lc` | i64 | **子节点列表头**（Child 池索引）；`-1`=空列表，`-2`=null 列表（如函数体语句序列、结构体字段序列、match 的 arm 序列） |
| `ln`/`cl`/`tv` | u64/string | 锚点 token 的**行 / 列 / 文本**（诊断定位） |

### 2.3 溯源与锚点
- **溯源**：`g_node_mod[]` / `g_node_file[]` 与 `nodes[]` 平行，记录每个节点来自哪个模块别名 / 源文件（多模块编译单元下诊断精确定位；见 `compiler-pipeline-design.md` 模块系统）。
- **锚点**：`ln/cl/tv` 从产生该节点的 token 拷入，贯穿全管线，是 `tc --error-format=json` / SARIF（见 `pipeline-review.md` G-9）的诊断 span 源头。

### 2.4 节点种类分类（grounded in `parse.tc` / `base.tc` 真实 `kind`）

**声明类**（顶层 / 模块级）：
`FuncDecl`、`StructDecl`、`UnionDecl`、`VariantDecl`、`EnumDecl`、`FlagDecl`、`FlagSetDecl`、`TypeAliasDecl`、`GlobalVarDecl`、`GlobalConstDecl`、`ImportDecl`、`ImportItem`、`ImportModDecl`、`ModuleDecl`、`M`（module 内声明）、`P`（param）、`SL`（struct field / 字段声明）、`V`（variant case）、`VC`（variant case 载荷）、`A`（arm / match 分支）、`EN`（enum member）。

**语句类**：
`var_decl`、`assign`、`assignment`、`if`、`while`、`for`、`for_each`、`block`、`return`、`break`、`continue`、`defer`、`expr`（表达式语句）、`comptime_block`、`closure_capture`（闭包捕获声明）。

**表达式类**：
`ident`、`number`、`int`、`float`、`string`、`bool`、`atom`、`fidconst`、`sym`、`binary`、`unary`、`cast`、`paren`、`call`、`index`、`member`（字段/方法访问）、`deref`、`amp`（取址）、`struct_lit`（结构体字面量）、`array`、`array_lit`、`map`、`map_lit`、`slice`、`vector`、`optional`、`opt_none`、`range`、`null`、`pipe_apply`/`pipe_filter`/`pipe_map`（管道）、`tile`（device tile）、`conpat`（匹配模式）、`match`、`when`。

**类型类**：
`named`（具名类型引用）、`scalar`（标量）、`pointer`、`func_type`、`any`、`type`、`optional`（类型构造）。

**元 / 闭包类**：
`comptime`、`lambda`、`closure_make`、`closure_capture`、`closure_capval`、`infer_ret`（推断返回）、`func_type`、`mbuiltin`（编译期内建）、`typeinfo`、`vval`（variant 值构造）、`FV`（func value）。

> 该清单是 `node_new("X")` / `mk_X` 在 `parse.tc` + `base.tc` 中实际出现的种类并集，是 CST 节点种类的**事实来源**。新增种类须同步 `dagcheck`（见 `tools/dagcheck.mjs`）。

### 2.5 构造器
- `base.tc` 提供 `mk_*`（如 `mk_StructDecl`、`mk_FuncDecl`、`mk_VariantDecl`、`mk_VC`）封装字段初始化，parser 调用之生成节点。
- 解析入口：`parse_declaration`（函数/类型声明）、`parse_primary`（表达式前缀）、`parse_type`（类型位置，含 `KwType`→`node_new("type")`）、`parse_global_var`（含 `is_comptime` 写入 `bb`）。

### 2.6 前端脱糖的位置
- `comptime` 前缀提升到最前（`parse_declaration`）→ 可修饰 `var`/`const`/`fn`。
- lambda 在 sema 提升为 `closure_make` / `__env_N`（见 `hir-design.md` / `tir-design.md` 闭包 ABI）；CST 阶段仍是 `lambda` 节点。
- 这些脱糖的**最终落点**在 sema（类型解析后），CST 保留源忠实结构，供 IDE / 富诊断 / 宏展开消费（见 `compiler-pipeline-design.md` §4.2）。

## 3. CST → HIR（AstGen）降级契约

CST 是**源忠实树**；HIR（见 `hir-design.md`）是 **untyped · 线性 · 可序列化** 的 ZIR 槽位。AstGen 的契约：

| CST 信息 | HIR 处理 |
|---|---|
| 树结构（嵌套 expr/stmt） | 降级为线性指令序列（slot 模型；见 `tir-design.md` §2.4 memory-first） |
| 类型注释 / 类型节点 | **丢弃**（HIR 无类型）；类型以「名字引用」暂存（`named "f64"`），sema 之后才解析 |
| 控制流（if/while/for/match） | 显式化为基本块 + `br`/`br_cond`/`switch`（见 `hir-design.md` §3.2） |
| 声明结构（struct/enum/variant/func） | 保留为 HIR 声明节点，字段 / 载荷类型转名字引用（见 `decl-data-design.md` §3） |
| 锚点 `ln/cl/tv` | **保留**贯穿，供诊断 |
| 溯源 `g_node_mod`/`g_node_file` | 转为 HIR 声明的模块归属（见 `compiler-pipeline-design.md` 模块系统） |

- **per-file 缓存锚点**：HIR 是增量编译承重墙（见 `ir-taxonomy.md` §6）——CST 本身**不缓存**（它依赖源文本，缓存意义被 HIR 吸收）。AstGen 是源码 → 可缓存 HIR 的边界。
- **惰性诊断**：未实例化的泛型体内的 CST 错误，在 HIR（pre-sema）阶段不报（见 `hir-design.md` §3.4 / `ir-taxonomy.md`）。

## 4. 与现有代码映射

| 阶段 | 源文件 | 产物 |
|---|---|---|
| Lexer | `src/lex.tc` | token 流（`tk_t`/`tk_v`/`tk_line`/`tk_col`） |
| Parser | `src/parse.tc` | `nodes[]` + `kids[]`（CST） |
| 节点存储 | `src/base.tc` | `struct Node` / `struct Child` / `mk_*` |
| 驱动 | `src/tc.tc` | `lex → parse → run_check(sema) → ...` |

> DAG 约束（`tools/dagcheck.mjs`）：跨模块调用须 `import` 被调方；CST 节点种类是 dagcheck 的校验项之一。

## 5. 开放问题与文档分工

- **CST 是否也序列化**（如 `.tc.ast` 供 IDE 增量）？当前不缓存 CST（HIR 吸收缓存职责）；若未来 IDE 需要源码级增量，可加 CST 序列化，但**不与 HIR 缓存键冲突**（CST 键=源文本，HIR 键=AstGen 输出）。
- **文法 vs 节点**：本文与 `reference.md`/`spec.md` 分工如上（§0）；改 EBNF 后须核对本文 §2.4 节点清单是否需要同步新增种类。
- **CST 诊断精度**：`ln/cl/tv` 是 token 级；宏 / agent 展开后的精确 span 需在 HIR / sema 阶段回溯（见 `compiler-pipeline-design.md` §4.2 富诊断）。
