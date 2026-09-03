import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type {
  ProductionProductKindV1,
  ProductWorldSourceSelectionV1,
  WorkspaceScope,
} from '../../src/lib/types'
import {
  loadProductProductionConsultationSourceV2,
  loadProductProductionWorldSourceCatalogV2,
  type ProductProductionWorldSourceCatalogV2,
} from '../../src/lib/product-production/world-source'
import { compileUpperProductWorldRoleBindingsV1 } from '../../src/lib/product/world-requirement-adapters'

export const CURRENT_PRODUCT_RESOURCE_KEYS = {
  story: 'world-release:story-core:1',
  character: 'world-release:character:1',
  location: 'world-release:location:1',
  artifact: 'world-release:codex-entry:1',
  lore: 'world-release:codex-entry:2',
  arc: 'world-release:story-arc:1',
} as const

export const CURRENT_PRODUCT_SOURCE_CATALOG: Pick<ProductProductionWorldSourceCatalogV2,
  'characters' | 'locations' | 'artifacts' | 'loreEntries' | 'storyArcs'> = {
  characters: [{
    resourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.character,
    name: '林舟',
    description: '谨慎的守灯调查者。',
  }],
  locations: [{
    resourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.location,
    name: '雾港灯塔',
    description: '潮门关闭前仍可进入的调查起点。',
  }],
  artifacts: [{
    resourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.artifact,
    name: '黄铜潮汐钥匙',
    description: '能够重新启动潮汐钟机。',
  }],
  loreEntries: [{
    resourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.lore,
    name: '守潮公会',
    description: '负责维护旧港潮汐设施。',
  }],
  storyArcs: [{
    resourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.arc,
    name: '失踪船队',
    description: '求救信号与禁航令的冲突。',
    type: 'side',
  }],
}

export function currentProductSelection(
  productType: ProductionProductKindV1,
  roleBindings: Record<string, string[]> = {},
  worldReferenceHash = 'a'.repeat(64),
): ProductWorldSourceSelectionV1 {
  const normalizedBindings = Object.fromEntries(
    Object.entries(roleBindings)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([role, keys]) => [role, [...new Set(keys)].sort()]),
  )
  return {
    schema: 'storyforge.product-world-source-selection',
    version: 1,
    productType,
    worldReferenceHash,
    resourceKeys: [...new Set(Object.values(normalizedBindings).flat())].sort(),
    roleBindings: normalizedBindings,
  }
}

/**
 * Test-only traversal of the current source contract. Tests may select every
 * resource offered by consultation, but must still make that choice explicit
 * and bind it to one product adapter and one immutable WorldReference.
 */
export async function loadCurrentProductWorldSourceCatalogV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  productType: ProductionProductKindV1
}): Promise<ProductProductionWorldSourceCatalogV2> {
  const consultation = await loadProductProductionConsultationSourceV2({
    scope: input.scope,
    worldReleaseId: input.worldReleaseId,
  })
  const roleBindings = compileUpperProductWorldRoleBindingsV1(
    input.productType,
    consultation.selectionCatalog,
  )
  const selection: ProductWorldSourceSelectionV1 = {
    schema: 'storyforge.product-world-source-selection',
    version: 1,
    productType: input.productType,
    worldReferenceHash: consultation.worldReference.referenceHash,
    resourceKeys: [...new Set(Object.values(consultation.selectionCatalog).flat())].sort(),
    roleBindings,
  }
  return loadProductProductionWorldSourceCatalogV2({
    scope: input.scope,
    worldReleaseId: input.worldReleaseId,
    selection,
  })
}

/**
 * Minimal semanticContract=3 world used by upper-product architecture tests.
 * It deliberately contains no executable product graph or product media.
 */
