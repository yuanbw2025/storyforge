import type { PromptModuleKey } from '../types/prompt'
import type { CreativeArtifactV1 } from '../agent/creative-reliability'

/**
 * FLOW-3 graph contract.
 *
 * This model describes the authoring surface only. Canon fields, context sources,
 * adoption targets and table lifecycles remain owned by the three registries.
 */
export const AUTHORING_GRAPH_VERSION = 2 as const

export const AUTHORING_NODE_CLASSES = [
  'content',
  'processor',
  'control',
  'output',
] as const

export type AuthoringNodeClass = typeof AUTHORING_NODE_CLASSES[number]

export const AUTHORING_EXECUTION_CAPABILITIES = [
  'read-canon',
  'manual-draft',
  'generate-field',
  'generate-collection',
  'transform',
  'validate',
  'adopt',
] as const

export type AuthoringExecutionCapability = typeof AUTHORING_EXECUTION_CAPABILITIES[number]

export const AUTHORING_CARDINALITIES = ['one', 'many'] as const
export type AuthoringCardinality = typeof AUTHORING_CARDINALITIES[number]

export const AUTHORING_PORT_STATES = ['canon', 'draft', 'candidate', 'control', 'any'] as const
export type AuthoringPortState = typeof AUTHORING_PORT_STATES[number]

/**
 * Semantic values are intentionally finite. New values must be added here and to
 * the compatibility tests before a catalog entry can expose them.
 */
export const AUTHORING_SEMANTICS = [
  'any',
  'text',
  'world.setting',
  'world.location',
  'world.history',
  'world.rule',
  'story.theme',
  'story.conflict',
  'story.arc',
  'character.profile',
  'character.list',
  'character.relation',
  'outline.volume',
  'outline.chapter',
  'outline.plan',
  'chapter.prose',
  'continuity.foreshadow',
  'continuity.location',
  'continuity.state',
  'continuity.item',
  'continuity.fact',
  'continuity.knowledge',
  'continuity.timeline',
  'continuity.report',
  'control.ai-profile',
  'control.prompt',
  'control.temperature',
  'control.max-tokens',
  'control.word-count',
  'control.count',
  'control.volume-count',
  'control.chapter-count',
  'control.context-budget',
  'candidate',
] as const

export type AuthoringSemantic = typeof AUTHORING_SEMANTICS[number]

export interface AuthoringPortContract {
  semantic: AuthoringSemantic
  cardinality: AuthoringCardinality
  state: AuthoringPortState
  /** Human-facing label; this is not a source of truth for data fields. */
  label: string
}

export interface AuthoringPortDefinition extends AuthoringPortContract {
  id: string
  required?: boolean
  multiple?: boolean
  priority?: number
  maxTokens?: number
}

export interface AuthoringReadContract {
  /** Keys must resolve in CONTEXT_SOURCES at runtime and in catalog checks. */
  sourceKeys: string[]
  /** Stable RAG fields can be selected without copying Canon content. */
  allowExactFields?: boolean
}

export interface AuthoringWriteContract {
  target: string
  /** Empty means collection-level AdoptionSchema validation owns the shape. */
  fields?: string[]
  mode: 'replace' | 'add' | 'add-many' | 'merge-diffs'
}

export interface AuthoringParameterDefinition {
  key: string
  label: string
  type: 'number' | 'text' | 'select' | 'boolean'
  min?: number
  max?: number
  step?: number
  options?: string[]
  defaultValue?: string | number | boolean
}

export interface AuthoringNodeTemplate {
  id: string
  version: 1
  label: string
  description: string
  category: string
  class: AuthoringNodeClass
  capability: AuthoringExecutionCapability
  inputs: AuthoringPortDefinition[]
  outputs: AuthoringPortDefinition[]
  reads?: AuthoringReadContract
  writes?: AuthoringWriteContract
  promptModuleKey?: PromptModuleKey
  parameters?: AuthoringParameterDefinition[]
  /** Semantic suggestions for the smart connection menu. */
  recommendedBefore?: string[]
  recommendedAfter?: string[]
}

export interface AuthoringStableRecordRef {
  /** Portable RAG document ID where available. */
  documentId?: string
  fieldKey?: string
  /** A future table-specific stable key; numeric Dexie IDs are deliberately absent. */
  recordKey?: string
  target?: string
}

export interface AuthoringNodeBinding {
  mode: 'live' | 'snapshot' | 'draft'
  ref?: AuthoringStableRecordRef
  sourceHash?: string
  capturedAt?: number
}

export interface AuthoringNodeInstance {
  id: string
  templateId: string
  templateVersion: 1
  title: string
  x: number
  y: number
  config: Record<string, unknown>
  inputs: AuthoringPortDefinition[]
  outputs: AuthoringPortDefinition[]
  binding?: AuthoringNodeBinding
  disabled?: boolean
  collapsed?: boolean
  locked?: boolean
  groupId?: string
  note?: string
  favorite?: boolean
  lastOpenedAt?: number
}

export interface AuthoringEdgeMapping {
  mode: 'full' | 'fields' | 'summary' | 'items' | 'snapshot'
  fields?: string[]
  priority?: number
  maxTokens?: number
  missingPolicy?: 'block' | 'empty' | 'last-success'
  refreshPolicy?: 'live' | 'manual' | 'frozen'
}

export interface AuthoringEdge {
  id: string
  sourceNodeId: string
  sourcePortId: string
  targetNodeId: string
  targetPortId: string
  mapping?: AuthoringEdgeMapping
}

