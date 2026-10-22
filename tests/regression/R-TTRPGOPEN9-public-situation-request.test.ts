import { describe, expect, it } from 'vitest'
import { hashTtrpgOpenPublicSituationRequestBasisV1, parseTtrpgOpenPublicSituationRequestBasisV1 } from '../../src/lib/ttrpg/open-public-situation-request'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
const hash = 'a'.repeat(64)
async function request() {
  const text = '  请根据共同资料准备一个新局势。\n'
  return { schema: 'storyforge.ttrpg-open-public-situation-request-basis', version: 1, purpose: 'public-situation-generation',
    scope: { projectId: 1, worldId: 2, workId: 3, sessionId: 4 }, sessionKey: 'session.actual', runtimeSourceHash: hash,
    authorizationRevision: 2, requester: { viewerKey: 'viewer.human', seatKey: 'seat.human', seatRevision: 2 },
    authorizationEpochKey: 'epoch.once', requestKey: 'request.once', readEvidence: { sequence: 7, stateHash: hash },
    recipientActorKeys: ['companion.1', 'hero'], sourceVisibilityHash: hash,
    sharedRequest: { text, inputHash: await sha256Text(text), decision: 'share-this-request-with-current-party' },
    delegation: { decision: 'adopt-this-one-candidate', maximumCandidates: 1, maximumCalls: 1, maximumAiActions: 0 } }
}
describe('R-TTRPGOPEN9 public request evidence contract (not live authorization)', () => {
  it('freezes exact shared input bytes, real scope and a one-call zero-action decision', async () => {
    const input = await request()
    expect(parseTtrpgOpenPublicSituationRequestBasisV1(input)).toEqual(input)
    expect(await hashTtrpgOpenPublicSituationRequestBasisV1(input)).toMatch(/^[a-f0-9]{64}$/)
    const original = await hashTtrpgOpenPublicSituationRequestBasisV1(input)
    for (const change of [{ scope: { ...input.scope, sessionId: 5 } }, { authorizationEpochKey: 'epoch.other' },
      { delegation: { ...input.delegation, decision: 'draft-only' } }, { recipientActorKeys: ['hero'] }]) {
      expect(await hashTtrpgOpenPublicSituationRequestBasisV1({ ...input, ...change })).not.toBe(original)
    }
  })
  it('rejects private-purpose relabeling, missing explicit sharing, widened limits and incomplete or extra fields', async () => {
    const input = await request()
    for (const patch of [{ purpose: 'situation-generation' }, { version: 2 }, { authorizationRevision: 0 },
      { privateCandidateHash: hash }, { recipientActorKeys: ['hero', 'companion.1'] }, { recipientActorKeys: ['hero', 'hero'] },
      { sharedRequest: { ...input.sharedRequest, decision: true } }, { sharedRequest: { text: input.sharedRequest.text, inputHash: input.sharedRequest.inputHash } },
      { delegation: { ...input.delegation, maximumCalls: 2 } }, { delegation: { ...input.delegation, maximumAiActions: 1 } },
      { delegation: { ...input.delegation, maximumCandidates: 2 } }]) expect(() => parseTtrpgOpenPublicSituationRequestBasisV1({ ...input, ...patch })).toThrow()
  })
  it('refuses text changes against the original input hash, including normalization and whitespace changes', async () => {
    const input = await request()
    await expect(hashTtrpgOpenPublicSituationRequestBasisV1({ ...input, sharedRequest: { ...input.sharedRequest, text: input.sharedRequest.text.trim() } })).rejects.toThrow(/哈希/)
  })
  it('refuses executable objects and accessors without executing them', async () => {
    const input = await request(); let executed = false
    const getter = Object.defineProperty({ ...input }, 'scope', { enumerable: true, get: () => { executed = true; return input.scope } })
    expect(() => parseTtrpgOpenPublicSituationRequestBasisV1(getter)).toThrow(); expect(executed).toBe(false)
    expect(() => parseTtrpgOpenPublicSituationRequestBasisV1(Object.assign(Object.create({ inherited: true }), input))).toThrow()
  })
})
