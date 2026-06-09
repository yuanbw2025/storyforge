# 🔄 换机交接手册（HANDOFF）

> **本文档是 AI 助手换机/换会话时的唯一交接依据。**
> 任何新 Claude / Sonnet / Gemini 会话第一件事必须完整读完此文档。
> 最近更新：**Phase 18 方案 A（原文 Blob 持久化）已落地**（2026-05-12）。
> 由 Opus 4.7 撰写，Sonnet 4.7 续写到 2026-05-12。

---

## 0.0 最新进展速报（Phase 18 方案 A — 2026-05-12）

### 解决的糙点
Phase 18 原文只存在内存 `IN_MEM_CHUNK_TEXT`，刷新浏览器就没了；续跑要求用户重新上传同一文件。

### 方案
Dexie v10 新增 `importFiles` 表（主键 = sessionId），上传时把原始 File 作为 Blob 写入；面板打开发现未完成 session 自动 `loadBlob` → 包 File → `extractTextFromFile` → `chunkDocument` → `registerChunkTexts` → 显示「立即续跑」按钮。启动时调 `navigator.storage.persist()` 防 GC。容量估算：千万字 ≈ 20-30 MB，远低于浏览器额度。

### 新增/修改文件
```
src/lib/types/import-file.ts                  ← 新增 ImportFileBlob
src/lib/types/index.ts                        ← export * from './import-file'
src/lib/db/schema.ts                          ← v10：importFiles: 'sessionId, fileHash, createdAt'
src/stores/import-session.ts                  ← +saveBlob / +loadBlob / +deleteBlob
src/components/system/ImportDocPanel.tsx      ← Blob 恢复流程 + persist 权限 + 三态续跑 UI
PROGRESS.md                                   ← 新章节「Phase 18 方案 A」
docs/HANDOFF.md                               ← 本文件
```

### 验收
- ✅ `npx tsc --noEmit` 通过
- ✅ `npm run build` 通过（PWA v1.2.0, 8 entries, 2203 KiB）
- ⏳ 真实关 / 开浏览器后续跑 —— 待用户本地验证

### 下一步候选
用户已点头但未开工：**Phase 19 「大师作品学习模式」** —— 把导入流水线升级为"拆解白金作家作品、学习其世界观/角色/情节设计思路"的工具。完整架构见本次会话讨论记录。

---

## 0.1 上一次速报（Phase 18 — 2026-05-11）

### 背景问题
上传《知北游》1.6M 字 txt 触发「AI 输出无法解析为 JSON」—— 根因是 AI 单次输出被 maxTokens 截断。
旧流程：整篇文档一次性塞给 AI → JSON 必然截断。

### 解决方案：分块流水线（断点续传 + 千万字级）
- **旧路径已废弃**：`ImportDocPanel.tsx` 已完全重写为「上传 → 分块预估 → 用户确认 → 逐块串行解析 → 实时落库 → 最终角色合并 → 完成/失败报告」
- **关键限制**：浏览器关闭后恢复需用户重新上传同一文件（chunk 原文只存在内存中的 `IN_MEM_CHUNK_TEXT`，DB 只存元数据 + 每块的 hash）
- **可恢复**：基于 hash 匹配，用户上传后系统会自动识别未完成 session 并询问是否续跑
- **AI 去重**：每 10 块 + 最终一次，调用 `import.merge-characters` 合并跨块人物

