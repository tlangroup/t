# struct-modifiers 测试矩阵（设计审查件）

> 用途：供 owner 逐条核对「我对各特性的行为理解」是否对齐需求。
> 约定：错误码带 `??` 者为**提议**，待实现期分配真实码；语法片段为 aspiration，实现后落地为 `tests/` 用例。
> 对应文件：`EXAMPLES.tc`（单文件 happy-path）、`EXAMPLES_extend_a.tc` / `_b.tc`（跨文件扩展）。

---

## T1 布局 · 默认（无关键字）
- **输入**：`struct Vec3 { x: f64; y: f64; z: f64; }`（不写任何布局修饰）
- **期望**：编译通过；默认布局（`node_sb="auto"`）；编译器可对其内部做布局优化（如重排）但不暴露关键字；声明序即内存序（除非编译器内部重排）。
- **理解假设**：`auto`/`default` 均非用户可见关键字；不写修饰即默认布局；内部标签为 `auto`（若现有代码用 `default` 作标签需统一改 `auto`）。

## T1b 默认布局 = 无关键字、内部标签 auto（不可由用户写出）
- **输入**：无 —— 不存在 `auto struct` / `default struct` 写法；默认布局仅靠"不写修饰"获得。
- **期望**：`auto struct Buf {...}` 与 `default struct X {...}` 均**应编译报错**（无此关键字）；默认布局只能隐式获得。
- **理解假设**：用户可见布局关键字仅 `packed` / `extern`；`auto` 仅作编译器内部命名。

## T2 布局 · packed + 占位字段 `_:uN`
- **输入**：`packed struct Perm { readable: u1; _:u2; writable: u1; level: u4; owner_id: u8; }`
- **期望**：编译通过；位域顺序打包；`_:u2` 占位字段保留 2 位（不参与命名字段，区别于具名 `writable: u1`）；成员读写走位段。
- **理解假设**：沿用现有 packed 语义；占位改走统一字段语法 `_:uN`（名字为 `_` 的普通字段，区别于具名 `name: uN`），不再用 `_:N` 裸数字语法；非 packed struct 出现 `_:uN` 占位是否允许待定（建议仅 packed 内合法）。

## T3 布局 · extern（C-API 严格 C 规范）
- **输入**：`extern struct CStat { dev: i32; ino: u64; size: i64; }`
- **期望**：编译通过；遵循标准 C struct 布局（声明序=内存序、标准 C 对齐/填充、C 兼容）；正常发射；可实例化。
- **理解假设**：`extern` = 强制 C 规范（capi/FFI 兼容），由旧 `#extern`"冗余标注"升级而来；有字段体。

## T4 布局互斥（packed × extern）
- **输入**：`packed extern struct Bad { a: u8; b: u8; }`
- **期望**：**编译报错 `T-LAY-E??`（布局修饰互斥）**。
- **理解假设**：`packed` 与 `extern` 互斥；默认布局（不写修饰）本身即"无修饰"，不存在"default + extern"等组合。

## T4b extern × overload 互斥
- **输入**：`extern overload struct Bad { a: u8; }` 或 `overload extern struct Bad { a: u8; }`
- **期望**：**编译报错 `T-LAY-E??` / `T-OVL-E??`**（extern 专用于 C 兼容，不支持 overload/extend，与 OpenMod 互斥）。
- **理解假设**：`extern` 布局须严格稳定，不可被跨模块扩展破坏；只有非 extern 普通 struct 才能 `overload`。

## T5 overload struct · 组内声明
- **输入**：`overload struct Entity { id: u64; pos: Vec3; _; }`
- **期望**：编译通过；Entity 标记可扩展组；尾部 `_` 锚点存在；实例化无需填充 `_`。
- **理解假设**：`_` 为用户写出或编译器合成的扩展锚；`overload` 仅标记，不改默认布局。

## T6 extend struct · 同单元合并
- **输入**：文件A `overload struct Entity {...}` + 文件B `extend struct Entity { tag: u32; fn describe(self) string {...} }`，同编译单元编译。
- **期望**：编译通过；合并后 Entity = `id, pos, _, tag` + `describe(self)`；`e.tag` / `e.describe()` 可用。
- **理解假设**：复用 `extend fn` 的跨文件同单元合并规则（见 `examples/cross/overload_cross_*.tc`）。

