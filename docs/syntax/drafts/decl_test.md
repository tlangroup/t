# 语法规则草稿 · 测试声明（TestDecl / SuiteDecl）  [起草中]

> **状态：起草中（2026-08-08）** —— 按 L-15 起草工作流提交，待四法评审后采纳并入 `docs/reference.md`。
> **依据**：现状 `src/sema.tc:6484` 的 `ad("test", ...)` 注解注册 + `src/parse.tc:1747` `parse_decl_body` 并置分发 + `docs/reference.md` §2.4 AnnotationTable。
> **动机**：现有测试语法为「注解 + 返回 bool 的普通函数」，与新生代语言的测试表达式已明显脱节；且**无运行器**，`@test` 至今只是一个被解析、被校验、但从不被执行的标记。

---

## 0. 现状与差距

当前唯一写法（`tests/conformance/pass/p07_test_annotations.tc`）：

```t
test_grouped fn() bool @test @test_group("math") {
    return double_it(0) == 0;
}
```

五项差距（与主流新生代语言对照，见 §1）：

| # | 差距 | 后果 |
|---|---|---|
| 1 | 测试名是**标识符**，非自然语言字符串 | `test_flag_overflow` 无法表达「溢出时应当截断而非回绕」 |
| 2 | 分组靠**字符串标签** `@test_group("math")` | 分组是扁平的、拼写易错的、不可嵌套 |
| 3 | 成败靠**返回 bool** | 失败只知道「假」，不知道**哪一步**、**期望什么**、**实际什么** |
| 4 | 无断言自省 | 同上，这是差距最大的一项 |
| 5 | **无运行器** | `@test` 是死标记；`tc` 没有 `test` 子命令 |

---

## 1. 新生代语言测试语法调研

归纳为五种范式。

### 范式 A — 字符串命名块（Zig / Nim / Julia / Elixir）

```zig
test "adds two numbers" {                     // Zig
    try std.testing.expectEqual(@as(i32, 5), add(2, 3));
}
```
```nim
suite "math":                                  # Nim
  test "adds two numbers":
    check add(2, 3) == 5
```
```julia
@testset "math" begin                          # Julia
    @test add(2, 3) == 5
end
```
```elixir
describe "add/2" do                            # Elixir
  test "adds two numbers" do
    assert add(2, 3) == 5
  end
end
```

**特征**：测试名是字符串；`suite`/`testset`/`describe` 提供词法嵌套分组；无函数签名、无返回值。

### 范式 B — 属性 + 普通函数（Rust / Swift / Odin / C#）

```rust
#[test]                                        // Rust
fn adds_two_numbers() {
    assert_eq!(add(2, 3), 5);
}
```
```swift
@Test("adds two numbers")                      // Swift Testing (2024)
func addsTwoNumbers() {
    #expect(add(2, 3) == 5)
}
```

**特征**：复用既有函数声明；属性携带元数据。Swift Testing 是**范式 B 向 A 靠拢**的代表——属性里补了字符串名。

### 范式 C — 纯命名约定（Go / V / Mojo / Gleam）

```go
func TestAdd(t *testing.T) {                   // Go
    if add(2, 3) != 5 { t.Errorf("got %d", add(2,3)) }
}
```

**特征**：零语法扩展，靠 `Test` 前缀识别。代价是名字必须是标识符，且无法表达自然语言意图。

### 范式 D — 匿名内联块（D）

```d
unittest {                                     // D
    assert(add(2, 3) == 5);
}
```

**特征**：极简，紧贴被测代码。代价是失败时无法命名，只能报文件行号。

### 范式 E — 表达式级断言（Roc）

```roc
expect add 2 3 == 5                            -- Roc
```

**特征**：断言本身即顶层声明，无块、无名。极致轻量。

### 趋势共性

1. **测试名是字符串**，不是标识符（A、B-新派）。
2. **断言自省**：失败时打印子表达式的实际值，而非只说「假」。Rust `assert_eq!`、Swift `#expect`、Elixir `assert`、Roc `expect` 全部如此。
3. **词法嵌套分组**取代字符串标签（A）。
4. **参数化测试**是一等公民（Swift `arguments:`、Rust `rstest`）。
5. **不返回 bool**，靠断言中止。

---

