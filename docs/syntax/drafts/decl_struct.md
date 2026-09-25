# 语法规则草稿 · 结构体声明（StructDecl）  [DRAFT]

> 依据：`src/tc.tc` `parse_struct_decl`（L6071，GEN 生成）+ `docs/reference.md` §2.8 `struct_decl` / §3.1。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

> ⚠️ **权威指引（2026-09-25 补）**：本草稿为 2026-08-01 冻结快照，下列写法已过期，请以 `docs/reference.md` 为准：
> - 声明改为**关键字前置** `struct StructName { … }`（旧式 `Ident "struct" { … }` 已移除，报 `T-PAR-E102`）。
> - 成员支持**位置字段（元组形态）**：`struct Pair { i64, string }` 自动命名为 `_0`/`_1`；命名与位置字段可混用。
> - 当前权威章节：`docs/reference.md` **§3.1 StructDecl / §3.21 元组（Tuple）**。
> - 字面量 `.x =` 形式与 `x:` 形式并存（见 `expr_literal.md` 权威指引）。

## 1. EBNF（§1 Notation）

```ebnf
StructDecl: Ident "struct" Layout? "{" SField* "}"
Layout: "#" ("soa" | "aos")
SField: Ident ":" (Type | Integer) Annotations? ("," | ";")?
```

- `Layout`（`#soa` / `#aos`）由 `parse_decl_body` 的 `Hash` 前缀（L5556）解析，缺省 `default`（AOS）。
- 成员可逗号或分号结尾（reference §3.1「字段以 `;` 结尾」，GEN 版兼容 `,`）。

## 2. Where（约束）

- 成员名后 `:` 接 **类型** 或 **整数字宽**（位域模式，`@bitpack` 结构体时 `name: 3;` 表 3 位宽成员，reference L378）。
- 成员可挂注解：`@derive(...)` / `@offset(N)` / `@export` / `@doc` 等（reference §3.1 L828）。
- `@bitpack(T)` 在结构体级启用紧凑位打包（手写 helper `bp_is2/bp_type2`，L5383）。

## 3. 示例

```t
Point struct {
    x: f64;
    y: f64;
}

// 紧凑位域
Packed struct @bitpack(u32) {
    a: 3;
    b: 5;
}

// SOA 布局（ECS 批处理友好）
Particles struct #soa {
    pos: [1024]Vec3;
    vel: [1024]Vec3;
}
```

## 4. 与既有构造关系

- 结构体**字面量** `T{ ... }` 见 `expr_literal.md`（primary）。
- 成员类型语法见 `types.md`。
- `@derive` 全能力仍为 spec-only（reference L829 ⚠）。

## 5. L-14 铁律校验预留

- `struct_decl` / `sfield` 已由 GEN:parser_rules 数据驱动生成，经 difftest/conformance 验证（reference L486 ✅）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 单一定界 `Name struct { }`，无等价写法 |
| L-02 显式 | ✅ | 成员类型/位宽显式 |
| L-03 静态类型 | ✅ | 成员类型静态确定 |
| L-14 铁律校验 | ✅ | GEN 生成 + 门禁覆盖 |

## 7. L-04 张力

无内部张力。布局 `#soa`/`#aos` 与 `@bitpack` 为显式注解驱动，不引入隐式变体。
