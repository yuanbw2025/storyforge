import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { MessageChannel } from 'node:worker_threads'
import { db } from '../../src/lib/db/schema'
import type { AgentEvent, AgentRunRecord, AIConfig, WorkspaceScope } from '../../src/lib/types'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as runEvents from '../../src/lib/agent/run/event-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as assembly from '../../src/lib/registry/assemble-context'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import * as prompts from '../../src/lib/motion-drama/prompts'
import * as conversations from '../../src/lib/agent/conversations'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { generateComicProfessionalCandidateV1, adoptComicProfessionalCandidateV1, readPendingComicProfessionalCandidateV1, listComicProfessionalTasksV1, stopWaitingComicProfessionalTaskV1, readComicProfessionalTaskV1, recoverComicProfessionalCandidateV1 } from '../../src/lib/comic/durable-production'
import { generateMotionDramaCandidateV1, readPendingMotionDramaCandidateV1, adoptMotionDramaProfessionalCandidateV1, listMotionMaterialTasks, stopWaitingMotionDramaTaskV1, readMotionDramaTaskV1, recoverMotionDramaCandidateV1 } from '../../src/lib/motion-drama/durable-production'
import {
  createQualityCreationFixture, generateQualityCreationCandidate, qualityMotionBible,
  type QualityCreationMedium,
} from '../helpers/quality001016-creation-fixtures'

const media: QualityCreationMedium[] = ['comic', 'motion-drama']
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function currentRun(scope: WorkspaceScope) {
  const rows = await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  expect(rows).toHaveLength(1)
  return readAgentRunV1(scope, rows[0].id!)
}
function validPayload(medium: QualityCreationMedium, item: Awaited<ReturnType<typeof createQualityCreationFixture>>) {
  return JSON.stringify(medium === 'motion-drama' ? qualityMotionBible : [{
    stableKey: 'fact_ticket', kind: 'event', statement: '检票员决定调查异常车票。', subjectKeys: [],
    sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1,
  }])
}
async function stopWaiting(medium: QualityCreationMedium, scope: WorkspaceScope) {
  const snapshot = await currentRun(scope)
  const stop = medium === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
  return stop(scope, snapshot.run.id, { generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence })
}
async function taskControls(scope: WorkspaceScope) {
  return (await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })).filter(row => row.kind === 'task')
}
async function databaseBytes() {
  return JSON.stringify(await Promise.all(db.tables.map(async table => ({ name: table.name, rows: await table.toArray() }))))
}
function adoptQualityCandidate(medium: QualityCreationMedium, scope: WorkspaceScope, runId: number) {
  return medium === 'comic'
    ? adoptComicProfessionalCandidateV1({ scope, runId })
    : adoptMotionDramaProfessionalCandidateV1({ scope, runId })
}
async function freezeQualityAuthorIntent(medium: QualityCreationMedium, item: Awaited<ReturnType<typeof createQualityCreationFixture>>) {
  const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
  const original = runEvents.appendAgentRunEventV1
  const interrupted = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
    const value = await original(input)
    if (input.type === 'adoption.started') throw new Error('isolated frozen author intent interruption')
    return value
  })
  try { await expect(adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).rejects.toThrow('isolated frozen author intent interruption') }
  finally { interrupted.mockRestore() }
  return generated
}

