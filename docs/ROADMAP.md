# StoryForge 开发路线图（兼容入口）

> 路线图已于 2026-07-20 迁移到 [`docs/roadmap/`](./roadmap/README.md)。
>
> 本文件永久保留为兼容入口，确保旧对话、旧文档、历史 commit 和外部链接中的 `docs/ROADMAP.md` 不会失效。新功能规格和状态不再直接写入本文件。

## 三个入口

- **现在和未来**：[开发路线图](./roadmap/README.md)
- **当前已经具备什么**：[能力基线](./roadmap/CAPABILITY-BASELINE.md)
- **过去完成了什么**：[已完成索引](./roadmap/COMPLETED.md)

本分支拆分前 `HEAD:docs/ROADMAP.md` 的 3181 行原文已字节级保存在 [ROADMAP-LEGACY.md](./ROADMAP-LEGACY.md)，SHA-256：

```text
e497de7d0f8100489bdcb3a7b3fcb528d07024b9dcb832f7de6e2701d584667d
```

## 接手者规则

1. 开始新功能前，先读当前路线图中的唯一主归属。
2. 再读能力基线，确认已有代码、注册表和测试，禁止重复开发。
3. 需要历史背景时按原任务 ID 搜索 `docs/ROADMAP-LEGACY.md` 或已完成索引。
4. 如果三份文档与当前代码冲突，以代码、测试、`CLAUDE.md` 和 `MASTER-BLUEPRINT.md` 为准，并先修正文档再施工。
