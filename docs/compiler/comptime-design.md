# t 全量 comptime 设计文档（v0.2 · HIR 解释视角）

> 状态：v0.2（2026-09-04 重构）｜ 决策 A 已裁定 HIR = ZIR 槽位（untyped · 线性 · 可序列化），CTFE 须改为「解释 HIR 指令流」而非「AST 树求值」。本文据此重构；v0.1 的 AST 树实现经验保留于 §8 作为 legacy 对照。  
> 关联：`docs/compiler/hir-design.md`、`docs/compiler/ir-taxonomy.md`、`docs/compiler/tir-design.md`、`docs/compiler/cst-design.md`、`docs/compiler/meta_design.md`

## 0. 决策锁定（语义不变）

- **语义 = B（弥漫式自动折叠）**：只要一个表达式的全部操作数都是编译期已知的，就自动折叠，不要求任何 `comptime` 标注。
- **类型即值（A 的那半）**：泛型靠返回 `Type` 的 comptime 函数实例化（P4 落地）。
- **求值机制 = 解释器**，但** substrate 改为 HIR 指令流**（v0.1 是 AST `nodes[]` 树）；挂在 Sema 之内，不碰任何后端。
- **P0–P4 只放「无捕获 / 纯值捕获」的 comptime 函数**；闭包（TClosure ABI 的编译期表示）留到 P5+。

- **编译器反射预留（D1-7 / 地平线 G-14）**：HIR=ZIR 使 comptime 可**解释编译器自身 IR**（本设计 substrate 即 HIR 指令流），为 ERP 插件/代码生成架构开反射接口——可让 comptime 函数在编译期读取 HIR 指令/类型信息做元编程。当前默认**不暴露**该能力；但规格须预留 HIR 指令流的**只读反射入口**（不修改 IR），避免未来需要时回头改 substrate。


## 1. 管线定位：旧（AST 树） vs 新（HIR 指令流）

| | v0.1（当前实现，legacy） | v0.2（A 裁定后，目标） |
|---|---|---|
| 求值 substrate | AST `nodes[]` 树（`meta_eval`/`meta_pass` 递归遍历） | **HIR 线性指令流**（解释器带显式 PC + 值环境） |
| 运行时机 | `run_check` 内、`check_decl` 之前（产物是字面量节点，检查器随后照查） | **Sema 之内**，作为 Sema 解释 HIR 的一部分（边解释边得类型） |
| 类型信息来源 | 折叠无类型；窄化靠 `cast` 节点位宽 | HIR 无类型 → **Sema 在解释时增量算 TI**（`infer_expr` 同款归一表示），解释器环境携带 (值, TI) |
| per-file 缓存 | 不涉及（AST 不缓存） | HIR 是缓存单元；CTFE 结果可随 HIR 一起缓存（见 `hir-design.md` §3.4） |
| 对位 | — | **Zig**：comptime 在 Sema 解释 ZIR；Sema 边推进边算类型 |

**张力与解法**：HIR 是 untyped 的，但 CTFE 折叠（如 `2+3`、`cast` 窄化、数组长度）需要类型。解法 = **CTFE 不是独立前置 pass，而是 Sema 的解释器本身**：Sema 对 HIR 指令做语义分析时，顺带把「全 const 可折」的指令就地求值成 HIR 常量指令。类型在解释过程中按 `infer_expr` 的归一 TI 取得，不复制类型系统。这与 Zig 的「Sema 解释 ZIR」同构，且天然避免 v0.1 §10 担心的「第二解释层漂移」（两层不是并行，是串行合一）。

## 2. 架构定位（新管线）

```
lex → parse → CST
                → AstGen → HIR (ZIR 槽位, untyped linear, 可缓存)
                → sema + CTFE (解释 HIR: 名字解析 / 类型检查 / 单态化 / comptime 折叠)  ← CTFE 在此
                → mir (CFG+SSA, 中端优化)
                → TIR (类型擦除·线性)
                 → tmir (机器桥, 喂薄后端)
                → 后端 (LLVM / Cranelift / C / WASM / SPIR-V)
```

- 新模块（目标）`src/comptime_fold.tc` 的求值逻辑迁入 Sema 的 HIR 解释器（`meta_eval_call` 重写为消费 HIR 指令）。
- 入口 `comptime_fold_pass()` 语义保留：在 HIR 解释完成后、mir 之前，对仍残留的可折 HIR 指令做一遍收尾折叠（护栏同 §5）。
- **复用现有求值上下文**：`g_meta_steps` / `g_meta_err` / `g_meta_quiet` 预算与安静标志沿用。

