# StoryForge / 故事熔炉 — 世界构建引擎

> **版本**: v1.0 | **最后更新**: 2026-04-13 | **状态**: 规划中

---

## 1. 概述

世界构建引擎是 StoryForge 的核心差异化能力。它将小说的世界观拆解为 **10 大维度**，每个维度都有结构化的数据模型和对应的 AI 生成能力。所有维度的数据会自动注入 AI 上下文，确保生成的大纲和正文与世界观保持一致。

### 设计理念

```
不是让用户填一堆表单，而是：
1. AI 帮你生成初稿 → 2. 你在此基础上修改 → 3. 系统自动管理一致性
```

### 10 大维度一览

| # | 维度 | 图标 | 描述 | 必填 |
|---|------|------|------|------|
| 1 | 基本信息 | 📋 | 书名、类型、受众、核心设定、流派 | ✅ |
| 2 | 世界观概述 | 🌍 | 世界的宏观描述、时代背景、核心规则 | ✅ |
| 3 | 故事核心 | 💫 | 主题、核心冲突、情节模式、故事线 | ✅ |
| 4 | 角色系统 | 👤 | 主角/配角/反派的完整设定、角色关系 | ✅ |
| 5 | 势力阵营 | ⚔️ | 门派、国家、组织、阵营及其关系 | 可选 |
| 6 | 力量体系 | 💪 | 修炼等级、技能体系、功法系统 | 可选 |
| 7 | 地理环境 | 🗺️ | 地图、地域、重要地点 | 可选 |
| 8 | 历史年表 | 📜 | 重大历史事件、纪年体系 | 可选 |
| 9 | 道具系统 | 💎 | 法宝、道具、特殊物品 | 可选 |
| 10 | 规则约束 | 📐 | 创作红线、风格约束、禁止事项 | 推荐 |

---

## 2. 各维度数据模型

### 2.1 基本信息（ProjectInfo）

```typescript
interface ProjectInfo {
  id: string;
  name: string;                    // 书名
  genre: NovelGenre;               // 类型/流派
  subGenre?: string;               // 子类型
  targetAudience: TargetAudience;  // 目标受众
  coreIdea: string;                // 核心创意（一句话概括）
  synopsis: string;                // 故事简介（200字以内）
  wordCountTarget?: number;        // 目标字数
  chapterCountTarget?: number;     // 目标章节数
  tags: string[];                  // 标签
  createdAt: Date;
  updatedAt: Date;
}

type NovelGenre = 
  | '玄幻' | '仙侠' | '都市' | '科幻' | '历史' | '军事'
  | '游戏' | '体育' | '悬疑' | '灵异' | '二次元' | '奇幻'
  | '武侠' | '末世' | '系统' | '重生' | '穿越' | '其他';

type TargetAudience = '男频' | '女频' | '通用';
```

### 2.2 世界观概述（Worldview）

```typescript
interface Worldview {
  id: string;
  projectId: string;
  
  // 世界基础
  worldName: string;               // 世界名称
  era: string;                     // 时代/纪元
  worldType: WorldType;            // 世界类型
  overview: string;                // 世界概述（自由文本，AI 生成）
  
  // 核心规则
  coreRules: string;               // 世界运行的基本规则
  
  // 社会结构
  socialStructure: string;         // 社会体系描述
  politicalSystem: string;         // 政治体系
  economicSystem: string;          // 经济体系
  culturalFeatures: string;        // 文化特征
  
  // 技术/魔法水平
  techLevel: string;               // 科技/魔法发展水平
  
  // 特殊设定
  specialSettings: string;         // 独特的世界观设定
  
  updatedAt: Date;
}

type WorldType = 
  | '东方玄幻' | '西方奇幻' | '现代都市' | '未来科幻'
  | '末世废土' | '历史架空' | '虚拟游戏' | '星际宇宙'
  | '仙侠世界' | '武侠江湖' | '其他';
```

### 2.3 故事核心（StoryCore）

