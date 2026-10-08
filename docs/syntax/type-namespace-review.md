# 类型级命名空间审查（积类型 / 和类型）

> 状态：**审查报告 v1 → 已收尾**（审查 2026-10-07｜实施闭环 2026-10-08）｜方法：全部结论经 `out/dbg/tc.exe` 实测，非推断
> 关联：`docs/syntax/module-path-access-design.md`（模块命名空间）、`docs/compiler/decl-data-design.md`（数据声明规格）
> 定位：本文是「把**积类型与和类型**当作命名空间」这一议题的审查结论，与模块路径 epic 并列但独立

---

## 0. 一句话结论

**积类型（struct）没有命名空间能力；和类型（enum/variant）有命名空间且隔离正确，但成员名完全不校验，存在静默错编。**

最严重的缺陷是 §4.2 的：**`var x: A = .Nil` 在两个 variant 同名时会构造成另一个类型的实例，`tc check` 报 0 error**——与模块末段静默合并是同构根因。

---

## 1. 审查范围与方法

| 项 | 内容 |
|---|---|
| 范围 | `struct`（积）、`enum`（整数和）、`variant`（ADT 和）、`union`、`flag`；不含模块路径（另见 path-access 文档） |
| 工具 | `out/dbg/tc.exe check` / `run` / `compile`（clang 22.1.8） |
| 判据 | 三层分开看：**语法层**（parse 是否接受）→ **语义层**（sema 是否校验）→ **后端层**（产物是否正确，是否 link/GEP 失败） |
| 关键手法 | 每个「通过」的结论都要**实跑取值**。`0 error` 不是正确性的完备判据——本轮三个缺陷全部是 `0 error` 但产物错误 |

⚠ **方法论教训（复用）**：`tc check` 0 error 只证明「语法 + 已知语义规则」通过。**成员名存在性**这类校验一旦缺失，check 会全绿而后端产出非法代码。凡审查新特性，必须补后端层验证（`run` / 看 `.ll`），不能停在 check。

---

## 2. 能力矩阵（实测总表）

| # | 形态 | 语法层 | 语义层 | 后端层 | 判定 |
|---|---|---|---|---|---|
| 1 | `Point.O`（struct 关联常量） | ✅ 解析 | ❌ `T-SEM-E208 没有字段 O` | — | **未支持** |
| 2 | `fn Point.origin()`（struct 关联函数） | ❌ `T-PAR-E101 期待 LParen 实际 .` | — | — | **未支持**（语法层拒绝） |
| 3 | `Color.Red`（enum 变体） | ✅ | ✅ | ✅ 取值正确 | **支持** |
| 4 | `Shape.Circle(5)`（variant 构造） | ✅ | ✅ | ✅ | **支持** |
| 5 | `o.inner.v`（值级多级 member） | ✅ | ✅ | ✅ | **支持** |
| 6 | 裸名 `Red`（C 风格变体） | ✅ | ❌ `T-SEM-E201 未定义` | — | **正确拒绝**（隔离有效） |
| 7 | 裸名 `Nil` 构造 | ✅ | ❌ `T-SEM-E201 未定义` | — | **正确拒绝** |
| 8 | 两个 enum 同名变体 `Color.Red` / `Fruit.Red` | ✅ | ✅ | ✅ 输出 **1 / 10** | **正确区分** |
| 9 | 两个 variant 同名构造器（match 裸名模式） | ✅ | ✅ | ✅ 输出 **1 / 2** | **正确区分** |
| 10 | `A.Nil` 全路径 match 模式 | ✅ | ✅ | ✅ | **支持** |
| 11 | `fn Color.from_i64()`（enum 关联函数） | ❌ `T-PAR-E101` | — | — | **未支持** |
| 12 | `U{ .a = 1 }`（union 字面量） | ✅ | ❌ `T-SEM-E202 expected U but got U` | — | **缺陷** |
| 13 | `Color.Red + Color.Green` | ✅ | ❌ `expected i64 but got Color` | — | **设计选择**（nominal 强类型） |
| 14 | `Color.NotExistAtAll` | ✅ | ⚠ **0 error** | ❌ `invalid getelementptr` | **静默错编** |
| 15 | `Shape.NotExist(5)` | ✅ | ⚠ **0 error** | 未验证 | **静默错编** |
| 16 | `var x: A = .Nil`（两 variant 均有 `Nil`） | ✅ | ⚠ **0 error** | ❌ 构造错类型 | **静默错编** |

