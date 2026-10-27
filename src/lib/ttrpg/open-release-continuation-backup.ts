/** Portable continuation evidence is checked before any imported records are written. */
import type { ProductRuntimeEvent, ProductRuntimeSession } from '../types'
import { isTtrpgRuntimeContentV2, type TtrpgRuntimeContentV2, type ProductRuntimePackageWithTtrpgV2 } from './content-version'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenAuthorizationV1 } from './open-authorization'
import { prepareTtrpgOpenContinuationStartV1 } from './open-release-continuation-start'
import { verifyTtrpgOpenReleaseContinuationRuntimeV1 } from './open-release-continuation-proof'
import { assertTtrpgOpenReleaseCompatibilityV1 } from './open-release-compatibility'
import { projectTtrpgOpenBranchStateV1 } from './open-branch'
import { continueTtrpgOpenFactLedger, createTtrpgOpenFactBasisV1 } from './open-fact-ledger'
import { assertTtrpgOpenPressureGmV1 } from './open-pressure-cycle'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

type Session = Pick<ProductRuntimeSession, 'initialStateJson' | 'runtimeSourceHash' | 'seed'>
export async function assertTtrpgOpenContinuationParentV1(input: {
  parent: Session; child: Session; parentEvents: readonly ProductRuntimeEvent[]; throughSequence: number
  parentContent: TtrpgRuntimeContentV2; targetContent: TtrpgRuntimeContentV2; targetRuntimePackage: ProductRuntimePackageWithTtrpgV2
}) {
  const initial = parseProductRuntimeState(JSON.parse(input.child.initialStateJson)), runtime = parseTtrpgRuntimeStateV2(initial.ttrpg)
  const receipt = runtime?.openRun?.releaseContinuation
  if (!receipt || receipt.plan.childSessionKey !== runtime!.sessionKey) throw new Error('[ttrpg-continuation-backup] 缺少明确续团初态')
  await verifyTtrpgOpenReleaseContinuationRuntimeV1({ runtime: runtime!, runtimeSourceHash: input.child.runtimeSourceHash, seed: input.child.seed, initialState: initial })
  const parent = replayProductRuntimeEvents(parseProductRuntimeState(JSON.parse(input.parent.initialStateJson)), input.parentEvents.filter(e => e.sequence <= input.throughSequence))
  const original = parseTtrpgRuntimeStateV2(parent.ttrpg), capsule = runtime!.branchLineage!.ancestors[runtime!.branchLineage!.ancestors.length - 1]!, { plan } = receipt
  if (!original?.openRun || !original.authorization || parent.lastSequence !== input.throughSequence
    || plan.parentSequence !== input.throughSequence || plan.parentSessionKey !== original.sessionKey
    || plan.parentStateHash !== await hashProductRuntimeStateV1(parent)
    || plan.parentRuntimeSourceHash !== input.parent.runtimeSourceHash || input.parent.seed !== input.child.seed
    || plan.parentContentHash !== await hash(input.parentContent) || plan.targetContentHash !== await hash(input.targetContent)
    || stable(capsule.snapshot) !== stable({ authorization: original.authorization, openRun: original.openRun })
    || stable(runtime!.branchLineage!.ancestors.slice(0, -1)) !== stable(original.branchLineage?.ancestors ?? [])) {
    throw new Error('[ttrpg-continuation-backup] 续团与原真实切点不一致')
  }
  assertTtrpgOpenReleaseCompatibilityV1(input.parentContent, input.targetContent)
  assertTtrpgOpenPressureGmV1(original.authorization, plan.approvedBy)
  if (stable(plan.selectedActorKeys) !== stable(original.authorization.selectedActorKeys)
    || original.product.safety.status !== 'active'
    || original.openRun.worldTime.worldTurn >= input.targetContent.campaign.stageClosurePolicy.maximumWorldTurns) {
    throw new Error('[ttrpg-continuation-backup] 续团原队伍、授权或世界轮次上限不一致')
  }
  const pendingLineage = structuredClone(runtime!.branchLineage!)
  for (const task of pendingLineage.recoveryTasks) if (plan.interrupted.some(item => item.taskKey === task.taskKey)) task.status = 'awaiting-authorization'
  const expected = projectTtrpgOpenBranchStateV1(parent, runtime!.sessionKey, pendingLineage)
  const projected = parseTtrpgRuntimeStateV2(expected.ttrpg)!
  projected.branchLineage = structuredClone(runtime!.branchLineage)
  delete projected.openRun!.releaseContinuation
  if (projected.openRun!.factLedger) projected.openRun!.factLedger = continueTtrpgOpenFactLedger(projected.openRun!.factLedger,
    await createTtrpgOpenFactBasisV1(input.targetContent, input.child.runtimeSourceHash))
  projected.openRun!.releaseContinuation = structuredClone(receipt)
  expected.ttrpg = projected
  const { createProductInitialStateV1 } = await import('../product/runtime-instances')
  expected.narrative = createProductInitialStateV1({ runtimePackage: input.targetRuntimePackage, runtimeSourceHash: input.child.runtimeSourceHash }).narrative
  if (stable(expected) !== stable(initial)) throw new Error('[ttrpg-continuation-backup] 续团不得改写原资源、事实、知识、消耗或行动状态')
}

