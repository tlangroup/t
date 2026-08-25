# Notebook 编译环境设计（草案）

> 范围：本文定义「如何让 t 语言支持类似 Observable 的 notebook」的**底层路线与待扫清的障碍**。
> 核心立场：**编译器（tc）对 notebook 完全无感知**；notebook 是构建在 tc 之上的「编译环境编排层」。
> 关联：`docs/repl.md`（REPL 红线）、`docs/design.md`（能力提案流程）、`docs/laws/*`（上位法）。

---

## 0. 路线裁定（摘要）

一句话：**Notebook = 一个 `.tc` 文件 = 一个 Module，可 `import` 其他 Notebook 或系统级 module；单元格是文件内的 `cell` 代码块（`region` 关键字保留给未来类 Cone 的内存区域/所有权语义，notebook 不抢占）。放宽「tc 完全无感知」红线——允许引入轻量 `cell` 关键字（作用域块）+ 编译器按单元格做二进制缓存与增量更新（复用既有 `.tlib`/链接粒度，下放至 cell）。所有 cell 链入同一二进制/同一 wasm 实例（共享地址空间，且不隔离、整本统一处理），跨 cell 值无需序列化；原生子进程执行优先，WASM 阶段 2 双路线（前期：IR → 轻量 WASM CodeGen（无 LLVM）→ wasm；后期：IR → LLVM-IR → opt/llc → wasm）。跨 cell 可见性「自上而下」（见 §13.8 已锁定决策）。**

| 维度 | 裁定 | 理由 |
|------|------|------|
| 编译器角色 | 放宽：允许轻量 `cell` 关键字 + 按 cell 二进制缓存 | 用户裁定放宽；语义核心（typeck/IR/ABI）不动，仅加作用域块 + 缓存子系统（增量编译粒度下放至 cell） |
| 执行目标 | 原生子进程优先（阶段 1）；WASM 阶段 2 双路线 | 前期：轻量 WASM CodeGen（不依赖 LLVM 工具链/库）直出 wasm，属通用后端能力；后期：复用既有 LLVM-IR + opt/llc → wasm。两条路线 notebook 可选 |
| 编译单元 | Notebook = 一个 `.tc`（= 一个 Module），含 `cell` 块，不隔离、整本统一处理 | 放宽红线：引入轻量 `cell` 关键字（作用域块）；编译器按 cell 做二进制缓存/增量（`.tlib`/链接粒度下放至 cell）；可 `import` 其他 Notebook/系统 module |
| 跨 cell 传值 | 共享地址空间（同二进制/同 wasm 实例），无需序列化 | 所有 cell 链入单一二进制，跨 cell 按符号直读；`fid <>` 仅作可选落盘/跨进程兜底 |
| 增量 | 内容哈希缓存 + 依赖 DAG 失效 | 把 59s 级 gate 成本摊薄到单 cell |
| 响应式 | 宿主侧职责（静态依赖分析 + 重跑策略） | 不属于编译器职责，且 t 已有符号信息可复用 |
| 输出渲染 | 宿主侧职责（值→可视化） | t 无 DOM；渲染解耦于语言 |

---

## 1. 目标与非目标

**目标（对齐 Observable 的核心体验）**
- Reactive cells：单元格按书写顺序求值，可引用更早单元格的结果。
- 状态持久：跨单元格的值在会话内持续可用（不是 REPL 那种"每条输入全新进程丢状态"）。
- 重跑依赖：改一个单元格，其下游被标记为需重算并自动重跑。
- 内联渲染：每个单元格的"最后一个值"或显式 `display(...)` 输出就地呈现。

**非目标（红线）**
- 不引入任何 notebook 专属语义；不要求编译器理解 notebook/reactivity 概念。`cell` 是 notebook 复用的轻量作用域块关键字（经 `docs/design.md` 提案引入，作为通用语言构造，非 notebook 独占）；未来类 Cone 的 `region` 关键字（内存区域/所有权语义）保留给语言自身，notebook 不抢占。`to_value` 等通用能力按提案引入，非 notebook 专属（见 §13.8）。
- 不要求编译器理解"notebook""cell""reactivity"等概念。
- 浏览器 UI、富文本编辑器、单元格拖拽等**宿主侧**工作不在本文范围（本文只定义编译环境层）。

---

## 2. 关键事实（来自编译器调研，作为路线依据）

1. **REPL 模型不可直接复用，但证明了编排可靠**（`lib/repl.tc`）。
   REPL 是"整会话重编 `decls+输入` + 文本 `ans`"模型（`g_repl_decls` 只累计声明源码，运行期可变值不跨进程保留；跨进程值唯一通道是字符串 `var ans: string = "<escaped>"`）。→ notebook 不能套用它，但它证明"每次输入一次干净 `build`/`run` 子进程"是稳定可靠的编排范式。

