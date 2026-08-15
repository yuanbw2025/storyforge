import { hashCanonicalValue } from '../../agent/run/hash'
import type { CreativeReliabilityFixtureV1 } from './fixtures'
import {
  applyCreativeReliabilityHumanReviewsV1,
  createCreativeReliabilityEvalRecordV1,
  verifyCreativeReliabilityEvalRecordV1,
} from './evidence'
import type {
  CreativeReliabilityEvalCaseV1,
  CreativeReliabilityEvalGenerationV1,
  CreativeReliabilityEvalIdentityV1,
  CreativeReliabilityEvalRecordV1,
  CreativeReliabilityEvalSplitV1,
  CreativeReliabilityEvalVariantV1,
  CreativeReliabilityEvalVerificationV1,
  CreativeReliabilityHumanReviewV1,
} from './types'

export const CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1 =
  'storyforge:crel-eval-checkpoint-v1'

export interface CreativeReliabilityEvalCheckpointCaseV1 {
  fixtureId: string
  executionOrder: [CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVariantV1]
  generations: Partial<Record<CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalGenerationV1>>
  verifications: Partial<Record<CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVerificationV1>>
}

export interface CreativeReliabilityEvalCheckpointV1 {
  version: 1
  suiteVersion: string
  runId: string
  createdAt: number
  codeRevision: string
  split: CreativeReliabilityEvalSplitV1
  fixtureSetHash: string
  generator: CreativeReliabilityEvalIdentityV1
  verifier: CreativeReliabilityEvalIdentityV1
  parameters: CreativeReliabilityEvalRecordV1['parameters']
  status: 'running' | 'provider-blocked' | 'failed' | 'completed'
  cases: CreativeReliabilityEvalCheckpointCaseV1[]
  record: CreativeReliabilityEvalRecordV1 | null
  checkpointHash: string
}

export interface CreativeReliabilityEvalRunDependenciesV1 {
  generate: (input: {
    fixture: CreativeReliabilityFixtureV1
    variant: CreativeReliabilityEvalVariantV1
    identity: CreativeReliabilityEvalIdentityV1
    parameters: CreativeReliabilityEvalRecordV1['parameters']
  }) => Promise<CreativeReliabilityEvalGenerationV1>
  verify: (input: {
    fixture: CreativeReliabilityFixtureV1
    variant: CreativeReliabilityEvalVariantV1
    generation: CreativeReliabilityEvalGenerationV1
    identity: CreativeReliabilityEvalIdentityV1
  }) => Promise<CreativeReliabilityEvalVerificationV1>
}

const EMPTY_HASH = '0'.repeat(64)

function checkpointBody(checkpoint: CreativeReliabilityEvalCheckpointV1) {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return body
}

async function sealCheckpoint(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
): Promise<CreativeReliabilityEvalCheckpointV1> {
  return {
    ...checkpoint,
    checkpointHash: await hashCanonicalValue(checkpointBody(checkpoint)),
  }
}

