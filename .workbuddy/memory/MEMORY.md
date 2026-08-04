# t 语言编译器 — 项目笔记

## 概览
- **t**:静态类型、数据驱动、ECS 取向,扩展名 `.tc`;宪法 `docs/constitution.md`,手册 `docs/reference.md`。⚠ `spec.md` 已废弃冻结。
- **声明语法(M44 起)并置式**:`Name fn(...) -> Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。⚠ `::` 与 `func` 已移除。
- **`src/tc.tc`**:自举编译器(lex/check/compile/emit-c/emit-ll/build/run,默认 LLVM)→ `out/<mode>/tc.exe`。`src/tote.tc`:包管理委托 tc。`src/totter.tc` 已放弃;`gen/tc.tc` 冻结快照。
- **命名红线**:`✅ tote`/`status='tote'` 意为"已实现",绝不可改成二进制名;裸 `tote` 编译器引用→`tc`。
- **智能体第一(2026-08-03 宪法支柱)**:Agent 为语言一等公民(身份 atom+显式状态 struct+类型化工具 fn+消息回路)。设计素描 `docs/agent_first.md`(草案)。用户裁定 B:actor 底层 + LLM 上层;LLM 驱动 NPC 是游戏真需求。⇒ 编译器只需实现 actor 声明,LLM 调用是运行时边界。
- **Agent 收敛决策 A(2026-08-04 拍板,已立法化)**:`agent` 在语言层**能力净增=0**(脱糖=struct+自由 fn+构造器,均已是一等公民;连 `spawn` 也可用 `XState{...}` 字面量替代)→ **保留为极简意图标记,绝不再扩语法**。硬性约束:① 只留 `X agent { state; step }` 唯一写法;② **永不新增** `use` 接线/`goal`/`plan`/Spawner/消息路由;③ 10 格分类矩阵降级为「模式目录(非语法)」;④ 可复现工具(消息日志/回放/diff)移**库层**(agentkit),不进语言;⑤ 规划体若做,用纯 `planner(State)->Msg` 自由 fn 喂 step,不引语法。`docs/agent_first.md` §8(决策)+§9(数据流可复现 5 条守恒定则)。编译器保持最小 actor 声明现状,未动。
- **架构红线(用户 2026-08-04 多轮裁定, 含后续 Agent 臃肿讨论)**:① 主程序(`tc.tc`)只管 lex/parse/sema;具体功能(time/ser/各 Edge 适配器…)由**可插拔模型库模块(.tlib)**实现、靠 `import` 引入,不进编译器。② agent **非容器**:为一等公民≠罩住所有 System;`state` 只是 Component(挂 Entity 上)、`step` 只是众多 System 之一(与 Physics/Movement/Spawn 平级)。多能力(移动/碰撞/旋转…)各自=独立 Component+System 对,并排在 Entity 上组合,**绝不塞进 agent 声明**;`step` 只写意图(如 `intent_dir`),真正逻辑在独立 System 中读意图算状态。③ 富的是 Entity(runtime 组合一堆 Component),瘦的是 agent 声明(只管决策 Core)。

## 构建 & 门禁(gate.mjs)
- `out/dbg/`(`-O0 -gcodeview`)/`out/rls/`(`-O2`),各带 `deps/t_runtime.lib`;`--mode` 控目录+优化档。入口 `node tools/gate.mjs L0|L1|L2 [--full]`。**必须串行**(并行争抢 `out/`)、**别放后台**(管道静默挂起)。
- L0(~10s):静态(catn+shadow)→自举 g1→IR 双后端快照比对→conformance→`UNSUPPORTED` 计数 0。L1(+不动点 g2==g3)。L2(~139s):+四代 g2==g3==g4 + `cself` C 自举 + difftest tc0 + rls + tote 冒烟。
- **判不动点只比 emit-ll 的 `.ll` md5,绝不比 exe md5**(`-gcodeview` 把 `--output` 名写进调试信息)。g1 由改动前编译器编出不可信,测新语法用 g2/g3。
- **rls 通道按需跑**:只动 parser/checker→跳过 rls;动 emitter/runtime/升 clang→必跑。等价秒级检查:`out/rls/tc.exe emit-ll src/tc.tc` 与 dbg 版 IR 比对。
- **ir_snapshot 基线漂移坑**:`gate` 的 snapshot 步用 `g1`(=`tc.exe` boot1 编出的)编译各 target 比对基线。若你中途换了 `tc.exe`(bootstrap host),重录基线必须用**当次 gate 跑出来的 `g1`**(`--compiler out/dbg/g1.exe --update`),否则下轮 g1 由新 host 编出、与旧基线差一代→WARN。稳定做法:`tc.exe` 装成 `g4`(不动点)后再录基线,之后每轮 g1 由 g4 编出、确定可复现→0 warn。

## 实现铁律(致命坑)
- `sb_catN` 实参必==N;LLVM 后端不支持 `sb_cat2..6`,示例/测试一律 `sb_new`/`sb_append_str`/`sb_to_str`。
- 同名局部不可异型(shadow_check);`a=b` 是 `"assign"`。
- LLVM 避 Win64 聚合 ABI(`tll_*` 指针桥);clang 用 `-O0` 非 `-Od`;`llvm-ar rcs` 非 `llvm-lib`。
- 新增脱糖时旧节点须整组改 `kind` 为下线标记(如 `ClauseDead`),否则残留活节点被 check 二次诊断;合成节点须承接锚点(`ln`/`cl`/`tv`)。
- **Agent 脱糖(`parse_agent_decl`)致命坑**:合成 `spawn` 构造器的 `FuncDecl.lc`(函数体)必须是**语句链表头**(`list_push(-1,-1,ret)` 产生的 kids 节点),绝不可是 `mk_block(...)` 返回的 "block" AST 节点——`desugar_lambdas`/`lam_find_list` 把 `lc` 当 kids 链表头读 `kids[lc]`,给 block 节点索引会越界 `index_out_of_bounds`(panic 定位: `{"error":"index_out_of_bounds","context":"t_slice_at"}`)。`step` 体来自 `parse_block()`(本就是链表头)故无此问题。生成的 `spawn`/`step` 函数名必须经 `pascal_to_snake(Name)+"_spawn"/"_step"` 走 snake_case,否则 PascalCase 名触发 `T_NAME_TYPE_CAMEL` 警告(命名校验器把首字母大写当类型名)。spawn 形参类型节点须 `clone_type_node(fld.na)` 深拷贝,不可与 struct 字段共享同一节点。
- **内建注册必须五处齐全**(return/`td_calls`/C/LLVM/`llph`+检查器实参);只加 declare 会静默 `; UNSUPPORTED call X`(M53 根因)。gate「UNSUPPORTED 计数 0」是唯一防线。
- **新增关键字前必须全库扫同名标识符**;`string`/`StringBuilder`/`void`/`map` 是关键字,`parse_primary` 不认;任何"接受类型"的语法扩展须显式路由 `parse_type()`(M53 根因)。
- **conformance 只跑 check,不覆盖代码生成**;真正跑代码靠 run_examples(双后端实跑)与 gate `cself`。新运行期语必须配示例+`examples/<name>.expected.txt`,否则 run_examples 跳过=没测。
- **`defer` 是函数级不是块级**(语法 `defer Block`);写在 if/while 里仍到函数退出触发。
- **编译期 intern 的 atom 必须在 check 阶段入表**(LLVM `@t_atom_table` 在函数体前发射,发射期才 intern 会越界)。
- **运行时 extern 引用编译器发射的全局→自举鸡生蛋**(M50):用 `#ifdef` 桩+旧编译器编中间代绕开。
- g1 不可信;`out/dbg/g1.exe` 与 `tc.exe` 同样锁定,重建须 `--output` 临时名再 `cp`。
- C 发射强转数括号(`(uint64_t)(` 收尾 `"))"`);runtime `snprintf` 格式串前导 `%` 别漏;`format_float` spec 是 Python 迷你语言非 printf。

