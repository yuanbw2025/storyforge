import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  describeWorldReleaseV1,
  listAllWorldReleaseResourceDescriptorsV1,
  readWorldOriginalEvidenceV1,
  readWorldResourceV1,
  searchWorldReleaseV1,
} from '../../src/lib/context-gateway/world-release-provider'
import { db } from '../../src/lib/db/schema'
import type { WorldReleaseManifestV3 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldReferenceV1, resolveWorldReferenceResourceScopeV1 } from '../../src/lib/world-engine/world-reference'

async function phaseDFixture(characterCount = 0) {
  const created = await createWorkspace({
    name: 'Phase D 世界引擎', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '多世界与大规模语义目录', targetWordCount: 0, enableMultiWorld: true,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = 1_788_100_000_000
  await db.worldviews.add(stampNewRecord(created.scope, 'worldviews', {
    projectId: created.scope.projectId, summary: '双月潮汐世界', worldOrigin: '双月塑造潮门',
    races: '潮民与羽民', createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  await db.geographies.add(stampNewRecord(created.scope, 'geographies', {
    projectId: created.scope.projectId, overview: '群岛', locations: '[]', worldMapData: '',
    createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  await db.worldRulesProfiles.add(stampNewRecord(created.scope, 'worldRulesProfiles', {
    projectId: created.scope.projectId, entries: {}, customNodes: [], globalNote: '潮门随月相开启',
    createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const primary = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
    projectId: created.scope.projectId, name: '镜海', description: '主世界', type: 'primary',
    entryCondition: '', exitCondition: '敲响潮钟', powerRestriction: '', takeawayRules: '',
    icon: '🌊', order: 0, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  const parallel = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
    projectId: created.scope.projectId, name: '盐庭', description: '平行世界', type: 'parallel',
    entryCondition: '交出一段真名记忆', exitCondition: '等待无月夜', powerRestriction: '火焰失效',
    takeawayRules: '只可带出记忆', icon: '🧂', order: 1, createdAt: now + 1, updatedAt: now + 1,
  } as any, { owner: 'world' })) as number
  await db.worldGroupLinks.add(stampNewRecord(created.scope, 'worldGroupLinks', {
    projectId: created.scope.projectId, fromGroupId: primary, toGroupId: parallel,
    linkType: 'portal', name: '退潮镜门', description: '第三次退潮时显形', bidirectional: true,
    createdAt: now + 2, updatedAt: now + 2,
  } as any, { owner: 'world' }))
  for (const [index, status] of ['confirmed', 'candidate', 'stale'].entries()) {
    await db.temporalFacts.add(stampNewRecord(created.scope, 'temporalFacts', {
      projectId: created.scope.projectId, subjectName: `潮门事实-${status}`, predicate: 'location_status',
      factKind: 'attribute', value: status, sourceType: 'manual', status, locked: status === 'confirmed',
      createdAt: now + 10 + index, updatedAt: now + 10 + index,
    } as any, { owner: 'work' }))
  }
  if (characterCount > 0) {
    const rows = Array.from({ length: characterCount }, (_, index) => stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId,
      name: `规模角色-${String(index).padStart(4, '0')}`,
      role: index === 0 ? 'protagonist' : 'supporting', roleWeight: index === 0 ? 'main' : 'secondary',
      shortDescription: `第 ${index} 位潮门记录者`, background: '出生于群岛', personality: '谨慎',
      appearance: '', motivation: '', abilities: '', relationships: '[]', arc: '',
      createdAt: now + 100 + index, updatedAt: now + 100 + index,
    } as any, { owner: 'world' }))
    await db.characters.bulkAdd(rows)
  }
  const revision = await createWorldRevision({ scope: created.scope, label: 'Phase D 完整语义版本' })
  const release = await publishWorldRevision(revision.id!)
  const reference = await createWorldReferenceV1(release.id!)
  const resourceScope = await resolveWorldReferenceResourceScopeV1(reference)
  return { ...created, release, reference, resourceScope }
}

describe('D-WORLD · 完整世界引擎版本、画像、关系与规模出口', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Release 只封存确认 Canon，同时诚实报告候选、冲突与证据/索引能力', async () => {
    const owned = await phaseDFixture()
    const manifest = JSON.parse(owned.release.manifestJson) as WorldReleaseManifestV3
    const story = manifest.capabilityProfile!.find(item => item.area === 'story')!
    const facts = manifest.resourceCatalog!.find(item => item.resourceKind === 'temporal-fact')!
    expect(story).toMatchObject({
      confirmedRowCount: 1,
      candidateRowCount: 1,
      conflictRowCount: 1,
      originalEvidenceAvailable: true,
      queryableIndexAvailable: true,
    })
    expect(facts).toMatchObject({ rowCount: 1, confirmedRowCount: 1, candidateRowCount: 1, conflictRowCount: 1 })
    expect((manifest.records.temporalFacts as Array<{ status: string }>).map(item => item.status)).toEqual(['confirmed'])
    expect(manifest.sourceManifest?.omittedResourceIds).toEqual([])
  })

  it('资源未选入与世界内容缺失是两种状态，不能再被同一个 missing 混淆', async () => {
    const owned = await phaseDFixture()
    const revision = await createWorldRevision({
      scope: owned.scope,
      label: '仅封存世界观',
      selectedTables: ['worldviews'],
    })
    const release = await publishWorldRevision(revision.id!)
    const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV3
    const foundation = manifest.capabilityProfile!.find(item => item.area === 'foundation')!
    const characters = manifest.capabilityProfile!.find(item => item.area === 'characters')!
    expect(foundation.selectionStatus).toBe('partial-selection')
    expect(foundation.rowCount).toBe(1)
    expect(characters).toMatchObject({ selectionStatus: 'omitted', rowCount: 0, status: 'missing' })
    expect(manifest.sourceManifest?.selectedResourceIds.some(item => item.endsWith(':foundation:worldview'))).toBe(true)
    expect(manifest.sourceManifest?.omittedResourceIds.some(item => item.endsWith(':characters:character'))).toBe(true)
  })

  it('冻结目录暴露稳定多世界关系；产品不需要读取底层表才能从通道导航到两端世界', async () => {
    const owned = await phaseDFixture()
    const descriptors = await listAllWorldReleaseResourceDescriptorsV1(owned.resourceScope)
    const link = descriptors.find(item => item.kind === 'world-link')!
    const groups = descriptors.filter(item => item.worldSemantic?.resourceKind === 'world-group')
    expect(groups).toHaveLength(2)
    expect(link.relations.filter(item => item.kind === 'world-link')).toHaveLength(2)
    expect(link.relations.every(item => groups.some(group => group.resourceKey === item.targetResourceKey))).toBe(true)
    expect(groups.every(group => group.relations.some(item => item.targetResourceKey === link.resourceKey))).toBe(true)
    const focused = await readWorldResourceV1({
      scope: owned.resourceScope,
      resourceKey: link.resourceKey,
      depth: 'focused',
      maxTokens: 2_000,
    })
    expect(focused.content).toContain('退潮镜门')
    expect(focused.descriptor.sourceRefs.every(ref => ref.table === 'worldReleases')).toBe(true)
  })

  it('千级目录可分页、检索、读取详情并按 hash 回到原文，草稿变化不改变旧 Release', async () => {
    const owned = await phaseDFixture(1_000)
    const description = await describeWorldReleaseV1(owned.resourceScope)
    expect(description.worldReference.referenceHash).toBe(owned.reference.referenceHash)
    const page = await searchWorldReleaseV1({
      scope: owned.resourceScope,
      kinds: ['character'],
      query: '规模角色-0999',
      limit: 20,
    })
    expect(page.items).toHaveLength(1)
    const target = page.items[0]!
    const full = await readWorldResourceV1({
      scope: owned.resourceScope,
      resourceKey: target.resourceKey,
      depth: 'full',
      maxTokens: 4_000,
    })
    const original = await readWorldOriginalEvidenceV1({
      scope: owned.resourceScope,
      resourceKey: target.resourceKey,
      sourceRef: full.sourceRefs[0]!,
      maxTokens: 4_000,
    })
    expect(original.content).toContain('规模角色-0999')
    expect(original.contentHash).toBe(full.sourceRefs[0]!.contentHash)

    const draft = await db.characters.where('projectId').equals(owned.scope.projectId).last()
    await db.characters.update(draft!.id!, { shortDescription: '草稿已改变', updatedAt: Date.now() })
    const repeated = await searchWorldReleaseV1({
      scope: owned.resourceScope,
      kinds: ['character'],
      query: '规模角色-0999',
      limit: 20,
    })
    expect(repeated.items[0]?.contentHash).toBe(target.contentHash)
    expect((await readWorldResourceV1({
      scope: owned.resourceScope,
      resourceKey: target.resourceKey,
      depth: 'full',
      maxTokens: 4_000,
    })).content).not.toContain('草稿已改变')
  }, 30_000)
})
