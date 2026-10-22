import {expect,it} from 'vitest'
import {createProductBuildRootTerminalReceiptV1,projectProductBuildRootTerminalReceiptBodyV2} from '../../src/lib/product-production/receipts'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import type {ProductBuildArtifactRecordV1} from '../../src/lib/types'
const hash='a'.repeat(64)
function fixture(){return {planHash:hash,manifestHash:hash,packageHash:hash,qualityReportHash:hash,controlEpoch:2,
 budgetLedgerJson:JSON.stringify({schema:'storyforge.product-production-budget-ledger',version:2,rootRunId:6,tasks:{a:{runId:7}},attempts:[{runId:2},{runId:7}]}),
 artifacts:[{artifactKey:'a',requirementKey:null,version:1,kind:'runtime-package',mediaKind:null,status:'accepted',controlEpoch:2,
  inputHash:hash,contentHash:hash,producerReceiptHash:hash,payloadJson:'{"value":1}',metadataJson:'{}',qualityJson:'{}',rightsJson:'{}',blobObjectId:null,
  mimeType:null,byteSize:0,parentArtifactHash:null,carriedFrom:null} as ProductBuildArtifactRecordV1]}}
it('projects the exact V2 preimage and retains the baseline canonical receipt for all envelope fields',async()=>{
 const input=fixture(),body=await projectProductBuildRootTerminalReceiptBodyV2(input)
 expect(body).toMatchObject({schema:'storyforge.product-build-root-terminal-receipt',version:2,controlEpoch:2,budgetLedger:JSON.parse(input.budgetLedgerJson)})
 expect(await createProductBuildRootTerminalReceiptV1(input)).toBe(await hashProductProductionValueV2(body))
 const expected={schema:'storyforge.product-build-root-terminal-receipt',version:2,planHash:hash,manifestHash:hash,packageHash:hash,qualityReportHash:hash,controlEpoch:2,
  budgetLedger:JSON.parse(input.budgetLedgerJson),artifactEnvelopes:[{artifactKey:'a',requirementKey:null,version:1,kind:'runtime-package',mediaKind:null,status:'accepted',controlEpoch:2,
   inputHash:hash,contentHash:hash,producerReceiptHash:hash,payloadJsonHash:await hashProductProductionValueV2(input.artifacts[0].payloadJson),metadataJsonHash:await hashProductProductionValueV2('{}'),
   qualityJsonHash:await hashProductProductionValueV2('{}'),rightsJsonHash:await hashProductProductionValueV2('{}'),hasBlob:false,mimeType:null,byteSize:0,parentArtifactHash:null,carriedFrom:null}]}
 expect(body).toEqual(expected);expect(await createProductBuildRootTerminalReceiptV1(input)).toBe(await hashProductProductionValueV2(expected))
})
it('still binds original local Run IDs and exact payload/rights rather than weakening the seal to make import pass',async()=>{
 const input=fixture(),original=await createProductBuildRootTerminalReceiptV1(input)
 for(const delta of [{payloadJson:'{"value":2}'},{metadataJson:'{"changed":true}'},{qualityJson:'{"changed":true}'},{rightsJson:'{"changed":true}'},{producerReceiptHash:'b'.repeat(64)}]){
  const copy=structuredClone(input);Object.assign(copy.artifacts[0],delta);expect(await createProductBuildRootTerminalReceiptV1(copy)).not.toBe(original)
 }
 const copy=structuredClone(input),ledger=JSON.parse(copy.budgetLedgerJson);ledger.rootRunId=18;copy.budgetLedgerJson=JSON.stringify(ledger)
 expect(await createProductBuildRootTerminalReceiptV1(copy)).not.toBe(original)
})
it('preserves malformed hash, epoch, duplicate artifact and nonaccepted envelope rejection',async()=>{
 const input=fixture()
 await expect(projectProductBuildRootTerminalReceiptBodyV2({...input,planHash:'x'})).rejects.toThrow()
 await expect(projectProductBuildRootTerminalReceiptBodyV2({...input,controlEpoch:-1})).rejects.toThrow()
 await expect(projectProductBuildRootTerminalReceiptBodyV2({...input,artifacts:[input.artifacts[0],input.artifacts[0]]})).rejects.toThrow()
 await expect(projectProductBuildRootTerminalReceiptBodyV2({...input,artifacts:[{...input.artifacts[0],status:'candidate'}]})).rejects.toThrow()
})
