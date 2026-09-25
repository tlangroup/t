# T 语言文档目录（docs/ 二级结构）

> 本文件是 `docs/` 的二级目录清单与放置约束。新增任何文档前先查本表，放到对应子目录；不要再把文档平铺在 `docs/` 顶层。

---

## 1. 二级目录清单

| 目录 | 用途 | 放置内容 |
|---|---|---|
| `docs/compiler/` | **编译器架构与设计** | 编译管线、IR（含 TIR）、代码生成（C/LLVM/…）、设备·GPU、CTFE·编译期求值、元编程设计 |
| `docs/laws/` | 语言法则 | 语言宪法与各项法则（`L-02`~`L-15`、`general.md`） |
| `docs/presentation/` | 演示与汇报 | 架构图、汇报页（HTML/JSON、dataflow 等） |
| `docs/syntax/` | 语法规范 | 语法 EBNF、草案（`drafts/`） |
| `docs/`（顶层，待进一步归类） | 语言与工具文档 | 语言参考 `reference.md`、标准库 `std.md`、规范 `spec.md`、诊断 `diagnostics.md`、REPL `repl.md`、notebook `notebook.md`、bootstrap `bootstrap.md`、宪法 `constitution.md`、总设计 `design.md`、agent `agent_first.md`、f-string `fstring.md`、gap 扫描 `gap-scan-*.md` |

---

## 2. 放置约束（写文档前必读）

1. **编译器内部设计文档一律进 `docs/compiler/`**，不要再放 `docs/` 顶层。已迁移：`tir-design.md`、`compiler-pipeline-design.md`、`device-design.md`、`comptime-design.md`、`meta_design.md`、`meta_target.tc`。
2. **语言法则进 `docs/laws/`**；**语法规范/草案进 `docs/syntax/`**；**演示/汇报产物进 `docs/presentation/`**。
3. **`docs/` 顶层只保留尚待归类的语言/工具类文档**（参考、标准库、规范、诊断、REPL 等），后续可再拆 `docs/lang/`、`docs/tooling/` 等。
4. **文档间互引用仓库根相对路径**（如 `docs/compiler/tir-design.md`），不要用 `./xxx.md` 同级相对路径——这样文档移动后引用仍成立。
5. **改动文档路径后，必须同步更新所有引用点**：`grep -rn '旧路径' .`（排除 `out/`）后统一改写，覆盖 `src/`、`tools/`、`runtime/`、`examples/`、`tests/`、`docs/`。

---

## 3. `docs/compiler/` 当前文件

