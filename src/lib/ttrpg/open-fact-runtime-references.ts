/** Versioned identity evidence for semantic facts. Never a current-state or mechanical authority. */
import type { TtrpgOpenAudience } from './open-contract'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenEntityOperationV1, type TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { ttrpgOpenEntityIdentityCatalogV1 } from './open-entity-catalog'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

interface Reference {
  entityRef: string; audience: TtrpgOpenAudience; knownByActorKeys: string[];
  sourceRef: TtrpgOpenSourceRefV1; operationKey: string; planHash: string;
}
export interface TtrpgOpenFactRuntimeReferencesV1 {
  schema: 'storyforge.ttrpg-open-fact-runtime-references'; version: 1;
  runtimeSourceHash: string; rulePackContentHash: string; references: Reference[]; proofHash: string;
}
export function parseTtrpgOpenFactRuntimeReferencesV1(value: unknown): TtrpgOpenFactRuntimeReferencesV1 {
  const r = p.record(value, ['schema', 'version', 'runtimeSourceHash', 'rulePackContentHash', 'references', 'proofHash'], 'fact runtime reference proof')
  const references = p.list(r.references, 'fact runtime references', value => {
    const row = p.record(value, ['entityRef', 'audience', 'knownByActorKeys', 'sourceRef', 'operationKey', 'planHash'], 'fact runtime reference')
    return { entityRef: p.key(row.entityRef, 'fact runtime entity'), audience: p.oneOf(row.audience, p.AUDIENCES, 'fact runtime audience'),
      knownByActorKeys: p.keys(row.knownByActorKeys, 'fact runtime recipients', 1000), sourceRef: parseTtrpgOpenSourceRefV1(row.sourceRef),
      operationKey: p.key(row.operationKey, 'fact runtime operation'), planHash: p.hash(row.planHash, 'fact runtime plan') }
  }, 2, 1)
  p.unique(references.map(row => row.entityRef), 'fact runtime entity refs')
  if (stable(references.map(row => row.entityRef)) !== stable(references.map(row => row.entityRef).sort())) p.fail('运行事实引用必须保留规范顺序')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-fact-runtime-references', 'fact runtime reference schema'),
    version: p.literal(r.version, 1, 'fact runtime reference version'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'fact runtime source'),
    rulePackContentHash: p.hash(r.rulePackContentHash, 'fact runtime rules'), references, proofHash: p.hash(r.proofHash, 'fact runtime reference hash') }
}
function committedReferences(operations: readonly TtrpgOpenEntityOperationV1[], source: { runtimeSourceHash: string; rulePackContentHash: string }) {
  return operations.flatMap(raw => {
    const operation = parseTtrpgOpenEntityOperationV1(raw)
    if (operation.resolution?.kind !== 'materialized') return []
    if (operation.plan.runtimeSourceHash !== source.runtimeSourceHash || operation.plan.rulePackContentHash !== source.rulePackContentHash) p.fail('运行事实引用不属于实际冻结来源')
    // This is the exact already-committed F13 source evidence, not a synthesized Campaign or live attributes.
    const content = p.json(operation.plan.frozenContentJson) as TtrpgRuntimeContentV2
    return ttrpgOpenEntityIdentityCatalogV1(content, [operation]).filter(row => row.dynamic).map(row => ({
      entityRef: row.entityKey, audience: row.audience, knownByActorKeys: [...row.recipientActorKeys], sourceRef: operation.resolution!.sourceRef,
      operationKey: operation.plan.operationKey, planHash: operation.plan.planHash,
    }))
  })
}
export async function createTtrpgOpenFactRuntimeReferencesV1(input: {
  runtimeSourceHash: string; rulePackContentHash: string; operations: readonly TtrpgOpenEntityOperationV1[];
  entityRefs: readonly string[]; frozenEntityRefs: readonly string[];
}): Promise<TtrpgOpenFactRuntimeReferencesV1> {
  const catalog = committedReferences(input.operations, input)
  const references = [...new Set(input.entityRefs)].sort().filter(key => !input.frozenEntityRefs.includes(key))
    .map(key => catalog.find(row => row.entityRef === key) ?? p.fail('运行事实只能引用已实际 F13 创建的实体'))
  if (!references.length) p.fail('运行实体事实需要至少一个实际创建引用；冻结引用继续使用原事实入口')
  const body = { schema: 'storyforge.ttrpg-open-fact-runtime-references' as const, version: 1 as const,
    runtimeSourceHash: input.runtimeSourceHash, rulePackContentHash: input.rulePackContentHash, references }
  return parseTtrpgOpenFactRuntimeReferencesV1({ ...body, proofHash: await hash(body) })
}
/** Replay needs the actual prior F13 journal; a valid self-hash or model-supplied identity is insufficient. */
export function assertTtrpgOpenFactRuntimeReferencesV1(input: {
  proof: TtrpgOpenFactRuntimeReferencesV1; runtimeSourceHash: string; rulePackContentHash: string;
  operations: readonly TtrpgOpenEntityOperationV1[]; entityRefs: readonly string[]; frozenEntityRefs: readonly string[];
  factSourceRef: TtrpgOpenSourceRefV1;
}) {
  const proof = parseTtrpgOpenFactRuntimeReferencesV1(input.proof), catalog = committedReferences(input.operations, input)
  const expected = [...new Set(input.entityRefs)].sort().filter(key => !input.frozenEntityRefs.includes(key))
    .map(key => catalog.find(row => row.entityRef === key) ?? p.fail('运行事实引用没有真实 F13 来源'))
  if (proof.runtimeSourceHash !== input.runtimeSourceHash || proof.rulePackContentHash !== input.rulePackContentHash
    || stable(proof.references) !== stable(expected)
    || expected.some(row => row.sourceRef.sessionKey === input.factSourceRef.sessionKey && row.sourceRef.sequence >= input.factSourceRef.sequence)) p.fail('运行事实引用与准确原实例、接收者或实际创建顺序不一致')
  return proof.references
}
export async function verifyTtrpgOpenFactRuntimeReferenceHashV1(value: TtrpgOpenFactRuntimeReferencesV1) {
  const { proofHash, ...body } = parseTtrpgOpenFactRuntimeReferencesV1(value)
  if (await hash(body) !== proofHash) p.fail('运行事实引用证据已经损坏')
}
