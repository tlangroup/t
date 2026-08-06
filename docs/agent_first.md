# 智能体第一 — 设计纲要(草案)

> **状态:核心设定已确认(Style B 语法 + 分类命名 + Core/Edge 模型);EBNF 待 L-15 法律化** ｜ 日期:2026-08-03 ｜ 关联宪法修正案:「智能体第一」增补为目标支柱(待第23条四层评审确认)  
> 本文件为「智能体第一」的设计素描,**非法律、不具约束力**。后续须经语法规则子层(L-15 流程)起草 EBNF、验证、并入 `docs/reference.md` 方为权威。  
> **2026-08-04 收敛决策（选项 A 拍板）**:经评审,`agent` 在语言层**无能力净增**(脱糖产物 struct/fn/构造器均已是一等公民),故**保留为极简意图标记,绝不再扩语法**(`use`/`goal`/`plan`/Spawner/消息路由均不进编译器);10 格分类矩阵降级为**模式目录(非语法)**;「数据流可复现」工具移**库层**(见 §8)。

---

## 0. 已裁定决策（2026-08-03）

- **用户选择 B：actor 底层 + LLM 上层**。Agent = 确定性 actor（纯数据状态 + 自由 `step(State, Msg) -> State` + 消息穷尽匹配），LLM 驱动能力建在 actor 基盘**之上**。
- **对本游戏（关键）**：LLM 驱动的 NPC / 角色是**真需求**，不是语言通用冗余。故 LLM 层必须预留，但纯运行时边界，不进编译器。
- **边界效应模型（核心架构）**：`step` 永不直接调 LLM / 工具——只更新状态并记「意图」字段（如 `pending: atom`）；真正的 LLM / 工具调用发生在**运行时边界**，结果以消息（如 `:llm_reply` / `:tool_result`）回填给 `step`。核心决策逻辑保持纯函数、确定性、可回放；非确定性只活在边界。
- **对编译器 scope 的结论**：实现「智能体第一」只需在编译器落地 **actor 声明**（脱糖为 纯数据 struct + 自由 `step` fn + 可选 `spawn` 构造器），**无需任何 LLM / 异步 / IO 编译器特性**。LLM 调用是上层运行时 / 库关注点。
- **struct 无方法（用户重申铁律）**：agent 的 `state` 是纯数据 struct，`step` / `tools` 是顶层自由 fn，绝不把函数挂进 struct。此举恰与 ECS 数据导向契合（方法暗示对象；自由 fn + 纯数据才是批量处理本色）。
- **最小实装路径（无运行时改动）**：`agent` 关键字 + `AgentDecl` 节点 + `parse_agent_decl` + 脱糖 pass（struct + fn + spawn 构造器），配 `examples/agent_monster.tc`（野怪确定性 AI）+ `examples/agent_refund.tc`（演示 LLM 边界模式）；跑 gate L0 不红。
- 开放问题（持久化走 fid v2、多 Agent 确定性、工具语义）部分由边界模型缓解：工具 / LLM 调用即「消息回填」，`step` 仍是纯函数。



## 1. 定位与边界

- 与既有「AI Agent 友好」(语言**可被** Agent 消费:JSON 诊断、AST 导出、编译期自省)正交。「智能体第一」指 **Agent 作为语言一等公民被编写**——写 Agent 是原生语言构造,而非外部脚本调用 t 编译器。
- 不新增隐式堆 / GC / 运行时类型歧义。Agent 的全部状态与行为由**既有静态类型系统**表达(呼应第1/3/8条)。

## &#x20;2. 一等公民定义

Agent 由四个静态可描述部分构成:

| 部分         | 形态                            | 说明                                           |
| ---------- | ----------------------------- | -------------------------------------------- |
| 身份         | `atom`(复用 M50 原子)             | 编译期 intern,全局唯一,可作消息路由键                      |
| 状态         | 纯数据 `struct`                  | 数据第一;显式字段、固定位宽;生命周期显式(第3/8/12条)              |
| 能力集(tools) | 一组类型化函数 `fn(Input) -> Result` | 声明即契约,调用的类型安全由编译器保证                          |
| 消息回路       | 类型化 inbox/outbox(消息即 struct)  | 驱动 `step(state, msg) -> (state, actions)` 推进 |

## 3. 与既有模型的关系

