# t REPL 设计文档

> 版本 v1 ｜ 状态：**设计中（design draft）** ｜ 关联规范：`docs/design.md` §2.7（REPL 依赖的 tc 能力，审查中）、`docs/diagnostics.md`
> 实现位置：`lib/repl.tc`（裸 `tc` 进入 REPL；按包名 `import(repl)` 引用，契合「REPL 不修改 tc」红线）。

---

## 0. 设计红线（首要原则）

**REPL 不修改 `tc` 编译器。**

REPL 是构建在 `tc` 之上的**薄编排层（orchestration layer）**，通过把 `tc` 当成一个「干净子进程」来复用成熟的前端 / 后端 / 链接链路。REPL 源码（`lib/repl.tc`）只依赖 `tc` **已公开暴露**的能力（子进程 `build`/`run`、诊断输出格式、路径格式）与 `src.base` 的通用工具，**绝不**为 REPL 往 `tc` 里塞任何 REPL 专属逻辑或补丁。

> 任何 REPL 需要 `tc` 提供的新能力，**一律登记为 `tc` 侧的设计提案**，走 `docs/design.md` 的合规审查流程（rubric + 批准），由 `tc` 设计层独立决策；REPL 仅作为「依赖方」引用。本文件 §5 列出当前 REPL 对 `tc` 的能力依赖清单，每一项都回指 `docs/design.md` 的提案编号。

这条红线是本设计的出发点，也是历史实现偏差的纠正点：早期 REPL 为了「人类可读报错 / 相对路径」曾在 `tc` 中新增了 `--diagnostics`、`rel_path`、`print_human`、`emit_diags` 等代码。按本红线，这些能力现在应作为 **`tc` 的设计提案独立审查**（见 `docs/design.md` §2.7），而非「REPL 的私有补丁」。

---

## 1. 目标与非目标

- **目标**：交互式即时求值（表达式 / 语句 / 顶层声明）、面向人的诊断、特殊变量 `ans`、元命令。
- **非目标**：
  - 不引入新的编译器前端 / 后端特性；
  - 不做持久化跨进程状态（每次求值都是全新进程）；
  - **不修改 `tc` 源码**（红线）。

---

## 2. 架构：干净子进程模型（clean-subprocess）

- 裸 `tc`（无参数）进入 REPL。`run_repl` 把自身可执行路径记为 `me`，作为子编译器。
- 每次输入：把「截至当前的会话声明 `decls` + `ans` 注入 + 新输入」拼成一份完整 `.tc`，写到 `out/repl/snippet.tc`，交给 `tc build`（子进程）编译，再直接运行产物 `out/repl/repl_exe.exe`。
- 每条输入都是**全新进程** → 不存在全局状态在多次求值间被污染（无隐式状态，契合 L-09 确定性 / 极简 runtime）。
- 代价：每条表达式都走一遍 clang 链接（~1–2s），交互式可接受。

```text
 t（裸）──► run_repl
                │  拼装 snippet.tc = ans_decl + decls + 分类形态(input)
                ▼
         tc build snippet.tc --output out/repl/repl_exe.exe --mode dbg --diagnostics human
                │  （干净的子进程；stdout→build.log / stderr→build.err）
                ▼
         out/repl/repl_exe.exe  ──► stdout / stderr 回显用户
```

---

## 3. 输入分类策略（无需解析器介入）

REPL **不在自身实现 `t` 的词法 / 语法分析**，而是用「拼装 + 试编译」做分类，依序尝试直到成功：

1. **声明形态**：拼接 `decls + 输入 + __repl_eval fn() i32 @main { return 0; }`，编译成功则视为顶层声明，保留进会话 `decls`。
2. **值形态**：拼接 `__repl_eval fn() i32 @main { println(format("{}", <input>)); return 0; }`，编译成功则按表达式求值并打印结果。
3. **语句形态**：拼接 `__repl_eval fn() i32 @main { <input>; return 0; }`（用 `repl_term` 收口尾 `;`/`}`），编译成功则仅执行、不打印返回值。
4. **全失败**：展示最后一次构建的人类可读错误日志（`build.log`）。

多行输入用括号 / 花括号 / 方括号配平（`repl_balanced`）判定完整性，未配平时继续读（显示 `.. ` 续行提示）。

> 该策略把「这条输入是声明 / 值 / 语句」的判定完全外包给 `tc` 的编译期检查，REPL 自身零语法知识 —— 这是「不修改 tc」且「与 `tc` 永远一致」的关键。

---

## 4. 面向人特性

