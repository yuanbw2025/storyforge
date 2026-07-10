# ADR-002: One active storage backend per project

## Status

Accepted

## Date

2026-07-10

## Context

StoryForge Web/PWA 当前使用 Dexie；Tauri 形态计划支持本地目录。若一个真实项目长期同时向 Dexie 和本地文件双写，失败重试、部分成功和版本差异会形成两份真相，UI、Agent、生命周期操作与导入导出也无法确定哪一份数据权威。

## Decision

- 每个项目必须有一个 `ProjectLocator`，并且任一会话中只有一个活动的 `ProjectStoragePort`。
- 活动后端只能是 `dexie` 或 `local-folder`，不能同时作为主存储运行。
- 后端迁移必须是显式流程：复制后执行完整性验证，并保留源数据，直到用户确认迁移结果。
- 真实项目禁止部分表保存在 Dexie、部分表保存在文件目录；项目内所有受管表必须由同一个活动后端提供。

## Consequences

- 最终 UI、Agent、项目生命周期和导入导出都通过同一个 `ProjectStoragePort` 访问项目数据。
- 在文件后端覆盖全部受管表和生命周期操作之前，不发布以本地文件为主存储的能力。
- 迁移保留源数据并可回滚，避免切换后端时不可逆地丢失项目。
- 实现需要维护明确的 locator、迁移状态和全表覆盖验证。
