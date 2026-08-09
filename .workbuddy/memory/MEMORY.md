# t 语言编译器 — 项目笔记

## 协作偏好
- **不中途停下**：除非需用户拍板（选项无法决断/不可逆破坏数据），否则一路跑到底。

## 概览
- **t**：静态类型、数据驱动、ECS 取向，`.tc`；宪法 `docs/constitution.md`、手册 `docs/reference.md`。
- 并置声明式：`Name fn(...) Ret {}` / `struct` / `enum : u8` / `flag[u16]` / `variant` / typealias `Name Type;`。`->` 可选，`func` 已移除。
- `import(Path [ "::" List ] [ "as" Alias ]) ";"`：`Path` 点分，首段 `src`→本项目源码根，否则查 `lib/` 再查依赖库；`::` 仅用于选择性列表（`a as b`/`*`，= AST 改名 Pass 3）。错误码 `T_IMPORT_{BAD_PATH,NOT_FOUND,CONFLICT}`/`T_MODULE_{NO_SYMBOL,PRIVATE}`。
- `src/tc.tc` 自举编译器（默认 LLVM）→ `out/<mode>/tc.exe`；`src/tote.tc` 包管理；`gen/tc.tc` 冻结。
- **语言不支持三元 `?:`**。入口写法 `main_fn fn() i32 @main`。

## 模块结构（9 模块，顺序即 import DAG，靠前不得引用靠后）
`base` → `lex` → `parse` → `sema` → `codegen_c` → `codegen_ll` → `test`(`tc test` 运行器) → `repl` → `tc.tc`(driver+`main`)。清单 `tools/tc_sources.mjs`。
- **`tc.tc` 只做 CLI 派发**：改 test 改 `src/test.tc`，改 REPL 改 `src/repl.tc`。
- 模块名 = 符号 mangling 前缀（`@t.base__*`）。改名验证：`ir_snapshot` 不 update 跑一次，差异须恰好 3 处且全是 `src/tc.tc::{ll,c,h}`。批量 `sed` 长名优先。
- ⚠ **跨模块调用必须 import 被调方**，否则 sema 找不到签名 → 链接期 undefined。
- ⚠ 未定义「变量」硬错误，未定义「函数」只降级 `; UNSUPPORTED call` 静默产坏 IR ⇒ 必跑 `node tools/dagcheck.mjs`（已接 gate）。
- `catn_check`/`shadow_check`/`dagcheck` 各带防假绿下限（934 catN / 634 fn / 3700 var / 590 符号）；改模块清单要同步下限。
- 里程碑程序归档 `archive/milestones/`，不参与构建。方法论见用户级 skill `monolith-module-split`。

## 架构红线
1. tc 只管 lex/parse/sema；功能走可插拔 `.tlib`+`import`。tc 不读环境变量，只给中性 `getenv`+`--lib-dir`。
2. agent：`state`=Component、`step`=System 之一；`X agent {state; step}` 唯一写法，不扩语法。
3. t 无 `extern`/FFI/网络；Edge 进程外；`step` 纯函数记意图，运行时 `drive_*` 回填。

## 构建 & 门禁
- `out/dbg/`(`-O0 -gcodeview`)/`out/rls/`(`-O2`)。`node tools/gate.mjs L0|L1|L2`，**串行**。
- L0(~72s，6/0)：static→boot_std→boot1(g1)→snapshot→conform→unsup=0。L1 +boot23/examples/diffgen。L2(~132-263s，14/0) +boot4 四代不动点/C 自举/difftc0/rls/tote。
- **IR 漂移归零三步**：① `cp out/dbg/g4.exe out/dbg/tc.exe`(+`cp out/rls/gr.exe out/rls/tc.exe`)；② `node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`（**须用当次 g1**）；③ 复跑 gate。
- **判不动点只比 emit-ll `.ll` md5，不比 exe md5**。
- `ir_snapshot` 工作目录每轮独占 `out/dbg/irsnap.<pid>`，清理一律 detached 后台（Windows AV 持锁会把 29s 拖成 8min 超时）。
- ⚠ 安装 g4→tc.exe 常被 OS 索引器/AV 锁（`Device or resource busy`），后台有界重试即可（实测数分钟后释放）。
- 新增运行时符号 → `node tools/build_runtime.mjs`；构建 std → `node tools/build_std.mjs`；`tc build --output out/dbg/tote`（不带 .exe）。
- ⚠ **gate 不校验 GEN 区**（`totter` 已放弃）。GEN 区现为手写维护，改编译器须同时改 `docs/reference.md` 与 `src/*.tc` GEN 区。⚠ 手写新代码别落进 `>>> GEN:xxx ... <<<` 区间内。

