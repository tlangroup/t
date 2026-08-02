# The t Language Reference

> 版本 v1 (基于 `docs/spec.md` 设计终稿整理)
> 本文档描述 **t** 编程语言的词法与语法形式，采用类似 *The Rust Reference* 的记号约定。
> 文中每个语法产生式给出 **Syntax**、可选 **Where** 约束、以及 **Examples**。
> 凡当前 `tc` 编译器尚未实现、仅属 spec 设计目标的条目，以 `⚠ spec-only` 标注；已实现条目以 `✅ tote` 标注。

> **语法根本源（single source of truth）**：本文档 **`docs/reference.md`** 是 **t** 语法的权威描述，其中各节以 `ebnf` 代码块给出的产生式即文法的机器可读表示。
> 由 `tools/gen_ebnf.mjs` 抽取本文档的 `ebnf` 块生成 [`out/ebnf.json`](./../out/ebnf.json)；`src/totter.tc` 解析 `ebnf.json` 驱动生成 `gen/tc.tc` 的词法关键字表与（后续）递归下降解析器（数据驱动生成管线）。**⚠ totter 自 M38 起已放弃（abandoned），此「数据驱动生成」管线为历史设计：`src/tc.tc` 的 `// >>> GEN:` 区间已冻结、现由手写维护，`out/ebnf.json` 与 `gen/tc.tc` 均为冻结快照，不再重跑 totter 重新生成。**

---

## 1. Notation（记号约定）

语法用类 BNF 的产生式描述。约定如下：

- `ProductionName: Syntax` —— 产生式，左侧为名，右侧为形式。
- `|` 分隔可选项（alternatives），仅列在一行或缩进块内。
- `( ... )` 分组。
- `?` 可选（出现 0 或 1 次）。
- `*` 重复 0 次或多次（贪婪）。
- `+` 重复 1 次或多次。
- `>>>` 表示需要向前看（lookahead）以消歧（如避免 `>>` 被拆成两个 `>`）。
- 字面量用等宽 `"..."` 表示关键字或标点。
- `Ident`、`IntegerLiteral` 等非终结符首字母大写。
- 终止符（token 类别）用小写 `ident`、`int`、`lbrace` 等表示。
- ebnf 块内注释统一为两种形式：`//` 行注释与 `/* ... */` 块注释。状态注记（`⚠ spec-only`、`✅ tote` 等）一律写在上述注释内部，不单独成句。注释文本由 `tools/gen_ebnf.mjs` 在抽取时从产生式中**剥离**（尊重引号，不会误删 `"//"`、`"/*"` 这类字面量），但其中的状态注记会被**结构化抽取**进 `out/ebnf.json` 的 `rules` 段：每条 rule 带 `status` 字段（`"tote"` 已实现 / `"partial"` 部分实现 / `"spec-only"` 仅设计 / `"unspecified"` 未注记），规则级状态取头行注记、缺省继承最近章节标题（`##`/`###`/`####`）的注记；每个 alt 为 `{text, status?, note?}` 对象，行内注释的注记附着到对应 alt 并覆盖规则级。该字段是 rules 驱动 parser 生成的过滤依据（生成器只应消费 `tote`/`partial` 条目）。

**设计铁律（来自 spec §0，所有产生式不得违反）：**

1. **唯一语义**：同一逻辑只有一种写法，无等价语法变体。
2. **完全显式**：无隐式类型转换、无隐式内存分配、无隐式布尔判定、无隐式生命周期。
3. **结构化优先**：元编程基于 AST 自省，禁止字符串拼接式宏。
4. **数据优先**：struct/enum/flag/variant/注解/外部数据表为一等公民。
5. **机器可解析报错**：错误双输出（人类文本 + JSON 诊断）。

---

## 2. Lexical structure（词法结构）

```ebnf
TranslationUnit: (Shebang? Newline?)? (InnerAttribute* ModuleItem)*
```

t 源文件为 UTF-8 文本，按行/列以 **UTF-8 字节计数** 定位（spec §运行时约定）。

### 2.1 Whitespace and comments（空白与注释） ✅ tote

```ebnf
Whitespace: \u{20} | \u{09} | \u{0d} | \u{0a}
LineComment: "//" ~[\u{0a}]*
BlockComment: "/*" (BlockComment | ~"*/")* "*/"
```

- 空白：`空格`、`\t`、`\r`、`\n`，仅作分隔。
- 行注释 `//` 到行尾；块注释 `/* ... */` 可嵌套。
- 注释 **不** 产生 token，但词法阶段保留行/列计数。

### 2.2 Identifiers（标识符） ✅ tote

```ebnf
RAW_IDENTIFIER: "r#" IDENTIFIER
NON_KEYWORD_IDENTIFIER: IDENTIFIER except a strict keyword
IDENTIFIER:
      XID_Start XID_Continue*
    | "_" XID_Continue*
```

- `XID_Start` / `XID_Continue` 按 Unicode XID 规则（实践上 ASCII `[A-Za-z_][A-Za-z0-9_]*`）。
- 命名范式（spec §1.1，编译器强制校验）：
  - 类型（struct/enum/flag/variant/union）：大驼峰 `EntityState`
  - 变量/字段/普通函数：小蛇形 `entity_id`
  - 编译期常量：全大写蛇形 `MAX_RENDER_LAYER`
  - 违反命名规范：warning（exit 0），不阻断编译。

### 2.3 Keywords（关键字） ✅ tote

以下为当前保留关键字（strict keywords），不可作标识符：

```ebnf
Keyword:
    "fn" -> KwFunc
  | "struct" -> KwStruct
  | "enum" -> KwEnum
  | "flag" -> KwFlag
  | "union" -> KwUnion
  | "variant" -> KwVariant
  | "var" -> KwVar
  | "const" -> KwConst
  | "comptime" -> KwComptime
  | "if" -> KwIf
  | "else" -> KwElse
  | "for" -> KwFor
  | "while" -> KwWhile
  | "break" -> KwBreak
  | "continue" -> KwContinue
  | "return" -> KwReturn
  | "true" -> KwTrue
  | "false" -> KwFalse
  | "null" -> KwNull
  | "map" -> KwMap
  | "import" -> KwImport
  | "export" -> KwExport
  | "as" -> KwAs
  | "in" -> KwIn
  | "defer" -> KwDefer
  | "void" -> KwVoid
  | "string" -> KwString
  | "StringBuilder" -> KwStringBuilder
```

> 关键字由 `lex` 阶段查表（`kw_lookup`，基于 `keywords_tbl`）判定。其权威列表即上方 `Keyword` 产生式中的字面量，由 `tools/gen_ebnf.mjs` 抽取生成 `out/ebnf.json`、`src/totter.tc` 解析后生成进 `gen/tc.tc`（totter 已放弃，该区间现冻结于 `src/tc.tc`、手写维护）。`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f16`/`f32`/`f64`/`bool`/`type` 为**内建类型名**（见 §3.5），不是关键字。
> ⚠ spec-only（设计中、tc 未接入）：`union`、`enum` 完整语义、`comptime` 表达式。

### 2.4 Literals（字面量） ✅ tote（部分）

```ebnf
Literal:
      IntegerLiteral
    | FloatLiteral
    | BoolLiteral
    | StringLiteral
    | CharLiteral          // ⚠ spec-only（当前 t 以 string 承载字符）

IntegerLiteral: DecimalLiteral | HexLiteral | BinaryLiteral
DecimalLiteral: "0" | NonZeroDigit Digit*
HexLiteral:     "0x" HexDigit+
BinaryLiteral:  "0b" BinDigit+
FloatLiteral:   Digit+ "." Digit+ (("e"|"E") ("+"|"-")? Digit+)?
BoolLiteral:    "true" | "false"
StringLiteral:  '"' (~["\\\u{0a}] | Escape)* '"'
Escape:         "\\" ("n"|"t"|"r"|"\""|"\\")
```

- 整型字面量默认类型由上下文推断；带后缀写法 `123u8` ⚠ spec-only（当前未实现显式位宽后缀，靠变量声明类型推导）。
- 字符串字面量为只读 UTF-8（`string`），`StringBuilder` 为可变拼接类型。
- 换行 `\u{0a}` 不允许出现在字符串字面量内（多行用拼接/常量）。

### 2.5 Operators and punctuation（运算符与标点） ✅ tote

```ebnf
OpOrPunct:
    "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">="
  | "&&" | "||" | "!" | "&" | "|" | "^" | "~" | "<<" | ">>"
  | "=" | "+=" | "-=" | "*=" | "/=" | "%="
  | "->" | ":" | ";" | "," | "." | ".."
  | "(" | ")" | "{" | "}" | "[" | "]" | "@" | "#"
```

- 顶层声明为**并置式**：声明名后直接跟声明种类关键字（`Name fn ...`、`Name struct ...`），无绑定算子。⚠ `::` 绑定算子已于 2026-08-01 移除；旧写法 `Name :: func ...` 由 parser 报带迁移指引的硬错误。
- `#` 用于内存布局指令 `#aos` / `#soa`（⚠ spec-only 实变换未接入）。
- `@` 引入注解 `@name(args)`。

### 2.6 Compiler data tables（机器可读数据表）✅ tote

以下五个产生式以 `ebnf` 块形式给出编译器内部**可枚举目录**（关键字表、内建返回类型、@derive trait、诊断码、注解注册表）。它们由 `tools/gen_ebnf.mjs` 从本文档抽取、生成 [`out/ebnf.json`](./../out/ebnf.json) 的对应字段，再由 `src/totter.tc`（已放弃）驱动生成 `gen/tc.tc`（冻结快照）的 5 个 `GEN:` 标记区间，现冻结于 `src/tc.tc`、手写维护。（⚠ totter 已放弃，不再依赖重新生成；修改这些目录直接在 `src/tc.tc` 手写，`ebnf` 产生式仅作文档记录。）

> 记号约定：枚举项以 `|` 分隔；`"x" -> Kind` 表示关键字字面量映射到 token 种类；`"x" / "y" => Ret` 表示多个内建名共享同一返回类型（生成 `name == "x" || name == "y"` 的判别式）；`"@n" { spec, targets, repl }` 表示注解注册项。