| 文件 | 内容 |
|---|---|
| `compiler-pipeline-design.md` | 新一代编译管线总设计（HIR→MIR→TIR→多后端→全局优化），TIR 的上位设计 |
| `cst-design.md` | **CST / AST 节点规格**（前端节点层，补此前缺失）：Lexer(token 流/`kw_reg` 关键字表) → Parser(扁平节点池 `nodes[]`+`Child` 池 `kids[]`/`Node` 字段表/`la-lb-lc` 列表头/溯源 `g_node_mod`+`g_node_file`/锚点 `ln-cl-tv`/节点种类分类表 grounded in `parse.tc` 真实 kind/`mk_*` 构造器) → CST→HIR(AstGen) 降级契约 / 与 syntax 文档(`reference.md`/`spec.md`)分工 |
| `pipeline-review.md` | **专家复审与优化方案**（2026 视角，对标 2020+ 前沿）：肯定现有设计 + 列 12 项缺口（G-1~G-12）+ 修订管线图 + P0~P4 优先级 + 对现有文档的修订建议 |
| `tir-design.md` | TIR：类型擦除的线性后端桥 IR 规范（ST 格 / 指令集 / 降级规则 / 双后端变薄）。**§15 规格 5 项已全部拍板**（ST 命名 / `T?` ABI 分期 / memory-first / 双序列化格式 / 模块边界） |
| `ir-taxonomy.md` | **IR 分层对位与命名裁定**（T vs Zig ZIR/AIR、Rust MIR/`codegen_ssa`、Swift SIL）；「某级 IR 对应别的语言哪一级」的唯一依据 |
| `device-design.md` | Device 子系统（GPU/TPU/NPU，v1=NVIDIA PTX）底层设计 |
| `comptime-design.md` | CTFE·编译期求值设计（**v0.2 已重构为 HIR 解释视角**：语义=B 式弥漫折叠/类型即值/护栏不变；求值 substrate 由 AST `nodes[]` 树改为 HIR(ZIR) 指令流解释器；新管线图 `CST→AstGen→HIR→sema+CTFE(解释HIR)→MIR→TIR→后端`；legacy AST 实现经验保留 §8 对照；迁移 Phase0(AST)→Phase A(HIR 解释器, 双版对拍)→B+） |
| `meta_design.md` | 元编程（`comptime` / 类型即值）设计 |
| `meta_target.tc` | 元编程设计用例（对应 `meta_design.md`） |
| `mir-design.md` | **MIR 中层 IR 规格**（CFG+SSA+φ / 可选 drop·borrow-verify G-7 / 中端优化 pass 清单 G3 / 与 HIR·TIR 边界 / 读 target_desc / 对位 Rust MIR·Go SSA·Swift SIL low） |
| `decl-data-design.md` | **数据声明设计（struct / enum / variant + union / flag）**：在管线各层（CST→HIR→MIR→TIR→后端）的形态与层间降级契约；后端发射 grounded in `codegen_c.tc`/`codegen_ll.tc` 实际代码；**TIR 层 TT 表项（union 无 tag、variant tag=i32 默认）的唯一权威**；§11 八项开放问题已逐条拍板（匿名结构类型/MIR+TIR 合成名、泛型实例 `%Name_键`、否决 enum payload、tag 默认 i32+`@repr` 缩小、递归 variant 显式 *T、默认保持声明序+`@layout(reorder)`、补齐 variant 穷尽性、空 struct 1B 占位+单 case variant=tag 宽） |
| `tmi-design.md` | **`.tmi` 模块接口制品规格**（typed 接口 G-2 / 与 HIR 缓存 pre-type 分离 / API 指纹失效键 / 文本+二进制 round-trip / 对位 Rust rmeta·C++20 .ifc·Swift .swiftmodule） |
| `driver-query-design.md` | **Driver/Query/Scheduler 横贯层规格**（G-1 P0 / salsa 式查询依赖图 / red-green 指纹 / 分片内容寻址缓存 / work-stealing 三档并行 / 持久会话入口 / 对位 Rust 2024 并行前端） |
| `linker-opt-design.md` | **链接与全局优化规格**（CGU 划分 / ThinLTO / PGO 插桩+采样 / BOLT / 跨模块摘要缓存 增量 LTO G-5 / IR 级 FDO 布局 G-11） |
| `target-desc-design.md` | **`target_desc` 目标特征矩阵规格**（G-10 / ISA·对齐·ABI·向量·地址空间 SSoT / MIR 优化·TIR ABI·后端选择读取 / 对位 LLVM target triple·MLIR target desc） |
| `backend-design.md` | **后端层 / `BackendTraits` 规格**（对标 rustc_codegen_ssa / 薄翻译 tir→c·ll·cranelift·wasm(Component Model+WIT G-3)·spirv device 路径） |
| `persistent-session-design.md` | **持久会话 / JIT 规格**（G-4 / REPL·Notebook 增量 / 消费 HIR 缓存+`.tmi` / 热重编·增量代码替换 / 持久查询上下文） |
| `wasm-component-design.md` | **WASM Component 设计**（BP-2 / G-3 / D4-3 ⊕ D7-10 ⊕ D8）：Component Model 接口发射(Canonical ABI·`.wit`+`wasm-tools component new`) + 沙箱隔离属性验证(vWasm 式 ABI 闭环/内存边界/无裸指针逃逸，作为组件发布阻断门禁) + 供应链信任绑定 |
| `diagnostic-ir-design.md` | **诊断 IR 设计**（G-9 / D5-1 ⊕ D7，原 P4 提至 P1）：跨层 span 贯通(HIR 锚→TIR→后端)、SARIF/JSON 形态、全层诊断码、LSP/CI/LLM 统一消费、误编译精准定位 |
| `supply-chain-design.md` | **供应链与交付安全设计**（审查维度 D8，最薄维度补缺）：SBOM 生成·依赖审计(D8-1)、工具链版本 pin + 可复现构建(D8-2)、产物不泄符号(D8-3)、远程缓存信任边界+签名(D8-4)、发布签名+来源追踪(D8-5/8-6)；BP-1/2/3 信任侧实体化 |
| `ci-gate-design.md` | **CI 门禁矩阵设计**（实现与 CI 接入）：把 BP-1/2/3 三向绑定落到 CI 阻断层；门禁矩阵 G-CI-1~G-CI-10（自举/IR round-trip/增量等价/缓存键闭合/CTFE fuzz/SARIF/SBOM 签名/WASM 隔离/hermetic 缓存/性能回归）、DAG 执行序、hermetic action cache(D8-4)、与 MIR 性能基线衔接；门禁脚本接口契约见 §5 |
| `perf-baseline.md` | **编译性能基线**（D3-A vs D2 张力证据）：`tools/bench_compile.mjs` 方法学 + 实测（前端+sema 中位 13ms / codegen 中位 116ms）+ MIR 落地前后 G-CI-10 对比接入（回归>10% 阻断） |
| `known-issues.md` | **编译器已知缺陷与修复待办**（续 10）：KI-001 variant 直接字面量 LLVM codegen 缺陷、KI-002 struct 字面量模式在 match 中的 LLVM codegen 缺陷；每条附 `tests/known-issues/` 复现用例 + 精确 LLVM IR 报错 + 根因假设 + 用户侧绕过 + 修复方向 + 验收标准 + 维度绑定(D2/D7) + 排期建议 |

