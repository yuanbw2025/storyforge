import {
  acceptAgentRunContractV1,
  allocateInMemoryAgentRunIdV1,
  createContextManifestFromAssemblyV1,
  createGenerationNodeShadowTraceV1,
  type GenerationNodeShadowTraceV1,
} from '../agent/run'
import type { AssembleContextResult } from '../registry/types'
import type { OutlineGenerationRequest } from './generation-request'
import { encodeGenerationOperation, outlineGenerationModuleKey } from './generation-request'

export const OUTLINE_GENERATION_SOURCE_KEYS = [
  'canonAssertions',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
] as const

function targetOutlineNodeId(request: OutlineGenerationRequest): number | undefined {
  if (request.kind === 'single-chapter') return request.chapterId
  if (request.kind === 'single-volume' || request.kind === 'chapters') return request.volumeId
  return undefined
}

function writeFields(request: OutlineGenerationRequest): string[] {
  if (request.kind === 'single-chapter' || request.kind === 'single-volume') return ['summary']
  return ['parentId', 'type', 'title', 'summary', 'order']
}

export async function createOutlineGenerationShadowTraceV1(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
}): Promise<GenerationNodeShadowTraceV1> {
  const runId = allocateInMemoryAgentRunIdV1()
  const stepId = encodeGenerationOperation(input.request)
  const outlineNodeId = targetOutlineNodeId(input.request)
  const acceptedContract = await acceptAgentRunContractV1({
    version: 1,
    objective: `生成${outlineGenerationModuleKey(input.request) === 'outline.volume' ? '卷纲' : '章纲'}候选：${stepId}`,
    workflowKind: 'direct-generation',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: outlineNodeId == null ? undefined : [outlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...OUTLINE_GENERATION_SOURCE_KEYS],
      writeTargets: [
        { table: 'outlineNodes', fields: writeFields(input.request), mode: 'candidate-only' },
      ],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: input.assembled.inputBudget,
      maxOutputTokens: 8_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'outline.output-present', kind: 'output-present', required: true },
    ],
    verificationPlan: [
      {
        id: 'outline.shadow-terminal',
        kind: 'terminal',
        verifier: 'shadow-output-presence-v1',
        criterionIds: ['outline.output-present'],
      },
    ],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId,
    stepId,
    attempt: 1,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: OUTLINE_GENERATION_SOURCE_KEYS,
    assembled: input.assembled,
    boundary: outlineNodeId == null ? undefined : { outlineNodeId },
    readerVersion: 'assemble-context-v1',
  })
  return createGenerationNodeShadowTraceV1({ runId, stepId, acceptedContract, manifest })
}
