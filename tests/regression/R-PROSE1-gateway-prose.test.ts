import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import {
  beginProseGenerationGatewayStepV1,
  commitProseGenerationAdoptionV1,
  createProseGenerationDurableRunV1,
  finalizeProseGenerationGatewayStepV1,
  hashProseGenerationCandidateV1,
  persistProseGenerationCandidateV1,
  recordProseGenerationCandidateV1,
  resolveProseGenerationExecutionBindingV2,
  PROSE_GENERATION_STEP_ID_V1,
  type ProseGenerationCandidateV1,
} from '../../src/lib/agent/run/prose-generation-durable'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { normalizeProseForEditorV1, plainTextToHtml } from '../../src/lib/utils/html'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord, type WorkspaceScope } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import {
  resolveAgentSkillV1,
  validateAgentSkillContextEvidenceV1,
} from '../../src/lib/agent/skill-registry'

const now = 1_787_905_000_000

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId, createdAt: now, updatedAt: now, ...row,
  }, { owner })) as Promise<number>
}

async function seed() {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name: 'PROSE-1 潮门正文', genre: 'fantasy', genres: ['fantasy'],
    status: 'drafting', description: '', targetWordCount: 1_000_000, createdAt: now, updatedAt: now,
  } as any) as number
  const { scope } = await ensureWorkspaceOwnership(projectId)
  const groupId = await addScoped(scope, 'worldGroups', {
    name: '潮汐大陆', description: '', type: 'primary', order: 0,
  }, 'world')
  const otherGroupId = await addScoped(scope, 'worldGroups', {
    name: '镜海', description: '', type: 'parallel', order: 1,
  }, 'world')
  const volumeId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: null, type: 'volume', title: '第一卷', summary: '寻找潮钟', order: 0,
  }, 'work')
  const priorOutlineId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '镜片苏醒', order: 0,
  }, 'work')
  const targetOutlineId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '守灯人进入潮门并听见潮钟', order: 1,
  }, 'work')
  const priorChapterId = await addScoped(scope, 'chapters', {
    outlineNodeId: priorOutlineId, title: '第一章', content: '<p>镜片在潮声中苏醒，守灯人尚不知道门后的名字。</p>',
    wordCount: 24, status: 'final', order: 0, notes: '',
  }, 'work')
  const chapterId = await addScoped(scope, 'chapters', {
    outlineNodeId: targetOutlineId, title: '第二章', content: '', wordCount: 0, status: 'outline', order: 1,
    notes: '', perspectiveCharacterId: null,
  }, 'work')
  const detailId = await addScoped(scope, 'detailedOutlines', {
    outlineNodeId: targetOutlineId,
    scenes: [{ sceneId: 'scene-enter', title: '入门', summary: '守灯人穿过潮门。', characterIds: [], location: '潮门', conflict: '潮水逆流', pace: 'medium', estimatedWords: 1200 }],
    openingHook: '承接镜片苏醒。', endingCliffhanger: '潮钟说出他的旧名。', sceneLocation: '潮门',
    appearingCharacterIds: [], foreshadowIds: [], emotionArc: 'rising', prohibitions: ['不得让守灯人提前知道月井密钥'],
    lastUsedSummary: '守灯人进入潮门并听见潮钟',
  }, 'work')
  const characterId = await addScoped(scope, 'characters', {
    homeWorldGroupId: groupId, isCrossWorld: false, name: '守灯人', role: 'protagonist',
    personality: '谨慎', background: '守潮者', appearance: '', motivation: '寻找潮钟',
  }, 'world')
  await db.chapters.update(chapterId, { perspectiveCharacterId: characterId })
  const arcId = await addScoped(scope, 'storyArcs', {
    worldGroupId: groupId, name: '潮钟主线', type: 'main', description: '寻找潮钟',
    stages: JSON.stringify([{ id: 'stage-1', title: '入门', description: '进入旧城', startVolume: 1, endVolume: 1, keyEvents: ['潮钟回响'] }]),
  }, 'work')
  const progressId = await addScoped(scope, 'storylineProgress', {
    arcId, currentStageId: 'stage-1', status: 'active', progressNote: '抵达潮门',
    lastActiveChapterId: priorChapterId, lastActiveChapterTitle: '第一章', involvedEntities: '[]', evidenceQuote: '镜片在潮声中苏醒',
  }, 'work')
  const factId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: groupId, subjectName: '镜片', predicate: 'state', value: '已经苏醒', factKind: 'state',
    sourceType: 'chapter', sourceChapterId: priorChapterId, validFromChapterId: priorChapterId,
    validToChapterId: null, status: 'confirmed', locked: false,
  }, 'work')
  const otherFactId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: otherGroupId, subjectName: '镜海秘密', predicate: 'state', value: '不应泄漏', factKind: 'state',
    sourceType: 'manual', sourceChapterId: null, validFromChapterId: null, validToChapterId: null,
    status: 'confirmed', locked: false,
  }, 'work')
  const knowledgeId = await addScoped(scope, 'knowledgeLedger', {
    worldGroupId: groupId, characterId, characterName: '守灯人', knowledgeKey: 'mirror-awake',
    statement: '镜片已经苏醒', action: 'learn', sourceType: 'chapter', sourceChapterId: priorChapterId,
    status: 'confirmed',
  }, 'work')
  const moduleId = await addScoped(scope, 'narrativeModules', {
    kind: 'main', title: '潮钟蓝图', description: '主叙事蓝图', status: 'ready',
    sourceProjection: 'story-arc', sourceRefId: arcId, entryNodeKey: 'gate',
  }, 'work')
  await addScoped(scope, 'narrativeNodes', {
    moduleId, key: 'gate', kind: 'scene', title: '潮门入口', summary: '守灯人入门', conditionJson: '{}',
    effectsJson: '[]', successorKeysJson: '[]', sourceOutlineNodeId: targetOutlineId, order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeBeats', {
    moduleId, nodeKey: 'gate', beatKey: 'echo', kind: 'narration', speakerCharacterId: null, text: '潮钟回响。', order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeChoices', {
    moduleId, sourceNodeKey: 'gate', choiceKey: 'enter', text: '进入潮门', description: '', unavailableReason: '',
    targetNodeKey: 'gate', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]', order: 0,
  }, 'work')
  const foreshadowId = await addScoped(scope, 'foreshadows', {
    worldGroupId: groupId, name: '潮钟暗纹', type: 'visual', status: 'planted', description: '镜片背面有潮钟暗纹',
    plantChapterId: priorChapterId, echoChapterIds: [chapterId], resolveChapterId: null, notes: '',
  }, 'work')
  await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId })
  return {
    projectId, scope, groupId, otherGroupId, volumeId, priorOutlineId, targetOutlineId,
    priorChapterId, chapterId, detailId, characterId, arcId, progressId, factId, otherFactId,
    knowledgeId, moduleId, foreshadowId,
  }
}

