# StoryForge 数据流大图（可视化总览）

> 配套 `DATA-FLOW-MAP.md`（文字总表）。这里用 Mermaid 把整个项目的功能、上下文注入、读写/提取/反推关系画出来。
> GitHub / VS Code Markdown Preview Mermaid 等会自动渲染成图。
> 创建：2026-06-04｜本文档与 DATA-FLOW-MAP 同步更新。

---

## 〇、图例与约定

- 🟦 蓝 = 📥 上游设定（作者填、AI 写作时读）
- 🟧 橙 = ✍️ 正文创作（章节）
- 🟪 紫 = 📤 下游产物（AI 从正文提取）
- 🟩 绿 = 🛠️ 工具/反推（用户给料 → AI 反向生成 → 写回上游）
- 🟦 青 = 🧩 共享上下文构建函数
- 🟥 红 = 🌍 多世界系统

**箭头含义**：`==注入==>` AI 上下文注入  ·  `==写==>` 落库  ·  `-.反推.->` 反向流  ·  `==提取==>` 从正文派生产物

---

## 一、总览大图

```mermaid
flowchart TB
    subgraph TOP["📁 著作信息"]
        PROJ["项目概况 projects<br/>name · genre · enableMultiWorld<br/>writingStyleId · targetWordCount"]
        INSP["🛠️ 灵感反推 InspirationPanel"]
        REFER["🛠️ 项目参考 references<br/>+ referenceChunkAnalysis"]
    end

    subgraph MW["🌍 多世界系统"]
        WG["世界组 worldGroups<br/>主世界 · 斗破 · 遮天 · …"]
        WGL["世界关系 worldGroupLinks<br/>fromGroupId · toGroupId · linkType"]
    end

    subgraph UPSTREAM["📥 上游设定层"]
        WV["世界观 worldviews<br/>worldOrigin · powerHierarchy · divineDesign<br/>worldStructure · continentLayout · climateByRegion<br/>races · factionLayout · politicsEconomyCulture<br/>itemDesign · naturalResources · worldEvents 等<br/>worldGroupId"]
        SC["故事核心 storyCores<br/>theme · centralConflict · plotPattern<br/>mainPlot · subPlots · logline · concept"]
        PS["力量体系 powerSystems<br/>name · description · levels JSON · rules<br/>worldGroupId"]
        WR["真实与幻想 worldRulesProfiles<br/>entries 各节点 · customNodes · globalNote<br/>项目级单例·待 Phase40 多世界化"]
        HIST["历史年表<br/>histories overview<br/>historicalTimelineEvents · historicalKeywords<br/>worldGroupId"]
        WMAP["世界地图<br/>worldNodes 世界树<br/>worldGroupId · mapConfigJSON"]
        CODEX["📦 设定词条 codex<br/>codexCategories 树 · codexEntries<br/>7 内置类·fields schema 驱动·refs 关联<br/>worldGroupId"]
        ITEM["道具系统 itemSystems<br/>Phase35-b 将并入 codex.artifact"]
        LOC["重要地点 importantLocations<br/>tags · 树状 · 无 worldGroupId"]
        CHAR["角色 characters<br/>name · role · shortDescription · appearance<br/>personality · background · motivation · abilities · arc<br/>homeWorldGroupId · isCrossWorld"]
        REL["角色关系 characterRelations<br/>fromCharacterId · toCharacterId · relationType"]
        RULES["创作规则 creativeRules<br/>writingStyle · narrativePOV · atmosphere<br/>prohibitions · consistencyRules · specialRequirements<br/>citedReferenceIds · citedInsightIds"]
        OUTL["大纲 outlineNodes<br/>volume · storyBlock · chapter<br/>parentId · order · worldGroupId"]
        SARC["故事线 storyArcs<br/>name · type main/sub · stages"]
        FORE["伏笔 foreshadows<br/>type · status · plant/echo/resolveChapterId<br/>importance · urgency"]
    end

    subgraph CTX["🧩 共享上下文构建层"]
        FMTWV["formatWorldviewBlock"]
        FMTSC["formatStoryCoreBlock"]
        FMTPS["formatPowerSystemBlock"]
        BLDWV["buildWorldContext 单世界"]
        BLDCW["buildCurrentWorldContext 多世界"]
        BLDNODE["buildNodeWritingContext 章节级"]
        BLDCODEX["buildCodexContext"]
        BLDCHAR["buildCharacterContext"]
        BLDRULES["buildCreativeRulesContext"]
        BLDFORE["buildForeshadowContext"]
        BLDHIST["buildHistoricalContext"]
        BLDLOC["buildLocationContext"]
        BLDWRC["buildWorldRulesContext"]
        BLDREF["buildRefAnalysisContext"]
        BLDINS["buildMasterInsightContext"]
        BLDMEM["buildMemory 三层记忆"]
    end

    subgraph WRITE["✍️ AI 写作链"]
        AIOUTL["AI 生成卷/章大纲"]
        AIDETAIL["AI 生成细纲"]
        AICHAP["AI 生成章节正文"]
        CHAPTERS["📖 章节正文 chapters"]
        DETAILS["细纲 detailedOutlines"]
        EBEAT["情感节拍 emotionBeatCards"]
    end

    subgraph DOWN["📤 下游产物"]
        STATE["状态表 stateCards"]
        LEDGER["物品栏 itemLedger<br/>项目级·诸天流跨世界携带"]
        TIME["故事年表 storyTimelineEvents"]
    end

    subgraph TOOLS["🛠️ 工具/反推流"]
        CDP["角色驱动剧情"]
        SVERIFY["场景考证"]
        WGAI["AI 建议世界"]
        REVIEW["章节审校"]
        READAB["追读力评估"]
        SUMMARY["章节摘要"]
    end

    PROJ -.开启多世界.-> WG
    INSP -.反推.-> WV
    INSP -.反推.-> SC
    INSP -.反推.-> CHAR
    INSP -.多世界反推.-> WG
    REFER -.采纳到 citedRefIds.-> RULES

    WG -.worldGroupId.-> WV
    WG -.worldGroupId.-> PS
    WG -.worldGroupId.-> HIST
    WG -.worldGroupId.-> WMAP
    WG -.worldGroupId.-> CODEX
    WG -.worldGroupId.-> OUTL
    WG -.homeWorldGroupId.-> CHAR

    WV ==读==> FMTWV
    SC ==读==> FMTSC
    PS ==读==> FMTPS
    FMTWV --> BLDWV
    FMTSC --> BLDWV
    FMTPS --> BLDWV
    FMTWV --> BLDCW
    FMTSC --> BLDCW
    FMTPS --> BLDCW
    BLDCW --> BLDNODE
    CODEX ==读==> BLDCODEX
    BLDCODEX --> BLDCW
    BLDCODEX --> BLDNODE
    CHAR ==读==> BLDCHAR
    RULES ==读==> BLDRULES
    FORE ==读==> BLDFORE
    HIST ==读==> BLDHIST
    LOC ==读==> BLDLOC
    WR ==读==> BLDWRC
    REFER ==读==> BLDREF

    BLDWV ==注入==> AIOUTL
    BLDNODE ==注入==> AIOUTL
    BLDCHAR ==注入==> AIOUTL
    BLDWRC ==注入==> AIOUTL
    BLDWV ==注入==> AIDETAIL
    BLDNODE ==注入==> AIDETAIL
    BLDCHAR ==注入==> AIDETAIL
    BLDFORE ==注入==> AIDETAIL

    BLDWV ==> BLDMEM
    BLDCHAR ==> BLDMEM
    BLDFORE ==> BLDMEM
    STATE -.episodic.-> BLDMEM
    EBEAT -.working.-> BLDMEM
    BLDMEM ==注入==> AICHAP
    BLDRULES ==注入==> AICHAP
    BLDLOC ==注入==> AICHAP
    BLDREF ==注入==> AICHAP
    BLDINS ==注入==> AICHAP

    OUTL --挂在节点上--> CHAPTERS
    OUTL --挂在节点上--> DETAILS
    AIOUTL ==写==> OUTL
    AIDETAIL ==写==> DETAILS
    AICHAP ==写==> CHAPTERS
    CHAPTERS --关联--> EBEAT

    CHAPTERS ==提取==> STATE
    CHAPTERS ==提取==> LEDGER
    CHAPTERS ==提取==> TIME
    CHAPTERS ==提取==> REL

    STATE -.按需召回.-> AICHAP

    BLDWV --> CDP
    BLDCHAR --> CDP
    BLDWV --> SVERIFY
    BLDHIST --> SVERIFY
    BLDWRC --> SVERIFY
    WG ==全世界概览==> WGAI
    WGAI ==写==> WG
    WGAI ==写==> WV
    CHAPTERS --> REVIEW
    BLDWV --> REVIEW
    BLDCHAR --> REVIEW
    BLDFORE --> REVIEW
    STATE --> REVIEW
    CHAPTERS --> READAB
    CHAPTERS --> SUMMARY
    SUMMARY ==写==> CHAPTERS

    classDef up fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef write fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef down fill:#7c3aed,stroke:#6d28d9,color:#fff;
    classDef tool fill:#16a34a,stroke:#15803d,color:#fff;
    classDef ctx fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef mw fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef top fill:#9ca3af,stroke:#6b7280,color:#fff;

    class WV,SC,PS,WR,HIST,WMAP,CODEX,ITEM,LOC,CHAR,REL,RULES,OUTL,SARC,FORE up
    class AIOUTL,AIDETAIL,AICHAP,CHAPTERS,DETAILS,EBEAT write
    class STATE,LEDGER,TIME down
    class CDP,SVERIFY,WGAI,REVIEW,READAB,SUMMARY,INSP,REFER tool
    class FMTWV,FMTSC,FMTPS,BLDWV,BLDCW,BLDNODE,BLDCODEX,BLDCHAR,BLDRULES,BLDFORE,BLDHIST,BLDLOC,BLDWRC,BLDREF,BLDINS,BLDMEM ctx
    class WG,WGL mw
    class PROJ top
```