## T7 extend struct · 单独编译
- **输入**：仅文件B（无对应 `overload struct` 组）。
- **期望**：**编译报错 `T-OVL-E980`**（无 overload 组可扩展）。
- **理解假设**：直接复用函数侧 `T-OVL-E980`（同 `tests/conformance/fail/f_overload_extend_no_group.tc`）。

## T8 concept · 满足边界（happy path）
- **输入**：`concept HasName { fn name(self) string; age: i64; }`；`struct Person { name_val: string; age: i64; fn name(self) string {...} }`；`fn greet(T:HasName, x: T) string {...}`；`greet(p)`。
- **期望**：编译通过；运行时 `greet(p)` / `greet(r)` 正常输出。
- **理解假设**：结构化满足（无需 `impl`）；方法名匹配即可，字段不必同名。

## T9 concept · 不满足边界
- **输入**：`struct Bad { x: i64; }` 传入 `greet(Bad{...})`（缺 `name` 方法 + `age` 字段）。
- **期望**：**编译报错 `T-CON-E??`（类型不满足 concept 约束）**。
- **理解假设**：泛型实例化处在静态校验「方法签名 + 字段形状」是否齐备。

## T10 concept · 不可实例化
- **输入**：`var x: HasName = ...` 或 `HasName { ... }`（试图构造 concept 值）。
- **期望**：**编译报错 `T-CON-E??`（concept 不可作为值类型实例化）**。
- **理解假设**：`concept` 仅作编译期边界，无运行时值 / vtable / 动态派发。

## T11 #id · 已注册
- **输入**：`#serde struct Config { host: string; port: u16; }`（`serde` 已注册）。
- **期望**：编译通过；编译器登记「Config 被 serde 修饰」，默认语义不变。
- **理解假设**：`#id` 仅"应用"修饰词，编译器不解释其语义；真实语义由用户扩展函数（插件/钩子）消费。

## T12 #id · 未注册报错
- **输入**：`#frobnicate struct Ghost { a: u8; }`（`frobnicate` 未注册）。
- **期望**：**编译报错 `T-MOD-E??`（修饰词未注册）**。
- **理解假设**：未知 id 强制报错（非静默忽略）；注册途径 = 内建预注册 / `#modifier <id>` / tote 插件。

## T13 旧 #soa / #aos 保留
- **输入**：`#soa struct Bucket { ... }`
- **期望**：编译通过（容器布局轴，与成员布局正交）。
- **理解假设**：`#soa`/`#aos` 保留；不与新布局关键字冲突。

## T14 旧 #extern 废弃
- **输入**：`#extern struct X { ... }`（旧写法）。
- **期望**：**编译报错 / 迁移提示**（建议改用 `extern` 关键字）。
- **理解假设**：`#extern` 由 `extern` 取代并废弃；过渡期可给"改用 extern"提示。

## 附：struct 泛型经 generic 函数 + 匿名结构体（现有能力示意，非新特性测试）
> 用户 2026-10-16 明确：generic struct 语法本次不实现（保留扩展）；struct 泛型可经「generic 函数 + 匿名结构体/元组」组合实现。以下示意依托 t **现有** generic 函数 + 匿名元组类型 `.{T1,T2}`（已支持，见 `parse.tc:371` / `sema.tc:8349`）。

- **输入**（示意，非本特性新增行为）：
  ```t
  fn make_pair(T, a: T, b: T) .{T, T} {       // 匿名元组类型 `.{T,T}`（位置字段 _0/_1）由编译器合成具名 struct
      return .{a, b};
  }
  fn show_pair(T:HasName, p: .{name: T, age: i64}) string {  // 匿名结构体 + concept 边界
      return p.name + " age=" + int_to_str(p.age);
  }
  ```
- **期望**：编译通过；`make_pair` 产出与 `T` 绑定的匿名元组（无需 generic struct 关键字）；`show_pair` 对匿名结构体做 concept 边界校验。
- **理解假设**：exact 具名字段匿名结构体类型语法以 t 现有匿名元组/结构体支持为准；核心是"generic 函数 + 匿名结构体"达成 struct 泛型效果，而非引入 generic struct 关键字。

