# T 编译器层内存控制规范（参考 Zig 0.17）

> 状态：草案 v0.2（2026-10-23 晚，XID 全局数组堆拷根因修复后修订）
> 关联：`perf-baseline.md`、`ci-gate-design.md`（G-CI-10 性能门禁）、`compiler-pipeline-design.md`、`tir-design.md`
> 背景：内存优化（代际/块局部分配器 + 字符串驻留）已落地并经 `gate L2` 全绿；随后定位并修复了**自举峰值 21GB 的真凶——LLVM 后端把模块级全局数组降级为每调用整张堆拷**（§3.5）。修复后真实峰值地板降到 ~2.5GB（仍由 sema 语义图主导，但量级完全不同）。本规范把"一次性优化"提升为**长期的编译器层内存控制纪律**，并固化已验证的诊断工具与后端陷阱。

---

## 1. 目标与范围

**问题现状**（2026-10-23 `tools/_mempeak2.py` 实测，修正版）：

| 阶段 | 修复前峰值 (PrivateBytes) | 修复后峰值 | 备注 |
| --- | --- | --- | --- |
| `tc check src/tc.tc` | **19.80 GiB** | **~2.5 GiB** | 修复前峰值**大头是后端降级 bug**（见 §3.5），非 sema 地板 |
| `tc emit-ll src/tc.tc` | **22.75 GiB** | ~2.5 GiB | 同左 |

⚠ **重要修正（推翻 v0.1 的旧判）**：v0.1 把 19.80/22.75 GiB 解读为「sema 持久语义图 87% 地板、arena 优化方向性错配」。**该解读只对了一半**——sema 确实是常驻大头，但那次 21GB 量级的尖峰**绝大多数并非 sema 语义图，而是 LLVM 后端把模块级全局数组 `var` 降级为「每调用一次整张堆拷」的缺陷**（§3.5）。`is_xid_start`/`is_xid_cont` 被内联进 `lex__tokenize`，逐字符触发 → 仅 XID 一项就累计 ~7.6GB，叠加其它分配把 mi_heap 推到 ~21GB。修复后峰值降到 ~2.5GB，此时 sema 语义图才是真正的、量级合理的地板（详见 §3.5 验收）。

⇒ 本规范的真正杠杆仍是 §5 的语义图去重/回收，但**目标量级从「砍掉 21GB 尖峰」修正为「把 2.5GB 地板进一步压到几百 MB」**——前者已由 §3.5 的后端修复解决。

**本规范目标**：

1. 把 Zig 0.17 自托管编译器的"分阶段显式内存控制"模型，映射到 t 的现有 arena 体系，固化纪律；
2. 明确**持久语义图（87% 大头）的去重与回收**才是真正杠杆，并给出实施路线；
3. 建立"改 `src` 必测峰值 + `gate L2`"的回归阻断门禁。

**范围边界**：只规范**编译器自身运行期**的内存（前端→sema→TIR→codegen 链路内的分配），不涉及：生成代码的运行期内存、用户程序内存、链接器内存。

---

## 2. 参考模型：Zig 0.17 编译器层内存控制

> Zig 0.17 并未对编译器内存模型做革命性改动；其参考的是跨 0.x 稳定的自托管架构：`Compilation` + `Zcu`(即 `Module`) + `InternPool`。以下摘自 `zig/src/Compilation.zig` 与 `Module.zig` 的实际结构。

### 2.1 所有权的两层分配器

```zig
pub const Compilation = struct {
    /// General-purpose allocator. Used for both temporary and long-term storage.
    gpa: Allocator,
    /// Arena-allocated memory, mostly used during initialization. However, it can
    /// be used for other things requiring the same lifetime as the Compilation.
    arena: Allocator,
    ...
};
```

- **`gpa`**（General Purpose Allocator）：开发期带 double-free / use-after-free / leak 检测；用于临时与长期存储。
- **`arena`**（ArenaAllocator，child = `gpa`）：与 `Compilation` **同寿**，init 期与编译生命周期的分配统一落此处，结束时一次性释放。

→ **t 类比**：`g_arena` 即"与编译单元同寿的 arena"；Zig 的 `gpa` 对应 t 的底层 `mi_malloc`（bump arena 的物理页来源）。

### 2.2 `InternPool` —— 语义去重的唯一核心

`Zcu`(Module) 持有 `InternPool`，把**类型（Type）与值（Value）**全局去重到一个池，整个编译期存活；所有引用靠 **intern id** 而非指针/拷贝。这是 Zig 控制语义内存的根本机制——同一类型不重复存储，类型表是 O(去重后类型数) 而非 O(语法出现次数)。

→ **t 类比**：t 已有 `sym32`（`t_sym_intern`/`t_sym_str`，字符串/符号去重），但**未覆盖类型表**（`td`/`tis`、`g_node_*` SoA 侧表）。这是 §5.1 的核心提案。

### 2.3 分阶段生命周期（phased destruction）

Zig 自托管管线：

