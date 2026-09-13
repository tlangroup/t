<!-- ============ 废弃状态 / DEPRECATED ============ -->
# ⚠️ 本文件已废弃 (DEPRECATED)

本文件(`docs/spec.md`)已被 **t 语言设计宪法**(`docs/constitution.md`)取代,自 2026-08-01 起进入**废弃状态**:

- 不再作为语言规范参考,所有设计决策以 `docs/constitution.md` 为准;
- 内容已冻结,不再更新、不再被引用;
- 仅作历史封存保留,供追溯。

---

<!-- ============ 以下为废弃前的原始内容,保留备查 ============ -->

语言名称为t，代码文件为tc。

本文为数据驱动 + AI Agent 友好 编程语言完整设计规范

0 设计总纲（顶层不可突破铁律）
本语言定位：面向数据驱动、ECS 架构、引擎底层、AI 可稳定生成、AI Agent 可自主迭代的静态类型系统语言。
摒弃 C/C++/Odin/Zig 语法歧义、多等价写法、隐式行为、字符串拼接式元编程。
五条强制顶层约束（所有新增特性必须通过校验）
1. 唯一语义原则：同一逻辑仅有一种标准写法，无语法变体，杜绝 LLM 随机生成不一致代码；
2. 完全显式原则：无隐式类型转换、无隐式内存分配、无隐式布尔判定、无隐式生命周期，所有行为静态可预判；
3. 结构化优先原则：元编程全部基于 AST 编译期自省实现，彻底废弃字符串拼接宏，AI 可读、可调试、可自动修复；
4. 数据优先架构：结构体、枚举、Flag 位域、注解、外部数据表导入为一等公民，业务逻辑弱依附于数据定义；
5. 机器可解析报错原则：所有编译错误双输出：人类可读文本 + JSON 结构化诊断报文，支撑 AI Agent「报错解析→自动修改→重新编译」闭环。
补充合规判定：下文全部对标 Rust Attribute 扩展的@xxx注解体系，全部满足五条铁律，无架构冲突，仅为现有注解系统能力扩容；仅两处语法糖做使用边界约束，已在文档内明确规范。

---
1 基础语法规范（AI Agent 友好核心）
1.1 强制命名范式（编译器强制校验）
- 类型（Struct/Enum/Flag/Union）：大驼峰 EntityState
- 变量 / 字段 / 普通函数：小蛇形 entity_id
- 编译期常量：全大写蛇形 MAX_RENDER_LAYER
- 注解标签：小写蛇形 @doc @test @derive
1.2 语句强制规则（零歧义）
1. if/for/while/switch 强制大括号包裹，禁止单行省略；
2. 语句必须分号结尾；
3. 禁用三元运算符、do-while、goto；
4. 多优先级运算必须手动加括号；
5. 禁止隐式布尔判断，条件必须显式比较。
1.3 函数规范
固定签名格式：
func_name(param: Type) -> ReturnType { ... }
约束：参数类型后置、禁止函数重载、禁止隐式返回、所有分支必须显式return。

---
2 基础类型系统（Data 友好，无模糊宽度）
2.1 标量固定位宽类型
彻底废弃模糊int，全部显式位宽：
u8/u16/u32/u64、i8/i16/i32/i64、f16/f32/f64、bool
字符串：string（只读 UTF-8），StringBuilder（可变拼接）
2.2 容器统一范式
- 定长数组：`[N]T`；长度可由初始化器推断时写作 `[_]T`（仅限带初始化器的变量/常量声明，如 `var a: [_]i64 = [1, 2, 3];` 推断为 `[3]i64`）
- 动态切片：[]T
- 哈希映射：map[K]V
容器遍历、接口统一，降低 AI 记忆成本。

map[K]V 的键 K 限定 string 或整型标量；值按 V 的字节宽度拷贝存储。整型键无论声明为
i8…i64/u8…u64，运行时一律按 int64 存储与比较，因此窄整型键也能正确命中。

