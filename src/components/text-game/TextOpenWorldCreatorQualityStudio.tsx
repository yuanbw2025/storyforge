import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import type { WorkspaceScope } from '../../lib/types'
import {
  finalizeTextOpenWorldCreatorQualityV1,
  portableTextOpenWorldCreatorIssueJsonV1,
  readTextOpenWorldCreatorQualityWorkspaceV1,
  recordTextOpenWorldCreatorGrayboxV1,
  recordTextOpenWorldCreatorIssueV1,
  waiveTextOpenWorldCreatorAdvisoryIssueV1,
  type TextOpenWorldCreatorQualityWorkspaceV1,
} from '../../lib/open-world/creator-quality'
import {
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1,
  TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1,
  type TextOpenWorldCreatorGrayboxHumanChecksV1,
  type TextOpenWorldCreatorHumanQualityChecksV1,
  type TextOpenWorldCreatorIssueCategoryV1,
  type TextOpenWorldCreatorIssueSeverityV1,
} from '../../lib/open-world/creator-quality-contract'
import { downloadTextFile } from '../../lib/export/text-export'

const COVERAGE_LABELS: Record<typeof TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1[number], string> = {
  'mainline-ending': '完成一条主线结局',
  'governed-action': '受治理Action与结果事件',
  'world-exploration': '地区移动与探索',
  combat: '至少一场确定性战斗',
  'growth-or-economy': '成长、物品、制作或交易',
  'checkpoint-replay': '有效检查点与事件重放',
}

const CATEGORY_LABELS: Record<TextOpenWorldCreatorIssueCategoryV1, string> = {
  narrative: '叙事', quest: '任务', gameplay: '玩法', balance: '平衡',
  'ui-accessibility': 'UI/无障碍', media: '媒资', performance: '性能',
  'save-recovery': '存档/恢复', 'data-integrity': '数据完整性', other: '其他',
}

const EMPTY_GRAYBOX_CHECKS = {
  refreshedAndRecovered: false,
  guidanceWasUnderstandable: false,
  narrativeExperienceReviewed: false,
  mediaAndFallbacksReviewed: false,
  allObservedProblemsReported: false,
}

const EMPTY_QUALITY_CHECKS = {
  narrativeAndGuidanceReviewed: false,
  regionalAndQuestVarietyReviewed: false,
  dialogueAndKnowledgeReviewed: false,
  mediaAndAccessibilityReviewed: false,
  issueListComplete: false,
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
}

