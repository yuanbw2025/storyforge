import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { hashProductProductionValueV2 } from './hash'
import { assertStableMediaBindings, isTextContentRevisionKeyV1 } from './text-content-revision'

/** Re-check the durable authorization on every dispatch, including recovery. */
export async function validateTextContentRevisionAuthorityV1(
  scope: WorkspaceScope, expectedBuild: Pick<ProductBuildRecordV1, 'id' | 'buildNumber' | 'controlEpoch' | 'planHash'>, task: ProductProductionPlanTaskV3,
): Promise<{ revision: NonNullable<ProductProductionPlanTaskV3['authorRevision']>; authorizedAt: number } | undefined> {
  const revision = task.authorRevision
  if (!revision) return undefined
  const reject = (reason: string): never => { throw new Error(`[text-content-revision] 作者修订授权、原稿或候选已变化：${reason}`) }
  const build = expectedBuild.id == null ? null : await db.productBuilds.get(expectedBuild.id)
  if (!build || build.buildNumber !== expectedBuild.buildNumber || build.controlEpoch !== expectedBuild.controlEpoch
    || build.planHash !== expectedBuild.planHash || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) return reject('当前 Build 已变化')
  if (!isTextContentRevisionKeyV1(task.taskKey) || revision.sourceBuildNumber !== build.parentBuildNumber
    || revision.artifactKey !== task.taskKey) reject('任务或父 Build 不匹配')
  const command = await db.productProductionCommands.where('[productionId+commandId]')
    .equals([build.productionId, revision.commandId]).first()
  if (!command || command.type !== 'revise-text-content' || command.status !== 'succeeded' || command.completedAt == null
    || !await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })) return reject('命令回执不可验证')
  const result = JSON.parse(command.resultJson) as { buildNumber?: number; authorRevisionHashes?: Record<string, string> }
  if (result.buildNumber !== build.buildNumber
    || result.authorRevisionHashes?.[task.taskKey] !== await hashProductProductionValueV2(revision)) reject('候选与授权 hash 不匹配')
  const parent = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([build.productionId, revision.sourceBuildNumber]).first()
  if (!parent?.id || parent.briefHash !== build.briefHash
    || !await assertRecordInScope(scope, 'productBuilds', parent, { owner: 'work' })) return reject('父 Build 或 Brief 不匹配')
  const originals = (await db.productBuildArtifacts.where('buildId').equals(parent.id).toArray()).filter(row =>
    row.controlEpoch === parent.controlEpoch && row.artifactKey === task.taskKey
    && row.version === revision.expectedArtifactVersion && row.contentHash === revision.expectedArtifactHash
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (originals.length !== 1 || !await assertRecordInScope(scope, 'productBuildArtifacts', originals[0], { owner: 'work' })
    || await hashProductProductionValueV2(JSON.parse(originals[0].payloadJson)) !== revision.expectedArtifactHash) reject('原稿或原稿 hash 不匹配')
  return { revision, authorizedAt: command.completedAt! }
}

export function isTextRevisionRetainedVisualTaskV1(task: ProductProductionPlanTaskV3): boolean {
  return ['media.requirements', 'media.visual-bible.compile', 'media.anchor-author-gate'].includes(task.taskKey)
    || (/^media\.visual\.\d{3}$/.test(task.taskKey) && task.executionMode === 'human-import')
}

/**
 * The original successful author command authorizes the complete visual set,
 * including imports with no AI producer. Recover from that immutable initial
 * carry, not an incomplete later epoch whose image tasks never got to settle.
 */
