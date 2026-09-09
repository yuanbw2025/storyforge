import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react'
import {
  applyTextOpenWorldCreatorBriefSynthesisV1,
  confirmTextOpenWorldCreatorBriefV1,
  createDefaultTextOpenWorldCreatorBriefDraftV1,
  generateTextOpenWorldCreatorBriefCandidateV1,
  saveTextOpenWorldCreatorBriefDraftV1,
  startTextOpenWorldCreatorBriefSessionV1,
  TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../lib/open-world/creator-brief'
import type {
  TextOpenWorldCreatorBriefDraftV1,
  TextOpenWorldCreatorSourceSelectionV1,
} from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { isAIConfigReady } from '../../lib/ai/config-readiness'

export interface TextOpenWorldCreatorBriefStudioProps {
  selection?: TextOpenWorldCreatorSourceSelectionV1 | null
  initialSession?: TextOpenWorldCreatorBriefSessionV1 | null
  onBack: () => void
  onConfirmed?: (session: TextOpenWorldCreatorBriefSessionV1) => void
}

type BusyAction = 'opening' | 'saving' | 'consulting' | 'confirming' | null

function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error) || !cause.message.trim()) return fallback
  return cause.message.replace(/^\[[^\]]+\]\s*/, '').slice(0, 500)
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
}

function LinesField(props: {
  id: string
  label: string
  value: string[]
  hint?: string
  onChange: (value: string[]) => void
}) {
  return <label className="block space-y-1.5" htmlFor={props.id}>
    <span className="text-xs font-medium text-text-primary">{props.label}</span>
    <textarea
      id={props.id}
      className="min-h-24 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm leading-6 outline-none focus:border-accent"
      value={props.value.join('\n')}
      onChange={event => props.onChange(lines(event.target.value))}
      aria-describedby={props.hint ? `${props.id}-hint` : undefined}
    />
    {props.hint && <span id={`${props.id}-hint`} className="block text-[11px] leading-5 text-text-muted">{props.hint}</span>}
  </label>
}

function TextField(props: {
  id: string
  label: string
  value: string
  multiline?: boolean
  hint?: string
  onChange: (value: string) => void
}) {
  const common = {
    id: props.id,
    value: props.value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(event.target.value),
    'aria-describedby': props.hint ? `${props.id}-hint` : undefined,
    className: 'w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm leading-6 outline-none focus:border-accent',
  }
  return <label className="block space-y-1.5" htmlFor={props.id}>
    <span className="text-xs font-medium text-text-primary">{props.label}</span>
    {props.multiline ? <textarea {...common} className={`${common.className} min-h-24`} /> : <input {...common} />}
    {props.hint && <span id={`${props.id}-hint`} className="block text-[11px] leading-5 text-text-muted">{props.hint}</span>}
  </label>
}