2. **增量可链接产物已就绪**（调研确认，已代码核验）。
   - `tc emit-ll <cell>.tc --output <art>/<cell>`：不要求 `@main`，直接产出 `<out>.ll`（`src/tc.tc:345,357`）。
   - `tc build --lib <cell>.tc --output <art>/<cell>`：置 `g_lib_emit=true`，跳过进程级全局与 `@main`（`src/tc.tc:310`），经 `build_tlib` 打成 `.tlib`（重命名的 `.a`）+ `<out>.exports.json` 接口块（`src/codegen_ll.tc:4010`）。
   → 每个 cell 都可成为下游的链接输入，**无需改编译器**即实现 cell 间链接。

3. **import 机制可直接复用**（`src/sema.tc:6032,6052,6170`）。
   上游 cell 编译为 `out/lib/<cellN>.tlib`，下游写 `import(cellN :: *);`，宿主传 `--lib-dir out/lib`。与 std 库预编译（`tools/build_std.mjs`）**同构**，是最稳的复用点。

4. **诊断可定位到 cell 内行列**（`src/base.tc:6140` `print_json`）。
   每条诊断含 `file/sl/sc/el/ec`。只要**每个 cell 编译为独立 `.tc` 文件**（`file` 即 cell 标识），`line/col` 天然是 cell 内相对位置。注：`docs/diagnostics.md` 规范的码点 `offset/end_offset` 尚未在 `print_json` 实现中落地——字节级高亮是可选补丁（见 §10）。

5. **跨进程/跨 cell 值桥是最大短板**（维度 4 调研）。
   语言层**没有**"任意值→JSON/字节"的通用内建；只有 `format("{}", 标量)`（聚合类型不可直接打印）与 `fid < v`（二进制落文件，需 `@derive(BinarySerde)`）。→ 这是 notebook 必须扫清的头号障碍。

6. **WASM 两条可选产出路线**（用户裁定）。
   - **前期路线**：t 的 IR → **轻量 WASM CodeGen（不依赖 LLVM 工具链/库）** → 直接 emit `wasm` 二进制。需新增一个轻量 wasm 发射后端（**属通用后端能力，非 notebook 专属**，按 `docs/design.md` 提案引入）。
   - **后期路线（可选）**：IR → 既有 LLVM-IR（`.ll`）→ LLVM `opt`/`llc` → `wasm` 二进制。复用现有 `emit-ll` 与 `clang`/`opt`/`llc` 工具链；宿主传 `--clang`/`--runtime` 覆盖 `src/tc.tc:290` 写死路径；runtime 去 Windows 专属头（`io.h`/`fcntl.h`）即可 WASI 化。
   - 两条路线 notebook 择一使用；均不改前端与语法。

7. **程序化调用范式已验证**（从 `tools/*.mjs` 抄命令）。
   `tc check <cell>.tc --json`（诊断）、`tc emit-ll`（IR）、`tc build --lib`（库）、`tc build <entry>.tc --output <exe>`（链接运行）。产物路径与诊断均从子进程 stdout/退出码直接取得。

---

## 3. 架构

```
┌──────────────────────────────────────────────────────────────┐
│  Notebook Host（UI：cells / reactivity / inline render）        │  ← 不在本文范围
└───────────────────────────────┬──────────────────────────────┘
                                │  Notebook Driver API（本文交付物的接口面）
┌───────────────────────────────┴──────────────────────────────┐
│  Notebook Compiler Environment（编排层，本次要定义的对象）         │
│   · 维护单一 notebook `.tc`（含 `cell` 块）；在 cell 边界切分       │
│   · 复用 emit-ll / build --lib 做每 cell 二进制缓存，链成单二进制  │
│   · 内容哈希缓存 / 依赖 DAG / 失效传播（自上而下）                 │
│   · 链接 + 运行子进程，捕获 stdout（共享地址空间免序列化）          │
│   · 诊断：cell id ↔ 行列映射                                      │
└───────────────────────────────┬──────────────────────────────┘
                                │ 仅调用既有 tc 子命令
┌───────────────────────────────┴──────────────────────────────┐
│  t compiler (tc) — 不改，对 notebook 无感知                      │
│   lex / parse / sema / codegen_c / codegen_ll / test / repl     │
└───────────────────────────────┬──────────────────────────────┘
                                │
                    C backend 或 LLVM backend
                                │
                  原生 exe（阶段1）  /  wasm（阶段2：轻量WASM CodeGen 直出 或 LLVM-IR→opt/llc）
```

