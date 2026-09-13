# HIR —— t 语言「未定型 · 线性 · 可序列化」IR（ZIR 槽位）

> 状态：草案 v0.1（设计阶段，尚未落地）
> 作者：Buddy（编译管线设计专家视角）
> 关联：`docs/compiler/ir-taxonomy.md §6`（采纳选项 A 的裁定依据）、`docs/compiler/compiler-pipeline-design.md §4.2`、`docs/compiler/tir-design.md`
> 命名裁定：本设计里 **HIR = Zig 的 ZIR 槽位**——由 AstGen 产出、位于 Sema **之前**。沿用缩写 HIR，但语义已重新定义为「未定型 · 线性 · 可序列化」，**不是**传统的 High-level typed IR。完整对位见 `ir-taxonomy.md`。

---

## 1. 为什么必须存在这一层（增量编译承重墙）

可 **per-file 磁盘缓存** 的前提，是被缓存物**不依赖其他文件**。

- Zig 能把整个标准库的 ZIR 缓存到磁盘，恰恰因为 AstGen 阶段**未做任何跨文件的名字/类型解析**——缓存键只是本文件内容哈希。
- 一个**类型化**的 HIR 做不到这点：类型解析会拉进依赖文件信息，任何依赖变动都污染缓存条目，粒度必然退化为「按声明/按模块失效」。

所以这一层（未定型 · 线性 · 可序列化）是增量编译的**承重墙**。在采纳选项 A 之前，T 的管线把它省了（`compiler-pipeline-design.md §4.2` 的「类型化 HIR」与「per-file 缓存」存在内在张力，见 `ir-taxonomy.md §6`）。**选项 A 已裁定（2026-09-04）：把 HIR 改为 ZIR 槽位，张力解除。**

---

## 2. 在管线中的位置

```
CST ──AstGen──▶ HIR（未定型·线性·可序列化，= ZIR 槽位）
                  │
                  ▼
            sema + CTFE（解释 HIR：名字解析 / 类型检查 / 单态化 / comptime 折叠）
                  │
                  ▼
              mir（类型化 CFG+SSA，中端优化，= AIR 槽位）
                  │
                  ▼
              TIR（类型擦除的线性后端桥 IR，Zig 缺失的那一层）
                  │
                  ▼
            后端（LLVM / Cranelift / C / WASM / SPIR-V）
```

- **HIR 是唯一可按源文件内容哈希缓存到磁盘的层**。mir/TIR 都携带跨文件信息（类型、单态实例），不可 per-file 缓存。
- 对位：HIR ≈ Zig ZIR（pre-sema 未定型指令流）；mir ≈ Zig AIR（typed）；TIR ≈ Zig 缺失的共享桥。

> **HIR 缓存（pre-type）与 `.tmi`（typed）必须分离**（详见 `compiler-pipeline-design.md §4.2b`）：
> - **HIR 缓存**：键 = 源文件内容哈希；供**本模块** Sema 重入（改本文件才失效）——这是增量承重墙。
> - **`.tmi`**：键 = 本模块**对外 API 指纹**（导出符号 / 类型签名 / 调用约定）；供**下游依赖**消费——只要 API 指纹不变，依赖方**零重 type-check**。
> 二者解决不同增量粒度：HIR 缓存决定"本模块编译到哪一步可跳"，`.tmi` 决定"依赖方能否跳过对本模块的 type-check"。混为一坛会污染缓存或放大失效。

---

## 3. 四大性质

### 3.1 未定型（untyped — pre-type）

- 源类型注解**不解析**：`x: Foo` 里的 `Foo` 在 HIR 中是「未解析名字引用」，不是 TD 索引。
- 整数/浮点字面量保留「未定宽」标记，待 Sema 推断为 `i32/i64/f32/...`。
- 不携带 ABI / 存储类 `ST`。只有「语法意图 + 未解析类型表达式」。

### 3.2 线性（linear）

- 每个函数体 = 扁平指令数组；表达式降级到显式临时槽（与 TIR 同构，保证 HIR→TIR 平滑）。
- 控制流初始阶段可保留嵌套结构，AstGen 后期再扁平化为 `block @label` + 终止指令；Phase 1 允许 tree→linear 宽松。

### 3.3 可序列化（serializable）

- **文本**（可 diff，利于缓存一致性校验）+ **二进制**（快加载）双格式。
- 磁盘缓存键 = 源文件内容哈希；依赖文件不变则跳过 AstGen + Sema 入口重算。

### 3.4 per-file 缓存锚点

- 因未定型、无跨文件解析，缓存条目只依赖本文件内容——这是 **HIR 缓存（pre-type）** 的键（源内容哈希）。
- 标准库（`lib/*.tc`）的 HIR 可像 Zig 一样预缓存，避免每次重 lower。
- **配套 `.tmi`（typed 模块接口）是另一条独立制品**（键=API 指纹，见 §3 对位 / `compiler-pipeline-design.md §4.2b`）：HIR 缓存让"本模块"跳过重 lower，`.tmi` 让"依赖方"跳过对本模块的 type-check。二者沉于不同层、以不同键失效，不可合并。