---

## 4. 迁移记录

- 2026-09-04（续 2）：`tir-design.md` §15 全部拍板并落定 —— §5 重写 ST 格（LLVM 记号为基 + 3 处偏离 + §5.2 擦除清单）、§4.2 新增模块边界与单态化实例归属规则、§7 降级表 optional 拆 boxed/tagged 双行、§12.1/12.1b 双序列化格式 + round-trip 门禁、§13 路线增 Stage 4b 与 Stage 5+ ABI 项、§15.2 记录「`{tag,payload}` 与严格沿用现状」的实证矛盾及分期解法；记号统一为 `%`类型/`$`值/`@`符号；`compiler-pipeline-design.md §4.4` 同步裁定摘要。
- 2026-09-04（续）：新增 `hir-design.md`（HIR=ZIR 槽位规格）；`ir-taxonomy.md` 由「待裁定」升级为「已裁定 A（HIR=ZIR 槽位）」；`compiler-pipeline-design.md` §3/§4.2/§4.3/§6/§9/§11 与 `tir-design.md` §1/§3 同步重定义 HIR 为 ZIR 槽位，并标记 CTFE 重写为解释 HIR（与 TIR 落地解耦）；`docs/INDEX.md` 登记 `hir-design.md`。
- 2026-09-04：将编译器架构设计集群（`tir-design.md`、`compiler-pipeline-design.md`、`device-design.md`、`comptime-design.md`、`meta_design.md`、`meta_target.tc`）由 `docs/` 顶层迁入 `docs/compiler/`；同步改写全仓约 50 处引用（`src/`·`tools/`·`runtime/`·`examples/`·`tests/`·`docs/`），`out/` 构建产物中的旧引用未动（非源真相，会随重建刷新）。
- 2026-09-04（续 3 · 复审落编）：按 `pipeline-review.md §5` 修订建议，把「专家复审 + 12 项缺口（G-1~G-12）」落地进设计文档 —— `compiler-pipeline-design.md` §3 图加 Driver/Query/Scheduler 横贯层 + `.tmi` + `target_desc` + 跨模块摘要 + 远程缓存 + 持久会话/JIT + Component Model WASM，§4 加 §4.2b `.tmi` / §4.3b `target_desc` / §4.5 WASM 改写 / §4.6 跨模块摘要+IR FDO，§5 横切系统扩为子节（G-1~G-12 引用），§9 A 阶段升级为「AstGen + Driver/Query + `.tmi`」三件套，§11.2 改写可选 borrow-verify pass；`hir-design.md` §3 加 HIR 缓存(pre-type) vs `.tmi`(typed) 分离、§3.4/§7 同步；`tir-design.md` §4 加 `.tmi`/`target_desc` 引用、§12.2 扩快照键拆分 + 跨模块摘要键；`ir-taxonomy.md` §3 对位表补 `.tmi` 行 + 修正陈旧「ZIR 对应物目前没有」结论；`device-design.md` 加 §5.1 ML autotuning 层（G-8，对标 AutoTVM/XLA）。

- 2026-09-04（续 4 · 数据声明设计）：新增 `docs/compiler/decl-data-design.md` —— struct/enum/variant(+union/flag) 在管线各层（CST→HIR→MIR→TIR→后端）的形态与层间降级契约，后端发射 grounded in `codegen_c.tc`/`codegen_ll.tc` 实际代码；该文档是 TIR 层 TT 表项（union 无 tag、variant tag=i32）的唯一权威，并据此**纠正 `tir-design.md` §7 两处旧条目**（union 由 `struct{tag i8,...}` 改为无 tag 的 `union{...}`；variant tag 由未定宽度改为 `i32`）+ §4 示例 `%U` 行 + §5 的 ABI 事实清单「union=最大成员+tag」→「无 tag」。与既有 MIR/TIR/后端设计文档交叉引用一致。

