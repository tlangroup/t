# fault / trap / repair · 测试矩阵

> 配套：`docs/design/fault/DESIGN.md`（批次台账）・`docs/syntax/drafts/fault.md`（语法/语义权威）
> 日期：2026-10-27（随 B2 落地建立；后续批次在本文件追加，不改结构）

## 0. 三条判据（先记住，否则会出现「全绿但有 bug」）

1. **conformance 只做静态检查，不运行程序** —— `// EXPECT: pass` 只跑 `tc check`。
   运行期语义**零覆盖**，必须靠 examples golden 补（B2 的 `predpat_demo` 即为此而加）。
2. **凡改运行期语义，必须加 golden，且必须含「不该命中」的分支**。
   只写「能跑通」的用例，会把「恒命中首臂」一类的静默错编也判成绿（KI-002 教训）。
3. **双后端逐字节对拍**（`run_examples_tmir.mjs`）是抓后端 shim 缺口的主力手段；
   单后端跑通不能证明另一端正确。

---

## 1. 编译期 · 诊断码（conformance）

| 用例 | 期望 | 批次 | 状态 |
|---|---|---|---|
| `pass/p_predpat_hit_miss.tc` | `// EXPECT: pass` | B2 | ✅ |
| `fail/f_predpat_nonrelop.tc` | `error T-MAT-E745`（`.{ .age + 1 }` 用了非关系运算符） | B2 | ✅ |
| `fail/f_predpat_scrutinee_expr.tc` | `error T-MAT-E746`（`match(validate(u))` —— scrutinee 不是变量，A-16） | B2 | ✅ |
| `pass/p_fault_clause_forms.tc` | `@clause(.fault, ...)` / `@clause(.repair, ...)` 可声明（含 `++` 合并） | B3 | ✅ |
| `fail/f_fault_clause_guard.tc` | `error T-CLA-E728`（故障/修复子句不接受 `when` 守卫） | B3 | ✅ |
| `fail/f_fault_clause_pred_form.tc` | `error T-CLA-E730`（谓词位不是等值/关系约束，如 `.{ .age + 1 }`） | B3 | ✅ |
| `fail/f_repair_clause_name_form.tc` | `error T-CLA-E729`（修法名不是 `.名` 形态） | B3 | ✅ |
| `fail/f_fault_clause_in_match_arm.tc` | `error T-CLA-E731`（故障子句被拼进 match 臂链） | B3 | ✅ |
| `pass/p_fault_group_decl.tc` | 组声明 + `fault(E)!T` 可引用 + 合成结构可声明并读写字段（**不含**返回 `fault(E)!T` 的函数——那要等 B4 的 `Ok/Err`） | B1 | ✅ |
| `fail/f_fault_unknown_group.tc` | `error T-CLA-E732`（`fault(NoSuch)!T` 组未声明） | B1 | ✅ |
| `fail/f_fault_type_mismatch.tc` | `error T-CLA-E733`（成功类型与 `over T` 不一致） | B1 | ✅ |
| `fail/f_fault_dup_group.tc` | `error T-CLA-E739`（组名重复） | B1 | ✅ |
| `fail/f_fault_dup_member.tc` | `error T-CLA-E725`（成员名重复） | B1 | ✅ |
| `fail/f_fault_missing_over.tc` | `error T-CLA-E738`（缺 `over`） | B1 | ✅ |
| `fail/f_fault_pred_form.tc` | `error T-MAT-E747`（谓词形态非法） | B1 | ✅ |
| `fail/f_fault_pred_unknown_field.tc` | `error T-MAT-E748`（谓词字段不在 `over T`） | B1 | ✅ |
| `fail/f_fault_dup_pred.tc` | `error T-MAT-E749`（组内谓词重复，A-2） | B1 | ✅ |
| `fail/f_fault_dup_repair.tc` | `error T-MAT-E752`（成员内 repair 名重复，A-11） | B1 | ✅ |
| `fail/f_fault_ok_arity.tc` | `error T-MAT-E753`（`Ok` 实参数目 ≠ 1） | B4a | ✅ |
| `fail/f_fault_err_non_clause.tc` | `error T-MAT-E754`（`Err(...)` 实参不是 `@clause(...)`） | B4a | ✅ |
| `fail/f_fault_err_no_fault_clause.tc` | `error T-MAT-E755`（缺 `@clause(.fault, ...)`） | B4a | ✅ |
| `fail/f_fault_err_unknown_member.tc` | `error T-MAT-E756`（全名不在组内） | B4a | ✅ |
| `fail/f_fault_err_pred_mismatch.tc` | `error T-MAT-E756`（谓词与组声明不恒等，A-2 / A-25） | B4a | ✅ |
| `fail/f_fault_err_repair_slot.tc` | `error T-MAT-E757`（修法名不属于该成员） | B4a | ✅ |
| `fail/f_clause_bad_anchor.tc` | `@clause` 锚点非法（CAT 待定，B3 定） | B3 | ⬜ |
| `pass/p_fault_trap.tc` | `trap` 四种合法形态（位置①无/有 `.abort`、位置②、位置②+`recover`）都能过 sema 并完成脱糖（只 check，不运行） | B4b | ✅ |
| `fail/f_fault_trap_pred_form.tc` | `error T-MAT-E759`（谓词形态非法，parse 期） | B4b | ✅ |
| `fail/f_fault_trap_resume_form.tc` | `error T-MAT-E762`（`resume` 实参不是 `.修法名`） | B4b | ✅ |
| `fail/f_fault_trap_arm_body.tc` | `error T-MAT-E763`（臂右端不是 `resume(...)`/`recover(...)`） | B4b | ✅ |
| `fail/f_fault_trap_position.tc` | `error T-MAT-E764`（`trap` 出现在表达式位） | B4b | ✅ |
| `fail/f_fault_trap_not_fault.tc` | `error T-MAT-E765`（被捕表达式不是 `fault(E)!T`） | B4b | ✅ |
| `fail/f_fault_trap_pred_member.tc` | `error T-MAT-E766`（谓词与组内声明不恒等，A-22/A-25） | B4b | ✅ |
| `fail/f_fault_trap_dup_member.tc` | `error T-MAT-E767`（两条臂落到同一成员） | B4b | ✅ |
| `fail/f_fault_trap_abort_position.tc` | `error T-MAT-E768`（位置② 用了 `.abort`） | B4b | ✅ |
| `fail/f_fault_trap_nonexhaustive.tc` | `error T-MAT-E769`（位置② 未穷尽，A-15） | B4b | ✅ |
| `fail/f_fault_trap_repair_slot.tc` | `error T-MAT-E770`（修法名不属于本臂成员，A-26） | B4b | ✅ |
| `fail/f_fault_trap_wild_only_abort.tc` | `error T-MAT-E771`（通配臂只允许 `resume(.abort)`，A-21） | B4b | ✅ |
| `fail/f_repair_cross_fn.tc` | repair 闭包禁跨函数复用（A-12） | B4/B5 | ⬜ |

