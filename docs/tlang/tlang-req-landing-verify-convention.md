# tlang 需求—落地—验证 规范（Requirement · Landing · Verification Convention）

> **归属说明（重要）**
> - **本规范文档（规则书）存放于 tlang 核心仓库 t 的 `docs/tlang/`**，是 tlang 定义「第三方扩展如何提交需求与验证代码」的权威约定。
> - 但本规范所约束的**第三方需求文档**（`rXXXX_*.md` / `rXXXX_*.landing.md`）与**对应验证代码**（`examples/tlang/`、`tests/tlang/` 下的产物）**保留在第三方自己的工程目录**（其扩展项目根），**不进入 t 仓库**。
> - 文中 `docs/tlang/`、`examples/tlang/`、`tests/tlang/` 对第三方而言**相对其自身工程根**；`tools/`（验证工具）由 tlang 核心在 t 的 `tools/` 提供，第三方通过 `--specs <自身目录>` 指向自己的需求与代码来运行。
> - 本文件只定义契约与布局，不绑定任何内部仓库（如 thyme）。

---

## 0. 总则与原则

- **规范高于技术。** 工具服务于规范，而非相反。任何工具缺失时，规范文本仍是唯一权威。
- 三条铁律：
  1. **需求稳定** —— 需求文档一次性写入、不可变；不随实现强弱改写。
  2. **落地可变** —— 是否实现、如何实现，只记在落地文档与验证产物里。
  3. **验证可机器核对、第三方可携带** —— 每条需求必须至少有一处可被 `tlang-verify` 自动跑通的验证产物；契约不依赖任何单一仓库的内部结构。

---

## 0.1 文件归属总览（t 编译期编辑者 × 多第三方扩展者，双视角）

本规范同时服务两类参与者：**t 编译期编辑者**（t 核心仓库）与**多个第三方扩展者**（extA / extB / …）。二者遵循**同一套骨架**，但全局公共物只由 t 核心持有。

### 0.1.1 两种身份
- **身份 A — t 编译期编辑者（t 核心仓库）**：拥有编译器本体与语言语义，并额外承担两件事：
  1. **元层公共物**：规则书（本文件）与共享验证工具（`tools/tlang-verify.mjs` / `tlang-spec-lint.mjs`）。
  2. **第一等 spec 作者**：t 自身的语言特性需求（如 R-000..010）也按本规范组织需求 / 落地 / 探针——即 t 自己也是"参与者之一"，用同一骨架。
- **身份 B — 第三方扩展者（extA / extB / …）**：拥有自己的扩展需求、落地追踪、验证代码；复用 t 的规则书与工具，但**代码永不进 t**，验证时通过 `--specs <自身目录>` + `--compiler <自身 tc.exe>` 指向自己。

### 0.1.2 主归属表（什么文件放哪）
| 文件 / 目录 | 归属 | 说明 |
|---|---|---|
| `t/docs/tlang/tlang-req-landing-verify-convention.md` | t 核心 | 规则书，全局唯一权威约定 |
| `t/tools/tlang-verify.mjs` / `tlang-spec-lint.mjs` | t 核心 | 共享验证工具，全局公共物 |
| `t/src/` `t/lib/` `t/tools/gate.mjs` `t/out/` | t 核心 | 编译器本体与构建产物 |
| `t/tests/{conformance,err_samples,hir_eval,ir_baseline.json,m1,m2,…}` | t 核心 | t **既有回归套件**，独立于 rXXXX 规范，原地保留 |
| `t/examples/*`（既有，如 `adt_list.tc`） | t 核心 | t 既有示例，独立于 rXXXX |
| `t/docs/tlang/rXXXX_*.md` + `.landing.md` | t 核心 | t **自身语言特性**需求按骨架持有 |
| `t/examples/tlang/` `t/tests/tlang/` | t 核心 | t 自身 rXXXX 的验证产物 |
| `t/docs/tlang/_registry.json` `t/docs/tlang/_spec_version.json` | t 核心 | t 自身 spec 注册表 + 版本基线 |
| `extA/docs/tlang/rXXXX_*.md` + `.landing.md` | extA | 第三方自身需求 |
| `extA/examples/tlang/` `extA/tests/tlang/` | extA | 第三方验证产物 |
| `extA/docs/tlang/_registry.json` `extA/docs/tlang/_spec_version.json` | extA | 第三方注册表 + 基线 |
| `extA/docs/tlang/tlang-req-landing-verify-convention.md`（可选 vendored 副本） | extA | 可锁定一份规则书快照，防规则漂移 |

