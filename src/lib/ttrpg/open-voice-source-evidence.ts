/** Portable history of an actually checked original candidate. No inference,
 * listening, media import, adoption or resumed execution authority is issued. */
import { db } from '../db/schema'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { AgentRunStoreError, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { AgentRunArtifactStoreError, readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readTtrpgOpenVoiceAuditionBasisForKernelV1, readTtrpgOpenVoiceCandidateRetentionForKernelV1 } from './open-voice-candidate'
import { parseTtrpgOpenVoiceRequestV1, ttrpgOpenVoiceRequestInputV1 } from './open-voice-request-contract'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId, TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1 as relation } from './open-voice-execution-input'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import type { AnyAgentRunEventV1, ExactRunArtifactIdentityV1 } from '../types'
import * as p from './open-contract-parse'

const schema = 'storyforge.ttrpg-open-voice-source-evidence' as const
function refs(events: readonly AnyAgentRunEventV1[]): ExactRunArtifactIdentityV1[] {
  const result = new Map<string,ExactRunArtifactIdentityV1>()
  for (const e of events) if (e.type === 'evidence.artifact.recorded') {
    const artifactKind = p.oneOf(e.payload.artifactKind,['source-snapshot','context-manifest','raw-response'],'voice original artifact kind')
    const contentHash = p.hash(e.payload.contentHash,'voice original artifact hash')
    result.set(artifactKind+':'+contentHash,{artifactKind,contentHash})
  }
  if (!result.size || result.size > 63) p.fail('原语音证据引用超出独立快照预算')
  return [...result.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,ref])=>ref)
}
function freezeLog(s: AgentRunSnapshotV1) { return { runId: s.run.id, contractHash: s.run.contractHash, contractJson: s.run.contractJson, events: s.events } }
/** Internal historical parser; returns data only, never a resumable Run. */
export async function parseTtrpgOpenVoiceArchivedRunForKernelV1(value: unknown) {
  const r = p.record(value,['runId','contractHash','contractJson','events'],'voice archived run')
  if (typeof r.contractJson !== 'string' || new TextEncoder().encode(r.contractJson).length > 200000) p.fail('原配音契约字节超限')
  const [{parseAgentRunContract},{parseAgentRunEventV1},{replayAgentRunEventsV1}] = await Promise.all([
    import('../agent/run/contract'),import('../agent/run/event-schema'),import('../agent/run/projection')])
  const contract = parseAgentRunContract(p.json(r.contractJson)), runId = p.integer(r.runId,'archived voice run id',1,Number.MAX_SAFE_INTEGER)
  const events = p.list(r.events,'archived voice events',e=>parseAgentRunEventV1(e),4096,1)
  const projection = replayAgentRunEventsV1(events)
  if (stable(contract) !== r.contractJson || await hash(contract) !== r.contractHash || projection.errors.length
    || events.some((e,i)=>e.runId!==runId || e.projectId!==contract.scope.projectId || e.sequence!==i+1 || e.generation!==1 || e.contractHash!==r.contractHash)
    || projection.contractHash!==r.contractHash) p.fail('原语音归档的契约、事件或顺序不一致')
  return { runId,contract,events,projection,contractHash:p.hash(r.contractHash,'archived voice contract hash') }
}
async function candidateCheckpoint(b: Awaited<ReturnType<typeof readTtrpgOpenVoiceCandidateRetentionForKernelV1>>,candidateHash: string) {
  const { verifyAgentRunCheckpointV1 } = await import('../agent/run/checkpoint')
  const found = []
  for (const cp of await db.agentRunCheckpoints.where('runId').equals(b.snapshot.run.id).toArray()) {
    const body = cp.resumePayloadJson === null ? null : p.json(cp.resumePayloadJson)
    if (!body || typeof body !== 'object' || !('schema' in body) || body.schema !== 'storyforge.ttrpg-open-voice-candidate-review') continue
    const payload = p.record(body,['schema','version','candidateHash','inputArtifactHash','rawResponseArtifactHash'],'original voice review checkpoint')
    if (payload.version!==1 || payload.candidateHash!==candidateHash || payload.inputArtifactHash!==b.inputArtifactHash || payload.rawResponseArtifactHash!==b.raw?.hash
      || !await verifyAgentRunCheckpointV1(b.input.scope,cp.id!,{productRuntimeSessionId:b.input.sessionId})) p.fail('原候选专属检查点不一致')
    found.push({ hashBody:{version:1 as const,generation:cp.generation,throughSequence:cp.throughSequence,projectionHash:cp.projectionHash,resumePayloadHash:p.hash(cp.resumePayloadHash,'original review payload hash')},
      checkpointHash:cp.checkpointHash,resumePayload:payload })
  }
  if (found.length!==1) p.fail('独立语音来源快照需要唯一原候选检查点')
  return found[0]
}

