import { readAvgHeldImageQueueFailureV4 } from './visual-held-image-failure'
import { db } from '../db/schema'
import type { ProductBuildRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertProductProductionBudgetLedgerV1 } from '../product-production/scheduler'
import { readAgentRunV1 } from '../agent/run/event-store'
import { completedAgentRunEvidencePrefixV1 } from '../agent/run/projection'

/** This is a fresh, explicitly authorized Build boundary, never permission
 * to replay an old Run or copy its adoption. Renaming an image/role cannot
 * hide an unresolved ancestor request. Unknown price alone is not an unknown
 * result: a received queue-full response still has one known failed attempt. */
export async function assertAvgVisualPlanningRestartKnownV4(scope:WorkspaceScope,source:ProductBuildRecordV1){
  return assertAvgProductionRequestsKnownV1(scope,source)
}

/** Stage retention shares only the old-request knowledge check. A completed
 * imported prefix never resumes its Run or supplies current adoption. */
export async function assertAvgVisualStageRetentionKnownV4(scope:WorkspaceScope,source:ProductBuildRecordV1){
  return assertAvgProductionRequestsKnownV1(scope,source)
}

export async function assertAvgProductionRequestsKnownV1(scope:WorkspaceScope,source:ProductBuildRecordV1,family:'visual'|'sound'='visual'){
  const fail=(message:string)=>new Error(`[avg-${family}-restart] ${message}`)
  const originals:ProductBuildRecordV1[]=[]
  let build:ProductBuildRecordV1|undefined=source
  const visited=new Set<number>()
  while(build){
    if(visited.size>=32||visited.has(build.buildNumber)||build.productionId!==source.productionId
      ||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw fail('旧版本谱系缺失、循环或跨作品')
    visited.add(build.buildNumber);originals.push(build)
    const row=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
    if(!row||!await assertRecordInScope(scope,'productProductionBriefs',row,{owner:'work'})||row.briefHash!==build.briefHash
      ||row.authorizedAt!==build.authorizedAt||!['authorized','superseded'].includes(row.status))throw fail('旧版本缺少准确授权方案')
    const brief=parseProductProductionBriefV3(row.briefJson)
    if(brief.intent.productType!=='avg'||await hashProductProductionValueV2(brief)!==build.briefHash)throw fail('旧版本方案内容已损坏')
    if(build.planRevision===0&&build.budgetLedgerJson==='{}'&&build.startedAt===null){
      // An authorized but never-executed version owns no dispatched attempt.
    }else{
      const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
      if(plan.buildNumber!==build.buildNumber||plan.controlEpoch>build.controlEpoch||await hashProductProductionValueV2(plan)!==build.planHash)throw fail('旧版本执行计划已损坏')
      assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
      const requestedTaskKeys=new Set(plan.tasks.filter(t=>t.executionMode==='model'||t.executionMode==='media-provider'||t.kind==='avg-sound-library-import').map(t=>t.taskKey))
      const ledger=JSON.parse(build.budgetLedgerJson) as {version?:number;rootClaim?:unknown;
        attempts?:Array<{taskKey:string;runId:number;attempt:number;usageKnown:boolean;errorCode:string|null;resolution?:string}>;
        tasks?:Record<string,{status:string;runId:number;attempt:number;errorCode:string|null}>}
      if(ledger.version!==2||!ledger.attempts||!ledger.tasks)throw fail('旧调用记账不完整')
      const unknown=(code:string|null)=>!!code&&(code.includes('result-unknown')||code.includes('unknown-result'))
      if(ledger.rootClaim!=null||ledger.attempts.some(a=>unknown(a.errorCode)||a.resolution?.startsWith('author-'))
        ||Object.entries(ledger.tasks).some(([key,task])=>task.status==='claimed'||unknown(task.errorCode)
          ||!ledger.attempts!.some(a=>a.taskKey===key&&a.runId===task.runId&&a.attempt===task.attempt)))throw fail('旧调用仍有未知结果或未完成领取；不能改名或新建版本重发')
      // A legacy module-identity failure may retain an unknown accounting
      // hold despite a complete 503 response. Prove only its result, without
      // changing the reservation, fees, Run or authority of this old Build.
      const observedFailures=new Set<string>()
      for(const attempt of ledger.attempts)if(!attempt.usageKnown){
        try{
          await readAvgHeldImageQueueFailureV4({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,
            expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,controlEpoch:plan.controlEpoch,
            taskKey:attempt.taskKey,runId:attempt.runId,attempt:attempt.attempt})
          observedFailures.add(`${attempt.runId}:${attempt.attempt}`)
        }catch(error){throw fail(`旧调用仍有未知结果，原始失败不可核验；不能重发：${error instanceof Error?error.message:'缺少证据'}`)}
      }
      // The attempt array alone is not evidence that a dispatched Run vanished.
      // Read its immutable events, so clearing a cached ledger cannot erase a
      // paid/unknown request or turn an unfinished child into a fresh attempt.
      const runs=await db.agentRuns.where('productBuildId').equals(build.id!).toArray()
      for(const run of runs){
        const key=run.parentRelation?.startsWith('task:')?run.parentRelation.slice(5):''
        if(family==='sound'?!requestedTaskKeys.has(key):!key.startsWith('avg.visual.propose.')&&!key.startsWith('avg.media.generate.'))continue
        const snapshot=await readAgentRunV1(scope,run.id!)
        const binding=snapshot.contract.scope.productProduction
        // Import invalidates execution/adoption authority, not a known old
        // request outcome. This exact shared prefix is read-only evidence;
        // the caller must still authorize a separate Build and adopt anew.
        const projection=run.status==='running'
          ? completedAgentRunEvidencePrefixV1(snapshot.events)??snapshot.projection : snapshot.projection
        if(binding?.taskKey!==key||binding.productBuildId!==build.id||binding.buildNumber!==build.buildNumber
          ||binding.planHash!==build.planHash||binding.controlEpoch!==plan.controlEpoch
          ||!['completed','failed','cancelled'].includes(projection.state))throw fail('旧请求 Run 尚未完成或与任务不一致')
        if(Object.values(projection.steps).some(step=>unknown(step.failureCode??null)))throw fail('旧请求 Run 保留未知结果；缓存记账不能授权重发')
        for(const event of snapshot.events)if(event.type==='model.requested'||event.type==='tool.called'){
          if(!ledger.attempts.some(a=>a.taskKey===key&&a.runId===run.id&&a.attempt===event.payload.attempt&&(a.usageKnown||observedFailures.has(`${a.runId}:${a.attempt}`))))throw fail('已发送请求缺少准确终态记账；不能重发')
        }
      }
    }
    if(build.parentBuildNumber===null)break
    build=await db.productBuilds.where('[productionId+buildNumber]').equals([source.productionId,build.parentBuildNumber]).first()
    if(!build)throw fail('不能忽略缺失的祖先版本')
  }
  for(const original of originals)if(canonicalProductProductionJsonV2(await db.productBuilds.get(original.id!))!==canonicalProductProductionJsonV2(original))throw fail('旧版本在核对期间变化')
}

/** Dispatch fence as well as a workbench preflight. A caller using the shared
 * Brief/start commands cannot evade a held request with a renamed scope or a
 * second Production in this same Work. The current task owns its own claim. */
export async function assertAvgVisualPlanningOtherRequestsKnownV4(scope:WorkspaceScope,current:Pick<ProductBuildRecordV1,'id'>|null){
  const others=await db.productBuilds.where('projectId').equals(scope.projectId).filter(row=>row.workId===scope.workId&&row.id!==current?.id).toArray()
  for(const build of others){
    if(!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-restart] 历史版本跨作品')
    const row=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
    if(!row||!await assertRecordInScope(scope,'productProductionBriefs',row,{owner:'work'}))throw new Error('[avg-visual-restart] 历史版本缺少方案')
    if(parseProductProductionBriefV3(row.briefJson).avgVisualPlanning)await assertAvgVisualPlanningRestartKnownV4(scope,build)
  }
}

/** Reuse the same immutable history/ledger/Run verifier for Sound. Every
 * cost-bearing AVG ancestor and original-library request is relevant here;
 * an unresolved image or voice must not disappear when changing media lanes. */
export async function assertAvgSoundOtherRequestsKnownV1(scope:WorkspaceScope,current:Pick<ProductBuildRecordV1,'id'>|null){
  const others=await db.productBuilds.where('projectId').equals(scope.projectId).filter(row=>row.workId===scope.workId&&row.id!==current?.id).toArray()
  for(const build of others){
    if(!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-sound-restart] 历史版本跨作品')
    const row=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
    if(!row||!await assertRecordInScope(scope,'productProductionBriefs',row,{owner:'work'}))throw new Error('[avg-sound-restart] 历史制作方案缺失或跨作品')
    const brief=parseProductProductionBriefV3(row.briefJson)
    if(brief.intent.productType==='avg')await assertAvgProductionRequestsKnownV1(scope,build,'sound')
  }
}