async function assemblyFor(fixture: Awaited<ReturnType<typeof seed>>) {
  return prepareProseGatewayAssemblyV1({
    projectId: fixture.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.groupId,
    chapterId: fixture.chapterId,
    outlineNodeId: fixture.targetOutlineId,
    operation: 'generate',
    authorRequest: '写守灯人进入潮门，回应潮钟暗纹',
    perspectiveCharacterId: fixture.characterId,
    config: useAIConfigStore.getState().config,
  })
}

async function exactPending(fixture: Awaited<ReturnType<typeof seed>>) {
  const assembled = await assemblyFor(fixture)
  const binding = await resolveProseGenerationExecutionBindingV2({
    operation: 'generate', perspectiveCharacterId: fixture.characterId,
  })
  let snapshot = await createProseGenerationDurableRunV1({
    scope: fixture.scope, worldGroupId: fixture.groupId, chapterId: fixture.chapterId,
    operation: 'generate', perspectiveCharacterId: fixture.characterId, generationBinding: binding,
  })
  const messages = [{ role: 'user' as const, content: `受控资料：\n${assembled.text}\n\n请写第二章。` }]
  const sourceTextHash = await hashChapterText('')
  const boundary = await buildChapterInformationBoundaryV1({
    scope: fixture.scope, chapterId: fixture.chapterId, outlineNodeId: fixture.targetOutlineId,
    worldGroupId: fixture.groupId, perspectiveCharacterId: fixture.characterId,
  })
  const begun = await beginProseGenerationGatewayStepV1({
    scope: fixture.scope, snapshot, worldGroupId: fixture.groupId, chapterId: fixture.chapterId,
    outlineNodeId: fixture.targetOutlineId, assembled, messages,
    binding: {
      operation: 'generate', sourceTextHash, promptHash: await hashCanonicalValue(messages),
      informationBoundaryHash: boundary.manifestHash,
    },
  })
  snapshot = begun.snapshot
  const outputText = '守灯人穿过潮门，听见潮钟回响；他只确认镜片已经苏醒。'
  const finalized = await finalizeProseGenerationGatewayStepV1({
    scope: fixture.scope, snapshot, attempt: begun.attempt, output: outputText,
  })
  snapshot = finalized.snapshot
  const body = {
    version: 1 as const, type: 'prose-generation-candidate' as const,
    projectId: fixture.projectId, chapterId: fixture.chapterId, chapterTitle: '第二章',
    worldGroupId: fixture.groupId, operation: 'generate' as const, sourceTextHash,
    outputText, outputTextHash: await hashCanonicalValue(outputText), gatewayEvidenceVersion: 3 as const,
    expectedContentHash: await hashChapterText(outputText), informationBoundaryHash: boundary.manifestHash,
    perspectiveCharacterId: fixture.characterId, perspectiveFromChapter: true, createdAt: Date.now(),
  }
  const candidate: ProseGenerationCandidateV1 = {
    ...body,
    durable: {
      runId: snapshot.run.id, stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1,
      contextManifestHash: finalized.manifest.manifestHash,
      candidateHash: await hashProseGenerationCandidateV1(body),
    },
  }
  await persistProseGenerationCandidateV1({ scope: fixture.scope, candidate })
  snapshot = await recordProseGenerationCandidateV1({ scope: fixture.scope, snapshot, candidate })
  return { assembled, snapshot, candidate }
}

