import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 as fixture } from '../helpers/open-local-voice'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenLocalVoiceExecutionV1, readTtrpgOpenLocalVoicePreparationV1, readTtrpgOpenVoiceRequestDeskV1, cancelTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1 as decision, TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1 as relation,
  TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId, createTtrpgOpenVoiceExecutionInputForKernelV1 } from '../../src/lib/ttrpg/open-voice-execution-input'
import { hashCanonicalValue, canonicalStringify } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { projectTtrpgOpenMechanicalBasisV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { getFormalAIEntryBindingV1, assertFormalAIEntryCallV1 } from '../../src/lib/agent/formal-ai-entry'
import * as ledger from '../../src/lib/agent/run/event-store'
import * as artifacts from '../../src/lib/memory/artifact-store'
import { dispatchTtrpgOpenLocalVoiceForKernelV1, type TtrpgOpenLocalVoiceTransportV1 } from '../../src/lib/ttrpg/open-voice-execution'
import * as formal from '../../src/lib/agent/formal-ai-entry'

const readingProfile = JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json', 'utf8'))
const productProfile = JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile.json', 'utf8'))

describe('R-TTRPGOPEN10 unique governed local speech preparation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('the actual registered-source input is accepted unchanged by the Node worker protocol, without creating a job or calling models', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    const content = await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash })
    const packet = { jobKey: `ttrpg.voice.${prepared.runId}.${prepared.inputArtifactHash}`, inputArtifactHash: prepared.inputArtifactHash, execution: JSON.parse(content) }
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import {readFileSync} from 'node:fs';
import {validateProductJob} from './scripts/ttrpg-local-tts/product-contract.mjs';
const input=validateProductJob(JSON.parse(readFileSync(0,'utf8')));
console.log(JSON.stringify({text:input.execution.source.text,reading:input.execution.reading.normalizedText,scope:input.execution.source.scope,hash:input.inputArtifactHash}));
`], { encoding: 'utf8', input: JSON.stringify(packet) }))
    expect(result).toEqual({ text: '编号001。', reading: '编号零零一.', scope: packet.execution.source.scope, hash: prepared.inputArtifactHash })
    expect((await db.agentRunEvents.toArray()).some(e => e.type === 'model.requested')).toBe(false)
    expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('keeps one completed intent and one original execution Run, exact raw context plus explicit reading, without model/media/mechanical writes', async () => {
    const s = await fixture(), before = await readProductRuntimeState(s.owner.sessionId), eventCount = await db.productRuntimeEvents.count()
    const prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    const child = await ledger.readInstanceAgentRunV1(s.owner.scope, prepared.runId), parent = (await db.agentRuns.get(child.run.parentRunId!))!
    expect(prepared).toMatchObject({ status: 'prepared', generationAllowed: false, adoptionAllowed: false })
    expect(parent.status).toBe('completed'); expect(parent.terminalReceiptHash).toBe(s.requested.intentReceiptHash)
    expect(child.run).toMatchObject({ productRuntimeSessionId: s.owner.sessionId, parentRelation: relation, parentReceiptHash: parent.terminalReceiptHash })
    expect(child.contract).toMatchObject({ version: 3, executionBoundary: 'product-runtime', permissions: { contextSourceKeys: ['ttrpgOpenVoiceText'], writeTargets: [] },
      budget: { maxModelCalls: 128, maxToolCalls: 0, maxAttemptsPerStep: 1 }, runtimeBindingHash: prepared.inputArtifactHash })
    expect(child.projection.steps[stepId]).toMatchObject({ status: 'running', attempt: 1 })
    expect(child.events.some(e => ['model.requested', 'tool.called', 'candidate.persisted', 'verification.accepted'].includes(e.type))).toBe(false)
    const raw = await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash })
    const input = JSON.parse(raw)
    expect(input.source.text).toBe(s.text); expect(input.reading.normalizedText).toBe('编号零零一.')
    expect(input.profile).toEqual(productProfile); expect(input.reading.profile).toEqual(readingProfile)
    expect(input.intent).toMatchObject({ receiptHash: parent.terminalReceiptHash, verificationArtifactHash: child.run.parentArtifactHash })
    expect(await hashCanonicalValue(input)).toBe(prepared.inputArtifactHash)
    const manifestEvent = child.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-manifest')!
    if (manifestEvent.type !== 'evidence.artifact.recorded') throw new Error('Expected exact manifest')
    const manifest = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'context-manifest', contentHash: manifestEvent.payload.contentHash }))
    expect(manifest.manifestHash).toBe(prepared.manifestHash)
    expect(manifest.sources).toMatchObject([{ key: 'ttrpgOpenVoiceText', contentHash: await sha256Text(s.text), status: 'included', delivery: 'full' }])
    db.close(); await db.open()
    expect(await readTtrpgOpenLocalVoicePreparationV1(s.input)).toEqual(prepared)
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0]).toMatchObject({ status: 'execution-preparation-recorded', execution: { runId: prepared.runId, dispatchRecorded: false, cancellationConfirmed: false } })
    expect(await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).toEqual(prepared)
    expect(await db.agentRuns.count()).toBe(2); expect(await db.productRuntimeEvents.count()).toBe(eventCount)
    const after = await readProductRuntimeState(s.owner.sessionId)
    expect(after).toEqual(before); expect(projectTtrpgOpenMechanicalBasisV1(after)).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
    expect(await db.productMediaAssets.count()).toBe(0)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...s.input, decision: 'cancel-this-unsent-voice-request' })).rejects.toThrow(/子任务|执行/)
  })
  it('concurrent preparation consumes only the unique parent relation and records each durable boundary once', async () => {
    const s = await fixture(), results = await Promise.all([prepareTtrpgOpenLocalVoiceExecutionV1(s.input), prepareTtrpgOpenLocalVoiceExecutionV1(s.input)])
    expect(results[0]).toEqual(results[1]); expect(await db.agentRuns.count()).toBe(2)
    const snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, results[0].runId)
    for (const type of ['step.scheduled', 'step.started', 'context.assembled']) expect(snapshot.events.filter(e => e.type === type)).toHaveLength(1)
    expect(snapshot.events.filter(e => e.type === 'evidence.artifact.recorded')).toHaveLength(2)
  })
  it('cancellation that wins before child creation leaves no contradictory local execution child', async () => {
    const s = await fixture(), create = ledger.createAgentRunV1
    let intercepted = false
    vi.spyOn(ledger, 'createAgentRunV1').mockImplementation(async input => {
      if (!intercepted && (input.contract as { objective?: string }).objective === 'ttrpg.open.local-voice:' + s.requested.requestKey) {
        intercepted = true
        await cancelTtrpgOpenVoiceRequestV1({ ...s.owner, requestKey: s.requested.requestKey, decision: 'cancel-this-unsent-voice-request' })
      }
      return create(input)
    })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toMatchObject({ code: 'runtime_snapshot_stale' })
    const children = (await db.agentRuns.toArray()).filter(r => r.parentRelation === relation)
    const modelEvents = (await db.agentRunEvents.toArray()).filter(e => e.type === 'model.requested')
    expect(intercepted).toBe(true); expect(modelEvents).toHaveLength(0); expect(children).toHaveLength(0)
    const desk = await readTtrpgOpenVoiceRequestDeskV1(s.owner)
    expect(desk.requests).toHaveLength(1); expect(desk.requests[0].status).toBe('cancelled-before-send')
    const parents = await db.agentRuns.toArray()
    expect(parents).toHaveLength(1); expect(parents[0].status).toBe('completed')
  })
  it.each(['created', 'started', 'input', 'manifest', 'context'] as const)('recovers a real lost %s return through the same original child; read-only reload never fills the gap', async boundary => {
    const s = await fixture()
    if (boundary === 'created') {
      const original = ledger.createAgentRunV1
      vi.spyOn(ledger, 'createAgentRunV1').mockImplementationOnce(async input => { await original(input); throw new Error('lost-boundary-return') })
    } else if (boundary === 'input' || boundary === 'manifest') {
      const original = artifacts.recordAgentRunArtifactV1
      let fired = false
      vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
        const result = await original(input)
        if (!fired && input.artifactKind === (boundary === 'input' ? 'source-snapshot' : 'context-manifest')) { fired = true; throw new Error('lost-boundary-return') }
        return result
      })
    } else {
      const original = ledger.appendAgentRunEventV1
      let fired = false
      vi.spyOn(ledger, 'appendAgentRunEventV1').mockImplementation(async input => {
        const result = await original(input)
        if (!fired && input.type === (boundary === 'started' ? 'step.started' : 'context.assembled')) { fired = true; throw new Error('lost-boundary-return') }
        return result
      })
    }
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow('lost-boundary-return')
    vi.restoreAllMocks()
    const rows = await db.agentRuns.toArray(), child = rows.find(r => r.parentRelation === relation)!, events = await db.agentRunEvents.where('runId').equals(child.id!).count()
    if (boundary === 'context') expect(await readTtrpgOpenLocalVoicePreparationV1(s.input)).toMatchObject({ runId: child.id })
    else await expect(readTtrpgOpenLocalVoicePreparationV1(s.input)).rejects.toThrow(/缺少|尚未完成/)
    expect(await db.agentRunEvents.where('runId').equals(child.id!).count()).toBe(events)
    const recovered = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    expect(recovered.runId).toBe(child.id); expect(await db.agentRuns.count()).toBe(2)
    expect(rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests).toHaveLength(1)
  })
  it('requires current human authority, explicit preparation and a confirmed reading before any execution child exists', async () => {
    const legacy = await fixture(false)
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(legacy.input)).rejects.toThrow(/明确确认的读法/)
    expect(await db.agentRuns.count()).toBe(1)
    await db.delete(); await db.open()
    const s = await fixture()
    expect(await readTtrpgOpenLocalVoicePreparationV1(s.input)).toBeNull()
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1({ ...s.input, decision: 'start' as never })).rejects.toThrow()
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1({ ...s.input, viewerKey: 'viewer.other' })).rejects.toThrow()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'execution.pause'), viewerKey: s.owner.viewerKey, status: 'paused', changedBy: s.owner.viewerKey, reason: 'pause-before-speech' })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('keeps archived unsupported frontend bytes but rejects them as current product input even with correct self hashes', async () => {
    const s = await fixture(), row = structuredClone(rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0])
    row.reading!.profile.profileId = 'archived-reading-v0'; row.reading!.profileHash = await hashCanonicalValue(row.reading!.profile)
    const oldPreview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: row.reading!.profileHash,
      normalizerSha256: row.reading!.normalizerSha256, status: 'ready-for-reading-review', sourceText: s.text, sourceTextSha256: row.part.textHash,
      overrides: row.reading!.overrides, readingText: '编号零零一。', normalizedText: row.reading!.normalizedText, normalizedTextSha256: row.reading!.normalizedTextSha256,
      issues: [], issueCount: 0, issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
    row.reading!.previewHash = await hashCanonicalValue(oldPreview)
    await expect(createTtrpgOpenVoiceExecutionInputForKernelV1({ row, sourceText: s.text, intentReceiptHash: s.requested.intentReceiptHash, intentVerificationArtifactHash: 'a'.repeat(64) })).rejects.toThrow(/版本不支持/)
    expect((await db.agentRuns.toArray()).every(r => !r.parentRunId)).toBe(true)
  })
  it('retains lineage/input through backup but grants neither imported nor ancestor intents execution authority; deletion follows the original session owner', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    const raw = await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash })
    const exported = await exportProjectJSON(s.owner.scope.projectId), projectId = await importProjectJSON(exported)
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const locator = { scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id!, viewerKey: s.owner.viewerKey, requestKey: s.input.requestKey, decision }
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash })).toBe(raw)
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(locator)).rejects.toThrow()
    const branch = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence, title: 'speech-before-dispatch' })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1({ ...s.input, sessionId: branch.id! })).rejects.toThrow()
    await deleteProductRuntimeSession(s.owner.sessionId)
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(s.owner.sessionId).count()).toBe(0)
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(imported.id!).count()).toBe(2)
    expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('uses its own formal entry with exact source, no context planner/compression/tools, no adoption and physical audio limits', () => {
    const skill = getAgentSkillV1('prose.ttrpg-open-local-voice'), entry = getFormalAIEntryBindingV1('ttrpg.open.local-voice')
    expect(skill.contextSourceKeys).toEqual(['ttrpgOpenVoiceText']); expect(skill.contextCompression.sourceKeys).toEqual(['ttrpgOpenVoiceText'])
    expect(skill.contextGateway).toBeUndefined(); expect(skill.writeTargets).toEqual([]); expect(skill.readToolNames).toEqual([])
    expect(entry).toMatchObject({ skillId: skill.id, entryKind: 'formal', executionBoundary: 'product-runtime', adoptAllowed: false,
      candidateKind: 'storyforge.ttrpg-open-voice-candidate', allowedCallers: ['src/lib/ttrpg/open-voice-execution.ts'] })
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: entry.entryId, category: 'runtime.ttrpg-open.kp' })).toThrow()
    expect(productProfile).toMatchObject({ maxSourceUtf16: 2000, maxReadingUtf16: 4000, maxAudioBytes: 100 * 1024 * 1024,
      requiredAuthority: 'original-durable-voice-execution-v1', readingRecomputationRequired: true, automaticRetryAllowed: false, adoptionAllowed: false })
    expect(JSON.parse(readFileSync('scripts/ttrpg-local-tts/runtime-profile.json', 'utf8')).productInvocationAllowed).toBe(false)
    expect(readingProfile.modelInvocationAllowed).toBe(false)
    expect(canonicalStringify(entry)).not.toContain('open-intent-harness')
  })
  it('records dispatch before one injected transport call, retains unparsed raw output first, and never resends on repeat/reload', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    let calls = 0
    const transport: TtrpgOpenLocalVoiceTransportV1 = { kind: 'local-offline-speech-v1', profileHash: prepared.profileHash, execute: async request => {
      calls++
      const current = await ledger.readInstanceAgentRunV1(s.owner.scope, prepared.runId)
      expect(current.events.filter(e => e.type === 'model.requested')).toHaveLength(1)
      expect(request.execution.source.text).toBe(s.text); expect(request.execution.reading.normalizedText).toBe('编号零零一.')
      expect(request.inputArtifactHash).toBe(prepared.inputArtifactHash)
      return 'synthetic invalid audio protocol: retained verbatim for later validation'
    } }
    const request = { ...s.input, decision: 'dispatch-this-original-local-voice-execution' as const, transport }
    const result = await dispatchTtrpgOpenLocalVoiceForKernelV1(request)
    expect(result).toMatchObject({ status: 'raw-response-recorded', candidateAccepted: false, adoptionAllowed: false })
    if (result.status !== 'raw-response-recorded') throw new Error('Expected raw-only evidence')
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'raw-response', contentHash: result.responseArtifactHash })).toContain('synthetic invalid audio protocol')
    db.close(); await db.open()
    expect(await dispatchTtrpgOpenLocalVoiceForKernelV1(request)).toMatchObject({ status: 'dispatch-already-recorded', jobKey: result.jobKey })
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0]).toMatchObject({ status: 'execution-dispatch-recorded', execution: { dispatchRecorded: true, rawResponseEvidenceRecorded: true } })
    await expect(prepareTtrpgOpenLocalVoiceExecutionV1(s.input)).rejects.toThrow(/已派发|结束/)
    expect(calls).toBe(1); expect(await db.agentRuns.count()).toBe(2); expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('keeps a durable unknown attempt after a transport failure; wrong profile and pre-dispatch cancellation cannot call the transport', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input)
    let calls = 0
    const transport: TtrpgOpenLocalVoiceTransportV1 = { kind: 'local-offline-speech-v1', profileHash: prepared.profileHash, execute: async () => { calls++; throw new Error('unknown-local-result') } }
    const request = { ...s.input, decision: 'dispatch-this-original-local-voice-execution' as const, transport }
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...request, transport: { ...transport, profileHash: '0'.repeat(64) } })).rejects.toThrow(/版本不匹配/)
    const controller = new AbortController(); controller.abort()
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...request, signal: controller.signal })).rejects.toThrow()
    expect(calls).toBe(0)
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1(request)).rejects.toThrow('unknown-local-result')
    const snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, prepared.runId)
    expect(snapshot.projection.state).toBe('paused'); expect(snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(1)
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0]).toMatchObject({ status: 'execution-dispatch-recorded', execution: { runState: 'paused', cancellationConfirmed: false, rawResponseEvidenceRecorded: false } })
    expect(await dispatchTtrpgOpenLocalVoiceForKernelV1(request)).toMatchObject({ status: 'dispatch-already-recorded', automaticRetryAllowed: false })
    expect(calls).toBe(1); expect(rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests).toHaveLength(1)
  })
  it('a lost dispatch ledger return never guesses unsent or invokes the transport on recovery', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input), original = ledger.appendAgentRunEventV1
    let calls = 0
    const transport: TtrpgOpenLocalVoiceTransportV1 = { kind: 'local-offline-speech-v1', profileHash: prepared.profileHash, execute: async () => { calls++; return 'never-called' } }
    const request = { ...s.input, decision: 'dispatch-this-original-local-voice-execution' as const, transport }
    vi.spyOn(ledger, 'appendAgentRunEventV1').mockImplementationOnce(async input => { const result = await original(input); expect(result.events.at(-1)?.type).toBe('model.requested'); throw new Error('lost-dispatch-return') })
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1(request)).rejects.toThrow('lost-dispatch-return')
    vi.restoreAllMocks()
    expect(await dispatchTtrpgOpenLocalVoiceForKernelV1(request)).toMatchObject({ status: 'dispatch-already-recorded', automaticRetryAllowed: false })
    expect(calls).toBe(0)
  })
  it('rechecks the actual owner after asynchronous frozen binding verification, so a pause during that guard cannot send speech', async () => {
    const s = await fixture(), prepared = await prepareTtrpgOpenLocalVoiceExecutionV1(s.input), original = formal.executeFrozenFormalAudioEntryV1
    let calls = 0
    vi.spyOn(formal, 'executeFrozenFormalAudioEntryV1').mockImplementationOnce(async (...args) => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'execution.pause.in-guard'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: 'pause-during-formal-guard' })
      return original(...args)
    })
    await expect(dispatchTtrpgOpenLocalVoiceForKernelV1({ ...s.input, decision: 'dispatch-this-original-local-voice-execution',
      transport: { kind: 'local-offline-speech-v1', profileHash: prepared.profileHash, execute: async () => { calls++; return 'must-not-send' } } })).rejects.toThrow(/进度|来源|身份|变化|暂停/)
    expect(calls).toBe(0)
    const snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, prepared.runId)
    expect(snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(1)
    expect(snapshot.projection.state).toBe('paused')
  })
})