export async function assertTtrpgOpenContinuationBackupV1(backup: Record<string, unknown>): Promise<void> {
  const sessions = backup.productRuntimeSessions, events = backup.productRuntimeEvents
  const releases = Array.isArray(backup.productReleases) ? backup.productReleases : []
  const checked = new Map<number, Awaited<ReturnType<typeof verifyProductReleaseManifestV1>>>()
  if (!Array.isArray(sessions) || !Array.isArray(events)) throw new Error('[ttrpg-continuation-backup] 缺少实例或事件表')
  const grouped = new Map<number, typeof events>()
  for (const event of events) { const own = grouped.get(event._productRuntimeSessionExportId) ?? []; own.push(event); grouped.set(event._productRuntimeSessionExportId, own) }
  for (const session of sessions) {
    if (session.kind !== 'ttrpg') continue
    const raw = JSON.parse(session.initialStateJson)
    if (!raw.ttrpg?.openRun?.releaseContinuation) continue
    const initial = parseProductRuntimeState(raw), runtime = parseTtrpgRuntimeStateV2(initial.ttrpg)!
    if (!runtime.openRun?.releaseContinuation) continue
    const releaseId = session._productReleaseExportId, release = releases.find(row => row._exportId === releaseId)
    if (!release) throw new Error('[ttrpg-continuation-backup] 续团缺少当前正式发布')
    const manifest = checked.get(releaseId) ?? await verifyProductReleaseManifestV1(release.manifestJson, { ttrpgProtocol: 2 })
    checked.set(releaseId, manifest)
    const content = manifest.runtimePackage.ttrpg
    if (!content || !isTtrpgRuntimeContentV2(content) || manifest.packageHash !== session.runtimeSourceHash
      || await hash(content) !== runtime.openRun.releaseContinuation.plan.targetContentHash) throw new Error('[ttrpg-continuation-backup] 续团来源不匹配实际发布')
    await verifyTtrpgOpenReleaseContinuationRuntimeV1({ runtime, runtimeSourceHash: session.runtimeSourceHash, seed: session.seed, initialState: initial })
    let state = initial
    for (const row of [...(grouped.get(session._exportId) ?? [])].sort((a, b) => a.sequence - b.sequence)) {
      const payload = JSON.parse(row._portablePayloadJson ?? row.payloadJson)
      if (payload?.envelope && typeof payload.envelope === 'object' && payload.envelope.sessionId === session._exportId) payload.envelope.sessionId = session._exportId + 1
      const event: ProductRuntimeEvent = { ...row, projectId: 0, sessionId: session._exportId + 1,
        worldGroupId: session._worldGroupExportId ?? null, payloadJson: JSON.stringify(payload) }
      if (event.type === 'ttrpg.session-zero.completed' && payload.continuationOpening) {
        const expected = await prepareTtrpgOpenContinuationStartV1({ state, authorization: parseTtrpgOpenAuthorizationV1(payload.authorization),
          content: payload.continuationOpening.frozenContent })
        if (stable(expected) !== stable(payload.continuationOpening)) throw new Error('[ttrpg-continuation-backup] 续团开局预览与原真实前态不一致')
      }
      state = applyProductRuntimeEvent(state, event)
    }
  }
}
