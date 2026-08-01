# 语法规则草稿 · 枚举声明（EnumDecl）  [DRAFT]

> 依据：`src/tc.tc` `parse_enum_decl`（L5301–L5340，手写）+ `docs/reference.md` §3.1 / §2.8。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
EnumDecl: Ident "enum" (":" ScalarName)? Annotations? "{" EnumMember* "}"
EnumMember: Ident ("=" Expr)? Annotations? ("," | ";")?
```

- 底层类型（underlying）可选 `: 标量名`，缺省 `u32`（`parse_enum_decl` L5303）。
- 成员可显式赋值 `Name = expr`（常量表达式），否则自动递增值。

## 2. Where（约束）

- 枚举值为编译期常量，成员名后 `=` 接表达式（`parse_expr`，L5324）。
- 成员可挂注解（`parse_annotations` L5326）。
- 底层类型须为无符号/有符号定宽整数（标量表，reference §2.10）。

## 3. 示例

```t
Color enum {
    Red;
    Green;
    Blue;
}

// 显式底层 + 显式值
ErrorCode enum : u16 {
    Ok = 0;
    NotFound = 404;
    Panic = 500;
}
```

## 4. 与既有构造关系

- 枚举**值匹配**：传统 `switch(c){ case Color.Red: }`，但 `match.md` 裁定 `switch` 废弃、`match` 接管 enum（见 `match.md`）。
- 枚举不是 variant，无载荷（载荷用 `variant`，见 `decl_variant.md`）。

## 5. L-14 铁律校验预留

- `enum` 语义完整，conformance 覆盖 `reference L815 ✅`。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 绑定式 `Name enum { }`，单一定界 |
| L-02 显式 | ✅ | 底层类型/成员值显式 |
| L-03 静态类型 | ✅ | 枚举为独立静态类型，底层定宽 |
| L-14 铁律校验 | ✅ | 门禁覆盖 |

## 7. L-04 张力

- **与 `switch` 的协作张力**（非冲突）：enum 值匹配若用 `match`，则 `switch` 的 enum 分支须废弃（已由 `match.md` 裁定）。本章本身无写法冲突。