- **数据第一** — Agent 状态 = `struct`,消息 = `struct`,无隐藏状态;业务逻辑弱依附于数据定义。
- **ECS 第一** — Agent 可作 ECS 的 **System** 编排 World;Agent 自身状态也可作为 Component 挂到 Entity,使「数据 / ECS / 智能体」三者统一于同一套静态数据模型。
- **AI 稳定生成** — Agent 定义是确定语法(第2条唯一确定语义),无风格变体,模型可稳定产出。
- **静态类型** — 消息字段、工具入参/返回全程类型检查,无运行时类型歧义。
- **确定性(第7条)** — 同输入同行为;无隐式并发,并行须走第12条沙盒多核 / 极简协程。

## 4. 最小语法（已确认 · Style B 统一 fn）

- 声明（并置式 + `agent` 关键字）:
  ```
  Counter agent {
    state count: i64
    step fn(s: CounterState, msg: atom) -> CounterState {
      return match (msg) {
        :inc => CounterState { count: s.count + 1 }
        :dec => CounterState { count: s.count - 1 }
        _    => s
      };
    }
  }
  ```
- **Style B 裁定**：`step` 子句显式带 `fn` 关键字（与全语言一致——全语言只有一种函数写法，parser 零特例）。`state` 不带 `fn`（它是字段声明）。
- **struct 无函数（铁律）**：`CounterState` 脱糖为纯数据 struct，函数一律是顶层自由 `fn`，绝不挂进 struct（契合 ECS 数据导向）。
- 脱糖产物（仅编译器前端完成，后端零改动）:
  - `CounterState struct { count: i64 }`（纯数据）
  - `Counter_step fn(s: CounterState, msg: atom) -> CounterState { ... }`（自由函数，函数体逐字保留）
  - `Counter_spawn(init) -> CounterState`（合成构造器）
- 实例构造（显式，无隐式分配）: `var c: CounterState = Counter_spawn(0);`
- 消息驱动: 调用方手写循环 `c = Counter_step(c, :inc);`
- **最小实装不含运行时邮箱 / 调度**（`send`/`recv`/`spawn` 的邮箱语义 deferred）；只为演示「agent 一等公民」。

> 最终 EBNF 待语法规则子层（L-15）起草、验证后并入 `reference.md`。

## 5. 约束清单(不得突破)

- 不得引入隐式 GC(第8/12条)。Agent 状态须落在显式存储(栈 / 显式 Arena / 全局定长缓冲)。
- 消息派发必须静态类型化(第1/2条)。
- 唯一确定语义:Agent 只有一种标准写法(第2条)。
- 资源显式绑定(第12条);生命周期可静态追溯(第3条)。
- 危险操作(如跨 Agent 共享可变状态)须显式标注且可静态审查(第8条)。

## 6. Agent 分类与命名（已确认）

全部共用**同一个 `agent` 声明原语**；差别只在（a）Core 里放什么（reflex / plan / goal）、（b）Edge 接什么（none / Env·感知 / tool / LLM / human）。**Edge 轴含 Env·感知（2026-08-04 补列）**：对称于 Tool·IO 的「向世界写」，Env·感知是「在边界读世界」，导出 Sensor / Scout 体。

> ⚠ **矩阵是「模式目录」，不是语法**。这 10 格（＋Spawner 元类）是给人看的分类清单，用于统一术语与讨论；`t` 编译器**不**内置这 10 种 agent 类型。所有 flavor 只是「同一 `step` 契约 + 同一边界模型」下**边界驱动方式不同**（读世界 / 调工具 / 调 LLM / 读人类 / 规划后喂 `step`）。First-class agent ≠ built-in-flavors。详见 §8 收敛决策。

**命名对称规则**:Reflex 行称「X 体」(State/Sensor/Tool/Mind/Player)，Planning 行除保留「规划体」外，其余取对称专名（侦察体/操作体/策略体/副官体），英文后缀 -er / -ist / -ant。

**2 轴分类矩阵（最终定名 · 2026-08-04）**:
| | none | Env·感知 | Tool/IO | LLM | Human |
|---|---|---|---|---|---|
| **Reflex（状态机）** | State Agent（状态体） | Sensor Agent（感知体） | Tool Agent（工具体） | Mind Agent（心智体） | Player Agent（玩家体） |
| **Planning（目标/规划）** | Plan Agent（规划体） | Scout Agent（侦察体） | Operator Agent（操作体） | Strategist Agent（策略体） | Adjutant Agent（副官体） |

