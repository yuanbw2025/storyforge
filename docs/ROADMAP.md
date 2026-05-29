# StoryForge 开发路线图

> **最后更新**: 2026-05-28
> **说明**: 本文档是唯一的功能规划文档。旧文档已归档至 `docs/archive/`。
> **结构**: 上半部分「已完成」，下半部分「待开发」按优先级排列。完成后从待办挪到已完成区。

---

# ═══ 已完成 ═══

## ✅ Phase 1-7 — 基础架构 + 核心创作流程

- 完整创作流程（世界观→大纲→细纲→正文）
- 提示词基础设施（`promptTemplates` 表 + 渲染引擎 + 适配器）
- 提示词管理 UI（编辑器 + 列表 + 实时预览 + 导入导出）
- Dexie v7 数据模型增量扩展
- 侧边栏 5 一级三级树导航
- 世界观 13 字段 + 人文环境 7 字段 + 角色分档（次要/NPC/路人）
- 创作区六模块（故事/规则/章节列表/细纲）
- 版本历史（自动+手动快照）
- AI 文档解析导入

## ✅ Phase 8-11 — 抛光 + 提示词参数化

- 主题修复 + UI 清理
- 提示词参数化（25 参数 + 启用/禁用开关）
- 4 套题材包（仙侠/言情/现实/悬疑）+ 热切换器
- PromptRunPanel 调参浮窗扩散到全创作面板
- 示例/反例闭环（few-shot + 👍👎 + AI 生成）

## ✅ Phase 16-17 — 工作流引擎

- 链式编排 AI 步骤
- 工作流自动写回 + 结构化 saveTarget（角色/大纲/伏笔批量 JSON 写入）

## ✅ Phase 18 — 分块导入流水线

- Blob 持久化 + 断点续传 + 暂停/取消 + 角色去重合并
- 百万字级文档工业级导入方案

## ✅ Phase 19 — 大师研读系统

- 19-a: 五维分析 + 三级深度 + 独立数据表
- 19-b: Layer 1 流水线 + 进度追踪
- 19-c: Layer 2 风格量化 + 章节节奏点提取 + Blob 持久化 + 学习设置
- 19-d: 大师洞察（跨作品归纳）

## ✅ Phase R1-R6 — 代码审查

- TypeScript 严格化 / Store 工厂重构 / 导出 5 方式 / 关系图修复 / 架构文档

## ✅ Phase A — 三层记忆系统

- Working Memory（当前章 + 近 3 章摘要）
- Episodic Memory（状态卡 + 事件 + 关系变动）
- Semantic Memory（世界观 + 角色 + 故事线 + 伏笔）
- 状态表自动提取 + 章节摘要 + 事件时间线 + 情感节拍卡

## ✅ Phase B — 全局故事线

- StoryArc 主线/支线 + 阶段卡 + 进度可视化 + AI 生成 + 上下文注入

## ✅ Phase C — 伏笔系统增强

- 逾期检测 + 紧急度分级 + 上下文自动注入 + AI 伏笔建议

## ✅ Phase D — 大纲流程强化

- 批量生成 + 细纲 6 字段增强 + 大纲预览面板

## ✅ Phase E — 题材模板 + 风格系统

- 21 题材元数据 + 11 写作风格 + 5 创作方法论

## ✅ Phase F — 质量控制三件套

- 章节审校 + 去 AI 味增强 + 追读力评估

## ✅ Phase G — 角色 + 设定增强

- 动态状态 + 出场章节追踪 + 活跃角色过滤

## ✅ Phase H — 历史题材增强 (H1-H5)

- 历史年表与事件考证 + 关键词细节风暴
- 历史资料十三维分析
- 项目级历史创作模式（fantasy/historical 双模式）
- 历史题材包与模板映射

## ✅ Phase 20 — 3D 世界地图

- Voronoi 地形生成 + Azgaar 集成

## ✅ Phase 21 — Token 透明化 + 上下文窗口管理

- 流式生成中 Token 实时估算
- 全模块 Token 显示
- 上下文窗口预算管理（ContextBudgetBar + 分层注入 L0-L3 + 模型预设 + 自动裁剪）

## ✅ Phase 22 — 题材模板库扩充

- 从 4 个题材包扩充到 20 个
- 新增：玄幻、武侠、都市、历史、科幻、末世、穿越、重生、系统流、无限流、赛博朋克、克苏鲁、种田、争霸、西幻/奇幻、游戏

