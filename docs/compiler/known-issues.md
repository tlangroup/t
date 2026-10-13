# 编译器已知缺陷与修复待办（Known Issues）

> 本文登记当前构建中**已确认、待修复**的编译器缺陷，每条附**可复现用例**与**修复验收标准**，供后续排期与回归核对。
> 关联文档：`docs/code-style-guide.md`（§1 后端状态注记，记录用户侧临时绕过写法）、`docs/compiler/pipeline-review.md`（审查维度 D1–D8，其中 D2 IR 架构 / D7 正确性验证直接受此类前后端契约缺口影响）。

## 0. 约定

- **状态**：`open`（待修）/ `fixing`（进行中）/ `closed`（已修并回归通过）/ `unreproducible`（有历史现象、当前复现不出，**不**排修复工时）/ `refuted`（历史现象仍在，但**原归因已被证伪**，保留证据防回潮）。
- **构建版本**：缺陷以 `out/rls/tc.exe`（2026-09-03 构建）复现；**已修复验证基准为 `out/dbg/tc.exe`（2026-09-05 02:19 构建，含 `fb6eeaf`）**——该构建下 KI-001/KI-002 复现用例 `tc run` 均通过。
- **复现用例位置**：`tests/known-issues/`（本目录**不被** `conformance`/`difftest`/`ir_snapshot` 自动扫描，避免污染自举不动点与 IR 基线；仅作手动修复回归）。
- **验收命令**：`tc run tests/known-issues/<file>.tc` 应正常退出且无 LLVM IR 报错，输出与「期望」一致。
- **维度绑定**：此类「前端 `tc check` 接受、后端 `tc run` 拒绝」的缺口，本质是**前端/后端 IR 契约不一致**（D2），属正确性验证（D7）的边界，修复应纳入 BP-1 正确性门禁。

## 1. 缺陷清单（速览）

| ID | 标题 | 类别 | 构建版本 | 状态 | 严重度 | 复现用例 | 期望 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **KI-001** | variant 直接字面量 `.Circle(5)` LLVM 代码生成缺陷 | codegen（variant） | 2026-09-03 | **closed** | 高 | `tests/known-issues/KI-001_variant_anon_literal.tc` | `tc run` 输出 `5` |
- **KI-002**：struct / 元组字面量模式 `Pt{ x: 0, y: 0 }` / `.{1i64, "a"}` 在 LLVM 轨条件被丢弃 → **恒命中首臂**（静默错编；C 轨正确） | codegen（LLVM 轨 match 解构） | 2026-09-03 登记，`fb6eeaf` 误记已修 | ✅ **closed**（2026-09-26 元组特性一并修复） | 高 | `tests/known-issues/KI-002_struct_literal_pat.tc` | `tc run` 输出 `0`（C 轨 `0`，LLVM 轨原 `1` → 修复后 `0`）
- **KI-003**：packed struct 位域（P7 起取代 `flag`）运行期读写 —— 原 `flag` 位域因 runtime 缺 `t_flag_get/t_flag_set` 链接失败，改 `packed struct` 后双后端可链接可运行 | runtime / codegen（位域） | 2026-09 | ✅ **closed** | 中 | `tests/known-issues/KI-003_flag_bitfield_runtime.tc` | 输出 `r=1 w=0 level=5 owner=7`
- **KI-004**：f-string `!j`（JSON）在 LLVM 后端对**切片字段之后**的 f64/bool 取值错编（偏移量算错） | codegen（LLVM 轨 struct 布局） | 2026-09-28 | ✅ **closed**（已从 `SMOKE_SKIP` 移除） | 高 | `tests/known-issues/KI-004_fstring_json_llvm.tc` | 双后端逐字节一致（`score` 1.5 / `ok` true）
- **KI-005**：device 示例端到端对拍失败（LLVM 后端缺 device 发射 + cpu-emu 解释器 3 处解析 bug） | codegen（device 子系统） | 2026-09-28 | ✅ **closed**（子系统本体） | 高 | `examples/_cpuemu_check.tc` / `examples/vecadd_device_full.tc` | 内核执行 rc=0、不再 segfault
- **KI-006**：LLVM 后端 f32（窄元素）堆数组元素运行期索引 `store` 不落盘（序言预扫描把 `GEP_IDX` 结果槽按**元素类型**分配，实际承载 8B 指针 → 写穿） | codegen（LLVM 轨槽宽） | 2026-09-28 | ✅ **closed**（device 示例 LLVM 单后端已过；C 后端 device 运行时仍待修，两示例保留 `SMOKE_SKIP`） | 高 | 见 `KI-006_f32_heap_array_store.md` | `ha[k]=k` 循环后读回正确
- **KI-007**：`[]u64` 全局切片（侧表形态）跨模块 codegen 缺陷 —— 历史现象为 `g_node_flags: []u64` 时 `check src/tc.tc` 爆 14211 条 `T-MOD-E558`；**2026-10-14 已证伪**：两版只差元素类型的编译器对同一输入的 IR **逐字节相同**，u64 版自举两轮全绿 | 归因错误（非 codegen） | 2026-10-13 登记 | ✅ **refuted**（原归因证伪，**不**排修复工时） | 中 | `tests/known-issues/KI-007_u64_global_slice.md`（证据 + 一键复现脚本）+ `.tc`（玩具用例） | 见 §5.2 三条铁证 |

