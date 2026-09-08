# TIR 全面数据结构化 —— 实现迁移路线（v3 S0/S2 子路线）

> 状态：实现路线草案 v0.1（设计已锁定，本文件只讲「如何从现状走到目标」）
> 作者：Buddy
> **本文件定位**：`tir-design.md`（设计）、`pipeline-implementation-route.md`（切片 S-1…S5 + §5.3/§5.6 硬规则）已锁定**设计**。本文件是**实现迁移路线**——把 `src/tir.tc` / `src/tir_to_ll.tc` 从「当前字符串化中间态」逐步重构为 §5.3 合规的结构化形式。**不重述设计，只列 GAP 与切片。**
> 关联：`docs/compiler/tir-design.md §4.1`、`docs/compiler/pipeline-implementation-route.md §5.3/§5.6`、`src/tir.tc`、`src/tir_to_ll.tc`、`tools/_diffpipe.mjs`

---

## 0. 适用范围

- 当前 TIR 实现是 `src/tir.tc`（`lower`）+ `src/tir_to_ll.tc`（`translate`）。仓库内**无 `tir.zig`**；若未来有 Zig 移植版，本路线「三刀 + FS 切片」方法逐字适用（病根相同：文本 round-trip 把 `op`/`st` 变成字符串）。
- 本路线只动 TIR 数据模型与翻译器接口，**不动** sema 语义规则、不动双后端已落定的 ABI（§5.2）。

---

## 1. 为什么不从 tokenizer 开始（核心判断）

`op: string` / `st: string` 不是「缺个好 tokenizer」造成的，而是**文本 round-trip 的产物**：

```
现状（非合规）：
  tir.tc (lower) ──emit 文本行(tir_line/sb_cat*)──▶ tir_to_ll.tc (translate)
                    ▲                                  │
               tir_tokens() 分词                   tir_parse_inst() 解析回结构
```

- `tir_tokens` / `tir_parse_inst` 正是你想「全面结构化」时要**删除**的那层，不是地基。
- 从 tokenizer 起步 = 在症状上盖楼。正确方向：**让 TIR 在内存里就是结构化的，`lower` 直接填 `[]TirInst`，`translate` 直接遍历，永不落文本、永不解析。**

> 结论：**不要碰 tokenizer，要删 tokenizer。** 文本 `.tir` 仅保留为 `TirModule` 的**单向派生**（快照 / 人读），不得被解析回喂（§5.6 判据 5）。

---

## 2. 设计权威（不重述，照办）

| 主题 | 真相源 | 要点 |
|---|---|---|
| `TirOp` / `StorageType` / `TirOperand` 形状 | `pipeline-implementation-route.md §5.3` | 枚举 / 结构体，零 string 语义载体 |
| 指令集（opcode 全集） | `tir-design.md §6` | 新增一条指令 = 给 `TirOp` 加变体 + 发射器/双后端各加 `match` 分支 |
| 层间硬规则（禁止 string 承载语义） | `pipeline-implementation-route.md §5.6` | 违反即回滚 |
| 迁移切片编号 | `pipeline-implementation-route.md` S-1…S5 | 本路线对应 S0（类型槽）+ S2（吸收/下线 `tir_to_ll.tc`） |

---

## 3. 目标数据结构（§5.3 落地形态，`t` 侧建模建议）

`t` 是 struct 值模型（代数 enum 带 payload 在 `t` 里需 struct 承载），故推荐 **struct + `kind` 判别式**建模，不用 `t` enum 带 payload（bootstrap 安全）：

