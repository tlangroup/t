# 语法规则草稿 · 词法结构（Lexical）  [DRAFT]

> 依据：`src/tc.tc` lexer + `docs/reference.md` §2.1–§2.5（空白/注释/标识符/关键字/字面量）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
Program: Token*
Token: Whitespace | Comment | Identifier | Keyword | Literal | Operator | Punctuation
Comment: LineComment | BlockComment
LineComment: "//" <至行尾>
BlockComment: "/*" <可嵌套> "*/"
Identifier: (Letter | "_") (Letter | Digit | "_")*     // 含 snake_case / PascalCase
Keyword: "fn" | "struct" | "enum" | "flag" | "variant" | "union"
       | "if" | "for" | "while" | "switch" | "return" | "break" | "continue"
       | "defer" | "comptime" | "var" | "const" | "import" | "as" | "in" | "when"
       | "match" | "true" | "false" | "null" | "map" | "string" | "void" | "export" ...
Literal: IntLit | FloatLit | StringLit
```

- 标识符大小写敏感；类型名 `i8`..`i64`/`u8`..`u64`/`f16`/`f32`/`f64`/`bool` 为**内建类型名**（非关键字，见 reference §2.5 注）。
- 块注释 `/* */` **可嵌套**（reference §2.1 L56）。

## 2. Where（约束）

- 行/列用 UTF-8 字节计数（reference 实现铁律，line/col 字节计数）。
- 字符串字面量用双引号；转义见 reference §2.4。
- 运算符/标点见 reference §2.5（`->` 返回、`..` 等；`::` 声明绑定符已于 2026-08-01 移除，顶层声明改为并置式 `Name fn ...`）。
- 关键字由 `lex` 查表（`kw_lookup`）判定，权威列表见 reference §2.3 `Keyword` 产生式。

## 3. 示例

```t
// 行注释
/* 块注释 /* 可嵌套 */ 结束 */
var name: string = "t";   // 标识符 + 字符串字面量
```

## 4. 与既有构造关系

- 词法是所有上层语法（声明/语句/表达式）的底层；上层 EBNF 中的 `Ident`/`Integer`/`String` 终端即本章产物。
- `match`/`when` 为本草体系新增关键字（见 `match.md`），须纳入 §2.3 关键字表（跨草稿协作）。

## 5. L-14 铁律校验预留

- 词法由 `lex` 阶段生成（reference §2.3 `keywords_tbl`），difftest 覆盖词法。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 一种注释/标识符/字面量写法，无等价变体 |
| L-02 显式 | ✅ | 词法无隐式（显式引号/注释符） |
| L-03 静态类型 | ✅ | 字面量类型由词法确定 |
| L-14 铁律校验 | ✅ | lex + difftest 覆盖 |

## 7. L-04 张力

- 块注释嵌套 `/* /* */ */` 与某些语言的非嵌套注释语义不同，但 t 统一为可嵌套，单一规则，无 L-04 冲突。
- `match`/`when` 若尚未登记进 §2.3 关键字表，则与 `match.md` 形成跨草稿待补（须在 match 规则采纳时同步更新词法关键字表）。
