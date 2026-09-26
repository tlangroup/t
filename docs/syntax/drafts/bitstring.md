# 位串类型设计草稿（BitStr）

> 状态：激活 `docs/syntax/drafts/match_extensions.md:19` 标记为 out-of-scope 的「位串类型」。
> 流程：spec-driven-development Phase 1（SPECIFY）。Human 复核假设后进入 Phase 2（PLAN）。

## 1. 动机与目标

通讯行业（协议报文、编解码）频繁需要**任意位宽**的位序列：例如「3-bit 版本 + 5-bit 类型 + 16-bit 长度 + 变长负载」。计算机行业处理的 `binary`（字节序列）只是位串在「长度 % 8 == 0」时的特殊形态。

核心定位：**`binary ⊂ bitstr`**。bitstr 是通用的一等位序列类型；binary = 字节对齐的 bitstr。

## 2. 核心模型

- **`bitstr`**：一等类型，表示一串 bit，逻辑长度 = 位数（可非 8 倍数）。
- **底层存储**：字节数组 `[]u8` + 运行时位长度 `bit_len: i64`；尾部字节允许部分使用（未用位填 0）。
- **`binary`**：bitstr 的字节对齐视图/约束（`bit_len % 8 == 0`，每 8 bit 为 1 字节）。t 既有的 `fopen(..., :binary)`、`@derive(BinarySerde)`、`fid <>` 二进制序列化均产出/消费字节对齐的 bitstr。

## 3. 与现有设施的关系（调研事实）

| 现有设施 | 文件/事实 | 与 bitstr 的关系 |
|---|---|---|
| **AWI 任意位宽整数** `i<N>`/`u<N>` | `base.awi_bits`，C `_BitInt(N)` / LLVM `i<N>`（base.tc:6255、codegen_c.tc:410） | 段（segment）以 AWI 标量承载位宽；`<<x:3>>` 写 x 的低 3 位。位截断/符号扩展逻辑可直接复用 |
| **`@bitpack(T)` struct** | `codegen_c.tc:3960` `@bitpack(n.sc) struct` | 编译期定长位域。与 bitstr **正交**：bitstr 是运行时变长位序列；`@bitpack` struct 可序列化为 bitstr |
| **`flag_set` 动态位域** | `codegen_c.tc:4092` `size_t bit_count` | 动态长度 bitfield，是 bitstr 的近亲；可视为「定长语义、变长存储」的特例 |
| **`[]u8` Slice** | TI `kind=Slice, elem=u8, (data,len,cap)` | bitstr 底层表示与 `[]u8` 同构，但语义长度单位是 **bit** 而非 byte |
| **位运算 `& \| ^ ~`** | `sema.tc` `binary` 节点 + lex `BitAnd/BitOr/...` | 直接复用，无需新增算子 |

## 4. 类型系统整合（TI）

新增 TI kind `"BitStr"`（参照 `sema.tc:51` 的 `TI` 结构）：

- `kind = "BitStr"`，`elem = u8`（底层字节元素，固定）
- 值级携带 `(data: ptr<u8>, bit_len: i64, cap: i64)` —— 与 Slice 的 `(data, len, cap)` 同构，仅 `len` 改为 `bit_len`（允许非 8 倍数）
- **不新增 TI 字段**：`bit_len` 是值级属性（类比 Slice.len 不在 TI 中）
- `binary` 不单独建 kind，作为 `BitStr` 的字节对齐约束（类型检查器在字面量 / IO 处校验 `% 8 == 0`）

## 5. 语法设计（提案，待拍板）

采用 Erlang/Elixir 风格 `<<...>>` —— 通讯领域事实标准：

- **构造**：`var p = <<ver:3, type:5, len:16, payload/bitstr>>;` 每段 `val:Width` 指定位宽；`/bitstr` 表示「剩余全部位」（变长）。
- **模式匹配**：`match pkt { <<ver:3, type:5, len:16, rest/bitstr>> => ... }`（解包协议报文）。
- **拼接 / 切片**：`a ++ b`（bitstr 拼接）；`p[3..11]`（位级切片，返回 bitstr）。
- **位运算**：`& | ^ ~` 复用现有 `binary` 节点。
- **迭代**：`for (byte in p)` 按字节迭代（binary 主流）；bitstr 纳入 `for_each` 静态分派（与 `[]u8` Slice 同构）。**不提供逐 bit 迭代语言原语**——位级访问走段提取 `<<...:N>>` / 位切片 `p[lo..hi]` / AWI `u<N>` + 移位（见 §11.3、§14）。

