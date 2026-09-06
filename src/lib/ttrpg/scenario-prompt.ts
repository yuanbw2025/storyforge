/** Prompt schema is paired with scenario-authoring's deterministic parser and compiler. */
export const TTRPG_SCENARIO_PROMPT_V1 = `
你正在制作可真实游玩的原创跑团模组。必须把上游 content.narrative 的已验收图和 Brief 的作者选择落实为完整场景、秘密、线索、角色与结局。
上下文 ttrpgRules 是实际冻结的规则：所有属性 key 和行动 key 只能从这里选择。上游 narrative.nodes 使用的是已规范化的 key，逐字复制它们，不要从标题重新发明。
仅输出如下严格 JSON（最外层精确七字段；ttrpgScenario 也使用精确字段）：
{"schema":"storyforge.product-module-artifact","version":1,"productType":"ttrpg","interfaceStyle":"沉浸式调查桌面","interactionNotes":["玩家用角色行动调查，KP按证据揭示，玩家选择去向与结局"],"presentationPolicy":{"pacing":"balanced","transitionMs":400,"backgroundStrategy":"none"},"ttrpgScenario":{"schema":"storyforge.ttrpg-authored-scenario","version":1,"characters":[{"key":"pc.author","seatKey":"逐字复制 Brief 中的 seatKey；NPC 为 null","name":"已确认角色姓名不得改写","description":"公开身份、外貌与开场可见行为，不包含秘密或真实动机","appearance":"可绘制的具体外貌","background":"个人背景","goal":"可驱动选择的私人目标","secret":"具体且会影响合作的个人秘密，不用占位句","portrayal":"说话节奏与行为习惯","leverage":"掌握的资源或谈判条件","strengthAttributeKey":"ttrpgRules.attributes 中的 key","weaknessAttributeKey":"不同于强项的属性 key"}],"scenes":[{"nodeKey":"已验收 narrative 中的 key","description":"可直接读给玩家的开场场景：感官、至少两处可以调查的对象、当前人物；不剧透","gmTruth":"仅 KP 可知的真实因果与隐藏压力","failureForward":"失败时具体增加什么代价，又能从哪里继续调查","participantKeys":["characters 中的 key"]}],"clues":[{"key":"clue.unique","title":"具体证据名称","description":"发现后可展示的具体证据；不能复制场景简介，不能是抽象方向或结局","conclusionKey":"conclusion.unique","required":true,"visibility":"discoverable","paths":[{"nodeKey":"发现地点的已验收节点 key","actionKey":"冻结规则动作 key","failForward":"失败仍提供核心信息，说明取得它的具体代价"}]}],"quests":[{"key":"quest.unique","title":"玩家理解的目标","objective":"具体可完成的共同任务","requiredConclusionKeys":["clues 中的 conclusionKey"]}],"endings":[{"nodeKey":"已验收 ending 节点 key","title":"结局名称","epilogue":"回应玩家选择、角色关系、共同目标及付出的代价，不替玩家编造没做过的行动","requiredConclusionKeys":[],"forbiddenConclusionKeys":[]}]}}
质量要求：
1. Brief 的每一个玩家席位恰好一张角色卡，另有 1～3 名各具目标的 NPC。秘密必须不同；公开 description 不得泄露。角色强弱项不同，队友应当互补。NPC seatKey 是真正的 JSON null。
2. narrative 中每个节点恰好一个 scenes 项，包括所有结局节点；每个 scenes.participantKeys 包含本局所有玩家，再加当前在场的 NPC。不要让所有 NPC 永远跟着队伍。
3. 至少三个具体证据。每条 required 线索至少两条不同的 scene/action 发现路径，路径必须可达；关键证据可以失败推进，但不能在开场直接公布真相。
4. clues.paths 的 nodeKey 与 actionKey 都必须真实存在。核心任务必须对应可获得的 conclusionKey。所有结束条件引用的 conclusionKey 必须存在。
5. 每个 narrative ending 节点恰好一个 endings 项。先检查路径上的证据是否真的可获得；至少一个带代价的退场结局不要求任何必需线索，防止死锁。不同结局回应不同抉择，不能只是同一句话换标题。
6. 场景的 gmTruth、角色 secret、线索发现后的正文、公开开场必须分开。不要把秘密直接写进公开描述，也不要把整场故事写成玩家只能照读的小说。
7. 保持 Brief.campaignDesign 的作者锁定方向；所有内容必须符合冻结世界与开团内容边界。输出完整成品，不能出现“待补充”“由KP决定”“秘密待揭示”等占位内容。
`
