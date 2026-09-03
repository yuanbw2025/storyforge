import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { db } from '../../src/lib/db/schema'
import { generateWorkCode, generateWorkspaceUid } from '../../src/lib/memory/identity'
import {
  adoptWorkspaceFileChangesV1,
  buildWorkspaceFileAdoptionCandidatesV1,
  buildWorkspaceSelfCheckReportV1,
  confirmMissingChapterFileDeletionsV1,
  restoreWorkspaceFromFolderV1,
  synchronizeProjectChangesToFolderV1,
} from '../../src/lib/memory/workspace-projection'
import { buildWorkspaceImpactPlanV1 } from '../../src/lib/memory/workspace-impact'
import { createContextManifestV1, createContextManifestV2FromV1 } from '../../src/lib/agent/run/context-manifest'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError')
}

function memoryDirectory() {
  type Dir = { files: Map<string, string>; dirs: Map<string, Dir> }
  const root: Dir = { files: new Map(), dirs: new Map() }

  const handle = (dir: Dir, prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory',
    name: prefix.split('/').filter(Boolean).at(-1) ?? 'semantic-memory',
    async getDirectoryHandle(part: string, options?: { create?: boolean }) {
      let child = dir.dirs.get(part)
      if (!child && options?.create) {
        child = { files: new Map(), dirs: new Map() }
        dir.dirs.set(part, child)
      }
      if (!child) throw notFound()
      return handle(child, `${prefix}${part}/`)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!dir.files.has(name) && !options?.create) throw notFound()
      if (!dir.files.has(name)) dir.files.set(name, '')
      return {
        kind: 'file',
        name,
        async getFile() {
          const text = dir.files.get(name)
          if (text == null) throw notFound()
          return { async text() { return text } } as File
        },
        async createWritable() {
          let next = ''
          return {
            async write(value: string | Blob | BufferSource) { next += String(value) },
            async close() { dir.files.set(name, next) },
          } as FileSystemWritableFileStream
        },
      } as FileSystemFileHandle
    },
  } as FileSystemDirectoryHandle)

  const locate = (path: string): { dir: Dir; name: string } => {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    let dir = root
    for (const part of parts) {
      const next = dir.dirs.get(part)
      if (!next) throw notFound()
      dir = next
    }
    return { dir, name }
  }

  return {
    handle: handle(root, ''),
    read(path: string): string {
      const target = locate(path)
      const text = target.dir.files.get(target.name)
      if (text == null) throw notFound()
      return text
    },
    write(path: string, text: string): void {
      const target = locate(path)
      target.dir.files.set(target.name, text)
    },
    remove(path: string): void {
      const target = locate(path)
      target.dir.files.delete(target.name)
    },
  }
}

async function seedTwoWorks() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: '双作品语义记忆',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 200_000,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const first = await ensureWorkspaceOwnership(projectId)
  const secondWorldId = await db.worlds.add({
    projectId,
    code: 'WORLD-SEMANTIC-SECOND',
    name: '第二世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const secondWorkId = await db.works.add({
    projectId,
    worldId: secondWorldId,
    code: generateWorkCode(),
    title: '第二作品',
    description: '',
    genres: ['mystery'],
    status: 'drafting',
    targetWordCount: 80_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  const addChapter = async (scope: { projectId: number; worldId: number; workId: number }, title: string) => {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId, workId: scope.workId, parentId: null, type: 'chapter', title, summary: '', order: 0,
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as any) as number
    return db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId, workId: scope.workId, outlineNodeId, title, content: `<p>${title}正文</p>`,
      wordCount: 5, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as any) as Promise<number>
  }
  const secondScope = { projectId, worldId: secondWorldId, workId: secondWorkId }
  const firstChapterId = await addChapter(first.scope, '第一作品第一章')
  const secondChapterId = await addChapter(secondScope, '第二作品第一章')

  const storyCore = (workId: number, suffix: string) => ({
    projectId, workId,
    theme: `主题${suffix}`,
    centralConflict: `冲突${suffix}`,
    plotPattern: '线性',
    mainPlot: `主线${suffix}`,
    logline: `一句话${suffix}`,
    concept: `概念${suffix}`,
    subPlots: `复线${suffix}`,
    createdAt: now,
    updatedAt: now,
  })
  const rules = (workId: number, suffix: string) => ({
    projectId, workId,
    writingStyle: `克制${suffix}`,
    narrativePOV: 'third-limited' as const,
    toneAndMood: `冷峻${suffix}`,
    atmosphere: `冷峻${suffix}`,
    prohibitions: JSON.stringify([`禁止${suffix}`]),
    consistencyRules: JSON.stringify([`规则${suffix}`]),
    specialRequirements: `要求${suffix}`,
    referenceWorks: '[]',
    citedReferenceIds: '[]',
    citedInsightIds: '[]',
    createdAt: now,
    updatedAt: now,
  })
  const firstStoryId = await db.storyCores.add(stampNewRecord(first.scope, 'storyCores', storyCore(first.scope.workId, '甲'), { owner: 'work' }) as any) as number
  const secondStoryId = await db.storyCores.add(stampNewRecord(secondScope, 'storyCores', storyCore(secondWorkId, '乙'), { owner: 'work' }) as any) as number
  const firstRulesId = await db.creativeRules.add(stampNewRecord(first.scope, 'creativeRules', rules(first.scope.workId, '甲'), { owner: 'work' }) as any) as number
  const secondRulesId = await db.creativeRules.add(stampNewRecord(secondScope, 'creativeRules', rules(secondWorkId, '乙'), { owner: 'work' }) as any) as number
  return {
    projectId,
    firstScope: first.scope,
    firstWorkId: first.scope.workId,
    secondWorkId,
    firstChapterId,
    secondChapterId,
    firstStoryId,
    secondStoryId,
    firstRulesId,
    secondRulesId,
  }
}

