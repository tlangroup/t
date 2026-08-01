# 语法规则草稿 · 编译期数据导入（ImportDecl）  [DRAFT]

> 依据：`src/tc.tc` `parse_import_decl`（L5535–L5550）+ `docs/reference.md` §3.6.1（import_csv / import_json）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
ImportDecl: "import" String ("as" Ident)? ";"
```

- 仅接受字符串路径字面量（`expect_tok("String")`，L5537）。
- 可选 `as 别名` 重命名导入表（L5541）。

## 2. Where（约束）

- 导入发生在**编译期**，CSV/JSON 于编译期解析并固化为静态常量表（数据优先，对应宪法数据一等公民）。
- 导入目标为外部数据表（非模块/命名空间导入），`examples/*.tc` 中常见 `import "data.csv" as tbl;`。
- 路径为编译期常量，无运行时文件读取（reference §3.6.1 ✅ tote）。

## 3. 示例

```t
import "assets/levels.csv" as levels;
import "config.json" as cfg;

fn main() -> i32 {
    // levels / cfg 为编译期固化的静态常量表
    return 0;
}
```

## 4. 与既有构造关系

- 导入数据表作为一等公民供程序消费，与 `struct`/`enum` 互补（reference 数据驱动架构）。
- 与模块系统无关（t 当前无 `import module` 语义）。

## 5. L-14 铁律校验预留

- `import_csv`/`import_json` 已实现（reference §3.6.1 ✅ tote）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 唯一 `import "path" as x;` 写法 |
| L-02 显式 | ✅ | 路径字面量显式，编译期固化 |
| L-03 静态类型 | ✅ | 导入表类型由内容静态推断 |
| L-14 铁律校验 | ✅ | 已实装 |

## 7. L-04 张力

无内部张力。`import`（数据）与 `KwExport`（注解）命名接近但语义不同，不构成等价多写。
