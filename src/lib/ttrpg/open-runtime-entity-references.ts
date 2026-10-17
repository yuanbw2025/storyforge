/** Immutable instance identities for versioned consumers. A snapshot grants no read, action or adoption permission. */
import type { TtrpgOpenOracleReceiptV1 } from './open-oracle-contract'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenAudience, TtrpgOpenEntityKind } from './open-contract'
import type { TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1, ttrpgOpenAncestorSourceAllowedV1 } from './open-coordination'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export interface TtrpgOpenRuntimeEntityReferenceV1 {
  entityRef: string; kind: TtrpgOpenEntityKind; templateKey: string; dynamicTemplateKey: string | null;
  audience: TtrpgOpenAudience; recipientActorKeys: string[];
  sourceRef: TtrpgOpenSourceRefV1; operationKey: string; planHash: string;
}
export interface TtrpgOpenRuntimeEntityReferencesV1 {
  schema: 'storyforge.ttrpg-open-runtime-entity-references'; version: 1;
  runtimeSourceHash: string; rulePackContentHash: string; references: TtrpgOpenRuntimeEntityReferenceV1[]; snapshotHash: string;
}
/** The new policy is optional in old windows. Its absence must keep the original source and candidate grammar. */
export interface TtrpgOpenSituationRuntimeReferencePolicyV1 {
  schema: 'storyforge.ttrpg-open-situation-runtime-reference-policy'; version: 1;
  consumer: 'private-gm' | 'common-party'; references: TtrpgOpenRuntimeEntityReferencesV1;
}
export function parseTtrpgOpenSituationRuntimeReferencePolicyV1(value: unknown): TtrpgOpenSituationRuntimeReferencePolicyV1 {
  const r = p.record(value, ['schema', 'version', 'consumer', 'references'], 'situation runtime reference policy')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-situation-runtime-reference-policy', 'runtime reference policy schema'),
    version: p.literal(r.version, 1, 'runtime reference policy version'), consumer: p.oneOf(r.consumer, ['private-gm', 'common-party'], 'runtime reference consumer'),
    references: parseTtrpgOpenRuntimeEntityReferencesV1(r.references) }
}
export function parseTtrpgOpenRuntimeEntityReferencesV1(value: unknown): TtrpgOpenRuntimeEntityReferencesV1 {
  const r = p.record(value, ['schema', 'version', 'runtimeSourceHash', 'rulePackContentHash', 'references', 'snapshotHash'], 'runtime entity references')
  const references = p.list(r.references, 'runtime entity reference rows', value => {
    const row = p.record(value, ['entityRef', 'kind', 'templateKey', 'dynamicTemplateKey', 'audience', 'recipientActorKeys', 'sourceRef', 'operationKey', 'planHash'], 'runtime entity reference')
    const entityRef = p.key(row.entityRef, 'committed instance identity'), audience = p.oneOf(row.audience, p.AUDIENCES, 'committed instance audience')
    const recipientActorKeys = p.keys(row.recipientActorKeys, 'committed instance recipients', 1000)
    if (!/^entity\.[a-f0-9]{48}(?:\.equipment\.(?:0|[1-9][0-9]*))?$/.test(entityRef)
      || audience === 'gm-only' && recipientActorKeys.length || audience === 'private' && !recipientActorKeys.length) p.fail('运行实例引用身份或准确接收者不闭合')
    return { entityRef, kind: p.oneOf(row.kind, ['actor', 'location', 'item'], 'committed instance kind'), templateKey: p.key(row.templateKey, 'original instance definition'),
      dynamicTemplateKey: p.nullable(row.dynamicTemplateKey, p.key, 'original dynamic instance template'), audience, recipientActorKeys,
      sourceRef: parseTtrpgOpenSourceRefV1(row.sourceRef), operationKey: p.key(row.operationKey, 'original instance operation'), planHash: p.hash(row.planHash, 'original instance plan') }
  }, 10000)
  const keys = references.map(row => row.entityRef)
  p.unique(keys, 'runtime entity reference identities')
  if (stable(keys) !== stable([...keys].sort())) p.fail('运行实例引用须保留规范顺序')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-runtime-entity-references', 'runtime entity reference schema'), version: p.literal(r.version, 1, 'runtime entity reference version'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'runtime reference source'), rulePackContentHash: p.hash(r.rulePackContentHash, 'runtime reference rules'), references,
    snapshotHash: p.hash(r.snapshotHash, 'runtime reference snapshot hash') }
}
type Journal = { content: TtrpgRuntimeContentV2; operations: readonly TtrpgOpenEntityOperationV1[]; runtimeSourceHash: string }
/** Caller must obtain the journal from the trusted replay/source loader; neither a model nor an imported snapshot can grant it. */
function referenceBody(input: Journal & { entityRefs?: readonly string[] }) {
  const operations = input.operations.map(parseTtrpgOpenEntityOperationV1).filter(row => row.resolution?.kind === 'materialized')
  const catalog = ttrpgOpenEntityIdentityCatalogV1(input.content, operations)
  const sourceKey = (ref: TtrpgOpenSourceRefV1) => stable(ref), frozenContentJson = stable(input.content)
  const originKeys = operations.map(row => sourceKey(row.resolution!.sourceRef))
  p.unique(originKeys, 'runtime entity creation events')
  const origins = new Map(operations.map((row, index) => [originKeys[index], row]))
  const eligible = catalog.filter(row => row.dynamic)
  if (input.entityRefs && (new Set(input.entityRefs).size !== input.entityRefs.length || input.entityRefs.some(key => !eligible.some(row => row.entityKey === key)))) p.fail('运行实例引用选择包含重复、未创建或冻结绑定身份')
  const references = eligible.filter(row => !input.entityRefs || input.entityRefs.includes(row.entityKey)).map(row => {
    const operation = origins.get(sourceKey(row.sourceRef!))
      ?? p.fail('运行实例引用缺少原创建回执')
    if (operation.plan.runtimeSourceHash !== input.runtimeSourceHash || operation.plan.rulePackContentHash !== input.content.rulePack.contentHash
      || operation.plan.frozenContentJson !== frozenContentJson) p.fail('运行实例引用不属于实际冻结来源和原定义')
    return { entityRef: row.entityKey, kind: row.kind, templateKey: row.templateKey, dynamicTemplateKey: row.dynamicTemplateKey,
      audience: row.audience, recipientActorKeys: [...row.recipientActorKeys], sourceRef: { ...row.sourceRef! },
      operationKey: operation.plan.operationKey, planHash: operation.plan.planHash }
  }).sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  return { schema: 'storyforge.ttrpg-open-runtime-entity-references' as const, version: 1 as const,
    runtimeSourceHash: input.runtimeSourceHash, rulePackContentHash: input.content.rulePack.contentHash, references }
}
export async function createTtrpgOpenRuntimeEntityReferencesV1(input: Journal & { entityRefs?: readonly string[] }): Promise<TtrpgOpenRuntimeEntityReferencesV1> {
  const body = referenceBody(input)
  return parseTtrpgOpenRuntimeEntityReferencesV1({ ...body, snapshotHash: await hash(body) })
}
/** Exact immutable rows from original F13 journals; no permission is granted by this projection. */
export function ttrpgOpenRuntimeEntityReferenceJournalRowsV1(operations: readonly TtrpgOpenEntityOperationV1[], runtimeSourceHash: string) {
  const rows = operations.map(parseTtrpgOpenEntityOperationV1).filter(row => row.resolution?.kind === 'materialized').flatMap(operation => {
    const content = p.json(operation.plan.frozenContentJson) as TtrpgRuntimeContentV2
    return referenceBody({ content, operations: [operation], runtimeSourceHash }).references
  })
  p.unique(rows.map(row => row.entityRef), 'actual runtime entity references')
  return rows
}
/** Synchronous replay checks the actual prior F13 records; live source loading separately verifies hashes and frozen content. */
export function assertTtrpgOpenSituationRuntimeReferenceJournalV1(input: {
  policy: TtrpgOpenSituationRuntimeReferencePolicyV1; operations: readonly TtrpgOpenEntityOperationV1[];
  recipientActorKeys: readonly string[]; rulePackContentHash: string; consumerRef: TtrpgOpenSourceRefV1;
}) {
  const policy = parseTtrpgOpenSituationRuntimeReferencePolicyV1(input.policy), snapshot = policy.references
  const rows = ttrpgOpenRuntimeEntityReferenceJournalRowsV1(input.operations, snapshot.runtimeSourceHash)
  const eligible = rows.filter(row => policy.consumer === 'private-gm' || input.recipientActorKeys.length > 0
    && input.recipientActorKeys.every(actor => ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actor, false, true)))
    .sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  if (!snapshot.references.length || snapshot.rulePackContentHash !== input.rulePackContentHash || stable(snapshot.references) !== stable(eligible)
    || eligible.some(row => row.sourceRef.sessionKey === input.consumerRef.sessionKey && row.sourceRef.sequence >= input.consumerRef.sequence)) p.fail('局势实例读取策略没有准确的原创建切点及本次接收者范围')
}
/** Hash verification establishes portable integrity only; the actual journal must be matched separately. */
export async function verifyTtrpgOpenRuntimeEntityReferencesHashV1(value: TtrpgOpenRuntimeEntityReferencesV1) {
  const { snapshotHash, ...body } = parseTtrpgOpenRuntimeEntityReferencesV1(value)
  if (await hash(body) !== snapshotHash) p.fail('运行实例引用快照已经损坏')
}
export async function assertTtrpgOpenRuntimeEntityReferencesMatchV1(input: Journal & { snapshot: TtrpgOpenRuntimeEntityReferencesV1 } & (
  { mode: 'current'; entityRefs?: readonly string[] } | { mode: 'historical'; consumerRef: TtrpgOpenSourceRefV1 }
)) {
  await verifyTtrpgOpenRuntimeEntityReferencesHashV1(input.snapshot)
  const snapshot = parseTtrpgOpenRuntimeEntityReferencesV1(input.snapshot)
  const actual = await createTtrpgOpenRuntimeEntityReferencesV1({ ...input, ...(input.mode === 'current' && input.entityRefs ? { entityRefs: input.entityRefs } : {}) })
  if (snapshot.runtimeSourceHash !== actual.runtimeSourceHash || snapshot.rulePackContentHash !== actual.rulePackContentHash) p.fail('运行实例引用属于其他冻结来源')
  if (input.mode === 'current') {
    if (stable(snapshot) !== stable(actual)) p.fail('运行实例引用与当前完整选择不一致')
  } else if (snapshot.references.some(row => !actual.references.some(original => stable(original) === stable(row))
    || row.sourceRef.sessionKey === input.consumerRef.sessionKey && row.sourceRef.sequence >= input.consumerRef.sequence)) p.fail('历史运行实例引用没有准确的先前实际创建来源')
}

