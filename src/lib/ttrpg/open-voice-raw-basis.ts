/** Original raw-retrieval proof, not today's generation input or a candidate. */
import { db } from '../db/schema'
import { canonicalStringify } from '../agent/run/hash'
import { verifyContextManifestIntegrityV2 } from '../agent/run/context-manifest'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { loadTtrpgOpenVoiceJobReadStateForKernelV1, type TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { readTtrpgOpenVoiceExecutionControlsForKernelV1 } from './open-voice-execution'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import * as p from './open-contract-parse'

export async function loadTtrpgOpenVoiceRawBasisForKernelV1(input: TtrpgOpenVoiceJobLocatorV1) {
  const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
  if (!b.identity) p.fail('缺少原准确输入的读取身份')
  const controlled = await readTtrpgOpenVoiceExecutionControlsForKernelV1({ scope: b.input.scope, sessionId: b.input.sessionId,
    runId: b.snapshot.run.id, inputArtifactHash: b.inputArtifactHash }), snapshot = controlled.snapshot
  if (snapshot.run.contractHash !== b.snapshot.run.contractHash || !['running','paused','recovering','awaiting_confirmation','completed'].includes(snapshot.projection.state)) p.fail('原语音已知终态或合同变化不能借取回证据复活')
  const requested = snapshot.events.filter(e => e.type === 'model.requested')
  if (requested.length !== 1 || requested[0].type !== 'model.requested' || requested[0].payload.stepId !== stepId
    || requested[0].payload.attempt !== 1 || requested[0].payload.bindingHash !== b.inputArtifactHash) p.fail('只能核查已经明确记账派发的原语音，不创建新调用')
  const manifests = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-manifest')
  const contexts = snapshot.events.filter(e => e.type === 'context.assembled')
  if (manifests.length !== 1 || manifests[0].type !== 'evidence.artifact.recorded' || manifests[0].payload.stepId !== stepId || manifests[0].payload.attempt !== 1
    || contexts.length !== 1 || contexts[0].type !== 'context.assembled' || contexts[0].payload.stepId !== stepId || contexts[0].payload.attempt !== 1) p.fail('缺少原唯一语音来源 Manifest 及其组装事件')
  const content = await readAgentRunArtifactExactV1({ projectId: b.input.scope.projectId, artifactKind: 'context-manifest', contentHash: manifests[0].payload.contentHash })
  const value = p.json(content)
  if (!await verifyContextManifestIntegrityV2(value)) p.fail('原语音 Manifest 完整性失败')
  const m = p.record(value, ['version','runId','stepId','attempt','scope','inputBudget','totalInputTokens','sources','v1ManifestHash','manifestHash'], 'original voice manifest')
  const scope = p.object(m.scope, 'original manifest scope'), sources = p.list(m.sources, 'original voice source', (value, label) => p.object(value, label), 1, 1)
  const [project,world,work] = await Promise.all([db.projects.get(b.input.scope.projectId),db.worlds.get(b.input.scope.worldId),db.works.get(b.input.scope.workId)])
  const source = sources[0]
  if (canonicalStringify(m) !== content || m.runId !== snapshot.run.id || m.stepId !== stepId || m.attempt !== 1
    || scope.projectId !== b.input.scope.projectId || scope.worldGroupId !== null || scope.workspaceUid !== project?.workspaceUid
    || scope.worldCode !== world?.code || scope.workCode !== work?.code || !project || !world || !work
    || source.key !== 'ttrpgOpenVoiceText' || source.status !== 'included' || source.delivery !== 'full'
    || source.contentHash !== b.original.request.part.textHash || source.readerVersion !== 'ttrpg.open.local-voice-source-v1'
    || m.manifestHash !== contexts[0].payload.manifestHash || p.number(m.totalInputTokens, 'original input tokens', 0, 8000) > p.number(m.inputBudget, 'original input budget', 1, 8000)) p.fail('原语音 Manifest 与准确来源/作用域/预算不一致')
  const rawEvents = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response' && e.payload.stepId === stepId && e.payload.attempt === 1)
  const responses = snapshot.events.filter(e => e.type === 'model.responded')
  if (rawEvents.length > 1 || responses.length > 1) p.fail('原语音原始返回证据重复或冲突，保留并停止')
  let raw: { hash: string; content: string } | null = null
  if (rawEvents[0]?.type === 'evidence.artifact.recorded') {
    const hash = rawEvents[0].payload.contentHash
    raw = { hash, content: await readAgentRunArtifactExactV1({ projectId: b.input.scope.projectId, artifactKind: 'raw-response', contentHash: hash }) }
  }
  const responded = responses[0]
  if (responded && (responded.type !== 'model.responded' || responded.payload.stepId !== stepId || responded.payload.attempt !== 1
    || !raw || responded.payload.outputHash !== raw.hash)) p.fail('原模型返回事件缺少准确已保存正文，不能重新取回覆盖')
  if (snapshot.projection.state === 'awaiting_confirmation' && (!raw || !responded)) p.fail('待确认候选缺少原已记账正文，不能借恢复补造')
  await b.original.owner.assertCurrent()
  return { ...b, identity: b.identity, snapshot, controls: controlled.controls, manifestHash: p.hash(m.manifestHash, 'original manifest hash'), raw, responded: !!responded }
}
