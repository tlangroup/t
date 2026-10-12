# 语法规则草稿 · 代数数据类型（ADT）：以 variant 为本体  [DRAFT]

> **状态**：草稿（DRAFT）—— 依据既有实装与法律框架（L-02/L-03/L-04/L-14）起草，**待用户「规则采纳」指令**方可并入 `docs/reference.md`，原草稿随即标记失效。
> **依据**：`src/parse.tc`（`parse_variant_decl`/`parse_case` L3716–L3754）、`src/sema.tc`（`register_variant_helpers`、`ti_mk("Variant")`）、`src/codegen_c.tc`/`codegen_ll.tc` 的 VariantDecl 处理；`docs/syntax/drafts/match.md`（§6.1 明确把 variant 解构列为前向依赖 TODO）；`docs/syntax/drafts/decl_variant.md` / `decl_enum.md`。
> **范围裁定**（2026-08-20 用户裁定）：① 以 `variant` 为 ADT 本体补全；② `enum` 与 `variant` 保留分工（enum=常量集 / variant=带载荷和类型）；③ 泛型 `comptime` 本期留接口、不实现。
> **作用对象**：把 t 已有的「积类型 `struct` + 和类型 `variant` + 常量集 `enum` + 模式匹配 `match`」收口成一套自洽的代数数据类型体系。**唯一新增能力**是 `match` 对 `variant` 构造器的**解构 + 穷尽性**，以及配套补齐的多载荷 case、`@repr` 收窄 tag、递归 variant、`@derive` 目标扩展。

---

## 1. EBNF（§1 Notation）

```ebnf
// —— variant 声明（扩展多载荷 case + 抽象标记）——
VariantDecl: Ident "variant" Annotations? "{" VariantCase* "}"
VariantCase:  Ident ("(" TypeList? ")")? Annotations? ("," | ";")?
            | "_"                              // 抽象标记：仅作 variant 末位，声明为「抽象 / 非穷尽」
TypeList:     Type ("," Type)*

// —— match 模式（扩展构造器模式）——
MatchPat:
    | Literal            // 字面量相等匹配（整数 / 字符串 / bool）
    | ConstructorPat     // variant 构造器解构（仅 scrutinee 为 Variant 时启用）
    | CaseName           // enum 成员（大写；仅 scrutinee 为 Enum 时解析，沿用 match.md C2 / A1）
    | Ident              // 绑定：匹配任意值并绑定（小写，见 §2 C2）
    | "_"                // 通配占位：匹配任意值，不绑定

ConstructorPat: (VariantName ".")? UpperIdent ("(" PatternList? ")")?
PatternList:    Pattern ("," Pattern)*
Pattern:        Literal | ConstructorPat | Ident | "_"     // 递归：支持嵌套解构
```

- **多载荷 case（新增）**：`parse_case` 当前仅接受单个 `Type`（`parse.tc` L3719–L3723），需扩展为循环 `parse_type()` 收集 `TypeList`。例：`Rect(f64, f64)` 此前无法解析，本次纳入。
- **单元 case**：`Empty;` 无 `()`，载荷为空，构造器为 `Shape_from_Empty()`。
- **构造器模式**：`.Circle(r)` / `.Rect(w, h)` / `.Empty`（单元 case 写前导点）/ `Shape.Circle(r)`（限定写法，与 enum 一致）。裸名 `Circle(r)` 已废弃并报 `T-MAT-E751`。嵌套：`Tree(.Leaf(x))` / `Node(l, Node(.Leaf(y), r))`。
- **`_` 与 `when`** 沿用 match.md：通配不绑定；守卫须 `bool`（白名单）。

---

## 2. Where（编译期约束）

- **表示法（representation）**：variant 编译为 `struct { <tag_t> _tag; union { <payload_t> _u0; ... } _u; }`。
  - **tag 位宽**：默认 `u32`（`_tag` 为 case 声明下标，0 起）。`@repr(u8)` / `@repr(u16)` / `@repr(u32)` 可显式收窄/放宽 tag 位宽（case 数超 255 时 `@repr(u8)` 报 `T_REPR_TAG_OVERFLOW`）。
  - **多载荷存储**：单元 case 无 `_u` 槽；单载荷 case 的 `_uN` 即该类型；多载荷 case 的 `_uN` 为匿名 `struct { T0 f0; T1 f1; ... }`（顺序即声明序）。`@no_padding` / `@align` 同样适用。
