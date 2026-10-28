import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgConfirmedSoundPlanV1, readAvgSystemPlanForCompilationV1, readAvgFrozenSoundSourceInputsV1 } from './author-artifacts'
import type { AvgMediaSourceInputV1 } from './media-source'
import { validateAvgSoundPlanningSourcesV1 } from './sound-source'
import { parseAvgSoundPlanningBriefV1, parseAvgSoundPlanningBrief } from './sound-production-brief'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from './sound-production-plan'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgSoundArtifactV1 } from '../product-production/artifact-store'
import { avgAudioProcessingForSoundV1 } from './audio-production-brief'
import { avgAudioProcessingTaskKeyV1 } from './audio-production-contract'

/** The complete canonical rules/scripts are used only to verify freshness.
 * Default model input contains the explicitly declared sound purposes and
 * catalogue, never whole dialogue, rules/secrets, binary media or local paths. */
export async function projectAvgSoundPlanningInputsV1(declaration: unknown, source: AvgMediaSourceInputV1) {
  const sound = parseAvgSoundPlanningBriefV1(declaration)
  if (source.presentation.aspectRatio !== sound.aspectRatio) throw new Error('[avg-sound-context] 画幅不属于准确冻结声音来源')
  const scope = await validateAvgSoundPlanningSourcesV1(sound.scope, source)
  return { schema: 'storyforge.avg.sound-planning-inputs' as const, version: 1 as const,
    sourceInputHash: scope.sourceInputHash, scopeHash: await hashProductProductionValueV2(scope),
    requirements: scope.templates.map(t => ({ requirementKey: t.requirementKey, channel: t.channel,
      purpose: t.purpose, constraints: t.constraints, cue: t.cue, source: t.source })),
    librarySources: scope.librarySources.map(s => ({ ...s, observation: 'metadata-only; original audio not delivered or heard' })) }
}

/** A registered Context reader, with actual frozen author/start authority.
 * This is not an alternative context assembler or caller-supplied source. */