```
源码 → 解析(AST, 临时 arena) → 生成 ZIR(静态 IR, 常驻) → Sema 逐 decl 惰性生成 AIR(可缓存/失效)
```

- **AST 落临时 arena**，ZIR 一生成即 `reset` AST arena —— 解析器产物不常驻；
- **ZIR 是"静态" IR**，整个编译期存活（被 Sema 反复读取）；
- **Sema 按 declaration 惰性分析**，仅被引用的 decl 才生成 AIR；AIR 缓存但可增量失效。

→ **t 类比**：t 的 `g_parse`（前端本块 arena）已是同源思路（parse 完 `arena_reset_parse`）；但 t 的 **语义图（TIR 降级后的节点表 / 类型表）整模块常驻**，缺少 Zig 的"按 decl 惰性 + 可失效"粒度（§5.2）。

### 2.4 显式分配器 + arena 纪律

Zig 每个可能分配的函数都接收 `std.mem.Allocator` 参数，所有权/生命周期显式；arena 用于 request/frame 生命周期，编译单元级用 `Compilation.arena`。核心纪律：**不在临时 arena 上产生跨生命周期的悬垂引用**。

→ **t 的纪律映射**：t 的 `arena_use_*(...)` / `arena_reset_*(...)` 是同源原语；之前 emit 期 SIGSEGV 正是"把 `g_func` 指针存进持久结构"的悬垂引用（见 §3.3 与 `str_persist` 修复）。

---

## 3. T 编译器现状（ground truth）

### 3.1 当前 arena 体系（`runtime/t_runtime.c`）

| Arena | 角色 | 生命周期 | 现状 |
| --- | --- | --- | --- |
| `g_arena` | 持久默认区；语义图唯一 owner | 整个编译单元 | 语义图地板（87%） |
| `g_parse` | 解析期 AST/CST 本块 | parse 段内，段末 `arena_reset_parse` | 已用 |
| `g_front` | 前端（脱糖+sema+lower）本块 | 前端段内 | 已定义，使用不完整 |
| `g_back` | 后端（codegen）本块 | 后端段内 | 已定义 |
| `g_func` | 逐函数重降级 scratch（TIR 函数体） | 每函数 emit 后 `arena_reset_func` | 2026-10-22 引入；窗口由 `tir.g_relowering` / `g_relowering_scratch_func` 控制 |

`TArena` 是 **bump 分配器**：`t_arena_alloc` 线性推进 `used`，`t_arena_free_all` 仅重置 `used`（Windows 上 `MEM_DECOMMIT` 回退物理页）。**不支持单块 free**。`t_arena_mark`/`t_arena_reset_to` 提供 mark/reset 粒度（代际回收）。

Windows 上 `g_arena` 预留 **64 GiB 虚拟地址**（`MEM_RESERVE`，仅占地址空间，物理页按需 `MEM_COMMIT`）——这是 S5 自举闭环的持有，不是真实内存占用。

### 3.2 关键原语（`src/base.tc` + `runtime/t_runtime.c`）

- `arena_use_default/parse/front/back/func()`：切换当前 arena（`g_cur`）。
- `arena_reset_parse/front/back/func()`：整块回收对应 arena。
- `str_persist(s: string) string`：把 `s` 拷贝进 `g_arena`（逃逸提升），使其越过本块 arena 回收仍有效。模块级持久持有者（`g_ll_names`/`g_func_names`/`g_str_table`/`g_clo_thunk_req` 等）的字符串必须经此。

### 3.3 管线 → arena 映射

```
parse    → arena_use_parse()  ...  arena_reset_parse()   (AST/CST 落 g_parse，完成时释放)
desugar+sema → arena_use_default()  (类型表 td/tis、符号、g_mod 持久表落 g_arena)
tir relowering → g_relowering 门窗：函数体落 g_func；relowering 期写持久表须 arena_use_default()
emit(ll/c) → 逐函数：g_func 承载 TIR 函数体，emit 完 arena_reset_func()
```

**历史坑（已修）**：relowering 期把持久 slice 的 backing 落进了 `g_func`，`arena_reset_func` 后悬垂 → emit-ll 自举 SIGSEGV。修复 = 持久写入站点统一 `arena_use_default()` 后 append（`str_persist` 双保险）。

### 3.4 已落地成果与边界（2026-10-22 ~ 2026-10-23）

- ✅ **emit 期 SIGSEGV 消除**（`g_func` 窗口正确闭合 + `str_persist` 真正拷贝进 `g_arena`）。
- ✅ **字符串驻留中性**：`t_str_concat` 经 sym32 落 `g_arena`，`emit-ll` IR 字节一致（md5 `09501cd1…`），峰值不变。
- ✅ **`gate L2` 24/24 全绿**（两次提交 `4a29d03` + `b87e009`）。
- ⚠ **峰值「未降」的旧判已修正**：19.80 / 22.75 GiB 并非 sema 语义图地板，而是 LLVM 后端全局数组降级堆拷缺陷（§3.5）造成的尖峰。修复后真实地板 ~2.5GB（仍 sema 主导，但量级合理）。arena 基础设施本身的价值是消除 emit 期 SIGSEGV，与峰值尖峰是两件事。
- ⚠ **字符串驻留陷阱已实证**：独立 stable 池 / 经 `t_sb_to_str` 驻留会把瞬时代码串永久钉死 → 峰值 19.8→50/83 GiB；`sb_reserve` 精确扩容是 O(N²) 陷阱。结论：驻留只能落 `g_arena`（替换而非新增）。