export interface AuthoringViewport {
  x: number
  y: number
  zoom: number
}

export interface AuthoringNodeGraph {
  version: typeof AUTHORING_GRAPH_VERSION
  nodes: AuthoringNodeInstance[]
  edges: AuthoringEdge[]
  viewport: AuthoringViewport
  groups?: Array<{ id: string; title: string; color?: string }>
}

export interface AuthoringInputEnvelope {
  sourceNodeId: string
  sourcePortId: string
  targetPortId: string
  semantic: AuthoringSemantic
  cardinality: AuthoringCardinality
  state: AuthoringPortState
  content: string
  sourceHash?: string
  tokens: number
  included?: string[]
  omitted?: string[]
  trimmed?: string[]
}

export interface AuthoringRunSignature {
  nodeConfigHash: string
  upstreamHash: string
  sourceHash: string
  /** Hash of the exact Canon target when a single-field write can be verified. */
  targetHash?: string
  promptVersion?: string
  aiPresetId?: string
  executorVersion: string
}

export interface AuthoringCandidate {
  nodeId: string
  status: 'draft' | 'candidate' | 'blocked' | 'adopted' | 'stale'
  output: string
  /** Multiple generations remain grouped under one node so the run record is still portable. */
  variants?: string[]
  /** CREL evidence is aligned with variants by index when this node uses the creative-reliability pipeline. */
  creativeArtifacts?: CreativeArtifactV1[]
  /** Stable selection for edited variants whose text no longer exactly matches the original output. */
  selectedVariantIndex?: number
  /** The author changed the editable draft after the recorded model artifact was produced. */
  authorEditedAfterArtifact?: boolean
  semantic: AuthoringSemantic
  signature?: AuthoringRunSignature
  /** 领域候选的结构化目标与快照；只保存稳定语义，正文仍留在 Canon 表。 */
  domain?: AuthoringCandidateDomain
  errors?: string[]
  createdAt: number
}

export type AuthoringCandidateDomain =
  | {
      kind: 'worldview-field'
      targetField: string
      snapshot: import('../agent/worldview-field-copilot').WorldviewFieldCopilotSnapshot
    }
  | {
      kind: 'story-core-field'
      targetField: string
      snapshot: import('../agent/story-core-copilot').StoryCoreCopilotSnapshot
    }
  | {
      kind: 'character-supplement'
      snapshot: import('../agent/character-supplement-copilot').CharacterSupplementCopilotSnapshotV1
    }
  | {
      kind: 'story-arc'
      snapshot: import('../agent/story-arc-copilot').StoryArcCopilotSnapshot
      mutation: import('../agent/story-arc-copilot').StoryArcMutationRequestV1
    }
  | {
      kind: 'character-relation'
      producerRunId: number
      candidateHash: string
      candidateCount: number
    }
  | {
      kind: 'character'
      rosterSnapshot: string
    }
  | {
      kind: 'outline'
      mode: 'volumes' | 'chapters'
      parentVolumeId: number | null
      snapshot: {
        serialized: string
        existingTitles: string[]
        startingOrder: number
      }
    }
  | {
      kind: 'detail'
      outlineNodeId: number
      chapterSummary: string
    }
  | {
      kind: 'prose'
      operation: 'generate' | 'continue'
      outlineNodeId: number
      snapshot: {
        outlineNodeId: number
        outlineUpdatedAt: number
        chapterId: number | null
        chapterUpdatedAt: number | null
        chapterContentHash: string
        chapterHadContent: boolean
        chapterOrder: number
        perspectiveCharacterId: number | null
        informationBoundaryHash: string
        perspectiveFromChapter: boolean
      }
    }
  | {
      /** FLOW-3D/PROGRESS-1：章节正文后的七域整理候选；正文证据和来源 hash 一并冻结。 */
      kind: 'chapter-organization'
      chapterId: number
      chapterTitle: string
      sourceTextHash: string
      candidateJson: string
    }
  | {
      /** FLOW-3D：事实节点复用 FACT_PREDICATE_REGISTRY 与事实账本扩展。 */
      kind: 'facts'
      chapterId: number
      sourceTextHash: string
      candidateJson: string
    }

export function isAuthoringSemantic(value: unknown): value is AuthoringSemantic {
  return typeof value === 'string' && (AUTHORING_SEMANTICS as readonly string[]).includes(value)
}

export function emptyAuthoringGraph(): AuthoringNodeGraph {
  return {
    version: AUTHORING_GRAPH_VERSION,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
  }
}

/** Portable node documents and run evidence must never carry provider secrets. */
export function redactAuthoringSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuthoringSecrets)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    /api.?key|access.?token|refresh.?token|client.?secret|authorization/i.test(key)
      ? '[redacted]'
      : typeof item === 'string' && /Json$/i.test(key)
        ? redactAuthoringJsonString(item)
        : redactAuthoringSecrets(item),
  ]))
}

function redactAuthoringJsonString(value: string): string {
  try {
    return JSON.stringify(redactAuthoringSecrets(JSON.parse(value)))
  } catch {
    return value
  }
}

export function safeAuthoringGraphJson(graphJson: string): string {
  try {
    return JSON.stringify(redactAuthoringSecrets(JSON.parse(graphJson)))
  } catch {
    // Keep malformed drafts recoverable; graph validation reports the parse error at run time.
    return graphJson
  }
}