## 2. KI-001 · variant 直接字面量（匿名字段字面量）代码生成缺陷

- **现象**：`variant Shape { Circle(i64); ... }` 定义后，使用**直接字面量** `.Circle(5)`（原登记时为裸 `Circle(5)`，修复后两种写法 `tc run` 均通过）经 `tc check` 通过，但 `tc run`（LLVM 后端）失败。
- **精确报错**（`out/dbg/KI-001_variant_anon_literal.ll:209:29`）：
  ```
  error: integer constant must have integer type
    %t0 = load %vt.Shape, ptr 0
  ```
- **根因假设**：直接字面量 `Circle(5)` 在 LLVM 发射阶段被错误处理为「从空指针 `ptr 0` 加载」，而非（1）在栈/常量区构造具名变体值（tag + 载荷）并（2）取其地址后 load。空指针被 clang 判为 `integer constant`，类型不符报错。
- **影响范围**：所有「和类型 + 直接字面量 + match 解构」端到端运行路径，含 `variant` 单/多载荷变体（`.Circle(r)` / `.Rect(w, h)` / 单元 `.Empty`）。
- **用户侧临时绕过**（见 `code-style-guide.md §1`）：改用兼容构造器 `Shape_from_Circle(5)`（仍被 `tc check` 与 `tc run` 同时接受）。该构造器由 `tests/variant_smoke/main.tc` 冒烟覆盖。
- **修复方向**：LLVM 后端对 variant 直接字面量节点，按「构造变体值 → 取地址」发射，与 `Shape_from_*` 构造器复用同一 IR 生成路径；match 解构侧不变（其绑定 `.Circle(r) => r` 已正确）。
- **验收标准**：`tc run tests/known-issues/KI-001_variant_anon_literal.tc` 退出 0、无 LLVM IR 报错、stdout 含 `5`。
- **✅ 已修复（2026-09-05 02:19 构建，提交 `fb6eeaf`）**：`out/dbg/tc.exe run tests/known-issues/KI-001_variant_anon_literal.tc` → 退出 0、无 IR 报错、stdout 输出 `5`。前导点 variant 构造器 `.Circle(5)` 亦于同提交 `T-DOT-E102` 解除后可用。复现用例保留为回归测试，**不再需要**兼容构造器 `Shape_from_Circle` 绕过。状态 → `closed`。

## 3. KI-002 · struct 字面量模式在 match 中的代码生成缺陷

- **现象**：`struct Pt { x: i64; y: i64; }` 定义后，用 **字面量模式** `match (p) { Pt{ x: 0, y: 0 } => 1, _ => 0 }` 经 `tc check` 通过，但 `tc run`（LLVM 后端）失败。
- **精确报错**（`out/dbg/KI-002_struct_literal_pat.ll:155:21`）：
  ```
  error: '%v._tms1' defined with type 'ptr' but expected 'i64'
    %t3 = icmp eq i64 %v._tms1, %s0
  ```