```ebnf
BuiltinTable:
    "assert_eq" / "assert_true" / "assert_false" => ti_mk("Void")
  | "assert_panic" / "flag_set" / "print" => ti_mk("Void")
  | "println" / "append" / "slice_set" => ti_mk("Void")
  | "exit" / "eprint" / "sb_append_str" => ti_mk("Void")
  | "sb_append_char" / "sb_append_u64" / "sb_append_i64" => ti_mk("Void")
  | "sb_clear" => ti_mk("Void")
  | "flag_get" => ti_scalar("u32")
  | "sys_run" => ti_scalar("i32")
  | "str_len" / "slice_len" => ti_scalar("u64")
  | "str_at" => ti_scalar("u8")
  | "file_read_all" / "path_resolve" / "str_slice" => ti_mk("String")
  | "sb_to_str" / "to_string" => ti_mk("String")
  | "int_to_str" => ti_mk("String")
  | "file_write_all" / "file_exists" => ti_scalar("bool")
  | "args" => ti_elem_of("Slice", ti_mk("String"))
  | "sb_new" => ti_mk("StringBuilder")
  | "map_new" => ti_mk("Map")
  | "map_set" => ti_mk("Void")
  | "map_has" / "map_del" => ti_scalar("bool")
  | "map_len" => ti_scalar("i64")
  | "map_get" => ti_mk("Unknown")   // 返回类型 = 映射的 V，由 infer_expr/expr_type_desc 特判
  | "ti_name" / "fi_name" / "fi_type_name" => ti_mk("String")
  | "ti_size" / "ti_kind" / "ti_field_count" / "fi_offset" / "fi_type_size" => ti_scalar("i64")
  | "ti_field" => ti_mk("FieldInfo")
  | "fi_is_ptr" => ti_scalar("bool")

DeriveTraitTable:
    "ToString" | "FromString" | "Clone" | "Copy" | "DebugPrint"
  | "BinarySerde" | "Eq" | "PartialEq" | "Hash"

DiagnosticTable:
    "T_TYPE_MISMATCH" -> error
  | "T_TYPE_IMPLICIT_CAST" -> error
  | "T_STMT_IMPLICIT_BOOL" -> error
  | "T_PARSE_INVALID_EXPR" -> error
  | "T_FLAG_OFFSET_CONFLICT" -> error
  | "T_FLAG_OVERFLOW" -> error
  | "T_DERIVE_UNSUPPORTED" -> error
  | "T_ANNOTATION_INVALID_ARG" -> error
  | "T_ANNOTATION_UNKNOWN" -> error
  | "T_ANNOTATION_WRONG_TARGET" -> error
  | "T_IMPORT_IO" -> error
  | "T_IMPORT_HEADER" -> error
  | "T_IMPORT_VALUE" -> error
  | "T_IMPORT_CONTEXT" -> error
  | "T_CLOSURE_CAPTURE" -> error
  | "T_VAR_NO_TYPE" -> error
  | "T_UNDEFINED_IDENT" -> error

AnnotationTable:
    "test" { spec: "none", targets: "func", repl: "" }
  | "test_skip" { spec: "none", targets: "func", repl: "" }
  | "test_only" { spec: "none", targets: "func", repl: "" }
  | "expect_fail" { spec: "none", targets: "func", repl: "" }
  | "test_group" { spec: "string", targets: "func", repl: "" }
  | "derive" { spec: "ident_list", targets: "struct, enum, flag, flag_set, union", repl: "" }
  | "cfg" { spec: "ident", targets: "global, func, struct, enum, var, const", repl: "" }
  | "cfg_attr" { spec: "mixed", targets: "global, func, struct, enum", repl: "" }
  | "allow" { spec: "ident_list", targets: "global, func, struct, var, const", repl: "" }
  | "warn" { spec: "ident_list", targets: "global, func, struct, var, const", repl: "" }
  | "deny" { spec: "ident_list", targets: "global, func, struct, var, const", repl: "" }
  | "deprecated" { spec: "string", targets: "global, func, struct, enum, var, const", repl: "" }
  | "repr" { spec: "ident", targets: "struct, enum, union", repl: "" }
  | "no_padding" { spec: "none", targets: "struct, flag", repl: "" }
  | "align" { spec: "number", targets: "struct, union", repl: "" }
  | "bitpack" { spec: "ident", targets: "struct", repl: "" }
  | "offset" { spec: "number", targets: "flag_slot", repl: "" }
  | "binary_offset" { spec: "number", targets: "field", repl: "" }
  | "binary_skip" { spec: "none", targets: "field", repl: "" }
  | "soa" { spec: "none", targets: "struct", repl: "" }
  | "aos" { spec: "none", targets: "struct", repl: "" }
  | "inline" { spec: "none", targets: "func", repl: "" }
  | "no_inline" { spec: "none", targets: "func", repl: "" }
  | "must_use" { spec: "none", targets: "func", repl: "" }
  | "const_fn" { spec: "none", targets: "func", repl: "" }
  | "unsafe" { spec: "none", targets: "func", repl: "" }
  | "main" { spec: "none", targets: "func", repl: "" }
  | "export_symbol" { spec: "string", targets: "func", repl: "" }
  | "link_name" { spec: "string", targets: "func", repl: "" }
  | "panic_handler" { spec: "none", targets: "func", repl: "" }
  | "doc" { spec: "string", targets: "global", repl: "" }
  | "doc_file" { spec: "string", targets: "func, struct, enum", repl: "" }
  | "export" { spec: "mixed", targets: "field, func, var, const", repl: "" }
  | "auto_convert" { spec: "none", targets: "struct, enum", repl: "@derive(FromString)" }
```

### 2.7 Parser dispatch tables（解析器分发表，EBNF → 代码）✅ tote

以下 `ebnf` 块给出递归下降解析器中**关键字驱动的分发表**：每条 `NameDispatch:` 规则列出「当前 token → 调用的 `parse_*` 函数」。它们由 `tools/gen_ebnf.mjs` 抽取进 `out/ebnf.json` 的 `dispatches` 段，再由 `src/totter.tc`（已放弃）生成进 `gen/tc.tc`（冻结快照）的 `GEN:parser_dispatch` 标记区间，该区间现冻结于 `src/tc.tc`、手写维护（取代手写 if 链的设计仍保留，但不再由 totter 生成）。

记号约定：`KwXxx` 表示匹配 token 种类 `KwXxx`；`Id("v")` 表示匹配 `Identifier` 且字面量为 `v`；`_`（唯一一条，置于末尾）表示默认分支。

```ebnf
DeclBodyDispatch:
    KwStruct  => parse_struct_decl(name, anns, layout)
  | KwEnum    => parse_enum_decl(name, anns)
  | KwFlag    => parse_flag_decl(name, anns)
  | KwUnion   => parse_union_decl(name, anns)
  | KwVariant => parse_variant_decl(name, anns)
  | KwFunc    => parse_func_decl(name, anns, is_comptime)
  | Id("flag_set") => parse_flag_set_decl(name, anns)
  | _         => parse_type_alias(name, anns)
```

---

### 2.8 Parser grammar（数据驱动生成的权威文法）✅ tote（部分，规则驱动生成试点）

以下 `// @rule` 文法是**递归下降 parser 的权威生成源**：`tools/gen_ebnf.mjs` 把每条规则的 body 解析成结构化 EBNF 树（含 FIRST 集），再由 `src/totter.tc`（已放弃）发射进 `gen/tc.tc`（冻结快照）的 `GEN:parser` 标记区间，生成 `parse_<rule>` 函数。⚠ totter 已放弃，此生成路径不再使用；`src/tc.tc` 的解析器为手写实现，`GEN:parser` 区间现为冻结快照。

记号：
- `// @rule <name> params=(...) ret=<T> node=<NodeKind> eatFirst=<bool>`：规则元数据。`eatFirst=true` 表示被分发表按关键字匹配后，函数先 `advance_i()` 吃掉该关键字（如 `variant`）。
- body 为 EBNF：`A B` 序列、`A | B` 选择、`A?`/`A*`/`A+` 可选/重复、`(...)` 分组、`"X"` 字面量（映射到 token 种类）、`Ident` 标识符终端、`type`/`anns`/`case` 等非终结符（映射到 `parse_*` 调用）。
- `{ field = expr }` 节点构造块：`field` 为 AST 节点字段；`expr` 中 `@sym` 引用 body 中符号的解析结果，`name`/`anns` 等参数名与 `list_concat(...)` 等辅助调用原样保留。构造块默认发射为 §2.9 生成的 `mk_<NodeKind>(...)` 一行调用，未在块中列出的槽自动填 `node_new` 初值。
- `// @rule <name> ... mk=inline`：额外元数据，**关闭** `mk_<kind>(...)` 发射、退回「`node_new` + 逐槽赋值 + `slice_set`」内联形态。仅当某个 `expr` 内部会**分配新 AST 节点**时才需要：函数实参先于 `node_new` 求值，子节点索引会挪到父节点之前，导致 AST 结构漂移。目前仅 `sfield` 命中（`sfield_na` 会 `mk_scalar("void")`）。
- ⚠ 走 `mk_` 路径时，构造块内各 `expr` 的**求值顺序会被重排为 Node 字段序**（`sa sb sc has_* ia ib ba bb na..nd la..lc`），而非书写顺序。因此块内含**有副作用**的表达式时须自查重排后语义不变。当前唯一的副作用调用是 `list_concat`（就地改写 `kids` 链），它在 `flag_decl`/`struct_decl` 重排后仍排在所有读注解链的 `bp_*`/`str_or` 之后，故安全。
- `// @rule <name> ... fold=bin`：额外元数据，标记该规则是**左结合二元运算塔**（`base (op base)*` 形状）。生成器发射 `while (op 集合) { left = mk_bin(op, left, parse_base(), ti); }`；运算符字面量即 `mk_bin` 的 op 串（如 `"<<"`→`"<<"`、`"&&"`→`"&&"`），其 token kind 由 `tools/gen_ebnf.mjs` 的 `OPKIND` 表映射（覆盖结构标点表）。
- `// @rule <name> ... fold=pre`：额外元数据，标记该规则是**前缀一元折叠**（`(op)* base` 形状，右结合递归）。生成器发射 `if (cur_t() in ops) { op; operand = parse_<self>(); return mk_un(op, operand, ti); } return parse_<base>();`；运算符字面量即 `mk_un` 的 op 串（如 `"!"`→`"!"`、`"-"`→`"-"`、`"~"`→`"~"`），其 token kind 由 `OPKIND` 映射（`!`→Not、`-`→Minus、`~`→BitNot）。递归目标为规则自身（允许 `!!x` 堆叠），无 op 时落到 `base`。
- `// @rule <name> ... fold=post`：额外元数据，标记该规则是**左结合后缀折叠**（`base ( lead nt | lead nt | ... )* ( lead nt )?` 形状）。每个后缀分支 = `引导 token 字面量 + 胶水非终结符`；生成器发射 `var e = parse_base(); while (引导 token 集合) { var ti = advance_i(); e = parse_<胶水>(e, ti); }`，尾部 `( lead nt )?` 可选分支发射单次 `if`。胶水 helper（如 `post_member`/`post_index`/`post_call`/`post_cast`）为手写函数，签名 `(e: i64, ti: i64) -> i64`，负责消费引导 token 之后的剩余形态并返回折叠后的节点。`fold` 当前支持 `bin`/`pre`/`post`/`prim`/`disp` 五类通用模式，以及语句体专用的 `whilex`/`returnx`（纯序列 + node_at）/ `ifx`（if/else-if 链）/ `forx`（peek 前瞻分流两段式）/ `swx`（case/default 循环聚合）五种专用模式。
- `// @rule <name> ... fold=prim`：额外元数据，标记该规则是**终端驱动 dispatch**（`term nt | term nt | ...` 形状）。每个分支 = `分发终端 + 胶水非终结符`；终端可为命名终端（`Integer`/`Float`/`String`/`Ident`）或字面量（关键字/标点）。生成器发射 `if (cur_t() == "K") { var ti = advance_i(); return parse_<胶水>(ti); }` 链，末尾发射错误兜底（`eprint` + `exit(1)`）。胶水 helper 为手写函数，签名 `(ti: i64) -> i64`，负责分发 token 之后的剩余形态并构造节点。
- `// @rule <name> ... fold=disp`：额外元数据，标记该规则是**守卫式分发**（`term nt | term nt | ... | nt` 形状）。与 `fold=prim` 的区别：骨架**不消费**引导 token（各目标函数自行消费），故发射 `if (cur_t() == "K") { return parse_<目标>(); }` 链；末尾**裸非终结符分支**为兜底（`return parse_<兜底>();`），无错误兜底。目标函数签名一律 `() -> i64`。用于 `statement` 这类「引导 token 只做路由、解析体各自独立」的规则。

