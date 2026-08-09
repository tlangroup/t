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
  | "auto" -> KwAuto
  | "any" -> KwAny
  | "type" -> KwType
  | "comptime" -> KwComptime
  | "meta" -> KwComptime
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

> 关键字由 `lex` 阶段查表（`kw_lookup`，基于 `keywords_tbl`）判定。其权威列表即上方 `Keyword` 产生式中的字面量，由 `tools/gen_ebnf.mjs` 抽取生成 `out/ebnf.json`、`src/totter.tc` 解析后生成进 `gen/tc.tc`（totter 已放弃，该区间现冻结于 `src/tc.tc`、手写维护）。`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f16`/`f32`/`f64`/`bool` 为**内建类型名**（见 §3.5），不是关键字。
> ⚠ `meta` 与 `comptime` 同映射到 `KwComptime`（互为别名，`meta` 为推荐拼写）；`type` 与 `any` 同为「类型之类型」占位关键字。见 §3.6.3。
> ⚠ spec-only（设计中、tc 未接入）：`union`、`enum` 完整语义、`comptime`/`meta` 表达式的**编译期求值**（CTFE，Phase B；Phase A 已可解析并降级发射）。

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
  | "format_int" / "format_uint" / "format_float" => ti_mk("String")
  | "format_str" / "format_bool" / "format_char" => ti_mk("String")
  | "sb_append_fmt_int" / "sb_append_fmt_uint" / "sb_append_fmt_float" => ti_mk("Void")
  | "sb_append_fmt_str" / "sb_append_fmt_bool" / "sb_append_fmt_char" => ti_mk("Void")
  | "file_write_all" / "file_exists" => ti_scalar("bool")
  | "args" => ti_elem_of("Slice", ti_mk("String"))
  | "sb_new" => ti_mk("StringBuilder")
  | "map_new" => ti_mk("Map")
  | "map_set" => ti_mk("Void")
  | "map_has" / "map_del" => ti_scalar("bool")
  | "map_len" => ti_scalar("i64")
  | "map_get" => ti_mk("Unknown")   // 返回类型 = 映射的 V，由 infer_expr/expr_type_desc 特判
  | "ti_name" / "fi_name" / "fi_type_name" => ti_mk("String")
  | "ti_size" / "ti_kind" / "ti_field_count" / "fi_offset" / "fi_type_size" / "fi_tag" => ti_scalar("i64")
  | "ti_field" => ti_mk("FieldInfo")
  | "fi_is_ptr" => ti_scalar("bool")
  | "now" => ti_scalar("i64")
  | "format_time" / "format_time_local" / "format_time_tz" => ti_mk("String")
  | "parse_time" / "parse_time_local" => ti_scalar("i64")
  | "time_invalid" => ti_scalar("i64")

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
  | "T_UNKNOWN_FIELD" -> error
  | "T_TAGID_MIXED" -> error
  | "T_TAGID_DUP" -> error

AnnotationTable:
    "test" { spec: "none", targets: "func", repl: "a `\"name\" test { ... }` declaration" }
  | "test_skip" { spec: "none", targets: "func", repl: "@skip" }
  | "test_only" { spec: "none", targets: "func", repl: "@only" }
  | "expect_fail" { spec: "none", targets: "func", repl: "@should_fail" }
  | "test_group" { spec: "string", targets: "func", repl: "a `\"name\" suite { ... }` block" }
  | "skip" { spec: "mixed", targets: "func", repl: "" }
  | "only" { spec: "none", targets: "func", repl: "" }
  | "should_fail" { spec: "none", targets: "func", repl: "" }
  | "tag" { spec: "ident_list", targets: "func", repl: "" }
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
  // @tdrule td_calls  12 cn     format_int    one mk    string -
  // @tdrule td_calls  12 cn     format_uint   one mk    string -
  // @tdrule td_calls  12 cn     format_float  one mk    string -
  // @tdrule td_calls  12 cn     format_str    one mk    string -
  // @tdrule td_calls  12 cn     format_bool   one mk    string -
  // @tdrule td_calls  12 cn     format_char   one mk    string -
  // @tdrule td_calls  12 cn     sb_append_fmt_int   one mk void -
  // @tdrule td_calls  12 cn     sb_append_fmt_uint  one mk void -
  // @tdrule td_calls  12 cn     sb_append_fmt_float one mk void -
  // @tdrule td_calls  12 cn     sb_append_fmt_str   one mk void -
  // @tdrule td_calls  12 cn     sb_append_fmt_bool  one mk void -
  // @tdrule td_calls  12 cn     sb_append_fmt_char  one mk void -
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
  // @tdrule td_calls  12 cn     fi_tag        one named scalar i64
  // @tdrule td_calls  12 cn     ti_field      one named fieldinfo FieldInfo
  // @tdrule td_calls  12 cn     fi_is_ptr     one named scalar bool
```

## 3. Syntax（语法）

### 3.1 Items（顶层条目）

> 本节气法由 `decl.md` / `decl_var.md` / `decl_struct.md` / `decl_enum.md` / `decl_flag.md` / `decl_variant.md` / `decl_typealias.md` / `decl_import.md` / `decl_func.md` 经 L-15 采用并并入（原草稿已标记失效）。`match.md` 的函数子句声明形式已于 2026-08-01 用户指令对齐为本节气法（L-04 声明层张力已消解）；match 表达式与函数子句的完整语义**已在 `src/tc.tc` 实装且门禁覆盖**（L-14 已满足），但据 L-15 第5条仍需用户显式「规则采纳」方可并入本手册，故 `match.md` 现维持 DRAFT **待采纳**（而非「未实现」）。代码模块导入 `ImportDecl` 由 `docs/syntax/drafts/module.md` 经 L-15 采用并并入 §3.13（原草稿已标记失效）。函数声明形式固定为 `Name fn(...) -> Ret`（并置式、禁止重载），与 `src/tc.tc` 一致。

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
    | ImportDecl        // ⚠ spec-only（代码模块导入，语法经 L-15 采纳，实现待排期）

FuncDecl:
    FuncName "fn" "(" (Param ("," Param)*)? ")" ("->")? Type FuncAnns? Block

FuncName: IDENTIFIER
Param:    ParamName ":" Type
```

- 函数用**并置形式** `Name fn(...) Ret { ... }` 声明（spec §1.3：参数类型后置、禁止重载、禁止隐式返回、所有分支显式 `return`）。返回类型前的 `->` 记号**已弃用（deprecated）但仍可选接受**，旧代码 `Name fn(...) -> Ret { ... }` 同样合法。
- ✅ tote：已支持 `fn` 声明、`@main` 入口、`@test` 等注解；`enum` 完整语义、`union` 标记但未实装。

```ebnf
StructDecl:
    StructName "struct" StructAnns? "{" (StructField ";")* "}"

StructField:
    FieldName ":" Type (Annotation)* ( "@" IntLiteral )? ( "=" Expression )? (Annotation)*

StructAnns:
    "@derive" "(" DeriveCap ("," DeriveCap)* ")"
```

- 字段以 `;` 结尾；字段可挂 `@doc` / `@export` / `@binary_offset(N)` / `@binary_skip` 等注解。
- ⚠ spec-only：`@derive` 全能力（当前 tc 的 `@derive` 处理函数体为空壳/带已知 bug，见 `src/tc.tc` `process_derive`）。

#### 3.1.1.1 字段 tagID（`@ N`）与默认值（`= expr`） ✅ tote（M-tagID）

字段声明里除类型与注解外，还可在类型之后挂两个**正交**的编译期槽：

- **tagID `@ N`**：给字段一个稳定的整数身份标识（数据版本迭代兼容用）。`N` 为 `i64` 字面量，须 `≥ 1`。
- **默认值 `= expr`**：给字段一个默认表达式；构造 struct 字面量时若省略该字段，则由编译器在检查期合成该默认值填充（双后端自动受益）。`expr` 类型须可转型为该字段类型，否则报 `T_TYPE_MISMATCH`。

```t
Point struct {
    x: i64 @ 1;
    y: i64 @ 2 = 42;     // 显式 tagID + 默认值
    z: i64 @ 3;
}
Auto struct {             // 全自动：无 @N → tagID 按声明序 1,2,3 隐式分配
    a: i64;
    b: i64 = 7;           // 仅默认值，无 tagID
    c: i64;
}
```

**强制规则（编译期）**：

1. **全有或全无（all-or-nothing）**：同一个 struct 内，要么**所有**字段都显式写 `@ N`，要么**全都不写**。部分写、部分不写 → 报 `T_TAGID_MIXED`。
2. **去重**：显式 tagID 在同一个 struct 内必须唯一，重复 → 报 `T_TAGID_DUP`。
3. **全自动兜底**：不写 `@ N` 时按声明顺序自动分配 `1,2,3,…`（基值 1）。

**关键性质 —— tagID 是纯编译期元数据，运行时零内存成本**：它只活在 `type_info` 的 `FieldInfo.tag`（见 §3.6）与（未来的）序列化线格式里，**不进入 struct 的内存布局**。struct 的字段排布、大小、对齐完全不受 tagID 影响。

**用途**：数据版本迭代兼容。字段改名、重排、增删时，tagID 提供跨变更的稳定身份，使序列化/反序列化能按 id 而非位置/名字识别字段 —— 这是 fid v2 字段级版本化的前置（序列化线格式写入 tag 仍待排期）。

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

#### 3.1.1.2 struct 方法声明语法糖（`Self` + 名字重整）✅ tc（M-M）

struct 体内除字段外还可直接书写**方法声明**，语法与顶层 `FuncDecl` 完全一致。方法在**解析期**被脱糖为顶层自由函数，`struct` 本身仍是**纯数据**（字段表不变、内存布局不变、后端零改动）。

```ebnf
StructDecl:
    StructName "struct" StructAnns? "{" (StructField ";" | StructMethod)* "}"

StructMethod:
    MethodName "fn" "(" (Param ("," Param)*)? ")" ("->")? Type FuncAnns? Block
```

脱糖规则（两条，无例外）：

1. **函数名** = `snake_case(StructName) + "_" + MethodName`，提到顶层。
2. **类型 `Self`** 在方法签名（形参类型、返回类型）与函数体（局部变量类型标注、struct 字面量名）中全部改写为宿主 struct 名。

```t
List struct {
    items: []i64;

    new  fn()    Self                    { var l: Self; return l; }
    push fn(self: Self, v: i64)    Self  { append(self.items, v); return self; }
    len  fn(self: Self)    i64           { return slice_len(self.items); }
}
```

⇓ 等价于

```t
List struct { items: []i64; }
list_new  fn()    List                   { var l: List; return l; }
list_push fn(self: List, v: i64)    List { append(self.items, v); return self; }
list_len  fn(self: List)    i64          { return slice_len(self.items); }
```

约束与说明：

- **没有 receiver 调用语法**。调用一律走自由函数：`list_push(l, 10)`，不是 `l.push(10)`。语法糖只作用于**声明侧**，`.` 仍然只表示字段访问 / 模块限定访问。
- **`self` 不是关键字**，只是形参名的惯例；第一个形参写什么名字、是否存在，编译器都不关心。因此**无 `self` 形参的「静态方法」**（如 `new`）同样合法，脱糖结果一致。
- 字段与方法可**任意交错**书写；方法不进字段表，`type_info` / `@derive` / 二进制布局均不受影响。
- 方法**继承宿主 struct 的 `export` 标记**：`export List struct { ... }` 的所有方法都是模块导出符号，跨模块以 `list.list_push(...)` 访问（重整为 `list__list_push`）。
- 脱糖后的自由函数与手写的同名顶层函数**完全等价**，因此**不得重名**（否则触发重复定义诊断）；同理，方法之间不构成「函数子句组」——名字已按 `struct_方法` 唯一化。
- 实现位置：`src/tc.tc` 的 `parse_struct_decl` / `parse_method_decl` / `desugar_self_node` / `flush_struct_methods`（解析期合成真实 `FuncDecl` 节点并按「宿主 struct 在前、方法在后」的顺序并入 `decl_list`）。
- 参考实现：`examples/lib/list.tc`（切片列表 `List`，10 个方法）+ `examples/list_demo.tc`；conformance `p36_struct_method_ok`。

### 3.2 Annotations（注解） ✅ tote（注册表已数据化）

> 本节气法由 `annotation.md` 经 L-15 采用并并入（原草稿已标记失效）；部分注解语义仍为 spec-only。

```ebnf
Annotation:
    "@" AnnName ("(" AnnArg ("," AnnArg)* ")")?

AnnName: IDENTIFIER
AnnArg:  Expression | StringLiteral
```

注解可挂于类型、字段、函数、全局节点；全部经 `type_info(T)` 编译期自省读取（字段自省内建已接入，见 §3.6.0；注解元数据表驱注册见 `src/tc.tc` `init_anndefs`）。当前 tc `init_anndefs` 已表驱注册全量注解（spec §4.8）：

- 测试类：`@skip` `@only` `@should_fail` `@tag(name, ...)`（见 §3.14）
  - ⚠ 弃用别名（发 `T_ANNOTATION_UNKNOWN` warning，不阻断）：`@test` → `"名字" test { }`；`@test_skip` → `@skip`；`@test_only` → `@only`；`@expect_fail` → `@should_fail`；`@test_group("g")` → `"g" suite { }`
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
    | AutoDeclStatement
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
AutoDeclStatement:   "auto" Ident "=" Expression ";"   // ✅ tc（M-auto）：类型由初始化器推断，禁止显式标注
AssignStatement:    Expression "=" Expression ";"
ReturnStatement:    "return" Expression? ";"
ExpressionStatement: Expression ";"
DeferStatement:     "defer" Block            // 延迟块，**函数级**：登记到当前函数延迟栈，于 return/函数尾按 LIFO 执行（写在 if/while 块内也到函数退出才触发，非块级作用域退出）
ComptimeStatement:  "comptime" Block         // 编译期块（块内语句编译期求值）
```

**`auto` 局部类型推断（✅ tc，M-auto）：**

- 写法：`auto x = 初始化器;`（强制带初始化器、禁止显式类型标注，否则解析期报错）。
- 类型在检查期由初始化器经 `infer_expr` 推断并回填声明节点，使发射侧拿到真实类型节点。
- 与 `var`/`const` 的区别：`var`/`const` **必须**带类型标注（无标注触发 `T_VAR_NO_TYPE`，见 conformance `f27_var_no_type`）；只有 `auto` 走推断。
- 推断规则同表达式字面量：整数字面量 ≤255 → `u8`、≤65535 → `u16`、……（见 `infer_expr`）；故 `auto x = 42` 推断为 `u8` 而非 `i64`，与 `i64` 混合运算需显式 `as i64`。
- 示例：
  ```t
  auto n = 7 as i64;        // n : i64
  auto s = "hello";         // s : string
  auto v = id(i64, 42);     // v : i64（初始化器为泛型单态化调用）
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
    | FormatStringLiteral     // ✅ f-string 字面量（M-fstr）
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