```typescript
interface StoryCore {
  id: string;
  projectId: string;
  
  // 主题
  theme: string;                   // 核心主题
  subThemes: string[];             // 次要主题
  
  // 冲突体系
  mainConflict: string;            // 主要冲突
  conflictLayers: ConflictLayer[]; // 多层冲突
  
  // 情节模式
  plotPattern: PlotPattern;        // 情节模式
  plotDescription: string;         // 情节模式描述
  
  // 故事线
  mainPlotLine: string;            // 主线剧情概述
  subPlotLines: SubPlotLine[];     // 支线剧情
  
  // 节奏
  pacing: string;                  // 节奏描述（快节奏/慢热等）
  
  // 结局方向
  endingDirection: string;         // 大致结局方向
  
  updatedAt: Date;
}

interface ConflictLayer {
  level: '个人' | '人际' | '社会' | '世界' | '超自然';
  description: string;
}

type PlotPattern = 
  | '英雄之旅' | '复仇' | '探索' | '成长' | '争霸'
  | '生存' | '寻宝' | '解密' | '拯救' | '逆袭'
  | '自定义';

interface SubPlotLine {
  name: string;
  description: string;
  relatedCharacters: string[];     // 关联角色 ID
  startChapter?: number;
  endChapter?: number;
}
```

### 2.4 角色系统（Character）

```typescript
interface Character {
  id: string;
  projectId: string;
  
  // 基本信息
  name: string;
  aliases: string[];               // 别名/外号
  role: CharacterRole;             // 角色定位
  gender: string;
  age: string;                     // "25岁" 或 "看似少年，实则千岁"
  
  // 外貌
  appearance: string;              // 外貌描述
  
  // 性格
  personality: string;             // 性格描述
  traits: string[];                // 性格标签 ["冷静", "果断", "内心柔软"]
  
  // 背景
  background: string;              // 身世背景
  motivation: string;              // 核心动机/目标
  
  // 能力
  abilities: string;               // 能力/技能描述
  powerLevel: string;              // 实力等级
  
  // 弱点与秘密
  weaknesses: string;              // 弱点
  secrets: string;                 // 隐藏的秘密
  
  // 角色弧
  characterArc: string;            // 角色成长弧线
  
  // 关系
  relationships: CharacterRelation[];
  
  // 摘要（用于 AI 上下文注入，控制 token）
  shortDescription: string;        // 一句话描述（AI 上下文用）
  
  // 元信息
  factionId?: string;              // 所属势力
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

type CharacterRole = 
  | '主角' | '女主' | '重要配角' | '反派' | '导师'
  | '盟友' | '路人' | '阵亡角色' | '其他';

interface CharacterRelation {
  targetCharacterId: string;
  relationType: string;            // "师徒", "情侣", "宿敌", "兄弟" 等
  description: string;             // 关系描述
}
```

### 2.5 势力阵营（Faction）

```typescript
interface Faction {
  id: string;
  projectId: string;
  
  name: string;
  type: FactionType;               // 势力类型
  description: string;             // 势力描述
  leader: string;                  // 领袖（角色名或ID）
  headquarters: string;            // 总部/根据地
  
  // 势力特征
  ideology: string;                // 理念/信条
  strengths: string;               // 优势
  weaknesses: string;              // 弱点
  
  // 势力关系
  allies: string[];                // 盟友势力 ID
  enemies: string[];               // 敌对势力 ID
  
  // 内部结构
  hierarchy: string;               // 等级制度描述
  memberCount: string;             // 成员规模
  
  // 成员角色
  memberCharacterIds: string[];    // 所属角色 ID 列表
  
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

type FactionType = 
  | '门派' | '宗族' | '国家' | '组织' | '势力'
  | '公司' | '军队' | '帮派' | '学院' | '其他';
```

### 2.6 力量体系（PowerSystem）

```typescript
interface PowerSystem {
  id: string;
  projectId: string;
  
  // 体系名称
  name: string;                    // 如 "灵气修炼体系"
  type: PowerSystemType;
  
  // 等级体系
  levels: PowerLevel[];            // 实力等级列表（有序）
  
  // 体系描述
  overview: string;                // 总体描述
  rules: string;                   // 修炼/使用规则
  limitations: string;             // 限制/代价
  
  // 功法/技能分类
  categories: PowerCategory[];     // 功法/技能分类
  
  // 进阶条件
  advancementConditions: string;   // 突破/进阶的通用条件
  
  updatedAt: Date;
}

type PowerSystemType = 
  | '修炼' | '魔法' | '武学' | '科技' | '血统'
  | '契约' | '异能' | '系统' | '其他';

interface PowerLevel {
  name: string;                    // 等级名称
  rank: number;                    // 排序
  description: string;             // 等级描述
  characteristics: string;         // 该等级的典型特征
}

interface PowerCategory {
  name: string;                    // 分类名 如 "剑修"、"火系魔法"
  description: string;
  exampleSkills: string[];         // 示例技能
}
```