```t
// 存储类型格（取代 st:string）。§5.3 StorageType + tir-design.md §5。
pub struct StorageType {
    kind: i64;          // 0=I1 1=I8.. 区分 i/u；见下「kind 编码」
    pointee: i64;       // kind==Ptr 时 → StorageType 索引（自指 TT 或内联）
    aspace: i16;        // device 地址空间（host=0）
    elem: i64;          // Arr/Vec 元素类型索引
    len: i64;           // Arr 长度 / Vec lanes
    params: []i64;      // Fn 形参类型索引
    ret: i64;           // Fn 返回类型索引
    name_id: i64;       // Named(%Name) → TT 条目索引；debug 名在 TT
}

// 操作数：自带类型（关键——干掉 g_tir_last_st 侧信道）
pub struct TirOperand {
    kind: i64;          // 0=Slot 1=Global 2=Imm 3=Null 4=Str 5=Block
    name: string;       // $/@ 标识（仅标识符，合法 string）
    st: StorageType;    // 本操作数自身存储类型（值/类型随操作数走）
    imm: i64;           // Imm 整数位模式
    fimm: u64;          // Imm 浮点位模式
    id: i64;            // Str → strings 表索引；Block → 块标签
}

pub struct TirInst {
    op: TirOp;          // 枚举（取代 op:string）
    st: StorageType;    // 结果存储类型（取代 st:string）
    dst: TirOperand;
    args: []TirOperand;
    line: u64;          // 源锚点（诊断）
}
```

`TirOp` 枚举（opcode 全集见 `tir-design.md §6`）：`Store/Load/AddrOf/Gep/Extract/Insert/Const/ConstPtrNull/ConstStr/ConstZero/Add/Sub/Mul/UDiv/SDiv/URem/SRem/FAdd/FSub/FMul/FDiv/And/Or/Xor/Shl/L Shr/AShr/Neg/FNeg/Not/Eq/Ne/SLt/SLe/SGt/SGe/ULt/ULe/UGt/UGe/FOeq/.../Sext/Zext/Trunc/FpToSi/.../Bitcast/IntToPtr/PtrToInt/StructNew/ArrayNew/VecNew/ClosureNew/Call/CallInd/Block/Br/BrCond/Switch/Ret/RetVoid/Comment`。

`TirModule` / `TirFunc` / `TirType` 沿用现状字段，但 `params`/`ret_st`/`TIRType.body` 的 string 形态也改为 `StorageType`（§5.3 `TirFunc{params:[]StorageType, ret_st:StorageType}`、`TirType{name, st:StorageType, fields:[]TirField}`）。

> 唯一合法 string 语义载体：**无**。`string` 仅出现在 leaf 数据：`TirModule.strings`（用户字面量）、`TirType.name`（调试名），且不进任何推断（§5.3 判据 1）。

---

## 4. 当前实现 vs 目标 的 GAP

| 维度 | 现状（`src/tir.tc`） | 目标（§5.3） | 差距等级 |
|---|---|---|---|
| `TIRInst.op` | `string`（"store"/"add.i64"…） | `TirOp` 枚举 | 高 |
| `TIRInst.st` | `string`（"%TStr"/"i64"） | `StorageType` 结构体 | 高 |
| `TirOperand` | `{ name: string }`（无类型） | 自带 `st: StorageType` | 高 |
| 类型来源 | `g_tir_last_st` / `ll_get_st` 侧信道全局 | 读 `inst.st` / `operand.st` | 高（根因） |
| `TirFunc.params` | `[]string`（"$p: ST" 文本） | `[]StorageType` | 中 |
| 层间传递 | `tir_line(sb_cat*)` 文本 → `tir_tokens` → `tir_parse_inst` | 内存 `[]TirInst` 直遍历 | 高（根因） |
| `.tir` 文本 | 序列化即按行展开、`tir_parse_inst` 回喂 | 单向派生，不回喂 | 高 |

> 现状是「结构化操作数 + 结构化指令体 + 字符串 `op`/`st` + 文本桥」的**中间态**（S0 已部分落地但 §5.3 未达）。本路线把它推到终点。

---

## 5. 三刀（全面结构化 = 这三刀，不落文本）

