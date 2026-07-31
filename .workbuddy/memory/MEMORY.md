# t Language Compiler — Project Notes

## 概览
- **t**：数据驱动、ECS 取向、静态类型语言，扩展名 `.tc`；规范 `docs/spec.md`，参考手册 `docs/reference.md`（数据表/文法唯一真相源）。
- **主实现 `src/tote.tc`**（~12.6k 行自举编译器：lex/check/compile/emit-c/emit-ll/build/run/test/ast，默认后端 **LLVM**）。
- **生成器 `src/totter.tc`**（t 编写）：读 `build/ebnf.json` → 重写 `src/tote.tc` 的 `// >>> GEN:xxx >>> … <<< GEN:xxx <<<` 区间 → `gen/tote.tc`。
- `tc0/`（TS 参考实现）已冻结；种子封存 `seed/tc0/`。

## 构建 & 标准流水线
1. `node tools/gen_ebnf.mjs` → `build/ebnf.json`
2. canonical tote 编译 `src/totter.tc` → `build/totter/totter.exe`
3. `./build/totter/totter.exe` → `gen/tote.tc`；`cp gen/tote.tc src/tote.tc` 提升定点
4. canonical tote 编译 `src/tote.tc` → 新 tote
- 编译：`build/tote/tote.exe build <f.tc> --clang "C:/Program Files/LLVM/bin/clang.exe" --output build/<dir>/<name>`（输出目录先 mkdir）。`emit-ll --output p` 写 `p.ll`；`compile --output <dir>` 出 C。
- 验证四件套：① 定点 `md5sum src/tote.tc gen/tote.tc` 相等 ② `node tools/difftest.mjs --ref A --cand B` → 27/27 ③ `node tools/conformance.mjs --compiler <exe>` → 29/29 ④ LLVM IR 逐字节 diff + `run --example hello/fib` smoke。
- 提交前自检：`node tools/shadow_check.mjs src/tote.tc`（同名不同型局部变量）+ `node tools/catn_check.mjs src/tote.tc`（catN 实参数）。
- **测试体系不验证运行时行为**：conformance 只跑 `check`（用例必须有 `// EXPECT: pass|error|warning` 首行），difftest 只比 lex/parse/check 的 stdout，`assert_*` 在 LLVM 后端是 no-op（IR 仅留注释）。运行时语义必须写 `examples/*.tc` 实跑 + 存 `.expected.txt` 比对，并交叉验证 C 后端（`compile --output <目录>` 出 .h/.c → clang 编译 → 输出应与 LLVM 产物逐字节一致）。
- 新增能力会让 b→c 阶段 IR 多出新 declare（canonical 旧版不认识），**不算不动点破坏**；判据是再跑一阶段 c→d IR 逐字节相同。
- 两阶段自举 tote-b→tote-c，IR 逐字节相同即等价（exe md5 差异=链接时间戳）。提升 canonical 前归档 `build/archive/<name>_pre-<里程碑>.exe`。

## 环境 / 实现铁律（最高频踩坑）
- MSVC 需 `/utf-8` + 生成 C 带 BOM；LLVM 避开 Win64 聚合 ABI（`runtime/t_shim_ll.c` 的 `tll_*` 指针桥）。arena 512MB。line/col = UTF-8 字节计数；stdout 二进制模式；`sb_to_str` 复制语义。
- **catN 实参个数必须严格等于 N**——多传/少传不一定报错，可能只发射出残缺字符串或在 IR 炸。守卫 `tools/catn_check.mjs`。
- **同一函数内同名局部变量不得有不同类型**：LLVM 后端 `fs` 表按 (fn,var) 扁平记录、`fs_get` 从后往前取，后声明的同名变量污染前面的聚合性判定 → 漏 `load`，症状 `'%v.x' defined with type 'ptr' but expected 'i64'`。守卫 `tools/shadow_check.mjs`。
- **checker 跨函数引用很宽松**：在 `ll_addr` 用 `ll_call` 的局部（如 `td_i64`）不会报错、被当 0 → 错 IR。索引用 `ll_widen_idx(emit_lle(n.nb), n.nb)`，勿硬编码 `td_i64`。
- **slice 是值传递**：函数内 `append` 不影响调用方，无 out 参数；返回表用全局 slice + base 偏移。误用表现 `t_slice_at index 0 length 0`。
- **string `+` 在 LLVM 后端未实现**（静默发 `add i64`），一律 `cat2..cat6`。
- `append(s, 字面量/调用)` C 后端取临时量地址会失败，须先存局部。无 `str_find`（自实现）。单字节追加用 `sb_append_char`（无 `sb_append_u8`，LLVM 静默跳过）。
- C 后端未声明 `println`（只有 `print`）；`slice_new()`/`slice_at()` 非内建。
- **UNSUPPORTED 自查**：`grep -o "UNSUPPORTED call [a-z_0-9]*" x.ll` 基线只应剩 2 条（空名 `call` + `call target`）。
- 诊断：`T_TYPE_UNKNOWN` 从未发出（实报 `T_TYPE_MISMATCH`）；命名违规是 warning（exit 0）。
- 自举鸡蛋问题：新增内建要在 tote 自身运行期生效须两阶段自举；只用于被编译程序则一阶段即可。

