# 积类型统一到 struct（设计裁定 + 现状实测）

> 状态：**设计裁定 v1**（2026-10-07）｜方法：全部结论经 `out/dbg/tc.exe` 实测
> 关联：`docs/syntax/type-namespace-review.md`（类型级命名空间审查）、`docs/compiler/decl-data-design.md`（被本裁定推翻的旧规格）

---

## 1. 裁定内容（用户 2026-10-07）

1. **积类型统一到 `struct`**：`flag` / `flag_set` 关键字**废弃**，改由**修饰关键词**区分不同类型的 struct。
2. **`@derive(Clone, Copy, ...)`（Rust 风格派生）废弃**。

⚠ 本裁定**推翻 `decl-data-design.md` §1.1（`@derive`）与 §1.5（`flag` / `flag_set`）**——那份文档把三者均列为受支持特性。该文档对应章节需作废或改写。

---

## 2. 现状实测（裁定前的事实基线）

| 项 | 实测结果 | 存量 |
|---|---|---|
| `flag` | ✅ **已实装且可用**（位域打包） | **1 处**（`examples/bitflags.tc`） |
| `flag_set` | 语法存在（`flag_set X[u8] {...}`） | **0 处** |
| `@derive` | ⚠ **从未真正生效** | 14 处注解 + 死代码 |
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

### 2.2 `@derive` 从未生效

决定性对比：`@derive(Clone, Copy, ToString) struct Foo { a: i64; }` 与不带 `@derive` 的同一 struct——

| 检查项 | 结果 |
|---|---|
| LLVM `.ll` md5 | **完全相同**（`ba58b2f8…`） |
| C `.c` 中 `to_string` 符号 | 两者**都没有** |
| `f.to_string()` 调用 | 两者都 0 error，实跑**无输出** |

⇒ `@derive` 是**已解析但零行为**的空注解。注：`codegen_c.tc:4100–4253` 存有 8 个 trait（ToString/FromString/Clone/Copy/DebugPrint/BinarySerde/Eq/Hash）的生成代码，但**未被触发**（或触发条件未满足），属**死代码**。

---

## 3. 对裁定的评估：两条支持、两条风险

### ✅ 支持一：废弃 `flag` / `flag_set` 的代价极小

存量仅 **1 处 + 0 处**。且 `flag_set` 从未被使用。

### ✅ 支持二：废弃 `@derive` 的成本近乎为零

它本来就没生效。且**声明级注解有 `T-ANN-E450` 校验**，说明「用属性区分 struct 类型」这条路**不会**引入「拼错静默退化」的风险——未知属性会直接报错。这打消了我最初对该方案最大的顾虑。

### ⚠ 风险一：字段级注解**不校验**（关键）

| 位置 | 未知注解 | 结果 |
|---|---|---|
| 声明级 `struct Foo @flga` | `@flga` | ✅ `T-ANN-E450` |
| 字段级 `readable: u16 @totallybogus(1)` | `@totallybogus` | ❌ **0 error** |

**新设计必须要求**：承载类型身份的属性**只允许出现在声明级**（那里有 E450 校验）；若允许字段级，须先补齐字段级注解校验。否则拼错即静默退化——与 enum 成员名不校验是同一类缺陷。

### ⚠ 风险二：位宽语法与 struct 字段语法**直接冲突**

| 声明 | `readable: 1` 的含义 |
|---|---|
| `flag Perm[u16] { readable: 1; }` | `1` = **位宽** |
| `struct Perm { readable: 1; }` | `1` = **类型** |

实测 `struct Perm { readable: 1; level: 4; }`：`tc check` **0 error**，`tc run` → **`clang link failed`**。

⇒ 位域能力（flag 唯一真正的价值）**不能靠沿用 `名字: 数字` 搬到 struct**，必须另定位宽语法，例如：

```t
struct Perm @packed(u16) {
    readable: u16 @bits(1);
    level:    u16 @bits(4);
}
```

⚠ 且因字段级注解不校验，`@bits(1)` 是否真受支持**尚不能确认**（实测 0 error，但 0 error 在此不构成证据）。

---

## 4. 设计要点（待补全）

| # | 议题 | 建议 |
|---|---|---|
| 1 | 旧属性清单 | 明确「区分 struct 类型」的属性全集：`@packed(N)`（位域）、`@bitpack(N)`（已存在，需参数）、`@soa`、… |
| 2 | TI 层类型身份 | **关键抉择**：属性化后 TI 的 `kind` 是否仍保留 `Flag`/`FlagSet`？若保留 ⇒ 只是语法糖，改动小；若统一为 `Struct` + 属性 ⇒ 布局计算、位域发射、`flag_set` 动态位域表示**全要改** |
| 3 | 位宽字段语法 | 见 §3 风险二 |
| 4 | 属性互斥与组合 | `struct X @packed @soa {}` 冲突如何诊断？需显式规则 |
| 5 | 死代码清理 | `codegen_c.tc:4100–4253`（8 个 `@derive` trait 生成）、`sema.tc:13691`（`p.clone()` callee member 标记）、`sema.tc:7692`、`parse.tc` 相关分支 |
| 6 | 存量迁移 | `examples/bitflags.tc`（1 处 flag）+ 14 处 `@derive` 注解 |
| 7 | 文档作废 | `decl-data-design.md` §1.1 / §1.5 |

### 关于第 2 点（最重要的抉择）

属性化有两种落地深度，代价差一个量级：

- **浅层（推荐先做）**：语法层废弃 `flag` 关键字、改用 `struct X @packed`，但 **TI 层 `kind` 不变**（仍是 `Flag`）。⇒ 下游零改动，仅 parse + 注解识别。
- **深层**：TI 层也统一为 `Struct`，类型身份完全由属性承载。⇒ 语义最干净，但所有按 `tip_kind()=="Flag"` 派发处（sema 布局、双后端发射、位域访问内建）都要重写。

建议先浅后深，与模块 path-access 的「方案 A → C 两段式」同构。

---

## 5. 待裁定项

1. **位域（flag 的能力）是否保留**？若保留，位宽字段语法定为哪种？
2. **`flag_set` 的动态位域能力**是否保留（零存量，可直接删）？
3. **TI 层是否同步统一**（浅层 vs 深层，§4 第 2 点）？
4. **`@derive` 的 8 个 trait 能力是否以别的形式重建**（Clone/Copy/Eq/Hash/ToString…）？还是彻底不要、改由用户手写方法？
5. 本 epic 与模块 path-access epic 的**先后次序**？

---

## 附：复现命令

```bash
# flag 真实用法（可用）
flag Perm[u16] { readable: 1; level: 4; }
fn main_fn() i32 @main { var p: Perm = 0; flag_set(p, Perm.readable, 1);
    println(i2s(flag_get(p, Perm.readable) as i64)); return 0; }   # → 1

# @derive 无效果（两个 .ll md5 相同）
@derive(Clone, Copy, ToString) struct Foo { a: i64; }   # vs 不带 → md5 相同

# 注解校验覆盖不全
struct Foo @flga { a: i64; }                            # → T-ANN-E450 ✅
struct Perm { readable: u16 @totallybogus(1); }         # → 0 error ❌

# 位宽语法冲突
struct Perm { readable: 1; level: 4; }                  # check 0 error，run → clang link failed
```
