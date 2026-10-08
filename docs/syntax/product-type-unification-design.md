# 积类型统一到 struct（设计裁定 + 现状实测）

> 状态：**设计裁定 v1**（2026-10-07）｜方法：全部结论经 `out/dbg/tc.exe` 实测
> 关联：`docs/syntax/type-namespace-review.md`（类型级命名空间审查）、`docs/compiler/decl-data-design.md`（被本裁定推翻的旧规格）

---

## 1. 裁定内容（用户 2026-10-07，2026-10-09 修订）

1. **积类型统一到 `struct`**：废弃 `flag` **声明关键字**，改用 `packed struct X { ... }` 表达位域结构体。
   - ⚠ `packed` 是**编译器内置的结构体修饰关键词**（仅在 struct 声明位置被识别），**不是**全局保留关键字。
   - 所有积类型归并为**单一 `struct` kind**（AST 与 TI 同源）。
2. **TI 层深度统一（决策 #3，2026-10-09）**：TI `kind` 不再保留 `Flag` / `FlagSet`，统一为 `Struct` + 属性（`@packed` / 位域布局）。语义最干净；所有按 `tip_kind()=="Flag"` 派发处（sema 布局、双后端发射、位域访问内建）需重写。
3. **位域能力保留（决策 #1）**：`flag` 的位域打包价值由 `packed struct` 承载，能力不丢；位宽字段的具体语法（如 `@bits(N)` / `@packed(uN)`）仍待裁定（见 §5 #1）。
4. **`flag_set` / `flag_get` 动态位域能力保留（决策 #2）**：即使零存量也不删；二者作为内建作用于 `packed struct` 的底层整数值。
5. **`@derive` 的 8 个 trait 能力保留（决策 #4）**：Clone / Copy / Eq / Hash / ToString / FromString / DebugPrint / BinarySerde 以更干净的形式重建（旧 `process_derive` 已删，注解暂为 no-op），非彻底废弃。
6. **`@derive` 注解保留为 no-op**：C 后端存量 `@derive` 代码零破坏、照常编译（见 §2.2）。

⚠ 本裁定**推翻 `decl-data-design.md` §1.1（`@derive`）与 §1.5（`flag` / `flag_set`）**——那份文档把三者均列为受支持特性。该文档对应章节需作废或改写。

---

## 2. 现状实测（裁定前的事实基线）

| 项 | 实测结果 | 存量 |
|---|---|---|
| `flag` | ✅ **已实装且可用**（位域打包） | **1 处**（`examples/bitflags.tc`） |
| `flag_set` | 语法存在（`flag_set X[u8] {...}`） | **0 处** |
| `@derive` | ⚠ **曾为实装代码生成（非死代码）**；本任务删代码生成、注解保留为 no-op | 14 处注解 |
| 声明级未知注解 | ✅ `T-ANN-E450 unknown annotation` | — |
| **字段级未知注解** | ❌ **0 error，静默忽略** | — |

### 2.1 `flag` 的真实语义 = 位域打包（重要纠正）

```t
flag Perm[u16] {
    readable:  1;      // 数字是「位宽」
    writable:  1;
    level:     4;
    owner_id:  8;
}
var p: Perm = 0;
flag_set(p, Perm.readable, 1);      // 内建访问
flag_get(p, Perm.readable)          // Perm.readable = 位偏移
```

实测（`flag Perm[u16] { readable: 1; level: 4; }` + `flag_set/flag_get`）→ **0 error，实跑输出 1** ✅

**不是**「每位一个命名标志」。`decl-data-design.md` §1.5 的描述与语法（`flag Perm : u8 { R; W; X }`）**均与实现不符**。

### 2.2 `@derive` 实为实装代码生成（原「从未生效」结论失真，2026-10-08 勘误）

⚠ **原 §2.2 结论错误**：`@derive` 并非「已解析但零行为的空注解 / 死代码」。`codegen_c.tc` 的 `process_derive(d)`（原 4018–4290 行）在 `emit_struct_decl` 处**真实触发**，为 8 个 trait（ToString/FromString/Clone/Copy/DebugPrint/BinarySerde/Eq/Hash）生成 C 后端代码。