**刀 1：`op` 枚举化**。`op: string` → `TirOp`。翻译器 `match inst.op` 分支，不再 `if (raw == "store")`。新增指令 = 加枚举变体，无文本协议可踩。

**刀 2：`st` → `StorageType`**。LLVM 拼写串（`"%TStr"`/`"i64"`）改为结构化 `StorageType`；LLVM/C 拼写**只在 emit 边界**用 `tir_td_to_ll(st)` / `tir_td_to_c(st)` 现推（复用 `ll_td`/`desc_to_c` 的收敛版）。这直接消灭 `g_tir_last_st` / `ll_get_st` 跨模块调用 hack——我们已踩的 f64 退化为 `i64`、bitcast 值/类型错位均源于此。

**刀 3：操作数自带类型**。`TirOperand{ name, st }`。类型随值走，`tir_emit_binary` 直接读 `args[0].st`/`args[1].st`，**彻底删除 `g_tir_last_st` 侧信道**。`name` 保留 string（标识符天经地义），不做过度设计。

---

## 6. FS 切片迁移路线（每片以双轨对拍 69/69 为合并门槛）

> 门禁：`node tools/_diffpipe.mjs --compiler out/dbg/tc_new.exe --jobs 4`，要求 `new_out == old_out == expected` 双轨一致、零回退。bootstrap 构建 `node tools/_build_tc.mjs` 须在 sandbox 外（`dangerouslyDisableSandbox`）跑 ~43s。

### FS-0 预备：清调试桩 + 修发射期崩溃 —— ✅ 已完成（2026-09-08）
- **改动**：删 `src/tir.tc` 内定位崩溃时遗留的 `DBG-*`/`MARK-*`/`dbgln` 插桩（含 `tir_to_ll.tc` 的 `MKI`、`tc.tc` 的 `MK-LOWER-*`）；修两个发射期崩溃根因。
- **根因 A（TD/TI 双池混用，`tir.tc` ~3000）**：`sema.variant_decl_of(scr_td)` 内部走 `tip_kind`/`tip_name` → 索引 `sema.tis[]`（TypeInfo，len=209），而实参是 `sema.tds[]` 索引（TypeDef，len=216）→ `index_out_of_bounds index=215 length=209`。改用 `t_variant_decl_of_name(sema.tds[scr_td].name)` + TD 上界保护（与 `t_td_is_variant` 同口径，不动 `sema` 以保旧轨逐字节不变）。命中 `match_demo` / `clause_demo`。
- **根因 B（`store` 解析器判别式误判裸字面量，`tir.tc` ~108）**：原判别式仅凭「`tk[1]` 不以 `$`/`@` 开头」就认定是带类型形式 `store <st> <dst> <val>`，于是全局 int 初始化发出的 `store 100 @g` 被拆成 `st="100"` + 空 `args` → `inst.args[0]` 索引空切片（`index=0 length=0`）。判别式补 `m>=4 && st_like`（首字符非数字且非 `-`）。命中 `meta`。
- **门禁实测**：`_build_tc` 通过；`_diffpipe --no-old --jobs 1` → **28/69（原 27/69，零回退）**，且 **emit-tir-ll 失败归零**（此前 3 例发射崩溃，现全部落到可比对阶段）。基线已冻结在 28/69。
- **意义**：两处崩溃都是「类型/操作数靠位置约定和字符串前缀猜」的直接后果 —— 刀 2（`StorageType`）与刀 3（操作数自带 `st`）之后，这两类 bug 在结构上不可能再出现。

