import { hashCanonicalValue } from '../../agent/run/hash'
import {
  H86_STORY_ARC_VARIANTS_V1,
  verifyH86CheckpointV1,
  type H86CheckpointV1,
  type H86StoryArcVariantV1,
} from './story-arc-main-path'
import { H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1 } from './story-arc-main-path-fixtures'

export const H86_HUMAN_REVIEW_VERSION_V1 = 1 as const
export const H86_HUMAN_REVIEW_STORAGE_KEY_V1 = 'storyforge:h86-story-arc-human-review-v1'

export interface H86HumanCandidateReviewV1 {
  constraintFaithfulness: number
  causalCoherence: number
  specificity: number
  authorUsability: number
  editedOutput: string
  notes: string
}

export interface H86HumanReviewItemV1 {
  fixtureId: string
  blindOrder: [H86StoryArcVariantV1, H86StoryArcVariantV1]
  candidateA: string
  candidateB: string
  reviewA: H86HumanCandidateReviewV1 | null
  reviewB: H86HumanCandidateReviewV1 | null
  preference: 'A' | 'B' | 'tie' | null
}

export interface H86HumanVariantAggregateV1 {
  reviewedCases: number
  averageScore: number
  averageConstraintFaithfulness: number
  averageCausalCoherence: number
  averageSpecificity: number
  averageAuthorUsability: number
  averageLineEditRatio: number
  preferredCount: number
}

export interface H86HumanReviewAggregateV1 {
  baselineDirect: H86HumanVariantAggregateV1
  agentHarness: H86HumanVariantAggregateV1
  ties: number
}

export interface H86HumanReviewGateV1 {
  passed: boolean
  failures: Array<'review-incomplete' | 'quality-regression' | 'edit-burden-regression' | 'preference-regression'>
  productionReleaseAllowed: false
}

export interface H86HumanReviewRecordV1 {
  version: typeof H86_HUMAN_REVIEW_VERSION_V1
  checkpointHash: string
  reviewer: string
  createdAt: number
  updatedAt: number
  status: 'running' | 'completed'
  items: H86HumanReviewItemV1[]
  aggregate: H86HumanReviewAggregateV1 | null
  gate: H86HumanReviewGateV1 | null
  recordHash: string
}

function recordBody(record: H86HumanReviewRecordV1): Omit<H86HumanReviewRecordV1, 'recordHash'> {
  const { recordHash: _recordHash, ...body } = record
  return body
}

async function seal(record: H86HumanReviewRecordV1): Promise<H86HumanReviewRecordV1> {
  return { ...record, recordHash: await hashCanonicalValue(recordBody(record)) }
}

function scoreIsValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5
}

function reviewIsValid(value: H86HumanCandidateReviewV1 | null): value is H86HumanCandidateReviewV1 {
  return value != null
    && scoreIsValid(value.constraintFaithfulness)
    && scoreIsValid(value.causalCoherence)
    && scoreIsValid(value.specificity)
    && scoreIsValid(value.authorUsability)
    && typeof value.editedOutput === 'string'
    && value.editedOutput.trim().length > 0
    && value.editedOutput.length <= 120_000
    && typeof value.notes === 'string'
    && value.notes.length <= 2_000
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value as Record<string, unknown>).sort().join('|') === [...keys].sort().join('|')
}

function lineEditRatio(original: string, edited: string): number {
  const left = original.replace(/\r\n/g, '\n').split('\n')
  const right = edited.replace(/\r\n/g, '\n').split('\n')
  const previous = new Uint16Array(right.length + 1)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = 0
    for (let j = 1; j <= right.length; j += 1) {
      const up = previous[j]
      if (left[i - 1] === right[j - 1]) previous[j] = diagonal + 1
      else previous[j] = Math.max(previous[j], previous[j - 1])
      diagonal = up
    }
  }
  const lcs = previous[right.length]
  const edits = left.length + right.length - 2 * lcs
  return Math.min(1, edits / Math.max(1, left.length + right.length))
}

function candidateForVariant(item: H86HumanReviewItemV1, variant: H86StoryArcVariantV1): {
  output: string
  review: H86HumanCandidateReviewV1 | null
  label: 'A' | 'B'
} {
  const index = item.blindOrder.indexOf(variant)
  if (index === 0) return { output: item.candidateA, review: item.reviewA, label: 'A' }
  if (index === 1) return { output: item.candidateB, review: item.reviewB, label: 'B' }
  throw new Error('H86 人工盲评映射缺少 variant')
}