- **根因假设**：match 解构得到的字段绑定 `%v._tms1`（struct 字段）在 LLVM 发射时被定义为 `ptr`（值即指针），却以 `i64` 直接参与 `icmp eq` 比较，发生指针/整数类型错配；应为「对 ptr 做 `load i64` 后再比较」。
- **影响范围**：所有「struct + 字面量模式 match」端到端运行路径（字面量模式含具名字段 `Pt{ x: 0, y: 0 }`；绑定模式 `Pt{ x: a, y: b }` 在 `tc check` 阶段即 `T-SEM-E201` 未支持，属独立 sema 缺口，不计入本 codegen 缺陷）。
- **用户侧临时绕过**（见 `code-style-guide.md §1`）：struct 改用**字段访问 + `if` 比较**，避免字面量模式解构：
  ```t
  fn at_origin(p: Pt) i64 {
      if (p.x == 0 && p.y == 0) { return 1; }
      return 0;
  }
  ```
- **修复方向**：LLVM 后端对 match 字面量/绑定模式解构出的 struct 字段绑定，发射 `load` 取字段值后再参与比较/绑定（与字段访问 `p.x` 复用同一取址路径）；同时评估是否一并放开绑定模式 `Pt{ x: a, y: b }` 的 sema 支持。
- **验收标准**：`tc run tests/known-issues/KI-002_struct_literal_pat.tc` 退出 0、无 LLVM IR 报错、stdout 含 `0`。
- **⚠ 状态回退为 open（2026-09-25 复确认）**：曾经记录的「`fb6eeaf` 已修复」结论在 LLVM 轨上**不成立**。

### 3.1 KI-002 复证实录（2026-09-25，基准 `out/dbg/tc.exe` · `2a3c4b6`）

- **现象（已变）**：不再是 IR 类型错配导致的链接/校验失败，而是**静默错编** —— struct / 元组字面量模式的判别条件在 **LLVM 轨被整体丢弃**，第一条 arm **恒命中**；**C 轨（`tc compile --emit-c` + clang）语义正确**（逐字段相等比较）。复跑 `tests/known-issues/KI-002_struct_literal_pat.tc`：期望 `0`，LLVM 轨实测 **`1`**，C 轨实测 **`0`**。
- **IR 证据**：`tc emit-ll` 产物中 `at_origin` **不含任何 `icmp`**，入口直接 `br label %at_origin.Lm.b1`，第二块（`_` 兜底臂）**无前驱**为死块 —— dispatch 退化为无条件跳转。对照 C 产物是正确的 `if (((_tms1.x == 0) && (_tms1.y == 0))) {…} else {…}`。
- **归属（已交叉复验）**：用 **`2a3c4b6^`（`0b212ac`，元组特性的上一个提交）源码独立重建编译器**跑同一用例，输出同为 `1` ⇒ **与 2026-09-25 的元组 / `.x=` 特性无关**。回归窗口为 `fb6eeaf..0b212ac`（约 123 个提交）；该时期源码在当前方言下无法被重建（旧源码触 `T-SEM-E201`），故当年「已修复」是否为误判、以及精确 culprit，需按此窗口二分。
- **实测矩阵**（详见 `docs/syntax/drafts/match.md` §6.3）：仅在「应当不匹配」的分叉上暴露（`Pt{ x: 0, y: 0 }` vs `Pt{ .x = 1, .y = 2 }`；元组同 `.{1i64, 9i64}` vs `.{1i64, 2i64}`），全匹配场景侥幸正确，故极易漏测。
- **相关静默（同路径）**：struct 字面量里的**未知字段名 / 未定义标识符不发诊断** —— `Pt{ zz: 0 }`、`Pt{ x: zzz, y: 0 }` 均 `tc check` 通过；后者在 C 轨会一路发射到 clang 才报 C 未定义符号。建议与 KI-002 一并修（sema 侧补校验）。
- **为何门禁未拦住**：`tests/known-issues/` 不被 conformance / difftest / run_examples 自动扫描（本文件 §0 约定），`examples/` 全仓无「struct/元组字面量模式 + 运行期判别」用例 ⇒ 该路径运行期零覆盖。
- **待办**：① 修复 LLVM 轨 struct_lit 模式的逐字段比较发射；② 补 sema 诊断（未知字段 / 未定义标识符）；③ **把该用例挪进 `examples/` 常规门禁**（建成前须用修复前的编译器确认会失败，避免空跑）；④ 必要时二分定位 `fb6eeaf..0b212ac` 的 culprit。

### 3.2 ✅ KI-002 已修复（2026-09-26，元组特性 #2 一并落地，提交 wb）

