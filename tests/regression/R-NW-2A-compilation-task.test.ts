import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeReleaseV4 } from '../helpers/narrative-release-fixture'
import { createNarrativeCompilationTaskV1, continueNarrativeCompilationTaskV1, readNarrativeCompilationTaskV1, cancelNarrativeCompilationTaskV1,
  sealNarrativeCompilationTaskV1, listNarrativeCompilationTasksV1 } from '../../src/lib/world-engine/narrative-compilation-task'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import * as worker from '../../src/lib/world-engine/narrative-release-worker'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1, narrativeUtf8ByteLengthV1 } from '../../src/lib/world-engine/narrative-json'
import type { WorldReleaseInputV4 } from '../../src/lib/world-engine/narrative-release-capture'
import { publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createProjectJSONBlob, readProjectJSONFile } from '../../src/lib/export/json-file'

const FORMER_CONTENT_ENVELOPE_BYTES = 32 * 1024 * 1024
const FULL_SOURCE_HEAD = '【作者完整世界背景·首部】\r\n'
const FULL_SOURCE_TAIL = '\r\n【作者完整世界背景·尾部】🌊'

/** Synthetic source proves byte/identity preservation, not literary quality.
 * The real registry still decides the selected source and projector semantics. */
async function seedFullWorldSourceBeyondFormerEnvelope() {
  const fixture = await seedNarrativeReleaseV4()
  const text = FULL_SOURCE_HEAD + '。'.repeat(Math.ceil(FORMER_CONTENT_ENVELOPE_BYTES / 3)) + FULL_SOURCE_TAIL
  expect(narrativeUtf8ByteLengthV1(text)).toBeGreaterThan(FORMER_CONTENT_ENVELOPE_BYTES)
  await db.characters.update(fixture.actorId, { background: text })
  const owner = { kind: 'world' as const, worldCode: fixture.world.code, sourceWorkCode: null }
  const capture = await captureNarrativeDomainV1({ scope: fixture.scope, owner })
  const actor = capture.rows.get('characters')!.find(row => row.id === fixture.actorId)!
  await confirmNarrativeDomainAnnotationsV1({ scope: fixture.scope, owner, table: 'characters', recordId: fixture.actorId,
    expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor),
    annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'cache-test-v1' } } })
  return { ...fixture, text, textHash: await hashNarrativeBytesV1(text) }
}
function sourceBackground(input: WorldReleaseInputV4): string {
  const text = input.records.characters[0]?.background
  if (typeof text !== 'string') throw Error('完整作者背景缺失')
  return text
}
async function expectFullSource(input: WorldReleaseInputV4, text: string, hash: string) {
  const original = sourceBackground(input)
  expect(original.length).toBe(text.length)
  expect(original.startsWith(FULL_SOURCE_HEAD)).toBe(true)
  expect(original.endsWith(FULL_SOURCE_TAIL)).toBe(true)
  expect(await hashNarrativeBytesV1(original)).toBe(hash)
}