**Notebook Compiler Environment 的职责与接口（草案）**
- `compileCell(id, text) -> {artifacts, deps, diag}`：把单元格编译为 `.tlib`/`.ll`/runner，返回诊断。
- `linkAndRun(entryCells) -> {stdout, valueStore, diag}`：链接受影响的 cell 成 runner 并执行。
- `invalidate(id)`：沿依赖 DAG 失效下游 cell 的缓存。
- `valueStore`：cell 输出值的持久仓库（文件协议，见 §5）。

**产物目录约定**
```
out/notebook/<nb>/
  notebook.tc             # 整本源码（单一 Module，含 cell 块；host 维护）
  cells/<id>.ll            # emit-ll 产物（表达式 cell，按内容哈希缓存）
  lib/<id>.tlib            # build --lib 产物（声明 cell，供下游 import）
  lib/<id>.exports.json    # 接口块
  values/<id>.bin          # cell 输出值的二进制（fid <> 落盘 / 跨进程兜底）
  runner.exe               # 链接后的执行入口（含 @main）
  <nb>.nb.json             # notebook 元数据：cell 顺序、依赖、缓存键
```

---

## 4. cell → module 包装约定

**编译单元与模块语义（重要约束 — 已据用户裁定放宽）**
- **Notebook = 一个 `.tc` 文件 = 一个 Module**，且**不隔离**：整本 notebook 落为一个 module、统一处理，所有 cell 共享同一 scope/地址空间；单元格是文件内的 `cell` 代码块（引入轻量 `cell` 关键字，见 §13），而非独立文件。
- **可 `import` 其他 Notebook 或系统级 module**：notebook 作为普通 module，复用既有 `import(<m> :: *)` 引用外部 module（其他 notebook 预编译为 `.tlib`、系统 std 同机制）。导入契约面向"模块导入"稳定接口，不硬编码 `lib-dir` 细节。
- **跨 cell 引用在单 module 内按名直读**：整本同模块、最终链入同一二进制/同一 wasm 实例，上游 cell 的绑定对下游 cell 直接可见（**可见性规则：自上而下**——下游 cell 可引用更早 cell 的绑定，不可反向引用，见 §13.8），无需 import、无需序列化。
- **编译器按 cell 做二进制缓存与增量更新（放宽红线）**：把既有"文件级 `.tlib`/链接"的增量编译粒度**下放至 cell**——每个 cell 发射为可独立缓存的二进制碎片，键为其内容哈希；cell 变更时仅重编该 cell 碎片并重链，未变 cell 命中缓存。这是**增量编译粒度缩小**，非新概念；typeck/IR/ABI 不动。
- **机制后期会变**：模块机制演进时，cell 间引用仍只依赖"单 module 内可见 + 可 import 外部 module"的稳定契约；当前 `import`/`lib-dir` 细节不硬编码。
- 详见 §13 Model C：单文件 + `cell` 块 + 按 cell 二进制缓存——已消解 Model B 的"失去逐 cell 缓存"短板，且跨 cell 值桥因共享地址空间基本消失。

host 把单元格文本归为三类，并施加确定性包装（**宿主侧完成；`cell` 块为已放宽的轻量语言关键字**）：

**A. 声明 cell**：文本为顶层声明（`fn` / `struct` / `variant` / `type` / 模块级 `var` / `import`）。
- 原样编译；若其定义的类型/值被下游消费，额外 `tc build --lib` 出 `.tlib`（供下游 `import(id :: *)`）。
- 命名：声明自带的名字即为下游引用名（天然合规）。

**B. 表达式 cell**：文本为单个表达式 `E`。
- host 包装为模块级绑定：`var <cellId> = E;`（cellId 由 host 稳定生成，如 `c3`）。
- 用户可显式命名：文本形如 `name = E` 时，host 识别前导 `name =` 并包装为 `var name = E;`（host 侧轻量解析，不进编译器）。
- 下游单元格引用该绑定名即可（等价于 Observable 的"按变量名引用单元格"）。

**C. 语句 cell**：文本为语句块（`for {}` / `if {}` / `print(...)` / 可变副作用）。
- MVP（§5 方案 a）：直接拼接进运行 module。
- 阶段 2（§5 方案 b）：包装为 `fn __cell_<id>() { <stmts> }`，无返回值，副作用经 stdout 捕获。