## ✅ Phase 23 — 角色 + 设定增强 II

- 角色动态状态面板 + 货币体系管理 + 势力绑定地图

## ✅ Phase 24 — 导出 + 体验优化

- EPUB 导出 + 版本对比 Diff 面板 + 选中文本浮动工具栏

## ✅ Phase 25 — 地理系统重构 + 重要地点

- 25.1 ✅ 修复世界地图双主世界 bug
- 25.2 ✅ 删除「地理环境」面板，地理总述合并到自然环境
- 25.3 ✅ 2026-05-28 创作区新增「重要地点」模块（多标签组合 + 树状层级 + 树状图/列表双视图 + DB v20 `importantLocations` 表）

## ✅ Phase 26（部分）— 角色权重改进

- 26.1 ✅ 角色创建改进（role 选择器 + AI 阵容缺口感知）
- 26.2 ✅ 角色上下文分权重注入（主角完整/配角一句话/其他仅名字）

## ✅ Phase 30（部分）— 批量生成 + 大纲增强

- 30.1 ✅ 批量生成引擎（细纲批量 + 章节批量 + 进度条 + 中途停止）
- 30.3 ✅ 大纲-细纲同步检测（`lastUsedSummary` + 黄色警告条）
- 30.4 ✅ 大纲输出 JSON 化（JSON.parse 优先 + 正则降级）

## ✅ Phase 31（部分）— 历史模式贯通

- 31.1 ✅ 上下文注入历史数据（`buildHistoricalContext` + Token 预算控制）
- 31.2 ✅ 大纲/细纲/正文感知历史模式（历史上下文 + creativeMode 变量）

## ✅ Phase 28（部分）— 作品分析结果优化

- 28.1 ✅ 2026-05-28 分析结果去重、合并与出处定位（Jaccard 2-gram 相似度去重 + 角色按名聚合 + chunk 来源标注）
- 28.2 ✅ 2026-05-28 分析结果结构化展示（左侧 TOC 导航 + 合并/分块双视图 + 角色合并卡片 + 维度折叠面板）
- 28.3 ✅ 2026-05-28 全书 AI 总结（每维度 100-200 字精炼总结 + `analysisSummary` 字段持久化）

## ❌ Phase 29 — 已关闭

> Prompt 精细化：经确认现有功能已满足需求，关闭。

---

# ═══ 待开发（按优先级排列）═══

## 🔴 优先级：高

### Phase 32 — ✅ 真实与幻想（世界规则体系）（2026-05-28）

> 来源：内部审查 | 状态：已完成 | 取代 Phase 31.3（creativeMode 联动）

**核心理念**：将历史考证从「项目级二选一模式（fantasy/historical）」改为「维度级约束声明」。用户可在任何维度上自由混搭真实与架空，AI 生成时遵守用户声明的约束。

**三级树结构**（15 大类 → ~50 子类 → 提示标签），每个节点可独立设置「📜取自真实 / ✨架空改造 / ⚖️冲突优先」：

```
1. 时代背景        — 历史时期 / 架空起点 / 历法时间
2. 重大事件        — 与历史年表联动，isHistorical=true 自动成为锚点
3. 地理疆域        — 行政区划 / 地形地貌 / 城市重镇 / 水系 / 道路交通
4. 气候环境        — 气候特征 / 自然灾害 / 生态物种
5. 政治制度        — 政体 / 中央官制 / 地方官制 / 选官 / 爵位 / 法律 / 外交
6. 军事            — 军制编制 / 武器装备 / 战术战法 / 防御工事
7. 经济            — 赋税 / 货币金融 / 商业贸易 / 农业 / 手工业 / 资源物产
8. 社会结构        — 阶层 / 宗族 / 性别秩序 / 依附关系 / 民间组织
9. 科技生产力      — 工程 / 医药 / 天文 / 交通工具 / 通信 / 生产工具
10. 文化思想       — 主流思想 / 文学艺术 / 教育
11. 宗教信仰       — 官方宗教 / 民间信仰 / 丧葬祭祀 / 禁忌避讳
12. 民族族群       — 主体民族 / 周边民族 / 民族互动 / 外国势力
13. 语言称谓       — 口语风格 / 称谓体系 / 书面语 / 忌讳用语
14. 日常生活       — 饮食 / 服饰 / 居住 / 出行 / 度量衡 / 时间 / 娱乐 / 节庆 / 社交
15. 力量与超自然   — 力量体系 / 超自然存在 / 灵材法器 / 力量与社会
```

