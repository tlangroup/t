# 语法规则草稿：fault 故障组 · trap 消费 · repair 修复候选

> **状态**：**设计已裁定（DESIGN-ADOPTED）** —— 2026-10-27 由设计者拍板，**尚未实装**。法律验证待做，不阻塞任何既有特性。
> **来源**：外部文档 `@//fault/`（故障模式声明成组）+ `@//clause/`（`@clause(.fault, ...)` 子句变体）。两份文档**不在本仓库内**（全仓 glob/grep 0 命中），本稿为其落地形态。
> **合并**：路径 ③ 独立草稿 `restart.md` 已于 2026-10-27 并入本稿并删除，其结论保留在 §1.2 / §1.3 / §5.2 / §8。
> **主路径**：**路径 ③（可传播修复）**。路径 ① 是它的退化特例（`recover` 为糖），路径 ② 已被 ③ 的隐式 `.abort` 覆盖 —— **三条路径收敛为一套机制**。
> **记号**：符合 `docs/reference.md` §1 Notation；下游扩展语法用 `// +` 标注为「新增产生式」。

---

## 0. 提案原文（供对照，含原始记号）

```text
// 单个故障
const denom_zero : fault(DivErr) = @clause(.fault, .{.denom=0}, DivErr.DenomZero);

// 故障组（++ 组合）
const frame_faults : []fault(FrameErr) =
      @clause(.fault, .{.magic != 0xCAFEBABE},          FrameErr.NotOurs)
   ++ @clause(.fault, .{.version > 2},                  FrameErr.VersionTooNew)
   ++ @clause(.fault, .{.version = 1, .flags.bit0 = 1}, FrameErr.CompressOnV1)
   ++ @clause(.fault, .{.opcode = DATA,  .stream = 0},  FrameErr.DataOnConn)
   ++ @clause(.fault, .{.opcode = CLOSE, .stream != 0}, FrameErr.CloseOnStream)
   ++ @clause(.fault, .{.opcode = DATA,  .len = 0},     FrameErr.EmptyData)
   ++ @clause(.fault, .{.len > 16384},                  FrameErr.TooLarge)
   ++ @clause(.fault, .{.len > 0, .csum = 0},           FrameErr.NoChecksum);

// 抛出
fn validate(u : User) : fault(UserErr)!User {
    if u.age < 0   { return Err(@clause(.fault, .{.age<0},   UserErr.AgeNegative)); }
    if u.name == "" { return Err(@clause(.fault, .{.name=""}, UserErr.NameEmpty)); }
    return Ok(u);
}

// 消费
trap validate(u) {
    @clause(.fault, .{.age<0},   _) => recover(User{ .age : DEFAULT_AGE, .name : u.name }),
    @clause(.fault, .{.name=""}, _) => recover(User{ .name : ANON,       .age : u.age }),
}
```

---

## 1. 裁定总表

> 「拿 validate 的错误返回值去和 pattern 语句比。variant 是一个实际存在的值定义，而 fault 的 pattern 仅仅是展示匹配语句，仅此而已。**fault 的 clause 语句仅仅存在编译期。**」（2026-10-27）

### 1.1 三条基础裁定（F-1/F-2/F-3）

| 裁定 | 内容 |
|---|---|
| **F-1 编译期专有的 clause** | `@clause(.fault, ...)` 不进入 IR、不进入运行时。谓词是**编译期数据**，不是运行时值 |
| **F-2 分派键 = 返回的 fault 身份** | `trap` 臂的比较是「返回的故障」vs「臂上写的 pattern」，不是「对入参重跑谓词」，也不是「臂谓词蕴含 guard 谓词」。匹配关系 = **恒等** |
| **F-3 运行期表示 = 纯错误 tag** | 无载荷、无消息、无栈回溯。运行期成本与 Zig 的错误联合完全同形 |

- **F-2 的直接推论（关键）**：被 `trap` 切换的域是**编译期有限、静态可枚举的 clause 集合**，不是无限谓词空间。
  ⇒ **穷尽性是静态可判定的**，且可直接复用于 `enum` 覆盖分析（`T-MAT-E742`）。
  ⚠ 这条推翻了早期评审「谓词分派 ⇒ 穷尽性不可判定」的结论。该结论只在「臂谓词可宽于 guard 谓词（蕴含式匹配）」或「运行时重跑谓词」两种语义下成立，二者均被 F-2 排除。
- **反之**：若日后允许 `.{ .age < 10 }` 一条臂同时盖住 `AgeNegative` 与 `AgeTooOld`，则立即落回不可判定。该能力若要做，须走既有 **S1 或模式** `p1 | p2 =>`（已实装，`examples/match_ext.tc`），即用「多条恒等臂共享一体」，而非放宽匹配关系。

### 1.2 第四条裁定：就近处理（F-4），与它被路径 ③ 修订后的形态

> 「设计 trap/recover 的本质而不是 try/catch 的本质：**错误就近处理，而不是一致向上传播。**」（2026-10-27）

