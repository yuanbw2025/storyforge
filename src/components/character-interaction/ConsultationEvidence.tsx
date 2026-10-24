import {useEffect, useState} from 'react'
import {liveQuery} from 'dexie'
import type {WorkspaceScope} from '../../lib/types'
import {readProductProductionDetailsV1} from '../../lib/product-production/service'
import {parseProductProductionBriefV3} from '../../lib/product-production/contracts'
import {parseProductProductionSourcePlanV1} from '../../lib/product-production/source-contracts'
import {readChatConsultationProductionEvidenceV1, type ChatConsultationProductionEvidenceV1} from '../../lib/character-interaction/consultation-harness'
import {CHAT_PLAN_FIELDS} from '../../lib/character-interaction/consultation-plan'

/** Author-only inspection of the saved production, never current draft provenance inferred as frozen evidence. */
export default function ConsultationEvidence({scope, productionId}: {scope: WorkspaceScope; productionId: number}) {
  const [result, setResult] = useState<{total: number; rows: ChatConsultationProductionEvidenceV1[]} | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setResult(null); setError('')
    const subscription = liveQuery(async () => {
      const details = await readProductProductionDetailsV1(scope, productionId, ['character-interaction'])
      if (!details.brief) return null
      const brief = parseProductProductionBriefV3(details.brief.briefJson), source = await parseProductProductionSourcePlanV1(details.brief)
      return {total: source.consultationContextManifests.length, rows: await readChatConsultationProductionEvidenceV1(scope, brief, source.consultationContextManifests)}
    }).subscribe({next: setResult, error: cause => setError(String(cause))})
    return () => subscription.unsubscribe()
  }, [scope, productionId])
  if (!result && !error) return null
  return <section className="lf-paper space-y-3" aria-label="已保存方案的会谈依据">
    <h3>已保存方案的会谈依据</h3>
    {error ? <p role="alert">会谈依据暂时无法核对：{error}</p> : <>
      <p>{result!.total ? `已冻结 ${result!.total} 次已采用会谈的读取记录。` : '此方案没有可核对的会谈读取记录；手动填写和旧版记录仍可使用。'}</p>
      {result!.rows.length < result!.total && <p>部分历史正文在当前作品中不可用，冻结的读取记录仍保留；不会据此重新调用模型。</p>}
      {result!.rows.map(row => <details key={row.pointer.manifestHash}>
        <summary>{row.changes.map(change => CHAT_PLAN_FIELDS[change.field]).join('、')}</summary>
        {!row.hasSelectedSources && <p>本轮未带入原文，仅依据作者方案与讨论。</p>}
        {row.changes.map(change => <article key={change.field} className="my-3 space-y-2">
          <strong>{CHAT_PLAN_FIELDS[change.field]}</strong><p className="whitespace-pre-wrap break-words">{change.value}</p>
          <p>{change.basis === 'source' ? '原文支持，经过作者采用' : '作者采用的创作提议'}：{change.reason}</p>
          {change.evidence.map((citation, index) => <blockquote key={index} className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{citation.quote}</blockquote>)}
        </article>)}
      </details>)}
      <p>这里只说明方案依据；角色实际知道什么仍由资料知情范围决定。</p>
    </>}
  </section>
}