// f-string：解析期就地脱糖为 format(模板, 实参...)，不引入新运行期机制
FormatStringLiteral: ShortFormatString | LongFormatString
ShortFormatString:   "f\"" FormatContent? "\""
LongFormatString:    "f\"\"\"" LongFormatContent? "\"\"\""
FormatContent:       FormatSegment+
LongFormatContent:   LongFormatSegment+
FormatSegment:       FormatTextRun | EscapeBrace | Interpolation
LongFormatSegment:   LongFormatTextRun | EscapeBrace | Interpolation
FormatTextRun:       ( [^{}"\\] | StringEscape )+
LongFormatTextRun:   ( [^{}\\] | "\"" | StringEscape )+
EscapeBrace:         "{{" | "}}"
Interpolation:       "{" Expr ("!" Conversion)? (":" FormatSpec)? "}"
Conversion:          "s" | "r" | "a" | "j" | "c" | "p"
FormatSpec:          [^}]+          // 与 format() 的格式规范完全一致
BoolLit:  "true" | "false"
NullLit:  "null"
IdentExpr: ident
TypeInfoExpr: "type_info" "(" ident ")"      // 编译期类型信息内建
StructLit: ident "{" (ident ":" Expr ("," ident ":" Expr)*)? "}"
ArrayLit:  "[" (Expr ("," Expr)*)? "]"
MapLit:    "[" (Expr ":" Expr ("," Expr ":" Expr)*)? "]"   // 当首元素后跟 ":"
FuncLit:   "fn" "(" ParamList? ")" ("->")? Type Block         // 匿名函数；静态类型即同签名 FuncType
```

- **优先级塔固定（L-03 可预判）**：`||` 最低、`*`/`/`/`%` 最高，10 级全部左结合；赋值 `=` 右结合；无右结合二元运算符。塔层级与 `src/tc.tc` 的 `parse_or → … → parse_mul → parse_unary → parse_postfix → parse_primary` 一一对应，不可调换。
- **全行为显式（L-02）**：`as` 为唯一显式类型转换（仅一次、不可 `e as T1 as T2`）；无隐式类型转换 / 隐式布尔 / 隐式内存分配；复合字面量（数组 `[...]` / map `[k:v]` / 结构体 `T{...}`）显式构造。
- **静态类型安全（L-03）**：每个 `Expr` 的静态类型由 checker 推算；元素 / 字段 / 下标 / `type_info` 静态校验；`MapLit` 与 `ArrayLit` 共用 `[ ]`，由首元素后是否跟 `:`` 向前看消歧（无二义）。
- **唯一写法（L-04 ✅）**：调用 `f(x)`、转换 `e as T`、下标 `e[i]`、成员 `e.f`、结构体 `T{...}`、数组 `[...]`、map `[k:v]`、匿名函数 `fn(...) T {...}`（`->` 可选，旧式 `fn(...) -> T {...}` 仍合法）均仅一种标准写法，无等价多写变体。
- **匿名函数字面量 `FuncLit`** ✅ tote（M46）：与函数**声明**靠「`fn` 前有无名字」区分——声明位先吃名字（`Name fn(...)`），表达式位裸 `fn` 即字面量，无二义。返回类型紧跟参数表（与声明一致）：`fn(...) Ret`，`->` 记号**已弃用但仍可选**（`fn(...) -> Ret` 同义，L-02 全行为显式）。语义与限制见 §3.5。
- `>>>` 注意：比较/移位序列中 `>>` 不得被词法拆成两个 `>`。
- **调用实参校验（L-03 静态类型安全，2026-08-05 收紧）**：函数调用（含后缀 `f(x)` 直接调用具名函数，以及经函数类型变量间接调用）**统一校验实参**——元数不符报 `T_CALL_ARITY`，逐位类型不符且不可 `can_cast` 报 `T_TYPE_MISMATCH`。此前**直接调用具名函数完全不校验实参**：少传的形参在函数体内读到未初始化的栈槽；若该形参是 `string`/`[]T` 的 `len` 字段，会拿到随机天文数字，导致循环把 512MB arena 瞬间耗尽（`arena: out of memory`），且报错离真正错误点极远（曾因 `tote` 的 `str_concat3(hd, "/.tote/libs")` 少传一参排查数小时）。校验实现见 `src/tc.tc` 的 `check_call_args`（直接/间接调用共用），variant 合成助手因无签名记录走 `tif_pstart<0` 守卫放行。conformance 用例 `tests/conformance/fail/f57_call_arity_direct` / `f58_call_arg_type`。

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
FuncType: "fn" "(" TypeList? ")" ("->")? Type   // ✅ tote 函数类型（函数指针语义：仅顶层具名函数可绑定）
TypeList: Type ("," Type)*
```

- ✅ tote：标量固定位宽 + `string`/`StringBuilder` + `[]T` 切片 + `[N]T` 定长数组 + `map[K]V` 哈希映射 + `fn(...) Ret` 函数类型（`->` 已弃用但仍可选：`fn(...) -> Ret` 同义）均实装（函数类型 v1 为函数指针语义：仅顶层具名函数可被绑定到函数类型变量 / 参数 / 返回值 / 结构体字段 / 全局变量；支持间接调用，诊断 T_CALL_ARITY / T_NOT_CALLABLE / T_TYPE_MISMATCH）。
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
- **未知结构体字段报 `T_UNKNOWN_FIELD`**（M-M 同批，2026-08-06）：`p.zzz` 形式的成员访问，若对象类型已解析到具体 `StructDecl` 而字段表中无该名字，此前同样静默退化为 `Unknown` → 编译期零诊断、LLVM 后端读 0 垃圾值。现于 `infer_expr` 的 `member` 分支直接报错。**仅在确实解析到 `StructDecl` 时报**：未解析类型、外部类型、Enum 成员、模块限定访问（已在 `mangle_modules` Pass 1 改写为 `ident`）、`"...".format(...)` 之类字符串方法一律不受影响。conformance `f60_unknown_field`。
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
- `type_info(T)` 是 `@derive`、序列化、编辑器导出、CTFE 导入的**核心底座**。当前 tc 的 `TypeInfo` 池为简化版，但字段自省内建**已接入**（`ti_name` / `ti_size` / `ti_kind` / `ti_field_count` / `ti_field` / `fi_name` / `fi_offset` / `fi_type_name` / `fi_type_size` / `fi_is_ptr` / `fi_tag` 双后端均可用，见 `examples/type_info_demo.tc`、`examples/tagid_typeinfo.tc`）。

#### 3.6.0 type_info 字段自省内建 ✅ tote

`TypeInfo` / `FieldInfo` 为**不透明句柄**（双后端均落为指针），读取一律走**函数式 API**（无 `.name` / `.tag` 成员语法糖）：

| 内建 | 作用 | 返回 |
|---|---|---|
| `type_info(T)` | 取类型自省信息（编译期可调用） | `TypeInfo` |
| `ti_name(ti)` | 类型名 | `string` |
| `ti_size(ti)` | 类型字节大小 | `i64` |
| `ti_kind(ti)` | 类型种类（`Struct`/`Enum`/…） | `i64` |
| `ti_field_count(ti)` | 字段数 | `i64` |
| `ti_field(ti, i)` | 第 `i` 个字段信息 | `FieldInfo` |
| `fi_name(fi)` | 字段名 | `string` |
| `fi_offset(fi)` | 字段内存偏移 | `i64` |
| `fi_type_name(fi)` | 字段类型名 | `string` |
| `fi_type_size(fi)` | 字段类型大小 | `i64` |
| `fi_is_ptr(fi)` | 字段是否指针 | `bool` |
| `fi_tag(fi)` | **字段 tagID**（见 §3.1.1.1） | `i64` |

⚠ 注意：`FieldInfo` 不支持 `.tag` 成员访问写法（`f.tag` 在 C 后端编译报错、LLVM 后端段错误）；必须用 `fi_tag(f)` 函数调用。

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

#### 3.6.2 类型模板参数 `any` 与单态化（✅ tc，M-any）

`t` 支持 Zig 风格编译期类型参数（`anytype`）：用 `comptime T: any` 声明类型模板参数，调用点以**类型名**作首实参触发**单态化（monomorphization）。

```ebnf
Param: "comptime" Ident ":" "any"   // 编译期类型模板参数（P.bb = true 标记）
Call:  Ident "(" TypeName ("," Expression)* ")"   // 首实参为类型名 → 单态化
```

**机制（零运行时开销）：**

1. 带 `comptime T: any` 的函数在 `decl_list` 中以**模板**存在；检查期与两个发射后端（C / LLVM）均**整体跳过**模板本身，只处理其实例。
2. 调用点 `f(Typename, args...)` 经 `infer_expr` 的 call 分支识别：模板 `f` + 首实参为类型名 → `instantiate_generic` 深克隆 `f` 的 AST，`T` 全量替换为实际类型节点，剥除 comptime 形参，重命名为 `f__Typename`，改写调用点（callee 指向实例、移除类型实参），追加实例到 `decl_list` 参与检查/发射。
3. 实例按签名去重（`f__i64` 只生成一次）；未实例化的模板永不进入 IR/C。

**类型实参可接受：**

- 标量/具名类型：`i64`/`f64`/`bool`/`MyStruct` 等（本就是标识符）。
- 类型专用关键字 `string` / `StringBuilder` / `void` / `map`：`parse_primary` 将其降为 `ident` 节点，故可作类型实参（误作值使用时检查期报「未知标识符」）。

**示例：**

```t
// 恒等函数：对任意类型 T 单态化
id fn(comptime T: any, x: T) T { return x; }

// 泛型取大：a/b 同类型，且类型须支持 >
max fn(comptime T: any, a: T, b: T) T {
    if (a > b) { return a; }
    return b;
}

main fn() i64 @main {
    auto a = id(i64, 42);        // → id__i64，a : i64
    auto b = id(f64, 1.5);       // → id__f64，b : f64
    auto c = id(string, "hi");   // → id__string，c : string
    auto m = max(i64, 7, 99);    // → max__i64，m : i64
    if (a == 42 && m == 99 && c == "hi") { return 0; }
    return 1;
}
```

> ⚠ `max(string, ...)` 非法：`string` 无 `>` 运算（发射端会对 `%TStr` 产生错误 IR）。泛型约束目前**仅靠调用点类型合法性保证**，无 `where` 子句。

> 实现位置：`src/tc.tc` — `func_is_generic` / `clone_node` / `subst_type_in_node` / `instantiate_generic`，及 `infer_expr` call 分支、`check_decl`、C 发射 `emit_func_decl` 分发、LLVM 发射 `emit_llunit` 循环四处 `func_is_generic` 门控（⚠ 该循环须用 `if/else` 而非 `continue` 跳过重写 `i++`，否则对泛型函数触发无限循环）。

> 📌 **单态化参数不限于类型**：Phase C 起，`meta` 形参声明为整数族 / `bool` / `string` 时即为
> **值参数**，实参在调用点 CTFE 求值后按值去重（`repeat("hi", 3)` → `repeat__s2_hi_1748694682_3`），
> 可与类型参数混用。见 §3.6.3「值参数单态化」。

#### 3.6.3 元编程关键字 `meta`（✅ tc Phase A+B+C+D+E，M-meta）

`meta` 是 `t` 的统一元编程关键字。**`meta` 与 `comptime` 互为别名**（词法层同映射到 `KwComptime`），
`type` 与 `any` 互为别名（同为「类型之类型」占位）。四种写法组合完全等价，`meta`/`type` 为推荐拼写。

> ⚠ **弃用告警（Phase E，2026-08-07）**：`comptime` / `any` 现为 `meta` / `type` 的**弃用别名**——仍按 `meta` 语义正常编译，但使用会发 `W_COMPTIME_ALIAS` 告警（不阻断编译），保留一个发布周期作为过渡，随后移除关键字。新代码请一律用 `meta` / `type`。仓库内既有用例（`examples/generics_demo.tc`、`examples/meta.tc`、`tests/samples/game_ecs.tc`、`tests/conformance/pass/p37_meta_ok.tc`）已迁移完毕；验证用例见 `tests/conformance/pass/p41_meta_comptime_alias.tc`（`// EXPECT: warning W_COMPTIME_ALIAS`）。

```ebnf
MetaParam: ("meta"|"comptime") Ident ":" MetaParamType     // 编译期形参（P.bb = true）
MetaParamType: "type" | "any"                              //   → 类型参数
             | IntType | "bool" | "string"                 //   → 值参数（Phase C）
MetaBlock: ("meta"|"comptime") Block                       // 编译期块
MetaExpr:  ("meta"|"comptime") Expression                  // 编译期表达式前缀
MetaDecl:  ("meta"|"comptime") ("const"|"var"|Ident "fn" ...)   // 编译期顶层声明
```

**四类表面：**

| 形态 | 写法 | 行为 |
| --- | --- | --- |
| ① 编译期形参 | `f fn(meta T: type, x: T) T`<br>`g fn(meta N: i64) i64` | ✅ 调用点单态化（复用 `instantiate_generic`，见 §3.6.2 与下方「值参数」） |
| ② 编译期块 | `meta { ... }` | ✅ 编译期执行，**运行期零代码** |
| ③ 编译期表达式 | `var a: i64 = meta 4 + 2;` | ✅ 编译期求值，**就地折叠为字面量** |
| ④ 编译期声明 | `meta const K: i64 = 100;` / `meta f fn(...)` | ✅ 进入编译期环境，可被 ②③ 读写 / 调用 |

**值参数单态化（Phase C）：**

`meta` 形参是「类型参数」还是「值参数」，由**声明类型**决定 —— `type` / `any` 是类型参数，
整数族 / `bool` / `string` 是值参数。二者可在同一函数里混用，单态化键按形参顺序拼接。

```t
sum_sq  fn(meta N: i64) i64            { var b: [N]i64; ... }   // 值进类型位（数组长度）
repeat  fn(meta s: string, meta n: i64) string { ... }          // → repeat__s2_hi_1748694682_3
pick    fn(meta B: bool, a: i64, b: i64) i64   { ... }          // → pick__true / pick__false
fill    fn(meta T: type, meta N: i64, v: T) T  { ... }          // → fill__i64_4（类型+值混合）
tagged  fn(meta N: i64, x: i64) i64    { return x + meta N * 100; }  // 实例体内的 meta 照常折叠
```

- **实参必须编译期可求值**：走 Phase B 的 CTFE 求值器。传运行期变量报 `T_META_READ_RUNTIME`。
- **类型必须精确匹配**：第 3 条禁隐式转换，`bool` 形参传 `1` 报 `T_META_ARG_TYPE`。
- **必须落在取值范围内**：`u8` 形参传 `300` 报 `T_META_RANGE`（按标量位宽二进制补码判定）。
- **浮点值参数未开放**：`meta F: f64` 报 `T_META_VALUE_PARAM_TYPE`（同 CTFE 的浮点约束，见下）。
- **单态化键**：整数用十进制（负数前缀 `n`，`-5` → `n5`）；`bool` 用 `true` / `false`；
  字符串用 `"s" + 长度 + "_" + 前 12 个可读字符 + "_" + FNV-1a(32) 哈希`
  （带哈希是为了避免 `"a-b"` 与 `"a_b"` 在字符清洗后撞名）。同键调用复用同一实例。
- 值参数在实例体内是**字面量代换**（不是常量绑定），所以能出现在 `[N]i64` 这类要求
  编译期整数字面量的类型位置上。

**CTFE 求值器（Phase B）能力边界：**

- **类型**：`i64` 整数族、`bool`、`string`。**浮点暂不支持**（报 `T_META_NOT_CONST`）——
  第 7 条要求求值可复现，浮点结合序须先定死。字符串仅支持 `==` / `!=`，不做拼接 / 切片。
- **表达式**：算术、位运算（`& | ^ << >>`）、比较、`&&` / `||`（惰性短路）、
  括号、显式 `as` 转型（按标量位宽做二进制补码窄化）、`meta fn` 调用。
- **语句**（`meta {}` 与 `meta fn` 体内）：`var` / 赋值 / `if` / `while` / `block` /
  `return` / `break` / `continue`。
- **作用域**：`meta fn` 是**纯函数** —— 只能看见自己的形参 / 局部与顶层 `meta const` / `meta var`，
  **看不见调用方的局部**（不做动态作用域）。
- **内建**：`print` / `eprint`（编译期日志，**一律写 stderr**，二者同义）、
  `int_to_str` / `i2s` / `str_len` / `str_at`。
  触碰运行期世界的内建（`file_*` / `sys_run` / `args` / `exit` / `path_resolve`）报 `T_META_IMPURE`。
- **护栏**：步数预算（`T_META_BUDGET`）、调用深度 64（`T_META_DEPTH`）、
  除零（`T_META_DIV_ZERO`）、读运行期变量（`T_META_READ_RUNTIME`）、
  调用非 `meta fn`（`T_META_NOT_META_FN`）、`meta {}` 内 `return`（`T_META_RETURN_OUTSIDE_FN`）。

**编译期内建（Phase D，`@` 前缀）：**

除 Phase B 复用的运行期内建（`print` / `eprint` / `int_to_str` / `i2s` / `str_len` / `str_at`）外，Phase D 新增一组编译期内建。它们全部走**编译期折叠**，双后端**无需任何新支持**：

| 内建 | 类别 | 作用 | 返回 | 备注 |
| --- | --- | --- | --- | --- |
| `@type_name(T)` | 类型查询 | 类型名字符串 | `string` | 可运行期折叠为常量 |
| `@type_size(T)` | 类型查询 | 类型字节大小 | `i64` | 同上；typealias 展开到底层（`@type_size(MyInt)` == `@type_size(i64)`） |
| `@type_equal(T1, T2)` | 类型查询 | 类型相等判定 | `bool` | CTFE 已知；`meta T: type` 形参经 `mb_bound_type` 解析为绑定类型 |
| `@zeroed([N]T)` | 类型查询 | 零初始化定长数组 | `[N]T` | 折成 `array_lit`；CTFE 缓冲区 / 运行期常量皆可 |
| `@str_from_bytes(buf, len)` | CTFE-only | 由字节造 `string` | `string` | 仅编译期上下文（否则 `T_META_RUNTIME_CTX`） |
| `@compile_error("msg")` | CTFE-only | 编译期硬错误，终止编译 | noreturn | 同上；被取分支才触发 `T_META_COMPILE_ERROR` |
| `sym_intern(buf, len)` | CTFE-only | 由字节驻留符号 | `Sym` | 复用既有内建通道，`Sym = "str"` 自动驻留 |

- **`@type_name` / `@type_size` / `@type_equal` / `@zeroed`**：在 CTFE 之前就折成字面量 / `array_lit` 节点，两个后端看到的只是普通字面量 —— 零新支持、零 IR 漂移。运行期位置调用亦合法（检查器随后照常对其做类型检查）。
- **`@str_from_bytes` / `@compile_error`**：只在编译期求值 / 折叠；在运行期上下文（非 `meta` 块、非 `meta` 形参的 `meta fn`）调用一律报 `T_META_RUNTIME_CTX`，行为显式可追溯。
- **`Sym` 一级化（Phase D）**：`Sym` 提升为一级符号句柄类型（`bw=32` / `alen=32`），使 `meta fn(meta s: string, meta n: u32) Sym` 这类「返回任意符号」的签名合法；`resolve_ti` / `resolve_type_desc` 仅在查过用户自定义 `Sym` **之后**兜底返回，自举安全（`src/tc.tc` 自带 `Sym struct` 不受影响）。

```t
meta get_width fn(meta T: type) u32 {        // docs/meta_design.md §6 模式
    if (@type_equal(T, u32)) { return 32; }
    else if (@type_equal(T, u64)) { return 64; }
    else { @compile_error("unsupported type"); }
    return 0;
}
meta repeat fn(meta s: string, meta n: u32) Sym {
    var buf: [64]u8 = @zeroed([64]u8);
    var pos: u32 = 0;  var i: u32 = 0;
    while (i < n) { var j: u32 = 0; var sl = str_len(s) as u32;
        while (j < sl) { buf[pos] = s[j]; pos = pos + 1; j = j + 1; }
        i = i + 1; }
    return sym_intern(buf, pos);            // → "hihihi"（s="hi", n=3）
}
```

> ⚠ **`meta { }` 的副作用发生在编译期**。`meta { print("x"); }` 在**编译时**往 stderr 写 `x`，
> 程序运行时不再输出它。编译期计算要影响运行期，须经 `meta var` 承接、再用 `meta <expr>` 折叠回来：
> 见下方 `ACC` → `c`。

**示例：**

```t
id fn(meta T: type, x: T) T { return x; }

meta const KLIMIT: i64 = 100;
meta var ACC: i64 = 0;
meta addk fn(a: i64, b: i64) i64 { return a + b; }
meta fact fn(n: i64) i64 {
    if (n <= 1) { return 1; }
    return n * fact(n - 1);
}

main fn() i64 @main {
    meta {                              // 编译期执行，运行期零代码
        print("meta-block\n");          // 编译期日志 → stderr
        var k: i64 = 1;
        while (k <= 4) { ACC = ACC + k * k; k = k + 1; }
    }
    var a: i64 = meta 4 + 2;            // → store i64 6
    var b: i64 = meta addk(10, 5);      // → store i64 15
    var c: i64 = meta ACC;              // → store i64 30（编译期累加结果）
    var d: i64 = meta fact(10);         // → store i64 3628800（编译期递归展开）
    auto n = id(i64, 42);               // → id__i64
    auto s = id(string, "hi");          // → id__string
    if (a == 6 && b == 15 && c == 30 && d == 3628800 && n == 42
        && s == "hi" && KLIMIT == 100) { return 0; }
    return 1;
}
```

> 实现位置：`src/tc.tc` — 关键字注册 `kw_reg("meta","KwComptime")` / `kw_reg("type","KwType")`；
> `parse_type` 的 `KwType` 分支（造 `type` 节点）、`resolve_ti` 的 `type` → `Any`；
> `parse_declaration` 将 `meta`/`comptime` 前缀提到最前（使其可修饰 `var`/`const`/`fn`）；
> `parse_primary` 的 `KwComptime` 表达式前缀；`comptime` 表达式节点在
> `expr_type_desc` / `ll_etd` / `emit_expr`（C） / `emit_lle`（LLVM）四处透传内层表达式。
> ⚠ 后两处此前缺失 —— `comptime <expr>;` 语句形态早已能解析，但 C 后端会落到
> `/* unsupported expr */`、LLVM 后端静默丢弃；Phase A 一并补齐。
>
> Phase B（CTFE）实现位置：`src/tc.tc` 中 `run_check` 之前的独立模块
> （`menv_*` 环境 / `meta_eval*` 求值 / `meta_exec` 执行 / `meta_fold_expr` 折叠 /
> `meta_run_block` 块执行 / `meta_pass` 驱动）。**`meta_pass()` 挂在 checker 之前**
> （`run_check` 内 `mark_call_callees()` 之后、`check_decl` 之前），
> 使检查器与双后端看到的已经是折叠后的字面量 —— 二者因此零改动。
>
> Phase C（值参数单态化）实现位置：`src/tc.tc` 中 `instantiate_generic` 及其之前的
> `meta_param_is_type`（形参分流）/ `meta_eval_value_arg`（实参求值 + 类型 / 范围校验）/
> `meta_val_key`（键编码）/ `meta_subst_val_node` `meta_subst_val_kids`（表达式位置代换）/
> `rewrite_generic_callsite`（调用点改写，首次生成与缓存命中共用）。
> ⚠ 同批修掉两处 Phase A 遗留缺陷：① 类型代换误把 kids 链表头 `inn.lc` 当节点 id 传给
> `subst_type_in_node`，导致函数体类型位置从未被替换（`zero(f64)` 曾发射 `alloca i64` + `ret double`）；
> ② 缓存命中路径不改写调用点，同一实例被调用第二次即无限重入直至 arena abort。
>
> 用例：`examples/meta.tc`（+ `.expected.txt`，L1 覆盖）、
> `examples/generics_demo.tc`（类型 / 值 / 混合参数全形态，L1 覆盖）、
> `tests/conformance/pass/p37_meta_ok.tc`（Phase A 表面）、
> `pass/p38_meta_ctfe_ok.tc`（Phase B 求值器全形态）、
> `pass/p39_meta_value_param_ok.tc`（Phase C 值参数全形态）、
> `pass/p40_meta_builtin_ok.tc`（Phase D 编译期内建全形态，运行 `exit=0`）、
> `fail/f61..f66_meta_*.tc` + `fail/f68..f71_meta_value_*.tc`（Phase A–C 十条护栏，L0 覆盖）、
> `fail/f72..f77_meta_*.tc`（Phase D 六条护栏：`T_META_COMPILE_ERROR`×2 / `T_META_UNKNOWN_BUILTIN` / `T_META_RUNTIME_CTX` / `T_META_TYPE_AS_VALUE` / `T_META_UNKNOWN_TYPE`，L0 覆盖）；完整设计见 `docs/meta_design.md`，
> Phase C–D 的目标形态见 `docs/meta_target.tc`（⚠ 该文件刻意**不放在 `examples/`**：
> `tools/ir_snapshot.mjs` 会对 `examples/*.tc` 逐个 emit，放入不可编译文件会使快照步骤永久 WARN）。
>
> 注：`tc0`（TypeScript 引导编译器）只需能编译 `src/tc.tc`，故仅注册了 `meta` 别名而未实现
> `any`/`type` 类型参数（`tc0` 本就不支持 `comptime T: any`）——这是既有的有意子集边界。

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

### 3.9 fid：文件描述符与序列化操作符 ✅ tote（M51 写路径，M52 `fid_error`/`fseek`/`ftell`，M53 读路径 `>` / `fid_eof`）

> 本节气法由 `docs/syntax/drafts/fid.md` 经 L-15 采用并并入（原草稿标记失效）。涵盖新标量 `fid`、`stdin`/`stdout`/`stderr` 保留标识符、`fopen`/`fclose`/`fflush`/`fid_is_open`/`fid_format`/`fmt_register`/`fid_error` 内建，以及序列化操作符 `<`（写）与 `>`（读，v1.5）。

**EBNF**

```ebnf
// fid 加入标量类型集合，与 atom 同为 64 位不透明标量
ScalarType: ... | "fid"

// 保留标识符（非关键字），检查阶段按保留名解析为 fid 常量
FidConst: "stdin" | "stdout" | "stderr"

// 序列化操作符复用 "<" / ">" 记号，并入比较层，左结合
// 语义由左操作数静态类型判定（见 D1）
CmpExpr: ShiftExpr (("<" | ">" | "<=" | ">=") ShiftExpr)*
```

- 不新增任何词法记号。`fid` 是类型名（与 `atom` 同类，非关键字）；`<`/`>` 复用既有的 `Lt`/`Gt`。
- `stdin`/`stdout`/`stderr` 为**保留标识符**：不可作为变量名/参数名/函数名/字段名重新声明，违者报 `T_FID_RESERVED_NAME`。

**D1 —— `<` / `>` 语义由左操作数静态类型唯一确定（L-04 唯一语义）**

- 左操作数静态类型为 `fid`：
  - `<` ⇒ **序列化（写）**，检查阶段脱糖为内部 `serialize` 节点，结果类型 = `fid`（目标自身），可链式（D2）。
  - `>` 且右操作数为**类型** ⇒ **反序列化（读）**，结果类型 = 裸 `Type`（EOF 返默认值，由 `fid_eof` 探针表达，见 §3.9.1 Option B）。
  - `>` 且右操作数**非类型** ⇒ 报 `T_FID_DESERIALIZE_NEEDS_TYPE`（不再退化为大于比较）。
- 左操作数为其他类型：
  - `<` / `>` ⇒ 小于 / 大于**比较**，语义不变。
  - `<=` / `>=` ⇒ 比较（若类型有序）。
  - `>` 右操作数却写成类型 ⇒ 报 `T_FID_DESERIALIZE_NEEDS_FID`（只有左操作数是 `fid` 时 `>` 才是读）。
- `fid` **无序**：`fid` 不参与 `<=` / `>=` 比较（恒报 `T_FID_NOT_ORDERED`）；`fid` 仅支持 `==` / `!=`（句柄相等比较）。
  - 右操作数为 `fid` 而左操作数不是 ⇒ 报 `T_FID_NOT_ORDERED`。

**D1 附则 —— 类型操作数的词法消解**

`string` / `StringBuilder` / `void` / `map` 是**关键字** token，永远不能作表达式起始；
故 parser 在 `>` 之后遇到它们即按类型解析（`f > string` 可写）。
`i64` / `bool` / `atom` / `MyStruct` 等本就是标识符，按普通表达式解析，
由检查期把 ident 节点**重解释**为类型（查全局符号表 `kind == "type"` 的条目）。
两条路径都在检查期汇合到同一判定，故 `>` 的读/比较之分仍只取决于左操作数静态类型。

**D2 —— 结果类型与链式（L-03）**

`f < v` 的类型是 `fid`，值即 `f` 本身。因 `CmpExpr` 左结合，`stdout < a < b` 解析为 `(stdout < a) < b`，天然等价于「先写 a 再写 b」。链式不是额外规则，是结合性的自然结果。

**D3 —— 打开方式与格式解析（L-02 全行为显式）**

```
fopen fn(path: string, mode: atom) -> fid
```

`mode` **必须是 atom 字面量**（编译期可判定），否则报 `T_FID_MODE_NOT_LITERAL`。合法取值：

| mode | 打开方式类别 | C 语义 |
|---|---|---|
| `:read` | text | `"r"` |
| `:write` | text | `"w"` |
| `:append` | text | `"a"` |
| `:read_binary` | binary | `"rb"` |
| `:write_binary` | binary | `"wb"` |
| `:append_binary` | binary | `"ab"` |

非上表取值报 `T_FID_BAD_MODE`（编译期）。格式解析在 `fopen` 时一次性完成并冻结进 fid 记录：取 path 最后一个 `.` 之后的后缀（小写，无 `.` 则空串），以 `(类别, 后缀)` 查注册表；未命中用该类别默认格式。

**D4 —— 后缀注册表（挂靠注册模式）**

```
fmt_register fn(kind: atom, suffix: string, fmt: atom) -> void
```

- `kind` ∈ { `:text`, `:binary` }，`fmt` ∈ { `:text`, `:json`, `:rawbin`, `:protobuf` }。非 atom 字面量 ⇒ `T_FID_FORMAT_NOT_LITERAL`；取值越界 ⇒ `T_FID_BAD_FORMAT`。与 `fopen` 的 mode 轴（`T_FID_MODE_NOT_LITERAL` / `T_FID_BAD_MODE`）**分开成码**。
- `suffix` 不含 `.`，大小写不敏感（内部统一小写）。同 `(kind, suffix)` 重复注册 ⇒ 后覆盖先（运行时行为）。
- 内建预置：`:text`+`json`→`:json`；`:text` 默认→`:text`；`:binary`+`pb`→`:protobuf`；`:binary` 默认→`:rawbin`。
- `stdin`/`stdout`/`stderr` 视为 text 类别、空后缀 ⇒ 格式恒 `:text`。查询：`fid_format fn(f: fid) -> atom`。

**D5 —— 各格式写出语义（L-02 显式、L-09 零 UB）**

`<` 右操作数 v1 支持：整数标量、`f32`/`f64`、`bool`、`atom`、`string`；其余（结构体/slice/map）报 `T_FID_UNSERIALIZABLE`（v2 走 `@derive`，见 §3.9.6）。

| fmt | 整数 | 浮点 | bool | atom | string |
|---|---|---|---|---|---|
| `:text` | 十进制 | 十进制 | `true`/`false` | 原子名（无引号） | 原样字节 |
| `:json` | 十进制 | 十进制 | `true`/`false` | `"名字"` | `"..."`（转义 `" \ \n \r \t` 与控制字符） |
| `:rawbin` | 定宽小端 | IEEE754 小端 | 1 字节 0/1 | 8 字节小端 id | `u64` 小端长度前缀 + 原始字节 |
| `:protobuf` | v1 未实装 ⇒ 运行时 `t_panic("protobuf serialization not implemented")` | 同左 | 同左 | 同左 | 同左 |

- 不隐式插入分隔符/换行（L-02）；不隐式类型转换（`f < 3` 与 `f < "3"` 不等价）。
- `:json` 是纯值编码器：每个右操作数各编成一个 JSON 值，无「原样输出」旁路（否则同一 `<` 有两种字节语义，违反 L-04）。文档级结构留 v2 聚合序列化。

**D6 —— 生命周期与错误（L-02 / L-09）**

- `fopen` 失败返回无效句柄；用 `fid_is_open fn(f: fid) -> bool` 显式检测。无隐式异常/重试。
- 对无效/已关闭句柄执行 `<`/`fclose`/`fflush` ⇒ 运行时 `t_panic`（确定性中止，非 UB）。
- `fclose fn(f: fid) -> void` **不幂等**，重复关闭 panic。关闭 `stdin`/`stdout`/`stderr` ⇒ panic。
- **无自动关闭**：句柄不随作用域回收，须显式 `fclose`。
- ⚠️ `defer` 须跟块（`defer { fclose(f); }`），且为**函数级**（写在 `if`/`while` 块内仍到函数退出才 LIFO 触发）；「打开→写→读回」等需块内落盘的场景须显式 `fclose`，不能靠 defer。
- 句柄容量硬上限 `T_FID_MAX = 256`（runtime），`0/1/2` 恒为 stdin/stdout/stderr，用户同时最多 253 个；表满 `fopen` 返回 -1（同打开失败表象，靠 `fid_is_open` 探测）。
- 缓冲：`FILE*` 经 stdio 缓冲，写不保证立即落盘，须 `fflush`/`fclose`；读写回环须先关/刷；stdout/stderr 交织顺序由刷新时机决定。
- `fid_error fn(f: fid) -> string`（走系统函数，仿 `fid_is_open`）：返回句柄最近一次错误原因，无错误返空串；查 runtime `g_fids[slot].err`，不 panic。
- `fid_eof fn(f: fid) -> bool`（读路径探针，与 `fid_is_open`/`fid_error` 同族）：语义是**「还有没有下一个字节可读」**，实现为一字节前瞻（`getc` + `ungetc`），**不是** C 的 `feof` —— `feof` 要等一次读越界后才置位，恰好读完全部内容时仍为假，`while (!fid_eof(f))` 会凭空多转一圈。无效/已关闭句柄或流错误返 `true`。单纯 EOF **不写** `fid_error`（EOF 由 `fid_eof` 表达）。实参必须是 `fid`，否则报 `T_FID_EOF_ARG`。
  - ⚠️ `:text` / `:json` 下文件尾部的空白/换行会被前瞻看见 ⇒ 返 `false`，但其后已无值可读。定长/精确边界场景请用 `:rawbin`。
- `fseek fn(f: fid, off: i64) -> bool` / `ftell fn(f: fid) -> i64`：绝对定位与取偏移，均不 panic，失败返 `false` / `-1` 并写 `fid_error`。
- `f > Type`（读路径，`>` 操作符）：从 `f` 反序列化一个 `Type` 值，结果类型为裸 `Type`；EOF/错误返默认值。各格式语义见 §3.9.1。

**示例**

```t
main fn() -> i64 {
    stdout < "hello " < "world" < "\n";
    stdout < "n=" < 42 < " ok=" < true < " " < :ready < "\n";

    var f: fid = fopen("out.txt", :write);
    if (fid_is_open(f)) {
        f < "line1\n" < "pi=" < 3.5 < "\n";
        fclose(f);                 // 块内要落盘就显式关，defer 是函数级的（D6）
    }

    var j: fid = fopen("out.json", :write);
    if (fid_is_open(j)) {
        j < "he said \"hi\"\n";    // → "he said \"hi\"\n"
        j < 12 < true < :ready;    // → 12true"ready"
        fclose(j);
    }

    var b: fid = fopen("out.dat", :write_binary);
    if (fid_is_open(b)) {
        b < 1000 < 3.5 < "abc";    // 27 字节 rawbin
        fclose(b);
    }

    fmt_register(:text, "ndjson", :json);   // 后注册覆盖先注册
    return 0;
}
```

**与既有构造的关系（L-04）**

- `file_write_all(path, content) -> bool`：**保留**（一次性整文件覆盖写，无句柄/格式/增量，不构成等价多写法）。
- `print`/`println`/`eprint`：**保留**，仍只接受 `string`（与 `tc.tc:8662` 现有检查一致）。`print(s) ≡ stdout < s` 等字节语义等价，已裁定为**文档化语法糖**（A 口径），运行期行为不变，不引入第二套字节语义（L-04 满足）。
- `<` 小于比较：由 D1 静态类型判定，`fid` 无序故唯一。
- `atom`：fid 复用 atom 作 mode/格式标记，是使用而非重叠。

**法律验证（L-15 采纳依据）**

| 法律 | 验证点 | 结论 |
|---|---|---|
| L-04 唯一语义 | `<`/`>` 双语义由静态类型唯一判定；`fid` 无序无二义；`print` 重叠已裁决（A 口径） | ✅ |
| L-02 全行为显式 | 无隐式换行/分隔符/类型转换/自动关闭；错误须显式 `fid_is_open`/`fid_error` | ✅ |
| L-03 静态类型 | `fid` 固定 64 位；`<` 结果类型 `fid`；mode/fmt 须字面量，编译期可判定 | ✅ |
| L-09 零 UB | 无效句柄/重复关闭/未实装格式确定性 `t_panic`；读路径 EOF 返该类型默认值、不 panic（Option B） | ✅ |
| L-14 铁律校验 | conformance（75/75）+ examples 双后端实跑比对（M51 / M52 / M53） | ✅ |

**§3.9.1–§3.9.10 设计补全与未来规划（已裁定）**

> 以下为 M51 草案未覆盖的设计面补全，全部经用户裁定。带 ✅ 表示运行时/编译器已具备落地基础，带 ⏳ 表示设计已定、待实装排期（v1.5 / v2）。

**§3.9.1 读路径（反序列化）—— `>` 操作符 ✅（M53 已落地，Option B 裁定）**

> **L-15 裁定（M53）**：原设计结果类型 `T?` 因可选类型当时仅为外壳（无值表示、无 `T→?T` 提升、无解包语法）无法实现。裁定改用 **Option B**：`f > Type` 返回**裸 `Type`**，EOF/错误返回该类型的默认值（数值 0 / 空串），是否到尾由新增探针 **`fid_eof(f) -> bool`** 显式表达。这契合 L-02 显式原则，且与 `fid_is_open`/`fid_error` 同族；代价是「零值 vs EOF」需调用方显式查 `fid_eof` 区分。

与 `<` 对称，读由 `>` 承担。消歧锚点 = 左操作数为 `fid`（与写路径一致）：`fid > Type` 是读，结果类型为裸 `Type`（EOF 不 panic、不报错）；`fid > 非类型` 报 `T_FID_DESERIALIZE_NEEDS_TYPE`；聚合类型（struct/array/slice/map/pointer）读报 `T_FID_DESERIALIZE_AGG`（属 v2）。`Type` 取子集：标量（`i8..i64`/`u8..u64`/`f32`/`f64`/`bool`/`atom`）与 `string`；命名类型须为上述标量或 string 的别名。

各格式读语义与写路径镜像（runtime `t_deser_*`）：
- `:rawbin` —— 标量按静态位宽读小端；`string` 先读 `u64` 小端长度前缀再读字节（干净往返）。
- `:text` —— 按空白切 token：整数/浮点读下一 token；`bool` 读 `true`/`false`/`1`/`0`；`atom` 读名称反查 id；`string` 读下一空白分隔 token（**含空格的字符串无法 text round-trip**，已知限制）。
- `:json` —— 读下一 JSON 值：数字按 `strtod`/`strtoll`；`bool` 读 `true`/`false`；`atom` 读 JSON 字符串反查 id；`string` 读带引号 JSON 字符串（支持 `\" \\ \n \r \t \/ \uXXXX` 转义）。
- `:protobuf` —— 留 v2（写出即 panic）。

EOF 语义：单纯 EOF **不写** `fid_error`（EOF 是预期结束，由 `fid_eof` 表达）；仅真实 I/O 错误写 `fid_error`。读路径不 panic（L-09）。

发射约定：运行时桥接统一以最宽标量返回（`double` / `int64_t`），窄目标由**编译器**显式收窄。
C 后端靠隐式转换，LLVM 后端必须显式 `trunc` / `fptrunc`（复用 `ll_cast_v`），
否则 `store i64 …, ptr %v`（`v: i8`）是非法 IR。

conformance：`p27_fid_read_ok`(pass) + `f43_fid_read_needs_type`(fail, `T_FID_DESERIALIZE_NEEDS_TYPE`)
+ `f44_fid_read_agg`(fail, `T_FID_DESERIALIZE_AGG`) + `f45_fid_read_needs_fid`(fail, `T_FID_DESERIALIZE_NEEDS_FID`)
+ `f46_fid_eof_arg`(fail, `T_FID_EOF_ARG`)；run_examples：`fid_read_demo`（rawbin 往返 i64/i8/u8/f64/bool/atom/string + `fid_eof` 探测）。

⚠️ 语义变更（M53 相对 M51）：`f > 1`（左 `fid`、右非类型）此前报 `T_FID_NOT_ORDERED`，现改报 `T_FID_DESERIALIZE_NEEDS_TYPE` —— `>` 已被读路径占用。`T_FID_NOT_ORDERED` 现仅覆盖 `<=` / `>=`，以及「右操作数为 `fid` 而左操作数不是」。回归用例 `f35_fid_not_ordered` 已相应改用 `>=`。

**§3.9.2 `fid_error` ✅（M52 已落地）**

内建 `fid_error fn(f: fid) -> string`，发射期调 runtime `t_fid_error`/`tll_fid_error`（仿 `fid_is_open`）；runtime `TFidRec` 加 `err[128]` 字段，`fclose`/`fflush`/序列化写失败（`ferror` 探测）时写入，越界/已关闭/未开槽返回空串不 panic。

- **错误语义为「最近一次」**：成功路径**不清空** `err`，故可在若干次写之后统一探测；探测到后 `clearerr` 复位流标志。
- `fopen` 失败返回的哨兵句柄 `-1` 不对应任何槽位，其原因单独存于全局 `g_fid_open_err`，`fid_error(-1)` 取之。
- **已关闭句柄仍可查**：`fid_error` 不要求句柄处于打开状态（否则「关闭时出错」将永远取不到原因）。
- 实参必须是 `fid`，否则报 `T_FID_ERROR_ARG`（`fid` 与 `i64` 不隐式互转，传整数不按下标解释）。

conformance：`p25_fid_error_ok`(pass) + `f41_fid_error_arg`(fail, `T_FID_ERROR_ARG`)；run_examples：`fid_error_demo`（打开失败取原因非空、健康句柄空串、关闭后查询不 panic）。

**§3.9.3 句柄容量与生命周期实限 ✅（runtime 已落地）**

`T_FID_MAX=256`，用户最多 253 个；长生命周期批量打开须自行 `fclose` 回收，无自动 GC。run_examples：`fid_capacity_demo`（表满第 254 次 `fid_is_open==false`）。

**§3.9.4 缓冲与 fflush 语义 ✅（runtime 已落地）**

stdio 缓冲；读写回环须先 flush/fclose；stdout/stderr 交织顺序非确定（仅文档声明）。run_examples：`fid_buffer_demo`。

**§3.9.5 定位 / 随机访问（fseek / ftell）✅（M52 已落地）**

`fseek fn(f: fid, off: i64) -> bool`（非法偏移/不可定位句柄返 `false` 并写 `fid_error`）、`ftell fn(f: fid) -> i64`（不可定位返 `-1`）；**均不 panic**。

- 偏移是**自文件头起算的绝对位置**，v1 不提供 `SEEK_CUR`/`SEEK_END` 相对定位；负偏移直接判失败（不做 C 式的从尾回绕）。
- 与 `fclose`/`fflush` 走 `fid_get`（无效句柄即 panic）不同，这两个内建走**非 panic 版访问器**：无效 / 已关闭句柄写 `err` 后返回失败值，由调用方显式取因（L-02 / L-09）。
- `fseek` 成功后 `clearerr` 复位 EOF 标志，否则读到尾再定位回去仍读不出内容。
- runtime 用 64 位定位原语（Windows `_fseeki64`/`_ftelli64`，其余 `fseeko`/`ftello`），避免 `long` 只有 32 位导致 >2GB 文件截断。
- 检查期：第 1 个实参非 `fid`、或 `fseek` 第 2 个实参非整型标量 ⇒ `T_FID_SEEK_ARG`（拦住 `fseek(0, f)` 这类参数写反）。

conformance：`p26_fid_seek_ok`(pass) + `f42_fid_seek_arg`(fail, `T_FID_SEEK_ARG`)；run_examples：`fid_seek_demo`。

**§3.9.6 聚合类型序列化与 `@derive` 衔接 ⏳（v2，部分预接线）**

`@derive(BinarySerde)` 已生成 `serialize`/`deserialize`；v2 接通 `<`/`>`：写时脱糖 `f < value.serialize()`（按 `:rawbin` 长度前缀），读时 `f > S` ⇒ 先读 `[]u8` 再 `S.deserialize`。conformance（v2）：`f47_fid_serde_missing_derive`(fail, `T_FID_UNSERIALIZABLE` 回归护栏) + `p29_fid_serde_ok`(pass)；run_examples：`aggregate_serde_demo`。

**§3.9.7 字符编码约定 ⏳**

字节透明（UTF-8 假定）；`:json` 读路径拒绝非法 UTF-8 转义（`T_FID_JSON_BAD_ESCAPE`，v2）。run_examples：`fid_json_escape_demo`。

**§3.9.8 并发与线程安全（单线程前提）✅（无需实装）**

`g_fids` 表与 stdio 缓冲非线程安全；并行模型落地后另立子条款。

**§3.9.9 全局 fid 变量 ⏳**

`fid` 不可作全局静态初始化器（`var g: fid = fopen(...)` 非法，报 `T_FID_GLOBAL_INIT`）；`var g: fid;`（运行期赋值）合法。conformance：`f48_fid_global_init`(fail) + `p30_fid_global_decl`(pass)；run_examples：`fid_global_demo`。

**§3.9.10 `print` / `println` 与 `<` 的 L-04 重叠裁决（已裁定 A 口径）✅**

`print`/`println`/`eprint` 仍只接受 `string`（与 `tc.tc:8662` 一致），明确定义为 `stdout < s` / `stdout < s < "\n"` / `stderr < s` 的**文档化语法糖**，运行期行为不变；`print(非string)` 仍报类型错（对应 `f49` 的 `T_FID_PRINT_ARG`）。conformance：`f49_fid_print_nonstring`(fail) + `p31_fid_print_sugar`(pass)；run_examples：`print_sugar_demo`（stdout 字节比对验证 L-04 等价消除）。

### 3.10 格式化内建（Python 格式规范迷你语言子集）✅ tc（M54）

**§3.10.1 为什么是「按类型分函数」而不是 `str.format`**

Python 的 `"{:>10}{:.2f}".format(a, b)` 依赖三样 `t` 目前都没有的东西：**变参**、**`Any`/动态类型**、**字符串 `+`/插值**。因此 `t` 不提供多参 `format`，而是按被格式化值的静态类型拆成**定元数内建**，与既有 `int_to_str` / `sb_append_*` 家族同构：

```ebnf
FormatBuiltins:
    format_int   fn(spec: string, v: i64)    -> string
  | format_uint  fn(spec: string, v: u64)    -> string
  | format_float fn(spec: string, v: f64)    -> string
  | format_str   fn(spec: string, v: string) -> string
  | format_bool  fn(spec: string, v: bool)   -> string
  | format_char  fn(spec: string, v: i64)    -> string   // v 为码点，t 无字符字面量

SbFormatBuiltins:
    sb_append_fmt_int   fn(sb: StringBuilder, spec: string, v: i64)    -> void
  | sb_append_fmt_uint  fn(sb: StringBuilder, spec: string, v: u64)    -> void
  | sb_append_fmt_float fn(sb: StringBuilder, spec: string, v: f64)    -> void
  | sb_append_fmt_str   fn(sb: StringBuilder, spec: string, v: string) -> void
  | sb_append_fmt_bool  fn(sb: StringBuilder, spec: string, v: bool)   -> void
  | sb_append_fmt_char  fn(sb: StringBuilder, spec: string, v: i64)    -> void
```

`sb_append_fmt_*` 是直写变体：结果直接追加进 `StringBuilder`，省掉中间 `string`。多段拼接一律走 StringBuilder（`t` 无 `string+`，见 §3.4）。

**§3.10.2 spec 文法**

```ebnf
FormatSpec: [ "{" ] [ ":" ] [ [fill] align ] [ sign ] [ "#" ] [ "0" ] [ width ]
            [ grouping ] [ "." precision ] [ type ] [ "}" ]
  align:    "<" | ">" | "=" | "^"
  sign:     "+" | "-" | " "
  grouping: "," | "_"
  type:     "b" | "c" | "d" | "e" | "E" | "f" | "F" | "g" | "G" | "n" | "o" | "s" | "x" | "X" | "%"
```

**外壳自动剥除**：`">10"`、`":>10"`、`"{:>10}"` 三种写法等价——解析时先剥 `{}`，再剥前导 `:`。这样可以把 Python 文档里的 spec 直接粘过来用。

语义与 CPython 一致：`fill` 默认空格、`align` 数值默认 `>`／字符串默认 `<`、`=` 把填充插在符号与数字之间、`#` 给 `b/o/x/X` 加 `0b/0o/0x` 前缀、单个 `0` 等价于 `fill='0'` + `align='='`、`,` 为十进制千分位、`_` 对 `b/o/x/X` 每 4 位分组・对 `d` 每 3 位分组。

**§3.10.3 与 CPython 的两处有意偏离**

| 项 | CPython | `t` | 理由 |
|---|---|---|---|
| 整数 `precision`（如 `.4d`） | `ValueError` | 视为**最小位数**，前导补零（`0007`） | 对齐 C 的 `%.4d`，且比抛错有用 |
| `format_bool` 非空 spec | 走 int 通道（`format(True,">5")` → `"    1"`） | 走文本通道（→ `" true"`），仅 `d/b/o/x/X` 等数值 type 才出 `1`/`0` | `t` 的 bool 字面量是小写 `true`/`false`，文本形态更自洽 |

除这两项外，`examples/format_demo.tc` 的 30 条断言与 CPython `format()` **逐字节一致**。

**§3.10.4 实现约定**

- 浮点走 runtime `snprintf`（`t_format_float` 内部拼 `%[+ ][#].{prec}{f|e|E|g|G}`），**不是**生成代码里 `snprintf`；`%` 类型先乘 100 再补 `%` 号；`,` 千分位由 `append_float_grouped` 对整数段后处理。
- 引擎单点实现于 `runtime/t_runtime.c`（`FmtSpec` / `fmt_parse` / `fmt_pad` / `fmt_int_core`），C 后端直调，LLVM 后端经 `runtime/t_shim_ll.c` 的 `tll_format_*` / `tll_sb_append_fmt_*` 指针桥（聚合按 `TStr*` 传入、返回聚合用末位 out 指针，见 §2.12）。故**双后端逐字节一致**。
- 结果串在当前 arena 上分配，随进程退出统一释放。
- conformance：`p28_format_ok`(pass)；run_examples：`format_demo`（双后端实跑比对）。

**§3.10.5 编译期 spec 校验（M54 补充）**

spec 字面量在编译期按 §3.10.2 文法校验（复刻 runtime `fmt_parse` 的外壳剥除——`{}` 仅当首尾都是才剥、再到最后一个 `:`；随后解析 fill/align/sign/`#`/`0`/width/grouping/precision/type，并要求**无残留字符**）。两种失败：

- 非法 type 字符（不在 `b c d e E f F g G n o s x X %` 集合，外加 `format_bool` 专属的 `!`）→ **`T_FMT_BAD_SPEC`**；
- type 之后仍残留无法解析的字符（如 `{:>10z}`）→ 同样 **`T_FMT_BAD_SPEC`**（运行期会贪婪吞尾、静默忽略，故这类笔误只能靠编译期捕获）。

spec 实参本身若非 `string` 类型（且非 `Unknown`）→ **`T_FMT_SPEC_TYPE`**。`now()` 误传参 → `T_CALL_ARITY`（见 §3.11）。**非常量 spec**（运行期才确定的字符串）不做编译期校验，维持运行期宽松：非法字符照常由 `fmt_parse` 忽略。校验实现见 `src/tc.tc` 的 `check_fmt_spec` + 内建实参检查块。

conformance：`p31_fmt_spec_ok`(pass)、`f41_fmt_bad_spec` / `f42_fmt_bad_spec2`(均 `T_FMT_BAD_SPEC`)。

**§3.10.6 方法式 `format`（`"tmpl".format(a, b)`）✅ tc（M57）**

为贴近 Python 习惯，`t` 允许以**方法式**调用数值模板：`"hello {0}".format(name)` 与函数式 `format("hello {0}", name)` **完全同义**，由编译器在检查期归一化——把接收者（须为字符串字面量）挪为第 0 实参、callee 换成裸 `format`，再走 M55 的 `desugar_format_call` 脱糖。

```t
var name: string = "world";
println("hello {0}".format(name));      // 方法式，等价于 format("hello {0}", name)
println("{0} @ {1}".format(name, 42));  // 多参同样支持
var tmpl: string = "x={0}";
// "tmpl".format(...) 若 tmpl 非字面量：编译期报 T_FMT_TEMPLATE_NOT_LITERAL
```

- 接收者**必须是字符串字面量**（`desugar_format_call` 需要把模板提升为匿名函数 `__fmt_N`）；若为变量则编译期报 **`T_FMT_TEMPLATE_NOT_LITERAL`**。
- 方法式与函数式可自由嵌套：`format("at {0}", "t={0}".format(format_time("%H:%M", now())))`。
- 归一化发生在 `infer_expr` 的 `call` 分支：仅当 callee 为 member 且方法名 `format`、接收者静态类型为 `string` 时触发；其它成员调用不受影响。conformance：`p34_fmt_method_ok`(pass)、`f51_fmt_method_not_literal`（`T_FMT_TEMPLATE_NOT_LITERAL`）(fail)；run_examples：`fmt_method_demo.tc`。

**§3.10.7 f-string 字面量（`f"..."` / `f"""..."""`）✅ tc（M-fstr）**

第三种写法，与前两种同源：**解析期就地脱糖为 `format(模板, 实参...)`**，随后完全复用 §3.10 的 `desugar_format_call` → `__fmt_N` 提升。因此 f-string 不引入任何新的运行期机制，插值表达式**只求值一次**，与手写 `format()` 产出的 IR 等价。

```t
var name: string = "world";
var n: i64 = 42;

println(f"hello {name}!");            // → format("hello {0}!", name)
println(f"|{name:>10}|{n:05}|");      // 格式规范与 format() 完全一致
println(f"{name!r} {name!p} {name!c}");    // 转换字段（repr / pbtxt / csv）
println(f"braces {{{name}}} ok");     // {{ }} 转义 → braces {world} ok
println(f"nested = {f"inner {n}"}");  // 可嵌套
println(f"""long {name} with "quotes" inside""");   // 长式内可直接写 "
```

- **文法**见 §5 `FormatStringLiteral`。触发条件是字符 `f` **紧贴** `"`，且前一个字符不是 `.` 或标识符字符——所以 `obj.f"x"`、`xf"x"` 不会被误判。
- **零插值退化**：`f"no interpolation"` 直接还原为普通字符串字面量（`{{`/`}}` 就地折叠），不生成 `__fmt_N`。
- **占位一律手动索引**：脱糖出的模板永远是 `{0}`/`{1}`…，不会与用户模板的自动编号规则混用。
- **转换字段 `!conv`**（CPython 语义：**先把值转成文本形态，再套 spec**）：

  | conv | 适用类型 | 语义 | 例 |
  |---|---|---|---|
  | `!s` | 任意 | 默认，等价于不写 | `{x!s}` |
  | `!r` | 字符串 | repr：加引号并转义 `"`/`\`/控制字符，非 ASCII 保留 UTF-8 | `"world"` |
  | `!a` | 字符串 | ascii：在 `!r` 基础上把非 ASCII 转成 `\xHH`/`\uXXXX`/`\UXXXXXXXX` | `"\u4e2d\u6587"` |
  | `!j` | 字符串 | json：加引号并按 JSON 规则转义（控制字符走 `\u00XX`） | `"x\ny"` |
  | `!p` | 字符串 | pbtxt：加引号并按 protobuf text 风格转义（`\"` `\\` `\n` `\t` `\r`，控制字符 `\xHH`），非 ASCII 保留 UTF-8 | `"x\ny"` |
  | `!c` | 字符串 | csv：仅当含 `,` `"` CR/LF 时加引号，内部 `"` 翻倍；否则裸值 | `"x,y"` |

  六种转换均可作用于任意值类型：字符串走格式专属转义；标量（整数/浮点/bool）序列化即裸值（`!j`/`!p`/`!c` 等价，均为合法 JSON/protobuf/csv 标量）。转换字段同样对手写模板生效（`format("{0!r}", s)`），模板里写了非法 conv 字母 → **`T_FMT_BAD_CONVERSION`**；f-string 里则在解析期直接报错。`!` 只有在**紧跟一个已完结表达式**时才当转换字段，所以 `f"{!ok}"`（前缀取反）、`f"{a != b}"` 都不受影响。
- **实现落点**：词法 `src/lex.tc` 把整条 f-string 原文（含插值）扫成一个 `FormatString` token；`src/parse.tc` 的 `parse_fstring` 负责切段、定位 spec 冒号与 `!conv`、把插值文本二次 tokenize 后调 `parse_expr`；`src/sema.tc` 的 `desugar_format_call` 消费 `!conv` 并选择 `sb_append_fmt_str_conv`（按 mode 区分 r/a/j/p/c 转义）；运行期实现在 `runtime/t_runtime.c`（LLVM 经 `tll_*` 指针桥）。
- conformance：`p44_fstring_ok`(pass)、`f52_fstring_conv_type`（`T_FMT_BAD_CONVERSION`）(fail)；run_examples：`fstring_demo.tc`（双后端实跑比对）。

---

### 3.11 时间格式化内建（strftime / `datetime.strftime` 的 `%` 风格子集）✅ tc（M56 / M57）

`t` 共有两个格式化 spec 语法家族，按领域分化（详见 §3.10）：数值/字符串走 Python 格式规范迷你语言（`{:>10}`），日期/时间走本节的 `%` 风格。后者是业界事实标准（C `strftime`、Python `datetime.strftime`），与数值域刻意不强行统一。

> **M57 增量**（相对 M56）：① 新增 `parse_time` / `parse_time_local` 时间**解析**（spec → 微秒 epoch，失败返回哨兵）；② 新增 `format_time_tz` 按**固定时区偏移**格式化（不依赖平台 tzdata）；③ `%c %x %X` 三个 locale 字段码从「未知原样保留」升级为**已实装**；④ 数值模板新增**方法式** `"tmpl".format(a,b)`（与函数式 `format` 同义，见 §3.10.6）。

**§3.11.1 EBNF（无新词法/关键字/类型）**

内建直接接入，与 `format_int` 完全同构；时间值复用既有 `i64` 标量，不新增类型或标量管线。

```ebnf
now                fn()                       -> i64     // 当前时刻的微秒 epoch
format_time        fn(spec: string, t: i64)  -> string  // 按 UTC 展开（gmtime）
format_time_local  fn(spec: string, t: i64)  -> string  // 按本机本地时区展开（localtime）
format_time_tz     fn(spec: string, t: i64, tz: i64) -> string  // 固定时区偏移（分钟）展开，不依赖平台 tzdata
parse_time         fn(spec: string, s: string) -> i64  // 按 UTC 解析为微秒 epoch；失败返回 T_TIME_INVALID
parse_time_local   fn(spec: string, s: string) -> i64  // 按本机本地时区解析；失败返回 T_TIME_INVALID
time_invalid       fn() -> i64                // 返回 T_TIME_INVALID (= INT64_MIN)，解析失败哨兵
```

`now()` 无参数；`format_time` / `format_time_local` 的 `spec` 为 `%` 风格格式串，`t` 为 i64 微秒 epoch。三者可与 M55 的 `format(tmpl, ...)` 模板自由组合：`format("到期 {0}", format_time("%Y-%m-%d", now()))`。

**§3.11.2 spec 文法与字段码**

```ebnf
TimeSpec: ( literal_char | "%" conversion )*
conversion:
    "Y" | "y" | "m" | "d" | "H" | "M" | "S" | "f" | "I"
  | "b" | "B" | "a" | "A" | "p"
  | "j" | "U" | "W" | "w" | "z" | "Z" | "%"
  | "c" | "x" | "X"          // locale 字段码（M57 实装）
```

- **D1 时间值语义 = i64 微秒 Unix epoch**：从 `1970-01-01T00:00:00Z` 起的微秒数；正数=1970 之后，负数=1970 之前（`gmtime`/`localtime` 须正确处理，`runtime` 用 `int64_t` 承载，规避 2038 年 `time_t` 32 位溢出）。`now()` 返回当前微秒 epoch。runtime 内部拆 `sec = t/1000000`、`us = t%1000000`，余数用于 `%f`。
- **D2 字段码表**（全部已实现 ✅）：

| 字段码 | 含义 | 示例 | 备注 |
|---|---|---|---|
| `%Y` | 4 位年 | `2026` | |
| `%y` | 2 位年 | `26` | |
| `%m` | 月 `01`–`12` | `08` | |
| `%d` | 日 `01`–`31` | `03` | |
| `%H` | 24 小时制时 `00`–`23` | `20` | |
| `%M` | 分 `00`–`59` | `51` | |
| `%S` | 秒 `00`–`59` | `30` | |
| `%I` | 12 小时制时 `01`–`12` | `08` | 配合 `%p` |
| `%f` | 微秒 `000000`–`999999` | `123000` | 取 `t%1000000` |
| `%b` | 短月名 | `Aug` | 固定英语 ASCII，不受 locale 影响 |
| `%B` | 全月名 | `August` | |
| `%a` | 短星期 | `Mon` | |
| `%A` | 全星期 | `Monday` | |
| `%p` | AM/PM | `PM` | 依 12 小时制 |
| `%j` | 年积日 `001`–`366` | `215` | |
| `%U` | 周数（周日起） | `31` | `(yday+7-wday)/7` |
| `%W` | 周数（周一起） | `30` | `(yday+7-(wday+6)%7)/7` |
| `%w` | 星期数 `0`(周日)–`6` | `0` | |
| `%z` | 时区偏移 | `+0000`（UTC） | UTC 下恒 `+0000`；本地下由 `localtime↔gmtime` 差经 `mktime` 计算（东为正） |
| `%Z` | 时区名 | `UTC`（UTC） | UTC 下恒 `UTC`；本地借 `strftime("%Z")` 取平台名 |
| `%%` | 字面 `%` | `%` | |
| `%c` | locale 日期时间 | `Sun Aug  3 20:51:30 2025` | `strftime("%a %b %e %H:%M:%S %Y")`，`%e` 空格填充日；固定英语 ASCII |
| `%x` | locale 短日期 | `08/03/25` | `strftime("%m/%d/%y")` |
| `%X` | locale 时间 | `20:51:30` | `strftime("%H:%M:%S")` |

- `literal_char`：任何非 `%` 字符原样输出。
- **D3 时区**：`format_time` 始终按 UTC（`gmtime`），确定性、可测、无平台差异，为默认推荐；`format_time_local` 按运行时本地时区（`localtime`），平台相关。`format_time_tz(spec, t, tz_minutes)` 按**固定时区偏移**（分钟，东为正，如东八区 `480`、印度 `+330`、西五点半 `−330`）展开，无需平台 tzdata、跨平台结果一致；实现上把偏移推进到「墙上时间」后再按 UTC 展开，并对 `%z` 输出 `±HHMM`、对 `%Z` 输出 `UTC±HH:MM`。
- **D4 实参类型与返回值**：`now()`→`i64`（无参）；`format_time`/`format_time_local`/`format_time_tz` 的 `spec` 须 `string`、`t` 须 `i64`，`format_time_tz` 第三参 `tz` 须整型（否则 `T_TIME_ARG_TYPE`、缺参 `T_CALL_ARITY`），三者均返回 `string`（当前 arena 分配）。`parse_time`/`parse_time_local` 的 `spec` 须 `string`、`s` 须 `string`，返回 `i64` 微秒 epoch（解析失败返回 `T_TIME_INVALID`）。不隐式类型转换（`t` 传 `u64`/`f64` 报 `T_TIME_ARG_TYPE`）。

**§3.11.3 字段码校验两层策略（格式化）**

格式化 spec 字面量在编译期按 §3.11.2 白名单扫描字段码：遇未知 `%X`（如 `%Q`）报 **`T_TIME_BAD_SPEC`**，把笔误前移到编译期。非常量 spec 无法编译期判定，运行期引擎对未知 `%X` **原样保留字符**（宽松兜底）。`spec` 非 `string` 报 `T_TIME_SPEC_TYPE`；`now()` 误传参报 `T_CALL_ARITY`。

> M57 起 `%c %x %X` 已实装（见 D2 字段码表），不再落入「未知原样保留」分支；仅 `%c %x %X` 之外的非白名单码（如 `%Q`）才按未知处理。

**§3.11.3.1 解析白名单（`parse_time` / `parse_time_local`）**

解析是格式化的**严格子集**——白名单比格式化更窄，因为 `%w %U %W %Z` 无法被反推为唯一时刻（或存在歧义），故在解析侧**明确拒绝**（而非「原样保留」）：

- `%w %U %W %Z` → **`T_TIME_PARSE_UNSUPPORTED`**（编译期，字面量 spec）；
- 其余非白名单 `%X`（如 `%Q`）→ **`T_TIME_BAD_SPEC`**（同格式化）；
- 解析还强制**输入须被完全消耗**（字符串末尾不可有残留非空白字符），否则视为解析失败、返回 `T_TIME_INVALID`。

扫描由 `check_time_parse_spec` 完成（编译期），运行期解析器 `t_parse_time` 同时自实现一套白名单以兼容非常量 spec。

**§3.11.4 实现约定**

- runtime 单点实现于 `runtime/t_runtime.c`（`t_now()` / `t_format_time()` / `t_format_time_tz()` / `t_parse_time()`），C 后端直调，LLVM 后端经 `runtime/t_shim_ll.c` 的 `tll_now` / `tll_format_time` / `tll_format_time_tz` / `tll_parse_time` 指针桥（`TStr` 按 `TStr*` 传入、返回用末位 out 指针），故**双后端逐字节一致**。`t_parse_time` 自带 `t_days_from_civil`（Howard Hinnant 民用历→epoch 日数，跨平台一致）与递归扫描器 `pt_scan`，不依赖 `strptime`（规避平台差异与 `%z` 解析缺口）。
- 编译器按 `fid_error`/`format_int` 同款**五处注册**：`builtin_ret` / `td_calls` / C 发射 / LLVM 发射 / `llph` declare，并加 `check_time_spec` / `check_time_parse_spec` 编译期字段码扫描。缺任一注册点 ⇒ 发射 `; UNSUPPORTED call X`（gate 的 `UNSUPPORTED 计数 0` 断言是唯一自动防线）。
- `gmtime`/`localtime` 返回静态缓冲，须立即拷出；epoch 负/溢出走 `int64_t` 承载，零 UB。解析失败统一返回哨兵 `T_TIME_INVALID`（= `INT64_MIN`），由 `#define` 在 `t_runtime.h` 提供，编译器 `time_invalid()` 内建直接返回该常量。

**§3.11.5 验收与门禁**

- conformance：`p29_time_fmt_ok`、`p30_time_fmt_ext`（pass）；`f38_time_fmt_bad_spec`（`T_TIME_BAD_SPEC`）、`f39_time_fmt_bad_arg`（`T_TIME_SPEC_TYPE`+`T_TIME_ARG_TYPE`）、`f40_time_now_arity`（`T_CALL_ARITY`）（fail）。

**§3.11.6 时间解析（`parse_time` / `parse_time_local`）与失败哨兵**

`parse_time(spec, s)` 把按 `spec` 组织的字符串 `s` 解析回微秒 epoch（`parse_time_local` 走本机本地时区）。语义要点：

- **失败哨兵**：解析失败（字段缺失/越界/格式不符/输入未完全消耗）返回 `T_TIME_INVALID`（= `INT64_MIN`）。**不抛错、不返回 0**——调用方应以 `if (t == time_invalid()) { ... }` 判错，或以 `t > time_invalid()` 判有效（因合法 epoch 恒 `>= 0`）。
- **支持的字段码**：`%Y %y %m %d %e %H %I %M %S %f %j %p %a %A %b %B %z %c %x %X %%%`；其中 `%c/%x/%X` 按 locale 串整体匹配，`%z` 支持 `+0800` / `+08:00` / `Z`，`%I/%p` 组合转 24h，`%y` 的 `69`→`1969`、其余→`20xx`，闰秒夹紧到 `59`，`%j` 反推日序。
- **白名单严格小于格式化**：`%w %U %W %Z` 在解析侧明确拒绝（见 §3.11.3.1），因无法反推唯一时刻。
- **输入须完全消耗**：解析器消费完 spec 后，`s` 必须恰好结束（尾部空白可忽略），否则失败。

**§3.11.7 固定时区格式化（`format_time_tz`）**

`format_time_tz(spec, t, tz_minutes)` 与 `format_time` 同构，但时区由第三参**显式给定**（分钟，东为正），而非取 UTC 或本机时区：

- 实现把 `tz_minutes` 推进到「墙上时间」后再按 UTC 展开，对 `%z` 输出 `±HHMM`、对 `%Z` 输出 `UTC±HH:MM`，彻底不依赖平台 tzdata，跨平台逐字节一致。
- 典型值：东八区 `+480`、印度 `+330`、美东夏令时 `−240`、UTC `0`。`examples/time_tz_demo.tc` 演示同一次 `t` 在多个偏移下的输出。

**§3.11.8 验收与门禁（M57 增量）**

- run_examples：`examples/time_fmt_demo.tc`（含 `%c/%x/%X` 与 `format_time_tz` 多偏移）、`examples/time_tz_demo.tc`、`examples/time_parse_demo.tc`（成功/失败/往返）、`examples/fmt_method_demo.tc`（方法式 `format`、嵌套、与 `format_time` 组合）、`examples/time_fmt_local.tc`（now+本地）。
- conformance（M57 新增）：`p32_time_locale_ok` / `p33_time_parse_ok` / `p34_fmt_method_ok`（pass）；`f47_time_parse_unsupported`（`T_TIME_PARSE_UNSUPPORTED`）、`f48_time_parse_bad_spec`（`T_TIME_BAD_SPEC`）、`f49_time_tz_arity`、`f50_time_tz_arg_type`、`f51_fmt_method_not_literal`（`T_FMT_TEMPLATE_NOT_LITERAL`）、`f52_time_invalid_arity`、`f53_parse_time_arg_type`（fail）。
- 对拍：固定 epoch `1754254290123000`（= `2025-08-03T20:51:30.123000Z`）断言 `format_time` / `format_time_tz` 与 Python `datetime(...,tzinfo=timezone.utc).strftime(...)` 及 `timezone(timedelta(minutes=480)).strftime(...)` 逐字节一致；`parse_time` 与 Python `datetime.strptime(...).timestamp()*1e6` 对拍一致。

---

### 3.12 Agent（智能体一等公民）✅ tc（actor 底层 + 用户态编排）

Agent 是语言的一等公民（宪法支柱，2026-08-03 用户裁定 B：actor 底层 + LLM 上层；LLM 调用属运行时边界，编译器只落地 actor 声明）。一个 `X agent { ... }` 在**解析期**脱糖为三个顶层符号，皆可像普通声明一样被 check / 双后端发射：

```ebnf
AgentDecl:  IDENTIFIER "agent" "{" (AgentClause ";")* "}"
AgentClause:
      "state" (IDENTIFIER ":" Type ("@" IDENTIFIER)? ("=" Expr)? ";")+
  |   "step"  FuncDecl            -- 形如 `step fn(s: <Name>State, msg: <Msg>) -> <Name>State { ... }`
```

脱糖产物（以 `Counter agent { state count: i64; step fn(s: CounterState, msg: i64) -> CounterState {...} }` 为例）：

| 生成符号 | 形态 | 命名约定 |
|---|---|---|
| `<Name>State` | struct（字段 = `state` 列表，含 `@tag` / `=default`） | PascalCase 类型名（§2.2） |
| `<name>_spawn` | `fn(init0, ...) -> <Name>State`：一参一字段（按声明顺序），body = `return <Name>State{ f: f, ... }` | **小蛇形** `counter_spawn` |
| `<name>_step` | `fn(s: <Name>State, msg: <Msg>) -> <Name>State`：用户所写 `step` 体 | **小蛇形** `counter_step` |

**命名红线（M-A 修正）**：编译器先把 PascalCase 的 agent 名经 `pascal_to_snake` 转小写，再拼 `_spawn` / `_step`，故生成的函数名恒为合法 snake_case。若手写 `Counter_step`（大写开头）会触发 `T_NAME_TYPE_CAMEL` 警告——因为命名校验器把「首字母大写」的标识符按**类型名**规则校验（§2.2：普通函数须小蛇形）。脱糖产物从根上规避该警告。

- `step` 首参必须是 `<Name>State`，返回值也必须是 `<Name>State`（状态不可变传递：每次 step 返回新状态，由调用方接回）。
- `msg` 的类型由用户在 `step` 签名里自由书写（i64 / atom / 自定义 struct 均可），编译器不限制。
- 生成的 `spawn` / `step` 是普通顶层函数，可直接调用、可被 `match` / 闭包 / 其他函数组合——agent 不构成独立命名空间。
- 验收：`examples/agent_demo.tc`（i64 驱动的计数器，`counter_spawn(0)` → 两次 `counter_step` +5/+3 → 输出 `count = 8`）+ `examples/agent_demo.expected.txt`，run_examples 双后端（LLVM + C）交叉验证通过。
- 进阶示例 `examples/agent_npc.tc`：两个 agent 演示 agent_first.md 的多概念——① `Monster` = State Agent（纯 Core 确定性状态机，atom 消息 `:hit`/`:heal`/`:patrol` 驱动 hp/aggro 转移）；② `Receptionist` = Mind Agent（Core + Edge(LLM)），关键演示 **LLM 边界缝**：`step` 永不直接调 LLM、只在状态里记 `pending=:llm` 意图，运行时边界 `drive()` 检测到意图后调用工具函数 `fake_llm`（确定性桩，真实项目即 LLM/IO 接缝）并以 `:llm_reply` 回填清空意图；核心纯函数、确定性、可回放（同消息序列 → 同终态，已演示）。`step` 用 if/else 原地更新后返回 `s`（C 后端等价写法；LLVM 后端亦可改用 `return match(msg){...}` 结构体字面量返回“新”状态，但 C 后端暂不支持 match 返回结构体）。双后端 + run_examples 通过。真实 LLM 旁路桥（替换 `fake_llm` 桩）见 `examples/agent_npc_mind_llm.tc` + `examples/lib/llm_boundary.tc`（导出 `drive_llm`）+ `tools/llm_bridge.py`，设计见 `docs/agent_first.md` §10 / §12.1。
- 进阶示例 `examples/agent_edge.tc`：演示 §6 分类矩阵里三个**纯模式** Edge 体——① `Radar` = Sensor Agent（Core×Env·感知，`:scan` 时 `step` 记 `pending=:sense`，边界 `drive_radar()` 去读世界 `sense_world()` 并把探测到的邻近实体数写回 `contacts`）；② `DbAgent` = Tool Agent（Core×Tool/IO，`:query` 时记 `pending=:tool`，边界 `drive_db()` 调 `fake_db()` 并把结果写回 `last_result`）；③ `Hero` = Player Agent（Core×Human，消息直接来自人类 input 事件，无 LLM/工具边界）。三体内部 `step` 都是纯函数、确定性、与对应 Mind 体同构；边界效应（读世界/调工具/读人类输入）只活在运行时边界。双后端 + run_examples 通过。

**分类矩阵（2 轴 × 最终定名 · 2026-08-04）**：全部共用同一 `agent` 原语，差别在（a）Core 类型（Reflex 状态机 / Planning 规划）、（b）Edge 边界。Edge 含 **Env·感知**（对称于 Tool·IO 的「向世界写」，Env·感知是「在边界读世界」）。

| | none | Env·感知 | Tool/IO | LLM | Human |
|---|---|---|---|---|---|
| **Reflex（状态机）** | State Agent 状态体 | Sensor Agent 感知体 | Tool Agent 工具体 | Mind Agent 心智体 | Player Agent 玩家体 |
| **Planning（规划）** | Plan Agent 规划体 | Scout Agent 侦察体 | Operator Agent 操作体 | Strategist Agent 策略体 | Adjutant Agent 副官体 |

- **已示例（Reflex 行）**：State（`Monster`）、Mind（`Receptionist`）——见 `examples/agent_npc.tc`；**Sensor（`Radar`）、Tool（`DbAgent`）、Player（`Hero`）——见 `examples/agent_edge.tc`**（三体演示 Edge 边界差异：`step` 在边界记意图、`drive_*()` 去读感知/调工具/读人类输入，与 Mind 同构，核心 step 纯函数可回放）。
- **已示例（Planning 行，无 `goal`/`plan` 语法，决策 A 第5条）**：Plan / Scout / Operator / Strategist / Adjutant —— 用纯 `planner(State) -> Msg` 自由 fn 算出「下一步消息」喂同一纯 `step`，**已可写可运行示例**：`examples/planner_demo.tc`（四 planner 自由 fn 共用同一 `robot_step` 原语，差异只在边界驱动）。
- **元类 ✅ 库层落地（examples/lib/colony.tc）**：Spawner / Colony Agent 调度体（管理/生成子 agent）。按收敛决策 A **不进编译器语法**，复用 actor 脱糖产物（XState / x_spawn / x_step）+ slice + 函数指针实现 `spawn` 生成 / 按 `id` 寻址 / `tick` 调度 / 扁平 inbox 延迟邮箱；状态以 **string 指纹 + `fn(string, Msg)->string` 回调**泛型无关复用（任意 agent 类型共用同一调度体）。演示见 `examples/colony_demo.tc`（Worker 小队 + Counter 跨类型复用）与 `examples/colony_wave.tc`（真实小子场景：塔防刷怪波次 + ECS World 主循环，每帧跑 AgentSystem/MovementSystem(`physics.movement_system`)/CombatSystem 三 System）。⚠ 规避 t 当前两处限制：① map 值仅支持纯标量（含 string/slice 的 struct、map-of-slice 触发编译器内部 panic）→ 用并行 slice 按 id 下标对齐；② LLVM 后端对 slice-of-slice（`[][]Msg`）发射非法 IR → 邮箱用扁平 `[]Msg` + 并行 `[]i64 inbox_to`。
- 命名对称：Scout = 规划式感知（先侦察再决策），区别于 Sensor 反应式感知；Adjutant = 人类为指挥官、agent 为副官负责规划协调，区别于 Player 玩家体（纯 Reflex 人类直驱）。完整定义见 `docs/agent_first.md` §6。

**收敛决策 A（2026-08-04 拍板）**：`agent` 在语言层**无能力净增**（脱糖产物 `struct` + 自由 `fn` + 构造器 `t` 均已是一等公民，连 `spawn` 也可用 `XState{...}` struct 字面量替代），故**保留为极简意图标记，绝不再扩语法**——`use` 接线式、`goal`/`plan` 子句、`Spawner`/`Colony` 原语、消息路由均**不进编译器**。上方 10 格分类矩阵是**模式目录（非语法）**：所有 flavor 只是同一 `step` 契约 + 同一边界模型下**边界驱动方式不同**（读世界 / 调工具 / 调 LLM / 读人类 / 规划后喂 `step`），First-class agent ≠ built-in-flavors。支撑「数据流可复现」的工程工具（消息日志 / 回放定位 / 确定性 diff）移至**库层**（详见 `docs/agent_first.md` §8、§9、§10 库层边界协议、§11 ECS 集成与非容器原则、§12 模块与模型库分层）。

**数据流可复现设计约束（Agent 该怎么做）**：引入 Agent 的核心卖点是「`init + 有序消息 ⇒ 可逐帧复现并定位偏离」」，它源自 `Agent = 纯函数状态机` 这一设计不变量，而非调试功能。守恒定则 5 条：① `step` 必为纯函数（零 IO / 零全局可变 / 零时钟 / 零随机）；② 消息是唯独输入通道（`step` 不得偷偷读世界 / 外部状态）；③ 状态是 Plain Data（无方法 struct，可快照 / diff）；④ 效应隔离到 `drive()` 边界（LLM / 工具 / IO / 人类输入只在此发生、以消息回填）；⑤ 消息日志是一等调试凭证。`agent_demo` / `agent_npc` / `agent_edge` 三示例之所以「特别容易按数据流定位问题」，正是无意中满足这 5 条——这正是该固化成设计纪律的东西。

---

### 3.13 Modules / Import / Export（代码模块与插件系统）⚠ 部分实现（2026-08-04：parser + 两个诊断 + whole-program inlining 已落地，`module_hello` 双后端真实通过；**工程源码根 + 点分模块名 `import(src.a)` / `import(src.d.e)` 已落地（`proj_demo` 双后端真实通过）**；**库搜索路径 + 命名空间隔离 `lib__name` 重整 + `export` 私有隔离强校验（`T_MODULE_PRIVATE`/`T_MODULE_NO_SYMBOL`）已落地（第四刀，2026-08-05）**；**`.tlib` 真·独立编译 + 链接（build --lib 产 LLVM 归档 + exports.json，import(x) 优先链接、私有跳过、未预编译回退内联）已落地（第五刀，2026-08-05）**；**环境变量搜索（`T_LIB_PATH` / `~/.tote/libs`，`getenv` 中性内建 + tote 注入 `--lib-dir`）已落地（第六刀，2026-08-05）**；`.tlibd`（调试态归档）/ `T_IMPORT_CYCLE`（依赖图无环校验）/ tote 依赖图（`tote deps` + `tc --emit-deps`）**已落地（外部库收尾刀，2026-08-05）**；**语法统一为 `import(Path [:: List] [as Alias])`（`src.` 前缀走源码根、其余走库；旧 `import @x;` / 裸 `import x;` 删除；选择性导入 `::` 新增）已落地（统一刀，2026-08-08）**；C 互操作导出（`.lib`/`.dll`）待实现）

> 本节气法由 `docs/syntax/drafts/module.md` 经 L-15 采用并并入（原草稿已标记失效）。与 §3.6.1 数据导入（`import_csv`/`import_json` 函数调用）正交：代码模块走 `import xxx` 标识符形式（支持点分 `xxx.yyy`）。

一个 `.tc` 文件即一个模块；发布态为 `xxx.tlib`，调试态为 `xxx.tlibd`（刻意避开 C 静态库 `.lib` 扩展名）。`import xxx` 按名导入，命名空间即 `xxx` 的**最后一段**；跨模块可见的符号须显式 `export`。四法评审：L-04/L-02/L-03 全 ✅，L-14 原则 ✅（门禁用例实现期落）。

```ebnf
ImportPath:     IDENTIFIER ("." IDENTIFIER)*        // 模块路径；首段 src → 工程源码根，否则 → lib/依赖库
ImportList:     ImportItem ("," ImportItem)*         // 选择性导入列表（:: 之后）
ImportItem:     IDENTIFIER ("as" IDENTIFIER)? | "*"  // 选择性导入项；* = 通配
ImportStmt:     "import" "(" ImportPath ("::" ImportList)? ("as" IDENTIFIER)? ")" ";"
                                                    // 统一语法：import(std.mem) / import(json :: *) / import(std.math as m2)
ModuleFile:     <src_root> "/" ImportPath-with-"/" ".tc"   // 模块源码（含 export、无 main），如 <src>/math.tc
ModuleArtifact: ModuleStem "." ("tlib" | "tlibd")   // 库归档（build --lib 产出），如 std/mem.tlib / json.tlib
ExportPrefix:   "export"                            // 前缀修饰顶层声明；export import(...) 报 T_EXPORT_SCOPE
```

> ⚠ **2026-08-08 语法统一（落地）**：旧的 `import @x;`（外部库）与裸 `import x;`（工程内）两种写法**已删除**，统一为 `import(Path [:: List] [as Alias])`。`import` 不再区分「工程内 / 外部库」——一律走 `import(...)`，由路径首段决定解析策略（见 rule 1 / rule 5）。旧写法在解析期报友好错误并 `exit(1)`。

**规则**：

1. **导入形式（统一语法）**：`import(Path)`；`Path` 为**点分模块路径**（标识符，允许 `.` 分段），非字符串路径；与数据导入函数（`import_csv`/`import_json`）不重名（L-04 唯一语义）。统一支持三种可选修饰：
   - **选择性导入** `import(Path :: a, b as c, *)`：只引入列表中的符号（可 `as` 改名；`*` 通配全部导出符号）。
   - **模块别名** `import(Path as M)`：以 `M.sym` 限定访问（替代原「点分末段」或裸名），如 `import(std.math as m2)` → `m2.abs(-7)`。
   - 二者可组合：`import(Path :: a, b as c as M)` 不合法（`as` 模块别名写在 `)` 前、`::` 列表外）；选择性列表与模块别名独立。`export import(...)` → `T_EXPORT_SCOPE`（语法不支持模块重导出）。
   - ⚠ **旧写法已删除**：`import @x;`（外部库标记）与裸 `import x;`（工程内）在解析期报友好错误（`import @x; was removed; write import(x);`）并 `exit(1)`。迁移：`import @json;` → `import(json)`；`import hello;` → `import(src.hello)`。
2. **默认私有**：顶层符号默认模块内可见；跨模块可见须显式 `export <name> fn/struct/enum/flag/variant/const/typealias`。`export` 修饰非顶层 → `T_EXPORT_SCOPE`（L-02 显式）。
   - ⚠ 语法注意：t 声明为并置式 `Name fn(...)`，`export` 前缀置于**名字之前**：`export add fn(...) { ... }`（非 `export fn add`）。
   - ✅ **私有隔离已强制（2026-08-05 第四刀）**：经 `mangle_modules` 重整，导入模块（别名 `A`）的顶层符号被改写为 `A__name`；未 `export` 的符号**跨模块不可见**——`A.priv()` 触发 `T_MODULE_PRIVATE`，`A.NoSuchType` 触发 `T_MODULE_NO_SYMBOL`。模块**内部**自调用同样脱糖为 `A__name`（库内自洽）。入口模块别名 `""` → **永不重整**，故单文件程序 IR 逐字节不变（已重录基线、L2 gate 全绿验证）。
3. **名称解析与限定前缀（Go 风格末段）**：`import(net.http)` 的命名空间取**模块名最后一段** `http`，以 `http.get(...)` 访问；`import(math)` 即 `math.add(...)`；`import(net.http as h)` 则 `h.get(...)`；工程内 `import(src.d.e)` 取末段 `e` 以 `e.deep(...)` 访问（点分仅描述文件路径，不构造多级命名空间，故不能用 `d.e.deep`）。`as M` 模块别名下以 `M.sym` 全限定访问；不取末段。`import(src.hello)` 内联进同一单元后亦可直接裸名调用（如 `greet()`）。零碰撞、显式。
3b. **限定类型与字面量（跨模块类型引用）**：引用外部/其他模块**导出类型**须带限定前缀——`var v: json.Value;`、字面量 `var p: physics.Position = physics.Position{ x: 1, y: 2 };`。解析期 `named{A.T}` 重整为 `A__T`（找不到 → `T_MODULE_NO_SYMBOL`）；`A.T{}` 结构化字面量同理。`mangle_modules` Pass 1 先处理：识别 object 为模块别名的 `member`、带 `sb != ""` 的 `named`/`struct_lit`，按 `def_lookup` 解析后清 `sb`。未限定的 `Value`/`Position` 只在本模块查找。
4. **工程源码根（`src.` 前缀，2026-08-08 统一语法）**：工程内源码模块经 `import(src.xxx)` 导入——路径**首段为 `src`** 即表示从本项目源代码根目录解析，编译器剥去 `src` 段后相对 `<src_root>` 取源码整体内联（单命名空间）：
   - `import(src.a);` → `<src_root>/a.tc`
   - `import(src.d.e);` → `<src_root>/d/e.tc`
   - 文件不存在 → `T_IMPORT_NOT_FOUND`。
   - `<src_root>` = **入口文件所在目录**（取代旧「相对导入方目录」）。标准布局下你跑 `tc run src/main.tc`，入口目录即 `<root>/src`，于是 `import(src.a)` ⇒ `<root>/src/a.tc`、`import(src.d.e)` ⇒ `<root>/src/d/e.tc`。
   - ⚠ **首段非 `src` 一律走库搜索**（rule 5）：故工程内源码**必须**显式加 `src.` 前缀；裸 `import(a)` 会被当作库 `a` 在 `lib/` 与依赖库中查找（找不到 → `T_IMPORT_NOT_FOUND`），不会再回落到源码根。
   - ⚠ **已知限制**：向上查找 `tote.toml` 自动定位 `<root>` 的方案**暂未启用**——编译器内置 `path_exists` 对绝对路径探测不稳定（触发 `arena: out of memory`）。故以「入口目录 = 源码根」折中，对标准布局等价；约定用法 `tc run src/main.tc`。
5. **解析序（统一语法，2026-08-08）**：`handle_one_import` 依据 `import(Path)` 的**首段**分流：
   - **首段为 `src`**（如 `import(src.a)`、`import(src.d.e)`）→ `is_lib_path=false` → 剥 `src` 后相对 `<src_root>` 取**源码**整体内联（单命名空间），无 `.tlib` 查找；嵌套 import 递归、重复自动去重（菱形共享根只加载一次）；文件不存在 → `T_IMPORT_NOT_FOUND`。
   - **首段非 `src`**（如 `import(json)`、`import(std.mem)`）→ `is_lib_path=true` → 走 `resolve_external_lib` + `mangle_modules` 命名空间重整（非单命名空间内联，见 rule 2 私有隔离），并支持**双模式**（见 rule 6b）。路径 `.` 经 `dots_to_slashes` 转 `/` 定位归档（`import(std.mem)` → `out/lib/std/mem.tlib`）。
   - 空路径（如 `import(src)` 剥 `src` 后无剩余）→ `T_IMPORT_BAD_PATH`。
5b. **库搜索路径（`compute_lib_dirs`）**：`is_lib_path=true` 时，候选目录顺序 = ① 入口文件目录下的 `lib/`、`libs/`；② 每个工程源码根 `<src_root>` 的**父目录**（工程根）下的 `lib/`、`libs/`；③ `out/lib`（构建期 std 归档落点）；④ **环境变量驱动目录**（第六刀）：`T_LIB_PATH`（`;` 分隔）逐个 + `~/.tote/libs`，二者经 `tote` 以 `--lib-dir` 注入（优先级最高）。故 `examples/extlib_demo.tc` 入口目录 `examples/` 命中 `examples/lib/json.tc`；标准工程 `src/main.tc` 命中 `<root>/lib`、`out/lib/std/mem.tlib`；`set T_LIB_PATH=C:/my/libs` 后还能命中该目录下的库。
6b. **库双模式（链接模式 + 内联回退）**：对 `is_lib_path=true` 的 import，先查搜索路径下的预编译归档 `<libdir>/<dots_to_slashes(Path)>.tlib`（含伴随 `<libdir>/...exports.json` 接口块），命中即进入**链接模式**——载入 exports.json 注册导出符号、代码生成阶段对库导出符号发 LLVM `declare`（不发 `define`）、私有符号跳过、归档路径进 `g_ext_link` 供链接器并入；未找到 `.tlib` 则**回退内联源码**（过渡安全网，故未预编译时单文件 IR 不变、gate 不漂）。`build --lib <file.tc>` 产出 `out/lib/<dots_to_slashes(Path)>.tlib`（如 `lib/std/mem.tc` → `out/lib/std/mem.tlib`，`clang -c` 编 `.o` 经 `llvm-ar rcs` 归档）+ 伴随 `out/lib/std/mem.exports.json`；库以「路径末段 stem」作重整命名空间，使归档符号 `mem__len` 与下游 `import(std.mem)` 重整结果一致；库独立编译时跳过进程级全局（`t.__ginit`/`t_atom_table`/`t_atom_count`，由主程序提供，避免重复符号）。
6c. **选择性导入（`::` 列表，2026-08-08 新增）**：`import(Path :: a as b, c, *)` 的选择性列表在 `mangle_modules` 的 **Pass 3** 实现为 **AST 改名 Pass**——遍历候选符号，将调用点 `a`/`c` 改写为模块限定 mangled 名（`M__a`/`M__c`），`as b` 映射为本地名 `b`，`*` 展开为该模块全部导出符号（受 `export` 可见性约束）。**不引入新的作用域机制**，复用 Pass 2 的 provenance 改写。`*` 通配后若与本地声明或另一选择性导入同名 → `T_IMPORT_CONFLICT`；引用未导出符号 → `T_MODULE_NO_SYMBOL`/`T_MODULE_PRIVATE`；选择性符号在模块中不存在 → `T_MODULE_NO_SYMBOL`。
7. **依赖图无环（`T_IMPORT_CYCLE` 已发射，2026-08-05 外部库收尾刀）**：靠 `in_mod_visited` 访问集对重复 import **去重**（菱形共享根只加载一次、不报错）；同时 `handle_one_import` 维护 **DFS 活跃栈** `g_mod_stack`/`g_mod_stack_alias`（进入模块压栈、离开弹栈），若**被导入模块已处于当前活跃栈中** → 真成环 → 发射 `T_IMPORT_CYCLE`（如 `a→b→a`）。去重与环检测并存：合法菱形（`a→b→d`、`a→c→d`）只加载一次 `d` 且不报环，非法环必然报错。依赖图边（父=活跃栈顶别名或 `"<entry>"`，子=被导入别名）记录于 `g_dep_from`/`g_dep_to`，供 `--emit-deps` 输出（见 rule 7b）。
7b. **依赖图导出（`tc --emit-deps`，外部库收尾刀）**：`tc check --emit-deps <file>`（flag **位置无关**，可置于文件名前或后）在类型检查后输出依赖图 JSON：`{"entry":"<abs path>","edges":[{"from":"<parent>","to":"<child>"}...]}`。父=当前活跃栈顶别名（入口文件为 `"<entry>"`），子=被导入模块别名；菱形依赖（如 `a→b→d`、`a→c→d`）记录**全部 4 条边**（`c→d` 不丢，因边记录置于钻石去重 `return` 之前）。该 JSON 为合法 JSON——边闭合用 `sb_append_char(out,34)`+`sb_append_char(out,125)` 逐字符追加 `}"`，规避 `t` 字符串字面量「`\"}` 被词法分析成 `"}`」的转义陷阱。
7c. **tote 依赖图（`tote deps`，外部库收尾刀）**：`tote deps <file.tc>` 委托 `tc check --emit-deps` 并注入 `--lib-dir`（即 `T_LIB_PATH`/`~/.tote/libs` 搜索路径），输出同上依赖图 JSON。`tote build`/`run`（未显式 `--mode rls`）自动追加 `--debug-libs`，使调试构建优先链接 `.tlibd`（见 rule 7d）。
7d. **调试态归档（`.tlibd`，外部库收尾刀）**：`tc build --lib --debug <file.tc>` 产出**调试态**归档 `out/lib/<stem>.tlibd`（`clang -O0 -gcodeview` 编 `.o` 经 `llvm-ar rcs`）与伴随 `out/lib/<stem>.tlibd.exports.json`（接口块，命名随 `lib_ext`）。`tc` 的 `--debug-libs` 开关令 `resolve_external_lib_archive` **优先探测 `.tlibd`**（未命中回退 `.tlib`，再回退内联源码）——便于调试期保留符号/行号。普通 `build --lib`（无 `--debug`）仍产 `.tlib`（`-O2`）。
8. **接口自描述**：`.tlib`/`.tlibd` 内嵌接口块（后端无关、确定性可读的 `export` 签名区），importer `check` 只读接口块即可类型检查；未 `export` 符号不进接口块，私有天然不可见。
9. **C 互操作**：`.tlib` 可经 `tote` 导出为 C 兼容 `.lib`/`.dll`（符号来自接口块），导出表仅含 `export` 符号（见草稿 §11）。
10. **环境变量搜索（`T_LIB_PATH` / `~/.tote/libs`，2026-08-05 第六刀已落地）**：库搜索路径追加**环境变量驱动**的目录。`tc` 提供**中性**内建 `getenv(name: string) -> string`（读取进程环境变量；未设置返回空串、不 panic；双后端经 `t_getenv` / `tll_getenv` 实现），但 `tc` 自身**不解析**环境变量——包搜索策略完全留给 `tote`（类比 rustc 只收 `-L`、不读 `CARGO_*`）。`tote` 在构造 `tc` 命令时：① 读 `T_LIB_PATH`（`;` 分隔目录列表，与 Windows PATH 一致；**不**按 `:` 切分，以免误拆 Windows 盘符 `C:/...`），逐个以 `--lib-dir <dir>` 注入；② 再追加 `~/.tote/libs`（即 `home_dir() + "/.tote/libs"`，`home_dir` 取自 `USERPROFILE` / `HOMEDRIVE+HOMEPATH` / `HOME`）。`--lib-dir <dir>` 是 `tc` 的中性输入开关，把 `<dir>` 追加进 `g_lib_dirs`（优先级最高，先于工程 `lib/` 命中）。故 `set T_LIB_PATH=C:/my/libs` 后即可 `tote run app.tc` 解析 `import @mylib`（库只放在该目录也能找到）；不设则回退默认搜索路径。验证：库仅置于 `T_LIB_PATH` 目录时 `tote run` 可解析，不设置则 `T_IMPORT_NOT_FOUND`。

```t
// 工程布局：yourproj/{tote.toml, src/{main.tc, hello.tc, d/e.tc}}
// src/hello.tc
export greet fn() -> string { return "hi from hello"; }
export add fn(a: i64, b: i64) -> i64 { return a + b; }