function variantAggregate(
  items: readonly H86HumanReviewItemV1[],
  variant: H86StoryArcVariantV1,
): H86HumanVariantAggregateV1 {
  const rows = items.map(item => ({ item, ...candidateForVariant(item, variant) }))
  const valid = rows.filter((row): row is typeof row & { review: H86HumanCandidateReviewV1 } => reviewIsValid(row.review))
  const average = (read: (review: H86HumanCandidateReviewV1) => number): number => (
    valid.length ? valid.reduce((sum, row) => sum + read(row.review), 0) / valid.length : 0
  )
  return {
    reviewedCases: valid.length,
    averageScore: average(review => (
      review.constraintFaithfulness + review.causalCoherence + review.specificity + review.authorUsability
    ) / 4),
    averageConstraintFaithfulness: average(review => review.constraintFaithfulness),
    averageCausalCoherence: average(review => review.causalCoherence),
    averageSpecificity: average(review => review.specificity),
    averageAuthorUsability: average(review => review.authorUsability),
    averageLineEditRatio: valid.length
      ? valid.reduce((sum, row) => sum + lineEditRatio(row.output, row.review.editedOutput), 0) / valid.length
      : 0,
    preferredCount: rows.filter(row => row.item.preference === row.label).length,
  }
}

export function aggregateH86HumanReviewV1(items: readonly H86HumanReviewItemV1[]): H86HumanReviewAggregateV1 {
  return {
    baselineDirect: variantAggregate(items, 'baseline-direct'),
    agentHarness: variantAggregate(items, 'agent-harness'),
    ties: items.filter(item => item.preference === 'tie').length,
  }
}

export function evaluateH86HumanReviewGateV1(aggregate: H86HumanReviewAggregateV1): H86HumanReviewGateV1 {
  const failures: H86HumanReviewGateV1['failures'] = []
  if (aggregate.baselineDirect.reviewedCases < 6 || aggregate.agentHarness.reviewedCases < 6) failures.push('review-incomplete')
  if (aggregate.agentHarness.averageScore < aggregate.baselineDirect.averageScore - 0.2) failures.push('quality-regression')
  if (aggregate.agentHarness.averageLineEditRatio > aggregate.baselineDirect.averageLineEditRatio + 0.05) {
    failures.push('edit-burden-regression')
  }
  if (aggregate.agentHarness.preferredCount < aggregate.baselineDirect.preferredCount) failures.push('preference-regression')
  return { passed: failures.length === 0, failures, productionReleaseAllowed: false }
}

export function h86CheckpointHasCompletePairedOutputsV1(checkpoint: H86CheckpointV1): boolean {
  if (checkpoint.status !== 'completed'
    || checkpoint.cases.length !== H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.length) return false
  return H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.every((fixture, index) => {
    const pair = checkpoint.cases[index]
    if (pair?.fixtureId !== fixture.id) return false
    return H86_STORY_ARC_VARIANTS_V1.every(variant => {
      const attempts = pair.variants[variant].generationAttempts
      const latest = attempts[attempts.length - 1]
      return latest?.status === 'succeeded' && latest.output.trim().length > 0
    })
  })
}

export async function createH86HumanReviewV1(input: {
  checkpoint: H86CheckpointV1
  reviewer: string
  now?: number
}): Promise<H86HumanReviewRecordV1> {
  if (!await verifyH86CheckpointV1(input.checkpoint) || input.checkpoint.status !== 'completed') {
    throw new Error('只有已完成且验签通过的 H86 checkpoint 才能开始人工盲评')
  }
  if (!h86CheckpointHasCompletePairedOutputsV1(input.checkpoint)) {
    throw new Error('H86 人工盲评缺少 6 组成对成功输出')
  }
  const reviewer = input.reviewer.trim()
  if (!reviewer || reviewer.length > 80) throw new Error('请填写 1-80 字的人工复核者标识')
  const items: H86HumanReviewItemV1[] = []
  for (const [index, fixture] of H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.entries()) {
    const pair = input.checkpoint.cases[index]
    if (pair.fixtureId !== fixture.id) throw new Error('H86 checkpoint fixture 顺序不一致')
    const baselineAttempts = pair.variants['baseline-direct'].generationAttempts
    const agentAttempts = pair.variants['agent-harness'].generationAttempts
    const baseline = baselineAttempts[baselineAttempts.length - 1]
    const agent = agentAttempts[agentAttempts.length - 1]
    if (baseline?.status !== 'succeeded' || agent?.status !== 'succeeded') throw new Error('H86 人工盲评缺少成对成功输出')
    const blindHash = await hashCanonicalValue({ checkpointHash: input.checkpoint.checkpointHash, fixtureId: fixture.id })
    const blindOrder: [H86StoryArcVariantV1, H86StoryArcVariantV1] = Number.parseInt(blindHash.slice(-1), 16) % 2 === 0
      ? ['baseline-direct', 'agent-harness']
      : ['agent-harness', 'baseline-direct']
    const output = (variant: H86StoryArcVariantV1): string => variant === 'baseline-direct' ? baseline.output : agent.output
    items.push({
      fixtureId: fixture.id,
      blindOrder,
      candidateA: output(blindOrder[0]),
      candidateB: output(blindOrder[1]),
      reviewA: null,
      reviewB: null,
      preference: null,
    })
  }
  const now = input.now ?? Date.now()
  return seal({
    version: 1,
    checkpointHash: input.checkpoint.checkpointHash,
    reviewer,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    items,
    aggregate: null,
    gate: null,
    recordHash: '0'.repeat(64),
  })
}