**已命名实例（Reflex 行）**:
- **State Agent（状态体 / 确定性 Agent）** —— 纯 Core，确定性状态机。例：野怪 Monster（血量 / 仇恨 / 巡逻，消息驱动转移）。✅ 已示例（`examples/agent_npc.tc`）。
- **Sensor Agent（感知体）** —— Core×Env·感知，纯读世界/环境、产出感知状态或感知消息（雷达、邻近检测、视觉传感器），喂给其他 agent。与 Mind 的内/外智能正交（一个 Sensor 也可再接 LLM 做感知推理 = Mind×Env，待补）。✅ 已示例：`Radar`（`examples/agent_edge.tc`，`:scan` 记意图、边界读世界写回 `contacts`）。
- **Tool Agent（工具体）** —— Core 任意 + Edge=外部工具/IO（数据库、支付、匹配、HTTP）。把「Edge 效应」从「只有 LLM」泛化为一等概念。零新语法，纯模式。✅ 已示例：`DbAgent`（`examples/agent_edge.tc`，`:query` 记意图、边界调 `fake_db` 写回 `last_result`）。
- **Mind Agent（心智体 / 认知 Agent）** —— Core + Edge(LLM)。例：LLM 驱动 NPC（自由对话、即兴剧情）。✅ 已示例（`examples/agent_npc.tc` 的 `Receptionist`）。
- **Player Agent（玩家体 / 化身体）** —— 任意 Core + Edge=人类输入（纯 Reflex，人类直驱）。玩家角色也是 agent，与 NPC 在模型上统一。✅ 已示例：`Hero`（`examples/agent_edge.tc`，人类 input 事件直接作消息喂 `step`）。

**Planning 行（表达法见 §11.5：不靠 `goal`/`plan` 语法，改用纯 `planner(State) -> Msg` 自由 fn 喂同一 `step`；✅ 已示例 `examples/planner_demo.tc`）**:
- **Plan Agent（规划体）** —— Core=规划/目标栈（GOAP / utility AI），Edge=none。填补 reflex 与 LLM 之间的 deliberative 空白；将来作 `goal`/`plan` 子句预留。
- **Scout Agent（侦察体）** —— Core=规划 + Edge=Env·感知；先侦察/探索再决策（规划式感知），区别于 Sensor 的反应式感知。
- **Operator Agent（操作体）** —— Core=规划 + Edge=Tool/IO；按计划调用外部工具执行。
- **Strategist Agent（策略体）** —— Core=规划 + Edge=LLM；LLM 做策略/规划推理。
- **Adjutant Agent（副官体）** —— Core=规划 + Edge=Human；人类为指挥官、agent 为副官负责规划协调（区别于 Player 玩家体 = 纯 Reflex 人类直驱）。

> ⚠ **Planning 体「待 goal」为决策 A 前的旧表述**：2026-08-04 决策 A 第 2/5 条已拍板**永不新增 `goal`/`plan` 语法**，故 Planning 不靠新子句表达，而是用纯 `planner(State) -> Msg` 自由 fn 算出「下一步消息」喂同一纯 `step`（见 §11.5）。**现已可写可运行示例**：`examples/planner_demo.tc`（Operator / Scout / Strategist / Adjutant 四 planner 自由 fn，共用同一 `robot_step` 原语，差异只在边界驱动）。

**元类**:
- **Spawner / Colony Agent（调度体，元类）✅ 库层已落地（examples/lib/colony.tc）** —— 管理/生成子 agent（导演 AI、小队队长、刷怪波次）。按决策 A **不进编译器语法**：复用 actor 脱糖产物 + slice + 函数指针，以纯数据调度体实现 `spawn` / `colony_send`（按 id 寻址）/ `colony_tick`（每帧驱动每个存活 agent）/ 扁平 inbox（延迟邮箱）；状态 string 指纹 + `fn(string, Msg)->string` 回调泛型无关。演示 `examples/colony_demo.tc`（Worker 小队 + Counter 跨类型复用同一调度体）与 `examples/colony_wave.tc`（塔防刷怪波次 + ECS World 主循环：Spawner 按波次 `colony_spawn`、World 主循环每帧 `colony_broadcast(:tick)`+`colony_tick` 驱动决策，再经 `physics.movement_system` 积分位置、玩家炮塔 `CombatSystem` 清怪）。

