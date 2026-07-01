# StoryForge 开发路线图

> 🔒 **接手者必读宪法**: [`/CLAUDE.md`](../CLAUDE.md) — 三注册表铁律 + 动手前的「四问」+ 反面教材
> 📐 **施工权威**: [`docs/MASTER-BLUEPRINT.md`](MASTER-BLUEPRINT.md) — 重构 Phase 0/1/2/3 完整流程
>
> **最后更新**: 2026-06-30（追加社区反馈待修复批次：Windows 启动、细纲采纳、故事主线约束、主题可读性等；施工权威见 MASTER-BLUEPRINT）
> **说明**: 本文档是唯一的功能规划文档。旧文档已归档至 `docs/archive/`。
> **结构**: 上半部分「已完成」，下半部分「待开发」按优先级排列。完成后从待办挪到已完成区。
> **重要**: 任何"加功能 / 修 bug"前，先过 CLAUDE.md 的「四问」。**头疼医头 = 永远拒绝**。

---

# ═══ 已完成 ═══

## ✅ 数据云备份 + 精简瘦身（2026-06-13）

**数据云备份（新功能）**
- 新增 GitHub Gist 云备份：把全部作品数据存到用户自己的 GitHub 私有 Gist，换设备 / 清浏览器 / 换电脑都能一键找回，不再只依赖浏览器本地存储。
- 支持手动备份、一键恢复、自动备份开关（写作时静默同步）。
- **版本历史回溯**：每次备份都自动留一版（GitHub 永久保留），可在「本项目历史版本」里看到全部备份时间点 + 每版增删量，选任意一版恢复为新项目，不覆盖当前项目。约保留最近 ~30 个版本。
- 隐私可控：存的是用户账号下的私有 Gist，需自行填入带 gist 权限的 GitHub 令牌后启用；best-effort，令牌失效或断网时优雅回退不报错。

**精简瘦身（功能整合，无能力损失）**
- 货币设计归并到「经济系统」：不再单列货币面板，货币作为经济设定的一部分统一管理。
- 下线「作品学习」旧模块：五维拆解能力已被「项目参考 → 作品分析」13 维分析完整取代且更细更深，整体移除；原入口自动指向「作品分析」，方法论改由「导入项目参考」选浅 / 深档获得，无需重复操作。DB v32 删 5 张相关表（仅分析数据、非手稿，零手稿风险），表数 44→39。
- 移除 EPUB / HTML 两种导出格式，保留主力导出方式，界面更清爽。

> 三注册表收口完成（PROJECT_TABLES / CONTEXT_SOURCES / 写回点 / json-export 手写枚举四处全清）；tsc / build / 144 项回归测试 / 架构校验 / 数据表校验（39 表）全绿后上线。

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

## ⌧ Phase 19 — 大师研读系统（已于 2026-06-13 下线）

> 五维拆解能力已被「项目参考 → 作品分析」13 维分析完整取代且更细更深，整个子系统于 DB v32 移除（删 5 张表 + 组件 / store / 类型 / 提示词）。历史记录保留如下，新代码勿引用。
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

## ✅ Phase 32 — 真实与幻想（世界规则体系）（2026-05-28）

- 维度级约束声明（15 大类 → ~50 子类 → 提示标签），每个节点独立设置「📜真实 / ✨架空 / ⚖️冲突优先」
- WorldRulesPanel 三栏布局 + 用户自定义节点 + 规则清单实时预览 + Token 估算
- 下游 prompt 全部改为注入 worldRulesContext，取代旧 creativeMode 二选一
- DB v21 新增 worldRulesProfiles 表

## ✅ Phase 28.4 — 导入分卷支持（2026-05-29）

- 卷标题自动检测 + 预览 + 分卷骨架创建 + 章节自动挂卷

## ✅ Phase 30.2 + 30.5 — 角色关系提取 + 导入去重（2026-05-29）

- 角色关系自动提取（大纲+正文 → AI → 智能匹配 → 去重 → 批量导入）
- 导入去重增强（世界观句子级/角色按名聚合/大纲标题去重）

## ✅ Phase 33 — NVIDIA NIM API 接入（2026-05-28）

- NVIDIA NIM OpenAI 兼容接口，预置 7 个模型，本地代理转发

## ✅ Phase 26.3 — 角色驱动剧情模式（2026-05-29）

- 角色初始/目标状态 → AI 推演中间情节 → 卷/章大纲 → 一键导入

## ✅ Phase 26.4 — 灵感反推入口（2026-05-29）

- 碎片灵感 → AI 反推世界观+故事核心+角色 → 分模块/一键采纳

## ✅ Phase 25.4 — 多世界系统（2026-06-02）

- 一个项目管理多个独立世界（诸天流/无限流/快穿/修仙多界）
- 多世界开关（默认关，单世界用户无感）+ 世界总览/详情/切换器
- 每世界独立世界观/力量/地理 + 角色世界归属 + 大纲世界标签
- AI 按世界生成（互不串味）+ AI 建议世界 + AI 扩写世界观
- 世界关系（传送门/飞升通道等）+ 导入导出完整保留
- 详见 `docs/MULTI-WORLD-DESIGN-V2.md`
- 分期 A 地基 / B UI / C 数据隔离 / D AI链路 / E 关系
- **遗留**：灵感反推的多世界变体（与「AI 建议世界」功能重叠，暂缓）；历史年表按世界切换（时间线事件为项目级）；世界关系 SVG 可视化图（当前为列表）

---

# ═══ 待开发（按优先级排列）═══

> 📐 **施工权威已转移**：项目重构请以 `docs/MASTER-BLUEPRINT.md`（v2 · 最终蓝图）为唯一依据。
> 本 ROADMAP 中所有"架构地基级"任务均已纳入 MASTER-BLUEPRINT 的 Phase 0/1/2/3，本节保留索引但不再独立维护。

---

# ═══ 社区反馈批次（2026-06-30 · Windows 启动 / 细纲采纳 / 主线约束 / 主题可读性）═══

> **来源**：2026-06-30 作者转述群内用户反馈 + Codex 本地只读定位。
> **当前状态（2026-07-01 · Claude 已修复一轮）**：
> - ✅ **CF-2 场景采纳崩溃** — 已修复并部署 main（`json→arr` + `normalizeDetailedScenes` 自愈，R-CF2）。
> - ✅ **CF-3 大纲偏离主线** — 已修复并部署 main（卷纲/章纲 prompt 主线硬约束，R-CF3）。
> - ✅ **CF-1 本地启动重定向** — 代码侧已修并部署 main（index.html localhost 注销遗留 SW + 清 Cache Storage，绝不碰 IndexedDB/localStorage；vite `strictPort`；`启动.bat` 端口占用检测）。**bat/exe/SW 在真实 Windows 的端到端验证需用户侧完成**。
> - ✅ **CF-5 灵感反推边界提示** — 已修复并部署 main（输入区适用边界提示 + 超长非阻断警告）。
> - ✅ **CF-7 分发引导** — 已修复并部署 main（README「Windows 一键启动·小白路径」+ bat 诊断）。
> - ✅ **CF-4 主题可读性** — Codex 本批次已做，在 `codex/community-theme-tips` 分支（随该分支合并 main 生效）。
> - ✅ **CF-6 伏笔边界说明** — 显示错位半边由 `d7a252f`(Codex)+`ca61d0f`(Claude 复审修复) 覆盖；作用边界 Tips `0563763` 已加，在 `codex/community-theme-tips` 分支。
> **备注**：CF-1/2/3/5/7 已在 `origin/main`；CF-4/6 待 codex 分支合并 main。原始批次定位见下方各条。
> **重要约束**：① 不改用户正文数据；② 涉及 AI 读写继续走 `CONTEXT_SOURCES / FIELD_REGISTRY / ADOPTION_SCHEMA / adopt()`；③ Windows 启动修复必须覆盖「源码 ZIP + 启动.bat」和「Release Portable + StoryForge.exe」两条路径；④ 主题修复必须按整体色彩系统处理，不能只补单个按钮。

## 附图索引

| 图 | 反馈点 | 截图 |
|---|---|---|
| 图 1 | 自动生成的大纲 / 故事设计与填写主线不一致 | ![自动大纲与故事主线不一致](assets/community-feedback-2026-06-30/CF-20260630-01-story-mainline-outline.png) |
| 图 2 | 用户明确使用源码 ZIP 内的 `启动.bat` | ![源码 ZIP 内启动 bat](assets/community-feedback-2026-06-30/CF-20260630-02-source-zip-bat.png) |
| 图 3 | 章节内「场景细纲 → 一键 AI 拆场景 → 采纳」可复现崩溃 | ![场景采纳用户反馈](assets/community-feedback-2026-06-30/CF-20260630-03-scene-adopt-user-report.png) |
| 图 4 | 报错 `scenes.reduce is not a function` | ![scenes reduce 报错](assets/community-feedback-2026-06-30/CF-20260630-04-scenes-reduce-error.png) |
| 图 5 | 复现路径：章节页右上角展开场景细纲 → AI 生成 → 采纳 → 崩溃 | ![场景采纳复现路径](assets/community-feedback-2026-06-30/CF-20260630-05-scene-adopt-flow.png) |
| 图 6 | Release Portable `StoryForge.exe` 打开后 `ERR_TOO_MANY_REDIRECTS` | ![exe 重定向过多](assets/community-feedback-2026-06-30/CF-20260630-06-exe-too-many-redirects.png) |

## 🔴 CF-20260630-1 — Windows 启动入口 `启动.bat` / `StoryForge.exe` 出现 `ERR_TOO_MANY_REDIRECTS`

- **现象**：
  - 用户 A：下载源码 ZIP，进入 `storyforge-main/storyforge-main`，明确双击图 2 中的 `启动.bat`，浏览器打开后提示 `127.0.0.1` 重定向次数过多。
  - 用户 B：使用 Release Portable 包内 `StoryForge.exe`，打开 `http://127.0.0.1:1111/storyforge/` 后同样提示 `ERR_TOO_MANY_REDIRECTS`（图 6）。
- **本地检查结论**：
  - 当前 `启动.bat` 会执行 `npm run dev`；本地实测 Vite dev 服务：
    - `http://127.0.0.1:1111/storyforge/` → `200 OK`
    - `http://localhost:1111/storyforge/` → `200 OK`
    - `http://127.0.0.1:1111/` → 仅一次 `302` 到 `/storyforge/`，不是循环。
  - `packaging/desktop-server/main.go` 的 Go 启动器在监听 1111 失败时会直接打开浏览器指向 `http://127.0.0.1:1111/storyforge/`，但不会验证占用该端口的进程是否真是可用 StoryForge。
  - `vite.config.ts` 启用了 PWA：`scope: '/storyforge/'` + `navigateFallback: '/storyforge/index.html'`。源码 dev、exe、旧版本都复用本地 `/storyforge/`，浏览器 service worker/cache 有污染风险；curl 看不到该问题，因为 curl 不执行浏览器 SW。
- **初步根因判断**：
  - HTTP 服务端自身没有显式重定向循环；更可能是：
    1. 1111 端口被旧 StoryForge / 其他本地服务占用，当前入口打开了错误服务；
    2. 旧 PWA service worker / Workbox cache 拦截 `/storyforge/` 导航；
    3. `localhost` 与 `127.0.0.1` 混用导致用户侧状态分裂，进一步放大缓存 / 端口混乱。
- **修复方案**：
  1. `启动.bat` 启动前检测 1111 端口占用；占用时清晰提示用户关闭旧黑窗 / 旧 `StoryForge.exe` / 占用程序，不继续误导打开浏览器。
  2. Vite `server.strictPort = true`，避免端口变化但说明仍指向 1111。
  3. 本地环境（`localhost` / `127.0.0.1`）默认不注册 PWA，或启动期自动 unregister StoryForge SW + 清 Workbox cache；**不得清 IndexedDB / localStorage 中的用户作品和 API 配置**。
  4. `StoryForge.exe` 监听 1111 失败时不要直接打开浏览器；先做健康检查，确认该端口返回的是当前 StoryForge，再打开；否则给端口占用提示。
  5. 文档明确区分两种包：源码 ZIP 运行 `启动.bat`；Release Portable 运行 `StoryForge.exe`；不要混用。
- **验证要求**：
  - Windows 环境至少验证：
    1. 无旧进程首次启动；
    2. 1111 被占用；
    3. 浏览器曾安装旧 PWA；
    4. 源码 ZIP `启动.bat`；
    5. Release Portable `StoryForge.exe`。
  - 验证不得依赖开发者本机已有 node_modules。
- **优先级**：🔴 高（新用户第一启动失败，直接影响传播与留存）。

## 🔴 CF-20260630-2 — 场景细纲 AI 采纳后崩溃：`scenes.reduce is not a function`

- **现象**：用户在章节页展开「场景细纲」，点击「一键 AI 拆场景」，生成结果后点「采纳」，页面崩溃并显示 `scenes.reduce is not a function`（图 3～5）。
- **代码定位**：
  - `src/lib/registry/field-registry.ts` 当前将 `detailedOutlines.scenes` 登记为 `json('detailedOutlines', 'scenes')`。
  - `adopt()` 对 `json` 字段的行为是：对象 / 数组会被 `JSON.stringify` 后入库。
  - 因此 `scenes` 原本应该是 `DetailedScene[]`，经过 `adopt()` 后会变成字符串。
  - 渲染端直接调用：
    - `currentDetailed.scenes.reduce(...)`
    - `currentDetailed.scenes.map(...)`
    - `currentDetailed.scenes.length`
    一旦 `scenes` 是字符串就会崩溃。
- **额外问题**：
  - `DetailedOutlinePanel` 与 `ScenePanel` 的「AI 一键拆场景」采纳逻辑当前并没有结构化解析 AI 输出，只是把整段 AI 文本塞进第一个场景的 `notes`。
  - 这与用户对“拆成多个场景卡片”的预期不一致，也会导致后续上下文质量偏低。
- **修复方案**：
  1. `FIELD_REGISTRY` 中 `detailedOutlines.scenes` 改为数组语义，避免被 `JSON.stringify`。
  2. 增加读取兼容：旧库如果已有字符串形式 `scenes`，读取时尝试 JSON.parse 成数组；失败则降级为空数组并提示。
  3. 「AI 一键拆场景」prompt 改为严格 JSON 数组或 JSON 对象，采纳时解析为 `DetailedScene[]`，字段包含 `title / summary / characterIds / location / conflict / pace / estimatedWords / notes`。
  4. `ScenePanel` 与 `DetailedOutlinePanel` 共享同一个解析 / 归一函数，禁止两套采纳逻辑。
  5. 渲染端统一使用 `normalizeDetailedScenes()`，任何 UI 访问前先确保 `Array.isArray(scenes)`。
- **验证要求**：
  - 新增回归测试：
    - `adopt({ target:'detailedOutlines', data:{ scenes:[...] } })` 后 DB 中 `scenes` 仍为数组；
    - 旧字符串 scenes 可被兼容读取；
    - 章节页内嵌 `ScenePanel` 与独立细纲页采纳路径都不崩。
  - 跑 `npx tsc --noEmit`、`npm run check:architecture`、对应 vitest、`npm run build`。
- **优先级**：🔴 高（核心创作链路可复现崩溃）。

## 🟠 CF-20260630-3 — 自动生成大纲与「故事设计 / 故事主线」不一致

- **现象**：用户反馈自动生成的大纲、故事设计里填写的主线不一致（图 1）。
- **代码定位**：
  - 大纲面板直连生成链路会读取 `storyCore`：`OutlinePanel -> assembleContext(sourceKeys:['storyCore', ...]) -> buildVolumeOutlinePrompt(...)`。
  - `formatStoryCoreBlock()` 会输出 `logline / theme / centralConflict / plotPattern / mainPlot || storyLines / subPlots`。
  - 因此不是完全没读故事设计，而是约束强度不足。
- **风险链路**：
  - 大纲面板直接生成：有 storyCore 上下文，但 prompt 只把它作为参考，没有明确要求“必须以故事主线为骨架”。
  - 工作流 / 一键起书：步骤上下文会装配已存设定 + 上一步输出，但内置流程第一步通常只写 `logline`，后续卷纲可能没有强绑定用户后来填写的完整 `mainPlot`。
- **修复方案**：
  1. `outline.volume` 和 `outline.chapter` prompt 增加硬约束：
     - 必须服从 `故事主线 mainPlot`；
     - 每卷 / 每章 summary 必须说明它推进了主线的哪一段；
     - 不得另起主线，不得把 storyCore 当可选参考。
  2. `buildVolumeOutlinePrompt()` 在 `storyCoreContext` 非空时追加「主线一致性硬约束」。
  3. 工作流内置「极速起书」卷纲步骤同步注入同样约束，避免工作流链路绕过大纲面板增强。
  4. 生成结果采纳前可增加轻量提示：如果用户已填写 `mainPlot`，预览区显示“本次生成已使用故事主线：xxx”。
- **验证要求**：
  - 单测 prompt 组装：storyCore.mainPlot 存在时，最终 messages 中必须出现“必须服从故事主线 / 不得另起主线”等硬约束。
  - 浏览器/API 验证至少一次：填写明确主线 → 生成卷纲 → 检查各卷 summary 是否围绕该主线。
- **优先级**：🟠 中高（不一定崩溃，但会破坏核心创作方向）。

## 🟠 CF-20260630-4 — 暖白 / 新增主题整体可读性不足，不能只修单个按钮

- **现象**：
  - 用户反馈暖白主题下「灵感反推」的“开始反推”按钮无底色 / 字看不清；进一步反馈是暖白主题多处文字和按钮都不清楚，不只是一个按钮。
  - 之前新增的「墨墨玉青 / 暖白编辑室 / 冷灰银蓝」三套主题需要整体复查，不能编辑页仍是白纸或按钮色与主题割裂。
  - 熔炉主题暂时观感可接受，应保留。
- **已明确的产品要求**：
  - 主题色彩要系统性设计：基础背景、侧栏、面板、按钮、输入框、正文纸张、正文文字色、用户手动设置的文字颜色 / 背景色，在不同主题下都要可读。
  - 字体颜色和背景色调色板要区分「正文高对比」与「UI 低饱和」，不能把正文标注色做成看不清的色块。
- **修复方案**：
  1. 建立主题 token 检查表：`bg-base / bg-surface / bg-elevated / text-primary / text-secondary / text-muted / border / accent / success / warning / error / editor-paper / editor-ink / mark-bg-* / mark-fg-*`。
  2. 暖白、墨墨玉青、冷灰银蓝、古卷、纸与墨、熔炉逐套检查对比度。
  3. 彩色正文标注采用每主题独立 palette，而不是同一组色在所有主题硬套。
  4. 主题切换后编辑器纸张 / 正文区 / 工具栏必须跟主题统一，不允许三套新增主题编辑页全白。
  5. UI 按钮至少满足“默认态可见、hover 可辨、disabled 不误导、彩色功能按钮不刺眼”。
- **验证要求**：
  - 浏览器逐主题检查：首页 / 设置 / 灵感反推 / 正文编辑器 / 章节页 / 伏笔 / 细纲。
  - 覆盖用户提到的“暖白按钮看不清”和“正文彩色标注看不清”两类案例。
- **优先级**：🟠 中高（不阻塞功能，但影响第一印象和可用性）。

## 🟡 CF-20260630-5 — 灵感反推大文本使用边界需要明确提示

- **现象**：用户把较长网文片段复制进「灵感反推」后，反馈只能识别前半截约 1.2 章。
- **产品决策**：
  - 不把「灵感反推」扩成大文本解析。灵感反推定位是小文本灵感碎片，不支持长篇正文；支持大文本会与「文档解析 / 导入」职责重合。
- **待做**：
  - 在灵感反推输入区加明确提示：适合短灵感 / 梗概 / 片段想法；长篇正文请使用「文档解析 / 项目参考导入」。
  - 若输入超过合理长度，给非阻断提示，而不是静默截断造成误解。
- **优先级**：🟡 中（说明边界，减少误用）。

## 🟡 CF-20260630-6 — 伏笔功能边界与章节关联说明不足

- **现象**：
  - 用户问“自动生成的伏笔怎么添加到对应章节正文里”。
  - 另有反馈：伏笔关联章节显示名称重复 / 与实际章节内容对不上。
- **当前产品逻辑（需在 UI 里讲清楚）**：
  - 伏笔系统当前作为“章节生成上下文 / 写作任务提醒”注入，不会自动改写用户已经写好的正文。
  - 用户可给伏笔指定埋设章节、呼应章节、回收章节；生成 / 续写该章节时，AI 会把这些伏笔任务作为上下文参考。
  - 系统没有“一键把伏笔插入已写正文”的按钮，这一点应明确提示，避免用户期待错误。
- **已知代码风险**：
  - 伏笔关联章节如果显示重复或与实际内容不符，需要检查 `plantChapterId / resolveChapterId / expectedResolveChapterId / echoChapterIds` 到章节 / 大纲节点的映射是否统一使用真实 `chapters` 表和 `outlineNodeId`，不要混用大纲节点标题与章节行标题。
  - 本地分支已有 `fix(foreshadow): align chapter task context`，但仍需 Claude 复审确认覆盖该反馈。
