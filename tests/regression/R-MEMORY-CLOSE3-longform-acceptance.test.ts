import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  refreshDurableConsistencyAuditFreshnessV1,
  runDurableConsistencyAuditV1,
} from '../../src/lib/agent/run/consistency-audit-durable'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { generateWorkCode } from '../../src/lib/memory/identity'
import {
  adoptWorkspaceFileChangesV1,
  buildWorkspaceFileAdoptionCandidatesV1,
  buildWorkspaceSelfCheckReportV1,
  confirmMissingChapterFileDeletionsV1,
  recoverPendingWorkspaceSyncV1,
  restoreWorkspaceFromFolderV1,
  synchronizeProjectChangesToFolderV1,
} from '../../src/lib/memory/workspace-projection'
import { buildWorkspaceImpactPlanV1 } from '../../src/lib/memory/workspace-impact'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { resolveScopeLike } from '../../src/lib/workspace/scope'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'

const legacyFixturePath = path.resolve(__dirname, '../fixtures/legacy-export-v3.json')
const now = 1_800_000_000_000

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError')
}

/** A deterministic File System Access double with observable writes and one-shot permission loss. */
function memoryDirectory(name = 'StoryForgeLongformAcceptance') {
  interface StoredFile { text: string; lastModified: number }
  interface Dir { files: Map<string, StoredFile>; dirs: Map<string, Dir> }
  const root: Dir = { files: new Map(), dirs: new Map() }
  const writeOrder: string[] = []
  let clock = now
  let failAtAbsoluteWrite: number | null = null

  const handle = (dir: Dir, prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory',
    name: prefix.split('/').filter(Boolean).at(-1) ?? name,
    async getDirectoryHandle(part: string, options?: { create?: boolean }) {
      let child = dir.dirs.get(part)
      if (!child && options?.create) {
        child = { files: new Map(), dirs: new Map() }
        dir.dirs.set(part, child)
      }
      if (!child) throw notFound()
      return handle(child, `${prefix}${part}/`)
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!dir.files.has(fileName) && !options?.create) throw notFound()
      if (!dir.files.has(fileName)) dir.files.set(fileName, { text: '', lastModified: ++clock })
      return {
        kind: 'file',
        name: fileName,
        async getFile() {
          const stored = dir.files.get(fileName)
          if (!stored) throw notFound()
          return {
            size: new TextEncoder().encode(stored.text).byteLength,
            lastModified: stored.lastModified,
            async text() { return stored.text },
          } as File
        },
        async createWritable() {
          let next = ''
          return {
            async write(value: string | Blob | BufferSource) { next += String(value) },
            async close() {
              if (failAtAbsoluteWrite === writeOrder.length + 1) {
                failAtAbsoluteWrite = null
                throw new DOMException('simulated permission loss', 'NotAllowedError')
              }
              dir.files.set(fileName, { text: next, lastModified: ++clock })
              writeOrder.push(`${prefix}${fileName}`)
            },
          } as FileSystemWritableFileStream
        },
      } as FileSystemFileHandle
    },
  } as FileSystemDirectoryHandle)

  const locate = (relativePath: string): { dir: Dir; name: string } => {
    const parts = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir = root
    for (const part of parts) {
      const child = dir.dirs.get(part)
      if (!child) throw notFound()
      dir = child
    }
    return { dir, name: fileName }
  }

  return {
    handle: handle(root, ''),
    writeOrder,
    failAfterMoreWrites(offset: number): void {
      failAtAbsoluteWrite = writeOrder.length + offset
    },
    read(relativePath: string): string {
      const target = locate(relativePath)
      const stored = target.dir.files.get(target.name)
      if (!stored) throw notFound()
      return stored.text
    },
    write(relativePath: string, text: string): void {
      const target = locate(relativePath)
      target.dir.files.set(target.name, { text, lastModified: ++clock })
    },
    remove(relativePath: string): void {
      const target = locate(relativePath)
      target.dir.files.delete(target.name)
    },
  }
}