| 裁定 | 内容 |
|---|---|
| **F-4 修复知识就近** | 「怎么修才对」的知识写在**抛出点**（数据在作用域里）；「选哪个修法」的决策权可以在任意层 |
| **F-5′ 上移作用域，不上移数据** | 传播需要上移的是**作用域（闭包）**，不是数据（载荷字段） |

- **F-5′ 的由来**：原 F-5（「就近⇒不需载荷；传播⇒必须补数据」）的后半段**已被路径 ③ 撤销**。因为 M48 闭包把抛出点的作用域打包带走，**无载荷与可传播不再冲突**。
  ⇒ 由此契约从「数据契约（载荷字段名，一改即破坏性变更）」降级为「**选择契约**（修法名）」。
- ⚠ **适用边界**随之放宽：处理点**不再需要**与抛出点共享作用域；但仍需满足 §3.1 的多策略判据。

#### 1.2.1 三条路径已收敛为一条

| 原路径 | 机制 | 现状 |
|---|---|---|
| ① 紧邻 `trap` + `recover` | 就地给出修好的值 | ✅ **保留，但是糖**：`recover(e)` 脱糖为 `resume(合成闭包)`（§4） |
| ② 带载荷上传 | 数据塞进错误 | ❌ **排除**：与 F-3 冲突，且已被 ③ 取代 |
| ③ 带修复闭包上传 | 抛出点注册若干 repair，上层只做选择 | ✅ **主路径**；隐式 `.abort` 覆盖「不修、继续上传」 |

### 1.3 路径 ③ 的三条技术论断（R-1/R-2/R-3）

| 裁定 | 内容 |
|---|---|
| **R-1 上移的是作用域** | 抛出点知道出了什么事（数据在手边），也知道若干种修法 ⇒ 打包成闭包；处理点不需要知道出了什么事，只从具名修法里选一个 |
| **R-2 按值捕获消掉了 restart 的时序约束** | Common Lisp 的 restart 必须 unwind 跳回抛出点执行，因其闭包捕获**引用**；t 的 M48 是**按值捕获**（`types.md:40`，合成 `__env_N` 堆分配）⇒ 闭包一旦构造即**自包含**，执行位置与时机完全无关 ⇒ **不需要 unwind、不需要 continuation、不需要新运行时机制** |
| **R-3 它是受限代数效应** | 与 OCaml 5 / Koka 对照，本提案把 `perform` 限制在**仅 `return` 位置** ⇒ resume 只需「提供返回值」而非「回到 perform 点继续」⇒ 省掉 delimited continuation（成本）与 effect row（类型复杂度） |

- **运行时机制现状（可直接复用）**：`%TClosure { ptr code, ptr env }`、统一 ABI `CALL_IND: code(env, args)`（`src/tir_to_ll.tc:241`）。
  ⇒ **路径 ③ 不新写任何 `tll_*` shim**，规避了历史上「out 参排末位」那类静默写错的风险。

---

## 2. 与 Zig result 的定位对照

| 维度 | Zig 0.17 | 本设计 | 判定 |
|---|---|---|---|
| 运行期错误表示 | 名字 = tag，无载荷 | tag，无载荷 | **同** |
| 携带详情的官方路线 | Diagnostics 出参模式 | 不携带数据，携带**修法闭包** | **异** |
| 分派键 | 错误名 | 结构化谓词（= 复合名字） | 异（记号层） |
| 穷尽性 | 有，缺 prong 即编译失败 | 有（依赖 F-2 恒等） | **同** |
| 集成设施 | `try` / `catch` / `catch err{...}` | `trap` / `resume` / 隐式传播 | 异 |
| 传播语法 | `try` / `?`，**必须写** | **零语法**（不 `trap` 即上传） | 异（本设计更省） |
| 组合 | `A \|\| B`，按名集合，无序 | 具名组，`++` 连接，**无序** | ⚠ 见 §8 A-1 |
| 推导集 | `!T` 推导（官方：公开 API 边界用它是**错的**） | **声明集**：`pub` 函数必须写组 | 见 §8 A-4 |

**定位**：落在「简单错误码」与「复杂错误结构体」之间 —— 运行期付错误码的钱，编译期拿结构化谓词与修复策略的信息量。

---

## 3. 与「更多 tag 的 variant」的正面对照

> 「当前设计使用更少的错误编码，同时又要得到更复杂的错误处理流程，是不是南辕北辙，还不如更多的 tag 的 variant？」（2026-10-27）

**结论：不是南辕北辙。** 关键在于两类信息的区分：

| 信息处理点需要的 | 来源 | 更多 tag 的 variant | 本设计 |
|---|---|---|---|
| **(i) 身份**：哪个守卫被触发 | 错误的 tag | ✅ 给（tag 越分越细） | ✅ 给（谓词即复合名字） |
| **(ii) 数据**：出错的那个值 | 载荷 / 闭包 | ✅ 给（`Err(AgeInfo{...})`） | ✅ 给（经闭包间接可用，**不进契约**） |
| **选择权归调用者** | — | ❌ 处理点自己写分支 | ✅ |
| **内部结构进 API** | — | ❌ **是**（字段名是契约） | ✅ **否**（契约只有修法名） |

