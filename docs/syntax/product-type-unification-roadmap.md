# 积类型统一（product-type-unification）实施路线图

> 配套设计：`docs/syntax/product-type-unification-design.md`（§5 裁定 v2，2026-10-09）。
> 状态：**设计裁定完成**；模块 path-access epic 已收尾（M1–M5 全推 main，HEAD=03fce35），本 epic 现已可启动。
> 本文只回答：按什么顺序做、每步交付什么、怎么验收。

## 0. 终态对照

| 项 | 现状 | 终态 |
|---|---|---|
| `flag` 关键字 | 保留可用（1 处 `examples/bitflags.tc`） | **废弃**（语法层不再识别；过渡期可发 deprecated 诊断，P7 迁移后彻底移除） |
| 位域表达 | `flag X[uN] { f: 位宽; }` | `packed struct X { f: uN @bits(位宽); }` |
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
| P2 | **位域字段语法落地** `@bits(N)` | sema 校验 `@bits` 参数（位宽 ≤ 宿主整数位宽、非负）；与 `@packed` 协同 | **0** | P1 | 低 |
| P3 | **TI 深度统一**：`Flag`/`FlagSet` → `Struct` | `tip_kind()` 不再有 `Flag`/`FlagSet`；类型身份完全由属性承载 | ⚠ **全量** | P1/P2 | **高** |
| P4 | **Sema 位域布局** | `packed struct` 字段按 `@bits` 打包；`offset`/掩码计算 | 0 | P3 | 中 |
| P5 | **双后端发射** | C + LLVM 发 packed 布局；`flag_set`/`flag_get` 内建改写 | ⚠（随 P3） | P4 | 高 |
| P6 | **`@derive` 8 trait 重建** | 干净实现 8 个 trait（旧 `process_derive` 已删，注解暂 no-op） | ⚠ | P3 | 高 |
| P7 | **存量迁移** | `examples/bitflags.tc` → `packed struct`；14 处 `@derive` 注解随 P6 能力重建 | 0 | P5/P6 | 低 |

> ⚠ **P3 是唯一产生 IR 漂移的阶段**，必须放在所有零漂移步骤（P1/P2/P4/P7）之后——
> 一旦漂移发生，IR 快照基线（`tests/ir_baseline.json`，354 entry）失去等价性判据，此后再改无法用 diff 证明「只改了该改的」。

---

## 2. 阶段细化（待 Phase 1 启动时补充 file/line  specifics）

### P1 语法层
- **交付物**：
  - `parse.tc`：`flag` 关键字从声明解析中移除（或改发 `T-SYN-W???` deprecated 诊断，过渡期不硬拒）；新增「`packed` 作为 struct 修饰关键词」识别（仅出现在 `struct` 前，进入修饰属性集合，不当作标识符/类型名）。
  - `sema.tc`：把 `packed` 修饰登记为 struct 的属性（区别于普通字段/注解）。
- **不破坏自举**：编译器 `src/*.tc` 自身不使用 `flag`，故去 `flag` 关键字不影响自举链路。
- **验收**：① `tc check src/tc.tc` → 0 errors；② `packed struct X {...}` 被识别、`flag X[uN]{...}` 报 deprecated（或 error）；③ conformance 全绿；④ gate L2 25/0（零漂移，无需重录）。

### P2 位域字段语法
- **待裁定细节**：位宽字段标注用 `@bits(N)`（默认，沿用设计文档示例）或 `@packed(uN)`；本路线图默认 `@bits(N)`。
- **交付物**：`@bits` 进入注解注册表（`g_ad_name` 增补），`ann_validate` 校验参数（正整数、≤ 宿主宽度）；与 `packed` 协同（非 packed struct 上用 `@bits` 报错）。

### P3 TI 深度统一
- **交付物**：消除 `Flag`/`FlagSet` TI kind；`packed struct` 在 TI 层即 `Struct` + 属性（含位域布局描述）。所有按 `tip_kind()=="Flag"` 派发处（sema 布局、双后端发射、`flag_set`/`flag_get` 内建）改为按 `Struct`+属性派发。
- **验证**：自举不动点 `g2.ll==g3.ll==g4.ll`；IR 基线仅 `src/tc.tc`/`src/tote.tc` 6 entry 漂移（合法），348 用户 entry 不变。

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