声明即可用：`var m: map[string]i64;` 直接得到空映射，无需显式构造。也可用字面量初始化：

```t
var m: map[string]i64 = ["alice": 1, "bob": 2];
var p: map[i64]string = [1: "one", 2: "two"];
```

字面量的整型键/值按「默认 int」提升为 i64（同数组字面量规则），`[1: 2]` 是 `map[i64]i64`。

map 可作函数参数与返回值，类型推导天然支持；map 字面量亦可作为表达式出现在任意位置——实参、返回值、赋值右值：

```t
fn analyze(m: map[string]i64) -> map[string]i64 {
    return m;                       // 字面量作返回值
}
var r = analyze(["a": 1, "b": 2]); // 字面量作实参 / 赋值右值
```

嵌套映射 `map[K]map[K2]V` 同样支持，内层映射可按层级读写：

```t
var deep: map[string]map[string]i64;
deep["a"] = ["x": 10, "y": 20];
use(deep["a"]["x"]);
```

当 map 字面量出现在非局部位置（全局变量、结构体字段初始化）时，C 后端会在程序启动的 `t__ginit()` 中运行期构造，语义与 LLVM 后端一致；两个后端对此种写法产出逐字节相同的运行时行为。

按插入顺序迭代键：

```t
for (k in m) {
    print(k);          // k 的类型 = K
    use(m[k]);
}

同时迭代键与值（仅对 map 有意义）：

```t
for (k, v in m) {
    print(k);          // k 的类型 = K
    print(v);          // v 的类型 = V
}
```

对非 map 容器（如切片）使用双变量形式会触发 `T_TYPE_MISMATCH` 类型错误。

操作经内建函数完成（键与值都可以直接写字面量或任意表达式）：
- `map_new(m) -> map[K]V`    创建空映射。实参 m 仅用于提供 K/V 类型（不读取其值），
                             因 t 无类型参数语法。声明式空表已够用，此内建供显式重建场景。
- `map_set(m, k, v) -> void` 插入或覆盖；覆盖不增长长度
- `map_get(m, k) -> V`       取值，未命中返回 V 的零值；等价写法 `m[k]`
- `map_has(m, k) -> bool`    键是否存在
- `map_len(m) -> i64`        元素个数
- `map_del(m, k) -> bool`    删除，返回删除前是否存在
迭代顺序 = 插入顺序（确定性；删除后其余键的相对次序保持不变）。

索引写（赋值）等价于 `map_set`，且支持 find-or-insert 语义——键不存在时自动创建，存在时覆盖（覆盖不增长长度）：
```t
var m: map[string]i64;
m["alice"] = 10;                 // 等价 map_set(m, "alice", 10)
m["alice"] = 15;                 // 覆盖
m["sum"] = m["alice"] + m["bob"];// 读 + 写可混用
var deep: map[string]map[string]i64;
deep["a"] = ["x": 1, "y": 2];
deep["a"]["x"] = 100;            // 嵌套索引写：自动对 inner map 求 TMap* 后插入
```
注意：索引写 `m[k] = v` 走的是 `t_map_put`（find-or-insert），**不是**对 `m[k]` 读值再回写——后者在键未命中时会写入 `t_map_val_ptr` 返回的零缓冲而丢失。整型键统一按 i64 落盘；计算右值、嵌套多层索引写两个后端行为一致。

2.3 字符串驻留符号 Sym32/Sym16

面向 ECS Component 的字符串需求：Component 字段不能使用不定长 string，但业务又需要「字符串身份」。Sym 把「真实字符串」与「字段存储」解耦——声明 `Sym32("tag")` / `Sym16("tag")` 的字段，编译期只存 32 位 / 16 位无符号整数 id；真实字符串按 tag 分池、运行期不定长存储，由编译器自动维护。

- 语法（唯一写法，无变体）：`var <name>: Sym32("<tag>") = "<string>";` 位宽仅允许 32 / 16；`<tag>` 为每个内存池的命名空间（不同 tag = 不同池，互不干扰）。
- 自动驻留（intern）：赋字符串时编译器自动调用 `t_sym_intern(tag, str, bits)` 取得 id 存入变量；同池相同字符串去重，返回同一 id。
- 按 id 比较（O(1)）：`==` / `!=` 比较底层 id，不比较字符串内容；同池同字符串恒等。
- 跨池类型安全：`Sym32("A")` 与 `Sym32("B")` 视为不同类型，互相赋值报 `T_TYPE_MISMATCH`（f15）；`Sym32` 与 `Sym16` 亦不兼容。
- 区域释放（无引用计数）：`sym_release("<tag>")` 释放整池，`sym_release_all()` 释放全部池；编码者须自行在合适时机（区域结束）调用。
- 取回字符串：`sym_str(v)` 由变量类型推出所属 tag，返回池中原始字符串（String）。
- 全局变量字符串初始化器含 intern 调用时，自动搬进 `t__ginit` / `t.__ginit` 运行期执行（双后端一致）。
- 设计契合：显式（无隐式转换）、数据驱动（tag 即命名空间）、AI 友好（唯一写法）。

2.4 变体类型 Variant
内置一等 Variant（带标签联合体 / tagged union），承载任意基础类型、结构体引用，用于配置解析、LLM 动态参数、跨模块数据传递。

语法：
```
Name :: variant {
    Circle(f64);     // 携带载荷，载荷类型可为任意已声明类型
    Rect(f64);       // 每个 case 独立
    Empty;           // 单元 case（无载荷）
}
```

语义：
- 编译产物：`typedef struct Name { uint32_t _tag; union { T_i _u_i; ... } _u; } Name;`（`_tag` 为 case 声明下标，0 起；单元 case 无 union 成员）。
- 编译器为每个 case 生成自由函数（数据优先、免改表达式推导）：
  - `Name_from_CaseX(payload) -> Name`          构造器（单元 case 无参数）
  - `Name_is_CaseX(self: Name) -> bool`         判别当前 tag 是否为该 case
  - `Name_as_CaseX(self: Name) -> payload`      取载荷（仅携带载荷的 case 提供）
- 当前约束：Variant 上暂不支持 `@derive`（Clone/ToString/FromString/Eq/Hash 等），后续补充；跨模块需在同一编译单元内。


---
3 核心数据结构体系
3.1 结构体 Struct（数据驱动核心载体）
PlayerComponent :: struct @derive(Clone,BinarySerde) {
    hp: f32 @doc("角色生命值") @export;
    unique_id: u64 @binary_offset(8);
}
两种内存布局指令（ECS 高性能）：
- #aos 默认数组结构体布局
- #soa 自动转为结构体数组布局，优化 CPU 缓存命中率
3.2 枚举 Enum
1. 强制绑定底层存储位宽；
2. comptime 可完整遍历所有枚举项；
3. 支持注解挂载、自动字符串转换、外部数据表映射。
3.3 联合体 Union
强制显式内存对齐，专门用于二进制协议、存档文件、网络数据包解析。

---
4 注解系统（元数据、序列化、AI 理解核心）
4.0 注解通用规则
1. 统一语法：@name(参数)，可挂载在类型、字段、函数、全局节点；
2. 全部可通过type_info(T)在编译期完整自省读取；
3. 条件编译类注解由编译器在 AST 阶段直接裁剪节点，无黑盒隐式行为；
4. 非法注解参数均输出结构化 JSON 错误码。
4.1 原有基础内置注解（保留）
1. @doc("描述文本")：文档注释，IDE 悬浮提示、自动文档生成；
2. @export：导出至编辑器检视面板、外部配置工具；
3. @binary_offset(N)：字段强制二进制序列化字节偏移；
4. @binary_skip：序列化时跳过此字段；
5. @auto_convert（后续由@derive统一替代，仅做兼容过渡）；
6. @offset(N)：Flag 位域强制指定起始比特位。
4.2 新增第一大类：测试体系注解（对标 Rust #[test]）
注解
Rust 原型
功能说明
@test
#[test]
标记无参函数为单元测试用例，--run-test指令批量执行；返回void无崩溃即通过，返回bool则true通过
@test_skip
#[ignore]
跳过当前用例，不参与批量测试
@test_only
#[cfg(test)]
仅测试编译模式保留函数，Release 版本直接从 AST 删除
@expect_fail
#[should_panic]
预期用例必然断言 / 越界崩溃，用于边界异常校验
@test_group("标签")
扩展自定义
测试用例分组，可按组筛选执行
配套全局内置断言函数（测试专用，报错结构化输出）
assert_eq(实际值, 期望值, 提示信息)
assert_true(条件, 提示信息)
assert_false(条件)
assert_panic(表达式, 预期错误描述)
示例：
bitfield_bound_check :: func() -> bool @test @expect_fail {
    var state: GameStateMask = 0;
    flag_set(state, GameStateMask.move_mode, 4); // 2bit最大为3，预期越界
    return true;
}
4.3 新增第二大类：派生自动实现注解（对标 Rust #[derive ()]）
统一收口为 @derive(能力列表)，废弃零散@auto_convert，作为标准写法
可派生能力全集：
1. ToString：自动生成to_string()序列化方法
2. FromString：自动生成from_string()反向解析，适配 CSV 配置表
3. Clone：深度克隆方法
4. Copy：按内存位拷贝标记
5. DebugPrint：调试格式化打印
6. BinarySerde：紧凑二进制序列化 / 反序列化
7. Eq/PartialEq：相等性判断函数
8. Hash：哈希计算，支持作为 Map 键
示例：
RenderLayer :: flag[u16] @derive(ToString,FromString,BinarySerde,Eq) {
    default_layer : 1 @doc("默认渲染图层");
    ui_layer      : 1;
}
底层实现：comptime 通过type_info遍历结构，AST 直接生成对应代码，无任何字符串模板拼接。
4.4 新增第三大类：条件编译注解（对标 Rust #[cfg] / #[cfg_attr]）
1. @cfg(条件)
满足条件才编译当前节点，否则直接剔除 AST。
支持条件：debug/release/windows/linux/mac/android/web/feature=功能名
debug_print_log :: func(msg: string) -> void @cfg(debug) {}
2. @cfg_attr(条件, @内嵌注解)
条件成立时附加指定注解，等价 Rust cfg_attr
temp_func :: func() -> void @cfg_attr(release, @allow(unused)) {}
4.5 新增第四大类：警告与诊断控制注解（对标 allow/warn/deny/deprecated）
统一三指令语法：
@allow(警告项) 关闭警告
@warn(警告项) 提升为警告提示
@deny(警告项) 直接升级为编译错误
内置可管控警告列表：
unused、unused_field、dead_code、overflow_literal、implicit_cast、bitfield_overlap、deprecated
附加：@deprecated("替换方案说明")
标记接口废弃，调用处触发警告，JSON 报错附带替代函数名称，AI 可自动重构调用代码。
示例：
old_calc_api :: func() -> u32 @deprecated("请使用 new_calc_api()") {}
unused_helper :: func() -> void @allow(unused, dead_code) {}
4.6 新增第五大类：内存布局、ABI、二进制序列化注解（强贴合数据驱动）
1. @repr(模式) 对标 Rust #[repr()]
可选参数：
- C：兼容 C 语言结构体布局，用于 FFI 外部调用
- Packed：取消对齐填充，紧凑内存打包
- Align(N)：强制整体内存对齐字节数（1/2/4/8/16）
2. @no_padding：语法糖别名，等价@repr(Packed)，优先用于 Flag 位域、网络包
3. @bitpack(底层整型)
结构体直接声明为位域打包类型，规范约束：
- flag[T] 为语义专用类型（标记集合 + 分段数值位域），业务代码优先使用；
- @bitpack(T) 仅用于老旧二进制协议兼容、第三方数据对接，避免语义混用歧义。
ProtocolHeader :: struct @bitpack(u16) {
    cmd_type : 4;
    length   : 6;
}
4. 原有保留：@soa/@aos、@binary_offset、@binary_skip
4.7 新增第六大类：函数行为约束、工具链、链接注解
1. @inline / @no_inline：控制编译器是否强制函数内联
2. @must_use：返回值不接收直接告警，防止忽略错误码 / 状态值
3. @const_fn：强制函数可完全 CTFE 编译期执行
4. @unsafe：显式标记不安全操作（裸指针、直接内存改写、FFI），必须手动标注
5. @main：标记程序入口函数，替代固定名称 main ()
6. @export_symbol("导出名")：动态库对外导出符号，FFI 使用
7. @link_name("外部符号")：绑定 C 库外部函数符号名
8. @panic_handler：自定义全局崩溃处理函数
9. @doc_file("xxx.md")：挂载外部文档文件，自动生成项目文档
示例：
app_entry :: func() -> i32 @main { return 0; }
safe_file_read :: func(path:string) -> i32 @must_use { ... }
4.8 全量内置注解总清单（归档备查）
测试类
@test、@test_skip、@test_only、@expect_fail、@test_group("分组")
派生自动实现类
@derive(ToString,FromString,Clone,Copy,DebugPrint,BinarySerde,Eq,Hash)
条件编译类
@cfg()、@cfg_attr()
警告管控类
@allow()、@warn()、@deny()、@deprecated("提示")
布局 ABI 序列化类
@repr()、@no_padding、@align()、@binary_offset、@binary_skip、@bitpack(T)、@offset(N)、@soa、@aos
函数约束 & 工具链类
@inline、@no_inline、@must_use、@const_fn、@unsafe、@main、@export_symbol、@link_name、@panic_handler、@doc、@doc_file

---
5 编译期元编程体系（终稿重构：AST 自省唯一方案）
5.1 CTFE 编译期求值
1. comptime函数语法与运行时完全一致，AI 只需掌握一套写法；
2. 支持编译期读取外部 CSV/JSON 数据表，直接固化为静态常量；
3. 编译期完成数据合法性校验，提前拦截配置错误。
5.2 type_info (T) 编译期类型自省（核心底座）
可遍历任意类型完整结构化信息：字段名、类型、内存偏移、位宽、取值范围、全部挂载注解、元标签。
所有@derive自动方法、测试用例收集、序列化代码、编辑器元数据导出全部基于 AST 生成，零字符串拼接宏，对 AI 完全透明可解析。
5.3 Flag / 位域自省结构 SlotInfo（固定格式）
SlotInfo {
    name: string;
    start_bit: u32;
    bit_length: u32;
    min_value: u32;
    max_value: u32;
    is_single_bit: bool; // true=1bit布尔开关，false=多bit数值位域
    annotations: []Annotation;
}

---
6 Flag / 位域系统终稿（融合 Zig+Rust 最优设计）
6.1 核心规则
1. 默认自上而下自动顺序分配比特偏移，无需手动计算起始位；
2. 1bit 布尔标记、≥2bit 数值位域读写规则强隔离，编译器强制校验；
3. 特殊二进制协议使用@offset(N)注解强制指定起始 bit；
4. 全部支持注解挂载、自省、自动序列化、数据表解析。
6.2 标准声明写法
GameStateMask :: flag[u32] {
    move_mode       : 2  @doc("移动模式 0~3") @export(bitfield_spinbox);
    ai_level        : 3  @doc("AI等级 0~7") @export(bitfield_spinbox);
    behavior_type   : 2  @doc("行为类型 0~3") @export(bitfield_spinbox);
    enable_collision: 1  @doc("碰撞开关")    @export(flag_multiselect);
}
6.3 强制自定义偏移写法（小众兼容场景）
CustomProtocolFlag :: flag[u32] {
    cmd_code : 2 @offset(5); // 强制从第5bit开始
    param_id : 3;            // 自动顺延排布
}
6.4 读写强制隔离规则（AI 零歧义）
1. 1bit 单比特布尔位
允许位运算符：| & ^ |= &= ^=；布尔判断必须完整非零比较，禁止隐式判定
if (mask & RenderLayer.ui_layer) != 0 {}
2. ≥2bit 多比特数值位域
完全禁止直接位运算改写，仅使用内置全局函数：
flag_set(flag_instance, 字段名, 赋值数值)
flag_get(flag_instance, 字段名) -> u32
越界双层校验：常量赋值编译直接报错；变量运行时报错并输出 JSON 修复建议。
6.5 超大位域补充：flag_set 动态变长容器
超出 u64 承载范围时使用，声明语法、注解、自省、读写接口与flag[T]完全统一：
LargeEntityTag :: flag_set {
    faction_id : 4;
    job_type   : 5;
    is_boss    : 1;
}

---
7 数据驱动完整流水线规范
7.1 开发顺序倒置（数据先行）
数据表结构定义 → 配置原始数据 → 通用系统逻辑编码，最大限度消除硬编码分支。
7.2 外部数据导入能力
1. CTFE 编译期载入 JSON/CSV 表格；
2. 自动映射到 Struct/Enum/Flag 类型；
3. 编译期完成值域、枚举合法性校验，上线前拦截脏数据。
7.3 统一序列化能力
所有原生类型、结构体、枚举、Flag 通过@derive(BinarySerde)一键生成：紧凑二进制序列化、字符串互转、配置表解析三套逻辑。

---
8 AI Agent 自动化适配层（独家设计）
8.1 语法强收敛
无等价多写法、无隐藏语义、无隐式转换，大幅降低 LLM 生成错误与风格漂移。
8.2 编译器结构化双输出报错
所有错误同时输出：
1. 人类精简日志；
2. JSON 机器诊断包：错误码、行列号、错误原因、合法取值区间、可直接替换的修复代码片段。
支撑 AI 全自动「报错→改代码→复测」闭环。
8.3 AST 标准化导出
编译器支持导出源码 JSON 格式抽象语法树，AI 可批量分析、批量重构、批量生成模板代码。

---
9 新增特性合规性自校验章节（正式归档）
9.1 对标 Rust Attribute 全套注解扩展合规结论
所有新增@test/@derive/@cfg/@repr等注解体系100% 符合顶层五条铁律：
1. 语法统一使用@xxx，无多变体写法，满足唯一语义；
2. 所有注解显式手动挂载，无编译器隐式追加行为，满足完全显式；
3. 全部基于 AST+type_info 自省生成代码，无字符串拼接宏，满足结构化优先；
4. 大量布局、序列化、派生能力补强数据存储与数据表导入，贴合数据优先架构；
5. 全部错误标准化 JSON 输出，兼容 AI 自动修复闭环。
9.2 仅两处语法糖边界约束（写入规范强制要求）
1. flag[T] 语义类型 vs @bitpack(T) 结构体打包注解
业务层优先使用flag[]表达位域 / 标记集合；@bitpack仅用于老旧二进制协议、第三方数据兼容，不鼓励混用，避免语义歧义。
2. 条件编译@cfg可移植性约束
条件编译仅控制 AST 节点是否参与编译，不修改类型系统规则，源码本身跨平台保持一致，保证语言可移植性。
9.3 淘汰过渡说明
原零散注解@auto_convert标记为兼容过渡写法，新项目统一使用@derive作为标准派生声明。

---
10 适用场景定位
1. 自研游戏引擎、ECS 数据驱动高性能架构；
2. 底层工具、物理仿真、嵌入式固件开发；
3. 表格配置驱动工业化项目；
4. AI 辅助代码生成、AI Agent 自主迭代工程；
5. 需要兼顾「人类编写简洁」与「AI 生成稳定可预测」的底层系统。

---
文件说明
本文档为最终定稿完整版，已将：原始架构规范 + Zig/Rust 融合版 Flag 位域规则 + Rust Attribute 全量对标@xxx注解扩展 + 合规性校验约束全部合并，可直接作为语言立项文档、编译器开发需求文档使用。