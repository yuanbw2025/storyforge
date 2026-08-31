import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import { loadCharacterInteractionWorldSourceCatalogV1 } from '../../src/lib/character-interaction/world-source'
import {
  confirmCharacterInteractionBriefV1,
  createCharacterInteractionProductionV1,
  readCharacterInteractionProductionContextV1,
} from '../../src/lib/character-interaction/production'
import {
  confirmCharacterInteractionStepCandidateV1,
  prepareCharacterInteractionStepDraftV1,
  type CharacterInteractionCapsulesArtifactV1,
} from '../../src/lib/character-interaction/production-pipeline'
import { runCharacterInteractionProductionStepV1 } from '../../src/lib/character-interaction/production-harness'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'

async function fixture() {
  let stage = 'create-workspace'
  try {
  const now = Date.now()
  const owned = await createWorkspace({
    name: '角色互动 AI 生产', genre: 'drama', genres: ['drama'], status: 'drafting',
    description: 'durable Harness', targetWordCount: 10_000, createdAt: now, updatedAt: now,
  } as any, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const projectId = owned.scope.projectId
  stage = 'seed-character'
  await db.characters.add(stampNewRecord(owned.scope, 'characters', {
    projectId, name: '岑星', role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '旧港停战后的守灯人。', appearance: '', personality: '克制', background: '守潮灯塔居民',
    motivation: '保护旧友', abilities: '', relationships: '[]', arc: '学习重新信任', speechStyle: '短句、留白',
    createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  stage = 'create-world-revision'
  const revision = await createWorldRevision({ scope: owned.scope, label: 'AI 生产来源' })
  stage = 'publish-world-revision'
  const release = await publishWorldRevision(revision.id!, 'AI 生产来源 v1')
  stage = 'load-world-catalog'
  const catalog = await loadCharacterInteractionWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: release.id! })
  stage = 'create-product'
  const created = await createCharacterInteractionProductionV1({
    scope: owned.scope,
    productionKey: 'ai-production-chat',
    worldReleaseId: release.id!,
    participantCharacterExportIds: catalog.records.characters!.map(item => item.exportId),
    brief: {
      title: '灯塔重逢', userInstruction: '突出角色克制的表达和旧友间的未尽之言。', userRole: 'self',
      storyMode: 'new-event', timeContext: '终局十年后', locationContext: '守潮灯塔', historicalContext: '战争已经结束。',
      chatGoal: '谈清一封旧信。', desiredDirections: ['从近况进入旧事'], safetyBoundaries: ['不推翻终局'],
      publicKnowledge: ['战争已结束'], privateKnowledge: ['旧信仍未拆'], prohibitedDisclosure: ['未询问前不揭露署名'],
      sceneCount: 1, maxTurnsPerScene: 30, directorBudget: 6, endingStrategy: 'user-decides', mediaTier: 'text-core',
      allowWorldFeedbackCandidate: false,
    },
  })
  stage = 'confirm-brief'
  const confirmed = await confirmCharacterInteractionBriefV1({ scope: owned.scope, productionId: created.production.id })
  return { ...owned, projectId, confirmed }
  } catch (error) {
    throw new Error(`[CHATGAME-3E fixture:${stage}] ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

describe('CHATGAME-3E · 角色互动正式 AI 生产 Harness', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只经登记冻结上下文生成候选，协议失败可修复且候选仍等待作者确认', async () => {
    const owned = await fixture()
    const base = await prepareCharacterInteractionStepDraftV1({
      scope: owned.scope, productionId: owned.confirmed.production.id, stepKey: 'character-capsules',
    }) as CharacterInteractionCapsulesArtifactV1
    let calls = 0
    const valid = JSON.stringify({
      schema: 'storyforge.character-interaction-ai-step-proposal', version: 1, stepKey: 'character-capsules',
      proposal: {
        refinements: base.capsules.map(item => ({
          participantKey: item.participantKey,
          identitySummary: `${item.identitySummary} 她把旧信藏在灯室最下层。`,
          voiceRules: '用短句和停顿表达克制；不知道的事明确说不知道。',
          publicStance: '愿意谈当下生活，但不主动解释旧信。',
          privateAnchor: '害怕真相再次伤害旧友。',
        })),
      },
    })
    const result = await runCharacterInteractionProductionStepV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
      stepKey: 'character-capsules',
      authorDirection: '保留克制感。',
      runAI: async () => (++calls === 1 ? '{"bad":true}' : valid),
    })
    expect(calls).toBe(2)
    expect(result.repairApplied).toBe(true)
    expect(result.artifact).toMatchObject({ status: 'candidate', producerRunId: result.snapshot.run.id })
    expect(JSON.parse(result.artifact.payloadJson).capsules[0].voiceRules).toContain('不知道')
    expect(result.snapshot.projection.state).toBe('completed')
    const events = await db.agentRunEvents.where('runId').equals(result.snapshot.run.id).toArray()
    const manifests = events.filter(event => event.type === 'context.assembled')
    expect(manifests).toHaveLength(2)
    for (const attempt of [1, 2]) {
      const restored = await readContextGatewayManifestV3ForAttemptV1({
        scope: owned.scope,
        runId: result.snapshot.run.id,
        stepId: 'character-interaction:production-candidate',
        attempt,
      })
      expect(restored.manifest.version).toBe(3)
      expect(restored.manifest.gateway.retrievalTrace.mandatory.length).toBeGreaterThan(0)
      expect(restored.manifest.gateway.retrievalTrace.mandatory.every(item => item.sourceKey === 'worldRelease')).toBe(true)
    }
    const productContext = await readCharacterInteractionProductionContextV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
    })
    expect(productContext).not.toContain('selectedWorldRecords')
    expect(productContext).toContain('世界语义正文不在此来源中')
    const persistedStep = await db.characterInteractionProductionSteps.where('productionId').equals(owned.confirmed.production.id).first()
    expect(persistedStep).toMatchObject({ status: 'awaiting-confirmation', producerRunId: result.snapshot.run.id })
    await confirmCharacterInteractionStepCandidateV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
      artifactId: result.artifact.id!,
    })
    expect((await db.characterInteractionArtifacts.get(result.artifact.id!))?.status).toBe('confirmed')
  }, 30_000)

  it('两次越界协议都失败时不创建产品候选，但保留失败 Run 证据', async () => {
    const owned = await fixture()
    await expect(runCharacterInteractionProductionStepV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
      stepKey: 'character-capsules',
      runAI: async () => '{"schema":"wrong"}',
    })).rejects.toThrow('字段不精确')
    expect(await db.characterInteractionArtifacts.where('productionId').equals(owned.confirmed.production.id).count()).toBe(0)
    expect(await db.characterInteractionProductionSteps.where('productionId').equals(owned.confirmed.production.id).count()).toBe(0)
    const run = await db.agentRuns.where('projectId').equals(owned.projectId).last()
    expect(run).toBeTruthy()
    const events = await db.agentRunEvents.where('runId').equals(run!.id!).toArray()
    expect(events.some(event => event.type === 'run.failed')).toBe(true)
  }, 30_000)
})
