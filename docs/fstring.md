# f-string 字面量

f-string（格式化字符串字面量）是 `t` 的字符串插值语法。它是**解析期**被整体脱糖为 `format` 调用的语法糖，复用 M55 已有的 `desugar_format_call` → `__fmt_N` 提升机制（StringBuilder 顺序拼接），不引入独立的运行时路径。

本文是相对于 `docs/reference.md` §3.10.7 的**设计文档**，记录动机、脱糖机制、转换字段语义、实现落点与踩坑。文法以 §3.10.7 为权威，本文仅复述要点。

## 1. 动机

- 数据驱动 / ECS 取向的语言需要内建、可读性好的字符串插值，避免在热路径里手写 `sb_append_*` 拼接。
- 不新造后端路径：f-string 在解析期就改写成对既有 `format` 的调用，因此双后端（C / LLVM IR）无需为它写任何特例，只复用 `format` 的提升机制即可。
- 转换字段（`!s/!r/!a/!j/!p/!c`）把「格式化输出」从「手动调库」提升为一等语法，覆盖调试（repr）、序列化（json/pbtxt/csv）等高频场景。

## 2. 语法规范

权威 EBNF 见 `docs/reference.md` §3.10.7。要点：

```
PrimaryExpr        ::= FormatStringLiteral | ...
FormatStringLiteral ::= ShortFormatString | LongFormatString
ShortFormatString ::= "f\"" FormatContent? "\""
LongFormatString  ::= "f\"\"\"" LongFormatContent? "\"\"\""
FormatContent     ::= ( FormatSegment | EscapeBrace | Interpolation )*
FormatSegment     ::= [^{}\\]+
EscapeBrace       ::= "{{" | "}}"
Interpolation     ::= "{" Expr ("!" Conversion)? (":" FormatSpec)? "}"
Conversion        ::= "s" | "r" | "a" | "j" | "p" | "c"
FormatSpec        ::= [^"}"]+
```

- 短式 `f"..."` 与长式 `f"""..."""` 并存，长式可在内部直接包含 `"`。
- 插值 `{Expr}` 里 `Expr` 是任意表达式（含嵌套 f-string、函数调用、算术）。
- 转换字段 `!conv` 与格式规范 `:spec` 可选。
- `{{` / `}}` 转义为字面量花括号。

## 3. 脱糖机制

f-string 不产生新 AST 节点，而是被改写成对 `format` 的调用。

### 3.1 lex —— 整段扫成一个 token

整段 f-string（含 `f"` 前缀、`{` 插值、闭合引号）被扫成一个 `FormatString` token 入全局 `toks` 池。

> ⚠ **关键约束**：`Tok` 只有 `t/v/line/col`，**无字节偏移**。源文本在 `tokenize()` 后不可达，因此 f-string 的二次切段、插值二次 tokenize 必须在解析期**就地用该 token 的文本**完成，不能回头切片源文件。

### 3.2 parse —— 切段、定位 conv/spec、二次 tokenize

`parse_fstring` 在该 token 上：

1. 切出模板段、插值段、转义花括号；
2. 在每个插值里定位 `!conv` 与 `:spec`，并用 `fstr_prev_ends_expr` 判断 `!` 前是否为一个**已完结的表达式**（防止 `{!ok}` 前缀取反被误判为转换字段）；
3. 把插值文本**二次 tokenize** 后调 `parse_expr`；
4. 构造 `mk_call(mk_ident("format", ti), f_head, ti)`。零插值退化为直接 `format("模板")`。

> ⚠ **代码落点**：f-string 手写代码（含 `fstr_is_conv` / `fstr_prev_ends_expr` / `parse_fstring` / dispatch）必须位于 `// >>> GEN:parser_rules ... <<< GEN:parser_rules <<<` 自动生成区间**之外**——否则会被 `tools/totter.tc` 重生成覆盖。已用脚本整体移出，置于 `GEN:parser_rules` 标记之前。

### 3.3 sema —— 消费 `!conv` 并派发