export async function seedCurrentProductWorld(name: string) {
  const created = await createWorkspace({
    name,
    genre: 'interactive-fiction',
    genres: ['interactive-fiction'],
    status: 'drafting',
    description: '用于统一产品生产链测试的纯语义世界。',
    targetWordCount: 10_000,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  await db.worldviews.add(stampNewRecord(created.scope, 'worldviews', {
    projectId: created.scope.projectId,
    summary: '雾港受潮汐钟维持，禁航令正在撕裂港内秩序。',
    worldOrigin: '双月潮汐塑造了港口文明。',
    politicsOverview: '守灯人与航海公会共同治理港口。',
    cultureOverview: '居民敬畏潮汐钟声。',
    economyOverview: '航运与灯塔税维持港口。', races: '潮民与渡海者',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  await db.geographies.add(stampNewRecord(created.scope, 'geographies', {
    projectId: created.scope.projectId,
    overview: '群岛、雾港与潮门', locations: '[]', worldMapData: '',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  await db.histories.add(stampNewRecord(created.scope, 'histories', {
    projectId: created.scope.projectId,
    overview: '失踪船队曾在满月夜发出求救信号。', eraSystem: '', events: '[]',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  await db.worldRulesProfiles.add(stampNewRecord(created.scope, 'worldRulesProfiles', {
    projectId: created.scope.projectId,
    entries: {}, customNodes: [], globalNote: '满月时潮门开启。',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  const storyCoreId = await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
    projectId: created.scope.projectId,
    theme: '真相与救援的代价', centralConflict: '守灯人必须在公开信号和保护港口之间选择。',
    plotPattern: '调查—抉择—承担后果',
    logline: '暴潮前夜，守灯人追查一封不该出现的求救信号。',
    concept: '潮汐规则约束下的港口悬疑', mainPlot: '追查信号、修复潮汐钟并决定真相是否公开。',
    subPlots: '航海公会与守潮人的信任冲突。', createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  const characterIds = await db.characters.bulkAdd([
    stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId, name: '林舟', role: 'protagonist', roleWeight: 'main',
      identity: '谨慎的守灯调查者', shortDescription: '负责雾港灯塔的年轻守灯人。',
      background: '熟悉潮汐钟结构。', personality: '谨慎而固执', createdAt: now, updatedAt: now,
    } as never, { owner: 'world' }),
    stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId, name: '守潮人', role: 'supporting', roleWeight: 'secondary',
      identity: '掌握旧港秘密的向导', shortDescription: '知道失踪船队真相。',
      background: '来自旧港议会。', personality: '克制而多疑', createdAt: now + 1, updatedAt: now + 1,
    } as never, { owner: 'world' }),
  ], { allKeys: true }) as number[]
  await db.characterRelations.add(stampNewRecord(created.scope, 'characterRelations', {
    projectId: created.scope.projectId,
    fromCharacterId: characterIds[0], toCharacterId: characterIds[1], relationType: 'ally',
    label: '脆弱同盟', description: '共同调查潮门失控，但彼此隐瞒动机。', isBidirectional: true,
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  await db.importantLocations.add(stampNewRecord(created.scope, 'importantLocations', {
    projectId: created.scope.projectId, parentId: null, name: '雾港灯塔', type: 'lighthouse',
    description: '潮门关闭前仍可进入的调查起点。', createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  const categoryId = await db.codexCategories.add(stampNewRecord(created.scope, 'codexCategories', {
    projectId: created.scope.projectId, domain: 'humanity', parentId: null, name: '人工器物',
    builtInKey: 'artifact', fieldSchema: '[]', hidden: false, order: 0, worldGroupId: null,
    createdAt: now, updatedAt: now,
  } as never, { owner: 'world' })) as number
  await db.codexEntries.add(stampNewRecord(created.scope, 'codexEntries', {
    projectId: created.scope.projectId, categoryId, name: '黄铜潮汐钥匙', summary: '能够重新启动潮汐钟机。',
    description: '钥匙齿纹对应旧档案中的潮位。', fields: '{}', refs: '{}', tags: '["关键道具"]',
    importance: 5, order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  await db.storyArcs.add(stampNewRecord(created.scope, 'storyArcs', {
    projectId: created.scope.projectId, name: '失踪船队调查', type: 'main',
    stages: JSON.stringify([{ id: 'opening', title: '求救信号', description: '暴潮前收到失踪船队信号。', keyEvents: ['信号重现'] }]),
    description: '追查信号并决定是否公开真相。', origin: 'manual', status: 'active',
    sourceStoryCoreId: storyCoreId, createdAt: now, updatedAt: now,
  } as never, { owner: 'work' }))
  const revision = await createWorldRevision({ scope: created.scope, label: `${name} · 纯语义冻结` })
  const release = await publishWorldRevision(revision.id!)
  return { ...created, revision, release, characterIds }
}
