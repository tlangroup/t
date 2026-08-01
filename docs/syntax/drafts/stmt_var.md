# 语法规则草稿 · 变量声明与赋值（Local Var / Assign）  [DRAFT]

> 依据：`src/tc.tc` `parse_local_var`（L5164）/ `parse_expr_or_assign_stmt`（L5188）+ `docs/reference.md` §3.3。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
LocalVar: "var" Ident (":" Type)? ("=" Expr)? ";"
LocalConst: "const" Ident (":" Type)? ("=" Expr)? ";"
AssignStmt: Expr AssignOp Expr ";"
AssignOp: "=" | "+=" | "-=" | "*=" | "/=" | "%="
         | "&=" | "|=" | "^=" | "<<=" | ">>="
```

- 局部声明出现在块内（`var`/`const` 路由到 `parse_local_var`，L5836/L5839）。
- 赋值：`Expr AssignOp Expr`，左值为可寻址表达式（见 `expr.md` §2）。
- 非赋值表达式语句以分号结尾（L5210 `expect_tok("Semicolon")`）。

## 2. Where（约束）

- 局部 `var`/`const` 类型 `: Type` 可选（缺省推断/void），初值 `= Expr` 可选（`parse_local_var` L5169/L5174）。
- 复合赋值（`+=` 等）在 `parse_expr_or_assign_stmt` 全量枚举（L5193–L5201），无简写变体。
- 同函数内同名局部变量不得有不同类型（shadow_check 守卫，reference 实现铁律）。
- 赋值左值须可寻址（LLVM 后端 `ll_addr`/`ll_call` 约束）。

## 3. 示例

```t
var counter: i32 = 0;
const pi: f64 = 3.14159;
counter = counter + 1;
counter += 10;
buf[i] = value;
```

## 4. 与既有构造关系

- 全局 `var`/`const` 见 `decl_var.md`（作用域区别）。
- 赋值右侧 `Expr` 文法见 `expr.md` 细分。
- 复合赋值不产生「`x = x + 1`」等价多写问题（语义单一，属语法糖，lowering 展开）。

## 5. L-14 铁律校验预留

- 局部声明与赋值已实现（reference §3.3 ✅ tote 核心）。
- `shadow_check.mjs` 守卫同名不同类型局部变量。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | `var`/`const` 与赋值（`=`/复合）各自唯一，无等价多写 |
| L-02 显式 | ✅ | 类型/初值显式 |
| L-03 静态类型 | ✅ | 局部类型静态确定 |
| L-14 铁律校验 | ✅ | 门禁 + shadow_check 覆盖 |

## 7. L-04 张力

- 复合赋值 `x += 1` 与 `x = x + 1` 语义等价。按 L-04 唯一语义，应明确「复合赋值为 `x = x + op y` 的语法糖（lowering 展开），`x = x + 1` 为唯一真源写法」以避免歧义（参考 `match.md` §7 的 desugar 裁定模式）。建议在本章注明该 lowering 关系。
