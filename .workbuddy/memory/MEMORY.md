# t Language Compiler — Project Notes

## 概览
- **t**：数据驱动、ECS 取向、AI-Agent 友好的静态类型语言，扩展名 `.tc`；规范 `docs/spec.md`，参考手册 `docs/reference.md`（数据表/文法唯一真相源）。
- **主实现 = `src/tote.tc`**（单文件 ~12.5k 行，自举编译器：lex/check/compile/emit-c/emit-ll/build/run/test/ast/type-info）。
- **生成器 = `src/totter.tc`**（t 编写）：读 `build/ebnf.json` 数据表，重写 `src/tote.tc` 的 `// >>> GEN:xxx >>>` … `// <<< GEN:xxx <<<` 区间，输出 `gen/tote.tc`。
- `tc0/`（TypeScript 参考实现）已冻结；种子封存 `seed/tc0/`（信任根，永不删除）。

## 构建 & 验证
- 编译：`build/tote/tote.exe build <f.tc> --clang "C:/Program Files/LLVM/bin/clang.exe" --output build/<dir>/<name>`
  （注：`_build_one.mjs` 的 /Fe 硬编码 tote.exe，故产物常在 `build/<dir>/tote.exe`）
- `emit-ll <f.tc>` 输出 `<name>.ll` **写在源文件旁**（stdout 只有短提示）。
- **标准流水线**：canonical tote 编译 `src/totter.tc` → totter；totter 重生成 `gen/tote.tc`；`cp gen/tote.tc src/tote.tc` 提升定点；canonical tote 编译 `gen/tote.tc` → 新 tote。
- **验证四件套**：
  1. 定点 `md5sum src/tote.tc gen/tote.tc` 相等且重跑幂等
  2. `node tools/difftest.mjs --ref build/tote/tote.exe --cand <new>`（当前 **27/27**）
  3. `node tools/conformance.mjs --compiler <new>`（**17/17**；加 `--ref` 走 tc0 交叉极慢，慎用）
  4. LLVM IR 逐字节：`p06_control_flow.ll` 两版 diff 为空 + `run --example hello/fib` smoke
- 两阶段自举：tote-b→tote-c difftest 27/27（二进制 md5 不同系内嵌路径/时间戳，非功能差异）。
- `tools/bootstrap.mjs` 目前在 gen1 失败 = tc0 发射器基线 bug，与近期改动无关；等价性以 difftest 为准。
- 提升 canonical 前先归档：`build/archive/<name>_pre-<里程碑>.exe`。

## 环境 / 实现约束
- MSVC 路径需 `/utf-8` + 生成 C 带 BOM（`.tc` 源不能带 BOM）；LLVM 路径避开 Win64 聚合 ABI（`runtime/t_shim_ll.c` 的 `tll_*` 指针桥）。
- runtime arena 已扩至 **512MB**（`runtime/t_runtime.c`）。
- 确定性：line/col = UTF-8 字节计数；stdout 二进制模式；`sb_to_str` 复制语义。
- t 语法坑：`Name :: struct { f: T; }`；**无 else-if 链**；`append(s, call())` 会取临时量地址(C2102)，须先存局部变量；无 slice 重赋值（不能 `= []` 重置）；无 `str_find`（自实现）。
- tc1/tote C 后端 `sys_run` 必须直通输出 `sys_run(...)`，否则不动点破坏。
- 诊断怪癖：`T_TYPE_UNKNOWN` 从未发出（实报 `T_TYPE_MISMATCH`）；命名违规是 warning（exit 0）。
- **既有限制（非回归）**：`run <任意路径.tc>` lld-link `subsystem must be defined`；LLVM 后端 `int_to_str` UNSUPPORTED；数组字面量 `[N]u8` / 空数组 `[]` 推 `[0]<unknown>` 不能赋 `[]i64`。

## Variant (G10, M12)
- 关键字 `variant`；`parse_variant_decl` → VariantDecl + VC（`VC.ia`=case 下标，`VC.na`=载荷类型或 -1 单元 case）。
- 检查器 `register_variant_helpers` 注册合成符号（不入 decl_list）：`Name_from_Case` / `Name_is_Case` / `Name_as_Case`。
- 发射 `typedef struct { uint32_t _tag; union {...} _u; }` + 每 case 三个 `static inline` 自由函数。
- 取舍：自由函数而非方法/模式匹配；Variant 上暂不支持 `@derive`。

## 数据驱动自生成主线（M17 → M20）✅
**目标**：用数据表生成 tote 自身的代码，而非给 t 语言加数据驱动特性。

### 链路
`docs/reference.md`（数据表 + `// @rule` EBNF + `// @node` 表）→ `tools/gen_ebnf.mjs` → `build/ebnf.json` → `src/totter.tc` 各 emitter → `src/tote.tc` 的 GEN 区间。

### 当前 9 个 GEN 区间
`kw_lookup`(33 关键字) / `builtins`(15 组) / `derives`(9 trait) / `diagnostics`(10 码) / `annotations`(34 注解) / `xid` / `parser_dispatch` / `parser_rules`(30 文法规则) / `ast`(65 节点种类)

