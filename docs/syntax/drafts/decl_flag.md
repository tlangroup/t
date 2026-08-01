# 语法规则草稿 · 位域声明（FlagDecl / FlagSetDecl）  [DRAFT]

> 依据：`src/tc.tc` `parse_flag_decl` / `parse_flag_set_decl` + `docs/reference.md` §2.8 `flag_decl`/`slot`/`flag_set_decl`/`setmember` / §3.1。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
FlagDecl: Ident "flag" ("[" Ident "]")? Annotations? "{" FlagSlot* "}"
FlagSlot: Ident ":" Integer Annotations? ("," | ";")?
FlagSetDecl: Ident "flag_set" Annotations? "{" FlagSetMember* "}"
FlagSetMember: Ident ":" Integer Annotations? ("," | ";")?
```

- `FlagDecl` 可选的 `"[" Ident "]"` 为元素名（如 `flag[bool]` 表示 1bit 布尔位），缺省 `u32`（`parse_flag_decl` L5315 `str_or(@Ident,"u32")`）。
- `FlagSlot` 的 `Integer` 为位宽；`FlagSetMember` 的 `Integer` 为位偏移。

## 2. Where（约束）

- 位域自上而下**自动分配比特**，1bit 布尔位允许位运算，≥2bit 数值位域仅用 `flag_set`/`flag_get`（reference L842）。
- `@offset(N)` 注解强制某槽起始位（`flag_offset_of` L5352）。
- 成员可逗号/分号结尾（GEN 兼容）。
- 运行期内建：`flag_set`/`flag_get`/`flag_toggle` 等（reference §3.7）。

## 3. 示例

```t
// 1bit 布尔位域（元素为 bool）
Perms flag[bool] {
    Read;
    Write;
    Exec;
}

// 带偏移的数值位域
Header flag {
    tag: 4 @offset(0);
    len: 12 @offset(4);
}
```

## 4. 与既有构造关系

- `flag[N]` 类型在类型系统中也可作数组位域，见 `types.md`。
- 位域内建函数在 `reference §3.7`，非语法规则。

## 5. L-14 铁律校验预留

- `flag_decl`/`slot`/`flag_set_decl`/`setmember` 已由 GEN 生成，difftest/conformance 验证（reference L486 ✅）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | `Name flag { }` / `Name flag_set { }` 唯一写法 |
| L-02 显式 | ✅ | 位宽/偏移显式，无隐式分配 |
| L-03 静态类型 | ✅ | 定宽位域，静态可查 |
| L-14 铁律校验 | ✅ | GEN + 门禁覆盖 |

## 7. L-04 张力

无内部张力。注意 `flag_set`（声明）与类型系统 `flag[N]`（类型）命名接近但分属声明与类型两章，不构成等价多写。
