# StoryForge 整改集成计划 v3

> 本文档由 Opus 4.7 审查并重写，目的是把"用户原始需求"、"项目现状"、"修改方案"三者对齐。
> 此前 Sonnet 4.6 的 v1/v2 规划与用户实际诉求存在偏差，本文档为最终执行依据。

**作者：Claude Opus 4.7**
**日期：2026-04-29**
**状态：待用户确认 → 启动 Phase 0**

---

## 第零章 用户决议（已确认）

| # | 议题 | 用户决议 |
|---|------|---------|
| 1 | 著作类型标签需联网搜索 | ✅ 必须重做，从起点/纵横/晋江抓最新分类 |
| 2 | 导入支持 Word/Excel/CSV | ✅ 必须支持 .docx / .xlsx / .csv（不只是 .txt/.md） |
| 3 | "细纲"是否保留 | ✅ 保留 |
| 4 | "章节" vs "正文"拆分 | ✅ 先做了再说 |
| 5 | 大纲/伏笔差异化设计 | ✅ 先做了再说 |
| 6 | 角色关系网（力导图） | ✅ 保留，目标形态是"知识图谱"风格 |
| 7 | 旧数据兼容 | ❌ 不考虑，开发阶段无旧用户，可清空重建 |
| 8 | 提示词自定义 | ✅ 核心特色功能，独立成章节，整体设计 |
| 9 | 创作区每个子模块都要 AI 按钮 | ✅ 强制要求 |
| 10 | 故事设计 7 字段 | ✅ 暂定 7 项 |

---

## 第一章 项目现状审计

### 1.1 当前导航结构（与目标完全不符）

```
现状（17 个并列项）
├─ 基本信息
├─ 世界观、故事核心、力量体系
├─ 角色、角色关系、势力
├─ 地理环境、历史年表、道具系统
├─ 创作规则
├─ 大纲、写作（编辑器）、伏笔
├─ 版本历史、导出、设置
```

**问题**：所有功能平铺，没有逻辑分组，无层级。

### 1.2 当前数据模型（IndexedDB / Dexie）

| 表名 | 用途 | 状态 |
|------|------|------|
| `projects` | 项目元数据 | ⚠️ 字段不足（缺多选类型、状态、连续撰写天数） |
| `worldviews` | 世界观（geography/history/society/culture/economy/rules） | ⚠️ 字段映射不上"世界起源/自然环境/人文环境"三块 |
| `storyCores` | 故事核心（4 字段） | ⚠️ 缺一句话故事/概念/复线 3 字段 |
| `powerSystems` | 力量体系 | ⚠️ 应并入"世界起源" |
| `characters` | 角色（4 种 role） | ⚠️ 缺 npc/extra 两级，路人字段不全 |
| `factions` | 势力 | ⚠️ 应并入"人文环境" |
| `outlineNodes` | 大纲节点（卷/弧/章） | ✅ 可保留 |
| `chapters` | 章节正文 | ✅ 可保留 |
| `foreshadows` | 伏笔 | ✅ 可保留 |
| `geographies` | 地理 | ⚠️ 应并入"自然环境" |
| `histories` | 历史 | ⚠️ 应并入"人文环境" |
| `itemSystems` | 道具 | ⚠️ 应并入"人文环境/道具设计" |
| `creativeRules` | 创作规则 | ⚠️ 字段名需重组（toneAndMood 改名故事氛围等） |
| `characterRelations` | 角色关系 | ✅ 保留 |
| `snapshots` | 版本快照 | ✅ 保留 |
| `references` | 参考书目（v5 新加） | ⚠️ 应改为属于创作规则的子数据 |

### 1.3 当前 AI 提示词系统现状（重要！独立分析）

#### 现状架构

```
src/lib/ai/
  ├─ client.ts           OpenAI 兼容协议的流式调用
  ├─ context-builder.ts  从已有数据拼接 AI 上下文
  └─ prompts/            ← 提示词全部硬编码在这里
      ├─ chapter.ts      "网文老贼级别的写手"
      ├─ character.ts    "角色设计大师"
      ├─ foreshadow.ts   ...
      ├─ geography.ts    ...
      ├─ outline.ts      "经验丰富的小说大纲师"
      └─ worldview.ts    "资深的奇幻/科幻世界设计师"
```

**每个文件的结构**：
```typescript
const SYSTEM_PROMPT = `你是一位...
[硬编码的系统提示词]`

export function buildXxxPrompt(...args): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[硬编码的用户提示词模板] + 参数拼接` }
  ]
}
```

#### 现状的根本问题

1. ❌ **完全硬编码**——用户想换风格只能改源代码
2. ❌ **不可观察**——用户根本不知道 AI 收到了什么
3. ❌ **不可调试**——AI 生成不满意，用户没有任何调整手段
4. ❌ **不可分享**——好的提示词没法导出给社区
5. ❌ **不可版本管理**——改了想恢复改不回来

#### 这个就是用户说的「核心特色功能」需要重做的部分

详见 **第三章：AI 提示词系统重设计方案**。

### 1.4 当前 UI 风格审计

经预览验证（截图见上一轮对话）：
- ✅ 设计 Token 已建立（work/forge/paper 三主题）
- ✅ HomePage 用了 forge 主题（深棕 + 火焰）
- ⚠️ 但项目内的 Sidebar 仍是 Sonnet v1 写的"扁平 17 项 + 折叠分组"实现，未严格按 4 大区设计
- ⚠️ 各 Panel 的 UI 风格不统一，emoji 滥用、间距不规范、卡片风格混乱

---

## 第二章 目标蓝图（已确认版）

### 2.1 导航三级结构

```
著作信息
  └─ 当前著作信息

设定库
  ├─ 世界观（含 AI 一键创建按钮）
  │   ├─ 世界起源
  │   │   ├─ 世界来源
  │   │   ├─ 力量层次
  │   │   └─ 是否有神明 + 神明设定
  │   ├─ 自然环境设计
  │   │   ├─ 世界结构（星球/大陆/多重天等）
  │   │   ├─ 世界尺寸（长 × 宽）
  │   │   ├─ 大陆分布
  │   │   ├─ 区域面积（长 × 宽）
  │   │   ├─ 山川河流
  │   │   ├─ 分区域气候
  │   │   └─ 自然资源（珍禽/异兽/矿石/灵药）
  │   └─ 人文环境设计
  │       ├─ 世界历史线
  │       ├─ 世界大事记
  │       ├─ 种族设定
  │       ├─ 势力分布
  │       ├─ 政治/经济/文化设计
  │       ├─ 矛盾冲突设计（社会内在 / 个体与外在）
  │       └─ 道具设计（武器/灵药等）
  ├─ 故事设计
  │   ├─ 一句话故事
  │   ├─ 故事概念
  │   ├─ 故事主题
  │   ├─ 核心冲突
  │   ├─ 故事模式（线性/莲花地图/多线并行/蒙太奇）
  │   ├─ 故事主线
  │   └─ 故事复线
  └─ 角色设计
      ├─ 主要角色（大卡片 + 全字段）
      ├─ 次要角色（小卡片 + 简要）
      ├─ NPC（紧凑列表）
      ├─ 路人（表格行：姓名/出场时间/章节/作用/结局）
      └─ 角色关系网（知识图谱视图）

创作区
  ├─ 创作规则（AI 按钮）
  ├─ 大纲（AI 按钮）
  ├─ 细纲（AI 按钮）
  ├─ 章节（AI 按钮）
  ├─ 正文（AI 按钮）
  └─ 伏笔（AI 按钮）