## 2. EBNF（§1 Notation）

采纳 **范式 A**，并置形态与 `Name struct {}` / `Name fn() {}` 同构 —— 名字在前、种类在后。

```ebnf
TopLevelDecl:
    ...
  | TestDecl
  | SuiteDecl

TestDecl:    String "test" TestAnn* Block
SuiteDecl:   String "suite" TestAnn* "{" SuiteMember* "}"
SuiteMember: TestDecl | SuiteDecl

TestAnn:
    "@skip" ( "(" String ")" )?
  | "@only"
  | "@should_fail"
  | "@tag" "(" String ( "," String )* ")"

ExpectStmt:  "expect" "(" Expr ( "," String )? ")" ";"
```

### 为何是 `"名字" test {}` 而非 Zig 式 `test "名字" {}`

`t` 的**并置声明宪法**：一切声明皆为 `Name kind { ... }`。

```t
Vec2   struct { x: f32; y: f32; }
Color  enum : u8 { Red; Green; }
add    fn(a: i64, b: i64) i64 { return a + b; }
"加法应返回两数之和" test { expect(add(2, 3) == 5); }
```

前置式 `test "名字" {}` 会引入**第二种声明语序**，直接违反 L-04（唯一语义）。并置式则是「名字槽从标识符放宽到字符串字面量」这一处最小改动。

---

## 3. 语义与脱糖规则

### 3.1 TestDecl → FuncDecl

`test` 块**不是新的运行时构造**，它是既有 `@test` 函数的语法糖。脱糖在 parse 期完成：

```t
"加法应返回两数之和" test { expect(add(2, 3) == 5); }
```
脱糖为等价于：
```t
__test_0 fn() bool @test {
    expect(add(2, 3) == 5);      // 见 §4，进一步脱糖为 if + return false
    return true;                  // 隐式追加
}
```

- 合成函数名 `__test_<序号>`（序号为编译单元内单调计数，保证唯一且不与用户标识符冲突）。
- 返回类型固定 `bool`；函数体末尾**隐式追加 `return true;`**。
- 原始字符串名存入 `FuncDecl.sb`（显示名），suite 路径存入 `FuncDecl.sc`。
- 自动挂 `@test` 注解，从而完全复用既有注解校验、收集、发射通路。

> **设计要点**：脱糖到既有构造，而不是新增 AST 种类。代价是 `Node` 零改动、`register_decl`/`check_decl`/`emit_llfunc` 全部零改动。

### 3.2 SuiteDecl → 前缀拼接

`suite` 不产生任何代码，只在脱糖期把名字前缀拼进内层 test 的显示名：

```t
"math" suite {
    "加法" test { expect(add(2, 3) == 5); }
    "边界" suite {
        "零元" test { expect(add(0, 0) == 0); }
    }
}
```
显示名分别为 `math / 加法` 与 `math / 边界 / 零元`。

- 嵌套无深度限制。
- suite 上的 `@skip` / `@tag` **向下继承**给所有后代 test。
- suite 内不允许出现 test/suite 以外的声明（`T_SUITE_BAD_MEMBER`）。

### 3.3 注解语义

| 注解 | spec | 目标 | 语义 |
|---|---|---|---|
| `@skip` | `none` \| `string` | test, suite | 跳过；可选字符串为跳过原因 |
| `@only` | `none` | test, suite | 若编译单元内存在任一 `@only`，则**只**跑被标记者 |
| `@should_fail` | `none` | test | 期望失败：断言失败才算通过 |
| `@tag` | `ident_list` | test, suite | 打标签，供 `tc test --tag <x>` 过滤 |

---

## 4. expect 与断言自省

### 4.1 形态

```t
expect(add(2, 3) == 5);                    // 比较式
expect(is_valid(p));                       // 谓词式
expect(add(2, 3) == 5, "加法必须可交换");   // 带说明
```

`expect` 是**内建**（不是关键字），因此用户自定义的 `expect fn(...)` 会正常遮蔽它（与 `i2s` 同理，见 `sema.tc:2540` 的查找顺序）。

### 4.2 源码文本的获取

`t` 的 token 流**不保留字节偏移**（`Tok` 只有 `t/v/line/col`），源文本在 `tokenize()` 返回后即不可达。因此不能事后切片，必须**解析期就地捕获**：

