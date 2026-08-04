# 语法规则草稿：`fid` 文件描述符 与 `<` 序列化操作符

> **状态**：**已采纳（ADOPTED）** —— 经 L-15 采用，已于 2026-08-03 并入 `docs/reference.md` §3.9；本稿标记**失效**，以 `reference.md` §3.9 为权威。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 法律验证 → 采纳 → 并入 → 失效）。
> **作用对象**：① 新标量类型 `fid`（文件描述符句柄）；② 内建常量 `stdin` / `stdout` / `stderr`；③ 文件打开/关闭内建；④ **序列化操作符 `<`**，其输出格式由「打开方式 × 文件后缀」经**注册表**解析。
> **记号**：符合 `docs/reference.md` §1 Notation。

---

## 1. EBNF

```ebnf
// —— 类型 ——
// fid 加入标量类型集合，与 atom 同为 64 位不透明标量。
ScalarType:
    | "i8" | "i16" | "i32" | "i64"
    | "u8" | "u16" | "u32" | "u64"
    | "f16" | "f32" | "f64"
    | "bool"
    | "atom"
    | "fid"          // 新增：文件描述符句柄（64 位不透明）

// —— 内建常量（保留标识符，非关键字）——
// 词法上仍是 ident，由检查阶段按保留名解析为 fid 常量。
FidConst: "stdin" | "stdout" | "stderr"

// —— 序列化操作符 ——
// 词法记号复用既有 "<"（Lt）。句法上并入比较层，左结合。
// 语义由左操作数**静态类型**判定（见 §2 D1）：类型为 fid 即为序列化，否则为小于比较。
CmpExpr: ShiftExpr (CmpOp ShiftExpr)*
CmpOp: "<" | ">" | "<=" | ">="
```

脱糖后的内部节点（非可书写语法，仅为明确语义而列）：
`Binary{op:"<", lhs, rhs}` 当 `typeof(lhs) == fid` 时改写为 `Serialize{target: lhs, value: rhs}`，
其类型为 `fid`、其值为 `target`。

- **不新增任何词法记号**。`fid` 是类型名（与 `atom` 同类，非关键字保留字）；`<` 复用 `Lt`。
- `stdin` / `stdout` / `stderr` 为**保留标识符**：不可作为变量名、参数名、函数名、字段名重新声明，违者报 `T_FID_RESERVED_NAME`。

---

## 2. Where（编译期约束）

### D1 —— `<` 的语义由左操作数静态类型唯一确定（L-04 唯一语义）

- 左操作数静态类型为 `fid` ⇒ 该 `<` 是**序列化**，节点在检查阶段脱糖为内部 `serialize` 节点。
- 左操作数为其他类型 ⇒ 该 `<` 是**小于比较**，语义不变。
- **`fid` 无序**：`fid` 不参与 `<` / `>` / `<=` / `>=` 的比较语义，故不存在二义。`fid` 仅支持 `==` / `!=`。
  - 左操作数为 `fid` 且运算符为 `>` / `<=` / `>=` ⇒ 报 `T_FID_NOT_ORDERED`（`>` 保留给未来的反序列化操作符，见 §6）。
  - 右操作数为 `fid` 而左操作数不是 ⇒ 报 `T_FID_NOT_ORDERED`。

### D2 —— 结果类型 = 目标 fid，左结合可链式（L-03 静态类型）

`f < v` 的类型是 `fid`，值即 `f` 本身。因 `CmpExpr` 左结合，`stdout < a < b` 解析为 `(stdout < a) < b`，天然等价于「先写 a 再写 b」。链式不是额外规则，是结合性的自然结果。

### D3 —— 打开方式与格式解析（L-02 全行为显式）

```
fopen fn(path: string, mode: atom) -> fid
```

`mode` **必须是 atom 字面量**（编译期可判定），否则报 `T_FID_MODE_NOT_LITERAL`。合法取值：

| mode | 打开方式类别 | C 语义 |
|---|---|---|
| `:read` | text | `"r"` |
| `:write` | text | `"w"` |
| `:append` | text | `"a"` |
| `:read_binary` | binary | `"rb"` |
| `:write_binary` | binary | `"wb"` |
| `:append_binary` | binary | `"ab"` |

非上表取值报 `T_FID_BAD_MODE`（编译期，因 mode 是字面量）。

**格式解析在 `fopen` 时一次性完成并冻结进 fid 记录**，规则：取 path 最后一个 `.` 之后的后缀（小写，无 `.` 则视为空串），以 `(类别, 后缀)` 查注册表；未命中则用该类别的默认格式。

### D4 —— 后缀注册表（挂靠注册模式）

```
fmt_register fn(kind: atom, suffix: string, fmt: atom) -> void
```

