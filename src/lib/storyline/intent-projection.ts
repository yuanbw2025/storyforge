import { hashCanonicalValue } from '../agent/run/hash'
import type { StoryArc, StoryCore } from '../types'
import { readOwnedRows, resolveScopeLike, type WorkspaceScopeLike } from '../workspace/scope'

export const STORY_INTENT_FIELDS_V1 = [
  'logline',
  'concept',
  'theme',
  'centralConflict',
  'plotPattern',
  'mainPlot',
  'subPlots',
] as const

export interface StoryCoreIntentSnapshotV1 {
  storyCoreId: number | null
  ragDocumentId: string | null
  revision: number | null
  hash: string
  values: Record<typeof STORY_INTENT_FIELDS_V1[number], string>
}

export type StoryArcIntentAlignmentV1 = 'aligned' | 'stale' | 'source-missing' | 'untracked'

function valuesOf(row: StoryCore | null): StoryCoreIntentSnapshotV1['values'] {
  return Object.fromEntries(STORY_INTENT_FIELDS_V1.map(field => [
    field,
    row?.[field] ?? '',
  ])) as StoryCoreIntentSnapshotV1['values']
}

export async function storyCoreIntentSnapshotV1(
  row: StoryCore | null,
): Promise<StoryCoreIntentSnapshotV1> {
  const values = valuesOf(row)
  return {
    storyCoreId: row?.id ?? null,
    ragDocumentId: row?.ragDocumentId ?? null,
    revision: row?.updatedAt ?? null,
    hash: await hashCanonicalValue(values),
    values,
  }
}

export async function readStoryCoreIntentSnapshotV1(
  scopeInput: WorkspaceScopeLike,
): Promise<StoryCoreIntentSnapshotV1> {
  const scope = await resolveScopeLike(scopeInput)
  const rows = await readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' })
  const row = rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0] ?? null
  return storyCoreIntentSnapshotV1(row)
}

export function storyArcIntentAlignmentV1(
  arc: StoryArc,
  current: StoryCoreIntentSnapshotV1,
): StoryArcIntentAlignmentV1 {
  if (arc.origin !== 'ai' || !arc.sourceStoryCoreHash || !arc.lastAlignedHash) return 'untracked'
  // An empty project is a valid, frozen intent baseline. No source record at
  // generation time is different from a once-present source being deleted.
  if (arc.sourceStoryCoreId == null) {
    return current.storyCoreId == null && current.hash === arc.lastAlignedHash ? 'aligned' : 'stale'
  }
  if (current.storyCoreId !== arc.sourceStoryCoreId) return 'source-missing'
  return current.hash === arc.lastAlignedHash ? 'aligned' : 'stale'
}

export function storyArcIntentProjectionMetadataV1(input: {
  intent: StoryCoreIntentSnapshotV1
  producerRunId?: number
  producerCandidateHash?: string
}): Pick<StoryArc,
  | 'origin'
  | 'status'
  | 'sourceStoryCoreId'
  | 'sourceStoryCoreRevision'
  | 'sourceStoryCoreHash'
  | 'lastAlignedHash'
  | 'producerRunId'
  | 'producerCandidateHash'
> {
  return {
    origin: 'ai',
    status: 'active',
    ...(input.intent.storyCoreId == null ? {} : { sourceStoryCoreId: input.intent.storyCoreId }),
    ...(input.intent.revision == null ? {} : { sourceStoryCoreRevision: input.intent.revision }),
    sourceStoryCoreHash: input.intent.hash,
    lastAlignedHash: input.intent.hash,
    ...(input.producerRunId == null ? {} : { producerRunId: input.producerRunId }),
    ...(input.producerCandidateHash == null ? {} : { producerCandidateHash: input.producerCandidateHash }),
  }
}
