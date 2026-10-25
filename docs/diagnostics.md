# t 语言编译器诊断规范（Diagnostics Specification）

> 版本 v1 ｜ 状态：**已批准（ratified）** ｜ 制定依据：`docs/constitution.md` 第6条（双格式结构化诊断输出）、`docs/laws/L-07_dual_diagnostic.md`
> 本文是诊断系统的**唯一权威规范**。消息模板原始信息由 `tools/diag_defs.json` 维护，经 `tools/gen_diag.mjs` 生成静态查表代码（`src/diag_table.gen.h`），消息字符串编译嵌入二进制。编译器运行不依赖任何外部消息资源文件。

---

## 1. 基础总则

### 1.1 文件规范

- 所有源码路径统一使用工程根目录相对路径，路径分隔符固定为 `/`；禁止使用绝对路径、反斜杠、`./`、`../` 相对跳转路径。
- 诊断模板原始信息使用仓库内独立定义文件（`tools/diag_defs.json`）维护；通过构建脚本（`tools/gen_diag.mjs`）生成静态查表代码，消息字符串编译嵌入二进制。编译器正常运行不依赖任何外部消息资源文件。
- `tools/diag_defs.json` 是诊断的**单一事实源（single source of truth）**：每一条诊断的 `code` / `severity` / `category` / `legacy` / `message` 仅在此定义。旧管线 `docs/reference.md` 的 `DiagnosticTable` ebnf 块已废弃，由本规范取代（见附录 C）。

### 1.2 诊断编码规则

#### 1.2.1 编码格式

固定格式：`T-{CAT}-{SEV}{NNN}`

- `T-`：t 语言专属固定前缀
- `CAT`：三位大写字母，编译领域分类（见 §1.3）
- `SEV`：单字符严重等级
  - `E` Error：编译错误，阻断构建，无产物
  - `W` Warning：编译警告，不阻断构建，标识不规范/风险代码
  - `I` Info：信息提示，仅作辅助溯源与参考，无代码错误风险
- `NNN`：三位十进制数字编号，取值范围 000–999

#### 1.2.2 编码唯一性约束

- 不同 `CAT` 分类的**编号区间互不重叠**（见 §1.3 区间列），因此数字编号在全局互斥、禁止重叠——同时满足「CAT 内编号唯一」与「跨 CAT 数字全局互斥」两种读法。
- 同一 `CAT+NNN` 允许共存 E、W、I 多等级诊断，完整编码 `T-CAT-SEVNNN` 全局唯一。
- 诊断编码一经分配永久冻结，不修改语义、不回收复用、不删除。
  - 例：`T-FST-E311`（`T_FMT_CONV_TYPE`，当前不可达）仍永久保留占位，不移除。

#### 1.2.3 新旧双标识（ ratified决策 #1：新旧同时采用 ）

新规范采用机器码 `T-CAT-SEVNNN` 作为 `code`（JSON 报文的 `code` 字段主值），**同时保留旧语义名（`T_TYPE_MISMATCH` 等）作为等价双标识（dual identity）**，二者地位相同、指向同一条诊断：

- JSON `code`：机器码 `T-SEM-E202`（规范新增代码的唯一真值，CI/LSP 首选）。
- JSON `name`：冻结的短语义标识 `TYPE_MISMATCH`（稳定引用用）。
- JSON `metadata.legacy_code`：旧编译器语义名 `T_TYPE_MISMATCH`（既有管线、测试、LSP 解析兼容用）。
- **控制参数双受理**：`-Woff=CODE` / `-Wdeny=CODE` / `-Wallow=CODE` 同时接受机器码与旧语义名两种写法（如 `-Woff=T-SEM-E202` 与 `-Woff=T_TYPE_MISMATCH` 等价），由 `gen_diag` 生成的 legacy→code 别名表解析（见 §1.1）。
- 终端输出 `severity_text [CODE]` 中的 `CODE` 打印机器码；旧语义名不进 `code` 字段，但并列出现在 `name` / `legacy_code` 中，保证两种消费方式都不丢信息。

