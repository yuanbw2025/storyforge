/**
 * 全量项目种子 · 测试共享 helper
 *
 * 覆盖全部 exportable 表 + 双世界组 + 树 + 各类外键。
 * 供 R-export-fullcoverage(往返安全网)与 R-export-derive-equivalence(派生等价性)共用。
 */
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { replayAgentRunEventsV1, toAgentRunProjectionBodyV1 } from '../../src/lib/agent/run/projection'
import type { AnyAgentRunEventV1 } from '../../src/lib/types'

const now = 1_700_000_000_000 // 固定时间戳,保证派生/手写两版导出可逐字段比对

/** 种子:每张 exportable 表至少一行,带双世界组 + 树 + 各类外键。返回各源 id 便于断言。 */
export async function seedFullProject() {
  const projectId = await db.projects.add({
    name: '全量作品', genre: 'fantasy', genres: ['fantasy'], description: '全表往返',
    targetWordCount: 100000, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number

  // ── WORLD-2C C1 显式世界/作品根 ──
  const worldId = await db.worlds.add({
    projectId,
    code: 'world-full-fixture',
    name: '全量世界',
    description: '全表往返世界根',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '全量作品',
    description: '全表往返作品根',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100000,
    createdAt: now,
    updatedAt: now,
  }) as number

  // ── 双世界组(order 决定导出序) ──
  const wgA = await db.worldGroups.add({ projectId, name: '主世界群', order: 0, createdAt: now, updatedAt: now } as any) as number
  const wgB = await db.worldGroups.add({ projectId, name: '镜世界群', order: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldGroupLinks.add({ projectId, fromGroupId: wgA, toGroupId: wgB, type: 'portal', createdAt: now, updatedAt: now } as any)

  // ── worldScoped 设定表(挂 wgA / wgB,验证 worldGroupId 重映射) ──
  await db.worldviews.add({ projectId, worldGroupId: wgA, worldOrigin: '混沌创世', powerHierarchy: '炼气→金丹', createdAt: now, updatedAt: now } as any)
  await db.worldviews.add({ projectId, worldGroupId: wgB, worldOrigin: '镜中倒影', createdAt: now, updatedAt: now } as any)
  await db.storyCores.add({ projectId, logline: '少年逆袭', mainPlot: '从山村到仙界', createdAt: now, updatedAt: now } as any)
  await db.powerSystems.add({ projectId, worldGroupId: wgA, name: '修真体系', description: '九重天', createdAt: now, updatedAt: now } as any)
  await db.geographies.add({ projectId, worldGroupId: wgA, overview: '三大洲', createdAt: now, updatedAt: now } as any)
  await db.histories.add({ projectId, worldGroupId: wgA, summary: '上古神战', createdAt: now, updatedAt: now } as any)
  await db.historicalTimelineEvents.add({ projectId, worldGroupId: wgA, title: '封神之战', year: -1000, createdAt: now, updatedAt: now } as any)
  await db.historicalKeywords.add({ projectId, worldGroupId: wgA, keyword: '神器', createdAt: now, updatedAt: now } as any)
  await db.worldRulesProfiles.add({ projectId, worldGroupId: wgA, rules: '魔法守恒', createdAt: now, updatedAt: now } as any)
  const cultivationSystem = await db.cultivationSystems.add({
    projectId, worldGroupId: wgA, name: '青云剑修', description: '以灵气淬剑',
    stages: JSON.stringify([
      { id: 'qi', name: '炼气', parentStageIds: [] },
      { id: 'foundation', name: '筑基', parentStageIds: ['qi'], breakthrough: '筑成道基' },
    ]),
    createdAt: now, updatedAt: now,
  }) as number

  // ── worldNodes(树 + portalsJSON 自引用,wgA) ──
  const rootWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: null, name: '主世界', description: '起点', sortOrder: 0, createdAt: now, updatedAt: now } as any) as number
  const mirrorWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: rootWorld, name: '镜界', description: '镜中', sortOrder: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldNodes.update(rootWorld, { portalsJSON: JSON.stringify([{ name: '镜门', targetWorldId: mirrorWorld, x: 1, y: 2 }]) })

  // ── importantLocations(树) ──
  const locParent = await db.importantLocations.add({ projectId, parentId: null, name: '青云山', type: 'mountain', createdAt: now, updatedAt: now } as any) as number
  await db.importantLocations.add({ projectId, parentId: locParent, name: '青云峰', type: 'peak', createdAt: now, updatedAt: now } as any)

  // ── 角色(homeWorldScoped:一个挂 wgA,一个跨世界) ──
  const char1 = await db.characters.add({
    projectId, homeWorldGroupId: wgA, name: '林惊羽', role: 'protagonist', personality: '坚毅',
    cultivationSystemId: cultivationSystem, cultivationStageId: 'qi',
    createdAt: now, updatedAt: now,
  } as any) as number
  const char2 = await db.characters.add({ projectId, isCrossWorld: true, name: '苏长歌', role: 'supporting', createdAt: now, updatedAt: now } as any) as number
  await db.characterRelations.add({ projectId, fromCharacterId: char1, toCharacterId: char2, type: 'ally', description: '同门', createdAt: now, updatedAt: now } as any)
  await db.workCharacterBindings.add({
    projectId,
    workId,
    characterId: char1,
    role: 'protagonist',
    arc: '从复仇者到守护者',
    createdAt: now,
    updatedAt: now,
  })
  const characterDrivenPlan = await db.characterDrivenPlans.add({
    projectId,
    name: '林惊羽角色驱动方案',
    arcs: JSON.stringify([{
      characterId: char1,
      name: '林惊羽',
      role: '主角',
      initialState: '孤身复仇',
      targetState: '守护同门',
    }]),
    userHint: '服务复仇主线',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.works.update(workId, { activeCharacterDrivenPlanId: characterDrivenPlan })
  await db.projects.update(projectId, {
    activeCharacterDrivenPlanId: characterDrivenPlan,
    activeWorldId: worldId,
    activeWorkId: workId,
  })

  // ── 大纲(树,wgA)+ 章节 + 细纲 + 情感卡 ──
  const vol = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: null, type: 'volume', title: '第一卷', summary: '开篇', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapNode = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: vol, type: 'chapter', title: '第1章', summary: '觉醒', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapter = await db.chapters.add({ projectId, outlineNodeId: chapNode, title: '第1章', content: '<p>废墟中睁眼</p>', wordCount: 6, status: 'draft', order: 0, createdAt: now, updatedAt: now } as any) as number
  await db.detailedOutlines.add({ projectId, outlineNodeId: chapNode, openingHook: '承接', endingCliffhanger: '黑影', appearingCharacterIds: [char1], scenes: [{ sceneId: 's1', title: '苏醒', summary: '醒来', characterIds: [char1], location: '废墟', conflict: '失忆' }], createdAt: now, updatedAt: now } as any)

  // ── WORLD-2D/2E 可执行叙事与不可变发布 ──
  const narrativeModule = await db.narrativeModules.add({
    projectId,
    kind: 'main',
    title: '青云主线',
    description: '从山门启程',
    status: 'ready',
    sourceProjection: 'outline',
    sourceRefId: chapNode,
    entryNodeKey: 'entry',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.narrativeNodes.add({
    projectId,
    moduleId: narrativeModule,
    key: 'entry',
    kind: 'entry',
    title: '踏入山门',
    summary: '从主线入口开始',
    conditionJson: '{}',
    effectsJson: '[]',
    successorKeysJson: '[]',
    sourceOutlineNodeId: chapNode,
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.works.update(workId, { activeNarrativeModuleId: narrativeModule })
  const releaseManifest = JSON.stringify({
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: 'world-full-fixture',
    worldName: '全量世界',
    workTitle: '全量作品',
    selectedTables: ['narrativeModules', 'narrativeNodes'],
    selectedNarrativeModules: [{ exportId: 0, kind: 'main', title: '青云主线' }],
    dependencies: [],
    records: {},
    portableProject: {},
  })
  const worldRevision = await db.worldRevisions.add({
    projectId,
    parentRevisionId: null,
    revision: 1,
    label: '初始修订',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldRelease = await db.worldReleases.add({
    projectId,
    revisionId: worldRevision,
    version: 1,
    label: '世界 v1',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    sourceWorldCode: 'world-full-fixture',
    createdAt: now,
  } as any) as number
  await db.emotionBeatCards.add({ projectId, chapterId: chapter, overallArc: '低落→振奋', beats: '[]', createdAt: now, updatedAt: now } as any)
  await db.cultivationProgress.add({
    projectId,
    worldGroupId: wgA,
    characterId: char1,
    characterName: '林惊羽',
    cultivationSystemId: cultivationSystem,
    cultivationSystemName: '青云剑修',
    stageId: 'qi',
    stageName: '炼气',
    transition: 'enter',
    sourceChapterId: chapter,
    sourceChapterTitle: '第1章',
    sourceQuote: '废墟中睁眼',
    sourceOffset: 0,
    trigger: '苏醒',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  })

  // ── 下游产物 ──
  await db.foreshadows.add({ projectId, name: '神秘玉佩', type: 'item', status: 'planted', description: '身世之谜', createdAt: now, updatedAt: now } as any)
  const storyArc = await db.storyArcs.add({
    projectId, type: 'main', name: '复仇线', stages: '[]', createdAt: now, updatedAt: now,
  } as any) as number
  await db.storylineProgress.add({
    projectId,
    arcId: storyArc,
    currentStageId: null,
    status: 'active',
    progressNote: '主角已开始追查旧案',
    lastActiveChapterId: chapter,
    lastActiveChapterTitle: '第1章',
    involvedEntities: JSON.stringify(['林惊羽']),
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  // 全表 FK 往返种子复用同一 Arc 覆盖 A/B 两个字段；“两端必须不同”的产品约束
  // 由 storyline-progress 领域解析/采纳测试单独锁定。
  await db.storylineCrossings.add({
    projectId,
    arcIdA: storyArc,
    arcIdB: storyArc,
    chapterId: chapter,
    chapterTitle: '第1章',
    note: '全表往返 FK 覆盖种子',
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  await db.stateCards.add({ projectId, category: 'character', entityName: '林惊羽', fields: JSON.stringify([{ key: '境界', value: '炼气一层' }]), createdAt: now, updatedAt: now } as any)
  await db.itemLedger.add({ projectId, itemName: '青锋剑', heldByName: '林惊羽', characterId: char1, action: 'gain', quantity: 1, chapterId: chapter, chapterTitle: '第1章', createdAt: now, updatedAt: now } as any)
  await db.storyTimelineEvents.add({ projectId, chapterId: chapter, title: '获得青锋剑', createdAt: now, updatedAt: now } as any)
  await db.notes.add({ projectId, title: '灵感', content: '记一笔', createdAt: now, updatedAt: now } as any)

  // ── 参考书 + 分块分析(creativeRules 引用 reference) ──
  const ref1 = await db.references.add({ projectId, title: '斗破苍穹', author: '天蚕土豆', type: 'story', note: '参考爽点', createdAt: now, updatedAt: now } as any) as number
  const referenceRun = await db.referenceAnalysisRuns.add({
    projectId, referenceId: ref1, version: 1, status: 'active', depth: 'quick',
    sourceFilename: '斗破苍穹.txt', fileHash: 'full-project-reference', totalChars: 100,
    sourceKind: 'unknown', usageScope: 'analysis-only', rightsNote: '测试种子',
    rightsConfirmed: false, rightsDeclaredAt: now, expectedChunks: 1, completedChunks: 1,
    progress: 100, completedAt: now, activatedAt: now, createdAt: now, updatedAt: now,
  } as any) as number
  await db.referenceChunkAnalysis.add({
    referenceId: ref1, analysisRunId: referenceRun, chunkIndex: 0,
    openingTechnique: '天才陨落钩子', createdAt: now, updatedAt: now,
  } as any)
  await db.creativeRules.add({ projectId, citedReferenceIds: [ref1], content: '多爽点', createdAt: now, updatedAt: now } as any)

  // ── 词条(树,wgA) ──
  const cat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: null, name: '势力', order: 0, createdAt: now, updatedAt: now } as any) as number
  const subCat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: cat, name: '宗门', order: 0, createdAt: now, updatedAt: now } as any) as number
  const codexEntry = await db.codexEntries.add({
    projectId, worldGroupId: wgA, categoryId: subCat, name: '青云宗', summary: '正道魁首',
    importantLocationId: locParent,
    createdAt: now, updatedAt: now,
  } as any) as number
  // 全表 FK 往返只验证 codexEntries ID 重映射；race 类别语义由角色关联测试单独覆盖。
  await db.characters.update(char1, { raceEntryId: codexEntry })

  // ── FB-5 文风画像 ──
  await db.userStyleProfiles.add({ projectId, profile: '简洁明快', enabled: true, createdAt: now, updatedAt: now } as any)

  // ── IDEA-1 / CM-1 增量灵感工作区 ──
  const inspirationFragmentId = 'idea-seed-old-city'
  await db.inspirationWorkspaces.add({
    projectId,
    fragments: JSON.stringify([{
      id: inspirationFragmentId,
      text: '旧城每逢暴雨都会忘记一个人',
      label: '遗忘规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: JSON.stringify([{
      id: 'idea-version-seed',
      parentVersionId: null,
      mode: 'single',
      fragmentIds: [inspirationFragmentId],
      resultJson: JSON.stringify({ storyCore: { logline: '守塔人保存被雨抹去的名字' } }),
      createdAt: now,
    }]),
    createdAt: now,
    updatedAt: now,
  })

  // ── PLATFORM-2 / AGENT-1 可审计对话事件 ──
  const agentConversation = await db.agentConversations.add({
    projectId,
    worldGroupId: wgA,
    title: '建立主世界与主角',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.agentEvents.add({
    projectId,
    conversationId: agentConversation,
    sequence: 1,
    kind: 'message',
    role: 'user',
    content: '建立主世界与主角',
    payload: '{}',
    createdAt: now,
  })
  const harnessContract = {
    version: 1,
    objective: '生成第一卷卷纲候选',
    workflowKind: 'direct-generation',
    scope: { projectId, worldGroupId: wgA, outlineNodeIds: [vol] },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'outline.terminal',
      kind: 'terminal',
      verifier: 'terminal-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
  const harnessContractHash = await hashCanonicalValue(harnessContract)
  const agentRun = await db.agentRuns.add({
    projectId,
    worldGroupId: wgA,
    conversationId: agentConversation,
    status: 'planned',
    contractVersion: 1,
    contractJson: canonicalStringify(harnessContract),
    contractHash: harnessContractHash,
    generation: 1,
    lastSequence: 0,
    projectionJson: '{}',
    projectionHash: '0'.repeat(64),
    terminalReceiptHash: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const harnessEvents: AnyAgentRunEventV1[] = [{
    version: 1 as const,
    runId: agentRun,
    sequence: 1,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'run.created' as const,
    payload: { objectiveHash: await hashCanonicalValue(harnessContract.objective) },
    createdAt: now,
  }, {
    version: 1 as const,
    runId: agentRun,
    sequence: 2,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'contract.accepted' as const,
    payload: { contractJson: canonicalStringify(harnessContract) },
    createdAt: now,
  }]
  const beforeCheckpoint = replayAgentRunEventsV1(harnessEvents)
  const checkpointProjectionBody = toAgentRunProjectionBodyV1(beforeCheckpoint)
  const checkpointProjectionHash = await hashCanonicalValue(checkpointProjectionBody)
  const checkpointHash = await hashCanonicalValue({
    version: 1,
    generation: 1,
    throughSequence: 2,
    projectionHash: checkpointProjectionHash,
    resumePayloadHash: null,
  })
  const agentRunCheckpoint = await db.agentRunCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    runId: agentRun,
    throughSequence: 2,
    generation: 1,
    contractHash: harnessContractHash,
    checkpointHash,
    projectionJson: canonicalStringify(checkpointProjectionBody),
    projectionHash: checkpointProjectionHash,
    resumePayloadJson: null,
    resumePayloadHash: null,
    createdAt: now,
  }) as number
  harnessEvents.push({
    version: 1,
    runId: agentRun,
    sequence: 3,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'checkpoint.created',
    payload: { throughSequence: 2, checkpointHash },
    createdAt: now,
  })
  await db.agentRunEvents.bulkAdd(harnessEvents.map(event => ({
    projectId: event.projectId,
    worldGroupId: event.worldGroupId,
    runId: event.runId,
    sequence: event.sequence,
    generation: event.generation,
    contractHash: event.contractHash,
    type: event.type,
    payloadJson: canonicalStringify(event.payload),
    createdAt: event.createdAt,
  })))
  const harnessProjection = replayAgentRunEventsV1(harnessEvents)
  const harnessProjectionBody = toAgentRunProjectionBodyV1(harnessProjection)
  await db.agentRuns.update(agentRun, {
    lastSequence: harnessProjection.lastSequence,
    projectionJson: canonicalStringify(harnessProjectionBody),
    projectionHash: await hashCanonicalValue(harnessProjectionBody),
  })

  // ── FLOW-2 独立节点文档与可见运行记录 ──
  const nodeFlow = await db.nodeFlows.add({
    projectId,
    worldGroupId: wgA,
    name: '主角生成图',
    description: '全表往返覆盖',
    graphJson: JSON.stringify({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.nodeRuns.add({
    projectId,
    flowId: nodeFlow,
    status: 'completed',
    inputSnapshotsJson: JSON.stringify({}),
    nodeResultsJson: JSON.stringify({}),
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  })

  // ── SIM-1 共享互动运行时（父子分支 + 事件 + 检查点） ──
  const simulationParent = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-parent',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const simulationChild = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役 · 分支',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-child',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: simulationParent,
    parentThroughSequence: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.simulationEvents.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    sequence: 1,
    type: 'narrative.recorded',
    actorKey: null,
    targetKey: null,
    payloadJson: JSON.stringify({ text: '林惊羽踏入青云山门。' }),
    createdAt: now,
  })
  await db.simulationCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    throughSequence: 1,
    name: '入山',
    stateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [{ eventSequence: 1, text: '林惊羽踏入青云山门。' }],
      lastSequence: 1,
    }),
    stateHash: 'fixture-hash',
    createdAt: now,
  })

  // ── NS-4 时序事实账本（带分类型 FK，供全表往返覆盖） ──
  const temporalFact = await db.temporalFacts.add({ projectId, worldGroupId: wgA, characterId: char1, subjectName: '林惊羽', predicate: 'powerStage', factKind: 'state', value: '炼气一层', sourceType: 'chapter', sourceChapterId: chapter, validFromChapterId: chapter, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any) as number

  // ── CONSISTENCY-2 角色认知账本（覆盖角色/章节/世界/事实四类 FK） ──
  await db.knowledgeLedger.add({
    projectId, worldGroupId: wgA, characterId: char1, characterName: '林惊羽',
    knowledgeKey: 'self.power_stage', statement: '林惊羽已达到炼气一层',
    factId: temporalFact, action: 'learn', sourceType: 'chapter', sourceChapterId: chapter,
    sourceQuote: '废墟中睁眼', status: 'confirmed', createdAt: now, updatedAt: now,
  })

  return {
    projectId, wgA, wgB, char1, char2, vol, chapNode, chapter, temporalFact, ref1,
    cat, subCat, rootWorld, mirrorWorld, locParent, cultivationSystem, codexEntry,
    characterDrivenPlan, simulationParent, simulationChild, worldId, workId,
    narrativeModule, worldRevision, worldRelease, agentRun, agentRunCheckpoint,
  }
}

/** 所有 exportable 的项目级表名(可按 projectId 查;排除 projects 与 direct-child referenceChunkAnalysis) */
export const EXPORTABLE_PROJECT_TABLES = PROJECT_TABLES
  .filter(s => s.exportable && s.name !== 'projects' && s.name !== 'referenceChunkAnalysis')
  .map(s => s.name)
