# 积类型统一（product-type-unification）实施路线图

> 配套设计：`docs/syntax/product-type-unification-design.md`（§5 裁定 v2，2026-10-09）。
> 状态：**设计裁定完成**；模块 path-access epic 已收尾（M1–M5 全推 main，HEAD=03fce35），本 epic 现已可启动。
> 本文只回答：按什么顺序做、每步交付什么、怎么验收。

## 0. 终态对照

| 项 | 现状 | 终态 |
|---|---|---|
| `flag` 关键字 | 保留可用（1 处 `examples/bitflags.tc`） | **废弃**（语法层不再识别；过渡期可发 deprecated 诊断，P7 迁移后彻底移除） |
| 位域表达 | `flag X[uN] { f: 位宽; }` | `packed struct X { f: uN; }`（字段类型 `uN` 的数字后缀即位宽） |
| `packed` | 无 | **内置结构体修饰关键词**（仅在 struct 声明位置被识别，**非全局保留关键字**） |
| 积类型 AST / TI `kind` | `Struct` / `Flag` / `FlagSet` 并存 | **单一 `Struct`**（AST 与 TI 同源） |
| `flag_set` / `flag_get` | 作用于 `flag` 底层整数 | **保留**，作用于 `packed struct` 底层整数值 |
| `@derive` 8 trait | 注解 no-op（代码生成已删） | **以更干净形式重建**（Clone/Copy/Eq/Hash/ToString/FromString/DebugPrint/BinarySerde） |

**排序原则**（同 path-access）：① 先补正确性护栏，后动架构；② 零 IR 漂移步骤全部前置于唯一漂移步骤；③ 每步可独立验证、可独立回滚。

---

## 1. 阶段总览（按优先级从高到低）

| # | 阶段 | 目标 | IR 漂移 | 依赖 | 风险 |
|---|---|---|---|---|---|
| P1 | **语法层**：去 `flag` 关键字 + 识别 `packed` 修饰 | parser 不再吃 `flag` 声明；`struct` 前可加 `packed` 修饰；`flag` 关键字发 deprecated 诊断（保留过渡期） | **0** | — | 中 |
| P2 | **位域字段语法落地**（字段类型 `u1`~`u65535`） | `packed struct` 字段类型为 `uN`（N=位宽，1..65535）即位域；sema 校验 N 合法、字段按 `uN` 宽度打包 | **0** | P1 | 低 |
| P3 | **TI 深度统一**：`Flag`/`FlagSet` → `Struct` | `tip_kind()` 不再有 `Flag`/`FlagSet`；类型身份完全由属性承载 | ⚠ 见下（实测 **非全量**） | P1/P2 | **高** |
| P4 | **Sema 位域布局** | `packed struct` 字段按 `@bits` 打包；`offset`/掩码计算 | 0 | P3 | 中 |
| P5 | **双后端发射** | C + LLVM 发 packed 布局；`flag_set`/`flag_get` 内建改写 | ⚠（随 P3） | P4 | 高 |
| P6 | **`@derive` 8 trait 重建** | 干净实现 8 个 trait（旧 `process_derive` 已删，注解暂 no-op） | ⚠ | P3 | 高 |
| P7 | **存量迁移** | `examples/bitflags.tc` → `packed struct`；14 处 `@derive` 注解随 P6 能力重建 | 0 | P5/P6 | 低 |

> ⚠ 原判「P3 是唯一产生**全量** IR 漂移的阶段」——**经实测证伪（2026-10-09）**。
> 实际结果：IR 快照仅 `src/tc.tc` 自身 3 个 entry（c/h/ll）漂移，**0 NEW / 0 GONE**，
> 348 个用户 entry **逐字节不变**。原因：TI kind 只是 sema 内部的派发标签，
> 只要「按属性判别」与「按 kind 判别」在每处派发点上等价，后端发射就完全不变。
> ⇒ **IR 快照的等价性判据在 P3 之后依然有效**，后续阶段仍可用 diff 证明「只改了该改的」。
> （这与 P2 的「需扩展类型解析」同属路线图的高估预判，均以实测为准。）

---

## 2. 阶段细化（待 Phase 1 启动时补充 file/line  specifics）

### P1 语法层
- **交付物**：
  - `parse.tc`：`flag` 关键字从声明解析中移除（或改发 `T-SYN-W???` deprecated 诊断，过渡期不硬拒）；新增「`packed` 作为 struct 修饰关键词」识别（仅出现在 `struct` 前，进入修饰属性集合，不当作标识符/类型名）。
  - `sema.tc`：把 `packed` 修饰登记为 struct 的属性（区别于普通字段/注解）。
- **不破坏自举**：编译器 `src/*.tc` 自身不使用 `flag`，故去 `flag` 关键字不影响自举链路。
- **验收**：① `tc check src/tc.tc` → 0 errors；② `packed struct X {...}` 被识别、`flag X[uN]{...}` 报 deprecated（或 error）；③ conformance 全绿；④ gate L2 25/0（零漂移，无需重录）。