```ebnf
// @rule type_alias params=(name: string, anns: i64) ret=i64 node=TypeAliasDecl eatFirst=false
type_alias :: type ";"
{
    sa = name
    la = anns
    na = @type
}

// @rule variant_decl params=(name: string, anns: i64) ret=i64 node=VariantDecl eatFirst=true
variant_decl :: anns "{" case* "}"
{
    sa = name
    la = list_concat(anns, @anns)
    lb = @case
}

// @rule case params=(ci: i64) ret=i64 node=VC eatFirst=false
case :: Ident ( "(" type ")" )? anns ("," | ";")?
{
    sa = @Ident
    na = @type
    la = @anns
    ia = ci
}

// @rule flag_decl params=(name: string, anns: i64) ret=i64 node=FlagDecl eatFirst=true
flag_decl :: ( "[" Ident "]" )? anns "{" slot* "}"
{
    sa = name
    la = list_concat(anns, @anns)
    sb = str_or(@Ident, "u32")
    lb = @slot
}

// @rule slot params=() ret=i64 node=SL eatFirst=false
slot :: Ident ":" Integer anns ("," | ";")?
{
    sa = @Ident
    ia = parse_int_str(@Integer)
    ib = flag_offset_of(@anns)
    bb = flag_has_offset(@anns)
    la = @anns
}

// @rule flag_set_decl params=(name: string, anns: i64) ret=i64 node=FlagSetDecl eatFirst=true
flag_set_decl :: anns "{" setmember* "}"
{
    sa = name
    la = list_concat(anns, @anns)
    lb = @setmember
}

// @rule setmember params=() ret=i64 node=SL eatFirst=false
setmember :: Ident ":" Integer anns ("," | ";")?
{
    sa = @Ident
    ia = parse_int_str(@Integer)
    ib = -1
    bb = false
    la = @anns
}

// @rule union_decl params=(name: string, anns: i64) ret=i64 node=UnionDecl eatFirst=true
union_decl :: anns "{" umember* "}"
{
    sa = name
    la = list_concat(anns, @anns)
    lb = @umember
}

// @rule umember params=() ret=i64 node=M eatFirst=false
umember :: Ident ":" type anns ("," | ";")?
{
    sa = @Ident
    na = @type
    la = @anns
}

// @rule struct_decl params=(name: string, anns: i64, layout: string) ret=i64 node=StructDecl eatFirst=true
// @bitpack 检测下沉为手写 helper（bp_is2/bp_type2/bp_has_type2 在两个注解列表上查找，
// 避免为检测而重复 list_concat）；成员形态由 sfield 的 FIRST 守卫 alt 区分，无需结构体级状态。
struct_decl :: anns "{" sfield* "}"
{
    sa = name
    ba = bp_is2(anns, @anns)
    sc = bp_type2(anns, @anns)
    has_sc = bp_has_type2(anns, @anns)
    la = list_concat(anns, @anns)
    sb = layout
    lb = @sfield
}

// @rule sfield params=() ret=i64 node=F eatFirst=false mk=inline
// 成员二分形态：位宽成员（@bitpack 结构体，`name: 3;`）以 Integer 开头，
// 类型成员以其余 token 开头——FIRST 可区分，故用 alt 而非结构体级 is_bitpack 状态。
// mk=inline：sfield_na 在位宽分支里会 mk_scalar("void") 分配节点，若走 mk_F(...) 则
// 该实参先于 F 自身求值，void 节点索引会挪到 F 之前 → AST 漂移。故保留内联构造。
sfield :: Ident ":" ( Integer | type ) anns ";"
{
    sa = @Ident
    na = sfield_na(@Integer, @type)
    ia = sfield_ia(@Integer)
    la = @anns
}

// ── 表达式二进制优先级塔（fold=bin：左结合二元运算折叠）──
// 形状：base ( (op | op | ...) base )*  →  while (op) { left = mk_bin(op, left, parse_base(), ti); }
// 运算符字面量即 mk_bin 的 op 串（"&&"→"&&"、"<<"→"<<"），token kind 由 gen_ebnf 的 OPKIND 映射。

// @rule or params=() ret=i64 node=_ eatFirst=false fold=bin
or :: and ( "||" and )*

// @rule and params=() ret=i64 node=_ eatFirst=false fold=bin
and :: bitor ( "&&" bitor )*

// @rule bitor params=() ret=i64 node=_ eatFirst=false fold=bin
bitor :: bitxor ( "|" bitxor )*

// @rule bitxor params=() ret=i64 node=_ eatFirst=false fold=bin
bitxor :: bitand ( "^" bitand )*

// @rule bitand params=() ret=i64 node=_ eatFirst=false fold=bin
bitand :: eq ( "&" eq )*

// @rule eq params=() ret=i64 node=_ eatFirst=false fold=bin
eq :: cmp ( ("==" | "!=") cmp )*

// @rule cmp params=() ret=i64 node=_ eatFirst=false fold=bin
cmp :: shift ( ("<" | ">" | "<=" | ">=") shift )*

// @rule shift params=() ret=i64 node=_ eatFirst=false fold=bin
shift :: add ( ("<<" | ">>") add )*

// @rule add params=() ret=i64 node=_ eatFirst=false fold=bin
add :: mul ( ("+" | "-") mul )*

// @rule mul params=() ret=i64 node=_ eatFirst=false fold=bin
mul :: unary ( ("*" | "/" | "%") unary )*

// ── 表达式前缀一元运算符（fold=pre：右结合前缀折叠）──
// 形状：( (op | op | ...) )* base  →  if (cur in ops) { op; operand = parse_self(); return mk_un(op, operand, ti); } return parse_base();
// 运算符字面量（"!"/"-"/"~"）token kind 由 OPKIND 映射（!→Not、-→Minus、~→BitNot）。

// @rule unary params=() ret=i64 node=_ eatFirst=false fold=pre
unary :: ( "!" | "-" | "~" )* postfix

// ── 表达式后缀（fold=post：左结合后缀折叠，胶水 helper 下沉）──
// 形状：base ( lead nt | ... )* ( lead nt )?  →  e = parse_base(); while (lead 集合) { ti = advance_i(); e = parse_<nt>(e, ti); } 尾部可选分支单次 if。
// 引导 token："."→Dot、"["→LBracket、"("→LParen（PUNCT 表）、"as"→KwAs（关键字表）。
// 胶水 helper（手写，GEN 区外）：post_member（.成员）、post_index（[下标]）、post_call（(参数表)）、post_cast（as 类型转换）。

// @rule postfix params=() ret=i64 node=_ eatFirst=false fold=post
postfix :: primary ( "." post_member | "[" post_index | "(" post_call )* ( "as" post_cast )?

// ── 表达式基底（fold=prim：终端驱动 dispatch，分支体下沉）──
// 形状：term nt | term nt | ...  →  if (cur_t()==K) { ti = advance_i(); return parse_<nt>(ti); } 链 + 错误兜底（eprint + exit(1)）。
// 分发 token：Integer/Float/String（命名终端）、"true"→KwTrue、"false"→KwFalse、"null"→KwNull（关键字表）、Ident→Identifier、"("→LParen、"["→LBracket（PUNCT 表）。
// 胶水 helper（手写，GEN 区外，签名 (ti: i64) -> i64）：prim_int/prim_float/prim_str/prim_true/prim_false/prim_null/prim_ident（含 struct_lit 前瞻）/prim_paren/prim_array（含 map_lit 前瞻）。

// @rule primary params=() ret=i64 node=_ eatFirst=false fold=prim
primary :: Integer prim_int | Float prim_float | String prim_str | "true" prim_true | "false" prim_false | "null" prim_null | Ident prim_ident | "(" prim_paren | "[" prim_array

// ── 语句顶层分发（fold=disp：守卫式分发，骨架不消费引导 token）──
// 形状：term nt | ... | nt（裸 NT 兜底）→ if (cur_t()==K) { return parse_<nt>(); } 链 + return parse_<兜底>();
// 目标函数一律签名 () -> i64、自行消费引导 token：if/for/while/return 为既有函数原样路由；
// break/continue/defer/comptime/block/var/const 为下沉胶水（block_stmt 用 pos 做位点故不 advance）。

// @rule statement params=() ret=i64 node=_ eatFirst=false fold=disp
statement :: "if" if_stmt | "for" for_stmt | "while" while_stmt | "return" return_stmt | "break" break_stmt | "continue" continue_stmt | "defer" defer_stmt | "comptime" comptime_stmt | "{" block_stmt | "var" var_stmt | "const" const_stmt | expr_or_assign_stmt

// ── 语句体内部结构（fold=whilex/returnx：纯序列形态，含 node_at 守卫）──
// 形状：while "(" expr ")" block  /  return expr? ";"  →  通用骨架 + 节点构造，eatFirst 吃掉引导关键字。

// @rule while_stmt params=() ret=i64 node=While eatFirst=true fold=whilex
while_stmt :: "(" expr ")" block

// @rule return_stmt params=() ret=i64 node=Return eatFirst=true fold=returnx
return_stmt :: expr? ";"

// ── 语句体内部结构（fold=ifx：if/else-if 链，else 分支嵌套 if 须包成单元素 list 兜底）──
// 形状：if "(" expr ")" block ("else" (block | if_stmt))?  →  守卫式骨架识别 else/else-if，递归自身。

// @rule if_stmt params=() ret=i64 node=If eatFirst=true fold=ifx
if_stmt :: "(" expr ")" block ("else" (block | if_stmt))?

// ── 语句体内部结构（fold=forx：peek 前瞻分发两段式 for：Identifier [","Ident] KwIn=for_each，否则 C 式三子句）──
// 形状：for "(" ( Ident ("," Ident)? "in" expr | (expr? ";" expr? ";" expr?) ) ")" block  →  守卫式骨架按 peek_t(1)/peek_t(3) 分流。
// 双变量形式仅对 map 有意义：第一个绑定键、第二个绑定值（按插入序）。

// @rule for_stmt params=() ret=i64 node=For eatFirst=true fold=forx
for_stmt :: "(" ( Ident ("," Ident)? "in" expr | expr? ";" expr? ";" expr? ) ")" block

// 🚫 switch_stmt（fold=swx）已于 2026-08-01 废弃并从编译器删除，由 match 表达式取代。
//    其 @rule / @node 条目连同 KwSwitch/KwCase/KwDefault 三个关键字已从本文法移除，
//    编译器侧 KwSwitch/KwCase/KwDefault 均为零命中。
//    ⚠ 冻结快照 out/ebnf.json 与 gen/tc.tc 生成于删除之前，仍含 switch 条目；
//      二者不参与门禁（totter 自 M38 放弃、GEN 区间改手写维护），故不同步是预期的。
//    ⚠ node_kind_names 中的 "CS"（switch case 节点）为死条目：无任何代码产生它，
//      但删除会移动后续 node kind 索引，故有意保留。
```