原结论的依据（"两个 `.ll` md5 相同"）为何失真：被测样例（`game_ecs.tc:163` 注释自承 `.clone()` 尚未实现、使用值语义）**从不调用**任何派生方法，因此 struct 定义自身的 `.ll` 必然相同；但这不证明 derive 没生成代码——派生函数体确实被 emit 进了 `.c`。即「样例里 .ll 没差异」≠「derive 是空注解」。

**本任务处置**：删除 `process_derive` 代码生成（收敛 scope），但**保留 `@derive` 注解识别为 no-op**——`g_ad_name` 仍含 `"derive"`，`ann_validate` 仍经 `ann_check_items` 校验 trait 名（如 `@derive(Eq, Bogus)` 仍报 `T_DERIVE_UNSUPPORTED`）。这样 C 后端对存量 `@derive` 代码**零破坏、照常编译**，仅不再生成派生方法。

---

## 3. 对裁定的评估：两条支持、两条风险

### ✅ 支持一：废弃 `flag` / `flag_set` 的代价极小

存量仅 **1 处 + 0 处**。且 `flag_set` 从未被使用。

### ✅ 支持二：删除 `@derive` 代码生成的成本可控

`@derive` 本是实装代码生成（见 §2.2 勘误）。删除其代码生成、保留注解为 no-op 的成本可控：C 后端存量 `@derive` 代码照常编译（不再生成派生方法），双后端自举不动点与 conformance 均不退化。且**声明级注解有 `T-ANN-E450` 校验**（字段级见 §3 风险一，现已补齐），未知属性会直接报错，不会引入「拼错静默退化」。

### ✅ 风险一（已修复，2026-10-08）：字段级注解校验

原缺陷：`ann_pass` 仅校验声明级注解，字段级注解（`struct`/`union` 字段 `node_la`）被静默忽略，拼错即 0 error 退化。

**修复**：`ann_pass` 新增字段链遍历——对 `struct`/`union` 的每个字段取其 `node_la` 注解链，复用 `ann_validate(..., "field")` 校验；未知字段注解报 `T-ANN-E450`（与声明级一致）。回归防护 fixture：`tests/conformance/fail/f_field_ann_unknown.tc`（`struct Baz { a: i64 @totallybogus(1); }` → `T-ANN-E450`）。

⚠ 实现要点（曾踩坑）：`kids_chain_idx` 返回的是 kids 池 **entry 索引**，其 `.val` 才是节点 id；`node_la` 接收「节点 id」。若把 entry 索引直接传入 `node_la` 会误读 `g_node_la[entry]` 拿到无关链头，沿 `.next` 跨函数体误校验（曾触发 84× `T-ANN-E450`）。正确做法是先用 `base__kids[f].val` 取出字段节点 id，再传 `node_la`——与声明级循环（`base__kids[c].val`）完全一致。

### ⚠ 风险二：位宽语法与 struct 字段语法**直接冲突**

| 声明 | `readable: 1` 的含义 |
|---|---|
| `flag Perm[u16] { readable: 1; }` | `1` = **位宽** |
| `struct Perm { readable: 1; }` | `1` = **类型** |

实测 `struct Perm { readable: 1; level: 4; }`：`tc check` **0 error**，`tc run` → **`clang link failed`**。

⇒ 位域能力（flag 唯一真正的价值）**不能靠沿用 `名字: 数字` 搬到 struct**，必须另定位宽语法，例如：

```t
packed struct Perm {            // packed 为内置结构体修饰关键词（非保留关键字）
    readable: u16 @bits(1);     // 位宽字段语法待裁定（@bits / @packed(uN) 等）
    level:    u16 @bits(4);
}
```

⚠ 字段级注解现已校验（风险一已修复，未知注解报 `T-ANN-E450`），故未实现的 `@bits` 会直接报错；`@bits(1)` 是否真正受支持取决于位域设计是否落地——属于待裁定项，而非「静默 0 error」。

---

## 4. 设计要点（待补全）

