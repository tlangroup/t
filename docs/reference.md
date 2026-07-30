# The t Language Reference

> 版本 v1 (基于 `docs/spec.md` 设计终稿整理)
> 本文档描述 **t** 编程语言的词法与语法形式，采用类似 *The Rust Reference* 的记号约定。
> 文中每个语法产生式给出 **Syntax**、可选 **Where** 约束、以及 **Examples**。
> 凡当前 `tote` 编译器尚未实现、仅属 spec 设计目标的条目，以 `⚠ spec-only` 标注；已实现条目以 `✅ tote` 标注。

> **语法根本源（single source of truth）**：本文档 **`docs/reference.md`** 是 **t** 语法的权威描述，其中各节以 `ebnf` 代码块给出的产生式即文法的机器可读表示。
> 由 `tools/gen_ebnf.mjs` 抽取本文档的 `ebnf` 块生成 [`build/ebnf.json`](./../build/ebnf.json)；`src/totter.tc` 解析 `ebnf.json` 驱动生成 `gen/tote.tc` 的词法关键字表与（后续）递归下降解析器（数据驱动生成管线）。修改文法应改本文档的 `ebnf` 产生式并重新生成 `ebnf.json`，而非手写 `ebnf.json` 或 `tote.tc`。

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
- ebnf 块内注释统一为两种形式：`//` 行注释与 `/* ... */` 块注释。状态注记（`⚠ spec-only`、`✅ tote` 等）一律写在上述注释内部，不单独成句。注释文本由 `tools/gen_ebnf.mjs` 在抽取时从产生式中**剥离**（尊重引号，不会误删 `"//"`、`"/*"` 这类字面量），但其中的状态注记会被**结构化抽取**进 `build/ebnf.json` 的 `rules` 段：每条 rule 带 `status` 字段（`"tote"` 已实现 / `"partial"` 部分实现 / `"spec-only"` 仅设计 / `"unspecified"` 未注记），规则级状态取头行注记、缺省继承最近章节标题（`##`/`###`/`####`）的注记；每个 alt 为 `{text, status?, note?}` 对象，行内注释的注记附着到对应 alt 并覆盖规则级。该字段是 rules 驱动 parser 生成的过滤依据（生成器只应消费 `tote`/`partial` 条目）。

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
    "func" -> KwFunc
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
  | "switch" -> KwSwitch
  | "case" -> KwCase
  | "default" -> KwDefault
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

> 关键字由 `lex` 阶段查表（`kw_lookup`，基于 `keywords_tbl`）判定。其权威列表即上方 `Keyword` 产生式中的字面量，由 `tools/gen_ebnf.mjs` 抽取生成 `build/ebnf.json`、`src/totter.tc` 解析后生成进 `gen/tote.tc`。`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f16`/`f32`/`f64`/`bool`/`type` 为**内建类型名**（见 §3.5），不是关键字。
> ⚠ spec-only（设计中、tote 未接入）：`union`、`enum` 完整语义、`comptime` 表达式。

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
  | "->" | ":" | "::" | ";" | "," | "." | ".."
  | "(" | ")" | "{" | "}" | "[" | "]" | "@" | "#"
```

- `::` 为声明绑定算子（`Name :: func ...`、`Name :: struct ...`）。
- `#` 用于内存布局指令 `#aos` / `#soa`（⚠ spec-only 实变换未接入）。
- `@` 引入注解 `@name(args)`。

### 2.6 Compiler data tables（机器可读数据表）✅ tote

以下五个产生式以 `ebnf` 块形式给出编译器内部**可枚举目录**（关键字表、内建返回类型、@derive trait、诊断码、注解注册表）。它们由 `tools/gen_ebnf.mjs` 从本文档抽取、生成 [`build/ebnf.json`](./../build/ebnf.json) 的对应字段，再由 `src/totter.tc` 驱动生成 `gen/tote.tc` 的 5 个 `GEN:` 标记区间。**修改这些目录应改本节的 `ebnf` 产生式并重新生成 `ebnf.json`**，而非手写 `ebnf.json` 或 `tote.tc`。

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
  | "file_write_all" => ti_scalar("bool")
  | "args" => ti_elem_of("Slice", ti_mk("String"))
  | "sb_new" => ti_mk("StringBuilder")

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

以下 `ebnf` 块给出递归下降解析器中**关键字驱动的分发表**：每条 `NameDispatch:` 规则列出「当前 token → 调用的 `parse_*` 函数」。它们由 `tools/gen_ebnf.mjs` 抽取进 `build/ebnf.json` 的 `dispatches` 段，再由 `src/totter.tc` 生成进 `gen/tote.tc` 的 `GEN:parser_dispatch` 标记区间，从而令 `parse_decl_body` 等分发表由文法数据驱动（取代手写 if 链）。

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