/** Versioned Oracle identity scope. Integrity alone never grants viewer, model or adoption authority. */
export interface TtrpgOpenOracleRuntimeReferencePolicyV1 {
  schema: 'storyforge.ttrpg-open-oracle-runtime-reference-policy'; version: 1;
  oracleSourceRef: TtrpgOpenSourceRefV1; audience: 'public' | 'party' | 'gm-only';
  recipientActorKeys: string[];
  references: TtrpgOpenRuntimeEntityReferencesV1;
}
export function parseTtrpgOpenOracleRuntimeReferencePolicyV1(value: unknown): TtrpgOpenOracleRuntimeReferencePolicyV1 {
  const r = p.record(value, ['schema', 'version', 'oracleSourceRef', 'audience', 'recipientActorKeys', 'references'], 'Oracle runtime reference policy')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-oracle-runtime-reference-policy', 'Oracle reference schema'),
    version: p.literal(r.version, 1, 'Oracle reference version'), oracleSourceRef: parseTtrpgOpenSourceRefV1(r.oracleSourceRef),
    audience: p.oneOf(r.audience, ['public', 'party', 'gm-only'], 'Oracle reference audience'),
    recipientActorKeys: p.keys(r.recipientActorKeys, 'Oracle reference original recipients', 1000),
    references: parseTtrpgOpenRuntimeEntityReferencesV1(r.references) }
}
/** A party scope is the actual current intersection, including late seats; knowing an NPC never includes its equipment. */
function eligible(row: Pick<TtrpgOpenRuntimeEntityReferenceV1, 'audience' | 'recipientActorKeys'>, audience: TtrpgOpenOracleRuntimeReferencePolicyV1['audience'], recipients: readonly string[]) {
  if (audience === 'gm-only') return true
  if (row.audience === 'public') return true
  return audience === 'party' && row.audience === 'party' && recipients.length > 0
    && recipients.every(actor => ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actor, false, true))
}
type Oracle = Pick<TtrpgOpenOracleReceiptV1, 'sourceRef' | 'audience'>
/** Pure source matching for event replay. The caller supplies the real prior journal and real recorded consultation. */
export function assertTtrpgOpenOracleRuntimeReferenceJournalV1(input: {
  policy: TtrpgOpenOracleRuntimeReferencePolicyV1; operations: readonly TtrpgOpenEntityOperationV1[];
  oracle: Oracle; recipientActorKeys: readonly string[]; runtimeSourceHash: string; rulePackContentHash: string;
  consumerRef: TtrpgOpenSourceRefV1;
}) {
  const policy = parseTtrpgOpenOracleRuntimeReferencePolicyV1(input.policy), snapshot = policy.references
  const rows = ttrpgOpenRuntimeEntityReferenceJournalRowsV1(input.operations, input.runtimeSourceHash)
  // Later F13 events cannot retroactively change a frozen window's exact original scope.
  const earlier = rows.filter(row => row.sourceRef.sessionKey !== input.consumerRef.sessionKey || row.sourceRef.sequence < input.consumerRef.sequence)
  const expected = earlier.filter(row => eligible(row, input.oracle.audience, input.recipientActorKeys))
    .sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  if (!expected.length || !input.recipientActorKeys.length || policy.audience !== input.oracle.audience || stable(policy.oracleSourceRef) !== stable(input.oracle.sourceRef)
    || stable(policy.recipientActorKeys) !== stable(input.recipientActorKeys)
    || snapshot.runtimeSourceHash !== input.runtimeSourceHash || snapshot.rulePackContentHash !== input.rulePackContentHash
    || stable(snapshot.references) !== stable(expected)
    || input.oracle.sourceRef.sessionKey === input.consumerRef.sessionKey && input.oracle.sourceRef.sequence >= input.consumerRef.sequence) {
    p.fail('Oracle 实例策略缺少准确原咨询、先前创建切点或本次全部接收者权限')
  }
  return policy
}
/** Build from already verified sources only. This function neither opens a window nor invokes a model. */
export function ttrpgOpenOracleRuntimeReferenceKeysV1(input: {
  operations: readonly TtrpgOpenEntityOperationV1[]; runtimeSourceHash: string; oracle: Oracle;
  recipientActorKeys: readonly string[]; consumerRef: TtrpgOpenSourceRefV1;
}): string[] {
  return ttrpgOpenRuntimeEntityReferenceJournalRowsV1(input.operations, input.runtimeSourceHash)
    .filter(row => eligible(row, input.oracle.audience, input.recipientActorKeys)
      && (row.sourceRef.sessionKey !== input.consumerRef.sessionKey || row.sourceRef.sequence < input.consumerRef.sequence)).map(row => row.entityRef)
}
export async function createTtrpgOpenOracleRuntimeReferencePolicyV1(input: {
  content: TtrpgRuntimeContentV2; operations: readonly TtrpgOpenEntityOperationV1[]; runtimeSourceHash: string;
  oracle: Oracle; recipientActorKeys: readonly string[]; consumerRef: TtrpgOpenSourceRefV1;
}): Promise<TtrpgOpenOracleRuntimeReferencePolicyV1> {
  const entityRefs = ttrpgOpenOracleRuntimeReferenceKeysV1(input)
  const references = await createTtrpgOpenRuntimeEntityReferencesV1({ ...input, entityRefs })
  const policy = parseTtrpgOpenOracleRuntimeReferencePolicyV1({ schema: 'storyforge.ttrpg-open-oracle-runtime-reference-policy', version: 1,
    oracleSourceRef: input.oracle.sourceRef, audience: input.oracle.audience, recipientActorKeys: [...input.recipientActorKeys], references })
  return assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...input, policy, rulePackContentHash: input.content.rulePack.contentHash })
}
export async function verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(policy: TtrpgOpenOracleRuntimeReferencePolicyV1) {
  await verifyTtrpgOpenRuntimeEntityReferencesHashV1(parseTtrpgOpenOracleRuntimeReferencePolicyV1(policy).references)
}

