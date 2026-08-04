# 语法规则草稿 · 代码模块 / 插件系统（Module / Plugin）  [DRAFT]

> 依据：讨论结论（2026-08-04 修正版，用户澄清模块单位 = 文件 `xxx.tlib(d)`、`import xxx` 按名导入）+ `docs/reference.md` §3.6.1（数据导入为 `import_csv`/`import_json` 函数调用）+ 宪法 L-02/L-04/L-08/L-15。<br>
> **状态：已采纳（ADOPTED）** —— 经 L-15 四法评审（2026-08-04，用户指令「规则采纳 1」），并入 `docs/reference.md` §3.13；本稿自此失效，以 `reference.md` §3.13 为权威。

## 0. 现状与动机

- t 当前**无代码模块系统**：跨 `.tc` 文件的代码复用只靠 `tote` 在构建层拼装，语言层面没有 `export`/命名空间/可见性概念。
- 用户澄清：所谓「插件（plugin）」即代码模块；模块按**文件名**导入 `import xxx`，命名空间即 `xxx`。`xxx` 既可是本工程模块名，也可是外部插件名——差异只在解析来源，后续由未来 `tote.toml` 配置（搜索路径、源 vs 发布）。
- **库的最终输出内容（`.tlib`/`.tlibd` 里装什么字节）尚未讨论**，留作开放项（见 §8）。
- 裸 `import "x" as t;` 语句级语法已被 §3.6.1 的 `import_csv(...)`/`import_json(...)` **函数调用**取代（`decl_import.md` 已标记失效）。代码模块导入改用**标识符**形式 `import xxx`，与数据导入函数调用互不冲突。
- **扩展名取 `.tlib`/`.tlibd`（非 `.lib`/`.libd`）**：刻意避开 C 静态库/导入库的 `.lib` 扩展名（MSVC 尤甚），防止与 C 生态库文件撞名冲突。`.tlib` 是 **t 的原生中间库态**（由 `import` 直接消费、内部自描述），**可进一步导出为 C 兼容的静态库 `.lib` / 动态库 `.dll`**——`.lib`/`.dll` 此时是显式的 C 互操作产物，而非 t 的中间格式，二者各司其职、不再混淆（见 §11）。

## 1. 已拍板的设计分叉（2026-08-04 修正版）

| 分叉 | 决策 | 理由 |
|---|---|---|
| 模块单位 | 文件即模块，名 = 文件 stem `xxx`；物理形式 = 模块源码 `<xxx>.tc`（含 `export`、无 `main`）或其编译产物 `xxx.tlib`（rls）/ `xxx.tlibd`（dbg） | 与 gate `out/dbg`/`out/rls` 双通道对齐；插件即库产物 |
| 导入形式 | `import xxx`（按名，去扩展名） | 简洁、按文件名导入；`tote` 按构建模式选 `.tlib`/`.tlibd` |
| 解析策略（我定） | `import xxx` 先找编译产物 `xxx.tlibd`/`.tlib`（按模式），否则编译同仓源码 `<xxx>.tc`；都无则 `T_IMPORT_NOT_FOUND` | 用户委托我定；源流优先可开发、产物流可分发 |
| 默认可见性 | **默认模块私有**，跨模块可见须显式 `export` | 对齐 L-02 显式与最小权限 |
| 名称解析 | 命名空间 = 模块名 `xxx`，`xxx.foo` 访问 | 零碰撞、显式；可选 `as` 别名 |

## 2. EBNF（§1 Notation）

```ebnf
ModuleStem:     IDENTIFIER                          // 模块名 = 文件 stem，如 math
ModuleFile:     ModuleStem ".tc"                    // 模块源码（含 export、无 main），如 math.tc
ModuleArtifact: ModuleStem "." ("tlib" | "tlibd")   // 编译产物（插件形态），如 math.tlib / math.tlibd
ImportDecl:     "import" IDENTIFIER ("as" IDENTIFIER)? ";"   // import math; / import math as m;
ExportPrefix:   "export"                            // 前缀修饰顶层声明

TopDecl:     (ExportPrefix)? (FnDecl | StructDecl | EnumDecl | FlagDecl
                                | VariantDecl | TypeAlias | ConstDecl | VarDecl)
```