---

## 3. 积类型（struct）：几乎没有命名空间

### 3.1 现状

struct 的 member 解析在 `sema.tc:7669–7698`：receiver 类型为 `Struct`/`Named` 时，遍历 `StructDecl` 的字段链按名查找，**找不到就报 `T-SEM-E208`**。

这是全表中**唯一做了成员名校验**的路径——值得肯定，也正是它让 `Point.O` 报了错（而非静默）。

### 3.2 缺口

| 缺口 | 证据 | 层 |
|---|---|---|
| 关联常量 `Point.O` | `T-SEM-E208 结构体 Point 没有字段 O` | sema（当字段查） |
| 关联函数 `fn Point.origin()` | `T-PAR-E101 期待 LParen，实际读到 .` | **parse 层就拒绝** |
| 类型级常量命名空间 | 同上 | — |

⚠ 注意 #2 是**语法层**拒绝，比 sema 层更早。要支持关联函数，先得改 `parse.tc` 的函数名产生式，不只是 sema。

### 3.3 与用户裁定模型的关系

用户模型 `a.Point.O`（模块绑定 + 类型 + 关联常量）要求 struct 具备关联常量能力，**当前完全不具备**。这不是「接上就行」的小改动，涉及：

1. `parse.tc`：struct 体内允许 `const` / `fn` 声明
2. `sema.tc`：类型级 member 解析（当前 `member` 只处理值 receiver）
3. 双后端：关联常量的发射形态（编译期常量 or 符号）
4. 重整名：关联常量的符号名编码

**建议**：单独立项，不塞进 path-access epic（否则边界失控）。

---

## 4. 和类型（enum / variant）：隔离正确，但成员名不校验

### 4.1 做对了的部分（值得作为模块修复的参照）

- **变体不污染全局**：裸名 `Red` / `Nil` 一律 `T-SEM-E201 未定义`（#6 #7）。对比 C 的 enum 会注入外层作用域，t 的选择更严格。
- **同名变体跨类型正确区分**：`Color.Red`=1 / `Fruit.Red`=10（#8）；两个 variant 的 `Nil` 在 match 中分别取到 1 / 2（#9）。

> ⭐ **这与模块末段静默合并形成鲜明对照**：同样是「同名成员」，和类型靠 **receiver 类型**消歧（正确），模块靠 **末段字符串**匹配（塌陷）。**模块 epic 的修复可以直接照抄和类型的消歧模型**——即以「完整身份」而非「末段名」为键。

### 4.2 缺陷 P0：前导点变体全局反查 → 静默错编

`var x: A = .Nil` 的解析在 `sema.tc:7616–7647`，关键行 `7620`：

```t
var vname: string = variant_name_of_case(msa);   // ← 全局反查，无视期望类型
```

而 `variant_name_of_case`（`sema.tc:2973–2986`）的实现是**线性扫 `lex__decl_list`，返回第一个含该 case 的 VariantDecl 名**：

```t
while (i < n) {
    if (base.node_kind((d as u64)) == "VariantDecl") {
        if (variant_find_case(d, cname) >= 0) { return base.node_sa((d as u64)); }
    }
    i = i + 1;
}
```

**它完全不使用 `g_lead_expect`**（尽管该分支正是靠 `g_lead_expect` 判定为 Variant 才进来的）。