## M28：既有限制修复（2026-07-30）✅ 详见日志
lld-link 加 `-Wl,-subsystem:console`（链接前查 `ll_has_main`）/ `int_to_str` 全链路内建 / 数组字面量整型统一提 `i64` + `can_cast` Array↔Slice / 切片字面量 codegen / 定长数组 `[N]T` LLVM 支持（`TD.alen`、`ll_td`→`[N x T]`、index 走 `getelementptr [N x T], ptr, i64 0, i64 idx`）。用例 p11/p12。

## M29：map[K]V 端到端（2026-07-30）✅
- 解析/TI/TD 骨架早已实装（`spec-only` 标注过时）；本轮补内建 + 双后端 codegen + runtime。
- runtime：`map_find_slot()` 抽公共探测；`t_map_val_ptr`（未命中返回 arena 零缓冲）+ `t_map_del`（tombstone + 从 order 数组 memmove 保持插入序）+ 两个 `tll_*` shim。
- 6 内建 `map_new/set/get/has/len/del`：前 5 个入 `BuiltinTable`/`@tdrule td_calls`；**`map_get` 返回 V 无法表驱**，在 `infer_expr`/`expr_type_desc` 手写特判（取首实参 map 类型的 `.val`）。
- C 后端 `c_map_get` 发 `(*(V*)t_map_val_ptr(m,&k))`；LLVM `ll_map_argptr(an, want)` 按声明的 K/V 类型 alloca+store（先 `ll_cast_v` 转宽，否则只写低位）+ `ll_map_get`；两后端 index 分支 `ot.cat=="map"` 复用同路径 → `m[k]` ≡ `map_get`。
- `can_cast` Map 分支：任一侧 key/val 为 Unknown 即放行（否则 `map_new()` 返回值无法赋给 `map[K]V`）。
- `map_new(m)` 需传同类型变量提供 K/V（t 无类型参数语法）；语义见 `docs/spec.md` §2.2。
- 用例 `pass/p13_map_ops.tc` + `examples/maps.tc`/`maps.expected.txt`（19 行，C/LLVM 逐字节一致）。
- map 字面量 `{k:v}` emit + `for (k in m)` 按插入序迭代键，已在 **M30** 交付（见下）。

## M30：map 字面量 + for-in 迭代（2026-07-31）✅
- **map 字面量**：`var m: map[K]V = [k1: v1, …];`，无初始化声明也建空表（声明即可用，不必 `m = map_new(m)`）。emit 路径 C/LLVM 双后端（`t_map_new`/`tll_map_new` + 逐项 `put`）。
- **for-in 迭代键**：`for (k in m){…}` 按插入序，绑定变量类型 = K。runtime 已有 `t_map_count`/`t_map_key_str_at`/`t_map_key_int_at`，仅补 3 个 `tll_*` shim；`check_stmt`/`collect_local_types`/双后端 `emit_stmt`/`emit_llstmt` + `emit_lldeclares` 各加一段。
- **整型键/值统一提 i64**：复刻 array_lit 规则，否则 `["a":1]` 推成 `map[string]u8` 失配。
- **修掉静默 bug：窄整型键**。`map[i32]i64` 此前 `map_get` 恒返回 0（runtime 按 `int64_t*` 读键，后端对 i32 直接取址 → 高位栈垃圾）。修法：整型键一律按 i64 落盘（C 复合字面量 `&(int64_t){(int64_t)(expr)}`；LLVM `ll_map_keyptr`→`ll_map_argptr(kn, i64)` 扩宽）。附带收益：键/值可写字面量（`map_set(m,"k",11)`/`map_get(m,8)`）。新增 `call_arg_node(cid,ix)` 助手供 C 后端反查实参类型。
- 验证：定点 src==gen / difftest 27/27 / conformance 27/27（新增 `pass/p14_map_iter.tc`）/ 三阶段自举 c→d IR 逐字节相同 / `examples/map_iter.tc` C==LLVM==`.expected.txt` 逐字节。归档 `build/archive/{tote,totter}_pre-M30-mapiter.exe`，canonical 已提升。