---

## 二、上游 → AI 写作的上下文注入路径（放大）

```mermaid
flowchart LR
    subgraph U["📥 上游表"]
        WV["worldviews v3 全字段"]
        SC["storyCores"]
        PS["powerSystems"]
        CHAR["characters"]
        FORE["foreshadows"]
        CODEX["codex Categories + Entries"]
        WR["worldRulesProfiles"]
        LOC["importantLocations"]
        HIST["historical events + keywords"]
        RULES["creativeRules"]
    end

    subgraph SHARED["🧩 共享格式化（单一事实源·防漂移）"]
        F1["formatWorldviewBlock<br/>worldOrigin · powerHierarchy · divineDesign<br/>worldStructure · worldDimensions<br/>continentLayout · regionDimensions<br/>mountainsRivers · climateByRegion<br/>historyLine · worldEvents · races<br/>factionLayout · politicsEconomyCulture<br/>internalConflicts · itemDesign<br/>naturalResources 矿/草/兽/其他<br/>v3 全空时 v2 兜底"]
        F2["formatStoryCoreBlock<br/>logline · theme · centralConflict<br/>plotPattern · mainPlot 或 storyLines · subPlots"]
        F3["formatPowerSystemBlock<br/>name + description<br/>levels JSON 解析为等级阶梯<br/>rules"]
    end

    subgraph PATH["⚙️ 上下文路径"]
        SWORLD["buildWorldContext 单世界"]
        MWORLD["buildCurrentWorldContext 多世界<br/>按 wgId 取本世界数据"]
        NODECTX["buildNodeWritingContext 章节级<br/>沿大纲父链解析所属世界"]
    end

    subgraph AUX["附加上下文"]
        CCTX["buildCharacterContext<br/>filterActiveCharacters 按出场章节"]
        FCTX["buildForeshadowContext 开放伏笔"]
        HCTX["buildHistoricalContext 历史年表"]
        LCTX["buildLocationContext 重要地点"]
        WRCTX["buildWorldRulesContext 真实与幻想"]
        RCTX["buildRefAnalysisContext 引用参考"]
        ICTX["buildMasterInsightContext 大师洞察"]
        MEMO["getContextMemo 上下文快照<br/>v3 字段读取"]
        STX["buildStateContext 或 Selective 按需召回"]
        GENRE["buildGenreConstraintContext 题材包"]
        STYLE["buildStylePromptInjection 写作风格预设"]
        CDXCTX["buildCodexContext<br/>分类紧凑 + 预算 + 世界隔离"]
        R_RULES["buildCreativeRulesContext<br/>风格/视角/基调/禁忌/一致性"]
    end

    WV --> F1
    SC --> F2
    PS --> F3
    CHAR --> CCTX
    FORE --> FCTX
    HIST --> HCTX
    LOC --> LCTX
    WR --> WRCTX
    RULES --> R_RULES
    CODEX --> CDXCTX

    F1 --> SWORLD
    F2 --> SWORLD
    F3 --> SWORLD
    F1 --> MWORLD
    F2 --> MWORLD
    F3 --> MWORLD
    CDXCTX --> MWORLD
    MWORLD --> NODECTX

    subgraph GEN["🎯 全部生成入口"]
        G_WV_PANEL["世界观各维度生成 worldview.dimension"]
        G_SC_PANEL["故事核心生成 story.generate"]
        G_RU_PANEL["创作规则生成 rules.generate"]
        G_CH_PANEL["角色生成 character.generate"]
        G_FO_PANEL["伏笔建议 foreshadow.suggest"]
        G_SA_PANEL["故事线规划 storyArc.plan"]
        G_VOL["卷大纲 outline.volume"]
        G_CHP["章大纲 outline.chapter"]
        G_DET["细纲 detail.scene 或 enhanced"]
        G_CONT["章节正文 chapter.content<br/>+ continue/polish/expand/deai"]
        G_SV["场景考证 scene.verify"]
        G_CDP["角色驱动剧情"]
        G_RV["质量审校 review"]
        G_READ["追读力 readability"]
        G_SUM["摘要 summary"]
    end

    SWORLD ==注入==> G_WV_PANEL
    SWORLD ==> G_SC_PANEL
    SWORLD ==> G_RU_PANEL
    SWORLD ==> G_CH_PANEL
    SWORLD ==> G_FO_PANEL
    SWORLD ==> G_SA_PANEL
    SWORLD ==> G_VOL
    NODECTX ==注入按节点==> G_CHP
    NODECTX ==> G_DET
    NODECTX ==> G_CONT
    SWORLD ==> G_SV
    MWORLD ==场景考证多世界==> G_SV
    SWORLD ==> G_CDP

    CCTX --> G_CONT
    CCTX --> G_CHP
    CCTX --> G_DET
    CCTX --> G_CH_PANEL
    CCTX --> G_FO_PANEL
    FCTX --> G_CONT
    FCTX --> G_DET
    FCTX --> G_FO_PANEL
    R_RULES --> G_CONT
    WRCTX --> G_VOL
    WRCTX --> G_CHP
    WRCTX --> G_DET
    WRCTX --> G_SV
    WRCTX --> G_CDP
    LCTX --> G_CONT
    HCTX --> G_SV
    RCTX --> G_CONT
    ICTX --> G_CONT
    MEMO --> G_CONT
    STX --> G_CONT
    GENRE --> G_CONT
    STYLE --> G_CONT
    GENRE --> G_VOL
    STYLE --> G_VOL

    MEM["buildMemory 三层记忆<br/>Working 当前章 + 最近3章 + 情感节拍<br/>Episodic 状态变更 + 关键事件 + 关系动态<br/>Semantic 世界观 + 角色 + 伏笔 + 故事线"]
    SWORLD --> MEM
    CCTX --> MEM
    FCTX --> MEM
    STX --> MEM
    EBEAT_NODE["emotionBeatCards"] -.beats.-> MEM
    MEM ==注入==> G_CONT

    classDef share fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef path fill:#7c2d12,stroke:#9a3412,color:#fff;
    classDef gen fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef table fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef aux fill:#0e7490,stroke:#155e75,color:#fff;
    class F1,F2,F3 share
    class SWORLD,MWORLD,NODECTX path
    class G_WV_PANEL,G_SC_PANEL,G_RU_PANEL,G_CH_PANEL,G_FO_PANEL,G_SA_PANEL,G_VOL,G_CHP,G_DET,G_CONT,G_SV,G_CDP,G_RV,G_READ,G_SUM gen
    class WV,SC,PS,CHAR,FORE,CODEX,WR,LOC,HIST,RULES,EBEAT_NODE table
    class CCTX,FCTX,HCTX,LCTX,WRCTX,RCTX,ICTX,MEMO,STX,GENRE,STYLE,CDXCTX,R_RULES,MEM aux
```