### 2.7 地理环境（Geography）+ 地图可视化

```typescript
interface Geography {
  id: string;
  projectId: string;
  
  overview: string;                // 世界地理总述
  
  locations: Location[];           // 重要地点列表
  
  updatedAt: Date;
}

interface Location {
  id: string;
  name: string;
  type: LocationType;
  description: string;             // 地点描述
  significance: string;            // 剧情重要性
  relatedCharacterIds: string[];   // 相关角色
  relatedFactionIds: string[];     // 相关势力
  parentLocationId?: string;       // 上级地点（如 某城 → 某国）
  // 地图坐标（用于可视化）
  mapX?: number;                   // 概念地图上的 X 坐标 (0-100)
  mapY?: number;                   // 概念地图上的 Y 坐标 (0-100)
}

type LocationType = 
  | '大陆' | '国家' | '城市' | '门派驻地' | '秘境'
  | '遗迹' | '战场' | '自然景观' | '建筑' | '其他';
```

#### 地图可视化系统

StoryForge 提供 3 层地图可视化能力，帮助作者直观理解世界的地理关系：

**层级 1：地点关系图（P2 — d3-force / react-flow）**

```
用户输入地点列表（带层级关系）
    ↓
系统根据 parentLocationId 构建层级树
    ↓
渲染为力导向图（节点 = 地点，连线 = 隶属/相邻关系）
    ↓
用户可拖拽节点调整布局
    ↓
支持按类型着色、按势力分组
```

```
可视化示例：

    ┌─────────────┐
    │   天元大陆   │ ← 大陆节点（最大）
    └──────┬──────┘
       ┌───┴────┐
  ┌────┴───┐ ┌──┴─────┐
  │ 苍穹国 │ │ 玄天国 │ ← 国家节点
  └──┬─────┘ └──┬─────┘
  ┌──┴──┐    ┌──┴──┐
  │天都城│   │幽冥谷│ ← 城市/秘境节点
  └─────┘    └─────┘
```

**层级 2：AI 概念地图（P3 — SVG 渲染）**

```
用户点击 [AI 生成地图布局]
    ↓
系统读取：世界观 + 地理总述 + 所有地点数据
    ↓
AI 分析地点关系，生成布局数据：
  {
    locations: [
      { id: "1", name: "天元大陆", x: 50, y: 50, radius: 40 },
      { id: "2", name: "苍穹国", x: 30, y: 40, radius: 15 },
      ...
    ],
    connections: [
      { from: "2", to: "3", type: "border", label: "边境接壤" },
      ...
    ],
    terrain: [
      { type: "mountain", path: "M20,30 Q25,20 30,30", label: "万仞山脉" },
      { type: "river", path: "M10,50 Q30,45 50,55", label: "天河" },
      ...
    ]
  }
    ↓
前端渲染为 SVG 示意地图（带地形、标注、连线）
    ↓
用户可调整位置，保存为地图快照
```

**层级 3：AI 图像地图（P3 — 图像生成 API）**

```
用户点击 [AI 生成地图图片]
    ↓
系统根据世界观 + 地理描述组装 prompt：
  "一张俯视角度的奇幻世界地图，古典风格，
   包含以下区域：{locations}，
   地形特征：{terrain_description}，
   风格：羊皮纸材质，手绘标注..."
    ↓
调用图像生成 API（DALL-E / Stable Diffusion）
    ↓
生成地图图片，用户可保存/替换
```

### 2.8 历史年表（History）

```typescript
interface History {
  id: string;
  projectId: string;
  
  overview: string;                // 历史总述
  eraSystem: string;               // 纪年体系描述
  
  events: HistoricalEvent[];       // 重大事件列表
  
  updatedAt: Date;
}

interface HistoricalEvent {
  id: string;
  era: string;                     // 所属纪元/年代
  date: string;                    // 具体时间（如 "太古纪元末年"）
  title: string;                   // 事件名称
  description: string;             // 事件描述
  impact: string;                  // 对世界的影响
  relatedCharacterIds: string[];   // 相关角色（可能是远古人物）
  relatedFactionIds: string[];     // 相关势力
  sortOrder: number;               // 时间线排序
}
```

