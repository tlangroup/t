# 语法规则草稿 · 内建函数（Builtins）  [DRAFT]

> 依据：`src/tc.tc` 内建表（`mk_*` / `ti_mk`）+ `docs/reference.md` §3.7（Flag）/ §3.8（Sym）/ 内建调用表（L167–L169）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
BuiltinCall: Ident "(" ArgList? ")"      // 内建以普通函数调用形式出现
```

> 内建函数**无特殊语法**，以普通函数调用形态出现（与用户定义函数同形），其特殊性在于由编译器/runtime 直接提供实现。名称属保留内建名（非关键字）。

## 2. Where（约束）

- 内建为**编译期/runtime 提供的函数**，调用语法与 `expr_postfix.md` 的函数调用完全一致（无第二套调用语法，L-04 ✅）。
- 分类（reference）：
  - **IO/调试**：`print` / `println` / `eprint` / `exit`
  - **容器**：`append` / `len` / `slice_set` / `sb_append_str` / `sb_append_char` / `sb_append_u64` / `sb_append_i64`
  - **字符串拼接**：`cat2`..`cat6`（返回 string，见 reference M33）
  - **类型自省**：`type_info(T)`（见 `expr_literal.md`）
  - **Flag 位域**：`flag_set` / `flag_get` / `flag_toggle`（见 `decl_flag.md` §3.7）
  - **Sym 符号**：`sym_intern` / `sym_str` / `sym_release` / `sym_release_all`（见 `types.md` Sym 类型）

## 3. 示例

```t
println("hello");
var n = len(items);
var s = cat2("x=", int_to_str(n));
flag_set(reg, Read);
var id = sym_intern("tag");
```

## 4. 与既有构造关系

- 内建调用语法 = 普通函数调用（`expr_postfix.md`），无专属文法 → 满足 L-04 唯一语义。
- `cat2..cat6` 为固定参数个数（2–6），实参个数须严格等于 N（`catn_check.mjs` 守卫，reference 实现铁律）。

## 5. L-14 铁律校验预留

- `conformance.mjs` / `catn_check.mjs` 守卫内建调用参数个数（特别是 catN）。
- 部分内建返回类型见 reference L167–L169（`ti_mk("Void")` 等）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 内建与用户函数同调用语法，无等价多写 |
| L-02 显式 | ✅ | 调用参数显式 |
| L-03 静态类型 | ✅ | 内建签名静态确定 |
| L-14 铁律校验 | ✅ | catn_check 等门禁覆盖 |

## 7. L-04 张力

- `cat2..cat6` 六个函数形态接近（仅参数个数不同），但属「固定参数个数」设计，非等价多写（每 N 对应唯一函数），L-04 ✅。若未来引入可变参数 `cat(...)`，须先废止 cat2..cat6 以免重叠。