### 3.5 LLVM 后端全局数组降级堆拷（2026-10-23 晚，已修复 ✅）

**根因（LLVM IR 层坐实）**：LLVM 后端把「加载模块级 `var <大数组> = ...` 全局数组值」降级为「**每调用一次 `tll_alloc(整张尺寸) + memcpy 清零`**」，而非对全局符号直接 GEP。读 `out/dbg/tc.ll:44121-44138` 确认 `base__is_xid_cont` 每调用 `tll_alloc(6448)`、`base__is_xid_start` 每调用 `tll_alloc(5528)`；二者被内联进 `lex__tokenize`，逐字符触发 → 仅 XID 一项累计约 7.6GB。C 后端本就按指针 GEP 索引（`tc.c:24067/24140` 零分配），故早期读 C 产物时漏判，误以为是 emit/sema 地板。

**修复**（`src/base.tc` 的 `is_xid_start`/`is_xid_cont`）：原直接索引全局数组 `xid_start_lo[mid]`（触发降级堆拷）→ 改为先取零拷贝切片视图

```t
var slo: []i64 = xid_start_lo;   // array→slice lowering 自动补 @slice_from_raw，仅填 TSlice 槽 ptr/len，不搬数据
var shi: []i64 = xid_start_hi;
... slo[mid] ...                 // 切片指针算术二分查找
```

双后端一致、零分配。

**诊断工具（已随 `5a4c55d` 提交，均门控零开销）**：

- `T_MIHIST=1`（`runtime/t_runtime.c`）：按调用方返回地址做 mi_malloc 字节/次数直方图 + `CaptureStackBackTrace`，直接定位「`sz=<整张字节>` 由谁调用」的堆尖峰；
- `--memstats`（`src/tc.tc`）+ `T_MEMSTATS` 埋点（`src/lex.tc`/`src/sema.tc`）+ `dbg_report_mem` 内建：分阶段报告 mi 分配总量。

**验收（修复后重建 run10）**：

- MIHIST 直方图 `sz=6448 / sz=5528` 出现次数 = **0**；
- `tc check src/tc.tc` → `errors: 0`；
- 实测峰值 **PEAK_WS≈2.49GB / PEAK_PRIVATE≈2.61GB**（旧 ~21.3GB，约降 8.8×）；
- `conformance` **373 passed / 0 failed**；
- IR 基线 4 DIFF / 0 新增 / 0 缺失 → 已 `--update` 重录。

**闭环**：提交 `5a4c55d` @ `wb` → `gate L2` **24 passed / 0 failed（3362.5s）** → 安装 `g4.exe`/`rls/tc.exe`。

---

## 4. 规范：编译器层内存控制纪律（Normative）

以下为**强制纪律**，任何 `src/*.tc` / `runtime/*.c` 的分配相关改动须遵守。

### Rule A — arena 分层归属（显式、不可省略）

每个分配点必须明确所属 arena。默认 `g_arena`（持久）；临时/本块分配必须切到对应 arena 并在段末 reset。

| 数据 | 归属 arena | 回收时机 |
| --- | --- | --- |
| AST / CST | `g_parse` | `arena_reset_parse()`（parse 完成） |
| 类型表 `td`/`tis`、符号、模块表 `g_mod`、发射表 `g_ll_*` | `g_arena`（持久） | 进程退出 |
| TIR 函数体（指令列表） | `g_func` | 每函数 emit 后 `arena_reset_func()` |
| 后端临时串 | `g_back` | codegen 完成 |
| 跨块需存活的字符串/切片 | `g_arena`（经 `str_persist`） | 进程退出 |

### Rule B — 逃逸提升必须显式

任何要越过本块 arena 存活的字符串/切片，**必须**经 `str_persist`（落 `g_arena`）或显式 `arena_use_default()` 后 append。**禁止**把 `g_parse` / `g_func` 指针存进持久结构。违反此条 = 悬垂引用 = SIGSEGV（历史已发生）。

### Rule C — 持久结构的 owner 唯一

`g_arena` 是语义图的唯一 owner。relowering / emit 期的临时写入若目标是持久结构，必须切回 `g_arena`（`arena_use_default()`）后再写；不得让持久结构的 backing 落在 `g_func`/`g_back`。

### Rule D — 禁止"单块 free"假设

arena 是 bump 分配器，只支持**整块 reset**（`arena_reset_*` / `t_arena_reset_to`）。不得假设某个对象可被单独释放后再分配；若需细粒度回收，用 mark/reset 窗口而非逐对象 free。