以下 `// @rule` 文法是**递归下降 parser 的权威生成源**：`tools/gen_ebnf.mjs` 把每条规则的 body 解析成结构化 EBNF 树（含 FIRST 集），再由 `src/totter.tc` 发射进 `gen/tote.tc` 的 `GEN:parser` 标记区间，生成 `parse_<rule>` 函数，取代对应手写实现。

记号：
- `// @rule <name> params=(...) ret=<T> node=<NodeKind> eatFirst=<bool>`：规则元数据。`eatFirst=true` 表示被分发表按关键字匹配后，函数先 `advance_i()` 吃掉该关键字（如 `variant`）。
- body 为 EBNF：`A B` 序列、`A | B` 选择、`A?`/`A*`/`A+` 可选/重复、`(...)` 分组、`"X"` 字面量（映射到 token 种类）、`Ident` 标识符终端、`type`/`anns`/`case` 等非终结符（映射到 `parse_*` 调用）。
- `{ field = expr }` 节点构造块：`field` 为 AST 节点字段；`expr` 中 `@sym` 引用 body 中符号的解析结果，`name`/`anns` 等参数名与 `list_concat(...)` 等辅助调用原样保留。
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

// @rule sfield params=() ret=i64 node=F eatFirst=false
// 成员二分形态：位宽成员（@bitpack 结构体，`name: 3;`）以 Integer 开头，
// 类型成员以其余 token 开头——FIRST 可区分，故用 alt 而非结构体级 is_bitpack 状态。
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
// 目标函数一律签名 () -> i64、自行消费引导 token：if/for/while/switch/return 为既有函数原样路由；
// break/continue/defer/comptime/block/var/const 为下沉胶水（block_stmt 用 pos 做位点故不 advance）。

// @rule statement params=() ret=i64 node=_ eatFirst=false fold=disp
statement :: "if" if_stmt | "for" for_stmt | "while" while_stmt | "switch" switch_stmt | "return" return_stmt | "break" break_stmt | "continue" continue_stmt | "defer" defer_stmt | "comptime" comptime_stmt | "{" block_stmt | "var" var_stmt | "const" const_stmt | expr_or_assign_stmt

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

// ── 语句体内部结构（fold=forx：peek 前瞻分发两段式 for：Identifier KwIn=for_each，否则 C 式三子句）──
// 形状：for "(" ( Ident "in" expr | (expr? ";" expr? ";" expr?) ) ")" block  →  守卫式骨架按 peek_t(1) 分流。

// @rule for_stmt params=() ret=i64 node=For eatFirst=true fold=forx
for_stmt :: "(" ( Ident "in" expr | expr? ";" expr? ";" expr? ) ")" block

// ── 语句体内部结构（fold=swx：case/default 循环聚合，default 缺省 -2 兜底）──
// 形状：switch "(" expr ")" "{" ( "case" expr ":" statement* | "default" ":" statement* )* "}"  →  循环收集 CS 节点。

