# t 全量 comptime 设计文档

> 状态：讨论已锁定方向，P0+P1 骨架已落地（`src/comptime_fold.tc`，默认关闭）。
> 本文档为讨论结论 + 源码探查后的修订版，是后续实现的唯一依据。

## 0. 决策锁定

- **语义 = B（弥漫式自动折叠）**：只要一个表达式的全部操作数都是编译期已知的，就自动折叠，不要求任何 `comptime`/`meta` 标注。
- **类型即值（A 的那半）**：泛型靠返回 `Type` 的 comptime 函数实例化（P4 落地）。
- **求值机制 = 前端树遍历解释器**，挂在 `sema` 之后、`codegen` 之前，不碰任何后端。
- **P0–P4 只放“无捕获 / 纯值捕获”的 comptime 函数**；闭包（TClosure ABI 的编译期表示）留到 P5+。

## 1. 源码探查后的关键修正（推翻了初版设计）

1. **t 已有 CTFE 求值器** `meta_eval` / `meta_pass` / `meta_fold_expr`（`sema.tc`）。`comptime`、`comptime_block` 节点种类已存在。
   → “全量 comptime”不是从零造解释器，而是把 `meta_eval` 的**触发范围从「仅 comptime 标记节点」扩大到「任意全 const 可折的普通表达式节点」**。
2. **`Node` 无类型字段**（扁平节点池 `nodes[]`）。类型靠 `infer_expr(e)` / `resolve_ti(tn)` 按需重算。初版设想的 `n.typ` 不存在；CVal 的 `typ` 应是 **TI 索引（i64）**。
3. **t 无 i128/u128**，最大 `i64/u64`；且 codegen 把 `int` 字面量**默认按 i64 发射**，窄类型靠 `cast` 节点体现。
   → P0+P1 用 i64 算术，复用 `meta_eval_binary` 的 wrap 语义；窄类型常量保留 `cast` 节点。
4. **折叠的标准做法是“原地改写”**：`meta_fold_expr` 把节点就地改成字面量节点（保留 `ln/cl/tv` 诊断锚点）。本模块复用同一改写形态。
5. **`meta_eval` 对不可折节点会调 `meta_fail`** → 可能向诊断塞错误（`has_errors()` 为真 → 编译假失败）。
   → 绝对不能盲调；必须加护栏：只折「子树不含 `ident`/`call`/`index`/`array_lit`」的纯字面量算术。

## 2. 架构定位

```
lex → parse → sema ──(run_check)──┐
                                   ↓
                            [comptime_fold_pass]   ← 新增模块，run_check 之后
                                   ↓
                        flag_pass → ann_pass → emit(C / LLVM)
```

- 新模块 `src/comptime_fold.tc`，DAG 位于 `sema` 之后、`codegen_c` 之前（见 `tools/tc_sources.mjs`）。
- 入口 `comptime_fold_pass()`，由 `tc.tc` 在 `run_check()` 返回后、两个代码路径（`compile` 与 `emit-ll/build/run`）各调用一次。
- **复用 `meta_eval` 作为求值器**；遍历整池节点，对候选表达式种类尝试 `meta_eval`，成功（返回字面量节点 id）则原地改写。
- 跳过 `comptime` / `comptime_block`（已由 `meta_pass` 处理），避免重复改写。

## 3. 折叠机制（P0+P1 骨架实现）

```t
comptime_fold_pass fn() void {
    if (g_comptime_full == false) { return; }   // 默认关闭，不扰动门禁
    g_meta_steps = 4000000; g_meta_err = false; g_meta_quiet = true;  // 复刻 meta_pass 求值上下文
    var i: i64 = 0;
    var n: i64 = slice_len(nodes) as i64;
    while (i < n) {
        var k: string = nodes[i].kind;
        if (k == "comptime" || k == "comptime_block") { i = i + 1; continue; }
        if (comptime_is_candidate(k) == false)     { i = i + 1; continue; }
        if (comptime_has_runtime_ref(i))           { i = i + 1; continue; }  // 护栏：禁触 meta_fail
        var v: i64 = meta_eval(i);
        if (v >= 0) { comptime_rewrite_to_literal(i, v); }
        i = i + 1;
    }
}
```

- **候选种类（P0）**：`binary` / `unary` / `cast` / `paren`。
- **护栏 `comptime_has_runtime_ref`**：递归检查子树是否含 `ident`/`call`/`index`/`array_lit`，命中即跳过。这是安全性核心——保证 `meta_eval` 永不撞运行期引用、永不塞伪错误。
- **原地改写 `comptime_rewrite_to_literal`**：逐字复用 `meta_fold_expr` 的字段拷贝（`kind/sa/ia/ba` + 清 `na..nd` + 保留 `la`），保证 codegen 把结果当普通字面量发射。

## 4. 值模型（CVal）修订

