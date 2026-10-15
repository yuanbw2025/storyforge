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
import { parseAvgAuthorStageV1, type AvgAuthorStageV1 } from './author-workspace-contract'
import { validateAvgAuthorAssemblyV1, type AvgAssemblyValidationV1 } from './author-stage-validation'
import { avgKey, avgText } from './protocol-validation'
import { validateAvgSystemPlanForAuthorV1, type AvgSystemValidationV1 } from './system-compiler'

type Ref = { artifactKey: string; version: number; contentHash: string }
interface AuthorCandidateBase {
  schema: 'storyforge.avg.author-candidate'; origin: 'author-import'
  productionKey: string; buildNumber: number; briefRevision: number; briefHash: string
  confirmedBriefHash: string; sourcePlanHash: string; planRevision: number; planHash: string
  controlEpoch: number; taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']
  payloadHash: string; base: Ref | null; inputs: Ref[]; declaration: string
}
type AuthorCandidateBody = AuthorCandidateBase & ({ version: 1 } | { version: 2; systemValidation: AvgSystemValidationV1 } | { version: 3; assemblyValidation: AvgAssemblyValidationV1 })
type AuthorCandidate = AuthorCandidateBody & { candidateHash: string }
type AdoptCommand = Extract<ProductProductionCommandV1, { type: 'adopt-avg-artifact' }>

export class AvgAuthorArtifactErrorV1 extends Error {}
const hash = hashProductProductionValueV2
const ref = (row: ProductBuildArtifactRecordV1): Ref => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })

function validateSystem(value: unknown) {
  // Validation only computes on its frozen payload; it does not read/write DB.
  // Keep one transaction lease around this entire crypto pipeline. Its hash
  // helpers must not enqueue nested waitFor calls behind that same lease.
  return Dexie.currentTransaction
    ? Dexie.waitFor(Dexie.ignoreTransaction(() => validateAvgSystemPlanForAuthorV1(value)))
    : validateAvgSystemPlanForAuthorV1(value)
}

type AuthorPayload = AvgProfessionalArtifactV1 | AvgAuthorStageV1
function prepareAuthorInput(input: Parameters<typeof prepareAvgProfessionalArtifactV1>[0]): { payload: AuthorPayload; payloadJson: string } {
  if (input.artifactKey !== 'avg.author.stage') return prepareAvgProfessionalArtifactV1(input)
  if (input.kind !== 'presentation' || !input.allowedOutputKeys.includes(input.artifactKey)) throw new Error('[avg] 作者演出超出冻结写域或 kind 无效')
  const payload = parseAvgAuthorStageV1(input.payload)
  return { payload, payloadJson: canonicalProductProductionJsonV2(payload) }
}
async function validateAssembly(context: Awaited<ReturnType<typeof authority>>, scope: WorkspaceScope, payload: AuthorPayload, inputs: ProductBuildArtifactRecordV1[]) {
  if (payload.schema !== 'storyforge.avg.author-stage') return undefined
  return validateAvgAuthorAssemblyV1({ scope, payload, inputs, productKey: context.production.productionKey,
    sourceWorld: { contentHash: context.brief.source.worldContentHash, selection: context.brief.source.selection } })
}

async function authority(scope: WorkspaceScope, buildId: number, forCompilation = false) {
  const build = await db.productBuilds.get(buildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg] Build 不存在或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  const work = await db.works.get(scope.workId)
  if (!production?.id || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || work?.kind !== 'avg') throw new Error('[avg] 必须属于当前 AVG Work/Production')
  if (production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || !(forCompilation ? ['authorized','building','integrating'] : ['authorized','building']).includes(build.status)
    || build.packageHash || build.previewHash || build.releasedProductReleaseId != null) throw new Error('[avg] 当前 Build 不可采用；已冻结版本须建立新 Build')
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.status !== 'authorized' || briefRow.authorizedAt !== build.authorizedAt
    || briefRow.briefHash !== build.briefHash || production.currentBriefRevision !== build.briefRevision) throw new Error('[avg] Brief 授权已 stale')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'avg' || await hash(brief) !== build.briefHash) throw new Error('[avg] Brief 内容/hash 不一致')
  if (!forCompilation && brief.avgAssembly && Object.keys((JSON.parse(build.budgetLedgerJson) as { tasks?: object }).tasks ?? {}).length) throw new Error('[avg] 组装已开始执行；请保留旧版本并创建新 Build 修订')
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
  return { build, production: production as ProductProductionRecordV1 & { id: number }, briefRow, brief, plan, sourcePlan }
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