**优先级（语言侧成本）**: Tool / Player / Sensor Agent = 0（纯模式，现有语法可写，**已示例**）；Scout / Operator / Strategist / Adjutant / Plan Agent = 用纯 `planner(State)->Msg` 自由 fn 表达（**已可写，见 `examples/planner_demo.tc`**，不引 `goal`/`plan` 语法，决策 A 第5条）；Spawner = ✅ 库层已落地（examples/lib/colony.tc，纯数据调度体，无新语法，见 §12）。

## 7. 开放问题(待法律化时裁决)

- **持久化 / 序列化** — 能否复用 fid v1 序列化?当前聚合类型(struct / slice / map)尚不可序列化(M51 技术债),需 v2 走 `type_info`。
- **多 Agent 协作的确定性** — 顺序无关并行(第12条)如何映射到消息顺序与全局状态收敛。
- **工具调用语义** — 失败 / 重试 / 超时如何与 `Result` 类型及 `defer` 生命周期交互。
- **身份与发现** — `atom` 作路由键时,跨进程 / 分布式 Agent 的寻址边界(超出单进程运行时范畴,可能需运行时扩展)。

---

## 8. 收敛决策：agent 降为极简意图标记（2026-08-04 · 选项 A 拍板）

多轮评审后的结论。**「引入 Agent 的初衷」极小**（2026-08-03 裁定 B：为游戏 LLM 驱动 NPC 真需求，只做确定性 actor 糖衣），而 later 被一层层加出来的 10 格 taxonomy、`use` 接线、`goal`/`plan`、Spawner 运行时都是膨胀源。把账算清后：

- **语言层能力净增 = 0**：`agent` 脱糖产物 = `struct`（状态）+ 自由 `fn`（step）+ 构造器；三者 `t` 均已是一等公民。连合成的 `spawn` 构造器也可用 `XState{ ... }` **struct 字面量**完全替代。故 `agent` 在**能力**上不提供任何 struct/fn 之外的东西。
- **保留 `agent` 的唯一理由**：作为「这是一个 Agent」的**意图标记**（intent marker），是宪法支柱「智能体第一」的可见锚点（写 Agent 是原生语言构造，而非外部脚本调用编译器）。它几乎零成本，且防止有人把 impurity 悄悄写进 `step`。

**拍板：选项 A —— 保留 `agent` 为极简意图标记，绝不再扩语法。**

1. ✅ **保留唯一写法** `X agent { state...; step... }`，脱糖行为不变。
2. ❌ **永不新增**第二套语法：`use` 接线式、`goal`/`plan` 子句、`Spawner`/`Colony` 原语、消息路由 / 多 system 编排。任何「flavor 差异」靠**边界驱动模式**（§6 矩阵）+ **自由 fn**表达，不进编译器。
3. ❌ **10 格分类矩阵降级为「模式目录」**（见 §6 蓝框）：写文档、不进编译器；不意味语言内置 10 种 agent 类型。
4. 📦 **可复现工具移库**：支撑「数据流可复现」的工程价值——消息日志（record）、回放定位（replay）、确定性 diff——放进**库**（如 `agentkit` helper），**不进语言层**。
5. **规划体若将来要做**：以**纯** `planner(State) -> Msg` 自由 fn 表达（算出的下一步消息喂同一纯 `step`），**不引入** `goal`/`plan` 语法；不变量不变（step 纯、消息唯独、效应在边界）。

> 一句话：`agent` 在语言层的必要度已从「需要一套原语」退到「需要一个意图标记」；它不再是能力，而是符号。

---

## 9. 数据流可复现：设计约束（Agent 该怎么做）

「数据流可复现」（哪条消息让状态偏离预期，可逐帧回放、精确定位）是引入 Agent 时的核心卖点，也是 `agent_demo` / `agent_npc` / `agent_edge` 示例「特别容易按数据流定位问题」的根因。它**不是某个调试功能给的，而是 `Agent = 纯函数状态机` 这个设计天然带出的不变量**。要守住它，须满足 5 条设计约束：

