import { useEffect,useRef,useState } from 'react'
import type { TtrpgRulePackRecordV1,WorkspaceScope } from '../../lib/types'
import type { RulePackV2 } from '../../lib/ttrpg/open-contract'
import { parseRulePackV2 } from '../../lib/ttrpg/rule-pack-v2'
import { saveTtrpgRulePackV2 } from '../../lib/ttrpg/rule-pack-library'

/** Explicit author import uses the existing scoped rule owner and immutable identity check. */
export default function TtrpgOpenRuleImport({ scope,onSaved }: {
  scope: WorkspaceScope;onSaved: (record: TtrpgRulePackRecordV1) => void
}) {
  const [candidate,setCandidate] = useState<RulePackV2 | null>(null),[error,setError] = useState(''),[busy,setBusy] = useState(false)
  const revision = useRef(0),active = useRef(true),saved = useRef(onSaved)
  useEffect(() => { saved.current = onSaved },[onSaved])
  useEffect(() => { active.current = true;return () => { active.current = false } },[])
  return <section className="md:col-span-2" data-testid="ttrpg-open-rule-import">
    <h4>导入开放跑团规则</h4>
    <p>选择已经确认的规则文件，检查名称和互动后保存。已有同版本内容会保留；修改规则请使用新版本。</p>
    <label>开放跑团规则文件<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0],request = ++revision.current
      setCandidate(null);setError('')
      if (!file) return
      if (file.size > 1_048_576) { setError('规则文件不能超过 1 MB');return }
      void file.text().then(text => {
        const parsed = parseRulePackV2(JSON.parse(text))
        if (active.current && request === revision.current) setCandidate(parsed)
      }).catch(e => { if (active.current && request === revision.current) setError(String(e)) })
    }} /></label>
    {candidate && <div>
      <p>{candidate.title} · {candidate.ruleSystemVersion} · {candidate.actions.length} 项行动 · {candidate.interactionBindings?.length ?? 0} 项无检定互动</p>
      <ul>{candidate.interactionBindings?.map(binding => <li key={binding.interactionKey}>{binding.title} · 耗时 {binding.timeCostWorldTurns} 个世界回合</li>)}</ul>
      <p>保存规则后仍需保存配置并生成方案；互动后果会在制作与发布时继续检查。</p>
      <button type="button" disabled={busy} onClick={() => {
        setBusy(true);setError('')
        void saveTtrpgRulePackV2({ scope,rulePack: candidate,status: 'validated',immutable: true }).then(record => {
          if (active.current) { saved.current(record);setCandidate(null) }
        }).catch(e => { if (active.current) setError(String(e)) }).finally(() => { if (active.current) setBusy(false) })
      }}>{busy ? '正在保存规则…' : '确认并使用这份规则'}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
