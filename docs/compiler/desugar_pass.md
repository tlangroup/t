# `@desugar` 与 `@pass` 用户插件 API 设计

> 本文是 `@desugar` / `@pass` 的专门设计文档。元函数总体规范见 `metafunction.md`；本文与其交叉点见 §7。
> 状态：**设计阶段（M8 / 工作B S8），尚未实现**，受 §6 所述硬阻塞约束，按「真实消费者触发」门槛 DEFERRED。

---

## 1. 定位与身份

`@desugar` 与 `@pass` 是**编译期用户插件注解（attribute）**，贴在用户自己写的**普通双栖 `fn`** 上，把它注册进编译器的某个阶段。

关键身份界定（与 `metafunction.md` 一致）：

| 实体 | 身份 | 是否元函数调用形态 |
|------|------|--------------------|
| `@module` / `@import` | 元函数（`@name(...)` 值调用） | ✅ 是 |
| `@derive` / `@Vector` / `@Tile` | 类型 / 声明位注解 | ❌ 否 |
| **`@desugar` / `@pass`** | **编译期插件注解** | ❌ 否（与 `@derive` 同属注解身份） |

> ⚠ 历史措辞更正：早期描述称「用户插件以元函数身份接入 `@` 调用体系」。该说法不准确——`@desugar`/`@pass` 是**注解**（`@name` 贴在 `fn` 上），不是 `@name(...)` 值调用；它们不占用 `metafunction.md` 定义的元函数调用形态名额。正确模型见 §2.1「通用捕获」。

执行载体：插件被调用时由编译器以 **`comptime`（强制编译期执行）+ 双栖 `fn`** 机制触发——你写的是普通 t 函数（可用类型、控制流、甚至调用其他元函数如 `@type_size`），编译器在对应阶段用 `comptime` 强制它在编译期执行。

> 注意：`@desugar` / `@pass` 是**注解语法**（`@` + 属性名贴在 `fn` 声明上，无参数调用），与「内建 `@name(...)` 值调用」词法角色不同，不冲突于「`@` 仅供内建」规则（见 `metafunction.md` §0/§3.1）。

---

## 2. `@desugar` —— 用户自定义脱糖

### 2.1 核心前提：编译器只实现「一种通用捕获」

`@desugar` 的全部威力来自一个约束：**编译器不为任何具体用户语法做适配**。它在 parse 阶段只落地一条**一次性**的通用规则：

```
IDENT '!' ( '(' tokens ')' | '{' tokens '}' | '[' tokens ']' )  →  kind = "Macro"
字段:  .name  = IDENT          // 如 "comp" / "html" / "sql"
       .body  = 原始 tokens / 子树
```

此后，**所有 `foo!{...}` / `bar!(...)` / `baz![...]` 在编译器眼里一律只是 `Macro` 节点，区别仅在于 `.name`**。编译器对 `comp`/`sql`/`html`/任何新形式**一窍不通**，也永远不需要懂。

这正是「零编译器改动即可扩展语法」的基石——想加管道 `|>`、资源块 `with`、`match`、任意领域 DSL，都只是再写一个 `@desugar(name=...)`，parser 一次都不用动。

> 反例警示：不要把「编译器已原生识别某节点（如 `RangeLit`）再交给钩子收尾」当作 `@desugar` 的示范。那等于编译器已为该形式开了后门，`@desugar` 退化成收尾钩子，没体现出「用户能长出编译器不懂的语法」这一核心卖点。

### 2.2 规则注册与分发

```t
// 编译器从不认识 comp!，也不知道什么是列表推导式
@desugar(name = "comp")
fn lower_comprehension(m: Macro) -> Node {
    // m.body 是 [expr for pat in iter if cond] 的原始子树
    // 用户自己解析它，改写成核心 t 的 map / filter / for
    return fold_right(m.body,
        fn(acc, clause) {
            match clause.kind {
                "For" => mk_call("iter_map",    [clause.iter, mk_lambda(clause.pat, acc)])
                "If"  => mk_call("iter_filter", [clause.cond, mk_lambda(clause.pat, acc)])
                else  => mk_lambda("_", clause.expr)   // 最内层 yield
            }
        })
}
```

- 注册：编译期把 `lower_comprehension` 登记进「脱糖规则表」，键 = `name`（即 `Macro.name`）。
- 分发：脱糖阶段（parse 之后、构造 HIR 之前；对应工作B S6 step4 逐节点脱糖收口）遍历每个 `Macro` 节点，按 `.name` 查规则：
  - 命中 → `@lower_comprehension(node)` 编译期执行，用返回的 `Node` 替换原节点；
  - 未命中 → 统一报错 `unknown form 'comp!'`。

### 2.3 规则体能力

- **`m.body` 是原始 tokens / 子树**：用户规则自行解析（可调用编译器提供的 token 流访问 API 或手写匹配），编译器不预解析具体语义。
- **产物是核心 t 的 `Node` 树**（用节点构造 / 匿名结构体字面量生成），直接进入 HIR 构造。
- **多趟重写**：脱糖阶段可按拓扑顺序跑多趟，支持规则间组合（如 `html!` 内部嵌 `comp!`——先展 `html!` 得含 `comp!` 的子树，再下一趟展 `comp!`）。
- **规则本体是双栖 `fn`**：可调用 `@type_size` 等元函数、可用控制流、可被 `@import` 复用。

### 2.4 示例

列表推导式（编译器完全不懂，全部语义由用户规则定义）：

