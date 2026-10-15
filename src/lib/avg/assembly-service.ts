import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAvgDraftV1, bindAvgDraftProductionV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { AVG_ASSEMBLY_GATE_IDS_V1 } from './assembly-contract'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../product-production/consultation'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { beginProductProductionEvolutionV1, readProductProductionDetailsV1, authorizeProductProductionStartV1, stopProductProductionV1, type ProductProductionDetailsV1 } from '../product-production/service'
import { verifyStoredProductBuildPreview } from '../product-production/preview-manifest'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1, selectProductBuildCompatibilityBaselineV1 } from '../product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../product-production/production-executor'
import { stageAvgAuthorArtifactV1 } from './author-artifacts'
import { listAvgDraftMediaV1 } from './editor-service'
import { parseProductProductionPlanV3 } from '../product-production/plan'

const commandId = (label: string) => `avg.assembly.${label}.${crypto.randomUUID()}`

export async function readAvgAssemblyWorkspaceV1(scope: WorkspaceScope, selectedProductionId?: number | null) {
  const draft = await readAvgDraftV1(scope)
  if (selectedProductionId && draft.productionId && selectedProductionId !== draft.productionId) throw new Error('[avg] 当前草稿属于另一制作记录，请返回作品库选择准确版本')
  const productionId = selectedProductionId ?? draft.productionId
  const details = productionId ? await readProductProductionDetailsV1(scope,productionId,['avg']) : null
  if (details?.brief && !parseProductProductionBriefV3(details.brief.briefJson).avgAssembly) throw new Error('[avg] 此记录使用旧版制作流程；请在新 AVG 作品中试用系统组装')
  const artifacts = []
  if (details?.build?.planRevision && details.executionBrief) {
    // A reviewable revision Brief can coexist with the previous immutable Build.
    // Its task/media domains must never be used to reinterpret that old Plan.
    const frozenBrief = details.briefHistory.find(row=>row.revision===details.build!.briefRevision&&row.briefHash===details.build!.briefHash)
    if(!frozenBrief||frozenBrief.status!=='authorized')throw new Error('[avg] 当前 Build 缺少准确的已授权方案')
    const plan = parseProductProductionPlanV3(details.build.planJson,parseProductProductionBriefV3(frozenBrief.briefJson),details.build.briefHash)
    const keys = [...plan.tasks.filter(task=>task.executionMode==='human-import').flatMap(task=>task.outputArtifactKeys),'runtime.package','quality.report']
    for (const key of keys) {
      const accepted = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key])
        .filter(row=>row.status==='accepted'&&row.controlEpoch===details.build!.controlEpoch).limit(2).toArray()
      const pending = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key]).reverse()
        .filter(row=>row.status==='pending'&&row.controlEpoch===details.build!.controlEpoch).limit(1).toArray()
      for (const row of [...accepted,...pending]) if (!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})) throw new Error('[avg] 作者输入跨作品')
      artifacts.push(...accepted,...pending)
    }
  }
  return { draft,details,artifacts,media:await listAvgDraftMediaV1(scope) }
}

export async function confirmAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; artifactKey: string; candidateVersion: number; candidateHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly) throw new Error('[avg] 当前制作缺少作者组装 Build')
  const result = await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'adopt-avg-artifact',
    commandId:commandId('confirm'),expectedStateRevision:details.production.stateRevision,expectedBuildRevision:details.build.stateRevision,
    buildNumber:details.build.buildNumber,controlEpoch:details.build.controlEpoch,artifactKey:input.artifactKey,candidateVersion:input.candidateVersion,candidateHash:input.candidateHash}})
  if (!result.ok) throw new Error(String(result.result.message??result.errorCode))
  return result
}

async function expectedBaselinePackageHash(details: ProductProductionDetailsV1) {
  if (!details.build) return null
  const targetNumber = Math.max(...details.buildHistory.map(build=>build.buildNumber)) + 1
  const selected = selectProductBuildCompatibilityBaselineV1({ currentBuildNumber:targetNumber,parentBuildNumber:details.build.buildNumber,priorBuilds:details.buildHistory })
  if (!selected) return null
  const build = details.buildHistory.find(build=>build.id===selected.id)!
  const preview = await verifyStoredProductBuildPreview(build)
  if (!preview || !build.rootTerminalReceiptHash) throw new Error('[avg] 修订基线缺少可验证的正式组装回执')
  return preview.packageHash
}