- ⇒ **「更多 tag」只把 (i) 做粗，不解决 (ii)**。把 tag 加到 20 个不会让处理变复杂，只会让每个处理点的分支变多。
- ⇒ **本设计对 (ii) 的替代是「就近 + 上移作用域」**（F-4 + F-5′）。差异不在信息量，在**信息从哪里来**。

**本设计相对 variant 的真实差异**（其余都是记号层）：

| # | 差异 | variant 能否给 |
|---|---|---|
| 1 | 谓词自带语义，不用记名字 | ❌（名字是任意标识符） |
| 2 | raise 处与 handle 处共享同一谓词词汇，不一致即编译错 | ❌ |
| 3 | **组 → 生成 `if` 链 / 校验函数**（组是**规格**，variant 是**数据**） | ❌ 关键差异 |
| 4 | **谓词重叠 / 不可达的静态检查** | ❌ 关键差异 |
| 5 | **多策略选择权归调用者，且内部结构不进 API** | ❌ 关键差异（路径 ③ 带来） |

- ⭐ **必要性的全部重量压在 3、4、5 三项上**。若只做 1、2，它就是 `variant` 的语法糖，直接违反 **L-04 第 6 条** —— 此时"还不如更多 tag 的 variant"的判断**成立**。
- 反过来说：只要 3、4、5 落地，"用更少的错误编码得到更复杂的处理流程"就不矛盾了 —— 复杂度不在你写的代码里，在编译器从组里**生成**出来的代码里，在上层**选择**的策略组合里。

### 3.1 硬适用判据（决定是否值得做）

> **只有当「同一错误存在多种合理恢复策略，且选择权属于调用者」时，路径 ③ 才优于 variant + 载荷。**

- 若一个 fault 只有**一种**修法 ⇒ 路径 ③ 退化为「惰性载荷」（一个 thunk），此时直接就地 `recover` 或直接用带载荷 variant 更直白。**名字是本设计价值的全部来源；只有一个候选时名字没有意义。**
- 若处理点需要的确实是「数据本身」（要打印、要记录、要聚合统计）⇒ 本设计不适用，用 variant + 载荷。
- ⇒ **静态提示（非错误）**：sema 对「只挂一个 repair 的 fault」给出 `T-RST-W???` 提示，建议改为就地 `recover`。

---

## 4. EBNF（v1）

```ebnf
// —— 具名故障集：编译期声明，也是公开 API 契约 ——
// + （见 §8 A-6：clause 不进 IR，故不得用运行时容器类型）
FaultSetDecl: "fault" UpperIdent "over" Type "{" (FaultMember ";" )+ "}"
FaultMember:  PredPat "->" UpperIdent ( "repairs" "{" RepairName ("," RepairName)* "}" )?
//                                       ^ repair 名在此登记；登记后才是公开契约

// —— raise：必须写在函数体内（repair 要捕获该函数的作用域）——
// + scrutinee 显式写出，不做推导（§8 A-5）
RaiseExpr: "Err" "(" Expr "," FaultGroup ")"
FaultGroup:  FaultClause ("++" RepairClause)*
FaultClause:  "@clause" "(" ".fault"  "," PredPat "," Expr ")"
// + 新增变体
RepairClause: "@clause" "(" ".repair" "," RepairName "," FuncLit ")"
// + 修法名：成员式记号，与 .{ .f = v } 同形
RepairName:  "." ident
OkCtor: "Ok" "(" Expr ")"

// —— 谓词：具名字段约束的合取（无序，§8 A-1）——
PredPat:   "." "{" PredField ("," PredField)* "}"
PredField: "." FieldPath ("=" | "!=" | "<" | "<=" | ">" | ">=") Expr
// + 嵌套路径 `.flags.bit0`：见 §7 D3（建议改用 packed struct 规避）
FieldPath: ident ("." ident)*

// —— 类型 ——
FaultUnionType: "fault" "(" UpperIdent ")" "!" Type

// —— 消费 ——
TrapExpr: "trap" Expr "{" TrapArm+ "}"
// + 两式共用 => ，由右侧表达式形态区分，无二义
TrapArm: PredPat "=>" ( ResumeExpr | RecoverExpr ) ","?
ResumeExpr:  "resume"  "(" RepairName ")"     // 选一个具名修法并执行
RecoverExpr: "recover" "(" Expr ")"           // 就地给出值（糖，见 §5）

// —— 既有（供对照）——
FuncLit: "fn" "(" ParamList? ")" Type Block   // ⚠ t 现行无 -> 箭头（reference §3.4）
```

