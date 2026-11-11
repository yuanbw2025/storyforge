import type {
  AnyProductRuntimePackage,
  ProductProductionBriefRecordV1,
  ProductProductionCommandV1,
  ProductProductionRecordV1,
  WorkspaceScope,
} from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'

/** A task's plain execution data is fixed before admission yields. Signal
 * and durable output callbacks retain their original capability identities. */
export function captureTextOpenWorldTaskExecutionInputV1(
  execution: ProductProductionTaskExecutionInputV1,
): ProductProductionTaskExecutionInputV1 {
  return { ...execution,
    scope: structuredClone(execution.scope), task: structuredClone(execution.task),
    inputArtifacts: structuredClone(execution.inputArtifacts), capabilityBindings: structuredClone(execution.capabilityBindings),
    authorResolution: structuredClone(execution.authorResolution),
    ...(execution.attemptBudgetReservation === undefined ? {} : {
      attemptBudgetReservation: structuredClone(execution.attemptBudgetReservation),
    }),
  }
}

export const TEXT_OPEN_WORLD_WORLD_SOURCE_REQUIRED_V1 =
  '文字开放世界的新操作必须使用已封存 WorldRelease。小说请先显式派生世界草稿，检查并封存后重新定向；旧小说来源仅供只读核验、回放、导出和证据恢复。'

export class TextOpenWorldSourceAdmissionErrorV1 extends Error {
  constructor(readonly operation: string) {
    super(`[text-open-world-source-admission] ${TEXT_OPEN_WORLD_WORLD_SOURCE_REQUIRED_V1}（${operation}）`)
    this.name = 'TextOpenWorldSourceAdmissionErrorV1'
  }
}

/** Additional permission check for a new operation, never a replacement for
 * the existing strict source/owner/hash/rights verifiers. Historical codecs
 * and evidence readers must not call this write-admission boundary. */
export function assertTextOpenWorldNewSourceV1(kind: unknown, operation: string): void {
  if (kind !== 'world-release') throw new TextOpenWorldSourceAdmissionErrorV1(operation)
}

function sourceBindingKind(json: string, operation: string): unknown {
  let value: unknown
  try { value = JSON.parse(json) }
  catch { throw new TextOpenWorldSourceAdmissionErrorV1(operation) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TextOpenWorldSourceAdmissionErrorV1(operation)
  }
  const binding = (value as Record<string, unknown>).sourceBinding
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new TextOpenWorldSourceAdmissionErrorV1(operation)
  }
  return (binding as Record<string, unknown>).kind
}

/** Deny a legacy novel Production's new work without reinterpreting a null
 * local locator. Portable WorldRelease records may legitimately have no local
 * release id; their existing frozen contracts remain authoritative. */
export function assertTextOpenWorldProductionNewWorkV1(
  production: ProductProductionRecordV1,
  brief: ProductProductionBriefRecordV1 | null | undefined,
  operation: string,
): void {
  if (production.productType !== 'text-open-world') return
  if (production.creatorSourceKind != null) {
    assertTextOpenWorldNewSourceV1(production.creatorSourceKind, operation)
  }
  if (brief?.briefKind === 'text-open-world-creator-v1') {
    if (brief.sourceKind != null) assertTextOpenWorldNewSourceV1(brief.sourceKind, operation)
    assertTextOpenWorldNewSourceV1(sourceBindingKind(brief.briefJson, operation), operation)
  }
}

/** Stopping, archival, immutable preview lookup and provider-accounting repair
 * do not grant execution. In particular, recording already observed usage or
 * cancelling an unknown result must remain possible for legacy Productions. */
export function textOpenWorldCommandRequiresNewSourceV1(command: ProductProductionCommandV1): boolean {
  if (['pause', 'stop', 'archive', 'restore', 'request-preview', 'book-original-response', 'book-local-no-dispatch'].includes(command.type)) {
    return false
  }
  return command.type !== 'resolve-blocker' || command.resolution.action !== 'cancel'
}

/** Read-only UI projection. Parse the real frozen Creator Brief and its
 * binding hashes; a catalog policy or nullable local locator is not evidence
 * that an existing production has a novel source. */