> 设计要点：机器码是"新规范的主键"，语义名是"既有生态的外键"。双标识并存且等价，不区分主从，迁移期与迁移后都长期有效（不回收）。

### 1.3 诊断分类与编号区间

| 分类 CAT | 领域 | 编号区间 | 代表诊断（当前编译器实码） |
|---|---|---|---|
| LEX | 词法分析 | 000–079 | 字符串未终结 / 非法字符 / 转义与数字字面量形态错误（E002–E008，2026-08-10 起启用） |
| ICE | 内部编译器错误（跨领域，特殊） | 080–099 | `T-ICE-E080` 通用内部错误（含 `metadata.stack`） |
| PAR | 语法分析 | 100–199 | `T_PARSE_INVALID_EXPR`→PAR-E100；函数子句语法也在此发射 |
| SEM | 静态语义（通用类型/符号/作用域） | 200–299 | `T_UNKNOWN_TYPE`→E200、`T_UNDEFINED_IDENT`→E201、`T_TYPE_MISMATCH`→E202、`T_NOT_CALLABLE`→E205、`T_CALL_ARITY`→E206、`T_ARG_TYPE`→E207、`T_UNKNOWN_FIELD`→E208 |
| FST | 格式化（f-string + `format()` 内建） | 300–399 | `T_FMT_BAD_CONVERSION`（`!z` 非法转换符）→E301、**multiple conversion specifiers→E302（规范示例）**、模板/实参/编号/索引→E303–E311 |
| NAM | 命名规范（lint） | 400–449 | `T_NAME_TYPE_CAMEL`→W400、`VAR_SNAKE`→W401、`CONST_UPPER`→W402、`ANNOTATION_LOWER`→W403、`W_C_KEYWORD_IDENT`→W404 |
| ANN | 注解 | 450–499 | `T_ANNOTATION_UNKNOWN`→E450、`INVALID_ARG`→E451、`WRONG_TARGET`→E452 |
| DER | `@derive` | 500–549 | `T_DERIVE_UNSUPPORTED`→E500 |
| MOD | 模块系统 | 550–599 | `T_IMPORT_NOT_FOUND`→E550、`CYCLE`→E551、`IO/HEADER/VALUE/CONTEXT`→E552–555、`EXPORT_SCOPE`→E556、`MODULE_NO_SYMBOL`→E557、`PRIVATE`→E558 |
| MTA | 元编程（comptime/CTFE） | 600–649 | `T_META_VALUE_PARAM_TYPE`→E600、`ARG_TYPE`→E601、`RANGE`→E602、`COMPTIME_ARG_NOT_TYPE`→E603、`COMPILE_ERROR`→E604、`RUNTIME_CTX`→E605、`UNKNOWN_TYPE/BUILTIN`→E606/607、`TYPE_AS_VALUE`→E608、`RETURN_OUTSIDE_FN`→E609 |
| FID | fid/atom 序列化 | 650–699 | `T_FID_RESERVED_NAME`→E650 … `T_FID_SEEK_ARG`→E661 |
| TIM | 时间内建 | 700–719 | `T_TIME_BAD_SPEC`→E700、`PARSE_UNSUPPORTED`→E701、`SPEC_TYPE`→E702、`ARG_TYPE`→E703 |
| CLA | 一等子句（`first-class clause`） | 720–739 | `T_CLAUSE_BAD_FORM`→E720、`UNKNOWN_KIND`→E721、`PATTERN_KIND_MIX`→E722、`MERGE_TYPE`→E723、`ESCAPE`→E724、`ARG_NOT_CONST`→E726、`W_CLAUSE_SHADOWED`→W727 |
| MAT | match | 740–779 | `T_MATCH_UNKNOWN_CASE`→E740、`ARM_TYPE`→E741、`NONEXHAUSTIVE`→E742 |
| CLO | 闭包/捕获 | 780–809 | `T_CLOSURE_CAPTURE`→CLO-E780 |
| FUN | 函数子句/重载 | 810–849 | `T_FUNC_CLAUSE_BIND_CONFLICT`→E810、`ARITY`→E811、`NO_TYPE`→E812、`RET_TYPE`→E813、`BODY`→E814 |
| FLG | flag 位域 | 850–859 | `T_FLAG_OFFSET_CONFLICT`→E850、`OVERFLOW`→E851 |
| PIP | 管道算子 `\|->` `\|>?` `\|>` | 860–869 | `T_PIPE_RHS_NOT_FUNC`→E860、`RHS_ARITY`→E861、`ARG_TYPE`→E862、`NOT_SEQUENCE`→E863、`PRED_TYPE`→E864、`BAD_CONTEXT`→E865、`W_PIPE_DISPATCH_AMBIG`→W866、`NO_MATCH`→E867、`W_PIPE_RESULT_UNUSED`→W868 |
| RNG | 区间字面量 `a..b` `a..=b` | 870–879 | `T_RANGE_ITER_NO_START`→E870、`INDEX_UNSUPPORTED`→E871、`OPEN_AS_VALUE`→E872、`INCL_NO_END`→E874、`IMPURE_OPERAND`→E875、`T_IN_RHS_NOT_RANGE`→E877 |
| AGT | agent/colony | 880–909 | 预留（当前无专用码） |
| CDE | 代码生成/后端 | 910–999 | codegen 期 type_info 仅 struct→CDE-E910（与 SEM-E202 同义但分阶段，独立编码） |