### Rule E — 测量门禁（回归阻断）

改 `src` 后**必须**：

1. `python3 tools/_mempeak2.py out/dbg/tc.exe check src/tc.tc` —— 记录 `check` 峰值（读 `PrivateUsage`，免 psutil）；
2. `python3 tools/_mempeak2.py out/dbg/tc.exe emit-ll src/tc.tc --output out/dbg/_tc_final.ll` —— 记录 `emit` 峰值；
3. `T_MIHIST=1 out/dbg/tc.exe check src/tc.tc 2>out/dbg/mihist.log` —— 抓按调用方的 mi_malloc 直方图，定位「`sz=<整张字节>` 由谁分配」的堆尖峰（§3.5 即靠此定位）；
4. `node tools/gate.mjs L2` —— 全链路正确性。

**阻断阈值**：峰值回归 > 5%（或内存相关 `gate L2` 步骤 FAIL）即阻断，须先定位（参考 §6 风险清单与 §3.5 的 MIHIST 手法）。

### Rule F — 禁止依赖「模块级全局数组按值加载」（LLVM 后端陷阱）

**严禁**让被高频/逐元素内联调用的函数，直接以「`var s = <全局大数组>` 后按值读取整张」的方式使用模块级 `var` 大数组。LLVM 后端会把这种「加载全局数组值」降级为每调用 `tll_alloc(整张)` + memcpy 清零（§3.5），逐次整张堆拷 → 自举峰值暴涨。

**正确写法**：对全局数组取**零拷贝切片视图**（`var s: []T = arr`，array→slice lowering 自动补 `@slice_from_raw`，仅填切片槽 ptr/len 不搬数据），再经切片索引（指针算术）。C 后端无此缺陷（按指针 GEP），可作双后端对拍反推。

> 注：这是「后端降级缺陷」而非语义错误——代码语义正确，只是内存代价爆炸。任何「全局大数组被逐字符/逐元素内联访问」的场景都须套用此规则，不限于 XID 查表。

---

## 5. 目标架构：真正压峰值的路径

Zig 的经验表明，编译器内存的杠杆不在"emit 期函数体"，而在**语义图的去重与回收**。对应 t 的 87% 大头：

### 5.1 语义图去重池（类比 Zig `InternPool`）

**提案**：引入 `g_sema_pool`（类型 + 符号 + 名的 intern 池），覆盖当前未去重的语义结构：

- 类型表 `td`/`tis`：相同类型只存一份，引用走 intern id（当前 `tds`/`tis` 按出现拷贝）。
- 全局名 / 标识符 / `g_ll_*` 发射表：已部分走 sym32，但 `g_node_*` SoA 侧表的字符串字段（kind/name/und）须统一经 `str_persist`/intern。
- 复用现有 `sym32` 机制（用户明确要求"字符串服用走 sym32"），扩展其 tag 维度覆盖类型。

**预期**：类型/名是高度重复的（自举编译器里同一基础类型出现成千上万次），去重对 87% 大头应有显著缩减。

**约束**：intern 池字节必须落 `g_arena`（§3.4 实证：独立池 = 双倍保留）。

### 5.2 按顶层 decl 切代际窗口（类比 Zig 逐 decl 惰性分析）

**提案**：编译完一个顶层 decl 后，若其后模块内无跨 decl 引用其 scratch，可 `arena_reset_to(mark)` 回收其 sema scratch。

**前置探针（必做）**：`g_node_*` 是**全局节点 id 索引**，下游 emit / HIR 缓存 / 跨 decl 类型解析都可能引用。须先做**跨 decl 引用图分析**，确认 reset 某 decl 的 side-table 不会造成悬垂。这是 §7 的高优先探针任务。

### 5.3 分阶段销毁（phased destruction，强化）

- parse 完成 → `arena_reset_parse()`（已做）；
- 每个函数 emit 完 → `arena_reset_func()`（已做）；
- codegen/link 完成 → `arena_reset_back()`（确认已接）；
- 模块所有 decl 分析完、进入纯 emit 后 → 可回收 sema 只读缓存（`g_relowering` 标志位清理）。

### 5.4 多进程 bootstrap（兜底，类比 clang 的分片）

若 §5.1/5.2 仍不足以压到目标，把自举拆成**内存有界的子进程**（每个编译单元独立进程，峰值上限可控）。这是 item ④ 思路，成本最高，作为兜底。

---