/** Internal archive reader. Its caller must already own the corresponding
 * accepted/retained reference. This verifies history, never grants file access. */
export async function readTtrpgOpenVoiceSourceEvidenceForKernelV1(input: {
  projectId:number; evidenceArtifactHash:string; candidateHash:string; requestKey:string; sessionKey:string; runtimeSourceHash:string
}) {
  const expected=structuredClone(input)
  const content=await readAgentRunArtifactExactV1({projectId:expected.projectId,artifactKind:'source-snapshot',contentHash:p.hash(expected.evidenceArtifactHash,'voice source capsule hash')})
  if(new TextEncoder().encode(content).length>1048576)p.fail('原语音来源快照超过有界历史读取预算')
  const r=p.record(p.json(content),['schema','version','request','intent','execution','checkpoint','candidateHash','candidateArtifactHash','artifactRefs'],'voice source evidence')
  if(r.schema!==schema||r.version!==1||stable(r)!==content||r.candidateHash!==expected.candidateHash)p.fail('不是准确原候选的规范来源快照')
  const request=parseTtrpgOpenVoiceRequestV1(r.request),intent=await parseTtrpgOpenVoiceArchivedRunForKernelV1(r.intent),execution=await parseTtrpgOpenVoiceArchivedRunForKernelV1(r.execution)
  if(intent.events.length+execution.events.length>4096)p.fail('原父子语音事件总量超出来源快照预算')
  const parent=execution.contract.lineage?.parent,scope=execution.contract.scope.runtime
  if(request.requestKey!==expected.requestKey||request.script.sessionKey!==expected.sessionKey||request.script.runtimeSourceHash!==expected.runtimeSourceHash
    ||!request.reading||intent.contractHash!==request.runContractHash||intent.projection.state!=='completed'
    ||intent.contract.objective!=='ttrpg.open.voice-intent:'+request.requestKey||intent.contract.runtimeBindingHash!==request.inputArtifactHash
    ||intent.contract.permissions.contextSourceKeys.length||intent.contract.permissions.writeTargets.length||intent.contract.budget.maxModelCalls!==0||intent.contract.budget.maxInputTokens!==0||intent.contract.budget.maxOutputTokens!==0||intent.contract.budget.maxToolCalls!==1||intent.contract.budget.maxAttemptsPerStep!==1
    ||intent.contract.scope.projectId!==execution.contract.scope.projectId||stable(intent.contract.scope.runtime)!==stable(scope)
    ||intent.events.some(e=>['model.requested','model.responded','tool.called','tool.returned'].includes(e.type))
    ||execution.contract.version!==3||execution.contract.executionBoundary!=='product-runtime'||execution.contract.permissions.contextSourceKeys.join(',')!=='ttrpgOpenVoiceText'
    ||execution.contract.permissions.writeTargets.length||execution.contract.budget.maxToolCalls!==0||execution.contract.budget.maxAttemptsPerStep!==1
    ||execution.contract.objective!=='ttrpg.open.local-voice:'+request.requestKey||execution.events.some(e=>e.type==='tool.called'||e.type==='tool.returned')||!scope||scope.releaseHash!==request.script.runtimeSourceHash
    ||scope.baseSequence!==request.readEvidence.sequence||scope.stateHash!==request.readEvidence.stateHash||scope.visibilityHash!==request.scriptHash
    ||parent?.runId!==intent.runId||parent.relation!==relation||parent.receiptHash!==intent.projection.terminalReceiptHash
    ||execution.contract.executionBindings?.length!==1)p.fail('原配音快照缺少准确父终态、只读音频契约或运行范围')
  const binding=execution.contract.executionBindings[0]
  const [{projectFrozenAgentSkillDefinitionV1},{assertFormalAIEntrySnapshotIntegrityV1},{verifyContextManifestIntegrityV2}] = await Promise.all([
    import('../agent/execution-binding'),import('../agent/formal-ai-entry'),import('../agent/run/context-manifest')])
  if(binding.version!==2||binding.stepId!==stepId||!binding.formalEntry||binding.formalEntry.entryId!=='ttrpg.open.local-voice')p.fail('原来源缺少冻结音频入口')
  const skill=projectFrozenAgentSkillDefinitionV1(binding),entry=await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry,new Map([[skill.id,skill]]))
  if(entry.outputModality!=='audio'||entry.adoptAllowed||entry.adoptionTargets.length)p.fail('归档不能改造原只读音频权限')
  const artifactRefs=refs([...intent.events,...execution.events])
  if(stable(r.artifactRefs)!==stable(artifactRefs))p.fail('原来源快照未保存完整准确证据引用')
  const bodies=new Map<string,string>()
  for(const ref of artifactRefs){
    const content=await readAgentRunArtifactExactV1({projectId:expected.projectId,...ref}),byteLength=new TextEncoder().encode(content).length
    if([...intent.events,...execution.events].some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind===ref.artifactKind&&e.payload.contentHash===ref.contentHash&&e.payload.byteLength!==byteLength))p.fail('原工件正文与历史字节回执不一致')
    bodies.set(ref.artifactKind+':'+ref.contentHash,content)
  }
  const body=(kind:string,hash:unknown)=>{const value=bodies.get(kind+':'+p.hash(hash,'original voice body hash'));if(value===undefined)p.fail('独立快照缺少原准确正文');return value}
  if(body('source-snapshot',request.inputArtifactHash)!==stable(ttrpgOpenVoiceRequestInputV1(request))||await hash(request.script)!==request.scriptHash)p.fail('原完整配音意图或叙述 hash 不一致')
  const verification=p.record(p.json(body('source-snapshot',parent.artifactHash)),['schema','version','sourceRef','requestKey','receipt'],'original intent verification')
  const {parseVerificationReceiptV1,verifyVerificationReceiptIntegrityV1}=await import('../agent/run/verification-receipt'),receipt=parseVerificationReceiptV1(verification.receipt)
  if(verification.schema!=='storyforge.ttrpg-open-voice-intent-verification'||verification.version!==1||verification.requestKey!==request.requestKey||stable(verification.sourceRef)!==stable(request.sourceRef)
    ||!await verifyVerificationReceiptIntegrityV1(receipt)||receipt.runId!==intent.runId||receipt.contractHash!==intent.contractHash||receipt.receiptHash!==parent.receiptHash
    ||!receipt.zeroModelCommit||receipt.zeroModelCommit.contractJson!==stable(intent.contract)||stable(receipt.zeroModelCommit.inputArtifactHashes)!==stable([request.inputArtifactHash]))p.fail('原父意图终验正文与真实终态不一致')
  const inputHash=p.hash(execution.contract.runtimeBindingHash,'original voice execution input'),source=p.record(p.json(body('source-snapshot',inputHash)),['schema','version','requestKey','decision','intent','source','reading','profile','profileHash'],'original execution input')
  const sourcePart=request.script.text.slice(request.part.textOffset,request.part.textOffset+request.part.textLength)
  if(source.schema!=='storyforge.ttrpg-open-voice-execution-input'||source.version!==1||source.requestKey!==request.requestKey||source.decision!=='prepare-this-confirmed-local-voice-execution'
    ||stable(source.reading)!==stable(request.reading)||stable(source.source)!==stable({text:sourcePart,textHash:request.part.textHash,scriptHash:request.scriptHash,part:request.part,narrationSourceRef:request.script.narrationSourceRef,reservationSourceRef:request.sourceRef,scope:request.script.scope})
    ||stable(source.intent)!==stable({inputArtifactHash:request.inputArtifactHash,receiptHash:parent.receiptHash,verificationArtifactHash:parent.artifactHash})||await hash(source.profile)!==source.profileHash)p.fail('独立快照中的原输入、读法或父证明不一致')
  const {verifyTtrpgOpenConfirmedVoiceReadingV1}=await import('./open-voice-confirmed-reading-contract')
  await verifyTtrpgOpenConfirmedVoiceReadingV1(request.reading,sourcePart,request.part.textHash)
  const requested=execution.events.filter(e=>e.type==='model.requested'),responded=execution.events.filter(e=>e.type==='model.responded'),contexts=execution.events.filter(e=>e.type==='context.assembled')
  if(requested.length!==1||responded.length!==1||contexts.length!==1||requested[0].payload.bindingHash!==inputHash||[requested[0],responded[0],contexts[0]].some(e=>e.payload.stepId!==stepId||e.payload.attempt!==1))p.fail('原语音快照未绑定唯一实际派发与返回')
  const manifestEvents=execution.events.filter(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='context-manifest')
  if(manifestEvents.length!==1||manifestEvents[0].type!=='evidence.artifact.recorded'||manifestEvents[0].payload.stepId!==stepId||manifestEvents[0].payload.attempt!==1)p.fail('原语音 Manifest 不唯一')
  const manifest=p.object(p.json(body('context-manifest',manifestEvents[0].payload.contentHash)),'original voice manifest'),manifestScope=p.object(manifest.scope,'original manifest scope')
  const sources=p.list(manifest.sources,'original voice manifest sources',v=>p.object(v,'original voice source'),1,1)
  if(!await verifyContextManifestIntegrityV2(manifest)||manifest.runId!==execution.runId||manifest.stepId!==stepId||manifest.attempt!==1||contexts[0].payload.manifestHash!==manifest.manifestHash||manifestScope.projectId!==execution.contract.scope.projectId
    ||sources[0].key!=='ttrpgOpenVoiceText'||sources[0].status!=='included'||sources[0].delivery!=='full'||sources[0].contentHash!==request.part.textHash||sources[0].readerVersion!=='ttrpg.open.local-voice-source-v1'
    ||p.number(manifest.totalInputTokens,'archived original input tokens',0,8000)>p.number(manifest.inputBudget,'archived original input budget',1,8000))p.fail('原语音 Manifest 完整性不一致')
  const candidateContent=body('source-snapshot',r.candidateArtifactHash),candidate=p.record(p.json(candidateContent),['schema','version','portable','runId','runContractHash','productRuntimeSessionId','viewerKey','requestKey','profileHash','artifact','validation','candidateHash'],'original archived voice candidate')
  const {candidateHash,...candidateBody}=candidate
  if(stable(candidate)!==candidateContent||await hash(candidateBody)!==candidateHash||candidateHash!==expected.candidateHash||candidate.schema!=='storyforge.ttrpg-open-voice-candidate'||candidate.version!==1||candidate.portable!==false
    ||candidate.runId!==execution.runId||candidate.runContractHash!==execution.contractHash||candidate.productRuntimeSessionId!==scope.productRuntimeSessionId||candidate.viewerKey!==request.script.scope.issuerViewerKey||candidate.requestKey!==request.requestKey||candidate.profileHash!==source.profileHash)p.fail('归档候选不是原准确正文或谱系')
  for(const [kind,contentHash] of [['source-snapshot',inputHash],['source-snapshot',r.candidateArtifactHash],['raw-response',responded[0].payload.outputHash]])if(!execution.events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind===kind&&e.payload.contentHash===contentHash&&e.payload.stepId===stepId&&e.payload.attempt===1))p.fail('归档缺少原步骤的准确输入、候选或返回工件事件')
  const {parseCreativeAudioArtifactV1}=await import('../agent/creative-reliability'),artifact=parseCreativeAudioArtifactV1(candidate.artifact)
  if(!artifact.audio||!['ready','usable-with-warnings'].includes(artifact.status)||artifact.evidence.inputArtifactHash!==inputHash||artifact.evidence.contextManifestHash!==manifest.manifestHash||artifact.evidence.rawResponseArtifactHash!==responded[0].payload.outputHash)p.fail('归档候选缺少原音频、Manifest 或原始返回')
  body('raw-response',artifact.evidence.rawResponseArtifactHash)
  const validation=p.record(candidate.validation,['resultHash','timeline','usage','metrics','completionEvidence','cancellationRequestedAtFirstDelivery'],'original physical validation')
  const {verifyTtrpgOpenGeneratedVoiceTimeline}=await import('./open-voice-timeline-contract')
  const timeline=await verifyTtrpgOpenGeneratedVoiceTimeline({schema:'storyforge.ttrpg-open-generated-voice-timeline',version:p.object(validation.timeline,'original sample clock').sampleRate===24000?2:1,sourceTextHash:request.textHash,sourceTextLengthUtf16:request.script.text.length,normalizedText:request.reading.normalizedText,normalizedTextSha256:request.reading.normalizedTextSha256,clock:validation.timeline},request.script.text,{mimeType:artifact.audio.mimeType,byteSize:artifact.audio.byteLength,durationMs:artifact.audio.durationMs})
  const cp=p.record(r.checkpoint,['hashBody','checkpointHash','resumePayload'],'archived candidate checkpoint'),h=p.record(cp.hashBody,['version','generation','throughSequence','projectionHash','resumePayloadHash'],'archived V1 checkpoint hash body')
  const resume=p.record(cp.resumePayload,['schema','version','candidateHash','inputArtifactHash','rawResponseArtifactHash'],'archived candidate review payload')
  const through=p.integer(h.throughSequence,'archived candidate checkpoint sequence',1,4096),event=execution.events[through]
  const {replayAgentRunEventsV1,hashAgentRunProjectionBodyV1}=await import('../agent/run/projection')
  if(h.version!==1||h.generation!==1||await hash(cp.hashBody)!==cp.checkpointHash||await hash(resume)!==h.resumePayloadHash
    ||resume.schema!=='storyforge.ttrpg-open-voice-candidate-review'||resume.version!==1||resume.candidateHash!==candidateHash||resume.inputArtifactHash!==inputHash||resume.rawResponseArtifactHash!==artifact.evidence.rawResponseArtifactHash
    ||event?.type!=='checkpoint.created'||event.payload.checkpointHash!==cp.checkpointHash||event.payload.throughSequence!==through
    ||await hashAgentRunProjectionBodyV1(replayAgentRunEventsV1(execution.events.slice(0,through)))!==h.projectionHash
    ||!execution.events.slice(0,through).some(e=>e.type==='candidate.persisted'&&e.payload.stepId===stepId&&e.payload.attempt===1&&e.payload.candidateHash===candidateHash&&e.payload.requiresConfirmation))p.fail('独立快照缺少准确原候选检查点')
  return {request,candidateHash:p.hash(candidateHash,'original candidate hash'),timeline,audio:artifact.audio,artifactRefs:[...artifactRefs,{artifactKind:'source-snapshot' as const,contentHash:expected.evidenceArtifactHash}].sort((a,b)=>{const left=a.artifactKind+':'+a.contentHash,right=b.artifactKind+':'+b.contentHash;return left<right?-1:left>right?1:0}),
    archiveOnly:true as const,generationAllowed:false as const,adoptionAllowed:false as const,humanListening:'unproven' as const,physicalAudioRechecked:false as const}
}