1. **`step` 必须是纯函数** —— `step(State, Msg) -> State`，内部零 IO、零全局可变、零时钟、零随机。判据一句话：同一条 `(State, Msg)` 永远得同一 `State`。
2. **消息是唯独输入通道** —— 所有「成因」走消息进来；`step` 内部不得偷偷读世界 / 读别的 agent / 读外部状态，否则成因不在消息日志里、无法重放。
3. **状态是 Plain Data（无方法 struct）** —— 每帧状态可被快照、序列化、逐字段 diff，这是定位「哪一帧开始偏离」的物质基础。
4. **效应隔离到 `drive()` 边界** —— LLM / 工具 / IO / 人类输入**只**在边界发生，结果以消息回填 `step`。关键防火墙：出问题时立刻二分——是 `step` 纯逻辑 bug（确定性、从消息日志可复现），还是边界 / IO bug（允许非确定性的那部分）。
5. **消息日志是一等调试凭证** —— 「记录消息流」应廉价、默认，而非事后打补丁；它是重建整条因果链的最小输入。

**什么会破坏该目标（须拒绝）**：`step` 直连 LLM / IO / 时钟（复现断链）；`step` 读写隐藏全局 / 共享世界状态（成因不可重放）；`step` 内 spawn 副作用改外部实体（效应不可追踪）；给 State 挂方法（OOP，状态快照难）。

**结论**：Agent 原语的真正价值，是用语法把 `(struct + 纯 fn + spawn)` 这一形状**焊死**，让任何写出的 agent 自动满足「`init + 有序消息 ⇒ 可复现`」。这恰由当前**最小** `X agent { state; step }` 糖衣满足——它脱糖出的 struct + 自由 fn 天然契合上述 5 条。这也是 §8 选项 A 的底层依据：不扩语法、守住这个不变量即可。

---

## 10. 库层边界协议（agentkit 与运行时接缝）

§8 决策 A 第 4 条把「数据流可复现」的工程工具（消息日志 / 回放 / diff）移入**库层**（如 `agentkit`）；§0/§4 亦明确 LLM / 工具 / 感知 / IO 这些 Edge 适配器只活在**运行时边界**。本节规定这套接缝的**协议与库职责**——全部可用现有 `t` 表达（消息即 struct、自由 fn），**不引入任何编译器特性**，与决策 A「绝不再扩语法」一致。

### 10.1 统一握手：`pending` 意图 + 回填消息
所有 Edge 体共用同一条握手（已在 `examples/agent_npc.tc`、`examples/agent_edge.tc` 实测双后端通过）：
1. **记意图**：`step` 收到某消息（如 `:ask` / `:scan` / `:query`）后只更新状态，把 `state.pending` 置为对应 atom（`:llm` / `:sense` / `:tool`）。`step` 本身不触外部世界（§9 守恒①）。
2. **边界分发**：运行时 `drive_*(state, input)` 先调 `step(state, :ask)` 之类记意图，再检测 `state.pending`；若非空，则对接对应 effector（LLM → `llm_boundary.drive_llm` + `tools/llm_bridge.py` 旁路桥 / `sense_world` / `fake_db` / 人类输入源）拿到结果。
3. **回填**：边界把结果写回状态字段（如 `contacts` / `last_result` / `mood`），并构造 `:sense_done` / `:tool_done` / `:llm_reply` 消息再喂一次 `step` 清空 `pending`（`:none`）。
> 这一来一回（`记意图 → 边界 → 回填`）即 Core/Edge 解耦的全部机制。`step` 始终是纯函数，非确定性只活在 `drive_*` 里「则调用 effector」那一小段（§0、§9）。

### 10.2 五个 Edge 的边界适配器职责
| Edge | 对接谁 | 边界 fn（示例名） | 非确定性来源 |
|---|---|---|---|
| Tool·IO | DB / 支付 / HTTP / 游戏状态 API | `drive_db` → `fake_db` | 工具副作用 |
| LLM | 大模型 | `llm_boundary.drive_llm`（进程外 `tools/llm_bridge.py` 打真实 LLM） | 模型随机性 |
| Human | 人类输入设备 | `drive_hero` ← 人类事件 | 人类意志 |
| Sensor·Env | 读世界 / 邻近实体 | `drive_radar` → `sense_world` | 世界状态 |
| Network·OtherAgents（候选） | 跨进程消息 | 见 §7 身份与发现 | 传输层 |
> `examples/agent_edge.tc` 已演示 Tool / Sensor / Human 三体同构（内核 `step` 完全相同，差异只在 `drive_*` 接谁）；`agent_npc.tc` 演示 LLM 体。`Network` 仍候选（受 §7 开放问题约束）。

