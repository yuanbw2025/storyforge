/** Author-supplied professional candidates. No provider/Skill invocation occurs here.
 * AI candidates keep the closed admission gate until their role package is registered. */
import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductProductionCommandV1, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { parseConfirmedProductBriefV1, parseProductProductionSourcePlanV1 } from '../product-production/source-contracts'
import { applyAvgDialoguePatchV1, prepareAvgProfessionalArtifactV1, type AvgProfessionalArtifactV1 } from './artifact-contract'
import { avgKey, avgText } from './protocol-validation'

type Ref = { artifactKey: string; version: number; contentHash: string }
interface AuthorCandidateBody {
  schema: 'storyforge.avg.author-candidate'; version: 1; origin: 'author-import'
  productionKey: string; buildNumber: number; briefRevision: number; briefHash: string
  confirmedBriefHash: string; sourcePlanHash: string; planRevision: number; planHash: string
  controlEpoch: number; taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']
  payloadHash: string; base: Ref | null; inputs: Ref[]; declaration: string
}
type AuthorCandidate = AuthorCandidateBody & { candidateHash: string }
type AdoptCommand = Extract<ProductProductionCommandV1, { type: 'adopt-avg-artifact' }>

export class AvgAuthorArtifactErrorV1 extends Error {}
const hash = hashProductProductionValueV2
const ref = (row: ProductBuildArtifactRecordV1): Ref => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })

async function authority(scope: WorkspaceScope, buildId: number) {
  const build = await db.productBuilds.get(buildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg] Build 不存在或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  const work = await db.works.get(scope.workId)
  if (!production?.id || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || work?.kind !== 'avg') throw new Error('[avg] 必须属于当前 AVG Work/Production')
  if (production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || !['authorized','building'].includes(build.status)
    || build.packageHash || build.previewHash || build.releasedProductReleaseId != null) throw new Error('[avg] 当前 Build 不可采用；已冻结版本须建立新 Build')
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.status !== 'authorized' || briefRow.authorizedAt !== build.authorizedAt
    || briefRow.briefHash !== build.briefHash || production.currentBriefRevision !== build.briefRevision) throw new Error('[avg] Brief 授权已 stale')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'avg' || await hash(brief) !== build.briefHash) throw new Error('[avg] Brief 内容/hash 不一致')
  const sourcePlan = await Dexie.waitFor(parseProductProductionSourcePlanV1(briefRow))
  const confirmed = await Dexie.waitFor(parseConfirmedProductBriefV1({ row: briefRow, sourcePlan }))
  if (sourcePlan.productType !== 'avg' || sourcePlan.productInstanceKey !== production.productionKey
    || confirmed.briefRevision !== build.briefRevision || confirmed.briefContentHash !== build.briefHash
    || confirmed.confirmedBy !== 'author') throw new Error('[avg] 冻结来源/作者开始合同不一致')
  const starts = await db.productProductionCommands.where('productionId').equals(production.id).toArray()
  const started = starts.some(row => {
    if (row.type !== 'authorize-start' || row.status !== 'succeeded' || row.completedAt !== build.authorizedAt
      || row.expectedStateRevision !== confirmed.authorStartRevision) return false
    const result = JSON.parse(row.resultJson) as Record<string, unknown>
    return result.buildNumber === build.buildNumber && result.briefRevision === build.briefRevision && result.briefHash === build.briefHash
  })
  if (!started) throw new Error('[avg] 缺少实际作者开始命令回执')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (plan.productType !== 'avg' || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || build.planRevision < 1 || await hash(plan) !== build.planHash
    || canonicalProductProductionJsonV2(plan) !== build.planJson) throw new Error('[avg] 冻结 Plan/hash 已 stale')
  return { build, production: production as ProductProductionRecordV1 & { id: number }, briefRow, plan, sourcePlan }
}