describe('NW-2A · 零模型编译检查点与显式恢复', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('刷新后从同一输入恢复；完成回执只确认编译，既不发布也不改领域原件', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    expect(started.snapshot.projection.state).toBe('paused')
    db.close(); await db.open()
    const result = await continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.checkpoint.result!.contentHash).toBe(fixture.release.contentHash)
    expect(result.checkpoint.receipt!.modelCalls).toBe(0)
    expect(result.snapshot.events.some(e => e.type === 'model.requested')).toBe(false)
    expect(result.snapshot.projection.memorySettlement?.state).toBe('settled')
    expect((await continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })).checkpoint.receiptHash).toBe(result.checkpoint.receiptHash)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })

  it('Worker 中断不自动重试；显式继续从相同快照恢复，三次上限可见', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockRejectedValueOnce(Error('worker-interrupted'))
    const request = { scope: fixture.scope, runId: started.snapshot.run.id }
    await expect(continueNarrativeCompilationTaskV1(request)).rejects.toThrow('worker-interrupted')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await readNarrativeCompilationTaskV1(fixture.scope, request.runId)).snapshot.projection.state).toBe('paused')
    const recovered = await continueNarrativeCompilationTaskV1(request)
    expect(recovered.snapshot.projection.steps['world.narrative.compile-v4'].attempt).toBe(2)
    expect(recovered.snapshot.projection.state).toBe('completed')
    const exhausted = await createNarrativeCompilationTaskV1(fixture.input)
    spy.mockRejectedValue(Error('worker-interrupted'))
    const again = { scope: fixture.scope, runId: exhausted.snapshot.run.id }
    for (let i = 0; i < 3; i++) await expect(continueNarrativeCompilationTaskV1(again)).rejects.toThrow('worker-interrupted')
    await expect(continueNarrativeCompilationTaskV1(again)).rejects.toThrow('三次')
    expect((await readNarrativeCompilationTaskV1(fixture.scope, again.runId)).snapshot.projection.state).toBe('failed')
  })

  it('来源变化或作者取消阻断派发，旧发布保留', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    await db.characters.update(fixture.actorId, { name: '捕获之后改名' })
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1')
    await expect(continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })).rejects.toThrow('stale')
    expect(spy).not.toHaveBeenCalled()
    await cancelNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)
    expect((await readNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)).snapshot.projection.state).toBe('cancelled')
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })

  it('便携导入只保留历史编译证据，不恢复原工作区任务或自动发布', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    const projectId = await deriveImportProjectJSON(await deriveExportProjectJSON(fixture.scope.projectId))
    const project = (await db.projects.get(projectId))!
    const scope = { projectId, worldId: project.activeWorldId!, workId: project.activeWorkId! }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const historical = await readNarrativeCompilationTaskV1(scope, run.id!)
    expect(historical.historicalOnly).toBe(true)
    await expect(continueNarrativeCompilationTaskV1({ scope, runId: run.id! })).rejects.toThrow('历史副本')
    expect((await readNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)).snapshot.projection.state).toBe('paused')
  })

  it('作者显式冻结核验已完成快照；重复操作不重编译，之后的来源改变不能偷换封存', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const task = await createNarrativeCompilationTaskV1(fixture.input)
    const request = { scope: fixture.scope, runId: task.snapshot.run.id, label: '完成后确认冻结', parentRevisionId: fixture.revision.id }
    await expect(sealNarrativeCompilationTaskV1(request)).rejects.toThrow('尚未完成')
    await continueNarrativeCompilationTaskV1(request)
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1')
    const revision = await sealNarrativeCompilationTaskV1(request)
    expect(revision.contentHash).toBe(fixture.release.contentHash)
    expect((await sealNarrativeCompilationTaskV1(request)).id).toBe(revision.id)
    expect(spy).not.toHaveBeenCalled()
    expect(await db.worldReleases.count()).toBe(1)
    expect((await listNarrativeCompilationTasksV1(fixture.scope))[0]).toEqual({ id: task.snapshot.run.id, status: 'completed' })
    await db.characters.update(fixture.actorId, { name: '完成编译后修改' })
    await expect(sealNarrativeCompilationTaskV1(request)).rejects.toThrow('stale')
    expect(await db.worldRevisions.count()).toBe(2)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })

  it('超过旧32MiB的完整来源经真实Worker派发：已知故障不隐式重试，在途取消仍保留同一原件和旧发布', async () => {
    const network = vi.fn(() => { throw Error('确定性世界编译不得请求模型或网络') })
    vi.stubGlobal('fetch', network)
    vi.stubGlobal('Worker', undefined)
    const fixture = await seedFullWorldSourceBeyondFormerEnvelope()
    const originalRow = await db.characters.get(fixture.actorId)
    const task = await createNarrativeCompilationTaskV1({ ...fixture.input, baseRevisionId: fixture.revision.id })
    const request = { scope: fixture.scope, runId: task.snapshot.run.id }
    expect(narrativeUtf8ByteLengthV1(canonicalNarrativeJsonV1(task.checkpoint))).toBeGreaterThan(FORMER_CONTENT_ENVELOPE_BYTES)
    db.close(); await db.open()
    const reopened = await readNarrativeCompilationTaskV1(fixture.scope, request.runId)
    expect(reopened.staleReason).toBeNull()
    expect(reopened.checkpoint.inputHash).toBe(await hashNarrativeValueV1(reopened.checkpoint.input))
    expect(reopened.checkpoint.inputHash).toBe(task.checkpoint.inputHash)
    await expectFullSource(reopened.checkpoint.input, fixture.text, fixture.textHash)

    let posts = 0, terminated = 0, transferred: WorldReleaseInputV4 | undefined
    let secondPosted: () => void = () => { throw Error('未初始化Worker派发观察') }
    const inFlight = new Promise<void>(resolve => { secondPosted = resolve })
    // Only the platform Worker is replaced: task admission, frozen transfer,
    // source/hash validation, checkpoint and cancellation are real production code.
    class FailingThenPendingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onmessageerror: (() => void) | null = null
      postMessage(payload: { version: number; input: WorldReleaseInputV4 }) {
        expect(payload.version).toBe(1)
        transferred = payload.input; posts++
        if (posts === 1) queueMicrotask(() => this.onerror?.())
        else secondPosted()
      }
      terminate() { terminated++ }
    }
    vi.stubGlobal('Worker', FailingThenPendingWorker)
    await expect(continueNarrativeCompilationTaskV1(request)).rejects.toThrow('后台编译被中断')
    expect(posts).toBe(1)
    expect(terminated).toBe(1)
    if (!transferred) throw Error('后台未收到完整捕获')
    await expectFullSource(transferred, fixture.text, fixture.textHash)
    const failed = await readNarrativeCompilationTaskV1(fixture.scope, request.runId)
    expect(failed.snapshot.projection.state).toBe('paused')
    expect(failed.snapshot.projection.steps['world.narrative.compile-v4'].attempt).toBe(1)
    expect(failed.checkpoint.inputHash).toBe(task.checkpoint.inputHash)
    expect(failed.checkpoint.result).toBeUndefined()
    await expectFullSource(failed.checkpoint.input, fixture.text, fixture.textHash)

    // Only the explicit second author action dispatches; cancel aborts that
    // exact pending Worker and never turns its unknown result into success.
    const continuing = continueNarrativeCompilationTaskV1(request)
    const stopped = expect(continuing).rejects.toMatchObject({ name: 'AbortError' })
    await inFlight
    await cancelNarrativeCompilationTaskV1(fixture.scope, request.runId)
    await stopped
    expect(posts).toBe(2)
    expect(terminated).toBe(2)
    db.close(); await db.open()
    const cancelled = await readNarrativeCompilationTaskV1(fixture.scope, request.runId)
    expect(cancelled.snapshot.projection.state).toBe('cancelled')
    expect(cancelled.snapshot.projection.steps['world.narrative.compile-v4'].attempt).toBe(2)
    await expectFullSource(cancelled.checkpoint.input, fixture.text, fixture.textHash)
    await expect(continueNarrativeCompilationTaskV1(request)).rejects.toThrow('终态')
    await expect(sealNarrativeCompilationTaskV1({ ...request, label: '不可封存取消任务' })).rejects.toThrow('尚未完成')
    expect(posts).toBe(2)
    expect(cancelled.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(await db.characters.get(fixture.actorId)).toEqual(originalRow)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(1)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
    expect(network).not.toHaveBeenCalled()
  }, 180_000)

  it('完整大输入由实际编译器生成大结果并刷新恢复；封存、发布与文件备份均需原作者的独立操作', async () => {
    const network = vi.fn(() => { throw Error('确定性世界编译不得请求模型或网络') })
    vi.stubGlobal('fetch', network)
    vi.stubGlobal('Worker', undefined) // Select the existing real inline compiler, never a fake success.
    vi.stubGlobal('Blob', NodeBlob)
    const fixture = await seedFullWorldSourceBeyondFormerEnvelope()
    const originalRow = await db.characters.get(fixture.actorId)
    const task = await createNarrativeCompilationTaskV1({ ...fixture.input, baseRevisionId: fixture.revision.id })
    const request = { scope: fixture.scope, runId: task.snapshot.run.id }
    db.close(); await db.open()
    const completed = await continueNarrativeCompilationTaskV1(request)
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.checkpoint.receipt!.modelCalls).toBe(0)
    expect(completed.checkpoint.result!.update!.baseContentHash).toBe(fixture.revision.contentHash)
    expect(completed.checkpoint.receipt!.impactPlanHash).toBe(completed.checkpoint.result!.update!.impact.planHash)
    expect(narrativeUtf8ByteLengthV1(canonicalNarrativeJsonV1(completed.checkpoint))).toBeGreaterThan(FORMER_CONTENT_ENVELOPE_BYTES)
    await expectFullSource(completed.checkpoint.input, fixture.text, fixture.textHash)
    await expectFullSource(completed.checkpoint.result!.manifest, fixture.text, fixture.textHash)
    db.close(); await db.open()
    const restored = await readNarrativeCompilationTaskV1(fixture.scope, request.runId)
    expect(restored.staleReason).toBeNull()
    expect(restored.checkpoint.receiptHash).toBe(completed.checkpoint.receiptHash)
    expect(restored.checkpoint.result!.contentHash).toBe(await hashNarrativeValueV1(restored.checkpoint.result!.manifest))
    await expectFullSource(restored.checkpoint.result!.manifest, fixture.text, fixture.textHash)
    expect(restored.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(await db.characters.get(fixture.actorId)).toEqual(originalRow)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)

    const revision = await sealNarrativeCompilationTaskV1({ ...request, label: '作者显式封存完整大来源', parentRevisionId: fixture.revision.id })
    expect(revision.contentHash).toBe(restored.checkpoint.result!.contentHash)
    expect(narrativeUtf8ByteLengthV1(revision.manifestJson)).toBeGreaterThan(FORMER_CONTENT_ENVELOPE_BYTES)
    expect(await db.worldReleases.count()).toBe(1)
    const release = await publishWorldRevision(revision.id!)
    expect(release.manifestJson).toBe(revision.manifestJson)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)

    // Exercise the actual file serializer + streamed reader + governed import;
    // a large raw checkpoint must survive the same backup boundary as the release.
    const backup = createProjectJSONBlob(await deriveExportProjectJSON(fixture.scope.projectId))
    expect(backup.size).toBeGreaterThan(FORMER_CONTENT_ENVELOPE_BYTES)
    const importedId = await deriveImportProjectJSON(await readProjectJSONFile(backup))
    const importedProject = (await db.projects.get(importedId))!
    const importedScope = { projectId: importedId, worldId: importedProject.activeWorldId!, workId: importedProject.activeWorkId! }
    const importedRun = (await db.agentRuns.where('projectId').equals(importedId).toArray())[0]
    const historical = await readNarrativeCompilationTaskV1(importedScope, importedRun.id!)
    expect(historical.historicalOnly).toBe(true)
    expect(historical.checkpoint.inputHash).toBe(task.checkpoint.inputHash)
    expect(historical.checkpoint.receiptHash).toBe(restored.checkpoint.receiptHash)
    await expectFullSource(historical.checkpoint.input, fixture.text, fixture.textHash)
    await expectFullSource(historical.checkpoint.result!.manifest, fixture.text, fixture.textHash)
    await expect(continueNarrativeCompilationTaskV1({ scope: importedScope, runId: importedRun.id! })).rejects.toThrow('历史副本')
    await expect(sealNarrativeCompilationTaskV1({ scope: importedScope, runId: importedRun.id!, label: '历史副本不可封存' })).rejects.toThrow('历史副本')
    expect(await db.characters.get(fixture.actorId)).toEqual(originalRow)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
    expect(network).not.toHaveBeenCalled()
  }, 300_000)
})