### 10.3 `agentkit` 库职责（§8.4 落地，⏳ 待建 `agentkit.tc`）
- **`record`**：廉价、默认地记录整条消息流 `(InitState, [Msg...])`——重建因果链的最小输入（§9 守恒⑤）。
- **`replay`**：给定记录重新喂消息、断言每帧 `State`——`step` 纯函数保证同输入同行为，可逐帧定位「哪一帧开始偏离」（§9 守恒①②③）。
- **`diff`**：两帧 `State` 逐字段比对，输出偏离字段。
- **时钟注入**：若游戏需 `:tick`，由 `agentkit` 单调时钟产生，而非 `step` 内部读墙钟（守 §9 守恒①「零时钟」）。
> 以上皆纯 `t` 可实现（消息即 struct、状态可快照），属「库」不属「语言」。`examples/agent_edge.tc` 已用手写 `replay radar` 演示 replay 的可复现性（见其 `.expected.txt` 第 18 行 `replay radar -> contacts=7`）。

### 10.4 边界确定性纪律
- 边界是**唯一允许非确定性**之处；测试时把 `fake_llm` / `sense_world` 换成**确定性桩**即让整条回路可复现（示例正是这么做的）。
- 出问题时二分：**是 `step` 纯逻辑 bug（从消息日志可复现），还是边界 / IO bug（允许非确定性的那部分）**——这是 §9 守恒④防火墙的日常用法。

---

## 11. ECS 集成与非容器原则

用户质问：「agent 成为一等公民后 System 全挂 agent 里 → 臃肿」「每个 agent 要挂移动 / 碰撞 / 旋转怎么办」。答：agent 在 ECS 里只扮演**两个独立且可选**的角色，它**既不是系统的父容器、也不是命名空间**。

### 11.1 agent 的两重 ECS 角色（非容器）
- **角色 A（数据）**：`XState` 是一个 **Component**，与 `Position` / `Velocity` 平级地挂到 Entity。
- **角色 B（逻辑）**：`x_step` 是**众多 System 中的一个**，与 `MovementSystem` / `CollisionSystem` 平起平坐。
> 一个 NPC 不会因「是一等公民」就吞下移动 / 对话 / 战斗 / 感知 / 渲染——那种「上帝 Agent」是反模式，t 的规则从根上禁止（见护栏）。

### 11.2 多能力分解：移动 / 碰撞 / 旋转 = 配对 Component+System
「NPC 需要移动 + 碰撞 + 旋转」**不等于** agent 体内挂三个方法，而是：
- **数据 → Component**：`Position` / `Velocity` / `Rotation` / `BoundingBox`（并行的纯数据）；
- **逻辑 → System**：`MovementSystem` / `CollisionSystem` / `RotationSystem`（并排的自由 fn）；
- **agent 只贡献**：`NpcState`（一个 Component）+ `npc_step`（一个决策 System，只算**意图**如 `intent_dir`，不执行动作）。
Scene/Spawn 把 `NpcState` 与物理 Component **组合**到同一 Entity；每帧循环 `npc_step` 先跑算意图，物理 System 读意图去算。能力越多，只是多挂几个 Component / 多跑几个 System——**agent 声明一行不增**。

### 11.3 三道护栏（已在语言 / 架构铺好，堵死臃肿）
1. **struct 无方法（铁律）**：物理逻辑没语法资格进 `NpcState`（§0、§4）。
2. **逻辑在 System 不在 step**：`step` 只做三件事——`match(msg)` → 改两三个字段 → 设 `pending`/`intent`，永远只产出意图。
3. **模型库外置**：移动 / 碰撞 / 旋转属 `physics.tc` 这类**模块**（`import` 进来），不进 `tc.tc`、不进 agent（见 §12）。

### 11.4 语言职责边界（5 层）
t 为 Agent First 能做的，与刻意不做的，同样重要。语言层只管这 5 层，Edge 在库：
1. **语法层** — `agent` 是一等公民声明（脱糖为 struct + fn + spawn）。
2. **类型与安全层** — 消息 / 工具签名静态类型检查，缝不静默崩。
3. **语义层** — 确定性 actor（`step` 纯、状态不可变传递），可单测 / 回放。
4. **自省层** — `type_info` 描述类型，支撑 fid 序列化与自动生成工具 / 消息 schema。
5. **边界契约层** — `pending → reply` 握手是纯 `t` 可表达的协议，非语言特性。
> **最关键**：以上 5 层是 t 该做的；虚线之下（Sensor / Tool / LLM / Human / Network 适配器）是**运行时 / 模型库**的事，不进编译器 intrinsics。一句话：**语言负责确定性，库负责可能性。**

