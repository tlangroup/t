# t 语言编译器 — 项目笔记（精简）

## 概览
- **t**：静态类型、数据驱动、ECS 取向，扩展名 `.tc`；宪法 `docs/constitution.md`（2026-08-01 生效，取代 spec），参考手册 `docs/reference.md`。⚠ `spec.md` 已废弃冻结。
- **声明语法（M44 起）**：**并置式** `Name fn(...) -> Ret {}` / `Name struct {}` / `Name enum : u8 {}` / `Name flag[u16] {}` / `Name variant {}` / typealias `Name Type;`。⚠ `::` 绑定符与 `func` 关键字**已移除**，旧写法报带迁移指引的硬错误。
- **编译器 `src/tc.tc`**：自举单纯编译器（lex/check/compile/emit-c/emit-ll/build/run，默认后端 LLVM），二进制 `out/<mode>/tc.exe`。
- **totter `src/totter.tc`**：已放弃 abandoned，保留不删；`gen/tc.tc` 冻结快照。`src/tc.tc` 的 `// >>> GEN:` 区间现手写维护。
- **tote `src/tote.tc`**：包管理器/构建系统，委托 `tc`；二进制 `out/<mode>/tote.exe`。
- **命名红线**：`✅ tote` / `status='tote'`（"已实现"）绝不可改名为二进制 `tote`；改的是裸 `tote` 编译器引用→`tc`。
- `tc0/` TS 参考实现已冻结，**且自 M44 起只认旧语法 → difftest 的 tc0 对拍通道已失效**，改用自举代际对拍。

## 法律体系
- 宪法→法律→代码。宪法 `docs/constitution.md` 审查法律（四层 ✅/⚠️/❌/🚫）。
- 法律全集 `docs/laws/*.md`（general + L-02..L-15，均草案待采纳），用于检查代码执行。
- **L-15 语法规则法**：语法子层经 草稿→法律验证(L-04/L-03/L-01/L-02/L-14)→并入 `docs/reference.md`→草稿失效。

## 目录 & 构建
- 产物 `out/dbg/`(`-O0 -gcodeview`) 与 `out/rls/`(`-O2`)，各带 `deps/t_runtime.lib`；`--mode` 控制目录+优化档；缺失回退直编 `runtime/*.c`。
- 流水线：gen_ebnf→build_runtime→tc/tote 自举。`out/dbg/tc.exe` 运行锁 exe，重建须 `--output <临时名>` 再 `cp`。

## 验证七步（门禁）
1. md5sum src==gen（已废，totter 放弃）2. difftest **自举代际对拍** `--ref <genB.exe> --cand <genD.exe>` → 27/27（tc0 通道已失效，见上）3. conformance **40/40** 4. 三阶段自举 IR 逐字节(b==c==d) 5. shadow_check+catn_check OK 6. 发射侧 `; UNSUPPORTED` 计数 0 7. run_examples 双后端 **12/12**（dbg+rls）。tote PM 冒烟单独验。
- **门禁必须串行跑**：并行会争抢 `out/` 产物造成假失败。
- **UNSUPPORTED 计数口径**：必须 `grep -cE '^[[:space:]]*; UNSUPPORTED'`；裸 `grep -c '; UNSUPPORTED'` 会命中 6 处编译器自身诊断字符串常量（假阳性）。
- **管道 SIGPIPE 假象**：`node tools/xxx.mjs | tail -N` 可能 exit 1 并吞掉总结行，误判失败；长输出改重定向到文件再 grep。
- **改语法后必须核对正则型门禁工具的匹配数**（shadow_check 等）：正则失配会零样本打印 "OK" 造成**假绿**。

## 实现铁律（致命坑）
- `sb_catN` 实参必==N（catn_check 守）；`cat2..6` 内建已移除，残留即错；拼接只用 StringBuilder。
- 同名局部不可异型（shadow_check）；`a=b` 是 `"assign"` 节点非 `"assignment"`（m[k]=v 发射点）。
- LLVM 避 Win64 聚合 ABI（`tll_*` 指针桥）；clang 用 `-O0` 非 `-Od`；`.lib` 须 `llvm-ar rcs` 非 `llvm-lib`。
- 字符串返回内建走 out 指针；`string+` 未实现一律 StringBuilder；`TypeInfo`/`FieldInfo` C 后端按指针。
- **`sb_cat2..6` 调用 LLVM 后端不支持**（仅 C 后端有 `t_sb_cat2`），示例/测试里拼接一律 `sb_new`/`sb_append_str`/`sb_to_str`，否则发射 `; UNSUPPORTED call` → 非法 IR。
- 新增 AST 脱糖通道时，被替换的旧节点须**改 `kind` 为不在 `node_kind_names` 的内部标记**（如 `ClauseDead`）下线，且**整组一次性下线**，否则残留活节点会被 check 二次诊断。
- 合成节点须承接原节点锚点（`ln`/`cl`/`tv`），否则诊断报不出文件行列（`n_file` 靠 `n.ln != 0`）。
- 全局 Sym var 初始化器搬进 `t__ginit`/`t.__ginit`。
- **LLVM 全局 slice 变量生成非法 IR（`load %TSlice, ptr 0`）**→延迟栈等全局栈用定长数组+计数，勿用 `[]i64` 全局。

