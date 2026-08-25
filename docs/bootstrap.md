# t 语言编译器自举设计文档（bootstrap.md）

> 版本：v1.0（2026-07-28）；Stage 2 自举判据于 2026-08-11 修订为 gate L2 三件套（见 §4.1）；信任根模型于 2026-08-12 明确为 LLVM 自举不动点 + 当前二进制（见 §4.3，G4 决策）
> 前置文档：`docs/reference.md`（语言规范，唯一语义权威；`docs/spec.md` 已于 2026-08-01 废弃，仅作历史封存）
> 目标：将编译器从 TypeScript 实现（tc0）过渡到 t 语言自身实现，达成自编译不动点，随后进入 AI Agent 自迭代开发模式。

---

## 0 术语与总体路线

| 名称 | 定义 |
|------|------|
| **tc0** | 当前 TypeScript 实现的种子编译器（`tc0/`，~7000 行），产物 `dist/tc.exe` |
| **compiler.tc** | 用 t 语言书写的编译器源码（`src/` 目录） |
| **tc1** | 由 tc0 编译 compiler.tc 得到的可执行编译器 |
| **tc2** | 由 tc1 编译 compiler.tc 得到的可执行编译器 |
| **tc3** | 由 tc2 编译 compiler.tc 得到的可执行编译器 |
| **不动点** | tc2 与 tc3 的产物（生成的 C 代码）逐字节一致，即自举成功 |

```
Stage 0   tc0 (TS)          ← 已完成，冻结为「引导工具」
Stage 0.5 tc0 能力补齐       ← 自举硬前提：string/切片/map/文件IO 运行时
Stage 1   compiler.tc 移植   ← tc0 编译 compiler.tc → tc1，逐模块差分验证
Stage 2   自编译不动点        ← tc1→tc2→tc3，tc2 ≡ tc3
Stage 3   自迭代开发          ← 退役 TS，所有演进发生在 compiler.tc 上
```

**核心原则**：
1. `docs/reference.md` 是唯一语义权威（`docs/spec.md` 已废弃）。tc0 与 compiler.tc 行为不一致时，以规范为准，两边同时修。
2. 每个阶段都有**机器可验证的等价性判据**（差分测试），不靠人眼。
3. tc0 在 Stage 2 完成前保持可用，作为「已知正确」的参照实现；完成后打 tag 封存（种子编译器永久保留，用于灾难恢复重建）。

---

## 1 现状盘点（tc0 能力矩阵）

### 1.1 已具备（可直接支撑自举）

| 能力 | 模块 |
|------|------|
| 完整词法/语法/AST | `lexer/`、`parser/`、`ast/` |
| struct / enum / flag[T] / flag_set / union / bitpack | 全流水线 |
| 标量类型检查（无隐式转换） | `types/checker.ts` |
| 六大类注解 + @derive 生成 | `annotations/` |
| CTFE、type_info、SlotInfo | `comptime/` |
| C 代码生成（.h + .c） | `codegen/emitter.ts` |
| JSON 诊断双输出、AST JSON 导出 | `diagnostics/`、`codegen/ast_export.ts` |
| @test 测试运行器 | `annotations/test_runner.ts` |

### 1.2 缺失（自举硬阻塞，Stage 0.5 补齐）

