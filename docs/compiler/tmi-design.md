# `.tmi` —— 模块接口制品规格（typed interface artifact, G-2）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §4.2b`）
> 关联：`docs/compiler/hir-design.md`（上游 HIR 缓存，pre-type）、`docs/compiler/mir-design.md`、`docs/compiler/driver-query-design.md`（缓存消费）、`docs/compiler/tir-design.md §4.2.1`（拆快照键）

## 1. 为什么需要 `.tmi`

增量编译有两个**独立的**粒度问题，必须用两种制品分别解决（`compiler-pipeline-design.md §4.2` 已点明）：

| 制品 | 内容 | 键 | 解决什么 |
|---|---|---|---|
| **HIR 缓存** | 本模块 HIR（未定型） | **源内容**哈希 | 本模块 Sema **重入**时跳过重 lower |
| **`.tmi`** | 本模块**导出接口**（typed） | **API 指纹** | 下游依赖**跳过 type-check 本模块** |

没有 `.tmi`，下游模块每次都得重新 type-check 其全部依赖 → 增量粒度卡在"接口没变也得重编"。`.tmi` 让"接口不变 ⇒ 零重编依赖"成立，**这是增量真正到文件级/声明级的前提**（G-2 P0）。

## 2. 内容

`.tmi` 是**类型化**的、只含"够下游消费本模块所需的最小信息"：

- **导出符号表**：每个 `pub fn`/`pub var`/`pub const` 的**完整类型签名**（含泛型形参、where 约束）；以及 same-package 内 `path` 可见的非 `pub` 符号（范围决策见 §3.1）。
- **泛型定义**：泛型 `fn`/`struct`/`enum` 的形参与约束，供下游实例化时引用（不内含实例，实例归 TIR 拆快照键，见 §5）。
- **comptime 常量值**：`pub const`/`comptime` 求出的字面量（下游直接用，不重算）。
- **类型别名 / 前向声明**：`type X = ...` 的解析结果。
- **API 指纹**：由上述全部内容归一化得到的稳定哈希（red-green 式，见 §3）。
- **依赖清单**：本模块依赖的 `.tmi` 指纹（构成下游失效传播链）。

> **不含**：函数体、包外完全不可见的纯私有符号、mir/TIR（这些是内部细节，下游不需）。包内 `path` 可见符号即使非 `pub` 也须纳入（§3.1）。

## 3. 失效键（API 指纹）—— 双键分层

> 本 § 区分两个正交的"键"：**逻辑失效键**（决定谁必须标红）与**实际缓存条目键**（决定缓存能否命中）。二者必须分别设计，漏一会击穿等价门禁（D8-4）。

### 3.1 逻辑失效键 = API 指纹

- 指纹 = `hash(导出符号签名 + 泛型定义 + comptime 常量值 + 依赖指纹)`。
- **范围决策 (A)（2026-09-22 裁定）**：指纹不仅含 `pub` 导出，还须含 **same-package 内 `path` 可见的非 `pub` 符号**。
  - 理由：模块系统重设计已定 "same-package 也需 path 访问"——同包跨文件可经 `path` 引用非 `pub` 符号；若该符号签名变化只改私有实现却不放进指纹，same-package 下游会保持绿、拿到错误类型 ⇒ **静默误编译**（D7-8 铁律）。
  - **指纹宁可包含多、不能漏**：漏一列隐式输入即陈旧构建。故 (A) 取"粗粒度安全"，而非 (B) 的"细粒度 + HIR 兜底"。
  - 仅"包外完全不可见"的纯私有符号不进指纹（同文件内引用由 HIR 缓存的源内容哈希兜底）。
- **red-green 语义**（对标 Rust `DefPathHash`）：
  - 改**实现**（函数体）⇒ 签名不变 ⇒ 指纹不变 ⇒ 下游**不重编**。
  - 改**签名**（增参/改返回/改泛型约束）⇒ 指纹变 ⇒ 仅直接依赖重编。
- 这样"改一行实现"不会污染下游，增量粒度真正到"声明级"。

### 3.2 实际缓存条目键（双键分层）

- 缓存条目键 = `tmi_of` + **API 指纹（§3.1）** + **编译器版本** + **目标三元组** + **flags** + **启用 pass 集**。
- 与 §3.1 正交：**API 指纹管"接口语义失效"，版本/目标/flags 管"制品可消费性"**。
- 依据 `driver-query-design.md §4` 缓存键闭合性：键必须覆盖一切影响产物的输入，任何漏列隐式输入都会击穿等价门禁（D8-4）。`.tmib` 版本戳见 §4。

### 3.3 与等价门禁的咬合

