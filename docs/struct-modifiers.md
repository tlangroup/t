# t 语言 struct 修饰词体系 · 说明文档

> 交付 PR：[#7](https://github.com/tlangroup/t/pull/7)（`wb` → `main`）
> 关联设计：`docs/design/struct-modifiers/DESIGN.md` ・ 测试矩阵：`docs/design/struct-modifiers/TESTS.md`

## 1. 这是什么

struct-modifiers 把 t 语言里原本分散、零散的 struct 开关，统一成一套**正交、可组合**的文法，补齐四个维度：

| 维度 | 关键字 / 语法 | 作用 |
|---|---|---|
| **布局** | `packed` / `extern`（不写修饰 = 默认布局） | 控制内存布局 |
| **开放** | `overload` + `extend` | 跨模块扩展 struct |
| **约束** | `concept`（原 `duck`） | 编译期约束类型，用作泛型边界 |
| **自定义** | `#<id>` | 第三方扩展修饰词（注册表驱动） |

核心原则：**用户可见的布局修饰关键字只有 `packed` 与 `extern`**；不写任何修饰即默认布局（内部标签 `auto`，非关键字）；`concept` 约束纯编译期、零运行时开销。

---

## 2. 快速上手

### 2.1 布局维度

```t
struct Point { x: f64; y: f64; }                  // 默认布局（不写修饰，内部标签 auto）
packed struct Flags { a: u1; _:u2; b: u4; c: u9; } // 位域打包 + `_:u2` 占位字段
extern struct CStat { dev: i32; ino: u64; }        // C-API 严格 C 规范（capi / C FFI）
```

要点：
- **默认布局**：不写修饰即默认；`auto` / `default` 都不是关键字，不能写出来。
- **`packed`**：位域顺序打包（积类型统一 epic 已实现），成员支持占位字段 `_:uN`（如 `_:u2` 保留 2 位）。
- **`extern`**：遵循标准 C struct 布局（声明序 = 内存序、标准 C 对齐 / 填充），有字段体、可实例化，专用于 C 兼容。
- **互斥**：`packed` 与 `extern` 互斥；`extern` 不支持 `overload` / `extend`（与开放维度互斥）。

### 2.2 开放维度（跨模块扩展）

```t
// 模块 A
overload struct Entity { id: u64; pos: Vec3; _; }   // 开放组，编译器合成尾部 `_` 锚点

// 模块 B（同一编译单元）
extend overload struct Entity {
    tag: u32;
    fn describe(self: Entity) string { return int_to_str(self.tag); }
}
```

要点：
- `overload struct X` 标记为"可扩展组"；`extend overload struct X` 追加字段 + 方法。
- **须同编译单元**：单独编译 `extend` 片段（无对应 overload 组）报 `T-OVL-E980`。
- `extern` 与 `overload` 互斥（双向 `extern overload` / `overload extern` 均报 `T-PAR-E102`）。

### 2.3 约束维度（`concept`）

```t
concept HasName {                         // 约束声明类型，不可实例化
    fn name(self) string;                  // 函数约束
    age: i64;                              // 字段约束
}

fn greet(T:HasName, x: T) string { ... }   // 泛型边界：类型参数 T 前置，RHS 为 concept
```

要点：
- **纯编译期**：无 vtable / 无类型信息 / 无动态派发，零运行时开销；generic 函数在编译期单态化。
- **结构化满足**：具体类型拥有匹配的方法签名 + 字段形状即满足，无需 `impl` / `declare`。
- **不可实例化**：当作值类型位置使用报 `T-CON-E100`。
- **泛型函数语法**：类型参数 / 值参数靠 RHS 区分（RHS 为 concept 名 → 类型参数；为类型 → 值参数）；类型参数须在使用前声明，可位于参数表任意位置；无约束类型参数写作裸标识符 `fn f(T, x: T)`；类型实参走类型推断（不引入显式类型实参语法）。
- **本次范围**：仅实现 generic **函数**语法；generic **struct** 语法（`struct Box(T:HasName){...}`）不在本次范围，保留为未来扩展。struct 泛型效果可经「generic 函数 + 匿名结构体 / 元组（`.{T1,T2}` / `{x:T,...}`）」组合达成。

### 2.4 自定义修饰词（`#id`）

```t
#modifier serde                   // 先注册（内建 soa/aos 已隐式预注册）
#serde struct Config { host: string; port: u16; }
```

要点：
- 未知 id 强制报错（`T-ANN-E453`）；旧 `#extern` 报错 + 迁移提示（`T-ANN-E454`）。
- **前置 / 后置两种写法都支持**：`#id struct X` 与 `struct #id X` 等价。
- `#id` 仅"应用"修饰词，编译器不解释语义，真实语义由用户扩展函数（插件 / 钩子）消费。

---

## 3. 迁移指南（破坏性变更）

| 旧写法 | 新写法 | 说明 |
|---|---|---|
| `#extern struct X` | `extern struct X` | `#extern` 废弃，升级为关键字，语义由"冗余标注"升级为"强制 C 规范" |
| `#auto struct X` | （删除） | `#auto` 废弃；默认布局靠"不写任何修饰"获得 |
| `duck` 约束类型 | `concept` | 改名（对标 C++20 concepts），语义不变 |
| struct 方法 `fn m(self) T` | `fn m(self: T) T` | 接收者须显式标注类型（t 既有方法文法要求） |

> 其余既有 struct 写法（默认布局、普通字段、`@size_of` / `@offset_of` 等）保持不变。

---

## 4. 诊断码速查

| 诊断码 | 触发场景 |
|---|---|
| `T-PAR-E101` | 期望 `struct` 而不得（如 `auto struct` / `default struct`） |
| `T-PAR-E102` | 布局 / 开放修饰互斥（`packed extern` / `extern overload` / `overload extern`） |
| `T-CON-E100` | `concept` 不可实例化（当作值类型位置使用） |
| `T-CON-E101` | 类型不满足 `concept` 约束 |
| `T-OVL-E980` | `extend overload struct` 无对应 overload 组（同编译单元要求） |
| `T-ANN-E453` | 修饰词未注册（未知 `#<id>`） |
| `T-ANN-E454` | 修饰词已废弃（`#extern`，附迁移提示） |

---

## 5. 如何验证（手动验收清单）

1. **自举**：`node tools/refresh_seed.mjs` 后 `ci/seed/tc.exe build src/tc.tc --output out/dbg/g1` → g1→g2→g3→g4 不动点。
2. **示例·C 后端**：`out/dbg/tc.exe build examples/struct_modifiers.tc --output /tmp/sm_c.exe && /tmp/sm_c.exe`。
3. **示例·LLVM 后端**：`out/dbg/tc.exe build examples/struct_modifiers.tc --backend llvm --output /tmp/sm_ll` 并运行，输出应与 C 后端一致。
4. **跨文件扩展**：`out/dbg/tc.exe build examples/struct_extend_a.tc examples/cross/struct_extend_b.tc --output /tmp/ex.exe && /tmp/ex.exe`，核对 `e.tag` / `e.describe()` 可用。
5. **单文件 golden**：`examples/struct_modifiers_extend.tc` 双后端跑通并比对 `.expected.txt`。
6. **负路径**：`struct #frobnicate X`（E453）、`#extern struct X`（E454）、`extern overload struct` / `overload extern struct`（E102）、`default struct` / `auto struct`（E101/E102）、concept 不满足（E101）、concept 实例化（E100）。
7. **conformance 全量**：`node tools/run_conformance.mjs` 确认 struct-modifiers 相关用例全绿。

---

## 6. 自动验证结论（交付时状态）

- **自举不动点**：seed→g1→g2→g3→g4，g2.ll == g3.ll == g4.ll 达成。
- **gate L2**（Task #6 轮）：24 passed / 0 failed，EXIT=0。
- **IR 基线**：编译器源码变更引起的自身 IR 漂移已重录（良性）；0 示例发射漂移。
- **种子**：`npm run seed:check` 通过（0 error / 541 warning），`ci/seed/tc.exe` 与源码同步。

> 注：本交付末提交仅为合并提交，未改动任何编译器源码，上述验证状态对当前 HEAD 仍有效。