**运行 module 的生成（host 生成 `@main`）**
host 把"需执行的前缀/后缀单元格"按序拼成单一 module，并注入：
```
@main fn() {
  // 对每个有值的 cell：把其绑定值经值桥写入 valueStore
  //   例如 fid < c3  →  out/notebook/<nb>/values/c3.bin
  // 对每个语句 cell：其 stdout 副作用由子进程捕获
  // 末尾打印一行带 tag 的结果清单，供 host 解析：
  //   __NB_OUT__ <cellId> <ok|err> <bytesOrEmpty>
}
```
→ 重跑策略：改 cell k 时，host 生成 `cells[0..lastAffected]` 的运行 module 重编重跑；因 t 求值确定性，未变前缀重算结果一致（MVP 可接受；阶段 2 用值缓存免重算）。

---

## 5. 跨 cell 值桥（头号障碍）

> 模型说明：在 Model C（单 `.tc` + 全部 cell 链入同一二进制/同一 wasm 实例）下，cell 间**共享地址空间**，跨 cell 值按符号直读，**无需序列化**——本节的序列化桥仅在「cell 跨进程 / 跨 wasm 实例运行」的兜底场景需要。MVP 可优先共享内存，暂不实现下述方案 a/b。

两个递进方案，**MVP 走零改动方案 a**：

**方案 a — 文件二进制协议（零编译器改动，MVP）**
- 表达式 cell 的结果值经既有 `fid < value` 落盘到 `values/<id>.bin`；下游 cell `import(<upstreamId> :: *)` 取得类型后 `deserialize` 读回。
- 类型可序列化性由既有 `@derive(BinarySerde)` 提供（`src/codegen_c.tc:2523` 自动生成 `serialize`/`deserialize`）；不可序列化类型报 `T-FID-E654`（与现有行为一致）。
- 优点：完全复用既有能力，tc 不改一行。缺点：依赖临时文件、需类型可 serde。

**方案 b — 通用内存值桥内建（可选增强，阶段 2）**
- 新增通用内建 `to_value(v) -> Bytes`（任意值→确定性字节），基于已注册的类型 serde 表；配套 `from_value(Bytes, T) -> T`。
- **治理边界**：这是**通用语言能力**（IPC / 序列化 / FFI 桥接都需要），不属于 notebook 专属概念；按 `docs/design.md` 提案流程引入，notebook 仅是复用方之一。
- 引入后可去掉文件 IO，cell 间值传递走内存/管道，且富类型（含 variant/递归）无需用户手动 derive 即可被宿主渲染。

**宿主侧渲染**：host 拿到值的字节/JSON 后，按类型渲染——标量→文本、struct/slice→表格、用户可用 `@derive(Display)` 或约定 `render(x)` 输出 HTML/SVG 片段由宿主呈现（t 无 DOM，渲染解耦于语言，呼应"非目标"）。

---

## 6. 增量编译与缓存

- **缓存键** = `hash(cell 文本 + 其直接依赖 cell 的接口 hash)`。声明 cell 的接口 = `.exports.json`；表达式 cell 的接口 = 其结果的类型签名。
- **命中**：直接复用 `.tlib`/`.ll`，不重编。
- **失效传播**：`invalidate(id)` 沿依赖 DAG 标记下游 cell 缓存失效（受 `docs/laws/L-08_deterministic_build.md` 约束：相同输入必得相同产物）。
- **效果**：稳定前缀的 cell 只编一次；gate 级成本被摊薄到单 cell（典型 cell 远小于整编译器自举）。

---

## 7. 响应式依赖图

- **依赖来源**：host 对每 cell 做轻量静态分析（提取其中引用的上游 cell 绑定名）；可选增强——让 tc 在 `emit-ll`/`build` 时额外 emit 一个 `deps.json`（引用了哪些导入符号），host 据此精确建 DAG（属可选诊断增强，不改语法）。
- **重跑策略**：cell k 变更 → 标记 k 及其下游为 stale → 仅重编并执行受影响后缀（§4 的运行 module 生成）。与 Observable 的"上游不变则下游缓存命中"语义对齐。

---

## 8. 诊断

- **逐 cell 文件编译**：`tc check <cell>.tc --json` → 解析 stdout JSON（`diagnostics[]` 含 `code/file/sl/sc/el/ec`）。file 即 cell 标识，行列即 cell 内位置。
- **cell id 映射**：host 维护 `cellId ↔ .tc 路径`，把诊断 `location` 映射回 UI 单元格与行列。
- **可选补丁**：若需字节级高亮，补 `off`/`eoff` 字段到 `Diag` 结构与 `print_json`（`src/base.tc:6160`），并让解析期就地捕获字节偏移（`Tok` 当前无字节偏移，见项目记忆）。属"扫清障碍"可选项，非阻塞。

