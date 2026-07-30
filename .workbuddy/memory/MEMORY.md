# t Language Compiler — Project Notes

## 概览
- **t**：数据驱动、ECS 取向、AI-Agent 友好的静态类型语言，扩展名 `.tc`；规范 `docs/spec.md`，参考手册 `docs/reference.md`（数据表/文法**唯一真相源**）。
- **主实现 = `src/tote.tc`**（单文件 ~12.5k 行自举编译器：lex/check/compile/emit-c/emit-ll/build/run/test/ast/type-info）。
- **生成器 = `src/totter.tc`**（t 编写）：读 `build/ebnf.json` 数据表，重写 `src/tote.tc` 的 `// >>> GEN:xxx >>>` … `// <<< GEN:xxx <<<` 区间，输出 `gen/tote.tc`。
- `tc0/`（TypeScript 参考实现）已冻结；种子封存 `seed/tc0/`（信任根，永不删除）。

## 构建 & 验证
- 编译：`build/tote/tote.exe build <f.tc> --clang "C:/Program Files/LLVM/bin/clang.exe" --output build/<dir>/<name>`（输出目录须先 mkdir）。
  - 注：`_build_one.mjs` 的 /Fe 硬编码 tote.exe，故 C 路径产物常在 `build/<dir>/tote.exe`；canonical totter 落在 `build/totter/tote.exe`（同时保留一份 `totter.exe`）。
- `emit-ll <f.tc> --output p` 实际写 `p.ll`（会再补一次后缀）；stdout 只有短提示。
- **标准流水线**：canonical tote 编译 `src/totter.tc` → totter；totter 重生成 `gen/tote.tc`；`cp gen/tote.tc src/tote.tc` 提升定点；canonical tote 编译 `gen/tote.tc` → 新 tote。
- **验证四件套**：
  1. 定点：`md5sum src/tote.tc gen/tote.tc` 相等且重跑幂等
  2. `node tools/difftest.mjs [--ref A --cand B]` → **27/27**
  3. `node tools/conformance.mjs` → **17/17**（`--ref` 走 tc0 交叉极慢，慎用）
  4. LLVM IR 逐字节 diff（最灵敏）+ `run --example hello/fib` smoke
- 两阶段自举：tote-b→tote-c，IR 逐字节相同 + difftest 27/27（exe md5 不同系链接时间戳，非功能差异）。
- `tools/bootstrap.mjs` 目前在 gen1 失败 = tc0 发射器基线 bug，与近期改动无关；等价性以 difftest 为准。
- 提升 canonical 前先归档：`build/archive/<name>_pre-<里程碑>.exe`。

## 环境 / 实现约束
- MSVC 路径需 `/utf-8` + 生成 C 带 BOM（`.tc` 源不能带 BOM）；LLVM 路径避开 Win64 聚合 ABI（`runtime/t_shim_ll.c` 的 `tll_*` 指针桥）。runtime arena 512MB。
- 确定性：line/col = UTF-8 字节计数；stdout 二进制模式；`sb_to_str` 复制语义。
- t 语法坑：`Name :: struct { f: T; }`；**无 else-if 链**；`append(s, call())` 取临时量地址(C2102)须先存局部；无 slice 重赋值；无 `str_find`（自实现）；拼接优先 StringBuilder（宽 cat 可用性不定）。
- tote C 后端 `sys_run` 必须直通输出 `sys_run(...)`，否则不动点破坏。
- 诊断怪癖：`T_TYPE_UNKNOWN` 从未发出（实报 `T_TYPE_MISMATCH`）；命名违规是 warning（exit 0）。
- **既有限制（非回归）**：`run <任意路径.tc>` lld-link `subsystem must be defined`；LLVM 后端 `int_to_str` UNSUPPORTED；数组字面量 `[N]u8` / `[]` 推 `[0]<unknown>`。

## Variant (G10, M12)
关键字 `variant` → `parse_variant_decl`（VariantDecl + VC：`ia`=case 下标，`na`=载荷类型或 -1）；检查器 `register_variant_helpers` 注册合成符号 `Name_from_/is_/as_Case`（不入 decl_list）；发射 tag+union struct + 每 case 三个 `static inline` 自由函数。取舍：自由函数而非模式匹配；不支持 `@derive`。