- 2026-09-04（续 5 · 1&2&3 落编）：① 新增 `docs/compiler/cst-design.md` —— 此前缺失的前端节点层规格，grounded in `src/lex.tc`(token 流/`kw_reg` 关键字表)/`src/parse.tc`(全量节点 kind)/`src/base.tc`(`Node` 字段/`Child` 池/`mk_*` 构造器)；覆盖 Lexer→Parser→CST 存储范式(`nodes[]`+`kids[]`、la-lb-lc 列表头铁律)、溯源(g_node_mod/g_node_file)、锚点(ln/cl/tv)、节点种类分类表、CST→HIR(AstGen)降级契约、与 syntax 文档分工。② 重构 `comptime-design.md` 为 v0.2 HIR 解释视角：语义(B 式弥漫折叠/类型即值/护栏)不变，求值 substrate 由 AST `nodes[]` 树改为 HIR(ZIR) 指令流解释器；新管线图 `CST→AstGen→HIR→sema+CTFE(解释HIR)→MIR→TIR→后端`；legacy AST 实现经验(§8)保留为对照；迁移 Phase0(AST)→Phase A(HIR 解释器, 双版 gate 对拍)→B+。③ `decl-data-design.md` §11 八项开放问题逐条拍板（匿名结构类型进 MIR+TIR 合成名/泛型实例 `%Name_键`/否决 enum payload 统一 variant/tag 默认 i32+`@repr(u8/u16)` 缩小/递归 variant 显式 *T/默认保持声明序+`@layout(reorder)`/补齐 variant 穷尽性/空 struct 1B 占位+单 case variant=tag 宽），并同步精修 §4/§5/§8/§9 一致（tag 默认 i32 可 @repr）。全部为纯设计文档，未触碰实现代码(用户此前裁定不要编码)。

- 2026-09-04（续 8 · 代码书写指导）：新增 `docs/code-style-guide.md` —— 作为「之后书写 T 代码」的硬约束，逐类用 `✅ 新写法 / ❌ 旧写法` 对照，覆盖声明(`var`/`let`/`const`)、函数(`fn` 并置返回、无 `func`/`->`)、类型转换(`as`)、闭包(`fn(...)` 非 `|v|`)、模块(`@import("Path")`+`pub`+`@module`、跨模块路径限定)、入口(`@main`)、分支(`match` 非 `switch`)、enum(`enum Name` + 限定 `Name.Case`)、可选(`?T`/`some`/`unwrap`)、f-string(`!j` 等)、comptime、命名 lint(`T-NAM-*`)与静默错编反模式。**所有 ✅ 写法经 `out/rls/tc.exe check` 实测通过，❌ 旧写法均实测报对应错误码**；§6 校正 `reference.md` 若干陈旧条目（`let`/`auto` 反转、`var` 局部须显式标注、`enum` 名字后置、enum 成员须限定）。

- 2026-09-04（续 6 · CI 接入 + 性能基线）：落实 `pipeline-review.md §9.2`「实现与 CI 接入」与「单次编译性能基线（原型量化）」两项。① 三项新设计文档补齐 CI 门禁小节：`comptime-design.md §5.1.1`(CTFE fuzz CI 门禁)、`wasm-component-design.md §4.1`(隔离门禁 CI 实现/阻断)、`diagnostic-ir-design.md §5.1`(CI SARIF 门禁，P1 前告警)、`supply-chain-design.md §7.1`(CI 供应链门禁 SBOM/审计/签名/缓存信任)。② 新增 `docs/compiler/ci-gate-design.md` —— BP-1/2/3 三向绑定落到 CI 阻断层的门禁矩阵 G-CI-1~G-CI-10、DAG 执行序、hermetic action cache(D8-4)、门禁脚本接口契约（待实现接口清单）。③ 新增真实 `.github/workflows/ci.yml` —— 实现上述门禁为 GitHub Actions 工作流（bootstrap/ir-roundtrip/incrementality/ctfe-fuzz/diagnose/supply-chain/wasm-component-verify/perf-baseline jobs），其中 gate.mjs L2 与 ir_snapshot.mjs 为可直跑、其余门禁脚本为定义好的接口契约（本回合不编码实现）。④ 新增 `tools/bench_compile.mjs`（仅驱动 `tc` 计时，不碰实现）并实测当前管线基线：前端+sema 中位 13ms(p90 15ms)/ codegen(emit-ll) 中位 116ms(p90 134ms)，证明编译耗时集中在 codegen、前端廉价，MIR 落地增量预期可控；新增 `docs/compiler/perf-baseline.md` 方法学+基线+G-CI-10 对比接入。全部为设计/配置/测量，未触碰编译器实现。

