import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  buildLongFormScaleGateArtifactV1,
  LONG_FORM_SCALE_TIERS_V1,
  verifyLongFormScaleGateArtifactV1,
  type LongFormScaleTierV1,
} from '../../src/lib/evals'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { stampNewRecord, type WorkspaceScope } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const NOW = 1_788_500_000_000
const CHAPTERS_BY_TIER: Readonly<Record<LongFormScaleTierV1, number>> = {
  100_000: 50,
  300_000: 150,
  1_000_000: 500,
}
const FIXTURE_SET = {
  version: 'phase4-long-form-scale-fixtures-v1',
  tiers: LONG_FORM_SCALE_TIERS_V1,
  chapterCounts: CHAPTERS_BY_TIER,
  evidence: ['early-fact', 'middle-foreshadow', 'recent-tail', 'perspective-knowledge', 'active-blueprint', 'target-detail'],
  isolation: ['other-world', 'future-outline'],
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId,
    createdAt: NOW,
    updatedAt: NOW,
    ...row,
  }, { owner })) as Promise<number>
}

function chapterBody(index: number, minimumCharacters: number): string {
  const sentence = `第${index}章的潮汐巡航记录保持人物位置、物品归属、公开承诺与事件因果，不提前泄露下一章。`
  return `<p>${sentence.repeat(Math.ceil(minimumCharacters / sentence.length))}</p>`
}

