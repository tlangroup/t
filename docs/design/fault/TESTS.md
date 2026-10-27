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
| `fail/f_fault_no_group.tc` | 未注册故障组（CAT 待定，B1 定） | B1 | ⬜ |
| `fail/f_clause_bad_anchor.tc` | `@clause` 锚点非法（CAT 待定，B3 定） | B3 | ⬜ |
| `fail/f_trap_wildcard_nonabort.tc` | 通配臂只允许 `resume(.abort)`（A-21） | B4 | ⬜ |
| `fail/f_repair_cross_fn.tc` | repair 闭包禁跨函数复用（A-12） | B4/B5 | ⬜ |

- 诊断码唯一真源：`tools/diag_defs.json` → 生成 `src/diag_table.gen.h`。
  ⚠ 000–999 已被 `gen_diag.mjs` 的 `RANGES` 切满 ⇒ 新 CAT 只能做**区间再切分**（仿 CLA/TIM 先例）。
- 现有三条走 **MAT** 段（E743 之后递增 E745/E746），未新增 CAT。

---

## 2. 运行期 · examples golden（双后端对拍）

| 用例 | 覆盖 | 批次 | 状态 |
|---|---|---|---|
| `examples/predpat_demo.tc` + `.expected.txt` | 谓词模式：命中 / **不命中** / 边界相等 / 混合字段（`<`、`>=`、`==` 混排） | B2 | ✅ 双后端逐字节一致 |
| `examples/faultclause_demo.tc` + `.expected.txt` | 故障/修复子句的**零副作用**：声明它们的程序照常运行，且 `.pattern` 的臂展开不受影响 | B3 | ✅ 双后端逐字节一致 |
| 待补 | `fault(E)!T` 返回 + trap 分派 | B1/B4 | ⬜ |
| 待补 | repair 闭包上传 + `.abort` | B4 | ⬜ |

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
3. （B3/B4 后）`trap` 里选不同 repair，确认执行位置无关（路径③ 的核心承诺）
4. （B4 后）不写 repair 也不 recover 的 fault，确认运行时接手并给出非零退出
