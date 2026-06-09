# Phase 3 进度板（精品化）

> Phase 3 = 让项目达到可参评开源大赛标准:自动生成文档 / 测试 / CI / 安全 / 性能 / README。
> 接手规则:从最后一个 commit 接着干。

| 子任务 | 状态 | 说明 |
|---|---|---|
| 3.1 AI 说明书自动生成器 | ✅ Done | 代码扫描生成 generated.md + CI 校验 + 防 key 漂移 |
| 3.2 测试体系(覆盖率 ≥ 60%) | Pending | |
| 3.3 CI lint(prompt key / 事务作用域 / meta 覆盖) | Pending | |
| 3.4 安全加固(HTML/EPUB sanitize / PAT 不持久化) | Pending | 部分已在 Phase 2.8 做 |
| 3.5 性能(主包 < 1MB / React.lazy 懒加载) | Pending | |
| 3.6 文档体系(README 中英 / CONTRIBUTING) | Pending | |
| 3.7 国际化预留(i18n 框架) | Pending | |

---

## 3.1 · AI 说明书自动生成器（2026-06-09 by Claude）

- **问题**:手写版 AI-FUNCTIONS-MANUAL.md 曾有 21 处 prompt key 与代码不一致(GPT-5.5 审查发现)。文档不能手维护为事实源。
- **方案**:`scripts/generate-ai-manual.mjs` 正则扫描 5 个事实源生成 `docs/AI-FUNCTIONS-MANUAL.generated.md`:
  - ① PromptModuleKey 枚举(35 个)
  - ② prompt 种子(key/name/description/variables)
  - ③ CONTEXT_SOURCES(18 源:key/label/scope/layer/budget)
  - ④ FIELD_REGISTRY(可写字段 by target)
  - ⑤ AI 调用点 category(16 个 + 触发文件)
- **CI 校验**:`npm run check:ai-manual`(生成结果与已提交文件一致,否则退出码 1)
- **语义层**:`AI-FUNCTIONS-MANUAL.semantic.md`(手工写业务意图/坑),CI 校验其引用的 moduleKey 真实存在(防 key 漂移)
- **副产物**:生成器暴露了 `worldview.generate` 是"待启用"占位键(有 key 无模板),确认非 bug
- **零依赖**:纯正则解析,不需要编译/IndexedDB,CI 友好(与 check-required-tables.mjs 同模式)

**验证**:tsc=0 / 60 测试全绿(新增 ai-manual 3 条)/ build OK / check:ai-manual ok

**下一步(3.2)**:测试覆盖率体系,目标 ≥ 60%。
