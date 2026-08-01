# 语法规则草稿 · 全局变量与常量（GlobalVar / GlobalConst）  [DRAFT]

> 依据：`src/tc.tc` `parse_global_var`（L5499–L5533，路由自 `parse_declaration` L5601/L5604）+ `docs/reference.md` §3.1。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
GlobalVar: "var" Ident (":" Type)? ("=" Expr)? ";"
GlobalConst: "const" Ident (":" Type)? ("=" Expr)? ";"
```

- 全局作用域：`parse_declaration` 遇 `KwVar`/`KwConst` 直接路由到 `parse_global_var`（L5602/L5605）。
- 类型 `: Type` 可选（缺省推断/void）；初值 `= Expr` 可选。

## 2. Where（约束）

- `const` 命名须符合常量命名约定（`validate_const_name`，L5515），`var` 同理（`validate_var_name`）。
- `const` 缺初值时补 `null`（L5522）。
- 全局变量类型缺省为 `void`（L5529），一般应显式标注。
- `Sym` 全局 var 的字符串初始化器须搬进 `t__ginit`/`t.__ginit`（reference M40，运行时 intern）。

## 3. 示例

```t
max_players var i32 = 64;
app_name const string = "t-engine";

// 字符串驻留符号全局初始化（M40）
state var Sym32 = "running";
```

## 4. 与既有构造关系

- 局部变量/常量见 `stmt_var.md`（`var`/`const` 在块内）。
- 全局 var 的初始化器在 `t__ginit` 运行期执行（非语法层）。

## 5. L-14 铁律校验预留

- 全局声明已纳入门禁（reference §3.1 ✅ tote 核心）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | `var`/`const` 两种角色区分明确，无等价写法 |
| L-02 显式 | ✅ | 类型/初值显式 |
| L-03 静态类型 | ✅ | 类型静态确定 |
| L-14 铁律校验 | ✅ | 门禁覆盖 |

## 7. L-04 张力

- `GlobalVar`/`GlobalConst` 与 `stmt_var.md` 的 `LocalVar`/`LocalConst` 角色不同（作用域区别），不构成等价多写。
- `const` 与 `@const_fn` 注解语义不同（后者为函数约束），注意命名接近。