## 里程碑(紧凑)
- M28..M41:map/数组/for/`m[k]=v`/cat/print/type_info/Sym/拆 tc+tote/移除 cat2-6。
- M42 L-15 生效+defer 缺口。M43 match 表达式+函数子句脱糖。M44 `::`+`func`→`fn`。M45 FuncType v1。M46 匿名函数字面量。M47 TClosure ABI。M48 按值捕获闭包。M49 C 后端自举(`[N]T` 表示 `T*` 须发射定长缓冲)。M50 Atom(`:name`,全局名表)。M51 fid+`<` 序列化。M52 fid v1.5(ferror/fseek)。M53 `>` 反序列化+fid_eof(方案B)。M54 字符串格式化(Python 规范子集,+编译期 spec 校验 `check_fmt_spec`/`T_FMT_BAD_SPEC`/`T_FMT_SPEC_TYPE`,conformance `p31`/`f41`/`f42`)。M55 `format(tmpl,a,b,...)` 多参模板脱糖。M56 时间格式化(**已完成**):`now()→i64`(**微秒** epoch)、`format_time(spec,t)→string`(UTC)/`format_time_local`(本地),spec 用 Python strftime `%` 子集;字段码全实现——最小 `%Y%y%m%d%H%M%S%f%%` + 扩展 `%a%A%b%B%p%I%j%w%U%W%z%Z`(`%z`/`%Z` 本地由 localtime↔gmtime 差算偏移,`%Z` 借 `strftime("%Z")`,UTC 恒 `+0000`/`UTC`);未知 `%X` 字面量编译期 `T_TIME_BAD_SPEC`,非常量运行期宽容原样保留。五处注册+编译期校验(`check_time_spec` 白名单/`T_TIME_SPEC_TYPE`/`T_TIME_ARG_TYPE`/`T_CALL_ARITY`)+示例(`time_fmt_demo.tc`+`.expected.txt`、`time_fmt_local.tc`)+conformance(`p29`/`p30`/`f38`/`f39`/`f40`)全就位;gate L2 全绿。**已正式采纳（L-15）**:`docs/syntax/drafts/time_fmt.md` 已并入 `docs/reference.md` §3.11（2026-08-03）,草稿标记失效;`tc.tc` 报错文案 `毫秒`→`微秒`;IR 基线已重录。
- M57 时间格式化增量(**已完成**):① 方法式 `str.format`——`"tmpl".format(a,b)` 与 `format` 同义(`infer_expr` call 分支:接收者为 string 字面量则挪为第0实参、callee 换裸 `format` 走 `desugar_format_call`;变量接收者报 `T_FMT_TEMPLATE_NOT_LITERAL`);② `parse_time(spec,s)→i64`/`parse_time_local`(按 UTC/本地解析微秒 epoch;失败返哨兵 `T_TIME_INVALID`=INT64_MIN 不抛不返0;输入须完全消耗;自实现 `t_days_from_civil`+扫描器 `pt_scan`,`%z` 支持 `+0800`/`+08:00`/`Z`,`%I/%p` 转24h,`%y` 69→1969 余→20xx,闰秒夹紧,`%j` 反推日);③ `format_time_tz(spec,t,tz_minutes)`(固定偏移分钟东正,推墙上时间按 UTC 展开,`%z`→`±HHMM`/`%Z`→`UTC±HH:MM`,不依赖平台 tzdata);④ locale 字段码 `%c`(`%a %b %e %H:%M:%S %Y`)/`%x`(`%m/%d/%y`)/`%X`(`%H:%M:%S`)实装。解析白名单严格小于格式化(`%w%U%W%Z` 报 `T_TIME_PARSE_UNSUPPORTED`,其余未知 `T_TIME_BAD_SPEC`,`check_time_parse_spec` 编译期扫描+运行期兜底)。五处注册+示例(`time_tz_demo`/`time_parse_demo`/`fmt_method_demo`)+conformance(`p32/33/34` pass、`f47..f53` fail)全就位;gate L2 全绿(13 passed/0 failed/0 warn);IR 基线已重录(从 g4);`docs/reference.md` §3.10.6+§3.11 已更新。
- **M-A Agent 脱糖(actor 底层,已完成)**:`X agent { state ...; step fn(s: XState, msg: T) -> XState {...} }` 解析期展开为 `XState` struct + `x_spawn(init...) -> XState` + `x_step(s,msg) -> XState` 三个顶层符号。命名红线:spawn/step 函数名经 `pascal_to_snake(X)+"_spawn"/"_step"` 走 snake_case(否则 `T_NAME_TYPE_CAMEL` 警告);`spawn` 体 `FuncDecl.lc` 必须是语句链表头(`list_push(-1,-1,ret)`)而非 `mk_block` 返回的 block 节点(否则 `desugar_lambdas` 读 `kids[lc]` 越界 panic——本 milestone 修掉的根因)。新增 helper:`pascal_to_snake`/`clone_type_node`/`clone_type_list`。配套 `examples/agent_demo.tc`+`.expected.txt`(`count = 8`,双后端 run_examples 通过);`docs/reference.md` §3.12 新增 Agent 小节(语法/EBNF/脱糖产物表/命名红线)。gate L2 全绿(13 passed/0 failed/0 warn),IR 基线已从 g4-host 的 g1 重录。

