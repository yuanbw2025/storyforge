import {CHAT_OPENING_REVIEW_KEY, CHAT_OPENING_CHECK_LABELS, readChatOpeningReviewV1, minimumChatOpeningReviewVersionV1} from '../../lib/character-interaction/situation-production-review'
import {parseProductProductionPlanV3} from '../../lib/product-production/plan'
import {useMemo} from 'react'
import type {ProductProductionReviewArtifactV1} from '../../lib/product-production/service'
import {parseChatSituationCandidatesV1, type ChatNarrativeProductionSourceV1} from '../../lib/character-interaction/narrative-production'

/** Author-facing comparison. Hidden facts are deliberately available here,
 * before publication; the player receives only their filtered runtime view. */
export default function SituationSelection({artifacts, disabled, onSelect, planJson}: {
  artifacts: ProductProductionReviewArtifactV1[]; disabled: boolean; planJson?: string
  onSelect: (selection: {candidatesHash: string; sourceHash: string; selectedOptionKey: string}) => void
}) {
  const parsed = useMemo(() => {
    try {
      const source = artifacts.find(a => a.artifactKey === 'design.game')
      const candidates = artifacts.find(a => a.artifactKey === 'content.chat-candidates')
      if (!source || !candidates) throw new Error('情境候选尚未加载完整，请重新打开制作页。')
      const content = source.payload as ChatNarrativeProductionSourceV1
      const parsedCandidates = parseChatSituationCandidatesV1(candidates.payload, content)
      const authorTask = planJson ? parseProductProductionPlanV3(planJson).tasks.find(t => t.taskKey === 'content.chat-author-gate') : null
      const minimumVersion = minimumChatOpeningReviewVersionV1(authorTask?.acceptanceGateIds ?? [])
      const required = minimumVersion > 1 || !!authorTask?.inputArtifactKeys.includes(CHAT_OPENING_REVIEW_KEY)
      const reports = artifacts.filter(a => a.artifactKey === CHAT_OPENING_REVIEW_KEY)
      if (reports.length > 1 || required && reports.length !== 1) throw new Error('开场叙事审查尚未完整加载，请重新打开制作页。')
      const review = reports.length ? readChatOpeningReviewV1(reports[0].payload, {source: content, candidates: parsedCandidates, sourceHash: source.contentHash, candidatesHash: candidates.contentHash}) : null
      if (review && review.version < minimumVersion) throw new Error('当前开场需要带行动与背景依据的新审查，请完成制作后再选择。')
      return {source, candidates, content, options: parsedCandidates.options, review, error: null}
    } catch (e) {return {error: e instanceof Error ? e.message : String(e)}}
  }, [artifacts, planJson])
  if (parsed.error || !parsed.options) return <p role="alert" className="mt-3 text-xs text-error">{parsed.error}</p>
  const name = (key: string) => key === 'player' ? parsed.content.settings.narrative.personaName : parsed.content.participants.find(p => p.participantKey === key)?.name ?? key
  return <section className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-xs" data-testid="chat-situation-selection">
    <h3 className="font-semibold">选择故事开始的局面</h3>
    <p className="mt-2 text-text-muted">比较背景、角色想做的事和待解决的问题。选定后，角色会在这个局面中行动，你仍可拒绝、改道或休息。这里的可能方向不会锁定未来剧情。</p>
    <p className="mt-2 text-text-muted">{parsed.review ? '每个开场已按人物动机、可推进路径和选择边界审查。审查是生成辅助，不代表真人体验验收；未通过的开场不可直接选用。若全部不合适，可取消本次制作，调整设定后重新授权。' : '这是历史制作，尚无开场叙事审查记录。'}</p>
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{parsed.options.map(option => {const review = parsed.review?.options.find(row => row.optionKey === option.optionKey); return <article key={option.optionKey} className="rounded border border-border bg-bg-base p-3">
      <h4 className="font-semibold">{option.title}</h4><p className="mt-2">{option.pitch}</p>
      <p className="mt-2 text-text-muted">{option.situation.location} · {option.situation.timeLabel}</p>
      <ul className="mt-3 space-y-2">{option.situation.goals.map(goal => <li key={goal.goalKey}><strong>{name(goal.actorKey)}</strong>想要{goal.desire}；顾虑是{goal.concern}；边界是{goal.boundary}。</li>)}</ul>
      <ul className="mt-3 space-y-1">{option.situation.threads.map(thread => <li key={thread.threadKey}>{thread.question}<span className="block text-text-muted">收束条件：{thread.closureSignals.join('；')}</span></li>)}</ul>
      {review?.agency && <div className="mt-3 rounded border border-border p-2" data-testid="chat-opening-agency"><p className="font-medium">{name(review.agency.actorKey)}的{review.agency.mode === 'wait' ? '等待依据' : '可行动机会'}</p><p className="mt-1">{option.situation.possibilities[review.agency.possibilityIndex].text}</p><p className="mt-1">可能带来的变化：{review.agency.expectedChange}</p><p className="mt-1 text-text-muted">仍需核实：{review.agency.unresolved}</p></div>}
      {review?.development && <div className="mt-3 rounded border border-border p-2" data-testid="chat-opening-development"><p className="font-medium">这段局面如何发展</p><p className="mt-1">{option.situation.possibilities[review.development.possibilityIndex].text}</p><p className="mt-1">{review.development.expectedChange}</p><p className="mt-1 text-text-muted">仍待决定或核实：{review.development.unresolved}</p></div>}
      {parsed.review && <div className="mt-3 space-y-2" data-testid="chat-opening-review">{parsed.review.options.find(row => row.optionKey === option.optionKey)!.checks.map(check => <details key={check.check} className={check.passed ? 'text-text-muted' : 'text-error'}><summary>{check.passed ? '通过' : '需调整'}：{CHAT_OPENING_CHECK_LABELS[check.check]}</summary><p className="mt-1">{check.reason}</p>{check.evidence.map((evidence, i) => <blockquote className="mt-1 border-l border-border pl-2" key={i}>{evidence.quote}</blockquote>)}</details>)}</div>}
      <details className="mt-3"><summary className="cursor-pointer">查看完整背景与角色视角（作者可见）</summary>
        <ul className="mt-2 space-y-2">{option.situation.facts.map(fact => <li key={fact.factKey}>{fact.text}<span className="block text-text-muted">知情者：{fact.audienceKeys.length ? fact.audienceKeys.map(name).join('、') : '暂时无人知情'}</span>{fact.discovery && <div className="mt-1 rounded border border-border p-2" data-testid="chat-discovery-rule"><p>可由 {fact.discovery.actorKeys.map(name).join('、')} 调查发现</p><p>发现条件：{fact.discovery.condition}</p><p className="text-text-muted">必要前提：{fact.discovery.prerequisiteFactKeys.map(key => option.situation.facts.find(f => f.factKey === key)?.text ?? key).join('；')}</p><p className="text-text-muted">选定此开场即确认这些条件。发现仅让调查角色获知；其他人需实际获知后才能使用。</p></div>}</li>)}</ul>
        {option.situation.beliefs.map(b => <p className="mt-2" key={b.beliefKey}>{name(b.actorKey)}目前相信：{b.text}</p>)}
        {option.situation.possibilities.map((p, i) => <p className="mt-2 text-text-muted" key={`${p.actorKey}-${i}`}>{name(p.actorKey)}可能尝试：{p.text}</p>)}
      </details>
      <button className="mt-4 rounded bg-accent px-3 py-2 text-white disabled:opacity-40" disabled={disabled || !!parsed.review?.options.find(row => row.optionKey === option.optionKey)?.checks.some(check => !check.passed)} onClick={() => onSelect({candidatesHash: parsed.candidates.contentHash, sourceHash: parsed.source.contentHash, selectedOptionKey: option.optionKey})}>选择「{option.title}」并继续</button>
    </article>})}</div>
  </section>
}
