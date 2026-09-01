import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  createStarterNarrativeModule,
  validateNarrativeModule,
} from '../../src/lib/narrative/blueprint'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createWorldPackage, inspectWorldPackage } from '../../src/lib/product/world-package'
import {
  appendSimulationEvent,
  branchSimulationSession,
  createSimulationSession,
  createSimulationCheckpoint,
  readSimulationState,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import type { NarrativeModuleKind, WorldReleaseManifestV2, WorkspaceScope } from '../../src/lib/types'
import { createWorkspace as createWorkspaceRoot } from '../../src/lib/world-engine/create-workspace'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import {
  assertReleaseUnchanged,
  createWorldRevision,
  publishWorldRevision,
  worldReleaseSectionTables,
} from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import { createWorldWork, selectWorkNarrativeModule } from '../../src/lib/world-engine/works'

async function createWorkspace(name: string) {
  return createWorkspaceRoot({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: 'WORLD-2D..2F 边界闭环测试',
    targetWordCount: 100_000,
    enableMultiWorld: true,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
}

describe('WORLD-2D..2F · 世界语义发布与产品阶段闸门', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('五类作品叙事入口可执行且按 Work 隔离，但仍属于作品/产品私域', async () => {
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

    await expect(createWorldRevision({
      scope: ownership.scope,
      label: '不得封存产品叙事',
      selectedNarrativeModuleIds: [moduleA.id!],
    })).rejects.toThrow('上层产品')
  })

  it('发布范围只由 worldSemantic 注册表派生；可选正文，排除参考资料、媒资和可执行蓝图', async () => {
    const ownership = await createWorkspace('发布范围裁剪')
    const scope = ownership.scope
    const now = Date.now()
    await createStarterNarrativeModule({ scope, owner: 'work', kind: 'main', title: '产品私有主线' })
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId: scope.projectId,
      worldOrigin: '冻结世界基础',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
      projectId: scope.projectId,
      logline: '冻结故事核心',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId: scope.projectId,
      name: '冻结角色',
      role: 'protagonist',
      description: '',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' })) as number
    await db.workCharacterBindings.add(stampNewRecord(scope, 'workCharacterBindings', {
      projectId: scope.projectId,
      characterId,
      role: '主角',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId,
      parentId: null,
      worldGroupId: null,
      type: 'chapter',
      title: '冻结章纲',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' })) as number
    await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', {
      projectId: scope.projectId,
      outlineNodeId: outlineId,
      scenes: [],
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId,
      outlineNodeId: outlineId,
      title: '可选择封存的正文',
      content: '<p>正文原文</p>',
      wordCount: 4,
      status: 'draft',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    await db.references.add(stampNewRecord(scope, 'references', {
      projectId: scope.projectId,
      title: '产品私有参考资料',
      author: '',
      type: 'story',
      note: '',
      url: '',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))

    const selectedTables = [
      ...worldReleaseSectionTables('foundation'),
      ...worldReleaseSectionTables('narrative'),
      ...worldReleaseSectionTables('outline'),
    ]
    const revision = await createWorldRevision({ scope, label: '不含角色的修订', selectedTables })
    const manifest = JSON.parse(revision.manifestJson) as WorldReleaseManifestV2
    expect(manifest.records.worldviews).toHaveLength(1)
    expect(manifest.records.storyCores).toHaveLength(1)
    expect(manifest.records.outlineNodes).toHaveLength(1)
    expect(manifest.records.detailedOutlines).toHaveLength(1)
    expect(manifest.records.chapters).toHaveLength(1)
    expect(manifest.records.characters).toBeUndefined()
    expect(manifest.records.workCharacterBindings).toBeUndefined()
    expect(manifest.records.references).toBeUndefined()
    expect(manifest.records.narrativeModules).toBeUndefined()
    expect(manifest.selectedNarrativeModules).toEqual([])
    expect((manifest.portableProject as Record<string, unknown>).references).toBeUndefined()

    const allSections = ['foundation', 'characters', 'narrative', 'outline'] as const
    const fullRevision = await createWorldRevision({
      scope,
      label: '完整语义范围修订',
      parentRevisionId: revision.id,
      selectedTables: allSections.flatMap(worldReleaseSectionTables),
    })
    const fullManifest = JSON.parse(fullRevision.manifestJson) as WorldReleaseManifestV2
    expect(fullManifest.records.characters).toHaveLength(1)
    expect(fullManifest.records.workCharacterBindings).toHaveLength(1)
    expect(fullManifest.records.chapters).toHaveLength(1)
    expect(fullManifest.records.references).toBeUndefined()
    expect(fullManifest.records.narrativeModules).toBeUndefined()

    const repeatedRevision = await createWorldRevision({
      scope,
      label: '相同内容再次冻结',
      parentRevisionId: fullRevision.id,
      selectedTables: allSections.flatMap(worldReleaseSectionTables),
    })
    expect(repeatedRevision.contentHash).toBe(fullRevision.contentHash)

    const release = await publishWorldRevision(repeatedRevision.id!)
    const pkg = await createWorldPackage(release.id!, {
      authorName: '测试作者',
      license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
    })
    const tampered = structuredClone(pkg)
    tampered.release.manifest.selectedTables.push(tampered.release.manifest.selectedTables[0])
    const report = await inspectWorldPackage(tampered)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('selectedTables 不允许重复')

    const mismatched = structuredClone(pkg)
    const portableStoryCores = mismatched.release.manifest.portableProject.storyCores as Array<Record<string, unknown>>
    portableStoryCores[0].logline = '与冻结 records 不一致的内容'
    const mismatchReport = await inspectWorldPackage(mismatched)
    expect(mismatchReport.valid).toBe(false)
    expect(mismatchReport.errors.join('；')).toContain('WorldRelease contentHash 不匹配')
  })

  it('WorldRelease 不能绕过产品生产直接运行；仅私域演化内核可确定回放、检查点和分支', async () => {
    const ownership = await createWorkspace('三阶段运行闸门')
    const scope = ownership.scope
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId: scope.projectId,
      worldOrigin: '冻结世界原点',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any, { owner: 'world' }))
    const revision = await createWorldRevision({ scope, label: '语义世界修订' })
    const release = await publishWorldRevision(revision.id!)

    for (const kind of ['ttrpg', 'chatgame', 'storygame'] as const) {
      await expect(createWorldInstance({
        scope,
        kind,
        title: `${kind} 不得直跑`,
        releaseId: release.id,
      } as any)).rejects.toThrow('必须且只能绑定一个 Product Release/Build')
    }

    const session = await createSimulationSession({
      projectId: scope.projectId,
      kind: 'npc-evolution',
      title: '产品私域演化内核',
      seed: 'fixed-evolution',
    })
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 2 } })
    const state = await readSimulationState(session.id!)
    expect(state.clock).toBe(2)
    expect(await readSimulationState(session.id!)).toEqual(state)
    const checkpoint = await createSimulationCheckpoint({ sessionId: session.id!, name: '推进后', throughSequence: 1 })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true)

    const branch = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence: 1,
      title: '私域演化分支',
      seed: 'branch-fixed',
    })
    expect(branch).toMatchObject({
      gameReleaseId: null,
      gameBuildId: null,
      runtimeSourceHash: null,
      parentThroughSequence: 1,
    })
    expect((await readSimulationState(branch.id!)).clock).toBe(2)
    await assertReleaseUnchanged(release.id!)
  })
})