- `import` 后是**标识符**（模块名），非字符串路径；解析序见 §3（先产物后源码）。
- `as 别名` 可选；省略时命名空间 = 模块名 `xxx`。
- `export` 仅修饰**顶层**声明；修饰局部/嵌套 → `T_EXPORT_SCOPE` 错误。
- 模块源码 `.tc` 与程序 `.tc` 的区别：含 `export` 顶层声明、无 `main` 即视作库模块；`tote` 据此建图。

## 3. Where（约束）

- **模块名**：文件 stem = 模块名；`import xxx` 解析序（**我定，用户委托**）：
  1. 按构建模式找**编译产物**：`xxx.tlibd`（dbg）/ `xxx.tlib`（rls）→ 直接用（插件/预构建，最快）；
  2. 否则找**模块源码** `<xxx>.tc`（顶层带 `export`、无 `main`）于工程/搜索路径 → 编译进构建图；
  3. 都无 → 编译错误 `T_IMPORT_NOT_FOUND`。
- **调试变体**：`d` = debug，gate 调试构建（`out/dbg`）优先解析 `.tlibd`，发布构建（`out/rls`）优先解析 `.tlib`——与既有双通道一致，无额外概念。
- **可见性边界**：未标 `export` 的顶层符号模块外不可见（check 阶段按模块作用域隔离）；`export` 符号进入公共接口。
- **访问方式**：`import math;` → `math.add`；`import math as m;` → `m.add`。
- **依赖图**：`tote` 解析 `import` 边构成依赖图，要求**无环**；有环 → 编译错误 `T_IMPORT_CYCLE`（确定性构建 L-08）。
- **插件视角**：发布的 `.tlib`/`.tlibd` 即插件；`tote` 负责从注册表/本地 `tlib/` 解析并链接。语言层不区分「内部模块」与「外部插件」——同一套 `import` 机制；`xxx` 是库名，来源（本工程 / 外部）后续由 `tote.toml` 配置。

## 4. 示例

```t
// math.tc  (模块源码：含 export、无 main)
export fn add(a: i64, b: i64) -> i64 { return a + b; }
export fn sub(a: i64, b: i64) -> i64 { return a - b; }
fn ipart(x: f64) -> f64 { return x; }   // 私有，模块外不可见
// tote 编译后产出 math.tlib (rls) / math.tlibd (dbg) —— 可发布的插件形态

// ecs.tc
export struct Pos { x: f64; y: f64; }
export struct Vel { x: f64; y: f64; }
fn sys_step() {}                         // 私有

// main.tc  (程序入口)
import math;
import ecs;                 // 命名空间 = ecs

export fn run() -> i32 {
    var p: ecs.Pos = ecs.Pos{x: 1, y: 2};
    return i2s(math.add(1, 2));   // 经命名空间访问
}
```

- `import math;` 在开发期编译 `math.tc`；若 `math.tlib`/`math.tlibd` 已存在则直接用产物（快路径）。
- agent 模块天然契合：actor 脱糖产物 `XState` / `x_spawn` / `x_step` 标 `export` 后，可作为插件跨项目复用（消息回路边界）。

## 5. 与既有构造关系

- 与 §3.6.1 数据导入**正交**：代码走 `import xxx`（标识符），数据走 `import_csv/json(...)`（函数调用），语法语义均不冲突。
- 与 `tote` 包管理器互补：`import` 是语言层符号可见性；`tote` 是构建层依赖图解析/无环校验/双后端一致/变体选择（`.tlib` vs `.tlibd`）。
- 与 `.tc` 源文件：`.tc` 为程序/入口（含 `main`）；`.tlib`/`.tlibd` 为库/插件单元。「插件」即被 `import` 的 `.tlib`/`.tlibd`。

## 6. L-14 铁律校验预留