### 新增/修改文件清单
```
src/lib/types/import-session.ts              ← 新增
src/lib/types/import-session-data.ts         ← 新增（UnifiedParseResult，避免循环依赖）
src/lib/types/prompt.ts                      ← +'import.parse-chunk' | 'import.merge-characters'
src/lib/ai/prompt-seeds.ts                   ← +2 条 system seed
src/lib/ai/adapters/import-adapter.ts        ← re-export UnifiedParseResult
src/lib/db/schema.ts                         ← v9：+importSessions / +importLogs
src/lib/import/chunker.ts                    ← 新增：3 层回退切块 + quickHash
src/lib/import/pipeline.ts                   ← 新增：runSession/pause/cancel/retryFailed
src/stores/import-session.ts                 ← 新增：Dexie CRUD + findUnfinished
src/stores/import-status.ts                  ← 新增：pipeline phase/counts/activity（max 200）
src/components/system/import/ImportStatusBar.tsx        ← 新增
src/components/system/import/ImportProgressPanel.tsx    ← 新增：N 格进度矩阵
src/components/system/import/ImportActivityLog.tsx      ← 新增
src/components/system/import/ImportConfirmModal.tsx     ← 新增：事前预估（时长/token/费用）
src/components/system/import/ImportReportModal.tsx      ← 新增：事后报告 + 重试失败块
src/components/system/ImportDocPanel.tsx     ← 完全重写为新流水线入口
vite.config.ts                               ← workbox maximumFileSizeToCacheInBytes: 5MiB
docs/playbooks/PHASE-18-import-pipeline.md   ← 新增：完整架构说明
PROGRESS.md                                  ← +Phase 18 章节
```

### 验收
- ✅ `npx tsc --noEmit` 通过
- ✅ `npm run build` 通过（PWA v1.2.0, 8 entries）
- ⏳ 真实 1.6M 字 txt 端到端跑通 —— 待用户本地验证

### 架构详文
参见 [`docs/playbooks/PHASE-18-import-pipeline.md`](./playbooks/PHASE-18-import-pipeline.md)

---


## 0. 给新会话的开场指令模板

> 用户请把以下文字粘贴给新 Claude 会话作为第一句话：
>
> ```
> 请完整读取 docs/HANDOFF.md，然后告诉我你理解到的当前状态、
> 下一步要做什么、以及你需要我做什么。读完后等我确认再开始动手。
> ```

---

## 1. 项目身份

- **GitHub 用户**：yuanbw2025
- **个人网站**：https://yuanbw.vercel.app/（"悬象 · Xuán Xiàng"）
- **沟通语言**：简体中文，代码和注释可用英文
- **协作模式**：用户授权 AI 全权进行开发、git push/pull、建仓
- **当前正在开发的子项目**：StoryForge（故事熔炉，AI 辅助小说创作）

---

## 2. 仓库地图（双仓库模式）

```
E:\MYgithub\
├── my-website\      ← 🔒 私有主库（Vercel 唯一部署入口）
│   └── storyforge\  ← 主库内的 StoryForge 子项目
├── storyforge\      ← 🌐 公开镜像（社区下载）
├── infiniteskill\   ← 其他子项目
├── yuntype\
├── cyber-flying-sword\
├── flying-sword-pinball\
└── Infinite_SpatioTemporal_Map\
```

### 双仓库同步规则（铁律）

- **开发改动只在 `E:\MYgithub\storyforge\` 进行**
- 推送 storyforge 镜像后，**手动 cp 同步**到 `E:\MYgithub\my-website\storyforge\`
- 然后在 `my-website` 也 commit + push
- 永远保持两个仓库内容**逐字节一致**

### 同步命令模板

```bash
SRC="E:/MYgithub/storyforge"
DEST="E:/MYgithub/my-website/storyforge"

# 同步源代码
cp -r "$SRC/src/." "$DEST/src/"
cp -r "$SRC/docs/." "$DEST/docs/"
cp "$SRC/package.json" "$DEST/package.json"
# 按需追加其他改动文件