---

## 三、章节正文生成完整调用栈（时序）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant CE as ChapterEditor
    participant CTX as 上下文构建
    participant MEM as memory-builder
    participant ADP as chapter-adapter
    participant HOOK as useAIStream
    participant CLI as client.ts streamChat
    participant AI as AI Provider
    participant LOG as usage-log
    participant SE as state-extract
    participant SUM as summary-adapter
    participant DB as IndexedDB

    U->>CE: 点击 生成正文
    Note over CE: aiAction = generate
    CE->>CTX: chapterWorldGroupId 沿父链解析

    alt 多世界 且 本卷有世界
        CE->>CTX: buildCurrentWorldContext
        Note over CTX: 取本世界 wv/sc/ps<br/>调 formatXxxBlock<br/>+ buildCodexContext
    else 单世界 或 无归属
        CE->>CTX: buildWorldContext + buildCodexContext
    end
    CTX-->>CE: worldCtx

    CE->>CTX: getContextMemo memo
    CE->>CTX: filterActiveCharacters
    CE->>CTX: buildCharacterContext charCtx
    CE->>CTX: buildSelectiveStateContext 按需召回
    CE->>CTX: buildForeshadowContext
    CE->>CTX: buildCreativeRulesContext
    CE->>CTX: buildLocationContext
    CE->>CTX: buildRefAnalysisContext
    CE->>CTX: buildMasterInsightContext
    CE->>CTX: buildGenreConstraintContext
    CE->>CTX: buildStylePromptInjection

    CE->>MEM: buildMemory write
    Note over MEM: Working 3000 字: 当前章+最近3章+情感节拍<br/>Episodic 1500: 状态变更+事件+关系<br/>Semantic 2000: worldCtx+charCtx+伏笔
    MEM-->>CE: fullContext + stats

    Note over CE: 拼装 fullCtx<br/>memory + rules + location + genre + style + ref + insight

    CE->>ADP: buildChapterContentPrompt
    ADP-->>CE: messages

    CE->>CE: analyzeContextSegments + calculateBudget<br/>ContextBudgetBar 只算不真裁
    CE->>HOOK: ai.start messages meta
    HOOK->>CLI: streamChat
    CLI->>AI: POST chat/completions stream

    loop 流式
        AI-->>CLI: SSE chunk delta
        CLI-->>HOOK: yield chunk
        HOOK-->>CE: setOutput accumulated
        CE-->>U: 实时显示
    end

    AI-->>CLI: DONE + usage
    CLI->>LOG: recordUsage
    LOG->>DB: aiUsageLog.add

    U->>CE: 点 采纳
    CE->>DB: updateChapter content + wordCount

    Note over CE: handleAutoPostGenerate 自动后处理
    par 并行
        CE->>CTX: buildStateContext
        CE->>SE: buildStateExtractPrompt
        CE->>HOOK: stateAI.start
        HOOK-->>CE: raw
        CE->>SE: parseStateDiffs
        CE->>CE: setPendingDiffs
        U->>CE: StateDiffModal 审核采纳
        CE->>DB: applyDiffs 按实体聚合
    and
        CE->>SUM: buildSummaryPrompt
        CE->>HOOK: summaryAI.start
        HOOK-->>CE: raw
        CE->>DB: updateChapter summary
    end
```

---

## 四、下游产物提取

```mermaid
flowchart LR
    CHAPTERS["📖 chapters 正文内容"]

    subgraph EXTRACT["🔍 提取适配器"]
        SEX["state-extract-adapter<br/>buildStateExtractPrompt<br/>parseStateDiffs"]
        IEX["inventory-extract-adapter<br/>buildInventoryExtractPrompt<br/>parseInventoryEvents"]
        TEX["story-timeline-adapter<br/>buildStoryTimelinePrompt<br/>parseStoryEvents"]
        REX["relation-extractor<br/>parseRelationOutput<br/>+ matchRelations 名→id"]
        EBA["emotion-beat-adapter<br/>buildEmotionBeatPrompt<br/>parseEmotionBeats"]
        FCO["foreshadow-adapter<br/>parseForeshadowStructured"]
    end

    subgraph TRIG["⚡ 提取触发点"]
        AUTO["自动 章节生成后<br/>handleAutoPostGenerate<br/>触发 state + summary"]
        MANU_S["手动 状态表面板"]
        MANU_I["手动 物品栏一键提取"]
        MANU_T["手动 故事年表一键提取"]
        MANU_R["手动 关系网 AI 建议"]
        MANU_E["手动 情感节拍卡"]
    end

    subgraph DTABLES["📤 下游表落库"]
        ST["stateCards<br/>applyDiffs 按实体合并字段<br/>防重复"]
        IL["itemLedger<br/>重新提取前 deleteByChapter<br/>防重复累加"]
        ST_T["storyTimelineEvents<br/>重新提取前 deleteByChapter"]
        CR["characterRelations"]
        EB["emotionBeatCards"]
        FO["foreshadows"]
    end

    CHAPTERS --> AUTO
    CHAPTERS --> MANU_S
    CHAPTERS --> MANU_I
    CHAPTERS --> MANU_T
    CHAPTERS --> MANU_R
    CHAPTERS --> MANU_E

    AUTO --> SEX
    MANU_S --> SEX
    MANU_I --> IEX
    MANU_T --> TEX
    MANU_R --> REX
    MANU_E --> EBA

    SEX ==parseStateDiffs==> ST
    IEX ==parseInventoryEvents==> IL
    TEX ==parseStoryEvents==> ST_T
    REX ==matchRelations==> CR
    EBA ==parseEmotionBeats==> EB
    FCO ==parseForeshadowStructured==> FO

    ST -.按需召回 buildSelectiveStateContext.-> RECALL["写章节时注入<br/>三层记忆 Episodic 层"]

    classDef table fill:#7c3aed,stroke:#6d28d9,color:#fff;
    classDef adp fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef trig fill:#ca8a04,stroke:#a16207,color:#fff;
    classDef src fill:#ea580c,stroke:#c2410c,color:#fff;
    class ST,IL,ST_T,CR,EB,FO table
    class SEX,IEX,TEX,REX,EBA,FCO adp
    class AUTO,MANU_S,MANU_I,MANU_T,MANU_R,MANU_E trig
    class CHAPTERS src