- 新增 check 阶段：模块作用域表、可见性裁剪、`T_EXPORT_SCOPE` / `T_IMPORT_NOT_FOUND` / `T_IMPORT_CYCLE` 诊断。
- `UNSUPPORTED` 计数门禁不受影响（纯 check/emit 改动，无新增内建调用）。

## 7. 合规判据（L-15 四法评审结论 · 2026-08-04）

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一确定语义 | ✅ | `import xxx` 为唯一代码导入写法（数据导入走 `import_csv/json(...)` 函数，不重名）；`export` 为唯一可见性开放写法；命名空间访问唯一 `xxx.foo`；选择性导入 `import {…} from` 首版明确不采纳，无等价多写 |
| L-02 全行为显式 | ✅ | 模块可见性须显式 `export`；`import` 显式按名导入；无隐式类型转换 / 布尔判定 / 内存分配 / 生命周期；`T_EXPORT_SCOPE` 显式报错 |
| L-03 静态类型 | ✅ | 模块公共接口（`.tlib` 接口块或源码 `export` 声明）编译期静态已知；importer `check` 只读接口即完成类型检查，无运行时类型歧义 |
| L-14 铁律校验 | ✅(原则) / ⚠️(门禁待落) | 已列新增 check 诊断 `T_EXPORT_SCOPE`/`T_IMPORT_NOT_FOUND`/`T_IMPORT_CYCLE`，`UNSUPPORTED` 门禁不受影响；conformance + 双后端 example 用例须在实现期补齐（见 §13） |
| L-15 §3 EBNF 记号 | ✅ / ⚠️(`<stem>` 记号) | 产生式用 `Name: Syntax` 冒号形式、`?`/`|`/`()`、字面量 `"..."`、非终结符大写，符合 §1；草稿所用 `<stem>` 元记号并入 reference.md 时须改规范非终结符 `ModuleStem`/`ModuleFile` |
| 13 铁律交叉 | ✅ / ⚠️(2 项) | 第1/2/3/4/5/10/11/12 条无冲突；第6条（双格式诊断）要求新增诊断同出 JSON（tc 已补 `print_json`，✅）；第8条（零 UB）要求跨模块 `var` 初始化顺序在 check 显式定义（⚠️）；第9条（ABI/版本契约）要求 `.tlib` 接口块版本/ABI 稳定契约在实现期明确（⚠️） |

**总裁定**：四法（L-04/L-02/L-03/L-14）全部 ✅ 通过；13 铁律无 ❌/🚫；⚠️ 项均为实现期精度 / 门禁补全，**不阻断规则级采纳**。

## 8. 开放问题 / 迁移

- **`.tlib`/`.tlibd` 格式（已定主体）**：单文件自描述容器 = 内嵌接口块（§10，确定性可读的 `export` 签名区，后端无关）+ 双后端代码块（C 的 `.c`+`.h` / LLVM 的 `.ll`）。不另产 `xxx.li`。剩余开放：**代码块在单文件内的具体编码**（文本分段？二进制容器？各后端代码如何共存/索引？），待与 `tote` 一并设计。
- **`tote.toml`（见 §12）**：模块声明、搜索路径、源 vs 发布、插件来源（本工程 / 外部注册表）、双后端与变体、C 导出开关等配置落点；`import xxx` 的来源解析由其驱动。已拟 schema（`[package]`/`[build]`/`[dependencies]`/`[modules]`/`[interop.c]`），与现有 `src/tote.tc` 的 `name`/`entry`/`deps` 兼容。
- **选择性导入**：本次未采纳 `import { foo, bar } from xxx;`（用户选命名空间别名）。保留为未来扩展。
- **循环依赖粒度**：首版按模块级无环；更细的符号级互相引用暂不支持。
- **未 export 的 `var` 初始化顺序**：跨模块 `var` 初始化仅由 `main` 所在模块触发，私有 `var` 不误拉取；需在 check 明确语义。
- **C↔t 反向（FFI）**：t 侧如何声明/引用外部 C 库（`extern fn`/FFI 机制）不在本草稿范围，待后续设计；`.tlib`→`.lib`/`.dll` 为单向导出，C 库反向入 t 另立议题。
- **迁移**：移除 `parse_import_decl` 旧 `import "data" as x;` 语句分支（已被 `import_csv/json` 函数调用取代），收编为 `import xxx` 标识符形式。