设置区
  ├─ 版本历史
  ├─ 导入（AI 解析 .docx/.xlsx/.csv/.md/.txt）
  ├─ 导出
  └─ 设置（AI 配置 + 提示词管理）
```

### 2.2 当前著作信息字段

| 字段 | 类型 | 说明 |
|------|------|------|
| 著作名称 | input | 必填 |
| 著作类型 | tag-multi-select | 联网获取的标签 + "其他" 自定义 |
| 著作简介 | textarea | placeholder：「试着用简单的一句话描述你的故事」 |
| 目标字数 | slider | 0 ~ 500 万字 |
| **底部状态栏** | 自动 | 创建于 / 已连续撰写 X 天/月/年 / 最近更新 |

---

## 第三章 AI 提示词系统重设计（独立章节）

### 3.1 设计目标

| # | 目标 | 用户价值 |
|---|------|---------|
| 1 | 提示词与代码分离 | 改风格不用碰代码 |
| 2 | 提示词可视化编辑 | 在 UI 里看到、改、保存 |
| 3 | 提示词版本管理 | 改坏了能回滚 |
| 4 | 提示词模板市场（预设 + 自定义） | 玄幻/言情/硬科幻多套预设可切换 |
| 5 | 提示词导入/导出（JSON） | 社区可分享 |
| 6 | 模板变量系统 | `{{projectName}}` `{{worldContext}}` 等占位符 |
| 7 | 实时预览 | 编辑时显示最终拼出来的提示词 |
| 8 | 模型参数随提示词附带 | temperature/maxTokens 也存在模板里 |

### 3.2 数据结构

```typescript
// 提示词模板表（新表）
interface PromptTemplate {
  id?: number
  scope: 'system' | 'user'        // 内置 vs 用户自建
  moduleKey: PromptModuleKey      // 见下
  promptType: string              // 'generate' | 'dimension' | 'import' 等
  name: string                    // 用户可见的名字，如「玄幻爽文风格-世界观生成」
  description: string             // 说明
  systemPrompt: string            // system role 内容
  userPromptTemplate: string      // 含 {{var}} 占位符
  variables: string[]             // ['projectName', 'worldContext', ...]
  modelOverride?: {               // 可选覆盖默认模型参数
    temperature?: number
    maxTokens?: number
  }
  parentId?: number               // 克隆来源（用于版本谱系）
  isActive: boolean               // 是否当前使用此模板
  createdAt: number
  updatedAt: number
}

type PromptModuleKey =
  | 'worldview.generate'        // 世界观一键生成
  | 'worldview.dimension'       // 世界观单维度生成
  | 'story.generate'            // 故事设计生成
  | 'character.generate'        // 角色批量生成
  | 'character.dimension'       // 角色单维度补全
  | 'rules.generate'            // 创作规则生成
  | 'outline.volume'            // 卷级大纲
  | 'outline.chapter'           // 章节大纲
  | 'detail.scene'              // 细纲场景生成
  | 'chapter.content'           // 正文生成
  | 'chapter.continue'          // 正文续写
  | 'foreshadow.generate'       // 伏笔生成
  | 'import.parse-character'    // 导入解析-角色
  | 'import.parse-worldview'    // 导入解析-世界观
  | 'import.parse-outline'      // 导入解析-大纲
```

### 3.3 调用流程重构

**改造前**：
```
模块 Panel → 直接 import 硬编码 buildXxxPrompt()
          → 拼装 messages → streamChat()
```

**改造后**：
```
模块 Panel → usePromptStore().get('worldview.generate')
          → 用变量字典渲染模板
          → streamChat()（参数从模板覆盖项取）
```

### 3.4 用户界面（在「设置」下新增「提示词管理」Tab）

```
┌─ 提示词管理 ─────────────────────────────────┐
│                                              │
│  按模块筛选： [世界观 ▾] [故事设计] [角色] ...  │
│  作用域： ●全部 ○系统内置 ○我的                │
│  [+ 新建模板]  [导入 JSON]  [导出全部]         │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ ★ 玄幻爽文-世界观生成 (系统)             │  │
│  │   3 个变量 · DeepSeek · temp 0.8         │  │
│  │   [查看] [克隆为我的]                     │  │
│  ├────────────────────────────────────────┤  │
│  │ ✓ 我的-硬科幻世界观 (启用中)              │  │
│  │   克隆自「硬科幻-世界观生成」              │  │
│  │   [编辑] [复制] [导出] [删除]             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  详情面板（点击模板后展开）：                  │
│  ┌──────────┬──────────────────────────────┐ │
│  │ 编辑     │ 实时预览                      │ │
│  │          │                              │ │
│  │ System:  │ === System ===               │ │
│  │ [textarea]│ 你是一位资深...             │ │
│  │          │                              │ │
│  │ User模板:│ === User ===                 │ │
│  │ [textarea]│ 小说名称：（projectName 示例）│ │
│  │          │ 已有世界观：（worldContext 示例）│ │
│  │          │                              │ │
│  │ 变量列表:│ 模型参数：temp 0.8, max 2048 │ │
│  │ • {{name}}│                            │ │
│  └──────────┴──────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 3.5 变量系统

固定变量字典，每个模块支持哪些变量在 `PromptModuleKey` 定义中声明：

| 变量 | 语义 | 模块 |
|------|------|------|
| `{{projectName}}` | 项目名 | 全部 |
| `{{genres}}` | 类型标签拼接 | 全部 |
| `{{description}}` | 项目简介 | 全部 |
| `{{worldOrigin}}` | 世界起源（已填部分） | worldview.* / story.* / character.* / outline.* |
| `{{naturalEnv}}` | 自然环境 | worldview.* 之外 |
| `{{humanityEnv}}` | 人文环境 | worldview.* 之外 |
| `{{storyCore}}` | 故事核心摘要 | story.* / outline.* / chapter.* |
| `{{characters}}` | 已有角色列表 | character.* / outline.* / chapter.* |
| `{{rules}}` | 创作规则摘要 | outline.* / chapter.* |
| `{{userHint}}` | 用户当前补充输入 | 全部 |
| `{{previousContent}}` | 前置章节末尾（续写时） | chapter.continue |
| `{{rawDocument}}` | 用户上传的文档原文 | import.* |

### 3.6 兼容现有提示词

迁移策略：
1. 把 `src/lib/ai/prompts/*.ts` 里的 `SYSTEM_PROMPT` 和 user 模板字符串**逐字搬到**数据库种子数据
2. 把现有的 `build*Prompt` 函数改成"通过 promptStore 渲染模板"的形式
3. 现有调用方完全不需要改（API 兼容）

---

### 3.7 提示词工作流（借鉴蛙蛙写作）

#### 设计动机

单个提示词解决单个任务（写一章 / 设计一个角色），但用户真实的创作流程是**链式**的：

> 想法 → 故事核心 → 世界观 → 卷大纲 → 章节大纲 → 章节正文 → 润色

每一步的产出是下一步的输入。蛙蛙写作的核心差异化就是这种"工作流"，用户点一下「跑这条流水线」，AI 自动连续生成全部环节，中间允许用户审核确认。

#### 数据结构