- **`PredPat` 与既有 `.{...}` 的关系**：`.{...}` 在当前 t 中已是**双义**记号 —— 匿名元组（位置式，`examples/tuple_demo.tc` 已落地）与前导点 struct 字面量（`.{ .x = 3 }`）。`match.md` 已采纳的 `StructLitPat` 覆盖 `.{ .x = lit }`（字面量相等）。
  ⇒ 本提案的增量**不是新造 `.{...}`**，而是把 `PatternExpr: Literal` 放宽到关系表达式，并加嵌套 `FieldPath`。
  ⚠ 位置式 `.{a, b}` 与本稿 `.{ .f = v }` 的消歧已由「字段是否带前导点」解决（`reference.md` §2991）。
- **`resume` 无保留字冲突**：全仓 `src/*.tc` 与 examples 0 命中（t 亦无协程 / `yield`）。
- **repair 必须写在函数体内**：硬约束，不是风格。R-1 要求闭包捕获抛出点作用域，而具名组声明在顶层，那里没有 `u`。

---

## 5. 语义三层与脱糖

| 层 | 内容 | clause 是否还在 |
|---|---|---|
| 源码层 | 具名组（无序）、谓词、错误名、repair 名、内联 raise | 是 |
| **sema 层（IR 边界之前）** | ① 谓词 → 合取表达式（规范化后比较）；② 组 → 错误成员枚举；③ repair 名 → **编译期槽位索引**；④ `trap` → `match(tag)` + 常量索引取闭包 + 间接调用；⑤ 组 → `if` 链 / 校验函数 | **clause 在此消失** |
| 运行层 | `{ tag: i64, repairs: [N]%TClosure }` | 否 |

**脱糖纪律（L-04）**：全部降为既有节点（`match` / 结构体 / `CALL_IND`），不引入独立语义、不加新发射路径。

```text
trap validate(u) {
    .{ .age < 0 }  => resume(.use_default),
    .{ .name = "" } => resume(.anon),
}
```
⇒
```text
match (__fv.tag) {
    USER_ERR_AGE_NEGATIVE => __fv.repairs[0](),   // 索引为编译期常量
    USER_ERR_NAME_EMPTY   => __fv.repairs[2](),
}
```

- **运行时布局固定大小**：`N` = 该函数所有 (clause, repair) 槽位总数，编译期常量；未被当前 clause 使用的槽置 null。
  ⇒ 按值返回，无额外堆分配（闭包 env 自身的分配另计，见 §7 R-opt1）。
- **`recover(e)` 是糖，不是新语义**：脱糖为 `resume(合成闭包 fn() T { return e; })`。
  ⇒ 路径 ① 因此是路径 ③ 的退化特例，两者共用一套机制，**不构成 L-04 第 6 条的"多写共存"**。
- **穷尽性（L-03）**：`trap` 的覆盖判定 = 组内每个 clause 是否至少被一条臂引用；与 `enum` 全 case 覆盖同一套分析。
- **生成收益（提案原文未使用，本稿要求补上）**：既然 clause 是编译期数据，`validate` 体内的 `if` 链**应由组生成**，谓词在组内只出现一次，满足单一真源。

---

## 6. 示例

### 6.1 最小例（User）

```t
// 具名故障集：谓词 + 错误名 + 修法名，一次登记，三处共享
fault UserErr over User {
    .{ .age < 0 }  -> UserErr.AgeNegative repairs { .use_default, .clamp };
    .{ .name = "" } -> UserErr.NameEmpty  repairs { .anon };
}

fn validate(u : User) fault(UserErr)!User {
    if u.age < 0 {
        return Err(u,
              @clause(.fault, .{ .age < 0 }, UserErr.AgeNegative)
           ++ @clause(.repair, .use_default, fn() User { return User{ .age : DEFAULT_AGE, .name : u.name }; })
           ++ @clause(.repair, .clamp,       fn() User { return User{ .age : 0,          .name : u.name }; })
        );
    }
    if u.name == "" {
        return Err(u,
              @clause(.fault, .{ .name = "" }, UserErr.NameEmpty)
           ++ @clause(.repair, .anon, fn() User { return User{ .name : ANON, .age : u.age }; })
        );
    }
    return Ok(u);
}

// 调用点：只选策略，不碰内部结构
var good : User = trap validate(u) {
    .{ .age < 0 }  => resume(.use_default),
    .{ .name = "" } => resume(.anon),
};
```

### 6.2 跨层传播（路径 ①② 做不到、路径 ③ 免费的场景）

```t
fault FrameErr over Frame {
    .{ .magic != 0xCAFEBABE } -> FrameErr.NotOurs  repairs { .skip, .as_raw };
    .{ .len > 16384 }         -> FrameErr.TooLarge repairs { .truncate };
    // … 其余成员
}

// 层 1：库作者提供策略集（他知道数据，但不知道该选哪个）
fn decode(buf : bytes) fault(FrameErr)!Frame {
    if !is_ours(buf) {
        return Err(f0,
              @clause(.fault, .{ .magic != 0xCAFEBABE }, FrameErr.NotOurs)
           ++ @clause(.repair, .skip,   fn() Frame { return FRAME_NOP; })
           ++ @clause(.repair, .as_raw, fn() Frame { return raw_frame(buf); })
        );
    }
    if buf.len > 16384 {
        return Err(f0,
              @clause(.fault, .{ .len > 16384 }, FrameErr.TooLarge)
           ++ @clause(.repair, .truncate, fn() Frame { return trunc_frame(buf, 16384); })
        );
    }
    return Ok(parse(f0));
}

// 层 2：不 trap ⇒ 自动上传，零语法（对比 Zig 的 try / Rust 的 ?）
fn serve(c : Conn) fault(FrameErr)!Frame { return decode(read(c)); }

// 层 3：只有这里知道业务意图，也只有这里做选择
fn route(c : Conn) void {
    var f : Frame = trap serve(c) {
        .{ .magic != 0xCAFEBABE } => resume(.skip),      // 宽松模式：跳过陌生帧
        .{ .len > 16384 }         => resume(.truncate),  // 宁可截断也要继续
        _                          => resume(.abort),     // 其余一律中止（隐式 .abort）
    };
}
```