## 6. 风险与开放问题

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| **LLVM 后端全局数组降级堆拷** | 模块级 `var` 大数组被按值加载 → 每调用整张 `tll_alloc`+memcpy；内联高频访问 → 峰值暴涨（实测 21GB，§3.5） | **Rule F**：改取零拷贝切片视图 `var s:[]T = arr` |
| 跨 decl 悬垂引用 | `g_node_*` 全局索引，per-decl 回收风险高 | §5.2 引用图探针先行 |
| intern 池 retainer | 池不住 `g_arena` 则双倍保留（实测 19.8→83 GiB） | intern 字节强制落 `g_arena` |
| bump arena 单块 free 误用 | 假设可单独释放对象 | Rule D 纪律 + 代码评审 |
| 测量噪声 | mimalloc OOM flake；门禁资源竞争误报 `diffpipe` | `T_MIHIST=1` 直方图 + `tools/_mempeak2.py` 多次取稳；独立复跑 `_diffpipe.mjs` |
| 字符串/类型去重改变 IR | intern 改变字节布局 → 快照漂移 | 改 src 必重录 `tests/ir_baseline.json`（0 NEW/0 GONE 判据） |

---

## 7. 验证计划

- **单元（峰值）**：`tools/_mempeak2.py` 对比 `check`/`emit` 峰值 vs §1 基线（修复前 19.80 / 22.75 GiB → 修复后 ~2.5 GiB）。
- **堆尖峰定位**：`T_MIHIST=1` 直方图抓「`sz=<整张字节>` 由谁分配」，配合 `tools/mihist_resolve.py` 解析调用栈（§3.5）。
- **集成（正确性）**：`node tools/gate.mjs L2`（24 步，含自举四代不动点 `g2==g3==g4`、C 后端自举、双轨对拍 96/96）。
- **探针（可行性）**：跨 decl 引用图分析（§5.2 前置），输出"哪些 decl 的 scratch 可安全回收"。
- **IR 基线**：任何 emit/sema 改动后 `node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe`，判据 `0 NEW / 0 GONE`。

---

## 8. 实施阶段（roadmap）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **阶段 0** | arena 基础设施 + SIGSEGV 修复 + 字符串驻留（中性） + `gate L2` 全绿 | ✅ 已完成（`4a29d03` + `b87e009`） |
| **阶段 0.5** | LLVM 后端全局数组降级堆拷根因修复（XID 切片视图）+ MIHIST/`--memstats` 诊断 + `gate L2` 24/24 | ✅ 已完成（`5a4c55d`，峰值 21GB→2.5GB） |
| **阶段 1** | 语义图 intern 池 `g_sema_pool`（类型/名去重，落 `g_arena`） | ◐ 名去重(sa/sb/sc)已落地·实测中性；类型表去重 + 结构性分配削减待做（见下） |
| **阶段 2** | 跨 decl 引用图探针 → 决定 per-decl 回收可行性 | ⬜ 待启动 |
| **阶段 3** | 若探针可行：per-decl 代际窗口 | ⬜ 依赖阶段 2 |
| **阶段 4** | 若仍不足：多进程 bootstrap（兜底） | ⬜ 兜底 |

**下一步建议**：阶段 1 的「名去重」子项已落地（见 §8.1 实测结论），但**实证推翻了「字符串去重即可压到几百 MB」的旧假设**——`--memstats`/`T_MIHIST=1` 显示 3.22GiB 峰值里 mi_heap 占 2.85GiB，且 t 字符串内容**恒在 mi_heap**（运行期分配、进程结束前不回收、不可变），`str_intern` 对已分配串做内容去重**不释放副本**，故峰值中性。真正的「几百 MB」杠杆是：① 类型表去重（`td`/`tis` 按结构去重引用走 id，§5.1 另一半）；② 结构性分配削减（`base__node_new` 489MiB、`cst__kw_lookup` 393MiB 两大堆分配大头，见 §8.1）。这两者都是比名去重大得多的改动，须作为独立阶段评估，不再归入阶段 1 的「名去重」子项。

### 8.1 阶段 1（名去重）实测结论（2026-10-24，已落地未达标）

- **改动**：`src/base.tc` 新增字符串驻留器（`str_intern_init` / `str_hash` / `str_intern` + `g_intern_*` 池，落 `g_arena` 预分配）；`node_set_sa/sb/sc` 经 `str_intern(v)` 收敛；`src/tc.tc` 两编译入口（check ~303 / build ~981）在 `arena_use_parse` 前 `g_intern_active=false` + `str_intern_init`，`arena_use_default` 后 `g_intern_active=true`（阶段闸门：仅持久 arena 阶段驻留，parse 期 g_parse 临时串不落池）。
- **⚠ 关键坑（已定位）**：t 的 `string.len` 字段访问在当前编译器 codegen 中存在 latent bug——`s.len` 被 emit 成 `getelementptr %TStr i32 0, i32 0`（误读 `.ptr` 内容当长度），全 `tc.ll` 仅 4 处且全在 `str_hash`/`str_intern`。编译器其余代码**从不**直接用 `s.len`（一律走内置 `str_len`），故此前未触发。驻留器已改用 `str_len(s)` 规避，零风险。
- **回归验证（tc_new = 当前源码 bootstrap 一代）**：`tc check src/tc.tc` **exit=0**（崩溃已消）；`conformance` **373/373**；`ir_snapshot` **0 NEW / 0 GONE**（4 处 DIFF 来自新增编译器函数导致的 IR 漂移，合法）。
- **峰值（实测失望）**：`tc check src/tc.tc` → `peak_private ≈ 2.66 GiB`（基线 tc.exe 2.61 GiB，**中性偏略增**）。原因：`str_intern` 对「已分配的重复串」返回 canonical 但不释放原串副本（mi_heap 直到进程结束才回收），且 `str_persist` 对每个唯一串额外拷贝一份 → 净效应不降反略增。
- **根因（MEMREPORT + MIHIST 坐实）**：

  | 阶段 | arena_commit | mi_heap(mimalloc) | peak |
  | --- | --- | --- | --- |
  | after_parse | 61 MiB | 677 MiB | 677 MiB |
  | after_sema | 891 MiB | 2854 MiB | 3221 MiB |
  | after_ann | 892 MiB | 2855 MiB | 3221 MiB |

  - `MEMSTATS`：`node_count=291280`、`tis_count=111710`、`soa_shell=68MiB`、`tis=11MiB`——bump arena 语义图仅 ~892MiB（其中节点 SoA 壳 68MiB + 类型表 11MiB），**并非地板主因**。
  - `T_MIHIST=1` 堆分配 Top2：`base__node_new` **489MiB**（291280×1680B，节点结构）、`cst__kw_lookup` **393MiB**（190700×688B）；其余 ~1.9GiB 散落于大量调用方。**字符串内容去重不是堆大头**。
