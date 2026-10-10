# StoryForge plugin development kit

插件 1.0 开发预览 / API 1 / SDK 0.1。此目录是开发资料和 Skill，不是安装包；不要导入熔炉“从文件安装”。

1. 不会编程：阅读 `guides/ai.md`，把本目录交给能读写文件和运行命令的编程助手，并填写 `developer-prompt.txt`。
2. 自己开发：阅读 `guides/develop.md`，准备匹配的熔炉仓库、Node.js 24 与 npm 依赖。本包不包含宿主和依赖，不能单独编译。
3. 支持 Skill 的助手：按工具自己的方式导入整个目录，使用 `storyforge-plugin-author`；其他助手可直接读取 `SKILL.md`。
4. 发布前阅读 `guides/publish.md`，按 `references/ACCEPTANCE.md` 记录实测。规则是版本化的，`developer-kit.json` 记录 API、SDK、生成器及全部资料来源与摘要。

English guides are in `guides/en/`. The technical contract and some sample UI text are Chinese; the API identifiers are unchanged. Ask your assistant to explain them in your language without relaxing constraints. This is a reference kit, not a standalone SDK runtime. Do not install it as a StoryForge plugin. Use a matching host checkout and keep production manuscripts out of acceptance tests.

所有示例来自仓库 `examples/plugins/`；`references/index.d.ts` 与宿主公开类型同步，`references/PLUGIN-DEVELOPMENT.md` 是现行技术约定的生成副本。只在源文件维护规则，再由 `npm run plugins:build-kit` 重建，不手工编辑 ZIP。