// src/d/e.tc
export deep fn(x: i64) -> i64 { return x + 100; }

// src/main.tc —— 入口（与 hello.tc、d/ 同级，统一从 src/ 解析）
import(src.hello);
import(src.d.e);
main fn() -> i32 @main {
    println(hello.greet());   // import(src.hello) => src/hello.tc
    println(i2s(hello.add(2, 3)));
    println(i2s(e.deep(10))); // import(src.d.e)    => src/d/e.tc，限定前缀取末段 e
    return 0;
}
// 运行：tc run src/main.tc    （输出 hi from hello / 5 / 110）
//         —— 入口目录即 <root>/src，src. 前缀自动从 src/ 拉平编译，无需手动列文件

// 库与选择性导入示例
import(json);                       // 库（首段非 src）→ lib / 依赖库 / out/lib 搜索
import(std.math as m2);            // 模块别名：m2.abs(...) 访问
import(std.mem :: len, reverse as rev);  // 选择性导入 + 改名
main2 fn() -> i32 @main {
    println(m2.abs(-7));           // 7
    println(i2s(len(xs)));         // 直接用 len（选择性导入）
    rev(i64, xs);                   // 用 rev 代替 reverse
    return 0;
}
```

- agent 模块契合：actor 脱糖产物 `XState`/`x_spawn`/`x_step` 标 `export` 后可跨模块复用（消息回路边界）。
- **实现状态（2026-08-08 统一刀 —— 语法统一为 `import(...)`，端到端可跑）**：
  - ✅ **已落地**：旧的 `import @x;`（外部库标记）与裸 `import x;`（工程内）**两种写法删除**，统一为 `import(Path [:: List] [as Alias])`：
    - 解析分流由路径首段决定：`src.` 前缀 → 工程源码根内联（`import(src.hello)`）；否则 → `lib`/依赖库/环境变量搜索（`import(json)`、`import(std.mem)`）。
    - 选择性导入 `:: a as b, *` 经 `mangle_modules` Pass 3（AST 改名）实现，复用 provenance 改写，无新作用域机制。
    - 模块别名 `import(Path as M)` 以 `M.sym` 全限定访问。
    - 旧写法在解析期报友好错误并 `exit(1)`（`import @x; was removed` / `import x; was removed`）。
  - ✅ **配套改动**：`ImportModDecl.bd` 复用为 `is_lib_path`、`lb` 复用为选择性 item 链；新增错误码 `T_IMPORT_BAD_PATH`（空 `src` 路径）、`T_IMPORT_CONFLICT`（选择性名冲突）；`build_std.mjs` 产出嵌套归档 `out/lib/std/{mem,math}.tlib`（匹配 `import(std.mem)` 的 `dots_to_slashes` 解析）；`lib/std/math.tc` 全量补 `export`（链接模式只 `declare` 导出符号，否则 link 期 `undefined`）。
  - ✅ **验证**：examples/tests/conformance 中全部 `import` 迁移至新语法（含 `import @std.mem` → `import(std.mem)`）；四种形式（限定/`::` 改名/`as` 别名/`:: *`）LLVM 后端实测通过；错误路径（`@`/裸/空路径/未导出符号/名冲突）均报正确码；`std_demo` 等 40 例 `run_examples` 全绿；IR 基线重录（52 targets/156 entries）逐字节一致。L2 gate 目标 13 passed/0 failed/0 warn。
  - ⚠ **迁移提示**：历史「第四刀 / 第五刀 / 收尾刀」实现状态条目描述的是 `@` 写法时期，现已由本统一刀取代；其底层机制（命名空间重整、`export` 私有隔离、`build --lib` 链接模式、`T_IMPORT_CYCLE`、依赖图导出、`.tlibd`、环境变量搜索）全部保留并继续生效。
- **实现状态（2026-08-04 第一刀 —— parser + 诊断）**：
  - ✅ **已落地**：parser 支持 `export` 前缀（顶层声明打 `is_export` 标记）、`import xxx [as m]` 标识符形式（旧的 `import "path"` 数据导入保留兼容）；checker 诊断 `T_EXPORT_SCOPE`（`export` 修饰局部/嵌套 `var`/`const` 或 `import` 声明）、`T_IMPORT_NOT_FOUND`（单文件 `tc` 不解析模块，模块解析由 `tote` 构建层完成）。conformance 用例 `p_export_ok` / `f_export_scope` / `f_import_not_found` / `f_export_on_import` 已落地并随 gate 全绿。
- **实现状态（2026-08-04 第二刀 —— whole-program inlining，端到端可跑）**：
  - ✅ **已落地**：`import xxx;` 采用**整体程序内联**策略——将 `xxx.tc` 顶层声明并入同一编译单元（C 的 `#include` 风格、单命名空间），`xxx.foo` 限定访问脱糖为裸 `foo`；单文件程序不受影响。`examples/module_hello/` 现已**真实通过**：双后端 `build`+`run` 输出 `hello from main` / `6` / `hello, world`（`add(2,3)`=6 含私有 `helper` 调用，`greet` 返回 `hello, world`），gate `run_examples` 已覆盖。两处根因修复：
    - `load_module_file` token-append bug：旧实现 `tokenize(msrc); pos = 0;` 因 `tokenize` 是 append 语义（永不清空全局 `toks`），`pos = 0` 重解析入口文件 → 嵌套 import 递归 → 幻影第二个 `main` → `fc_merge` 拒 `main`（0 参数）报 `T_FUNC_CLAUSE_ARITY`。修复：`var saved_pos = pos; var base = slice_len(toks); tokenize(msrc); pos = base; ...; pos = saved_pos;`（嵌套 import 透明返回、恢复调用方解析位置）。
    - `i2s` 代码生成缺口（预先存在，被 `module_hello` 暴露）：LLVM/C emitter 处理 `int_to_str` 但不处理 `i2s` → `; UNSUPPORTED call i2s` → 指针 0 → LLVM verifier `integer constant must have integer type`。修复：在 `builtin_ret`/`td_calls`/LLVM `ll_call`/C emit 四处将 `i2s` 别名到 `int_to_str`（`t_int_to_str` / `@tll_int_to_str`）。
  - ⏳ **待实现（余下）**：`.tlibd`（调试态产物）、`T_IMPORT_CYCLE`（依赖图无环校验，需 `tote` 协同）、C 互操作导出（`.lib`/`.dll`）。⚠ 跨模块可见性隔离的「独立编译 + 链接」形态已在第五刀落地（见下）；环境变量搜索（`T_LIB_PATH`/`~/.tote/libs`）已在第六刀落地（见 rule 10）。本项仅余调试产物/无环校验/C 互操作三类余留。
