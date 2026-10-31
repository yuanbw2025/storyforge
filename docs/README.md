# StoryForge 现行文档入口

先读 [`PROJECT-MASTER-CHARTER.md`](./PROJECT-MASTER-CHARTER.md) 了解项目全貌，再按
[`DOCUMENT-AUTHORITY.md`](./DOCUMENT-AUTHORITY.md) 和
[`CONTEXT-ROUTING.md`](./CONTEXT-ROUTING.md) 读取任务所需文档。

旧 Blueprint、施工卡、旧路线图和评测流水已从主干文档库移除；历史位置、哈希与恢复规则见文档权威索引。

总纲与公共开发规则的专用分支、治理提交同步方式见 [协作流程 §2.2](./COLLAB-WORKFLOW.md#22-总纲与本地-api-治理分支)。各工作树需要本地 API 时，从 [本地 API 配置规则](./LOCAL-API-CONFIG.md) 查找统一的仓库外入口；真实配置不进入仓库。

## 全项目质量审查与整改

- [架构与质量审查计划（2026-10-29）](./audits/PROJECT-QUALITY-AUDIT-PLAN-20261029.md)：1.2.0，覆盖 Q0～Q7、G1、逐文件审阅、代码清理整改与小步集成。
- [本轮审查结论与问题（2026-10-29）](./audits/PROJECT-QUALITY-AUDIT-20261029.md)：固定 A 审查已完成，144 项问题未修复；覆盖方法和真实验收限制均保留。
- [架构阶段报告](./audits/PROJECT-ARCHITECTURE-REVIEW-20261029.md)：区分设计适用性、契约符合性、已守住的边界与结构整改。
- [代码质量报告](./audits/PROJECT-CODE-QUALITY-REVIEW-20261029.md)：代码与测试指标、真实缺陷模式和可验收的清理单元；不代表修复完成。
- [架构与质量整改推进方案（2026-10-30）](./roadmap/PROJECT-QUALITY-REMEDIATION-PLAN-20261030.md)：世界来源裁决、分轮依赖、22 组/144 项任务、多代理单写者、历史兼容与分范围 G1。

## 文字开放世界阶段交接

- [PR134 阶段总结与接续入口（2026-10-26）](./audits/TEXT-OPEN-WORLD-PR134-STAGE-SUMMARY-20261026.md)：已合并能力、盐脊真实通关、剩余问题、代码与证据定位、下一分支接续方式。