## 3. 求值器 substrate：HIR 解释器 vs AST 树遍历

- **当前（legacy）**：`meta_eval` 递归遍历 `nodes[]` 树，按 `kind` 分派（`binary`/`unary`/`cast`/`call`/`ident`/`if`/`while`/`block`/`return`/`break`/`continue`）。控制流靠递归返回码（0=顺序 1=return 2=break 3=continue）。
- **目标（HIR）**：HIR 是线性指令流（见 `hir-design.md` §3.2），控制流显式为 `block`/`br`/`br_cond`/`switch`。解释器改为：
  - 显式 **PC**（指令指针）+ 基本块跳转表；
  - **值环境** `menv`：名字 → (值, TI) 绑定（平栈 + 帧基 + 全局区，沿用 v0.1 §Phase B 的 `g_menv_*` 形态）；
  - 指令分派按 HIR opcode（非 AST kind）；`const`/`load`/`store`/`add`/`icmp`/`br_cond`/`switch`/`call` 等；
  - 折叠产物 = **HIR 常量指令**（`const.i64 5`），而非字面量 AST 节点——这是与 legacy 的关键区别（legacy 把 AST 节点就地改成字面量；HIR 解释器产出独立常量指令，slot 模型见 `tir-design.md` §2.4）。

> 迁移策略：legacy AST 求值器在 A 阶段（AstGen 落地）**保留为对照实现**，两个版本在 `gate L2` 上对拍（同一 `.tc` 应折出相同常量），确认语义等价后再退役。避免「重写解释器 + 改管线」两条风险线捆进同一个 gate（见 `ir-taxonomy.md` §6 的 A 选项论证）。

## 4. 值模型（CVal，substrate 调整）

- **P0–P2：不引入显式 CVal 结构**。HIR 常量指令（`const.*`）即值的载体；零新增类型，复用已验证路径。解释器栈上临时值携带 (值, TI)。
- **P3+**：当需「类型即值」与 comptime 函数捕获时，引入显式 `CVal` 带标签联合；其 `typ` 字段为 **TI 索引（i64）**——通过 Sema 的 `infer_expr` 取得，**不复制 Type 系统**（sema 已有一套 `TI`/`TD`）。
  - `CVal = Int(ti, bits) | Flt(...) | Bool | Char | Str | Arr | Struct | Enum | Type(ti) | Fn(HIR + 捕获的 CVal 环境)`
  - 初版的「128 位内部整数」决策作废：t 无 i128，P3 前用 i64；如需 >64 位编译期常量再议。

## 5. 折叠判定 / comptime 边界（护栏保留）

- HIR 解释器对「全 const 可折」指令自动折叠（B 式弥漫）。
- **forbidden → 不折**：I/O、系统调用、取运行期变量地址、调用运行期内建、引用运行期变量。
- **护栏 `comptime_has_runtime_ref`**（沿用 v0.1）：递归检查子树是否含运行期引用（HIR 里即含运行期 `load`/`call` 到非 const 符号），命中即跳过——保证求值永不撞运行期引用、永不塞伪错误。
- 运行期内建清单（`print`/`time`/`random` 等）显式登记，解释器对其返回「不可折」。

### 5.1 编译期求值沙箱与模糊测试（D6-1 / D6-2 / D7-10）

CTFE 在编译期执行用户提供的代码，是「编译期即攻击面」——恶意/畸形输入可致编译器 OOM、死循环或越界（D6-1）；且若能在编译期逃逸（读写宿主机密、发起网络），即破坏供应链信任（D8）。须将其置于受限沙箱：

- **资源硬上限（D6-2）**：步数 `T_META_BUDGET`、递归深度 `T_META_DEPTH`、分配上限（arena 配额）全部为**硬熔断**——超限即 `T_META_BUDGET` 类诊断，绝不静默继续；解释器不得申请宿主无限内存（arena 上限即编译期内存上限）。
- **权限隔离（D8-3 联动）**：CTFE 禁用一切 I/O 与系统调用（除编译期 `print`/`eprint` 写 stderr 的受控通道）；`T_META_IMPURE` / `T_META_READ_RUNTIME` 显式拒绝 impurity，从源头杜绝编译期逃逸。
- **模糊测试门禁（D6-1 / D7-3）**：CTFE 须有 fuzz 投入——随机/畸形 comptime 语料回归，断言编译器不崩溃/OOM/死循环，且折叠结果与参考解释一致（多后端互证 D7-3）；fuzz 门禁纳入 CI。
- **安全边界保持（D7-10 联动）**：CTFE 折叠产物为 HIR 常量指令，不得携带运行期引用；与 WASM 组件隔离验证（见 `wasm-component-design.md §2`）共享「无逃逸」不变式——编译期求值产物同样须经隔离属性检查，防止误编译经 comptime 注入。