- **实现状态（2026-08-04 第三刀 —— 工程源码根 + 点分模块名，端到端可跑，commit 71659a3）**：
  - ✅ **已落地**：`import` 语法扩展为**点分模块名**（`import a.b.c;`），`.` 即路径分隔符；解析统一相对**项目源码根 `<src_root>`**（= 入口文件所在目录，标准布局下即 `<root>/src`），故 `import a` ⇒ `<src>/a.tc`、`import d.e` ⇒ `<src>/d/e.tc`。
  - ✅ **限定前缀取末段（Go 风格）**：`import d.e` 以 `e.foo()` 调用，`import net.http` 以 `http.x()` 调用；`as` 别名照旧，裸名亦可直接调用（inlining 单命名空间）。
  - ✅ **版本钉原则落地**：外部依赖版本钉统一归口 `tote.toml`（语法层 `@外部库` 位预留，导入仍走工程内源码）；用户拍板「工程内 `import a` ⇒ `<root>/src/a.tc`，`import d.e` ⇒ `<root>/src/d/e.tc`」。
  - ✅ **验证**：新增 `examples/proj_demo/`（tote.toml + src/main.tc + src/hello.tc + src/d/e.tc），**双后端（LLVM + C）跑通** `hi from hello` / `5` / `110`（`e.deep(10)=110` 证明 `import d.e` + 末段限定 + `as` 别名 + 裸名全对）；`examples/module_hello` 回归无碍；L2 gate 全绿，IR 基线重录后逐字节一致。
  - ⚠ **已知限制（已记入记忆）**：向上查找 `tote.toml` 自动定位 `<root>` 的方案**未启用**——内置 `path_exists`（`sys_run`→`cmd /c if exist`）对绝对路径探测不稳定（触发 `arena: out of memory`）。故以「入口目录 = 源码根」折中，对标准布局等价；约定用法 `tc run src/main.tc`（入口置于 `src/` 下），不要从工程根目录直接 `tc run main.tc`（main 不在 `src/` 下时不会下钻）。
  - ⏳ **待实现（余下）**：`tote.toml` 自动定位 `<root>`（待 `path_exists`/运行时修复后）、`T_IMPORT_CYCLE` 诊断。`.tlib` 预编译产物已在第五刀落地；环境变量搜索（`T_LIB_PATH`/`~/.tote/libs`）已在第六刀落地。