---

## 9. 执行目标：原生 vs WASM

- **阶段 1（原生子进程）**：`tc build <entry>.tc --output runner.exe` 跑原生 exe，host 捕获 stdout + valueStore。C/LLVM 后端均可用，零改动。
- **阶段 2（WASM / 浏览器内联）— 两条可选路线**（来自用户裁定）：
  - **前期路线｜轻量 WASM CodeGen（无 LLVM）**：t 的 IR 经新增的**轻量 WASM CodeGen** 直接 emit `wasm` 二进制，不依赖 `clang`/`opt`/`llc` 与任何 LLVM 库。该 codegen 是**通用后端能力**（非 notebook 专属），按 `docs/design.md` 提案引入；runtime 仍需 WASI/POSIX 化（`t_runtime.c` 去 Windows 专属头）。
  - **后期路线（可选）｜LLVM-IR → opt/llc**：复用既有 `emit-ll` 产 IR，再经 LLVM `opt`/`llc` → `wasm`；宿主传 `--clang`/`--runtime` 覆盖 `src/tc.tc:290` 写死路径。
  - JS 侧用 `to_value`/`from_value`（方案 b）或文件协议在 wasm 与宿主间传值。
  - 两条路线均**不改前端与语法**；差异仅在 codegen 后端选择（轻量直出 vs 既有 LLVM 工具链）。

---

## 10. 待扫清的低层障碍清单（按优先级）

| 优先级 | 障碍 | 是否改编译器 | 清除方式 |
|--------|------|--------------|----------|
| P0 | 跨 cell 结构化传值缺口 | MVP 不改；`to_value` 内建是通用增强 | 方案 a 文件协议先跑通；方案 b 提案 `to_value` |
| P0 | Notebook 编排层骨架 | 否 | 实现 `Notebook Compiler Environment`（§3 接口） |
| P1 | 增量缓存 / 依赖失效 | 否 | 内容哈希 + DAG（§6、§7） |
| P1 | 每 cell 独立文件编译 + 诊断映射 | 否 | `tc check --json` + cellId 映射（§8） |
| P2 | 字节级诊断高亮 | 是（小改） | 补 `off`/`eoff` 到 `Diag`/`print_json` |
| P1 | 轻量 wasm codegen（前期路线） | 是（通用后端能力，非 notebook 专属） | 按 `docs/design.md` 提案新增 IR → wasm 轻量发射后端 |
| P2 | WASM runtime 平台适配 | 否（runtime 改） | runtime 去 Windows 专属头 + `--clang`/`--runtime`（后期路线） |
| P2 | 门禁加 L-notebook 示例 | 否 | `tools/gate.mjs` 新增 notebook 示例跑通检查 |

> 红线：所有 P0/P1/P2 中"改编译器"的项，都必须走 `docs/design.md` 提案流程；**任何 notebook 专属语法/语义一律不进 tc**。引入的通用能力（轻量 wasm codegen、`to_value` 内建等）须经上位法校验且对全语言生效，notebook 仅为复用方之一。设计须容忍未来模块机制改动（cell 间引用只依赖"模块导入"稳定契约）。

---

## 11. 阶段计划

- **Stage 1（MVP，原生 + host 侧缓存）— ✅ 已落地并冒烟验证（2026-08-25）**：Notebook 编排层骨架 `tools/notebook.mjs`（单一 `notebook.tc` + 自上而下可见性 + 不隔离）+ 在 cell 边界切分、按 §4 包装（decl 留顶层 / expr·stmt 进 `@main` 作局部）+ 整本内容哈希缓存；共享地址空间下跨 cell 免序列化（方案 a 文件桥仅作跨进程兜底）。验证：`node tools/notebook.mjs run examples/notebook/demo.nb.json` 用真实 `tc`（零改动）跑通多 cell 引用（`c3 = c2+100`）+ 语句 cell 副作用 + 字符串渲染，二次运行命中缓存。**结论：tc 零改动即支撑 notebook 闭环，验证目标达成。**
  - 交付物：`tools/notebook.mjs`（编排层）、`examples/notebook/demo.nb.json`（示例 notebook）、产物 `out/notebook/<nb>/`（notebook.tc / runner.exe / out.txt / <nb>.nb.json 元数据 / .hash 缓存键）。
  - S1 限制（已知，待 Stage 2/tc 侧增强）：① 增量缓存为整本哈希粒度，非逐 cell emit-ll 粒度（后者见 §6/§13.7，tc 侧增强）；② host 把 expr/stmt cell 统一收进 `@main`，故 cell 间执行顺序为「所有顶层 decl → @main 体内按序」，精确交错语义待 `cell` 关键字（design.md §2.8）落地后更优；③ 富类型渲染（struct/slice→表格）待 §5 方案 b `to_value` 内建。