- 2026-09-04（续 9 · 代码书写补充：struct/variant 字面量+match）：`docs/code-style-guide.md` 新增 struct/variant 匿名字段字面量与 match 解构约束（经 `out/rls/tc.exe` 9-3 构建 `tc check` 实测）；并披露 LLVM 后端两处 codegen 缺陷（variant 直接字面量 `Circle(5)` 空指针 load / struct 字面量模式类型错配），记入后续待办。

- 2026-09-04（续 10 · 已知缺陷登记）：新增 `docs/compiler/known-issues.md`（KI-001/KI-002 两处 codegen 缺陷 + 复现用例 `tests/known-issues/KI-001_*.tc`/`KI-002_*.tc`），并补登 `code-style-guide.md` 顶层清单 + `known-issues.md` 表行于本清单。

- 2026-09-04（续 11 · 前导点语法落地文档）：用户裁定「匿名字段字面量采用 `.` 开头」。经查证仓库最新提交 `9224f06`(`.{...}` 匿名结构体字面量)/`898de07`(`.Red` match 臂) 与 `out/dot_test.tc` 规范样例，更新 `docs/code-style-guide.md`：① §1 表新增「struct 字面量（匿名·前导点）`.{...}`」「enum 成员引用 `.Red`」两行，并订正 variant 字面量行（`.Circle(5)` 报 `T-DOT-E102` 尚不支持，variant 直接字面量不带点）+ struct/variant match 行（`.{...}` 模式报 `T-DOT-E101`、`.Circle(r)` 报 `T-DOT-E102`）；② 后端状态注记改为 23:38 构建基准，确认 `.{...}`/`.Red` 双后端验证通过、KI-001/KI-002 仍开放；③ §5 最小示例改用 `.{...}`/`.Red` 且对两处缺陷用兼容构造器/字段访问规避，已 `tc run` 实测通过；④ §6/§7 加前导点校正行与验证基准。同步 `docs/compiler/known-issues.md`：KI-001/KI-002 在 23:38 构建复核仍 open、标注 variant 前导点不支持。全部为文档更新，未触碰编译器实现。

- 2026-09-05（续 12 · KI-001/KI-002 修复闭环 + 前导点 variant 落地）：用户确认「001、002 具名结构体已通过、匿名结构体字面量也通过」。复用最新 `out/dbg/tc.exe` 02:19 构建（含 `fb6eeaf` fix(variant): 前导点变体构造器在 match 臂与值位的正确脱糖）复跑复现用例：`KI-001_variant_anon_literal.tc` → stdout `5` 无 IR 报错、`KI-002_struct_literal_pat.tc` → stdout `0` 无 IR 报错，两缺陷置 `closed`。并实测前导点 variant 构造器 `.Circle(5)` 与 match 臂 `.Circle(r)` 于同提交解除 `T-DOT-E102` 后可用。`docs/code-style-guide.md` 同步：① §1 表新增「struct 字面量（匿名·前导点）`.{...}`」独立行、struct+match 行标注 KI-002 已修复、variant 字面量/匹配行改 `.Circle(5)`/`.Circle(r)` 为 ✅（去除 KI-001 绕过注记）；② 后端状态注记改为 `fb6eeaf` 基准，宣告 KI-001/KI-002 已修复、仅残留匿名 `.{...}` 模式 `T-DOT-E101` 限制；③ §5 示例改用 `.Circle(5)`/`.Circle(r)`/`Pt{ x:0,y:0 }` 自然写法并 `tc run` 验收通过（`5 r 1 0 0 5 7`）、`diagnostics:[]` 零告警；④ §7 验证基准改 `out/dbg/tc.exe`（`fb6eeaf`）。`docs/compiler/known-issues.md`：KI-001/KI-002 状态置 `closed`、补验证证据与 `fb6eeaf` 基线、§5 变更记录加续 12。全部为文档更新，未触碰编译器实现。