#### 5.1.1 CI 模糊测试门禁规格（D6-1 / D7-3 / D7-10）

- **语料**：`tools/ctfe_fuzz.mjs` 生成随机/畸形 comptime 语料（深层递归、超大字面量、畸形类型、未定义符号、impure 调用），覆盖 `T_META_BUDGET`/`T_META_DEPTH`/arena 配额边界。
- **断言**：每个语料编译须①不崩溃/OOM/死循环（超时即 fail）；②超预算须报 `T_META_BUDGET` 类诊断而非静默继续；③折叠结果与参考解释（C/LLVM 双后端互证 D7-3）一致。
- **CI 接入**：作为 `ctfe-fuzz` job（见 `ci-gate-design.md` G-CI-5）纳入 PR 阻断；种子语料随仓库固化，新崩溃用例自动加为回归夹具。
- **隔离自检**：fuzz 须验证「无逃逸」不变式——编译期求值产物不含运行期引用、不触发 I/O（D8-3 联动）。

## 6. 双后端 & 不动点影响

- 折叠产物是「已折为 HIR 常量指令」；C/LLVM/WASM/Cranelift/SPIR-V 后端照常从 tmir 发射，**comptime 逻辑零后端相关** → 天然守双（多）后端等价（`cself`）。
- 折叠是语义 no-op：四代统一应用同款折叠 → 四代 md5 不动点应仍成立，但 P6 须重跑 gate 复核。
- **窄类型陷阱**：折叠出的 `u8`/`i32` 常量须保留 `cast` 指令（HIR 里是 `cast` 节点 / TIR 里是 `cast` 指令），否则后端误按 i64 发射（v0.1 §1.3 实证）。

## 7. 阶段划分（修订为迁移路线）

| 阶段 | 内容 | 依赖/风险 |
|---|---|---|
| **Phase 0（已落地，AST）** | `comptime_fold.tc` + `meta_eval` 在 AST `nodes[]` 上跑通（gate L2 全绿，IR 漂移归零，见 `meta_design.md` Phase A–E） | 现状基线，作为对照 |
| **Phase A（HIR 解释器）** | AstGen 落地后，CTFE 重写为解释 HIR；legacy AST 版保留对拍；验证 `var x = 2+3` → HIR `const.i64 5` | 与 A 阶段（HIR=ZIR）同步；双版 gate 对拍 |
| **Phase B** | 扩大覆盖：bool 短路、`if` 常量分支、`switch` 常量折叠、字符串拼接；确定性审计 | 扩展 HIR 解释器 |
| **Phase C** | `struct`/`array`/`variant` 字面量折叠 | 依赖 P3 的 CVal 或扩展解释器 |
| **Phase D** | 显式 `CVal`；comptime 函数（无捕获/纯值捕获）；递归 | 引入值模型 |
| **Phase E** | 类型即值 + 泛型经 comptime 实例化 | 须对齐 `instantiate_generic`（`tir-design.md` §4.2.1） |
| **Phase F** | comptime 闭包（TClosure ABI 的编译期表示） | 捕获环境只能是 CVal |
| **Phase G** | 步数/递归深度/分配上限熔断 + 双后端等价审计 + gate 验证 | `g_meta_steps` 预算扩展 |

## 8. Legacy AST 实现经验（保留，供 Phase A 迁移参考）

> 以下为 v0.1 在 AST `nodes[]` 上的实证结论，**不随 substrate 改变而失效**——它们是语义/护栏事实，Phase A 的 HIR 解释器必须等价满足。