// @rule switch_stmt params=() ret=i64 node=Switch eatFirst=true fold=swx
switch_stmt :: "(" expr ")" "{" ( "case" expr ":" statement* | "default" ":" statement* )* "}"
```

- 终端约定：`Ident` → `expect_tok("Identifier")`（string 结果）；`Integer` → `expect_tok("Integer")`（string 结果，字面量文本）。
- 语义胶水以**手写 helper** 下沉：`str_or(s, d)`（可选捕获缺省值）、`flag_offset_of(anns)`/`flag_has_offset(anns)`（`@offset(n)` 注解参数提取）——文法保持纯结构，构造块直接调用。
- ✅ tote（部分）：`type_alias`、`variant_decl`/`case`、`flag_decl`/`slot`、`flag_set_decl`/`setmember`、`union_decl`/`umember`、`struct_decl`/`sfield` 已由此文法数据驱动生成（`GEN:parser_rules`），经 difftest 与 conformance 验证。至此全部结构型声明均为数据驱动生成。
- ✅ tote（续）：表达式二进制优先级塔 `or`/`and`/`bitor`/`bitxor`/`bitand`/`eq`/`cmp`/`shift`/`add`/`mul` 亦以此文法以 `fold=bin` 规则生成（左结合 `while` + `mk_bin` 折叠），替换 10 个手写函数。
- ✅ tote（续）：表达式前缀一元运算符 `unary` 亦以此文法以 `fold=pre` 规则生成（右结合前缀折叠 + `mk_un` 构造），替换手写 `parse_unary`。
- ✅ tote（续）：表达式后缀 `postfix` 亦以此文法以 `fold=post` 规则生成（左结合后缀折叠骨架 + 胶水 helper `post_member`/`post_index`/`post_call`/`post_cast` 下沉），替换手写 `parse_postfix`。
- ✅ tote（续）：表达式基底 `primary` 亦以此文法以 `fold=prim` 规则生成（终端驱动 dispatch 骨架 + 9 个胶水 helper `prim_int`/`prim_float`/`prim_str`/`prim_true`/`prim_false`/`prim_null`/`prim_ident`/`prim_paren`/`prim_array` 下沉）。**表达式金字塔 or→…→primary 全部数据驱动生成。**
- ✅ tote（续）：语句顶层分发 `statement` 亦以此文法以 `fold=disp` 规则生成（守卫式分发骨架：if/for/while/switch/return 路由既有函数，break/continue/defer/comptime/block/var/const 下沉为胶水，兜底 `expr_or_assign_stmt`），替换手写 `parse_statement`。
- ✅ tote（续）：语句体内部结构亦以文法表达——`while_stmt`/`return_stmt` 以 `fold=whilex`/`fold=returnx`（纯序列 + node_at 守卫）生成；`if_stmt` 以 `fold=ifx`（if/else-if 链，else 分支嵌套 if 包成单元素 list 兜底）生成；`for_stmt` 以 `fold=forx`（peek_t(1) 前瞻分流 for_each / C 式三子句）生成；`switch_stmt` 以 `fold=swx`（case/default 循环聚合，default 缺省 -2）生成。五者各自替换对应手写 `parse_*` 函数，`local_var`（名校验副作用 + nti 定位）仍保留为胶水。`statement` 顶层分发路由目标现为全数据驱动生成。

---

### 2.9 AST node kinds（数据驱动生成的节点种类表）✅ tote

节点种类（AST 的 `kind` 标签）的单一真相源。totter 读取本表（经 `tools/gen_ebnf.mjs` → `build/ebnf.json` 的 `nodes` 段）生成 `Node` 结构、`node_new` / `node_at`、节点种类注册表（`node_kind_names` / `init_node_kinds` / `is_node_kind`），以及**每个种类的构造器 `mk_<kind>(槽参数…, ti)`**。

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
  // @node for_each sa=str na=node la=list
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
  // @node switch na=node la=list lb=list
  // @node unary sa=str na=node
  // @node var_decl sa=str ba=bool na=node nb=node
  // @node variant
  // @node while na=node la=list
```

## 3. Syntax（语法）

### 3.1 Items（顶层条目）

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
    FuncName "::" "func" "(" (Param ("," Param)*)? ")" "->" Type FuncAnns? Block

FuncName: IDENTIFIER
Param:    ParamName ":" Type
```

- 函数**必须**用 `Name :: func(...) -> Ret { ... }` 绑定形式声明（spec §1.3：参数类型后置、禁止重载、禁止隐式返回、所有分支显式 `return`）。
- ✅ tote：已支持 `func` 声明、`@main` 入口、`@test` 等注解；`enum` 完整语义、`union` 标记但未实装。

```ebnf
StructDecl:
    StructName "::" "struct" StructAnns? "{" (StructField ";")* "}"

StructField:
    FieldName ":" Type (Annotation)*

StructAnns:
    "@derive" "(" DeriveCap ("," DeriveCap)* ")"
```

- 字段以 `;` 结尾；字段可挂 `@doc` / `@export` / `@binary_offset(N)` / `@binary_skip` 等注解。
- ⚠ spec-only：`@derive` 全能力（当前 tote 的 `@derive` 处理函数体为空壳/带已知 bug，见 `src/tote.tc` `process_derive`）。

```ebnf
FlagDecl:
    FlagName "::" "flag" "[" IntType "]" "{" (FlagSlot ";")* "}"

FlagSlot:
    SlotName ":" Digits FlagSlotAnns?

FlagSlotAnns:
    "@offset" "(" Digits ")"
```

- ✅ tote 已实现 `flag[T]`：自上而下自动分配比特；`@offset(N)` 强制起始位；1bit 布尔位允许位运算、≥2bit 数值位域仅用 `flag_set/flag_get`。
- ⚠ spec-only：`flag_set` 动态变长容器 `flag_set { ... }`（超出 u64 时使用）。

```ebnf
VariantDecl:
    VariantName "::" "variant" "{" (VariantCase ";")* "}"