describe('SFQA-001/016 · independent creation task recovery', () => {
  let expectedSyntheticFetches = 0
  beforeEach(async () => {
    await db.delete(); await db.open(); expectedSyntheticFetches = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('Isolated creation tests prohibit real network') }))
  })
  afterEach(async () => {
    try { expect(fetch).toHaveBeenCalledTimes(expectedSyntheticFetches) }
    finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() }
  })

  for (const medium of media) {
    for (const failure of ['offline', 'abort', 'timeout', 'authorization', 'balance'] as const) {
      it(`${medium}: actual client ${failure} failure stays visible with one intercepted POST and no automatic resend`, async () => {
        const item = await createQualityCreationFixture(medium)
        const send = vi.fn<typeof fetch>(async () => {
          if (failure === 'authorization' || failure === 'balance') return new Response(JSON.stringify({ error: { message: `isolated ${failure} rejection` } }), { status: failure === 'authorization' ? 401 : 402 })
          if (failure === 'offline') throw new TypeError('isolated offline transport')
          throw new DOMException(`isolated ${failure} transport`, failure === 'timeout' ? 'TimeoutError' : 'AbortError')
        })
        expectedSyntheticFetches = 1
        vi.stubGlobal('fetch', send)
        const aiConfig: AIConfig = { provider: 'custom', apiKey: '', model: 'isolated-model', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 1_024, contextWindow: 128_000 }
        let error: unknown
        try {
          if (medium === 'comic') await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], aiConfig })
          else await generateMotionDramaCandidateV1({ scope: item.scope, stage: 'series-bible', episodeNumber: 1, aiConfig })
        } catch (cause) { error = cause }
        expect(error).toBeInstanceOf(Error)
        if (failure === 'authorization' || failure === 'balance') expect(error).toMatchObject({ status: failure === 'authorization' ? 401 : 402 })
        expect(send.mock.calls.length, error instanceof Error ? error.message : String(error)).toBe(1)
        expect(send.mock.calls[0][1]?.method).toBe('POST')
        expect(String(send.mock.calls[0][0])).toBe('http://127.0.0.1:9/v1/chat/completions')
        const snapshot = await currentRun(item.scope)
        expect(snapshot.projection.state).toBe('paused')
        expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
        expect(snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(0)
        const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
        const pending = medium === 'comic' ? readPendingComicProfessionalCandidateV1 : readPendingMotionDramaCandidateV1
        const before = await databaseBytes()
        expect((await read(item.scope, snapshot.run.id)).task).toMatchObject({ hasUnresolvedRequest: true, candidateState: 'missing', requestedAttempts: 1 })
        expect(await pending(item.scope)).toBeNull()
        expect(await databaseBytes()).toBe(before)
        expect(send).toHaveBeenCalledTimes(1)
        expect(await db.adaptationSourceFacts.count()).toBe(0); expect(await db.motionDramaSeriesBibles.count()).toBe(0)
      })
    }

    it(`${medium}: a generic multi-step Run is not reclassified as this product's single professional task`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
      const binding = generated.snapshot.contract.executionBindings?.[0]
      if (!binding) throw new Error('实际产品 Run 缺少 Skill 绑定')
      const other = await runEvents.createAgentRunV1({ scope: item.scope, worldGroupId: null, contract: {
        ...generated.snapshot.contract, executionBindings: [binding, { ...binding, stepId: 'another-author-task' }],
      } })
      const list = medium === 'comic' ? listComicProfessionalTasksV1 : listMotionMaterialTasks
      const before = await databaseBytes()
      const row = (await list(item.scope)).find(task => task.id === other.run.id)
      expect(row).toMatchObject({ verified: false, stage: null, canStopWaiting: false, canRecoverCandidate: false })
      expect(await databaseBytes()).toBe(before)
    })

    it(`${medium}: a late failure cannot append diagnostics or terminate a newer accepted generation`, async () => {
      const item = await createQualityCreationFixture(medium)
      const entered = deferred<void>(); const release = deferred<void>()
      const primary = new Error('isolated old-generation late rejection')
      const runAI = vi.fn(async () => { entered.resolve(); await release.promise; throw primary })
      const pending = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
      try {
        await entered.promise
        const old = await currentRun(item.scope)
        const revised = await runEvents.reviseAgentRunContractV1({ scope: item.scope, runId: old.run.id,
          expectedLastSequence: old.projection.lastSequence, contract: { ...old.contract, objective: `${old.contract.objective} · 作者显式修订` } })
        expect(revised.projection.generation).toBe(old.projection.generation + 1)
        const before = await databaseBytes()
        release.resolve()
        const result = await pending
        expect(result.error.cause).toBe(primary)
        expect(await databaseBytes()).toBe(before)
        expect(runAI).toHaveBeenCalledTimes(1)
      } finally { release.resolve(); await pending }
    })

    it(`${medium}: adoption cannot change owner through another real Work scope`, async () => {
      const item = await createQualityCreationFixture(medium); const other = await createQualityCreationFixture(medium)
      const generated = await freezeQualityAuthorIntent(medium, item)
      const before = await databaseBytes()
      await expect(adoptQualityCandidate(medium, other.scope, generated.snapshot.run.id)).rejects.toThrow()
      expect(await databaseBytes()).toBe(before)
    })

    it(`${medium}: a checkpoint with a damaged generation cannot authorize adoption`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await freezeQualityAuthorIntent(medium, item)
      const checkpoint = await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).last()
      if (!checkpoint?.id) throw new Error('没有真实的作者意图检查点')
      await db.agentRunCheckpoints.update(checkpoint.id, { generation: checkpoint.generation + 1 })
      const before = await databaseBytes()
      await expect(adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).rejects.toThrow()
      expect(await databaseBytes()).toBe(before)
    })

    it(`${medium}: an imported nonportable frozen intent cannot write after its Run was cancelled`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await freezeQualityAuthorIntent(medium, item)
      const backup = await exportProjectJSON(item.scope.projectId)
      // A real current-scope recovery remains valid before this isolated restore.
      expect((await adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).snapshot.projection.state).toBe('completed')
      await db.delete(); await db.open()
      const projectId = await importProjectJSON(structuredClone(backup))
      const root = await db.adaptationProjects.where('projectId').equals(projectId).first()
      if (!root) throw new Error('导入没有改编根')
      const scope = { projectId, worldId: root.worldId, workId: root.workId }
      const imported = await currentRun(scope)
      expect(imported.projection.state).toBe('cancelled')
      const before = await databaseBytes()
      await expect(adoptQualityCandidate(medium, scope, imported.run.id)).rejects.toThrow()
      expect(await databaseBytes()).toBe(before)
      expect(await db.adaptationSourceFacts.count()).toBe(0); expect(await db.motionDramaSeriesBibles.count()).toBe(0)
    })

    for (const state of ['failed', 'paused'] as const) {
      it(`${medium}: a non-executable ${state} frozen intent is rejected without new formal data or receipts`, async () => {
        const item = await createQualityCreationFixture(medium)
        const generated = await freezeQualityAuthorIntent(medium, item)
        const current = await currentRun(item.scope)
        if (state === 'failed') await runEvents.appendAgentRunEventV1({ scope: item.scope, runId: current.run.id, expectedLastSequence: current.projection.lastSequence, type: 'run.failed', payload: { code: 'isolated-after-intent-failure', retryable: false } })
        else await runEvents.appendAgentRunEventV1({ scope: item.scope, runId: current.run.id, expectedLastSequence: current.projection.lastSequence, type: 'run.paused', payload: { reason: 'isolated-after-intent-pause', recoverable: false } })
        const before = await databaseBytes()
        await expect(adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).rejects.toThrow()
        expect(await databaseBytes()).toBe(before)
      })
    }

    it(`${medium}: a mismatched projected candidate is rejected before writing another intent checkpoint`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
      const stepId = medium === 'comic' ? 'comic-professional:source-analysis' : 'motion-drama:series-bible'
      await runEvents.appendAgentRunEventV1({ scope: item.scope, runId: generated.snapshot.run.id, expectedLastSequence: generated.snapshot.projection.lastSequence,
        type: 'candidate.revised', payload: { stepId, attempt: 1, previousCandidateHash: generated.candidate.candidateHash, candidateHash: '1'.repeat(64) } })
      const before = await databaseBytes()
      await expect(adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).rejects.toThrow()
      expect(await databaseBytes()).toBe(before)
    })

    it(`${medium}: a completed receipt is an exact idempotent readback`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
      const completed = await adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)
      expect(completed.snapshot.projection.state).toBe('completed')
      const before = await databaseBytes()
      expect((await adoptQualityCandidate(medium, item.scope, generated.snapshot.run.id)).receiptHash).toBe(completed.receiptHash)
      expect(await databaseBytes()).toBe(before)
    })

    for (const deletion of ['project', 'run', 'none'] as const) {
      it(`${medium}: a late error after ${deletion} deletion preserves the actual owner lifecycle`, async () => {
        const item = await createQualityCreationFixture(medium)
        const entered = deferred<void>(); const release = deferred<void>()
        const primary = new Error('isolated late transport rejection')
        const runAI = vi.fn(async () => { entered.resolve(); await release.promise; throw primary })
        const pending = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
        await entered.promise
        const current = await currentRun(item.scope)
        if (deletion === 'project') await cascadeDeleteProject(item.scope.projectId)
        if (deletion === 'run') expect(await runEvents.deleteAgentRunV1(item.scope, current.run.id)).toBe(true)
        const before = await databaseBytes()
        release.resolve()
        const result = await pending
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error === primary || result.error.cause === primary).toBe(true)
        expect(runAI).toHaveBeenCalledTimes(1)
        if (deletion !== 'none') expect(await databaseBytes()).toBe(before)
        else {
          expect((await currentRun(item.scope)).projection.state).toBe('paused')
          const errors = (await readOwnedRows<AgentEvent>(item.scope, 'agentEvents', { owner: 'work' })).filter(row => row.kind === 'error')
          expect(errors).toHaveLength(1); expect(errors[0].durableRunId).toBe(current.run.id)
        }
      })
    }

    for (const first of ['deletion', 'diagnostic'] as const) {
      it(`${medium}: native overlapping lifecycle transactions preserve deletion when ${first} starts first`, async () => {
        const item = await createQualityCreationFixture(medium)
        const entered = deferred<void>(); const release = deferred<void>(); const deletionSettled = deferred<{ error?: unknown }>()
        const primary = new Error('isolated overlapping late failure')
        let deletionHadParent: boolean | undefined
        let diagnosticStillActive: boolean | undefined
        let diagnosticTransaction: { active: boolean } | undefined
        // Create the external actor before any native transaction. Resuming
        // an awaiter directly from its callback can inherit Dexie's PSD and
        // accidentally turn the lifecycle operation into a nested TX.
        const actor = new MessageChannel()
        actor.port1.on('message', () => {
          deletionHadParent = Boolean(Dexie.currentTransaction)
          diagnosticStillActive = diagnosticTransaction?.active
          const deleting = cascadeDeleteProject(item.scope.projectId)
          if (first === 'deletion') release.resolve()
          void deleting.then(() => deletionSettled.resolve({}), error => deletionSettled.resolve({ error }))
        })
        let observedTables: string[] = []
        let observedMode: string | undefined
        const runAI = vi.fn(async () => { entered.resolve(); await release.promise; throw primary })
        const pending = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
        try {
          await entered.promise
          const original = conversations.getOrCreateAgentConversation
          vi.spyOn(conversations, 'getOrCreateAgentConversation').mockImplementation(input => {
            // Return the exact original Promise, with no transaction keepalive.
            observedTables = [...(Dexie.currentTransaction?.storeNames ?? [])]
            observedMode = Dexie.currentTransaction?.mode
            diagnosticTransaction = Dexie.currentTransaction
            const result = original(input)
            if (first === 'diagnostic') actor.port2.postMessage('delete')
            return result
          })
          if (first === 'deletion') actor.port2.postMessage('delete')
          else release.resolve()
          const deletion = await deletionSettled.promise
          if (deletion.error) throw deletion.error
          const before = await databaseBytes()
          const result = await pending
          expect(await databaseBytes()).toBe(before)
          expect(await db.projects.count()).toBe(0)
          expect(await db.agentConversations.count()).toBe(0); expect(await db.agentEvents.count()).toBe(0)
          expect(result.error === primary || result.error.cause === primary).toBe(true)
          expect(runAI).toHaveBeenCalledTimes(1)
          expect(deletionHadParent).toBe(false)
          if (first === 'diagnostic') {
            expect(diagnosticStillActive).toBe(true)
            expect(observedMode).toBe('readwrite')
            expect(observedTables).toEqual(expect.arrayContaining(['agentRuns', 'agentRunEvents', 'agentConversations', 'agentEvents', 'projects', 'worlds', 'works']))
          }
        } finally { actor.port1.close(); actor.port2.close(); release.resolve(); await pending }
      })
    }

    it(`${medium}: preparation failure ends the actual Run before any model request`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = `isolated ${medium} context preparation failure`
      const runAI = vi.fn(async () => '[]')
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(new Error(marker))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow(marker)
      expect(runAI).not.toHaveBeenCalled()
      const rows = await readOwnedRows<AgentRunRecord>(item.scope, 'agentRuns', { owner: 'work' })
      expect(rows).toHaveLength(1)
      const snapshot = await readAgentRunV1(item.scope, rows[0].id!)
      expect(snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
      expect(snapshot.projection.state).toBe('failed')
      expect(snapshot.events.some(event => event.type === 'run.failed')).toBe(true)
    })

    for (const point of ['manifest', 'step.scheduled', 'step.started', 'context.assembled'] as const) {
      it(`${medium}: ${point} preparation failure records a real failed Run with zero dispatch`, async () => {
        const item = await createQualityCreationFixture(medium)
        const marker = `isolated ${point} failure`
        if (point === 'manifest') vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockRejectedValueOnce(new Error(marker))
        else {
          const original = runEvents.appendAgentRunEventV1
          vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
            if (input.type === point) throw new Error(marker)
            return original(input)
          })
        }
        const runAI = vi.fn(async () => validPayload(medium, item))
        await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow(marker)
        const snapshot = await currentRun(item.scope)
        expect(snapshot.projection.state).toBe('failed')
        expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
        expect(snapshot.events.filter(event => event.type === 'run.failed')).toHaveLength(1)
        const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
        expect((await read(item.scope, snapshot.run.id)).task.diagnostics.join(' ')).toContain(marker)
        expect(runAI).not.toHaveBeenCalled()
      })
    }

    it(`${medium}: a prompt-building failure after Run creation is a failed preparation, not an unknown send`, async () => {
      const item = await createQualityCreationFixture(medium)
      const runAI = vi.fn(async () => validPayload(medium, item))
      const marker = 'isolated prompt building failure'
      if (medium === 'motion-drama') {
        vi.spyOn(prompts, 'resolveMotionDramaPromptV1').mockRejectedValueOnce(new Error(marker))
        await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow(marker)
      } else {
        // Comic's prompt builder is local and synchronous. Inject a narrow
        // fault only into the trim of this valid author-instruction string.
        const instruction = 'QUALITY001016_PROMPT_FAULT_ONLY'
        const original = String.prototype.trim
        vi.spyOn(String.prototype, 'trim').mockImplementation(function (this: string) {
          if (String(this) === instruction) throw new Error(marker)
          return original.call(this)
        })
        await expect(generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], authorInstruction: instruction, runAI })).rejects.toThrow(marker)
      }
      const snapshot = await currentRun(item.scope)
      expect(snapshot.projection.state).toBe('failed')
      expect(snapshot.events.some(event => event.type === 'context.assembled')).toBe(true)
      expect(snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
      expect(runAI).not.toHaveBeenCalled()
    })

    it(`${medium}: a diagnostic storage failure is visible and preserves the primary failure cause`, async () => {
      const item = await createQualityCreationFixture(medium)
      const primary = new Error('isolated primary context failure')
      const storage = new Error('isolated diagnostic storage failure')
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(primary)
      vi.spyOn(conversations, 'appendAgentEvent').mockRejectedValueOnce(storage)
      const runAI = vi.fn(async () => validPayload(medium, item))
      let error: unknown
      try { await generateQualityCreationCandidate(medium, item, runAI) } catch (cause) { error = cause }
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ cause: primary, persistenceFailures: [storage] })
      expect((error as Error).message).toContain('任务诊断或状态未能完整保存')
      expect((await currentRun(item.scope)).projection.state).toBe('failed')
      expect(runAI).not.toHaveBeenCalled()
    })

    it(`${medium}: a terminal-write failure never reports successful cleanup or silently retries the provider`, async () => {
      const item = await createQualityCreationFixture(medium)
      const primary = new Error('isolated primary preparation failure')
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(primary)
      const original = runEvents.appendAgentRunEventV1
      vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        if (input.type === 'run.failed') throw new Error('isolated terminal storage failure')
        return original(input)
      })
      const runAI = vi.fn(async () => validPayload(medium, item))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('任务诊断或状态未能完整保存')
      const snapshot = await currentRun(item.scope)
      expect(snapshot.projection.state).toBe('running')
      const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const detail = await read(item.scope, snapshot.run.id)
      expect(detail.task.diagnostics.join(' ')).toContain(primary.message)
      expect(detail.task.requestedAttempts).toBe(0)
      expect(detail.task.canStopWaiting).toBe(true)
      expect(runAI).not.toHaveBeenCalled()
      // A database which refuses the terminal write cannot be represented as
      // successfully failed; the original diagnostic and rejection remain.
    })

    it(`${medium}: PROJECT_TABLES round-trip remaps the existing task link and preserves its waiting policy`, async () => {
      const item = await createQualityCreationFixture(medium)
      const runAI = vi.fn(async () => { throw new Error('isolated unknown for backup round-trip') })
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('isolated unknown')
      const before = await currentRun(item.scope)
      await stopWaiting(medium, item.scope)
      const originalControl = (await taskControls(item.scope))[0]
      const backup = await exportProjectJSON(item.scope.projectId)
      const importedProjectId = await importProjectJSON(structuredClone(backup))
      const adaptation = await db.adaptationProjects.where('projectId').equals(importedProjectId).first()
      if (!adaptation) throw new Error('导入缺少改编作品')
      const scope = { projectId: importedProjectId, worldId: adaptation.worldId, workId: adaptation.workId }
      const imported = await currentRun(scope)
      const controls = await taskControls(scope)
      expect(imported.run.id).not.toBe(before.run.id)
      expect(controls).toHaveLength(1)
      expect(controls[0].durableRunId).toBe(imported.run.id)
      expect(controls[0].payload).toBe(originalControl.payload)
      const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const stop = medium === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
      const bytes = await databaseBytes()
      expect((await read(scope, imported.run.id)).task.stoppedWaiting).toBe(true)
      expect((await stop(scope, imported.run.id, { generation: imported.projection.generation, lastSequence: imported.projection.lastSequence })).id).toBe(controls[0].id)
      expect(await databaseBytes()).toBe(bytes)
      expect(await readAgentRunV1(item.scope, before.run.id)).toEqual(before)
      expect(runAI).toHaveBeenCalledTimes(1)
    })

    it(`${medium}: a sensitive error name is not stored as diagnostic metadata`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = 'Bearer SYNTHETIC_CREDENTIAL_NAME_001016'
      const error = new Error('harmless synthetic preparation error')
      error.name = marker
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(error)
      const runAI = vi.fn(async () => validPayload(medium, item))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('harmless synthetic preparation error')
      expect((await databaseBytes()).includes(marker)).toBe(false)
      expect(runAI).not.toHaveBeenCalled()
    })

    it(`${medium}: a sensitive error message has safe visible text and retains its original cause`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = 'Bearer SYNTHETIC_CREDENTIAL_MESSAGE_001016'
      const error = Object.assign(new Error(marker), { status: 401 })
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(error)
      const runAI = vi.fn(async () => validPayload(medium, item))
      let visible: unknown
      try { await generateQualityCreationCandidate(medium, item, runAI) } catch (cause) { visible = cause }
      expect(visible).toBeInstanceOf(Error)
      if (!(visible instanceof Error)) throw new Error('缺少可显示的错误')
      expect(visible.message.includes(marker)).toBe(false)
      expect((visible as Error & { cause?: unknown }).cause).toBe(error)
      expect(error.message).toBe(marker)
      expect(error.status).toBe(401)
      expect((await databaseBytes()).includes(marker)).toBe(false)
      expect((await currentRun(item.scope)).projection.state).toBe('failed')
      expect(runAI).not.toHaveBeenCalled()
    })

    it(`${medium}: stop-waiting for an unknown result is idempotent and keeps the canonical Run`, async () => {
      const item = await createQualityCreationFixture(medium)
      const runAI = vi.fn(async () => { throw new Error('synthetic unknown outcome') })
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('synthetic unknown outcome')
      const before = await currentRun(item.scope)
      const stop = medium === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
      const expected = { generation: before.projection.generation, lastSequence: before.projection.lastSequence }
      const [a, b] = await Promise.all([stop(item.scope, before.run.id, expected), stop(item.scope, before.run.id, expected)])
      expect(a.id).toBe(b.id)
      expect(await taskControls(item.scope)).toHaveLength(1)
      expect(await currentRun(item.scope)).toEqual(before)
      expect((await taskControls(item.scope))[0].durableRunId).toBe(before.run.id)
      const payload = JSON.parse(a.payload) as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual(['action', 'generation', 'kind', 'stepId', 'throughSequence', 'version'])
      expect(payload.action).toBe('stop-waiting')
      expect(runAI).toHaveBeenCalledTimes(1)
    })

    it(`${medium}: stop before request authorization prevents the first model call`, async () => {
      const item = await createQualityCreationFixture(medium)
      const release = deferred<void>()
      let entered = false
      const original = assembly.assembleContext
      vi.spyOn(assembly, 'assembleContext').mockImplementation(async input => {
        const result = await original(input)
        entered = true
        await release.promise
        return result
      })
      const runAI = vi.fn(async () => validPayload(medium, item))
      const result = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        const before = await currentRun(item.scope)
        await stopWaiting(medium, item.scope)
        expect(await currentRun(item.scope)).toEqual(before)
      } finally { release.resolve(); await result }
      expect((await result).error).toBeInstanceOf(Error)
      expect(runAI).not.toHaveBeenCalled()
      const snapshot = await currentRun(item.scope)
      expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
      expect(snapshot.projection.state).toBe('cancelled')
    })

    it(`${medium}: an already authorized late response remains a candidate after author stops waiting`, async () => {
      const item = await createQualityCreationFixture(medium)
      const release = deferred<void>()
      let entered = false
      const runAI = vi.fn(async () => { entered = true; await release.promise; return validPayload(medium, item) })
      const result = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        const before = await currentRun(item.scope)
        expect(before.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
        await stopWaiting(medium, item.scope)
        expect(await currentRun(item.scope)).toEqual(before)
      } finally { release.resolve(); await result }
      const completed = await result
      expect(completed.error).toBeNull()
      expect(completed.value?.snapshot.projection.state).toBe('awaiting_confirmation')
      expect((await currentRun(item.scope)).events.filter(event => event.type === 'model.responded')).toHaveLength(1)
      expect(await db.agentRunCheckpoints.count()).toBe(1)
      expect(await db.adaptationSourceFacts.count()).toBe(0)
      expect(await db.motionDramaSeriesBibles.count()).toBe(0)
      expect(runAI).toHaveBeenCalledTimes(1)
      const readPending = medium === 'comic' ? readPendingComicProfessionalCandidateV1 : readPendingMotionDramaCandidateV1
      const stable = await databaseBytes()
      expect(await readPending(item.scope)).toBeNull()
      expect(await databaseBytes()).toBe(stable)
      const readTask = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const inspected = await readTask(item.scope, completed.value!.snapshot.run.id)
      expect(inspected.task.stoppedWaiting).toBe(true)
      expect(inspected.candidate?.candidateHash).toBe(completed.value!.candidate.candidateHash)
    })

    it(`${medium}: stopping an authorized malformed response prevents automatic repair`, async () => {
      const item = await createQualityCreationFixture(medium)
      const release = deferred<void>()
      let entered = false
      const runAI = vi.fn(async () => { entered = true; await release.promise; return 'complete malformed synthetic output' })
      const result = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        await stopWaiting(medium, item.scope)
      } finally { release.resolve(); await result }
      expect((await result).error).toBeInstanceOf(Error)
      expect(runAI).toHaveBeenCalledTimes(1)
      const snapshot = await currentRun(item.scope)
      expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
      expect(snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
      expect(snapshot.projection.state).toBe('paused')
      expect(snapshot.events.some(event => event.type === 'run.cancelled')).toBe(false)
    })

    it(`${medium}: actual source change during preparation refuses authorization inside the native transaction`, async () => {
      const item = await createQualityCreationFixture(medium)
      const release = deferred<void>()
      let entered = false
      const original = assembly.assembleContext
      vi.spyOn(assembly, 'assembleContext').mockImplementation(async input => {
        const result = await original(input)
        entered = true
        await release.promise
        return result
      })
      const runAI = vi.fn(async () => validPayload(medium, item))
      const result = generateQualityCreationCandidate(medium, item, runAI).then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        await db.chapters.update(item.unit.sourceChapterId!, { content: '<p>作者刚写下的新正文必须保留。</p>', updatedAt: Date.now() })
      } finally { release.resolve(); await result }
      expect((await result).error).toBeInstanceOf(Error)
      expect(runAI).not.toHaveBeenCalled()
      expect((await currentRun(item.scope)).events.filter(event => event.type === 'model.requested')).toHaveLength(0)
      expect((await db.chapters.get(item.unit.sourceChapterId!))?.content).toContain('作者刚写下')
    })

    it(`${medium}: wrong owner or stale prefix cannot add even a task channel`, async () => {
      const item = await createQualityCreationFixture(medium)
      await expect(generateQualityCreationCandidate(medium, item, async () => { throw new Error('synthetic unknown') })).rejects.toThrow('synthetic unknown')
      const other = await createQualityCreationFixture(medium)
      const snapshot = await currentRun(item.scope)
      const stop = medium === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
      const before = await databaseBytes()
      await expect(stop(other.scope, snapshot.run.id, { generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence })).rejects.toThrow()
      expect(await databaseBytes()).toBe(before)
      await expect(stop(item.scope, snapshot.run.id, { generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence - 1 })).rejects.toThrow('任务已推进')
      expect(await databaseBytes()).toBe(before)
    })

    it(`${medium}: failed candidate event retains the real checkpoint for zero-model recovery`, async () => {
      const item = await createQualityCreationFixture(medium)
      const original = runEvents.appendAgentRunEventV1
      let interrupted = false
      const spy = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        if (input.type === 'candidate.persisted' && !interrupted) { interrupted = true; throw new Error('isolated candidate event write failure') }
        return original(input)
      })
      const runAI = vi.fn(async () => validPayload(medium, item))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('candidate event write failure')
      spy.mockRestore()
      const before = await currentRun(item.scope)
      expect(before.projection.state).toBe('paused')
      const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const detail = await read(item.scope, before.run.id)
      expect(detail.task.candidateState).toBe('available')
      expect(detail.task.canRecoverCandidate).toBe(true)
      expect(detail.candidate).toBeDefined()
      const expected = { generation: detail.task.generation, lastSequence: detail.task.lastSequence, candidateHash: detail.candidate!.candidateHash }
      const recover = medium === 'comic' ? recoverComicProfessionalCandidateV1 : recoverMotionDramaCandidateV1
      const recovered = await recover(item.scope, before.run.id, expected)
      expect(recovered.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(recovered.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
      expect(runAI).toHaveBeenCalledTimes(1)
      const stable = await databaseBytes()
      expect((await recover(item.scope, before.run.id, expected)).candidate.candidateHash).toBe(expected.candidateHash)
      expect(await databaseBytes()).toBe(stable)
      expect(await db.adaptationSourceFacts.count()).toBe(0)
      expect(await db.motionDramaSeriesBibles.count()).toBe(0)
    })

    it(`${medium}: a checkpoint storage failure shows observed evidence without fabricating a candidate`, async () => {
      const item = await createQualityCreationFixture(medium)
      vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('isolated checkpoint storage failure'))
      const runAI = vi.fn(async () => validPayload(medium, item))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('checkpoint storage failure')
      const snapshot = await currentRun(item.scope)
      const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const stable = await databaseBytes()
      const detail = await read(item.scope, snapshot.run.id)
      expect(detail.task.status).toBe('failed')
      expect(detail.task.requestedAttempts).toBe(1)
      expect(detail.task.respondedAttempts).toBe(1)
      expect(detail.task.candidateState).toBe('missing')
      expect(detail.task.canRecoverCandidate).toBe(false)
      expect(detail.task.diagnostics.join(' ')).toContain('checkpoint storage failure')
      expect(detail.candidate).toBeUndefined()
      expect(await databaseBytes()).toBe(stable)
      expect(runAI).toHaveBeenCalledTimes(1)
    })

    it(`${medium}: stale source cannot promote a saved checkpoint or change recovery evidence`, async () => {
      const item = await createQualityCreationFixture(medium)
      const original = runEvents.appendAgentRunEventV1
      const spy = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        if (input.type === 'candidate.persisted') throw new Error('isolated candidate persistence interruption')
        return original(input)
      })
      const runAI = vi.fn(async () => validPayload(medium, item))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('candidate persistence interruption')
      spy.mockRestore()
      const snapshot = await currentRun(item.scope)
      const read = medium === 'comic' ? readComicProfessionalTaskV1 : readMotionDramaTaskV1
      const detail = await read(item.scope, snapshot.run.id)
      await db.chapters.update(item.unit.sourceChapterId!, { content: '<p>作者确认保留的新稿。</p>', updatedAt: Date.now() })
      const stable = await databaseBytes()
      const recover = medium === 'comic' ? recoverComicProfessionalCandidateV1 : recoverMotionDramaCandidateV1
      await expect(recover(item.scope, snapshot.run.id, { generation: detail.task.generation, lastSequence: detail.task.lastSequence, candidateHash: detail.candidate!.candidateHash })).rejects.toThrow()
      expect(await databaseBytes()).toBe(stable)
      expect(runAI).toHaveBeenCalledTimes(1)
    })

    it(`${medium}: a damaged candidate remains a visible task and cannot be recovered`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
      const checkpoint = await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).last()
      await db.agentRunCheckpoints.update(checkpoint!.id!, { resumePayloadJson: '{}' })
      const list = medium === 'comic' ? listComicProfessionalTasksV1 : listMotionMaterialTasks
      const stable = await databaseBytes()
      const tasks = await list(item.scope)
      expect(tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: generated.snapshot.run.id, candidateState: 'unverified', canRecoverCandidate: false })]))
      expect(await databaseBytes()).toBe(stable)
      const recover = medium === 'comic' ? recoverComicProfessionalCandidateV1 : recoverMotionDramaCandidateV1
      await expect(recover(item.scope, generated.snapshot.run.id, { generation: generated.snapshot.projection.generation, lastSequence: generated.snapshot.projection.lastSequence, candidateHash: generated.candidate.candidateHash })).rejects.toThrow()
      expect(await databaseBytes()).toBe(stable)
    })

    it(`${medium}: a frozen author intent cannot be discarded by stop-waiting`, async () => {
      const item = await createQualityCreationFixture(medium)
      const generated = await generateQualityCreationCandidate(medium, item, async () => validPayload(medium, item))
      const original = runEvents.appendAgentRunEventV1
      const spy = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        const value = await original(input)
        if (input.type === 'adoption.started') throw new Error('isolated frozen author intent interruption')
        return value
      })
      const adopt = medium === 'comic' ? adoptComicProfessionalCandidateV1 : adoptMotionDramaProfessionalCandidateV1
      await expect(adopt({ scope: item.scope, runId: generated.snapshot.run.id })).rejects.toThrow('frozen author intent interruption')
      spy.mockRestore()
      const snapshot = await currentRun(item.scope)
      const stable = await databaseBytes()
      const stop = medium === 'comic' ? stopWaitingComicProfessionalTaskV1 : stopWaitingMotionDramaTaskV1
      await expect(stop(item.scope, snapshot.run.id, { generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence })).rejects.toThrow('采纳意图')
      expect(await databaseBytes()).toBe(stable)
    })

    it(`${medium}: an earlier waiting policy cannot hide a subsequently frozen author intent`, async () => {
      const item = await createQualityCreationFixture(medium)
      const release = deferred<void>()
      let entered = false
      const generation = generateQualityCreationCandidate(medium, item, async () => {
        entered = true; await release.promise; return validPayload(medium, item)
      })
      const settled = generation.then(value => ({ value, error: null }), error => ({ value: null, error }))
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        await stopWaiting(medium, item.scope)
      } finally { release.resolve(); await settled }
      const generated = (await settled).value!
      const original = runEvents.appendAgentRunEventV1
      const spy = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        const value = await original(input)
        if (input.type === 'adoption.started') throw new Error('isolated post-waiting adoption interruption')
        return value
      })
      const adopt = medium === 'comic' ? adoptComicProfessionalCandidateV1 : adoptMotionDramaProfessionalCandidateV1
      await expect(adopt({ scope: item.scope, runId: generated.snapshot.run.id })).rejects.toThrow('post-waiting adoption interruption')
      spy.mockRestore()
      const pending = medium === 'comic' ? await readPendingComicProfessionalCandidateV1(item.scope) : await readPendingMotionDramaCandidateV1(item.scope)
      expect(pending?.snapshot.run.id).toBe(generated.snapshot.run.id)
      expect(pending).toMatchObject(medium === 'comic' ? { recovering: true } : { resuming: true })
    })

    it(`${medium}: task notification freezes only identifiers and keeps opaque callback receivers`, async () => {
      const item = await createQualityCreationFixture(medium)
      const other = await createQualityCreationFixture(medium)
      let receiver: unknown
      let notifiedId = 0
      const common = {
        scope: { ...item.scope }, calls: 0,
        onTaskCreated(task: Readonly<{ runId: number; generation: number; lastSequence: number }>): void {
          expect(this).toBe(receiver)
          expect(Object.isFrozen(task)).toBe(true)
          expect(Object.keys(task).sort()).toEqual(['generation', 'lastSequence', 'runId'])
          notifiedId = task.runId
          this.scope = { ...other.scope }
        },
        async runAI(): Promise<string> {
          expect(this).toBe(receiver)
          this.calls += 1
          return validPayload(medium, item)
        },
      }
      if (medium === 'comic') {
        const input = { ...common, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis' as const, sourceUnitKeys: [item.unit.sourceUnitKey] }
        receiver = input
        const generated = await generateComicProfessionalCandidateV1(input)
        expect(generated.snapshot.run.id).toBe(notifiedId)
        expect(generated.candidate.workId).toBe(item.scope.workId)
        expect(input.scope).toEqual(other.scope)
        expect(input.calls).toBe(1)
      } else {
        const input = { ...common, stage: 'series-bible' as const, episodeNumber: 1 }
        receiver = input
        const generated = await generateMotionDramaCandidateV1(input)
        expect(generated.snapshot.run.id).toBe(notifiedId)
        expect(generated.candidate.workId).toBe(item.scope.workId)
        expect(input.scope).toEqual(other.scope)
        expect(input.calls).toBe(1)
      }
    })

    it(`${medium}: task notification cannot change the private Run identity`, async () => {
      const item = await createQualityCreationFixture(medium)
      const runAI = vi.fn(async () => validPayload(medium, item))
      const onTaskCreated = (task: Readonly<{ runId: number; generation: number; lastSequence: number }>) => { Object.assign(task, { runId: 999999 }) }
      const promise = medium === 'comic'
        ? generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', runAI, onTaskCreated })
        : generateMotionDramaCandidateV1({ scope: item.scope, stage: 'series-bible', episodeNumber: 1, runAI, onTaskCreated })
      await expect(promise).rejects.toThrow()
      const snapshot = await currentRun(item.scope)
      expect(snapshot.run.id).not.toBe(999999)
      expect(snapshot.projection.state).toBe('failed')
      expect(runAI).not.toHaveBeenCalled()
    })
  }

  it('motion: an unknown result without a candidate stays in the task list', async () => {
    const item = await createQualityCreationFixture('motion-drama')
    const runAI = vi.fn(async () => { throw new Error('isolated unknown transport outcome') })
    await expect(generateQualityCreationCandidate('motion-drama', item, runAI)).rejects.toThrow('unknown transport outcome')
    const rows = await readOwnedRows<AgentRunRecord>(item.scope, 'agentRuns', { owner: 'work' })
    const snapshot = await readAgentRunV1(item.scope, rows[0].id!)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(snapshot.projection.state).toBe('paused')
    expect(await listMotionMaterialTasks(item.scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rows[0].id, status: 'paused' }),
    ]))
    expect(runAI).toHaveBeenCalledTimes(1)
  })

  it('motion: a failed protocol task remains visible with both observed attempts', async () => {
    const item = await createQualityCreationFixture('motion-drama')
    const runAI = vi.fn(async () => 'malformed complete synthetic output')
    await expect(generateQualityCreationCandidate('motion-drama', item, runAI)).rejects.toThrow()
    const rows = await readOwnedRows<AgentRunRecord>(item.scope, 'agentRuns', { owner: 'work' })
    const snapshot = await readAgentRunV1(item.scope, rows[0].id!)
    expect(runAI).toHaveBeenCalledTimes(2)
    expect(snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(2)
    expect(snapshot.projection.state).toBe('failed')
    expect(await listMotionMaterialTasks(item.scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rows[0].id, status: 'failed' }),
    ]))
    // Raw output retention remains the separate SFQA-002 repair; this test
    // checks the Run and its observed attempts without fabricating raw bytes.
  })

  it('comic control: one unknown attempt stays paused and creates no candidate', async () => {
    const item = await createQualityCreationFixture('comic')
    const runAI = vi.fn(async () => { throw new Error('isolated comic unknown') })
    await expect(generateQualityCreationCandidate('comic', item, runAI)).rejects.toThrow('isolated comic unknown')
    const rows = await readOwnedRows<AgentRunRecord>(item.scope, 'agentRuns', { owner: 'work' })
    expect((await readAgentRunV1(item.scope, rows[0].id!)).projection.state).toBe('paused')
    expect(await readPendingComicProfessionalCandidateV1(item.scope)).toBeNull()
    expect(await listComicProfessionalTasksV1(item.scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rows[0].id, status: 'paused' }),
    ]))
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(await db.adaptationSourceFacts.count()).toBe(0)
  })

  it('normal motion candidate still waits for author and writes no formal Bible', async () => {
    const item = await createQualityCreationFixture('motion-drama')
    const runAI = vi.fn(async () => JSON.stringify(qualityMotionBible))
    const generated = await generateQualityCreationCandidate('motion-drama', item, runAI)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await listMotionMaterialTasks(item.scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generated.snapshot.run.id, status: 'awaiting_confirmation' }),
    ]))
    expect(await db.motionDramaSeriesBibles.count()).toBe(0)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
})
