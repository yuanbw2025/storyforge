export const NARRATIVE_MODULE_KINDS = ['main', 'side', 'quest', 'opening', 'free'] as const
export type NarrativeModuleKind = typeof NARRATIVE_MODULE_KINDS[number]

export const NARRATIVE_NODE_KINDS = ['entry', 'scene', 'choice', 'ending'] as const
export type NarrativeNodeKind = typeof NARRATIVE_NODE_KINDS[number]

export interface NarrativeModule {
  id?: number
  projectId: number
  worldId?: number | null
  workId?: number | null
  kind: NarrativeModuleKind
  title: string
  description: string
  status: 'draft' | 'ready' | 'archived'
  sourceProjection: 'story-arc' | 'outline' | 'custom'
  sourceRefId?: number | null
  entryNodeKey?: string | null
  createdAt: number
  updatedAt: number
}

export interface NarrativeNode {
  id?: number
  projectId: number
  moduleId: number
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeysJson: string
  sourceOutlineNodeId?: number | null
  order: number
  createdAt: number
  updatedAt: number
}

export interface NarrativeReachabilityReport {
  valid: boolean
  entryKey: string | null
  reachableKeys: string[]
  unreachableKeys: string[]
  danglingSuccessors: Array<{ nodeKey: string; successorKey: string }>
  errors: string[]
}

export type NarrativeScalar = string | number | boolean | null

export type NarrativeCondition = Record<string, never> | {
  all: NarrativeCondition[]
} | {
  any: NarrativeCondition[]
} | {
  not: NarrativeCondition
} | {
  path: string
  exists: boolean
} | {
  path: string
  eq: NarrativeScalar
} | {
  path: string
  in: NarrativeScalar[]
} | {
  visited: string
} | {
  selected: string
}

export type NarrativeEffect = {
  op: 'set'
  path: string
  value: unknown
} | {
  op: 'increment'
  path: string
  value: number
} | {
  op: 'unset'
  path: string
}

export interface NarrativeExecutionStep {
  node: NarrativeNode
  state: Record<string, unknown>
  successorNodes: NarrativeNode[]
}