决定性实验——仅改变两个 variant 的**声明顺序**：

```t
// e1: B 先声明
variant B { Nil; Two(i64); }
variant A { Nil; One(i64); }
@main fn main() i32 { var x: A = .Nil; ... }
```

| 声明顺序 | `var x: A = .Nil` 实际生成的构造器 | 判定 |
|---|---|---|
| A 先声明 | `@A_from_Nil` | ✅ 碰巧对 |
| **B 先声明** | **`@B_from_Nil`** | ❌ **错编**，`tc check` **0 error / 0 warning** |

`tc check` 全绿，实际把 `B` 类型的值赋给了 `A` 类型的变量。

**修复（最小改动）**：`7620` 处优先取 `tip_name(g_lead_expect)`，仅当它不含该 case 时才回退全局反查；回退仍命中多个则报歧义错误。

### 4.3 缺陷 P1：enum / variant 成员名完全不校验

`sema.tc:7703–7712`：

```t
if (obk == "Enum") { return obt; }      // ← 成员名 base.node_sa(e) 从未被校验
if (obk == "Flag") { return obt; }      // ← 同上
```

`Color.Red` 与 `Color.NotExistAtAll` 走完全相同的路径、返回相同的类型。

实测：

```t
enum Color { Red = 1; Green = 2; }
println(i2s(Color.NotExistAtAll));      // tc check → 0 error
                                        // tc run   → clang: invalid getelementptr indices
```

后端把它当**结构体字段访问**发射（对 enum 发 GEP 必然非法）。这是典型的静默错编：错误在 check 层被吞掉，延到后端才爆，且爆的形式（GEP 索引非法）与真实病因（成员名拼错）毫无关联，极难定位。

对照：struct 有 `T-SEM-E208`，enum/variant/flag **没有对应诊断**。

**修复（最小改动）**：`7703` 处校验成员名是否属于该 enum（variant 同理），否则报新诊断码（对齐 E208 风格，如 `T-SEM-E209 枚举/变体 X 没有成员 Y`）。

### 4.4 设计选择：enum 是 nominal 强类型

`Color.Red + Color.Green` → `T-SEM-E202 expected i64 but got Color`。

即 enum 变体**不是** C 式整数常量，而是带 enum 类型的值，不隐式退化。这与 `decl-data-design.md` §1.2「对位 Rust `#[repr(C)]` C-like enum」一致，属**有意设计**。

⚠ 但它带来一个命名空间的直接后果：**enum 不能作为「编译期整数常量的命名空间」**。若用户期望 `Color.Red` 能当 `i64` 用，需要显式 `as i64`（未经实测，待确认）。

---

## 5. union / flag

### 5.1 union 字面量初始化失败（缺陷 P2）

```t
union U { a: i64; b: f64; }
var u: U = U{ .a = 1 };     // T-SEM-E202: type mismatch: expected U but got U
var u: U = U{ a: 1 };       // 同上（旧式关联式也一样）
```

对照 `struct S { a: i64; } var s: S = S{ .a = 1 };` → **0 error**。

「expected U but got U」= 两个 TI 名字相同但身份不同 ⇒ **union 字面量的类型推断没有复用已注册的 union TI，而是新建了一个同名类型**。非字面量路径（`var u: U;` 然后 `u.a = 1`、作为函数实参传递）均正常 ⇒ 缺陷**仅限字面量初始化**。

`decl-data-design.md` §1.4 明确 union 是受支持类型，故这是实现缺陷而非未实现。

### 5.2 flag（2026-10-07 修正：语义认知此前有误）

⚠ **本文 v1 曾据 `sema.tc:7710` 注释把 flag 描述为「命名标志位，`PF.encrypted` 取掩码」，与实现不符。** 实测 `examples/bitflags.tc`：