/** Prepare a reviewable Brief only. User start and per-artifact adoption remain explicit. */
export async function prepareAvgAssemblyBriefV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg] 编辑草稿已变化，请刷新后再准备方案')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (!draft.worldReleaseId) throw new Error('[avg] 请先在产品定向选择冻结世界版本')
  const work = await db.works.get(input.scope.workId)
  if (!work || work.kind !== 'avg' || !await assertRecordInScope(input.scope,'works',work,{owner:'work'})) throw new Error('[avg] 当前作品不是 AVG')
  let productionId = draft.productionId
  let basePackageHash: string | null = null
  if (productionId != null) {
    const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
    if (details.build) {
      const old = details.executionBrief
      if (!old?.avgAssembly || old.source.worldReleaseId !== draft.worldReleaseId) throw new Error('[avg] 当前修订不能替换产品协议或世界来源')
      const pending = details.production.status === 'brief-ready' && details.brief?.revision !== details.build.briefRevision
        ? parseProductProductionBriefV3(details.brief!.briefJson) : null
      if (details.build.previewHash) {
        if (workspace.basePreviewHash !== details.build.previewHash) throw new Error('[avg] 修订基线已变化，请读取准确预览后再创建新 Build')
        const preview = await verifyStoredProductBuildPreview(details.build)
        if (!preview) throw new Error('[avg] 修订基线缺少正式预览')
        basePackageHash = preview.packageHash
      } else {
        if (!['cancelled','failed','recovery-required'].includes(details.build.status)) throw new Error('[avg] 当前制作仍在执行；请先停止并保留记录，再准备新 Build')
        basePackageHash = await expectedBaselinePackageHash(details)
      }
      if (!pending) await beginProductProductionEvolutionV1({ scope:input.scope,productionId,expectedStateRevision:details.production.stateRevision,
        userText:'作者修订 AVG 系统、对白、演出和媒资，生成新预览并保留旧版本及存档',affectedLanes:['content','product','visual','audio'] })
    }
  } else {
    const created = await executeProductProductionCommand({ scope:input.scope,command:{ type:'create-intent',commandId:commandId('intent'),
      productionKey:`avg.assembly.${crypto.randomUUID()}`,productType:'avg',worldReleaseId:draft.worldReleaseId,userText:'作者组装 AVG 系统与表现' } })
    if (!created.ok) throw new Error(String(created.result.message ?? created.errorCode))
    productionId = created.productionId
    await bindAvgDraftProductionV1(input.scope,draft.revision,productionId)
  }
  const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
  const priorBrief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  const sourceBrief = priorBrief ?? await (async () => {
    const suggestions = await suggestProductStartingPoints({ scope:input.scope,worldReleaseId:draft.worldReleaseId! })
    if (!suggestions.suggestions[0]) throw new Error('[avg] 当前来源没有可用定向入口')
    return draftProductProductionBriefV3({ scope:input.scope,worldReleaseId:draft.worldReleaseId!,
      suggestionKey:suggestions.suggestions[0].suggestionKey,productType:'avg',scale:'scene',visualLevel:'none',audioLevel:'none',requiredFacts:[],forbiddenChanges:['源世界只读'] })
  })()
  const assets = workspace.presentation.stage.assets
  const brief = parseProductProductionBriefV3({ ...sourceBrief,
    scale:{...sourceBrief.scale,scope:'scene',targetWordCount:workspace.scripts.flatMap(script=>script.lines).reduce((sum,line)=>sum+line.text.length,0),
      targetEndingCount:workspace.systemPlan.scenes.filter(scene=>scene.kind==='ending').length},
    media:{visualLevel:assets.some(asset=>asset.mimeType.startsWith('image/'))?'key-scenes':'none',audioLevel:assets.some(asset=>asset.mimeType.startsWith('audio/'))?'full':'none',
      imageCount:assets.filter(asset=>asset.mimeType.startsWith('image/')).length,musicTrackCount:assets.filter(asset=>['bgm','ambience'].includes(asset.kind)).length,
      sfxCount:assets.filter(asset=>asset.kind==='sfx').length,voiceLineCount:assets.filter(asset=>asset.kind==='voice').length,requiredMediaKinds:[...new Set(assets.map(asset=>asset.kind))]},
    intent:{ ...sourceBrief.intent,openingSituation:'作者确认的系统、固定文本与合法媒资联合预览',coreExperience:['作者编辑、明确确认、确定性组装和试玩'] },
    ...(priorBrief?.evolution ? { evolution:priorBrief.evolution } : {}),
    avgAssembly:{ schema:'storyforge.avg.assembly-brief',version:1,title:work.title,sceneKeys:workspace.systemPlan.scenes.map(scene=>scene.key),
      mediaAssetKeys:assets.map(asset=>asset.assetKey),basePackageHash },
    qualityProfile:'prototype',capabilityRequirements:[],
    consultationBudget:{maximumModelCalls:0,maximumInputTokens:0,maximumOutputTokens:0,maximumCostUsd:0},
    productionBudget:{ ...sourceBrief.productionBudget,maximumModelCalls:0,maximumInputTokens:100_000,maximumOutputTokens:0,maximumMediaCalls:0,
      maximumCostUsd:0,maximumDurationMs:180_000,maximumStorageBytes:64*1024*1024 },
    completionContract:{ requiresPlayablePreview:true,requiredGateIds:[...AVG_ASSEMBLY_GATE_IDS_V1],minimumMediaCoverage:1,allowSoftWaivers:false },
    unresolvedDecisionKeys:[] })
  const saved = await executeProductProductionCommand({ scope:input.scope,productionId,command:{ type:'save-brief-revision',commandId:commandId('brief'),
    expectedStateRevision:details.production.stateRevision,parentRevision:details.brief?.revision ?? null,brief } })
  if (!saved.ok) throw new Error(String(saved.result.message ?? saved.errorCode))
  return readProductProductionDetailsV1(input.scope,productionId,['avg'])
}