**用户可自定义**：支持新增 L1 大类、L2 子类、L3 提示标签。

**子任务**：

- **32.1** ✅ 数据模型 + DB v21（2026-05-28）
  - 新增 `WorldRulesProfile` 类型：`entries: Record<nodeId, {historical, fictional, priority}>` + `customNodes[]`
  - DB 新增 `worldRulesProfiles` 表（singleton per project）
- **32.2** ✅ Store（`world-rules.ts`，singleton 模式）（2026-05-28）
- **32.3** ✅ 规则清单生成器（`world-rules-manifest.ts`）（2026-05-28）
  - 从 entries 生成结构化清单，集成历史年表锚点 + 历史关键词
  - 不设 Token 上限，透明展示消耗估算
  - `buildWorldRulesContext(projectId)` 一站式读取 DB → 生成清单
- **32.4** ✅ WorldRulesPanel UI（2026-05-28）
  - 三栏布局：L1 列表 → L2 列表 → 编辑区（双输入框 + 优先级）
  - L3 作为编辑区灰色提示标签
  - 底部规则清单实时预览 + Token 估算
  - 各级 `+ 新增` 按钮（用户自定义节点）
  - 已填节点标记（色点指示）
- **32.5** ✅ 世界观三面板去 toggle（2026-05-28）
  - 去掉 WorldviewOriginPanel / NaturalPanel / HumanityPanel / WorldviewPanel 的「幻想设定/历史考证」二选一按钮
  - 统一使用通用字段标签
  - 各面板 AI 生成调用改为注入 `worldRulesContext`
- **32.6** ✅ 下游 prompt 改造（2026-05-28）
  - `world-rules-manifest.ts`：新增 `buildWorldRulesContext(projectId)`
  - `prompt-seeds.ts`：`{{#if (eq creativeMode "historical")}}` → `{{#if worldRulesContext}}`
  - `outline-adapter.ts` / `batch-outline-runner.ts`：参数改为 `worldRulesContext`
  - `OutlinePanel.tsx`：调用 `buildWorldRulesContext` 替代 `buildHistoricalContext`
- **32.7** ✅ 侧边栏 + 路由（2026-05-28）
  - 世界观子树第一项：「⚖️ 真实与幻想」（Scale 图标）
  - WorkspacePage 注册 `world-rules` → `WorldRulesPanel`
- **32.8** ✅ 历史年表锚点标识（2026-05-28）
  - `isHistorical: true` 事件标签改为「⚓ 史实锚点」+「AI 不可违反」提示
  - `isHistorical: false` 事件标签改为「✨ 虚构/架空」
- **32.9** ✅ 数据迁移（2026-05-28）
  - `loadProfile` 首次访问时检测 `creativeMode=historical`，自动填充 `globalNote` 迁移提示
  - WorkspacePage 并行加载块新增 `useWorldRulesStore.getState().loadProfile(pid)`
- **32.10** ✅ tsc + build 验证（2026-05-28）

**文件变更清单**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/types/world-rules.ts` |
| 新增 | `src/stores/world-rules.ts` |
| 新增 | `src/lib/ai/world-rules-manifest.ts` |
| 新增 | `src/components/worldview/WorldRulesPanel.tsx` |
| 修改 | `src/lib/db/schema.ts` — v21 |
| 修改 | `src/lib/types/index.ts` |
| 修改 | `src/lib/types/project.ts` — deprecated creativeMode |
| 修改 | `src/lib/ai/context-builder.ts` |
| 修改 | `src/lib/ai/prompt-seeds.ts` |
| 修改 | `src/components/worldview/WorldviewPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewOriginPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewNaturalPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewHumanityPanel.tsx` |
| 修改 | `src/components/outline/OutlinePanel.tsx` |
| 修改 | `src/lib/ai/batch-outline-runner.ts` |
| 修改 | `src/lib/ai/adapters/outline-adapter.ts` |
| 修改 | `src/components/layout/sidebar-tree.ts` |
| 修改 | `src/pages/WorkspacePage.tsx` |

### Phase 28.4 — ✅ 导入分卷支持（2026-05-29）

> 来源：社区反馈 | 状态：已完成

- 本地正则检测卷标题（第X卷/部/篇、卷X、【第X卷】等格式）和章标题
- 确认弹窗显示检测到的分卷结构预览（可展开/折叠）
- 导入时自动创建卷结构骨架（先建空卷，AI 解析的章节自动挂到匹配的卷下）
- chunk-writer 增强：写入大纲时检测已有同名卷，跳过重复创建并复用已有卷 ID
- 卷匹配支持模糊匹配（标题包含关系）

**文件变更**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/import/volume-detector.ts` |
| 修改 | `src/lib/import/chunk-writer.ts` — 卷匹配 + 子章节挂载 |
| 修改 | `src/components/system/ImportDocPanel.tsx` — 分卷检测 + 预写卷骨架 |
| 修改 | `src/components/system/import/ImportConfirmModal.tsx` — 分卷结构预览 UI |