function assertSourceReferences(context: Awaited<ReturnType<typeof authority>>, payload: AuthorPayload) {
  if (context.brief.avgAssembly) {
    const expected = context.brief.avgAssembly
    const same = (a: string[], b: string[]) => canonicalProductProductionJsonV2([...a].sort()) === canonicalProductProductionJsonV2([...b].sort())
    if (payload.schema === 'storyforge.avg.system-plan' && !same(expected.sceneKeys, payload.scenes.map(scene => scene.key))
      || payload.schema === 'storyforge.avg.author-stage' && !same(expected.mediaAssetKeys, payload.stage.assets.map(asset => asset.assetKey))) throw new Error('[avg] 场景或媒资目录超出冻结 Brief；请创建新 Build')
  }
  const references = payload.schema === 'storyforge.avg.source-audit' ? payload.facts.flatMap(fact => fact.resourceKeys)
    : payload.schema === 'storyforge.avg.cast-bible' ? payload.characters.flatMap(character => character.sourceResourceKey ? [character.sourceResourceKey] : []) : []
  const frozen = new Set(context.sourcePlan.initialResourceKeys)
  if (references.some(key => !frozen.has(key))) throw new Error('[avg] 作者来源引用不在冻结初始资源中；新增读取需专业来源包的实际 manifest')
}