- 终端约定：`Ident` → `expect_tok("Identifier")`（string 结果）；`Integer` → `expect_tok("Integer")`（string 结果，字面量文本）。
- 语义胶水以**手写 helper** 下沉：`str_or(s, d)`（可选捕获缺省值）、`flag_offset_of(anns)`/`flag_has_offset(anns)`（`@offset(n)` 注解参数提取）——文法保持纯结构，构造块直接调用。
- ✅ tote（部分）：`type_alias`、`variant_decl`/`case`、`flag_decl`/`slot`、`flag_set_decl`/`setmember`、`union_decl`/`umember`、`struct_decl`/`sfield` 已由此文法数据驱动生成（`GEN:parser_rules`），经 difftest 与 conformance 验证。至此全部结构型声明均为数据驱动生成。
- ✅ tote（续）：表达式二进制优先级塔 `or`/`and`/`bitor`/`bitxor`/`bitand`/`eq`/`cmp`/`shift`/`add`/`mul` 亦以此文法以 `fold=bin` 规则生成（左结合 `while` + `mk_bin` 折叠），替换 10 个手写函数。
- ✅ tote（续）：表达式前缀一元运算符 `unary` 亦以此文法以 `fold=pre` 规则生成（右结合前缀折叠 + `mk_un` 构造），替换手写 `parse_unary`。
- ✅ tote（续）：表达式后缀 `postfix` 亦以此文法以 `fold=post` 规则生成（左结合后缀折叠骨架 + 胶水 helper `post_member`/`post_index`/`post_call`/`post_cast` 下沉），替换手写 `parse_postfix`。
- ✅ tote（续）：表达式基底 `primary` 亦以此文法以 `fold=prim` 规则生成（终端驱动 dispatch 骨架 + 9 个胶水 helper `prim_int`/`prim_float`/`prim_str`/`prim_true`/`prim_false`/`prim_null`/`prim_ident`/`prim_paren`/`prim_array` 下沉）。**表达式金字塔 or→…→primary 全部数据驱动生成。**
- ✅ tote（续）：语句顶层分发 `statement` 亦以此文法以 `fold=disp` 规则生成（守卫式分发骨架：if/for/while/return 路由既有函数，break/continue/defer/comptime/block/var/const 下沉为胶水，兜底 `expr_or_assign_stmt`），替换手写 `parse_statement`。（生成时该分发还含 `switch`，2026-08-01 随 switch 废弃一并移除。）
- ✅ tote（续）：语句体内部结构亦以文法表达——`while_stmt`/`return_stmt` 以 `fold=whilex`/`fold=returnx`（纯序列 + node_at 守卫）生成；`if_stmt` 以 `fold=ifx`（if/else-if 链，else 分支嵌套 if 包成单元素 list 兜底）生成；`for_stmt` 以 `fold=forx`（peek_t(1) 前瞻分流 for_each / C 式三子句）生成；`switch_stmt` 曾以 `fold=swx`（case/default 循环聚合，default 缺省 -2）生成，已随 switch 废弃删除。四者（原五者）各自替换对应手写 `parse_*` 函数，`local_var`（名校验副作用 + nti 定位）仍保留为胶水。`statement` 顶层分发路由目标现为全数据驱动生成。

---

### 2.9 AST node kinds（数据驱动生成的节点种类表）✅ tote

节点种类（AST 的 `kind` 标签）的单一真相源。totter 读取本表（经 `tools/gen_ebnf.mjs` → `out/ebnf.json` 的 `nodes` 段；totter 已放弃，该生成现冻结于 `src/tc.tc`）生成 `Node` 结构、`node_new` / `node_at`、节点种类注册表（`node_kind_names` / `init_node_kinds` / `is_node_kind`），以及**每个种类的构造器 `mk_<kind>(槽参数…, ti)`**。

`Node` 是固定通用槽结构，每行 `// @node <名字> [槽=类型 …]` 声明该种类实际使用的槽（按结构字段序）：

| 槽 | 记法 | t 类型 | 语义 |
|---|---|---|---|
| `sa` `sb` `sc` | `str` | `string` | 字符串载荷 |
| `has_sa` `has_sb` `has_sc` | `has` | `bool` | 对应字符串槽是否为 null 语义 |
| `ia` `ib` | `int` | `i64` | 整型载荷（radix / bitWidth / offset），-1 = null |
| `ba` `bb` | `bool` | `bool` | 布尔载荷（isConst / isExtern / isBitpack…） |
| `na` `nb` `nc` `nd` | `node` | `i64` | 子节点索引，-1 = null |
| `la` `lb` `lc` | `list` | `i64` | 子节点列表头，-1 = 空列表，-2 = null 列表 |

构造器约定：参数按上表字段序排列，末位固定为 anchor token 下标 `ti`；`ti < 0` 表示不打 anchor（跳过 `node_at`）。无槽种类只生成 `mk_<kind>(ti)`。

槽本身的机器可读定义（`Node` 结构字段序 = 本表行序；totter 由此生成（totter 已放弃，现冻结于 `src/tc.tc`）`Node` 结构体字段、`node_new` 初值，并驱动 `slot_ty`/`slot_default` 查表）。每行 `// @slot <槽名> <记法> <t类型> <初值> [字段注释…]`；锚点槽（记法 `anchor`）不参与 `@node` 标注与构造器参数，仅由 `node_at` 写入：

```ebnf
SlotTable ::
  // @slot sa str string ""
  // @slot sb str string ""
  // @slot sc str string ""
  // @slot has_sa has bool true
  // @slot has_sb has bool true
  // @slot has_sc has bool true
  // @slot ia int i64 -1
  // @slot ib int i64 -1
  // @slot ba bool bool false
  // @slot bb bool bool false
  // @slot na node i64 -1
  // @slot nb node i64 -1
  // @slot nc node i64 -1
  // @slot nd node i64 -1
  // @slot la list i64 -1
  // @slot lb list i64 -1
  // @slot lc list i64 -1
  // @slot ln anchor u64 0 anchor token 行（诊断用；0 = 无）
  // @slot cl anchor u64 0 anchor token 列
  // @slot tv anchor string "" anchor token 文本（endCol = col + len(tv)）
```

```ebnf
NodeTable ::
  // @node A sa=str la=list
  // @node CS na=node la=list
  // @node EN na=node nb=node
  // @node EnumDecl sa=str sb=str la=list lb=list
  // @node F sa=str ia=int na=node la=list
  // @node FV sa=str na=node
  // @node FlagDecl sa=str sb=str la=list lb=list
  // @node FlagSetDecl sa=str la=list lb=list
  // @node FuncDecl sa=str ba=bool bb=bool na=node la=list lb=list lc=list
  // @node GlobalConstDecl sa=str bb=bool na=node nb=node la=list
  // @node GlobalVarDecl sa=str bb=bool na=node nb=node la=list
  // @node ImportDecl sb=str sc=str has_sa=has has_sc=has la=list
  // @node M sa=str na=node la=list
  // @node P sa=str na=node la=list
  // @node SL sa=str ia=int ib=int bb=bool la=list
  // @node StructDecl sa=str sb=str sc=str has_sc=has ba=bool la=list lb=list
  // @node TypeAliasDecl sa=str na=node la=list
  // @node UnionDecl sa=str la=list lb=list
  // @node V sa=str na=node la=list
  // @node VC sa=str ia=int na=node la=list
  // @node VariantDecl sa=str la=list lb=list
  // @node array na=node nb=node
  // @node array_lit la=list
  // @node assign sa=str na=node nb=node
  // @node assignment sa=str na=node nb=node
  // @node binary sa=str na=node nb=node
  // @node block la=list
  // @node bool ba=bool
  // @node break
  // @node call na=node la=list
  // @node cast na=node nb=node
  // @node comptime na=node
  // @node comptime_block la=list
  // @node continue
  // @node defer la=list
  // @node expr na=node
  // @node flag sa=str
  // @node flag_set
  // @node float sa=str
  // @node for na=node nb=node nc=node la=list
  // @node for_each sa=str sb=str na=node la=list
  // @node ident sa=str
  // @node if na=node la=list lb=list
  // @node index na=node nb=node
  // @node int sa=str ia=int
  // @node list la=list
  // @node map na=node nb=node
  // @node map_lit la=list
  // @node member sa=str na=node
  // @node named sa=str
  // @node null
  // @node number sa=str
  // @node optional na=node
  // @node paren na=node
  // @node pointer na=node
  // @node return na=node
  // @node scalar sa=str
  // @node slice na=node
  // @node string sa=str
  // @node struct_lit sa=str la=list
  // @node unary sa=str na=node
  // @node var_decl sa=str ba=bool na=node nb=node
  // @node variant
  // @node while na=node la=list
```

### 2.10 Scalar types（标量类型表与派生函数）✅ tote

标量类型的全部属性收敛为一张表 `ScalarTable`，编译器中所有按标量名分派的查询函数（谓词、位宽、C 类型名、LLVM 类型名）都是这张表的投影，由 `ScalarFnTable` 声明投影方式后自动生成。

`// @scalar <name> <class> <bw> <c> <ll> <llbits>`：