---

## 4. 指令集草图

**decl 级**
- `fn_decl(name, params:[local_decl], ret:type_expr, body)`
- `struct_decl` / `enum_decl` / `union_decl` / `const_decl` / `global_decl` / `import_decl`

**body 级**（每条带显式结果索引，供后续指令引用）
- 字面量：`lit_int(idx, raw_text, width_hint)` / `lit_float` / `lit_str` / `lit_bool`
- 局部/参数：`local_decl(idx, name, type_expr)` / `local_ref(idx)` / `param_ref(idx)`
- 调用：`call(idx, callee_ref, [arg_idx])` / `method_call(...)`
- 运算：`binop(idx, op, l, r)` / `unop(idx, op, x)`
- 聚合访问：`field_ref(idx, base, field_name)` / `field_set` / `index_ref(idx, base, idx_expr)` / `slice_ref`
- 构造：`construct(idx, type_expr, [field=value])`（struct / array / slice 字面量）
- 控制流：`if` / `for` / `while` / `return` / `break` / `continue` / `block`

**type_expr 节点（全部「未解析」引用，Sema 才解析为 TD）**
- `name_ref` / `generic_app(name_ref, [type_arg])` / `ptr(type_expr)` / `slice(type_expr)` / `array(type_expr, len)` / `fn_ptr(...)` / `option(type_expr)`

> 关键：所有 `type_expr` 都是**未解析**引用，使 HIR 完全独立于类型系统 → 可缓存。解析发生在 Sema，产出 mir。

---

## 5. 与 Sema / CTFE 的接口（选项 A 的核心成本）

当前 `sema.tc` 的 `meta_eval_call` / `comptime_fold_pass` **直接在 AST 树上求值**。采纳 A 后：

1. **CTFE 改为解释 HIR 指令流**：comptime 求值器遍历 HIR body 而非 AST。
2. **Sema 改为消费 HIR**：名字解析、类型检查、单态化都以 HIR 为输入，产出 mir。
3. 重写是**孤立的风险线**，建议单列 Stage，与 TIR 落地解耦（不在同一个 gate 里捆）。

**附带收益（采纳 A 才拿得到）**：
- **Zig 式惰性诊断**：未实例化的泛型体内错误不报（Sema 只在实例化路径上解释 HIR）。
- **真正的 per-file 缓存**：改一个文件只重算该文件 AstGen + 依赖闭包的 Sema 入口。
- 平滑降级路径：HIR 与 TIR 同为线性，HIR→mir→TIR→tmir 是「逐步加信息 / 逐步扁平」的单调过程。

---

## 6. 与 TIR 的关系

| | HIR | TIR |
|---|---|---|
| 类型状态 | 未定型（pre-type，债务） | 已擦除（post-type，已清偿） |
| 线性 | 是 | 是 |
| 携带 | 语法意图 + 未解析类型表达式 | 存储类 `ST` + `TT` 类型表 |
| 可 per-file 缓存 | **是** | 否（单态化之后，依赖全程序） |
| 主要消费者 | Sema / CTFE | 各后端 |
| 存在理由 | 增量编译承重墙 + 惰性诊断 | 多后端共享 lowering |

---

## 7. 落地（见 `compiler-pipeline-design.md §9` A 阶段）

- **A. AstGen + Driver/Query 层 + `.tmi` 三件套（P0）**：CST → HIR；`tc --emit-hir` 可 dump；**同期**立 Driver/Query/Scheduler（查询依赖图 + red-green 指纹 + work-stealing + 分片缓存，见 `compiler-pipeline-design.md §5.1`）与 `.tmi` 模块接口制品（§3.5 / `compiler-pipeline-design.md §4.2b`）。
- **A'. CTFE 重写**：解释 HIR 指令流（与 TIR 落地解耦，单独 gate）。
- **缓存**：HIR 以文件内容哈希进入 salsa / 磁盘缓存（分片），标准库预缓存；`.tmi` 以 API 指纹进入远程缓存（G-6）。
- 本层不动任何后端；TIR（B–F 阶段）继续消费由 Sema 产出的 mir。

---

## 8. 开放问题（留给后续裁定）

1. HIR 的「线性」在 Phase 1 是否直接扁平化，还是先保留 tree 后期 flatten？建议先 tree（复用现有 `base.nodes` 树形），再逐步线性化以降低 AstGen 风险。
2. 标准库 HIR 预缓存的失效键：纯文件哈希是否够，还是需含语言版本/编译器版本戳？建议哈希内含编译器版本标识。
3. HIR 二进制格式是否需要版本号 + 兼容性校验？建议文本格式用于 diff/调试、二进制用于缓存，二者同源生成。