- **结论**：名去重（sa/sb/sc）作为 `g_sema_pool` 的基础设施已就位（池 + 收敛钩子），且**内容去重语义正确、零回归**，但**单靠它压不到几百 MB**。要达目标须另开：① `td`/`tis` 类型表结构去重（§5.1 另一半）；② `node_new`/`kw_lookup` 结构性分配削减（释放/避免中间结构，或走 §5.3 子进程兜底）。这两者均超出阶段 1 原「名去重」范畴，列为独立评估项。

---

### 8.2 §5.3 多进程 bootstrap 设计（用户 2026-10-24 选定方向）

**可行性实测（已做 spike）**：
- 任意合法程序（`hello` / `adt_list` / `fstring_json` / `vector_demo`）`check` 峰值恒为 **0.71 GiB**，与程序大小无关 → 存在**固定基成本 ~0.71 GiB**（std 库 + 类型系统 + 运行期，每次编译必付）。
- 整编译器 `tc check src/tc.tc` 峰值 **3.22 GiB** → 编译器自身语义图贡献约 **2.5 GiB**（291280 节点）。
- **推论**：若把 `tc.tc` 拆成 K 个独立编译单元、各在独立 OS 进程编译，则每进程峰值 ≈ `0.71 + 2.5/K` GiB。K=4→~1.34GiB，K=8→~1.0GiB，K≥16→~0.71–0.86GiB。**整体自举峰值 = max(子进程峰值) ≈ 几百 MB 量级，有界**——§5.3 确能达标（地板即固定基 0.71GiB ≈ 七百 MB，已属「几百 MB」）。

**当前阻断点**：`tc_load_src`（tc.tc:53）把命令行多文件**拼接成单源码、单模块、单进程**编译；`@import` 内部模块（如 `src.base`）走源码内联，无「预编译 .tlib + 外部引用」分离编译。故 §5.3 须让内部模块也能「预编译成 .tlib、被依赖方以外部符号引用」，再链接。

**关键复用**：`.tlib` 库归档机制已存在（`tir_to_ll.build_tlib` / `lex.g_ext_link` / `tc build --link-deps`），当前服务**外部库**；扩展其对**内部模块**生效即 §5.3 的核心编译器改动。

**⚠ 2026-10-24 修订（实测推翻"中等工作量"旧判）**：现有 `resolve_external_lib_archive` 外链模式**仍载入依赖源码供类型检查**（`sema.tc:11495` 「库源码仍载入供类型检查」），仅把 `.tlib` 留待链接期并入——故它**不降内存**：依赖图照样内联进子进程（sema 进程仍 2.3GiB）。要真正有界，外链必须改为**载「接口文件」**（仅 pub 签名 + 类型定义，不含实现），子进程不再建依赖语义图。
- **推论**：按文件拆分 + 接口文件外链后，每子进程峰值 ≈ `固定基 0.71GiB + 本模块自身图 + 极小接口`，**整体自举峰值 = max(子进程峰值)**。但最大模块 `sema`/`tir` 自身图约 **0.87GiB+**（实测 sema/tir 独立 check 即使失败也已达 2.3GiB，其中自身图 0.87GiB+），故 max ≈ **1.5GiB**（非几百 MB）。
- **几百 MB 的真正路径**：在文件级拆分 + 接口文件基础上，**再拆分 sema.tc / tir.tc 巨型模块**为子模块（编译器核心大重构，估数周）。
- **结论**：用户 2026-10-24 选定「接受 ~1.5GiB 有界（中等工作量）」——实际等价于「文件级拆分 + 接口文件外链」（接口文件是必需项，非可选项）；要几百 MB 必须额外拆分巨型模块。阶段 B 即落地接口文件机制（生成 `.tint` + 外链改载 `.tint`），阶段 C 编排依赖序分进程编译 + 链接。

