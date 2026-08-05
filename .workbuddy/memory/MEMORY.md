# t 语言编译器 — 项目笔记

## 协作偏好（用户明示）
- **不中途停下**：除非确实需要用户拍板（选项无法自行决断 / 会不可逆破坏数据），否则一路跑到底，不要为确认或汇报而停。

## 概览
- **t**：静态类型、数据驱动、ECS 取向，扩展名 `.tc`；宪法 `docs/constitution.md`，手册 `docs/reference.md`。⚠ `spec.md` 已废弃冻结。
- **声明语法（M44 起）并置式**：`Name fn(...) -> Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。⚠ `::` 与 `func` 已移除。
- **`src/tc.tc`**：自举编译器（lex/check/compile/emit-c/emit-ll/build/run，默认 LLVM）→ `out/<mode>/tc.exe`。**`src/tote.tc`**：包管理，委托 tc。`src/totter.tc` 已放弃；`gen/tc.tc` 冻结快照。
- **命名红线**：`✅ tote`/`status='tote'` 意为「已实现」，绝不可改成二进制名；裸 `tote` 编译器引用 → `tc`。

## 架构红线（用户多轮裁定）
1. **tc 只管 lex/parse/sema**。具体功能（time/ser/各 Edge 适配器…）由可插拔模块库 `.tlib` 实现、靠 `import` 引入，不进编译器。**tc 不读环境变量**——只提供中性原语（`getenv`）与中性输入开关（`--lib-dir`），策略（`T_LIB_PATH`/`~/.tote/libs`）归 tote（类比 rustc/cargo）。
2. **agent 非容器**：一等公民 ≠ 罩住所有 System。`state` 只是 Component、`step` 只是众多 System 之一（与 Physics/Movement/Spawn 平级）。多能力各自 = 独立 Component+System 对，并排在 Entity 上组合，**绝不塞进 agent 声明**；`step` 只写意图（如 `intent_dir`），真正逻辑在独立 System 中读意图算状态。
3. **富的是 Entity**（runtime 组合一堆 Component），**瘦的是 agent 声明**（只管决策 Core）。
4. **智能体第一**（2026-08-03 宪法支柱）：Agent 为语言一等公民。用户裁定 actor 底层 + LLM 上层。**Agent 收敛决策 A（已立法化）**：`agent` 语言层能力净增 = 0（脱糖 = struct + 自由 fn + 构造器）→ 保留为极简意图标记，**绝不再扩语法**：只留 `X agent { state; step }` 唯一写法；永不新增 `use`/`goal`/`plan`/Spawner/消息路由；可复现工具（消息日志/回放/diff）移库层 `agentkit`；规划体用纯 `planner(State)->Msg` 自由 fn 喂 step。见 `docs/agent_first.md` §8/§9。
5. **t 无 `extern`/FFI、无内建 socket/HTTP**：所有 LLM / 工具 / 感知 / 人类输入等 Edge 效应必然活在进程外。`step` 纯函数只记意图，运行时边界 `drive_*` 对接外部 effector 后以消息回填。**本地 LLM = stdin/stdout 旁路桥（sidecar，零编译器改动）**：请求用 `println("LLMREQ|"+prompt)+fflush`；回复按词发 + 哨兵 `__EOM__`，t 侧逐 `stdin > string` token 读、遇哨兵 break、空格重拼（`t_deser_str` 读字符串按空白分词，含空格无法 round-trip）。参照 `examples/agent_npc_mind_llm.tc` + `tools/llm_bridge.py`。

## 构建 & 门禁（gate.mjs）
- `out/dbg/`（`-O0 -gcodeview`）/ `out/rls/`（`-O2`），各带 `deps/t_runtime.lib`；`--mode` 控目录+优化档。入口 `node tools/gate.mjs L0|L1|L2 [--full]`。**必须串行**（并行争抢 `out/`）、**别放后台**（管道静默挂起）。
- L0（~10s）：静态（catn+shadow）→ 自举 g1 → IR 双后端快照比对 → conformance → `UNSUPPORTED` 计数 0。L1（+不动点 g2==g3）。L2（~139s）：+ 四代 g2==g3==g4 + `cself` C 自举 + difftest tc0 + rls + tote 冒烟。目标 **13 passed / 0 failed / 0 warn**。
- **判不动点只比 emit-ll 的 `.ll` md5，绝不比 exe md5**（`-gcodeview` 把 `--output` 名写进调试信息）。g1 由改动前编译器编出不可信，测新语法用 g2/g3。
- **rls 通道按需跑**：只动 parser/checker → 跳过；动 emitter/runtime/升 clang → 必跑。秒级等价检查：`out/rls/tc.exe emit-ll src/tc.tc` 与 dbg 版 IR 比对。
- **IR 基线漂移标准流程**：改动 `tc.tc`/`tote.tc` 后必然 WARN。稳定做法 = ① `cp out/dbg/g4.exe out/dbg/tc.exe`（rls 同理 gr）；② `node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`；③ 复跑 gate → 0 warn。**必须用当次 gate 跑出的 g1 重录**，否则差一代。
- **`t_runtime.lib` 是预编译产物**：新增运行时符号后必须 `node tools/build_runtime.mjs` 重建，否则链接期报未定义符号（可用 `llvm-nm` 验证符号在不在）。
- **`tc build --output out/dbg/tote`**（不带 `.exe`，tc 自动补），写成 `tote.exe` 会产出 `tote.exe.exe`。

## 实现铁律（致命坑）
- `sb_catN` 实参必 == N；LLVM 后端不支持 `sb_cat2..6`，示例/测试一律 `sb_new`/`sb_append_str`/`sb_to_str`。
- **用户函数调用的 arity 当前未校验**（内建有 `T_CALL_ARITY`，用户函数没有）→ 少传实参会**静默通过**、被调方形参未初始化读到垃圾 len → 巨循环撑爆 arena（`arena: out of memory`）。⚠ 待修的 sema 缺口，写 t 代码时手动核对实参个数。
- 同名局部不可异型（shadow_check）；`a=b` 是 `"assign"`。
- LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang 用 `-O0` 非 `-Od`；`llvm-ar rcs` 非 `llvm-lib`。
- **内建注册必须五处齐全**（`builtin_ret` / `td_calls` / C emit / LLVM emit / `llph` declare + 检查器实参校验）；只加 declare 会静默 `; UNSUPPORTED call X`。gate「UNSUPPORTED 计数 0」是唯一防线。
- 新增脱糖时旧节点须整组改 `kind` 为下线标记（如 `ClauseDead`），否则残留活节点被 check 二次诊断；合成节点须承接锚点（`ln`/`cl`/`tv`）。
- **Agent 脱糖（`parse_agent_decl`）**：合成 `spawn` 的 `FuncDecl.lc` 必须是**语句链表头**（`list_push(-1,-1,ret)`），绝不可是 `mk_block` 返回的 block 节点（`desugar_lambdas` 把 `lc` 当链表头读 `kids[lc]` 会越界 panic `index_out_of_bounds` / `t_slice_at`）。spawn/step 函数名须经 `pascal_to_snake` 走 snake_case（否则 `T_NAME_TYPE_CAMEL`）。形参类型节点须 `clone_type_node` 深拷贝（并补 `sb` 模块限定字段）。
- **新增关键字前必须全库扫同名标识符**；`string`/`StringBuilder`/`void`/`map` 是关键字，`parse_primary` 不认；任何「接受类型」的语法扩展须显式路由 `parse_type()`。
- **conformance 只跑 check，不覆盖代码生成**；真正跑代码靠 run_examples（双后端实跑）与 gate `cself`。新运行期语义必须配示例 + `examples/<name>.expected.txt`，否则 run_examples 跳过 = 没测。
- **`defer` 是函数级不是块级**（语法 `defer Block`）；写在 if/while 里仍到函数退出触发。
- **编译期 intern 的 atom 必须在 check 阶段入表**（LLVM `@t_atom_table` 在函数体前发射）。
- **运行时 extern 引用编译器发射的全局 → 自举鸡生蛋**：用 `#ifdef` 桩 + 旧编译器编中间代绕开。
- g1 不可信；`out/dbg/g1.exe` 与 `tc.exe` 同样锁定，重建须 `--output` 临时名再 `cp`。
- C 发射强转数括号（`(uint64_t)(` 收尾 `"))"`)；runtime `snprintf` 格式串前导 `%` 别漏；`format_float` spec 是 Python 迷你语言非 printf。
- **排查 OOM/死循环方法论**：arena abort 时 `eprint` 缓冲不刷，但**分段打点 stderr 逐级二分**仍能定位到具体行。优先「消除分配来源 + 硬上限」而非「加 guard 放行」。`.ll` 里的 `ptr 0` 通常是 `UNSUPPORTED` 占位（该函数在本文件没定义），不一定是真 bug。**验证新特性前先确认测试用例真的调用了它**（曾因 `envdemo.tc` 只 import 不调 getenv 而误判已验证）。