在 `parse_post_call` 识别 callee 为 `expect` 时，记录实参的 token 区间 `[s0, e1)`，把 `tk_v` 逐个拼回文本存入节点。同时在该区间内做**括号深度扫描**，找深度 0 处的比较运算符 token 下标 `opi`：

- 找到 → `left_src = text(s0, opi)`，`right_src = text(opi+1, e1)`，`op = tk_v(opi)`
- 未找到 → 整体作为谓词表达式

> 这是勘察结论里的「方案 B」：侵入最小（只改 parse 一处），代价是输出为归一化重排版（空格统一为单空格，字符串字面量需补回引号）而非逐字原文。可接受。

### 4.3 脱糖

```t
expect(add(2, 3) == 5);
```
脱糖为：
```t
if (!(add(2, 3) == 5)) {
    __expect_head("add(2, 3) == 5", "tests/math.tc", 12);
    __expect_i64("left  add(2, 3)", add(2, 3));
    __expect_i64("right 5", 5);
    __expect_tail();
    return false;
}
```

运行时输出：

```
  FAIL  math / 加法应返回两数之和
        expect(add(2, 3) == 5)
        left  add(2, 3) = 6
        right 5         = 5
        at tests/math.tc:12
```

### 4.4 运行时符号（新增）

| 符号 | 签名 | 说明 |
|---|---|---|
| `__expect_head` | `(full: string, file: string, line: i64) void` | 打印表达式与位置头 |
| `__expect_i64` | `(label: string, v: i64) void` | 整型 / bool / enum 值 |
| `__expect_str` | `(label: string, v: string) void` | 字符串值 |
| `__expect_f64` | `(label: string, v: f64) void` | 浮点值 |
| `__expect_tail` | `() void` | 收尾 |

拆成「头 + 逐值 + 尾」而非单个大函数，是为了让**类型分派落在函数选择上**（sema 按 left 的推导类型选 `__expect_i64`/`__expect_str`/`__expect_f64`），从而每个符号参数 ≤3，LLVM 后端手写发射代价可控。

> ⚠ 每个符号须完成**六处注册**：`builtin_ret`(sema, GEN 区) / `td_calls`(codegen_c, GEN 区) / C emit / LLVM emit / `llph` declare + 实参校验 / runtime 实现。漏任一处 → 静默 `; UNSUPPORTED call`。

> ⚠ 现有 `assert_eq` / `assert_true` / `assert_false` / `assert_panic` 是**半残内建**（只有 `builtin_ret`，LLVM 后端是 no-op，C 后端与运行时完全缺失）。`expect` 必须避开这个坑；`assert_*` 的清理另案处理。

---

## 5. `tc test` 运行器

```
tc test [<file.tc> | <dir>] [--tag <t>] [--filter <substr>] [--mode dbg|rls]
```

### 流程

1. 前端六步定式（同 `build`）：`g_file = path_resolve(f)` → `tokenize` → `pos = 0` → `init_anndefs()` → `parse_unit()` → `run_check(); flag_pass(); ann_pass()` → `has_errors()`。
2. **在 `run_check()` 之后**遍历 `decl_list` 收集 `ann_find(nodes[d].la, "test") >= 0` 的 `FuncDecl`（模块内联在 `run_check` 内完成，早于此则收不到 import 进来的测试）。
3. 应用 `@only` / `@skip` / `--tag` / `--filter` 过滤。
4. 合成入口：`mk_FuncDecl` 造一个带 `@main` 注解的函数追加进 `decl_list`，函数体依次调用各测试函数并累计计数。**不改 `emit_llunit` 尾部的硬编码入口生成**。
5. `emit_llunit` → 写 `.ll` → clang 链接 → `sys_run` 执行，透传退出码。产物落 `out/<mode>/test/<stem>.exe`。

### 输出格式

```
running 12 tests in 3 suites

  math
    ok    加法应返回两数之和            0.1ms
    FAIL  减法应返回两数之差            0.1ms
          expect(sub(5, 3) == 1)
          left  sub(5, 3) = 2
          right 1         = 1
          at tests/math.tc:19
    skip  除零应报错                    (未实现)

test result: 10 passed, 1 failed, 1 skipped  —  3.2ms
```