function longChapterText(index: number): string {
  const sentence = `第${index}章里，林舟沿潮汐刻度核对旧城航线、人物承诺和玄铁剑的去向；每一项变化都有前因、证据与后果。`
  return `<p>${sentence.repeat(75)}</p>`
}

async function seedRepresentativeLongform() {
  const legacy = JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8')) as ProjectExportData
  const projectId = await importProjectJSON(legacy)
  const first = await ensureWorkspaceOwnership(projectId)
  await db.projects.update(projectId, {
    name: '隔离长篇记忆验收',
    status: 'drafting',
    targetWordCount: 240_000,
    enableMultiWorld: true,
    updatedAt: now,
  })
  await db.works.update(first.scope.workId, {
    status: 'drafting',
    targetWordCount: 240_000,
    updatedAt: now,
  })

  const firstStory = await db.storyCores.where('projectId').equals(projectId).first()
  const firstRules = await db.creativeRules.where('projectId').equals(projectId).first()
  if (!firstStory?.id || !firstRules?.id) throw new Error('代表性 fixture 缺少故事核心或创作规则')
  await db.storyCores.update(firstStory.id, {
    workId: first.scope.workId,
    logline: '林舟用潮汐档案阻止两座世界互相吞没',
    concept: '证据驱动的跨世界成长史',
    theme: '记忆必须经证据与作者裁决才能成为事实',
    centralConflict: '被篡改的历史与可验证记忆之间的冲突',
    plotPattern: '三幕式长篇',
    mainPlot: '林舟追索潮汐档案并修复主世界',
    subPlots: '玄铁剑的归属与镜界来客的承诺',
    updatedAt: now,
  } as any)
  await db.creativeRules.update(firstRules.id, {
    workId: first.scope.workId,
    writingStyle: '克制、具象、因果清晰',
    narrativePOV: 'third-limited',
    toneAndMood: '冷峻中保留希望',
    atmosphere: '冷峻中保留希望',
    prohibitions: JSON.stringify(['禁止无证据复活', '禁止跨 Work 串线']),
    consistencyRules: JSON.stringify(['物品变更必须有章节证据', '承诺必须被后文承接']),
    specialRequirements: '每章结尾保留一个可追踪开放环',
    referenceWorks: '[]',
    citedReferenceIds: '[]',
    citedInsightIds: '[]',
    updatedAt: now,
  } as any)

  const firstVolume = (await db.outlineNodes.where('projectId').equals(projectId).toArray())
    .find(node => node.type === 'volume' && (node as typeof node & { workId?: number }).workId === first.scope.workId)
  if (!firstVolume?.id) throw new Error('代表性 fixture 缺少第一卷')
  const chapters: Array<{ id: number; outlineNodeId: number; title: string }> = []
  for (let index = 2; index <= 42; index += 1) {
    const title = `第${index}章 潮汐刻度${index}`
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      workId: first.scope.workId,
      parentId: firstVolume.id,
      type: 'chapter',
      title,
      summary: `林舟完成第${index}次证据核对。`,
      order: index - 1,
      createdAt: now + index,
      updatedAt: now + index,
    } as any) as number
    const content = longChapterText(index)
    const id = await db.chapters.add({
      projectId,
      workId: first.scope.workId,
      outlineNodeId,
      title,
      content,
      wordCount: content.replace(/<[^>]+>/g, '').length,
      status: 'draft',
      order: index - 1,
      notes: '',
      createdAt: now + index,
      updatedAt: now + index,
    } as any) as number
    chapters.push({ id, outlineNodeId, title })
  }

  const secondWorldId = await db.worlds.add({
    projectId,
    code: 'WORLD-MIRROR-ACCEPTANCE',
    name: '隔离镜界',
    description: '用于证明多 World/Work 不串线',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const secondWorkId = await db.works.add({
    projectId,
    worldId: secondWorldId,
    code: generateWorkCode(),
    title: '镜界侦探录',
    description: '受控隔离作品',
    genres: ['mystery'],
    status: 'drafting',
    targetWordCount: 80_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  const secondStoryId = await db.storyCores.add({
    projectId,
    workId: secondWorkId,
    logline: '镜界侦探寻找失踪的钟声',
    concept: '镜面城市谜案',
    theme: '乙作品绝不串线标记',
    centralConflict: '侦探与无声城市',
    plotPattern: '谜案',
    mainPlot: '寻找钟声',
    subPlots: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.creativeRules.add({
    projectId,
    workId: secondWorkId,
    writingStyle: '乙作品专属文风',
    narrativePOV: 'first-person',
    toneAndMood: '迷离',
    atmosphere: '迷离',
    prohibitions: JSON.stringify(['禁止出现林舟']),
    consistencyRules: JSON.stringify(['乙作品规则标记']),
    specialRequirements: '',
    referenceWorks: '[]',
    citedReferenceIds: '[]',
    citedInsightIds: '[]',
    createdAt: now,
    updatedAt: now,
  } as any)
  const secondOutlineId = await db.outlineNodes.add({
    projectId,
    workId: secondWorkId,
    parentId: null,
    type: 'chapter',
    title: '镜界第一章',
    summary: '钟声消失。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.chapters.add({
    projectId,
    workId: secondWorkId,
    outlineNodeId: secondOutlineId,
    title: '镜界第一章',
    content: '<p>乙作品隔离正文：侦探听见一场不存在的钟声。</p>',
    wordCount: 22,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any)

  const sacrificial = chapters[4]
  const factId = await db.temporalFacts.add({
    projectId,
    workId: first.scope.workId,
    subjectName: '林舟',
    predicate: 'location',
    factKind: 'state',
    value: '旧港',
    sourceType: 'chapter',
    sourceChapterId: sacrificial.id,
    validFromChapterId: sacrificial.id,
    validToChapterId: null,
    sourceQuote: '林舟抵达旧港',
    status: 'confirmed',
    locked: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number

  // A real workspace enters through project.loadProject before disk-memory
  // self-check. Keep this acceptance fixture on that explicit CTXG-2 migration boundary.
  await backfillResourceUidsV1(projectId)

  return {
    projectId,
    firstScope: first.scope,
    firstWorkCode: first.work.code!,
    firstStoryId: firstStory.id,
    firstRulesId: firstRules.id,
    firstVolumeId: firstVolume.id,
    target: chapters[9],
    externallyEdited: chapters[11],
    interrupted: chapters[13],
    sacrificial,
    factId,
    secondWorkId,
    secondStoryId,
  }
}

async function portableHash(projectId: number): Promise<string> {
  const exported = await exportProjectJSON(projectId)
  exported.exportedAt = 0
  return hashCanonicalValue(exported)
}

async function criticalCounts(projectId: number): Promise<Record<string, number>> {
  const names = [
    'worlds', 'works', 'worldviews', 'storyCores', 'creativeRules', 'characters',
    'outlineNodes', 'chapters', 'detailedOutlines', 'foreshadows', 'storyArcs',
    'stateCards', 'itemLedger', 'storyTimelineEvents', 'temporalFacts',
    'agentRuns', 'agentRunEvents', 'agentRunCheckpoints', 'agentEvents',
  ] as const
  return Object.fromEntries(await Promise.all(names.map(async tableName => [
    tableName,
    await (db[tableName] as any).where('projectId').equals(projectId).count(),
  ])))
}

describe('MEMORY-CLOSE-3 · 隔离长篇、多 World/Work、恢复与继续创作验收', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('把人工核对、双向修改、冲突、深审计、中断恢复和清库重建串成可解释闭环', async () => {
    const seeded = await seedRepresentativeLongform()
    const disk = memoryDirectory()
    let modelCalls = 0

    const manuscriptCharacters = (await db.chapters.where('projectId').equals(seeded.projectId).toArray())
      .filter(chapter => (chapter as typeof chapter & { workId?: number }).workId === seeded.firstScope.workId)
      .reduce((sum, chapter) => sum + chapter.content.replace(/<[^>]+>/g, '').length, 0)
    expect(manuscriptCharacters).toBeGreaterThan(100_000)

    // Binding and self-check are read-only until the author confirms the first baseline write.
    const initialWrites = disk.writeOrder.length
    const initial = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(initial.zeroModelCalls).toBe(true)
    expect(disk.writeOrder).toHaveLength(initialWrites)
    expect(initial.summary.projectChanged).toBeGreaterThan(40)
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: initial.plan.planHash,
    })
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)).plan.items
      .every(item => item.changeKind === 'clean')).toBe(true)

    const bindings = await db.workspaceDocuments.where('projectId').equals(seeded.projectId).toArray()
    const targetBinding = bindings.find(binding => binding.tableName === 'chapters' && binding.recordId === seeded.target.id)!
    const externalBinding = bindings.find(binding => binding.tableName === 'chapters' && binding.recordId === seeded.externallyEdited.id)!
    const storyBinding = bindings.find(binding => binding.tableName === 'storyCores' && binding.recordId === seeded.firstStoryId)!
    const rulesBinding = bindings.find(binding => binding.tableName === 'creativeRules' && binding.recordId === seeded.firstRulesId)!
    const sacrificialBinding = bindings.find(binding => binding.tableName === 'chapters' && binding.recordId === seeded.sacrificial.id)!
    expect(storyBinding.relativePath).toBe(`works/${seeded.firstWorkCode}/memory/story-core.yaml`)
    expect(rulesBinding.relativePath).toBe(`works/${seeded.firstWorkCode}/memory/creative-rules.yaml`)

    // Internal changes keep stable document identity/path and are written only after another explicit confirmation.
    const originalTargetPath = targetBinding.relativePath
    await db.chapters.update(seeded.target.id, {
      title: `${seeded.target.title}（作者修订）`,
      notes: '作者在项目内补充的核对备注',
      updatedAt: now + 100,
    })
    await db.storyCores.update(seeded.firstStoryId, {
      mainPlot: '林舟追索潮汐档案、识别伪史并修复主世界',
      updatedAt: now + 100,
    })
    const internal = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(internal.plan.items.find(item => item.identity.documentId === targetBinding.documentId)?.changeKind)
      .toBe('project-changed')
    expect(internal.plan.items.find(item => item.identity.documentId === storyBinding.documentId)?.changeKind)
      .toBe('project-changed')
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: internal.plan.planHash,
    })
    expect((await db.workspaceDocuments.get(targetBinding.id!))?.relativePath).toBe(originalTargetPath)
    expect(disk.read(originalTargetPath)).toContain('（作者修订）')

    // External chapter and semantic edits become inspectable candidates and affect only the current Work.
    const storyOnDisk = parseYaml(disk.read(storyBinding.relativePath))
    storyOnDisk.data.故事主线 = '作者从硬盘重写的潮汐档案主线'
    disk.write(storyBinding.relativePath, stringifyYaml(storyOnDisk, { lineWidth: 0, sortMapEntries: true }))
    const externalText = disk.read(externalBinding.relativePath)
    disk.write(externalBinding.relativePath, externalText.replace('林舟沿潮汐刻度', '林舟携玄铁剑沿潮汐刻度'))
    const rulesOnDisk = parseYaml(disk.read(rulesBinding.relativePath))
    rulesOnDisk.data.一致性规则 = ['物品变更必须有章节证据', '硬盘修订也必须人工核对']
    disk.write(rulesBinding.relativePath, stringifyYaml(rulesOnDisk, { lineWidth: 0, sortMapEntries: true }))

    const external = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(external.zeroModelCalls).toBe(true)
    expect(external.summary.fileChanged).toBe(3)
    const candidates = await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: external.plan.planHash,
    })
    expect(candidates.candidates).toHaveLength(3)
    const impact = await buildWorkspaceImpactPlanV1({ projectId: seeded.projectId, candidateSet: candidates })
    expect(impact.zeroModelCalls).toBe(true)
    expect(impact.items.some(item => item.targetRecordId === seeded.target.id)).toBe(true)
    const secondWorkChapterIds = new Set((await db.chapters.where('projectId').equals(seeded.projectId).toArray())
      .filter(chapter => (chapter as typeof chapter & { workId?: number }).workId === seeded.secondWorkId)
      .map(chapter => chapter.id))
    expect(impact.items.some(item => (
      item.targetTable === 'chapters' && secondWorkChapterIds.has(item.targetRecordId)
    ))).toBe(false)
    await adoptWorkspaceFileChangesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: external.plan.planHash,
    })
    expect((await db.storyCores.get(seeded.firstStoryId))?.mainPlot).toBe('作者从硬盘重写的潮汐档案主线')
    expect((await db.storyCores.get(seeded.secondStoryId))?.theme).toBe('乙作品绝不串线标记')
    expect((await db.chapters.get(seeded.externallyEdited.id))?.content).toContain('携玄铁剑')

    // Same document changed on both sides cannot be silent; the author must choose a winner.
    const conflictFile = parseYaml(disk.read(storyBinding.relativePath))
    conflictFile.data.主题 = '硬盘冲突裁决主题'
    disk.write(storyBinding.relativePath, stringifyYaml(conflictFile, { lineWidth: 0, sortMapEntries: true }))
    await db.storyCores.update(seeded.firstStoryId, { theme: '项目冲突版本主题', updatedAt: now + 200 })
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
    expect((await db.storyCores.get(seeded.firstStoryId))?.theme).toBe('硬盘冲突裁决主题')

    // Identity damage is quarantined; a missing referenced chapter requires explicit deletion and degrades its fact safely.
    const undamagedStory = disk.read(storyBinding.relativePath)
    const damagedStory = parseYaml(undamagedStory)
    damagedStory.storyforge.workCode = 'WORK-TAMPERED'
    disk.write(storyBinding.relativePath, stringifyYaml(damagedStory, { lineWidth: 0, sortMapEntries: true }))
    const damaged = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(damaged.summary.invalid).toBe(1)
    expect((await buildWorkspaceFileAdoptionCandidatesV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: damaged.plan.planHash,
    })).blockedDocumentIds).toContain(storyBinding.documentId)
    disk.write(storyBinding.relativePath, undamagedStory)
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)).summary.invalid).toBe(0)

    disk.remove(sacrificialBinding.relativePath)
    const missing = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(missing.summary.missing).toBe(1)
    await confirmMissingChapterFileDeletionsV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: missing.plan.planHash,
    })
    expect(await db.chapters.get(seeded.sacrificial.id)).toBeUndefined()
    expect(await db.temporalFacts.get(seeded.factId)).toMatchObject({
      sourceChapterId: null,
      validFromChapterId: null,
      status: 'invalid-range',
    })
    expect(disk.read(`.storyforge/trash/${missing.plan.planId}/${sacrificialBinding.relativePath}`))
      .toContain(seeded.sacrificial.title)

    // Deep Audit makes one model call, writes only a report/ledger, and becomes a disk-indexed memory settlement.
    const targetBeforeAudit = (await db.chapters.get(seeded.target.id))!
    const durable = await runDurableConsistencyAuditV1({
      scope: seeded.firstScope,
      chapterId: seeded.target.id,
      chapterTitle: targetBeforeAudit.title,
      worldGroupId: null,
      outlineNodeId: seeded.target.outlineNodeId,
      chapterContent: targetBeforeAudit.content,
      mode: 'deep',
      provider: 'openai',
      model: 'test-consistency-model',
      budget: new AgentTeamBudgetTracker('economy'),
      call: async () => {
        modelCalls += 1
        return JSON.stringify({ findings: [] })
      },
    })
    expect(modelCalls).toBe(1)
    expect(durable.snapshot.projection.memorySettlement?.state).toBe('settled')
    expect((await db.chapters.get(seeded.target.id))?.content).toBe(targetBeforeAudit.content)
    const auditDirty = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    expect(auditDirty.plan.items.find(item => item.relativePath === '.storyforge/runs/memory-index.json')?.changeKind)
      .toBe('project-changed')
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: auditDirty.plan.planHash,
    })
    const settledIndex = JSON.parse(disk.read('.storyforge/runs/memory-index.json')).index
    expect(settledIndex.runs).toHaveLength(1)
    expect(settledIndex.runs[0]).toMatchObject({ state: 'settled', settlementSource: 'terminal-event' })

    // Source edits stale the receipt; a later interrupted sync resumes without repeating model/adoption/history work.
    await db.chapters.update(seeded.target.id, {
      content: `${targetBeforeAudit.content}<p>作者在审计后加入的新证据。</p>`,
      updatedAt: now + 300,
    })
    const freshness = await refreshDurableConsistencyAuditFreshnessV1({
      scope: seeded.firstScope,
      candidate: durable.candidate,
    })
    expect(freshness.current).toBe(false)
    expect(freshness.snapshot?.events.at(-1)?.type).toBe('verification.staled')
    expect(freshness.snapshot?.projection.memorySettlement).toBeUndefined()
    const runCountBeforeRecovery = await db.agentRuns.where('projectId').equals(seeded.projectId).count()
    const historyCountBeforeRecovery = await db.agentEvents.where('projectId').equals(seeded.projectId).count()
    await db.chapters.update(seeded.interrupted.id, {
      notes: '这次写盘将在中途失去权限',
      updatedAt: now + 301,
    })
    const beforeInterruptedSync = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    disk.failAfterMoreWrites(3)
    await expect(synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: beforeInterruptedSync.plan.planHash,
    })).rejects.toThrow('simulated permission loss')
    const recoveryReceipt = await recoverPendingWorkspaceSyncV1(seeded.projectId, disk.handle)
    expect(recoveryReceipt.databaseAdoptionReceiptHashes).toEqual([])
    expect(modelCalls).toBe(1)
    expect(await db.agentRuns.where('projectId').equals(seeded.projectId).count()).toBe(runCountBeforeRecovery)
    expect(await db.agentEvents.where('projectId').equals(seeded.projectId).count()).toBe(historyCountBeforeRecovery)
    expect((await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)).plan.items
      .every(item => item.changeKind === 'clean')).toBe(true)
    const staleIndex = JSON.parse(disk.read('.storyforge/runs/memory-index.json')).index
    expect(staleIndex.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current' })

    // The committed disk mirror restores all formal tables, Harness evidence, references and portable hashes.
    const expectedHash = await portableHash(seeded.projectId)
    const expectedCounts = await criticalCounts(seeded.projectId)
    await db.delete()
    await db.open()
    const restored = await restoreWorkspaceFromFolderV1(disk.handle)
    expect(restored.report.plan.items.every(item => item.changeKind === 'clean')).toBe(true)
    expect(await criticalCounts(restored.projectId)).toEqual(expectedCounts)
    expect(await portableHash(restored.projectId)).toBe(expectedHash)
    expect(await db.agentRunEvents.where('projectId').equals(restored.projectId).count()).toBeGreaterThan(0)
    const restoredDetachedFact = (await db.temporalFacts.where('projectId').equals(restored.projectId).toArray())
      .find(fact => fact.sourceQuote === '林舟抵达旧港')
    expect(restoredDetachedFact).toMatchObject({
      sourceChapterId: null,
      validFromChapterId: null,
      status: 'invalid-range',
    })

    // Continue the next chapter from restored, current Canon without stale or cross-Work semantic leakage.
    const restoredFirstWork = await db.works.where('projectId').equals(restored.projectId)
      .filter(work => work.code === seeded.firstWorkCode).first()
    if (!restoredFirstWork?.id) throw new Error('恢复后缺少第一 Work')
    const restoredScope = await resolveScopeLike({
      projectId: restored.projectId,
      worldId: restoredFirstWork.worldId,
      workId: restoredFirstWork.id,
    })
    const restoredVolume = (await db.outlineNodes.where('projectId').equals(restored.projectId).toArray())
      .find(node => node.type === 'volume' && (node as typeof node & { workId?: number }).workId === restoredFirstWork.id)
    if (!restoredVolume?.id) throw new Error('恢复后缺少第一卷')
    const nextOutlineId = await db.outlineNodes.add({
      projectId: restored.projectId,
      workId: restoredFirstWork.id,
      parentId: restoredVolume.id,
      type: 'chapter',
      title: '第43章 恢复后的新航线',
      summary: '从最新证据继续，而非从过期报告继续。',
      order: 42,
      createdAt: now + 500,
      updatedAt: now + 500,
    } as any) as number
    const nextChapterId = await db.chapters.add({
      projectId: restored.projectId,
      workId: restoredFirstWork.id,
      outlineNodeId: nextOutlineId,
      title: '第43章 恢复后的新航线',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 42,
      notes: '',
      createdAt: now + 500,
      updatedAt: now + 500,
    } as any) as number
    const continuation = await assembleContext({
      projectId: restored.projectId,
      scope: restoredScope,
      chapterId: nextChapterId,
      outlineNodeId: nextOutlineId,
      currentChapterOrder: 42,
      sourceKeys: ['storyCore', 'creativeRules', 'currentFacts', 'heldItems', 'storyTimeline'],
      inputBudgetTokens: 20_000,
    })
    expect(continuation.text).toContain('硬盘冲突裁决主题')
    expect(continuation.text).toContain('作者从硬盘重写的潮汐档案主线')
    expect(continuation.text).toContain('硬盘修订也必须人工核对')
    expect(continuation.text).not.toContain('乙作品绝不串线标记')
    expect(continuation.text).not.toContain('乙作品专属文风')
    expect(modelCalls).toBe(1)
  }, 60_000)

  it('恢复仍处于 completed 的历史 Harness Run 时显式失效本地主键绑定凭据并保留证据', async () => {
    const seeded = await seedRepresentativeLongform()
    const disk = memoryDirectory('StoryForgeCompletedHarnessRestore')
    const baseline = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: baseline.plan.planHash,
    })
    const chapter = (await db.chapters.get(seeded.target.id))!
    let modelCalls = 0
    await runDurableConsistencyAuditV1({
      scope: seeded.firstScope,
      chapterId: seeded.target.id,
      chapterTitle: chapter.title,
      worldGroupId: null,
      outlineNodeId: seeded.target.outlineNodeId,
      chapterContent: chapter.content,
      mode: 'fast',
      provider: 'openai',
      model: 'test-consistency-model',
      budget: new AgentTeamBudgetTracker('economy'),
      call: async () => {
        modelCalls += 1
        return JSON.stringify({ findings: [] })
      },
    })
    const auditDirty = await buildWorkspaceSelfCheckReportV1(seeded.projectId, disk.handle)
    await synchronizeProjectChangesToFolderV1({
      projectId: seeded.projectId,
      root: disk.handle,
      expectedPlanHash: auditDirty.plan.planHash,
    })
    const countsBefore = await criticalCounts(seeded.projectId)

    await db.delete()
    await db.open()
    const restored = await restoreWorkspaceFromFolderV1(disk.handle)
    expect(restored.reboundHarnessRunCount).toBe(1)
    expect(restored.report.plan.items.every(item => item.changeKind === 'clean')).toBe(true)
    expect(modelCalls).toBe(1)
    const countsAfter = await criticalCounts(restored.projectId)
    expect(countsAfter).toMatchObject({
      chapters: countsBefore.chapters,
      storyCores: countsBefore.storyCores,
      creativeRules: countsBefore.creativeRules,
      temporalFacts: countsBefore.temporalFacts,
      agentRuns: countsBefore.agentRuns,
      agentRunCheckpoints: countsBefore.agentRunCheckpoints,
    })
    expect(countsAfter.agentRunEvents).toBe(countsBefore.agentRunEvents + 1)
    const importedRun = await db.agentRuns.where('projectId').equals(restored.projectId).first()
    expect(importedRun?.status).toBe('running')
    const lastEvent = await db.agentRunEvents.where('runId').equals(importedRun!.id!).last()
    expect(lastEvent?.type).toBe('verification.staled')
    expect(JSON.parse(lastEvent!.payloadJson)).toMatchObject({ reason: 'project-import-scope-rebound' })
    expect(disk.writeOrder.some(relativePath => (
      relativePath.includes('.storyforge/history/') && relativePath.endsWith('/.storyforge/recovery/project.json')
    ))).toBe(true)
    const index = JSON.parse(disk.read('.storyforge/runs/memory-index.json')).index
    expect(index.runs[0]).toMatchObject({ state: 'incomplete', settlementSource: 'derived-current' })
  }, 60_000)
})