### 0.1.3 三条不变量
1. **全局公共物只此两件**：规则书 + 验证工具，二者必须在 t。其余（需求、落地、探针、注册表、版本基线）一律**按提出方各存各仓**。
2. **t 既有测试不被取代**：本规范的 `examples/tlang/` `tests/tlang/` 是**叠加层**，与 t 既有 `tests/conformance` `examples/*` 并行共存，不迁移、不重写。
3. **验证天然跨仓**：第三方探针跑在 t 的 `tc.exe` 上（`--compiler`），版本以 `_spec_version.json` 的 `compiler_commit` pin；t 升级后第三方需重跑 `tlang-verify` 复验。
4. **单向写、单向拉（pull 模型）**：第三方**只写自己的文件夹**，**永不修改 t 的任何文件**（含 t 的注册表、规则书、源码）——因为第三方对 t 语义的理解可能出错，反向写入会把错误污染核心。t 是否将某条第三方 spec 纳入自身文件夹，是 t **自主的读取—复制—落地**动作，第三方不推送、不要求。

### 0.1.4 现状 → 目标态（thyme 作为首个第三方扩展者）
当前 thyme（非 git 仓库）实际持有 `docs/tlang/000..010` 需求与 17 个 `*_probe.*` 探针。按 §0.1.3 的 pull 模型，目标态如下：

- **thyme 留在自己的文件夹**：thyme 即第三方扩展者，其需求文档、落地、探针、注册表、版本基线一律存于 thyme 自身工程目录；**thyme 不修改 t 的任何文件**——因为它对 t 语义的理解可能出错，写入 t 会把错误反向污染核心（这正是要杜绝的路径）。
- **是否纳入 t 由 t 自主决定（pull）**：t 读取 thyme 的 spec 后，自主判断是否采纳进 `t/docs/tlang/` + `t/examples/tlang/` + `t/tests/tlang/`。这一"读取—复制—落地"动作完全由 t 发起与执行，thyme 不推送、不要求、不等待。
- **规则书与工具始终只在 t**：thyme 通过 vendoring 一份规则书快照（§0.1.2 末行）或远程引用遵从，不持有可写副本。
> 一句话：**第三方单向写自己、t 单向（可）拉取；不存在"第三方写 t"的任何路径。** thyme 当前的 000..010 无需迁移，其去留完全取决于 t 日后是否主动采纳。

---

## 1. 文档规范（细化你的草稿）

### 1.1 需求文档 `docs/tlang/rXXXX_<slug>.md`
> 注：本文件相对**提出方工程根**。第三方需求位于其自身工程目录；t 核心自身的语言特性需求则位于 t 仓库内同名骨架（仍不进入除 t 以外的任何仓库）。

- **内容模板**（建议小节，缺一视为不合格）：
  - `## 背景 / 动机`：为什么需要这个功能。
  - `## 功能描述`：要做什么，范围边界。
  - `## 验收准则`：**逐条可机器核对**的清单（见 §4.3），每条对应一个验证产物断言。
  - `## 边界与反例`：不该支持什么、易错点。
  - `## 与其他 r 的关系`：依赖 / 互斥 / 取代。
