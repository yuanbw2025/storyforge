## 改动说明 / What & Why

<!-- 这个 PR 做了什么,为什么 -->

## 关联 Issue / Related issue

<!-- Closes #N -->

## 自检清单 / Checklist

- [ ] 已读 `CLAUDE.md`,改动遵循三注册表铁律(未直接调 db / 未手挑上下文 / 未手写表清单)
- [ ] `npm run ci` 本地全绿(check:required-tables / check:ai-manual / check:architecture / tsc / test / build)
- [ ] 若改了 DB schema:已写迁移测试 + 真实数据实测
- [ ] 若加了表/字段/上下文源/AI 动作:已同步对应注册表
- [ ] 若改了 AI 行为:已跑 `npm run gen:ai-manual` 重新生成说明书
- [ ] 修 bug 的:已有一条会失败→变绿的反例测试
