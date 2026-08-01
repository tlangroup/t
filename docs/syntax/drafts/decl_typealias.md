# 语法规则草稿 · 类型别名（TypeAlias）  [DRAFT]

> 依据：`src/tc.tc` `parse_type_alias`（GEN 生成）+ `docs/reference.md` §2.8 `type_alias`（L285–L291）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
TypeAlias: Ident Type ";"
```

- 权威产生式（reference §2.8）：`type_alias :: type ";"`，绑定在 `Ident` 之后（L263 分发落入 `parse_type_alias`）。
- 即 `Name <某类型表达式> ;` 将 `Name` 设为该类型的别名。

## 2. Where（约束）

- 别名仅为类型命名，不创建新类型（名义类型由 `struct`/`enum`/`flag`/`variant` 承担）。
- 右侧 `Type` 可为任意类型表达式（含数组/切片/map/指针，见 `types.md`）。
- 分号结尾（`type_alias :: type ";"`）。

## 3. 示例

```t
Vec3 [3]f64;
StringTable map[string]string;
Callback fn(i64) -> void;   // 若 fn 类型落地
```

## 4. 与既有构造关系

- 与 `decl_struct.md` 等「名义类型声明」区分：别名不引入新类型标识。
- 右侧类型文法见 `types.md`。

## 5. L-14 铁律校验预留

- `type_alias` 已由 GEN:parser_rules 数据驱动生成（reference L486 ✅）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 唯一 `Name Type ;` 别名写法 |
| L-02 显式 | ✅ | 右侧类型显式 |
| L-03 静态类型 | ✅ | 别名绑定静态类型 |
| L-14 铁律校验 | ✅ | GEN 生成 + 门禁 |

## 7. L-04 张力

无内部张力。注意 `Name Type`（别名）与 `Name struct { }`（名义类型）共享「名 + 种类关键字」形态但右侧不同，不构成等价多写。