- **不可变**：写入后只增不改。若需求本身需要演进，走 §4.6 的 supersede 流程，开新 id，旧 id 标 `deprecated`。

### 1.2 落地文档 `docs/tlang/rXXXX_<slug>.landing.md`
> 同样位于第三方自己的工程目录。

- 与需求文档**同名不同后缀**（`<id>_<slug>.landing.md`）。
- **内容模板**：
  - `## 状态`：受控枚举（见 §4.2）。
  - `## 落地 commit`：实现该需求的 tlang 提交哈希（可多个）。
  - `## 验证产物`：引用的 `examples/tlang/...` 或 `tests/tlang/...` 路径。
  - `## 验收结果`：逐条回填 §1.1 的验收准则，标注每条是否满足 + 证据（产物路径 + 输出哈希 + commit）。
  - `## 已知缺口`：未满足的验收项及原因。
  - `## 变更日志`：落地过程中的关键决策。
- **可变**：唯一允许随实现进度改动的文档。

### 1.3 铁规：不满足时只改落地，不改需求
> 需求未被满足 **禁止重写需求文档**。只能：
> (a) 更新对应 `*.landing.md` 的状态 / 已知缺口；
> (b) 修改对应的 example / test 代码，直到验证产物通过。
>
> 理由：需求是契约，落地是事实。把"实现没做到"写回需求文档，会导致**需求漂移**——这正是 R-024↔R-038 混乱的根因之一。

---

## 2. 代码 / 验证产物规范（细化你的草稿）

> 此节所有路径均位于**第三方自己的工程目录**，不进入 t 仓库。每条需求 `rXXXX` **至少**有一处验证产物；落地文档必须引用它。两种风格二选一或并存：

### 2.1 示例式（运行期行为核对）
- `examples/tlang/rXXXX_<slug>.tc` —— 可运行的 t 程序。
- `examples/tlang/rXXXX_<slug>.expected.txt` —— 其标准输出（stdout）的权威快照。
- 验证器：编译运行 `.tc`，逐字节比对 stdout 与 `.expected.txt`。
- ⚠️ 文件名后缀为 **`.expected.txt`**（修正原草稿的 `expecte` 笔误）。

### 2.2 测试式（编译期 / 类型期行为核对）
- `tests/tlang/rXXXX_<slug>/pass.tc` —— **必须**编译并运行成功。
- `tests/tlang/rXXXX_<slug>/fail.tc` —— **必须**编译失败，且失败原因正确（见 §4.3）。
- 目录内二者互斥：一个需求子目录下要么是 `pass.tc`，要么是 `fail.tc`，不得同存。

### 2.3 `fail.tc` 必须声明期望诊断码
- 文件头用注释声明：`// expect-diag: T-SEM-E008`（可多行多码）。
- 验证器断言：编译器实际抛出的诊断码集合 ⊇ 声明集合，且不出现无关致命错误吞掉预期失败。
- 目的：防止"测试通过只是因为另一个不相关的编译崩溃"。

### 2.4 映射规则
- 文件名前缀强制为需求 id：`rXXXX_`（核心）或 `r<vendor>-<nnnn>_`（第三方，见 §4.1）。
- 落地文档引用的产物路径若存在拼写/缺失，`tlang-spec-lint` 直接报错。

---

## 3. 工具规范（补全你的第 3 项）

工具是规范的执行层，**由 tlang 核心在 t 仓库的 `tools/` 提供**，可脱离任何内部仓库独立运行（通过 `--specs` 指向第三方目录）。建议实现两个 Node 脚本 + 一个版本清单：

### 3.1 `tools/tlang-verify.mjs` —— 便携式一致性运行器
- 用法：
  ```
  tlang-verify.mjs --specs <第三方 docs/tlang 目录> [--compiler <tc.exe>] [<rXXXX>...]
  ```