### Phase 30.2 — ✅ 角色关系自动提取（2026-05-29）

> 来源：社区用户 | 状态：已完成

- 数据源：大纲摘要 + 章节正文（自动截取，控制在 ~8000 字内）
- AI 输出 JSON `[{char1, char2, type, label, description, bidirectional}]`
- 关系类型：亲属、恋人、朋友、对手、敌人、师徒、盟友、上下级、其他
- 智能匹配：AI 返回的角色名自动匹配已有角色（精确 + 包含匹配）
- 去重：同对角色同类型关系自动标记「已存在」
- 预览面板：勾选要导入的关系，批量写入
- 新增 prompt seed：`relation.extract`

**文件变更**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/ai/relation-extractor.ts` |
| 修改 | `src/lib/types/prompt.ts` — 增加 `relation.extract` |
| 修改 | `src/lib/ai/prompt-seeds.ts` — 新增关系提取 seed |
| 修改 | `src/components/relations/CharacterRelationPanel.tsx` — AI 提取按钮 + 预览面板 |

### Phase 30.5 — ✅ 导入去重增强（2026-05-29）

> 来源：社区用户 | 状态：已完成 | 与 Phase 28.1 协同

- 世界观字段：句子级 bigram 相似度过滤（本地计算，阈值 0.7，无需 AI）
- 角色按名字聚合：同名角色自动合并字段（追加不覆盖），支持去标点/空格的模糊匹配
- 大纲按标题/摘要去重：bigram 相似度检测（阈值 0.8），重复节点跳过创建但补充摘要

**文件变更**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/import/dedup.ts` — 三类去重工具函数 |
| 修改 | `src/lib/import/chunk-writer.ts` — 集成世界观/角色/大纲去重逻辑 |

---

## 🟡 优先级：中-高

### Phase 33 — ✅ NVIDIA NIM API 接入（2026-05-28）

> 来源：社区反馈（长耳朵兔子） | 状态：已完成

**背景**：NVIDIA NIM（`integrate.api.nvidia.com`）提供 OpenAI 兼容的 `/v1/chat/completions` 接口。浏览器直接请求存在 CORS 限制，通过 vite dev server 代理转发。

**实现内容**：
- `AIProvider` 新增 `'nvidia'` 类型
- 预置 7 个模型：Llama 3.3 70B / Llama 3.1 405B / Llama 3.1 70B / DeepSeek R1 / Qwen 2.5 72B / Gemma 2 27B / Mistral Large 2
- 本地代理：`/nvidia-proxy` → `https://integrate.api.nvidia.com`
- 设置面板：NVIDIA NIM 选项 + 一键代理切换
- `client.ts` 无需改动（NIM 兼容 OpenAI 协议，走默认分支）

| 操作 | 文件 |
|------|------|
| 修改 | `vite.config.ts` |
| 修改 | `src/lib/types/ai.ts` |
| 修改 | `src/components/settings/AIConfigPanel.tsx` |

---

### Phase 26.3 — ✅ 角色驱动剧情模式（2026-05-29）

> 来源：社区反馈 | 状态：已完成

- 用户为角色设定「初始状态」和「目标状态/结局」，AI 推演中间情节并生成卷/章大纲
- 支持多角色弧光交织、自动注入世界观/故事核心/世界规则上下文
- 结构化预览（卷/章树）+ 一键导入大纲系统
- 新增 prompt seed: `plot.character-driven`
- 侧边栏创作区新增「角色驱动」入口