| # | 能力 | 规范依据 | 自举场景 | 必要度 |
|---|------|---------|---------|--------|
| G1 | `string` 完整运行时：索引、切片、比较、长度、字符访问 | §2.1 | 词法器整个建立在字符流上 | ★★★ |
| G2 | `StringBuilder` 可变拼接 | §2.1 | C 代码发射器输出缓冲 | ★★★ |
| G3 | `[]T` 动态切片：`append` / 下标 / `len` / 迭代 | §2.2 | Token 流、AST 子节点列表、诊断列表 | ★★★ |
| G4 | `map[K]V`：插入、查找、contains、迭代 | §2.2 | 符号表、类型环境、注解注册表 | ★★★ |
| G5 | 递归结构体（自引用，经引用/索引间接） | §3.1 | AST 节点树 | ★★★ |
| G6 | 文件 I/O 内置函数：读源文件、写 .c/.h/.json 产物 | §7.2 | 编译器输入输出 | ★★★ |
| G7 | `switch` 对 enum 的穷尽匹配 | §1.2 | Parser/Checker 按节点类型分发 | ★★ |
| G8 | 结构体嵌套函数调用链、结构体作为返回值 | §1.3 | 各模块间传递 AST/Token | ★★ |
| G9 | 命令行参数、进程退出码内置 | — | CLI 入口 | ★★ |
| G10 | `Variant` | §2.3 | 注解参数承载（可先用 union+tag 绕过） | ★ |

---

## 2 Stage 0.5 — 前置能力补齐

### 2.1 C 运行时库 `t_runtime`（新增 `runtime/t_runtime.h` + `runtime/t_runtime.c`）

tc0 的 emitter 将 G1~G6 的语言构造翻译为对该库的调用。此库为**长期资产**：tc1/tc2 生成的 C 代码同样链接它。纯 C99，无第三方依赖，gcc/clang/msvc 均可编译。

#### 内存模型：Arena 分配器（编译器场景专用）

```c
typedef struct TArena TArena;
TArena* t_arena_new(void);
void*   t_arena_alloc(TArena* a, size_t size);
void    t_arena_free_all(TArena* a);   // 编译结束一次性释放
```

决策：编译器是「一次性批处理」进程，采用 arena 整体分配、进程结束统一释放，**完全回避 GC 与所有权系统**——这是把自举提前数月的关键取舍。规范的通用内存管理设计推迟到 Stage 3 之后。

#### string（不可变 UTF-8 视图）

```c
typedef struct { const uint8_t* ptr; int64_t len; } TStr;
TStr    t_str_from_c(const char* s);
TStr    t_str_slice(TStr s, int64_t start, int64_t end);   // 越界 → panic + JSON 诊断
uint8_t t_str_byte_at(TStr s, int64_t i);
bool    t_str_eq(TStr a, TStr b);
int64_t t_str_len(TStr s);
```

#### StringBuilder

```c
typedef struct { uint8_t* buf; int64_t len; int64_t cap; TArena* arena; } TSb;
TSb* t_sb_new(TArena* a);
void t_sb_append_str(TSb* b, TStr s);
void t_sb_append_u64(TSb* b, uint64_t v);
void t_sb_append_i64(TSb* b, int64_t v);
TStr t_sb_to_str(TSb* b);
```

#### 切片 []T（泛型经元素宽度单态化）

```c
typedef struct { void* ptr; int64_t len; int64_t cap; int64_t elem_size; } TSlice;
TSlice t_slice_new(TArena* a, int64_t elem_size);
void   t_slice_append(TArena* a, TSlice* s, const void* elem);
void*  t_slice_at(TSlice s, int64_t i);   // 越界 → panic + JSON 诊断
```

emitter 侧规则：`[]Token` 生成 `TSlice`，`tokens[i]` 生成 `*(Token*)t_slice_at(tokens, i)`，`append(tokens, tok)` 生成 `t_slice_append(arena, &tokens, &tok)`。**t 语言层不暴露 void*，类型安全全部由 tc 的类型检查器在编译期保证。**

#### map[K]V（开放寻址，K 限定 string / 整数）

```c
typedef struct TMap TMap;
TMap* t_map_new(TArena* a, int64_t key_kind, int64_t val_size);  // key_kind: 0=str 1=int
bool  t_map_get(TMap* m, const void* key, void* out_val);
void  t_map_put(TMap* m, const void* key, const void* val);
bool  t_map_has(TMap* m, const void* key);
int64_t t_map_len(TMap* m);
```

#### 文件 I/O 与进程（t 语言内置函数 → 运行时调用）