- 行为：
  1. 扫描 `<dir>/*.landing.md`，解析每条需求的验证产物引用。
  2. 对指定（或全量）需求，用 `--compiler` 指向的 tlang 编译器跑对应 example / test（位于第三方目录）。
  3. 比对 stdout（example）或编译成败+诊断码（test）。
  4. 输出报告：`r0038 PASS — examples/tlang/r0038_nested-decl.tc 输出匹配 .expected.txt；commit eb638b3`。
  5. 任一产物缺失或失败 → 退出码非 0。
- **可移植性**：第三方工程指向自己的 `tc.exe` 与自身目录即可自验合规，无需把代码搬进 t。

### 3.2 `tools/tlang-spec-lint.mjs` —— 一致性检查器（防漂移）
- 检查项（针对第三方目录）：
  - 每个 `rXXXX_*.md` 需求文档都有同名 `.landing.md`。
  - 每个 `.landing.md` 至少引用一处**真实存在**的 example / test 文件。
  - 每个 `examples/tlang/rXXXX_*.tc` 都有 `.expected.txt` 同缀兄弟。
  - 每个 `tests/tlang/rXXXX_*/` 含且只含 `pass.tc` 或 `fail.tc`；`fail.tc` 含 `expect-diag`。
  - **无孤儿产物**：任何 example/test 的 `rXXXX` 必须在注册表（§4.1）有对应需求。
  - 注册表与磁盘文件一致（无缺漏、无多余）。
- 退出码非 0 = 规范被破坏，禁止合并 / 发布。

### 3.3 `_spec_version.json` + `--assert-spec-version` —— 基线 / 版本 pin
- 位于第三方目录的 `docs/tlang/_spec_version.json`：
  ```json
  { "tlang_version": "0.9", "compiler_commit": "<sha>",
    "spec_set_hash": "<sha256 of all spec+artifact files>", "updated": "2026-11-03" }
  ```
- `tlang-verify.mjs --assert-spec-version`：比对被测编译器版本 / commit 与目标，不符则失败并提示"先升级 `_spec_version.json`"。
- 这是 `ir_snapshot --assert-head` 在规范层的便携等价物，杜绝"用陈旧编译器跑新规范"的误报。

### 3.4 `tlang-verify.mjs attest <rXXXX>` —— 标准自证
- 自动跑该需求的验证产物，抓输出，把 `commit + 输出哈希` 写回落地文档的 `## 验收结果` 证据块。
- 把"自证已实现"标准化、可复跑，替代手动 grep 输出。

### 3.5 `--self` / `--assert-tc-fresh` —— 与自举规范（bootstrap.md §4.4）衔接

「哪个是最新版本的 tc.exe」在 t 自身作为 spec 持有方时必须有确定答案。`tools/tlang-verify.mjs` 与 `tools/tlang-spec-lint.mjs` 提供两个开关，把 `bootstrap.md §4.4` 的权威入口规则落到工具层：

- **`--self`**：仅当 `--specs` 位于 **t 核心仓库**（目录下存在 `tools/gate.mjs`）时可用。它做两件事：
  1. 默认 `--compiler` = `<t 仓库根>/out/dbg/tc.exe`——即 `bootstrap.md §4.4.1` 定义的**唯一权威稳定入口**，不再手选 `g1/g2/g3`；
  2. 默认启用 `--assert-tc-fresh`。
- **`--assert-tc-fresh`**：比对 `out/dbg/tc.exe` 与 `out/dbg/g4.exe` 的 md5，**不等即非零退出**——前置拦截"陈旧编译器"导致的误报（等价于 `ir_snapshot --assert-head`，但针对编译器自身入口）。修复见 `bootstrap.md §4.4.4`（`gate L2` 的 `boot4` 步会在不动点成立时自动 `cp g4.exe tc.exe`；或手动 `cp out/dbg/g4.exe out/dbg/tc.exe`）。

