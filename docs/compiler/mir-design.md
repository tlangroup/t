# MIR —— 中层 IR 规格（CFG + SSA + 中端优化）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md` §4.3）
> 关联：`docs/compiler/compiler-pipeline-design.md`（上位总设计）、`docs/compiler/hir-design.md`（上游 HIR=ZIR）、`docs/compiler/tir-design.md`（下游 TIR）、`docs/compiler/target-desc-design.md`（特征读取 G-10）、`docs/compiler/ir-taxonomy.md`（跨语言对位）

## 1. 定位与接壤

```text
HIR(=ZIR 槽位, 未定型·线性)
   │  sema + 单态化(instantiate_generic) + comptime 折叠(comptime_fold_pass)
   ▼
MIR（类型化 CFG + SSA + 显式资源 + 中端优化）   ← 本层
   │  类型擦除 + ABI 事实集中(TT) + 线性化(slot 模型)
   ▼
TIR（无类型·文件级·线性 IR —— 后端桥）
```

- **MIR 是 T 唯一承载"中端优化"的层**（目标 G3）。所有后端无关优化写一遍，LLVM/Cranelift/C/WASM/GPU 全部白嫖。
- **SSA 归本层**（TIR 维持 memory-first，见 `tir-design.md §2.4`）。即：TIR 不做 φ、不构造支配树；SSA 的价值（赋能优化）在 MIR 一次性兑现，TIR 只消费 SSA 已展开的线性结果。
- **可选所有权/borrow 检查在本层做**（G-7，见 §6）。

## 2. 核心结构

### 2.1 控制流图（CFG）
- **基本块（BB）**：线性指令序列 + 单一终止指令（`term`）。
- **终止指令**：`br %bb` / `br_cond $c %bb_then %bb_else` / `switch $v [%c1:%bb1 ...] %bb_def` / `ret $v` / `unreachable`。
- **显式后继列表**：每个 BB 记录其所有后继，供支配树/数据流分析。

### 2.2 SSA 值
- 每个值由**唯一指令定义**（`def` 站点），不可变；引用即使用其 `val` 编号。
- **φ 节点**：汇合点选前驱值。`phi $dst [%v_a %bb_a] [%v_b %bb_b]`。φ 在 SSA 构造阶段由支配边界算法自动插入（§4），不在 HIR→MIR 降级时手写。
- **临界边拆分**：含 φ 的临界边自动插入空 BB，保证 SSA 合法性。

### 2.3 显式资源（可选 G-7）
- **drop 节点**：`drop $v`（RAII/所有权场景）。若 T 引入所有权，MIR 显式插入 drop；否则该节点退化为 no-op 占位（供未来启用）。
- **borrow / NLL**：若启用，MIR 承载借用区域与 NLL 求解；不启用时整段透传（见 `compiler-pipeline-design.md §11.2`）。

### 2.4 运算指令（部分，与 TIR 指令集同形但**带类型**）
- 算术/逻辑：`add/sub/mul/...` 带源类型（如 `add.i32`/`add.f64`/`add.u64`），**符号性在指令上**（与 TIR `iN/uN` 一致，见 `tir-design.md §5.1`）。
- 比较：`cmp.*` 产生 `i1`（比较结果）；存槽前显式 `zext.i8`（同 TIR `bool` 双形态）。
- 聚合：struct/array/vec 构造与 field/element 访问（带字段偏移，来自 HIR 类型解析）。
- 调用：`call @f($a0 ...)` / `call_ind $closure($a0 ...)`。

## 3. 中端优化 pass 清单（G3）

按"廉价→昂贵、分析→变换"排序；每 pass 在 MIR 写一遍：

