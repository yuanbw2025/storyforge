import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import {
  CANON_RESOURCE_PROVIDER_V1,
  contextResourceSpecsV1,
} from '../../src/lib/context-gateway/canon-provider'
import { assertResourcePageV1 } from '../../src/lib/context-gateway/contracts'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { generateWorkCode } from '../../src/lib/memory/identity'
import { generateWorkspaceScopeCode } from '../../src/lib/workspace/identity'
import { normalizeChapterText, sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  buildRagLibrary,
  updateRagFieldPolicy,
} from '../../src/lib/retrieval/rag-library'
import type {
  ContextResourceDescriptorV1,
  FrozenResourceScopeV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'

const now = 1_787_500_000_000

async function seedWorkspace(name = 'CTXG-3 Canon 目录') {
  const created = await seedCurrentWorkspace(name, { enableMultiWorld: true })
  return { projectId: created.scope.projectId, scope: created.scope }
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner?: 'world' | 'work',
): Promise<number> {
  const stamped = stampNewRecord(scope, tableName, {
    projectId: scope.projectId,
    createdAt: now,
    updatedAt: now,
    ...row,
  }, owner ? { owner } : {})
  return (db as any)[tableName].add(stamped) as Promise<number>
}

function frozen(scope: WorkspaceScope, worldGroupId: number | null): FrozenResourceScopeV1 {
  return { ...scope, worldGroupId }
}

async function allDescriptors(scope: FrozenResourceScopeV1, limit = 3): Promise<ContextResourceDescriptorV1[]> {
  const result: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, limit, cursor })
    result.push(...page.items)
    if (!page.nextCursor) return result
    cursor = page.nextCursor
  }
  throw new Error('catalog pagination did not terminate')
}

