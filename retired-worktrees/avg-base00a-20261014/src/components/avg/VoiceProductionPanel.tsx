import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { avgVoiceProductionEnabledV3 } from '../../lib/avg/assembly-contract'
import { avgRawVoiceArtifactKeyV1, avgVoiceChoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1 } from '../../lib/avg/voice-assembly-contract'
import { parseAvgStoredAssemblyBriefV3 } from '../../lib/avg/voice-assembly-storage'
import { readAvgVoiceDraftV1, type AvgVoiceDraftLineV1 } from '../../lib/avg/voice-draft-contract'
import { clearAvgVoiceProductionDraftV1, saveAvgVoiceProductionDraftV1 } from '../../lib/avg/voice-draft-service'
import { hashAvgSpeechProtocolV1, parseAvgSpeechProtocolV1 } from '../../lib/avg/voice-request-contract'
import { AVG_LOCAL_VOICE_PROVIDER_V1, AVG_LOCAL_VOICE_MODEL_V1, AVG_LOCAL_VOICE_IDS_V1, AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1, avgLocalVoiceProtocolV1 } from '../../lib/avg/voice-local-profile'
import { readConfiguredAvgVoiceDraftRouteV1 } from '../../lib/avg/media-capability'
import { configureAvgChosenVoiceDraftV3, keepAvgGeneratedVoiceStageDraftV1, type readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import VoiceReviewPanel from './VoiceReviewPanel'
import VoiceRecoveryPanel from './VoiceRecoveryPanel'
import { stopProductProductionV1 } from '../../lib/product-production/service'
import { canonicalStringify } from '../../lib/agent/run/hash'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type DraftLine = AvgVoiceDraftLineV1 & { voiceId: string; rightsDeclaration: string; rightsReference: string; presetRevision: number }
type PanelProps = {
  scope: WorkspaceScope; view: View; workspace: AvgAuthorWorkspaceV1; disabled: boolean; canEdit: boolean
  canAdopt: boolean; sourcesReady: boolean; declaration: string; visible: boolean; generating: boolean
  onPending: (pending: boolean) => void; onAction: (task: () => Promise<void>) => Promise<void>
  onReload: () => Promise<void>; onGenerate: () => Promise<void>; onCancel: () => void; onNotice: (text: string) => void
}

function VoiceBatchEditor({ scope, view, workspace, disabled, canEdit, onPending, onAction, onReload, onNotice }: Pick<PanelProps,
  'scope' | 'view' | 'workspace' | 'disabled' | 'canEdit' | 'onPending' | 'onAction' | 'onReload' | 'onNotice'>) {
  const saved = workspace.voiceProduction ? readAvgVoiceDraftV1(workspace.voiceProduction).voice : null
  const [local, setLocal] = useState(!saved || saved.protocol.provider === AVG_LOCAL_VOICE_PROVIDER_V1)
  const [model, setModel] = useState(saved?.protocol.model ?? AVG_LOCAL_VOICE_MODEL_V1)
  const [inputLimit, setInputLimit] = useState(saved?.protocol.maximumInputCharacters ?? 4096)
  const [instructions, setInstructions] = useState(saved?.protocol.supportsInstructions ?? false)
  const [instructionLimit, setInstructionLimit] = useState(saved?.protocol.maximumInstructionsCharacters || 2000)
  const [speed, setSpeed] = useState(!!saved?.protocol.speedRange)
  const [minimumSpeed, setMinimumSpeed] = useState(saved?.protocol.speedRange?.minimum ?? 0.5)
  const [maximumSpeed, setMaximumSpeed] = useState(saved?.protocol.speedRange?.maximum ?? 2)
  const [rows, setRows] = useState<DraftLine[]>(() => saved?.batch.requirements.map(r => {
    const preset = saved.batch.presets.find(p => p.presetKey === r.presetKey)!
    return { requirementKey: r.requirementKey, assetKey: r.assetKey, sceneKey: r.sceneKey, lineKey: r.lineKey,
      presetKey: r.presetKey, presetRevision: preset.revision, maximumDurationMs: r.maximumDurationMs,
      performance: structuredClone(r.performance), voiceId: preset.voiceId,
      rightsDeclaration: preset.rights.declaration, rightsReference: preset.rights.reference }
  }) ?? [])
  const [pending, setPending] = useState(false)
  useEffect(() => { onPending(pending); return () => onPending(false) }, [pending, onPending])
  const change = (action: () => void) => { action(); setPending(true) }
  const update = (index: number, update: (row: DraftLine) => void) => change(() => setRows(old => old.map((r, i) => {
    if (i !== index) return r
    const next = structuredClone(r); update(next)
    if (old.some((other, j) => j !== i && other.presetKey === next.presetKey)
      && (next.voiceId !== r.voiceId || next.rightsDeclaration !== r.rightsDeclaration || next.rightsReference !== r.rightsReference)) {
      next.presetKey = `voice.preset.${crypto.randomUUID()}`; next.presetRevision = 1
    }
    return next
  })))
  const lineOptions = workspace.scripts.flatMap(script => script.lines.map((line, index) => ({ sceneKey: script.sceneKey, line,
    label: `${workspace.systemPlan.scenes.find(s => s.key === script.sceneKey)?.title ?? '场景'} · 第 ${index + 1} 句` })))
  const save = async () => {
    const route = local ? undefined : await readConfiguredAvgVoiceDraftRouteV1({ projectId: scope.projectId, model })
    const protocol = local ? await avgLocalVoiceProtocolV1() : parseAvgSpeechProtocolV1({ schema: 'storyforge.avg.speech-protocol', version: 1,
      adapterId: 'storyforge.avg.compatible-speech.v1', provider: 'agnes', model, ...route,
      voices: [...new Set(rows.map(r => r.voiceId))].map(voiceId => ({ voiceId, locales: ['zh-CN'] })), outputFormat: 'wav',
      maximumInputCharacters: inputLimit, supportsInstructions: instructions,
      maximumInstructionsCharacters: instructions ? instructionLimit : 0,
      speedRange: speed ? { minimum: minimumSpeed, maximum: maximumSpeed } : null })
    const capabilityHash = await hashAvgSpeechProtocolV1(protocol)
    await saveAvgVoiceProductionDraftV1({ scope, expectedDraftRevision: view.draft.revision, protocol,
      presets: [...new Map(rows.map(r => [r.presetKey, r])).values()].map(r => ({ presetKey: r.presetKey, revision: r.presetRevision,
        adapterId: protocol.adapterId, provider: protocol.provider, model: protocol.model, voiceId: r.voiceId,
        locale: 'zh-CN', endpointRouteHash: protocol.endpointRouteHash, capabilityHash,
        rights: { basis: 'provider-preset', declaration: r.rightsDeclaration, reference: r.rightsReference } })),
      lines: rows.map(({ voiceId: _voiceId, rightsDeclaration: _declaration, rightsReference: _reference, presetRevision: _revision, ...line }) => line) })
    setPending(false); await onReload(); onNotice('准确配音需求已保存，没有调用服务。请核对制作方案后另行明确开始。')
  }
  return <section aria-label="逐句配音需求草稿"><h4>逐句配音需求 <small>实验</small></h4>
    <p>从已保存对白选择 1～8 句。原句和说话人由脚本读取；请填写已核对的服务能力和合法音色，保存不会生成音频。</p>
    <p>明确开始后，才会将准确台词和演法发送到本批冻结的服务。生成后仍需逐句审听并确认采用。</p>
    <fieldset className="avg-form" disabled={disabled || !canEdit}>
      <legend>本批服务能力声明</legend>
      {local ? <p>本机免费配音 · Qwen3-TTS 1.7B 固定音色。支持中文和演法指令，每句至多 256 字符；请先按本机服务说明启动推理服务。生成不会使用 Agnes 密钥，也不会上传到远程语音服务。</p>
        : <><p>这是旧版兼容服务方案；原始记录与路由保留。</p><button type="button" onClick={() => change(() => {
          setLocal(true); setModel(AVG_LOCAL_VOICE_MODEL_V1)
          setRows(old => old.map(r => ({ ...r, voiceId: 'Serena', presetRevision: r.presetRevision + 1,
            rightsDeclaration: 'Qwen 官方固定音色模型，模型标注 Apache-2.0；实际输出仍需审听和权利复核。',
            rightsReference: AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1, performance: { ...r.performance, speed: null } })))
        })}>将未开始的需求改用本机固定音色</button></>}
      {!local && <><label>兼容服务模型 ID<input value={model} maxLength={200} onChange={e => change(() => setModel(e.target.value))} /></label>
      <p>旧方案使用原模型设置中的服务地址；历史记录不会因本机配音而改写。</p>
      <label>模型单次文字上限<input type="number" min={1} max={4096} value={inputLimit} onChange={e => change(() => setInputLimit(Number(e.target.value)))} /></label>
      <label><input type="checkbox" checked={instructions} onChange={e => change(() => setInstructions(e.target.checked))} />已核对该模型支持演法与读音指令</label>
      {instructions && <label>完整指令字符上限<input type="number" min={1} max={4096} value={instructionLimit} onChange={e => change(() => setInstructionLimit(Number(e.target.value)))} /></label>}
      <label><input type="checkbox" checked={speed} onChange={e => change(() => setSpeed(e.target.checked))} />已核对该模型支持明确语速</label>
      {speed && <><label>最低语速<input type="number" min={0.25} max={4} step={0.05} value={minimumSpeed} onChange={e => change(() => setMinimumSpeed(Number(e.target.value)))} /></label>
        <label>最高语速<input type="number" min={0.25} max={4} step={0.05} value={maximumSpeed} onChange={e => change(() => setMaximumSpeed(Number(e.target.value)))} /></label></>}
      </>}
      <h5>选择准确台词</h5>
      {lineOptions.map(option => <label key={`${option.sceneKey}:${option.line.lineKey}`}><input type="checkbox"
        checked={rows.some(r => r.sceneKey === option.sceneKey && r.lineKey === option.line.lineKey)}
        disabled={rows.length >= 8 && !rows.some(r => r.sceneKey === option.sceneKey && r.lineKey === option.line.lineKey)}
        onChange={e => change(() => setRows(old => e.target.checked ? [...old, {
          requirementKey: `voice.${crypto.randomUUID()}`, assetKey: `voice.asset.${crypto.randomUUID()}`,
          presetKey: `voice.preset.${crypto.randomUUID()}`, presetRevision: 1, sceneKey: option.sceneKey, lineKey: option.line.lineKey,
          maximumDurationMs: 10_000, performance: { revision: 1, intent: 'natural-reading', pronunciations: [], instructions: null, speed: null },
          voiceId: local ? 'Serena' : '',
          rightsDeclaration: local ? 'Qwen 官方固定音色模型，模型标注 Apache-2.0；实际输出仍需审听和权利复核。' : '',
          rightsReference: local ? AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1 : '',
        }] : old.filter(r => r.sceneKey !== option.sceneKey || r.lineKey !== option.line.lineKey)))} />
        {option.label}：{option.line.text}</label>)}
      {rows.map((row, index) => <fieldset key={row.requirementKey}><legend>第 {index + 1} 项配音</legend>
        <p>{lineOptions.find(o => o.sceneKey === row.sceneKey && o.line.lineKey === row.lineKey)?.line.text ?? '原句已不存在，请撤销此需求后重新选择'}</p>
        <label>音色{local ? <select value={row.voiceId} onChange={e => update(index, r => { r.voiceId = e.target.value })}>
          {AVG_LOCAL_VOICE_IDS_V1.map(id => <option key={id} value={id}>{({ Vivian: '明亮女声', Serena: '温柔女声', Uncle_Fu: '沉稳男声', Dylan: '北京男声', Eric: '四川男声' })[id]} · {id}</option>)}
        </select> : <input value={row.voiceId} maxLength={200} onChange={e => update(index, r => { r.voiceId = e.target.value })} />}</label>
        <label>音色使用权说明<textarea value={row.rightsDeclaration} maxLength={4000} onChange={e => update(index, r => { r.rightsDeclaration = e.target.value })} /></label>
        <label>音色条款或授权依据<input value={row.rightsReference} maxLength={2000} onChange={e => update(index, r => { r.rightsReference = e.target.value })} /></label>
        <label>音频最长秒数<input type="number" min={1} max={120} value={row.maximumDurationMs / 1000} onChange={e => update(index, r => { r.maximumDurationMs = Number(e.target.value) * 1000 })} /></label>
        <label>演法类型<select value={row.performance.intent === 'natural-reading' ? 'natural-reading' : 'custom'} onChange={e => update(index, r => { r.performance.intent = e.target.value === 'natural-reading' ? 'natural-reading' : '' })}><option value="natural-reading">自然朗读</option><option value="custom">自定义演法</option></select></label>
        {row.performance.intent !== 'natural-reading' && <label>演法意图<input value={row.performance.intent} maxLength={2000} onChange={e => update(index, r => { r.performance.intent = e.target.value })} /></label>}
        <label>演法指令<textarea value={row.performance.instructions ?? ''} maxLength={4000} onChange={e => update(index, r => { r.performance.instructions = e.target.value || null })} /></label>
        <label>明确语速（留空使用服务默认）<input disabled={local} type="number" min={0.5} max={2} step={0.05} value={row.performance.speed ?? ''} onChange={e => update(index, r => { r.performance.speed = e.target.value === '' ? null : Number(e.target.value) })} /></label>
        {row.performance.pronunciations.map((entry, i) => <div className="avg-assembly-row" key={i}>
          <label>原句词语<input value={entry.phrase} maxLength={200} onChange={e => update(index, r => { r.performance.pronunciations[i].phrase = e.target.value })} /></label>
          <label>读法<input value={entry.reading} maxLength={500} onChange={e => update(index, r => { r.performance.pronunciations[i].reading = e.target.value })} /></label>
          <button type="button" onClick={() => update(index, r => { r.performance.pronunciations.splice(i, 1) })}>移除此读音</button>
        </div>)}
        <button type="button" disabled={row.performance.pronunciations.length >= 32} onClick={() => update(index, r => { r.performance.pronunciations.push({ phrase: '', reading: '' }) })}>增加读音要求</button>
      </fieldset>)}
      {local && <p>本机方案不支持单独的语速参数；演法和发音要求会完整传给模型，能否达到要求须以实际音频审听为准。</p>}
      <p>阅读等待上限：{workspace.presentation.reading ? `${workspace.presentation.reading.maximumVoiceWaitMs / 1000} 秒` : '尚未设置，请先配置阅读及配音失败策略'}；每句音频上限须更短。费用未知会保留为未知。</p>
      <button className="lf-action" disabled={!pending || !rows.length || !model.trim()} onClick={() => void onAction(save)}>保存配音需求草稿</button>
      {workspace.voiceProduction && <button className="lf-action" disabled={pending} onClick={() => void onAction(async () => {
        await clearAvgVoiceProductionDraftV1({ scope, expectedDraftRevision: view.draft.revision }); await onReload(); onNotice('未使用的配音批次已移除，原制作和费用记录保留。')
      })}>移除未使用的配音批次</button>}
    </fieldset>
    {pending && <button className="lf-action" disabled={disabled} onClick={() => void onAction(async () => {
      setPending(false); await onReload()
    })}>撤销未保存的配音需求</button>}
  </section>
}

function VoiceCandidate({ row, onReviewPending, ...props }: Omit<ComponentProps<typeof VoiceReviewPanel>, 'raw' | 'onPending'> & {
  row: ProductBuildArtifactRecordV1; onReviewPending: (key: string, value: boolean) => void
}) {
  const onPending = useCallback((value: boolean) => onReviewPending(row.artifactKey, value), [onReviewPending, row.artifactKey])
  return <VoiceReviewPanel {...props} raw={row} onPending={onPending} />
}

export default function VoiceProductionPanel(props: PanelProps) {
  const { scope, view, workspace, disabled, canEdit, canAdopt, sourcesReady, declaration, visible, generating,
    onPending, onAction, onReload, onGenerate, onCancel, onNotice } = props
  const [formPending, setFormPending] = useState(false), [recoveryPending, setRecoveryPending] = useState(false), [reviews, setReviews] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState(''), [discard, setDiscard] = useState(0)
  const reviewPending = Object.values(reviews).some(Boolean)
  const onReviewPending = useCallback((key: string, value: boolean) => setReviews(old => old[key] === value ? old : { ...old, [key]: value }), [])
  useEffect(() => { onPending(formPending || reviewPending || recoveryPending); return () => onPending(false) }, [formPending, reviewPending, recoveryPending, onPending])
  const stored = view.details?.executionBrief?.avgAssembly
  const assembly = stored?.version === 3 ? parseAvgStoredAssemblyBriefV3(stored).assembly : null
  const batch = assembly?.voice.batch, productionId = view.details?.production.id
  const accepted = (key: string) => view.artifacts.find(a => a.artifactKey === key && a.status === 'accepted')
  const pending = (key: string) => view.artifacts.find(a => a.artifactKey === key && a.status === 'pending')
  const outstanding = batch?.requirements.filter(r => !accepted(avgRawVoiceArtifactKeyV1(r.requirementKey))) ?? []
  const newRequests = outstanding.filter(r => !assembly?.voice.recovery?.retained.some(a => a.requirementKey === r.requirementKey)).length
  const allChoices = !!batch && batch.requirements.every(r => accepted(avgVoiceChoiceArtifactKeyV1(r.requirementKey)))
  const enabled = avgVoiceProductionEnabledV3()
  const pendingBrief = view.details?.production.status === 'brief-ready' && view.details.brief?.revision !== view.details.build?.briefRevision
  const editableVoice = workspace.voiceProduction ? readAvgVoiceDraftV1(workspace.voiceProduction).voice : null
  const canFinishBatch = !!assembly && !!editableVoice
    && canonicalStringify({ batch: assembly.voice.batch, protocol: assembly.voice.protocol, binding: assembly.voice.binding }) === canonicalStringify(editableVoice)
    && assembly.voice.batch.requirements.some(r => workspace.presentation.stage.assets.some(asset => asset.kind === 'voice' && asset.assetKey === r.assetKey))
  const stoppedBatch = !!view.details?.build && ['cancelled', 'failed', 'recovery-required'].includes(view.details.build.status)
  return <section className="lf-paper" aria-label="配音生产工作台">
    <VoiceBatchEditor key={`${scope.workId}:${workspace.voiceProduction?.contentHash ?? 'new'}:${discard}`} {...props}
      disabled={disabled || reviewPending || recoveryPending || generating} canEdit={canEdit && !generating} onPending={setFormPending}
      onReload={async () => { await onReload(); setDiscard(n => n + 1) }} />
    {!enabled && <p>实验性配音生产尚未开放；可以保存需求草稿并查看已有记录。</p>}
    {canFinishBatch && productionId && view.details?.build?.id
      && (view.details.build.previewHash || ['cancelled', 'failed', 'recovery-required'].includes(view.details.build.status)) && <button className="lf-action"
        disabled={disabled || (!canEdit && !stoppedBatch) || formPending || reviewPending || recoveryPending || generating || pendingBrief}
        onClick={() => void onAction(async () => {
          await keepAvgGeneratedVoiceStageDraftV1({ scope, productionId, expectedDraftRevision: view.draft.revision,
            expectedBuildId: view.details!.build!.id! })
          await onReload(); setDiscard(n => n + 1)
          onNotice('已保留准确已采用配音并结束本批需求；后续版本仍需核对原句和演出并确认采用，旧音频及调用账单保留。')
        })}>保留已采用配音，结束本批需求</button>}
    {batch && productionId && !pendingBrief && <>
      <h4>本批配音与审听</h4><p>共 {batch.requirements.length} 句，待接收 {outstanding.length} 句，本次至多 {newRequests} 次新配音请求。原始费用与失败记录保留。</p>
      {assembly?.image && <p>这是图音联合批次；继续执行也会处理本方案已确认的图片任务，最多 {assembly.image.mediaBatch.requirements.filter(r => !accepted(`avg.media.raw.${r.requirementKey}`) && !assembly.image!.imageRecovery?.retained.some(a => a.requirementKey === r.requirementKey)).length} 次新图片请求。</p>}
      {generating ? <button className="lf-action" onClick={onCancel}>停止等待并保留本批记录</button> : <button className="lf-action" disabled={disabled || formPending || reviewPending || recoveryPending || !enabled || !canAdopt || !sourcesReady || !outstanding.length} onClick={() => void onGenerate()}>执行已确认的配音及联合媒资任务</button>}
      {batch.requirements.map(r => { const raw = accepted(avgRawVoiceArtifactKeyV1(r.requirementKey)); return <article className="avg-assembly-candidate" key={r.requirementKey}>
        <p>{r.text}</p>{raw ? <><button className="lf-action" disabled={formPending || reviewPending || recoveryPending} onClick={() => setExpanded(expanded === r.requirementKey ? '' : r.requirementKey)}>查看并审听此句</button>
          {expanded === r.requirementKey && <VoiceCandidate scope={scope} productionId={productionId} row={raw}
            processed={accepted(`avg.voice.processed.${r.requirementKey}`)}
            review={accepted(avgVoiceReviewArtifactKeyV1(r.requirementKey))} pendingReview={pending(avgVoiceReviewArtifactKeyV1(r.requirementKey))}
            choice={accepted(avgVoiceChoiceArtifactKeyV1(r.requirementKey))} pendingChoice={pending(avgVoiceChoiceArtifactKeyV1(r.requirementKey))}
            disabled={disabled || !visible || formPending || recoveryPending || generating} canAdopt={canAdopt} declaration={declaration}
            onReviewPending={onReviewPending} onAction={onAction} onReload={onReload} />}</> : <p>等待接收准确音频</p>}
      </article> })}
      <button className="lf-action" disabled={disabled || formPending || reviewPending || recoveryPending || !canAdopt || !allChoices} onClick={() => void onAction(async () => {
        await configureAvgChosenVoiceDraftV3({ scope, productionId, expectedDraftRevision: view.draft.revision }); await onReload()
        onNotice('已采用配音已配置到准确句子。请回到制作页另外确认演出，再生成联合预览。')
      })}>将已采用配音配置到逐句阅读</button>
      {canAdopt && <button className="lf-action" disabled={disabled || formPending || reviewPending || recoveryPending || generating} onClick={() => void onAction(async () => {
        await stopProductProductionV1({ scope, production: view.details!.production }); await onReload()
        onNotice('本批已明确停止，原始结果和调用记录保留。请核对保留/重录清单后准备新版本。')
      })}>停止本批并选择保留或重录</button>}
    </>}
    <VoiceRecoveryPanel scope={scope} view={view} disabled={disabled || formPending || reviewPending || generating} visible={visible}
      onPending={setRecoveryPending} onAction={onAction} onReload={onReload} onNotice={onNotice} />
  </section>
}
