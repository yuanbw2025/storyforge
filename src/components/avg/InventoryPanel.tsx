import { useState } from 'react'
import type { AvgInventoryEntryV1 } from '../../lib/avg/inventory-runtime'

export function InventoryPanel(props: { entries: AvgInventoryEntryV1[]; mediaUrls: Record<string, string>; busy: boolean; onAction(action: AvgInventoryEntryV1['actions'][number]): Promise<string> }) {
  const [feedback, setFeedback] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const selected = props.entries.find(e => e.instanceKey === selection) ?? props.entries[0]
  return <><div className="avg-inventory">
    <nav aria-label="持有物件">{props.entries.map(entry => <button key={entry.instanceKey} type="button" aria-pressed={selected?.instanceKey === entry.instanceKey} onClick={() => setSelection(entry.instanceKey)}>
      {entry.iconAssetKey && props.mediaUrls[entry.iconAssetKey] && <img src={props.mediaUrls[entry.iconAssetKey]} alt="" />}
      <span>{entry.name}</span><small>{entry.category === 'evidence' ? '证据' : '物品'} · ×{entry.quantity}</small>
    </button>)}</nav>
    {selected ? <article aria-label="物件详情"><h3>{selected.name}</h3>
      {selected.detailAssetKey && props.mediaUrls[selected.detailAssetKey] && <img className="avg-inventory-detail-image" src={props.mediaUrls[selected.detailAssetKey]} alt={selected.name} />}
      <p>{selected.description}</p><small>{selected.inspected ? '已查看' : '尚未查看'}</small>
      <div className="avg-inventory-actions">{selected.actions.map(action => <div key={action.key}><button type="button" disabled={props.busy || !action.enabled} onClick={() => { setFeedback(''); void props.onAction(action).then(setFeedback).catch(error => setFeedback(error instanceof Error ? error.message : String(error))) }}>{action.label}</button>{!action.enabled && <small>{action.reason}</small>}</div>)}</div>
    </article> : <p>当前没有可查看的物件。</p>}
  </div>{feedback && <p className="avg-inventory-feedback" role="status">{feedback}</p>}</>
}