## 实现铁律（致命坑）
- `sb_catN` 实参必 ==N，最大 `sb_cat6`（无 7/8/9）；超了用嵌套 `sb_cat4` 或 `sb_new`/`sb_append_str`/`sb_to_str`。
- 同名局部不可异型；`a=b` 是 `"assign"`。LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang `-O0` 非 `-Od`；`llvm-ar rcs` 非 `llvm-lib`。
- **新增内建须六处齐全**：`builtin_ret`(sema)/`td_calls`(codegen_c)/C emit/LLVM emit/`llph` declare/runtime 实现(`t_runtime.{c,h}`+`t_shim_ll.c`)。漏一处 → 静默 `; UNSUPPORTED call`。半残先例：`to_string`、`assert_*`。
- 顶层声明两条解析路径：`parse_unit`（入口）+`load_module_file`（import 模块），合成顶层声明两处都挂钩。
- `Node` 仅 `na/nb/nc/nd`+`la/lb/lc`（无 `ne/nf`）；`FuncDecl.lc`=语句链表头、`lb`=形参、`na`=返回类型。⚠ `la/lb/lc` 是 kids 链表头不是节点 id，须 `*_in_kids` 遍历。
- ⚠ 合成函数体必须是语句链表头（`list_push(-1,-1,stmt)`），不能传 `parse_block()` 的 block 节点（否则 `desugar_lambdas` 越界）。参考 `parse.tc` agent spawn 脱糖。
- ⚠ `Tok` 只有 `t/v/line/col`，无字节偏移；源文本在 `tokenize()` 后不可达 ⇒ 需源码切片必须**解析期就地捕获**（f-string 即此模式：整段扫成一个 token）。
- ⚠ `diag_new` 的 `sev` 对未注册码必须显式传 `"warning"`（`diag_sev()` 未注册返回 `""`）。
- ⚠ `can_cast` 对整数↔整数无条件 true（sema.tc:290）⇒ 收窄靠**收窄点单独查**。`W_OVERFLOW_LITERAL` 由 `intlit_overflow_warn` 在四处发射：`check_call_args`/`var_decl` 初始化/`assignment`/`return`。
- ⚠ 整数字面量按量级推最小无符号类型（≤255→u8…）⇒ `-255` 求值为 `1`（既有语义，非 bug）。
- ⚠ 一元负号 AST 是 `kind=="unary" && sa=="-"`，`na` 指向 `int` 子节点；剥壳时**先存子节点 id 再覆写变量**。
- 新增关键字前全库扫同名标识符；`string`/`StringBuilder`/`void`/`map`/`flag` 是关键字。语境关键字先例：`flag_set`、`test`/`suite`。
- ⚠ C 关键字撞名会产坏 `.c`（`unsigned` 等）；已加 `W_C_KEYWORD_IDENT` 防御。
- conformance 只跑 check，用例首行必须 `// EXPECT: pass` / `// EXPECT: error T_XXX`；运行期语义配 `examples/<name>.expected.txt`。
- ⚠ **stdout 是机器可读通道，编译期输出一律走 stderr**（conformance 逐字节对拍 stdout）。`tc build` 成功时 stdout 只输出 warning 行。
- ⚠ `examples/` 只能放可编译文件（`ir_snapshot` 逐个 emit）；设计稿放 `docs/`。
- ⚠ 透传型表达式节点（`paren`/`comptime`）须查全 4 处：`expr_type_desc`、`ll_etd`、`emit_expr`(C)、`emit_lle`(LLVM)。同理 `match` 的 `ll_etd` 须回 `ll_etd(match_first_body(e))`。
- ⚠ emit 循环跳过泛型须 `if/else` 而非 `continue`（否则死循环至 arena abort）。
- ⚠ 单态化缓存命中也必须改写调用点（`rewrite_generic_callsite` 置 `nodes[e].bb=true`）。
- ⚠ typealias 成员访问 GEP 必须 `ll_alias_base_name` 解到底层 struct 再 `%st.<base>`，否则 `ptr null` → SIGSEGV。C 后端 `expr_type_desc` 对别名成员仍返回 unknown（残留 gap，靠 typedef 兜底）。
- ⚠ `meta T: type` 在 CTFE 不能当值求值（走 `meta_type_arg_node` 存 `g_menv_ty`）；CTFE 数组值是值类型，绑定/赋值/传参三处须 `meta_val_copy`。
- ⚠ 泛型模板注册期类型参数用 `g_gen_tparams` 识别（`check_func_decl` 对泛型永不执行，别在那登记）。
- ⚠ `run_check` 声明注册分三趟：纯类型 → typealias → 函数/全局/常量（支持前向引用）。
- ⚠ `src/tc.tc` 的 `slice_len(argv) < 3` 门槛会挡无参子命令，须在门之前特判。
- 排查 OOM/死循环：arena abort 时 `eprint` 不刷，分段打点 stderr 二分定位；`.ll` 里 `ptr 0` 常是 UNSUPPORTED 占位。