- **实现状态（2026-08-05 第四刀 —— `@` 外部库搜索路径 + 命名空间隔离，端到端可跑）**：
  - ✅ **已落地**：`import @x;` 外部库经**搜索路径 + 命名空间重整**真实隔离（区别于工程内 `import a` 点分源码）。`compute_lib_dirs` 计算候选 `lib/`、`libs/` 目录（入口目录优先，其次各工程根的 `lib/`/`libs/`）；`resolve_external_lib` 按 `<libdir>/x.tc` → `/x/index.tc` → `/x/lib.tc` 探测，全失 → `T_IMPORT_NOT_FOUND`。命中后 `mangle_modules` 对该库（别名 `A`）顶层符号整写为 `A__name`，限定访问 `A.sym` 脱糖为 `A__sym`；未 `export` 符号跨模块访问被强拒：`A.priv()` → `T_MODULE_PRIVATE`，`A.NoType` → `T_MODULE_NO_SYMBOL`；库内自调用同样脱糖 `A__name`（自洽）。入口模块别名 `""` → 永不重整，**单文件程序 IR 逐字节不变**（已重录基线、L2 gate 全绿验证）。
  - ✅ **限定类型 / 字面量**：`parse_type` 支持 `A.T` 限定类型、`parse_prim_ident` 支持 `A.T{...}` 限定结构化字面量，均经 `mangle_modules` 重整为 `A__T`；找不到报 `T_MODULE_NO_SYMBOL`。`clone_type_node` 深拷贝补齐 `sb`（模块限定）字段，修复 agent state 字段类型克隆丢失 `physics.` 前缀退化成 `i64` 的 LLVM link 错误。
  - ✅ **验证**：新增 `examples/lib/json.tc`、`examples/lib/csv.tc`（二者故意同名 `version`/`encode`/`quote`，证明命名空间隔离互不污染）、`examples/extlib_demo.tc`（双后端 `run` 输出 `json/0.1` / `csv/0.1` / `{"count":42}` / `count,42`）；conformance 新增 `f54_ext_import_not_found`（期望 `T_IMPORT_NOT_FOUND`）、`f55_module_private`（期望 `T_MODULE_PRIVATE`）、`f56_module_no_symbol`（期望 `T_MODULE_NO_SYMBOL`），随 gate 全绿。既有 `agentkit_demo`/`agent_npc_mind` 因隔离收紧改为显式 `agentkit.`/`physics.` 限定，已同步修订。Bootstrap 不动点（g2==g3==g4）保持，L2 gate 13 passed/0 failed/0 warn，IR 基线重录（46 targets/138 entries）。
  - ⏳ **待实现（余留）**：`.tlibd`（调试态产物）、内嵌接口块（当前用伴随 `exports.json` 实现等价能力）、`T_IMPORT_CYCLE` 依赖图无环校验、`tote` 依赖图协同、C 互操作导出（`.lib`/`.dll`）。⚠ `.tlib` **真·独立编译 + 链接**（build --lib 产 LLVM 归档 + exports.json；import @x 链接优先、私有跳过、未预编译回退内联）已在 **第五刀（2026-08-05）落地**；环境变量搜索（`T_LIB_PATH`/`~/.tote/libs`）已在 **第六刀（2026-08-05）落地**（见 rule 10），见下。
