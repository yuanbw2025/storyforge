import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { configureAvgChosenSoundDraftV1 } from '../../lib/avg/sound-author-service'
import { avgSoundProductionExecutionReadyV1, avgSoundProductionTemplates } from '../../lib/avg/sound-production-brief'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PLAN_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from '../../lib/avg/sound-production-plan'
import { stopProductProductionV1 } from '../../lib/product-production/service'
import SoundPlanPanel from './SoundPlanPanel'
import SoundReviewPanel from './SoundReviewPanel'

type Props = { scope: WorkspaceScope; view: Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
  disabled: boolean; canAdopt: boolean; sourcesReady: boolean; declaration: string; visible: boolean; generating: boolean
  onPending: (value: boolean) => void; onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>
  onGenerate: () => Promise<void>; onCancel: () => void; onNotice: (text: string) => void }
function SoundCandidate({ onReviewPending, ...props }: Omit<ComponentProps<typeof SoundReviewPanel>, 'onPending'> & { onReviewPending: (key: string, value: boolean) => void }) {
  const key = props.raw.artifactKey
  const pending = useCallback((value: boolean) => onReviewPending(key, value), [onReviewPending, key])
  return <SoundReviewPanel {...props} onPending={pending}/>
}
export default function SoundProductionPanel({ scope, view, disabled, canAdopt, sourcesReady, declaration, visible, generating,
  onPending, onAction, onReload, onGenerate, onCancel, onNotice }: Props) {
  const [planPending, setPlanPending] = useState(false), [reviews, setReviews] = useState<Record<string, boolean>>({}), [expanded, setExpanded] = useState('')
  const reviewPending = Object.values(reviews).some(Boolean)
  const onReviewPending = useCallback((key: string, value: boolean) => setReviews(old => old[key] === value ? old : { ...old, [key]: value }), [])
  useEffect(() => { onPending(planPending || reviewPending); return () => onPending(false) }, [planPending, reviewPending, onPending])
  const details = view.details, planning = details?.executionBrief?.avgSoundPlanning, productionId = details?.production.id, build = details?.build
  if (!planning || !productionId || !build) return null
  const templates = avgSoundProductionTemplates(planning)
  const accepted = (key: string) => view.artifacts.find(a => a.artifactKey === key && a.status === 'accepted')
  const pending = (key: string) => view.artifacts.find(a => a.artifactKey === key && a.status === 'pending')
  const proposal = accepted(AVG_SOUND_PROPOSAL_KEY_V1), plan = accepted(AVG_SOUND_PLAN_KEY_V1), compiled = accepted(AVG_SOUND_COMPILED_KEY_V1)
  const processing = details.executionBrief?.avgAudioProcessing?.entries.filter(e => e.domain === 'sound') ?? []
  const processingRequired = (key: string) => processing.some(e => e.requirementKey === key)
  const allActualTargets = templates.every(t => accepted(`avg.sound.raw.${t.requirementKey}`)
    && (!processingRequired(t.requirementKey) || accepted(`avg.sound.processed.${t.requirementKey}`)))
  const allChoices = templates.every(t => accepted(`avg.sound.choice.${t.requirementKey}`))
  const enabled = avgSoundProductionExecutionReadyV1(), pendingBrief = details.production.status === 'brief-ready' && details.brief?.revision !== build.briefRevision
  let failures: string[] = []
  if (build.failureJson !== '{}') {
    try {
      const failure = JSON.parse(build.failureJson)
      const tasks = failure.taskFailures ? Object.values(failure.taskFailures) as Array<{ taskKey?: string; code?: string; detail?: string }> : [failure]
      failures = tasks.map(t => `${t.taskKey ?? '本批任务'}：${t.detail ?? t.code ?? '原始失败记录保留'}`)
    } catch { failures = ['本批失败记录无法读取，请保留原始记录并核对制作来源。'] }
  }
  return <section className="lf-paper avg-sound-production" aria-label="声音生产工作台"><h4>音乐、环境与音效制作（实验）</h4>
    {planning.version === 2 ? <p>复用已采用声音的准确原件，仅重新加工所选一项；不调用模型或声音生成服务。原件、旧采用版和其他播放槽继续保留，新结果需要独立试听和采用。</p>
      : <p>本批 {templates.length} 项；至多1次声音方案模型调用、{templates.filter(t => t.source.kind === 'generate-music').length} 次本机音乐生成，其余为原库音效导入。以实际记录计量；未明请求不会自动重发。</p>}
    {!enabled && <p role="status">声音制作入口关闭，已有来源与原始结果保留；只读审听不授予新的作者采用。</p>}
    {failures.length > 0 && <div role="alert"><p>声音制作已暂停，原始请求和结果记录保留。结果未明的任务不会自动重发。</p>{failures.map((text, i) => <p key={i}>{text}</p>)}</div>}
    {pendingBrief && <p role="status">已有待开始的新方案，当前版本只能查看，不能继续生产或采用。</p>}
    {generating ? <button className="lf-action" onClick={onCancel}>停止等待并保留声音记录</button>
      : <button className="lf-action lf-action-primary" disabled={disabled || planPending || reviewPending || !enabled || !canAdopt || !sourcesReady || pendingBrief || !!proposal && !plan || allActualTargets}
        onClick={() => void onGenerate()}>{planning.version === 2 ? '加工所选原声音' : proposal ? '继续本批声音制作' : '生成本批声音方案'}</button>}
    {proposal && planning.version === 1 && <SoundPlanPanel scope={scope} productionId={productionId} planning={planning.scope} proposal={proposal} adopted={plan} pending={pending(AVG_SOUND_PLAN_KEY_V1)}
      disabled={disabled || reviewPending || generating || !visible || pendingBrief} canAdopt={canAdopt && enabled} compiled={!!compiled} declaration={declaration}
      onPending={setPlanPending} onAction={onAction} onReload={onReload}/>}
    {templates.map(t => { const raw = accepted(`avg.sound.raw.${t.requirementKey}`); return <article key={t.requirementKey} className="avg-assembly-candidate" aria-label={`声音用途 ${t.requirementKey}`}>
      <h5>{t.purpose}</h5><p>{t.channel} · {t.cue.phase} · 音量 {t.cue.volume} · {t.cue.loop ? '循环' : '一次'}；触发台词 {t.cue.beatKey}</p>
      {raw ? <><button className="lf-action" disabled={generating || planPending || reviewPending} onClick={() => setExpanded(expanded === t.requirementKey ? '' : t.requirementKey)}>{processingRequired(t.requirementKey) || accepted(`avg.sound.processed.${t.requirementKey}`) ? '查看并审听加工声音' : '查看并审听原声音'}</button>
        {!generating && expanded === t.requirementKey && <SoundCandidate scope={scope} productionId={productionId} raw={raw}
          processed={accepted(`avg.sound.processed.${t.requirementKey}`)} processingRequired={processingRequired(t.requirementKey)}
          review={accepted(`avg.review.audio.${t.requirementKey}`)} pendingReview={pending(`avg.review.audio.${t.requirementKey}`)}
          choice={accepted(`avg.sound.choice.${t.requirementKey}`)} pendingChoice={pending(`avg.sound.choice.${t.requirementKey}`)}
          disabled={disabled || planPending || generating || !visible || pendingBrief || Object.entries(reviews).some(([key, value]) => value && key !== raw.artifactKey)}
          canAdopt={canAdopt && enabled} declaration={declaration} onReviewPending={onReviewPending} onAction={onAction} onReload={onReload}/>}</> : <p>等待方案采用与准确原音频</p>}
    </article> })}
    <button className="lf-action" disabled={disabled || planPending || reviewPending || generating || !canAdopt || !enabled || !allChoices || pendingBrief} onClick={() => void onAction(async () => {
      await configureAvgChosenSoundDraftV1({ scope, productionId, expectedDraftRevision: view.draft.revision }); await onReload()
      onNotice('已采用声音已配置到准确台词触发拍和通道；请另行确认演出，再生成联合预览。')
    })}>将已采用声音配置到演出草稿</button>
    {!build.previewHash && ['authorized', 'building', 'integrating'].includes(build.status) && <button className="lf-action" disabled={disabled || planPending || reviewPending || generating || pendingBrief} onClick={() => void onAction(async () => {
      await stopProductProductionV1({ scope, production: details.production }); await onReload(); onNotice('本批声音制作已明确停止，原响应、音频和费用/失败记录保留。')
    })}>停止声音制作并保留记录</button>}
    <details><summary>本批实际任务与投入记录</summary><pre>{JSON.stringify({ progress: view.soundProgress, usage: view.soundRecordedUsage, failure: build.failureJson }, null, 2)}</pre></details>
  </section>
}
