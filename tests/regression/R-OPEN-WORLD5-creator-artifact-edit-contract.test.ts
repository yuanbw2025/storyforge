import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldCreatorEditPatchV1,
  createTextOpenWorldCreatorEditTerminalReceiptV1,
  hashTextOpenWorldCreatorEditCandidateV1,
  hashTextOpenWorldCreatorEditCarriedLineageV1,
  hashTextOpenWorldCreatorEditIdentityDeltaV1,
  hashTextOpenWorldCreatorEditIntentV1,
  hashTextOpenWorldCreatorEditOwnerSiblingGroupV1,
  hashTextOpenWorldCreatorEditPatchV1,
  hashTextOpenWorldCreatorEditReferenceDeltaV1,
  hashTextOpenWorldCreatorEditTerminalReceiptV1,
  hashTextOpenWorldCreatorEditValidationV1,
  hashTextOpenWorldCreatorEditWarningAcknowledgementV1,
  parseTextOpenWorldCreatorEditCandidateV1,
  parseTextOpenWorldCreatorEditFieldV1,
  parseTextOpenWorldCreatorEditIntentV1,
  parseTextOpenWorldCreatorEditPatchV1,
  parseTextOpenWorldCreatorEditTargetV1,
  parseTextOpenWorldCreatorEditTerminalReceiptV1,
  type TextOpenWorldCreatorEditCandidateV1,
  type TextOpenWorldCreatorEditIdentityDeltaV1,
  type TextOpenWorldCreatorEditIntentV1,
  type TextOpenWorldCreatorEditOwnerSiblingGroupV1,
  type TextOpenWorldCreatorEditPatchV1,
  type TextOpenWorldCreatorEditReferenceDeltaV1,
  type TextOpenWorldCreatorEditValidationStatusV1,
  type TextOpenWorldCreatorEditValidationV1,
} from '../../src/lib/open-world/creator-artifact-edit-contract'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
} from '../../src/lib/product-production/task-evidence'

const HASH = (char: string) => char.repeat(64)

async function createPatch(baseDraftHash: string, value = '新的故事摘要'): Promise<TextOpenWorldCreatorEditPatchV1> {
  return createTextOpenWorldCreatorEditPatchV1({
    baseDraftHash,
    operations: [{
      op: 'replace',
      fieldId: 'story.summary',
      baseValueHash: await hashProductProductionValueV2('旧的故事摘要'),
      value,
    }],
  })
}

async function createIdentityDelta(): Promise<TextOpenWorldCreatorEditIdentityDeltaV1> {
  const identitySequenceHash = await hashProductProductionValueV2(['story:story.main'])
  const body: Omit<TextOpenWorldCreatorEditIdentityDeltaV1, 'deltaHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-identity-delta',
    version: 1,
    beforeCount: 1,
    afterCount: 1,
    beforeSequenceHash: identitySequenceHash,
    afterSequenceHash: identitySequenceHash,
    addedIdentities: [],
    removedIdentities: [],
    renamedIdentities: [],
    reordered: false,
  }
  return { ...body, deltaHash: await hashTextOpenWorldCreatorEditIdentityDeltaV1(body) }
}

async function createReferenceDelta(): Promise<TextOpenWorldCreatorEditReferenceDeltaV1> {
  const beforeReferenceHash = await hashProductProductionValueV2([])
  const afterReferenceHash = await hashProductProductionValueV2([
    { sourceIdentity: 'story:story.main', fieldId: 'story.summary', targetIdentity: 'region:region.salt' },
  ])
  const body: Omit<TextOpenWorldCreatorEditReferenceDeltaV1, 'deltaHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-reference-delta',
    version: 1,
    beforeReferenceHash,
    afterReferenceHash,
    added: [{
      sourceIdentity: 'story:story.main',
      fieldId: 'story.summary',
      targetIdentity: 'region:region.salt',
    }],
    removed: [],
    danglingTargetIdentities: [],
  }
  return { ...body, deltaHash: await hashTextOpenWorldCreatorEditReferenceDeltaV1(body) }
}

