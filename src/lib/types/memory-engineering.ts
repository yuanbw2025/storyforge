/** MEMORY-0: durable, versioned contracts for the author-triggered workspace flow. */

export const WORKSPACE_DOCUMENT_CODECS_V1 = [
  'markdown-frontmatter',
  'yaml',
  'json',
  'jsonl',
] as const
export type WorkspaceDocumentCodecV1 = typeof WORKSPACE_DOCUMENT_CODECS_V1[number]

export const WORKSPACE_DOCUMENT_EDIT_POLICIES_V1 = [
  'author-editable',
  'candidate-editable',
  'machine-readonly',
] as const
export type WorkspaceDocumentEditPolicyV1 = typeof WORKSPACE_DOCUMENT_EDIT_POLICIES_V1[number]

export const WORKSPACE_DOCUMENT_CHANGE_KINDS_V1 = [
  'clean',
  'project-changed',
  'file-changed',
  'same-change',
  'conflict',
  'file-missing',
  'file-extra',
  'invalid',
] as const
export type WorkspaceDocumentChangeKindV1 = typeof WORKSPACE_DOCUMENT_CHANGE_KINDS_V1[number]

export type WorkspaceSelfCheckActionV1 =
  | 'none'
  | 'write-file'
  | 'stage-adoption'
  | 'accept-same-change'
  | 'resolve-conflict'
  | 'restore-file'
  | 'review-extra-file'
  | 'quarantine'

export interface WorkspaceDocumentIdentityV1 {
  version: 1
  workspaceUid: string
  documentId: string
  documentKind: string
  worldCode?: string
  workCode?: string
}

export interface WorkspaceDocumentHashTripleV1 {
  baselineCanonicalHash: string | null
  databaseCanonicalHash: string | null
  fileCanonicalHash: string | null
}

/** Project-scoped binding/baseline row. Document bodies remain in their domain tables. */
export interface WorkspaceDocumentBindingV1 extends WorkspaceDocumentHashTripleV1 {
  id?: number
  projectId: number
  workspaceUid: string
  documentId: string
  documentKind: string
  tableName: string
  recordId: number
  recordExportId?: string
  worldCode?: string
  workCode?: string
  relativePath: string
  codec: WorkspaceDocumentCodecV1
  editPolicy: WorkspaceDocumentEditPolicyV1
  schemaVersion: number
  /** Browser file metadata captured at the last committed manifest. */
  fileByteLength?: number
  fileLastModified?: number
  lastSyncRevision: number
  lastSyncRunId?: number
  createdAt: number
  updatedAt: number
}

export interface WorkspaceSelfCheckItemV1 extends WorkspaceDocumentHashTripleV1 {
  identity: WorkspaceDocumentIdentityV1
  relativePath: string
  codec: WorkspaceDocumentCodecV1
  editPolicy: WorkspaceDocumentEditPolicyV1
  changeKind: WorkspaceDocumentChangeKindV1
  proposedAction: WorkspaceSelfCheckActionV1
  issues: readonly string[]
}

export interface WorkspaceSelfCheckPlanV1 {
  version: 1
  planId: string
  projectId: number
  workspaceUid: string
  createdAt: number
  modelPolicy: 'none'
  items: readonly WorkspaceSelfCheckItemV1[]
  planHash: string
}

export interface WorkspaceSelfCheckSummaryV1 {
  clean: number
  projectChanged: number
  fileChanged: number
  sameChange: number
  conflict: number
  missing: number
  extra: number
  invalid: number
}

export interface WorkspaceSelfCheckReportV1 {
  version: 1
  plan: WorkspaceSelfCheckPlanV1
  summary: WorkspaceSelfCheckSummaryV1
  checkedAt: number
  zeroModelCalls: true
}

/** Frozen, inspectable proposal produced from an author-edited disk document. */
export interface WorkspaceFileAdoptionCandidateV1 extends WorkspaceDocumentHashTripleV1 {
  version: 1
  candidateId: string
  candidateHash: string
  planHash: string
  identity: WorkspaceDocumentIdentityV1
  tableName: 'projects' | 'worlds' | 'works' | 'chapters'
  recordId: number
  relativePath: string
  changedFields: readonly string[]
  patch: Readonly<Record<string, unknown>>
  compareAndSetFields: readonly string[]
  compareAndSetExpectedHash: string
  createdAt: number
}

export interface WorkspaceFileCandidateSetV1 {
  version: 1
  projectId: number
  planHash: string
  candidates: readonly WorkspaceFileAdoptionCandidateV1[]
  blockedDocumentIds: readonly string[]
  createdAt: number
  zeroModelCalls: true
}

export type WorkspaceImpactExecutionV1 =
  | 'deterministic-rebuild'
  | 'manual-review'
  | 'generative-candidate'

export interface WorkspaceImpactItemV1 {
  id: string
  candidateId: string
  sourceTable: string
  sourceRecordId: number
  targetTable: string
  targetRecordId: number | null
  action: string
  execution: WorkspaceImpactExecutionV1
  dependencyItemIds: readonly string[]
  reason: string
}