---

## 潜在理解冲突点（owner 重点核对）
1. **concept 能否作为运行时接口值**（带 vtable / 动态派发 / 存进变量）？
   → 我假设：**否**，仅编译期泛型边界（类型参数前置 `T:HasName`），无运行时表示。
2. **concept 满足方式**：结构化（自动满足）vs 名义（需显式 `impl`/`declare`）？
   → 我假设：**结构化**（拥有匹配方法+字段即满足）。
3. **字段约束匹配粒度**：仅类型 vs 必须同名同类型？
   → 我假设：**同名同类型**。
4. **`overload struct` 尾部 `_` 锚点**：用户写出 vs 编译器纯合成（用户不可见）？
   → 我假设：**用户可写出 `_;` 占位，编译器保证其存在**。
5. **`extend struct` 是否要求同编译单元**（同 `extend fn`）？
   → 我假设：**是**，否则 `T-OVL-E980`。
6. **`#id` 语义是否完全委托插件**（编译器零解释）？
   → 我假设：**是**，编译器只登记"被修饰"，语义全交给用户扩展函数。
7. **`extern struct` 是否有字段体 + 语义 + 是否支持 overload**？
   → 我假设：**有字段体、可实例化**；语义 = 强制 C 规范（标准 C 布局，capi/FFI 兼容），而非"仅标注不改 codegen"；**且 `extern` 不支持 `overload`/`extend`**（专用于 C 兼容，布局须严格稳定）。
8. **`auto` / `default` 是否实现为关键字**？
   → 已据用户 2026-10-16 再次修订：**均非关键字**。不写任何布局修饰即默认布局，内部标签 `auto`（`node_sb="auto"`）；编译器可对其内部做布局优化（如重排）但不暴露关键字。用户可见布局关键字仅 `packed` / `extern`。
9. **`default` 是否作显式关键字**？
   → 已据用户修订：**否**。`default struct X` 写法不存在（应报错）；默认布局只能靠"不写修饰"隐式获得。
10. **packed 占位字段 `_:uN` 语法**？
   → 已据用户修订：支持占位字段 `_:uN`（如 `_:u2`）保留 N 位占位，走统一字段语法 `name: Type`（名字用 `_`，区别于具名 `name: uN`）；不再用 `_:N` 裸数字语法；非 packed struct 是否允许 `_:uN` 占位待定。
11. **`@derive` / `trait` 已废弃**？
   → 我已移除设计中对其引用；`concept` 不与任何现存机制并列。
12. **泛型边界语法**：已据用户修正为「类型参数前置 + concept 约束」即 `fn f(T:HasName, x: T)`（类型参数作为 leading 参数，RHS 为 concept 即判定为类型参数；其后值参数/返回用 `T`）。
   → **已决（2026-10-16）**：本次**仅实现 generic 函数语法**；**generic struct 语法（`struct Box(T:HasName){val:T;}`）本次不实现，保留为未来扩展**。struct 泛型经「generic 函数 + 匿名结构体（`{x:T,...}` / `.{T1,T2}`）」组合实现（见下方审查 §G-en 及 `make_pair`/`show_pair` 示例）。

---

## 泛型边界改写审查（2026-10-16 新增 · 用户要求审查 `fn greet<T: HasName>(x: T)` → `fn greet(T:HasName, x: T)`）

### 改写本身（已落进示例）
- 旧：`fn greet<T: HasName>(x: T) string`
- 新：`fn greet(T:HasName, x: T) string`
- 机制：类型参数 `T` 不再写在 `<>` 里，而是作为函数参数列表的**前置项**，用 `T:HasName` 表达"T 受 concept HasName 约束"；之后的值参数 `x: T` 引用该类型参数。

### 审查结论

**✅ 优点**
- 去掉尖括号，类型参数与普通参数统一在同一个 `()` 里，文法更统一。
- 类型参数与其 concept 约束紧邻，可读性更好。

**⚠ 待你拍板的 8 个审查点（潜在冲突）**