## 9. 插件（Plugin）视角小结

- 插件 ≡ 可发布/可链接的 `.tlib`（rls）/ `.tlibd`（dbg）库单元，由 `tote` 从模块源码 `<xxx>.tc` 编译产出。
- 语言层与内部模块**同一机制**：`import xxx` 不分内外，`xxx` 是库名；解析来源（本工程源码 / 外部已构建产物）由 `tote` 按搜索路径与 `tote.toml` 决定。
- 调试期优先 `.tlibd`（含调试信息、对齐 `out/dbg`），发布期优先 `.tlib`（对齐 `out/rls`）——零额外心智负担。
- 源码统一为 `.tc`；不新造源码扩展名。`.tlib`/`.tlibd` 是 t 原生编译产物/分发形态；需与 C 互操作时，`tote` 可将其进一步导出为 C 兼容的 `.lib`/`.dll`（见 §11）。

## 10. 库接口确定机制（importer 如何知道库内的数据/函数定义）[已定]

- **核心**：库内的数据/函数定义由模块的 `export` 声明决定。importer 只需**接口（签名）**，不需要函数体。编译模块时，`tote` 从 `export` 声明抽取接口元数据，内嵌进 `.tlib`/`.tlibd`。
- **`.tlib` 是单文件自描述容器（已定）**：一个 `.tlib`/`.tlibd` 内含两段：
  1. **接口块**（确定性、可读，类 C 的 `.h` / TS 的 `.d.ts`）：列出每个 `export` 符号的 ① 名字 ② 类别（`fn`/`struct`/`enum`/`flag`/`variant`/`const`/`typealias`）③ 完整类型签名（形参/返回/字段/变体/typealias 目标）。**未 `export` 的符号不进入接口** → 自然强制可见性边界（§3）。importer 的 `check` 只读这一段即可解析 `xxx.foo` 并类型检查。
  2. **代码块**：双后端产物（C 的 `.c`+`.h` / LLVM 的 `.ll`），链接时按 importer 所用后端选取。
- **不另产独立 `xxx.li`**（v1 决定）：内嵌接口块已足够让 importer 确定全部定义，契合「文件即模块」；人工/IDE 检视可后续由工具从 `.tlib` 提取，非语言层必需。
- **双后端**：接口块**后端无关**（纯类型/签名）；代码块后端相关，链接时按 importer 后端选取。现有 `out/` 已产 `.h`（C 接口）与 `.ll`（LLVM 接口），可作接口块与代码块来源。
- **回退**：无 `.tlib`/`.tlibd` 时，`import xxx` 走源码 `<xxx>.tc`，其 `export` 声明即接口（§3 解析序）。
- **确定性 (L-08)**：接口块按符号名排序、规范类型打印，可复现、双后端一致。

## 11. C 互操作导出（`.tlib` → `.lib` / `.dll`）[已定方向]

- **`.tlib` 是中间态，不是终点**：它专供 t 自己的 `import` 直接消费（接口块自描述 + 双后端代码块内嵌）。当要与 C / 其他语言互操作时，`tote` 可把 `.tlib` **导出/降级**为 C 生态产物，使 t 模块既能在 t 内 `import`，也能被纯 C 程序/链接器当普通 C 库用。
- **两类 C 产物**：
  - **静态库** `.lib`（MSVC）/ `.a`（类 Unix）：取 `.tlib` 代码块（C 后端的 `.c`+`.h` 或 LLVM 后端的 `.ll` 经目标码）经 `llvm-ar`/`ar` 归档；附带**生成的 C 头** `xxx.h`。
  - **动态库** `.dll`（Windows）/ `.so`（Linux）：以 `export` 符号经 C ABI 导出，生成 `xxx.h`（`extern "C"` 风格，供 C/其他语言 `#include` 后链接）。