## 数据驱动自生成主线（M17 → M26）✅
**目标**：用数据表生成 tote 自身的代码（不是给 t 语言加数据驱动特性）。
**链路**：`docs/reference.md`（数据表 + `// @rule` EBNF + `// @node`/`@slot`/`@scalar`/`@sfn` 表）→ `tools/gen_ebnf.mjs` → `build/ebnf.json` → `src/totter.tc` 各 emitter → `src/tote.tc` 的 GEN 区间。

### 当前 24 个 GEN 区间
`kw_lookup`(关键字) / `builtins`(15 组) / `derives`(9 trait) / `diagnostics`(10 码) / `annotations`(34 注解) / `xid` / `parser_dispatch` / `parser_rules`(30 文法规则) / `ast`(65 节点种类) / `scalar_pred` / `scalar_bits` / `scalar_ctype` / `scalar_llmap` / `type_infer1` / `type_infer2` / `type_slice` / `type_resolve` / `type_declreg` / `td_scalar` / `td_rslice` / `td_rnamed` / `td_expr1` / `td_expr2` / `td_calls`

### parser 数据驱动（M19，10 种 fold 模式）
- 通用：`bin` / `pre` / `post` / `prim` / `disp`（守卫式分发，骨架不消费引导 token）
- 语句体专用（逐字节复刻手写 C）：`whilex` / `returnx` / `ifx`（else 嵌 if 需包单元素 list）/ `forx`（peek `KwIn` 分流）/ `swx`（default_head 缺省 -2）
- 保留胶水（GEN 区外、设计使然）：`parse_local_var`（名校验副作用 + `nti=pos-1`）、`parse_expr_or_assign_stmt`、`mk_un`、postfix/primary helper 群、`str_or`/`flag_offset_of`。

### AST 层（M20–M23）
- §2.9 `NodeTable ::` 65 条 `// @node <name> [slot=type…]`（60 有槽/5 无槽）；`SlotTable ::` 20 行 `// @slot <名> <记法> <t类型> <初值>`（17 数据槽 + ln/cl/tv），行序 = Node 字段序，驱动 Node 结构、`node_new` 初值、`slot_ty`/`slot_default`。
- `Node` 固定通用槽：`sa/sb/sc`(+`has_s*`)、`na..nd`(-1=null)、`ia/ib`、`la/lb/lc`(-1 空 / -2 null)、`ba/bb`、`ln/cl/tv`。
- `GEN:ast` 含 Node 结构 + 池 + `node_new`/`node_at` + 节点注册表 + **65 个 `mk_<kind>` 构造器**（签名：槽参数按字段序 + `ti`，`ti<0` 跳过 `node_at`；槽取所有调用点并集）。
- 迁移成果：`node_new` 全项目仅剩 2 处非构造器调用（手写 `P`、`mk=inline` 的 `F`）；`mk_` 调用点 96 处。
- **⚠️ 节点索引漂移铁律**：槽表达式内含子节点分配时改写成 `mk_X(...)` 会让实参先求值 → 子节点索引挪到父节点之前 → AST 变化。命中处用 `@rule … mk=inline` 关闭发射。
- **⚠️ construct 块求值顺序被重排为 Node 字段序**（非书写顺序），块内副作用表达式须自查。

### 标量类型表（M24 ScalarTable）
- §2.10 两张表：`ScalarTable` 13 行 `// @scalar <name> <class> <bw> <c> <ll> <llbits>`；`ScalarFnTable` 7 行 `// @sfn <fn> <ret> <mode> <filter> <col> <fallback> <region>`。
- 7 个手写 if 链函数全部由表生成：`is_scalar_name`/`is_int_name`/`is_float_name`（mode=pred，按首字母分组）、`get_bw`（group2）、`scalar_to_c`（each）、`scalar_to_ll`/`ll_bits`（group1，按取值分组）。
- **兜底规则**：取值 == fallback 的条目不发射分支（`scalar_to_ll` 的 i64、`get_bw` 的 -1），这是逐字节复现手写代码的关键。
- 方法论：先写 Python 原型逐区间比对手写原文（IDENTICAL）再移植 totter，一次成功。