- `kind` ∈ { `:text`, `:binary` }，`fmt` ∈ { `:text`, `:json`, `:rawbin`, `:protobuf` }。
  - 非 atom 字面量 ⇒ `T_FID_FORMAT_NOT_LITERAL`；取值不在白名单 ⇒ `T_FID_BAD_FORMAT`。
  - 与 `fopen` 的 mode 轴（`T_FID_MODE_NOT_LITERAL` / `T_FID_BAD_MODE`）**分开成码**，避免「格式非法」报成「打开方式非法」的误导定位。
- `suffix` 不含 `.`，大小写不敏感（内部统一小写）。
- 同 `(kind, suffix)` 重复注册 ⇒ **后注册覆盖先注册**，且注册是运行时行为（表在运行时维护），发生在调用点。
- 运行时初始化时预置下列**内建注册项**：

| kind | suffix | fmt | 说明 |
|---|---|---|---|
| `:text` | `json` | `:json` | 文本方式打开 `.json` ⇒ JSON 格式 |
| `:text` | *（默认）* | `:text` | 其余文本文件 ⇒ 文本格式 |
| `:binary` | `pb` | `:protobuf` | 二进制方式打开 `.pb` ⇒ protobuf |
| `:binary` | *（默认）* | `:rawbin` | 其余二进制文件 ⇒ 原始字节 |

- `stdin` / `stdout` / `stderr` 视为 text 类别、空后缀 ⇒ 格式恒为 `:text`。
- 查询：`fid_format fn(f: fid) -> atom`。

### D5 —— 各格式的写出语义（L-02 显式、L-09 零 UB）

`<` 的右操作数 v1 支持：整数标量（`i8`..`i64` / `u8`..`u64`）、`f32` / `f64`、`bool`、`atom`、`string`。其余类型报 `T_FID_UNSERIALIZABLE`（结构体 / slice / map 留待 v2 走 `type_info`）。

| fmt | 整数 | 浮点 | bool | atom | string |
|---|---|---|---|---|---|
| `:text` | 十进制 | 十进制 | `true`/`false` | 原子名（无引号） | 原样字节 |
| `:json` | 十进制 | 十进制 | `true`/`false` | `"名字"` | `"..."`（转义 `" \ \n \r \t` 与控制字符） |
| `:rawbin` | 定宽小端（按静态位宽） | IEEE754 小端（4/8 字节） | 1 字节 0/1 | 8 字节小端 id | `u64` 小端长度前缀 + 原始字节 |
| `:protobuf` | v1 未实装 ⇒ 运行时 `t_panic("protobuf serialization not implemented")` | 同左 | 同左 | 同左 | 同左 |

- **不隐式插入任何分隔符或换行**（L-02）。要换行显式写 `stdout < "\n"`。
- **不隐式类型转换**（L-02）：`f < 3` 写整数，`f < "3"` 写字符串，二者不等价。
- `:json` 是**纯值编码器**：每个右操作数各自编成一个 JSON 值，`<` 之间不插入任何结构字符。
  它**没有「原样输出」的口子** —— 写 `j < "["` 得到的是字符串值 `"["` 而不是数组开括号。
  故 v1 的 `:json` 无法拼出对象 / 数组文档；文档级结构留给 v2 的聚合序列化（`type_info` / `@derive`）。
  这是刻意取舍：给一个「原样写出」的旁路等于让同一个 `<` 有两种字节语义（违反 L-04）。

### D6 —— 生命周期与错误（L-02 / L-09）

- `fopen` 失败返回**无效句柄**；用 `fid_is_open fn(f: fid) -> bool` 显式检测。无隐式异常、无隐式重试。
- 对无效句柄或已关闭句柄执行 `<` / `fclose` / `fflush` ⇒ 运行时 `t_panic`（确定性中止，非 UB）。
- `fclose fn(f: fid) -> void` 幂等性：**不幂等**，重复关闭 panic（显式优于宽容）。
- 关闭 `stdin` / `stdout` / `stderr` ⇒ 运行时 `t_panic`。
- **无自动关闭**：句柄不随作用域回收，必须显式 `fclose`。
- ⚠️ 与 `defer` 配合时注意两点（实测于 M51）：
  1. `defer` 后面**必须跟块**（`DeferStatement: "defer" Block`），`defer fclose(f);` 是**语法错误**，须写 `defer { fclose(f); }`。
  2. `defer` 是**函数级**而非块级 —— 写在 `if` / `while` 块内的 defer 仍在**函数退出**时才按 LIFO 触发。
     故「打开→写→读回校验」这类需要在块内落盘的场景**不能靠 defer**，必须显式 `fclose(f);`。
     defer 只适合「句柄生命周期 == 函数生命周期」的情形。

---

## 3. Examples