### parser 数据驱动（M19，10 种 fold 模式）
- 通用：`bin`(左折叠二元塔) / `pre`(右结合前缀一元) / `post`(左折叠后缀+胶水下沉) / `prim`(终端 dispatch) / `disp`(守卫式分发，骨架不消费引导 token)
- 语句体专用（逐字节复刻手写 C，保 `node_at` 与列表兜底零差异）：`whilex` / `returnx` / `ifx`(else 嵌套 if 需包单元素 list) / `forx`(peek `KwIn` 分流) / `swx`(case/default 循环聚合，default_head 缺省 -2)
- **成果**：结构型声明 + 表达式金字塔（or→…→primary）+ statement 顶层分发 + 全部语句体内部结构，全部由文法生成。
- 保留胶水（GEN 区外、设计使然）：`parse_local_var`（名校验副作用 + `nti=pos-1` 定位，被 forx 调用）、`parse_expr_or_assign_stmt`、`mk_un`、postfix/primary 的 helper 群、`str_or`/`flag_offset_of` 等注解提取。

### AST 层（M20 Phase B 地基 + M21 Phase A 构造器 ✅）
- `reference.md` §2.9 `NodeTable ::` 块内 65 条 `// @node <name> [slot=type ...]`，槽标注已全量补齐（60 有槽 / 5 无槽：break、continue、flag_set、null、variant）。槽类型映射：sa/sb/sc→str、has_*→has、ia/ib→int、ba/bb→bool、na..nd→node、la..lc→list。
- `Node` 是**固定通用槽结构**：`sa/sb/sc` 字符串槽（`has_s*` 表 null）、`na/nb/nc/nd` 子节点索引（-1=null）、`ia/ib` 整型载荷、`la/lb/lc` 列表头（-1 空、-2 null）、`ba/bb` 布尔、`ln/cl/tv` 位置锚点。
- `GEN:ast` 区间含：`Node` 结构 + `nodes`/`Child`/`kids` 池 + `node_new` + `node_at` + 节点注册表（`node_kind_names`/`init_node_kinds`/`is_node_kind`）+ **65 个 `mk_<kind>` 构造器**；`main` 在 `init_keywords()` 后调 `init_node_kinds()`（区外胶水）。
- 构造器约定：`mk_<kind>(槽参数按 Node 字段序…, ti: i64) -> i64`；`ti < 0` 跳过 `node_at`；槽取该 kind 所有调用点的**并集**，未设槽填 `node_new` 默认值 → 零行为差异。totter 侧靠 `nd_slots` 表 + `slot_count/slot_at/slot_ty` 发射。
- 迁移成果：手写 `node_new` **61 处 → 1 处**（分布：GEN:ast 65、GEN:parser_rules 19、手写仅 `P` 一处）。手写 `mk_scalar` 已删（并入生成器），`mk_bin`/`mk_un` 降级为转调 `mk_binary`/`mk_unary` 的薄包装。
- **⚠️ 节点索引漂移铁律**：槽赋值表达式内若含子节点分配调用、且该调用在父 `node_new` 之后，改写 `mk_X(...)` 会提前分配子节点 → 索引漂移 → AST 变化。仅 `node_new("P")`（与 `named` 交错分配后回填 `pn2.na`）命中，永久保留手写。

### 踩坑铁律
- **GEN 标记名不得是其他标记的前缀**（`GEN:parser` 曾误命中 `GEN:parser_dispatch`）。
- 表驱 `kw_lookup` 必须在任何 `tokenize()` **之前** init；统一在 `main()` 入口调一次。
- `gen_ebnf.mjs` 收集规则时 `cur.raw` 只存 code（注释被 `splitCodeComment` 剥掉）；纯注释表（如 `@node`）须读 `cur.rawFull`。
- totter JSON 导航：成员节点 `.child` 指向**值节点**；数组元素 = `jnodes[值节点].child` 起 `.sib` 链。
- OPKIND 表须与 lexer 实际 token 对齐（`~`→`BitNot` 而非 `Tilde`）。
- 新增 DSL 能力后，等价性用 **AST/LLVM IR 逐字节 diff** 兜底，比 difftest 更早暴露节点位置漂移。tote 无 `ast` 子命令，最灵敏的兜底是「对 `gen/tote.tc` 自身 emit-ll 逐字节 diff」（2.4MB IR，任何索引漂移必现）。
- exe 的 md5 差异属 clang 链接器时间戳/路径，**不代表功能差异**；不动点判定一律以 IR 逐字节为准。

## 技术债 / 后续候选
1. **GEN:ast Phase C**：把 `mk_*` 调用点纳入 `parser_rules` 文法生成；或用 §2.9 槽定义反向驱动 `Node` 结构体字段生成
2. §7.2 CSV/JSON CTFE 编译期导入
3. `@soa` 布局变换、脱离 arena 的通用内存管理
4. 修既有限制：lld-link subsystem、LLVM `int_to_str`、数组字面量类型推导
5. 优化后端
