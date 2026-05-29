# StoryForge 更新日志

> 按时间倒序排列，每个 Phase 标注完成日期和详细改动。

---

## 2026-05-29

### Hotfix — 全局AI上下文互注（世界观 ↔ 各独立面板）

**来源**：社区用户（买辣椒）反馈世界观各模块 AI 生成的内容互不关联、缺乏逻辑一致性

**问题**：世界观三面板互不读取；地理面板AI概念地图不读世界观自然环境；历史年表AI考证/头脑风暴不读世界观设定。各模块AI生成内容互相矛盾。

**修复**：

**1) 世界观三面板上下文闭环**
- 世界起源 `buildCtx` 注入自然环境（世界结构/地貌/气候）+ 人文环境（历史线/种族/势力）
- 自然环境 `buildCtx` 注入世界起源（世界来源/力量层次）+ 人文环境（历史线/种族/势力）
- 人文环境原已读取跨面板数据，无需改动

**2) 地理面板AI概念地图注入世界观**
- `buildConceptMapPrompt` 自动提取世界来源、世界结构、地貌分布、山川水系、气候环境、重镇分布，附加到概述中传给AI

**3) 历史年表AI注入世界观**
- 事件考证和关键词头脑风暴的 `userPrompt` 自动附加世界观关键字段：世界来源、力量层次、世界历史线、世界大事记、种族与民族、势力分布、历史总述、纪年体系

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/components/worldview/WorldviewOriginPanel.tsx` | `buildCtx` 增加 Natural + Humanity 关键字段注入 |
| `src/components/worldview/WorldviewNaturalPanel.tsx` | `buildCtx` 增加 Origin + Humanity 关键字段注入 |
| `src/lib/ai/adapters/geography-adapter.ts` | `buildConceptMapPrompt` 注入 worldview 自然环境上下文 |
| `src/components/history/HistoryPanel.tsx` | 两个 AI 调用注入 worldview 上下文 |

---

### Hotfix — 深色主题输入框白底修复

**问题**：`bg-bg-input` CSS 类在 tailwind 配置中不存在，导致灵感反推和角色驱动剧情面板的 textarea/select 在非默认主题下显示白色背景。

**修复**：统一替换为 `bg-bg-base`（6处）。

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/components/project/InspirationPanel.tsx` | 2 处 `bg-bg-input` → `bg-bg-base` |
| `src/components/outline/CharacterDrivenPlotPanel.tsx` | 4 处 `bg-bg-input` → `bg-bg-base` |

---

### Phase 26.4 — 灵感反推入口

**来源**：社区用户反馈

从碎片灵感反推完整故事框架——写下一句话、几个关键词甚至一个模糊想法，AI 自动反向推演出世界观、故事核心和初始角色。

**新增内容**：

- **灵感输入**：大文本框，支持任意形式的碎片灵感——一句话、关键词组合、场景描写、角色概念等都行。可选补充说明（风格、要求等）
- **AI 反向推演**：AI 从灵感出发反推完整故事框架，自动生成：
  - 世界观草稿：精华摘要 + 地理环境 + 社会结构 + 世界规则
  - 故事核心：一句话故事 + 主题 + 核心冲突 + 情节模式 + 主线概述
  - 初始角色卡：2-5 个关键角色，含名字、定位、简介、性格、背景、动机、弧光