- **实现状态（2026-08-05 第五刀 —— `@` 外部库真·独立编译 + 链接，端到端可跑）**：
  - ✅ **已落地**：`import @x` 从「整体内联」升级为**真·独立编译 + 链接**，用户拍板选「真·独立编译+链接」模型。核心机制：
    - `build --lib <file.tc>`：以源文件名 stem 作规范别名（`json.tc` → `json`）作为重整命名空间；`g_lib_emit = true` 跳过进程级全局（`t.__ginit`/`t_atom_table`/`t_atom_count`，由主程序提供）；产出 `out/lib/<stem>.tlib`（`clang -c` 编出的 `.o` 经 `llvm-ar rcs` 归档）+ 伴随 `out/lib/<stem>.exports.json`（导出符号接口块：mangled 名 / kind / 类型签名 / arity）。`out/lib` 已加入 `compute_lib_dirs` 搜索目录。
    - `import @x` 双模式（`handle_one_import`）：先查 `<libdir>/x.tlib`，命中进入**链接模式**——载入 exports.json 注册导出符号供类型检查；代码生成阶段（`emit_llfunc`）对库导出符号发 LLVM `declare`（不发 `define`）、私有符号跳过（新增 `g_link_libs` 集合门控）；归档路径进 `g_ext_link`，链接步并入 clang。未找到 `.tlib` 则**回退内联源码**（与第四刀一致，作过渡安全网 → 未预编译时单文件 IR 不变、gate 不漂）。
    - 命名空间隔离在链接模式同样成立：`json`/`csv` 同名 `version`/`encode`/`quote` 经 `json__`/`csv__` 重整 + 独立归档链接，**真正互不污染**；私有 `quote` 在下游零引用、零重复符号。
  - ✅ **验证（端到端）**：`build --lib examples/lib/json.tc` + `build --lib examples/lib/csv.tc` 生成 `out/lib/{json,csv}.tlib` + `.exports.json`；`out/dbg/tc.exe run examples/extlib_demo.tc` 走链接模式，IR 中 `@t.json__version`/`@t.json__encode` 为 `declare`、导入方 0 个 `define ... json__`、0 处 `json__quote` 引用，运行输出与 `extlib_demo.expected.txt` 逐行一致（`json/0.1` / `csv/0.1` / `{"count":42}` / `count,42`）。Bootstrap 不动点保持，L2 gate 13 passed/0 failed/0 warn，IR 基线重录（46 targets/138 entries，仅 `tc.tc` 自身因新增 `build --lib` 代码而预期增长，已重录稳定）。
  - ⚠ **已知限制**：① 环境变量搜索（`~/.tote/libs` / `T_LIB_PATH`）**已在第六刀落地**（见 rule 10），`tc` 提供中性 `getenv` 内建、`tote` 经 `--lib-dir` 注入；② `.tlib` 当前为 LLVM 对象归档（Windows clang 产 COFF `.o`，经 `llvm-ar` 归档），链接走 clang/lld-link，默认 LLVM 后端全链路验证通过；C 后端未预编译时回退内联（gate 即此路径），故双后端 gate 不漂。③ `.tlibd`/内嵌接口块、`T_IMPORT_CYCLE`、C 互操作导出仍待办。