export async function verifiedTextRevisionVisualCarryTaskKeysV1(input: {
  scope: WorkspaceScope
  buildId: number
  previousControlEpoch: number
  tasks: ProductProductionPlanTaskV3[]
}): Promise<Set<string>> {
  const empty = new Set<string>()
  const drafts = input.tasks.flatMap(task => task.authorRevision ? [task.authorRevision] : [])
  if (!drafts.length || new Set(drafts.map(draft => draft.commandId)).size !== 1) return empty
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) return empty
  const receipt = await db.productProductionCommands.where('[productionId+commandId]')
    .equals([build.productionId, drafts[0].commandId]).first()
  if (!receipt || receipt.type !== 'revise-text-content' || receipt.status !== 'succeeded' || receipt.completedAt == null
    || !await assertRecordInScope(input.scope, 'productProductionCommands', receipt, { owner: 'work' })) return empty
  const result = JSON.parse(receipt.resultJson) as { buildNumber?: number; parentBuildNumber?: number; controlEpoch?: number;
    authorRevisionHashes?: Record<string, string>; retainedImages?: Array<{ artifactKey: string; expectedArtifactHash: string }> }
  if (result.buildNumber !== build.buildNumber || result.parentBuildNumber !== build.parentBuildNumber
    || !Number.isSafeInteger(result.controlEpoch) || result.controlEpoch! < 0 || result.controlEpoch! > input.previousControlEpoch
    || !Array.isArray(result.retainedImages)
    || Object.keys(result.authorRevisionHashes ?? {}).length !== drafts.length) return empty
  for (const draft of drafts) if (result.authorRevisionHashes?.[draft.artifactKey] !== await hashProductProductionValueV2(draft)) return empty
  const parent = await db.productBuilds.where('[productionId+buildNumber]')
    .equals([build.productionId, build.parentBuildNumber!]).first()
  if (!parent?.id || parent.briefHash !== build.briefHash
    || !await assertRecordInScope(input.scope, 'productBuilds', parent, { owner: 'work' })) return empty
  const parentRows = (await db.productBuildArtifacts.where('buildId').equals(parent.id).toArray())
    .filter(row => row.controlEpoch === parent.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
  const childRows = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => row.controlEpoch === result.controlEpoch && ['accepted', 'carried-forward', 'invalid'].includes(row.status))
  const tasks = input.tasks.filter(isTextRevisionRetainedVisualTaskV1)
  const images = tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))
  if (tasks.length !== images.length + 3 || images.length !== result.retainedImages.length
    || new Set(result.retainedImages.map(image => image.artifactKey)).size !== images.length) return empty
  for (const task of tasks) for (const key of task.outputArtifactKeys) {
    const parents = parentRows.filter(row => row.artifactKey === key)
    const children = childRows.filter(row => row.artifactKey === key)
    if (parents.length !== 1 || children.length !== 1 || parents[0].contentHash !== children[0].contentHash
      || !await assertRecordInScope(input.scope, 'productBuildArtifacts', children[0], { owner: 'work' })
      || !await assertRecordInScope(input.scope, 'productBuildArtifacts', parents[0], { owner: 'work' })
      || children[0].parentArtifactHash !== parents[0].contentHash
      || children[0].carriedFrom?.buildNumber !== parent.buildNumber
      || children[0].carriedFrom?.version !== parents[0].version
      || children[0].carriedFrom?.contentHash !== parents[0].contentHash
      || children[0].carriedFrom?.artifactKey !== key
      || task.outputArtifactKeys.length !== 1 || task.reuse?.sourceBuildNumber !== parent.buildNumber
      || task.reuse.sourceArtifactKey !== key || task.reuse.sourceContentHash !== parents[0].contentHash
      || task.reuse.reuseKey !== await hashProductProductionValueV2({
        commandId: receipt.commandId, sourceBuildNumber: parent.buildNumber, targetBuildNumber: build.buildNumber,
        taskKey: task.taskKey, artifacts: [{ key, hash: parents[0].contentHash }],
      })) return empty
    if (children[0].kind === 'image') {
      if (!result.retainedImages.some(image => image.artifactKey === key && image.expectedArtifactHash === children[0].contentHash)
        || children[0].blobObjectId !== parents[0].blobObjectId || children[0].rightsJson !== parents[0].rightsJson) return empty
    } else if (await hashProductProductionValueV2(JSON.parse(children[0].payloadJson)) !== parents[0].contentHash
      || await hashProductProductionValueV2(JSON.parse(parents[0].payloadJson)) !== parents[0].contentHash) return empty
  }
  return new Set(tasks.map(task => task.taskKey))
}

/** Only review retries and identity-preserving dialogue edits cross this boundary. */
export async function textRevisionRecoveryPreservesVisualContractV1(input: {
  scope: WorkspaceScope; buildId: number; previousControlEpoch: number; failureJson: string
}): Promise<boolean> {
  const failure = JSON.parse(input.failureJson)
  if (failure.resolution?.action === 'retry'
    && /^content\.adventure-quality-review(?:\.|$)/.test(failure.blockerKey ?? '')) return true
  if (failure.code !== 'author-revised-content' || failure.resolution?.action !== 'author-edit'
    || !/^content\.dialogue-pass\.act-[123]$/.test(failure.blockerKey ?? '')
    || typeof failure.resolution.authorDraftJson !== 'string') return false
  const originals = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => row.controlEpoch === input.previousControlEpoch && row.artifactKey === failure.blockerKey
      && row.contentHash === failure.revisionSource?.contentHash && row.version === failure.revisionSource?.version
      && ['accepted', 'carried-forward'].includes(row.status))
  if (originals.length !== 1 || !await assertRecordInScope(input.scope, 'productBuildArtifacts', originals[0], { owner: 'work' })
    || await hashProductProductionValueV2(JSON.parse(originals[0].payloadJson)) !== originals[0].contentHash) return false
  try {
    assertStableMediaBindings(JSON.parse(originals[0].payloadJson), JSON.parse(failure.resolution.authorDraftJson))
    return true
  } catch { return false }
}