function executionOrder(index: number): [
  CreativeReliabilityEvalVariantV1,
  CreativeReliabilityEvalVariantV1,
] {
  return index % 2 === 0
    ? ['legacy-direct', 'creative-reliability']
    : ['creative-reliability', 'legacy-direct']
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sameFrozenRun(input: {
  checkpoint: CreativeReliabilityEvalCheckpointV1
  runId: string
  codeRevision: string
  fixtureSetHash: string
  generator: CreativeReliabilityEvalIdentityV1
  verifier: CreativeReliabilityEvalIdentityV1
  parameters: CreativeReliabilityEvalRecordV1['parameters']
}): boolean {
  return input.checkpoint.runId === input.runId
    && input.checkpoint.codeRevision === input.codeRevision
    && input.checkpoint.fixtureSetHash === input.fixtureSetHash
    && JSON.stringify(input.checkpoint.generator) === JSON.stringify(input.generator)
    && JSON.stringify(input.checkpoint.verifier) === JSON.stringify(input.verifier)
    && JSON.stringify(input.checkpoint.parameters) === JSON.stringify(input.parameters)
}

export async function verifyCreativeReliabilityEvalCheckpointV1(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<boolean> {
  try {
    if (checkpoint.version !== 1 || !isHash(checkpoint.fixtureSetHash) || !isHash(checkpoint.checkpointHash)) {
      return false
    }
    if (await hashCanonicalValue(fixtures) !== checkpoint.fixtureSetHash) return false
    if (await hashCanonicalValue(checkpointBody(checkpoint)) !== checkpoint.checkpointHash) return false
    if (checkpoint.cases.length !== fixtures.length) return false
    if (checkpoint.split !== fixtures[0]?.split) return false
    if (
      checkpoint.generator.provider === checkpoint.verifier.provider
      && checkpoint.generator.model === checkpoint.verifier.model
    ) return false
    for (let index = 0; index < fixtures.length; index += 1) {
      const item = checkpoint.cases[index]
      if (item.fixtureId !== fixtures[index].id) return false
      if (JSON.stringify(item.executionOrder) !== JSON.stringify(executionOrder(index))) return false
    }
    if (checkpoint.status === 'completed') {
      if (!checkpoint.record) return false
      if (!await verifyCreativeReliabilityEvalRecordV1(checkpoint.record, fixtures)) return false
    } else if (checkpoint.record != null) return false
    return true
  } catch {
    return false
  }
}

function completedCases(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
): CreativeReliabilityEvalCaseV1[] {
  return checkpoint.cases.map(item => {
    const legacy = item.generations['legacy-direct']
    const current = item.generations['creative-reliability']
    const legacyVerification = item.verifications['legacy-direct']
    const currentVerification = item.verifications['creative-reliability']
    if (!legacy || !current || !legacyVerification || !currentVerification) {
      throw new Error('CREL checkpoint 尚未完成全部成对生成与验证')
    }
    return {
      fixtureId: item.fixtureId,
      executionOrder: item.executionOrder,
      generations: {
        'legacy-direct': legacy,
        'creative-reliability': current,
      },
      verifications: {
        'legacy-direct': legacyVerification,
        'creative-reliability': currentVerification,
      },
      humanReview: null,
    }
  })
}

function blockedByProvider(
  generation: CreativeReliabilityEvalGenerationV1 | undefined,
  verification: CreativeReliabilityEvalVerificationV1 | undefined,
): boolean {
  return generation?.status === 'provider-failed' || verification?.status === 'provider-failed'
}

export async function runCreativeReliabilityEvalV1(input: {
  suiteVersion: string
  runId: string
  createdAt?: number
  codeRevision: string
  fixtures: readonly CreativeReliabilityFixtureV1[]
  generator: CreativeReliabilityEvalIdentityV1
  verifier: CreativeReliabilityEvalIdentityV1
  parameters: CreativeReliabilityEvalRecordV1['parameters']
  dependencies: CreativeReliabilityEvalRunDependenciesV1
  resumeFrom?: CreativeReliabilityEvalCheckpointV1
  onCheckpoint?: (checkpoint: CreativeReliabilityEvalCheckpointV1) => Promise<void> | void
}): Promise<CreativeReliabilityEvalCheckpointV1> {
  if (!input.fixtures.length) throw new Error('CREL 评测集不能为空')
  if (input.fixtures.some(fixture => fixture.split !== input.fixtures[0].split)) {
    throw new Error('CREL 单次运行不得混合 development 与 held-out')
  }
  if (input.generator.provider === input.verifier.provider && input.generator.model === input.verifier.model) {
    throw new Error('CREL generator 与 verifier 必须使用不同模型身份')
  }
  const fixtureSetHash = await hashCanonicalValue(input.fixtures)
  let checkpoint: CreativeReliabilityEvalCheckpointV1
  if (input.resumeFrom) {
    if (!await verifyCreativeReliabilityEvalCheckpointV1(input.resumeFrom, input.fixtures)) {
      throw new Error('CREL resume checkpoint 验签失败')
    }
    if (!sameFrozenRun({
      checkpoint: input.resumeFrom,
      runId: input.runId,
      codeRevision: input.codeRevision,
      fixtureSetHash,
      generator: input.generator,
      verifier: input.verifier,
      parameters: input.parameters,
    })) throw new Error('CREL resume checkpoint 与当前冻结运行不一致')
    if (input.resumeFrom.status === 'completed') return input.resumeFrom
    checkpoint = await sealCheckpoint({
      ...structuredClone(input.resumeFrom),
      status: 'running',
      record: null,
    })
  } else {
    checkpoint = await sealCheckpoint({
      version: 1,
      suiteVersion: input.suiteVersion,
      runId: input.runId,
      createdAt: input.createdAt ?? Date.now(),
      codeRevision: input.codeRevision,
      split: input.fixtures[0].split,
      fixtureSetHash,
      generator: input.generator,
      verifier: input.verifier,
      parameters: input.parameters,
      status: 'running',
      cases: input.fixtures.map((fixture, index) => ({
        fixtureId: fixture.id,
        executionOrder: executionOrder(index),
        generations: {},
        verifications: {},
      })),
      record: null,
      checkpointHash: EMPTY_HASH,
    })
  }
  const save = async () => {
    checkpoint = await sealCheckpoint(checkpoint)
    await input.onCheckpoint?.(structuredClone(checkpoint))
  }
  await save()
  for (let index = 0; index < input.fixtures.length; index += 1) {
    const fixture = input.fixtures[index]
    const state = checkpoint.cases[index]
    for (const variant of state.executionOrder) {
      if (!state.generations[variant]) {
        try {
          state.generations[variant] = await input.dependencies.generate({
            fixture,
            variant,
            identity: input.generator,
            parameters: input.parameters,
          })
        } catch (error) {
          checkpoint.status = 'failed'
          await save()
          throw error
        }
        if (blockedByProvider(state.generations[variant], undefined)) checkpoint.status = 'provider-blocked'
        await save()
        if (checkpoint.status === 'provider-blocked') return checkpoint
      }
      if (!state.verifications[variant]) {
        try {
          state.verifications[variant] = await input.dependencies.verify({
            fixture,
            variant,
            generation: state.generations[variant]!,
            identity: input.verifier,
          })
        } catch (error) {
          checkpoint.status = 'failed'
          await save()
          throw error
        }
        if (blockedByProvider(undefined, state.verifications[variant])) checkpoint.status = 'provider-blocked'
        await save()
        if (checkpoint.status === 'provider-blocked') return checkpoint
      }
    }
  }
  const record = await createCreativeReliabilityEvalRecordV1({
    suiteVersion: input.suiteVersion,
    runId: input.runId,
    createdAt: checkpoint.createdAt,
    codeRevision: input.codeRevision,
    fixtures: input.fixtures,
    generator: input.generator,
    verifier: input.verifier,
    parameters: input.parameters,
    cases: completedCases(checkpoint),
  })
  checkpoint = { ...checkpoint, status: 'completed', record }
  await save()
  return checkpoint
}

export async function persistCreativeReliabilityEvalCheckpointV1(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
): Promise<void> {
  localStorage.setItem(CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1, JSON.stringify(checkpoint))
}

export function loadCreativeReliabilityEvalCheckpointV1(): CreativeReliabilityEvalCheckpointV1 | null {
  const raw = localStorage.getItem(CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1)
  return raw ? JSON.parse(raw) as CreativeReliabilityEvalCheckpointV1 : null
}

export function clearCreativeReliabilityEvalCheckpointV1(): void {
  localStorage.removeItem(CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1)
}

export async function applyCreativeReliabilityReviewsToCheckpointV1(input: {
  checkpoint: CreativeReliabilityEvalCheckpointV1
  fixtures: readonly CreativeReliabilityFixtureV1[]
  reviews: Readonly<Record<string, CreativeReliabilityHumanReviewV1>>
}): Promise<CreativeReliabilityEvalCheckpointV1> {
  if (
    input.checkpoint.status !== 'completed'
    || !input.checkpoint.record
    || !await verifyCreativeReliabilityEvalCheckpointV1(input.checkpoint, input.fixtures)
  ) throw new Error('只有完成且验签通过的 CREL checkpoint 才能写入盲评')
  const record = await applyCreativeReliabilityHumanReviewsV1(
    input.checkpoint.record,
    input.fixtures,
    input.reviews,
  )
  return await sealCheckpoint({ ...input.checkpoint, record })
}

export async function exportCreativeReliabilityEvalCheckpointV1(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<string> {
  if (!await verifyCreativeReliabilityEvalCheckpointV1(checkpoint, fixtures)) {
    throw new Error('CREL checkpoint 验签失败，拒绝导出')
  }
  return JSON.stringify(checkpoint, null, 2)
}

export async function importCreativeReliabilityEvalCheckpointV1(
  raw: string,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<CreativeReliabilityEvalCheckpointV1> {
  const parsed = JSON.parse(raw) as CreativeReliabilityEvalCheckpointV1
  if (!await verifyCreativeReliabilityEvalCheckpointV1(parsed, fixtures)) {
    throw new Error('CREL checkpoint 导入验签失败')
  }
  return parsed
}