cd E:/MYgithub/my-website
git add storyforge/
git commit -m "sync(storyforge): <概述>"
git push origin main
```

---

## 3. 当前 Git 状态（2026-05-07）

**最新 commit**（my-website main 分支，已 push origin/main）：

| Phase | commit | 内容 |
|-------|--------|------|
| P0  | `2eac11d` | 流派标签数据 + Playbook 体系 |
| P1  | `bf40acb` | 提示词基础设施 — promptTemplates v6 + 渲染引擎 + 6 适配器 |
| P2  | `70652b0` | 提示词管理 UI — 设置 Tab + 列表 + 编辑器 + 实时预览 + 导入导出 |
| P3  | `42c5459` | 数据模型增量扩展 — 2 张新表 + 6 接口加可选字段 |
| P4  | `0cab068` | 侧边栏 5 一级三级树 + 提示词库升一级 + 7 个新占位 |
| P5  | `d4cddb1` | 世界观.世界起源 + 自然环境 — 共 13 字段每个带 AI 生成 |
| P6  | `c10d16f` | 世界观.人文环境 — 7 字段 + AI 生成 |
| P7  | `1e651e0` | 角色分档面板 — 次要 / NPC / 路人 |
| P8  | `db458a6` | 创作区六模块全开 — 故事设计 7 字段 / 规则 AI / 章节列表 / 细纲 |
| P9  | `8690707` | 版本历史 UI — 时间线 + 创建 / 恢复 / 删除 |
| P10 | `321f2c7` | AI 文档解析导入 — 3 类型 + 上传/粘贴 + 预览 + 一键入库 |
| P11 | （本次） | 全侧边栏巡检 + 主题修复 + 重复菜单清理 + HANDOFF 更新 |

**镜像仓库**：本机暂未克隆独立 storyforge 镜像（按用户决议走 my-website 单仓发起）。
后续在原电脑或新增镜像 clone 时，需把 `storyforge/` 子目录手动 cp 同步到独立镜像仓库。

---

## 4. 当前开发任务：StoryForge 全面 UI/UX 重构（v3 重设计）— 已完成 ✅

### 战略文档（必读）

- 📜 `docs/09-REDESIGN-INTEGRATION-PLAN.md` —— v3 战略文档（约 1300 行）
- 📋 `docs/playbooks/TEMPLATE.md` —— Playbook 标准模板
- 📋 `docs/playbooks/PHASE-00-genre-web-search.md` —— Phase 0 完整执行手册（已完成）
- 📋 `docs/playbooks/PHASE-01..11-*.md` —— Phase 1-11 各自完整 Playbook

### 用户的核心诉求（3 句话总结）

1. **侧边栏改成四分区三级层级**：著作信息 / 设定库 / 创作区 / 设置区
2. **流派标签扩展**：从 8 条扩展到 70+ 条，参考起点/纵横/晋江三大平台
3. **AI 是核心特色**：每个创作模块都要 AI 一键生成按钮；提示词系统**对用户开放自定义**（关键差异化卖点）

### 开发分 12 个 Phase（全部完成 ✅）

| Phase | 内容 | 状态 |
|-------|------|------|
| **P0** | 流派标签数据 + Playbook 体系 | ✅ |
| **P1** | 提示词基础设施（promptTemplates 表 + 渲染引擎 + 6 适配器） | ✅ |
| **P2** | 提示词管理 UI（设置 Tab → P4 升一级） | ✅ |
| **P3** | 数据模型增量扩展（Dexie v7、+detailedOutlines/importJobs、6 接口加可选字段）| ✅ |
| **P4** | 侧边栏 5 一级三级树 + 提示词库升一级 + 7 占位 | ✅ |
| **P5** | 世界观.世界起源（3 字段）+ 自然环境（11 字段，含嵌套）| ✅ |
| **P6** | 世界观.人文环境（7 字段，AI 上下文带上游设定）| ✅ |
| **P7** | 角色分档（次要小卡片 / NPC 紧凑列表 / 路人表格）| ✅ |
| **P8** | 创作区六模块全开（故事 7 字段 / 规则 AI / 章节列表 / 细纲 AI 拆场景）| ✅ |
| **P9** | 版本历史 UI（基于 snapshots 表）| ✅ |
| **P10** | AI 文档解析导入（角色/世界观/大纲，支持 .txt/.md/.csv）| ✅ |
| **P11** | 全侧边栏巡检 + 主题修复 + 重复菜单清理 + HANDOFF 更新 | ✅ |

### 设计偏差备忘（与 v3 原文不一致的地方）

| 偏差项 | v3 原文 | 实际实施 | 理由 |
|---|---|---|---|
| Phase 3 数据迁移 | 删库重建 | 增量加表加字段，旧表暂留 | 保证每个 Phase 都 build 绿、可独立交付 |
| Phase 9 概念地图 | Voronoi 程序生成 + AI 视觉解析 | 暂用 Phase 1 的 SVG AI 生成；Voronoi 和 vision 留单独立项 | 工作量大、跨厂商兼容性深 |
| Phase 10 文件格式 | .docx / .xlsx / .csv / .md / .txt | 当前仅 .txt / .md / .csv | .docx/.xlsx 需引入额外库（mammoth/xlsx），按需补 |
| 旧表清理 | P3 删 factions/geographies/histories/itemSystems/references | 全部保留（路由仍可访问，但不在新 sidebar 暴露）| 数据未迁移完成前不动 |

### 工作流（关键决策）

```
Phase N 启动前 → Opus 写 Playbook
Phase N 执行   → Sonnet 跟着 Playbook 干（P0/P1 由 Opus 自己执行）
Phase N 验收   → Opus 抽查（运行 § 7 全功能巡检）
Phase N 完成   → 进入 Phase N+1
```

**"Opus 设计 + Sonnet 执行 + Opus 验收"** 模式，成本最优。

---

## 5. Phase 0 已完成内容

### 产出

- ✅ `src/lib/data/genre-presets.ts` —— 77 条流派标签（48 male + 19 female + 10 general）
- ✅ `docs/09-REDESIGN-INTEGRATION-PLAN.md` —— v3 战略文档
- ✅ `docs/playbooks/TEMPLATE.md`
- ✅ `docs/playbooks/PHASE-00-genre-web-search.md`
- ✅ 双仓库已 push

### Phase 0 中的重要决策

1. **WebFetch 三站均失败**（页面 JS 渲染/反爬虫），降级使用人工对照三站分类整理的 77 条数据
2. **决议 1**：保留细纲（Phase 8 实现）
3. **决议 2**：暂用 Sonnet 提案的章节/正文拆法，先做了再说
4. **决议 3**：暂用 Sonnet 提案的伏笔时间线 + 大纲极简化方案
5. **决议 4**：保留角色关系网络（CharacterRelationPanel 力导图）
6. **决议 5（重要）**：概念地图升级到"程序化奇幻地图（Inkarnate 风格）+ AI 视觉反向解析" → 已写入 Phase 9
7. **决议 6**：题材模板包延后开发，先做基础版本
8. **决议 7**：不考虑旧用户兼容（开发期，无真实用户）→ Phase 3 直接清空数据库
9. **决议 8**：提示词自定义独立成 v3 文档第三章，是核心特色

---

## 6. 当前架构总览（Phase 1-11 落地后）

### 提示词系统（Phase 1-2 + P8/P10 增量）

- **数据层**：`promptTemplates` 表（v6）— 19 条 system seed
- **渲染引擎**：`src/lib/ai/prompt-engine.ts` — 支持 `{{var}}` + `{{#if var}}...{{/if}}`
- **schema 自检**：`src/lib/db/ensure-schema.ts` — 启动时检测缺表自动重置 DB（开发期专用）
- **9 个适配器**（`src/lib/ai/adapters/`）：
  - worldview / character / outline / chapter / foreshadow / geography（P1）
  - story / rules / detail-scene / import（P8/P10）
- **管理 UI**：「提示词库」一级菜单（`PromptManagerPanel`）— 列表 + 编辑器 + 实时预览 + 导入/导出

### 数据模型（Dexie v7，19 张表）

- 旧表（兼容保留，路由可访问但 sidebar 不暴露）：factions / geographies / histories / itemSystems / references
- 新表：detailedOutlines / importJobs / promptTemplates
- Worldview 字段从 7 扩到 23（含 v3 §2.1 的 worldOrigin / 自然环境 / 人文环境 全套）
- StoryCore 从 4 扩到 8 字段
- Character role 加 npc / extra；新增 location / firstAppearance / storyRole / ending

### 侧边栏 5 一级三级树（Phase 4）

```
📚 著作信息 / 🌍 设定库 / ✏️ 创作区 / 🎯 提示词库 / ⚙️ 设置区
```

数据驱动：`src/components/layout/sidebar-tree.ts`。要加新 module 只改这一个文件。

### AI 一键生成覆盖

| 模块 | 字段数 | AI 集成 |
|---|---|---|
| 世界起源 | 3 | ✅ |
| 自然环境 | 11 (含 4 子) | ✅ |
| 人文环境 | 7 | ✅ |
| 故事设计 | 7 | ✅ |
| 角色（主要） | 完整 | ✅ |
| 创作规则 | 3 主字段 | ✅ |
| 大纲 | 卷 + 章节 | ✅ |
| 细纲 | 场景拆分 | ✅ |
| 章节正文 | 写/续/润/扩/去 AI 味 | ✅ |
| 伏笔 | 建议 | ✅ |
| 文档导入 | 角色/世界观/大纲解析 | ✅ |

---

## 7. 当前可继续的开发（如果要继续）

### 短期收尾（按需）

- 旧表数据迁移：写脚本把 factions / geographies / histories / itemSystems / references 中的现有数据迁到 worldview.* 字段，然后删旧表
- 移除 DataManagementPanel 重复 Tab：版本历史 / AI 解析导入两个 Tab 已被一级菜单替代，只剩"导出"功能；可以彻底拆成 ExportPanel
- 提示词模板 modelOverride（temperature/maxTokens）在 PromptManagerPanel 编辑器里加 UI

### 中期增量（v3 §3.7 / §3.8）

- 提示词工作流（链式编排，蛙蛙写作风格）— 新表 promptWorkflows
- 题材模板包（玄幻/言情/科幻 等多套预设包）

### 长期（v3 §6 P9 / §3.9）

- 概念地图 Voronoi 程序生成 + AI vision 反向解析（需 vision API 跨厂商兼容）
- 提示词社区市场（需后端）
- A/B 测试 / 自动调优（需用户行为数据）
- .docx / .xlsx 文件解析（需 mammoth / SheetJS 库）

---

## 8. 换到新电脑的标准启动流程

### 第一次（克隆双仓库）

```bash
# 在新电脑创建工作目录
mkdir E:\MYgithub
cd E:\MYgithub

# 克隆双仓库
git clone https://github.com/yuanbw2025/my-website.git
git clone https://github.com/yuanbw2025/storyforge.git

# 安装依赖
cd storyforge
npm install --registry https://registry.npmmirror.com

# 验证 build
npm run build
```

### 已克隆过（拉取最新）

```bash
cd E:/MYgithub/storyforge && git pull origin main
cd E:/MYgithub/my-website && git pull origin main
```

### Git 凭据

- 用户已在原电脑用 GCM (Git Credential Manager) 存了 PAT
- **新电脑必须重新登录**：第一次 `git push` 时会弹出 GitHub OAuth/PAT 输入
- **建议**：新电脑直接到 GitHub Settings → Developer Settings → Personal Access Tokens 生成一个新的 PAT（scopes 勾选 `repo`、`workflow`），不要复用旧 token
- 配置完成后 Windows 凭据管理器会自动保存，后续 push/pull 无感

### 启动开发服务器

`E:\MYgithub\.claude\launch.json`（每台电脑各自的本地配置）：

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "storyforge-dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev", "--prefix", "storyforge"],
      "port": 5175
    }
  ]
}
```

> 端口选 5175 是因为 5173/5174 在原电脑上被其他进程占用。新电脑可改回 5173。

---

## 9. 用户档案与协作偏好（重要）

### 沟通风格
- 用户希望 AI 把规划讲清楚再动手，**反对自作主张**
- 用户能理解架构，能审查 AI 的方案
- 用户喜欢具体的文档+代码，不喜欢含糊的描述
- 用户有过被 AI"自作主张改坏系统"的不愉快经历

### 关键纪律（来自 AI_HANDOVER_GUIDE.md）

1. ❌ **API Key 绝不硬编码** —— 只用 `process.env.SECRET_GEMINI_KEY`
2. ❌ **不重构 telemetry-sync.js 为 OpenAI SDK 形式** —— 它是 Gemini 原生调用
3. ❌ **根目录不是 Vite 项目** —— 不要给根目录加 vite.config
4. ✅ **每次完成改动后**：在 my-website 的 WORKING_MEMORY.md 顶部插入 `[HH:MM:SS]` 日志条目
5. ✅ **镜像同步是手动的** —— 双仓库改动需要手动 cp 然后双 push
6. ❌ **无占位符** —— 不写 `// 省略`，不清楚就问用户
7. ❌ **改动前必须报告计划等用户确认** —— 不可擅自动手