- **递归 variant（允许）**：case 载荷可引用自身类型名（指针形态）`List variant { Nil; Cons(i64, *List) }`。前向引用在 register 阶段按名字解析；非指针自引用（值形态）报 `T_VARIANT_RECURSIVE_VALUE`（避免无限大小）。
- **构造器函数（沿用既有生成）**：为每个 case 生成 `Name_from_Case(...)`（构造）、`Name_is_Case(self)`（判别）、`Name_as_Case(self)`（取载荷）。多载荷时 `from_Case` 形参为各载荷类型；`as_Case` 取载荷——**单载荷**返回该载荷类型，**多载荷**逐字段 `Name_as_Case_fK(self)`（K 从 0 起、位置序），脱糖目标即此。
- **`match` 构造器解构（核心新增）**：
  - 仅当 **scrutinee 静态类型为 `Variant`** 时，模式位的**首字母大写标识符**按构造器解析（C2 约定从 enum 推广到 variant；裸 `Circle` ⇔ `Shape.Circle`，拼写错报 `T_MATCH_UNKNOWN_CASE` 指名合法 case）。
  - 带 `(` 即构造器模式，参数按声明序绑定到该 case 载荷（位置式）：`Rect(w, h)` 绑定第 0/1 载荷；数量不符报 `T_MATCH_PATTERN_ARITY`。
  - **嵌套 / 守卫**：`Pattern` 递归允许构造器嵌套；`when` 守卫 `bool` 白名单（沿用 match.md）。
- **穷尽性（A1 推广到 variant）**：variant 所有 case 各被一条**无守卫**臂覆盖 ⇒ 穷尽；否则须有 `_` / 裸绑定兜底臂；否则报 `T_MATCH_NONEXHAUSTIVE` 并**指名列出未覆盖的 case**（如 `unhandled case(s) Shape.Rect, Shape.Empty`）。带守卫臂不计覆盖。新增 case 即触发所有旧 `match` 编译期报错——穷尽性检查的核心价值。**抽象 variant 豁免此约束（见下）。**
- **抽象 variant（非穷尽 / open）**：variant 声明末位写 `_`（如 `StatusCode variant { Ok; Fail; _ }`）即声明为**抽象 / 开放和类型**。`_` 是类型级标记、**不是真实 case**（无构造器、不占 tag）。语义后果：① `match` 于抽象 variant 上**不强制穷尽性**，不报 `T_MATCH_NONEXHAUSTIVE`；② 未覆盖的具名 case 与「未知 tag」统一由 `_` 兜底臂吸收，无 `_` 臂则运行期落到确定性 `t_panic`（L-09 零 UB，不读垃圾值）；③ 抽象 variant 仍为其具名 case 生成 `from_Case` / `is_Case` / `as_Case`。典型用途：错误码 / 状态码等「调用方只知道部分 case、其余兜底」的开放集合。闭 variant（无 `_`）与抽象 variant（末位 `_`）构成 closed/open 双轴。
- **结果类型统一**：各臂表达式须推断为同一类型 `R`（`T_MATCH_ARM_TYPE`，沿用）。
- **绑定作用域**：构造器模式绑定仅在其臂内可见，遮蔽外部同名；`match` 结束即失效。
- **`@derive` 目标扩展**：把 `variant` 加入 `@derive` 目标集（reference §2.3 第 263 行 `targets` 当前缺 `variant`）；**本期实现目标集 = `{Clone, Copy, Eq, PartialEq, Hash}`**（`BinarySerde`/`ToString`/`FromString`/`DebugPrint` 依赖通用 `@derive` 桩修复，reference §3.1 第 895 行标注其为空壳/有 bug，本期不保证，列为后续）。
- **L-04 单一语义**：`match` 是唯一表达式级分发；variant 解构是 `match` 的模式子集，不引入第二种分发语法。

---

## 3. Examples