> 区间互不重叠；`T-LEX-*` 与 `T-ICE-*` 共享 000–099 百年段但子区间 000–079 / 080–099 不重叠，合规。
> 同理 `T-TIM-*` 与 `T-CLA-*` 共享 700–739 百年段但子区间 700–719 / 720–739 不重叠（2026-10-25 切分：TIM 实码最大 E703，收缩至 719 不影响既有码）。

---

## 2. 位置跨度（Span）规范

- 码号、行号、列号均从 1 起始。
- 码号为 Unicode 码点，离文件开始的总值（agent 友好）。
- 列计数基准为 Unicode 码点，单个码点占用一列。
- 制表符 `\t` 视为单个码点，仅占 1 列，不展开为空格。
- 禁止以 UTF-8 字节、UTF-16 码元、视觉字形簇作为列号计算依据。
- 编译器核心使用 Unicode 码点计算列号，LSP 适配层单独完成 UTF-16 转换。
- 支持零长度插入点 Span、跨行 Span。
- **`offset` / `end_offset` 单位明确为 Unicode 码点计数**（ ratified决策 #5 ），与 `column` 同基准，非 UTF-8 字节偏移。

---

## 3. 结构化诊断数据模型

同时适配终端人类可读输出、CI/IDE/LSP 机器解析。

```json
{
  "code": "T-FST-E302",
  "name": "T_FMT_MULTI_CONV",
  "severity": "error",
  "category": "FST",
  "message": "multiple conversion specifiers in interpolation",
  "short_note": "single interpolation allows at most one ! conversion tag",
  "location": {
    "offset": 231,
    "end_offset": 237,
    "file": "src/log/main.tc",
    "line": 14,
    "column": 22,
    "end_line": 14,
    "end_column": 28
  },
  "source_line": "let s = f\"val={data!r!j}\"",
  "related_spans": [],
  "suggestions": [],
  "metadata": {
    "legacy_code": "T_FMT_BAD_CONVERSION",
    "doc": "docs/diagnostics.md#fst"
  }
}
```

### 3.1 字段定义

- **code**：全局唯一诊断编码**主值**（机器码 `T-CAT-SEVNNN`，新规范主键）
- **name**：短语义标识（冻结的短标识，如 `TYPE_MISMATCH`；与 `code` 一一对应，用于稳定引用）
- **severity**：等级枚举，可选值 `error`、`warning`、`info`
- **category**：三位大写诊断分类标识
- **message**：标准化诊断描述文本
- **short_note**：可选，补充说明与修复建议
- **location**：诊断主位置跨度信息（`offset`/`end_offset` 为码点计数，见 §2）
- **source_line**：可选，出错源码行文本
- **related_spans**：关联源码位置数组，用于溯源、冲突标注
- **suggestions**：自动修复补丁数组，无修复方案则为空数组
- **metadata**：预留扩展字段，用于存储文档链接、特性标识、旧语义名（`legacy_code`）、ICE 堆栈（`stack`）等
  - `metadata.legacy_code`：旧编译器语义名（如 `T_TYPE_MISMATCH`），与 `code` 等价双标识，控制参数两种写法均受理（见 §1.2.3）