## M31：map 收尾四块（2026-07-31）✅
延续 M30，补齐 map 使用体验剩余四块（用户全选）：M31a 参数/返回值、M31b for(k,v in m)、M31c 嵌套 map + 字面量作表达式、M31d 字面量非局部位置。
- **M31a 参数/返回值**：类型系统（resolve_type_desc/ti_equal/desc_to_c/ll_td）与双后端发射层天然支持，无需改动；`examples/map_advanced.tc` 实证 `fn(m: map[K]V) -> map[K]V` 正确。
- **M31c 嵌套 map + 字面量作表达式**：`emit_lle`（LLVM）补 `map_lit` 分支调 `ll_build_map_lit` 到 `ll_tmp()` 返回（此前漏分支对 map_lit 返 `"0"` → `store ptr 0` / `call i64 @t.count_keys(ptr 0)`）；C `emit_expr` 同补 `map_lit` 分支复用 `c_emit_map_lit`。`map[K]map[K2]V` 逐层 `m[k1][k2]` 读写 OK。
- **M31b for(k,v in m) 双变量迭代**：`for_each` 节点加 `sb`（值变量名）槽；parser `parse_for_stmt`/`src/totter.tc` 的 `emit_forx` 支持 `(k, v in m)`；checker 绑定 `vt5=t6.val` 并 `sym_define`，非 map 双变量报 `T_TYPE_MISMATCH`；`collect_local_types` 对 `sb` 设 `itd.val`；C/LLVM `emit_stmt`/`emit_llstmt` 经 `t_map_val_at(m,i)`（插入序下标）绑定值变量；LLVM declare 加 `tll_map_val_at`。runtime `t_runtime.c` 加 `t_map_val_at`（str/int 键分支，`t_shim_ll.c` 加 `tll_map_map_val_at`→`tll_map_val_at` 同名 shim）。
- **M31d 字面量非局部位置（全局 var / 结构体字段）**：C 不允许运行时调用作文件作用域初始化器 → 引入 `glines` 缓冲 + `g_spush_to_ginit` 开关，`emit_global_var` 把非常量初始化器搬进 `t__ginit()`（main 开头调用）；`g_stmt_pad` 供 `emit_expr` 的 map 字面量分支对齐缩进。LLVM 无此限制但双后端产物逐字节一致。
- 验证：定点 src==gen（md5 `abd2e465…`）/ difftest 27/27 / conformance **29/29**（新增 `pass/p15_map_advanced.tc` + `fail/f14_for_kv_non_map.tc`）/ 三阶段自举 c→d IR 逐字节相同 / `examples/map_advanced.tc`（30 行）C==LLVM==`.expected.txt` 逐字节 / UNSUPPORTED 基线 0 条。canonical 已提升 `build/m31d/tote.exe`→`build/tote/tote.exe`。

