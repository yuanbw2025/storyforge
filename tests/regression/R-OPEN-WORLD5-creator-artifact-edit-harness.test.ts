import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentRunV1, appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { FORMAL_AI_ENTRY_BY_ID_V1 } from '../../src/lib/agent/formal-ai-entry'
import { AGENT_SKILL_BY_ID } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import {
  abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1,
  cancelTextOpenWorldCreatorArtifactEditIntakeV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1,
  confirmTextOpenWorldCreatorArtifactEditIntentV1,
  listTextOpenWorldCreatorArtifactEditHandoffsV1,
  readLatestTextOpenWorldCreatorArtifactEditStateV1,
  readTextOpenWorldCreatorArtifactEditHandoffV1,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1,
  reviseTextOpenWorldCreatorArtifactEditCandidateV1,
  type TextOpenWorldCreatorArtifactEditBoundaryV1,
} from '../../src/lib/open-world/creator-artifact-edit'
import {
  hashTextOpenWorldCreatorEditOwnerSiblingGroupV1,
  type TextOpenWorldCreatorEditPatchOperationV1,
} from '../../src/lib/open-world/creator-artifact-edit-contract'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import type { AIConfig, WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const mockRuntime = vi.hoisted(() => ({
  workspace: null as any,
  workspaces: [] as any[],
  contextJson: '',
  projection: null as any,
}))

const formalAIRuntime = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('../../src/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/ai/client')>()
  return {
    ...actual,
    chat: formalAIRuntime.execute,
  }
})

vi.mock('../../src/lib/open-world/creator-artifact-edit-context', () => {
  const resolveWorkspace = async (input: Record<string, unknown>) => {
    const workspace = mockRuntime.workspaces.find(candidate => (
      input.productProductionId === candidate.targetContext.production.id
      && input.productBuildId === candidate.targetContext.build.id
      && input.textOpenWorldCreatorEditArtifactKey === candidate.targetContext.target.artifactKey
      && input.textOpenWorldCreatorEditEntityIdentity
        === candidate.targetContext.target.entityIdentity
      && input.textOpenWorldCreatorEditExpectedSnapshotHash
        === candidate.targetContext.governanceSnapshotHash
    )) ?? mockRuntime.workspace
    if (!workspace) throw new Error('[creator-edit-test] workspace 未初始化')
    if (input.productProductionId !== workspace.targetContext.production.id
      || input.productBuildId !== workspace.targetContext.build.id
      || input.textOpenWorldCreatorEditArtifactKey !== workspace.targetContext.target.artifactKey
      || input.textOpenWorldCreatorEditEntityIdentity
        !== workspace.targetContext.target.entityIdentity
      || input.textOpenWorldCreatorEditExpectedSnapshotHash
        !== workspace.targetContext.governanceSnapshotHash) {
      throw new Error('[creator-edit-test] 目标治理快照已变化')
    }
    return structuredClone(workspace)
  }
  return {
    resolveTextOpenWorldCreatorEditWorkspaceV1: resolveWorkspace,
    resolveTextOpenWorldCreatorEditTargetContextV1: async (input: Record<string, unknown>) => (
      await resolveWorkspace(input)
    ).targetContext,
    readTextOpenWorldCreatorEditTargetContextV1: async (input: Record<string, unknown>) => {
      await resolveWorkspace(input)
      return mockRuntime.contextJson
    },
  }
})

vi.mock('../../src/lib/open-world/creator-artifact-edit-dispatch', () => ({
  projectTextOpenWorldCreatorAuthorEditableDraftV1: async () => (
    structuredClone(mockRuntime.projection)
  ),
  applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1: async (input: {
    draft: { summary: string }
    patch: { operations: Array<{ value: unknown }> }
  }) => {
    const draft = structuredClone(input.draft)
    draft.summary = String(input.patch.operations[0]!.value)
    return { draft, draftHash: await hashProductProductionValueV2(draft) }
  },
  rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1: async (input: {
    taskKey: string
    baseArtifacts: Array<{ artifactKey: string; payload: Record<string, unknown> }>
    draft: { summary: string }
  }) => {
    const payload = {
      ...structuredClone(input.baseArtifacts[0]!.payload),
      summary: input.draft.summary,
    }
    return {
      taskKey: input.taskKey,
      validatorId: 'text-open-world.creator-edit.fixture-validator',
      outputArtifactKeys: ['text-open-world.story-arc'],
      requiredGateIds: ['tow.story.valid'],
      passedGateIds: ['tow.story.valid'],
      artifacts: [{ artifactKey: 'text-open-world.story-arc', payload }],
      draftHash: await hashProductProductionValueV2(input.draft),
      stableStructureHash: mockRuntime.projection.stableStructureHash,
      identitySequence: [...mockRuntime.projection.identitySequence],
      identitySequenceHash: mockRuntime.projection.identitySequenceHash,
      referenceSlots: [],
      referenceHash: mockRuntime.projection.referenceHash,
    }
  },
}))

const TASK_KEY = 'p3.story-architecture'
const ARTIFACT_KEY = 'text-open-world.story-arc' as const
const ENTITY_IDENTITY = 'story:text-open-world.story-arc.root'
const FIELD_ID = 'field.story-summary'
const BASE_SUMMARY = '旧的故事摘要'
const DIRECT_SUMMARY = '作者直接修改后的故事摘要'
const AGENT_SUMMARY = '模型根据作者意图修改后的故事摘要'
const FORMAL_AI_CONFIG: AIConfig = {
  provider: 'custom',
  apiKey: 'fixture-key',
  model: 'fixture-formal-model',
  baseUrl: 'https://fixture.invalid/v1',
  temperature: 0.2,
  maxTokens: 4_096,
  contextWindow: 1_000_000,
}

async function withFixtureBrowserLocks<T>(operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => T | Promise<T>,
      ) => callback(),
    },
  })
  try {
    return await operation()
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor)
    else delete (navigator as Navigator & { locks?: LockManager }).locks
  }
}

interface HarnessFixture {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  parentRunId: number
  field: {
    fieldId: string
    baseValueHash: string
  }
  selection: {
    scope: WorkspaceScope
    productionId: number
    buildId: number
    expectedSnapshotHash: string
    artifactKey: typeof ARTIFACT_KEY
    entityIdentity: string
  }
}

async function appendParentEvent(
  scope: WorkspaceScope,
  snapshot: Awaited<ReturnType<typeof createAgentRunV1>>,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
) {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

async function seedCompletedProducer(input: {
  scope: WorkspaceScope
  buildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
  candidateHash: string
  receiptHash: string
}) {
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    productBuildId: input.buildId,
    contract: {
      version: 1,
      objective: '提供 Creator Artifact 修改测试的已完成生产者',
      workflowKind: 'generate-verify-revise',
      scope: {
        projectId: input.scope.projectId,
        worldGroupId: null,
        productProduction: {
          productBuildId: input.buildId,
          buildNumber: input.buildNumber,
          controlEpoch: input.controlEpoch,
          planHash: input.planHash,
          taskKey: TASK_KEY,
        },
      },
      permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
      runtimeBindingHash: await hashProductProductionValueV2({
        fixture: 'creator-artifact-edit-harness-producer',
        buildId: input.buildId,
      }),
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 0,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxAttemptsPerStep: 1,
      },
      acceptance: [{ id: 'producer-output', kind: 'output-present', required: true }],
      verificationPlan: [{
        id: 'producer-terminal',
        kind: 'terminal',
        verifier: 'creator-edit-test-producer-v1',
        criterionIds: ['producer-output'],
      }],
      failurePolicy: {
        onProtocolError: 'fail',
        onVerificationFailure: 'fail',
        onStaleInput: 'pause-for-author',
      },
    },
  })
  snapshot = await appendParentEvent(input.scope, snapshot, 'step.scheduled', { stepId: TASK_KEY })
  snapshot = await appendParentEvent(input.scope, snapshot, 'step.started', {
    stepId: TASK_KEY,
    attempt: 1,
  })
  snapshot = await appendParentEvent(input.scope, snapshot, 'candidate.persisted', {
    stepId: TASK_KEY,
    attempt: 1,
    candidateHash: input.candidateHash,
    requiresConfirmation: false,
  })
  snapshot = await appendParentEvent(input.scope, snapshot, 'step.succeeded', {
    stepId: TASK_KEY,
    attempt: 1,
    outputHash: input.candidateHash,
  })
  snapshot = await appendParentEvent(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: 'creator-edit-test-producer-v1',
  })
  snapshot = await appendParentEvent(input.scope, snapshot, 'verification.accepted', {
    receiptHash: input.receiptHash,
  })
  expect(snapshot.projection.state).toBe('completed')
  return snapshot
}