export async function updateH86HumanReviewItemV1(input: {
  record: H86HumanReviewRecordV1
  fixtureId: string
  reviewA: H86HumanCandidateReviewV1
  reviewB: H86HumanCandidateReviewV1
  preference: 'A' | 'B' | 'tie'
  now?: number
}): Promise<H86HumanReviewRecordV1> {
  if (!await verifyH86HumanReviewV1(input.record)) throw new Error('H86 人工盲评记录验签失败')
  if (input.record.status === 'completed') throw new Error('H86 人工盲评已完成，不得原地覆盖')
  if (!reviewIsValid(input.reviewA) || !reviewIsValid(input.reviewB)) throw new Error('H86 人工评分或修订稿无效')
  const found = input.record.items.some(item => item.fixtureId === input.fixtureId)
  if (!found) throw new Error('H86 人工盲评 fixture 不存在')
  const items = input.record.items.map(item => item.fixtureId === input.fixtureId ? {
    ...item,
    reviewA: input.reviewA,
    reviewB: input.reviewB,
    preference: input.preference,
  } : item)
  const complete = items.every(item => reviewIsValid(item.reviewA) && reviewIsValid(item.reviewB) && item.preference != null)
  const aggregate = complete ? aggregateH86HumanReviewV1(items) : null
  return seal({
    ...input.record,
    updatedAt: input.now ?? Date.now(),
    status: complete ? 'completed' : 'running',
    items,
    aggregate,
    gate: aggregate ? evaluateH86HumanReviewGateV1(aggregate) : null,
  })
}

export async function verifyH86HumanReviewV1(record: H86HumanReviewRecordV1): Promise<boolean> {
  try {
    if (!exactKeys(record, [
      'version', 'checkpointHash', 'reviewer', 'createdAt', 'updatedAt', 'status', 'items', 'aggregate', 'gate', 'recordHash',
    ])) return false
    if (record.version !== 1 || !/^[a-f0-9]{64}$/.test(record.checkpointHash) || !/^[a-f0-9]{64}$/.test(record.recordHash)) return false
    if (!record.reviewer.trim() || record.reviewer.length > 80 || record.items.length !== 6) return false
    if (await hashCanonicalValue(recordBody(record)) !== record.recordHash) return false
    if (new Set(record.items.map(item => item.fixtureId)).size !== record.items.length) return false
    for (const item of record.items) {
      if (!exactKeys(item, ['fixtureId', 'blindOrder', 'candidateA', 'candidateB', 'reviewA', 'reviewB', 'preference'])) return false
      if (item.blindOrder.length !== 2 || new Set(item.blindOrder).size !== 2
        || item.blindOrder.some(variant => !H86_STORY_ARC_VARIANTS_V1.includes(variant))) return false
      if (!item.candidateA.trim() || !item.candidateB.trim()) return false
      for (const review of [item.reviewA, item.reviewB]) {
        if (review == null) continue
        if (!exactKeys(review, [
          'constraintFaithfulness', 'causalCoherence', 'specificity', 'authorUsability', 'editedOutput', 'notes',
        ]) || !reviewIsValid(review)) return false
      }
      if (item.preference != null && !['A', 'B', 'tie'].includes(item.preference)) return false
    }
    const complete = record.items.every(item => reviewIsValid(item.reviewA) && reviewIsValid(item.reviewB) && item.preference != null)
    if (record.status === 'completed') {
      if (!complete || !record.aggregate || !record.gate) return false
      if (JSON.stringify(record.aggregate) !== JSON.stringify(aggregateH86HumanReviewV1(record.items))) return false
      if (JSON.stringify(record.gate) !== JSON.stringify(evaluateH86HumanReviewGateV1(record.aggregate))) return false
    } else if (record.status !== 'running' || record.aggregate || record.gate) return false
    return true
  } catch {
    return false
  }
}

export async function persistH86HumanReviewV1(record: H86HumanReviewRecordV1): Promise<void> {
  if (!await verifyH86HumanReviewV1(record)) throw new Error('拒绝持久化未通过验签的 H86 人工盲评')
  localStorage.setItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1, JSON.stringify(record))
}

export async function loadH86HumanReviewV1(): Promise<H86HumanReviewRecordV1 | null> {
  const raw = localStorage.getItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1)
  if (!raw) return null
  const record = JSON.parse(raw) as H86HumanReviewRecordV1
  if (!await verifyH86HumanReviewV1(record)) throw new Error('本机 H86 人工盲评记录验签失败')
  return record
}

export function clearH86HumanReviewV1(): void {
  localStorage.removeItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1)
}

export async function exportH86HumanReviewV1(record: H86HumanReviewRecordV1): Promise<string> {
  if (!await verifyH86HumanReviewV1(record)) throw new Error('拒绝导出未通过验签的 H86 人工盲评')
  return JSON.stringify(record, null, 2)
}

export const __h86HumanReviewTestUtils = { lineEditRatio }