### 2.9 道具系统（ItemSystem）

```typescript
interface ItemSystem {
  id: string;
  projectId: string;
  
  overview: string;                // 道具体系总述
  
  items: Item[];                   // 重要道具列表
  
  updatedAt: Date;
}

interface Item {
  id: string;
  name: string;
  type: ItemType;
  rank: string;                    // 品级/等级
  description: string;             // 描述
  abilities: string;               // 能力/效果
  origin: string;                  // 来历
  currentOwnerId?: string;         // 当前持有者（角色 ID）
  significance: string;            // 剧情重要性
}

type ItemType = 
  | '武器' | '防具' | '法宝' | '丹药' | '材料'
  | '功法秘籍' | '阵法' | '特殊物品' | '其他';
```

### 2.10 规则约束（CreativeRules）

```typescript
interface CreativeRules {
  id: string;
  projectId: string;
  
  // 写作风格
  writingStyle: string;            // 期望的写作风格描述
  narrativePOV: NarrativePOV;      // 叙事视角
  toneAndMood: string;             // 基调和氛围
  
  // 创作红线
  prohibitions: string[];          // 禁止事项列表
  // 如 ["不要出现现代梗", "角色不能轻易死而复生", "不要开后宫"]
  
  // 一致性约束
  consistencyRules: string[];      // 一致性规则
  // 如 ["修炼等级严格递进", "角色性格需保持一致"]
  
  // 特殊要求
  specialRequirements: string;     // 其他特殊创作要求
  
  // 参考作品
  referenceWorks: string[];        // 参考/致敬的作品
  
  updatedAt: Date;
}

type NarrativePOV = '第一人称' | '第三人称有限' | '第三人称全知' | '多视角';
```

---

## 3. AI 生成流程

### 3.1 各维度的 AI 角色人设

每个维度都有专属的 AI 角色人设（System Prompt），确保 AI 以专业的视角生成内容。

| 维度 | AI 角色 | 核心定位 |
|------|---------|---------|
| 世界观 | **世界设计师** | "你是一位资深的世界观架构师，擅长构建完整、自洽、有深度的虚构世界..." |
| 故事核心 | **故事架构师** | "你是一位精通叙事结构的故事架构师，擅长设计引人入胜的故事核心..." |
| 角色 | **角色设计师** | "你是一位擅长塑造立体角色的角色设计师，每个角色都有独特的动机、弧光和复杂性..." |
| 势力 | **势力设计师** | "你是一位擅长构建权力结构和势力关系的设计师..." |
| 力量体系 | **体系设计师** | "你是一位擅长设计力量体系的设计师，确保体系既有想象力又有内在逻辑..." |
| 大纲 | **大纲师** | "你是一位经验丰富的小说大纲师，擅长规划引人入胜的长篇剧情..." |
| 正文写作 | **"老贼"写手** | "你是一位笔名'老贼'的网文写手，文风犀利，擅长伏笔和反转..." |
| 润色/去AI味 | **文字打磨师** | "你是一位专业的文字编辑，擅长润色文字并消除AI生成的痕迹..." |
| 伏笔 | **伏笔顾问** | "你是一位精通伏笔技巧的创作顾问，熟知10种经典伏笔模式..." |

### 3.2 生成流程示例：生成世界观

```
用户点击 [AI 生成世界观]
    ↓
系统读取 ProjectInfo（书名、类型、核心创意）
    ↓
组装 System Prompt（世界设计师人设）
    ↓
组装 User Prompt:
  "基于以下小说设定，请生成一个完整的世界观描述：
   书名：{name}
   类型：{genre}
   核心创意：{coreIdea}
   目标受众：{targetAudience}
   
   请从以下方面描述这个世界：
   1. 世界概况
   2. 核心规则
   3. 社会结构
   4. 技术/魔法水平
   5. 独特设定"
    ↓
调用 AI API（流式输出）
    ↓
用户看到实时生成的内容
    ↓
生成完成 → 自动解析并填充各字段
    ↓
用户可以手动修改任何字段
```

### 3.3 生成流程示例：生成角色