- **结构化预览**：三大模块（世界观/故事核心/角色）独立展示，可展开折叠查看详情
- **分模块采纳**：每个模块独立采纳按钮，角色支持逐个勾选。采纳后直接写入对应数据存储
- **一键全部采纳**：一键把所有生成内容写入世界观、故事设计、角色库
- 侧边栏著作信息下新增「灵感反推」入口

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/inspiration-reverse.ts` | 新增：prompt 构建 + AI 输出解析（世界观/故事核心/角色结构化） |
| `src/components/project/InspirationPanel.tsx` | 新增：灵感输入 + AI 生成 + 三模块预览 + 分模块/一键采纳 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `inspiration.reverse` |
| `src/lib/ai/prompt-seeds.ts` | 新增灵感反推 seed（反推策划师角色 + JSON 输出格式） |
| `src/components/layout/sidebar-tree.ts` | 侧边栏著作信息下新增 `inspiration` 叶子 |
| `src/pages/WorkspacePage.tsx` | 注册 `InspirationPanel` |

---

### Phase 26.3 — 角色驱动剧情模式

**来源**：社区用户反馈

从角色弧光反推情节大纲——用户设定角色的「起始状态」和「目标状态/结局」，AI 自动推演中间情节并生成结构化的卷/章大纲。

**新增内容**：

- **角色弧光设定面板**：从项目角色库中选择角色，为每个角色填写起始状态和目标状态描述。支持「自动填充」从角色卡已有的背景故事和弧光字段预填
- **AI 剧情推演**：AI 分析多个角色从起点到终点的必经转变，设计触发事件和交叉点，生成完整的卷/章大纲。自动注入世界观、故事核心、世界规则约束等上下文
- **结构化预览**：AI 输出解析为卷/章树形结构，每章显示标题、摘要、关键角色、弧光推进说明。支持展开/折叠、全选/单选
- **一键导入大纲**：选中的卷可批量写入大纲系统，章节摘要自动包含角色弧光推进标注
- **额外要求输入**：用户可补充约束（如卷数限制、侧重方向、感情线要求等）
- 新增 prompt seed：`plot.character-driven`（角色弧光分析 → 多角色交织 → 冲突层次递进）
- 侧边栏创作区新增「角色驱动」入口（Drama 图标）

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/character-driven-plot.ts` | 新增：prompt 构建（角色弧光格式化 + 已有大纲注入）+ AI 输出解析 |
| `src/components/outline/CharacterDrivenPlotPanel.tsx` | 新增：角色弧光设定 + AI 生成 + 结果预览 + 导入大纲 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `plot.character-driven` |
| `src/lib/ai/prompt-seeds.ts` | 新增角色驱动剧情 seed（系统提示 + 用户模板） |
| `src/components/layout/sidebar-tree.ts` | 侧边栏创作区新增 `character-driven-plot` 叶子 |
| `src/pages/WorkspacePage.tsx` | 注册 `CharacterDrivenPlotPanel` |

---

### Phase 30.5 — 导入去重增强

**来源**：社区用户反馈

导入大文档时自动过滤重复内容，避免多块解析产生的冗余数据。全部本地计算，无需 AI 调用。

**新增内容**：

- **世界观句子级去重**：将新块解析出的世界观文本按句子拆分，与已有内容逐句比较（使用 bigram Jaccard 相似度），过滤相似度 ≥ 70% 的重复句子，只追加真正新增的信息
- **角色同名自动合并**：导入角色前检查项目中是否已有同名角色（支持精确匹配和去标点/空格的模糊匹配），同名角色不重复创建而是将新信息追加到已有角色卡的各字段中
- **大纲标题去重**：写入大纲节点前检查同层级是否已有相似标题的节点（bigram 相似度 ≥ 80%），重复节点跳过创建，但如果已有节点缺少摘要而新节点有，会自动补充

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/import/dedup.ts` | 新增：三类去重工具（世界观句子去重、角色同名检测+合并、大纲标题去重） |
| `src/lib/import/chunk-writer.ts` | 世界观写入改为句子级去重追加；角色写入增加同名检测+合并；大纲写入增加标题去重 |

---

### Phase 28.4 — 导入分卷支持

**来源**：社区反馈

导入大文档时自动识别卷标题，创建正确的卷→章层级大纲结构。

**新增内容**：

- **本地分卷检测**：纯正则扫描全文，识别卷标题（第X卷/部/篇、卷X、【第X卷】）和章标题（第X章/回/节、Chapter N），构建层级结构
- **确认弹窗结构预览**：点击"开始解析"后的确认弹窗中新增「📖 检测到文档结构」区域，显示卷数、章数，可展开查看完整的卷→章树形结构
- **自动创建卷骨架**：确认导入时，如果检测到分卷，先创建空的卷节点写入大纲
- **AI 章节智能挂载**：AI 分块解析出的章节自动匹配已有的同名卷节点，挂载为子节点；支持模糊匹配（标题包含关系）
- **卷摘要补充**：如果 AI 解析出了卷摘要而已有卷为空，自动补充
- **卷去重**：如果 AI 解析出的卷名与已有卷重复，跳过创建，避免重复

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/import/volume-detector.ts` | 新增：卷/章正则检测、层级结构构建 |
| `src/lib/import/chunk-writer.ts` | 增强：写入大纲时匹配已有卷、子章节挂载 |
| `src/components/system/ImportDocPanel.tsx` | 增加分卷检测 + 预写卷骨架逻辑 |
| `src/components/system/import/ImportConfirmModal.tsx` | 新增分卷结构预览 UI |