⇒ **策略的选择权与定义权分离**，且分离不需要任何数据外流。同一份 `decode` 在另一调用点可选 `.as_raw` / `.abort`，库代码一字不改。

---

## 7. 依赖与成本

| 编号 | 依赖项 | 现状 | 增量 | 量级 |
|---|---|---|---|---|
| D1 | `@clause` 与一等 clause 组 | ✅ 已落地：`@clause(.pattern,...)`、组 `[C0,C1]`、`match(x){G}` 展开 + N11 重排（`examples/clause_expand.tc`） | 新增 `.fault` / `.repair` 变体 + 谓词存储 + 组展开点 | 小 |
| D2 | `.{ .f = v }` 具名字段模式 | ⚠ `match.md` 已采纳 EBNF，但**全仓 examples/tests 无覆盖** | 先补 conformance/双后端用例证其可用，再扩展 | 小 |
| D3 | 谓词中的关系表达式 + 嵌套路径 `.flags.bit0` | ❌ 未落地。`PatternExpr` 现仅 `Literal` | 扩展 `PatternExpr` + 位访问 | 中 |
| D4 | `++` | ✅ 已存在（opmap `Concat`/63，`tll_slice_concat`） | 0 | 0 |
| D5 | `fault(E)!T` 错误联合运行时表示 | ⚠ 参照 `Optional`：kind / `ti_str` / `ti_equal` / `resolve` 已在，**值级 API 未落地**（P1 首任务） | 新 TI kind | 大 |
| D6 | 用户自定义参数化类型 | ❌ 无证据。泛型当前仅作用于**函数**与类别子句 | **可从关键路径摘除** —— 因 F-1，每个 `(E,T)` 实例由 sema 直接合成，不需要用户可写泛型 | 0 |
| D7 | 谓词规范化与恒等比较 | ❌ 全仓 0 命中 | 新 sema 算法：合取项排序 + 原子约束规范化 | 中 |
| **R-1** | **闭包** | ✅ **已实装 M48**：按值捕获、`%TClosure{ptr code, ptr env}`、统一 ABI | **0**。路径 ③ 直接站在它上面 | **0** |
| R-2 | `resume` 静态解析 | ❌ | 修法名 → 槽位索引，编译期完成 | 小 |
| R-3 | 可达集分析（跨函数） | ❌ | 与 §8 A-4 的声明集共用基础设施；`.tlib` 存 TIR 可承载摘要 | 中 |

**关键结论**：
- 因 F-1「clause 仅编译期」，**D6 摘除**；`.{...}` 从不进入运行时模式匹配，故不依赖 S11（struct 字段**绑定**解构）。
- 因 R-2「按值捕获」，**R-1 = 0** —— 路径 ③ 不需要任何新运行时机制。
- 真正花钱的：**D3 / D7（编译期活，不碰后端）+ D5（新类型 kind）+ R-3（跨函数分析）**。

### 7.1 优化项（非 v1 必需）

| 项 | 内容 |
|---|---|
| R-opt1 | 组内所有 repair 共享**同一个 `__env_N`**（捕获的是同一批变量），差异只在 fn 指针 ⇒ N 个 repair 只需 1 次 env 分配 |
| R-opt2 | 更激进：运行时只传 `env` 指针一次 + N 个 code 指针，省掉 N 个 TClosure 结构 |
| R-opt3 | env 构造只发生在**错误路径**上；成功路径零成本 |
| D3-opt | `.flags.bit0` 别给 `u16` 新造位访问内建：把 `flags` 声明成 `packed struct`（`bit0: u1`）→ 走既有成员访问，零成本 |

### 7.2 ⚠ D2 的实地核查结论（2026-10-27，推翻三条预估）