- **修复方案**：
  1. 伏笔页面增加 Tips，沿用其他面板已有 Tips 格式。
  2. Tips 文案说明：伏笔不会自动改写已写正文；它会在对应章节生成 / 续写时作为任务注入；如需插入已写正文，用户需手动或使用后续改稿功能。
  3. 复核章节关联显示：统一章节名来源、去重、避免把同一章显示多次。
- **优先级**：🟡 中（说明不足 + 显示可能错位）。

## 🟡 CF-20260630-7 — Release / 源码 ZIP 分发体验需要整理

- **现象**：
  - 用户不懂命令行，不会 npm，倾向于下载 ZIP 后双击启动。
  - 当前同时存在源码 ZIP 的 `启动.bat` 和 Release Portable 的 `StoryForge.exe`，用户容易混淆。
- **待做**：
  1. Release 页面写清：普通 Windows 用户优先下载 Portable 包并运行 `StoryForge.exe`；开发者 / 源码用户才使用 `启动.bat`。
  2. 源码 ZIP 的 `启动.bat` 增加更强诊断：Node 未安装、npm install 失败、端口占用、浏览器打不开分别提示不同解决方案。
  3. README 首页增加“Windows 小白启动路径”。
- **优先级**：🟡 中（传播期高频问题，和 CF-20260630-1 联动）。

---

# ═══ 社区反馈批次（2026-06-26 · 群内用户 Poseidon）═══

> **来源**：2026-06-26 群内反馈。先记录立项，下一轮排期处理。
> **铁律复述**：① 涉及"从正文/材料提取信息"一律调 AI 禁正则；② 一功能一职责，不新造并行子系统，在现有面板完善；③ 改 DB schema = 数据红线，必写迁移测试 + 导出导入往返。

## 🟡 CM-1 — 灵感反推支持「多次灵感碎片融合 / 随时更新」
- **现象**：用户每天产生多个灵感碎片，希望灵感反推能把前后多次灵感**融合 / 增量更新**，而不是「反推一次就是一次，新反推覆盖生成新的」。
- **现状**：当前逻辑为一次性——每次反推独立生成，不累积、不融合历史灵感。
- **方向（先记，未定稿）**：在现有「灵感反推」功能上做增量——把历史灵感碎片作为一个可追加的输入集，反推时一并喂入 AI 融合，而非新建并行子系统。读经 `CONTEXT_SOURCES`、写经 `adopt()`，不裸写。需先确认碎片存储落点（是否新增字段/表 → 走 PROJECT_TABLES）。
- **优先级**：🟡 中（高频创作诉求，非 bug，无数据风险）。

## 🟡 CM-2 — 文档解析（导入）「长时间加载、无自动跳转」
- **现象**：导入文档时长时间显示「加载中」像卡死；用户重开网页发现其实已解析完成——疑似**解析完成后没有自动跳转 / 状态没刷新**。
- **现状（待查证）**：可能是解析为长任务但完成后未触发 UI 跳转/状态更新；也可能是进度反馈缺失让用户误判卡死。需先复现确认根因（是「真完成但不跳转」还是「进度提示缺失」）。
- **方向**：解析完成 → 明确的完成态 + 自动跳到结果/落地页（或清晰的「已完成，点此查看」），并在解析中给真实进度，避免「假死」观感。**先查根因再定方案，不猜着改。**
- **优先级**：🟡 中（体验明显受损，影响导入主路径）。

---

# ═══ 6 月 17 日 bug 批次（作者集中反馈 · 下一轮优先处理）═══

> **来源**：2026-06-16~17 作者在预览里逐面板实测，集中反馈一大批 bug + 体验问题。本批次**整体优先于**下方所有历史待办，**优先处理完这一版块再动其它**。
> **铁律复述**（每条都要过）：① 涉及"从正文/材料里提取信息"的，**一律调 AI，禁正则**（作者已三次重申）；② 一功能一职责，**不新造并行子系统**，在现有面板上完善；③ 改 DB schema = 数据红线，必写迁移测试 + 导出导入往返；④ 半成品默认隐藏，不摆在正式 UI 误导用户。
> **状态标注**：每条含 `现象 / 原因 / 方案 / 优先级`。优先级 🔴 高（影响核心创作 / 数据正确）｜🟡 中（体验明显受损）｜🟢 低（打磨）。
>
> **当前进度（2026-06-18）**：共 26 项，**✅ 已完成 26 项｜⬜ 待处理 0 项**。
> - `1e9081e`：完成 A-1/G5、A-7/G7，并完成 E-1/B1 的“审校报告跨标签保留”子项。
> - `3d5605c`：完成 A-2/G1、A-3/G2、A-4/G4、A-5/G3、A-6/G6、A-8/G8。
> - `ff98373`：完成 E-1/B1 的共享 AI 生成会话层，覆盖章节待采纳草稿与工作区主面板生成态。
> - `6638c47`：完成 E-2/U1、E-3/B2、E-4/G9；真实 API 验证信仰生成→AI 拆分→采纳→刷新回显通过。
> - `48111b1`：完成 B-1～B-6；真实 API 验证建议总卷数生效、空卷/空章定点补全、生成入口先调参再确认。
> - `f58c0a0`：完成 C-1～C-7（设定库统一 AI 提取：词条拆分/补充标签/地点/状态卡/物品栏/年表/道具文案）；GPT 协作交付，Claude 审查后合入。
> - `refactor/phase-R1-task-D-1`：完成 D-1/R1 角色双轴重构（v33 迁移、迁移前快照、四档分流、九宫格、AI 上下文与关系网迁移）；待审查合并。
> - 全部提交均过：`tsc`、build、vitest（最新 220 项全绿）、`check:architecture`、`check:required-tables`（39 表不变）、`check:ai-manual` 一致；含 `R-review-result-isolation` / `R-JUN17-B-outline-flow` / `R-E-group-ui-and-divine` / `R-ai-generation-session-isolation` / `C-group-extraction` 等回归测试。

## ✅ A 组 · 章节创作区（正文生成 / 去 AI 味 / 审校 / UI 隔离）—— 已完成

### ✅ A-1 `G5` 每章 AI 生成无 UI 隔离，面板"串台"（完成 2026-06-18）
- **现象**：在第 2 章点「生成正文」，切回第 1 章，第 1 章页面上也出现了那个 AI 生成结果板块；切第 3/4 章同样串台。每一章应当是相互独立的工作区。
- **原因**：`ChapterEditor` 把生成态（`ai = useAIStream()`、`content`、`showReviewPanel`、`pendingDiffs` 等）全放在**组件级 useState**，而组件在切章时**不卸载、不按 chapterId 重置**——切章只换了 `selectedChapterId`，残留的流式输出/面板照样显示。
- **方案**：以 `chapterId` 为隔离边界。两种做法择一：① 给 `ChapterEditor` 加 `key={chapterId}` 强制按章重挂载（最简单、最稳）；② 或把流式态收进以 `chapterId` 为键的 store。切章时**必须**清空 `ai.reset()` / 审校 / 去 AI 味 / 状态预览等所有瞬态面板。与 `B1`（一级标签切换丢二级态）是同一类"状态未按上下文隔离"的根因，一并设计。
- **优先级**：🔴 高（直接破坏多章并行创作的正确性）。
- **完成记录**：`ChaptersListPanel` 以 `key={selectedNode.id}` 按章重挂载 `ChapterEditor`，切章时生成草稿和瞬态面板不再串台；自动保存 unmount flush 保证手稿不丢。提交：`1e9081e`。

### ✅ A-2 `G1` 「去 AI 味」点击即执行，应先弹确认（完成 2026-06-18）
- **现象**：点「去 AI 味」按钮直接就开始烧 token 去味，没有任何确认。
- **原因**：按钮 onClick 直接触发 adapter。
- **方案**：点击先弹 `Dialog.confirm`（标题「去除 AI 味？」+ 确定 / 取消），确认后再执行。复用已统一的 `Dialog` 组件。
- **优先级**：🟡 中（避免误触烧钱）。
- **完成记录**：整章/选区去 AI 味均先经 `Dialog.confirm`，确认后才调用 AI。提交：`3d5605c`。

### ✅ A-3 `G2` 「去 AI 味」结果板块无法关闭（完成 2026-06-18）
- **现象**：去味生成后只有「重试」「采纳」两个按钮，没有关闭。有人觉得去味后不如原文，不想采纳，却关不掉。
- **原因**：结果板块缺 dismiss 入口。
- **方案**：结果板块加「关闭 / 放弃」按钮（× 或「保留原文」），关闭即丢弃本次去味结果、回到原文，不写库。同一处的「审校 / 追读力」结果板块（A-7）一并加可关闭能力。
- **优先级**：🟡 中。
- **完成记录**：`AIStreamOutput` 新增可选 `onDismiss`，章节改写结果可直接关闭并保留原文。提交：`3d5605c`。

### ✅ A-4 `G4` 去 AI 味后字数严重缩水（2000+ 字 → 845 字）（完成 2026-06-18）
- **现象**：原文 2000 多字，去 AI 味后只剩 845 字，被大幅压缩。
- **原因**：`anti-ai-adapter` 的改写 prompt **没有对输出篇幅做约束**（adapter 里只有高频词检测的正则辅助，rewrite 段无字数下限 / 相近约束）。
- **方案**：在去味 prompt 里**显式约束**：成稿字数须与原文相近（如 ±10% 区间），**只做风格去味、不删情节不缩写、也不冗余扩写**；把原文字数作为变量传进 prompt 让模型对齐。改 prompt 后跑 `gen:ai-manual`。
- **优先级**：🔴 高（内容被吞 = 不可用）。
- **完成记录**：修正无选区时只取末尾 1000 字的真实根因，改为整章输入；prompt 增加 90%~110% 篇幅铁律，整章结果按全文替换。提交：`3d5605c`。

### ✅ A-5 `G3` 正文区缺字数统计（完成 2026-06-18）
- **现象**：去 AI 味板块有字数统计，但正文编辑区没有。
- **方案**：在正文编辑器工具栏（作者截图红框位置，B/I/H2/H3… 那一行右侧空位）加实时字数统计。复用已有的 `plainText` 计字逻辑。
- **优先级**：🟢 低（小增强）。
- **完成记录**：`RichEditor` 工具栏新增实时正文计字。提交：`3d5605c`。

### ✅ A-6 `G6` 生成的正文段落间有多余空行，过于松散（完成 2026-06-18）
- **现象**：生成正文段落之间有明显空行，排版太散。
- **原因**：生成 prompt / 后处理保留了段间空行（双换行）。
- **方案**：去掉段间空行，一段接一段。优先在**生成后处理 / 渲染**层归一化连续空行（保险，不依赖模型自觉），可同时在 prompt 里要求紧凑排版。注意别误伤需要的分隔。
- **优先级**：🟡 中。
- **完成记录**：采纳 AI 正文前统一丢弃纯空行，再交由段落 CSS 控制间距。提交：`3d5605c`。

### ✅ A-7 `G7` 质量审校 / 去 AI 味 / 追读力 报告收起再展开就消失（完成 2026-06-18）
- **现象**：检测出报告后，点「质量审校」把面板收起，再点开，报告没了（除非再点「开始检测」重出）。三个检测（审校 / 去 AI 味 / 追读力）都这样。
- **原因**：报告结果存在**会随面板 toggle 卸载的组件 state**（`ReviewPanel` / 结果板块 unmount 即丢），没有持久化到 chapter 级状态。
- **方案**：把三类报告结果**持久化**（按 chapterId 存进 store 或 chapter 记录），收起只隐藏不销毁；重新展开直接回显最近一次报告，**仅当用户再次点「开始检测」才覆盖**。与 `G5` 的隔离改造同源，一并做。
- **优先级**：🔴 高（用户辛苦跑出来的报告丢失）。
- **完成记录**：新增 `review-result` Zustand store，三类报告与当前标签按 `chapterId` 缓存；收起、切章、切一级标签后均可回显，重新检测才覆盖。提交：`1e9081e`；测试：`R-review-result-isolation`。

### ✅ A-8 `G8` 审校报告支持 AI 一键修改（参照「去 AI 味」）（完成 2026-06-18）
- **现象**：之前就有用户希望审校出报告后能让 AI 按报告直接改。现已有「去 AI 味」这种"AI 改写"能力，审校也该加。
- **方案**：审校报告下加「按报告 AI 修改」按钮，把报告问题项 + 原文喂给改写 adapter，产出修订稿走「重试 / 采纳 / 关闭」同一结果板块。**追读力暂保持只出报告**（作者明确：审校 + 去 AI 味做好后，追读力自然体现）。
- **优先级**：🟡 中。
- **完成记录**：新增 `review.revise` 动作及“按报告 AI 修改”入口，结果走确认、预览、重试、采纳、关闭的标准闭环。提交：`3d5605c`。

## ✅ B 组 · 大纲生成流程（卷纲 / 章纲 批量化与正确性）—— 已完成

### ✅ B-1 `B3` 建议卷数不生效（设 20 卷只生成 2 卷）（完成 2026-06-18）
- **现象**：右侧设「建议卷数 = 20」，AI 还是只给 2 卷；用户没设时也应能按世界观 / 故事设计合理编排卷数。
- **原因**：建议卷数没真正注入卷纲生成 prompt / 上下文（深层上下文断链）。
- **方案**：① 读取用户「建议卷数」并强约束进卷纲 prompt；② 用户未设时，让 AI **依世界观 + 故事设计合理编排**卷数（而非固定 2）。走 `assembleContext` 注入，不在面板手拼。
- **优先级**：🔴 高。
- **完成记录**：`volumeCount` 进入卷纲硬约束；已有卷数会从目标总卷数中扣除。未启用时改为依据设定合理规划，不再回退固定 2 卷。

### ✅ B-2 `B4` 已有卷时点生成卷纲，重复生成相同的前几卷（完成 2026-06-18）
- **现象**：已有 2 卷，新建第 3 卷后点 AI 生成，又生成了几乎一样的第 1、2 卷。
- **原因**：卷纲生成没把"已存在的卷"作为上下文排除 / 接续，每次从头生成。
- **方案**：生成前注入已有卷清单，要求 AI **接着已有卷往后编排**（或只补空缺卷），不得重复已有卷。
- **优先级**：🔴 高。
- **完成记录**：新增 `existingVolumeOutlines` 注册表上下文源，卷纲生成强制接续已有卷并禁止重复；真实 API 生成只返回后续第 2 卷。

### ✅ B-3 `B6` 新增的空卷无法 AI 生成卷纲（完成 2026-06-18）
- **现象**：手动新增一个空卷后，没有入口用 AI 生成这个新卷的卷纲。
- **方案**：空卷节点提供「AI 生成本卷卷纲」入口，复用 B-1/B-2 的上下文（接续已有卷）。
- **优先级**：🟡 中。
- **完成记录**：空卷显示「AI 生成本卷卷纲」，结果通过 `adopt(recordId)` 定点更新摘要，不新增重复卷、不改用户标题。

### ✅ B-4 `B7` 新增的空章节无法 AI 生成章纲（完成 2026-06-18）
- **现象**：手动新增空章节后，不知如何生成这个新章的章纲。
- **方案**：空章节提供「AI 生成本章章纲」入口（单章），复用所在卷上下文。
- **优先级**：🟡 中。
- **完成记录**：空章显示「AI 生成本章章纲」，固定只生成当前一章并通过 `adopt(recordId)` 定点写回。

### ✅ B-5 `B5` 生成入口"一点就生成"，参数模块形同虚设（完成 2026-06-18）
- **现象**：点「AI 生成章节」时提示词模板才跳出来、且已经立即开始生成，用户根本来不及调参数。
- **原因**：`handleAIChapters` 把 `setActiveModuleKey` + `buildPrompt` + `ai.start` 串成一步立即执行。
- **方案**：改成两步——先展开参数面板让用户调 → 用户点「确认生成」才 `ai.start`。
- **优先级**：🟡 中。
- **完成记录**：卷纲、整卷章节、单卷卷纲、单章章纲统一改为「展开参数 → 确认生成」两步；点击入口本身不调用 API。

### ✅ B-6 `U3` 大纲按钮文案 / 语义批量化（完成 2026-06-18）
- **现象**：文案不统一。
- **方案**：①「AI 生成卷级大纲」→「批量生成卷级大纲」（读建议卷数批量生成所有卷）；②「批量生成所有章节」→「批量生成所有卷的章节」；③ 单卷「AI 生成章节」→「生成本卷所有章节」（= 生成当前卷的全部章节）。
- **优先级**：🟢 低（随 B 组一起改）。
- **完成记录**：按钮统一为「批量生成卷级大纲」「批量生成所有卷的章节」「生成本卷所有章节」。

## C 组 · 设定库各面板（词条 / 道具 / 状态卡 / 物品栏 / 年表 / 地点）

### ✅ C-1 `F1` 词条 AI 拆分（所有词条面板通用）（完成 2026-06-18）
- **现象**：AI 生成"信仰"等内容后，被拆成三个字段就没了下文；希望能直接从上方整段内容里 AI 拆解出一个个词条。所有有词条的地方都要这个能力。
- **原因**：缺"从整段内容 → 结构化词条"的统一 AI 拆分动作。
- **方案**：在词条类面板加「AI 从内容拆分词条」动作（调 AI，禁正则），走 `adopt()` 批量写回词条。注册到 `FIELD_REGISTRY/AdoptionSchema`，一处实现多面板复用。
- **优先级**：🔴 高（用户多次点名）。
- **完成记录**：所有嵌入式词条面板复用统一分块提取，结果先确认再经 `adopt(codexEntries)` 写入；上方全貌自动预填。

### ✅ C-2 `F2` AI 补充词条标签（开关 + ⚠️ 说明）（完成 2026-06-18）
- **现象**：希望 AI 能补充词条标签。
- **方案**：加「AI 补充词条」开关 + ⚠️ 说明（会消耗 token）。依赖 C-1 的词条结构。
- **优先级**：🟡 中（依赖 C-1）。
- **完成记录**：拆分弹窗提供独立开关和 token 警告；标签写入词条并可手动编辑。

### ✅ C-3 `G12` 物品栏：提取准确度与表现重构（完成 2026-06-18）
- **现象**：物品栏提取不够准，展示也不行。
- **原因核查**：提取走 `inventory-extract-adapter`（**确实是 AI，不是正则误用**——里面的正则只用于解析 JSON 围栏），但：① 单章正文被 `maxChars=6000` 截断，长章丢信息；② prompt 质量 / 去重合并待打磨；③ UI 表现简陋。
- **方案**：① 复核分块策略，避免长章截断丢物品；② 打磨提取 prompt + 跨章流水合并准确度；③ 重做物品栏展示（持有数量 / 获得消耗历程 / 时间线）。**保持 AI 提取，不引正则**。
- **优先级**：🔴 高（用户点名"不行"）。
- **完成记录**：取消单章 6000 字截断，按段落/句子分块并跨块去重；整章成功后才替换旧流水；UI 增加持有统计、状态与获得/消耗时间线。

### ✅ C-4 `G11` 状态卡重构为“角色状态卡”（完成 2026-06-18）
- **现象**：当前状态卡杂乱（角色 / 物品 / 地点混在一起，还出现"黑色文件夹"被标成"角色"的错分）。作者期望：状态卡应以**角色**为中心——角色当前状态、所在地点、处于哪段剧情之后、持有哪些物品、归属哪个势力。
- **原因**：状态卡分类 / 字段模型偏松，AI 提取分类不准。
- **方案**：重做状态卡信息架构，以角色为主卡，聚合（状态 / 地点 / 剧情进度 / 持物 / 势力）；提取分类用 AI 严格归类，修正"物品被判成角色"等错分。涉及字段调整 → 过三注册表 + 迁移测试。
- **优先级**：🔴 高。
- **完成记录**：不改 schema，以角色为主卡聚合状态、地点、章节进度、持物与势力；提取以角色名单作白名单，非角色实体不再入卡。

### ✅ C-5 `G13` 剧情大事（故事进程年表）UI（完成 2026-06-18）
- **现象**：剧情大事的展示表现差。
- **方案**：重做时间线 UI（按故事进程排布、重要度标识、关联章节跳转），提升可读性。提取逻辑已是 AI，本条主要是表现层。
- **优先级**：🟡 中。
- **完成记录**：强化关键转折标识、重要度层级与来源章节链接，可一键跳回章节编辑。

### ✅ C-6 `G10` 重要地点 AI 拆解补全（完成 2026-06-18）
- **现象**：重要地点目前只能纯手填，应能让 AI 从已生成正文里分析拆解出地点并补全，同时**保留用户自行添加的自由**。
- **方案**：加「AI 从正文提取地点」动作（调 AI，禁正则），产出地点候选供用户确认写入；手动添加入口保留。与 C-1 同属"从正文 / 内容反推结构化设定"，复用同一套提取 → 确认 → `adopt` 流程。
- **优先级**：🟡 中。
- **完成记录**：逐章分块提取地点候选，合法标签过滤，确认后通过 `adopt(importantLocations)` 写入；手动入口保留。

