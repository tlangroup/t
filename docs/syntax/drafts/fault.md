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

| 裁定                         | 内容                                                                                |
| -------------------------- | --------------------------------------------------------------------------------- |
| **F-1 编译期专有的 clause**      | `@clause(.fault, ...)` 不进入 IR、不进入运行时。谓词是**编译期数据**，不是运行时值                          |
| **F-2 分派键 = 返回的 fault 身份** | `trap` 臂的比较是「返回的故障」vs「臂上写的 pattern」，不是「对入参重跑谓词」，也不是「臂谓词蕴含 guard 谓词」。匹配关系 = **恒等** |
| **F-3 运行期表示 = 纯错误 tag**    | 无载荷、无消息、无栈回溯。运行期成本与 Zig 的错误联合完全同形                                                 |

- **F-2 的直接推论（关键）**：被 `trap` 切换的域是**编译期有限、静态可枚举的 clause 集合**，不是无限谓词空间。  
  ⇒ **穷尽性是静态可判定的**，且可直接复用于 `enum` 覆盖分析（`T-MAT-E742`）。  
  ⚠ 这条推翻了早期评审「谓词分派 ⇒ 穷尽性不可判定」的结论。该结论只在「臂谓词可宽于 guard 谓词（蕴含式匹配）」或「运行时重跑谓词」两种语义下成立，二者均被 F-2 排除。  
  |  |  |  
  | --- | --- |
- **反之**：若日后允许 `.{ .age < 10 }` 一条臂同时盖住 `AgeNegative` 与 `AgeTooOld`，则立即落回不可判定。该能力若要做，须走既有 **S1 或模式** `p1 | p2 =>`（已实装，`examples/match_ext.tc`），即用「多条恒等臂共享一体」，而非放宽匹配关系。

### 1.2 第四条裁定：就近处理（F-4），与它被路径 ③ 修订后的形态

> 「设计 trap/recover 的本质而不是 try/catch 的本质：**错误就近处理，而不是一致向上传播。**」（2026-10-27）

| 裁定                   | 内容                                             |
| -------------------- | ---------------------------------------------- |
| **F-4 修复知识就近**       | 「怎么修才对」的知识写在**抛出点**（数据在作用域里）；「选哪个修法」的决策权可以在任意层 |
| **F-5′ 上移作用域，不上移数据** | 传播需要上移的是**作用域（闭包）**，不是数据（载荷字段）                 |

- **F-5′ 的由来**：原 F-5（「就近⇒不需载荷；传播⇒必须补数据」）的后半段**已被路径 ③ 撤销**。因为 M48 闭包把抛出点的作用域打包带走，**无载荷与可传播不再冲突**。  
  ⇒ 由此契约从「数据契约（载荷字段名，一改即破坏性变更）」降级为「**选择契约**（修法名）」。
- ⚠ **适用边界**随之放宽：处理点**不再需要**与抛出点共享作用域；但仍需满足 §3.1 的多策略判据。

#### 1.2.1 三条路径已收敛为一条

| 原路径                     | 机制                    | 现状                                               |
| ----------------------- | --------------------- | ------------------------------------------------ |
| ① 紧邻 `trap` + `recover` | 就地给出修好的值              | ✅ **保留，但是糖**：`recover(e)` 脱糖为 `resume(合成闭包)`（§4） |
| ② 带载荷上传                 | 数据塞进错误                | ❌ **排除**：与 F-3 冲突，且已被 ③ 取代                       |
| ③ 带修复闭包上传               | 抛出点注册若干 repair，上层只做选择 | ✅ **主路径**；隐式 `.abort` 覆盖「不修、继续上传」                |

### 1.3 路径 ③ 的三条技术论断（R-1/R-2/R-3）

| 裁定                            | 内容                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R-1 上移的是作用域**               | 抛出点知道出了什么事（数据在手边），也知道若干种修法 ⇒ 打包成闭包；处理点不需要知道出了什么事，只从具名修法里选一个                                                                                                                    |
| **R-2 按值捕获消掉了 restart 的时序约束** | Common Lisp 的 restart 必须 unwind 跳回抛出点执行，因其闭包捕获**引用**；t 的 M48 是**按值捕获**（`types.md:40`，合成 `__env_N` 堆分配）⇒ 闭包一旦构造即**自包含**，执行位置与时机完全无关 ⇒ **不需要 unwind、不需要 continuation、不需要新运行时机制** |
| **R-3 它是受限代数效应**              | 与 OCaml 5 / Koka 对照，本提案把 `perform` 限制在**仅 `return` 位置** ⇒ resume 只需「提供返回值」而非「回到 perform 点继续」⇒ 省掉 delimited continuation（成本）与 effect row（类型复杂度）                                 |

- **运行时机制现状（可直接复用）**：`%TClosure { ptr code, ptr env }`、统一 ABI `CALL_IND: code(env, args)`（`src/tir_to_ll.tc:241`）。  
  ⇒ **路径 ③ 不新写任何 `tll_*` shim**，规避了历史上「out 参排末位」那类静默写错的风险。

---

## 2. 与 Zig result 的定位对照

| 维度        | Zig 0.17                           | 本设计                      | 判定         |
| --------- | ---------------------------------- | ------------------------ | ---------- |
| 运行期错误表示   | 名字 = tag，无载荷                       | tag，无载荷                  | **同**      |
| 携带详情的官方路线 | Diagnostics 出参模式                   | 不携带数据，携带**修法闭包**         | **异**      |
| 分派键       | 错误名                                | 结构化谓词（= 复合名字）            | 异（记号层）     |
| 穷尽性       | 有，缺 prong 即编译失败                    | 有（依赖 F-2 恒等）             | **同**      |
| 集成设施      | `try` / `catch` / `catch err{...}` | `trap` / `resume` / 隐式传播 | 异          |
| 传播语法      | `try` / `?`，**必须写**                | **零语法**（不 `trap` 即上传）    | 异（本设计更省）   |
| 组合        | `A \|\| B`，按名集合，无序                 | 具名组，`++` 连接，**无序**       | ⚠ 见 §8 A-1 |
| 推导集       | `!T` 推导（官方：公开 API 边界用它是**错的**）     | **声明集**：`pub` 函数必须写组     | 见 §8 A-4   |

**定位**：落在「简单错误码」与「复杂错误结构体」之间 —— 运行期付错误码的钱，编译期拿结构化谓词与修复策略的信息量。

---

## 3. 与「更多 tag 的 variant」的正面对照

> 「当前设计使用更少的错误编码，同时又要得到更复杂的错误处理流程，是不是南辕北辙，还不如更多的 tag 的 variant？」（2026-10-27）

**结论：不是南辕北辙。** 关键在于两类信息的区分：

| 信息处理点需要的           | 来源      | 更多 tag 的 variant         | 本设计                   |
| ------------------ | ------- | ------------------------ | --------------------- |
| **(i) 身份**：哪个守卫被触发 | 错误的 tag | ✅ 给（tag 越分越细）            | ✅ 给（谓词即复合名字）          |
| **(ii) 数据**：出错的那个值 | 载荷 / 闭包 | ✅ 给（`Err(AgeInfo{...})`） | ✅ 给（经闭包间接可用，**不进契约**） |
| **选择权归调用者**        | —       | ❌ 处理点自己写分支               | ✅                     |
| **内部结构进 API**      | —       | ❌ **是**（字段名是契约）          | ✅ **否**（契约只有修法名）      |

- ⇒ **「更多 tag」只把 (i) 做粗，不解决 (ii)**。把 tag 加到 20 个不会让处理变复杂，只会让每个处理点的分支变多。
- ⇒ **本设计对 (ii) 的替代是「就近 + 上移作用域」**（F-4 + F-5′）。差异不在信息量，在**信息从哪里来**。

**本设计相对 variant 的真实差异**（其余都是记号层）：

| # | 差异                                                 | variant 能否给     |
| - | -------------------------------------------------- | --------------- |
| 1 | 谓词自带语义，不用记名字                                       | ❌（名字是任意标识符）     |
| 2 | raise 处与 handle 处共享同一谓词词汇，不一致即编译错                  | ❌               |
| 3 | **组 → 生成校验函数 / 文档反例表**（组是**规格**，variant 是**数据**）<br>⚠ **生成 `if` 链已证伪**（A-23） | ❌ 关键差异          |
| 4 | 谓词**语法恒等**检查（语义重叠不检查，见 A-17）                       | ⚠ **降级后归零**      |
| 5 | **多策略选择权归调用者，且内部结构不进 API**                         | ❌ 关键差异（路径 ③ 带来） |

- ⭐ **必要性的全部重量现压在 3、5 两项上**（A-17 使 4 归零）。若只做 1、2，它就是 `variant` 的语法糖，直接违反 **L-04 第 6 条** —— 此时"还不如更多 tag 的 variant"的判断**成立**。
- 反过来说：只要 3、5 落地，"用更少的错误编码得到更复杂的处理流程"就不矛盾了 —— 复杂度不在你写的代码里，在编译器从组里**生成**出来的代码里（校验函数）、在上层**选择**的策略组合里。
- ⚠ **差异项 3 的收益须按 A-23 打折**：组能生成的是「**不带 repair 的**纯谓词校验函数」（`fn frame_check(f : Frame) FrameErr?`，顶层可复用）与文档反例表，**生成不了** raise 的 `if` 链 —— 后者必须手写，因为每个 raise 都带着只属于该函数的 repair 闭包。⇒ raise 处谓词与紧邻 `if` 重复，**v1 接受**（A-22），必要时 v2 再引入短名简写。
- ⚠ **A-17 的代价与为什么可接受**：组内两条谓词语义重叠（如 `.len > 16384` 与 `.len > 0, .csum = 0`）⇒ 规格描述有歧义，但**运行时行为完全确定** —— F-2 恒等分派的分派键是 **raise 处写死的 tag**，不是对输入重跑谓词。**组是规格，不是分派表**；分派发生在 raise 处的手写 `if` 链里。⇒ 重叠只伤可读性，不伤正确性，故降级成立。

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
// + 组声明是唯一真源：谓词、全名、repair 契约三样都只在这里写一次
FaultMember:  PredPat "->" FaultName ( "repairs" "{" RepairName ("," RepairName)* "}" )?
//                                     ^ repair 名在此登记；登记后才是公开契约
FaultName:    UpperIdent "." UpperIdent    // 组名.成员名；raise 处原样引用（v1 不提供简写，§8 A-22）

// —— raise：必须写在函数体内（repair 要捕获该函数的作用域）——
// + scrutinee 已移除（§8 A-18）：谓词的类型锚在组的 `over T` 上，raise 处不传值
// + v1 **不提供简写**（§8 A-22）：raise 处原样写 @clause(.fault, <谓词>, <全名>)，
//   与组声明逐字对应（一致性靠 sema 校验，不靠记号省略）
RaiseExpr: "Err" "(" FaultClause ("++" RepairClause)* ")"
FaultClause:  "@clause" "(" ".fault"  "," PredPat "," Expr ")"
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
// + trap 是错误专用关键词（§8 A-20），不复用 match
TrapExpr: "trap" Expr "{" TrapArm+ "}"
// + 两式共用 => ，由右侧表达式形态区分，无二义
TrapArm: ( PredPat | Wildcard ) "=>" ( ResumeExpr | RecoverExpr ) ","?
// + 通配臂只允许 .abort（§8 A-21）：`_` 必须显式放行，不能用它吞掉未处理的故障
Wildcard:    "_"
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
- ⭐ **谓词是唯一的键形式（A-22：不提供简写），但它在两种语境下语义不同**（Q10 裁定为「含值级语义」）：

  | 位置 | 语境 | 语义 |
  |---|---|---|
  | 组声明 | 编译期 | **定义**：谓词 → 全名，登记一次 |
  | raise | 编译期 | **引用**：与组内声明规范化后恒等 |
  | trap 臂 | 编译期 | **引用**：落臂判据 = 组内 clause 的 tag 恒等 |
  | 值级 match 臂 | **运行时** | **求值**：合取比较（A-16 要求 scrutinee 为变量） |

  ⇒ 消歧判据纯粹是**所在的臂位置**（`trap` 臂 vs `match` 臂），不需要额外记号。  
  ⚠ 已知代价：raise 处的谓词与紧邻的 `if u.age < 0` **重复**（因 A-23 证伪了"由组生成 `if` 链"）。v1 接受此重复；若日后手写负担被证实为问题，再启用 v2 候选：raise 处只写成员短名 `Err(.AgeNegative ++ ...)`，理由见 §12 存根。

