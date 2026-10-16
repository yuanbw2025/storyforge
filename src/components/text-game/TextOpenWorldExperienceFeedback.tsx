import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { downloadTextFile } from '../../lib/export/text-export'
import {
  createTextOpenWorldExperienceFeedbackV1, readTextOpenWorldExperienceV1,
  TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1, type TextOpenWorldFeedbackCategoryV1,
} from '../../lib/open-world/experience-feedback'

type Summary = Awaited<ReturnType<typeof readTextOpenWorldExperienceV1>>

export default function TextOpenWorldExperienceFeedback(props: { scope: WorkspaceScope; sessionId: number }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [category, setCategory] = useState<TextOpenWorldFeedbackCategoryV1>('narrative')
  const [note, setNote] = useState('')
  const [sourceExcluded, setSourceExcluded] = useState(false)
  const request = useRef({ generation: 0 })
  const { projectId, worldId, workId } = props.scope
  useEffect(() => {
    const token = request.current
    token.generation++
    setSummary(null); setNote(''); setSourceExcluded(false); setError(''); setNotice(''); setBusy(false)
    return () => { token.generation++ }
  }, [projectId, worldId, workId, props.sessionId])
  const load = async () => {
    const id = ++request.current.generation
    setBusy(true); setError(''); setSummary(null); setNotice('')
    try {
      const value = await readTextOpenWorldExperienceV1({ scope: props.scope, sessionId: props.sessionId })
      if (request.current.generation === id) setSummary(value)
    } catch (cause) { if (request.current.generation === id) setError(cause instanceof Error ? cause.message : '读取失败') }
    finally { if (request.current.generation === id) setBusy(false) }
  }
  const exportFeedback = async () => {
    if (!summary || !sourceExcluded || note.trim().length < 5) return
    const id = ++request.current.generation
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await createTextOpenWorldExperienceFeedbackV1({ summary, category, note, sourceTextExcluded: true })
      if (request.current.generation !== id) return
      await downloadTextFile(JSON.stringify(value, null, 2), `open-world-feedback-${value.feedbackHash.slice(0, 12)}.json`)
      if (request.current.generation !== id) return
      setNotice('已导出到本机文件。尚未发送给作者，也未生成试玩验收回执。')
    } catch (cause) { if (request.current.generation === id) setError(cause instanceof Error ? cause.message : '导出失败') }
    finally { if (request.current.generation === id) setBusy(false) }
  }
  return <section aria-label="本地体验记录与反馈" data-testid="text-open-world-experience-feedback"
    className="rounded border border-border bg-bg-surface p-4 text-xs">
    <h2 className="text-sm font-semibold">体验记录与反馈</h2>
    <p className="mt-2 leading-5 text-text-muted">读取当前存档分支的实际行动统计。仅在本机处理，不上传游戏正文或输入内容。
      这些统计不代表真人试玩验收；反馈填写后需要主动导出文件保存。</p>
    <button type="button" onClick={() => void load()} disabled={busy}
      className="mt-3 rounded border border-border px-3 py-2 disabled:opacity-40">{busy ? '正在处理…' : '读取本地体验记录'}</button>
    {error && <p role="alert" className="mt-3 break-words text-error">{error}</p>}
    {summary && <>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div><dt className="text-text-muted">主线推进</dt><dd>{summary.mainline.steps} 次 · 完成 {summary.mainline.completedQuests} 个任务</dd></div>
        <div><dt className="text-text-muted">首末主线推进间隔</dt><dd>{summary.mainline.wallClockSpanMinutes == null ? '证据不足' : `${summary.mainline.wallClockSpanMinutes.toFixed(1)} 分钟（含停留与离线时间）`}</dd></div>
        <div><dt className="text-text-muted">支线参与</dt><dd>接取 {summary.sideQuests.accepted} · 完成 {summary.sideQuests.completed}</dd></div>
        <div><dt className="text-text-muted">任务终止</dt><dd>放弃 {summary.quests.abandoned} · 过期 {summary.quests.expired}</dd></div>
        <div><dt className="text-text-muted">战斗</dt><dd>失败 {summary.combat.defeated} · 逃跑 {summary.combat.escaped} · 复活 {summary.combat.respawned}</dd></div>
        <div><dt className="text-text-muted">地图</dt><dd>已访问 {summary.map.knownVisitedLocations} 处（含继承） · 本分支快速旅行 {summary.map.fastTravel} 次</dd></div>
        <div><dt className="text-text-muted">自由输入</dt><dd>提供行动映射 {summary.freeInput.mappingOffered} · 已结算映射行动 {summary.freeInput.mappedCommands} · 拒绝或低置信度 {summary.freeInput.boundaryResponses}</dd></div>
        <div><dt className="text-text-muted">边界提示后继续主线</dt><dd>{summary.freeInput.mainlineAfterBoundary} 次（仅表示随后行动推进主线）</dd></div>
        <div><dt className="text-text-muted">重复内容</dt><dd>同指纹重复 {summary.repetition.sameFingerprint} · 同来源重复 {summary.repetition.sameSource}；语义相似度未测量</dd></div>
      </dl>
      <p className="mt-3 text-text-muted">统计至第 {summary.throughSequence} 条事件；无法核验的 AI 记录 {summary.freeInput.unavailableRuns} 条。
        {summary.inheritedFromBranch ? '此存档继承了父分支状态，行动次数只统计当前分支。' : ''}</p>
      <label className="mt-3 block">问题分类
        <select value={category} onChange={event => setCategory(event.target.value as TextOpenWorldFeedbackCategoryV1)}
          className="ml-2 max-w-full rounded border border-border bg-bg-base p-2">
          {Object.entries(TEXT_OPEN_WORLD_FEEDBACK_CATEGORIES_V1).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="mt-3 block">问题描述（至少五字）<textarea value={note} maxLength={2000}
        onChange={event => setNote(event.target.value)} placeholder="说明遇到的问题与预期，不粘贴游戏原文、模型回应或私人信息。"
        className="mt-2 w-full rounded border border-border bg-bg-base p-2" /></label>
      <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={sourceExcluded}
        onChange={event => setSourceExcluded(event.target.checked)} />我已确认描述不含原文或敏感信息。</label>
      <button type="button" disabled={busy || !sourceExcluded || note.trim().length < 5} onClick={() => void exportFeedback()}
        className="mt-3 rounded bg-accent px-4 py-2 text-white disabled:opacity-40">导出本地反馈文件</button>
      {notice && <p role="status" className="mt-3">{notice}</p>}
    </>}
  </section>
}