---

## 10. 已知的待解决问题

### 安全：my-website 的 PAT 暴露

`E:\MYgithub\my-website\.git\config` 中 remote origin URL 含明文 PAT（具体 token 已从此文档脱敏，可在本地 `.git/config` 直接查看）。

**建议**：① GitHub Settings 撤销该 token；② 生成新 token；③ `git remote set-url origin https://github.com/yuanbw2025/my-website.git`（清掉 URL 里的 token，改用 GCM）。

**状态**：待处理。换电脑时 .git/config 不会被克隆带过去（只是本地 push 凭据），但建议在新电脑配置时直接走干净的 PAT 流程。

### 项目状态遗留

- 云中书 YunType 排版系统架构缺陷：T1-T5 仅改 CSS 参数不改 HTML 结构（用户已知，待重构，与 StoryForge 无关）
- 赛博飞剑 MVP 待开发（与 StoryForge 无关）

---

## 11. 完整的功能 Backlog（必读）

> 这份 Backlog 原本在 `C:\Users\yuanj\.claude\projects\E--MYgithub\memory\storyforge_backlog.md`，
> 是机器本地文件不会跟 git 走，所以**完整内容下面镶嵌**。

### 🔴 当前迭代（UI/UX 重构）

- [x] Phase 0：流派标签 + Playbook 体系
- [ ] Phase 1：提示词基础设施
- [ ] Phase 2：提示词管理 UI
- [ ] Phase 3：Dexie v6 schema 重建
- [ ] Phase 4：侧边栏导航三级重建
- [ ] Phase 5：著作信息面板
- [ ] Phase 6：世界观大面板
- [ ] Phase 7：角色设计 + 关系图
- [ ] Phase 8：创作区六模块
- [ ] Phase 9：概念地图（Voronoi + AI 视觉）
- [ ] Phase 10：AI 解析导入（含 .docx/.xlsx）
- [ ] Phase 11：UI 走查

