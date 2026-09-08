# 漫剧内容生产流程图

> 版本：1.0.0 · 生效：2026-09-09
> 产品终点：完整前期生产包；不包含视频生成、选片、剪辑和漫剧成片。

## 1. 主生产流程

```mermaid
flowchart TD
    START([创建漫剧项目]) --> SOURCE{从哪里开始?}

    SOURCE -->|一句话| IDEA[创意 Brief]
    IDEA --> NOVEL_PLAN[小说设计与章节计划]
    NOVEL_PLAN --> NOVEL_DRAFT[分章小说正文]
    NOVEL_DRAFT --> NOVEL_REVIEW{作者审查小说}
    NOVEL_REVIEW -->|定点修订| NOVEL_DRAFT
    NOVEL_REVIEW -->|确认| FREEZE[冻结小说来源<br/>Work + 范围 + revision + hash]

    SOURCE -->|已有本地小说| FREEZE
    SOURCE -->|导入文本| IMPORT[建立来源 Work]
    IMPORT --> FREEZE

    FREEZE --> POSITION[漫剧定位]
    POSITION --> BIBLE[系列圣经]
    BIBLE --> GRID[分集推进表]
    GRID --> SERIES_REVIEW{系列结构审查}
    SERIES_REVIEW -->|修改| POSITION
    SERIES_REVIEW -->|确认| ASSET_PLAN[全季物料需求表]

    ASSET_PLAN --> STYLE[视觉风格圣经]
    ASSET_PLAN --> CHARACTER[角色图板]
    ASSET_PLAN --> COSTUME[服装套装]
    ASSET_PLAN --> LOCATION[场景环境板]
    ASSET_PLAN --> PROP[道具图板]
    ASSET_PLAN --> SOUND[声音圣经与试听材料]

    STYLE --> ASSET_LOCK{候选生成/上传<br/>作者查看或试听并锁定}
    CHARACTER --> ASSET_LOCK
    COSTUME --> ASSET_LOCK
    LOCATION --> ASSET_LOCK
    PROP --> ASSET_LOCK
    SOUND --> ASSET_LOCK

    ASSET_LOCK --> PICK_EP[选择一集]
    PICK_EP --> EP_CONTEXT[读取本集计划<br/>上一集退出状态<br/>未回收线索<br/>精确物料版本]
    EP_CONTEXT --> EP_BEATS[集纲与节拍]
    EP_BEATS --> SCRIPT[漫剧剧本 AST]
    SCRIPT --> SCRIPT_QA{剧本审查}
    SCRIPT_QA -->|定点修订| SCRIPT
    SCRIPT_QA -->|确认| SHOTS[逐镜分镜]
    SHOTS --> SHOT_QA{连续性/时长/<br/>生成可行性审查}
    SHOT_QA -->|定点修订或拆镜| SHOTS
    SHOT_QA -->|确认| FRAME_IR[分镜图/首尾关键帧<br/>Image Prompt IR]
    FRAME_IR --> FRAME_REF{生成/上传参考帧?}
    FRAME_REF -->|是| FRAME_PICK[作者选择 start/key/end 参考帧]
    FRAME_REF -->|否，仅导出 Prompt| VIDEO_IR[Video Prompt IR]
    FRAME_PICK --> VIDEO_IR
    VIDEO_IR --> ADAPTERS[Seedance / Runway / LTX<br/>版本化适配编译]
    ADAPTERS --> PACK_QA{引用、时长、能力<br/>与缺失物料检查}
    PACK_QA -->|修订 Prompt 或分镜| SHOTS
    PACK_QA -->|通过| EP_LOCK[锁定本集<br/>冻结退出状态与引用版本]
    EP_LOCK --> MORE{还有下一集?}
    MORE -->|是| PICK_EP
    MORE -->|否| RELEASE[整季前期生产 Release]

    EP_LOCK --> EP_EXPORT[[单集交付包]]
    RELEASE --> SERIES_EXPORT[[整季交付包]]
    EP_EXPORT -.交给外部工具.-> OUTSIDE[视频生成/选片/剪辑/成片<br/>StoryForge 范围外]
    SERIES_EXPORT -.交给外部工具.-> OUTSIDE
```