- **G1 类型参数 vs 值参数的判定规则**：我建议靠 RHS 区分——参数 `Name: RHS` 中，若 RHS 是 **concept 名** → 该参数是**类型参数**（绑定该 concept）；若 RHS 是**类型** → 该参数是**值参数**。这条规则不依赖大小写命名约定。需你确认此规则，以及"concept 名与 type 名是否强制不同名"（若同名则歧义）。
  → **[已决 · 2026-10-16，走推荐]** 采用 RHS 区分规则；**concept 名与 type 名强制不同名**（避免歧义）。
- **G2 类型参数必须前置声明**：`T` 必须出现在 `x: T` 之前（左到右解析）。`fn greet(x: T, T:HasName)` 应报"使用早于声明"。需确认是否允许类型参数不排第一（如 `fn f(a: i32, T:HasName, x: T)`）。
  → **[已决 · 走推荐]** 类型参数须在使用前声明（左到右解析）；可位于参数表任意位置（未必排第一），`fn f(a: i32, T:HasName, x: T)` 合法。
- **G3 无约束类型参数**：`fn f(T, x: T)`（T 无 `:Bound`）如何判定？建议：裸标识符参数 = 无约束类型参数。需确认。
  → **[已决 · 走推荐]** 裸标识符参数 = 无约束类型参数：`fn f(T, x: T)` 合法，T 在调用处推断。
- **G4（已决 · 2026-10-16）· generic struct 语法本次不实现**：用户明确——"更大范围的泛型书写支持"本次不实现（保留为未来扩展）；本次仅实现 generic 函数语法 `fn f(T:HasName, x: T)`。struct 泛型效果经「generic 函数 + 匿名结构体/元组（`.{T1,T2}` / `{x:T,...}`）」组合达成（t 已支持匿名元组类型与匿名结构体字面量）。**函数/struct 两套不一致为有意（struct 侧留待未来扩展），非遗漏。**
- （注：G1–G3、G5–G8 均针对**本次实现的 generic 函数语法** `fn f(T:HasName, x: T)`，已全部收口；G4 已决。）
- **G5 多约束 / 多类型参数**：多类型参数直白（`fn f(A:C1, B:C2, x:A, y:B)`）；但旧 `<T: A+B>` 的多 concept 约束在新语法下怎么写？`T: A & B` 还是 `T: A, T: B`？需定。
  → **[已决 · 2026-10-16]** 多约束 / 多类型参数的"**类型运算符**"本次不设计，保留为未来扩展（如 `T: A & B` 之类由未来 type operator 承载）；本次仅支持**单约束** `T:HasName` 与**多类型参数** `A:C1, B:C2`。
- **G6 方法接收者上的泛型**：`fn (self: *Box(T:HasName)) get() T {...}` 接收者如何表达 bound？需定。
  → **[已决 · 走推荐]** 方法接收者泛型沿用同款语法（接收者类型位置写 `T:HasName`）；同样**纯编译期、零运行时开销**（与下方 G6-principle 一致）。
- **G7 显式指定类型实参**：调用 `greet(p)` 靠推断；若需显式写出类型实参，语法是否变成 `greet[Person](p)` 或别的？需定。
  → **[已决 · 2026-10-16]** 类型实参**走类型推断**，不引入显式类型实参语法（如 `greet[Person](p)`）；即便显式写出仍需类型正确性校验，本质仍是推断。
- **G8 concept 名误作值参数类型**：新规则下 `fn f(c: HasName)` 会被判为"c 是类型参数"（因 HasName 是 concept、无运行时值），这本身无意义但自洽。属预期行为，需你知晓。
  → **[已决 · 走推荐]** 接受为预期行为：按 G1 判为类型参数（自洽）；concept 无运行时值，作值类型位置无意义但规则一致。
- **G9（新增 · 已决，2026-10-16）· 约束纯编译期、零运行时开销**：所有 concept 约束均在编译期完成校验——**无 vtable / 无类型信息 / 无动态派发 / 零运行时开销**；generic 函数单态化在编译期完成。本原则覆盖 G6（方法接收者泛型）等全部约束场景。

> 凡以上任一点与你的真实意图不符，即为「理解冲突」，请直接指出，我据以修订设计文档与示例。