- 诊断码唯一真源：`tools/diag_defs.json` → 生成 `src/diag_table.gen.h`。
  ⚠ 000–999 已被 `gen_diag.mjs` 的 `RANGES` 切满 ⇒ 新 CAT 只能做**区间再切分**（仿 CLA/TIM 先例）。
- 现有三条走 **MAT** 段（E743 之后递增 E745/E746），未新增 CAT。
- B3 增 CLA 段 E728–E731；**B1 增 10 条**：CLA E725/E732/E733/E734/E735/E738/E739（组与类型层）
  + MAT E747/E748/E749/E752（谓词层，与 E745/E746 同族）。
- **B4a 增 6 条** MAT E753–E758；**B4b 增 11 条** MAT E759–E771（A-24：不开新 CAT）。诊断总数 193 → 199 → **210**。

---

## 2. 运行期 · examples golden（双后端对拍）

| 用例 | 覆盖 | 批次 | 状态 |
|---|---|---|---|
| `examples/predpat_demo.tc` + `.expected.txt` | 谓词模式：命中 / **不命中** / 边界相等 / 混合字段（`<`、`>=`、`==` 混排） | B2 | ✅ 双后端逐字节一致 |
| `examples/faultclause_demo.tc` + `.expected.txt` | 故障/修复子句的**零副作用**：声明它们的程序照常运行，且 `.pattern` 的臂展开不受影响 | B3 | ✅ 双后端逐字节一致 |
| `examples/faultgroup_demo.tc` + `.expected.txt` | **A-32 布局**：`tag`(0=Ok) / `val`(可写成功值) / `r0..r(N-1)`（读 `r2` 即证明第二成员槽位基址 = 2，槽位少一个则编译不过）。⚠ 刻意**不调用**闭包：三处既有后端缺口见 `fault.md` §C.5 G-1..G-3 | B1 | ✅ 双后端逐字节一致 |
| `pass/p_fault_raise.tc` | raise 两种实参形态（`++` 串联 / 逗号分隔）都能过 sema 并完成脱糖（只 check，不运行） | B4a | ✅ |
| `examples/faultraise_demo.tc` + `.expected.txt` | **raise 侧运行期行为**：`Ok(u)` ⇒ tag 0 + `val` 落值；`Err(...)` ⇒ tag 1/2 + 槽 0/1/2 挂上 repair 闭包且**调用**它们得到预期值。⚠ 一律「先落局部变量再读字段」（既有缺口 G-5） | B4a | ✅ 双后端逐字节一致 |
| `examples/faulttrap_demo.tc` + `.expected.txt` | **消费侧运行期行为**（25 行）：位置②（clamp / `recover`）；位置① 全修三条路径（clamp / anon / 直通）；位置① `recover`；位置① `.abort` ⇒ 消费臂得 tag 0、未落臂成员原样上传得 tag 2 且槽位仍是组内绝对槽位 2；**跨函数链路**（内层 `.abort` 上传 ⇒ 外层 `trap` 消费，可三层叠加，recover 与 resume 混用）。⚠ 一律「先落局部变量再读字段」（既有缺口 G-5） | B4b | ✅ 双后端逐字节一致 |
| 待补 | 谓词规范化后跨位置恒等（raise ↔ 组声明 ↔ trap 臂，A-25 折叠）—— 已由 E756/E766 在编译期覆盖 | B4b | ✅（编译期）|
| `examples/faulttrap_demo.tc` ⑦⑧⑨⑩ | **跨函数链路的运行期部分**：内层 `.abort` 上传 ⇒ 外层 `trap` 消费（可三层叠加、`recover` 与 `resume` 混用）；内层已修好时外层不落臂直接取 `val` | B4b | ✅ 双后端逐字节一致 |
| `pass/p_fault_escape_return.tc` | **A-36 推导①**：非 `pub` + 未声明，`return <会抛的调用>` 直通 ⇒ 推导出的签名对调用者可见（调用点可直接 `trap`） | B5a | ✅ |
| `pass/p_fault_escape_var.tc` | **A-38 推导②**：非 return 位置 `var f = <会抛的调用>` 走直通传播 | B5a | ✅ |
| `pass/p_fault_escape_abort.tc` | **A-36 推导③**：带 `.abort` 的 `trap` 也能推导 ⇒ 不写 `fault(E)!T` 时不再报 T-MAT-E768 | B5a | ✅ |
| `pass/p_fault_group_two.tc` | ⭐⭐ **B1 既有缺口的回归**：一文件两个组（且刻意同名修法 `.clamp`）⇒ 第二组的修法全部可查 | B5a | ✅ |
| `fail/f_fault_escape_pub_needs_decl.tc` | A-36 边界：`pub fn` 逃逸必须显式声明（T-MAT-E772）。⚠ 刻意**不调用**它 ⇒ 只有 1 条诊断，无派生噪声 | B5a | ✅ |
| `fail/f_fault_escape_multi_group.tc` | A-37：同时暴露两个组 ⇒ T-MAT-E773（v1 不支持跨组 tag 重映射）。同理刻意不调用 | B5a | ✅ |
| `examples/faultescape_demo.tc` + `.expected.txt` | **推导的运行期行为**（双后端逐字节）：直通 / 直通传播 / 三层链路 / 内层已修好取 `val` / **两组共存**。`0/bob 3/anon 3/anon 0/bob 200/old` | B5a | ✅ 双后端逐字节一致 |
| 待补 | **早期返回脱糖**（`var x = <call>;` ⇒ `if (tag != 0) return;` + 绑定 `val`） | B5b | ⬜ A-38 的直通已够用 |
| 待补 | @main 之外由运行时接手（A-19 落地：打印 + 非零退出码） | B5c | ⬜ |
| 待补 | 跨函数**编译期**可达集（未上传的 repair 可被静态判定 + 诊断） | B6 | ⬜ |