- **Stage 2（增量 + 富渲染）**：内容哈希缓存 + 依赖 DAG 失效 + `valueStore` 真增量复用；宿主侧值→表格/SVG 渲染；可选 `deps.json` 精确依赖。
- **Stage 3（WASM + 浏览器内联）**：双路线择一——前期轻量 WASM CodeGen 直出 wasm，或后期 LLVM-IR → opt/llc → wasm；配 runtime WASI 化 + JS 值桥，实现浏览器内 Observable 式体验。

---

## 12. 红线与治理

- **编译器 oblivious**：tc 不出现 notebook/cell/reactivity 概念；编排层只调用既有子命令。
- **复用优先**：`.tlib`/`import`、`emit-ll`、`fid <>`/`@derive(BinarySerde)`、`check --json` 均为既有能力，直接复用。
- **提案流程**：任何需要 tc 改动的需求（如 `to_value` 内建、字节偏移诊断）按 `docs/design.md` 提案，并经对应上位法校验（`L-08` 确定性构建、`L-10` ABI 契约、`L-07` 双格式诊断、`L-06` 数据优先）。
- **门禁守护**：新能力须经 `tools/gate.mjs` 现有 L0/L1/L2 不动点校验，避免破坏自举（见项目记忆的 IR 漂移归零流程）。

---

## 13. 候选单元模型：`region` 关键字（替代 import 路径）

> 用户提案：消灭 `import("path.to.module")` 式路径导入；引入类 Cone 的区块关键字作为 notebook cell 的对应代码块。经讨论，**采用 `cell <name> {}`**（`region` 保留给未来内存区域语义），本节评估可行性、优缺点，并对比现行「每文件一 module + import」模型（§4）。
>
> **路线已定（用户裁定放宽红线）**：**Model C = 单 `.tc` + `cell` 块 + 按 cell 二进制缓存与增量更新** 为采用路线，同时拿到 Model A 的逐 cell 缓存与 Model B 的免 import/免序列化。详见 13.6 / 13.7 / 13.8。

### 13.1 语义设想（已锁定：`cell` 关键字）
- `cell <name> { <decls/stmts> }` 在 t 中是一个**带名作用域块**，映射为一个 notebook cell（**关键字已定为 `cell`，非 `region`**）。
- cell 间引用：下游 `cell` 直接按名引用上游 `cell` 内绑定（如 `c1::result` 或顶层可见名），**不再需要 `import(<module> :: *)` 与 `--lib-dir`**（外部 Notebook/系统 module 仍走 `import`）。
- 整本 notebook 落为**单个 `.tc` 文件**（cells 相邻）；WASM 路径下即单个 wasm 实例，cell 共享线性内存。
- **可见性：自上而下**（已锁定）——下游 cell 可引用更早 cell 的绑定，不可反向；避免前向声明/两遍 sema（§13.8）。

### 13.2 可行性（关键字：`cell`）
**可行**，属前端 + sema + 轻量 codegen 改动，后端（C/LLVM）几乎不动：
- **Lexer**：`cell` 加入关键字表（不占用 `region`）。
- **Parser**：新增 `CellStmt = 'cell' ident '{' decls* '}'`；`region` 关键字**保留**给未来类 Cone 的内存区域/所有权语义，本次不引入。
- **Sema**：cell 引入嵌套作用域；可见性自上而下（已锁定，见 §13.8），无需前向声明/两遍 sema。`cell` 块在 `emit-ll`/`build --lib` 下已是顶层声明容器，无需 `@main`。
- **Codegen**：cell 块脱糖为「带名作用域 + 可选 `fn <name>__run()`」；C/LLVM 后端仅多一层花括号/函数，ABI 不变。
- **治理**：`cell` 是**语言级作用域块**构造（通用语言特性，非 notebook 专属语义），须经 `docs/design.md` 提案引入，notebook 仅是复用方——不违反「notebook 专属语法不进 tc」红线。