---

## 4. 终端输出规范

### 4.1 输出模板

```plain text
{file}:{line}:{column}: {severity_text} [{code}] {message}
{source_line}
{caret_underline}
note: {short_note}
```

`related_spans` 与 `suggestions` 的终端渲染（ ratified决策 #3 ）：

```plain text
{file}:{line}:{column}: error [T-MOD-E557] module 'foo' has no symbol 'Bar'
  --> src/foo/lib.tc:12:3
  |
  | import(foo)            // 主位置之上再画关联位置
  = note: did you mean 'Baz'?
help: add `export` to `Bar` in src/foo/lib.tc, or rename the import
```

- `related_spans`：每个元素渲染为一行 `  --> {file}:{line}:{column}` 加可选上下文，置于主位置下方。
- `suggestions`：每个元素渲染为一行 `help: {text}`。
- 零长度插入点 Span：使用单字符 `^`（无下划线）标记插入位置，而非 `~~~`。

### 4.2 色彩规范

- Error：红色
- Warning：黄色
- Info：青色/浅蓝色

支持 `--color=auto/always/none` 色彩控制参数，CI 环境默认关闭 ANSI 色彩。

---

## 5. 诊断等级语义定义

- **Error(E)**：代码存在语法或语义非法问题，终止编译，不生成产物。
- **Warning(W)**：代码语法合法、可正常编译运行，存在不规范、易错、废弃写法。
- **Info(I)**：无错误、无风险，仅提供溯源、推导结果、候选列表等辅助信息。

---

## 6. 编译诊断控制参数

- `--warn=error`：全局所有警告升级为错误
- `--info=off`：关闭全部 Info 级诊断输出（含 `-Woff` 指定的 Info 码）
- `-Woff=CODE`：屏蔽指定编码诊断（可作用于 E/W/I 任意等级）
- `-Wdeny=CODE`：将指定警告升级为错误
- `-Wallow=CODE`：放行指定诊断规则（覆盖上述屏蔽/升级）

> `CODE` 同时接受**机器码**与**旧语义名**两种写法（见 §1.2.3 双标识）。例如 `-Woff=T-SEM-E202` 与 `-Woff=T_TYPE_MISMATCH` 等价，`-Wdeny=T-NAM-W400` 与 `-Wdeny=T_NAME_TYPE_CAMEL` 等价。解析由 `gen_diag` 生成的 legacy→code 别名表（`src/diag_table.gen.h` 的 `DIAG_LEGACY[]`）完成，二者映射到同一条诊断、共享同一优先级判定。
- 输出模式互斥：`--format=human`（默认）、`--format=json`，禁止混合输出

### 6.1 控制参数优先级（ ratified决策 #2 ）

当用户同时给出多个控制参数时，按以下**由强到弱**顺序判定单条诊断的最终等级：

1. **`-Wallow=CODE`**（显式放行）— 最高优先级，恢复该码为定义等级，无视后续升级/屏蔽。
2. **`-Wdeny=CODE` / `--warn=error`**（显式升级）— 将该码（或全体警告）提升为 error。
3. **`-Woff=CODE` / `--info=off`**（显式屏蔽）— 关闭该码（或全体 Info）。
4. **定义等级**（默认）— 来自 `tools/diag_defs.json`。

> 示例：`-Wallow=T-NAM-W400 -Wdeny=T-NAM-W400` → 最终为 warning（allow 胜出）。`--warn=error -Woff=T-NAM-W404` → T-NAM-W404 被关闭（off 在其后作用于该码，但 off 弱于 deny；此处无 deny，故 off 生效）。

---

## 7. 边界处理规范

