# std 标准库

`std` 是 `t` 的第一个标准库，位于 `lib/std`。本期引入两个子模块：

- `lib/std/mem.tc` —— 切片 / 内存工具（`export`）
- `lib/std/math.tc` —— 数值工具（`export`，纯 `t` 实现）

## 1. 解决「tc 与 std 相互依赖」

这是本库设计的核心约束。两者看似互相需要：

- `tc`（自举编译器）自身用 `t` 写道，本可复用 `std` 的分配 / 字符串 / 数学原语；
- `std` 又必须**由 `tc` 编译**才能产出机器码。

若处理不当，就会陷入「编译 `tc` 需要 `std`，编译 `std` 需要 `tc`」的鸡生蛋死循环。本库用**两条规则**结构性地消除该循环：

### 规则一：std 对 tc 零语义依赖（消除 `std → tc`）

`std` 的每一个符号只依赖：

- 语言内建（`append` / `slice_len` / 切片索引 / `as` 转换 / 数值与比较运算符 / `println` / `i2s` 等）；
- 运行时（`runtime/t_runtime.c` 提供的 arena / StringBuilder / 切片 / 字符串等，经内建桥接）。

**绝不引用 `tc` 编译器的任何私有符号**（不 `import` `tc.tc`，不调用其内联工具函数）。
因此 `std → tc` 根本不存在：`std` 只是在用「`t` 这门语言」本身，而语言由任意一代 `tc` 提供。

### 规则二：构建期先预编译 std 为 `.tlib`（斩断 `tc → std` 的构建循环）

`std` 由「当前可用的编译器」预先编译成 `.tlib`（独立归档 + 接口块），后续代际与用户程序以**链接模式** `import(std.mem)` 消费——只读取接口做类型检查、链接预编产物，无需重新编译 `std` 源码。

关键事实：`tc0`（TypeScript 引导实现）只支持旧式 `import "path"`，不认识统一语法 `import(x)` / `export`。
因此**自举首代（`tc0` 编出的 `tc.tc`）必须保持 std 无关**；`std` 由该 std 无关的 `tc` 预编译后，其后续代即可自由链接。循环在构建顺序上被斩断：

```
tc0 ──编──> tc(无 std 依赖) ──build_std──> out/lib/std/{mem,math}.tlib
                                         │
tc(无 std) ──boot1..4──> g1..g4 ──import(std.mem)──> 用户程序 / 未来带 std 的 tc
```

### 归一化命令

```bash
node tools/build_std.mjs                # 用 out/dbg/tc.exe
node tools/build_std.mjs --tc <path>    # 指定编译器（gate 内部传入 BASE_TC）
```

产出 `out/lib/std/mem.tlib`(发布态) 与 `out/lib/std/mem.tlibd`(调试态)，`math` 同理。`compute_lib_dirs`
已将 `out/lib/` 列为候选搜索路径，故 `import(std.mem)` 经 `dots_to_slashes("std.mem")` → `out/lib/std/mem.tlib` 自动命中。

> gate（`tools/gate.mjs` L0）已接入 `boot_std` 步骤：在 `boot1` 之前预编译 std，确保
> `examples/std_demo.tc` 与任何 `import(std.*)` 的用例在快照 / 运行类门禁中可用。

## 2. 使用方式

```t
import(std.math);
import(std.mem);

main_fn fn() i32 @main {
    var m = math.max(i64, 3, 7);          // 泛型有序比较
    var r = math.sqrt_f(2.0);             // 浮点
    var g = math.gcd(12, 18);             // 整数

    var xs: []i64;
    append(xs, 1); append(xs, 2); append(xs, 3);
    mem.reverse(i64, xs);                 // 切片工具（类型实参前置）
    return 0;
}
```

> **暂不支持 `import(std)` 门面**：`export` 不能修饰 `import` 声明（`T_EXPORT_SCOPE`），
> 故无法由 `lib/std/std.tc` 重导出子模块。请直接 `import(std.mem)` / `import(std.math)`。

## 3. API

### `std.mem`（全部为 `meta T: type` 泛型，类型实参前置，如 `mem.copy(i64, dst, src)`）

