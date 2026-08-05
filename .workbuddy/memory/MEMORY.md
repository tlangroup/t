# t 语言编译器 — 项目笔记

## 协作偏好（用户明示）
- **不中途停下**：除非确实需要用户拍板（选项无法自行决断 / 会不可逆破坏数据），否则一路跑到底，不要为确认或汇报而停。

## 概览
- **t**：静态类型、数据驱动、ECS 取向，扩展名 `.tc`；宪法 `docs/constitution.md`，手册 `docs/reference.md`。⚠ `spec.md` 冻结废弃。
- **声明语法（M44 起）并置式**：`Name fn(...) -> Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。⚠ `::` 与 `func` 已移除。
- **`src/tc.tc`**：自举编译器（lex/check/compile/emit-c/emit-ll/build/run，默认 LLVM）→ `out/<mode>/tc.exe`。**`src/tote.tc`**：包管理，委托 tc。`gen/tc.tc` 冻结快照。
- **命名红线**：`✅ tote`/`status='tote'` 意为「已实现」；裸 `tote` 编译器引用 → `tc`。

## 架构红线（用户多轮裁定）
1. **tc 只管 lex/parse/sema**：具体功能由可插拔 `.tlib` 实现、靠 `import` 引入，不进编译器。**tc 不读环境变量**——只提供中性原语 `getenv` + 中性开关 `--lib-dir`，策略（`T_LIB_PATH`/`~/.tote/libs`）归 tote。
2. **agent 非容器**：`state` 只是 Component、`step` 只是众多 System 之一。多能力各自 = 独立 Component+System 对并排组合，`step` 只写意图。
3. **瘦 agent 声明**：`X agent { state; step }` 唯一写法，绝不再扩语法（无 `use`/`goal`/`plan`/Spawner）。规划体用纯 `planner(State)->Msg` 自由 fn 喂 step。见 `docs/agent_first.md`。
4. **t 无 `extern`/FFI/内建网络**：Edge 效应全在进程外；`step` 纯函数只记意图，运行时边界 `drive_*` 回填。本地 LLM = stdin/stdout 旁路桥（sidecar，零编译器改动）。

## 构建 & 门禁（gate.mjs）
- `out/dbg/`（`-O0 -gcodeview`）/ `out/rls/`（`-O2`）。入口 `node tools/gate.mjs L0|L1|L2 [--full]`。**串行、别放后台**。
- L0（~10s）：静态→自举 g1→IR 双后端比对→conformance→`UNSUPPORTED` 计数 0。L1（+g2==g3）。L2（~139s）：+四代不动点 +`cself` C 自举 + difftest tc0 + rls + tote 冒烟。目标 **13 passed/0 failed/0 warn**。
- **判不动点只比 emit-ll 的 `.ll` md5，绝不比 exe md5**（`-gcodeview` 写进 `--output` 名）。
- **IR 基线漂移**：改动 tc.tc/tote.tc 必 WARN。归零 = ① `cp out/dbg/g4.exe out/dbg/tc.exe`；② `node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`；③ 复跑 gate。**必须用当次 g1 重录，否则差一代**。
- **`t_runtime.lib` 是预编译产物**：新增运行时符号后必须 `node tools/build_runtime.mjs` 重建。
- **`tc build --output out/dbg/tote`**（不带 `.exe`，tc 自动补）；写成 `tote.exe` 会产出 `tote.exe.exe`。

## 实现铁律（致命坑）
- `sb_catN` 实参必 == N；LLVM 后端不支持 `sb_cat2..6`，一律 `sb_new`/`sb_append_str`/`sb_to_str`。
- 同名局部不可异型（shadow_check）；`a=b` 是 `"assign"`。
- LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang 用 `-O0` 非 `-Od`；`llvm-ar rcs` 非 `llvm-lib`。
- **内建注册必须五处齐全**（`builtin_ret`/`td_calls`/C emit/LLVM emit/`llph` declare+检查器实参校验）；只加 declare 会静默 `; UNSUPPORTED call X`。
- 新增脱糖时旧节点须整组改 `kind` 为下线标记（如 `ClauseDead`）；合成节点须承接锚点（`ln`/`cl`/`tv`）。
- **Agent 脱糖**：合成 `spawn` 的 `FuncDecl.lc` 必须是**语句链表头**（`list_push(-1,-1,ret)`），绝不可是 `mk_block` 返回的 block（否则 `desugar_lambdas` 越界 panic）。形参类型节点须 `clone_type_node` 深拷贝。
- **新增关键字前必须全库扫同名标识符**；`string`/`StringBuilder`/`void`/`map` 是关键字，`parse_primary` 不认。
- **conformance 只跑 check，不覆盖代码生成**；新运行期语义须配示例 + `examples/<name>.expected.txt`。
- **`defer` 是函数级不是块级**（语法 `defer Block`）。
- g1 不可信；`out/dbg/g1.exe` 与 `tc.exe` 同样锁定，重建须 `--output` 临时名再 `cp`。
- C 发射强转数括号；runtime `snprintf` 格式串前导 `%` 别漏。
- **排查 OOM/死循环**：arena abort 时 `eprint` 缓冲不刷，但**分段打点 stderr 逐级二分**仍能定位。`.ll` 里 `ptr 0` 通常是 `UNSUPPORTED` 占位。验证新特性前先确认测试用例真的调用了它。

## 里程碑（紧凑）
- M28..M53：map/数组/for/cat/print/type_info/Sym/拆 tc+tote/移除 cat2-6/match 表达式/`::`+`func`→`fn`/FuncType/匿名函数/闭包/Atom/fid 序列化反序列化。
- M54..M55：字符串格式化（Python 规范子集，`check_fmt_spec` 编译期校验）+ `format(tmpl,a,b,...)`。
- M56..M57：时间格式化 `now`/`format_time`/`format_time_local`/`parse_time`/`format_time_tz`；方法式 `"tmpl".format(a,b)`；locale 字段码。见 §3.10.6+§3.11。
- M-A：Agent 脱糖 `X agent { state; step }` → `XState` struct + `x_spawn` + `x_step`。

## 外部库（`import @x`）— 全交付（2026-08-05）
- 搜索路径 `compute_lib_dirs`（入口 `lib/`/`libs/` 优先 → 各 `<src_root>` 父目录 `lib/`/`libs/` → `out/lib/`）；`resolve_external_lib` 探测 `<libdir>/x.tc`→`/x/index.tc`→`/x/lib.tc`，全失→`T_IMPORT_NOT_FOUND`。
- 命名空间隔离 `mangle_modules`：`A.sym`→`A__sym`（跨模块访问需导出，否则 `T_MODULE_PRIVATE`）、`A.T`→`A__T`；入口模块别名 `""` 永不重整（单文件 IR 逐字节不变）。`T_MODULE_NO_SYMBOL` 找不到限定符。
- `.tlib` 真·独立编译+链接：`build --lib <file.tc>` 产 `out/lib/<stem>.tlib`+`.exports.json`；`import @x` 命中 `.tlib`→链接模式（declare 导出符、归档进 `g_ext_link`），未命中→回退内联。
- **第六刀 getenv + `--lib-dir` + tote 环境变量搜索**：tc 中性 `getenv(name)->string` 内建 + `--lib-dir` 开关；tote 读 `T_LIB_PATH`/`~/.tote/libs`（`split_path_list` 只按 `;` 切）注入 `--lib-dir`。
- 示例 `examples/lib/{json,csv}.tc` + `examples/extlib_demo.tc`；conformance `f54`/`f55`/`f56`。
- **余留待办**：`.tlibd`、内嵌接口块、`T_IMPORT_CYCLE`、tote 依赖图、C 互操作导出。

## 技术债 & 已修
- **用户函数实参校验（已修，2026-08-05）**：直接/间接调用现共用 `check_call_args`——`T_CALL_ARITY`（元数不符）+ 逐位 `ti_equal`/`can_cast`（`T_TYPE_MISMATCH`）。修复引入 `ti_equal` 让 `Named` 与已解析用户具名类型按 name 判等（跨模块同类型不再误判）；variant 助手 `tif_pstart=-1` 加 `pstart<0` 守卫放行；`diag_new` 加去重防兜底补扫重复报错。conformance `f57_call_arity_direct`/`f58_call_arg_type`。
- fid v1.5：protobuf/聚合类型序列化未实装（待 v2）。
- 闭包环境不回收（M48 v1 有意泄漏）。
- `@derive` 9 trait 手写；type_info 仅 struct。
- **C 后端「大结构体按值返回」崩溃**：含 `[256]T` 定长数组的 struct 按值返回 → C 后端段错误（exit 139），LLVM 正常。规避：用 `[]T` 切片承载大序列。
- **已修（2026-08-03）**：`compile`/`emit-ll`/`build`/`run` 在 `has_errors()` 时静默 `return 1` 不打印诊断 → 补 `print_json()`。
- **已修（2026-08-05）**：`compute_src_roots` 用 `path_resolve`/`_fullpath` 向上遍历盘符根 `C:` 被展开成 `C:/Users/xxx` 震荡死循环 OOM → 改纯字符串 `parent_dir_of`+硬上限 `guard<32`；`path_exists` 改调 `file_exists` 内建。