| 列 | 含义 |
|---|---|
| `name` | t 源码中的类型名 |
| `class` | `int` / `float` / `bool` / `none`（`none` = 非标量，仅供 C 类型映射复用） |
| `bw` | t 语义位宽（`bool` 为 1；`none` 为 -1） |
| `c` | 生成 C 代码时的类型名 |
| `ll` | 生成 LLVM IR 时的类型名 |
| `llbits` | LLVM 表示位宽（`bool` 按 i8 存储，故为 8） |

```ebnf
ScalarTable ::
  // @scalar u8   int   8  uint8_t  i8     8
  // @scalar u16  int   16 uint16_t i16    16
  // @scalar u32  int   32 uint32_t i32    32
  // @scalar u64  int   64 uint64_t i64    64
  // @scalar i8   int   8  int8_t   i8     8
  // @scalar i16  int   16 int16_t  i16    16
  // @scalar i32  int   32 int32_t  i32    32
  // @scalar i64  int   64 int64_t  i64    64
  // @scalar f16  float 16 _Float16 i64    64
  // @scalar f32  float 32 float    float  32
  // @scalar f64  float 64 double   double 64
  // @scalar bool bool  1  bool     i8     8
  // @scalar void none  -1 void     i64    64
```

`// @sfn <fn> <ret> <mode> <filter> <col> <fallback> <region>` 声明由上表派生的查询函数。所有派生函数签名固定为 `<fn> fn(name: string) -> <ret>`。

- `filter`：`all` = 全表；`scalar` = `class != none`；`int` / `float` / `bool` = 按 class 取。
- `col`：取值列（`pred` 模式不取值，写 `-`）。
- `fallback`：兜底返回值，**取值等于 fallback 的条目不发射分支**（由兜底覆盖）。`name` 表示返回入参本身；`-` 表示无（`pred` 模式固定 `return <末组条件>;`）。
- `mode`：
  - `pred` — 谓词。按名字**首字母**分组，前 n−1 组发 `if (<或链>) {\n    return true;\n}`，末组发 `return <或链>;`。
  - `group1` — 按 `col` 取值分组，组序 = 取值在表中的首现序，单行体 `if (<或链>) { return V; }`。
  - `group2` — 同 `group1` 但多行体，末尾附 `return <fallback>;`。
  - `each` — 不分组，逐条发 `if (name == "X") { return V; }`，末尾附 `return <fallback>;`。
- `region`：所属 `GEN:` 生成区间名。同一区间内的函数按表序发射、函数间空一行。区间拆成四段只为贴合各函数在 `tc.tc` 中的既有位置，不影响语义。

```ebnf
ScalarFnTable ::
  // @sfn is_scalar_name bool   pred   scalar -      -    scalar_pred
  // @sfn is_int_name    bool   pred   int    -      -    scalar_bits
  // @sfn is_float_name  bool   pred   float  -      -    scalar_bits
  // @sfn get_bw         i64    group2 all    bw     -1   scalar_bits
  // @sfn scalar_to_c    string each   all    c      name scalar_ctype
  // @sfn scalar_to_ll   string group1 all    ll     i64  scalar_llmap
  // @sfn ll_bits        i64    group1 all    llbits 64   scalar_llmap
```

### 2.11 Type rules（类型检查器规则表）✅ tote

类型检查器中「AST 节点种类 → 类型」的**规律分支**收敛为两张表：`TypeRuleTable` 描述 `infer_expr`（表达式类型推断）与 `resolve_ti`（类型标注求解）的定型规则，`DeclRegTable` 描述 `register_decl`（顶层声明注册符号表）的注册规则。

两个函数中依赖上下文的分支（整数字面量按值选宽、标识符查作用域、二元运算符的同型约束与隐式转换诊断、成员/下标/字面量的结构遍历等）**不在表内**，仍是手写代码：它们不是「查表得类型」，而是带控制流与诊断副作用的算法。表只吃掉真正规律的那部分。

`// @trule <region> <fn> <kind> <mode> <a1> <a2> <a3>`：

| 列 | 含义 |
|---|---|
| `region` | 所属 `GEN:` 区间名（区间拆分只为贴合各分支在 `tc.tc` 中的既有位置） |
| `fn` | `infer` = `infer_expr`（表达式）/ `resolve` = `resolve_ti`（类型标注） |
| `kind` | 匹配的 AST 节点种类，对应 §2.9 `NodeTable` |
| `mode` | 结果类型的构造方式，见下 |
| `a1..a3` | 模式参数，缺省填 `-` |

参数取值约定：以 `n.` 开头视为**代码**（读节点槽），否则视为**字符串字面量**。

- `mk <K>` — `ti_mk("<K>")`
- `scalar <N>` — `ti_scalar("<N>")`
- `named <K> <name>` — `ti_named("<K>", <name>)`
- `und <K> <name> <und>` — `ti_with_und("<K>", <name>, <und>)`
- `elem <K> <slot>` — `ti_elem_of("<K>", <递归函数>(<slot>))`，递归函数由 `fn` 列决定
- `rec <fn2> <slot>` — `<fn2>(<slot>)`，透传或改派到另一个求解函数

发射体固定为 `if (n.kind == "<kind>") {` + `return <表达式>;` + `}`。

```ebnf
TypeRuleTable ::
  // @trule type_infer1  infer   float      scalar f64        -           -
  // @trule type_infer1  infer   string     mk     String     -           -
  // @trule type_infer1  infer   bool       scalar bool       -           -
  // @trule type_infer1  infer   null       mk     Unknown    -           -
  // @trule type_infer2  infer   struct_lit named  Struct     n.sa        -
  // @trule type_infer2  infer   cast       rec    resolve_ti n.nb        -
  // @trule type_infer2  infer   paren      rec    infer_expr n.na        -
  // @trule type_infer2  infer   comptime   rec    infer_expr n.na        -
  // @trule type_slice   resolve slice      elem   Slice      n.na        -
  // @trule type_resolve resolve variant    mk     Variant    -           -
  // @trule type_resolve resolve flag       und    Flag       <anonymous> n.sa
  // @trule type_resolve resolve flag_set   named  FlagSet    <anonymous> -
  // @trule type_resolve resolve pointer    elem   Pointer    n.na        -
  // @trule type_resolve resolve optional   elem   Optional   n.na        -
```

`// @dreg <kind> <symkind> <mode> <a1> <a2> <post>` 生成 `register_decl` **整个函数**。每条发射
`if (n.kind == "<kind>")` 块，块内调用 `sym_define(global_scope, n.sa, "<symkind>", <类型>, d);` 后 `return;`。

- `symkind`：符号类别 `type` / `func` / `var` / `const`。
- `mode`：`named <K>` → `ti_named("<K>", n.sa)`；`und <K> <und>` → `ti_with_und("<K>", n.sa, <und>)`；
  `res <slot>` → `resolve_ti(<slot>)`；`optres <slot> <K>` → 槽为空时退化到 `ti_mk("<K>")`（经临时变量 `cti`）。
- `post`：注册后追加调用的钩子（`-` 表示无）。`VariantDecl` 借此登记 case 的合成构造器/判别器符号。

```ebnf
DeclRegTable ::
  // @dreg StructDecl      type  named  Struct  -       -
  // @dreg EnumDecl        type  und    Enum    n.sb    -
  // @dreg FlagDecl        type  und    Flag    n.sb    -
  // @dreg FlagSetDecl     type  named  FlagSet -       -
  // @dreg UnionDecl       type  named  Union   -       -
  // @dreg VariantDecl     type  named  Variant -       register_variant_helpers
  // @dreg FuncDecl        func  named  Func    -       -
  // @dreg GlobalVarDecl   var   res    n.na    -       -
  // @dreg GlobalConstDecl const optres n.na    Unknown -
  // @dreg TypeAliasDecl   type  res    n.na    -       -
```

### 2.12 Type descriptors（emitter 类型描述符分派表）✅ tote

emitter 侧 `resolve_type_desc` / `expr_type_desc` 的 `td_*` 单行分派规则。
每行 `// @tdrule <region> <indent> <key> <match> <style> <mode> <a1> <a2>`：

| 列 | 含义 |
| --- | --- |
| `region` | 所属 GEN 区间名（`td_scalar` / `td_rslice` / `td_rnamed` / `td_expr1` / `td_expr2` / `td_calls`） |
| `indent` | 发射缩进空格数（4 / 8 / 12） |
| `key` | 守卫左值代码（`n.kind` / `n.sa` / `cn`），`-` = 无守卫 |
| `match` | 守卫比较的字符串字面量，`-` = 无守卫 |
| `style` | `one` 单行 if / `blk` 三行 if 块 / `def` 裸 return（区间兜底） |
| `mode` | `mk` → `td_mk("a1")`；`named` → `td_named_mk("a1", a2)`；`elem` → `td_elem_mk("a1", a2)`；`rec` → 直接 `return a1;` |
| `a1` `a2` | 参数：含 `(` 或以 `n.` 开头视为代码，否则为字符串字面量；`-` = 无 |

划界：`resolve_type_desc` 的 map 分支（多语句算法块）与 `expr_type_desc` 的
ident/index/call 尾部/binary/member 分支（作用域查找、结构遍历、诊断逻辑）留手写。

```ebnf
TdRuleTable ::
  // @tdrule td_scalar 8  n.sa   string        one mk    string -
  // @tdrule td_scalar 8  n.sa   void          one mk    void   -
  // @tdrule td_scalar 8  n.sa   StringBuilder one named named  TSb*
  // @tdrule td_scalar 8  -      -             def named scalar n.sa
  // @tdrule td_rslice 4  n.kind slice         blk elem  slice  resolve_type_desc(n.na)
  // @tdrule td_rnamed 4  n.kind named         blk named named  n.sa
  // @tdrule td_expr1  4  n.kind string        one mk    string -
  // @tdrule td_expr1  4  n.kind int           one named scalar i64
  // @tdrule td_expr1  4  n.kind float         one named scalar f64
  // @tdrule td_expr1  4  n.kind bool          one named scalar bool
  // @tdrule td_expr2  4  n.kind paren         blk rec   expr_type_desc(n.na) -
  // @tdrule td_expr2  4  n.kind cast          blk rec   resolve_type_desc(n.nb) -
  // @tdrule td_calls  12 cn     file_read_all one mk    string -
  // @tdrule td_calls  12 cn     path_resolve  one mk    string -
  // @tdrule td_calls  12 cn     str_len       one named scalar u64
  // @tdrule td_calls  12 cn     slice_len     one named scalar u64
  // @tdrule td_calls  12 cn     str_at        one named scalar u8
  // @tdrule td_calls  12 cn     args          blk elem  slice  td_mk("string")
  // @tdrule td_calls  12 cn     file_write_all one named scalar bool
  // @tdrule td_calls  12 cn     file_exists   one named scalar bool
  // @tdrule td_calls  12 cn     str_slice     one mk    string -
  // @tdrule td_calls  12 cn     sb_to_str     one mk    string -
  // @tdrule td_calls  12 cn     int_to_str    one mk    string -
  // @tdrule td_calls  12 cn     sb_new        one named named  TSb*
  // @tdrule td_calls  12 cn     map_has       one named scalar bool
  // @tdrule td_calls  12 cn     map_del       one named scalar bool
  // @tdrule td_calls  12 cn     map_len       one named scalar i64
  // @tdrule td_calls  12 cn     map_set       one mk    void -
  // @tdrule td_calls  12 cn     map_new       one mk    map -
  // @tdrule td_calls  12 cn     ti_name       one mk    string -
  // @tdrule td_calls  12 cn     fi_name       one mk    string -
  // @tdrule td_calls  12 cn     fi_type_name  one mk    string -
  // @tdrule td_calls  12 cn     ti_size       one named scalar i64
  // @tdrule td_calls  12 cn     ti_kind       one named scalar i64
  // @tdrule td_calls  12 cn     ti_field_count one named scalar i64
  // @tdrule td_calls  12 cn     fi_offset     one named scalar i64
  // @tdrule td_calls  12 cn     fi_type_size  one named scalar i64
  // @tdrule td_calls  12 cn     ti_field      one named fieldinfo FieldInfo
  // @tdrule td_calls  12 cn     fi_is_ptr     one named scalar bool
```

