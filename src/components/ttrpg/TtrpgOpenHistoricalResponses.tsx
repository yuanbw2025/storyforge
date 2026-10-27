import { useState } from 'react'
import { readTtrpgOpenTableHistoricalResponseV1, type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
import type { TtrpgOpenHistoricalResponseV1 } from '../../lib/ttrpg/open-imported-response'
/** Owner-scoped display only. The parent keys it by viewer, Instance and current sequence. */
export default function TtrpgOpenHistoricalResponses(props: {
  input: TtrpgOpenTableInputV1; entries: Array<{ runId: number; requestKey: string; purpose: string }>;
  busy: boolean; perform: (job: () => Promise<void>) => Promise<void>
}) {
  const [historicalResponse, setHistoricalResponse] = useState<TtrpgOpenHistoricalResponseV1 | null>(null)
  const { busy, perform } = props
  if (!props.entries.length) return null
  return (
      <section className="sf-open-table-card" aria-label="导入前已保存的回复"><h2>导入前已保存的回复</h2>
        <p>原回答和用量已保留。请结合当前团局重新检查，再由本人提出人工行动或由真人主持补写叙述。</p>
        {props.entries.map(saved => <button key={saved.requestKey} disabled={busy} onClick={() => void perform(async () => {
          const response = await readTtrpgOpenTableHistoricalResponseV1({ ...props.input, runId: saved.runId, requestKey: saved.requestKey });setHistoricalResponse(response)
        })}>查看{saved.purpose}原回复</button>)}
        {historicalResponse && <div aria-label="历史回复原文"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{historicalResponse.text}</pre>
          <p>原调用用量：输入 {historicalResponse.usage.inputTokens}，输出 {historicalResponse.usage.outputTokens}；{historicalResponse.usage.actualCostUsd === null ? '未取得实际费用回执。' : `费用回执 ${historicalResponse.usage.actualCostUsd} 美元。`}</p>
          <p>这是历史回答。查看不会调用模型或新增行动；采用记录以当前团局为准。需要重新行动时，请结束原主持窗口，再在“按规则手动行动”中提出方案。</p>
          <button disabled={busy} onClick={() => setHistoricalResponse(null)}>收起历史回复</button></div>}
      </section>
  )
}