```
用户点击 [AI 生成角色]
    ↓
系统读取：
  - ProjectInfo（基本设定）
  - Worldview（世界观——角色需要符合世界设定）
  - StoryCore（故事核心——角色需要服务于剧情）
  - 已有角色列表（避免重复/冲突）
    ↓
组装 System Prompt（角色设计师人设）
    ↓
组装 User Prompt:
  "基于以下世界观和故事设定，请生成一个{role}角色：
   
   【世界观摘要】
   {worldview.overview}
   
   【故事核心】
   主题：{storyCore.theme}
   主要冲突：{storyCore.mainConflict}
   
   【已有角色】
   {existingCharacters}
   
   【用户要求】
   {userPrompt}
   
   请按以下格式输出：
   - 姓名
   - 性别/年龄
   - 外貌
   - 性格（含3-5个性格标签）
   - 背景故事
   - 核心动机
   - 能力
   - 弱点与秘密
   - 角色弧线
   - 一句话描述"
    ↓
AI 流式生成 → 解析 → 填充 Character 表单
```

### 3.4 上下文注入层级

不同操作需要注入不同深度的上下文：

```
┌──────────────────────────────────────────────────┐
│                上下文注入层级                       │
├──────────────────────────────────────────────────┤
│                                                  │
│  Level 0: 基本信息 ← 所有操作都需要               │
│  ┌─────────────────────────┐                     │
│  │ 书名 + 类型 + 核心创意   │                     │
│  └─────────────────────────┘                     │
│                                                  │
│  Level 1: 世界观摘要 ← 大部分操作需要             │
│  ┌─────────────────────────┐                     │
│  │ 世界概述 + 核心规则      │                     │
│  └─────────────────────────┘                     │
│                                                  │
│  Level 2: 角色 + 势力 ← 大纲/写作需要            │
│  ┌─────────────────────────┐                     │
│  │ 角色简介列表             │                     │
│  │ 势力关系图               │                     │
│  └─────────────────────────┘                     │
│                                                  │
│  Level 3: 大纲上下文 ← 写作需要                   │
│  ┌─────────────────────────┐                     │
│  │ 当前章节大纲             │                     │
│  │ 前后章节大纲             │                     │
│  └─────────────────────────┘                     │
│                                                  │
│  Level 4: 前文内容 ← 续写需要                     │
│  ┌─────────────────────────┐                     │
│  │ 上一章末尾               │                     │
│  │ 当前章节已有内容          │                     │
│  └─────────────────────────┘                     │
│                                                  │
│  Level 5: 伏笔 ← 写作时可选注入                   │
│  ┌─────────────────────────┐                     │
│  │ 待埋设的伏笔             │                     │
│  │ 待回收的伏笔             │                     │
│  └─────────────────────────┘                     │
└──────────────────────────────────────────────────┘
```

#### 各操作的上下文注入配置

| 操作 | Level 0 | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|------|---------|---------|---------|---------|---------|---------|
| 生成世界观 | ✅ | — | — | — | — | — |
| 生成角色 | ✅ | ✅ | ✅(已有角色) | — | — | — |
| 生成势力 | ✅ | ✅ | ✅ | — | — | — |
| 生成大纲 | ✅ | ✅ | ✅ | — | — | — |
| 生成章节正文 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 续写 | ✅ | ✅ | ✅(相关角色) | ✅ | ✅ | ✅ |
| 润色/去AI味 | — | — | — | — | ✅(当前文本) | — |

---

## 4. 伏笔系统

### 4.1 10 种伏笔模式

来源于经典叙事理论，为 AI 提供结构化的伏笔建议。

| # | 模式名称 | 英文 | 描述 | 经典案例 |
|---|---------|------|------|---------|
| 1 | **契诃夫之枪** | Chekhov's Gun | 早期出现的看似无关紧要的细节，后来成为关键 | 挂在墙上的枪一定会开火 |
| 2 | **草蛇灰线** | Hidden Thread | 在多个场景中反复出现的微小线索 | 红楼梦中的判词暗示 |
| 3 | **预言/谶语** | Prophecy | 模糊的预言，后来以意想不到的方式实现 | 哈利波特预言 |
| 4 | **误导伏笔** | Red Herring | 故意设置的假线索，引导读者走向错误判断 | 侦探小说的假凶手 |
| 5 | **对称呼应** | Symmetry | 前后场景形成对称或镜像关系 | 开头与结尾的呼应 |
| 6 | **角色暗示** | Character Hint | 通过角色言行暗示其隐藏的身份或动机 | 反派的微妙表情变化 |
| 7 | **物品线索** | Object Clue | 特定物品承载的隐藏信息 | 传家宝的真正用途 |
| 8 | **环境暗示** | Environmental Hint | 通过环境描写暗示即将发生的事 | 暴风雨前的平静 |
| 9 | **对话暗线** | Dialogue Subtext | 角色对话中隐含的双关或隐藏含义 | 一语双关的告别 |
| 10 | **时间线暗示** | Timeline Hint | 通过时间线的不一致或空白暗示隐藏事件 | 失忆片段 |