### FS-1 立 `TirOp` 枚举，填充 `TIRInst.op`
- **改动**：定义 `TirOp`；`TIRInst.op: TirOp`；`tir_parse_inst` / 发射器（过渡期）用 `tir_op_from_str` 在桥处转换；`tir_to_ll.tc` 改 `match inst.op` 分支（暂保留 `st: string`）。
- **门禁**：69/69。
- **op 全集实测（`grep 'op == "..."' src/tir_to_ll.tc`，54 个）**，按族分组即枚举定义：
  - 算术/位：`add sub mul div sdiv udiv mod srem urem and or xor shl lshr ashr`
  - 比较：`eq ne slt sle sgt sge ult ule ugt uge`
  - 转换：`trunc zext sext fptrunc fpext sitofp uitofp fptosi fptoui bitcast`
  - 内存/聚合：`slot load store gep gep_idx addr_of struct_new slice_at str_at`
  - 常量：`const const.str const.ptr.null`
  - 控制流/调用：`block br br_cond ret ret.void call call_ind`
- **⚠ 关键发现（FS-1 必须一并处理）**：比较类 op 在**文本形态里带类型后缀**（`sb_cat3(cmpop, ".", st)` → `slt.i64`），即 **op 串本身携带类型信息** —— 这正是「字符串当数据结构」的最深一处。枚举化后必须拆成 `TirOp.Icmp(pred)` + 独立 `st` 字段，`pred` 用 `IcmpPred` 枚举（`Eq Ne Slt Sle Sgt Sge Ult Ule Ugt Uge`），禁止再把类型编进 op。
- **不在 FS-1 范围**：`ll_emit_builtin` 里按 `cn == "..."` 分派的 **81 个内建 callee 名**保持 string（callee 是标识符，语义上本就是名字）。若后续要枚举化，另立 FS-7（收益低于刀 2/3，优先级最低）。

### FS-2 立 `StorageType`，`st: string` → `st: StorageType`
- **改动**：定义 `StorageType`；全量替换 `st` 字段；删 `g_tir_last_st` / `ll_get_st`；发射器读 `inst.st` / `operand.st`。LLVM/C 拼写下沉到 `tir_td_to_ll`/`tir_td_to_c`。
- **门禁**：69/69。**这是最大一刀，也是收益最大的一刀**（干掉侧信道根因）。

### FS-3 `TirOperand` 自带 `st`
- **改动**：`TirOperand{ name, st }`；所有 `tir_emit_*` 构造操作数时填 `st`；删除一切「发射期按 `node.kind` 重推类型」的残留。
- **门禁**：69/69。

### FS-4 删文本 round-trip（核心收益兑现）
- **改动**：删 `tir_tokens` / `tir_parse_inst` / `tir_line` 文本构造；`lower` 直接写 `g_mod.funcs[i].body: []TirInst`；`tir_to_ll_emit(g_mod)` 遍历 `func.body` 直译。`.tir` 文本仅作 `tir_to_text()` 单向派生（快照/人读），不回喂。
- **门禁**：69/69。**此片后 `tir_to_ll.tc` 成为合规结构化翻译器（§5.3 / S2 要求），原文本原型可下线。**

### FS-5 收尾 `TirFunc` / `TirType` 字符串字段
- **改动**：`params: []StorageType`、`ret_st: StorageType`、`TirType{name, st, fields}`。删 `g_local_sts` 等去同步影子表（类型现随操作数走，不再需要独立 st 表）。

### FS-6 静态判据 + 接入 gate
- **改动**：加 grep/静态断言——`TirInst` 及 `op/dst/args/st` 字段**不存在 string 语义载体**；`tir_tokens`/`tir_parse_inst` 已删除。挂 gate（warn→error）。
- **完成判据**：§5.3 判据 1+2 全满足；S0 类型槽 + S2 吸收/下线 `tir_to_ll.tc` 达成。

---

## 7. 已实证陷阱（本会话踩过，照做可避）

