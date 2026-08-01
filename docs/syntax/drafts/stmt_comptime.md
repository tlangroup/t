# 语法规则草稿 · comptime 语句（ComptimeStmt）  [DRAFT]

> 依据：`src/tc.tc` `parse_comptime_stmt`（L5238–L5250）+ `docs/reference.md` §2.8（`@node comptime` / `@node comptime_block`）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
ComptimeStmt: "comptime" (Block | Expr ";")
```

- 两种形态：`comptime { ... }`（编译期块）或 `comptime <expr>;`（编译期表达式求值）。
- 块形态走 `mk_comptime_block`，表达式形态走 `mk_comptime`（L5242/L5247）。

## 2. Where（约束）

- `comptime` 标记的构造在**编译期**求值（CTFE），其结果固化为常量（数据优先、静态可预判）。
- 编译期表达式不得有运行时副作用（对应宪法全行为显式 / 无隐式运行期行为）。
- 当前 `comptime` 表达式语义为 spec-only（reference §2.8 L116 ⚠），块形态节点已定义。

## 3. 示例

```t
comptime {
    // 编译期执行的逻辑
}

comptime SIZE = 1024;   // 编译期常量
```

## 4. 与既有构造关系

- 编译期数据导入见 `decl_import.md`（`import "x.csv"`）。
- `type_info(T)` 编译期内省见 `expr_literal.md`。
- 顶层 `comptime` 声明前缀见 `decl.md`（`KwComptime DeclBody`）。

## 5. L-14 铁律校验预留

- `comptime` 节点已定义（reference §2.8 `@node comptime`），实现状态 spec-only。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | `comptime { }` / `comptime expr;` 两种形态语义区分明确 |
| L-02 显式 | ✅ | 编译期/运行期边界显式标注 |
| L-03 静态类型 | ✅ | 编译期求值结果静态确定 |
| L-14 铁律校验 | ⚠️ | 节点已定义，语义 spec-only |

## 7. L-04 张力

无内部张力。但 `comptime` 既是**顶层声明前缀**（`decl.md`）又是**语句**（`comptime stmt`），属同一关键字的两层用法（声明修饰 vs 语句），不构成等价多写，建议在本章注明该双层角色。