## 外部库（import @x，第四刀 2026-08-05 已落地 Phase 1）
- **Phase 1=搜索路径+命名空间隔离（已完成, L2 gate 13 passed/0 failed/0 warn）**;Phase 2=`.tlib` 预编译产物（Task #34, 待办）。
- **用户拍板**：q-0 `import @json + 约定搜索路径`;q-1 `.tlib` 预编译产物留 Phase 2;q-2 `加前缀 + 限定访问`——库顶层符号 → `lib__name`,仅经 `lib.sym(...)` 访问,库内自调用也脱糖 `lib__sym`。
- **搜索路径**：`compute_lib_dirs` 入口目录 `lib/`/`libs/` 优先,其次各 `<src_root>` 父目录(工程根)的 `lib/`/`libs/`;`resolve_external_lib` 探测 `<libdir>/x.tc`→`/x/index.tc`→`/x/lib.tc`,全失→`T_IMPORT_NOT_FOUND`。**绝不能调 `getenv`**(非内建);`~/.tote/libs`/`T_LIB_PATH` 搜索属 Phase 2。
- **命名空间重整 `mangle_modules`**(取代旧 `desugar_module_qualifiers`):Pass1 处理 `A.sym`→`A__sym`(可见性校验→`T_MODULE_PRIVATE`)、`A.T`/`A.T{}`→`A__T`;Pass2 库内符号整写 `A__name`。入口模块别名 `""` → **永不重整** → 单文件 IR 逐字节不变。
- `parse_type` 支持 `A.T` 限定类型;`parse_prim_ident` 支持 `A.T{...}` 限定字面量;`clone_type_node` 深拷贝须补 `sb`(模块限定字段,否则克隆类型丢前缀退化 i64)。新诊断 `T_MODULE_PRIVATE`/`T_MODULE_NO_SYMBOL`。
- 示例 `examples/lib/{json,csv}.tc`(故意同名证隔离)+`examples/extlib_demo.tc`;conformance `f54_ext_import_not_found`/`f55_module_private`/`f56_module_no_symbol`。docs/reference.md §3.13 标「第四刀已落地」。