async function seedHarnessFixture(): Promise<HarnessFixture> {
  const created = await seedCurrentWorkspace(`G5-06 Harness ${crypto.randomUUID()}`)
  const scope = created.scope
  const now = Date.now()
  const productionKey = `tow.creator.harness.${crypto.randomUUID()}`
  const productionId = await db.productProductions.add(stampNewRecord(scope, 'productProductions', {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    productionKey,
    productType: 'text-open-world',
    title: '盐脊',
    status: 'preview-ready',
    stateRevision: 12,
    controlEpoch: 3,
    currentBriefRevision: 1,
    currentBuildNumber: 4,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const planHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-plan',
    productionId,
  })
  const manifestHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-manifest',
    productionId,
  })
  const buildId = await db.productBuilds.add(stampNewRecord(scope, 'productBuilds', {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    productionId,
    buildNumber: 4,
    briefRevision: 1,
    briefHash: '1'.repeat(64),
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'release-ready',
    resumeState: null,
    stateRevision: 9,
    controlEpoch: 3,
    planRevision: 1,
    planJson: '{}',
    planHash,
    budgetLedgerJson: '{}',
    manifestJson: '{}',
    manifestHash,
    packageHash: '2'.repeat(64),
    previewManifestJson: '{}',
    previewHash: '3'.repeat(64),
    qualityReportJson: '{}',
    qualityReportHash: '4'.repeat(64),
    compatibilityJson: '{}',
    rootTerminalReceiptHash: null,
    adoptionIntentHash: null,
    releasedProductReleaseId: null,
    failureJson: '{}',
    authorizedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number

  const producerCandidateHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-producer-candidate',
    buildId,
  })
  const producerReceiptHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-producer-receipt',
    buildId,
  })
  const producer = await seedCompletedProducer({
    scope,
    buildId,
    buildNumber: 4,
    controlEpoch: 3,
    planHash,
    candidateHash: producerCandidateHash,
    receiptHash: producerReceiptHash,
  })
  await db.productBuilds.update(buildId, { rootTerminalReceiptHash: producerReceiptHash })

  const basePayload = {
    schema: 'storyforge.text-open-world-story-arc',
    version: 1,
    summary: BASE_SUMMARY,
  }
  const baseContentHash = await hashProductProductionValueV2(basePayload)
  const inputHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-input',
    buildId,
  })
  await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    buildId,
    artifactKey: ARTIFACT_KEY,
    requirementKey: null,
    version: 1,
    kind: ARTIFACT_KEY,
    mediaKind: null,
    status: 'accepted',
    producerRunId: producer.run.id,
    producerReceiptHash,
    controlEpoch: 3,
    inputHash,
    contentHash: baseContentHash,
    payloadJson: canonicalProductProductionJsonV2(basePayload),
    metadataJson: '{}',
    qualityJson: '{}',
    rightsJson: '{}',
    blobObjectId: null,
    mimeType: null,
    byteSize: new TextEncoder().encode(canonicalProductProductionJsonV2(basePayload)).byteLength,
    parentArtifactHash: null,
    carriedFrom: null,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' }))

  const fullDraft = { summary: BASE_SUMMARY }
  const baseDraftHash = await hashProductProductionValueV2(fullDraft)
  const stableStructureHash = await hashProductProductionValueV2({
    identities: [ENTITY_IDENTITY],
    order: [ARTIFACT_KEY],
  })
  const identitySequenceHash = await hashProductProductionValueV2([ENTITY_IDENTITY])
  const referenceHash = await hashProductProductionValueV2([])
  const baseValueHash = await hashProductProductionValueV2(BASE_SUMMARY)
  const field = {
    schema: 'storyforge.text-open-world-creator-edit-field' as const,
    version: 1 as const,
    fieldId: FIELD_ID,
    artifactKey: ARTIFACT_KEY,
    entityIdentity: ENTITY_IDENTITY,
    jsonPointer: '/summary',
    label: '故事摘要',
    valueKind: 'string' as const,
    baseValueHash,
    maximumUtf8Bytes: 8_192,
    mutationPolicy: 'replace-only' as const,
    stableIdPolicy: 'preserve' as const,
    entitySetPolicy: 'preserve' as const,
    entityOrderPolicy: 'preserve' as const,
  }
  const baseSibling = {
    artifactKey: ARTIFACT_KEY,
    requirementKey: null,
    kind: ARTIFACT_KEY,
    version: 1,
    status: 'accepted' as const,
    inputHash,
    contentHash: baseContentHash,
    producerRunId: producer.run.id,
    producerReceiptHash,
    parentArtifactHash: null,
    carriedFrom: null,
  }
  const siblingBody = {
    schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group' as const,
    version: 1 as const,
    ownerTaskKey: TASK_KEY,
    skillId: 'text-open-world.production.story-architecture.v1',
    dependencyTaskKeys: [],
    outputArtifactKeys: [ARTIFACT_KEY],
    acceptanceGateIds: ['tow.story.valid'],
    baseSiblings: [baseSibling],
  }
  const ownerSiblingGroup = {
    ...siblingBody,
    baseGroupHash: await hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(siblingBody),
  }
  const semanticDraft = {
    schema: 'storyforge.text-open-world-creator-edit-semantic-draft' as const,
    version: 1 as const,
    artifactKey: ARTIFACT_KEY,
    entityIdentity: ENTITY_IDENTITY,
    fields: [{
      fieldId: FIELD_ID,
      label: '故事摘要',
      valueKind: 'string' as const,
      value: BASE_SUMMARY,
    }],
  }
  const governanceSnapshotHash = await hashProductProductionValueV2({
    fixture: 'creator-artifact-edit-harness-governance-snapshot',
    buildId,
  })
  const targetContext = {
    schema: 'storyforge.text-open-world-creator-edit-target-context' as const,
    version: 1 as const,
    governanceSnapshotHash,
    production: {
      id: productionId,
      productionKey,
      title: '盐脊',
      status: 'preview-ready' as const,
      stateRevision: 12,
    },
    build: {
      id: buildId,
      buildNumber: 4,
      status: 'release-ready' as const,
      controlEpoch: 3,
      planHash,
      stateRevision: 9,
      manifestHash,
      rootTerminalReceiptHash: producerReceiptHash,
    },
    target: {
      schema: 'storyforge.text-open-world-creator-edit-target' as const,
      version: 1 as const,
      artifactKey: ARTIFACT_KEY,
      artifactVersion: 1,
      artifactKind: ARTIFACT_KEY,
      artifactContentHash: baseContentHash,
      entityIdentity: ENTITY_IDENTITY,
      ownerTaskKey: TASK_KEY,
    },
    ownerSiblingGroup,
    producerEvidence: {
      schema: 'storyforge.text-open-world-creator-edit-producer-evidence' as const,
      version: 1 as const,
      proofKind: 'accepted-checkpoint' as const,
      taskKey: TASK_KEY,
      runId: producer.run.id,
      rootRunId: producer.run.id,
      attempt: 1,
      controlEpoch: 3,
      inputHash,
      candidateHash: producerCandidateHash,
      checkpointHash: await hashProductProductionValueV2({ fixture: 'producer-checkpoint', buildId }),
      terminalReceiptHash: producerReceiptHash,
      rootTerminalReceiptHash: producerReceiptHash,
      dependencies: [],
      carriedLineageHash: null,
    },
    productionValidationReceiptHash: await hashProductProductionValueV2({
      fixture: 'production-validation',
      buildId,
    }),
    baseDraftHash,
    stableStructureHash,
    semanticDraft,
    semanticDraftHash: await hashProductProductionValueV2(semanticDraft),
    editableFields: [field],
  }
  mockRuntime.projection = {
    taskKey: TASK_KEY,
    outputArtifactKeys: [ARTIFACT_KEY],
    target: { artifactKey: ARTIFACT_KEY, entityIdentity: ENTITY_IDENTITY },
    draft: fullDraft,
    draftHash: baseDraftHash,
    stableStructureHash,
    identitySequence: [ENTITY_IDENTITY],
    identitySequenceHash,
    referenceSlots: [],
    referenceHash,
    editableFields: [field],
  }
  mockRuntime.workspace = {
    targetContext,
    fullDraft,
    stableStructureHash,
    taskContext: 'fixture:author-editable-story-context',
    baseArtifacts: [{
      rowId: 1,
      artifactKey: ARTIFACT_KEY,
      requirementKey: null,
      kind: ARTIFACT_KEY,
      version: 1,
      status: 'accepted',
      controlEpoch: 3,
      inputHash,
      contentHash: baseContentHash,
      producerRunId: producer.run.id,
      producerReceiptHash,
      parentArtifactHash: null,
      carriedFrom: null,
      payload: basePayload,
      metadata: {},
      quality: {},
      rights: {},
    }],
  }
  mockRuntime.workspaces = [structuredClone(mockRuntime.workspace)]
  mockRuntime.contextJson = canonicalProductProductionJsonV2(targetContext)

  return {
    scope,
    productionId,
    buildId,
    parentRunId: producer.run.id,
    field: { fieldId: FIELD_ID, baseValueHash },
    selection: {
      scope,
      productionId,
      buildId,
      expectedSnapshotHash: governanceSnapshotHash,
      artifactKey: ARTIFACT_KEY,
      entityIdentity: ENTITY_IDENTITY,
    },
  }
}

function operation(fixture: HarnessFixture, value = DIRECT_SUMMARY): TextOpenWorldCreatorEditPatchOperationV1 {
  return {
    op: 'replace',
    fieldId: fixture.field.fieldId,
    baseValueHash: fixture.field.baseValueHash,
    value,
  }
}

function modelOutput(fixture: HarnessFixture, value = AGENT_SUMMARY): string {
  return JSON.stringify({
    schema: 'storyforge.text-open-world-creator-edit-model-output',
    version: 1,
    operations: [operation(fixture, value)],
  })
}

async function retargetFixtureWithinOwnerSiblingGroup(
  fixture: HarnessFixture,
  entityIdentity: string,
) {
  const workspace = structuredClone(mockRuntime.workspace)
  const projection = structuredClone(mockRuntime.projection)
  const fieldId = `${FIELD_ID}.${entityIdentity}`
  const field = {
    ...workspace.targetContext.editableFields[0],
    fieldId,
    entityIdentity,
  }
  const stableStructureHash = await hashProductProductionValueV2({
    identities: [entityIdentity],
    order: [ARTIFACT_KEY],
  })
  const identitySequenceHash = await hashProductProductionValueV2([entityIdentity])
  workspace.targetContext.target.entityIdentity = entityIdentity
  workspace.targetContext.editableFields = [field]
  workspace.targetContext.semanticDraft.entityIdentity = entityIdentity
  workspace.targetContext.semanticDraft.fields = [{
    ...workspace.targetContext.semanticDraft.fields[0],
    fieldId,
  }]
  workspace.targetContext.semanticDraftHash = await hashProductProductionValueV2(
    workspace.targetContext.semanticDraft,
  )
  workspace.targetContext.stableStructureHash = stableStructureHash
  projection.target.entityIdentity = entityIdentity
  projection.editableFields = [field]
  projection.identitySequence = [entityIdentity]
  projection.identitySequenceHash = identitySequenceHash
  projection.stableStructureHash = stableStructureHash
  mockRuntime.workspace = workspace
  mockRuntime.workspaces.push(structuredClone(workspace))
  mockRuntime.projection = projection
  mockRuntime.contextJson = canonicalProductProductionJsonV2(workspace.targetContext)
  return {
    ...fixture.selection,
    entityIdentity,
  }
}