| 函数 | 签名 | 说明 |
|---|---|---|
| `copy` | `(meta T, dest: []T, src: []T) u64` | 拷贝前 `min(len)` 个元素，返回拷贝个数 |
| `equal` | `(meta T, a: []T, b: []T) bool` | 逐元素相等（长度不同直接判否） |
| `fill` | `(meta T, s: []T, v: T) void` | 用 `v` 填充整个切片 |
| `reverse` | `(meta T, s: []T) void` | 原地反转 |
| `swap_in` | `(meta T, s: []T, i: i64, j: i64) void` | 交换切片内第 i、j 个元素 |
| `index_of` | `(meta T, s: []T, v: T) i64` | 首次出现下标；不存在返回 -1 |
| `contains` | `(meta T, s: []T, v: T) bool` | 是否包含 |
| `len` | `(meta T, s: []T) u64` | 切片长度 |

### `std.math`

泛型有序比较（`meta T: type`，支持 `<` `>` 的类型均可，如 `i64` / `u64` / `f64`）：

| 函数 | 签名 | 说明 |
|---|---|---|
| `min` | `(meta T, a: T, b: T) T` | 较小值 |
| `max` | `(meta T, a: T, b: T) T` | 较大值 |
| `clamp` | `(meta T, x: T, lo: T, hi: T) T` | 夹到 [lo, hi] |

整数（`i64`，`log2` / `is_pow2` 用 `u64`）：

| 函数 | 签名 | 说明 |
|---|---|---|
| `abs` | `(x: i64) i64` | 绝对值 |
| `sign` | `(x: i64) i64` | -1 / 0 / 1 |
| `div_floor` | `(a: i64, b: i64) i64` | 向下取整除 |
| `div_ceil` | `(a: i64, b: i64) i64` | 向上取整除 |
| `mod_e` | `(a: i64, b: i64) i64` | 欧几里得取模（非负） |
| `log2` | `(x: u64) i64` | 以 2 为底对数（下取整），x≥1 |
| `pow2_i` | `(n: i64) i64` | 2^n（循环实现） |
| `is_pow2` | `(x: u64) bool` | 是否 2 的幂 |
| `gcd` | `(a: i64, b: i64) i64` | 最大公约数 |
| `next_multiple_of` | `(x: i64, m: i64) i64` | 不小于 x 的 m 的最小倍数 |
| `lerp_i` | `(a: i64, b: i64, t: i64) i64` | 定点线性插值（t/100） |

浮点（`f64`，`PI` / `E` 为 `const`）：

| 函数 | 签名 | 说明 |
|---|---|---|
| `fabs` | `(x: f64) f64` | 绝对值 |
| `floor_f` | `(x: f64) f64` | 向下取整 |
| `ceil_f` | `(x: f64) f64` | 向上取整 |
| `round_f` | `(x: f64) f64` | 四舍五入（半向上） |
| `trunc_f` | `(x: f64) f64` | 截断取整 |
| `sqrt_f` | `(x: f64) f64` | 牛顿迭代平方根（x<0 返回 0） |
| `pow_f` | `(x: f64, n: i64) f64` | 幂（整数指数） |
| `lerp_f` | `(a: f64, b: f64, t: f64) f64` | 浮点线性插值 |
| `sin_f` | `(x: f64) f64` | 正弦（泰勒，适中输入） |
| `cos_f` | `(x: f64) f64` | 余弦（泰勒） |
| `exp_f` | `(x: f64) f64` | e^x（泰勒） |

## 4. 已知限制与后续

1. **无 `import(std)` 门面**：`export` 不能修饰 `import`（`T_EXPORT_SCOPE`）。当前请用
   `import(std.mem)` / `import(std.math)`。需编译器支持「模块重导出」后方可提供 `import(std)`。
2. **泛型函数体内嵌套泛型调用不被单态化**（编译器限制，已实测）：`clamp` 内若调用
   `min(T, max(T, ...))` 会漏单态化、链接期报 `undefined @t.xxx`。本库已用「内联」规避
   （`clamp` 直接比较、`reverse`/`contains` 内联循环）。**编写 std 泛型函数时请勿嵌套调用
   其他泛型函数**；建议后续修复 `tc` 的 `instantiate_generic`，使嵌套泛型调用正确单态化。
3. **无裸指针 / 字节级内存操作**：`t` 当前不支持 `&` / `*` 作为表达式运算符，故
   `swap(a, b)`（两独立标量）、`memcpy` / `memset`（按字节）暂不可用，需未来新增内存内建。
   本模块提供基于切片的等价通用操作，覆盖绝大多数场景。
4. 浮点超越函数（`sin` / `cos` / `exp`）为泰勒近似，适用于适中输入；生产级精度需未来接入
   libm 内建。