```t
// 链式写出：`<` 返回目标 fid，故 f < a < b 左结合地落成嵌套调用，无临时量
row fn(f: fid, k: string, v: i64) -> fid {
    return f < k < "=" < v < "\n";
}

main fn() -> i64 {
    // 标准流：格式恒为 :text
    stdout < "hello " < "world" < "\n";
    stdout < "n=" < 42 < " ok=" < true < " " < :ready < "\n";

    // fid 可作形参 / 返回值；返回值也能当左操作数
    row(row(stdout, "a", 1), "b", 2);

    // 文本文件 → :text（无挂靠的后缀走类别默认格式）
    var f: fid = fopen("out.txt", :write);
    if (fid_is_open(f)) {
        f < "line1\n" < "pi=" < 3.5 < "\n";
        fclose(f);              // 块内要落盘就显式关，defer 是函数级的（D6）
        print(file_read_all("out.txt"));
    }

    // .json 后缀 + 文本方式 → :json（纯值编码器，见 D5）
    var j: fid = fopen("out.json", :write);
    if (fid_is_open(j)) {
        j < "he said \"hi\"\n";   // → "he said \"hi\"\n"（整体是一个 JSON 串）
        j < 12 < true < :ready;   // → 12true"ready"（不插分隔符，见 D5）
        fclose(j);
    }

    // 二进制方式 + 非 pb 后缀 → :rawbin
    var b: fid = fopen("out.dat", :write_binary);
    if (fid_is_open(b)) {
        b < 1000 < 3.5 < "abc";     // 8B LE + 8B f64 + (8B len + 3B) = 27 字节
        fclose(b);
    }

    // 注册模式：把 .ndjson 也挂到 json 格式上（后注册覆盖先注册）
    fmt_register(:text, "ndjson", :json);
    var n: fid = fopen("log.ndjson", :write);
    if (fid_is_open(n)) {
        defer { fclose(n); }        // 句柄活到函数结束，这时 defer 才合适
        println(atom_str(fid_format(n)));   // json
    }
    return 0;
}
```

> ⚠️ `defer { fclose(f); }` 与显式 `fclose(f)` **不可并用** —— `fclose` 不幂等，重复关闭 panic（D6）。

---

## 4. 与既有构造的关系（L-04 论证）

| 既有构造 | 是否重叠 | 裁决 |
|---|---|---|
| `file_write_all(path, content) -> bool` | 部分 | **保留**。它是「一次性整文件覆盖写」，无句柄、无格式解析、无增量。与 fid 的增量写出语义不同，不构成等价多写法。 |
| `print` / `println` / `eprint` | 部分 | **保留**。它们只接受 `string` 且带/不带换行语义固定，是 `stdout < s` / `stderr < s` 的**特化便捷式**。⚠️ 待评审：若判定为等价多写法，则应把 `print(s)` 定义为 `stdout < s` 的语法糖并在文档中如此表述，而非各自独立语义。 |
| `<` 小于比较 | 否 | 由 D1 静态类型判定，`fid` 无序，语义唯一。 |
| `atom` | 否 | fid 复用 atom 作 mode / 格式标记，是**使用**而非重叠。 |

---

## 5. 法律验证

| 法律 | 验证点 | 结论 |
|---|---|---|
| L-04 唯一语义 | `<` 的双语义由静态类型唯一判定；`fid` 无序故无二义；`print` 重叠已裁决（A 口径，糖文档化，§7.10） | ✅ |
| L-02 全行为显式 | 无隐式换行 / 分隔符 / 类型转换 / 自动关闭；错误须显式 `fid_is_open` | ⏳ 待评审 |
| L-03 静态类型 | `fid` 固定 64 位；`<` 结果类型固定为 `fid`；mode / fmt 须字面量，编译期可判定 | ⏳ 待评审 |
| L-09 零 UB | 无效句柄、重复关闭、未实装格式一律确定性 `t_panic` | ⏳ 待评审 |
| L-14 铁律校验 | conformance 用例（类型 / 诊断）+ examples 双后端实跑比对 | ✅ 已实装（见 §5.1） |
| L-04 唯一语义（读路径） | `>` 读操作符消歧锚点 = 左操作数为 fid（与 `<` 同锚点、与 D1 一致），右操作数强制为类型；`print` 重叠裁决（§7.10） | ✅（§7.1 采纳，实装排期 v1.5） |
| L-09 零 UB（读路径） | EOF / 解析失败一律返回 `T?` 的 null，不 panic；定位错误用返回值表达 | ✅（设计见 §7.1 / §7.5） |

### 5.1 实装校验记录（M51）

| 项 | 结果 |
|---|---|
| conformance | 65/65（`p24_fid_ok` + `f34`..`f40` 七条诊断用例） |
| 诊断码覆盖 | `T_FID_RESERVED_NAME` / `T_FID_NOT_ORDERED` / `T_FID_MODE_NOT_LITERAL` / `T_FID_BAD_MODE` / `T_FID_FORMAT_NOT_LITERAL` / `T_FID_BAD_FORMAT` / `T_FID_UNSERIALIZABLE` |
| examples | `examples/fid_demo.tc` + `.expected.txt`，LLVM / C 双后端输出逐字节一致 |
| 自举 | 不动点达成；dbg 与 rls 两档编译器发射的 `src/tc.tc` IR 逐字节相同 |
| gate | L2 13/13 全绿（含四代不动点、C 后端自举、tc0 外部对拍） |

