# AGENTS.md · StoryForge 开发入口

> 这是编码 Agent 的默认入口，也是普通任务唯一必须自动加载的项目文档。
> `CLAUDE.md` 保留详细宪法解释；其余文档按
> [`docs/CONTEXT-ROUTING.md`](docs/CONTEXT-ROUTING.md) 命中任务后读取相关段落，禁止无差别全文预载。

## 先守住三注册表

StoryForge 是纯前端 React + TypeScript + IndexedDB 生产项目。用户手稿只存在浏览器中，
`main` 会直接部署，没有 staging。任何扩展都必须收口到三个单一事实源：

1. `CONTEXT_SOURCES` + `assembleContext()`：AI 读什么。
2. `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()`：AI 写什么。
3. `PROJECT_TABLES`：表的导出、导入、删除、迁移、世界作用域和引用重映射生命周期。

动手前依次回答：

1. 它读什么，是否已登记在 `CONTEXT_SOURCES`？
2. 它写什么，是否已登记在 `FIELD_REGISTRY` / `AdoptionSchema`？
3. 它涉及哪些表，是否由 `PROJECT_TABLES` 派生完整生命周期？
4. 登记缺失时，先补注册表和测试，再写功能；不得先造旁路。

禁止在组件或 service 中手拼上下文、直接散写受治理表、手写表清单、复制一套平行
AI/DB/导入导出入口。领域扩展只能使用架构守卫认可、带理由与复审边界的显式入口。

正式模型调用还必须进入 Agent Skill / Run Contract / durable Harness 或 AI 入口注册表明确登记的
只读、内存草稿、评测、模拟边界；候选使用统一 CreativeArtifact/运行证据，作者确认后才可
`adopt()`。不得在 UI 新增未登记直连、隐藏重试或组件内恢复状态。

## 任务开始方式

1. 先查看 `git status --short --branch`、相关提交和任务描述，保护用户已有改动。
2. 用 `rg` 定位任务 ID、符号、调用方、注册表行和测试；先建立“入口 → 读写 →
   生命周期 → 调用方 → 测试”的关联闭包。
3. 按 `docs/CONTEXT-ROUTING.md` 只读取命中的文档章节和源码片段。普通 UI、局部 Bug
   或纯测试任务不得因此加载整份 Blueprint、路线图、历史日志。
4. 新体系、完整功能或小功能先核对路线图对应体系的范围、依赖和能力基线；已存在的
   能力必须复用，不按历史标题重复开发。
5. 在独立分支工作。分支使用 `feat/`、`fix/` 或 `refactor/`；不得直接 push `main`。

## 数据与发布红线

- schema、迁移、删除、合并、导入导出、引用重映射必须有反例测试；涉及真实用户数据时
  还要用隔离测试项目完成往返或生命周期验证。
- 新表先登记 `PROJECT_TABLES`，新 AI 可写字段先登记 `FIELD_REGISTRY`，新上下文源先登记
  `CONTEXT_SOURCES`；不得只修改 schema、组件或某一个调用点。
- 新入口取代旧入口时同步下线旧入口；半成品必须标为实验性并默认隐藏。
- 不确定是否丢数据、文档与代码无法裁决、迁移失败、关键反例无法修复时停止扩大改动，
  保留证据并请求决策。
- 不运行破坏性 Git/文件命令，不覆盖无关工作区改动，不使用 `npm audit fix --force`。

## 验证与交付

验证按风险递增，失败日志只保留摘要和错误附近内容：

1. 先跑改动对应的定向测试或检查器。
2. 代码提交前至少通过 `npm run check:architecture`、`npm run check:required-tables`、
   `npm run check:ai-manual`、`npx tsc --noEmit`、相关测试和 `npm run build`。
3. 交付单元运行 `npm run ci`；若外部依赖审计因已知上游公告阻塞，必须单独报告，
   其余闸门仍全部运行，不得把部分通过写成 CI 全绿。
4. 适用时运行 `npm run ci:e2e`，并在独立浏览器数据中完成真实 UI/API 验证，禁止修改
   作者当前预览项目。
5. 提交前运行 `git diff --check`，提交信息写明任务 ID、完成边界和验证证据。

完成意味着：主路径可用、旧入口已收口、三注册表与数据生命周期完整、有回归证据、
相关文档已更新、工作树干净。交接与合并细节只在需要 PR/合并/跨模型交接时读取
`docs/COLLAB-WORKFLOW.md` 对应章节。
