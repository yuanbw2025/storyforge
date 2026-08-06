# PLATFORM-1 · 本地世界发布包

## 交付边界

本阶段把“世界可以被别人引用”落成一个不依赖服务器的本地闭环：作者在世界引擎页生成 JSON 发布包，接收方读取包的发布信息和完整性校验，确认后导入为新的本地世界项目。原项目不覆盖，导入副本拥有新的本地 `worldCode`，并通过 `communityOrigin` 保留来源编号、版本、署名和许可。没有不可变 Release 的旧世界继续生成 v1；已发布世界生成绑定 Release、依赖锁和选定叙事模块的 v2。

这不是线上社区，也不提供账号、云同步、评论、协同编辑、发现排序或访问控制。浏览器不会因为导入一个文件就假装它已经发布到平台。

## 数据契约

`PROJECT_TABLES` 新增 `communityShare: 'world'` 元数据。世界发布范围只从这一个注册表声明派生，当前包含：

- 世界组、世界组关系、世界观、地理、历史、世界节点、世界规则、力量/修炼体系。
- 重要地点、Codex 分类与词条、角色及角色关系。
- v2 另包含作者在 Release 中明确选择的 `narrativeModules` / `narrativeNodes`，并使用严格 v4 便携 owner ID
  裁成单一 World/Work 快照；`worldRevisions` 和运行存档本身不进入分享内容。

未登记的可导出表默认禁止进入发布包，尤其是 `chapters`、`outlineNodes`、`notes`、`agentConversations`、`agentEvents`、`nodeFlows`、`nodeRuns`、`simulationSessions`、`simulationEvents`、`simulationCheckpoints`、`references`、`userStyleProfiles` 和 AI 用量记录。发布包也不携带 API Key 或 PAT。

## 发布与导入流程

```text
世界引擎
  -> v1：exportProjectJSON + communityShare='world' 过滤
  -> v2：不可变 WorldRelease + 严格 v4 单 World/Work 快照 + 逐表依赖锁
  -> 去除正文、私有参考、候选与运行状态
  -> manifest（编号/版本/署名/许可/用途/内容警告）
  -> SHA-256
  -> 本地 JSON 文件

本地 JSON
  -> 格式/版本/世界表/私有表预检
  -> SHA-256 完整性检查
  -> 作者确认
  -> importProjectJSON（现有注册表导入事务）
  -> v2 重建本地修订/Release 与当前 NarrativeModule
  -> 新 worldCode + communityOrigin
```

`inspectWorldPackage()` 是纯只读检查；任何错误都在 `importProjectJSON()` 写库前返回。导入仍由现有三注册表生命周期负责，不新增分享包表、旁路数据库或第二套导入器。

## 后续线上阶段的前置条件

真正的社区服务必须另立后端边界：身份与设备密钥、发布版本不可变存储、权限/撤回、内容举报与审核、隐私删除、增量同步冲突、评论与通知。客户端只能提交经过作者确认的发布包和明确的可见性策略，不能把本地 Gist、任意 URL 或 OAuth 登录态当成社区后端。任何远程读取/写入都必须有来源、域名白名单、取消/超时、审计和失败回滚设计。

当前可验收证据：`R-PLATFORM1-world-package` 覆盖 v1 私有表不泄漏、篡改拒绝、新编号导入与来源保留；
`R-WORLD2C-2F-completion` 覆盖 v2 Release 不可变、依赖/叙事往返与干净数据库导入；Chromium 分别覆盖 v1
兼容包和 v2 真实下载、预检、确认导入、来源及当前主线恢复。
