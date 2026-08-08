# 里程碑程序归档

自举过程中 M5–M7 阶段的三个**独立可执行程序**，各自带 `main`，用来与种子编译器 tc0
（TypeScript 实现）逐字节对拍，验证「用 t 写 t 的前端」这条路走得通。

| 文件 | 里程碑 | 对拍基准 |
|------|--------|----------|
| `lexer.tc`   | M5 词法分析器 | `tc0 lex --json` |
| `parser.tc`  | M6 语法分析器 | `tc0 parse --json` |
| `checker.tc` | M7 类型检查器 | `tc check --json` |

**它们不是编译器的组成部分**，不参与 `tc` 的构建，也不再维护。

现役编译器本体在 `src/`，按编译步骤分层为
`base → lex → parse → sema → codegen_c → codegen_ll → tc`（见根 README「编译器源码结构」）。
本目录下的 `lexer.tc` / `parser.tc` / `checker.tc` 与 `src/lex.tc` / `src/parse.tc` / `src/sema.tc`
**没有代码关系**，只是历史阶段的同名概念。

需要复原当年的对拍，用 git 历史：`git log --follow archive/milestones/lexer.tc`。