describe.sequential('PROSE-1 · 正文 Gateway 单一上下文与 exact adoption', { timeout: 20_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('正文候选含空行时，候选哈希与编辑器实际写入 HTML 使用同一规范化结果', async () => {
    const output = '潮水退去。  \r\n\r\n古钟第一次响起。\n\n'
    const normalized = normalizeProseForEditorV1(output)
    expect(normalized).toBe('潮水退去。\n古钟第一次响起。')
    expect(await hashChapterText(plainTextToHtml(normalized)))
      .toBe(await hashChapterText(normalized))
  })

  it('强制装入章纲/细纲禁止项/阶段进度/直接连续性/POV 认知/硬事实/蓝图与一致性档案，并隔离其它世界', async () => {
    const fixture = await seed()
    const assembled = await assemblyFor(fixture)
    const mandatory = new Set(assembled.contextGatewayExecution.retrievalTrace.mandatory.map(item => item.resourceKey))
    const [targetOutline, detail, priorChapter, character, arc, progress, fact, otherFact, knowledge, module, targetChapter] = await Promise.all([
      db.outlineNodes.get(fixture.targetOutlineId), db.detailedOutlines.get(fixture.detailId),
      db.chapters.get(fixture.priorChapterId), db.characters.get(fixture.characterId),
      db.storyArcs.get(fixture.arcId), db.storylineProgress.get(fixture.progressId),
      db.temporalFacts.get(fixture.factId), db.temporalFacts.get(fixture.otherFactId),
      db.knowledgeLedger.get(fixture.knowledgeId), db.narrativeModules.get(fixture.moduleId),
      db.chapters.get(fixture.chapterId),
    ])
    expect(mandatory).toContain(`outline-node:${targetOutline!.ragDocumentId}:field:summary`)
    expect(mandatory).toContain(`detailed-outline:${detail!.ragDocumentId}:field:prohibitions`)
    expect(mandatory).toContain(`chapter:${priorChapter!.ragDocumentId}:continuity-tail`)
    expect(mandatory).toContain(`character:${character!.ragDocumentId}`)
    expect(mandatory).toContain(`story-arc:${arc!.ragDocumentId}`)
    expect(mandatory).toContain(`storyline-progress:${progress!.ragDocumentId}`)
    expect(mandatory).toContain(`fact:${fact!.ragDocumentId}`)
    expect(mandatory).toContain(`fact:${knowledge!.ragDocumentId}`)
    expect(mandatory).toContain(`narrative-blueprint:${module!.ragDocumentId}`)
    expect(mandatory).toContain(`chapter:${targetChapter!.ragDocumentId}:consistency-dossier`)
    expect([...mandatory].some(key => key.includes(otherFact!.ragDocumentId!))).toBe(false)
    expect(assembled.text).toContain('长期一致性档案')
    expect(assembled.text).toContain('原文尾部（最多 4000 字符）')
    expect(assembled.text).toContain('不得让守灯人提前知道月井密钥')
    expect(assembled.text).not.toContain('不应泄漏')
    expect(assembled.sourceEvidence?.map(item => item.key)).toEqual(['ragSelection'])
    expect(assembled.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeBeats')).toBe(true)
    expect(assembled.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeChoices')).toBe(true)
  })

  it('主 Agent 正文候选把 Gateway 实际来源写入输入状态证据并通过严格 Skill 校验', async () => {
    const fixture = await seed()
    await db.projects.update(fixture.projectId, { enableMultiWorld: true })
    const prepared = await prepareProseCopilot({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      authorRequest: '写第二章正文',
      skillId: 'prose.generate',
      perspectiveCharacterId: fixture.characterId,
    })
    expect(prepared.contextEvidence.inputStateSourceKeys).toEqual(expect.arrayContaining([
      'chapterOutline', 'detailedOutline', 'storyArcs', 'storylineProgress',
      'activeNarrativeBlueprint', 'chapterContinuityHandoff', 'characterKnowledge',
      'currentFacts', 'consistencyDossier',
    ]))
    expect(() => validateAgentSkillContextEvidenceV1(
      resolveAgentSkillV1('prose', 'prose.generate'),
      prepared.contextEvidence,
    )).not.toThrow()
  })

  it('ContextManifestV3 候选可采纳；任一必读来源变化都会在写正文前阻断旧候选', async () => {
    const successFixture = await seed()
    const success = await exactPending(successFixture)
    expect(success.candidate.gatewayEvidenceVersion).toBe(3)
    expect(success.snapshot.projection.state).toBe('awaiting_confirmation')
    const adopted = await commitProseGenerationAdoptionV1({
      scope: successFixture.scope, runId: success.candidate.durable.runId, candidate: success.candidate,
      contentHtml: `<p>${success.candidate.outputText}</p>`, wordCount: success.candidate.outputText.length,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await db.chapters.get(successFixture.chapterId))?.content).toContain('守灯人穿过潮门')

    await db.delete(); await db.open()
    const staleFixture = await seed()
    const stale = await exactPending(staleFixture)
    await db.detailedOutlines.update(staleFixture.detailId, {
      prohibitions: ['作者新增：不得让潮钟说出守灯人的旧名'], updatedAt: now + 1,
    })
    await expect(commitProseGenerationAdoptionV1({
      scope: staleFixture.scope, runId: stale.candidate.durable.runId, candidate: stale.candidate,
      contentHtml: `<p>${stale.candidate.outputText}</p>`, wordCount: stale.candidate.outputText.length,
    })).rejects.toThrow(/stale|过期|content-stale/)
    expect((await db.chapters.get(staleFixture.chapterId))?.content).toBe('')
  })
})