## 里程碑（紧凑）
- M28..M41：map/数组/for/`m[k]=v`/cat/print/type_info/Sym/拆 tc+tote/移除 cat2-6。
- M42 L-15 生效。M43 match 表达式 + 函数子句脱糖。M44 `::`+`func`→`fn`。M45 FuncType v1。M46 匿名函数字面量。M47 TClosure ABI。M48 按值捕获闭包。M49 C 后端自举（`[N]T` 表示 `T*` 须发射定长缓冲）。M50 Atom（`:name`，全局名表）。M51 fid + `<` 序列化。M52 fid v1.5（ferror/fseek）。M53 `>` 反序列化 + fid_eof。
- M54/M55 字符串格式化（Python 规范子集，编译期 spec 校验 `check_fmt_spec`/`T_FMT_BAD_SPEC`/`T_FMT_SPEC_TYPE`）+ `format(tmpl,a,b,...)` 多参脱糖。
- **M56 时间格式化**：`now()->i64`（**微秒** epoch）、`format_time(spec,t)`（UTC）/`format_time_local`；spec 用 Python strftime `%` 子集，字段码全实现（最小 `%Y%y%m%d%H%M%S%f%%` + 扩展 `%a%A%b%B%p%I%j%w%U%W%z%Z`）；未知 `%X` 字面量编译期 `T_TIME_BAD_SPEC`，非常量运行期宽容。已并入 `docs/reference.md` §3.11。
- **M57 时间格式化增量**：① 方法式 `"tmpl".format(a,b)`（接收者须为字符串字面量，否则 `T_FMT_TEMPLATE_NOT_LITERAL`）；② `parse_time`/`parse_time_local`（失败返哨兵 `T_TIME_INVALID`=INT64_MIN，输入须完全消耗）；③ `format_time_tz(spec,t,tz_minutes)`（固定偏移，不依赖平台 tzdata）；④ locale 字段码 `%c`/`%x`/`%X`。解析白名单严格小于格式化（`%w%U%W%Z` → `T_TIME_PARSE_UNSUPPORTED`）。见 §3.10.6 + §3.11。
- **M-A Agent 脱糖（actor 底层）**：`X agent { state ...; step fn(...) }` 解析期展开为 `XState` struct + `x_spawn` + `x_step` 三个顶层符号。配套 `examples/agent_demo.tc`；`docs/reference.md` §3.12。