## 2. 一次性资产与逐集循环

```mermaid
flowchart LR
    subgraph ONCE[系列级：建立一次，按版本维护]
        A[冻结小说来源]
        B[系列圣经]
        C[分集推进表]
        D[物料库<br/>角色/服装/场景/道具/声音]
        A --> B --> C
        B --> D
        C --> D
    end

    subgraph LOOP[单集级：一集一集打磨]
        E[本集任务]
        F[集纲]
        G[漫剧剧本]
        H[分镜]
        I[分镜图 Prompt/参考帧]
        J[视频 Prompt IR]
        K[工具适配包]
        L[锁定本集]
        E --> F --> G --> H --> I --> J --> K --> L
    end

    C --> E
    D --> G
    D --> H
    D --> I
    L -->|退出状态/已揭示信息/物料使用| E
```

关键语义：

- 物料不是每集重做；角色、服装、场景、道具和声音先成为稳定版本，单集只绑定精确版本。
- 单集锁定后才推进故事状态；下一集读取的是经过作者确认的退出状态，不是模型临时摘要。
- 物料升级产生 v2，不覆盖 v1；已锁定旧集保持可复现，未来集可显式迁移。

## 3. 每一步的候选与确认

```mermaid
stateDiagram-v2
    [*] --> 未开始
    未开始 --> 生成中: 用户点击生成
    生成中 --> 待确认: 返回并通过结构校验
    生成中 --> 失败: 网络/权限/余额/结构不可修复
    失败 --> 生成中: 用户明确重试
    待确认 --> 已确认: 作者确认或编辑后确认
    待确认 --> 生成中: 作者要求定点修订
    待确认 --> 已拒绝: 作者拒绝
    已确认 --> 已过期: 上游来源/物料/Prompt 版本变化
    已过期 --> 生成中: 重新生成
```

后台仍保留 run、输入 revision、Prompt hash、Context Manifest、原始响应、最多一次结构修复和终态回执，但用户不需要管理一个复杂 Harness。

## 4. Prompt 编译路径

```mermaid
flowchart LR
    SCRIPT[已确认漫剧剧本] --> SHOT[已确认 Shot]
    ASSETS[精确物料版本] --> IMAGE_IR[Image Prompt IR]
    SHOT --> IMAGE_IR
    IMAGE_IR --> FRAMES[分镜图/首帧/关键帧/尾帧<br/>Prompt 或已选参考图]
    SHOT --> VIDEO_IR[Video Prompt IR]
    ASSETS --> VIDEO_IR
    FRAMES --> VIDEO_IR
    AUDIO[对白/旁白/音乐/音效时序] --> VIDEO_IR
    VIDEO_IR --> CAP{目标工具能力画像}
    CAP --> SD[Seedance 包<br/>引用槽位 + 时间戳]
    CAP --> RW[Runway 包<br/>首帧/References + 运动描述]
    CAP --> LTX[LTX 包<br/>Elements + Storyboard + Keyframes]
    SD --> MANIFEST[引用映射与校验清单]
    RW --> MANIFEST
    LTX --> MANIFEST
```

核心数据保存 provider-neutral Image/Video IR。工具包是可重新编译的派生物，供应商更新时升级 adapter/capability profile，不改写剧本、分镜和已选参考帧。

## 5. 单集交付包结构

```text
EP001/
├─ episode-brief.md
├─ motion-drama-script.md
├─ motion-drama-script.json
├─ storyboard.csv
├─ storyboard.md
├─ image-prompt-ir.json
├─ video-prompt-ir.json
├─ shot-references/
├─ assets/
│  ├─ asset-map.json
│  ├─ character/
│  ├─ costume/
│  ├─ location/
│  ├─ prop/
│  └─ sound/
├─ adapters/
│  ├─ seedance.md
│  ├─ seedance.json
│  ├─ runway.md
│  ├─ runway.json
│  ├─ ltx.md
│  └─ ltx.json
├─ review-receipt.json
└─ manifest.json
```

`manifest.json` 固定 source、series、episode、asset、Prompt template、adapter 和文件内容 hash。缺实际参考媒资时，包必须标为 `prompt-only`；全部必需参考媒资和权利信息齐备后才能标为 `reference-ready`。