## 已完成特性（要点）
- **测试语法**（08-08）：`"名字" test {}` / `"名字" suite {}` 并置式 + `expect` 内建；旧注解走 `W_TEST_ANNOTATION_DEPRECATED` 过渡。脱糖成 `__test_<n> fn() bool @test`，显示名存 `FuncDecl.sb`、suite 路径 `sc`。reference §3.14。
- **f-string**（08-09）：`f"..."` / `f"""..."""`，解析期整体脱糖为 `format(模板, 实参...)`，复用 `desugar_format_call`→`__fmt_N`。转换字段 `!s/!r/!a/!j/!p/!c` 六种，**均可作用于任意值类型**：字符串走 `sb_append_fmt_str_conv`（按 mode 区分 r/a/j/p/c 转义），标量（整数/浮点/bool）序列化即裸值（json/pbtxt/csv 等价）。语义：`!s`str `!r`repr `!a`ascii(UTF-8 解码后 `\uXXXX`，非按字节 `\xHH`) `!j`json(控制字符 `\u00XX`) `!p`pbtxt(protobuf 风格转义) `!c`csv(仅含 , " CR/LF 才加引号、内部 " 翻倍)。`T_FMT_BAD_CONVERSION` 由 `desugar_format_call` 的 conv 合法性检查发出（手写 `format()` 模板可触发；f-string 里 `!z` 这类非法字母在解析期直接报错）。`T_FMT_CONV_TYPE` 现已不可达。`tc run` 链接**预编译运行时库**（`node tools/build_runtime.mjs` → `out/<mode>/deps/t_runtime.lib`），改 `runtime/t_runtime.c` 后必须重建该库，否则改动不生效。reference §3.10.7；测试 `p44_fstring_ok.tc`/`f52_fstring_conv_type.tc`/`examples/fstring_demo.tc`+`.expected.txt`。
- **M-any / M-meta A→E**：`comptime T: any` 单态化；`meta`/`type`、CTFE 求值器、值参数单态化、编译期内建（`@compile_error`/`@type_equal`/`@type_size`/`@type_name`/`@zeroed`/`@str_from_bytes`）。reference §3.6.2/§3.6.3、`docs/meta_design.md`。
- **agent 主线**：Colony 调度体（`examples/lib/colony.tc`）。

## std 库（lib/std）
- 已落地 `mem` + `math`（均 `export`）。`import(std.mem)` / `import(std.math)` 双后端已验证。详见 `docs/std.md`。
- tc↔std 循环依赖解法：std 对 tc 零语义依赖（只依赖内建+运行时）+ 构建期预编译 `.tlib`。
- ⚠ 链接模式只 `declare` 导出符号 ⇒ 新增公开 API 务必 `export`，否则**链接期** undefined。
- 已知限制：泛型函数体内嵌套泛型调用不被单态化（`instantiate_generic` 待修）；t 无 `&`/`*` 运算符（无裸指针）；浮点超越函数为泰勒近似。

## REPL（裸 `tc` 进入）
- 设计 = clean-subprocess：每条输入重编 `decls+input` 成 `out/repl/repl_exe.exe` 再跑 ⇒ **跨行可变状态不持久**。
- 元命令 `:help :quit :reset :dump :load <file>`；`repl_is_decl` 区分声明 vs 表达式；值形态 `println(format("{}",expr))`、失败再语句形态。
- 警告可见性：`repl_build` stdout→`build.log`（只装警告）、stderr→`build.err`；`repl_surface_warnings` 三条路径回显。
- 打印走 `t_print`/`t_println`（`fwrite` 原始字节，`_O_BINARY`，无转码）；中文显示取决于终端是否 UTF-8。

## 技术债
- fid v1.5：protobuf/聚合序列化待 v2；闭包环境不回收（有意泄漏）；`@derive` 9 trait 手写；type_info 仅 struct。
- C 后端大结构体按值返回段错误 → 用 `[]T` 切片规避。
- `examples/` 中 5 个 agent/colony 示例长期 emit 失败（预存 gap，非回归）。
- **远期 std 蓝图（NOW-SKIP）**：collections/sort/search、text&data(str/fmt/json/regex/…)、program(io/fs/path/time/…)、net/http。