async function createCandidate(options: {
  mode?: 'direct' | 'agent'
  status?: TextOpenWorldCreatorEditValidationStatusV1
} = {}): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const mode = options.mode ?? 'direct'
  const status = options.status ?? 'ready'
  const baseStoryPayload = {
    schema: 'storyforge.text-open-world-story-arc',
    version: 1,
    stories: [{ key: 'story.main', title: '盐脊', summary: '旧的故事摘要' }],
  }
  const rebuiltStoryPayload = {
    schema: 'storyforge.text-open-world-story-arc',
    version: 1,
    stories: [{ key: 'story.main', title: '盐脊', summary: '新的故事摘要' }],
  }
  const endingPayload = {
    schema: 'storyforge.text-open-world-ending-contracts',
    version: 1,
    endings: [{ key: 'ending.safe', title: '盐脊得救' }],
  }
  const baseStoryHash = await hashProductProductionValueV2(baseStoryPayload)
  const baseEndingHash = await hashProductProductionValueV2(endingPayload)
  const rebuiltStoryHash = await hashProductProductionValueV2(rebuiltStoryPayload)
  const baseDraftHash = await hashProductProductionValueV2({
    fieldId: 'story.summary',
    value: '旧的故事摘要',
  })
  const producerReceiptHash = HASH('b')
  const producerInputHash = HASH('a')
  const groupBody: Omit<TextOpenWorldCreatorEditOwnerSiblingGroupV1, 'baseGroupHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group',
    version: 1,
    ownerTaskKey: 'p3.story-architecture',
    skillId: 'text-open-world.production.story-architecture.v1',
    dependencyTaskKeys: ['p2.experience-design'],
    outputArtifactKeys: [
      'text-open-world.story-arc',
      'text-open-world.ending-contracts',
    ],
    acceptanceGateIds: ['tow.story.promise-callback', 'tow.story.core-goal'],
    baseSiblings: [
      {
        artifactKey: 'text-open-world.story-arc',
        requirementKey: null,
        kind: 'text-open-world.story-arc',
        version: 1,
        status: 'accepted',
        inputHash: producerInputHash,
        contentHash: baseStoryHash,
        producerRunId: 23,
        producerReceiptHash,
        parentArtifactHash: null,
        carriedFrom: null,
      },
      {
        artifactKey: 'text-open-world.ending-contracts',
        requirementKey: null,
        kind: 'text-open-world.ending-contracts',
        version: 1,
        status: 'accepted',
        inputHash: producerInputHash,
        contentHash: baseEndingHash,
        producerRunId: 23,
        producerReceiptHash,
        parentArtifactHash: null,
        carriedFrom: null,
      },
    ],
  }
  const ownerSiblingGroup: TextOpenWorldCreatorEditOwnerSiblingGroupV1 = {
    ...groupBody,
    baseGroupHash: await hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(groupBody),
  }
  const rebuiltArtifacts = [
    {
      schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact' as const,
      version: 1 as const,
      artifactKey: 'text-open-world.story-arc' as const,
      requirementKey: null,
      kind: 'text-open-world.story-arc' as const,
      baseVersion: 1,
      nextVersion: 2,
      baseContentHash: baseStoryHash,
      contentHash: rebuiltStoryHash,
      payload: rebuiltStoryPayload,
      metadata: {},
      quality: {},
      rights: {},
      byteSize: new TextEncoder().encode(canonicalProductProductionJsonV2(rebuiltStoryPayload)).byteLength,
    },
    {
      schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact' as const,
      version: 1 as const,
      artifactKey: 'text-open-world.ending-contracts' as const,
      requirementKey: null,
      kind: 'text-open-world.ending-contracts' as const,
      baseVersion: 1,
      nextVersion: 2,
      baseContentHash: baseEndingHash,
      contentHash: baseEndingHash,
      payload: endingPayload,
      metadata: {},
      quality: {},
      rights: {},
      byteSize: new TextEncoder().encode(canonicalProductProductionJsonV2(endingPayload)).byteLength,
    },
  ]
  const issues = status === 'ready' ? [] : status === 'usable-with-warnings'
    ? [{
        code: 'tow.edit.tone-drift',
        severity: 'warning' as const,
        artifactKey: 'text-open-world.story-arc' as const,
        fieldId: 'story.summary',
        message: '语气有所变化，请作者确认。',
      }]
    : [{
        code: 'tow.edit.domain-invalid',
        severity: 'error' as const,
        artifactKey: 'text-open-world.story-arc' as const,
        fieldId: 'story.summary',
        message: '领域验证未通过。',
      }]
  const validationBody: Omit<TextOpenWorldCreatorEditValidationV1, 'validationHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-validation',
    version: 1,
    validatorId: 'text-open-world.creator-edit.validator',
    validatorVersion: '1.0.0',
    status,
    requiredGateIds: ['tow.story.core-goal', 'tow.story.promise-callback'],
    passedGateIds: status === 'ready' || status === 'usable-with-warnings'
      ? ['tow.story.core-goal', 'tow.story.promise-callback'] : [],
    validatedArtifacts: rebuiltArtifacts.map(artifact => ({
      artifactKey: artifact.artifactKey,
      contentHash: artifact.contentHash,
    })),
    issues,
  }
  const validation: TextOpenWorldCreatorEditValidationV1 = {
    ...validationBody,
    validationHash: await hashTextOpenWorldCreatorEditValidationV1(validationBody),
  }
  const patch = await createPatch(baseDraftHash)
  const body: Omit<TextOpenWorldCreatorEditCandidateV1, 'candidateHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-candidate',
    version: 1,
    portable: false,
    production: { productionId: 7, productionKey: 'prod.salt-ridge', stateRevision: 12 },
    baseBuild: {
      buildId: 19,
      buildNumber: 4,
      stateRevision: 9,
      controlEpoch: 3,
      planHash: HASH('1'),
      manifestHash: HASH('2'),
      rootTerminalReceiptHash: HASH('3'),
    },
    governanceSnapshotHash: HASH('4'),
    target: {
      schema: 'storyforge.text-open-world-creator-edit-target',
      version: 1,
      artifactKey: 'text-open-world.story-arc',
      artifactVersion: 1,
      artifactKind: 'text-open-world.story-arc',
      artifactContentHash: baseStoryHash,
      entityIdentity: 'story:story.main',
      ownerTaskKey: 'p3.story-architecture',
    },
    editableFields: [{
      schema: 'storyforge.text-open-world-creator-edit-field',
      version: 1,
      fieldId: 'story.summary',
      artifactKey: 'text-open-world.story-arc',
      entityIdentity: 'story:story.main',
      jsonPointer: '/stories/0/summary',
      label: '故事摘要',
      valueKind: 'string',
      baseValueHash: await hashProductProductionValueV2('旧的故事摘要'),
      maximumUtf8Bytes: 16_384,
      mutationPolicy: 'replace-only',
      stableIdPolicy: 'preserve',
      entitySetPolicy: 'preserve',
      entityOrderPolicy: 'preserve',
    }],
    ownerSiblingGroup,
    producerEvidence: {
      schema: 'storyforge.text-open-world-creator-edit-producer-evidence',
      version: 1,
      proofKind: 'accepted-checkpoint',
      taskKey: 'p3.story-architecture',
      runId: 23,
      rootRunId: 20,
      attempt: 1,
      controlEpoch: 3,
      inputHash: producerInputHash,
      candidateHash: HASH('c'),
      checkpointHash: HASH('d'),
      terminalReceiptHash: producerReceiptHash,
      rootTerminalReceiptHash: HASH('3'),
      dependencies: [],
      carriedLineageHash: null,
    },
    baseDraftHash,
    patch,
    rebuiltArtifacts,
    validation,
    identityDelta: await createIdentityDelta(),
    referenceDelta: await createReferenceDelta(),
    mode,
    modelEvidence: mode === 'agent' ? {
      schema: 'storyforge.text-open-world-creator-edit-model-evidence',
      version: 1,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      promptHash: HASH('5'),
      contextManifestHashes: [HASH('6')],
      outputHash: HASH('7'),
    } : null,
    modelUsage: mode === 'agent'
      ? { modelCalls: 1, inputTokens: 1200, outputTokens: 240, costUsd: 0.02, durationMs: 900 }
      : { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0 },
    revisionProvenance: null,
    status,
    createdAt: 1_789_056_000_000,
  }
  return { ...body, candidateHash: await hashTextOpenWorldCreatorEditCandidateV1(body) }
}

