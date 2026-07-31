# t Language Compiler — Project Notes

## 概览
- **t**：数据驱动、ECS 取向、静态类型语言，扩展名 `.tc`；规范 `docs/spec.md`，参考手册 `docs/reference.md`。
- **主实现 `src/tote.tc`**（自举编译器：lex/check/compile/emit-c/emit-ll，默认后端 **LLVM**）。
- **生成器 `src/totter.tc`**（t 编写）：读 `build/ebnf.json` → 重写 `src/tote.tc` 的 `// >>> GEN:xxx >>> … <<< GEN:xxx <<<` 区间 → `gen/tote.tc`。
- `tc0/`（TS 参考实现）已冻结；种子封存 `seed/tc0/`。

## 构建 & 标准流水线
1. `node tools/gen_ebnf.mjs` → `build/ebnf.json`
2. canonical tote 编译 `src/totter.tc` → `build/totter/totter.exe`
3. `./build/totter/totter.exe` → `gen/tote.tc`；`cp gen/tote.tc src/tote.tc`（定点提升）
4. canonical tote 编译 `src/tote.tc` → 新 tote
- 编译：`build/tote/tote.exe build <f.tc> --clang "C:/Program Files/LLVM/bin/clang.exe" --output build/<dir>/<name>`
- **验证六步**：① 定点 `md5sum src/tote.tc gen/tote.tc` 相等 ② `node tools/difftest.mjs --ref A --cand B` 27/27 ③ `node tools/conformance.mjs --compiler <exe>` 30/30 ④ 两阶段自举 IR 逐字节相同（tote-b==tote-c）⑤ `node tools/shadow_check.mjs` + `catn_check.mjs` ⑥ `grep -o "UNSUPPORTED call" x.ll` 基线 0 条（实际剩 2 条：空名 + `call target`）。
- 新增内建只用于被编译程序→一阶段自举；要在 tote 自身运行期生效→两阶段。新增能力让 b→c 阶段 IR 多出 declare 不算不动点破坏，判据是 c→d 逐字节相同。
- 提升 canonical 前归档 `build/archive/<name>_pre-<里程碑>.exe`。
- **测试体系不验证运行时**：conformance/difftest 只跑 check/词法；运行时语义须写 `examples/*.tc` 实跑 + `.expected.txt`，并交叉验证 C/LLVM 逐字节一致。

## 实现铁律（最高频踩坑）
- LLVM 避 Win64 聚合 ABI（`t_shim_ll.c` 的 `tll_*` 指针桥）；arena 512MB；line/col 用 UTF-8 字节计数；stdout 二进制模式。
- **catN 实参个数必须严格等于 N**（`catn_check.mjs` 守卫）。
- **同函数内同名局部变量不得有不同类型**（`shadow_check.mjs` 守卫；症状 `'%v.x' defined with type 'ptr' but expected 'i64'`）。
- **`a = b` 解析为 `"assign"` 节点（L4896），不是 `"assignment"`（死代码）** → `m[k]=v` 发射点必须在 `emit_expr`/`emit_lle` 的 `"assign"` 分支，误改 `"assignment"` 分支无效（M32 踩坑）。
- checker 跨函数引用宽松：`ll_addr`/`ll_call` 内局部不会报错被当 0 → 用 `ll_widen_idx(emit_lle(n.nb), n.nb)` 勿硬编码。
- slice 值传递；返回表用全局 slice + base 偏移。`string +` LLVM 未实现（静默 `add i64`），一律 `cat2..cat6`。
- C 后端 `append(s, 字面量/调用)` 取临时量地址失败→先存局部。`infer_expr` 形参 `e` 才是节点索引，`n` 是结构，位置信息用 `e`（M34 误用 `n_file(n)` 发错 IR）。
- 字符串返回的内建走 out 指针（`void tll_*(TStr* out, ...)`），标量/指针返回直接（`i64 tll_*(...)`）。
- **`TypeInfo`/`FieldInfo` 在 C 后端必须按指针**（`emit_ctype` 对 `named` `TypeInfo`→`TTypeInfo*`、`FieldInfo`→`TFieldInfo*`），与 LLVM 后端的 `ptr` 一致；否则 `t_ti_*`/`t_fi_*` 收参类型不符（值 vs 指针）链接失败。`__ti_T` 常量在 C 后端由 `emit_type_info_c` 合成到 `ti_lines`（位于 `t_entry_main` 之后），需在 `.h` 放 `static` 前向声明才能先用后定义。

## 里程碑速查
- **M28** 限制修复：lld-link console / int_to_str 内建 / 定长数组 `[N]T`。
- **M29** map[K]V 端到端（内建 + runtime + 双后端）。
- **M30** map 字面量 + `for(k in m)` 插入序迭代键。
- **M31** map 收尾：参数/返回值、for(k,v in m)、嵌套 map、字面量非局部位置（引入 `glines`/`t__ginit`）。
- **M32** `m[k]=v` 写（compile 为 `t_map_put`；陷阱见上 "assign" 节点）。
- **M33** cat2..cat6 接入 runtime（返回 string；C 后端漏 `t_` 前缀已修）。
- **M34** `print(scalar)` LLVM 崩溃修复（实参加 String 约束）。
- **M35** `println` C 后端 `undefined reference` 修复（补 call 分支 + `t_println`/`tll_println`）。
- **M36** `type_info(T)` accessor 内建（struct-only，方案B）：返回 `TTypeInfo*`，10 个 accessor（`ti_name/size/kind/field_count/field`、`fi_name/offset/type_name/type_size/is_ptr`）；双后端编译期常量合成 `__ti_T`。✅

## 技术债 / 后续
1. @derive 表驱生成（9 trait 仍手写，用户 2026-07-30 暂缓）
2. 函数类型（spec-only）；type_info 仅 struct（enum/flag/variant/CTFE 进 TypeInfo 待补）
3. import_json 嵌套对象/数组字段
4. C 后端 append 取址；优化后端