### 13.3 优点
1. **消灭路径导入**：无 `.tlib` 拼装、`--lib-dir` 解析、模块路径字符串；cell 在单文件内词法相邻，加载/保存 notebook 即读写一个 `.tc`。
2. **值桥难题大幅消解**：所有 cell 在**同一编译单元/同一地址空间**，下游直接按名读上游值，无需 `fid <>` 序列化、无需 `to_value` 内建。§5 头号障碍在 region 模型下基本不存在（仅富类型渲染仍走 §5 渲染约定）。
3. **零后端改动**：region 是作用域构造，C/LLVM 后端直接复用；WASM 单实例共享内存，跨 cell 传值天然。
4. **notebook↔源码一一对应**：region 名即 cell id；WASM 下单一实例，cell 间引用即同模块内名字引用，round-trip 干净。
5. **`cell` 与 `region` 语义分工清晰**：`cell` 承载 notebook 作用域单元（已锁定），`region` 保留给未来类 Cone 的内存区域/所有权语义，互不抢占、关键字含义长期稳定。

### 13.4 缺点 / 风险
1. **失去逐 cell 产物缓存**：整本 = 单一编译单元，任一 cell 改动 → 全本重编。大 notebook 比重编单 `.tlib` 慢。缓解：host 按 region 缓存「源码→IR」，仅重编受影响的 region 后缀（链接仍需全量）。
2. **关键字语义治理（已规避）**：`cell` 仅承载 notebook 作用域单元；`region` 明确保留给未来类 Cone 的内存区域/所有权语义，二者不冲突。决策：已锁定用 `cell`（见 §13.8），`region` 不在此引入。
3. **跨 region 引用解析 = 模块系统换皮**：若想 `region_B` 调 `region_A` 的函数而不重声明，需跨 region 名字解析 → 本质就是 import/命名空间机制，只是改名。只有在「单文件非增量」形态下才真正消灭了 import；若 region 也要独立编译（为缓存），则需声明 region 依赖 → 又回到 import。故「消灭 import」仅在单文件非增量形态下成立。
4. **可见性规则（已锁定：自上而下）**：下游 cell 可引用更早 cell 的绑定，不可反向引用；避免前向声明/两遍 sema，sema 复杂度最低（见 §13.8）。
5. **与「每文件一 module」不变量耦合**：用户已指出 t 模块机制后期会变。若 notebook 单元取 `region` 而非 `file`，未来模块机制若与 region 冲突需再适配。耦合面存在。
6. **诊断粒度**：单文件内多 region，诊断 `line/col` 仍为 cell 内相对位置（region 名可附加），定位可达；但 `file` 不再区分 cell，host 需维护 `region名 ↔ cell id` 映射（§8 微调）。

### 13.5 与现行模型对比
| 维度 | Model A（§4：每文件 module + import） | Model B（region 单文件） |
|------|------|------|
| 编译单元 | 每 cell 一 `.tc` 文件 | 整本一 `.tc`，内嵌 cell |
| 跨 cell 引用 | `import(<id> :: *)` + `--lib-dir` | 按名直接引用（单作用域） |
| 值桥 | 需 `fid <>` / `to_value`（§5 头号障碍） | 共享内存，无需序列化 |
| 增量缓存 | 逐 cell `.tlib`/`.ll` 命中 | 仅 cell 级源码缓存，重编全量 |
| 后端改动 | 零 | 零（加 cell 关键字属前端/sema 改动） |
| 编译器改动 | 零 | 引入 `cell` 关键字（语言特性，走提案） |
| 与未来模块机制 | 面向「模块导入」稳定契约 | 单元取 cell，需容忍机制变更 |
>
> **Model C（采用路线）** = 单 `.tc`（= 一个 Module）含 `cell` 块，可 `import` 其他 Notebook/系统 module；编译器按 cell 做二进制缓存与增量更新（把文件级 `.tlib`/链接增量粒度**下放至 cell**）；所有 cell 链入同一二进制/同一 wasm 实例 → 共享地址空间 → 跨 cell 免序列化。它 = Model B 的免 import/免序列化 **＋** Model A 的逐 cell 缓存，是两者优点并集。

### 13.6 裁定建议
- **Model C（单 `.tc` + `cell` 块 + 按 cell 二进制缓存）综合占优**：用户已裁定放宽「tc 无感知」红线，允许轻量 `cell` 关键字 + 编译器按 cell 缓存/增量。它同时拿到 Model A 的逐 cell 缓存与 Model B 的免 import/免序列化（共享地址空间），且是既有文件级增量编译的粒度下放，非新概念。
- **推荐直接以 Model C 为路线**：Stage 1 即可用 host 侧切分（零 tc 改动）验证闭环；`cell` 关键字与 tc 侧缓存作为后续增强（经 `docs/design.md` 提案）。详见 13.7 影响评估。
- **关键字治理（已锁定）**：notebook 单元采用 `cell` 关键字（轻量作用域块）；`region` 保留给未来类 Cone 的内存区域/所有权语义，本次不引入。避免关键字语义冲突导致的二次返工（见 §13.8）。