### ✅ C-7 `U2` 道具面板文案过时（完成 2026-06-18）
- **现象**：道具面板说明里引用了已不存在的「人文主体·人工器物」词条。
- **方案**：更新文案到当前词条体系。
- **优先级**：🟢 低。
- **完成记录**：文案改为当前“道具与器物 · 具体词条”与创作区“物品栏”的实际入口。

## D 组 · 角色设计重构

### ✅ D-1 `R1` 角色设计逻辑重构（戏份 + 阵营九宫格）（完成 2026-06-18）

> 本节是已与作者对齐的**完整施工方案**，按此实现即可。改 DB schema = 数据红线：必写真实老库迁移夹具 + 导出/导入往返 + 迁移前自动快照。**务必等当前所有 schema 改动落地、无并行迁移再动工，避免 version 冲突。**

**现象（根因）**：`Character.role`（6 值 protagonist/antagonist/supporting/minor/npc/extra）**把"戏份"和"阵营"两个正交维度混进一个字段**；`alignment` 只有 good/evil，形同虚设。于是"重要的反派""中立的主要角色"无处安放——这就是"角色逻辑不合理"。

**作者已拍板的设计决策**：
1. 阵营用**完整 DnD 九宫格**（3×3），**必选**（和戏份一样强制选，"绝对中立"也是其中一格，不留空）。
2. **不加主角标记**：主角谁是谁作者自辨；模型只有两个轴（戏份 + 阵营），不引入 `isLead` 之类的额外字段。
3. 戏份四档：主要 / 次要 / NPC / 路人。
4. 「主要角色」面板 → 改成「角色生成页」；新增独立「主要角色」页；戏份与所有读 `role` 的面板**同步迁移**。

**① 目标数据模型（characters 表加 3 个枚举字段，旧 `role` 保留为派生兼容字段）**：

| 维度 | 新字段 | 取值 |
|---|---|---|
| 戏份 | `roleWeight` | `main` 主要 / `secondary` 次要 / `npc` / `extra` 路人 |
| 阵营·道德轴 | `moralAxis` | `good` 善 / `neutral` 中 / `evil` 恶（横轴 = 正派/中立/反派） |
| 阵营·秩序轴 | `orderAxis` | `lawful` 守序 / `neutral` 中立 / `chaotic` 混乱（纵轴） |

- 存两个小轴（moral + order）而非 9 个字符串，便于"筛所有反派 = moralAxis==='evil'"。UI 是九宫格点选，**必填**。
- **旧 `role` 保留并改为派生字段**（由新轴推导），让现有 20+ 个读 `role` 的消费方 v1 阶段零改动，之后再分批迁移。派生规则：`main+good→protagonist`、`main+evil→antagonist`、`main+neutral→supporting`、`secondary→minor`、`npc→npc`、`extra→extra`（多个 main+good 时统一映射 protagonist，因不再用 role 区分唯一主角，无副作用）。

**② 迁移伪代码（schema version +1，只加字段、不删表、不删旧 role）**：
```
for each character:
  roleWeight =
    role in (protagonist, antagonist, supporting) ? 'main'
    : role == 'minor' ? 'secondary'
    : role == 'npc' ? 'npc' : 'extra'
  moralAxis =
    role == 'protagonist' ? 'good'
    : role == 'antagonist' ? 'evil'
    : (alignment == 'good' ? 'good' : alignment == 'evil' ? 'evil' : 'neutral')
  orderAxis = 'neutral'   // 老数据无秩序轴信息，默认中立，用户后改
  // role 字段保留原值；后续写入时由 (roleWeight, moralAxis) 重新派生
```

**③ 逐文件改动清单（协调点 · 已按代码实证列出）**：

| 类别 | 文件 | 现状 | 改法 |
|---|---|---|---|
| 戏份分流面板 | `CharacterMinorPanel`/`CharacterNPCPanel`/`CharacterExtraPanel` | `c.role==='minor'/'npc'/'extra'` 筛选 + 新建时写死 role | 改读 `roleWeight==='secondary'/'npc'/'extra'`，新建写 `roleWeight` |
| 主要角色页 | `CharacterPanel` | 管 protagonist/antagonist/supporting，roster 计数 | 改成「角色生成页」（录入戏份+九宫格阵营后按戏份分流）+ 独立「主要角色」列 `roleWeight==='main'` |
| 属性统计栏 | `PropertiesPanel` | 按 6 值计数 | 改按 戏份×阵营 计数 |
| 主角物品 | `StatePanel` | `role==='protagonist'` 取主角物品 | 改读派生 `role==='protagonist'`（兼容保留）即可，无需新逻辑 |
| AI 上下文 | `DetailedOutlinePanel`（筛 protagonist\|supporting）、`CharacterDrivenPlotPanel`（排除 npc/extra） | 读 role | v1 继续读派生 `role`；v2 迁 `roleWeight` |
| 写回/解析 | `AdoptionSchema`（`required:['name','role']`）、`parse-character-output`、`inspiration-reverse`、`restructure`（默认 `role:'supporting'`） | 产出/默认 role | 改产出/默认 `roleWeight`+九宫格阵营，`role` 转派生写回；`required` 改 `roleWeight` |
| AI 反推别名 | `field-registry` `roleAliases` / `alignment` enum（good/evil） | good/evil + 正派/反派 别名 | 扩成九宫格：moralAxis(善/中/恶·正派→good)、orderAxis(守序/中立/混乱)、roleWeight(主要/次要/NPC/路人) |
| 关系网 | `RelationGraph`、`relation-extractor` | 读 role 上色/标注 | v1 用派生 role；v2 增阵营上色 |

> 其余 summary/emotion-beat/foreshadow/outline/state-extract 等 adapter 通过 `context-builder` 间接拿角色，跟着 `CONTEXT_SOURCES` 角色源走，不单独改。

**④ 三注册表改动**：`FIELD_REGISTRY` 加 `roleWeight`/`moralAxis`/`orderAxis`（带反推别名）｜`AdoptionSchema` characters 的 `required` 从 `role` 换 `roleWeight`（role 派生写回）｜`CONTEXT_SOURCES` 角色源注入带戏份权重 + 阵营立场（让正文更懂人物）｜`PROJECT_TABLES` 不变（characters 已登记，只加字段）。

**⑤ 测试计划** `R-R1-character-axes`：① 迁移夹具（旧 6 值 → 新轴正确）② role 派生正确（main+evil→antagonist）③ 九宫格往返导出/导入 ④ 三分流面板按 roleWeight 正确归位 ⑤ 必填校验（戏份/阵营缺一不可保存）。

**⑥ 排期**：分两阶段——**v1**＝新字段 + 迁移 + 四个分流面板 + 角色生成页 + 主要角色页（role 派生托底，AI 消费方零改）；**v2**＝AI 上下文/关系网迁到新轴 + 阵营上色。

- **优先级**：🔴 高（结构性，工程量大；改 schema，须在无并行迁移的窗口动工）。
- **完成记录**：v33 为角色补 `roleWeight/moralAxis/orderAxis`，旧 `role` 由统一角色轴工具派生；升级事务先写原始角色 marker，开库后完成为可恢复的标准项目快照。角色生成页强制选择戏份与九宫格，新增独立主要角色页，次要/NPC/路人按 `roleWeight` 分流。AI 解析、灵感反推、导入、`CONTEXT_SOURCES` 角色上下文、细纲/角色驱动与关系网已迁到新轴。新增 `R-R1-character-axes` 6 条回归测试。

## E 组 · 全局 UI / 状态 / 文案

### ✅ E-1 `B1` 一级标签切换丢失二级 AI 生成状态（完成 2026-06-18）
- **现象**：在二级标签页下 AI 生成中，切一级标签再回来，生成状态 / 内容没了。
- **原因**：生成态挂在会随标签切换卸载的组件 state（与 A-1/A-7 同根）。
- **方案**：把生成态收进按上下文键持久化的 store，切标签不销毁正在进行 / 已完成的结果。**与 A-1（G5）、A-7（G7）统一设计一套"AI 生成态隔离 + 持久化"机制**，避免分头打补丁。
- **优先级**：🔴 高。
- **完成记录**：新增共享 AI 生成会话层，以 `projectId + moduleKey + entityId` 隔离输出、流状态、错误、token 用量与操作类型；请求控制器脱离组件生命周期，切一级标签后继续生成并可回显。已覆盖章节待采纳草稿及所有使用 `useAIStream()` 的工作区主面板；采纳/关闭才清理，停止保留已生成片段。审校报告缓存沿用 `1e9081e` 的 `review-result` store。
- **验证**：新增 `R-ai-generation-session-isolation` 4 条反例测试；`tsc`、架构检查、required tables、AI manual 校验通过。

### ✅ E-2 `U1` 二级标签栏宽度过宽、不自适应（完成 2026-06-18）
- **现象**：二级标签栏 UI 太宽且不可调（已无三级标签）。
- **方案**：标签栏宽度自适应内容。
- **优先级**：🟢 低。
- **完成记录**：世界起源、自然环境、人文环境、故事设计的二级导航改为 `w-fit/w-max + min/max width`，按标签内容收缩且不挤压长标签；浏览器实测世界起源导航宽度由固定值收缩到 128px。

### ✅ E-3 `B2` 神明信仰采纳后内容消失（完成 2026-06-18）
- **现象**：AI 生成"信仰"拆成三个字段，采纳后内容就没了。
- **原因待查**：需定位这三个字段是什么、采纳写到哪、为何回显丢失（疑似写回 target 字段不匹配或 adopt 别名缺失）。
- **方案**：定位写回路径，补 `FIELD_REGISTRY` 字段 / 别名，确保采纳后正确落库并回显。与 C-1 词条化可能相关。
- **优先级**：🔴 高（数据丢失）。
- **完成记录**：根因是 `FIELD_REGISTRY` 把 IndexedDB 原生对象字段 `divineDesign` 当作 JSON string 存储，刷新后 UI 按对象读取而显示为空。新增原生 `object` 字段类型，`divineDesign/naturalResources` 保持对象写入；store 兼容读取旧 JSON string；采纳流程等待写回完成后再清理生成结果。
- **验证**：真实 API 生成信仰体系 → AI 拆分三个字段 → 采纳 → 刷新，三个字段完整回显；新增对象写回与旧数据兼容反例测试。

### ✅ E-4 `G9` 文风学习「已修改 / 已润色 / 定稿」状态无处可改（完成 2026-06-18）
- **现象**：文风学习要求把章节状态设为「已修改 / 已润色 / 定稿」才能作为语料，但章节页面里**根本没有切换这个状态的按钮**，用户无从设置 → 文风学习永远"暂无可学习章节"。
- **原因**：章节状态机存在（schema 有状态字段），但创作区章节页缺状态切换 UI 入口。
- **方案**：在章节编辑页加章节状态切换控件（草稿 / 已修改 / 已润色 / 定稿…），让文风学习的语料筛选条件可被用户满足。
- **优先级**：🟡 中（否则文风学习功能链路断裂、不可用）。
- **完成记录**：章节标题栏新增“仅大纲 / 初稿 / 已修改 / 已润色 / 定稿”状态选择器，直接写回已登记的 `chapters.status`；不同状态使用一致的语义色。
- **验证**：浏览器将测试章节设为“已润色”并刷新后状态仍保留；文风学习页自动识别为可学习语料。

> **下一步处理顺序（2026-06-18 更新）**：
> 1. ⬜ **大纲生成流程专项 B-1~B-6**：卷数注入、已有卷接续去重、空卷/空章单独生成、生成前参数确认、按钮语义统一。
> 2. ⬜ **设定库提取统一**：C-1 打底，C-6/E-3 复用同一“AI 提取 → 用户确认 → adopt 写回”流程；C-3/C-4/C-5 分别重做数据质量与表现。
> 3. ⬜ **角色重构 D-1**：工程量大且涉及 schema，单独立项、先冻结字段与迁移设计。
> 4. ⬜ **零散打磨**：C-7；A 组与 E 组已全部完成。

---

## 🎯 长期目标 · 长篇一致性引擎（几十万 ~ 百万字内容一致）

> **北极星**：用当前可落地的先进技术，把数百万字长篇小说的长期上下文一致性做到当前可达的最佳效果。
> **状态**：Codex × Claude 已完成多轮红队审查并签字定稿；仓库施工权威见 `MASTER-BLUEPRINT.md` §16。桌面独立文档保留完整论证和审计历史，不再作为隐形施工入口。
> **最终架构**：动态层级计划 + 多层叙事记忆 + 叙事感知混合检索 + 上下文编排 + 证据化校验闭环。时序事实账本是权威状态骨架，embedding 是 NS-5 的远距离语义召回通道，二者都不是单独的万能主干。

### 当前执行路线

> **⚠️ Claude 验证席更正（2026-06-24）**：
> - **评测曾被污染**：原 runner 把夹具的 requiredFacts/Constraints（评分答案）直接注入候选 prompt → 自我实现的循环评测。**故本节下方一切跑分数字（如 NS-0 的 33.3%、NS-1 的"事实提升 25 点 / 成本 1.54×"）全部作废，不可作为收益依据。** 已去污染（候选改为从上一章真实正文跑抽取，绝不喂答案）。
> - **夹具曾无分辨力**：事实塞在正文尾部、总长不足 500，legacy 尾巴照样看到答案。已重建为"事实在前 + 长尾填充"，并加分辨力守卫测试。
> - **代码审查**：NS-2（计划-正文对账，复用 handoff 的验证引文 + 双 hash 失效）、NS-3（证据化校验，逐字验证引文、无证据的 hard 降级 unknown）经 Claude 审查 **架构一致、逻辑正确、无 schema 变更、无裸 db 写**。
> - **NS-1 真实效果**：去污染评测就位后，**诚实 A/B 进行中**（agnes）。NS-1 是否真有收益以这次诚实跑分为准；未出诚实数字前，不进入 NS-4（数据红线）。

- ✅ **NS-0 · 效果基线与评测基础（完成，待 Claude 审查）**
  - 固定 development / held-out 长篇夹具；
  - 当前“500 字尾部”生产管线快照；
  - continuation / expansion / completion runner；
  - 未来泄漏、世界串线、交接约束、跨章事实、证据回指自动评分；
  - 已冻结 NS-1 指标、阈值和成本护栏；正式 held-out legacy 基线为事实召回 33.3%、约束召回 50%、错误世界泄漏 33.3%。
- ✅ **NS-1 · 跨章承接最短闭环（完成，待 Claude 审查）**
  - ✅ T1：非索引 handoff/summary 来源字段、版本化正文 hash、原子 CAS 写回与备份往返；
  - ✅ T2：一次 `chapter.memory` 同时产 summary + continuity handoff，系统回查 evidence quote；
  - ✅ T3：正文 hash 自动 stale、直接前驱同步惰性补建、最近 4 章后台有界补建、真实 tail 降级；
  - ✅ T4/T5：规范大纲树顺序；全局直接前驱 handoff + tail；当前世界 verified recent summaries；三个来源统一走注册表；
  - ✅ T6/T7：8K/32K/128K 最小 envelope、最终请求二次保护、单次注入与 `continuityMode`；
  - ✅ T8：v5 sealed held-out fixed/natural 均达绝对质量与零泄漏门；fixed 事实提升 25 点，输入成本 1.54×。
- ✅ **NS-2 · 计划—正文动态对账（完成，待 Claude 审查）**
  - 一次 `chapter.memory` 同读正文与本章/下一章计划，产出完成、偏移、未完成、新增约束和下一章影响；
  - 所有提示锚定正文逐字证据，正文/计划双 hash 失效，下一章通过注册表优先读取实际进展；
  - 作者可确认附加约束或应用章纲候选；不自动修改正文、不批量改后续章纲。
- ✅ **NS-3 · 证据化一致性校验（完成，待 Claude 审查）**
  - Fast Guard + Deep Audit 已进入质量审校面板；
  - 状态卡、物品流水、年表、关系、伏笔、故事线与章节记忆统一走注册表证据上下文；
  - 无精确正文引文的发现直接丢弃，无有效证据链的 hard 自动降为 unknown，全程只读。
- ⬜ **NS-4 · Evidence Observation + Canon Assertion**
  - 时序有效区间、当前状态投影、作者按例外确认；
  - 真实旧库迁移夹具先于 Dexie 版本；
  - app 内可编辑事实库、人类可读导出、外部编辑以候选 diff 导回。
- ⬜ **NS-5 · 叙事感知混合检索与层级摘要**
  - 章→卷→全书摘要；
  - 实体/关键词/事件/因果/承诺/伏笔/故事线 + embedding；
  - 时间、世界、版本硬过滤，rerank 与稳定降级。
- ⬜ **NS-6 · 全闭环与持续优化**
  - stale 传播、影响分析、待复核章节；
  - 模型/检索/prompt 可比较、可关闭、可回滚；
  - 永不自动级联重写用户正文。

### 永久红线

- AI 读走 `CONTEXT_SOURCES/assembleContext`，写走 `FIELD_REGISTRY + AdoptionSchema/adopt`，新表生命周期走 `PROJECT_TABLES`。
- 不把摘要、embedding、observation 当不可质疑真相；AI 引文必须回查原文。
- 不允许未来章、错误世界或 stale 内容进入当前生成。
- 历史修改只使派生记忆 stale/按需重建；远距离影响只提示作者，不自动改稿。
- 数据安全须通过大项目备份→清空测试库→恢复演练，不能只验收“存在备份按钮”。

---

## 📋 AUDIT — 商业成熟度审查·剩余待办（2026-06-13 立项）

> **来源**：桌面《StoryForge商业成熟度全面审查报告.md》（GPT-5.5 报告 §5/§10 + Claude 复核 §11）。
> **已完成批次（2026-06-13，commit `81f3b1e`，Codex 交付 + Claude 复核合并）**：P0-1 portal 字段名+安全解析+导出导入两阶段 remap｜P0-3 PAT/APIKey 默认 sessionStorage+记住开关+旧 token 迁移｜P0-4 全量 AI 调用补 category + check-architecture 加 category 守卫｜P0-5 全局 `/settings` 路由修引导断裂｜P0-6 historical 多世界过滤（当前世界∪null）｜P1-2 README/AGENTS/refactor 文档同步｜P1-4 真实旧库迁移测试 `R-db-upgrade-fixtures`（v30→31→32）｜P1-5 APIKey/PAT 风险说明 + `R-ai-config-storage`｜P1-6 `trimMessagesToFit` 接 `config.contextWindow`｜新增统一 `Dialog` 组件（替换工作未完成，见下）。
> **下面是经核实仍未做 / 只部分完成的项，按严重度排列。每条含：位置 · 问题 · 改法 · 验收。**

### ✅ AUDIT-1（P0-2 续 · 已完成 2026-06-16）— 导出主体完全注册表派生
- **位置**：`src/lib/export/json-export.ts` → 拆出 `registry-export.ts` / `registry-import.ts`。
- **做法**：① 注册表 `ExportRemapField` 补 `exportAs`（历史导出字段名）+ `onUnmapped`（drop/require/null），`TableSpec` 补 `exportIdField`/`exportOrderBy`/`exportRefRemap`，把全部导出语义收敛进 PROJECT_TABLES 单一事实源；② `deriveExportProjectJSON` 遍历 exportable 表按元数据导出；③ `deriveImportProjectJSON` 按表依赖拓扑排序 + 树内拓扑 + 两阶段 portals 导入；④ `json-export.ts` 两函数转发到派生引擎，**删除 ~580 行手写枚举**，仅保留 `ProjectExportData` 类型契约 + `downloadJSON` 门面；⑤ `check-architecture` ⑤号守卫从「检查手写枚举完整」升级为「类型契约完整 + 导出/导入确由注册表派生」。
- **安全网（数据红线）**：`R-export-fullcoverage`（全 31 表 + 双世界组往返）锁当前行为 → `R-export-derive-equivalence`（派生导出 ≡ 真实旧格式 fixture，逐字段）→ `R-export-derive-roundtrip`（派生往返 + 旧 fixture 向后兼容）。等价仅两处无害差异：派生版去掉了旧版冗余的 outlineNodes/worldNodes 原始 parentId 死字段。
- **验收达成**：新增 exportable 表只登记注册表即自动进出导出/导入；旧备份/Gist 云存档格式不变（fixture 锁死）；往返测试全绿。

### 🟢 AUDIT-1b（AUDIT-1 派生时发现 · 待修）— 细纲数组/JSON 内的角色引用导入未重映射
- **现状**：`detailedOutlines.appearingCharacterIds`（number[]）与 `scenes[].characterIds`（JSON 内）当前导入**未重映射**到新角色 id（注册表 `refs` 已声明为 character 引用，但导出/导入只处理 `exportRemap` 字段，不处理 refs 里的 array/json 引用）。同类：`creativeRules.citedReferenceIds` → references。
- **影响**：导入后细纲「本章出场角色」可能指向错误/不存在的角色。属次要元数据，非正文/主外键，不致命。
- **改法**：派生引擎已统一架构，后续可让 `refs` 中 `kind: 'array' | 'json'` 且指向 exportable 表的引用也纳入导出/导入重映射（开启后 `R-export-fullcoverage` 里被锁的 `appearingCharacterIds` 断言可恢复为「重映射到新 id」）。
- **优先级**：🟢 低（次要元数据，且已有架构支撑，增量小）。