**分阶段计划（建议）**：
- **阶段 A（设计确认 + 依赖图）✅ 已完成（2026-10-24）**：导出编译器模块 `@import` 依赖图，**确认是无环 DAG（根 base）**——`base` 零内部依赖，其余模块均经 `lex`/`parse`/`hir`/`sema`/`tir`/`tmir`/`opmap`/`llname`/`mir` 等最终只指向 `base`，无任何回边。故 §5.3 **无需接口桩**，可干净地按拓扑序逐模块独立编译：`base` → `lex`/`opmap`/`llname` → `parse`/`hir` → `sema`/`tir` → `codegen_dev`/`codegen_riscv`/`codegen_wasm`/`codegen_c_tmir`/`tir_to_ll`/`comptime_fold`/`derive_gen`/`test` → `tc`。每模块在独立 OS 进程编译，引用依赖方预建 `.tlib`。
- **阶段 B（接口文件 .tint 外链）✅ 已落地并验证（2026-10-24）**：`src/sema.tc` 的 `handle_one_import` 增加 `T_TINT_DIR` 门控——`@import("src.X")` 优先载 `<T_TINT_DIR>/X.tint`（仅 pub 签名+类型定义，不含实现），默认（未设）走原 `.tc` 源码、逐字节零影响。配套 `tools/gen_tint.py`（字符级扫描：剥离顶层 `fn` 函数体为 `;`、保留 struct/enum/variant/union/concept 体与 const/var/type/@import；内层 brace 匹配须跳过串/注释否则串内 `{}` 错配）。生成 `out/mod/*.tint`（除 `std.rc.cst`/`repl` 外全部 17 个 src 模块）。
  - **实测（同二进制 `out/dbg/tc_new.exe`，`check src/tc.tc`）**：无 tint 基线峰值 **2.66 GiB** / exit 0 / 629 warnings；设 `T_TINT_DIR=out/mod` 后峰值 **0.99 GiB** / exit 0 / 629 warnings（诊断逐字节一致 → 接口文件语义等价）。**`check` 峰值从 2.66→0.99 GiB（−63%，已低于 1.5GiB 目标）**。
  - **⚠ 关键边界**：阶段 B 仅降 **`check`（语义分析）** 峰值；`build`（codegen+链接）因需被依赖模块**完整实现**以发射代码，接口文件无法替代 → `build` 峰值**不受阶段 B 影响**（见下）。