function RangeField(props: {
  id: string
  label: string
  value: { minimum: number; maximum: number }
  onChange: (value: { minimum: number; maximum: number }) => void
}) {
  return <fieldset className="space-y-1.5">
    <legend className="text-xs font-medium text-text-primary">{props.label}</legend>
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-[11px] text-text-muted" htmlFor={`${props.id}-min`}>
        最少
        <input id={`${props.id}-min`} type="number" min={0} value={props.value.minimum}
          className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
          onChange={event => props.onChange({ ...props.value, minimum: Number(event.target.value) })} />
      </label>
      <label className="space-y-1 text-[11px] text-text-muted" htmlFor={`${props.id}-max`}>
        最多
        <input id={`${props.id}-max`} type="number" min={0} value={props.value.maximum}
          className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
          onChange={event => props.onChange({ ...props.value, maximum: Number(event.target.value) })} />
      </label>
    </div>
  </fieldset>
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function TextOpenWorldCreatorBriefStudio(props: TextOpenWorldCreatorBriefStudioProps) {
  const aiConfig = useAIConfigStore(state => state.config)
  const [session, setSession] = useState<TextOpenWorldCreatorBriefSessionV1 | null>(props.initialSession ?? null)
  const [draft, setDraft] = useState<TextOpenWorldCreatorBriefDraftV1 | null>(props.initialSession?.draft ?? null)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState<BusyAction>(props.initialSession ? null : 'opening')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [acknowledgements, setAcknowledgements] = useState({
    sourceIdentityReviewed: false,
    productBoundaryReviewed: false,
    unresolvedItemsClosed: false,
    directPublishWorkflowReviewed: false,
  })
  const generation = useRef(0)

  useEffect(() => {
    if (props.initialSession) {
      setSession(props.initialSession)
      setDraft(props.initialSession.draft)
      setError('')
      setBusy(null)
      return
    }
    if (!props.selection) {
      setBusy(null)
      return
    }
    const current = ++generation.current
    setBusy('opening')
    setError('')
    void startTextOpenWorldCreatorBriefSessionV1({
      selection: props.selection,
      sessionKey: 'primary',
    }).then(next => {
      if (generation.current !== current) return
      setSession(next)
      setDraft(next.draft)
      setBusy(null)
    }).catch(cause => {
      if (generation.current !== current) return
      setError(errorMessage(cause, '无法打开创作者会谈。'))
      setBusy(null)
    })
    return () => { generation.current += 1 }
  }, [props.initialSession, props.selection])

  const allAcknowledged = Object.values(acknowledgements).every(Boolean)
  const canConfirm = Boolean(session && draft && !session.sourceIssue
    && draft.unresolvedQuestions.length === 0 && allAcknowledged && !busy)
  const sourceLabel = session?.sourceSummary.label ?? '正在读取来源…'
  const hasAI = isAIConfigReady(aiConfig)
  const fixedBoundary = useMemo(() => Object.entries(TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1), [])

  const updateDraft = (patch: Partial<TextOpenWorldCreatorBriefDraftV1>) => {
    setDraft(current => current ? { ...current, ...patch } : current)
    setNotice('')
  }
  const updateScale = (patch: Partial<TextOpenWorldCreatorBriefDraftV1['scale']>) => {
    setDraft(current => current ? { ...current, scale: { ...current.scale, ...patch } } : current)
    setNotice('')
  }

  const saveDraft = async () => {
    if (!session || !draft) return
    setBusy('saving'); setError(''); setNotice('')
    try {
      const next = await saveTextOpenWorldCreatorBriefDraftV1({ session, draft })
      setSession(next); setDraft(next.draft); setNotice('草稿已保存，可刷新后继续。')
    } catch (cause) { setError(errorMessage(cause, '保存草稿失败。')) }
    finally { setBusy(null) }
  }

  const consult = async () => {
    if (!session || !draft) return
    setBusy('consulting'); setError(''); setNotice('')
    try {
      const next = await generateTextOpenWorldCreatorBriefCandidateV1({
        session, draft, followUp, aiConfig,
      })
      setSession(next); setDraft(next.draft); setFollowUp('')
      setNotice('主 Agent 已形成理解候选。请审阅后决定是否采纳。')
    } catch (cause) { setError(errorMessage(cause, '主 Agent 会谈失败；你仍可人工填写并确认。')) }
    finally { setBusy(null) }
  }

  const applyCandidate = () => {
    if (!session?.candidate || !draft) return
    setDraft(applyTextOpenWorldCreatorBriefSynthesisV1(draft, session.candidate.synthesis))
    setNotice('已把 Agent 建议合入当前表单；正式确认前仍可继续修改。')
  }

  const resetDraft = () => {
    const selection = session?.selection ?? props.selection
    if (!selection || session?.sourceIssue) return
    setDraft(createDefaultTextOpenWorldCreatorBriefDraftV1(selection))
    setAcknowledgements({
      sourceIdentityReviewed: false,
      productBoundaryReviewed: false,
      unresolvedItemsClosed: false,
      directPublishWorkflowReviewed: false,
    })
    setError('')
    setNotice('已恢复为当前来源的预填内容，尚未保存。')
  }

  const confirm = async () => {
    if (!session || !draft) return
    setBusy('confirming'); setError(''); setNotice('')
    try {
      const next = await confirmTextOpenWorldCreatorBriefV1({ session, draft, acknowledgements })
      setSession(next); setDraft(next.draft)
      setNotice(`Brief v${next.confirmedBrief?.revision ?? '—'} 已确认，当前只进入待授权状态，尚未创建 Build。`)
      props.onConfirmed?.(next)
    } catch (cause) { setError(errorMessage(cause, '确认 Brief 失败。')) }
    finally { setBusy(null) }
  }

  if (!session || !draft) return <main className="mx-auto w-full max-w-6xl p-5" data-testid="text-open-world-creator-brief-loading">
    <section className="rounded-xl border border-border bg-bg-elevated p-6 text-sm text-text-muted">
      {busy === 'opening' && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />}
      {busy === 'opening' ? '正在建立来源绑定与创作者会谈…' : error || '等待来源。'}
      {error && <button className="ml-3 text-accent underline" type="button" onClick={props.onBack}>返回来源选择</button>}
    </section>
  </main>

  return <main className="mx-auto w-full max-w-6xl space-y-5 p-4 text-text-primary md:p-6"
    data-testid="text-open-world-creator-brief-studio" aria-busy={Boolean(busy) || undefined}>
    <header className="rounded-xl border border-border bg-bg-elevated p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-accent">TEXT OPEN WORLD · BRIEF</span>
          <h1 className="mt-2 text-xl font-semibold">确认这款游戏要提供什么体验</h1>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">
            主 Agent 只理解你的设定与来源摘要；完整正文和世界内容会在正式生产阶段按冻结来源读取。
          </p>
        </div>
        <button type="button" onClick={props.onBack} disabled={Boolean(busy)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:border-accent disabled:cursor-not-allowed disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />返回来源
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg-base p-3">
          <div className="text-[10px] text-text-muted">已锁定来源</div>
          <div className="mt-1 text-sm font-medium">{sourceLabel}</div>
          <div className="mt-1 font-mono text-[10px] text-text-muted">{compactHash(session.sourceBindingHash)}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-base p-3">
          <div className="text-[10px] text-text-muted">Production</div>
          <div className="mt-1 text-sm font-medium">{session.production.status === 'brief-ready' ? 'Brief 已就绪' : '会谈中'}</div>
          <div className="mt-1 text-[10px] text-text-muted">当前修订 {session.production.currentBriefRevision ?? 0} · Build 0</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-base p-3">
          <div className="text-[10px] text-text-muted">模型路径</div>
          <div className="mt-1 text-sm font-medium">{hasAI ? '可请求主 Agent' : '未配置 Key，可纯人工确认'}</div>
          <div className="mt-1 text-[10px] text-text-muted">正式模型调用有 durable Run 与候选证据</div>
        </div>
      </div>
    </header>

    {session.sourceIssue && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
      <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{session.sourceIssue}。表单仍保留，但不能保存或确认，请返回重新选择。
    </div>}
    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">{notice}</div>}

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <h2 className="text-base font-semibold">1. 核心体验与主角</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TextField id="tow-title" label="游戏标题" value={draft.gameTitle} onChange={gameTitle => updateDraft({ gameTitle })} />
        <label className="block space-y-1.5" htmlFor="tow-protagonist-mode">
          <span className="text-xs font-medium">主角来源</span>
          <select id="tow-protagonist-mode" value={draft.protagonistMode}
            className="w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm"
            onChange={event => updateDraft({ protagonistMode: event.target.value as TextOpenWorldCreatorBriefDraftV1['protagonistMode'] })}>
            <option value="author-defined">用户自己设定</option>
            <option value="source-character">从来源角色中选择</option>
          </select>
        </label>
        <TextField id="tow-player-role" label="玩家扮演谁" value={draft.playerRole} multiline onChange={playerRole => updateDraft({ playerRole })} />
        <TextField id="tow-protagonist" label="主角设定约束" value={draft.protagonistDirective} multiline onChange={protagonistDirective => updateDraft({ protagonistDirective })} />
        <TextField id="tow-fantasy" label="玩家幻想 / 核心感受" value={draft.playerFantasy} multiline onChange={playerFantasy => updateDraft({ playerFantasy })} />
        <TextField id="tow-core-goal" label="长期核心目标" value={draft.coreGoal} multiline onChange={coreGoal => updateDraft({ coreGoal })} />
        <TextField id="tow-conflict" label="核心冲突" value={draft.primaryConflict} multiline onChange={primaryConflict => updateDraft({ primaryConflict })} />
        <TextField id="tow-opening" label="开场处境与首个可执行任务" value={draft.openingSituation} multiline onChange={openingSituation => updateDraft({ openingSituation })} />
        <LinesField id="tow-pillars" label="体验支柱（每行一项）" value={draft.experiencePillars} onChange={experiencePillars => updateDraft({ experiencePillars })} />
        <LinesField id="tow-tone" label="基调关键词（每行一项）" value={draft.toneKeywords} onChange={toneKeywords => updateDraft({ toneKeywords })} />
      </div>
    </section>

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <h2 className="text-base font-semibold">2. 来源使用与创作边界</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <LinesField id="tow-must-keep" label="必须保留的事实" value={draft.mustKeep} onChange={mustKeep => updateDraft({ mustKeep })} />
        <LinesField id="tow-inferences" label="允许 AI 补齐的内容" value={draft.allowedInferences} onChange={allowedInferences => updateDraft({ allowedInferences })} />
        <LinesField id="tow-forbidden" label="禁止改写" value={draft.forbiddenChanges} onChange={forbiddenChanges => updateDraft({ forbiddenChanges })} />
        <LinesField id="tow-boundaries" label="内容安全边界" value={draft.contentBoundaries} onChange={contentBoundaries => updateDraft({ contentBoundaries })} />
        <TextField id="tow-rating" label="内容分级" value={draft.contentRating} onChange={contentRating => updateDraft({ contentRating })} />
        <TextField id="tow-notes" label="给后续生产 Agent 的备注" value={draft.authorNotes} multiline onChange={authorNotes => updateDraft({ authorNotes })} />
      </div>
    </section>

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <h2 className="text-base font-semibold">3. 规模、媒资与完成条件</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5 text-xs font-medium" htmlFor="tow-regions">地区数量
          <input id="tow-regions" type="number" min={1} max={12} value={draft.scale.regions}
            className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm"
            onChange={event => updateScale({ regions: Number(event.target.value) })} />
        </label>
        <RangeField id="tow-locations" label="命名地点" value={draft.scale.namedLocations} onChange={namedLocations => updateScale({ namedLocations })} />
        <RangeField id="tow-mainline" label="主线阶段" value={draft.scale.mainlineStages} onChange={mainlineStages => updateScale({ mainlineStages })} />
        <label className="space-y-1.5 text-xs font-medium" htmlFor="tow-endings">核心结局数量
          <input id="tow-endings" type="number" min={1} max={12} value={draft.scale.endings}
            className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm"
            onChange={event => updateScale({ endings: Number(event.target.value) })} />
        </label>
        <label className="space-y-1.5 text-xs font-medium" htmlFor="tow-threads">重要故事线数量
          <input id="tow-threads" type="number" min={0} max={30} value={draft.scale.significantStorylines}
            className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm"
            onChange={event => updateScale({ significantStorylines: Number(event.target.value) })} />
        </label>
        <RangeField id="tow-ordinary" label="普通任务" value={draft.scale.ordinaryQuests} onChange={ordinaryQuests => updateScale({ ordinaryQuests })} />
        <RangeField id="tow-templates" label="任务模板" value={draft.scale.taskTemplates} onChange={taskTemplates => updateScale({ taskTemplates })} />
        <RangeField id="tow-events" label="随机事件" value={draft.scale.randomEvents} onChange={randomEvents => updateScale({ randomEvents })} />
        <RangeField id="tow-required-minutes" label="主线目标分钟" value={draft.scale.requiredPlayMinutes} onChange={requiredPlayMinutes => updateScale({ requiredPlayMinutes })} />
        <RangeField id="tow-optional-minutes" label="可选内容分钟" value={draft.scale.optionalInventoryMinutes} onChange={optionalInventoryMinutes => updateScale({ optionalInventoryMinutes })} />
        <label className="space-y-1.5 text-xs font-medium" htmlFor="tow-audio">首版音频
          <select id="tow-audio" value={draft.media.audio}
            className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm"
            onChange={event => setDraft(current => current ? {
              ...current, media: { ...current.media, audio: event.target.value as 'none' | 'optional' },
            } : current)}>
            <option value="none">不要求</option><option value="optional">可选</option>
          </select>
        </label>
        <TextField id="tow-art" label="美术方向" value={draft.media.artDirection} multiline onChange={artDirection => setDraft(current => current ? { ...current, media: { ...current.media, artDirection } } : current)} />
      </div>
      <p className="mt-4 rounded-lg border border-border bg-bg-base p-3 text-xs leading-6 text-text-muted">
        固定最低媒资：程序地图、角色头像、场景背景。完成必须经过可玩预览、确定性质量门和语义评审；真人试玩发生在发布后，问题通过新 Release 修复。
      </p>
    </section>

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">4. 主 Agent 理解与未决项</h2>
          <p className="mt-1 text-xs text-text-muted">可以反复补充答案；模型候选不会直接写入正式 Brief。</p></div>
        <button type="button" disabled={!hasAI || Boolean(busy) || Boolean(session.sourceIssue)} onClick={consult}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
          {busy === 'consulting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          请求主 Agent
        </button>
      </div>
      <TextField id="tow-follow-up" label="补充回答或请 Agent 重新理解" value={followUp} multiline onChange={setFollowUp} />
      {session.candidate && <article className="mt-4 space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4" data-testid="text-open-world-creator-brief-candidate">
        <h3 className="text-sm font-semibold">{session.candidate.synthesis.suggestedTitle}</h3>
        <p className="text-xs leading-6 text-text-muted">{session.candidate.synthesis.understandingSummary}</p>
        <div className="grid gap-3 text-xs md:grid-cols-2">
          <div><strong>体验承诺</strong><p className="mt-1 leading-5 text-text-muted">{session.candidate.synthesis.experiencePromise}</p></div>
          <div><strong>主角适配</strong><p className="mt-1 leading-5 text-text-muted">{session.candidate.synthesis.protagonistFit}</p></div>
          <div><strong>来源使用</strong><ul className="mt-1 list-disc pl-5 text-text-muted">{session.candidate.synthesis.sourceUsePlan.map(item => <li key={item}>{item}</li>)}</ul></div>
          <div><strong>风险</strong><ul className="mt-1 list-disc pl-5 text-text-muted">{session.candidate.synthesis.risks.map(item => <li key={item}>{item}</li>)}</ul></div>
        </div>
        <button type="button" onClick={applyCandidate} className="rounded-lg border border-accent px-3 py-2 text-xs text-accent">采纳到表单</button>
      </article>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <LinesField id="tow-unresolved" label={`未决问题（${draft.unresolvedQuestions.length}）`} value={draft.unresolvedQuestions}
          hint="正式确认前必须回答、删除或转成明确接受的假设。" onChange={unresolvedQuestions => updateDraft({ unresolvedQuestions })} />
        <LinesField id="tow-assumptions" label="作者明确接受的假设" value={draft.acceptedAssumptions}
          onChange={acceptedAssumptions => updateDraft({ acceptedAssumptions })} />
      </div>
    </section>

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <h2 className="text-base font-semibold">5. 当前产品硬边界</h2>
      <dl className="mt-4 grid gap-2 text-xs md:grid-cols-2">
        {fixedBoundary.map(([key, value]) => <div key={key} className="flex justify-between gap-3 rounded-lg border border-border bg-bg-base px-3 py-2">
          <dt className="text-text-muted">{key}</dt><dd className="font-mono text-right">{String(value)}</dd>
        </div>)}
      </dl>
      <div className="mt-5 space-y-2">
        {([
          ['sourceIdentityReviewed', '我确认当前来源身份与 Hash'],
          ['productBoundaryReviewed', '我理解首版是有边界的自由演绎，关键主线受保护'],
          ['unresolvedItemsClosed', '我确认未决问题已经清空或转为接受的假设'],
          ['directPublishWorkflowReviewed', '我理解通过质量门后直接发布，问题以新版本修复'],
        ] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs leading-5">
          <input type="checkbox" className="mt-1" checked={acknowledgements[key]}
            onChange={event => setAcknowledgements(current => ({ ...current, [key]: event.target.checked }))} />
          <span>{label}</span>
        </label>)}
      </div>
    </section>

    <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/95 p-4 shadow-lg backdrop-blur">
      <div className="text-xs text-text-muted">
        {session.confirmedBrief
          ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />已确认 v{session.confirmedBrief.revision}，可继续修订</>
          : '确认只保存 Brief，不会启动计费生产。'}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy) || Boolean(session.sourceIssue) || !(session.selection ?? props.selection)} onClick={resetDraft}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">
          <RotateCcw className="h-4 w-4" />恢复预填
        </button>
        <button type="button" disabled={Boolean(busy) || Boolean(session.sourceIssue)} onClick={saveDraft}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">
          {busy === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存草稿
        </button>
        <button type="button" disabled={!canConfirm} onClick={confirm} data-testid="text-open-world-creator-brief-confirm"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {busy === 'confirming' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}确认 Brief
        </button>
      </div>
    </footer>
  </main>
}

export default TextOpenWorldCreatorBriefStudio