export async function startAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; expectedBriefHash: string }) {
  let details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const brief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  if (!brief?.avgAssembly || details.brief!.briefHash !== input.expectedBriefHash) throw new Error('[avg] 制作方案已变化，请重新核对')
  const draft=await readAvgDraftV1(input.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  const same=(a:string[],b:string[])=>canonicalProductProductionJsonV2([...a].sort())===canonicalProductProductionJsonV2([...b].sort())
  if(draft.productionId!==input.productionId||draft.worldReleaseId!==brief.source.worldReleaseId
    ||!same(brief.avgAssembly.sceneKeys,workspace.systemPlan.scenes.map(scene=>scene.key))
    ||!same(brief.avgAssembly.mediaAssetKeys,workspace.presentation.stage.assets.map(asset=>asset.assetKey))) throw new Error('[avg] 场景、媒资或来源清单已变化，请重新准备制作方案')
  if (brief.avgAssembly.basePackageHash !== await expectedBaselinePackageHash(details)) throw new Error('[avg] 组装修订基线与实际 Build 谱系不一致，请重新准备方案')
  await authorizeProductProductionStartV1({ scope:input.scope,details })
  details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  // Freezes the real shared Plan/root and waits for manual inputs; never runs a provider.
  await runProductProductionSchedulerCycleV1({ scope:input.scope,productionId:input.productionId,
    executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief }) })
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}

/** Staging and confirmation are separate UI actions; payload is always from a saved draft. */
export async function stageAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number; artifactKey: string; declaration: string }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg] 草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly) throw new Error('[avg] 请先明确开始作者组装')
  const plan = JSON.parse(details.build.planJson) as { tasks:Array<{taskKey:string;outputArtifactKeys:string[]}> }
  const task = plan.tasks.find(task=>task.outputArtifactKeys.includes(input.artifactKey))
  if (!task) throw new Error('[avg] 输入不在冻结写域')
  const payload = input.artifactKey === 'avg.system.plan' ? workspace.systemPlan : input.artifactKey === 'avg.author.stage' ? workspace.presentation
    : workspace.scripts.find(script=>`avg.content.scene-script.${script.sceneKey}` === input.artifactKey)
  if (!payload) throw new Error('[avg] 已保存草稿中不存在该输入')
  return stageAvgAuthorArtifactV1({ scope:input.scope,buildId:details.build.id!,expectedBuildRevision:details.build.stateRevision,
    controlEpoch:details.build.controlEpoch,taskKey:task.taskKey,artifactKey:input.artifactKey,
    kind:input.artifactKey === 'avg.system.plan' ? 'product-module' : input.artifactKey === 'avg.author.stage' ? 'presentation' : 'narrative',payload,declaration:input.declaration })
}

export async function runAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; signal?: AbortSignal }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.executionBrief?.avgAssembly || !details.build || !['authorized','building','integrating'].includes(details.build.status)) throw new Error('[avg] 当前 Build 不可组装')
  return runProductProductionUntilBlockedV1({ ...input,executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief:details.executionBrief }) })
}

/** Explicit restart for unsealed attempts; the old Run, inputs and failures remain. */
export async function restartAvgAssemblyFromDraftV1(input: { scope: WorkspaceScope; productionId: number; expectedBuildId: number; expectedDraftRevision: number }) {
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId)throw new Error('[avg] 编辑草稿或制作指针已变化')
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(!details.executionBrief?.avgAssembly||details.build?.id!==input.expectedBuildId||details.build.previewHash)throw new Error('[avg] 当前版本不能按未封存组装重建')
  if(!['cancelled','failed'].includes(details.build.status))await stopProductProductionV1({scope:input.scope,production:details.production})
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision})
}