### 类型检查器规则表（M25 TypeRuleTable / DeclRegTable）
- §2.11 两张表：`TypeRuleTable` 14 行 `// @trule <region> <fn> <kind> <mode> <a1> <a2> <a3>`；`DeclRegTable` 10 行 `// @dreg <kind> <symkind> <mode> <a1> <a2> <post>`。
- trule 模式：`mk` / `scalar` / `named` / `und` / `elem`(递归函数由 fn 列定) / `rec`(透传或改派)。参数以 `n.` 开头视为代码，否则为字符串字面量。
- dreg 模式：`named` / `und` / `res` / `optres`(经临时变量 cti 退化)；`post` 列挂钩子（VariantDecl → register_variant_helpers）。生成 `register_decl` **整个函数**。
- 区间：`type_infer1`(float/string/bool/null)、`type_infer2`(struct_lit/cast/paren/comptime)、`type_slice`、`type_resolve`(variant/flag/flag_set/pointer/optional)、`type_declreg`。
- **划界原则**：只吃「查表得类型」的规律分支；带控制流与诊断副作用的算法分支（int 字面量选宽、ident 查作用域、binary 同型约束+隐式转换诊断、member/index/array_lit/map_lit 结构遍历）留手写。`infer_expr` 整体表驱会打乱 IR 顺序，不可做。
### emitter 类型描述符表（M26 TdRuleTable）
- §2.12 一张表：`TdRuleTable` 22 行 `// @tdrule <region> <indent> <key> <match> <style> <mode> <a1> <a2>`。
- 覆盖 6 区间：`td_scalar`(resolve scalar 内层 n.sa 链+def 兜底)、`td_rslice`/`td_rnamed`(kind 块)、`td_expr1`(string/int/float/bool 单行)、`td_expr2`(paren/cast rec 块)、`td_calls`(10 条内建函数名分派，缩进 12)。
- 列设计：`indent`(4/8/12 → 空格串，表外发 `?TDR_IND?`)、`key`(守卫左值代码 n.kind/n.sa/cn)、`style`(**one 单行 if / blk 三行块 / def 裸 return**)、mode `mk`/`named`/`elem`/`rec`。
- 参数判码规则升级：以 `n.` 开头**或含 `(`** 视为代码（elem 的 a2 可以是 `td_mk("string")` 这类无空格调用）。
- 划界：`resolve_type_desc` 的 map 分支（多语句算法）与 `expr_type_desc` 的 ident/index/call 尾部/binary/member 留手写。

### 踩坑铁律
- **GEN 标记名不得是其他标记的前缀**（`GEN:parser` 曾误命中 `GEN:parser_dispatch`）。
- 表驱 `kw_lookup` 必须在任何 `tokenize()` **之前** init；统一在 `main()` 入口调一次。
- `gen_ebnf.mjs` 中 `cur.raw` 只存 code（注释被剥离）；纯注释表（`@node`/`@slot`/`@scalar`/`@sfn`）须读 `cur.rawFull`。
- totter JSON 导航：成员节点 `.child` 指向**值节点**；数组元素 = `jnodes[值节点].child` 起 `.sib` 链。
- 表外键查询要发射失败可见的非法 token（`?SLOT_TY?` / `?SCALAR_COL?`），不要静默兜底。
- 新增 DSL 后等价性用 **IR 逐字节 diff** 兜底（对 `gen/tote.tc` 自身 emit-ll，2.4MB IR，索引漂移必现）；exe md5 差异不代表功能差异。
- **负向测试禁用 `git checkout` 恢复**含未提交编辑的文件（M23 踩过）；用副本备份恢复。
- 若改动只新增 GEN 标记行，`gen/tote.tc` md5 变化属预期，此时以 difftest + IR 逐字节为金标准。

## 技术债 / 后续候选
1. @derive 派生生成器表（9 trait 生成体仍手写，**用户 2026-07-30 明示暂缓**）
2. §7.2 CSV/JSON CTFE 编译期导入
3. `@soa` 布局变换、脱离 arena 的通用内存管理
4. 修既有限制：lld-link subsystem、LLVM `int_to_str`、数组字面量类型推导
5. 优化后端