- **C 头来源 = `.tlib` 接口块（§10）**：每个 `export` 符号映射为一条 C 声明（`fn`→函数、`struct`→`struct`、`enum`/`flag`→`enum`/`#define`、`typealias`→`typedef`），类型按 t↔C 映射规则翻译（如 `i64`→`int64_t`、`f64`→`double`、`string`→`char*`/`t_str*`）。接口块是**单一事实源** → 头可复现、与 `.tlib` 一致（L-08）。
- **导出表强制可见性**：动态库仅导出 `export` 符号；私有符号不进导出表 → 模块可见性边界在 C 侧同样生效（§3）。
- **调试信息**：`.tlibd`（dbg）导出的 `.lib`/`.dll` 携带调试信息（PDB / 调试段），对齐 `out/dbg`；`.tlib`（rls）导出物不带。
- **命名（C ABI）**：导出符号名默认带 `xxx` 命名空间前缀（`xxx_foo`）避免与其他 DLL 撞名；精确规则（前缀 vs 扁平、重整名策略）与 §8 代码块编码一并由 `tote` 定。
- **反向不强制**：C 库无需反向编译成 `.tlib`；t 侧引用外部 C 库走 `extern`/FFI 声明（超出本草稿范围，见 §8 开放项）。
- **合规**：导出路径不改 `import` 语义，纯属 `tote` 的额外产物；不引入新语言关键字，`UNSUPPORTED`/`L-15` 门禁不受影响。

## 12. 包清单 `tote.toml` 设计 [建议 schema]

> 现状：`src/tote.tc` 当前仅认 `[package]` 的 `name`/`entry`/`deps`（扁平字符串数组），parser 是行扫描级别。本 schema 在其上扩展，保留 `name`/`entry`/`deps` 兼容，新增 `[build]`/`[dependencies]`/`[modules]`/`[interop]` 子表；实现需 `tote` 升级为真正的 TOML 子表解析（建议引入小型 TOML 解析器，或复用 `tc` 的解析能力）。

### 12.1 字段

```toml
[package]
name    = "myapp"          # 包/程序名；也作默认导出符号前缀与插件名
version = "0.1.0"          # 语义化版本
entry   = "src/main.tc"    # 程序入口（含 main）；库包可省略或指向库根模块
# description / license / authors 可选

[build]
backend   = "llvm"         # llvm | c（双后端；缺省 llvm）
mode      = "rls"          # rls(发布) | dbg(调试)；可被 --mode 覆盖，决定 .tlib vs .tlibd
out_dir   = "out"          # 输出根，对齐 gate 双通道 (out/dbg | out/rls)
libs_dir  = "tlib"         # 本地模块/插件搜索目录（放 .tlib/.tlibd）
source_dir= "src"          # 本工程库模块源码根（放库模块 .tc）

[dependencies]             # 外部插件来源；驱动 import xxx 的外部解析
math = { version = "1.2.0", registry = "tote" }   # 从 tote 注册表解析 math.tlib
ecs  = { git = "https://github.com/x/ecs", rev = "a1b2c3" }
utils = { path = "../utils" }                      # 本地子仓，递归读其 tote.toml

[modules]                  # 本工程内部模块：名 -> 源码/产物（可选，缺省按名在 source_dir/libs_dir 自动发现）
"math"   = "src/math.tc"
"render" = "tlib/render.tlib"

[interop.c]                # 驱动 §11 的 C 互操作导出
enabled      = true
kind         = "both"      # static(.lib/.a) | dynamic(.dll/.so) | both
header       = "myapp.h"   # 生成的 C 头（接口块 §10 驱动）
symbol_prefix= "myapp"     # 导出符号前缀，避免 DLL 撞名；缺省 = package.name

[tests]                     # 一致性/合规测试（由 gate conformance 步骤执行）
dir     = "tests"
level   = "check"          # 仅类型检查，不生成代码
pattern = ["*.tc"]         # 通配 .tc 用例（p*/f* 为 check 级合规）

[examples]                  # 可运行示例（由 gate run_examples 双后端实跑比对）
dir             = "examples"
expected_suffix = ".expected.txt"
```