## 6. 脱糖策略（应用前几轮结论）

- **构造 `<<...>>`**：在语义层（sema）脱糖为「字节数组分配 + 逐段位填充（移位/掩码）」的 `block_expr`，等价于手写位打包。**不降到控制流以外**。
- **模式 `<<...>>`**：在 match 分派期脱糖为「按位偏移提取 + 掩码 + 截断」的若干绑定（类比 match 既有 arm 解构逻辑）。
- **对齐 §2.9 原则**：脱糖只到语义层，双后端零改动 —— C/LLVM 后端只需发射 bitstr 的 `(ptr<u8>, bit_len)` 结构与位运算（AWI 位运算已就绪）。
- 位串**不**引入 trait/迭代器抽象（沿用 for-each 讨论结论：Zig 路线，自定义迭代用 `while (next)` 式，bitstr 的 next 返回 optional bit）。

## 7. 后端发射

- **C**：`typedef struct { uint8_t* data; size_t bit_len; size_t cap; } TBitStr;`；位运算走 `uint8_t` 数组 + 移位（段宽 > 64 复用 `_BitInt(N)`）。
- **LLVM**：`%TBitStr = { ptr<u8>, i64, i64 }`；段提取用 `lshr/and/trunc`（`i<N>` 已支持）。
- 与现有双后端 `(ptr, len, cap)` Slice 发射逻辑高度同构，增量小。

## 8. 与序列化协同

- `@derive(BinarySerde)` 的 struct 可新增 `to_bitstr()/from_bitstr()`（字节对齐场景直接复用 serialize 字节）。
- **交互现状（2026-09-25）**：当前 bitstr 与 `@derive(BinarySerde)` **无交互**，记为 deferred gap（见 §14.2）。bitstr 落地后需定义：BinarySerde 序列化 struct 中 `bitstr` 字段时直接 emit 原始位（字节对齐复用 serialize 字节；非对齐同 `T-BIT-E512` 策略）。
- `fid < bitstr>`：字节对齐 bitstr 直接写裸字节；非对齐给 `T-BIT-E512`（通讯场景通常手动补齐到字节）。

## 9. 门禁与测试

- **conformance**：`tests/conformance/{pass,fail}/` 加 `p_bitstr_*` / `f_bitstr_*`（构造、解构、非对齐诊断）。
- **run_examples**：`examples/bitstr_protocol.tc`（模拟一个通讯报文解包往返）。
- **gate L2**：bitstr 改动须过全量自举不动点 + 双后端对拍（参照 P4/P5 流程：gate → 同步 tc.exe → 重录 IR 基线 → 提交）。

## 10. 诊断码

| 码 | 含义 |
|---|---|
| `T-BIT-E510` | 段位宽超出承载标量位宽 |
| `T-BIT-E511` | 模式匹配段位宽非编译期常量 |
| `T-BIT-E512` | 非字节对齐 bitstr 写入二进制流 |

（具体码号与 `src/diag_table.gen.h` 协调，避免冲突）

## 11. ASSUMPTIONS（请纠偏，否则按此推进）

1. 位串采用 **Erlang 风格 `<<...>>`** 语法，因通讯领域事实标准。
2. `binary` **不单独建 TI kind**，而是 `bitstr` 的字节对齐约束（runtime / 类型检查约束）。
3. bitstr 纳入 `for_each` 静态分派（与 `[]u8` Slice 同构，**按字节迭代**）；**不提供逐 bit 迭代语言原语**——位级访问由段提取 `<<seg:N>>`、位切片 `p[lo..hi]`、AWI `u<N>`+移位 + 标准库 bit-cursor 辅助（非原语）覆盖。理由见 §14.1。
4. 位串是**值语义**（copy on assign），与 Slice 一致；大位串靠底层指针共享（写时复制策略待定）。
5. **端序不进类型**：`bitstr` 与 `binary` 是同一类型（端序无关的纯位序列）；端序是**段读写操作的标注**，在 `<<...>>` 构造/模式内逐段指定（如 `<<x:16/big>>` / `<<x:16/little>>`），默认大端（网络字节序约定，仅操作层）。理由见 §14.3。
6. 底层存储字节数组，`bit_len` 允许非 8 倍数；尾部字节未用位填 0。

## 12. Open Questions