/** An accepted interpretation is a new source, never a renewal of its original model execution. */
export interface TtrpgOpenNormalizationRuntimeReferencePolicyV1 {
  schema: 'storyforge.ttrpg-open-normalization-runtime-reference-policy'; version: 1;
  reviewSourceRef: TtrpgOpenSourceRefV1; reviewHash: string; recipientActorKeys: string[];
  oraclePolicy: TtrpgOpenOracleRuntimeReferencePolicyV1;
}
export function parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(value: unknown): TtrpgOpenNormalizationRuntimeReferencePolicyV1 {
  const row = p.record(value, ['schema', 'version', 'reviewSourceRef', 'reviewHash', 'recipientActorKeys', 'oraclePolicy'], 'normalization runtime reference policy')
  return { schema: p.literal(row.schema, 'storyforge.ttrpg-open-normalization-runtime-reference-policy', 'normalization reference schema'),
    version: p.literal(row.version, 1, 'normalization reference version'), reviewSourceRef: parseTtrpgOpenSourceRefV1(row.reviewSourceRef),
    reviewHash: p.hash(row.reviewHash, 'accepted interpretation hash'), recipientActorKeys: p.keys(row.recipientActorKeys, 'current normalization recipients', 1000, 1),
    oraclePolicy: parseTtrpgOpenOracleRuntimeReferencePolicyV1(row.oraclePolicy) }
}
type NormalizationSource = Pick<Journal, 'content' | 'runtimeSourceHash'> & { runtime: Pick<TtrpgRuntimeStateV2, 'sessionKey' | 'authorization' | 'openRun' | 'branchLineage'>;
  reviewSourceRef: TtrpgOpenSourceRefV1; consumerRef: TtrpgOpenSourceRefV1 }