> **适用边界**：`--self` / `--assert-tc-fresh` 只服务于 **t 核心仓库自身**（需要 `g4` 不动点）。第三方扩展者**不**用 `--self`，而是显式传 `--compiler <自身 tc.exe>`；其"最新版本"由第三方自己的构建/自举产物定义，与本仓库 `tc.exe` 无关。
>
> **当前状态提示**：t 仓库 `docs/tlang/` 当前是「规则书 + 工具」载体，尚未把自身语言特性按 `rXXXX` 骨架组织，故 `tlang-spec-lint --self` 会报"缺少 `_registry.json`"——这是预期，待 t 自身采用 `rXXXX` 骨架（把 R-000..010 等迁入）后消除，不视为规范破坏。

---

## 4. 补充规范（你的第 4 项：我继续添加）

### 4.1 编号与注册规范
- **核心 id**：`rXXXX`（小写 r + 4 位零填充，如 `r0038`）。**单调递增、永不复用、不可变**。
- **注册表** `docs/tlang/_registry.json`（机器可读单一真相源，位于各自工程根）：
  ```json
  [ { "id":"r0038", "slug":"nested-decl", "title":"struct 内嵌套具名声明",
      "status":"landed", "spec_doc":"r0038_nested-decl.md",
      "landing_doc":"r0038_nested-decl.landing.md",
      "artifacts":["examples/tlang/r0038_nested-decl.tc"],
      "aliases":["R-024"], "deprecated":false } ]
  ```
- **第三方扩展命名空间**：核心保留 `rXXXX`；扩展工程用 `r<vendor>-<nnnn>`（如 `rseesaw-0001`），避免抢占核心编号。
- **别名保留**：重编号 / 澄清时，旧 id 写入 `aliases` 并标 `deprecated`，绝不静默消失（根治"R-024 其实是 R-038"的迷失）。

### 4.2 状态机规范（落地文档 `## 状态` 受控枚举）
| 状态 | 含义 | 进入条件 |
|---|---|---|
| `draft` | 已提出，未评审 | 新建需求文档 |
| `accepted` | 已评审，纳入规划 | 核心团队 / 扩展 owner 批准 |
| `in_progress` | 实现中 | 有进行中的落地 commit |
| `landed` | 已落地且验证产物全绿 | 所有验收准则满足 + `attest` 证据齐 |
| `partial` | 部分落地 | 验收准则未全满足，landing 标注缺口 |
| `blocked` | 被依赖 / 设计阻塞 | 注明阻塞源 |
| `dropped` | 放弃 | 保留 id + 原因，不再验证 |
| `deprecated` | 被新 id 取代 | 走 §4.6，保留别名 |

### 4.3 验收准则形式化
- 需求文档 `## 验收准则` 每条必须是**可判定**语句（"编译通过""输出为 X""报错码为 Y"），禁止"体验更好"这类不可核对描述。
- `fail.tc` 强制 `// expect-diag`（见 §2.3），保证"失败得对"。
- 落地文档 `## 验收结果` 与验收准则**逐条 1:1 对应**，未满足项进 `## 已知缺口`。

### 4.4 第三方扩展接入规范
- 第三方扩展工程在**自己的项目根**建立 `docs/tlang/`（放本工程的需求/落地文档 + 注册表 + 版本清单）、`examples/tlang/`、`tests/tlang/`，按本规范第 1–2 节组织。
- 验证工具 `tlang-verify.mjs` / `tlang-spec-lint.mjs` 由 tlang 核心（t 仓库 `tools/`）提供；第三方运行：
  ```
  tlang-verify.mjs --specs <自身项目根>/docs/tlang --compiler <自身 tc.exe>
  ```
  即可自验合规，**无需把代码搬进 t**。
- 将 `_spec_version.json` 的 `compiler_commit` 设为自身基线 tlang 版本。
- 核心需求复用 `rXXXX`；自有需求用 `r<vendor>-<nnnn>` 并在注册表注明 `extends: "rXXXX"`。
- t 核心自身的语言特性需求使用**完全一致**的骨架（仅位于 t 仓库内），不另立结构；本规范对"谁提出"对称适用。