```t
let evens = comp![x*x for x in 0..n if x % 2 == 0]
// 脱糖后等价于 iter_map(iter_filter(range(0, n), x => x % 2 == 0), x => x * x)
```

嵌入式 DSL（同机制，量级更大；`<div>`/作用域/`for` 在标签内的含义全由用户规则决定）：

```t
let page = html![
    <div class="container">
        <h1>{title}</h1>
        for item in items { <li>{item}</li> }
    </div>
]
// 编译器只看到 html! 这个 Macro，其余全部交给 @desugar(name="html") 规则
```

---

## 3. `@pass` —— 用户自定义 IR 变换

### 3.1 注册

```t
// 在 TIR 之后跑一遍常量折叠 pass
@pass(after = "tir", name = "my_const_prop")
fn const_prop_pass(m: Module) -> Module {
    for f in m.functions {
        for bb in f.basic_blocks {
            for ins in bb.instrs {
                if ins.is_const_binop() {
                    ins.replace_with(mk_const(ins.eval()))
                }
            }
        }
    }
    return m
}
```

- 注册：把 `const_prop_pass` 登记进「pass 管线」，带 `after` / `stage` 挂载点（可选 `hir` / `tir` / `early-sema` 等）。
- 多个 `@pass` 按 `after` 拓扑顺序串成管线，与编译器内建 pass 同台。

### 3.2 触发与输入 / 输出

- 编译器走到该挂载点，把**当前 `Module`（或对应 IR 单元）**作为实参，`@const_prop_pass(m)` 编译期执行。
- 返回的 `Module` 成为后续阶段的输入。
- pass 本质是「编译期一次性变换、产出 IR 数据」，产物是 IR 而非运行期闭包（见 §6 对硬阻塞②的解法）。

### 3.3 输入 / 输出类型：首类编译期 IR 类型

`@pass` 拿到的 `m: Module` 不是运行期对象，而是**编译期第一公民**的 IR 节点树（SoA 侧表 + `Node` 聚合）。pass 直接读写它，无需 `ModuleRef` 这类不透明句柄（这是解开 §6 硬阻塞①的关键）。

---

## 4. 与整体机制的集成

- **双栖 `fn` + `comptime` 强制编译期执行**是二者的执行载体（见 `metafunction.md` §7：普通函数靠 `comptime` 而非 `@` 进入编译期）。你写的是普通 t 函数，编译器替你在对应阶段用 `comptime` 调用。
- **模块性**：`@desugar`/`@pass` 定义在某模块里；别的模块经 `@import`（元函数）拿到模块对象后 `using` 即可复用其脱糖规则 / pass——呼应 `@module`/`@import` 是元函数那条线。
- **身份边界**：与 `@derive` 同属注解身份，不占元函数调用形态名额；与 `@module`/`@import`（元函数调用）区分清晰。

---

## 5. 当前硬阻塞（S8）与最终形态解法

工作B S8 的两项硬阻塞，在「最终形态」下如何解开：

1. **`ModuleRef` 不存在**
   → 把 `Module` / `Node` 做成**首类编译期类型**（SoA 侧表 + `Node` 聚合），pass 直接读写 IR 数据，不再需要不透明的 `ModuleRef` 句柄。
2. **LLVM 不支持结构体字段的 fn 值调用**
   → **不触发**。只有当你试图把一个用户 pass **编译成运行期可调用的闭包**、再让 LLVM 经结构字段间接调用它时才会撞上此限制；而 pass 本质是编译期一次性变换、产物是 IR 数据而非运行期 fn 值，②自然不触发。`@desugar` 同理（产物是改写后的 `Node` 数据）。

> 状态：M8 / S8 仍 **DEFERRED**，受 §0.13.9「真实消费者触发」门槛约束（见工作记忆）。

---

## 6. 实现路线（对齐清单）

| 编号 | 任务 | 说明 |
|------|------|------|
| D7 | 通用 `Macro` 捕获节点 | parser 一次性落地 `IDENT '!' (...\|{...}\|[...])` → `kind="Macro"`（`.name`/`.body`）；不为任何具体形式适配 |
| D8 | `@desugar` / `@pass` 注解解析 + 表注册 | 解析注解，登记「脱糖规则表」/「pass 管线」 |
| D9 | 脱糖阶段接线 | 在 parse 后、HIR 前接入（替换 S6 step4 现有路径），按 `.name` 分发、未命中报错 `unknown form` |
| D10 | `Module` / `Node` 首类编译期类型 | 解开 `ModuleRef` 阻塞①，使 pass 可直读写 IR |
| D11 | pass 管线挂载点接线 | `hir` / `tir` 挂载点，按 `after` 拓扑串联 |
| D12 | 示例与文档固化 | 以列表推导式 / HTML DSL / const-prop pass 为验收样例 |

---

## 7. 与 `metafunction.md` 的关系

- `metafunction.md`：元函数**总体规范**（定义、与运行时函数的唯一区别 = 不定长参数、已实现清单、对齐清单）。
- 本文：`@desugar` / `@pass` 的**专门设计**。
- 交叉点：用户插件以**注解身份**接入编译期（与 `@derive` 一致），不占用元函数调用形态名额；其执行仍复用「双栖 `fn` + `comptime` 强制编译期执行」这一统一载体（见 `metafunction.md` §7）。

> `metafunction.md` §11 第 6 项的旧措辞「用户插件以元函数身份接入 `@` 调用体系」已据本文更正为「通用 `Macro` 捕获 + 注解注册的脱糖 / 变换规则」。