/** Explicit preservation only. A live original physical candidate is required;
 * imported/ancestor/corrupt/paused evidence cannot acquire new authority. */
export async function freezeTtrpgOpenVoiceSourceEvidenceV1(request:TtrpgOpenVoiceJobLocatorV1&{candidateHash:string;decision:'freeze-this-original-voice-source-evidence'}) {
  const input=structuredClone(request);p.literal(input.decision,'freeze-this-original-voice-source-evidence','explicit original voice source preservation')
  const first=await readTtrpgOpenVoiceAuditionBasisForKernelV1(input)
  for(let attempt=0;attempt<12;attempt++){
    const b=await readTtrpgOpenVoiceCandidateRetentionForKernelV1(input,first.candidate)
    if(b.original.owner.runtime.product.safety.status!=='active')p.fail('暂停期间不能创建新的配音来源快照')
    const existing=[]
    for(const e of b.snapshot.events)if(e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='source-snapshot'&&e.payload.stepId==null){
      const content=await readAgentRunArtifactExactV1({projectId:input.scope.projectId,artifactKind:'source-snapshot',contentHash:e.payload.contentHash}),value=p.object(p.json(content),'original voice source capsule')
      if(value.schema===schema){if(value.candidateHash!==input.candidateHash)p.fail('原语音有冲突来源快照');existing.push({hash:e.payload.contentHash,value})}
    }
    if(existing.length>1)p.fail('原语音来源快照重复，保留证据并停止')
    if(existing.length){const e=existing[0],summary=await readTtrpgOpenVoiceSourceEvidenceForKernelV1({projectId:input.scope.projectId,evidenceArtifactHash:e.hash,candidateHash:input.candidateHash,requestKey:input.requestKey,sessionKey:b.original.request.script.sessionKey,runtimeSourceHash:b.original.request.script.runtimeSourceHash})
      for(const [name,events] of [['execution',b.snapshot.events],['intent',b.original.snapshot.events]] as const){
        const archived=p.object(e.value[name],'original voice prefix'),prefix=p.list(archived.events,'original prefix',v=>v,4096,1)
        if(stable(events.slice(0,prefix.length))!==stable(prefix))p.fail('原语音已不再包含准确父子事件前缀')
      }
      await readTtrpgOpenVoiceCandidateRetentionForKernelV1(input,first.candidate)
      return {evidenceArtifactHash:e.hash,...summary}}
    if(!['running','awaiting_confirmation'].includes(b.snapshot.projection.state))p.fail('当前原 Run 不能新建来源快照，保留现有证据')
    if(b.original.snapshot.events.length+b.snapshot.events.length>4096)p.fail('原父子语音事件总量超出来源快照预算，不截断历史')
    const checkpoint=await candidateCheckpoint(b,input.candidateHash),body={schema,version:1,request:b.original.request,intent:freezeLog(b.original.snapshot),execution:freezeLog(b.snapshot),checkpoint,candidateHash:input.candidateHash,candidateArtifactHash:await hash(first.candidate),artifactRefs:refs([...b.original.snapshot.events,...b.snapshot.events])}
    const content=stable(body)
    if(new TextEncoder().encode(content).length>1048576)p.fail('原配音来源快照超过有界保留预算，不截断历史')
    await b.original.owner.assertCurrent()
    try{await recordAgentRunArtifactV1({scope:input.scope,productRuntimeSessionId:input.sessionId,runId:b.snapshot.run.id,artifactKind:'source-snapshot',content,expectedLastSequence:b.snapshot.projection.lastSequence})}
    catch(error){if(error instanceof AgentRunArtifactStoreError&&error.code==='sequence-conflict'||error instanceof AgentRunStoreError&&error.code==='sequence_conflict')continue;throw error}
  }
  p.fail('原语音来源保留持续竞争，请明确继续同一原请求；没有重新生成')
}