- ~~bitstr 是否纳入 `for_each` 静态分派，还是仅 `while(next)` 迭代？~~ → **已决**：纳入 `for_each`（字节粒度，与 Slice 同构），不提供逐 bit 迭代原语（见 §11.3、§14.1）。
- 非字节对齐 bitstr 与 `@derive(BinarySerde)` 的交互策略？ → **deferred gap**，见 §8、§14.2。
- ~~端序是否进类型（`bitstr:be` / `bitstr:le`），还是仅构造处标注？~~ → **已决**：不进类型，端序为 `<<...>>` 段级标注 `/big` `/little`（见 §11.5、§14.3）。

## 13. Success Criteria

- 能用 `<<...>>` 构造任意位宽位串并 `match` 解构；双后端运行结果一致。
- binary（字节对齐）作为 bitstr 特例零摩擦使用；既有 `:binary` I/O 不回归。
- gate L2 全绿（自举不动点 + 双后端对拍 + conformance）。

## 14. 设计决策记录（2026-09-25 复盘）

### 14.1 不提供逐 bit 迭代原语
- **质疑**：逐 bit 顺序遍历是否真有用途？（用户提出，答：几乎无）
- **论证**：bit 级算法（信道编解码/交织/加扰、Huffman/DEFLATE 位流、CRC、流密码）从不是「一次取 1 bit 顺序处理」，而是「游标处取变长 k 位」或「按偏移随机取 bit[i]」。统一逐 bit 原语 `for (b in p.bits)` 几乎永远不是对的抽象。
- **决策**：bitstr 仅做**字节**迭代（`for_each` 静态分派，同 `[]u8`）；位级访问交给定长段提取 `<<seg:N>>`、位切片 `p[lo..hi]`、AWI `u<N>`+移位，加标准库 bit-cursor 辅助（非语言原语）。与 Zig 路线（最小原语）一致。
- **影响**：§11.3 原「位级迭代需显式语法」删除；`for_each` 分派链在 sema 只需按 BitStr 定元素类型=u8（同 Slice），无需新位级分支。

### 14.2 bitstr × @derive(BinarySerde) 无交互（deferred gap）
- **现状**：两者当前零交互。
- **目标交互**：BinarySerde 派生 struct 序列化 `bitstr` 字段时 emit 原始位（字节对齐复用 serialize 字节；非对齐同 `T-BIT-E512`）。
- **处置**：bitstr 核心设计不阻塞；此交互作为落地后下游任务。

### 14.3 端序不进类型
- **质疑**：端序是否应进类型？（用户指出：两者类型一致，端序无关）
- **论证**：`bitstr` 与 `binary` 是同一端序无关纯位序列类型；端序是「段如何解释」的操作属性，不是值类型属性。分裂 `bitstr:be`/`bitstr:le` 无据。
- **决策**：端序仅在 `<<...>>` 构造/模式内逐段标注 `/big` `/little`（默认大端=网络字节序约定，仅在操作层）。`bitstr` 类型与 `binary` 约束为同一 TI kind。
- **影响**：§11.5 从「类型级默认大端」降级为「操作级默认大端」；不新增任何端序相关 TI 字段/种类。

## 15. 实现计划（Phase 2 PLAN）

### 15.1 关键前置决策：`<<` 与左移操作符冲突（必须解决）
- **事实**：t 的 lexer 已将 `<<` / `>>` 用作左移/右移（`Shl`/`Shr`，见 lex.tc:826 `ShlAssign`/`<<=`），`<<` 并非空闲分隔符。直接照抄 Erlang `<<...>>` 会与左移撞车。
- **消歧方案（默认）**：lexer 不变（仍发 `Shl` token）；**parser 按位置消歧**——`<<` 出现在 *primary 表达式起始位置*（`=`/`,`/`(`/语句开头之后）= bitstring 字面量；出现在 *operand 之后* = 左移。bitstring 用**独立 AST 节点 `BitStrLit`**（段链表），不复用 `Shl` 节点，故 codegen 层无冲突。
- **替代方案（若位置消歧不稳）**：bitstring 改分隔符 `$[...]` 或 `bits!{...}`，但偏离假设 1，需用户复议——**默认走位置消歧，保留 Erlang 风格**。
- **边界缓解（R1）**：bitstring 字面量后禁止直接接 `>>`/`<<` 二元运算符，强制括号包裹，消除 `<<x>> >> y` 类歧义。

### 15.2 模块改造清单（按依赖序）

**M0. 诊断码**（src/diag_table.gen.h + gen_diag 机制）
- 新增 `T-BIT-E510`（段位宽超出承载标量）/ `E511`（模式段位宽非编译期常量）/ `E512`（非字节对齐 bitstr 写二进制流）。当前无 `T-BIT-` 前缀，码号无冲突。