async function acceptedInputs(scope: WorkspaceScope, buildId: number, epoch: number, keys: string[]) {
  const rows = await db.productBuildArtifacts.where('buildId').equals(buildId).toArray()
  const result: ProductBuildArtifactRecordV1[] = []
  for (const key of keys) {
    const matches = rows.filter(row => row.artifactKey === key && row.status === 'accepted' && row.controlEpoch === epoch)
    if (matches.length !== 1 || !await assertRecordInScope(scope, 'productBuildArtifacts', matches[0]!, { owner: 'work' })
      || await hash(JSON.parse(matches[0]!.payloadJson)) !== matches[0]!.contentHash) throw new Error(`[avg] 上游未采用或内容已 stale:${key}`)
    await assertAuthorAdoptionReceipt(scope, matches[0]!)
    result.push(matches[0]!)
  }
  return result
}

async function assertAuthorAdoptionReceipt(scope: WorkspaceScope, artifact: ProductBuildArtifactRecordV1) {
  const envelope = JSON.parse(artifact.metadataJson) as { schema: string; commandId: string; receiptHash: string; [key: string]: unknown }
  const { receiptHash, ...body } = envelope
  if (envelope.schema !== 'storyforge.avg.author-adoption' || receiptHash !== await hash(body)) throw new Error('[avg] 正式工件缺少可验证作者采用回执')
  const build = await db.productBuilds.get(artifact.buildId)
  const command = build ? await db.productProductionCommands.where('[productionId+commandId]').equals([build.productionId, envelope.commandId]).first() : null
  if (!command || !await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })
    || command.type !== 'adopt-avg-artifact' || command.status !== 'succeeded') throw new Error('[avg] 作者采用命令未完成或跨 Work')
  const result = JSON.parse(command.resultJson) as { authorReceiptHash: string; artifactKey: string; version: number; contentHash: string; derivedScript: Ref | null }
  const adopted = result.artifactKey === artifact.artifactKey && result.version === artifact.version && result.contentHash === artifact.contentHash
  const derived = result.derivedScript?.artifactKey === artifact.artifactKey && result.derivedScript.version === artifact.version && result.derivedScript.contentHash === artifact.contentHash
  if (result.authorReceiptHash !== receiptHash || !adopted && !derived) throw new Error('[avg] 作者回执与正式 revision 不一致')
}

function authorTask(context: Awaited<ReturnType<typeof authority>>, taskKey: string, artifactKey: string) {
  const task = context.plan.tasks.find(task => task.taskKey === taskKey)
  if (!task || task.executionMode !== 'human-import' || task.skillId !== null
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== artifactKey
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0) throw new Error('[avg] 候选超出冻结的作者输入写域')
  return task
}

function assertSourceReferences(context: Awaited<ReturnType<typeof authority>>, payload: AvgProfessionalArtifactV1) {
  const references = payload.schema === 'storyforge.avg.source-audit' ? payload.facts.flatMap(fact => fact.resourceKeys)
    : payload.schema === 'storyforge.avg.cast-bible' ? payload.characters.flatMap(character => character.sourceResourceKey ? [character.sourceResourceKey] : []) : []
  const frozen = new Set(context.sourcePlan.initialResourceKeys)
  if (references.some(key => !frozen.has(key))) throw new Error('[avg] 作者来源引用不在冻结初始资源中；新增读取需专业来源包的实际 manifest')
}

function candidateBody(context: Awaited<ReturnType<typeof authority>>, input: {
  taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']; payloadHash: string
  base: Ref | null; inputs: Ref[]; declaration: string
}): AuthorCandidateBody {
  return { schema: 'storyforge.avg.author-candidate', version: 1, origin: 'author-import',
    productionKey: context.production.productionKey, buildNumber: context.build.buildNumber,
    briefRevision: context.build.briefRevision, briefHash: context.build.briefHash,
    confirmedBriefHash: context.briefRow.confirmedBriefHash, sourcePlanHash: context.briefRow.sourcePlanHash,
    planRevision: context.build.planRevision, planHash: context.build.planHash, controlEpoch: context.build.controlEpoch,
    ...input }
}

/** Stores only a pending candidate, never an author receipt or accepted content.
 * The frozen human-import task supplies the complete output/input domain. */