**文件变更**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/ai/character-driven-plot.ts` |
| 新增 | `src/components/outline/CharacterDrivenPlotPanel.tsx` |
| 修改 | `src/lib/types/prompt.ts` — 增加 `plot.character-driven` |
| 修改 | `src/lib/ai/prompt-seeds.ts` — 新增角色驱动剧情 seed |
| 修改 | `src/components/layout/sidebar-tree.ts` — 新增侧边栏入口 |
| 修改 | `src/pages/WorkspacePage.tsx` — 注册面板 |

### Phase 26.4 — ✅ 灵感反推入口（2026-05-29）

> 来源：社区反馈 | 状态：已完成

- 独立面板：用户写碎片灵感（一句话/关键词/场景片段都行）
- AI 反向生成：世界观草稿（摘要+地理+社会+规则）、故事核心（一句话故事+主题+冲突+模式+主线）、2-5 个初始角色卡
- 结构化预览：三大模块可展开/折叠，角色可逐个勾选
- 分模块采纳或一键全部采纳，写入对应 Store（世界观/故事设计/角色库）
- 新增 prompt seed: `inspiration.reverse`
- 侧边栏著作信息下新增「灵感反推」入口（Sparkles 图标）

**文件变更**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/ai/inspiration-reverse.ts` |
| 新增 | `src/components/project/InspirationPanel.tsx` |
| 修改 | `src/lib/types/prompt.ts` — 增加 `inspiration.reverse` |
| 修改 | `src/lib/ai/prompt-seeds.ts` — 新增灵感反推 seed |
| 修改 | `src/components/layout/sidebar-tree.ts` — 新增侧边栏入口 |
| 修改 | `src/pages/WorkspacePage.tsx` — 注册面板 |

### ~~Phase 31.3 — creativeMode 联动题材包~~

> ~~来源：内部审查~~ | 状态：**已被 Phase 32 取代**（Phase 32 去掉了 creativeMode 二选一，改为维度级世界规则体系）

---

## 🟢 优先级：中

### Phase 25.4 — 多世界系统实现

> 来源：产品梳理 | 状态：设计文档已完成（`docs/MULTI-WORLD-DESIGN.md`），代码未开始

设计方案要点（详见设计文档）：
- 世界树节点绑定独立世界观/力量体系/地理数据
- 世界间传送门/通道连接
- 章节/大纲关联所属世界
- 支持诸天流、无限流、平行世界、快穿、修仙多界等题材
- 主角跨世界状态继承与限制

### Phase 30 补充 — 解析增强

> 来源：社区用户 | 状态：未开始

- 章节标题支持 `**标题**摘要` 无冒号格式（`parseChapterOutlineOutput` 增加格式）
- 细纲场景提取降级处理（`parseEnhancedDetailResult` JSON 解析失败时正则降级）

---

## 🔵 优先级：低（远期）

### Phase 27 — AI Agent 化

> 来源：社区反馈（zzjj 等） | 状态：概念阶段，需 tool calling / agent 架构重构

- **27.1** 架构评估：当前流式聊天 → 支持 tool calling 的 agent 模式
  - 当前架构限制：AI 调用是「用户触发 → 流式输出 → 用户采纳」的单轮模式
  - 目标：支持 AI 自主决定查询什么数据、推演什么内容的多步推理 agent 模式
  - 需评估 tool calling 接入成本（不同 AI 提供商的兼容性）

- **27.2** 历史考证助手（场景级 AI 辅助创作）
  > **用户原始需求（zzjj）**：
  > "我现在更重要的需求是在构思某些场景和情节的时候，让 AI 模型主动帮我去边考证边想一些符合历史背景的点子。"
  >
  > 即：作者在撰写过程中，AI 在后台辅助思考，结合已有的世界观、历史年表、世界规则等设定，主动提供符合历史/设定背景的细节建议和灵感点，而不需要作者每次手动发起请求。

  - **Phase 27.2a**（中等难度，不依赖 agent）：「场景考证」按钮——用户描述当前场景，AI 结合世界观+历史年表+世界规则返回考证建议和细节点子
  - **Phase 27.2b**（高难度，需 agent）：写章节时 AI 自动检索相关世界观历史设定，实时在侧栏推送灵感建议

