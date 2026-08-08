import type {
  VerificationCriterionReceiptV1,
  VerificationReceiptV1,
} from '../../types/agent-run'
import { hashCanonicalValue } from './hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readEnum,
  readHash,
  readInteger,
  readRecord,
  readString,
} from './schema-utils'

type VerificationReceiptBodyV1 = Omit<VerificationReceiptV1, 'receiptHash'>

function receiptBody(receipt: VerificationReceiptV1): VerificationReceiptBodyV1 {
  const { receiptHash: _receiptHash, ...body } = receipt
  return body
}

function readHashArray(value: unknown, path: string, options: { allowEmpty?: boolean } = {}): string[] {
  const hashes = readArray(value, path).map((item, index) => readHash(item, `${path}[${index}]`))
  if (!options.allowEmpty && hashes.length === 0) failSchema('invalid_value', path, '不得为空')
  assertUnique(hashes, path)
  return hashes
}

function parseCriterion(value: unknown, path: string): VerificationCriterionReceiptV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, ['id', 'status', 'evidenceRefs'], ['id', 'status', 'evidenceRefs'], path)
  const evidenceRefs = readArray(record.evidenceRefs, `${path}.evidenceRefs`).map((item, index) => (
    readString(item, `${path}.evidenceRefs[${index}]`, { max: 240 })
  ))
  if (evidenceRefs.length === 0) failSchema('missing_evidence', `${path}.evidenceRefs`, '不得为空')
  assertUnique(evidenceRefs, `${path}.evidenceRefs`)
  return {
    id: readString(record.id, `${path}.id`, { max: 120 }),
    status: readEnum(record.status, ['passed', 'failed'], `${path}.status`),
    evidenceRefs,
  }
}

export function parseVerificationReceiptV1(value: unknown): VerificationReceiptV1 {
  const record = readRecord(value, 'receipt')
  const keys = [
    'version',
    'runId',
    'generation',
    'contractHash',
    'contextManifestHashes',
    'candidateHashes',
    'adoptionEventIds',
    'postStateHash',
    'verifierSetVersion',
    'lineage',
    'semanticVerifier',
    'criteria',
    'acceptedAt',
    'receiptHash',
  ] as const
  const required = keys.filter(key => key !== 'semanticVerifier' && key !== 'lineage')
  assertExactKeys(record, keys, required, 'receipt')
  if (record.version !== 1) failSchema('unsupported_version', 'receipt.version', '仅支持版本 1')
  const adoptionEventIds = readArray(record.adoptionEventIds, 'receipt.adoptionEventIds').map((item, index) => (
    readInteger(item, `receipt.adoptionEventIds[${index}]`, { min: 1 })
  ))
  if (new Set(adoptionEventIds).size !== adoptionEventIds.length) {
    failSchema('duplicate_value', 'receipt.adoptionEventIds', '不得包含重复 ID')
  }
  const criteria = readArray(record.criteria, 'receipt.criteria')
    .map((item, index) => parseCriterion(item, `receipt.criteria[${index}]`))
  if (criteria.length === 0) failSchema('invalid_criteria', 'receipt.criteria', '不得为空')
  assertUnique(criteria.map(item => item.id), 'receipt.criteria')
  if (criteria.some(item => item.status !== 'passed')) {
    failSchema('failed_criterion', 'receipt.criteria', 'accepted receipt 不得包含 failed 验收项')
  }
  let semanticVerifier: VerificationReceiptV1['semanticVerifier']
  if (record.semanticVerifier !== undefined) {
    const semantic = readRecord(record.semanticVerifier, 'receipt.semanticVerifier')
    assertExactKeys(
      semantic,
      ['provider', 'model', 'promptVersion'],
      ['provider', 'model', 'promptVersion'],
      'receipt.semanticVerifier',
    )
    semanticVerifier = {
      provider: readString(semantic.provider, 'receipt.semanticVerifier.provider', { max: 120 }),
      model: readString(semantic.model, 'receipt.semanticVerifier.model', { max: 200 }),
      promptVersion: readString(semantic.promptVersion, 'receipt.semanticVerifier.promptVersion', { max: 160 }),
    }
  }
  let lineage: VerificationReceiptV1['lineage']
  if (record.lineage !== undefined) {
    const parent = readRecord(record.lineage, 'receipt.lineage')
    assertExactKeys(
      parent,
      ['runId', 'receiptHash', 'relation', 'artifactHash'],
      ['runId', 'receiptHash', 'relation'],
      'receipt.lineage',
    )
    lineage = {
      runId: readInteger(parent.runId, 'receipt.lineage.runId', { min: 1 }),
      receiptHash: readHash(parent.receiptHash, 'receipt.lineage.receiptHash'),
      relation: readString(parent.relation, 'receipt.lineage.relation', { max: 120 }),
      ...(parent.artifactHash === undefined ? {} : {
        artifactHash: readHash(parent.artifactHash, 'receipt.lineage.artifactHash'),
      }),
    }
  }
  return {
    version: 1,
    runId: readInteger(record.runId, 'receipt.runId', { min: 1 }),
    generation: readInteger(record.generation, 'receipt.generation', { min: 1 }),
    contractHash: readHash(record.contractHash, 'receipt.contractHash'),
    contextManifestHashes: readHashArray(record.contextManifestHashes, 'receipt.contextManifestHashes'),
    candidateHashes: readHashArray(record.candidateHashes, 'receipt.candidateHashes', { allowEmpty: true }),
    adoptionEventIds,
    postStateHash: readHash(record.postStateHash, 'receipt.postStateHash'),
    verifierSetVersion: readString(record.verifierSetVersion, 'receipt.verifierSetVersion', { max: 160 }),
    ...(lineage ? { lineage } : {}),
    semanticVerifier,
    criteria,
    acceptedAt: readInteger(record.acceptedAt, 'receipt.acceptedAt', { min: 0 }),
    receiptHash: readHash(record.receiptHash, 'receipt.receiptHash'),
  }
}

export async function createVerificationReceiptV1(
  body: VerificationReceiptBodyV1,
): Promise<VerificationReceiptV1> {
  const provisional = { ...body, receiptHash: '0'.repeat(64) }
  const parsed = parseVerificationReceiptV1(provisional)
  return { ...parsed, receiptHash: await hashCanonicalValue(receiptBody(parsed)) }
}

export async function verifyVerificationReceiptIntegrityV1(value: unknown): Promise<boolean> {
  const receipt = parseVerificationReceiptV1(value)
  return await hashCanonicalValue(receiptBody(receipt)) === receipt.receiptHash
}

export function isVerificationReceiptFreshV1(
  value: unknown,
  current: Pick<
    VerificationReceiptV1,
    | 'runId'
    | 'generation'
    | 'contractHash'
    | 'contextManifestHashes'
    | 'candidateHashes'
    | 'adoptionEventIds'
    | 'postStateHash'
    | 'verifierSetVersion'
  >,
): boolean {
  const receipt = parseVerificationReceiptV1(value)
  const sameArray = <T>(left: readonly T[], right: readonly T[]) => (
    left.length === right.length && left.every((item, index) => item === right[index])
  )
  return receipt.runId === current.runId
    && receipt.generation === current.generation
    && receipt.contractHash === current.contractHash
    && sameArray(receipt.contextManifestHashes, current.contextManifestHashes)
    && sameArray(receipt.candidateHashes, current.candidateHashes)
    && sameArray(receipt.adoptionEventIds, current.adoptionEventIds)
    && receipt.postStateHash === current.postStateHash
    && receipt.verifierSetVersion === current.verifierSetVersion
}