### 12.2 解析接线（`import xxx` 如何被 `tote.toml` 驱动）

`import xxx` 解析序（§3）每一步都由 `tote.toml` 提供上下文：
1. **预编译产物**：先查 `build.libs_dir`（`tlib/`）下 `xxx.tlibd`(dbg)/`xxx.tlib`(rls)。若 `xxx` 在 `[dependencies]`，tote 先从对应来源（registry/git/path）拉取/定位其产物。
2. **本工程源码**：查 `build.source_dir` 或 `[modules]` 显式映射下的 `<xxx>.tc`（顶层带 `export`、无 `main`）。
3. **都不在** `[dependencies]` 与本地模块表 → 编译错误 `T_IMPORT_NOT_FOUND`。
4. **依赖图**：`[dependencies]` + `import` 边合并成全局无环图（§3 `T_IMPORT_CYCLE`）。

### 12.3 与现有 parser 兼容

当前 `src/tote.tc` 仅识别 `entry` 与 `deps`（`deps = []` 扁平数组）。升级路径：保留 `deps` 作为 `[dependencies]` 的简写（数组元素视为 `{ name = "..." }`），新增子表解析；`entry`/`name` 语义不变。

### 12.4 设计要点

- `tote.toml` 是**唯一配置落点**：模块名→源/产物的映射、外部插件来源、双后端与变体选择、C 导出开关，全在此一处（对齐 L-02 显式、L-08 确定性）。
- 不引入新语言关键字（仍沿用 `import`/`export`），`tote.toml` 属构建层配置，不进语言语法。

### 12.5 测试与示例（`[tests]` / `[examples]`）

- `[tests]`：一致性/合规测试根目录（本工程 `tests/`，含 `conformance/`、`samples/`、`err_samples/`、`variant_smoke/`），`level = "check"` 表示仅类型检查、**不生成代码**（对齐 gate 的 conformance 步骤；conformance 只跑 check，不覆盖代码生成）。
- `[examples]`：可运行示例目录（本工程 `examples/`），每个 `.tc` 配同名 `.expected.txt`；`gate` 的 `run_examples` 步骤双后端（C/LLVM）实跑并比对期望输出。
- 二者均挂 `gate = "tools/gate.mjs"`，声明测试/示例与构建门禁的归属；不引入新语言关键字，不影响 `UNSUPPORTED`/`L-15` 门禁。

## 13. 评审结论（L-15 四法）

- **裁定**：经 L-15 第4条四法评审（2026-08-04，用户指令「规则采纳 1」），代码模块 / 插件系统的语法与语义 **通过**，准予规则级采纳并并入 `reference.md` §3.13；原草稿标记失效。
- **跟随项（实现期须完成，不阻断采纳）**：
  1. EBNF `<stem>` 元记号 → 并入 reference.md 时改规范非终结符 `ModuleStem`/`ModuleFile`（已完成）。
  2. 跨模块 `var` 初始化顺序语义在 `check` 显式定义（宪法第8条 零 UB）。
  3. `.tlib` 接口块 ABI / 版本稳定契约（宪法第9条）在实现期明确。
  4. conformance 用例（check 级）：`T_EXPORT_SCOPE`（export 修饰非顶层）、`T_IMPORT_NOT_FOUND`（模块不存在）、`T_IMPORT_CYCLE`（依赖成环）、私有符号跨模块不可见；双后端 example：`examples/module_demo.tc` + `.expected.txt`。落地后 L-14 门禁事实化。
- **未定开放项（非阻断，留待后续草案）**：`.tlib` 容器内代码块编码（§8）、C↔t 反向 FFI（§8）、选择性导入、符号级循环依赖。
- 本工程 `tote.toml` 已据此落地这两张表（§12 schema 的实例化）。