function candidateBody(context: Awaited<ReturnType<typeof authority>>, input: {
  taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']; payloadHash: string
  base: Ref | null; inputs: Ref[]; declaration: string; systemValidation?: AvgSystemValidationV1; assemblyValidation?: AvgAssemblyValidationV1
}): AuthorCandidateBody {
  const { systemValidation, assemblyValidation, ...payload } = input
  const base: AuthorCandidateBase = { schema: 'storyforge.avg.author-candidate', origin: 'author-import',
    productionKey: context.production.productionKey, buildNumber: context.build.buildNumber,
    briefRevision: context.build.briefRevision, briefHash: context.build.briefHash,
    confirmedBriefHash: context.briefRow.confirmedBriefHash, sourcePlanHash: context.briefRow.sourcePlanHash,
    planRevision: context.build.planRevision, planHash: context.build.planHash, controlEpoch: context.build.controlEpoch,
    ...payload }
  return assemblyValidation ? { ...base, version: 3, assemblyValidation } : systemValidation ? { ...base, version: 2, systemValidation } : { ...base, version: 1 }
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
  const prepared = prepareAuthorInput({ ...input, artifactKey, allowedOutputKeys: [artifactKey] })
  const systemValidation = prepared.payload.schema === 'storyforge.avg.system-plan'
    ? await validateSystem(prepared.payload) : undefined
  return db.transaction('rw', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects), async () => {
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
    const assemblyValidation = await validateAssembly(context, scope, prepared.payload, inputs)
    const contentHash = await hash(prepared.payload)
    const body = candidateBody(context, { taskKey, artifactKey, kind: input.kind, payloadHash: contentHash,
      base, inputs: inputs.map(ref), declaration, systemValidation, assemblyValidation })
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
  const prepared = prepareAuthorInput({ artifactKey: candidate.artifactKey, kind: candidate.kind,
    payload: candidate.payloadJson, allowedOutputKeys: task.outputArtifactKeys })
  const systemValidation = prepared.payload.schema === 'storyforge.avg.system-plan'
    ? await validateSystem(prepared.payload) : undefined
  assertSourceReferences(context, prepared.payload)
  const inputs = await acceptedInputs(scope, build.id, command.controlEpoch, task.inputArtifactKeys)
  const bases = rows.filter(row => row.artifactKey === candidate.artifactKey && row.status === 'accepted')
  if (bases.length > 1) throw new Error('[avg] 正式 revision 不唯一')
  if (bases[0]) await acceptedInputs(scope, build.id, command.controlEpoch, [candidate.artifactKey])
  const assemblyValidation = await validateAssembly(context, scope, prepared.payload, inputs)
  const body = candidateBody(context, { taskKey: task.taskKey, artifactKey: candidate.artifactKey, kind: candidate.kind,
    payloadHash: await hash(prepared.payload), base: bases[0] ? ref(bases[0]) : null, inputs: inputs.map(ref),
    declaration: avgText(envelope.declaration, 'author declaration', 2000), systemValidation, assemblyValidation })
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

/** Only a current, confirmed rule revision can enter formal Build compilation.
 * Pure engineering previews remain available without this persistence receipt. */
export async function readAvgSystemPlanForCompilationV1(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number; includeSceneScripts?: boolean; includeAuthorStage?: boolean
}) {
  const scope = await resolveScope({ scope: input.scope })
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects), async () => {
    const context = await authority(scope, input.buildId, true)
    if (context.build.stateRevision !== input.expectedBuildRevision || context.build.controlEpoch !== input.controlEpoch) throw new Error('[avg] 规则编译 Build revision/epoch 已 stale')
    const [artifact] = await acceptedInputs(scope, input.buildId, input.controlEpoch, ['avg.system.plan'])
    const prepared = prepareAuthorInput({ artifactKey: artifact.artifactKey, kind: artifact.kind, payload: artifact.payloadJson, allowedOutputKeys: ['avg.system.plan'] })
    if (prepared.payload.schema !== 'storyforge.avg.system-plan') throw new Error('[avg] 不是正式系统规则')
    const validation = await validateSystem(prepared.payload)
    const receipt = JSON.parse(artifact.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
    if (receipt.candidate.version !== 2 || canonicalProductProductionJsonV2(receipt.candidate.systemValidation) !== canonicalProductProductionJsonV2(validation)) throw new Error('[avg] 规则编译证据缺失、版本不匹配或已 stale')
    const scriptKeys = input.includeSceneScripts || input.includeAuthorStage ? prepared.payload.scenes.map(scene => `avg.content.scene-script.${scene.key}`) : []
    const scriptRows = await acceptedInputs(scope, input.buildId, input.controlEpoch, scriptKeys)
    const scripts = scriptRows.map(row => {
      const parsed = prepareAvgProfessionalArtifactV1({ artifactKey: row.artifactKey, kind: row.kind, payload: row.payloadJson, allowedOutputKeys: scriptKeys }).payload
      const scriptReceipt = JSON.parse(row.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
      if (parsed.schema !== 'storyforge.avg.scene-script' || !scriptReceipt.candidate.inputs.some(source => source.artifactKey === artifact.artifactKey && source.version === artifact.version && source.contentHash === artifact.contentHash)) throw new Error('[avg] 脚本缺少当前正式规则依赖')
      return { payload: parsed, artifact: ref(row), authorReceiptHash: scriptReceipt.receiptHash }
    })
    let authorStage: { payload: AvgAuthorStageV1; artifact: Ref; authorReceiptHash: string; validation: AvgAssemblyValidationV1 } | null = null
    if (input.includeAuthorStage) {
      const [stageRow] = await acceptedInputs(scope, input.buildId, input.controlEpoch, ['avg.author.stage'])
      const payload = parseAvgAuthorStageV1(stageRow.payloadJson)
      const stageReceipt = JSON.parse(stageRow.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
      const upstream = [artifact, ...scriptRows].map(ref)
      if (canonicalProductProductionJsonV2([...stageReceipt.candidate.inputs].sort((a,b) => a.artifactKey.localeCompare(b.artifactKey))) !== canonicalProductProductionJsonV2(upstream.sort((a,b) => a.artifactKey.localeCompare(b.artifactKey)))) throw new Error('[avg] 作者演出未绑定当前规则及全部脚本')
      const validation = await validateAssembly(context, scope, payload, [artifact, ...scriptRows])
      if (!validation || stageReceipt.candidate.version !== 3
        || canonicalProductProductionJsonV2(stageReceipt.candidate.assemblyValidation) !== canonicalProductProductionJsonV2(validation)) throw new Error('[avg] 作者演出组装证据缺失或 stale')
      authorStage = { payload, artifact: ref(stageRow), authorReceiptHash: stageReceipt.receiptHash, validation }
    }
    return { plan: prepared.payload, artifact: ref(artifact), validation, authorReceiptHash: receipt.receiptHash, scripts, ...(input.includeAuthorStage ? { authorStage } : {}),
      sourceWorld: { contentHash: context.brief.source.worldContentHash, selection: context.brief.source.selection },
      build: { productionKey: context.production.productionKey, buildNumber: context.build.buildNumber, stateRevision: context.build.stateRevision, controlEpoch: context.build.controlEpoch, planRevision: context.build.planRevision, planHash: context.build.planHash } }
  })
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