- **实现状态（2026-08-05 外部库收尾刀 —— `.tlibd` / `T_IMPORT_CYCLE` / 依赖图导出，端到端可跑）**：
  - ✅ **已落地**：
    - **`T_IMPORT_CYCLE` 无环校验**：`handle_one_import` 维护 DFS 活跃栈 `g_mod_stack`/`g_mod_stack_alias`（进入压栈、离开弹栈），若被导入模块已在活跃栈中 → 真成环 → 发射 `T_IMPORT_CYCLE`（如 `a→b→a`）；去重仍靠 `in_mod_visited`（菱形共享根只加载一次、不报错）。
    - **依赖图导出 `tc --emit-deps`**：`tc check --emit-deps <file>`（flag 位置无关，可前后）输出合法 JSON `{"entry":...,"edges":[{"from":<parent>,"to":<child>}]}`。父=活跃栈顶别名（入口为 `"<entry>"`），子=被导入别名；边记录置于钻石去重 `return` 之前，确保菱形（如 `a→b→d`、`a→c→d`）记录全部 4 条边（`c→d` 不丢）。边闭合用 `sb_append_char(out,34)`+`sb_append_char(out,125)` 逐字符追加 `}"`，规避 `t` 字符串字面量「`\"}` 被词法分析成 `"}`」的转义陷阱。
    - **`tote deps` 子命令**：`tote deps <file.tc>` 委托 `tc check --emit-deps` 并注入 `--lib-dir`（`T_LIB_PATH`/`~/.tote/libs`），输出同依赖图 JSON。
    - **调试态归档 `.tlibd`**：`tc build --lib --debug <file.tc>` 产 `out/lib/<stem>.tlibd`（`clang -O0 -gcodeview` 编 `.o` 经 `llvm-ar rcs`）+ 伴随 `out/lib/<stem>.tlibd.exports.json`；`tc --debug-libs` 令 `resolve_external_lib_archive` 优先探测 `.tlibd`（未命中回退 `.tlib`，再回退内联）。`tote build`/`run`（未显式 `--mode rls`）自动追加 `--debug-libs`。
  - ✅ **验证**：conformance 新增 `f59_import_cycle`（`a→b→a` 期望 `error T_IMPORT_CYCLE`）、`p35_import_diamond`（菱形 4 边全记、期望 `pass` 不报环）；`tote deps examples/extlib_demo.tc` 输出 `{"entry":...,"edges":[{"from":"<entry>","to":"json"},{"from":"<entry>","to":"csv"}]}`；`tc build --lib --debug examples/lib/json.tc` 产出 `out/lib/json.tlibd`。Bootstrap 不动点保持，L2 gate 13 passed/0 failed/0 warn，IR 基线已重录（46 targets/138 entries）。
  - ⏳ **待实现（余留）**：内嵌接口块（当前 `.exports.json` 等价）、链接模式（`.tlib`）下的 `T_IMPORT_CYCLE` 复检、C 互操作导出（`.lib`/`.dll`）。

