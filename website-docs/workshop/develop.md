---
title: 开发第一个插件
lastVerified: 2026-10-09
---
# 开发第一个插件

目标：制作一个独立的“章节检查便笺”，保存当前作品的修改清单，刷新和重新安装后仍能读取。这个例子用于学会完整交付流程，之后可换成你的任何受支持需求。

当前为 API 1／SDK 0.1。先阅读[能力范围](./)，完整字段与生命周期以[技术约定](https://github.com/yuanbw2025/storyforge/blob/main/docs/guides/PLUGIN-DEVELOPMENT.md)和本地 `tools/plugin-sdk/index.d.ts` 为准。SDK 尚未发布到 npm，不要执行 `npm install @storyforge/plugin-sdk` 并期待找到官方发布包。

## 1 准备开发环境

需要 Git、Node.js 24 和 npm，以及能编辑文件的代码编辑器或编程 AI。只有普通聊天能力、不能运行命令的 AI 可以帮助写代码，但无法替你完成打包和安装验收。

新目录中获取当前主干；已有仓库不要覆盖或强行切换其中的未保存改动：

```sh
git clone --branch main --single-branch https://github.com/yuanbw2025/storyforge.git storyforge-plugin-dev
cd storyforge-plugin-dev
npm ci
```

这是开发预览分支，不是固定发布版。取代码后记录 `git rev-parse HEAD`，让宿主、SDK 与资料包匹配；不要混用不同版本的类型和实现。

## 2 创建自己的源码目录

在熔炉仓库根目录运行：

```sh
node tools/plugin-sdk/cli.mjs create ../chapter-checklist
```

新目录必须尚不存在。它包含 `manifest.json`、`src/index.tsx` 和开发用 `package.json`。CLI 会使用熔炉仓库已安装的类型与构建工具；最小例子不需要在插件目录再次安装依赖。插件源码独立于宿主仓库保存，可有自己的 Git 仓库。

## 3 修改身份和界面

打开新插件的 `manifest.json`，**保留模板中的其余字段**，修改这些值：

```json
{
  "id": "yourname.chapter-checklist",
  "version": "0.1.0",
  "name": "章节检查便笺",
  "description": "为当前作品保存章节修改清单",
  "author": "你的署名",
  "license": "MIT"
}
```

上面是需要修改的字段片段，不是完整清单。将 `yourname` 换成自己的小写英文命名空间；`license` 应采用你有权使用、愿意发布的许可。初次发布后保持插件 ID 稳定，升级修改版本号。

把 `views[0].title` 改为“章节检查便笺”。在 `src/index.tsx` 中修改面板标题、说明与占位文字；保留模板的读取、保存、错误提示和 `expectedRevision` 处理，先完成可安装版本。保存字段仍是 `note` schema 的 `text`，不必为改文案变更数据结构。

**效果**：用户在插件工作台看到你的标题和检查清单输入框，保存到当前作品；不是自动扫描或修改章节正文。若想读取更多正式内容，先确认 SDK 是否提供接口，不能偷读内部数据库。

## 4 检查与打包

回到熔炉仓库根目录：

```sh
node tools/plugin-sdk/cli.mjs check ../chapter-checklist
node tools/plugin-sdk/cli.mjs pack ../chapter-checklist ../yourname.chapter-checklist-0.1.0.sfplugin
```

`check` 校验清单、严格类型及最终包；`pack` 再次检查并输出安装包与 SHA-256。成功意味着通过静态检查，交互与数据正确性还需要下一步验证。不要手工把 TypeScript 文件压缩后改后缀。

包内是独立 JavaScript 工厂和资源，共享宿主 React。只从 `@storyforge/plugin-sdk` 导入类型，不直接导入宿主组件、Store、数据库或内部 AI；禁止运行时 CDN 导入。资源放 `assets/` 并通过 `ctx.resources.url()` 使用。需要纯 JavaScript 第三方库时，在插件目录安装并锁定依赖，确认能在浏览器捆绑运行；用户安装时不运行 npm 或 Python。

## 5 在独立作品安装验收

在仓库运行 `npm run dev -- --host 127.0.0.1`，用终端显示的地址打开工坊。在新浏览器测试配置中创建测试作品，不用作者当前的真实项目。

按[安装教程](./install)导入生成的 `.sfplugin`，选择当前作品并启用。至少验证：

- 输入“第三章补足动机”，保存、刷新，内容仍在；另一个作品不会看到这条记录。
- 停用，再启用，内容仍在；卸载、安装原文件并启用，内容可读。
- 导出完整备份，在独立测试环境导入，确认默认停用、重新安装后内容可读。
- 两个标签页同时编辑时，过期保存应报告冲突，不应静默覆盖。
- 窄屏能够操作；错误可见；安全启动可以绕过加载。

修改代码后提高包版本并重新打包，通过明确的版本切换试用。变更 schema 时必须实现并验证迁移；不要靠清空浏览器数据解决升级失败。记录实际通过、失败和未验证项，再[发布](./publish)。

## 6 扩展你的功能

| 需求 | 接口与规则 |
| --- | --- |
| 自有数据和复杂界面 | `ui` + `data`，清单声明视图和 schema；更新携带读到的 revision |
| 世界年表或故事进程 | `domain.history`，`history`／`story-timeline` 插槽；同一目标仅一个替换者 |
| AI 结构化候选 | `aiTasks` + `ai.propose`；只有已登记上下文，作者开始并确认 |
| 插件之间复用能力 | `provides`／`consumes` + `services`；准确依赖版本、相同 owner |
| 世界词条和跑团规则 | `worldSemantics`／`rulePacks`；分别明确采纳与冻结发布 |
| 外部服务 | `network`／`connectors`；声明来源和工具，解释网络、费用与运行环境 |

清单的格式版本、SDK 版本、插件版本和记录 schema 版本各有用途，不可混为一谈。包限制为压缩 16 MiB、解压 32 MiB、256 文件；结构化数据采用有界 schema 子集。精确规则和接口签名请按需查技术约定与类型文件，别让 AI 推测不存在的方法。