---

### Phase 30.2 — 角色关系自动提取

**来源**：社区用户反馈

新增 AI 一键提取角色关系功能。AI 会自动读取项目的大纲摘要和章节正文，分析其中涉及的角色互动，输出结构化的关系数据。

**新增内容**：

- **AI 提取按钮**：角色关系面板顶部新增「AI 提取」按钮，点击后 AI 自动分析文本内容
- **智能数据源**：自动汇总大纲摘要 + 章节正文（前 ~8000 字），作为 AI 分析素材
- **角色名智能匹配**：AI 返回的角色名自动与已有角色卡匹配（精确匹配 + 包含匹配 + 去姓匹配）
- **去重检测**：自动检测与已有关系重复的条目，标记为「已存在」
- **预览面板**：提取完成后展示所有发现的关系，每条显示角色对、关系类型、标签、描述。用户可勾选要导入的关系，批量写入
- **支持的关系类型**：亲属、恋人、朋友、对手、敌人、师父、弟子、盟友、上下级、其他
- **新增 prompt seed**：`relation.extract`（内置角色关系分析 system prompt）

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/relation-extractor.ts` | 新增：prompt 构建、JSON 解析、角色匹配、去重逻辑 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `relation.extract` |
| `src/lib/ai/prompt-seeds.ts` | 新增关系提取 seed（system prompt + user template） |
| `src/components/relations/CharacterRelationPanel.tsx` | 新增 AI 提取按钮 + 流式提取 + 预览/勾选/批量导入面板 |

---

## 2026-05-28

### Phase 33 — NVIDIA NIM API 接入

**来源**：社区反馈（用户「长耳朵兔子」）

为 StoryForge 新增 NVIDIA NIM 作为 AI 提供商。NVIDIA NIM 平台托管了多家开源大模型（Llama、DeepSeek、Qwen、Gemma、Mistral 等），使用 OpenAI 兼容协议，用户可通过 NVIDIA 账号获取 API Key 后直接使用。

**新增内容**：

- **AI 提供商**：`AIProvider` 类型新增 `'nvidia'`
- **预置模型**（7 个）：
  - `meta/llama-3.3-70b-instruct` — Llama 3.3 70B（默认推荐）
  - `meta/llama-3.1-405b-instruct` — Llama 3.1 405B（最强开源模型）
  - `meta/llama-3.1-70b-instruct` — Llama 3.1 70B
  - `deepseek-ai/deepseek-r1` — DeepSeek R1 推理模型
  - `qwen/qwen2.5-72b-instruct` — 通义千问 2.5 72B
  - `google/gemma-2-27b-it` — Google Gemma 2 27B
  - `mistralai/mistral-large-2-instruct` — Mistral Large 2
- **本地代理**：vite dev server 新增 `/nvidia-proxy` → `https://integrate.api.nvidia.com` 转发规则，解决浏览器 CORS 限制
- **设置面板**：NVIDIA NIM 选项（带 CORS 警告标记），支持一键「切换到本地代理」/「恢复直连」
- **零改动兼容**：NIM 完全兼容 OpenAI `/v1/chat/completions` 协议，`client.ts` 的 `buildRequest` + SSE 流式解析无需任何修改，`stream_options` 默认支持

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/types/ai.ts` | `AIProvider` 增加 `'nvidia'`；`PROVIDER_MODELS` 增加 7 个模型；`PROVIDER_PRESETS` 增加默认 baseUrl 和模型 |
| `vite.config.ts` | `server.proxy` 增加 `/nvidia-proxy` 规则 |
| `src/components/settings/AIConfigPanel.tsx` | `PROVIDER_OPTIONS` 增加 NVIDIA NIM；`PROXY_MAP` 增加代理映射 |

---

### Phase 32 — 真实与幻想（世界规则体系）

**来源**：内部审查，取代旧的 `creativeMode` 二选一模式

将历史考证从「项目级二选一开关（fantasy/historical）」彻底重构为「维度级约束声明」系统。用户可在 15 个大类、约 50 个子类的任何维度上独立声明哪些内容取自真实历史、哪些是架空改造，AI 生成时自动遵守所有约束。

#### 32.1 — 数据模型 + DB v21

- 新增 `WorldRulesProfile` 类型：包含 `entries`（每节点的规则条目）、`customNodes`（用户自定义节点）、`globalNote`（全局补充说明）
- `WorldRuleEntry` 结构：`historicalAnchors`（真实锚点文本）、`fictionalAdaptations`（架空改造文本）、`priority`（冲突优先级：history-first / fiction-first / balanced）
- 三级树：15 个 L1 大类（时代背景、重大事件、地理疆域、气候环境、政治制度、军事、经济、社会结构、科技生产力、文化思想、宗教信仰、民族族群、语言称谓、日常生活、力量与超自然），每个 L1 包含 2-6 个 L2 子类，L3 为提示标签
- DB 升级到 v21，新增 `worldRulesProfiles` 表（每项目一条记录，singleton 模式）

**新增文件**：`src/lib/types/world-rules.ts`

#### 32.2 — Store（singleton 模式）

- Zustand store：`useWorldRulesStore`
- 方法：`loadProfile` / `getEntry` / `updateEntry` / `deleteEntry` / `updateGlobalNote` / `addCustomNode` / `updateCustomNode` / `deleteCustomNode` / `filledCount`
- `_persist` 内部方法自动同步到 IndexedDB

**新增文件**：`src/stores/world-rules.ts`

#### 32.3 — 规则清单生成器

- `buildWorldRulesManifest(profile, options)`：从所有 entries 生成结构化文本清单
  - 按 L1 分组，L2 缩进展示
  - 📜 真实锚点 + ✨ 架空改造 + ⚖️ 冲突优先级
  - 可选注入历史年表锚点（`⚓ 时间线锚定`）和历史关键词
  - 全局补充说明追加到末尾
  - 末尾添加 AI 行为约束指令
- `estimateManifestTokens(text)`：Token 估算（字符数 × 0.6）
- `buildWorldRulesContext(projectId)`：一站式读取 DB（profile + 历史年表 + 历史关键词）→ 生成清单，所有 AI prompt 统一调用此函数

**新增文件**：`src/lib/ai/world-rules-manifest.ts`

#### 32.4 — WorldRulesPanel UI

- 三栏布局：L1 导航列表（左）→ L2 子类列表（中）→ 编辑区（右）
- 编辑区包含：📜 真实锚点文本框 + ✨ 架空改造文本框 + ⚖️ 冲突优先级三选一
- L3 提示标签以灰色 tag 形式展示在编辑区
- 已填节点显示绿色圆点标记
- 底部「规则清单预览」：实时生成 manifest 文本 + Token 估算
- 全局补充说明编辑器
- 用户可新增 L1 大类和 L2 子类（自定义节点），支持删除

**新增文件**：`src/components/worldview/WorldRulesPanel.tsx`

#### 32.5 — 世界观三面板去除二选一 toggle

- **WorldviewOriginPanel**（世界起源）：
  - 删除 `creativeMode` 导入和状态管理
  - 合并 `FANTASY_FIELDS` / `HISTORICAL_FIELDS` 为统一 `FIELDS` 数组
  - 标签统一化（如「神明设定」+「宗教与民间信仰」→「神明与信仰」）
  - AI 生成注入 `worldRulesContext`
- **WorldviewNaturalPanel**（自然环境）：同上模式改造
- **WorldviewHumanityPanel**（人文环境）：同上模式改造
- **WorldviewPanel**（世界观总览/旧入口）：
  - 删除模式切换 UI 和 `handleModeChange`
  - 统一使用单一 `DIMENSIONS` 数组
  - AI 生成注入 `worldRulesContext`

**改动文件**：4 个 Panel 组件

#### 32.6 — 下游 prompt 全面改造

- **prompt-seeds.ts**（3 个 system prompt + 4 个 user template）：
  - 删除所有 `{{#if (eq creativeMode "historical")}}...{{else}}...{{/if}}` Handlebars 分支
  - 替换为统一的 `{{#if worldRulesContext}}` 约束注入块
  - `variables` 数组：移除 `creativeMode` / `historicalContext`，新增 `worldRulesContext`
- **outline-adapter.ts**：
  - `buildVolumeOutlinePrompt` / `buildChapterOutlinePrompt` 参数从 `historicalContext + creativeMode` 改为 `worldRulesContext`
- **batch-outline-runner.ts**：
  - `BatchOutlineOptions` 接口同步更新

**改动文件**：`prompt-seeds.ts`、`outline-adapter.ts`、`batch-outline-runner.ts`、`OutlinePanel.tsx`

#### 32.7 — 侧边栏 + 路由

- 侧边栏世界观子树第一项新增「⚖️ 真实与幻想」（使用 lucide-react 的 `Scale` 图标）
- `WorkspacePage` 注册 `world-rules` → `WorldRulesPanel`
- 项目加载时并行调用 `useWorldRulesStore.getState().loadProfile(pid)`

**改动文件**：`sidebar-tree.ts`、`WorkspacePage.tsx`

#### 32.8 — 历史年表锚点标识

- `HistoryPanel.tsx` 中的历史事件标签视觉升级：
  - `isHistorical: true` 的事件：标签从「史实」改为「⚓ 史实锚点」，新增「AI 不可违反」红色提示文字
  - `isHistorical: false` 的事件：标签从「虚构/架空」改为「✨ 虚构/架空」
- 与世界规则清单联动：`buildWorldRulesManifest` 自动读取 `isHistorical=true` 的年表事件作为时间线锚点

**改动文件**：`HistoryPanel.tsx`

#### 32.9 — 数据迁移（旧项目兼容）

- `world-rules.ts` store 的 `loadProfile` 方法：首次创建 profile 时自动检测 `project.creativeMode === 'historical'`
- 如果是旧的历史考证项目，自动填充 `globalNote` 迁移提示文字，引导用户在各维度中重新设定真实与架空规则
- 非历史项目不受影响（`globalNote` 为空）

**改动文件**：`world-rules.ts`

#### 32.10 — 编译验证

- `npx tsc --noEmit` 零错误
- `npm run build` 成功，主 bundle 2630 KB（较改造前 2643 KB 减小 13 KB，因删除了大量重复字段定义和模式切换代码）

---

**Phase 32 完整文件变更清单**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/types/world-rules.ts` |
| 新增 | `src/stores/world-rules.ts` |
| 新增 | `src/lib/ai/world-rules-manifest.ts` |
| 新增 | `src/components/worldview/WorldRulesPanel.tsx` |
| 修改 | `src/lib/db/schema.ts` — v21，新增 `worldRulesProfiles` 表 |
| 修改 | `src/lib/types/index.ts` |
| 修改 | `src/lib/types/project.ts` — deprecated `creativeMode` |
| 修改 | `src/lib/ai/context-builder.ts` |
| 修改 | `src/lib/ai/prompt-seeds.ts` — 3 个 system + 4 个 user template |
| 修改 | `src/lib/ai/adapters/outline-adapter.ts` |
| 修改 | `src/lib/ai/batch-outline-runner.ts` |
| 修改 | `src/components/worldview/WorldviewPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewOriginPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewNaturalPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewHumanityPanel.tsx` |
| 修改 | `src/components/outline/OutlinePanel.tsx` |
| 修改 | `src/components/history/HistoryPanel.tsx` |
| 修改 | `src/components/layout/sidebar-tree.ts` |
| 修改 | `src/pages/WorkspacePage.tsx` |