---

## 6. 未来扩展（本稿不实装，仅占位以免语法冲突）

- **`>` 反序列化操作符**：`stdin > T`（从 fid 读入并按格式解析），消歧锚点 = 左操作数为 fid（与 `<` 同锚点、与 D1 一致），不再预留报错。**设计补全见 §7.1。**
- **结构体 / slice / map 序列化**：走 `@derive(BinarySerde)` 已生成的 `serialize`/`deserialize`，v2 接通 `<`/`>`。**设计补全见 §7.6。**
- **自定义格式注册**：`fmt_register` 目前只能把后缀重挂到**内建**格式上；注册用户自定义序列化函数需要 FuncType 化的 writer 接口，v2。
- **protobuf**：需要 schema 绑定（`@pb` 注解？），v2。
- **定位 / 随机访问**：`fseek`/`ftell`，v1.5/v2，见 §7.5。
- **打开失败原因**：`fid_error`，见 §7.2。
- **缓冲语义**：stdio 缓冲与 `fflush` 行为，runtime 已落地，文档补全见 §7.4。

---

## 7. 遗漏之点与设计补全（v1.5 / v2 规划）

> 本节补全 M51 草案未覆盖的设计面。带 ✅ 者表示运行时/编译器已具备落地基础（见 §7.11 标注），带 ⏳ 者表示本稿提出设计、待裁定与实装。除特别说明外，本节内容**不实装于 v1**，仅占位以免后续语法冲突。

### 7.1 读路径（反序列化）—— `>` 操作符设计 ✅（已采纳，实装排期 v1.5）

`<` 已在 v1 落地「写」。与之对称，**读**必须由 `>` 承担（草稿 §6 已预留 `fid >` 报错位），否则 `<`/`>`  asymmetry 违反 L-04（同一逻辑只有一种写法）。

**语法（与 `<` 同优先级塔，并入 `CmpExpr` 层）：**

```ebnf
// 复用 ">" 记号。消歧锚点 = 左操作数静态类型（与 D1 对 "<" 的判定完全对称）：
//   左操作数为 fid  ⇒ ">" 是反序列化（读），右操作数必须是类型；
//   左操作数非 fid  ⇒ ">" 是大于比较（右操作数须为有序类型）。
FidRead: FidValue ">" TypeExpr
```

- `TypeExpr` 取受限子集：标量 | 命名类型 | 数组 `[N]T` | 切片 `[]T` | map | 指针 `*` | optional `T?`。**不含函数类型**。
- **消歧按左操作数类型，不看右操作数**（与 D1 一致——`<` 也是靠左操作数定语义）：`fid` 无序，故 `fid > x` 永远不可能是「大于比较」，它只能表示反序列化。于是 `f > i64` 与 `f > 3` 都先被判为「读」，区别只在右操作数是否合法：`i64` 是类型 ⇒ 正常读出；`3` 是值而非类型 ⇒ 报 `T_FID_DESERIALIZE_NEEDS_TYPE`（不再退化为大于比较）。
- 因此**不存在类型名/值名歧义**：右操作数被强制要求为类型，写出非类型的 ident 直接报错，无需 `T_FID_READ_AMBIGUOUS` 一类兜底。复杂泛型等任意合法类型表达式直接写作 `f > T` 即可（L-04 唯一写法，**不另设 `fread` 内建**）。
- **结果类型 = `TypeExpr`**，但为可表达 EOF，**返回 `T?`（optional）**：读到值 ⇒ 非 null；EOF / 解析失败 ⇒ `null`（L-09 零 UB，不 panic）。故 `f > i64` 的类型是 `i64?`。
- ⚠️ **采纳 §7.1 时须同步修订 D1**：D1 当前把「`fid` 且 `>`」报 `T_FID_NOT_ORDERED` 预留；采纳后该项改为「`fid > type` = 反序列化」，`<=`/`>=` 仍报 `T_FID_NOT_ORDERED`。

**各格式读语义（与 D5 写语义镜像）：**

| fmt | 读一个值的行为 |
|---|---|
| `:text` | 按空白切分下一个 token，按目标类型解析（整数/浮点/bool/`true`/`false`/atom 名/裸字符串）。`:json` 格式下的 `:text` 读取不合法，报 `T_FID_READ_FMT_MISMATCH`。 |
| `:json` | 解析流中下一个 JSON 值（数字/字符串/布尔/null），按目标类型收口；结构型目标（对象/数组）⇒ v2。 |
| `:rawbin` | 按目标静态位宽读定宽小端字节；`string` 先读 `u64` 长度前缀再读裸字节。 |
| `:protobuf` | v2（需 schema 绑定）。 |