- 连锁报错抑制：语法严重崩溃时，限制次生无效诊断输出。
- 路径降级兜底：无工程根目录时，归一化绝对路径作为文件路径输出。
- 特殊字符处理：自动转义源码行内不可见控制字符，避免终端乱码。
- ICE 异常处理（ ratified决策 #4 ）：内部错误使用专用 `T-ICE-*` 编码（见附录 B），JSON 报文 `metadata.stack` 携带堆栈信息，终端仅简化展示「internal compiler error [T-ICE-E000]；使用 --verbose 查看堆栈」，避免泄露内部路径噪音。

---

## 附录 A：现有诊断码 → 新编码全量映射

> 来源：`tools/diag_defs.json`（单一事实源，共 **102** 条）；本表由该 JSON 自动生成，冻结后新码只增不删。

### LEX 000–008
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-LEX-E000 | E | (新) | 字符串未终结 |
| T-LEX-E001 | E | (新) | 非法字符 |
| T-LEX-E002 | E | T_LEX_BAD_ESCAPE | 未知转义序列（合法集见 reference.md §2.4） |
| T-LEX-E003 | E | T_LEX_NEWLINE_IN_STRING | 单引号串内不得出现裸换行，改用 `\n` 或三引号长字符串 |
| T-LEX-E004 | E | T_LEX_BAD_NUMBER | 数字字面量形式非法（无数字位 / 分隔符位置非法 / 指数缺数字） |
| T-LEX-E005 | E | T_LEX_BAD_NUM_SUFFIX | 位宽后缀非法（合法：u8/u16/u32/u64/i8/i16/i32/i64/f32/f64） |
| T-LEX-E006 | E | T_LEX_LIT_OUT_OF_RANGE | 带后缀整数字面量超出该类型表示范围 |
| T-LEX-E007 | E | T_LEX_BAD_CHAR_LITERAL | 字节字符字面量非法（须恰好一个 0..255 字节） |
| T-LEX-E008 | E | T_LEX_UNTERMINATED_LONG_STRING | 三引号 / 原始字符串未终结 |

### ICE 080–081
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-ICE-E080 | E | (新) | 内部编译器错误，metadata.stack 携带堆栈 |
| T-ICE-E081 | E | (新) | 后端 LLVM 发射失败 |

### PAR 100
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-PAR-E100 | E | T_PARSE_INVALID_EXPR | 无效表达式（解析期） |

### SEM 200–212
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-SEM-E200 | E | T_UNKNOWN_TYPE | 未定义类型 |
| T-SEM-E201 | E | T_UNDEFINED_IDENT | 未定义标识符 |
| T-SEM-E202 | E | T_TYPE_MISMATCH | 类型不匹配 |
| T-SEM-E203 | E | T_TYPE_IMPLICIT_CAST | 隐式类型转换不被允许 |
| T-SEM-E204 | E | T_STMT_IMPLICIT_BOOL | 语句隐式布尔判定不被允许 |
| T-SEM-E205 | E | T_NOT_CALLABLE | 目标不可调用 |
| T-SEM-E206 | E | T_CALL_ARITY | 实参数量不符 |
| T-SEM-E207 | E | T_ARG_TYPE | 实参类型错误 |
| T-SEM-E208 | E | T_UNKNOWN_FIELD | 未知字段 |
| T-SEM-E209 | E | T_TAGID_DUP | tag 编号重复 |
| T-SEM-E210 | E | T_TAGID_MIXED | tag 编号风格混用 |
| T-SEM-E211 | E | T_VAR_NO_TYPE | 变量缺类型 |
| T-SEM-E215 | E | T_ARRAY_LEN_UNINFERABLE | `[_]` 数组长度占位无法推断（只能用于带初始化器的变量/常量声明） |
| T-SEM-W212 | W | W_OVERFLOW_LITERAL | 整数字面量溢出 |

