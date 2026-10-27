import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1, audioWavFixtureV1 } from '../helpers/open-audio-runtime'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { parseTtrpgOpenVoiceScriptV1 } from '../../src/lib/ttrpg/open-voice-script-contract'
import { createTtrpgOpenVoiceScriptV1 } from '../../src/lib/ttrpg/open-audio-contract'
import { prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenVoiceScriptV1, readTtrpgOpenReviewedVoiceScriptV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readProductRuntimeState, hashProductRuntimeStateV1, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { TtrpgAudioAudienceV1 } from '../../src/lib/ttrpg/open-audio-runtime'

type Setup = Awaited<ReturnType<typeof setupAudioRuntimeV1>>
const selection = (s: Setup, audience: TtrpgAudioAudienceV1 = 'party') => ({ ...s.owner, narrationSourceRef: s.narrationSourceRef,
  audience, privateActorKey: audience === 'private' ? 'hero' : null, decision: 'review-original-narration-for-voice' as const })
async function zero(owner: Setup['owner'], command: string) {
  const state = rt(await readProductRuntimeState(owner.sessionId))
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(owner.sessionId, command), viewerKey: owner.viewerKey,
    acceptedItemKeys: state.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
}
describe('R-TTRPGOPEN10 exact original voice script without model or adoption authority', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('parses exact bytes including combining marks and LF/CRLF, rejecting additional instructions and permission fields', () => {
    const ref = { sessionKey: 'session.voice-source', sequence: 1 }, text = ' e\u0301\r\n甲\n\n乙 '
    const value = { schema: 'storyforge.ttrpg-open-voice-script', version: 1, sessionKey: ref.sessionKey, runtimeSourceHash: 'a'.repeat(64),
      narrationSourceRef: { ...ref, sequence: 2 }, narrationBinding: { operationKey: 'op.1', frozenPlanHash: 'b'.repeat(64), ruleSourceRef: ref, audience: 'party', viewerKey: 'viewer.gm' }, text,
      scope: { schema: 'storyforge.ttrpg-open-audio-scope', version: 1, authorizationRef: ref, issuerSeatKey: 'seat.gm', issuerViewerKey: 'viewer.gm', audience: 'gm-only', privateActorKey: null,
        recipients: [{ seatKey: 'seat.gm', viewerKey: 'viewer.gm', actorKey: null, role: 'gm', controller: 'human' }] } }
    expect(parseTtrpgOpenVoiceScriptV1(value).text).toBe(text)
    for (const patch of [{ instructions: 'rewrite prose' }, { generationAllowed: true }, { text: '' }, { text: '甲'.repeat(16015) },
      { scope: { ...value.scope, authorizationRef: { ...ref, sessionKey: 'other.session' } } }]) {
      expect(() => parseTtrpgOpenVoiceScriptV1({ ...value, ...patch })).toThrow()
    }
  })
  it('freezes the actual completed narration and listeners, keeping all domain, run and media rows unchanged', async () => {
    const s = await setupAudioRuntimeV1(true, '你确认了门口。\n\n路边写着8点。'), before = await readProductRuntimeState(s.owner.sessionId)
    const count = await db.productRuntimeEvents.count(), runs = await db.agentRuns.count(), media = await db.productMediaAssets.count()
    const accepted = rt(before).openRun!.narrations![0], review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    expect(review.script.text).toBe(accepted.narration.paragraphs.map(row => row.text).join('\n\n'))
    expect(review.script.text).toContain('。\n\n路'); expect(review.script.narrationSourceRef).toEqual(accepted.sourceRef)
    expect(review.script.narrationBinding).toEqual(accepted.binding); expect(review.textHash).toBe(await sha256Text(review.script.text))
    expect(review.scriptHash).toBe(await hashCanonicalValue(review.script)); expect(review).toMatchObject({ generationAllowed: false, adoptionAllowed: false })
    const read = await readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review }); expect(read.script).toEqual(review.script)
    read.script.text = 'caller mutated a returned copy'
    expect((await readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).script.text).toBe(review.script.text)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count)
    expect(await db.agentRuns.count()).toBe(runs); expect(await db.productMediaAssets.count()).toBe(media)
  })
  it('preserves a source beyond one generation request rather than truncating it, and shares the existing voice-file policy', async () => {
    const s = await setupAudioRuntimeV1(true, '长'.repeat(2001)), review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    expect(review.script.text).toHaveLength(2001); expect(review.generationAllowed).toBe(false)
    const fileReview = await prepareTtrpgOpenAudioUploadV1({ ...s.owner, request: s.request('same.original.voice', 'voice'), file: audioWavFixtureV1(), name: 'engineering voice', source: 'synthetic PCM fixture',
      license: 'engineering only, no listening acceptance', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })
    expect(fileReview.fallbackText).toBe(review.script.text)
    const same = await prepareTtrpgOpenVoiceScriptV1(selection(s, 'gm-only'))
    expect(same.textHash).toBe(review.textHash); expect(same.scriptHash).not.toBe(review.scriptHash)
  })
  it('keeps public voice closed and requires current host authority for exact private and GM-only listeners', async () => {
    const s = await setupAudioRuntimeV1(), privateReview = await prepareTtrpgOpenVoiceScriptV1(selection(s, 'private'))
    expect(privateReview.script.scope.recipients.filter(row => row.role === 'player').map(row => row.actorKey)).toEqual(['hero'])
    expect((await prepareTtrpgOpenVoiceScriptV1(selection(s, 'gm-only'))).script.scope.recipients.every(row => row.role === 'gm')).toBe(true)
    await expect(prepareTtrpgOpenVoiceScriptV1(selection(s, 'public'))).rejects.toThrow(/扩大原全队/)
    await expect(prepareTtrpgOpenVoiceScriptV1({ ...selection(s), viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow()
    await expect(prepareTtrpgOpenVoiceScriptV1({ ...selection(s), scope: { ...s.owner.scope, projectId: s.owner.scope.projectId + 999 } })).rejects.toThrow()
    await expect(prepareTtrpgOpenVoiceScriptV1({ ...selection(s), narrationSourceRef: { ...s.narrationSourceRef, sequence: s.narrationSourceRef.sequence + 1 } })).rejects.toThrow(/原已确认叙述/)
    const runtime = rt(await readProductRuntimeState(s.owner.sessionId)), source = (await db.productRuntimeSessions.get(s.owner.sessionId))!
    runtime.openRun!.narrations![0].binding.frozenPlanHash = 'f'.repeat(64)
    expect(() => createTtrpgOpenVoiceScriptV1({ ...selection(s), runtime, runtimeSourceHash: source.runtimeSourceHash })).toThrow(/原已确认叙述/)
  })
  it('permits only the common source for the AI-host human fallback, without granting model advice or private control', async () => {
    const s = await setupAudioRuntimeV1(false), review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    expect(review.script.scope.audience).toBe('party'); expect(review.generationAllowed).toBe(false)
    for (const audience of ['private', 'gm-only'] as const) await expect(prepareTtrpgOpenVoiceScriptV1(selection(s, audience))).rejects.toThrow(/实际真人 GM/)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('rejects copied, edited and cross-viewer reviews even if their text and hash are recomputed', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review: structuredClone(review) })).rejects.toThrow(/重新核对/)
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, review })).rejects.toThrow(/重新核对/)
    review.script.text = '伪造的原叙述'; review.textHash = await sha256Text(review.script.text); review.scriptHash = await hashCanonicalValue(review.script)
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).rejects.toThrow(/重新核对/)
  })
  it('captures the original selection before awaiting and refuses an in-flight review mutation', async () => {
    const s = await setupAudioRuntimeV1(), request = { ...selection(s), scope: { ...s.owner.scope }, narrationSourceRef: { ...s.narrationSourceRef } }
    const pending = prepareTtrpgOpenVoiceScriptV1(request)
    request.viewerKey = OPEN_HUMAN_VIEWER; request.scope.projectId += 999; request.narrationSourceRef.sequence += 1
    const review = await pending
    expect(review.viewerKey).toBe(s.owner.viewerKey); expect(review.script.narrationSourceRef).toEqual(s.narrationSourceRef)
    const reading = readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })
    Reflect.set(review, 'generationAllowed', true)
    await expect(reading).rejects.toThrow(/重新核对/)
  })
  it('rechecks the actual current source after harmless discussion, and refuses safety pause instead of turning the review into a grant', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.discussion'), viewerKey: OPEN_HUMAN_VIEWER,
      submissionKey: 'voice.discussion', request: { kind: 'out-of-character', text: '稍等再继续。', audience: 'party' } })
    const current = await readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })
    expect(current.readEvidence.sequence).toBeGreaterThan(review.sequence); expect(current.scriptHash).toBe(review.scriptHash)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: '暂停本次配音准备' })
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).rejects.toThrow(/暂停/)
  })
  it('rejects unsupported live consent edits and participant-row drift behind an original issued review', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(selection(s))
    const hero = (await readTtrpgSessionParticipantsV2(s.owner.sessionId)).find(row => row.actorKey === 'hero')!
    await expect(configureTtrpgSessionParticipantV2({ sessionId: s.owner.sessionId, seatKey: hero.seatKey, expectedRevision: hero.revision,
      commandId: 'voice.consent', requestedByViewerKey: hero.viewerKey, consent: { aiAdviceAllowed: false } })).rejects.toThrow(/Session Zero/)
    expect((await readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).textHash).toBe(review.textHash)
    const row = (await db.ttrpgSessionParticipants.where('sessionId').equals(s.owner.sessionId).toArray()).find(row => row.actorKey === 'hero')!
    await db.ttrpgSessionParticipants.update(row.id!, { consent: { ...row.consent, aiAdviceAllowed: false } })
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).rejects.toThrow()
  })
  it('does not trust a self-hashed mutated cached head in place of actual accepted events', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(selection(s)), state = await readProductRuntimeState(s.owner.sessionId)
    const altered = rt(state); altered.openRun!.narrations![0].narration.paragraphs[0].text = 'UNCONFIRMED-VOICE-HEAD-CANARY'; state.ttrpg = altered
    await db.productRuntimeSessions.update(s.owner.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    expect((await db.productRuntimeSessions.get(s.owner.sessionId))!.runtimeHeadStateJson).toContain('UNCONFIRMED-VOICE-HEAD-CANARY')
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...s.owner, review })).rejects.toThrow()
  })
  it('keeps original ancestor prose after parent deletion and backup, while local review identity never transfers', async () => {
    const s = await setupAudioRuntimeV1(), parentReview = await prepareTtrpgOpenVoiceScriptV1(selection(s)), state = await readProductRuntimeState(s.owner.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'voice source child' })
    const childOwner = { ...s.owner, sessionId: child.id! }, childSelection = { ...selection(s), ...childOwner }
    await expect(prepareTtrpgOpenVoiceScriptV1(childSelection)).rejects.toThrow(/授权/)
    const hero = (await readTtrpgSessionParticipantsV2(child.id!)).find(row => row.actorKey === 'hero')!
    await configureTtrpgSessionParticipantV2({ sessionId: child.id!, seatKey: hero.seatKey, expectedRevision: hero.revision,
      commandId: 'voice.child.consent', requestedByViewerKey: hero.viewerKey, consent: { aiAdviceAllowed: false } })
    await zero(childOwner, 'voice.child.zero')
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...childOwner, review: parentReview })).rejects.toThrow(/重新核对/)
    const childReview = await prepareTtrpgOpenVoiceScriptV1(childSelection)
    expect(childReview.script.narrationSourceRef).toEqual(parentReview.script.narrationSourceRef)
    expect(childReview.script.sessionKey).not.toBe(parentReview.script.sessionKey)
    await deleteProductRuntimeSession(s.owner.sessionId)
    expect((await readTtrpgOpenReviewedVoiceScriptV1({ ...childOwner, review: childReview })).textHash).toBe(parentReview.textHash)
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId)), copied = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const copiedOwner = { scope: { projectId, worldId: copied.worldId, workId: copied.workId }, sessionId: copied.id!, viewerKey: s.owner.viewerKey }
    await expect(readTtrpgOpenReviewedVoiceScriptV1({ ...copiedOwner, review: childReview })).rejects.toThrow(/重新核对/)
    const copiedReview = await prepareTtrpgOpenVoiceScriptV1({ ...childSelection, ...copiedOwner })
    expect(copiedReview.textHash).toBe(parentReview.textHash); expect(copiedReview.script.narrationSourceRef).toEqual(parentReview.script.narrationSourceRef)
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productMediaAssets.count()).toBe(0)
  })
})
