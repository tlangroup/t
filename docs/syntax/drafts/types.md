# 语法规则草稿 · 类型文法（Types）  [DRAFT]

> 依据：`src/tc.tc` `parse_type`（L4819–L4878）+ `docs/reference.md` §3.5 / §2.10。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
Type: Scalar | ArrayType | SliceType | MapType | PointerType
    | OptionalType | FlagArrayType | NamedType | FuncType
Scalar: "u8" | "u16" | "u32" | "u64"
      | "i8" | "i16" | "i32" | "i64"
      | "f16" | "f32" | "f64" | "bool" | "void" | "string" | "StringBuilder"
ArrayType: "[" Expr "]" Type          // 定长数组 [N]T
SliceType: "[" "]" Type               // 切片 []T
MapType: "map" "[" Type "]" Type      // map[K]V
PointerType: "*" Type                 // 指针 *T
OptionalType: Type "?"                // 可选 T?
FlagArrayType: "flag" "[" Integer "]" // 位域数组 flag[N]
NamedType: Ident                      // 结构体/枚举/flag/variant/别名名
FuncType: "fn" "(" TypeList? ")" "->" Type   // 函数类型（✅ tote：函数指针 + 匿名函数字面量 M46 + 按值捕获闭包 M48）
TypeList: Type ("," Type)*
```

- 所有类型由 `parse_type` 单入口解析（L4819），无多入口歧义。
- 语义类型 `Sym32`/`Sym16`（字符串驻留符号）属命名类型（NamedType），运行时池分配（reference M40）。

## 2. Where（约束）

- **固定位宽标量**：全部整数/浮点为定宽（`u8`–`u64`/`i8`–`i64`/`f16`/`f32`/`f64`），无隐式宽度（对应宪法静态类型/引擎底层）。
- **无隐式转换**：类型间转换须显式（见 `expr_postfix.md` 的 `as`），`parse_type` 不接受隐式推导。
- `FlagArrayType` 的 `Integer` 为位宽（1bit 布尔位或 ≥2bit 数值位域，reference L842）。
- `FuncType` 已实装（✅ tote）：函数指针语义，顶层具名函数可绑定（reference §3.5）。
- 匿名函数字面量 `fn(Params) -> Ret { ... }` 亦产生 `FuncType` 值（M46 ✅ tote）：编译期提升为顶层函数 `__lam_N`；不引用外层局部时值即函数地址，零开销。
- 闭包按值捕获（M48 ✅ tote）：字面量引用外层局部/参数时，自动合成环境结构 `__env_N`、给 `__lam_N` 前置 env 首参、原位改写为堆分配 `TClosure{fn, env}`。捕获按值，环境不回收（v1）。被捕获的绑定须有显式类型标注，否则 `T_CLOSURE_CAPTURE`。
- 间接调用的被调者不限于标识符（M48）：任何静态类型为 `FuncType` 的表达式都可直接调用，含结构体字段、数组元素、调用结果（`make2(1)(2)(3)`）。

## 3. 示例

```t
x: i64;
buf: [256]u8;
items: []i32;
dict: map[string]i64;
p: *Vec3;
maybe: i32?;
flags: flag[bool];
fnt: fn(i64) -> void;   // ✅ tote 函数类型
```

## 4. 与既有构造关系

- 类型出现在声明（`decl_*.md`）与变量/参数/返回值中。
- `as T` 显式转换见 `expr_postfix.md`。
- `Sym32`/`Sym16` 为命名类型，字符串 `= "str"` 自动 intern（reference M40）。

## 5. L-14 铁律校验预留

- `parse_type`(类型解析) 已实现；标量表见 reference §2.10 ✅ tote。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 每种类型单一写法（数组 `[]T`/切片 `[N]T` 形态不同但语义不同，非等价） |
| L-02 显式 | ✅ | 无隐式类型，转换显式 `as` |
| L-03 静态类型 | ✅ | 全部定宽、静态可预判 |
| L-14 铁律校验 | ✅ | 已实现 |

## 7. L-04 张力

- `FuncType`（`fn(...) -> Ret` 作为类型）与 `decl_func.md` 的函数声明形态接近，但前者是「类型」后者是「声明」，不构成等价多写。
- 数组 `[N]T` 与切片 `[]T` 形态不同、语义不同（定长 vs 动态），非等价写法（L-04 ✅）。