**M1. TI 类型表**（src/sema.tc）
- 注册 kind `"BitStr"`（`ti_mk`/`ti_elem_of`，elem=u8 固定）。
- `mk_type_node_from_ti`(~1503) 加 `BitStr` 分支返回 bitstr 类型节点。
- `ti_to_str`/`desc` 打印 `bitstr`；`ti_equal` BitStr↔BitStr 相等；`can_cast` 仅 BitStr↔BitStr（与 `[]u8` 不强转，互转用显式 `.bytes()`，形式待定）。
- `tip_kind` 分类：BitStr 归 aggregate/other（非 Scalar）。

**M2. lex / parse**（src/lex.tc, src/parse.tc）
- lex：无新 token（复用 `Shl`/`Shr`）。
- parse：primary 位置 `<<` → `BitStrLit`（base.mk_bitstr）；段 `val:Width[/big|/little]` + 变长尾 `rest/bitstr`（须为末段）。`match` arm 同位置识别 `<<...>>` → `BitStrPat`。
- 段 Width 须编译期常量（M3 校验，否则 `T-BIT-E511`）。

**M3. sema 类型检查**（src/sema.tc）
- infer `BitStrLit`：各段类型/位宽校验 + AWI 截断（`base.awi_bits`）。
- `desugar_value_loop`(5612) 扩展：`for_each` 静态分派加 BitStr → 元素类型 u8（同 Slice），迭代粒度=字节（§14.1）。
- `BitStrPat` 脱糖：按位偏移提取 + 掩码 + 截断绑定（复用 match arm 解构），落实 §6。

**M4. tir**（src/tir.tc）
- `BitStrLit`/`BitStrPat` 的 TIR 表示：脱糖后为 block_expr + 字节缓冲 + 段填充/提取，tir 认新节点或承接脱糖产物。

**M5. codegen_c**（src/codegen_c.tc）
- 新增 `typedef struct { uint8_t* data; size_t bit_len; size_t cap; } TBitStr;`（位运算区 ~3960 附近）。
- `BitStrLit` 发射：分配缓冲 + 逐段位填充（移位/掩码/`_BitInt(N)`，段宽>64 复用 AWI）。
- `BitStrPat` 发射：按偏移提取 + 掩码。
- 位运算 `& | ^ ~` 复用现有 `binary` 节点（已就绪）。

**M6. codegen_ll**（src/codegen_ll.tc）
- `%TBitStr = { ptr<u8>, i64, i64 }`。
- 段提取 `lshr/and/trunc`（`i<N>` 已支持）；段填充 `shl/or`。
- 字节迭代：gep + 循环（同 Slice 路径）。

### 15.3 门禁与测试
- conformance：`tests/conformance/{pass,fail}/p_bitstr_*` / `f_bitstr_*`（构造/解构/非对齐诊断/段宽非常量）。
- run_examples：`examples/bitstr_protocol.tc`（通讯报文解包往返）。
- gate L2：全量自举不动点 + 双后端对拍（参照 P4/P5：`gate` → 同步 tc.exe → 重录 IR 基线 105 targets → 提交）。

### 15.4 风险
- **R1** `<<` 位置消歧脆弱性（§15.1 边界缓解）。
- **R2** 引入新 TI kind 必触发全量 gate(~2668s)；改动须一次性到位，避免反复重验不动点。
- **R3** 尾部字节未用位填 0 约定须双后端一致（§11.6），对拍验证。

### 15.5 建议实施顺序（单 PR）
`M0 → M1 → M2 → M3 → M4 → M5 → M6 → 测试 → gate`；建议先以 `p_bitstr_basic` 最小可用闭环验证双后端，再铺开 conformance/gate。