### FST 300–312
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-FST-E300 | E | T_FMT_BAD_SPEC | 非法格式说明符 |
| T-FST-E301 | E | T_FMT_BAD_CONVERSION | 非法转换标签 |
| T-FST-E302 | E | (新) | 单个插值含多个 ! 转换标签 |
| T-FST-E303 | E | T_FMT_NO_TEMPLATE | 缺模板 |
| T-FST-E304 | E | T_FMT_TEMPLATE_NOT_LITERAL | 模板非编译期字面量 |
| T-FST-E305 | E | T_FMT_TOO_MANY_ARGS | format 实参超过 64 |
| T-FST-E306 | E | T_FMT_ARG_TYPE | 实参类型不匹配占位符 |
| T-FST-E307 | E | T_FMT_BAD_TEMPLATE | 模板语法错误 |
| T-FST-E308 | E | T_FMT_NAMED_FIELD | 命名字段不支持 |
| T-FST-E309 | E | T_FMT_MIXED_NUMBERING | 混用编号/位置 |
| T-FST-E310 | E | T_FMT_INDEX_RANGE | 索引越界 |
| T-FST-E311 | E | T_FMT_CONV_TYPE | 冻结占位，当前不可达，不删除 |
| T-FST-E312 | E | T_FMT_SPEC_TYPE | 说明符类型错误 |

### NAM 400–404
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-NAM-W400 | W | T_NAME_TYPE_CAMEL | 类型名应 PascalCase |
| T-NAM-W401 | W | T_NAME_VAR_SNAKE | 变量名应 snake_case |
| T-NAM-W402 | W | T_NAME_CONST_UPPER | 常量名应 UPPER_SNAKE |
| T-NAM-W403 | W | T_NAME_ANNOTATION_LOWER | 注解名应小写 snake |
| T-NAM-W404 | W | W_C_KEYWORD_IDENT | 标识符撞 C 关键字 |

### ANN 450–452
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-ANN-E450 | E | T_ANNOTATION_UNKNOWN | 未知注解 |
| T-ANN-E451 | E | T_ANNOTATION_INVALID_ARG | 注解实参非法 |
| T-ANN-E452 | E | T_ANNOTATION_WRONG_TARGET | 注解作用于错误目标 |

### DER 500
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-DER-E500 | E | T_DERIVE_UNSUPPORTED | @derive 不支持该 trait |

### MOD 550–560
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-MOD-E550 | E | T_IMPORT_NOT_FOUND | 导入目标不存在 |
| T-MOD-E551 | E | T_IMPORT_CYCLE | 导入循环 |
| T-MOD-E552 | E | T_IMPORT_IO | 导入路径 I/O 失败 |
| T-MOD-E553 | E | T_IMPORT_HEADER | 导入头错误 |
| T-MOD-E554 | E | T_IMPORT_VALUE | 导入值非法 |
| T-MOD-E555 | E | T_IMPORT_CONTEXT | 导入上下文错误 |
| T-MOD-E556 | E | T_EXPORT_SCOPE | export 修饰了非顶层声明 |
| T-MOD-E557 | E | T_MODULE_NO_SYMBOL | 模块无该符号 |
| T-MOD-E558 | E | T_MODULE_PRIVATE | 符号为私有不可见 |
| T-MOD-E559 | E | T_IMPORT_BAD_PATH | 导入路径非法 |
| T-MOD-E560 | E | T_IMPORT_CONFLICT | 导入符号冲突 |