### 4.2 伏笔数据模型

```typescript
interface Foreshadow {
  id: string;
  projectId: string;
  
  // 基本信息
  name: string;                    // 伏笔名称
  type: ForeshadowType;            // 伏笔模式（上述10种之一）
  description: string;             // 伏笔描述
  
  // 状态追踪
  status: ForeshadowStatus;
  
  // 埋设
  plantChapterId?: string;         // 埋设章节
  plantDescription: string;        // 埋设方式描述
  
  // 呼应（可多次）
  echoes: ForeshadowEcho[];
  
  // 回收
  payoffChapterId?: string;        // 回收章节
  payoffDescription: string;       // 回收方式描述
  
  // 关联
  relatedCharacterIds: string[];   // 相关角色
  importance: 'major' | 'minor';   // 重要程度
  
  // 备注
  notes: string;                   // 创作备注
  
  createdAt: Date;
  updatedAt: Date;
}

type ForeshadowType = 
  | '契诃夫之枪' | '草蛇灰线' | '预言谶语' | '误导伏笔' | '对称呼应'
  | '角色暗示' | '物品线索' | '环境暗示' | '对话暗线' | '时间线暗示';

type ForeshadowStatus = 
  | 'planned'    // 已计划，尚未埋设
  | 'planted'    // 已埋设
  | 'echoed'     // 已呼应（至少一次）
  | 'resolved'   // 已回收
  | 'abandoned'; // 已放弃

interface ForeshadowEcho {
  chapterId: string;
  description: string;             // 呼应方式描述
  createdAt: Date;
}
```

### 4.3 伏笔状态可视化

```
伏笔追踪面板：

📌 主要伏笔
┌──────────────────────────────────────────┐
│ 🔴 古剑的秘密 [契诃夫之枪]               │
│    状态：已埋设 → 等待回收                │
│    埋设：第3章 — 老者赠剑时的一句暗语     │
│    呼应：第12章 — 剑身发光                │
│    回收：未设定                           │
├──────────────────────────────────────────┤
│ 🟡 师父的真实身份 [角色暗示]              │
│    状态：已呼应 × 3                       │
│    埋设：第1章 — 师父闪避时的异常身法      │
│    呼应：第5章、第8章、第15章              │
│    回收：第20章 — 身份揭露（计划）         │
├──────────────────────────────────────────┤
│ 🟢 开篇的暴风雨 [环境暗示]               │
│    状态：已回收 ✓                         │
│    埋设：第1章 — 不寻常的天象              │
│    回收：第10章 — 天劫降临                │
└──────────────────────────────────────────┘

📋 次要伏笔
┌──────────────────────────────────────────┐
│ ⚪ 酒馆老板的身份 [草蛇灰线] — 已计划     │
│ ⚪ 断裂的玉佩 [物品线索] — 已计划          │
└──────────────────────────────────────────┘
```

---

## 5. 大纲系统

### 5.1 树形结构

```typescript
interface OutlineNode {
  id: string;
  projectId: string;
  parentId: string | null;         // null = 根节点（卷级）
  
  type: OutlineNodeType;
  title: string;
  summary: string;                 // 内容摘要
  
  // 排序
  order: number;
  
  // 关联
  relatedCharacterIds: string[];   // 出场角色
  relatedForeshadowIds: string[];  // 涉及的伏笔
  
  // 状态
  status: 'draft' | 'outlined' | 'writing' | 'completed';
  
  createdAt: Date;
  updatedAt: Date;
}

type OutlineNodeType = 'volume' | 'arc' | 'chapter';
```

### 5.2 大纲树示例