```t
// ── ① 多载荷和类型 + 构造器解构 + 穷尽性 ──────────────────
Shape variant {
    Circle(f64);          // 半径
    Rect(f64, f64);       // 宽、高
    Empty;
}

area fn(s: Shape) -> f64 {
    return match (s) {
        .Circle(r)   => 3.14159 * r * r
        .Rect(w, h)  => w * h
        .Empty       => 0.0
    };
}

// ── ② 单元 case + 守卫 ───────────────────────────────────
MaybeInt variant {
    Some(i64);
    None;
}
is_positive fn(m: MaybeInt) -> bool {
    return match (m) {
        .Some(x) when x > 0 => true
        .Some(_)            => false
        .None               => false
    };
}

// ── ③ 递归 variant（指针自引用）──────────────────────────
List variant {
    Nil;
    Cons(i64, *List);
}
sum fn(xs: List) -> i64 {
    return match (xs) {
        .Nil        => 0
        .Cons(h, t) => h + sum(t)
    };
}

// ── ④ @derive（克隆 / 判等）──────────────────────────────
Point variant @derive(Clone, Eq) {
    Pt(f64, f64);
    Origin;
}

// ── ⑤ 抽象 variant（末位 _ = 非穷尽 / 开放）────────────────
StatusCode variant {
    Ok;
    Fail;
    _                      // 抽象标记：未知状态码一律兜底
}
handle fn(c: StatusCode) -> string {
    return match (c) {
        .Ok  => "ok"
        .Fail => "fail"
        // 无需覆盖全部；其余（含未来新增 tag）由 _ 兜底，不报 NONEXHAUSTIVE
        _   => "unknown"
    };
}
```

---

## 4. 与既有构造关系（L-04 论证）

| 构造 | 角色 | ADT 体系定位 | 状态 |
|---|---|---|---|
| `struct` | 积类型（product） | 字段聚合，纯数据 + 方法脱糖 | ✅ 已实装 |
| `variant` | **和类型（sum，带载荷）** | **ADT 本体**：match 解构 / 多载荷 / 递归 | ✅ 声明 + match 解构(含嵌套) + 多载荷 + 递归指针 `*Self` + 值自引用拦截 `T_VARIANT_RECURSIVE_VALUE` + 抽象 `_`(末位豁免穷尽性)；⚠ `@repr` / `@derive` / 限定模式 `V.C(x)`（设计预留，实测报错） |
| `enum` | 常量集（C 式命名常量，无载荷） | 轻量标签，底层整型，零开销 | ✅ 已实装（match 常量穷尽） |
| `union` | 无标签裸联合（unsafe） | 非 ADT，内存复用原语 | ⚠ spec-only |
| `match`/`when` | 模式分发（表达式） | ADT 的解构入口；穷尽性保证安全 | ✅ 已实装；**variant 构造器模式(含嵌套)已落地**，穷尽性 + `when` 守卫已落地 |

- `variant` ≠ `enum`：enum 成员无载荷（常量），variant case 可携带任意载荷。二者职责不重叠，不融合（用户裁定）。
- `match` 对 enum 走 `CaseName` 常量分发（match.md A1），对 variant 走 `ConstructorPat` 解构分发（本草稿），统一在同一 `MatchExpr` 节点下，语义真源唯一。

---

## 5. 代码生成草图（双后端）

每个构造器臂脱糖为「按 `_tag` 分支 + 载荷绑定」：

```c
// match (s) { .Circle(r) => BODY; .Rect(w,h) => ...; .Empty => ...; _ => ... }
if (s._tag == 0) { f64 r = s._u._u0; /* BODY */ }
else if (s._tag == 1) { f64 w = s._u._u1.f0; f64 h = s._u._u1.f1; /* BODY */ }
else if (s._tag == 2) { /* Empty: 无载荷 */ /* BODY */ }
else { /* _ 兜底 */ }
```

- **C 后端**：复用现有 `VariantDecl` 的 `_tag`/`_u` 布局（`codegen_c.tc` L2214 已处理 EnumDecl/UnionDecl 同类结构）；绑定从 `_u._uN[.fK]` 读取。
- **LLVM 后端**：`codegen_ll.tc` 的 VariantDecl 路径已生成等价 `struct { i32 _tag; %union... }`；按 `extractvalue`/`gep` 取 `_tag` 与对应 union 成员。
- **穷尽性**是纯检查期保证，发射侧无需兜底（但 `_` 兜底臂仍存在，编译为 `else`）。
- **自举不动点**：variant 声明形态改动须保持 `tc → g2 → g3 → g4` 四代 `.ll` 逐字节相同（`tools/gate.mjs` L2）。

---

## 6. L-14 铁律校验计划（实现后）