### 🟡 AI 功能迭代

#### AI 一键生成（Phase 6/7/8 各模块）
- [ ] 世界观整体生成（世界设定 + 文明体系 + 力量体系）
- [ ] 故事设计整体生成（故事核心 + 故事结构）
- [ ] 角色设计整体生成（生成主角 + 配角群）
- [ ] 大纲生成
- [ ] 章节续写/生成

#### AI 文档导入（Phase 10）
- [ ] 角色设定文档解析导入
- [ ] 世界观文档解析导入
- [ ] 大纲/故事文档解析导入
- 流程：粘贴文本/上传 .txt/.md/.docx/.xlsx → AI解析 → JSON预览 → 确认写入

#### 提示词系统（Phase 1+2 是基础）
- [ ] 各模块内置提示词模板设计（v3 文档第三章）
- [ ] 提示词对用户开放自定义（高级设置面板）
- [ ] 提示词版本管理（允许用户保存多套提示词方案）
- [ ] **提示词工作流**（链式编排，借鉴蛙蛙写作）
- [ ] **题材模板包**（玄幻/仙侠/言情/硬科幻等，每包 14+ 模板）
- [ ] 题材包社区分享（远期，需后端）
- [ ] A/B 测试两个模板（远期）
- [ ] AI 自动调优提示词（远期）