- **根因（确定）**：`tir_match_pattern_cond` 对 `struct_lit` 模式**无分支** → 返回空条件串 → dispatch 退化为无条件跳转恒命中首臂（§3.1 的「IR 证据」正是此根因，而非早先假设的 load/icmp 类型错配）。
- **修复**：`src/tir.tc` 的 `tir_match_pattern_cond` 增补 `struct_lit` 分支，复用 `tir_member_addr` 同款配方（`ADDR_OF` 结构值 → `GEP` 前导 `0` + 字段下标 → `LOAD`）逐字段 `icmp eq` + `AND` 合成非空条件链，对齐 C 后端 `match_chain_from` 的 struct_lit 比较发射。
  - ⚠ **关键坑**：`ADDR_OF` 的 `st` 必须 `ptr<%Pt>`（带 `%`），否则 `ll_ptr_inner` 退化成无 `%` 的 `Pt` → GEP 基类型非法 → LLVM `error: expected type`。命名结构（`sa` 非空）与匿名元组（由 `scr_td` 名反查合成结构名）均覆盖。
- **验收（双后端一致）**：
  - `tests/known-issues/KI-002_struct_literal_pat.tc`：`tc run`（LLVM 轨）退出 0、无 IR 报错、stdout = `0`（修复前 `1`）。
  - 新增 `examples/tuple_match_demo.tc`（+ `.expected.txt`）：含命名结构模式 `Pt{ x: 0, y: 0 }`、具名元组合成结构 `_0/_1` 模式 `IntPair{ ._0 = 0, ._1 = 0 }`、部分字段模式、多臂 + 兜底 `_`，经 `node tools/run_examples.mjs` **双后端逐字节一致 PASS**。
- **待办 ②（sema 诊断：未知字段 / 未定义标识符）仍未做**，属 §14.2 解构绑定特性的独立子项，本轮未一并补；③ 已通过新增 `examples/tuple_match_demo.tc` 达成「挪进常规门禁运行期覆盖」。

## 4. 修复排期建议

- **优先级**：KI-001 **closed**（`fb6eeaf` 构建，`KI-001_variant_anon_literal.tc` `tc run` 输出 `5`）；**KI-002 ⚠ reopen** —— 2026-09-25 双后端对拍确认 LLVM 轨仍错编（详见 §3.1）。二者均为高优先：KI-002 属**静默错编**（不报错、结果错），比链接失败更危险，建议排到 KI-001 之前。复现用例保留于 `tests/known-issues/`，并建议同步进 `examples/` 常规门禁。
- **KI-003 ~ KI-006 已闭环**（详见 §1 速览表）：KI-003 位域随 P7 `packed struct` 一并修复；KI-004 `!j` 切片字段后偏移错编已修、已从 `SMOKE_SKIP` 移除；KI-005 device 子系统本体（LLVM 发射 + cpu-emu 解释器）已修；KI-006 LLVM 轨 `GEP_IDX` 结果槽宽已修。仅 KI-005/006 的两条 device 示例因**C 后端 device 运行时**仍 segfault 而保留 `SMOKE_SKIP`。
- **KI-007 不排期**：状态 `refuted`（§5）—— 原归因「`[]u64` 切片 codegen 缺陷」已被三条独立证据证伪（自举两轮全绿 / IR 层无 u64/i64 之分 / 两版编译器产物逐字节相同）。**不要**为了验证这个不存在的缺陷去改 `src/base.tc`。若将来真出现「标志位读回恒为默认」类雪崩，去查打包时的**伴随改动**（访问器改写 / 常量类型 / append 初值传播），而非元素类型。
- **前置（修复时已完成）**：修复落在「双后端一致」约束内——C 后端（`codegen_c`）须同步验证；`tc run` 验收即双后端一致证据。后续若改动相关 codegen 路径，复跑 `node tools/gate.mjs L2` 保自举不动点，并视情况将两用例纳入 `tests/variant_smoke` 自动回归。
- **关联待办（非本次范围）**：struct match 绑定模式 `Pt{ x: a, y: b }` 的 sema 支持（当前 `T-SEM-E201`）仍开放，建议单独排期评估放开。

## 5. KI-007 · `[]u64` 全局切片（侧表形态）跨模块 codegen 缺陷 —— ✅ **已证伪（refuted）**