### ✅ AUDIT-2（已完成 2026-06-16 · 核实收尾）— 原生 alert/confirm/prompt 全面替换为 Dialog
- **现状核实（2026-06-16）**：UI 层（`src/components` / `hooks` / `pages`）原生弹窗**已全部替换**——`Dialog` 组件已被 **22 个文件**使用，`check:architecture` ⑥号守卫（禁 UI 层 `alert/confirm/prompt`）持续绿。审查报告时的"约 23 文件"已在商业审查 P0/P1 批次及后续逐步替换完毕。
- **唯一保留**：`src/lib/db/ensure-schema.ts` 的 `window.alert`（DB schema 损坏时的紧急数据保护警告）**有意保留为原生**——它可能在 React 挂载前 / DB 初始化失败时触发，必须脱离任何 React 状态可靠弹出，已有 `typeof window.alert` 安全检查。改 Dialog 反而不可靠。
- **顺带修复**：该警告文案的换行被写成字面 `\n`（双反斜杠 bug）→ 改为真正换行。
- **验收达成**：高风险操作走 Dialog；UI 层守卫绿；唯一原生 alert 是合理的底层数据保护路径。

### ✅ AUDIT-3（决策③ · 已完成 2026-06-16）— 引入 ESLint（先 warning 不 fail）
- **做法**（§11.5 决策③）：装 ESLint 9 + typescript-eslint 8 + eslint-plugin-react-hooks 7 + eslint-plugin-import；扁平配置 `eslint.config.mjs`。**观察期策略**：默认全 warning（噪音大的 `no-explicit-any` 等降 warn/off）、仅 `react-hooks/rules-of-hooks` 设 error；`package.json` 加 `lint`/`lint:fix`；**`lint` 不进 `ci` 脚本**（CI 暂不因 lint fail）。
- **现状基线**：`npm run lint` = 0 error / 29 warning（已 `--fix` 安全项，剩余为观察期允许的真实但低优先问题）。
- **验收达成**：`npm run lint` 可跑；CI 不因 lint fail；rules-of-hooks 为 error 守住。
- **待续**：type-aware 规则（`no-floating-promises` 等）未启用（需 type-checked config，lint 变慢）；`import/order` 已装插件未启用（避免一次性大量重排噪音）。后续清理一轮再收紧 + 接入 CI。

### ✅ AUDIT-4（已完成 2026-06-16 · 安全）— SVG XSS 回归测试 + 清死代码
- **核实现状（2026-06-16）**：① HTML/EPUB 导出**已随 B 段死代码清理下线** → `sanitize-html.ts` 成死代码（生产无引用），本次删除（连带删 `R-18` 里测该死功能的 `sanitizeExportHtml` 用例）；② 真正的 XSS 面是 `GeographyPanel` 用 `dangerouslySetInnerHTML` 渲染 AI 生成的 SVG 概念地图，由 `sanitize-svg.ts` 清洗——它**已是 DOM 解析 + 黑名单剔除**（非 ROADMAP 旧述的"正则式"），比正则可靠。
- **XSS 回归测试（核心交付）**：新增 `R-svg-xss.test.ts`，**11 条**覆盖 script / on* 事件（含根 svg）/ foreignObject / javascript: / data:text/html / iframe·object·embed / SMIL animate·set / style expression·javascript: + **正常地图元素全保留**（defs/gradient/path/polygon/circle/rect/text + 中文）+ 解析失败返回空串。全绿，证明现有清洗对各类 payload 有效。
- **DOMPurify 决策**：实测 DOMPurify 在 happy-dom 测试环境**跑不通**（清洗结果异常），且现有 DOM-based 清洗经 11 条回归测试验证等效；为不引入测试环境兼容风险与冗余依赖，**不引入 DOMPurify**，保留并以回归测试锁住现有 sanitizer。
- **验收达成**：XSS 回归测试绿；渲染入口（唯一 `dangerouslySetInnerHTML`）经清洗不含可执行脚本。

### 🟡 AUDIT-5（3.4 · 新手转化）— 信息架构分层 + 首次成果闭环 + 隐藏未完成入口
- **位置**：`src/components/layout/Sidebar.tsx`（模块极多、默认全展开）、`WorldMapPanel.tsx:152`（"3D 地图开发调优中"仍在正式 UI）、整体缺"前 10 分钟出成果"。
- **改法**：① 侧栏分层（新手/专家模式 + 搜索/命令面板，高级模块默认折叠）；② 首页四主路径（继续写作/新建/导入/配 AI）+ 创作仪表盘（下一步建议/最近章节/待采纳/数据健康）；③ 模板项目/示例工程/一步式创建/第一章生成引导；④ 隐藏或标 Labs 的未完成入口（3D 地图）。
- **验收**：新用户能在 onboarding 内完成"建项目→配 Key→生成/导入→采纳→导出"；首屏信息密度可控。

### 🟡 AUDIT-6（3.5 / P2-2 · 可维护性）— 拆分巨型组件 / prompt 文件
- **位置**：`prompt-seeds.ts`、`json-export.ts`（800+ 行）、大型 panel（多个 600-1500 行混 prompt/UI/业务）。
- **改法**：按领域拆 prompt pack / service / hook / view；大 panel 先拆状态逻辑与纯 UI；形成 use-case/service 层（`importProjectUseCase()` / `generateChapterUseCase()`）。
- **验收**：主要 panel 单文件尽量 <500 行；业务逻辑下沉；测试不退化。

### 🟡 AUDIT-7（P2-1 / 3.7 · 测试与发布护栏）— Playwright 核心路径 E2E + 崩溃上报 + 发布清单
- **改法**：① Playwright 5 条商业级 smoke（建项目/配 AI/生成/采纳/导出导入/备份恢复）；② 可关闭的匿名错误上报或本地诊断包导出；③ release checklist（升级前自动快照、变更说明、回滚方案、已知问题）。
- **验收**：核心路径 E2E 通过；有发布前自动快照与回滚预案。
- **注**：与现有 HEALTH-2/HEALTH-5 重叠，实施时合并推进，勿重复立项。

### 🟢 AUDIT-8（3.3 · 决策待定）— Gist 云备份端到端加密
- **现状**：Gist 上传的是**完整项目 JSON 明文**（Private Gist ≠ 加密保险箱）。
- **决策（§11.5）**：先做"明示风险 + session PAT"（已完成）；**加密作为 Pro/高级选项**，不阻塞当前。需用户拍板是否做、以及密码丢失→无法恢复的取舍。
- **改法（若做）**：用户密码派生密钥加密后上传；UI 明示"上传完整项目 JSON"。

### 🟢 AUDIT-9（P2-5 · 需负责人决策）— 商业法律文本 + LICENSE
- **现状**：无 `LICENSE` / `PRIVACY` / `TERMS` / `SECURITY.md`；`package.json` `private:true` 无 license 字段。
- **依赖决策**：授权策略（开源核心 / 买断 / Pro / 闭源）未定 → 先定策略再补文本（§10.2）。
- **改法**：起草隐私政策 / 服务条款 / 免责声明 / 第三方 API 数据说明 + 应用内入口；定 LICENSE 与漏洞披露渠道。

### 🟢 AUDIT-10（P2-3 / P2-4 · 远期）— 桌面安全版 + 产品级帮助系统
- 桌面壳：Keychain 存钥匙、文件系统备份、自动更新、崩溃日志；帮助系统：内置文档、示例项目、问题诊断、导出诊断包。属"成熟商业产品"阶段，远期。

### 🟢 AUDIT-11（3.4 · 国际化 · 决策待定）— i18n 核心路径
- **现状**：i18n 只是脚手架，绝大多数 UI/提示/错误文案组件内中文硬编码。
- **决策（§11.5）**：先中文商业 Beta；**英文作为后续 milestone**。若上 Steam/海外工具站再做：优先迁首页/设置/备份/导入导出/错误提示/法律文本到 i18n。
- **注**：与 HEALTH-5 的 i18n 渐进迁移重叠。

---

## ✅ FB-11（数据红线 · 已根治 2026-06-13）— 更新后项目数据"重置"/不持久

> 来源：社区群（买辣椒也用券 · LV6 管理员，2026-06-11）。
> 反馈原文：「我连接了本地的文件夹，还照样会重置」。群主（淡然行远）确认需求：**希望每次更新之后能保留项目内的数据**。

**✅ 根因已定位 + 三层修复(2026-06-13)**：
- **根因**：① IndexedDB 从未在启动期申请持久化(`persist()` 只在打开导入面板时调一次)→ best-effort 存储被浏览器在磁盘压力/清理/隐私插件下**驱逐**=「重置」;② 「本地文件夹自动保存」是**只写不读的死信箱**——`handle` 仅存 React state(刷新即丢)、`writeFile` 仅绑定时/手动各写一次(并非"实时/自动")、且**无任何启动回读链路**→ 盘上有备份也不会自动恢复,故「连了文件夹还照样重置」。更新/部署本身不清库(schema 迁移生产 `allowReset=false` 锁死,R-17 守;SW 只管 cache 不碰 IndexedDB)。
- **修复①(防驱逐)**：`main.tsx` 启动期 `navigator.storage.persist()`,降低 IndexedDB 被驱逐概率(纯增量,零数据风险)。
- **修复②(真持久层·根治)**：句柄持久化到**独立 IndexedDB**(`storyforge-fsa`,不进 Dexie 主库/三注册表)→ 绑定跨刷新/更新不丢;启动重新授权(`ensureFolderPermission`);**真·自动写入**(`useFolderAutoBackup`:进项目即写 + 每 5 分钟,`WorkspacePage` 接线);首页**「从本地文件夹恢复」**回读 `storyforge-*.json` → `importProjectJSON` 新建项目(不覆盖)。文件夹卡虚假"实时写入磁盘"文案改诚实。
- **修复③(兜底)**：Gist 云备份(含版本历史)提供离设备副本,与文件夹层互补。
- 文件：`src/lib/storage/folder-handle-store.ts`、`src/lib/storage/folder-backup.ts`、`src/hooks/useFolderAutoBackup.ts`、`DataManagementPanel.tsx`、`HomePage.tsx`、`WorkspacePage.tsx`、`main.tsx`。测试 `R-folder-backup`(句柄存取 + 写盘回读导入往返)。删除只写不读的旧 `useFileSystemAccess.ts`。
> ——以下为原始反馈与排查记录——

> 群主现状说明：「这个目前功能确实没做，因为考虑到项目现在变动很大、时常有大的改动，做起来可能每次更新都要做调整，会比较麻烦」。

**现象**：用户更新（或某些操作）后，项目数据被"重置"/丢失。即便接了「本地文件夹自动保存」，刷新/更新后仍重置。

**待查根因（开发前先定位，别猜）**：
1. **IndexedDB 为何会"重置"？** 正常 IndexedDB 不会因代码更新而清空。需排查：① DB 版本升级迁移是否有清库路径（`ensure-schema.ts` 的 `allowReset` 逻辑；R-17 已锁"生产不自动删库"，但要复核新版升级链）；② 浏览器是否在清站点数据；③ 是否某次失败的 import/迁移把数据清了。
2. **「本地文件夹自动保存」是否只"存"不"自动恢复"？** File System Access 写盘后，**打开项目时是否会自动从该文件夹回灌数据**？若只单向写盘、不回读，则 IndexedDB 一旦丢失，盘上的备份也不会自动恢复 → 用户感知为"还照样重置"。
3. 「导出的也会被重置吗？」（群主提问）— 导出文件是落盘的快照，不会被重置；问题在 IndexedDB 这一侧的持久性 + 自动恢复链路。

**改法方向（待评估）**：① 先定位"重置"的真实触发点（最高优先，可能是数据红线 bug）；② 给「本地文件夹自动保存」补「打开时自动从绑定文件夹恢复/对账」的回读链路，做成真正的"持久层"；③ 评估"更新后保留数据"的稳态方案（IndexedDB 持久化授权 `navigator.storage.persist()` + 文件夹双向同步）。
**优先级**：数据丢失属红线,但群主因"项目变动大、每次更新都要调整"暂缓——**留待项目结构稳定后专项开发**。开发前必须先复现并定位"重置"根因。

---

## 🟡 ENH-WORLDMAP-2（世界地图增强 · 段二 · 方案待定）— 地图忠实还原"距离 / 规模 / 相对位置"

> 段一已完成部署（2026-06-12）：地图生成已"读全"用户已填内容（自然/人文全貌 + **城池重镇** + **自然资源** + **自然/人文词条** + 重要地点，按当前世界作用域），提示词改为"尊重用户已设定的名字/数量、缺的才补全"。R 测试 `R-worldmap-read-all` 锁住。
> 文件：`src/lib/ai/adapters/voronoi-map-adapter.ts`、`src/components/geography/WorldMapPanel.tsx`。

**段二要解决的核心问题（段一没解决）**：当前地图引擎（`src/lib/world-map/engine`，Voronoi）是**纯程序化**的——只接受宏观参数（海陆比/大陆数/国家数/城池密度）+ 地形模板 + 名字列表（stateNames/burgNames/riverNames），**位置/形状/相邻关系全由种子随机生成**。所以即便读全了内容，**用户描述的空间结构（谁在东、谁在西、河从北到南、两地相距多远、各地规模大小）仍不被还原**——名字对、布局随机。

**需求（明确）**：
1. **规模**：每个地点按类型/描述归到规模档（超级大陆/帝国/王国/省/大城/重镇/镇/村/要塞）→ 决定地图上标记大小、占地范围、字号。
2. **距离**：三种来源按优先级落实——① 用户**显式距离**（"三月路程""百里"）解析成数值；② **相对关系**（东/西/接壤/隔着X、远/近档）；③ 都没给则 AI 在不冲突前提下合理补全。**绝对公里数除非用户给否则为估算，但相对距离必须正确。**
3. **相对位置**：用户写明的方位关系（A 在 B 之东）必须体现。

**候选方案（待定，需详细技术设计 + 工作量评估）**：
- **AI 抽"空间关系图"(定性) → 代码"约束布局"成坐标(定量) → 渲染**：
  - AI 从用户文本（全貌 + 词条 + 重要地点）抽取每个地点的：规模档、相对方位、距离档/显式距离、相邻关系；
  - 用约束布局（力导向 + 方位/距离约束，或极坐标/网格分配 + 冲突消解）把关系落成画布坐标；
  - 比例尺（km/像素）从"疆域尺寸"或用户给的任一已知距离锚定。
- **前提**：当前 Voronoi 引擎不接受指定坐标 → 须在引擎之上**加一层"按 AI 关系约束放置命名实体"的布局层**，或改造/替换引擎。**这是工程量大头。**

**已知难点（设计时必须面对）**：① 引擎纯程序化、不吃坐标；② 用户空间关系常不全/矛盾，需 AI 补全 + 冲突消解；③ 距离多为定性，只能保证相对正确。
**优先级**：🟡 中（地图是亮点功能，但工程量大）。**铁律延续段一**：读全用户已填、已填优先尊重、缺的才补全，绝不无视已填瞎发挥。

---

## 🟢 ENH-OUTLINE-1（提示词增强 · 低优先 · 部分完成 2026-06-16）— 把"番茄方法论卷纲"精华内化进纲要提示词

> **已内化(2026-06-16)**：`OUTLINE_SYSTEM` 已吸收番茄方法论的「情绪公式(蓄力→爆发→余韵)、爽点密度(每3-5章钩子)、必含结构要素(坠落时刻/选择困境/信息差/伏笔/悬念交替)、节奏段设计(开局蓄力/矛盾升级/高潮爆发/收尾过渡)」;`outline.volume` summary 要求升级为「4-6句覆盖核心冲突+情绪走向+主角变化+卷末钩子」。JSON 输出格式与 `parseVolumeOutlineSmart` 未变。
> **待续**：「全局骨架先行」那层(一句话主线/升级体系坐标/核心角色总表/伏笔总表 作为生成卷纲前的前置结构)尚未并入——需复用既有 storyCore/foreshadows/角色数据源,避免另起并行结构。优先级仍 🟢 低。

> 来源：社区 PR #12（minemine-m / Criska，已 superseded 关闭）随带的 `public/prompt/卷级大纲.md`。
> 该文件是**死文件**(App 不加载,运行时提示词在 `src/lib/ai/prompt-seeds.ts` 的 seed 里),内容是一套较完整的番茄小说平台卷纲方法论,值得**取精华内化**,而非整体替换。

**素材出处**：已关闭的 PR #12 diff(`gh pr diff 12`)里的 `public/prompt/卷级大纲.md`。其精华结构：
1. **理念**：卷纲意义大过大纲——更灵活、节奏更稳；大纲只精炼主线,卷纲才是写作蓝图。
2. **全局骨架先行**(生成卷纲前先建立)：① 一句话主线(≤30字 = 主角身份+核心行动+驱动动机)；② 升级体系(坐标点式成长路线,每点一次成长)；③ 核心角色总表(身份标签/与主角关系/核心作用/登场卷/退场或转变卷)；④ 伏笔总表(全书串联：埋入卷章 / 揭开卷章 / 内容 / 揭开效果)。
3. **逐卷详细大纲**：全书 4-6 卷,每卷约 15-30 万字(约 50-100 章),逐卷模板输出。

**改法方向(取精华、调现有,守铁律)**：
- 主要落点 = `prompt-seeds.ts` 的 `outline.volume` seed(`OUTLINE_SYSTEM` + user 模板)。把"全局骨架先行"(一句话主线/升级体系/角色总表/伏笔总表)的引导并进去,提升卷纲的结构性与节奏稳定性。
- **必须适配现有 I/O,不可照搬**：现有 `outline.volume` 输出走 JSON、变量是 `{{worldContext}}/{{storyCore}}/{{characterContext}}/{{worldRulesContext}}/{{estimatedVolumes}}` 等,且卷数由 `targetWordCount` 推导(`Math.ceil(/300000)`)。新提示词不能破坏 JSON 解析(`parseVolumeOutlineSmart`)与采纳写回(`adopt → outlineNodes`)。
- 顺带可调 `outline.chapter`(本次 FB-12 已强化"锁卷+章节数"),让卷纲→章节的"全局骨架/伏笔"信息能向下游衔接。
- 注意与现有"故事核心(storyCore)""伏笔系统(foreshadows 表)""角色总表"的概念**不要重复造**——番茄的"角色总表/伏笔总表"在本项目已有对应数据源,优先引用既有上下文,避免让 AI 在提示词里另起一套并行结构。

**完成判据**：seed 更新后 `parseVolumeOutlineSmart` 仍能解析、采纳仍正常写库;新增/更新一条 R 测试验证渲染含全局骨架引导且 JSON 输出格式未变;tsc+build+测试+架构+表 全绿。
**优先级**：🟢 **低**(作者明确「优先级比较低」)。属体验/质量增强,非 bug,无数据风险;排在数据红线类(FB-11)与功能性反馈之后。

---

# ═══ 社区反馈批次（2026-06-09 · 群内用户反馈）═══

> 来源：社区群内真实用户反馈（light莫言 / 江也 / 你的生命过客 等）。
> 本批次共 5 条，已逐条对照「重构版三注册表架构」给出根因与改法。**所有改法必须过 CLAUDE.md「四问」**。
> 处理顺序：先修 P0 数据/正确性 bug（FB-1），再做用户高频功能（FB-2/FB-5），最后做大消耗特性（FB-4）。

## ✅ FB-1（P0 重大 bug · 已修复 2026-06-09）— 工作流多步链：第 2 步「世界起源」串到别的书 / 不读第 1 步

> **修复分支**：`fix/fb-1-workflow-context`。**网络抓包现场验证(NVIDIA llama-3.3)**：修复前步骤2请求 `小说名称/类型/维度` 全空、无步骤1内容；修复后步骤2请求含 `小说名称：测试 / 小说类型：other / 维度：世界起源 / 已有世界观设定 + 步骤1故事核心`。
> **改动**：①`WorkflowRunner.tsx` 用 `useRef` 累加器替代陈旧 `results` 闭包(缺陷A);②每步走 `assembleContext` 注入项目设定+真实与幻想规则,并补 projectName/genres/dimension(缺陷B);③整形纯逻辑抽到 `workflow-helpers.ts:assembleWorkflowStepVars`(可测)。④反例测试 `tests/regression/R-WF-*`(5条)。**零新增组件文件,改入口+加一行注册表式调用。**

### 〔原始记录〕

> 反馈人：江也（截图：模板|工作流，步骤 1「一句话故事」→ 步骤 2「世界起源」`worldview.dimension`）。
> 原话：「到第二步生成世界起源时，没有根据第一步一句话故事的背景生成，反而跟我创建的其他书籍背景混乱了」。群主判定「隔离没做好，属于重大 bug」。
> 文件：`src/components/settings/prompt/WorkflowRunner.tsx`

**已定位的两个真实根因（读代码确认，非猜测）**：