```

---

## 五、反推 / 工具流

```mermaid
flowchart LR
    subgraph INPUT["输入侧"]
        FRAG["用户碎片灵感<br/>InspirationPanel 输入"]
        REFC["参考作品分块<br/>references.chunks"]
        SCENE["场景描述 用户当下构思"]
        UA["用户碎片 角色驱动剧情"]
        CHAP_IN["章节正文"]
    end

    subgraph TOOLAI["🛠️ AI 工具适配器"]
        INV["inspiration-reverse<br/>parseReverseOutput<br/>parseReverseMultiWorldOutput"]
        WGS["world-group-ai<br/>parseWorldSuggestOutput<br/>parseWorldExpandOutput"]
        REFAN["reference-analysis pipeline<br/>分块分析 + 维度合并<br/>角色聚合 parseCharacterMergeOutput"]
        SCV["scene-verify-adapter<br/>无写回 纯建议"]
        CDPA["character-driven-plot<br/>parsePlotOutput"]
        REV["review-adapter<br/>parseReviewResult"]
        RDB["readability-adapter"]
    end

    subgraph OUT["写回 或 输出"]
        WV_OUT["worldviews v3 字段"]
        SC_OUT["storyCores"]
        CH_OUT["characters"]
        WG_OUT["worldGroups"]
        RA_OUT["referenceChunkAnalysis<br/>references.analysisSummary<br/>references.mergedCharacters"]
        ADVICE["场景考证建议 不写回"]
        PLOT_ADV["剧情建议 不直接写回"]
        REV_ADV["审校建议 不写回"]
    end

    BLDWV2["buildWorldContext<br/>或 buildAllWorldsOverview"]
    BLDCH2["buildCharacterContext"]
    HISTC["buildHistoricalContext"]
    WRC2["buildWorldRulesContext"]
    BLDWV2 --> SCV
    HISTC --> SCV
    WRC2 --> SCV
    BLDWV2 --> CDPA
    BLDCH2 --> CDPA
    BLDWV2 --> INV

    FRAG --> INV
    INV ==handleAdoptWorldview==> WV_OUT
    INV ==handleAdoptStoryCore==> SC_OUT
    INV ==handleAdoptCharacters==> CH_OUT
    INV ==handleAdoptMultiWorld==> WG_OUT

    WG_OUT ==全世界概览==> WGS
    WGS ==建议 采纳==> WG_OUT
    WGS ==扩写 采纳==> WV_OUT

    REFC --> REFAN
    REFAN ==分块分析 合并 角色聚合==> RA_OUT

    SCENE --> SCV
    SCV --> ADVICE

    UA --> CDPA
    CDPA --> PLOT_ADV

    CHAP_IN --> REV
    REV --> REV_ADV
    CHAP_IN --> RDB

    classDef in fill:#ca8a04,stroke:#a16207,color:#fff;
    classDef tool fill:#16a34a,stroke:#15803d,color:#fff;
    classDef out fill:#1d4ed8,stroke:#1e40af,color:#fff;
    class FRAG,REFC,SCENE,UA,CHAP_IN in
    class INV,WGS,REFAN,SCV,CDPA,REV,RDB tool
    class WV_OUT,SC_OUT,CH_OUT,WG_OUT,RA_OUT,ADVICE,PLOT_ADV,REV_ADV out
```

---

## 六、多世界系统：数据隔离 + 生命周期

```mermaid
flowchart TB
    WG["🌍 worldGroups<br/>主世界 + N 个并列世界<br/>type primary/parallel/instance/ascension"]
    WGL["worldGroupLinks<br/>fromGroupId · toGroupId · linkType<br/>诸天/穿越/飞升/分支"]

    subgraph WGTABLES["✅ 带 worldGroupId 的表 按世界隔离"]
        T1["worldviews"]
        T2["powerSystems"]
        T3["geographies"]
        T4["histories"]
        T5["worldNodes 世界地图"]
        T6["historicalTimelineEvents"]
        T7["historicalKeywords"]
        T8["outlineNodes 卷可挂世界"]
        T9["codexCategories 自定义"]
        T10["codexEntries 词条"]
        TC["characters<br/>homeWorldGroupId · isCrossWorld 跨世界"]
    end

    subgraph PROJTABLES["⚠️ 项目级 不隔离"]
        P1["storyCores"]
        P2["creativeRules"]
        P3["foreshadows"]
        P4["storyArcs"]
        P5["stateCards"]
        P6["itemLedger 物品栏<br/>诸天流跨世界携带 设计如此"]
        P7["storyTimelineEvents"]
        P8["characterRelations"]
        P9["importantLocations<br/>无 worldGroupId 全局注入"]
        P10["worldRulesProfiles<br/>项目级单例 待 Phase40 多世界化"]
        P11["codex 内置分类<br/>worldGroupId null 全局共用结构"]
    end

    subgraph LIFE["🔄 多世界生命周期 world-group store"]
        MIG["migrateToMultiWorld<br/>stamp wv/ps/geo/hist/wn<br/>+ HTE/HK/codexEntries<br/>分类保持 null 全局"]
        DEL["deleteGroup 级联<br/>删 wv/ps/geo/hist/wn<br/>+ HTE/HK + codexEntries<br/>+ 该世界自定义 codexCategories<br/>清 characters.homeWGId<br/>清 outlineNodes.wgId<br/>删 worldGroupLinks"]
        ENS["ensurePrimaryGroup<br/>确保主世界 type primary"]
        SETACT["setActiveGroup 切换编辑世界"]
    end

    WG -.stamp.-> MIG
    WG -.被删时.-> DEL

    MIG ==> T1
    MIG ==> T2
    MIG ==> T3
    MIG ==> T4
    MIG ==> T5
    MIG ==> T6
    MIG ==> T7
    MIG ==> T10
    DEL ==> T1
    DEL ==> T2
    DEL ==> T3
    DEL ==> T4
    DEL ==> T5
    DEL ==> T6
    DEL ==> T7
    DEL ==> T8
    DEL ==> T9
    DEL ==> T10
    DEL ==> TC

    subgraph CTX2["📥 按世界读取上下文"]
        BCW["buildCurrentWorldContext<br/>按 wgId 取本世界 wv/ps<br/>+ 项目级 sc + 本世界 codex"]
        BNW["buildNodeWritingContext<br/>沿父链解析所属世界<br/>未归属 走单世界路径"]
        BAW["buildAllWorldsOverview<br/>跨世界规划 灵感反推用"]
    end

    T1 --> BCW
    T2 --> BCW
    P1 --> BCW
    T10 --> BCW
    BCW --> BNW
    WG ==全世界摘要==> BAW

    subgraph EXP_S["📦 导出/导入"]
        EXP_OUT["exportProjectJSON<br/>worldGroups 用 _exportId index<br/>BUG-EXPORT-WG<br/>其它表 worldGroupId 是原始 id<br/>导入 remap 键不匹配<br/>多世界归属丢失"]
        IMP_OUT["importProjectJSON<br/>newWorldGroupIds index 新 id<br/>section 27 remap"]
    end

    EXP_OUT -.待修.-> IMP_OUT

    classDef wg fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef wgt fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef pj fill:#7c2d12,stroke:#9a3412,color:#fff;
    classDef life fill:#16a34a,stroke:#15803d,color:#fff;
    classDef ctx fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef bug fill:#991b1b,stroke:#7f1d1d,color:#fff;

    class WG,WGL wg
    class T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,TC wgt
    class P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11 pj
    class MIG,DEL,ENS,SETACT life
    class BCW,BNW,BAW ctx
    class EXP_OUT,IMP_OUT bug