### 15.6 设计决策补充（19:20）：`++` 合并符推广到所有集合类型
- **决策**：`++` 作为**所有集合类型的合并操作符**（Slice/Array/String/bitstr/Map 合并），与数值 `+`（仅标量加法）彻底解耦。先随 bitstr 落地 `bitstr ++ bitstr`，再逐步推广到其余集合类型。
- **依据**：Erlang/Elixir 传统——`++` 表列表/二进制拼接，`+` 仅数值；避免「`+` 既加数字又拼字符串」的语义混淆（§11.4 值语义一致性延伸）。
- **推广顺序**：bitstr(已落地，C 后端；**LLVM 仍缺口**) → String（**已落地，双后端**) → Slice（**已落地，双后端**) → Array（**已落地，双后端**) → Map（**已落地，双后端**）。每推广一类须在 sema 加 `++` 分派分支 + 双后端发射 + conformance。
- **定长数组合并的长度算术**：`[N]T ++ [M]T ⇒ [N+M]T`（元素类型须一致，否则 `T-BIT-E515`）。⚠ **结果类型是新增的第三种类型**，既不沿用左型也不沿用右型——而 t 的二元运算结果类型推导默认「取左操作数类型」（`codegen_c.expr_type_desc` binary 分支、`tir.tc` `tir_emit_binary` 的 `ost` 回落 `tir_expr_st(n.na)`）。故数组 `++` 必须在两处显式覆盖结果类型，否则结果槽按 `[N x T]` 分配却被写入 `N+M` 个元素（写穿邻槽），且下游只拷回前 N 个（实测拼接结果尾部恒为 0：`10 20 30 0 0`）。现已于 `tir.tc` 的 `tir_expr_td` 与 `tir_emit_binary` 两处加 `Concat` 特判。
- **兼容处置**：若 t 现有 `+` 曾用于字符串/切片拼接，需改为 `++` 并在迁移期保留诊断（如 `T-OP-W...` 提示「用 ++ 拼接集合」）；纯数值 `+` 不变。
- **`++` 与自增冲突**：核查 lexer 是否已用 `++` 作自增（C 风格）；若已占用，bitstr/集合合并的 `++` 与之在语法位置（中缀 vs 前缀/后缀）可共存，否则需改自增为 `+=` 或 `+= 1`。见 §15.7 核查。

## 16. 实施状态（2026-09-25）

### 16.1 已落地（C 后端 + 前端 + **LLVM 后端**）
- **词法**：`lex.tc` 新增两字符 token `PlusPlus`（`++`，与 `+=` 字符对不冲突）。
- **语法**：`parse.tc` 新增 `parse_concat`（`++` 中缀层级，介于 range 与 in 之间）；`parse_primary`/`parse_match_alt_atom` 在 primary 位置把 `<<` 当作位串字面量起点（`ShiftLeft` 在 primary 位置 = 位串字面量，左移需左操作数，无冲突）；新增 `parse_bitstr_lit(pat)` 解析 `<<v:W, ... | v/bitstr, ...>>`。
- **类型**：`sema.tc` 新增 TI kind `BitStr` 与 TD cat `bitstr` 全链路（`resolve_ti`/`resolve_type_desc` 的 `named`/`ident` 分支、`ti_from_td`、`ti_to_td_base`、`ti_to_type_node`、`mk_type_node_from_ti`、`ti_equal`、`td_readable`、`desc_to_c`）；`base.tc` 新增节点 `bitstr`/`bitstr_seg`/`bitstr_pat` 与构造子。
- **`++` 分派（§15.6 推广）**：`sema.tc` `Concat` 运算支持 `BitStr`/`String`/`Slice`/`Array`/`Map` 五类（切片与数组均按 `ti_equal` 比元素类型，不一致 → `T-BIT-E515`；数组结果长度 = 两侧 `alen` 之和；Map 按 `ti_equal` 比 key/val 类型，不一致 → `T-BIT-E515`，合并时重叠键右操作数覆盖左）。
- **位串字面量推断**：总位宽 = 各定长段 `Width` 之和；非整数字面量位宽 → `T-BIT-E511`；多于一个 `/bitstr` 尾段 → `T-BIT-E516`。
- **C 后端发射**：`codegen_c.tc` 位串字面量 → `t_bitstr_new` + 逐段 `t_bitstr_append_val`（MSB-first 位打包）；`++` 按操作数类型分派 `t_str_concat`/`t_bitstr_concat`/`t_slice_concat`/`t_array_concat`/`t_map_concat`（数组以**字节数**传参 `sizeof(T)*N`，结果 arena 分配；`var c: [N+M]T = a ++ b;` 须直接以指针形态声明，不能走 `T c_abuf[N+M] = <ptr>;` —— C 不允许用指针初始化数组；map 即 `TMap*`，与 String/Slice 同构无需字节数）。
- **LLVM 后端发射**：`tir.tc` 新增 `TIR_OP_CONCAT(=63)`；`opmap.tc` 的 `tir_binop`/`tir_op_from_str` 双向映射；`tir_to_ll.tc` 按 st 分派 `tll_str_concat`/`tll_slice_concat`/`tll_array_concat`/`tll_map_concat`（数组 out 排末位，写入调用方 alloca 的 `[N+M x T]`，不另分配；**map 走返回值形式** `TMap* tll_map_concat(TMap*, TMap*)` —— TMap 在 shim 头仅前置声明（不完整），无法做 `*out = *r` 赋值，故不复用 sret 末位 out；且 map 变量是 alloca ptr 槽、槽内才是 TMap* 句柄，须 `load` 出句柄再传，否则把槽首 8 字节当 key_kind→乱建空表）；两侧字节数用 `getelementptr <arrTy>, ptr null, i32 1 → ptrtoint` 惯用法精确求得（对任意元素类型成立，含嵌套聚合 —— 不用 `ll_sizeof_st`，它对未登记的聚合元素会兜底返回 8）；`t_shim_ll.c` 新增 `tll_slice_concat`/`tll_array_concat`/`tll_map_concat`。**BitStr 在 LLVM 仍为既有缺口**（位串字面量尚未在 LLVM 实现，`++` 对 bitstr 在 LLVM 静默 no-op，与改动前一致）。
- **运行时**：`t_runtime.c/.h` 新增 `TBitStr{ptr,bit_len,cap}` 与 `t_bitstr_*` 系列，以及 `t_slice_concat` / `t_array_concat` / `t_map_concat`（arena 分配，复制两份缓冲；数组版按字节数传参，不反推元素布局；map 版先灌 a 全部条目再灌 b 条目、重叠键 b 覆盖 a）；`t_shim_ll.c` 新增 `tll_slice_concat`/`tll_array_concat`/`tll_map_concat`（map 走返回值形式）。