**示例：**

```t
main fn() -> i64 {
    var f: fid = fopen("data.txt", :read);
    if (fid_is_open(f)) {
        defer { fclose(f); }
        var n: i64? = f > i64;        // 读一个 i64，EOF 时 n == null
        if (n != null) { print(i2s(n)); }
        var s: string? = f > string;  // 读下一个空白分隔 token
    }
    return 0;
}
```

### 7.2 打开失败的可观测性 —— `fid_error` ⏳

v1 仅能靠 `fid_is_open(f)` 的 bool 判断成败，拿不到**原因**（路径不存在 / 权限 / 目录 / 设备忙）。调试与健壮程序都缺一环。

- 新增内建 `fid_error fn(f: fid) -> string`，**走系统函数（与 `fid_is_open` 同归口）**：编译器侧登记为内建，发射期直接调用运行时 `t_fid_error(f)`（C）/ `@tll_fid_error(i64)`（LLVM），字符串返回值按既有 `TStr` 约定（与 `atom_str` 同）带回。fid_error 查的是 runtime 内部状态，**不可能是编译器内联计算的 intrinsic**，必落系统函数。
- 语义：返回该句柄最近一次错误的可读描述，无错误返回空串 `""`。**不改 `fid` 标量契约**（仍是 64 位句柄），错误走旁路查询，符合 L-02（显式、无隐式异常）。
- **运行时改动（runtime/t_runtime.c）**：
  1. `TFidRec` 新增 `err` 字段（如 `char err[128]` 或 `TStr err`）；`t_fopen` 失败时把原因（路径 / 权限 / 目录 / 表满）写入 `g_fids[slot].err`；`fclose`/`fflush`/`<`/`>` 的 panic 路径亦在 `t_fatal` 前写入。
  2. 新增 `t_fid_error(int64_t f) -> TStr`：对越界 / 未打开的槽位返回空串（**不 panic**——查询失败本身不是程序 bug，符合 D6/L-09），否则返回 `g_fids[f].err`。
  3. 同步新增 LLVM `tll_fid_error`。
- **编译器登记（src/tc.tc，仿 `fid_is_open`）**：在 ① 类型表（返回 `String`）② C 发射（→ `t_fid_error(...)`）③ LLVM 发射（→ `call %TStr @tll_fid_error(i64 ...)`，按 TStr 约定接返回值）④ LLVM declare 四处补 `fid_error` 分支。

```t
var f: fid = fopen("missing.txt", :read);
if (fid_is_open(f) == false) {
    eprint("open failed: " < fid_error(f) < "\n");   // 显式取原因，走系统函数
}
```

**验证用例（实装时对齐门禁）：**

- **检查期 conformance（类型 / 诊断，仿 `p24` / `f34`..`f40` 命名约定）**：
  - `tests/conformance/pass/p25_fid_error_ok.tc`（`// EXPECT: pass`）：`fid_error` 类型可判定——接收 `fid`、返回 `string`、结果可传入 `eprint` / `stdout <`；并演示 `fopen` 失败后用 `fid_error` 取原因。
  - `tests/conformance/fail/f41_fid_error_arg.tc`（`// EXPECT: error T_FID_ERROR_ARG`）：对 `fid_error` 传入非 `fid` 实参（如 `fid_error(42)`）⇒ 报 `T_FID_ERROR_ARG`（**新增诊断码**，归 fid 轴，与 `T_FID_*` 同族）。
- **运行期 run_examples（行为，双后端实跑 + `.expected.txt`，conformance 只过 check 覆盖不到返回值语义）**：
  - 新增 `examples/fid_error_demo.tc` + `examples/fid_error_demo.expected.txt`，覆盖两件事：
    1. `fopen("不存在的路径", :read)` 失败 ⇒ `fid_is_open(f)==false` 且 `fid_error(f)` 返回**非空**可读原因（路径 / 权限等），不 panic。
    2. 对**未打开 / 越界**的 fid 调用 `fid_error` ⇒ 返回空串 `""`、**不 panic**（验证 L-09 零 UB，与 §7.2 运行时改动第 2 条一致）。

### 7.3 句柄容量与生命周期实限 ✅（已在 runtime 落地，草案漏记）

- runtime 句柄表 `g_fids[T_FID_MAX]`，**`T_FID_MAX = 256`**（`runtime/t_runtime.c:724`）。0/1/2 恒为 stdin/stdout/stderr，可分配槽位 3..255，故**用户同时最多打开 253 个文件句柄**。
- `t_fopen` 在表满时 `t_fatal("fopen: 文件描述符表已满")` 并返回 -1（与「打开失败」同一失败表象，靠 `fid_is_open` 探测）。D6 应补此条：**句柄数量受硬上限约束，长生命周期批量打开需自行 `fclose` 回收，无自动 GC。**
- 句柄记录 `TFidRec` 含 `fp / fmt / binary / open / is_std / suffix[16]`；`fid_get(f)` 对 `f<0 || f>=T_FID_MAX` 或 `!open` 一律 `t_fatal`（确定性中止，落实 D6 的「无效句柄 panic」）。

