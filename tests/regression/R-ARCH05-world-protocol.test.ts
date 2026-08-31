import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeWorldReleaseV1, listAllWorldReleaseResourceDescriptorsV1 } from '../../src/lib/context-gateway/world-release-provider'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import {
  CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1,
  TTRPG_WORLD_REQUIREMENT_ADAPTER_V1,
} from '../../src/lib/world-engine/product-requirement-adapters'
import {
  freezeProductSourcePlanV1,
  resolveProductSourceReadBoundaryV1,
  validateProductSourcePlanV1,
  worldReferenceResourceScopeV1,
} from '../../src/lib/world-engine/product-source-contracts'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import {
  createWorldReferenceV1,
  rebindWorldReferenceV1,
  validateWorldReferenceV1,
} from '../../src/lib/world-engine/world-reference'

async function fixture() {
  const created = await createWorkspace({
    name: 'ARCH-05 中立世界协议',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  await db.worldviews.add(stampNewRecord(created.scope, 'worldviews', {
    projectId: created.scope.projectId,
    summary: '潮汐世界由月相法则维持。',
    worldOrigin: '双月牵引海陆。',
    geography: '群岛与潮门',
    history: '', society: '', culture: '', economy: '', rules: '满月时潮门开启', races: '潮民',
    createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const characters = await db.characters.bulkAdd([
    stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId,
      name: '守潮人', role: 'protagonist', roleWeight: 'main', shortDescription: '守卫潮门',
      background: '熟悉月相法则', personality: '谨慎', createdAt: now, updatedAt: now,
    } as any, { owner: 'world' }),
    stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId,
      name: '渡海者', role: 'supporting', roleWeight: 'secondary', shortDescription: '寻找失落群岛',
      background: '来自外海', personality: '果决', createdAt: now + 1, updatedAt: now + 1,
    } as any, { owner: 'world' }),
  ], { allKeys: true }) as number[]
  await db.characterRelations.add(stampNewRecord(created.scope, 'characterRelations', {
    projectId: created.scope.projectId,
    fromCharacterId: characters[0], toCharacterId: characters[1], relationType: 'ally',
    label: '临时同盟', description: '共同调查潮门失控。', isBidirectional: true,
    createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const revision = await createWorldRevision({ scope: created.scope, label: '中立协议 release' })
  const release = await publishWorldRevision(revision.id!)
  const reference = await createWorldReferenceV1(release.id!)
  const resourceScope = await worldReferenceResourceScopeV1(reference)
  return { ...created, release, reference, resourceScope }
}

describe('ARCH-05 · 中立 WorldRelease Gateway 与产品需求适配器', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只公开语义坐标，并让同一 release 产生两份不同、可验证的产品计划', async () => {
    const owned = await fixture()
    const description = await describeWorldReleaseV1(owned.resourceScope)
    const descriptors = await listAllWorldReleaseResourceDescriptorsV1(owned.resourceScope)
    expect(description.worldReference.referenceHash).toBe(owned.reference.referenceHash)
    expect(JSON.stringify(description)).not.toContain('selectedTables')
    expect(JSON.stringify(description)).not.toContain('"table"')
    expect(description.resources.every(item => item.resourceId.includes(':semantic:'))).toBe(true)
    expect(descriptors.length).toBeGreaterThanOrEqual(3)
    expect(descriptors.every(item => item.sourceKey === 'worldRelease')).toBe(true)
    expect(descriptors.every(item => !item.resourceKey.includes(':table:'))).toBe(true)

    const worldviewKey = descriptors.find(item => item.worldSemantic?.resourceKind === 'worldview')!.resourceKey
    const ttrpg = await freezeProductSourcePlanV1({
      productInstanceKey: 'campaign:tide-gate-investigation',
      worldReference: owned.reference,
      adapter: TTRPG_WORLD_REQUIREMENT_ADAPTER_V1,
      goal: { allowCrossWorld: false, useManuscriptContinuity: false, investigationHeavy: true },
      missingStrategy: 'block',
      initialResourceKeys: [worldviewKey],
      createdAt: 10,
    })
    const chat = await freezeProductSourcePlanV1({
      productInstanceKey: 'chat:tide-keeper',
      worldReference: owned.reference,
      adapter: CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1,
      goal: { participantCount: 1, inheritStoryContinuity: false, allowCrossWorld: false },
      missingStrategy: 'block',
      createdAt: 10,
    })
    expect(ttrpg.readiness).toBe('ready')
    expect(chat.readiness).toBe('ready')
    expect(ttrpg.adapter.adapterId).not.toBe(chat.adapter.adapterId)
    expect(ttrpg.planHash).not.toBe(chat.planHash)
    expect(ttrpg.requirements.map(item => item.key)).toContain('investigation-evidence')
    expect(chat.requirements.map(item => item.key)).toContain('conversation-cast')
    expect(ttrpg.permission.allowedSelectors).not.toEqual(chat.permission.allowedSelectors)
    expect(ttrpg.initialResourceKeys).toEqual([worldviewKey])

    const boundary = await resolveProductSourceReadBoundaryV1(chat)
    expect(boundary.allowedResourceKeys.length).toBeGreaterThanOrEqual(2)
    expect(boundary.mandatoryResourceKeys).toHaveLength(1)
    expect(boundary.mandatoryFullResourceKeys).toEqual(boundary.mandatoryResourceKeys)
    const gateway = await executeContextGatewayV1({
      skill: getAgentSkillV1('character.interaction-production-step.v1'),
      scope: owned.scope,
      resourceScope: boundary.sourceScope,
      accessPolicyOverride: chat.gatewayPolicy,
      allowedResourceKeys: boundary.allowedResourceKeys,
      mandatoryResourceKeys: boundary.mandatoryResourceKeys,
      mandatoryFullResourceKeys: boundary.mandatoryFullResourceKeys,
      additionalReadsEnabled: false,
    })
    expect(gateway.session.policyHash).toBe(chat.gatewayPolicyHash)
    expect(gateway.selector.selected.every(item => boundary.allowedResourceKeys.includes(item.resourceKey))).toBe(true)
    expect(boundary.mandatoryResourceKeys.every(key => (
      gateway.retrievalTrace.mandatory.some(item => item.resourceKey === key)
    ))).toBe(true)
  })

  it('WorldReference 与 SourcePlan 的便携 hash 不随导入后的本地 ID 重映射改变', async () => {
    const owned = await fixture()
    const plan = await freezeProductSourcePlanV1({
      productInstanceKey: 'chat:portable',
      worldReference: owned.reference,
      adapter: CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1,
      goal: { participantCount: 1, inheritStoryContinuity: false, allowCrossWorld: false },
      missingStrategy: 'block',
      createdAt: 10,
    })
    const stored = (await db.worldReleases.get(owned.release.id!))!
    const { id: _oldId, ...portableRelease } = stored
    const reboundId = await db.worldReleases.add(portableRelease)
    const reboundReference = await rebindWorldReferenceV1({
      reference: owned.reference,
      localReleaseRecordId: reboundId,
    })
    expect(reboundReference.localReleaseRecordId).not.toBe(owned.reference.localReleaseRecordId)
    expect(reboundReference.referenceHash).toBe(owned.reference.referenceHash)
    const reboundPlan = { ...plan, worldReference: reboundReference }
    await expect(validateProductSourcePlanV1(reboundPlan)).resolves.toEqual(reboundPlan)
    expect(reboundPlan.planHash).toBe(plan.planHash)
  })

  it('拒绝可变草稿冒充冻结来源以及 release ID/hash 任一侧漂移', async () => {
    const owned = await fixture()
    await expect(validateWorldReferenceV1({
      ...owned.reference,
      releaseHash: 'f'.repeat(64),
    })).rejects.toThrow('不再同时匹配')
    await db.worldviews.toCollection().modify({ summary: '草稿已变化但 release 不变' })
    await expect(validateWorldReferenceV1(owned.reference)).resolves.toEqual(owned.reference)
    const frozen = await describeWorldReleaseV1(owned.resourceScope)
    expect(JSON.stringify(frozen)).not.toContain('草稿已变化')
  })
})