export async function readAvgSoundPlanningContextV1(input: AssembleContextInput): Promise<string> {
  const { scope } = input
  if (!scope || input.projectId !== scope.projectId || !input.productBuildId || !input.productProductionId
    || !input.productProductionTaskKey) throw new Error('[avg-sound-context] 缺少准确Work/Build/任务')
  const build = await db.productBuilds.get(input.productBuildId), production = await db.productProductions.get(input.productProductionId)
  const frozen = !!build && ['validating', 'preview-ready', 'release-ready', 'released'].includes(build.status)
    && !!build.packageHash && !!build.previewHash && !!build.rootTerminalReceiptHash
  if (!build || !production || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' }) || build.productionId !== production.id
    || production.productType !== 'avg' || !frozen && (production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
      || production.currentBriefRevision !== build.briefRevision || production.controlEpoch !== build.controlEpoch || !['building', 'integrating'].includes(build.status))) {
    throw new Error('[avg-sound-context] 制作来源已stale或跨Work')
  }
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' }) || !(frozen ? ['authorized', 'superseded'] : ['authorized']).includes(row.status)
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) throw new Error('[avg-sound-context] 缺少准确授权Brief')
  const parsedBrief = parseProductProductionBriefV3(row.briefJson)
  if (!parsedBrief.avgSoundPlanning || await hashProductProductionValueV2(parsedBrief) !== build.briefHash) throw new Error('[avg-sound-context] 必须保留完整原始声音Brief/hash，不能借用旧图声合同')
  const plan = parseProductProductionPlanV3(build.planJson, parsedBrief, build.briefHash), task = plan.tasks.find(t => t.taskKey === input.productProductionTaskKey)
  if (!task || await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || canonicalProductProductionJsonV2(input.productArtifactKeys ?? []) !== canonicalProductProductionJsonV2(task.inputArtifactKeys)) throw new Error('[avg-sound-context] 任务及准确依赖已变化')
  const declaration = parseAvgSoundPlanningBrief(parsedBrief.avgSoundPlanning)
  if (declaration.version === 2) {
    const load = () => import('./sound-local-repair-context')
    const { readAvgSoundLocalRepairContextV1 } = await (Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(load)) : load())
    return readAvgSoundLocalRepairContextV1({ input, scope, build, production, row, brief: parsedBrief, task, frozen })
  }
  const brief = { ...parsedBrief, avgSoundPlanning: declaration }
  const exactSoundInput = (ref: { artifactKey: string; version: number; contentHash: string }) => frozen
    ? verifyHistoricalAvgSoundArtifactV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash,
      expectedPlanHash: build.planHash, sourceControlEpoch: build.controlEpoch, ...ref }) : verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, ...ref })
  const proposal = task.kind === 'avg-sound-plan-propose' && task.executionMode === 'model' && task.skillId === 'avg.sound-plan.v1'
    && canonicalProductProductionJsonV2(task.outputArtifactKeys) === canonicalProductProductionJsonV2([AVG_SOUND_PROPOSAL_KEY_V1])
  const compilation = task.kind === 'avg-sound-requirements-compile' && task.executionMode === 'deterministic' && task.skillId === null
    && task.contextProfile === 'avg-sound-planning-v1' && canonicalProductProductionJsonV2(task.outputArtifactKeys) === canonicalProductProductionJsonV2([AVG_SOUND_COMPILED_KEY_V1])
  const raw = ['avg-sound-music-generate', 'avg-sound-library-import'].includes(task.kind)
    && task.outputArtifactKeys.length === 1 && task.outputArtifactKeys[0].startsWith('avg.sound.raw.')
  const processing = task.kind === 'avg-audio-process' && task.executionMode === 'deterministic' && task.skillId === null
    && task.contextProfile === 'avg-sound-planning-v1' && !!brief.avgAudioProcessing
  const processingEntry = processing ? avgAudioProcessingForSoundV1(brief.avgAudioProcessing, brief.avgSoundPlanning).entries
    .find(e => task.taskKey === avgAudioProcessingTaskKeyV1(e.domain, e.requirementKey)) : undefined
  const assembly = ['avg-assembly-integrate', 'avg-assembly-verify'].includes(task.kind) && task.executionMode === 'deterministic'
    && task.skillId === null && task.contextProfile === 'avg-sound-planning-v1'
  if (!proposal && !compilation && !raw && !assembly && !processingEntry || frozen && !raw) throw new Error('[avg-sound-context] 当前任务不属于准确声音生产；封存读取仅重验原音频来源，不授予执行权')
  // This existing reader checks actual start command, SourcePlan/confirmed
  // Brief, author candidates/receipts and physical source hashes in its own
  // complete snapshot. It does not inherit another Build's adoption authority.
  const sourceInput = { scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
  const source = frozen ? await readAvgFrozenSoundSourceInputsV1(sourceInput)
    : await readAvgSystemPlanForCompilationV1({ ...sourceInput, includeSceneScripts: true, includeAuthorStage: assembly })
  const adopted = compilation || raw || processingEntry ? await readAvgConfirmedSoundPlanV1(sourceInput, frozen) : assembly ? source.soundPlan : null
  const refs = [source.artifact, ...source.scripts.map(s => s.artifact), ...(assembly ? source.authorStage ? [source.authorStage.artifact] : [] : adopted ? [adopted.artifact] : [])]
  if (assembly) {
    if (!source.authorStage || !adopted || source.soundChoices?.length !== brief.avgSoundPlanning.scope.templates.length) throw new Error('[avg-sound-context] 组装需要全部真实已采用声音及演出')
    for (const key of task.inputArtifactKeys.filter(k => !refs.some(r => r.artifactKey === k))) {
      const matches = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, key])
        .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).toArray()
      if (matches.length !== 1) throw new Error('[avg-sound-context] 组装依赖缺失或不唯一')
      const row = await verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, artifactKey: key, version: matches[0].version, contentHash: matches[0].contentHash })
      refs.push({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
    }
  }
  let requirement: Awaited<ReturnType<typeof compileAvgSoundRequirementsV1>>['requirements'][number] | undefined
  let soundPlanHash: string | undefined
  let rawForProcessing: { artifactKey: string; version: number; contentHash: string; producerReceiptHash: string } | undefined
  if (raw || processingEntry) {
    const compiled = await compileAvgSoundRequirementsV1(brief.avgSoundPlanning.scope, adopted!.payload)
    soundPlanHash = compiled.planHash
    const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, AVG_SOUND_COMPILED_KEY_V1])
      .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).toArray()
    const row = rows[0]
    if (rows.length !== 1 || !row || canonicalProductProductionJsonV2(compiled) !== row.payloadJson) throw new Error('[avg-sound-context] 需要原producer的准确已编译声音需求')
    await exactSoundInput({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
    refs.push({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
    requirement = compiled.requirements.find(r => processingEntry ? processingEntry.requirementKey === r.template.requirementKey
      : task.taskKey === `avg.sound.generate.${r.template.requirementKey}`)
    if (!requirement || raw && (task.outputArtifactKeys[0] !== `avg.sound.raw.${requirement.template.requirementKey}`
      || (requirement.dispatch.operation === 'generate-music') !== (task.kind === 'avg-sound-music-generate'))) throw new Error('[avg-sound-context] 原声音任务与准确编译项不一致')
    if (processingEntry) {
      const key = `avg.sound.raw.${processingEntry.requirementKey}`
      const matches = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, key])
        .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).toArray()
      if (matches.length !== 1) throw new Error('[avg-sound-context] 加工原音频缺失或不唯一')
      const original = await verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, artifactKey: key,
        version: matches[0].version, contentHash: matches[0].contentHash })
      if (!original.producerReceiptHash) throw new Error('[avg-sound-context] 加工缺少原始producer回执')
      rawForProcessing = { artifactKey: key, version: original.version, contentHash: original.contentHash, producerReceiptHash: original.producerReceiptHash }
      refs.push({ artifactKey: key, version: original.version, contentHash: original.contentHash })
    }
  }
  if (refs.length !== task.inputArtifactKeys.length || refs.some(r => !task.inputArtifactKeys.includes(r.artifactKey))) throw new Error('[avg-sound-context] 已采用规则/脚本未覆盖准确任务输入')
  const projected = await projectAvgSoundPlanningInputsV1(brief.avgSoundPlanning, { systemPlan: source.plan,
    scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: brief.avgSoundPlanning.aspectRatio } })
  const packet = assembly ? { schema: projected.schema, version: projected.version, sourceInputHash: projected.sourceInputHash,
    scopeHash: projected.scopeHash, operation: task.kind === 'avg-assembly-integrate' ? 'integrate-adopted-sound-stage' : 'verify-adopted-sound-stage',
    soundPlan: { artifact: adopted!.artifact, authorReceiptHash: adopted!.authorReceiptHash },
    stage: source.authorStage!.artifact, soundChoices: source.soundChoices!.map(c => ({ choice: c.artifact, authorReceiptHash: c.authorReceiptHash,
      raw: { artifactKey: c.raw.artifactKey, version: c.raw.version, contentHash: c.raw.contentHash }, rawReceiptHash: c.raw.producerReceiptHash,
      compiled: c.validation.compiled, review: c.review.artifact, reviewReceiptHash: c.review.authorReceiptHash })) } : raw ? { schema: projected.schema, version: projected.version, sourceInputHash: projected.sourceInputHash,
    scopeHash: projected.scopeHash, operation: 'produce-compiled-sound', soundPlanHash, requirement } : processingEntry ? {
    schema: projected.schema, version: projected.version, sourceInputHash: projected.sourceInputHash, scopeHash: projected.scopeHash,
    operation: 'process-compiled-sound', soundPlanHash, requirement, processing: processingEntry, raw: rawForProcessing,
  } : adopted ? { schema: projected.schema, version: projected.version, sourceInputHash: projected.sourceInputHash,
    scopeHash: projected.scopeHash, operation: 'compile-adopted-sound-requirements', soundPlan: adopted.payload } : projected
  const current = await db.productBuilds.get(build.id!), owner = await db.productProductions.get(production.id!)
  if (!current || !owner || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.planHash !== build.planHash || current.briefHash !== build.briefHash || current.status !== build.status
    || owner.status !== production.status || owner.controlEpoch !== production.controlEpoch || owner.currentBriefRevision !== production.currentBriefRevision
    || owner.currentBuildNumber !== production.currentBuildNumber) throw new Error('[avg-sound-context] 读取期间制作状态已变化')
  return canonicalProductProductionJsonV2({ ...packet, taskKey: task.taskKey, productionKey: production.productionKey,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, briefHash: build.briefHash,
    briefRevision: row.revision, sourcePlanHash: row.sourcePlanHash, confirmedBriefHash: row.confirmedBriefHash,
    sourceWorldContentHash: row.sourceWorldContentHash,
    artifacts: task.inputArtifactKeys.map(key => refs.find(r => r.artifactKey === key)!), taskBudget: task.budgetReservation })
}
