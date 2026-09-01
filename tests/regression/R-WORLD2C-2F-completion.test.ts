import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  addNarrativeNode,
  createNarrativeModule,
  executeNarrativeNode,
  projectStoryArcsToNarrative,
  validateNarrativeModule,
} from '../../src/lib/narrative/blueprint'
import {
  createWorldPackage,
  importWorldPackage,
  inspectWorldPackage,
} from '../../src/lib/product/world-package'
import { appendSimulationEvent, branchSimulationSession, createSimulationSession, readSimulationState } from '../../src/lib/simulation/runtime'
import type { WorldReleaseManifestV2, WorkspaceScope } from '../../src/lib/types'
import { createWorkspace as createWorkspaceRoot } from '../../src/lib/world-engine/create-workspace'
import { createWorldInstance, readBoundInstances } from '../../src/lib/world-engine/instances'
import { deleteWork, deleteWorld } from '../../src/lib/world-engine/lifecycle'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { changeRecordScope } from '../../src/lib/world-engine/scope-conversion'
import {
  assertReleaseUnchanged,
  createWorldRevision,
  diffWorldRevisions,
  listWorldReleases,
  listWorldRevisions,
  publishWorldRevision,
} from '../../src/lib/world-engine/releases'
import {
  createWorldWork,
  selectWorkNarrativeModule,
  switchActiveWork,
  updateProjectAndActiveWork,
} from '../../src/lib/world-engine/works'

const PACKAGE_OPTIONS = {
  authorName: '世界作者',
  license: 'CC-BY-4.0' as const,
  allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
}