VariantCase:
      CaseName "(" Type ("," Type)* ")"      // 携带载荷
    | CaseName                               // 单元 case
```

- ✅ tote：已实装 variant，编译器为每个 case 生成 `Name_from_CaseX`、`Name_is_CaseX`、`Name_as_CaseX` 自由函数（`_tag` 为声明下标，0 起）。
- ⚠ spec-only：Variant 上 `@derive` 暂未支持。

### 3.2 Annotations（注解） ✅ tote（注册表已数据化）

```ebnf
Annotation:
    "@" AnnName ("(" AnnArg ("," AnnArg)* ")")?

AnnName: IDENTIFIER
AnnArg:  Expression | StringLiteral
```

注解可挂于类型、字段、函数、全局节点；全部经 `type_info(T)` 编译期自省读取（⚠ `type_info` 内建尚未接入）。当前 tote `init_anndefs` 已表驱注册全量注解（spec §4.8）：

- 测试类：`@test` `@test_skip` `@test_only` `@expect_fail` `@test_group("分组")`
- 派生类：`@derive(ToString,FromString,Clone,Copy,DebugPrint,BinarySerde,Eq,Hash)`
- 条件编译：`@cfg()` `@cfg_attr()` ⚠ spec-only
- 警告管控：`@allow()` `@warn()` `@deny()` `@deprecated("提示")` ⚠ spec-only
- 布局/ABI：`@repr()` `@no_padding` `@align()` `@binary_offset` `@binary_skip` `@bitpack(T)` `@offset(N)` `@soa` `@aos` ⚠ 多数为 spec-only
- 函数约束：`@inline` `@no_inline` `@must_use` `@const_fn` `@unsafe` `@main` `@export_symbol` `@link_name` `@panic_handler` `@doc` `@doc_file`

### 3.3 Statements（语句） ✅ tote（核心）

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
    | SwitchStatement                        // ✅ tote
    | ReturnStatement
    | BreakStatement                         // ✅ tote
    | ContinueStatement                      // ✅ tote
    | Block

VarDeclStatement:   "var" Ident ":" Type ("=" Expression)? ";"
ConstDeclStatement: "const" Ident ":" Type "=" Expression ";"
AssignStatement:    Expression "=" Expression ";"
ReturnStatement:    "return" Expression? ";"
ExpressionStatement: Expression ";"
```

**语句强制规则（spec §1.2）：**

- `if/for/while/switch` **强制大括号**包裹，禁止单行省略。
- 语句必须以 `;` 结尾。
- 禁用三元运算符、`do-while`、`goto`。
- 多优先级运算必须手动加括号。
- 禁止隐式布尔判定：条件必须显式比较（如 `if ((mask & F.x) != 0) { }`）。

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

SwitchStatement:                                     // ✅ tote
    "switch" "(" Expression ")" "{" SwitchCase* SwitchDefault? "}"

SwitchCase:
    "case" Expression ":" Statement*

SwitchDefault:
    "default" ":" Statement*

BreakStatement:    "break" ";"                       // ✅ tote
ContinueStatement: "continue" ";"                    // ✅ tote
```

- ✅ tote：`if/else`、`while`、`for`（C 风格三段式，init 支持 `var` 声明）、`switch/case/default`、`break`、`continue` 均已实装（含 LLVM 后端；见 build/lltest/stmt_probe.tc 实测）。

### 3.4 Expressions（表达式） ✅ tote（核心）

```ebnf
Expression:
      Literal
    | Ident
    | Expression "." Ident                  // 字段/方法访问
    | Expression "[" Expression "]"         // 索引 ⚠ spec-only
    | Expression "(" (Expression ("," Expression)*)? ")"   // 调用
    | UnaryOp Expression
    | Expression BinaryOp Expression
    | "(" Expression ")"
    | Block

UnaryOp:  "-" | "!" | "~"
BinaryOp:
      "*" | "/" | "%" | "+" | "-"           // 算术
    | "<<" | ">>" | "&" | "|" | "^"         // 位
    | "<" | ">" | "<=" | ">=" | "==" | "!=" // 比较
    | "&&" | "||"                           // 逻辑