### 🗺️ 概念地图（Phase 9 升级）

- [ ] 程序化 SVG 奇幻地图生成（基于世界观参数）—— Voronoi + Simplex Noise
- [ ] AI 视觉反向解析（用户上传地图 → 自动填表）
- [ ] AIConfig 加 `visionModel` 字段（支持 Gemini Vision / Claude Vision / GPT-4o）
- [ ] `import.parse-map` 提示词模板（视觉解读专用）
- [ ] 不自研画板，让用户用 Inkarnate 等外部工具

### 🟢 体验优化（后续迭代）

- [ ] 章节状态徽章（未开始/草稿/修改中/完稿/终稿）
- [ ] 写作进度统计（已写字数 vs 目标字数，分章节）
- [ ] 故事结构可视化（三幕/节奏曲线）
- [ ] 大纲节点拖拽排序
- [ ] 角色头像上传
- [ ] 地理地图编辑器（集成现有 GeographyPanel）
- [ ] 深色/浅色/护眼三套主题切换 UI
- [ ] 全局搜索（跨模块检索角色名/地名/关键词）
- [ ] 移动端适配（长期）

---

## 12. 接续会话的预期行为

新会话启动后应该：

1. ✅ **完整读取本文档**
2. ✅ **复述当前状态**：在 Phase 0 完成、Phase 1 待启动
3. ✅ **确认即将做的事**：等用户回「清空完毕」后启动 Phase 1
4. ✅ **询问是否切换模型**：Phase 0/1 推荐 Opus，Phase 2+ 推荐 Sonnet
5. ❌ **不要直接动代码**：必须等用户确认理解一致