```t
flag Perm[u16] {
    readable:  1;      // ← 数字是「位宽」，不是值、不是掩码
    writable:  1;
    level:     4;
    owner_id:  8;
}
var p: Perm = 0;
flag_set(p, Perm.readable, 1);              // 内建访问，非 member
flag_get(p, Perm.readable)                  // Perm.readable 是位偏移
```

即 **flag = 位域打包**（bitfield packing，在 `u16` 容器内按位宽打包 1+1+4+8 位），**不是**「每位一个命名标志」。
`decl-data-design.md` §1.5 的描述（`flag Perm : u8 { R; W; X }`，且称「每位一个标志」）**与实现不符**，且语法也不对（实现用方括号 `Perm[u16]`，且字段须写 `名字: 位宽`）。

实测（`j1.tc`）：`flag Perm[u16] { readable: 1; level: 4; }` + `flag_set/flag_get` → **0 error，实跑输出 1** ⇒ 功能正常。

`flag_set` 关键字：**全仓零存量**。

### 5.3 ⭐ 注解校验覆盖不全（新发现，直接影响「属性区分类型」的设计）

| 位置 | 未知注解 | 结果 |
|---|---|---|
| **声明级**（`struct Foo @flga`） | `@flga` | ✅ `T-ANN-E450 unknown annotation` |
| **字段级**（`readable: u16 @totallybogus(1)`） | `@totallybogus` | ❌ **0 error，静默忽略** |

⚠ 含义：若按新裁定用**属性**承载 struct 类型变体，只要该属性允许出现在字段级，拼错就会**静默退化**为普通字段——不报错、不生效。这与 §4.3 的 enum 成员名不校验是同一类缺陷。

**新设计必须要求**：承载类型身份的属性**只允许出现在声明级**（那里有 E450 校验），或在字段级补齐校验。

### 5.4 ⭐ 位宽语法与 struct 字段语法冲突（新发现）

把 flag 的位域能力搬到 struct 时，字段语法直接冲突：

| 声明 | 字段写法含义 |
|---|---|
| `flag Perm[u16] { readable: 1; }` | `1` = **位宽** |
| `struct Perm { readable: 1; }` | `1` = **类型**（整数字面量当类型） |

实测 `struct Perm { readable: 1; level: 4; }`：`tc check` **0 error**，`tc run` → **`clang link failed`**。
即直接沿用 flag 的字段写法会静默错编。⇒ 统一到 struct 后**必须另定位宽语法**（如 `readable: u16 @bits(1)` 之类），不能沿用 `名字: 数字`。

⚠ 附带：实测 `readable: u16 @bits(1)` 也是 0 error，但**因字段级注解不校验（§5.3），无法据此认定 `@bits` 已受支持**——需另行确认其是否真生效。

---

## 6. 与模块 epic 的同构性（关键洞察）

| | 模块命名空间 | 和类型命名空间 |
|---|---|---|
| 消歧键 | 末段名 `last_segment(path)` | **receiver 类型** |
| 同名成员 | **静默合并**，后者永久不可达（`e.deep` 取先登记者） | **正确区分**（1/10、1/2 实测） |
| 根因 | `g_modval_set(name, last_segment(path))` | — |

**和类型证明「以完整身份为键」这条路是走得通的**，且已在 t 内部实现过一次。模块 epic 的修复不必从零设计——照抄即可：身份键从「末段字符串」换成「完整路径」，并在多源命中时报歧义而非静默取首个。

反过来看，§4.2 的前导点缺陷说明：**即便在和类型内部，只要某条路径退化成「全局名反查」，同样的塌陷就会重现**。所以真正的判据不是「用不用命名空间」，而是——

> **任何以字符串名做全局反查、且不使用上下文（期望类型 / 完整路径）消歧的地方，都是静默错编的温床。**

值得把这条提炼为通用不变量。

---

## 7. 建议实施路径