## 外部库（`import @x`）— 三刀全交付
- **用户拍板**：q-0 `import @json` + 约定搜索路径；q-1 `.tlib` 预编译产物；q-2 加前缀 + 限定访问（库顶层符号 → `lib__name`，仅经 `lib.sym(...)` 访问，库内自调用也脱糖）。
- **第四刀（Phase 1，2026-08-05）搜索路径 + 命名空间隔离**：`compute_lib_dirs` = 入口目录 `lib/`/`libs/` 优先，其次各 `<src_root>` 父目录（工程根）的 `lib/`/`libs/`，再加 `out/lib/`；`resolve_external_lib` 探测 `<libdir>/x.tc` → `/x/index.tc` → `/x/lib.tc`，全失 → `T_IMPORT_NOT_FOUND`。`mangle_modules`（取代 `desugar_module_qualifiers`）Pass1 处理 `A.sym`→`A__sym`（可见性校验 → `T_MODULE_PRIVATE`）、`A.T`/`A.T{}`→`A__T`；Pass2 库内符号整写。**入口模块别名 `""` 永不重整 → 单文件 IR 逐字节不变**。新诊断 `T_MODULE_PRIVATE`/`T_MODULE_NO_SYMBOL`。
- **第五刀（Phase 2，2026-08-05）`.tlib` 真·独立编译 + 链接**：`build --lib <file.tc>` 以 stem 作规范别名，`g_lib_emit=true` 跳过进程级全局（`t.__ginit`/`t_atom_table`/`t_atom_count`，避重复符号），产出 `out/lib/<stem>.tlib`（`clang -c` → `.o` → `llvm-ar rcs`）+ `<stem>.exports.json` 接口块。`import @x` 双模式：命中 `.tlib` → 链接模式（载 exports 注册导出符、对导出符发 `declare` 不发 `define`、私有符经 `g_link_libs` 门控跳过、归档进 `g_ext_link`）；未命中 → **回退内联源码**（过渡安全网，保证 gate 不漂）。
- **第六刀（2026-08-05）环境变量搜索**：tc 加中性内建 `getenv(name)->string`（未设置返空串）+ 中性开关 `--lib-dir <path>`（追加进 `g_lib_dirs`，优先级最高）；runtime 加 `t_getenv`/`tll_getenv` 指针桥。**tote 读 `T_LIB_PATH` 与 `~/.tote/libs`**（`split_path_list` 只按 `;` 切——`:` 会误切 Windows 盘符）并注入 `--lib-dir`。
- 示例 `examples/lib/{json,csv}.tc`（故意同名证隔离）+ `examples/extlib_demo.tc`；conformance `f54_ext_import_not_found`/`f55_module_private`/`f56_module_no_symbol`。docs §3.13。
- **余留待办**：`.tlibd` 调试态产物、内嵌接口块（现用 `exports.json` 等价）、`T_IMPORT_CYCLE` 依赖图无环校验、tote 依赖图、C 互操作导出（`.lib`/`.dll`）。