| 门禁 | 覆盖项 | 目标 |
|---|---|---|
| `tools/conformance.mjs` | `pass`：`variant_match_destructure_ok`、`variant_match_exhaustive`、`variant_recursive_ok`、`variant_multifield_ok`、`variant_abstract_ok`、`variant_derive_clone_eq`；`fail`：`f_variant_match_missing_case`(NONEXHAUSTIVE)、`f_variant_match_unknown_case`、`f_variant_match_pattern_arity`、`f_variant_recursive_value`、`f_variant_abstract_bad_underscore`(非末位/重复 `_`) | 全 PASS |
| `tools/run_examples.mjs` | `examples/adt_shape.tc` / `adt_list.tc`（C + LLVM 双后端各自比对 `.expected.txt` 并交叉比对） | PASS |
| `tools/gate.mjs` L2 | 四代自举不动点 | md5 全等 |
| `difftest.mjs` | 代际对拍 | PASS |
| `; UNSUPPORTED` 计数 | 发射侧未支持标记 | 0 |

---

## 7. 设计裁定（已决）

### 7.1 ADT 本体：variant（2026-08-20）
**裁定：以 `variant` 为 ADT 本体补全**，而非新造关键字或融合 enum。理由：variant 已是带载荷和类型、生成构造器/判别器的实质 ADT；缺口仅在 `match` 解构与多载荷/递归/@derive 收口，改动局部、门禁可控。

### 7.2 enum 与 variant 分工（2026-08-20）
**裁定：保留两者分工**。enum = C 式命名常量集（底层整型、无载荷、零开销）；variant = 任意载荷和类型。不融合为 Rust 式单一 enum（与现有 variant 实装及已稳定 enum-match 路径冲突大）。

### 7.3 泛型 ADT（2026-08-20）
**裁定：本期留接口、不实现**。`variant` 仅支持具体类型；`comptime T: any` 泛型 + 递归类型单态化列为后续里程碑，避免范围膨胀。

### 7.4 多载荷 case 形态（本草稿裁定）
**裁定：位置式多载荷** `Case(T1, T2, ...)`，匹配 `Rect(w, h)` 位置绑定。命名字段式 `Case { w: f64; h: f64 }` 更 ergonomic 但需每 case 字段名表，列为后续扩展，本期不做。

### 7.5 穷尽性判据（A1 推广）
**裁定：variant 全 case 无守卫覆盖即穷尽**，`_` 变可选。与 match.md §7.3 对 enum 的裁定一致——新增 case 强制回访所有 `match`，指名未覆盖 case。

### 7.6 抽象 variant（2026-08-21）
**裁定：variant 末位 `_` = 抽象 / 非穷尽标记（open variant）。** 用户以 `variant { ok, fail, _ }` 示例明确：尾部下划线使该和类型成为开放集合，`match` 豁免穷尽性强制。理由：错误码 / 状态码等场景调用方只知部分 case、其余须兜底；与闭 variant 的强制穷尽构成 closed/open 双轴，复用同一 `VariantDecl` 节点（仅多一个 `is_abstract` 标记），不引入新关键字、不破坏自举。运行时未知 tag 落到 `_` 兜底臂或确定性 `t_panic`（L-09），不读垃圾值。

---

## 8. 采纳状态

**已采纳（部分合并）**：核心规则（多载荷 case、match 构造器解构含嵌套、穷尽性、递归指针 `*Self`、值自引用拦截 `T_VARIANT_RECURSIVE_VALUE`、`when` 守卫）已并入 `docs/reference.md` §3.1 VariantDecl，并经双后端示例、conformance、gate L2 四代不动点验收（2026-08-24，信任根 tcfix7）。

**实测未实装（文档须如实标注，避免吹牛）**——以下为设计预留、当前源码仍报错：
- `@repr(uN)` 收窄 tag 位宽：报 `T-ANN-E452`（实测 `repr.tc`）。
- `@derive(...)` 目标集含 variant：报 `T-ANN-E452`（实测 `derive.tc`）。
- 限定写法构造器模式 `Variant.Case(x)`：报 `T-PAR-E101`（实测 `qual.tc`）。

> ✅ 勘误修正（2026-08-24）：抽象 variant（声明末位 `_`）**已实装**——经正确 match 语法（臂换行分隔）复核，`S variant { Ok; Fail; _ }` 声明零诊断；`match` 对该类型**豁免穷尽性**（仅覆盖部分 case、无 `_` 臂也通过），封闭 variant 同样写法正确报 `T_MATCH_NONEXHAUSTIVE`；非末位 `_` 报 `T_VARIANT_ABSTRACT_MARKER`。之前「未实装」系测试误用 `;` 分隔 match 臂触发无关错误所致，已撤销误判。

四项法律判据 L-02 / L-03 / L-04 / L-14 现均已落地；§7 五项裁定全部已决。未实装三项为后续里程碑，不影响已落地的单/多载荷、嵌套解构、穷尽性、递归指针、抽象 variant。