**验证用例（运行期 run_examples，容量是 runtime 硬限，检查期不可测）：**
- `examples/fid_capacity_demo.tc` + `.expected.txt`：循环 `fopen` 唯一临时路径直到表满（上限 253 个用户句柄），断言第 254 次 `fopen` 所得句柄 `fid_is_open==false`（表满，与打开失败同一表象）；随后 `fclose` 回收若干后再开可成功。注：该例会创建大量临时文件，须在测试目录内清理；亦可退化为「断言可分配槽位数 == 253」的轻量版。
- 检查期无可测项（容量非编译期约束），不列 conformance。

### 7.4 缓冲与 fflush 语义 ✅（runtime 行为，草案漏记）

- 句柄底层是 C `FILE*`（stdio），**写默认经 stdio 缓冲**：`<` 写入不保证立即落盘，直到 `fflush(f)` / `fclose(f)` / 进程退出。
- 因此必须显式说明：
  1. **读写回环**：先 `<` 写完再 `fopen` 同路径以 `:read` 打开读回，必须先在写句柄上 `fclose`（或 `fflush`）否则读不到内容。
  2. **stdout / stderr 交织**：二者各自缓冲，混用 `print` 与 `stdout <` 时顺序由缓冲刷新时机决定；需严格顺序时中途 `fflush(stdout)`。
  3. `fflush(stdin)` 语义无定义（输入流 flush 无意义），建议实现忽略或报 `T_FID_NOT_ORDERED` 同类诊断，待裁定。

**验证用例（运行期 run_examples，缓冲是 runtime 行为）：**
- `examples/fid_buffer_demo.tc` + `.expected.txt`：演示「读写回环须先 flush/fclose」——先对 `out.tmp` 以 `:write` 写入若干字节，**不** `fclose` 就同路径 `:read` 打开读回 ⇒ 读到内容为空/截断（证明写未落盘）；补 `fclose` 后重读 ⇒ 读到完整内容。`.expected.txt` 对比两段读出结果。
- stdout / stderr 交织属缓冲时机决定、输出顺序非确定，难以在 `.expected.txt` 中断言；仅作文档声明（7.4 第 2 条），不列确定性用例。
- 检查期无可测项，不列 conformance。

### 7.5 定位 / 随机访问（fseek / ftell）⏳

v1 是**纯顺序流**，无 `fseek`/`ftell`。许多二进制格式（索引、分块）需要定位，列为 v1.5 / v2：

- `fseek fn(f: fid, off: i64) -> bool`：成功返回 `true`，非法偏移（负 / 越界）或不可定位句柄（stdin/stdout/stderr/管道）返回 `false` 并写 `fid_error`。
- `ftell fn(f: fid) -> i64`：返回当前偏移；不可定位句柄返回 -1。
- 与 D6 一致：**不 panic**，用返回值表达失败（定位错误不像「写无效句柄」那样属于程序 bug，而是可预期的 I/O 条件）。

**验证用例（⏳ 待实装；命名仿 `p24` / `f34`..`f40`，续编 p26 / f42）：**
- 检查期 conformance：
  - `tests/conformance/pass/p26_fid_seek_ok.tc`（`// EXPECT: pass`）：`fseek` 收 `fid`+`i64` 返 `bool`、`ftell` 收 `fid` 返 `i64`，类型可判定、可调用。
  - `tests/conformance/fail/f42_fid_seek_arg.tc`（`// EXPECT: error T_FID_SEEK_ARG`）：对 `fseek`/`ftell` 传非 `fid`/非 `i64` 实参 ⇒ 报 `T_FID_SEEK_ARG`（**新增诊断码**，归 fid 轴）。
- 运行期 run_examples：
  - `examples/fid_seek_demo.tc` + `.expected.txt`：写定长字节后 `fseek(f, 0)` 回到起点、`ftell(f)==0`；`fseek` 到非法偏移（负 / 越界）于普通文件返 `false` 且 `fid_error` 非空；`fseek`/`ftell` 作用于 `stdout` ⇒ 分别返 `false`/`-1`（不 panic，验证 D6/L-09）。

### 7.6 聚合类型序列化与 `@derive` 衔接（v2，部分预接线）⏳✅

`src/tc.tc` 的 `process_derive` 在 `@derive(BinarySerde)` 时**已生成** `serialize fn(self) -> []u8` 与 `deserialize fn(data: []u8) -> S`（`src/tc.tc:13017`/`13048`）。但 v1 的 `<` 只接标量（D5），struct/slice/map 报 `T_FID_UNSERIALIZABLE`。v2 衔接方案：