| 陷阱 | 现象 | 规避 |
|---|---|---|
| **TD 索引越界** | `match_demo` `index_out_of_bounds` td=215 len=209 | lowering 填 `ty` 时 `assert ty < slice_len(sema.tds)`；不要靠运行期 `sema.tds` 在作用域隐式兜底 |
| **`g_tir_last_st` 侧信道** | f64 被当 `i64` 位加 | 刀 2/3 干掉；类型随操作数走 |
| **sret ABI 冲突** | `slice_literal_arg` 段错误（env 与 sret 隐藏指针争 arg0） | 仅闭包函数前置 `ptr %__env`；普通结构返回靠 LLVM 自动 sret |
| **切片/字符串下标手动 GEP** | `%TSlice` 被当 `ptr` 数组 | 用运行时 `tll_slice_at`/`tll_str_at`（新增 `slice_at`/`str_at` 伪指令 + emit handler） |
| **比较算子缺 dot** | `slt`+`i64`=`slti64` 不识别 | `sb_cat3(cmpop, ".", st)` |
| **elem_size=0** | 切片元素恒返回元素 0 | `tir_emit_array_lit` 第 4 字段填 `tir_sizeof(elem_st)` |
| **bootstrap 期跨模块调用** | 种子 `codegen_ll` 发 `; UNSUPPORTED call ll_get_st` → clang 链接失败 | `tir.tc` 不得调用 `tir_to_ll.tc` 定义的 `ll_get_st`；用 `g_tir_last_st` 模块内机制（过渡）或直接结构化类型 |
| **调试 `eprint` 改坏构建** | `sb_catN` 实参数不符 → `tc_new.exe` 停留旧构建、悖论 | 调试插桩用统一 `dbgln`（若运行时支持）；arities 必须核对；改完先 `_build_tc` 确认 `[build] done` |
| **bootstrap 构建须 sandbox 外** | sandbox 写 `.git`/链接失败 | `_build_tc.mjs` 走 `dangerouslyDisableSandbox` |
| **TD 池 ≠ TI 池** | `index=215 length=209`：喂 TD 索引给只吃 TI 索引的 `sema.*` API | `sema.tds[]`（TypeDef）与 `sema.tis[]`（TypeInfo）是**两个独立池**；跨池前先看该 API 内部走 `tip_*` 还是 `tds[...]`。TD 侧只用 `t_*_of_name(sema.tds[i].name)` 形态 |
| **裸字面量被当类型串** | `store 100 @g` 解析成 `st="100"` + 空 args → `index=0 length=0` | 判别 token 是否为类型串时必须排除数字/负号开头，且校验 token 总数（`m>=4`）；根治靠刀 2 结构化 `st` |
| **`file_write_all` 做崩溃存活日志不可用** | `tir.tc` 内 `dbgln` 写 `out/dbg/devdbg.txt` 文件根本不生成 → 伪造「插桩未触发」假象 | 崩溃定位一律用 `eprint`（abort 会 flush 已写部分），不要用文件 |
| **对拍被 SIGTERM 连带杀** | 前台 `timeout` + 轮询 `for` 等待 → 后台 diffpipe 进程组一起死（卡 11/69） | 用受管后台任务 + 完成通知；验证期加 `--no-old`（旧轨恒 69/69，不受 tir 改动影响）耗时减半 |

---

## 8. 完成判据（§5.3 硬规则自检）

1. `TirInst.op/dst/args/st` 全部为枚举/结构体，无 string 语义载体。
2. 无 `tir_tokens` / `tir_parse_inst` / `tir_line` 文本 round-trip；`translate` 直接遍历 `func.body`。
3. `_diffpipe` 双轨 69/69，且 `.tir` 文本仅为单向派生。
4. `g_tir_last_st` / `ll_get_st` / `g_local_sts` 影子表已删。
5. gate 含 string 语义载体静态断言，违反即阻断。

---

## 附：与现有文档关系

- `tir-design.md`：设计（§4.1 内存结构 / §5 ST 格 / §6 指令集）——本路线照办，不重述。
- `pipeline-implementation-route.md`：切片 S-1…S5 + §5.3/§5.6 硬规则——本路线是 S0/S2 的子实现路线。
- `tir_to_ll.tc`：FS-4 后由「文本解析翻译器」重构为「结构化翻译器」，或下线（S2 要求）。