async function seedSixDomains() {
  const fixture = await seedWorkspace()
  const { scope } = fixture
  const primaryGroupId = await addScoped(scope, 'worldGroups', {
    name: '潮汐大陆', description: '旧海床上的主世界', type: 'primary', order: 0,
    entryCondition: '出生于此', exitCondition: '敲响潮钟', powerRestriction: '潮力不得超过三阶',
    takeawayRules: '只能带走刻有潮纹的物品',
  }, 'world')
  const targetGroupId = await addScoped(scope, 'worldGroups', {
    name: '镜海', description: '倒悬海洋', type: 'parallel', order: 1,
    entryCondition: '持有完整镜片', exitCondition: '在无月夜潜入海底',
    powerRestriction: '火焰能力失效', takeawayRules: '记忆可以带出，实体物品不可带出',
  }, 'world')
  await addScoped(scope, 'worldGroupLinks', {
    fromGroupId: primaryGroupId, toGroupId: targetGroupId, linkType: 'portal',
    name: '退潮镜门', description: '只在第三次退潮时显形', bidirectional: true,
  }, 'world')
  const worldviewId = await addScoped(scope, 'worldviews', {
    worldGroupId: primaryGroupId,
    worldOrigin: '群岛从退潮后的海床升起。',
    races: '潮民记录潮汐，镜裔守护倒影。',
    internalConflicts: '',
  }, 'world')
  await addScoped(scope, 'powerSystems', {
    worldGroupId: primaryGroupId, name: '潮印', description: '借潮汐刻印施术', levels: '[]', rules: '逆潮必失忆',
  }, 'world')
  await addScoped(scope, 'worldRulesProfiles', {
    worldGroupId: primaryGroupId, entries: [{ id: 'rule-1', text: '镜中影不能说谎' }], customNodes: [], globalNote: '规则不可被计划覆盖',
  }, 'world')
  await addScoped(scope, 'histories', {
    worldGroupId: primaryGroupId, overview: '三百年前海面第一次倒悬。', eraSystem: '潮历', events: '[]',
  }, 'world')
  await addScoped(scope, 'importantLocations', {
    name: '废弃王城', description: '被盐壳包裹的旧都', significance: '镜门入口', tags: ['王城'], parentId: null,
  }, 'world')
  const categoryId = await addScoped(scope, 'codexCategories', {
    name: '族群', description: '', order: 0, parentId: null,
    fieldSchema: JSON.stringify([{ key: 'lifespan', label: '寿命', type: 'text' }]), worldGroupId: null,
  }, 'world')
  await addScoped(scope, 'codexEntries', {
    worldGroupId: primaryGroupId, categoryId, name: '镜裔', summary: '以倒影保存记忆', description: '镜裔没有固定面容',
    fields: JSON.stringify({ lifespan: '三百年' }), tags: ['族群'],
  }, 'world')

  await addScoped(scope, 'storyCores', {
    logline: '失忆的潮民寻找最后一面真镜。', concept: '记忆与身份', theme: '选择塑造自我',
    centralConflict: '守住现实还是救回旧世界', plotPattern: '追寻', mainPlot: '寻找真镜', subPlots: '镜裔内战',
  }, 'work')
  const arcIds: number[] = []
  for (let index = 0; index < 3; index++) {
    arcIds.push(await addScoped(scope, 'storyArcs', {
      name: index === 2 ? '最后创建的镜海支线' : `故事线 ${index + 1}`,
      type: index === 0 ? 'main' : 'sub',
      description: `第 ${index + 1} 条故事线`,
      stages: JSON.stringify([{ id: `stage-${index}`, title: `阶段 ${index}`, description: `推进 ${index}`, startVolume: index + 1, endVolume: index + 2, keyEvents: ['转折'] }]),
    }, 'work'))
  }
  await addScoped(scope, 'storylineProgress', {
    arcId: arcIds[0], currentStageId: 'stage-0', status: 'active', progressNote: '主角已拿到镜片',
    lastActiveChapterId: null, involvedEntities: '[]', evidenceQuote: '镜片在掌心发冷。',
  }, 'work')

  const characterIds: number[] = []
  for (let index = 0; index < 3; index++) {
    characterIds.push(await addScoped(scope, 'characters', {
      homeWorldGroupId: primaryGroupId, isCrossWorld: false,
      name: index === 2 ? '最后创建的角色' : `角色 ${index + 1}`,
      roleWeight: index === 0 ? 'main' : 'secondary',
      moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `角色简介 ${index}`, identity: '潮民', profile: '', personality: '谨慎', goals: '找到真镜',
    }, 'world'))
  }
  await addScoped(scope, 'characterRelations', {
    fromCharacterId: characterIds[0], toCharacterId: characterIds[1], relationType: 'ally',
    label: '盟友', description: '共同守护镜片', isBidirectional: true,
  }, 'world')
  await addScoped(scope, 'characterDrivenPlans', {
    name: '待确认角色驱动方案', premise: '由角色选择推动镜海开启', generatedArcs: '[]', generatedVolumes: '[]', status: 'generated',
  }, 'work')

  const volumeId = await addScoped(scope, 'outlineNodes', {
    parentId: null, type: 'volume', title: '第一卷', summary: '寻找镜门', order: 0, worldGroupId: primaryGroupId,
  }, 'work')
  const chapterIds: number[] = []
  for (let index = 0; index < 3; index++) {
    const outlineNodeId = await addScoped(scope, 'outlineNodes', {
      parentId: volumeId, type: 'chapter', title: `第 ${index + 1} 章`, summary: `章纲 ${index + 1}`, order: index, worldGroupId: primaryGroupId,
    }, 'work')
    const content = `<p>正文 ${index + 1}，镜片发出潮声。</p>`
    chapterIds.push(await addScoped(scope, 'chapters', {
      outlineNodeId, title: index === 2 ? '最后创建的章节' : `章节 ${index + 1}`,
      content, wordCount: 12, status: 'draft', order: index, notes: '',
      summary: `${index === 0 ? '已验证' : '未经验证'}的摘要 ${index + 1}`,
      summarySourceTextHash: index === 0
        ? await sha256Text(normalizeChapterText(content))
        : '0'.repeat(64),
    }, 'work'))
    if (index === 0) {
      await addScoped(scope, 'detailedOutlines', {
        outlineNodeId,
        scenes: [{ sceneId: 'scene-harbor', title: '盐港相遇', summary: '主角遇见镜裔', characterIds: characterIds.slice(0, 2), location: '盐港', conflict: '争夺镜片', pace: 'fast', estimatedWords: 1200, notes: '' }],
        openingHook: '潮声从井底传来', endingCliffhanger: '镜中人睁眼', sceneLocation: '盐港', appearingCharacterIds: characterIds.slice(0, 2), foreshadowIds: [], emotionArc: 'rising', prohibitions: ['不得让镜片说话'], lastUsedSummary: '章纲 1',
      }, 'work')
    }
  }
  const moduleId = await addScoped(scope, 'narrativeModules', {
    kind: 'main', title: '镜海蓝图', description: '从盐港通往镜海', status: 'ready', sourceProjection: 'story-arc', sourceRefId: arcIds[0], entryNodeKey: 'entry',
  }, 'work')
  await addScoped(scope, 'narrativeNodes', {
    moduleId, key: 'entry', kind: 'entry', title: '盐港入口', summary: '主角拾起镜片', conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', sourceOutlineNodeId: volumeId, order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeBeats', {
    moduleId, nodeKey: 'entry', beatKey: 'mirror-awakes', kind: 'narration',
    speakerCharacterId: null, text: '镜片在潮声中苏醒。', order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeChoices', {
    moduleId, sourceNodeKey: 'entry', choiceKey: 'touch-mirror', text: '触碰镜片',
    description: '接受镜海的召唤', unavailableReason: '', targetNodeKey: 'entry',
    displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]', order: 0,
  }, 'work')
  await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId })
  await addScoped(scope, 'foreshadows', {
    name: '潮钟裂纹', description: '第三次敲响后裂纹扩大', notes: '', status: 'planned', type: 'object', importance: 'major', plantChapterId: chapterIds[0], resolveChapterId: null,
  }, 'work')

  await addScoped(scope, 'temporalFacts', {
    worldGroupId: primaryGroupId, characterId: characterIds[0], subjectName: '角色 1', predicate: 'location', factKind: 'state', value: '盐港',
    sourceType: 'chapter', sourceChapterId: chapterIds[0], sourceQuote: '他站在盐港。', validFromChapterId: chapterIds[0], validToChapterId: null,
    status: 'confirmed', locked: true,
  }, 'work')
  await addScoped(scope, 'stateCards', {
    category: 'character', entityName: '角色 1', fields: JSON.stringify({ location: '盐港' }), lastChapterId: chapterIds[0],
  }, 'work')
  await addScoped(scope, 'itemLedger', {
    characterId: characterIds[0], heldByName: '角色 1', itemName: '镜片', action: 'gain', quantity: 1,
    chapterId: chapterIds[0], chapterTitle: '章节 1', note: '不可遗失',
  }, 'work')
  await addScoped(scope, 'storyTimelineEvents', {
    title: '获得镜片', description: '主角在盐港获得镜片', time: '潮历 301 年', chapterId: chapterIds[0],
  }, 'work')

  await addScoped(scope, 'creativeRules', {
    content: '避免概念解释，优先给出具体行动。', forbidden: '不得全知视角',
  }, 'work')
  await addScoped(scope, 'references', {
    title: '航海叙事参考', type: 'novel', note: '只参考节奏', analysisSummary: '由慢到快', importedData: '{}',
  }, 'work')
  return { ...fixture, primaryGroupId, targetGroupId, worldviewId, arcIds, characterIds, chapterIds }
}