| # | 议题 | 建议 |
|---|---|---|
| 1 | 旧属性清单 | 明确「区分 struct 类型」的属性全集：`@packed(N)`（位域）、`@bitpack(N)`（已存在，需参数）、`@soa`、… |
| 2 | TI 层类型身份 | **已决（2026-10-09）：深层** —— TI `kind` 统一为 `Struct`，不再保留 `Flag`/`FlagSet`；类型身份完全由属性承载。布局计算、位域发射、`flag_set` 动态位域表示**全需重写**（代价大但语义最干净）。 |
| 3 | 位宽字段语法 | 见 §3 风险二 |
| 4 | 属性互斥与组合 | `struct X @packed @soa {}` 冲突如何诊断？需显式规则 |
| 5 | `@derive` 代码生成删除（保留注解 no-op） | `codegen_c.tc` 原 `process_derive`（4018–4290 行，8 个 trait 生成，原为**实装代码**非死代码）已删除；`g_ad_name` 仍含 `"derive"`，trait 名校验（`T_DERIVE_UNSUPPORTED`）保留。⚠ `sema.tc` 的 `mark_call_callees`（原误列于此）**非死代码**——它是 P3b struct 关联函数脱糖的成员 callee 标记，必须保留，已从本清单移除 |
| 6 | 存量迁移 | `examples/bitflags.tc`（1 处 flag）+ 14 处 `@derive` 注解 |
| 7 | 文档作废 | `decl-data-design.md` §1.1 / §1.5 |

### 关于第 2 点（最重要的抉择）

属性化有两种落地深度，代价差一个量级：

- **浅层（推荐先做）**：语法层废弃 `flag` 关键字、改用 `struct X @packed`，但 **TI 层 `kind` 不变**（仍是 `Flag`）。⇒ 下游零改动，仅 parse + 注解识别。
- **深层**：TI 层也统一为 `Struct`，类型身份完全由属性承载。⇒ 语义最干净，但所有按 `tip_kind()=="Flag"` 派发处（sema 布局、双后端发射、位域访问内建）都要重写。

⚠ **2026-10-09 决策 = 深层**（见 §1 #2 / §5 #3）。不再「先浅后深」，直接按深层落地：`flag` 关键字废弃、`packed struct` 取而代之、TI `kind` 归 `Struct`。

---

## 5. 待裁定项

1. ✅ **位域能力保留**（2026-10-09）：`flag` 的位域打包价值由 `packed struct` 承载；位宽字段具体语法（`@bits(N)` / `@packed(uN)` 等）仍待裁定（见 §3 风险二）。
2. ✅ **`flag_set` / `flag_get` 动态位域能力保留**（2026-10-09）：零存量也不删，内建作用于 `packed struct` 底层整数值。
3. ✅ **TI 层深度统一**（2026-10-09）：`kind` 归 `Struct`，不再保留 `Flag`/`FlagSet`（见 §1 #2 / §4 第 2 点）。
4. ✅ **`@derive` 8 个 trait 能力保留**（2026-10-09）：以更干净形式重建，非彻底废弃（旧 `process_derive` 已删，注解暂 no-op）。
5. ✅ **先后次序（2026-10-09 裁定）：先收尾模块 path-access epic，再启动本积类型统一 epic。** path-access 主线（M1–M4 + M5 成员名校验）基本完成，收尾剩余项后切换主线。

---

## 附：复现命令

```bash
# flag 声明关键字 —— 2026-10-09 裁定废弃，改用 packed struct（见 §1 #1）
# 旧：flag Perm[u16] { readable: 1; level: 4; }
packed struct Perm {                 # packed = 内置结构体修饰关键词（非保留关键字）
    readable: u16 @bits(1);          # 位宽字段语法待裁定
    level:    u16 @bits(4);
}
fn main_fn() i32 @main { var p: Perm = 0; flag_set(p, Perm.readable, 1);
    println(i2s(flag_get(p, Perm.readable) as i64)); return 0; }   # → 1

# @derive 曾是实装代码生成（见 §2.2 勘误）；本任务删代码生成、保留注解为 no-op
@derive(Clone, Copy, ToString) struct Foo { a: i64; }   # 合法注解（no-op），trait 名校验仍生效

# 注解校验覆盖不全
struct Foo @flga { a: i64; }                            # → T-ANN-E450 ✅
struct Perm { readable: u16 @totallybogus(1); }         # → 0 error ❌

# 位宽语法冲突
struct Perm { readable: 1; level: 4; }                  # check 0 error，run → clang link failed
```
