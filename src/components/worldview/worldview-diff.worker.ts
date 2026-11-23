import { DIFF_BUDGET_V2, diffWorldviewTextExactV2, validateDiffBudgetV2, type DiffResultV2, type DiffBudgetV2 } from '../../lib/agent/worldview-text-diff-v2'
import { hashCanonicalValue, canonicalStringify } from '../../lib/agent/run/hash'

export const WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1=500000
export const WORLDVIEW_DIFF_JOB_V1 = 'worldview-diff-job-v1' as const
export interface WorldviewDiffJobV1 {
  version: typeof WORLDVIEW_DIFF_JOB_V1; type: 'compare'; jobId: number; identityKey: string
  baselineHash: string; leftHash: string; rightRevision: number; rightHash: string; leftRaw: string; rightRaw: string
  sourceKind: 'field-value' | 'raw-artifact'
  profile: { kind: 'intl-grapheme'; version: 1; locale: 'zh-CN' }
  budget: DiffBudgetV2; profileRequestHash: string; budgetHash: string; inputBindingHash: string
}
export interface WorldviewDiffReplyV1 {
  version: typeof WORLDVIEW_DIFF_JOB_V1; type: 'result'; jobId: number; identityKey: string
  baselineHash: string; leftHash: string; rightRevision: number; rightHash: string; profileRequestHash: string; budgetHash: string; inputBindingHash: string
  result: DiffResultV2; resultBinding: string
}
export function exactDiffObjectV1(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error('diff-message-shape')
}
export function diffJobBindingV1(job: WorldviewDiffJobV1) {
  return { jobId: job.jobId, identityKey: job.identityKey, baselineHash: job.baselineHash, leftHash: job.leftHash, rightRevision: job.rightRevision,
    rightHash: job.rightHash, sourceKind: job.sourceKind, profileRequestHash: job.profileRequestHash, budgetHash: job.budgetHash }
}
export async function computeWorldviewDiffJobV1(value: unknown): Promise<WorldviewDiffReplyV1> {
  exactDiffObjectV1(value,['version','type','jobId','identityKey','baselineHash','leftHash','rightRevision','rightHash','leftRaw','rightRaw','sourceKind','profile','budget','profileRequestHash','budgetHash','inputBindingHash'])
  const job=value as WorldviewDiffJobV1
  exactDiffObjectV1(job.profile,['kind','version','locale'])
  if(job.version!==WORLDVIEW_DIFF_JOB_V1||job.type!=='compare'||!Number.isSafeInteger(job.jobId)||job.jobId<1
    ||typeof job.identityKey!=='string'||!job.identityKey.length||job.identityKey.length>8192
    ||!Number.isSafeInteger(job.rightRevision)||job.rightRevision<0
    ||typeof job.leftRaw!=='string'||typeof job.rightRaw!=='string'||job.leftRaw.length>WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1||job.rightRaw.length>WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1
    ||!['field-value','raw-artifact'].includes(job.sourceKind)||job.profile.kind!=='intl-grapheme'||job.profile.version!==1||job.profile.locale!=='zh-CN') throw new Error('diff-message-binding')
  for(const hash of [job.baselineHash,job.leftHash,job.rightHash,job.profileRequestHash,job.budgetHash,job.inputBindingHash]) if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)) throw new Error('diff-message-hash')
  validateDiffBudgetV2(job.budget)
  if(canonicalStringify(job.budget)!==canonicalStringify(DIFF_BUDGET_V2)
    ||await hashCanonicalValue(job.leftRaw)!==job.leftHash||await hashCanonicalValue(job.rightRaw)!==job.rightHash||await hashCanonicalValue(job.profile)!==job.profileRequestHash
    ||await hashCanonicalValue(job.budget)!==job.budgetHash||await hashCanonicalValue(diffJobBindingV1(job))!==job.inputBindingHash) throw new Error('diff-message-binding')
  const result=diffWorldviewTextExactV2({left:job.leftRaw,right:job.rightRaw,budget:job.budget,segmentation:job.profile})
  const body={version:WORLDVIEW_DIFF_JOB_V1,type:'result' as const,jobId:job.jobId,identityKey:job.identityKey,baselineHash:job.baselineHash,leftHash:job.leftHash,
    rightRevision:job.rightRevision,rightHash:job.rightHash,profileRequestHash:job.profileRequestHash,budgetHash:job.budgetHash,inputBindingHash:job.inputBindingHash,result}
  return {...body,resultBinding:await hashCanonicalValue(body)}
}
// This same module has pure validators imported by the view. Only a real Worker
// owns this handler; importing it in the browser never changes window.onmessage.
const scope=globalThis as unknown as {postMessage?:(value:unknown)=>void;onmessage?:((event:MessageEvent)=>void)|null}
if(typeof document==='undefined'&&typeof scope.postMessage==='function') scope.onmessage=event=>{
  void computeWorldviewDiffJobV1(event.data).then(reply=>scope.postMessage!(reply)).catch(()=>{ const job=event.data as Partial<WorldviewDiffJobV1>; scope.postMessage!({version:WORLDVIEW_DIFF_JOB_V1,type:'error',code:'diff-computation-failed',jobId:job.jobId,identityKey:job.identityKey,baselineHash:job.baselineHash,leftHash:job.leftHash,rightRevision:job.rightRevision,rightHash:job.rightHash,profileRequestHash:job.profileRequestHash,budgetHash:job.budgetHash,inputBindingHash:job.inputBindingHash}) })
}
