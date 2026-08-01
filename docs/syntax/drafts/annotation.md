# 语法规则草稿 · 注解（Annotations）  [DRAFT]

> 依据：`src/tc.tc` `parse_annotations` / `parse_annotation_args`（L4718–L4800）+ `docs/reference.md` §3.2 / §2.8 注解注册表。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
Annotations: Annotation*
Annotation: "@" (Ident | "export") AnnotationArgs?
AnnotationArgs: "(" AnnArg ("," AnnArg)* ")"
AnnArg: String | Integer | IdentList
IdentList: Ident ("," Ident)*
```

- 注解以 `@` 引导，名称小写 snake_case（`is_lower_snake` 校验，L4784，否则 `T_NAME_ANNOTATION_LOWER` 告警）。
- 参数可选，逗号为分隔；参数类型限 `String` / `Integer` / `Ident(列表)`（`parse_annotation_args` L4721–L4755）。

## 2. Where（约束）

- 注解可前置（声明种类关键字前）或后置（声明体后），编译器 `list_concat` 合并（`parse_decl_body` L5579）。
- 注解为**编译期元数据**，无运行时行为副作用；其语义由编译器/工具消费（非隐式运行期魔法）。
- 名称空间统一小写 snake_case，避免与标识符混淆。

## 3. 注册表（reference §3.2 / L870–L874）

| 类别 | 注解 |
|---|---|
| 派生 | `@derive(ToString,FromString,Clone,Copy,DebugPrint,BinarySerde,Eq,Hash)` ⚠ 部分 spec-only |
| 布局/ABI | `@repr()` `@no_padding` `@align()` `@bitpack(T)` `@offset(N)` `@soa` `@aos` ⚠ 多 spec-only |
| 函数约束 | `@inline` `@no_inline` `@must_use` `@const_fn` `@unsafe` `@main` `@export_symbol` `@link_name` `@panic_handler` `@doc` `@doc_file` |
| 数据 | `@export` `@binary_offset(N)` `@binary_skip` |

## 4. 与既有构造关系

- `@main` 标记程序入口（reference §4），替代固定名 `main`。
- `@bitpack(T)`/`@offset(N)` 用于 `decl_struct.md`/`decl_flag.md` 的位域布局。
- `@derive` 全能力仍为 spec-only（reference L829/L855 ⚠）。

## 5. L-14 铁律校验预留

- 注解注册表已数据化（reference §3.2 ✅ tote 注册表已数据化）。
- 名称 snake_case 由 `T_NAME_ANNOTATION_LOWER` 校验。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 唯一 `@name(args)` 形态，无等价写法 |
| L-02 显式 | ✅ | 注解参数显式，无隐式默认行为 |
| L-03 静态类型 | ✅ | 注解为编译期元数据，不影响类型 |
| L-14 铁律校验 | ✅ | 注册表数据化 + 名称校验 |

## 7. L-04 张力

- `@soa`/`@aos` 同时作为声明级布局（`decl_struct.md` 的 `Layout`）与注解存在，但二者在 `parse_decl_body` 中统一处理（`#soa` 前缀与 `@soa` 注解等价），属单一定界下两种书写位置（声明前 `#` vs 注解 `@`），**建议明确 `#soa`/`#aos` 为声明级布局标记、`@soa`/`@aos` 为等价注解别名，由编译器归一**以避免潜在 L-04 张力。