## M32：map 索引写 m[k] = v（2026-07-31）✅
补齐 map 对称能力：读 `m[k]`（M29 经 `map_get`/`c_map_get`/`ll_map_get`，返回 V 值字节指针）已有，写 `m[k]=v` 此前只能走 `map_set` 内建。现 `m[k]=v` 编译为 `t_map_put`/`tll_map_put`（find-or-insert，**绝不**对读值回写——键未命中时 `t_map_val_ptr` 返回零缓冲，回写会丢失）。
- **关键节点类型陷阱**：`a = b` 解析为 **`"assign"`** 节点（`parse_assign_expr`→`mk_assign`，L4896），**不是** `"assignment"`（`mk_assignment` L459 由 `parse_expr_or_assign_stmt` 创建，因 `parse_expr` 已吃掉 `=`，实际几乎不可达 → 死代码）。所以 **`m[k]=v` 的发射点必须在 `emit_expr`/`emit_lle` 的 `"assign"` 分支（L9869 / L12299），而非 `emit_stmt`/`emit_llstmt` 的 `"assignment"` 分支**——当初误改 `"assignment"` 分支导致所有改动不生效、长时间以为是 stale 二进制。
- **C 后端**（`emit_expr` "assign" 分支）：`mptr = c_map_lhs_ptr(lnode.na)`，`t_map_put(mptr, c_map_keyp(lnode.na, lnode.nb), c_map_valp(lnode.na, n.nb))`。`c_map_lhs_ptr`（新增，L9750 后）单层 `m[k]` → `emit_expr(m)`（变量即 `TMap*`）；嵌套 `deep[a][x]` → `(*(TMap**)t_map_val_ptr(deep, &"a"))`（注意 `(*(TMap**)` 解引用需 **两个** 收尾 `))`）。`c_map_keyp`/`c_map_valp` 从 map 类型反查 K/V（标量键 `&(int64_t){…}`、标量值 `&(V){(V)(…)}`）。
- **LLVM 后端**（`emit_lle` "assign" 分支）：`mp = emit_lle(ln.na)`（map 非 aggregate，`ll_map_get` 对 map 值直接 `load ptr` 返回 `TMap*`，单层/嵌套同此路径）；`ll_map_keyptr(ln.nb, lott.key)` + `ll_map_argptr(n.nb, lott.val)` → `call void @tll_map_put(ptr mp, ptr kp, ptr vp)`。
- 复合赋值 `m[k] += v` 仍走 `binary` 分支（读值 `*ptr` 是左值，`+=` 直接生效），无需特判。
- 用例 `examples/map_assign.tc`（string/整型键、覆盖、计算右值、嵌套写）+ `.expected.txt`（17 字节 `1520onetwo3510070`），C==LLVM 逐字节一致；`examples/map_advanced.tc` 回归 C==LLVM 一致。
- 验证：定点 src==gen（md5 `9c68f878…`）/ difftest 27/27 / conformance 29/29 / 两阶段自举 IR 逐字节相同 / canonical 已提升（`build/tote/tote.exe`）。

## 数据驱动自生成主线（M17→M26）✅
链路：`docs/reference.md` 表 → `tools/gen_ebnf.mjs` → `build/ebnf.json` → `src/totter.tc` → `src/tote.tc` 的 24 个 GEN 区间（`kw_lookup`/`builtins`/`derives`(9)/`diagnostics`(10)/`annotations`(34)/`xid`/`parser_dispatch`/`parser_rules`(30)/`ast`(65)/`scalar_*`(4)/`type_infer1/2`/`type_slice`/`type_resolve`/`type_declreg`/`td_*`(6)）。
- **节点索引漂移铁律**：槽表达式内子节点分配改 `mk_X(...)` 会让实参先求值→索引前移→AST 变。命中处 `@rule … mk=inline`。
- **GEN 标记名不得是其他前缀**；`kw_lookup` 须在 `tokenize()` 前 init；`gen_ebnf.mjs` 纯注释表读 `cur.rawFull`；表外键查询发射非法 token（`?SLOT_TY?` 等）勿静默兜底。
- 划界：只吃「查表得类型」分支；带控制流/诊断的算法分支留手写。

## 语言特性史（指针）
- **Variant (M12)**：`variant`→VariantDecl+VC；发射 tag+union struct + 每 case 三自由函数 `Name_from_/is_/as_Case`；不支持 `@derive`。
- **§7.2 CSV/JSON CTFE 导入 (M27)**：`var xs: []Struct = import_csv/json("p")` 仅作局部 var 初始化器，脱糖为合成 `__import_N :: func()->[]Struct`；路径相对源文件目录；JSON 仅顶层对象数组+标量字段。合成 decl 铁律：`ba`(is_extern)=false 且须 `append(decl_list, fn)` 且 check 循环重取 `slice_len(decl_list)`。

## 技术债 / 后续
1. @derive 表驱生成（9 trait 仍手写，用户 2026-07-30 明示暂缓）
2. 函数类型（spec-only）；`type_info(T)` CTFE 内建
3. import_json 嵌套对象/数组字段
4. C 后端 `append(s, 字面量/调用)` 取址问题；缺 `println`；优化后端

