import { db } from '../db/schema'
import { readTextOpenWorldProductionPlanAuthorityV1 } from './production-authority'
import type {
  ProductBuildRecordV1, ProductProductionRecordV1, ProductProductionPlanV3,
  TextOpenWorldContentRevisionV1, WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { parseProductProductionCommandV1 } from '../product-production/contracts'
import { resolveProductProductionTaskRecoveryPolicyV1 } from '../product-production/recovery-policy'

type RevisionTarget = Pick<TextOpenWorldContentRevisionV1,
  'taskKey' | 'expectedPlanHash' | 'expectedControlEpoch' | 'expectedArtifacts'>

function fail(message: string): never {
  throw new Error(`[text-open-world-content-revision] ${message}`)
}

function taskFor(plan: ProductProductionPlanV3, taskKey: string) {
  const task = plan.tasks.find(row => row.taskKey === taskKey)
  if (plan.productType !== 'text-open-world' || !task
    || !resolveProductProductionTaskRecoveryPolicyV1({ productType: plan.productType, task }).authorDraftAllowed) {
    return fail('任务不属于已登记的开放世界文本修订岗位')
  }
  return task
}

async function assertBaseline(input: {
  scope: WorkspaceScope; build: ProductBuildRecordV1; plan: ProductProductionPlanV3; revision: RevisionTarget;
  historical?: boolean
}): Promise<void> {
  const { scope, build, plan, revision } = input
  const task = taskFor(plan, revision.taskKey)
  const keys = revision.expectedArtifacts.map(row => row.artifactKey).sort()
  if (canonicalProductProductionJsonV2(keys) !== canonicalProductProductionJsonV2([...task.outputArtifactKeys].sort())) {
    fail('修订必须绑定任务的全部输出，不能只替换同组的一部分')
  }
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  for (const expected of revision.expectedArtifacts) {
    const found = rows.filter(row => row.artifactKey === expected.artifactKey
      && row.controlEpoch === revision.expectedControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'
        || (input.historical && revision.expectedControlEpoch < build.controlEpoch && row.status === 'invalid')))
    if (found.length !== 1) fail('原稿缺失或同一 epoch 存在重复输出')
    const original = found[0]
    if (!await assertRecordInScope(scope, 'productBuildArtifacts', original, { owner: 'work' })
      || original.version !== expected.version || original.contentHash !== expected.contentHash
      || !original.producerReceiptHash || !/^[a-f0-9]{64}$/.test(original.producerReceiptHash)
      || original.blobObjectId != null
      || await hashProductProductionValueV2(JSON.parse(original.payloadJson)) !== original.contentHash) {
      fail('原稿作用域、版本、内容或签收证据已变化')
    }
  }
}

/** Read-only selection. Submission validates again and atomically compares its witness. */
export async function listTextOpenWorldPausedRevisionTargetsV1(input: {
  scope: WorkspaceScope; productionId: number
}): Promise<RevisionTarget[]> {
  const production = await db.productProductions.get(input.productionId)
  const build = production?.currentBuildNumber == null ? null : await db.productBuilds
    .where('[productionId+buildNumber]').equals([input.productionId, production.currentBuildNumber]).first()
  if (!production || !build) return fail('当前制作或 Build 不存在')
  const plan = await assertPausedBuild({ ...input, production, build })
  if (pendingTextOpenWorldRevisionV1(build.failureJson)) return []
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const targets: RevisionTarget[] = []
  for (const task of plan.tasks) {
    if (!resolveProductProductionTaskRecoveryPolicyV1({ productType: plan.productType, task }).authorDraftAllowed) continue
    const outputs = task.outputArtifactKeys.flatMap(key => rows.filter(row => row.artifactKey === key
      && row.controlEpoch === plan.controlEpoch && ['accepted', 'carried-forward'].includes(row.status)))
    if (outputs.length !== task.outputArtifactKeys.length || !outputs.length) continue
    const target = { taskKey: task.taskKey, expectedPlanHash: build.planHash, expectedControlEpoch: plan.controlEpoch,
      expectedArtifacts: outputs.map(row => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })) }
    await assertBaseline({ scope: input.scope, build, plan, revision: target })
    targets.push(target)
  }
  return targets
}

async function assertPausedBuild(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1
}): Promise<ProductProductionPlanV3> {
  const { scope, production, build } = input
  if (production.productType !== 'text-open-world' || production.status !== 'paused'
    || build.status !== 'paused' || !['building', 'recovery-required'].includes(build.resumeState ?? '')
    || build.releasedProductReleaseId != null || build.rootTerminalReceiptHash != null
    || production.currentBuildNumber !== build.buildNumber || production.id !== build.productionId
    || production.controlEpoch !== build.controlEpoch
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    fail('只允许修订尚未完成 Preview 的当前暂停 Build')
  }
  const plan = parseProductProductionPlanV3(build.planJson)
  if (plan.productType !== 'text-open-world' || plan.buildNumber !== build.buildNumber
    || plan.controlEpoch > build.controlEpoch || await hashProductProductionValueV2(plan) !== build.planHash) {
    fail('冻结计划已变化')
  }
  const origin = await readTextOpenWorldProductionPlanAuthorityV1({ scope,
    productionId: production.id!, buildId: build.id!, purpose: 'paused-content-revision' })
  if (!origin.authority.valid) fail(origin.authority.diagnostic ?? 'Creator 制作授权无效')
  return plan
}