### MTA 600–620
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-MTA-E600 | E | T_META_VALUE_PARAM_TYPE | 元值参数类型错误 |
| T-MTA-E601 | E | T_META_ARG_TYPE | 元参类型错误 |
| T-MTA-E602 | E | T_META_RANGE | 元范围错误 |
| T-MTA-E603 | E | T_COMPTIME_ARG_NOT_TYPE | comptime 实参非类型 |
| T-MTA-E604 | E | T_META_COMPILE_ERROR | 编译期求值错误 |
| T-MTA-E605 | E | T_META_RUNTIME_CTX | 编译期误用运行期上下文 |
| T-MTA-E606 | E | T_META_UNKNOWN_TYPE | 未知元类型 |
| T-MTA-E607 | E | T_META_UNKNOWN_BUILTIN | 未知元内建 |
| T-MTA-E608 | E | T_META_TYPE_AS_VALUE | 元类型被当值使用 |
| T-MTA-E609 | E | T_META_RETURN_OUTSIDE_FN | meta 块内 return |
| T-MTA-E611 | E | T_META_ARITY | 元参数数量错误 |
| T-MTA-E612 | E | T_META_BUDGET | 元计算预算超限 |
| T-MTA-E613 | E | T_META_DEPTH | 元递归深度超限 |
| T-MTA-E614 | E | T_META_DIV_ZERO | 元除零 |
| T-MTA-E615 | E | T_META_IMPURE | meta 内出现不纯操作 |
| T-MTA-E616 | E | T_META_NO_RETURN | meta 块无返回值 |
| T-MTA-E617 | E | T_META_NOT_CONST | 元实参非常量 |
| T-MTA-E618 | E | T_META_NOT_META_FN | 目标非 meta 函数 |
| T-MTA-E619 | E | T_META_NOT_TYPE | 期望类型 |
| T-MTA-E620 | E | T_META_READ_RUNTIME | meta 内读取运行期值 |

### FID 650–662
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-FID-E650 | E | T_FID_RESERVED_NAME | fid 保留名 |
| T-FID-E651 | E | T_FID_MODE_NOT_LITERAL | fid mode 非字面量 |
| T-FID-E652 | E | T_FID_BAD_MODE | 非法 fid mode |
| T-FID-E653 | E | T_FID_BAD_FORMAT | 非法 fid format |
| T-FID-E654 | E | T_FID_UNSERIALIZABLE | 类型不可序列化 |
| T-FID-E655 | E | T_FID_DESERIALIZE_NEEDS_TYPE | 反序列化需类型 |
| T-FID-E656 | E | T_FID_DESERIALIZE_AGG | 聚合反序列化错误 |
| T-FID-E657 | E | T_FID_DESERIALIZE_NEEDS_FID | 反序列化需 fid |
| T-FID-E658 | E | T_FID_NOT_ORDERED | fid 无序 |
| T-FID-E659 | E | T_FID_ERROR_ARG | fid error() 实参错误 |
| T-FID-E660 | E | T_FID_EOF_ARG | fid eof() 实参错误 |
| T-FID-E661 | E | T_FID_SEEK_ARG | fid seek() 实参错误 |
| T-FID-E662 | E | T_FID_FORMAT_NOT_LITERAL | fid format 非字面量 |

### TIM 700–703
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-TIM-E700 | E | T_TIME_BAD_SPEC | 非法时间格式说明符 |
| T-TIM-E701 | E | T_TIME_PARSE_UNSUPPORTED | 时间解析不支持 |
| T-TIM-E702 | E | T_TIME_SPEC_TYPE | 说明符类型错误 |
| T-TIM-E703 | E | T_TIME_ARG_TYPE | 时间实参类型错误 |

### MAT 740–742
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-MAT-E740 | E | T_MATCH_UNKNOWN_CASE | 未知 match case |
| T-MAT-E741 | E | T_MATCH_ARM_TYPE | 分支类型不一致 |
| T-MAT-E742 | E | T_MATCH_NONEXHAUSTIVE | match 未穷尽 |

### CLO 780
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-CLO-E780 | E | T_CLOSURE_CAPTURE | 闭包捕获错误 |

### FUN 810–814
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-FUN-E810 | E | T_FUNC_CLAUSE_BIND_CONFLICT | 子句绑定冲突 |
| T-FUN-E811 | E | T_FUNC_CLAUSE_ARITY | 子句元数错误 |
| T-FUN-E812 | E | T_FUNC_CLAUSE_NO_TYPE | 子句无类型 |
| T-FUN-E813 | E | T_FUNC_CLAUSE_RET_TYPE | 子句返回类型错误 |
| T-FUN-E814 | E | T_FUNC_CLAUSE_BODY | 子句体错误 |

### FLG 850–851
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-FLG-E850 | E | T_FLAG_OFFSET_CONFLICT | flag 位偏移冲突 |
| T-FLG-E851 | E | T_FLAG_OVERFLOW | flag 位溢出 |