export async function stageAvgAuthorArtifactV1(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number
  taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']; payload: unknown; declaration: string
}) {
  const scope = await resolveScope({ scope: input.scope })
  const taskKey = avgKey(input.taskKey, 'taskKey'); const artifactKey = avgKey(input.artifactKey, 'artifactKey')
  const declaration = avgText(input.declaration, 'author declaration', 2000)
  const prepared = prepareAvgProfessionalArtifactV1({ ...input, artifactKey, allowedOutputKeys: [artifactKey] })
  return db.transaction('rw', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds, db.productBuildArtifacts), async () => {
    const context = await authority(scope, input.buildId)
    if (context.build.stateRevision !== input.expectedBuildRevision || context.build.controlEpoch !== input.controlEpoch) throw new Error('[avg] Build revision/epoch 已 stale')
    const task = authorTask(context, taskKey, artifactKey)
    assertSourceReferences(context, prepared.payload)
    const inputs = await acceptedInputs(scope, input.buildId, input.controlEpoch, task.inputArtifactKeys)
    const rows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
    const bases = rows.filter(row => row.artifactKey === artifactKey && row.status === 'accepted')
    if (bases.length > 1) throw new Error('[avg] 正式 revision 不唯一')
    const base = bases[0] ? ref(bases[0]) : null
    if (bases[0]) await acceptedInputs(scope, input.buildId, input.controlEpoch, [artifactKey])
    if (prepared.payload.schema === 'storyforge.avg.dialogue-patch') {
      const scriptKey = `avg.content.scene-script.${prepared.payload.sceneKey}`
      const script = inputs.find(row => row.artifactKey === scriptKey)
      if (!script) throw new Error('[avg] 表达补丁缺少冻结的正式脚本输入')
      await applyAvgDialoguePatchV1(script.payloadJson, prepared.payload)
    }
    const contentHash = await hash(prepared.payload)
    const body = candidateBody(context, { taskKey, artifactKey, kind: input.kind, payloadHash: contentHash,
      base, inputs: inputs.map(ref), declaration })
    const candidateHash = await hash(body)
    const metadataJson = canonicalProductProductionJsonV2({ ...body, candidateHash } satisfies AuthorCandidate)
    const existing = rows.find(row => row.artifactKey === artifactKey && row.status === 'pending' && row.metadataJson === metadataJson)
    if (existing) {
      if (!await assertRecordInScope(scope, 'productBuildArtifacts', existing, { owner: 'work' })
        || existing.payloadJson !== prepared.payloadJson || existing.contentHash !== contentHash) throw new Error('[avg] 已有候选被篡改或跨 Work')
      return existing
    }
    const now = Date.now()
    const row = stampNewRecord(scope, 'productBuildArtifacts', {
      ...scope, buildId: input.buildId, artifactKey, requirementKey: null,
      version: Math.max(0, ...rows.filter(row => row.artifactKey === artifactKey).map(row => row.version)) + 1,
      kind: input.kind, mediaKind: null, status: 'pending' as const, producerRunId: null, producerReceiptHash: null,
      controlEpoch: input.controlEpoch, inputHash: await hash({ ...body, payloadHash: null }), contentHash,
      payloadJson: prepared.payloadJson, metadataJson, qualityJson: '{}', rightsJson: canonicalProductProductionJsonV2({ origin: 'author-import', declaration }),
      blobObjectId: null, mimeType: null, byteSize: new TextEncoder().encode(prepared.payloadJson).byteLength,
      parentArtifactHash: base?.contentHash ?? null, carriedFrom: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
    const id = await db.productBuildArtifacts.add(row) as number
    return { ...row, id }
  })
}

async function prepareAdoption(scope: WorkspaceScope, production: ProductProductionRecordV1 & { id: number }, command: AdoptCommand) {
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, command.buildNumber]).first()
  if (!build?.id) throw new Error('[avg] Build 不存在')
  const context = await authority(scope, build.id)
  if (context.production.id !== production.id || context.production.stateRevision !== command.expectedStateRevision) throw new Error('[avg] Production revision 已 stale')
  if (build.stateRevision !== command.expectedBuildRevision || build.controlEpoch !== command.controlEpoch) throw new Error('[avg] Build revision/epoch 已 stale')
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const candidate = rows.find(row => row.artifactKey === command.artifactKey && row.version === command.candidateVersion)
  if (!candidate?.id || candidate.status !== 'pending' || !await assertRecordInScope(scope, 'productBuildArtifacts', candidate, { owner: 'work' })
    || candidate.controlEpoch !== command.controlEpoch || candidate.producerRunId !== null || candidate.producerReceiptHash !== null
    || candidate.blobObjectId !== null || candidate.mediaKind !== null || candidate.mimeType !== null) throw new Error('[avg] 不是可采用的作者候选')
  const envelope = JSON.parse(candidate.metadataJson) as AuthorCandidate
  const task = authorTask(context, envelope.taskKey, command.artifactKey)
  const prepared = prepareAvgProfessionalArtifactV1({ artifactKey: candidate.artifactKey, kind: candidate.kind,
    payload: candidate.payloadJson, allowedOutputKeys: task.outputArtifactKeys })
  assertSourceReferences(context, prepared.payload)
  const inputs = await acceptedInputs(scope, build.id, command.controlEpoch, task.inputArtifactKeys)
  const bases = rows.filter(row => row.artifactKey === candidate.artifactKey && row.status === 'accepted')
  if (bases.length > 1) throw new Error('[avg] 正式 revision 不唯一')
  if (bases[0]) await acceptedInputs(scope, build.id, command.controlEpoch, [candidate.artifactKey])
  const body = candidateBody(context, { taskKey: task.taskKey, artifactKey: candidate.artifactKey, kind: candidate.kind,
    payloadHash: await hash(prepared.payload), base: bases[0] ? ref(bases[0]) : null, inputs: inputs.map(ref),
    declaration: avgText(envelope.declaration, 'author declaration', 2000) })
  const candidateHash = await hash(body)
  if (candidateHash !== command.candidateHash || envelope.candidateHash !== candidateHash
    || canonicalProductProductionJsonV2({ ...body, candidateHash }) !== candidate.metadataJson
    || prepared.payloadJson !== candidate.payloadJson || body.payloadHash !== candidate.contentHash
    || candidate.inputHash !== await hash({ ...body, payloadHash: null })
    || candidate.byteSize !== new TextEncoder().encode(prepared.payloadJson).byteLength
    || candidate.parentArtifactHash !== (body.base?.contentHash ?? null)
    || candidate.qualityJson !== '{}' || candidate.carriedFrom !== null
    || candidate.rightsJson !== canonicalProductProductionJsonV2({ origin: 'author-import', declaration: body.declaration })) throw new Error('[avg] 候选、来源、写域或正式基线已 stale/篡改')
  let derived: { base: ProductBuildArtifactRecordV1; payloadJson: string; contentHash: string; version: number } | null = null
  if (prepared.payload.schema === 'storyforge.avg.dialogue-patch') {
    const scriptKey = `avg.content.scene-script.${prepared.payload.sceneKey}`
    const script = inputs.find(row => row.artifactKey === scriptKey)
    if (!script) throw new Error('[avg] 表达补丁缺少正式脚本')
    const patched = await applyAvgDialoguePatchV1(script.payloadJson, prepared.payload)
    derived = { base: script, payloadJson: canonicalProductProductionJsonV2(patched.script), contentHash: patched.scriptHash,
      version: Math.max(...rows.filter(row => row.artifactKey === scriptKey).map(row => row.version)) + 1 }
  }
  // Validate all affected metadata before the first write. Only new typed
  // author candidates have this closure; legacy artifacts retain their policy.
  const identity = (value: Ref) => `${value.artifactKey}:${value.version}:${value.contentHash}`
  const replaced = new Set([...(bases[0] ? [identity(ref(bases[0]))] : []), ...(derived ? [identity(ref(derived.base))] : [])])
  const invalidated = new Set<number>()
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (row.status !== 'accepted' || row.id === candidate.id || !row.id || invalidated.has(row.id)
        || !row.artifactKey.startsWith('avg.')) continue
      const metadata = JSON.parse(row.metadataJson) as { schema?: string; candidate?: AuthorCandidate; inputs?: Ref[]; derivedScript?: Ref | null }
      if (!metadata || typeof metadata !== 'object') continue
      const source = metadata.schema === 'storyforge.avg.author-adoption' ? metadata.candidate : metadata
      if (replaced.has(identity(ref(row))) || source?.schema === 'storyforge.avg.author-candidate'
        && (source.inputs?.some(input => replaced.has(identity(input)))
          || metadata.derivedScript && replaced.has(identity(metadata.derivedScript)))) {
        invalidated.add(row.id); replaced.add(identity(ref(row))); changed = true
      }
    }
  }
  return { context, candidate, body: { ...body, candidateHash } as AuthorCandidate, derived, invalidated: [...invalidated] }
}

