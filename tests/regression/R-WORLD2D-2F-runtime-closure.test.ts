import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  addNarrativeNode,
  createNarrativeModule,
  createStarterNarrativeModule,
  validateNarrativeModule,
} from '../../src/lib/narrative/blueprint'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createWorldPackageV2, inspectWorldPackage } from '../../src/lib/product/world-package'
import {
  advanceSimulationNarrative,
  appendSimulationEvent,
  branchSimulationSession,
  createSimulationCheckpoint,
  readSimulationState,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import type {
  NarrativeModuleKind,
  SimulationSessionKind,
  WorldReleaseManifestV2,
  WorkspaceScope,
} from '../../src/lib/types'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import {
  assertReleaseUnchanged,
  createWorldRevision,
  publishWorldRevision,
  worldReleaseSectionTables,
} from '../../src/lib/world-engine/releases'
import { createWorldWork, selectWorkNarrativeModule } from '../../src/lib/world-engine/works'

async function createWorkspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: 'WORLD-2D..2F 闭环测试',
    targetWordCount: 100000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

describe('WORLD-2D..2F · executable product closure', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('五类正式叙事入口原子生成可执行图，当前蓝图上下文按 Work 隔离', async () => {
    const ownership = await createWorkspace('正式叙事入口')
    const kinds: NarrativeModuleKind[] = ['main', 'side', 'quest', 'opening', 'free']
    for (const kind of kinds) {
      const module = await createStarterNarrativeModule({
        scope: ownership.scope,
        owner: 'work',
        kind,
        title: `A-${kind}`,
      })
      expect(await validateNarrativeModule(ownership.scope, module.id!)).toMatchObject({
        valid: true,
        entryKey: 'entry',
        reachableKeys: ['entry', 'ending'],
      })
    }
    const before = await db.narrativeModules.count()
    await expect(createStarterNarrativeModule({
      scope: ownership.scope,
      owner: 'work',
      kind: 'quest',
      title: '   ',
    })).rejects.toThrow('模块名称不能为空')
    expect(await db.narrativeModules.count()).toBe(before)

    const workB = await createWorldWork(ownership.scope.projectId, { title: '作品 B' })
    const scopeB: WorkspaceScope = { ...ownership.scope, workId: workB.id! }
    const moduleA = await createStarterNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'main', title: 'A 当前主线' })
    const moduleB = await createStarterNarrativeModule({ scope: scopeB, owner: 'work', kind: 'main', title: 'B 当前主线' })
    await selectWorkNarrativeModule(ownership.scope, moduleA.id!)
    await selectWorkNarrativeModule(scopeB, moduleB.id!)

    const contextA = await assembleContext({
      projectId: ownership.scope.projectId,
      scope: ownership.scope,
      sourceKeys: ['activeNarrativeBlueprint'],
    })
    const contextB = await assembleContext({
      projectId: scopeB.projectId,
      scope: scopeB,
      sourceKeys: ['activeNarrativeBlueprint'],
    })
    expect(contextA.text).toContain('A 当前主线')
    expect(contextA.text).not.toContain('B 当前主线')
    expect(contextB.text).toContain('B 当前主线')
    expect(contextB.text).not.toContain('A 当前主线')
  })

  it('发布范围由注册表裁剪世界基础、角色、故事和大纲，私有正文与参考资料始终排除', async () => {
    const ownership = await createWorkspace('发布范围裁剪')
    const now = Date.now()
    const module = await createStarterNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'main', title: '可发布主线' })
    await db.worldviews.add({
      projectId: ownership.scope.projectId,
      worldId: ownership.scope.worldId,
      worldOrigin: '冻结世界基础',
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.storyCores.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      logline: '冻结故事核心',
      createdAt: now,
      updatedAt: now,
    } as any)
    const characterId = await db.characters.add({
      projectId: ownership.scope.projectId,
      worldId: ownership.scope.worldId,
      name: '冻结角色',
      role: 'protagonist',
      description: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.workCharacterBindings.add({
      projectId: ownership.scope.projectId,
      workId: ownership.scope.workId,
      characterId,
      role: '主角',
      createdAt: now,
      updatedAt: now,
    })
    const outlineId = await db.outlineNodes.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      parentId: null,
      worldGroupId: null,
      type: 'chapter',
      title: '冻结章纲',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.detailedOutlines.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      outlineNodeId: outlineId,
      scenes: [],
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.chapters.add({
      projectId: ownership.scope.projectId,
      workId: ownership.scope.workId,
      outlineNodeId: outlineId,
      title: '不得发布的正文',
      content: '<p>私稿</p>',
      wordCount: 2,
      status: 'draft',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.references.add({
      projectId: ownership.scope.projectId,
      workId: ownership.scope.workId,
      title: '不得发布的参考资料',
      author: '',
      type: 'story',
      note: '',
      url: '',
      createdAt: now,
      updatedAt: now,
    } as any)

    const selectedTables = [
      ...worldReleaseSectionTables('foundation'),
      ...worldReleaseSectionTables('narrative'),
      ...worldReleaseSectionTables('outline'),
    ]
    const revision = await createWorldRevision({
      scope: ownership.scope,
      label: '不含角色的修订',
      selectedTables,
      selectedNarrativeModuleIds: [module.id!],
    })
    const manifest = JSON.parse(revision.manifestJson) as WorldReleaseManifestV2
    expect(manifest.records.worldviews).toHaveLength(1)
    expect(manifest.records.storyCores).toHaveLength(1)
    expect(manifest.records.outlineNodes).toHaveLength(1)
    expect(manifest.records.detailedOutlines).toHaveLength(1)
    expect(manifest.records.narrativeModules).toHaveLength(1)
    expect(manifest.records.characters).toBeUndefined()
    expect(manifest.records.workCharacterBindings).toBeUndefined()
    expect(manifest.selectedTables).not.toContain('chapters')
    expect(manifest.selectedTables).not.toContain('references')
    expect((manifest.portableProject as Record<string, unknown>).chapters).toBeUndefined()
    expect((manifest.portableProject as Record<string, unknown>).references).toBeUndefined()

    const allSections = ['foundation', 'characters', 'narrative', 'outline'] as const
    const fullRevision = await createWorldRevision({
      scope: ownership.scope,
      label: '完整范围修订',
      parentRevisionId: revision.id,
      selectedTables: allSections.flatMap(worldReleaseSectionTables),
      selectedNarrativeModuleIds: [module.id!],
    })
    const fullManifest = JSON.parse(fullRevision.manifestJson) as WorldReleaseManifestV2
    expect(fullManifest.records.characters).toHaveLength(1)
    expect(fullManifest.records.workCharacterBindings).toHaveLength(1)
    expect(fullManifest.records.chapters).toBeUndefined()
    expect(fullManifest.records.references).toBeUndefined()

    const repeatedRevision = await createWorldRevision({
      scope: ownership.scope,
      label: '相同内容再次冻结',
      parentRevisionId: fullRevision.id,
      selectedTables: allSections.flatMap(worldReleaseSectionTables),
      selectedNarrativeModuleIds: [module.id!],
    })
    expect(repeatedRevision.contentHash).toBe(fullRevision.contentHash)

    const release = await publishWorldRevision(repeatedRevision.id!)
    const pkg = await createWorldPackageV2(release.id!, {
      authorName: '测试作者',
      license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
    })
    const tampered = structuredClone(pkg)
    tampered.release.manifest.selectedTables.push(tampered.release.manifest.selectedTables[0])
    const report = await inspectWorldPackage(tampered)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('模块表清单无效')

    const mismatched = structuredClone(pkg)
    const portableStoryCores = mismatched.release.manifest.portableProject.storyCores as Array<Record<string, unknown>>
    portableStoryCores[0].logline = '与冻结 records 不一致的内容'
    const mismatchReport = await inspectWorldPackage(mismatched)
    expect(mismatchReport.valid).toBe(false)
    expect(mismatchReport.errors.join('；')).toContain('便携数据与冻结记录「storyCores」不一致')
  })

  it('非法叙事不能冻结；Release 节点冻结后按条件推进、回放、检查点和分支保持确定', async () => {
    const ownership = await createWorkspace('冻结叙事运行时')
    const invalid = await createNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'quest', title: '非法任务' })
    await addNarrativeNode({ scope: ownership.scope, moduleId: invalid.id!, key: 'entry', kind: 'entry', title: '孤立入口' })
    await expect(createWorldRevision({
      scope: ownership.scope,
      label: '不得冻结',
      selectedNarrativeModuleIds: [invalid.id!],
    })).rejects.toThrow('不可执行')
    expect(await db.worldRevisions.count()).toBe(0)

    const module = await createNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'main', title: '冻结主线' })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'entry',
      kind: 'entry',
      title: '原始入口',
      effectsJson: '[{"op":"set","path":"flags.open","value":true},{"op":"set","path":"score","value":1}]',
      successorKeys: ['allowed', 'blocked'],
      order: 0,
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'allowed',
      kind: 'choice',
      title: '允许路径',
      conditionJson: '{"path":"flags.open","eq":true}',
      effectsJson: '[{"op":"increment","path":"score","value":2}]',
      successorKeys: ['ending'],
      order: 1,
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'blocked',
      kind: 'ending',
      title: '条件不成立路径',
      conditionJson: '{"path":"flags.open","eq":false}',
      order: 2,
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'ending',
      kind: 'ending',
      title: '原始结局',
      order: 3,
    })
    expect((await validateNarrativeModule(ownership.scope, module.id!)).valid).toBe(true)
    const originalEntry = await db.narrativeNodes.where('moduleId').equals(module.id!).filter(node => node.key === 'entry').first()
    const duplicateEntry = structuredClone(originalEntry!) as Record<string, unknown>
    delete duplicateEntry.id
    const duplicateId = await db.narrativeNodes.add(duplicateEntry as any) as number
    const duplicateReport = await validateNarrativeModule(ownership.scope, module.id!)
    expect(duplicateReport.valid).toBe(false)
    expect(duplicateReport.errors).toContain('[narrative] 模块包含重复节点 key')
    await db.narrativeNodes.delete(duplicateId)
    const revision = await createWorldRevision({
      scope: ownership.scope,
      label: '冻结运行修订',
      selectedTables: worldReleaseSectionTables('narrative'),
      selectedNarrativeModuleIds: [module.id!],
    })
    const release = await publishWorldRevision(revision.id!)
    const releaseManifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2
    const exportId = releaseManifest.selectedNarrativeModules[0].exportId
    await db.narrativeNodes.where('moduleId').equals(module.id!).modify(node => {
      node.title = `草稿已修改-${node.title}`
      node.updatedAt = Date.now()
    })

    await expect(createWorldInstance({
      scope: ownership.scope,
      kind: 'storygame',
      title: '不得猜测草稿模块',
      releaseId: release.id,
      narrativeModuleId: module.id,
    })).rejects.toThrow('必须绑定不可变 GameRelease')
    await expect(createWorldInstance({
      scope: ownership.scope,
      kind: 'storygame',
      title: '不得省略冻结叙事',
      releaseId: release.id,
    })).rejects.toThrow('必须绑定不可变 GameRelease')

    const kinds: SimulationSessionKind[] = ['ttrpg', 'chatgame', 'npc-evolution']
    const sessions = await Promise.all(kinds.map(kind => createWorldInstance({
      scope: ownership.scope,
      kind,
      title: `${kind} 冻结实例`,
      releaseId: release.id,
      releaseNarrativeModuleExportId: exportId,
      seed: `fixed-${kind}`,
    })))
    const initial = await readSimulationState(sessions[0].id!)
    expect(initial.narrative).toMatchObject({
      sourceModuleId: null,
      sourceModuleExportId: exportId,
      currentNodeKey: 'entry',
      availableNodeKeys: ['allowed'],
      variables: { flags: { open: true }, score: 1 },
    })
    expect(initial.narrative?.nodes.find(node => node.key === 'entry')?.title).toBe('原始入口')
    expect((await readSimulationState(sessions[1].id!)).narrative?.currentNodeKey).toBe('entry')

    await expect(advanceSimulationNarrative({ sessionId: sessions[0].id!, targetNodeKey: 'blocked', baseSequence: 0 }))
      .rejects.toThrow('不是当前条件允许的后继')
    await expect(appendSimulationEvent({
      sessionId: sessions[0].id!,
      type: 'narrative.node.advanced',
      payload: { fromNodeKey: 'entry', toNodeKey: 'allowed' },
    })).rejects.toThrow('专用 API')
    expect(await db.simulationEvents.where('sessionId').equals(sessions[0].id!).count()).toBe(0)

    await advanceSimulationNarrative({ sessionId: sessions[0].id!, targetNodeKey: 'allowed', baseSequence: 0 })
    const afterChoice = await readSimulationState(sessions[0].id!)
    expect(afterChoice.narrative).toMatchObject({ currentNodeKey: 'allowed', availableNodeKeys: ['ending'], variables: { flags: { open: true }, score: 3 } })
    await expect(advanceSimulationNarrative({ sessionId: sessions[0].id!, targetNodeKey: 'ending', baseSequence: 0 }))
      .rejects.toThrow('叙事分支已变化')
    const checkpoint = await createSimulationCheckpoint({ sessionId: sessions[0].id!, name: '选择后', throughSequence: 1 })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true)

    await advanceSimulationNarrative({ sessionId: sessions[0].id!, targetNodeKey: 'ending', baseSequence: 1 })
    const completed = await readSimulationState(sessions[0].id!)
    expect(completed.narrative).toMatchObject({ currentNodeKey: 'ending', completed: true, visitedNodeKeys: ['entry', 'allowed', 'ending'] })
    expect(await readSimulationState(sessions[0].id!)).toEqual(completed)
    expect((await readSimulationState(sessions[1].id!)).narrative?.currentNodeKey).toBe('entry')

    const branch = await branchSimulationSession({
      parentSessionId: sessions[0].id!,
      throughSequence: 1,
      title: '选择后分支',
      seed: 'branch-fixed',
    })
    expect(branch).toMatchObject({
      worldReleaseId: release.id,
      narrativeModuleExportId: exportId,
      parentThroughSequence: 1,
    })
    expect((await readSimulationState(branch.id!)).narrative?.currentNodeKey).toBe('allowed')
    await advanceSimulationNarrative({ sessionId: branch.id!, targetNodeKey: 'ending', baseSequence: 0 })
    expect((await readSimulationState(branch.id!)).narrative?.completed).toBe(true)
    expect(await db.simulationEvents.where('sessionId').equals(sessions[0].id!).count()).toBe(2)
    expect(await db.simulationEvents.where('sessionId').equals(branch.id!).count()).toBe(1)
    await assertReleaseUnchanged(release.id!)
  })
})