## 3. Syntax（语法）

### 3.1 Items（顶层条目）

> 本节气法由 `decl.md` / `decl_var.md` / `decl_struct.md` / `decl_enum.md` / `decl_flag.md` / `decl_variant.md` / `decl_typealias.md` / `decl_import.md` / `decl_func.md` 经 L-15 采用并并入（原草稿已标记失效）。`match.md` 的函数子句声明形式已于 2026-08-01 用户指令对齐为本节气法（L-04 声明层张力已消解）；match 表达式与函数子句的完整语义**已在 `src/tc.tc` 实装且门禁覆盖**（L-14 已满足），但据 L-15 第5条仍需用户显式「规则采纳」方可并入本手册，故 `match.md` 现维持 DRAFT **待采纳**（而非「未实现」）。函数声明形式固定为 `Name fn(...) -> Ret`（并置式、禁止重载），与 `src/tc.tc` 一致。

```ebnf
ModuleItem:
      FuncDecl
    | StructDecl
    | EnumDecl          // ⚠ spec-only
    | FlagDecl          // ✅ tote
    | VariantDecl       // ✅ tote
    | UnionDecl         // ⚠ spec-only
    | GlobalVarDecl
    | ConstDecl
    | InnerAttribute

FuncDecl:
    FuncName "fn" "(" (Param ("," Param)*)? ")" "->" Type FuncAnns? Block

FuncName: IDENTIFIER
Param:    ParamName ":" Type
```

- 函数**必须**用 `Name fn(...) -> Ret { ... }` 并置形式声明（spec §1.3：参数类型后置、禁止重载、禁止隐式返回、所有分支显式 `return`）。
- ✅ tote：已支持 `fn` 声明、`@main` 入口、`@test` 等注解；`enum` 完整语义、`union` 标记但未实装。

```ebnf
StructDecl:
    StructName "struct" StructAnns? "{" (StructField ";")* "}"

StructField:
    FieldName ":" Type (Annotation)*

StructAnns:
    "@derive" "(" DeriveCap ("," DeriveCap)* ")"
```

- 字段以 `;` 结尾；字段可挂 `@doc` / `@export` / `@binary_offset(N)` / `@binary_skip` 等注解。
- ⚠ spec-only：`@derive` 全能力（当前 tc 的 `@derive` 处理函数体为空壳/带已知 bug，见 `src/tc.tc` `process_derive`）。

```ebnf
FlagDecl:
    FlagName "flag" "[" IntType "]" "{" (FlagSlot ";")* "}"

FlagSlot:
    SlotName ":" Digits FlagSlotAnns?

FlagSlotAnns:
    "@offset" "(" Digits ")"
```

- ✅ tote 已实现 `flag[T]`：自上而下自动分配比特；`@offset(N)` 强制起始位；1bit 布尔位允许位运算、≥2bit 数值位域仅用 `flag_set/flag_get`。
- ⚠ spec-only：`flag_set` 动态变长容器 `flag_set { ... }`（超出 u64 时使用）。

```ebnf
VariantDecl:
    VariantName "variant" "{" (VariantCase ";")* "}"

VariantCase:
      CaseName "(" Type ("," Type)* ")"      // 携带载荷
    | CaseName                               // 单元 case
```

- ✅ tote：已实装 variant，编译器为每个 case 生成 `Name_from_CaseX`、`Name_is_CaseX`、`Name_as_CaseX` 自由函数（`_tag` 为声明下标，0 起）。
- ⚠ spec-only：Variant 上 `@derive` 暂未支持。

### 3.2 Annotations（注解） ✅ tote（注册表已数据化）

> 本节气法由 `annotation.md` 经 L-15 采用并并入（原草稿已标记失效）；部分注解语义仍为 spec-only。

```ebnf
Annotation:
    "@" AnnName ("(" AnnArg ("," AnnArg)* ")")?

AnnName: IDENTIFIER
AnnArg:  Expression | StringLiteral
```

注解可挂于类型、字段、函数、全局节点；全部经 `type_info(T)` 编译期自省读取（⚠ `type_info` 内建尚未接入）。当前 tc `init_anndefs` 已表驱注册全量注解（spec §4.8）：

- 测试类：`@test` `@test_skip` `@test_only` `@expect_fail` `@test_group("分组")`
- 派生类：`@derive(ToString,FromString,Clone,Copy,DebugPrint,BinarySerde,Eq,Hash)`
- 条件编译：`@cfg()` `@cfg_attr()` ⚠ spec-only
- 警告管控：`@allow()` `@warn()` `@deny()` `@deprecated("提示")` ⚠ spec-only
- 布局/ABI：`@repr()` `@no_padding` `@align()` `@binary_offset` `@binary_skip` `@bitpack(T)` `@offset(N)` `@soa` `@aos` ⚠ 多数为 spec-only
- 函数约束：`@inline` `@no_inline` `@must_use` `@const_fn` `@unsafe` `@main` `@export_symbol` `@link_name` `@panic_handler` `@doc` `@doc_file`

### 3.3 Statements（语句） ✅ tote（核心）

> 本节气法由 `stmt.md` / `stmt_var.md` / `stmt_control.md` / `stmt_defer.md` / `stmt_comptime.md` 经 L-15 采用并并入（原草稿已标记失效）；`DeferStatement` 已实装、`ComptimeStatement` 为 partial。

```ebnf
Statement:
      ";"                                   // 空语句（仍须分号）
    | VarDeclStatement
    | ConstDeclStatement
    | AssignStatement
    | ExpressionStatement
    | IfStatement
    | WhileStatement
    | ForStatement                           // ✅ tote
    | ReturnStatement
    | BreakStatement                         // ✅ tote
    | ContinueStatement                      // ✅ tote
    | DeferStatement                         // ✅ tote（已实装，L-15 采用）
    | ComptimeStatement                      // ⚠ partial（块节点已定义，表达式级语义 spec-only）
    | Block

Block: "{" Statement* "}"                   // 语句块
VarDeclStatement:   "var" Ident ":" Type ("=" Expression)? ";"
ConstDeclStatement: "const" Ident ":" Type "=" Expression ";"
AssignStatement:    Expression "=" Expression ";"
ReturnStatement:    "return" Expression? ";"
ExpressionStatement: Expression ";"
DeferStatement:     "defer" Block            // 延迟块，作用域退出时按 LIFO 执行
ComptimeStatement:  "comptime" Block         // 编译期块（块内语句编译期求值）
```

**语句强制规则（spec §1.2）：**

- `if/for/while` **强制大括号**包裹，禁止单行省略。
- 语句必须以 `;` 结尾。
- 禁用三元运算符、`do-while`、`goto`。
- 多优先级运算必须手动加括号。
- 禁止隐式布尔判定：条件必须显式比较（如 `if ((mask & F.x) != 0) { }`）。
  适用范围为**全部条件位置**：`if` / `while` / `for` 的条件，以及 `match` 的 `when` 守卫。
  判据是白名单——唯 `bool` 合法，`Unknown` 放行以免级联；`string`/`slice`/`struct`/`enum`/`func`
  一律报 `T_STMT_IMPLICIT_BOOL`。（2026-08-02 前的实现只拦标量，非标量静默漏过，已修复。）

```ebnf
IfStatement:
    "if" "(" Expression ")" Block ("else" Block)?

WhileStatement:
    "while" "(" Expression ")" Block

ForStatement:                                        // ✅ tote
      "for" "(" Ident "in" Expression ")" Block      // for-each（迭代切片，元素只读拷贝）
    | "for" "(" ForInit? ";" Expression? ";" Expression? ")" Block   // C 风格三段式

ForInit:
      VarDeclStatement                               // var/const 声明（自带分号）
    | ConstDeclStatement
    | Expression ";"

// 🚫 SwitchStatement / SwitchCase / SwitchDefault 已于 2026-08-01 废弃并从本文法删除。
//    多路分支改用 match 表达式（已实装，规则见草稿 docs/syntax/drafts/match.md，待采纳后并入本节）。

BreakStatement:    "break" ";"                       // ✅ tote
ContinueStatement: "continue" ";"                    // ✅ tote
```

- ✅ tote：`if/else`、`while`、`for`（C 风格三段式，init 支持 `var` 声明）、`break`、`continue` 均已实装（含 LLVM 后端）。⚠ `switch`/`case`/`default` 已于 2026-08-01 废弃(deprecated)并从编译器删除，由 `match` 表达式取代（见草稿 `docs/syntax/drafts/match.md`）；实测示例见 `build/lltest/stmt_probe.tc`（已改写为 `if/else`）。

### 3.4 Expressions（表达式） ✅ tote（核心）

> 本节气法由 `expr.md` 及其细分草稿 `expr_binary.md` / `expr_unary.md` / `expr_postfix.md` / `expr_literal.md` 经 L-15 采用并并入（原草稿已标记失效）。