export interface WorkspaceImpactPlanV1 {
  version: 1
  projectId: number
  candidateSetPlanHash: string
  sourceCandidateHashes: readonly string[]
  graphHashes: readonly string[]
  items: readonly WorkspaceImpactItemV1[]
  counts: {
    deterministic: number
    manualReview: number
    generativeCandidate: number
  }
  zeroModelCalls: true
  planHash: string
}

export interface WorkspaceManifestDocumentV1 {
  documentId: string
  documentKind: string
  tableName: string
  relativePath: string
  codec: WorkspaceDocumentCodecV1
  editPolicy: WorkspaceDocumentEditPolicyV1
  canonicalHash: string
  schemaVersion: number
}

export interface WorkspaceManifestV1 {
  version: 1
  workspaceUid: string
  revision: number
  writtenAt: number
  hashAlgorithm: 'sha256-canonical-v1'
  documents: readonly WorkspaceManifestDocumentV1[]
  manifestHash: string
}

export type WorkspaceSyncReceiptStateV1 =
  | 'filesystem-pending'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkspaceSyncReceiptV1 {
  version: 1
  receiptId: string
  planId: string
  projectId: number
  workspaceUid: string
  state: WorkspaceSyncReceiptStateV1
  databaseAdoptionReceiptHashes: readonly string[]
  writtenDocumentHashes: Readonly<Record<string, string>>
  manifestHash?: string
  completedAt?: number
  receiptHash: string
}

export interface WorkspacePackageFileV1 {
  relativePath: string
  text: string
  textHash: string
}

/** Explicit fallback transport for browsers without File System Access API. */
export interface WorkspacePackageV1 {
  format: 'storyforge-workspace-package'
  version: 1
  workspaceUid: string
  files: readonly WorkspacePackageFileV1[]
  packageHash: string
}

export interface MemoryArtifactRefV1 {
  artifactId: string
  sourceKind: 'agent-event' | 'node-run' | 'agent-run-event' | 'domain-record'
  sourceExportId: string
  runExportId?: string
  stepId?: string
  attempt?: number
  contentHash: string
  authority: 'candidate' | 'accepted' | 'rejected' | 'evidence'
  worldCode?: string
  workCode?: string
}

export interface MemorySettlementReceiptV1 {
  version: 1
  /** Portable identity derived from run.created objective hash + creation time. */
  runExportId: string
  runId: number
  contractHash: string
  state: 'settled' | 'awaiting-confirmation' | 'incomplete'
  terminalReceiptHash: string | null
  contextManifestHashes: readonly string[]
  adoptionHashes: readonly string[]
  artifactRefs: readonly MemoryArtifactRefV1[]
  workspaceDirty: boolean
  evaluatedAt: number
  receiptHash: string
}

export interface MemoryArtifactIndexV1 {
  version: 1
  workspaceUid: string
  /** Current project-wide disk postcondition, evaluated when the index is built. */
  workspaceDirty: boolean
  runs: readonly {
    runExportId: string
    contractHash: string
    state: MemorySettlementReceiptV1['state']
    terminalReceiptHash: string | null
    settlementReceiptHash: string | null
    settlementSource: 'terminal-event' | 'derived-current'
    settlementRecordedAt: number | null
    contextManifestHashes: readonly string[]
    adoptionHashes: readonly string[]
    artifactRefs: readonly MemoryArtifactRefV1[]
    artifactIndexHash: string
  }[]
  indexHash: string
}

export type ConsistencyCheckLevelV1 = 'L0-structural' | 'L1-state' | 'L2-semantic' | 'L3-generative'

export interface ConsistencyDossierSourceRefV1 {
  table: string
  recordId: number
  exportId: string
  contentHash: string
  authority: 'author-confirmed' | 'accepted-evidence' | 'derived-cache'
  status: 'current' | 'stale' | 'invalid'
}

export interface ConsistencyDossierFindingV1 {
  findingId: string
  level: ConsistencyCheckLevelV1
  severity: 'info' | 'warning' | 'blocking'
  code: string
  message: string
  sourceExportIds: readonly string[]
  execution: 'deterministic' | 'author-review' | 'optional-model'
}

/**
 * MEMORY-9: a bounded, source-addressed context product. It is not another
 * memory store: all payloads remain in registered domain tables and the
 * dossier carries only compact projections plus immutable references.
 */
export interface LongTermConsistencyDossierV1 {
  version: 1
  projectId: number
  workspaceUid: string
  worldCode: string
  workCode: string
  boundaryChapterId: number
  structuredFacts: readonly string[]
  characterKnowledge: readonly string[]
  currentStates: readonly string[]
  inventory: readonly string[]
  timeline: readonly string[]
  keywordEvidence: readonly string[]
  sourceRefs: readonly ConsistencyDossierSourceRefV1[]
  findings: readonly ConsistencyDossierFindingV1[]
  retrievalPolicy: {
    structuredExact: true
    dependencyGraph: true
    fullTextKeyword: true
    embedding: {
      enabled: false
      authoritative: false
      reason: string
    }
  }
  checks: {
    L0: 'completed'
    L1: 'completed'
    L2: 'author-review-only'
    L3: 'disabled' | 'author-authorized'
  }
  tokenBudget: {
    estimatedTokens: number
    maxTokens: number
    truncated: boolean
    modelCalls: 0
  }
  dossierHash: string
}
