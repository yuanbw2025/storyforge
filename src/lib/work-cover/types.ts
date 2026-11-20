import type { WorkspaceScope } from '../types/world-ownership'
import type { ExactRunArtifactIdentityV1 } from '../types/memory-engineering'

export interface WorkCoverBriefV1 {
  version: 1
  prompt: string
  selectedText: { chapterId: number; start: number; end: number; textHash: string } | null
}

/** Immutable, portable CreativeArtifact image variant. Local coordinates live
 * on the registered owner row; stable identities keep exact evidence portable. */
export interface WorkCoverImageCandidateV1 {
  schema: 'storyforge.work-cover.image-candidate@1'
  workCode: string
  dispatchKey: string
  attempt: 1
  ordinal: 0
  briefHash: string
  routeHash: string
  assetKey: string
  blobHash: string
  responseHash: string
  providerReceiptHash: string
  rights: 'provider-terms-unverified'
  candidateHash: string
}

export interface WorkCoverDraftV1 extends WorkspaceScope {
  id?: number
  version: 1
  workCode: string
  draftKey: string
  revision: number
  expectedWorkUpdatedAt: number
  briefJson: string
  briefHash: string
  selectedAssetId: number | null
  adoptedAssetId: number | null
  /** U3: first release has no text layer or font dependency. */
  layoutJson: 'null'
  layoutHash: null
  renderManifestHash: string | null
  pendingAdoptionJson: string | null
  lastRunId: number | null
  createdAt: number
  updatedAt: number
}

export interface WorkCoverAssetV1 extends WorkspaceScope {
  id?: number
  version: 1
  workCode: string
  assetKey: string
  role: 'uploaded-original' | 'generated-original' | 'rendered-cover'
  blobObjectId: number
  blobHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteSize: number
  sourceRunId: number | null
  /** Independent local verification; absent on legacy/upload/normal model assets. */
  materializationRunId?: number | null
  repairEvidenceJson?: string | null
  ordinal: 0
  parentAssetId: number | null
  layoutHash: null
  rights: 'author-upload' | 'provider-terms-unverified'
  candidateJson: string | null
  exactArtifactRefsJson: string
  createdAt: number
}

export interface WorkCoverAdoptionV1 extends WorkspaceScope {
  id?: number
  version: 1
  workCode: string
  operationKey: string
  draftId: number
  draftKey: string
  draftRevision: number
  originalAssetId: number
  finalAssetId: number
  candidateHash: string
  layoutHash: null
  oldCoverHash: string
  newCoverHash: string
  sourceRunId: number | null
  materializationRunId?: number | null
  adoptedAt: number
  expectedWorkUpdatedAt: number
  renderManifestJson: string
  renderManifestHash: string
  receiptHash: string
  exactArtifactRefsJson: string
}

/** The one-shot dispatch journal is local only. A null payload means either
 * no response arrived or its verified image was durably materialized. */
export interface WorkCoverResponseBufferV1 extends WorkspaceScope {
  id?: number
  version: 1
  workCode: string
  runId: number
  attempt: 1
  dispatchKey: string
  draftId: number
  draftRevision: number
  briefHash: string
  routeHash: string
  credentialIdentity: string
  requestJson: string
  state: 'prepared' | 'dispatch-intent' | 'response-observed' | 'materializing' | 'candidate-ready' | 'failed' | 'outcome-unknown'
  httpStatus: number | null
  requestId: string | null
  rawResponseHash: string | null
  payload: ArrayBuffer | null
  assetId: number | null
  errorCode: string | null
  createdAt: number
  updatedAt: number
}

export type WorkCoverExactRefsV1 = ExactRunArtifactIdentityV1[]