type NormalizationOrigin = Omit<NormalizationSource, 'content' | 'runtime'> & {
  runtime: Pick<TtrpgRuntimeStateV2, 'sessionKey' | 'openRun' | 'branchLineage'>; rulePackContentHash: string; recipientActorKeys: readonly string[] }
function currentNormalizationOrigin(input: NormalizationSource): NormalizationOrigin {
  const recipients = input.runtime.authorization?.selectedActorKeys
  if (!recipients?.length) p.fail('实例归一需要当前本局已完成的 Session Zero')
  return { ...input, rulePackContentHash: input.content.rulePack.contentHash, recipientActorKeys: recipients }
}
function normalizationSource(input: NormalizationOrigin) {
  const reviewSourceRef = parseTtrpgOpenSourceRefV1(input.reviewSourceRef), consumerRef = parseTtrpgOpenSourceRefV1(input.consumerRef)
  const runtime = input.runtime, current = reviewSourceRef.sessionKey === runtime.sessionKey
  const source = current ? runtime
    : runtime.branchLineage?.ancestors.find(row => row.sessionKey === reviewSourceRef.sessionKey)?.snapshot
  const run = source?.openRun, original = run?.oracleReviews?.find(row => stable(row.sourceRef) === stable(reviewSourceRef))
  const projected = runtime.openRun?.oracleReviews?.find(row => stable(row.sourceRef) === stable(reviewSourceRef))
  const review = projected ?? (!current ? original : undefined)
  const call = original && run?.coordination.calls.find(row => row.requestKey === original.requestKey)
  const epoch = call && run?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  const oracle = original && run?.oracleReceipts?.find(row => stable(row.sourceRef) === stable(original.oracleSourceRef))
  const policy = call?.oracleInterpretation?.runtimeReferencePolicy
  const recipients = [...input.recipientActorKeys]
  if (!review || !original || stable(review) !== stable(original) || review.normalizationOf || review.interpretationDecision !== 'accept'
    || !current && !ttrpgOpenAncestorSourceAllowedV1(runtime.branchLineage, reviewSourceRef, ['ttrpg.open.oracle.reviewed'])
    || !call || !epoch || !oracle || !policy || !recipients?.length || call.skillId !== 'prose.ttrpg-open-oracle-interpret' || call.actorKey !== 'gm'
    || call.status !== 'succeeded' || !call.terminalRef || call.terminalRef.sessionKey !== review.sourceRef.sessionKey || call.terminalRef.sequence >= review.sourceRef.sequence
    || review.authorizationEpochKey !== epoch.epochKey || epoch.viewerKey !== review.viewerKey
    || stable(epoch.oracleRuntimeReferencePolicy) !== stable(policy) || stable(call.oracleInterpretation!.oracleSourceRef) !== stable(policy.oracleSourceRef)
    || review.runContractHash !== call.runContractHash || review.inputManifestHash !== call.inputManifestHash || review.rawResponseHash !== call.responseArtifactHash
    || review.runtimeSourceHash !== call.runtimeSourceHash || call.runtimeSourceHash !== input.runtimeSourceHash
    || stable(review.oracleSourceRef) !== stable(policy.oracleSourceRef) || review.audience !== policy.audience
    || consumerRef.sessionKey !== runtime.sessionKey
    || review.sourceRef.sessionKey === consumerRef.sessionKey && review.sourceRef.sequence >= consumerRef.sequence
    || policy.audience === 'party' && recipients.some(key => !policy.recipientActorKeys.includes(key))) p.fail('实例归一需要原已接受解释、成功的新 Oracle 实例来源及本次准确接收者；旧归一或新加入角色不能借用')
  if (review.choices.some(choice => choice.decision === 'discard' && !eligible({ audience: review.proposals[choice.proposalIndex].audience,
    recipientActorKeys: review.proposals[choice.proposalIndex].knownByActorKeys }, policy.audience, recipients))) p.fail('原弃用提案含本次范围不能读取的私域内容，不能删减原决定或扩大密级来归一')
  assertTtrpgOpenOracleRuntimeReferenceJournalV1({ policy, operations: run!.entityOperations ?? [], oracle,
    recipientActorKeys: policy.recipientActorKeys, runtimeSourceHash: input.runtimeSourceHash,
    rulePackContentHash: input.rulePackContentHash, consumerRef: epoch.startedRef })
  return { review, policy, recipients, oracle }
}
/** A new read always uses the current actual roster; historical scope checks use their recorded window instead. */
export function resolveTtrpgOpenNormalizationRuntimeSourceV1(input: NormalizationSource) { return normalizationSource(currentNormalizationOrigin(input)) }
export function resolveTtrpgOpenNormalizationRuntimeOriginV1(input: NormalizationOrigin) { return normalizationSource(input) }
export function assertTtrpgOpenNormalizationRuntimeReferenceJournalV1(input: NormalizationSource & { policy: TtrpgOpenNormalizationRuntimeReferencePolicyV1 }) {
  return assertTtrpgOpenNormalizationRuntimeReferenceOriginV1({ ...currentNormalizationOrigin(input), policy: input.policy })
}
/** Only matching evidence: the caller derives recipients from the real current or recorded epoch, never a model's claim. */
export function assertTtrpgOpenNormalizationRuntimeReferenceOriginV1(input: NormalizationOrigin & { policy: TtrpgOpenNormalizationRuntimeReferencePolicyV1 }) {
  const policy = parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(input.policy), source = normalizationSource(input)
  if (stable(policy.reviewSourceRef) !== stable(source.review.sourceRef) || policy.reviewHash !== source.review.reviewHash
    || stable(policy.oraclePolicy) !== stable(source.policy) || stable(policy.recipientActorKeys) !== stable(source.recipients)) p.fail('实例归一策略更换了原解释、创建范围或当前接收者')
  return policy
}
/** Source-contract foundation only: no window, model read, request, write or execution permission. */
export async function createTtrpgOpenNormalizationRuntimeReferencePolicyV1(input: NormalizationSource): Promise<TtrpgOpenNormalizationRuntimeReferencePolicyV1> {
  const source = resolveTtrpgOpenNormalizationRuntimeSourceV1(input), { reviewHash, ...body } = source.review
  if (await hash(body) !== reviewHash) p.fail('实例归一的原已接受解释 hash 与完整正文不一致')
  await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(source.policy)
  return assertTtrpgOpenNormalizationRuntimeReferenceJournalV1({ ...input, policy: {
    schema: 'storyforge.ttrpg-open-normalization-runtime-reference-policy', version: 1,
    reviewSourceRef: source.review.sourceRef, reviewHash, recipientActorKeys: [...source.recipients], oraclePolicy: source.policy } })
}
