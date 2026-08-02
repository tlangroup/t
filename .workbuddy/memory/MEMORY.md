# t 语言编译器 — 项目笔记（精简）

## 概览
- **t**：静态类型、数据驱动、ECS 取向，扩展名 `.tc`；宪法 `docs/constitution.md`（取代 spec），手册 `docs/reference.md`。⚠ `spec.md` 已废弃冻结。
- **声明语法（M44 起）并置式**：`Name fn(...) -> Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。⚠ `::` 与 `func` 已移除，旧写法报带迁移指引的硬错误。
- **`src/tc.tc`**：自举编译器（lex/check/compile/emit-c/emit-ll/build/run，默认 LLVM 后端）→ `out/<mode>/tc.exe`。**`src/tote.tc`**：包管理/构建，委托 tc。**`src/totter.tc`** 已放弃（保留不删）；`gen/tc.tc` 冻结快照但须随语法迁移。
- **命名红线**：文档里 `✅ tote`/`status='tote'` 意为"已实现"，**绝不可**改成二进制名；要改的只是裸 `tote` 编译器引用→`tc`。
- `tc0/` TS 参考实现冻结但 parser 已升级 → difftest 的 `tc0 vs tc` 通道 lex/check 9/9 绿，emit-c 0/9（tc0 emitter 旧命名/旧语法，预期失败）。

## 法律体系
- 宪法→法律→代码。`docs/laws/*.md`（general + L-02..L-15，均草案待采纳）。
- **L-15**：语法子层经 草稿→法律验证(L-04/L-03/L-01/L-02/L-14)→并入 `reference.md`→草稿失效。**须用户显式「规则采纳」**才并入。

## 目录 & 构建
- `out/dbg/`(`-O0 -gcodeview`)、`out/rls/`(`-O2`)，各带 `deps/t_runtime.lib`；`--mode` 控目录+优化档。
- 流水线：gen_ebnf→build_runtime→tc/tote 自举。`out/dbg/tc.exe` 运行时锁 exe，重建须 `--output <临时名>` 再 `cp`。

## 验证七步（门禁）
1. ~~md5 src==gen~~（废）2. difftest 自举代际对拍 `--ref genB --cand genD` 27/27；tc0 外部对拍 lex/check 9/9 3. conformance 55/55 4. 四代自举 IR 逐字节 g2==g3==g4 5. shadow_check+catn_check 6. `; UNSUPPORTED` 计数 0 7. run_examples 双后端（dbg+rls）。tote 冒烟单独验。**日常直接跑 `node tools/gate.mjs L2`（13 步，约 170s）。**
- **必须串行跑**（并行争抢 `out/` 产物→假失败）。
- **gate L2 超过 Bash 默认 120s 超时** → 必须 `> build/gate_l2.log 2>&1` 再读，并把 timeout 提到 580000。**别放后台**（历史上后台 + spawn 管道组合出过静默挂起）。
- **工具参数拼错会静默退回默认值（假绿/假红源）**：`conformance.mjs` 的参数是 `--compiler` 不是 `--tc`；写错曾导致「以为新编译器失败、实为测了旧 tc.exe」。现 conformance/difftest/run_examples/ir_snapshot/gate 均已加未知参数 `exit 2`。
- **UNSUPPORTED 口径**：`grep -cE '^[[:space:]]*; UNSUPPORTED'`；裸 grep 会命中 6 处编译器自身诊断字符串（假阳性）。
- **管道 SIGPIPE 假象**：`node tools/x.mjs | tail` 可能 exit 1 吞掉总结行 → 长输出重定向到文件再 grep。
- **改语法后必须核对正则型门禁工具的匹配数**（shadow_check 等）：正则失配会零样本打印 OK → 假绿。
- **rls 通道按需跑（2026-08-02 实测裁定）**：`--mode` 只影响 ①输出目录 ②clang 优化档（`-O0 -gcodeview`/`-O2`），**前端零介入**；实测 dbg 与 rls 两档编译器对 21 个示例 + `tc.tc` 自身发射的 IR **逐字节相同**（tc.tc 均为不动点 md5）。故 rls 独有覆盖仅剩「-O2 碰巧暴露的 UB」。判据按改动层：**只动 parser/checker → 跳过 rls**（IR 同则 -O2 产物必同）；**动 emitter / runtime / 升 clang → 必跑**。替代 rls 全量（30s）的秒级等价物：`out/rls/tc.exe emit-ll src/tc.tc` 与 dbg 版 IR 比对 —— 完全覆盖「-O2 是否破坏编译器自身」。
- **ASan 在本项目可用**（clang 22.1.8 实测通过）：`-fsanitize=address` 链接+运行均 OK，需 `PATH=/c/Program\ Files/LLVM/lib/clang/22/lib/windows:$PATH`（否则缺 `clang_rt.asan_dynamic-x86_64.dll` → exit 127）。对越界/UAF 是确定性检测，强于 -O2 碰运气；M48 闭包有意泄漏不会误报（Windows 默认不启 LeakSanitizer）。

## 分层门禁工具链（gate.mjs，独立提交）
- **入口**：`node tools/gate.mjs L0|L1|L2 [--full]`。`--full` 无视快照结论强制跑运行类门禁；L2 默认 `--full`。
- **三层（按影响面付费）**：
  - **L0**（~10s，每次保存）：静态检查(catn+shadow) → 自举一代 g1 → **IR 双后端快照比对** → conformance → `; UNSUPPORTED` 计数 0。
  - **L1**（IR 洁 ~13s / IR 脏 ~32s，提交前）：+ 自举不动点 **g2==g3** + （IR 洁则 SKIP run_examples/difftest，否则全跑）。
  - **L2**（~139s，里程碑）：+ 四代不动点 **g2==g3==g4** + **`cself` C 后端自举**(emit-c→clang→C 产物发射 IR 与 g4.ll 比 md5 + conformance，~14s) + difftest tc0 对拍(XFAIL emit-c) + **rls 快速通道**(g4 vs rls 编译器发射 `tc.tc` IR 互比 + 3 示例冒烟) + tote 冒烟。
- **自举不动点判据从第二代起算**：g1 由**改动前**编译器编出，改 emitter 后 g1≠g2 必然且正确。故比 `g2==g3`(boot23)、`g2==g3==g4`(boot4)、代际对拍比 `g2↔g3`、run_examples 用 g3、rls 用 g4 且两档编译器 IR 互比（不依赖 baseline）。
- **IR 快照（`tools/ir_snapshot.mjs` + `tests/ir_baseline.json`）**：对 `examples/*.tc` + `src/tc.tc` + `src/tote.tc`（24 目标 × ll/c/h = 72 条目）md5 基线。**必须双后端**（ll + c/h）——只比 `.ll` 无法覆盖 C 发射器改动（run_examples 是双后端验证）。⚠ 不覆盖：conformance 的 fail 用例诊断、runtime 改动、clang 版本变化。
- **防假绿 + 退出码**：catn_check / shadow_check 加最小匹配数断言（`sb_catN` ≥470 / 函数 ≥330 / 变量 ≥1880），低于阈值 `exit 2`；两工具均补 `process.exit(0/1/2)`，否则编排时被当通过。
- **difftest XFAIL**：tc0 emitter 冻结，`compile --emit-c` 通道恒失败属已知基线，以 tc0 为 ref 时自动 XFAIL（不计失败）；`--strict` 可关，`--xfail ch,...` 手指定。去 `npx tsx` 冷启动（用 `node node_modules/tsx/dist/cli.mjs`）+ 并行 `--jobs` → 52s→~6s。
- **并行安全区分**：不同工具之间串行（争抢 `out/`）；同一工具内**用例级**可并行（产物名按用例唯一、runtime lib 只读）。run_examples `--jobs N` 默认 `min(8, cpus)` → 57s→~10s。

## 实现铁律（致命坑）
- `sb_catN` 实参必==N（catn_check 守）；`cat2..6` 内建已移除；拼接只用 StringBuilder。**LLVM 后端不支持 `sb_cat2..6` 调用**，示例/测试一律 `sb_new`/`sb_append_str`/`sb_to_str`。
- 同名局部不可异型（shadow_check）；`a=b` 是 `"assign"` 非 `"assignment"`。
- LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang 用 `-O0` 非 `-Od`；`.lib` 须 `llvm-ar rcs` 非 `llvm-lib`。
- 字符串返回内建走 out 指针；`string+` 未实现；`TypeInfo`/`FieldInfo` C 后端按指针。
- 新增脱糖通道时，被替换的旧节点须**整组一次性**改 `kind` 为不在 `node_kind_names` 的内部标记（如 `ClauseDead`）下线，否则残留活节点被 check 二次诊断。
- 合成节点须承接原节点锚点（`ln`/`cl`/`tv`），否则诊断报不出行列（`n_file` 靠 `n.ln != 0`）。
- 全局 Sym var 初始化器搬进 `t__ginit`/`t.__ginit`。
- **LLVM 全局 slice 变量生成非法 IR**（`load %TSlice, ptr 0`）→全局栈用定长数组+计数，勿用 `[]i64` 全局。
- **C 后端 `[N]T` 表示为 `T*`，指针不自带存储**：任何新增的定长数组声明路径都必须同时发射 `T name_abuf[N];` 并让指针指向它，否则就是 NULL/野指针写入（M49 根因）。
- **conformance 只跑 `check`，完全不覆盖代码生成**；真正跑代码的是 run_examples（双后端实跑比对）与 gate 的 `cself`。新增运行期语义务必配示例，只加 conformance 用例等于没测。
- **新增关键字前必须全库扫同名标识符**（`fn` 曾撞 `var fn: i64` 等 3 处）。
- **跨语法不兼容期的桥接自举通法**：①编译器兼容新旧两法→用旧 canonical 编旧源得桥接器 ②脚本批量迁移全部 `.tc` ③编译器收紧（旧写法改硬错误）→重新自举至不动点。迁移错误须带具体名字与建议写法。

## 里程碑（压缩）
- M28..M41：map/数组/for迭代、`m[k]=v`、cat runtime、print/println、type_info、out 结构、拆 tc+tote、totter 放弃、Sym、移除 cat2-6。
- **M42** L-15 生效：24 草稿→23 采纳并入 reference.md §3.3-3.5；修 `defer` 发射缺口（原两后端静默丢弃→延迟栈 LIFO）。
- **M43** match 表达式 + 函数子句脱糖：`match (x) { pat when g => e }`、穷尽性 `T_MATCH_NONEXHAUSTIVE`、绑定替换栈 `mb_*`；**函数子句 = match 纯语法糖**（`desugar_func_clauses` 合并同名组，仅 #0 进 match，#1 起模式折叠进守卫，原子句下线 `ClauseDead`）。`match.md` 草稿四层全 ✅ 但仍 DRAFT 待采纳。
- **M44** 移除 `::` + `func`→`fn`（桥接自举，见铁律）。不动点 md5 `2874d4f2…`。
- **M45 FuncType v1**（函数指针语义）：`fn(A)->R` 一等值类型，顶层具名函数可绑定+间接调用，无闭包。**双类型池**：checker `TI.tif_*` / emitter `TD.tdf_*`；`ti_equal` 加 Func 结构比较。C 后端内联 `Ret (*name)(Args)`；LLVM `func`→`ptr`。**嵌套连续性**：`resolve_ti`/`resolve_type_desc`/`register_decl` 须「先收局部 `[]i64` 表、再整段搬入扁平池」防递归 append 打断参数区。诊断 `check_indirect_call`/`T_NOT_CALLABLE`。md5 `544bdeb3…`。
- **M46 FuncType v2 Stage A** 匿名函数字面量（无捕获）：`fn(P)->R{}` 表达式，编译期提升 `__lam_N`（`desugar_lambdas`）。连带修复：`parse_lambda_expr` 游标笔误、新增 `T_UNDEFINED_IDENT`、for 循环 checker 初始化变量作用域+步进 `nc` 漏检、C 后端 `append`/`slice_set` 字面量实参 → 数组复合字面量 `(ElemT[1]){v}`。md5 `171b6c0e…`，commit `f431ca0`。
- **M47 Stage B1 统一 TClosure ABI（非捕获路径）**：函数值 = **`TClosure*` 指针**（C `TClosure*` / LLVM `ptr`），被调统一 `Ret (*)(void* env, Args...)`，**env 首参**。
  - **必须指针非按值结构体**（`ll_isagg` 对 func 返 false，按值会踩 Win64 聚合 ABI 红线）。
  - **trampoline 不可省**（顶层函数无 env 首参，直接强转会让 env 挤掉首个真参）：惰性生成 `clos_names`/`clos_mark`；C 侧 `__tramp_g`+`static TClosure __tclos_g`（输出到**头文件尾部**），LLVM 侧 `@t.tramp.g`+`@t.clos.g`。
  - **判定「函数作为值」不能靠 AST 标记**（checker 对直接调用不遍历实参）→ 发射期就地判定：直接调用的 callee 走 call 分支读 `cal.sa` 不经 ident 分支，故凡进 ident 分支且解析到 FuncDecl 的必是函数值。C 用 `clos_decl_of`（先 `fs_get` 让局部优先），LLVM 用 `llfn_find`。
  - md5 `3b8ec056…`，commit `dfe305e`，全门禁绿。
- **M48 Stage B2 按值捕获闭包**：字面量引用外层局部/参数即自动捕获。
  - 脱糖三件事：合成 `__env_N` 结构（字段按自由变量首现序）→ `__lam_N` 前置 env 首参 + 体首插 `closure_capture` 拷回同名局部 → 原表达式改写 `closure_make`（堆分配 env + 逐字段拷入 + 堆分配 `TClosure{fn,env}`）。
  - **捕获分析用通用六槽遍历**（`na/nb/nc/nd + la/lb/lc`），不逐 kind 枚举；绑定栈靠长度回退模拟作用域。
  - **v1 有意泄漏**：env 与 TClosure 用 `t_alloc` 不回收。
  - **被捕获绑定须有显式类型标注**否则 `T_CLOSURE_CAPTURE`（for-each 迭代变量无标注→不可捕获）；名字根本不存在则 `T_UNDEFINED_IDENT`。
  - **非 ident callee 间接调用**（同批修复）：`h.op(4)`/`make2(1)(2)(3)`/`fs[i](x)` 现均可调。`iftd` 顺序：局部 `fs_get`→全局 `llgv_find`→**仅非 ident 时** `ll_etd(n.na)`（裸 ident 是顶层函数名时须走直接调用路径，否则误当闭包解包）。⚠ `ll_call` **入口**就对非 ident bail，补丁必须抽成独立函数从入口分流，写在函数中段不可达。
  - md5 `d134ad6a…`，全门禁绿（conformance 49/49、examples 双模式 16/16、代际对拍 27/27）。
- **M49 C 后端自举打通**（修掉长期技术债，`tc_from_c.exe` 从「一启动干活就崩」到完全可自举）。
  - **根因**：C 后端把定长数组 `[N]T` 表示为 `T*`（与 slice 同形），但**指针本身不分配存储**。于是全局 `var g_fc_d: [64]i64;` 发射成 `int64_t* g_fc_d;` = NULL → `desugar_func_clauses` 首行 `g_fc_d[0] = d` 直接写 0 地址。tc.tc 自身用了 6 个定长数组全局（`g_fc_d`/`g_fc_i`/`g_mb_arm`/`g_mb_no`/`g_defer`/`g_defer_ll`），故解析第一个函数子句就炸；示例都不用定长数组，所以 C 后端编示例一直正常。
  - **修法**（`emit_global_var` + `emit_stmt` 的 var_decl 分支，各加一段）：先发射定长缓冲再让指针指向它 —— `int64_t g_fc_d_abuf[64]; int64_t* g_fc_d = g_fc_d_abuf;`。保持 `T*` 表示法与 `(obj[idx])` 索引发射不变，改动面最小。局部同理（含带字面量初始化器的 `var lit: [3]u8 = [1,2,3];`，旧发射是非法的 `uint8_t* lit = {1,2,3};`）。
  - **ASan 是本次的定位主力**：直接给出 `WRITE of size 8 at 0x000000000000` + `desugar_func_clauses ← parse_unit` 调用栈，几分钟定位；printf 二分会慢得多。
  - **门禁盲区（本次一并堵上）**：conformance 只跑 `check`（**不碰代码生成**），run_examples 虽是双后端但示例不用定长数组，两道门禁都照不到 → 新增 ①`examples/fixed_array_demo.tc`（全局/局部、有无初始化器全覆盖，经双后端实跑）②gate L2 新步骤 **`cself`「C 后端自举」**：`g4 → emit-c → clang → 用 C 产物发射 tc.tc 的 IR 与 g4.ll 比 md5 + 跑 conformance`，仅 ~14s。**已验证反向有效**：用 `git show HEAD:src/tc.tc` 重建的旧编译器跑新示例，LLVM 通过而 C 后端硬失败。
  - **结论**：C 产物与 LLVM 产物对 `src/tc.tc` 发射**逐字节相同的 IR**，且 C 产物能重新生成逐字节相同的 `tc.c`/`tc.h`（C 后端自身也到不动点）；conformance 49/49、ASan 编译 tc.tc 全程无报告。不动点 IR md5 `e5852ea1…`，gate L2 13/13 绿（139s）。

## 技术债
- @derive 表驱生成（9 trait 手写）；type_info 仅 struct；import_json 嵌套；优化后端。
- ~~C 后端自举产物运行崩溃~~ **已解决（M49）**，见里程碑。
- 闭包环境不回收（M48 v1 有意泄漏），需所有权或 GC 才能解。
