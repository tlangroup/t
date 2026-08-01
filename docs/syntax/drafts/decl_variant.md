# 语法规则草稿 · 变体与联合声明（VariantDecl / UnionDecl）  [DRAFT]

> 依据：`src/tc.tc` / `docs/reference.md` §2.8 `variant_decl`/`case`/`union_decl`/`umember` / §3.1。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
VariantDecl: Ident "variant" Annotations? "{" VariantCase* "}"
VariantCase: Ident ("(" Type ")")? Annotations? ("," | ";")?
UnionDecl: Ident "union" Annotations? "{" UnionMember* "}"
UnionMember: Ident ":" Type Annotations? ("," | ";")?
```

- `VariantCase`：`Name` 为标签；`(Type)` 可选载荷；无载荷即单元 case。
- `UnionMember`：`Name: Type` 普通成员（untagged union，无标签判别）。

## 2. Where（约束）

- variant 编译为 `struct { uint32_t _tag; union { ... } _u; }`，并为每 case 生成自由函数
  `Name_from_Case(...)`（构造）/ `Name_is_Case(self)`（判别）/ `Name_as_Case(self)`（取载荷）。
- `@derive` 在 variant 上暂未支持（reference L855 ⚠ spec-only）。
- union 标记但未实装（reference L815「union 标记但未实装」）。

## 3. 示例

```t
Shape variant {
    Circle(f64);
    Rect(f64, f64);
    Empty;
}

MaybeInt union {
    i: i64;
    f: f64;
}
```

## 4. 与既有构造关系

- variant 的**模式解构 + 载荷绑定**由 `match.md` 的 `match` 表达式完成（sum-type 匹配）。
- 判别/取载荷手判函数（`Name_is_Case`/`Name_as_Case`）为 variant 的运行时辅助，非语法。

## 5. L-14 铁律校验预留

- `variant_decl`/`case`/`union_decl`/`umember` 已由 GEN 生成（reference L486 ✅）。
- variant 解构匹配尚未纳入 match 门禁（见 `match.md` L-14 ❌ 执行缺口）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | `Name variant { }` / `Name union { }` 唯一写法 |
| L-02 显式 | ✅ | case 载荷类型显式 |
| L-03 静态类型 | ✅ | 标签 + 载荷类型静态确定 |
| L-14 铁律校验 | ⚠️ | 声明 GEN 覆盖；解构匹配门禁待补 |

## 7. L-04 张力

无声明层冲突。variant 解构虽与 `switch` 的 enum 匹配概念接近，但 `match.md` 已裁定 match 专司 sum-type，不重叠。