```

---

## 七、设定词条系统 Codex

```mermaid
flowchart TB
    subgraph CAT_TREE["📁 codexCategories 分类树"]
        ROOT_N["自然环境 domain natural"]
        ROOT_H["人文环境 domain humanity"]
        BI_MIN["⛏️ 矿物灵材 builtInKey mineral"]
        BI_HERB["🌿 灵植草药 builtInKey herb"]
        BI_BEAST["🐅 灵兽异兽 builtInKey beast"]
        BI_RACE["🧬 种族民族 builtInKey race"]
        BI_FAC["⚔️ 势力 builtInKey faction"]
        BI_CITY["🏰 城池重镇 builtInKey city"]
        BI_ART["🗡️ 人工器物 builtInKey artifact"]
        CUSTOM["用户自定义大类 小类<br/>可继承通用字段"]
    end

    ROOT_N --> BI_MIN
    ROOT_N --> BI_HERB
    ROOT_N --> BI_BEAST
    ROOT_H --> BI_RACE
    ROOT_H --> BI_FAC
    ROOT_H --> BI_CITY
    ROOT_H --> BI_ART
    ROOT_N --> CUSTOM
    ROOT_H --> CUSTOM

    subgraph FS["📋 fieldSchema 驱动表单"]
        FS_M["矿物<br/>appearance · rank · effect<br/>origin · rarity · craftInto ref artifact"]
        FS_H["草药<br/>form · effect · rank · habitat<br/>maturity · difficulty · craftInto ref artifact"]
        FS_B["异兽<br/>kind · cultivation 占位 · realm<br/>body · habit · habitat · threat<br/>ability · drops"]
        FS_R["种族<br/>appearance · talent · lifespan<br/>population · custom · faith 等"]
        FS_F["势力<br/>type · territory · leader · power<br/>goal · banner · mapRegion · color"]
        FS_C["城池<br/>faction ref · location 占位<br/>scale · ruler · economy · strategic"]
        FS_A["器物<br/>type · rank · effect · craft<br/>materials ref mineral · origin · owner"]
    end

    BI_MIN -.fieldSchema.-> FS_M
    BI_HERB -.fieldSchema.-> FS_H
    BI_BEAST -.fieldSchema.-> FS_B
    BI_RACE -.fieldSchema.-> FS_R
    BI_FAC -.fieldSchema.-> FS_F
    BI_CITY -.fieldSchema.-> FS_C
    BI_ART -.fieldSchema.-> FS_A

    ENTRIES["📜 codexEntries 词条<br/>categoryId · name · icon · summary · description<br/>fields JSON · refs JSON 关联其它词条<br/>worldGroupId"]

    FS_M --> ENTRIES
    FS_H --> ENTRIES
    FS_B --> ENTRIES
    FS_R --> ENTRIES
    FS_F --> ENTRIES
    FS_C --> ENTRIES
    FS_A --> ENTRIES

    REF["🔗 词条间 ref 关联<br/>矿物 → 可炼器物<br/>器物 → 所需材料<br/>城池 → 所属势力<br/>异兽 → 可产出材料"]
    ENTRIES -.refs.-> REF
    REF -.指向其它词条.-> ENTRIES

    CTXBLD["buildCodexContext projectId wgId<br/>分类紧凑格式化<br/>预算上限 2500 字<br/>全局项 null 在任何世界可见<br/>世界专属项仅其世界可见"]
    ENTRIES --> CTXBLD
    CAT_TREE --> CTXBLD

    INJ["注入 AI 写作<br/>buildCurrentWorldContext 多世界<br/>buildNodeWritingContext<br/>章节/大纲/细纲/场景/角色/伏笔/故事线 全部入口"]
    CTXBLD --> INJ

    classDef cat fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef fs fill:#7c2d12,stroke:#9a3412,color:#fff;
    classDef ent fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef inj fill:#16a34a,stroke:#15803d,color:#fff;
    class ROOT_N,ROOT_H,BI_MIN,BI_HERB,BI_BEAST,BI_RACE,BI_FAC,BI_CITY,BI_ART,CUSTOM cat
    class FS_M,FS_H,FS_B,FS_R,FS_F,FS_C,FS_A fs
    class ENTRIES,REF ent
    class CTXBLD,INJ inj
```

---

## 八、生命周期操作 × 表 矩阵（数据完整性根因图）

```mermaid
flowchart LR
    subgraph OPS["🔄 5 个生命周期操作 各自手写表清单"]
        EXP["📤 exportProjectJSON<br/>json-export.ts"]
        IMP["📥 importProjectJSON<br/>section 27 remap"]
        DELP["🗑️ deleteProject<br/>stores/project.ts"]
        DELG["🗑️ deleteGroup<br/>stores/world-group.ts"]
        MIG["📦 migrateToMultiWorld stamp<br/>stores/world-group.ts"]
    end

    subgraph TBL_OK["✅ 已被全部 5 操作覆盖 健康"]
        OK_WV["worldviews"]
        OK_PS["powerSystems"]
        OK_GEO["geographies"]
        OK_HIST["histories"]
        OK_WN["worldNodes"]
        OK_HTE["historicalTimelineEvents"]
        OK_HK["historicalKeywords"]
    end

    subgraph TBL_FIXED["🩹 曾漏 已修复"]
        FX_LOC["importantLocations<br/>此前 export deleteProject 漏"]
        FX_WR["worldRulesProfiles<br/>此前 export deleteProject 漏"]
        FX_CC["codexCategories<br/>此前 export deleteProject 漏"]
        FX_CE["codexEntries<br/>此前 export deleteProject deleteGroup migrate 漏"]
        FX_AIL["aiUsageLog<br/>此前 deleteProject 漏"]
    end

    subgraph TBL_BUG["🔴 仍有 BUG"]
        BUG_WG["worldGroups 自身<br/>BUG-EXPORT-WG<br/>导出用 index 重映射键值错位"]
    end

    EXP -.全覆盖.-> OK_WV
    EXP -.全覆盖.-> OK_PS
    EXP -.全覆盖.-> OK_GEO
    EXP -.全覆盖.-> OK_HIST
    EXP -.全覆盖.-> OK_WN
    EXP -.全覆盖.-> OK_HTE
    EXP -.全覆盖.-> OK_HK
    EXP ==修复后==> FX_LOC
    EXP ==修复后==> FX_WR
    EXP ==修复后==> FX_CC
    EXP ==修复后==> FX_CE
    EXP -.aiUsageLog 不导出 设计如此.-> FX_AIL

    IMP -.全覆盖.-> OK_WV
    IMP ==修复后==> FX_LOC
    IMP ==修复后==> FX_WR
    IMP ==修复后==> FX_CC
    IMP ==修复后==> FX_CE
    IMP -.受 BUG-EXPORT-WG 影响.-> BUG_WG

    DELP -.全覆盖.-> OK_WV
    DELP ==修复后==> FX_LOC
    DELP ==修复后==> FX_WR
    DELP ==修复后==> FX_CC
    DELP ==修复后==> FX_CE
    DELP ==修复后==> FX_AIL

    DELG -.覆盖 wgId 表.-> OK_WV
    DELG ==修复后==> OK_HTE
    DELG ==修复后==> OK_HK
    DELG ==修复后==> FX_CE

    MIG -.stamp 项目→主世界.-> OK_WV
    MIG ==修复后==> FX_CE

    ROOT["⚠️ 根因<br/>没有一份 PROJECT_TABLES 唯一注册表<br/>每个生命周期操作各自手列表<br/>加新表必漏一处<br/>已记 ROADMAP 架构改造"]
    EXP -.根因.-> ROOT
    IMP -.根因.-> ROOT
    DELP -.根因.-> ROOT
    DELG -.根因.-> ROOT
    MIG -.根因.-> ROOT

    classDef ok fill:#16a34a,stroke:#15803d,color:#fff;
    classDef fixed fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef bug fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef op fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef root fill:#7f1d1d,stroke:#450a0a,color:#fff;
    class OK_WV,OK_PS,OK_GEO,OK_HIST,OK_WN,OK_HTE,OK_HK ok
    class FX_LOC,FX_WR,FX_CC,FX_CE,FX_AIL fixed
    class BUG_WG bug
    class EXP,IMP,DELP,DELG,MIG op
    class ROOT root