> 完整记录与一键复现脚本见 `tests/known-issues/KI-007_u64_global_slice.md`；玩具用例
> `tests/known-issues/KI-007_u64_global_slice.tc`（`pub` 全局 `[]u64` 与 `[]i64` 混排 +
> `pub` 访问器读写位掩码）。本节只留结论与判据。

### 5.1 历史现象（2026-10-13）

节点侧表位打包（提交 `1693168`）首次引入 `pub var g_node_flags: []u64`，gate L2 跑出
**19/6**：`check src/tc.tc` 爆 **14211 条 `T-MOD-E558`**。现象上「已置位」的标志全部
读回默认值 ⇒ `bc`(pub) 恒 false ⇒ 全部声明被判私有 ⇒ 雪崩。当时逐项排除的玩具用例
（`append`/`slice_set`/索引/`slice_len`/位运算/大索引）**全部正确**，唯独真实自托管
路径失败，遂归因为「编译器 `[]u64` 切片 codegen 缺陷」，并以改回 `[]i64` 规避。

### 5.2 证伪实验（2026-10-14，HEAD `1693168`）

按当时形态精确还原 u64 版 `src/base.tc`（`[]u64` 切片 + 12 个 `var F_*: u64` +
`append(...,7)` + `(g_flags[id] & F_X) != 0`），与 i64 版做**同种子对照**：

**① 运行级 —— u64 版自托管链全绿**

| # | 命令 | 历史期望 | 实测 |
|---|---|---|---|
| 1 | `out/dbg/tc.exe check src/tc.tc`（种子编译 u64 版源码） | — | **0 error** |
| 2 | `out/dbg/tc.exe build src/tc.tc --output out/dbg/g1u` | — | 成功（md5 `fc56a55f…`） |
| 3 | `g1u.exe check src/tc.tc`（**历史失败点**） | 14211 条 E558 | **0 error，0 条 E558** |
| 4 | `g1u.exe build src/tc.tc --output out/dbg/g2u` | — | 成功（md5 `37b428df…`） |
| 5 | `g2u.exe check src/tc.tc` | — | **0 error** |

玩具用例双后端（LLVM `tc run` / C `--emit-c` + clang）逐字节一致且为期望值
`flags_a=7 bc_a=0 flags_b=15 bc_b=1`。

**② 原理级 —— LLVM IR 里 `u64` 与 `i64` 本就无差别**

切片读写**不走**直接 GEP/load/store，而是全部经 runtime 函数：

```
call ptr @tll_slice_at(ptr @g_flags, i64 %idx)      ; 取元素地址
call i64  @tll_slice_len(ptr @g_flags)               ; 长度
call void @tll_slice_set(ptr @g_flags, i64 %i, ptr %v) ; 写入
```

且 LLVM 的整数类型**不区分有/无符号**——`u64` 与 `i64` 都落成 `i64`，差异只在
`udiv/sdiv`、`lshr/ashr` 这类指令上体现，而位掩码访问器只用到 `and`/`or`/`xor`，
两条路径**生成完全相同的 IR**。

**③ 产物级 —— 两个只差元素类型的编译器，IR 逐字节相同（决定性）**

用**同一种子** `tc.exe` 分别构建 i64 版 `g1i`（md5 `867397f0…`）与 u64 版 `g1u`
（md5 `fc56a55f…`），再让它们编译**同一份**输入：

| 被编译输入 | `g1u.exe emit-ll` 产物 md5 | `g1i.exe emit-ll` 产物 md5 | diff |
|---|---|---|---|
| `tests/known-issues/KI-007_u64_global_slice.tc` | `df4219d2…` | `df4219d2…` | **0 行** |
| `src/tc.tc`（真实自托管规模，4 万+ 节点） | `8a010ea3…` | `8a010ea3…` | **0 行** |

编译器自身侧表是 `u64` 还是 `i64`，**对它产出的 IR 一个字节都没有影响**。

### 5.3 结论（已证伪）

**原归因「编译器 `[]u64` 切片 codegen 缺陷」不成立。** 「把 u64 改成 i64 程序就通过了」
是**把相关性误判为因果**：`u64 → i64` 的回退同时带走了真正的病灶（打包时一起落地的
访问器改写 / 常量类型 / `append` 初值传播路径中的某处），元素类型本身是清白的。