| 优先级 | 项目 | 改动点 | 风险 | 状态 |
|---|---|---|---|---|
| **P0** | 前导点变体按期望类型消歧 | `sema.tc:7620` | 低（局部） | ✅ **已完成** — M5.7.1，commit `7dde61f`，回归 `tests/conformance/pass/p_variant_lead_expect.tc` |
| **P1** | enum/variant/flag 成员名校验 | `sema.tc` 成员解析 Enum/Flag/Variant 三分支 + 新诊断码 `T-SEM-E216` | 低；**会使既有错误代码开始报错**，需扫描 `src/` `tests/` `examples/` 确认零误报 | ✅ **已完成** — 见 §7.1，全仓零误报已通过 |
| **P2** | union 字面量类型身份 | `sema.tc` `struct_lit` 按声明种类返回 Union/Struct TI | 中 | ✅ **已完成** — M5/P2，commit `aedee5e`；⚠ LLVM 后端 union 占位桩（`%U = type { i8 }`）为独立后端 epic，C 后端可用 |
| **P3a** | struct 关联常量 | `parse_struct_decl` KwConst 分支 + `flush_struct_consts()` + sema member 补查 `<struct>_<Name>` | 高，**已单独立项** | ✅ **已完成** — M5/P3a，commit `478f9c4` |
| **P3b** | struct 关联函数/方法成员调用脱糖 | sema call 分支 member→`<struct>_<Name>` ident 改写 + 方法前置 receiver | 高 | ✅ **已完成** — M5/P3b，commit `1c23296`；conformance 339/0、gate L2 25/0 |

### 7.1 P1 已落地：成员名校验（新诊断码 `T-SEM-E216`）

**诊断码选型**：文档早前的建议「如 `T-SEM-E209`」**不可行** —— E209 已被 `TAGID_DUP` 占用
（`sema.tc` 发射点）；数字 212 也被 `T-SEM-W212`（`OVERFLOW_LITERAL`, warning）占用。
⚠ 该编号空间按**数字本体**排序（…E211 / **W212** / E213…），只看 `E` 前缀会漏判占用。
最终取 **`T-SEM-E216` = `UNKNOWN_MEMBER`**（紧邻 `E208 UNKNOWN_FIELD` 语义族，编号接续 E215）。

**实现**：新增 `member_exists_in_type(obt, mname)`（置于 `variant_find_case` 之后），
沿用 `node_lb(decl)` 取头 + `kids_chain` 物化 + 比对 `node_sa` 的既有范式；
仅当**确实查到声明且确实没有该成员**时才报错，符号/声明缺失或 kind 不属于
`EnumDecl`/`VariantDecl`/`FlagDecl` 一律放行，避免在解析不全的路径上误报。

**⚠ 关键差异：Variant 分支不加 `bd`（callee）豁免**。struct 的 `bd` 豁免是为
`p.clone()` 这类**方法调用**（成员名不是字段）而设；而 variant **没有方法**，且其构造器
本就以「成员访问充当 callee」的形式书写（`Shape.Circle(1.0)`）。套用豁免会让**最常见的
构造形态连同拼错的 case 名一起逃过校验**（即本文档 case 15）。故仅 Variant 不豁免，
Enum/Flag 仍保留豁免口径。

**验证**：10 个探针全通过（合法成员 0 error 无误报；enum/flag/variant 缺失成员均命中 E216，
含 `Shape.NotExist(1.0)` call 形与 `Shape.Bogus` 裸成员两种写法）；`src/tc.tc` 扫描 **0 误报**。

**回归夹具**：
- fail：`f_enum_member_unknown.tc` / `f_flag_member_unknown.tc` / `f_variant_member_unknown.tc`
- pass（反向守卫，防误报）：`p_member_names_valid.tc`

**已知未覆盖**：变体**字面量构造** `Shape { .NotExist(1.0) }` 仍静默通过——它走前导点
的另一条路径（非成员解析处），不属本次 P1 改动范围，留待后续。