### P2 位域字段语法（字段类型 `u1`~`u65535`）
- **裁定（2026-10-09）**：位宽不靠注解，而由字段的整型类型直接编码——`packed struct` 的字段类型为 `uN`（N=1..65535）即表示该字段占 N 位。例：`readable: u1` = 1 位，`level: u4` = 4 位。
- **交付物**：`u1`~`u65535` 作为合法字段类型被接受（前置：类型系统须识别任意宽度 uint 的 `uN` 后缀并取其数字为宽度；若当前仅 `u8/u16/u32/u64`，需扩展类型解析）；`packed struct` 非 `uN` 字段按普通宽度布局；非 packed struct 上 `uN` 窄于宿主宽度仍合法（普通窄整型，不强约束）。
- **前置依赖**：确认/扩展类型系统对 `u1`~`u65535` 的识别（P1 研究阶段一并查清）。
- **✅ 前置调研结论（2026-10-09）**：无需扩展类型解析——**AWI 任意位宽整数设施已存在**（`base.awi_bits` / `codegen_c` 的 `_BitInt(N)` / LLVM `iN`），`u2`~`u65535` 早已合法。唯一缺口是下限 `awi_min_bits() = 2` 把 `u1` 挡在门外。故 P2 = 把下限按符号性分派（`u` → 1，`i` → 2）：
  - `u1` 放开：`unsigned _BitInt(1)` 在 C23 合法（实测 clang 接受），是位域基本单元。
  - `i1` 保持拒绝：C23 signed `_BitInt` 需 ≥ 2 位，clang 实测报 `signed _BitInt must have a bit size of at least 2`；LLVM `i1` 虽合法，但双后端对拍要求合法类型两边都发得出去。
  - 连带：`tests/conformance/fail/f89_lex_bad_num_suffix.tc` 原以 `1u1` 为非法样例，改为 `1i1`（仍非法）；新增 `f_awi_zero_bits.tc` 覆盖 `u0` / `u65536` 越界。
  - 真正的按位打包（`packed` 语义落地）在 **P4**，P2 只保证 `uN` 字段类型被接受。

### P3 TI 深度统一 — ✅ 已完成并推 main（2026-10-09）
- **交付物**：消除 `Flag`/`FlagSet` TI kind；位域在 TI 层即 `Struct` + 属性（含底层整型）。所有按 `tip_kind()=="Flag"` 派发处改为按 `Struct`+属性派发。
- **✅ 实施要点（2026-10-09）**：
  - **身份属性 = `und`（底层整型名）**：新增 `tip_is_flag(ti)` = `kind=="Struct" && und != ""`。选 `und` 而非新增字段的理由：它本就是给 Enum/Flag 存底层整型的字段、**此前只写不读**（死数据），复用零成本且不牵动 `ti_mk` 与所有 TI 构造点；且 `ti_with_und("Struct",…)` 只产生于 flag 声明/类型位两处，不会与普通 struct 混淆。判别式必须连带 `kind=="Struct"`（Enum 也有 `und`，但语义是枚举常量不是位槽）。
  - **改动面只有 `src/sema.tc`**：TI kind `Flag`/`FlagSet` 的消费点全在 sema（后端一律按 **AST node kind** `FlagDecl`/`FlagSetDecl` 派发，无需改）。4 处构造点（`resolve_ti` 的 flag/flag_set 类型位、`register_decl` 的 FlagDecl/FlagSetDecl）+ 5 处派发点（`is_user_named_kind`、成员访问、`int_to_fe` ×2、f-string `!j`、前导点 `.field`）。
  - ⚠⭐ **成员访问必须把位域分支前移到通用 struct 字段分支之前**：统一后 `obk=="Struct"` 会命中位域，若让它走进「按字段名查 StructDecl 字段表」的路径，查不到就报 E208。原顺序靠 kind 不同天然隔开，统一后须显式隔开。
  - ⚠ **保守守卫**：f-string `!j`（按字段展开成 JSON 对象）与前导点 `.field`（隐式 self 字段）两处须加 `tip_is_flag(...)==false` 排除，否则位域会进入 P3 前本不会进入的分支。
  - `member_exists_in_type` 按 **AST node kind** 派发，P3 无需改。
- **验证**：自举不动点 `g2.ll==g3.ll==g4.ll`（md5 `9b200480…`）；**IR 基线仅 `src/tc.tc` 3 entry（c/h/ll）漂移、0 NEW/0 GONE，348 用户 entry 逐字节不变**；conformance 344/0（含 `p04_flag_slots` 位域全语义、`f_flag_member_unknown` 仍报 E216）；`examples/bitflags.tc` LLVM 运行正确输出 `bitflags OK`；gate L2 25/0。

### P4 / P5 / P6 / P7
- 顺序执行，每步 gate L2 + 不动点 + conformance 全绿；P6 重建 `@derive` 8 trait 时复用 `ann_validate` 的 trait 名校验（`T_DERIVE_UNSUPPORTED`）确保不退化。

---

## 3. 验收红线（每步）
- `g1 check src/tc.tc` → **0 errors**（warnings 基线随批次浮动）。
- conformance 全绿（当前 340/0 基线 + 新增负向/正向夹具）。
- 自举不动点 `g2.ll == g3.ll == g4.ll`（md5 同）。
- gate L2 **25/0**；必要时 `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录（仅编译器自身 6 entry 合法漂移）。
- C 后端：`examples/bitflags.tc`（迁后）编译运行 **0 error**。
- 提交 + FF 推 main；排除 `.workbuddy/` 与 `out/_*` 临时产物。