- **`build` 峰值实测（2026-10-24，同二进制无 tint）**：`tc build src/tc.tc --mode dbg` 峰值 **5.63 GiB**（= check 2.66 + codegen IR ~3GiB）。这才是真实自举（`tc build`）峰值，亦是须被 §5.3 有界化的对象。**阶段 B 对 `build` 无助**，必须由阶段 C（逐模块分进程编译 + 链接）解决：每模块进程仅建本模块图 + 极小接口 + 本模块 codegen，峰值有界 ≈ 0.99GiB 量级。
- **阶段 C（逐模块分进程编译 + 链接 + per-module ginit 分裂）🔧 实现中（2026-10-24）**：
  - **编译器侧改动（sema/tir/tir_to_ll/tc/lex）**：
    1. **per-module ginit 分裂**：`tir_emit_ginit(name, always_emit)` 改为按模块 idn 发射独立 ginit `t_ginit_<mangled_idn>`（如 `t_ginit_src_base`），不再跳过库模式；`tir_to_ll` 入口 `main` 包装器在 `t.__ginit()` 之前，对 `g_link_libs` 每个成员 `declare` + `call` 其 `t_ginit_<idn>`（顺序按依赖拓扑，子先于父）。**必要性**：`lib` 模式此前跳过 `t.__ginit`，而编译器内部模块确有运行期初始化全局（如 `pub var g_comptime_full: bool = true;`，见 `tir.tc` ginit 注释），必须 per-module 自初始化，否则全局永久为零、静默错编（即旧 §4.14.7 阻断外部库 rc.cst 预编译的根因——本改动一举解除）。
    2. **内部模块 .tlib 链接**：`handle_one_import` 对 `src.` 导入在 `loaded_tint` 时经新增 `resolve_internal_lib_archive(rel, tint_dir)`（查 `<T_TINT_DIR>/<rel>.tlib`）解析预编译产物，并注册 `g_link_libs` 存**完整 idn**（如 `src.base`，与 `in_link_libs(base.node_mod(d))` 的 node_mod 一致）使 codegen emit `declare`/跳过内联；`g_ext_link` 存 `.tlib` 路径交链接器。
    3. **`--mod-id` 与模块身份**：`tc build --lib --mod-id src.base` 新增旗标；`lib_alias = last_segment(idn)="base"`（模块值别名 + 子进程重整末段，与入口 `import(src.base)` 的 alias 一致），`lex.g_lib_mod_idn = "src.base"`（完整 idn，供 ginit 符号名），解析期 `base.g_cur_mod = g_lib_mod_idn`（符号 node_mod 落 `src.base`，与模块值键一致，使 base.xxx 自引用可解析），并手动 `sema.g_modval_set(lib_alias, g_lib_mod_idn)`（独立编译时本模块是入口而非被导入，否则缺模块值）。
  - **工具链**：`tools/gen_tint.py`（已修串/注释 brace 跳过 + decl 种类单次识别）、`tools/_mempeak2.py`（MEMPEAK_LOG）、**`tools/bootstrap_tc.mjs`**（外部库先预编译 mem/math/rc.cst/repl → out/lib/；再拓扑序逐内部模块 `build --lib --mod-id src.<m>` 出 out/mod/<m>.tlib；末步 build 入口 src/tc.tc 链接全部 .tlib；fixpoint 保证依赖先于依赖方）。
  - **POC 验证（bool/int/string 全局跨模块初始化）✅**：构造 `src.poclib.tc`（`pub var g_flag/i64/string = ...`）+ 入口 `examples/poc_entry.tc`（`import("src.poclib")`）。`build --lib --mod-id src.poclib` 出 `out/mod/poclib.tlib`（含 `t_ginit_src_poclib`，正确 emit i8 1 / i64 42 / TStr 常量回填）；入口 `T_TINT_DIR=out/mod build` 载 `.tint` + 链接 `.tlib`，运行输出 `num=42 str=hello flag=1`，与单进程基线逐字节一致。**证毕 per-module ginit + 接口文件外链 + .tlib 链接端到端成立。**
  - **⚠ 已知前置坑（已定位/规避）**：① 函数值全局（`var x: fn()R = @f`）的 ginit 在 `tir_emit_ginit` 有**既存 codegen bug**（`store ptr %llt5, ptr %llt5` 自写、GEP 结果 llt4/llt7 未用），与阶段 C 无关；编译器内部模块无此类全局（已 grep 确认无 `var = @fn` / `var : map[`），故不影响自举。② 独立编译入口缺模块值 → 已用 `g_modval_set` 补登记。③ 重建 `tc_phc.exe` 须输出到临时名再 `mv`（Windows 锁定运行中的自身二进制）。
  - **待办**：跑通 `bootstrap_tc.mjs` 全量（17 内部模块 + 4 外部库 → tc_pc.exe），复测每子进程 `build` 峰值（目标 ~1.5GiB）、自举不动点 g2==g3==g4、等价性（诊断逐字节一致）、gate L2。
- **阶段 D（门禁 + 收尾）**：`gate L2` 改走多进程路径；复测每子进程峰值（目标 ~1GiB 有界）；`ir_snapshot` 0 NEW/0 GONE；提交 wb。

**风险**：模块依赖若存在环，需接口桩（先 emit 签名 .tlib 再补体）；链接器需正确处理跨模块 `@main`/全局符号；C 后端（`tmir-c`）须同步支持分模块 emit。阶段 A 先确认 DAG 无环再动手 B。

## 附录 A：Zig 0.17 vs t 内存模型对照

| 维度 | Zig 0.17 | t（当前 + 目标） |
| --- | --- | --- |
| 同寿分配 | `Compilation.arena` | `g_arena` |
| 临时/开发分配器 | `gpa`（GPA，带检测） | `mi_malloc`（bump 物理来源） |
| 语义去重 | `Zcu.InternPool`（类型+值） | `sym32`（仅字符串/符号）→ 目标 `g_sema_pool`（+类型） |
| 解析产物 | AST 临时 arena，ZIR 生成后释放 | `g_parse` 同理（`arena_reset_parse`） |
| 语义图生命周期 | 按 decl 惰性 + 可失效 | 整模块常驻 → 目标 per-decl 窗口 |
| 回收粒度 | arena 整块 + 增量失效 | bump 整块（`arena_reset_*`）+ mark/reset |

## 附录 B：实测基线（2026-10-23，修正版）

- 工具：`tools/_mempeak2.py`（读 `PrivateUsage` via ctypes+psapi，免 psutil）；`T_MIHIST=1` 抓调用方直方图。
- **修复前**（LLVM 后端全局数组降级堆拷缺陷未修）：
  - `tc check src/tc.tc` → **19.80 GiB**（其中大头是后端降级 bug，非 sema 地板）。
  - `tc emit-ll src/tc.tc` → **22.75 GiB**（IR 54.7 MB）。
- **修复后**（§3.5 切片视图修复，`5a4c55d`）：
  - `tc check src/tc.tc` → **PEAK_WS≈2.49GB / PEAK_PRIVATE≈2.61GB**（约降 8.8×）。
  - MIHIST `sz=6448/5528` 出现 0 次；`conformance` 373/373；`gate L2` 24/24。
- 字符串驻留 / arena 基础设施改动后：峰值**不变**（中性），IR 字节一致。