### PIP 860–868
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-PIP-E860 | E | T_PIPE_RHS_NOT_FUNC | 管道右操作数不是函数值 |
| T-PIP-E861 | E | T_PIPE_RHS_ARITY | 管道右侧函数不是一元 |
| T-PIP-E862 | E | T_PIPE_ARG_TYPE | 流入值类型无法转型为右侧形参类型 |
| T-PIP-E863 | E | T_PIPE_NOT_SEQUENCE | `\|->` / `\|>?` 的左操作数不是切片或定长数组 |
| T-PIP-E864 | E | T_PIPE_PRED_TYPE | `\|>?` 的谓词返回类型不是 bool |
| T-PIP-E865 | E | T_PIPE_BAD_CONTEXT | 管道表达式出现在四个许可上下文之外 |
| T-PIP-W866 | W | W_PIPE_DISPATCH_AMBIG | `\|>` 整体应用与逐元素映射同时成立，已按规范取整体应用 |
| T-PIP-E867 | E | T_PIPE_NO_MATCH | `\|>` 的右侧函数与左操作数无任何匹配形态 |
| T-PIP-W868 | W | W_PIPE_RESULT_UNUSED | 表达式语句位的管道结果被丢弃 |

### RNG 870–877
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-RNG-E870 | E | T_RANGE_ITER_NO_START | 区间迭代缺起点（`..n` / `..`），或对区间用了双变量 for |
| T-RNG-E871 | E | T_RANGE_INDEX_UNSUPPORTED | 对 `string` / `[]T` 以外的类型做区间索引 |
| T-RNG-E872 | E | T_RANGE_OPEN_AS_VALUE | 开放区间出现在取值位置（物化需要两端俱全） |
| T-RNG-E874 | E | T_RANGE_INCL_NO_END | `..=` 缺右端点（解析期硬错） |
| T-RNG-E875 | E | T_RANGE_IMPURE_OPERAND | 降解会重复求值，但操作数含调用/副作用 |
| T-RNG-E877 | E | T_IN_RHS_NOT_RANGE | `in` 的右操作数不是区间字面量 |

### AGT 900
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-AGT-I900 | I | (新) | 预留区间，当前无专用码 |

### CDE 910
| 新码 | 等级 | 旧语义名 | 含义 |
|---|---|---|---|
| T-CDE-E910 | E | T_CGEN_TYPE_MISMATCH | codegen 期 type_info 仅支持 struct；legacy 由 T_TYPE_MISMATCH 拆出以保双标识唯一 |

## 附录 B：ICE（内部编译器错误）

- 编码区间：`T-ICE-080`–`T-ICE-099`（与 LEX 共享百年段但子区间不重叠）。
- 仅在编译器自身缺陷时发射，绝不因用户代码触发。
- JSON 报文除标准字段外，`metadata.stack` 携带回溯堆栈；`--verbose` 时终端也打印堆栈。
- 冻结首码 `T-ICE-E080` 为通用内部错误；其余子码按后续缺陷类型细分（如 `T-ICE-E081` 后端 LLVM 发射失败）。

---

## 附录 C：与既有管线关系

- `docs/laws/L-07_dual_diagnostic.md`（双格式诊断法）是本规范的**上位法**：本规范将其「规则编号」落实为 `T-CAT-SEVNNN` 机器码，并补全 `related_spans` / `suggestions` / `name` / `offset` 单位等条款。
- `tools/gen_ebnf.mjs` 中的 `DiagnosticTable` 抽取（读 `docs/reference.md` ebnf 块）**已被本规范取代**。迁移完成后应：①从 `reference.md` 删除 `DiagnosticTable` 块；②将诊断事实源统一指向 `tools/diag_defs.json`；③`out/ebnf.json` 的 `diagnostics` 段改由 `gen_diag.mjs` 生成或置空。
- 编译器接入（未包含在本规范文档落地范围内，见下）需在 `src/base.tc` 的 `diag_new` 增加机器码校验与 `legacy` 别名查表，并将各发射点从旧语义名迁移至新机器码 + `name`。