| Pass | 作用 | 依赖 |
|---|---|---|
| SROA | 聚合标量替换、拆小 alloca | — |
| mem2reg（局部） | 栈槽提升为 SSA 值（本层做，TIR 不再做） | 支配树 |
| 常量传播 / 折叠 | `x+0→x`、comptime 常量内联 | — |
| DCE / 死块消除 | 删不可达指令/BB | 存活分析 |
| 内联 | 跨调用站点展开（带成本模型） | 调用图 |
| 循环不变外提 / 强度折减 | 循环优化 | 支配树/循环嵌套 |
| 自动向量化 | 相邻同构运算合 `vec` | `target_desc`(G-10) |
| 多面体优化 | 循环变换/分块 | 依赖分析 |
| 尾调用消除 | `tail call` | — |
| GCSE / 值编号 | 公共子表达式 | — |

> 这些 pass 的输出是**已优化、已 SSA** 的 MIR；TIR 降级时只做"类型擦除 + 线性化"，不再优化（避免与 MIR 重复，也避免双后端各优化一遍的漂移）。

## 4. SSA 构造（支配树 + φ 插入）

1. 由 CFG 计算每个 BB 的**支配树**（Dominator Tree）与**支配边界（DF）**。
2. 对每个"被多前驱定义/使用"的值，在其 DF 上的 BB 插入 φ。
3. 迭代直至不动点（标准 Cytron 算法）。
4. 临界边拆分保证 φ 唯一前驱。
- 此过程对 TIR 消费者透明：TIR 收到的是 φ 已解析、控制流已显式化的结果；TIR 自身不保留 φ（见 `tir-design.md §2.4`）。

## 5. 与上下游的契约

- **入**：HIR（未定型）→ MIR 必须**先完成类型解析/单态化/comptime 折叠**再降级（即 MIR 是 typed 的）。
- **出**：MIR → TIR 降级时：
  - 类型信息**全部擦除**为 `ST`（仅存储类保留）；
  - ABI 事实（String=`{ptr,len}` 等）集中到 **TT 类型表**；
  - SSA 值**线性化**为 `slot` + `load/store`（memory-first），φ 节点就地展开为"多前驱写同一 slot"。
- **读 `target_desc`**（G-10）：自动向量化/对齐决策读取目标特征矩阵（见 `target-desc-design.md`）。

## 6. 所有权 / borrow 检查（可选 G-7）

- 默认**关闭**：MIR 整段透传，drop 为占位 no-op，不引入 NLL（对标 Odin/Jai 的"默认信任程序员"取向，降低首版风险）。
- 启用时：在 MIR 加 **borrow-verify pass**（独立、可插拔），不影响其他 pass；错误报回 HIR 源码映射（见 `compiler-pipeline-design.md §11.2`）。

## 7. 落地路线（对应 `compiler-pipeline-design.md §9`）

- **M 阶段**：MIR 内存结构（CFG + SSA + 指令集）+ `tc --emit-mir` dump；先接 HIR(=ZIR) 过渡形态，降级子集（标量/调用/if-for/struct）。门禁：MIR 文本稳定。
- **M' 阶段**：中端优化 pass 接入（常量传播/DCE/内联先落地）；验证优化后 MIR 仍降级出正确 TIR。
- **M'' 阶段（可选 G-7）**：borrow-verify pass（若启用所有权）。
- 每阶段以 `gate L2` 全绿为合并门槛；自举不动点 `g2==g3==g4` 不受影响（MIR 在 `tc.tc` 之外）。

## 8. 跨语言对位（`ir-taxonomy.md §3`）

| 语言 | 对应层 | 备注 |
|---|---|---|
| Zig | **AIR** | typed IR，中端优化所在 |
| Rust | **MIR** | 直接同名对标；CFG+SSA+drop+NLL |
| Swift | **SIL low** | 去糖后的低级 SIL |
| Go | **(函数级 SSA)** | 编译器内部，无独立命名层 |
| T | **MIR** | 本层；下游接 TIR（Zig/Rust 无此物） |

> T 的 MIR 与 Rust MIR 最贴近；差异仅在 T 下游多一层物化 TIR（见 `ir-taxonomy.md §4`/§5）。
