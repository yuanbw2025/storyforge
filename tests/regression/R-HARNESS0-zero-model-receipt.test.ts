import { describe, it, expect } from 'vitest'
import { acceptAgentRunContract } from '../../src/lib/agent/run/contract'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createVerificationReceiptV1, parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1, isVerificationReceiptFreshV1 } from '../../src/lib/agent/run/verification-receipt'

async function body() {
  const accepted = await acceptAgentRunContract({ version: 1, objective: 'record an explicit human intent', workflowKind: 'direct-generation',
    scope: { projectId: 7, worldGroupId: null }, permissions: { contextSourceKeys: [], writeTargets: [] }, runtimeBindingHash: 'a'.repeat(64),
    budget: { maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'intent.commit', kind: 'post-state-matches', required: true }],
    verificationPlan: [{ id: 'intent.terminal', kind: 'terminal', verifier: 'intent-v1', criterionIds: ['intent.commit'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } })
  return { version: 1 as const, runId: 11, generation: 1, contractHash: accepted.contractHash, contextManifestHashes: [], candidateHashes: [], adoptionEventIds: [],
    postStateHash: 'b'.repeat(64), verifierSetVersion: 'intent-v1', criteria: [{ id: 'intent.commit', status: 'passed' as const, evidenceRefs: ['input:' + 'c'.repeat(64)] }],
    acceptedAt: 10, zeroModelCommit: { contractJson: canonicalStringify(accepted.contract), inputArtifactHashes: ['c'.repeat(64)] } }
}
describe('R-HARNESS0 deterministic zero-model terminal receipts', () => {
  it('binds the exact zero-call contract and real input roots without fabricating a Context Manifest', async () => {
    const value = await createVerificationReceiptV1(await body())
    expect(value.contextManifestHashes).toEqual([]); expect(value.zeroModelCommit?.inputArtifactHashes).toHaveLength(1)
    expect(await verifyVerificationReceiptIntegrityV1(value)).toBe(true)
    expect(parseVerificationReceiptV1(JSON.parse(JSON.stringify(value)))).toEqual(value)
    expect(isVerificationReceiptFreshV1(value, value)).toBe(true)
    expect(isVerificationReceiptFreshV1(value, { ...value, zeroModelCommit: undefined })).toBe(false)
    expect(isVerificationReceiptFreshV1(value, { ...value, zeroModelCommit: { ...value.zeroModelCommit!, inputArtifactHashes: ['f'.repeat(64)] } })).toBe(false)
  })
  it('keeps the original nonempty context rule for every ordinary receipt', async () => {
    const { zeroModelCommit: _proof, ...ordinary } = await body(); void _proof
    await expect(createVerificationReceiptV1(ordinary)).rejects.toThrow(/不得为空/)
    const value = await createVerificationReceiptV1({ ...ordinary, contextManifestHashes: ['d'.repeat(64)] })
    expect(value).not.toHaveProperty('zeroModelCommit')
    const { receiptHash, ...originalBody } = value
    expect(receiptHash).toBe(await hashCanonicalValue(originalBody))
  })
  it('refuses model permissions, tokens, source/Skill bindings or formal writes even with recomputed contract and receipt hashes', async () => {
    const initial = await body(), original = JSON.parse(initial.zeroModelCommit.contractJson)
    // First prove this is a valid model contract, so the negative exercises the
    // receipt boundary rather than merely failing the general contract parser.
    const model = await acceptAgentRunContract({ ...original, permissions: { contextSourceKeys: ['manualText'], writeTargets: [] },
      budget: { ...original.budget, maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 1000 } })
    await expect(createVerificationReceiptV1({ ...initial, zeroModelCommit: undefined, contractHash: model.contractHash,
      contextManifestHashes: ['d'.repeat(64)] })).resolves.toMatchObject({ contractHash: model.contractHash })
    await expect(createVerificationReceiptV1({ ...initial, contractHash: model.contractHash,
      zeroModelCommit: { ...initial.zeroModelCommit, contractJson: canonicalStringify(model.contract) } })).rejects.toMatchObject({ code: 'invalid_zero_model_receipt', path: 'receipt.zeroModelCommit' })
    for (const change of [
      { ...original, budget: { ...original.budget, maxModelCalls: 1 } },
      { ...original, budget: { ...original.budget, maxInputTokens: 1 } },
      { ...original, permissions: { ...original.permissions, contextSourceKeys: ['manualText'] } },
      { ...original, permissions: { ...original.permissions, writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }] } },
    ]) {
      await expect(createVerificationReceiptV1({ ...initial, contractHash: await hashCanonicalValue(change), zeroModelCommit: { ...initial.zeroModelCommit, contractJson: canonicalStringify(change) } })).rejects.toThrow()
    }
  })
  it('does not allow zero-model evidence to masquerade as model context, candidates, adoption or semantic review', async () => {
    const initial = await body()
    for (const change of [{ contextManifestHashes: ['d'.repeat(64)] }, { candidateHashes: ['d'.repeat(64)] }, { adoptionEventIds: [1] },
      { semanticVerifier: { provider: 'fabricated', model: 'fabricated', promptVersion: 'fake-v1' } },
      { zeroModelCommit: { ...initial.zeroModelCommit, inputArtifactHashes: [] } }]) {
      await expect(createVerificationReceiptV1({ ...initial, ...change })).rejects.toThrow()
    }
  })
  it('rejects a mismatched original contract identity even after the outer receipt is rehashed', async () => {
    const initial = await body()
    await expect(createVerificationReceiptV1({ ...initial, contractHash: 'f'.repeat(64) })).rejects.toThrow(/hash/)
    const { receiptHash: _hash, ...forged } = await createVerificationReceiptV1(initial); void _hash
    forged.contractHash = 'f'.repeat(64)
    expect(await verifyVerificationReceiptIntegrityV1({ ...forged, receiptHash: await hashCanonicalValue(forged) })).toBe(false)
  })
})