function browserEnvironment() {
  const clientHints = (navigator as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string }>; platform?: string }
  }).userAgentData
  return {
    browserName: clientHints?.brands?.map(brand => brand.brand).join(', ') || 'browser',
    browserVersion: navigator.userAgent,
    platform: clientHints?.platform || navigator.platform || 'unknown',
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

export default function TextOpenWorldCreatorQualityStudio(props: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  refreshToken: string
  disabled?: boolean
  onPreview: () => void
  onChanged: () => void | Promise<void>
}) {
  const [workspace, setWorkspace] = useState<TextOpenWorldCreatorQualityWorkspaceV1 | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<number[]>([])
  const [grayboxChecks, setGrayboxChecks] = useState(EMPTY_GRAYBOX_CHECKS)
  const [grayboxNote, setGrayboxNote] = useState('')
  const [qualityChecks, setQualityChecks] = useState(EMPTY_QUALITY_CHECKS)
  const [qualityNote, setQualityNote] = useState('')
  const [findingWaivers, setFindingWaivers] = useState<Record<string, string>>({})
  const [issueSeverity, setIssueSeverity] = useState<TextOpenWorldCreatorIssueSeverityV1>('blocking')
  const [issueCategory, setIssueCategory] = useState<TextOpenWorldCreatorIssueCategoryV1>('narrative')
  const [issueSummary, setIssueSummary] = useState('')
  const [issuePreconditions, setIssuePreconditions] = useState('')
  const [issueSteps, setIssueSteps] = useState('')
  const [issueExpected, setIssueExpected] = useState('')
  const [issueActual, setIssueActual] = useState('')
  const [issueStableKeys, setIssueStableKeys] = useState('')
  const [issueSessionId, setIssueSessionId] = useState<number | null>(null)
  const [issueSourceExcluded, setIssueSourceExcluded] = useState(false)
  const [issueWaivers, setIssueWaivers] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await readTextOpenWorldCreatorQualityWorkspaceV1({
        scope: props.scope, productionId: props.productionId, expectedBuildId: props.buildId,
      })
      setWorkspace(next)
      setSelectedSessionIds(current => {
        const available = new Set(next.grayboxCandidates.map(candidate => candidate.sessionId))
        const retained = current.filter(id => available.has(id))
        if (retained.length) return retained
        const completed = next.grayboxCandidates.find(candidate => candidate.completed)
        return completed ? [completed.sessionId] : next.grayboxCandidates[0] ? [next.grayboxCandidates[0].sessionId] : []
      })
      setIssueSessionId(current => next.grayboxCandidates.some(candidate => candidate.sessionId === current)
        ? current : next.grayboxCandidates[0]?.sessionId ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [props.scope, props.productionId, props.buildId])

  useEffect(() => { void load() }, [load, props.refreshToken])

  const selectedCoverage = useMemo(() => {
    const selected = new Set(selectedSessionIds)
    return new Set(workspace?.grayboxCandidates
      .filter(candidate => selected.has(candidate.sessionId))
      .flatMap(candidate => candidate.coverageKeys) ?? [])
  }, [selectedSessionIds, workspace])
  const allGrayboxChecks = Object.values(grayboxChecks).every(Boolean)
  const allQualityChecks = Object.values(qualityChecks).every(Boolean)
  const allCoverage = TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.every(key => selectedCoverage.has(key))
  const allFindingWaiversComplete = workspace?.modelFindings.every(finding => (
    (findingWaivers[finding.findingKey] ?? '').trim().length >= 20
  )) ?? false

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      await load()
      await props.onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const confirmGraybox = () => run(async () => {
    await recordTextOpenWorldCreatorGrayboxV1({
      scope: props.scope, productionId: props.productionId, buildId: props.buildId,
      sessionIds: selectedSessionIds, environment: browserEnvironment(),
      humanChecks: grayboxChecks as TextOpenWorldCreatorGrayboxHumanChecksV1,
      authorNote: grayboxNote,
    })
  }, '隔离灰盒试玩回执已冻结。')

  const submitIssue = () => run(async () => {
    const created = await recordTextOpenWorldCreatorIssueV1({
      scope: props.scope, productionId: props.productionId, buildId: props.buildId,
      severity: issueSeverity, category: issueCategory, summary: issueSummary,
      preconditions: lines(issuePreconditions), reproductionSteps: lines(issueSteps),
      expected: issueExpected, actual: issueActual, affectedStableKeys: lines(issueStableKeys),
      sessionId: issueSessionId, sourceTextExcluded: issueSourceExcluded as true,
    })
    downloadTextFile(
      portableTextOpenWorldCreatorIssueJsonV1(created),
      `text-open-world-${created.receipt.evidence.issueKey}.json`,
      'application/json',
    )
    setIssueSummary('')
    setIssuePreconditions('')
    setIssueSteps('')
    setIssueExpected('')
    setIssueActual('')
    setIssueStableKeys('')
    setIssueSourceExcluded(false)
  }, '问题回执已保存并导出；当前Build的质量结论会重新计算。')

  const waiveIssue = (receiptHash: string) => run(async () => {
    await waiveTextOpenWorldCreatorAdvisoryIssueV1({
      scope: props.scope, productionId: props.productionId, buildId: props.buildId,
      issueReceiptHash: receiptHash, reason: issueWaivers[receiptHash] ?? '',
      confirmation: 'author-accepts-advisory-risk',
    })
  }, '非阻断问题的软豁免已绑定原问题回执。')

  const finalizeQuality = () => run(async () => {
    await finalizeTextOpenWorldCreatorQualityV1({
      scope: props.scope, productionId: props.productionId, buildId: props.buildId,
      semanticWaivers: (workspace?.modelFindings ?? []).map(finding => ({
        findingKey: finding.findingKey, reason: findingWaivers[finding.findingKey] ?? '',
      })),
      humanChecks: qualityChecks as TextOpenWorldCreatorHumanQualityChecksV1,
      authorNote: qualityNote,
    })
  }, '当前Build的发布质量结论已冻结。')

  const disabled = props.disabled || busy

  return <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-open-world-creator-quality-studio">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">发布前质量、灰盒试玩与问题回执</h2></div>
        <p className="mt-2 max-w-4xl text-[10px] leading-5 text-text-muted">代码硬门不能豁免；模型建议项和作者登记的非阻断问题只能逐项写明理由后软豁免。试玩只接受当前未发布Build的隔离Session、真实事件流和有效检查点，回执不会携带世界原文。</p>
      </div>
      <button type="button" disabled={loading || disabled} onClick={() => void load()} className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />刷新证据</button>
    </div>

    {loading && <p className="mt-4 text-xs text-text-muted">正在复验Build、质量Artifact和隔离Session……</p>}
    {error && <p role="alert" className="mt-4 rounded border border-error/30 bg-error/5 p-3 text-xs text-error">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded border border-success/30 bg-success/5 p-3 text-xs text-success">{notice}</p>}

    {workspace && <>
      <div className={`mt-4 rounded border p-4 ${workspace.releaseQualityReady ? 'border-success/40 bg-success/5' : 'border-accent/30 bg-accent/5'}`} data-testid="text-open-world-creator-quality-status">
        <strong className={workspace.releaseQualityReady ? 'text-success' : 'text-accent'}>{workspace.releaseQualityReady ? '发布质量证据已闭合' : '当前Build仍在质量验收'}</strong>
        <p className="mt-1 text-[10px] text-text-muted">Build #{workspace.build.buildNumber} · package {compactHash(workspace.build.packageHash)} · governance {compactHash(workspace.governanceSnapshotHash)}</p>
        {!workspace.releaseQualityReady && <ul className="mt-2 grid gap-1 text-[10px] text-text-muted">{workspace.blockers.map(blocker => <li key={blocker}>· {blocker}</li>)}</ul>}
        {workspace.releaseQualityReceipt && <code className="mt-2 block text-[10px] text-success">quality receipt {compactHash(workspace.releaseQualityReceipt.receiptHash)}</code>}
      </div>

      <section className="mt-4 rounded border border-border bg-bg-base p-4" aria-labelledby="creator-hard-gates-title">
        <h3 id="creator-hard-gates-title" className="text-xs font-semibold">1. 不可豁免硬门</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{workspace.hardChecks.map(check => <article key={check.gateKey} className={`rounded border p-3 text-[10px] ${check.passed ? 'border-success/30' : 'border-error/40 bg-error/5'}`}>
          <span className="flex items-center gap-2">{check.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-error" />}<strong>{check.label}</strong></span>
          <code className="mt-2 block text-text-muted">{check.gateKey}</code>
        </article>)}</div>
      </section>

      <section className="mt-4 rounded border border-border bg-bg-base p-4" aria-labelledby="creator-model-review-title">
        <h3 id="creator-model-review-title" className="text-xs font-semibold">2. 平衡与叙事双评审</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{workspace.reviews.map(review => <article key={review.reviewKind} className="rounded border border-border p-3 text-[10px]">
          <span className="flex items-center justify-between gap-2"><strong>{review.reviewKind === 'semantic' ? '叙事语义' : '玩法平衡'}评审</strong><em className="not-italic text-success">最低 {review.minimumScore} / 阈值 {review.threshold}</em></span>
          <div className="mt-2 grid gap-1">{review.scores.map(score => <div key={score.metricKey} className="flex justify-between gap-3"><span title={score.rationale}>{score.metricKey}</span><strong>{score.score}</strong></div>)}</div>
        </article>)}</div>
        {workspace.modelFindings.length > 0 ? <div className="mt-3 grid gap-3">{workspace.modelFindings.map(finding => <label key={finding.findingKey} className="rounded border border-accent/30 bg-accent/5 p-3 text-[10px]">
          <strong className="block">{finding.reviewKind} · {finding.metricKey} · {finding.score}分</strong>
          <span className="mt-1 block text-text-muted">{finding.summary}；目标 {finding.targetArtifactKey} / {finding.repairTaskKey}</span>
          <textarea aria-label={`软豁免理由 ${finding.findingKey}`} value={findingWaivers[finding.findingKey] ?? ''} onChange={event => setFindingWaivers(current => ({ ...current, [finding.findingKey]: event.target.value }))} maxLength={2000} className="mt-2 min-h-20 w-full rounded border border-border bg-bg-elevated p-2 text-text-main" placeholder="若本版暂不修复，请至少20字说明接受该风险的具体原因；否则先使用局部修复生成新Build。" />
        </label>)}</div> : <p className="mt-3 text-[10px] text-success">双评审均达到85分以上，没有需要作者软豁免的建议项。</p>}
      </section>

      <section className="mt-4 rounded border border-border bg-bg-base p-4" aria-labelledby="creator-graybox-title">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="creator-graybox-title" className="text-xs font-semibold">3. 隔离灰盒试玩</h3><p className="mt-1 text-[10px] text-text-muted">可组合最多6个当前Build Session，但必须覆盖完整核心循环，并至少有一个真正到达结局。</p></div><button type="button" disabled={disabled} onClick={props.onPreview} className="flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent disabled:opacity-40"><Play className="h-3.5 w-3.5" />试玩当前Build</button></div>
        <div className="mt-3 grid gap-2">{workspace.grayboxCandidates.map(candidate => <label key={candidate.sessionId} className="flex items-start gap-2 rounded border border-border p-3 text-[10px]">
          <input type="checkbox" checked={selectedSessionIds.includes(candidate.sessionId)} onChange={event => setSelectedSessionIds(current => event.target.checked ? [...new Set([...current, candidate.sessionId])] : current.filter(id => id !== candidate.sessionId))} />
          <span className="min-w-0"><strong className="block">{candidate.title} {candidate.completed ? '· 已到达结局' : '· 尚未完成'}</strong><span className="mt-1 block text-text-muted">事件 {candidate.eventCount} · 检查点 {candidate.checkpointCount} · 覆盖 {candidate.coverageKeys.map(key => COVERAGE_LABELS[key]).join('、') || '尚无'}</span></span>
        </label>)}{workspace.grayboxCandidates.length === 0 && <p className="rounded border border-dashed border-border p-3 text-[10px] text-text-muted">尚无可验证的当前Build隔离Session；先进入试玩并完成核心循环。</p>}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.map(key => <span key={key} className={`rounded border p-2 text-[10px] ${selectedCoverage.has(key) ? 'border-success/30 text-success' : 'border-border text-text-muted'}`}>{selectedCoverage.has(key) ? '已验证' : '缺少'} · {COVERAGE_LABELS[key]}</span>)}</div>
        {!workspace.grayboxReceipt && <>
          <fieldset className="mt-3 grid gap-2 text-[10px] text-text-muted"><legend className="font-semibold text-text-main">作者人工复核</legend>{([
            ['refreshedAndRecovered', '我已刷新/重开并确认事件回放与恢复结果一致'],
            ['guidanceWasUnderstandable', '我能理解当前目标、失败原因和可用操作'],
            ['narrativeExperienceReviewed', '我已检查主线、支线、地区与对话的实际游玩体验'],
            ['mediaAndFallbacksReviewed', '我已检查头像、背景、程序地图及静音/文字降级'],
            ['allObservedProblemsReported', '试玩中观察到的问题都已登记为问题回执'],
          ] as const).map(([key, label]) => <label key={key} className="flex gap-2"><input type="checkbox" checked={grayboxChecks[key]} onChange={event => setGrayboxChecks(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</fieldset>
          <textarea aria-label="灰盒试玩备注" value={grayboxNote} onChange={event => setGrayboxNote(event.target.value)} maxLength={4000} className="mt-3 min-h-20 w-full rounded border border-border bg-bg-elevated p-3 text-xs" placeholder="可选：记录试玩策略、设备或需要在下一版关注的体验。" />
          <button type="button" disabled={disabled || !allCoverage || !allGrayboxChecks || selectedSessionIds.length === 0} onClick={() => void confirmGraybox()} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">确认试玩并冻结回执</button>
        </>}
        {workspace.grayboxReceipt && <p className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-[10px] text-success">灰盒回执已通过：{compactHash(workspace.grayboxReceipt.receiptHash)} · {workspace.grayboxReceipt.evidence.sessions.length}个隔离Session</p>}
      </section>

      <section className="mt-4 rounded border border-border bg-bg-base p-4" aria-labelledby="creator-issue-title">
        <h3 id="creator-issue-title" className="text-xs font-semibold">4. 问题回执</h3>
        <p className="mt-1 text-[10px] text-text-muted">阻断问题不能豁免；非阻断问题可明确接受风险。导出的JSON只有复现描述、稳定键与Hash，不包含数据库本地ID、来源原文或完整事件正文。</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{workspace.issues.map(issue => <article key={issue.receipt.receiptHash} className={`rounded border p-3 text-[10px] ${issue.blocksRelease ? 'border-error/30 bg-error/5' : 'border-success/30 bg-success/5'}`}>
          <span className="flex flex-wrap items-center justify-between gap-2"><strong>{issue.receipt.evidence.severity === 'blocking' ? '阻断' : '非阻断'} · {CATEGORY_LABELS[issue.receipt.evidence.category]}</strong><code>{compactHash(issue.receipt.receiptHash)}</code></span>
          <p className="mt-2">{issue.receipt.evidence.summary}</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => downloadTextFile(portableTextOpenWorldCreatorIssueJsonV1(issue), `text-open-world-${issue.receipt.evidence.issueKey}.json`, 'application/json')} className="flex items-center gap-1 text-accent underline"><Download className="h-3 w-3" />导出复现回执</button></div>
          {issue.receipt.evidence.severity === 'blocking' && <p className="mt-2 text-error">必须根据回执创建新Build修复；当前Build不能发布。</p>}
          {issue.receipt.evidence.severity === 'advisory' && !issue.waiver && <><textarea aria-label={`问题软豁免理由 ${issue.receipt.evidence.issueKey}`} value={issueWaivers[issue.receipt.receiptHash] ?? ''} onChange={event => setIssueWaivers(current => ({ ...current, [issue.receipt.receiptHash]: event.target.value }))} maxLength={2000} className="mt-2 min-h-16 w-full rounded border border-border bg-bg-elevated p-2" placeholder="至少20字说明为什么本版可以接受该风险。" /><button type="button" disabled={disabled || (issueWaivers[issue.receipt.receiptHash] ?? '').trim().length < 20} onClick={() => void waiveIssue(issue.receipt.receiptHash)} className="mt-2 rounded border border-accent/40 px-3 py-1.5 text-accent disabled:opacity-40">确认软豁免</button></>}
          {issue.waiver && <p className="mt-2 text-success">已绑定软豁免：{issue.waiver.evidence.reason}</p>}
        </article>)}</div>
        <details className="mt-3 rounded border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">登记新的可复现问题</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-[10px] text-text-muted">级别<select aria-label="问题级别" value={issueSeverity} onChange={event => setIssueSeverity(event.target.value as TextOpenWorldCreatorIssueSeverityV1)} className="mt-1 block w-full rounded border border-border bg-bg-elevated p-2 text-text-main"><option value="blocking">阻断：当前Build不可发布</option><option value="advisory">非阻断：可说明后软豁免</option></select></label>
            <label className="text-[10px] text-text-muted">类别<select aria-label="问题类别" value={issueCategory} onChange={event => setIssueCategory(event.target.value as TextOpenWorldCreatorIssueCategoryV1)} className="mt-1 block w-full rounded border border-border bg-bg-elevated p-2 text-text-main">{TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
            <label className="md:col-span-2 text-[10px] text-text-muted">问题摘要<input aria-label="问题摘要" value={issueSummary} onChange={event => setIssueSummary(event.target.value)} maxLength={300} className="mt-1 block w-full rounded border border-border bg-bg-elevated p-2 text-text-main" /></label>
            <label className="text-[10px] text-text-muted">前置条件（每行一项）<textarea aria-label="问题前置条件" value={issuePreconditions} onChange={event => setIssuePreconditions(event.target.value)} maxLength={10000} className="mt-1 min-h-24 w-full rounded border border-border bg-bg-elevated p-2 text-text-main" /></label>
            <label className="text-[10px] text-text-muted">复现步骤（每行一步，至少一项）<textarea aria-label="问题复现步骤" value={issueSteps} onChange={event => setIssueSteps(event.target.value)} maxLength={30000} className="mt-1 min-h-24 w-full rounded border border-border bg-bg-elevated p-2 text-text-main" /></label>
            <label className="text-[10px] text-text-muted">预期结果<textarea aria-label="问题预期结果" value={issueExpected} onChange={event => setIssueExpected(event.target.value)} maxLength={2000} className="mt-1 min-h-20 w-full rounded border border-border bg-bg-elevated p-2 text-text-main" /></label>
            <label className="text-[10px] text-text-muted">实际结果<textarea aria-label="问题实际结果" value={issueActual} onChange={event => setIssueActual(event.target.value)} maxLength={2000} className="mt-1 min-h-20 w-full rounded border border-border bg-bg-elevated p-2 text-text-main" /></label>
            <label className="text-[10px] text-text-muted">受影响稳定键（每行一项，可空）<textarea aria-label="问题受影响稳定键" value={issueStableKeys} onChange={event => setIssueStableKeys(event.target.value)} maxLength={10000} className="mt-1 min-h-20 w-full rounded border border-border bg-bg-elevated p-2 font-mono text-text-main" /></label>
            <label className="text-[10px] text-text-muted">关联隔离Session<select aria-label="问题关联Session" value={issueSessionId ?? ''} onChange={event => setIssueSessionId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block w-full rounded border border-border bg-bg-elevated p-2 text-text-main"><option value="">不关联</option>{workspace.grayboxCandidates.map(candidate => <option key={candidate.sessionId} value={candidate.sessionId}>{candidate.title}</option>)}</select></label>
          </div>
          <label className="mt-3 flex gap-2 text-[10px] text-text-muted"><input type="checkbox" checked={issueSourceExcluded} onChange={event => setIssueSourceExcluded(event.target.checked)} />我确认复现描述不粘贴未授权来源原文、密钥或完整内部Prompt</label>
          <button type="button" disabled={disabled || !issueSourceExcluded || issueSummary.trim().length < 5 || lines(issueSteps).length < 1 || issueExpected.trim().length < 3 || issueActual.trim().length < 3} onClick={() => void submitIssue()} className="mt-3 rounded bg-error px-4 py-2 text-xs text-white disabled:opacity-40">保存并导出问题回执</button>
        </details>
      </section>

      {!workspace.releaseQualityReady && <section className="mt-4 rounded border border-border bg-bg-base p-4" aria-labelledby="creator-final-quality-title">
        <h3 id="creator-final-quality-title" className="text-xs font-semibold">5. 冻结发布质量结论</h3>
        <fieldset className="mt-3 grid gap-2 text-[10px] text-text-muted"><legend className="font-semibold text-text-main">作者最终抽检</legend>{([
          ['narrativeAndGuidanceReviewed', '我已抽检主线叙事、目标引导和失败说明'],
          ['regionalAndQuestVarietyReviewed', '我已抽检地区身份、重要支线与小任务差异'],
          ['dialogueAndKnowledgeReviewed', '我已抽检角色对话、关系态度和知识边界'],
          ['mediaAndAccessibilityReviewed', '我已抽检头像/背景/地图、文字降级与可访问性'],
          ['issueListComplete', '我确认当前已知问题清单完整，阻断项均已清除'],
        ] as const).map(([key, label]) => <label key={key} className="flex gap-2"><input type="checkbox" checked={qualityChecks[key]} onChange={event => setQualityChecks(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</fieldset>
        <textarea aria-label="发布质量备注" value={qualityNote} onChange={event => setQualityNote(event.target.value)} maxLength={4000} className="mt-3 min-h-20 w-full rounded border border-border bg-bg-elevated p-3 text-xs" placeholder="可选：记录本版已知取舍和下一版改进方向。" />
        <button type="button" disabled={disabled || !workspace.hardGatesPassed || !workspace.grayboxReceipt || !allQualityChecks || !allFindingWaiversComplete || workspace.issues.some(issue => issue.blocksRelease)} onClick={() => void finalizeQuality()} className="mt-3 rounded bg-success px-4 py-2 text-xs text-white disabled:opacity-40">复验全部证据并冻结质量结论</button>
      </section>}
    </>}
  </section>
}
