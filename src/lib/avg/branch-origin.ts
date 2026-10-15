import { hashProductProductionValueV2 as hash,isSha256Hash } from '../product-production/hash'
import { avgRecord } from './protocol-validation'

export interface AvgBranchOriginV1 {
  schema:'storyforge.avg.branch-origin'
  version:1
  runtimeSourceHash:string
  initialStateHash:string
  parentInitialStateHash:string
  parentEventPrefixHash:string
  parentThroughSequence:number
  receiptHash:string
}

/** Portable code-owned integrity evidence, not a signature or human receipt. */
export async function createAvgBranchOriginV1(input:{
  runtimeSourceHash:string;initialState:unknown;parentInitialState:unknown;parentThroughSequence:number;parentEventPrefix:unknown[]
}):Promise<AvgBranchOriginV1>{
  if(!isSha256Hash(input.runtimeSourceHash)||!Number.isSafeInteger(input.parentThroughSequence)||input.parentThroughSequence<0)
    throw new Error('[avg-branch-origin] 分支来源或事件序号无效')
  const body={schema:'storyforge.avg.branch-origin' as const,version:1 as const,runtimeSourceHash:input.runtimeSourceHash,
    initialStateHash:await hash(input.initialState),parentInitialStateHash:await hash(input.parentInitialState),
    parentEventPrefixHash:await hash(input.parentEventPrefix),parentThroughSequence:input.parentThroughSequence}
  return {...body,receiptHash:await hash(body)}
}

/** Absence retains legacy parent-pointer policy. A present record is never
 * ignored, even when the parent still exists or the stored head looks valid. */
export async function verifyAvgBranchOriginV1(input:{canonSnapshotJson:string;initialState:unknown;runtimeSourceHash:string}):Promise<boolean>{
  let canon:unknown
  try{canon=JSON.parse(input.canonSnapshotJson)}catch{throw new Error('[avg-branch-origin] 会话来源 JSON 损坏')}
  if(!canon||typeof canon!=='object'||Array.isArray(canon))throw new Error('[avg-branch-origin] 会话来源不是对象')
  if(!Object.prototype.hasOwnProperty.call(canon,'avgBranchOrigin'))return false
  const row=avgRecord((canon as Record<string,unknown>).avgBranchOrigin,
    ['schema','version','runtimeSourceHash','initialStateHash','parentInitialStateHash','parentEventPrefixHash','parentThroughSequence','receiptHash'],'AVG branch origin')
  const {receiptHash,...body}=row
  if(row.schema!=='storyforge.avg.branch-origin'||row.version!==1||!isSha256Hash(row.runtimeSourceHash)
    ||!isSha256Hash(row.initialStateHash)||!isSha256Hash(row.parentInitialStateHash)||!isSha256Hash(row.parentEventPrefixHash)||!isSha256Hash(receiptHash)
    ||!Number.isSafeInteger(row.parentThroughSequence)||(row.parentThroughSequence as number)<0
    ||!input.initialState||typeof input.initialState!=='object'||(input.initialState as {lastSequence?:unknown}).lastSequence!==0
    ||row.runtimeSourceHash!==input.runtimeSourceHash||row.initialStateHash!==await hash(input.initialState)||receiptHash!==await hash(body))
    throw new Error('[avg-branch-origin] 分支记录、初态或冻结来源不一致')
  return true
}