| 原预估 | 实地证据 | 结论 |
|---|---|---|
| 「KI-002 未修，struct 字面量模式在 LLVM 轨恒命中首臂」 | `match.md` §6.3 正文（L345）记 2026-09-26 已修；`src/tir.tc:5827` 的 `struct_lit` 条件分支真实存在；`examples/tuple_match_demo` / `tuple_destructure_demo` 双端 PASS。**§6.3 标题仍写 `open`，是过期文档债务** | **KI-002 已修**，不构成 B2 前置阻塞；但 `tests/known-issues/` **不被 conformance/difftest 自动扫描**，该目录无回归价值 |
| 「`.{ .f = v }` 零覆盖 ⇒ parse 要从零做」 | `src/parse.tc:887` 具名字段循环**已支持 `.f = v`**（与旧式 `f: v` 并存） | parse 通路**已存在**，但零用例 ⇒ 未验证 |
| 「C / LLVM 两条链各改一遍」 | `match_chain_from` 在 `src/*.tc` 中**只出现在注释里，无定义**；`codegen_c.tc` 内无任何 `struct_lit` 处理 | **TIR 是 match 的单一语义真源**，C 与 LLVM 都消费 TIR ⇒ 改 TIR 一处即双后端一致 |

---

## 8. 已裁定的设计决策（2026-10-27）

| # | 议题 | **裁定** | 理由 |
|---|---|---|---|
| A-1 | 组的有序性 | **无序；组内有重叠即报编译错** | 有序会让 `++` 不满足交换律（`.len>16384` 与 `.len>0,.csum=0` 重叠时谁赢靠位置），"可组合"名不副实。重叠直接报错同时兑现差异项 4 |
| A-2 | 谓词唯一性 | **强制唯一；重复报 `T-FLT-E???`** | 恒等分派要靠谓词定位 clause，重复即无法分派。`repair` 名同理，同一 fault 下重复报错 |
| A-3 | 谓词规范化程度 | **仅做合取项排序**（令 `.a=1,.b=2` ≡ `.b=2,.a=1`） | 不做 `<0` ⇄ `<=-1` 那类推理级归一，避免引入不可判定 |
| A-4 | 推导集 vs 声明集 | **声明集**：`pub` 函数必须写具名组；非 `pub` 可内联推导 | Zig 官方明说「推导集在公开 API 边界是错的」；且 repair 名是契约，必须登记 |
| A-5 | scrutinee 类型 | **`Err(<scrutinee>, <group>)` 显式写出** | 不引入推导魔法；`fault(E)!T` 里不重复写 scrutinee 类型 |
| A-6 | 组类型记号 | **编译期声明 `fault E over T { ... }`，不用 `[]fault(E)`** | 原提案给「仅存在于编译期的东西」标运行时切片类型，自相矛盾 |
| A-7 | 走哪条路径 | **直接做 ③（主路径）；① 为退化特例（`recover` 是糖）；② 排除** | ① 的 `recover` 只是合成闭包，先做 ① 会产出随后被替换的中间形态；② 与 F-3 冲突且已被 ③ 的 `.abort` 覆盖 |
| A-8 | 签名是否写 `!T` | **写** | ③ 的传播是默认且隐式的 ⇒ 类型必须能承载故障集。代价换来「传播零语法」 |
| A-9 | `.abort` | **隐式**，归入 `resume` 家族（不新增 `escalate`） | 词汇更少，L-04 友好；与 Common Lisp 惯例一致 |
| A-10 | `resume` / `recover` | **并存；`recover` 是糖** | 二者不构成同一语义的多写（后者脱糖为前者） |
| A-11 | 修法名作用域 | 同一 fault 下重复报错；**不同 fault 下允许同名** | 谓词已区分，无需全局唯一 |
| A-12 | repair 跨函数复用 | **禁止** | 闭包捕获的作用域是函数私有的，跨函数引用会破坏 R-1 的前提 |
| A-13 | repair 内再 raise | **允许**；故障集取并集，由 sema 计算，不需手写 | 修法本身也可能失败 |
| A-14 | 文档分工 | **合并为一份，路径 ③ 为主路径**（已执行，`restart.md` 并入后删除） | — |
| A-15 | 无 repair 的故障 | 不带 repair 的 fault 必须 `recover` 或 `resume(.abort)` | 保证「修不了还硬修」不可能发生 |

---

## 9. 能力边界与法律验证

### 9.1 做不到什么（诚实列出）

| 做不到 | 原因 | 替代 |
|---|---|---|
| repair 就地改写抛出点的局部变量 | 按值捕获（R-2），拿到的是拷贝 | 需要改写的状态以**指针**传入，或移出局部作用域 |
| 回到抛出点**中间**继续执行 | R-3 的 return 点限制 | 不需要：本设计的"恢复"就是提供返回值 |
| 处理点读取出错的**数据本身**（打印/统计/记录） | F-3 无载荷 | 用 variant + 载荷（§3.1 判据） |
| 未处理的故障自动崩溃 / 打印调用栈 | 无异常栈机制 | 由 `.abort` 传到顶层后由顶层决定 |

### 9.2 法律验证（待做）

| 法律 | 判定 | 说明 |
|---|---|---|
| L-03 静态类型 | ✅ | 每个 `resume` 的返回类型由闭包签名静态给定，与函数成功类型统一；穷尽性复用 `T-MAT-E742` |
| L-04 唯一语义 | ⚠ 待核 | `resume` / `recover` / `.abort` 三式须确认不构成同一语义的多写（当前设计下 `recover` 是糖，`.abort` 是 `resume` 的一个名字，理论上收敛） |
| L-14 铁壁 | ✅ | 「修法名在该 clause 内必须存在」「谓词重复」「组内有重叠」均静态可判定 ⇒ 硬错误 `T-FLT-E???` / `T-RST-E???` |