```
📖 《剑道独尊》
├── 📁 第一卷：初入江湖
│   ├── 📄 第1章：老人与少年
│   ├── 📄 第2章：古剑入手
│   ├── 📄 第3章：下山
│   └── 📄 第4章：初临城池
├── 📁 第二卷：宗门试炼
│   ├── 📄 第5章：入门考核
│   ├── 📄 第6章：初露锋芒
│   └── ...
└── 📁 第三卷：风云起
    └── ...
```

### 5.3 分批生成策略

长篇小说可能有几百章，一次生成全部大纲不现实。分批生成策略：

```
第一步：生成整体框架（卷级大纲）
  "共 X 卷，每卷的核心剧情和转折点"
    ↓
第二步：逐卷展开章节大纲
  "第一卷共 N 章，每章的标题和摘要"
    ↓
第三步：必要时细化单章
  "第5章的详细剧情走向和场景列表"
```

---

## 6. UI 面板流转

### 6.1 侧边栏导航 → 主面板切换

```typescript
type WorkspaceModule = 
  | 'project-info'    // 📋 基本信息
  | 'worldview'       // 🌍 世界观
  | 'story-core'      // 💫 故事核心
  | 'characters'      // 👤 角色管理
  | 'factions'        // ⚔️ 势力阵营
  | 'power-system'    // 💪 力量体系
  | 'geography'       // 🗺️ 地理环境
  | 'history'         // 📜 历史年表
  | 'items'           // 💎 道具系统
  | 'rules'           // 📐 规则约束
  | 'outline'         // 📖 大纲
  | 'writing'         // ✍️ 写作
  | 'foreshadows';    // 🔮 伏笔
```

### 6.2 推荐创作顺序

引导新用户按以下顺序设定世界：

```
1. 📋 基本信息（必填 — 这决定了一切）
   ↓
2. 📐 规则约束（推荐 — 先定红线，AI 不会越界）
   ↓
3. 🌍 世界观（必填 — 建立世界基础）
   ↓
4. 💫 故事核心（必填 — 明确要讲什么故事）
   ↓
5. 👤 角色（必填 — 至少创建主角）
   ↓
6. ⚔️ 势力（可选 — 根据类型决定）
7. 💪 力量体系（可选 — 玄幻/仙侠类必需）
8. 🗺️ 地理（可选）
9. 📜 历史（可选）
10. 💎 道具（可选）
   ↓
11. 📖 大纲（基于以上设定生成）
   ↓
12. ✍️ 写作（基于大纲逐章写作）
   ↓
13. 🔮 伏笔（在写作过程中持续管理）
```

---

## 7. 数据导入/导出

### 7.1 JSON 备份格式

```typescript
interface StoryForgeBackup {
  version: '1.0';
  exportedAt: string;              // ISO timestamp
  project: Project;
  worldview?: Worldview;
  storyCore?: StoryCore;
  characters: Character[];
  factions: Faction[];
  powerSystems: PowerSystem[];
  geography?: Geography;
  history?: History;
  itemSystem?: ItemSystem;
  creativeRules?: CreativeRules;
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  foreshadows: Foreshadow[];
}
```

### 7.2 Markdown 导出格式

```markdown
# 《书名》

## 作品信息
- 类型：玄幻
- 字数：XX万字
- 章节数：XX章

## 正文

### 第一卷：XXX

#### 第1章：XXX

正文内容...

#### 第2章：XXX

正文内容...

---

### 第二卷：XXX

...
```

---

## 8. 与逆向分析的对应关系

本世界构建引擎的设计参考了 AI小说家(aixiaoshuojia.cn) 的最佳实践，以下是关键对应：

| AI小说家功能 | StoryForge 对应 | 差异 |
|-------------|----------------|------|
| 世界观10维度 | 完整保留 10 维度 | 数据模型更完整，类型更严格 |
| 11种AI角色人设 | 9种AI角色人设 | 合并/精简了部分重复角色 |
| Vue + Pinia | React + Zustand | 框架不同，架构理念一致 |
| MySQL + 后端 | IndexedDB 纯前端 | 零后端，数据本地 |
| 后端调用 AI | 前端直连 AI API | 用户自带 Key，支持 Ollama |
| 伏笔10种模式 | 完整保留 10 种模式 | 数据模型更结构化 |
| 分批生成大纲 | 完整保留分批策略 | 用户体验优化 |
| "老贼"写手人设 | 保留核心创意 | 提示词重新编写，避免版权问题 |