```ebnf
Expr: AssignExpr                                    // 顶层为赋值表达式，右结合

// 赋值（右结合，允许 a = b = c）
AssignExpr: OrExpr ("=" AssignExpr)?

// —— 二元运算符优先级塔（从低到高，全部左结合）——
OrExpr:    AndExpr ("||" AndExpr)*
AndExpr:   BitOrExpr ("&&" BitOrExpr)*
BitOrExpr: BitXorExpr ("|" BitXorExpr)*
BitXorExpr: BitAndExpr ("^" BitAndExpr)*
BitAndExpr: EqExpr ("&" EqExpr)*
EqExpr:    CmpExpr ("==" | "!=" CmpExpr)*
CmpExpr:   ShiftExpr ("<" | ">" | "<=" | ">=" ShiftExpr)*
ShiftExpr: AddExpr ("<<" | ">>" AddExpr)*
AddExpr:   MulExpr ("+" | "-" MulExpr)*
MulExpr:   UnaryExpr ("*" | "/" | "%" UnaryExpr)*

// 前缀一元（右结合，可堆叠：!!x、--x、~~x）
UnaryExpr: ("!" | "-" | "~") UnaryExpr | PostfixExpr

// 后缀（左结合，可堆叠）；`as` 仅在后缀循环结束后出现一次
PostfixExpr:
    PrimaryExpr (("." ident) | ("[" Expr "]") | ("(" Args? ")"))*
    ("as" Type)?

Args: Expr ("," Expr)*

// —— 字面量与基本表达式（primary）——
PrimaryExpr:
    | IntLit
    | FloatLit
    | StrLit
    | BoolLit
    | NullLit
    | IdentExpr
    | TypeInfoExpr
    | StructLit
    | ArrayLit
    | MapLit
    | FuncLit                 // ✅ tote 匿名函数字面量（M46）
    | "(" Expr ")"            // 仅分组，非元组

IntLit:   integer            // 十进制；0x 前缀十六进制；0b 前缀二进制
FloatLit: float
StrLit:   string
BoolLit:  "true" | "false"
NullLit:  "null"
IdentExpr: ident
TypeInfoExpr: "type_info" "(" ident ")"      // 编译期类型信息内建
StructLit: ident "{" (ident ":" Expr ("," ident ":" Expr)*)? "}"
ArrayLit:  "[" (Expr ("," Expr)*)? "]"
MapLit:    "[" (Expr ":" Expr ("," Expr ":" Expr)*)? "]"   // 当首元素后跟 ":"
FuncLit:   "fn" "(" ParamList? ")" "->" Type Block         // 匿名函数；静态类型即同签名 FuncType
```

- **优先级塔固定（L-03 可预判）**：`||` 最低、`*`/`/`/`%` 最高，10 级全部左结合；赋值 `=` 右结合；无右结合二元运算符。塔层级与 `src/tc.tc` 的 `parse_or → … → parse_mul → parse_unary → parse_postfix → parse_primary` 一一对应，不可调换。
- **全行为显式（L-02）**：`as` 为唯一显式类型转换（仅一次、不可 `e as T1 as T2`）；无隐式类型转换 / 隐式布尔 / 隐式内存分配；复合字面量（数组 `[...]` / map `[k:v]` / 结构体 `T{...}`）显式构造。
- **静态类型安全（L-03）**：每个 `Expr` 的静态类型由 checker 推算；元素 / 字段 / 下标 / `type_info` 静态校验；`MapLit` 与 `ArrayLit` 共用 `[ ]`，由首元素后是否跟 `:`` 向前看消歧（无二义）。
- **唯一写法（L-04 ✅）**：调用 `f(x)`、转换 `e as T`、下标 `e[i]`、成员 `e.f`、结构体 `T{...}`、数组 `[...]`、map `[k:v]`、匿名函数 `fn(...) -> T {...}` 均仅一种标准写法，无等价多写变体。
- **匿名函数字面量 `FuncLit`** ✅ tote（M46）：与函数**声明**靠「`fn` 前有无名字」区分——声明位先吃名字（`Name fn(...)`），表达式位裸 `fn` 即字面量，无二义。返回类型不可省（`-> Ret` 必写，与声明一致，L-02 全行为显式）。语义与限制见 §3.5。
- `>>>` 注意：比较/移位序列中 `>>` 不得被词法拆成两个 `>`。

### 3.5 Types（类型） ✅ tote（核心）

> 本节气法由 `types.md` 经 L-15 采用并并入（原草稿已标记失效）；`FuncType` 已于 FuncType 实装里程碑落地（✅ tote，函数指针语义），M46 补齐匿名函数字面量。

```ebnf
Type:
      Scalar
    | ArrayType
    | SliceType
    | MapType
    | PointerType
    | OptionalType
    | FlagArrayType
    | NamedType
    | SymType                           // ✅ tote 字符串驻留符号 Sym32("tag")/Sym16("tag")
    | FuncType                          // ✅ tote 函数类型（一等值 / 函数指针语义）

Scalar: "u8" | "u16" | "u32" | "u64"
      | "i8" | "i16" | "i32" | "i64"
      | "f16" | "f32" | "f64" | "bool" | "void" | "string" | "StringBuilder"
ArrayType: "[" Expr "]" Type          // 定长数组 [N]T
SliceType: "[" "]" Type               // 动态切片 []T
MapType: "map" "[" Type "]" Type      // 哈希映射 map[K]V  ✅ tote
PointerType: "*" Type                 // 指针 *T
OptionalType: Type "?"                // 可选 T?
FlagArrayType: "flag" "[" Integer "]" // 位域数组 flag[N]
NamedType: Ident                      // 结构体/枚举/flag/variant/别名名
SymType: "Sym" ("32"|"16") "(" StringLiteral ")"
FuncType: "fn" "(" TypeList? ")" "->" Type   // ✅ tote 函数类型（函数指针语义：仅顶层具名函数可绑定）
TypeList: Type ("," Type)*
```

- ✅ tote：标量固定位宽 + `string`/`StringBuilder` + `[]T` 切片 + `[N]T` 定长数组 + `map[K]V` 哈希映射 + `fn(...) -> Ret` 函数类型均实装（函数类型 v1 为函数指针语义：仅顶层具名函数可被绑定到函数类型变量 / 参数 / 返回值 / 结构体字段 / 全局变量；支持间接调用，诊断 T_CALL_ARITY / T_NOT_CALLABLE / T_TYPE_MISMATCH）。
- **匿名函数字面量 `fn(...) -> Ret { ... }`** ✅ tote（M46）：表达式位的函数字面量，静态类型即同签名 `FuncType`，可赋给函数类型变量 / 作实参 / 作返回值 / 存结构体字段。
  - 字面量在脱糖期被**提升**为顶层合成函数 `__lam_N`。**未引用外层局部**时原节点就地降级为对该函数的引用，完全复用函数指针路径，双后端无额外开销、无堆分配。
- **闭包：按值捕获** ✅ tote（M48）：字面量若引用了外层作用域的局部/参数，编译期自动捕获。
  - 脱糖为三件事：① 合成环境结构 `__env_N`，字段按「自由变量首次出现顺序」排列；② 提升后的 `__lam_N` 前置一个 `void*`/`ptr` 类型的 env 首参，函数体首插入若干 `closure_capture` 语句把环境字段**按值**拷回同名局部；③ 原表达式位置改写为「堆分配 `__env_N` + 逐字段拷入 + 堆分配 `TClosure{fn, env}` + 返回其指针」。
  - **按值语义**：捕获发生在闭包构造那一刻。闭包创建之后外层变量再改变，不回灌到闭包；闭包内改动也不外泄。
  - **统一 ABI**：无论有无捕获，函数值一律是 `TClosure*`（C）/ `ptr`（LLVM），底层被调函数一律 `Ret (*)(void* env, Args...)`。无捕获的顶层函数取值时经惰性生成的 trampoline 适配（`__tramp_g` + 静态 `TClosure`，env 为 `NULL`），故两条路径可自由互赋、互传。
  - **生命周期（v1 限制）**：环境与 `TClosure` 用 `t_alloc` 堆分配且**不回收**（有意为之，先泄漏）。自动释放需引入所有权或 GC，属后续里程碑。
  - **可捕获的前提**：被捕获的绑定必须有显式类型标注，否则报 `T_CLOSURE_CAPTURE`（环境结构无法为其定型）。典型不可捕获者是 `for-each` 的迭代变量——先赋给带标注的局部再捕获即可。
  - 引用一个既不在闭包内、外层也不存在的名字，报 `T_UNDEFINED_IDENT`（而非捕获错误）。
  - **调用点的被调者可以是任意表达式**（M48）：不限于裸标识符。结构体字段 `h.op(4)`、数组/切片元素 `fs[i](x)`、上一次调用的结果 `make2(1)(2)(3)` 都能直接发起间接调用——只要该表达式的静态类型是 `FuncType`。裸标识符若解析到顶层具名函数则仍走直接调用；否则按函数值解包。此前非标识符被调者在 LLVM 后端会静默降级为 `; UNSUPPORTED call target` 并返回 0，在 C 后端则编不过。
- **未定义标识符报 `T_UNDEFINED_IDENT`**（M46）：此前 checker 对解析不到的标识符静默退化为 `Unknown`，错误要到 C 后端生成的 `.c` 才暴露，LLVM 后端更直接产出读 0 的垃圾值（静默错编）。现于检查期即报错。同批补上 `T_VAR_NO_TYPE`：局部 `var` 必须写类型标注（发射侧以有标注为前提，无标注声明会被整条丢弃）。
- **map 字面量 `[k1: v1, k2: v2]`**：键/值类型取首项推断，整型统一提升为 `i64`（同数组字面量）。仅作为局部 `var` 的初始化器发射：C 后端脱糖为 `t_map_new` + 逐项局部量 + `t_map_put`，LLVM 后端为 `tll_map_new` + 逐项 `tll_map_put`。`var m: map[K]V;` 无初始化时同样建空表。整型键一律按 `int64` 落盘（C 用 C99 复合字面量 `&(int64_t){…}`，LLVM 用 `alloca i64` + 扩宽），故窄整型键不会因高位垃圾而失配，键/值也可以直接写字面量。
- 类型名解析：先查内建，再查当前单元已声明命名类型。
- **数组字面量 `[e1, e2, …]`**：元素类型取首元素推断，整型元素统一提升为 `i64`（`[1,2,3]` 是 `[3]i64` 而非 `[3]u8`）；空字面量 `[]` 元素类型未知，可赋给任意 `[]T` / `[N]T`。定长数组与切片之间只要元素可转型即可互赋（目标为定长数组时长度须一致）。赋给 `[]T` 时脱糖为运行期 `slice_new` + 逐元素 `append`；赋给 `[N]T` 时 C 后端用花括号初始化器、LLVM 后端零初始化后按 `getelementptr` 逐元素 `store`。

- **字符串驻留符号 `Sym32("tag")` / `Sym16("tag")`** ✅ tote（M40）：字段仅存 32/16 位无符号 id；真实字符串按 tag 分池、运行期不定长存储，由编译器自动维护。`= "str"` 自动 intern 取 id；同池相同字符串去重返回同一 id；`==`/`!=` 按 id 比较（O(1)）；跨池（`Sym32("A")` vs `Sym32("B")`）类型不同，互相赋值报 `T_TYPE_MISMATCH`（f15）；全局变量字符串初始化器自动搬进 `t__ginit`/`t.__ginit`（C / LLVM 双后端一致）。内建 API 与类型规则见 §3.8。

### 3.6 Comptime & introspection（编译期与自省） ⚠ spec-only（设计目标）

> 本节气法由 `stmt_comptime.md` / `decl_import.md` / `decl.md`（comptime 项）经 L-15 采用并并入（原草稿已标记失效）；表达式级 `comptime` 语义仍为 spec-only。

```ebnf
ComptimeFunc: "comptime" Ident "fn" ...       // 与运行时同写法，编译期执行
TypeInfoExpr: "type_info" "(" Type ")"        // 编译期类型自省（字段/偏移/位宽/注解）
```

- spec §5：`comptime` 函数语法与运行时一致。
- `type_info(T)` 是 `@derive`、序列化、编辑器导出、CTFE 导入的**核心底座**，当前 tc 的 `TypeInfo` 池为简化版、内建未接入。

### 3.6.1 CTFE 数据导入（import_csv / import_json） ✅ tote

```ebnf
ImportExpr:   "import_csv" "(" StringLiteral ")" | "import_json" "(" StringLiteral ")"
```

编译期（检查阶段，register 之后、类型推导之前）读取外部数据文件并脱糖为静态加载函数。

**语义规则**：
1. **唯一合法上下文**：局部 `var x: []S = import_csv("path");`（或 `import_json`），其中 `S` 是已声明的 struct、显式写出 `[]S` 类型标注。出现在任何其他位置（表达式中段、全局、无标注、非 slice-of-struct 目标）报 `T_IMPORT_CONTEXT`。
2. **路径解析**：相对路径相对**源文件所在目录**解析；文件不存在或不可读报 `T_IMPORT_IO`。
3. **CSV 映射**：首行为表头，表头名须与 `S` 的字段名**一一对应**（顺序可异、不可缺、不可多），否则报 `T_IMPORT_HEADER`。单元格按逗号切分，不支持引号转义（值内不得含逗号）。
4. **JSON 映射**：顶层须为对象数组，每个对象的键集合须与 `S` 字段名一致，否则报 `T_IMPORT_HEADER`。
5. **值校验（编译期）**：整型字段做位宽值域校验（如 `u8` 越界 256 报错）；`bool` 只接受 `true`/`false`；float 接受十进制小数；string 原样取值。违规报 `T_IMPORT_VALUE`，消息含行列与字段名。字段类型仅支持标量与 string（enum/嵌套 struct 暂不支持，报 `T_IMPORT_VALUE`）。
6. **脱糖产物**：每个导入点合成一个 `__import_N fn() -> []S` 加载函数（append 逐行 struct 字面量）挂入 decl_list 尾部，原初始化器替换为对该函数的调用。运行时零文件 IO。

**诊断码**：`T_IMPORT_IO`（文件读取失败）、`T_IMPORT_HEADER`（表头/键映射不匹配）、`T_IMPORT_VALUE`（值域/类型违规）、`T_IMPORT_CONTEXT`（非法使用上下文）。

### 3.7 Flag builtins（位域内建函数） ✅ tote

> 本节气法由 `builtins.md`（Flag 段）经 L-15 采用并并入（原草稿已标记失效）。

```ebnf
FlagSetCall: "flag_set" "(" FlagInstance "," SlotName "," IntegerLiteral "|" Expression ")"
FlagGetCall: "flag_get" "(" FlagInstance "," SlotName ")"
```

- 1bit 单比特布尔位：允许 `| & ^ |= &= ^=`，布尔判断须完整非零比较。
- ≥2bit 数值位域：**禁止**直接位运算，仅用 `flag_set` / `flag_get`；越界双层校验（常量编译报错，变量运行时报错 + JSON 修复建议）。

---

### 3.8 Sym builtins（字符串驻留符号）✅ tote

> 本节气法由 `builtins.md`（Sym 段）经 L-15 采用并并入（原草稿已标记失效）。

```ebnf
SymStrCall:  "sym_str"  "(" SymExpr ")"
SymReleaseCall: "sym_release" "(" StringLiteral ")"        // 释放指定 tag 整池
SymReleaseAllCall: "sym_release_all" "(" ")"               // 释放全部池
// 内部（编译器在 `= "str"` 时自动插入，用户不直接调用）：t_sym_intern(tag, str, bits) -> id
```

- `sym_str(v)`：由变量 `v` 的 Sym 类型推出所属 tag，返回该池中 id 对应的原始字符串（`String`）。`Sym16` 的 id 在内部归一到 i32。
- `sym_release("<tag>")`：释放 `<tag>` 对应的整池（区域结束语义）；之后同 tag 的 intern 可重新使用。
- `sym_release_all()`：经全局 `Symbols` 注册表遍历释放所有剩余池。
- 内建 `sym_intern` 由编译器在「`Sym = 字符串`」赋值时自动插入，用户无需手写（手动调用亦可）。
- 类型规则：`Sym32("A")` 与 `Sym32("B")` 视为不同类型（跨池禁止，f15）；`Sym` 与 `string` 之间仅允许 `Sym = "str"` 方向（自动 intern），反向取字符串须用 `sym_str`。

---

## 4. Program entry（程序入口） ✅ tote

```ebnf
EntryPoint: FuncDecl with "@main" annotation
```

- 可用 `@main` 显式标记入口（替代固定名 `main`）：`app_entry fn() -> i32 @main { ... }`。
- tc 代码生成：被 `@main` 标记的函数发射为 `int32_t t_entry_<name>(void)`，并在生成的 `int main()` 中按序调用 `t_runtime_init` → `t_runtime_set_arena` → `t_entry_<name>()` → `t_runtime_done()`，返回退出码。

---

## 5. Grammar summary（文法总览）

```ebnf
TranslationUnit : ModuleItem*
ModuleItem      : FuncDecl | StructDecl | FlagDecl | VariantDecl
                | GlobalVarDecl | ConstDecl | InnerAttribute