### 16.2 验证
- **自举不动点**：`g_bit`(seed→src) → `g2` → `g3` → `g4`，三代为 `src/tc.tc` 的 emit-ll md5 完全一致，确认改动不破坏自托管。
- **端到端（C 后端）**：`examples/bitstr_demo.tc` 经 `compile --emit-c` + clang 链接运行，输出 `byte=184`（6-bit 合并 `101110` = 0xB8），返回字节计数 1。
- **端到端（双后端 `++` 推广）**：`examples/concat_demo.tc`（`String ++`、`Slice ++`、**Array `++`**、`Map ++`）经 C 与 LLVM 两后端运行，输出一致（`Hello, World!` + `1..5` + `10..50` + `a=1/b=20/c=3`，Map 重叠键 b 覆盖 a），已补 `.expected.txt` 纳入 gate 双后端对拍。
- **前端 conformance**：bitstr 4 例（`p_bitstr_basic` / `f_bitstr_width` E511 / `f_bitstr_tworest` E516 / `f_bitstr_concat_type` E515）+ `++` 推广 5 例（`p_concat_basic` / `p_concat_array` / `p_concat_map` / `f_concat_slice_elem` E515 / `f_concat_map_kv` E515），均按预期通过 `--check`。
- **IR 基线**：改前端后已用 `ir_snapshot.mjs --update --compiler g1.exe` 重录（**项目不变量：基线须由 g1.exe 录制**，gate.mjs:261-263 / :561；gate 快照步比较的正是 g1 的发射；113 targets / 342 entries）。
- **`++` 冲突核查（§15.6）**：全量扫描 `src/`、`examples/`、`lib/`、`tests/conformance` 既无 `a++`/`++a` 自增用法，确认 `++` 中缀引入无二义（见 §15.7）。

### 16.3 待办（后续增量，本期未做）
- **LLVM 后端**：`codegen_ll.tc` 的 `bitstr` 字面量 / `Concat` / `for_each` 发射（当前 `build` 默认走 LLVM，`examples/bitstr_demo.tc` 刻意未配 `.expected.txt` 不参与双后端对拍，待 LLVM 补齐后补配）。
- **位串模式匹配**：`bitstr_pat` 当前占位 `(*(TBitStr*)0)`；`§6` 的 match 解糖（段内 ident 绑定 + 运行时位解包）未实现。
- **`.len`/`.bit_len` 成员**：位串逻辑位长访问（当前 demo 借 `for (x in c)` 计数绕开）。
- **`++` 推广**：**Map 合并已落地**（双后端），至此 §15.6 推广顺序五类（bitstr/String/Slice/Array/Map）全部收口；唯 bitstr 在 LLVM 仍静默 no-op（既有缺口，非本次回归）。
- **BinarySerde 交互**：`@derive(BinarySerde)` 与 bitstr 的衔接（§14.2 列为 deferred gap）。