async function resealCandidate(candidate: TextOpenWorldCreatorEditCandidateV1) {
  const group = candidate.ownerSiblingGroup
  const { baseGroupHash: _baseGroupHash, ...groupBody } = group
  group.baseGroupHash = await hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(groupBody)

  const identityDelta = candidate.identityDelta
  const { deltaHash: _identityHash, ...identityBody } = identityDelta
  identityDelta.deltaHash = await hashTextOpenWorldCreatorEditIdentityDeltaV1(identityBody)

  const referenceDelta = candidate.referenceDelta
  const { deltaHash: _referenceHash, ...referenceBody } = referenceDelta
  referenceDelta.deltaHash = await hashTextOpenWorldCreatorEditReferenceDeltaV1(referenceBody)

  const validation = candidate.validation
  const { validationHash: _validationHash, ...validationBody } = validation
  validation.validationHash = await hashTextOpenWorldCreatorEditValidationV1(validationBody)

  const { candidateHash: _candidateHash, ...candidateBody } = candidate
  candidate.candidateHash = await hashTextOpenWorldCreatorEditCandidateV1(candidateBody)
  return candidate
}

async function createRevisedCandidate(
  inputOrigin?: TextOpenWorldCreatorEditCandidateV1,
): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const origin = inputOrigin ?? await createCandidate({ mode: 'agent' })
  const revised = structuredClone(origin)
  const patch = await createPatch(revised.baseDraftHash, '作者复核后的故事摘要')
  const target = revised.rebuiltArtifacts.find(artifact => (
    artifact.artifactKey === 'text-open-world.story-arc'
  ))!
  const payload = structuredClone(target.payload) as {
    stories: Array<{ summary: string }>
  }
  payload.stories[0]!.summary = '作者复核后的故事摘要'
  target.payload = payload
  target.contentHash = await hashProductProductionValueV2(payload)
  target.byteSize = new TextEncoder().encode(canonicalProductProductionJsonV2(payload)).byteLength
  revised.validation.validatedArtifacts.find(artifact => (
    artifact.artifactKey === target.artifactKey
  ))!.contentHash = target.contentHash
  revised.patch = patch
  revised.createdAt = origin.createdAt + 1_000
  revised.revisionProvenance = {
    source: 'deterministic-author-revision',
    originCandidateHash: origin.candidateHash,
    originPatchHash: origin.patch.patchHash,
    previousCandidateHash: origin.candidateHash,
    revisionPatchHash: patch.patchHash,
    revisedAt: revised.createdAt,
  }
  return resealCandidate(revised)
}