async function seedScale(tier: LongFormScaleTierV1) {
  const { scope } = await seedCurrentWorkspace(`PHASE4 ${tier} 字符封闭规模门`, {
    enableMultiWorld: true,
  })
  const { projectId } = scope
  await db.works.update(scope.workId, { targetWordCount: tier, updatedAt: NOW })
  const groupId = await addScoped(scope, 'worldGroups', {
    name: '潮汐大陆', description: '当前测试世界', type: 'primary', order: 0,
  }, 'world')
  const otherGroupId = await addScoped(scope, 'worldGroups', {
    name: '镜海隔离世界', description: '不得进入当前正文', type: 'parallel', order: 1,
  }, 'world')
  const volumeId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: null, type: 'volume', title: '长篇规模卷', summary: '跨越远距事实的持续航行', order: 0,
  }, 'work')
  const chapterCount = CHAPTERS_BY_TIER[tier]
  const perChapter = Math.ceil((tier + chapterCount * 100) / chapterCount)
  const written: Array<{ chapterId: number; outlineId: number; content: string }> = []
  for (let index = 1; index <= chapterCount; index += 1) {
    const outlineId = await addScoped(scope, 'outlineNodes', {
      worldGroupId: groupId,
      parentId: volumeId,
      type: 'chapter',
      title: `第${index}章`,
      summary: `潮汐巡航第${index}站`,
      order: index - 1,
    }, 'work')
    const recentMarker = index === chapterCount ? '最近连续性标记：银潮钟已在上一章停止鸣响。' : ''
    const content = chapterBody(index, perChapter) + recentMarker
    const chapterId = await addScoped(scope, 'chapters', {
      outlineNodeId: outlineId,
      title: `第${index}章`,
      content,
      wordCount: content.replace(/<[^>]+>/g, '').length,
      status: 'final',
      order: index - 1,
      notes: '',
    }, 'work')
    written.push({ chapterId, outlineId, content })
  }

  const targetOutlineId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId,
    parentId: volumeId,
    type: 'chapter',
    title: `第${chapterCount + 1}章`,
    summary: '主角遵守星砂钥规则，回应蓝羽誓约并调查停止的银潮钟。',
    order: chapterCount,
  }, 'work')
  const targetChapterId = await addScoped(scope, 'chapters', {
    outlineNodeId: targetOutlineId,
    title: `第${chapterCount + 1}章`,
    content: '',
    wordCount: 0,
    status: 'outline',
    order: chapterCount,
    notes: '',
  }, 'work')
  await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId,
    parentId: volumeId,
    type: 'chapter',
    title: `第${chapterCount + 2}章`,
    summary: '未来泄漏标记：黑曜王已经复活。',
    order: chapterCount + 1,
  }, 'work')

  const detailId = await addScoped(scope, 'detailedOutlines', {
    outlineNodeId: targetOutlineId,
    scenes: [{
      sceneId: 'phase4-target-scene', title: '钟楼调查', summary: '目标细纲标记：先核对银潮钟，再决定是否使用星砂钥。',
      characterIds: [], location: '银潮钟楼', conflict: '公开承诺与救援时限冲突', pace: 'medium', estimatedWords: 2200,
    }],
    openingHook: '承接银潮钟停止鸣响。',
    endingCliffhanger: '蓝羽誓约出现新的见证人。',
    sceneLocation: '银潮钟楼', appearingCharacterIds: [], foreshadowIds: [],
    emotionArc: '克制到决断', prohibitions: ['不得让黑曜王提前复活'],
    lastUsedSummary: '调查银潮钟并回应旧誓约',
  }, 'work')

  const characterId = await addScoped(scope, 'characters', {
    homeWorldGroupId: groupId, isCrossWorld: false, name: '林舟',
    roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
    personality: '谨慎守信', background: '守灯人', appearance: '左手有潮纹', motivation: '阻止潮门崩塌',
  }, 'world')
  await db.chapters.update(targetChapterId, { perspectiveCharacterId: characterId })
  const arcId = await addScoped(scope, 'storyArcs', {
    worldGroupId: groupId, name: '银潮钟主线', type: 'main', description: '追查银潮钟停摆',
    stages: JSON.stringify([{ id: 'phase4-stage', title: '钟楼停摆', description: '银潮钟停止鸣响后必须先查明原因', startVolume: 1, endVolume: 1, keyEvents: ['林舟进入钟楼'] }]),
  }, 'work')
  await addScoped(scope, 'storylineProgress', {
    arcId, currentStageId: 'phase4-stage', status: 'active', progressNote: '已抵达银潮钟楼',
    lastActiveChapterId: written.at(-1)!.chapterId, lastActiveChapterTitle: `第${chapterCount}章`,
    involvedEntities: JSON.stringify(['林舟', '银潮钟']), evidenceQuote: '银潮钟已在上一章停止鸣响。',
  }, 'work')
  const earlyFactId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: groupId, subjectName: '星砂钥', predicate: 'activation-rule', factKind: 'state',
    value: '远距硬事实标记：星砂钥只能由守灯人在无月之夜启用。', sourceType: 'chapter',
    sourceChapterId: written[0].chapterId, validFromChapterId: written[0].chapterId,
    validToChapterId: null, status: 'confirmed', locked: true,
  }, 'work')
  const otherFactId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: otherGroupId, subjectName: '镜海王', predicate: 'secret', factKind: 'state',
    value: '其它世界泄漏标记：镜海王持有第二把星砂钥。', sourceType: 'manual',
    sourceChapterId: null, validFromChapterId: null, validToChapterId: null, status: 'confirmed', locked: true,
  }, 'work')
  const knowledgeId = await addScoped(scope, 'knowledgeLedger', {
    worldGroupId: groupId, characterId, characterName: '林舟', knowledgeKey: 'silver-bell-stopped',
    statement: '角色认知标记：林舟只知道银潮钟停摆，不知道幕后人物。', action: 'learn',
    sourceType: 'chapter', sourceChapterId: written.at(-1)!.chapterId, status: 'confirmed',
  }, 'work')
  const middle = written[Math.floor(written.length / 2)]
  const foreshadowId = await addScoped(scope, 'foreshadows', {
    worldGroupId: groupId, name: '蓝羽誓约', type: 'dialogue', status: 'planted',
    description: '中段伏笔标记：蓝羽誓约要求守灯人在钟声停下时公开真相。',
    plantChapterId: middle.chapterId, echoChapterIds: [targetChapterId], resolveChapterId: null, notes: '',
  }, 'work')
  await db.detailedOutlines.update(detailId, { foreshadowIds: [foreshadowId] })

  const moduleId = await addScoped(scope, 'narrativeModules', {
    kind: 'main', title: '银潮钟叙事蓝图', description: '激活蓝图标记：本章必须以公开选择结束。',
    status: 'ready', sourceProjection: 'story-arc', sourceRefId: arcId, entryNodeKey: 'bell-tower',
  }, 'work')
  await addScoped(scope, 'narrativeNodes', {
    moduleId, key: 'bell-tower', kind: 'scene', title: '钟楼入口', summary: '林舟调查停摆的银潮钟',
    conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', sourceOutlineNodeId: targetOutlineId, order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeBeats', {
    moduleId, nodeKey: 'bell-tower', beatKey: 'public-choice', kind: 'choice', speakerCharacterId: characterId,
    text: '公开真相或先救援。', order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeChoices', {
    moduleId, sourceNodeKey: 'bell-tower', choiceKey: 'disclose', text: '公开潮钟真相', description: '',
    unavailableReason: '', targetNodeKey: 'bell-tower', displayConditionJson: '{}', availableConditionJson: '{}',
    effectsJson: '[]', tagsJson: '[]', order: 0,
  }, 'work')
  await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId })

  const manuscriptCharacters = written.reduce((sum, item) => (
    sum + item.content.replace(/<[^>]+>/g, '').length
  ), 0)
  return {
    projectId, scope, groupId, targetOutlineId, targetChapterId, chapterCount, manuscriptCharacters,
    detailId, characterId, earlyFactId, otherFactId, knowledgeId, foreshadowId, moduleId,
    previousChapterId: written.at(-1)!.chapterId,
  }
}