```

---

## 九、AI 客户端 + 消耗统计

```mermaid
flowchart TB
    subgraph PANELS["所有 AI 调用面板 32+"]
        P1["ChapterEditor"]
        P2["OutlinePanel"]
        P3["DetailedOutlinePanel"]
        P4["ScenePanel"]
        P5["WorldviewOrigin/Natural/Humanity"]
        P6["StoryCorePanel"]
        P7["CreativeRulesPanel"]
        P8["CharacterPanel"]
        P9["ForeshadowPanel"]
        P10["StoryArcPanel"]
        P11["SceneVerifyPanel"]
        P12["CharacterDrivenPlotPanel"]
        P13["CharacterRelationPanel"]
        P14["GeographyPanel<br/>AI SVG sanitizeSvg 防 XSS"]
        P15["WorldMapPanel/Voronoi"]
        P16["HistoryPanel"]
        P17["InspirationPanel"]
        P18["WorldGroup Detail/Overview"]
        P19["ReviewPanel"]
        P20["EmotionBeatCard"]
        P21["FloatingToolbar 选区润色"]
        P22["AIFieldCard 通用"]
        P23["InventoryPanel 一键提取"]
        P24["StoryTimelinePanel 一键提取"]
        P25["WorkflowRunner"]
        P26["AnalysisReportViewer 角色聚合"]
        P28["ImportSession 解析"]
        P29["Reference 深度分析"]
        P30["Master 作品学习"]
    end

    HOOK["🪝 useAIStream Hook<br/>start messages overrideConfig meta<br/>meta category projectId<br/>tokenUsage 输出"]

    PANELS --> HOOK

    subgraph CLIENT["🔌 lib/ai/client.ts 唯一出口"]
        STREAM["streamChat msgs config signal result meta<br/>SSE 流式 解析 DONE + usage"]
        CHAT["chat msgs config meta 非流式"]
        BR["buildRequest config msgs stream<br/>按 provider 构造 body + headers<br/>poe / deepseek / glm / gemini<br/>wenxin / qwen / kimi / claude / openai / nim"]
    end

    HOOK --> STREAM
    AICTX["adapter chat msgs config meta<br/>restructure parseCharacterOutput merge 等"] --> CHAT
    STREAM --> BR
    CHAT --> BR

    BR ==POST==> PROV["AI Provider<br/>OpenAI 兼容 中转站<br/>南柯一梦 Poe NVIDIA NIM 等"]

    LOGGER["lib/ai/logger.ts<br/>内存日志 50 条 + 订阅<br/>createLog updateLog<br/>AIConfigPanel 实时查看"]
    STREAM --> LOGGER
    CHAT --> LOGGER

    USAGE["lib/ai/usage-log.ts<br/>recordUsage meta + model + tokens<br/>computeCostUsd 模型估算单价<br/>categoryMeta moduleKey 转标签"]
    STREAM ==有 usage 时==> USAGE
    CHAT ==有 usage 时==> USAGE

    DB_USAGE["aiUsageLog 表<br/>timestamp · category · model<br/>inputTokens · outputTokens · costUsd"]
    USAGE --> DB_USAGE

    STATS["设置 消耗统计页<br/>UsageStatsPage<br/>时间 类型标签 模型 输入 输出<br/>花费 美元上 人民币下<br/>汇率可调 仅当前项目筛选"]
    DB_USAGE --> STATS

    classDef panel fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef hook fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef cli fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef log fill:#7c3aed,stroke:#6d28d9,color:#fff;
    classDef stat fill:#16a34a,stroke:#15803d,color:#fff;
    class P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11,P12,P13,P14,P15,P16,P17,P18,P19,P20,P21,P22,P23,P24,P25,P26,P28,P29,P30 panel
    class HOOK,USAGE,LOGGER hook
    class STREAM,CHAT,BR,PROV,AICTX cli
    class DB_USAGE log
    class STATS stat
```

---

## 十、三层记忆系统

```mermaid
flowchart TB
    subgraph TASK["任务类型 预算分配"]
        T_WRITE["write 写作<br/>Working 3000<br/>Episodic 1500<br/>Semantic 2000"]
        T_PLAN["plan 规划<br/>Working 1000<br/>Episodic 1500<br/>Semantic 3500"]
        T_REVIEW["review 审校<br/>Working 1500<br/>Episodic 3000<br/>Semantic 2000"]
    end

    subgraph WM["🟦 Working Memory 工作记忆 紧贴当前剧情"]
        WM1["当前章节大纲<br/>currentOutline title + summary"]
        WM2["最近 3 章摘要<br/>按 order 排序取 -3<br/>无 summary 则取正文末尾 300 字"]
        WM3["当前章节情感节拍<br/>emotionBeatContext"]
    end

    subgraph EM["🟧 Episodic Memory 情景记忆 最近变化"]
        EM1["最近 15 张状态卡<br/>按 updatedAt 降序<br/>所有 category 实体 字段"]
        EM2["关键事件<br/>category event 的状态卡<br/>按 lastChapterId 升序"]
        EM3["人物关系动态<br/>category character 中<br/>field 含 关系 关联 态度"]
    end

    subgraph SM["🟪 Semantic Memory 语义记忆 背景知识"]
        SM1["worldContext<br/>formatWorldviewBlock 全字段<br/>+ formatStoryCoreBlock<br/>+ formatPowerSystemBlock<br/>+ buildCodexContext"]
        SM2["characterContext<br/>buildCharacterContext<br/>核心 重要 其他 三层"]
        SM3["开放伏笔<br/>buildForeshadowContext"]
        SM4["故事线 storyArcContext"]
    end

    T_WRITE -.高权重 Working.-> WM
    T_PLAN -.高权重 Semantic.-> SM
    T_REVIEW -.高权重 Episodic.-> EM

    BUILD["buildMemory input<br/>并行构建 3 层<br/>每层 truncate budget<br/>从最后整行处截断"]

    WM --> BUILD
    EM --> BUILD
    SM --> BUILD

    OUT["拼装 fullContext<br/>Semantic + Episodic + Working<br/>由静到动顺序<br/>ContextBudgetBar 显示预算分布<br/>autoTrimToFit 仅显示 不真裁 待开发"]
    BUILD --> OUT
    OUT ==> CHAPGEN["buildChapterContentPrompt"]

    classDef task fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef wm fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef em fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef sm fill:#7c3aed,stroke:#6d28d9,color:#fff;
    classDef build fill:#0891b2,stroke:#0e7490,color:#fff;
    class T_WRITE,T_PLAN,T_REVIEW task
    class WM1,WM2,WM3 wm
    class EM1,EM2,EM3 em
    class SM1,SM2,SM3,SM4 sm
    class BUILD,OUT,CHAPGEN build