/** Pending revisions survive an intervening pause without silently invoking a model. */
export function pendingTextOpenWorldRevisionV1(failureJson: string): TextOpenWorldContentRevisionV1 | undefined {
  const pending = JSON.parse(failureJson).pendingOpenWorldRevision
  if (!pending) return undefined
  const command = parseProductProductionCommandV1(pending)
  if (command.type !== 'resume' || !command.openWorldContentRevision) return fail('暂停中的修订授权无效')
  return command.openWorldContentRevision
}

export async function validateTextOpenWorldPausedRevisionV1(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1;
  revision: TextOpenWorldContentRevisionV1
}): Promise<void> {
  const plan = await assertPausedBuild(input)
  const pending = JSON.parse(input.build.failureJson).pendingOpenWorldRevision
  if (pending) {
    const command = parseProductProductionCommandV1(pending)
    if (command.type !== 'resume' || !command.openWorldContentRevision
      || canonicalProductProductionJsonV2(command.openWorldContentRevision) !== canonicalProductProductionJsonV2(input.revision)) {
      fail('尚未签收的修订必须先按原授权继续，不能被普通恢复或另一份输入覆盖')
    }
    await verifyRevisionReceipt({ ...input, command, currentEpochRequired: false })
  } else if (input.revision.expectedPlanHash !== input.build.planHash
    || input.revision.expectedControlEpoch !== plan.controlEpoch) fail('原稿计划已变化，请重新载入')
  await assertBaseline({ ...input, plan, historical: Boolean(pending) })
}

export interface TextOpenWorldPausedRevisionPreparationV1 {
  productionId: number
  buildId: number
  revisionJson: string
  witnessJson: string
}

/** DB reads only: no WebCrypto or nested keep-alive inside the command transaction. */
async function readPausedRevisionWitness(input: {
  productionId: number; buildId: number; revision: TextOpenWorldContentRevisionV1
}): Promise<string> {
  const production = await db.productProductions.get(input.productionId)
  const build = await db.productBuilds.get(input.buildId)
  // The registered authority router may read a mixed budget/repair/media
  // ancestry. Snapshot its frozen Build/Brief/artifact inputs as well as the
  // successful command journal; a direct-parent-only witness misses races in
  // an earlier authorization. A new Brief ends the reusable ancestry.
  const ancestors: ProductBuildRecordV1[] = []
  let child = build
  const visited = new Set<number>(build ? [build.buildNumber] : [])
  while (child?.parentBuildNumber != null) {
    if (ancestors.length >= 128 || visited.has(child.parentBuildNumber)) fail('制作授权祖先链无效')
    visited.add(child.parentBuildNumber)
    const parent = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([input.productionId, child.parentBuildNumber]).first()
    if (!parent) fail('制作授权父 Build 缺失')
    ancestors.push(parent)
    if (parent.briefRevision !== child.briefRevision) break
    child = parent
  }
  const brief = build == null ? null : await db.productProductionBriefs
    .where('[productionId+revision]').equals([input.productionId, build.briefRevision]).first()
  const authorityCommands = await db.productProductionCommands.where('[productionId+status]')
    .equals([input.productionId, 'succeeded'])
    .limit(65_537).toArray()
  if (authorityCommands.length > 65_536) fail('Creator 命令历史超过安全上限')
  const ancestorBriefs = await db.productProductionBriefs.where('productionId').equals(input.productionId)
    .filter(row => ancestors.some(parent => parent.briefRevision === row.revision)).toArray()
  const ancestorArtifacts = (await Promise.all(ancestors.filter(parent => parent.briefRevision === build?.briefRevision)
    .map(parent => db.productBuildArtifacts.where('buildId').equals(parent.id!)
      .filter(row => row.controlEpoch === parent.controlEpoch).toArray()))).flat()
  const pendingCommandId = build == null ? null : JSON.parse(build.failureJson).pendingOpenWorldRevision?.commandId
  const pendingCommand = typeof pendingCommandId !== 'string' ? null : await db.productProductionCommands
    .where('[productionId+commandId]').equals([input.productionId, pendingCommandId]).first()
  const artifacts = await db.productBuildArtifacts.where('buildId').equals(input.buildId)
    .filter(row => input.revision.expectedArtifacts.some(expected => expected.artifactKey === row.artifactKey)
      && row.controlEpoch === input.revision.expectedControlEpoch).toArray()
  return canonicalProductProductionJsonV2({ production: production ?? null, build: build ?? null,
    ancestors, ancestorBriefs: ancestorBriefs.sort((a, b) => a.id! - b.id!),
    ancestorArtifacts: ancestorArtifacts.sort((a, b) => a.id! - b.id!),
    brief: brief ?? null, pendingCommand: pendingCommand ?? null,
    authorityCommands: authorityCommands.sort((a, b) => a.id! - b.id!),
    artifacts: artifacts.sort((a, b) => a.id! - b.id!),
  })
}