### 4.5 CI / 门禁契约
- 每次合并 / 发布前，**必须**通过：
  1. `tlang-spec-lint.mjs --specs <自身 docs/tlang>`（结构一致性）
  2. `tlang-verify.mjs --specs <自身 docs/tlang> --compiler $TC`（功能核对全绿）
- 推荐叠加 `--assert-spec-version`，避免版本漂移。
- 任一门禁非 0 退出 = 禁止合入 / 发布。

### 4.6 需求演进制（supersede，而非就地改）
- 绝不为"迁就一个较弱的实现"而改写需求文档的验收准则。
- 需要变更需求时：开新 id（如 `r0039`），新落地文档注明 `supersedes: r0038`，旧 id 标 `deprecated` 并保留 `aliases`。
- 历史诚实：谁在什么时候因何放宽 / 收紧，留在落地文档变更日志，不在需求文档抹除。

---

## 5. 多第三方并发治理

当不止一个扩展工程同时向 tlang 提需求时：

- **命名空间隔离**：核心 `rXXXX`；第三方 `r<vendor>-<nnnn>`（如 `rseesaw-0001`）。各仓库 `id` 仅在本仓内唯一，跨仓不冲突。
- **语义去重 / 采纳（adoption，t 单向 pull）**：若 extA 与 extB 提出重叠需求，或某第三方提出本应属 t 核心语义的需求，由 **t 核心自主决定**是否采纳为一条核心 `rXXXX`：
  - 采纳时**由 t 自行复制**该需求的文档 / 探针进 `t/docs/tlang/` + `t/examples/tlang/`（或仅在 t 落地文档 `artifacts` 引用第三方原路径），并新建核心 `r00XX`，其 `aliases` 收录原第三方 id（如 `"aliases":["rseesaw-0001"]`），原 id 标 `deprecated` 注明 `adopted as r00XX`。
  - **第三方绝不写 t**：整个采纳过程是 t 在自己的仓库内操作，第三方仓库对 t 而言只读，第三方不修改 t 的任何文件（呼应 §0.1.3 不变量 4）。
- **真相归属**："`rXXXX` 是否落入 t 编译器"的权威记录是 **t 核心的注册表 + 落地文档**（其 `landing_commit` 指向 t 提交）；第三方注册表只描述"我是否针对某版 t 验证通过"，非实现真相。
- **扩展 ≠ 改编译器**：本规范描述的是**扩展需求的规范与验证**。若扩展需**改动 t 编译器本身**（如新增语言特性），必须走 t 核心的 PR / 合入门禁（§4.5），由 t 核心决策合并；第三方不得自行 fork 并声称"实现了 rXXXX"。探针只验证"对给定 `tc.exe` 行为符合"，不验证"你改了编译器"。
- **规则书漂移防护**：第三方可 vendoring 一份规则书快照并记其哈希；`tlang-spec-lint` 比对规则书版本，规则升级时提示第三方复验。

---

## 6. 速查清单（第三方贡献一条需求的最小动作）
1. 在**自身工程** `docs/tlang/` 申请 `rXXXX`（注册表追加，不可变）。
2. 写 `docs/tlang/rXXXX_<slug>.md`（需求，含 `## 验收准则`）。
3. 写 `docs/tlang/rXXXX_<slug>.landing.md`（状态 `draft`）。
4. 在自身工程写验证产物：`examples/tlang/rXXXX_<slug>.tc` + `.expected.txt`，或 `tests/tlang/rXXXX_<slug>/{pass,fail}.tc`。
5. 落地后：`tlang-verify.mjs attest rXXXX` 回填证据；状态翻 `landed`。
6. 门禁：`tlang-spec-lint.mjs` + `tlang-verify.mjs` 全绿方可合入。
