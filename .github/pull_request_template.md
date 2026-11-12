## 改动说明 / What & Why

<!-- 这个 PR 做了什么,为什么 -->

## 关联 Issue / Related issue

<!-- Closes #N -->

## 自检清单 / Checklist

- [ ] 已读 `AGENTS.md` 并按 `docs/CONTEXT-ROUTING.md` 定位相关宪法/路线图/Blueprint 段落
- [ ] 改动遵循三注册表铁律(未直接调 db / 未手挑上下文 / 未手写表清单)
- [ ] 已记录本次改动和直接调用方的定向验证命令、结果及相关失败
- [ ] 若改了 DB schema:已写迁移测试 + 真实数据实测
- [ ] 若加了表/字段/上下文源/AI 动作:已同步对应注册表
- [ ] 若改了 AI 行为:已跑 `npm run gen:ai-manual` 重新生成说明书
- [ ] 修 bug 的:已有一条会失败→变绿的反例测试