async function businessRows(fixture: HarnessFixture) {
  return {
    production: await db.productProductions.get(fixture.productionId),
    build: await db.productBuilds.get(fixture.buildId),
    artifacts: await db.productBuildArtifacts.where('buildId').equals(fixture.buildId).sortBy('id'),
  }
}

describe.sequential('R-OPEN-WORLD5 · Creator Artifact edit durable Harness', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    formalAIRuntime.execute.mockReset()
    mockRuntime.workspace = null
    mockRuntime.workspaces = []
    mockRuntime.contextJson = ''
    mockRuntime.projection = null
  })
  afterAll(() => db.close())

  it('direct 模式零模型调用，只形成待确认候选且不写正式业务表', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => { throw new Error('direct 模式不得调用模型') })

    const state = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
      runAI,
    })

    expect(runAI).not.toHaveBeenCalled()
    expect(state.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(state.candidate).toMatchObject({
      mode: 'direct',
      modelEvidence: null,
      modelUsage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      },
      status: 'ready',
    })
    expect(state.candidate.rebuiltArtifacts[0]?.payload).toMatchObject({ summary: DIRECT_SUMMARY })
    expect(state.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(state.snapshot.events.some(event => event.type.startsWith('adoption.'))).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('Agent 模式只调用一次模型，并按 Context、request、result、response 顺序留精确证据', async () => {
    const fixture = await seedHarnessFixture()
    const runAI = vi.fn(async () => modelOutput(fixture))
    const state = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '把故事摘要改得更有冒险感。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })

    expect(runAI).toHaveBeenCalledTimes(1)
    expect(state.candidate.mode).toBe('agent')
    expect(state.candidate.modelUsage.modelCalls).toBe(1)
    expect(state.candidate.modelEvidence).toMatchObject({
      provider: 'fixture',
      model: 'fixture-model',
    })
    const evidence = state.snapshot.events.filter(event => (
      event.type === 'evidence.artifact.recorded'
    ))
    const kinds = evidence.map(event => event.type === 'evidence.artifact.recorded'
      ? event.payload.artifactKind : null)
    expect(kinds).toEqual(['context-manifest', 'rendered-request', 'tool-result', 'raw-response'])
    for (const kind of ['context-manifest', 'rendered-request', 'tool-result', 'raw-response']) {
      expect(kinds.filter(value => value === kind)).toHaveLength(1)
    }
    const readEvidence = async (
      kind: 'context-manifest' | 'rendered-request' | 'tool-result' | 'raw-response',
    ) => {
      const event = evidence.find(item => item.type === 'evidence.artifact.recorded'
        && item.payload.artifactKind === kind)!
      return readAgentRunArtifactExactV1({
        projectId: fixture.scope.projectId,
        artifactKind: kind,
        contentHash: event.type === 'evidence.artifact.recorded' ? event.payload.contentHash : '',
      })
    }
    expect(JSON.parse(await readEvidence('context-manifest'))).toMatchObject({
      stepId: 'text-open-world:creator-artifact-edit',
      attempt: 1,
    })
    expect(JSON.parse(await readEvidence('rendered-request'))).toMatchObject({
      schema: 'storyforge.text-open-world-creator-edit-rendered-request',
      version: 1,
    })
    expect(JSON.parse(await readEvidence('tool-result'))).toMatchObject({
      schema: 'storyforge.text-open-world-creator-edit-model-result',
      version: 1,
      rawResponse: modelOutput(fixture),
      usage: { modelCalls: 1 },
    })
    expect(await readEvidence('raw-response')).toBe(modelOutput(fixture))
    const sequence = (type: string) => state.snapshot.events.find(event => event.type === type)!.sequence
    const lastSequence = (type: string) => state.snapshot.events
      .filter(event => event.type === type).at(-1)!.sequence
    const artifactSequence = (kind: string) => evidence.find(event => (
      event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind
    ))!.sequence
    expect(artifactSequence('context-manifest')).toBeLessThan(sequence('context.assembled'))
    expect(artifactSequence('rendered-request')).toBeLessThan(sequence('model.requested'))
    expect(sequence('model.requested')).toBeLessThan(artifactSequence('tool-result'))
    expect(artifactSequence('tool-result')).toBeLessThan(artifactSequence('raw-response'))
    expect(artifactSequence('raw-response')).toBeLessThan(sequence('model.responded'))
    expect(sequence('model.responded')).toBeLessThan(lastSequence('checkpoint.created'))
    expect(lastSequence('checkpoint.created')).toBeLessThan(sequence('candidate.persisted'))
  })

  it('candidate checkpoint 后事件缺失可恢复同一候选，且绝不再次调用模型', async () => {
    const fixture = await seedHarnessFixture()
    let calls = 0
    const request = {
      selection: fixture.selection,
      mode: 'agent' as const,
      authorInstruction: '只调整摘要语气。',
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    }
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
      onDurableBoundary: (boundary: TextOpenWorldCreatorArtifactEditBoundaryV1) => {
        if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint')
      },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    expect(calls).toBe(1)

    const recovered = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      runAI: async () => {
        calls += 1
        throw new Error('恢复不得重调模型')
      },
    })
    expect(calls).toBe(1)
    expect(recovered.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('direct candidate checkpoint 后缺少 candidate.persisted 可从持久化候选自动收口', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    let interruptedRunId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'candidate.checkpoint') {
          interruptedRunId = snapshot.run.id
          throw new Error('interrupt:direct-candidate.checkpoint')
        }
      },
    })).rejects.toThrow('interrupt:direct-candidate.checkpoint')
    expect(interruptedRunId).not.toBeNull()
    const interrupted = await readAgentRunV1(fixture.scope, interruptedRunId!)
    expect(interrupted.projection.state).toBe('running')
    expect(interrupted.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(interrupted.events.some(event => event.type === 'model.requested')).toBe(false)

    const restored = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(restored).not.toBeNull()
    expect(restored).not.toHaveProperty('kind')
    if (!restored || 'kind' in restored) throw new Error('期待恢复 direct candidate checkpoint')
    expect(restored.snapshot.run.id).toBe(interruptedRunId)
    expect(restored.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(restored.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(restored.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it.each([
    'intake.checkpoint',
    'run.started',
    'context.recorded',
  ] as const)('Direct 在候选前 durable boundary $boundary 中断后保留原 Patch，且只可显式恢复', async boundary => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const forbiddenModel = vi.fn(async () => {
      throw new Error('Direct intake 恢复不得调用模型')
    })
    let runId: number | null = null

    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
      runAI: forbiddenModel,
      onDurableBoundary: (currentBoundary, snapshot) => {
        if (currentBoundary === boundary) {
          runId = snapshot.run.id
          throw new Error(`interrupt:direct:${boundary}`)
        }
      },
    })).rejects.toThrow(new RegExp(`durable boundary callback|interrupt:direct:${boundary}`))
    expect(runId).not.toBeNull()
    expect(forbiddenModel).not.toHaveBeenCalled()

    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(runId!).last()
    expect(checkpoint?.resumePayloadJson).toBeTruthy()
    expect(JSON.parse(checkpoint!.resumePayloadJson!)).toMatchObject({
      phase: 'intake',
      portable: false,
      intake: {
        mode: 'direct',
        selection: fixture.selection,
        patch: { operations: [operation(fixture)] },
        authorInstruction: null,
      },
    })

    const firstRead = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(firstRead).toMatchObject({
      kind: 'intake-ready',
      runId,
      mode: 'direct',
      ownerTaskKey: TASK_KEY,
      message: expect.stringMatching(/显式|恢复|继续/),
    })
    const secondRead = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(secondRead).toMatchObject({ kind: 'intake-ready', runId, mode: 'direct' })
    expect(forbiddenModel).not.toHaveBeenCalled()

    const resumed = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
      runAI: forbiddenModel,
    })
    expect(resumed.snapshot.run.id).toBe(runId)
    expect(resumed.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(resumed.candidate.mode).toBe('direct')
    expect(resumed.candidate.patch.operations).toEqual([operation(fixture)])
    expect(resumed.candidate.rebuiltArtifacts[0]?.payload).toMatchObject({
      summary: DIRECT_SUMMARY,
    })
    expect(resumed.snapshot.events.some(event => event.type === 'model.requested')).toBe(false)
    expect(forbiddenModel).not.toHaveBeenCalled()
    expect(await businessRows(fixture)).toEqual(before)
  })

  it.each([
    'intake.checkpoint',
    'run.started',
    'context.recorded',
    'request.recorded',
  ] as const)('Agent 在模型请求前 durable boundary $boundary 中断后保留原指令；读取不执行，显式恢复至多调用一次', async boundary => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const instruction = `保留事实并改善摘要；中断点=${boundary}`
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null

    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: instruction,
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (currentBoundary, snapshot) => {
        if (currentBoundary === boundary) {
          runId = snapshot.run.id
          throw new Error(`interrupt:agent:${boundary}`)
        }
      },
    })).rejects.toThrow(new RegExp(`durable boundary callback|interrupt:agent:${boundary}`))
    expect(runId).not.toBeNull()
    expect(runAI).not.toHaveBeenCalled()

    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(runId!).last()
    expect(checkpoint?.resumePayloadJson).toBeTruthy()
    expect(JSON.parse(checkpoint!.resumePayloadJson!)).toMatchObject({
      phase: 'intake',
      portable: false,
      intake: {
        mode: 'agent',
        selection: fixture.selection,
        patch: null,
        authorInstruction: instruction,
        modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      },
    })

    const firstRead = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(firstRead).toMatchObject({
      kind: 'intake-ready',
      runId,
      mode: 'agent',
      ownerTaskKey: TASK_KEY,
      message: expect.stringMatching(/显式|恢复|继续/),
    })
    const secondRead = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(secondRead).toMatchObject({ kind: 'intake-ready', runId, mode: 'agent' })
    expect(runAI).not.toHaveBeenCalled()

    const resumed = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
      runAI,
    })
    expect(resumed.snapshot.run.id).toBe(runId)
    expect(resumed.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(resumed.candidate.mode).toBe('agent')
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(resumed.snapshot.events.filter(event => event.type === 'model.requested'))
      .toHaveLength(1)
    expect(resumed.snapshot.events.filter(event => event.type === 'model.responded'))
      .toHaveLength(1)

    const repeated = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
      runAI,
    })
    expect(repeated.candidate.candidateHash).toBe(resumed.candidate.candidateHash)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('模型结果已持久化但候选尚未 checkpoint 时沿 known-result 路径自动恢复，绝不二次调用', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null

    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '持久化结果后模拟刷新，必须从同一结果恢复。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'model-result.recorded') {
          runId = snapshot.run.id
          throw new Error('interrupt:model-result.recorded')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:model-result\.recorded/)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(runId).not.toBeNull()

    const interrupted = await readAgentRunV1(fixture.scope, runId!)
    expect(interrupted.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(interrupted.events.some(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'tool-result')).toBe(true)
    expect(interrupted.events.some(event => event.type === 'candidate.persisted')).toBe(false)

    const recovered = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(recovered).not.toBeNull()
    expect(recovered).not.toHaveProperty('kind')
    if (!recovered || 'kind' in recovered) throw new Error('期待 known-result 自动恢复候选')
    expect(recovered.snapshot.run.id).toBe(runId)
    expect(recovered.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered.snapshot.events.filter(event => event.type === 'model.requested'))
      .toHaveLength(1)
    expect(recovered.snapshot.events.filter(event => event.type === 'model.responded'))
      .toHaveLength(1)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('intake checkpoint 被篡改后读取与显式恢复都 fail closed，且模型零调用', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '这条原始指令必须完整保留。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'intake.checkpoint') {
          runId = snapshot.run.id
          throw new Error('interrupt:intake-tamper')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:intake-tamper/)
    expect(runAI).not.toHaveBeenCalled()

    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(runId!).last()
    expect(checkpoint?.id).toBeDefined()
    const payload = JSON.parse(checkpoint!.resumePayloadJson!) as {
      intake: { authorInstruction: string }
    }
    payload.intake.authorInstruction = '攻击者替换的指令'
    await db.agentRunCheckpoints.update(checkpoint!.id!, {
      resumePayloadJson: canonicalProductProductionJsonV2(payload),
    })

    await expect(readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection))
      .rejects.toThrow(/resume-evidence|checkpoint|hash|intake|恢复/i)
    await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
      runAI,
    })).rejects.toThrow(/checkpoint|hash|intake|恢复/i)
    expect(runAI).not.toHaveBeenCalled()
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('intake resume 必须匹配精确 selection，错误实体或治理快照不能借用原请求', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '形成精确 selection 恢复测试。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'intake.checkpoint') {
          runId = snapshot.run.id
          throw new Error('interrupt:intake-selection')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:intake-selection/)

    await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: { ...fixture.selection, entityIdentity: 'story:other-entity' },
      runId: runId!,
      runAI,
    })).rejects.toThrow(/目标治理快照已变化|selection|目标|匹配/i)
    await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: { ...fixture.selection, expectedSnapshotHash: 'f'.repeat(64) },
      runId: runId!,
      runAI,
    })).rejects.toThrow(/目标治理快照已变化|selection|目标|匹配/i)
    expect(runAI).not.toHaveBeenCalled()
    const intact = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(intact).toMatchObject({ kind: 'intake-ready', runId, mode: 'agent' })
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('未派发 intake 可由作者安全取消并结算；同文再次生成建立 replacement 且只调用一次模型', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null
    const request = {
      selection: fixture.selection,
      mode: 'agent' as const,
      authorInstruction: '冻结后允许我在模型调用前取消这次请求。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    }
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'intake.checkpoint') {
          runId = snapshot.run.id
          throw new Error('interrupt:intake-cancel')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:intake-cancel/)
    expect(runAI).not.toHaveBeenCalled()

    const frozenWorkspace = mockRuntime.workspace
    const frozenWorkspaces = mockRuntime.workspaces
    const frozenContextJson = mockRuntime.contextJson
    const frozenProjection = mockRuntime.projection
    mockRuntime.workspace = null
    mockRuntime.workspaces = []
    mockRuntime.contextJson = ''
    mockRuntime.projection = null
    const cancelled = await cancelTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
    })
    mockRuntime.workspace = frozenWorkspace
    mockRuntime.workspaces = frozenWorkspaces
    mockRuntime.contextJson = frozenContextJson
    mockRuntime.projection = frozenProjection
    expect(cancelled.projection.state).toBe('cancelled')
    expect(cancelled.projection.memorySettlement?.state).toBe('incomplete')
    expect(cancelled.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
    expect(cancelled.events.find(event => event.type === 'run.cancelled')).toMatchObject({
      payload: { reason: 'author-cancelled-undispatched-creator-edit-intake' },
    })
    await expect(cancelTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
    })).resolves.toMatchObject({ projection: { state: 'cancelled' } })
    expect(await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)).toBeNull()

    const replacement = await generateTextOpenWorldCreatorArtifactEditCandidateV1(request)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(replacement.snapshot.run.parentRelation)
      .toBe(`${cancelled.run.parentRelation}:replacement:${cancelled.run.id}`)
    expect(replacement.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('模型请求已派发后不得伪装成未调用 intake 取消', async () => {
    const fixture = await seedHarnessFixture()
    let runId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '形成已经派发但结果未知的请求。',
      runAI: async () => {
        throw new Error('fixture:unknown-for-intake-cancel')
      },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'model.requested') runId = snapshot.run.id
      },
    })).rejects.toThrow('fixture:unknown-for-intake-cancel')

    await expect(cancelTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: runId!,
    })).rejects.toThrow(/只有尚未派发|可取消|intake/i)
    const blocker = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(blocker).toMatchObject({ kind: 'model-outcome-unknown', runId })
  })

  it('模型请求前 live Skill/Formal Entry 漂移不污染 intake 的冻结执行绑定', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const runAI = vi.fn(async () => modelOutput(fixture))
    let runId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '注册表漂移前冻结这条指令。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'intake.checkpoint') {
          runId = snapshot.run.id
          throw new Error('interrupt:intake-registry-drift')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:intake-registry-drift/)
    expect(runAI).not.toHaveBeenCalled()

    const liveSkill = AGENT_SKILL_BY_ID.get('text-open-world.creator-artifact-edit.v1')!
    const liveEntry = FORMAL_AI_ENTRY_BY_ID_V1.get('text-open-world.creator-artifact.modify')!
    const originalPromptVersion = liveSkill.promptVersion
    const originalReason = liveEntry.reason
    try {
      liveSkill.promptVersion = `${originalPromptVersion}-pre-dispatch-drift`
      ;(liveEntry as { reason: string }).reason = `${originalReason} pre-dispatch drift`
      await expect(readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection))
        .resolves.toMatchObject({ kind: 'intake-ready', runId, mode: 'agent' })
      const resumed = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
        selection: fixture.selection,
        runId: runId!,
        runAI,
      })
      expect(resumed.snapshot.run.id).toBe(runId)
      expect(resumed.candidate.mode).toBe('agent')
      expect(runAI).toHaveBeenCalledTimes(1)
    } finally {
      liveSkill.promptVersion = originalPromptVersion
      ;(liveEntry as { reason: string }).reason = originalReason
    }
    const intact = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(intact).toMatchObject({ candidate: { mode: 'agent' } })
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('Agent V2 冻结契约在 live Skill/Formal Entry 注册表漂移后仍恢复原 Run', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    let calls = 0
    let interruptedRunId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '在保留事实的前提下改善摘要。',
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'candidate.checkpoint') {
          interruptedRunId = snapshot.run.id
          throw new Error('interrupt:agent-v2-candidate.checkpoint')
        }
      },
    })).rejects.toThrow('interrupt:agent-v2-candidate.checkpoint')
    expect(calls).toBe(1)
    expect(interruptedRunId).not.toBeNull()
    const frozen = await readAgentRunV1(fixture.scope, interruptedRunId!)
    expect(frozen.contract.version).toBe(2)
    expect(frozen.contract.executionBindings?.[0]).toMatchObject({
      version: 2,
      skillVersion: 2,
      skillId: 'text-open-world.creator-artifact-edit.v1',
      formalEntry: { entryId: 'text-open-world.creator-artifact.modify' },
    })

    const liveSkill = AGENT_SKILL_BY_ID.get('text-open-world.creator-artifact-edit.v1')!
    const liveEntry = FORMAL_AI_ENTRY_BY_ID_V1.get('text-open-world.creator-artifact.modify')!
    const originalPromptVersion = liveSkill.promptVersion
    const originalReason = liveEntry.reason
    try {
      liveSkill.promptVersion = `${originalPromptVersion}-registry-drift`
      ;(liveEntry as { reason: string }).reason = `${originalReason} registry drift`
      const restored = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
      expect(restored).not.toBeNull()
      expect(restored).not.toHaveProperty('kind')
      if (!restored || 'kind' in restored) throw new Error('期待冻结 V2 契约恢复候选')
      expect(restored.snapshot.run.id).toBe(interruptedRunId)
      expect(restored.snapshot.contract).toEqual(frozen.contract)
      expect(restored.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(restored.snapshot.events.filter(event => event.type === 'candidate.persisted'))
        .toHaveLength(1)
      expect(calls).toBe(1)
    } finally {
      liveSkill.promptVersion = originalPromptVersion
      ;(liveEntry as { reason: string }).reason = originalReason
    }
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('正式模型 intake 冻结后拒绝同 provider/model 但 endpoint 或执行配置已经漂移的恢复', async () => {
    await withFixtureBrowserLocks(async () => {
      const fixture = await seedHarnessFixture()
      let runId: number | null = null
      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
        selection: fixture.selection,
        mode: 'agent',
        authorInstruction: '冻结正式模型的完整执行身份。',
        aiConfig: FORMAL_AI_CONFIG,
        onDurableBoundary: (boundary, snapshot) => {
          if (boundary === 'intake.checkpoint') {
            runId = snapshot.run.id
            throw new Error('interrupt:formal-identity-intake')
          }
        },
      })).rejects.toThrow(/durable boundary callback|interrupt:formal-identity-intake/)
      expect(formalAIRuntime.execute).not.toHaveBeenCalled()

      await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({
        selection: fixture.selection,
        runId: runId!,
        aiConfig: {
          ...FORMAL_AI_CONFIG,
          baseUrl: 'https://drifted-endpoint.invalid/v1',
        },
      })).rejects.toThrow(/intake-binding|执行身份|模型|冻结|不一致/)
      expect(formalAIRuntime.execute).not.toHaveBeenCalled()
      const intact = await readAgentRunV1(fixture.scope, runId!)
      expect(intact.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
    })
  })

  it('正式模型 intake 在 live Skill/Formal Entry 被移除后仍按冻结定义完成且只调用一次', async () => {
    await withFixtureBrowserLocks(async () => {
      const fixture = await seedHarnessFixture()
      let runId: number | null = null
      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
        selection: fixture.selection,
        mode: 'agent',
        authorInstruction: '只依赖冻结 Skill 与正式入口恢复。',
        aiConfig: FORMAL_AI_CONFIG,
        onDurableBoundary: (boundary, snapshot) => {
          if (boundary === 'intake.checkpoint') {
            runId = snapshot.run.id
            throw new Error('interrupt:formal-registry-removal')
          }
        },
      })).rejects.toThrow(/durable boundary callback|interrupt:formal-registry-removal/)
      expect(formalAIRuntime.execute).not.toHaveBeenCalled()

      const skillId = 'text-open-world.creator-artifact-edit.v1'
      const entryId = 'text-open-world.creator-artifact.modify'
      const skill = AGENT_SKILL_BY_ID.get(skillId)!
      const entry = FORMAL_AI_ENTRY_BY_ID_V1.get(entryId)!
      AGENT_SKILL_BY_ID.delete(skillId)
      FORMAL_AI_ENTRY_BY_ID_V1.delete(entryId)
      try {
        formalAIRuntime.execute.mockResolvedValueOnce(modelOutput(fixture))
        const resumed = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
          selection: fixture.selection,
          runId: runId!,
          aiConfig: FORMAL_AI_CONFIG,
        })
        expect(resumed.snapshot.projection.state).toBe('awaiting_confirmation')
        expect(resumed.snapshot.run.id).toBe(runId)
        expect(formalAIRuntime.execute).toHaveBeenCalledTimes(1)
      } finally {
        AGENT_SKILL_BY_ID.set(skillId, skill)
        FORMAL_AI_ENTRY_BY_ID_V1.set(entryId, entry)
      }
    })
  })

  it('Agent V2 契约内嵌 Skill definition snapshot 被篡改时，即使重算外层 hash 也拒绝读取', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '形成用于冻结契约篡改反例的候选。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })
    const before = await businessRows(fixture)
    const row = await db.agentRuns.get(generated.snapshot.run.id)
    expect(row).toBeDefined()
    const contract = JSON.parse(row!.contractJson) as {
      version: number
      executionBindings: Array<{
        skillDefinitionJson: string
        skillDefinitionHash: string
      }>
    }
    expect(contract.version).toBe(2)
    const definition = JSON.parse(contract.executionBindings[0]!.skillDefinitionJson) as {
      label: string
    }
    definition.label = `${definition.label}·被篡改`
    contract.executionBindings[0]!.skillDefinitionJson = canonicalProductProductionJsonV2(definition)
    const contractJson = canonicalProductProductionJsonV2(contract)
    await db.agentRuns.update(generated.snapshot.run.id, {
      contractJson,
      contractHash: await hashProductProductionValueV2(contract),
    })

    await expect(readAgentRunV1(fixture.scope, generated.snapshot.run.id))
      .rejects.toThrow(/skillDefinitionHash|Skill definition/i)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('model.requested 已持久化但没有 raw response 时暂停，恢复也不会隐藏重发', async () => {
    const fixture = await seedHarnessFixture()
    let calls = 0
    const request = {
      selection: fixture.selection,
      mode: 'agent' as const,
      authorInstruction: '把摘要写得更紧张。',
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    }
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
      onDurableBoundary: boundary => {
        if (boundary === 'model.requested') throw new Error('interrupt:model.requested')
      },
    })).rejects.toThrow('interrupt:model.requested')
    expect(calls).toBe(0)

    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
    })).rejects.toThrow(/不会自动重发|model-outcome-unknown/)
    expect(calls).toBe(0)
    const child = (await db.agentRuns.toArray()).find(row => row.parentRunId === fixture.parentRunId)
    expect(child?.status).toBe('paused')
    const snapshot = await readAgentRunV1(fixture.scope, child!.id!)
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'raw-response')).toBe(false)

    await expect(resumeTextOpenWorldCreatorArtifactEditIntakeV1({
      selection: fixture.selection,
      runId: child!.id!,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
    })).rejects.toThrow(/不会自动重发|model-outcome-unknown|暂停|不可安全重发/)
    expect(calls).toBe(0)

    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...request,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
    })).rejects.toThrow(/暂停|不可安全重发/)
    expect(calls).toBe(0)
  })

  it('结果未知 blocker 可由作者显式放弃，精确记录取消原因后才允许同组新请求', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    let calls = 0
    const interruptedRequest = {
      selection: fixture.selection,
      mode: 'agent' as const,
      authorInstruction: '把摘要写得更紧张。',
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    }
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...interruptedRequest,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
      onDurableBoundary: boundary => {
        if (boundary === 'model.requested') throw new Error('interrupt:model.requested')
      },
    })).rejects.toThrow('interrupt:model.requested')
    expect(calls).toBe(0)

    const blocker = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(blocker).toMatchObject({
      kind: 'model-outcome-unknown',
      runState: 'running',
      ownerTaskKey: TASK_KEY,
      message: expect.stringMatching(/不会自动重发|不会自动重新计费/),
    })
    if (!blocker || !('kind' in blocker)) throw new Error('期待结果未知 blocker')

    const abandoned = await abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
      selection: fixture.selection,
      runId: blocker.runId,
      acknowledgePossibleCharge: true,
    })
    expect(abandoned.projection.state).toBe('cancelled')
    expect(abandoned.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(abandoned.events.filter(event => event.type === 'model.responded')).toHaveLength(0)
    expect(abandoned.events.filter(event => event.type === 'run.cancelled')).toEqual([
      expect.objectContaining({
        payload: {
          reason: 'author-abandoned-unknown-model-outcome-possible-charge-acknowledged',
        },
      }),
    ])
    expect(abandoned.events.slice(-2).map(event => event.type)).toEqual([
      'run.cancelled',
      'memory.settlement.recorded',
    ])
    expect(abandoned.events.filter(event => event.type === 'memory.settlement.recorded'))
      .toHaveLength(1)
    expect(abandoned.projection.memorySettlement).toMatchObject({
      state: 'incomplete',
      terminalReceiptHash: null,
      workspaceDirty: true,
    })
    expect(calls).toBe(0)
    expect(await businessRows(fixture)).toEqual(before)

    const repeated = await abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
      selection: fixture.selection,
      runId: blocker.runId,
      acknowledgePossibleCharge: true,
    })
    expect(repeated.projection.lastSequence).toBe(abandoned.projection.lastSequence)
    expect(repeated.events.filter(event => event.type === 'run.cancelled')).toHaveLength(1)
    expect(repeated.events.filter(event => event.type === 'memory.settlement.recorded')).toHaveLength(1)
    expect(repeated.projection.memorySettlement).toEqual(abandoned.projection.memorySettlement)
    expect(calls).toBe(0)

    const replacement = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      ...interruptedRequest,
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
    })
    expect(calls).toBe(1)
    expect(replacement.snapshot.run.id).not.toBe(blocker.runId)
    expect(replacement.snapshot.run.parentRunId).toBe(abandoned.run.parentRunId)
    expect(replacement.snapshot.run.parentReceiptHash).toBe(abandoned.run.parentReceiptHash)
    expect(replacement.snapshot.run.parentArtifactHash).toBe(abandoned.run.parentArtifactHash)
    expect(replacement.snapshot.run.parentRelation)
      .toBe(`${abandoned.run.parentRelation}:replacement:${abandoned.run.id}`)
    expect(replacement.snapshot.contract.runtimeBindingHash)
      .toBe(abandoned.contract.runtimeBindingHash)
    expect(replacement.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await businessRows(fixture)).toEqual(before)
  })

  it.each([
    {
      label: 'pre-dispatch overflow',
      phase: 'pre-dispatch' as const,
      status: null,
      failureCode: 'creator-edit-model-not-dispatched',
      retryable: false,
      category: 'deterministic',
    },
    {
      label: 'HTTP 401',
      phase: 'response-observed' as const,
      status: 401,
      failureCode: 'creator-edit-model-response-401',
      retryable: false,
      category: 'deterministic',
    },
    {
      label: 'HTTP 429',
      phase: 'response-observed' as const,
      status: 429,
      failureCode: 'creator-edit-model-response-429',
      retryable: true,
      category: 'transient',
    },
  ])('正式 AI $label 是已知失败：终态结算、不产生 unknown blocker，同文重试建立 replacement', async scenario => {
    await withFixtureBrowserLocks(async () => {
      const fixture = await seedHarnessFixture()
      const before = await businessRows(fixture)
      const request = {
        selection: fixture.selection,
        mode: 'agent' as const,
        authorInstruction: `用正式模型修改摘要：${scenario.label}。`,
        aiConfig: FORMAL_AI_CONFIG,
      }
      formalAIRuntime.execute.mockImplementationOnce(async (...args: unknown[]) => {
        const result = args[4] as {
          requestLifecycle?: {
            phase: 'pre-dispatch' | 'request-dispatched' | 'response-observed'
            responseStatus: number | null
          }
        }
        result.requestLifecycle = {
          phase: scenario.phase,
          responseStatus: scenario.status,
        }
        throw new Error(`fixture:${scenario.label}`)
      })

      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1(request))
        .rejects.toThrow(`fixture:${scenario.label}`)
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(1)
      const firstRow = (await db.agentRuns.toArray()).find(row => (
        row.parentRunId === fixture.parentRunId
        && row.parentRelation?.startsWith('creator-edit:')
      ))
      expect(firstRow?.id).toBeDefined()
      const failed = await readAgentRunV1(fixture.scope, firstRow!.id!)
      expect(failed.projection.state).toBe('failed')
      expect(failed.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
      expect(failed.events.filter(event => event.type === 'model.responded')).toHaveLength(0)
      const requestEvent = failed.events.find(event => event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'rendered-request')
      const requestedEvent = failed.events.find(event => event.type === 'model.requested')
      const failureEvent = failed.events.find(event => event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'tool-result')
      expect(requestEvent?.type).toBe('evidence.artifact.recorded')
      expect(requestedEvent?.type).toBe('model.requested')
      expect(failureEvent?.type).toBe('evidence.artifact.recorded')
      if (requestEvent?.type !== 'evidence.artifact.recorded'
        || requestedEvent?.type !== 'model.requested'
        || failureEvent?.type !== 'evidence.artifact.recorded') {
        throw new Error('模型失败缺少精确 request/requested/tool-result 证据')
      }
      expect(requestEvent.sequence).toBeLessThan(requestedEvent.sequence)
      expect(requestedEvent.sequence).toBeLessThan(failureEvent.sequence)
      expect(JSON.parse(await readAgentRunArtifactExactV1({
        projectId: fixture.scope.projectId,
        artifactKind: 'tool-result',
        contentHash: failureEvent.payload.contentHash,
      }))).toEqual({
        schema: 'storyforge.text-open-world-creator-edit-model-failure',
        version: 1,
        provider: 'custom',
        model: 'fixture-formal-model',
        phase: scenario.phase,
        responseStatus: scenario.status,
        failureCode: scenario.failureCode,
        retryable: scenario.retryable,
        usageKnown: false,
        usage: null,
      })
      expect(failed.events.filter(event => event.type === 'memory.settlement.recorded'))
        .toHaveLength(1)
      expect(failed.projection.memorySettlement).toMatchObject({
        state: 'incomplete',
        terminalReceiptHash: null,
      })
      expect(failed.events.find(event => event.type === 'step.failed')).toMatchObject({
        payload: {
          stepId: 'text-open-world:creator-artifact-edit',
          attempt: 1,
          code: scenario.failureCode,
          retryable: scenario.retryable,
          category: scenario.category,
          action: 'fail',
        },
      })
      expect(failed.events.find(event => event.type === 'run.failed')).toMatchObject({
        payload: { code: scenario.failureCode, retryable: scenario.retryable },
      })
      const stepFailed = failed.events.find(event => event.type === 'step.failed')!
      const runFailed = failed.events.find(event => event.type === 'run.failed')!
      const settlement = failed.events.find(event => event.type === 'memory.settlement.recorded')!
      expect(failureEvent.sequence).toBeLessThan(stepFailed.sequence)
      expect(stepFailed.sequence).toBeLessThan(runFailed.sequence)
      expect(runFailed.sequence).toBeLessThan(settlement.sequence)
      expect(await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)).toBeNull()

      formalAIRuntime.execute.mockResolvedValueOnce(modelOutput(fixture))
      const replacement = await generateTextOpenWorldCreatorArtifactEditCandidateV1(request)
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(2)
      expect(replacement.snapshot.run.id).not.toBe(failed.run.id)
      expect(replacement.snapshot.run.parentRelation)
        .toBe(`${failed.run.parentRelation}:replacement:${failed.run.id}`)
      expect(replacement.snapshot.contract.runtimeBindingHash)
        .toBe(failed.contract.runtimeBindingHash)
      expect(replacement.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(await businessRows(fixture)).toEqual(before)
    })
  })

  it('正式 AI dispatch 后 network error 才暂停为 unknown；放弃后同文重试仅新调用一次', async () => {
    await withFixtureBrowserLocks(async () => {
      const fixture = await seedHarnessFixture()
      const before = await businessRows(fixture)
      const request = {
        selection: fixture.selection,
        mode: 'agent' as const,
        authorInstruction: '用正式模型把摘要写得更紧张，保持这条指令完全不变。',
        aiConfig: FORMAL_AI_CONFIG,
      }
      formalAIRuntime.execute.mockImplementationOnce(async (...args: unknown[]) => {
        const result = args[4] as {
          requestLifecycle?: {
            phase: 'pre-dispatch' | 'request-dispatched' | 'response-observed'
            responseStatus: number | null
          }
        }
        result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
        throw new Error('fixture:network-after-dispatch')
      })

      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1(request))
        .rejects.toThrow('fixture:network-after-dispatch')
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(1)
      const blocker = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
      expect(blocker).toMatchObject({ kind: 'model-outcome-unknown', runState: 'paused' })
      if (!blocker || !('kind' in blocker)) throw new Error('期待 dispatch 后 unknown blocker')
      expect(blocker.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
      expect(blocker.snapshot.events.some(event => event.type === 'memory.settlement.recorded'))
        .toBe(false)

      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1(request))
        .rejects.toThrow(/不会自动重发|model-outcome-unknown|暂停|不可安全重发/)
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(1)
      const abandoned = await abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
        selection: fixture.selection,
        runId: blocker.runId,
        acknowledgePossibleCharge: true,
      })
      expect(abandoned.projection.state).toBe('cancelled')
      expect(abandoned.projection.memorySettlement?.state).toBe('incomplete')

      formalAIRuntime.execute.mockResolvedValueOnce(modelOutput(fixture))
      const replacement = await generateTextOpenWorldCreatorArtifactEditCandidateV1(request)
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(2)
      expect(replacement.snapshot.run.parentRelation)
        .toBe(`${abandoned.run.parentRelation}:replacement:${abandoned.run.id}`)
      expect(replacement.snapshot.contract.runtimeBindingHash)
        .toBe(abandoned.contract.runtimeBindingHash)
      expect(replacement.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(await businessRows(fixture)).toEqual(before)
    })
  })

  it('正式 AI 已观察到 2xx 但响应正文/usage 未形成 durable 结果时仍标记 unknown，不猜测成功或失败', async () => {
    await withFixtureBrowserLocks(async () => {
      const fixture = await seedHarnessFixture()
      formalAIRuntime.execute.mockImplementationOnce(async (...args: unknown[]) => {
        const result = args[4] as {
          requestLifecycle?: {
            phase: 'pre-dispatch' | 'request-dispatched' | 'response-observed'
            responseStatus: number | null
          }
        }
        result.requestLifecycle = { phase: 'response-observed', responseStatus: 200 }
        throw new Error('fixture:2xx-body-outcome-unknown')
      })
      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
        selection: fixture.selection,
        mode: 'agent',
        authorInstruction: '形成 2xx 但正文读取失败的结果未知场景。',
        aiConfig: FORMAL_AI_CONFIG,
      })).rejects.toThrow('fixture:2xx-body-outcome-unknown')

      const blocker = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
      expect(blocker).toMatchObject({ kind: 'model-outcome-unknown', runState: 'paused' })
      if (!blocker || !('kind' in blocker)) throw new Error('期待结果未知 blocker')
      const snapshot = await readAgentRunV1(fixture.scope, blocker.runId)
      expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
      expect(snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'tool-result')).toHaveLength(0)
      expect(snapshot.events.filter(event => event.type === 'run.failed')).toHaveLength(0)
      expect(formalAIRuntime.execute).toHaveBeenCalledTimes(1)
    })
  })

  it('放弃结果未知 Run 必须匹配精确 selection 并显式确认可能计费', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '创建一个结果未知请求。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: boundary => {
        if (boundary === 'model.requested') throw new Error('interrupt:model.requested')
      },
    })).rejects.toThrow('interrupt:model.requested')
    const blocker = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    if (!blocker || !('kind' in blocker)) throw new Error('期待结果未知 blocker')

    await expect(abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
      selection: fixture.selection,
      runId: blocker.runId,
      acknowledgePossibleCharge: false as true,
    })).rejects.toThrow(/明确确认可能已经计费/)
    await expect(abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
      selection: {
        ...fixture.selection,
        expectedSnapshotHash: 'f'.repeat(64),
      },
      runId: blocker.runId,
      acknowledgePossibleCharge: true,
    })).rejects.toThrow(/目标治理快照已变化/)
    const unchanged = await readAgentRunV1(fixture.scope, blocker.runId)
    expect(unchanged.projection.state).toBe('running')
    expect(unchanged.events.some(event => event.type === 'run.cancelled')).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('已持久化模型结果的 Run 不能伪装成结果未知后放弃', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '完整生成一个有 durable result 的候选。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })

    await expect(abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      acknowledgePossibleCharge: true,
    })).rejects.toThrow(/只有唯一请求已发出且没有任何结果证据/)
    const unchanged = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
    expect(unchanged.projection.state).toBe('awaiting_confirmation')
    expect(unchanged.events.some(event => event.type === 'run.cancelled')).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('确认要求精确 warning 集，完成后只有 intent 与两层 receipt，正式 Build/Artifact/Production 不变', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })

    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: ['tow.edit.not-present'],
    })).rejects.toThrow(/精确确认全部 warning/)
    expect((await readAgentRunV1(fixture.scope, generated.snapshot.run.id)).projection.state)
      .toBe('awaiting_confirmation')

    const confirmed = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
      confirmedAt: Date.now() + 1,
    })
    expect(confirmed.snapshot.projection.state).toBe('completed')
    expect(confirmed.intent.candidateHash).toBe(generated.candidate.candidateHash)
    expect(confirmed.terminalReceipt.status).toBe('impact-plan-required')
    expect(confirmed.verificationReceipt.postStateHash).toBe(confirmed.terminalReceipt.receiptHash)
    expect(confirmed.verificationReceipt.adoptionEventIds).toEqual([])
    expect(confirmed.snapshot.events.some(event => event.type.startsWith('adoption.'))).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)

    const reread = await readTextOpenWorldCreatorArtifactEditHandoffV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
    })
    expect(reread.intent.intentHash).toBe(confirmed.intent.intentHash)
    expect(reread.terminalReceipt.receiptHash).toBe(confirmed.terminalReceipt.receiptHash)
    expect(reread.verificationReceipt.receiptHash).toBe(confirmed.verificationReceipt.receiptHash)
  })

  it('intent checkpoint 与 confirmation 已原子持久化后中断，重载会自动收口为完整 handoff', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
      onDurableBoundary: boundary => {
        if (boundary === 'confirmation.recorded') {
          throw new Error('interrupt:intent-checkpoint-and-confirmation')
        }
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:intent-checkpoint-and-confirmation/)

    const interrupted = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
    expect(interrupted.projection.state).toBe('running')
    expect(interrupted.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(interrupted.events.some(event => event.type === 'step.succeeded')).toBe(false)
    const checkpoints = await db.agentRunCheckpoints
      .where('runId').equals(generated.snapshot.run.id)
      .sortBy('throughSequence')
    const latestPayload = JSON.parse(
      checkpoints[checkpoints.length - 1]!.resumePayloadJson!,
    ) as { phase: string }
    expect(latestPayload.phase).toBe('intent')

    const restored = await readLatestTextOpenWorldCreatorArtifactEditStateV1(fixture.selection)
    expect(restored).not.toBeNull()
    expect(restored).not.toHaveProperty('kind')
    if (!restored || 'kind' in restored) throw new Error('期待重载后自动收口 intent handoff')
    expect(restored.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(restored.snapshot.projection.state).toBe('completed')
    expect(restored.intent?.candidateHash).toBe(generated.candidate.candidateHash)
    expect(restored.terminalReceipt?.status).toBe('impact-plan-required')
    expect(restored.verificationReceipt?.receiptHash)
      .toBe(restored.snapshot.projection.terminalReceiptHash)
    expect(restored.snapshot.events.filter(event => event.type === 'confirmation.recorded'))
      .toHaveLength(1)
    expect(restored.snapshot.events.filter(event => event.type === 'verification.accepted'))
      .toHaveLength(1)
    expect(restored.snapshot.events.filter(event => event.type === 'memory.settlement.recorded'))
      .toHaveLength(1)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('作者对 Agent 候选的连续修订保留原始模型证据，并形成可复核的 revision provenance 链', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    let calls = 0
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '先把摘要改得更有冒险感。',
      runAI: async () => {
        calls += 1
        return modelOutput(fixture)
      },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })
    const firstRevision = await reviseTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      operations: [operation(fixture, '作者第一次复核后的摘要')],
    })
    expect(firstRevision.candidate.revisionProvenance).toEqual({
      source: 'deterministic-author-revision',
      originCandidateHash: generated.candidate.candidateHash,
      originPatchHash: generated.candidate.patch.patchHash,
      previousCandidateHash: generated.candidate.candidateHash,
      revisionPatchHash: firstRevision.candidate.patch.patchHash,
      revisedAt: firstRevision.candidate.createdAt,
    })
    expect(firstRevision.candidate.modelEvidence).toEqual(generated.candidate.modelEvidence)
    expect(firstRevision.candidate.modelUsage).toEqual(generated.candidate.modelUsage)

    const secondRevision = await reviseTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      operations: [operation(fixture, '作者最终复核后的摘要')],
    })
    expect(secondRevision.candidate.revisionProvenance).toMatchObject({
      originCandidateHash: generated.candidate.candidateHash,
      originPatchHash: generated.candidate.patch.patchHash,
      previousCandidateHash: firstRevision.candidate.candidateHash,
      revisionPatchHash: secondRevision.candidate.patch.patchHash,
    })
    expect(secondRevision.snapshot.events.filter(event => event.type === 'candidate.revised'))
      .toHaveLength(2)
    expect(calls).toBe(1)

    const confirmed = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    expect(confirmed.intent.candidate.revisionProvenance)
      .toEqual(secondRevision.candidate.revisionProvenance)
    expect(confirmed.intent.candidate.modelEvidence).toEqual(generated.candidate.modelEvidence)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('任一 exact 模型结果 Artifact 被篡改后，确认阶段拒绝整条证据链且不写正式表', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '把摘要改得更有冒险感。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })
    const before = await businessRows(fixture)
    const resultEvent = generated.snapshot.events.find(event => (
      event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result'
    ))
    expect(resultEvent?.type).toBe('evidence.artifact.recorded')
    const resultHash = resultEvent?.type === 'evidence.artifact.recorded'
      ? resultEvent.payload.contentHash
      : ''
    const resultArtifact = await db.agentRunArtifacts
      .where('[projectId+artifactKind+contentHash]')
      .equals([fixture.scope.projectId, 'tool-result', resultHash])
      .first()
    expect(resultArtifact?.id).toBeDefined()
    await db.agentRunArtifacts.update(resultArtifact!.id!, {
      content: `${resultArtifact!.content} `,
    })

    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })).rejects.toThrow(/corrupt|exact artifact/i)
    expect((await readAgentRunV1(fixture.scope, generated.snapshot.run.id)).projection.state)
      .toBe('awaiting_confirmation')
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('历史 origin candidate checkpoint 被篡改后，修订 provenance 不能冒充完整证据链', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    await reviseTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      operations: [operation(fixture, '作者修订后的摘要')],
    })
    const before = await businessRows(fixture)
    const checkpoints = await db.agentRunCheckpoints
      .where('runId').equals(generated.snapshot.run.id)
      .sortBy('throughSequence')
    expect(checkpoints.length).toBeGreaterThanOrEqual(2)
    const origin = checkpoints.find(checkpoint => {
      const payload = JSON.parse(checkpoint.resumePayloadJson!) as { phase?: unknown }
      return payload.phase === 'candidate'
    })!
    expect(origin).toBeDefined()
    const payload = JSON.parse(origin.resumePayloadJson!) as {
      phase: string
      candidate: { patch: { operations: Array<{ value: unknown }> } }
    }
    expect(payload.phase).toBe('candidate')
    payload.candidate.patch.operations[0]!.value = '被篡改的历史候选'
    await db.agentRunCheckpoints.update(origin.id!, {
      resumePayloadJson: canonicalProductProductionJsonV2(payload),
    })

    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })).rejects.toThrow(/原始 Candidate|candidate-lineage/)
    expect((await readAgentRunV1(fixture.scope, generated.snapshot.run.id)).projection.state)
      .toBe('awaiting_confirmation')
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('作者拒绝候选会确定性终止，不产生 intent、receipt 或业务写入', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    const rejected = await rejectTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
    })
    expect(rejected.projection.state).toBe('cancelled')
    expect(rejected.projection.terminalReceiptHash ?? null).toBeNull()
    expect(rejected.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(rejected.events.some(event => event.type === 'verification.accepted')).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('同一 request 复用唯一父 relation 与同一候选，不创建第二个 child Run', async () => {
    const fixture = await seedHarnessFixture()
    const request = {
      selection: fixture.selection,
      mode: 'direct' as const,
      operations: [operation(fixture)],
    }
    const first = await generateTextOpenWorldCreatorArtifactEditCandidateV1(request)
    const second = await generateTextOpenWorldCreatorArtifactEditCandidateV1(request)
    expect(second.snapshot.run.id).toBe(first.snapshot.run.id)
    expect(second.candidate.candidateHash).toBe(first.candidate.candidateHash)
    const children = (await db.agentRuns.toArray()).filter(row => (
      row.parentRunId === fixture.parentRunId && row.parentRelation?.startsWith('creator-edit:')
    ))
    expect(children).toHaveLength(1)
    expect(children[0]!.parentRelation).toBe(first.snapshot.run.parentRelation)
  })

  it('同组 confirm(A) 先落盘时，agent-generate(B) 在模型请求前被拒绝', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const candidateA = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture, '候选 A 的摘要')],
    })
    const confirmedA = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: candidateA.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    expect(confirmedA.snapshot.projection.state).toBe('completed')

    let rejectedModelCalls = 0
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '候选 B 试图在 A 确认后修改同一 sibling group。',
      runAI: async () => {
        rejectedModelCalls += 1
        return modelOutput(fixture, '候选 B 的摘要')
      },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })).rejects.toThrow(/competing-intent|已确认修改|影响分析/)
    expect(rejectedModelCalls).toBe(0)
    const rereadA = await readTextOpenWorldCreatorArtifactEditHandoffV1({
      scope: fixture.scope,
      runId: candidateA.snapshot.run.id,
    })
    expect(rereadA.intent.intentHash).toBe(confirmedA.intent.intentHash)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('同组目标 A 的 unknown 结果优先阻塞目标 B 的较新 intake，不能被精确目标过滤绕过', async () => {
    const fixture = await seedHarnessFixture()
    let unknownRunId: number | null = null
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '让目标 A 形成模型结果未知状态。',
      runAI: async () => { throw new Error('fixture:group-unknown-a') },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: (boundary, snapshot) => {
        if (boundary === 'model.requested') unknownRunId = snapshot.run.id
      },
    })).rejects.toThrow('fixture:group-unknown-a')

    const selectionB = await retargetFixtureWithinOwnerSiblingGroup(
      fixture,
      'story:text-open-world.story-arc.secondary',
    )
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: selectionB,
      mode: 'agent',
      authorInstruction: '目标 B 建立较新的 intake，但不能覆盖同组 A 的未知结果。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: boundary => {
        if (boundary === 'intake.checkpoint') throw new Error('interrupt:group-intake-b')
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:group-intake-b/)

    await expect(readLatestTextOpenWorldCreatorArtifactEditStateV1(selectionB))
      .resolves.toMatchObject({
        kind: 'model-outcome-unknown',
        runId: unknownRunId,
      })
  })

  it('同组目标 A 的已确认 intent 优先阻塞目标 B，直到完成影响分析', async () => {
    const fixture = await seedHarnessFixture()
    const candidateA = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture, '目标 A 已确认的摘要')],
    })
    const completedA = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: candidateA.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    const selectionB = await retargetFixtureWithinOwnerSiblingGroup(
      fixture,
      'story:text-open-world.story-arc.secondary',
    )
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: selectionB,
      mode: 'agent',
      authorInstruction: '目标 B 只能先留下 intake。',
      runAI: async () => modelOutput(fixture),
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: boundary => {
        if (boundary === 'intake.checkpoint') throw new Error('interrupt:impact-intake-b')
      },
    })).rejects.toThrow(/durable boundary callback|interrupt:impact-intake-b/)

    await expect(readLatestTextOpenWorldCreatorArtifactEditStateV1(selectionB))
      .resolves.toMatchObject({
        kind: 'impact-analysis-pending',
        runId: completedA.snapshot.run.id,
        runState: 'completed',
        ownerTaskKey: TASK_KEY,
      })
  })

  it('agent-generate(B) 先取得同组模型请求权时，并发 confirm(A) 被互斥且 A 不产生模型证据', async () => {
    const fixture = await seedHarnessFixture()
    const before = await businessRows(fixture)
    const candidateA = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture, '候选 A 的摘要')],
    })

    let signalModelStarted!: () => void
    const modelStarted = new Promise<void>(resolve => { signalModelStarted = resolve })
    let releaseModel!: (raw: string) => void
    const modelGate = new Promise<string>(resolve => { releaseModel = resolve })
    let modelCalls = 0
    const candidateBPromise = generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '候选 B 先取得同一 sibling group 的生成权。',
      runAI: async () => {
        modelCalls += 1
        signalModelStarted()
        return modelGate
      },
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
    })
    const modelStartOutcome = await Promise.race([
      modelStarted.then(() => 'started' as const),
      candidateBPromise.then(() => 'settled' as const, () => 'settled' as const),
    ])
    if (modelStartOutcome !== 'started') {
      releaseModel(modelOutput(fixture, '候选 B 的摘要'))
      await Promise.allSettled([candidateBPromise])
      expect(modelStartOutcome).toBe('started')
      return
    }
    const confirmAPromise = confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: candidateA.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    await Promise.resolve()
    releaseModel(modelOutput(fixture, '候选 B 的摘要'))

    const [candidateBResult, confirmAResult] = await Promise.allSettled([
      candidateBPromise,
      confirmAPromise,
    ])
    expect(candidateBResult.status).toBe('fulfilled')
    expect(confirmAResult.status).toBe('rejected')
    if (confirmAResult.status !== 'rejected') throw new Error('期待 confirm(A) 被同组 B 互斥')
    expect(String(confirmAResult.reason)).toMatch(/competing|sibling|修改候选|生成/)
    expect(modelCalls).toBe(1)

    const unchangedA = await readAgentRunV1(fixture.scope, candidateA.snapshot.run.id)
    expect(unchangedA.projection.state).toBe('awaiting_confirmation')
    expect(unchangedA.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
    expect(unchangedA.events.some(event => event.type === 'model.requested')).toBe(false)
    if (candidateBResult.status !== 'fulfilled') throw new Error('期待 candidate B 生成成功')
    expect(candidateBResult.value.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(candidateBResult.value.snapshot.events.filter(event => event.type === 'model.requested'))
      .toHaveLength(1)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it.each([
    { boundary: 'confirmation.recorded' as const, state: 'running' },
    { boundary: 'verification.checkpoint' as const, state: 'verifying' },
  ])('G5-07 list 遇到同组已 adopt 但仍为 $state 的 Run 时 fail closed', async scenario => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
      onDurableBoundary: boundary => {
        if (boundary === scenario.boundary) throw new Error(`interrupt:${scenario.boundary}`)
      },
    })).rejects.toThrow(new RegExp(`durable boundary callback|interrupt:${scenario.boundary}`))
    const interrupted = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
    expect(interrupted.projection.state).toBe(scenario.state)
    expect(interrupted.projection.steps['text-open-world:creator-artifact-edit']?.confirmation)
      .toBe('adopt')

    await expect(listTextOpenWorldCreatorArtifactEditHandoffsV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })).rejects.toThrow(/handoff-list|已确认|未完成|非终态|running|verifying|影响分析/)
  })

  it('G5-07 list 拒绝缺失终态 memory settlement 事件的 completed handoff', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    const completed = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    const settlement = await db.agentRunEvents.where('runId').equals(completed.snapshot.run.id)
      .filter(row => row.type === 'memory.settlement.recorded').first()
    expect(settlement?.id).toBeDefined()
    await db.agentRunEvents.delete(settlement!.id!)

    await expect(listTextOpenWorldCreatorArtifactEditHandoffsV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })).rejects.toThrow(/handoff-list|memory|settlement|结算|投影|事件/)
  })

  it('G5-07 list 拒绝被篡改的终态 memory settlement 证据', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    const completed = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })
    const settlement = await db.agentRunEvents.where('runId').equals(completed.snapshot.run.id)
      .filter(row => row.type === 'memory.settlement.recorded').first()
    expect(settlement?.id).toBeDefined()
    const payload = JSON.parse(settlement!.payloadJson) as Record<string, unknown>
    payload.receiptHash = 'f'.repeat(64)
    await db.agentRunEvents.update(settlement!.id!, {
      payloadJson: canonicalProductProductionJsonV2(payload),
    })

    await expect(listTextOpenWorldCreatorArtifactEditHandoffsV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })).rejects.toThrow(/handoff-list|memory|settlement|结算|投影|篡改|hash/i)
  })

  it('作者确认前治理快照发生变化会 fail closed，旧候选仍保持待确认且正式表不变', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    const before = await businessRows(fixture)
    mockRuntime.workspace.targetContext.governanceSnapshotHash = await hashProductProductionValueV2({
      fixture: 'creator-artifact-edit-harness-new-governance-snapshot',
      buildId: fixture.buildId,
    })
    mockRuntime.workspaces = [structuredClone(mockRuntime.workspace)]
    mockRuntime.contextJson = canonicalProductProductionJsonV2(mockRuntime.workspace.targetContext)

    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })).rejects.toThrow(/治理快照已变化/)
    const snapshot = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
    expect(snapshot.projection.state).toBe('awaiting_confirmation')
    expect(snapshot.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
    expect(await businessRows(fixture)).toEqual(before)
  })

  it('模型调用权只在 ProductProduction/ProductBuild 同事务 CAS 成功后记录', async () => {
    const fixture = await seedHarnessFixture()
    const runAI = vi.fn(async () => modelOutput(fixture))
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'agent',
      authorInstruction: '在 request 留证后模拟 Build 权威漂移。',
      runAI,
      modelIdentity: { provider: 'fixture', model: 'fixture-model' },
      onDurableBoundary: async boundary => {
        if (boundary === 'request.recorded') {
          await db.productBuilds.update(fixture.buildId, { stateRevision: 10 })
        }
      },
    })).rejects.toThrow(/base-stale|ProductProduction\/ProductBuild|权威已变化/)
    expect(runAI).not.toHaveBeenCalled()
    const child = (await db.agentRuns.toArray()).find(row => (
      row.parentRunId === fixture.parentRunId && row.parentRelation?.startsWith('creator-edit:')
    ))
    expect(child?.id).toBeDefined()
    const snapshot = await readAgentRunV1(fixture.scope, child!.id!)
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
  })

  it('作者确认权只在 ProductProduction/ProductBuild 同事务 CAS 成功后记录', async () => {
    const fixture = await seedHarnessFixture()
    const generated = await generateTextOpenWorldCreatorArtifactEditCandidateV1({
      selection: fixture.selection,
      mode: 'direct',
      operations: [operation(fixture)],
    })
    await db.productBuilds.update(fixture.buildId, { stateRevision: 10 })
    await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
      selection: fixture.selection,
      runId: generated.snapshot.run.id,
      warningAcknowledgementCodes: [],
    })).rejects.toThrow(/base-stale|ProductProduction\/ProductBuild|权威已变化/)
    const snapshot = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
    expect(snapshot.projection.state).toBe('awaiting_confirmation')
    expect(snapshot.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(0)
  })
})