---

## 10. 门禁矩阵（实装时逐项落实）

| 项 | 内容 |
|---|---|
| 静态 | `tools/conformance.mjs` pass/fail：组声明 / 谓词 / trap / 未覆盖 / 谓词重复 / 组重叠 / 修法名未登记 / 跨层传播 |
| 运行期 | ⚠ **conformance 只做静态检查、从不运行程序** ⇒ 必须补 `examples/fault_*.tc` + `restart_*.tc` 的 `.expected.txt` **双后端对拍**。⭐ 路径 ③ 引入闭包调用，属运行期语义改动，golden 不可省 |
| 自举 | `tc check src/tc.tc` → 自举 g1/g2 → gate L2 多代比对（IR 快照基线**必须用 g1 录**，不能用 `tc.exe`） |
| 节点 | 新增 node kind 须改 `tools/cstgen.mjs` 后 `--emit` 重生成，**禁止手改 `base.tc` 的 `GEN:node-structs` 区** |

---

## 11. 落地批次拆分（B1–B6，每批独立过门禁）

| 批次 | 内容 | 依赖 | 是否碰后端 |
|---|---|---|---|
| **B1** | `FaultSetDecl` 解析 + 具名组登记 + `fault(E)!T` 类型 kind | D5 | 是（新 TI kind） |
| **B2** | `PatternExpr` 放宽到关系表达式 + 嵌套 `FieldPath`；谓词规范化与恒等比较（D7） | D3 / D7 | **否**（编译期活） |
| **B3** | `@clause(.fault)` / `@clause(.repair)` 变体 + repair 名 → 槽位索引（R-2） | D1 / D4 | **否** |
| **B4** | `trap` / `resume` / `recover` 脱糖为 `match` + 常量索引间接调用；组 → 生成 `if` 链 | R-1（已实装，零新机制） | 否（复用 `CALL_IND`） |
| **B5** | 跨函数可达故障集 / 可达 repair 分析，经 `.tlib` TIR 摘要 | R-3 | 否 |
| **B6** | 门禁收口：conformance 用例 + examples golden 双后端 + 自举 + IR 快照重录 | 全部 | — |

- **建议顺序**：B2 → B3 → B1 → B4 → B5。理由：B2/B3/B4 全在编译期、不碰后端，可先把语义跑通并产出 golden；B1 的新类型 kind 是唯一的大件，放在通路验证之后改动更稳。
- ⚠ B4 之后 IR 形态会变（新增闭包槽位与间接调用）⇒ **IR 快照基线必须用 g1 重录**。

---

## 12. 早期评审结论存根（已被推翻的部分，保留以防复发）

| 原结论 | 现状 |
|---|---|
| 「谓词分派 ⇒ 穷尽性不可判定」 | ❌ **不成立**（见 §1.1 F-2 推论）。仅在蕴含式 / 运行时重跑两种语义下成立 |
| 「`.{...}` 谓词模式 = S11 未落地，从零造」 | ❌ **过高估计**。`.{...}` 已存在；增量是 `PatternExpr` 放宽 + 嵌套路径（D3） |
| 「`++` 需新运算符 + 双后端 shim」 | ❌ **不成立**。`++` 已存在（D4），且编译期组根本不需要运行时 `++` |
| 「trap 臂的 `.{...}` 是绕远路的糖」 | ⚠ **部分成立**。恒等匹配下它确为复合名字；但其收益*不在*运行时，而在「把判定条件变成可生成的编译期规格」 |
| 「传播 ⇒ 必须补载荷」（原 F-5 后半段） | ❌ **已被 R-1/R-2 撤销**（见 §1.2）。传播需上移的是**作用域**，不是数据 |
| 「先做路径 ①，③ 另立」 | ❌ **已改为直接做 ③**（§8 A-7）。① 是 ③ 的退化特例 |
| 「签名可不写 `!T`」 | ❌ **已改为必须写**（§8 A-8）。因 ③ 的传播是默认隐式的 |

---

## 附录 A · B2 批次改动点清单（逐节点，供阶段②确认）

> 目标：让 `match` 的字面量模式支持**谓词字段** `.{ .f <op> v }`（进而支撑 `.{ .age < 0 }` 这类故障谓词）。
> 前置：§7.2 的三条核查结论。诊断码轴：`T-MAT-E744` / `E745` 空闲（已占用：E740 类型、E741 字段、E742 穷尽、E743、E750/751 slice）。

### A.1 当前数据流（实测）

