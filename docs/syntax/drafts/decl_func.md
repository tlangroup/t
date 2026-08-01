# 语法规则草稿 · 函数声明（FuncDecl）  [已并入 reference.md（失效）]

> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过；本次为早期「按指令忽略」后的补采纳，仅采纳 decl_func，match.md 仍忽略），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.1。
> **依据**：`src/tc.tc` `parse_func_decl`（L5454–L5497）+ `docs/reference.md` §3.1 / §2.8（函数声明为手写 `parse_func_decl`，非 GEN 区）。
> **⚠ 语法已变更（2026-08-01 后）**：本草稿正文保留采纳当时的历史形态 `Name :: func(...)`。此后 `::` 绑定算子被移除、关键字 `func` 更名为 `fn`，函数声明现为并置式 **`Name fn(...) -> Ret`**。正文不改（历史真实），执行以 `docs/reference.md` §3.1 为准。

## 1. EBNF（§1 Notation）

```ebnf
FuncDecl: FuncName "::" "func" "(" (Param ("," Param)*)? ")" "->" Type FuncAnns? Block

FuncName: IDENTIFIER
Param:    ParamName ":" Type Annotation*
FuncAnns: Annotation*
```

- 前置注解（可选）→ `FuncName` → `::` → `func` → 参数表 → `->` → 返回类型 → 后置注解（可选）→ `{ 函数体 }`。
- `KwComptime` 可置于声明最前（`parse_declaration` L5612）标记编译期函数。
- 注：外部声明（`;` 收尾、无函数体）不在本采纳文法内；当前 `src/tc.tc` 函数声明须带 `{ }` 实现块，`;` 外部声明形态未实现。

## 2. Where（约束）

- 返回类型 `Type` 必写（无隐式返回，reference §3.1「禁止隐式返回」）。
- 参数为 `名称: 类型` 形式，可挂注解（`parse_func_decl` L5463 `parse_annotations`）。
- 入口由 `@main` 注解标记（reference §4 / L1061），非固定名 `main`。
- **禁止重载**：同名同签名函数不可重复声明（reference §3.1 spec §1.3）。

## 3. 示例

```t
app_entry :: func() -> i32 @main {
    return 0;
}

// 带注解与编译期
@inline
serialize :: func(v: Vec) -> string {
    return to_string(v);
}
```

## 4. 与既有构造关系

- 函数**调用**为表达式，见 `expr_postfix.md`（后缀 `(` `)`）。
- 函数**类型** `func(...) -> Ret` 见 `types.md`（当前 spec-only）。
- 函数**子句模式匹配**（`fn f(pat) {B}` 自由式子句）见 `match.md` —— 该草稿因与本条绑定式 + 禁止重载冲突 ❌，按指令忽略、未采纳；本规则以绑定式 `Name :: func(...)` 为唯一函数声明形态。

## 5. L-14 铁律校验预留

- `conformance.mjs` / `difftest.mjs` 已覆盖函数声明（reference §3.1 ✅）。
- 注解名 snake_case（`T_NAME_ANNOTATION_LOWER`）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 绑定式 `Name :: func(...)` 为唯一函数声明形态；`match.md` 自由式子句未采纳，无等价多写 |
| L-02 显式 | ✅ | 参数/返回类型显式，无隐式返回 |
| L-03 静态类型 | ✅ | 签名静态确定 |
| L-14 铁律校验 | ✅ | 门禁已覆盖 |

## 7. 跨草稿张力（已决）

`match.md` 草案 §7.2 曾引入自由式 `FuncDecl: "fn" FuncName "(" ... ")`（自由式 + 模式重载），与本条绑定式构成 L-04 冲突。经 2026-08-01 裁定：**仅采纳 decl_func（绑定式），match.md 维持忽略**，该张力以「绑定式为唯一函数声明形态」结案，`match.md` 不入参考手册。—— 后续（同日用户指令「match 的函数声明语法要与 decl_func.md 保持一致」）已将 `match.md` L32 的 `FuncDecl` 改写为与本条完全一致的绑定式 `FuncName "::" "func" (...) -> Type`（无 `fn` 自由式），声明层 ❌ 张力已消解；`match.md` 仍因实装缺失（L-14 门禁未覆盖）维持 DRAFT、不采纳。