```typescript
interface PromptWorkflow {
  id?: number
  scope: 'system' | 'user'
  name: string                          // "玄幻爽文-从零到第一章"
  description: string                   // "依次生成世界观、故事核心、卷大纲、第一章正文"
  genres?: string[]                     // 适用题材标签
  steps: PromptWorkflowStep[]
  createdAt: number
  updatedAt: number
}

interface PromptWorkflowStep {
  promptModuleKey: PromptModuleKey      // 用哪个提示词模板
  templateId?: number                   // 指定具体模板版本（不指定则用激活的）
  inputMapping?: Record<string, string> // 上一步输出 → 本步变量
                                        // 比如 { "previousOutput": "worldContext" }
  userConfirmRequired?: boolean         // 这步执行前/后是否暂停让用户确认
  label: string                         // 用户可见的步骤名
}
```

#### 内置工作流（种子数据）

至少预置 6 条系统级工作流：

| 工作流 | 步骤 | 适用题材 |
|--------|------|---------|
| 极速起书（玄幻） | 故事核心 → 世界观 → 主要角色×3 → 卷大纲 → 第一章正文 | 玄幻 |
| 极速起书（言情） | 故事核心 → 双主角 → 关系网 → 卷大纲 → 第一章正文 | 言情 |
| 极速起书（科幻） | 世界观 → 故事核心 → 主角 → 卷大纲 → 第一章正文 | 科幻 |
| 单章深度生成 | 章节大纲 → 细纲 → 正文 → 润色 → 去 AI 味 | 通用 |
| 伏笔体系搭建 | 世界观 → 主要角色 → 伏笔生成 → 大纲调整 | 通用 |
| 设定补全 | 现有世界观 → 自动补充未填字段 → 角色补全 | 通用 |

#### UI

「设置 → 提示词管理」下加第三个 Tab：「工作流」。

