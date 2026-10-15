import { useState } from 'react'
import type { AvgReadingHistoryV1 } from '../../lib/avg/reading-contract'
import StageAudio from './StageAudio'

/** History audio is ephemeral and read-only: no reading/Cue/rule command. */
export function ReadingHistory(props: { entries: AvgReadingHistoryV1[]; urls: Record<string, string>; volume: number; paused: boolean
  onReplayRequested?:(assetKey:string|null)=>void; failedAssetKeys?:readonly string[] }) {
  const [replay, setReplay] = useState<{ index: number; generation: number } | null>(null)
  const selected = replay && props.entries.find(e => e.index === replay.index)
  const src = selected?.kind === 'line' && selected.voiceAssetKey ? props.urls[selected.voiceAssetKey] : null
  return <div className="avg-history">{props.entries.map(entry => entry.kind === 'choice' ? <article key={entry.index} className="avg-history-choice"><strong>选择</strong><p>{entry.text}</p></article> : <article key={entry.index} data-visit={entry.visit}>
    <strong>{entry.speaker}</strong><p>{entry.text}</p>
    {entry.voiceAssetKey && (props.urls[entry.voiceAssetKey]||props.onReplayRequested) && <button type="button" onClick={() => {setReplay({ index: entry.index, generation: (replay?.generation ?? 0)+1 });props.onReplayRequested?.(entry.voiceAssetKey)}}>回听第 {entry.index+1} 条</button>}
  </article>)}{!props.entries.length && <p>还没有可以回看的对白。</p>}
    {selected?.kind==='line'&&selected.voiceAssetKey&&<>
      {src?<StageAudio key={`${replay!.index}:${replay!.generation}`} src={src} volume={props.volume} loop={false} channel="history" paused={props.paused} />:<p role="status">{props.failedAssetKeys?.includes(selected.voiceAssetKey)?'片段暂不可用，请重试资源或选择其它记录。':'正在读取回听片段…'}</p>}
      <button type="button" onClick={() => {setReplay(null);props.onReplayRequested?.(null)}}>停止回听</button>
    </>}
  </div>
}
