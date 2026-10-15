# REQ-EXT-1 / 2 / 3 落地记录（t 侧）

> 背景：这三项是 `tote` 侧设计 `docs/design/extend-incremental-cache.md` §5 向 **tc（t 编译器）**
> 提出的接口请求，用于让 tote 的增量缓存感知「谁 extend 了谁」。
> 本文是 **t 侧**的落地记录；tote 侧接线已在其仓库完成并推送。

---

## 0. 结论先行

| 编号 | 内容 | 状态 |
|---|---|---|
| **REQ-EXT-2** | `tc build --lib` 接受多文件位置参数并拼为同一编译单元 | ✅ **早已实现**（本次实证确认，无需改码） |
| **REQ-EXT-3** | 跨文件 `extend overload fn` 解析接通（Route 2） | ✅ **早已实现**（本次实证确认，无需改码） |
| **REQ-EXT-1** | `--emit-deps` 额外输出 `kind:"extend"` 边 | ✅ **本次实现**（`src/sema.tc` `emit_deps` + `src/parse.tc` + `src/lex.tc`） |

也就是说：三项请求的**阻塞点只有 REQ-EXT-1**，本次已解除。

---

## 1. REQ-EXT-2 / 3：已实现，实证如下

### 1.1 REQ-EXT-2（多文件编译单元）
`tc.tc:860-865` 的参数循环注释已写明「第一个非 flag 即源文件；其后所有位置参数并入同一
编译单元（R2 多文件）」，且：

- `src_file` 取**第一个**位置参数 ⇒ 与 tote 约定「被扩展模块恒为首（= 单元名）」一致；
- 所有位置参数 `append(files, ...)` → `tc_load_src(files)`（`tc.tc:917`）拼接为同一单元。

实测（`build --lib` 双文件）：

```
tc build --lib --output out/_reqext/foo out/_reqext/libfoo.tc out/_reqext/libbar.tc
→ Built library: out\_reqext\foo.tlib        (exit 0)
```

### 1.2 REQ-EXT-3（跨文件 extend 合并）
仓库自带用例 `examples/overload_cross_a.tc` + `examples/cross/overload_cross_b.tc`：

```
tc run examples/overload_cross_a.tc examples/cross/overload_cross_b.tc
→ default / big / negative      (exit 0)
```

`negative` 来自 b 文件 `extend overload fn classify(...)`，成功并入 a 文件的 `classify` 组并
在运行期正确派发 ⇒ 跨文件 extend 语义**本就成立**。单独编译 b 才报 `T-OVL-E980`（符合预期）。

---

## 2. REQ-EXT-1 的实现

### 2.1 契约（与 tote `§3.1` 一致）
`--emit-deps` 在原有 import 边之外，额外输出 extend 边：

```json
{"entry":"...","edges":[
  {"from":"<entry>","to":"foo","kind":"import"},
  {"from":"bar","to":"foo","kind":"extend"}
]}
```

- `from` = **扩展者**单元名，`to` = **被扩展者**单元名；单元名取源文件名 stem（`base_no_tc`）。
- tote 据此做 `g_extend_by[to][from] = true`，并把闭包拼成同一编译单元。

### 2.2 实测结果

```
tc check --emit-deps --lib-dir out/_reqext/lib out/_reqext/lib/bar.tc
→ {"entry":"out/_reqext/lib/bar.tc","edges":[
     {"from":"<entry>","to":"foo","kind":"import"},
     {"from":"bar","to":"foo","kind":"extend"}]}

tc check --emit-deps --lib-dir out/_reqext/lib out/_reqext/lib/foo.tc
→ {"entry":"out/_reqext/lib/foo.tc","edges":[]}
```

（fixture：`foo.tc` 声明 `overload fn op`；`bar.tc` `@import("foo")` + `extend overload fn op`。）

### 2.3 为什么必须「desugar 期登记意图，emit_deps 期解析归属」

两个坑都是**实测**出来的，不是推理出来的，改动前请先读：

**坑一：`ia==2` 标记会被 `fc_merge` 抹掉。**
`desugar_func_clauses` 在检查完 `ia==2` 后会调用 `fc_merge()`，而 `fc_merge` 用
`slice_set(lex.decl_list, g_fc_i[0], merged)` **把首个子句节点整体替换**成合并后的 dispatch 节点。
结果是：等 `emit_deps` 再去扫 `decl_list` 找 `ia==2`，一个都找不到（实测 dump 显示该 decl 的
`ia` 已变成 `-1`）。
⇒ 必须在 `desugar_func_clauses`（合并**之前**）登记「扩展意图」（组名 + 扩展者单元）。

**坑二：被扩展者来自别的模块时，其 `sa` 被重整、`ia` 也不是 1。**
实测 dump：`foo` 的组 decl 为 `{"k":"FuncDecl","ia":0,"sa":"foo__op","f":"...\\foo.tc"}`
—— 组名被加上 `<模块>__` 前缀，`ia` 是 `0` 而非 `1`；而扩展者侧 decl 的 `sa` 是裸名 `"op"`。
⇒ 匹配规则必须是「**裸名相等 或 以 `__<名>` 结尾**」，不能用 `ia==1 && sa==nm` 直接比。

另外，pass 顺序决定了**归属不能在 desugar 期解析**：desugar pass 为
`func_clauses(1) → lambdas(2) → array_len_infer(3) → imports(4)`，模块加载在 **order 4**，
晚于 order 1。故 desugar 期对方模块的组尚未进 `decl_list`（这也是跨模块 extend 仍报
`T-OVL-E980` 的原因）；归属必须留到 `emit_deps`（模块已加载完）再解析。

### 2.4 代码落点
- `src/lex.tc`：新增 `g_extend_name` / `g_extend_file`（扩展意图）。
- `src/parse.tc` `desugar_func_clauses`：遇 `ia==2` 即登记（组名 + `base_no_tc(node_file(...))`）。
- `src/sema.tc` `emit_deps`：import 边补 `kind":"import"`；再按意图解析归属、去重输出 `kind":"extend"`。

> ⚠ 只输出「结构事实」：跨单元 extend 在未拼成同一单元时仍会报 `T-OVL-E980`，但
> `emit_deps` 位于 `run_check` 之后、且早于「有错则返回」分支（`tc.tc:305-308`），JSON 照常输出；
> tote 侧 `sys_capture` 忽略退出码、只读 stdout，因此不受影响。

---

## 3. 验证

- `tc check src/tc.tc`：`errors = 0`（warnings 为既有 lint，与基线一致）。
- 自举不动点：`g2 == g3 == g4`（IR 逐字节一致）。
- gate L2：见本次提交记录。
- 功能验收：见 §2.2 的 `--emit-deps` 输出。

---

## 4. 遗留

- **粒度**：当前只覆盖 `extend overload fn`（函数）。设计里提到的数据结构 extend
  （如 `extend struct`）在 tc 中**尚无语法**，待语言支持后按同样机制扩展。
- **诊断溯源**：多文件拼接时 `g_file` 统一指向首文件（`tc_load_src` 注释已记），
  extend 报错行号可能不准 —— 不影响产物与缓存正确性。