describe.sequential('PHASE4 · 10万/30万/100万字符分步骤正文封闭规模门', { timeout: 60_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  for (const tier of LONG_FORM_SCALE_TIERS_V1) {
    it(`${tier} 字符规模仍以有界 Packet 召回远中近证据并隔离未来/错世界`, async () => {
      const fixture = await seedScale(tier)
      const startedAt = performance.now()
      const assembly = await prepareProseGatewayAssemblyV1({
        projectId: fixture.projectId,
        scope: fixture.scope,
        worldGroupId: fixture.groupId,
        chapterId: fixture.targetChapterId,
        outlineNodeId: fixture.targetOutlineId,
        operation: 'generate',
        authorRequest: '写林舟调查银潮钟、核对星砂钥规则并回应蓝羽誓约的下一章。',
        perspectiveCharacterId: fixture.characterId,
        config: useAIConfigStore.getState().config,
      })
      const durationMs = performance.now() - startedAt
      const fixtureSetHash = await hashCanonicalValue(FIXTURE_SET)
      const artifact = await buildLongFormScaleGateArtifactV1({
        fixtureId: `phase4-${tier}-v1`,
        fixtureSetHash,
        tierCharacters: tier,
        manuscriptCharacters: fixture.manuscriptCharacters,
        chapterCount: fixture.chapterCount,
        assemblyDurationMs: durationMs,
        execution: assembly.contextGatewayExecution,
        requiredEvidence: [
          { id: 'early-fact', table: 'temporalFacts', recordId: fixture.earlyFactId, expectedText: '远距硬事实标记' },
          { id: 'middle-foreshadow', table: 'foreshadows', recordId: fixture.foreshadowId, expectedText: '中段伏笔标记' },
          { id: 'recent-tail', table: 'chapters', recordId: fixture.previousChapterId, field: 'content', expectedText: '最近连续性标记' },
          { id: 'perspective-knowledge', table: 'knowledgeLedger', recordId: fixture.knowledgeId, expectedText: '角色认知标记' },
          { id: 'active-blueprint', table: 'narrativeModules', recordId: fixture.moduleId, expectedText: '激活蓝图标记' },
          { id: 'target-detail', table: 'detailedOutlines', recordId: fixture.detailId, expectedText: '目标细纲标记' },
        ],
        forbiddenText: ['其它世界泄漏标记', '未来泄漏标记'],
      })
      expect(artifact.status, artifact.checks.filter(check => !check.passed)).toBe('pass')
      expect(await verifyLongFormScaleGateArtifactV1(artifact)).toBe(true)
      expect(artifact.measurements.packetTokens).toBeLessThanOrEqual(64_000)
      expect(artifact.measurements.manuscriptCharacters).toBeGreaterThanOrEqual(tier)
      expect(artifact.measurements.additionalPlanningModelCalls).toBe(0)
    })
  }

  it('artifact 或检查结论被篡改后不能通过验签', async () => {
    const fixture = await seedScale(100_000)
    const assembly = await prepareProseGatewayAssemblyV1({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.groupId,
      chapterId: fixture.targetChapterId, outlineNodeId: fixture.targetOutlineId, operation: 'generate',
      authorRequest: '写林舟核对星砂钥规则。', perspectiveCharacterId: fixture.characterId,
      config: useAIConfigStore.getState().config,
    })
    const artifact = await buildLongFormScaleGateArtifactV1({
      fixtureId: 'phase4-tamper-v1', fixtureSetHash: await hashCanonicalValue(FIXTURE_SET),
      tierCharacters: 100_000, manuscriptCharacters: fixture.manuscriptCharacters,
      chapterCount: fixture.chapterCount, assemblyDurationMs: 1,
      execution: assembly.contextGatewayExecution,
      requiredEvidence: [{
        id: 'early-fact', table: 'temporalFacts', recordId: fixture.earlyFactId, expectedText: '远距硬事实标记',
      }],
      forbiddenText: ['其它世界泄漏标记'],
    })
    artifact.measurements.packetTokens += 1
    expect(await verifyLongFormScaleGateArtifactV1(artifact)).toBe(false)
  })
})
