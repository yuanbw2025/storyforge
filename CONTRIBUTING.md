# 贡献指南 · Contributing to StoryForge

感谢参与 StoryForge。项目已有真实用户和本地手稿，`main` 直接进入生产发布，因此贡献首先要保护产品边界和数据安全。

## 开始前

按顺序阅读：

1. [`AGENTS.md`](./AGENTS.md)：短开发入口；
2. [`docs/PROJECT-MASTER-CHARTER.md`](./docs/PROJECT-MASTER-CHARTER.md)：本次功能属于哪个产品；
3. [`docs/CONTEXT-ROUTING.md`](./docs/CONTEXT-ROUTING.md)：只读取任务需要的现行资料；
4. 对应 [`docs/products/`](./docs/products/README.md)、[能力基线](./docs/roadmap/CAPABILITY-BASELINE.md) 和源码/测试闭包。

未列入 [`docs/DOCUMENT-AUTHORITY.md`](./docs/DOCUMENT-AUTHORITY.md) 的旧文档不得作为施工依据。

## 本地开发

```bash
npm install
npm run dev
```

使用 Node.js 20+。不要提交 API Key、真实手稿、localStorage/IndexedDB dump、用户目录或构建缓存。

## 功能工作流

1. 从最新 `origin/main` 创建 `feat/`、`fix/` 或 `refactor/` 分支。
2. 声明总纲章节、产品、用户目标、非范围、生产/运行阶段与 owner。
3. 用 `rg` 建立入口 → 读取 → 候选/写回 → 表生命周期 → 下游 → 测试闭包。
4. AI 读取核对 `CONTEXT_SOURCES`，写入核对 Field/Adoption，表核对 `PROJECT_TABLES`。
5. 先写或更新正反例，再实现最小完整增量；取代旧入口时同步删除旧入口。
6. 更新能力基线、路线图、AI Manual 或产品契约（如适用）。

## 数据变更

schema、迁移、删除、导入导出、引用重映射或 blob/OPFS 变更属于高风险。必须覆盖：新库、旧库升级、缺字段、ID 冲突、往返、级联删除、事务失败、作用域隔离和恢复。不要以清空数据库让测试通过。

世界引擎只保存语义内容；上层产品媒资和运行数据必须有自己的 product/build/session owner。上层运行不得自动回写世界。

## AI 变更

正式模型调用要登记 AI 入口、Skill、Run Contract、上下文和写入权限。输出先成为候选；作者确认后才可采纳。mock 证明控制流，不证明文学质量或所有模型兼容。

## 提交前验证

普通 PR 按改动及其直接调用方运行非浏览器检查，在 PR 里写明命令和结果。GitHub 在试合后的代码上运行 `Changed files`。本地验证已提交的改动可运行 `node scripts/quality/check-merge-scope.mjs "$(git merge-base HEAD origin/main)"`。实际发布按发行工作流完成验收。

## Commit 与 PR

- 一个 PR 一个可解释的产品增量。
- commit message 说明任务/产品和完成边界。
- PR 写清改动、为什么、数据/AI/迁移风险、如何验证、尚未完成什么。
- 提交前运行 `git diff --check`，确认没有无关文件、生成缓存或 `node_modules`。
- 不直接 push 或 force push `main`。

详细合并与多工作树规则见 [`docs/COLLAB-WORKFLOW.md`](./docs/COLLAB-WORKFLOW.md)。

## Bug 与建议

Bug 请提供版本、浏览器、复现步骤、预期/实际结果和脱敏错误；涉及数据时说明是否可在备份副本复现，不上传真实作品。建议请说明目标用户、所属产品、为什么现有能力不能满足，以及是否会改变总纲边界。