`predpat_demo` 的期望输出（12 行）：`-1 1 0 9 0 0 7 5 0 3 2 1`
——其中 **0 是刻意设计的「不该命中」分支**，命中即说明谓词或分派写反。

---

## 3. 门禁 · gate L2

每批落地跑一次全量（约 1h40m，24 步）。B2 实测：23 passed / 1 failed（FAIL 项为基线录制编译器用错，见 `DESIGN.md` §3.1）。

关键步（其余见 `tools/gate.mjs`）：
- 自举一代 / 自举不动点 g2==g3 / 四代不动点 g2==g3==g4
- 双轨对拍（旧轨 LLVM vs 新轨 TIR）—— ⚠ 资源竞争下会**误报 FAIL**，遇红先独立复跑同一 g3 的 `_diffpipe.mjs` 全量再判
- run_examples 双后端
- C 后端自举（tc.c → clang → conformance）
- 产物快照（`ir_snapshot`）—— ⚠ 基线**必须用 gate 的 `out/dbg/g1.exe` 录制**

---

## 4. 手测清单（阶段三出口闸门③）

用户手动跑的项，AI 不代判：

1. `tc run examples/predpat_demo.tc` 输出与 `.expected.txt` 一致
2. 故意把谓词写反（`<` ↔ `>`），确认**不命中**分支的行为符合直觉
3. （B4b 后）`trap` 里选不同 repair（`.use_default` / `.clamp` / `.anon`），确认执行位置无关（路径③ 的核心承诺）；把 `.abort` 换成 `recover(...)`，确认上传与就地修复的行为差异
4. （B4 后）不写 repair 也不 recover 的 fault，确认运行时接手并给出非零退出