describe('CTXG-3 · Canon resource provider', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('derives provider coverage from the three registries instead of a parallel table/field list', () => {
    const source = CONTEXT_SOURCE_BY_KEY.get('ragSelection')
    expect(source?.resources).toBe(CANON_RESOURCE_PROVIDER_V1)
    const specs = contextResourceSpecsV1()
    expect(specs.length).toBeGreaterThanOrEqual(30)
    expect(specs.every(spec => PROJECT_TABLES.includes(spec))).toBe(true)
    expect(new Set(CANON_RESOURCE_PROVIDER_V1.kinds)).toEqual(new Set(specs.map(spec => spec.resourceIdentity.contextKind)))
    for (const table of ['worldviews', 'storyCores', 'characters']) {
      const registryFields = FIELD_BY_TARGET.get(table)?.map(field => field.field) ?? []
      expect(registryFields.length).toBeGreaterThan(5)
      expect(specs.find(spec => spec.name === table)?.resourceIdentity.descriptorMode).toBe('registered-fields')
    }
  })

  it('covers six domains, nested stages/scenes, conservative authority and the complete world-link rules', async () => {
    const fixture = await seedSixDomains()
    const scope = frozen(fixture.scope, fixture.primaryGroupId)
    const descriptors = await allDescriptors(scope, 2)
    const kinds = new Set(descriptors.map(item => item.kind))
    for (const expected of [
      'world', 'worldview-field', 'world-link', 'story-core-field', 'story-arc',
      'storyline-progress', 'character', 'character-relation', 'outline-node',
      'detailed-outline', 'narrative-blueprint', 'chapter', 'foreshadow', 'fact', 'reference',
    ] as const) expect(kinds.has(expected)).toBe(true)
    expect(descriptors.some(item => item.resourceKey.includes(':stage:stage-2'))).toBe(true)
    const event = descriptors.find(item => item.resourceKey.includes(':stage:stage-2:event:1'))!
    expect(event.shortSummary).toBe('转折')
    expect(event.relations).toContainEqual(expect.objectContaining({
      kind: 'parent',
      targetResourceKey: expect.stringContaining(':stage:stage-2'),
    }))
    expect(descriptors.some(item => item.resourceKey.includes(':scene:scene-harbor'))).toBe(true)
    expect(descriptors.filter(item => item.kind === 'narrative-blueprint')
      .some(item => item.sourceRefs.some(ref => ref.table === 'narrativeBeats'))).toBe(true)
    expect(descriptors.filter(item => item.kind === 'narrative-blueprint')
      .some(item => item.sourceRefs.some(ref => ref.table === 'narrativeChoices'))).toBe(true)
    const writtenBoundary = descriptors.find(item => item.resourceKey.endsWith(':written-boundary'))!
    expect(writtenBoundary).toBeTruthy()
    expect((await CANON_RESOURCE_PROVIDER_V1.read({
      scope, resourceKey: writtenBoundary.resourceKey, depth: 'full', maxTokens: 1000,
    })).content).toContain('只读；未来大纲生成不得覆盖、重排或替换该章')
    expect(descriptors.find(item => item.title.includes('待确认角色驱动方案'))?.authority).toBe('candidate')
    expect(descriptors.find(item => item.kind === 'chapter'
      && item.sourceRefs[0]?.recordId === fixture.chapterIds[0]
      && item.resourceKey.endsWith(':field:summary'))?.authority).toBe('derived-summary')
    expect(descriptors.find(item => item.kind === 'chapter'
      && item.sourceRefs[0]?.recordId === fixture.chapterIds[1]
      && item.resourceKey.endsWith(':field:summary'))?.authority).toBe('candidate')
    expect(descriptors.find(item => item.title.includes('角色 1') && item.title.includes('目标'))?.sourceRefs[0].table).toBe('characters')
    expect(descriptors.some(item => item.resourceKey.endsWith(':field:internalConflicts'))).toBe(false)
    expect(descriptors.some(item => item.resourceKey.endsWith(':field:custom.lifespan'))).toBe(true)
    expect(descriptors.some(item => item.resourceKey.endsWith(':field:event'))).toBe(true)

    const link = descriptors.find(item => item.kind === 'world-link' && !item.resourceKey.includes(':field:'))!
    const read = await CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: link.resourceKey, depth: 'full', maxTokens: 4000 })
    expect(read.content).toContain('方向：潮汐大陆 → 镜海')
    expect(read.content).toContain('双向：是')
    expect(read.content).toContain('目标世界进入条件：持有完整镜片')
    expect(read.content).toContain('目标世界力量限制：火焰能力失效')
    expect(read.content).toContain('目标世界带出规则：记忆可以带出，实体物品不可带出')
    expect(link.sourceRefs.some(ref => ref.table === 'worldGroupLinks')).toBe(true)
    expect(link.sourceRefs.filter(ref => ref.table === 'worldGroups').length).toBeGreaterThanOrEqual(4)

    const source = CONTEXT_SOURCE_BY_KEY.get('ragSelection')!
    const firstPage = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, limit: 5 })
    expect(assertResourcePageV1({
      page: firstPage,
      source,
      expectedScopeFingerprint: await CANON_RESOURCE_PROVIDER_V1.fingerprint(scope),
      maxItems: 5,
    })).toEqual(firstPage)
  })

  it('keeps late-created resources reachable through stable pagination and rejects cursor/filter forgery', async () => {
    const fixture = await seedSixDomains()
    const scope = frozen(fixture.scope, fixture.primaryGroupId)
    const descriptors = await allDescriptors(scope, 1)
    expect(descriptors.some(item => item.title.includes('最后创建的角色'))).toBe(true)
    expect(descriptors.some(item => item.title.includes('最后创建的镜海支线'))).toBe(true)
    expect(descriptors.some(item => item.title.includes('最后创建的章节'))).toBe(true)
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, kinds: ['character'], limit: 1 })
    expect(page.nextCursor).toBeTruthy()
    await expect(CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope, kinds: ['chapter'], limit: 1, cursor: page.nextCursor!,
    })).rejects.toThrow('cursor 不属于当前 scope/filter/query')
    await expect(CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, limit: 101 })).rejects.toThrow('limit')
    await expect(CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, limit: 1, cursor: 'not-base64' })).rejects.toThrow('cursor')
  })

  it('reads exact original evidence, detects stale refs, and never writes while listing/searching/reading', async () => {
    const fixture = await seedSixDomains()
    const scope = frozen(fixture.scope, fixture.primaryGroupId)
    const snapshot = async () => JSON.stringify(await Promise.all(contextResourceSpecsV1().map(async spec => ({
      table: spec.name,
      rows: await spec.table.where('projectId').equals(fixture.projectId).toArray(),
    }))))
    const before = await snapshot()
    const descriptors = await allDescriptors(scope, 4)
    const races = descriptors.find(item => item.resourceKey.endsWith(':field:races'))!
    expect(races).toBeTruthy()
    const full = await CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: races.resourceKey, depth: 'full', maxTokens: 1000 })
    expect(full.content).toBe('潮民记录潮汐，镜裔守护倒影。')
    const original = await CANON_RESOURCE_PROVIDER_V1.readOriginal({
      scope, resourceKey: races.resourceKey, sourceRef: races.sourceRefs[0], maxTokens: 1000,
    })
    expect(original.content).toBe('潮民记录潮汐，镜裔守护倒影。')
    await expect(CANON_RESOURCE_PROVIDER_V1.readOriginal({
      scope,
      resourceKey: races.resourceKey,
      sourceRef: {
        ...races.sourceRefs[0],
        anchor: { ...races.sourceRefs[0].anchor!, quoteHash: '0'.repeat(64) },
      },
      maxTokens: 1000,
    })).rejects.toThrow('source ref 不属于资源当前版本')
    const search = await CANON_RESOURCE_PROVIDER_V1.searchMetadata({ scope, query: '守护倒影', limit: 10 })
    expect(search.items.map(item => item.resourceKey)).toContain(races.resourceKey)
    expect(await snapshot()).toBe(before)

    await db.worldviews.update(fixture.worldviewId, { races: '潮民与镜裔已经停战。', updatedAt: now + 100 })
    await expect(CANON_RESOURCE_PROVIDER_V1.readOriginal({
      scope, resourceKey: races.resourceKey, sourceRef: races.sourceRefs[0], maxTokens: 1000,
    })).rejects.toThrow('source ref 不属于资源当前版本')
    const refreshed = (await allDescriptors(scope, 10)).find(item => item.resourceKey === races.resourceKey)!
    expect(refreshed.resourceKey).toBe(races.resourceKey)
    expect(refreshed.contentHash).not.toBe(races.contentHash)
    expect((await CANON_RESOURCE_PROVIDER_V1.readOriginal({
      scope, resourceKey: refreshed.resourceKey, sourceRef: refreshed.sourceRefs[0], maxTokens: 1000,
    })).content).toBe('潮民与镜裔已经停战。')
  })

  it('preserves current dynamic Codex custom-field and item-event keys through the provider', async () => {
    const fixture = await seedSixDomains()
    const scope = frozen(fixture.scope, fixture.primaryGroupId)
    const initial = await buildRagLibrary({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.primaryGroupId,
    })
    const custom = initial.find(entry => entry.fieldKey === 'custom.lifespan')!
    const event = initial.find(entry => entry.fieldKey === 'event')!
    expect(custom.content).toBe('三百年')
    expect(custom.fieldLabel).toBe('寿命')
    expect(event.content).toBe('角色 1获得1 × 镜片（章节 1）')

    await updateRagFieldPolicy({
      projectId: fixture.projectId,
      scope: fixture.scope,
      tableName: custom.tableName,
      recordId: custom.recordId,
      fieldKey: custom.fieldKey,
      patch: { priority: 'must-read', weight: 4.2, tokenCap: 2100 },
    })
    const refreshed = await buildRagLibrary({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.primaryGroupId,
    })
    expect(refreshed.find(entry => entry.key === custom.key)?.priority).toBe('must-read')

    const descriptors = await allDescriptors(scope, 10)
    const customDescriptor = descriptors.find(item => item.resourceKey.endsWith(':field:custom.lifespan'))!
    expect(customDescriptor.priority).toBe('must-read')
    expect(customDescriptor.retrievalWeight).toBe(4.2)
    expect(customDescriptor.tokenCap).toBe(2100)
    expect(customDescriptor.policyRevision).toBe(1)
    expect(customDescriptor.sourceRefs[0].field).toBe('fields')
  })

  it('isolates World/Work/WorldGroup, preserves keys across rename/import, and removes deleted resources', async () => {
    const fixture = await seedSixDomains()
    const scope = frozen(fixture.scope, fixture.primaryGroupId)
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: fixture.projectId, worldId: fixture.scope.worldId, code: generateWorkCode(), title: '另一作品',
      kind: 'novel', novelProfile: 'long', description: '', genres: [], status: 'drafting',
      targetWordCount: 1000, currentWordCount: 0, createdAt: now, updatedAt: now,
    })) as number
    const otherWorkScope = { projectId: fixture.projectId, worldId: fixture.scope.worldId, workId: otherWorkId }
    await addScoped(otherWorkScope, 'storyCores', {
      logline: '不应泄漏的另一作品', concept: '', theme: '', centralConflict: '', plotPattern: '', mainPlot: '', subPlots: '',
    }, 'work')
    const otherWorldId = await db.worlds.add({
      projectId: fixture.projectId, identityKind: 'workspace-scope', code: generateWorkspaceScopeCode(now + 1),
      name: '另一 World 根', description: '', currentVersion: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWorldWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: fixture.projectId, worldId: otherWorldId, code: generateWorkCode(), title: '另一世界作品',
      kind: 'novel', novelProfile: 'long', description: '', genres: [], status: 'drafting',
      targetWordCount: 1000, currentWordCount: 0, createdAt: now, updatedAt: now,
    })) as number
    await addScoped({ projectId: fixture.projectId, worldId: otherWorldId, workId: otherWorldWorkId }, 'characters', {
      homeWorldGroupId: null, isCrossWorld: false, name: '不应泄漏的另一世界角色',
      roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '隔离',
    }, 'world')
    const primaryDescriptors = await allDescriptors(scope, 5)
    expect(primaryDescriptors.some(item => item.shortSummary.includes('不应泄漏'))).toBe(false)
    const mirrorScopeDescriptors = await allDescriptors(frozen(fixture.scope, fixture.targetGroupId), 5)
    expect(mirrorScopeDescriptors.some(item => item.resourceKey.endsWith(':field:races'))).toBe(false)

    const characterBefore = primaryDescriptors.find(item => item.title.includes('最后创建的角色') && !item.resourceKey.includes(':field:'))!
    await db.characters.update(fixture.characterIds[2], { name: '改名后的末位角色', updatedAt: now + 1 })
    const afterRename = (await allDescriptors(scope, 5)).find(item => item.resourceKey === characterBefore.resourceKey)!
    expect(afterRename.title).toContain('改名后的末位角色')
    expect(afterRename.resourceKey).toBe(characterBefore.resourceKey)
    await db.characters.delete(fixture.characterIds[2])
    expect((await allDescriptors(scope, 5)).some(item => item.resourceKey === characterBefore.resourceKey)).toBe(false)

    const beforeImportKeys = (await allDescriptors(scope, 10)).map(item => item.resourceKey).sort()
    const primaryGroupUid = (await db.worldGroups.get(fixture.primaryGroupId))?.ragDocumentId
    const exported = await exportProjectJSON(fixture.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const importedOwnership = await resolveWorkspaceOwnership(importedProjectId)
    const importedGroup = (await db.worldGroups.where('projectId').equals(importedProjectId).toArray())
      .find(group => group.ragDocumentId === primaryGroupUid)
    expect(importedGroup?.id).toBeTruthy()
    const importedKeys = (await allDescriptors(frozen(importedOwnership.scope, importedGroup!.id!), 10))
      .map(item => item.resourceKey).sort()
    // Current import preserves every stable record/field identity. Descriptors
    // derived from explicit current defaults may be additive.
    expect(importedKeys).toEqual(expect.arrayContaining(beforeImportKeys))
    const importedRaces = (await allDescriptors(frozen(importedOwnership.scope, importedGroup!.id!), 20))
      .find(item => item.resourceKey.endsWith(':field:races'))!
    expect(importedRaces.sourceRefs[0].recordId).not.toBe(fixture.worldviewId)
  })
})