```

---

## 十一、自动保存 / 备份 / 导出 / 导入 数据安全链

```mermaid
flowchart TB
    EDIT["正文编辑 ChapterEditor<br/>RichEditor TipTap"]
    AUTOS["useAutoSave<br/>debounce 1500ms<br/>refs 最新数据 无陈旧闭包<br/>unmount flush dirty 检测"]
    EDIT --> AUTOS
    AUTOS --> CHAPDB["chapters.content"]

    AUTOB["useAutoBackup<br/>setInterval N 分钟<br/>调 createSnapshot auto"]
    PROJ_OP["项目切换 或 编辑"] --> AUTOB

    SNAP["createSnapshot projectId label type<br/>复用 exportProjectJSON<br/>自动继承全部表覆盖"]
    AUTOB --> SNAP
    MAN_SNAP["版本历史面板 手动备份"] --> SNAP

    SNAP --> SNAPDB["snapshots.data 完整 JSON"]
    SNAPDB --> RESTORE["restoreSnapshot<br/>importProjectJSON 新建项目"]
    RESTORE --> NEW["新 project 与全部子表"]

    subgraph EXPORTS["📦 导出格式"]
        EXP_JSON["JSON 全量备份<br/>exportProjectJSON<br/>含 27 张表用户内容<br/>ID 重映射 parent category worldGroup<br/>worldGroupId 重映射键值待修"]
        EXP_MD["Markdown text-export"]
        EXP_HTML["HTML 设定集<br/>html-builder<br/>世界观 v3 全字段<br/>角色卡完整字段"]
        EXP_EPUB["EPUB epub-export jszip"]
        EXP_TXT["纯文本 text-export"]
        EXP_GIST["Gist 同步 gist-export<br/>复用 ProjectExportData"]
        CTX_SNAP["context-snapshot<br/>注入写作的 memo<br/>读 v3 字段 v2 兜底"]
    end

    EDIT_PROJ["用户操作 导出菜单"] --> EXP_JSON
    EDIT_PROJ --> EXP_MD
    EDIT_PROJ --> EXP_HTML
    EDIT_PROJ --> EXP_EPUB
    EDIT_PROJ --> EXP_TXT
    EDIT_PROJ --> EXP_GIST
    EDIT_PROJ --> CTX_SNAP
    CTX_SNAP --> MEMO_DB["localStorage 注入写作"]

    subgraph IMPORTS["📥 导入"]
        IMP_JSON["importProjectJSON<br/>新建项目 全部子表<br/>section 27 worldGroupId remap"]
        IMP_DOC["导入 txt/docx/pdf<br/>doc-parser 动态 import<br/>pdfjs mammoth 懒加载"]
        IMP_SESS["importSessions<br/>断点续跑<br/>scanIncomplete loadBlob"]
    end

    USER_FILE["用户上传文件"] --> IMP_DOC
    IMP_DOC --> IMP_SESS
    IMP_SESS --> IMP_PARSE["分块解析 AI 结构化<br/>import-adapter<br/>tryParseWithRepair"]
    IMP_PARSE --> CHUNK_WRITE["chunk-writer<br/>写 worldview outline 树 characters<br/>去重 dedup 按 name"]
    CHUNK_WRITE --> DB1["worldviews outlineNodes characters"]

    USER_JSON["用户导入备份"] --> IMP_JSON
    IMP_JSON --> NEW2["新 project 全部还原"]

    classDef edit fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef save fill:#0891b2,stroke:#0e7490,color:#fff;
    classDef exp fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef imp fill:#16a34a,stroke:#15803d,color:#fff;
    classDef db fill:#7c3aed,stroke:#6d28d9,color:#fff;

    class EDIT,EDIT_PROJ,USER_FILE,USER_JSON,PROJ_OP,MAN_SNAP edit
    class AUTOS,AUTOB,SNAP,CTX_SNAP save
    class EXP_JSON,EXP_MD,EXP_HTML,EXP_EPUB,EXP_TXT,EXP_GIST exp
    class IMP_JSON,IMP_DOC,IMP_SESS,IMP_PARSE,CHUNK_WRITE,RESTORE imp
    class CHAPDB,SNAPDB,DB1,MEMO_DB,NEW,NEW2 db
```

---

## 十二、删除引用完整性

```mermaid
flowchart LR
    subgraph DELS["🗑️ 删除操作"]
        D1["deleteCharacter"]
        D2["deleteChapter"]
        D3["deleteNode 大纲节点"]
        D4["deleteProject"]
        D5["deleteGroup 世界组"]
        D6["deleteReference"]
        D7["deleteCategory 词条分类"]
    end

    subgraph CASC["🔗 必须级联清理 已修复"]
        C1["characterRelations<br/>from to CharacterId"]
        C2["emotionBeatCards chapterId"]
        C3["chapters detailedOutlines<br/>outlineNodeId<br/>级联子大纲节点"]
        C4["importantLocations worldRulesProfiles<br/>codexCategories codexEntries aiUsageLog<br/>此前漏 已补"]
        C5["wv ps geo hist wn HTE HK<br/>+ codexEntries + 该世界自定义 codexCategories<br/>清 characters homeWGId<br/>清 outlineNodes wgId"]
        C6["referenceChunkAnalysis referenceId"]
        C7["该分类下全部词条 子分类<br/>codexEntries 子 codexCategories"]
    end

    subgraph SOFT["🟡 软引用 设计如此 不强删"]
        S1["foreshadows chapterId<br/>itemLedger chapterId<br/>storyTimelineEvents chapterId<br/>冗余 chapterTitle 独立产物"]
    end

    D1 ==> C1
    D2 ==> C2
    D2 -.保留.-> S1
    D3 ==> C3
    D3 -.递归.-> D3
    D4 ==> C4
    D5 ==> C5
    D6 ==> C6
    D7 ==> C7

    classDef del fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef casc fill:#16a34a,stroke:#15803d,color:#fff;
    classDef soft fill:#ca8a04,stroke:#a16207,color:#fff;
    class D1,D2,D3,D4,D5,D6,D7 del
    class C1,C2,C3,C4,C5,C6,C7 casc
    class S1 soft
```

---

## 十三、Stores 全景（zustand store 责任划分）

```mermaid
flowchart LR
    subgraph CORE["核心数据 store"]
        S_PROJ["project<br/>currentProjectId · CRUD<br/>deleteProject 级联"]
        S_WV["worldview<br/>worldview/storyCore/powerSystem<br/>activeWorldGroupId<br/>save 以 DB 为准 防重复"]
        S_CH["character + characterRelations"]
        S_FAC["character.factions"]
        S_OUT["outline<br/>deleteNode 级联子 正文 细纲"]
        S_CHAP["chapter<br/>deleteChapter 级联 emotionBeats"]
        S_DOUT["detailed-outline<br/>getOrCreate DB 兜底 防重复"]
        S_FORE["foreshadow<br/>computeUrgency<br/>buildForeshadowContext"]
        S_LOC["location 重要地点"]
        S_SARC["story-arc"]
        S_NOTE["note"]
        S_RULES["creativeRules 单例工厂"]
        S_GEO["geography 单例工厂"]
        S_HIST["history 单例工厂"]
        S_ITEM["itemSystem 单例工厂"]
        S_WR["world-rules<br/>loadProfile getOrCreate"]
        S_WG["world-group<br/>migrate delete setActive"]
        S_WN["world-node 世界树"]
        S_HISTQ["historical events + keywords"]
    end

    subgraph DOWN_S["下游产物 store"]
        S_STATE["state-card<br/>applyDiffs 按实体聚合<br/>buildStateContext Selective"]
        S_LED["item-ledger<br/>deleteByChapter aggregateInventory"]
        S_TIME["story-timeline deleteByChapter"]
        S_EB["emotion-beat"]
    end

    subgraph TOOL_S["工具 store"]
        S_REF["reference 项目参考"]
        S_MS["master-study 作品学习"]
        S_PROMPT["prompt 模板"]
        S_WF["workflow 工作流"]
        S_BACK["backup 快照"]
        S_IMP["import-session 导入会话"]
        S_IMPS["import-status 进度状态"]
        S_CODEX["codex 词条<br/>ensureBuiltIns 幂等播种<br/>deleteCategory 级联词条 子"]
        S_USAGE["ai-usage 消耗统计"]
        S_AI["ai-config 多套预设 localStorage"]
        S_SING["project-singletons 工厂入口"]
        S_FAC2["_factories makeSingletonStore<br/>save 以 DB 为准 防重复"]
    end

    S_FAC2 -.工厂.-> S_RULES
    S_FAC2 -.工厂.-> S_GEO
    S_FAC2 -.工厂.-> S_HIST
    S_FAC2 -.工厂.-> S_ITEM

    classDef core fill:#1d4ed8,stroke:#1e40af,color:#fff;
    classDef down fill:#7c3aed,stroke:#6d28d9,color:#fff;
    classDef tool fill:#16a34a,stroke:#15803d,color:#fff;
    class S_PROJ,S_WV,S_CH,S_FAC,S_OUT,S_CHAP,S_DOUT,S_FORE,S_LOC,S_SARC,S_NOTE,S_RULES,S_GEO,S_HIST,S_ITEM,S_WR,S_WG,S_WN,S_HISTQ core
    class S_STATE,S_LED,S_TIME,S_EB down
    class S_REF,S_MS,S_PROMPT,S_WF,S_BACK,S_IMP,S_IMPS,S_CODEX,S_USAGE,S_AI,S_SING,S_FAC2 tool
