// 编译器源码集合 —— 2026-08-08 起 src/tc.tc 由单体拆分为「按编译步骤分层」的多模块。
// 静态检查类工具需扫描全部模块，否则只看到入口 shim（~350 行）而假绿。
//
// 顺序即 import DAG 顺序：靠前的模块不得引用靠后模块的符号（tools/dagcheck 可校验）。
export const TC_MODULES = [
  'src/base.tc',        // 共享基础设施：AST 节点池、诊断、字符串/切片工具
  'src/lex.tc',         // step 1 词法
  'src/parse.tc',       // step 2 语法 + 前端 lowering
  'src/sema.tc',        // step 3 语义（类型检查 / CTFE / TypeDesc 池）
  'src/comptime_fold.tc',    // step 3.5 全量 comptime 折叠（依赖 sema，被 tc.tc 在 run_check 后调用）
  'src/test.tc',        // `tc test` 测试收集与运行器（依赖 sema / tir / tir_to_ll）
  'lib/repl.tc',        // REPL 模式（外部库；依赖 base，不修改 tc）
  'src/tc.tc',          // driver / main（import test + repl 并派发）
];

// 传入 CLI 参数：无参数或指向编译器入口时展开为全部模块，否则原样返回。
export function resolveSources(arg) {
  if (!arg) return TC_MODULES;
  const norm = arg.replace(/\\/g, '/');
  if (norm === 'src/tc.tc') return TC_MODULES;
  return [arg];
}

// 判断这批文件是否构成完整的编译器源码集（用于「防假绿」样本量断言）。
export function isFullCompiler(files) {
  return files.length === TC_MODULES.length;
}