## 里程碑
- M28..M31 map/数组/for迭代 M32 m[k]=v M33 cat runtime M34 print M35 println M36 type_info M37 out结构/M38 拆 tc+tote M39 totter放弃 M40 Sym M41 移除 cat2-6。
- **M42（2026-08-01）L-15 语法规则生效**：24 草稿 22 采纳并入 reference.md §3.3/§3.4/§3.5，2 失败(`decl_func.md`/`match.md` 用 `fn` 自由式，与代码 `func`+`::` 冲突→忽略)；修复 **`defer` 发射缺口**（C/LLVM 后端原静默丢弃 defer 块，现登记延迟栈、return/函数尾 LIFO 执行），补 `examples/defer_demo.tc`+`.expected.txt`（双后端 10/10），全门禁绿。后补采纳 `decl_func.md`（改写为绑定式）→ 23 采纳 / 1 忽略。
- **M43（2026-08-01）match 表达式 + 函数子句脱糖**：
  - `match (x) { pat when g => expr ... }`：`KwMatch`/`KwWhen`/`=>`、`parse_match_expr`、穷尽性 `T_MATCH_NONEXHAUSTIVE`、绑定替换栈 `mb_*`、C+LLVM 双后端降为 if/assign 链。
  - **函数子句 = match 的纯语法糖**（用户 P2 裁定）：`parse_func_decl` 参数位泛化为 `ParamPattern`（复用 `P` 节点 `ba`=通配 / `nb`=字面量 / `nc`=守卫）；`desugar_func_clauses()` 挂 `parse_unit` 末尾，同名组合并为 `return match (__p0) {...}`，原子句下线为 `ClauseDead`。**仅 #0 进 match**，#1 起的模式折叠进守卫（故 #1 起须同名绑定）。
  - 诊断：`T_FUNC_CLAUSE_ARITY/_NO_TYPE/_RET_TYPE/_BIND_CONFLICT/_BODY`。资产：`examples/match_demo|clause_demo`、`conformance pass/p17` + `fail/f17..f22`。
  - `match.md` 草稿四层判据全升 ✅，但**仍 DRAFT，待用户「规则采纳」才并入 reference.md**。
- **M44（2026-08-01）语法精简：移除 `::` + `func`→`fn`**（用户指令「1&2」，依据 L-01 第19条「输入最小化」）：
  - **桥接自举**（跨语法不兼容期的通法）：① 编译器先**兼容新旧两法**（`fn` 别名 + `::` 可选）→ 用旧 canonical 编旧源得桥接器；② 脚本批量迁移全部 `.tc`（`build/migr/migrate_syntax.py`，备份在 `build/migr/backup/`）→ 桥接器编新源；③ 编译器**收紧**（删 `func`、`::` 改硬错误）→ 重新自举至不动点。
  - **新增关键字前必须全库扫同名标识符**：`fn` 撞了 `var fn: i64`（tc.tc→`fdecl`）、`var fn: Node`（checker/parser.tc→`fnode`）、参数 `fn`（totter.tc→`col`）。
  - **迁移错误须带具体名字与建议写法**（L-01 第19条），非泛化 parse error。
  - 文档改写边界：**EBNF 产生式分隔符（`rule :: ...`、`SlotTable ::`）与注解 `targets:"func"`/symkind `"func"` 一律不动**，只改带引号的语言绑定符与散文示例。`spec.md` 冻结不动；`gen/tc.tc` 虽为冻结快照但**必须迁移**（维持"仓库内所有 `.tc` 均合法"不变量）。
  - 自举不动点 md5 `2874d4f29ccc88714140b0e1e23d45d5`，全门禁绿。

## 技术债
- @derive 表驱生成（9 trait 手写，暂缓）
- 函数类型(spec-only)；type_info 仅 struct
- import_json 嵌套；C 后端 append 取址；优化后端