`desugar_format_call` 消费 `!conv`，按值类型选择运行时函数：

- 字符串 + `!r/!a/!j` → `sb_append_fmt_str_conv`（带 mode 字符）；
- 其余组合走原 `sb_append_fmt_*`（无 conv 文本转换）。

转换字母非法（如 `!z`）时，在 `desugar_format_call` 路径报 `T_FMT_BAD_CONVERSION`；f-string 路径则在解析期直接报错（更早发现）。

## 4. 转换字段语义

六种转换，作用于**任意值类型**（不再限于整数）：

| 字段 | 含义 | 字符串示例（`x"y` / `a,b` / `a"b`） | 标量（int / bool） |
|---|---|---|---|
| `!s` | str（默认） | `x"y` | 裸值 |
| `!r` | repr | `"x\"y"` | 裸值 |
| `!a` | ascii | `"x\u0022y"` | 裸值 |
| `!j` | json | `"x\"y"` | 裸值 |
| `!p` | pbtxt | `"x\"y"` | 裸值 |
| `!c` | csv | `"a""b"`（含 `"` 才加引号、`"` 翻倍）；`"x,y"`（含 `,` 才加引号） | 裸值 |

语义要点（与 CPython 同构：**先转换成字符串，再套格式规范**）：

- **字符串走格式专属转义，标量序列化即裸值**——json / pbtxt / csv 对一个数等价。这是 `t` 相对 CPython 的扩展：`!c`/`!p` 不再是「整数专用」的码点 / 十六进制，而是任意值的序列化格式。
- `!a` ascii：非 ASCII 字符必须做 **UTF-8 解码**成码点后用 `\uXXXX` / `\UXXXXXXXX` 转义，**不能**按 UTF-8 字节逐个 `\xHH`（那是错的）。
- `!c` csv：仅当单元格含 `"`、`,`、`\n` 之一时才加引号；内部的 `"` 翻倍为 `""`。
- `!p` pbtxt：protobuf 文本格式风格转义（控制字符、引号、反斜杠转义）。
- `!` 只有在紧跟一个已完结表达式时才当转换字段，故 `f"{!ok}"`（前缀取反）、`f"{a != b}"` 不受影响。

## 5. 实现落点

| 层 | 文件 | 关键点 |
|---|---|---|
| lex | `src/lex.tc` | 整段 f-string 扫成单个 `FormatString` token（短式扫描起点 `i + 2`，长式 `i + 4`） |
| parse | `src/parse.tc` | `parse_fstring` 切段 → 二次 tokenize 插值 → 脱糖成 `format(模板, 实参...)`；代码在 `GEN:parser_rules` 区之外 |
| sema | `src/sema.tc` | `desugar_format_call` 消费 `!conv`，派发 `sb_append_fmt_{str,int,uint}_conv` |
| runtime | `runtime/t_runtime.c` + `runtime/t_runtime.h` + `runtime/t_shim_ll.c` | `fmt_str_convert` 实现六种转换；`!p`/`!c` 经 LLVM 指针桥 `tll_sb_append_fmt_str_conv` |
| 后端 C | `src/codegen_c.tc` | `td_calls`（void 表）+ emit 分支 |
| 后端 LLVM | `src/codegen_ll.tc` | emit 分支 + `llph` declares |

### 5.1 新增内建的六个注册点

要新增一个 f-string 转换运行时，必须在以下位置**都登记**，缺一即静默 `; UNSUPPORTED call`：

1. `builtin_ret`（sema GEN 区）
2. `td_calls`（codegen_c）
3. C emit 分支（codegen_c）
4. LLVM emit 分支（codegen_ll）
5. `llph` declares（codegen_ll）
6. runtime 实现（`t_runtime.c` + `t_shim_ll.c` 指针桥）

## 6. 测试覆盖