- **值打印**：值形态用 `format("{}", expr)` 打印；`1+2` → `3`。
- **`ans` 特殊变量**：保存上一条表达式 / 语句的 stdout（字符串形式）。每轮把 `last_out` 经 `repl_escape_str` 转义后注入 snippet 顶层 `var ans: string = "...";`，使后续输入可引用上一条结果。`:reset` / `:load` 清空。
- **人类可读诊断**：REPL 调用 `tc build ... --diagnostics human`，把内层 `tc` 的诊断以人类可读文本呈现（而非 JSON 机器格式）。这一**能力由 `tc` 提供**（见 §5 R2），REPL 只消费。
- **相对路径**：内层 `tc` 诊断的 `file` 字段使用相对工程根目录路径（如 `out/repl/snippet.tc`），由 `tc` 的 `rel_path` 保证（见 §5 R3），符合已批准 `docs/diagnostics.md` §1.1。

---

## 5. 对 `tc` 的能力依赖清单（不改 `tc` 原则）

REPL 仅依赖 `tc` 已暴露 / 已批准的能力。任何新增依赖都登记在 `docs/design.md` §2.7 走审查：

| 编号 | 能力 | 来源 | REPL 用法 | 状态 |
|---|---|---|---|---|
| **R1** | `tc` 子进程 `build`/`run` 接口 | 已存在 | `sys_run("tc build <src> --output <exe> --mode dbg")` + `sys_run("<exe>")` | ✅ 已具备 |
| **R2** | 人类可读诊断输出模式 | `tc` 提供 | `tc build ... --diagnostics human` | ⏳ 审查中（flag 命名待决，见 `design.md` §2.7.1） |
| **R3** | 相对工程根路径 | `tc` 提供 | `tc` 诊断 `file` 字段输出 `src/...` 而非绝对路径 | ✅ 已与规范一致（见 `design.md` §2.7.2） |

> 红线重申：R2 / R3 的**实现属于 `tc`**，由 `docs/design.md` §2.7 审查、批准、落地；REPL 文档不规定 `tc` 的 flag 名称或内部函数，只声明「需要这样一种能力」。审查决策落地前，REPL 临时使用现状接口，不构成对 `tc` 设计的承诺。

---

## 6. 元命令

| 命令 | 行为 |
|---|---|
| `:help` / `:h` | 显示帮助 |
| `:quit` / `:q` | 退出 REPL |
| `:reset` | 清空已定义会话声明（含 `ans`） |
| `:dump` | 打印当前累计的会话声明源码 |
| `:load <file>` | 载入 `.tc` 文件内容到会话（编译验证后并入 `decls`） |
| `:clear` | 清屏（ANSI 转义） |
| `:names` | 列出当前会话已定义的符号名 |
| `:show <name>` | 打印某符号的声明源码 |
| `:history` | 列出本次会话输入历史（跨会话持久化于 `out/repl/history.txt`） |
| `:r <n>` | 重新执行第 `n` 条历史输入（编号见 `:history`） |
| `:time <expr>` | 求值表达式 / 语句并打印耗时（微秒） |

`ans` 为特殊变量（非命令），保存上一条表达式 / 语句的输出。

---

## 7. 已知约束与边界

- 每条输入 ~1–2s（clang 链接代价），属设计权衡，非缺陷。
- 语句形态若用户自带尾 `;` 会引发 `;;` → 已由 `repl_term` 收口（仅当末字符非 `;`/`}` 才补 `;`）。
- 裸 `|v|`（无类型标注）仍报 `T-PAR-E101`：`t` 要求函数形参显式类型，REPL 未做形参双向推断 —— 这是 `t` 语言层决策，REPL 不越界。
- REPL 不缓存跨进程可变状态；「跨行可变状态不持久」是干净子进程模型的固有性质（见 §2）。

---

## 8. 审查与合规追踪

- 本设计本身的合规要点（按 `docs/design.md` #5 框架速览）：
  - **L1-③ 轻量 runtime** ✅：REPL 零新增 runtime，全部复用 `tc` 子进程。
  - **L1-⑤ fail-fast** ✅：所有错误在 `tc` 编译期拦截，REPL 仅透传。
  - **L4 冲突分类** ✅：不触碰 `t` 类型层 / 运行层 / 哲学层，纯工具编排。
- **待审查项（在 `tc` 侧，非本文件）**：R2 人类可读诊断的 flag 命名冲突（`--diagnostics` vs 已批准 `--format`）→ `docs/design.md` §2.7.1。R3 已与规范一致。
- 本文件**不**对 `tc` 做任何规范承诺；`tc` 侧任何改动由 `docs/design.md` 独立审查与批准。