1. **缺陷 A · `results` 闭包陈旧（串味真因）**：`runStep(idx)` 第 222 行用 `await runStep(idx+1)` 递归推进下一步，但第 196 行 `results.get(prevStep.stepId)` 读的是**渲染闭包里的旧 `results`**。`setResults` 是异步的，下一步执行时上一步的 `output` **还没进 state** → `previousOutput` 永远取不到 → 模板里 `{{worldContext}}` 为空 → AI 失去本项目依据 → 自由发挥/套用模板示例，被用户感知为「串到其他书」。
2. **缺陷 B · 工作流未走 `assembleContext`（违反第一铁律①）**：每步 ctx 只塞了 `previousOutput`+`userHint`，`{{projectName}}`/`{{genres}}`/`{{worldContext}}`/`{{dimension}}` 全空。这是 Phase 1.3b「生成入口切换到 assembleContext」**只切了章节正文、漏切工作流入口**的遗留。

**改法（贴合三注册表）**：
- **修缺陷 A**：用**局部累加器**在递归链内传递每步输出（如 `runStep(idx, accOutputs: Map)`），不依赖 React state 读上一步结果；或改递归为 `for` 循环 + 局部变量。确保「上一步 output → 下一步 inputMapping」严格生效。
- **修缺陷 B（四问①）**：每步执行前调用 `assembleContext({ projectId, worldGroupId, sourceKeys: [...] })`，把项目级上下文并入 ctx；步骤声明里补 `dimension`（如「世界起源」）等模板必填变量。**不在 WorkflowRunner 里手挑 buildWorldContext**，一律走注册表。
- **反例测试（防复现）**：新增 `R-WF-1` —— 构造两步工作流（step1 输出固定串 X → step2 模板含 `{{worldContext}}`），断言 step2 渲染出的 messages **必含 X**；`R-WF-2` —— 断言 step2 ctx 中 `projectName` 等于当前项目名（隔离）。
- **完成判据**：① 两步工作流第 2 步稳定读到第 1 步输出；② 不同项目运行同一工作流，上下文互不串台；③ tsc=0 / build OK / 新增反例测试绿。

## ✅ FB-2（完成 2026-06-13）— 大纲章节「拖动排序 / 任意位置插入」

> 反馈人：light莫言。原话：「大纲里面添加章节，能不能弄一个拖动章节位置的功能，现在添加章节只能添加在最后，有时候想自己添加章节很麻烦」。群主已答应「这个可以有」。

**✅ 已实现(2026-06-13)**：
- **拖动排序**：原生 HTML5 DnD(零依赖),抓行首拖拽手柄(⠿)拖、整行作放置区。覆盖三处:侧栏**卷列表**、卷内**直挂章节**、**故事块内章节**——均限同级(同 parentId)排序。
- **任意位置插入**：每行 hover 出「在下方插入一章」按钮,插到该行之后,同级 `order` 自动重排 0..n-1 连续无重复。
- store 新增 `reorderNodes(orderedIds[])`(同级 order 重写,事务内 bulk update)+ `insertNodeAt(node, siblingIds, index)`;沿用 outline store 既有「用户编辑走 store 直写」模式(与 `updateNode` 一致,非 AI 写回故不过 adopt;`check:architecture` 已绿)。复用 helper `computeReorder` 纯函数。
- 文件：`src/stores/outline.ts`、`src/components/outline/OutlinePanel.tsx`、`src/components/outline/useDragReorder.ts`(新)。测试 `R-FB2-outline-reorder`(computeReorder + reorderNodes 持久化 + insertNodeAt 中间插入)。预览实测插入端到端正确。
> ——以下为原始记录——
> 文件：`src/stores/outline.ts`（已有 `order` 字段 + `.sortBy('order')`）、`src/components/outline/OutlinePanel.tsx`

**现状**：`outlineNodes` 已有 `order` 字段、按 order 排序，但只支持「追加到末尾」，无拖动重排、无指定位置插入。

**改法（四问③ 走 PROJECT_TABLES / 四问②走 adopt）**：
- store 新增 `reorderNodes(projectId, parentId, orderedIds[])` 与 `insertNodeAt(node, index)`：**批量重写同层 `order`** 字段。写回经 `adopt({ target: 'outlineNodes', mode: 'update' })`，不裸 `db.outlineNodes.update`（守 CI 架构 lint）。
- UI：OutlinePanel 同层节点支持 HTML5 drag-and-drop 或既有依赖中的轻量 dnd；拖动结束 → 计算新 `order` 序列 → 调 `reorderNodes`。
- 注意多世界：`order` 重排须限定在「当前 worldGroupId + 同 parentId」范围内，避免跨世界错排。
- **完成判据**：拖动后顺序持久化、刷新不乱；可在任意两章之间插入新章；导出/导入后顺序保持。

## ✅ FB-3（完成 2026-06-11）— 「下游自动总结字段」应允许用户自行编辑（核心落点：章节大纲）

> **收尾(2026-06-11)**：可编辑+保存此前已由 `41661ef`（BUG-INPUT-WITH-GEN）在 `OutlinePreview`（多行 textarea）落地;本次补完主面板 `OutlinePanel` 的 `ChapterRow`——章节摘要由**单行 `<input>`(CInput) 升级为多行自增 textarea + 本地草稿 + 失焦保存**(IME 安全),用户主要看章节列表的地方现在也能舒服地改 1-2 句大纲。
> **「不被 AI 无脑覆盖」已坐实**:全项目搜查确认无任何 AI 下游会自动回写 `outlineNode.summary`(仅用户手编 + 导入去重回填);重跑「章节大纲展开」靠 FB-10 的 skip-by-title 策略拦截同名章节,手改摘要不被覆盖。测试 `R-FB3-chapter-summary-editable`(手改持久化 + 重采纳不覆盖)坐实。
> 部署:待提交。下方保留原始反馈记录。

---

## ✅ FB-3 原始记录（部分已修 2026-06-09）— 「下游自动总结字段」应允许用户自行编辑（核心落点：章节大纲）

> **⚠️ 记录更正（2026-06-09）**：本条最初被误标为「世界起源字段可编辑」。经 light莫言完整对话核对，其指向的真实落点是**「章节大纲（章节自动生成的摘要）」**，不是世界起源。群主回复「这个位置读上游数据自动总结生成」正对应章节大纲。原误判已更正。
>
> 反馈人：light莫言 + 江也（「对，可以选择自行更改」）。
> 原话(light莫言)：「那个**章节自动生成的章节大纲，最好也能更改**。因为有时候章节名字看起来还可以，但是章节大纲又有问题，要反复生成查看」「就是这个，只要添加一个可自行更改就可以」。

**用户诉求（明确）**：章节大纲/章节摘要这类「读上游内容自动总结生成」的下游字段，当前 UI 上**不能手动改**（或改了不保存）；用户希望能**手动编辑并保存**，不必为了改一句话反复整章重新生成。

**与既有条目的关系**：本质是 `BUG-INPUT-WITH-GEN` 通用原则的一个具体落点——「下游自动总结字段应可手改，且手改后不被下次 AI 生成无脑覆盖（带 currentValue 改写而非另起）」。需在 BUG-INPUT-WITH-GEN 实施时把**章节大纲字段**列为首批审计对象。

**已顺带修的相邻缺口（storyCore，非本条）**：`WorldviewOriginPanel.tsx` 世界起源/神明生成已补 `assembleContext({ sourceKeys:['storyCore'] })` 带上「一句话故事」。这是 FB-3 排查时发现的相邻问题，已修，但**不等于** FB-3 本身（章节大纲可编辑仍待办）。

## 🟡 FB-4（大消耗特性 · 需评估）— 原稿上传后「按原作风格+剧情续写」

> 反馈人：大佬 / 江也。诉求：上传原稿后，AI 接着上一部作品的结局、按原作者风格与剧情**续写**。群主已答复：现有「作品学习」侧重手法技巧分析，未做「直接用原剧情续写」；上下文消耗大（需提取整本并随时调用）。江也表示用 DS、成本可接受。
> 关联：`src/lib/master-study/*`（作品学习系统，已具备分块/五维分析/Blob 持久化地基）

**改法（建议立项 Phase 42，分两段）**：
- **段一·剧情记忆**：在「作品学习」已有分块/向量化基础上，新增「剧情主线提取」产物（人物/事件/结局状态），作为一个**新的 `CONTEXT_SOURCE`**（如 `masterPlotMemory`）登记进注册表 ①。
- **段二·续写入口**：创作区新增「续写上一部」动作，`assembleContext({ sourceKeys: ['masterPlotMemory', 'masterStyleMetrics', ...] })` 召回剧情记忆+风格画像 → 注入续写 prompt。**严禁**在面板里手拼整本原文。
- **成本护栏**：默认走「提取后的结构化记忆」而非全文回灌；UI 明示预计 token 量级，让用户知情。
- **依赖**：建议在 FB-5（文风画像）落地后做，二者共享「风格画像」基建。

## 🟢 FB-5 段一（已完成 2026-06-11）— 创作区「自适应文风学习」（按用户改稿前后学习其文风）

> **段一·基础版已落地**:创作区新增「文风学习」面板——自动取 `status∈{revised,polished,final}` 的章节为语料,用 **AI**(新 `style.learn` 模块)总结出**文风画像**(用词/句式节奏/对话/描写/标志性表达/倾向禁忌),存 `userStyleProfiles` 表(每项目单例)。画像**可手改**、可开关注入。开启后,章节正文/续写/扩写/润色/去AI味生成自动注入新 CONTEXT_SOURCE `userStyleProfile`。
> 守三注册表:表→PROJECT_TABLES(`userStyleProfiles`,exportable,删除级联;导出/导入手写枚举处也已补)+ schema v30(纯新增空表);读→CONTEXT_SOURCES(`userStyleProfile`,enabled 才注入);写→store upsert(仿 worldRulesProfiles 先例,整份生成文档)。文风总结**用 AI 不用正则**(守全局铁律)。
> 测试 `R-FB5-style-profile`(持久化/注入开关/导出往返+删除级联)。部署:待提交。
> **段二/段三待续(本条降级为 🟢,留 ROADMAP)**:改前/改后 few-shot 动态构建、重写-对比-追问互动校准、个人写作向量知识库;FB-4 原稿续写共享本画像基建。
> ——以下为原始反馈与设计记录——

## 🟡 FB-5 原始记录（高价值功能）— 创作区「自适应文风学习」（按用户改稿前后学习其文风）

> 反馈人：你的生命过客（管理员）。诉求：AI 生成前 5 章 → 用户去 AI 味 + 亲自改 → 让 AI 对比「改前/改后」学习用户文风习惯 → 后续章节按此文风生成（一种自我学习）。群主已答应「记一下，之后开发」。

**改法（建议立项 Phase 43，纯三注册表范式）**：
- **新增上下文源（注册表①）**：`userStyleProfile` —— 由「用户已定稿章节」+（可选）「改前/改后对照」经 **AI 总结**出用词习惯/句式/节奏画像（**严守全局原则：用 AI 总结，不用正则统计**）。产物存新表（注册表③登记 owner/worldScoped/exportable）。
- **注入下游（注册表①）**：章节正文生成时 `assembleContext({ need: [..., 'userStyleProfile'] })` 自动带上文风画像，无需面板手挑。
- **触发方式**：用户在创作区点「学习我的文风」→ 选取已定稿章节（或自动取最近 N 章定稿）→ AI 产出画像 → 写回经 `adopt()`。
- **与 FB-4 的关系**：FB-5 学「用户自己的」文风，FB-4 学「原作者的」文风+剧情，二者共用「风格画像」数据结构与召回链路，建议合并基建、分别立项。
- **完成判据**：开启后，新章节生成在 prompt 中可见文风画像注入；关闭则不注入；画像随项目导出/导入。
- **设计输入(社区第2批 · 2026-06-09)**：群内已细化出 5 种实现路径,纳入本条设计参考——①修改注释+规则提炼(改稿时标一句修改理由,AI 提炼显式写作规则)②个人风格卡 Style Card(禁用词汇/句式偏好/描写习惯/叙事节奏,作系统指令前缀)③基于修改片段的 few-shot 动态构建(只提取 3-5 组「原文↔改文」对照,省 token)④「重写-对比-追问」互动校准⑤个人写作知识库(向量库存「原文-改文」配对,按情节检索)。建议落地顺序:②③(轻量、立即可用)→ ①④(交互)→ ⑤(长篇长期方案)。

## ✅ FB-6（已修复 2026-06-09）— 分块导入：大纲只显示第 1 块，第 2~10 块丢失

> 反馈人：Poseidon / zzjj。现象:导入《一念永恒》(1-500章,459,725 字)分 10 块全部成功,任务汇报"**大纲节点累计 116 个**",但「大纲」面板里**只出现"第1-14章(第1块)"这 1 个卷(15 章)**,第 2~10 块的大纲全不见。
> 文件:`src/lib/import/chunk-writer.ts`(写大纲)、`src/lib/import/dedup.ts`(去重)、`src/lib/import/pipeline.ts`(逐块调度)

**已确认证据**:逐块日志显示"块10完成·入库 大纲8"——**节点确实经 `adopt({target:'outlineNodes'})` 写进了 DB**(写入路径合规,走了注册表),所以不是没写,而是**被跨块去重误杀 / 卷结构不一致导致不显示**。

**两条待验证根因(按嫌疑排序)**:
1. **跨块卷去重过激**:`chunk-writer.ts` 写顶层卷时,先 `findVolumeId` 做模糊 `includes` 匹配(行192-193),再 `checkOutlineDuplicate` 做 bigram 相似度(阈值0.8,行230)。各块卷标题("第1-14章(第1块)"/"第15-28章(第2块)"…)字符高度重合,**有概率被误判为同一个卷 → 后续块的卷被跳过创建,其章节挂到第1块下或被连带去重**。卷本不该按标题相似度去重。
2. **逐块卷结构不一致**:`isVolume = type==='volume' || children.length>0`(行204)。若某些块 AI 没返回包裹卷(返回扁平章节列表),这些章节会以 `parentId=null` 写成顶层章节,大纲面板按"卷→章"渲染时可能不显示。

**改法方向(待复现后定)**:
- 卷的跨块身份不能靠"标题模糊相似",应按**显式块序号/章节区间**作为卷的稳定标识(如 `sourceChunkIndex` 或卷标题精确等值);**卷类型节点豁免 bigram 相似度去重**(只对章节做去重)。
- 保证每块章节都落在一个合法卷下(缺卷时按块合成"第N块"卷)。
- **验证手段(无需真实 AI)**:写单测,给 `applyChunkResult` 喂 10 份合成 chunk 结果(卷标题相似),断言最终 DB 里有 10 个卷、章节总数=各块之和、无误并。**先复现再改**。

## ✅ FB-7（已修复 2026-06-09 · 见 BUG-INPUT-WITH-GEN）— 提示词库工作流"输入不了文本"

> 反馈人：LV4 用户。"这里的提示词库工作流输入不了文本是什么原因"——工作流步骤卡是只读的(只显示 AI 输出 + 重新生成),用户无法在步骤里预先输入自己的内容(如一句话故事)。
> **这正是 `BUG-INPUT-WITH-GEN` 点名的"重灾区"**(见下方「优先级:高」)。本条与之合并,并**再次抬升其优先级**:已有至少 3 位用户(含本条)因工作流步骤不能输入而受阻。
> 改法见 BUG-INPUT-WITH-GEN:给每个步骤卡加可编辑输入框,点生成时把用户输入并入 ctx。

## ✅ FB-8（已修复 2026-06-09）— 本地/自定义模型上下文窗口可配置(原误判为 8K)

> 反馈人：zzjj。本地 LM Studio 跑 Qwen3 35B,Context Length 设到 170K(模型支持 256K),但 StoryForge 上下文预算面板显示"模型窗口 8.0K"并报"⚠️ 上下文超出窗口限制 超出 4.8K token"。
> 文件:`src/lib/ai/context-budget.ts`

**已确认根因**:`getModelPreset(provider, model)`(行82)对未知模型**兜底 `maxContext: 8_000`**(行90)。本地/自定义模型(LM Studio、第三方中转、新模型)匹配不到预设表,一律退回 8K → 明明 256K 的模型被当成 8K,触发假"超窗"警告并可能过度裁剪上下文。**且当前没有让用户手填模型窗口的口子。**

**改法(加字段,不新建文件 · 守"改一处")**:
- AI 配置(`ai-config` store)新增可选字段 `contextWindow`(maxContext)与可选 `maxOutput` 覆盖;
- `getModelPreset` 或预算解析处:**用户显式设置 > 预设表 > 8K 兜底**(用户填了就以用户为准);
- 设置区"AI 模型配置"加一个"上下文窗口(高级,可选)"输入框,提示"本地/自定义模型请按实际填写,如 131072";
- **完成判据**:本地模型填 170000 后,预算面板按 170K 计算,不再误报超窗。

**✅ 已修复(2026-06-09,分支 `fix/fb-8-context-window`)**:AIConfig 加 `contextWindow` 字段;`calculateBudget` 优先级 用户>预设>8K兜底;设置区加"上下文窗口(高级·可选)"输入框;单测5条(含误报超窗复现)。验证全绿。

## ✅ FB-9（已修复 2026-06-09）— 场景细纲(detailed outline)不被正文生成吃进去

> 反馈人：zzjj。诉求:"让 AI 在生成正文的时候去吃这部分细纲的信息挺重要,这样用精度高的模型、较小上下文就能生成好文字"。
> 文件:`src/lib/registry/context-sources.ts`、`src/components/editor/ChapterEditor.tsx`(分支 `fix/fb-9-detailed-outline-source`)

**✅ 已修复 · 精确根因**(更正早先误判):细纲(detailedOutlines)**在"基础表"里其实是登记了的**——它是 DB 表、有 adopt 写回规则、有删除级联,所以写得进、删得掉、导得出。**唯独没有登记到"读"那一层(`CONTEXT_SOURCES`)** → `assembleContext` 从来没有任何入口去读它 → 正文/任何生成都吃不到细纲。一句话:**"存得下但读不到"**。(早先曾误写"正文没走 assembleContext",实际 ChapterEditor 已用 assembleContext,缺的是细纲这个**源**。)

**改法**(标准三注册表"加一行·改一处"):① `context-sources.ts` 新增 `detailedOutline` 源(按当前章节节点读出开头衔接 + 逐场景拆解 + 结尾悬念);② ChapterEditor 正文生成 sourceKeys 加 `detailedOutline`(write/continue/expand/polish 共用,一并生效);③ 反例测试 R-FB9(3条)+ 重生成 AI 说明书。**零新增组件文件。**

**遗留(可选)**:批量正文 runner 如需也吃细纲,可后续同样 `need:['detailedOutline']`。

**改法(与旧代码清除联动)**:
- 把 `detailedOutlines`(场景细纲)登记/确认为一个 `CONTEXT_SOURCE`(若未登记则加一行),正文生成 `assembleContext({ need:[...,'detailedOutline'] })` 自动带上。
- 把 `ChapterEditor` 的正文生成从旧 `buildFullWorldCtx + buildChapterContentPrompt` 切到 `assembleContext`(属「旧代码清除」专项的一环)。
- **完成判据**:有细纲的章节,正文生成的请求体里能看到细纲场景信息(可用网络抓包验证,同 FB-1 手法)。

## ✅ FB-12（prompt bug · 修复 2026-06-11）— 章节大纲展开"跑完整本书"且不按设定章节数

> 反馈人：买辣椒也用券。"章节展开总是在第一卷就展开了整本书的内容,并且不按照我设置的章节数;生成内容跟卷情节摘要不搭。"用的是内置提示词。
> 文件:`src/lib/ai/prompt-seeds.ts`(outline.chapter seed)。测试:`tests/regression/R-FB12-chapter-outline-volume-scope.test.ts`。

**根因(单点)**:`outline.chapter` 内置模板 user 正文写死「每卷约 15-25 章」,而 `chaptersPerVolume`(本卷章节数)参数**虽已在 seed 里定义、滑块也能调,却从未被任何 `{{}}` 占位符引用** → 用户设的章节数完全失效。同时模板缺「只展开本卷、严格围绕卷情节摘要」的约束,AI 遂自由发挥、几十章把整本书讲完。`pace` 参数本就接通(system 里有 `{{usesPace}}`),唯独章节数漏接。

**修复(只改 seed,老用户自动下发)**:`prompt.ts` 启动时会用 seed 内容更新现有内置模板(仅保留用户 isActive 选择),故改 seed 即可触达所有用内置模板的用户。
- 接通 `{{chaptersPerVolume}}`,用 `{{#if usesChaptersPerVolume}}`/`{{#if notUsesChaptersPerVolume}}` 守卫(防 optional 参数被注入空串导致"恰好  章"渲染事故,兜底回"约 15-25 章")。
- 加铁律:① 只展开本卷,结束停在卷摘要终点,不许把后续卷/整本书提前讲完;② 每章落在卷摘要范围内、与之相符;③ 均匀拆分、每章只推进一小步;④ 输出 JSON 数组长度必须恰好为设定章节数。
- 批量"一键生成全部卷章节"路径(batch-outline-runner,传 undefined options)→ 走默认 20 章 + 同一锁卷约束,同样受益。

部署:storyforge `616b651` / my-website `f31b14e`。

---

## ✅ FB-10 / FB-10b（数据 bug · 真正修复 2026-06-11）— 生成卷级大纲，点采纳后未写入