## 技术债
- **用户函数 arity 未校验**（见实现铁律）——静默内存损坏源，优先级高。
- fid v1.5：protobuf/聚合类型（struct/slice/map）序列化未实装（需 v2 走 type_info + `@derive(BinarySerde)`）；`>` 返裸 `T` + `fid_eof` 探针，待可选类型一等化后回归 `T?`。
- 闭包环境不回收（M48 v1 有意泄漏）。
- `@derive` 9 trait 手写；type_info 仅 struct；import_json 嵌套；优化后端。
- **C 后端「大结构体按值返回」崩溃**（已知限制，待修）：函数返回体量大的 struct（含 `[256]T` 定长数组、约数 KB）按值 → C 后端段错误（exit 139），LLVM 正常。阈值 = 超过寄存器承载走 sret，C 发射器 sret 路径有 bug。**规避**：用 `[]T` 切片承载大序列，使承载结构体本身很小（切片头 ≈16B）。`agentkit.tc` 的 `MsgLog` 即此手法。
- **已修（2026-08-03）**：`compile`/`emit-ll`/`build`/`run` 原在 `has_errors()` 时静默 `return 1` 不打印诊断 → 编译错误伪装成「沉默 exit 1」。已补 `print_json()`。排查「编译器崩溃」时先跑 `tc check <file>` 看 JSON 诊断。
- **已修（2026-08-05）**：`compute_src_roots` 用 `path_resolve`/`_fullpath` 向上遍历，盘符根 `C:` 被展开成 `C:/Users/xxx` 造成震荡死循环 OOM → 改纯字符串 `parent_dir_of` + 硬上限 `guard<32`；`path_exists` 改调 `file_exists` 内建（根除绝对路径下 `sys_run` 外 shell OOM）。
