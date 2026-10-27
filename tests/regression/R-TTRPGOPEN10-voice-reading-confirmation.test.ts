import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenVoiceScriptV1, prepareTtrpgOpenVoiceReadingReviewV1, reserveTtrpgOpenVoiceRequestV1,
  readTtrpgOpenVoiceRequestDeskV1, recoverTtrpgOpenVoiceIntentV1, cancelTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_CONFIRM_READING_DECISION_V1 as confirm, verifyTtrpgOpenConfirmedVoiceReadingV1 } from '../../src/lib/ttrpg/open-voice-confirmed-reading-contract'
import { ttrpgOpenVoiceRequestInputV1, parseTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-voice-request-contract'
import { verifyTtrpgOpenVoiceReadingPreviewV1 } from '../../src/lib/ttrpg/open-voice-reading-contract'
import { hashCanonicalValue, canonicalStringify } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { projectTtrpgOpenMechanicalBasisV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { changeTtrpgSafetyStatus, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import * as ledger from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1, markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'

const profile = JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json', 'utf8'))
type Setup = Awaited<ReturnType<typeof setupAudioRuntimeV1>>
async function inputFor(s: Setup, ready = true) {
  const sourceReview = await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef,
    audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
  const overrides = ready ? [{ textOffset: 2, textLength: 3, spokenText: '零零一' }] : []
  const normalizedText = ready ? '编号零零一.' : null
  const preview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: await hashCanonicalValue(profile),
    normalizerSha256: profile.normalizerSha256, status: ready ? 'ready-for-reading-review' : 'needs-reading-choice', sourceText: s.text,
    sourceTextSha256: await sha256Text(s.text), overrides, readingText: ready ? '编号零零一。' : s.text, normalizedText,
    normalizedTextSha256: normalizedText === null ? null : await sha256Text(normalizedText), issues: ready ? [] : [{ code: 'ambiguous-number', textOffset: 2, textLength: 3 }],
    issueCount: ready ? 0 : 1, issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  const part = { textOffset: 0, textLength: s.text.length }
  const review = await prepareTtrpgOpenVoiceReadingReviewV1({ ...s.owner, sourceReview, part, overrides, preview, decision: 'review-this-local-voice-reading' })
  return { ...s.owner, review: sourceReview, part, submissionKey: 'reading.confirm.original', decision: 'reserve-this-original-voice-part' as const,
    readingConfirmation: { review, decision: confirm } }
}
async function replay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(await readProductRuntimeState(sessionId))
}

describe('R-TTRPGOPEN10 explicit reading frozen in the original voice intent', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('freezes the actual human-reviewed reading in the original input and terminal receipt without rewriting the registered source or mechanics', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), input = await inputFor(s), before = await readProductRuntimeState(s.owner.sessionId)
    const requested = await reserveTtrpgOpenVoiceRequestV1(input), state = await readProductRuntimeState(s.owner.sessionId), row = rt(state).openRun!.voiceRequests![0]
    expect(row.reading).toMatchObject({ schema: 'storyforge.ttrpg-open-confirmed-voice-reading', version: 1, decision: confirm,
      sourceTextHash: row.part.textHash, normalizedText: '编号零零一.', previewHash: input.readingConfirmation.review.previewHash })
    expect(row.script.text).toBe(s.text); expect(projectTtrpgOpenMechanicalBasisV1(state)).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
    const raw = await readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: row.inputArtifactHash })
    expect(JSON.parse(raw).reading).toEqual(row.reading); expect(await sha256Text(raw)).toBe(row.inputArtifactHash)
    const run = (await db.agentRuns.toArray())[0], snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, run.id!)
    expect(snapshot.projection.state).toBe('completed'); expect(snapshot.events.some(e => e.type === 'model.requested' || e.type === 'tool.called')).toBe(false)
    const context = await assembleContext({ projectId: s.owner.scope.projectId, scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId,
      sourceKeys: ['ttrpgOpenVoiceText'], ttrpgVoiceRequest: { viewerKey: s.owner.viewerKey, requestKey: requested.requestKey, intentReceiptHash: requested.intentReceiptHash }, inputBudgetTokens: 8000 })
    expect(context.text).toBe('编号001。'); expect(context.text).not.toBe(row.reading!.normalizedText)
    const desk = await readTtrpgOpenVoiceRequestDeskV1(s.owner)
    expect(desk.budget).toMatchObject({ requests: 1, characters: s.text.length }); expect(desk.requests[0].reading).toEqual(row.reading)
    expect(desk.requests[0].generationAllowed).toBe(false); expect(await db.productMediaAssets.count()).toBe(0)
    await replay(s.owner.sessionId)
  })
  it('retains legacy absence and the exact original input hash without upgrading old intent to a confirmed reading', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), { readingConfirmation: _unused, ...input } = await inputFor(s); void _unused
    const requested = await reserveTtrpgOpenVoiceRequestV1(input), row = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0]
    expect(row).not.toHaveProperty('reading'); expect(ttrpgOpenVoiceRequestInputV1(row)).not.toHaveProperty('reading')
    expect(parseTtrpgOpenVoiceRequestV1(row)).toEqual(row)
    expect(await sha256Text(canonicalStringify(ttrpgOpenVoiceRequestInputV1(row)))).toBe(row.inputArtifactHash)
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0]).not.toHaveProperty('reading')
    expect((await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: requested.requestKey, decision: 'verify-original-voice-intent-only' })).generationAllowed).toBe(false)
  })
  it('rejects unresolved, cloned, mismatched and unconfirmed readings before creating a Run or consuming any quota', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), blocked = await inputFor(s, false)
    await expect(reserveTtrpgOpenVoiceRequestV1(blocked)).rejects.toThrow(/解决读法/)
    const ready = await inputFor(s)
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...ready, readingConfirmation: { review: structuredClone(ready.readingConfirmation.review), decision: confirm } })).rejects.toThrow(/重新核对/)
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...ready, part: { textOffset: 2, textLength: 3 } })).rejects.toThrow(/同一原文片段/)
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...ready, readingConfirmation: { ...ready.readingConfirmation, decision: 'generate-now' as typeof confirm } })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0); expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).budget?.requests).toBe(0)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'reading.confirm.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: 'stop' })
    await expect(reserveTtrpgOpenVoiceRequestV1(ready)).rejects.toThrow(); expect(await db.agentRuns.count()).toBe(0)
  })
  it('checks all frozen hashes but preserves an archived profile without giving it current frontend authority', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), input = await inputFor(s)
    await reserveTtrpgOpenVoiceRequestV1(input)
    const row = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0], reading = row.reading!
    for (const patch of [{ normalizedText: '改写' }, { previewHash: '0'.repeat(64) }, { sourceTextHash: '0'.repeat(64) }, { generationAllowed: true }, { decision: 'generate-now' }]) {
      await expect(verifyTtrpgOpenConfirmedVoiceReadingV1({ ...reading, ...patch }, s.text, row.part.textHash)).rejects.toThrow()
    }
    for (const patch of [{ modelInvocationAllowed: true }, { adoptionAllowed: true }, { maxReadingUtf16: 4001 }, { normalizerPath: '../../other.py' }]) {
      const changedProfile = { ...reading.profile, ...patch }, changedPreview = { ...input.readingConfirmation.review.preview, profileHash: await hashCanonicalValue(changedProfile) }
      await expect(verifyTtrpgOpenConfirmedVoiceReadingV1({ ...reading, profile: changedProfile, profileHash: changedPreview.profileHash,
        previewHash: await hashCanonicalValue(changedPreview) }, s.text, row.part.textHash)).rejects.toThrow()
    }
    const archivedProfile = { ...reading.profile, profileId: 'melo-zh-archived-v1', normalizerSha256: 'b'.repeat(64) }
    const oldPreview = { ...input.readingConfirmation.review.preview, profileHash: await hashCanonicalValue(archivedProfile), normalizerSha256: archivedProfile.normalizerSha256 }
    const oldReading = { ...reading, profile: archivedProfile, profileHash: oldPreview.profileHash, normalizerSha256: oldPreview.normalizerSha256, previewHash: await hashCanonicalValue(oldPreview) }
    expect((await verifyTtrpgOpenConfirmedVoiceReadingV1(oldReading, s.text, row.part.textHash)).reading).toEqual(oldReading)
    await expect(verifyTtrpgOpenVoiceReadingPreviewV1(oldPreview, s.text, oldPreview.overrides)).rejects.toThrow()
  })
  it('snapshots the clicked confirmation and range before asynchronous reads instead of adopting later caller edits', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), input = await inputFor(s), originalHash = input.readingConfirmation.review.previewHash
    const pending = reserveTtrpgOpenVoiceRequestV1(input)
    input.readingConfirmation = { review: structuredClone(input.readingConfirmation.review), decision: 'generate-now' as typeof confirm }
    input.part = { textOffset: 2, textLength: 3 }; input.submissionKey = 'late.changed'
    await pending
    const row = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0]
    expect(row.reading!.previewHash).toBe(originalHash); expect(row.part).toMatchObject({ textOffset: 0, textLength: s.text.length })
    expect(row.submissionKey).toBe('reading.confirm.original'); expect(await db.agentRuns.count()).toBe(1)
  })
  it('keeps the exact reading and input artifact through branching, parent deletion and backup without restoring a live confirmation or dispatch right', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), input = await inputFor(s), requested = await reserveTtrpgOpenVoiceRequestV1(input)
    const state = await readProductRuntimeState(s.owner.sessionId), row = rt(state).openRun!.voiceRequests![0], child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'confirmed reading child' })
    const childOwner = { ...s.owner, sessionId: child.id! }, childRt = rt(await readProductRuntimeState(child.id!))
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'reading.confirm.child.zero'), viewerKey: s.owner.viewerKey,
      acceptedItemKeys: childRt.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    expect(childRt.openRun!.voiceRequests![0].reading).toEqual(row.reading)
    await deleteProductRuntimeSession(s.owner.sessionId)
    await markAndSweepAgentRunArtifactsV1(s.owner.scope.projectId)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: s.owner.scope.projectId, targets: row.artifactRefs })).rejects.toThrow(/confirmed-owner/)
    expect(JSON.parse(await readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: row.inputArtifactHash })).reading).toEqual(row.reading)
    expect((await readTtrpgOpenVoiceRequestDeskV1(childOwner)).requests[0].reading).toEqual(row.reading)
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const importedOwner = { scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id!, viewerKey: s.owner.viewerKey }
    expect(rt(await readProductRuntimeState(imported.id!)).openRun!.voiceRequests![0].reading).toEqual(row.reading)
    const desk = await readTtrpgOpenVoiceRequestDeskV1(importedOwner)
    expect(desk.budget?.requests).toBe(1); expect(desk.requests[0].generationAllowed).toBe(false)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...importedOwner, requestKey: requested.requestKey, decision: 'cancel-this-unsent-voice-request' })).rejects.toThrow()
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...input, ...importedOwner })).rejects.toThrow(/重新核对/)
    await replay(imported.id!)
  })
  it('recovers the original accepted receipt and frozen reading after a lost return without creating another request or changing the quota', async () => {
    const s = await setupAudioRuntimeV1(true, '编号001。'), input = await inputFor(s)
    const original = ledger.appendAgentRunEventV1; let cut = false
    const spy = vi.spyOn(ledger, 'appendAgentRunEventV1').mockImplementation(async request => {
      if (!cut && request.type === 'verification.accepted') { cut = true; await original(request); throw new Error('READING-CONFIRMED-LOST-RETURN') }
      return original(request)
    })
    await expect(reserveTtrpgOpenVoiceRequestV1(input)).rejects.toThrow('READING-CONFIRMED-LOST-RETURN'); spy.mockRestore()
    const row = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0]
    const recovered = await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: row.requestKey, decision: 'verify-original-voice-intent-only' })
    expect(await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: row.requestKey, decision: 'verify-original-voice-intent-only' })).toEqual(recovered)
    const run = await ledger.readInstanceAgentRunV1(s.owner.scope, (await db.agentRuns.toArray())[0].id!)
    expect(run.events.filter(e => e.type === 'verification.accepted')).toHaveLength(1)
    expect(run.events.some(e => e.type === 'model.requested' || e.type === 'tool.called')).toBe(false)
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).budget?.requests).toBe(1)
    expect(row.reading!.previewHash).toBe(input.readingConfirmation.review.previewHash); await replay(s.owner.sessionId)
  })
})