/** Called only inside the registered production command transaction. The
 * existing command claim/CAS/replay mechanism supplies the author action. */
export async function applyAvgAuthorArtifactAdoptionV1(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1 & { id: number }; command: AdoptCommand; now: number
}) {
  let prepared: Awaited<ReturnType<typeof prepareAdoption>>
  try {
    if (!Dexie.currentTransaction || input.command.expectedStateRevision !== input.production.stateRevision) throw new Error('[avg] 作者采用必须进入当前命令事务')
    const claim = await db.productProductionCommands.where('[productionId+commandId]').equals([input.production.id, input.command.commandId]).first()
    if (!claim || !await assertRecordInScope(input.scope, 'productProductionCommands', claim, { owner: 'work' })
      || claim.type !== 'adopt-avg-artifact' || claim.status !== 'claimed' || claim.payloadHash !== await hash(input.command)) throw new Error('[avg] 缺少实际作者命令 claim')
    prepared = await prepareAdoption(input.scope, input.production, input.command)
  }
  catch (cause) { throw new AvgAuthorArtifactErrorV1(cause instanceof Error ? cause.message : String(cause)) }
  const { context, candidate, body, derived, invalidated } = prepared
  const receiptBody = { schema: 'storyforge.avg.author-adoption', version: 1, commandId: input.command.commandId,
    candidate: body, adoptedAt: input.now, derivedScript: derived ? { artifactKey: derived.base.artifactKey, version: derived.version, contentHash: derived.contentHash } : null }
  const receiptHash = await hash(receiptBody)
  const metadataJson = canonicalProductProductionJsonV2({ ...receiptBody, receiptHash })
  const derivedInputHash = derived ? await hash({ baseScriptHash: derived.base.contentHash, patchHash: candidate.contentHash, receiptHash }) : null
  await db.productBuildArtifacts.update(candidate.id!, { status: 'accepted', metadataJson, updatedAt: input.now })
  if (invalidated.length) await db.productBuildArtifacts.where('id').anyOf(invalidated).modify({ status: 'invalid', updatedAt: input.now })
  if (derived) await db.productBuildArtifacts.add(stampNewRecord(input.scope, 'productBuildArtifacts', {
    ...derived.base, id: undefined, version: derived.version, status: 'accepted' as const,
    payloadJson: derived.payloadJson, contentHash: derived.contentHash, inputHash: derivedInputHash!,
    parentArtifactHash: derived.base.contentHash, metadataJson,
    byteSize: new TextEncoder().encode(derived.payloadJson).byteLength, createdAt: input.now, updatedAt: input.now,
  }, { owner: 'work' }))
  const stateRevision = input.production.stateRevision + 1
  await db.productBuilds.update(context.build.id!, { stateRevision: context.build.stateRevision + 1, updatedAt: input.now })
  await db.productProductions.update(input.production.id, { stateRevision, updatedAt: input.now })
  return { production: { ...input.production, stateRevision, updatedAt: input.now }, result: {
    buildNumber: context.build.buildNumber, artifactKey: candidate.artifactKey, version: candidate.version,
    contentHash: candidate.contentHash, candidateHash: body.candidateHash, authorReceiptHash: receiptHash,
    derivedScript: derived ? { artifactKey: derived.base.artifactKey, version: derived.version, contentHash: derived.contentHash } : null,
    invalidatedCount: invalidated.length,
  } }
}
