---
name: t-add-scalar-type
description: 在 t 语言自托管编译器（src/*.tc，C + LLVM 双后端）中新增一个标量/内建类型（如 bytes/BytesBuilder 镜像 string/StringBuilder，或 rune）。覆盖 parse→sema→codegen 全链路、diagnostic 码、IR 快照与 gate L2 门禁。踩坑点：resolve_ti 顺序、ti_equal 种类隔离、diag 机器码、shadow 变量撞名。
agent_created: true
---

# 给自托管 t 编译器新增标量/内建类型

适用：在 `src/*.tc` 里加一个新标量类型或一类内建（如 `bytes`/`BytesBuilder`、`rune`）。
编译器是**自托管**的：旧 `out/dbg/tc.exe` 把 `src/tc.tc` 编成 `g1`，再四代不动点得到 `g4`。
**铁律**：`src/tc.tc` 自身不得出现新**语法**（旧编译器要能编新源码）；新**类型名/内建**是允许的。

## 0. 设计决策（先定再写）
- 类型身份由 `TI.kind` 区分；内存布局由 `TI.cat` 区分。同布局复用 = 同 `cat` + 不同 `kind`。
- 例：`bytes` = `kind="Bytes", cat="bytes"`，复用 `%TStr`/`TStr`( `{ptr,i64}` 16B )布局；
  `BytesBuilder` = 直接 `kind="StringBuilder", cat="..."` 复用 `TSb*`。
- **不要**复用 `string` 的 `kind`（会让 `ti_equal` 把 bytes 与 string 视为同一类型）。
- 优先零新增运行时代码：内建直接映射到已有 `runtime/t_runtime.c` 的 `t_*`（如 `t_str_slice`/`t_sb_append_char`）
  与 `runtime/t_shim_ll.c` 的 `@tll_*`（同布局）。

## 1. 落地清单（逐文件）
**parse.tc — `is_scalar_name` ~(L182)**：把新类型名加进去，老编译器才能把它当类型名解析。
> ⚠ 见 §3.1：若你的类型要映射成「独立 kind」（而非笼统 Scalar），这里加了会和反序列化顺序冲突，按 §3.1 处理。

**sema.tc**：
- `resolve_ti` 标量分支：新增 `if (n.sa=="<name>") { return ti_mk("<Kind>"); }`，**放在 `is_scalar_name` 检查之前**（见 §3.1）。
- `mk_type_node_from_ti`：`<Kind>` → `mk_scalar("<name>", -1)`。
- `ti_equal`：在 `Void||String||StringBuilder` 常真分支**之前**加 `if (a.kind=="<Kind>") { return a.name==b.name; }`（name 恒空 → 恒等，但避免被吞进常真分支）。
- `mb_scalar_size`：`<name>` → 字节数（16 对 view，8 对 builder 指针）。
- `builtin_ret`：每个内建返回类型（`bytes_len`→`u64`、`bytes_at`→`u8`、`bsb_new`→`StringBuilder`、`bsb_to_bytes`→`Bytes`…）。
- `resolve_type_desc` / `ti_from_td` / `td_readable` / `desc_to_c` / `ti_to_td` / `scalar_to_c` / `emit_ctype`：cat/name ↔ type-desc 双向打通。
- 区间索引 `lower_range_index`：`k != "String" && k != "Slice"` 加 `&& k != "<Kind>"`；`lenf`/`fname`/`return` 各加一条 `<Kind>` 分支。
- 单元素索引 `infer_expr` 的 `index` 分支：加 `if (obk2=="<Kind>") { return ti_scalar("u8"); }`。

**codegen_c.tc**：
- `emit_ctype` / `scalar_to_c` / `desc_to_c`：`cat=="<name>"` → 对应 C 类型（`TStr`/`TSb*`）。
- 调用发射：内建名 → `t_*`（如 `bytes_slice`→`t_str_slice(`、`bsb_append_u8`→`t_sb_append_char(`、`bsb_to_bytes`→`t_sb_to_str(`）。**参数个数必须和 `sb_catN` 实参数一致**（见 §3.2）。
- `index` 发射：加 `if (ot.cat=="<name>") { return "t_str_byte_at("...; }`（复用 TStr 版）。
- `td_calls` 返回表、`mb_scalar_size` 同步。

**codegen_ll.tc**：
- `ll_td` / `ll_isagg` / `ll_size_bytes`：`cat=="<name>"` → `%TStr`/16。
- 调用发射：内建名 → `@tll_*`（注意 shim 走**指针**：`TStr*`/`TSb*`；`out` 排末位）。
- `bsb_append_u8` 之类必须和 `sb_append_char` 一样用满 `sb_cat6` 的 6 个实参（函数名作独立实参），**不要**把函数名内联进字面量（见 §3.2）。
- 索引发射：`ot.cat=="<name>"` → `@tll_str_at` + `trunc i64 to i8`。

**runtime/**：除非布局不同，否则**不改** `t_runtime.c` / `t_shim_ll.c`，只在现有 `t_*`/`@tll_*` 上复用。

## 2. 验证（双后端都必须过）
1. 旧 `tc.exe` 编新 `src/tc.tc` → `g1`：**0 错误**。
2. 写 `tests/conformance/pass/pXX_<name>_basic.tc`（`// EXPECT: pass`），覆盖构造/索引/切片/内建。
3. LLVM 后端：`./out/dbg/g1.exe build <test> --output out/dbg/tt && ./out/dbg/tt.exe` → `RUN_EXIT=0`。
4. C 后端：`g1.exe compile <test> --emit-c --output out/dbg/tc_ && clang -O0 -o out/dbg/tc_c.exe out/dbg/tc_/*.c runtime/t_runtime.c -I runtime -I out/dbg/tc_ -Wl,-subsystem:console && ./out/dbg/tc_c.exe` → `0`。
5. `node tools/gate.mjs L2 --keep-going` → 15/15 PASS（含 4 代不动点、C 自举、difftest、conformance）。

## 3. 必踩的坑
### 3.1 resolve_ti 的 is_scalar_name 短路
`resolve_ti` 标量分支第一行是 `if (is_scalar_name(n.sa)) { return ti_scalar(n.sa); }`——
若你把新名加进了 `is_scalar_name`，它会先被编成笼统 `Scalar kind`，你后面写的
`if (n.sa=="<name>") return ti_mk("<Kind>")` **永远不会执行**（死代码）。
**修法**：要么把新名从 `is_scalar_name` 移除（走 Named 路径需另加 Named 映射），要么把专用分支**移到 `is_scalar_name` 检查之前**。本项目选后者（`string`/`StringBuilder` 本就靠专用分支，不是 is_scalar_name）。

### 3.2 sb_catN 实参数必须精确
`codegen_ll.tc` 的 `sb_cat6(...)` 必须恰好 6 个实参。把函数名内联进字符串字面量（如
`"  call void @tll_sb_append_char(ptr "`）会少 2 个实参 → `CALL_ARITY` 报错（报在拼接后的模块行号上，难定位）。
严格照抄 `sb_append_char` 原样：`sb_cat6("  call void ", fn, "(ptr ", bp, ", i64 ", sb_cat2(cv, ")"));`。

### 3.3 diagnostic 用**机器码**不是内部名
`diag_new(code, ...)` 用 `diag_defs.json` 里的 `code`（如 `T-LEX-E007`），**不是**内部 `name`（如 `BAD_CHAR_LITERAL`），
也**不是**你以为的另一个码（`T-LEX-E008` 是 `UNTERMINATED_LONG_STRING`）。
查 `tools/diag_defs.json` 拿对的 `code`；否则 `legacy_code` 会串到别的诊断。
改诊断码只动 `tools/diag_defs.json` → `gen_diag*.mjs` 重新生成 `base.tc` 的 GEN:diagnostics 区（手改必被覆盖）。

### 3.4 shadow_check 撞名
`shadow_check.mjs` 扫「同名不同型局部变量」。函数里已有 `ci/u64` 之类计数器时，新加的局部**必须改名**（如 `vci`），
否则 `静态检查 (catn + shadow + dag)` 这步 gate 失败，报「变量 X 有 2 种类型」。

### 3.5 前端改动后必须重录 IR 基线 + 安装新 seed
改了语义/解析后：
`node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`
（gate「产物快照比对」会报差异并提示这条）。
gate 全绿后把不动点编译器装成新 seed：
`cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`
（⚠ 拷贝前 `tasklist | grep tc.exe` 确认无残留进程持有文件锁，否则 `Device or resource busy`）。

## 4. 速查：一次成功的全链路改动（参考 bytes/BytesBuilder）
parse.tc(is_scalar_name) → sema.tc(resolve_ti 前置分支 + ti_equal + mb_scalar_size + builtin_ret + type_desc 双向 + range/single index) → codegen_c.tc(ctype + 调用发射 + index 发射) → codegen_ll.tc(ll_td + 调用发射 sb_cat6 满参 + index 发射)。零 runtime 改动。