- 2026-09-05（续 13 · 禁止「匿名+具名混合」写法）：用户裁定前导点匿名字段字面量不存在、且永不支持「匿名+具名混合」形式。实测 `out/dbg/tc.exe`（`fb6eeaf`）确认 `.{ x = 0, y = 0 }` 报 `T-PAR-E101`（期待 Colon 读到 `=`）、`.{ x: 0, y: 0 }`（`:` 关联）`errors:0`。更新 `docs/code-style-guide.md`：① §1「struct 字面量（匿名·前导点）」行禁止列加 `.{ x = 0, y = 0 }`（用 `=` 关联字段 → `T-PAR-E101`，不支持且不计划支持）、注释列重申「字段名关联统一用 `:`，禁止 `=`」；② §1 表后新增 🚫 禁止写法 callout，明确 `.{...}` 仅省略类型名、字段仍以 `:` 按名关联，`.{ x = 0, y = 0 }` 及任何「无类型名却用位置/混排」形式一律不支持且不计划支持。全部为文档更新，未触碰编译器实现。

- 2026-09-25（结构体/元组文档全面更新）：按用户要求同步结构体与元组相关文档。① `docs/reference.md`：§3.1 `StructDecl` 改为关键字前置 `struct Name{}`（旧 `Name struct` 移除、报 `T-PAR-E102`），新增位置字段 `PositionalField`（`struct Pair { i64, string }` 自动命名 `_0`/`_1`）、`StructMethod` 关键字前置、§3.4 `StructLit`/`FieldInit`/`TupleLit` 三式（`.x=` 与 `x:` 并存、匿名 `.{...}`、元组 `.{e1,e2}`）、§3.5 新增 `TupleType` `.{T1,T2}`、§3.21 新增「元组（Tuple）」专章（合成名 `_Tup_<mangled>`、同构即同类型、匿名/具名不互转 `T-SEM-E202`、`t.0`/`t._0` 位置访问、未知字段 `T_UNKNOWN_FIELD`、不支持形式表）；§5 文法摘要同步 `PositionalField`/`TupleLit`/`TupleType`。② `docs/code-style-guide.md`：§1 表改关键字前置 + 元组 `struct Pair { i64, string }`、`.{1i64,"hi"}` / `.{i64,string}` / `t.0` 等 ✅ 写法，struct+match 行标注 KI-002 已重新开放；§5 最小示例改用元组并以显式 `if` 规避字面量模式判别。③ `docs/syntax/drafts/` 四个失效草稿（`decl_struct.md`/`expr_literal.md`/`expr_postfix.md`/`types.md`）补「权威指引（2026-09-25 补）」框，指向 `reference.md` §3.1/§3.4/§3.5/§3.21，标注旧式 `Point struct{}`/`let`/`T{ x:1 }` 已过期。④ `docs/everything-is-value-t.md`：补齐（lub）对元组/位置字段结构体的递归规则、`unit` 单位元处置、值位置含元组字面量/值 `if`/`match` 返回元组的实测语义。⑤ `docs/syntax/drafts/match.md`：§6.3 记录 KI-002 当前为 LLVM 轨静默误编译（条件被丢弃、恒命中首臂，C 轨正确）。
- 2026-09-25（KI-002 重开 + 元组标志位回归修复）：① 经 `git archive HEAD~1 src` 重建 `2a3c4b6^` 编译器复跑 `KI-002_struct_literal_pat.tc`：LLVM 轨输出 `1`（期望 `0`）、C 轨 `0` —— 证实 KI-002 实为 **LLVM 轨静默误编译**（条件被丢弃、首臂恒命中，IR 无 `icmp`、第二臂为死块），非先前述的「类型错配」；旧 `fb6eeaf 已修复` 结论因 `fb6eeaf` 源码已无法被当前编译器编译而无法复测，记为不可测主张 + 回归窗口 `fb6eeaf..0b212ac`。KI-002 在 `known-issues.md` 与 `code-style-guide.md` 重新开放（高优先级）。② 元组实现引入的栈溢出回归：`.{...}` 省略类型名标记误写在 `lb` 槽、元组标记误写在 `lc` 槽，二者均属 `la/lb/lc` kids 链表头铁律槽，被 `lam_find`/`mb_walk` 等通用遍历当链表展开 → 撞函数语句链成环 → 编译器退出码 127（栈溢出）；修复为改用标量槽 `ib`/`ia`（已经验证 `struct_lit` 他路径不用这两个槽）。新增回归示例 `examples/tuple_after_local.tc`（「先有局部变量、再有元组字面量」最小形态固化地雷）双后端验收通过。