⚠ ~~P1 落地前必须做一次全仓扫描~~ → **已执行并通过**：`src/tc.tc` + conformance + examples
扫描结果为零误报（既存代码中没有「拼错却一直编译通过」的成员名）。

---

## 8. 裁定与实施闭环

本文档原 §8 的 4 项待裁定，现已全部闭环（2026-10-08）：

| # | 原待裁定项 | 裁定 / 状态 | 证据 |
|---|---|---|---|
| 1 | P0/P1 是否立即开工 | ✅ **已落地** | P0 `7dde61f`（variant_name_of_case 尊重 `g_lead_expect` 消歧）、P1 `48e4901`（enum/variant/flag 成员名校验 `T-SEM-E216`）、P1.1 `0b2e600`（变体字面量 `.Case` 成员名校验） |
| 2 | P2（union 字面量类型身份）是否并入本轮 | ✅ **已落地** | `aedee5e`；⚠ LLVM 后端 union 占位桩 `{ i8 }` 段错误属独立后端 epic，C 后端可用 |
| 3 | struct 关联常量/函数是否单独立项 | ✅ **已落地**（拆 P3a + P3b） | P3a 关联常量 `478f9c4`、P3b 关联函数/方法脱糖 `1c23296` |
| 4 | enum 是否允许隐式转整数 | ✅ **裁定：不允许隐式转换** | 见 §8.1 |

### 8.1 enum 隐式整数转换：裁定为「禁止」

**裁定（用户，2026-10-08）**：enum **不允许隐式转换为整数**，保留 nominal 强类型模型。

- **依据**：能力矩阵 #13 `Color.Red + Color.Green` 当前已在语义层拒绝（`expected i64 but got Color`），证明 nominal 隔离已生效；允许隐式 `enum → i64` 会破坏 enum 作为独立类型身份的隔离性，并重新引入「整数魔法值」反模式。
- **结论**：
  - 不新增任何隐式 `enum → i64` 转换。
  - 若未来确需在 enum 与整数间互转，**只能走显式语法**（如 `Color.from_i64(x)` / `x.as_i64()`），且须单独立项设计，不得退化为隐式。
  - variant 维持现状（构造器 / 成员访问即其使用形态），`Shape.Circle` 等不做整数转换。
- **影响面**：本裁定与 product-type-unification epic 的 `flag` / `flag_set` 处置口径一致（名义类型不做隐式整数降级）。

### 8.2 收尾说明

- 本文结论（§0–§7）经实测，实施期（P0–P3b）未推翻任何审查结论，仅补全了 struct 关联常量/函数缺口与 union 字面量类型身份。
- 唯一审查期内未覆盖项（§7.1「变体字面量构造 `Shape { .NotExist(1.0) }` 静默通过」）已在 P1.1 `0b2e600` 补 `T-SEM-E216` 校验，已闭环。
- 类型级命名空间 epic（P0/P1/P1.1/P2/P3a/P3b）**无未决节点**，与 `docs/syntax/module-path-access-design.md`、`docs/syntax/type-namespace-review.md` §7 路线图状态一致。

---

## 附：复现命令

```bash
# P0 前导点静默错编（改声明顺序即可切换结果）
variant B { Nil; Two(i64); }
variant A { Nil; One(i64); }
@main fn main() i32 { var x: A = .Nil; println(i2s(1)); return 0; }
# → tc check 0 error；.ll 中出现 @B_from_Nil（应为 @A_from_Nil）

# P1 enum 成员名不校验
enum Color { Red = 1; Green = 2; }
@main fn main() i32 { println(i2s(Color.NotExistAtAll)); return 0; }
# → tc check 0 error；tc run → clang: invalid getelementptr indices

# P2 union 字面量
union U { a: i64; b: f64; }
@main fn main() i32 { var u: U = U{ .a = 1 }; return 0; }
# → T-SEM-E202: type mismatch: expected U but got U
```