async function createCarriedCandidate(
  sourceBuildNumber: 3 | 4,
): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const candidate = await createCandidate()
  const sameBuild = sourceBuildNumber === candidate.baseBuild.buildNumber
  const currentVersion = sameBuild ? 2 : 1
  const sourceVersion = sameBuild ? 1 : 7
  const producerRunId = 31
  const producerInputHash = HASH('9')
  for (const [index, sibling] of candidate.ownerSiblingGroup.baseSiblings.entries()) {
    sibling.version = currentVersion
    sibling.status = 'carried-forward'
    sibling.inputHash = producerInputHash
    sibling.producerRunId = producerRunId
    sibling.parentArtifactHash = sibling.contentHash
    sibling.carriedFrom = {
      buildNumber: sourceBuildNumber,
      artifactKey: sibling.artifactKey,
      version: sourceVersion,
      contentHash: sibling.contentHash,
      proofHash: HASH(index === 0 ? 'e' : 'f'),
    }
  }
  candidate.target.artifactVersion = currentVersion
  for (const rebuilt of candidate.rebuiltArtifacts) {
    rebuilt.baseVersion = currentVersion
    rebuilt.nextVersion = currentVersion + 1
  }
  const evidence = candidate.producerEvidence
  evidence.proofKind = 'carried-lineage'
  evidence.runId = producerRunId
  evidence.attempt = 1
  evidence.inputHash = producerInputHash
  evidence.checkpointHash = null
  evidence.dependencies = [{ taskKey: 'p2.experience-design', receiptHash: HASH('8') }]
  evidence.carriedLineageHash = HASH('0')
  return resealCarriedEvidence(candidate)
}

async function resealCarriedEvidence(
  candidate: TextOpenWorldCreatorEditCandidateV1,
): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const evidence = candidate.producerEvidence
  evidence.candidateHash = await hashProductProductionCarriedCandidateV1(
    candidate.ownerSiblingGroup.baseSiblings,
  )
  evidence.terminalReceiptHash = await hashProductProductionCarriedReceiptV1({
    taskKey: evidence.taskKey,
    inputHash: evidence.inputHash,
    candidateHash: evidence.candidateHash,
    dependencies: evidence.dependencies,
    passedGateIds: candidate.ownerSiblingGroup.acceptanceGateIds,
    controlEpoch: evidence.controlEpoch,
  })
  for (const sibling of candidate.ownerSiblingGroup.baseSiblings) {
    sibling.producerReceiptHash = evidence.terminalReceiptHash
  }
  evidence.carriedLineageHash = await hashTextOpenWorldCreatorEditCarriedLineageV1({
    taskKey: evidence.taskKey,
    controlEpoch: evidence.controlEpoch,
    inputHash: evidence.inputHash,
    candidateHash: evidence.candidateHash,
    terminalReceiptHash: evidence.terminalReceiptHash,
    siblings: candidate.ownerSiblingGroup.baseSiblings,
  })
  return resealCandidate(candidate)
}

async function createIntent(candidate: TextOpenWorldCreatorEditCandidateV1): Promise<TextOpenWorldCreatorEditIntentV1> {
  const warningAcknowledgementCodes = candidate.validation.issues
    .filter(issue => issue.severity === 'warning').map(issue => issue.code).sort()
  const body: Omit<TextOpenWorldCreatorEditIntentV1, 'intentHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-intent',
    version: 1,
    portable: false,
    candidate,
    candidateHash: candidate.candidateHash,
    warningAcknowledgementCodes,
    warningAcknowledgementHash: await hashTextOpenWorldCreatorEditWarningAcknowledgementV1(
      warningAcknowledgementCodes,
    ),
    confirmedAt: 1_789_056_001_000,
  }
  return { ...body, intentHash: await hashTextOpenWorldCreatorEditIntentV1(body) }
}

