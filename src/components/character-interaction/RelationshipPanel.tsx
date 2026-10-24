import {useState} from 'react'
import type {CharacterInteractionRuntimeState} from '../../lib/types'
import {chatPlayerRelationshipHistoryV1} from '../../lib/character-interaction/relationship-player-history'

type RelationshipHistory = ReturnType<typeof chatPlayerRelationshipHistoryV1>[number]

function RelationshipCard({item}: {item: RelationshipHistory}) {
  const [shown, setShown] = useState(5)
  const {relationship, actorName, history} = item
  const recent = history.slice(-shown).reverse()
  return <article className="min-w-0 space-y-2 rounded border border-border bg-bg-base p-3">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{actorName} → 你 · {relationship.label}</strong><span>{relationship.value}</span></div>
    {history.length ? <details>
      <summary className="cursor-pointer py-2 text-xs">共同经历（{history.length}）</summary>
      <ol className="mt-2 space-y-3">
        {recent.map(({change, source, expression}) => <li key={`${change.eventSequence}:${change.sourceEventSequence}`} data-testid="chat-relationship-cause" className="min-w-0 border-l-2 border-border pl-3">
          <p className="whitespace-pre-wrap break-words text-sm">{change.reason}</p>
          <p className="mt-1 text-xs text-text-muted">{relationship.label}：{change.before} → {change.after}</p>
          <details className="mt-1 text-xs"><summary className="cursor-pointer py-1">查看双方原话</summary>
            <div className="mt-2 space-y-2"><div><p className="mb-1 font-medium">你当时说</p><blockquote className="whitespace-pre-wrap break-words">{source.text}</blockquote></div>
              <div><p className="mb-1 font-medium">{actorName}当时回应</p><blockquote className="whitespace-pre-wrap break-words">{expression.text}</blockquote></div></div>
          </details>
        </li>)}
      </ol>
      {history.length > shown && <button type="button" onClick={() => setShown(count => count + 5)} className="mt-3 rounded border border-border px-3 py-2 text-xs">查看更早经历</button>}
    </details> : <p className="text-xs text-text-muted">暂无可核对的共同经历。</p>}
  </article>
}

export default function RelationshipPanel({interaction}: {interaction: CharacterInteractionRuntimeState}) {
  const relationships = chatPlayerRelationshipHistoryV1(interaction)
  return <div data-testid="chat-relationship-panel" className="min-w-0 rounded border border-border bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">关系与共同经历</h2>
    <p className="mb-3 mt-1 text-xs text-text-muted">这是角色对你的态度。展开经历可回看双方原话，最近的变化排在前面；这些记录不代表你的感受或同意。</p>
    <div className="space-y-3">{relationships.map(item => <RelationshipCard key={`${item.relationship.fromParticipantKey}:${item.relationship.dimensionKey}`} item={item} />)}</div>
    {!relationships.length && <p className="text-sm text-text-muted">这个作品未设置角色对你的关系维度。</p>}
  </div>
}