export async function readTextOpenWorldProductionSourceKindV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<'world-release' | 'novel' | 'not-applicable'> {
  input = { ...input, scope: structuredClone(input.scope) }
  const [{ db }, { assertRecordInScope }, { verifyTextOpenWorldCreatorBriefV1 }, { canonicalProductProductionJsonV2 }] = await Promise.all([
    import('../db/schema'), import('../workspace/scope'), import('./creator-brief-persistence'),
    import('../product-production/hash'),
  ])
  const production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[text-open-world-source-admission] 当前制作不存在或不属于当前 Work。')
  }
  if (production.productType !== 'text-open-world') return 'not-applicable'
  const row = production.currentBriefRevision == null ? null : await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (row?.briefKind !== 'text-open-world-creator-v1') {
    if (production.creatorSourceKind != null) throw new Error('[text-open-world-source-admission] 缺少可验证的 Creator 来源。')
    return 'not-applicable'
  }
  if (!await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })) {
    throw new Error('[text-open-world-source-admission] Creator Brief 不属于当前 Work。')
  }
  const brief = await verifyTextOpenWorldCreatorBriefV1(row.briefJson)
  let productionBinding: unknown
  try { productionBinding = JSON.parse(production.creatorSourceBindingJson ?? '') }
  catch { throw new Error('[text-open-world-source-admission] Creator 来源绑定损坏。') }
  if (row.briefHash !== brief.briefHash || row.sourceBindingHash !== brief.sourceBindingHash
    || row.sourceBindingJson !== canonicalProductProductionJsonV2(brief.sourceBinding)
    || production.creatorSourceBindingHash !== brief.sourceBindingHash
    || canonicalProductProductionJsonV2(productionBinding) !== row.sourceBindingJson
    || production.creatorSourceKind !== brief.sourceBinding.kind || row.sourceKind !== brief.sourceBinding.kind) {
    throw new Error('[text-open-world-source-admission] Creator 来源与冻结 Brief 证据不一致。')
  }
  return brief.sourceBinding.kind
}

/** The package has already passed the frozen codec/hash/source verification.
 * Its embedded source identity, rather than an optional local World id,
 * determines whether it can authorize new runtime state. */
export function assertTextOpenWorldRuntimeNewWorkV1(
  runtimePackage: AnyProductRuntimePackage,
  operation: string,
): void {
  if (runtimePackage.productType !== 'text-open-world') return
  if (runtimePackage.textOpenWorldVNext) {
    assertTextOpenWorldNewSourceV1(runtimePackage.textOpenWorldVNext.sourceManifest.kind, operation)
  }
}

/** New product-owned requests must be authorized by the verified immutable
 * Session source before allocating a Run or dispatching a model. The generic
 * frozen-source verifier remains available for historical reads. */
export async function assertTextOpenWorldSessionNewWorkV1(input: {
  scope: WorkspaceScope
  sessionId: number
  operation: string
}): Promise<void> {
  input = { ...input, scope: structuredClone(input.scope) }
  const [{ db }, { verifyFormalRuntimeSourceV1 }] = await Promise.all([
    import('../db/schema'), import('../product/runtime-core'),
  ])
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session || session.kind !== 'text-open-world'
    || session.projectId !== input.scope.projectId || session.worldId !== input.scope.worldId
    || session.workId !== input.scope.workId) {
    throw new Error('[text-open-world-source-admission] 运行请求不属于当前文字开放世界实例。')
  }
  const source = await verifyFormalRuntimeSourceV1(session, ['text-open-world'])
  assertTextOpenWorldRuntimeNewWorkV1(source.runtimePackage, input.operation)
}

/** Product-owned execution gate for direct task/provider entry points. It
 * resolves only the existing Production/Build/Brief ownership graph; the
 * registered source reader still verifies the actual frozen world resources. */
export async function assertTextOpenWorldBuildNewWorkV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  operation: string
}): Promise<void> {
  input = { ...input, scope: structuredClone(input.scope) }
  const [{ db }, { assertRecordInScope }] = await Promise.all([
    import('../db/schema'), import('../workspace/scope'),
  ])
  const [production, build] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId),
  ])
  if (!production || !build || production.productType !== 'text-open-world'
    || build.productionId !== production.id
    || production.currentBuildNumber !== build.buildNumber
    || production.currentBriefRevision !== build.briefRevision || production.controlEpoch !== build.controlEpoch
    || !['producing', 'preview-ready'].includes(production.status)
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[text-open-world-source-admission] 新制作请求缺少当前 Work 的 Production/Build。')
  }
  const brief = await db.productProductionBriefs.where('[productionId+revision]')
    .equals([production.id!, build.briefRevision]).first()
  if (!brief || brief.status !== 'authorized' || brief.briefHash !== build.briefHash
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', brief, { owner: 'work' })) {
    throw new Error('[text-open-world-source-admission] 新制作请求缺少对应的冻结 Brief。')
  }
  assertTextOpenWorldProductionNewWorkV1(production, brief, input.operation)
  if (brief.briefKind === 'text-open-world-creator-v1') {
    const { readTextOpenWorldCreatorBuildNewWorkAuthorityV1 } = await import('./creator-derived-authority')
    const authority = await readTextOpenWorldCreatorBuildNewWorkAuthorityV1({ scope: input.scope,
      buildId: input.buildId, operation: input.operation })
    if (authority.production.id !== input.productionId) throw new Error('[text-open-world-source-admission] 冻结制作身份不一致。')
  }
}