| t 语言内置 | C 运行时 |
|-----------|---------|
| `file_read_all(path: string) -> string` | `t_file_read_all` |
| `file_write_all(path: string, content: string) -> bool` | `t_file_write_all` |
| `args() -> []string` | `t_args`（main 注入） |
| `exit(code: i32)` | `exit` |
| `print(s: string)` / `eprint(s: string)` | `t_print` / `t_eprint` |

### 2.2 tc0 需要的对应改动

| 模块 | 改动 |
|------|------|
| `types/checker.ts` | string 下标/切片/比较的类型规则；`[]T` append/len/下标；`map[K]V` 操作；内置函数签名注册 |
| `codegen/emitter.ts` | 上述构造 → t_runtime 调用的翻译规则；`#include "t_runtime.h"`；arena 上下文线程化 |
| `parser/parser.ts` | 切片字面量、下标表达式、`switch` 语句（若缺）、方法风格调用 `s.len()`（若规范采纳；否则统一内置函数形式 `len(s)`——**按规范唯一语义原则，采用内置函数形式，不引入方法语法**） |
| `runtime/` | 新目录，t_runtime.h/c，含单元测试（直接用 C 断言） |
| CLI | `compile` 命令自动把 `runtime/t_runtime.c` 加入 gcc 编译命令；新增 `build` 命令一键 `.tc → exe` |

### 2.3 Stage 0.5 验收标准（全部机器可验证）

1. `runtime/` C 单测通过（字符串/切片/map 边界用例，含越界 panic 的 JSON 输出格式）。
2. 新样例 `tests/samples/selfhost_probe.tc` —— 一个 **mini-lexer**：用 t 语言读取文本文件、切分为单词 Token 列表（用到 string 遍历、[]T append、map 关键字表、StringBuilder 输出、文件读写），经 `tc0 build` 编译为 exe 后运行结果与预期文件逐字节一致。
3. 既有三个样例（game_ecs / protocol / basic_syntax）回归零错误。

**mini-lexer 跑通 = Stage 0.5 完成。它就是自举可行性的最小证明。**

---

## 3 Stage 1 — compiler.tc 移植

### 3.1 目录结构

```
src/
  tc1.tc           # CLI 入口 + 完整编译器（参数解析、命令分发、emit）
  lexer.tc         # Token 定义 + 词法器
  ast.tc           # AST 节点（struct + enum tag + 子节点索引）
  parser.tc        # 递归下降解析
  types.tc         # 类型表示与相等/转换判定
  checker.tc       # 类型检查 + 警告管控
  annotations.tc   # 注解注册表 + 校验
  derive.tc        # @derive 代码生成
  flag.tc          # 位域布局计算 + SlotInfo
  ctfe.tc          # 编译期求值
  type_info.tc     # 类型自省
  diagnostics.tc   # 诊断收集 + 文本/JSON 双输出
  emitter.tc       # C 代码发射
  json.tc          # 手写 JSON 序列化（诊断/AST 导出用）
```

### 3.2 关键设计决策

1. **AST 表示**：t 语言无继承/接口，AST 节点统一为 `Node struct` + `NodeKind enum : u16` + 按需字段；子节点用 `[]u32`（节点池索引）而非指针，所有节点存于 `nodes: []Node` 池中。索引式 AST 同时天然利于 JSON 导出与 arena 布局。
2. **诊断 JSON**：无反射依赖，`json.tc` 手写发射器（StringBuilder 拼接，字段顺序固定），保证与 tc0 输出**字段序一致**，便于差分。
3. **CTFE 自宿主**：Stage 1 的 CTFE 先支持规范要求的子集（整数算术、控制流、type_info 遍历）；外部 CSV/JSON 数据表导入（§7.2）推迟到 Stage 3。
4. **不移植 TS 独有便利**（正则、闭包、异常）：一律改写为显式循环 + 错误码返回，与规范的显式原则一致。

### 3.3 移植顺序与差分测试

每个模块移植后立即用 tc0 编译运行，与 TS 版做**同输入差分**：