- **P0–P2：不引入显式 CVal 结构**。沿用“求值即生成字面量节点”的节点式方案（与 `meta_eval` 一致），零新增类型，复用已验证路径。
- **P3+**：当需“类型即值”与 comptime 函数捕获时，引入显式 `CVal` 带标签联合；其 `typ` 字段为 **TI 索引（i64）**——通过 `infer_expr` 取得，**不复制 Type 系统**（sema 已有一套 `TI`/`TD`）。
  - `CVal = Int(ti, bits) | Flt(...) | Bool | Char | Str | Arr | Struct | Enum | Type(ti) | Fn(AST + 捕获的 CVal 环境)`
  - 初版的“128 位内部整数”决策作废：t 无 i128，P3 前用 i64；如需 >64 位编译期常量再议。

## 5. 折叠判定 / comptime 边界

- `meta_eval` 已实现“尝试求值、失败返回 -1”的回退语义——这正是 B 式弥漫折叠的核心。本模块只是把触发范围扩大。
- **forbidden → 不折**：I/O、系统调用、取运行期变量地址、调用运行期内建、引用运行期变量。现有 `meta_eval` 对运行期内建/运行期 `ident` 会返回 -1（或 `meta_fail`），本模块护栏进一步在调用前拦截，杜绝伪错误。
- 运行期内建清单（`print`/`time`/`random` 等）需显式登记，确保 `meta_eval` 对其返回 -1。

## 6. 双后端 & 不动点影响

- 折叠产物是“已改写为字面量的 AST”；C/LLVM 后端照常发射，**comptime 逻辑零后端相关** → 天然守双后端等价（`cself`）。
- 折叠是语义 no-op：四代统一应用同款折叠 → 四代 md5 不动点**应**仍成立，但 P6 须重跑 gate 复核。
- **窄类型陷阱**：折叠出的 `u8`/`i32` 等常量须保留 `cast` 节点，否则后端误按 i64 发射（见 §1.3）。

## 7. 阶段划分（修订）

| 阶段 | 内容 | 依赖/风险 |
|---|---|---|
| **P0** | `comptime_fold_pass` 骨架 + tc.tc 接线（gated）；复用 `meta_eval` 折普通 `binary/unary/cast/paren`；验证 `var x = 2+3` → `5` | 本骨架已落地，待 gate 验证编译 + 翻开关验证折叠 |
| **P1** | 扩大覆盖：bool 短路、`if` 常量分支折叠、字符串拼接；确定性审计 | 需扩展 `meta_eval` 或本模块求值 |
| **P2** | `struct`/`array`/`enum` 字面量折叠 | 依赖 P3 的 CVal 或扩展 `meta_eval` |
| **P3** | 显式 `CVal`；comptime 函数（无捕获/纯值捕获）；递归 | 引入值模型 |
| **P4** | 类型即值 + 泛型经 comptime 实例化（扩展 `meta_eval` 识别 `Type` 值 + 单态化驱动器） | **须对齐现有 `import(src.x :: *)` 泛型管线**（见 §8） |
| **P5** | comptime 闭包（TClosure ABI 的编译期表示） | 捕获环境只能是 CVal |
| **P6** | 步数/递归深度/分配上限熔断 + 双后端等价审计 + gate 验证 | `meta_eval` 已有 `g_meta_steps` 预算，扩展即可 |

## 8. 开放项（须读代码/实测确认）

1. **现有 `import(src.x :: *)` 泛型机制与 P4 类型即值的关系**：复用其单态化管线，还是另起？种子 tc0 解析不了此语法，说明它已是单态化体系。
2. **`as` 中缀转型表达式**的解析路径未定位（`lex` 注册了 `KwAs`，但示例里 `is/as` 多为 `Type_is_X`/`Type_as_X` 生成函数）。处理 `as` 转型前须确认。
3. **默认开启弥漫折叠对门禁的影响**：建议先 gated，跑通后默认开。开启即意味编译器的自举产物会多折一批常量——须 gate 复核四代不动点。

## 9. P0+P1 落地清单（本骨架已做 / 待做）

已做：
- `src/comptime_fold.tc`：候选判定 + 护栏 + 原地改写 + pass 入口（默认 `g_comptime_full=false`）。
- `src/tc.tc`：`import(src.comptime_fold :: *)` + 两处 `run_check()` 后调用 `comptime_fold_pass()`。
- `tools/tc_sources.mjs`：`TC_MODULES` 加入 `src/comptime_fold.tc`（位于 `sema` 之后）。

待验证（下一步）：
- 翻 `g_comptime_full = true` 后 `node tools/gate.mjs L0` 复核：骨架能编译、既有门禁不破。
- 用最小示例 `var x = 2 + 3; print(x);` 编译，确认产物里 `2+3` 已折成常量 `5`。