- **27.3** NPC 自动演进（世界时间线引擎）
  > **用户原始需求（zzjj）**：
  > 用户可能设定了一个简单的 NPC 承担推进剧情的功能。当用户（主角）去往另外一个场景的时候，AI 会推演这个 NPC 的成长——NPC 可能也会求学、流浪、去往很多地方、学很多本领，或者颓废一生、碌碌无为一生等。
  >
  > 在未来的某一天，有可能主角跑到某个地方的时候（刚好是这个 NPC 所在的地方），AI 会告诉用户"这个 NPC 在这儿"。如果主角没有跑到 NPC 所在的地方，那么就一直不会遇到这个 NPC。
  >
  > 直到随着故事时间的发展，NPC 在 AI 的推演下可能遇到某些疾病、战事、风险而死去，或者老死。这样每个 NPC 都有自己独立的生命轨迹，而不是只在主角需要的时候才出现。

  **实现要点**：
  - 需要一套「世界时间线引擎」：追踪每个 NPC 的位置、状态、能力、经历
  - NPC 状态随故事时间推进而自动演化（AI 后台异步推演）
  - 主角-NPC 碰撞检测：当主角到达某地点时，检测该地点有哪些 NPC，触发重逢事件提示
  - NPC 生命周期管理：出生→成长→巅峰→衰老→死亡，受世界事件（战争/瘟疫等）影响
  - 在合适时机向作者推荐：侧栏提示"你笔下的主角来到了XX城，曾经的NPC张三也在这里，他这些年经历了..."
  - Token 消耗注意：后台持续推演会消耗大量 API 调用，需要智能调度（只在需要时推演）

  **前置依赖**：
  - Phase 27.1（agent 架构）
  - NPC 角色类型已有（`CharacterRole = 'npc'`）
  - 重要地点系统已有（Phase 25.3 `importantLocations` 表）
  - 状态表系统已有（Phase A `stateCards` 表），可扩展为 NPC 状态追踪

### 未规划 / 长期考虑

| 功能 | 来源 | 备注 |
|------|------|------|
| 协同编辑 | 02-FEATURE-SPEC | 需要后端，当前纯前端架构不支持 |
| WebDAV/坚果云导出 | 02-FEATURE-SPEC | 需 CORS 代理 |
| 国际化 i18n | 02-FEATURE-SPEC | 当前仅中文，架构预留 |
| 移动端适配 | 02-FEATURE-SPEC | 创作工具不适合手机，低优先级 |
| Vercel Serverless 代理 | PROGRESS.md | 解决 CORS 限制的 OpenAI/Claude/Kimi |
| TipTap 富文本编辑器优化 | Phase 24 | 长期目标，已有基础 |

---

## Phase 间关联

```
Phase 28.1（分析去重）←→ Phase 30.5（导入去重）—— 同方向，28 偏展示，30 偏导入
Phase 30.2（关系提取）→ Phase 26.2（角色权重注入）—— 提取的数据可直接用于权重系统
Phase 28.3（全书总结）→ 大师洞察系统 —— 总结可直接作为洞察注入创作 prompt
Phase 26.3（角色驱动）+ Phase 26.4（灵感反推）—— 共同解决「自下而上创作」的需求
Phase 25.4（多世界）—— 独立大模块，不阻塞其他 Phase
Phase 27（Agent）—— 远期架构升级，28.1 智能合并未来可升级为 Agent 多步推理
Phase 32（真实与幻想）→ 取代 Phase 31.3（creativeMode 联动），改造所有下游 prompt 注入
```

---

## 归档说明

以下旧文档已移至 `docs/archive/`，内容已整合到本文档和 PROGRESS.md：

| 文件 | 原用途 | 归档原因 |
|------|--------|---------|
| 01-09 系列 (9个) | 早期产品/技术/开发规划 (2026-04-13) | 已过时或已实现 |
| DEV_PLAN_EVOLUTION.md | Phase A-H 演进计划 | A-H 已完成，未完成项整合到本文档 |
| DEV_PLAN_OUTLINE_REDESIGN.md | 大纲重构计划 | 已完成 |
| HANDOFF.md | AI 换机交接手册 | 已过时，PROGRESS.md 覆盖 |
| playbooks/PHASE-00~20 (21个) | 各 Phase 执行手册 | 全部已完成 |
| design-system/*.md (2个) | 设计系统迁移 | 已完成 |