Block: "{" Statement* "}"
```

- 二元运算符优先级（从高到低，spec §1.2 要求手动加括号消除歧义，下表为推荐优先级）：
  1. 一元 `- ! ~`
  2. `*` `/` `%`
  3. `+` `-`
  4. `<<` `>>`
  5. `&`
  6. `^`
  7. `|`
  8. `<` `>` `<=` `>=` `==` `!=`
  9. `&&`
  10. `||`
- `>>>` 注意：比较/移位序列中 `>>` 不得被词法拆成两个 `>`。
- 调用与字段访问左结合。

### 3.5 Types（类型） ✅ tote（核心）

```ebnf
Type:
      IntType | FloatType | "bool" | "string" | "StringBuilder"
    | "[" Type "]"                       // 动态切片 []T
    | "[" IntegerLiteral "]" Type        // 定长数组 [N]T  ⚠ spec-only 部分
    | "map" "[" Type "]" Type            // 哈希映射 map[K]V  ⚠ spec-only
    | TypeName                           // 命名类型（struct/enum/flag/variant）
    | "func" "(" (Type ("," Type)*)? ")" "->" Type   // ⚠ spec-only 函数类型

IntType:  "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
FloatType:"f16" | "f32" | "f64"
```

- ✅ tote：标量固定位宽 + `string`/`StringBuilder` + `[]T` 切片均实装；`[N]T`/`map[K]V`/函数类型为 spec-only。
- 类型名解析：先查内建，再查当前单元已声明命名类型。

### 3.6 Comptime & introspection（编译期与自省） ⚠ spec-only（设计目标）

```ebnf
ComptimeFunc: "comptime" "func" ...           // 与运行时同写法，编译期执行
TypeInfoExpr: "type_info" "(" Type ")"        // 编译期类型自省（字段/偏移/位宽/注解）
ImportExpr:   "import_csv" "(" StringLiteral ")" | "import_json" "(" StringLiteral ")"
```

- spec §5：`comptime` 函数语法与运行时一致；支持编译期读取外部 CSV/JSON 并固化为静态常量、完成值域校验。
- `type_info(T)` 是 `@derive`、序列化、编辑器导出、CTFE 导入的**核心底座**，当前 tote 的 `TypeInfo` 池为简化版、内建未接入。

### 3.7 Flag builtins（位域内建函数） ✅ tote

```ebnf
FlagSetCall: "flag_set" "(" FlagInstance "," SlotName "," IntegerLiteral "|" Expression ")"
FlagGetCall: "flag_get" "(" FlagInstance "," SlotName ")"
```

- 1bit 单比特布尔位：允许 `| & ^ |= &= ^=`，布尔判断须完整非零比较。
- ≥2bit 数值位域：**禁止**直接位运算，仅用 `flag_set` / `flag_get`；越界双层校验（常量编译报错，变量运行时报错 + JSON 修复建议）。

---

## 4. Program entry（程序入口） ✅ tote

```ebnf
EntryPoint: FuncDecl with "@main" annotation
```

- 可用 `@main` 显式标记入口（替代固定名 `main`）：`app_entry :: func() -> i32 @main { ... }`。
- tote 代码生成：被 `@main` 标记的函数发射为 `int32_t t_entry_<name>(void)`，并在生成的 `int main()` 中按序调用 `t_runtime_init` → `t_runtime_set_arena` → `t_entry_<name>()` → `t_runtime_done()`，返回退出码。

---

## 5. Grammar summary（文法总览）

```ebnf
TranslationUnit : ModuleItem*
ModuleItem      : FuncDecl | StructDecl | FlagDecl | VariantDecl
                | GlobalVarDecl | ConstDecl | InnerAttribute
FuncDecl        : Ident "::" "func" "(" Params? ")" "->" Type Anns? Block
StructDecl      : Ident "::" "struct" Anns? "{" Field* "}"
FlagDecl        : Ident "::" "flag" "[" IntType "]" "{" Slot* "}"
VariantDecl     : Ident "::" "variant" "{" Case* "}"
Block           : "{" Statement* "}"
Statement       : VarDecl | ConstDecl | Assign | If | While | Return | ExprStmt | Block
Expression      : Literal | Ident | Call | FieldAccess | Unary | Binary | "(" Expression ")"
Type            : Scalar | "[]" Type | "[" N "]" Type | NamedType
Annotation      : "@" Ident ("(" ArgList? ")")?
```

---

## 6. Implementation status vs spec（与 tote 实现面对应）

| spec 章节 | 能力 | tote 状态 |
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
| §7 | 外部数据导入 CSV/JSON | ⚠ 完全缺失 |

> 设计哲学落地：**语法根本源为 `docs/reference.md`**（内含 `ebnf` 产生式块），经 `tools/gen_ebnf.mjs` 生成 `build/ebnf.json`，再由 `src/totter.tc` 数据驱动生成 `gen/tote.tc`（见 `src/tote.tc` `kw_lookup` 等标记区间）。这是「数据优先」原则在编译器构造上的直接应用。