- 缓存命中的**唯一前提** = "命中即等价于 clean"（见 `compiler-pipeline-design.md §5.3` clean≡incremental 等价门禁）。
- 因此 §3.1/§3.2 的键必须**闭合**：增/删任一隐式输入（如新增 comptime 求值 pass、改泛型单态化策略）都须反映进键，否则旧缓存被错误命中 ⇒ 陈旧构建。
- 门禁：对同源跑「全量 clean」与「先 full 再改一行增量」，比对 `.tmi` 指纹 + 下游对象 md5 **逐字节相同**；不一致即阻断（联动 `driver-query-design.md §9`）。

### 3.4 最小实现骨架（`tmi_of` query + 指纹）

> 落地见 A 阶段三件套（与模块系统重设计同轮）。此处只给接口骨架，不触碰 `src/`。

```
// 伪代码：query 纯函数，结果按 §3.2 键缓存
fn tmi_of(file: FileId) -> Tmi {
    let hir = hir_of(file);            // pre-type，HIR 缓存（键=源内容）
    let sema = sema_of(file);          // 类型化
    let exports = collect_exports(sema, scope=Pub | PackagePathVisible); // 决策 (A)
    let fp = fingerprint(exports + generics(sema) + comptime_vals(sema) + dep_fps(file));
    Tmi { symbols: exports, generics, comptime_vals, aliases, fp, deps: dep_fps(file) }
}
// 失效传播：dep_fps 把下游串成红绿 DAG；任依赖 fp 变 ⇒ 下游 tmi_of 重算
```

- `collect_exports` 的 `scope` 参数即决策 (A) 的落点：把 `Pub | PackagePathVisible` 一并收集，而非仅 `Pub`。
- 指纹须**规范化排序**（导出符号按名、泛型按形参序）以保 bit-identical 与可重算（见 `driver-query-design.md §3` 纯函数约束）。

## 4. 格式（双格式，与 TIR 同策略）

- **文本 `.tmi`**：人类可读、可 diff，是**规范真相源**；md5 快照只对文本算。
- **二进制 `.tmib`**：编译器内部高速读取（增量缓存/远程缓存）；固定小端 + 版本头，版本不匹配即失效重建（不做向后兼容解析）。
- **round-trip 门禁 `tirt`（沿用 `tir-design.md §12.1b`）**：断言 `text → .tmib → text'` 逐字节相同。
> **格式版本与兼容（D8-5 相邻，防格式漂移击穿增量）**：`.tmib` 已有「版本不匹配即失效重建」策略（不留向后兼容解析分支，避免多版本解析 bug）；但**文本 `.tmi` 作为规范真相源也须带版本/格式戳**（如首行 `tmi 1` + 编译器大版本），下游按版本决定能否消费，避免旧编译器误读新格式签名导致静默错误。API 指纹稳定性（§3）管"接口语义"，格式版本管"制品可读性"——二者正交，都须显式。


## 5. 与拆快照键（§4.2.1）的关系

- `.tmi` 描述**接口**；TIR 拆快照键（`foo.tir` 函数区 + `foo.tir.inst` 实例区）描述**实现产物**。
- 二者独立：改 `b.tc` 引入 `a` 的泛型新实例 ⇒ `a.tir.inst` 变（真实信号），但 `a.tmi` **不变**（接口未变）⇒ 下游不重编 `a` 的接口消费，只重编受新实例影响的代码。
- 这正是"接口/实现分离"带来的精确失效。

## 6. 消费方流程（下游依赖）

```
parse 下游模块
  → 读其 import 列表
  → 对每个依赖：若本地 .tmi 缓存命中且指纹匹配依赖清单 ⇒ 直接载入类型签名
  → 否则：重编依赖、取其 .tmi
  → 下游 type-check 仅需"本模块 + 依赖签名"，跳过依赖的函数体解析
```

## 7. 跨语言对位（`ir-taxonomy.md §3`）

| 语言 | 对应制品 | 备注 |
|---|---|---|
| Rust | **`rmeta`** | crate metadata，下游零重 type-check |
| C++20 | **`.ifc`** | 模块接口单元（Modules TS） |
| Swift | **`.swiftmodule`** | 类型化模块接口 |
| Zig | （无显式制品，缓存即 ZIR + 类型信息） | 靠 `zig-cache` 内容寻址 |
| T | **`.tmi`** | 本层；pre-type 的 HIR 缓存另列 |

## 8. 落地（对应 `compiler-pipeline-design.md §9` A 阶段三件套）

- **A 阶段三件套** = `AstGen(HIR)` + `Driver/Query 层` + **`.tmi` 产出**。三者同期设计：HIR 落地即顺手产出 `.tmi`，Driver/Query 负责缓存与失效传播。
- 先实现文本 `.tmi` + 指纹；二进制 `.tmib` 与 round-trip 门禁随缓存层落地。
- 门禁：改实现不改签名 ⇒ 下游 `.tmi` 指纹不变（验证增量粒度）。