```text
.{ .age < 0 }
  → parse_match_alt_atom (parse.tc:5021)   Dot+LBrace → parse_struct_lit("", -1)
  → parse_struct_lit (parse.tc:815)        named_form 判定
       现在只有 `f: v` / `.f = v` 两式
       ⇒ `.f < v` 判定失败 → positional = true
  → 位置式分支 (parse.tc:821)              `.age < 0` 整个被当成「第 0 字段的匹配值」
       ⇒ 语义错位（想要谓词，得到位置等值比较）
  → struct_lit_pat_check (sema.tc:4108)    非 ident ⇒ 当字面量 → infer_expr 得 bool
       ⇒ 与字段类型 i64 不匹配 → err_type_mismatch（错误诊断，不是正确行为）
  → tir_match_pattern_cond (tir.tc:5827)   GEP+LOAD+EQ
```

### A.2 逐节点改动

| # | 文件 · 位置 | 现状 | 改动 | 量级 |
|---|---|---|---|---|
| **N1** | `parse.tc:881` 变体构造判定 | `Dot+Ident+peek(2) != "Assign"` → `parse_variant_lit` | ⚠ **必须先加关系符排除**，否则 `.{ .a < 1 }` 会落进 `V{ .Case }` 变体构造分支 | 极小 |
| **N2** | `parse.tc:817-818` `named_form` | 仅 `Ident+Colon` / `Dot+Ident+Assign` | 加第三式 `Dot+Ident+{Lt,Gt,LtEq,GtEq,EqEq,NotEq}` | 极小 |
| **N3** | `parse.tc:884-906` 具名字段循环 | 仅 `.f = v` / `f: v` | 加 `.f <op> v`：消费 Dot → ident → 运算符 token → `parse_expr()` 取右端；结果存为 FV(fname, `binary(op, __fscr占位, rhs)`) | 小 |
| **N4** | `sema.tc:4108-4116` `struct_lit_pat_check` | ident → 绑定；其余 → 字面量类型比对 | 加 `binary` 分支：① 校验 op ∈ 关系集（否则新码 `T-MAT-E745`）；② 校验 rhs 与字段类型可比（`ti_equal`/`can_cast`）；③ **把占位左端重写为 `member(scrutinee, fname)`** | 中 |
| **N5** | sema · scrutinee 求值 | — | ⚠ 脱糖后若 scrutinee 是复杂表达式（`match(validate(u))` ⇒ `__scr.age`）会**重复求值 N 次**。须先绑到编译期临时 | 中（需设计） |
| **N6** | `tir.tc:5827+` `struct_lit` 条件分支 | 逐字段 GEP+LOAD+`TIR_OP_EQ` | 字段值为 `binary` 时直接 `tir_emit_expr(该节点)` 取 i1 作条件；AND 链逻辑不变 | 小 |
| **N7** | 后端（C / LLVM） | — | **0**（TIR 是单一真源，见 §7.2） | **0** |
| **N8** | `tir.tc` 新 op | — | **0**。`TIR_OP_SLT=44` / `SGE=46` / `NE=53` 等均已存在且有字符串映射 | **0** |

- **消歧总表**（三者在首 token 上可判，但依赖 N1 先于 N2/N3 生效）：

| 形态 | 判定 | 语义 |
|---|---|---|
| `.{a, b}` | 首元素非 `Dot` | 位置式（既有） |
| `V{ .Case }` | `Dot+Ident+` 后既非 `=` 也非关系符 | 变体构造（既有） |
| `.{ .a = 1 }` | `Dot+Ident+Assign` | 具名字段等值（既有，零用例） |
| `.{ .a < 1 }` | `Dot+Ident+` 关系符 | **谓词（B2 新增）** |

### A.3 门禁

| 项 | 内容 |
|---|---|
| 静态 | conformance pass：`.{ .a < 1 }` 命中/不命中、`.{ .a + 1 }` 报 `T-MAT-E745`、字段不存在报 `T-MAT-E741`、与位置式/变体构造的消歧 |
| **运行期（不可省）** | ⚠ 分派落臂是**运行期语义**，而 conformance 从不运行程序 ⇒ 必补 `examples/predpat_demo.tc` + `.expected.txt` **双后端对拍**。用例须含「应当**不**命中的分叉」（KI-002 当年正是只测全匹配场景才漏掉的） |
| 自举 | `tc check src/tc.tc` → 自举 g1/g2 → gate L2 |
| IR 快照 | N6 改变 IR 形态 ⇒ 基线**用 g1 重录** |

### A.4 顺带要清的文档债务

| 文件 | 债务 |
|---|---|
| `docs/syntax/drafts/match.md` §6.3 | 标题仍写「KI-002 open」，正文 L345 已记 2026-09-26 修复 ⇒ 标题改「已修，保留作回归参考」 |
| `docs/syntax/drafts/match.md` L41 | `PatternExpr: Literal` 与 parse 实现（`parse_expr()` 能吞任意表达式）**不一致** ⇒ B2 后改为 `PatternExpr: Literal \| RelExpr` |
| `tests/known-issues/` | 目录说明自承「不被 conformance/difftest 自动扫描」⇒ KI-002 用例无回归价值；B2 的用例必须放 `examples/`（走 `run_examples`）或 `tests/conformance/` |