describe('G5-06 Creator artifact edit strict contract', () => {
  it('accepts one immutable direct-edit candidate with a complete owner sibling group', async () => {
    const candidate = await createCandidate()
    const parsed = await parseTextOpenWorldCreatorEditCandidateV1(JSON.stringify(candidate))

    expect(parsed).toEqual(candidate)
    expect(parsed.portable).toBe(false)
    expect(parsed.baseDraftHash).not.toBe(parsed.target.artifactContentHash)
    expect(parsed.producerEvidence).toMatchObject({
      proofKind: 'accepted-checkpoint',
      checkpointHash: HASH('d'),
      dependencies: [],
      carriedLineageHash: null,
    })
    expect(parsed.ownerSiblingGroup.baseSiblings.every(sibling => (
      sibling.status === 'accepted'
      && sibling.parentArtifactHash === null
      && sibling.carriedFrom === null
    ))).toBe(true)
    expect(parsed.patch.operations).toEqual([expect.objectContaining({ op: 'replace', fieldId: 'story.summary' })])
    expect(parsed.rebuiltArtifacts.map(artifact => artifact.artifactKey)).toEqual(
      parsed.ownerSiblingGroup.outputArtifactKeys,
    )
    expect(parsed.rebuiltArtifacts[0].nextVersion).toBe(2)
    expect(parsed.rebuiltArtifacts[1].contentHash).toBe(parsed.rebuiltArtifacts[1].baseContentHash)
  })

  it('accepts exact same-Build and cross-Build carried model sibling proofs', async () => {
    for (const sourceBuildNumber of [4, 3] as const) {
      const parsed = await parseTextOpenWorldCreatorEditCandidateV1(
        await createCarriedCandidate(sourceBuildNumber),
      )
      expect(parsed.producerEvidence).toMatchObject({
        proofKind: 'carried-lineage',
        attempt: 1,
        checkpointHash: null,
        dependencies: [{ taskKey: 'p2.experience-design', receiptHash: HASH('8') }],
      })
      expect(parsed.producerEvidence.carriedLineageHash).toMatch(/^[a-f0-9]{64}$/)
      expect(parsed.ownerSiblingGroup.acceptanceGateIds).toEqual([
        'tow.story.promise-callback',
        'tow.story.core-goal',
      ])
      expect(parsed.ownerSiblingGroup.baseSiblings.every(sibling => (
        sibling.status === 'carried-forward'
        && sibling.parentArtifactHash === sibling.contentHash
        && sibling.carriedFrom?.buildNumber === sourceBuildNumber
        && sibling.carriedFrom.contentHash === sibling.contentHash
      ))).toBe(true)
    }
  })

  it('rejects carried checkpoint, synthetic receipt, dependency, lineage and historical-locator drift', async () => {
    const acceptedWithoutCheckpoint = await createCandidate()
    acceptedWithoutCheckpoint.producerEvidence.checkpointHash = null
    await resealCandidate(acceptedWithoutCheckpoint)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(acceptedWithoutCheckpoint))
      .rejects.toThrow(/proofKind\/checkpoint\/lineage\/dependencies 不闭合/)

    const acceptedWithDependencies = await createCandidate()
    acceptedWithDependencies.producerEvidence.dependencies = [{
      taskKey: 'p2.experience-design',
      receiptHash: HASH('8'),
    }]
    await resealCandidate(acceptedWithDependencies)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(acceptedWithDependencies))
      .rejects.toThrow(/proofKind\/checkpoint\/lineage\/dependencies 不闭合/)

    const withCheckpoint = await createCarriedCandidate(4)
    withCheckpoint.producerEvidence.checkpointHash = HASH('d')
    await resealCandidate(withCheckpoint)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(withCheckpoint))
      .rejects.toThrow(/proofKind\/checkpoint\/lineage\/dependencies 不闭合/)

    const wrongAttempt = await createCarriedCandidate(4)
    wrongAttempt.producerEvidence.attempt = 2
    await resealCandidate(wrongAttempt)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(wrongAttempt))
      .rejects.toThrow(/proofKind\/checkpoint\/lineage\/dependencies 不闭合/)

    const wrongSyntheticReceipt = await createCarriedCandidate(4)
    wrongSyntheticReceipt.producerEvidence.terminalReceiptHash = HASH('a')
    for (const sibling of wrongSyntheticReceipt.ownerSiblingGroup.baseSiblings) {
      sibling.producerReceiptHash = HASH('a')
    }
    wrongSyntheticReceipt.producerEvidence.carriedLineageHash = await hashTextOpenWorldCreatorEditCarriedLineageV1({
      taskKey: wrongSyntheticReceipt.producerEvidence.taskKey,
      controlEpoch: wrongSyntheticReceipt.producerEvidence.controlEpoch,
      inputHash: wrongSyntheticReceipt.producerEvidence.inputHash,
      candidateHash: wrongSyntheticReceipt.producerEvidence.candidateHash,
      terminalReceiptHash: wrongSyntheticReceipt.producerEvidence.terminalReceiptHash,
      siblings: wrongSyntheticReceipt.ownerSiblingGroup.baseSiblings,
    })
    await resealCandidate(wrongSyntheticReceipt)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(wrongSyntheticReceipt))
      .rejects.toThrow(/synthetic candidate\/receipt\/lineage hash 不闭合/)

    const wrongLineageHash = await createCarriedCandidate(4)
    wrongLineageHash.producerEvidence.carriedLineageHash = HASH('a')
    await resealCandidate(wrongLineageHash)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(wrongLineageHash))
      .rejects.toThrow(/synthetic candidate\/receipt\/lineage hash 不闭合/)

    const wrongDependencyOrder = await createCarriedCandidate(4)
    wrongDependencyOrder.ownerSiblingGroup.dependencyTaskKeys = [
      'p1.source-curation',
      'p2.experience-design',
    ]
    wrongDependencyOrder.producerEvidence.dependencies = [
      { taskKey: 'p2.experience-design', receiptHash: HASH('8') },
      { taskKey: 'p1.source-curation', receiptHash: HASH('7') },
    ]
    await resealCarriedEvidence(wrongDependencyOrder)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(wrongDependencyOrder))
      .rejects.toThrow(/Plan dependsOn 顺序/)

    const futureSource = await createCarriedCandidate(4)
    for (const sibling of futureSource.ownerSiblingGroup.baseSiblings) {
      sibling.carriedFrom!.buildNumber = 5
    }
    await resealCarriedEvidence(futureSource)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(futureSource))
      .rejects.toThrow(/不是严格历史版本/)

    const splitSourceBuilds = await createCarriedCandidate(4)
    splitSourceBuilds.ownerSiblingGroup.baseSiblings[1].carriedFrom!.buildNumber = 3
    await resealCarriedEvidence(splitSourceBuilds)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(splitSourceBuilds))
      .rejects.toThrow(/必须来自同一历史 Build/)

    const extraWitnessField = await createCarriedCandidate(4)
    ;(extraWitnessField.ownerSiblingGroup.baseSiblings[0].carriedFrom as unknown as {
      unexpected: boolean
    }).unexpected = true
    await resealCandidate(extraWitnessField)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(extraWitnessField))
      .rejects.toThrow(/字段不精确/)
  })

  it('keeps target/field schemas exact and excludes source, media, stable-id and collection-member edits', () => {
    const target = {
      schema: 'storyforge.text-open-world-creator-edit-target',
      version: 1,
      artifactKey: 'text-open-world.story-arc',
      artifactVersion: 1,
      artifactKind: 'text-open-world.story-arc',
      artifactContentHash: HASH('1'),
      entityIdentity: 'story:story.main',
      ownerTaskKey: 'p3.story-architecture',
    }
    expect(parseTextOpenWorldCreatorEditTargetV1(target)).toEqual(target)
    expect(() => parseTextOpenWorldCreatorEditTargetV1({ ...target, unknown: true }))
      .toThrow(/字段不精确/)
    expect(() => parseTextOpenWorldCreatorEditTargetV1({
      ...target,
      artifactKey: 'text-open-world.source-pin',
      artifactKind: 'text-open-world.source-pin',
    })).toThrow(/不是 Creator 可编辑 Artifact/)

    const field = {
      schema: 'storyforge.text-open-world-creator-edit-field',
      version: 1,
      fieldId: 'story.summary',
      artifactKey: 'text-open-world.story-arc',
      entityIdentity: 'story:story.main',
      jsonPointer: '/stories/0/summary',
      label: '故事摘要',
      valueKind: 'string',
      baseValueHash: HASH('2'),
      maximumUtf8Bytes: 4096,
      mutationPolicy: 'replace-only',
      stableIdPolicy: 'preserve',
      entitySetPolicy: 'preserve',
      entityOrderPolicy: 'preserve',
    }
    expect(parseTextOpenWorldCreatorEditFieldV1(field)).toEqual(field)
    expect(() => parseTextOpenWorldCreatorEditFieldV1({ ...field, jsonPointer: '/stories/0/key' }))
      .toThrow(/稳定身份、集合成员或治理字段/)
    expect(() => parseTextOpenWorldCreatorEditFieldV1({ ...field, jsonPointer: '/stories/0/entityIdentity' }))
      .toThrow(/稳定身份、集合成员或治理字段/)
    expect(() => parseTextOpenWorldCreatorEditFieldV1({ ...field, jsonPointer: '/stories/0' }))
      .toThrow(/稳定身份、集合成员或治理字段/)
    expect(() => parseTextOpenWorldCreatorEditFieldV1({ ...field, mutationPolicy: 'merge' }))
      .toThrow(/policy 无效/)
  })

  it('normalizes operation order but only accepts unique allowlisted replace operations', async () => {
    const baseDraftHash = HASH('1')
    const first = {
      op: 'replace' as const, fieldId: 'z.field', baseValueHash: HASH('2'), value: 'z',
    }
    const second = {
      op: 'replace' as const, fieldId: 'a.field', baseValueHash: HASH('3'), value: 'a',
    }
    const body: Omit<TextOpenWorldCreatorEditPatchV1, 'patchHash'> = {
      schema: 'storyforge.text-open-world-creator-edit-patch', version: 1,
      baseDraftHash, operations: [first, second],
    }
    const patch = { ...body, patchHash: await hashTextOpenWorldCreatorEditPatchV1(body) }
    expect((await parseTextOpenWorldCreatorEditPatchV1(patch)).operations.map(item => item.fieldId))
      .toEqual(['a.field', 'z.field'])
    expect((await createTextOpenWorldCreatorEditPatchV1({
      baseDraftHash,
      operations: [first, second],
    })).operations.map(item => item.fieldId)).toEqual(['a.field', 'z.field'])

    await expect(parseTextOpenWorldCreatorEditPatchV1({
      ...patch,
      operations: [{ ...first, op: 'add' }],
    })).rejects.toThrow(/只允许 replace/)
    await expect(parseTextOpenWorldCreatorEditPatchV1({
      ...patch,
      operations: [first, first],
    })).rejects.toThrow(/fieldId 不允许重复/)

    const tooManyOperations = Array.from({ length: 65 }, (_, index) => ({
      op: 'replace' as const,
      fieldId: `field.${index}`,
      baseValueHash: HASH('4'),
      value: `${index}`,
    }))
    await expect(parseTextOpenWorldCreatorEditPatchV1({
      ...patch,
      operations: tooManyOperations,
    })).rejects.toThrow(/非空有界数组/)
  })

  it('closes every candidate object shape and enforces each field byte budget', async () => {
    const unexpectedRoot = { ...await createCandidate(), unexpected: true }
    await expect(parseTextOpenWorldCreatorEditCandidateV1(unexpectedRoot))
      .rejects.toThrow(/字段不精确/)

    const unexpectedUsage = await createCandidate() as TextOpenWorldCreatorEditCandidateV1 & {
      modelUsage: TextOpenWorldCreatorEditCandidateV1['modelUsage'] & { unexpected?: boolean }
    }
    unexpectedUsage.modelUsage.unexpected = true
    await resealCandidate(unexpectedUsage)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(unexpectedUsage))
      .rejects.toThrow(/字段不精确/)

    const oversizedValue = await createCandidate()
    oversizedValue.editableFields[0].maximumUtf8Bytes = 4
    oversizedValue.patch.operations[0].value = '超过四字节'
    const { patchHash: _patchHash, ...patchBody } = oversizedValue.patch
    oversizedValue.patch.patchHash = await hashTextOpenWorldCreatorEditPatchV1(patchBody)
    await resealCandidate(oversizedValue)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(oversizedValue))
      .rejects.toThrow(/超过字节上限/)
  })

  it('rejects partial/reordered sibling adoption and producer or target drift even after resealing', async () => {
    const partial = await createCandidate()
    partial.ownerSiblingGroup.outputArtifactKeys.pop()
    await resealCandidate(partial)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(partial)).rejects.toThrow(/完整覆盖全部输出/)

    const reordered = await createCandidate()
    reordered.rebuiltArtifacts.reverse()
    await resealCandidate(reordered)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(reordered)).rejects.toThrow(/Plan 顺序完整覆盖/)

    const producerDrift = await createCandidate()
    producerDrift.ownerSiblingGroup.baseSiblings[1].producerRunId += 1
    await resealCandidate(producerDrift)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(producerDrift)).rejects.toThrow(/producer 证据不一致/)

    const baseDrift = await createCandidate()
    baseDrift.patch.baseDraftHash = HASH('f')
    const { patchHash: _patchHash, ...patchBody } = baseDrift.patch
    baseDrift.patch.patchHash = await hashTextOpenWorldCreatorEditPatchV1(patchBody)
    await resealCandidate(baseDrift)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(baseDrift)).rejects.toThrow(/身份不闭合/)
  })

  it('rejects changes to stable IDs, entity membership, entity order and unverified references', async () => {
    const added = await createCandidate()
    added.identityDelta.afterCount = 2
    added.identityDelta.addedIdentities = ['story:story.extra']
    await resealCandidate(added)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(added)).rejects.toThrow(/稳定 ID、实体集合或实体顺序/)

    const reordered = await createCandidate()
    ;(reordered.identityDelta as unknown as { reordered: boolean }).reordered = true
    await resealCandidate(reordered)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(reordered)).rejects.toThrow(/reordered 必须为 false/)

    const dangling = await createCandidate()
    dangling.referenceDelta.danglingTargetIdentities = ['region:region.missing']
    await resealCandidate(dangling)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(dangling)).rejects.toThrow(/dangling reference/)
  })

  it('keeps direct and Agent evidence/usage mutually exclusive and verifies candidate hashes', async () => {
    await expect(parseTextOpenWorldCreatorEditCandidateV1(await createCandidate({ mode: 'agent' })))
      .resolves.toMatchObject({ mode: 'agent', modelUsage: { modelCalls: 1 } })

    const directWithUsage = await createCandidate()
    directWithUsage.modelUsage.modelCalls = 1
    await resealCandidate(directWithUsage)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(directWithUsage))
      .rejects.toThrow(/mode 与 model evidence\/usage 不一致/)

    const agentWithoutEvidence = await createCandidate({ mode: 'agent' })
    agentWithoutEvidence.modelEvidence = null
    await resealCandidate(agentWithoutEvidence)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(agentWithoutEvidence))
      .rejects.toThrow(/mode 与 model evidence\/usage 不一致/)

    const repeatedAgentCall = await createCandidate({ mode: 'agent' })
    repeatedAgentCall.modelUsage.modelCalls = 2
    await resealCandidate(repeatedAgentCall)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(repeatedAgentCall))
      .rejects.toThrow(/mode 与 model evidence\/usage 不一致/)

    const tampered = await createCandidate()
    tampered.candidateHash = HASH('f')
    await expect(parseTextOpenWorldCreatorEditCandidateV1(tampered)).rejects.toThrow(/candidate hash 不匹配/)
  })

  it('seals deterministic author revision provenance without relabelling the original model evidence', async () => {
    const origin = await createCandidate({ mode: 'agent' })
    const revised = await createRevisedCandidate(origin)
    const parsed = await parseTextOpenWorldCreatorEditCandidateV1(revised)

    expect(parsed.revisionProvenance).toEqual({
      source: 'deterministic-author-revision',
      originCandidateHash: origin.candidateHash,
      originPatchHash: origin.patch.patchHash,
      previousCandidateHash: origin.candidateHash,
      revisionPatchHash: revised.patch.patchHash,
      revisedAt: revised.createdAt,
    })
    expect(parsed.modelEvidence).toEqual(origin.modelEvidence)
    expect(parsed.modelUsage).toEqual(origin.modelUsage)

    const patchDrift = structuredClone(revised)
    patchDrift.revisionProvenance!.revisionPatchHash = HASH('0')
    await resealCandidate(patchDrift)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(patchDrift))
      .rejects.toThrow(/revision provenance.*Patch/)

    const timeDrift = structuredClone(revised)
    timeDrift.revisionProvenance!.revisedAt += 1
    await resealCandidate(timeDrift)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(timeDrift))
      .rejects.toThrow(/revision provenance.*时间/)

    const invalidSource = structuredClone(revised)
    ;(invalidSource.revisionProvenance as unknown as { source: string }).source = 'model-revision'
    await resealCandidate(invalidSource)
    await expect(parseTextOpenWorldCreatorEditCandidateV1(invalidSource))
      .rejects.toThrow(/revisionProvenance.source/)
  })

  it('creates author intent only for ready candidates with an exact warning acknowledgement set', async () => {
    const readyIntent = await createIntent(await createCandidate())
    await expect(parseTextOpenWorldCreatorEditIntentV1(readyIntent)).resolves.toEqual(readyIntent)

    const warningIntent = await createIntent(await createCandidate({ status: 'usable-with-warnings' }))
    await expect(parseTextOpenWorldCreatorEditIntentV1(warningIntent)).resolves.toMatchObject({
      warningAcknowledgementCodes: ['tow.edit.tone-drift'],
    })

    const missingAck = structuredClone(warningIntent)
    missingAck.warningAcknowledgementCodes = []
    missingAck.warningAcknowledgementHash = await hashTextOpenWorldCreatorEditWarningAcknowledgementV1([])
    const { intentHash: _intentHash, ...missingAckBody } = missingAck
    missingAck.intentHash = await hashTextOpenWorldCreatorEditIntentV1(missingAckBody)
    await expect(parseTextOpenWorldCreatorEditIntentV1(missingAck)).rejects.toThrow(/精确确认全部 warning/)

    await expect(createIntent(await createCandidate({ status: 'blocked' })).then(parseTextOpenWorldCreatorEditIntentV1))
      .rejects.toThrow(/只能确认可用 candidate/)
  })

  it('seals the five non-adoption terminal criteria for G5-07 and detects base/handoff drift', async () => {
    const intent = await createIntent(await createCandidate({ status: 'usable-with-warnings' }))
    const baseUnchangedHash = HASH('8')
    const impactPlanHandoffHash = HASH('9')
    const receipt = await createTextOpenWorldCreatorEditTerminalReceiptV1({
      intent,
      baseUnchangedHash,
      impactPlanHandoffHash,
      completedAt: intent.confirmedAt,
    })
    const parsed = await parseTextOpenWorldCreatorEditTerminalReceiptV1(receipt, {
      intent, baseUnchangedHash, impactPlanHandoffHash,
    })
    expect(parsed.status).toBe('impact-plan-required')
    expect(parsed.criteria.map(criterion => criterion.id)).toEqual([
      'candidate-integrity',
      'domain-validation',
      'author-confirmation',
      'base-unchanged',
      'impact-plan-handoff',
    ])

    await expect(parseTextOpenWorldCreatorEditTerminalReceiptV1(receipt, {
      intent,
      baseUnchangedHash: HASH('0'),
      impactPlanHandoffHash,
    })).rejects.toThrow(/intent\/base\/handoff 不闭合/)

    const tampered = structuredClone(receipt)
    tampered.criteria[4].evidenceHash = HASH('f')
    await expect(parseTextOpenWorldCreatorEditTerminalReceiptV1(tampered))
      .rejects.toThrow(/receipt hash 不匹配/)

    const intrinsicallyInconsistent = structuredClone(receipt)
    intrinsicallyInconsistent.criteria[1].evidenceHash = HASH('f')
    const { receiptHash: _receiptHash, ...receiptBody } = intrinsicallyInconsistent
    intrinsicallyInconsistent.receiptHash = await hashTextOpenWorldCreatorEditTerminalReceiptV1(receiptBody)
    await expect(parseTextOpenWorldCreatorEditTerminalReceiptV1(intrinsicallyInconsistent))
      .rejects.toThrow(/内在 criteria 不闭合/)
  })
})