---

### 3.14 Tests（测试声明）✅ tc（2026-08-08）

测试是**并置式声明**，与 `Name fn`/`Name struct`/`Name enum` 同族——只是「名字」位置放的是字符串字面量而非标识符，因为测试名是给人读的句子，不是标识符。

```ebnf
TestDecl:
    Annotation* StringLiteral "test" Annotation* Block

SuiteDecl:
    Annotation* StringLiteral "suite" Annotation* Block   // 体内只许 TestDecl / SuiteDecl

ExpectStatement:
    "expect" "(" Expression ("," StringLiteral)? ")" ";"
```

- `test` / `suite` / `expect` 均为**语境关键字**（不进 `keywords_tbl`，不影响同名标识符）：
  - `test` / `suite`：仅在「声明位置且前一个 token 是字符串字面量」时生效；
  - `expect`：仅在「语句位置且下一个 token 是 `(`」时生效。
- 注解可写在字符串前或 `test`/`suite` 后，两处等价（都并进同一条注解链）。
- `suite` 只做**词法分组**，自身不产生任何声明；suite 上的注解**逐成员复制下沉**，故 `@skip` / `@tag` 写在 suite 上天然作用于整组。suite 可嵌套，路径以 ` / ` 连接。

**脱糖**（`parse_test_decl`）：

```
"名字" test { BODY }
  ⇒  __test_<n> fn() bool @test { BODY; return true; }
     FuncDecl.bd = true   // 是测试
     FuncDecl.sb = "名字" // 显示名
     FuncDecl.sc = suite 路径
```

测试以「跑完没炸」为通过，末尾隐式 `return true;`；`expect` 失败会提前 `return false`。

**`expect` 内建 + CTFE 自省**：`expect(EXPR)` 在解析期就地捕获 `EXPR` 的**源码切片**（`Tok` 只有 `t/v/line/col`、无字节偏移，源文本在 `tokenize()` 后不可达，故必须在解析期用 `rebuild_tokens` 重建），脱糖为：

```
expect(EXPR[, "说明"]);
  ⇒  if (!(EXPR)) {
         eprint(format("  expect failed: {} @ {}:{}[  ({})]\n", "<EXPR 源码>", <file>, <line>[, "说明"]));
         return false;
     }
```

零新增运行时符号（复用 `format`/`eprint`）。**失败详情走 stderr，判定行走 stdout**，故详情自带前后换行以免与判定行交错。

**测试注解**：

| 注解 | 语义 |
|---|---|
| `@skip` / `@skip("原因")` | 不执行，计入 skipped |
| `@only` | 存在任一 `@only` 时，本次只跑被标记的测试 |
| `@should_fail` | 期望失败；返回 false 才算通过 |
| `@tag(a, b)` | 打标签，供 `tc test --tag <name>` 过滤 |

**运行器 `tc test`**：

```
tc test <file.tc> [--filter <substr>] [--tag <name>] [--mode dbg|rls] [--no-run]
```

单遍解析 + token 追加：先 `tokenize(源码)` 并记录 token 数作标记 → `parse_unit()` 收集测试 → 生成 `@main` runner 源码后 `tokenize` **追加**（`tokenize()` 是 append 语义、`parse_unit()` 遇 `Eof` 即停）→ 把 `pos` 回拨到标记处续 parse。用户代码与 runner 因此走**同一次完整 sema**，无需重置任何全局。文件自带的 `@main` 在本次运行中被摘除（发 note）。输出：

```
running 8 test(s)

test add 应返回两数之和 ... ok
test loops / sum_to 应累加到 n ... ok
test 待补：跳过示例 ... skipped

test result: 7 passed, 0 failed, 1 skipped
```

有失败时进程退出码非 0。

**旧注解迁移**（弃用别名过渡，发 `T_ANNOTATION_UNKNOWN` **warning**、不阻断）：

| 旧 | 新 |
|---|---|
| `name fn() bool @test` | `"name" test { }` |
| `@test_skip` | `@skip` |
| `@test_only` | `@only` |
| `@expect_fail` | `@should_fail` |
| `@test_group("g")` | `"g" suite { }` |

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
                | TestDecl | SuiteDecl
                | GlobalVarDecl | ConstDecl | InnerAttribute
FuncDecl        : Ident "fn" "(" Params? ")" ("->")? Type Anns? Block
StructDecl      : Ident "struct" Anns? "{" Field* "}"
FlagDecl        : Ident "flag" "[" IntType "]" "{" Slot* "}"
VariantDecl     : Ident "variant" "{" Case* "}"
TestDecl        : String "test" Anns? Block
SuiteDecl       : String "suite" Anns? "{" (TestDecl | SuiteDecl)* "}"
Block           : "{" Statement* "}"
Statement       : VarDecl | ConstDecl | Assign | If | While | Return | ExprStmt | Block
                | ExpectStmt
ExpectStmt      : "expect" "(" Expression ("," String)? ")" ";"
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
| §5 | CTFE / type_info(T) 内建 | ⚠ 字段自省已接入（ti_*/fi_*，含 fi_tag）；comptime 求值/注解元数据仍为 partial |
| §6 | flag[T] 位域 + flag_set/get | ✅ 已实现（含 SlotInfo 自省） |
| §7.2 | 外部数据导入 CSV/JSON（CTFE 脱糖） | ✅ 已实现 |
| §2.3 | 字符串驻留符号 Sym32/Sym16（intern / sym_str / sym_release） | ✅ 已实现（M40） |
| §3.11 | 时间格式化（strftime `%` 风格）+ 解析/固定时区/locale/M57 增量 | ✅ 已实现（M56 / M57） |
| §3.14 | 测试声明 `"名" test/suite {}` + `expect` + `tc test` 运行器 | ✅ 已实现（2026-08-08；旧 `@test` 系列转弃用别名） |

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