### ⚠ 两条硬约束

1. **argv 门槛**：`src/tc.tc:35` 的 `slice_len(argv) < 3` 会挡住无文件参数的 `tc test`。必须在这道门**之前**特判。
2. **stdout 纪律**：`check` 的 JSON、`emit-ll` 的 IR 走 stdout 且被 `conformance.mjs` 逐字节对拍。`tc test` 的**编译期**诊断一律 `eprint`；测试进度输出属于运行期（在被编译出的 exe 里），不经过 `tc` 的 stdout，无冲突。

---

## 6. 迁移策略（旧 → 新）

对齐 `comptime` → `meta` 的既有做法：**弃用别名过渡**，不做破坏性移除。

| 旧 | 新 | 处置 |
|---|---|---|
| `f fn() bool @test { }` | `"名字" test { }` | 保留可编译，发 `W_TEST_ANNOTATION_DEPRECATED` warning |
| `@test_skip` | `@skip` | 同上 |
| `@test_only` | `@only` | 同上 |
| `@expect_fail` | `@should_fail` | 同上 |
| `@test_group("g")` | `"g" suite { }` | 同上 |

- warning 不阻断编译（`has_errors()` 只看 `sev == "error"`）。
- 仓内存量 17 处（`tests/conformance/pass/p07_test_annotations.tc` 3 处、`tests/samples/{basic_syntax,game_ecs,protocol}.tc` 14 处）同步迁移到新写法。
- 保留一个发布周期后移除旧注解。

---

## 7. 合规判据（四法）

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ⚠→✅ | 过渡期新旧并存，**是明确的临时状态**：旧写法带 deprecated warning，一个发布周期后移除，届时回归唯一。并置式 `"名字" test {}` 与 `Name struct {}` 同构，不引入第二种声明语序。 |
| L-02 显式 | ✅ | 测试名显式；`@should_fail` 显式表达期望失败；`expect` 显式断言，不依赖返回值约定 |
| L-03 静态类型 | ✅ | 脱糖目标是普通 `fn() bool`，类型静态确定；`expect` 的类型分派在 sema 期完成 |
| L-14 铁律校验 | ✅ | 新增 conformance 用例（含弃用告警用例）；`tc test` 自身接入 gate |

---

## 8. 实施阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 语法层** | `"名字" test/suite {}` 解析 + 脱糖为 `@test` FuncDecl；新注解 `@skip/@only/@should_fail/@tag`；旧注解弃用告警 | gate L0 绿；新增 conformance 用例通过 |
| **P2 expect** | `expect` 内建 + 解析期源码捕获 + 5 个运行时符号（六处注册齐全） | UNSUPPORTED = 0；双后端 IR 一致 |
| **P3 运行器** | `tc test` 子命令 | 能跑通仓内全部测试并正确汇总 |
| **P4 迁移** | 存量 17 处改写 + IR 基线重录 | gate L2 全绿 |

---

## 9. 与既有构造的关系

- **声明分发**：`parse_decl_body`（`parse.tc:1747`）的并置第二 token 分发；`test`/`suite` 走 `flag_set` 同款**语境关键字**路线（`cur_t()=="Identifier" && cur_v()=="test"`），**不进 `keywords_tbl`**，零关键字冲突风险。但名字槽是 `String` 而非 `Identifier`，须在 `parse_declaration`（`parse.tc:1830`）的 `cur_t() != "Identifier"` 硬退出**之前**拦截。
- **两条解析路径**：`parse_unit`（`parse.tc:1870`，入口文件）与 `load_module_file`（`sema.tc:4265`，import 模块）。分发本身在 `parse_declaration` 内，两路径自动覆盖；仅当需要维护侧表（如 suite 栈）时才须两处都改。
- **注解系统**：`ad(name, spec, targets)`（`sema.tc:6472`）；`targets` 是 `", "` 分隔的严格格式。新增目标 `test` / `suite` 需扩 `decl_target`（`sema.tc:6845`）。
- **弃用告警先例**：`warn_comptime_alias`（`lex.tc:519`）用 `cur_v()` 区分原始拼写；注解层弃用见 `ann_validate`（`sema.tc:6739`），复用 error 码 + 显式传 `"warning"` 降级。