```

---

## 十四、已修复 bug 与待开发清单可视化

```mermaid
flowchart LR
    subgraph BUGS["🟢 已修复关键 bug 本轮审计"]
        B1["导出漏 3 表<br/>importantLocations worldRulesProfiles codex"]
        B2["单世界世界观读 v2<br/>面板写 v3 喂不进 AI"]
        B3["创作规则不注入正文"]
        B4["场景 细纲 角色 多世界串台"]
        B5["灵感反推采纳为空<br/>save 内存 null 新建重复"]
        B6["单例工厂 save 重复记录<br/>geo hist itemSystem creativeRules"]
        B7["detailed-outline 重复细纲"]
        B8["状态 applyDiffs 同实体多字段<br/>重复 或 覆盖"]
        B9["deleteNode 漏删正文 细纲"]
        B10["deleteCharacter 漏删关系"]
        B11["deleteProject 漏 5 表"]
        B12["deleteGroup 漏删 HTE HK codex"]
        B13["migrateToMultiWorld 漏盖章 codex"]
        B14["HTML 导出世界观为空<br/>只渲染世界树"]
        B15["context-snapshot 读 v2 字段"]
        B16["AI SVG 未清洗 XSS"]
        B17["storyLines 遗留字段"]
    end

    subgraph TODO_H["🔴 待开发 高优先"]
        T1["BUG-INPUT-WITH-GEN<br/>文本框可输入 AI 带上当前值<br/>工作流步骤卡无输入"]
        T2["Phase 40<br/>真实与幻想多世界联动<br/>设计已就绪"]
        T3["BUG-EXPORT-WG<br/>多世界 worldGroupId remap 错位"]
        T4["Phase 38 AI 一致性检测"]
        T5["Phase 39 多故事线进度追踪"]
    end

    subgraph TODO_M["🟠 待开发 中优先"]
        TM1["PROJECT_TABLES 唯一注册表<br/>结构性根治新表漏接生命周期"]
        TM2["R-1 统一上下文装配层<br/>+ 数据源注册表"]
        TM3["R-2 统一采纳写回层<br/>+ 规范字段 schema"]
        TM4["autoTrimToFit 真裁剪<br/>token-aware 降级"]
        TM5["Phase 34 力量阶段追踪"]
        TM6["Phase 35-b 词条迁移落地<br/>势力合并 物产 器物"]
        TM7["Phase 35-c 导入 AI 分类"]
        TM8["Phase 36 上下游标记"]
        TM9["Phase 37 修炼体系 DAG"]
    end

    subgraph TODO_L["🔵 待开发 低优先"]
        TL1["Phase 27 AI Agent 化<br/>对话副驾 + 后台 Agent"]
        TL2["Phase 27.2b 写作时自动检索"]
        TL3["Phase 27.3 NPC 自动演进"]
        TL4["React.lazy 懒加载重面板"]
        TL5["提示词内容质量审查"]
        TL6["UI 运行时走查"]
        TL7["D AI 建议世界字段不全"]
        TL8["E 重要地点无 worldGroupId"]
        TL9["G/I 伏笔 历史多世界"]
        TL10["死代码 WorldviewPanel 已清"]
        TL11["filterActiveCharacters 章节 ID vs order"]
    end

    classDef fix fill:#16a34a,stroke:#15803d,color:#fff;
    classDef hi fill:#dc2626,stroke:#b91c1c,color:#fff;
    classDef mid fill:#ea580c,stroke:#c2410c,color:#fff;
    classDef lo fill:#0891b2,stroke:#0e7490,color:#fff;
    class B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11,B12,B13,B14,B15,B16,B17 fix
    class T1,T2,T3,T4,T5 hi
    class TM1,TM2,TM3,TM4,TM5,TM6,TM7,TM8,TM9 mid
    class TL1,TL2,TL3,TL4,TL5,TL6,TL7,TL8,TL9,TL10,TL11 lo
```

---

## 附录：所有 DB 表速查 v26

```mermaid
flowchart TB
    subgraph V1["v1-v17 基础"]
        T_P["projects"]
        T_WV2["worldviews"]
        T_SC2["storyCores"]
        T_PS2["powerSystems"]
        T_C["characters"]
        T_F["factions"]
        T_O["outlineNodes"]
        T_CH["chapters"]
        T_FO["foreshadows"]
        T_G["geographies"]
        T_H["histories"]
        T_I["itemSystems"]
        T_CR["creativeRules"]
        T_CRL["characterRelations"]
        T_SN["snapshots"]
        T_R["references"]
        T_PT["promptTemplates"]
        T_DO["detailedOutlines"]
        T_IJ["importJobs"]
        T_IS["importSessions"]
        T_IL["importLogs"]
        T_IF["importFiles blob"]
        T_PW["promptWorkflows"]
    end

    subgraph V_MID["v18-v22"]
        T_MW["masterWorks"]
        T_MC["masterChunkAnalysis"]
        T_MCB["masterChapterBeats"]
        T_MSM["masterStyleMetrics"]
        T_MI["masterInsights"]
        T_RCA["referenceChunkAnalysis"]
        T_ST["stateCards"]
        T_EB["emotionBeatCards"]
        T_SA["storyArcs"]
        T_N["notes"]
        T_WN["worldNodes"]
        T_HTE["historicalTimelineEvents"]
        T_HK["historicalKeywords"]
        T_LOC["importantLocations"]
        T_WRP["worldRulesProfiles"]
        T_WG["worldGroups"]
        T_WGL["worldGroupLinks"]
    end

    subgraph V_NEW["v23-v26 新增"]
        T_LE["itemLedger"]
        T_STE["storyTimelineEvents"]
        T_CC["codexCategories"]
        T_CE["codexEntries"]
        T_AU["aiUsageLog"]
    end
```

---

## 维护说明

- **本图与 `docs/DATA-FLOW-MAP.md` 文字总表同步更新**，是同一份数据的两种视图。
- 任何新增 **功能 / 表 / AI 调用入口**，必须在两份文档同步登记，并：
  - 在图二注册"被哪个共享构建函数读"
  - 在图四登记"是否提取下游"
  - 在图八的生命周期矩阵更新覆盖情况
  - 在图九登记 category 消耗类型
- 这是项目的**唯一事实源**，今后审查 / 重构以此为基准。