## 技术债
- fid v1.5:protobuf/聚合类型(struct/slice/map)序列化未实装(需 v2 走 type_info+`@derive(BinarySerde)`);`>` 返裸 `T`+`fid_eof` 探针,待可选类型一等化后回归 `T?`。
- 闭包环境不回收(M48 v1 有意泄漏)。（原「format v1 无多参 `str.format`」已由 **M57** 解决：方法式 `"x={0}".format(v)` 与多参 `format("x={0}", a, b)` 均已实装，该条技术债已销。
- `@derive` 9 trait 手写;type_info 仅 struct;import_json 嵌套;优化后端。
- ~~reference.md L907 "defer 作用域退出 LIFO" 描述不精确(实测函数级),待订正。~~ **已订正**（2026-08-04）：L928 EBNF 注释改为「函数级：登记到当前函数延迟栈，于 return/函数尾按 LIFO 执行（写在 if/while 块内也到函数退出才触发，非块级作用域退出）」；L1244 本就准确。
- **已修复(2026-08-03)**：`compile`/`emit-ll`/`build`/`run` 子命令原在 `has_errors()` 时静默 `return 1` 不打印诊断，任何编译错误都伪装成「沉默 exit 1」，易被误判为段错误。已在 `src/tc.tc` 主入口两处补 `print_json()`（与 `check` 一致）。排查「编译器崩溃」时先跑 `tc check <file>` 看 JSON 诊断，别被 build/emit-ll 的静默 exit 骗了。
- **C 后端「大结构体按值返回」崩溃(已知限制, 待修)**:函数返回**体量大的 struct**(如含 `[256]T` 定长数组、约数 KB)按值 → C 后端实跑段错误(exit 139),LLVM 正常。小 struct(`Position` 24B、`Entity` 等)按值返回正常,故阈值是"超过寄存器承载 → 走 sret → C 发射 sret 路径有 bug"。**规避手法**:用 `[]T` 切片承载大序列,使承载结构体本身很小(切片头 ptr+len ≈16B + 计数 i64),返回/传参按值安全,记录实际存于堆。`agentkit.tc` 的 `MsgLog`(底层 `[]MsgRec` 切片)即此手法。长远应修 C 发射器的大 struct sret 返回(类似此前拓扑排序修复),但属编译器改动,需 gate L2 全绿验证,不在 agentkit 交付范围内。

## 架构约定(Agent / Edge 落地)
- **t 无 `extern`/FFI、无内建 socket/HTTP**:所有 LLM / 工具 / 感知 / 人类输入等 Edge 效应**必然活在进程外**(决策 A §10.4)。`step` 纯函数只在状态记意图,运行时边界 `drive_*` 对接外部 effector 后以消息回填。
- **本地 LLM 落地 = stdin/stdout 旁路桥(sidecar, 零编译器改动)**:t 有 `stdin`/`stdout` 作 `fid`(§3.10)。`stdin`/`stdout` 固定 `:text`,`runtime/t_deser_str`(1860)证**读字符串按空白分词、含空格无法 round-trip** ⇒ 协议:请求 `t→桥` = `println("LLMREQ|"+prompt)+fflush(stdout)`(写不分词);回复 `桥→t` = 应答按词发 + 哨兵 `__EOM__`,t 侧 `while` 逐 `stdin > string` token 读、遇 `__EOM__` break、空格重拼。参照实现 `examples/agent_npc_mind_llm.tc`(改 `fake_llm`→`llm_local`)+ `tools/llm_bridge.py`(默认打 Ollama `:11434/api/generate`,`LOCAL_LLM_MODEL`/`LOCAL_LLM_URL` 可配,不可达回退确定性应答)。`\n` 不允许在字符串字面量内(reference 137)→ 换行靠 `println`+`fflush`。
