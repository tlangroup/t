# 语法规则草稿 · 顶层声明总览（Items）  [DRAFT]

> 依据：`src/tc.tc` `parse_declaration` / `parse_decl_body`（L5598–L5594）+ `docs/reference.md` §3.1 / §2.8。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
Item: Annotations? (ImportDecl | ComptimeItem | GlobalVarDecl | GlobalConstDecl | DeclBody)
DeclBody: Ident DeclKind
DeclKind: FuncDecl | StructDecl | EnumDecl | FlagDecl | FlagSetDecl
         | VariantDecl | UnionDecl | TypeAlias
ComptimeItem: "comptime" DeclBody
```

> 说明：`DeclKind` 各分支的精确产生式见细分草稿 `decl_func.md` / `decl_struct.md` / `decl_enum.md`
> / `decl_flag.md` / `decl_variant.md`（含 union）/ `decl_typealias.md`。`GlobalVarDecl` /
> `GlobalConstDecl` 见 `decl_var.md`，`ImportDecl` 见 `decl_import.md`。

## 2. Where（约束）

- 所有顶层声明采用「`Ident <kind>`」形式（声明名直接后接种类关键字 `fn`/`struct`/`enum`/`flag`/`flag_set`/`variant`/`union`/`type`，无定界符；原 L5598 `DoubleColon` 要求已移除）。
- 注解（L4769 `parse_annotations`）可前置或后置（声明体之后），由编译器 `list_concat` 合并。
- `KwComptime` 前缀标记编译期声明（当前仅类型/导入相关语义受限）。
- 分号 `;` 可独立成句（空语句），`parse_unit` 跳过（L5642）。

## 3. 与既有构造关系

- 表达式级构造不在此章，见 `expr.md` 及其细分草稿。
- `match.md` 的「函数子句自由式 `fn f(...)`」与本章绑定式 `Name fn(...)` 存在 L-04 张力，见 `decl_func.md §7` 与 `match.md §7.2`。
- 控制流语句（`if`/`for`/`while`/`switch`）不属于声明，见 `stmt_control.md`。

## 4. L-14 铁律校验预留

- 声明解析已纳入 conformance/difftest 门禁（reference §3.1 标记 ✅ tote）。
- 注解名 `lowercase_snake_case`（L4784 `warn_name("T_NAME_ANNOTATION_LOWER")`）。

## 5. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 每种声明仅一种绑定写法（`Name kind`），无等价多写 |
| L-02 显式 | ✅ | 类型、注解均显式书写 |
| L-03 静态类型 | ✅ | 类型在声明处静态确定 |
| L-14 铁律校验 | ✅ | 门禁已覆盖 |

## 6. L-04 张力

无内部张力；与 `match.md` 的函数子句张力为跨草稿协作问题，单列于 `decl_func.md §7`。
