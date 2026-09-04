# T 编译管线 —— 具体实现路线（2026-09-05 起手）

> 本文把 `docs/compiler/compiler-pipeline-design.md`（总管线）+ `tir-design.md`（TIR 桥）/ `hir-design.md` / `tmi-design.md` / `driver-query-design.md` 的**设计契约**落地为**可执行的实现路线**，并把每条路线映射到**当前代码的具体模块/函数**。
> 状态：路线已拍板；**本会话实现范围 = TIR Stage 0 + Stage 1（编译管线中央桥接层）**，其余阶段列为后续里程碑。

---

## 0. 当前代码事实（落地依据，非假设）

经对 `src/*` 实测勘探，现将"现状"钉死，后续所有路线以此为准：

| 项 | 事实 | 证据 |
|---|---|---|
| 驱动 | `tc.tc` `main()` 按 `cmd` 分发：`lex/check/compile/emit-ll/build/run/test/emit-dev`；前端统一为 `lex.tokenize → sema.init_anndefs → parse.parse_unit → sema.run_check → coma_fold.comptime_fold_pass → flag_pass → ann_pass` | `src/tc.tc:36-501` |
| 节点池 | `base.nodes: []Node`（`base.tc:69`）；`Node` 字段 `kind/sa/sb/sc/se/has_*/ia/ib/ba..be/bf/na..nd/memspace/la..lc/ln/cl/tv`（`base.tc:39-67`）；子节点链表 `base.kids[].val/.next` | `src/base.tc:39-67` |
| 顶层声明 | `lex.decl_list: []i64`（FuncDecl/StructDecl/EnumDecl/UnionDecl/VariantDecl/GlobalConstDecl/...），两个后端都遍历它 | `codegen_ll.emit_llunit` (`codegen_ll.tc:5277`) |
| 发射遍历 | `emit_llunit` → 对每个 `FuncDecl`（`func_is_generic==false` 且非 `kernel`）调 `emit_llfunc(di)` → `emit_llstmt(sid)`（按 `n.kind` 派发语句）+ `emit_lle(e)`（返回 LLVM 值串的表达式发射） | `codegen_ll.tc:4690/4228/1216` |
| 类型系统 | `sema.tds[td]`（`TD{cat,name,elem,alen,memspace,...}`，`sema.tc:18`）；`sema.resolve_type_desc(node_id)` 解析节点类型 → td 索引；`sema.llt_*(name)` 查具名类型 kind | `sema.tc:18/12046` |
| 类型→目标 | `ll_td(td)`（`codegen_ll.tc:316`）是现有 C/LLVM 共用的"TD→C/LLVM 类型"映射器；`ll_etd(e)`（`codegen_ll.tc:722`）是"表达式→TD"。这正是 TIR 要收敛的**单一真相源** | `codegen_ll.tc:316/722` |
| 设计锁 | `tir-design.md §15`：裁定已拍板但 `src/tir.tc` **未开工、未写入**；"后续进入实现需另行指令"——本会话即该指令 | `tir-design.md:552-553` |

**结论**：现有管线是 `parse → sema(+单态化+CTFE) → [codegen_c | codegen_ll]`，**缺 TIR 桥**。两份 `expr_type_desc`/`ll_etd` + `desc_to_c`/`ll_td` + 每构造 lowering 重复是双后端漂移根因（Bug1/Bug2）。TIR 把这一切收敛为单点。

---

## 1. 总路线（设计 §9 / §13 映射到代码）

```
阶段    设计名            代码动作（具体模块/函数）                        门禁
─────────────────────────────────────────────────────────────────────────────
A      HIR=ZIR+Driver/Query+.tmi  改 sema 消费 HIR；立 salsa 查询层；抽 .tmi   高（改前端）
B-F★   TIR（本会话）       新 src/tir.tc + emit-tir；薄后端 tir→c/tir→ll     中（新增，不动旧）
G      MIR 抽取            sema 后插 CFG+SSA 透传层                         中
H      MIR 中端优化        inline/const-prop/DCE/CSE                       中
I      后端抽象+Cranelift  BackendTraits + tir→cranelift                   高
J      链接全局优化        CGU/ThinLTO/PGO                                 高
K      WASM/SPIR-V         target 拓展                                    高
L      MLGO/确定性/缓存    PGO+ML 接口；内容寻址缓存                      中
```

★ = 本会话实现范围。