async function initialSync(projectId: number, disk: ReturnType<typeof memoryDirectory>) {
  const report = await buildWorkspaceSelfCheckReportV1(projectId, disk.handle)
  await synchronizeProjectChangesToFolderV1({
    projectId,
    root: disk.handle,
    expectedPlanHash: report.plan.planHash,
  })
}

describe('MEMORY-CLOSE-2 · Work 级故事核心与创作规则可编辑镜像', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('输出不含内部 ID 的中文语义文件，并经零模型候选、CAS 与影响计划回写当前 Work', async () => {
    const seeded = await seedTwoWorks()
    const disk = memoryDirectory()
    await initialSync(seeded.projectId, disk)
    const bindings = await db.workspaceDocuments.where('projectId').equals(seeded.projectId).toArray()
    const semantic = bindings.filter(binding => ['storyCores', 'creativeRules'].includes(binding.tableName))
    expect(semantic).toHaveLength(4)
    expect(new Set(semantic.map(binding => binding.workCode))).toHaveLength(2)

    const firstStory = semantic.find(binding => binding.tableName === 'storyCores' && binding.recordId === seeded.firstStoryId)!
    const firstRules = semantic.find(binding => binding.tableName === 'creativeRules' && binding.recordId === seeded.firstRulesId)!
    const storyYaml = parseYaml(disk.read(firstStory.relativePath))
    expect(storyYaml.data).toMatchObject({ 主题: '主题甲', 故事主线: '主线甲' })
    expect(storyYaml.data).not.toHaveProperty('id')
    expect(storyYaml.data).not.toHaveProperty('workId')
    expect(storyYaml.data).not.toHaveProperty('createdAt')
    const contextV1 = await createContextManifestV1({
      version: 1,
      runId: 1,
      stepId: 'semantic-provenance',
      attempt: 1,
      scope: { projectId: seeded.projectId, worldGroupId: null },
      inputBudget: 100,
      totalInputTokens: 2,
      sources: [{ key: 'storyCore', status: 'included', contentHash: 'a'.repeat(64), tokens: 2 }],
    })
    const contextV2 = await createContextManifestV2FromV1({ manifest: contextV1, scope: seeded.firstScope })
    expect(contextV2.sources[0].provenance.mirrorDocumentIds).toEqual([firstStory.documentId])
    expect(contextV2.sources[0].provenance.editPolicy).toBe('author-editable')
    storyYaml.data.主题 = '作者从硬盘修订的主题'
    storyYaml.data.故事主线 = '第一作品的新主线'
    disk.write(firstStory.relativePath, stringifyYaml(storyYaml, { lineWidth: 0, sortMapEntries: true }))

    const rulesYaml = parseYaml(disk.read(firstRules.relativePath))
    expect(rulesYaml.data).not.toHaveProperty('citedReferenceIds')
    rulesYaml.data.叙事视角 = '多视角'
    rulesYaml.data.禁止事项 = ['禁止无证据复活', '禁止跨 Work 串线']
    disk.write(firstRules.relativePath, stringifyYaml(rulesYaml, { lineWidth: 0, sortMapEntries: true }))

    const report = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(report.zeroModelCalls).toBe(true)
    expect(report.summary.fileChanged).toBe(2)
    const candidates = await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: report.plan.planHash,
    })
    expect(candidates.candidates).toHaveLength(2)
    expect(candidates.candidates.find(item => item.tableName === 'storyCores')?.changedFields)
      .toEqual(['mainPlot', 'theme'])
    expect(candidates.candidates.find(item => item.tableName === 'creativeRules')?.changedFields)
      .toEqual(['narrativePOV', 'prohibitions'])

    const impact = await buildWorkspaceImpactPlanV1({ projectId: seeded.projectId, candidateSet: candidates })
    expect(impact.zeroModelCalls).toBe(true)
    expect(impact.items.some(item => item.targetRecordId === seeded.firstChapterId)).toBe(true)
    expect(impact.items.some(item => item.targetRecordId === seeded.secondChapterId)).toBe(false)

    await adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: report.plan.planHash,
    })
    expect(await db.storyCores.get(seeded.firstStoryId)).toMatchObject({
      theme: '作者从硬盘修订的主题',
      mainPlot: '第一作品的新主线',
    })
    expect(await db.creativeRules.get(seeded.firstRulesId)).toMatchObject({
      narrativePOV: 'multi-pov',
      prohibitions: JSON.stringify(['禁止无证据复活', '禁止跨 Work 串线']),
    })
    expect((await db.storyCores.get(seeded.secondStoryId))?.theme).toBe('主题乙')
    expect((await db.creativeRules.get(seeded.secondRulesId))?.narrativePOV).toBe('third-limited')
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)).summary.fileChanged).toBe(0)
  })

  it('篡改 Work 身份会隔离，缺失语义文件只能恢复而不能借章节删除入口删掉正式内容', async () => {
    const seeded = await seedTwoWorks()
    const disk = memoryDirectory()
    await initialSync(seeded.projectId, disk)
    const firstStory = (await db.workspaceDocuments.where('tableName').equals('storyCores').toArray())
      .find(binding => binding.recordId === seeded.firstStoryId)!
    const secondStory = (await db.workspaceDocuments.where('tableName').equals('storyCores').toArray())
      .find(binding => binding.recordId === seeded.secondStoryId)!
    const original = disk.read(firstStory.relativePath)
    const tampered = parseYaml(original)
    tampered.storyforge.workCode = secondStory.workCode
    disk.write(firstStory.relativePath, stringifyYaml(tampered, { lineWidth: 0, sortMapEntries: true }))

    const invalid = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(invalid.summary.invalid).toBe(1)
    const staged = await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: invalid.plan.planHash,
    })
    expect(staged.candidates).toHaveLength(0)
    expect(staged.blockedDocumentIds).toContain(firstStory.documentId)
    await expect(adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: invalid.plan.planHash,
    })).rejects.toThrow('待处理')

    disk.write(firstStory.relativePath, original)
    disk.remove(firstStory.relativePath)
    const missing = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(missing.summary.missing).toBe(1)
    await expect(confirmMissingChapterFileDeletionsV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: missing.plan.planHash,
    })).rejects.toThrow('不允许按文件删除')
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: missing.plan.planHash,
    })
    expect(disk.read(firstStory.relativePath)).toContain('主题甲')
    expect(await db.storyCores.get(seeded.firstStoryId)).not.toBeUndefined()
  })

  it('双方修改必须显式选择，且同一 Work 出现重复单例时停止投影', async () => {
    const seeded = await seedTwoWorks()
    const disk = memoryDirectory()
    await initialSync(seeded.projectId, disk)
    const binding = (await db.workspaceDocuments.where('tableName').equals('storyCores').toArray())
      .find(item => item.recordId === seeded.firstStoryId)!
    const file = parseYaml(disk.read(binding.relativePath))
    file.data.主题 = '硬盘版本主题'
    disk.write(binding.relativePath, stringifyYaml(file, { lineWidth: 0, sortMapEntries: true }))
    await db.storyCores.update(seeded.firstStoryId, { theme: '项目版本主题', updatedAt: Date.now() })

    const conflict = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(conflict.summary.conflict).toBe(1)
    await expect(adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: conflict.plan.planHash,
    })).rejects.toThrow('待处理')
    await adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: conflict.plan.planHash,
      conflictResolution: 'file-wins',
    })
    expect((await db.storyCores.get(seeded.firstStoryId))?.theme).toBe('硬盘版本主题')

    await db.storyCores.add({
      ...(await db.storyCores.get(seeded.firstStoryId))!,
      id: undefined,
      theme: '重复单例',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    await expect(buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle))
      .rejects.toThrow('存在多份 storyCores 单例')
  })

  it('浏览器数据库丢失后从只读恢复胶囊重建语义记录，并把稳定文档身份重绑到新主键', async () => {
    const seeded = await seedTwoWorks()
    const disk = memoryDirectory()
    await initialSync(seeded.projectId, disk)
    const originalDocumentIds = (await db.workspaceDocuments.where('projectId').equals(seeded.projectId).toArray())
      .filter(binding => ['storyCores', 'creativeRules'].includes(binding.tableName))
      .map(binding => binding.documentId)
      .sort()

    await db.delete()
    await db.open()
    const restored = await restoreWorkspaceFromFolderV1(disk.handle)
    expect(await db.storyCores.where('projectId').equals(restored.projectId).count()).toBe(2)
    expect(await db.creativeRules.where('projectId').equals(restored.projectId).count()).toBe(2)
    const restoredBindings = (await db.workspaceDocuments.where('projectId').equals(restored.projectId).toArray())
      .filter(binding => ['storyCores', 'creativeRules'].includes(binding.tableName))
    expect(restoredBindings.map(binding => binding.documentId).sort()).toEqual(originalDocumentIds)
    expect(restoredBindings.every(binding => binding.workCode && binding.recordId > 0)).toBe(true)
    expect(restored.report.plan.items.every(item => item.changeKind === 'clean')).toBe(true)
  })
})