三条证据互相独立且一致：u64 版自举两轮全绿（运行级）／IR 层无 u64/i64 之分（原理级）／
两版编译器产物逐字节相同（产物级）。

**处置**：状态 `refuted`，**不**排修复工时；生产代码维持 `[]i64`（内存收益相同，
无动机改回）；本条保留的目的是**防止后来者再去 codegen 里挖这个不存在的缺陷**。
若将来真出现「标志位读回恒为默认」类雪崩，应去查打包时的**伴随改动**，而非元素类型。

### 5.4 ⚠ 复现时的两个坑（本次踩过）

1. **`src/base.tc` 是 CRLF 文件**（不是 LF）：Python 改写必须 `newline=''` 读 + 原样写回；
   用 `newline='\n'` 读会让 `^…;$` 类正则失配，表现为「改了 0 处」却不报错。
2. **缺陷不在 `check` 步暴露**：用正确的种子编译器 `check` u64 版源码是 **0 error**，
   必须**用 u64 版源码构建出的 `g1u`** 再 `check` 才是历史失败点（第 3 步）。
   只看第 1 步会得出"没问题"的假阴性。

## 6. 变更记录

- 2026-09-04（续 10）：由 `docs/code-style-guide.md` §1 后端状态注记中披露的两处 codegen 缺陷，登记为本文件 KI-001 / KI-002，附 `tests/known-issues/` 复现用例与验收标准。
- 2026-09-04（续 11 · 前导点语法）：前导点提交 `9224f06`(`.{...}` 匿名结构体字面量)/`898de07`(`.Red` match 臂) 落地后，复用 `out/dbg/tc.exe` 23:38 构建**复核 KI-001/KI-002 仍 open**（报错一致，未随前导点提交修复）；同时确认前导点语法仅覆盖 struct `.{...}` 与 enum `.Red`，**variant 构造器前导点 `.Circle(5)` 报 `T-DOT-E102` 尚不支持**——已同步写入 `code-style-guide.md §1`。
- 2026-09-05（续 12 · KI-001/KI-002 修复闭环）：用户确认「001、002 具名结构体已通过、匿名结构体字面量也通过」。复用最新 `out/dbg/tc.exe` 02:19 构建（含 `fb6eeaf` fix(variant): 前导点变体构造器在 match 臂与值位的正确脱糖）复跑复现用例：`KI-001_variant_anon_literal.tc` → stdout `5`、无 IR 报错；`KI-002_struct_literal_pat.tc` → stdout `0`、无 IR 报错。两缺陷状态置 `closed`；前导点 variant 构造器 `.Circle(5)` 同提交解除 `T-DOT-E102` 后可用。`code-style-guide.md §1/§5/后端注记` 同步去除 KI 绕过写法、`docs/INDEX.md` 追加续 12 变更日志。
- 2026-10-14（台账补全 + KI-007 立项）：补齐此前只存在于 `tests/known-issues/` 而**未登记进本文**的 KI-003（packed struct 位域）/ KI-004（f-string `!j` 切片字段后偏移）/ KI-005（device 子系统）/ KI-006（LLVM `GEP_IDX` 结果槽宽），状态一并核对；新增 §0 的 `unreproducible` 状态位与 §5 KI-007 —— 用户裁定「`[]u64` 全局切片跨模块 codegen 缺陷应另立项修复，未来任何 `[]u64` 侧表用法都会触发它」。立项后跑了三组对照，最终**证伪**原归因：① 运行级——还原 u64 版 `src/base.tc` 后自举两轮全绿、历史失败点 `g1u check src/tc.tc` = 0 error（历史为 14211 条 E558）；② 原理级——切片读写全走 runtime 函数（`tll_slice_at/len/set`），且 LLVM 整数不区分有/无符号，`u64`/`i64` 同为 `i64`；③ 产物级（决定性）——同种子构建的 `g1u`（md5 `fc56a55f…`）与 `g1i`（md5 `867397f0…`）编译**同一份** `src/tc.tc`，IR 逐字节相同（md5 `8a010ea3…`，diff 0 行）。结论：「把 u64 改成 i64 程序就通过了」是**相关性误判为因果**，回退时顺带带走了打包的其它伴随改动。状态 `refuted`，不排修复工时。原 §5 变更记录顺延为 §6。