- `tests/conformance/pass/p44_fstring_ok.tc`：零插值退化、基本 / 表达式插值、格式规范（`>10` / `05` / `.2`）、转换字段（`!s/!r/!a/!j/!p/!c`）、转换 + 规范、转义花括号、长式 f-string（内嵌 `"`）、嵌套 f-string、前缀取反 `{!okv}`、无符号整数 `!p`。
- `tests/conformance/fail/f52_fstring_conv_type.tc`：手写 `format("{0!z}", s)` → `T_FMT_BAD_CONVERSION`（f-string 路径在解析期即报错，故用 `format()` 模板路径触发 sema 诊断）。
- `examples/fstring_demo.tc` + `examples/fstring_demo.expected.txt`：演示全部特性，双后端输出逐字节一致。

## 7. 设计决策与踩坑

- **Lexer off-by-one**：短式 f-string 扫描起点少跳一个引号（`fsi = i + 1` 落在开头引号上，被当成闭合引号，剩余内容变成未终止普通字符串）。修复为 `i + 2` / `col + 2`；长式 `f"""` 的 `i + 4` 不受影响。
- **`!a` 的 UTF-8 转义**：初版对非 ASCII 直接按字节 `fmt_esc_hex`（输出 `\xe4\xb8\xad` 这种 UTF-8 字节 `\xHH`），错误。改为 UTF-8 解码成码点后用 `\uXXXX` / `\UXXXXXXXX`（新增 `fmt_utf8_cp` / `fmt_esc_u_cp` helper）。修复后 `中文` 的 `!a` 正确输出 `\u4e2d\u6587`。
- **`{!ok}` 误判为转换字段**：conv 提取未校验 `!` 前是否为完结表达式、且对非法字母报错不清。修复为用 `fstr_prev_ends_expr` 判断 `!` 前是否完结，非法字母（`fstr_is_conv` 返回 false）直接清晰报错（`{n!z}` → 解析期明确错误）。
- **代码落进 GEN 区会被覆盖**：f-string 手写代码原本落在 `GEN:parser_rules` 自动生成区间（DO NOT EDIT，会被 `tools/totter.tc` 重生成覆盖）。已整体移出，置于 `GEN:parser_rules` 标记之前。
- **`t` 无三元 `?:` 运算符**：`{n > 10 ? "big" : "small"}` 会报 `expected RParen but found ?`（普通代码同样报错）。f-string 内不可写三元，需用函数 / if 表达式。
- **负值字面量求值是语言既有行为**：`-255` 因 `255` 推导为 `u8`，求值结果为 `1`（mod 256），`format("{}", -255)` 同样输出 `1`。这是语言层面既有特性，非 f-string bug；`var m: i64 = -255; f"{m!p}"` 正确输出 `-0xff`。
- **运行时库预编译坑（最隐蔽）**：`tc run` 链接的是**预编译运行时库** `out/<mode>/deps/t_runtime.lib`，改 `runtime/t_runtime.c` 后必须 `node tools/build_runtime.mjs` 重建，否则改动不生效（首跑 `!p`/`!c` 出裸值正是踩了这个）。

## 8. 与 CPython 的同构与差异

**同构**：先转文本再套 spec；`!r/!a/!j` 的语义取自 CPython f-string。

**差异**：
- 转换字段从「整数专用（旧 `!c` 码点 / `!p` 十六进制）」扩展为「任意值类型的序列化格式」（json / pbtxt / csv）。这是 `t` 的扩展语义。
- `t` 无数字格式化的 locale / 千位分隔等复杂 spec 语义；spec 透传到 `sb_append_fmt_*` 的既有实现。

## 9. 已知限制 / 后续

- `!p` / `!c` 在标量上目前序列化即裸值（与 `!j` / `!s` 等价）。若需要 pbtxt / csv 对标量做格式专属处理（如带类型注解），需扩展 sema + runtime。
- `sb_append_fmt_int_conv` / `sb_append_fmt_uint_conv` 两个内建现已**不可达**（因 `!c` / `!p` 不再限于整数，全走 `sb_append_fmt_str_conv`）。可清理其 codegen emit 分支与 declares 以减少表面积。
