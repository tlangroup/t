# 语法规则草稿 · defer 语句（DeferStmt）  [DRAFT]

> 依据：`src/tc.tc` `parse_defer_stmt`（L5231–L5236）+ `docs/reference.md` §2.8（`@node defer la=list`）。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
DeferStmt: "defer" Block
```

- `defer` 后必须接块 `{ ... }`（L5233 `parse_block`）。
- 块内语句在函数/作用域退出时按**后进先出（LIFO）**顺序执行（延迟执行语义）。

## 2. Where（约束）

- `defer` 仅接受单一块，不接受裸表达式（与 `comptime` 不同，见 `stmt_comptime.md`）。
- 延迟块捕获的是**退出时**的变量状态（引用语义），非定义时快照。
- 当前为下沉胶水节点 `mk_defer`（reference §2.8 `@node defer`），语义实现程度以 reference 状态标记为准。

## 3. 示例

```t
fn write_file(path: string) -> i32 {
    var f = open(path);
    defer { close(f); }   // 函数返回前关闭
    // ... 使用 f ...
    return 0;
}
```

## 4. 与既有构造关系

- `Block` 文法见 `stmt.md`（块语句）。
- `defer` 与资源显式绑定（宪法第12条「资源显式绑定」）契合，避免隐式 GC。

## 5. L-14 铁律校验预留

- `defer` 解析节点已定义（reference §2.8 `@node defer`），实现状态以 reference 标记为准（spec-only 风险）。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 唯一 `defer { }` 写法 |
| L-02 显式 | ✅ | 延迟执行块显式书写 |
| L-03 静态类型 | ✅ | 块内类型静态检查 |
| L-14 铁律校验 | ⚠️ | 节点已定义，门禁覆盖状态待核 |

## 7. L-04 张力

无内部张力。注意 `defer` 与 `@panic_handler` 注解语义不同（前者为语句、后者为函数约束）。