1. **t 已有 CTFE 求值器** `meta_eval` / `meta_pass` / `meta_fold_expr`（`sema.tc`）。「全量 comptime」不是从零造解释器，而是把触发范围从「仅 `comptime` 标记节点」扩大到「任意全 const 可折的普通表达式节点」。
2. **`Node` 无类型字段**（扁平节点池）。类型靠 `infer_expr(e)` / `resolve_ti(tn)` 按需重算；CVal 的 `typ` 应是 **TI 索引（i64）**。
3. **t 无 i128/u128**，最大 `i64/u64`；codegen 把 `int` 字面量默认按 i64 发射，窄类型靠 `cast` 节点体现 → P0+P1 用 i64 算术，复用 `meta_eval_binary` 的 wrap 语义。
4. **折叠的标准做法是「原地改写」**：`meta_fold_expr` 把节点就地改成字面量节点（保留 `ln/cl/tv` 锚点）。HIR 版改为「产出独立常量指令」，但锚点保留原则一致。
5. **`meta_eval` 对不可折节点会调 `meta_fail`** → 可能向诊断塞错误。绝对不能盲调；必须加护栏只折「子树不含运行期引用」的纯字面量算术。
6. **落点（legacy，全在 `src/tc.tc` / `src/comptime_fold.tc`）**：环境 `g_menv_name[]`/`g_menv_val[]` 平栈 + `g_menv_base` + `g_menv_nglobal`；`meta_eval` 字面量/ident/unary/binary(&& || 惰性)/cast/call；`meta_exec` 语句分派返回码 0/1/2/3；`meta_eval_call` 实参先在调用方环境求值时再建帧；`meta_pass` 先填全局区再遍历声明；护栏 `T_META_BUDGET`(4e6)/`T_META_DEPTH`(64)/`T_META_DIV_ZERO`/`T_META_IMPURE`/`T_META_READ_RUNTIME`/`T_META_NOT_META_FN`。
7. **编译期 `print` 写 stderr**，不写 stdout（stdout 是机器可读通道，conformance 逐字节对拍）——`print`/`eprint` 编译期同义。
8. **类型绑定透传**：CTFE 环境并行槽 `g_menv_ty` 存「类型绑定 vs 值绑定」；`meta fn` 体内 `@type_equal(T,u32)` 能看到被单态化绑定到的具体类型。
9. **数组值语义**：数组按值语义，在变量绑定/赋值/调用三处经深拷贝，杜绝别名。
10. **浮点**：当前不支持（`T_META_NOT_CONST`），结合序定死后再开（第 7 条可复现）。

## 9. 开放项（HIR 视角，须读代码/实测确认）

1. **HIR 解释器与 Sema 的接口**：CTFE 是 Sema 的同一步还是独立后置 pass？建议同一步（串行合一，免漂移），但需确认 Sema 现有遍历结构能承载「边解释边折」。
2. **惰性诊断交互**：未实例化泛型体内的 comptime 错误，在 HIR（pre-sema）不报；实例化后由 Sema 解释时报——须确认 HIR 解释器不提前对未实例化体求值（见 `hir-design.md` §3.4）。
3. **per-file 缓存交互**：CTFE 结果随 HIR 缓存；但 CTFE 可能引入跨文件常量（如 comptime 计算依赖导入类型的大小）——须确认缓存键含这些依赖（见 `compiler-pipeline-design.md` §4.2b `.tmi` 与 `ir-taxonomy.md` §6）。
4. **`as` 中缀转型的 HIR 表达**：`expr as Type` 在 HIR 是 `cast` 指令；解释器须先得目标 TI 再折（窄化按位宽补码）。
5. **默认开启弥漫折叠对门禁的影响**：建议先 gated，跑通后默认开；开启即意味自举产物多折一批常量——须 gate 复核四代不动点。

## 10. 迁移清单（Phase A 待办）

已做（legacy，AST）：
- `src/comptime_fold.tc`：候选判定 + 护栏 + 原地改写 + pass 入口（默认 `g_comptime_full=false`）。
- `src/tc.tc`：`import(src.comptime_fold :: *)` + 两处 `run_check()` 后调用 `comptime_fold_pass()`。
- `tools/tc_sources.mjs`：`TC_MODULES` 加入 `src/comptime_fold.tc`（位于 `sema` 之后）。

Phase A 待做：
- AstGen 落地（`hir-design.md` A 阶段）后，新增 `meta_eval_hir` 解释 HIR 指令流。
- `meta_eval_call` 重写为消费 HIR（原 AST 版保留为 `meta_eval_legacy` 对照）。
- 翻 `g_comptime_full = true` 后 `node tools/gate.mjs L0` 双版对拍：AST 版与 HIR 版折出相同常量、IR 漂移归零。
- 用 `var x = 2 + 3; print(x);` 验证 HIR `const.i64 5`。