async function createWorkspace(name = 'WORLD-2 完成项目') {
  return createWorkspaceRoot({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '世界引擎完成判据',
    targetWordCount: 100_000,
    enableMultiWorld: true,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
}

function stages(prefix: string) {
  return JSON.stringify([
    { id: `${prefix}-start`, title: `${prefix}入口`, description: '进入故事', keyEvents: [] },
    { id: `${prefix}-end`, title: `${prefix}结局`, description: '完成故事', keyEvents: [] },
  ])
}

async function seedThreeArcs(scope: WorkspaceScope) {
  const now = Date.now()
  for (const [name, type] of [['主线', 'main'], ['支线一', 'sub'], ['支线二', 'sub']] as const) {
    await db.storyArcs.add({
      projectId: scope.projectId,
      worldId: null,
      workId: scope.workId,
      name,
      type,
      stages: stages(name),
      description: `${name}说明`,
      createdAt: now,
      updatedAt: now,
    } as any)
  }
  return projectStoryArcsToNarrative(scope)
}

describe('WORLD-2C C4/C5 · strict ownership and lifecycle completion', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('v4 owner 缺失或越界时在写库前拒绝，项目根零新增', async () => {
    const ownership = await createWorkspace('严格备份')
    await db.storyCores.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      logline: '不能越界',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    const backup = await exportProjectJSON(ownership.scope.projectId)
    expect(backup.version).toBe(9)
    const beforeProjects = await db.projects.count()
    const damaged = structuredClone(backup) as any
    damaged.storyCores[0]._workOwnerExportId = 999999

    await expect(importProjectJSON(damaged)).rejects.toThrow('owner 越界')
    expect(await db.projects.count()).toBe(beforeProjects)

    const missing = structuredClone(backup) as any
    delete missing.storyCores[0]._workOwnerExportId
    await expect(importProjectJSON(missing)).rejects.toThrow('owner 缺失或越界')
    expect(await db.projects.count()).toBe(beforeProjects)
  })

  it('删除 Work 级联父归属节点，但不影响另一 Work 或 World Canon', async () => {
    const ownership = await createWorkspace('双作品删除隔离')
    const workA = ownership.work
    const workB = await createWorldWork(ownership.scope.projectId, { title: '作品 B' })
    const scopeA = ownership.scope
    const scopeB = { ...ownership.scope, workId: workB.id! }
    const moduleA = await createNarrativeModule({ scope: scopeA, owner: 'work', kind: 'main', title: 'A 主线' })
    const moduleB = await createNarrativeModule({ scope: scopeB, owner: 'work', kind: 'main', title: 'B 主线' })
    await addNarrativeNode({ scope: scopeA, moduleId: moduleA.id!, key: 'a', kind: 'entry', title: 'A 入口', successorKeys: ['a-end'] })
    await addNarrativeNode({ scope: scopeA, moduleId: moduleA.id!, key: 'a-end', kind: 'ending', title: 'A 结局' })
    await addNarrativeNode({ scope: scopeB, moduleId: moduleB.id!, key: 'b', kind: 'entry', title: 'B 入口', successorKeys: ['b-end'] })
    await addNarrativeNode({ scope: scopeB, moduleId: moduleB.id!, key: 'b-end', kind: 'ending', title: 'B 结局' })
    await db.worldviews.add({
      projectId: scopeA.projectId,
      worldId: scopeA.worldId,
      worldOrigin: '共享世界 Canon',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    await deleteWork(workA.id!)

    expect(await db.works.get(workA.id!)).toBeUndefined()
    expect(await db.narrativeModules.get(moduleA.id!)).toBeUndefined()
    expect(await db.narrativeNodes.where('moduleId').equals(moduleA.id!).count()).toBe(0)
    expect(await db.works.get(workB.id!)).toBeDefined()
    expect(await db.narrativeModules.get(moduleB.id!)).toBeDefined()
    expect(await db.narrativeNodes.where('moduleId').equals(moduleB.id!).count()).toBe(2)
    expect((await db.worldviews.toArray()).filter(row => row.worldId === scopeA.worldId)).toHaveLength(1)
  })

  it('有作品的 World 未确认时拒绝删除，确认后完整清理', async () => {
    const ownership = await createWorkspace('世界删除确认')
    await expect(deleteWorld(ownership.scope.worldId)).rejects.toThrow('必须显式确认')
    expect(await db.worlds.get(ownership.scope.worldId)).toBeDefined()
    await deleteWorld(ownership.scope.worldId, { confirm: true })
    expect(await db.worlds.get(ownership.scope.worldId)).toBeUndefined()
    expect(await db.works.where('worldId').equals(ownership.scope.worldId).count()).toBe(0)
  })

  it('切换和删除活动 Work 时完整刷新 Project 兼容镜像，项目编辑反写当前 Work', async () => {
    const ownership = await createWorkspace('镜像作品 A')
    await db.works.update(ownership.scope.workId, {
      title: '作品 A',
      description: 'A 简介',
      genres: ['fantasy'],
      status: 'drafting',
      targetWordCount: 111000,
      currentWordCount: 1100,
      coverImage: 'cover-a',
      writingStyleId: 'style-a',
      methodologyId: 'method-a',
      updatedAt: Date.now(),
    })
    const workB = await createWorldWork(ownership.scope.projectId, { title: '作品 B' })
    await db.works.update(workB.id!, {
      description: 'B 简介',
      genres: ['mystery'],
      status: 'ongoing',
      targetWordCount: 222000,
      currentWordCount: 2200,
      coverImage: 'cover-b',
      writingStyleId: 'style-b',
      methodologyId: 'method-b',
      updatedAt: Date.now() + 1,
    })

    await switchActiveWork(ownership.scope.projectId, workB.id!)
    expect(await db.projects.get(ownership.scope.projectId)).toMatchObject({
      activeWorldId: ownership.scope.worldId,
      activeWorkId: workB.id,
      name: '作品 B',
      description: 'B 简介',
      genre: 'mystery',
      genres: ['mystery'],
      status: 'ongoing',
      targetWordCount: 222000,
      currentWordCount: 2200,
      coverImage: 'cover-b',
      writingStyleId: 'style-b',
      methodologyId: 'method-b',
    })

    await updateProjectAndActiveWork(ownership.scope.projectId, {
      name: '作品 B 改名',
      description: 'B 新简介',
      genres: ['sci-fi'],
      genre: 'sci-fi',
      targetWordCount: 333000,
      writingStyleId: 'style-b2',
    })
    expect(await db.works.get(workB.id!)).toMatchObject({
      title: '作品 B 改名',
      description: 'B 新简介',
      genres: ['sci-fi'],
      targetWordCount: 333000,
      writingStyleId: 'style-b2',
    })

    await deleteWork(workB.id!)
    expect(await db.projects.get(ownership.scope.projectId)).toMatchObject({
      activeWorkId: ownership.scope.workId,
      name: '作品 A',
      description: 'A 简介',
      genre: 'fantasy',
      genres: ['fantasy'],
      targetWordCount: 111000,
      currentWordCount: 1100,
      coverImage: 'cover-a',
      writingStyleId: 'style-a',
      methodologyId: 'method-a',
    })
  })

  it('伪造 World/Work scope 创建实例时拒绝且不产生任何运行记录', async () => {
    const ownership = await createWorkspace('伪造实例作用域')
    const forged = { ...ownership.scope, workId: ownership.scope.workId + 9999 }
    const before = await db.simulationSessions.count()

    await expect(createWorldInstance({
      scope: forged,
      kind: 'chatgame',
      title: '不得创建',
      draftSnapshotHash: 'forged-draft',
    } as any)).rejects.toThrow('有效 World/Work')
    expect(await db.simulationSessions.count()).toBe(before)
    await expect(readBoundInstances(forged)).rejects.toThrow('有效 World/Work')
  })
})

describe('WORLD-2D · executable narrative blueprint completion', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('同一 Work 投影一条主线和两条支线，全部可达并可选择为当前叙事', async () => {
    const ownership = await createWorkspace('三线叙事')
    const modules = await seedThreeArcs(ownership.scope)
    expect(modules.map(module => module.kind)).toEqual(['main', 'side', 'side'])
    for (const module of modules) {
      const report = await validateNarrativeModule(ownership.scope, module.id!)
      expect(report.valid, module.title).toBe(true)
      expect(report.reachableKeys).toHaveLength(2)
    }
    await selectWorkNarrativeModule(ownership.scope, modules[1].id!)
    expect((await db.works.get(ownership.scope.workId))?.activeNarrativeModuleId).toBe(modules[1].id)
  })

  it('条件、效果、选择和悬空后继使用严格 JSON 与可达性校验', async () => {
    const ownership = await createWorkspace('选择叙事')
    const module = await createNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'quest', title: '分岔任务' })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'entry',
      kind: 'entry',
      title: '入口',
      successorKeys: ['choice'],
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'choice',
      kind: 'choice',
      title: '选择',
      conditionJson: '{"path":"flags.gateOpen","eq":true}',
      effectsJson: '[{"op":"set","path":"flags.chosen","value":true}]',
      successorKeys: ['ending-a', 'ending-b'],
    })
    for (const key of ['ending-a', 'ending-b']) {
      await addNarrativeNode({ scope: ownership.scope, moduleId: module.id!, key, kind: 'ending', title: key })
    }
    expect(await validateNarrativeModule(ownership.scope, module.id!)).toMatchObject({ valid: true, unreachableKeys: [] })
    const step = await executeNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      nodeKey: 'choice',
      state: { flags: { gateOpen: true } },
    })
    expect(step.state).toMatchObject({ flags: { gateOpen: true, chosen: true } })
    expect(step.successorNodes.map(node => node.key)).toEqual(['ending-a', 'ending-b'])
    await expect(addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'bad',
      kind: 'scene',
      title: '坏节点',
      effectsJson: '{}',
    })).rejects.toThrow('JSON 数组')
  })

  it('重复同步会刷新既有投影，单阶段故事线仍可执行', async () => {
    const ownership = await createWorkspace('叙事投影同步')
    const now = Date.now()
    const arcId = await db.storyArcs.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      name: '旧主线',
      type: 'main',
      stages: JSON.stringify([{ id: 'only', title: '唯一阶段', description: '旧说明', keyEvents: [] }]),
      description: '旧描述',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const first = (await projectStoryArcsToNarrative(ownership.scope))[0]
    expect(await validateNarrativeModule(ownership.scope, first.id!)).toMatchObject({ valid: true, entryKey: 'stage:1' })

    await db.storyArcs.update(arcId, {
      name: '新主线',
      stages: stages('同步后'),
      updatedAt: Date.now(),
    })
    const second = (await projectStoryArcsToNarrative(ownership.scope))[0]
    expect(second.id).toBe(first.id)
    expect(second.title).toBe('新主线')
    expect(await db.narrativeNodes.where('moduleId').equals(first.id!).count()).toBe(2)
    expect(await validateNarrativeModule(ownership.scope, first.id!)).toMatchObject({ valid: true, reachableKeys: ['stage:1', 'stage:2'] })
  })

  it('双作用域叙事可原子提升为世界资产，跨作品引用会阻止错误收回', async () => {
    const ownership = await createWorkspace('叙事作用域转换')
    const workB = await createWorldWork(ownership.scope.projectId, { title: '作品 B' })
    const scopeB = { ...ownership.scope, workId: workB.id! }
    const module = await createNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'main', title: '共享主线' })
    await addNarrativeNode({ scope: ownership.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '入口', successorKeys: ['end'] })
    await addNarrativeNode({ scope: ownership.scope, moduleId: module.id!, key: 'end', kind: 'ending', title: '结局' })

    await changeRecordScope({ scope: ownership.scope, tableName: 'narrativeModules', recordId: module.id!, targetOwner: 'world' })
    expect((await db.narrativeModules.get(module.id!))?.worldId).toBe(ownership.scope.worldId)
    expect((await db.narrativeModules.get(module.id!))?.workId).toBeNull()
    expect((await validateNarrativeModule(scopeB, module.id!)).valid).toBe(true)
    await selectWorkNarrativeModule(scopeB, module.id!)
    await expect(changeRecordScope({
      scope: ownership.scope,
      tableName: 'narrativeModules',
      recordId: module.id!,
      targetOwner: 'work',
    })).rejects.toThrow('其它作用域引用')

    const receipt = await db.ownershipMigrations.where('projectId').equals(ownership.scope.projectId).first()
    expect(receipt?.scopeChanges?.at(-1)).toMatchObject({
      tableName: 'narrativeModules',
      recordId: module.id,
      previousOwner: 'work',
      targetOwner: 'world',
    })
  })

  it('伪造 scope 创建叙事或世界修订时写入数保持为零', async () => {
    const ownership = await createWorkspace('伪造叙事作用域')
    const forged = { ...ownership.scope, worldId: ownership.scope.worldId + 9999 }

    await expect(createNarrativeModule({
      scope: forged,
      owner: 'work',
      kind: 'main',
      title: '不得创建的主线',
    })).rejects.toThrow('有效 World/Work')
    await expect(createWorldRevision({ scope: forged, label: '不得创建的修订' }))
      .rejects.toThrow('有效 World/Work')
    expect(await db.narrativeModules.count()).toBe(0)
    expect(await db.worldRevisions.count()).toBe(0)
  })

  it('非当前 Work B 的修订冻结 B 的根、兼容镜像和内容，不混入活动 Work A', async () => {
    const ownership = await createWorkspace('活动作品 A')
    const workB = await createWorldWork(ownership.scope.projectId, { title: '非活动作品 B' })
    const scopeB = { ...ownership.scope, workId: workB.id! }
    await db.storyCores.add({
      projectId: ownership.scope.projectId,
      worldId: null,
      workId: ownership.scope.workId,
      theme: 'A 的故事',
      premise: '只属于 A',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    await db.storyCores.add({
      projectId: scopeB.projectId,
      worldId: null,
      workId: scopeB.workId,
      theme: 'B 的故事',
      premise: '只属于 B',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    const revision = await createWorldRevision({
      scope: scopeB,
      label: 'B 的修订',
    })
    const manifest = JSON.parse(revision.manifestJson) as WorldReleaseManifestV2
    const portableProject = manifest.portableProject as any

    expect((await db.projects.get(scopeB.projectId))?.activeWorkId).toBe(ownership.scope.workId)
    expect(manifest.workTitle).toBe('非活动作品 B')
    expect(portableProject.project).toMatchObject({
      name: '活动作品 A',
      _activeWorkExportId: portableProject.ownership.workExportId,
    })
    expect(portableProject.works).toHaveLength(1)
    expect(portableProject.works[0].title).toBe('非活动作品 B')
    expect((manifest.records.storyCores as any[]).map(row => row.theme)).toEqual(['B 的故事'])
    expect(manifest.records.narrativeModules).toBeUndefined()
    expect(manifest.selectedNarrativeModules).toEqual([])
  })
})

describe('WORLD-2E/2F · immutable releases and unified instances', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  async function seedRelease() {
    const ownership = await createWorkspace('可发布世界')
    const modules = await seedThreeArcs(ownership.scope)
    const worldviewId = await db.worldviews.add({
      projectId: ownership.scope.projectId,
      worldId: ownership.scope.worldId,
      worldOrigin: '发布时的世界原点',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number
    await selectWorkNarrativeModule(ownership.scope, modules[0].id!)
    const revision = await createWorldRevision({
      scope: ownership.scope,
      label: '世界修订一',
    })
    const release = await publishWorldRevision(revision.id!, '世界发布一')
    return { ownership, modules, worldviewId, revision, release }
  }

  it('发布后修改草稿不改变旧 Release；新修订显示差异且 v2 可干净导入', async () => {
    const seeded = await seedRelease()
    const frozenJson = seeded.release.manifestJson
    await db.worldviews.update(seeded.worldviewId, { worldOrigin: '修改后的草稿世界', updatedAt: Date.now() })
    await db.narrativeModules.update(seeded.modules[0].id!, { title: '修改后的主线', updatedAt: Date.now() })
    await assertReleaseUnchanged(seeded.release.id!)
    expect((await db.worldReleases.get(seeded.release.id!))?.manifestJson).toBe(frozenJson)

    const revision2 = await createWorldRevision({
      scope: seeded.ownership.scope,
      label: '世界修订二',
      parentRevisionId: seeded.revision.id,
    })
    const diff = await diffWorldRevisions(seeded.revision.id!, revision2.id!)
    expect(diff.changed).toContain('worldviews')
    expect(diff.changed).not.toContain('narrativeModules')

    const pkg = await createWorldPackage(seeded.release.id!, PACKAGE_OPTIONS)
    const report = await inspectWorldPackage(pkg)
    expect(report.valid, report.errors.join('；')).toBe(true)
    const importedProjectId = await importWorldPackage(pkg)
    const importedScope = await ensureWorkspaceOwnership(importedProjectId)
    expect(await db.narrativeModules.where('projectId').equals(importedProjectId).count()).toBe(0)
    expect((await db.works.get(importedScope.scope.workId))?.activeNarrativeModuleId ?? null).toBeNull()
    expect(await db.worldReleases.where('projectId').equals(importedProjectId).count()).toBe(1)
    expect((await db.projects.get(importedProjectId))?.communityOrigin?.sourceWorldCode)
      .toBe(seeded.release.sourceWorldCode)
  })

  it('同一修订并发发布保持幂等，修订与版本列表按新到旧返回', async () => {
    const seeded = await seedRelease()
    const duplicate = await Promise.all([
      publishWorldRevision(seeded.revision.id!),
      publishWorldRevision(seeded.revision.id!),
    ])
    expect(new Set(duplicate.map(item => item.id))).toEqual(new Set([seeded.release.id]))
    expect(await db.worldReleases.where('revisionId').equals(seeded.revision.id!).count()).toBe(1)

    await db.worldviews.update(seeded.worldviewId, { worldOrigin: '第二版世界原点', updatedAt: Date.now() })
    const revision2 = await createWorldRevision({
      scope: seeded.ownership.scope,
      label: '世界修订二',
      parentRevisionId: seeded.revision.id,
    })
    const release2 = await publishWorldRevision(revision2.id!)
    expect((await listWorldRevisions(seeded.ownership.scope)).map(item => item.revision)).toEqual([2, 1])
    expect((await listWorldReleases(seeded.ownership.scope)).map(item => item.id)).toEqual([release2.id, seeded.release.id])
  })

  it('WorldRelease 只能进入产品制作；正式产品拒绝直跑，私域演化内核可确定回放和分支', async () => {
    const seeded = await seedRelease()
    for (const kind of ['ttrpg', 'chatgame'] as const) {
      await expect(createWorldInstance({
        scope: seeded.ownership.scope,
        kind,
        title: `${kind} 不得直跑`,
        releaseId: seeded.release.id,
        seed: `seed-${kind}`,
      } as any)).rejects.toThrow('必须且只能绑定一个 Product Release/Build')
    }
    const session = await createSimulationSession({
      projectId: seeded.ownership.scope.projectId,
      kind: 'npc-evolution',
      title: '产品私域演化沙箱',
      seed: 'seed-evolution',
    })
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 3 } })
    expect((await readSimulationState(session.id!)).clock).toBe(3)
    expect(await readSimulationState(session.id!)).toEqual(await readSimulationState(session.id!))

    const child = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence: 1,
      title: '私域演化分支',
    })
    expect(child).toMatchObject({
      gameReleaseId: null,
      gameBuildId: null,
      runtimeSourceHash: null,
    })
    expect((await db.worldReleases.get(seeded.release.id!))?.manifestJson).toBe(seeded.release.manifestJson)
  })
})