---

## 5. 语义三层与脱糖

| 层                   | 内容                                                                                                                      | clause 是否还在     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------- |
| 源码层                 | 具名组（无序）、谓词、错误名、repair 名、内联 raise                                                                                        | 是               |
| **sema 层（IR 边界之前）** | ① 谓词 → 合取表达式（规范化后比较）；② 组 → 错误成员枚举；③ repair 名 → **编译期槽位索引**；④ `trap` → `match(tag)` + 常量索引取闭包 + 间接调用；⑤ 组 → `if` 链 / 校验函数 | **clause 在此消失** |
| 运行层                 | `{ tag: i64, repairs: [N]%TClosure }`                                                                                   | 否               |

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
- **生成收益（A-23 修正版）**：clause 是编译期数据 ⇒ 组应生成 ① **纯谓词校验函数** `fn frame_check(f : Frame) FrameErr?`（无 repair，顶层可复用）与 ② 文档/测试用的反例表。  
  ⚠ **生成不了 raise 的 `if` 链** —— 每个 raise 都挂着只属于该函数的 repair 闭包（A-12 禁跨函数复用）⇒ 那部分必须手写，谓词在源码里也就无法只出现一次。**v1 接受此重复**（A-22）。

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
        return Err(
              @clause(.fault, .{ .age < 0 }, UserErr.AgeNegative)   // 与组声明逐字对应（A-22：v1 无简写）
           ++ @clause(.repair, .use_default, fn() User { return User{ .age : DEFAULT_AGE, .name : u.name }; })
           ++ @clause(.repair, .clamp,       fn() User { return User{ .age : 0,          .name : u.name }; })
        );
    }
    if u.name == "" {
        return Err(
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
// ⚠ magic 校验失败时 Frame 尚未构造 —— raise 处没有值可传，这正是 A-18 移除 scrutinee 的动机
fn decode(buf : bytes) fault(FrameErr)!Frame {
    if !is_ours(buf) {
        return Err(
              @clause(.fault, .{ .magic != 0xCAFEBABE }, FrameErr.NotOurs)
           ++ @clause(.repair, .skip,   fn() Frame { return FRAME_NOP; })
           ++ @clause(.repair, .as_raw, fn() Frame { return raw_frame(buf); })
        );
    }
    var f : Frame = parse(buf);
    if f.len > 16384 {
        return Err(
              @clause(.fault, .{ .len > 16384 }, FrameErr.TooLarge)
           ++ @clause(.repair, .truncate, fn() Frame { return trunc_frame(buf, 16384); })
        );
    }
    return Ok(f);
}

// 层 2：不 trap ⇒ 自动上传，零语法（对比 Zig 的 try / Rust 的 ?）
fn serve(c : Conn) fault(FrameErr)!Frame { return decode(read(c)); }

// 层 3：只有这里知道业务意图，也只有这里做选择
// ⚠ 用了 `_ => resume(.abort)` ⇒ 该故障继续上传 ⇒ 签名必须承载 `fault(FrameErr)!Frame`（A-8）
fn route(c : Conn) fault(FrameErr)!Frame {
    return trap serve(c) {
        .{ .magic != 0xCAFEBABE } => resume(.skip),      // 宽松模式：跳过陌生帧
        .{ .len > 16384 }         => resume(.truncate),  // 宁可截断也要继续
        _                         => resume(.abort),     // 其余一律上传（唯一合法通配臂，A-21）
    };
}

// 层 4：传播链的终点。main 若不再 trap，故障由运行时接手 ⇒ 打印 + 非零退出码（A-19）
fn main_fn() fault(FrameErr)!i32 @main {
    var f : Frame = route(open_conn());
    return 0;
}
```


⇒ **策略的选择权与定义权分离**，且分离不需要任何数据外流。同一份 `decode` 在另一调用点可选 `.as_raw` / `.abort`，库代码一字不改。

> ✅ **本例原有两处自相矛盾，已由 A-18 / A-19 解决；raise 写法另由 A-22 简写**：① `Err(f0, ...)` 的 scrutinee 已移除（raise 处不传值，类型锚在 `over T`）；
> ② `route` 签名已改为 `fault(FrameErr)!Frame`，与 `_ => resume(.abort)` 的传播语义一致。
> ⭐ 注意 `.abort` **只有一个语义：向上传播**。它到达语言最外层（`main` 之外）时由运行时接手 ⇒ 打印 + 非零退出码，不是"换了一个意思"。这与 Rust `main` + `?` 的先例同形。
> ⚠ **已知代价（A-22）**：raise 处的谓词与紧邻的 `if !is_ours(buf)` **重复**。这不是疏漏 —— A-23 已证伪「由组生成 `if` 链」，故该重复在 v1 **不可消除**；一致性改由 sema 校验（谓词规范化后须与组内声明恒等）。

---

## 7. 依赖与成本

| 编号 | 依赖项 | 现状 | 增量 | 量级 |
|---|---|---|---|---|
| D1 | `@clause` 与一等 clause 组 | ✅ 已落地：`@clause(.pattern,...)`、组 `[C0,C1]`、`match(x){G}` 展开 + N11 重排（`examples/clause_expand.tc`） | 新增 `.fault` / `.repair` 变体 + 谓词存储 + 组展开点 | 小 |
| D2 | `.{ .f = v }` 具名字段模式 | ⚠ `match.md` 已采纳 EBNF，但**全仓 examples/tests 无覆盖** | 先补 conformance/双后端用例证其可用，再扩展 | 小 |
| D3 | 谓词中的关系表达式 + 嵌套路径 `.flags.bit0` | ❌ 未落地。`PatternExpr` 现仅 `Literal` | 扩展 `PatternExpr` + 位访问 | 中 |
| D4 | `++` | ✅ 已存在（opmap `Concat`/63，`tll_slice_concat`） | 0 | 0 |
| D5 | `fault(E)!T` 错误联合运行时表示 | ⚠ 参照 `Optional`：kind / `ti_str` / `ti_equal` / `resolve` 已在，**值级 API 未落地**（P1 首任务） | **sema 为每组合成具名 struct 类型** `{ i64 tag, [N]%TClosure }`（A-26 / A-27） | **中**（原「大」） |
| D6 | 用户自定义参数化类型 | ❌ 无证据。泛型当前仅作用于**函数**与类别子句 | **可从关键路径摘除** —— 因 F-1，每个 `(E,T)` 实例由 sema 直接合成，不需要用户可写泛型 | 0 |
| D7 | 谓词规范化与恒等比较 | ❌ 全仓 0 命中 | 新 sema 算法：合取项排序 + 原子约束规范化 | 中 |
| **R-1** | **闭包** | ✅ **已实装 M48**：按值捕获、`%TClosure{ptr code, ptr env}`、统一 ABI | **0**。路径 ③ 直接站在它上面 | **0** |
| R-2 | `resume` 静态解析 | ❌ | 修法名 → 槽位索引，编译期完成 | 小 |
| R-3 | 可达集分析（跨函数） | ❌ | 与 §8 A-4 的声明集共用基础设施；`.tlib` 存 TIR 可承载摘要 | 中 |

**关键结论**：
- 因 F-1「clause 仅编译期」，**D6 摘除**；`.{...}` 从不进入运行时模式匹配，故不依赖 S11（struct 字段**绑定**解构）。
- 因 R-2「按值捕获」，**R-1 = 0** —— 路径 ③ 不需要任何新运行时机制。
- 真正花钱的：**D3 / D7（编译期活，不碰后端）+ D5（A-27 后为合成具名 struct，量级降至中）+ R-3（跨函数分析，A-28 不砍 B5）**。
- ⭐ **A-27 的连带后果**：`fault(E)!T` **不需要新 TI kind** ⇒ B1 从「碰后端的大件」降为「编译期的中等件」；但组内增减 repair 会改变布局 ⇒ **破坏性变更**（编译期可发现）。

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
| A-1 | 组的有序性 | **无序**；**重叠检查已降级**（见 A-17）⇒ 组内仅查谓词语法恒等 | 有序会让 `++` 不满足交换律（`.len>16384` 与 `.len>0,.csum=0` 重叠时谁赢靠位置），"可组合"名不副实 |
| A-2 | 谓词唯一性 | **强制唯一；重复报 `T-FLT-E???`** | 恒等分派要靠谓词定位 clause，重复即无法分派。`repair` 名同理，同一 fault 下重复报错 |
| A-3 | 谓词规范化程度 | **仅做合取项排序**（令 `.a=1,.b=2` ≡ `.b=2,.a=1`） | 不做 `<0` ⇄ `<=-1` 那类推理级归一，避免引入不可判定 |
| A-4 | 推导集 vs 声明集 | **声明集**：`pub` 函数必须写具名组；非 `pub` 可内联推导 | Zig 官方明说「推导集在公开 API 边界是错的」；且 repair 名是契约，必须登记 |
| A-5 | scrutinee 类型 | ❌ **已撤销，改 `Err(<group>)`**（见 A-18） | 原议「显式写出」会与 A-6 的 `over T` 重复承载同一类型信息，且 raise 时 scrutinee 往往尚不存在 |
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
| **A-16** | **谓词模式的 scrutinee 形态** | **只允许变量**；非变量（如 `match(validate(u))`）⇒ 编译错误。**不做** sema 合成临时绑定 | 用硬约束把「重复求值」这条路堵死，而非用魔法修好它。三重收益：① 量级从「需设计」降为极小；② `member(__scr, f)` 恒为纯读取 ⇒ **多次求值无副作用**，连求值顺序都不必规定；③ 读者一眼看出有没有隐藏的重复求值。⚠ 适用范围见 §A.5 Q10 |
| **A-17** | **组内重叠检查的强度** | **降级**：只查谓词**语法恒等**（与 A-2 合并），**不查语义重叠**；谓词形式**不设限** | 判定语义重叠需区间推理/SMT，与 A-3 互斥。⚠ **代价：差异项 4 归零**（§3）。可接受性论证：F-2 的分派键是 raise 处写死的 tag，组是**规格**不是**分派表** ⇒ 重叠只伤可读性不伤正确性 |
| **A-18** | **raise 处的 scrutinee** | **去掉**，改为 `Err(<group>)`；谓词的类型锚在 `fault E over T` | ① 抛出错误的典型场景恰恰是 scrutinie 构造不出来（`decode` 在 magic 失败时没有 Frame 可传）；② A-5 与 A-6 是同一类型信息的两处写法，撞 L-04 第 6 条。⇒ 单一真源 |
| **A-19** | **`.abort` 与顶层传播** | `.abort` **只有一个语义 = 向上传播**；传播到 `main` 之外时由运行时接手 ⇒ 打印 + 非零退出码 | 与 Rust `main` + `?` 同形。含 `.abort` 臂的函数签名必须写 `fault(E)!T`（A-8）。⚠ 修正 §6.2 原文 `fn route(c:Conn) void` 的自相矛盾 |
| **A-20** | **`trap` 是否专用于错误处理** | **是**，`trap` 为错误专用关键词，**不复用 `match`** | 见下方 §8.1 的论证：trap 是**更严格的 match**，不是一个新语法 |
| **A-21** | **trap 的通配臂** | 允许 `_`，但**通配臂上只允许 `resume(.abort)`** | 否则 `_ => resume(.skip)` 会吞掉未处理的故障，与 A-15 冲突。⇒ 你要么逐 clause 处理，要么显式说「其余一律上传」，没有第三条路 |
| **A-22** | **raise 处的写法（Q13）** | **v1 不提供简写**：raise 处原样写 `@clause(.fault, <谓词>, <全名>)` | 用户裁定（2026-10-27）：先要一致性，不引入第二套记号。⇒ 谓词出现三处（组声明 / raise / trap 臂），**冗余但一致**，由 sema 校验其规范化后恒等（A-3 + Q3）。⚠ 已知代价：与紧邻 `if` 重复，且按 A-23 不可消除。v2 候选：短名 `Err(.AgeNegative ++ ...)`，仅在手写负担被证实为问题时启用 |
| **A-23** | **「组 → 生成 `if` 链」** | ❌ **做不到，已更正**为「组 → 生成**纯谓词校验函数** + 文档反例表」 | 含 repair 的 raise 链**无法**由组生成：repair 闭包体引用抛出点的局部变量（`u`），而组声明在顶层、A-12 又禁止跨函数复用 ⇒ raise 处的 `if` 必须手写。⇒ 差异项 3 的收益范围相应收窄（见 §3） |
| **A-24** | **诊断码归属（Q1）** | **① 复用既有类**：谓词/模式归 `MAT`、clause 变体归 `CLA`、repair 闭包归 `CLO`；**不开 `FLT`** | 零区间改动，不触发 §1.3 的再切分手续。⚠ 扫描错误码整体必要性的评估**延后**（见 §A.6），不阻塞 B2 |
| **A-25** | **谓词常量折叠（Q3）** | **① 先折叠**再比较 | A-22 撤销后谓词出现三处，raise 与 trap 的匹配完全依赖规范化后恒等 ⇒ 不折叠则 `.a < 1+1` 与 `.a < 2` 被判成两个 clause，绕开 A-2 且落错臂。⚠ 须实测 `comptime_fold_pass()` 是否已顺带折掉 |
| **A-26** | **repair 槽位数归属（Q5）** | **属组** | §6.2 层 2 `serve` 不写任何 repair，返回类型仍须与层 1 逐字相同 ⇒ N 只能由组决定。⚠ 副作用：组内增减 repair = 破坏性变更（编译期可发现） |
| **A-27** | **运行时表示（Q6）** | **② sema 为每组合成具名 struct 类型** `{ i64 tag, [N]%TClosure }` | 因 A-26 使 N 成为组的属性 ⇒ **不必新 TI kind**，B1 量级从「大」降为「中」 |
| **A-28** | **B5 去留（Q9）** | **不砍**，v1 就做跨函数可达集 / 可达 repair 分析 | 保留 A-4 的「非 `pub` 可推导」，换取调用者不必为每个中间层手写具名组。代价 = R-3（中） |
| **A-29** | **B2 范围（Q10）** | **① 含**：谓词模式在**值级 match** 下也是运行时语义 | ⇒ N4 / N6 **不能省**；`.{ .a < 1 }` 一个记号两种语义，靠臂位置消歧（§4 末）；**A-16 因此成为真约束**（值级 match 的 scrutinee 可能是任意表达式 ⇒ 必须限制为变量） |
| **A-30** | **L-04 唯一语义验证（Q11）** | ✅ **通过** | `recover` 脱糖为 `resume(合成闭包)`、`.abort` 是 `resume` 的一个名字 ⇒ 三式收敛为 `resume` 一式；`trap` 与 `match` 语义不同（分派键不同）+ 约束更严 ⇒ 不构成多写 |
| **A-31** | **repair 登记写法（Q15）** | **不简写**，保留 `@clause(.repair, <名>, <闭包>)` 全包装 | 与 A-22 同向：v1 一律不引入第二套记号。⇒ 源码唯一的故障相关新记号只有 `trap` / `resume` / `recover` / `@clause` 四个 |

### 8.1 为什么 `trap` 值得独占一个关键词（A-20 的论证）

复用 `match` 表面可行（形态几乎一样），但它会让 `trap` 丢掉三样东西：

| 若用 `match` | `trap` 才能给的 |
|---|---|
| 读者以为可以写任意谓词 | 分派键是**编译期 clause tag**（F-2），不是运行期值 ⇒ 语义本就不同，记号相同会误导 |
| 可以写 `_ => ...` 通配 | **通配臂被 A-21 限制为只能 `.abort`** ⇒ 漏处理在语法层就不可能（这是 `A-15` 的护栏） |
| 穷尽性报错文案是"match 未穷尽" | 专用文案"故障 `X` 未处理"，且指向组内 clause 而非 arm |

- ⇒ **`trap` 不是新语法，是一个更严格的 `match`**：禁通配（除 `.abort`）+ 强制穷尽 + 阻断隐式传播（A-8 下它是唯一能阻断的构造）。
- L-04 第 6 条禁止的是**同一语义**的多写；此处语义不同（分派键不同）+ 约束更严 ⇒ **不构成多写**。
- 用户侧收益与你的直觉一致：看到 `trap` 就知道这是错误处理点，不必看 scrutinee 类型才能反应过来。

---

## 9. 能力边界与法律验证

### 9.1 做不到什么（诚实列出）

| 做不到 | 原因 | 替代 |
|---|---|---|
| repair 就地改写抛出点的局部变量 | 按值捕获（R-2），拿到的是拷贝 | 需要改写的状态以**指针**传入，或移出局部作用域 |
| 回到抛出点**中间**继续执行 | R-3 的 return 点限制 | 不需要：本设计的"恢复"就是提供返回值 |
| 处理点读取出错的**数据本身**（打印/统计/记录） | F-3 无载荷 | 用 variant + 载荷（§3.1 判据） |
| 未处理的故障自动崩溃 / 打印调用栈 | 无异常栈机制 | 由 `.abort` 传到 `main` 之外后由运行时接手（打印 + 非零退出码，A-19） |
| **组内语义重叠的静态检查** | A-17 已降级 | 组是**规格**不是分派表 ⇒ 重叠不伤正确性，只伤可读性；由文档与评审负责 |
| **由组生成 raise 的 `if` 链** | repair 闭包体引用抛出点局部变量，A-12 禁跨函数复用 | 只能生成**不带 repair 的**校验函数与反例表（A-23）；raise 处仍需手写 ⇒ 谓词与紧邻 `if` 重复，v1 接受（A-22） |

### 9.2 法律验证（✅ 已完成，A-30）

| 法律 | 判定 | 说明 |
|---|---|---|
| L-03 静态类型 | ✅ | 每个 `resume` 的返回类型由闭包签名静态给定，与函数成功类型统一；穷尽性复用 `T-MAT-E742` |
| L-04 唯一语义 | ✅ **通过**（A-30） | `recover` 脱糖为 `resume(合成闭包)`、`.abort` 是 `resume` 的一个名字 ⇒ 三式收敛为 `resume` 一式；`trap` 与 `match` 分派键不同且约束更严 ⇒ 不构成多写 |
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
| **B1** | `FaultSetDecl` 解析 + 具名组登记 + `fault(E)!T` 运行时表示 | D5 | ⚠ **A-27 后不再是新 TI kind**：sema 为每组合成具名 struct `{ i64 tag, [N]%TClosure }` ⇒ **不碰后端**，量级 大 → 中 |
| **B2** | `PatternExpr` 放宽到关系表达式 + 嵌套 `FieldPath`；谓词规范化与恒等比较（D7）。⚠ **A-29：含值级 match 语义** ⇒ N4 / N6 不可省，且 A-16 成为真约束 | D3 / D7 | **否**（编译期活） |
| **B3** | `@clause(.fault)` / `@clause(.repair)` 变体 + repair 名 → 槽位索引（R-2） | D1 / D4 | **否** |
| **B4** | `trap` / `resume` / `recover` 脱糖为 `match` + 常量索引间接调用；组 → 生成**校验函数**（A-23：不是 `if` 链） | R-1（已实装，零新机制） | 否（复用 `CALL_IND`） |
| **B5** | 跨函数可达故障集 / 可达 repair 分析，经 `.tlib` TIR 摘要 | R-3 | 否 |
| **B6** | 门禁收口：conformance 用例 + examples golden 双后端 + 自举 + IR 快照重录 | 全部 | — |

- **建议顺序**：B2 → B3 → B1 → B4 → B5。理由：B2/B3/B4 全在编译期、不碰后端，可先把语义跑通并产出 golden；B1 是唯一的大件（A-27 后降为「中」），放在通路验证之后改动更稳。
- ⚠ **B5 不砍（A-28）**：保留 A-4 的非 `pub` 推导 ⇒ 跨函数可达集分析（R-3）必须做。B5 排在最后，但**不是可选项**。
- ⚠ B4 之后 IR 形态会变（新增闭包槽位与间接调用）⇒ **IR 快照基线必须用 g1 重录**。

### 11.1 B2 批次 · 编码实录（2026-10-27 完成）

**状态：✅ 已编码并通过门禁**（gate L2 **23 passed / 1 failed**，唯一 FAIL 项根因见下「IR 快照」条；
静态 check 0 error / 自举 g1 exit=0 / conformance 400 passed 0 failed / examples golden 双后端逐字节一致）。
批次台账与后续批次的验证链见 `docs/design/fault/DESIGN.md`。

实际落点与附录 A 预估的**唯一偏差**：`parse_struct_lit` 里的形态判定不是 3 处而是 **4 处**，
且真正先截走谓词的是第 ② 处（`is_tuple`），不是原先标记的变体判定：

| # | 判定点 | 位置 | 改动 |
|---|---|---|---|
| ① | `named_form` | `parse.tc` ~866 | 加第三式 `Dot+Ident+非终结符` ⇒ 否则落位置式 |
| ② | **`is_tuple`** | `parse.tc` ~845 | **加谓词排除式**（漏掉此处的实测后果：谓词被当匿名元组字面量截走） |
| ③ | 变体构造 `V{ .Case }` | `parse.tc` ~939 | 加 `pat_is_pat_end(peek(2))` 条件 |
| ④ | 具名字段循环 | `parse.tc` ~951 | 加谓词分支：消费 Dot→ident→运算符→`parse_expr()` |

**三条踩坑（均为「不报错、只是走错路」型，值得作为范式记住）：**

1. **漏改 `is_tuple`（根因）**：`is_tuple` 在变体判定**之前**执行，且条件只排除 `Assign`。
   `.{ .age < 0 }` 的 peek(2)=`Lt` 不在排除集 ⇒ `is_tuple=true` ⇒ 谓词被当匿名元组字面量截走，
   症状是「`struct User 没有字段 _0`」这种莫名其妙的类型错，而非「不支持」。
   ⇒ 与 KI-002 / bitstr `&` / 位域 `&` 同款：不报错，只是走错一条路。

2. **默认分支承载真实语义（我引入的 bug）**：`pat_relop_text()` 原本**没有** `Lt` 分支——
   `<` 是靠 `return "<"` 这个默认分支兜住的。我为表达「不认识的运算符」把默认值改成 `"?"`
   ⇒ 静默丢掉 `<` 的映射，症状是 E745 文案打出「这里是 `?`」。
   ⇒ **改函数默认返回值前，先确认默认值是否被当作某个真实 case 在用。**

3. **arm 名 ≠ 类型 kind（我引入的 bug）**：我写了 `ti_mk("Bool")` / `tip_kind(plt) != "Bool"`，
   但 `Bool` 只是 `ti_arm_of()` 返回的 **arm 名**；bool 是 **scalar**，
   其 `tip_kind` 是 `"Scalar"`、`tip_name` 是 `"bool"`（小写）。
   ⇒ `ti_mk("Bool")` 得到空类型名 ⇒ 报错文案显示 `expected  but got bool`（expected 为空）。
   ⇒ **kind（Scalar/Enum/Variant…）与类型名（bool/User…）是两套标识，别混用。`

**门禁证据（本次实测）：**
- `tc check src` → `errors = 0`
- 自举 g1（`bootstrap_tc.mjs --tc ci/seed/tc.exe`）→ `exit=0`；
  ⚠ 工具会给 `--out` **再追加一次 `.exe` 后缀** ⇒ 传 `_b2g1.exe` 实际产出 `_b2g1.exe.exe`。
- conformance 全量 → `400 passed, 0 failed, 400 total`（含新增 3 例）
- `run_examples_tmir.mjs --only predpat_demo` → PASS；LLVM 与 tmir-c **逐字节一致**
  ⇒ 坐实 **N7 = 后端零改动**
- IR 快照：改前（`out/dbg/tc.exe`，pre-B2）与改后编译器对同一示例产出**逐字节相同的 IR** ⇒ B2 对既有示例零漂移。
  ⚠ 门禁「产物快照比对」报 **6 处 DIFF**，`ir_snapshot` 明确归因 `compilerMd5` 溯源漂移，且 **0 新增 / 0 缺失**；
  6 处 = `math_extra_demo` / `math_stdlib_demo` / `std_demo` 三个 `@import("std.*")` 示例 × 双后端
  —— 这是**基线录制编译器用错**的签名（项目笔记已记：基线**必须用 gate 的 `out/dbg/g1.exe` 录**，
  我误用了自建的 `_b2g1.exe.exe`；两者同为 post-B2，故与 B2 无关）。
  佐证：这 3 个示例在 gate 的 `run_examples dbg (双后端)` 与 `C 后端自举` 两步均 PASS ⇒ 运行期无差异。
  处置：`node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe --jobs 1` 重录后回验 0 差异。

---

### 11.2 B3 批次 · 编码实录（2026-10-27 完成）

**状态：✅ 已编码并通过门禁**（gate L2 **23 passed / 1 failed**；唯一 FAIL 项 = 产物快照，
且经核为**合法漂移**：`2 处 DIFF = src/tc.tc::ll / ::c`（编译器自身源码变了，必然）、
`2 处 NEW = examples/faultclause_demo::ll / ::c`（新增示例）、**0 GONE** ⇒ 既有 141 个示例 IR 零漂移）。
逐节点清单见**附录 B**；批次台账与后续批次见 `docs/design/fault/DESIGN.md`。

**落点（与附录 B 预估一致，除 M9）**

| # | 位置 | 改动 |
|---|---|---|
| M1 | `parse.tc` `clause_kind_member` / `clause_kind_list` | 加 `.fault` / `.repair`；E721 文案随之列出三者 |
| M2 | `parse.tc` `parse_clause_lit` | 按类别三路分派；故障族拒绝 `when` 守卫（E728） |
| M3 | `parse.tc` 新增 `clause_pred_ok` | 谓词必须是 `.{...}` 且字段为等值/关系约束（否则 E730） |
| M4 | `parse.tc` `.repair` 第二段 | 只接受 `Dot+Identifier`（leading-dot member），否则 E729 |
| M5 | `parse.tc` `clause_collect` | 故障子句**照旧收集**（否则编译期标记不生效 ⇒ 漏进 IR），另置 `g_spl_fault` 标志 |
| M6 | `parse.tc` `clause_expand_splice` | `g_spl_fault` ⇒ 报 E731，不展开为臂 |
| **M9** | `sema.tc` `op == "Concat"` | **超出预估**：加 `Clause ++ Clause ⇒ Clause`（见下） |

**一条文档债务（第 5 次同类）**：§7 D4 记「`++` 已存在 ⇒ 增量 0」，实测 sema 的 Concat 分支
**只放行 bitstr / String / Slice / Array / Map**，`clause ++ clause` 报 `T-BIT-E515`；
parse 侧 `clause_collect` 的 Concat 分支一直存在却从走不到。
⇒ 判据是「跑一遍」，不是「记号已存在」。修法：Concat 分支最前加 `Clause` 放行（与 `[C0,C1]` 同义）。

**另一处非显然点（M10）**：`.fault` 的谓词位必须**临时置 `g_in_match_pat = true`** ——
`parse_struct_lit` 的谓词分支只在模式位生效；表达式位的 `.{ .age < 0 }` 不会走谓词分支
（症状不会是「不支持」，而是落在别的形态上，与 B2 的 `is_tuple` 漏改同族）。

**门禁证据（本次实测）**
- `tc check src/tc.tc --json` → `errors = 0`
- 自举（`bootstrap_tc.mjs --tc ci/seed/tc.exe`）→ `exit=0`
- `tools/refresh_seed.mjs --check` → 种子仍可编译 src（0 error）
- conformance 全量 → **405 passed / 0 failed**（含新增 5 例）
- `run_examples_tmir.mjs --only faultclause_demo` → PASS，LLVM 与 tmir-c **逐字节一致**
  ⇒ 故障/修复子句**零运行期副作用**，且不影响 `.pattern` 的臂展开
- gate L2：自举不动点 / 四代不动点 / 双轨对拍 / C 后端自举 / MIR differential / rls 全 PASS
- IR 快照：0 GONE ⇒ 既有示例零漂移；已用 gate 的 `g1` 重录

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
| 「组内重叠即报错」（A-1 后半） | ❌ **已降级为只查语法恒等**（§8 A-17）。判定语义重叠与 A-3 互斥；且 F-2 下组是规格不是分派表 ⇒ 重叠不伤正确性。代价：§3 差异项 4 归零 |
| 「`Err(<scrutinee>, <group>)` 显式写出」（A-5） | ❌ **已撤销，改 `Err(<group>)`**（§8 A-18）。raise 时 scrutinee 往往尚不存在，且与 A-6 的 `over T` 重复承载类型信息 |
| 「组 → 生成 raise 的 `if` 链」（差异项 3 前半） | ❌ **做不到**（§8 A-23）。repair 闭包体是函数私有的（A-12）⇒ 只能生成无 repair 的校验函数；raise 处必须手写，谓词与紧邻 `if` 重复，v1 接受（A-22） |
| 「raise 处只写成员短名」（A-22 早期形态） | ❌ **已撤销**（用户裁定 2026-10-27）：v1 不提供简写，raise 处原样写完整 `@clause(.fault, ...)`。短名降级为 **v2 候选** |

---

## 附录 A · B2 批次改动点清单（逐节点，供阶段②确认）

> 目标：让 `match` 的字面量模式支持**谓词字段** `.{ .f <op> v }`（进而支撑 `.{ .age < 0 }` 这类故障谓词）。
> 前置：§7.2 的三条核查结论。
> ⚠ **诊断码须以 `tools/diag_defs.json` 为准**（唯一真源，176 条，生成 `src/diag_table.gen.h`），不以本文档为准。实测 `T-MAT-*`：E740(类型) / E741(字段) / E742(穷尽) / E743 / **W744** / E750 / E751(slice) / E760 / **W761** ⇒ `T-MAT-E744` 依 §1.2.2「同一 CAT+NNN 允许多 SEV 共存」**可用**，但建议取 `E745`/`E746` 避免与 `W744` 混淆。

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
| **N5** | sema · scrutinee 求值 | — | ✅ **已裁定（A-16）**：含谓词的模式，其 scrutinee **必须是变量**；否则报 `T-MAT-E74?`。⇒ **不做临时绑定**，量级降为极小 | **极小** |
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
| 静态 | conformance pass：`.{ .a < 1 }` 命中/不命中、`.{ .a + 1 }` 报 `T-MAT-E746`、字段不存在报 `T-MAT-E741`、与位置式/变体构造的消歧、**非变量 scrutinee 报 `T-MAT-E745`（A-16）** |
| **运行期（不可省）** | ⚠ 分派落臂是**运行期语义**，而 conformance 从不运行程序 ⇒ 必补 `examples/predpat_demo.tc` + `.expected.txt` **双后端对拍**。用例须含「应当**不**命中的分叉」（KI-002 当年正是只测全匹配场景才漏掉的） |
| 自举 | `tc check src/tc.tc` → 自举 g1/g2 → gate L2 |
| IR 快照 | N6 改变 IR 形态 ⇒ 基线**用 g1 重录** |

### A.4 顺带要清的文档债务

| 文件 | 债务 |
|---|---|
| `docs/syntax/drafts/match.md` §6.3 | 标题仍写「KI-002 open」，正文 L345 已记 2026-09-26 修复 ⇒ 标题改「已修，保留作回归参考」 |
| `docs/syntax/drafts/match.md` L41 | `PatternExpr: Literal` 与 parse 实现（`parse_expr()` 能吞任意表达式）**不一致** ⇒ B2 后改为 `PatternExpr: Literal \| RelExpr` |
| `tests/known-issues/` | 目录说明自承「不被 conformance/difftest 自动扫描」⇒ KI-002 用例无回归价值；B2 的用例必须放 `examples/`（走 `run_examples`）或 `tests/conformance/` |
| `docs/diagnostics.md` §1.3 | 记 `CDE` 区间 910–**999**，而 `gen_diag.mjs` 的 `RANGES` 实为 910–**919** ⇒ 文档与代码不一致（同类第 4 次）。**以 `gen_diag.mjs` 为准** |


### A.5 ✅ 待决清单已清空（Q1–Q15）

> 全部 15 条均已裁定，映射见下表。**无待决项，可进阶段③。**

| 待决 | 裁定 | 说明 |
|---|---|---|
| Q1 | **A-24** 复用既有类 | 谓词/模式 → `MAT`；clause 变体 → `CLA`；repair 闭包 → `CLO`。不开 `FLT` |
| Q2 | — | **非选项，是执行项**：每条新诊断必须起 3 个名字（`code` / `name` / `legacy`，`legacy` 可 null），实装时逐条登记 |
| Q3 | **A-25** 先折叠 | 谓词出现三处，恒等匹配依赖折叠 ⇒ 硬需求 |
| Q4 | **A-17** 降级 | 见 A-17 |
| Q5 | **A-26** 属组 | — |
| Q6 | **A-27** 合成具名 struct | B1 量级 大 → 中 |
| Q7 | **A-18** 去掉 scrutinee | — |
| Q8 | **A-19** `.abort` = 上传 | — |
| Q9 | **A-28** 不砍 B5 | 保留非 `pub` 推导 |
| Q10 | **A-29** 含值级语义 | N4 / N6 不省；A-16 生效 |
| Q11 | **A-30** L-04 通过 | 三式收敛为 `resume` |
| Q12 | **A-20 / A-21** | trap 专用 + 通配臂限 `.abort` |
| Q13 | **A-22** v1 不简写 | — |
| Q14 | — | 随 Q13 撤销 |
| Q15 | **A-31** 不简写 | 保留全包装 |

#### A.5.1 挡住 B2 开工

| # | 议题 | 选项 | 备注（实测） |
|---|---|---|---|
| ~~Q1~~ | ✅ **已裁定 = A-24：① 复用既有类** | 谓词/模式归 `MAT`（[740,779] 已用 9）、clause 变体归 `CLA`（[720,739] 已用 7）、repair 闭包归 `CLO`（[780,809] 已用 2）⇒ **不开 `FLT`，零区间改动**。⚠ 000–999 已被 `gen_diag.mjs` 的 `RANGES` 切满，无空段（若日后要开新 CAT，须仿 CLA/TIM 先例做区间再切分并同步两处）。⚠ **错误码整体扫描的必要性评估延后**（§A.6），不阻塞 B2 |
| ~~Q2~~ | ✅ **转为执行项（非待决）** | 每条新诊断必须起 **3 个名字**：`code` / `name`（冻结短语义名）/ `legacy`（旧语义名，可 null）。`gen_diag.mjs` 有 `legacySeen` 唯一性校验（"duplicate legacy name" ⇒ 别名碰撞）⇒ 实装时逐条登记，不在此处占号 |
| ~~Q3~~ | ✅ **已裁定 = A-25：① 先折叠** | 谓词出现三处，raise 与 trap 的匹配完全依赖规范化后恒等 ⇒ 不折叠则 `.a < 1+1` 与 `.a < 2` 被判成两个 clause，绕开 A-2 且落错臂。⚠ 须实测 sema 之后的 `comptime_fold_pass()` 是否已顺带折掉 |

#### A.5.2 ⭐ 文档内部冲突（A-1 与 A-3 互斥）

| # | 议题 | 选项 |
|---|---|---|
| ~~Q4~~ | ✅ **已裁定 = A-17① 降级** | 只查语法恒等（与 A-2 合并），**不查语义重叠**，谓词形式**不设限**。⇒ Q4′ 作废（不再限制谓词形式）。⚠ 连带后果：**§3 差异项 4 归零**，必要性地基由 3/4/5 缩为 3/5 |

#### A.5.3 挡住 B1（类型 kind）

| # | 议题 | 选项 |
|---|---|---|
| ~~Q5~~ | ✅ **已裁定 = A-26：属组** | §6.2 层 2 `serve` 不写任何 repair，返回类型仍须与层 1 逐字相同 ⇒ N 只能由组决定。⚠ 推论：组内增减 repair 会改变 `fault(E)!T` 的运行时布局 ⇒ **破坏性变更**（好在编译期可发现） |
| ~~Q6~~ | ✅ **已裁定 = A-27：② 合成具名 struct** | `{ i64 tag, [N]%TClosure }` —— 因 A-26 使 N 成为组的属性，**每个 (E,N) 合成一个具体类型即可** ⇒ **不必新 TI kind**，B1 量级 大 → 中 |

#### A.5.4 ✅ 挡住 B4（两处文档自相矛盾 —— 已解决）

| # | 议题 | 结论 |
|---|---|---|
| ~~Q7~~ | **`Err(<scrutinee>, <group>)` 的 scrutinee 可能是编造的** | ✅ **已裁定 = A-18 ② 去掉**，改 `Err(<group>)`。§6.1/§6.2 示例已同步更新 |
| ~~Q8~~ | **`.abort` 与顶层传播** | ✅ **已裁定 = A-19②**：`.abort` 恒 = 上传，到 `main` 之外由运行时接手（打印 + 非零退出码）。§6.2 的 `route` 签名已改为 `fault(FrameErr)!Frame` 并补了层 4 |

#### A.5.5 v1 范围（决定要不要砍掉整批）

| # | 议题 | 选项 |
|---|---|---|
| ~~Q9~~ | ✅ **已裁定 = A-28：不砍，B5 v1 就做**。保留 A-4 的非 `pub` 推导，代价 = R-3（中）；换取调用者不必为每个中间层手写具名组 |
| ~~Q10~~ | ✅ **已裁定 = A-29：① 含值级 match 语义** ⇒ N4 / N6 **不可省**；`.{ .a < 1 }` 一个记号两种语义，靠臂位置消歧（§4 末）。⚠ **A-16 因此成为真约束**（值级 match 的 scrutinee 可能是任意表达式） |

#### A.5.6 法律与制度（可延后，但别忘）

| # | 议题 | 结论 |
|---|---|---|
| ~~Q11~~ | L-04 唯一语义验证：`resume` / `recover` / `.abort` 三式 | ✅ **通过 = A-30**（论证见 §9.2） |
| ~~Q12~~ | `trap` 是否复用 `match` | ✅ **已裁定 = A-20/A-21**：`trap` 保留为错误专用关键词（论证见 §8.1），通配臂只允许 `.abort` |
| ~~Q13~~ | raise 处要不要还写错误名 | ✅ **已裁定 = A-22**：**v1 不提供简写**。raise 处原样写 `@clause(.fault, <谓词>, <全名>)`，与组声明逐字对应 |
| ~~Q14~~ | trap 臂是否也接受短名 | ✅ **随 Q13 一并撤销**：既无短键，trap 臂自然保持谓词形式 |
| ~~Q15~~ | repair 登记能否也简写 | ✅ **已裁定 = A-31：不简写**，保留 `@clause(.repair, <名>, <闭包>)` 全包装 |

### A.6 延后项（不阻塞任何批次，但别忘）

| # | 项 | 触发时机 |
|---|---|---|
| P-1 | **错误码整体扫描的必要性评估**：当前 176 条诊断码是否有冗余 / 需整合 / 分类归属错配（§A.4 已记 `CDE` 区间文档与代码不一致一处） | B6 收口后，或下次新增诊断码时顺带做 |
| P-2 | **v2 候选：raise 处短名简写** `Err(.AgeNegative ++ ...)`（A-22 撤销时降级） | 仅当 raise 手写负担**被实测证实**为问题时启用；启用前须重开 L-04 判定 |

---

## 附录 B · B3 批次改动点清单（逐节点）

> 目标：让 `@clause` 支持两个故障变体 ——
> `@clause(.fault, <谓词>, <全名>)` 与 `@clause(.repair, <修法名>, <闭包>)`，
> 并保证它们**只活在编译期**（F-1：不进 IR、不参与 match 臂展开）。
> 前置：B2（谓词模式已落地，`.{ .age < 0 }` 可解析且可校验）。
> ⚠ 诊断码以 `tools/diag_defs.json` 为准（唯一真源）。CLA 段 = `[720,739]`，
> 已用 E720/E721/E722/E723/E724/E726/W727 ⇒ B3 取 **E728 / E729 / E730 / E731**。

### B.1 当前数据流（实测，2026-10-27）

```text
@clause(.pattern, p, body)
  → parse_meta_builtin (parse.tc:6240)    nm == "clause" ⇒ parse_clause_lit
  → clause_kind_member (parse.tc:6168)    仅 "pattern" 合法，其余报 T-CLA-E721
  → node_new("clause")                    sa=类别 / na=pattern / nb=guard / nc=body
  → infer_expr_body (sema.tc:7031)        kind=="clause" ⇒ 直接返回 g_ti_clause，
                                          子树**一概不求值**（AST 位置，不是值位置）
  → meta_eval_rec (sema.tc:13389)         clause 求值**恒等**（返回自身）
  → desugar_clause_splices (parse.tc:3684) clause 常量打编译期标记 ⇒ 不进 IR
```

⇒ **新增变体天然继承「不进运行期」**：clause 子树无人求值，只需保证
① 语法归约接受新形态；② 形态校验落在**构造时**（parse）；③ 不被 match 臂展开误吞。

### B.2 逐节点改动

| # | 文件 · 位置 | 现状 | 改动 | 量级 |
|---|---|---|---|---|
| **M1** | `parse.tc:6168` `clause_kind_member` | 仅 `pattern` | 加 `fault` / `repair`；`clause_kind_list()` 同步（⚠ 报错文案纪律：E721 文案要列**当前真实存在**的成员） | 极小 |
| **M2** | `parse.tc:6178` `parse_clause_lit` | 单一形态（pattern / [when guard] / body） | 按 `km` 三路分派：`.pattern` 原样；`.fault` = 谓词 + 全名（**拒绝 `when`** ⇒ E728）；`.repair` = `.名` + 闭包（**拒绝 `when`** ⇒ E728） | 小 |
| **M3** | `parse.tc` 新增 `clause_pred_field_ok` | — | 校验 `.fault` 的谓词位：必须是 `.{...}`（struct_lit）且每个字段值是**等值字面量**或**关系二元式**（复用 B2 的 `pat_is_relop_text` 判据），否则 E730 | 小 |
| **M4** | `parse.tc` repair 名归约 | — | `.repair` 第二段必须是 `Dot+Identifier`（产 leading-dot member，与 `.Red` 同形），否则 E729 | 极小 |
| **M5** | `parse.tc:3415` `clause_collect` | 见 `clause` 即收 | 仍**全部收集**（保证 `expr_is_clause_group` 为真 ⇒ 编译期标记生效、不漏进 IR），但**置 `g_spl_fault` 标志**标记「含非 pattern 子句」 | 极小 |
| **M6** | `parse.tc:3464` `clause_expand_splice` | 收集的 clause 一律当臂展开 | 若 `g_spl_fault` ⇒ 报 E731（故障/修复子句不能作 match 臂） | 极小 |
| **M7** | `sema.tc:1571` `ClauseKind` 合成枚举 | 仅成员 `pattern` | **本批不动**（字面量类别位由 parse 把守，枚举成员无人引用）。⚠ 留给 B1：若日后 `ClauseKind.fault` 要可引用，须同步此处 | 0 |
| **M8** | 后端（C / LLVM / TIR） | — | **0**（clause 不进 IR；B2 已证 TIR 是 match 单一真源） | 0 |

### B.3 形态总表（消歧靠首段类别成员，无二义）

| 形态 | 判定 | 语义 |
|---|---|---|
| `@clause(.pattern, p, [when g,] b)` | 类别 = `.pattern` | 既有：match 臂子句（参与展开/重排） |
| `@clause(.fault, .{...}, 全名)` | 类别 = `.fault` | **故障子句**（编译期登记，不进臂展开） |
| `@clause(.repair, .名, fn(){...})` | 类别 = `.repair` | **修复子句**（编译期登记，不进臂展开） |

### B.4 门禁

| 项 | 内容 |
|---|---|
| 静态 | conformance pass：两个变体可被声明（`++` 合并亦可）；fail：未知类别（E721）、`.fault` 带 `when`（E728）、`.repair` 名非 `.ident`（E729）、谓词字段非等值/关系（E730）、故障子句进 match 臂（E731） |
| 运行期 | 本批**无运行期语义**（clause 不进 IR）⇒ golden 的判据是「零副作用」：声明故障子句的程序照常运行、双后端输出逐字节一致 |
| 自举 | `tc check src` → 自举 g1 → gate L2 |
| IR 快照 | 预期 **0 漂移**（现有 examples 无一使用新变体）；若出现漂移须逐项说明 |

### B.5 ⚠ 本批**不做**的事（留给后续批次，避免返工）

| 项 | 归谁 | 理由 |
|---|---|---|
| repair 名 → **槽位索引** | **B1** | A-26 已裁定 N（槽位数）是**组**的属性：组内增减 repair 会改变 `fault(E)!T` 布局。在组（B1）落地前做索引属返工 |
| 组的声明与登记 `fault E over T { ... }` | B1 | 同上 |
| `Err(...)` / `trap` / `resume` / `recover` | B4 | 脱糖批 |
| 谓词规范化 + 恒等比较（D7 全量） | B1/B4 | 恒等比较的**另一端**（组声明）尚不存在，无从比较 |

> ⇒ **B3 的净交付**：语法与形态校验层 + 「不进运行期」的保证。它是 B1/B4 的无歧义前置，且不含会被后续批次推翻的部分。

### B.6 编码后的实测偏差（2026-10-27）

| # | 偏差 | 处置 |
|---|---|---|
| **M9** | **sema 的 `++` 分支原先只放行 bitstr/String/Slice/Array/Map**，`clause ++ clause` 报 `T-BIT-E515` ⇒ **D4「`++` 已存在 ⇒ 增量 0」是未验证的文档债务**（parse 侧 `clause_collect` 的 Concat 分支一直存在，但从走不到） | 在 `sema.tc` 的 `op == "Concat"` 分支最前加 `Clause ++ Clause ⇒ Clause`（与 `[C0,C1]` 数组式同义）。这是本次唯一一处**超出附录 B 预估**的改动 |
| **M10** | `parse_clause_lit` 的谓词位必须**临时置 `g_in_match_pat = true`**：`parse_struct_lit` 的谓词分支只在模式位生效，表达式位的 `.{ .age < 0 }` 不会走谓词分支 | 已在 `.fault` 分支内包裹保存/恢复 |
| **M11** | E731 用例会**附带**一条 `T-MAT-E740`（`F_AGE` 大写被当 case 名）—— 是拼进臂链后的二次误读 | 无害：conformance 的判据是「期望码出现」，不要求唯一 |

---

## 附录 C · B1 批次改动点清单（逐节点）

> 目标：落地**具名故障组声明** `fault E over T { ... }` 与**错误联合类型** `fault(E)!T`
> 的运行期表示。前置：B2（谓词模式）、B3（`@clause(.fault/.repair)` 变体）均已完成。
> ⚠ 诊断码以 `tools/diag_defs.json` 为准（唯一真源）。

### C.0 ⚠ 开工前实测出的两处「文档没写、但会决定布局」的事实（2026-10-27）

| # | 实测 | 后果 |
|---|---|---|
| **F-1** | §5 运行层写作 `{ tag: i64, repairs: [N]%TClosure }`，**没有承载成功值的字段**；但 `Ok(u)` 必须把 `u` 带出去，而借道「合成一个 Ok 闭包塞进 repairs[0]」会违反 §7.1 **R-opt3（成功路径零成本）** | ⇒ **必须**有独立的 `val: T` 字段 |
| **F-2** | 实测「**数组元素**上的闭包间接调用」在当前双后端是坏的：`v.rs[2]()` 发射未定义符号 `t__`（链接失败）；把元素先取到局部再调用则**静默无输出**（崩溃）。而**结构体单闭包字段** `v.r()` 完全正常 | ⇒ `repairs` 用 `[N]%TClosure` 会把 B4 的 `resume` 脱糖直接架在未验证的后端通路上 |

### C.1 新裁定 A-32（运行期布局 · 对 A-27 的**细化**而非推翻）

```text
fault E over T   ⇒  sema/parse 合成具名 struct `__fault_<E>`：
    tag : i64            // 0 = Ok；成员 i 的 tag = i + 1
    val : T              // 成功值（T == over T）；T 为 void 时省略该字段
    r0 .. r(N-1) : fn() T   // 组内全部 repair 槽位，按成员声明序展平
```

- **保留 A-27 的实质**：仍是「sema 为每组合成具名 struct」⇒ **不新增 TI kind、不碰后端**。
- **相对 §5 原文的两处偏离**：① 加 `val: T`（F-1，R-opt3 要求成功路径零分配）；
  ② `[N]%TClosure` 改为 **N 个独立字段**（F-2，绕开数组元素闭包调用这条未验证通路）。
- **槽位编号（R-2，B3 已把此项移入 B1）**：按成员声明顺序展平，成员 m 的第 k 个 repair
  ⇒ 字段 `r<base(m)+k>`；`base(m)` = m 之前所有成员的 repair 数之和（A-26：N 属组）。
- ⚠ `tag` 从 **1** 开始编号给成员，0 保留给 Ok —— 使「未初始化 = Ok」这一零值语义成立
  （B1 的 golden 正是靠 `var v : fault(E)!T;` 读 `v.tag == 0` 来钉住布局的）。

### C.2 逐节点改动

| # | 文件 · 位置 | 改动 | 量级 |
|---|---|---|---|
| **P1** | `lib/std/rc/cst.tc` 关键字表 | ⚠ **实测改过**：`fault` 起初做成 forced（`KwFault`），结果打断了 B3 的 4 个用例 —— `@clause(.fault, ...)` 的 `.fault` 是**成员名**，`expect_tok("Identifier")` 撞语法错。⇒ `fault` / `over` / `repairs` **一律 mod 阶**（上下文关键词，lexer 仍发 Identifier，parser 按词文本+前瞻判定）。另：`over` 在 `src/parse.tc:1140` 是局部变量名，强制化会直接破坏自举源码 | 极小 |
| **P2** | `tools/cst_kinds.json` + `tools/cst_nodes.json` | 新增 kind `FaultDecl`（sa=组名 / na=over 类型节点 / la=成员链）⇒ `node tools/cstgen.mjs --emit` 重生成两处 GEN 区 | 小 |
| **P3** | `src/base.tc` | 手写 `mk_FaultDecl`（GEN 区外，与其它 mk_* 同列），含 `cst_register_RecFaultDecl` 双写 | 极小 |
| **P4** | `src/parse.tc` `parse_declaration` | 新增 `KwFault` 分支 → `parse_fault_decl` | 极小 |
| **P5** | `src/parse.tc` 新增 `parse_fault_decl` | `fault <名> over <类型> { 成员; … }`；成员 = 谓词 `->` `组名.成员名` [`repairs { .a, .b }`] `;`。谓词位须**临时置 `g_in_match_pat`**（与 B3 的 M10 同族）。成员复用既有 `F` 节点（sa=成员名 / na=谓词 / la=repair 名链），**不新增第二个 kind** | 中 |
| **P6** | `src/parse.tc` 合成 struct | 组声明解析完毕后立即合成 `__fault_<E>`（此时 N 与 over T 都已知）追加进 `decl_list`，先于 `FaultDecl` 本身 | 小 |
| **P7** | `src/parse.tc` `parse_type_inner` | `fault ( E ) ! T` → 校验 E 已声明（E732）、T 与 `over T` 同构（E733），返回 `mk_named("__fault_" + E)` | 小 |
| **P8** | `src/sema.tc` `check_decl` | 新增 `FaultDecl` 分支 → `check_fault_decl`。⚠ **实测改过**：原估「HIR 侧零改动」（靠 `hir_lower_decl` 的 RAW 兜底 + `check_decl_hir` 回落）**被门禁证伪** ⇒ 见 **D-10** 与 P12 | 极小 |
| **P9** | `src/sema.tc` 新增 `check_fault_decl` | 组名唯一（E739）/ 成员名唯一（E725）/ 谓词形态（E734）/ 谓词字段须在 `over T` 中（E735）/ 组内谓词重复（E736）/ 成员内 repair 名重复（E737）；登记成员与槽位表 | 中 |
| **P10** | `tools/diag_defs.json` | 实测新增 **11** 条（182 → 193）：CLA 段 `E725 / E732 / E733 / E734 / E735 / E738 / E739`；MAT 段 `E747 / E748 / E749 / E752`（谓词类诊断归 MAT，不占 CLA 的 `[720,739]`） | 小 |
| **P12** | `src/hir.tc` `hir_lower_decl` + `src/sema.tc` `check_decl_hir` | ⚠ **编码后新增**（D-10）：`FaultDecl` 显式降级为 `HIR_OP_TYPE_ALIAS_DECL`（sa=组名 / ty=`over T`），并在 `check_decl_hir` 显式回落 `check_fault_decl` | 极小 |
| **P11** | 后端 | **0**（合成的是普通 StructDecl，走既有通路） | 0 |

### C.3 门禁

| 项 | 内容 |
|---|---|
| 静态 | conformance pass：组声明 + `fault(E)!T` 签名 + 变量声明 + 读 `.tag`/`.val`；fail 8 例：未知组 / T 与 over 不一致 / 谓词重复 / repair 名重复 / 组名重复 / 成员名重复 / 谓词形态 / 谓词字段不在 T |
| 运行期 | ⚠ B1 有真实运行期产物（合成 struct 进入 IR）⇒ **必须**有 golden：`examples/faultgroup_demo` 声明组 + `var v : fault(E)!T;` 读 `v.tag`(0) 与 `v.val.age`(0)，**双后端逐字节一致** |
| 自举 | `tc check src` → 自举 g1 → conformance → golden → gate L2 → 用 gate 的 g1 重录 IR 基线 |
| 已知不覆盖 | 槽位索引的正确性在 B1 **无消费者**（B4 的 `resume` 才读），故 B1 只保证「计算逻辑 + 登记表」存在，正确性由 B4 的 golden 钉住（已记入 `docs/design/fault/TESTS.md`） |

### C.4 ⚠ 本批**不做**（留给 B4/B5，避免返工）

| 项 | 归谁 | 理由 |
|---|---|---|
| `Err(...)` / `Ok(...)` / `trap` / `resume` / `recover` | B4 | 脱糖批；且 `Ok` 需要「写 val」这条通路，本批无人构造该结构 |
| 谓词常量折叠后再比较（A-25） | B4 | 组内判重只需**结构键**；跨位置（raise ↔ 组声明）比较才需要折叠 |
| 组 → 生成纯谓词校验函数（A-23） | B4 | 同上，属生成物 |
| 跨模块组可见性（`.tlib` 摘要） | B5 | 与跨函数可达集分析同一基础设施 |
| 组名 / 成员名必须大写开头（EBNF 写 UpperIdent） | 延后 | 未定诊断码，先不设限（已记入 §A.6 延后项） |
| **数组元素上的闭包间接调用** | B4 前置 | 实测坏（C.0 F-2）；本批用 N 个独立字段绕开，但若 B4 想改回 `[N]%TClosure`，须先修该通路 |

### C.5 编码后的实测偏差与既有缺口（2026-10-27）

| # | 偏差 / 缺口 | 处置 |
|---|---|---|
| **D-5** | `fault` 强制成关键字 ⇒ B3 的 `@clause(.fault, ...)` 解析失败（conformance 4 例红） | 三个新词统一降为 **mod 阶上下文关键词**（见 P1 修订行） |
| **D-6** | **TD / TI 混淆**：`resolve_type_desc` 返回的是 `tds`（类型**描述**）下标，不是 `tis`（类型）下标。喂给 `tip_name` 会读到无关表项 —— 实测把第二组的 `over Frame` 报成「over 类型 `User`」 | 改用 `resolve_ti`。⚠ 这两张表同在 sema 且都叫「类型」，凡 `tip_*` 前必须确认拿到的是 TI |
| **D-7** | `g_fgrp_mem_cnt[g]` 若在循环**结束后**才回写，整轮循环里它恒为 0 ⇒ 成员名判重静默失效（用例 `f_fault_dup_member` 只报出无关诊断） | 计数改为**循环内增量回写** |
| **D-8** | `ann_pass` 遍历每条 decl 的 `la` 当注解链校验，而 `decl_target` 对未知 kind 兜底返回 `"global"` ⇒ **每个组成员名都被当成未知注解**报 `T-ANN-E450` | 在 `ann_pass` 显式跳过 `FaultDecl`。⚠ 这是「新增 decl kind」的通用地雷：任何按 `decl_target` 兜底分派的 pass 都要复查 |
| **D-9** | `parse_fault_decl` 里 `append(lex.decl_list, fd)` 是**重复**的：`parse_unit` 会追加 `parse_declaration` 的返回值（dump-ast 出现两份同 id 的 FaultDecl） | 只 append 合成的 StructDecl，FaultDecl 靠返回值进表 |
| **G-1** | ⚠ **既有后端缺口**（与 B1 无关，用 pre-B1 编译器复现过）：**tmir-c 无法编译「返回结构体的闭包」** —— `__lam_N` 声明为 `static void __lam_N(unsigned char* __sret)`，调用点却写 `return __lam_N();` | B4 的 repair 闭包必然撞它 ⇒ 双后端 golden 会立刻抓到，先修再谈 B4 |
| **G-2** | ⚠ **既有后端缺口**：「**数组元素**上的闭包间接调用」在 LLVM 轨发射未定义符号 `t__`（链接失败）；先取到局部再调用则静默崩溃。结构体单闭包字段 `v.r()` 正常 | A-32 因此用 N 个独立字段而非 `[N]%TClosure`；若 B4 想改回数组，须先修这条 |
| **G-3** | ⚠ **既有后端缺口**：**嵌套字段赋值** `v.val.age = 42` 双后端都不生效（读到 0）；整结构体赋值 `v.val = User{...}` 正常 | golden 改用整结构体赋值 |
| **D-10** | ⭐ **HIR 侧不是零改动**（推翻 C.2 P8 的「HIR 零改动」预估）：`hir_lower_decl` 的 `else` 兜底给未知 kind 发 `HIR_OP_RAW`，而门禁 **「RAW 合计 0」是硬判据**（`hir_test` 扫全部 143 个 examples/src）⇒ `examples/faultgroup_decl.tc` 1 处 RAW 直接让 gate L2 第 15 步 FAIL | 复用 `HIR_OP_TYPE_ALIAS_DECL`（与「模块值别名复用 `IMPORT_DECL`」同款手法）：`sa`=组名、`ty`=`over T` 文本；**并在 `check_decl_hir` 显式回落 `check_fault_decl`** —— 否则会掉进「其余 type_alias：声明期无动作」的兜底，组的语义校验被整趟静默跳过 |
| **D-11** | ⭐ **「兜底分派」是新增 decl kind 的系统性雷区**：D-8（`ann_pass` 的 `decl_target` 兜底）与 D-10（`check_decl_hir` 的 op 兜底）是**同一类** —— 新增 kind 若只靠「兜底路径也能走通」，一定会在某个要求更严的门禁上炸 | 新增 decl kind 的清单：① `ann_pass` ② `hir_lower_decl` ③ `check_decl_hir` ④ `register_decl` —— 四处都要**显式**处理，不能依赖兜底 |

### C.6 快照差异的判读（B1 实测）

| DIFF / NEW | 成因 | 是否合法 |
|---|---|---|
| `src/tc.tc::c` / `::ll` | 编译器自身源码变了，发射产物必然变 | ✅ 合法 |
| `examples/import_module_type.tc::c` / `::ll` | 该例用 `@type_info` **反射 `src.base`**；给 `base.tc` 新增 `pub fn` 会改变模块公开面 ⇒ IR 字节变 | ✅ 合法（**stdout 未变**，run_examples 双后端 PASS）|
| `examples/faultgroup_demo.tc::c` / `::ll` | 本批新增示例 | ✅ 合法（NEW）|
| 4 个 `@import("std.*")` 示例 × 双后端成片 DIFF | ⚠ **比对用了非 gate 的 g1**（如 `bootstrap_tc` 产出的 `_xxx.exe.exe`） | ❌ 伪差异 —— 先用 gate 的 `out/dbg/g1.exe` 重录 |

⇒ ⭐ **IR 变 ≠ 语义变**：先看 `run_examples_tmir` 的 stdout 对拍，再看 IR 快照。
⇒ ⭐ 判据模板：**「0 GONE + 每条 DIFF/NEW 都能指名道姓解释」= 合法漂移**。

---

## 附录 D · B4 前置：后端缺口 G-1 修复（2026-10-28）

### D.0 为什么必须先修

B4 的 repair 闭包签名是 `fn() T`，而 `T` 就是组的 `over T`（用户结构体的常态）。
⇒ 只要 `T` 是聚合，**tmir-c 轨整份编译失败**，双后端 golden 立刻红。

### D.1 复现与根因

最小复现（`examples/closure_struct_ret.tc` ①）：

```t
struct Pt { x: i64; y: i64; }
var f = fn () Pt { return Pt{ .x = 11, .y = 22 }; };
var p: Pt = f();
```

tmir-c 发射出：

```c
static void __lam_0(unsigned char* __sret);          // ← 用户聚合返回：sret 约定
static unsigned char* __lam_0__clo_thunk(void* __env) {
  return __lam_0();                                   // ← ❌ 少了 __sret 实参
}
```

根因是**两套 ABI 混用**：

| 约定 | 签名 |
|---|---|
| 用户函数（聚合返回） | `void <fn>(unsigned char* __sret, <params…>)`（与 LLVM 轨逐字对齐）|
| 统一 TClosure ABI | `code(env, 实参…)`，聚合返回时**返回聚合缓冲指针** `unsigned char*` |

`c_emit_thunks` 只按「形参原样转发」生成体，没做 sret 适配。

### D.2 修复

`src/codegen_c_tmir.tc` 两处：

1. **`c_emit_thunks`**：返回类型是 sret 聚合时，thunk 体改为
   `分配缓冲 → <fn>(__sret, <args…>) → return __sret`。
2. **`c_clo_code`**：⭐ **判据从「带 env 首参 ⇒ 用裸函数名」改为「聚合返回 ⇒ 一律走 thunk」**。
   - 旧判据在**标量**返回下成立（env 是真实首参，`code(env, args…)` 就是它自己）；
   - 但带 env 的**聚合返回**函数签名是 `void <fn>(unsigned char* __sret, void* __env, args…)`，
     当 code 用会让 env 落进 `__sret`、用户实参整体错位（**G-1b**，同源的第二处）。
   - 附带细节：带 env 时 thunk **不再另加** `void* __env`（否则与自带 `__env` 形参重名，C 编译不过）。

### D.3 验证（2026-10-28 全量，24 步逐项实跑）

- `examples/closure_struct_ret.tc`（① 不捕获 ② 捕获外层变量）双后端 **逐字节一致**
- **自举不动点**：g1.ll == g2.ll == g3.ll == g4.ll（`0fe9c283…`）
  —— 强于门禁判据（只需 g2 == g3）
- ⭐ **C 后端自举（cself）**：`g4.exe --emit-c src/tc.tc` → clang → 该 C 产物再
  `emit-ll src/tc.tc`，与 LLVM 产物 **md5 逐字节相同** ⇒ 修复后的 C 后端能编译编译器自身且行为一致
- conformance 415/415（g1 与 C 自举产物各一遍）；run_examples dbg 109/109；
  run_examples_tmir 134/134；difftest 代际对拍 27/27；双轨对拍 109/109；
  MIR opt=1/2 FAILS:0；lint 冒烟 0 findings；ir_verify 0 warn；LLVMVerifyModule OK
- **产物快照**：唯一 FAIL（合法漂移）→ 用 g1 重录 **144 targets / 291 entries**（B1 基线为 143/289：
  +1 target = 新增 `closure_struct_ret`，+2 entries = 其 `::ll` / `::c`），回验 **291/291 逐字节相同**
- ⚠ **执行方式偏差**：本批门禁**不是**一次 `gate.mjs L2` 跑出来的 —— 后台执行通道故障（exit 125），
  改为按 gate.mjs 的步骤定义**逐条手工复现**并各自记录证据（日志见 `out/_*.log`）。
  判据与 gate 完全一致，但**没有 gate 自身的汇总行**作为单一证据来源。

### D.4 ⚠ 仍未修：G-2（数组元素上的闭包间接调用）

`fs[0]()` 在**双后端**都发射未定义符号 `t__`（链接失败）；先取到局部再调用则静默崩溃。
- 根因在**前端**（callee 是 index 表达式 ⇒ 名字解析为空），不在后端。
- **不阻塞 B4**：A-32 已用 N 个独立字段 `r0..r(N-1)` 绕开数组通路；`resume(.name)` 的槽位索引是编译期常量。
- 若日后想改回 `[N]%TClosure`，须先修这条。

---

## 附录 E · B4 批次改动点清单（逐节点）

### E.0 ⚠ 开工前实测出的三处「设计稿没写、但决定形态」的事实（2026-10-28）

| # | 实测 | 后果 |
|---|---|---|
| **F-3** | ⭐ **`Ok` / `Err` 已被 variant 变体名占用**：`examples/adt_status.tc` 有 `variant Status { Ok(i64); Err(i64); _ }`，`tests/conformance/pass/p50/p55` 亦用 `Ok` / `Err` 作变体名 | ⇒ **`Ok`/`Err` 绝不能做成关键字**（forced 或 mod 阶都不行）：既破坏既有程序，又抢走用户命名空间。改走 **A-35** 的「预期类型 + 名字未声明」双条件判定 |
| **F-4** | `.abort` 臂的值是 `fault(E)!T`，成功臂的值是 `T`，**二者不同型**；而 `match` 要求各臂同型 | ⇒ **`trap` 脱糖不成单个 `match` 表达式**（推翻 §5 的脱糖示意）。改走 **A-33** 的「var + if 链 / 每支 return」形态 |
| **F-5** | `stmt_returns()` 已能识别「`match` 全臂 `return`」与「`if` 两支都 return」⇒ 脱糖后的形态**无需**新增任何流分析 | 零新增流分析（A-33 直接复用） |

### E.1 两条新裁定（A-33 / A-34 / A-35）

**A-33（trap 的脱糖形态）** —— `trap` 脱糖为「`var __fv = <e>;` + **按 tag 的 if 链**，每支以 `return` 结尾」，
**不是**单个 `match` 表达式。

- 理由（F-4）：`.abort` 臂要 `return __fv`（类型 `fault(E)!T`），成功臂要 `return __fv.rK()`（类型 `T`），
  同一 `match` 的臂必须同型 ⇒ 装不下。if 链每支是独立 `return` 语句，类型各归各位。
- 判据仍是 L-04：if / var / 字段读 / 间接调用**全是既有节点**，不加新发射路径。

```text
return trap serve(c) {
    .{ .magic != 0xCAFEBABE } => resume(.skip),
    .{ .len > 16384 }         => resume(.truncate),
    _                         => resume(.abort),
};
```
⇒
```text
var __fv1 : fault(FrameErr)!Frame = serve(c);
if (__fv1.tag == 1) { return __fv1.r0(); }   // NotOurs.skip → 槽 0
if (__fv1.tag == 2) { return __fv1.r2(); }   // TooLarge.truncate → 槽 2
return __fv1;                                 // .abort：原样上传
```

**A-34（trap 的位置约束）**

| 位置 | 通配臂 `.abort` | 穷尽性 |
|---|---|---|
| `return trap <e> { … };`（return 位置） | ✅ 允许 ⇒ `return __fv` | 有 `.abort` 时不要求穷尽 |
| `var x : T = trap <e> { … };`（初始化位置） | ❌ **禁止**，报编译错 | **必须穷尽**组内全部成员 |

- 理由：`.abort` 的语义是「把故障原样返回给调用者」（A-19），非 return 位置没有返回值可承载它。
- 与 **A-21**（通配臂只允许 `.abort`）合起来 ⇒ 非 return 位置**压根没有通配臂可用**，
  A-15（不能吞掉未处理故障）因此是**结构性**的，不靠 lint。

**A-35（Ok / Err 的识别方式）** —— 不做关键字，走**双条件**判定：

1. 所在位置的**预期类型**是 `fault(E)!T`（return 该类型 / 赋值给该类型的变量）；
2. `Ok` / `Err` 在当前作用域**不是已声明的函数**。

- 满足两条 ⇒ 当构造器；否则当普通 `call`（用户函数照旧可用）。
- 代价：`fn Ok(...)` 定义在**返回 `fault(E)!T`** 的函数里被 `return Ok(x)` 调用时会被抢。
  ⇒ v1 接受；诊断在「预期是 fault union 但构造失败」时才发，普通场景零影响。

### E.2 逐节点改动

| # | 落点 | 改动 | 量级 |
|---|---|---|---|
| **Q1** | `src/parse.tc` 主表达式位 | 按**词文本 + 前瞻**识别 `trap`（后跟非 `(`）/ `resume`（后跟 `(`）/ `recover`（后跟 `(`），产出专用节点；⚠ `Ok` / `Err` **不动**（A-35，parse 期照旧是普通 `call`） | 中 |
| **Q2** | `src/parse.tc` | `trap` 的臂解析复用既有 `arm` 节点（与 `match` 同形），臂右侧为 `resume(...)` / `recover(...)` | 小 |
| **Q3** | `src/sema.tc` return 检查 | 遇 `trap` ⇒ 按 A-34 判定位置；按 A-33 合成 `var __fv` + if 链；臂的谓词经 `fault_pred_same` 与组内声明比对（A-2/A-25）⇒ 得 tag；`resume(.name)` 经 `fault_repair_slot` ⇒ 得槽位 | **大** |
| **Q4** | `src/sema.tc` | `Ok(e)` / `Err(...)`：按 A-35 双条件拦截 ⇒ 合成 `__fault_<E>` 的 `struct_lit`（`tag` 字面量 / `val` / `rK` 闭包），再走既有 `infer_expr` | 中 |
| **Q5** | `src/sema.tc` | 谓词常量折叠（A-25）：`Err` 与 `trap` 臂的谓词须与组内声明**规范化后恒等** | 小（B1 已有 `fault_pred_same`）|
| **Q6** | `tools/diag_defs.json` | 新诊断码（复用 CLA/MAT/CLO 段，**不开 FLT**，A-24） | 小 |
| **Q7** | `examples/` + golden | 至少 1 个**运行期**双后端 golden（conformance 只 check，§10） | 小 |

### E.3 门禁

同 §C.3：`tc check src/tc.tc` → 自举 g1/g2 → gate L2 → conformance → examples 双后端 → IR 快照重录。

### E.4 ⚠ 本批**不做**（留给 B5 / v2）

| 项 | 归谁 | 理由 |
|---|---|---|
| 组 → 生成纯谓词校验函数（A-23） | v2 | A-23 已把它降级为「可选收益」；与本批的构造/消费通路正交 |
| `trap` 的**表达式**位置（`var x = trap …` 之外的任意表达式位） | v2 | A-34 只开 return / 初始化两个位置，其余留白 |
| 非 return 位置的隐式传播（`var f = decode(buf);`） | B5 | 属跨函数可达集分析（R-3） |
| G-2（数组元素上的闭包间接调用） | 延后 | A-32 已绕开；`resume` 的槽位是编译期常量，不碰数组通路 |

---

## 附录 F · B4a 实测结果（raise 侧，`Ok` / `Err`，2026-10-28）

### F.1 落地的东西

| 形态 | 脱糖产物 |
|---|---|
| `return Ok(v)` | `__fault_<E> { .tag = 0i64, .val = v }` |
| `return Err(@clause(.fault, .{p}, E.M), @clause(.repair, .n, fn() T {…}), …)` | `__fault_<E> { .tag = <K>i64, .r<slot> = <闭包> }` |

- 入口 `fault_raise_try` 挂在 `sema::cs_return` 的 **infer 之前**（`infer` 之后再改写就轮不到了：
  `Ok`/`Err` 会先被当成对未声明函数的调用而报 T-SEM-E2xx）。
- 就地改写手法照抄 `infer_expr_body` 的 `variant_lit → call` 脱糖：
  建新节点 → `node_set_kind/na/la/sa/ia` → `hir_invalidate`。**不新增节点 kind**
  ⇒ HIR 侧零改动（实测 RAW 逃生舱合计 **0** / 145 文件）。
- 新诊断码 **6 条**（`T-MAT-E753…E758`），诊断码总数 193 → **199**。

### F.2 ⚠ 实测偏差与新缺口

| # | 内容 | 处置 |
|---|---|---|
| **D-12** | ⭐ **差点误判**：`++` **是存在**的 —— 它的 op 名是 **"Concat"**（B3 已为它加过 Concat 分支，见 DESIGN.md D-4）。按字面量 `"++"` 去 grep 会 0 命中，首版据此断言「t 没有 `++`」而改用逗号实参 | 实现改为**同时**支持两种形态（递归展平 Concat 链）：`Err(c1 ++ c2 ++ c3)` 与 `Err(c1, c2, c3)`。golden 用设计稿的规范形态 `++`，两种形态各有一致性测试覆盖 |
| **D-13** | ⭐ `Ok` 必须**显式**写 `.tag = 0i64`，不能省略靠零初始化 | 见下方 G-6；缺失**聚合/指针**字段无害，补 tag 即可 |
| **G-4** | ⚠ 既有缺口：**非捕获** lambda 当闭包值用 ⇒ `store i64 @__lam_0, ptr %x`（全局引用非指针）链接失败。捕获了变量的 lambda 正常（按值捕获 ⇒ `__env_N` 堆分配） | 本批绕开（golden 的 repair 闭包都捕获了 `u`）；**B4b 的 `recover(e)` 会撞它**（合成闭包可能不捕获） |
| **G-5** | ⚠ 既有缺口：从**闭包调用结果直接读 string 字段**（`g().name`）打出空串且程序随后停住；i64 字段可以，普通非闭包函数 `mk().n` 也正常。与 fault 无关（不含任何 fault 代码即可复现） | golden 一律「先落局部变量再读字段」 |
| **G-6** | ⚠ 既有缺口：**C 后端**对结构体字面量缺失的**标量**字段分配 **0 字节缓冲**并把**指针**当值用 ⇒ `incompatible pointer to integer conversion`。改动前的编译器对普通 `P3{ .a = 5 }` 同样炸 | 本批靠**补全 tag 字段**绕开（不动后端）；缺失聚合/指针字段是正常的 |
| **D-14** | ⭐ `base.kids_chain_idx(la)` 返回的是 **kids 链下标**，不是节点 id —— 必须再取 `kids[i].val` | 首版三处直接用下标当节点 ⇒ `Err(...)` 的实参全判成非 clause（`T-MAT-E754` 误报） |

### F.3 门禁证据

- `tc check src/tc.tc` **errors=0 / warnings=638**（与改动前持平，无新增警告）
- conformance **421 passed / 0 failed**（+6 条新 fail 用例全绿）
- `run_examples_tmir --all` **135 passed / 0 failed**（+1 新 golden，双后端逐字节一致）
- `hir_test` RAW 逃生舱 **0**（145 文件）
- 自举不动点：**g1.ll == g2.ll** = `07f09e78…`（g1/g2 的 **exe** md5 不同，但那只是二进制里嵌了输出路径，判据看 IR）
- 产物快照：用 gate 方式构建的 `out/dbg/g1.exe` 重录 **145 targets / 293 entries**（ll:145 / c:145 / dev:3）
- `examples/faultraise_demo` 双后端输出逐字节 = `0 / amy / 1 / 18 / 0 / 2 / 3 / anon`

### F.4 ⚠ B4 尚未完成的部分（B4b）

- `trap` / `resume` / `recover` / `.abort` —— **未开工**。
  它需要**语句插入**（`var __fv = e;` + 按 tag 的 `if` 链 + 每支 `return`），
  而 B4a 用的「就地改 kind」手法**不适用于插入语句** ⇒ 须另找 desugar pass 钩子。
- 组 → 生成纯谓词校验函数（A-23）：未开工。
- ⚠ B4b 的 `recover(e)` 脱糖出的合成闭包**可能不捕获任何变量** ⇒ **必然撞 G-4** ⇒ 先修 G-4。

---

## 附录 G · B4b 实测结果（消费侧，`trap` / `resume` / `recover` / `.abort`，2026-10-28）

### G.1 落地的东西

`trap` 脱糖（A-33）的**实际**产物 —— 位置① `return trap <e> {…};`：

```text
// 无 .abort（签名 = T，必须穷尽）
var __tfv_N : fault(E)!T = <e>;
if (__tfv_N.tag == 1) { return __tfv_N.r0(); }
if (__tfv_N.tag == 2) { return __tfv_N.r2(); }
return __tfv_N.val;

// 有 .abort（签名 = fault(E)!T，不要求穷尽）
var __tfv_N : fault(E)!T = <e>;
if (__tfv_N.tag == 1) { return Ok(__tfv_N.r0()); }   // ← A-33 示意里漏掉的那一层
return __tfv_N;                                       // .abort：原样上传
```

位置② `var x : T = trap <e> {…};`：

```text
var __tfv_N : fault(E)!T = <e>;          // ┐ 三条都在**父作用域**，产物块不新开作用域
var x : T = __tfv_N.val;                 // │
if (__tfv_N.tag == 1) { x = __tfv_N.r0(); }   // ┘
if (__tfv_N.tag == 2) { x = <recover 表达式>; }
```

- 入口挂在 **语句分派位**（不是表达式位）：`cs_return` 与 `cs_var_decl` 的**最前**（infer 之前），
  因为臂体 `resume(...)` / `recover(...)` 是合成的 `call` 节点，先走 infer 就会被当成对未声明
  函数 `resume` / `recover` 的调用而报 T-SEM-E201。
- 产物在**当前作用域**逐条 `check_stmt`（不新建作用域 ⇒ 位置② 的 `x` 对块外可见，A-34）。
- 全部产物是既有节点（`var_decl` / `if` / `return` / `assignment` / `member` / `call` / `binary`）
  ⇒ L-04 成立：不加新 kind、不加新发射路径、HIR 侧零改动。
- 新诊断码 **11 条**（`T-MAT-E759` … `T-MAT-E771`），诊断码总数 199 → **210**。

### G.2 ⚠ 与 A-33 设计稿的偏差

| # | 内容 | 处置 |
|---|---|---|
| **D-15** | ⭐ **A-33 的脱糖示意漏了 `Ok` 那层**：示意写 `return __fv1.r0()`，那只在「函数签名就是 `T`」时成立。有 `.abort` 臂时签名**必**是 `fault(E)!T`，不包会直接在 return 处报 T-SEM-E202（`expected __fault_UserErr but got User`） | 消费臂一律补 `Ok(<修复值>)`，交给 B4a 的 `fault_raise_ok` 就地改成 `__fault_<E>` struct_lit |
| **D-16** | ⭐⭐ **`lex.cur_t() == "_"` 是恒假的死判据**：lexer 不产 `"_"` 这个 token 类型（`_` 走 is_ident_start）⇒ 通配臂 `_` 从未被识别，谓词解析拿到 `ident("_")` 而报 E759。既有 `parse.tc` 的 939/5022/5328/5412/5433 等处仍是这个错形态 | 改为 `lex.cur_t() == "Identifier" and lex.cur_v() == "_"` |
| **D-17** | ⭐ 位置② 的产物块**不能**是新作用域：TIR 的 `tir_find_local_idx` 用 `g_local_depths[i] <= g_blk_depth` 过滤 ⇒ 块内声明的 `x` 出了块就查不到 ⇒ 当成未定义全局 ⇒ 链接期 `undefined symbol: x` | 产物块打 `bf=1`，`tir_emit_stmt` 的 block 分支据此跳过 `tir_blk_push/pop` |
| **D-18** | 脱糖失败会挨**两条**诊断：具体码 + 一条误导的 E764（退回普通路径后由 infer 的 match 分支补发） | 发诊断时给 trap 节点打 `bc=1`，infer 的 match 分支见到 bc 就不再补发 |
| **D-19** | `parse_fatal_at(code, msg, ti)` 收 **token 索引**（且 `exit(1)`），传节点 id 会把诊断定位到完全无关的源码位置 —— 排查时极误导 | 一律传 token 索引 |
| **D-20** | ⭐ **脱糖产物嵌套 ⇒ 后续 pass 不递归进入**：`fault_raise_try` 挂在语句分派位，只看到顶层语句；if 分支内的 `return Ok(...)` 轮不到它 ⇒ `Ok` 原样走到后端（LLVM 类型不符 / C 报 `t_Ok` 未声明） | `Ok(...)` 在**脱糖当场**就地改写，不留给后续 pass |
| **D-21** | `recover(e)` 直接脱糖成 `return e;` / `x = e`，**不真的合成闭包** —— A-23 的「recover = resume(合成闭包)」只是**语义等价**说明，产物没必要造一个 thunk 再调用它。顺带彻底避开 G-4 | 采纳 |

### G.3 G-4 已修（B4b 的前置）

- ⚠ **旧归因是错的**：F.2 记的「非捕获 lambda 当闭包值」被证伪 —— 非捕获 lambda（`var f = fn(){…}`）与
  具名函数单独使用**都正常**。真因是 **fn 类型的槽（struct 字段 / 变量）被写成裸函数符号**。
- 修在 **TIR 层**（不写后端 shim）：
  - `tir_emit_struct_lit` 的具名字段：`Box{ .r1 = seven }`
  - `tir_emit_assign` 的 member 分支：`b.r0 = seven`
  - 判据「值以 `@` 开头 = 裸函数符号」⇒ `tir_make_closure_value`（堆分配 16B `%TClosure`，
    GEP[0,0] 存 code、GEP[0,1] 存 env，返回 `ptr<void>`）。
- ⭐ 两条**互斥**的 fn 槽语义（这是本批最易混的一点）：
  - ① `%TClosure.field0`（闭包构造）必须存**裸 code** —— `CALL_IND` 直接 `call field0`；
  - ② fn 类型的**变量 / 结构体字段**必须存**闭包值** `ptr %TClosure` —— 下游是「取 8 字节当 `TClosure*` 再解包」。
- ⚠ 后端层修不动：fn 槽的 TIR 型是 `ptr<void>`，与 `%TClosure` 基址无从区分（两轮后端层尝试均失败并回退）。
- ⚠ member 分支取字段 TD 必须用 `tir_member_expr_td`（沿 member 链自解析），用 `tir_expr_td` / `tir_lhs_td` 会落兜底拿不到。

### G.4 门禁证据

- `tc check src/tc.tc` **errors=0 / warnings=638**（与改动前持平，无新增警告）
- conformance **434 passed / 0 failed**（+1 pass / +11 fail 用例全绿）
- `run_examples_tmir` **111 passed / 0 failed**（+1 新 golden `faulttrap_demo`，双后端逐字节一致）
- `examples/faulttrap_demo` 双后端输出逐字节 =
  `0 / bob / 77 / fixed / 0 / bob / 3 / anon / 7 / amy / 99 / bob / 0 / 0 / 2 / 3 / anon`

### G.5 ⚠ B4 尚未完成的部分

- ⚠ **`trap` / `resume` / `recover` 未进 lex 关键字表**（A-20 的 v1 取舍：做成词法关键字会连累
  HIR/cstgen 关键字清单，与收益不成比例）。代价：名为 `trap` 的函数/变量在**表达式位**会被本语法
  抢走（`return trap(x);` 会因 `expect_tok("LBrace")` 失败而报 T-PAR-E101）。当前 src/lib/examples/tests
  全仓 0 命中。v2 若需支持用户自定义 `trap` 标识符，在 `parse_primary` 的识别处补
  `and lex.peek_t(1) != "LParen"` 前瞻即可（`resume` / `recover` 只在臂内识别，天然不冲突）。
- B4b 的**跨函数**部分（B5）：跨函数可达集分析（R-3）—— 未开工。
- 组 → 生成纯谓词校验函数（A-23）：未开工（v2 候选）。
- `trap` 的**表达式**位置：A-34 只开两个位置，其余留白（v2）。
