# T WASM Component 设计（BP-2：接口发射 + 沙箱隔离验证）

> 状态：规格 v0.1（2026-09-04，落实 `backend-design.md §3` 注记 + `pipeline-review.md` 最佳结合点 BP-2）
> 关联：`backend-design.md §3`（WASM / Component Model）、`compiler-pipeline-design.md §4.5/§7`、`tir-design.md`（TIR 模块边界 1:1 `.tc`）、`supply-chain-design.md`（组件信任）、审查维度 D4-3 / D7-10 / D8

---

## 0. 定位与审查结论

Component Model 对 seesaw-erp 的价值（「核心不重编、业务以组件插件化」）**只在产物无法逃逸沙箱时成立**（见 `pipeline-review.md §8.2` D4-3/D7-10 张力）。故本设计把「接口发射」与「沙箱隔离验证」绑为**同一交付包**（BP-2 = D4-3 ⊕ D7-10 ⊕ D8），不能只产 `.wit` + `.wasm`。

> 这是 G-3（Component Model WASM）的**交付门槛**：未通过隔离验证的组件不得发布，否则 ERP 插件化故事在安全性上不成立。

---

## 1. 接口发射（D4-3）

- TIR 模块（1:1 `.tc`）→ Component：导出函数/类型经 **Canonical ABI** 降为 WIT `func` / `type`；`linkonce_odr` 实例区处理跨组件泛型（见 `tir-design.md §4.2.1`）。
- 产出 `*.wit` 接口描述 + `wasm-tools component new` 封装为 component（替代 core-module + wasip1）。
- 内存模型：组件线性内存由 Canonical ABI 约束，组件间**不共享裸指针**——跨组件数据一律经 ABI 序列化。

---

## 2. 沙箱隔离属性验证（D7-10，核心）

「安全边界保持 / 隔离属性」是 D7-10 的二分项之一（与「语义保持」并列）：编译产物须**无法逃逸沙箱、仅经声明的 import/export ABI 与宿主交互、无非法访存**。验证规格（vWasm 式）：

1. **ABI 闭环测试**：静态断言组件仅 import/export 白名单中的函数/类型；任何未经声明的宿主调用在链接期被拒（Canonical ABI 校验）。
2. **内存边界测试**：组件写越界/读未授权内存在 wasm 运行时被 trap；CI 以畸形输入 + 模糊测试验证 trap 行为（联动 CTFE/fuzz，D6-1/D7-3）。
3. **隔离属性不变式检查**：对 TIR→WASM 降级加「无裸指针逃逸」不变式——所有跨组件数据经 Canonical ABI 序列化，无 `i32` 伪装指针透传（对标 vWasm 的 "no escaping raw pointers"）。
4. **门禁**：上述 1~3 作为 component 构建的**阻断门禁**；不通过则组件不可发布（BP-2 交付门槛）。

---

## 3. 与供应链信任的绑定（D8）

组件须带签名/来源（见 `supply-chain-design.md` D8-5/D8-6）才允许主机加载——插件生态准入门槛。信任链：声明的 ABI（D4-3）+ 隔离验证（D7-10）+ 来源签名（D8）三者齐备，组件才被主机接受。

---

## 4. 落地（P1，与 G-3 同批）

**W 阶段**（`backend-design.md §6`）：`tir→wasm` + Component Model / WIT + 本设计的隔离门禁。先于 ERP 插件化试点。建议与 G-9 诊断 IR（P1）同期，因隔离验证失败需精准回指源码 span（见 `diagnostic-ir-design.md §2`）。

### 4.1 隔离门禁的 CI 实现（阻断）

组件发布前在 CI 跑「构建 + 隔离验证」两段，任一不过则阻断（BP-2 交付门槛）：

1. **构建段**：`tir→wasm` + `wasm-tools component new` 产出 component；失败即阻断。
2. **隔离验证段**（`wasm-component-verify` job，见 `ci-gate-design.md` G-CI-8）：
   - **ABI 闭环**：静态断言组件 import/export 仅白名单集合（Canonical ABI 校验拒绝未声明宿主调用）。
   - **内存边界**：以畸形输入 + wasm 运行时 trap 验证越界/未授权访问被拒；联动 CTFE fuzz 的隔离自检（§5.1.1）。
   - **无裸指针逃逸**：TIR→WASM 降级加「跨组件数据全经 Canonical ABI 序列化、无 `i32` 伪装指针」不变式检查。
   - **失败回指**：隔离验证失败经 `diagnostic-ir-design.md §2` 跨层 span 回指源码，报错可读。
3. **信任准入**：通过隔离验证的组件须带 `supply-chain-design.md` 来源签名（D8-5）才被主机加载。