### 13.7 对编译器的影响评估（用户裁定放宽红线后）
用户问：放宽「tc 完全无感知」、允许 `cell` 块 + 按 cell 二进制缓存，对编译器影响大吗？

**结论：影响小到中等，且绝大多数是"增量/粒度下放"，不是重写现有逻辑。** 拆开看：
- **Notebook = 一个 `.tc` Module + 可 `import` 外部**：零改动（`.tc` 本就是 module，`import` 本就存在）。
- **`cell` 关键字（作用域块）**：改动集中在前端——lexer 加 1 关键字、parser 加 1 语句形、sema 加一层嵌套作用域 + 可见性规则。属**新增路径**，不动 typeck/IR/ABI。
- **按 cell 二进制缓存/更新**：本质是"把既有文件级增量编译（`.tlib`+链接）的粒度下放至 cell"。t 已在文件粒度具备：每文件 emit 独立对象、按内容缓存、链接重定位。cell 粒度 = 同一机制的更细分组。实现二选一：
  - **(a) 宿主侧（零 tc 改动）**：host 在 cell 边界切分，逐 cell 复用 `emit-ll`/`build --lib` 缓存，最后链成单一二进制；cell 边界 host 已知（甚至可用注释标记而非语言关键字）。
  - **(b) tc 侧（小规模新增）**：tc 增加"编译单元 = cell"发射模式 + 内容哈希缓存层；新增代码路径，不改现有 lowering。
  - 两种都不触碰语义核心。
- **「更新 cell 二进制」= 重编该 cell 对象 + 重链**：链接器做重定位；若 cell 接口（导出符号/大小）未变，下游 cell 仅重链不重编（依赖 DAG 由 host 维护，§7）。标准分离编译。

**为何优于 Model A/B**：所有 cell 链入同一二进制/同一 wasm 实例 → **共享地址空间 → 跨 cell 值桥（§5 头号障碍）基本消失**，无需 `fid <>`/序列化；同时保留 Model A 的逐 cell 缓存。Model C 同时拿到 A 的缓存与 B 的免 import/免序列化。

**已锁定决策（见 §13.8）**：① 跨 cell 可见性 = 自上而下（不反向引用）。② 缓存放 host 侧优先（零 tc 改动，先验证闭环；tc 侧为后续增强）。③ 关键字 = `cell`（非 `region`；`region` 保留给未来内存区域语义）。④ 隔离性 = 不隔离，整本统一为一个 `.tc`、共享 scope/地址空间。四项均无编码阻塞，均为语言设计决策。

### 13.8 已锁定决策（来自用户裁定）

| # | 决策点 | 锁定值 | 对编译器的影响 | 备注 |
|---|--------|--------|----------------|------|
| 1 | 跨 cell 可见性 | **自上而下**（下游可引用更早 cell，不可反向） | 零：sema 只需单层嵌套作用域 + 顺序可见性，无前向声明/两遍 sema | 与 notebook 书写惯例一致；反向引用（双向）需两遍 sema，已排除 |
| 2 | 增量缓存落点 | **先 host 侧**（零 tc 改动验证闭环）；tc 侧为后续增强 | host 侧：零改动，host 在 cell 边界切分复用 `emit-ll`/`build --lib` 缓存再链成单二进制。tc 侧：新增"编译单元=cell"发射模式 + 哈希缓存层（新增路径，不改 lowering） | 最快验证"单 `.tc` + cell 块 + 共享内存免序列化"是否成立 |
| 3 | 单元关键字名 | **`cell`**（非 `region`） | `cell` 进 lexer/parser/sema（作用域块）；`region` 不引入 | `region` 保留给未来类 Cone 的内存区域/所有权语义，互不抢占 |
| 4 | 隔离性 | **不隔离**：整本统一一个 `.tc`、共享 scope/地址空间 | 零：单 module 天然共享 scope；所有 cell 最终链入同一二进制/同一 wasm 实例 | cell 间全局状态/命名互泄（notebook 通常正需要）；不做 cell 级隔离 |

**对 §13.7 结论的最终确认**：四项决策把"影响小到中等"进一步收紧——可见性与隔离性选择使 sema 改动控制在"单层嵌套作用域 + 顺序可见性"，无任何双向解析/所有权语义；缓存先走 host 侧意味着 **Stage 1 可做到 tc 零改动**；`cell` 关键字与 `region` 分工明确，无治理返工风险。路线已无未决项，可进入编排层骨架搭建（§11 Stage 1）。
