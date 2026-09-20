# 官方知识库维护规则

本目录是公开用户文档源。修改前核对根 AGENTS、现行产品契约、能力基线、产品目录、实际入口及相关代码与测试。WPS 和 archive 只作历史证据。

## 内容边界

- 面向用户说明入口、准备、步骤、结果、保存方式与限制，不把工程合同直接复制为操作手册。
- 每个已开放产品必须有独立指南；产品页 frontmatter 维护 productId、status、lastVerified。
- 状态必须与 src/lib/product/product-catalog.ts 一致。页面存在不代表完成；示例可玩不代表通用产品完成。
- 更改路径时保留旧入口或提供明确跳转说明。历史正文保留，并从本地搜索排除。
- 版本记录区分固定 Release、main 和在线部署；不自行虚构版本号或把开发日期写成发布日期。
- 模型价格、免费额度与兼容能力不使用未经核对的历史清单。Prompt 正文的约束、步骤、输出格式与语义强度不得因整理而简化。

## 语言与同步

中文 `/` 是唯一权威源，英文 `/en/` 为同步维护的派生版本。
新增、修改、删除、移动中文页面必须在同一任务中同步所有已启用语言的对应页面、链接、nav 和 sidebar；未来新语言继续遵循此规则。
派生语言不得反向覆盖中文；不能只更新中文而留下已启用的翻译过期。启用语言时先建立完整页面映射。
历史归档保持中文原件，英文对应入口只说明历史性质并链接原件，不冒充完整翻译。其他现行文档与 Prompt 正文须完整翻译，保留约束、步骤、输出格式与语义强度。代码标识符和 API 字段不翻译。

## 验证

1. node website-docs/.vitepress/check-content.mjs：产品覆盖、状态、日期与导航检查。
   同时运行 node website-docs/.vitepress/check-i18n.mjs：中英文页面对应、语言内链接及 Prompt 变量/资产标识检查；该检查不能替代翻译语义审查。
2. npm run docs:build：VitePress 构建和死链接检查。
3. node website-docs/.vitepress/check-links.mjs：构建后检查正文、导航、静态资源与页内锚点。
4. npm run docs:preview -- --host 127.0.0.1 --port 4173 后运行 node website-docs/.vitepress/check-preview.mjs，检查全部路由和关键页面的桌面/窄屏布局。
5. git diff --check；不向正式反馈 API 提交测试 Issue。
   反馈组件改动后运行 node website-docs/.vitepress/check-feedback.mjs，仅拦截本地请求验证两种语言、字段和附件逻辑，不触达正式 API。

用户可见入口或能力变化时，同步产品指南和 updates/changelog.md；更新记录引用可核对的提交。定期核对基线日期，日期代表人工检查而非自动刷新。