FuncDecl        : Ident "fn" "(" Params? ")" "->" Type Anns? Block
StructDecl      : Ident "struct" Anns? "{" Field* "}"
FlagDecl        : Ident "flag" "[" IntType "]" "{" Slot* "}"
VariantDecl     : Ident "variant" "{" Case* "}"
Block           : "{" Statement* "}"
Statement       : VarDecl | ConstDecl | Assign | If | While | Return | ExprStmt | Block
Expression      : Literal | Ident | Call | FieldAccess | Unary | Binary | "(" Expression ")"
Type            : Scalar | "[]" Type | "[" N "]" Type | NamedType
Annotation      : "@" Ident ("(" ArgList? ")")?
```

---

## 6. Implementation status vs spec（与 tc 实现面对应）

| spec 章节 | 能力 | tc 状态 |
|---|---|---|
| §1 | 基础语法/命名/函数签名 | ✅ 已实现 |
| §2 | 固定位宽标量 + string/StringBuilder | ✅ 已实现 |
| §2.3 | Variant 变体 | ✅ 已实现（自由函数式 helper） |
| §3.1 | struct（@derive 全能力） | ✅ 结构；⚠ @derive 桩 |
| §3.1 | #aos / #soa 布局变换 | ⚠ 仅注释 |
| §3.2 | enum | ⚠ 标记未实装 |
| §4 | 注解系统（注册表） | ✅ 注册表数据化；⚠ 多数语义未接入 |
| §5 | CTFE / type_info(T) 内建 | ⚠ 未接入 |
| §6 | flag[T] 位域 + flag_set/get | ✅ 已实现（含 SlotInfo 自省） |
| §7.2 | 外部数据导入 CSV/JSON（CTFE 脱糖） | ✅ 已实现 |
| §2.3 | 字符串驻留符号 Sym32/Sym16（intern / sym_str / sym_release） | ✅ 已实现（M40） |

> 设计哲学落地：**语法根本源为 `docs/reference.md`**（内含 `ebnf` 产生式块），经 `tools/gen_ebnf.mjs` 生成 `out/ebnf.json`，再由 `src/totter.tc`（已放弃）数据驱动生成 `gen/tc.tc`（冻结快照，见 `src/tc.tc` `kw_lookup` 等标记区间）。⚠ totter 已放弃，此「数据优先」生成管线为历史设计；`src/tc.tc` 现手写维护，`GEN:` 区间为冻结快照。

---

## 7. Toolchain conventions（工具链约定） ✅ tote

本章描述 t 工具链对**任意 t 项目**生效的默认约定，不属于语言语义，但属于实现面的规范性要求。

### 7.1 Default output layout（默认输出目录结构）

所有编译产物统一落在项目根目录下的 `out/`，按构建配置分为两棵平行子树：

```
<project-root>/
├── src/                    # t 源码
├── docs/                   # 文档（语言/项目）
├── tests/                  # 测试
├── examples/               # cargo 风格示例（examples/<name>.tc）
└── out/                    # 编译输出根目录
    ├── dbg/                # 调试构建产物
    │   ├── deps/           # 依赖静态库（t_runtime.lib）
    │   ├── <name>.exe      # 可执行文件
    │   ├── <name>.obj      # 中间目标文件
    │   ├── <name>.ll/.c/.h # 中间产物（LLVM IR / C 后端）
    │   ├── <name>.pdb      # debug 符号信息
    │   └── examples/       # --example 产物
    └── rls/                # 发布优化构建产物
        ├── deps/           # 依赖静态库（优化版）
        ├── <name>.exe      # 可执行程序
        ├── <name>.obj
        └── archive/        # 打包归档文件
```

### 7.2 Build mode（构建模式 `--mode`）

| 模式 | 落盘目录 | 优化档 | 符号 |
|---|---|---|---|
| `dbg`（缺省） | `out/dbg/` | `-O0` | `-gcodeview` → 产出 `.pdb` |
| `rls` | `out/rls/` | `-O2` | 无 |

规范性要求：

1. `--mode` 只接受 `dbg` 与 `rls`；其它取值必须报错并以非 0 退出码终止。
2. 缺省模式为 `dbg`。
3. 缺省输出路径为 `out/<mode>/<模块名>`；`--output <前缀>` 可显式覆盖，覆盖时 `--mode` 只影响优化档，不再影响目录。
4. 该约定对所有产出文件的子命令一致生效：`compile --emit-c`、`emit-ll`、`build`、`run`、`--example`。
5. 输出目录**按需自动创建**，实现不得要求调用方预先 `mkdir`。

### 7.3 Dependency libraries（依赖静态库 `deps/`）

- `build` / `run` 缺省链接 `out/<mode>/deps/t_runtime.lib`（由 runtime C 源码预编译，`dbg` 用 `-O0`、`rls` 用 `-O2`）。
- `--runtime <dir>` 将依赖库来源改为 `<dir>/t_runtime.lib`。
- **回退规则（开箱即用）**：目标 `.lib` 不存在时，实现必须自动回退为直接编译 `runtime/*.c` 源码，使新项目无需预构建步骤即可完成链接。