**为什么从 TIR（B-F）而不是 HIR（A）起手**：
- A 要改 `sema` 让它消费 HIR 而非 AST —— 触碰 551KB 的 `sema.tc`，回归面极大，且破坏"sema 不产出独立 typed IR"的现状。
- TIR（B-F）是**纯新增、加性**层：新模块挂在 `sema` 之后、`codegen_*` 之前，旧后端完全不动，`tc.tc` 现有命令零影响。符合"每 Stage 只引入一条风险线"的 staged-bootstrap 哲学。
- TIR 是 G1（后端无关）的核心收益载体，先把它立起来，后续 B/C/D 才有桥可落。

---

## 2. TIR Stage 0+1 具体实现（本会话）

### 2.1 模块与文件
- **新增 `src/tir.tc`**（DAG：`sema` 之后；被 `tc.tc` import）。提供：
  - `tir.lower_unit()`：在 `comptime_fold_pass()` 之后调用，遍历 `lex.decl_list` 生成 `TIRModule`。
  - 内存结构：`TIRModule` / `TIRType`（类型表 TT）/ `TIRInst`（线性指令）/ `TIRFunc`。
  - `tir.st_of_td(td)`：TD→ST 映射，**复用 `ll_td` 的同构逻辑**但输出 TIR 记号（§5 三处偏离：整数带符号性、指针带 pointee+aspace、聚合具名 `%Name`）。
  - `tir.to_text()`：序列化为 `.tir` 文本（§4 格式，规范真相源）。
- **改 `src/tc.tc`**：`main()` 增加 `emit-tir` 分支（复用 `emit-ll` 的 argv 解析：--output/--mode/--example/--clang/--runtime/--json/--diagnostics），在 `ann_pass()` 后调 `tir.lower_unit()` 并写 `out/<mode>/<mod>.tir`。

### 2.2 TIR 内存结构（贴合 `base.nodes` 范式，降低回归风险）
- `TIRInst`：`op: string; dst: string; args: []string; st: string; line: u64`（扁平池 + 索引，同 `base.nodes`）。
- `TIRFunc`：`name: string; params: []string(ST $slot); ret_st: string; body: []TIRInst; is_extern/is_kernel`。
- `TIRModule`：`mod: string; source: string; types: []TIRType; strings: []string; funcs: []TIRFunc; insts: []TIRInst`（全局指令流）。
- `TIRType`：`name: string; body: string`（TT 条目文本，如 `%Point = struct { f0: f64, f1: f64 }`）。

### 2.3 降级子集（Stage 1，设计 §13 Stage 1）
按设计，Stage 1 子集 = **标量、调用、if/for/while、struct 字段、返回**。本会话落地：

| 构造 | TIR 指令 | 来源节点 kind | 备注 |
|---|---|---|---|
| 函数签名 | `func @name(ST $p, ...) : ST` | `FuncDecl` | 参数 ST 经 `tir.st_of_td(resolve_type_desc(p.na))` |
| 局部变量 | `slot ST $name` + `store` | `var_decl`/`let` | 命名唯一化（同 fn 重名加 `__<sid>`） |
| 常量 | `const ST $d imm` / `const.str` / `const.ptr.null` | `int`/`float`/`string`/`bool`/`null`/`opt_none` | ST 由表达式类型定 |
| 标识符 | `load` 自 `$name`（标量）或 `$name`（聚合） | `ident` | 局部表查 slot；全局走 `@name` |
| 二元 | `add/sub/... ST $d $a $b` | `binary` | 由 op+ST 后缀定指令 |
| 一元 | `neg/not` | `unary` | |
| 调用 | `call ST $d @fname ($a...)` | `call` | 直接；间接（闭包）后续 Stage |
| 取址/解引用 | `addr_of`/`load`/`store` | `amp`/`deref` | |
| 字段读 | `addr_of`→`gep ST`→`load` | `member` | struct 字段 |
| 字段写 | `gep`→`store` | `assignment` 且 LHS=`member` | |
| struct 字面 | `struct_new %Name $d ($f0 $f1 ...)` | `struct_lit`/`struct` | 按字段顺序 |
| 控制流 | `block`/`br`/`br_cond`/`ret` | `if`/`for`/`while`/`block`/`return` | 显式基本块 |
| 不支持 | `comment "..."` 兜底 | `match`/其余 | emit-tir **永不崩溃**，子集外发注释 |

> **兜底铁律**：任何未支持的节点 kind 一律 emit `comment "unsupported: <kind>"` 并返回零 slot，保证 `emit-tir` 对任意 `.tc` 都能产出（部分）TIR，不中断/不静默错编。