## M33：cat2..cat6 字符串拼接内建接入运行时（2026-07-31）✅ 修复技术债 #5
`t` 文档称「字符串拼接一律 cat2..cat6」，但此前 cat2..cat6 仅在编译器自身源码定义（L997-1031），无 builtin 发射分支、runtime 无 `t_catN`/`tll_catN` —— 用户程序调用即 `undeclared`/链接失败，必须绕道 `StringBuilder`。
- **数据驱动注册**（真相源 `docs/reference.md`）：`BuiltinTable` 加 `cat2..cat6 => ti_mk("String")`；`@tdrule td_calls` 加 5 行 `cn catN one mk string`。`node tools/gen_ebnf.mjs` → `build/ebnf.json`；`build/totter/totter.exe` → `gen/tote.tc`（同步 `src/tote.tc` 的 `builtin_ret` 与 `td_calls` GEN 块）。`catN` 返回 string，实参须为 string（拼接非字符串先 `int_to_str`）。
- **runtime**：`t_runtime.c` 加 `t_cat2..t_cat6(TStr…) -> TStr`（StringBuilder 拼接）；`t_runtime.h` 加声明；`t_shim_ll.c` 加 `tll_cat2..tll_cat6`（TStr* 指针 + out 参数）。
- **C 后端**（`emit_expr` builtin 分支）：`c_emit_cat_call(cn, av)`（新增助手 L9770 后）按 `t_<cn>(...)` 发射（实参 TStr 值传递）；注意前缀 `t_`（LLVM 用 `@tll_`）——初版漏 `t_` 导致发 `cat2(...)` 仍 `undeclared`，已修。
- **LLVM 后端**（`emit_lle` builtin 分支）：`ll_scratch("%TStr")` 取 out，`emit_lle(ae[i])` 得各实参 `ptr`，`call void @tll_catN(ptr, ptr, …, ptr out)`；`llph` 加 5 条 `declare void @tll_catN(ptr…, ptr)`。
- **自举注意**：`cat2..cat6` 在编译器自身源码定义为用户函数；`builtin_ret` 仅在 `sym_lookup` 失败时被查询（L7061），故注册为 builtin 不与其冲突、不触发重定义；自举后编译器内部 `catN` 调用改为走 `@tll_catN`（IR 中 `@t.cat3`→`@tll_cat3` 即本次改动落地之证）。
- 用例 `examples/cat_demo.tc` + `.expected.txt`（46 字节 `Hello, World!abcx12yn=10 20 okv1234!ABCDsum=15`，含嵌套 cat/返回值/右值/实参），C==LLVM 逐字节一致。
- 验证：定点 src==gen（md5 `ad1fe3e6…`）/ difftest 27/27 / conformance **29/29** / 两阶段自举 IR 逐字节相同（tote-b==tote-c；tote-a→tote-b 因 emit 变更而 `@t.cat3`→`@tll_cat3` 属一次性过渡，非不动点破坏）/ UNSUPPORTED 基线 0 条 / 提升 canonical `build/tote/tote.exe`。

## M34：修复 `print(scalar)` LLVM 后端崩溃（2026-07-31）✅
`print(x)`（x 为标量）此前漏过类型检查，LLVM 后端生成 `call void @tll_print(ptr <i64>)` 触发 IR 校验失败 `'i64' but expected 'ptr'` → `clang link failed`。根因：内建调用实参类型完全不校验（`builtin_ret` 只管返回类型）。
- **修复**：`infer_expr` 的 `call` 分支对 `print`/`println`/`eprint` 实参加 `String` 约束（非 `String` 且非 `Unknown` → `T_TYPE_MISMATCH`，提示用 `int_to_str`/`to_string`/`cat*`）。在 `run_check()` 阶段触发、`has_errors()` 中止，故不进 `emit_llunit`，后端崩溃消除。
- **坑**：`infer_expr` 形参 `e` 才是 i64 节点索引，`n` 是 `Node` 结构；误用 `n_file(n)` 会让编译器自身重编译时 `@t.n_file(i64 %v.n)` �� ptr 错。位置信息一律用 `e`。
- 回归用例 `tests/conformance/fail/f12_print_scalar.tc`（`// EXPECT: error T_TYPE_MISMATCH`）。所有现有示例 `print(` 均传字符串/`int_to_str`/`cat*`，无误伤。
- 验证：两阶段自举 IR 逐字节相同（`a75de97a…`）/ difftest 27/27 / conformance **30/30** / shadow_check+catn_check OK / UNSUPPORTED 0 / canonical 提升 `build/tote/tote.exe`。