/** Hash/source verification runs before the write transaction; both sides of it
 * must observe the same rows. The transaction then locks and compares those rows. */
export async function prepareTextOpenWorldPausedRevisionV1(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1;
  revision: TextOpenWorldContentRevisionV1
}): Promise<TextOpenWorldPausedRevisionPreparationV1> {
  const identity = { productionId: input.production.id!, buildId: input.build.id!, revision: input.revision }
  const before = await readPausedRevisionWitness(identity)
  await validateTextOpenWorldPausedRevisionV1(input)
  const after = await readPausedRevisionWitness(identity)
  if (before !== after) fail('校验期间原稿或制作授权已变化，请重新载入')
  return { productionId: identity.productionId, buildId: identity.buildId,
    revisionJson: canonicalProductProductionJsonV2(input.revision), witnessJson: after }
}

export async function assertTextOpenWorldPausedRevisionPreparationCurrentV1(input: {
  productionId: number; buildId: number; revision: TextOpenWorldContentRevisionV1;
  prepared: TextOpenWorldPausedRevisionPreparationV1
}): Promise<void> {
  if (input.prepared.productionId !== input.productionId || input.prepared.buildId !== input.buildId
    || input.prepared.revisionJson !== canonicalProductProductionJsonV2(input.revision)
    || input.prepared.witnessJson !== await readPausedRevisionWitness(input)) {
    fail('原稿或制作授权在原子恢复边界已变化，请重新载入')
  }
}

async function verifyRevisionReceipt(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1;
  command: Extract<ReturnType<typeof parseProductProductionCommandV1>, { type: 'resume' }>;
  currentEpochRequired: boolean
}): Promise<void> {
  const { scope, production, build, command } = input
  const receipt = await db.productProductionCommands.where('[productionId+commandId]')
    .equals([production.id!, command.commandId]).first()
  const result = receipt ? JSON.parse(receipt.resultJson) : null
  if (!receipt || !await assertRecordInScope(scope, 'productProductionCommands', receipt, { owner: 'work' })
    || receipt.type !== 'resume' || receipt.status !== 'succeeded'
    || receipt.payloadHash !== await hashProductProductionValueV2(command)
    || canonicalProductProductionJsonV2(result?.revisionAuthorization) !== canonicalProductProductionJsonV2(command)
    || result?.buildNumber !== build.buildNumber || !Number.isSafeInteger(result?.controlEpoch)
    || (input.currentEpochRequired ? result.controlEpoch !== build.controlEpoch : result.controlEpoch >= build.controlEpoch)) {
    fail('内容修订命令回执已变化')
  }
}

/** Recheck author JSON, all original siblings and the command journal before execution. */
export async function validateTextOpenWorldContentRevisionAuthorityV1(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1; build: ProductBuildRecordV1;
  failure: Record<string, unknown>; taskKey: string
}): Promise<void> {
  const { scope, production, build, failure } = input
  const command = parseProductProductionCommandV1(failure.revisionCommand)
  if (production.productType !== 'text-open-world' || command.type !== 'resume'
    || !command.openWorldContentRevision || command.contentRevision || command.commandId !== failure.commandId
    || command.openWorldContentRevision.taskKey !== input.taskKey || failure.blockerKey !== input.taskKey
    || build.releasedProductReleaseId != null || build.rootTerminalReceiptHash != null) {
    fail('内容修订缺少准确的任务授权')
  }
  const revision = command.openWorldContentRevision
  if (canonicalProductProductionJsonV2(failure.resolution) !== canonicalProductProductionJsonV2({
    action: 'author-edit', note: revision.note, authorDraftJson: revision.authorDraftJson,
  }) || canonicalProductProductionJsonV2(failure.revisionSource) !== canonicalProductProductionJsonV2({
    planHash: revision.expectedPlanHash, controlEpoch: revision.expectedControlEpoch, artifacts: revision.expectedArtifacts,
  })) fail('内容修订候选或来源已变化')
  await verifyRevisionReceipt({ scope, production, build, command, currentEpochRequired: true })
  await assertBaseline({ scope, build, plan: parseProductProductionPlanV3(build.planJson), revision, historical: true })
}

/** Retain a not-yet-signed author draft across a second pause; completed drafts carry normally. */
export async function textOpenWorldRevisionPendingAtPauseV1(build: ProductBuildRecordV1): Promise<unknown | undefined> {
  const failure = JSON.parse(build.failureJson)
  if (failure.code !== 'author-revised-content' || !failure.revisionCommand?.openWorldContentRevision) return undefined
  const revision = failure.revisionCommand.openWorldContentRevision
  const task = parseProductProductionPlanV3(build.planJson).tasks.find(row => row.taskKey === revision.taskKey)
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const signed = task?.outputArtifactKeys.every(key => rows.some(row => row.artifactKey === key
    && row.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status)))
  return signed ? undefined : failure.revisionCommand
}