- **写**：当 `<` 的右操作数静态类型是「带 `@derive(BinarySerde)` 的 struct/enum/flag/variant」时，脱糖为 `f < value.serialize()` —— 即先取 `[]u8`，再按 `:rawbin` 长度前缀（u64 + 裸字节）写出。
- **读**：`f > S`（S 为聚合类型）⇒ 先 `f > []u8`（读长度前缀 + 字节）⇒ 调 `S.deserialize(bytes)` 还原，返回 `S?`（EOF/null 时 null）。
- **文本侧**：`@derive(ToString)` / `@derive(FromString)` 可分别作为 `:text` / `:json` 下结构体标量式序列化的后端（每个字段按 D5 逐值写出 / 读回），用于「人类可读」而非二进制定宽场景。
- 此衔接把既有的 `@derive` 生成物与 fid 操作符连成闭环，是 v2 聚合序列化的主路径；protobuf 仍需 schema 绑定注解（⏳）。

**验证用例（v2 接通 `<`/`>` 后启用，续编 p28 / f44）：**
- `tests/conformance/fail/f44_fid_serde_missing_derive.tc`（`// EXPECT: error T_FID_UNSERIALIZABLE`）：不含 `@derive(BinarySerde)` 的 struct 经 `f < s` 写出 ⇒ 仍报 `T_FID_UNSERIALIZABLE`（**既有 D5 诊断码**，本用例为 v1→v2 迁移的回归护栏，确保未 derive 不漏网）。
- `tests/conformance/pass/p28_fid_serde_ok.tc`（`// EXPECT: pass`）：含 `@derive(BinarySerde)` 的 struct 经 `f < s` 写出、`f > S` 读回，类型可判定（v2 实装后由 ⏳ 升 ✅；v1 下暂预期 fail，故本用例在 v2 分支才进 CI）。
- 运行期 run_examples（v2）：`examples/aggregate_serde_demo.tc` + `.expected.txt`：写 struct → 关闭 → 重开读回，断言字节往返一致（长度前缀 + 字段按 `@derive` 顺序）。覆盖 `@derive(BinarySerde)` 主路径与枚举/flag/variant 子类型。

### 7.7 字符编码约定 ⏳

- `:text` 与 `:rawbin` 对字节**透明**：`string` 源即 UTF-8（t 字符串本就是 UTF-8），写入原样字节，不做编码校验或转换。
- `:json` 写路径转义 `" \ \n \r \t` 与控制字符（D5 已规定）；**读路径**应对称地拒绝非法 UTF-8 转义序列，越界 `\u` 序列报 `T_FID_JSON_BAD_ESCAPE`（v2 读落地时实装）。
- 草案未声明「输入假定 UTF-8」：补充一条 **L-02 显式约定**——所有文本路径假定 UTF-8，非 UTF-8 输入的行为未定义（不保证 panic，也不保证正确），由调用方保证。

**验证用例（运行期为主，续编 example）：**
- 运行期 run_examples：`examples/fid_json_escape_demo.tc` + `.expected.txt`：经 `:json` 写出含 `" \ \n \r \t` 与控制字符的字符串，断言转义序列与 D5 一致（**写路径已落地**，可作 v1 回归）；读路径拒绝非法 UTF-8 转义（`T_FID_JSON_BAD_ESCAPE`）属 v2 读落地范畴，本用例预留读回断言。
- 检查期 conformance：无（编码透明为运行期字节事实，类型系统无从断言；仅以文档声明约束）。

### 7.8 并发与线程安全（单线程前提）✅（无需实装）

- t 当前无并行构造（L-13 coroutine/parallel 待规划），故 `g_fids` 表与 stdio 缓冲均**非线程安全**。草案补一句：**fid 句柄与全局句柄表假定单线程访问**；并行模型落地后需加锁或改为每线程句柄空间，届时另立子条款。

**验证用例：** 无（纯静态前提声明，无类型可判点或运行期确定行为；待 L-13 并行规划触发时再立子条款与对应线程安全门禁）。

### 7.9 全局 fid 变量 ⏳

- `fid` 是运行时句柄（来自 `fopen` 调用），**不可作为全局/常量变量的静态初始化器**（`var g: fid = fopen(...)` 非法，因全局初始化器须编译期可定）。
- 允许 `var g: fid;` 声明（运行期赋值），但须在使用前 `fid_is_open` 校验。草案 §2 应补此静态约束，避免「全局句柄未初始化即 `<`」的静默 UB。

**验证用例（检查期 conformance 为主，续编 p27 / f43）：**
- `tests/conformance/fail/f43_fid_global_init.tc`（`// EXPECT: error T_FID_GLOBAL_INIT`）：顶层 `var g: fid = fopen("x", :write);` ⇒ 报 `T_FID_GLOBAL_INIT`（**新增诊断码**，因全局初始化器须编译期可定，fid 来自运行期 `fopen`）。
- `tests/conformance/pass/p27_fid_global_decl.tc`（`// EXPECT: pass`）：`var g: fid;`（仅声明、运行期赋值）合法；在 `main` 内 `fopen` 赋给 `g` 并经 `fid_is_open(g)` 校验后使用，类型可判定。
- 运行期 run_examples（可选）：`examples/fid_global_demo.tc` + `.expected.txt`：全局 `var g: fid;`，`main` 中赋值并使用，验证「声明合法、静态初始化非法」的边界行为。