### 11.5 规划体（Planning）的无语法表达
§6 说 Planning 行「待 goal」——那是决策 A 前的旧表述。§8 决策 A 第 2/5 条已拍板**永不引入 `goal`/`plan` 语法**，改用纯 `planner(State) -> Msg` 自由 fn。即：规划 Core = 一个算出「下一步消息」的自由 fn，把结果喂同一纯 `step`。不变量不变（step 纯、效应在边界）。这把「最聪明的决策」也压回库层模式，而非新语法。**已落地可运行示例**：`examples/planner_demo.tc` —— `Robot agent` 只有一个纯反射 `step`；Operator/Scout/Strategist/Adjutant 是四个 `fn(RobotState)->atom` 自由 fn（各自不同「边界驱动」：纯执行 / 先侦察 / 能量告急先充电 / 开工前请示人类）；`run_with_planner(p, init, steps)` 是通用循环 `s = robot_step(s, p(s))`，`p` 是唯一变量。

---

## 12. 模块与模型库分层（功能外置）

用户原话：「主程序仅提供词法 / 语法 / 语义；具体功能实现由接入的模型库决定。」这与决策 A、§3.13 模块系统一致——`agent` 引入**零运行时特性**，所有「能力」都可外置为 `import` 的模型库。

### 12.1 分层
- **主程序（编译器 `tc.tc`）**：仅词法 / 语法 / 语义——含 `agent` 脱糖、模块 `import/export`、既有类型系统。不内置任何领域功能。
- **模型库（模块）**：`import` 进来的聚焦单元，每个一个领域。例：
  - `physics.tc` — 运动 / 碰撞 / 旋转 Component+System（§11.2）。
  - `agentkit` — §10 的 record / replay / diff 与时钟注入（⏳ 待建）。
  - `llm_boundary` — 真实 LLM 调用的 `drive_*` 适配器（**已落地**，2026-08-05）：`examples/lib/llm_boundary.tc` 导出 `drive_llm(prompt) -> string`，走 stdin/stdout 旁路桥协议（`LLMREQ|...` 出 / `__EOM__` 哨兵回）；进程外的 `tools/llm_bridge.py` 接到真实 LLM（Ollama / OpenAI 兼容，不可达回退确定性应答）。运行：`out/dbg/tc.exe build examples/agent_npc_mind_llm.tc --mode dbg --output out/dbg/npc_llm` 后 `python tools/llm_bridge.py out/dbg/npc_llm.exe`。
  - `time` / `ser`（fid）— 已在 M54–M57 / M51 实现的具体功能，亦属可外置模型库。
> 这些库**不进 `tc.tc`**；主程序因此保持精简，与用户诉求一致。

### 12.2 组合方式（agent 声明只「引用」，不「包含」）
```t
import physics;          // 运动/碰撞是外置模型库（§3.13 内联机制已落地）
Guard agent {
  state pos: Position            // Position 来自 physics 模块（Component）
  state pending: atom
  state intent_dir: Velocity     // 决策意图，MovementSystem 读
  step fn(s: GuardState, msg: atom) -> GuardState {
    if (msg == :tick) { return GuardState { pos: s.pos, pending: :llm, intent_dir: steer_patrol(s.pos) }; }
    else if (msg == :llm_reply) { return GuardState { pos: s.pos, pending: :none, intent_dir: s.intent_dir }; }
    return s;
  }
}
// 世界循环：decision Core 写意图 → physics.MovementSystem 读意图算位置 → llm_boundary.drive 填对话
```
- `Position` / `Velocity` / `steer_patrol` / `MovementSystem` 全部来自 `physics`（§3.13 模块内联机制已落地，`module_hello` 双后端通过）。
- `step` 只引用库符号、写意图，**智能在库不在 agent**。

### 12.3 与 §3.13 衔接
- agent 脱糖产物 `XState` / `x_spawn` / `x_step` 标 `export` 后可跨模块复用（消息回路边界），见 §3.13 末段。
- 模型库须 `export` 其 Component / System / 边界 fn，agent 声明 `import` 后按命名空间引用。