### 2.4 命名空间（设计 §4 记号）
`%`=类型（TT 引用）、`$`=值 slot、`@`=符号（函数/全局）。ST 记号按 §5：`i8/i16/i32/i64/u8/.../f32/f64/ptr<ST>/ptr<ST,as=N>/arr<ST x N>/vec<ST x N>/fn<(ST,..)->ST>/%Name/void`。`bool` 存储=`i8`，比较结果=`i1`（Stage 1 标量比较先以 `i8` 承载条件，留 `i1` 接口）。

### 2.5 `tir.st_of_td` 映射表（设计 §7，对齐 `ll_td`）
| TD.cat | ST | 备注 |
|---|---|---|
| scalar (name) | `i8/u8/.../f32/f64` | 按 `t.name` 带符号性（`i32` vs `u32`）|
| string/bytes | `%TStr` | 预置 TT `%TStr = struct { f0: ptr<i8>, f1: i64 }` |
| slice | `%TSlice` | `{ptr<void>, i64, i64, i64}` |
| pointer(host) | `ptr<ST>` | ST=`st_of_td(elem)` |
| pointer(device, as>0) | `i64` | 沿用现状不透明句柄 |
| array | `arr<ST x N>` | |
| vector | `vec<ST x N>` | |
| map | `ptr<void>` | |
| optional | `ptr<ST>` | **Stage 1 严格 `opt.boxed`**（裁定 2）|
| enum/flag | 底层标量 ST | 名进 TT debug |
| struct/variant/union | `%Name` | TT 条目含字段 |
| sym | `u16`/`u32` | |
| func | `fn<...>` | |
| void | `void` | |
| named(alias) | 解算到底层 | 别名在 TIR 不存在 |

---

## 3. 验证与门禁（不破自举不动点）

1. **构建**：`cp out/dbg/tc.exe out/dbg/tc_bak.exe` → `out/dbg/tc.exe build src/tc.tc`（产生新 `tc.exe`）。失败即修 `src/tir.tc` 后重编；旧 `tc_bak.exe` 始终可回退。
2. **emit-tir 冒烟**：`out/dbg/tc.exe emit-tir examples/<scalar-heavy>.tc` → 检查 `out/dbg/<mod>.tir` 文本符合 §4 格式、可读、无崩溃。
3. **现有管线不破**：`tc check examples/...` 与 `tc build examples/...` 仍通过（其他命令零改动）。
4. **快照门禁（Stage 0 起）**：`node tools/tir_snapshot.mjs --update` 生成 `tests/tir_baseline.json`；复跑无 `--update` 应全绿（md5 稳定）。后续接 `gate L2` 的 `tir(g2)==tir(g3)==tir(g4)` 判据（设计 §12.3）。
5. **IR 漂移铁律沿用**：改前端后先 `cp out/dbg/g4.exe out/dbg/tc.exe`，再重录 TIR 基线，最后复跑 gate（见 `tir-design.md §12` / working-memory）。

---

## 4. 后续里程碑（本会话不做，列出以防范围漂移）

- **Stage 2/3**：`tir→c`（`emit_unit` 改消费 TIR）、`tir→ll`（`emit_llunit` 改消费 TIR）。删 `expr_type_desc`/`ll_etd`/`desc_to_c`/`ll_td`/per-construct lowering，TIR 成唯一真相源。
- **Stage 4b**：`.tirb` 二进制 + `tools/tir_roundtrip.mjs` round-trip 门禁。
- **Stage 5+**：`opt.tagged` 启用（独立 ABI 优化项，单独基线）。
- **A（HIR=ZIR+Driver/Query+.tmi）**：改 sema 消费 HIR；立 salsa 查询依赖图 + red-green 指纹 + work-stealing 调度 + 分片内容寻址缓存；抽 `.tmi` typed 接口制品。
- **G/H（MIR）**：sema 后插 CFG+SSA 透传层；中端优化 inline/const-prop/DCE/CSE。
- **I–L**：BackendTraits+Cranelift / CGU+ThinLTO+PGO / WASM+SPIR-V / MLGO+确定性缓存。

---

## 5. 风险与回滚

- **自举不动点**：TIR 不改 `tc.tc` 自身（无 kernel、无泛型使用），`g2==g3==g4` 不受影响。
- **回归面**：本会话仅新增模块 + 新命令，旧 `emit-ll/build/run` 路径零改动 → 回归面最小。若 `tir.tc` 编译失败，`tc_bak.exe` 回退。
- **子集外**：`match`/闭包/泛型实例等发 `comment` 兜底，不崩溃、不静默错编；全量 lowering 留待 Stage 2/3。