```
┌─ 工作流 ────────────────────────────────────────┐
│  [+ 新建工作流]   [导入]                          │
│                                                  │
│  ┌─ 极速起书（玄幻）── 系统 ──────┐               │
│  │  5 步 · 估时 3-5 分钟           │               │
│  │  [运行] [查看] [克隆为我的]       │               │
│  └────────────────────────────────┘               │
│                                                  │
│  详情视图（点击查看）：                            │
│  ┌──────────────────────────────────────────┐    │
│  │ 1. 故事核心生成 → 输出存为 storyCore       │    │
│  │ 2. 世界观生成 ← 输入 storyCore             │    │
│  │ 3. 主要角色×3 ← 输入 worldview            │    │
│  │ 4. 卷大纲 ← 输入 worldview + storyCore    │    │
│  │ 5. 第一章正文 ← 输入 上述全部              │    │
│  │   [⏸] 此步前暂停让用户确认                  │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

#### 运行界面

工作流执行时显示流式进度：
- 当前步骤高亮
- 每步完成后显示生成结果，用户可「✏️ 修改后继续」或「↻ 重生成」
- 整体可中止
- 全部完成后一键写入对应模块

---

### 3.8 题材模板包

#### 设计动机

提示词的"通用版"质量永远是 60 分。要做到 90 分必须**针对题材精调**。

> 同一个"世界观生成"任务，玄幻要求"功法体系自洽 + 等级森严"；言情要求"情感张力 + 都市/古代背景细节"；硬科幻要求"科学合理性 + 技术外推"。
>
> 用一套通用模板生成出来的玄幻世界观和言情世界观会同质化，丧失题材特色。

#### 实现方式

**`PromptTemplate` 表加 `genres?: string[]` 字段**：

```typescript
interface PromptTemplate {
  // ... 原有字段
  genres?: string[]   // 适用题材，如 ['xuanhuan', 'xianxia']
                      // 空数组或缺失 = 通用模板
}
```

**模板包概念**：把同一题材下的全套模板（世界观 + 故事 + 角色 + 大纲 + 章节 + 伏笔 + 创作规则 + 工作流）打包为一个"题材包"。

#### 内置题材包（首批至少 5 套）

| 题材包 | 包含模板数 | 风格关键词 |
|--------|-----------|-----------|
| 通用包 | 14 个基础模板 | 中性，60 分基线 |
| 玄幻爽文包 | 14 个 + 6 条工作流 | 等级森严、装逼打脸、屌丝逆袭 |
| 仙侠修真包 | 14 个 + 4 条工作流 | 飞升体系、人间道义、正邪较量 |
| 言情包 | 14 个 + 5 条工作流 | 情感细腻、CP 张力、心理描写 |
| 硬科幻包 | 14 个 + 3 条工作流 | 科学合理、技术外推、人类命运 |

#### UI 切换

在「设置 → 提示词管理」顶部加一个**当前激活包**的选择器：

```
┌─ 提示词管理 ─────────────────────────────────┐
│  当前题材包：[玄幻爽文 ▾]                        │
│  └─ 切换后，世界观/角色/章节等所有模块的         │
│     默认激活模板都会切换到这套包内的对应模板      │
│                                              │
│  [模板列表] [工作流] [包管理]                    │
└──────────────────────────────────────────────┘
```

#### 包导入/导出

- 单个包导出 JSON：包含所有模板 + 工作流 + 元数据
- 社区可分享：用户下载一个 JSON 文件即可获得"某大佬调好的玄幻爽文包"
- 导入时检测冲突（同 moduleKey 多版本），提示用户合并/覆盖/保留双份

---

### 3.9 与提示词系统配套的其他长期任务（备忘）

以下功能列入备忘录但不在 v1 开发范围：
- 提示词 A/B 测试（同一任务两个模板对比输出，让用户挑）
- 提示词社区市场（在线分享/评分/下载，需要后端，远期）
- 提示词使用统计（哪些模板被用得最多、哪些被克隆最多）
- AI 自动调优提示词（让 AI 根据用户反馈逐步优化模板，远期）

---

## 第四章 现状 → 目标 GAP 表

### 4.1 模块映射表（一张总览）

| 目标模块 | 现有对应 | 改动类型 |
|---------|---------|---------|
| 当前著作信息 | ProjectInfoPanel + 部分 stores/project | 🔧 重构（字段扩展、状态栏新增） |
| 世界观 - 世界起源 | Worldview.history?+rules? + PowerSystem | 🆕 新结构，迁移现有内容 |
| 世界观 - 自然环境 | Worldview.geography + Geography 表 | 🆕 新结构，14 个新字段 |
| 世界观 - 人文环境 | Worldview.history/society/culture/economy + History + ItemSystem + Faction | 🆕 大重组 |
| AI 一键创建世界观 | 无 | 🆕 全新 |
| 故事设计（7 字段） | StoryCore（4 字段） | 🔧 字段扩展 |
| 主要/次要/NPC/路人 | Character.role 4 值 | 🔧 角色 role 扩 6 值，字段分级 |
| 角色关系网（知识图谱） | CharacterRelationPanel | 🔧 增强（节点分组、关系强度可视化） |
| 创作规则（重组） | CreativeRulesPanel | 🔧 字段重命名 + 添加参考作品分类 |
| 大纲（差异化） | OutlinePanel | 🔧 加 AI 按钮 + 一句话约束 |
| 细纲 | 无 | 🆕 全新表 |
| 章节（列表管理） | 部分功能在 OutlinePanel 里 | 🆕 拆分 |
| 正文（编辑器） | ChapterEditor | ✅ 保留 |
| 伏笔（时间线视图） | ForeshadowPanel | 🔧 加时间线可视化 |
| 版本历史 | VersionHistoryPanel | ✅ 保留 |
| 导入（AI 解析多格式） | 无 | 🆕 大功能 |
| 导出（去 gist） | ExportPanel | 🔧 删 gist 部分 |
| 设置-AI 配置 | AIConfigPanel | ✅ 保留 |
| 设置-提示词管理 | 无 | 🆕 大功能 |
| **全局提示词系统** | 硬编码 6 个文件 | 🆕 全新基础设施 |

### 4.2 数据模型迁移表

| 旧表 | 新表 / 新字段 | 处理 |
|------|--------------|------|
| `projects` | 加 `genres[]` `status` `coverImage` `customGenre` | 删除现有数据，重建 |
| `worldviews` | 字段大改，参见 Phase 3 | 删除重建 |
| `storyCores` | 加 `logline` `concept` `subPlots` | 删除重建 |
| `powerSystems` | → `worldviews.powerHierarchy` | 数据并入 |
| `geographies` | → `worldviews.naturalEnv*` 多字段 | 数据并入 |
| `histories` | → `worldviews.historyLine` + `worldEvents` | 数据并入 |
| `itemSystems` | → `worldviews.itemDesign` | 数据并入 |
| `factions` | → `worldviews.factions` (JSON) | 数据并入 |
| `characters` | role 增加 npc/extra；新增 location/firstAppearance/storyRole/ending | 加字段 |
| `outlineNodes` | 不变 | ✅ |
| `chapters` | 不变 | ✅ |
| `foreshadows` | 加 `timelinePosition` 字段（用于时间线视图） | 加字段 |
| `creativeRules` | 重命名字段：`toneAndMood`→`atmosphere`；新增 `referenceWorks: ReferenceWork[]` | 改字段 |
| `characterRelations` | 不变 | ✅ |
| `snapshots` | 不变 | ✅ |
| `references` | 删除（合并入 `creativeRules.referenceWorks`） | 删表 |
| **新增 `detailedOutlines`** | 细纲表 | 🆕 |
| **新增 `promptTemplates`** | 提示词模板表 | 🆕 |
| **新增 `importJobs`** | AI 导入任务记录 | 🆕 |

由于"开发阶段无旧用户"，可以直接 **删库重建**：bump Dexie 版本号到 v6 并清空所有表，等于全新启动。

---

## 第五章 整改路线图

### 总览

| Phase | 名称 | 工作量估计 | 是否可独立交付 |
|-------|------|-----------|--------------|
| Phase 0 | 准备：联网抓类型 + 清空 DB + 文档定稿 | 0.5d | ✅ |
| Phase 1 | 提示词基础设施（数据层 + 渲染引擎） | 2d | ❌ 必须 P2 一起 |
| Phase 2 | 提示词管理 UI（设置页新 Tab） | 1.5d | ✅ |
| Phase 3 | 数据模型重建（Dexie v6） | 1d | ❌ 必须 P4 一起 |
| Phase 4 | 导航与路由重建（Sidebar 三级） | 1d | ✅ |
| Phase 5 | 著作信息面板（含状态栏） | 0.5d | ✅ |
| Phase 6 | 世界观大面板（三块 + AI） | 2.5d | ✅ |
| Phase 7 | 故事设计、角色设计（含分级显示、关系图增强） | 2.5d | ✅ |
| Phase 8 | 创作规则、大纲、细纲、章节、伏笔（六模块整改 + AI 按钮） | 3d | ✅ |
| Phase 9 | 设置区 + 概念地图（程序化生成 + AI 视觉解析） | 5.5d | ✅ |
| Phase 10 | 导入功能：.docx / .xlsx / .csv / 文本 解析 + AI 分类 | 2.5d | ✅ |
| Phase 11 | UI 风格统一、走查、修复 | 1d | ✅ |

**预估总工作量**：约 23 工作日（含概念地图升级；连续推进，单 Claude Code 串行；并行多任务可压缩）。

---

## 第六章 各 Phase 详细任务

### Phase 0：准备工作（前置，不写代码）

#### 0.1 联网抓取类型标签
- 用 WebFetch 抓 起点中文网、纵横中文网、晋江文学城 的分类页
- 整理为四个数据数组：男频玄幻仙侠武侠、男频科幻奇幻都市、女频言情古言现言、其他类
- 输出文件：`src/lib/data/genre-presets.ts`
- 字段：`{ value, label, group, gender? }`

#### 0.2 清空数据库
- 用户在浏览器里执行 `indexedDB.deleteDatabase('storyforge')`
- 或代码层 bump Dexie 版本到 v6 并 drop 所有旧表

#### 0.3 文档定稿
- 把本文档（09-REDESIGN-INTEGRATION-PLAN.md）作为"唯一真相"
- 旧的 01~08 文档保留作历史参考，但开发以本文档为准
- **更新 memory/storyforge_backlog.md** 把所有项目重新对齐

#### 验收
- ✅ `genre-presets.ts` 文件存在，含 50+ 个分类标签
- ✅ 浏览器 storyforge DB 不存在或已重建为 v6 空库
- ✅ 备忘录文件已更新

---

### Phase 1：提示词基础设施

#### 1.1 数据层

**新增类型** `src/lib/types/prompt.ts`：
```typescript
export interface PromptTemplate { ... } // 见第三章
export type PromptModuleKey = '...'      // 见第三章
export interface PromptVariableContext {
  projectName?: string
  genres?: string
  worldOrigin?: string
  // ...
}
```

**新增 store** `src/stores/prompt.ts`：
- `loadTemplates()`
- `getActive(moduleKey)` → 拿当前激活的模板
- `saveTemplate(t)`
- `cloneTemplate(id)`
- `setActive(id)`
- `seedSystemTemplates()` ← 启动时若 DB 为空，注入内置模板

**新增渲染引擎** `src/lib/ai/prompt-engine.ts`：
```typescript
export function renderPrompt(
  template: PromptTemplate,
  ctx: PromptVariableContext
): { messages: ChatMessage[], modelOverride?: { temperature, maxTokens } }
```
- 支持 `{{var}}` 替换
- 支持 `{{#if hasX}}...{{/if}}` 简单条件块（轻量）
- 缺失变量自动跳过（不报错，但 console.warn）

#### 1.2 内置提示词种子数据

把现有 6 个 `src/lib/ai/prompts/*.ts` 的内容**逐字**搬到 `src/lib/ai/seeds/system-templates.ts`，作为系统内置模板的初始数据。

- worldview.dimension（迁自 worldview.ts）
- character.generate / character.dimension（迁自 character.ts）
- outline.volume / outline.chapter（迁自 outline.ts）
- chapter.content / chapter.continue（迁自 chapter.ts）
- foreshadow.generate（迁自 foreshadow.ts）
- worldview.generate（新增，世界观一键生成的全新模板）
- story.generate（新增）
- rules.generate（新增）
- detail.scene（新增）
- import.parse-character / parse-worldview / parse-outline（新增）

每条种子都标记 `scope: 'system'`，用户不可删，可克隆。

#### 1.3 改造现有 Panel 调用

把 `WorldviewPanel`、`CharacterPanel`、`ChapterEditor` 等里直接调用 `buildXxxPrompt()` 的地方改为：
```typescript
const tpl = usePromptStore.getState().getActive('worldview.dimension')
const { messages, modelOverride } = renderPrompt(tpl, ctx)
ai.start(messages, modelOverride)
```

#### 1.4 删除旧文件

完成迁移后，**删除** `src/lib/ai/prompts/` 整个目录。

#### 1.5 适配器层保护现有调用方（关键！）

**目的**：保护现有 6 个 Panel 的 `import { buildXxxPrompt } from '../../lib/ai/prompts/xxx'` 调用一行不改。

**做法**：在删除旧 prompts 目录之前，新建 `src/lib/ai/prompt-adapter.ts`，**保留同名函数**，但内部改为从模板渲染：

```typescript
// 旧调用方完全不需要改
import { buildWorldviewPrompt } from '../../lib/ai/prompt-adapter'

// 适配器内部
export function buildWorldviewPrompt(dim, name, genre, ctx, hint) {
  const tpl = usePromptStore.getState().getActive('worldview.dimension')
  return renderPrompt(tpl, { dimension: dim, projectName: name, genres: genre, worldContext: ctx, userHint: hint })
}
```

**收益**：链 1/2/3/5/7/8 全部受益，调用方零改动。

#### 验收
- ✅ Dexie schema 多了 `promptTemplates` 表
- ✅ App 启动时自动 seed 14+ 条系统模板
- ✅ 现有 AI 功能（世界观/角色/大纲/章节/伏笔生成）从模板渲染，行为不变
- ✅ 无任何硬编码提示词残留

---

### Phase 2：提示词管理 UI

#### 2.1 路由
- 在「设置」下加二级 Tab：`AI 配置` / `提示词管理`

#### 2.2 模板列表组件 `PromptManagerPanel`
- 顶部筛选栏（模块、作用域）
- 列表显示模板卡片（名称、模块、作用域徽章、操作按钮）
- 点击展开「详情面板」（左编辑右预览的双栏）

#### 2.3 模板编辑器
- System Prompt textarea
- User Prompt Template textarea
- 变量提示（点击插入 `{{varName}}`）
- 模型参数 override（temp、maxTokens 滑块）
- 变量示例数据（可填测试值）
- 实时预览区（右侧，渲染后的最终 messages）

#### 2.4 导入导出
- 单模板导出 JSON
- 全部用户模板批量导出 JSON
- JSON 导入（带冲突检测）

#### 验收
- ✅ 用户可在 UI 里查看所有内置模板
- ✅ 用户可克隆为自己的模板，修改后保存
- ✅ 用户可切换某个模块的当前激活模板
- ✅ 实时预览显示拼出来的最终提示词

---

### Phase 3：数据模型重建（Dexie v6）

#### 3.1 修改 `src/lib/db/schema.ts`
- bump 到 `version(6)`
- **删除**这些表：`powerSystems`、`geographies`、`histories`、`itemSystems`、`factions`、`references`
- **新增**这些表：`detailedOutlines`、`promptTemplates`、`importJobs`
- **修改**这些表的索引（删除 `references` 表）

#### 3.2 类型变更
按第四章 4.2 的迁移表，逐文件修改：
- `src/lib/types/project.ts`：加 `genres`、`status`、`customGenre`
- `src/lib/types/worldview.ts`：大改，加世界起源/自然环境/人文环境字段
- `src/lib/types/character.ts`：role 加 `npc` `extra`，加路人字段
- `src/lib/types/creative-rules.ts`：字段重命名 + `referenceWorks` 改为对象数组
- `src/lib/types/foreshadow.ts`：加 `timelinePosition`
- 删除 `src/lib/types/reference.ts`、`geography.ts`、`history.ts`、`item-system.ts`
- 新增 `src/lib/types/detailed-outline.ts`、`prompt.ts`、`import.ts`

#### 3.3 删除对应的 store
- 删除 `stores/geography.ts`、`history.ts`、`item-system.ts`、`reference.ts`、（power-system 如果是独立的也删）
- 整合后世界观相关数据全部走 `stores/worldview.ts`

#### 3.4 重写 `context-builder.ts`（链 2/3/5/8 命脉）

**重要**：旧函数签名 `buildWorldContext(worldview, storyCore, powerSystem)` 在 4 处被调用：
- `CharacterPanel`、`OutlinePanel`、`ChapterEditor`、`ForeshadowPanel`

**新签名**：去掉 powerSystem 参数（数据已并入 worldview）：
```typescript
// 旧
export function buildWorldContext(wv, sc, ps): string

// 新
export function buildWorldContext(wv: Worldview, sc: StoryCore): string {
  // 内部从 wv.powerHierarchy 取力量体系
  // 从 wv.naturalEnv* 取地理
  // 从 wv.historyLine 取历史
  // 等等
}
```

**4 处调用点同步修改**：删除第三参数 `powerSystem` 即可。

#### 3.5 级联删除规则（隐藏依赖 A/B/C）

在 `stores/project.ts` 的 `deleteProject` 之外，新增三处级联：

| 删除动作 | 级联对象 | 实现位置 |
|---------|---------|---------|
| 删除角色 | 删除该角色相关的所有 `characterRelations`（fromCharacterId 或 toCharacterId 命中） | `stores/character.ts` |
| 删除大纲节点（chapter 类型） | 删除该节点关联的 `chapters` 行 | `stores/outline.ts` |
| 删除章节 | 把 `foreshadows` 表中所有 `plantChapterId / resolveChapterId === chapterId` 置为 null；从 `echoChapterIds` 数组里移除 | `stores/chapter.ts` |

每个级联都用 Dexie transaction 保证原子性。

#### 3.6 同步更新快照 / 导出 / 导入代码（链 10）

**关键**：以下三处写死了表名清单，必须同步：
1. `useBackupStore.createSnapshot()` 序列化所有表
2. `lib/export/json-export.ts` 的 `exportProjectJSON()`
3. `lib/export/json-export.ts` 的 `importProjectJSON()`

新表清单：
- 删除：`powerSystems / geographies / histories / itemSystems / factions / references`
- 新增：`detailedOutlines / promptTemplates / promptWorkflows / importJobs`

每处都要按新表清单全面修改。

#### 验收
- ✅ `npm run build` 通过
- ✅ App 启动后 IndexedDB 能正确创建 v6 schema
- ✅ context-builder 的 4 处调用方都能正常运行（手动触发各 AI 生成功能）
- ✅ 删除角色后该角色的关系条目自动消失
- ✅ 删除章节后伏笔的关联字段自动清理
- ✅ 创建/恢复快照、JSON 导入导出都包含全部新表

---

### Phase 4：导航与路由重建

#### 4.1 重写 `src/components/layout/Sidebar.tsx`
- 严格按第二章 2.1 的三级结构
- 二级菜单可折叠
- 三级菜单显示在二级展开后（不再是 sidebar 上的项，而是 panel 内部 Tab 或 Section）
- 删除"地理环境/历史年表/道具系统/势力/力量体系/参考书目"等旧二级项

#### 4.2 重写 `src/pages/WorkspacePage.tsx` 路由
- 统一用 `activeModule` 字符串匹配
- 三级菜单状态由对应 Panel 内部维护

#### 4.3 删除孤儿组件
- 删除 `src/components/geography/`、`history/`、`items/`、`faction/`、`project/ReferencePanel.tsx`
- 删除 `src/components/data/DataManagementPanel.tsx`（Phase 9 重做）

#### 验收
- ✅ Sidebar 显示 4 大区，二级 13 项左右
- ✅ 点击每个二级项能进入对应 Panel（即使 Panel 还没重写，至少要不报错）
- ✅ 不存在导航不到的"幽灵模块"

---

### Phase 5：著作信息面板

#### 5.1 重写 `ProjectInfoPanel.tsx`
- 顶部书名（大号 input）
- 类型多选标签（用 Phase 0 抓的数据，按 group 折叠展开）
- 简介 textarea（指定 placeholder）
- 目标字数 slider（0-500 万）

#### 5.2 状态栏组件
- `useProjectStats(projectId)` Hook：
  - 创建时间
  - 已连续撰写天数（统计 chapters 表里有 updatedAt 的不同日期数量）
  - 最近更新时间
- 显示在 Panel 底部，固定栏样式

#### 5.3 HomePage 创建项目对话框对应更新
- 多选类型 + 自定义"其他"
- 简介 placeholder 一致

#### 验收
- ✅ 类型标签为多选，能选多个
- ✅ "其他"勾选时弹出自定义输入
- ✅ 状态栏正确显示三项数据

---

### Phase 6：世界观大面板

#### 6.1 `WorldviewPanel` 重构为三个区块
- 顶部固定：「AI 一键创建世界观」大按钮（占位，禁用，tooltip "即将推出"）
  - 实际上 Phase 1 的提示词系统已就位，按钮可启用——一次性生成三块全部内容
- 三个折叠区块：世界起源 / 自然环境 / 人文环境

#### 6.2 每个区块内
- 区块顶部「AI 生成本区块」按钮
- 各字段单独的 textarea / input / select
- 每个长文本字段右上角小「✨」AI 按钮（生成单字段）

#### 6.3 细节字段实现
- "世界结构"是 select：星球 / 大陆 / 多重天 / 平行宇宙 / 自定义
- "世界尺寸""区域面积"是双数字输入（长 × 宽）+ 单位
- "世界大事记"是动态条目列表（时间 + 事件）
- "种族设定"是动态条目列表（名字 + 描述）
- "势力分布"是动态条目列表（势力名 + 描述 + 关系）

#### 验收
- ✅ 三区块所有字段都能输入和保存
- ✅ AI 按钮触发后正确显示流式输出
- ✅ 旧的 PowerSystem/Geography/History/ItemSystem/Faction 内容不再可见

---

### Phase 7：故事设计、角色设计、关系图

#### 7.1 `StoryCorePanel` 改为「故事设计」
- 7 个字段（一句话故事、概念、主题、核心冲突、故事模式、主线、复线）
- 顶部「AI 生成故事设计」按钮
- "故事模式"是 select：线性 / 莲花地图 / 多线并行 / 蒙太奇 / 自定义

#### 7.2 `CharacterPanel` 改为分级
- 顶部 Tab：主要 / 次要 / NPC / 路人 / 关系图
- 主要：现有大卡片 + 全字段
- 次要：缩小卡片
- NPC：紧凑列表
- 路人：表格视图（5 列）
- 关系图：嵌入现有 RelationGraph

#### 7.3 `RelationGraph` 增强（知识图谱风格）
- 节点按角色定位上色（主/反/配/NPC）
- 关系边按类型上色 + 文字标签
- 节点大小按"关系连接数"映射（中心人物自然变大）
- 鼠标 hover 节点：高亮所有相关边和邻居
- 点击节点：弹出小卡片显示角色详情
- 提供布局切换（力导向 / 环形 / 树状）

#### 7.4 路人字段：用 chapterId 引用而非字符串（隐藏依赖 D）

路人角色的「出场章节」字段定义为：
```typescript
interface Character {
  // ...
  firstAppearanceChapterId?: number  // 引用 chapters.id，不要存字符串
  storyRole?: string                 // 故事中的作用
  ending?: string                    // 结局
}
```

UI 上"出场章节"是个下拉选择器，从已有章节列出，**避免章节名修改后失同步**。

#### 验收
- ✅ 故事设计 7 字段齐全
- ✅ 角色四级显示正确
- ✅ 关系图可视化更接近"知识图谱"形态
- ✅ 路人的"出场章节"是引用而非字符串
- ✅ 删除某个角色后，关系图中该角色相关的边也消失

---

### Phase 8：创作区六模块

#### 8.1 创作规则
- 重组字段顺序：故事氛围 → 写作风格 → 叙事视角 → 禁止内容 → 参考作品 → 特殊创作要求
- 参考作品改为对象列表（书名 / 作者 / 类型选择"故事参考"或"风格参考"）
- 顶部 AI 按钮（"AI 生成创作规则"）

#### 8.2 大纲（差异化）
- 限制每节点 summary 字段最多 80 字（强约束"一句话"）
- 树形操作（拖拽排序、折叠展开）
- 顶部 AI 按钮（卷级一键生成）
- 每个节点 hover 出现「✨ AI 生成下级」按钮

#### 8.3 细纲（新模块）
- 列表展示所有大纲节点（章节）的细纲条目
- 每条目编辑表单：场景切分（动态列表）/ 人物出场 / 情绪弧度 / 场景目的
- 顶部 AI 按钮（基于该章节大纲生成细纲）

#### 8.4 章节（列表管理）
- 表格视图：章节名 / 字数 / 状态徽章（未开始/草稿/修改中/完稿/定稿）/ 最近更新 / 操作
- 顶部 AI 按钮（一键生成多章梗概）

#### 8.5 正文（编辑器）
- 现有 `ChapterEditor` 保留
- 右侧 AI 辅助抽屉：续写 / 重写选段 / 改写风格

#### 8.6 伏笔（差异化）
- 列表视图保留现有
- 加「时间线视图」Tab：横轴章节，竖轴伏笔，标记埋设/呼应/回收点
- 顶部 AI 按钮（一键生成伏笔规划）

#### 8.7 跨模块联动验收（链 4/5/6/8 + 隐藏依赖 B/C）

每个 Phase 8 子模块完成后必须做端到端测试：

**章节↔大纲级联（B）**：
- 在大纲面板删除一个章节节点 → 检查 chapters 表对应行已删
- 用 IndexedDB DevTools 确认无幽灵章节

**章节↔伏笔级联（C）**：
- 删除一个章节 → 检查 foreshadows 表中相关章节字段已清理
- 伏笔时间线视图刷新后无错位标记

**链 4（AI 章节大纲生成→写入大纲）**：
- 在卷节点点「AI 展开为章」→ 验证生成结果正确写入 outlineNodes 子节点

**链 5（AI 写正文）**：
- 在某章进入正文编辑器点「AI 写正文」→ 验证：
  - 上下文按钮显示完整的世界观+角色+前一章摘要
  - 生成内容与世界观/角色一致

**链 6（AI 续写）**：
- 在已有正文中点「AI 续写」→ 验证拼接连贯

**链 8（AI 伏笔 + 时间线）**：
- 点「AI 建议伏笔」→ 验证内容扣世界观
- 切换伏笔时间线视图 → 验证标记位置准确

#### 验收
- ✅ 六个模块每个都有可见的「✨ AI」按钮
- ✅ 细纲、章节列表、伏笔时间线三个新视图能用
- ✅ 上述 5 项端到端测试通过

---

### Phase 9：设置区其他模块 + 概念地图升级

#### 9.1 版本历史
- 把 `VersionHistoryPanel` 移到设置区下
- 保持现有功能

#### 9.2 导出
- 重写 `ExportPanel`：
  - JSON / Markdown / TXT 导出 ✅
  - 本地文件夹绑定 ✅
  - **删除**整个 GitHub Gist 相关 UI 和代码
  - **删除** `src/lib/export/gist-export.ts`

#### 9.3 设置
- AI 配置（保留）
- 提示词管理（Phase 2 已做）
- 主题切换（保留）

#### 9.4 概念地图功能（在世界观面板下）

> **决议**：保留概念地图功能，迁移到「世界观 → 自然环境」下作为子功能；
> 同时升级为 **Inkarnate 风格的程序化生成 + AI 视觉反向解析**。

##### 9.4.1 程序化奇幻地图生成（必做）

**位置**：世界观面板「自然环境」区块下，独立按钮「生成奇幻地图」

**输入**：用户已填的世界观字段：
- worldStructure（世界结构）
- worldSize（世界尺寸）
- continentLayout（大陆分布）
- climate（分区域气候）
- naturalResources（自然资源）

**算法**：
1. Voronoi 多边形分割（`d3-delaunay`）
2. Simplex Noise 生成地形高度图（新增依赖 `simplex-noise`）
3. 海岸线/山脉/河流绘制
4. 按气候字段染色（沙漠/森林/雪山/海洋）
5. 按资源字段散布图标（矿点/灵药点等）
6. 输出 SVG（可缩放/导出 PNG）

**美学**：羊皮纸纹理底，深棕色边框，配合 forge 主题。

**工作量**：约 3 工作日

##### 9.4.2 AI 视觉反向解析（特色功能）

**位置**：「世界观 → 自然环境」加按钮「上传地图自动填表」

**流程**：
```
1. 用户拖入图片（PNG/JPG）—— 可以是用 Inkarnate 画的、手绘扫描的、网图等
2. 调用 AI 视觉模型分析图像
3. AI 输出结构化 JSON：
   {
     worldStructure: "大陆",
     estimatedSize: "约 1500×1000 公里",
     continents: [{ name, description }, ...],
     naturalFeatures: [...],
     cities: [...],
     climate: "..."
   }
4. 显示预览界面（每条带勾选框、置信度）
5. 用户挑选 → 自动填入对应世界观字段
```

**技术要点**：
- 添加 vision 提示词模板：`import.parse-map`
- `AIConfig` 加 `visionModel?: string` 字段（默认用主 model，用户可指定 Vision 专用模型）
- 优先支持 Gemini 1.5 Pro Vision、Claude 3.5 Sonnet Vision、GPT-4o
- 容错：识别失败时显示原图 + 错误提示，允许用户手动填

**工作量**：约 2 工作日（主要是 prompt 调优）

##### 9.4.3 内置地图画板（不做）

**决议**：**不自研地图绘制画板**。理由：
- 实现复杂（需大量地形 stamp 素材）
- 用户可以用 Inkarnate / Wonderdraft / Dungeondraft 等成熟工具
- 通过 9.4.2 的 AI 视觉解析，**让用户用专业工具画好后导入**

##### 9.4.4 旧 GeographyPanel 的废弃处理
- 现有「地理环境」面板**不再独立存在**
- 现有的 `geographies` 表和 `prompts/geography.ts` 中的 `buildConceptMapPrompt`（让 AI 生成 SVG 那个）→ 数据迁移到世界观，prompt 函数迁到 `import.parse-map` 模板
- 旧的 `buildImageMapPrompt`（拼 Midjourney prompt）→ 迁到通用文本模板表，作为"画外部图用"的辅助工具

#### 验收
- ✅ 设置区四个二级菜单都能正常打开
- ✅ Gist 相关代码和 UI 完全消失
- ✅ 世界观面板有「生成奇幻地图」按钮，能基于参数生成 SVG
- ✅ 世界观面板有「上传地图自动填表」按钮，能用 AI Vision 解析图片并预填字段

---

### Phase 10：AI 解析导入（最难的一个）

#### 10.1 文件解析层

**新增依赖**：
- `mammoth`（.docx 解析为 HTML/纯文本）
- `xlsx` 或 `exceljs`（.xlsx 解析）
- `papaparse`（.csv 解析）

**新建** `src/lib/import/parsers.ts`：
```typescript
export async function parseFile(file: File): Promise<{
  text?: string         // 文档类（docx/md/txt）
  rows?: any[][]        // 表格类（xlsx/csv）
  format: 'document' | 'spreadsheet'
}>
```

#### 10.2 AI 分类层

**新建** `src/lib/import/classifier.ts`：
```typescript
export async function classifyContent(
  raw: { text?: string, rows?: any[][] },
  targetModule?: PromptModuleKey, // 用户可选
): Promise<{
  worldview?: Partial<Worldview>
  characters?: Character[]
  outlineNodes?: OutlineNode[]
  chapters?: Chapter[]
}>
```

调用三个提示词模板：
- `import.parse-character`
- `import.parse-worldview`
- `import.parse-outline`

策略：
1. 用户上传文件 → 解析得到 raw
2. 让用户选"目标模块"或"自动识别"
3. 调用 AI 流式生成结构化 JSON
4. 解析 JSON → 显示预览
5. 用户在预览界面勾选要导入的条目
6. 写入 IndexedDB

#### 10.3 导入 UI

`ImportPanel.tsx`：
- 上传区（拖拽或点击）
- 文件预览（文本前 500 字 / 表格前 10 行）
- "目标模块"选择器（默认"自动识别"）
- 「开始解析」按钮
- 流式输出预览（显示 AI 正在解析什么）
- 结果预览面板（树状显示要写入的对象）
- 「确认导入」按钮

#### 10.4 导入任务记录

每次导入存一条 `importJobs` 记录：源文件名、解析时间、写入条数、用户选择、AI 模型、提示词模板。便于回溯。

#### 验收
- ✅ 上传 .docx 能正确解析文本
- ✅ 上传 .xlsx 能正确解析行
- ✅ AI 分类后正确生成预览
- ✅ 用户能勾选/取消单个条目
- ✅ 确认后写入 IndexedDB，刷新对应 Panel 看到新数据

---

### Phase 11：UI 风格统一与走查

#### 11.1 视觉统一
- 删除所有 emoji 滥用（仅在用户内容中保留）
- 统一卡片圆角（rounded-xl 还是 rounded-lg 选一个）
- 统一卡片边框（一律 border-border 单线）
- 统一标题层级（h1 / h2 / h3 字号统一）
- 统一按钮 variant（accent / default / danger 三种）

#### 11.2 间距规范
- 所有 Panel 顶部留 px-6 py-6
- 字段间距 space-y-4
- 卡片内 padding p-5

#### 11.3 主题对照
- forge（HomePage）和 work（WorkspacePage）确认无样式冲突
- paper 主题（亮色）走查所有 Panel

#### 11.4 响应式
- 1280 / 1440 / 1920 三档宽度走查
- 侧边栏 collapsed 状态走查

#### 11.5 主题硬编码颜色全面走查（隐藏依赖 F）

**目的**：解决"主题切换后某些块颜色不变"的 bug。

**做法**：
1. 用正则全文搜索：`text-(red|green|blue|yellow|orange|purple|pink)-\d+`、`bg-(red|green|...)-\d+`、`#[0-9a-fA-F]{3,8}`
2. 对每处命中：
   - 如果是状态色（success/error/warning）→ 替换为语义 token（`text-success` 等）
   - 如果是装饰色 → 替换为主题 token（`text-accent`、`bg-accent/10` 等）
   - 如果确实需要硬编码（比如奇幻地图的固定色阶）→ 加注释说明并保留
3. 三个主题（forge / work / paper）逐一切换走查所有 Panel

#### 验收
- ✅ 截图对比，所有 Panel 风格一致
- ✅ 三档宽度无溢出/错位
- ✅ 三个主题切换后无颜色异常

---

## 第七章 风险与回滚

### 7.1 风险清单

| 风险 | 应对 |
|------|------|
| 提示词系统抽象后，AI 输出质量下降 | Phase 1 验收时严格对比改造前后输出 |
| Dexie v6 升级导致数据丢失 | 用户已确认无旧用户，可清空。但**开发期 Claude 自己的测试数据**也会丢，需要 Phase 0 提醒 |
| AI 解析 .docx/.xlsx 不稳定 | 容错：解析失败显示原文，允许用户手动复制粘贴 |
| Phase 6 世界观面板字段太多导致 UI 拥挤 | 三块强制折叠，默认只展开当前激活的一块 |
| 第三方包 mammoth/xlsx 体积大 | Phase 10 用动态 import 懒加载 |

### 7.2 每 Phase 都有 git commit
- 每完成一个 Phase 就 commit + push
- commit message 格式：`feat(phase-N): <概述>`
- 出问题可以单 Phase 回滚

---

## 第八章 验收最终清单（用户验收用）

发布前用户对照此清单逐条勾选：

### 导航
- [ ] 侧边栏分为「著作信息 / 设定库 / 创作区 / 设置区」4 大区
- [ ] 设定库下有 3 个二级项：世界观 / 故事设计 / 角色设计
- [ ] 创作区下有 6 个二级项：创作规则 / 大纲 / 细纲 / 章节 / 正文 / 伏笔
- [ ] 设置区下有 4 个二级项：版本历史 / 导入 / 导出 / 设置

### 著作信息
- [ ] 类型为多选标签，含起点/纵横/晋江主流分类
- [ ] 选"其他"出现自定义输入框
- [ ] 简介 placeholder 是「试着用简单的一句话描述你的故事」
- [ ] 目标字数 slider 范围 0~500 万
- [ ] 底部状态栏显示三项：创建时间 / 连续撰写 / 最近更新

### 世界观
- [ ] 三块（世界起源 / 自然环境 / 人文环境）字段齐全（22 个字段）
- [ ] 顶部有「AI 一键创建世界观」按钮

### 故事设计
- [ ] 7 个字段齐全
- [ ] 顶部有 AI 生成按钮

### 角色设计
- [ ] 主要角色 / 次要角色 / NPC / 路人四级显示差异
- [ ] 角色关系网保留并增强

### 创作区
- [ ] 6 个二级模块每个都有「✨ AI」按钮
- [ ] 创作规则字段顺序正确
- [ ] 参考作品分"故事参考/风格参考"
- [ ] 大纲节点有"一句话"约束
- [ ] 细纲是独立模块
- [ ] 章节列表与正文编辑器分离
- [ ] 伏笔有时间线视图

### 设置区
- [ ] Gist 云备份完全消失
- [ ] 导入支持 .docx / .xlsx / .csv / .md / .txt
- [ ] 提示词管理可查看、克隆、编辑、导入导出

### AI 提示词系统
- [ ] 14+ 条系统模板可见
- [ ] 用户可克隆并编辑
- [ ] 实时预览拼出的最终提示词
- [ ] 切换激活模板后下次 AI 调用使用新模板
- [ ] JSON 格式可导入导出

---

## 第九章 备忘录

> 所有规划外的"用户提到但未具体设计"的事项，都应及时进 `memory/storyforge_backlog.md`。

当前已知未规划事项：
1. AI 一键生成的具体提示词内容（Phase 1 用占位文本，后期细调）
2. "莲花地图故事"等故事模式的可视化（暂用文本说明，后期可加图形化布局）
3. 角色头像生成或上传（暂占位）
4. 多端同步（永久不做或远期）
5. 移动端适配（远期）
6. 协作功能（远期）

---

## 总结

**这次 Opus 4.7 重写的与 Sonnet v2 的关键差异：**

1. **AI 提示词系统独立成第三章**，给出完整的数据结构、UI 草图、迁移路径。这是用户认定的"核心特色功能"，不能仅在路线图最后一笔带过。
2. **明确"删库重建"策略**——用户已确认无旧用户，无需做向下兼容的复杂迁移逻辑。
3. **每个 Phase 都列了"验收标准"**——避免做完了用户验不出来。
4. **联网抓类型标签放在 Phase 0**——硬性前置任务，不可省略。
5. **导入支持表格格式（.xlsx/.csv）**——纠正 Sonnet v2 漏掉的硬错误。
6. **整改总工作量 18 工作日**——给用户一个明确的时间预期。

**等待用户最后确认后启动 Phase 0。**

---

## 附录 A：跨模块依赖修复矩阵

> 本附录由 Opus 4.7 审查时补充，确保 v3 文档不漏修任何依赖。

### A.1 功能链 → Phase 映射

| 功能链 | 用户场景 | 修复在 |
|--------|---------|-------|
| 链 1 | AI 生成世界观 | P1 (适配器) + P6 (字段重组) |
| 链 2 | AI 设计角色 | P1 + P3 (改 context-builder) |
| 链 3 | AI 卷大纲 | P1 + P3 + P7 (故事核心扩展) |
| 链 4 | AI 章节大纲 | P8 (大纲模块改造) |
| 链 5 | AI 写正文（4 store 联动） | P1 + P3 + P8 |
| 链 6 | AI 续写 | P8 |
| 链 7 | AI 润色/扩写/去 AI 味 | P1 |
| 链 8 | AI 建议伏笔 + 时间线视图 | P1 + P8 |
| 链 9 | 概念地图（升级为奇幻地图 + 视觉反向） | P9.4 |
| 链 10 | 项目快照 / 导出 / 导入 | P3 (快照表清单) + P9 (导入导出) |

### A.2 隐藏依赖 → Phase 映射

| 编号 | 隐藏依赖 | 修复在 |
|------|---------|-------|
| A | 角色 ↔ 角色关系（孤儿） | P3 (schema 加级联) + P7 (删除按钮逻辑) |
| B | 章节 ↔ 大纲节点（孤儿） | P3 + P8 |
| C | 伏笔 ↔ 章节（孤儿） | P3 + P8 |
| D | 路人 ↔ 章节（引用形式） | P7 (字段定义时) |
| E | AI 配置 ↔ 视觉模型 | P9.4 (做地图视觉时) |
| F | 主题切换 ↔ 硬编码颜色 | P11 (走查) |

### A.3 各 Phase 涉及的依赖修复点（反向索引）

| Phase | 涉及的依赖修复 |
|-------|---------------|
| P1 | 链 1/2/3/5/7/8（提示词适配器层） |
| P3 | 链 2/3/5/8（context-builder 重写）+ 链 10（快照）+ A/B/C（级联） |
| P4 | （无依赖修复，纯 UI 重构） |
| P6 | 链 1（世界观字段） |
| P7 | 链 3（故事核心字段）+ A（角色删除级联）+ D（路人 chapterId 引用） |
| P8 | 链 4/5/6/8 + B/C（大纲/章节级联） |
| P9 | 链 9（概念地图升级）+ 链 10（导入导出代码）+ E（visionModel） |
| P11 | F（主题颜色走查） |

### A.4 一句话保险原则

**任何 Phase 完成后，必须跑一次"AI 生成全功能巡检"**：
1. 进入测试项目 → 点世界观 AI 生成（链 1）
2. 点角色 AI 生成（链 2）
3. 点大纲 AI 生成（链 3）
4. 点章节正文 AI 生成（链 5）
5. 点续写（链 6）+ 润色/扩写/去 AI 味（链 7）
6. 点伏笔 AI 建议（链 8）
7. 创建快照、导出 JSON、再导入（链 10）
8. 删一个角色、删一个章节，验证级联（A/B/C）

**通过即可 commit & push 到下一个 Phase；失败必须修复才能进入下一阶段**。
