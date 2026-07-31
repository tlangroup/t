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
- 验证四件套：① 定点 `md5sum src/tote.tc gen/tote.tc` 相等 ② `node tools/difftest.mjs --ref A --cand B` → 27/27 ③ `node tools/conformance.mjs --compiler <exe>` → 25/25 ④ LLVM IR 逐字节 diff + `run --example hello/fib` smoke。
- 两阶段自举 tote-b→tote-c，IR 逐字节相同即等价（exe md5 差异=链接时间戳）。提升 canonical 前归档 `build/archive/<name>_pre-<里程碑>.exe`。

## 环境 / 实现铁律（最高频踩坑）
- MSVC 需 `/utf-8` + 生成 C 带 BOM；LLVM 避开 Win64 聚合 ABI（`runtime/t_shim_ll.c` 的 `tll_*` 指针桥）。arena 512MB。line/col = UTF-8 字节计数；stdout 二进制模式；`sb_to_str` 复制语义。
- **catN 实参个数必须严格等于 N**——多传不报错，只在 IR 炸（曾多传 `""` 拼成 `i64 @.tsN`）。
- **checker 跨函数引用很宽松**：在 `ll_addr` 用 `ll_call` 的局部（如 `td_i64`）不会报错、被当 0 → 错 IR。索引用 `ll_widen_idx(emit_lle(n.nb), n.nb)`，勿硬编码 `td_i64`。
- **slice 是值传递**：函数内 `append` 不影响调用方，无 out 参数；返回表用全局 slice + base 偏移。误用表现 `t_slice_at index 0 length 0`。
- **string `+` 在 LLVM 后端未实现**（静默发 `add i64`），一律 `cat2..cat6`。
- `append(s, 字面量/调用)` C 后端取临时量地址会失败，须先存局部。无 `str_find`（自实现）。单字节追加用 `sb_append_char`（无 `sb_append_u8`，LLVM 静默跳过）。
- C 后端未声明 `println`（只有 `print`）；`slice_new()`/`slice_at()` 非内建。
- **UNSUPPORTED 自查**：`grep -o "UNSUPPORTED call [a-z_0-9]*" x.ll` 基线只应剩 2 条（空名 `call` + `call target`）。
- 诊断：`T_TYPE_UNKNOWN` 从未发出（实报 `T_TYPE_MISMATCH`）；命名违规是 warning（exit 0）。
- 自举鸡蛋问题：新增内建要在 tote 自身运行期生效须两阶段自举；只用于被编译程序则一阶段即可。

## M28：既有限制修复（2026-07-30）✅
1. **lld-link subsystem**：clang 命令加 `-Wl,-subsystem:console`；链接前查 `ll_has_main`，无 `@main` 报 `error: no entry point`（emit-ll 不受限）。
2. **LLVM int_to_str UNSUPPORTED**：全链路内建 `int_to_str(i64)->string`：runtime `t_int_to_str`(sb+append_i64+to_str) + `t_runtime.h` 声明 + shim `tll_int_to_str(i64,TStr*)` + reference.md `BuiltinTable`/`@tdrule td_calls` 各加一行 + C 后端 `t_int_to_str(...)` + LLVM `ll_call` 用 `ll_scratch("%TStr")` + `emit_lldeclares` 加 declare。
3. **数组字面量推导**：`infer_expr(array_lit)` 整型元素统一提 `i64`（`[1,2,3]`=`[3]i64`）；`can_cast` 新增 Array↔Slice 转型（定长→定长要求 alen 相等，元素 Unknown 放行，否则递归）。
4. **切片字面量 codegen**（新）：`var xs: []T = [a,b,c]` C 后端发 `t_slice_new`+逐元素局部+`t_slice_append`；LLVM `ll_local_decl` 发 `tll_slice_new`+`tll_slice_append`。辅助 `is_array_lit(e)`。
5. **定长数组 `[N]T` LLVM 支持**（新，原静默读 0）：`TD` 加 `alen`；`resolve_type_desc` 补 `array` 分支；`desc_to_c` array→`T*`；`ll_td`→`[N x T]`；`ll_isagg` array=true；`ll_zero` 把 `[` 开头也当 zeroinitializer；`ll_addr`/`emit_lle` index 走 `getelementptr [N x T], ptr, i64 0, i64 idx`；`ll_local_decl` 先 zeroinit 再逐元素 store。
- 新增 conformance：`pass/p11_array_literal.tc`、`pass/p12_int_to_str.tc`（25 例）。归档 `build/archive/tote_pre-M28-limits.exe`、`totter_pre-M28-limits.exe`。

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
2. `map[K]V`、函数类型（spec-only）；`type_info(T)` CTFE 内建未接
3. import_json 嵌套对象/数组字段
4. C 后端 `append(s, 字面量/调用)` 取址问题；缺 `println`；优化后端
