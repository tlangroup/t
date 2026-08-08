# t 语言编译器 — 项目笔记

## 协作偏好
- **不中途停下**：除非需用户拍板（选项无法决断/不可逆破坏数据），否则一路跑到底。

## 概览
- **t**：静态类型、数据驱动、ECS 取向，`.tc`；宪法 `docs/constitution.md`、手册 `docs/reference.md`（GEN 区真源）。
- 并置声明式：`Name fn(...) Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。`->` 可选。`func` 已移除。
- **import（08-07 统一）**：`import(Path [ "::" List ] [ "as" Alias ]) ";"`。`Path` 点分；首段 `src` → 本项目源码根（剥 `src`），否则查 `lib/` 再查依赖库。`::` 仅用于选择性列表（`a as b` / `*`）。错误码 `T_IMPORT_{BAD_PATH,NOT_FOUND,CONFLICT}`/`T_MODULE_{NO_SYMBOL,PRIVATE}`。选择性导入 = AST 改名 Pass 3；`ImportModDecl.bd`=is_lib_path、`lb`=item 链。
- `src/tc.tc` 自举编译器（默认 LLVM）→ `out/<mode>/tc.exe`；`src/tote.tc` 包管理。`gen/tc.tc` 冻结。
- **测试语法**：见下方「测试语法现代化」节。

## 编译器模块结构（08-08 拆分：22907 行单体 → 7 模块）
- 顺序即 import DAG，**靠前不得引用靠后**：`base`(4349) → `lex`(553) → `parse`(3111) → `sema`(7545) → `codegen_c`(3226) → `codegen_ll`(3915) → `tc.tc`(379，driver+`main`)。清单在 `tools/tc_sources.mjs`。
- **模块名 = 符号 mangling 前缀**（`@t.base__*`）。改名验证：`ir_snapshot` 不 update 跑一次，差异须**恰好 3 处且全是 `src/tc.tc::{ll,c,h}`**；外溢即踩到真实标识符。批量 `sed` **长名优先**。
- ⚠ **跨模块调用必须 import 被调方**，否则 sema 找不到签名 → 返回类型错判 → 链接期 undefined。后端裸名回退治标不治本。
- ⚠ **未定义「变量」硬错误，未定义「函数」只降级 `; UNSUPPORTED call` 并静默产坏 IR** ⇒ 必须 `node tools/dagcheck.mjs`，0 反向引用（已接 gate）。
- `catn_check`/`shadow_check`/`dagcheck` 各带防假绿下限（934 catN / 634 fn / 3700 var / 590 符号）。**改模块清单要同步下限**。
- M5–M7 里程碑程序已归档 `archive/milestones/`，不参与构建。拆分前单体用 `git show <提交>:src/tc.tc` 对照。方法论见用户级 skill `monolith-module-split`。

## 架构红线
1. tc 只管 lex/parse/sema；功能走可插拔 `.tlib`+`import`。tc 不读环境变量，只给中性 `getenv`+`--lib-dir`。
2. agent：`state`=Component、`step`=System 之一；`X agent {state; step}` 唯一写法，不扩语法。
3. t 无 `extern`/FFI/网络；Edge 进程外；`step` 纯函数记意图，运行时 `drive_*` 回填。

## 构建 & 门禁
- `out/dbg/`(`-O0 -gcodeview`)/`out/rls/`(`-O2`)。`node tools/gate.mjs L0|L1|L2`。**串行**。
- L0(~72s，6/0)：static(catn+shadow+dag)→boot_std→boot1(g1)→snapshot(IR 双后端)→conform→unsup=0。L1 +boot23/examples/diffgen。L2(~132-263s，14/0) +boot4 四代不动点/cself(C 自举)/difftc0/rls/tote。
- **`ir_snapshot` 工作目录每轮独占 `out/dbg/irsnap.<pid>`，清理一律 detached 后台**。别改回固定目录+`rmSync`：Windows 杀软/索引器持有新写文件数分钟，实测 29s → 8 分钟硬超时+误报。
- **判不动点只比 emit-ll `.ll` md5，不比 exe md5**。
- **IR 漂移归零**：① `cp out/dbg/g4.exe out/dbg/tc.exe`(+`cp out/rls/gr.exe out/rls/tc.exe`)；② `node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`；③ 复跑 gate。**须用当次 g1 重录**。
- 新增运行时符号 → `node tools/build_runtime.mjs`。`tc build --output out/dbg/tote`（不带 .exe）。
- 构建 std：`node tools/build_std.mjs` → `out/lib/std/*.tlib`+`.tlibd`（嵌套路径以匹配 `import(std.mem)`）。
- ⚠ **gate 不校验 GEN 区**（`totter` 已放弃，`gen_ebnf.mjs`/`out/ebnf.json` 链路冻结）。GEN 区现为**手写维护**，改编译器须**同时改 `docs/reference.md` 与 `src/*.tc` GEN 区**保持同源。

## 实现铁律（致命坑）
- `sb_catN` 实参必==N；LLVM 不支持 `sb_cat2..6` → `sb_new`/`sb_append_str`/`sb_to_str`。
- 同名局部不可异型；`a=b` 是 `"assign"`。LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang `-O0` 非 `-Od`；`llvm-ar rcs` 非 `llvm-lib`。
- **内建注册六处齐全**：`builtin_ret`(sema GEN区)/`td_calls`(codegen_c GEN区)/C emit/LLVM emit/`llph` declare+实参校验/**runtime 实现**(`runtime/t_runtime.{c,h}`+`t_shim_ll.c`)。漏任一处 → 静默 `; UNSUPPORTED call`。半残先例：`to_string`、`assert_eq/assert_true/assert_false/assert_panic`（只有 `builtin_ret`，后端 no-op）。
- **顶层声明两条解析路径**：`parse_unit`（入口）+`load_module_file`（import 模块），合成顶层声明两处都要挂钩。
- `Node` 仅 `na/nb/nc/nd`+`la/lb/lc`（无 `ne/nf`）；`FuncDecl.lc`=语句链表头、`lb`=形参、`na`=返回类型、`sb` 槽空闲。⚠ `la/lb/lc` 是 kids 链表头不是节点 id，须用 `*_in_kids` 遍历。
- ⚠ **合成函数体必须是语句链表头**（`list_push(-1,-1,stmt)`），绝不能传 `parse_block()` 的 block 节点，否则 `desugar_lambdas` 越界。参考 agent spawn 脱糖 `parse.tc:1570-1612`。
- ⚠ **`Tok` 只有 `t/v/line/col`，无字节偏移**；源文本在 `tokenize()` 后不可达 ⇒ 需要源码切片必须**解析期就地捕获**。
- 新增关键字前全库扫同名标识符；`string`/`StringBuilder`/`void`/`map` 是关键字，`parse_primary` 不认（作类型实参须特判）。语境关键字先例：`flag_set`。
- conformance 只跑 check；新运行期语义配 `examples/<name>.expected.txt`；用例**首行必须 `// EXPECT: pass` / `// EXPECT: error T_XXX`**。
- ⚠ **stdout 是机器可读通道，编译期输出一律走 stderr**：`check` 输 JSON、`emit-ll` 输 IR，conformance 逐字节对拍 stdout。CTFE 编译期 `print` 与 `eprint` 同义。
- ⚠ **`examples/` 只能放可编译文件**（`ir_snapshot` 逐个 emit）；设计稿放 `docs/`。
- ⚠ **透传型表达式节点（`paren`/`comptime`）须查全 4 处**：`expr_type_desc`、`ll_etd`(两个)+`emit_expr`(C)+`emit_lle`(LLVM)。
- ⚠ **emit 循环跳过泛型须 `if/else` 而非 `continue`**，否则无限循环至 arena abort。
- ⚠ **单态化缓存命中也必须改写调用点**（`rewrite_generic_callsite` 置 `nodes[e].bb=true`）。
- ⚠ **`meta T: type` 在 CTFE 不能当值求值**：走 `meta_type_arg_node` 存 `g_menv_ty` 同槽（`-1`=值绑定，≥0=类型节点 id）。
- ⚠ **CTFE 数组值是值类型**，绑定/赋值/传参三处必须 `meta_val_copy` 深拷贝。
- ⚠ **`Sym` 一级化兜底必须在查过用户自定义 `Sym` 之后**。
- ⚠ **弃用别名告警用 `cur_v()` 区分原始拼写**（`meta`/`comptime` 同映射 `KwComptime`，仅 `cur_v()=="comptime"` 发 `W_COMPTIME_ALIAS`）。
- ⚠ **`src/tc.tc:35` 的 `slice_len(argv) < 3` 门槛**会挡住无参子命令，须在门之前特判。
- **排查 OOM/死循环**：arena abort 时 `eprint` 不刷，分段打点 stderr 二分定位；`.ll` 里 `ptr 0` 常是 UNSUPPORTED 占位。

## 测试语法现代化（✅ 08-08 已完成，gate L2 14/14 绿）
- 设计稿：`docs/syntax/drafts/decl_test.md`。用户已拍板：**A 并置式** `"名字" test {}` / `"名字" suite {}`；**`expect` 内建 + CTFE 自省**；**`tc test` 运行器一起做**；旧注解走**弃用别名过渡**（`W_TEST_ANNOTATION_DEPRECATED`，warning 不阻断）。
- **状态**：迁移全完成（19 处旧注解 / 4 文件 → 新语法），`docs/reference.md` §3.14 已文档化，新增 `tests/conformance/pass/p07b_test_decl.tc` 覆盖。`tc test` 抽样验证通过（basic_syntax 7passed/1skip、game_ecs 5passed/1skip/1expected-fail、protocol 2passed）。
- 旧写法：`name fn() bool @test [@test_group("g")] [@test_skip] [@test_only] [@expect_fail]`。全仓 19 处注解实例 / 4 文件（`tests/conformance/pass/p07`、`tests/samples/{basic_syntax,game_ecs,protocol}.tc`）。
- 迁移表：`@test`→`"名字" test{}`；`@test_skip`→`@skip`；`@test_only`→`@only`；`@expect_fail`→`@should_fail`；`@test_group("g")`→`"g" suite{}`。
- 脱糖：`"名" test {B}` → `__test_<n> fn() bool @test { B; return true; }`，显示名存 `FuncDecl.sb`、suite 路径存 `FuncDecl.sc`。
- `expect(E)` → `if (!(E)) { __expect_head(src,file,line); __expect_<ty>("left …", …); __expect_tail(); return false; }`。运行时 5 符号：`__expect_head/__expect_i64/__expect_str/__expect_f64/__expect_tail`（拆头+逐值+尾以控参数数）。
- 拦截点：`parse.tc` `parse_declaration`（L1794）中 L1832 的 `cur_t() != "Identifier"` 硬退出**之前**，判 `cur_t()=="String"`。`test`/`suite` 走**语境关键字**（不进 `keywords_tbl`）。

## std 库（lib/std）
- 已落地 `mem` + `math`（均 `export`）。用法 `import(std.mem)` / `import(std.math)`，双后端已验证。详见 `docs/std.md`。
- **解决 tc↔std 循环依赖**：① std 对 tc 零语义依赖（只依赖内建+运行时）；② 构建期先预编译为 `.tlib`，消费方链接模式消费。
- **⚠ 链接模式只 `declare` 导出符号**：新增 std 公开 API 务必 `export`，否则消费方**链接期** `undefined @t.math__*`（不是编译失败，难查）。
- **编译器限制**：泛型函数体内嵌套泛型调用不被单态化（漏类型后缀 → 链接期 undefined）；`clamp`/`reverse`/`contains` 已内联规避。`instantiate_generic` 待修。
- **`t` 无 `&`/`*` 表达式运算符** ⇒ 无裸指针/字节级 memcpy；`std.mem` 提供切片级等价。浮点超越函数为泰勒近似。
- **远期蓝图（NOW-SKIP）**：core(`collections`/`search`/`sort`)、text&data(`ascii`/`text`/`str`/`unicode`/`parse`/`fmt`/`codec`/`regex`/`json`/`toml`/`csv`/`pb`/`inet`)、program(`args`/`cli`/`env`/`io`/`fs`/`path`/`url`/`log`/`testing`/`time`/`rand`/`proc`/`term`/`crypto`/`pty`)、runtime&web(`net`/`http`)。

## 里程碑（近期）
- M-M / T_UNKNOWN_FIELD：struct 方法糖 flush 两处；`p.zzz` 报错防 `p.clone()` 误报。
- M-any：`comptime T: any` 编译期类型模板参数→调用点单态化。reference §3.6.2。
- M-meta A→E：`meta`/`type`、CTFE 求值器、值参数单态化、编译期内建（`@compile_error`/`@type_equal`/`@type_size`/`@type_name`/`@zeroed`/`@str_from_bytes`+`sym_intern`）、弃用别名告警。reference §3.6.3、`docs/meta_design.md`。
- agent 主线：Colony 调度体 ✅（`examples/lib/colony.tc`）。

## 技术债
- fid v1.5：protobuf/聚合序列化待 v2；闭包环境不回收（有意泄漏）；`@derive` 9 trait 手写；type_info 仅 struct。
- C 后端大结构体按值返回段错误 → 用 `[]T` 切片规避。