### 7.10 `print` / `println` 与 `<` 的 L-04 重叠裁决（已裁定 A 口径）✅

§4 将 `print`/`println` 列为「待评审」。鉴于 `print(s)` 与 `stdout < s`、`println(s)` 与 `stdout < s < "\n"` 字节语义完全等价，L-04（唯一语义）要求消除等价多写法。**已裁定（A 口径）**：`print`/`println`/`eprint` 仍只接受 `string`（与 `tc.tc:8662` 现有检查一致），糖仅作文档化表述，不改变任何运行期行为；`print(x)` 对非 string 仍报类型错（对应 f45 的 `T_FID_PRINT_ARG`）。

**建议裁决**：将 `print` / `println` 明确定义为 `<` 的**文档化便捷语法糖**而非独立语义：

```
print(s)   ≡  stdout < s
println(s) ≡  stdout < s < "\n"
eprint(s)  ≡  stderr < s
```

- 优势：保留常用短名、消除重叠、`<` 成为唯一字节语义源（L-04 满足）。
- 代价：`print` 仅接受 `string`（与现在一致）；要写非字符串须显式 `to_string`/`int_to_str` 后 `print`，或改用 `stdout <`。
- 该裁决**不改变任何运行期行为**（v1 已是如此），仅把文档表述从「独立便捷式」改为「语法糖」，使 §4 法律验证 L-04 行可由 ⏳ 升 ✅。

**验证用例（采纳即生效，续编 p29 / f45）：**
- `tests/conformance/fail/f45_fid_print_nonstring.tc`（`// EXPECT: error T_FID_PRINT_ARG`）：`print(42)` 传非 `string` ⇒ 报 `T_FID_PRINT_ARG`（**新增诊断码**，继承「仅接受 string」约束，与 `tc.tc:8662` 现有 `T_TYPE_MISMATCH` 检查同源；糖化不改变此约束）。
- `tests/conformance/pass/p29_fid_print_sugar.tc`（`// EXPECT: pass`）：`print(s)` / `println(s)` / `eprint(s)` 经 `<` 糖脱糖后类型可判定（string 入参合法，与 `stdout < s` 同判）。
- 运行期 run_examples：`examples/print_sugar_demo.tc` + `.expected.txt`：分别用 `print(s)` 与 `stdout < s`、`println(s)` 与 `stdout < s < "\n"` 输出同一内容，断言 stdout 字节完全一致（直接验证 L-04 等价消除；因比对的就是 stdout，此用例天然适配 run_examples 双后端比对）。

### 7.11 落地基础标注汇总

| 条目 | 基础 | 说明 | 验收用例（续编命名） |
|---|---|---|---|
| 7.1 `>` 读 | ✅ 已采纳 | 实装排期 v1.5（runtime 读路径） | （设计见 §7.1） |
| 7.2 `fid_error` | ⏳ | 走系统函数（仿 `fid_is_open`：`t_fid_error`/`tll_fid_error`）；需 runtime 加 `err` 字段 | p25 / f41 / fid_error_demo |
| 7.3 容量上限 | ✅ runtime `T_FID_MAX=256` | 仅需补进 D6 文档 | fid_capacity_demo（run_examples） |
| 7.4 缓冲/fflush | ✅ runtime stdio 缓冲 | 仅需补进 D6 文档 | fid_buffer_demo（run_examples） |
| 7.5 seek/tell | ⏳ | v1.5/v2 | p26 / f42 / fid_seek_demo |
| 7.6 聚合序列化 | ✅ `@derive(BinarySerde)` 已生成 ser/deser | v2 接通 `<`/`>` 即可 | p28 / f44 / aggregate_serde_demo（v2） |
| 7.7 编码 | ⏳ | 文档声明为主 | fid_json_escape_demo（run_examples） |
| 7.8 单线程前提 | ✅ 无需实装 | 静态前提声明 | 无（待 L-13 触发） |
| 7.9 全局句柄 | ⏳ | 需 checker 静态约束 | p27 / f43 / fid_global_demo |
| 7.10 print 糖（A 口径） | ✅ 已裁定 | 文档表述调整，print 仍只接 string | p29 / f45 / print_sugar_demo |

---

## 8. 采纳状态

**已采纳（ADOPTED）。** 于 2026-08-03 经 L-15 采用，整节并入 `docs/reference.md` §3.9（含 D1 之 `>` 修订、`§7` 设计补全），本稿自此失效，以 `reference.md` §3.9 为权威。