> 反馈人：买辣椒也用券。"生成卷级大纲,点击采纳写入后,并未写入"。社区 PR #12（贡献者）独立定位到第二根因。
> 文件:`src/components/outline/OutlinePanel.tsx` + `src/lib/registry/adopt.ts`

**两个独立根因,FB-10 只修了第一个,bug 仍在,FB-10b 才真正解决:**

**① FB-10(2026-06-09,已修)— 重复静默跳过**:outlineNodes 是 `duplicatePolicy:'skip'`,命中同名去重时 adopt 进 `skipped`、不写不报错,而 confirm 回调不处理 → 静默。已加 written/skipped 统计 + alert 反馈。

**② FB-10b（2026-06-11,本次真正修复)— `parentId:null` 被 adopt 丢弃**:`normalizeAndValidate` 旧实现 `if (val == null) continue` 把 `null` 一并跳过 → 顶层卷采纳时 `parentId:null` 丢失,卷**其实写进了库但 parentId 存成 undefined**;而 `OutlinePanel` 用 `parentId === null`(严格)过滤顶层卷,`undefined === null` 为 false → **卷被藏起,表现为"采纳没反应"**。社区 PR #12 独立定位此因。
**改法(采纳 PR #12 核心思路并补完整)**:
- `adopt.ts`:`normalizeAndValidate` 保留 null(`parentId:null` 正确落库);**update 分支加防误清空守卫**(更新既有记录时 null 不覆盖,保持旧行为,规避全局保留 null 的副作用)。
- `OutlinePanel.tsx`:顶层卷过滤改 `parentId == null`(宽松)——**同时修复存量坏数据**(修复前已采纳的卷 parentId=undefined 永远藏着);三个采纳回调加 try/catch+alert(承 PR #12,防其它静默抛错)。
- 反例测试 `R-FB10` 补断言 `parentId === null`(此前只断言写入+标题,漏了 parentId,所以没拦住)。
**致谢**:第二根因由社区 PR #12 贡献者独立定位。
**遗留(UX 增强,非 bug)**:"重新生成即自动替换同名卷"需另做替换交互,已另议。

---

# ═══ 项目健康度与完善性专项（HEALTH-1~6 · 2026-06-09 立项）═══

> 来源：重构上线后对"还差什么"的诚实复盘。重构(三注册表)解决的是**数据层**的结构性/重复性问题;但**功能层/UI 层/工程完善度**还有系统性短板,单点 bug(FB-x)修不完根因。本专项把这些"让项目从能用→稳健→精品"的结构性改进立项,**记想法 + 定优先级 + 粗排期**,不要求立即全做。
>
> **核心认知**:三注册表是"数据层护栏";功能层目前**没有等价护栏**,所以 FB-6(导入大纲丢失)这类 bug 能从测试网里漏出去。HEALTH 专项要做的就是**把护栏延伸到功能层 + 清理半成品 + 补迁移安全网**。

## 🟡 HEALTH-1（测试体系已完成 2026-06-16 · 迁移前快照子项待补）— 真实数据迁移测试体系（上线后最大未知风险）

> **已完成（2026-06-16）— 真实迁移测试体系**：`R-db-upgrade-fixtures` 现有 **3 份真实 Dexie 版本迁移夹具**，用"旧 schema 类建库 + 写真实数据 → 升级版打开触发真实 upgrade → 断言"的方法：
> - **v30→v31**：清旧分析数据 + 保留 importSession blob（不误删缓存）。
> - **v31→v32**：删除 master-study 五表、不碰 references。
> - **v28→v29（最复杂·本次新增）**：调用**真实迁移函数 `migrateLegacyTablesToCodex`**，断言 factions/itemSystems → codex 词条（含 mapRegion/color 地图字段保留）、体系总述并入 worldview.itemDesign（原有内容不丢）、旧表删除，**零丢失**。
> **关键认知**：① 多世界化（加 `worldGroupId`）**无 upgrade 函数**——加索引字段不迁移老数据，缺失=null=主世界，读取层 `?? null` 处理，故风险在读取层（已有处理）而非迁移层；② Dexie upgrade 是**事务性**的，迁移失败整体回滚、不会半迁移损坏库；③ 真正的风险是"迁移成功但逻辑丢数据"——正是 fixture 测试所防（v29 已覆盖）。
> **现有多层数据保护**：生产不自动删库（`allowReset=false`）+ 缺表弹窗提示导出 + 启动 `persist()` 防驱逐 + Gist/本地文件夹自动备份。
> **待补子项（降级 🟡）**：「重大升级前主动快照 / 首次弹一次性'建议导出'提示」——涉及启动流程改造 + 存储/UX 决策（快照存哪、大库大小、清理策略），单独立项；当前 Dexie 事务回滚 + 多层备份已构成基础保护。

**问题**：DB schema 迁移(v27/v28 多世界化等)**只在空数据/新建数据上验证过**,从没拿真实老用户库(装着半年手稿)实测。这是本次上线唯一没清的人工关口,目前仅靠自动备份兜底。一旦某个老库结构触发迁移 bug → 用户手稿损坏,不可逆。

**方案**：
1. **迁移测试夹具系统**：收集/构造若干**代表性老库导出 JSON**(单世界旧版 / 多世界 v27 / v28;真实库需脱敏),放进 `tests/fixtures/migrations/`。
2. **往返断言测试**：导入老库 → 触发升级 → 断言①无数据丢失(各表行数≥原始)②无孤儿③关键字段完整④导出再导入幂等。纳入 CI。
3. **用户侧安全网**:重大 schema 升级时,首次打开弹一次性提示"建议先导出备份";升级前自动快照(已有自动备份模块,确认它在迁移前触发)。

**排期**：观察期内尽快(优先级最高,因为已经上线了)。**完成判据**:至少 3 份代表性老库 fixture 往返测试绿 + 迁移前自动快照确认生效。

## 🟠 HEALTH-2（P1 · 中期 · 分批）— 功能层/关键流程集成测试（把护栏延伸到 UI 层）

**问题**：三注册表只守数据层,**用户实际走的流程(分块导入 / 工作流多步链 / 词条 / 灵感反推 / 删除级联)没有自动化守护**,FB-6 这类"数据写进去了但流程/展示错"的 bug 从这层漏出,只能靠用户撞到。

**方案**：为**最常被点的关键路径**建集成测试(store 级用 happy-dom + fake-indexeddb;真·浏览器流程用 Playwright E2E),优先覆盖:
1. 分块导入往返(喂合成多块结果 → 断言卷/章数量正确、无误并)← 顺带做 FB-6 的复现测试
2. 工作流多步链(已有 R-WF 单测,补端到端)
3. 删除级联 / 导出导入 / 多世界切换(已有部分反例,补流程级)

不求全覆盖,**只求"演示/核心路径有网"**。每批 1 条流程,独立可交付。**完成判据**:5-6 条关键路径有集成测试,CI 跑。

## ✅ HEALTH-3（已完成 2026-06-16）— 半成品清算审计

> **审计结论（2026-06-16 全仓扫描）**：项目经多轮清理后已相当干净。
> - **代码标记**：全仓 `TODO/FIXME/XXX/HACK/WIP` = **0**。
> - **4 项已知半成品均已处理**：① 词条化重复 → C 段词条化已收口（自然/人文已统一到 codex，`WorldviewNaturalPanel` 现为词条化登记 + AI 生成 + 保存）；② 自然资源面板"不保存/无 AI" → 已修（339 行，含 `useAIStream` + `assembleContext` + 词条化）；③ WorldMap 3D → 已标 **Labs**（`title="3D 地图仍处于 Labs 阶段，当前不可用"`，符合 DoD 第4条）；④ i18n 架子 → 归 HEALTH-5（低优先，非误导用户的半成品）。
> - **孤儿组件扫描**：发现并删除死代码 `WorldviewFieldEditor.tsx`（各世界观面板已改用各自局部 FieldEditor，此独立文件在重构后被遗弃、无任何 import；删后 tsc/build 全绿）。
> - **结论**：无遗留"误导用户/演示地雷"级半成品；侧栏入口均有实现或已标 Labs。

**问题（原始）**：项目里散落**半完成功能**,造成重复/困惑/演示地雷。已知:①词条化只做了 35-a → 自然/人文三处重复(见 Phase 35);②i18n 只搭了架子(108 组件未迁);③疑似死代码(WorldMap3DCanvas 等);④自然资源面板不保存、无 AI。

**方案**：
1. 全仓扫一遍"半完成/孤儿/重复"功能,产出一张**《半成品清单》表**。
2. 每项**三选一**:做完 / 隐藏(暂时不暴露给用户) / 删除。
3. 先处理**影响用户和演示**的(词条化重复入口、自然资源不保存)。

**排期**：先 1 天扫出清单 + 定每项归宿,再按表逐项执行。**完成判据**:清单表落档 + 高优先项(词条化重复 / 自然资源保存)清掉。

## 🟡 HEALTH-4（P2 · 与 HEALTH-2 合并推进）— UI 层测试覆盖率补强

**问题**：整体覆盖率偏低,UI 层很薄(核心逻辑层~86%,UI 接近裸奔)。盲目追全局百分比性价比低。

**方案**：对**高风险面板**(导入 / 工作流 / 世界观生成 / 删除 / 灵感反推)加组件级或集成测试,目标"核心创作流程可回归",而非全局覆盖率数字。与 HEALTH-2 共用测试基建。**排期**：跟 HEALTH-2 同批做。

## 🟡 HEALTH-5（P2 · 低优先 · 穿插做）— 死代码清理 + i18n 渐进迁移 + 包体积

**问题**：可能存在死代码(WorldMap3DCanvas)、108 组件硬编码中文未 i18n、主包仍偏大(gzip 415KB)。

**方案**：①死代码扫描工具(如 knip/ts-prune)跑一遍,移除确认无用的;②i18n 按 `docs/refactor/I18N-GUIDE.md` 逐面板渐进迁移(优先 common/nav/设置/导出);③包体积继续拆(章节编辑器懒加载,目标主包 gzip <300KB)。**排期**：低优先,穿插在其它任务间。

## ✅ HEALTH-6（已完成 2026-06-16 · 写文档）— 立"完成定义(DoD)"防再出半成品

> **已落地**：`CLAUDE.md` 新增「✅ 完成定义（Definition of Done · 交付前必逐条勾选）」章节，5 条铁律——① 可用（端到端走通）② 无重复 / 旧入口已下线 ③ 数据读写走注册表 ④ 半成品必须标 Labs 且对用户不可见 ⑤ 有验证证据。位置在「改动前检查清单」与「立刻停下信号」之间，与三注册表（数据防线）、ESLint（代码防线）互补成「流程防线」。

**问题**：词条化跑偏的**根因**是"加功能不收口、半成品单列出来留着不管"。若不立规矩,以后还会再犯(屎山的另一种形态)。

**方案**：在 `/CLAUDE.md` 或 `HANDOFF.md` 增加一条**「完成定义」铁律**——
> 一个功能要交付,必须满足:① 可用(主路径走得通);② **无重复入口/旧入口已下线**(不允许新旧并存);③ 数据写读走注册表;④ 若暂时做不完,**明确标注"实验性/已隐藏"并对用户不可见**,不允许"做一半还单列在侧栏"。

这是**流程防线**,与三注册表(数据防线)、CI lint(代码防线)互补。**排期**:即时(改文档)。**完成判据**:DoD 写入 CLAUDE.md,后续 PR/任务交付前对照勾选。

---

## 📅 HEALTH 专项粗排期（建议顺序）

| 顺序 | 条目 | 为何这个时机 |
|---|---|---|
| 1 | **HEALTH-1** 迁移测试体系 | 已上线,真实老数据是当前最大未知风险,先补网 |
| 2 | **HEALTH-6** 立 DoD | 一句话文档,即时,防后续再造半成品 |
| 3 | **HEALTH-3** 半成品清算 | 先扫清单,和 Phase 35-b/c / FB-6 联动 |
| 4 | **HEALTH-2 + 4** 功能层测试 | 把护栏延伸到 UI,长期最值钱,分批做 |
| 5 | **HEALTH-5** 死代码/i18n/包体积 | 低优先,穿插 |

> 注：HEALTH 专项与社区反馈(FB-x)、功能 Phase(34-37)**并行不冲突**——FB-x 是"修具体的痛",HEALTH 是"补结构性的网"。建议每个迭代周期里"FB 修 1-2 个 + HEALTH 推 1 项"交替进行。

---

## 🔴 优先级：高

### 🏗️ 项目重构（主线工作 · 见 MASTER-BLUEPRINT）

**👉 见 `docs/MASTER-BLUEPRINT.md`**

四个阶段（必须严格串行）：
- **Phase 0 · 紧急修复**（3–5 天）：7 项 P0 修复，含 `deleteGroup`/`migrateToMultiWorld` 事务作用域、`ensureSchema` 删库风险、`BUG-EXPORT-WG`、`importProjectJSON` 事务化、`deleteProject` 漏间接归属表、`deleteNode` 绕过 `deleteChapter`
- **Phase 1 · 三支柱地基（强化版）**（10–15 天）：`PROJECT_TABLES`（含 JSON/数组/间接归属/Blob owner）+ `FIELD_REGISTRY + AdoptionSchema` + `CONTEXT_SOURCES + 真裁剪`
- **Phase 2 · 内容完整性 + 多世界贯通**（7–10 天）：Phase 40 真实与幻想多世界化、chapter-adapter 接 worldRulesContext、AIFieldCard 传 currentValue（注:`AIFieldCard` 组件后已被各面板内联编辑器取代并于 2026-06-09 旧代码清除中移除）、chunk-writer 支持 worldGroupId、批量正文 worldContextResolver、角色 JSON 引用 remap
- **Phase 3 · 精品化**（10–15 天）：AI 说明书自动生成器、测试体系、CI lint、安全加固、性能、文档体系收口

---

### 🏗️ 架构地基重构（三根支柱） — 项目地基级改造（v1 设计 · 已升级到 MASTER-BLUEPRINT）

> 📐 完整设计文档：`docs/ARCHITECTURE-REFACTOR.md`（含数据结构、API、迁移示例、验证策略、风险对策、完成判据）
>
> 来源：本轮全量审计反复发现的同类大漏洞的结构性根因 | 用户决策：「这一波要全都给它重构，要做成坚实的项目地基」

**为什么**：本轮 17 个已修 bug 中，**导出漏 5 表 / deleteProject 漏 5 表 / deleteGroup 漏 3 表 / migrate 漏 codex** 4 个根因相同（生命周期手列表）；**6 处上下文漏注入 + 多世界串台 4 处**根因相同（上下文手挑组合）；**灵感反推采纳为空 + 单例工厂重复**根因相同（写回散落 + 内存定位）。**只要不收口，加新功能时同类 bug 会继续冒新的。**

**三根支柱**：
1. **Stage A · `PROJECT_TABLES` 注册表**（生命周期单一事实源）—— 所有表的元信息（项目级/世界级/外键/可导出/重映射）声明在唯一一处；export/import/deleteProject/deleteGroup/migrate 全部派生。**加新表只改一处。** 顺带修 BUG-EXPORT-WG。
2. **Stage B · R-2 统一采纳写回层 + `FIELD_REGISTRY`**（写侧单一事实源）—— 规范字段表 + `adopt()` 入口 + 自动别名映射 + 类型校验 + 未知字段告警 + 以 DB 为准定位（杜绝重复记录）。**字段映射不再手写。**
3. **Stage C · R-1 统一上下文装配层 + `CONTEXT_SOURCES`**（读侧单一事实源）—— 上下文源注册表 + `assembleContext()` 入口；面板只声明 `need: ['worldview', 'codex', …]`。**加新源只改一处。** 顺带修 BUG-INPUT-WITH-GEN（工作流复用 adapter + assembleContext）。

**实施顺序（设计文档第五节）**：A → B → C 严格串行；每个 Stage 内部再分子步、每子步独立 commit 可单回滚；旧函数保留作适配器直到最后下线。

**验证**：每个 Stage 单元测试 ≥ 15 条；本轮 17 个已修 bug 全部写成"反例测试"防复现；多世界往返冒烟。

**收益**：根治 4 类反复漏洞 + 简化所有未实现 Phase（38/39/40/34/35-b/35-c）的实施成本。

---

### ✅ BUG-INPUT-WITH-GEN（已修复 2026-06-09）— 文本框应可用户自行输入，且 AI 生成时带上用户已输入内容

> 来源：社区反馈 + 用户明确诉求（2026-06-04）。最初表现：「从零到第一章」工作流第一步「一句话故事」用户无法输入。
> 文件：`src/components/settings/prompt/WorkflowRunner.tsx`（重灾区）、各面板的**内联字段编辑器**（如 `WorldviewOriginPanel` 的 `TextFieldEditor`、`InlineEdit`）、各 AI 生成按钮的面板。（注:旧的 `AIFieldCard.tsx` 已于 2026-06-09 旧代码清除中移除,面板现统一用内联编辑器。）

**用户诉求（通用原则，按此实现）**：
> 每个文本框都应能让用户**自己输入**内容；当用户点击该文本框对应的「AI 生成」按钮时，**把用户已输入的内容自动带进提示词**，在用户写的基础上生成/扩展（而不是无视用户输入从零生成）。

**已核实的现状**：
1. **工作流步骤卡（WorkflowRunner StepCard）= 重灾区**：步骤卡**完全没有用户输入框**，只读地显示 AI 的 `result.output` + 一个「重新生成」按钮 → 用户连「一句话故事」都**没法自己敲**，更谈不上带着它去生成。这是本次反馈最直接的痛点。
2. **各面板内联字段编辑器**（如 `WorldviewOriginPanel` 的 `TextFieldEditor`/`InlineEdit`；原 `AIFieldCard` 已移除）：用户**能**编辑字段值（`value`/`onChange`）、也能填一个独立的提示（`hint`）；但「AI 生成时是否把当前字段值（用户已写内容）带进 prompt」**取决于各调用方传入的 `buildMessages` 实现，不统一**——有的带、有的只带 hint 不带 value。
3. ✅ **（已修 · FB-1, 2026-06-09）** `WorkflowRunner` 裸 `renderPrompt` 不注入项目上下文的问题已修复——现每步走 `assembleContext` 注入 projectName/genres/worldContext/dimension + 步骤间链路贯通。**但步骤卡「可编辑输入框」本身仍未做**（本条 1 仍待办）。
4. **章节大纲/章节摘要字段(下游自动总结)不可手改 = 首批审计对象**（来源 FB-3 · light莫言）：「读上游内容自动总结生成」的章节大纲，当前不能手动编辑或改了不保存；用户要能手改并保存，不必为改一句话反复整章重生成。这是本通用原则在「下游自动总结字段」方向的典型落点。

**解决方案**：
- **工作流（首要，仍待办）**：给每个步骤卡加**可编辑输入框**（用户可预先输入本步内容，如一句话故事）；点「生成」时把该输入并入 ctx（作为 userHint/seed 之一），随项目上下文一起喂给 AI；AI 产出后也允许用户**编辑输出再采纳**。（注：上下文注入与链路贯通部分已由 FB-1 完成，此处只剩"输入框 UI + 把输入并入 ctx"。）
- **通用约定**：约定所有「AI 生成」按钮在构建 prompt 时**必须带上对应字段的当前值**（用户已输入内容）作为「在此基础上改写/扩展」的种子。审计所有 `buildMessages`/生成入口，统一让其纳入当前 `value`。
- **下游自动总结字段(含章节大纲)**：① UI 上必须**可编辑 + 失焦/离开即保存**（修当前"改了不保存、恢复原样"的 bug）；② 用户手改后，下次点 AI 生成**带上当前值改写**，不无脑覆盖（带 currentValue，而非另起）；③ 可考虑加"锁定/已手改"标记，避免上游变动时被自动总结冲掉。
- **首批审计对象清单（按用户实际撞到的优先）**：
  1. 🔴 工作流步骤卡（无输入框）
  2. 🔴 **章节大纲 / 章节摘要**（下游自动总结，不可改/不保存 · FB-3）
  3. 🟠 各面板内联字段编辑器（buildMessages 是否带 currentValue 不统一）
- **验证**：① 工作流每步可手动输入、且生成带上用户输入；② **章节大纲可手改→失焦保存→刷新仍在→再次生成是在手改基础上改写**；③ 抽查若干面板字段：先输入半句→点 AI 生成→产出是在用户输入基础上扩展而非另起。

---

### Phase 40 — 「真实与幻想」多世界联动（每世界一套世界规则）

> 📐 完整设计文档：`docs/WORLD-RULES-MULTIWORLD-DESIGN.md`（含表结构、功能逻辑、9 处调用点传值表、漏洞清单 A–I 逐条对策）
>
> 来源：用户指出（2026-06-04）真实与幻想未与多世界联动 | 文件：`world-rules.ts` / `WorldRulesPanel.tsx` / `world-rules-manifest.ts` / `world-group.ts` / `db/schema.ts`

**问题**：`worldRulesProfiles` 现为项目级单例（`&projectId` 唯一），`buildWorldRulesContext(projectId)` 项目级注入 → 多世界下所有世界共用一套真实/幻想规则（诸天流斗破=全架空、大明=取自真实本应各异）。

**方案要点**：profile 加 `worldGroupId`（每 (projectId, worldGroupId) 一条），面板加世界标签（仿 HistoryPanel），`buildWorldRulesContext(projectId, worldGroupId?)` 含「默认世界解析」，9 个调用点逐一定死传值，迁移 stamp/删除级联/导出 remap 全部补 worldRulesProfiles。

**已设计好的 9 处漏洞对策**（见设计文档 §三）：默认世界回退、禁跨世界污染、防重复 profile、防漏注入、迁移不丢、删除不留孤儿、导出归属正确（依赖 BUG-EXPORT-WG）、单世界零影响、切换标签先 persist。

---

### ✅ BUG-EXPORT-WG — 多世界导出/导入 worldGroupId 重映射键值错位（已修复·已测试）

> **状态更正（2026-06-12 复查）**：此条**早已修复**（方案 A 已实施），本条标记此前未更新。
> 现状：导出侧所有 worldScoped 表用 `withWorldGroupExportId` 把 `worldGroupId` 转成 `_worldGroupExportId`（导出序号），角色用 `_homeWorldGroupExportId`；导入侧 `importWorldScoped`/`importHomeWorldScoped` 经 `remapImportedWorldGroupId`（序号→新 id）逐表 remap。回归测试 `R-03-export-world-group-remap` 建多世界项目、全 worldScoped 表挂副世界、导出→导入断言全部正确归属，**通过**。世界地图/世界树（worldNodes）同样覆盖。无需再改。
> 以下为原始记录（历史留存）：

> 来源：全量审计（2026-06-04）修数据丢失时顺带发现 | 影响：仅多世界项目的「导出备份 → 导入恢复」；单世界无影响 | 文件：`src/lib/export/json-export.ts`

**问题（已确认机制）**：
- 导出时 `worldGroupIdMap` 把世界组「真实 id → 导出序号 index」，`worldGroups` 以 `_exportId = index` 导出。
- 但 `worldviews / powerSystems / characters(homeWorldGroupId) / outlineNodes / geographies / histories / worldNodes / historicalTimelineEvents / historicalKeywords`（以及本次新增的 `codexCategories / codexEntries`）导出时，其 `worldGroupId` 字段**保留的是原始真实 id**（未转成 index）。
- 导入端 section 27 的 `remap(oldId) = newWorldGroupIds.get(oldId)`，而 `newWorldGroupIds` 键是「导出序号 index → 新 id」。
- 于是 `remap(原始真实id)` 用 index 表查 raw id → 键不匹配 → 落到 `?? null`。
- **后果**：多世界项目导出再导入后，绝大多数记录的 `worldGroupId` 被清为 null，**世界归属丢失**（世界观/角色/大纲/词条等不再隶属正确世界）。

**解决方案（二选一，推荐 A）**：
- **方案 A（推荐，统一用导出序号）**：导出时把所有 `worldGroupId` / `homeWorldGroupId` 引用一律经 `worldGroupIdMap` 转成 `_exportId`（index）再写出；导入端 `remap` 用 `newWorldGroupIds`（index→新 id）即可对上。改动集中在导出的各 `.map(...)` 与导入 section 27，语义统一、最干净。
- **方案 B（保留原始 id）**：导出 `worldGroups` 时同时保留原始真实 `id`（如 `_originalId`）；导入时建立「原始 id → 新 id」映射，`remap` 改用此映射。改动小但多一个字段。

**约束**：单世界（worldGroupId 为 null/undefined）必须零影响；修复后用「多世界项目（≥2 世界组，记录挂到非首个世界）导出→导入」验证 worldGroupId 正确保留。

**验证**：`npx tsc --noEmit` + `npm run build` + 手动多世界往返；完成后更新 `docs/DATA-FLOW-MAP.md` 对应「⚠️ 顺带发现」项为已修复。

---

### Phase 38 — AI 生成内容一致性检测（幻觉/前文矛盾预警）

> 📐 完整设计文档：`docs/CONSISTENCY-CHECK-DESIGN.md`
>
> 来源：用户需求（2026-06-04）。背景：实测各国产模型二次承接的幻觉率——豆包约 10%、DeepSeek 近 30%（按情节计，非字数），且常违背指令、篡改关键情节；提示词最多压到 5%，**最终仍须人工核查**。本功能将"人工核查"升级为"AI 先标红、人来定夺"，大幅降低核查成本。

**核心逻辑**：把工具已沉淀的"事实库"（角色当前状态、故事进度、物品持有、力量层次、人物关系）当作**基准真相（ground truth）**；用户对新生成正文发起检测时，由 AI 把新内容与基准对照，**只挑出"与前文逻辑不符"的冲突点**（如角色位置瞬移、已消耗物品再次使用、境界倒退、关系前后矛盾、关键情节被悄悄篡改），并指明撞了哪条既定事实，交作者定夺。

**触发方式（用户确认）**：**保持手动**，不做自动触发——自动检测会额外消耗 token，若作者自信可自行审校则省去这笔开销。即在编辑器提供"一致性检测"按钮，由用户按需发起。

**已确认可直接复用的资产**（无需重做）：
- 状态表系统 `state-card`（角色/地点/物品/势力/事件五类状态卡）+ `state-extract-adapter`（章节状态 diff 抽取）+ `buildStateContext` / `buildSelectiveStateContext` / `getCharacterState`
- 故事年表 `story-timeline` + `story-timeline-adapter`
- 物品栏 `item-ledger` + `inventory-extract-adapter` + `aggregateInventory`
- 人物关系 `character-relation` + `relation-extractor`
- 章节审校 `review-adapter`（Phase F1，五维：逻辑/人物/世界观/伏笔/节奏）—— 与本功能最接近，作为骨架增强
- 生成后钩子 `ChapterEditor.handleAutoPostGenerate`（目前已自动跑状态抽取）

**待开发清单**：
1. **统一「事实基准上下文」组装器**（新建，如 `lib/ai/consistency/fact-context-builder.ts`）：现有 `review-adapter` 只塞 `stateContext.slice(0,400)` 等碎片，且**未接入物品栏/故事年表/人物关系/力量层次**。新组装器把状态卡 + 物品栏当前持有 + 故事年表近期事件 + 关系网 + 力量层次整合为结构化 ground truth；复用 `buildSelectiveStateContext` 的按需召回以控 token。
2. **专用「矛盾检测」适配器**（新建 `adapters/consistency-check-adapter.ts`）：区别于打分式审校，输入（新正文 + 事实基准），输出"冲突点列表"，每条含：`新内容引文 ⚔ 撞上的既定事实 + 严重度 + 依据 + 处置建议`。这是"幻觉定位"，非"质量评分"。
3. **矛盾预警 UI**（新建 `components/editor/ConsistencyCheckPanel.tsx`）：左右对比「新内容 vs 既定事实」卡片；每条冲突可操作——**忽略** / **采纳**（承认为合理剧情推进，顺手把变更并入状态库，与现有状态 diff 审核打通）/ **跳到正文修改**。
4. **手动入口**：编辑器工具栏新增"一致性检测"按钮（与现有"质量审校""提取状态"并列），调用上述链路。
5. **（增强，可选）力量层次阶段化追踪**：见下方 Phase 34，给境界排序号后，"境界倒退/跨级暴涨"类检测才能精确判定。

**姊妹层（吸取竞品「逻辑评估」优点，2026-06-04）**：
6. **大纲级逻辑评估（写前层）**：对象是大纲节点而非正文，写前预防逻辑硬伤，省 token。新建 `adapters/outline-logic-eval-adapter.ts` + 大纲面板侧栏。
7. **分组可视化维度体系**（写前/写后共用）：3 组——逻辑组（因果逻辑链/时间线/世界观/逻辑连贯性）、角色组（角色行为/角色弧线/**战力**=力量层次）、叙事组（伏笔/节奏/信息密度/悬念钩子）；进度条 + 数字 + **结构位置感知**（开篇/中段/高潮/结尾）。
8. **检测→改进闭环**：单章改进 + 批量改进（列表批选→串行改→预览采纳），新建 `adapters/improve-from-eval-adapter.ts`；批量改进消耗大，UI 须显示数量并二次确认。
9. **历史/对比**（低优先级增强）：评估快照 + 改前改后对比视图。

**关键取舍（实现勿跑偏，详见设计文档 3-bis.3）**：
- **分数只做排序提示，不当结论**——AI 单维数字噪声大；核心产出是**锚定原文的具体问题（quote + 依据）**，保留现有 severity + quote 为一等公民。
- **不丢"事实库基准"护城河**——竞品像逐章孤立自评，抓不到"第8章得令牌、第30章令牌还在原主手里"这类跨章事实矛盾；Phase 38 对照状态/物品/关系/力量/线索的深查不可被大纲级自评取代，二者并存。

**两层定位（写死，别混淆）**：
- **大纲级逻辑评估（写前）** = 自洽 + 连贯 + 节奏，便宜、预防，对象=大纲节点。
- **Phase 38 事实一致性检测（写后）** = 与事实库的矛盾定位，深查，对象=正文。

**与现有功能的边界**：审校（review-adapter）= 编辑视角的质量打分与泛化建议；一致性检测 = 事实视角的矛盾定位。三者（审校 / 大纲评估 / 事实检测）并存、互补，不合并。

---

### Phase 39 — 主角多故事线进度追踪（主线/支线 + 交叉监测）

> 来源：用户需求（2026-06-04）。难点：一个主角同时挂多条故事——必有一条主线，外加多条支线；如何识别主角在不同故事中的不同进度？多条线会不会交叉？

**设计思路（已与用户对齐，采用"闭集分类 + 既有 StoryArc 复用"方案）**：

把看似无解的"开放式进度识别"重构为**对已知线索集合的分类问题**——与刚修复角色去重用的是同一招：**给 AI 一个已知集合，让它把新内容映射上去，而非每章凭空发明**。

1. **复用既有 `StoryArc`（Phase B）作为"线索注册表"**，不另造重复概念。`StoryArc` 已有 main/sub 类型与 `StoryStage[]`（起承转合阶段），它是**作者事前规划的静态蓝图**。本功能新增的是**动态追踪层**：把已写正文映射到这些线索上，记录"当前进度指针 + 活跃状态 + 交叉节点"。
2. **新增"线索进度"数据**（新表/字段，如 `StorylineProgress`）：每条故事线记录
   - `currentStageId`：当前所处阶段指针（指向 StoryArc 的某个 StoryStage）
   - `status`：蛰伏 / 进行中 / 高潮 / 已收束 / 弃坑
   - `progressNote`：一句话当前进度（最近状态，自由文本）
   - `lastActiveChapterId`：最近活跃章节
   - `involvedEntities`：相关角色/物品/地点/势力（用于交叉检测）
3. **每章归属与推进（AI，手动触发，复用 story-timeline 抽取链路）**：AI 接收「线索注册表（各线 id+名称+目标+当前阶段+相关实体）+ 新章节内容」，输出：
   - 本章推进了哪条/哪几条线（**对已知集合做分类**，可靠性远高于开放抽取）
   - 各线发生了什么、进度推进到哪个阶段
   - 是否出现**新线索候选**（标记待作者确认，防止 AI 漂移）
   - 是否发生**交叉**（同一章推进 ≥2 条线，或两线共享实体在本章互相影响）
4. **交叉作为数据记录，而非要规避的问题**：新增"交叉节点"链接 线A↔线B@第N章。交叉是有价值的结构——例如"此处交叉后林月已知秘宝之事，后文她若再表现不知情即为矛盾"，可直接喂给 Phase 38 一致性检测。
5. **进度表达避免过度工程**：不强求百分比。用 **粗粒度阶段枚举（起/承/转/合）指针 + 一句话当前进度 + 最近活跃章**，渲染成可读仪表盘，例如：
   - 复仇主线【转·高潮前】— 已查明仇人是城主，正集结力量（最近活跃：第48章）
   - 感情线·林月【承】— 互生情愫但因身份未挑明（第45章）
   - 秘宝支线【合·已收束】— 秘宝已得，线索关闭（第40章收束）
6. **作者在环（防漂移关键）**：线索注册表由作者确认/编辑，AI 只"提议候选 + 映射进度"，绝不每章自由发明线名。

**为何这套设计可落地（难点拆解）**：① 闭集分类替代开放抽取；② 复用已有的逐章事件抽取，只多输出"归属线 + 阶段增量"；③ 交叉显式建模为链接节点，不试图阻止；④ 作者确认注册表锚定线名；⑤ 粗阶段 + 一句话进度，不造假精度。

**待开发清单**：
1. `StorylineProgress` 类型 + 表 + store（动态追踪层，挂在既有 StoryArc 上）
2. `adapters/storyline-track-adapter.ts`：每章"线索归属 + 进度推进 + 交叉/新线检测"AI 适配器
3. 线索进度仪表盘 UI（各线当前阶段/状态/进度一句话/最近活跃章）+ 交叉节点可视化
4. 与 Phase 38 打通：把"活跃线索 + 已收束线索 + 交叉节点"纳入一致性检测的事实基准（如"已收束的线被错误重启""蛰伏支线角色突然按活跃线行动"等冲突）
5. 新线索候选的作者确认流（提议 → 作者确认/改名/合并/忽略）

**与现有功能边界**：`StoryArc` = 静态规划蓝图（作者写）；`StorylineProgress` = 动态进度追踪（AI 从正文回填）。`story-timeline` = 扁平事件流；本功能 = 把事件归类到线索并维护每线进度指针。

---

## 🟢 优先级：中

### Phase 30 补充 — 解析增强（✅ 完成，2026-06-03）

> 来源：社区用户 | 状态：✅ 已完成（按全局原则：文本提取一律用 AI，不用正则）

- ✅ 章节标题任意格式（含 `**标题**摘要` 无冒号）：`parseChapterOutlineSmart` JSON 优先 → AI 重构
- ✅ 细纲场景提取：`parseEnhancedDetailSmart` JSON 优先 → AI 重构（**不降级正则**）
- ✅ 新增 `src/lib/ai/restructure.ts` 通用 AI 重构工具

> **全局原则（用户确认）**：本工具一切文本分析/内容提取必须调用 AI 实现，绝不用正则——正则准确率太低，只适合一般语料清洗。今后所有解析/提取/拆分都遵此原则。

### Phase 28.5 — 参考资料角色聚合改用 AI + 文本处理正则全面审查（✅ 完成，2026-06-04）

> 来源：社区反馈「项目参考解析之后角色会重复」+ 全局原则贯彻

- ✅ **修复参考资料角色重复**：`merge-analysis.ts` 移除 `extractCharacterNames` 正则抠名，改为 AI 聚合——读取全部分块「人物塑造」分析，将同一角色（含不同称呼、跨分块）归并去重为一张角色卡
- ✅ Reference 新增 `mergedCharacters` 持久化字段；报告查看器新增「AI 整理角色卡」按钮，结果落库
- ✅ **全项目审查**：核查 47 个 AI 调用文件 / 22 个适配器 / 约 60 处正则，确认约 95% 为合法用途（JSON 围栏剥离、清洗、结构切分、第三方库文件解析、量化词频）
- ✅ 修复 `parse-character-output.ts`：role 字段由中文关键词匹配（会误覆盖 AI 正确英文枚举）改为优先信任 AI 枚举、中文仅兜底
- ✅ `volume-detector.ts`：评定为确定性结构切分（需精确字符偏移、整本无法喂入模型），保留正则并加注释说明；扩展识别楔子/序章/引子/尾声/终章/番外/外传/后记等特殊标题

### 社区反馈待办（2026-06-01 整理）

> 来源：社区交流群反馈

**已修复（本次）**：
- ✅ zzjj：灵感反推采纳世界观后内容不显示 — AI 输出字段与 v3 世界观字段不匹配
- ✅ zzjj + AWUAWU：世界地图 AI 生成完成后页面不更新/卡住 — JSON 解析失败无提示
- ✅ zzjj：AI 生成信仰体系后无法拆分到三个子字段 — 正则拆分改 AI 拆分
- ✅ 买辣椒：世界观各模块 AI 生成内容割裂 — 上下文互注修复

**待修复**：
- ✅ **买辣椒：伏笔 AI 生成后无法写入表单** — 已修复：onAccept 改为 AI 二次结构化解析 → 批量写入伏笔表（`foreshadow-adapter.ts` + `ForeshadowPanel.tsx`）
- ✅ **买辣椒：正文粘贴内容切换页面后格式丢失** — 已修复：`useAutoSave` cleanup 增加 dirty 检测 + unmount flush（`src/hooks/useAutoSave.ts`）
- ✅ zzjj：AI 生成内容 JSON 阅读不友好 — 已修复：AIStreamOutput 自动检测结构化输出，显示友好提示 + 可折叠原文
- ✅ 鲤鱼跃龙门：灵感反推没有保存/导出按钮 — 已修复：草稿持久化 + 结果导出 Markdown
- ✅ 长耳朵兔子：API 预设配置 — 已修复：多套配置一键切换 + 自定义模型名输入
- ✅ 世界观面板与独立面板数据重叠 UX — 已修复：重叠字段加导航提示

---

### Phase 25.5 — 多世界系统补完（2026-06-02 ✅ 全部完成）

> 来源：多世界系统讨论延伸 | 状态：✅ 已完成（25.5.1 历史标签 / 25.5.2-a 故事年表 / 25.5.2-b 物品栏 / 25.5.3 多世界灵感反推 / 25.5.4 关系流向图）
>
> 地图打通也已完成（世界树隶属世界组 + 地图AI按世界生成）。
>
> **全局架构约束（所有子项必须遵守）**：
> 新增的世界切换、年表、可视化等功能，**不得破坏现有 AI 写小说的上下文注入链路**。判定标准：
> 1. 单世界模式（`enableMultiWorld=false`）下，所有 AI 写作行为必须与现状 100% 一致，零影响。
> 2. 多世界模式下，AI 写作的上下文来源唯一权威是 `buildCurrentWorldContext` / `buildWorldContext`（按当前世界/卷所属世界）。新功能要么作为这条链路的**数据来源**接入（如年表作为上下文片段注入），要么作为**纯展示/产物**独立于写作链路之外（不反向污染写作上下文）。
> 3. 任何新表/新字段都用可选字段 + 单世界默认值，避免改动写作主流程的函数签名。

#### 25.5.1 多世界历史年表（标签方案，非下拉切换）

> **设计修正（用户确认）**：不是用下拉切换器替换当前视图（会把其他世界藏起来），而是用**标签**——历史年表内每个世界一个标签页 + 一个「一览」标签并排展示所有世界历史，方便横向对比世界脉络。

- `historicalTimelineEvents` / `historicalKeywords` 增加可选 `worldGroupId`；`History` 单例已具备
- HistoryPanel 多世界模式下，顶部增加一排**世界标签**（主世界 | 斗破 | 遮天 | … | 一览）
  - 各世界标签：只显示该世界的概述 + 时间线事件 + 关键词
  - 「一览」标签：所有世界历史并排/分组展示，用于横向对比
- 现有的 overview/timeline/keywords 子 tab 保留在每个世界标签内
- 新建事件/关键词时盖章当前选中世界；单世界模式不显示世界标签，走原逻辑
- **AI 上下文关系**：历史年表本就是世界观内容，已通过 `buildCurrentWorldContext` 注入写作链路；本项只是按世界隔离 + 标签展示，不改注入逻辑

#### 25.5.2 下游提取产物（AI 从已写正文回提）

> **统一架构主题**：一类功能的共同模式——「已写正文 → AI 提取 → 结构化产物 → 展示」。方向是从小说回提，**不是写作前规划**。当前每章写完后 AI 已提取 5 类状态卡（角色/地点/物品/势力/事件），这些产物应被升级为独立、可整本提取、可视化的功能。

**25.5.2-a 故事进程年表**
- 与"历史年表（世界背景）""故事线（剧情结构）"严格区分——这是**正文里发生过的剧情大事**
- 复用 `state-extract-adapter` 的事件提取；新增独立入口
- 一键「从已写章节提取故事年表」：对整本/选定范围跑提取
- AI 梳理为：故事内纪年（如"开元三年春"）+ 重要度分级 + 因果关联
- 用户可在结果上手动增删改

**25.5.2-b 游戏包裹式物品栏（重要）**
- **定位**：把现有手动 CRUD 的「道具系统」升级为**自动追踪的物品栏**，像游戏包裹
- 主角在正文里获得物品 → AI 提取 → 物品栏自动出现该物品
- 记录**获得 / 消耗**全过程：显示当前数量 + 获得来源章节 + 消耗历程（时间线式）
- 复用 `state-extract-adapter` 的 `category='item'` 提取，但增强为带数量增减语义（+1 获得 / -1 消耗）
- 物品栏视图：当前持有（数量）+ 每件物品的获得/消耗历史
- 用户可手动修正 AI 提取结果

**AI 上下文关系（两子项共同）**：均为**纯产物**，默认独立于写作链路（不自动注入，避免污染）。可选增强：允许把年表/物品栏作为"前情提要/当前状态"注入后续章节（`buildContext` 可选数据源，开关控制，默认关），不动主流程。

#### 25.5.3 多世界版灵感反推

> **与「AI 建议世界」的本质区别**：灵感反推是用户**先给料**（碎片灵感/下游内容）→ AI 顺着用户思路反推；AI 建议是 AI 主导凭空生成。两者并存，不是冗余。

- InspirationPanel 在多世界模式下，输出结构增加 `worlds[]`（每个世界含 worldOrigin/powerHierarchy/穿越条件等）
- 用户写"我想要斗破、遮天、完美三个世界，主角带系统穿越"这类带具体意图的灵感 → AI 顺着扩展每个世界
- 采纳时批量创建世界组 + 各世界 worldview + 角色归属（`homeWorldGroupId`/`isCrossWorld`）
- **⚠️ 硬约束：字段映射正确性**（用户多次强调，历史上反复出 bug）
  - AI 输出的每个字段必须与实际存储字段名**严格对齐**（参考已修复的灵感反推/信仰拆分 bug：曾输出 summary/geography 等废字段，实际面板用 worldOrigin/continentLayout）
  - 采纳前用 AI 做分门别类的结构化解析，确保内容填入正确的框，**禁止脆弱的关键字/正则映射**
  - 上线前必须验证：每个生成字段都能正确落到对应 UI 输入框并持久化
- **AI 上下文关系**：纯前置生成工具，产物写入世界组数据后，后续写作仍走标准 `buildCurrentWorldContext`，不引入新的写作上下文路径

#### 25.5.4 世界关系流向图（4 模板自适应）

> **设计核心：不做"全自动识别"**（脆弱且易出乎意料），改为「智能默认 + 手动切换」。

- 渲染层（4 布局共用）：节点 = 圆+图标+世界名+颜色；连线 = SVG 箭头，按 `linkType` 区分颜色/虚实
- 定位层（4 个纯函数）：
  - 横向流程线（诸天流/快穿）：x 均匀递增
  - 中心辐射（无限流）：主世界居中，其余沿圆周
  - 纵向阶梯（修仙多界）：按 order/类型分层，y 递减，飞升箭头向上
  - 树状分支（平行世界）：从分叉点递归散开
- 顶部布局切换下拉 + 智能默认（有 instance→辐射、多 ascension→阶梯、否则→流程线），用户可手动改
- 纯 SVG 不引第三方库，世界数一般 3-8 个，固定模板布局无需力导向避让
- 新文件 `src/components/world-group/WorldRelationGraph.tsx`，嵌入世界总览面板替代/补充现有关系列表
- **AI 上下文关系**：纯展示功能，完全独立于 AI 写作链路，零接触

**优先级建议**：25.5.1（多世界历史标签，小）> 25.5.4（关系流向图，中）> 25.5.2-b（物品栏，中，用户重点）> 25.5.3（多世界灵感反推，中）> 25.5.2-a（故事年表，中大，依赖事件提取打磨）

---

### Phase 34 — 主角力量阶段追踪（下游提取产物）

> 来源：用户构想（2026-06-03） | 状态：未开始 | 归属：「下游提取产物」一类，与物品栏（25.5.2-b）、故事年表（25.5.2-a）并列

**定位**：「已写正文 → AI 提取 → 结构化产物」的下游提取。主角随剧情成长，AI 自动检测并记录主角在其所修**修炼体系**中当前到达的境界，展示当前境界 + 一路晋升历程。

> **关键概念修正（用户确认）**：追踪的参照不是世界底层「力量体系」（练气/魔法/斗气，即能量本身），而是 **Phase 37 的「修炼体系」**（武夫/术士/召唤师等使用能量的流派，各有境界阶梯）。一个角色可能主修某一个修炼体系。

**现状缺口**（已确认）：现有状态表的状态提取是自由 key-value，**可能**顺手记一条"境界:金丹"，但：① 不专门、不保证；② 不读任何已定义的境界阶梯，无法判断"当前在第几阶/距下一阶差什么"；③ 无结构化的当前阶段 + 晋升历程展示。

**设计要点**：
- **挂钩修炼体系阶梯**：提取时把角色所修「修炼体系」（Phase 37）的境界阶梯作为参照喂给 AI，判断当前阶段在阶梯中的位置
- **主角为主**：默认追踪主角，可扩展到其他重要角色；一个角色可标注主修的修炼体系
- **进度 + 历程**：当前阶段 + 每次突破的章节/触发条件（时间线式，像"修为进度条"）
- **多世界适配**：诸天流每个世界的修炼体系不同，按当前世界的体系判断；与世界组「能力限制」字段呼应（主角跨世界被压制）
- **可反哺写作**：主角当前境界可作为上下文注入后续章节，避免 AI 写出境界倒退硬伤
- **依赖**：Phase 37（修炼体系）—— 没有定义好的境界阶梯就无法判断阶段，故 37 是 34 的前置
- **AI 上下文关系**：纯产物，默认独立于写作链路；可选注入开关，默认关

---

### Phase 35 — 世界观词条化重构（自然/人文重新划分 + 道具系统拆分）

> 🏗️ **施工权威**：`docs/CODEX-REFACTOR-PLAN.md`（Phase 35-b/c 分步施工蓝图,防跑偏)。设计依据 `docs/CODEX-REDESIGN.md`。

> 来源：用户构想（2026-06-03） | 状态：**设计文档已完成、35-a 部分落地但跑偏** → `docs/CODEX-REDESIGN.md` | 规模：大重构（动 DB + 核心世界观面板）

---

#### ⚠️ 35 实施现状核对（2026-06-09 · 用户实测发现实现跑偏）

> 用户实测截图确认：**当前实现与原始设想（CODEX-REDESIGN.md §2）方向相反，且产生三处重复**。35-b/c 的真正任务因此是「**整合 + 消重 + 下线**」，**不是「再加功能」**。任何接手者必须先读这一节，避免在跑偏的结构上继续叠加。

**原始设想（最终形态 · 不可偏离）**：词条化是**长在「自然环境 / 人文环境」面板内部**的组织方式，**不是单独一个模块**——
- 🏔️ 自然环境面板 = 概述字段 + **自然物产词条化三类**（⛏️矿物灵材 / 🌿灵植草药 / 🐅灵兽异兽）；「重镇分布」移走。
- 🏛️ 人文环境面板 = 🧬种族 / ⚔️势力(并阵营) / 🏰城池重镇(从自然移来) / 🗡️人工器物(并道具系统) **全部词条化** + 政治/经济/文化/矛盾冲突概述字段。
- 侧栏「道具系统」**下线**；各概念**全局唯一来源**，不重复。

**当前实现（跑偏现状）**：

| 维度 | 原始设想 | 当前实现 | 偏差 |
|---|---|---|---|
| 词条归属 | 嵌入自然/人文面板内 | 单拎成**独立「设定词条」侧栏项** | ❌ 方向相反 |
| 自然资源 | 词条化(矿物/灵植/灵兽) | 自然环境面板里仍是**旧纯文本**(无AI、不保存、只有占位示例) | ❌ 未改造 |
| 道具系统 | 侧栏下线、并入人文 | **仍在侧栏** | ❌ 未下线 |
| 单一来源 | 每概念唯一处 | 自然/人文概念散布在**世界观面板 + 设定词条 + 道具系统 三处** | ❌ 三重重复 |
| 分类列表 | 每类一条 | 截图显示「种族/势力/城池/器物」**各重复出现两遍** | ❌ 疑似分类去重 bug |

**35-b/c 真正要做的事（=整合+消重，按此执行，禁止"另起新功能"）**：
1. **收口到面板**：把「设定词条」里的词条按归属**搬进自然环境/人文环境面板内部**呈现（面板内分「概述字段 + 词条区」）；独立「设定词条」侧栏项最多保留为**只读聚合入口**，不再是唯一/主入口。
2. **自然环境面板词条化**：把「自然资源」旧纯文本字段改造为**矿物灵材/灵植草药/灵兽异兽**三类词条（含 AI 生成 + 保存，顺带修当前"不保存"bug）。
3. **人文环境面板词条化 + 重镇迁移**：种族/势力/城池/器物落到人文面板；「重镇分布」从自然移到人文「城池重镇」。
4. **下线道具系统**：侧栏「道具系统」入口移除，数据并入人文「人工器物」词条（保留迁移/兼容,不丢旧数据）。
5. **消除分类重复**：排查「设定词条」分类列表的重复渲染/重复建类(截图各类出现两遍)。
6. **守三注册表**：词条表/字段/上下文注入一律走 PROJECT_TABLES / FIELD_REGISTRY / CONTEXT_SOURCES，不在面板手写。

**完成判据**：① 自然/人文概念在 UI 上**只有一处**(面板内)；② 道具系统侧栏消失；③ 自然资源可词条化创建+AI生成+保存；④ 分类列表无重复；⑤ 旧数据不丢。

---

**用户提出的问题**：
1. 人文「道具与器物」字段 ↔ 侧栏「道具系统」面板**重合**
2. 物产/道具应分**自然产出 vs 人工产出**：自然产出归自然环境，人工产出归人文
3. 这些设定应**词条化创建**（用户建词条卡片，每个词条有结构化属性）
4. 自然资源里**活物（飞禽走兽）与矿石混在一起**不合适，活物应单独成类
5. 自然环境的**「重镇分布」其实是人文内容**，应移到人文
6. 人文环境里**种族民族 / 政治经济文化堆在一起**，需拆细
7. **去掉侧栏「道具系统」**，分到自然/人文

**重构后的信息架构（草案）**：
- 🏔️ 自然环境（天然世界）：世界结构 / 疆域尺寸 / 地貌分布 / 山川水系 / 气候环境 + **自然物产（词条化三类：⛏️矿物灵材 / 🌿灵植草药 / 🐅灵兽异兽）**。重镇分布移走。
- 🏛️ 人文环境（人造世界，拆细）：🧬种族与民族（词条）/ ⚔️势力分布（词条）/ 🏛️政治 / 💰经济 / 🎭文化（语言·宗教·风俗）/ 🏰城池重镇（词条，从自然移来）/ 🗡️人工器物（词条，原道具系统并入）/ 🔥矛盾冲突

**词条系统设计（核心，含字段 schema）**：
通用字段：名称 / 图标 / 一句话简介 / 详细描述 / 备注。各类型专属字段：
- ⛏️ 矿物灵材：外观(形状/颜色/质感) / 品级品阶 / 功效作用 / 产地分布 / 稀有度 / *可炼制成的器物*
- 🌿 灵植草药：形态 / 药效 / 品级 / 生长环境 / 成熟周期 / 采集难度 / *可炼制成的丹药*
- 🐅 灵兽异兽：类别(走兽/飞禽/水族/虫豸/异种) / **力量体系等级** / 体型外貌 / 习性性情 / 栖息地 / 威胁等级 / 特殊能力 / *可产出材料(兽核/皮毛/内丹)*
- 🧬 种族民族：外貌特征 / 种族天赋 / 平均寿命 / 人口规模 / 聚居地 / 文化习俗 / 信仰 / 与其他种族关系 / 代表人物
- ⚔️ 势力（**合并原阵营 Faction**）：类型(门派/朝廷/商会/部落) / 势力范围 / 领导者 / 核心成员 / 实力等级 / 宗旨目标 / 敌友关系 / 标志旗帜 / 绑定地图区域
- 🏰 城池重镇：所属势力 / 地理位置 / 规模人口 / 统治者 / 经济特产 / 战略地位 / 城市风貌 / 地标建筑
- 🗡️ 人工器物：类别(武器/防具/法器/丹药/功法秘籍/阵法/材料) / 品级品阶 / 外观 / 能力效果 / 炼制方式 / *所需材料(关联自然物产)* / 来历 / 当前持有者
- **互相关联**：矿物→可炼器物、草药→可炼丹药、器物→所需材料，形成"材料→成品"链。

**已拍板（用户确认 2026-06-03）**：
1. ✅ **势力 + 阵营合并**：势力词条与现有阵营(Faction)合并为一套，不再双轨
2. ✅ **世界历史线并入历史年表**：人文的「世界历史线」并进已词条化的历史年表，人文不再单列历史线
3. ✅ **不做已填数据自动迁移**：重构后不强行迁移旧自由文本。但——**用户主动选择「导入」时，AI 介入分类**：走导入流程，AI 把导入内容按重构后的分类（自然物产/人工器物/种族/势力/城池…）分门别类填进对应词条
4. **自定义分类（用户确认必做）**：自然/人文下预设的分类不一定覆盖用户需求，需支持用户自定义——
   - 可在现有内容上**新增自定义大类或小类**
   - 自定义大类下还能再**加自定义小类**（多级可扩展）
   - 自定义类型可定义自己的词条字段 schema（或继承通用字段）

**与 Phase 37 的关系**：人工器物的「品级」「力量需求」等可关联修炼体系；异兽词条的修炼进阶走 Phase 37 的修炼体系（而非世界底层力量体系）。

**风险**：动 DB（新增词条表 + 类型 schema + 自定义分类树）+ 核心世界观面板重写。无需数据迁移（不动旧数据），但需做好导入流程的 AI 分类。需先写完整设计文档，分类逐步落地，每步可验证。

---

### Phase 36 — 页面"上游/下游"内容标记（信息架构标识）

> 来源：用户构想（2026-06-03） | 状态：未开始 | 价值：降低工具理解门槛

**问题**：工具面板越来越多，新用户点开一个侧边栏标签，分不清这个页面是"我来填、AI 写作时读它"（上游设定），还是"AI 从我写好的正文里提取出来的"（下游产物）。需要在页面上做**明确标记**，让用户一眼理解每个页面的性质。

**内容分类（待确认的初步划分）**：

| 类别 | 含义 | 包含页面 |
|------|------|---------|
| 📥 **设定（上游）** | 你填它 → AI 写作时读它 | 世界观全部（真实与幻想/世界起源/自然/人文/历史年表/世界地图/世界总览）、故事设计、角色全部、关系网、创作规则、大纲、故事线、重要地点、伏笔 |
| ✍️ **创作（正文）** | 实际写作 | 章节 |
| 📤 **产物（下游）** | AI 从已写正文提取 | 状态表、物品栏、故事年表、（未来）主角力量阶段 |
| 🛠️ **AI 工具/生成器** | AI 辅助生成/反推/考证 | 灵感反推、角色驱动、场景考证、AI 建议世界 |
| ⚙️ **系统** | 工具配置类 | 提示词库、导入、导出、版本历史、设置 |

> 注：有少数页面是混合性质——伏笔既是上游规划又有下游提取成分；状态表是下游但可反哺。标记取其**主要性质**，必要时加副标注。

**实现思路**：
- 每个 `SidebarModule` 加一个 `contentType` 属性（upstream/writing/downstream/tool/system）
- 面板顶部标题旁加一个小徽标（如 `📥 设定` / `📤 产物`），带 hover 说明（"这是 AI 从你已写的正文中提取的内容"）
- 可选：侧边栏标签也加细微的颜色/图标区分；或在标签分组层面标注
- 纯展示，零接触业务逻辑

---

### Phase 37 — 修炼体系（多体系境界设计）

> 来源：用户构想（2026-06-03） | 状态：设计文档已完成 → `docs/CODEX-REDESIGN.md` 第四章 | 是 Phase 34（力量阶段追踪）的前置

**核心概念区分（用户确认）**：工具里要明确分开两层——

| | 世界观·力量体系（已有） | 修炼体系（新增） |
|---|---|---|
| 是什么 | 世界**底层的能量本身** | 利用这种能量的**不同流派/方式** |
| 例子 | 灵气 / 魔力 / 斗气 | 武夫境界、术士境界、召唤师境界… |
| 数量 | 一个世界一种（或少数） | 一个世界**可有多个**，用户自行设计 |
| 谁定 | 世界设定（世界起源·力量体系字段，保留） | 用户自建 |

**修炼体系设计要点**：
- 用户可创建**多个**修炼体系（武夫 / 术士 / 召唤师 / 炼丹师…），各自独立
- 每个修炼体系有**有序的境界阶梯**（如武夫：炼体→易筋→洗髓→…；术士：学徒→法师→大法师→…），每阶可填名称、特征、突破条件、战力描述
- **珍禽异兽也能有自己的修炼体系**（Phase 35 异兽词条关联其修炼体系）
- 角色可标注主修的修炼体系（供 Phase 34 力量阶段追踪参照）
- 多世界适配：每个世界可有不同的修炼体系集合
- **AI 上下文关系**：修炼体系定义属上游设定，AI 写作时可注入（写战斗/突破时遵守境界设定）

**与现有「力量体系」字段的关系**：世界起源的「力量体系」字段保留，描述世界底层能量是什么（练气/魔法/斗气）；新增的「修炼体系」是利用方式的多套阶梯。二者层级不同，不冲突、不合并。

---

## 🔵 优先级：低（远期）

### 架构·项目表唯一注册表（防"新表漏接生命周期"）

> 来源：删除引用完整性审计发现的反复根因 | 中优先

`importantLocations / worldRulesProfiles / codexCategories / codexEntries / aiUsageLog` 等较新表反复漏接入生命周期操作（导出 / deleteProject / deleteGroup / migrateToMultiWorld 各自手列表）。建一份 `PROJECT_TABLES` 唯一注册表（每表标注 projectId / worldGroupId / 外键 / 是否树形），让 export·导入·deleteProject·deleteGroup·migrate 全从它派生 → 加新表只改一处，结构性杜绝漏接。与「统一上下文装配层 R-1」是同一类"单一事实源"思路。

### 审计遗留低优先项（2026-06-04 全量审计）

- **上下文预算真裁剪**（功能逻辑审计发现）：旧问题为 `autoTrimToFit` 只用于 UI 显示、请求侧不真裁。**已修复**：`chat()` / `streamChat()` 发送前调用 `trimMessagesToFit()`，并尊重用户配置的 `contextWindow`；回归见 `tests/registry/fb8-context-window.test.ts`。后续只保留 token-aware 细粒度 segment 裁剪优化。

- **提示词内容质量审查**（#4）：本次审计只核对了提示词与解析器的「字段 key 对齐」，未评估提示词本身产出质量。后续可逐个 prompt seed 评估输出是否达标、是否需调优。属调优非 bug。
- **性能·懒加载应用面板**（#5 续）：已完成——重型依赖 pdfjs/mammoth 改动态 import（首屏少加载 ~866KB）、three.js 本就动态、vite 拆 vendor-react。**剩余**：主包仍 ~1.93MB（应用代码 + dexie/zustand/lucide/canvas 渲染），进一步可用 `React.lazy` 懒加载重面板（3D 地图 / 作品学习 / 导入 / 世界地图）。中低优先。
- **响应式/移动端**（#6）：经核查全项目仅 5 文件用响应式断点，App 为**桌面专用**（与「移动端适配低优先」一致）；硬编码尺寸均为合理约束 + 正确 overflow，**未发现 CSS bug**。移动端适配维持低优先不做。
- **UI 交互行为运行时走查**（#2 续）：静态扫已确认无「条件 hooks 崩溃 / 列表缺 key」；可编辑列表少数用 index 作 key（删中间项可能 input 错位，轻微）。深层交互（点按生效/弹窗/状态更新）建议运行时逐面板走查补充。

### Phase 27 — AI Agent 化（对话副驾 + 后台 Agent）

> 来源：社区反馈（zzjj 等）+ 作者构想 | 状态：**设计文档已完成** → `docs/AI-COPILOT-DESIGN.md`

**核心定位**：把"对话"做成整个工具的总入口——用户自然语言提需求，AI 调用项目里对应功能生成/填写内容（世界观→正文）；同时一组后台 Agent 基于现有内容自动运行维护一致性。两者共用同一套工具层（Tool Layer）。

- **27.1-a** 工具层地基（只读工具优先，零风险）
- **27.1-b** Agent 执行引擎 + 提供商 tool calling 适配/降级
- **27.1-c** 对话副驾 MVP（右侧对话栏 + 意图识别 + 确认卡片 + 面板同步），从世界观引导填写切入
- **27.1-d** 扩展对话覆盖面（灵感反推/角色/大纲/正文）
- **后台 Agent**：整理本章 Agent（先）→ 一致性 Agent → NPC 演进 Agent（即 27.3）

详细愿景、产品故事、工具集（精确对应现有 store/adapter）、与现有功能的精密组合、风险对策、分期，见设计文档。

旧 27.1 评估要点（已纳入设计文档）：
  - 当前架构限制：AI 调用是「用户触发 → 流式输出 → 用户采纳」的单轮模式
  - 目标：支持 AI 自主决定查询什么数据、推演什么内容的多步推理 agent 模式
  - 需评估 tool calling 接入成本（不同 AI 提供商的兼容性）

- **27.2** 历史考证助手（场景级 AI 辅助创作）
  > **用户原始需求（zzjj）**：
  > "我现在更重要的需求是在构思某些场景和情节的时候，让 AI 模型主动帮我去边考证边想一些符合历史背景的点子。"
  >
  > 即：作者在撰写过程中，AI 在后台辅助思考，结合已有的世界观、历史年表、世界规则等设定，主动提供符合历史/设定背景的细节建议和灵感点，而不需要作者每次手动发起请求。

  - **Phase 27.2a** ✅ 已完成（2026-06-03）：「场景考证」按钮——用户描述当前场景，AI 结合世界观+历史年表+世界规则返回考证建议和细节点子。创作区新增「场景考证」面板，多世界模式按当前世界读取上下文。
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