---

## 13. 关键文件锚点（速查）

```
docs/
  HANDOFF.md                              ← 你正在读
  09-REDESIGN-INTEGRATION-PLAN.md         ← v3 战略文档
  playbooks/
    TEMPLATE.md                           ← Playbook 标准
    PHASE-00-genre-web-search.md          ← 已完成

src/
  lib/
    data/genre-presets.ts                 ← Phase 0 产出
    types/                                ← 数据类型
    db/schema.ts                          ← Dexie schema（Phase 3 升 v6）
    ai/
      prompts/                            ← 旧硬编码（Phase 1 删除）
  components/
    layout/Sidebar.tsx                    ← Phase 4 重构
    worldview/                            ← Phase 6 整合
    character/CharacterPanel.tsx          ← Phase 7 重构
    outline/OutlinePanel.tsx              ← Phase 8 重构
    editor/ChapterEditor.tsx              ← Phase 8 保留
    foreshadow/ForeshadowPanel.tsx        ← Phase 8 重构
  stores/                                 ← Zustand stores
  pages/
    HomePage.tsx                          ← Phase 5 配套调整
    WorkspacePage.tsx                     ← Phase 4 路由配套
```

---

## 14. 联系/同步备注

- 用户使用一个工作账号 `yuanbw2025`，所有仓库属同一所有者
- 用户邮箱：`yuanjingwende@gmail.com`
- Git 配置已在原电脑设置好（`user.name yuanbw2025` / `user.email yuanjingwende@gmail.com`），新电脑首次运行需要重新设置：

```bash
git config --global user.name "yuanbw2025"
git config --global user.email "yuanjingwende@gmail.com"
```

---

**🟢 此文档为唯一交接依据。读完后等用户确认再开始动手。**