| 步骤 | 模块 | 差分判据（对全部 tests/samples/*.tc） |
|------|------|--------------------------------------|
| 1 | lexer.tc | `tc0 lex --json` vs `tc1-partial lex --json`：Token 流 JSON 逐字节一致 |
| 2 | ast.tc + parser.tc | `ast --json` 输出逐字节一致 |
| 3 | types.tc + checker.tc + annotations.tc | `check --json` 诊断包逐字节一致 |
| 4 | flag.tc + ctfe.tc + type_info.tc | `type-info` 全类型输出一致 |
| 5 | derive.tc + emitter.tc | 生成的 .h/.c 逐字节一致 |
| 6 | main.tc + diagnostics.tc + json.tc | 全命令端到端一致 |

配套工具：`tools/difftest.mjs`（Node 脚本，跑在 CI/本地）：对每个样例 × 每个命令跑双实现、diff、汇总 JSON 报告。**任何差异都视为 bug：要么 tc0 错（修 TS + 补规范测试），要么 compiler.tc 错（修 tc）。**

注：tc0 需为此新增 `lex --json` 命令（导出 Token 流），一并在 Stage 0.5 完成。

### 3.4 Stage 1 验收标准

- `tc0 build src/tc1.tc -o dist/tc1.exe` 成功；
- difftest：tc1 与 tc0 在全部样例 × 全部命令上输出逐字节一致；
- tc1 通过 `tests/samples/*.tc` 中全部 @test 用例。

---

## 4 Stage 2 — 自编译不动点

### 4.1 流程（历史定义 + 当前实际判据）

**历史定义（M10 原始判据，已失效）**

```
tc0 + compiler.tc  →  tc1.exe
tc1 + compiler.tc  →  tc2.exe        # 首次「t 编译 t」
tc2 + compiler.tc  →  tc3.exe
断言: tc2 生成的 C 代码 ≡ tc3 生成的 C 代码   （逐字节，不比对 exe，规避链接器时间戳差异）
```

脚本化于 `tools/bootstrap.mjs`。**该路径当前已不可达**：种子 tc0（冻结于 `v1.0-selfhost`）在解析当前 `import(src.x :: *)` 语法时即报 `T_PARSE_EXPECTED_TOKEN`，无法生成 C 代码；且其 C 后端对 `append(x, sb_to_str(...))` 生成 `&t_sb_to_str(...)`（取临时量地址），MSVC 报 `C2102`。详见 README「遗留/冻结」说明。

**当前实际判据（自举不动点 = `tools/gate.mjs L2` 三件套）**

Stage 2 的「自编译不动点」改由 `tools/gate.mjs L2` 实证，对当前 `src/` 全绿（最近一次 15 passed / 0 failed）：

1. **LLVM 后端四代不动点 `boot4`**：`g2 == g3 == g4`（比对 `.ll` md5）—— 编译器用自身 LLVM 后端把自己编译到不动点。
2. **C 后端自举 `cself`**：`src/tc.tc` → C（`tc.c`）→ clang 编译 → 再跑 conformance，与 LLVM 后端等价。
3. **跨后端 / 跨代对拍 `difftc0` + `difftest`**：`g2 ↔ g3` 代际对拍、tc0 外部对拍、examples 双后端三方比对。

判定口径一致：比对 IR / 产物 md5 与诊断 JSON，规避链接器时间戳差异；不比对 exe。

### 4.2 通过后动作

1. tag `v1.0-selfhost`（M11 打在 C 后端三轮不动点当时，仅历史封存）；**信任根 = 新 tag `v1.0-selfhost-llvm`**（gate L2 全绿的那次提交）+ 当前已自举二进制 `out/dbg/tc.exe`（`=g4`）。任一时刻的「受信任编译器」= 该 tag 源码经 `gate L2` 实证不动点后产出的二进制，而非 tc0。
2. `seed/tc0/` 保留为 **frozen 参照实现**，仅供诊断差分参照；其引导路径已失效（见 §4.1），**不再作为灾难恢复重建种子**。可复现重建路径 = git tag `v1.0-selfhost-llvm` + LLVM 工具链（clang/llvm）。
3. `README` 更新：主实现 = `src/`，TS 版 frozen；自举状态改述为 gate L2 三件套判据（见上）。
4. `tests/` 符合性套件：每条规范条款至少一个正例 + 一个负例（含预期 JSON 错误码）。当前规模 **201 用例（57 pass / 144 fail）**，诊断码覆盖 120/128，且仍在扩大（只增不删）。

### 4.3 信任根模型（Trust Model，G4 决策）

自举达成后，**信任根 = LLVM 自举不动点 + 当前二进制**，具体由 `tools/gate.mjs L2` 三件套实证：

- **信任根定义**：受信任的编译器 = `git tag v1.0-selfhost-llvm`（gate L2 全绿提交）的源码，经 `boot4` 四代 LLVM 不动点（`g2==g3==g4`）+ `cself` C 后端自举 + `difftc0`/`difftest` 跨代跨后端对拍后，产出的二进制 `out/dbg/tc.exe`（`=g4`）。
- **为何放弃 tc0 作信任根**：种子 tc0（冻结于 `v1.0-selfhost`）解析不了当前 `import(src.x :: *)` 语法，其引导路径在 §4.1 已证不可达；它无法把当前 `src/` 编译成任何可执行产物，故不再具备「已知正确参照」的重建能力，仅作差分诊断的历史基线。
- **重建路径（灾难恢复）**：信任根可经 `git checkout v1.0-selfhost-llvm && node tools/gate.mjs L2` 在任意装有 LLVM 工具链（clang/llvm）的环境复现；不依赖 tc0、不依赖任何已冻结的 TS 产物。
- **信任传递**：Stage 3 自迭代中，新编译器必须经「当前稳定版 tcN 编译 → 符合性套件 + difftest → 不动点复验」晋升（§5），复验即重新执行 gate L2 三件套，使信任根随每次绿门禁向前滚动。

> 结论：Stage 2 自举的信任不来自 tc0 种子，而来自 **LLVM 后端自举不动点 + 跨后端对拍** 的可复现实证。tc0 是 frozen 参照实现，不是信任链的一环。

---

## 5 Stage 3 — 自迭代开发模式

自举完成后的开发循环（人类或 AI Agent 均适用）：

```
修改 src/*.tc → 当前稳定版 tcN 编译 → 跑符合性套件 + difftest(tcN vs tcN+1)
→ 不动点复验 → 通过则 tcN+1 晋升为稳定版
```

- **AI Agent 闭环**：编译失败时 JSON 诊断包（错误码、行列、修复建议）直接作为 Agent 输入 → 修改 → 重编译，即规范 §8 的设计目标。
- **版本晋升规则**：任何语言新特性必须①先改 `docs/reference.md`（权威规范）②补符合性测试 ③再改 compiler.tc，三步缺一不可（防双实现漂移在自迭代期演化为规范漂移）。
- **待偿技术债**（按优先级）：~~Variant（G10）~~ ✅已实现、`CSV/JSON 数据表 CTFE 导入（§7.2）`、`@soa 布局变换`、通用内存管理（脱离 arena）、优化后端。

---

## 6 风险与对策

| 风险 | 对策 |
|------|------|
| 语言特性蔓延（为自举方便偷加语法） | 一切新语法先过规范 §0 五条铁律 + 写入 `docs/reference.md`，否则 emitter/checker 拒绝实现 |
| 双实现语义漂移 | difftest 逐字节比对是硬门禁；输出格式（JSON 字段序、C 代码排版）写死为规范附录 |
| arena 内存策略被误当语言语义 | 明确标注：arena 是**编译器实现策略**，非语言内存模型；spec 不引用 |
| C 运行时越界/UB | t_runtime 全部边界检查 + JSON panic 输出；C 单测覆盖边界 |
| 不动点因非确定性失败（map 迭代序、时间戳） | map 迭代按插入序（链式记录）；产物禁止嵌入时间戳/绝对路径 |
| 种子 tc0 已无法重建当前 `src/`（引导路径失效，见 §4.1） | 信任根改为 tag `v1.0-selfhost-llvm` + LLVM 工具链（`git checkout` + `gate L2` 可复现）；tc0 仅作 frozen 参照，不再是重建保证 |

---

## 7 里程碑清单（执行顺序）

> 路径说明：下表记录的是**当时**的文件位置。M5–M7 那三个独立里程碑程序（lexer / parser / checker）
> 已于 2026-08-08 归档到 `archive/milestones/`；现役编译器本体在 `src/`，按编译步骤分层为
> `base → lex → parse → sema → codegen_c → codegen_ll → tc`。

- [x] **M1** runtime/t_runtime.h/c + C 单测（G1~G6 底座）
- [x] **M2** tc0：checker + emitter 支持 string/切片/map/内置函数/switch；新增 `build`、`lex --json` 命令
- [x] **M3** mini-lexer 样例（selfhost_probe.tc）编译运行通过 —— *Stage 0.5 完成*
- [x] **M4** tools/difftest.mjs 差分测试框架
- [x] **M5** src/lexer.tc + json.tc + diagnostics.tc，Token 流差分通过
- [x] **M6** src/ast.tc + parser.tc，AST 差分通过
- [x] **M7** src/checker.tc（单文件含 types/annotations/flag resolver），`check --json` 诊断差分通过（tests/samples 5 + tests/err_samples 5，全部逐字节一致；含 flag 双 resolve 重复诊断复刻）
      已知差距：parse 错误时 tc0 输出恢复式诊断 JSON，src 为 fail-fast stderr（不影响合法源自举不动点）
- [x] **M8** emitter 移植（实际并入单文件 `src/tc1.tc`：emit_decl/derive/flag 布局/emit 编排；
      flag 布局用 fr_layout，derive 复刻 tc0 全部字符串模板含 `[object Object]` 怪癖）
- [x] **M9** tc1 驱动（lex/check/compile 派发）+ 全量差分：`difftest --cand tc1.exe` 42/42 逐字节一致 —— *Stage 1 完成*
- [x] **M10** 自举不动点实证：`tools/bootstrap.mjs` 原 C 后端三轮 `C_a≡C_b≡C_c` 因 tc0 已无法解析当前 `import(src.x :: *)` 语法而失效；**改由 `tools/gate.mjs L2` 三件套实证**（LLVM `boot4` g2==g3==g4 + C 后端 `cself` + 跨后端 `difftc0`）全绿 —— *Stage 2 完成，自举达成（LLVM / C 双后端）*
- [x] **M11** 封存种子（`seed/tc0/` + tag `v1.0-selfhost`）、切换主实现（README：主实现 = src，TS 版 frozen）、
      建立符合性套件（`tests/conformance/` 175 用例（56 pass / 119 fail）+ `tools/conformance.mjs`，含 tc0 交叉验证）—— *进入 Stage 3 自迭代*
- [x] **M12** Variant 一等类型（spec §2.3 / G10）：lexer `variant` 关键字 → `parse_variant_decl`（VariantDecl+VC 节点）
      → 类型检查器注册类型与 `Name_from_Case/Name_is_Case/Name_as_Case` 助手符号 → emitter 发射 tagged-union
      struct + 三个 `static inline` 自由函数。`tests/conformance/p08_variant.tc` + `tests/variant_smoke` 运行时验证通过；
      gate L2 不动点仍全绿（boot4 g2==g3==g4 / cself / difftc0），difftest 30/30 无回归。
- [x] **M13** 信任根模型（G4）：接受「信任根 = LLVM 自举不动点 + 当前二进制」—— tc0 种子引导路径已失效，降级为 frozen 参照实现；信任根与灾难恢复改由 tag `v1.0-selfhost-llvm` + `gate L2` 实证（详见 §4.3）。*Stage 2 全闭环*
